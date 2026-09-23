/**
 * DER LESER, DER NICHT STILL NICHTS FINDEN DARF.
 *
 * tools/verwaltung-suche-aktionen.mjs liest die bekannten Bereiche aus
 * AKTION_ORT in suche.ts — mit einem Ausdruck ueber TypeScript-Text. Das ist
 * die verwundbare Stelle des ganzen Werkzeugs: passt der Ausdruck eines Tages
 * nicht mehr, faende es NULL Bereiche, haette gegen nichts geprueft und
 * meldete trotzdem „in Ordnung". Ein Werkzeug, das bei kaputtem Leser gruen
 * wird, ist schlimmer als keines.
 *
 * Deshalb steht hier zweierlei: dass es die ECHTE Datei liest (und nicht
 * bloss eine Attrappe versteht), und dass es bei einer Datei ohne AKTION_ORT
 * WIRFT statt leer zurueckzukommen.
 *
 * AUFRUF
 *     node --test tools/verwaltung-suche-aktionen.test.mjs
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { bereicheDerVerwaltung } from './verwaltung-suche-aktionen.mjs'

describe('Die Bereiche der Verwaltung werden gelesen, nicht aufgezaehlt', () => {
  test('aus der echten suche.ts kommen die Bereiche mit Seite, Weg und Abschnitt', () => {
    const b = bereicheDerVerwaltung()
    assert.ok(b.size >= 2, `nur ${b.size} Bereiche gelesen`)
    for (const [name, ort] of b) {
      assert.ok(ort.name.length > 0, `${name}: kein Seitenname`)
      assert.ok(ort.weg.startsWith('/'), `${name}: kein Weg`)
      assert.ok(ort.abschnitt.length > 0, `${name}: kein Abschnitt`)
    }
    // Die beiden, die es seit dem 03.08.2026 gibt. Kommt ein dritter dazu,
    // faellt dieser Test NICHT um — er soll nicht die Gliederung festnageln,
    // sondern zeigen, dass wirklich gelesen wurde.
    assert.ok(b.has('medien'))
    assert.ok(b.has('box'))
  })

  test('eine Datei ohne AKTION_ORT ist ein Fehler, kein leeres Ergebnis', () => {
    assert.throws(() => bereicheDerVerwaltung('export class Suche {}\n'), /AKTION_ORT/)
  })

  test('ein AKTION_ORT, das der Ausdruck nicht mehr trifft, wirft ebenfalls', () => {
    // Genau der Fall, der still gruen werden koennte: die Angabe steht da,
    // aber in einer Form, die der Ausdruck nicht liest.
    const anders = ['export const AKTION_ORT: Record<string, Ort> = {', '  medien: ORT_MEDIEN,', '}', ''].join('\n')
    assert.throws(() => bereicheDerVerwaltung(anders), /kein einziger Bereich/)
  })
})
