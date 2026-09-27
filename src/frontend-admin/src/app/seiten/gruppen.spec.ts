/**
 * Zeugen fuer die Seite „Gruppen" (26.09.2026).
 *
 * Geprueft wird, was hier schiefgehen kann, ohne dass es auffaellt: dass das
 * Zusammenlegen den Kern mit Stufe hand ruft und dem Plugin ERST DANACH
 * Bescheid gibt, dass „Lösen" einen zweiten Klick braucht, und dass ein schon
 * zusammengelegtes Paar nicht als Vorschlag stehen bleibt.
 */
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { GruppenSeite, type Kennung, offeneVorschlaege, type Stand, type Vorschlag } from './gruppen'

const takt = () => new Promise((r) => setTimeout(r, 0))

const MAUS: Vorschlag = {
  paar: 'die maus ⟷ die maus, eva mit gitarre, der elefant',
  haupt: { name: 'Die Maus', dienste: ['ard', 'spotify'], anzahl: 12 },
  neben: { name: 'Die Maus, Eva mit Gitarre, Der Elefant', dienste: ['lokal'], anzahl: 3 },
  wahl: 'mitwirkung',
  sicherheit: 0.8,
  gemeinsam: ['maus'],
}

const STAND: Stand = {
  lauf: null,
  laeuft: false,
  schwelle: 0.7,
  vorschlaege: [MAUS],
  unsicher: 0,
  beantwortet: 1,
  angenommen: 0,
  abgelehnt: 0,
}

const GRUPPE: Kennung = {
  id: 'int_000000000001',
  namen: [
    { name: 'Die Maus', stufe: 'hand' },
    { name: 'Die Maus, Eva mit Gitarre, Der Elefant', stufe: 'hand' },
  ],
  verweise: [],
}

describe('offeneVorschlaege', () => {
  it('blendet ein Paar aus, dessen Namen schon unter EINER Kennung stehen', () => {
    expect(offeneVorschlaege([MAUS], [GRUPPE])).toEqual([])
  })

  it('laesst es stehen, solange die Namen getrennt sind', () => {
    const getrennt: Kennung[] = [
      { id: 'int_000000000001', namen: [{ name: 'Die Maus', stufe: 'hand' }], verweise: [] },
      {
        id: 'int_000000000002',
        namen: [{ name: 'Die Maus, Eva mit Gitarre, Der Elefant', stufe: 'hand' }],
        verweise: [],
      },
    ]
    expect(offeneVorschlaege([MAUS], getrennt).length).toBe(1)
    expect(offeneVorschlaege([MAUS], []).length).toBe(1)
  })

  it('vergleicht Namen ohne Ruecksicht auf Schreibweise von Apostroph und Gross/Klein', () => {
    const gabby: Vorschlag = {
      ...MAUS,
      haupt: { ...MAUS.haupt, name: "Gabby's Dollhouse" },
      neben: { ...MAUS.neben, name: 'Gabby’s Dollhouse Deutschland' },
    }
    const k: Kennung = {
      id: 'int_000000000003',
      namen: [
        { name: 'gabby’s dollhouse', stufe: 'hand' },
        { name: "Gabby's Dollhouse Deutschland", stufe: 'hand' },
      ],
      verweise: [],
    }
    expect(offeneVorschlaege([gabby], [k])).toEqual([])
  })
})

interface Innen {
  offen: () => Vorschlag[]
  gruppen: () => Kennung[]
  zusammenlegen: (v: Vorschlag) => Promise<void>
  loesen: (name: string) => Promise<void>
  bestaetigen: () => string
  meldung: () => string
  nichtBereit: () => boolean
}

describe('GruppenSeite', () => {
  let http: HttpTestingController
  let innen: Innen

  async function aufbauen(stand: Stand | null = STAND, kennungen: Kennung[] = []): Promise<void> {
    const fixture = TestBed.createComponent(GruppenSeite)
    innen = fixture.componentInstance as unknown as Innen
    const s = http.expectOne('/api/plugins/mixpi-gruppen/http/stand')
    if (stand) s.flush(stand)
    else s.flush({ fehler: 'aus' }, { status: 404, statusText: 'Not Found' })
    http.expectOne('/api/interpretenkennungen').flush({ kennungen, ohneKennung: [] })
    await takt()
    fixture.detectChanges()
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [GruppenSeite],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    })
    http = TestBed.inject(HttpTestingController)
  })

  it('sagt, wenn die Erweiterung nicht antwortet', async () => {
    await aufbauen(null)
    expect(innen.nichtBereit()).toBe(true)
  })

  it('legt mit Stufe hand zusammen und sagt dem Plugin ERST DANACH Bescheid', async () => {
    await aufbauen()
    expect(innen.offen().length).toBe(1)
    const lauf = innen.zusammenlegen(MAUS)

    const anlegen = http.expectOne('/api/interpretenkennungen')
    expect(anlegen.request.method).toBe('POST')
    expect(anlegen.request.body).toEqual({ name: 'Die Maus', stufe: 'hand' })
    // Das Plugin darf noch nichts gehoert haben.
    http.expectNone('/api/plugins/mixpi-gruppen/http/entscheiden')
    anlegen.flush({ id: 'int_000000000001', angelegt: true, grund: '' })
    await takt()

    const name = http.expectOne('/api/interpretenkennungen/name')
    expect(name.request.body).toEqual({
      id: 'int_000000000001',
      name: 'Die Maus, Eva mit Gitarre, Der Elefant',
      stufe: 'hand',
    })
    name.flush({ kennungen: [GRUPPE] })
    await takt()

    const entscheiden = http.expectOne('/api/plugins/mixpi-gruppen/http/entscheiden')
    expect(entscheiden.request.body).toEqual({ paar: MAUS.paar, urteil: 'angenommen' })
    entscheiden.flush({ ok: true })
    await takt()

    http.expectOne('/api/plugins/mixpi-gruppen/http/stand').flush({ ...STAND, vorschlaege: [], angenommen: 1 })
    http.expectOne('/api/interpretenkennungen').flush({ kennungen: [GRUPPE], ohneKennung: [] })
    await lauf
    expect(innen.gruppen().length).toBe(1)
  })

  it('meldet dem Plugin NICHTS, wenn der Kern das Zusammenlegen verweigert', async () => {
    await aufbauen()
    const lauf = innen.zusammenlegen(MAUS)
    http.expectOne('/api/interpretenkennungen').flush({ id: 'int_000000000001', angelegt: false, grund: '' })
    await takt()
    http
      .expectOne('/api/interpretenkennungen/name')
      .flush(
        { error: 'nichtZusammengelegt', hinweis: 'Kennung gibt es nicht' },
        { status: 409, statusText: 'Conflict' },
      )
    await takt()
    http.expectNone('/api/plugins/mixpi-gruppen/http/entscheiden')
    http.expectOne('/api/plugins/mixpi-gruppen/http/stand').flush(STAND)
    http.expectOne('/api/interpretenkennungen').flush({ kennungen: [], ohneKennung: [] })
    await lauf
    expect(innen.meldung()).toContain('Kennung gibt es nicht')
  })

  it('loest erst beim zweiten Klick', async () => {
    await aufbauen(STAND, [GRUPPE])
    await innen.loesen('Die Maus, Eva mit Gitarre, Der Elefant')
    http.expectNone('/api/interpretenkennungen/loesen')
    expect(innen.bestaetigen()).toBe('Die Maus, Eva mit Gitarre, Der Elefant')

    const lauf = innen.loesen('Die Maus, Eva mit Gitarre, Der Elefant')
    const r = http.expectOne('/api/interpretenkennungen/loesen')
    expect(r.request.body).toEqual({ name: 'Die Maus, Eva mit Gitarre, Der Elefant', stufe: 'hand' })
    r.flush({ kennungen: [] })
    await takt()
    http.expectOne('/api/interpretenkennungen').flush({ kennungen: [], ohneKennung: [] })
    await lauf
    expect(innen.gruppen().length).toBe(0)
  })
})
