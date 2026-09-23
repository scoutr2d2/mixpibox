/**
 * Tests der Leerlauf-Entscheidung (E66/E72/E73).
 *
 * DIE TEUERSTE REGEL STEHT UNTEN und hat einen eigenen Block: zwei Stroeme
 * duerfen sich keinen Zugang teilen. Spotify spielt je Konto genau EINEN
 * Strom; startet ein zweiter mit demselben Schluessel, nimmt er dem ersten die
 * Wiedergabe weg — fuer ein Kind hoert die Musik mitten im Stueck auf, ohne
 * dass jemand etwas getan hat.
 *
 * UND: ES GIBT NIE BLOSS `null`. Ein Leerlauf-Arbeiter, der „nichts zu tun"
 * meldet, ist von einem kaputten nicht zu unterscheiden — beide tun nichts.
 * Jeder Test unten prueft deshalb auch den GRUND.
 */
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert'
import { describe, it } from 'node:test'

import { andereStroeme, istSchluessel, nachtmodusGilt, wasJetzt } from './auftrag.mjs'
import { LISTE_LEER, vormerken } from './liste.mjs'

const LUMPENPACK = 'spotify:track:0PyuOAMz1lv0z737JcQNOg'
const JOJO = 'spotify:track:2QqQXuDKNR8HK1cFxf0NhW'
const A = `spak_${'a'.repeat(32)}`
const B = `spak_${'b'.repeat(32)}`

const EINER = { eintraege: vormerken(LISTE_LEER, { uri: LUMPENPACK, titel: 'Die Zukunft wird gross' }).liste.eintraege }

/** Eine Aufstellung mit Wiedergabe (Strom 1) und Mitschnitt (Strom 2). */
function stroeme(schluesselMitschnitt = B, schluesselWiedergabe = A) {
  return {
    stroeme: [
      { nr: 1, zweck: 'wiedergabe', maschine: 'soloist', schluessel: schluesselWiedergabe, senke: '' },
      { nr: 2, zweck: 'mitschnitt', maschine: 'soloist', schluessel: schluesselMitschnitt, senke: 'leer' },
    ],
  }
}

/**
 * Die LAGE, wie der Wirt sie seit E74 hereinreicht: der Pool zum Nachsehen
 * UND der zugeteilte Strom. Vorher suchte `wasJetzt` sich Strom 2 selbst;
 * jetzt bekommt es ihn, und die Zeugen pruefen die PRUEFUNG statt der Suche.
 */
function lage(a = stroeme(), rest = {}) {
  return {
    spielt: false,
    stroeme: a,
    strom: (a?.stroeme ?? []).find((x) => x.nr === 2) ?? null,
    // SEIT E74 KOMMT DIE SENKE VOM ZWECK, nicht vom Strom: die Vergabe teilt
    // irgendeinen freien zu, und dessen `senke` ist sein Ziel beim HOEREN.
    mitschnittSenke: 'mixpi-mitschnitt',
    liste: EINER,
    ...rest,
  }
}

describe('wasJetzt — der Normalfall', () => {
  it('gibt einen Auftrag, wenn alles steht', () => {
    const { auftrag, grund } = wasJetzt(lage())
    ok(auftrag, `kein Auftrag, Grund: ${grund}`)
    strictEqual(auftrag.eintrag.uri, LUMPENPACK)
    strictEqual(auftrag.strom.nr, 2, 'es muss der Mitschnitt-Strom sein')
    strictEqual(grund, '')
  })

  it('nimmt den, den die Liste vorn hat', () => {
    // Die Reihenfolge gehoert der Liste (drei Stufen aus E73), nicht dieser
    // Entscheidung. Sie waehlt nur AUS, sie sortiert nicht.
    let l = LISTE_LEER
    l = vormerken(l, { uri: LUMPENPACK, titel: 'ohne Vorrang' }).liste
    l = vormerken(l, { uri: JOJO, titel: 'MIT Vorrang' }, 'automatisch', true).liste
    const { auftrag } = wasJetzt(lage(stroeme(), { liste: l }))
    strictEqual(auftrag.eintrag.uri, JOJO)
  })
})

describe('die sechs Gruende — und keiner davon ist bloss null', () => {
  it('1. nichts vorgemerkt ist KEIN Mangel', () => {
    const { auftrag, grund } = wasJetzt(lage(stroeme(), { liste: LISTE_LEER }))
    strictEqual(auftrag, null)
    strictEqual(grund, 'nichts vorgemerkt', 'das darf nicht wie ein Fehler klingen')
  })

  it('1b. liegengebliebene Fehler werden mitgezaehlt', () => {
    // Sonst sieht eine Liste mit drei gescheiterten Titeln aus wie eine leere.
    const l = { eintraege: [{ ...EINER.eintraege[0], zustand: 'fehler', grund: 'ging nicht' }] }
    const { auftrag, grund } = wasJetzt(lage(stroeme(), { liste: l }))
    strictEqual(auftrag, null)
    match(grund, /liegengeblieben/)
  })

  it('2. bei EINEM Zugang wartet der Leerlauf waehrend der Wiedergabe', () => {
    // Beide Stroeme mit DEMSELBEN Schluessel = ein Konto = keine
    // Unabhaengigkeit. Dann gilt die alte Regel: wer hoert, hat Vorrang.
    const { auftrag, grund } = wasJetzt(lage(stroeme(A, A), { spielt: true }))
    strictEqual(auftrag, null)
    match(grund, /spielt gerade/)
  })

  it('2b. bei ZWEI unabhaengigen Zugaengen nimmt er WAEHREND der Wiedergabe auf', () => {
    // Der Betreiber, 04.09.2026: „wir haben doch 2 soloisten, warum
    // zeichnet der eine nicht auf? die regel macht nur <2 sinn." Genau
    // dieser Fall: Strom 1 spielt (Schluessel A), Strom 2 nimmt auf
    // (Schluessel B) — zwei Konten, kein Streit um die Wiedergabe.
    const { auftrag, grund } = wasJetzt(lage(stroeme(B, A), { spielt: true }))
    ok(auftrag, `kein Auftrag trotz zweitem Strom, Grund: ${grund}`)
    strictEqual(auftrag.strom.nr, 2)
  })

  it('3. ohne zugeteilten Strom geht nichts — MIT dem Grund des Wirts', () => {
    // Seit E74 sucht das Plugin sich keinen Strom mehr. Der Wirt weiss, WARUM
    // nichts frei war („haelt 1 Strom fuers Hoeren frei", „kein Strom frei");
    // das Plugin weiss es nicht. Ein selbst erfundener Grund waere hier
    // schlechter als gar keiner, deshalb wird seiner durchgereicht.
    const nur = { stroeme: [{ nr: 1, zweck: 'wiedergabe', maschine: 'soloist', schluessel: A, senke: '' }] }
    const { auftrag, grund } = wasJetzt({
      spielt: false,
      stroeme: nur,
      strom: null,
      vergabeGrund: 'haelt 1 Strom fuers Hoeren frei',
      liste: EINER,
    })
    strictEqual(auftrag, null)
    match(grund, /fuers Hoeren frei/)
  })

  it('3b. ohne Strom UND ohne Grund steht trotzdem einer da', () => {
    const { auftrag, grund } = wasJetzt({ spielt: false, stroeme: stroeme(), strom: null, liste: EINER })
    strictEqual(auftrag, null)
    ok(grund.length > 0, 'nie ein nacktes null')
  })

  it('4. ein Zugang ohne die richtige FORM zaehlt nicht', () => {
    // Am 20.08.2026 stand SPAK_HIER_EINSETZEN in der Konfiguration: gesetzt,
    // verschieden vom anderen — und trotzdem kein Zugang.
    const { auftrag, grund } = wasJetzt(lage(stroeme('SPAK_HIER_EINSETZEN')))
    strictEqual(auftrag, null)
    match(grund, /Form spak_/)
  })

  it('4b. gar kein Zugang wird anders benannt als ein falscher', () => {
    const { grund } = wasJetzt(lage(stroeme('')))
    match(grund, /keinen Zugang/)
  })
})

describe('6. ohne eigene Senke gibt es keinen Auftrag', () => {
  it('verweigert, statt Versuche zu verbrennen', () => {
    // Ohne Senke lehnt `einenAufnehmen` ab — jeder Takt verbrauchte sonst
    // einen Versuch an einer Sache, die gar nicht am Titel liegt. Nach drei
    // Anlaeufen laege der Eintrag auf `fehler`, und zwar reihum die ganze
    // Liste. Ein UMSTAND ist kein Titelfehler.
    const { auftrag, grund } = wasJetzt(lage(stroeme(), { mitschnittSenke: '' }))
    strictEqual(auftrag, null)
    match(grund, /keine Senke fuer den Mitschnitt/)
    match(grund, /Familie/)
  })

  it('die Senke des ZUGETEILTEN Stroms ist egal — sie gehoert zum Hoeren', () => {
    // Am Geraet gemessen (22.08.2026): der Wirt teilte Strom 1 zu, dessen
    // `senke` LEER ist (also der Familienlautsprecher). Haette der Auftrag
    // sie genommen, haetten alle den Mitschnitt gehoert.
    const poolMitLeerem = { stroeme: [
      { nr: 1, maschine: 'soloist', schluessel: A, senke: '' },
      { nr: 2, maschine: 'soloist', schluessel: B, senke: '' },
    ] }
    const { auftrag } = wasJetzt(lage(poolMitLeerem))
    ok(auftrag, 'ein leerer Strom-Eintrag darf den Mitschnitt nicht aufhalten')
    strictEqual(auftrag.senke, 'mixpi-mitschnitt', 'und der Ton geht in die Leersenke')
  })

  it('mit Senke geht es durch', () => {
    ok(wasJetzt(lage()).auftrag)
  })
})

describe('DIE TEUERSTE REGEL: zwei Stroeme, ein Zugang', () => {
  it('verweigert, wenn Mitschnitt und Wiedergabe denselben Zugang haben', () => {
    // Fall 3 aus E66. Der zweite nimmt dem ersten die Wiedergabe weg — fuer
    // ein Kind hoert die Musik mitten im Stueck auf.
    const { auftrag, grund } = wasJetzt(lage(stroeme(A, A)))
    strictEqual(auftrag, null)
    match(grund, /teilt sich den Zugang/)
    match(grund, /Wiedergabe weg/)
  })

  it('prueft das AUCH, wenn gerade nichts spielt', () => {
    // Der Leerlauf endet, wenn jemand eine Kachel antippt — und dann laeuft
    // die Aufnahme noch. Wer nur „spielt gerade?" fragt, baut eine Falle mit
    // Zeitzuender.
    const { auftrag } = wasJetzt(lage(stroeme(A, A)))
    strictEqual(auftrag, null, 'die Kollision muss auch im Leerlauf auffallen')
  })

  it('laesst verschiedene Zugaenge durch', () => {
    const { auftrag } = wasJetzt(lage(stroeme(B, A)))
    ok(auftrag)
  })
})

describe('die Helfer', () => {
  it('istSchluessel prueft die FORM, nicht die Anwesenheit', () => {
    strictEqual(istSchluessel(A), true)
    for (const x of ['SPAK_HIER_EINSETZEN', 'spak_kurz', '', null, undefined, 42, `spak_${'a'.repeat(31)}`]) {
      strictEqual(istSchluessel(x), false, String(x))
    }
  })

  it('andereStroeme laesst den eigenen weg — sonst kollidiert jeder mit sich selbst', () => {
    const a = { stroeme: [
      { nr: 5, maschine: 'soloist', schluessel: B },
      { nr: 2, maschine: 'soloist', schluessel: A },
    ] }
    strictEqual(andereStroeme(a, { nr: 2 }).length, 1)
    strictEqual(andereStroeme(a, { nr: 2 })[0].nr, 5)
  })

  it('vertraegt Unsinn statt einer Aufstellung', () => {
    for (const x of [null, undefined, {}, [], 'nichts', 42]) {
      strictEqual(andereStroeme(x, { nr: 1 }).length, 0, String(x))
    }
    const { auftrag, grund } = wasJetzt({ spielt: false, stroeme: null, strom: null, liste: EINER })
    strictEqual(auftrag, null)
    ok(grund.length > 0, 'auch hier muss ein Grund dastehen')
  })

  it('vertraegt eine fehlende Lage', () => {
    const { auftrag, grund } = wasJetzt(undefined)
    strictEqual(auftrag, null)
    deepStrictEqual(typeof grund, 'string')
  })
})

describe('nachtmodusGilt — die Regel des Nachtmodus (E127)', () => {
  const um = (h, m = 0) => new Date(2026, 8, 4, h, m)

  it('ohne Schalter nie', () => {
    strictEqual(nachtmodusGilt({ nachtVon: '22:00', nachtBis: '06:00' }, um(23)), false)
    strictEqual(nachtmodusGilt({}, um(23)), false)
  })

  it('UEBER MITTERNACHT — sonst gaelte er nachts nie', () => {
    const e = { nachtmodus: true, nachtVon: '22:00', nachtBis: '06:00' }
    strictEqual(nachtmodusGilt(e, um(23)), true, '23 Uhr liegt drin')
    strictEqual(nachtmodusGilt(e, um(3)), true, '3 Uhr auch')
    strictEqual(nachtmodusGilt(e, um(12)), false, 'mittags nicht')
    strictEqual(nachtmodusGilt(e, um(21, 59)), false)
    strictEqual(nachtmodusGilt(e, um(22, 0)), true, 'die Grenze zaehlt dazu')
    strictEqual(nachtmodusGilt(e, um(6, 0)), false, 'das Ende zaehlt NICHT dazu')
  })

  it('ein Fenster INNERHALB eines Tages geht auch', () => {
    const e = { nachtmodus: true, nachtVon: '09:00', nachtBis: '11:00' }
    strictEqual(nachtmodusGilt(e, um(10)), true)
    strictEqual(nachtmodusGilt(e, um(12)), false)
  })

  it('ohne Zeiten gilt er SOFORT — wer den Schalter umlegt, meint jetzt', () => {
    strictEqual(nachtmodusGilt({ nachtmodus: true }, um(14)), true)
    strictEqual(nachtmodusGilt({ nachtmodus: true, nachtVon: '', nachtBis: '' }, um(14)), true)
  })

  it('eine UNLESBARE Zeit schaltet ab, nicht ein', () => {
    // Ein Modus, der Spotify stumm schaltet, darf nicht aus einem Tippfehler
    // entstehen.
    strictEqual(nachtmodusGilt({ nachtmodus: true, nachtVon: '22', nachtBis: '06:00' }, um(23)), false)
    strictEqual(nachtmodusGilt({ nachtmodus: true, nachtVon: '25:00', nachtBis: '06:00' }, um(23)), false)
  })
})
