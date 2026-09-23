// Tests für mpv-protokoll.ts.
//
// Diese Datei ist das Gegenstück zu mplayer-wrapper.spec.ts: dort steht, was
// der heutige Player TUT, hier, dass der Nachfolger dasselbe liefert. Wo das
// alte Verhalten fehlerhaft war (die beiden MACKE-Tests), wird hier bewusst
// das RICHTIGE geprüft — mit einem Verweis, damit niemand den Unterschied für
// ein Versehen hält.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  BEFEHLE,
  EIGENSCHAFTEN,
  RUECKWAERTS,
  anfrageZeile,
  darfGemeldetWerden,
  meldungLesen,
  metadatenUmsetzen,
  ohneTitel,
  wertUmsetzen,
} from './mpv-protokoll'

describe('Eigenschaftsnamen', () => {
  it('deckt genau die ab, die spotify-control abfragt', () => {
    // Aus src/spotify-control.ts: getProps([...]) und player.on(...).
    // Fehlt eine, bleibt das zugehörige Feld in currentMeta für immer leer —
    // ohne Absturz, ohne Meldung.
    for (const n of ['percent_pos', 'time_pos', 'length', 'pause', 'metadata', 'filename', 'path'])
      assert.ok(EIGENSCHAFTEN[n], `${n} fehlt`)
  })

  it('bildet in beide Richtungen ab', () => {
    assert.equal(EIGENSCHAFTEN.time_pos, 'time-pos')
    assert.equal(EIGENSCHAFTEN.length, 'duration')
    assert.equal(RUECKWAERTS['time-pos'], 'time_pos')
    assert.equal(RUECKWAERTS.duration, 'length')
  })
})

describe('Metadaten — die Stelle, an der es still gebrochen wäre', () => {
  it('macht aus mpvs kleinem title das erwartete Title', () => {
    // spotify-control liest val.Title (grosses T). mpv liefert je nach Format
    // title / TITLE / Title.
    assert.equal(metadatenUmsetzen({ title: 'Kapitel 1' }).Title, 'Kapitel 1')
    assert.equal(metadatenUmsetzen({ TITLE: 'Kapitel 1' }).Title, 'Kapitel 1')
    assert.equal(metadatenUmsetzen({ Title: 'Kapitel 1' }).Title, 'Kapitel 1')
  })

  it('setzt auch die übrigen Felder gross', () => {
    const m = metadatenUmsetzen({ artist: 'Die Drei', album: 'Folge 42', genre: 'Hörspiel' })
    assert.equal(m.Artist, 'Die Drei')
    assert.equal(m.Album, 'Folge 42')
    assert.equal(m.Genre, 'Hörspiel')
  })

  it('behält unbekannte Felder, statt sie wegzuwerfen', () => {
    assert.equal(metadatenUmsetzen({ composer: 'Wer' }).composer, 'Wer')
  })

  it('macht aus Zahlen Zeichenketten — wie es der alte Parser tat', () => {
    assert.equal(metadatenUmsetzen({ track: 3 }).Track, '3')
  })

  it('verträgt Unsinn ohne zu werfen', () => {
    for (const x of [null, undefined, 'text', 42, []])
      assert.deepEqual({ ...metadatenUmsetzen(x) }, {})
  })

  it('hat keinen Prototyp — wie beim alten Parser', () => {
    assert.equal(Object.getPrototypeOf(metadatenUmsetzen({ title: 'x' })), null)
  })
})

describe('Werte', () => {
  it('reicht Zahlen als Zahlen durch', () => {
    assert.equal(wertUmsetzen('time_pos', 12.5), 12.5)
    assert.equal(wertUmsetzen('length', 3600), 3600)
    assert.equal(wertUmsetzen('percent_pos', 37.4), 37.4)
  })

  it('liefert null statt NaN, wenn mpv nichts weiss', () => {
    // BEWUSST ANDERS ALS FRÜHER: der mplayer-Parser erzeugte NaN (siehe
    // parsers.spec.ts). NaN landete ungeprüft in currentMeta und wurde als
    // "NaN" angezeigt. null ist die ehrlichere Angabe.
    assert.equal(wertUmsetzen('time_pos', null), null)
    assert.equal(wertUmsetzen('length', undefined), null)
    assert.equal(wertUmsetzen('percent_pos', 'was?'), null)
  })

  it('gibt pause als echten Wahrheitswert', () => {
    // spotify-control rechnet playing = !val — ein 'yes' als Zeichenkette
    // wäre immer wahr und die Anzeige stünde dauerhaft auf pausiert.
    assert.equal(wertUmsetzen('pause', true), true)
    assert.equal(wertUmsetzen('pause', false), false)
    assert.equal(wertUmsetzen('pause', 'yes'), false)
  })

  it('gibt Namen und Pfad als Zeichenkette oder null', () => {
    // filename wird mit .split('.mp3') weiterverarbeitet, path mit
    // .split('/')[7] — beides wirft bei null nicht, bei einer Zahl schon.
    assert.equal(wertUmsetzen('filename', 'lied.mp3'), 'lied.mp3')
    assert.equal(wertUmsetzen('path', '/media/a/b.mp3'), '/media/a/b.mp3')
    assert.equal(wertUmsetzen('filename', 42), null)
  })
})

describe('Befehle — hier sterben die zwei alten Fehler', () => {
  it('legt den Pfad als eigenes Element ab, nicht in eine Befehlszeile', () => {
    assert.deepEqual(BEFEHLE.play('/media/lied.mp3'), ['loadfile', '/media/lied.mp3', 'replace'])
  })

  it('ein Leerzeichen im Pfad braucht keine Anführungszeichen', () => {
    assert.deepEqual(BEFEHLE.play('/media/Die Drei/Folge 1.mp3'), [
      'loadfile',
      '/media/Die Drei/Folge 1.mp3',
      'replace',
    ])
  })

  it('%20 bleibt %20 — kein Dekodieren (alter Fehler 1)', () => {
    // Früher: die Anführungszeichen-Entscheidung fiel VOR decodeURIComponent,
    // der Pfad wuchs sich danach ein Leerzeichen an und mplayer sah zwei
    // Argumente. Siehe MACKE-Test in mplayer-wrapper.spec.ts.
    const b = BEFEHLE.play('http://strom.example/Folge%201.mp3')
    assert.equal(b[1], 'http://strom.example/Folge%201.mp3')
  })

  it('ein einzelnes Prozentzeichen wirft nicht mehr (alter Fehler 2)', () => {
    // Früher URIError aus play() heraus, weil decodeURIComponent über die
    // ganze Zeile lief. Ein Dateiname ist kein URI.
    assert.doesNotThrow(() => BEFEHLE.play('/media/50% Rabatt.mp3'))
    assert.equal(BEFEHLE.play('/media/50% Rabatt.mp3')[1], '/media/50% Rabatt.mp3')
  })

  it('Anführungszeichen im Namen sind harmlos', () => {
    assert.equal(BEFEHLE.play('/media/Die "Drei".mp3')[1], '/media/Die "Drei".mp3')
  })

  it('bildet die übrigen Befehle ab', () => {
    assert.deepEqual(BEFEHLE.queue('/a.mp3'), ['loadfile', '/a.mp3', 'append-play'])
    assert.deepEqual(BEFEHLE.playList('/l.m3u'), ['loadlist', '/l.m3u', 'replace'])
    assert.deepEqual(BEFEHLE.queueList('/l.m3u'), ['loadlist', '/l.m3u', 'append'])
    assert.deepEqual(BEFEHLE.next(), ['playlist-next', 'force'])
    assert.deepEqual(BEFEHLE.previous(), ['playlist-prev', 'force'])
    assert.deepEqual(BEFEHLE.stop(), ['stop'])
    assert.deepEqual(BEFEHLE.setVolume(50), ['set_property', 'volume', 50])
    assert.deepEqual(BEFEHLE.seek(30), ['seek', 30, 'absolute'])
    assert.deepEqual(BEFEHLE.seekPercent(75), ['seek', 75, 'absolute-percent'])
  })

  it('playPause UMSCHALTET, statt zu pausieren', () => {
    // mplayers `pause` war ein Umschalter. Ein `set pause yes` würde das
    // zweite Antippen verschlucken — die Box bliebe stumm stehen.
    assert.deepEqual(BEFEHLE.playPause(), ['cycle', 'pause'])
  })

  it('nimmt die Lautstärke auch als Zeichenkette entgegen', () => {
    // spotify-control reicht teils Zeichenketten durch.
    assert.deepEqual(BEFEHLE.setVolume('50'), ['set_property', 'volume', 50])
  })
})

// ══ F1: DER TITELNAME REIST IM WARTESCHLANGENEINTRAG MIT ═══════════════════
//
// Warum überhaupt: `currentTrackname` bleibt bei mpv stehen, sobald die
// Maschine von selbst weiterrückt (an der Box zweimal an verschiedenen
// Quellen gemessen). Aus der Datei ist der Name nicht zu holen — bei der ARD
// stünde dort „Folge | Sendung (Datum)". Also wird er mitgegeben.
describe('force-media-title — der Name geht mit dem Eintrag', () => {
  it('legt den Namen als Datei-Option an den loadfile', () => {
    assert.deepEqual(BEFEHLE.play('https://x/a.mp3', 'Zu Besuch'), [
      'loadfile',
      'https://x/a.mp3',
      'replace',
      -1,
      { 'force-media-title': 'Zu Besuch' },
    ])
  })

  it('auch beim Anhängen — DORT sitzt der eigentliche Fehler', () => {
    // Der erste Titel hatte schon immer den richtigen Namen. Falsch wurde es
    // ab dem zweiten, und die zweiten sind genau die angehängten.
    assert.deepEqual(BEFEHLE.queue('https://x/b.mp3', 'Freibad Pommes'), [
      'loadfile',
      'https://x/b.mp3',
      'append-play',
      -1,
      { 'force-media-title': 'Freibad Pommes' },
    ])
  })

  it('DER INDEX -1 STEHT DA, und das ist keine Zierde', () => {
    // GEMESSEN an mpv 0.40.0: die kürzere Form `loadfile <adr> append
    // {optionen}` wird mit "invalid parameter" beantwortet — still, im
    // Socket, ohne eine Zeile in der Oberfläche. Wer den Index wegkürzt,
    // macht aus einem falschen Titelnamen eine stumme Box.
    assert.equal(BEFEHLE.queue('https://x/b.mp3', 'Egal')[3], -1)
    assert.equal(BEFEHLE.play('https://x/b.mp3', 'Egal')[3], -1)
  })

  it('OHNE Namen bleibt der Befehl wortgleich wie vorher', () => {
    // Der lokale Weg (library/queue) und das Vorlesen geben keinen Namen mit.
    // Bekämen sie trotzdem `-1` und ein leeres Optionsobjekt, hinge an dieser
    // Änderung plötzlich auch die Wiedergabe der lokalen Bibliothek.
    assert.deepEqual(BEFEHLE.play('/media/lied.mp3'), ['loadfile', '/media/lied.mp3', 'replace'])
    assert.deepEqual(BEFEHLE.queue('/media/lied.mp3'), ['loadfile', '/media/lied.mp3', 'append-play'])
    assert.deepEqual(BEFEHLE.play('/media/lied.mp3', ''), ['loadfile', '/media/lied.mp3', 'replace'])
  })

  it('ein Name mit Sonderzeichen braucht keine Behandlung', () => {
    // Derselbe Grund wie beim Pfad: es ist ein JSON-Element, keine Befehlszeile.
    const b = BEFEHLE.queue('https://x/c.mp3', 'Die "Drei" — 50% & mehr')
    assert.deepEqual(b[4], { 'force-media-title': 'Die "Drei" — 50% & mehr' })
    assert.equal(JSON.parse(anfrageZeile(b, 1)).command[4]['force-media-title'], 'Die "Drei" — 50% & mehr')
  })

  it('ohneTitel stellt den Rückfall her — und lässt alles andere in Ruhe', () => {
    // Der Rückfall ist der Grund, aus dem ein altes mpv hier nicht stumm
    // wird: lehnt es den loadfile ab, wird er ohne Namen wiederholt.
    assert.deepEqual(ohneTitel(BEFEHLE.queue('/a.mp3', 'Name')), ['loadfile', '/a.mp3', 'append-play'])
    assert.deepEqual(ohneTitel(BEFEHLE.play('/a.mp3', 'Name')), ['loadfile', '/a.mp3', 'replace'])
    // Ein loadfile OHNE Namen hat keinen Rückfall — er wäre derselbe Befehl,
    // und ein zweites Mal geschickt hiesse: der Titel fängt wieder von vorn an.
    assert.equal(ohneTitel(BEFEHLE.play('/a.mp3')), null)
    assert.equal(ohneTitel(BEFEHLE.stop()), null)
    assert.equal(ohneTitel(BEFEHLE.playList('/l.m3u')), null)
  })
})

describe('Zeilen zum Socket', () => {
  it('schreibt genau ein JSON-Objekt pro Zeile', () => {
    const z = anfrageZeile(BEFEHLE.play('/a b.mp3'), 7)
    assert.ok(z.endsWith('\n'))
    assert.equal(z.split('\n').filter(Boolean).length, 1)
    assert.deepEqual(JSON.parse(z), { command: ['loadfile', '/a b.mp3', 'replace'], request_id: 7 })
  })
})

describe('Meldungen von mpv', () => {
  it('erkennt die Antwort auf eine Abfrage', () => {
    const m = meldungLesen('{"error":"success","data":12.5,"request_id":3}')
    assert.deepEqual(m, { art: 'antwort', anfrageId: 3, erfolg: true, wert: 12.5 })
  })

  it('erkennt eine gescheiterte Abfrage als solche', () => {
    const m = meldungLesen('{"error":"property unavailable","request_id":4}')
    assert.equal(m.art === 'antwort' && m.erfolg, false)
  })

  it('setzt eine beobachtete Eigenschaft gleich um', () => {
    const m = meldungLesen('{"event":"property-change","name":"time-pos","data":42.5}')
    assert.deepEqual(m, { art: 'eigenschaft', name: 'time_pos', wert: 42.5 })
  })

  it('setzt auch die Metadaten in der Meldung um', () => {
    const m = meldungLesen('{"event":"property-change","name":"metadata","data":{"title":"Kap 1"}}')
    assert.equal(m.art, 'eigenschaft')
    assert.equal((m as { wert: Record<string, string> }).wert.Title, 'Kap 1')
  })

  it('ignoriert Eigenschaften, die uns nichts sagen', () => {
    assert.equal(meldungLesen('{"event":"property-change","name":"vo-configured"}').art, 'unbekannt')
  })

  it('meldet den Titelwechsel bei file-loaded', () => {
    assert.deepEqual(meldungLesen('{"event":"file-loaded"}'), { art: 'titelwechsel' })
  })

  it('meldet das Listenende erst bei idle, nicht bei end-file', () => {
    // end-file feuert AUCH zwischen zwei Titeln. Wer darauf hört, meldet nach
    // jedem Stück das Ende der Wiedergabeliste.
    assert.deepEqual(meldungLesen('{"event":"idle"}'), { art: 'listeEnde' })
    assert.equal(meldungLesen('{"event":"end-file","reason":"eof"}').art, 'unbekannt')
  })

  it('verträgt Nicht-JSON, ohne zu werfen', () => {
    // mpv schreibt gelegentlich anderes auf denselben Kanal. Eine Ausnahme
    // hier würde den Hörer abreissen — mitten in der Wiedergabe.
    for (const z of ['', 'kein json', '{kaputt', 'null', '[]'])
      assert.equal(meldungLesen(z).art, 'unbekannt')
  })
})

describe('darfGemeldetWerden — die Absturzschleife vom 2026-07-27', () => {
  // AM GERAET PASSIERT: nach dem Umschalten auf mpv starb spotify-control alle
  // ~380 ms neu, pm2 warf jedes Mal einen frischen mpv an. Ursache: die Hoerer
  // in spotify-control.ts zerlegen filename/path direkt (`val.split('.mp3')`,
  // `val.split('/')[7]`), und mpv beantwortet beide im LEERLAUF mit null.
  // mplayer meldete sie nie, solange nichts geladen war.

  it('schluckt einen leeren filename/path', () => {
    for (const n of ['filename', 'path']) {
      assert.equal(darfGemeldetWerden(n, null), false, n)
      assert.equal(darfGemeldetWerden(n, undefined), false, n)
    }
  })

  it('laesst einen echten filename/path durch', () => {
    assert.equal(darfGemeldetWerden('filename', 'lied.mp3'), true)
    assert.equal(darfGemeldetWerden('path', '/media/x/y/lied.mp3'), true)
    // Auch der leere Text ist ein Text — `''.split` wirft nicht.
    assert.equal(darfGemeldetWerden('filename', ''), true)
  })

  it('laesst null bei den Zeitangaben durch — dort ist es eine Aussage', () => {
    // „keine Position" darf gemeldet werden; die Hoerer schreiben es nur weiter.
    for (const n of ['time_pos', 'length', 'percent_pos', 'pause', 'metadata'])
      assert.equal(darfGemeldetWerden(n, null), true, n)
  })

  it('greift auf dem Weg, den mpv im Leerlauf wirklich nimmt', () => {
    // Die vollstaendige Kette: mpv schickt genau diese Zeile, sobald es
    // leerlaeuft. Sie darf beim Hoerer NICHT ankommen.
    const m = meldungLesen('{"event":"property-change","name":"path","data":null}')
    assert.equal(m.art, 'eigenschaft')
    assert.equal(m.art === 'eigenschaft' && m.wert, null)
    assert.equal(m.art === 'eigenschaft' && darfGemeldetWerden(m.name, m.wert), false)
  })

  // ── F1: DERSELBE SCHUTZ FÜR DEN TITELNAMEN, aus einem anderen Grund ─────
  it('schluckt den leeren media_title — ZWISCHEN zwei Titeln', () => {
    // GEMESSEN (mpv 0.40.0): am Übergang schiebt mpv `media-title = null`,
    // bevor der nächste Wert kommt. Wer das weiterschreibt, leert bei JEDEM
    // Titelwechsel kurz die Titelzeile — also genau dann, wenn das Kind
    // hinsieht, weil sich gerade etwas ändert.
    assert.equal(darfGemeldetWerden('media_title', null), false)
    assert.equal(darfGemeldetWerden('media_title', undefined), false)
    assert.equal(darfGemeldetWerden('media_title', ''), false)
    assert.equal(darfGemeldetWerden('media_title', 42), false)
  })

  it('lässt einen echten media_title durch', () => {
    assert.equal(darfGemeldetWerden('media_title', 'Freibad Pommes'), true)
  })

  it('greift auf dem Weg, den mpv am Übergang wirklich nimmt', () => {
    const leer = meldungLesen('{"event":"property-change","name":"media-title","data":null}')
    assert.equal(leer.art, 'eigenschaft')
    assert.equal(leer.art === 'eigenschaft' && leer.name, 'media_title')
    assert.equal(leer.art === 'eigenschaft' && darfGemeldetWerden(leer.name, leer.wert), false)

    const echt = meldungLesen('{"event":"property-change","name":"media-title","data":"Nicht alleine"}')
    assert.equal(echt.art === 'eigenschaft' && echt.name, 'media_title')
    assert.equal(echt.art === 'eigenschaft' && echt.wert, 'Nicht alleine')
    assert.equal(echt.art === 'eigenschaft' && darfGemeldetWerden(echt.name, echt.wert), true)
  })
})

describe('Warteschlangen-Stelle', () => {
  it('EIGENSCHAFTEN kennt sie', () => {
  // "Titel 3 von 12" braucht beide Zahlen. Vorher gab es keine davon:
  // die Nummer wurde aus metadata-Ereignissen hochgezaehlt (bei Titel 1
  // stand am Geraet eine 3), die Gesamtzahl gar nicht gesetzt.
    assert.equal(EIGENSCHAFTEN.playlist_pos, 'playlist-pos-1')
    // E109: der Leerlauf-Melder — ohne ihn klebte `playing` nach jedem Stop.
    assert.equal(EIGENSCHAFTEN.idle_active, 'idle-active')
    assert.equal(EIGENSCHAFTEN.playlist_count, 'playlist-count')
    // Der Rueckweg muss beides ebenfalls kennen, sonst kommt die Antwort
    // von mpv nie bei uns an.
    assert.equal(RUECKWAERTS['playlist-pos-1'], 'playlist_pos')
    assert.equal(RUECKWAERTS['playlist-count'], 'playlist_count')
  })

  it('ist 1-basiert - "Titel 0 von 12" gaebe es sonst', () => {
  // mpv kennt beide Formen: playlist-pos ist 0-basiert, playlist-pos-1 nicht.
  // Die Anzeige zaehlt ab eins, also muss es die -1-Form sein.
    assert.ok(EIGENSCHAFTEN.playlist_pos.endsWith('-1'))
  })
})

describe('titelPos — der absolute Titelsprung', () => {
  it('setzt playlist-pos-1, nicht playlist-pos', () => {
    // Die 0-basierte Form gaebe es auch. Wer sie nimmt, springt bei jeder
    // Zahl einen Titel zu weit - und bei Titel 1 faellt es nicht auf.
    assert.deepEqual(BEFEHLE.titelPos(3), ['set_property', 'playlist-pos-1', 3])
  })

  it('nimmt auch eine Zeichenkette an — der Befehl kommt aus einer URL', () => {
    // `tracknr:5` wird zerlegt; was dabei herauskommt, ist Text.
    assert.deepEqual(BEFEHLE.titelPos('5'), ['set_property', 'playlist-pos-1', 5])
  })

  it('benutzt dieselbe Eigenschaft wie der Rueckweg', () => {
    // Sonst springt die Box zwar, meldet aber weiter die alte Nummer.
    assert.equal(BEFEHLE.titelPos(1)[1], EIGENSCHAFTEN.playlist_pos)
  })
})
