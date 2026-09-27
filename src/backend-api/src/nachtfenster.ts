/**
 * Gilt das Nachtfenster einer Erweiterung gerade? — REIN, die Zeit kommt herein.
 *
 * Dieselbe Regel wie `nachtmodusGilt` in der Aufnahme-Erweiterung
 * (auftrag.mjs). Sie steht hier ein zweites Mal, weil der Server die
 * Erweiterung NICHT importieren darf: Erweiterungen werden je Ordner
 * ausgerollt, und eine Box ohne diese Erweiterung braucht trotzdem einen
 * baubaren Server. Wer die Regel aendert, aendert sie an beiden Orten.
 *
 *   * ohne Zeitfenster gilt es sofort („jetzt", nicht „nie"),
 *   * ueber Mitternacht ist der Normalfall (22:00–06:00),
 *   * eine unlesbare Zeit schaltet AB, nicht ein.
 */
export function nachtfensterGilt(einstellungen: Record<string, unknown> | null | undefined, jetzt: Date): boolean {
  if (einstellungen?.nachtmodus !== true) return false
  const von = uhrzeitMinuten(einstellungen?.nachtVon)
  const bis = uhrzeitMinuten(einstellungen?.nachtBis)
  if (von === null && bis === null) return true
  if (von === null || bis === null) return false
  const m = jetzt.getHours() * 60 + jetzt.getMinutes()
  return von <= bis ? m >= von && m < bis : m >= von || m < bis
}

/** `HH:MM` als Minuten seit Mitternacht — oder null. */
export function uhrzeitMinuten(x: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(x ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}
