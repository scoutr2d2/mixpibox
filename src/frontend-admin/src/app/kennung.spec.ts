/**
 * Die Kennung eines neuen Profils — sie wird zum DATEINAMEN.
 *
 * `profile/<kennung>/auswahl.json`, `gespielt.<kennung>.json`,
 * `mupibox_p_<kennung>_…`. Deshalb prueft der Server sie streng:
 *
 *     const KENNUNG_MUSTER = /^[a-z0-9-]{1,24}$/     (backend-api/src/profile.ts)
 *
 * Was die Verwaltung erzeugt und der Server ablehnt, scheitert erst beim
 * Speichern — und dann steht der Erwachsene vor einer Fehlermeldung statt vor
 * einem angelegten Kind. Diese Tests halten beide Seiten aneinander.
 */
import { kennungAus } from './seiten/kinderzeit'

/** WOERTLICH die Regel des Servers. Weicht sie ab, ist der Test wertlos. */
const KENNUNG_MUSTER = /^[a-z0-9-]{1,24}$/

describe('Kennung aus einem Namen', () => {
  it('macht aus gewöhnlichen Namen das Erwartete', () => {
    expect(kennungAus('Kalea')).toBe('kalea')
    expect(kennungAus('Anna Lena')).toBe('anna-lena')
    expect(kennungAus('  Ben  ')).toBe('ben')
  })

  it('löst Umlaute auf, statt sie wegzuwerfen', () => {
    // „Jrg" waere ein Name, den niemand wiedererkennt.
    expect(kennungAus('Jörg')).toBe('joerg')
    expect(kennungAus('Bärbel')).toBe('baerbel')
    expect(kennungAus('Günther')).toBe('guenther')
    expect(kennungAus('Straßer')).toBe('strasser')
  })

  it('nimmt auch fremde Zeichen an, ohne etwas Unbrauchbares zu liefern', () => {
    // Akzente werden zu ihrem Grundzeichen — das ist besser als ein Bindestrich.
    expect(kennungAus('Chloé')).toBe('chloe')
    expect(kennungAus('André')).toBe('andre')
  })

  it('erzeugt NIE etwas, das der Server ablehnt', () => {
    const proben = [
      'Kalea',
      'Anna Lena',
      'Jörg',
      'Straßer',
      'Chloé',
      'Kind 2',
      '  viele   leerzeichen  ',
      'Sonderzeichen!!!§$%&/()',
      'MIT GROSSBUCHSTABEN',
      'ein-sehr-sehr-sehr-langer-name-mit-vielen-teilen',
      'a',
      '2000',
    ]
    for (const p of proben) {
      const k = kennungAus(p)
      expect(k).withContext(`„${p}" ergab „${k}"`).toMatch(KENNUNG_MUSTER)
    }
  })

  it('endet nie auf einem Bindestrich — auch nicht nach dem Abschneiden', () => {
    // DIE FALLE: erst auf 24 Zeichen kuerzen, dann steht dort womoeglich ein
    // Bindestrich. Er trifft das Muster zwar noch, sieht aber im Dateinamen
    // nach einem Fehler aus.
    const lang = kennungAus('abcdefghij klmnopqrst uvwxyz')
    expect(lang.endsWith('-')).toBe(false)
    expect(lang.length).toBeLessThanOrEqual(24)
    expect(lang).toMatch(KENNUNG_MUSTER)
  })

  it('gibt LEER zurück, wenn nichts Brauchbares übrig bleibt', () => {
    // Leer ist die ehrliche Antwort — die Seite sagt dann „bitte Buchstaben
    // verwenden", statt eine Kennung zu erfinden, die niemand wiederfindet.
    expect(kennungAus('!!!')).toBe('')
    expect(kennungAus('   ')).toBe('')
    expect(kennungAus('')).toBe('')
    // Und leer trifft das Muster ABSICHTLICH nicht: der Server wuerde es
    // ablehnen, deshalb faengt die Seite es vorher ab.
    expect(KENNUNG_MUSTER.test('')).toBe(false)
  })
})
