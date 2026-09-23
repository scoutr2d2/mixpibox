/**
 * Dauern in Worte — und die EINE Stelle, an der „kein Wert" gesagt wird.
 *
 * WARUM ES DIESE DATEI GIBT (19.09.2026, AUDIT-2026-09-19 Rang 10d): Im Baum
 * standen VIER „wie lange läuft das"-Formatierer nebeneinander und liefen
 * auseinander. Der auf der Systemseite hatte den Wächter verloren und zeigte
 * bei fehlendem Wert „0 min" — eine Box, die angeblich gerade erst angelaufen
 * ist, obwohl in Wahrheit niemand es weiß. Der hier zeigte aus demselben
 * Grund „0 s".
 *
 * WAS HIER GETEILT WIRD, IST DER WÄCHTER — NICHT DIE FORMATIERUNG. Die
 * Versuchung ist, beide Formatierer zu einem zu verschmelzen; das wäre falsch.
 * Die Laufzeit der Box wird grob gefragt („läuft sie seit dem letzten
 * Stromausfall durch?") und grob beantwortet — Tage und Stunden, nie Sekunden.
 * Das Alter eines Prozesses wird fein gefragt, und ein Prozess, der seit 42
 * Sekunden läuft, muss „42 s" sagen dürfen und nicht „0 min". Zusammengelegt
 * verlöre die Prozessliste genau die Auskunft, wegen der man sie aufruft.
 *
 * Geteilt gehört stattdessen das, was tatsächlich verloren ging: die Frage
 * „ist das überhaupt eine Dauer?" und das Wort für die Antwort „nein".
 *
 * KEIN ANGULAR HIER. Die Datei ist reine Rechnerei und wird über
 * `dauer-text.node.spec.ts` mit `tsx --test` geprüft (siehe node_specs in
 * tools/pruefen.sh).
 */

/**
 * Das Wort für „kein Wert".
 *
 * Es steht hier und nicht dreimal im Text, damit die Seiten sich einig sind.
 * `leistung.ts` sagt es an der Startdauer schon seit dem 20.08.2026 so
 * („unbekannt", nicht „0 s"), und der Server sagt es in `laufzeitText`
 * ebenso — dieselbe Auskunft soll überall gleich klingen.
 */
export const UNBEKANNT = 'unbekannt'

/**
 * Ist das eine Dauer, über die sich etwas sagen lässt?
 *
 * NULL IST EINE DAUER und darf hier durch: eine Box, die gerade angelaufen
 * ist, läuft seit 0 Sekunden — das ist eine Auskunft. Fehlend, unendlich oder
 * negativ ist dagegen KEINE Auskunft, sondern eine fehlende.
 *
 * Genau diese Unterscheidung ging beim alten `Math.max(0, Number(x) || 0)`
 * verloren: es machte aus `undefined`, `NaN` und `-5` allesamt eine glatte
 * Null und log damit dreimal.
 *
 * EHRLICH GEMESSEN (19.09.2026, gegen src/backend-api/src/leistung.ts): Auf
 * der Leistungsseite ist heute KEINER dieser Fälle erreichbar — `psLesen`
 * liest die Laufzeit aus einer `(\d+)`-Gruppe, und das `Math.max(...)` der
 * „Übrigen" steht hinter `uebrig.length ?`. Der Wächter ist hier also nicht
 * die Reparatur eines laufenden Fehlers, sondern das, was `Leistungslage`
 * nur VERSPRICHT: Die Lage kommt über HTTP, der Typ gilt beim Übersetzen und
 * nicht zur Laufzeit. Ein älterer Server, ein umbenanntes Feld, eine
 * abgeschnittene Antwort — und die Seite soll „unbekannt" sagen statt eine
 * Messung zu erfinden.
 *
 * AUF DER SYSTEMSEITE WAR DER FEHLER DAGEGEN LEBENDIG: dort stand durch
 * `?? 0` „0 min", sobald die Lage fehlte — und sie fehlt bei jeder Box, die
 * nicht antwortet.
 */
export function istDauer(sekunden: unknown): sekunden is number {
  return typeof sekunden === 'number' && Number.isFinite(sekunden) && sekunden >= 0
}

/**
 * Einen fertigen Satz vom Server übernehmen — oder sagen, dass keiner kam.
 *
 * Seit dem 19.09.2026 schickt `/api/system` die Laufzeit als fertigen Text
 * mit (`laufzeit`, server.ts:5540); die Grenzfälle (negativ, NaN) entscheidet
 * dort `laufzeitText`, an EINER Stelle und geprüft. Die Oberfläche rechnet
 * deshalb nicht mehr nach — sie prüft nur noch, ob überhaupt etwas ankam.
 *
 * Warum das nötig ist, obwohl der Server es immer schickt: Verwaltung und
 * Server werden zwar gemeinsam ausgeliefert, können aber WÄHREND eines
 * Updates auseinanderfallen (derselbe Fall wie bei `SystemAktion.bereich` in
 * system.dienst.ts). Dann ist „unbekannt" die richtige Auskunft — und nicht
 * „0 min", was wie eine Messung aussieht.
 */
export function textOderUnbekannt(text: unknown): string {
  return typeof text === 'string' && text.trim() !== '' ? text : UNBEKANNT
}

/**
 * Sekunden als grobe Dauer.
 *
 * DIE GRÖBSTE EINHEIT, DIE NOCH ETWAS SAGT: Ein Dienst, der seit Tagen läuft,
 * hat eine sechsstellige Sekundenzahl — die liest niemand. „seit 3 Tagen" ist
 * die Auskunft, die man wollte.
 *
 * Bis zum 19.09.2026 stand diese Funktion in `seiten/leistung.ts` und
 * klemmte alles Unbrauchbare auf 0.
 */
export function dauerText(sekunden: number | null | undefined): string {
  if (!istDauer(sekunden)) return UNBEKANNT
  const n = Math.round(sekunden)
  if (n < 90) return `${n} s`
  if (n < 5400) return `${Math.round(n / 60)} min`
  if (n < 172800) return `${Math.round(n / 3600)} h`
  return `${Math.round(n / 86400)} Tage`
}
