#!/usr/bin/env node
/**
 * DAS KIND AM TOR — kommt es doch hinein?
 *
 * ══ WOZU, UND WIESO NICHT SCHON tools/eltern-tor-schau.mjs ═════════════════
 * `eltern-tor-schau.mjs` misst, ob das Tor STEHT und ob die richtige Loesung
 * es fallen laesst. Das ist die Sicht dessen, der die Loesung kennt. Diese
 * Datei nimmt die andere Sicht ein: ein achtjaehriges Kind, das die Loesung
 * NICHT kennt, viel Zeit hat und keine Scheu. Es fragt nicht „geht es auf?",
 * sondern „wie teuer ist es, es aufzubekommen, ohne es zu wissen?".
 *
 * Der Unterschied ist nicht akademisch. Eine Sperre kann jede Einzelpruefung
 * bestehen — richtige Loesung oeffnet, sechs falsche Folgen oeffnen nicht —
 * und trotzdem in zwei Minuten offen sein, weil
 *   * sie keine BREMSE hat (durchprobieren kostet nichts), oder
 *   * sie dem Probierenden VERRAET, ob ein Schritt richtig war (aus 1:180 000
 *     wird dann ein Warm-Kalt-Spiel mit ein paar Dutzend Beruehrungen), oder
 *   * es einen Weg an ihr VORBEI gibt, der gar nicht durch sie fuehrt.
 * Genau diese drei Fragen stehen hier, und jede wird gefahren, nicht gelesen.
 *
 * ══ WAS GEMESSEN WIRD ══════════════════════════════════════════════════════
 *   1. DURCHPROBIEREN (Sorte „rechnen"): wie viele Versuche passen in ein
 *      Zeitfenster? Ohne Bremse ist das die halbe Miete fuer das Kind, denn
 *      die Antworten des kleinen Einmaleins haeufen sich (24 kommt viermal
 *      vor, 36 dreimal) — wer immer dieselbe Zahl tippt, ist im Mittel nach
 *      zwoelf Versuchen drin.
 *   2. UEBERLEBT DIE BREMSE DAS VERLASSEN? Ein Kind, das gebremst wird, tippt
 *      auf den Rueckweg und haelt das Zahnrad erneut. Wird dabei alles auf
 *      null gesetzt, ist die Bremse keine.
 *   3. VERRAET DIE GESTE SICH SELBST? Gefahren wird ein Warm-Kalt-Spiel, das
 *      AUSSCHLIESSLICH liest, was am Schirm steht (`#tor-anzeige`) — also
 *      genau das, was auch ein Kind sieht. Findet es die Folge, ist die
 *      Rechnung „1 : 180 000" aus app.js hinfaellig.
 *   4. GEHT ES AM TOR VORBEI? Der Eltern-Bereich ist nicht der einzige Weg in
 *      die gesperrten Ecken: dieselbe Oberflaeche traegt Knoepfe, die
 *      unmittelbar in die ALTE Oberflaeche springen (`/settings`,
 *      `/bluetooth`). Gemessen wird, ob eine gesetzte Sperre sie aufhaelt.
 *   5. SPERRT ES DEN ERWACHSENEN AUS? Die Gegenrichtung, und sie gehoert
 *      dazu: unlesbare Konfiguration, ausdrueckliches „aus", und der Weg
 *      nach `/settings`, der nach geloester Aufgabe ans ZIEL fuehren muss und
 *      nicht bloss in den Eltern-Bereich.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums. Mit `--box <adresse>` wird zusaetzlich EINE
 * Seite der echten Box GELESEN (`/settings`) — kein Tipp, kein Schreiben,
 * kein Dienst wird angefasst.
 *
 * ══ VORSCHAU UND BROWSER ═══════════════════════════════════════════════════
 * Ohne Adresse startet dieses Werkzeug seine EIGENE Vorschau auf einem freien
 * Port und beendet sie am Ende — eine geliehene Vorschau bedient den
 * Arbeitsbaum dessen, der sie gestartet hat ([[vorschau-wird-geliehen]]).
 * Der Browser kommt aus `eigenerBrowser()` und bekommt seinen Debug-Port vom
 * Betriebssystem. EIN `--debug-port` GIBT ES HIER BEWUSST NICHT: eine Zahl,
 * die man von Hand waehlen kann, ist eine Zahl, die man doppelt waehlen kann —
 * und am 05.08.2026 hat genau das ein fremdes Browserfenster ferngesteuert
 * und dessen Lage als Messung gemeldet.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/kind-am-tor.mjs
 *     node tools/kind-am-tor.mjs http://127.0.0.1:8611/neu/   geliehene Vorschau
 *     node tools/kind-am-tor.mjs --fenster 30                 laenger haemmern
 *     node tools/kind-am-tor.mjs --box http://192.168.178.169  eine Seite lesen
 *
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAufHalten } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
// DIE ADRESSE DER VORSCHAU IST NICHT JEDE ADRESSE IN DER ZEILE. `--box` traegt
// ebenfalls eine, und der erste Anlauf hat sie als Vorschau genommen — der Lauf
// zeigte dann auf die echte Box und brach mit ECONNREFUSED ab. Was hinter einem
// Schalter steht, gehoert dem Schalter.
const NACH_SCHALTER = new Set(
  argv.map((a, i) => (a.startsWith('--') ? argv[i + 1] : null)).filter(Boolean),
)
const MITGEGEBEN =
  argv.find((a) => a.startsWith('http') && !NACH_SCHALTER.has(a)) || null
const BOX = typeof opt('box', null) === 'string' ? opt('box', null) : null
/** Wie lange auf die Rechenaufgabe eingehaemmert wird. 30 s reichen zur Aussage. */
const FENSTER_S = Number(opt('fenster', 30)) || 30
/** Wie viele Beruehrungen das Warm-Kalt-Spiel hoechstens bekommt. */
const GESTE_BUDGET = Number(opt('budget', 300)) || 300

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort, dazu })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

// ── Vorschau: eigene oder geliehene ────────────────────────────────────────
let vorschau = null
let lageVorher = null
let ZIEL = MITGEGEBEN

// Ein `spawn`-Kind haelt Nodes Ereignisschleife am Leben; ohne diesen Riegel
// endet der Lauf nie, wenn weiter unten etwas wirft. Gemessen am 06.08.2026:
// 26 Minuten Stillstand ohne jede Ausgabe.
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
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  vorschau.unref()
  let gestorben = null
  vorschau.on('exit', (c) => {
    gestorben = c
  })
  const bis = Date.now() + 10000
  for (;;) {
    if (gestorben !== null)
      throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} war belegt`)
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
} else {
  try {
    const a = await fetch(new URL('/vorschau/lage', ZIEL), { signal: AbortSignal.timeout(1500) })
    lageVorher = await a.json()
  } catch {
    console.warn(`  ACHTUNG  ${ZIEL} antwortet nicht auf /vorschau/lage — nichts zurueckzulegen.`)
  }
}

let chrome = null
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

try {
  chrome = await eigenerBrowser()
  if (!chrome) throw new Error('kein Browser erreichbar')
  const ws = new WebSocket(await chrome.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const ev = async (js) => {
    const r = await send(ws, 'Runtime.evaluate', {
      expression: js,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL))
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1400)
  }
  const tippen = async (x, y, halteMs = 40) => {
    const gem = {
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      clickCount: 1,
      pointerType: 'touch',
    }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...gem })
    await warte(halteMs)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...gem })
    await warte(45)
  }
  /** Die Mitte eines Elements — oder null, wenn es gar nicht dasteht. */
  const mitteVon = (id) =>
    ev(`(() => { const e = document.getElementById('${id}')
      if (!e) return null
      const b = e.getBoundingClientRect()
      if (!(b.width > 0)) return null
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)

  /** Der echte Weg hinein: den Schriftzug lange halten. */
  const hinein = async () => {
    // BIS ZUM 06.08.2026 FUEHRTE DAS ZAHNRAD `#einst-knopf` HINEIN, 800 ms
    // gehalten. Es ist ersatzlos entfallen; hinein fuehrt der Schriftzug
    // `#wappen`, WAPPEN_HALTEN_MS = 1200 ms gehalten. Dieses Werkzeug hat eine
    // echte Druckfunktion und geht deshalb den ECHTEN Weg, nicht den
    // Tastaturweg (tools/admin-weg.mjs).
    // `pruefen: false`: dieses Werkzeug geht mit Absicht in gesperrte Lagen,
    // in denen statt der Faecher das Tor dasteht — das Urteil faellt `schirm()`.
    await adminAufHalten(ev, tippen, { warteMs: 700 })
  }
  /**
   * AUS DEM OFFENEN ADMIN-BEREICH IN DIE ALTE OBERFLAECHE.
   *
   * Bis zum 06.08.2026 war das EIN kurzer Tipp aufs Zahnrad. Seit das
   * Zahnrad weg ist, ist es der einzige Sprung, den der Bereich noch kennt:
   * Gruppe „System", Zeile „Weitere Einstellungen ↗" (ELTERN_PUNKTE in
   * NewDesign/app.js). Gibt den Pfad zurueck, auf dem man gelandet ist.
   */
  const zuSettings = async () => {
    await ev(`(() => { const k = document.querySelector('.fach-knopf[data-fach="system"]')
      if (k) k.click(); return !!k })()`)
    await warte(400)
    const da = await ev(`(() => { const k = [...document.querySelectorAll('#fach-zeilen button')]
      .find((x) => (x.textContent || '').includes('Weitere Einstellungen'))
      if (k) k.click(); return !!k })()`)
    if (!da) return 'die Zeile „Weitere Einstellungen ↗" steht nicht da'
    await warte(900)
    return ev('location.pathname')
  }
  /** Der Weg, den ein KURZER Tipp nimmt. */
  const kurzTippen = async (id) => {
    const r = await mitteVon(id)
    if (!r) return null
    await tippen(r.x, r.y, 40)
    await warte(800)
    return ev('location.pathname')
  }

  const schirm = () =>
    ev(`(() => {
      const sicht = (id) => {
        const e = document.getElementById(id)
        if (!e) return false
        const s = getComputedStyle(e)
        return !e.hidden && s.display !== 'none' && s.visibility !== 'hidden'
          && e.getClientRects().length > 0
      }
      const t = document.getElementById('eltern-tor')
      const r = t ? t.getBoundingClientRect() : null
      const w = document.querySelector('.tor-weiter')
      return {
        bereich: sicht('eltern'),
        tor: sicht('eltern-tor'),
        flaeche: sicht('eltern-flaeche'),
        feld: sicht('tor-feld'),
        faecher: document.querySelectorAll('.fach-knopf').length,
        unter: (document.getElementById('eltern-unter') || {}).textContent || '',
        frage: (document.getElementById('tor-frage') || {}).textContent || '',
        anzeige: (document.getElementById('tor-anzeige') || {}).textContent || '',
        meldung: (document.getElementById('tor-meldung') || {}).textContent || '',
        weiterAus: w ? !!w.disabled : null,
        torLage: r ? { x: Math.round(r.left), y: Math.round(r.top), b: Math.round(r.width), h: Math.round(r.height) } : null,
      } })()`)

  /** Eine Taste des Ziffernfelds beruehren — wie ein Finger, nicht per Aufruf. */
  const taste = async (t) => {
    const p = await ev(`(() => {
      const k = document.querySelector('.tor-taste[data-taste="${t}"]')
      if (!k) return null
      const b = k.getBoundingClientRect()
      if (!(b.width > 0)) return null
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)
    if (!p) return false
    await tippen(p.x, p.y)
    return true
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  1. DURCHPROBIEREN — wie teuer ist die Rechenaufgabe wirklich?
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══ 1. Die Rechenaufgabe durchprobieren ══')

  /*
   * DIE HAEUFIGSTE ANTWORT IST DER SCHLUESSEL, nicht das Rechnen. Die Aufgabe
   * ist a x b mit a,b aus 3..9 — 49 gleich wahrscheinliche Paare, aber nur 25
   * verschiedene Ergebnisse. 24 entsteht viermal (3x8, 8x3, 4x6, 6x4), 36
   * dreimal. Wer IMMER 24 tippt, trifft mit 4/49 = 8,2 % je Versuch.
   *
   * Die Spanne wird aus app.js GELESEN statt hier hingeschrieben: eine Zahl im
   * Werkzeug liefe stumm auseinander, sobald jemand die Aufgabe aendert.
   * Findet sich die Zeile nicht, sagt das Werkzeug es laut, statt weiter mit
   * einer Vermutung zu rechnen.
   */
  const quelle = await (await import('node:fs/promises')).readFile(
    join(WURZEL, 'NewDesign/app.js'),
    'utf8',
  )
  const m = quelle.match(/const w = \(\) => (\d+) \+ Math\.floor\(Math\.random\(\) \* (\d+)\)/)
  ja(!!m, 'die Spanne der Faktoren ist aus app.js gelesen, nicht abgeschrieben',
    m ? `${m[1]} bis ${Number(m[1]) + Number(m[2]) - 1}` : 'aufgabeWuerfeln() nicht wiedererkannt')
  const min = m ? Number(m[1]) : 3
  const spanne = m ? Number(m[2]) : 7
  const haeufig = new Map()
  for (let a = min; a < min + spanne; a += 1)
    for (let b = min; b < min + spanne; b += 1)
      haeufig.set(a * b, (haeufig.get(a * b) || 0) + 1)
  let besteZahl = 0
  let besteAnzahl = 0
  for (const [z, n] of haeufig) if (n > besteAnzahl) (besteAnzahl = n), (besteZahl = z)
  const p1 = besteAnzahl / (spanne * spanne)
  console.log(
    `    ${spanne * spanne} Paare, ${haeufig.size} verschiedene Ergebnisse; ` +
      `haeufigstes: ${besteZahl} (${besteAnzahl}x = ${(p1 * 100).toFixed(1)} % je Versuch, ` +
      `im Mittel ${(1 / p1).toFixed(1)} Versuche)`,
  )

  /**
   * Eine Antwort eintippen und „Weiter" druecken.
   *
   * ZAEHLT NUR, WAS WIRKLICH ANKOMMT. Eine Bremse laesst die Tasten stehen und
   * nimmt sie bloss nicht mehr an — wer die Beruehrungen zaehlt, zaehlt dann
   * Versuche, die es nie gab, und meldet eine Sperre als ungebremst. Deshalb
   * wird nach dem Eintippen NACHGESEHEN, ob die Zahl auch in der Anzeige
   * steht; erst dann ist es ein Versuch.
   */
  const antworten = async (zahl) => {
    for (const z of String(zahl)) if (!(await taste(z))) return null
    const a = String(
      await ev(`(() => { const e = document.getElementById('tor-anzeige')
        return e ? e.textContent : '' })()`),
    ).replace(/\s/g, '')
    if (a !== String(zahl)) {
      // Nicht angenommen — die Bremse steht. Kurz warten, sonst dreht die
      // Schleife heiss und misst nur noch sich selbst.
      await warte(400)
      return { angenommen: false, offen: false, frage: '', meldung: '' }
    }
    if (!(await taste('weiter'))) return null
    await warte(120)
    const s = await schirm()
    return { angenommen: true, offen: !!s.flaeche && !s.tor, frage: s.frage, meldung: s.meldung }
  }

  await stand('sperre-rechnen')
  await neuLaden()
  await hinein()
  let s = await schirm()
  ja(s.tor && !s.flaeche, 'das Tor steht (Rechenaufgabe)', s.frage)

  /*
   * WIE VIELE VERSUCHE PASSEN IN DAS FENSTER? Das ist die Zahl, an der alles
   * haengt: mal der Trefferwahrscheinlichkeit oben ergibt sie, wie lange ein
   * Kind braucht.
   *
   * GEMESSEN WIRD MIT EINER ANTWORT, DIE NIE STIMMEN KANN. Mit der haeufigsten
   * Zahl zu messen waere ein Wuerfelspiel: geht das Tor beim zweiten Versuch
   * auf, ist die Messung zu Ende, bevor sie eine Rate hat — und beim naechsten
   * Lauf steht eine andere Zahl da. Die Rate ist die Eigenschaft der Sperre,
   * der Treffer ist Zufall. Beide getrennt zu messen ist der ganze Trick.
   */
  const unmoeglich = (() => {
    for (let z = 11; z < 100; z += 1) if (!haeufig.has(z)) return z
    return 11
  })()
  const t0 = Date.now()
  const wann = []
  while (Date.now() - t0 < FENSTER_S * 1000) {
    const r = await antworten(unmoeglich)
    if (!r) break
    if (!r.angenommen) continue
    wann.push((Date.now() - t0) / 1000)
  }
  const versuche = wann.length
  const dauer = (Date.now() - t0) / 1000
  console.log(
    `    ${versuche} abgewiesene Versuche mit der unmoeglichen Antwort ${unmoeglich} ` +
      `in ${dauer.toFixed(1)} s — angenommen bei t = ${wann.map((t) => t.toFixed(1)).join(', ')} s`,
  )
  /*
   * WIE LANGE BRAUCHT DAS KIND WIRKLICH? NICHT ueber die Durchschnittsrate.
   * Eine Bremse, die STEIGT, hat am Anfang ihre hoechste Rate — wer damit
   * hochrechnet, bekommt die freundlichste aller Zahlen und meldet eine Sperre
   * als schwaecher, als sie ist. Gerechnet wird deshalb mit dem LETZTEN
   * gemessenen Abstand: der ist die Geschwindigkeit, die das Kind ab jetzt
   * noch hat. Auch das ist noch zu freundlich, solange die Staffel weiter
   * steigt — und zu freundlich ist bei einer Sperre die richtige Richtung.
   */
  const letzterAbstand =
    versuche >= 2 ? wann[versuche - 1] - wann[versuche - 2] : Math.max(dauer, 1)
  const noetig = 1 / p1
  const geschaetztS = versuche ? wann[versuche - 1] + Math.max(0, noetig - versuche) * letzterAbstand : dauer
  console.log(
    `    letzter Abstand ${letzterAbstand.toFixed(1)} s -> die ${noetig.toFixed(1)} noetigen ` +
      `Versuche kosten mindestens ${(geschaetztS / 60).toFixed(1)} min`,
  )

  // UND JETZT DAS KIND SELBST: immer dieselbe haeufigste Zahl, hoechstens 20 s
  // lang. Diese Zeile wird NICHT behauptet — sie ist der Beleg, den man
  // vorzeigt, und er darf beim naechsten Lauf anders ausfallen.
  await stand('sperre-rechnen')
  await neuLaden()
  await hinein()
  const t0b = Date.now()
  let versucheB = 0
  let offenNach = 0
  while (Date.now() - t0b < 20000) {
    const r = await antworten(besteZahl)
    if (!r) break
    if (!r.angenommen) continue
    versucheB += 1
    if (r.offen) {
      offenNach = versucheB
      break
    }
  }
  console.log(
    `    Kind tippt stur ${besteZahl}: ` +
      (offenNach
        ? `OFFEN nach ${offenNach} Versuchen in ${((Date.now() - t0b) / 1000).toFixed(1)} s`
        : `${versucheB} Versuche in 20 s, das Tor blieb zu`),
  )
  // DIE MARKE: hoechstens 8 Versuche in 30 s. Ohne Bremse sind es rund 25 —
  // mal 8,2 % Treffer heisst das: das Tor ist im Mittel nach einer halben
  // Minute offen. Mit einer Bremse, die nach den ersten Fehlgriffen wartet,
  // kostet dasselbe Kind Viertelstunden, ohne dass ein Erwachsener, der sich
  // einmal vertippt, ueberhaupt etwas merkt.
  const MARKE_VERSUCHE = Math.max(2, Math.round((8 * FENSTER_S) / 30))
  ja(versuche <= MARKE_VERSUCHE,
    `das Durchprobieren ist gebremst (hoechstens ${MARKE_VERSUCHE} Versuche in ${FENSTER_S} s)`,
    `${versuche} Versuche in ${dauer.toFixed(1)} s -> mindestens ` +
      `${(geschaetztS / 60).toFixed(1)} min, bis das Kind drin ist`)
  // UND DIE ABSTAENDE MUESSEN WACHSEN. Eine feste Wartezeit waere eine Bremse,
  // die das Kind einfach mitrechnet: alle 5 s ein Versuch heisst nach einer
  // Minute drin. Der Beweis dafuer, dass sie STEIGT, ist der Vergleich des
  // ersten mit dem letzten Abstand.
  const ersterAbstand = versuche >= 2 ? wann[1] - wann[0] : 0
  // DREI VERSUCHE BRAUCHT ES FUER ZWEI ABSTAENDE. Bei weniger wird hier NICHTS
  // behauptet: „erster Abstand gleich letzter" waere bei zwei Versuchen kein
  // Befund, sondern dieselbe Zahl zweimal gelesen — und ein Werkzeug, das das
  // rot faerbt, meldet einen Fehler, den es gerade selbst gebaut hat.
  ja(versuche < 3 || letzterAbstand > ersterAbstand + 1,
    'die Wartezeit STEIGT, sie ist keine feste Taktung',
    versuche >= 3
      ? `erster Abstand ${ersterAbstand.toFixed(1)} s, letzter ${letzterAbstand.toFixed(1)} s`
      : `nur ${versuche} Versuche im Fenster — fuer zwei Abstaende zu wenig, und fuer sich schon die Antwort`)

  /*
   * ── DIE BREMSE MUSS DAS VERLASSEN UEBERLEBEN ────────────────────────────
   * Ein gebremstes Kind wartet nicht, es tippt auf den Rueckweg und haelt das
   * Zahnrad erneut. Faengt dabei alles bei null an, ist die Bremse eine
   * Zierde: sie kostet zwei Beruehrungen statt Sekunden.
   *
   * Aufgebaut wird mit DREI falschen Antworten — mehr braucht es nicht, um
   * ueber die freien Versuche hinauszukommen, und jeder weitere kostete die
   * Messung die naechste Wartezeit.
   */
  await stand('sperre-rechnen')
  await neuLaden()
  await hinein()
  for (let i = 0; i < 3; i += 1) {
    const bis = Date.now() + 30000
    for (;;) {
      const r = await antworten(unmoeglich)
      if (!r || r.angenommen || Date.now() > bis) break
    }
  }
  s = await schirm()
  const gebremstVorher = s.tor && (s.weiterAus === true || /\d/.test(s.meldung))
  await ev(`document.getElementById('zurueck')?.click()`)
  await warte(500)
  await hinein()
  const t1 = Date.now()
  let versucheDanach = 0
  while (Date.now() - t1 < 5000) {
    const r = await antworten(unmoeglich)
    if (!r) break
    if (!r.angenommen) continue
    versucheDanach += 1
  }
  ja(versucheDanach === 0,
    'die Bremse ueberlebt „hinaus und wieder herein"',
    `nach drei Fehlversuchen und dem Verlassen waren in 5 s wieder ` +
      `${versucheDanach} Versuche moeglich` +
      (gebremstVorher ? '' : ' (drinnen war ueberhaupt nicht gebremst)'))

  // ── STEHT DIE LOESUNG IM BAUM, BEVOR SIE GEFRAGT IST? ───────────────────
  // Nicht die Frage („Was ist 7 × 8?"), sondern die ANTWORT. Ein Kind liest
  // keine Konsole, aber ein Text im Baum wird von einer Vorlesehilfe
  // vorgelesen — und was einmal im Baum steht, steht auch in jedem
  // Bildschirmabzug.
  await stand('sperre-rechnen')
  await neuLaden()
  await hinein()
  /*
   * WO GESUCHT WIRD, IST HIER DIE GANZE FRAGE — und der erste Anlauf hat sie
   * falsch beantwortet. Er durchsuchte den TEXT des ganzen Eltern-Bereichs,
   * und darin steht das Ziffernfeld: „1 2 3 4 5 6 7 8 9 ⌫ 0 Weiter". Als
   * Zeichenkette ist das „…456789…", und damit „enthielt" der Bereich die
   * Antwort 56, sooft sie gestellt wurde — eine Meldung, die je nach Wuerfel
   * kam oder nicht kam und nichts mit der Sperre zu tun hatte.
   *
   * Gesucht wird deshalb dort, wo eine verratene Antwort wirklich stehen
   * wuerde: in den vier Texten des Tors und in JEDEM Merkmal jedes Elements
   * des Bereichs (`data-…`, `title`, `aria-label`, `value`). Das Ziffernfeld
   * bleibt draussen — seine Tasten sind keine Auskunft, sondern die Tastatur.
   */
  const verraten = await ev(`(() => {
    const t = document.getElementById('eltern')
    if (!t) return null
    const f = (document.getElementById('tor-frage') || {}).textContent || ''
    const z = f.match(/(\\d+)\\s*[x×*]\\s*(\\d+)/)
    if (!z) return { frage: f, antwort: null, drin: false, wo: '' }
    const a = String(Number(z[1]) * Number(z[2]))
    const stellen = []
    for (const id of ['tor-frage', 'tor-anzeige', 'tor-meldung', 'eltern-unter']) {
      const e = document.getElementById(id)
      if (e) stellen.push([id, e.textContent || ''])
    }
    for (const e of t.querySelectorAll('*')) {
      // DAS ZIFFERNFELD BLEIBT DRAUSSEN, mit Text UND Merkmalen: seine Tasten
      // tragen data-taste="9", und die einstellige Antwort 9 stuende damit in
      // jedem Lauf "im Baum". Das waere kein Befund, sondern die Tastatur.
      // KEIN SCHRAEGSTRICH-ANFUEHRUNGSZEICHEN IN DIESEM KOMMENTAR: er steht in
      // einer Zeichenkette mit genau diesem Zeichen als Klammer, und ein
      // einziges davon beendet sie mitten im Satz. Genau so ist dieser Lauf
      // beim ersten Anlauf mit "missing ) after argument list" abgebrochen.
      if (e.closest('.tor-taste')) continue
      for (const m of e.attributes) stellen.push([e.tagName + '@' + m.name, m.value])
    }
    // ALS GANZE ZAHL, nicht als Teilstueck: „4" steckt in „14 Uhr" und in
    // jedem Zeitstempel. Gesucht ist die Antwort, nicht ihre Ziffer.
    const ganz = new RegExp('(^|[^0-9])' + a + '([^0-9]|$)')
    const treffer = stellen.filter(([, w]) => ganz.test(String(w)))
    return { frage: f, antwort: a, drin: treffer.length > 0, wo: treffer.map(([k]) => k).join(', ') }
  })()`)
  ja(verraten && verraten.antwort && !verraten.drin,
    'die Antwort steht NICHT im Baum, bevor sie gefragt ist',
    verraten
      ? `Frage „${verraten.frage}", Antwort ${verraten.antwort}` +
        (verraten.drin ? ` — steht in: ${verraten.wo}` : '')
      : 'nicht messbar')

  // ═══════════════════════════════════════════════════════════════════════
  //  2. DIE GESTE — verraet der Schirm, ob ein Schritt richtig war?
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══ 2. Die Geste als Warm-Kalt-Spiel ══')

  await stand('sperre-geste')
  await neuLaden()
  await hinein()
  s = await schirm()
  ja(s.tor && !!s.torLage, 'das Tor steht (Geste)', s.frage)
  const torLage = s.torLage

  /** Wie viele volle Punkte stehen in der Anzeige? Das sieht auch das Kind. */
  const punkte = async () =>
    ev(`(() => { const e = document.getElementById('tor-anzeige')
      return ((e ? e.textContent : '').match(/●/g) || []).length })()`)

  // DIE PROBE, DIE ALLES ENTSCHEIDET, und sie kostet drei Beruehrungen:
  // Sagt der Schirm nach einer RICHTIGEN zweiten Beruehrung etwas anderes als
  // nach einer FALSCHEN, dann ist er ein Orakel. Mehr braucht ein Kind nicht —
  // alles Weitere ist Fleissarbeit.
  const eckPunkt = (nr, kante = 40) => {
    const l = torLage.x + kante
    const r = torLage.x + torLage.b - 1 - kante
    const o = torLage.y + kante
    const u = torLage.y + torLage.h - 1 - kante
    return [
      { x: l, y: o },
      { x: r, y: o },
      { x: r, y: u },
      { x: l, y: u },
    ][nr]
  }
  const mitte = {
    x: torLage.x + Math.round(torLage.b / 2),
    y: torLage.y + Math.round(torLage.h / 2),
  }
  const folgeTippen = async (punkteListe) => {
    for (const p of punkteListe) await tippen(p.x, p.y)
    await warte(60)
    return punkte()
  }
  await neuLaden()
  await hinein()
  const nachRichtig = await folgeTippen([eckPunkt(0), eckPunkt(1)])
  await neuLaden()
  await hinein()
  const nachFalsch = await folgeTippen([eckPunkt(0), mitte])
  ja(nachRichtig === nachFalsch,
    'der Schirm sagt nach einer RICHTIGEN Ecke dasselbe wie nach einer falschen',
    `richtig -> ${nachRichtig} Punkte, falsch -> ${nachFalsch} Punkte` +
      (nachRichtig === nachFalsch ? '' : ' — das ist ein Warm-Kalt-Orakel'))

  /*
   * UND JETZT DAS SPIEL SELBST. Das Kind kennt nichts als die Punktzahl. Es
   * tastet ein Raster ab, behaelt den Punkt, der die Zahl steigen laesst, und
   * baut die Folge Schritt fuer Schritt auf. Genau so spielt ein Kind ein
   * Spiel, das ihm sagt „waermer".
   *
   * Das Raster ist 4x3 und enthaelt die Ecken als eigene Punkte — ein Kind
   * tippt in die Ecken, weil dort die Knoepfe zu sein pflegen.
   */
  const raster = []
  for (const fy of [0.06, 0.5, 0.94])
    for (const fx of [0.04, 0.36, 0.64, 0.96])
      raster.push({
        x: Math.round(torLage.x + fx * (torLage.b - 1)),
        y: Math.round(torLage.y + fy * (torLage.h - 1)),
      })

  let beruehrungen = 0
  let gefunden = false
  const vorne = []
  const offen = () =>
    ev(`(() => { const e = document.getElementById('eltern-flaeche')
      return !!(e && !e.hidden && e.getClientRects().length > 0) })()`)
  await neuLaden()
  await hinein()
  suche: while (vorne.length < 4) {
    let weiter = false
    for (const p of raster) {
      if (beruehrungen >= GESTE_BUDGET) break suche
      // ZUERST IN DIE MITTE — ein Tipp ausserhalb aller Ecken setzt die Folge
      // sicher auf null zurueck. Ohne ihn traegt jeder Fehlversuch seinen Rest
      // in den naechsten, und das Spiel misst sein eigenes Durcheinander.
      await tippen(mitte.x, mitte.y)
      beruehrungen += 1
      for (const q of vorne) {
        await tippen(q.x, q.y)
        beruehrungen += 1
      }
      await tippen(p.x, p.y)
      beruehrungen += 1
      if (await offen()) {
        gefunden = true
        break suche
      }
      if ((await punkte()) === vorne.length + 1) {
        vorne.push(p)
        weiter = true
        break
      }
    }
    if (!weiter) break
  }
  const gefuehrt = beruehrungen
  /*
   * BLEIBT DAS SPIEL STECKEN, HOERT DAS KIND NICHT AUF. Wer hier abbraeche,
   * meldete „nicht offen nach 14 Beruehrungen" und liesse offen, ob die
   * restlichen 286 es nicht doch getan haetten. Der Rest des Vorrats geht
   * deshalb in stures Herumtippen.
   *
   * GLEICHVERTEILT UEBER DIE FLAECHE, und das ist eine Entscheidung, keine
   * Bequemlichkeit: Der erste Anlauf zog aus einer Liste von 16 Punkten, von
   * denen 8 in einer Ecke lagen. Damit traf jede zweite Beruehrung eine Ecke —
   * das ist nicht „herumtippen", das ist schon der ECKEN-Angreifer weiter
   * unten, und die Aussage „1 : 180 000 haelt" waere an einem Modell gemessen
   * worden, fuer das sie nie galt. Ein Finger, der nichts weiss, trifft eine
   * bestimmte Ecke mit ihrem Flaechenanteil, also rund 4,8 %.
   */
  while (!gefunden && beruehrungen < GESTE_BUDGET) {
    const x = torLage.x + Math.floor(Math.random() * torLage.b)
    const y = torLage.y + Math.floor(Math.random() * torLage.h)
    await tippen(x, y)
    beruehrungen += 1
    if (beruehrungen % 5 === 0 && (await offen())) gefunden = true
  }
  if (!gefunden) gefunden = await offen()
  ja(!gefunden,
    `weder Warm-Kalt noch ${GESTE_BUDGET} gleichverteilte Beruehrungen oeffnen das Tor`,
    gefunden
      ? `OFFEN nach ${beruehrungen} Beruehrungen (davon ${gefuehrt} gefuehrt)`
      : `${beruehrungen} Beruehrungen (${gefuehrt} gefuehrt, Rest gleichverteilt), ${vorne.length} von 4 Schritten „gefunden"`)

  /*
   * ══ DER ZWEITE ANGREIFER: DAS KIND TIPPT NUR IN DIE ECKEN ════════════════
   *
   * Er muss die Folge nicht kennen. Er muss EINES gemerkt haben — dass es auf
   * die Ecken ankommt —, und das merkt man, indem man einmal zusieht. Damit
   * schrumpft der Raum von „irgendwohin tippen" auf 4^4 = 256 Folgen, und weil
   * jede Beruehrung zugleich der Anfang der naechsten Folge ist, faellt das Tor
   * nach ein paar hundert Beruehrungen. GEMESSEN, bevor die Bremse da war: in
   * einem Lauf nach 150 Beruehrungen, also nach rund zwei Minuten.
   *
   * GEMESSEN WIRD DESHALB NICHT „geht es auf?" — das waere ein Wuerfelspiel und
   * beim naechsten Lauf anders —, sondern WIE VIELE BERUEHRUNGEN DAS TOR IN
   * EINEM FENSTER UEBERHAUPT ANNIMMT. Das ist die Eigenschaft der Sperre; der
   * Treffer ist Zufall. Angenommen heisst: die Meldung nennt keine Wartezeit.
   */
  await neuLaden()
  await hinein()
  const ecken = [0, 1, 2, 3].map((n) => eckPunkt(n))
  const tE = Date.now()
  let angenommen = 0
  let eckenAuf = false
  while (Date.now() - tE < FENSTER_S * 1000) {
    const p = ecken[Math.floor(Math.random() * 4)]
    await tippen(p.x, p.y)
    const m = String(
      await ev(`(() => { const e = document.getElementById('tor-meldung')
        return e ? e.textContent : '' })()`),
    )
    if (!/Noch \d+ Sekunde/.test(m)) angenommen += 1
    else await warte(400)
    if (await offen()) {
      eckenAuf = true
      break
    }
  }
  /*
   * DIE MARKE: die zwoelf freien Beruehrungen plus eine volle Folge je
   * angebrochener Wartestufe. Ohne Bremse sind es im selben Fenster ueber
   * hundert.
   *
   * „GING ES AUF?" STEHT HIER MIT ABSICHT NICHT IN DER AUSSAGE. In den freien
   * Beruehrungen liegen neun Anfangsstellen fuer die Folge, ein Ecken-Tipper
   * hat dort also rund 3,5 % — das ist der Rest, den jede Bremse laesst, die
   * einen Erwachsenen durchlaesst. Wer daraus eine rote Zeile macht, hat einen
   * Pruefschritt gebaut, der in jedem dreissigsten Lauf grundlos rot ist, und
   * genau die glaubt beim naechsten Mal niemand mehr. Er wird BERICHTET, nicht
   * behauptet.
   */
  const MARKE_ECKEN = 12 + 4 * (1 + Math.ceil(FENSTER_S / 10))
  console.log(
    `    nur-Ecken: ${angenommen} von ${MARKE_ECKEN} zugelassenen Beruehrungen angenommen` +
      (eckenAuf ? ' — DAS TOR GING AUF (der Rest von rund 3,5 % in den freien Tipps)' : ''),
  )
  ja(angenommen <= MARKE_ECKEN,
    `auch das Kind, das NUR in die Ecken tippt, ist gebremst ` +
      `(hoechstens ${MARKE_ECKEN} angenommene Beruehrungen in ${FENSTER_S} s)`,
    `${angenommen} angenommen -> die rund 256 moeglichen Folgen kosten damit ` +
      `Stunden statt Minuten`)

  // Und die Gegenrichtung: die richtige Folge muss weiterhin oeffnen. Eine
  // Sperre, die niemanden mehr durchlaesst, ist keine Verbesserung.
  //
  // ── ERST DIE BREMSE ABSITZEN, UND ZWAR SEIT DEM 06.08.2026 ──────────────
  // Bis hierher stand hier nur `neuLaden()`, und das genuegte: die Bremse lag
  // allein im Speicher der Seite, ein Neuladen wischte sie weg. GENAU DAS WAR
  // EINE LUECKE (gemessen mit tools/kind-neben-dem-tor.mjs: Profilwechsel ->
  // location.reload() -> 30 Sekunden Bremse fuer zwei Beruehrungen weg), und
  // sie ist geschlossen — beide Bremsen liegen jetzt im `sessionStorage`
  // (app.js, `bremseSichern`).
  //
  // DIESE ZEILEN SIND DESHALB KEINE ABSCHWAECHUNG DER PRUEFUNG, sondern ihre
  // Wiederherstellung: Der Erwachsene, den diese Aussage meint, sieht „Zu
  // viele Versuche. Noch N Sekunden." und WARTET. Ein Werkzeug, das statt
  // dessen neu laedt, misst nicht den Erwachsenen, sondern die Luecke — und
  // haette ihre Behebung als Fehlschlag gemeldet. Gewartet wird hoechstens
  // die hoechste Stufe (60 s) plus Luft; laeuft es laenger, ist das ein
  // echter Befund und die Aussage faellt.
  await neuLaden()
  await hinein()
  {
    const bis = Date.now() + 75000
    for (;;) {
      const m = (await schirm()).meldung || ''
      const rest = Number((m.match(/Noch (\d+) Sekunde/) || [])[1] || 0)
      if (!rest || Date.now() > bis) break
      await warte((rest + 1) * 1000)
    }
  }
  await folgeTippen([eckPunkt(0), eckPunkt(1), eckPunkt(2), eckPunkt(3)])
  s = await schirm()
  ja(s.flaeche && !s.tor && s.faecher === 4,
    'die richtige Folge oeffnet weiterhin',
    `Flaeche ${s.flaeche ? 'da' : 'weg'}, ${s.faecher} Faecher`)

  // ═══════════════════════════════════════════════════════════════════════
  //  3. AM TOR VORBEI — die Knoepfe, die gar nicht durch das Tor gehen
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══ 3. Geht es am Tor VORBEI? ══')

  /*
   * BIS ZUM 06.08.2026 TRUG DER EINE KNOPF ZWEI GESTEN: langes Halten aufs
   * Zahnrad `#einst-knopf` oeffnete den Eltern-Bereich MIT Tor, kurzes Tippen
   * sprang unmittelbar nach `/settings` — in die ALTE Oberflaeche, an der
   * neuen Sperre vorbei. Ob dort ein zweiter Waechter steht, entscheidet eine
   * andere Datei (`sperrlogik.ts`), und die kennt „geste" nicht und liest
   * einen FEHLENDEN Schluessel als „aus". Auf genau der Box, um die es geht,
   * war der kurze Tipp damit die Abkuerzung. Genau dieser Befund stammt aus
   * dieser Datei, und er hat das Zahnrad gekostet.
   *
   * SEITHER GIBT ES DAS ZAHNRAD NICHT MEHR. Der Einstieg ist der Schriftzug
   * `#wappen`, und er traegt genau EINE Geste: 1200 ms halten. DIE FRAGE IST
   * DIESELBE GEBLIEBEN und wird hier nur schaerfer gestellt — ein kurzer Tipp
   * darf nicht nur nicht springen, er darf UEBERHAUPT NICHTS tun.
   *
   * `#bt-knopf` steht unveraendert in der Kopfzeile und wird unveraendert
   * gefragt: verlaesst ein kurzer Tipp die Oberflaeche, waehrend eine Sperre
   * gesetzt ist?
   */
  for (const lage of ['sperre-fehlt', 'sperre-rechnen', 'sperre-geste', 'sperre-pin']) {
    for (const knopf of ['wappen', 'bt-knopf']) {
      await stand(lage)
      await neuLaden()
      const weg = await kurzTippen(knopf)
      const wort = `${lage.replace('sperre-', '').padEnd(7)} #${knopf}`
      if (weg === null) {
        // Der Knopf steht in dieser Lage gar nicht da (`#bt-knopf` erscheint
        // nur mit verbundenem Geraet). Das ist keine Aussage ueber die Sperre
        // — also wird auch keine behauptet.
        console.log(`    –     ${wort}: steht in dieser Lage nicht im Baum`)
        continue
      }
      const geblieben = weg.startsWith('/neu')
      const x = geblieben ? await schirm() : null
      if (knopf === 'wappen') {
        ja(geblieben && x.bereich === false,
          `${wort}: der kurze Tipp tut GAR NICHTS — kein Sprung, kein Bereich`,
          geblieben
            ? `geblieben auf ${weg}, Bereich ${x.bereich ? 'GING AUF' : 'bleibt zu'}`
            : `sprang nach ${weg} — an der Sperre vorbei`)
        continue
      }
      ja(geblieben && x.tor === true,
        `${wort}: der kurze Tipp fuehrt durch das TOR, nicht daran vorbei`,
        geblieben
          ? `geblieben auf ${weg}, Tor ${x.tor ? 'steht' : 'FEHLT'}`
          : `sprang nach ${weg} — an der Sperre vorbei`)
    }
  }

  // ── DIE ALTE OBERFLAECHE MUSS ERREICHBAR BLEIBEN ────────────────────────
  //
  // BIS ZUM 06.08.2026 STAND HIER: „Wer die Aufgabe loest, will nach
  // `/settings` — nicht in den Eltern-Bereich. Ein Tor, das das Ziel unterwegs
  // verliert, ist eine Bedienung, die man kein zweites Mal versucht." Der
  // Satz galt fuer den KURZEN TIPP aufs Zahnrad: der hatte `/settings` als
  // Ziel, und das Tor durfte es ihm nicht wegnehmen.
  //
  // DAS ZAHNRAD IST WEG, UND MIT IHM DIESES ZIEL. Der einzige Weg fuehrt
  // heute in den Admin-Bereich, und `/settings` ist eine ZEILE darin
  // („Weitere Einstellungen ↗", ELTERN_PUNKTE in app.js). DIE AUSSAGE
  // DAHINTER GILT WEITER und wird deshalb hier neu gestellt: Wer die Aufgabe
  // loest, muss die alte Oberflaeche noch erreichen koennen — sonst ist sie
  // mit dem Zahnrad verschwunden.
  await stand('sperre-rechnen')
  await neuLaden()
  await hinein()
  s = await schirm()
  let ziel = null
  if (s.tor) {
    const z = s.frage.match(/(\d+)\s*[x×*]\s*(\d+)/)
    if (z) {
      await antworten(Number(z[1]) * Number(z[2]))
      await warte(900)
      ziel = await zuSettings()
    }
  }
  ja(ziel === '/settings',
    'nach geloester Aufgabe ist die alte Oberflaeche noch erreichbar (/settings)',
    ziel === null ? 'gar kein Tor gestanden' : `gelandet auf ${ziel}`)

  // ═══════════════════════════════════════════════════════════════════════
  //  4. DIE ANDERE RICHTUNG — sperrt es einen ERWACHSENEN aus?
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══ 4. Sperrt es den Erwachsenen aus? ══')

  await stand('sperre-kaputt')
  await neuLaden()
  await hinein()
  s = await schirm()
  ja(s.bereich && !s.tor && s.flaeche,
    'unlesbare Konfiguration sperrt niemanden aus (der alte Vertrag)',
    `Tor ${s.tor ? 'STEHT' : 'faellt'}, ${s.faecher} Faecher`)
  // ZUERST NEU LADEN: der Bereich steht gerade offen und deckt als
  // Vollbildflaeche den Einstieg zu — ein Tipp darauf traefe die Flaeche und
  // nicht den Knopf. Der erste Anlauf dieses Werkzeugs mass genau das und
  // meldete einen Fehler, den es nicht gab.
  //
  // FRUEHER STANDEN HIER ZWEI SAETZE UEBER DEN KURZEN TIPP: „und der kurze
  // Tipp kommt bei unlesbarer Konfiguration weiterhin durch" und
  // „ausdrueckliches „aus" laesst den kurzen Tipp wie bisher durch". Beide
  // galten fuer das Zahnrad, das eine zweite Geste nach `/settings` trug. Es
  // ist am 06.08.2026 ersatzlos entfallen. WAS SIE WIRKLICH BEHAUPTETEN —
  // dass ein Erwachsener in diesen beiden Lagen die alte Oberflaeche noch
  // erreicht —, steht jetzt hier, und zwar auf dem Weg, den es noch gibt.
  await neuLaden()
  await hinein()
  const wegKaputt = await zuSettings()
  ja(wegKaputt === '/settings',
    'und bei unlesbarer Konfiguration ist die alte Oberflaeche erreichbar',
    `gelandet auf ${wegKaputt}`)

  await stand('sperre-aus')
  await neuLaden()
  await hinein()
  const wegAus = await zuSettings()
  ja(wegAus === '/settings',
    'ausdrueckliches „aus" laesst ohne Tor hinein und weiter zur alten Oberflaeche',
    `gelandet auf ${wegAus}`)

  // ── UEBERLEBT „frei" EIN NEULADEN? ──────────────────────────────────────
  // Der Kiosk laedt nach einem Absturz neu. Bliebe die Freigabe erhalten,
  // stuende der Bereich danach offen da, ohne dass jemand gefragt wurde.
  await stand('sperre-rechnen')
  await neuLaden()
  await hinein()
  s = await schirm()
  const z2 = s.frage.match(/(\d+)\s*[x×*]\s*(\d+)/)
  if (z2) await antworten(Number(z2[1]) * Number(z2[2]))
  s = await schirm()
  const warOffen = s.flaeche === true
  await neuLaden()
  await hinein()
  s = await schirm()
  ja(warOffen && s.tor && !s.flaeche,
    'nach einem Neuladen steht das Tor wieder',
    warOffen ? `Tor ${s.tor ? 'steht' : 'FEHLT'}, ${s.faecher} Faecher` : 'war vorher gar nicht offen')

  // ═══════════════════════════════════════════════════════════════════════
  //  5. DIE ECHTE BOX — nur lesen, und nur wenn ausdruecklich verlangt
  // ═══════════════════════════════════════════════════════════════════════
  if (BOX) {
    console.log('\n══ 5. Die echte Box (nur gelesen) ══')
    const k = await (await fetch(new URL('/api/config', BOX), { signal: AbortSignal.timeout(4000) })).json()
    const wert = k && k.mupibox ? k.mupibox.einstellungssperre : undefined
    console.log(`    mupibox.einstellungssperre = ${JSON.stringify(wert)}`)
    console.log(`    mupibox.oberflaeche        = ${JSON.stringify(k?.mupibox?.oberflaeche)}`)
    await send(ws, 'Page.navigate', { url: new URL('/settings', BOX).toString() })
    await warte(4000)
    const dort = await ev(`(() => ({
      pfad: location.pathname,
      dialog: document.querySelectorAll('ion-modal').length,
      eintraege: document.querySelectorAll('ion-item, ion-card, ion-list ion-label').length,
      text: (document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 160),
    }))()`)
    console.log(`    /settings -> ${JSON.stringify(dort)}`)
    ja(dort.dialog > 0 || dort.pfad !== '/settings',
      'die ALTE Oberflaeche fragt auf /settings ebenfalls nach',
      dort.dialog > 0 ? `${dort.dialog} Dialog(e)` : `steht offen auf ${dort.pfad}: ${dort.text}`)
  }
} finally {
  if (lageVorher && lageVorher.stand) {
    try {
      await fetch(new URL(`/vorschau/${lageVorher.stand}`, ZIEL))
    } catch {
      /* die geliehene Vorschau ist weg — dann gibt es nichts zurueckzulegen */
    }
  }
  await chrome?.schliessen?.()
  vorschau?.kill()
}

const schlecht = befunde.filter((b) => !b.gut)
console.log(`\n${befunde.length - schlecht.length} von ${befunde.length} Aussagen halten.`)
if (schlecht.length) {
  console.log('\nOFFEN:')
  for (const b of schlecht) console.log(`  * ${b.wort}${b.dazu ? ` — ${b.dazu}` : ''}`)
}
process.exit(schlecht.length ? 1 : 0)
