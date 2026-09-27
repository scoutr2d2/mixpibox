#!/usr/bin/env node
/**
 * WIE EIN WERKZEUG DIE OBERFLAECHE DUNKEL BEKOMMT — an EINER Stelle.
 *
 * ══ WAS SICH GEAENDERT HAT ═════════════════════════════════════════════════
 *
 * BIS ZUM 07.08.2026 stand ein Mond in der Kopfzeile (`#licht-knopf`). Sechs
 * Werkzeuge in tools/ schalteten damit ins Dunkle und wieder zurueck:
 *
 *     await ev(`document.getElementById('licht-knopf').click(), true`)
 *
 * DER MOND IST WEG. Betreiber: „was wir auch rausnehmen könen ist hell dunkel
 * aus dem band oben". Hell/dunkel steht seither im Admin-Menue unter
 * Darstellung -> Farbe und Form, zuoberst — und das ist der EINZIGE Schalter.
 *
 * WAS PASSIERT WAERE, HAETTE MAN DIE ZEILE STEHENLASSEN: `getElementById`
 * gibt `null` zurueck, `null.click()` wirft, `ev()` liefert `undefined`. Die
 * Werkzeuge haetten danach WEITER GEMESSEN — im hellen Stand, unter der
 * Ueberschrift „dunkel". Sechs gruene Aussagen ueber eine Lage, die es beim
 * Messen nicht gab. Deshalb steht der Griff jetzt hier und nicht sechsmal.
 *
 * ══ ZWEI WEGE, UND SIE MESSEN VERSCHIEDENES ════════════════════════════════
 *
 * `LICHT_STELLEN_JS(wert)` — DER STAND, NICHT DER SCHALTER.
 *
 *   Setzt `data-licht` an `<html>` und schreibt denselben Schluessel in den
 *   Speicher — Zeile fuer Zeile das, was `lichtSetzen()` in app.js tut. Fuer
 *   Werkzeuge, die messen, was HINTER dem Schalter liegt: wie eine Lane, ein
 *   Raster oder eine Kachel im Dunkeln aussieht.
 *
 *   ES IST KEINE ABSCHWAECHUNG GEGENUEBER DEM KLICK VON FRUEHER. Diese
 *   Werkzeuge haben den Schalter nie geprueft — sie haben ihn benutzt, weil er
 *   zufaellig auf demselben Schirm stand. Ihre Aussage war immer „die Farben
 *   im dunklen Stand stimmen", nie „der Umschalter funktioniert". Der Weg ueber
 *   das Admin-Menue waere fuer sie sogar SCHLECHTER: er raeumt den Schirm ab,
 *   den sie gerade vermessen wollen.
 *
 *   WER DEN SCHALTER SELBST PRUEFT, STEHT IN `LICHT_PRUEFER`. Solange dort
 *   etwas steht, ist das in Ordnung. Wird die Liste leer, ist die einzige Art,
 *   die Box abends dunkel zu bekommen, ungeprueft — und das faellt an einem
 *   hellen Schirm um 21 Uhr auf, nicht vorher.
 *
 * `lichtSeiteAuf(ev)` + `LICHT_TIPP_JS` — DER ECHTE WEG.
 *
 *   Menue auf, Gruppe „Darstellung", Punkt „Farbe und Form", und dort die
 *   oberste Zeile tippen. Fuer Werkzeuge, die die BEDIENUNG pruefen.
 *
 * ══ SO WIRD ES BENUTZT ═════════════════════════════════════════════════════
 *
 *     import { LICHT_STELLEN_JS } from './licht-weg.mjs'
 *     await ev(LICHT_STELLEN_JS('dunkel'))
 *     …messen…
 *     await ev(LICHT_STELLEN_JS('hell'))
 */

/**
 * DER SCHLUESSEL. Muss mit `LICHT` in NewDesign/app.js und mit dem Einzeiler
 * im Kopf von index.html uebereinstimmen — die drei Stellen haelt
 * tools/pruef-neu-regeln.js zusammen.
 */
export const LICHT_SCHLUESSEL = 'mupibox_neu_licht_v1'

/**
 * WER DEN SCHALTER WIRKLICH BEDIENT UND NACHSIEHT, OB ETWAS PASSIERT.
 *
 * Kein Schmuck: `LICHT_STELLEN_JS` unten stellt den Stand von aussen und
 * laesst damit JEDE Aussage ueber die Bedienung ungeprueft. Diese Liste ist
 * die Deckung dafuer. Dasselbe Muster wie `WAPPEN_HALTEN.pruefer` in
 * tools/admin-weg.mjs, und aus demselben Grund.
 */
export const LICHT_PRUEFER = ['tools/licht-weg-probe.mjs']

/** Wo der einzige Schalter steht — als Text, fuer Meldungen von Werkzeugen. */
export const LICHT_ORT = 'Admin-Menue -> Darstellung -> Farbe und Form, oberste Zeile'

/**
 * DEN STAND SETZEN, OHNE DEN SCHALTER ZU BEDIENEN.
 *
 * Genau die zwei Wirkungen von `lichtSetzen()` in app.js: das Attribut an
 * `<html>` (daran haengt der ganze Variablensatz in app.css) und der Schluessel
 * im Speicher (damit ein Neuladen im selben Stand aufwacht).
 *
 * WIRFT NICHT UND SCHWEIGT NICHT: gibt den gesetzten Wert zurueck. Ein
 * Werkzeug, das `undefined` bekommt, hat ein Problem und soll es merken —
 * genau der stille Fall, an dem der Klick aufs verschwundene Zahnrad-Pendant
 * gescheitert waere.
 */
export const LICHT_STELLEN_JS = (wert) => {
  const w = wert === 'dunkel' ? 'dunkel' : 'hell'
  return `(() => {
    document.documentElement.setAttribute('data-licht', '${w}')
    try { localStorage.setItem('${LICHT_SCHLUESSEL}', '${w}') } catch (e) {}
    return document.documentElement.getAttribute('data-licht')
  })()`
}

/** Welcher Stand gerade gilt — 'hell', 'dunkel' oder null. */
export const LICHT_STAND_JS = `document.documentElement.getAttribute('data-licht')`

/**
 * DIE SEITE MIT DEM SCHALTER AUFSCHLAGEN — der echte Weg.
 *
 * Braucht `adminAuf` schon erledigt oder erledigt es selbst. Danach steht
 * „Farbe und Form" da und `LICHT_TIPP_JS` trifft die oberste Zeile.
 */
export const LICHT_SEITE_JS = `(() => {
  const g = document.querySelector('.fach-knopf[data-fach="anzeige"]')
  if (!g) return 'keine-gruppe'
  g.click()
  return 'gruppe'
})()`

export const LICHT_PUNKT_JS = `(() => {
  const p = [...document.querySelectorAll('#fach-zeilen .fach-sprung')]
    .find((k) => (k.querySelector('.zeile-name') || {}).textContent === 'Farbe und Form')
  if (!p) return 'kein-punkt'
  p.click()
  return 'punkt'
})()`

/**
 * DIE ZEILE TIPPEN. Gibt 'getippt' zurueck, sonst 'kein-knopf' — NIE
 * stillschweigend etwas Wahres.
 */
export const LICHT_TIPP_JS = `(() => {
  const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
    .find((e) => (e.querySelector('.zeile-name') || {}).textContent === 'Hell oder dunkel')
  const k = z && z.querySelector('.zeile-tat')
  if (!k) return 'kein-knopf'
  k.click()
  return 'getippt'
})()`

/**
 * WAS IN DER ZEILE STEHT — Zeichen, Wort, ob sie zuoberst steht.
 *
 * DAS ZEICHEN IST SEIT DEM 07.08.2026 KEIN TEXT MEHR, sondern ein SVG (die
 * Box kennt nur DejaVu und zeichnete jedes Emoji als leeres Rechteck). Gelesen
 * wird deshalb `data-zeichen` — der NAME aus der Karte `ZEICHEN` in app.js.
 * Wer hier weiter `textContent` naehme, bekaeme eine leere Zeichenkette und
 * damit eine Probe, die still gruen bleibt, waehrend das Zeichen fehlt.
 *
 * KEIN GEGENHAKEN IN DIESEM BLOCK: er geht als Template-String an den Browser.
 */
export const LICHT_ZEILE_JS = `(() => {
  const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
    .find((e) => (e.querySelector('.zeile-name') || {}).textContent === 'Hell oder dunkel')
  if (!z) return null
  const k = z.querySelector('.zeile-tat')
  const zei = z.querySelector('.zeile-zeichen')
  return {
    zeichen: zei ? zei.getAttribute('data-zeichen') || '' : '',
    zeichenGemalt: !!(zei && zei.querySelector('svg')),
    wort: k ? k.textContent : null,
    an: z.classList.contains('an'),
    erste: z === document.querySelector('#fach-zeilen .fach-zeile'),
  }
})()`

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * DEN ECHTEN WEG GEHEN — vom offenen Admin-Menue bis zur Seite mit dem
 * Schalter. WIRFT, wenn die Gruppe oder der Punkt fehlt: ein Werkzeug, das
 * daraufhin auf einem falschen Schirm weitermisst, meldet leicht „alles gruen".
 *
 * @param {(js: string) => Promise<any>} ev  Auswertefunktion des Werkzeugs
 */
export async function lichtSeiteAuf(ev, { warteMs = 700 } = {}) {
  const g = await ev(LICHT_SEITE_JS)
  if (g !== 'gruppe') {
    throw new Error(`Die Gruppe „Darstellung" steht nicht in der Faecherspalte (${g}). Siehe tools/licht-weg.mjs.`)
  }
  await schlafen(400)
  const p = await ev(LICHT_PUNKT_JS)
  if (p !== 'punkt') {
    throw new Error(`Der Punkt „Farbe und Form" steht nicht in der Uebersicht (${p}). Siehe tools/licht-weg.mjs.`)
  }
  await schlafen(warteMs)
  return true
}
