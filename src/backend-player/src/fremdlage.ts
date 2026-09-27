/**
 * E104 — die REINE Entscheidung, ob eine fremde Spotify-Wiedergabe
 * anzuhalten ist. Ausgelagert wie zeitschranke.ts/pegel.ts: spotify-control
 * startet beim Import Server und Uhren, eine Probe darauf waere keine.
 *
 * „Fremd" heisst: Spotify spielt AUF DIESER BOX, ohne dass der
 * Abspieldienst es angestossen hat (Connect-Resume nach soloist-Neustart,
 * die App eines Elternteils, ein frisch getauschter Player mit leerer
 * Buchfuehrung — die drei am 30.08.2026 gemessenen Gesichter).
 *
 * BEIDE Felder muessen WAHR sein, nicht bloss wahrhaftig: eine halbe
 * Antwort (Server im Tausch, Web-API-Fehler, leeres JSON) darf NIE eine
 * Pause ausloesen — der Rueckfall ist immer „nichts tun", also exakt das
 * Verhalten vor E104. Und `aufDieserBox` ist die Grenze der Hoeflichkeit:
 * fremde GERAETE beruehrt die Box weiterhin nie.
 */
export function sollFremdePauseSenden(s: unknown): boolean {
  const l = s as { spielt?: unknown; aufDieserBox?: unknown } | null
  return Boolean(l && l.spielt === true && l.aufDieserBox === true)
}
