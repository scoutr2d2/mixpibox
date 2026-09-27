/**
 * Die Regeln der Systemkurve — geprüft an den Fällen, in denen ein Fehler
 * STILL bliebe.
 *
 * Was hier NICHT geprüft wird: wo die Striche landen. Das steht in der
 * Komponente und wird an den Bildpunkten gemessen (tools/systemkurve-schau.mjs
 * für die Fassung der Box). Ein Test, der Koordinaten nachrechnet, prüft die
 * Rechnung gegen sich selbst.
 *
 * NICHT für Karma: reine Rechnerei, läuft über `npx tsx --test` (siehe
 * box_node_specs in tools/pruefen.sh — ein vitest-Import an dieser Stelle
 * riss den ganzen Browserlauf der Verwaltung mit „Found 1 load error" mit).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GRAD_BIS,
  type Punkt,
  type Verlauf,
  ablesePunkt,
  achse,
  duennSatz,
  heissSatz,
  jetztSatz,
  komma,
  lastWort,
  leseSatz,
  stuecke,
  zahl,
} from './systemverlauf'

const p = (t: number, c: number, m: number, g: number | null, l: number | null = 30): Punkt => ({ t, c, m, g, l })

describe('zahl', () => {
  it('macht aus null KEINE 0 — sonst wäre ein fehlender Sensor eine eiskalte Box', () => {
    assert.ok(Number.isNaN(zahl({ g: null }, 'g')))
    assert.ok(Number.isNaN(zahl({ g: '' }, 'g')))
    assert.equal(zahl({ g: 0 }, 'g'), 0)
  })
})

describe('stuecke', () => {
  const min = 60000

  it('schneidet an einer Zeitlücke — die Box war aus', () => {
    const reihe = [p(0, 5, 30, 45), p(min, 5, 30, 45), p(20 * min, 5, 30, 45)]
    assert.deepEqual(
      stuecke(reihe, 4 * min, 'c').map((s) => s.length),
      [2, 1],
    )
  })

  it('schneidet auch an einem FEHLENDEN Wert — und nur in DIESER Bahn', () => {
    // Der häufige Fall: der Wärmesensor antwortet eine Weile nicht.
    const reihe = [p(0, 5, 30, 45), p(min, 5, 30, null), p(2 * min, 5, 30, 46)]
    assert.deepEqual(
      stuecke(reihe, 4 * min, 'g').map((s) => s.length),
      [1, 1],
    )
    // Die CPU-Bahn merkt davon nichts.
    assert.deepEqual(
      stuecke(reihe, 4 * min, 'c').map((s) => s.length),
      [3],
    )
  })

  it('ohne Feld zählt allein die Zeit — die Box war nicht „für die CPU aus"', () => {
    const reihe = [p(0, 5, 30, null), p(min, 5, 30, null)]
    assert.deepEqual(
      stuecke(reihe, 4 * min, null).map((s) => s.length),
      [2],
    )
  })
})

describe('ablesePunkt', () => {
  const st = [[p(1000, 5, 30, 45), p(2000, 9, 31, 46)]]

  it('gibt ein PAAR zurück und nicht den Punkt', () => {
    // Der Test zu einem echten Fehler vom 08.08.2026: `const punkt = ablese…`
    // ergab ein wahres Wrapper-Objekt, `punkt.t` war undefiniert, und am
    // Schirm stand „NaN:NaN · —".
    const r = ablesePunkt(st, 1900)
    assert.equal(r.punkt?.t, 2000)
    assert.equal(r.luecke, false)
  })

  it('meldet eine Lücke, statt den nächsten Punkt zu erfinden', () => {
    assert.deepEqual(ablesePunkt(st, 9999), { punkt: null, luecke: true })
  })
})

describe('leseSatz', () => {
  it('nennt alle drei Zahlen und nimmt die Uhrzeit des PUNKTES', () => {
    const t = new Date(2026, 7, 8, 3, 5).getTime()
    const s = leseSatz(p(t, 12, 35, 52.34, 29), false, t + 40000, false, 4)
    assert.equal(s.kopf, '03:05 · CPU 12 %')
    assert.equal(s.unter, '52,3 °C · Speicher 35 % · Last 0,29 von 4')
  })

  it('sagt bei einer Lücke, dass nichts gemessen wurde', () => {
    const t = new Date(2026, 7, 8, 3, 5).getTime()
    assert.deepEqual(leseSatz(null, true, t, false, 4), {
      kopf: '03:05 · —',
      unter: 'Hier wurde nichts gemessen — die Box war aus.',
    })
  })

  it('behauptet VOR dem ersten Messwert KEIN Ausschalten', () => {
    // Der Fall vom Gerät (08.08.2026): die Reihe war 44 Minuten alt, die
    // Achse zeigte 24 Stunden — und für die Vornacht stand „die Box war
    // aus". Sie lief. Sie hat nur noch nichts mitgeschrieben.
    const t = new Date(2026, 7, 7, 23, 32).getTime()
    const spanne = { von: new Date(2026, 7, 8, 11, 29).getTime(), bis: new Date(2026, 7, 8, 12, 13).getTime() }
    assert.equal(leseSatz(null, true, t, false, 4, spanne).unter, 'So weit reicht die Aufzeichnung noch nicht zurück.')
  })

  it('unterscheidet das Loch DAZWISCHEN vom Ende der Reihe', () => {
    const spanne = { von: new Date(2026, 7, 8, 1, 0).getTime(), bis: new Date(2026, 7, 8, 12, 0).getTime() }
    const mitten = new Date(2026, 7, 8, 6, 0).getTime()
    const danach = new Date(2026, 7, 8, 15, 0).getTime()
    assert.equal(leseSatz(null, true, mitten, false, 4, spanne).unter, 'Hier wurde nichts gemessen — die Box war aus.')
    assert.equal(leseSatz(null, true, danach, false, 4, spanne).unter, 'Seitdem wurde nichts mehr aufgezeichnet.')
  })

  it('nennt einen fehlenden Sensor beim Namen statt 0 °C zu schreiben', () => {
    const t = new Date(2026, 7, 8, 3, 5).getTime()
    assert.ok(leseSatz(p(t, 12, 35, null), false, t, false, 4).unter.includes('kein Wärmesensor'))
  })

  it('setzt bei sieben Tagen den Wochentag davor', () => {
    const t = new Date(2026, 7, 8, 3, 5).getTime() // ein Samstag
    assert.equal(leseSatz(p(t, 12, 35, 50), false, t, true, 4).kopf, 'Sa 03:05 · CPU 12 %')
  })
})

describe('jetztSatz', () => {
  const v = (jetzt: Punkt | null): Verlauf => ({
    punkte: [],
    jetzt,
    stunden: 24,
    gesamt: 0,
    kerne: 4,
    speicherGesamt: 2107834368,
    messAbstandMs: 60000,
    lueckeMs: 240000,
  })

  it('nennt alle drei Zahlen und den Speicher zusätzlich in Megabyte', () => {
    const s = jetztSatz(v(p(1, 8, 35, 48.2, 26)))
    assert.equal(s.kopf, 'CPU 8 % · 48,2 °C · Speicher 35 %')
    assert.equal(s.unter, 'Last 0,26 von 4 · 704 von 2010 MB belegt')
  })

  it('sagt es, wenn noch gar nichts gemessen wurde', () => {
    assert.equal(jetztSatz(v(null)).unter, 'Es liegt noch kein Messwert vor.')
    assert.equal(jetztSatz(null).kopf, '—')
  })
})

describe('lastWort', () => {
  it('nennt die Kernzahl mit — ohne sie sagt „Last 3,8" nichts', () => {
    assert.equal(lastWort(p(0, 5, 30, 45, 380), 4), 'Last 3,80 von 4')
  })
  it('schweigt, wo es keinen Wert gibt', () => {
    assert.equal(lastWort(p(0, 5, 30, 45, null), 4), '')
  })
})

describe('heissSatz', () => {
  it('meldet eine GEKLEMMTE Kurve — sonst wären 81 und 110 Grad dasselbe Bild', () => {
    assert.ok(heissSatz([p(0, 5, 30, GRAD_BIS + 20)])?.includes('110,0 °C'))
  })
  it('schweigt, solange alles in die Bahn passt', () => {
    assert.equal(heissSatz([p(0, 5, 30, 60)]), null)
    assert.equal(heissSatz([p(0, 5, 30, null)]), null)
  })
})

describe('duennSatz', () => {
  it('nennt eine frisch gestartete Aufzeichnung beim Namen, nicht als Störung', () => {
    const s = duennSatz([p(0, 5, 30, 45)], [[p(0, 5, 30, 45)]])
    assert.ok(s?.includes('bisher einer'))
    assert.ok(s?.includes('nach einem Neustart fängt sie von vorn an'))
  })

  it('meldet auch eine zu KURZE Aufzeichnung, obwohl genug Punkte da sind', () => {
    const reihe = [p(0, 5, 30, 45), p(60000, 5, 30, 45), p(120000, 5, 30, 45), p(180000, 5, 30, 45)]
    assert.ok(duennSatz(reihe, [reihe])?.includes('3 min'))
  })

  it('schweigt, sobald es für eine Kurve reicht', () => {
    const reihe = Array.from({ length: 30 }, (_, i) => p(i * 60000, 5, 30, 45))
    assert.equal(duennSatz(reihe, [reihe]), null)
  })
})

describe('achse', () => {
  it('setzt vier bis sieben Marken — mehr überlappen sich', () => {
    const bis = new Date(2026, 7, 8, 12, 0).getTime()
    const m = achse(bis - 24 * 3600000, bis)
    assert.ok(m.length >= 4)
    assert.ok(m.length <= 7)
    assert.equal(
      m.every((x) => !x.tag),
      true,
    )
  })

  it('zählt über sieben Tage in TAGEN — sieben mal „00:00" wären sieben gleiche Worte', () => {
    const bis = new Date(2026, 7, 8, 12, 0).getTime()
    assert.equal(
      achse(bis - 168 * 3600000, bis).every((x) => x.tag),
      true,
    )
  })

  it('gibt bei einer verkehrten Spanne nichts heraus', () => {
    assert.deepEqual(achse(100, 100), [])
    assert.deepEqual(achse(Number.NaN, 100), [])
  })
})

describe('komma', () => {
  it('schreibt deutsch', () => {
    assert.equal(komma(52.34), '52,3')
    assert.equal(komma(3), '3,0')
  })
})
