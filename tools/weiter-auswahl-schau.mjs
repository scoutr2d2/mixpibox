/**
 * WAS ZEIGT DIE WEITERHOEREN-REIHE IN WELCHEM ZUSTAND?
 *
 * WOFUER: Der gemeldete Fehler lautet „ich bin im Hoerspiel und sehe ‚Die
 * Zukunft wird gross'" — ein Musiktitel in einer Auswahl, die mit Musik
 * nichts zu tun hat. Ob das stimmt und WO es stimmt, laesst sich am Quelltext
 * nicht ablesen: „in etwas drin sein" gibt es in dieser Oberflaeche in fuenf
 * verschiedenen Bauarten, und jede haengt an einem anderen Stueck Zustand
 * (`werke.kategorie`, `regalOffen`, `lane`, `interpretOffen`). Deshalb wird
 * hier GETIPPT und abgelesen, statt gelesen und geraten.
 *
 * WAS ES AENDERT: nichts. Es startet einen eigenen Browser gegen die VORSCHAU
 * (tools/neu-vorschau.mjs) und liest das DOM. Weder die Box noch Dateien
 * werden angefasst.
 *
 * AUFRUF
 *     node tools/weiter-auswahl-schau.mjs            # Tabelle je Zustand
 *     node tools/weiter-auswahl-schau.mjs --pruefen  # Ende 1 bei Abweichung
 *
 * DIE ERWARTUNG WIRD NICHT AUS app.js ABGELESEN, sondern aus den Antworten
 * der Attrappe zweitgerechnet: `/api/werke` sagt, welches Werk in welche
 * Kategorie und zu welchem Interpreten gehoert, `/api/weiterhoeren` sagt,
 * welche Stellen es gibt. Wer die Erwartung aus der Oberflaeche nimmt, prueft
 * seine eigene Vermutung.
 *
 * DIE FALLE, die diese Messung ueberhaupt erst moeglich gemacht hat:
 * `/api/weiterhoeren` der Vorschau lieferte bis 02.08.2026 AUSSCHLIESSLICH
 * `audiobook`-Zeilen. Gegen so eine Attrappe gemessen, sieht jede noch so
 * kaputte Filterregel richtig aus — der Fall, um den es geht, entsteht gar
 * nicht ([attrappe-luegt-durch-weglassen]).
 */
import WebSocket from 'ws'
import { LICHT_STELLEN_JS } from './licht-weg.mjs'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** Beruehrziel-Untergrenze: 800x480 sind 0,14 mm/px, 64 px sind 9 mm (ISO 9241-411). */
const ZIEL_PX = 64

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
// wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
// eine Vorschau, die jemand anders verstellt hat. Und der eigene Browser
// laeuft auf einem FREIEN Port mit eigenem Profil statt auf einer festen
// Nummer, die ein Ueberlebender eines harten Abbruchs noch halten koennte —
// `/json/list` liefert dann klaglos die Ziele des fremden.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

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

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Der normalisierte Kern eines Namens — wie `kern()` in der Vorschau. */
const kern = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

let fehler = 0
const melde = (zeile) => {
  fehler++
  console.error(`  FEHLER  ${zeile}`)
}

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // ── Was die Seite dabei auf die Konsole schreibt ────────────────────────
  //
  // WOFUER: Auf der Box gibt es keine Konsole. Eine Warnung, die hier
  // nebenbei auffaellt, faellt dort NIE auf — und ein `TypeError` in
  // `weiterZeichnen` sieht am Bildschirm genauso aus wie „es gibt eben nichts
  // weiterzuhoeren": die Reihe ist weg. Genau diese beiden Zustaende sind von
  // aussen nicht zu unterscheiden, deshalb wird hier mitgelesen.
  // IN try/catch, und das ist kein Zierrat: Ein Wurf in einem
  // 'message'-Zuhoerer beendet den ganzen Node-Lauf, und die Meldung zeigte
  // dann auf diese Zeile statt auf die Oberflaeche — dieselbe Sorte
  // Falschmeldung wie bei [klammerzaehler-liest-kommentare-mit].
  const laut = []
  ws.on('message', (r) => {
    try {
      const x = JSON.parse(r)
      const t = x?.params?.type
      if (x?.method === 'Runtime.consoleAPICalled' && (t === 'error' || t === 'warning')) {
        laut.push(`${t}: ${(x.params.args || []).map((a) => a?.value ?? a?.description ?? '?').join(' ')}`)
      }
      if (x?.method === 'Runtime.exceptionThrown') {
        const d = x.params?.exceptionDetails
        laut.push(`Ausnahme: ${d?.exception?.description || d?.text || '?'}`)
      }
    } catch {
      /* kein JSON — nichts, was diese Messung anginge */
    }
  })

  // ── Die zweite Meinung: was SOLL in welcher Auswahl stehen? ─────────────
  //
  // MIT `?max=20` GEFRAGT, NICHT OHNE. Die Erwartung muss von ALLEN Stellen
  // ausgehen, die es gibt — sonst uebernimmt sie stillschweigend denselben
  // Deckel wie die Seite und kann ihn nie als Fehler melden. Genau daran ging
  // der erste Entwurf dieses Werkzeugs vorbei (02.08.2026): Er fragte ohne
  // `max`, bekam von der damaligen Attrappe zufaellig alles und haette an der
  // Box nie bemerkt, dass die Seite mit `?max=6` Zeilen gar nicht erst sieht.
  // 20 ist die Obergrenze des Servers.
  const werke = (await (await fetch(new URL('/api/werke', ZIEL))).json()).werke
  const stellen = (await (await fetch(new URL('/api/weiterhoeren?max=20', ZIEL))).json()).weiter
  const werkVon = new Map(werke.map((w) => [w.schluessel, w]))
  // Eine Zeile ohne `schluessel` gehoert zu etwas, das aus der Bibliothek
  // genommen wurde — sie darf NIRGENDS stehen, auch nicht in der Uebersicht.
  const startbar = stellen.filter((z) => z.schluessel && werkVon.has(z.schluessel))

  /** Wie viele Kacheln die Reihe hoechstens zeigt (WEITER_ANZAHL in app.js).
   *  Die Zahl gehoert in die ERWARTUNG, denn sie ist Teil der Regel: erst
   *  filtern, DANN schneiden — nicht umgekehrt. Fuenf und nicht sechs, weil
   *  sechs bei 800 px um genau eine Luecke zu breit sind; die Zeile „Volle
   *  Reihe bei 800 px" weiter unten misst das nach. */
  const ANZEIGE = 5

  /** Die erwarteten Titel fuer eine Auswahl. `null` = keine Auswahl (alles). */
  const erwartet = (pruefung) =>
    startbar
      .filter((z) => (pruefung ? pruefung(werkVon.get(z.schluessel)) : true))
      .slice(0, ANZEIGE)
      .map((z) => z.titel)

  await send(ws, 'Page.navigate', { url: ZIEL })
  await warte(2500)

  /** Was steht gerade da? */
  const ablesen = () =>
    ev(`(() => {
      const k = document.getElementById('weiter')
      const kachel = document.querySelector('#weiter-reihe .weiter-kachel')
      const r = kachel ? kachel.getBoundingClientRect() : null
      // NUR WAS SICHTBAR IST ZAEHLT. Die Reihe wird ueber das hidden-Attribut
      // ausgeblendet, ohne ihre Kacheln wegzuraeumen — wer sie trotzdem
      // aufzaehlt, misst Leichen und meldet einen Fehler, wo keiner ist.
      // Genau darauf ist der erste Lauf dieses Werkzeugs hereingefallen.
      // (KEINE Schraegstrich-Anfuehrung hier: der Ausdruck steht in einem
      //  Vorlagenliteral, ein Rueckstrich beendete es mitten im Satz.)
      return {
        versteckt: !!k.hidden,
        kopf: (document.getElementById('weiter-kopf').textContent || '').trim(),
        titel: k.hidden
          ? []
          : [...document.querySelectorAll('#weiter-reihe .weiter-kachel .weiter-titel')].map((e) => e.textContent.trim()),
        breite: r ? Math.round(r.width) : 0,
        hoehe: r ? Math.round(r.height) : 0,
        // PASST DIE VOLLE REIHE OHNE ROLLEN? Sechs Kacheln nebeneinander sind
        // die Behauptung an WEITER_ANZAHL in app.js; gezeigt wurden bis zum
        // 02.08.2026 in der Praxis weniger, weil der Deckel vor den Sieben
        // stand. Seit sie wirklich sechs sein koennen, gehoert die Behauptung
        // gemessen — auf 800 px ist ein waagerechter Rollbalken kein
        // Bedienelement, das ein Kind findet.
        // (KEINE Rueckstriche in diesem Kommentar: er steht in einem
        //  Vorlagenliteral, siehe die Warnung ein Stueck weiter unten.)
        rollt: (() => {
          const reihe = document.getElementById('weiter-reihe')
          return reihe.scrollWidth > reihe.clientWidth + 1
        })(),
        lane: !!document.querySelector('#raster > .lane'),
        interpret: !document.getElementById('interpret').hidden,
        regal: !document.getElementById('regal-kopf').hidden,
      }
    })()`)

  /** Zurueck auf die Uebersicht: Kategorie „Alles", kein Regal, keine Lane. */
  const uebersicht = async () => {
    await ev(`document.querySelectorAll('#leiste .kat')[0].click(), true`)
    await warte(400)
  }

  const kategorie = async (i) => {
    await ev(`document.querySelectorAll('#leiste .kat')[${i}].click(), true`)
    await warte(400)
  }

  /** Auf die Kachel mit diesem Titel tippen (im Raster). */
  const tippen = async (titel) => {
    const traf = await ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .kachel')]
        .find((e) => (e.querySelector('.kachel-titel')||{}).textContent === ${JSON.stringify(titel)})
      if (!k) return false
      k.click()
      return true
    })()`)
    if (!traf) throw new Error(`keine Kachel „${titel}" im Raster — Vorschau geaendert?`)
    await warte(1200)
  }

  const zeigen = (name, s, soll) => {
    const ist = [...s.titel].sort()
    const erw = [...soll].sort()
    const gleich = JSON.stringify(ist) === JSON.stringify(erw)
    const wie = s.versteckt ? '(Reihe ausgeblendet)' : s.titel.length ? s.titel.join(', ') : '(leer)'
    console.log(`  ${name.padEnd(26)} ${wie}`)
    if (!gleich) {
      console.log(`  ${''.padEnd(26)} erwartet: ${erw.length ? erw.join(', ') : '(nichts)'}`)
    }
    return gleich
  }

  console.log(`\nWEITERHOEREN je Zustand  (${ZIEL})\n`)

  // 1. UEBERSICHT — nichts eingeschraenkt, alles darf stehen.
  await uebersicht()
  let s = await ablesen()
  if (!zeigen('Uebersicht (Alles)', s, erwartet(null))) melde('Uebersicht zeigt nicht alle Stellen')
  if (s.versteckt) melde('Uebersicht: die Reihe ist ausgeblendet, obwohl es Stellen gibt')
  console.log(
    `  ${'Volle Reihe bei 800 px'.padEnd(26)} ${s.titel.length} Kacheln, ${s.rollt ? 'ROLLT WAAGERECHT' : 'passt'}`,
  )
  if (s.rollt) melde(`${s.titel.length} Kacheln passen nicht nebeneinander — WEITER_ANZAHL zu gross?`)
  const kopfUebersicht = s.kopf
  if (s.titel.length && (s.breite < ZIEL_PX || s.hoehe < ZIEL_PX)) {
    melde(`Weiterhoeren-Kachel ${s.breite}x${s.hoehe} px — unter ${ZIEL_PX} px (ISO 9241-411)`)
  } else if (s.titel.length) {
    console.log(`  ${'Beruehrziel Kachel'.padEnd(26)} ${s.breite}x${s.hoehe} px`)
  }

  // 1b. DASSELBE IM DUNKELN. Die Anordnung haengt nicht am Licht, aber genau
  //     das ist die Behauptung — und eine unbelegte Behauptung ueber
  //     Beruehrziele ist auf einem 800x480-Schirm zu teuer.
  //     HIER STAND `document.getElementById('licht-knopf').click()` — der Mond
  //     in der Kopfzeile. Er ist am 07.08.2026 entfallen; der einzige Schalter
  //     steht im Admin-Menue unter Darstellung -> Farbe und Form. Stehen-
  //     geblieben haette die Zeile geworfen und dieses Werkzeug haette die
  //     HELLE Kachel gemessen und „dunkel" darueber geschrieben.
  //     Gemessen wird die KACHEL im Dunkeln, nicht der Schalter — deshalb der
  //     Stand von aussen (tools/licht-weg.mjs) und nicht der Weg ins Menue,
  //     der die Startseite abraeumte. Den Schalter prueft
  //     tools/licht-weg-probe.mjs.
  if (!(await ev(LICHT_STELLEN_JS('dunkel')))) melde('der dunkle Stand liess sich nicht setzen')
  await warte(300)
  const dunkel = await ablesen()
  console.log(`  ${'Beruehrziel dunkel'.padEnd(26)} ${dunkel.breite}x${dunkel.hoehe} px`)
  if (dunkel.titel.length && (dunkel.breite < ZIEL_PX || dunkel.hoehe < ZIEL_PX)) {
    melde(`Weiterhoeren-Kachel im Dunkeln ${dunkel.breite}x${dunkel.hoehe} px — unter ${ZIEL_PX} px`)
  }
  if (JSON.stringify(dunkel.titel) !== JSON.stringify(s.titel)) melde('im Dunkeln steht etwas anderes da')
  await ev(LICHT_STELLEN_JS('hell'))
  await warte(300)

  // 2. DIE KATEGORIEN — die Reihenfolge steht in app.js (KATEGORIEN).
  const KAT = [
    { i: 1, id: 'music', name: 'Kategorie Musik' },
    { i: 2, id: 'audiobook', name: 'Kategorie Hoerbuch' },
    { i: 3, id: 'other', name: 'Kategorie Radio' },
  ]
  for (const k of KAT) {
    await kategorie(k.i)
    s = await ablesen()
    const soll = erwartet((w) => w.kategorie === k.id)
    if (!zeigen(k.name, s, soll)) melde(`${k.name}: die Reihe passt nicht zur Auswahl`)
    if (!soll.length && !s.versteckt) melde(`${k.name}: leere Reihe steht da, statt wegzufallen`)
    if (s.kopf !== kopfUebersicht) console.log(`  ${''.padEnd(26)} Ueberschrift: „${s.kopf}"`)
  }

  // 3. DAS REGAL — „Kiddinx" traegt zwei Werke, daraus baut die Seite eines.
  await uebersicht()
  await ev(`(() => {
    const k = [...document.querySelectorAll('#raster > .kachel.regal')]
      .find((e) => (e.querySelector('.kachel-titel')||{}).textContent === 'Kiddinx')
    if (k) k.click()
    return !!k
  })()`)
  await warte(600)
  s = await ablesen()
  if (!s.regal) melde('Regal „Kiddinx" liess sich nicht oeffnen — Vorschau geaendert?')
  if (
    !zeigen(
      'Regal Kiddinx',
      s,
      erwartet((w) => w.interpretSchluessel === kern('Kiddinx')),
    )
  ) {
    // NICHT „zeigt Werke anderer Interpreten": Die Abweichung geht in BEIDE
    // Richtungen, und die teurere war zu WENIG (der zweite „Kiddinx" fiel dem
    // Sechser-Fenster zum Opfer). Eine Meldung, die nur eine Richtung nennt,
    // schickt den Leser in die falsche Ecke.
    melde('Regal: die Reihe passt nicht zur Auswahl')
  }

  // 3b. WIRKT DER WECHSEL SOFORT? OHNE JEDE WARTEZEIT GEMESSEN.
  //
  // WOFUER: `sichtbarerTakt(TAKT_WEITER)` laeuft alle 60 Sekunden. Wuerde die
  // Reihe erst dort nachziehen, zeigte sie bis zu eine Minute lang die
  // Auswahl von VORHER — und ein Kind, das links auf „Musik" tippt und oben
  // weiter Hoerspiele sieht, lernt, dass die Leiste nichts bewirkt.
  //
  // DIE MESSUNG BRAUCHT DESHALB KEIN `warte()`: Tipp und Ablesen stehen in
  // EINEM Ausdruck. Was danach dasteht, ist synchron entstanden (der Klick
  // ruft `zeichnen()`, das ruft `weiterZeichnen()`) — kaeme es aus dem Takt
  // oder aus einem Netzabruf, staende hier noch das Alte.
  await uebersicht()
  const sofort = await ev(`(() => {
    document.querySelectorAll('#leiste .kat')[1].click()
    const k = document.getElementById('weiter')
    return k.hidden
      ? []
      : [...document.querySelectorAll('#weiter-reihe .weiter-kachel .weiter-titel')].map((e) => e.textContent.trim())
  })()`)
  const sollSofort = erwartet((w) => w.kategorie === 'music')
  console.log(`  ${'Wechsel ohne Wartezeit'.padEnd(26)} ${sofort.length ? sofort.join(', ') : '(leer)'}`)
  if (JSON.stringify([...sofort].sort()) !== JSON.stringify([...sollSofort].sort())) {
    melde(`Kategoriewechsel wirkt nicht sofort — erst spaeter: ${sollSofort.join(', ')}`)
  }

  // 4. DIE AUFGEKLAPPTE LANE — eine Playlist zerlegt sich in Alben.
  //
  // ERWARTUNG: UNVERAENDERT gegenueber der Uebersicht. Die Lane haengt IM
  // Raster und ERWEITERT es; die Kacheln daneben stehen alle noch da. Es ist
  // also keine engere Auswahl, und die Reihe darf sich nicht so benehmen, als
  // waere es eine.
  await uebersicht()
  const vorLane = await ablesen()
  await tippen('Das Pummeleinhorn')
  s = await ablesen()
  if (!s.lane) melde('die Lane ging nicht auf — Vorschau geaendert?')
  if (!zeigen('Lane offen (Playlist)', s, vorLane.titel)) {
    melde('Lane: die Reihe hat sich veraendert, obwohl das Raster dasselbe zeigt')
  }

  // 5. DIE INTERPRETENSEITE — sie ERSETZT die Startseite.
  await uebersicht()
  await ev(`document.getElementById('leute').hidden = false, true`)
  for (let i = 0; i < 40 && !(await ev(`document.querySelectorAll('#leute-reihe .leute-kachel').length`)); i++) {
    await warte(250)
  }
  await ev(`document.querySelector('#leute-reihe .leute-kachel').click(), true`)
  await warte(1500)
  s = await ablesen()
  if (!s.interpret) melde('die Interpretenseite ging nicht auf — Vorschau geaendert?')
  console.log(`  ${'Interpretenseite'.padEnd(26)} ${s.versteckt ? '(Reihe ausgeblendet)' : s.titel.join(', ')}`)
  if (!s.versteckt) melde('Interpretenseite: die Reihe steht da, obwohl die Seite die Startseite ersetzt')

  // 6. OHNE MEDIENLISTE — der Fall, fuer den der Rueckfall gebaut ist.
  //
  // /api/werke antwortet mit 500. Dann gibt es keine Auswahl, gegen die sich
  // vergleichen liesse. Die Reihe kommt aus einer ANDEREN Datei und muss
  // trotzdem dastehen: sonst nimmt eine haengende Medienliste dem Kind
  // ausgerechnet den einen Weg, der noch funktioniert.
  await (await fetch(new URL('/vorschau/kaputt', ZIEL))).text()
  await send(ws, 'Page.navigate', { url: ZIEL })
  await warte(2500)
  s = await ablesen()
  if (!zeigen('Medienliste kaputt (500)', s, erwartet(null))) {
    melde('ohne Medienliste faellt die Reihe weg, statt alles zu zeigen')
  }
  await (await fetch(new URL('/vorschau/voll', ZIEL))).text()

  // 6b. EIN NEUAUFBAU DES RASTERS MUSS DIE LANE SCHLIESSEN, NICHT WEGWERFEN.
  //
  // WOFUER: `laneEinhaengen` setzt `platzBeimBlaettern.sperren(true)`, und
  // `sperren(false)` steht AUSSCHLIESSLICH in `laneSchliessen()`. Leert
  // `zeichnen()` das Raster, ohne vorher zu schliessen, verschwindet die Lane
  // zwar vom Bildschirm — die Sperre bleibt. Von da an faehrt die Kopfleiste
  // beim Blaettern nicht mehr ein und nimmt dem Raster auf 480 px dauerhaft
  // ihre Hoehe. Das ist [60-sekunden-takt-raeumt-die-lane-weg]; am 02.08.2026
  // wurden drei Aufrufer versorgt, `werkeHolen` als vierter nicht — und der
  // hat mit 15 Sekunden den schnellsten Takt von allen.
  //
  // GEMESSEN WIRD DIE WIRKUNG, NICHT DAS FELD: `gesperrt` liegt in der IIFE
  // und ist von aussen nicht lesbar. Sichtbar ist die Klasse `platz-machen`
  // am <body> — sie kommt genau dann, wenn ein Rollereignis durchkommt.
  await (await fetch(new URL('/vorschau/mit-cover', ZIEL))).text()
  await send(ws, 'Page.navigate', { url: ZIEL })
  await warte(2500)
  await tippen('Das Pummeleinhorn')
  if (!(await ev(`!!document.querySelector('#raster > .lane')`))) {
    melde('Lane ging fuer die Sperr-Messung nicht auf — Vorschau geaendert?')
  }
  // Die Medienliste aendern: der Fingerabdruck wird anders, und der
  // 15-Sekunden-Takt baut das Raster neu. Genau dabei geht die Lane verloren.
  await (await fetch(new URL('/vorschau/ohne-cover', ZIEL))).text()
  let weg = false
  for (let i = 0; i < 36 && !weg; i++) {
    await warte(600)
    weg = !(await ev(`!!document.querySelector('#raster > .lane')`))
  }
  if (!weg) {
    melde('das Raster wurde in 21 s nicht neu gebaut — TAKT_WERKE oder der Stand der Vorschau geaendert?')
  } else {
    // Jetzt blaettern. Ohne `laneSchliessen()` im Neuaufbau bleibt die Sperre
    // stehen und `platz-machen` kommt NIE.
    await ev(`document.getElementById('buehne').scrollTop = 0, true`)
    await warte(900) // die 700 ms blinde Zeit aus `eigeneAenderung` abwarten
    await ev(
      `(() => { const b = document.getElementById('buehne'); b.scrollTop = 220; b.dispatchEvent(new Event('scroll')) })()`,
    )
    await warte(400)
    const faehrt = await ev(`document.body.classList.contains('platz-machen')`)
    console.log(`  ${'Kopfleiste nach Neuaufbau'.padEnd(26)} ${faehrt ? 'faehrt ein' : 'BLEIBT STEHEN'}`)
    if (!faehrt) melde('nach einem Raster-Neuaufbau bleibt platzBeimBlaettern gesperrt (Lane weggeworfen)')
  }
  await (await fetch(new URL('/vorschau/mit-cover', ZIEL))).text()

  // 7. WAS DIE SEITE DABEI GESAGT HAT. Auf 800x480 gibt es keine Konsole;
  //    eine Warnung, die hier durchgeht, sieht dort niemand mehr.
  console.log(`  ${'Konsole (Warnung/Fehler)'.padEnd(26)} ${laut.length ? laut.join(' | ') : '(nichts)'}`)
  for (const z of laut) melde(`Konsolenmeldung: ${z}`)

  ws.close()
} catch (e) {
  console.error(`  ABBRUCH ${e.message}`)
  fehler++
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log(fehler ? `\n${fehler} Abweichung(en).` : '\nDie Reihe folgt ueberall der Auswahl.')
process.exit(PRUEFEN && fehler ? 1 : 0)
