/**
 * Tests für die Klangkette.
 *
 * ZWEI DINGE WERDEN GEPRUEFT, und sie haben verschiedene Haerte:
 *
 *   1. Was `kettePruefen` ABLEHNT. Das ist der Riegel — hier darf nichts
 *      durchrutschen, denn eine krumme Kette laedt nicht, und dann ist die
 *      Senke weg, auf die der Ton bereits geroutet wurde.
 *   2. Was `ketteConfBauen` SCHREIBT. Wie bei asoundConf in ton.spec.ts ist
 *      das eine Datei, die ein anderer Prozess liest; ein Tippfehler darin
 *      ist kein Testfehler, sondern eine stumme Box.
 *
 * NICHT GEPRUEFT WIRD DIE FORMATIERUNG (Einrueckung, Reihenfolge der
 * Attribute) — das waere ein Test, der bei jeder Umformatierung rot wird,
 * ohne dass sich am Klang etwas aendert. Geprueft wird, was PipeWire
 * auswertet: Label, Steuerwerte, Verkettung, Ein- und Ausgaenge.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  basisFaktoren,
  dbFaktor,
  GLIEDER_HOECHSTENS,
  gleicheStruktur,
  type Klangglied,
  ketteBeschreiben,
  ketteConfBauen,
  kettePruefen,
  ketteStellwerte,
  LADSPA,
  ladspaPfad,
  frequenzgang,
  spitzeDb,
  stellwerteAlsProps,
} from './klangkette.js'

const GABEN = { sinkName: 'klangwerk', ausgangName: 'klangwerk.ausgang', beschreibung: 'Klangwerk' }

describe('kettePruefen — was durchkommt', () => {
  it('nimmt eine leere Kette an (kein Plugin hat etwas zu sagen)', () => {
    const u = kettePruefen([])
    assert.equal(u.ok, true)
    assert.deepEqual(u.kette, [])
  })

  it('nimmt fehlende Angaben als leere Kette, statt zu werfen', () => {
    assert.equal(kettePruefen(undefined).ok, true)
    assert.equal(kettePruefen(null).ok, true)
  })

  it('nimmt die Glieder an, die das Plugin fuer die seitliche Abstrahlung braucht', () => {
    const u = kettePruefen([
      { art: 'basis', breite: 50 },
      { art: 'hochpass', freq: 120 },
      { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 5 },
      { art: 'vorpegel', dB: -3 },
    ])
    assert.equal(u.ok, true, u.maengel.join(' / '))
    assert.equal(u.kette.length, 4)
  })

  it('setzt die Guete-Vorgabe, wo keine angegeben ist', () => {
    const u = kettePruefen([{ art: 'glocke', freq: 1000, dB: 3 }])
    assert.equal(u.ok, true)
    assert.equal((u.kette[0] as { guete: number }).guete, 1.0)
  })
})

describe('kettePruefen — was abgewiesen wird', () => {
  it('weist eine unbekannte Art ab, statt sie stillschweigend zu ueberspringen', () => {
    const u = kettePruefen([{ art: 'faltung', datei: '/etc/shadow' }])
    assert.equal(u.ok, false)
    assert.match(u.maengel.join(' '), /faltung/)
  })

  it('gibt bei einem Mangel KEINE halbe Kette heraus', () => {
    // DAS GUELTIGE GLIED STEHT ABSICHTLICH DAVOR. Mit nur dem krummen waere
    // die Kette ohnehin leer, und dieser Test gruen, ohne je etwas zu
    // pruefen — bei der Gegenprobe am 21.08.2026 genau so gemessen: die
    // Zeile, die den Mangel durchsetzt, wurde entfernt und alles blieb
    // gruen. Ein halb uebernommener Filtergraph waere schlimmer als gar
    // keiner: er klaenge falsch, ohne dass etwas meldet, warum.
    const u = kettePruefen([
      { art: 'basis', breite: 30 },
      { art: 'faltung', datei: '/etc/shadow' },
    ])
    assert.equal(u.ok, false)
    assert.deepEqual(u.kette, [], 'das gueltige Glied darf ohne sein Nachbarglied nicht durchkommen')
  })

  it('weist Frequenzen ausserhalb des Hoerbaren ab', () => {
    assert.equal(kettePruefen([{ art: 'hochpass', freq: 0 }]).ok, false)
    assert.equal(kettePruefen([{ art: 'hochpass', freq: 48000 }]).ok, false)
    assert.equal(kettePruefen([{ art: 'hochpass', freq: 'viel' }]).ok, false)
  })

  it('weist masslose Anhebungen ab', () => {
    assert.equal(kettePruefen([{ art: 'glocke', freq: 1000, dB: 60 }]).ok, false)
  })

  it('laesst den Vorpegel NUR daempfen — sonst waere er ein Lautmacher', () => {
    assert.equal(kettePruefen([{ art: 'vorpegel', dB: -6 }]).ok, true)
    const u = kettePruefen([{ art: 'vorpegel', dB: 6 }])
    assert.equal(u.ok, false, 'ein anhebender Vorpegel haette den Deckel der Ton-Seite ausgehebelt')
  })

  it('laesst die Stereobasis nicht ueber 100 (das zoege die Mitte auseinander)', () => {
    assert.equal(kettePruefen([{ art: 'basis', breite: 100 }]).ok, true)
    assert.equal(kettePruefen([{ art: 'basis', breite: 140 }]).ok, false)
    assert.equal(kettePruefen([{ art: 'basis', breite: -10 }]).ok, false)
  })

  it('weist eine Kette ab, die die Box rechnen liesse, bis das Hoerspiel stottert', () => {
    const zuviel = Array.from({ length: GLIEDER_HOECHSTENS + 1 }, () => ({ art: 'glocke', freq: 1000, dB: 1 }))
    assert.equal(kettePruefen(zuviel).ok, false)
  })

  it('meldet ALLE Maengel auf einmal, nicht nur den ersten', () => {
    const u = kettePruefen([{ art: 'hochpass', freq: 0 }, { art: 'quatsch' }, { art: 'glocke', freq: 1000, dB: 99 }])
    assert.equal(u.ok, false)
    assert.equal(u.maengel.length, 3, u.maengel.join(' / '))
  })

  it('weist etwas ab, das gar keine Liste ist', () => {
    assert.equal(kettePruefen({ art: 'basis', breite: 0 }).ok, false)
    assert.equal(kettePruefen('basis').ok, false)
  })
})

describe('basisFaktoren — die Matrix', () => {
  it('laesst bei 100 alles, wie es ist', () => {
    assert.deepEqual(basisFaktoren(100), { eigen: 1, ueber: 0 })
  })

  it('macht bei 0 echtes Mono', () => {
    assert.deepEqual(basisFaktoren(0), { eigen: 0.5, ueber: 0.5 })
  })

  it('ergibt bei 50 die 0,75/0,25 aus der Empfehlung', () => {
    assert.deepEqual(basisFaktoren(50), { eigen: 0.75, ueber: 0.25 })
  })

  it('haelt die Summe konstant — Verengen darf nicht lauter machen', () => {
    for (const b of [0, 25, 50, 75, 100]) {
      const { eigen, ueber } = basisFaktoren(b)
      assert.equal(eigen + ueber, 1, `bei Breite ${b}`)
    }
  })
})

describe('dbFaktor', () => {
  it('rechnet 0 dB auf 1', () => {
    assert.equal(dbFaktor(0), 1)
  })

  it('rechnet -6 dB auf etwa die halbe Amplitude', () => {
    assert.ok(Math.abs(dbFaktor(-6) - 0.5) < 0.01, `war ${dbFaktor(-6)}`)
  })
})

describe('ketteConfBauen', () => {
  it('baut auch aus einer LEEREN Kette eine ladbare Senke', () => {
    // Sonst faellt die Senke weg, auf die der Ton schon geroutet ist — und
    // die Box ist still, obwohl „kein Effekt" eingestellt war.
    const c = ketteConfBauen([], GABEN)
    assert.match(c, /label = copy name = ein_l/)
    assert.match(c, /inputs\s+= \[ "ein_l:In" "ein_r:In" \]/)
    assert.match(c, /outputs = \[ "ein_l:Out" "ein_r:Out" \]/)
    assert.match(c, /node\.name = "klangwerk"/)
    assert.match(c, /media\.class = Audio\/Sink/)
  })

  it('kreuzt bei der Stereobasis beide Kanaele in beide Mischer', () => {
    const c = ketteConfBauen(kettePruefen([{ art: 'basis', breite: 50 }]).kette, GABEN)
    // Der linke Mischer nimmt links stark, rechts schwach — der rechte umgekehrt.
    assert.match(c, /name = g0_l control = \{ "Gain 1" = 0\.75 "Gain 2" = 0\.25 \}/)
    assert.match(c, /name = g0_r control = \{ "Gain 1" = 0\.25 "Gain 2" = 0\.75 \}/)
    // Beide Eingaenge muessen in BEIDE Mischer laufen, sonst mischt nichts.
    assert.match(c, /output = "ein_l:Out" input = "g0_l:In 1"/)
    assert.match(c, /output = "ein_r:Out" input = "g0_l:In 2"/)
    assert.match(c, /output = "ein_l:Out" input = "g0_r:In 1"/)
    assert.match(c, /output = "ein_r:Out" input = "g0_r:In 2"/)
  })

  it('macht aus Breite 0 wirklich Mono (beide Mischer gleich gewichtet)', () => {
    const c = ketteConfBauen(kettePruefen([{ art: 'basis', breite: 0 }]).kette, GABEN)
    assert.match(c, /name = g0_l control = \{ "Gain 1" = 0\.5 "Gain 2" = 0\.5 \}/)
    assert.match(c, /name = g0_r control = \{ "Gain 1" = 0\.5 "Gain 2" = 0\.5 \}/)
  })

  it('benutzt die builtin-Label, die die Bibliothek wirklich kennt', () => {
    const kette = kettePruefen([
      { art: 'hochpass', freq: 120 },
      { art: 'tiefpass', freq: 16000 },
      { art: 'kuhschwanz', lage: 'tief', freq: 100, dB: 3 },
      { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 5 },
      { art: 'glocke', freq: 800, dB: -2 },
    ]).kette
    const c = ketteConfBauen(kette, GABEN)
    for (const label of ['bq_highpass', 'bq_lowpass', 'bq_lowshelf', 'bq_highshelf', 'bq_peaking']) {
      assert.match(c, new RegExp(`label = ${label} `), `${label} fehlt`)
    }
    // Und NICHTS, was ein Plugin an den Kern vorbeiliesse.
    assert.doesNotMatch(c, /convolver|ladspa|lv2|sofa/, 'kein Baustein, der fremde Dateien nachlaedt')
  })

  it('schreibt Gain nur dort, wo der Filter einen hat', () => {
    const c = ketteConfBauen(kettePruefen([{ art: 'hochpass', freq: 120 }]).kette, GABEN)
    // Ein Hochpass mit "Gain" waere kein Fehler, den PipeWire meldet — er
    // stuende nur wirkungslos da und liesse den Leser glauben, er wirke.
    assert.doesNotMatch(c, /label = bq_highpass name = g0_l control = \{[^}]*Gain/)
  })

  it('verkettet die Glieder der Reihe nach und fuehrt zum letzten hinaus', () => {
    const kette = kettePruefen([
      { art: 'basis', breite: 40 },
      { art: 'hochpass', freq: 120 },
      { art: 'vorpegel', dB: -3 },
    ]).kette
    const c = ketteConfBauen(kette, GABEN)
    assert.match(c, /output = "g0_l:Out" input = "g1_l:In"/, 'Basis -> Hochpass')
    assert.match(c, /output = "g1_l:Out" input = "g2_l:In 1"/, 'Hochpass -> Vorpegel')
    assert.match(c, /outputs = \[ "g2_l:Out" "g2_r:Out" \]/, 'hinaus geht es am LETZTEN Glied')
  })

  it('daempft den Vorpegel mit dem linearen Faktor, nicht mit dem dB-Wert', () => {
    const c = ketteConfBauen(kettePruefen([{ art: 'vorpegel', dB: -6 }]).kette, GABEN)
    // -6 dB sind 0,5 — nicht „-6".
    assert.match(c, /name = g0_l control = \{ "Gain 1" = 0\.5\d* \}/)
    assert.doesNotMatch(c, /"Gain 1" = -6/)
  })

  it('nennt den Ausgang so, wie der Server ihn sucht', () => {
    const c = ketteConfBauen([], GABEN)
    assert.match(c, /node\.name = "klangwerk\.ausgang"/)
    assert.match(c, /node\.passive = true/)
  })
})

describe('Live regeln — Stellwerte und Struktur', () => {
  it('nennt GENAU die Knoten, die auch in der Conf stehen', () => {
    // DER WICHTIGSTE TEST DER LIVE-REGELUNG. Stimmen die Namen nicht ueberein,
    // nimmt PipeWire die Props kommentarlos an und aendert NICHTS — kein
    // Fehler, keine Meldung, nur ein Regler, der nicht wirkt.
    const kette = kettePruefen([
      { art: 'basis', breite: 40 },
      { art: 'hochpass', freq: 120 },
      { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 5 },
      { art: 'vorpegel', dB: -3 },
    ]).kette
    const conf = ketteConfBauen(kette, GABEN)
    for (const w of ketteStellwerte(kette)) {
      assert.match(conf, new RegExp(`name = ${w.knoten} `), `Knoten ${w.knoten} fehlt in der Conf`)
    }
  })

  it('stellt die Matrix beidseitig — vier Werte je Basis-Glied', () => {
    const w = ketteStellwerte(kettePruefen([{ art: 'basis', breite: 50 }]).kette)
    assert.deepEqual(w, [
      { knoten: 'g0_l', anschluss: 'Gain 1', wert: 0.75 },
      { knoten: 'g0_l', anschluss: 'Gain 2', wert: 0.25 },
      { knoten: 'g0_r', anschluss: 'Gain 1', wert: 0.25 },
      { knoten: 'g0_r', anschluss: 'Gain 2', wert: 0.75 },
    ])
  })

  it('gibt dem Vorpegel den linearen Faktor, nicht den dB-Wert', () => {
    const w = ketteStellwerte(kettePruefen([{ art: 'vorpegel', dB: -6 }]).kette)
    assert.ok(Math.abs(w[0].wert - 0.5) < 0.01, `war ${w[0].wert}`)
  })

  it('gibt einem Hochpass KEIN Gain — den Anschluss hat er nicht', () => {
    const w = ketteStellwerte(kettePruefen([{ art: 'hochpass', freq: 120 }]).kette)
    assert.equal(
      w.some((x) => x.anschluss === 'Gain'),
      false,
    )
    assert.equal(
      w.some((x) => x.anschluss === 'Freq'),
      true,
    )
  })

  it('erkennt gleiche Struktur trotz anderer Werte — DAS ist der Live-Fall', () => {
    const a = kettePruefen([
      { art: 'basis', breite: 100 },
      { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 0 },
    ]).kette
    const b = kettePruefen([
      { art: 'basis', breite: 30 },
      { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 6 },
    ]).kette
    assert.equal(gleicheStruktur(a, b), true, 'nur Werte geaendert — das muss live gehen')
  })

  it('erkennt einen Baustein-Wechsel als STRUKTUR-Aenderung', () => {
    // tief und hoch sind verschiedene Bausteine (bq_lowshelf / bq_highshelf),
    // kein Steuerwert — das MUSS einen Neubau ausloesen.
    const a = kettePruefen([{ art: 'kuhschwanz', lage: 'tief', freq: 100, dB: 3 }]).kette
    const b = kettePruefen([{ art: 'kuhschwanz', lage: 'hoch', freq: 100, dB: 3 }]).kette
    assert.equal(gleicheStruktur(a, b), false)
  })

  it('erkennt ein hinzugekommenes oder fehlendes Glied als Struktur-Aenderung', () => {
    const a = kettePruefen([{ art: 'basis', breite: 50 }]).kette
    const b = kettePruefen([
      { art: 'basis', breite: 50 },
      { art: 'hochpass', freq: 120 },
    ]).kette
    assert.equal(gleicheStruktur(a, b), false)
    assert.equal(gleicheStruktur([], []), true)
  })

  it('baut eine Props-Zeile, die pw-cli lesen kann', () => {
    const p = stellwerteAlsProps(ketteStellwerte(kettePruefen([{ art: 'basis', breite: 0 }]).kette))
    assert.match(p, /^\{ params = \[ /)
    assert.match(p, /"g0_l:Gain 1" 0\.5/)
    assert.match(p, /\] \}$/)
    // Keine Exponentialschreibweise — pw-cli liest Text.
    assert.doesNotMatch(p, /e-\d/)
  })
})

describe('Kompressor und Begrenzer — die zwei aus fremdem Haus', () => {
  it('nimmt einen Kompressor mit Schwelle und Verhaeltnis an', () => {
    const u = kettePruefen([{ art: 'kompressor', schwelle: -18, verhaeltnis: 3 }])
    assert.equal(u.ok, true, u.maengel.join(' / '))
    assert.deepEqual(u.kette[0], {
      art: 'kompressor',
      schwelle: -18,
      verhaeltnis: 3,
      anstieg: 10,
      abfall: 200,
      makeup: 0,
    })
  })

  it('haelt sich an die Grenzen des BAUSTEINS, nicht an ausgedachte', () => {
    // sc4 kann Schwelle -30..0, Verhaeltnis 1..20. Ein Wert darueber waere
    // kein Fehler, den LADSPA meldet — er wuerde still eingefangen, und der
    // Regler zeigte etwas anderes als der Klang tut.
    assert.equal(kettePruefen([{ art: 'kompressor', schwelle: -40, verhaeltnis: 3 }]).ok, false)
    assert.equal(kettePruefen([{ art: 'kompressor', schwelle: 5, verhaeltnis: 3 }]).ok, false)
    assert.equal(kettePruefen([{ art: 'kompressor', schwelle: -18, verhaeltnis: 50 }]).ok, false)
    assert.equal(kettePruefen([{ art: 'kompressor', schwelle: -18, verhaeltnis: 0.5 }]).ok, false)
  })

  it('nimmt einen Begrenzer an und deckelt seine Spanne', () => {
    assert.equal(kettePruefen([{ art: 'begrenzer', grenze: -2 }]).ok, true)
    assert.equal(kettePruefen([{ art: 'begrenzer', grenze: -40 }]).ok, false)
    assert.equal(kettePruefen([{ art: 'begrenzer', grenze: 3 }]).ok, false)
    assert.equal(kettePruefen([{ art: 'begrenzer', grenze: -2, abfall: 9 }]).ok, false)
  })

  it('baut EINEN Stereo-Knoten, nicht zwei — sonst wandert die Mitte', () => {
    // Zwei getrennte Kompressoren regelten UNABHAENGIG: ein lauter Ton links
    // zoege nur links den Pegel herunter, und das hoert man wandern.
    const kette = kettePruefen([{ art: 'kompressor', schwelle: -18, verhaeltnis: 3 }]).kette
    const c = ketteConfBauen(kette, GABEN)
    assert.match(c, /name = g0 control/, 'ein Knoten g0, nicht g0_l/g0_r')
    assert.doesNotMatch(c, /name = g0_l/)
    assert.match(c, /input = "g0:Left input"/)
    assert.match(c, /input = "g0:Right input"/)
    assert.match(c, /outputs = \[ "g0:Left output" "g0:Right output" \]/)
  })

  it('nennt den vollen PFAD und das echte Label — beides am Geraet gemessen', () => {
    // Mit dem Kurznamen "sc4" bricht PipeWire ab; ohne LADSPA_PATH sucht es
    // nirgends. Und das Label heisst nicht wie die Datei.
    const kette = kettePruefen([
      { art: 'kompressor', schwelle: -18, verhaeltnis: 3 },
      { art: 'begrenzer', grenze: -2 },
    ]).kette
    const c = ketteConfBauen(kette, GABEN)
    assert.match(c, /plugin = "\/usr\/lib\/ladspa\/sc4_1882\.so" label = sc4 /)
    assert.match(c, /plugin = "[^"]*fast_lookahead_limiter_1913\.so" label = fastLookaheadLimiter /)
    assert.match(c, /type = ladspa/)
  })

  it('LAESST DAS GLIED WEG, wenn die .so fehlt — statt die Kette zu sprengen', () => {
    // Der wichtigste Test der beiden. Eine Kette, die auf eine fehlende Datei
    // zeigt, laedt GAR NICHT — und dann waere die Senke weg, auf die der Ton
    // schon geroutet ist. Auf einer Box ohne swh-plugins muss der Rest der
    // Kette trotzdem stehen.
    const kette = kettePruefen([
      { art: 'basis', breite: 50 },
      { art: 'kompressor', schwelle: -18, verhaeltnis: 3 },
    ]).kette
    const c = ketteConfBauen(kette, { ...GABEN, gibtDatei: () => false })
    assert.doesNotMatch(c, /ladspa/, 'ohne die Datei darf kein ladspa-Knoten entstehen')
    assert.match(c, /name = g0_l control/, 'die Stereobasis muss bleiben')
    assert.match(c, /outputs = \[ "g0_l:Out" "g0_r:Out" \]/, 'und der Ausgang haengt an ihr')
  })

  it('nimmt den ersten Pfad, den es WIRKLICH gibt', () => {
    const zweiter = LADSPA.kompressor.pfade[1]
    assert.equal(ladspaPfad(LADSPA.kompressor, (p) => p === zweiter), zweiter)
    assert.equal(ladspaPfad(LADSPA.kompressor, () => false), null)
  })

  it('stellt Kompressor und Begrenzer live — an EINEM Knoten', () => {
    const kette = kettePruefen([{ art: 'kompressor', schwelle: -18, verhaeltnis: 3, makeup: 4 }]).kette
    const w = ketteStellwerte(kette)
    assert.ok(
      w.every((x) => x.knoten === 'g0'),
      'alle Stellwerte gehoeren demselben Knoten',
    )
    assert.deepEqual(
      w.find((x) => x.anschluss === 'Threshold level (dB)'),
      { knoten: 'g0', anschluss: 'Threshold level (dB)', wert: -18 },
    )
    assert.equal(w.find((x) => x.anschluss === 'Makeup gain (dB)')?.wert, 4)
  })

  it('haben KEINEN Frequenzgang — sie haengen am Pegel, nicht an der Frequenz', () => {
    // Eine Linie im Bild waere eine Behauptung ueber etwas, das die Kurve
    // nicht zeigen kann.
    const kette = kettePruefen([
      { art: 'kompressor', schwelle: -18, verhaeltnis: 5 },
      { art: 'begrenzer', grenze: -2 },
    ]).kette
    for (const p of frequenzgang(kette)) assert.equal(p.dB, 0)
    assert.equal(spitzeDb(kette), 0)
  })

  it('beschreibt sie lesbar', () => {
    assert.equal(
      ketteBeschreiben(kettePruefen([{ art: 'kompressor', schwelle: -18, verhaeltnis: 3 }]).kette),
      'Kompressor -18 dB / 3:1',
    )
    assert.equal(ketteBeschreiben(kettePruefen([{ art: 'begrenzer', grenze: -2 }]).kette), 'Begrenzer -2 dB')
  })
})

describe('Frequenzgang — die Kurve ist die echte Wirkung, nicht gemalt', () => {
  const bei = (kette: Klangglied[], hz: number) => {
    const g = frequenzgang(kette, 192)
    return g.reduce((a, b) => (Math.abs(b.hz - hz) < Math.abs(a.hz - hz) ? b : a)).dB
  }

  it('ist ohne Kette ueberall flach', () => {
    const g = frequenzgang([])
    assert.equal(g.length, 96)
    for (const p of g) assert.equal(p.dB, 0)
  })

  it('verteilt die Stuetzstellen LOGARITHMISCH ueber das Hoerbare', () => {
    // Linear verteilt laegen fast alle Punkte im Hochton — und ausgerechnet
    // der Bereich, in dem ein Hochpass wirkt, haette drei davon.
    const g = frequenzgang([], 3)
    assert.ok(Math.abs(g[0].hz - 20) < 1)
    assert.ok(Math.abs(g[1].hz - 632) < 5, `Mitte war ${g[1].hz}`)
    assert.ok(Math.abs(g[2].hz - 20000) < 10)
  })

  it('rechnet den Hochpass richtig: -3 dB an der Eckfrequenz', () => {
    // Das ist die Probe aufs Exempel fuer die RBJ-Formeln — ein Hochpass mit
    // Q=0,707 liegt an seiner Eckfrequenz bei -3 dB. Stimmt das nicht, sind
    // die Koeffizienten falsch, und die ganze Kurve luegt.
    // Math.SQRT1_2 statt 0,707: das IST der Butterworth-Guetewert, und der
    // Linter hat recht, dass eine abgetippte Naeherung dafuer taugt.
    const kette = kettePruefen([{ art: 'hochpass', freq: 1000, guete: Math.SQRT1_2 }]).kette
    assert.ok(Math.abs(bei(kette, 1000) - -3) < 0.6, `war ${bei(kette, 1000)}`)
  })

  it('laesst der Hochpass oben durch und schneidet unten weg', () => {
    const kette = kettePruefen([{ art: 'hochpass', freq: 200 }]).kette
    assert.ok(bei(kette, 5000) > -0.5, 'oberhalb muss er durchlassen')
    assert.ok(bei(kette, 30) < -12, `bei 30 Hz war ${bei(kette, 30)}`)
  })

  it('hebt der Hoehen-Kuhschwanz oben an und laesst unten in Ruhe', () => {
    const kette = kettePruefen([{ art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 6 }]).kette
    assert.ok(Math.abs(bei(kette, 16000) - 6) < 1, `oben war ${bei(kette, 16000)}`)
    assert.ok(Math.abs(bei(kette, 100)) < 0.5, `unten war ${bei(kette, 100)}`)
  })

  it('hebt der Bass-Kuhschwanz unten an und laesst oben in Ruhe', () => {
    const kette = kettePruefen([{ art: 'kuhschwanz', lage: 'tief', freq: 100, dB: 6 }]).kette
    assert.ok(Math.abs(bei(kette, 25) - 6) < 1, `unten war ${bei(kette, 25)}`)
    assert.ok(Math.abs(bei(kette, 8000)) < 0.5, `oben war ${bei(kette, 8000)}`)
  })

  it('trifft die Glocke ihre Mittenfrequenz', () => {
    const kette = kettePruefen([{ art: 'glocke', freq: 1000, dB: 6 }]).kette
    assert.ok(Math.abs(bei(kette, 1000) - 6) < 0.5, `war ${bei(kette, 1000)}`)
  })

  it('senkt der Vorpegel die GANZE Kurve, gleichmaessig', () => {
    const kette = kettePruefen([{ art: 'vorpegel', dB: -6 }]).kette
    for (const p of frequenzgang(kette)) assert.ok(Math.abs(p.dB - -6) < 0.01)
  })

  it('IGNORIERT die Stereobasis — sie hat keinen Frequenzgang', () => {
    // Sie mischt zwischen den KANAELEN. Wer sie einzeichnete, behauptete eine
    // Wirkung, die es nicht gibt.
    const kette = kettePruefen([{ art: 'basis', breite: 0 }]).kette
    for (const p of frequenzgang(kette)) assert.equal(p.dB, 0)
  })

  it('summiert mehrere Glieder auf', () => {
    const kette = kettePruefen([
      { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 6 },
      { art: 'vorpegel', dB: -6 },
    ]).kette
    // Oben heben sich +6 und -6 auf, unten bleibt die Daempfung stehen.
    assert.ok(Math.abs(bei(kette, 16000)) < 1, `oben war ${bei(kette, 16000)}`)
    assert.ok(Math.abs(bei(kette, 100) - -6) < 0.5, `unten war ${bei(kette, 100)}`)
  })
})

describe('spitzeDb — die Pegelanzeige', () => {
  it('ist ohne Kette null', () => {
    assert.equal(spitzeDb([]), 0)
  })

  it('meldet die hoechste Anhebung', () => {
    const kette = kettePruefen([{ art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 6 }]).kette
    assert.ok(Math.abs(spitzeDb(kette) - 6) < 1, `war ${spitzeDb(kette)}`)
  })

  it('rechnet den Vorpegel gegen — DAS ist sein Zweck', () => {
    // Wer +6 dB anhebt und 6 dB vordaempft, hat wieder Luft. Genau das soll
    // die Anzeige zeigen, sonst waere der Vorpegel-Regler blind.
    const kette = kettePruefen([
      { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 6 },
      { art: 'vorpegel', dB: -6 },
    ]).kette
    assert.ok(spitzeDb(kette) < 0.5, `war ${spitzeDb(kette)}`)
  })

  it('meldet bei reiner Absenkung nur den Shelf-Ueberschwinger', () => {
    // NACHGEMESSEN, NICHT ERWARTET: ein Kuhschwanz mit -6 dB hat bei Q=1
    // einen Ueberschwinger von +0,44 dB vor der Absenkung (bei 1976 Hz). Das
    // ist korrektes Verhalten eines RBJ-Shelfs, kein Rechenfehler — bei Q
    // ueber 0,707 schwingt er auf der Gegenseite leicht ueber.
    //
    // Der erste Entwurf dieses Tests verlangte "unter null" und war rot. Die
    // richtige Antwort war, den TEST zu berichtigen, nicht die Formel: die
    // Kurve soll zeigen, was der Filter TUT, nicht was man erwartet.
    //
    // Fuer die Anzeige heisst das: erst ab etwa +1 dB von Uebersteuern reden,
    // sonst warnt sie bei jeder Absenkung.
    const kette = kettePruefen([{ art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: -6 }]).kette
    const s = spitzeDb(kette)
    assert.ok(s > 0 && s < 1, `war ${s} — erwartet der kleine Ueberschwinger, nicht mehr`)
  })
})

describe('ketteBeschreiben', () => {
  it('sagt es klar, wenn nichts eingehaengt ist', () => {
    assert.equal(ketteBeschreiben([]), 'nichts eingehängt')
  })

  it('nennt Mono beim Namen statt „Stereobasis 0 %"', () => {
    assert.equal(ketteBeschreiben([{ art: 'basis', breite: 0 }]), 'Mono')
  })

  it('schreibt eine Zeile, die man auf der Ton-Seite lesen kann', () => {
    const kette: Klangglied[] = [
      { art: 'basis', breite: 50 },
      { art: 'hochpass', freq: 120 },
      { art: 'kuhschwanz', lage: 'hoch', freq: 4000, dB: 5 },
    ]
    assert.equal(ketteBeschreiben(kette), 'Stereobasis 50 %, Hochpass 120 Hz, Höhen +5 dB')
  })
})
