/**
 * Zeigt die Box ein Akkusymbol — und ab wann?
 *
 * WOFUER: am 2026-07-29 lief die Box zum ersten Mal am Akku, und es kam KEIN
 * Symbol, obwohl der Ladebaustein einwandfrei meldete. Grund war nicht ein
 * Fehler, sondern ZWEI Schalter mit demselben Namen in zwei Dateien:
 *
 *   /etc/mupibox/mupiboxconfig.json   -> mupihat.hat_active        (PHP-Verwaltung schreibt hier)
 *   .../server/config/config.json     -> node-sonos-http-api.hat_active (Oberflaeche liest hier)
 *
 * Sie laufen zwangslaeufig auseinander, und wer das nicht weiss, sucht den
 * Fehler in der Platine. Deshalb wird der Schalter nicht mehr geglaubt,
 * sondern GEPRUEFT: liefert der HAT gerade Werte, gibt es einen Akku, also
 * gibt es ein Symbol. Der gesetzte Schalter bleibt als ODER erhalten - eine
 * Box, die ihn bewusst an hat, verliert nichts.
 *
 * REIN: kein Netz, kein Dateizugriff - der Server liest die Datei und reicht
 * das Ergebnis herein. So ist die Regel ohne Box pruefbar.
 */

/**
 * Traegt der HAT gerade eine echte Messung?
 *
 * Nicht "die Datei existiert": der Leser-Dienst legt sie auch an, wenn er
 * nichts lesen kann, und schreibt dann `[]` hinein - genau das stand am
 * Geraet drin, waehrend der Dienst wegen eines fehlenden Python-Moduls
 * gescheitert war. Ein Symbol auf so einer Grundlage waere gelogen.
 */
export function hatMisst(daten: unknown): boolean {
  if (!daten || typeof daten !== 'object' || Array.isArray(daten)) return false
  const d = daten as Record<string, unknown>
  const vbat = Number(d.Vbat)
  // Eine plausible 2S-Li-Ion-Spannung. Unter 3 V ist kein Pack, sondern ein
  // Messfehler oder ein Baustein ohne Akku; ueber 13 V ist es keine 2S-Zelle
  // mehr. Beides lieber NICHT anzeigen als falsch anzeigen.
  return Number.isFinite(vbat) && vbat > 3000 && vbat < 13000
}

/**
 * Soll die Oberflaeche das Akkusymbol zeigen?
 *
 * `flag` = der konfigurierte Schalter (darf fehlen), `daten` = der zuletzt
 * gelesene HAT-Stand. Gezeigt wird, sobald EINES von beidem dafuer spricht.
 */
export function hatAktiv(flag: unknown, daten: unknown): boolean {
  return flag === true || hatMisst(daten)
}

/* c8 ignore next 3 */
declare const module: { exports: unknown } | undefined
if (typeof module !== 'undefined') module.exports = { hatMisst, hatAktiv }
