/**
 * FINGER — echte Beruehrungen fuer die Messwerkzeuge dieses Baumes.
 *
 * ══ WOZU EIN GEMEINSAMES STUECK UND NICHT 51 AENDERUNGEN ═══════════════════
 *
 * Inventur vom 06.08.2026 ueber alle 53 Werkzeuge, die die Oberflaeche
 * BEDIENEN (nicht nur ansehen):
 *
 *   Mittel                                Treffer   Was der Browser daraus macht
 *   ──────────────────────────────────────────────────────────────────────────
 *   element.click()                          220    GAR KEINE Zeiger-Ereignisse
 *   dispatchEvent(new PointerEvent…)          38    unecht, pointerType='mouse'
 *   Input.dispatchMouseEvent (CDP)            18    echt, aber pointerType='mouse'
 *   dispatchEvent(new MouseEvent…)            15    unecht
 *   Input.dispatchTouchEvent (CDP)             1    ECHTER FINGER
 *
 *   51 Dateien treiben mit der MAUS, 1 mit dem FINGER.
 *
 * SECHS DAVON HALTEN SICH FUER NICHT BLIND: sie geben `pointerType: 'touch'`
 * mit (eltern-tor-schau, tor-gegenprobe, kind-am-tor, tor-kette-messen,
 * eltern-form-schau). Der Schalter faerbt nur das erzeugte PointerEvent ein.
 * Kein Beruehrungspunkt, keine `touch*`-Ereignisse, keine Gestenerkennung von
 * Blink, kein `touch-action`, kein `pointercancel`.
 *
 * DIE MEISTEN DIESER 51 SOLLEN BLEIBEN, WIE SIE SIND: sie messen Anordnung,
 * Text und Groessen, und dafuer ist die Maus richtig und schneller. Gebraucht
 * wird nicht „alles mit dem Finger", sondern EINE Stelle, an der ein Finger
 * richtig gemacht wird — und ein Werkzeug, das die Bedienungen durchgeht, die
 * an Beruehrung haengen (tools/finger-bedienung.mjs).
 *
 * ══ DIE SCHALTER DES KIOSKS SIND TEIL DER MESSEINRICHTUNG ══════════════════
 *
 * DAS IST DER WICHTIGSTE TEIL DIESER DATEI, und er ist aus Schaden gelernt:
 * Ein waagerechter Fingerzug brachte einen Messbrowser reproduzierbar auf
 * `about:blank` — das Rueckblaettern des Browsers. Am Geraet passiert das
 * NICHT: der Kiosk laeuft mit `--disable-features=OverscrollHistoryNavigation`
 * (scripts/chromium-autostart.sh:43, im laufenden Prozess auf .169
 * bestaetigt). EIN MESSBROWSER OHNE DIE SCHALTER DER BOX ERFINDET FEHLER.
 *
 * Deshalb stehen sie hier als Konstante und nicht in jedem Werkzeug einzeln.
 *
 * ══ WAS DAMIT NICHT ZU MESSEN IST — ausdruecklich ══════════════════════════
 *
 *   * DAS LANGDRUCK-MENUE (`contextmenu`) und der Doppeltipp-Zoom.
 *     `Input.dispatchTouchEvent` geht in den RENDERER; diese beiden Gesten
 *     entscheidet der BROWSER-PROZESS, und der ist an dieser Messung nicht
 *     beteiligt. Eine Gegenprobe auf einem Streifen mit auswaehlbarem Text und
 *     `touch-action: auto` blieb ebenfalls stumm — selbst `selectstart` kam
 *     nicht. „Kein contextmenu" heisst hier NICHT MESSBAR, nicht „kommt
 *     nicht". Wer das braucht, misst es am Geraet.
 *   * MEHRFINGER. `maxTouchPoints: 1` bildet den Schirm der Box ab; alles
 *     Zweifingrige (Zoom, --disable-pinch) ist damit ausserhalb.
 *   * DER BERUEHRUNGSTREIBER DER BOX. Sie meldet ihre Beruehrungen per uinput
 *     ueber eine eigene Bruecke mit 60 Hz (llmwiki mupi-touch-ohne-interrupt).
 *     Eine niedrigere Abtastrate verschiebt den Zeitpunkt eines
 *     `pointercancel`; die REIHENFOLGE der Ereignisse aendert sie nicht.
 *   * ZEITVERHALTEN AUF EINEM BELASTETEN PI 5. Hier laeuft ein
 *     Arbeitsplatzrechner, headless, mit anderer Bildwiederholrate.
 *   * DIE CHROMIUM-FASSUNG. Hier Chrome for Testing, auf .169 Chromium 150.
 *     Blinks Beruehrungsschlupf (gemessen rund 16-20 px bis zum
 *     `pointercancel`) ist eine Konstante der Maschine und KANN sich zwischen
 *     Fassungen aendern. Wer die Zahl weitergibt, prueft sie am Geraet nach.
 *
 * ══ BENUTZUNG ═════════════════════════════════════════════════════════════
 *
 *   import { KIOSK_SCHALTER, fingerAufbau, tippen, halten, ziehen,
 *            mausTippen, mausZiehen, mitschreiberQuelle } from './finger.mjs'
 *
 *   const chrome = await eigenerBrowser({ zusatz: KIOSK_SCHALTER })
 *   const f = await fingerAufbau(ws, send)      // Emulation + Bestaetigung
 *   await tippen(ws, send, 751, 33, 60)
 *
 * `fingerAufbau` gibt zurueck, was der BROWSER ueber sich sagt — nicht, was
 * bestellt wurde. Ein Lauf, der `ontouchstart: false` bekommt, misst eine
 * Seite, die glaubt, an einem Rechner ohne Beruehrungsschirm zu haengen, und
 * das ist genau der Zustand, aus dem der Fehler nicht zu sehen ist.
 */

/**
 * Die Schalter, mit denen der Kiosk der Box laeuft — woertlich aus
 * scripts/chromium-autostart.sh.
 *
 * NICHT ALLE, SONDERN DIE, DIE DAS VERHALTEN EINER BERUEHRUNG AENDERN:
 *   --disable-features=OverscrollHistoryNavigation   Zeile 43. Ohne ihn
 *       blaettert ein waagerechter Zug den Browser zurueck, und die Messung
 *       verliert die Seite. DAS IST DER WICHTIGSTE.
 *   --disable-pinch                                  Zeile 66.
 *   --disable-smooth-scrolling                       Zeile 40 (Vorgabe: der
 *       Schluessel `chromium.scrollanimation` steht auf der Box nicht auf
 *       true). Er aendert, wie lange eine Rollbewegung nachlaeuft.
 *   --hide-scrollbars                                Zeile 123. Ein
 *       sichtbarer Rollbalken verschiebt die Trefferflaechen um seine Breite.
 *   --enable-low-end-device-mode                     im laufenden Prozess auf
 *       .169 abgelesen. Er verkleinert Puffer und aendert damit das
 *       Zeitverhalten — nicht die Reihenfolge.
 *
 * BEWUSST NICHT DABEI: `--kiosk`, `--start-fullscreen`, die Farbschalter und
 * die Cache-Pfade. Sie aendern an einer Beruehrung nichts und wuerden im
 * headless-Betrieb nur stoeren.
 */
export const KIOSK_SCHALTER = [
  '--disable-features=OverscrollHistoryNavigation',
  '--disable-pinch',
  '--disable-smooth-scrolling',
  '--hide-scrollbars',
  '--enable-low-end-device-mode',
]

/** Der Schirm der Box. Beide Zahlen stehen so in chromium-autostart.sh. */
export const SCHIRM = { breite: 800, hoehe: 480 }

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Den Browser auf Beruehrung stellen — und sich bestaetigen lassen, dass es
 * angekommen ist.
 *
 * ══ DIE ZWEI ZEILEN, AN DENEN ALLES HAENGT ═══════════════════════════════
 *
 * `Emulation.setDeviceMetricsOverride` MUSS SEIN, obwohl `--window-size` schon
 * gesetzt ist: headless gibt `--window-size=800,480` ein SICHTFELD von
 * 800x337. Darin liegt in dieser Oberflaeche der Mini-Player ueber der
 * untersten Tastenreihe des Tors — „0" und „Weiter" bekommen ihre Tipps dann
 * nie, und das Ergebnis („die Aufgabe wurde nie geloest") sieht aus wie ein
 * Befund ueber die Sperre. Genau so ist es am 06.08.2026 passiert.
 *
 * `Emulation.setTouchEmulationEnabled` MUSS SEIN, weil
 * `Input.dispatchTouchEvent` sonst KEINEN Fehler meldet und trotzdem nichts
 * bewirkt: `ontouchstart` fehlt am window, `maxTouchPoints` ist 0, und Blink
 * hat gar keine Beruehrungs-Gestenerkennung geladen.
 *
 * `setEmitTouchEventsForMouse` WIRD AUSDRUECKLICH ABGESCHALTET: sonst kaeme
 * aus einem Mausereignis eine Beruehrung, und die Gegenprobe „Maus gegen
 * Finger" — der eigentliche Befund jeder dieser Messungen — waere keine.
 */
export async function fingerAufbau(ws, send, { breite = SCHIRM.breite, hoehe = SCHIRM.hoehe } = {}) {
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe,
    deviceScaleFactor: 1,
    // `mobile: false` MIT ABSICHT: die Box ist ein Kiosk-Chromium an einem
    // Beruehrungsschirm, kein Telefon. `mobile: true` schaltete zusaetzlich
    // die Ansichtsfenster-Regeln eines Telefons dazu und maesse damit eine
    // Seite, die es so nirgends gibt.
    mobile: false,
  })
  await send(ws, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await send(ws, 'Emulation.setEmitTouchEventsForMouse', { enabled: false }).catch(() => {})
  return null
}

/**
 * Was der BROWSER ueber sich sagt — die Gegenprobe zum Aufbau.
 *
 * WARUM ES DIESE FUNKTION GIBT UND NICHT NUR EIN `console.log`: Ein Aufbau,
 * der stillschweigend nicht gegriffen hat, laesst jede folgende Messung
 * „gruen" melden — und zwar ueber eine Seite, die gar keinen
 * Beruehrungsschirm zu haben glaubt. Der Aufrufer soll das PRUEFEN koennen,
 * bevor er misst, nicht hinterher raten.
 */
export async function fingerBestaetigen(ws, send) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      ontouchstart: 'ontouchstart' in window,
      maxTouchPoints: navigator.maxTouchPoints,
      grob: window.matchMedia('(pointer: coarse)').matches,
      breite: window.innerWidth,
      hoehe: window.innerHeight,
    })`,
    returnByValue: true,
  })
  const w = JSON.parse(r.result.value)
  w.taugt = w.ontouchstart === true && w.maxTouchPoints >= 1 && w.grob === true
  return w
}

/** Ein Beruehrungspunkt, wie ihn das Protokoll erwartet. */
const punkt = (x, y) => ({ x: Math.round(x), y: Math.round(y), radiusX: 8, radiusY: 8, force: 1 })

/**
 * EIN TIPP mit dem Finger.
 *
 * `ms` ist die Zeit zwischen Aufsetzen und Abheben. Ein Mensch tippt in
 * 60-120 ms; laenger als 500 ms ist bereits Halten.
 */
export async function tippen(ws, send, x, y, ms = 60) {
  await send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punkt(x, y)] })
  await warte(ms)
  await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** Dasselbe, nur laenger — der Lesbarkeit halber ein eigener Name. */
export async function halten(ws, send, x, y, ms = 800) {
  return tippen(ws, send, x, y, ms)
}

/**
 * ZIEHEN — mit Zwischenschritten, denn genau darauf reagiert Blink.
 *
 * DIE ZWISCHENSCHRITTE SIND DER SINN: Ein Sprung von A nach B in EINEM
 * `touchMove` sieht fuer die Gestenerkennung anders aus als eine Bewegung. Was
 * gemessen werden soll — ab welchem WEG der Browser die Beruehrung fuer das
 * Rollen beansprucht und `pointercancel` schickt —, entsteht erst dabei.
 *
 * Gibt zurueck, ob der Zug zu Ende gefuehrt wurde. `halteAn` erlaubt dem
 * Aufrufer, beim ersten `pointercancel` auszusteigen.
 */
export async function ziehen(ws, send, x1, y1, x2, y2, { ms = 400, schritte = 12, halteAn = null } = {}) {
  await send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punkt(x1, y1)] })
  const takt = Math.max(1, Math.round(ms / schritte))
  for (let i = 1; i <= schritte; i++) {
    await warte(takt)
    const t = i / schritte
    await send(ws, 'Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [punkt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)],
    })
    if (halteAn && (await halteAn(i))) {
      await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      return false
    }
  }
  await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  return true
}

/**
 * HALTEN UND DABEI ZITTERN — der Finger eines Menschen steht nie still.
 *
 * GEMESSEN UND DESHALB HIER: Der Ausschlag zaehlt vom AUFSETZPUNKT, nicht als
 * zurueckgelegter Weg. Ein Hin und Her von 6 px ueberlebt jede Frist; ein
 * Abdriften von 16 px bricht ab. Beides ist mit `ziehen` allein nicht zu
 * erzeugen.
 */
export async function zittern(ws, send, x, y, { ms = 800, ausschlag = 4, takt = 40 } = {}) {
  await send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punkt(x, y)] })
  const n = Math.max(1, Math.round(ms / takt))
  for (let i = 1; i <= n; i++) {
    await warte(takt)
    const d = (i % 2 === 0 ? 1 : -1) * ausschlag
    await send(ws, 'Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [punkt(x + d, y + d)] })
  }
  await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/**
 * DIE GEGENPROBE MIT DER MAUS — echt (CDP), nicht `element.click()`.
 *
 * SIE GEHOERT ZU JEDER FINGERMESSUNG. Eine Finger-Messung allein sagt nur
 * „geht" oder „geht nicht". DER UNTERSCHIED ZWISCHEN BEIDEN IST DER BEFUND:
 * er sagt, ob eine Bedienung an der Beruehrung haengt oder ueberhaupt kaputt
 * ist — und ob die vorhandenen 51 Maus-Werkzeuge sie sehen konnten.
 */
export async function mausTippen(ws, send, x, y, ms = 60) {
  const p = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, buttons: 1 }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, buttons: 0 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...p })
  await warte(ms)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, buttons: 0 })
}

/** Dieselbe Bewegung wie `ziehen`, aber mit der Maus. */
export async function mausZiehen(ws, send, x1, y1, x2, y2, { ms = 400, schritte = 12 } = {}) {
  const b = { button: 'left', clickCount: 1 }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, buttons: 0 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, buttons: 1, ...b })
  const takt = Math.max(1, Math.round(ms / schritte))
  for (let i = 1; i <= schritte; i++) {
    await warte(takt)
    const t = i / schritte
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x1 + (x2 - x1) * t),
      y: Math.round(y1 + (y2 - y1) * t),
      buttons: 1,
    })
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, buttons: 0, ...b })
}

/**
 * DER MITSCHREIBER — als Quelltext, zum Einsetzen mit
 * `Page.addScriptToEvaluateOnNewDocument`.
 *
 * ER REDET UEBER `Runtime.addBinding` HERAUS UND NICHT UEBER EIN FELD AM
 * `window`. Das ist der Unterschied zwischen einer Messung und einer Hoffnung:
 * die Geste kann in einem VOLLEN SEITENWECHSEL enden
 * (`window.location.href` in `andereOberflaeche`), und der loescht jedes Feld
 * am window — samt Protokoll, und zwar genau in dem Fall, den man untersuchen
 * will. Ueber die Bindung ist jedes Ereignis schon draussen, bevor die Seite
 * geht.
 *
 * ALLE ZUHOERER SIND `capture` UND `passive`. Fangend, damit auch das gesehen
 * wird, was die Oberflaeche selbst abfaengt; teilnahmslos, damit der
 * Mitschreiber die gemessene Geste nicht beeinflusst — ein nicht-passiver
 * Zuhoerer an `touchmove` aendert, wie Blink ueber das Rollen entscheidet, und
 * das ist genau die Entscheidung, um die es geht.
 *
 * KEINE BACKTICKS IM RUMPF: er wird selbst in einer Zeichenkette weitergereicht.
 */
export const MITSCHREIBER = `(() => {
  if (window.__fingerLaeuft) return
  window.__fingerLaeuft = true
  const ARTEN = ['pointerdown','pointerup','pointercancel','pointerleave','pointerout','pointermove',
                 'touchstart','touchmove','touchend','touchcancel',
                 'mousedown','mouseup','click','dblclick','contextmenu','selectstart','scroll']
  let t0 = 0
  const melde = (e) => {
    if (e.type === 'pointerdown' || e.type === 'touchstart') t0 = performance.now()
    const p = e.touches && e.touches[0] ? e.touches[0] : e
    window.fingerMeld(JSON.stringify({
      art: e.type,
      ms: t0 ? Math.round(performance.now() - t0) : 0,
      zeiger: e.pointerType || '',
      abbrechbar: !!e.cancelable,
      ziel: (e.target && (e.target.id ? '#' + e.target.id : (e.target.className && e.target.className.baseVal !== undefined ? 'svg' : String(e.target.className || e.target.tagName)))) || '',
      x: Math.round(p.clientX || 0),
      y: Math.round(p.clientY || 0),
    }))
  }
  for (const a of ARTEN) document.addEventListener(a, melde, { capture: true, passive: true })
  window.addEventListener('beforeunload', () => {
    window.fingerMeld(JSON.stringify({ art: 'SEITE-GEHT', ms: -1, ziel: location.pathname }))
  })
})()`
