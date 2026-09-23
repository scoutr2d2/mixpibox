import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bereitschaftUrteil, geraetWaehlen, warteschlangeUriErlaubt, webApiPfadErlaubt } from './spotify-web'

/**
 * Die Grenze der Web-API-Durchreiche.
 *
 * Sie traegt den Token der Box, also ist die Erlaubnisliste kein Beiwerk,
 * sondern die Sicherung. Hier steht sie fest.
 */
describe('Spotify-Durchreiche', () => {
  it('laesst genau das durch, was die Oberflaeche fragt', () => {
    // Die vollstaendige Liste dessen, was die Oberflaeche heute abfragt —
    // die Kennungen sind echte aus der Box, keine erfundenen.
    for (const p of [
      'me',
      'me/playlists',
      'me/albums',
      'me/shows',
      'playlists/6plWvrOIkNapJQzZnJKvkI',
      'playlists/6plWvrOIkNapJQzZnJKvkI/items',
      'playlists/6plWvrOIkNapJQzZnJKvkI/tracks',
      'albums/1DFixLWuPkv3KT3TnV35m3',
      'albums/1DFixLWuPkv3KT3TnV35m3/tracks',
      'shows/4rOoJ6Egrf8K2IrywzwOMk/episodes',
      'search',
      // Die Interpretenseite: Kopf, Diskografie und die beliebtesten Titel.
      // Die Kennung ist die echte aus der Sitzung (Alin Coen).
      'artists/352PojxBglNK0F7TBbCWJm',
      'artists/352PojxBglNK0F7TBbCWJm/albums',
      'artists/352PojxBglNK0F7TBbCWJm/top-tracks',
      // Die eine lesende Wiedergabe-Ausnahme: die Geraeteliste (die
      // Oberflaeche prueft damit, ob das librespot-Geraet der Box da ist).
      'me/player/devices',
    ]) {
      assert.equal(webApiPfadErlaubt(p), true, p)
    }
  })

  it('laesst die Wiedergabe-STEUERUNG nicht durch', () => {
    // Absicht: die geht aus dem Browser weiterhin direkt — sie ist der einzige
    // Teil, den Spotify dort noch beantwortet. Nur die lesende Geraeteliste
    // ist erlaubt (oben), Befehle nie.
    assert.equal(webApiPfadErlaubt('me/player'), false)
    assert.equal(webApiPfadErlaubt('me/player/play'), false)
    assert.equal(webApiPfadErlaubt('me/player/pause'), false)
    assert.equal(webApiPfadErlaubt('me/player/devices/x'), false)
  })

  it('laesst abgeschaltete und krumme Interpreten-Pfade draussen', () => {
    // `related-artists` hat Spotify am 2024-11-27 fuer neue Anwendungen
    // abgeschaltet — an der Box am 2026-08-02 mit HTTP 404 bestaetigt, an der
    // Erlaubnisliste vorbei gemessen. Stuende im allgemeinen Muster `[a-z-]+`,
    // kaeme er zusammen mit `top-tracks` durch, und die Oberflaeche baute eine
    // Reihe „Fans mögen auch", die immer leer bleibt.
    assert.equal(webApiPfadErlaubt('artists/352PojxBglNK0F7TBbCWJm/related-artists'), false)
    assert.equal(webApiPfadErlaubt('artists/352PojxBglNK0F7TBbCWJm/top-tracks/extra'), false)
    // Die neue Zeile ist ENGER als ihre Nachbarn: 22 Zeichen, sonst nichts.
    assert.equal(webApiPfadErlaubt('artists/kurz/top-tracks'), false)
    assert.equal(webApiPfadErlaubt('artists/../me/top-tracks'), false)
    assert.equal(webApiPfadErlaubt('artists/../me'), false)
  })

  it('laesst nichts Fremdes durch', () => {
    for (const p of ['', 'users/x/playlists', '../accounts', 'me/../users', 'me%2Fplayer']) {
      assert.equal(webApiPfadErlaubt(p), false, p)
    }
  })
})

describe('bereitschaftUrteil: der Fehlalarm ist teurer als die verpasste Warnung', () => {
  it('sagt Nein, wenn Spotify gar kein Geraet kennt', () => {
    // Der beobachtete Ausfall am 2026-08-02: librespot war bei einem fremden
    // Konto angemeldet, die eigene Liste blieb leer, und jeder Abspielbefehl
    // wurde mit 200 angenommen und verhallte.
    assert.deepEqual(bereitschaftUrteil([], 'MixPiBox'), { bereit: false, grund: 'keine-geraete' })
  })

  it('sagt Ja, wenn die Box in der Liste steht', () => {
    assert.deepEqual(bereitschaftUrteil([{ name: 'MixPiBox' }], 'MixPiBox'), { bereit: true })
  })

  it('sagt JA, wenn der Boxname unbekannt ist — auch wenn fremde Geraete da sind', () => {
    // Die erste Fassung las den Namen an der falschen Stelle, bekam den
    // Ersatzwert "MuPiBox" und meldete "nicht bereit", waehrend die Box
    // (MixPiBox) spielte. Ohne verlaesslichen Namen darf es kein Nein geben.
    assert.deepEqual(bereitschaftUrteil([{ name: 'Handy' }], ''), { bereit: true })
  })

  it('sagt Nein, wenn MEHRERE fremde Geraete da sind und die Box fehlt', () => {
    // Hier ist nicht zu entscheiden, welches die Box waere — und der
    // Abspieldienst entscheidet es seit diesem Umbau ebenfalls nicht.
    assert.deepEqual(bereitschaftUrteil([{ name: 'Handy' }, { name: 'Laptop' }], 'MixPiBox'), {
      bereit: false,
      grund: 'box-fehlt',
    })
  })

  it('sagt JA, wenn genau ein Geraet dasteht und nur der Name nicht passt', () => {
    // DER BEFUND DER GEGENPRUEFUNG: Boxname in der Verwaltung geaendert,
    // librespot nicht neu gestartet — es meldet sich bei Spotify weiter unter
    // dem ALTEN Namen. Die Box spielt, und der Waechter verbot es.
    assert.deepEqual(bereitschaftUrteil([{ name: 'MuPiBox' }], 'MixPiBox'), {
      bereit: true,
      grund: 'ersatzgeraet',
    })
  })
})

/**
 * Die Geraetewahl — DIESELBE Antwort fuer den Waechter und fuer den Dienst,
 * der wirklich spielt (spotify-control.ts `geraetAufloesen` ruft genau diese
 * Funktion). Zwei Meinungen ueber dieselbe Liste waren der Fehler.
 */
describe('geraetWaehlen: eine Wahl, zwei Verbraucher', () => {
  // ══ DER FALL VOM 12.08.2026 ═══════════════════════════════════════════
  // Ein fremdes Konto uebernahm librespot; in der Geraeteliste der Box blieb
  // nur die Soundbar. `ersatz` nahm sie unbesehen, und die Box schickte ihren
  // eigenen letzten Stand ins Wohnzimmer.
  it('nimmt ein einzelnes FREMDES Geraet NICHT als Ersatz', () => {
    const w = geraetWaehlen([{ name: 'Smart Soundbar 10158750', id: 'fremd' }], 'MixPiBox')
    assert.equal(w.wie, 'mehrdeutig')
    assert.equal(w.geraet, null)
  })

  // Die Regel soll aber weiter tun, wofuer sie da ist: eine Schreibweise
  // daneben darf nicht zum Verstummen fuehren.
  it('nimmt ein einzelnes Geraet mit abweichender SCHREIBWEISE als Ersatz', () => {
    for (const n of ['MixPi Box', 'mixpibox', 'MixPi-Box', 'MuPiBox']) {
      const w = geraetWaehlen([{ name: n, id: 'eigen' }], 'MixPiBox')
      assert.equal(w.wie, 'ersatz', `Name "${n}" sollte als dieselbe Box gelten`)
      assert.equal(w.geraet?.id, 'eigen')
    }
  })

  it('nimmt das Geraet mit dem Boxnamen, auch wenn es nicht vorn steht', () => {
    const w = geraetWaehlen(
      [
        { name: 'Handy', id: 'a' },
        { name: 'MixPiBox', id: 'b' },
      ],
      'MixPiBox',
    )
    assert.equal(w.wie, 'name')
    assert.equal(w.geraet?.id, 'b')
  })

  it('nimmt bei genau EINEM Geraet den alten Projektnamen an', () => {
    const w = geraetWaehlen([{ name: 'MuPiBox', id: 'alt' }], 'MixPiBox')
    assert.equal(w.wie, 'ersatz')
    assert.equal(w.geraet?.id, 'alt')
  })

  it('raet NICHT, wenn mehrere fremde Geraete dastehen', () => {
    // HIER STAND FRUEHER `geraete[0]`, und das war der Weg ins Nachbarzimmer:
    // steht das Telefon der Eltern vorn, spielt Spotify dort — die Box bleibt
    // still, und niemand versteht, warum.
    const w = geraetWaehlen(
      [
        { name: 'Handy', id: 'a' },
        { name: 'Laptop', id: 'c' },
      ],
      'MixPiBox',
    )
    assert.equal(w.wie, 'mehrdeutig')
    assert.equal(w.geraet, null)
  })

  it('nimmt ohne eigenen Namen das erste Geraet — und urteilt nicht', () => {
    // Ohne verlaesslichen Namen ist jede Strenge geraten. Genau das ging am
    // 2026-08-02 schief, als der Name aus der falschen Datei kam.
    const w = geraetWaehlen(
      [
        { name: 'Handy', id: 'a' },
        { name: 'Laptop', id: 'c' },
      ],
      '  ',
    )
    assert.equal(w.wie, 'ohne-namen')
    assert.equal(w.geraet?.id, 'a')
  })

  it('hat bei leerer Liste gar keine Wahl', () => {
    const w = geraetWaehlen([], 'MixPiBox')
    assert.equal(w.wie, 'keine-geraete')
    assert.equal(w.geraet, null)
  })

  it('stolpert nicht ueber Luecken in Spotifys Liste', () => {
    // Spotify liefert die Liste, nicht wir. Ein `null` darin darf nicht als
    // Geraet durchgehen — sonst faellt die Wahl auf etwas ohne Kennung und der
    // Abspielbefehl geht ins Leere.
    const w = geraetWaehlen([null as never, { name: 'MixPiBox', id: 'b' }], 'MixPiBox')
    assert.equal(w.wie, 'name')
    assert.equal(w.geraet?.id, 'b')
  })
})

/**
 * DIE WARTESCHLANGE — der einzige SCHREIBENDE Weg (BACKLOG E15/S3).
 *
 * Er entstand, damit die Oberflaeche keinen Spotify-Zugang mehr im Browser
 * braucht. Damit traegt er den Zugang der BOX, und die Erlaubnisregel ist
 * seine ganze Sicherung: neben jedem „darf" steht deshalb ein „darf nicht".
 */
describe('warteschlangeUriErlaubt', () => {
  it('nimmt Titel und Folgen — echte Kennungen, keine erfundenen', () => {
    assert.equal(warteschlangeUriErlaubt('spotify:track:4uLU6hMCjMI75M1A2tKUQC'), true)
    assert.equal(warteschlangeUriErlaubt('spotify:episode:512ojhOuo1ktJprKbVcKyQ'), true)
  })

  it('nimmt KEINE Sammlung — die Schnittstelle ist titelweise, alles andere ist Unfug', () => {
    assert.equal(warteschlangeUriErlaubt('spotify:album:2QqQXuDKNR8HK1cFxf0NhW'), false)
    assert.equal(warteschlangeUriErlaubt('spotify:playlist:2QqQXuDKNR8HK1cFxf0NhW'), false)
    assert.equal(warteschlangeUriErlaubt('spotify:user:andrea68'), false)
  })

  it('nimmt nichts, was nur so aussieht', () => {
    assert.equal(warteschlangeUriErlaubt('spotify:track:zu-kurz'), false)
    assert.equal(warteschlangeUriErlaubt('spotify:track:4uLU6hMCjMI75M1A2tKUQC extra'), false)
    assert.equal(warteschlangeUriErlaubt('https://api.spotify.com/v1/me/player/pause'), false)
    assert.equal(warteschlangeUriErlaubt(''), false)
    assert.equal(warteschlangeUriErlaubt(undefined), false)
    assert.equal(warteschlangeUriErlaubt(null), false)
    assert.equal(warteschlangeUriErlaubt(42), false)
  })
})
