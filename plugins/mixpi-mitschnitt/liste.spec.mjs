/**
 * Tests der Mitschnitt-Liste (E66/E73).
 *
 * DIE TITEL SIND DIE ECHTEN DIESER BOX — dieselben Kennungen wie in
 * interpreten.integration.spec.ts, damit ein Fehler an einer Stelle nicht in
 * der anderen als „anderes Beispiel" durchrutscht.
 *
 * VIER FAELLE TRAGEN DEN TEST, und keiner ist der Normalfall:
 *
 *   1. DIE PLATTE WIDERSPRICHT DER LISTE. Sie weiss nur, was sie selbst
 *      aufgenommen hat; geht sie verloren, naehme die Box alles ein zweites
 *      Mal auf — und die Investition amortisiert sich nie.
 *   2. EIN EINTRAG AUF `laeuft`, DEN NIEMAND MEHR ABSCHLIESST. Der Strom faellt
 *      mitten in der Aufnahme; ohne Erholung blockiert er die Liste fuer immer,
 *      und zwar STILL.
 *   3. EIN TITEL, DEN SPOTIFY NICHT MEHR HERGIBT. Ohne Deckel haelt er die
 *      Liste bei jedem Durchgang neu auf.
 *   4. EIN TITEL, DER SCHON AUFGENOMMEN IST. Erneut vorgemerkt entstuende die
 *      Halde aus E28.
 */
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { describe, it } from 'node:test'
import {
  abgleichen,
  abschliessen,
  beginnen,
  einordnen,
  eintragAus,
  entfernen,
  HOECHSTENS_VERSUCHE,
  istTitelUri,
  LISTE_LEER,
  listeAus,
  naechster,
  SCHWELLE_SEK,
  scheitern,
  stand,
  vormerken,
  zuruecklegen,
  zuruecksetzen,
} from './liste.mjs'

const LUMPENPACK = 'spotify:track:0PyuOAMz1lv0z737JcQNOg'
const JOJO = 'spotify:track:2QqQXuDKNR8HK1cFxf0NhW'
const EMMA = 'spotify:track:4ZwXKLDWoTGqiV0avfB1Y9'

function mitDreien() {
  let l = LISTE_LEER
  l = vormerken(l, { uri: LUMPENPACK, titel: 'Die Zukunft wird gross', interpret: 'Das Lumpenpack' }).liste
  l = vormerken(l, { uri: JOJO, titel: 'Das Pummeleinhorn', interpret: '🩵Jojo 🩵' }).liste
  l = vormerken(l, { uri: EMMA, titel: 'Etwas', interpret: 'EMMA6' }).liste
  return l
}

describe('der Eintrag traegt, was seine Datei wiederfindet', () => {
  // Ohne Album, Album-Interpret und Nummer laesst sich der Pfad
  // <kategorie>/<albumInterpret>/<album>/<nn titel>.flac nicht bilden — und
  // dann findet `abgleichen` nichts und die Box nimmt ein zweites Mal auf.
  const voll = {
    uri: LUMPENPACK,
    titel: 'Die Zukunft wird gross',
    interpret: 'Das Lumpenpack, Gast',
    album: 'Alles Gute',
    albumInterpret: 'Das Lumpenpack',
    nummer: 7,
  }

  it('vormerken traegt Album, Album-Interpret und Nummer mit', () => {
    const e = vormerken(LISTE_LEER, voll).liste.eintraege[0]
    strictEqual(e.album, 'Alles Gute')
    strictEqual(e.albumInterpret, 'Das Lumpenpack')
    strictEqual(e.nummer, 7)
  })

  it('haelt Titel- und Album-Interpret auseinander', () => {
    // Der Ordner gehoert dem ALBUM. Waeren beide dasselbe Feld, entstuende je
    // Gast ein eigener Albumordner — der Fund vom 20.08.2026.
    const e = vormerken(LISTE_LEER, voll).liste.eintraege[0]
    strictEqual(e.interpret, 'Das Lumpenpack, Gast')
    strictEqual(e.albumInterpret, 'Das Lumpenpack')
  })

  it('eine fehlende Nummer ist null, nicht 0', () => {
    // 0 waere eine Luege: `spurname` machte daraus `00 Titel.flac` neben dem
    // spaeter richtig benannten `07 Titel.flac` — zwei Dateien fuer ein Stueck.
    for (const x of [undefined, null, 0, -3, 'sieben', {}]) {
      strictEqual(vormerken(LISTE_LEER, { ...voll, nummer: x }).liste.eintraege[0].nummer, null, String(x))
    }
  })

  it('haelt die Felder ueber das Einlesen hinweg', () => {
    const geschrieben = vormerken(LISTE_LEER, voll).liste
    const gelesen = listeAus(JSON.parse(JSON.stringify(geschrieben)))
    deepStrictEqual(gelesen.eintraege[0], geschrieben.eintraege[0])
  })
})

describe('Luecken werden gefuellt, Vorhandenes nie ueberschrieben', () => {
  // Von Hand bringt jemand oft nur eine Adresse mit. Spielt der Titel spaeter
  // einmal, sind die Angaben da — sie hier zu verwerfen hiesse, den Eintrag
  // dauerhaft unpruefbar zu lassen.
  const nurAdresse = { uri: JOJO }
  const vollstaendig = {
    uri: JOJO,
    titel: 'Das Pummeleinhorn',
    interpret: '🩵Jojo 🩵',
    album: 'Pummel und Freunde',
    albumInterpret: '🩵Jojo 🩵',
    nummer: 3,
  }

  it('traegt nach, was beim Anlegen noch fehlte', () => {
    const l = vormerken(LISTE_LEER, nurAdresse, 'hand').liste
    strictEqual(l.eintraege[0].album, '')
    const zweite = vormerken(l, vollstaendig)
    ok(zweite.ok, 'das Ergaenzen muss als Aenderung gelten')
    strictEqual(zweite.grund, 'stand schon da, Angaben ergaenzt')
    strictEqual(zweite.liste.eintraege[0].album, 'Pummel und Freunde')
    strictEqual(zweite.liste.eintraege[0].nummer, 3)
  })

  it('laesst die Herkunft „hand" dabei unangetastet', () => {
    // Das Ergaenzen darf die Rangfolge nicht heimlich senken.
    const l = vormerken(LISTE_LEER, nurAdresse, 'hand').liste
    const zweite = vormerken(l, vollstaendig, 'automatisch')
    strictEqual(zweite.liste.eintraege[0].herkunft, 'hand')
  })

  it('ueberschreibt einen vorhandenen Wert NICHT', () => {
    const l = vormerken(LISTE_LEER, vollstaendig).liste
    const zweite = vormerken(l, { ...vollstaendig, album: 'Etwas ganz anderes', nummer: 99 })
    strictEqual(zweite.ok, false, 'nichts zu tun ist nichts zu tun')
    strictEqual(zweite.grund, 'steht schon in der Liste')
    strictEqual(zweite.liste.eintraege[0].album, 'Pummel und Freunde')
    strictEqual(zweite.liste.eintraege[0].nummer, 3)
  })
})

describe('einordnen — die Schwelle aus E73', () => {
  it('unter 30 s ist Blaettern: kein Vorrang', () => {
    strictEqual(einordnen(5).vorrang, false)
    strictEqual(einordnen(SCHWELLE_SEK - 1).vorrang, false)
  })

  it('ab 30 s wurde gehoert: Vorrang', () => {
    strictEqual(einordnen(SCHWELLE_SEK).vorrang, true)
    strictEqual(einordnen(600).vorrang, true)
  })

  it('vertraegt Unsinn, ohne Vorrang zu erfinden', () => {
    for (const x of [null, undefined, -5, 'lang', {}]) {
      strictEqual(einordnen(x).vorrang, false, String(x))
    }
  })
})

describe('FALL 1: die Platte widerspricht der Liste', () => {
  it('was schon liegt, wird fertig — ohne es noch einmal aufzunehmen', () => {
    // Die Liste weiss nur, was SIE aufgenommen hat. Ist sie neu oder verloren,
    // gilt jeder Titel wieder als offen — und die Box zahlt die Investition
    // ein zweites Mal.
    const { liste, erledigt } = abgleichen(mitDreien(), (e) => e.uri === JOJO)
    deepStrictEqual(erledigt, [JOJO])
    const j = liste.eintraege.find((e) => e.uri === JOJO)
    strictEqual(j.zustand, 'fertig')
    ok(j.grund.includes('Platte'), j.grund)
  })

  it('und wird danach nicht mehr als naechster angeboten', () => {
    let l = mitDreien()
    l = abgleichen(l, (e) => e.uri === LUMPENPACK).liste
    strictEqual(naechster(l)?.uri, JOJO)
  })

  it('EINE PRUEFUNG, DIE WIRFT, HEISST NICHT „liegt nicht vor"', () => {
    // Sie heisst „unbekannt" — und bei unbekannt bleibt der Eintrag stehen,
    // statt stillschweigend erledigt zu werden.
    const { liste, erledigt } = abgleichen(mitDreien(), () => {
      throw new Error('Platte weg')
    })
    deepStrictEqual(erledigt, [])
    strictEqual(liste.eintraege.every((e) => e.zustand === 'offen'), true)
  })

  it('ohne Pruefung aendert sich nichts', () => {
    const l = mitDreien()
    deepStrictEqual(abgleichen(l, undefined).liste, l)
  })
})

describe('die drei Stufen der Reihenfolge (E73)', () => {
  it('von Hand Nachgelegtes zuerst', () => {
    let l = mitDreien()
    l = vormerken(l, { uri: EMMA }, 'hand').liste
    strictEqual(naechster(l)?.uri, EMMA)
  })

  it('dann, was ueber der Schwelle gehoert wurde', () => {
    let l = mitDreien()
    l = vormerken(l, { uri: JOJO }, 'automatisch', true).liste
    strictEqual(naechster(l)?.uri, JOJO, 'vor dem ersten der Liste')
  })

  it('Hand schlaegt Vorrang', () => {
    let l = mitDreien()
    l = vormerken(l, { uri: JOJO }, 'automatisch', true).liste
    l = vormerken(l, { uri: EMMA }, 'hand').liste
    strictEqual(naechster(l)?.uri, EMMA)
  })

  it('sonst der Reihe nach', () => {
    strictEqual(naechster(mitDreien())?.uri, LUMPENPACK)
  })

  it('uebergeht, was gerade laeuft', () => {
    const l = beginnen(mitDreien(), LUMPENPACK).liste
    strictEqual(naechster(l)?.uri, JOJO)
  })
})

describe('vormerken hebt nur nach OBEN', () => {
  it('ein vorhandener Eintrag bekommt Vorrang dazu', () => {
    let l = vormerken(LISTE_LEER, { uri: JOJO }).liste
    const e = vormerken(l, { uri: JOJO }, 'automatisch', true)
    strictEqual(e.ok, true)
    strictEqual(e.liste.eintraege[0].vorrang, true)
    strictEqual(e.liste.eintraege.length, 1, 'aber kein zweiter Eintrag')
  })

  it('Vorrang faellt NICHT zurueck', () => {
    // Was schon dringlich war, faellt nicht durch einen nebenbei angespielten
    // Titel wieder nach hinten.
    let l = vormerken(LISTE_LEER, { uri: JOJO }, 'automatisch', true).liste
    l = vormerken(l, { uri: JOJO }, 'automatisch', false).liste
    strictEqual(l.eintraege[0].vorrang, true)
  })

  it('Hand faellt NICHT zurueck', () => {
    let l = vormerken(LISTE_LEER, { uri: JOJO }, 'hand').liste
    l = vormerken(l, { uri: JOJO }, 'automatisch').liste
    strictEqual(l.eintraege[0].herkunft, 'hand')
  })

  it('FALL 4: ein fertiger Titel wird nicht erneut vorgemerkt', () => {
    let l = abschliessen(vormerken(LISTE_LEER, { uri: LUMPENPACK }).liste, LUMPENPACK).liste
    const e = vormerken(l, { uri: LUMPENPACK })
    strictEqual(e.ok, false)
    strictEqual(e.liste.eintraege[0].zustand, 'fertig')
  })
})

describe('FALL 2: der Strom faellt mitten in der Aufnahme', () => {
  it('ein Eintrag auf laeuft wird beim Laden wieder offen', () => {
    const l = listeAus({ eintraege: [{ uri: LUMPENPACK, zustand: 'laeuft', versuche: 1 }] })
    strictEqual(l.eintraege[0].zustand, 'offen')
    strictEqual(l.eintraege[0].versuche, 1, 'der Versuch zaehlt weiter')
  })

  it('der Versuch zaehlt beim BEGINN, nicht am Ende', () => {
    const l = beginnen(vormerken(LISTE_LEER, { uri: LUMPENPACK }).liste, LUMPENPACK).liste
    strictEqual(l.eintraege[0].versuche, 1)
  })
})

describe('FALL 3: ein Titel, den Spotify nicht mehr hergibt', () => {
  it('kommt zurueck, solange Versuche uebrig sind', () => {
    let l = beginnen(vormerken(LISTE_LEER, { uri: LUMPENPACK }).liste, LUMPENPACK).liste
    l = scheitern(l, LUMPENPACK, 'Netz weg').liste
    strictEqual(l.eintraege[0].zustand, 'offen')
    strictEqual(l.eintraege[0].grund, 'Netz weg')
  })

  it('bleibt nach dem letzten Versuch liegen — sichtbar, mit Grund', () => {
    let l = vormerken(LISTE_LEER, { uri: LUMPENPACK }).liste
    for (let i = 0; i < HOECHSTENS_VERSUCHE; i++) {
      l = scheitern(beginnen(l, LUMPENPACK).liste, LUMPENPACK, 'gibt es nicht mehr').liste
    }
    strictEqual(l.eintraege[0].zustand, 'fehler')
    strictEqual(naechster(l), null, 'er haelt die Liste nicht mehr auf')
    strictEqual(l.eintraege.length, 1, 'weggeworfen wird er trotzdem nicht')
  })

  it('zuruecksetzen gibt ihm neue Anlaeufe', () => {
    let l = vormerken(LISTE_LEER, { uri: LUMPENPACK }).liste
    for (let i = 0; i < HOECHSTENS_VERSUCHE; i++) {
      l = scheitern(beginnen(l, LUMPENPACK).liste, LUMPENPACK, 'weg').liste
    }
    l = zuruecksetzen(l, LUMPENPACK).liste
    strictEqual(l.eintraege[0].zustand, 'offen')
    strictEqual(l.eintraege[0].versuche, 0)
  })

  it('ein unbekannter Titel aendert nichts und sagt es', () => {
    const l = mitDreien()
    for (const f of [beginnen, abschliessen, zuruecksetzen, entfernen]) {
      strictEqual(f(l, 'spotify:track:GIBTESNICHT').ok, false, f.name)
    }
  })
})

describe('Einlesen und Zaehlen', () => {
  it('nimmt nur an, was der Mitschnitt abspielen kann', () => {
    strictEqual(istTitelUri(LUMPENPACK), true)
    for (const x of ['spotify:album:0PyuOAMz1lv0z737JcQNOg', 'spotify:track:', '', null, 42]) {
      strictEqual(istTitelUri(x), false, String(x))
    }
  })

  it('weist einen Eintrag ohne brauchbare Adresse ab', () => {
    strictEqual(eintragAus({ titel: 'Ohne Adresse' }), null)
    strictEqual(eintragAus({ uri: 'spotify:album:x' }), null)
  })

  it('haelt denselben Titel nur einmal', () => {
    const l = listeAus({ eintraege: [{ uri: JOJO, titel: 'erst' }, { uri: JOJO, titel: 'zweit' }] })
    strictEqual(l.eintraege.length, 1)
    strictEqual(l.eintraege[0].titel, 'erst')
  })

  it('ueberlebt Muell, ohne etwas zu erfinden', () => {
    for (const x of [null, undefined, 42, 'text', {}, { eintraege: 'nein' }]) {
      deepStrictEqual(listeAus(x), LISTE_LEER)
    }
  })

  it('erfindet keinen Zustand und keinen Vorrang', () => {
    const l = listeAus({ eintraege: [{ uri: EMMA, zustand: 'zauberei', vorrang: 'ja' }] })
    strictEqual(l.eintraege[0].zustand, 'offen')
    strictEqual(l.eintraege[0].vorrang, false, 'nur ein echtes true zaehlt')
  })

  it('zaehlt, was die Verwaltung oben zeigt', () => {
    let l = abschliessen(mitDreien(), LUMPENPACK).liste
    l = beginnen(l, JOJO).liste
    deepStrictEqual(stand(l), { offen: 1, laeuft: 1, fertig: 1, fehler: 0 })
  })

  it('entfernen ist der einzige Weg, auf dem etwas verschwindet', () => {
    const e = entfernen(mitDreien(), JOJO)
    strictEqual(e.ok, true)
    strictEqual(e.liste.eintraege.length, 2)
  })
})

describe('zuruecklegen — Verdraengung ist kein Fehlschlag (E74/4)', () => {
  function begonnen() {
    let l = vormerken(LISTE_LEER, { uri: LUMPENPACK, titel: 'Ein Titel' }).liste
    return beginnen(l, LUMPENPACK).liste
  }

  it('legt den Titel zurueck auf offen', () => {
    const l = zuruecklegen(begonnen(), LUMPENPACK).liste
    strictEqual(l.eintraege[0].zustand, 'offen')
  })

  it('NIMMT DEN VERSUCH ZURUECK, den der Beginn gezaehlt hat', () => {
    // Sonst waeren nach drei Kindern, die zwischendurch Musik anmachen, drei
    // Versuche verbraucht — und der Titel laege auf `fehler`, ohne dass je
    // etwas an ihm falsch war. Je beliebter die Box, desto kaputter die Liste.
    const vorher = begonnen()
    strictEqual(vorher.eintraege[0].versuche, 1)
    strictEqual(zuruecklegen(vorher, LUMPENPACK).liste.eintraege[0].versuche, 0)
  })

  it('vergisst aber NICHT die echten frueheren Fehlschlaege', () => {
    // Der Unterschied zu `zuruecksetzen`: hier geht genau EIN Versuch zurueck.
    let l = vormerken(LISTE_LEER, { uri: LUMPENPACK, titel: 'Ein Titel' }).liste
    l = beginnen(l, LUMPENPACK).liste
    l = scheitern(l, LUMPENPACK, 'ging nicht').liste
    l = beginnen(l, LUMPENPACK).liste
    strictEqual(l.eintraege[0].versuche, 2)
    strictEqual(zuruecklegen(l, LUMPENPACK).liste.eintraege[0].versuche, 1, 'nur der laufende Versuch faellt weg')
  })

  it('faellt nie unter null', () => {
    const l = vormerken(LISTE_LEER, { uri: LUMPENPACK, titel: 'Ein Titel' }).liste
    strictEqual(zuruecklegen(l, LUMPENPACK).liste.eintraege[0].versuche, 0)
  })
})
