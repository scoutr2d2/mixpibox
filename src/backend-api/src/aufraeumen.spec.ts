import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type Ergebnis,
  LAEUFE_NOETIG,
  laufBrauchbar,
  standFortschreiben,
  type Verfuegbarkeitsstand,
  vorschlaegeBilden,
  WARTEZEIT_MS,
} from './aufraeumen'

const T0 = Date.UTC(2026, 7, 1, 12, 0, 0)
const TAG = 24 * 60 * 60 * 1000

/** Ein Lauf aus n `traegt` und den genannten toten Kennungen. */
function lauf(lebende: number, tote: string[] = [], unklare: string[] = []): Ergebnis[] {
  const raus: Ergebnis[] = []
  for (let i = 0; i < lebende; i++) raus.push({ id: `lebt${i}`, stand: 'traegt' })
  for (const t of tote) raus.push({ id: t, stand: 'geloescht' })
  for (const u of unklare) raus.push({ id: u, stand: 'unklar' })
  return raus
}

/** Den Zustand nach `n` gleichen brauchbaren Laeufen bilden. */
function nachLaeufen(n: number, ergebnisse: Ergebnis[], startZeit = T0, schritt = TAG): Verfuegbarkeitsstand {
  let stand: Verfuegbarkeitsstand = {}
  for (let i = 0; i < n; i++) {
    assert.equal(laufBrauchbar(ergebnisse).brauchbar, true, 'Vorbedingung: der Lauf muss brauchbar sein')
    stand = standFortschreiben(stand, ergebnisse, startZeit + i * schritt)
  }
  return stand
}

describe('laufBrauchbar', () => {
  it('ein Netzausfall (alles unklar) taugt NICHT', () => {
    // Der wichtigste Fall ueberhaupt: ohne ein einziges Lebenszeichen ist
    // nicht belegt, dass Netz und Token in diesem Lauf funktioniert haben.
    const urteil = laufBrauchbar(lauf(0, [], ['a', 'b', 'c', 'd']))
    assert.equal(urteil.brauchbar, false)
    assert.match(urteil.grund, /kein Netz|Token|drosselt/i)
  })

  it('ein Lauf ohne jedes Lebenszeichen taugt auch dann nicht, wenn alle tot melden', () => {
    // Sonst wuerde ein Konto ohne Rechte die ganze Mediathek zum Loeschen
    // anbieten - jede Antwort waere ein 404.
    assert.equal(laufBrauchbar(lauf(0, ['a', 'b', 'c'])).brauchbar, false)
  })

  it('leerer Lauf taugt nicht', () => {
    assert.equal(laufBrauchbar([]).brauchbar, false)
  })

  it('Drosselung mitten im Lauf: zu wenig Eindeutiges', () => {
    // 2 von 10 haben geantwortet, der Rest lief in 429. Die zwei Antworten
    // stimmen, das Bild nicht - und der Bestaetigungszaehler duerfte davon
    // nicht hochlaufen.
    const urteil = laufBrauchbar(lauf(1, ['tot'], ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8']))
    assert.equal(urteil.brauchbar, false)
    assert.match(urteil.grund, /eindeutig/i)
  })

  it('8 von 9 geloescht: der Lauf wird VERWORFEN, nicht geglaubt', () => {
    const urteil = laufBrauchbar(lauf(1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']))
    assert.equal(urteil.brauchbar, false)
    assert.match(urteil.grund, /zu viel auf einmal/i)
  })

  it('1 von 9 geloescht: brauchbar', () => {
    const urteil = laufBrauchbar(lauf(8, ['tot']))
    assert.equal(urteil.brauchbar, true)
    assert.match(urteil.grund, /9 von 9 eindeutig, davon 1 geloescht/)
  })
})

describe('standFortschreiben', () => {
  it('zaehlt je Lauf einmal hoch und merkt sich den ersten Zeitpunkt', () => {
    const eins = standFortschreiben({}, lauf(8, ['tot']), T0)
    assert.deepEqual(eins, { tot: { seit: T0, laeufe: 1 } })
    const zwei = standFortschreiben(eins, lauf(8, ['tot']), T0 + TAG)
    assert.deepEqual(zwei, { tot: { seit: T0, laeufe: 2 } })
  })

  it('unklar laesst Zaehler UND Zeitpunkt unberuehrt', () => {
    const eins = standFortschreiben({}, lauf(8, ['tot']), T0)
    const zwei = standFortschreiben(eins, lauf(8, [], ['tot']), T0 + TAG)
    assert.deepEqual(zwei, { tot: { seit: T0, laeufe: 1 } })
  })

  it('ein einziges traegt setzt alles zurueck', () => {
    // Ein Eintrag, der zurueckkommt (neu verknuepft, Sperre aufgehoben),
    // faengt bei null an - sonst waere er nach einem weiteren toten Lauf
    // sofort wieder reif.
    let stand = nachLaeufen(2, lauf(8, ['tot']))
    stand = standFortschreiben(stand, [...lauf(8), { id: 'tot', stand: 'traegt' }], T0 + 2 * TAG)
    assert.deepEqual(stand, {})
    stand = standFortschreiben(stand, lauf(8, ['tot']), T0 + 3 * TAG)
    assert.deepEqual(stand, { tot: { seit: T0 + 3 * TAG, laeufe: 1 } })
  })

  it('ein VERWORFENER Lauf kennzeichnet weiter, zaehlt aber nicht', () => {
    // DIE TRENNUNG, um die es geht: Ausgrauen nimmt der naechste Lauf zurueck,
    // Loeschen niemand. Auf einer Box mit ZWEI Spotify-Eintraegen, von denen
    // einer verschwindet, ist geloescht/eindeutig genau 0,5 — der Lauf wird
    // also immer verworfen. Ohne die Kennzeichnung bliebe die tote Kachel fuer
    // immer normal aussehen, und ein Kind tippt ins Leere.
    const zwei: Ergebnis[] = [
      { id: 'lebt', stand: 'traegt' },
      { id: 'tot', stand: 'geloescht' },
    ]
    assert.equal(laufBrauchbar(zwei).brauchbar, false, 'Vorbedingung: dieser Lauf zaehlt nicht')

    const stand = standFortschreiben({}, zwei, T0, false)
    // gekennzeichnet: die Kennung steht drin ...
    assert.deepEqual(Object.keys(stand), ['tot'])
    // ... aber der Bestaetigungszaehler bleibt bei null, es reift also nichts.
    assert.equal(stand.tot.laeufe, 0)
    assert.deepEqual(vorschlaegeBilden([{ schluessel: 'spotify:tot', kennung: 'tot' }], stand, T0 + 30 * TAG), [])
  })

  it('ein traegt nimmt die Kennzeichnung auch im verworfenen Lauf zurueck', () => {
    let stand = nachLaeufen(2, lauf(8, ['tot']))
    stand = standFortschreiben(stand, [{ id: 'tot', stand: 'traegt' }], T0 + 2 * TAG, false)
    assert.deepEqual(stand, {})
  })

  it('dieselbe Kennung zweimal in der Mediathek zaehlt trotzdem nur einmal', () => {
    const doppelt: Ergebnis[] = [...lauf(8), { id: 'tot', stand: 'geloescht' }, { id: 'tot', stand: 'geloescht' }]
    assert.deepEqual(standFortschreiben({}, doppelt, T0), { tot: { seit: T0, laeufe: 1 } })
  })
})

describe('vorschlaegeBilden', () => {
  const kandidat = { schluessel: 'spotify:tot', kennung: 'tot', titel: 'Die drei ???', interpret: 'Europa' }

  it('UNKLAR wird NIEMALS angeboten', () => {
    // DIE Bedingung dieser Arbeit. Ein Netzausfall, ein abgelaufener Token
    // oder Spotifys Drosselung liefern lauter `unklar` - daraus darf nie ein
    // Loeschangebot werden. Weder ein einzelner unklarer Lauf noch beliebig
    // viele hintereinander bringen einen Eintrag in die Liste.
    let stand: Verfuegbarkeitsstand = {}
    for (let i = 0; i < 10; i++) {
      const nurUnklar = lauf(0, [], ['tot'])
      // Erst gar nicht fortschreiben - der Lauf taugt nichts.
      assert.equal(laufBrauchbar(nurUnklar).brauchbar, false)
      stand = standFortschreiben(stand, nurUnklar, T0 + i * TAG)
    }
    assert.deepEqual(stand, {}, 'unklar nimmt nichts auf')
    assert.deepEqual(vorschlaegeBilden([kandidat], stand, T0 + 30 * TAG), [])
  })

  it('ein unklarer Lauf FRIERT einen halbfertigen Zaehler ein, statt ihn zu fuellen', () => {
    // Der heimtueckische Fall: der Eintrag ist schon zweimal tot gemeldet
    // worden. Ein Netzausfall darf den dritten Lauf nicht ersetzen.
    let stand = nachLaeufen(2, lauf(8, ['tot']))
    for (let i = 0; i < 5; i++) stand = standFortschreiben(stand, lauf(8, [], ['tot']), T0 + (3 + i) * TAG)
    assert.equal(stand.tot.laeufe, 2)
    assert.deepEqual(vorschlaegeBilden([kandidat], stand, T0 + 30 * TAG), [])
  })

  it('erst nach drei Laeufen UND einem Tag', () => {
    const zwei = nachLaeufen(2, lauf(8, ['tot']))
    assert.deepEqual(vorschlaegeBilden([kandidat], zwei, T0 + 5 * TAG), [], 'zwei Laeufe genuegen nicht')

    // Drei Laeufe, aber alle in derselben Stunde (dreimal auf "jetzt pruefen"
    // gedrueckt): die Wartezeit ist die zweite, unabhaengige Huerde.
    const schnell = nachLaeufen(LAEUFE_NOETIG, lauf(8, ['tot']), T0, 60 * 1000)
    assert.equal(schnell.tot.laeufe, LAEUFE_NOETIG)
    assert.deepEqual(vorschlaegeBilden([kandidat], schnell, T0 + 3 * 60 * 1000), [], 'zu frueh')

    const drei = nachLaeufen(LAEUFE_NOETIG, lauf(8, ['tot']))
    const raus = vorschlaegeBilden([kandidat], drei, T0 + WARTEZEIT_MS)
    assert.equal(raus.length, 1)
    assert.equal(raus[0].schluessel, 'spotify:tot')
    assert.equal(raus[0].titel, 'Die drei ???')
    assert.equal(raus[0].laeufe, LAEUFE_NOETIG)
    assert.equal(raus[0].seit, T0)
  })

  it('was nie geprueft wurde, steht nicht drin', () => {
    const drei = nachLaeufen(LAEUFE_NOETIG, lauf(8, ['tot']))
    const jellyfin = { schluessel: 'jellyfin:abc', kennung: 'abc' }
    const raus = vorschlaegeBilden([kandidat, jellyfin], drei, T0 + WARTEZEIT_MS)
    assert.deepEqual(
      raus.map((v) => v.schluessel),
      ['spotify:tot'],
    )
  })

  it('doppelter Schluessel wird EINMAL genannt und gekennzeichnet', () => {
    // findeIndex (medien.ts) gibt bei zwei gleichen Schluesseln -1 zurueck -
    // das Entfernen greift dann NICHT. Die Verwaltung muss das sagen, sonst
    // meldet sie "entfernt", waehrend der Eintrag noch dasteht.
    const drei = nachLaeufen(LAEUFE_NOETIG, lauf(8, ['tot']))
    const raus = vorschlaegeBilden([kandidat, { ...kandidat }], drei, T0 + WARTEZEIT_MS)
    assert.equal(raus.length, 1)
    assert.equal(raus[0].doppelt, true)
  })

  it('SCHLUESSEL und KENNUNG bleiben getrennt', () => {
    // medienSchluessel nimmt `id` vor `playlistid`, kennungVon umgekehrt. Wer
    // den einen aus dem anderen baut, entfernt den falschen Eintrag.
    const beides = { schluessel: 'spotify:album-id', kennung: 'playlist-id' }
    const drei = nachLaeufen(LAEUFE_NOETIG, lauf(8, ['playlist-id']))
    const raus = vorschlaegeBilden([beides], drei, T0 + WARTEZEIT_MS)
    assert.equal(raus[0].schluessel, 'spotify:album-id')
    assert.equal(raus[0].kennung, 'playlist-id')
  })
})
