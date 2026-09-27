/**
 * Was die Suche finden MUSS — an echten Eintraegen des Bestands.
 *
 * Die Faelle hier sind keine erfundenen: es sind die Fragen, mit denen jemand
 * vor der Verwaltung sitzt und nicht weiss, wo etwas hingewandert ist.
 */
import { SUCH_BESTAND } from './such-bestand'
import { type SuchEintrag, normal, ortVon, rangFuer, treffer } from './suche.filter'

/** Ein kleiner, erfundener Bestand fuer die Faelle, die Ordnung pruefen. */
const PROBE: SuchEintrag[] = [
  { text: 'Doppelte zusammenfassen', seite: 'Darstellung', weg: '/darstellung', bereich: 'Elemente' },
  { text: 'wieder zulassen', seite: 'Doppelte', weg: '/verschmelzung', bereich: 'Von Hand getrennt', eltern: 'Medien' },
  { text: 'Abgleichen', seite: 'Doppelte', weg: '/verschmelzung', bereich: '', eltern: 'Medien' },
  { text: 'Höchste Lautstärke', seite: 'Konfiguration', weg: '/konfiguration', bereich: '', zusatz: 'wirkt sofort' },
]

describe('normal', () => {
  it('macht Umlaute und Grossschreibung gleich', () => {
    expect(normal('Höchste Lautstärke')).toBe('hochste lautstarke')
    expect(normal('Größe')).toBe('grosse')
  })

  it('faltet NICHT ue zu u — sonst wird aus „Neues" ein „Nus"', () => {
    expect(normal('Neues Passwort')).toBe('neues passwort')
  })

  it('wirft die typografischen Anfuehrungszeichen weg', () => {
    // Im Bestand steht „endet um …" mit den deutschen Zeichen; auf der
    // Tastatur liegt aber nur das gerade ". Ohne diese Regel findet man den
    // Eintrag nur, wenn man die Zeichen selbst eintippt.
    expect(normal('„endet um"')).toBe('endet um')
  })
})

describe('rangFuer', () => {
  it('ordnet nach dem, wie ein Mensch sucht', () => {
    expect(rangFuer('doppelte', 'doppelte')).toBe(0)
    expect(rangFuer('doppelte zusammenfassen', 'doppelte')).toBe(1)
    expect(rangFuer('doppelte zusammenfassen', 'zusammen')).toBe(2)
    expect(rangFuer('mini-player', 'player')).toBe(2)
    expect(rangFuer('fortschrittsstreifen', 'streifen')).toBe(3)
  })
})

describe('treffer', () => {
  it('stellt den Knopf vor die Eintraege der gleichnamigen Seite', () => {
    // Der Fall, um den es geht: „Doppelte" ist zugleich ein Seitenname UND der
    // Anfang eines Schalters auf einer ganz anderen Seite. Der Schalter meint
    // die Frage, die Eintraege der Seite „Doppelte" nur ihre Nachbarschaft.
    const erste = treffer(PROBE, 'doppelte')[0]
    expect(erste.text).toBe('Doppelte zusammenfassen')
    expect(erste.seite).toBe('Darstellung')
  })

  it('nimmt Eintraege einer Seite mit, wenn der Seitenname passt', () => {
    const texte = treffer(PROBE, 'doppelte').map((e) => e.text)
    expect(texte).toContain('Abgleichen')
  })

  it('schraenkt mit jedem weiteren Wort ein', () => {
    expect(treffer(PROBE, 'doppelte hand').map((e) => e.text)).toEqual(['wieder zulassen'])
  })

  it('sucht auch im nicht angezeigten Zusatz', () => {
    expect(treffer(PROBE, 'sofort').map((e) => e.text)).toEqual(['Höchste Lautstärke'])
  })

  it('gibt bei leerer Frage nichts zurueck', () => {
    expect(treffer(PROBE, '   ')).toEqual([])
  })

  it('haelt sich an die Grenze', () => {
    expect(treffer(PROBE, 'e', 2).length).toBe(2)
  })
})

describe('am echten Bestand', () => {
  const frage = (f: string) => treffer(SUCH_BESTAND, f).map((e) => `${e.text} @ ${e.seite}`)

  it('findet den Schalter fuer doppelte Alben — auf der Medienseite', () => {
    // GENAU DAFUER ist die Suche da: der Schalter heisst „Doppelte
    // zusammenfassen" und liegt NICHT auf der Seite „Doppelte". Ohne Suche
    // findet ihn dort niemand.
    //
    // ER STAND BIS ZUM 03.08.2026 UNTER „Darstellung › Elemente" und steht
    // seither unter „Medien › Was aus den Quellen wird" (G5: er aendert die
    // ANZAHL der Werke, er faerbt sie nicht). Dieser Test hat den Umzug
    // gemeldet, bevor jemand hinsah — das ist sein Zweck, und deshalb wird er
    // nachgezogen statt gelockert. Ein `toContain` ohne Seitenangabe waere
    // beim naechsten Umzug still.
    expect(frage('doppelte')).toContain('Doppelte zusammenfassen @ Medien')
  })

  it('nennt die gleichnamige Seite zuerst — der Wortlaut stimmt genau', () => {
    // Das ist kein Widerspruch zum Test darueber: wer „Doppelte" tippt, meint
    // meistens die Seite, die genau so heisst. Der Schalter steht direkt
    // darunter, und beide nennen ihren Ort.
    expect(frage('doppelte')[0]).toBe('Doppelte @ Doppelte')
  })

  it('findet die Kinderzeit', () => {
    expect(frage('kinderzeit').length).toBeGreaterThan(0)
  })

  it('findet die Spielt-Marke, ohne dass man das Feld kennt', () => {
    // Das Feld heisst ruhigeMarke und ist negativ benannt. Wer danach sucht,
    // sucht nach dem, was auf dem Knopf steht.
    expect(frage('marke')).toContain('Spielt-Marke @ Darstellung')
  })

  it('findet die Diskografie auf beiden Seiten, auf denen sie steht', () => {
    // „Beide Seiten" heisst seit dem 03.08.2026 MEDIEN und Interpreten: der
    // Schalter ist von der Darstellung zu den Medien gewandert (er loest
    // Netzabrufe aus — was Daten holt, ist keine Darstellung), die
    // Freischaltung der Interpreten lag immer schon auf ihrer eigenen Seite.
    // Zwei Orte fuer EIN Wort ist genau der Fall, fuer den es die Suche gibt.
    const seiten = treffer(SUCH_BESTAND, 'diskografie').map((e) => e.seite)
    expect(seiten).toContain('Medien')
    expect(seiten).toContain('Interpreten')
    // Und NICHT mehr bei der Darstellung — sonst stuende der Knopf an zwei
    // Stellen und man stellte ihn dort, wo er nicht mehr wirkt.
    expect(seiten).not.toContain('Darstellung')
  })

  /**
   * DIE UNTERSEITEN, seit dem 03.08.2026.
   *
   * „Doppelte" und „Interpreten" stehen nicht mehr in der Kopfleiste; man
   * kommt ueber die Medienseite hin. Der Ort MUSS das sagen — sonst schickt
   * die Suche jemanden zu einem Seitennamen, den es in der Leiste gar nicht
   * gibt, und er sucht dort weiter, wo nichts ist.
   */
  it('nennt bei einer Unterseite den Weg dorthin', () => {
    const doppelte = SUCH_BESTAND.find((e) => e.weg === '/verschmelzung' && e.bereich === 'Seite')
    expect(doppelte).toBeDefined()
    expect(ortVon(doppelte as SuchEintrag)).toBe('Medien › Doppelte')

    const abgleichen = SUCH_BESTAND.find((e) => e.text === 'Abgleichen')
    expect(abgleichen).toBeDefined()
    expect((abgleichen as SuchEintrag).eltern).toBe('Medien')
  })

  it('bringt die Unterseiten mit, wenn man nach der Elternseite sucht', () => {
    // Wer „medien doppelte" tippt, hat die Gliederung verstanden und soll dort
    // landen. Ohne `eltern` im mitgesuchten Umkreis faende er nichts.
    expect(treffer(SUCH_BESTAND, 'medien doppelte').map((e) => e.weg)).toContain('/verschmelzung')
  })

  it('findet den Schlummer-Timer bei den Profilen', () => {
    // ER STAND BIS ZUM 03.08.2026 UNTER „System". Beides sind Zeitgrenzen fuer
    // ein Kind — an zwei Orten heisst: beim Suchen raet man.
    // Seit dem 15.08.2026 heisst die Seite „Profile" (vorher „Kinderzeit").
    expect(frage('schlummer')).toContain('Schlummer-Timer @ Profile')
    expect(treffer(SUCH_BESTAND, 'schlummer').map((e) => e.seite)).not.toContain('System')
  })

  it('findet die Seite WEITERHIN unter dem alten Wort „Kinderzeit"', () => {
    // Die Umbenennung darf niemanden aussperren, der das alte Wort kennt —
    // und das sind alle, die die Box laenger benutzen. Deshalb steht
    // „Kinderzeit" weiter auf der Seite und damit im Suchbestand.
    expect(treffer(SUCH_BESTAND, 'kinderzeit').map((e) => e.weg)).toContain('/kinderzeit')
  })

  it('nennt zu jedem Treffer einen Ort', () => {
    for (const e of treffer(SUCH_BESTAND, 'an', 50)) expect(ortVon(e).length).toBeGreaterThan(0)
  })

  it('sagt beim Seiteneintrag nur die Seite, nicht „Seite › Seite"', () => {
    const seite = SUCH_BESTAND.find((e) => e.bereich === 'Seite')
    expect(seite).toBeDefined()
    expect(ortVon(seite as SuchEintrag)).toBe((seite as SuchEintrag).seite)
  })
})
