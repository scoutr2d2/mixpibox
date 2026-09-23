/**
 * Der Satz, der einen schwarzen Bildschirm erklaert.
 *
 * DER PRUEFFALL, UM DEN ES GEHT, IST DER ZWEITE: steht das Geraet auf 0, darf
 * hier nicht „alles in Ordnung" herauskommen. Genau das tat die Verwaltung
 * vorher — sie las `prozent: 20` aus der Antwort, zeigte 20 % und schwieg,
 * waehrend vor dem Kind ein schwarzes Rechteck stand.
 *
 * Und der dritte Fall ist der, der den Menschen wirklich rettet: es MUSS ein
 * Knopf angeboten werden. Ein Regler, der schon ganz links steht, schickt
 * beim Zug auf sein Minimum nichts.
 */
import { klemmhinweis, lagesaetze, reglerAusgabe } from './schirm-text'

describe('klemmhinweis', () => {
  it('schweigt, solange die Anzeige die Wahrheit sagt', () => {
    const h = klemmhinweis({ geklemmt: false, prozentEcht: 55, min: 20 })
    expect(h.hinweis).toBe(false)
    expect(h.satz).toBe('')
    expect(h.knopf).toBe('')
  })

  it('SCHWARZER SCHIRM: sagt es deutlich und nennt beide Zahlen', () => {
    const h = klemmhinweis({ geklemmt: true, prozentEcht: 0, min: 20 })
    expect(h.hinweis).toBe(true)
    expect(h.satz).toContain('SCHWARZ')
    expect(h.satz).toContain('0 %')
    expect(h.satz).toContain('20 %')
  })

  it('bietet einen Knopf an — der Regler allein kaeme aus dieser Lage nicht heraus', () => {
    const h = klemmhinweis({ geklemmt: true, prozentEcht: 0, min: 20 })
    expect(h.knopf).toBe('Auf 20 % stellen')
    expect(h.satz).toContain('schickt nichts')
  })

  it('dunkel, aber nicht schwarz: nennt den echten Wert', () => {
    const h = klemmhinweis({ geklemmt: true, prozentEcht: 5, min: 20 })
    expect(h.satz).toContain('5 %')
    expect(h.satz).not.toContain('SCHWARZ')
  })

  it('sagt, WOHER so ein Wert kommt — sonst sucht man ihn in der neuen Verwaltung', () => {
    const h = klemmhinweis({ geklemmt: true, prozentEcht: 0, min: 20 })
    expect(h.satz).toContain('alte Verwaltungsseite')
  })

  it('nimmt die Untergrenze aus der Antwort und erfindet sie nicht', () => {
    const h = klemmhinweis({ geklemmt: true, prozentEcht: 2, min: 30 })
    expect(h.knopf).toBe('Auf 30 % stellen')
    expect(h.satz).toContain('30 %')
  })
})

/**
 * Die zweite Sorte Luege: die Zahl stimmt, und man sieht sie trotzdem nicht.
 *
 * BEIDE FAELLE SIND AM BILD GEMESSEN (08.08.2026,
 * tools/schirm-regler-ansehen.mjs, Lagen `d-schirm-aus` und `f-unlesbar`) und
 * nicht ausgedacht.
 */
describe('lagesaetze', () => {
  it('schweigt, wenn der Schirm an ist und der Stand bekannt', () => {
    expect(lagesaetze({ schirmAus: false, standBekannt: true })).toEqual([])
  })

  it('abgeschalteter Schirm: sagt, dass man den Regler am Geraet nicht sieht', () => {
    const s = lagesaetze({ schirmAus: true, standBekannt: true })
    expect(s.length).toBe(1)
    expect(s[0]).toContain('ganz abgeschaltet')
    expect(s[0]).toContain('nicht zu sehen')
  })

  it('NENNT KEINEN GRUND — die Seite sieht nur bl_power, nicht die Ursache', () => {
    const s = lagesaetze({ schirmAus: true, standBekannt: true })
    expect(s[0]).not.toContain('Zeitschaltung')
  })

  it('unbekannter Stand: sagt, dass die Zahl am Regler keine Auskunft ist', () => {
    const s = lagesaetze({ schirmAus: false, standBekannt: false })
    expect(s.length).toBe(1)
    expect(s[0]).toContain('KEINE Auskunft')
  })

  it('beides zugleich: BEIDE Saetze, keiner verschluckt den anderen', () => {
    expect(lagesaetze({ schirmAus: true, standBekannt: false }).length).toBe(2)
  })
})

describe('reglerAusgabe', () => {
  it('zeigt die Zahl, wenn es eine gibt', () => {
    expect(reglerAusgabe(20)).toBe('20 %')
    expect(reglerAusgabe(100)).toBe('100 %')
  })

  it('ERFINDET KEINE, wenn der Server keine geschickt hat', () => {
    expect(reglerAusgabe(null)).toBe('? %')
  })
})
