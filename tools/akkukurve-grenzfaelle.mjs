#!/usr/bin/env node
/**
 * DIE AKKUKURVE AN IHREN RAENDERN — die Faelle, die die Attrappe nicht stellt.
 *
 * ══ WARUM NEBEN tools/akkukurve-schau.mjs NOCH EINES ═══════════════════════
 *
 * `akkukurve-schau.mjs` misst die Kurve gegen die fuenf Lagen, die
 * `tools/neu-vorschau.mjs` bauen kann (voll, flach, duenn, leer, fehlt). Das
 * ist richtig und es ist gruen. Nur entscheidet damit die ATTRAPPE, welche
 * Faelle geprueft werden — und ihre eine Luecke (23:10 bis 06:50) hat auf
 * BEIDEN Seiten „Ruhe" stehen: vor dem Ausschalten haengt die Box voll am
 * Netz (i = +6 mA), nach dem Einschalten immer noch (i = +5 mA). Ruhe-
 * Abschnitte zeichnet die Oberflaeche gar nicht.
 *
 * DIE FRAGE, DIE DAMIT UNGESTELLT BLEIBT: Was tut das BAND, wenn links und
 * rechts der Luecke DASSELBE steht — etwa „entladen", weil das Kind abends
 * bis zum Umfallen gehoert hat und die Box am naechsten Morgen ohne Netzteil
 * wieder angeht? Der Server bildet seine Abschnitte allein aus dem VORZEICHEN
 * des Stroms (`abschnitte` in akkuverlauf.ts, `artVon`); eine Luecke in der
 * Zeit kennt er nicht. Zwei Laeufe mit gleichem Vorzeichen verschmelzen zu
 * EINEM Abschnitt, dessen `von` vor und dessen `bis` hinter der Nacht liegt.
 *
 * Die LINIE wird an der Luecke sauber unterbrochen — das misst Fall 2
 * drueben. Das BAND wird es nicht: es kommt aus `v.abschnitte` und nicht aus
 * den Stuecken. Und weil es NACH der Schraffur gezeichnet wird, deckt es sie
 * auch noch zu.
 *
 * Dieses Werkzeug stellt die Lagen deshalb SELBST, indem es `fetch` in der
 * Seite umlenkt — die Attrappe bleibt unberuehrt, es wird ihr nichts gestellt
 * und nichts zurueckgegeben ([[vorschau-wird-geliehen]]).
 *
 * ══ WAS ES PRUEFT ══════════════════════════════════════════════════════════
 *   1  Luecke mit GLEICHER Art auf beiden Seiten — luegt das Band?
 *   2  Ein einziger Messpunkt
 *   3  Zwei Punkte, Tage auseinander
 *   4  Der Sprung (Akku getauscht) — 18 % auf 97 % in einer Minute
 *   5  Werte ueber 100 und unter 0
 *   6  „laedt" der Kopfzeile gegen „laden" des Bandes — zwei Quellen
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Reines Messen im Browser.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/akkukurve-grenzfaelle.mjs --ziel http://127.0.0.1:9725/neu/
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = typeof opt('ziel', null) === 'string' ? opt('ziel') : argv.find((a) => a.startsWith('http')) || null

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let fehler = 0
const ja = (gut, satz, dazu = '') => {
  if (!gut) fehler++
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${satz}${dazu ? `  — ${dazu}` : ''}`)
}

let vorschau = null
let ZIEL = MITGEGEBEN
process.on('exit', () => {
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
})

if (!ZIEL) {
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], { cwd: WURZEL, stdio: 'ignore' })
  vorschau.unref()
  const bis = Date.now() + 10000
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
}
console.log(`\nZIEL: ${ZIEL}${vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'}\n`)

let lfd = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — nichts gemessen')
  process.exit(1)
}

let ws = null
try {
  ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // DER BROWSERSPEICHER WIRD ABGESCHALTET. `index.html` bekommt zwar ein
  // `?frisch=…` mit, `app.js` aber nicht — die Datei haengt ohne Fingerabdruck
  // in der Seite. Ohne diese Zeile misst man die Datei von vorhin gegen den
  // Quelltext von jetzt, und der Fehler steht an einer Zeilennummer, die es
  // im Baum gar nicht mehr gibt. Genau das ist hier einmal passiert.
  await send(ws, 'Network.enable')
  await send(ws, 'Network.setCacheDisabled', { cacheDisabled: true })
  // UND JEDER FEHLER DER SEITE WIRD LAUT. Eine Ausnahme in `akkuKurveBauen`
  // hinterlaesst sonst nur eine fehlende Zeichenflaeche, und das Werkzeug
  // meldete „kein SVG" — der Satz einer leeren Lage, nicht der eines Absturzes.
  ws.on('message', (r) => {
    const x = JSON.parse(r)
    if (x.method === 'Runtime.exceptionThrown') {
      const d = x.params.exceptionDetails
      console.log(`      AUSNAHME IN DER SEITE: ${(d.exception && d.exception.description) || d.text}`.slice(0, 300))
    }
  })
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }

  /** Die Seite „Akku" aufschlagen — ueber die Tastatur, wie drueben. */
  const aufschlagen = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(1800)
    const ok = await ev(`(async () => {
      const w = document.getElementById('wappen')
      if (!w) return 'kein Wappen'
      w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise((r) => setTimeout(r, 1200))
      const g = [...document.querySelectorAll('#eltern-faecher button')].find((b) => b.textContent.trim() === 'System')
      if (!g) return 'keine Gruppe System'
      g.click()
      await new Promise((r) => setTimeout(r, 500))
      const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
        .find((x) => ((x.querySelector('.zeile-name') || {}).textContent || '') === 'Akku')
      if (!z) return 'keine Zeile Akku'
      ;(z.querySelector('button') || z).click()
      await new Promise((r) => setTimeout(r, 1500))
      return 'ok'
    })()`)
    if (ok !== 'ok') throw new Error(`Die Seite „Akku" liess sich nicht aufschlagen: ${ok}`)
  }

  /**
   * EINE ERFUNDENE ANTWORT UNTERSCHIEBEN — und die Seite neu zeichnen lassen.
   *
   * `fetch` wird in der Seite umgelenkt, danach der Kopfknopf getippt: er
   * ruft `akkuTat`, das `akkuHolen` nachzieht. Zweimal getippt steht der
   * Zeitraum wieder auf 24 Stunden — die Lage der Seite wird also
   * zurueckgelegt, auch wenn hier gemessen wird.
   */
  const unterschieben = async (nutzlast, mupihat = null) => {
    await ev(`(async () => {
      const n = ${JSON.stringify(JSON.stringify(nutzlast))}
      const h = ${JSON.stringify(JSON.stringify(mupihat))}
      if (!window.__echtesFetch) window.__echtesFetch = window.fetch.bind(window)
      window.fetch = (u, o) => {
        const s = String((u && u.url) || u)
        if (s.includes('/mupihat/verlauf')) return Promise.resolve(new Response(n, { status: 200, headers: { 'content-type': 'application/json' } }))
        if (h !== 'null' && /\\/mupihat(\\?|$)/.test(s)) return Promise.resolve(new Response(h, { status: 200, headers: { 'content-type': 'application/json' } }))
        return window.__echtesFetch(u, o)
      }
      document.getElementById('fach-tat').click()
      await new Promise((r) => setTimeout(r, 1400))
      return true
    })()`)
  }

  /** Alles, was das Bild gerade traegt — in EINEM Griff. */
  const lesen = async () =>
    await ev(`(() => {
      const svg = document.querySelector('svg.akku-kurve')
      const txt = (s) => [...document.querySelectorAll(s)].map((x) => x.textContent.trim())
      if (!svg) return {
        svg: false,
        stand: (document.querySelector('.akku-stand') || {}).textContent || '',
        unter: (document.querySelector('.akku-unter') || {}).textContent || '',
        hinweis: txt('.akku-hinweis'),
        fuss: txt('.akku-fuss'),
      }
      const z = (e) => Object.fromEntries([...e.attributes].map((a) => [a.name, a.value]))
      const luecken = [...svg.querySelectorAll('rect.akku-luecke')].map(z)
        .filter((r) => Number(r.y) > 100 && Number(r.y) < 160)   // nur der Bandstreifen
      const baender = [...svg.querySelectorAll('rect.akku-band')].map(z)
        .filter((r) => Number(r.y) > 100 && Number(r.y) < 160)   // nicht die Legende
      const zuege = [...svg.querySelectorAll('polyline.akku-linie')].map((e) =>
        e.getAttribute('points').trim().split(/\\s+/).map((p) => p.split(',').map(Number)))
      const punkte = [...svg.querySelectorAll('circle.akku-punkt')].map((e) =>
        [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))])
      return {
        svg: true,
        stand: (document.querySelector('.akku-stand') || {}).textContent || '',
        unter: (document.querySelector('.akku-unter') || {}).textContent || '',
        hinweis: txt('.akku-hinweis'),
        fuss: txt('.akku-fuss'),
        marke: svg.getAttribute('aria-label') || '',
        luecken, baender, zuege, punkte,
        achse: [...svg.querySelectorAll('text.akku-achszahl')].map((e) => e.textContent.trim()),
      }
    })()`)

  /** Ueberlappen zwei Strecken auf der X-Achse — und um wie viel? */
  const ueber = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))

  const T = Date.now()
  const STD = 3600000
  const MIN = 60000
  /** Eine Reihe bauen: von..bis in Minutenschritten, mit festem Strom/Stand. */
  const reihe = (vonMin, bisMin, i, pVon, pBis, schritt = 10) => {
    const raus = []
    const n = Math.max(1, Math.round((vonMin - bisMin) / schritt))
    for (let k = 0; k <= n; k++) {
      const t = T - (vonMin - (k * (vonMin - bisMin)) / n) * MIN
      raus.push({ t, v: 7600, i, p: Math.round(pVon + ((pBis - pVon) * k) / n) })
    }
    return raus
  }

  await aufschlagen()

  // ═════════════════════════════════════════════════════════════════════════
  //  1. DIE LUECKE MIT GLEICHER ART AUF BEIDEN SEITEN
  // ═════════════════════════════════════════════════════════════════════════
  // Abends bis 23:10 gehoert (entladen, 60 -> 22 %), Box aus, morgens 06:50
  // ohne Netzteil wieder an (entladen, 22 -> 12 %). Der Server bildet daraus
  // EINEN Abschnitt „entladen" von abends bis morgens, weil das Vorzeichen
  // des Stroms dasselbe ist. Die Nacht liegt mitten darin.
  console.log('══ 1. Luecke, links und rechts dasselbe Vorzeichen ══')
  {
    const vor = reihe(20 * 60, 8 * 60, -430, 60, 22) // vor 20 h bis vor 8 h
    const nach = reihe(1 * 60, 5, -410, 22, 12) // vor 1 h bis vor 5 min
    const punkte = [...vor, ...nach]
    const abschnitt = { art: 'entladen', von: vor[0].t, bis: nach[nach.length - 1].t, vonProzent: 60, bisProzent: 12, mA: -420 }
    await unterschieben({
      punkte,
      gesamt: punkte.length,
      abschnitte: [abschnitt],
      jetzt: punkte[punkte.length - 1],
      restMinuten: 90,
      kapazitaetMah: 8200,
      gelernt: { stand: 'brauchbar', rMilliOhm: 120 },
    })
    const b = await lesen()
    ja(b.svg, 'die Kurve steht')
    ja(b.zuege.length === 2, 'die LINIE ist an der Luecke unterbrochen', `${b.zuege.length} Zug/Zuege`)
    ja(b.luecken.length >= 1, 'es gibt eine Flaeche „keine Messwerte" im Bandstreifen', `${b.luecken.length}`)
    let schlimmster = 0
    for (const r of b.baender) {
      const bx1 = Number(r.x)
      const bx2 = bx1 + Number(r.width)
      for (const l of b.luecken) {
        const lx1 = Number(l.x)
        const lx2 = lx1 + Number(l.width)
        schlimmster = Math.max(schlimmster, ueber(bx1, bx2, lx1, lx2))
      }
    }
    ja(
      schlimmster < 1,
      'kein Lade-/Entladeband liegt ueber einer Flaeche ohne Messwerte',
      `groesste Ueberdeckung ${schlimmster.toFixed(1)} von 514 Einheiten`,
    )
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  2. EIN EINZIGER MESSPUNKT
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n══ 2. Ein einziger Messpunkt ══')
  {
    const p = { t: T - 3 * MIN, v: 7600, i: -400, p: 55 }
    await unterschieben({ punkte: [p], gesamt: 1, abschnitte: [], jetzt: p, restMinuten: null, kapazitaetMah: null, gelernt: { stand: 'nichts' } })
    const b = await lesen()
    ja(!b.svg, 'keine Zeichenflaeche, sondern ein Satz', b.hinweis.join(' | ').slice(0, 70))
    ja(/bisher einer/.test(b.hinweis.join(' ')), 'und er sagt „bisher einer" und nicht „1 Stück"')
    ja(!/\b0 min\b/.test(b.unter), 'die unbekannte Restzeit steht nicht als „0 min" da', b.unter.slice(0, 70))
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  3. ZWEI PUNKTE, TAGE AUSEINANDER
  // ═════════════════════════════════════════════════════════════════════════
  // Beide liegen im Bild, dazwischen liegen sechs Tage ohne Messwert. Eine
  // Linie von einem zum anderen waere die Behauptung einer Woche Verlauf aus
  // zwei Messungen.
  console.log('\n══ 3. Zwei Punkte, sechs Tage auseinander ══')
  {
    const a = { t: T - 6.5 * 24 * STD, v: 7600, i: -400, p: 90 }
    const z = { t: T - 5 * MIN, v: 7600, i: -400, p: 20 }
    await unterschieben({ punkte: [a, z], gesamt: 2, abschnitte: [], jetzt: z, restMinuten: 40, kapazitaetMah: 8200, gelernt: { stand: 'wenig' } })
    const b = await lesen()
    if (b.svg) {
      ja(b.zuege.length === 0, 'kein durchgehender Zug ueber die sechs Tage', `${b.zuege.length} Zug/Zuege`)
      ja(b.punkte.length === 2, 'die beiden Messungen stehen als PUNKTE da', `${b.punkte.length}`)
    } else {
      ja(true, 'gar keine Kurve — der Satz statt der Linie', b.hinweis.join(' | ').slice(0, 80))
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  4. DER SPRUNG — Akku getauscht
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n══ 4. Der Sprung (Akku getauscht) ══')
  {
    const vor = reihe(20 * 60, 12 * 60, -400, 40, 18)
    const nach = reihe(12 * 60 - 1, 5, -400, 97, 74)
    const punkte = [...vor, ...nach]
    await unterschieben({
      punkte,
      gesamt: punkte.length,
      abschnitte: [{ art: 'entladen', von: punkte[0].t, bis: punkte[punkte.length - 1].t, vonProzent: 40, bisProzent: 74, mA: -400 }],
      jetzt: punkte[punkte.length - 1],
      restMinuten: 200,
      kapazitaetMah: 8200,
      gelernt: { stand: 'brauchbar', rMilliOhm: 120 },
    })
    const b = await lesen()
    ja(b.svg, 'die Kurve steht auch beim Sprung')
    const alle = b.zuege.flat()
    const innen = alle.every(([x, y]) => y >= 9 && y <= 133)
    ja(innen, 'kein Punkt des Zuges liegt ausserhalb der Zeichenflaeche')
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  5. WERTE UEBER 100 UND UNTER 0
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n══ 5. Werte ueber 100 und unter 0 ══')
  {
    const punkte = reihe(20 * 60, 5, -400, 130, -20)
    await unterschieben({
      punkte,
      gesamt: punkte.length,
      abschnitte: [{ art: 'entladen', von: punkte[0].t, bis: punkte[punkte.length - 1].t, vonProzent: 130, bisProzent: -20, mA: -400 }],
      jetzt: punkte[punkte.length - 1],
      restMinuten: 10,
      kapazitaetMah: 8200,
      gelernt: { stand: 'brauchbar', rMilliOhm: 120 },
    })
    const b = await lesen()
    if (b.svg) {
      const alle = b.zuege.flat()
      ja(alle.every(([x, y]) => y >= 9 && y <= 133), 'die Linie bleibt in der Zeichenflaeche')
    }
    // DIE KURVE KLEMMT AUF 0..100 (`yVon`), DER SATZ NICHT. Beide stehen
    // uebereinander im selben Bild.
    ja(!/-\d+ %|1[0-9][0-9] %/.test(b.stand), 'der Satz nennt keinen Stand ausserhalb 0..100 %', b.stand.slice(0, 40))
    const bodenY = await ev(
      `(() => { const s = document.querySelector('svg.akku-kurve'); if (!s) return null
        const l = s.querySelector('polyline.akku-linie'); if (!l) return null
        const ys = l.getAttribute('points').trim().split(/\\s+/).map((p) => Number(p.split(',')[1]))
        return { min: Math.min(...ys), max: Math.max(...ys) } })()`,
    )
    if (bodenY) console.log(`      die Linie liegt zwischen y=${bodenY.min} und y=${bodenY.max} (0 % ist y=132, 100 % ist y=10)`)
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  6. ZWEI QUELLEN FUER „LAEDT"
  // ═════════════════════════════════════════════════════════════════════════
  // Der SATZ der Seite („88 % · lädt") entsteht aus dem STROM des letzten
  // Punktes (`akkuSatz`, Schwelle AKKU_RUHE_MA = 20 mA). Das ZEICHEN der
  // Kopfzeile (`hatHolen`, `#st-akku`) entsteht aus `Charger_Status` des
  // Treibers. Beide stehen auf dieser Seite GLEICHZEITIG am Schirm.
  //
  // DER FALL IST NICHT ERFUNDEN: „Trickle Charge" ist eine echte Ladephase
  // des Ladereglers (Vorladung eines tiefentladenen Packs), und sie fliesst
  // mit sehr kleinem Strom. Das Wort sagt „laden", die 15 mA sagen „Ruhe".
  //
  // BEIDE LESEN HIER DIESELBE ANTWORT: die Kopfzeile holt `/api/mupihat` alle
  // 30 s (TAKT_HAT) nach — es wird gewartet, bis sie es getan hat. Ohne das
  // Warten maesse man einen alten Wert gegen einen neuen und nicht zwei
  // Rechnungen gegeneinander.
  console.log('\n══ 6. Satz der Seite gegen Zeichen der Kopfzeile ══')
  {
    const punkte = reihe(20 * 60, 5, 15, 4, 6)
    const hat = { BatteryConnected: 1, Bat_SOC: '6%', Bat_SOC_fein: 6, Charger_Status: 'Trickle Charge', Vbat: 3100, Ibat: 15 }
    await unterschieben(
      {
        punkte,
        gesamt: punkte.length,
        abschnitte: [],
        jetzt: punkte[punkte.length - 1],
        restMinuten: null,
        kapazitaetMah: 8200,
        gelernt: { stand: 'brauchbar', rMilliOhm: 120 },
      },
      hat,
    )
    // Auf den Takt der Kopfzeile warten, damit BEIDE dieselbe Antwort lesen.
    await warte(32000)
    const b = await lesen()
    const kopfLaedt = /lädt/.test(b.stand)
    // `#st-akku` ist das Zeichen der KOPFZEILE — es steht auf der Akku-Seite
    // gleichzeitig am Schirm, keine drei Zentimeter ueber dem Satz.
    const oben = await ev(
      `(() => { const k = document.getElementById('st-akku'); if (!k || k.hidden) return null
        return { laedt: k.classList.contains('laedt'), titel: k.title || '', zahl: (document.getElementById('st-akku-zahl')||{}).textContent || '' } })()`,
    )
    console.log(`      Satz der Seite: „${b.stand}"   ·   Zeichen oben: ${oben ? (oben.laedt ? 'laedt' : 'laedt NICHT') + ` (${oben.zahl})` : 'nicht sichtbar'}`)
    ja(
      oben === null || kopfLaedt === oben.laedt,
      'Satz und Kopfzeichen sagen dasselbe ueber „laedt" — sie stehen gleichzeitig da',
      `Seite ${kopfLaedt ? 'laedt' : 'laedt nicht'} · Zeichen ${oben && oben.laedt ? 'laedt' : 'laedt nicht'}`,
    )
  }

  console.log(`\n${fehler === 0 ? 'ALLES GRUEN' : `${fehler} Aussage(n) halten NICHT`}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
}
process.exit(fehler === 0 ? 0 : 1)
