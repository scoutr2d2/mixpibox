#!/usr/bin/env node
/**
 * STEHT DIE MARKE „SPIELT GERADE" AUCH IM RASTER — und stoert sie dort nichts?
 *
 * WOFUER: Gemeldet am 03.08.2026 — „der playing indikator muss noch auf
 * oberster ebene sichtbar sein". Bis dahin trug nur eine Lane-Kachel die
 * Marke; im Raster sah man am Mini-Player, DASS etwas laeuft, aber nicht
 * WELCHE Kachel. Ob die Marke jetzt dasteht, ob sie an der RICHTIGEN Kachel
 * steht und ob sie in der Ecke etwas verdeckt, ist am Quelltext nicht
 * abzulesen — nur zu messen.
 *
 * DIE LANE-SEITE PRUEFT DIESES WERKZEUG NICHT. Das tun tools/lane-marken-
 * schau.mjs und tools/lane-marke-wandert.mjs, und beide muessen weiter gruen
 * sein: Raster und Lane teilen sich seit dem Umbau EINE Entscheidung
 * (`spieltMarkieren` in NewDesign/app.js). Wer nur die neue Seite misst,
 * bemerkt nicht, dass er die alte dabei kaputtgemacht hat.
 *
 * WAS ES AENDERT: nichts. Eigener Browser (headless) gegen tools/neu-
 * vorschau.mjs auf 127.0.0.1:8299. Die BOX wird NICHT angefasst, keine Datei
 * geschrieben (ausser `--bild`).
 *
 * ── WAS ES MISST ──────────────────────────────────────────────────────────
 *   0. QUELLTEXT, ohne Browser: Wird die Klasse `spielt` an genau EINER
 *      Stelle gesetzt? Zwei Stellen waeren der Anfang derselben Bauart, die
 *      beim Cover-Vollbild eingeholt hat [drei-orte-eine-anzeige].
 *   1. Kann die Attrappe ueberhaupt einen Zustand stellen, in dem ein Werk
 *      DES RASTERS laeuft? Ohne diese Frage vorweg misst man das Nichts und
 *      haelt es fuer ein Ergebnis [attrappe-luegt-durch-weglassen].
 *   2. Spotify spielt die Playlist „Bibi Blocksberg": Traegt die Kachel im
 *      Raster, die sie enthaelt (das Regal „Kiddinx"), die Marke — und nur
 *      sie?
 *   3. DIE ECKEN: Ueberschneidet die Marke die Dienst-Plakette (links unten),
 *      den Play-Knopf bzw. die Regal-Zahl (rechts unten), die Fehlt-Schaerpe
 *      (mittig)? Und liegt sie ganz innerhalb der Kachel?
 *   4. GEGENPROBE: mpv spielt ein lokales Hoerbuch, das niemand von dieser
 *      Seite aus gestartet hat -> KEINE Kachel darf behaupten, sie liefe.
 *      Danach dieselbe Kachel antippen -> jetzt darf genau sie es.
 *   5. ENDE DER WIEDERGABE: nichts laeuft mehr -> die Marke muss weg sein.
 *      Sie behauptet „GERADE", nicht „zuletzt".
 *   6. DIE BREMSEN, alle drei am selben Element: Bewegung normal,
 *      `body.ruhige-marke` still, `prefers-reduced-motion` still — und zwar
 *      OHNE eine zweite Fassung der Regeln fuers Raster.
 *
 * AUFRUF
 *     node tools/raster-marke-schau.mjs             # Tabelle
 *     node tools/raster-marke-schau.mjs --pruefen   # Ende 1 bei Abweichung
 *     node tools/raster-marke-schau.mjs --bild x.png
 */
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { LICHT_STELLEN_JS } from './licht-weg.mjs'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const BILD = (() => {
  const i = process.argv.indexOf('--bild')
  return i >= 0 ? process.argv[i + 1] || 'raster-marke.png' : null
})()

/** Die Spotify-Playlist, die die Vorschau unter der Lage `spotify` abspielt. */
const PLAYLIST = 'Bibi Blocksberg'
/** Das Regal, in dem sie im Raster steckt — „Bibi Blocksberg" und „Benjamin
 *  Bluemchen" haben denselben Interpreten (Kiddinx), und ab zwei Werken baut
 *  die Startseite ein Regal. Wer das uebersieht, sucht im Raster nach einer
 *  Kachel, die es dort gar nicht gibt. */
const REGAL = 'Kiddinx'
/** Das LOKALE Werk, das die Vorschau unter der Lage `spielt` ueber mpv abspielt. */
const LOKAL = 'Die Maus'

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => console.log(`  ${String(n).padEnd(36)} ${w}`)

// ═══════════════════════════════════════════════════════════════════════════
//  0. QUELLTEXT — die Frage, die ein Browser gar nicht stellen kann
// ═══════════════════════════════════════════════════════════════════════════
//
// EINE ANZEIGE, EIN SCHREIBER. Das Cover-Vollbild hatte drei Orte mit je
// eigenen Zuweisungen; zwei wurden nachgezogen, einer nicht, und aufgefallen
// ist es erst am Geraet [drei-orte-eine-anzeige]. Dieselbe Falle liegt hier:
// Raster und Lane stellen VERSCHIEDENE Fragen („laeuft aus diesem Werk etwas?"
// gegen „laeuft genau dieses Stueck?"), und es ist verfuehrerisch, dafuer zwei
// Schleifen zu schreiben. Die zweite laeuft dann irgendwann der ersten
// hinterher. Der Quelltexttest sagt es, BEVOR das passiert — ein
// Verhaltenstest bliebe gruen, solange beide Fassungen zufaellig einig sind.
console.log('\nRASTER-MARKE  (Quelltext)\n')
const appjs = readFileSync('NewDesign/app.js', 'utf8')
const schreiber = (appjs.match(/classList\.toggle\('spielt'/g) || []).length
zeile('setzt die Klasse `spielt`', `${schreiber} Stelle(n)`)
if (schreiber !== 1) melde(`die Klasse 'spielt' wird an ${schreiber} Stellen gesetzt — es darf genau eine sein`)

// UND DIE MARKE SELBST: `laufendMarke()` baut sie, und nur sie darf es. Eine
// zweite Figur fuer das Raster waere dieselbe Auskunft in zwei Handschriften —
// und die Bremsen (`prefers-reduced-motion`, `body.ruhige-marke`) haengen an
// der Klasse, nicht an der Figur; eine zweite Figur unter anderem Namen
// bekaeme sie stillschweigend nicht.
const marken = (appjs.match(/el\('div', 'spielt-marke'\)/g) || []).length
zeile('baut die Marke', `${marken} Stelle(n)`)
if (marken !== 1) melde(`die Marke wird an ${marken} Stellen gebaut — es darf genau eine sein`)

// DER ALTE NAME DARF NICHT MEHR WIRKEN. Bis 03.08.2026 hiess die Marke
// `.lane-laeuft`; im Raster waere der Name eine Luege. Gesucht wird die
// WIRKSAME Stelle, nicht das Wort: ein Selektor am Zeilenanfang in der CSS und
// eine Klassenzeichenkette in der JS. Der erste Anlauf verbot das Wort
// ueberhaupt und schlug prompt an — bei dem Kommentar, der die Umbenennung
// erklaert. Eine Pruefung, die die Begruendung ihrer selbst verbietet, ist
// keine Pruefung.
const appcss = readFileSync('NewDesign/app.css', 'utf8')
if (/^\s*[^\s*].*\.lane-laeuft/m.test(appcss)) {
  melde('in app.css steht noch eine Regel fuer `.lane-laeuft` — die Marke sitzt nicht mehr nur in der Lane')
}
if (/'lane-laeuft|"lane-laeuft/.test(appjs)) {
  melde('app.js baut noch eine Klasse `lane-laeuft` — die Marke sitzt nicht mehr nur in der Lane')
}

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
  console.log('\n  kein Browser gefunden — der Rest uebersprungen\n')
  process.exit(PRUEFEN && fehler ? 1 : 0)
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
const stellen = (was) => fetch(new URL(`/vorschau/${was}`, ZIEL)).then((a) => a.json())

/**
 * WAS TRAEGT IM RASTER EINE MARKE — und wo genau sitzt sie?
 *
 * DIE ECKEN WERDEN GERECHNET, NICHT ANGESEHEN. „Sieht gut aus" ist bei 6 px
 * Abstand keine Aussage; zwei Rechtecke, die sich schneiden, sind eine. Als
 * Nachbarn zaehlen alle Aufschriften, die es auf einer Kachel gibt — die
 * Dienst-Plakette, der Play-Knopf, die Regal-Zahl und die Fehlt-Schaerpe.
 *
 * (KEINE Rueckstriche und keine Backticks in diesem Block — er steht in einem
 *  Schablonenliteral und endete sonst mitten im Satz.)
 */
const LESEN = `(() => {
  const schnitt = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 0.5 && h > 0.5 ? { w: Math.round(w), h: Math.round(h) } : null
  }
  const NACHBARN = ['.kachel-marken', '.tipp-spiel', '.regal-zahl', '.kachel-fehlt', '.kachel-ersatz']
  const kacheln = [...document.querySelectorAll('#raster > .kachel')]
  const nimm = (k) => {
    const m = k.querySelector('.spielt-marke')
    const mr = m ? m.getBoundingClientRect() : null
    const kr = k.getBoundingClientRect()
    const bild = k.querySelector('.kachel-bild')
    const br = bild ? bild.getBoundingClientRect() : kr
    const st = m ? getComputedStyle(m) : null
    return {
      titel: (k.querySelector('.kachel-titel') || {}).textContent || '',
      klasse: k.classList.contains('spielt'),
      marke: !!m,
      kennung: k.dataset.spielt || '',
      mass: mr ? { w: Math.round(mr.width), h: Math.round(mr.height) } : null,
      // Liegt die Marke ganz im Bildkasten? Ein negativer Wert heisst: sie
      // ragt hinaus und wird beschnitten (die Kachel hat runde Ecken und
      // schneidet ab).
      innen: mr
        ? {
            links: Math.round(mr.left - br.left),
            oben: Math.round(mr.top - br.top),
            rechts: Math.round(br.right - mr.right),
            unten: Math.round(br.bottom - mr.bottom),
          }
        : null,
      farbe: st ? st.backgroundColor : '',
      // Der kleinste Abstand zu einem Nachbarn, und jede Ueberschneidung.
      nachbarn: mr
        ? NACHBARN.flatMap((s) =>
            [...k.querySelectorAll(s)].map((e) => {
              const r = e.getBoundingClientRect()
              const s2 = schnitt(mr, r)
              const dx = Math.max(0, Math.max(r.left - mr.right, mr.left - r.right))
              const dy = Math.max(0, Math.max(r.top - mr.bottom, mr.top - r.bottom))
              return { was: s, abstand: Math.round(Math.hypot(dx, dy)), schnitt: s2 }
            }),
          )
        : [],
      // Die Beschriftung faerbt mit — der zweite Traeger derselben Auskunft.
      titelfarbe: getComputedStyle(k.querySelector('.kachel-titel') || k).color,
    }
  }
  return {
    alle: kacheln.map((k) => (k.querySelector('.kachel-titel') || {}).textContent || ''),
    mitKennung: kacheln.filter((k) => k.dataset.spielt).length,
    markiert: kacheln.filter((k) => k.classList.contains('spielt') || k.querySelector('.spielt-marke')).map(nimm),
    // Die LANE-Seite darf dabei nicht verlorengehen; sie hat ihre eigenen
    // Werkzeuge, hier zaehlt nur, dass sie ueberhaupt noch mitgemalt wird.
    laneMarkiert: document.querySelectorAll('.lane-kachel.spielt').length,
  }
})()`

/** Tippt eine Raster-Kachel an, die so heisst. Gibt false, wenn es sie nicht gibt. */
/**
 * EIN WERK VON HIER AUS STARTEN.
 *
 * UEBER DEN PLAY-KNOPF, WO ES EINEN GIBT — nachgezogen am 31.08.2026 (E112).
 * Hier stand `k.click()` auf die Kachel, und bei „Die Maus" (einem lokalen
 * ALBUM) war das bis dahin dasselbe wie „starten". Seit E112 klappt eine
 * Album-Kachel ihre Titel auf; der Start wohnt in ihrem `.tipp-spiel`, wie
 * bei Playlist und ARD schon vorher. Ohne diese Zeile meldete die Gegenprobe
 * weiter unten „0 markierte Kacheln nach dem Tipp" — voellig richtig
 * gemessen, nur an einem Tipp, der gar nichts starten sollte.
 *
 * `knopf || k` UND KEINE FALLUNTERSCHEIDUNG NACH ART: Wo es keinen Knopf
 * gibt (Radio, RSS), startet die Kachel weiterhin selbst. Die Frage „womit
 * startet man das hier?" beantwortet damit der BAUM und nicht eine Liste in
 * diesem Werkzeug, die beim naechsten Umbau altert.
 */
const tippeQuell = (titel) => `(() => {
  const k = [...document.querySelectorAll('#raster > .kachel')]
    .find((e) => ((e.querySelector('.kachel-titel') || {}).textContent || '') === ${JSON.stringify(titel)})
  if (!k) return false
  const knopf = k.querySelector('.tipp-spiel')
  ;(knopf || k).click()
  return true
})()`

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

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
      /* kein JSON */
    }
  })

  // ── 1. KANN DIE ATTRAPPE DEN FALL UEBERHAUPT STELLEN? ──────────────────
  //
  // ZUERST, UND NICHT NEBENBEI. Wer gegen eine Vorschau misst, die kein Werk
  // des Rasters laufen laesst, sieht nie eine Marke und haelt das fuer ein
  // Ergebnis. Die Erwartung kommt deshalb aus der ATTRAPPE (welches Werk
  // traegt die Kennung aus context.uri?) und nicht aus app.js.
  console.log('\nRASTER-MARKE  (Vorschau, Fenster 800x480)\n')
  await stellen('voll')
  await stellen('spotify')
  const werke = (await (await fetch(new URL('/api/werke', ZIEL))).json()).werke
  const werk = werke.find((w) => w.titel === PLAYLIST)
  if (!werk) throw new Error(`„${PLAYLIST}" steht nicht in /api/werke — Vorschau geaendert?`)
  const zustandRoh = await (await fetch(new URL('/player/state', ZIEL))).json()
  const rohKontext = String(zustandRoh?.context?.uri || '')
  const kontextId = rohKontext.slice(rohKontext.lastIndexOf(':') + 1)
  const werkKennung = String((werk.quellen && werk.quellen[0] && werk.quellen[0].kennung) || '')
  zeile('Attrappe: context.uri', rohKontext || '— FEHLT —')
  zeile('Attrappe: Kennung von ' + PLAYLIST, werkKennung || '— FEHLT —')
  if (!kontextId || kontextId !== werkKennung) {
    melde('die Vorschau laesst KEIN Werk des Rasters laufen — ohne das prueft diese Messung das Nichts')
  }

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(3000)

  // ── 2. SPOTIFY LAEUFT: welche Raster-Kachel traegt die Marke? ──────────
  const sp = await ev(LESEN)
  zeile('Kacheln mit Kennung', `${sp.mitKennung} von ${sp.alle.length}`)
  zeile('markiert', sp.markiert.map((m) => `„${m.titel.trim()}"`).join(', ') || '— KEINE —')
  if (!sp.mitKennung) melde('keine einzige Raster-Kachel traegt `data-spielt` — die Marke kann nie erscheinen')
  if (sp.markiert.length !== 1) {
    melde(`${sp.markiert.length} markierte Raster-Kacheln statt genau einer`)
  } else if (sp.markiert[0].titel.trim() !== REGAL && sp.markiert[0].titel.trim() !== PLAYLIST) {
    melde(`markiert ist „${sp.markiert[0].titel.trim()}", laufen tut „${PLAYLIST}" (im Regal „${REGAL}")`)
  }

  const m = sp.markiert[0]
  if (m) {
    zeile('… Klasse und Marke zusammen', m.klasse && m.marke ? 'ja' : `Klasse=${m.klasse}, Marke=${m.marke}`)
    if (m.klasse !== m.marke) melde('Klasse `spielt` und eingehaengte Marke laufen auseinander')
    if (m.mass) zeile('… Groesse der Marke', `${m.mass.w}x${m.mass.h} px, ${m.farbe}`)
    // SEIT DEM LAUFENDEN RAHMEN (11.09.2026) IST DIE MARKE TOT GESTELLT
    // (app.css `.spielt-marke { display: none }`) — ihr Rect ist 0x0 bei
    // (0,0), und die Innenmessung meldete daraus zwei dauerrote „ragt
    // hinaus"-Zeilen fuer heilen Code. Die Frage stellt sich erst wieder mit
    // einem sichtbaren Traeger; der Rahmen liegt IM Bild (inset: 0) und kann
    // weder hinausragen noch etwas ueberdecken (tools/marke-tanzt.mjs misst
    // seine Bewegung).
    const marktTot = m.mass && m.mass.w === 0 && m.mass.h === 0
    if (marktTot) {
      zeile('… Luft im Bildkasten', '(Marke tot gestellt — der Rahmen liegt im Bild, Masse entfallen)')
    } else if (m.innen) {
      zeile(
        '… Luft im Bildkasten l/o/r/u',
        `${m.innen.links} / ${m.innen.oben} / ${m.innen.rechts} / ${m.innen.unten} px`,
      )
      for (const [wo, v] of Object.entries(m.innen)) {
        if (v < 0) melde(`die Marke ragt ${-v} px ueber die Kachel hinaus (${wo}) und wird beschnitten`)
      }
    }

    // ── 3. DIE ECKEN — nur solange die Marke einen sichtbaren Koerper hat.
    // Mit toter Marke waeren die Abstaende solche VON (0,0) aus: Zahlen, die
    // gruen aussehen und nichts messen.
    if (!marktTot) {
      for (const n of m.nachbarn) {
        zeile(`… gegen ${n.was}`, n.schnitt ? `UEBERSCHNEIDUNG ${n.schnitt.w}x${n.schnitt.h} px` : `${n.abstand} px frei`)
        if (n.schnitt) melde(`die Marke ueberdeckt ${n.was} um ${n.schnitt.w}x${n.schnitt.h} px`)
      }
      if (!m.nachbarn.length) {
        // KEIN GRUND ZUR FREUDE: Steht auf der markierten Kachel gar keine
        // andere Aufschrift, ist der Eckentest nicht bestanden, sondern nicht
        // gelaufen — genau die Sorte stiller Luege aus [attrappe-luegt-durch-
        // weglassen].
        melde('die markierte Kachel traegt keine einzige weitere Aufschrift — der Eckentest hat nichts geprueft')
      }
    }
  }

  // ── 3b. DIE ECKEN AUCH DORT, WO ES ENG WIRD ────────────────────────────
  //
  // Die markierte Kachel ist ein REGAL (Mosaik + Zahl). Die gemeine Kachel ist
  // die mit Play-Knopf UND Dienst-Plakette UND Fehlt-Schaerpe — „Das
  // Pummeleinhorn" hat alle drei. Sie laeuft nie, also wird ihr die Marke fuer
  // die Messung untergeschoben und gleich wieder abgeraeumt. DAS IST EINE
  // BEWUSSTE GRENZE, dieselbe wie in tools/marke-tanzt.mjs: gemessen wird die
  // LAGE, nicht das Erscheinen — dass sie am richtigen Ort erscheint, steht
  // eine Messung weiter oben.
  const ENG = `(() => {
    const k = [...document.querySelectorAll('#raster > .kachel')]
      .find((e) => e.querySelector('.kachel-fehlt') && e.querySelector('.kachel-marken'))
    if (!k) return null
    const platz = k.querySelector('[data-markenplatz]')
    if (!platz) return { ohnePlatz: true, titel: (k.querySelector('.kachel-titel')||{}).textContent || '' }
    const m = document.createElement('div')
    m.className = 'spielt-marke'
    platz.appendChild(m)
    // SEIT DEM LAUFENDEN RAHMEN (11.09.2026) IST DIE MARKE TOT GESTELLT
    // (app.css: .spielt-marke { display: none }). Ein getBoundingClientRect
    // auf ihr liefert 0x0 bei (0,0) — die Eckenmessung meldete daraus „ragt
    // 280 px ueber die Kachel hinaus" fuer heilen Code, zwei dauerrote
    // Zeilen lang. Die Ecken-Frage stellt sich erst wieder, wenn die Marke
    // einen sichtbaren Traeger hat; der Rahmen liegt IM Bild (inset: 0) und
    // kann nichts ueberdecken. tools/marke-tanzt.mjs misst seine Bewegung.
    if (getComputedStyle(m).display === 'none') { m.remove(); return { marktTot: true, titel: (k.querySelector('.kachel-titel')||{}).textContent || '' } }
    const mr = m.getBoundingClientRect()
    const schnitt = (a, b) => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      return w > 0.5 && h > 0.5 ? Math.round(w) + 'x' + Math.round(h) : null
    }
    const raus = []
    for (const s of ['.kachel-marken', '.tipp-spiel', '.kachel-fehlt']) {
      for (const e of k.querySelectorAll(s)) {
        const r = e.getBoundingClientRect()
        const dx = Math.max(0, Math.max(r.left - mr.right, mr.left - r.right))
        const dy = Math.max(0, Math.max(r.top - mr.bottom, mr.top - r.bottom))
        raus.push({ was: s, abstand: Math.round(Math.hypot(dx, dy)), schnitt: schnitt(mr, r) })
      }
    }
    m.remove()
    return { titel: (k.querySelector('.kachel-titel')||{}).textContent || '', raus }
  })()`

  /** Die Ecken derselben engen Kachel ausgeben und melden, was sich schneidet.
   *  Als Funktion, weil sie ZWEIMAL gebraucht wird — hell und dunkel. */
  const eckenLesen = async (wo) => {
    const eng = await ev(ENG)
    if (!eng)
      return melde(`${wo}: keine Kachel mit Fehlt-Schaerpe UND Dienst-Plakette — der enge Fall wurde nicht geprueft`)
    if (eng.marktTot)
      return zeile(`${wo}: enge Kachel`, `(Marke tot gestellt — der Rahmen liegt im Bild, Ecken entfallen)`)
    if (eng.ohnePlatz)
      return melde(`${wo}: „${eng.titel.trim()}" hat kein [data-markenplatz] — dort kann nie eine Marke erscheinen`)
    zeile(`${wo}: enge Kachel`, `„${eng.titel.trim()}"`)
    for (const n of eng.raus) {
      zeile(`… gegen ${n.was}`, n.schnitt ? `UEBERSCHNEIDUNG ${n.schnitt} px` : `${n.abstand} px frei`)
      if (n.schnitt) melde(`${wo}: auf „${eng.titel.trim()}" ueberdeckt die Marke ${n.was} um ${n.schnitt} px`)
    }
  }
  await eckenLesen('hell')

  // ── 4. GEGENPROBE: mpv laeuft, gestartet hat es niemand von HIER ───────
  //
  // OHNE SIE PRUEFT DER PUNKT OBEN NUR, DASS UEBERHAUPT ETWAS MARKIERT WIRD,
  // nicht dass es das Richtige ist. Unter der Lage `spielt` laeuft ein lokales
  // Hoerbuch, und die Seite selbst hat nichts gestartet. Seit dem 12.09.2026
  // sind das ZWEI Faelle, und beide gehoeren gemessen:
  //
  //   * OHNE Server-Gedaechtnis (`laeuft-aus`, der aeltere Server): die
  //     Oberflaeche kann NICHT wissen, welches Werk das ist — und darf es
  //     folglich auch nicht behaupten (llmwiki: kein Rueckfall auf blosse
  //     Namensaehnlichkeit). Erwartung: NICHTS markiert.
  //   * MIT Server-Gedaechtnis (`laeuft-an`, der Alltag): der Server hat den
  //     Start selbst ausgefuehrt und nennt das Werk (`laeuft` an
  //     /player/local, laufendes-werk.ts). Erwartung: GENAU dieses eine Werk
  //     markiert — mehr waere geraten, weniger waere die alte Taubheit nach
  //     dem Neuladen, die tools/marke-ohne-eigenen-start.mjs als Alltag
  //     belegt.
  await stellen('laeuft-aus')
  await stellen('spielt')
  await warte(3000)
  const fremd = await ev(LESEN)
  zeile(
    'mpv laeuft, Server ohne Gedaechtnis',
    fremd.markiert.map((x) => `„${x.titel.trim()}"`).join(', ') || '(nichts markiert)',
  )
  if (fremd.markiert.length) {
    melde(`${fremd.markiert.length} Kachel(n) behaupten „laeuft", obwohl niemand weiss, was mpv da spielt`)
  }

  await stellen('laeuft-an')
  await warte(3000)
  const vomServer = await ev(LESEN)
  zeile(
    'mpv laeuft, Server nennt das Werk',
    vomServer.markiert.map((x) => `„${x.titel.trim()}"`).join(', ') || '— KEINE —',
  )
  if (vomServer.markiert.length !== 1) {
    melde(`${vomServer.markiert.length} markierte Kacheln mit Server-Gedaechtnis statt genau einer`)
  } else if (vomServer.markiert[0].titel.trim() !== LOKAL) {
    melde(`mit Server-Gedaechtnis markiert ist „${vomServer.markiert[0].titel.trim()}" statt „${LOKAL}"`)
  }

  // … und jetzt dasselbe Werk von HIER aus antippen. Ab da ist der Bezug
  // bekannt (`zuletztGestartet`), und die Marke gehoert genau dorthin.
  const getippt = await ev(tippeQuell(LOKAL))
  if (!getippt) melde(`keine Raster-Kachel „${LOKAL}" — die Vorschau hat sich geaendert`)
  await warte(3500)
  const nachTipp = await ev(LESEN)
  zeile('nach dem Tipp markiert', nachTipp.markiert.map((x) => `„${x.titel.trim()}"`).join(', ') || '— KEINE —')
  if (nachTipp.markiert.length !== 1)
    melde(`${nachTipp.markiert.length} markierte Kacheln nach dem Tipp statt genau einer`)
  else if (nachTipp.markiert[0].titel.trim() !== LOKAL) {
    melde(`markiert ist „${nachTipp.markiert[0].titel.trim()}" statt „${LOKAL}"`)
  }

  // ── 5. DIE WIEDERGABE ENDET — die Marke muss WEG sein ──────────────────
  //
  // DAS IST DER TEIL, DEN `zuletztGestartet` allein falsch beantwortet: Es
  // bleibt gesetzt, auch wenn laengst nichts mehr laeuft. Fuer ein Cover geht
  // das durch, fuer eine Marke namens „spielt gerade" nicht.
  await stellen('still')
  await warte(3000)
  const still = await ev(LESEN)
  zeile('nach dem Ende markiert', still.markiert.map((x) => `„${x.titel.trim()}"`).join(', ') || '(nichts markiert)')
  if (still.markiert.length) melde(`${still.markiert.length} Kachel(n) behaupten „spielt gerade", obwohl nichts laeuft`)

  // ── 6. DIE DREI BREMSEN, alle am selben Element ────────────────────────
  await stellen('spotify')
  await warte(3000)
  const bewegung = async () =>
    ev(`(() => {
      const r = document.querySelector('#raster .spielt-marke svg rect')
      if (!r) return null
      const s = getComputedStyle(r)
      return { name: s.animationName, dauer: s.animationDuration, box: s.transformBox }
    })()`)

  const normal = await bewegung()
  zeile('Bewegung normal', normal ? `${normal.name}, ${normal.dauer}, transform-box ${normal.box}` : '— keine Marke —')
  if (!normal) melde('im Raster steht keine Marke — die Bremsen lassen sich gar nicht messen')
  else {
    if (normal.name === 'none') melde('die Marke im Raster bewegt sich nicht — sie erbt die Regeln der Lane nicht')
    // `transform-box: fill-box` ist Pflicht: ohne sie streckt sich jeder Balken
    // um den URSPRUNG des SVG statt um seine eigene Mitte, und die Figur
    // wandert aus dem Kreis heraus [marke-tanzt-scaleY-nicht-hoehe].
    if (normal.box !== 'fill-box')
      melde(`transform-box ist ${normal.box} statt fill-box — die Balken wandern aus dem Kreis`)

    await ev(`document.body.classList.add('ruhige-marke'), true`)
    const ruhig = await bewegung()
    zeile('Schalter `ruhigeMarke`', ruhig ? ruhig.name : '—')
    if (ruhig && ruhig.name !== 'none') melde('`body.ruhige-marke` haelt die Marke im Raster NICHT an')
    await ev(`document.body.classList.remove('ruhige-marke'), true`)

    await send(ws, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await warte(300)
    const reduziert = await bewegung()
    zeile('prefers-reduced-motion', reduziert ? reduziert.name : '—')
    if (reduziert && reduziert.name !== 'none')
      melde('`prefers-reduced-motion: reduce` haelt die Marke im Raster NICHT an')
    await send(ws, 'Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    })
    await warte(300)
  }

  // ── 7. UND IM DUNKELN ──────────────────────────────────────────────────
  // HIER STAND `document.getElementById('licht-knopf').click()` — der Mond in
  // der Kopfzeile. Er ist am 07.08.2026 entfallen; der einzige Schalter steht
  // jetzt im Admin-Menue unter Darstellung -> Farbe und Form. Stehengeblieben
  // haette die Zeile geworfen und dieses Werkzeug haette im HELLEN Stand
  // weitergemessen, unter der Ueberschrift „dunkel".
  //
  // GEMESSEN WIRD DAS RASTER IM DUNKELN, NICHT DER SCHALTER. Deshalb der
  // Stand von aussen (`data-licht` + Speicher, genau was app.js tut) und nicht
  // der Weg ins Menue: der raeumte das Raster ab. Den Schalter selbst prueft
  // tools/licht-weg-probe.mjs. Beides in tools/licht-weg.mjs.
  if (!(await ev(LICHT_STELLEN_JS('dunkel')))) melde('der dunkle Stand liess sich nicht setzen')
  await warte(500)
  const dunkel = await ev(LESEN)
  zeile('dunkel: markiert', dunkel.markiert.map((x) => `„${x.titel.trim()}"`).join(', ') || '— KEINE —')
  if (!dunkel.markiert.length) melde('im Dunkeln traegt keine Raster-Kachel die Marke')
  else zeile('dunkel: Titelfarbe der Kachel', dunkel.markiert[0].titelfarbe)
  // DIE ECKEN AUCH IM DUNKELN, und das ist keine Pflichtuebung: Im dunklen
  // Stand aendern sich Rahmen und Schatten der Aufschriften (`--surface` steckt
  // im 2-px-Ring der Marke), und die Fehlt-Schaerpe traegt einen eigenen
  // Textschatten. 24 px sind der knappste Abstand auf der ganzen Kachel — bei
  // dem Wert genuegt es nicht, den hellen Stand gemessen zu haben.
  await eckenLesen('dunkel')
  await ev(LICHT_STELLEN_JS('hell'))
  await warte(400)

  if (BILD) {
    const d = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(BILD, Buffer.from(d.data, 'base64'))
    zeile('Bild abgelegt', BILD)
  }

  if (laut.length) {
    console.log('\n  KONSOLE')
    for (const l of laut) melde(`Konsole — ${l}`)
  }

  console.log(fehler ? `\n  ${fehler} Abweichung(en).\n` : '\n  keine Abweichung.\n')
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

if (PRUEFEN && fehler) process.exit(1)
