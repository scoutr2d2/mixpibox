import { derGruppe, FARBFELDER, GRUPPEN, unbekannte, unbenutzte, verwendungen } from './thema-felder'

/**
 * HIER STEHT NUR, WAS IM BROWSER LAUFEN KANN.
 *
 * Die Specs von `frontend-admin` laufen ueber `ng test`, also in Karma und
 * damit IM BROWSER — dort gibt es kein `node:fs`. Der erste Anlauf las hier
 * die echte `NewDesign/app.css` ein und waere im Gesamtlauf verlaesslich
 * gescheitert.
 *
 * Die Frage „passt die Liste noch zu app.css?" ist damit nicht erledigt, sie
 * ist nur woanders zu Hause: `npx tsx tools/thema-werkstatt.mjs --pruefen`
 * liest die echte Datei und steht in `tools/pruefen.sh`. Ein ausgedachter
 * CSS-Ausschnitt kann diese Frage ohnehin nicht beantworten — er ist immer
 * einig mit sich selbst.
 */
describe('thema-felder', () => {
  it('nennt `--line` NICHT — die Linien haengen an `--line2`', () => {
    // GEMESSEN (05.08.2026, tools/farbwaehler-wirkung.mjs): `--line` steht
    // zweimal in app.css und wird null Mal mit var() gelesen. Ein Regler
    // darauf saehe richtig aus und faerbte nichts.
    const namen = FARBFELDER.map((f) => f.v)
    expect(namen).not.toContain('--line')
    expect(namen).toContain('--line2')
  })

  it('ordnet jedes Feld einer Gruppe zu, die es gibt', () => {
    const ids = GRUPPEN.map((g) => g.id)
    for (const f of FARBFELDER) expect(ids).toContain(f.gruppe)
  })

  it('laesst keine Gruppe leer — eine leere Ueberschrift waere ein Versprechen ohne Inhalt', () => {
    for (const g of GRUPPEN) expect(derGruppe(g.id).length).toBeGreaterThan(0)
  })

  it('nennt jede Variable nur einmal', () => {
    const namen = FARBFELDER.map((f) => f.v)
    expect(new Set(namen).size).toBe(namen.length)
  })

  it('gibt jedem Feld einen Namen und eine Begruendung', () => {
    // „wozu" ist keine Zierde: Es ist der einzige Text, an dem jemand erkennt,
    // was ein Regler faerbt, ohne ihn zu ziehen.
    for (const f of FARBFELDER) {
      expect(f.name.length).toBeGreaterThan(0)
      expect(f.wozu.length).toBeGreaterThan(0)
      expect(f.v.startsWith('--')).toBe(true)
    }
  })

  it('zaehlt `var(--x)` und `var(--x, rueckfall)` gleichermassen', () => {
    const css = `
      :root { --accent: #FF6B57; }
      .a { color: var(--accent); }
      .b { border-color: var(--accent, #000); }
      .c { background: var(--accentDark); }
    `
    const z = verwendungen(css, [
      { v: '--accent', name: 'A', wozu: 'x', gruppe: 'grund' },
      { v: '--accentDark', name: 'B', wozu: 'x', gruppe: 'fein' },
    ])
    expect(z['--accent']).toBe(2)
    expect(z['--accentDark']).toBe(1)
  })

  it('verwechselt `--accent` nicht mit `--accentDark`', () => {
    // Ohne die Grenze am Klammerende zaehlte `var(--accentDark)` als
    // Verwendung von `--accent` — und ein toter Regler saehe lebendig aus.
    const css = '.x { color: var(--accentDark); }'
    expect(verwendungen(css, [{ v: '--accent', name: 'A', wozu: 'x', gruppe: 'grund' }])['--accent']).toBe(0)
  })

  it('meldet eine angebotene Farbe, die app.css gar nicht kennt', () => {
    const erfunden = [{ v: '--gibtsnicht', name: 'X', wozu: 'x', gruppe: 'grund' as const }]
    expect(unbekannte({ '--bg': '#FFFFFF' }, erfunden)).toEqual(['--gibtsnicht'])
    expect(unbenutzte('.a { color: red; }', erfunden)).toEqual(['--gibtsnicht'])
  })
})
