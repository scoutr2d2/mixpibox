import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RUHE_SCHWELLE, type Punkt } from './akkuverlauf'
import {
  entladungen,
  kapazitaet,
  kapazitaetEinzeln,
  LADE_SCHWELLE_MA,
  ladungMah,
  lernen,
  median,
  widerstand,
} from './akkulernen'

const T0 = 1_800_000_000_000
const min = (n: number) => T0 + n * 60_000
const pt = (m: number, v: number, i: number, p: number): Punkt => ({ t: min(m), v, i, p })

/**
 * Eine kuenstliche Entladung mit BEKANNTEN Eigenschaften, damit die Tests
 * pruefen koennen, ob das Gelernte stimmt.
 *
 * WICHTIG - und beim ersten Anlauf falsch gemacht: der Ladestand muss aus der
 * tatsaechlich geflossenen Ladung folgen. Wer Lastwechsel einstreut, ohne den
 * Ladestand entsprechend LANGSAMER fallen zu lassen, baut Daten, in denen
 * weniger Strom mehr Ladung verbraucht - und dann misst der Code korrekt eine
 * zu kleine Kapazitaet, waehrend der Test ihm Unrecht gibt.
 *
 * `strom(k)` liefert den Verbrauch je Minute; daraus wird beides abgeleitet.
 */
function entladung(opts: {
  mAh: number
  rMilliOhm: number
  strom: (k: number) => number
  vonP: number
  bisP: number
}): Punkt[] {
  const { mAh, rMilliOhm, strom, vonP, bisP } = opts
  const raus: Punkt[] = []
  let geflossen = 0
  for (let k = 0; k < 100_000; k++) {
    const p = vonP - (geflossen / mAh) * 100
    if (p < bisP) break
    const ruhe = 6000 + (p / 100) * 2000
    const i = strom(k)
    raus.push({
      t: min(k),
      v: Math.round(ruhe - (i * rMilliOhm) / 1000),
      i: -i,
      p: Math.round(p),
    })
    geflossen += i / 60 // eine Minute
  }
  return raus
}

describe('median', () => {
  it('bei ungerader Anzahl die Mitte', () => {
    assert.equal(median([5, 1, 3]), 3)
  })

  it('bei gerader Anzahl das Mittel der beiden mittleren', () => {
    assert.equal(median([1, 2, 3, 4]), 2.5)
  })

  it('ein Ausreisser zieht ihn NICHT mit', () => {
    // Genau dafuer ist er da: ein Messwert mitten im Lastwechsel darf das
    // Ergebnis nicht verschieben.
    assert.equal(median([68, 70, 72, 9000]), 71)
  })

  it('leer ist nichts', () => {
    assert.equal(median([]), null)
  })
})

describe('widerstand', () => {
  it('misst den Innenwiderstand aus einem Lastwechsel', () => {
    // 70 mOhm: bei 700 mA Sprung sind das 49 mV Unterschied.
    const reihe = [pt(0, 7400, -800, 60), pt(1, 7449, -100, 60), pt(2, 7400, -800, 60)]
    const r = widerstand(reihe)
    assert.equal(r.mOhm, 70)
    assert.equal(r.paare, 2)
  })

  it('ignoriert zu kleine Stromaenderungen', () => {
    // Sonst misst man Rauschen statt Widerstand.
    const reihe = [pt(0, 7400, -620, 60), pt(1, 7401, -630, 60)]
    assert.equal(widerstand(reihe).mOhm, null)
  })

  it('ignoriert Punkte, die weit auseinanderliegen', () => {
    // Dazwischen hat sich der Ladestand selbst geaendert - die Spannung waere
    // auch ohne Lastwechsel gefallen.
    const reihe = [pt(0, 7400, -800, 60), pt(30, 7449, -100, 58)]
    assert.equal(widerstand(reihe).mOhm, null)
  })

  it('verwirft unsinnige Ergebnisse', () => {
    // 5000 mOhm ist kein Akku, sondern ein Messfehler.
    const reihe = [pt(0, 7400, -800, 60), pt(1, 7000, -700, 60)]
    assert.equal(widerstand(reihe).mOhm, null)
  })

  it('bei gleichbleibender Last laesst sich NICHTS lernen', () => {
    // Genau der Zustand am Geraet nach sieben Minuten: konstanter Verbrauch.
    const reihe = Array.from({ length: 10 }, (_, k) => pt(k, 7400 - k, -630, 59))
    const r = widerstand(reihe)
    assert.equal(r.mOhm, null)
    assert.equal(r.paare, 0)
  })
})

describe('ladungMah', () => {
  it('zaehlt die bewegte Ladung', () => {
    // 600 mA ueber 60 Minuten sind 600 mAh.
    const reihe = Array.from({ length: 61 }, (_, k) => pt(k, 7400, -600, 60))
    assert.equal(Math.round(ladungMah(reihe)), 600)
  })

  it('ueberspringt LUECKEN statt sie hochzurechnen', () => {
    // War die Box aus, weiss niemand, was floss. Eine Stunde mit dem letzten
    // bekannten Strom zu fuellen waere frei erfunden.
    const reihe = [pt(0, 7400, -600, 60), pt(1, 7400, -600, 60), pt(600, 7000, -600, 30)]
    assert.equal(Math.round(ladungMah(reihe)), 10)
  })

  it('mittelt ueber das Stueck statt den letzten Wert zu halten', () => {
    // 0 und 600 mA ueber eine Minute -> 300 mA im Mittel -> 5 mAh.
    const reihe = [pt(0, 7400, 0, 60), pt(1, 7400, -600, 60)]
    assert.equal(Math.round(ladungMah(reihe)), 5)
  })
})

describe('LADE_SCHWELLE_MA', () => {
  it('ist dieselbe Zahl wie RUHE_SCHWELLE drueben', () => {
    // Die Abschrift ist Absicht (die Begruendung steht an der Konstanten);
    // DIESE Zeile ist ihr Preis. Wer drueben etwas aendert, sieht hier rot.
    assert.equal(LADE_SCHWELLE_MA, RUHE_SCHWELLE)
  })
})

describe('entladungen', () => {
  it('findet die Entladung und laesst die Ladung liegen', () => {
    const reihe = [
      pt(0, 7400, -600, 80),
      pt(1, 7300, -600, 70),
      pt(2, 7200, -600, 60),
      pt(3, 7900, 1500, 65),
      pt(4, 7950, 1500, 70),
    ]
    assert.deepEqual(entladungen(reihe), [{ von: 0, bis: 2 }])
  })

  it('ein Ruecksprung im Ladestand beendet sie NICHT', () => {
    // Der Stand kommt aus der Spannung, und die erholt sich, sobald die Last
    // nachlaesst - an den echten Daten bis zu vier Punkte. Wer daran
    // abbricht, zerlegt eine Entladung von sieben Stunden in acht Stuecke.
    const reihe = [pt(0, 7400, -900, 80), pt(1, 7300, -900, 70), pt(2, 7360, -100, 74), pt(3, 7200, -900, 60)]
    assert.deepEqual(entladungen(reihe), [{ von: 0, bis: 3 }])
  })

  it('eine LUECKE beendet sie ebenfalls nicht - sie wird spaeter begrenzt', () => {
    // Gemessen: an den Luecken zu schneiden kostet mehr, als es bringt (der
    // flache Kopf bei 100 % geht dabei verloren). Der Schaden wird in
    // `kapazitaetEinzeln` ueber den Anteil gedeckelt.
    const reihe = [pt(0, 7400, -600, 80), pt(1, 7300, -600, 70), pt(120, 7000, -600, 40)]
    assert.deepEqual(entladungen(reihe), [{ von: 0, bis: 2 }])
  })

  it('Ruhe beendet sie nicht - das Kind macht Pause', () => {
    const reihe = [pt(0, 7400, -600, 80), pt(1, 7400, -8, 79), pt(2, 7300, -600, 70)]
    assert.deepEqual(entladungen(reihe), [{ von: 0, bis: 2 }])
  })

  it('ein einzelner Punkt ist kein Abschnitt', () => {
    const reihe = [pt(0, 7900, 1500, 60), pt(1, 7400, -600, 80), pt(2, 7900, 1500, 60)]
    assert.deepEqual(entladungen(reihe), [])
  })

  it('ein Zeitsprung rueckwaerts trennt', () => {
    // Nach dem Stellen der Uhr per Netz ist die Reihe keine Reihe mehr.
    const reihe = [pt(10, 7400, -600, 80), pt(11, 7300, -600, 70), pt(0, 7200, -600, 60), pt(1, 7100, -600, 50)]
    assert.deepEqual(entladungen(reihe), [
      { von: 0, bis: 1 },
      { von: 2, bis: 3 },
    ])
  })
})

describe('kapazitaet', () => {
  it('misst die Kapazitaet eines kuenstlichen 10-Ah-Packs wieder', () => {
    // Der eigentliche Beweis: aus Strom und Zeit faellt die Kapazitaet
    // zurueck, die in die Daten hineingesteckt wurde.
    const reihe = entladung({ mAh: 10000, rMilliOhm: 70, strom: () => 800, vonP: 90, bisP: 40 })
    const k = kapazitaet(reihe, 10000)
    assert.ok(k.mAh !== null)
    assert.ok(Math.abs(k.mAh! - 10000) < 300, `gemessen ${k.mAh}`)
    assert.equal(k.hub, 50)
  })

  it('erkennt einen GEALTERTEN Pack', () => {
    // Nur noch 6000 mAh - genau das soll die Messung sehen, statt dem
    // Aufkleber zu glauben.
    const reihe = entladung({ mAh: 6000, rMilliOhm: 70, strom: () => 800, vonP: 90, bisP: 40 })
    const k = kapazitaet(reihe, 10000)
    assert.ok(k.mAh !== null && Math.abs(k.mAh - 6000) < 300, `gemessen ${k.mAh}`)
  })

  it('zu kleiner Hub ergibt keine Aussage', () => {
    const reihe = entladung({ mAh: 10000, rMilliOhm: 70, strom: () => 800, vonP: 60, bisP: 55 })
    assert.equal(kapazitaet(reihe, 10000).mAh, null)
  })

  it('zu kurze Dauer ergibt keine Aussage', () => {
    // Grosser Hub in fuenf Minuten kann nicht stimmen.
    const reihe = [pt(0, 7900, -600, 90), pt(2, 7500, -600, 60), pt(5, 7100, -600, 40)]
    assert.equal(kapazitaet(reihe, 10000).mAh, null)
  })

  it('ein voellig unplausibles Ergebnis wird verworfen', () => {
    // 100 mA ueber einen 50-Prozent-Hub waere ein 1000-mAh-Pack - gegen einen
    // 10-Ah-Aufkleber eher ein Messfehler als ein kaputter Akku.
    const reihe = entladung({ mAh: 1000, rMilliOhm: 70, strom: () => 100, vonP: 90, bisP: 40 })
    assert.equal(kapazitaet(reihe, 10000).mAh, null)
  })

  it('NUR NOCH AUS ENTLADUNGEN - eine Ladung wird nicht mehr gewaehlt', () => {
    // ══ DAS IST DER FEHLER VOM 08.08.2026 ═════════════════════════════════
    // Der Betreiber sah 4859 mAh unter einem neuen 10-Ah-Pack. Die Rechnung
    // war richtig; gewaehlt worden war ein LADEABSCHNITT. Beim Laden drueckt
    // der Ladestrom die Klemmenspannung ueber die Ruhespannung, der aus ihr
    // geschaetzte Stand eilt der wirklichen Ladung voraus, der Hub faellt zu
    // gross aus - und damit die Kapazitaet zu klein.
    //
    // Hier steht beides in EINER Reihe: eine Entladung von 8400 mAh und eine
    // schnelle Ladung, deren Prozente 70 % zu schnell steigen. Die Ladung hat
    // den GROESSEREN Hub (47 gegen 37) - die alte Auswahl haette sie genommen.
    const entladen = entladung({ mAh: 8400, rMilliOhm: 70, strom: () => 700, vonP: 92, bisP: 55 })
    const laden: Punkt[] = []
    {
      let geflossen = 0
      const ab = entladen.length + 10
      for (let k = 0; k < 100_000; k++) {
        const p = 26 + (geflossen / 8400) * 100 * 1.7
        if (p > 73) break
        laden.push({ t: min(ab + k), v: Math.round(6200 + (p / 100) * 2000), i: 1700, p: Math.round(p) })
        geflossen += 1700 / 60
      }
    }
    const alles = [...entladen, ...laden]

    // Die Ladung wird gar nicht erst als Abschnitt angeboten.
    assert.equal(entladungen(alles).length, 1)
    const k = kapazitaet(alles, 10000)
    assert.ok(k.mAh !== null && Math.abs(k.mAh - 8400) < 400, `gemessen ${k.mAh}`)

    // Und der Gegenbeweis: dieselbe Rechnung ueber die Ladung (mit gedrehtem
    // Strom und Stand, damit sie ueberhaupt angenommen wird) ergaebe die
    // Haelfte - genau die Zahl, ueber die sich der Betreiber gewundert hat.
    const gedreht = laden.map((p) => ({ ...p, i: -p.i, p: 100 - p.p }))
    const falsch = kapazitaetEinzeln(gedreht, null)
    assert.ok(falsch.mAh !== null && falsch.mAh < 6000, `als Ladung gerechnet ${falsch.mAh}`)
  })

  it('eine reine Ladung ergibt GAR NICHTS', () => {
    const laden = Array.from({ length: 200 }, (_, k) => pt(k, 7000 + k * 5, 1700, 30 + Math.round(k * 0.25)))
    assert.equal(entladungen(laden).length, 0)
    assert.equal(kapazitaet(laden, 10000).mAh, null)
  })

  it('unter der HAELFTE des Aufdrucks wird verworfen, 60 % nicht', () => {
    // Die alte Schwelle lag bei 20 % - 4859 gegen 10000 kam glatt durch. Ein
    // drei Jahre alter 10-Ah-Pack mit echten 6 Ah muss aber stehenbleiben:
    // das ist Alterung und kein Messfehler.
    const alt = entladung({ mAh: 6000, rMilliOhm: 70, strom: () => 800, vonP: 90, bisP: 40 })
    assert.ok(kapazitaet(alt, 10000).mAh !== null)
    const unsinn = entladung({ mAh: 4500, rMilliOhm: 70, strom: () => 800, vonP: 90, bisP: 40 })
    assert.equal(kapazitaet(unsinn, 10000).mAh, null)
    // Ohne Aufkleber gibt es nichts zu vergleichen - dann steht sie da.
    assert.ok(kapazitaet(unsinn, null).mAh !== null)
  })

  it('eine Luecke, die den halben Hub frisst, wird verworfen', () => {
    // `ladungMah` ueberspringt die Zeit ohne Messwerte, der Prozentunterschied
    // zaehlt voll. Ueber einem Viertel ist zu viel von der Antwort geraten.
    const a = entladung({ mAh: 8400, rMilliOhm: 70, strom: () => 700, vonP: 95, bisP: 85 })
    const b = entladung({ mAh: 8400, rMilliOhm: 70, strom: () => 700, vonP: 55, bisP: 45 }).map((p) => ({
      ...p,
      t: p.t + (a.length + 600) * 60_000,
    }))
    const k = kapazitaetEinzeln([...a, ...b], null)
    assert.equal(k.mAh, null)
    assert.ok(k.luecke > 0.5, `Anteil ${k.luecke}`)
  })

  it('mehrere Entladungen: der MEDIAN, nicht die letzte', () => {
    // Die dritte ist der Ausreisser. Der Mittelwert zoege mit, der Median
    // nicht - und die letzte allein waere schlicht der Ausreisser.
    const mach = (mAh: number, ab: number) =>
      entladung({ mAh, rMilliOhm: 70, strom: () => 700, vonP: 95, bisP: 50 }).map((p) => ({
        ...p,
        t: p.t + ab * 60_000,
      }))
    // Zwischen zwei Entladungen liegt eine Ladung - sonst waere es keine
    // zweite, sondern dieselbe.
    const trenner = (ab: number): Punkt[] => [
      { t: min(ab), v: 7900, i: 1700, p: 50 },
      { t: min(ab + 60), v: 8300, i: 1700, p: 95 },
    ]
    const alles = [
      ...mach(8400, 0),
      ...trenner(4000),
      ...mach(8300, 5000),
      ...trenner(9000),
      ...mach(6800, 10_000),
    ]
    assert.equal(entladungen(alles).length, 3)
    const k = kapazitaet(alles, 10000)
    assert.equal(k.entladungen, 3)
    assert.ok(k.mAh !== null && Math.abs(k.mAh - 8300) < 400, `Median ${k.mAh}`)
  })
})

describe('lernen', () => {
  it('nach sieben Minuten gleichbleibender Last: NICHTS', () => {
    // Der reale Zustand direkt nach dem Einbau. Lieber ehrlich nichts sagen.
    const reihe = Array.from({ length: 8 }, (_, k) => pt(k, 7393 - k * 10, -630, 59))
    const g = lernen(reihe, 10000)
    assert.equal(g.stand, 'nichts')
    assert.equal(g.rMilliOhm, null)
    assert.equal(g.kapazitaetMah, null)
  })

  it('mit Lastwechseln UND einem Hub: brauchbar', () => {
    // Alle zehn Minuten eine Pause - so sieht ein echter Tag aus, und die
    // Pausen gehen in den Ladestand ein (sonst waeren die Daten unmoeglich).
    const reihe = entladung({
      mAh: 10000,
      rMilliOhm: 70,
      strom: (k) => (k % 10 === 0 ? 100 : 800),
      vonP: 90,
      bisP: 40,
    })
    const g = lernen(reihe, 10000)
    assert.equal(g.stand, 'brauchbar')
    assert.equal(g.rMilliOhm, 70)
    assert.ok(g.rPaare >= 5)
    assert.ok(g.kapazitaetMah !== null && Math.abs(g.kapazitaetMah - 10000) < 600)
  })

  it('eine leere Reihe wirft nichts um', () => {
    const g = lernen([], 10000)
    assert.equal(g.stand, 'nichts')
    assert.equal(g.ladungMah, 0)
  })

  it('ohne brauchbare Entladung sagt die Box, dass sie den AUFDRUCK zeigt', () => {
    // Eine frische Box darf nicht ewig ohne Zahl bleiben - ohne Kapazitaet
    // gibt es keine Restzeit. Aber sie muss dazusagen, woher die Zahl kommt:
    // eine Herstellerangabe sieht am Schirm aus wie eine Messung.
    const frisch = Array.from({ length: 8 }, (_, k) => pt(k, 7393 - k * 10, -630, 59))
    const g = lernen(frisch, 10000)
    assert.equal(g.kapazitaetMah, null)
    assert.equal(g.kapazitaetQuelle, 'aufkleber')
    assert.equal(g.kapazitaetEntladungen, 0)
    // Ohne Akkuprofil gibt es auch keinen Aufdruck.
    assert.equal(lernen(frisch, null).kapazitaetQuelle, null)
  })

  it('mit einer Entladung heisst die Quelle "gemessen"', () => {
    const reihe = entladung({ mAh: 8400, rMilliOhm: 70, strom: () => 700, vonP: 92, bisP: 55 })
    const g = lernen(reihe, 10000)
    assert.equal(g.kapazitaetQuelle, 'gemessen')
    assert.equal(g.kapazitaetEntladungen, 1)
    assert.equal(g.kapazitaetHub, 37)
  })
})

describe('lernen mit zwei Zeitskalen', () => {
  it('nimmt für den Widerstand die FEINE Reihe', () => {
    // Am Gerät: die Minutenkurve sah keinen einzigen Lastwechsel, weil die
    // Lastphase kürzer war als der Abstand zweier Punkte. Die
    // Sekunden-Aufzeichnung sah sechs.
    const grob = [pt(0, 7400, -600, 57), pt(1, 7398, -600, 57), pt(2, 7396, -600, 57)]
    const fein = [
      { t: min(0) + 0, v: 7400, i: -520, p: 57 },
      { t: min(0) + 1000, v: 7355, i: -720, p: 57 },
      { t: min(0) + 2000, v: 7400, i: -520, p: 57 },
    ]
    assert.equal(lernen(grob, 10000).rMilliOhm, null, 'die grobe Reihe kann es nicht sehen')
    const g = lernen(grob, 10000, fein)
    assert.equal(g.rMilliOhm, 225, '45 mV auf 200 mA')
    assert.equal(g.rPaare, 2)
  })

  it('die Kapazität kommt weiter aus der LANGEN Reihe', () => {
    // Ein 20-Prozent-Hub passt in keine Sekundenaufzeichnung.
    const lang = entladung({ mAh: 10000, rMilliOhm: 70, strom: () => 800, vonP: 90, bisP: 40 })
    const kurz = [
      { t: min(0), v: 7400, i: -520, p: 57 },
      { t: min(0) + 1000, v: 7355, i: -720, p: 57 },
    ]
    const g = lernen(lang, 10000, kurz)
    assert.ok(g.kapazitaetMah !== null && Math.abs(g.kapazitaetMah - 10000) < 300)
    // Und der Widerstand kommt trotzdem aus der feinen.
    assert.equal(g.rMilliOhm, 225)
  })
})
