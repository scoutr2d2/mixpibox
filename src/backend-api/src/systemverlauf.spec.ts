import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  abschnitte,
  anhaengen,
  aufwandAnhaengen,
  aufwandNeuschreiben,
  ausduennen,
  BLOCK_BYTES,
  BYTES_JE_PUNKT,
  bereinigen,
  cpuAnteil,
  istPunkt,
  LUECKE_MS,
  MAX_PUNKTE,
  MIN_ABSTAND_MS,
  type Punkt,
  punktBauen,
  spanne,
  HISTORIE_MS,
  MESS_MS,
  speicherAnteil,
  speicherLesen,
  statLesen,
} from './systemverlauf'

const T0 = 1_800_000_000_000
// EIN SCHRITT IST EIN MESSTAKT und keine feste Minute. Hier stand n * 60_000;
// als der Takt am 20.08.2026 auf 20 s fiel, pruefte diese Datei Punkte im
// DREIFACHEN Abstand — „ein ausgefallener Punkt ist keine Luecke" wurde zur
// Luecke, ohne dass sich am geprueften Code etwas geaendert hatte.
const min = (n: number) => T0 + n * MESS_MS
/** Wie viele Messpunkte auf eine Stunde gehen — haengt am Takt, nicht an 60. */
const PRO_STUNDE = Math.round(3_600_000 / MESS_MS)
/** Ein Punkt, kurz geschrieben: Minute, Last %, Speicher %. */
const p = (m: number, c: number, sp = 35): Punkt => ({ t: min(m), c, m: sp, g: 46.9, l: 53 })

/** Was am 08.08.2026 wirklich in /proc/stat der Box .169 stand. */
const STAT_BOX = `cpu  142776 45 43454 2669342 2262 0 831 0 0 0
cpu0 36660 11 11238 658225 496 0 569 0 0 0
cpu1 35578 30 10740 670266 566 0 91 0 0 0
intr 54122211 0 491686
`

/** Was am selben Tag in /proc/meminfo stand (gekuerzt). */
const MEM_BOX = `MemTotal:        2058432 kB
MemFree:          474992 kB
MemAvailable:    1345280 kB
Buffers:          101568 kB
Cached:           761072 kB
SwapTotal:       1029200 kB
`

describe('statLesen', () => {
  it('nimmt die Kopfzeile der Box und NICHT die einzelnen Kerne', () => {
    const s = statLesen(STAT_BOX)
    // 142776+45+43454+2669342+2262+0+831+0 — die letzten beiden Spalten
    // (guest, guest_nice) bleiben draussen, sie stecken schon in user/nice.
    assert.deepEqual(s, { gesamt: 2858710, untaetig: 2671604 })
  })

  it('zaehlt guest NICHT doppelt', () => {
    // Dieselbe Zeile, aber mit Gastzeit: sie steckt bereits in `user` und
    // darf die Summe nicht erhoehen — sonst kaeme eine zu NIEDRIGE
    // Auslastung heraus.
    const ohne = statLesen('cpu  100 0 0 100 0 0 0 0 0 0')
    const mit = statLesen('cpu  100 0 0 100 0 0 0 0 50 0')
    assert.deepEqual(ohne, mit)
  })

  it('iowait zaehlt als UNTAETIG, nicht als Last', () => {
    // Auf einer Box, die von einer SD-Karte lebt, ist Warten auf die Karte
    // der Normalfall. Als Last gezaehlt staende die Kurve beim Einlesen der
    // Medien bei 100 %.
    const s = statLesen('cpu  0 0 0 100 900 0 0 0')
    assert.equal(s?.untaetig, 1000)
    assert.equal(s?.gesamt, 1000)
  })

  it('ohne Kopfzeile, mit Unfug oder leer: nichts', () => {
    assert.equal(statLesen('cpu0 1 2 3 4'), null)
    assert.equal(statLesen('cpu  a b c d'), null)
    assert.equal(statLesen('cpu  0 0 0 0 0 0 0 0'), null)
    assert.equal(statLesen(''), null)
  })
})

describe('cpuAnteil', () => {
  it('rechnet den Anteil aus der Differenz zweier Staende', () => {
    // 1000 Jiffies vergangen, davon 750 untaetig -> 25 %.
    const a = { gesamt: 1000, untaetig: 800 }
    const b = { gesamt: 2000, untaetig: 1550 }
    assert.equal(cpuAnteil(a, b), 25)
  })

  it('ein EINZELNER Stand sagt nichts', () => {
    assert.equal(cpuAnteil(null, { gesamt: 1000, untaetig: 900 }), null)
    assert.equal(cpuAnteil({ gesamt: 1000, untaetig: 900 }, null), null)
  })

  it('rueckwaerts laufende Zaehler ergeben KEINE Zahl', () => {
    // Nach einem Neustart faengt /proc/stat wieder bei null an. Ohne diese
    // Zeile kaeme dort eine erfundene Auslastung heraus.
    const a = { gesamt: 2_000_000, untaetig: 1_900_000 }
    const b = { gesamt: 500, untaetig: 400 }
    assert.equal(cpuAnteil(a, b), null)
  })

  it('gleicher Stand (kein Fenster): nichts', () => {
    const a = { gesamt: 1000, untaetig: 900 }
    assert.equal(cpuAnteil(a, a), null)
  })
})

describe('speicherLesen / speicherAnteil', () => {
  it('nimmt MemAvailable und nicht MemFree — die Zahl der Box', () => {
    const s = speicherLesen(MEM_BOX)
    assert.deepEqual(s, { gesamtKb: 2058432, verfuegbarKb: 1345280 })
    // 35 % — dasselbe, was `free -m` in der Spalte `used` zeigt (699 von 2010).
    assert.equal(speicherAnteil(s), 35)
  })

  it('MemFree ergaebe 77 % und waere eine Kurve, die immer rot ist', () => {
    // Der Vergleich steht als AUSSAGE hier, damit niemand spaeter „das ist
    // doch dasselbe" denkt: es sind 42 Prozentpunkte Unterschied.
    const frei = speicherAnteil({ gesamtKb: 2058432, verfuegbarKb: 474992 })
    assert.equal(frei, 77)
    assert.equal(speicherAnteil(speicherLesen(MEM_BOX)), 35)
  })

  it('ohne MemAvailable (alter Kernel) faellt es auf frei+Puffer+Cache zurueck', () => {
    const s = speicherLesen('MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 150 kB\n')
    assert.deepEqual(s, { gesamtKb: 1000, verfuegbarKb: 300 })
  })

  it('mehr verfuegbar als vorhanden ist nicht moeglich', () => {
    const s = speicherLesen('MemTotal: 1000 kB\nMemAvailable: 5000 kB\n')
    assert.equal(s?.verfuegbarKb, 1000)
    assert.equal(speicherAnteil(s), 0)
  })

  it('ohne MemTotal: nichts', () => {
    assert.equal(speicherLesen('MemFree: 100 kB'), null)
    assert.equal(speicherLesen(''), null)
    assert.equal(speicherAnteil(null), null)
  })
})

describe('punktBauen', () => {
  it('baut den Punkt und rundet die Temperatur auf ein Zehntel', () => {
    const q = punktBauen({ t: T0, cpu: 13, speicher: 35, temperatur: 46.94, last: 0.53 })
    assert.deepEqual(q, { t: T0, c: 13, m: 35, g: 46.9, l: 53 })
  })

  it('lieber eine LUECKE als eine erfundene Null', () => {
    // Ohne Last oder ohne Speicher gibt es keinen Punkt — eine 0 saehe
    // spaeter aus wie eine schlafende Box.
    assert.equal(punktBauen({ t: T0, cpu: null, speicher: 35 }), null)
    assert.equal(punktBauen({ t: T0, cpu: 13, speicher: null }), null)
    assert.equal(punktBauen({ t: Number.NaN, cpu: 13, speicher: 35 }), null)
  })

  it('ohne Sensor bleibt die Temperatur null, der Punkt aber gueltig', () => {
    const q = punktBauen({ t: T0, cpu: 13, speicher: 35, temperatur: null })
    assert.deepEqual(q, { t: T0, c: 13, m: 35, g: null, l: null })
  })

  it('das Lastmittel steht in HUNDERTSTELN und kann ueber 100 gehen', () => {
    // Last 8.0 auf vier Kernen: die Warteschlange, die `c` (bei 100 %
    // gedeckelt) nicht mehr zeigen kann.
    assert.equal(punktBauen({ t: T0, cpu: 100, speicher: 50, last: 8 })?.l, 800)
  })
})

describe('istPunkt', () => {
  it('nimmt einen echten Punkt an und Unfug nicht', () => {
    assert.ok(istPunkt({ t: 1, c: 2, m: 3, g: 4, l: 5 }))
    assert.ok(istPunkt({ t: 1, c: 2, m: 3, g: null, l: null }))
    assert.equal(istPunkt({ t: 1, c: 2 }), false)
    assert.equal(istPunkt({ t: '1', c: 2, m: 3, g: null, l: null }), false)
    assert.equal(istPunkt([1, 2, 3]), false)
    assert.equal(istPunkt(null), false)
  })
})

describe('anhaengen', () => {
  it('haengt an', () => {
    assert.equal(anhaengen([], p(0, 10)).length, 1)
  })

  it('verwirft, was zu dicht am letzten liegt', () => {
    const r = anhaengen([p(0, 10)], { t: min(0) + 1000, c: 20, m: 35, g: 47, l: 60 })
    assert.equal(r.length, 1)
  })

  it('nimmt es nach dem Mindestabstand an', () => {
    const r = anhaengen([p(0, 10)], { t: min(0) + MIN_ABSTAND_MS, c: 20, m: 35, g: 47, l: 60 })
    assert.equal(r.length, 2)
  })

  it('haelt die Obergrenze und wirft die aeltesten weg', () => {
    let r = [p(0, 1), p(1, 2), p(2, 3)]
    r = anhaengen(r, p(3, 4), { maxPunkte: 3, minAbstandMs: 0 })
    assert.deepEqual(
      r.map((x) => x.c),
      [2, 3, 4],
    )
  })

  it('ZEITSPRUNG RUECKWAERTS: der Punkt landet nicht in der Reihe', () => {
    // Gemessen am 07.08.2026 auf der Box: Journal und Uhr lagen 43 Minuten
    // auseinander („Time jumped backwards, rotating"). Ein Pi hat keine
    // gepufferte Uhr.
    const r = anhaengen([p(43, 10)], p(0, 10))
    assert.equal(r.length, 1)
    assert.equal(r[0].t, min(43))
  })
})

describe('bereinigen', () => {
  it('wirft Punkte aus der ZUKUNFT weg und sortiert', () => {
    const roh = [p(5, 10), p(1, 20), { t: min(99999), c: 30, m: 35, g: 47, l: 0 }]
    const r = bereinigen(roh, min(10))
    assert.equal(r.length, 2)
    assert.ok(r[0].t < r[1].t)
  })

  it('eine Minute Nachsicht, damit die eigene Uhr nicht dazwischenfunkt', () => {
    assert.equal(bereinigen([{ t: min(1) + 30_000, c: 1, m: 1, g: null, l: null }], min(1)).length, 1)
  })
})

describe('spanne', () => {
  it('gibt nur die letzten Stunden', () => {
    // IN STUNDEN GERECHNET UND NICHT IN SCHRITTEN: Hier stand p(0)/p(60)/p(120)
    // in der Annahme „ein Schritt ist eine Minute".
    assert.equal(
      spanne([p(0, 1), p(PRO_STUNDE, 2), p(2 * PRO_STUNDE, 3)], 1, min(2 * PRO_STUNDE)).length,
      2,
    )
  })
})

describe('abschnitte', () => {
  it('eine dichte Reihe bleibt EIN Abschnitt', () => {
    const a = abschnitte([p(0, 1), p(1, 2), p(2, 3), p(3, 4)])
    assert.equal(a.length, 1)
    assert.deepEqual([a[0].von, a[0].bis, a[0].punkte], [min(0), min(3), 4])
  })

  it('DIE NACHT ZERSCHNEIDET DIE LINIE', () => {
    // Box um 21:40 aus, um 07:10 wieder an. Eine Linie darueber hinweg
    // behauptete „die Box war die ganze Nacht 47 °C warm".
    const a = abschnitte([p(0, 1), p(1, 2), p(570, 3), p(571, 4)])
    assert.equal(a.length, 2)
    assert.equal(a[0].bis, min(1))
    assert.equal(a[1].von, min(570))
  })

  it('ein einzelner ausgefallener Messpunkt ist KEINE Luecke', () => {
    // Der Server war eine Minute beschaeftigt. Wer das zerschneidet, zerlegt
    // die Kurve in Schnipsel.
    assert.equal(abschnitte([p(0, 1), p(2, 2), p(3, 3)]).length, 1)
    // Vier Takte sind noch dabei, fuenf nicht mehr.
    assert.equal(abschnitte([p(0, 1), p(4, 2)]).length, 1)
    assert.equal(abschnitte([p(0, 1), p(5, 2)]).length, 2)
    // VIER TAKTE, nicht 240_000 — die Zahl folgt aus dem Messtakt.
    assert.equal(LUECKE_MS, 4 * MESS_MS)
  })

  it('ein einzelner Punkt bleibt stehen, eine leere Reihe ergibt nichts', () => {
    assert.equal(abschnitte([p(0, 1)]).length, 1)
    assert.deepEqual(abschnitte([]), [])
  })
})

describe('ausduennen', () => {
  it('rafft auf die gewuenschte Zahl', () => {
    const reihe = Array.from({ length: MAX_PUNKTE }, (_, i) => p(i, i % 100))
    assert.equal(ausduennen(reihe, 600).length, 600)
  })

  it('behaelt IMMER den letzten Punkt — er ist der aktuelle Stand', () => {
    const reihe = Array.from({ length: 1000 }, (_, i) => p(i, i % 100))
    const d = ausduennen(reihe, 7)
    assert.equal(d[d.length - 1].t, reihe[reihe.length - 1].t)
  })

  it('kurze Reihen bleiben unangetastet', () => {
    const reihe = [p(0, 1), p(1, 2)]
    assert.deepEqual(ausduennen(reihe, 100), reihe)
  })
})

describe('die Rechnung fuer die SD-Karte', () => {
  it('anhaengen ist um ein Vielfaches billiger als die ganze Datei neu', () => {
    const an = aufwandAnhaengen()
    const neu = aufwandNeuschreiben()
    // Die Aussage, wegen der diese Reihe anhaengt statt neu zu schreiben.
    assert.ok(neu.karteJeJahr / an.karteJeJahr > 20, `nur Faktor ${(neu.karteJeJahr / an.karteJeJahr).toFixed(1)}`)
    // Und in absoluten Zahlen: unter einem Gigabyte im Jahr gegen ueber
    // zwanzig. Faellt das je auseinander, ist die Entscheidung neu zu treffen.
    assert.ok(an.karteJeJahr < 1_000_000_000, `${an.karteJeJahr} Bytes/Jahr`)
    assert.ok(neu.karteJeJahr > 20_000_000_000, `${neu.karteJeJahr} Bytes/Jahr`)
  })

  it('die Nutzdaten sind bei beiden gleich — es geht allein um das Verfahren', () => {
    assert.equal(aufwandAnhaengen().datenJeStunde, aufwandNeuschreiben().datenJeStunde)
    // PUNKTE JE STUNDE AUS DEM TAKT, nicht die feste 60: die galt im
    // Minutentakt. Mit 20 s sind es 180 — und der Test soll pruefen, dass
    // beide VERFAHREN dieselben Nutzdaten erzeugen, nicht wie schnell
    // gemessen wird.
    assert.equal(aufwandAnhaengen().datenJeStunde, (3_600_000 / MESS_MS) * BYTES_JE_PUNKT)
    assert.equal(BYTES_JE_PUNKT, 56)
  })

  it('haeufiger schreiben kostet mehr, obwohl dieselben Daten entstehen', () => {
    // Jeden Punkt einzeln anzuhaengen kostet je Punkt einen angebrochenen
    // Block plus Journal — das ist der Grund fuer den Puffer.
    const jeder = aufwandAnhaengen({ punkteJeSchreiben: 1 })
    const zehn = aufwandAnhaengen({ punkteJeSchreiben: 10 })
    assert.ok(jeder.karteJeStunde > zehn.karteJeStunde * 5)
  })

  it('die Akkukurve traegt dasselbe Verfahren wie die teure Variante', () => {
    // NUR ALS AUSSAGE, nicht als Reparatur: akkuverlauf.json wird alle zehn
    // Minuten VOLLSTAENDIG neu geschrieben (server.ts, AKKU_SCHREIB_JE=10),
    // bei 10 080 Punkten zu rund 40 Bytes. Das gehoert gesagt, gehoert aber
    // einem anderen Lauf.
    const akku = aufwandNeuschreiben({ bytesJePunkt: 40, ringPunkte: MAX_PUNKTE, punkteJeSchreiben: 10 })
    assert.ok(akku.karteJeJahr > 15_000_000_000, `${akku.karteJeJahr} Bytes/Jahr`)
  })

  it('die Datei bleibt in einer Groesse, die ein Server beim Start liest', () => {
    const an = aufwandAnhaengen()
    assert.ok(an.dateiGroesse < 1_000_000, `${an.dateiGroesse} Bytes`)
    // DIE ABSICHT IST EIN ZEITRAUM, NICHT EINE PUNKTZAHL: wer den Takt
    // aendert, saehe sonst einen roten Test statt dessen, was zu pruefen ist.
    assert.equal(MAX_PUNKTE * MESS_MS, HISTORIE_MS)
    assert.equal(BLOCK_BYTES, 4096)
  })
})
