import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FELDER } from './konfiguration.js'
import { type Lage, anbieterLage } from './streaming.js'

function lage(teil: Partial<Record<string, unknown>> = {}, angemeldet = false): Lage {
  return { konfig: teil, spotifyAngemeldet: angemeldet }
}

describe('anbieterLage — welcher Anbieter ist eingerichtet', () => {
  it('nennt eine leere Box bei allen vier Anbietern beim Namen', () => {
    const a = anbieterLage(lage())
    assert.deepEqual(
      a.map((x) => x.id),
      ['spotify', 'jellyfin', 'ardsounds', 'deezer'],
    )
    assert.equal(a[0].stand, 'aus')
    assert.equal(a[1].stand, 'aus')
    // ARD Sounds haengt NICHT an der Konfiguration: die Audiothek braucht
    // keinen Schluessel, also ist die leere Box dort genauso bereit wie eine
    // eingerichtete. Deezer bleibt „geplant" — dafuer gibt es keinen Code.
    assert.equal(a[2].stand, 'bereit')
    assert.equal(a[3].stand, 'geplant')
  })

  /**
   * DIE FALLE, GEGEN DIE DIESER FALL STEHT (04.08.2026): Die Seite meldete
   * ARD Sounds als „noch nicht gebaut", waehrend `ard.ts`, die damalige
   * Kernroute `/api/ard/suche` (mit E77 gefallen, heute im Plugin) und die
   * Verben `ard`/`ardqueue` laengst da waren. Der Stand eines
   * Anbieters ist die einzige Stelle, an der ein Benutzer NACHSEHEN kann, was
   * die Box kann — steht er falsch, sucht niemand weiter.
   */
  it('meldet ARD Sounds unabhaengig von jeder Einstellung als bereit', () => {
    const leer = anbieterLage(lage())
    const voll = anbieterLage(lage({ spotify: { clientId: 'x' }, jellyfin: { server: 'http://x', apiKey: 'y' } }, true))
    for (const a of [leer, voll]) {
      const ard = a.find((x) => x.id === 'ardsounds')
      assert.ok(ard, 'ARD Sounds fehlt in der Anbieterliste')
      assert.equal(ard.stand, 'bereit')
      // BIS E76 stand hier `felder.length === 0` — die Audiothek braucht
      // keinen Schluessel. Das stimmt weiter; das EINE Feld, das seither da
      // ist, ist der Aktiv-Schalter, und der gehoert zu jedem Anbieter.
      assert.deepEqual(ard.felder, ['ardAktiv'])
    }
  })

  it('unterscheidet „Client-ID da, aber niemand angemeldet" von „bereit"', () => {
    const ohne = anbieterLage(lage({ spotify: { clientId: 'abc' } }, false))
    assert.equal(ohne[0].stand, 'unvollstaendig')
    const mit = anbieterLage(lage({ spotify: { clientId: 'abc' } }, true))
    assert.equal(mit[0].stand, 'bereit')
  })

  it('sagt bei Jellyfin, WELCHE Haelfte fehlt', () => {
    const nurServer = anbieterLage(lage({ jellyfin: { server: 'http://x:8096', apiKey: '' } }))
    assert.equal(nurServer[1].stand, 'unvollstaendig')
    assert.match(nurServer[1].warum, /kein API-Schlüssel/)

    const nurSchluessel = anbieterLage(lage({ jellyfin: { server: '', apiKey: 'geheim' } }))
    assert.equal(nurSchluessel[1].stand, 'unvollstaendig')
    assert.match(nurSchluessel[1].warum, /keine Server-Adresse/)
  })

  it('meldet Jellyfin erst bereit, wenn beides dasteht', () => {
    const a = anbieterLage(lage({ jellyfin: { server: 'http://x:8096', apiKey: 'geheim' } }))
    assert.equal(a[1].stand, 'bereit')
  })

  it('laesst sich von Leerzeichen nicht taeuschen', () => {
    const a = anbieterLage(lage({ jellyfin: { server: '   ', apiKey: '  ' } }))
    assert.equal(a[1].stand, 'aus')
  })

  it('gibt zu JEDEM Anbieter einen Grund an — auch bei „bereit"', () => {
    for (const a of anbieterLage(lage({ spotify: { clientId: 'x' } }, true))) {
      assert.ok(a.warum.length > 10, `${a.id} ohne Begruendung`)
    }
  })

  /**
   * DIE FALLE, die diesen Test noetig macht: die Anbieterseite zeigt die
   * Felder, die sie in `felder` nennt. Ein Tippfehler dort ergibt keinen
   * Fehler, sondern ein Feld, das schlicht nicht erscheint — genau die
   * Sorte stiller Ausfall, die im Board schon einmal einen Nachmittag
   * gekostet hat.
   */
  it('nennt nur Feldkennungen, die es in FELDER wirklich gibt', () => {
    const bekannt = new Set(FELDER.map((f) => f.id))
    for (const a of anbieterLage(lage())) {
      for (const id of a.felder) {
        assert.ok(bekannt.has(id), `Anbieter ${a.id} nennt unbekanntes Feld ${id}`)
      }
    }
  })

  /**
   * Die Gegenrichtung: jedes Feld im Bereich 'streaming' muss bei GENAU einem
   * Anbieter auftauchen. Sonst waere es auf keiner Seite mehr zu sehen —
   * die Konfigurationsseite zeigt diesen Bereich ja absichtlich nicht.
   */
  it('laesst kein Streaming-Feld ohne Anbieter zurueck', () => {
    const zugeteilt = new Set(anbieterLage(lage()).flatMap((a) => a.felder))
    for (const f of FELDER.filter((x) => x.bereich === 'streaming')) {
      assert.ok(zugeteilt.has(f.id), `Feld ${f.id} steht im Bereich streaming, aber bei keinem Anbieter`)
    }
  })
})

/*
 * HIER STAND `describe('zusammenfassung')` mit zwei Faellen. Beide sind mit
 * der Funktion gegangen (03.08.2026, siehe streaming.ts): sie war ihr
 * einziger Anrufer. Ein Test, der nur beweist, dass eine Funktion sich selbst
 * gegenueber gleich bleibt, haelt eine tote Stelle am Leben — und liest sich
 * beim naechsten Mal wie Deckung.
 *
 * WAS BLEIBT, ist die Aussage darunter, und die ist hier weiter geprueft: der
 * STAND je Anbieter (bereit / unvollstaendig / aus / geplant). Aus ihm liesse
 * sich jede Zaehlung jederzeit wieder bilden.
 */

describe('der Aktiv-Schalter schlaegt jeden anderen Stand (E76)', () => {
  const eingerichtet = {
    spotify: { clientId: 'abc' },
    jellyfin: { server: 'http://s:8096', apiKey: 'k' },
  }

  it('abgeschaltet, obwohl fertig eingerichtet — der Schalter gewinnt', () => {
    const a = anbieterLage({
      konfig: { ...eingerichtet, spotify: { clientId: 'abc', aktiv: false } },
      spotifyAngemeldet: true,
    })
    const spotify = a.find((x) => x.id === 'spotify')
    assert.equal(spotify?.stand, 'abgeschaltet')
    assert.match(spotify?.warum ?? '', /rückgängig/)
  })

  it('abgeschaltet ist NICHT aus — die Unterscheidung bleibt', () => {
    // „aus" heisst „nie eingerichtet". Ein abgeschaltetes Jellyfin mit Server
    // und Schluessel darf nicht so aussehen, als waere nichts da.
    const a = anbieterLage({
      konfig: { ...eingerichtet, jellyfin: { server: 'http://s:8096', apiKey: 'k', aktiv: false } },
      spotifyAngemeldet: true,
    })
    assert.equal(a.find((x) => x.id === 'jellyfin')?.stand, 'abgeschaltet')
    // und ein NIE eingerichtetes Jellyfin bleibt „aus":
    const b = anbieterLage({ konfig: { spotify: { clientId: 'abc' } }, spotifyAngemeldet: true })
    assert.equal(b.find((x) => x.id === 'jellyfin')?.stand, 'aus')
  })

  it('auch ARD laesst sich abschalten — und traegt jetzt ein Feld', () => {
    const a = anbieterLage({ konfig: { ard: { aktiv: false } }, spotifyAngemeldet: false })
    const ard = a.find((x) => x.id === 'ardsounds')
    assert.equal(ard?.stand, 'abgeschaltet')
    assert.deepEqual(ard?.felder, ['ardAktiv'])
  })

  it('der Schalter steht in JEDEM Zustand vorn in den Feldern — der Rueckweg', () => {
    // Eine Karte, die im Aus-Zustand ihre Felder versteckte, haette keinen
    // Weg zurueck.
    const a = anbieterLage({ konfig: eingerichtet, spotifyAngemeldet: true })
    assert.equal(a.find((x) => x.id === 'spotify')?.felder[0], 'spotifyAktiv')
    assert.equal(a.find((x) => x.id === 'jellyfin')?.felder[0], 'jellyfinAktiv')
    assert.equal(a.find((x) => x.id === 'ardsounds')?.felder[0], 'ardAktiv')
  })

  it('ohne Schalter in der Konfiguration ist alles an — Bestandsboxen', () => {
    const a = anbieterLage({ konfig: eingerichtet, spotifyAngemeldet: true })
    assert.ok(a.every((x) => x.stand !== 'abgeschaltet'))
  })

  it('Deezer kennt keinen Schalter — geplant bleibt geplant', () => {
    const a = anbieterLage({ konfig: { deezer: { aktiv: false } }, spotifyAngemeldet: false })
    assert.equal(a.find((x) => x.id === 'deezer')?.stand, 'geplant')
  })
})
