/**
 * Die beiden Medien-Schalter aus darstellung.json — lesen und umlegen.
 *
 * Reine Rechnerei ohne Angular, damit `medien-schalter.node.spec.ts` sie
 * ohne Browser pruefen kann. Benutzt von `darstellung.dienst.ts`.
 *
 * `verschmelzen` `!== false`: Vorgabe AN seit 06.09.2026 (Betreiber: „default
 * immer verschmolzen ... da wir ja auch so intern arbeiten"). Mit `=== true`
 * zeigte die Verwaltung AUS, während die Box längst verschmilzt — zwei
 * Wahrheiten über denselben Schalter.
 *
 * DESHALB LEGT `umgelegt` GEGEN DIESELBE VORGABE UM, gegen die angezeigt wird.
 * Bis 27.09.2026 stand dort `aktuell[feld] !== true`: ein FEHLENDES
 * `verschmelzen` (angezeigt als AN) wurde beim Tipp zu `true` — der Schalter
 * blieb an, statt auszugehen, und das beim allerersten Tipp jeder Box.
 */

/** Nur die Schalter, die die Medienseite anfasst. Alles andere bleibt unberuehrt. */
export interface MedienSchalter {
  verschmelzen: boolean
  diskografie: boolean
}

/** Die Schalter aus dem gelesenen Stand — mit den Vorgaben der Box. */
export function schalterAus(a: Record<string, unknown>): MedienSchalter {
  return {
    verschmelzen: a.verschmelzen !== false,
    diskografie: a.diskografie === true,
  }
}

/** Der Stand mit EINEM umgelegten Schalter; alle anderen Felder bleiben. */
export function umgelegt(a: Record<string, unknown>, feld: keyof MedienSchalter): Record<string, unknown> {
  return { ...a, [feld]: !schalterAus(a)[feld] }
}
