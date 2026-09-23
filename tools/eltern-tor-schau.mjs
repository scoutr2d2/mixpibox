#!/usr/bin/env node
/**
 * DAS TOR VOR DEM ELTERN-BEREICH — steht es, und faellt es nur richtig?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Am 06.08.2026 sind zwei Dinge gebaut worden, und beide gehen STILL daneben:
 *
 *   A) DIE VORGABE. `sperrModus()` gab bis dahin bei einem fehlenden Schluessel
 *      „aus" zurueck — und weil auf einer Box, deren Konfiguration aelter ist
 *      als das Feld, genau dieser Schluessel fehlt (an .169 nachgesehen), stand
 *      der Eltern-Bereich dort offen: WLAN, Bluetooth, die rohe
 *      Mediendatenbank samt Loeschknoepfen, das Herunterfahren. Seit dem
 *      06.08. heisst ein fehlender Wert „rechnen".
 *      EINE SPERRE, DIE NICHT SPERRT, SIEHT AM BILDSCHIRM EXAKT SO AUS WIE
 *      EINE, DIE NIEMAND EINGESCHALTET HAT. Nichts wird rot. Deshalb wird hier
 *      die WIRKUNG gemessen: `/api/config` in eine Lage gebracht und dann der
 *      echte Weg hinein gegangen.
 *
 *   B) DIE GESTE. Die vierte Sorte Sperre („geste") ist vier Tipps in die
 *      Ecken der Tor-Flaeche, im Uhrzeigersinn. Sie kann auf zwei
 *      entgegengesetzte Arten falsch sein, und keine davon meldet sich:
 *        * ZU LOCKER — sie geht mit Herumtippen auf. Dann ist sie eine
 *          Verzierung, und man merkt es erst, wenn das Kind drin war.
 *        * ZU STRENG — sie geht mit einem quengelnden Kind auf dem Arm nicht
 *          mehr auf. Dann ist sie eine Aussperrung, und man merkt es erst,
 *          wenn man ins WLAN muesste.
 *      Gemessen wird deshalb BEIDES: dass die richtige Folge oeffnet UND dass
 *      fuenf falsche Folgen es nicht tun.
 *
 * ══ WARUM DIE PRUEFUNG DER REGELN NICHT GENUEGT ════════════════════════════
 * `node tools/pruef-neu-regeln.js` prueft `sperrModus`, `gesteEcke` und
 * `gesteSchritt` als reine Regeln — in Millisekunden und ohne Browser. Das ist
 * die halbe Aussage. Die andere Haelfte ist die Verdrahtung: ob der Zuhoerer
 * ueberhaupt am `#eltern-tor` haengt, ob die Masse, mit denen er rechnet, die
 * der wirklichen Flaeche sind, ob das Ziffernfeld in der Sorte „geste"
 * wirklich weg ist und nicht nur unsichtbar, und ob der eine Rueckweg
 * erreichbar bleibt. Alles vier ist gruen zu haben, waehrend jede Regel stimmt.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums. An der Box wird gar nicht gemessen.
 *
 * ══ WELCHE VORSCHAU, UND WARUM DAS HIER WICHTIGER IST ALS SONST ════════════
 * OHNE ADRESSE STARTET DIESES WERKZEUG SEINE EIGENE Vorschau auf einem
 * FREIEN Port (`freierPort()`), statt eine auf einem festen Port zu leihen.
 * Der Unterschied ist keine Bequemlichkeit: Eine geliehene Vorschau bedient
 * den Arbeitsbaum DESSEN, DER SIE GESTARTET HAT. Als Pruefschritt in
 * tools/rotprobe.py laeuft dieses Werkzeug in einer WEGWERF-ARBEITSKOPIE — es
 * misst dann eine Aenderung, die dort gar nicht steht, und meldet gruen. Das
 * ist die Falle aus [[vorschau-wird-geliehen]] an ihrer teuersten Stelle.
 *
 * Wird eine Adresse MITGEGEBEN, wird die dortige Vorschau geliehen und ihre
 * Lage am Ende wieder hingelegt — dann weiss der Aufrufer, was er tut.
 *
 * Der Browser kommt aus `eigenerBrowser()` und bekommt seinen Debug-Port vom
 * Betriebssystem. `--debug-port` gibt es hier deshalb GAR NICHT: eine Zahl,
 * die man von Hand waehlen kann, ist eine Zahl, die man doppelt waehlen kann.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/eltern-tor-schau.mjs                        eigene Vorschau
 *     node tools/eltern-tor-schau.mjs http://127.0.0.1:8621/neu/   geliehene
 *     node tools/eltern-tor-schau.mjs --bild /tmp/tor        je Lage ein PNG
 *
 * ENDE 0, wenn jede Aussage haelt.
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'
import { adminAufHalten } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = argv.find((a) => a.startsWith('http')) || null
const BILD = typeof opt('bild', null) === 'string' ? opt('bild', null) : null

/** 800x480 auf 5" Waveshare — dieselbe Zahl wie in beruehrziele-neu.mjs. */
const MM_JE_PIXEL = 0.14
/** 9 mm nach ISO 9241-411 (Groesse eines Ziels). */
const MARKE_MM = 9

const mmS = (px) => (px * MM_JE_PIXEL).toFixed(2)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort, dazu })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

// ── Browser ────────────────────────────────────────────────────────────────
if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

// ── Vorschau: eigene oder geliehene ────────────────────────────────────────
//
// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT. Wer eine
// Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen, wenn ihm die
// Vorschau nicht gehoert: sonst misst der naechste Lauf gegen eine Vorschau,
// die jemand anders verstellt hat. Laeuft unter ZIEL noch keine, startet
// vorschauLeihen dort selbst eine und beendet sie mit zurueckgeben().
//
// DIE EIGENE VORSCHAU DARF DIESEN LAUF NICHT UEBERLEBEN. GEMESSEN, NICHT
// BEFUERCHTET (06.08.2026): Als Pruefschritt in tools/rotprobe.py hing dieser
// Lauf 26 Minuten und meldete dabei NICHTS — `eigenerBrowser()` scheiterte
// (das Wegwerf-/tmp war voll gelaufen), der Aufruf stand AUSSERHALB des
// `try`/`finally`, die Vorschau wurde nie beendet, und ein `spawn`-Kind haelt
// die Ereignisschleife von Node am Leben. Deshalb wird der Browser unten
// INNERHALB des `try` geholt, und `zurueckgeben()` steht im `finally`.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
let ZIEL = MITGEGEBEN
if (!ZIEL) {
  // Ohne Adresse: ein freier Port — vorschauLeihen startet dort gleich die
  // eigene Vorschau (ausdruecklich mit `--port`, nicht auf dem Vorgabeport
  // 8299, der womoeglich einem anderen Arbeitsbaum gehoert).
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
}
const leihe = await vorschauLeihen(ZIEL)

/** Wird im `try` unten geholt — ein Fehlschlag dort muss ins `finally`. */
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

/**
 * DIE SIEBEN LAGEN DER KONFIGURATION, und was jede bedeuten MUSS.
 *
 * `fehlt`, `leer` und `quatsch` sind drei verschiedene Aussagen und bekommen
 * heute dieselbe Antwort — das ist eine ENTSCHEIDUNG („aus bekommt nur, wer
 * aus hinschreibt") und keine Selbstverstaendlichkeit. Sie stehen deshalb
 * einzeln da; faellt eine von ihnen um, sieht man welche.
 */
const LAGEN = [
  { stand: 'sperre-fehlt', wort: 'der Schluessel FEHLT ganz (der Fall der Box .169)', tor: true, unter: 'mit Rechenaufgabe gesperrt' },
  { stand: 'sperre-leer', wort: 'der Schluessel steht da, aber leer', tor: true, unter: 'mit Rechenaufgabe gesperrt' },
  { stand: 'sperre-quatsch', wort: 'ein Wort, das es nicht gibt', tor: true, unter: 'mit Rechenaufgabe gesperrt' },
  // BEI „aus" STEHT DIE UNTERZEILE NICHT STILL: `faecherMalen` schreibt
  // „offen", und sobald die Bluetooth-Auskunft da ist, schreibt `btMalen`
  // „Bluetooth · …" darueber. Beides ist richtig; gemessen wird deshalb, was
  // sie NICHT sagen darf.
  { stand: 'sperre-aus', wort: 'ausdruecklich „aus" — der Wille des Benutzers gewinnt', tor: false, unterNicht: /gesperrt/ },
  { stand: 'sperre-rechnen', wort: 'Rechenaufgabe', tor: true, unter: 'mit Rechenaufgabe gesperrt' },
  { stand: 'sperre-pin', wort: 'PIN', tor: true, unter: 'mit PIN gesperrt' },
  { stand: 'sperre-geste', wort: 'Geste', tor: true, unter: 'mit Geste gesperrt' },
]

try {
  // `eigenerBrowser()` kehrt erst zurueck, wenn eine Seite da ist UND der Port
  // nachweislich dem eigenen Browser gehoert — hier ist also nichts mehr zu
  // pollen und nichts mehr zu pruefen. Es steht INNERHALB des `try`, weil ein
  // Fehlschlag sonst die Vorschau stehen liesse (siehe oben).
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
    await warte(1500)
  }
  const bild = async (name) => {
    if (!BILD) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${BILD}-${name}.png`, Buffer.from(s.data, 'base64'))
  }

  /** Eine echte Beruehrung an einer Stelle — Nieder und Hoch, wie ein Finger. */
  const tippen = async (x, y, halteMs = 40) => {
    const gem = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, pointerType: 'touch' }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...gem })
    await warte(halteMs)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...gem })
    await warte(60)
  }

  /**
   * DER ECHTE WEG HINEIN: 800 ms halten auf dem Zahnrad.
   *
   * Nicht `eltern.auf()` aufrufen — das misst den Aufruf und nicht die
   * Bedienung. Zwischen Aufruf und Bedienung liegt genau das, was hier
   * kaputtgehen kann.
   */
  const hinein = async () => {
    // BIS ZUM 06.08.2026 FUEHRTE DAS ZAHNRAD `#einst-knopf` HINEIN, 800 ms
    // gehalten. Es ist ersatzlos entfallen; hinein fuehrt der Schriftzug
    // `#wappen`, WAPPEN_HALTEN_MS = 1200 ms gehalten. Dieses Werkzeug hat eine
    // echte Druckfunktion und geht deshalb den ECHTEN Weg, nicht den
    // Tastaturweg (tools/admin-weg.mjs).
    await adminAufHalten(ev, tippen, { warteMs: 900 })
  }

  /*
   * Was steht am Schirm? Sichtbarkeit ueber die WIRKLICHEN Rechtecke, nicht
   * ueber das `hidden`-Merkmal — ein `display: grid` schlaegt `hidden`, und
   * genau diese Sorte Fehler soll hier auffallen (`.tor-feld` brauchte dafuer
   * eine eigene Zeile im Stilblatt).
   *
   * UND NICHT UEBER `offsetParent`: `#eltern` steht `position: fixed`, und
   * dafuer ist `offsetParent` IMMER null. Der erste Anlauf dieses Werkzeugs
   * meldete deshalb „Bereich weg" fuer einen Bereich, der gut sichtbar den
   * ganzen Schirm einnahm — acht rote Zeilen, die nichts ueber die Box sagten.
   */
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
      const rw = document.getElementById('zurueck')
      const rr = rw ? rw.getBoundingClientRect() : null
      const rmitte = rr && rr.width > 0
        ? document.elementFromPoint(Math.round(rr.left + rr.width / 2), Math.round(rr.top + rr.height / 2))
        : null
      return {
        bereich: sicht('eltern'),
        tor: sicht('eltern-tor'),
        flaeche: sicht('eltern-flaeche'),
        feld: sicht('tor-feld'),
        tasten: [...document.querySelectorAll('.tor-taste')].filter((k) => !!k.offsetParent).length,
        faecher: document.querySelectorAll('.fach-knopf').length,
        unter: (document.getElementById('eltern-unter') || {}).textContent || '',
        frage: (document.getElementById('tor-frage') || {}).textContent || '',
        anzeige: (document.getElementById('tor-anzeige') || {}).textContent || '',
        meldung: (document.getElementById('tor-meldung') || {}).textContent || '',
        torLage: r ? { x: Math.round(r.left), y: Math.round(r.top), b: Math.round(r.width), h: Math.round(r.height) } : null,
        rueckwegTrifft: !!(rmitte && (rmitte.id === 'zurueck' || (rw && rw.contains(rmitte)))),
        rueckwegLage: rr ? { x: Math.round(rr.left), y: Math.round(rr.top), b: Math.round(rr.width), h: Math.round(rr.height) } : null,
      } })()`)

  /** Die Mitte einer Ecke der Tor-Flaeche, in Schirmkoordinaten. */
  const eckPunkt = (lage, kante, nr) => {
    const halb = Math.floor(kante / 2)
    const links = lage.x + halb
    const rechts = lage.x + lage.b - 1 - halb
    const oben = lage.y + halb
    const unten = lage.y + lage.h - 1 - halb
    return [
      { x: links, y: oben },
      { x: rechts, y: oben },
      { x: rechts, y: unten },
      { x: links, y: unten },
    ][nr]
  }

  // ══ 1. DIE KETTE: WAS IN DER KONFIGURATION STEHT, UND WAS AM SCHIRM ══════
  console.log('\n══ 1. Was in der Konfiguration steht — und was daraufhin am Schirm steht ══')
  let gesteLage = null
  for (const l of LAGEN) {
    await stand(l.stand)
    await neuLaden()
    await hinein()
    const s = await schirm()
    await bild(l.stand)
    const wort = `${l.stand.replace('sperre-', '').padEnd(8)} ${l.wort}`
    if (l.tor) {
      ja(s.bereich && s.tor && !s.flaeche, `${wort}: das Tor STEHT`,
        `Bereich ${s.bereich ? 'da' : 'weg'}, Tor ${s.tor ? 'da' : 'weg'}, Flaeche ${s.flaeche ? 'OFFEN' : 'zu'}`)
      ja(s.faecher === 0, `${wort}: kein Fach im Baum`,
        `${s.faecher} Faecher — was hinter der Sperre liegt, wird WEGGERAEUMT, nicht zugedeckt`)
    } else {
      ja(s.bereich && !s.tor && s.flaeche, `${wort}: der Bereich ist OFFEN`,
        `Flaeche ${s.flaeche ? 'da' : 'weg'}, ${s.faecher} Faecher`)
    }
    // BEGINNT MIT, NICHT IST GLEICH — und das ist eine bewusste Lockerung mit
    // einem Grund, keine Aufweichung, damit es gruen wird: Seit dem 06.08.2026
    // haengt bei der GESTE ein zweiter Halbsatz an dieser Zeile („beschrieben
    // in der Verwaltung unter …"). Er musste dorthin, weil die Bremse ihn aus
    // der Meldungszeile verdraengte (Begruendung in app.js bei `eltern-unter`).
    // Was die Aussage prueft, bleibt dasselbe: dass die Zeile den ZUSTAND
    // nennt, und zwar zuerst. Ein „mit PIN gesperrt" statt „mit Geste
    // gesperrt" faellt weiterhin durch.
    if (l.unter) ja(s.unter.startsWith(l.unter), `${wort}: die Unterzeile beginnt mit „${l.unter}"`, `steht: „${s.unter}"`)
    else ja(!l.unterNicht.test(s.unter), `${wort}: die Unterzeile sagt NICHT „gesperrt"`, `steht: „${s.unter}"`)
    // DER EINE RUECKWEG IN JEDER EINZELNEN LAGE (E31/P5). Er liegt bei
    // z-index 9 UEBER dem Bereich, und ob er dort auch WIRKLICH getroffen
    // wird, sagt nur ein Treffertest — `rueckweg-schau.mjs` kennt den
    // Eltern-Bereich nicht und meldet ueber ihn „keine Beanstandung", ohne
    // ihn je gestellt zu haben. Ein Bereich ohne Ausgang ist eine Sackgasse
    // vor einem wartenden Kind, und beim PIN-Tor waere sie endgueltig.
    ja(s.rueckwegTrifft, `${wort}: der eine Rueckweg wird getroffen`,
      s.rueckwegLage ? `#zurueck ${s.rueckwegLage.b}x${s.rueckwegLage.h} bei ${s.rueckwegLage.x},${s.rueckwegLage.y}` : 'nicht im Baum')
    if (l.stand === 'sperre-geste') gesteLage = s
  }

  // ══ 2. DIE GESTE — SIE OEFFNET ══════════════════════════════════════════
  console.log('\n══ 2. Die Geste — vier Ecken im Uhrzeigersinn ══')
  ja(!!gesteLage && !!gesteLage.torLage, 'die Tor-Flaeche hat Masse',
    gesteLage?.torLage ? `${gesteLage.torLage.b}x${gesteLage.torLage.h} px bei ${gesteLage.torLage.x},${gesteLage.torLage.y}` : '')

  const torLage = gesteLage.torLage

  /*
   * ── WIE GROSS IST EINE ECKE WIRKLICH? GETASTET, NICHT ABGESCHRIEBEN ──────
   *
   * Eine 120 aus dem Quelltext hier hinzuschreiben waere genau die Sorte Zahl,
   * die auseinanderlaeuft, ohne dass etwas rot wird: aendert jemand
   * `GESTE_ECKE_PX`, misst dieses Werkzeug weiter die alte Kante und meldet
   * gruen. Die Ecke wird deshalb ERTASTET.
   *
   * ══ UND ZWAR SEIT DEM 06.08.2026 AN DER WIRKUNG, NICHT AN DER ANZEIGE ═════
   * Hier stand ein Tastversuch, der die PUNKTE in `#tor-anzeige` auslas: ein
   * Tipp in die Ecke machte einen Punkt, ein Tipp daneben keinen. Das war
   * bequem — und es war genau die Luecke, die `tools/kind-am-tor.mjs` als
   * Warm-Kalt-Orakel nachgewiesen hat. Die Anzeige zaehlt seitdem
   * BERUEHRUNGEN und nicht richtige Ecken; sie beantwortet die Frage „lag das
   * in der Ecke?" nicht mehr, und das ist der Sinn der Aenderung.
   *
   * Getastet wird deshalb an der einzigen Antwort, die das Tor noch gibt: OB
   * ES AUFGEHT. Gefahren wird die ganze Folge mit einem Einzug `d` von jedem
   * Rand; sie oeffnet genau dann, wenn `d` noch innerhalb der Kante liegt.
   * Das ist einsinnig in `d` — also genuegt eine Halbierung mit acht
   * Durchgaengen statt sechzig Einzeltipps.
   */
  const oeffnetBeiEinzug = async (d) => {
    await stand('sperre-geste')
    await neuLaden()
    await hinein()
    for (let nr = 0; nr < 4; nr += 1) {
      const p = eckPunkt(torLage, 2 * d + 1, nr)
      await tippen(p.x, p.y)
      await warte(100)
    }
    const s2 = await schirm()
    return !!s2.flaeche && !s2.tor
  }
  let unten = 0
  let oben = 220
  // Die Halbierung braucht einen Anker: bei Einzug 0 (genau in die Ecke) MUSS
  // es aufgehen, sonst misst das Werkzeug nicht die Kante, sondern einen
  // kaputten Zuhoerer — und meldete sonst still eine Kante von 0.
  const ankerAuf = await oeffnetBeiEinzug(0)
  ja(ankerAuf, 'ein Tipp genau in die Ecke zaehlt (der Anker der Messung)',
    ankerAuf ? '' : 'schon bei Einzug 0 ging nichts auf — die Kante ist nicht messbar')
  while (ankerAuf && oben - unten > 4) {
    const mitteD = Math.floor((unten + oben) / 2)
    if (await oeffnetBeiEinzug(mitteD)) unten = mitteD
    else oben = mitteD
  }
  const KANTE = ankerAuf ? oben : 0
  ja(KANTE > 0, 'die Kante einer Ecke ist an der WIRKUNG getastet, nicht abgeschrieben',
    `${KANTE} px = ${mmS(KANTE)} mm (auf 4 px genau, per Halbierung an der Wirkung)`)
  ja(KANTE * MM_JE_PIXEL >= MARKE_MM, `eine Ecke ist mindestens ${MARKE_MM} mm gross`,
    `${KANTE} px = ${mmS(KANTE)} mm — ein Erwachsener im Stehen zielt in eine ECKE, nicht auf einen Punkt`)
  // UND SIE DARF NICHT ZU GROSS SEIN: decken die vier Ecken die halbe Flaeche,
  // trifft Herumtippen sie staendig, und die Geste ist eine Verzierung.
  const anteil = (4 * KANTE * KANTE) / (torLage.b * torLage.h)
  ja(anteil < 0.3, 'die vier Ecken decken weniger als ein Drittel der Flaeche',
    `${(anteil * 100).toFixed(1)} % — ein zufaelliger Tipp trifft die JEWEILS richtige mit rund 1 : ${Math.round(4 / anteil)}`)
  // DER RUECKWEG DARF IN KEINER ECKE LIEGEN. Laege er darin, verliesse ein
  // Fehlgriff bei der Geste die Oberflaeche, statt die Folge zurueckzusetzen.
  const rw = gesteLage.rueckwegLage
  const inEcke = (p) => {
    const dx = Math.min(p.x - torLage.x, torLage.x + torLage.b - 1 - p.x)
    const dy = Math.min(p.y - torLage.y, torLage.y + torLage.h - 1 - p.y)
    return dx >= 0 && dy >= 0 && dx < KANTE && dy < KANTE
  }
  const rwEcken = rw
    ? [
        { x: rw.x, y: rw.y },
        { x: rw.x + rw.b - 1, y: rw.y },
        { x: rw.x, y: rw.y + rw.h - 1 },
        { x: rw.x + rw.b - 1, y: rw.y + rw.h - 1 },
      ].some(inEcke)
    : true
  ja(!rwEcken, 'der eine Rueckweg liegt in KEINER Ecke der Geste',
    `#zurueck ${rw ? `${rw.b}x${rw.h} bei ${rw.x},${rw.y}` : '?'}, Tor beginnt bei y=${torLage.y}`)

  const gesteGehen = async (folge, pauseMs = 120) => {
    await stand('sperre-geste')
    await neuLaden()
    await hinein()
    for (const nr of folge) {
      const p = typeof nr === 'number' ? eckPunkt(torLage, KANTE, nr) : nr
      await tippen(p.x, p.y)
      await warte(pauseMs)
    }
    return schirm()
  }

  let s = await gesteGehen([0, 1, 2, 3])
  ja(s.flaeche && !s.tor, 'die richtige Folge OEFFNET den Bereich',
    `Flaeche ${s.flaeche ? 'da' : 'weg'}, ${s.faecher} Faecher`)
  /* ══ ES SIND VIER, UND VORHER WAREN ES FUENF ═══════════════════════════
   *
   * HIER STAND `s.faecher === 5` mit der Begruendung: „fuenf ist die gemessene
   * Obergrenze der Spalte — bei sechs fehlen 81 px und sie rollt". DER SATZ
   * GILT WEITER UND WIRD NICHT ABGESCHWAECHT: die Spalte traegt hoechstens
   * fuenf Knoepfe zu 66 px bei 15 px Abstand, das ist nachgerechnet und
   * nachgemessen (tools/eltern-masse-messen.mjs).
   *
   * WAS SICH GEAENDERT HAT, ist nicht die Grenze, sondern was in der Spalte
   * steht: Seit dem 06.08.2026 sind es VIER GRUPPEN (Verbindung, Medien,
   * Darstellung, System) und nicht mehr fuenf flache Faecher. Die elf Punkte
   * liegen eine Ebene tiefer in der Karte. Genau deshalb war der Umbau noetig
   * — die Gliederung des Betreibers hat elf Punkte, und fuenf war die Decke.
   *
   * DIE ZAHL BLEIBT EINE ZAHL und wird nicht zu „mehr als null": Wer eine
   * fuenfte Gruppe dazustellt, soll HIER stolpern und nachrechnen, ob die
   * Spalte sie noch traegt (sie traegt sie — 5 * 66 + 4 * 15 = 390 in 394 —,
   * aber das gehoert gemessen und nicht angenommen).
   */
  ja(s.faecher === 4, 'und dahinter stehen die vier Gruppen', `${s.faecher}`)
  await bild('geste-offen')

  // ══ 3. DIE GESTE — SIE OEFFNET NICHT, WENN SIE NICHT STIMMT ═════════════
  console.log('\n══ 3. Was die Geste NICHT oeffnet ══')
  const mitte = { x: torLage.x + Math.round(torLage.b / 2), y: torLage.y + Math.round(torLage.h / 2) }

  const nichtAuf = [
    { folge: [0, 3, 2, 1], wort: 'dieselben vier Ecken GEGEN den Uhrzeigersinn' },
    { folge: [1, 2, 3, 0], wort: 'im Uhrzeigersinn, aber an der falschen Ecke begonnen' },
    { folge: [0, 0, 0, 0], wort: 'viermal dieselbe Ecke' },
    { folge: [mitte, mitte, mitte, mitte, mitte, mitte], wort: 'sechsmal in die Mitte' },
    { folge: [0, 1, mitte, 2, 3], wort: 'die richtige Folge mit einem Tipp dazwischen' },
    { folge: [0, 1, 2, 2, 3], wort: 'die richtige Folge mit einer Ecke doppelt' },
  ]
  for (const f of nichtAuf) {
    const r = await gesteGehen(f.folge)
    ja(r.tor && !r.flaeche, `${f.wort}: das Tor STEHT weiter`,
      `Anzeige „${r.anzeige}", ${r.faecher} Faecher`)
  }

  // DIE ZEITGRENZE — die einzige Aussage, die WARTEN kostet, und die einzige
  // gegen vier ueber den Nachmittag verteilte Zufallstreffer.
  const langsam = await gesteGehen([0, 1, 2], 0)
  await warte(4300)
  await tippen(eckPunkt(torLage, KANTE, 3).x, eckPunkt(torLage, KANTE, 3).y)
  await warte(200)
  const nachPause = await schirm()
  ja(nachPause.tor && !nachPause.flaeche, 'die vierte Ecke nach mehr als vier Sekunden zaehlt NICHT',
    `Anzeige „${nachPause.anzeige}" (vor der Pause „${langsam.anzeige}")`)

  // ══ 4. WAS DAS TOR ZEIGT UND WAS ES VERSCHWEIGT ═════════════════════════
  console.log('\n══ 4. Was das Tor zeigt — und was es mit Absicht nicht zeigt ══')
  await stand('sperre-geste')
  await neuLaden()
  await hinein()
  s = await schirm()

  ja(!s.feld && s.tasten === 0, 'das Ziffernfeld ist WEG, nicht nur unsichtbar',
    `${s.tasten} bedienbare Tasten — `
      + 'zwoelf Tasten, die nichts tun, trainieren Tippen ab')
  ja(s.rueckwegTrifft, 'der eine Rueckweg wird getroffen — es gibt einen Ausgang',
    `#zurueck ${rw ? `${rw.b}x${rw.h} bei ${rw.x},${rw.y}` : '?'}`)
  // DER SCHIRM DARF DIE LOESUNG NICHT ANSCHREIBEN. Ein Tor, das seine eigene
  // Loesung nennt, ist keine Sperre — und der zweite Elternteil bekommt sie
  // stattdessen in der Verwaltung.
  const alles = `${s.frage} ${s.meldung} ${s.unter}`.toLowerCase()
  for (const w of ['uhrzeigersinn', 'ecke', 'links oben', 'rechts unten']) {
    ja(!alles.includes(w), `der Schirm verraet „${w}" NICHT`, `steht da: „${s.frage} · ${s.meldung}"`)
  }
  // ABER ER SAGT, WO ES STEHT. Ohne diesen Satz ist die Geste fuer den
  // zweiten Elternteil eine Aussperrung ohne Ausweg.
  //
  // GEPRUEFT WIRD MELDUNG **UND** UNTERZEILE, und das ist keine Aufweichung,
  // sondern der Befund dieses Werkzeugs vom 06.08.2026: Der Satz stand in der
  // Meldungszeile und war nach sieben Fehlversuchen weg — dort zaehlte die
  // Bremse („Zu viele Versuche. Noch 4 Sekunden."). Weil die Bremse das
  // Verlassen und Wiederkommen ABSICHTLICH ueberlebt, kam man an den Satz
  // ueberhaupt nicht mehr heran. Er steht seither in `#eltern-unter`, das
  // nichts ueberschreibt. Die Aussage prueft weiterhin dasselbe: dass er
  // IRGENDWO steht, wo man ihn sieht — nicht, in welcher Zeile.
  ja(/verwaltung/i.test(`${s.meldung} ${s.unter}`), 'der Schirm sagt, WO die Geste beschrieben ist',
    `Meldung „${s.meldung}" · Unterzeile „${s.unter}"`)
  ja(/●|–/.test(s.anzeige) && s.anzeige.replace(/\s/g, '').length === 4,
    'die Beruehrungen stehen in derselben Anzeige wie PIN und Rechnung',
    `„${s.anzeige}"`)
  await bild('geste-tor')

  // ══ 5. NACH DEM VERLASSEN IST WIEDER ZU ═════════════════════════════════
  console.log('\n══ 5. Nach dem Verlassen ist wieder zu ══')
  s = await gesteGehen([0, 1, 2, 3])
  ja(s.flaeche, 'offen', '')
  const rr = s.rueckwegLage
  await tippen(rr.x + rr.b / 2, rr.y + rr.h / 2)
  await warte(400)
  await hinein()
  const wieder = await schirm()
  ja(wieder.tor && !wieder.flaeche, 'beim naechsten Griff steht das Tor WIEDER',
    `Anzeige „${wieder.anzeige}" — der halbe Gestenstand ueberlebt das Verlassen nicht`)
  // UND ER FAENGT BEI NULL AN. Bliebe er bei drei, oeffnete EINE Ecke den
  // Bereich beim naechsten Mal wieder.
  ja(wieder.anzeige.indexOf('●') === -1, 'und er faengt bei null an', `„${wieder.anzeige}"`)

  await send(ws, 'Emulation.clearDeviceMetricsOverride')
  ws.close()
} finally {
  // ERST das Ende des Browsers abwarten, DANN sein Profil loeschen — das tut
  // `schliessen()`. Ein `kill()` ohne Warten laesst ein mkdtemp-Verzeichnis
  // stehen, das Chromium beim Beenden noch einmal anschreibt.
  await chrome?.schliessen()
  // WAS MAN SICH BORGT, LEGT MAN ZURUECK: die geliehene Vorschau stand
  // vorher auf einer Lage, und die naechste Messung erwartet sie dort.
  // `sperre` ist eines der klebrigen Felder — es setzt sich von selbst nie
  // zurueck ([[vorschau-wird-geliehen]]). Eine eigene wird stattdessen
  // beendet; beide Wege gehen ueber zurueckgeben().
  await leihe.zurueckgeben()
}

const schlecht = befunde.filter((b) => !b.gut)
console.log('')
if (schlecht.length) {
  console.log(`${schlecht.length} von ${befunde.length} Aussagen halten NICHT:`)
  for (const b of schlecht) console.log(`  * ${b.wort}${b.dazu ? `  — ${b.dazu}` : ''}`)
  process.exitCode = 1
} else {
  console.log(`Alle ${befunde.length} Aussagen halten.`)
}
