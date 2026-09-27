#!/usr/bin/env node
/*
 * DIE GESTEN DER BOX, NACHGEMESSEN — mit echten Beruehrungen, nicht mit einer
 * Maus.
 *
 *     node tools/wischrand-schau.mjs
 *     node tools/wischrand-schau.mjs --ziel http://192.168.178.194:8200/neu/
 *     node tools/wischrand-schau.mjs --spur     schreibt jeden Schritt mit
 *
 * ══ WAS GEMESSEN WIRD ═════════════════════════════════════════════════════
 *
 *     zwei Finger hoch/runter   die Lautstaerke, und dass NICHTS mitrollt
 *     zwei Finger links/rechts  genau EIN next bzw. previous
 *     Doppeltipp, zwei Finger   play oder pause — und NICHT das tote playpause
 *     ueber den Player streichen  schnell blendet aus, langsam nicht
 *     drei Finger vom Rand      das Schnellfenster
 *     die Einstellseite         fuenf Zeilen, keine halb im Bild
 *
 * ══ WARUM ES DIESES WERKZEUG BRAUCHT ═════════════════════════════════════
 *
 * Die reinen Regeln sind ohne Browser geprueft (`node
 * tools/pruef-neu-regeln.js`) — welche Achse, welche Richtung, was ein Tipp
 * ist. Was dort NICHT geprueft werden kann:
 *
 *   * Kommen bei zwei und drei Fingern ueberhaupt `touches` mit der richtigen
 *     Laenge an? Ein Zeigerereignis brachte sie nie mit — deshalb haengen die
 *     Erkenner an `touch*`, und deshalb muss genau das gemessen werden.
 *   * Geht der Titelsprung wirklich hinaus, und genau EINMAL? Er hat keine
 *     Anzeige; gemessen wird der Befehl selbst (ein Mantel um `fetch`).
 *   * Und die Gegenproben, die wichtiger sind als jeder Fund: Ein Finger muss
 *     weiter rollen duerfen, und ein Fehlgriff beim Zielen darf den Player
 *     nicht kosten.
 *
 * DIESELBE FALLE WIE BEI `randwisch` (llmwiki randwisch-holt-die-leiste-
 * zurueck): Jene Geste hat mit der MAUS immer funktioniert und mit dem FINGER
 * nie — gemerkt hat es niemand, weil alle Messungen mit der Maus liefen.
 * Dieses Werkzeug schickt deshalb ausschliesslich `Input.dispatchTouchEvent`.
 *
 * ══ WAS ES NICHT KANN ═════════════════════════════════════════════════════
 *
 * DEN GEMELDETEN ROLLFEHLER REPRODUZIEREN. „beim 2finger bewegt sich auch der
 * hintergrund" (21.08.2026) tritt hier nicht auf: Beruehrungen aus CDP nehmen
 * einen anderen Weg als das echte Panel, und der Rollentscheid faellt beim
 * Nachbau anders. Die Zeile steht trotzdem drin — sie stellt die richtige
 * Frage, nur beweist ihr Gruen nichts ueber das Geraet.
 *
 * Es spielt ausserdem nichts ab und schaltet nichts an der Box: Lautstaerke
 * und Titelsprung gehen an die Attrappe. Ob eine Geste mit einem echten
 * Kinderfinger auf dem 5-Zoll-Panel gut liegt, sagt nur das Geraet.
 *
 * ══ WAS ES ZURUECKLEGT ════════════════════════════════════════════════════
 *
 * Alle sieben Darstellungsfelder, die es zum Messen verstellt — im `finally`.
 * Die geliehene Vorschau bekommt ihre Lage zurueck (tools/leihgabe.mjs).
 */
import process from 'node:process'
import WebSocket from 'ws'

import { browserSuchen, eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const opt = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const ZIEL = opt('--ziel', 'http://127.0.0.1:8299/neu/')
const WURZEL = new URL(ZIEL).origin
/** `--spur` schreibt bei den heiklen Zuegen nach JEDEM Schritt den Zustand
 *  mit. Ohne sie sagt eine Messung nur DASS etwas ausgeloest hat, nicht bei
 *  welchem Schritt — und das ist die Frage, wenn ein zu kurzer Zug wirkt. */
const SPUR = process.argv.includes('--spur')

/** Die Felder, die dieses Werkzeug verstellt — und am Ende zuruecklegt. */
const FELDER = [
  'zweiFinger',
  'playerStreichen',
  'playerZurueckSek',
  'wischGesten',
  'wischRandBreite',
  'wischSchnellRand',
  'wischSchnellFinger',
]

let naechste = 1
function send(ws, methode, params = {}) {
  const id = naechste++
  return new Promise((fertig, kaputt) => {
    const horch = (roh) => {
      const d = JSON.parse(roh)
      if (d.id !== id) return
      ws.off('message', horch)
      d.error ? kaputt(new Error(`${methode}: ${d.error.message}`)) : fertig(d.result)
    }
    ws.on('message', horch)
    ws.send(JSON.stringify({ id, method: methode, params }))
  })
}

async function auswerten(ws, ausdruck) {
  const r = await send(ws, 'Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'Auswertung gescheitert')
  return r.result?.value
}

async function bisWahr(ws, ausdruck, was, geduldMs = 15000) {
  const ende = Date.now() + geduldMs
  for (;;) {
    const w = await auswerten(ws, ausdruck)
    if (w) return w
    if (Date.now() > ende) throw new Error(`Zeit um: ${was}`)
    await new Promise((f) => setTimeout(f, 200))
  }
}

const s = (n) => new Promise((f) => setTimeout(f, n))

/*
 * SO LANGE BRAUCHT EINE EINSTELLUNG BIS AUF DEN SCHIRM.
 *
 * Die Oberflaeche holt darstellung.json in ihrem eigenen Takt - 3000 ms
 * (TAKT_DARSTELLUNG in NewDesign/app.js). Ein PUT wirkt also NICHT sofort.
 *
 * GEMESSEN AM 21.08.2026: Mit 1200 ms Warten meldete diese Pruefung drei
 * Fehler, die keine waren - die Seite kannte den neuen Stand schlicht noch
 * nicht. Eine Wartezeit unter dem Takt prueft die Wartezeit, nicht die Sache.
 */
const TAKT_DARSTELLUNG_MS = 3000
const taktAbwarten = () => s(TAKT_DARSTELLUNG_MS + 700)

/*
 * ══ DIE SEITE MUSS DEN ZUG ZU ENDE GESEHEN HABEN ═════════════════════════
 *
 * `Input.dispatchTouchEvent` kehrt zurueck, wenn der Browser das Ereignis
 * ANGENOMMEN hat — nicht, wenn die Seite es verarbeitet hat. Wer sofort den
 * naechsten Zug beginnt, schickt dessen `touchstart` in eine Warteschlange,
 * in der noch Bewegungen des vorigen liegen.
 *
 * GEMESSEN AM 21.08.2026, und es war kein theoretisches Risiko: Der
 * Mitschnitt (`--spur`) zeigte mitten in einem 20-px-Zug am rechten Rand ein
 * `touchmove` auf x=240 — die Endstelle des ZUGES DAVOR. Aus 796 wurden in
 * einem Ereignis 240, also 556 px nach innen, und die Geste loeste voellig zu
 * Recht aus. Das Werkzeug hat sich damit selbst einen Fehler gemeldet, den
 * die Oberflaeche nicht hat.
 *
 * ZWEI BILDER WARTEN, nicht eines: Nach dem ersten steht fest, dass die
 * Eingaben des laufenden Bildes verarbeitet sind; erst nach dem zweiten ist
 * auch alles zugestellt, was waehrenddessen noch hereinkam.
 */
const beruhigen = (ws) =>
  auswerten(ws, 'new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(() => f(true))))')

/**
 * Den Zaehler einbauen, der sagt, wann ein Zug WIRKLICH zu Ende ist.
 *
 * Er haengt in der Fangphase am `document` und zaehlt jedes `touchend` und
 * `touchcancel`. Damit laesst sich vor dem naechsten Zug abwarten, statt zu
 * hoffen — siehe die Begruendung bei `beruhigen`.
 */
const endeZaehlerEinbauen = (ws) =>
  auswerten(
    ws,
    `(() => {
      if (window.__wischEnden !== undefined) return true
      window.__wischEnden = 0
      for (const a of ['touchend', 'touchcancel']) {
        document.addEventListener(a, () => { window.__wischEnden++ }, true)
      }
      return true
    })()`,
  )

let fehler = 0
const p = (ist, soll, was) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll)
  if (!ok) fehler++
  console.log(`  ${ok ? 'ok  ' : 'FEHL'} ${was}: ${JSON.stringify(ist)}${ok ? '' : ' erwartet ' + JSON.stringify(soll)}`)
}

async function darstellungHolen() {
  const r = await fetch(`${WURZEL}/api/darstellung`, { cache: 'no-store' })
  return r.json()
}

/*
 * ══ ES WIRD IMMER DER GANZE STAND GESCHICKT ══════════════════════════════
 *
 * UND ZWAR, WEIL DIE BEIDEN SEITEN SICH HIER UNTERSCHEIDEN — nachgesehen am
 * 21.08.2026, nicht vermutet:
 *
 *   Die BOX fuehrt zusammen (server.ts, „ZUSAMMENFUEHREN STATT ERSETZEN",
 *   16.08.2026): `{ ...vorher, ...aktuell }`. Ein fehlendes Feld heisst dort
 *   „dazu sage ich nichts".
 *
 *   Die ATTRAPPE ERSETZT (`tools/neu-vorschau.mjs`: `DARSTELLUNG.aktuell = a`)
 *   und begruendet das ausdruecklich mit „genau wie die Box". Das stimmte bis
 *   zum 16.08. und stimmt seitdem nicht mehr.
 *
 * Wer hier also nur seine acht Felder schickt, misst gegen eine Vorschau, der
 * die uebrigen fuenfzig fehlen — und bekommt runde Kacheln, keinen Player und
 * eine Seite, die mit der Box nichts mehr zu tun hat. Der ganze Stand geht
 * unter BEIDEN Vertraegen richtig durch; deshalb hier so und nicht knapper.
 */
async function felderSetzen(felder, themen) {
  const stand = await darstellungHolen()
  const r = await fetch(`${WURZEL}/api/darstellung`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aktuell: { ...(stand.aktuell || {}), ...felder }, themen: themen || stand.themen || {} }),
  })
  if (!r.ok) throw new Error(`PUT /api/darstellung: ${r.status}`)
}

/*
 * ══ EIN ZUG MIT n FINGERN ═════════════════════════════════════════════════
 *
 * DIE FINGER KOMMEN EINZELN AUF, so wie auf einem echten Panel: erst einer,
 * dann der zweite, dann der dritte — jeder als eigenes `touchStart` mit der
 * WACHSENDEN Liste. Alle zugleich in einem Ereignis waere der bequemere
 * Nachbau und der falsche: Der Erkenner bildet bei jedem `touchstart` die
 * Schnittmenge der Raender neu, und genau dieser Weg wuerde nie gegangen.
 *
 * DIE FINGER STEHEN QUER ZUR ZUGRICHTUNG nebeneinander (`abstand`), wie eine
 * Hand sie aufsetzt — nicht hintereinander in der Zugrichtung. Laegen sie
 * hintereinander, waere der hinterste womoeglich gar nicht mehr im
 * Randstreifen, und die Messung pruefte etwas anderes als die Geste.
 */
/*
 * ══ WARUM JEDER ZUG DIESELBEN KENNUNGEN TRAEGT ═══════════════════════════
 *
 * PROBIERT UND VERWORFEN (21.08.2026): fortlaufende Kennungen je Zug (1, 11,
 * 21, …), um Chromiums Nachbildung die Zuege auseinanderhalten zu lassen.
 * Ergebnis: Ab dem ZWEITEN Zug kam ueberhaupt nichts mehr an — die
 * Nachbildung fuehrt ihren Zustand ueber die Kennung, und eine unbekannte
 * beim `touchStart` laesst sie ins Leere laufen. Steht hier, damit es niemand
 * ein zweites Mal versucht.
 */
async function wischen(ws, { x, y, dx, dy, finger = 1, schritte = 8, abstand = 40, staffel = 0, halten = 0, spur = null, schrittMs = 15 }) {
  // WIE VIELE ZUEGE HAT DIE SEITE BISHER ZU ENDE GESEHEN? Der Wert von JETZT
  // ist die Marke, auf die `los()` danach wartet.
  const endenVorher = await auswerten(ws, 'window.__wischEnden')
  /*
   * ══ WIE EINE HAND WIRKLICH AUFSETZT ══════════════════════════════════════
   *
   * `abstand` spreizt die Finger QUER zur Zugrichtung — so weit, so richtig.
   * `staffel` versetzt sie zusaetzlich LAENGS, und das ist der Teil, der bis
   * zum 21.08.2026 fehlte: Zeigefinger, Mittelfinger und Ringfinger sind
   * unterschiedlich lang. Wer drei davon an den rechten Rand legt, hat drei
   * verschiedene x-Werte, nicht einen.
   *
   * WARUM DAS ZAEHLT: Der Erkenner verlangte, dass ALLE Finger im
   * Randstreifen liegen (28 px). Mit `staffel = 0` — also einer Hand, deren
   * Finger alle gleich lang sind — ging das immer gut, und die Messung war
   * gruen. Am Geraet ging es nie. Genau die Falle, vor der [[randwisch-holt-
   * die-leiste-zurueck]] warnt, nur eine Ebene weiter: nicht Maus statt
   * Finger, sondern IDEALE Finger statt echter.
   *
   * 24 px je Finger ~ 3,4 mm bei 0,14 mm/px. Das ist knapp gerechnet; eine
   * echte Hand staffelt eher weiter.
   */
  const punkte = (fx, fy, wie) =>
    Array.from({ length: wie }, (_, i) => {
      const quer = Math.abs(dx) >= Math.abs(dy)
      /*
       * DIE HAND SPREIZT SICH NACH INNEN, nicht nach aussen. Wer am RECHTEN
       * Rand aufsetzt und nach links zieht, hat den vordersten Finger bei
       * x=796 und die uebrigen WEITER LINKS — also bei kleinerem x, in
       * Zugrichtung.
       *
       * HIER STAND DAS VORZEICHEN VERKEHRT (21.08.2026), und der Fehler war
       * nicht harmlos: Die Finger landeten bei 820 und 844, also AUSSERHALB
       * des 800 px breiten Schirms. Die Messung meldete daraufhin einen
       * Fehler der Oberflaeche — dabei hatte sie nur eine unmoegliche Hand
       * geschickt.
       */
      const laengs = i * staffel * Math.sign(quer ? dx : dy)
      return {
        x: Math.round(fx + (quer ? laengs : (i - (wie - 1) / 2) * abstand)),
        y: Math.round(fy + (quer ? (i - (wie - 1) / 2) * abstand : laengs)),
        id: i + 1,
        radiusX: 8,
        radiusY: 8,
        force: 1,
      }
    })

  /*
   * ══ ERST EINE BLINDE BERUEHRUNG AN DER STARTSTELLE ═══════════════════════
   *
   * SIE IST DER GEGENGIFT ZUM NACHZUEGLER. Chromiums Nachbildung spielt beim
   * naechsten `touchStart` die letzte Stelle des VORIGEN Zuges noch einmal ein
   * — im Mitschnitt am 21.08.2026 als `touchmove` auf x=240 mitten in einem
   * Zug, der bei x=796 begann. Landet dieser Nachzuegler in der Messung, misst
   * man ihn statt der Geste, und zwar in beide Richtungen: einmal loeste ein
   * 20-px-Zug aus, einmal blieb ein 120-px-Zug wirkungslos (die Oberflaeche
   * verwarf den unmoeglichen Sprung voellig zu Recht, `wischSprung`).
   *
   * DIE BLINDE BERUEHRUNG SETZT DIE LETZTE STELLE AUF DEN STARTPUNKT. Der
   * Nachzuegler ist danach ein Sprung von null Pixeln und damit harmlos.
   *
   * `touchCancel` UND NICHT `touchEnd`: Ein Ende erzeugt einen Klick, und ein
   * Klick an dieser Stelle traefe eine Kachel — die Box finge an zu spielen.
   * Ein Abbruch erzeugt keinen.
   */
  // MIT DERSELBEN FINGERZAHL wie der echte Zug: Der Nachzuegler traegt so
  // viele Punkte, wie zuletzt auflagen. Kam davor ein Zwei-Finger-Zug und
  // folgt ein Ein-Finger-Zug, waere die blinde Beruehrung mit einem Finger
  // wirkungslos — der zweite Punkt bliebe uebrig und machte aus dem naechsten
  // Ein-Finger-Zug einen Zwei-Finger-Zug.
  await send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: punkte(x, y, finger) })
  await send(ws, 'Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await beruhigen(ws)

  for (let n = 1; n <= finger; n++) {
    await send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: punkte(x, y, n) })
    await s(20)
  }
  if (spur) await spur('nach dem Aufsetzen', 0)
  for (let i = 1; i <= schritte; i++) {
    const t = i / schritte
    await send(ws, 'Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: punkte(x + dx * t, y + dy * t, finger),
    })
    await s(schrittMs)
    // DIE SPUR IST DER EINZIGE WEG AN DEN AUGENBLICK. Wer nur das Ende
    // abliest, weiss nicht, BEI WELCHEM Schritt etwas ausgeloest hat — und
    // genau das ist die Frage, wenn ein zu kurzer Zug trotzdem wirkt.
    if (spur) await spur(`Schritt ${i}: ${Math.round(dx * t)}/${Math.round(dy * t)} px`, i)
  }
  if (halten) await s(halten)
  return {
    /** Loslassen — erst hier, damit der Aufrufer zwischendrin messen kann. */
    los: async () => {
      /*
       * ══ DIE FINGER GEHEN EINZELN HOCH ═══════════════════════════════════
       *
       * GEMESSEN AM 21.08.2026 (`--spur`): `touchEnd` mit LEERER Punktliste
       * nimmt in diesem Chromium nur EINEN Punkt weg. Nach einem
       * Zwei-Finger-Zug blieb der zweite in der Nachbildung stehen und tauchte
       * mitten im NAECHSTEN Zug wieder auf — im Mitschnitt als
       * `touchmove n=2 [751,169 280,169]`, wobei 280 die Endstelle des
       * zweiten Fingers aus dem Zug DAVOR war. Der Erkenner sah damit einen
       * Ein-Finger-Zug, der sich unterwegs in einen Zwei-Finger-Zug
       * verwandelt, und verwarf ihn voellig zu Recht.
       *
       * `touchCancel` HILFT NICHT: Es meldet zwar `n=0`, die Nachbildung holt
       * den Punkt danach trotzdem zurueck. Probiert und verworfen — steht
       * hier, damit es niemand ein zweites Mal versucht.
       *
       * WAS HILFT: nacheinander abmelden, jeweils mit der Liste der noch
       * LIEGENDEN Punkte. Das ist ausserdem der ehrlichere Nachbau — eine
       * Hand hebt ihre Finger auch nicht in derselben Millisekunde.
       */
      for (let n = finger; n >= 1; n--) {
        await send(ws, 'Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: punkte(x + dx, y + dy, n - 1),
        })
        await s(10)
      }
      // ERST WENN DIE SEITE DEN ZUG ZU ENDE GESEHEN HAT. Die Begruendung
      // steht bei `beruhigen` — ohne diese Zeile faengt der naechste Zug an,
      // waehrend noch Bewegungen dieses hier unterwegs sind. Und die
      // Warteschlangen sind FIFO: ist das Loslassen angekommen, ist alles
      // angekommen, was davor abgeschickt wurde.
      await bisWahr(ws, `window.__wischEnden > ${endenVorher}`, 'die Seite sieht das Loslassen', 5000)
      await beruhigen(ws)
      await s(250)
    },
    /** Weiterziehen, ohne loszulassen — fuer den Regler am Finger. */
    weiter: async (mx, my, wie = 6) => {
      for (let i = 1; i <= wie; i++) {
        const t = i / wie
        await send(ws, 'Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: punkte(x + dx + mx * t, y + dy + my * t, finger),
        })
        await s(15)
      }
    },
  }
}

async function main() {
  // OHNE BROWSER UEBERSPRINGEN STATT ROT WERDEN — dieselbe Hausregel wie bei
  // den uebrigen Messwerkzeugen. Auf einem Rechner ohne Chrome soll die
  // Pruefung sagen, was fehlt, und nicht behaupten, die Geste sei kaputt.
  if (!browserSuchen()) {
    console.log('kein Browser gefunden — die Gesten sind NICHT gemessen.')
    return
  }
  const vorschau = await vorschauLeihen(ZIEL)
  const browser = await eigenerBrowser({ fenster: '800,480' })
  let vorher = null
  let themen = {}
  let ws = null
  try {
    const stand = await darstellungHolen()
    themen = stand.themen || {}
    vorher = {}
    for (const f of FELDER) vorher[f] = stand.aktuell ? stand.aktuell[f] : undefined

    // DIE WERKSBELEGUNG, ausdruecklich gesetzt: alle drei rechts, 1/2/3.
    // Nicht „was gerade dasteht" — sonst misst dieser Lauf die Einstellung
    // des letzten und meldet gruen fuer etwas anderes.
    await felderSetzen(
      {
        zweiFinger: true,
        playerStreichen: true,
        // KURZ GENUG, DASS DIE MESSUNG NICHT WARTEN MUSS, und lang genug,
        // dass sie den Unterschied zwischen „weg" und „schon zurueck" sieht.
        playerZurueckSek: 5,
        wischGesten: true,
        wischRandBreite: 28,
        wischSchnellRand: 'rechts',
        wischSchnellFinger: 3,
      },
      themen,
    )

    ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
    await new Promise((f, k) => {
      ws.once('open', f)
      ws.once('error', k)
    })
    await send(ws, 'Page.enable')
    await send(ws, 'Runtime.enable')
    // OHNE DAS KOMMEN KEINE BERUEHRUNGEN AN. Chromium meldet `touch*` nur,
    // wenn das Ziel ueberhaupt ein Beruehrgeraet hat — auf der Box sorgt die
    // Touch-Bruecke mit INPUT_PROP_DIRECT dafuer (llmwiki
    // mupi-touch-ohne-interrupt), hier die Emulation. Fuenf Punkte, weil die
    // Bruecke fuenf meldet (scripts/box/touch-bridge.py, MAX_FINGER).
    await send(ws, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    /*
     * ══ 800x480 — DIE MASSE DER BOX, NICHT DIE DES FENSTERS ══════════════
     *
     * `--window-size=800,480` allein genuegt NICHT: gemessen kam dabei ein
     * Sichtfenster von 800x337 heraus (der Browser rechnet seine eigenen
     * Leisten ab, auch in headless). Auf 337 px Hoehe passen weniger Zeilen
     * in eine Karte als auf 480 — eine Messung dort meldet ein
     * Platzproblem, das die Box nicht hat, oder uebersieht eines, das sie
     * hat. Beides ist schlimmer als gar nicht messen.
     *
     * Das Panel der Box ist ein Waveshare 5" DSI mit 800x480
     * ([[mupi-touch-ohne-interrupt]]); genau die werden hier gesetzt.
     */
    await send(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 480,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await send(ws, 'Page.navigate', { url: ZIEL })
    await bisWahr(ws, "!!document.getElementById('mp')", 'die Seite steht')
    // AUF DEN DARSTELLUNGS-TAKT WARTEN. Die Felder kommen nicht mit der Seite,
    // sondern mit dem naechsten Abgleich — wer sofort wischt, misst eine
    // Oberflaeche, die von der Geste noch nichts weiss.
    await bisWahr(ws, "!!document.getElementById('wisch-laut')", 'die Hülle ist im Baum')
    await endeZaehlerEinbauen(ws)
    await taktAbwarten()

    // Diese vier reichen ueber mehrere Abschnitte und stehen deshalb hier
    // oben, nicht im ersten Block, der sie braucht.
    let zweiTippen = null
    let kissen = null
    let befehleAn = null
    let befehleAus = null
    let wuenscheAus = null

    const B = await auswerten(ws, 'window.innerWidth')
    const H = await auswerten(ws, 'window.innerHeight')
    console.log(`\nSchirm ${B}x${H}, Ziel ${ZIEL}\n`)

    /*
     * ══ WAS SCHICKT DIE SEITE AN DEN ABSPIELDIENST? ══════════════════════
     *
     * Titelsprung und Anhalten haben keine Anzeige, an der man sie ablesen
     * koennte — sie sind ein Befehl, der hinausgeht. Gemessen wird deshalb
     * der Befehl selbst: `window.fetch` bekommt einen Mantel, der jeden Weg
     * unter /player mitschreibt. Das ist ehrlicher als ein Blick auf die
     * Attrappe, denn es misst, was die SEITE tut, nicht was die Attrappe
     * daraus macht.
     */
    /*
     * UND DER SPIELWUNSCH DANEBEN (nachgetragen 19.09.2026).
     *
     * SEIT E95/V STUFE 2 (31.08.2026) STARTET EINE KACHEL NICHT MEHR UEBER
     * `/player/…`, sondern ueber `POST /api/spielen` — der eine Weg durch
     * `spielenAnfordern`. Ein Mantel, der nur `/player/` mitschreibt, ist fuer
     * die Frage „hat dieser Zug eine Kachel GESTARTET?" seitdem BLIND. Die
     * Wunsch-Liste steht deshalb neben der Befehlsliste; beide werden von
     * `befehleAn()` zugleich geleert, damit kein Zaehler aus dem vorigen
     * Abschnitt herueberlaeuft.
     */
    befehleAn = () =>
      auswerten(
        ws,
        `(() => {
          window.__befehle = []
          window.__wuensche = []
          if (!window.__fetchEcht) window.__fetchEcht = window.fetch
          window.fetch = function (u, o) {
            const weg = typeof u === 'string' ? u : (u && u.url) || ''
            if (weg.indexOf('/player/') >= 0) window.__befehle.push(weg)
            if (/\\/api\\/spielen$/.test(weg)) window.__wuensche.push(weg)
            return window.__fetchEcht.call(this, u, o)
          }
          return true
        })()`,
      )
    befehleAus = () => auswerten(ws, 'window.__befehle || []')
    wuenscheAus = () => auswerten(ws, 'window.__wuensche || []')

    // ══ 1. ZWEI FINGER HOCH/RUNTER — DIE LAUTSTAERKE ═════════════════════
    console.log('── Zwei Finger hoch und runter: Lautstärke ────────────────')
    p(await auswerten(ws, "document.getElementById('wisch-laut').hidden"), true, 'vorher steht kein Regler da')

    /*
     * ══ ROLLT DER HINTERGRUND MIT? ═══════════════════════════════════════
     *
     * GEMELDET AM GERAET (Betreiber, 21.08.2026): „beim 2finger bewegt sich
     * auch der hintergrund". Die Messung davor hatte es NICHT gesehen, und der
     * Grund ist lehrreich: Sie hat gefragt, ob der Regler erscheint und ob die
     * Zahl steigt — beides tat er. Ob daneben die Buehne wegrutscht, hat sie
     * nie gefragt. Eine Pruefung findet nur, wonach sie sucht.
     *
     * SIE REPRODUZIERT DEN FEHLER TROTZDEM NICHT: Beruehrungen aus CDP nehmen
     * einen anderen Weg als das echte Panel, und der Rollentscheid faellt beim
     * Nachbau anders. Die Zeile bleibt hier, weil sie die RICHTIGE Frage
     * stellt — nur beweist ihr Gruen nichts ueber das Geraet. Was dort zaehlt,
     * ist das Abfangen ab dem ERSTEN Ereignis, und das steht im Quelltext.
     */
    const rollstaende = () =>
      auswerten(
        ws,
        `(() => {
          const raus = {}
          for (const n of document.querySelectorAll('*')) {
            if (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1) {
              raus[n.id || n.className || n.tagName] = n.scrollTop + ':' + n.scrollLeft
            }
          }
          raus.__fenster = window.scrollY + ':' + window.scrollX
          return raus
        })()`,
      )
    const vorherRoll = await rollstaende()

    // MITTEN AUF DEM SCHIRM, nicht am Rand: Die Steuerung gilt ueberall, und
    // genau das ist der Unterschied zur Randgeste.
    let zug = await wischen(ws, { x: Math.round(B / 2), y: Math.round(H / 2), dx: 0, dy: -140, finger: 2 })
    p(await auswerten(ws, "document.getElementById('wisch-laut').hidden"), false, 'der Regler erscheint')
    const lauter = await auswerten(ws, "document.getElementById('wisch-laut-zahl').textContent")
    await zug.weiter(0, 240)
    const leiser = await auswerten(ws, "document.getElementById('wisch-laut-zahl').textContent")
    p(parseInt(leiser, 10) < parseInt(lauter, 10), true, `nach unten wird es leiser (${lauter} -> ${leiser})`)
    const nachherRoll = await rollstaende()
    p(
      Object.keys(nachherRoll).filter((k) => nachherRoll[k] !== vorherRoll[k]),
      [],
      'waehrend des Reglers rollt NICHTS im Hintergrund',
    )
    await zug.los()

    // ══ 2. ZWEI FINGER QUER — DER TITEL ══════════════════════════════════
    console.log('\n── Zwei Finger links und rechts: Titel ────────────────────')
    await befehleAn()
    zug = await wischen(ws, { x: Math.round(B / 2), y: Math.round(H / 2), dx: -160, dy: 0, finger: 2 })
    await zug.los()
    let bef = await befehleAus()
    p(
      bef.filter((w) => w.endsWith('/next')).length,
      1,
      'nach links schickt GENAU EINMAL next',
    )
    /*
     * DER ZUG NACH RECHTS BEGINNT DORT, WO DER NACH LINKS AUFGEHOERT HAT.
     *
     * NICHT AUS BEQUEMLICHKEIT: Chromiums Beruehrungs-Nachbildung spielt beim
     * naechsten `touchStart` die letzte Stelle des vorigen Zuges noch einmal
     * ein (siehe [[cdp-beruehrungen-nachzuegler]]). Faengt der neue Zug
     * woanders an, ist dieser Nachzuegler eine Bewegung von 160 px in die
     * ALTE Richtung — die Achse steht damit fest, „next" geht ein zweites Mal
     * hinaus, und das erwartete „previous" kommt nie. Genau so gemessen.
     *
     * Faengt er an derselben Stelle an, ist der Nachzuegler ein Schritt von
     * null Pixeln und damit harmlos.
     */
    await befehleAn()
    zug = await wischen(ws, { x: Math.round(B / 2) - 160, y: Math.round(H / 2), dx: 160, dy: 0, finger: 2 })
    await zug.los()
    bef = await befehleAus()
    p(bef.filter((w) => w.endsWith('/previous')).length, 1, 'nach rechts schickt GENAU EINMAL previous')
    p(bef.filter((w) => w.endsWith('/next')).length, 0, 'und KEIN zweites next aus dem Zug davor')
    // UND EIN SENKRECHTER ZUG SCHICKT KEINEN TITELSPRUNG. Waere die Achse
    // nicht festgehalten, kippte ein Lautstaerke-Zug bei ein paar Pixeln
    // Seitwaerts in einen Titelsprung — und die Musik waere eine andere.
    await befehleAn()
    zug = await wischen(ws, { x: Math.round(B / 2), y: Math.round(H / 2), dx: 30, dy: -180, finger: 2 })
    await zug.los()
    bef = await befehleAus()
    p(
      bef.filter((w) => w.endsWith('/next') || w.endsWith('/previous')).length,
      0,
      'ein senkrechter Zug blaettert NICHT',
    )

    // ══ 3. DOPPELTIPP MIT ZWEI FINGERN — ANHALTEN ODER WEITER ════════════
    console.log('\n── Doppeltipp mit zwei Fingern: anhalten und weiter ───────')
    zweiTippen = async (ueber = null) => {
      const mx = ueber ? ueber.x : Math.round(B / 2)
      const my = ueber ? ueber.y : Math.round(H / 2)
      const pkt = [
        { x: mx - 20, y: my, id: 1 },
        { x: mx + 20, y: my, id: 2 },
      ]
      await send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pkt[0]] })
      await send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pkt })
      await s(40)
      await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pkt[0]] })
      await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await beruhigen(ws)
    }
    await befehleAn()
    await zweiTippen()
    bef = await befehleAus()
    // EIN EINZELNER TIPP TUT NICHTS. Sonst hielte jeder Fehlgriff mit zwei
    // Fingern die Wiedergabe an.
    p(bef.filter((w) => w.endsWith('/play') || w.endsWith('/pause')).length, 0, 'EIN Tipp hält nichts an')
    await zweiTippen()
    bef = await befehleAus()
    p(
      bef.filter((w) => w.endsWith('/play') || w.endsWith('/pause')).length,
      1,
      'der ZWEITE Tipp schickt play oder pause',
    )
    // UND ES IST NICHT `playpause` — den Befehl kennt der Abspieldienst nicht
    // (llmwiki playpause-gibt-es-nicht), er quittiert ihn mit 200 und tut
    // nichts. Genau so war der Play-Knopf einmal monatelang tot.
    p(bef.filter((w) => w.indexOf('playpause') >= 0).length, 0, 'und es ist NICHT das tote playpause')

    /*
     * ══ UND ER DARF NICHT DURCHSCHLAGEN ══════════════════════════════════
     *
     * GEMELDET AM GERAET (Betreiber, 21.08.2026): „das problem beim 2 finger
     * tippen waehlt man aus oder verschiebt".
     *
     * WORAN ES LIEGT: Der Erkenner faengt `touchmove` ab — ein TIPP hat aber
     * keinen. Der Browser macht aus der Beruehrung also brav einen Klick, und
     * der landet auf dem, was gerade darunter liegt: einer Kachel. Zwei Finger
     * auf einer Kachel halten dann nicht an, sondern spielen sie.
     *
     * GEMESSEN WIRD UEBER EINER ECHTEN KACHEL, nicht in der Bildmitte: Wo
     * nichts liegt, kann auch nichts durchschlagen — genau deshalb ist die
     * Gegenprobe weiter unten monatelang gruen geblieben, ohne etwas zu
     * beweisen.
     *
     * UND UEBER EINER, DIE AUCH WIRKLICH SPIELEN WUERDE (19.09.2026).
     * Hier stand `#raster > .kachel`, also „die erste beste" — und die erste
     * dieser Vorschau ist seit E112 ein ALBUM („Die Maus"), das auf einen Tipp
     * seine Titel AUFKLAPPT, statt zu spielen. GEMESSEN, nicht vermutet: ein
     * kuenstlich durchgelassener Klick auf genau diese Kachel erzeugte zwei
     * Klick-Ereignisse und NULL Spielwuensche. Ueber ihr kann die Zeile
     * „spielt sie NICHT ab" also gar nicht fallen, was immer die Oberflaeche
     * tut. Gesucht wird deshalb ueber den Satz, den die Kachel selbst sagt
     * („…, abspielen") — dieselbe Auswahl und derselbe Grund wie in
     * tools/neu-sprechen-schau.mjs; die erste beste bleibt nur der Rueckfall,
     * damit die Messung nicht ganz ausfaellt.
     */
    const kachel = await auswerten(
      ws,
      `(() => {
        const alle = [...document.querySelectorAll('#raster > .kachel')]
        const n = alle.find((k) => (k.dataset.sprich || '').endsWith('abspielen')) || alle[0]
        if (!n) return null
        const b = n.getBoundingClientRect()
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
      })()`,
    )
    if (!kachel) {
      console.log('  ÜBERSPRUNGEN  im Raster steht gerade keine Kachel')
    } else {
      await befehleAn()
      await auswerten(ws, '(() => { window.__klicks = []; document.addEventListener("click", (e) => window.__klicks.push((e.target.className || e.target.tagName) + ""), true); return true })()')
      await zweiTippen(kachel)
      await zweiTippen(kachel)
      const durch = await befehleAus()
      const wuensche = await wuenscheAus()
      /*
       * ══ KEIN STARTBEFEHL — UND „START" IST EINE SORTE, KEINE NAMENSLISTE ══
       *
       * HIER STAND: „alles, was nicht auf /play oder /pause endet und nicht
       * /local enthaelt". Drei Namen, und damit zwei Fehler auf einmal
       * (gefunden 19.09.2026, gemeldet als AUDIT-2026-09-19 Rang 2):
       *
       *   FALSCH ROT: `anhaltenOderWeiter()` schliesst mit `lokalHolen()`
       *   UND `dienstHolen()` (app.js), und `dienstHolen` fragt
       *   `/player/state`. Diese ZUSTANDSABFRAGE stand in keiner der drei
       *   Ausnahmen — sie wurde als Startbefehl gezaehlt. „1 erwartet 0",
       *   stabil in jedem Lauf, ohne dass je etwas gestartet worden waere:
       *   der Klick-Zaehler eine Zeile tiefer stand die ganze Zeit auf 0.
       *
       *   FALSCH GRUEN: Eine Kachel startet seit E95/V Stufe 2 (31.08.2026)
       *   ueber `POST /api/spielen`, nicht mehr ueber `/player/…`. Der
       *   Mantel schrieb nur `/player/` mit — den Fehler, den diese Zeile
       *   BENENNT, haette sie gar nicht sehen koennen. Der echte Durchschlag
       *   waere also lautlos durchgegangen, waehrend der Takt das Rot lieferte.
       *
       * DIE SORTE: Ein BEFEHL geht an den Raum (`/player/current/…`) — das
       * baut nur `spielerBefehl()`. Eine ABFRAGE tut das nicht
       * (`/player/state`, `/player/local`, `/player/pegelstrom`), und sie
       * laeuft im Takt weiter, gleich ob jemand tippt. Vom Raum-Befehl sind
       * `play` und `pause` die Tat des Doppeltipps selbst; jeder andere waere
       * ein fremder Griff. Dazu JEDER Spielwunsch, denn das ist heute der
       * Startweg.
       */
      const fremd = [
        ...wuensche,
        ...durch.filter((w) => w.indexOf('/player/current/') >= 0 && !w.endsWith('/play') && !w.endsWith('/pause')),
      ]
      // Was ueberhaupt hinausging — damit ein Rot hier nicht wieder als
      // blosse Zahl dasteht und geraten werden muss, was gemeint war.
      console.log(`  hinausgegangen: ${durch.length ? durch.join(', ') : '(kein /player-Weg)'}`)
      p(fremd, [], 'ein Doppeltipp auf einer Kachel spielt sie NICHT ab')
      p(await auswerten(ws, 'window.__klicks.length'), 0, 'und es kommt gar kein Klick durch')
      // UND DAS RASTER STEHT NOCH DA — kein Sprung in eine Lane, keine
      // Interpretenseite, nichts aufgeklappt.
      p(
        await auswerten(ws, "!!document.querySelector('#raster > .kachel') && document.querySelectorAll('.lane').length === 0"),
        true,
        'und nichts hat sich aufgeklappt oder verschoben',
      )
    }

    // ══ 4. ÜBER DEN PLAYER STREICHEN ═════════════════════════════════════
    console.log('\n── Über den Player streichen ──────────────────────────────')
    /*
     * ERST NEU LADEN — DERSELBE GRUND WIE WEITER UNTEN BEIM HAUPTSCHALTER.
     *
     * Chromiums Beruehrungs-Nachbildung spielt beim naechsten `touchStart` die
     * letzte Stelle des VORIGEN Zuges noch einmal ein. Hier kostet das die
     * ganze Aussage: Der Nachzuegler kommt als erste Bewegung an, ist weiter
     * als 56 px und schneller als 400 ms — und damit meldet die Messung ein
     * „schnelles Streichen" fuer einen Zug, der langsam war. GEMESSEN
     * (`--spur`): Die Klasse fiel bei Schritt 1 bei 18 px, also lange vor der
     * Schwelle.
     *
     * AUF DER BOX GIBT ES DEN NACHZUEGLER NICHT (echtes uinput durch den
     * Kernel). Neu laden ist deshalb keine Vertuschung, sondern das Entfernen
     * eines Artefakts des Nachbaus.
     */
    await send(ws, 'Page.navigate', { url: ZIEL })
    await bisWahr(ws, "!!document.getElementById('wisch-laut')", 'die Seite steht wieder')
    await endeZaehlerEinbauen(ws)
    await taktAbwarten()
    kissen = await auswerten(
      ws,
      "(() => { const n = document.getElementById('mp'); if (!n || n.hidden) return null; const b = n.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()",
    )
    if (!kissen) {
      console.log('  ÜBERSPRUNGEN  das Kissen steht gerade nicht da (es läuft nichts)')
    } else {
      p(await auswerten(ws, "document.body.classList.contains('player-weg')"), false, 'vorher ist das Kissen da')

      /*
       * DAS LANGSAME ZIEHEN STEHT ZUERST — und das ist keine Kosmetik.
       *
       * Es misst, dass ein Fehlgriff beim Zielen den Player NICHT kostet, und
       * es ist damit die empfindlichste Zeile dieses Abschnitts: Der
       * Nachzuegler aus Chromiums Nachbildung (die letzte Stelle des vorigen
       * Zuges, siehe oben) kaeme als erste Bewegung an, waere weiter als 56 px
       * und schneller als 400 ms — und meldete ein „schnelles Streichen" fuer
       * einen Zug, der langsam war. GEMESSEN (`--spur`): die Klasse fiel bei
       * Schritt 1 bei 18 px.
       *
       * DIREKT NACH DEM NEULADEN GIBT ES KEINEN VORIGEN ZUG. Deshalb hier und
       * nicht hinter dem schnellen.
       */
      zug = await wischen(ws, { x: kissen.x, y: kissen.y, dx: 140, dy: 0, finger: 1, schritte: 8, schrittMs: 150 })
      await zug.los()
      p(await auswerten(ws, "document.body.classList.contains('player-weg')"), false, 'langsames Ziehen nimmt es NICHT weg')

      zug = await wischen(ws, { x: kissen.x, y: kissen.y, dx: 140, dy: 0, finger: 1, schritte: 4 })
      await zug.los()
      p(await auswerten(ws, "document.body.classList.contains('player-weg')"), true, 'ein schnelles Streichen blendet es aus')
      // ES KOMMT VON SELBST ZURUECK — die Messung stellt dafuer 5 s ein.
      await bisWahr(ws, "!document.body.classList.contains('player-weg')", 'das Kissen kommt zurueck', 9000)
      p(await auswerten(ws, "document.body.classList.contains('player-weg')"), false, 'und ist nach der Ruhezeit wieder da')
    }

    /*
     * DAS FENSTER RICHTIG ZUMACHEN, nicht nur verstecken.
     *
     * `hidden = true` setzt den BILDSCHIRM zurueck, nicht den MERKER: `schnell.offen`
     * bleibt wahr, und die naechste Geste ruft `umschalten()` — also `zu()`.
     * Die Messung sah dann ein Fenster, das nicht aufgeht, und meldete einen
     * Fehler der Oberflaeche, den sie selbst gebaut hatte (21.08.2026).
     *
     * EIN KLICK AUF DIE GRAUE FLAECHE ist der Weg, den auch ein Mensch nimmt,
     * und er laeuft durch `schnell.zu()`.
     */
    const nullenSchnell = async () => {
      await auswerten(
        ws,
        `(() => {
          const n = document.getElementById('schnell')
          if (!n.hidden) n.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          return true
        })()`,
      )
      await beruhigen(ws)
    }

    // ══ 5. DREI FINGER VOM RAND — DAS SCHNELLFENSTER ═════════════════════
    console.log('\n── Drei Finger vom Rand: Schnellfenster ───────────────────')
    /*
     * MIT EINER ECHTEN HAND, nicht mit drei gleich langen Fingern: `staffel`
     * versetzt die Finger LAENGS zur Zugrichtung, so wie Zeige-, Mittel- und
     * Ringfinger am Rand aufliegen. Ohne diese Zeile war diese Messung immer
     * gruen, waehrend die Geste am Geraet NIE ging (gemeldet 21.08.2026:
     * „die menu geste funktioniert nicht mit 1 oder 3 fingern probiert").
     */
    zug = await wischen(ws, { x: B - 4, y: Math.round(H / 2), dx: -120, dy: 0, finger: 3, staffel: 24 })
    await zug.los()
    p(await auswerten(ws, "!document.getElementById('schnell').hidden"), true, 'das Fenster geht auf')
    await bisWahr(ws, "document.querySelectorAll('#schnell-zeilen > .fach-zeile').length >= 4", 'vier Zeilen')
    p(
      await auswerten(ws, "[...document.querySelectorAll('#schnell-zeilen .zeile-name')].map((n) => n.textContent)"),
      ['Helligkeit', 'Lautstärke', 'Hörzeit', 'Funk'],
      'vier Zeilen in der gedachten Reihenfolge',
    )
    // DIE 9-MM-MARKE GILT AUCH HIER. Die Zeilen kommen aus denselben
    // Bausteinen wie im Eltern-Bereich — geprueft wird trotzdem, denn sie
    // stehen in einem anderen Blatt, und eine Regel dieses Blattes koennte
    // sie schmaler machen.
    p(
      await auswerten(
        ws,
        "[...document.querySelectorAll('#schnell-zeilen .zeile-tat, #schnell-zeilen .zeile-regler')].every((k) => k.getBoundingClientRect().height >= 64)",
      ),
      true,
      'jedes Bedienelement ist mindestens 64 px hoch',
    )
    // UND DAS BLATT PASST AUF DEN SCHIRM. Ein Fenster, dessen letzte Zeile
    // unter dem Rand liegt, sieht ganz aus und ist es nicht.
    p(
      await auswerten(
        ws,
        "(() => { const b = document.querySelector('.schnell-blatt').getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight + 1 })()",
      ),
      true,
      'das Blatt steht ganz im Bild',
    )
    /*
     * ══ LIEGT ES AUCH OBEN? ═══════════════════════════════════════════════
     *
     * DIE FRAGE IST NICHT AKADEMISCH. Das Fenster stand beim Bau bei z-index
     * 7, die grosse Albumansicht liegt bei 8 — wer sie offen hat und die Geste
     * macht, bekaeme sein Fenster DAHINTER: unsichtbar, unbedienbar, und der
     * Rueckweg raeumte es beim ersten Tipp weg, ohne dass sich am Schirm etwas
     * ruehrt. Genau die Falle aus [[rueckweg-lag-ueber-der-meldung]].
     *
     * GEMESSEN WIRD MIT `elementFromPoint` UND NICHT MIT z-index: Was oben
     * liegt, entscheiden Ebene UND Baureihenfolge zusammen, und die Zahl im
     * Stilblatt sagt nur die Haelfte davon.
     */
    p(
      await auswerten(
        ws,
        `(() => {
          // DIE MELDUNG ZUERST WEG. Sie liegt bei z-index 10 ueber allem —
          // zu Recht, und sie steht hier nur noch aus einem frueheren Schritt
          // dieser Messung („Der Player ist ausgeblendet …", 4,5 s). Ohne
          // diese Zeile misst man ihre Standzeit statt der Schichtung; beim
          // ersten Anlauf meldete die Probe prompt „meldung-bild liegt davor".
          document.getElementById('meldung').hidden = true
          const b = document.querySelector('.schnell-blatt').getBoundingClientRect()
          const n = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2))
          if (n && n.closest('#schnell')) return true
          // BEI EINEM FEHLSCHLAG SAGEN, WER DAVORLIEGT. „false" allein
          // schickt den Naechsten auf die Suche.
          return n ? (n.id || n.className || n.tagName) + ' liegt davor' : 'gar nichts getroffen'
        })()`,
      ),
      true,
      'das Fenster liegt wirklich obenauf',
    )

    // DIESELBE GESTE MACHT ES WIEDER ZU — sonst waere sie eine Sackgasse.
    zug = await wischen(ws, { x: B - 4, y: Math.round(H / 2), dx: -120, dy: 0, finger: 3 })
    await zug.los()
    p(await auswerten(ws, "document.getElementById('schnell').hidden"), true, 'und wieder zu')
    /*
     * ══ UND DIESELBE GESTE AM LINKEN RAND, MIT EINEM FINGER ══════════════
     *
     * DAS IST DIE EINSTELLUNG, DIE AUF DER BOX STAND (21.08.2026), und sie ist
     * die heikelste von allen zwoelf: Der linke Rand mit EINEM Finger gehoert
     * auch `randwisch` — der Geste, die die eingefahrene Kategorienleiste
     * zurueckholt ([[randwisch-holt-die-leiste-zurueck]]).
     *
     * DER ERKENNER STREICHT „links" NUR, SOLANGE DIE LEISTE WEG IST. Steht sie
     * da — und das ist der Normalfall, „Platz beim Blaettern" ist ab Werk aus
     * —, gehoert der linke Rand dieser Geste hier. Genau das wird gemessen,
     * statt es zu behaupten.
     */
    await felderSetzen({ wischSchnellRand: 'links', wischSchnellFinger: 1 }, themen)
    await taktAbwarten()
    await nullenSchnell()
    zug = await wischen(ws, { x: 4, y: Math.round(H / 2), dx: 120, dy: 0, finger: 1 })
    await zug.los()
    p(await auswerten(ws, "!document.getElementById('schnell').hidden"), true, 'auch von links mit EINEM Finger')

    /*
     * ══ UND AUCH DANN, WENN DIE LEISTE EINGEFAHREN IST ═══════════════════
     *
     * DAS IST DER FALL, DER `randwisch` GEHOERT — und der Grund, warum diese
     * Zeile hier steht: Bis zum 21.08.2026 strich der Erkenner den linken Rand
     * fuer EINEN Finger, solange die Leiste weg war. Wer das Schnellfenster
     * auf links/1 gelegt hatte, bekam es dann NICHT, und zwar unberechenbar —
     * „eingefahren" gilt nur die 1400 ms nach einem Blaettern. Mal ging es,
     * mal nicht.
     *
     * SEITDEM STEHT `randwisch` ZURUECK, wo diese Belegung gilt. Die Leiste
     * kommt ohnehin nach ihrer Ruhezeit von selbst wieder; das Wiki sagt es
     * ueber sie selbst („eine Abkuerzung, kein einziger Weg").
     */
    await nullenSchnell()
    const eingefahren = await auswerten(
      ws,
      `(() => {
        const b = document.getElementById('buehne')
        if (!b || b.scrollHeight <= b.clientHeight + 1) return false
        b.scrollTop = 60
        b.dispatchEvent(new Event('scroll', { bubbles: true }))
        return true
      })()`,
    )
    if (!eingefahren) {
      console.log('  ÜBERSPRUNGEN  die Bühne rollt gerade nicht — Leiste lässt sich nicht einfahren')
    } else {
      await bisWahr(ws, "document.body.classList.contains('platz-machen')", 'die Leiste faehrt ein', 4000)
      zug = await wischen(ws, { x: 4, y: Math.round(H / 2), dx: 120, dy: 0, finger: 1 })
      await zug.los()
      p(
        await auswerten(ws, "!document.getElementById('schnell').hidden"),
        true,
        'auch bei eingefahrener Leiste — die eingestellte Geste gewinnt',
      )
      await nullenSchnell()
    }
    await felderSetzen({ wischSchnellRand: 'rechts', wischSchnellFinger: 3 }, themen)
    await taktAbwarten()


    // ══ 6. DIE GEGENPROBEN — SIE SIND DER TEURE TEIL ═════════════════════
    //
    // Ein Erkenner, der zu viel erkennt, macht die Box unbedienbar, und zwar
    // an genau den Stellen, an denen man rollt. Diese Faelle DUERFEN nichts
    // ausloesen.
    console.log('\n── Gegenproben: was NICHT ausloesen darf ──────────────────')

    /*
     * JEDE GEGENPROBE FAENGT BEI NULL AN — und das ist gelernt, nicht
     * vorsorglich: Beim ersten Anlauf am 21.08.2026 meldeten fuenf von fuenf
     * einen Treffer, und KEINER davon war einer. Der Lautstaerke-Balken der
     * Messung davor steht noch 1,8 s lang da (`LAUT_SICHTBAR_MS`), und ein
     * ausgeblendetes Kissen bleibt es, bis seine Ruhezeit um ist. Wer den
     * Zustand nur ABLIEST, misst also die Vormessung mit.
     */
    const zustand =
      "(document.body.classList.contains('player-weg') ? 'player' : '') + (document.getElementById('wisch-laut').hidden ? '' : 'laut') + (document.getElementById('schnell').hidden ? '' : 'schnell')"
    const nullen = async () => {
      await auswerten(
        ws,
        `(() => {
          document.body.classList.remove('player-weg')
          document.getElementById('wisch-laut').hidden = true
          document.getElementById('schnell').hidden = true
          return true
        })()`,
      )
      const rest = await auswerten(ws, zustand)
      if (rest !== '') throw new Error(`Der Pruefstand liess sich nicht zuruecksetzen: ${rest}`)
    }
    const gegenprobe = async (was, tun) => {
      await nullen()
      await befehleAn()
      await tun()
      const stand = await auswerten(ws, zustand)
      const geschickt = (await befehleAus()).filter(
        (weg) => weg.endsWith('/next') || weg.endsWith('/previous') || weg.endsWith('/play') || weg.endsWith('/pause'),
      )
      // BEIDE ZEUGEN. Der Bildschirm sagt, ob etwas AUFGEGANGEN ist; die
      // Befehlsliste sagt, ob etwas HINAUSGEGANGEN ist. Ein Titelsprung hat
      // keine Anzeige — ohne den zweiten Zeugen bliebe er unsichtbar.
      p(stand === '' && geschickt.length === 0, true, was + (geschickt.length ? ' (geschickt: ' + geschickt.join(', ') + ')' : ''))
    }

    // EIN Finger rollt weiter wie bisher — der haeufigste Fall ueberhaupt.
    await gegenprobe('ein Finger quer über den Schirm löst nichts aus', async () => {
      const z = await wischen(ws, { x: Math.round(B / 2), y: Math.round(H / 2), dx: -200, dy: 0, finger: 1 })
      await z.los()
    })
    await gegenprobe('ein Finger senkrecht löst nichts aus', async () => {
      const z = await wischen(ws, { x: Math.round(B / 2), y: Math.round(H / 3), dx: 0, dy: 180, finger: 1 })
      await z.los()
    })
    // ZWEI FINGER, ABER ZU KURZ: unter der Schwelle steht die Achse nicht fest.
    await gegenprobe('ein zu kurzer Zwei-Finger-Zug löst nichts aus', async () => {
      const z = await wischen(ws, { x: Math.round(B / 2), y: Math.round(H / 2), dx: 0, dy: -20, finger: 2 })
      await z.los()
    })
    // DREI FINGER MITTEN AUF DEM SCHIRM sind kein Randwisch.
    await gegenprobe('drei Finger aus der Mitte holen kein Fenster', async () => {
      const z = await wischen(ws, { x: Math.round(B / 2), y: Math.round(H / 2), dx: -160, dy: 0, finger: 3 })
      await z.los()
    })
    // DREI FINGER VOM RAND, ABER NACH AUSSEN.
    await gegenprobe('ein Zug nach aussen holt kein Fenster', async () => {
      const z = await wischen(ws, { x: B - 40, y: Math.round(H / 2), dx: 30, dy: 0, finger: 3 })
      await z.los()
    })
    // ZWEI EINZELNE TIPPS MIT ABSTAND sind kein Doppeltipp.
    await gegenprobe('zwei Tipps mit Abstand halten nichts an', async () => {
      await zweiTippen()
      await s(700)
      await zweiTippen()
    })

    // ══ 7. AUSGESCHALTET IST AUSGESCHALTET ═══════════════════════════════
    console.log('\n── Die Hauptschalter ──────────────────────────────────────')
    /*
     * ERST NEU LADEN — UND ZWAR AUS EINEM GEMESSENEN GRUND.
     *
     * CHROMIUMS BERUEHRUNGS-NACHBILDUNG LAESST SICH NICHT VOLLSTAENDIG LEEREN.
     * Nach einer Gegenprobe mit mehreren Fingern blieb einer in ihr stehen und
     * tauchte im naechsten Zug wieder auf (`--spur`:
     * `touchmove n=2 [691,169 280,169]`, wobei 280 die Endstelle von dort
     * war). Versucht und gemessen, alle ohne Wirkung: `touchCancel` hinterher,
     * einzelnes Abmelden der Punkte, fortlaufende Kennungen je Zug, Warten auf
     * zwei Bilder, 250 ms Ruhe.
     *
     * AUF DER BOX GIBT ES DIESEN ZUSTAND NICHT: Dort kommen die Beruehrungen
     * aus einem echten uinput-Geraet durch den Kernel (scripts/box/
     * touch-bridge.py), und dessen Punkte sind weg, wenn der Finger weg ist.
     */
    await send(ws, 'Page.navigate', { url: ZIEL })
    await bisWahr(ws, "!!document.getElementById('wisch-laut')", 'die Seite steht wieder')
    await endeZaehlerEinbauen(ws)
    await taktAbwarten()
    await felderSetzen({ zweiFinger: false, playerStreichen: false, wischGesten: false }, themen)
    await taktAbwarten()
    await nullen()
    await befehleAn()
    zug = await wischen(ws, { x: Math.round(B / 2), y: Math.round(H / 2), dx: 0, dy: -140, finger: 2 })
    await zug.los()
    zug = await wischen(ws, { x: B - 4, y: Math.round(H / 2), dx: -120, dy: 0, finger: 3 })
    await zug.los()
    p(await auswerten(ws, zustand), '', 'mit ausgeschalteten Schaltern tut keine Geste etwas')
    // NUR DIE BEFEHLE, DIE EINE GESTE SCHICKEN WUERDE. Unter /player laeuft
    // auch der Sekundentakt der Seite (`lokalHolen`); wer alles zaehlt, zaehlt
    // ihn mit und meldet zwei Fehler, die keine sind — beim ersten Anlauf
    // genau so passiert.
    p(
      (await befehleAus()).filter(
        (weg) => weg.endsWith('/next') || weg.endsWith('/previous') || weg.endsWith('/play') || weg.endsWith('/pause'),
      ).length,
      0,
      'und es geht auch kein Steuerbefehl hinaus',
    )

    /*
     * DAS ABSCHALTEN HOLT DEN PLAYER ZURUECK — die teuerste Zeile dieses
     * Abschnitts. Am 21.08.2026 tat sie es NICHT: Der Schalter brach nur den
     * laufenden Zug ab, und ein ausgeblendetes Kissen blieb ausgeblendet.
     * Ohne Geste gab es dafuer keinen zweiten Weg — die Box sah kaputt aus,
     * und der eine Schalter, den man daraufhin anfasst, war genau der, der es
     * zementiert hatte.
     */
    await felderSetzen({ playerStreichen: true, playerZurueckSek: 300 }, themen)
    await taktAbwarten()
    if (kissen) {
      zug = await wischen(ws, { x: kissen.x, y: kissen.y, dx: 140, dy: 0, finger: 1, schritte: 4 })
      await zug.los()
      p(await auswerten(ws, "document.body.classList.contains('player-weg')"), true, 'das Kissen ist ausgeblendet')
      await felderSetzen({ playerStreichen: false }, themen)
      await bisWahr(ws, "!document.body.classList.contains('player-weg')", 'das Abschalten holt es zurueck', 8000)
      p(await auswerten(ws, "document.body.classList.contains('player-weg')"), false, 'das Abschalten holt es zurück')
    }


    /* ══ 6. DIE EINSTELLSEITE IM ELTERN-BEREICH ═════════════════════════
     *
     * WARUM SIE HIER MITGEMESSEN WIRD: Sie hat FUENF Zeilen, und fuenf ist
     * genau das, was die Karte traegt. Das Haus hat diese Grenze schon einmal
     * bezahlt — bei sieben Zeilen endete die Karte MITTEN IM KNOPF der
     * sechsten (siehe der Block bei ELTERN_PUNKTE in app.js). Ein
     * angeschnittener KNOPF sieht ganz aus und ist es nicht.
     *
     * DIE SPERRE WIRD DAFUER ABGESCHALTET, und zwar ueber den Schalter der
     * Vorschau und nicht ueber einen Umweg im Quelltext: `/vorschau/sperre-aus`.
     * Die Vorschau bekommt ihre Lage am Ende von `vorschauLeihen` zurueck.
     */
    console.log('\n── Die Einstellseite im Eltern-Bereich ────────────────────')
    await fetch(new URL('/vorschau/sperre-aus', ZIEL)).catch(() => {})
    await felderSetzen({ wischGesten: true }, themen)
    await send(ws, 'Page.navigate', { url: ZIEL })
    await bisWahr(ws, "!!document.getElementById('eltern-tor')", 'die Seite steht')
    await s(1200)
    // ueber den Quelltext-Weg des Bereichs, nicht ueber die Geste am Wappen:
    // Diese Messung gilt der SEITE, nicht dem Weg dorthin.
    await auswerten(
      ws,
      `(() => {
        const w = document.getElementById('wappen')
        const e = new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 })
        w.dispatchEvent(e)
        return true
      })()`,
    )
    await s(1500)
    await auswerten(ws, "(() => { const w = document.getElementById('wappen'); w.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); return true })()")
    const bereich = await bisWahr(ws, "!document.getElementById('eltern').hidden", 'der Eltern-Bereich geht auf', 8000).catch(() => null)
    if (!bereich) {
      console.log('  ÜBERSPRUNGEN  der Eltern-Bereich liess sich nicht oeffnen')
    } else {
      await auswerten(
        ws,
        `(() => {
          const k = [...document.querySelectorAll('#eltern-faecher > *')].find((n) => n.dataset.fach === 'anzeige')
          if (k) k.click()
          return true
        })()`,
      )
      await s(400)
      const gefunden = await auswerten(
        ws,
        `(() => {
          const z = [...document.querySelectorAll('#fach-zeilen .zeile-name')].find((n) => n.textContent === 'Gesten')
          if (!z) return false
          z.closest('.fach-zeile').click()
          return true
        })()`,
      )
      if (!gefunden) {
        console.log('  ÜBERSPRUNGEN  die Zeile „Gesten" stand nicht in der Uebersicht')
      } else {
        await s(500)
        p(
          await auswerten(ws, "[...document.querySelectorAll('#fach-zeilen .zeile-name')].map((n) => n.textContent)"),
          ['Zwei Finger', 'Über den Player streichen', 'Vom Rand', 'Rand', 'Finger'],
          'fuenf Zeilen in der gedachten Reihenfolge',
        )
        // DIE 9-MM-MARKE, und zwar an JEDEM Knopf: Ein Knopf, der zu 86
        // Prozent dasteht, sieht ganz aus und ist es nicht.
        p(
          await auswerten(
            ws,
            "[...document.querySelectorAll('#fach-zeilen .zeile-tat')].every((k) => k.getBoundingClientRect().height >= 64)",
          ),
          true,
          'jeder Knopf ist mindestens 64 px hoch',
        )
        // UND KEINER STEHT ANGESCHNITTEN DA. Gemessen wird gegen die KARTE,
        // nicht gegen den Schirm: die Karte rollt, der Schirm nicht.
        p(
          await auswerten(
            ws,
            `(() => {
              const feld = document.getElementById('fach-zeilen')
              const kasten = feld.getBoundingClientRect()
              return [...feld.querySelectorAll('.zeile-tat')].every((k) => {
                const b = k.getBoundingClientRect()
                return b.top >= kasten.top - 1 && b.bottom <= kasten.bottom + 1 || b.top >= kasten.bottom
              })
            })()`,
          ),
          true,
          'kein Knopf steht halb im Bild',
        )
      }
    }

    console.log(fehler ? `\n${fehler} FEHLER` : '\nDie Gesten tun, was sie sollen.')
  } finally {
    if (ws) ws.close()
    await browser.schliessen()
    // ZURUECKLEGEN, WAS WIR VERSTELLT HABEN — und zwar auf den Wert von
    // VORHER, nicht auf die Vorgabe. Wer hier die Werkseinstellung schriebe,
    // haette dem Besitzer seine Belegung genommen, weil jemand gemessen hat.
    if (vorher) {
      /*
       * WAS VORHER DASTAND — UND FUER DEN REST DIE WERKSEINSTELLUNG.
       *
       * EIN FELD LAESST SICH NICHT MEHR LOESCHEN, seit die Box zusammenfuehrt
       * (siehe `felderSetzen`): Ein weggelassener Schluessel heisst dort „dazu
       * sage ich nichts" und laesst den Messwert stehen. Wer also gegen eine
       * Box misst, die diese Felder noch nie hatte, kann sie danach nicht
       * wieder verschwinden lassen.
       *
       * DIE WERKSEINSTELLUNG IST DER EHRLICHE ERSATZ: Sie bedeutet genau
       * dasselbe wie das Fehlen (`wischGesten: false` — die Geste ist aus),
       * nur steht sie jetzt ausdruecklich da. Das ist ein Rest, den dieses
       * Werkzeug hinterlaesst, und er gehoert hingeschrieben statt
       * verschwiegen.
       */
      const WERK = {
        zweiFinger: false,
        playerStreichen: false,
        playerZurueckSek: 10,
        wischGesten: false,
        wischRandBreite: 28,
        wischSchnellRand: 'rechts',
        wischSchnellFinger: 3,
      }
      const zurueck = {}
      let neu = 0
      for (const f of FELDER) {
        if (vorher[f] !== undefined) zurueck[f] = vorher[f]
        else {
          zurueck[f] = WERK[f]
          neu++
        }
      }
      await felderSetzen(zurueck, themen).catch(() => {})
      console.log(
        `\nZurueckgestellt: ${FELDER.length - neu} Felder auf ihren alten Wert` +
          (neu ? `, ${neu} auf die Werkseinstellung (sie gab es vorher nicht).` : '.'),
      )
    }
    await vorschau.zurueckgeben()
  }
  process.exitCode = fehler ? 1 : 0
}

main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
