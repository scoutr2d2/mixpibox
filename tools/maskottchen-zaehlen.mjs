#!/usr/bin/env node
/**
 * WIE VIELE MASKOTTCHEN STEHEN GLEICHZEITIG AUF EINEM SCHIRM?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Die Regel heisst „hoechstens ein Maskottchen je Bildschirm"
 * (llmwiki [[mixpi-maskottchen-familie]]). Sie ist keine Kosmetik: Das MixPi
 * traegt die STIMMUNG einer Lage — es sucht, es schlaeft, es ist ratlos. Wenn
 * zwei davon nebeneinander stehen, sagen sie zwei Dinge gleichzeitig, und ein
 * Kind lernt, dass die Figur nichts bedeutet.
 *
 * SIE IST NICHT AUTOMATISCH ZU PRUEFEN GEWESEN, und deshalb ist sie am
 * 05.08.2026 gerissen, ohne dass es jemand sah: Bis dahin stand oben links im
 * Zeichen „wer hoert" eine SILHOUETTE (kein Maskottchen), seitdem steht dort
 * bei leerer Wahl das MixPi. Dadurch wurde jedes ZWEITE Maskottchen auf dem
 * Schirm zum zweiten — die Zaehlung aendert sich an einer Stelle, die mit dem
 * Zaehlen nichts zu tun hat.
 *
 * ══ WAS EIN MASKOTTCHEN IST ════════════════════════════════════════════════
 * Ein <img>, dessen geladene Quelle auf `mixpi-*.png` endet UND das wirklich
 * zu sehen ist. „Zu sehen" wird GETASTET (`document.elementFromPoint`) und
 * nicht gerechnet: `getBoundingClientRect` kennt weder `overflow: hidden`
 * eines Vorfahren noch eine Ebene darueber. Ein Bild meldet seine vollen
 * 44x44 px und ist trotzdem verdeckt — genau der Fall des Zeichens `#ich`
 * unter dem grossen Player.
 *
 * DIE FIGUR EINES KINDES ZAEHLT MIT. Sie IST ein MixPi (llmwiki
 * [[mixpi-die-geschichte]]: „MixPis sind eine ART"). Wer sie nicht mitzaehlt,
 * bekommt fuer „Kind hat sich eins ausgesucht" eine Null und uebersieht, dass
 * daneben ein zweites steht.
 *
 * ══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════
 * Es urteilt nicht darueber, ob ein zweites Maskottchen an einer Stelle
 * VERTRETBAR ist. Es sagt, WO und WELCHE. Das Urteil steht im Wissenspaket.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/maskottchen-zaehlen.mjs
 *     node tools/maskottchen-zaehlen.mjs --port 8512
 *     node tools/maskottchen-zaehlen.mjs --nur fenster
 *
 * ENDE 0, wenn keine Lage MEHR Maskottchen zeigt als hier erwartet. Die
 * Erwartung steht bei jeder Lage und ist eine ENTSCHEIDUNG, kein Messwert.
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const PORT = Number(opt('port', 8512))
const NUR = typeof opt('nur', null) === 'string' ? String(opt('nur')) : null
/** `--bild /tmp/mask` legt je Lage ein PNG ab. Das Auge sieht, was die Zahl nicht sagt. */
const BILD = typeof opt('bild', null) === 'string' ? String(opt('bild')) : null
const ZIEL = `http://127.0.0.1:${PORT}/neu/`

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let schlecht = 0

// ── Vorschau leihen, eigener Browser ───────────────────────────────────────
//
// BEIDES UEBER tools/leihgabe.mjs, aus den dort gemessenen Gruenden: Die
// Vorschau wird geliehen und am Ende genau so zurueckgelegt (laeuft keine,
// startet die Leihgabe eine eigene auf dem Zielport). Und der Browser kommt
// auf einem FREIEN Port mit eigenem Profil — eine feste Nummer kann ein
// Ueberlebender eines harten Abbruchs halten, und /json/list liefert dann
// klaglos die Ziele des Fremden.
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

/**
 * DIE ZAEHLUNG, in der Seite ausgefuehrt.
 *
 * GREIFBAR IST NICHT DASSELBE WIE SICHTBAR, und das ist hier der ganze Witz.
 * `elementFromPoint` sagt, was ein FINGER trifft. Ein Kind zaehlt aber mit den
 * AUGEN. Das Fenster „wer hoert" liegt mit `rgba(46,42,59,0.42)` ueber dem
 * Schirm — 42 % Deckung: der Finger kommt nicht mehr durch, das Bild
 * darunter ist trotzdem zu sehen. Wer nur hit-testet, zaehlt es faelschlich
 * NICHT mit und meldet Ruhe, wo zwei Figuren nebeneinander stehen.
 *
 * Deshalb drei Lagen je Bild:
 *   greifbar     — ein Punkt der Flaeche trifft das Bild selbst
 *   durchschimmernd — verdeckt, aber JEDE deckende Ebene ist durchsichtig
 *   verdeckt     — mindestens eine deckende Ebene ist undurchsichtig
 * Gezaehlt werden die ersten beiden.
 */
const ZAEHL_JS = String.raw`
(() => {
  /** Deckt dieses Element wirklich zu, oder scheint es durch? */
  const deckt = (t) => {
    for (let n = t; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n)
      const m = /rgba?\(([^)]+)\)/.exec(s.backgroundColor)
      const a = m ? Number(m[1].split(',')[3] ?? 1) : 1
      if (s.backgroundImage !== 'none') return true
      if (a >= 0.95) return true
      if (a > 0) return false
      // voellig durchsichtig: weitersuchen, ob ein Kasten darin deckt
    }
    return false
  }
  const raus = []
  for (const e of document.querySelectorAll('img')) {
    const q = e.currentSrc || e.getAttribute('src') || ''
    const name = q.split('/').pop() || ''
    if (!/^mixpi-[a-z0-9-]+\.png$/.test(name)) continue
    if (e.hidden || !e.isConnected) continue
    if (!e.complete || e.naturalWidth < 1) continue
    const r = e.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const s = getComputedStyle(e)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.05) continue
    /* ── SICHTBAR IST NICHT DASSELBE WIE ANTIPPBAR ────────────────────────
     *
     * Gezaehlt wird, was ein Kind SIEHT — nicht, was es treffen kann.
     * elementFromPoint beantwortet aber die zweite Frage: ein Element unter
     * pointer-events:none wird stillschweigend uebersprungen, und der Punkt
     * faellt auf das, was dahinter liegt. Genau so verschwand am 06.08.2026
     * das Zeichen „wer hoert" aus dieser Zaehlung: Der Eltern-Bereich legt es
     * seither SICHTBAR still (gedaempft, disabled, pointer-events:none),
     * und der Punkt landete auf der Leiste dahinter — gemeldet als „verdeckt".
     * Ein Maskottchen, das dasteht und als „weg" gezaehlt wird, ist die
     * gefaehrlichere Richtung dieses Fehlers: es macht die Regel „hoechstens
     * eines je Bildschirm" bequem gruen.
     *
     * FUER DIE DAUER DER MESSUNG WIRD DAS ABGESCHALTET und danach genau so
     * zurueckgelegt, wie es war (auch der Fall „stand gar kein eigener Wert
     * da" — sonst bliebe eine Zeile Stil zurueck, die niemand geschrieben
     * hat). Damit misst der Punkttest wieder die REIHENFOLGE DER EBENEN, und
     * das ist die Frage, die hier gestellt wird. */
    const zurueck = []
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).pointerEvents !== 'none') continue
      zurueck.push([n, n.style.pointerEvents, n.style.getPropertyPriority('pointer-events')])
      n.style.setProperty('pointer-events', 'auto', 'important')
    }

    let lage = 'verdeckt'
    const xs = [r.left + r.width / 2, r.left + 2, r.right - 2]
    const ys = [r.top + r.height / 2, r.top + 2, r.bottom - 2]
    for (const x of xs) for (const y of ys) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue
      const t = document.elementFromPoint(x, y)
      if (!t) continue
      if (t === e || e.contains(t) || t.contains(e)) { lage = 'greifbar'; continue }
      if (lage === 'verdeckt' && !deckt(t)) lage = 'durchschimmernd'
    }
    for (const [n, wert, wichtig] of zurueck) {
      if (wert) n.style.setProperty('pointer-events', wert, wichtig)
      else n.style.removeProperty('pointer-events')
    }
    /* STILLGELEGT IST EIN EIGENES WORT UND KEIN Sonderfall von „greifbar":
       Es steht da, es traegt eine Miene, es ist NICHT zu bedienen. Wer das
       zusammenwirft, kann spaeter nicht mehr sehen, ob ein Zeichen aus
       Absicht oder aus Versehen tot ist. */
    if (zurueck.length && lage !== 'verdeckt') lage = 'stillgelegt'
    if (lage === 'verdeckt') continue
    // STIMMUNGSTRAEGER ODER KATALOGPLATZ — die Regel (3) meint die ersten.
    //
    // „Hoechstens eines je Bildschirm" steht im Wissenspaket zwischen zwei
    // Regeln, die beide von der STIMMUNG handeln: nie ohne Text, nie als
    // Ladeanzeige. Zwei Figuren mit verschiedenen Mienen nebeneinander sagen
    // zwei Dinge gleichzeitig — DAS ist der Schaden. Ein Gitter, in dem ein
    // Kind sich ein Bild AUSSUCHT, sagt gar nichts; es zeigt Vorrat. Ebenso
    // das Ersatzcover, das bei einem Dienstausfall in jeder Kachel steht —
    // dafuer nennt das Wissenspaket ausdruecklich eine Ausnahme.
    //
    // GEZAEHLT WERDEN BEIDE, GEURTEILT WIRD UEBER DIE STIMMUNGSTRAEGER. Wer
    // die Katalogplaetze wegliesse, sieht nicht mehr, wenn ein Ersatzcover
    // ploetzlich den ganzen Schirm traegt.
    const wo = e.id ? '#' + e.id : String(e.className || e.parentElement?.className || '?')
    const katalog = /ich-kachel-bild|kachel-bild|mp-cover|gr-cover/.test(wo)
    raus.push({
      bild: name, lage, art: katalog ? 'katalog' : 'stimmung',
      wo,
      x: Math.round(r.left), y: Math.round(r.top),
      b: Math.round(r.width), h: Math.round(r.height),
    })
  }
  return raus
})()`

/**
 * DIE LAGEN. `stell` sind Vorschau-Schalter, `tu` ist JavaScript in der Seite
 * (ein Tipp, ein Fenster oeffnen). `erwartet` ist die HOECHSTZAHL, die hier
 * noch in Ordnung geht — mit Begruendung, sonst ist es nur eine Zahl.
 */
const LAGEN = [
  {
    name: 'start-vorgabe',
    was: 'Startseite, niemand gewaehlt, Figurenordner leer — der heutige Stand der Box',
    stell: ['voll', 'mit-cover', 'profil-gast', 'figuren-keine', 'still'],
    erwartet: 1,
    warum: 'nur das Zeichen oben links',
  },
  {
    name: 'start-kind-mit-bild',
    was: 'Ein Kind hat sich ein eigenes Bild ausgesucht (im Fenster gewaehlt, dann zu)',
    stell: ['voll', 'mit-cover', 'figuren-da', 'profil-gast', 'still'],
    tu: `(async () => {
      document.getElementById('ich').click()
      await new Promise((r) => setTimeout(r, 500))
      // Die zweite Kachel im Gitter ist die erste ECHTE Figur (die erste ist
      // „MixPi" = die Vorgabe).
      document.querySelectorAll('#ich-bilder .ich-kachel')[2].click()
      await new Promise((r) => setTimeout(r, 600))
      document.getElementById('ich-fenster').hidden = true
    })()`,
    erwartet: 1,
    warum: 'die Figur des Kindes ist selbst ein MixPi (llmwiki mixpi-die-geschichte)',
  },
  {
    name: 'meldung-kinderzeit',
    was: 'Die Box lehnt ab — Meldung mit dem schlafenden MixPi ueber der Startseite',
    stell: ['voll', 'mit-cover', 'profil-gast', 'figuren-keine', 'still', 'kinderzeit'],
    tu: `(async () => {
      document.querySelector('.kachel')?.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`,
    erwartet: 1,
    warum: 'die Meldung traegt die Stimmung „Ruhezeit", das Zeichen oben links eine zweite',
  },
  {
    name: 'start-ohne-cover',
    was: 'Werke ohne Coverbild — der Ersatz ist mixpi-kein-bild',
    stell: ['voll', 'ohne-cover', 'profil-gast', 'figuren-keine', 'still'],
    erwartet: 1,
    warum: 'BEKANNT UND ENTSCHIEDEN: das Ersatzcover steht so oft da, wie Werke ohne Bild sind',
    nachsehen: true,
  },
  {
    name: 'leere-bibliothek',
    was: 'Die Bibliothek ist leer — MixPi mit der Lupe',
    stell: ['leer', 'profil-gast', 'figuren-keine', 'still'],
    erwartet: 1,
    warum: 'die Lupe traegt die Stimmung; das Zeichen oben links traegt eine zweite',
  },
  {
    name: 'medienliste-kaputt',
    was: '/api/werke antwortet 500 — MixPi mit dem Warndreieck',
    stell: ['kaputt', 'profil-gast', 'figuren-keine', 'still'],
    erwartet: 1,
    warum: 'dasselbe wie leer, nur ratlos statt suchend',
  },
  {
    name: 'fenster-ohne-figuren',
    was: 'Das Fenster „wer hoert" offen, Figurenordner leer',
    stell: ['voll', 'mit-cover', 'profil-gast', 'figuren-keine', 'still'],
    tu: `document.getElementById('ich').click()`,
    erwartet: 1,
    warum: 'die Kachel „MixPi" IM Fenster und das Zeichen daneben zeigen dasselbe Bild',
  },
  {
    name: 'fenster-mit-figuren',
    was: 'Das Fenster „wer hoert" offen, zehn Figuren zur Wahl',
    stell: ['voll', 'mit-cover', 'figuren-da', 'profil-gast', 'still'],
    tu: `document.getElementById('ich').click()`,
    erwartet: 1,
    warum: 'ein Gitter zur AUSWAHL ist ein Katalog, kein Stimmungstraeger — aber das Zeichen daneben ist einer',
    nachsehen: true,
  },
  {
    name: 'spielt-ohne-cover',
    was: 'Es laeuft etwas, das Werk hat kein Cover — der Mini-Player faellt auf mixpi-kein-bild',
    stell: ['voll', 'ohne-cover', 'profil-gast', 'figuren-keine', 'spielt'],
    erwartet: 1,
    warum: 'BEKANNT: das Ersatzcover ist die Ausnahme von Regel (1), aber nicht von Regel (3)',
    nachsehen: true,
  },
  {
    name: 'eltern-bereich',
    was: 'Der Eltern-Bereich offen',
    stell: ['voll', 'mit-cover', 'profil-gast', 'figuren-keine', 'still', 'sperre-aus'],
    // HIER STAND ERST `einst-knopf.click()` — ein KURZER Tipp aufs Zahnrad,
    // und der ging seit je weiter nach /settings. Diese Lage hat also nie den
    // Eltern-Bereich gemessen, sondern eine andere Seite; sie meldete 0
    // Stimmungstraeger und war damit bequem gruen. Aufgefallen am 06.08.2026.
    // Danach stand hier ein 900-ms-Halten aufs Zahnrad. DAS ZAHNRAD IST AM
    // ABEND DESSELBEN TAGES ERSATZLOS ENTFALLEN; hinein fuehrt der Schriftzug
    // `#wappen`. Hier steht der TASTATURWEG (Enter auf dem Knopf) — er ist
    // eine echte Bedienung und prueft das Halten NICHT (tools/admin-weg.mjs);
    // gezaehlt werden in dieser Datei Stimmungstraeger, nicht Gesten.
    tu: `(async () => {
      const k = document.getElementById('wappen')
      if (!k) throw new Error('#wappen fehlt — siehe tools/admin-weg.mjs')
      k.focus()
      k.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 900))
      if (document.getElementById('eltern').hidden)
        throw new Error('der Admin-Bereich blieb zu — sonst zaehlt diese Lage nichts')
    })()`,
    erwartet: 1,
    // DIE BEGRUENDUNG IST BERICHTIGT, NICHT ERSETZT. Sie lautete: „`.eltern`
    // traegt `background: var(--bg)` — undurchsichtig, das Zeichen ist hier
    // WIRKLICH weg". DAS GALT, solange der Bereich ein Deckel war
    // (`inset: 0`). Seit dem 06.08.2026 ist er eine SEITE ab x 88 (Betreiber:
    // „ich finde den entwurf gut wo nicht alles zu gedeckt ist"), und das
    // Zeichen steht bei x 8..74 daneben — SICHTBAR, aber stillgelegt
    // (gedaempft, `disabled`). Es ist damit ein Stimmungstraeger, und einer
    // ist erlaubt. Waehrend etwas SPIELT waeren es zwei, denn dann traegt auch
    // das Kissen ein Cover — deshalb steht `still` in der Lage oben, und das
    // ist keine Bequemlichkeit, sondern die Lage, in der ein Erwachsener
    // Einstellungen macht.
    warum: 'der Bereich ist eine SEITE und deckt das Zeichen nicht mehr zu; es steht gedaempft daneben — ein Traeger, nicht zwei',
  },
  {
    name: 'grosser-player',
    was: 'Der grosse Player ueber allem',
    stell: ['voll', 'mit-cover', 'profil-gast', 'figuren-keine', 'spielt'],
    tu: `document.querySelector('[data-auf]')?.click()`,
    erwartet: 1,
    warum: 'das Zeichen liegt bei z-index 5 und muss hier verschwinden',
  },
]

try {
  // Die Seite kommt aus dem EIGENEN Browser — leihgabe.mjs hat schon
  // nachgewiesen, dass hinter dem Port wirklich er steckt.
  const adresse = await brw.seite()
  if (!adresse) throw new Error('kein Browser erreichbar')
  const ws = new WebSocket(adresse, { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (js) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }

  /**
   * VOR JEDER LAGE ZURUECK AUF NULL — und das ist hier kein Ritual.
   *
   * Die Vorschau MERKT SICH, was ueber `POST /api/profil/figur` gewaehlt
   * wurde (`lage.figurGewaehlt`). Ein Lauf, der einmal eine Figur waehlt,
   * traegt sie in ALLE folgenden Lagen — und dort steht dann ein Name ohne
   * Datei, das Bild schlaegt fehl, die Silhouette springt ein, und die
   * Zaehlung meldet NULL Maskottchen, wo eines steht. Genau das ist beim
   * ersten Lauf dieses Werkzeugs passiert: „leere Bibliothek" fiel von zwei
   * auf eins, ohne dass sich an der Oberflaeche etwas geaendert haette.
   * `POST /api/profil/aktiv` setzt die Wahl in der Attrappe ausdruecklich
   * zurueck (dort steht der Grund: die Figur gehoert dem vorigen Kind).
   */
  const GRUND = ['ok', 'voll', 'mit-cover', 'still', 'figuren-keine', 'profil-gast']

  for (const l of LAGEN) {
    if (NUR && !l.name.includes(NUR)) continue
    await fetch(`http://127.0.0.1:${PORT}/api/profil/aktiv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kennung: 'gast' }),
    })
    for (const s of GRUND) await fetch(`http://127.0.0.1:${PORT}/vorschau/${s}`)
    for (const s of l.stell) await fetch(`http://127.0.0.1:${PORT}/vorschau/${s}`)
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1400)
    if (l.tu) {
      await ev(l.tu)
      await warte(700)
    }
    if (BILD) {
      const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      await writeFile(`${BILD}-${l.name}.png`, Buffer.from(s.data, 'base64'))
    }
    const gefunden = await ev(ZAEHL_JS)
    const stimmung = gefunden.filter((g) => g.art === 'stimmung')
    const katalog = gefunden.filter((g) => g.art === 'katalog')
    const n = stimmung.length
    const gut = n <= l.erwartet
    if (!gut) schlecht++
    console.log(
      `\n${gut ? 'ok  ' : 'NEIN'}  ${l.name}: ${n} Stimmungstraeger` +
        `${katalog.length ? ` (+ ${katalog.length} Katalogplaetze)` : ''}` +
        ` — erwartet hoechstens ${l.erwartet}`,
    )
    console.log(`      ${l.was}`)
    console.log(`      ${l.warum}`)
    for (const g of stimmung) {
      console.log(`        STIMMUNG  ${g.bild}  ${g.lage}  ${g.wo}  bei ${g.x},${g.y}  ${g.b}x${g.h}`)
    }
    const zaehl = new Map()
    for (const g of katalog) zaehl.set(g.bild, (zaehl.get(g.bild) || 0) + 1)
    if (katalog.length) {
      console.log(`        KATALOG   ${katalog.length} Kacheln: ${[...zaehl.keys()].join(', ')}`)
    }
    const mienen = new Set(stimmung.map((g) => g.bild))
    if (mienen.size > 1) console.log(`        ZWEI MIENEN GLEICHZEITIG: ${[...mienen].join(' + ')}`)
  }

  // ══ UND ZULETZT: STEHT ES STILL, WAEHREND ETWAS LAEUFT? ══════════════════
  //
  // DER WUNSCH (Betreiber, 03.08.2026, woertlich): „das mixpi bild soll nicht
  // mehr wechseln beim spielen sondern statisch beim standart bleiben".
  //
  // WARUM EIN BLICK IN DIE QUELLE DAFUER NICHT REICHT: Bis zum 03.08.2026
  // schaltete `kopfMalen` das Bild im Sekundentakt zwischen `mixpi-hoert` und
  // `mixpi-spielt` um — von einem TAKT aus, nicht von der Stelle, an der das
  // Bild gesetzt wird. Eine Regel, die den Spielzustand nicht kennt, beweist
  // deshalb nur, dass DIESE Stelle ihn nicht kennt. Gemessen wird darum das
  // laufende Bild ueber mehrere Takte und ueber einen Titelwechsel hinweg.
  if (!NUR) {
    await fetch(`http://127.0.0.1:${PORT}/api/profil/aktiv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kennung: 'gast' }),
    })
    for (const s of GRUND) await fetch(`http://127.0.0.1:${PORT}/vorschau/${s}`)
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1400)
    const gesehen = new Set()
    const spur = []
    const merken = async (wann) => {
      const q = await ev(`(document.getElementById('ich-bild') || {}).getAttribute
        ? document.getElementById('ich-bild').getAttribute('src') || '' : ''`)
      gesehen.add(q)
      spur.push(`${wann}: ${q.split('/').pop()}`)
    }
    await merken('still')
    for (const s of ['spielt', 'spotify', 'spotify-weiter', 'mpv-weiter', 'pause']) {
      await fetch(`http://127.0.0.1:${PORT}/vorschau/${s}`)
      await warte(1600)
      await merken(s)
    }
    // Zwei weitere Takte OHNE Umschalten — der alte Fehler brauchte gar keinen
    // Zustandswechsel, nur Zeit.
    await warte(2500)
    await merken('nach 2,5 s')
    await warte(2500)
    await merken('nach 5 s')
    const still = gesehen.size === 1
    if (!still) schlecht++
    console.log(`\n${still ? 'ok  ' : 'NEIN'}  bleibt-beim-spielen-stehen: ${gesehen.size} verschiedene Quellen`)
    console.log('      „das mixpi bild soll nicht mehr wechseln beim spielen" (Betreiber, 03.08.2026)')
    for (const z of spur) console.log(`        ${z}`)
  }

  ws.close()
} finally {
  // IM finally: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn eine Lage zu
  // viele Maskottchen zeigte — also genau dann, wenn als naechstes jemand
  // hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log(schlecht ? `\n${schlecht} Lage(n) mit zu vielen Maskottchen.` : '\nKeine Lage mit zu vielen Maskottchen.')
process.exit(schlecht ? 1 : 0)
