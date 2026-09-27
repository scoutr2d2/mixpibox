#!/usr/bin/env node
/**
 * DER WEG INS ADMIN-MENUE — an EINER Stelle, fuer alle Messwerkzeuge.
 *
 * ══ WAS SICH GEAENDERT HAT ═════════════════════════════════════════════════
 *
 * BIS ZUM 06.08.2026 fuehrte ein Zahnrad in der Kopfzeile hinein. Es hiess
 * `#einst-knopf` und trug ZWEI unsichtbare Gesten: kurz tippen -> alte
 * Oberflaeche, lang druecken -> Admin-Menue. Vierunddreissig Werkzeuge in
 * tools/ oeffneten den Bereich so:
 *
 *     document.getElementById('einst-knopf').dispatchEvent(
 *       new PointerEvent('pointerdown', { bubbles: true }))   // …und up, und click
 *
 * DAS ZAHNRAD IST ERSATZLOS WEG. Am Morgen des 06.08.2026 meldete der
 * Betreiber „es öffnet einfach den alten bereich" — die kurze Geste gewann,
 * wo die lange gemeint war. Der naheliegende Griff (die Frist von 700 auf
 * 400 ms senken) wurde damals VERWORFEN: eine unsichtbare Grenze bleibt eine
 * unsichtbare Grenze, egal wo sie liegt. Die Antwort war stattdessen, den
 * Knopf auf EINE Geste zu reduzieren und die Frist SICHTBAR zu machen.
 *
 * SEITHER IST DER SCHRIFTZUG UNTEN LINKS DER MENUEKNOPF (`#wappen`, aus einem
 * `<div>` wurde ein `<button>`). Er wird 1200 ms GEDRUECKT GEHALTEN; ein Ring
 * (`#wappen-ring`, gespeist aus `--wappen-fuell` 0..1) fuellt sich dabei.
 *
 * ══ WARUM DAS HIER LIEGT UND NICHT VIERUNDDREISSIGMAL ══════════════════════
 *
 * An diesem Baum ist genau diese Sorte schon dreimal auseinandergelaufen
 * ([[drei-orte-eine-anzeige]]): derselbe Griff, abgeschrieben in viele
 * Dateien, und beim naechsten Umbau stimmt die Haelfte davon nicht mehr.
 * Die Zeile, die den Bereich aufmacht, steht deshalb GENAU HIER.
 *
 * ══ ZWEI WEGE, UND SIE MESSEN VERSCHIEDENES ════════════════════════════════
 *
 * `ADMIN_AUF_JS` / `adminAuf()` — DER TASTATURWEG (Enter auf `#wappen`).
 *
 *   ER PRUEFT DAS HALTEN NICHT. Er ist eine ECHTE Bedienung und kein
 *   Testhaken — wer mit Tabulator und Eingabetaste bedient oder eine
 *   Sprachausgabe benutzt, kommt genau so hinein, denn eine Tastatur kennt
 *   keine Haltegeste. Aber er geht am Ring, an der Frist und am Abbrechen
 *   vorbei. Wer diesen Weg benutzt, misst was DAHINTER liegt (Beruehrziele,
 *   Formen, Farben, Inhalte) — nicht die Bedienung davor.
 *
 *   WER DIE BEDIENUNG SELBST PRUEFT, STEHT IN `WAPPEN_HALTEN.pruefer`. Wenn
 *   diese Liste je leer wird, ist die einzige Geste, die an der Box ins
 *   Admin-Menue fuehrt, ungeprueft.
 *
 * `WAPPEN_MITTE_JS` + `WAPPEN_HALTEN_MS` — DER ECHTE WEG.
 *
 *   Fuer Werkzeuge, die mit `Input.dispatchTouchEvent` oder
 *   `Input.dispatchMouseEvent` wirklich druecken. Sie holen sich die Mitte des
 *   Knopfes und halten `WAPPEN_HALTEN_MS` + Zuschlag.
 *
 * ══ SO WIRD ES BENUTZT ═════════════════════════════════════════════════════
 *
 *     import { adminAuf } from './admin-weg.mjs'
 *     const hinein = async () => { await adminAuf(ev); await warte(1100) }
 *
 * `ev` ist die Auswertefunktion des Werkzeugs (ein `Runtime.evaluate`, das den
 * Wert zurueckgibt). Mehr braucht es nicht — jedes der Werkzeuge hat so eine.
 */

/**
 * WIE LANGE GEHALTEN WERDEN MUSS. Muss mit `WAPPEN_HALTEN_MS` in
 * NewDesign/app.js uebereinstimmen.
 *
 * 1200 UND NICHT DIE VOM BETREIBER GENANNTEN 2000: mit echten Beruehrungen
 * gemessen (tools/finger-probe.mjs, 06.08.2026) haelt ein Griff ab 800 ms
 * zuverlaessig; 2 s sind die Spanne, in der ein Elternteil mit einem
 * zappelnden Kind auf dem Arm loslaesst. Mit ihm abgesprochen.
 */
export const WAPPEN_HALTEN_MS = 1200

/** Der Knopf selbst — als Auswahl, fuer Werkzeuge die Ziele benennen. */
export const WAPPEN_WAHL = '#wappen'

/** Der Ring, der die Frist sichtbar macht. */
export const RING_WAHL = '#wappen-ring'

/**
 * WER DAS HALTEN WIRKLICH PRUEFT.
 *
 * Diese Liste ist kein Schmuck. Der Tastaturweg oben macht den Bereich in
 * einem Wimpernschlag auf und laesst dabei JEDE Aussage ueber die Geste
 * ungeprueft. Solange hier etwas steht, ist das in Ordnung — die Geste hat
 * ihre eigene Pruefung. Wird die Liste leer, ist sie es nicht mehr.
 */
export const WAPPEN_HALTEN = {
  pruefer: ['tools/wappen-halten-probe.mjs', 'tools/finger-bedienung.mjs'],
  frist: WAPPEN_HALTEN_MS,
}

/**
 * DIE MITTE DES KNOPFES — fuer alle, die wirklich druecken.
 *
 * Gibt `null` zurueck, wenn es den Knopf nicht gibt. Das ist Absicht: ein
 * Werkzeug, das daraufhin nichts misst und „alles gruen" meldet, ist
 * schlimmer als eines, das an dieser Stelle laut wird.
 */
export const WAPPEN_MITTE_JS = `(() => {
  const e = document.getElementById('wappen')
  if (!e) return null
  const b = e.getBoundingClientRect()
  if (!b.width || !b.height) return null
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2),
           breite: Math.round(b.width), hoehe: Math.round(b.height) } })()`

/**
 * DER TASTATURWEG, als Ausdruck fuer `Runtime.evaluate`.
 *
 * Gibt 'auf' zurueck, wenn der Knopf da war und die Taste angekommen ist,
 * sonst 'kein-knopf'. NIE stillschweigend `true` — siehe `adminAuf()`.
 */
export const ADMIN_AUF_JS = `(() => {
  const k = document.getElementById('wappen')
  if (!k) return 'kein-knopf'
  try { k.focus() } catch (_) {}
  k.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
  return 'auf' })()`

/** Steht der Admin-Bereich offen? Ueber das WIRKLICHE Rechteck, nicht `hidden`. */
export const ADMIN_OFFEN_JS = `(() => {
  const e = document.getElementById('eltern')
  if (!e) return false
  const b = e.getBoundingClientRect()
  return b.width > 0 && b.height > 0 })()`

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * AUF DEN KNOPF WARTEN — und zwar hier, nicht in jedem Werkzeug.
 *
 * GEMESSEN 06.08.2026: `tools/eltern-seite-messen.mjs` wartet nach dem Laden
 * feste 2200 ms und griff dann zu. Als vier Werkzeuge nebeneinander liefen,
 * reichten sie einmal nicht, und der Lauf brach mit „#wappen ist nicht im
 * Baum" ab — eine Meldung ueber die Auslastung des Rechners, die aussah wie
 * eine ueber die Oberflaeche.
 *
 * EINE FESTE WARTEZEIT IST IMMER ENTWEDER ZU KURZ ODER ZU LANG. Deshalb wird
 * hier auf den Knopf GEWARTET; erst wenn er nach `geduldMs` nicht dasteht,
 * ist das eine Aussage. Und dann ist sie laut.
 */
async function knopfAbwarten(ev, geduldMs) {
  const bis = Date.now() + geduldMs
  for (;;) {
    if (await ev(`!!document.getElementById('wappen')`).catch(() => false)) return true
    if (Date.now() > bis) return false
    await schlafen(150)
  }
}

/**
 * DEN ADMIN-BEREICH AUFMACHEN — und nachsehen, ob er wirklich aufging.
 *
 * WIRFT, wenn der Knopf fehlt oder der Bereich zu bleibt. Das ist der ganze
 * Sinn: Ein Werkzeug, das den Bereich nicht mehr aufbekommt und daraufhin
 * GAR NICHTS misst, meldet leicht „alles gruen". Genau dieser stille
 * Durchrutscher war beim Wegfall des Zahnrads die Gefahr.
 *
 * `pruefen: false` fuer die wenigen Werkzeuge, die absichtlich in eine Lage
 * gehen, in der eine PIN-Sperre den Bereich zunaechst verschlossen haelt —
 * dort steht statt `#eltern` das Tor, und die Pruefung gehoert dem Werkzeug.
 *
 * @param {(js: string) => Promise<any>} ev  Auswertefunktion des Werkzeugs
 */
export async function adminAuf(ev, { warteMs = 1100, pruefen = true, geduldMs = 4000 } = {}) {
  await knopfAbwarten(ev, geduldMs)
  const r = await ev(ADMIN_AUF_JS)
  if (r !== 'auf') {
    throw new Error(
      `Der Menueknopf #wappen stand nach ${geduldMs} ms nicht im Baum. Bis zum ` +
        '06.08.2026 fuehrte das Zahnrad #einst-knopf hinein; es ist ersatzlos ' +
        'entfallen. Siehe tools/admin-weg.mjs.',
    )
  }
  await schlafen(warteMs)
  if (!pruefen) return true
  const bis = Date.now() + geduldMs
  for (;;) {
    if (await ev(ADMIN_OFFEN_JS)) return true
    if (Date.now() > bis) break
    await schlafen(200)
  }
  throw new Error(
    'Enter auf #wappen gedrueckt, aber #eltern blieb zu. Entweder haelt eine ' +
      'Sperre den Bereich (dann adminAuf(ev, { pruefen: false })), oder der ' +
      'Weg hinein ist kaputt.',
  )
}

/**
 * DEN BEREICH DURCH ECHTES HALTEN AUFMACHEN.
 *
 * Braucht eine Druckfunktion des Werkzeugs: `druecken(x, y, ms)`. Damit bleibt
 * hier offen, ob mit Finger (`Input.dispatchTouchEvent`) oder Maus gedrueckt
 * wird — die Werkzeuge, die das koennen, bringen ihre eigene mit.
 */
export async function adminAufHalten(ev, druecken, { ms = WAPPEN_HALTEN_MS + 300, warteMs = 900, geduldMs = 4000 } = {}) {
  await knopfAbwarten(ev, geduldMs)
  const m = await ev(WAPPEN_MITTE_JS)
  if (!m) throw new Error(`#wappen stand nach ${geduldMs} ms nicht im Baum — siehe tools/admin-weg.mjs`)
  await druecken(m.x, m.y, ms)
  await schlafen(warteMs)
  return m
}
