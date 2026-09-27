import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AKTIONS_ARTEN, BOX_AKTIONEN, istBoxAktion } from './box-aktionen'

/**
 * Die Liste der Box-Aktionen ist ein VERTRAG: ihre Kennungen landen in
 * gespeicherten Tasten-Zuordnungen. Ändert sich eine, zeigt die Zuordnung
 * einer Fernbedienung ins Leere — und zwar still, beim Kind im Kinderzimmer.
 * Deshalb steht die Unveränderlichkeit hier fest.
 */

describe('Box-Aktionen: die Liste selbst', () => {
  it('hat eindeutige Kennungen', () => {
    const ids = BOX_AKTIONEN.map((a) => a.id)
    assert.equal(new Set(ids).size, ids.length, 'doppelte Kennung — eine Zuordnung träfe zwei Aktionen')
  })

  it('nennt nur bekannte Arten', () => {
    for (const a of BOX_AKTIONEN) {
      assert.ok(AKTIONS_ARTEN.includes(a.art), `${a.id} hat die unbekannte Art ${a.art}`)
    }
  })

  it('gibt jeder Aktion einen Namen UND eine Wirkung', () => {
    // Ohne Wirkungssatz steht in der Verwaltung eine Wahl, die niemand
    // beurteilen kann — „Zurück" heisst auf jedem Geraet etwas anderes.
    for (const a of BOX_AKTIONEN) {
      assert.ok(a.name.trim().length > 2, `${a.id} ohne brauchbaren Namen`)
      assert.ok(a.wirkung.trim().length > 15, `${a.id} ohne Wirkungssatz`)
    }
  })

  it('haelt die Kennungen in Kleinschreibung mit Bindestrich', () => {
    // Sie werden gespeichert und wandern durch JSON, Dateinamen und URLs.
    for (const a of BOX_AKTIONEN) {
      assert.match(a.id, /^[a-z][a-z-]*[a-z]$/, `${a.id} ist keine saubere Kennung`)
    }
  })
})

describe('Box-Aktionen: die Kennungen sind FESTGENAGELT', () => {
  // DIESER TEST IST DIE EIGENTLICHE WACHE. Wer eine Kennung umbenennt, muss
  // hier vorbei — und dabei merken, dass draussen Zuordnungen liegen, die
  // sie nennen. Neue Aktionen DUERFEN dazukommen (die Liste waechst), aber
  // keine bestehende darf sich unter der Hand aendern.
  const FESTGENAGELT = [
    'abspielen-anhalten',
    'naechster-titel',
    'voriger-titel',
    'stoppen',
    'hoch',
    'runter',
    'links',
    'rechts',
    'auswaehlen',
    'lauter',
    'leiser',
    'startseite',
    'zurueck',
    'ausschalten',
  ]

  it('kennt jede der festgenagelten Aktionen noch', () => {
    for (const id of FESTGENAGELT) {
      assert.ok(istBoxAktion(id), `${id} ist verschwunden — gespeicherte Zuordnungen zeigen ins Leere`)
    }
  })
})

describe('Box-Aktionen: Nachschlagen', () => {
  // `boxAktion(id)` ist am 19.09.2026 gefallen (AUDIT-2026-09-19 Rang 7) —
  // sie hatte ausser diesen Zeugen keinen Leser. Was sie ZUSICHERTE, ist
  // nicht mitgefallen: dass eine Kennung die erwartete Art und Wirkung
  // traegt, steht weiter hier und wird an der Liste selbst geprueft.
  const nach = (id: unknown) => BOX_AKTIONEN.find((a) => a.id === id) ?? null

  it('findet eine Aktion und gibt ihre Wirkung', () => {
    const a = nach('lauter')
    assert.equal(a?.art, 'lautstaerke')
    assert.match(a?.wirkung ?? '', /Obergrenze/)
  })

  it('gibt bei Unbekanntem ehrlich null statt zu raten', () => {
    assert.equal(nach('gibtsnicht'), null)
    assert.equal(nach(undefined), null)
    assert.equal(istBoxAktion('gibtsnicht'), false)
    assert.equal(istBoxAktion(42), false)
  })
})

describe('Box-Aktionen: was auf einen LANGEN Druck gehoert', () => {
  it('empfiehlt den langen Druck fuers Ausschalten — und nur dafuer', () => {
    // Ein Kind trifft eine Taste versehentlich. Was etwas BEENDET, gehoert
    // deshalb hinter einen langen Druck; Transport darf sofort wirken,
    // sonst fuehlt sich die Box traege an.
    const lang = BOX_AKTIONEN.filter((a) => a.langerDruckEmpfohlen).map((a) => a.id)
    assert.deepEqual(lang, ['ausschalten'])
  })

  it('laesst das Ausschalten NIE ohne Rueckfrage geschehen', () => {
    // Die Wirkung sagt es zu — und diese Zusage ist der Grund, warum die
    // Aktion ueberhaupt auf einer Fernbedienung liegen darf.
    assert.match(BOX_AKTIONEN.find((a) => a.id === 'ausschalten')?.wirkung ?? '', /Rückfrage|Bestätigung/i)
  })
})
