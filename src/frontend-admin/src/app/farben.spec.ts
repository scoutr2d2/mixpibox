import { kontrast, schwaechsterKontrast, wurzelFarben } from './farben'

/** Ein Ausschnitt aus NewDesign/app.css — mit Kommentar UND Grösse darin. */
const APP_CSS = `
:root {
  --bg: #FFF7EC;
  --surface: #FFFFFF;
  --ink: #2E2A3B;
  /* Ein Kommentar mit einer Klammer } darin — er darf den Block nicht beenden.
     --nicht-mitzaehlen: #000000; */
  --line2: #EFE7DA;
  --accent: #FF6B57;
  --tipp-neutral: rgba(46, 42, 59, 0.62);
  --umriss-luft: 7px;
  --griff: 66px;
}

:root[data-licht='dunkel'] {
  --bg: #1A1726;
}
`

describe('wurzelFarben', () => {
  it('liest die Farben aus :root', () => {
    const f = wurzelFarben(APP_CSS)
    expect(f['--bg']).toBe('#FFF7EC')
    expect(f['--ink']).toBe('#2E2A3B')
    expect(f['--line2']).toBe('#EFE7DA')
  })

  it('lässt Grössen draussen — ein Farbfeld kann 7px nicht anzeigen', () => {
    const f = wurzelFarben(APP_CSS)
    expect(f['--umriss-luft']).toBeUndefined()
    expect(f['--griff']).toBeUndefined()
  })

  it('lässt rgba() draussen — <input type="color"> kennt nur #RRGGBB', () => {
    expect(wurzelFarben(APP_CSS)['--tipp-neutral']).toBeUndefined()
  })

  it('liest nichts aus Kommentaren', () => {
    expect(wurzelFarben(APP_CSS)['--nicht-mitzaehlen']).toBeUndefined()
  })

  it('nimmt NUR den hellen Block, nicht den dunklen', () => {
    // Der dunkle Stand behält seine eigenen Farben; würde er hier
    // mitgelesen, zeigte der Wähler abends andere Werte an als morgens.
    expect(wurzelFarben(APP_CSS)['--bg']).toBe('#FFF7EC')
  })

  it('gibt bei einem Blatt ohne :root nichts zurück', () => {
    // Der Fall, der wirklich vorkommt: der Server liefert auf JEDEN Pfad 200
    // und schickt die index.html. Ein leeres Ergebnis schaltet den Wähler ab —
    // besser als fünf Felder auf Schwarz.
    expect(wurzelFarben('<!DOCTYPE html><html><body>nix</body></html>')).toEqual({})
    expect(wurzelFarben('')).toEqual({})
  })

  it('gibt bei einem abgeschnittenen Blatt nichts zurück', () => {
    expect(wurzelFarben(':root {\n  --bg: #FFF7EC;')).toEqual({})
  })
})

describe('kontrast', () => {
  it('rechnet die ausgelieferte Paarung nach', () => {
    // Gemessen mit tools/kontrast.mjs und tools/farbwaehler-wirkung.mjs: 13,09.
    expect(kontrast('#2E2A3B', '#FFF7EC')).toBeCloseTo(13.09, 1)
  })

  it('ist symmetrisch — Vorder- und Hintergrund vertauscht ändert nichts', () => {
    expect(kontrast('#FFF7EC', '#2E2A3B')).toBeCloseTo(kontrast('#2E2A3B', '#FFF7EC'), 6)
  })

  it('kennt die Grenzen: Schwarz auf Weiss ist 21, gleich auf gleich ist 1', () => {
    expect(kontrast('#000000', '#FFFFFF')).toBeCloseTo(21, 6)
    expect(kontrast('#808080', '#808080')).toBeCloseTo(1, 6)
  })

  it('meldet 0 statt eines guten Wertes, wenn eine Farbe fehlt', () => {
    expect(kontrast('', '#FFFFFF')).toBe(0)
    expect(kontrast('#FFF', '#FFFFFF')).toBe(0)
  })
})

describe('schwaechsterKontrast', () => {
  /** Der Auslieferungsstand: beides reichlich. */
  const AUSGELIEFERT = { '--ink': '#2E2A3B', '--bg': '#FFF7EC', '--surface': '#FFFFFF' }

  it('meldet für die Auslieferung den Grund — er ist die knappere der beiden Flächen', () => {
    const s = schwaechsterKontrast(AUSGELIEFERT)
    expect(s.wert).toBeCloseTo(13.09, 1)
    expect(s.wo).toBe('auf dem Grund')
  })

  it('DER FALL, DER DIE ERSTE FASSUNG BLAMIERT HAT: nur --surface verstellt', () => {
    // Am Gerät gemessen (tools/farbwaehler-gegenlesen.mjs, 6b): mit
    // `--surface` gleich `--ink` steht `.tor-taste` auf Fläche
    // rgb(46,42,59) mit Ziffer rgb(46,42,59) — die PIN-Eingabe ist weg.
    // Die alte Anzeige meldete unbeirrt 13,09 : 1 („reichlich").
    const s = schwaechsterKontrast({ ...AUSGELIEFERT, '--surface': '#2E2A3B' })
    expect(s.wert).toBeCloseTo(1, 6)
    expect(s.wo).toContain('Flächen')
  })

  it('nimmt das schlechteste Paar, nicht den Durchschnitt', () => {
    const s = schwaechsterKontrast({ '--ink': '#000000', '--bg': '#FFFFFF', '--surface': '#111111' })
    expect(s.wert).toBeLessThan(2)
  })

  it('überspringt ein Paar mit fehlender Farbe, statt es als 0 zu melden', () => {
    const s = schwaechsterKontrast({ '--ink': '#2E2A3B', '--bg': '#FFF7EC' })
    expect(s.wert).toBeCloseTo(13.09, 1)
    expect(s.wo).toBe('auf dem Grund')
  })

  it('meldet 0, wenn gar nichts messbar ist — nicht 21', () => {
    expect(schwaechsterKontrast({}).wert).toBe(0)
    expect(schwaechsterKontrast({}).wo).toBe('')
  })
})
