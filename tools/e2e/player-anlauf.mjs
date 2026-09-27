/**
 * WANN steht welches Element? Grosse Ansicht gegen kleine Leiste.
 *
 * WOFUER (Nutzer, 2026-07-28): "ich finde den Player ein bisschen langsam im
 * Start" - und, als Massstab: "du kannst den Mini-Player messen und mit dem
 * Player gegenpruefen im Zeitverhalten von den Elementen".
 *
 * Genau das: beide Ansichten bekommen dieselben Daten, also zeigt ein
 * Unterschied je ELEMENT, wo die Zeit verlorengeht - und nicht nur, DASS es
 * sich langsam anfuehlt.
 *
 * AUFRUF: node tools/e2e/player-anlauf.mjs [https://mupibox:8443]
 */
import WebSocket from 'ws'
import { eigenerBrowser } from '../leihgabe.mjs'

const ZIEL = process.argv[2] || 'https://192.168.178.48:8443'
const TAKT = 50
const FRIST = 15_000

// DER DEBUG-PORT WIRD ERFRAGT, NICHT GEWAEHLT.
//
// Hier stand bis zum 04.08.2026 eine feste Nummer — und sie war nicht einmal
// eindeutig: dieselbe 9351 trug tools/marke-tanzt.mjs, dieselbe 9353
// tools/marke-am-geraet.mjs. Ein fester Port ist doppelt gefaehrlich: Ein
// Browser, der einen harten Abbruch ueberlebt hat, HAELT ihn; der eigene
// bindet ihn dann NICHT und sagt darueber nichts; und `/json/list` liefert
// klaglos die Ziele des FREMDEN. Gemessen wird danach eine Seite, die dieses
// Werkzeug nie geoeffnet hat. `eigenerBrowser()` (tools/leihgabe.mjs) holt
// einen freien Port, gibt dem Browser ein eigenes Profil — und weist nach,
// dass der Browser hinter dem Port der eigene ist.
const brw = await eigenerBrowser({ zusatz: ['--ignore-certificate-errors'] }).catch((e) => {
  console.log(`  Browser kam nicht hoch - uebersprungen: ${e.message}`)
  process.exit(0)
})
if (!brw) {
  console.log('  kein Browser gefunden - uebersprungen')
  process.exit(0)
}
let id = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++id
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

/** Die Elemente, die beim Start "da" sein muessen - je Ansicht ein Ausdruck. */
const ELEMENTE = {
  klein: {
    Bild: `!!document.querySelector('app-now-playing-bar .npb-cover img')`,
    Titel: `!!(document.querySelector('app-now-playing-bar .npb-title')?.textContent||'').trim()`,
    Leiste: `(()=>{const r=document.querySelector('app-now-playing-bar ion-range.mupi-fortschritt');return !!r && Number(r.value)>0})()`,
    Knopf: `!!document.querySelector('app-now-playing-bar ion-icon[name="pause"], app-now-playing-bar [name="pause"]')`,
  },
  gross: {
    Bild: `(()=>{const i=document.querySelector('app-player img');return !!i && !(i.src||'').includes('nocover')})()`,
    Titel: `!!(document.querySelector('app-player .titel, app-player ion-title, app-player h1')?.textContent||'').trim()`,
    Leiste: `(()=>{const r=document.querySelector('app-player ion-range.mupi-fortschritt');return !!r && Number(r.value)>0})()`,
    Knopf: `!!document.querySelector('app-player ion-icon[name="pause"], app-player [name="pause"]')`,
  },
}

try {
  await new Promise((r) => setTimeout(r, 1500))
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.navigate', { url: ZIEL })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  // Warten, bis die Leiste steht (es laeuft etwas - dafuer sorgt der Aufrufer).
  const bis = Date.now() + FRIST
  while (Date.now() < bis && !(await ev(`!!document.querySelector('app-now-playing-bar')`))) {
    await new Promise((r) => setTimeout(r, 200))
  }

  const messen = async (welche) => {
    const offen = { ...ELEMENTE[welche] }
    const zeiten = {}
    const t0 = Date.now()
    while (Object.keys(offen).length && Date.now() - t0 < FRIST) {
      for (const [name, ausdruck] of Object.entries(offen)) {
        if (await ev(ausdruck)) {
          zeiten[name] = Date.now() - t0
          delete offen[name]
        }
      }
      await new Promise((r) => setTimeout(r, TAKT))
    }
    for (const name of Object.keys(offen)) zeiten[name] = null
    return zeiten
  }

  // FAIRER VERGLEICH: erst warten, bis die Seite steht. Wer die kleine Leiste
  // waehrend des Seitenaufbaus misst und die grosse danach, misst den
  // Seitenaufbau und nennt es Unterschied - genau das ist mir zuerst passiert
  // (kleine "2,14 s" fuer JEDES Element, weil sie erst dann ueberhaupt da war).
  const warm = Date.now() + 6000
  while (Date.now() < warm && !(await ev(ELEMENTE.klein.Bild))) {
    await new Promise((r) => setTimeout(r, 200))
  }

  const klein = await messen('klein')
  // Vergroessern und dieselben Elemente messen.
  await ev(`document.querySelector('app-now-playing-bar .npb-cover').closest('div').click()`)
  const gross = await messen('gross')

  console.log('  Element   kleine Leiste   grosse Ansicht')
  let langsam = 0
  for (const name of Object.keys(ELEMENTE.klein)) {
    const a = klein[name],
      b = gross[name]
    const zeig = (v) => (v === null ? 'FEHLT' : `${(v / 1000).toFixed(2)} s`)
    const hinweis =
      b !== null && a !== null && b > a + 500 ? '   <== deutlich spaeter' : b === null ? '   <== fehlt' : ''
    if (hinweis) langsam++
    console.log(`  ${name.padEnd(9)} ${zeig(a).padEnd(15)} ${zeig(b)}${hinweis}`)
  }
  console.log(
    langsam
      ? `  ERGEBNIS: ${langsam} Element(e) in der grossen Ansicht spaeter`
      : '  ERGEBNIS: beide Ansichten gleich schnell',
  )

  // ── DER ECHTE WEG, in Etappen gemessen ───────────────────────────────
  //
  // Der Weg ist laenger, als man denkt: Kachel -> Medienliste -> ein Album
  // klappt zur TITELLISTE auf -> erst ein Titel oeffnet den Player. Wer nur
  // zweimal tippt, landet nie dort - genau daran ist die erste Fassung dieser
  // Messung gescheitert und meldete "nicht erschienen" ueber eine gesunde Box.
  //
  // Gemessen wird JEDE Etappe, damit ein spaeterer Vergleich zeigt, WO es
  // langsamer wurde, und nicht nur DASS.
  const etappe = async (was, klick, warten) => {
    const t = Date.now()
    if (klick) await ev(klick)
    const bis = Date.now() + FRIST
    while (Date.now() < bis) {
      if (await ev(warten)) return { was, ms: Date.now() - t }
      await new Promise((r) => setTimeout(r, TAKT))
    }
    return { was, ms: null }
  }

  await send(ws, 'Page.navigate', { url: ZIEL })
  const wege = []
  wege.push(await etappe('Startseite', null, `document.querySelectorAll('swiper-slide').length > 0`))
  // GEZIELT JELLYFIN, nicht Spotify (Hinweis des Nutzers, 2026-07-28): Jellyfin
  // steht im HAUS, Spotify in der Cloud. Wer hier eine Spotify-Kachel nimmt,
  // misst zur Haelfte die Internetstrecke und nennt das Ergebnis
  // "Oberflaechen-Anlauf" - die Zahl schwankt dann mit der Leitung statt mit
  // dem Programm. Spotify wird trotzdem gemessen (unten, als --spotify), denn
  // das ist der Alltag der Box; nur der VERGLEICH gehoert auf Jellyfin.
  //
  // Die Kachel wird ueber die DATEN gesucht, nicht ueber ihr Quellen-Zeichen:
  // ein erster Versuch fragte nach '.src-badge.src-jellyfin' und fand nichts -
  // die Startseite trug ueberhaupt nur ein Spotify-Zeichen, und der Typ heisst
  // 'jellyfin-album', nicht 'jellyfin'. Zweimal geraten, zweimal daneben. Der
  // Kuenstlername aus /api/data ist die verlaessliche Bruecke zur Kachel.
  const quelle = process.argv.includes('--spotify') ? 'spotify' : 'jellyfin'
  const kuenstler = String(
    (await ev(`fetch('/api/data').then(r=>r.json()).then(d=>{
    const e = d.find(x => (x.type||'').startsWith(${JSON.stringify(quelle)}))
    return e ? (e.artist || e.title || '') : ''
  }).catch(() => '')`)) || '',
  ).trim()

  const getroffen = await ev(`(() => {
    const suche = ${JSON.stringify(kuenstler)}.toLowerCase()
    const alle = [...document.querySelectorAll('swiper-slide')]
    const treffer = suche && alle.find(s => (s.textContent||'').toLowerCase().includes(suche))
    const k = (treffer || alle[0])?.querySelector('ion-card')
    k && k.click()
    return !!treffer
  })()`)
  console.log(
    `  Weg ueber ${quelle}${kuenstler ? ` (${kuenstler})` : ''}` +
      (getroffen ? '' : ' - Kachel nicht gefunden, erste genommen'),
  )

  wege.push(
    await etappe(
      'Medienliste',
      null,
      `location.pathname.includes('medialist') && document.querySelectorAll('swiper-slide').length > 0`,
    ),
  )
  // ANPASSUNGSFAEHIG: eine Spotify-Liste zerfaellt erst in Alben, ein Album
  // klappt dann zur Titelliste auf - je nach Eintrag sind das ein oder zwei
  // Ebenen. Fest zu verdrahten, wie oft getippt wird, misst bei der Haelfte
  // der Bibliothek "nicht erreicht" und behauptet damit einen Fehler, den es
  // nicht gibt.
  {
    const t = Date.now()
    let ebenen = 0
    // NACHGESEHEN, nicht geraten (Wiki mupi-oberflaeche-navigation): auf jeder
    // Ebene ist der EINTRAG die LETZTE Kachel - die ersten sind die
    // Navigationskacheln der Ebene darueber. Wer die erste klickt, klickt auf
    // die Navigation, bleibt stehen und meldet "nicht erreicht", obwohl die
    // Box in Ordnung ist. Genau so lief dieser Test dreimal ins Leere.
    // Der Weg ist bei Achims Bibliothek dreistufig
    // (/home -> /medialist -> /medialist-albums -> Titelliste), aber die Tiefe
    // haengt am Eintrag; deshalb wird gelaufen, bis die Liste da ist.
    while (ebenen < 4 && !(await ev(`document.querySelectorAll('.tl-item').length > 0`))) {
      const vorher = await ev(`location.pathname + ':' + document.querySelectorAll('swiper-slide').length`)
      await ev(`(() => { const a = [...document.querySelectorAll('swiper-slide')]
        ; a[a.length - 1]?.querySelector('ion-card')?.click() })()`)
      ebenen++
      const bis = Date.now() + 4000
      while (
        Date.now() < bis &&
        !(await ev(`document.querySelectorAll('.tl-item').length > 0`)) &&
        (await ev(`location.pathname + ':' + document.querySelectorAll('swiper-slide').length`)) === vorher
      ) {
        await new Promise((r) => setTimeout(r, TAKT))
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    const da = await ev(`document.querySelectorAll('.tl-item').length > 0`)
    wege.push({ was: 'Titelliste', ms: da ? Date.now() - t : null, ebenen })
  }
  wege.push(
    await etappe(
      'Player offen',
      `document.querySelector('.tl-item').click()`,
      `!!document.querySelector('app-player')`,
    ),
  )
  wege.push(await etappe('Bild steht', null, ELEMENTE.gross.Bild))
  wege.push(await etappe('Leiste laeuft', null, ELEMENTE.gross.Leiste))

  console.log('\n  Weg aus der Liste, Etappe fuer Etappe:')
  for (const e of wege) {
    console.log(`  ${e.was.padEnd(14)} ${e.ms === null ? 'nicht erreicht' : (e.ms / 1000).toFixed(2) + ' s'}`)
  }

  // ── Gegen die festgehaltenen Werte pruefen ──────────────────────────
  //
  // WOFUER (Idee des Nutzers, 2026-07-28): "dass wir Messungen anlegen, wenn
  // es gut ist, um immer wieder zu testen und Veraenderungen auch so erkennen
  // zu koennen - so typische Werte plus/minus ein Zeitbereich". Genau das:
  // ohne festgehaltene Werte merkt niemand, wenn aus 0,1 s spaeter 1,5 s
  // werden - es faellt erst auf, wenn es sich langsam ANFUEHLT.
  //
  // Mit --neu werden die aktuellen Werte als neue Grundlage geschrieben. Das
  // ist eine bewusste Handlung: wer sie nebenbei ueberschreibt, misst am Ende
  // gegen den Schneckengang von gestern.
  // AN WELCHEM GERAET gemessen? Ohne das sind die Zahlen wertlos: ein Pi 4
  // liefert andere als ein Pi 5, und eine Grundlage vom staerkeren Geraet
  // wuerde auf dem schwaecheren dauernd Alarm schlagen (oder umgekehrt eine
  // echte Verschlechterung verdecken).
  // DURCH DIE SEITE fragen, nicht aus Node: die Box hat ein selbst signiertes
  // Zertifikat, das ein Node-fetch ablehnt (der Browser bekommt es per
  // --ignore-certificate-errors durchgereicht). Der erste Versuch lief
  // deshalb ins Leere und schrieb die Grundlage unter "unbekannt".
  const geraet = String(
    (await ev(`fetch('/api/system').then(r=>r.json()).then(d=>d.modell||'').catch(()=>'')`)) || '',
  ).trim()

  const messwerte = { klein, gross, weg: Object.fromEntries(wege.map((e) => [e.was, e.ms])) }
  const datei = new URL('./anlauf-messwerte.json', import.meta.url)
  if (process.argv.includes('--neu')) {
    const { writeFileSync, readFileSync: readFileSync2, existsSync: existsSync2 } = await import('node:fs')
    const alt = existsSync2(datei) ? JSON.parse(readFileSync2(datei, 'utf8')) : { geraete: {} }
    alt.toleranzMs = alt.toleranzMs ?? 700
    alt.geraete = alt.geraete || {}
    alt.geraete[geraet || 'unbekannt'] = { gemessen: 'von Hand festgehalten', messwerte }
    writeFileSync(datei, JSON.stringify(alt, null, 2) + '\n')
    console.log(`\n  Neue Grundlage festgehalten fuer: ${geraet || 'unbekannt'}`)
  } else {
    const { readFileSync, existsSync } = await import('node:fs')
    if (!existsSync(datei)) {
      console.log('\n  (keine Grundlage vorhanden - mit --neu anlegen)')
    } else {
      const grund = JSON.parse(readFileSync(datei, 'utf8'))
      const tol = grund.toleranzMs ?? 700
      const fuerGeraet = (grund.geraete || {})[geraet || 'unbekannt']
      if (!fuerGeraet) {
        console.log(`\n  (keine Grundlage fuer dieses Geraet: ${geraet || 'unbekannt'})`)
        console.log('   Mit --neu anlegen. Werte von einem ANDEREN Geraet werden')
        console.log('   bewusst nicht herangezogen - ein Pi 4 ist kein Pi 5.')
        ws.close()
        process.exitCode = langsam ? 1 : 0
        throw new Error('__fertig__')
      }
      grund.messwerte = fuerGeraet.messwerte
      const abweichungen = []
      for (const [was, sollMs] of Object.entries(grund.messwerte.weg || {})) {
        const ist = messwerte.weg[was]
        if (sollMs === null) continue
        if (ist === null) {
          abweichungen.push(`${was}: nicht erreicht (frueher ${(sollMs / 1000).toFixed(2)} s)`)
          continue
        }
        if (ist > sollMs + tol)
          abweichungen.push(`${was}: ${(ist / 1000).toFixed(2)} s statt ${(sollMs / 1000).toFixed(2)} s`)
      }
      console.log(`\n  Vergleich mit der Grundlage (Toleranz ${(tol / 1000).toFixed(1)} s):`)
      if (!abweichungen.length) console.log('  alles im Rahmen')
      else {
        for (const a of abweichungen) console.log(`  LANGSAMER  ${a}`)
        langsam += abweichungen.length
      }
    }
  }

  process.exitCode = langsam ? 1 : 0
  ws.close()
} catch (e) {
  // "__fertig__" ist kein Fehler, sondern der geordnete Ausstieg oben.
  if (e.message !== '__fertig__') {
    console.log(`  FEHLER: ${e.message}`)
    process.exitCode = 1
  }
} finally {
  await brw.schliessen()
}

// AUFRAEUMEN: dieser Test laesst die Box tief in der Bibliothek stehen. Der
// Weg ist derselbe, den die Box ohnehin geht (sie fragt einmal je Minute nach
// ihrem Stand und laedt bei einer Aenderung neu) - kein F5 von aussen, kein
// Kiosk-Neustart. Schlaegt es fehl, ist das kein Testfehler: gemessen wurde
// trotzdem richtig.
try {
  // ADRESSE BEWUSST NEU BAUEN: die Oberflaeche laeuft ueber https auf 8443,
  // die API ueber PLAIN http auf 8200. Ein blosses Ersetzen des Ports ergab
  // 'https://box:8200' - das warf, der catch schluckte es, und das Aufraeumen
  // blieb still aus. Ein stiller Fehlschlag ist schlimmer als gar keiner.
  const api = `http://${new URL(ZIEL).hostname}:8200/api/oberflaeche/neuladen`
  const a = await fetch(api, { method: 'POST' })
  console.log(
    a.ok
      ? '  Aufgeraeumt: die Box laedt ihre Oberflaeche neu'
      : `  Aufraeumen fehlgeschlagen (HTTP ${a.status}) - die Box bleibt stehen, wo sie ist`,
  )
} catch (e) {
  // Kein Testfehler: gemessen wurde trotzdem richtig. Aber sichtbar.
  console.log(`  Aufraeumen nicht moeglich: ${e?.message || e}`)
}
