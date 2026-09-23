/**
 * SICHERN UND ZURUECKSPIELEN OHNE SSH — die Aussagen, die vorher ROT waeren.
 *
 * Vor dem 07.08.2026 gab es keine Route `/api/sicherung*`. Jede Aussage hier
 * war also entweder gar nicht formulierbar oder rot. Die wichtigsten sind
 * NICHT „der Weg antwortet mit 200", sondern die vier, an denen es weh tut:
 *
 *   1. DAS PASSWORT STEHT IN KEINEM ARGUMENT UND IN KEINER UMGEBUNG.
 *      Gemessen, nicht behauptet: der Test schiebt ein Python unter, das sein
 *      eigenes argv, seine Umgebung und seinen stdin auf die Platte schreibt.
 *      Danach wird in argv und Umgebung nach dem Passwort GESUCHT.
 *   2. `--trotzdem` IST UEBER DIE API NICHT ERREICHBAR. Der Schalter uebergeht
 *      genau die Pruefungen, die eine unbrauchbare Box verhindern.
 *   3. DIE BESTAETIGUNG GILT FUER GENAU DIE BYTES DER VORSCHAU. Liegt an der
 *      Stelle etwas anderes, wird NICHTS eingespielt.
 *   4. EIN EINGANG KANN NIE „neueste" SEIN. Das ist eine Aussage ueber eine
 *      SORTIERUNG in fremdem Code (`staende_lesen` sortiert absteigend) und
 *      genau deshalb eine, die man aufschreiben muss, statt sie sich zu
 *      merken.
 *
 * KEIN ECHTES mupibox-sicherung.py IN DIESER DATEI. Das Zusammenspiel mit dem
 * echten Werkzeug — sichern, kaputtmachen, zurueckspielen, Datei fuer Datei
 * nachzaehlen — misst `tools/sicherung-ohne-ssh-ring.ts` gegen einen eigenen
 * Server im Sandkasten. Hier steht, was OHNE Python entscheidbar ist; dort
 * steht, was nur mit ihm entscheidbar ist. Beides in einer Datei hiesse: der
 * Testlauf braucht python3 und gpg, und dann laeuft er nirgends.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { gzipSync } from 'node:zlib'
import express from 'express'
import request from 'supertest'
import {
  ABLAGE_HINWEISE,
  abbruchLage,
  berichtDeuten,
  downloadName,
  EINGANG_HOECHSTENS,
  EINGANG_VORSILBE,
  eingangAufraeumen,
  eingangName,
  eingangPlatzSchaffen,
  FORMAT_BEKANNT,
  fremdheitPruefen,
  istEingang,
  MAX_ARCHIV_BYTES,
  MAX_ENTPACKT_BYTES,
  NICHT_EINGEORDNET_HOECHSTENS,
  nichtEingeordnetDeuten,
  PASSWORT_MIN,
  PFAD_HOECHSTENS_ZEICHEN,
  passwortPruefen,
  planSatz,
  sha256,
  sicherungWegeBauen,
  spurenFrei,
  standKopfLesen,
  tarEintragLesen,
  umgebungOhnePasswort,
} from './sicherung'

/* ══ Ein winziger tar-Schreiber, damit es Archive zu lesen gibt ═════════ */

/** Der Zeitstempel in jedem tar-Kopf. Fest — Begruendung unten in `tarEintrag`. */
const TAR_ZEIT = Math.floor(Date.parse('2026-08-07T09:14:00+02:00') / 1000)

function tarEintrag(name: string, daten: Buffer): Buffer {
  const kopf = Buffer.alloc(512)
  kopf.write(name, 0, 100, 'utf8')
  kopf.write('000600 \0', 100, 8, 'ascii')
  kopf.write('000000 \0', 108, 8, 'ascii')
  kopf.write('000000 \0', 116, 8, 'ascii')
  kopf.write(`${daten.length.toString(8).padStart(11, '0')} `, 124, 12, 'ascii')
  // DIE ZEIT IM KOPF IST FEST, UND ZWAR AUS EINEM GEMESSENEN GRUND.
  //
  // Hier stand `Date.now()/1000`. Damit gab `standArchiv(X)` bei jedem Aufruf
  // ANDERE Bytes zurueck, sobald zwischen zwei Aufrufen eine Sekundengrenze
  // lag — und genau darauf baute eine Aussage weiter unten:
  //
  //     .send(archiv())                                  // gebaut bei t0
  //     assert.equal(a.body.kennung, sha256(archiv()))   // gebaut bei t1
  //
  // Die Anfrage dazwischen dauert ~150 ms, also fiel die Aussage in rund
  // jedem sechsten Lauf um — nicht, weil die Kennung falsch war, sondern
  // weil zwei verschiedene Archive verglichen wurden. Ein Lauf, der ohne
  // Aenderung mal rot und mal gruen ist, ist schlimmer als einer, der immer
  // rot ist: er erzieht dazu, noch einmal zu starten statt nachzusehen.
  //
  // Die Zeit wird von `tarEintragLesen` nicht gelesen und von keiner Aussage
  // geprueft. Sie ist deshalb fest — dieselbe Eingabe, dieselben Bytes.
  kopf.write(`${TAR_ZEIT.toString(8).padStart(11, '0')} `, 136, 12, 'ascii')
  kopf.write('        ', 148, 8, 'ascii') // Pruefsumme: erst Leerzeichen …
  kopf.write('0', 156, 1, 'ascii')
  let summe = 0
  for (const b of kopf) summe += b
  kopf.write(`${summe.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii') // … dann rechnen
  const fuellung = Buffer.alloc((512 - (daten.length % 512)) % 512)
  return Buffer.concat([kopf, daten, fuellung])
}

/** Ein Archiv, das aussieht wie ein Stand. */
function standArchiv(stand: Record<string, unknown>, extra: Record<string, string> = {}): Buffer {
  const teile = [tarEintrag('stand.json', Buffer.from(JSON.stringify(stand, null, 2), 'utf8'))]
  for (const [n, i] of Object.entries(extra)) teile.push(tarEintrag(n, Buffer.from(i, 'utf8')))
  teile.push(Buffer.alloc(1024)) // zwei Nullbloecke = Ende
  return gzipSync(Buffer.concat(teile))
}

const STAND_VORGABE = {
  format: 1,
  erzeugt: '2026-08-07T09:14:00+02:00',
  grund: 'verwaltung',
  host: 'mupibox',
  dateien: [
    { pfad: 'etc/mupibox/mupiboxconfig.json', bytes: 4096, sha256: 'aa' },
    { pfad: 'server/config/data.json', bytes: 20480, sha256: 'bb' },
  ],
  ausgelassen: [{ datei: 'etc/mupibox/mupiboxconfig.json', zeiger: '/spotify/refreshToken' }],
  verweise: { 'server/config/active_data.json': 'data.json' },
  zugangsdaten: null,
}

/* ══ Der Bericht, so wie ihn das echte Python schreibt ══════════════════ */

const BERICHT = [
  'Stand vom 2026-08-07T09:14:00+02:00  (Grund: verwaltung)',
  'Zugangsdaten AUS DEM STAND eingespielt (Behaelter geoeffnet): etc/mupibox/mupiboxconfig.json/spotify/refreshToken, server/config/wlan.json/*/pw (2x)',
  'Ausgelassene Schluessel behalten den Wert der Box: etc/mupibox/mupiboxconfig.json/telegram/token',
  '!! DIESE MUESSEN VON HAND NEU EINGEGEBEN WERDEN — sie waren nicht in der Sicherung und stehen auch nicht auf der Box:',
  '     etc/mupibox/mupiboxconfig.json/mqtt/password  (MQTT-Passwort)',
  '  > /etc/mupibox/mupiboxconfig.json  (4096 B)',
  '  = /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json  (20480 B)',
  '  > /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/kinderzeit.json  (512 B)',
  '  uebersprungen (kein Ziel): server/config/aus-der-zukunft.json',
  '  Verweis (NICHT angefasst): server/config/active_data.json -> data.json',
  'TROCKEN — nichts geschrieben.',
]

const BERICHT_OHNE_PASSWORT = [
  'Stand vom 2026-08-07T09:14:00+02:00  (Grund: verwaltung)',
  '!! 3 Feld(er) liegen VERSCHLUESSELT im Stand und wurden NICHT eingespielt — dazu braucht es das Passwort:',
  '     etc/mupibox/mupiboxconfig.json/spotify/refreshToken  (Spotify-Dauerzugang)',
  '     etc/mupibox/mupiboxconfig.json/interfacelogin/password  (Passwort der Verwaltung)',
  '     server/config/wlan.json/*/pw  (WLAN-Passwort im Klartext)',
  '   Nachholen (es muss jemand tippen koennen):',
  '     sudo /usr/local/bin/mupibox/mupibox-sicherung.py \\',
  '          --wiederherstellen <stand> --mit-zugangsdaten',
  '  > /etc/mupibox/mupiboxconfig.json  (4096 B)',
  'TROCKEN — nichts geschrieben.',
]

/* ══ Reines ════════════════════════════════════════════════════════════ */

describe('Sicherung — den Stand lesen, ohne das Python zu fragen', () => {
  it('DAS WERKZEUG SELBST: dieselbe Eingabe gibt dieselben Bytes', () => {
    // Die Aussage „Schritt 1 fasst nichts an" vergleicht die Kennung aus der
    // Antwort mit `sha256(archiv())` — und baut das Archiv dafuer ein zweites
    // Mal. Waere `standArchiv` nicht reproduzierbar, fiele sie um, sobald
    // zwischen den beiden Aufrufen eine Sekundengrenze liegt. Das ist genau
    // passiert (Zeitstempel im tar-Kopf). Die Aussage steht deshalb HIER, am
    // Werkzeug, und nicht bei dem, was daran zerbricht.
    assert.equal(sha256(standArchiv(STAND_VORGABE)), sha256(standArchiv(STAND_VORGABE)))
  })

  it('holt stand.json aus einem gzip-ten tar', () => {
    const roh = tarEintragLesen(standArchiv(STAND_VORGABE), 'stand.json')
    assert.ok(roh)
    assert.equal(JSON.parse(roh.toString('utf8')).host, 'mupibox')
  })

  it('findet einen Eintrag auch HINTER einem anderen', () => {
    const a = standArchiv(STAND_VORGABE, { 'LIESMICH.txt': 'x'.repeat(1500) })
    assert.equal(tarEintragLesen(a, 'LIESMICH.txt')?.toString('utf8').length, 1500)
  })

  it('liest den Kopf mit Dateien, Verweisen und Zugangsdaten', () => {
    const k = standKopfLesen(
      standArchiv({
        ...STAND_VORGABE,
        zugangsdaten: {
          behaelter: 'zugangsdaten.gpg',
          felder: [{ datei: 'server/config/wlan.json', zeiger: '/*/pw', warum: 'WLAN-Passwort' }],
        },
      }),
    )
    assert.equal(k.dateien.length, 2)
    assert.equal(k.zugangsdaten.length, 1)
    assert.equal(k.ausgelassenAnzahl, 1)
    assert.equal(Object.keys(k.verweise).length, 1)
  })

  // WAS EIN ELTERNTEIL WIRKLICH HOCHLAEDT, ist im Zweifel das Falsche —
  // ein Bild, ein halb geladener Download, das Archiv einer anderen Software.
  // Jeder dieser Faelle muss einen SATZ ergeben, keinen Stapelabzug.
  it('sagt bei einer Datei, die kein Archiv ist, einen ganzen Satz', () => {
    assert.throws(() => standKopfLesen(Buffer.from('Das ist ein Urlaubsfoto, kein Stand.')), /keine MuPiBox-Sicherung/)
  })

  it('sagt bei einem Archiv OHNE stand.json einen ganzen Satz', () => {
    const fremd = gzipSync(Buffer.concat([tarEintrag('irgendwas.txt', Buffer.from('hallo')), Buffer.alloc(1024)]))
    assert.throws(() => standKopfLesen(fremd), /kein stand\.json/)
  })

  it('sagt bei beschaedigtem stand.json einen ganzen Satz', () => {
    const kaputt = gzipSync(
      Buffer.concat([tarEintrag('stand.json', Buffer.from('{ das ist kein')), Buffer.alloc(1024)]),
    )
    assert.throws(() => standKopfLesen(kaputt), /beschaedigt/)
  })
})

describe('Sicherung — andere Box, andere Fassung', () => {
  it('WARNT bei einer anderen Box, verbietet aber nicht', () => {
    const f = fremdheitPruefen(standKopfLesen(standArchiv(STAND_VORGABE)), 'kinderzimmer-box')
    assert.equal(f.ablehnen, null)
    assert.match(f.warnungen.join('\n'), /ANDEREN Box/)
    // Der Grund steht im Kopf von sicherung.ts: wer die Karte tauscht, setzt
    // die Box neu auf, und sie heisst danach womoeglich anders. Genau dann
    // will jemand zurueckspielen. Ein Verbot waere die naechste Sackgasse.
  })

  it('LEHNT eine hoehere Fassung ab', () => {
    const f = fremdheitPruefen(standKopfLesen(standArchiv({ ...STAND_VORGABE, format: FORMAT_BEKANNT + 1 })), 'mupibox')
    assert.ok(f.ablehnen)
    assert.match(f.ablehnen, /neueren MuPiBox/)
  })

  it('benennt eine aeltere Fassung, spielt sie aber ein', () => {
    const f = fremdheitPruefen(standKopfLesen(standArchiv({ ...STAND_VORGABE, format: 0 })), 'mupibox')
    assert.equal(f.ablehnen, null)
    assert.match(f.warnungen.join('\n'), /aeltere Fassung/)
  })

  it('meldet einen Stand ohne Dateien', () => {
    const f = fremdheitPruefen(standKopfLesen(standArchiv({ ...STAND_VORGABE, dateien: [] })), 'mupibox')
    assert.match(f.warnungen.join('\n'), /gar keine Dateien/)
  })

  it('warnt NICHT, wenn der Stand von dieser Box kommt', () => {
    const f = fremdheitPruefen(standKopfLesen(standArchiv(STAND_VORGABE)), 'mupibox')
    assert.deepEqual(f.warnungen, [])
  })
})

describe('Sicherung — aus dem Bericht werden Zahlen', () => {
  const p = berichtDeuten(BERICHT)

  it('zaehlt, was sich WIRKLICH aendert — getrennt von dem, was schon dasteht', () => {
    assert.equal(p.aendert.length, 2)
    assert.equal(p.unveraendert.length, 1)
    assert.equal(p.aendert[0]?.ziel, '/etc/mupibox/mupiboxconfig.json')
    assert.equal(p.aendert[0]?.bytes, 4096)
  })

  it('haelt Uebersprungenes und Verweise auseinander', () => {
    assert.deepEqual(p.uebersprungen, ['server/config/aus-der-zukunft.json'])
    assert.equal(p.verweise.length, 1)
  })

  it('nennt, was danach VON HAND eingegeben werden muss', () => {
    assert.deepEqual(p.vonHand, ['etc/mupibox/mupiboxconfig.json/mqtt/password  (MQTT-Passwort)'])
  })

  it('trennt eingespielte von behaltenen Zugangsdaten', () => {
    assert.equal(p.eingespielt.length, 2)
    assert.deepEqual(p.behaelt, ['etc/mupibox/mupiboxconfig.json/telegram/token'])
  })

  it('sammelt die verschluesselt liegen gebliebenen Felder', () => {
    const q = berichtDeuten(BERICHT_OHNE_PASSWORT)
    assert.equal(q.verschluesseltLiegenGeblieben.length, 3)
    // DER SSH-HINWEIS DARF NICHT MITKOMMEN. Das Python schreibt ihn fuer den
    // Weg ueber die Karte, wo niemand tippen kann. Hier KANN jemand tippen —
    // die Seite fragt das Passwort ab. Stuende der Hinweis trotzdem da,
    // schickte die Oberflaeche den Benutzer genau in das SSH, das dieser
    // ganze Weg ueberfluessig macht.
    assert.equal(
      q.verschluesseltLiegenGeblieben.some((z) => z.includes('mupibox-sicherung.py')),
      false,
    )
    assert.equal(
      q.anmerkungen.some((z) => z.includes('--wiederherstellen')),
      false,
    )
  })

  it('macht daraus einen Satz mit Zahlen, nicht mit «Daten werden ersetzt»', () => {
    const s = planSatz(p)
    assert.match(s, /2 Dateien werden ueberschrieben/)
    assert.match(s, /1 stehen schon genau so da/)
    assert.match(s, /1 muessen Sie danach von Hand eingeben/)
    assert.equal(/Daten werden ersetzt/.test(s), false)
  })

  it('sagt auch bei einem leeren Bericht etwas Zaehlbares', () => {
    assert.match(planSatz(berichtDeuten([])), /0 Dateien werden ueberschrieben/)
  })

  it('nimmt Anmerkungen des Pythons mit, ohne sie zu Dateien zu machen', () => {
    const q = berichtDeuten(['!! uebergangen (--trotzdem): startVolume > maxVolume'])
    assert.equal(q.anmerkungen.length, 1)
    assert.equal(q.aendert.length, 0)
  })

  // ── Der Fall, in dem etwas aus dem Stand NICHT ankommt ────────────────
  //
  // Auf der Box steht an dieser Stelle ein VERWEIS (die Bruecke
  // `resume.json -> profile/<aktiv>/resume.json`), im Stand steht dort eine
  // Datei — jeder Stand aus der Zeit vor E18 Stufe 3 tut das, und eine
  // aeltere Fassung wird ausdruecklich angenommen. Das Python ueberschreibt
  // den Verweis seit dem 07.08.2026 nicht mehr; die Zeile darf hier nicht im
  // selben Topf landen wie der harmlose Verweis AUS dem Archiv.
  it('haelt den Verweis AUF DER BOX vom Verweis IM ARCHIV auseinander', () => {
    const q = berichtDeuten([
      '  Verweis (NICHT angefasst): server/config/active_data.json -> data.json',
      '  Verweis auf der Box (NICHT ueberschrieben): /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/resume.json -> profile/kalea/resume.json',
    ])
    assert.equal(q.verweise.length, 1)
    assert.equal(q.verweisZiele.length, 1)
    assert.match(q.verweisZiele[0] as string, /-> profile\/kalea\/resume\.json$/)
    // Und er darf nicht als geaenderte oder unveraenderte Datei mitzaehlen.
    assert.equal(q.aendert.length, 0)
    assert.equal(q.unveraendert.length, 0)
  })

  it('sagt im Satz ueber dem roten Knopf, dass dort etwas stehen BLEIBT', () => {
    const q = berichtDeuten([
      '  > /etc/mupibox/mupiboxconfig.json  (4096 B)',
      '  Verweis auf der Box (NICHT ueberschrieben): …/resume.json -> profile/kalea/resume.json',
    ])
    assert.match(planSatz(q), /1 Stelle bleibt stehen, weil dort auf dieser Box ein Verweis liegt/)
  })
})

/* ══ Der Abbruch mitten im Vorgang ══════════════════════════════════════ */
//
// GEMESSEN, NICHT ANGENOMMEN (07.08.2026, Sandkasten, SIGTERM 1,8 s in die
// Schreibschleife): data.json, darstellung.json, kinderzeit.json und der
// Verlauf des Kindes waren zurueckgespielt, verfuegbarkeit.json stand noch
// auf dem alten Wert. Bis dahin sagte die Antwort in JEDEM Fehlerfall „Es
// wurde nichts geaendert" — und wer das glaubt, sucht den Stand „vorher"
// nicht, den das Python zuvor angelegt hat.
describe('Sicherung — was nach einem Abbruch gesagt wird', () => {
  it('vor dem ersten Byte: der alte Satz gilt weiter', () => {
    const l = abbruchLage(
      'vorher gesichert als mupibox-sicherung-20260807-120000-vor-wiederherstellung.behalten.tar.gz\n',
    )
    assert.equal(l.geschrieben, 0)
    assert.equal(l.satz, 'Es wurde nichts geaendert.')
  })

  it('gar keine Ausgabe: ebenfalls nichts geschrieben', () => {
    assert.equal(abbruchLage('').geschrieben, 0)
  })

  it('MITTEN IN DER SCHLEIFE: es wird gesagt, wie viele Dateien schon standen', () => {
    const l = abbruchLage(
      [
        'vorher gesichert als mupibox-sicherung-20260807-120000-vor-wiederherstellung.behalten.tar.gz',
        'Stand vom 2026-08-07T09:14:00+02:00  (Grund: verwaltung)',
        '  > /etc/mupibox/bt-adapter  (18 B)',
        '  > /etc/mupibox/mupiboxconfig.json  (4096 B)',
        '  = /srv/config/darstellung.json  (8 B)',
        '  > /srv/config/data.json  (20480 B)',
      ].join('\n'),
    )
    // Die `=`-Zeile zaehlt NICHT: dort stand die Datei schon genau so da.
    assert.equal(l.geschrieben, 3)
    assert.match(l.satz, /3 Dateien geschrieben waren/)
    assert.match(l.satz, /teils den alten, teils den neuen Stand/)
    assert.equal(/Es wurde nichts geaendert/.test(l.satz), false)
  })

  it('nennt den Rueckweg BEIM NAMEN — er ist das einzige, was dann noch hilft', () => {
    const l = abbruchLage(
      [
        'vorher gesichert als mupibox-sicherung-20260807-120000-vor-wiederherstellung.behalten.tar.gz',
        '  > /a  (1 B)',
      ].join('\n'),
    )
    assert.equal(l.vorherStand, 'mupibox-sicherung-20260807-120000-vor-wiederherstellung.behalten.tar.gz')
    assert.match(l.satz, /mupibox-sicherung-20260807-120000-vor-wiederherstellung\.behalten\.tar\.gz/)
  })

  it('und sagt es AUCH, wenn es keinen Stand «vorher» gibt', () => {
    const l = abbruchLage('  > /a  (1 B)')
    assert.equal(l.vorherStand, null)
    assert.match(l.satz, /kein Stand «vorher»/)
  })

  it('eine Datei: Einzahl, damit der Satz nicht nach Maschine klingt', () => {
    const l = abbruchLage('  > /a  (1 B)')
    assert.match(l.satz, /1 Datei geschrieben war/)
  })
})

describe('Sicherung — das Passwort', () => {
  it('nimmt kurze Passwoerter nicht an', () => {
    assert.equal(passwortPruefen('kurz').ok, false)
    assert.equal(passwortPruefen('x'.repeat(PASSWORT_MIN)).ok, true)
  })

  it('nimmt kein Passwort mit Zeilenumbruch', () => {
    // Es geht ZEILENWEISE ueber stdin. Ein Umbruch darin wuerde still
    // abschneiden — der Behaelter waere dann mit einem anderen Passwort zu
    // als dem, das jemand getippt hat. Das faellt erst auf, wenn er ihn
    // braucht, und dann ist es zu spaet.
    assert.equal(passwortPruefen('gutes-passwort\nmehr').ok, false)
  })

  it('sagt bei einem fehlenden Passwort, warum', () => {
    assert.match(String(passwortPruefen(undefined).grund), /Ohne Passwort/)
  })

  it('loescht das Passwort aus allem, was zurueckkommt', () => {
    assert.equal(spurenFrei('gpg: bad passphrase [geheim123]', 'geheim123'), 'gpg: bad passphrase [«Passwort»]')
    assert.equal(spurenFrei('nichts drin', 'geheim123'), 'nichts drin')
  })

  it('reicht MUPIBOX_SICHERUNG_PW NICHT an das Kind weiter', () => {
    // Sonst gaebe `passwort_holen` der Umgebung den Vorrang vor stdin, und
    // der Behaelter waere mit einem Passwort zu, das der Benutzer nie
    // eingegeben hat.
    const u = umgebungOhnePasswort({ PATH: '/bin', MUPIBOX_SICHERUNG_PW: 'von-aussen' })
    assert.equal(u['MUPIBOX_SICHERUNG_PW'], undefined)
    assert.equal(u['PATH'], '/bin')
  })
})

describe('Sicherung — der Eingang stoert die echten Staende nicht', () => {
  const kennung = sha256(Buffer.from('irgendwas'))

  it('traegt die Vorsilbe, an der ihn das Python findet', () => {
    const n = eingangName(kennung)
    assert.ok(n.startsWith('mupibox-sicherung-'))
    assert.ok(n.endsWith('.tar.gz'))
    assert.ok(istEingang(n))
  })

  it('kann NIE «neueste» sein — gegen die Sortierung des Pythons gerechnet', () => {
    // `staende_lesen` macht sorted(..., reverse=True) und `stand_waehlen`
    // nimmt fuer «neueste» das erste Element. Ein Eingang muss deshalb hinter
    // JEDER Jahreszahl liegen. Das ist eine Aussage ueber FREMDEN Code —
    // genau die Sorte, die man aufschreibt statt sie sich zu merken.
    const echte = [
      'mupibox-sicherung-20260807-091400-verwaltung.tar.gz',
      'mupibox-sicherung-19991231-235959-uralt.tar.gz',
      'mupibox-sicherung-20991231-235959-fern.behalten.tar.gz',
    ]
    const alle = [...echte, eingangName(kennung)].sort().reverse()
    assert.equal(istEingang(alle[0] as string), false)
    assert.equal(alle[alle.length - 1], eingangName(kennung))
  })

  it('weist eine unbrauchbare Kennung zurueck, statt einen Pfad zu bauen', () => {
    assert.throws(() => eingangName('../../etc/passwd'))
    assert.throws(() => eingangName(''))
    assert.throws(() => eingangName('KURZ'))
  })

  it('deckelt die ANZAHL — die Frist allein laesst in einer halben Stunde beliebig viele zu', () => {
    // Jede unbestaetigte Vorschau legt bis zu 8 MB auf dieselbe Karte, auf der
    // die Bibliothek liegt. `eingangAufraeumen` raeumt nach ZEIT und greift
    // deshalb genau dann nicht, wenn jemand schnell hintereinander schickt.
    const verz = mkdtempSync(join(tmpdir(), 'mupi-eingang-deckel-'))
    const echt = 'mupibox-sicherung-20260807-091400-verwaltung.tar.gz'
    writeFileSync(join(verz, echt), 'x')
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(verz, eingangName(sha256(Buffer.from(`nr-${i}`)))), 'y')
    }
    const weg = eingangPlatzSchaffen(verz)
    const uebrig = readdirSync(verz).filter((n) => istEingang(n))
    // Platz fuer den, der gleich dazukommt: hoechstens HOECHSTENS - 1.
    assert.equal(uebrig.length, EINGANG_HOECHSTENS - 1)
    assert.equal(weg, 6 - (EINGANG_HOECHSTENS - 1))
    // Ein echter Stand wird dabei NIE angefasst.
    assert.equal(readFileSync(join(verz, echt), 'utf8'), 'x')
    rmSync(verz, { recursive: true, force: true })
  })

  it('laesst liegen, was unter dem Deckel liegt', () => {
    const verz = mkdtempSync(join(tmpdir(), 'mupi-eingang-ruhe-'))
    writeFileSync(join(verz, eingangName(sha256(Buffer.from('einer')))), 'y')
    assert.equal(eingangPlatzSchaffen(verz), 0)
    assert.equal(readdirSync(verz).length, 1)
    rmSync(verz, { recursive: true, force: true })
  })

  it('raeumt alte Eingaenge weg und laesst echte Staende stehen', () => {
    const verz = mkdtempSync(join(tmpdir(), 'mupi-eingang-'))
    const echt = 'mupibox-sicherung-20260807-091400-verwaltung.tar.gz'
    writeFileSync(join(verz, echt), 'x')
    writeFileSync(join(verz, eingangName(kennung)), 'y')
    // In der Zukunft messen = so tun, als waere viel Zeit vergangen.
    const weg = eingangAufraeumen(verz, Date.now() + 60 * 60 * 1000)
    assert.equal(weg, 1)
    assert.equal(readFileSync(join(verz, echt), 'utf8'), 'x')
    rmSync(verz, { recursive: true, force: true })
  })
})

describe('Sicherung — die Bombe und die fremde Webseite', () => {
  it('entpackt NICHT unbegrenzt: ein Archiv, das sich vertausendfacht, wird abgewiesen', () => {
    // gzip presst gleichfoermige Bytes ueber 1000:1 (gemessen in
    // tools/sicherung-was-geht-hinaus.ts, Ring 5). Ohne Deckel legt
    // `gunzipSync` das Ergebnis am Stueck in den Speicher DIESES Vorgangs —
    // auf einem Pi ist das kein Fehler, sondern das Ende des Servers.
    const bombe = gzipSync(Buffer.alloc(MAX_ENTPACKT_BYTES + 1024 * 1024, 0), { level: 9 })
    assert.ok(bombe.length < 1024 * 1024, 'die Bombe passt bequem unter die Eingangsgrenze')
    assert.throws(
      () => tarEintragLesen(bombe, 'stand.json'),
      (e: unknown) => String((e as { code?: unknown }).code) === 'ERR_BUFFER_TOO_LARGE',
    )
    // Und der Satz, der beim Benutzer ankommt, sagt WAS los ist.
    assert.throws(() => standKopfLesen(bombe), /blaeht sich beim Entpacken/)
  })

  it('weist eine Anfrage ab, die eine andere Webseite gestellt hat', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const a = await request(k.app)
      .post('/api/sicherung/anlegen')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://boese.example')
      .send({})
      .expect(403)
    assert.match(a.body.fehler, /anderen Webseite/)
    // Kein Archiv, kein Stand: es darf auch nichts entstanden sein.
    assert.equal(readdirSync(k.staende).length, 0)
  })

  it('faengt NUR die eigenen Wege — der Rueckweg von Spotify laeuft daneben vorbei', async () => {
    // DIE ZEILE, DIE DIESER TEST HAELT: `r.use('/api/sicherung', …)`.
    // Ohne den Pfad galt die Zwischenschicht fuer JEDE Anfrage der ganzen
    // Anwendung — der Router wird in server.ts ebenfalls ohne Pfad
    // eingehaengt. Gemessen war die Folge: `accounts.spotify.com` schickt den
    // Browser auf `/spotify` (Navigation der obersten Ebene, also
    // `Sec-Fetch-Site: cross-site`) und bekam 403 mit dem Satz von hier.
    // Spotify liess sich damit nicht mehr einrichten.
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const app = express()
    app.use(sicherungWegeBauen({ skript: k.skript, staende: k.staende, vorspann: [], host: () => 'mupibox' }))
    app.get('/spotify', (_q, s) => {
      s.status(200).send('rueckweg')
    })
    const a = await request(app)
      .get('/spotify?code=abc')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Sec-Fetch-Mode', 'navigate')
      .set('Sec-Fetch-Dest', 'document')
      .expect(200)
    assert.equal(a.text, 'rueckweg')
    // Und die eigenen Wege bleiben trotzdem gedeckt.
    await request(app).post('/api/sicherung/anlegen').set('Sec-Fetch-Site', 'cross-site').send({}).expect(403)
  })

  it('laesst die eigene Verwaltung und Aufrufe ohne diese Kopfzeile durch', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    // Der Rueckweg darf an einem Riegel NICHT scheitern. `same-origin` ist die
    // Verwaltung selbst, `none` die Adresszeile, gar nichts curl oder ein
    // Zwischenstueck, das die Kopfzeile streicht.
    for (const wert of ['same-origin', 'same-site', 'none']) {
      await request(k.app).get('/api/sicherung').set('Sec-Fetch-Site', wert).expect(200)
    }
    await request(k.app).get('/api/sicherung').expect(200)
  })

  it('gibt einer fremden Herkunft kein «Access-Control-Allow-Origin: *» mit', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    // In server.ts steht `app.use(cors())` VOR dem Tor — die Kopfzeile ist
    // also schon gesetzt, wenn dieser Router drankommt. Sie wird hier wieder
    // entfernt: ohne sie darf ein Browser die Antwort einer fremden Seite
    // nicht zeigen.
    const app = express()
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      next()
    })
    app.use(sicherungWegeBauen({ skript: k.skript, staende: k.staende, vorspann: [] }))
    const a = await request(app).get('/api/sicherung').expect(200)
    assert.equal(a.headers['access-control-allow-origin'], undefined)
  })
})

describe('Sicherung — der Dateiname im Download-Ordner', () => {
  it('nennt Box und Zeitpunkt, damit zwei Staende sich nicht ueberschreiben', () => {
    const n = downloadName(standKopfLesen(standArchiv(STAND_VORGABE)))
    assert.match(n, /^mupibox-sicherung-mupibox-20260807091400\.tar\.gz$/)
  })

  it('sagt im Namen, wenn Zugangsdaten darin liegen', () => {
    const n = downloadName(
      standKopfLesen(
        standArchiv({
          ...STAND_VORGABE,
          zugangsdaten: { felder: [{ datei: 'a', zeiger: '/b', warum: 'c' }] },
        }),
      ),
    )
    assert.match(n, /-mit-zugangsdaten\.tar\.gz$/)
  })

  it('macht aus einem wilden Boxnamen keinen Pfad', () => {
    const n = downloadName(standKopfLesen(standArchiv({ ...STAND_VORGABE, host: '../../etc' })))
    assert.equal(n.includes('/'), false)
    assert.equal(n.includes('..'), false)
  })
})

/* ══ Die Wege — gegen ein untergeschobenes Python ══════════════════════ */

/**
 * Ein Python, das sich benimmt wie mupibox-sicherung.py, aber alles
 * mitschreibt: argv, Umgebung, stdin. Damit laesst sich das PRUEFEN, was man
 * sonst nur behaupten kann.
 */
const STUB = `#!/usr/bin/env python3
import json, os, sys, time
argv = sys.argv[1:]
eingang = "" if sys.stdin.isatty() else sys.stdin.read()
os.makedirs(os.environ["MUPI_STUB_AUS"], exist_ok=True)
with open(os.path.join(os.environ["MUPI_STUB_AUS"], "lauf-%f.json" % time.time()), "w") as f:
    json.dump({"argv": argv, "env": dict(os.environ), "stdin": eingang}, f)
if "--liste" in argv:
    print("[]")
    sys.exit(0)
if "--anlegen" in argv:
    ziel = os.path.join(os.environ["MUPI_STUB_STAENDE"],
                        "mupibox-sicherung-20260807-091400-verwaltung.tar.gz")
    with open(os.environ["MUPI_STUB_ARCHIV"], "rb") as q, open(ziel, "wb") as z:
        z.write(q.read())
    print("angelegt")
    sys.exit(0)
if "--wiederherstellen" in argv:
    if os.environ.get("MUPI_STUB_SCHEITERT"):
        sys.stderr.write("NICHT geschrieben — dieser Stand wuerde die Box unbrauchbar machen:\\n"
                         "  - mupibox.audioDevice ist leer\\n")
        sys.exit(1)
    if "--trocken" not in argv:
        print("vorher gesichert als mupibox-sicherung-20260807-120000-vor-wiederherstellung.behalten.tar.gz")
    print("Stand vom 2026-08-07T09:14:00+02:00  (Grund: verwaltung)")
    print("  > /etc/mupibox/mupiboxconfig.json  (4096 B)")
    print("  = /var/lib/data.json  (20480 B)")
    if "--trocken" in argv:
        print("TROCKEN — nichts geschrieben.")
    sys.exit(0)
sys.exit(2)
`

function sandkasten(vorlage: Record<string, unknown> = STAND_VORGABE) {
  const wurzel = mkdtempSync(join(tmpdir(), 'mupi-sicherung-'))
  const staende = join(wurzel, 'sicherungen')
  const spur = join(wurzel, 'spur')
  mkdirSync(staende, { recursive: true })
  mkdirSync(spur, { recursive: true })
  const skript = join(wurzel, 'stub.py')
  writeFileSync(skript, STUB)
  chmodSync(skript, 0o755)
  const archiv = join(wurzel, 'vorlage.tar.gz')
  writeFileSync(archiv, standArchiv(vorlage))
  process.env['MUPI_STUB_AUS'] = spur
  process.env['MUPI_STUB_STAENDE'] = staende
  process.env['MUPI_STUB_ARCHIV'] = archiv
  const app = express()
  app.use(sicherungWegeBauen({ skript, staende, vorspann: [], host: () => 'mupibox' }))
  return { wurzel, staende, spur, app, skript }
}

function laeufe(spur: string): { argv: string[]; env: Record<string, string>; stdin: string }[] {
  return readdirSync(spur)
    .sort()
    .map((n: string) => JSON.parse(readFileSync(join(spur, n), 'utf8')))
}

const kaesten: string[] = []
after(() => {
  for (const k of kaesten) rmSync(k, { recursive: true, force: true })
})

describe('Sicherung — die Wege gibt es ueberhaupt (vorher: 404)', () => {
  it('GET /api/sicherung sagt die Lage und die Hinweise zur Ablage', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const a = await request(k.app).get('/api/sicherung').expect(200)
    assert.equal(a.body.ok, true)
    assert.equal(a.body.werkzeugDa, true)
    assert.equal(a.body.host, 'mupibox')
    assert.equal(a.body.passwortMin, PASSWORT_MIN)
    assert.equal(a.body.maxBytes, MAX_ARCHIV_BYTES)
    // WOVOR DIE ABLAGE NICHT SCHUETZT geht MIT hinaus, damit die Oberflaeche
    // es nicht abschreiben muss. Zwei Fassungen desselben Satzes laufen
    // auseinander, und die, die niemand liest, veraltet zuerst.
    assert.deepEqual(a.body.ablageHinweise, ABLAGE_HINWEISE)
    assert.equal(
      a.body.ablageHinweise.some((h: string) => /Download-Ordner/.test(h)),
      true,
    )
    assert.equal(
      a.body.ablageHinweise.some((h: string) => /KEIN Abbild/.test(h)),
      true,
    )
  })

  it('sagt es ANSAGE, wenn die Anmeldung ausgeschaltet ist', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const app = express()
    app.use(
      sicherungWegeBauen({
        skript: k.skript,
        staende: k.staende,
        vorspann: [],
        anmeldungOffen: () => true,
      }),
    )
    const a = await request(app).get('/api/sicherung').expect(200)
    assert.equal(a.body.anmeldungOffen, true)
  })
})

describe('Sicherung — anlegen und herunterladen', () => {
  it('liefert das Archiv als Download mit sprechendem Namen', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const a = await request(k.app).post('/api/sicherung/anlegen').send({}).expect(200)
    assert.match(String(a.headers['content-disposition']), /mupibox-sicherung-mupibox-2026/)
    assert.equal(a.headers['content-type'], 'application/gzip')
    // Es sind wirklich die Bytes des Standes, nicht eine Beschreibung davon.
    assert.equal(standKopfLesen(a.body).dateien.length, 2)
  })

  it('gibt OHNE Zugangsdaten auch kein Passwort weiter', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    await request(k.app).post('/api/sicherung/anlegen').send({}).expect(200)
    const l = laeufe(k.spur).filter((x) => x.argv.includes('--anlegen'))
    assert.equal(l.length, 1)
    assert.equal(l[0]?.argv.includes('--mit-zugangsdaten'), false)
    assert.equal(l[0]?.stdin, '')
  })

  it('DAS PASSWORT STEHT IN KEINEM ARGUMENT UND IN KEINER UMGEBUNG', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const PW = 'ein-sehr-langes-geheimnis-42'
    // Der Stub legt einen Stand OHNE Zugangsdaten ab; der Weg lehnt das
    // danach ab (siehe naechster Test). Uns interessiert hier nur, WIE das
    // Passwort beim Python ankommt.
    await request(k.app).post('/api/sicherung/anlegen').send({ mitZugangsdaten: true, passwort: PW })
    const l = laeufe(k.spur).filter((x) => x.argv.includes('--anlegen'))
    assert.equal(l.length, 1)
    const lauf = l[0]
    assert.ok(lauf)
    // 1. nicht in argv — `ps` zeigt argv jedem Benutzer der Box.
    assert.equal(
      lauf.argv.some((a) => a.includes(PW)),
      false,
      'das Passwort stand in einem Argument',
    )
    // 2. nicht in der Umgebung — /proc/<pid>/environ ist fuer jeden Vorgang
    //    desselben Benutzers lesbar, auf dieser Box also fuer den
    //    Abspieldienst.
    assert.equal(
      Object.values(lauf.env).some((v) => String(v).includes(PW)),
      false,
      'das Passwort stand in der Umgebung',
    )
    // 3. sondern ueber stdin — genau eine Zeile.
    assert.equal(lauf.stdin, `${PW}\n`)
    // 4. und `--mit-zugangsdaten` heftet den Stand an, damit die Auslese
    //    einen Stand, fuer den jemand ein Passwort getippt hat, nicht
    //    wegwirft.
    assert.ok(lauf.argv.includes('--mit-zugangsdaten'))
    assert.ok(lauf.argv.includes('--behalten'))
  })

  it('laedt NICHTS herunter, wenn die Zugangsdaten trotz Passwort fehlen', async () => {
    // Der haeufigste Grund waere ein fehlendes gpg. Eine Datei, die
    // vollstaendig AUSSIEHT und es nicht ist, ist schlimmer als eine
    // Fehlermeldung — sie faellt erst auf, wenn jemand sie braucht.
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const a = await request(k.app)
      .post('/api/sicherung/anlegen')
      .send({ mitZugangsdaten: true, passwort: 'ein-sehr-langes-geheimnis-42' })
      .expect(500)
    assert.match(a.body.fehler, /OHNE die Zugangsdaten/)
    assert.match(a.body.fehler, /gpg/)
  })

  it('weist ein zu kurzes Passwort ab, BEVOR etwas laeuft', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    await request(k.app).post('/api/sicherung/anlegen').send({ mitZugangsdaten: true, passwort: 'kurz' }).expect(400)
    assert.equal(laeufe(k.spur).length, 0)
  })
})

describe('Sicherung — zurueckspielen in zwei Schritten', () => {
  const archiv = () => standArchiv(STAND_VORGABE)

  it('Schritt 1 fasst nichts an und antwortet mit ZAHLEN', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const a = await request(k.app)
      .post('/api/sicherung/pruefen')
      .set('Content-Type', 'application/gzip')
      .send(archiv())
      .expect(200)
    assert.equal(a.body.kennung, sha256(archiv()))
    assert.equal(a.body.plan.aendert.length, 1)
    assert.equal(a.body.plan.unveraendert.length, 1)
    assert.match(a.body.satz, /1 Datei wird ueberschrieben/)
    // TROCKEN — und zwar nachgewiesen am Argument, nicht geglaubt.
    const l = laeufe(k.spur).filter((x) => x.argv.includes('--wiederherstellen'))
    assert.ok(l[0]?.argv.includes('--trocken'))
    // Und OHNE Passwort: fuer den Plan wird keines gebraucht, und was man
    // nicht braucht, soll man nicht eingeben muessen.
    assert.equal(l[0]?.stdin, '')
    assert.equal(l[0]?.argv.includes('--mit-zugangsdaten'), false)
  })

  it('legt die geprueften Bytes als EINGANG ab, nicht als Stand', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    await request(k.app)
      .post('/api/sicherung/pruefen')
      .set('Content-Type', 'application/gzip')
      .send(archiv())
      .expect(200)
    const drin = readdirSync(k.staende) as string[]
    assert.equal(drin.length, 1)
    assert.ok(drin[0]?.startsWith(EINGANG_VORSILBE))
    // Und er taucht in der Liste der Staende NICHT auf.
    const a = await request(k.app).get('/api/sicherung').expect(200)
    assert.deepEqual(a.body.staende, [])
  })

  it('lehnt eine Datei ab, die keine Sicherung ist — ohne Python zu rufen', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const a = await request(k.app)
      .post('/api/sicherung/pruefen')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('Urlaubsfoto'))
      .expect(400)
    assert.match(a.body.fehler, /keine MuPiBox-Sicherung/)
    assert.equal(laeufe(k.spur).length, 0)
  })

  it('lehnt eine zu neue Fassung ab, ohne sie abzulegen', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    await request(k.app)
      .post('/api/sicherung/pruefen')
      .set('Content-Type', 'application/gzip')
      .send(standArchiv({ ...STAND_VORGABE, format: 99 }))
      .expect(400)
    assert.deepEqual(readdirSync(k.staende), [])
  })

  it('Schritt 2 SPIELT NUR DIE BYTES EIN, ueber denen die Zahlen standen', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const v = await request(k.app)
      .post('/api/sicherung/pruefen')
      .set('Content-Type', 'application/gzip')
      .send(archiv())
      .expect(200)
    // Jemand tauscht die Datei im Eingang zwischen Vorschau und Klick aus.
    writeFileSync(
      join(k.staende, eingangName(v.body.kennung)),
      standArchiv({ ...STAND_VORGABE, grund: 'ein-ganz-anderer-stand' }),
    )
    const a = await request(k.app).post('/api/sicherung/zurueckspielen').send({ kennung: v.body.kennung }).expect(409)
    assert.match(a.body.fehler, /NICHTS eingespielt/)
    assert.equal(
      laeufe(k.spur).filter((x) => x.argv.includes('--wiederherstellen') && !x.argv.includes('--trocken')).length,
      0,
    )
  })

  it('Schritt 2 ohne Vorschau geht gar nicht', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    await request(k.app).post('/api/sicherung/zurueckspielen').send({}).expect(400)
    await request(k.app)
      .post('/api/sicherung/zurueckspielen')
      .send({ kennung: 'f'.repeat(64) })
      .expect(410)
    assert.equal(laeufe(k.spur).length, 0)
  })

  it('Schritt 2 nennt den Stand «vorher» — den Rueckweg AUS dem Rueckweg', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const v = await request(k.app)
      .post('/api/sicherung/pruefen')
      .set('Content-Type', 'application/gzip')
      .send(archiv())
      .expect(200)
    const a = await request(k.app).post('/api/sicherung/zurueckspielen').send({ kennung: v.body.kennung }).expect(200)
    assert.match(String(a.body.vorherStand), /vor-wiederherstellung/)
    assert.equal(a.body.neustartNoetig, true)
    // Der Eingang liegt danach nicht mehr herum — er traegt die halbe
    // Konfiguration einer Box.
    assert.deepEqual(readdirSync(k.staende), [])
  })

  it('«--trotzdem» IST UEBER DIE API NICHT ERREICHBAR', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const v = await request(k.app)
      .post('/api/sicherung/pruefen')
      .set('Content-Type', 'application/gzip')
      .send(archiv())
      .expect(200)
    // Der Koerper darf verlangen, was er will.
    await request(k.app)
      .post('/api/sicherung/zurueckspielen')
      .send({ kennung: v.body.kennung, trotzdem: true, '--trotzdem': true })
      .expect(200)
    for (const l of laeufe(k.spur)) {
      assert.equal(
        l.argv.includes('--trotzdem'),
        false,
        'die API hat --trotzdem weitergereicht — der Schalter uebergeht genau die Pruefungen, die eine unbrauchbare Box verhindern',
      )
    }
  })

  it('sagt bei einem Stand, der die Box unbrauchbar machen wuerde: NICHTS geschrieben', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    process.env['MUPI_STUB_SCHEITERT'] = '1'
    try {
      const a = await request(k.app)
        .post('/api/sicherung/pruefen')
        .set('Content-Type', 'application/gzip')
        .send(archiv())
        .expect(400)
      assert.match(a.body.fehler, /NICHT geschrieben/)
      assert.match(a.body.fehler, /audioDevice/)
    } finally {
      process.env['MUPI_STUB_SCHEITERT'] = ''
    }
  })
})

/* ══ Die Warnung, die niemand gehoert hat ══════════════════════════════ */

/**
 * JEDE AUSSAGE HIER WAERE VOR DEM 07.08.2026 ROT GEWESEN, und zwar nicht,
 * weil sie falsch formuliert war, sondern weil es den Kanal nicht gab:
 * `standKopfLesen` las das Feld `unbekannt` NICHT, `/api/sicherung` gab es
 * nicht weiter, und `/api/sicherung/anlegen` verwirft stdout vollstaendig
 * (die Antwort SIND die Archivbytes). Die Warnung des Pythons — „! nicht
 * eingeordnet, NICHT gesichert: <datei>" — hatte damit keinen Empfaenger.
 *
 * SO IST `server/config/profile.json` AUS JEDER SICHERUNG GEFALLEN. Deshalb
 * ist die WICHTIGSTE Aussage unten nicht „die Warnung kommt an", sondern die
 * daneben: DIE BEWUSST AUSGELASSENEN DATEIEN WARNEN NICHT. Eine Warnung, die
 * bei jeder Sicherung erscheint, ist nach dreimal unsichtbar — dann waere der
 * Kanal zwar da und trotzdem taub.
 */
const STAND_MIT_UNBEKANNT = {
  ...STAND_VORGABE,
  // Zwei Sorten, und der Unterschied ist der ganze Punkt:
  nicht_dabei: [
    { pfad: 'etc/mupibox/tls', bytes: null, warum: 'Schluesselmaterial (E15) — nicht in eine Sicherung' },
    { pfad: 'server/config/data.json.bak', bytes: 4096, warum: 'Altlast der Praxis von Hand' },
  ],
  unbekannt: [
    {
      pfad: 'server/config/neuartige-ablage.json',
      bytes: 812,
      warum: 'steht auf KEINER der beiden Listen — wird NICHT mitgesichert.',
    },
  ],
}

describe('Sicherung — was nicht eingeordnet wurde, kommt bei einem Menschen an', () => {
  it('standKopfLesen liest das Feld «unbekannt» ueberhaupt', () => {
    const k = standKopfLesen(standArchiv(STAND_MIT_UNBEKANNT))
    assert.equal(k.nichtEingeordnet.length, 1)
    assert.equal(k.nichtEingeordnet[0]?.pfad, 'server/config/neuartige-ablage.json')
    assert.equal(k.nichtEingeordnet[0]?.bytes, 812)
  })

  it('DAS ABSICHTLICH AUSGELASSENE WARNT NICHT — sonst ist die Warnung Rauschen', () => {
    const k = standKopfLesen(standArchiv(STAND_MIT_UNBEKANNT))
    const pfade = k.nichtEingeordnet.map((u) => u.pfad)
    assert.equal(pfade.includes('etc/mupibox/tls'), false, 'Schluesselmaterial hat gewarnt')
    assert.equal(pfade.includes('server/config/data.json.bak'), false, 'eine Altlast hat gewarnt')
  })

  it('schweigt, wenn nichts anliegt — der Normalfall', () => {
    const k = standKopfLesen(standArchiv(STAND_VORGABE))
    assert.deepEqual(k.nichtEingeordnet, [])
    assert.deepEqual(nichtEingeordnetDeuten(k.nichtEingeordnet, 'jetzt'), { pfade: [], satz: '', rat: [] })
    assert.deepEqual(nichtEingeordnetDeuten(k.nichtEingeordnet, 'stand'), { pfade: [], satz: '', rat: [] })
  })

  it('sagt nicht nur WAS fehlt, sondern was das bedeutet', () => {
    const b = nichtEingeordnetDeuten(standKopfLesen(standArchiv(STAND_MIT_UNBEKANNT)).nichtEingeordnet, 'jetzt')
    assert.match(b.satz, /KEINE Sicherung/)
    // Die Folge — ohne sie ist „nicht gesichert" eine Vokabel, keine Auskunft.
    assert.equal(
      b.rat.some((r) => /Kartenschaden/.test(r)),
      true,
    )
    // Wer nichts dafuer kann, soll das lesen — und wissen, womit er sich meldet.
    assert.equal(
      b.rat.some((r) => /Fehler in der Box-Software/.test(r)),
      true,
    )
    // Und: das hier ist KEIN Grund, das Zurueckspielen zu meiden.
    assert.equal(
      b.rat.some((r) => /Zurückspielen/.test(r)),
      true,
    )
  })

  it('sagt VOR dem Zurueckspielen etwas anderes als beim Sichern', () => {
    const liste = standKopfLesen(standArchiv(STAND_MIT_UNBEKANNT)).nichtEingeordnet
    const s = nichtEingeordnetDeuten(liste, 'stand')
    assert.match(s.satz, /NICHT in ihm/)
    // Der Satz, der die Angst nimmt: der Rueckweg bleibt gefahrlos.
    assert.equal(
      s.rat.some((r) => /weder überschrieben noch gelöscht/.test(r)),
      true,
    )
    // Und der, der die Folge nennt: auf einer NEUEN Box fehlt es dann.
    assert.equal(
      s.rat.some((r) => /NEU aufgesetzte Box/.test(r)),
      true,
    )
  })

  it('GET /api/sicherung traegt es hinaus — mit Pfad, ohne Klick', async () => {
    const k = sandkasten(STAND_MIT_UNBEKANNT)
    kaesten.push(k.wurzel)
    // Ein Stand, wie ihn der Zeitgeber von selbst angelegt haette.
    writeFileSync(
      join(k.staende, 'mupibox-sicherung-20260807-091400-zeitgeber.tar.gz'),
      standArchiv(STAND_MIT_UNBEKANNT),
    )
    const a = await request(k.app).get('/api/sicherung').expect(200)
    assert.ok(a.body.nichtEingeordnet, 'die Lage sagt nichts von der nicht eingeordneten Ablage')
    assert.deepEqual(a.body.nichtEingeordnet.pfade, ['server/config/neuartige-ablage.json'])
    assert.match(a.body.nichtEingeordnet.satz, /KEINE Sicherung/)
    assert.equal(a.body.nichtEingeordnet.stand, 'mupibox-sicherung-20260807-091400-zeitgeber.tar.gz')
  })

  it('GET /api/sicherung schweigt im Normalfall — null, nicht eine leere Huelse', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    writeFileSync(join(k.staende, 'mupibox-sicherung-20260807-091400-zeitgeber.tar.gz'), standArchiv(STAND_VORGABE))
    const a = await request(k.app).get('/api/sicherung').expect(200)
    assert.equal(a.body.nichtEingeordnet, null)
  })

  it('ein unlesbarer Stand wirft die Lage nicht um — wird aber GESAGT', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    writeFileSync(join(k.staende, 'mupibox-sicherung-20260807-091400-kaputt.tar.gz'), Buffer.from('kein gzip'))
    const a = await request(k.app).get('/api/sicherung').expect(200)
    // DIE SEITE STEHT — das war die urspruengliche Forderung und sie gilt weiter.
    assert.equal(a.body.ok, true)
    // NEU (07.08.2026): sie steht nicht mehr STILL da. Bis dahin gab
    // `letzteNichtEingeordnet` bei jedem Fehler `null` zurueck, und ein
    // kaputter neuester Stand — also genau der, der im Ernstfall
    // zurueckgespielt wuerde — war in der Antwort mit keinem Wort erwaehnt.
    assert.ok(a.body.nichtEingeordnet, 'der kaputte Stand wird verschwiegen')
    assert.match(a.body.nichtEingeordnet.satz, /nicht öffnen/)
    assert.equal(a.body.nichtEingeordnet.stand, 'mupibox-sicherung-20260807-091400-kaputt.tar.gz')
    assert.ok(
      a.body.nichtEingeordnet.rat.some((r: string) => r.includes('kaputt.tar.gz')),
      'der Name des kaputten Standes fehlt im Rat',
    )
  })

  it('DER NEUERE STAND IST KAPUTT — der Fund aus dem aelteren bleibt trotzdem stehen', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    // Genau die gemessene Lage: ein gueltiger Stand MIT Fund, und daneben ein
    // NEUERER, der kein gzip ist. Vorher verschwand damit die ganze Warnung.
    writeFileSync(
      join(k.staende, 'mupibox-sicherung-20260807-091400-zeitgeber.tar.gz'),
      standArchiv(STAND_MIT_UNBEKANNT),
    )
    writeFileSync(join(k.staende, 'mupibox-sicherung-20260807-235900-kaputt.tar.gz'), Buffer.from('kein gzip'))
    const a = await request(k.app).get('/api/sicherung').expect(200)
    const n = a.body.nichtEingeordnet
    assert.ok(n, 'die Warnung ist verschwunden, weil der NEUESTE Stand unlesbar war')
    assert.deepEqual(n.pfade, ['server/config/neuartige-ablage.json'])
    // Und die Auskunft sagt dazu, aus welchem Stand sie stammt.
    assert.equal(n.stand, 'mupibox-sicherung-20260807-091400-zeitgeber.tar.gz')
    assert.ok(
      n.rat.some((r: string) => r.includes('235900-kaputt.tar.gz')),
      'der uebersprungene Stand wird nicht genannt',
    )
  })

  it('DER DECKEL: 400 Stellen ergeben keine Wand, aber die Zahl bleibt wahr', () => {
    const liste = Array.from({ length: 400 }, (_, i) => ({
      pfad: `/home/dietpi/${'x'.repeat(200)}/${i}.json`,
      bytes: 1,
      warum: '',
    }))
    const b = nichtEingeordnetDeuten(liste, 'jetzt')
    assert.equal(b.pfade.length, NICHT_EINGEORDNET_HOECHSTENS)
    // DIE ZAHL IM SATZ IST DIE VOLLE — der Deckel darf die Warnung nicht
    // kleiner machen, als sie ist.
    assert.match(b.satz, /^400 Ablagen/)
    assert.ok(b.rat.some((r) => r.includes('380 weitere')))
    for (const p of b.pfade) assert.ok(p.length <= PFAD_HOECHSTENS_ZEICHEN, `Pfad zu lang: ${p.length}`)
    // Anfang UND Ende bleiben lesbar — beide tragen die Auskunft.
    assert.ok(b.pfade[0].startsWith('/home/dietpi/'))
    assert.ok(b.pfade[0].endsWith('0.json'))
    const bytes = Buffer.byteLength(JSON.stringify(b))
    assert.ok(bytes < 6000, `die Antwort ist mit ${bytes} Zeichen immer noch eine Wand`)
  })

  it('DER DOWNLOAD SAGT ES MIT, obwohl sein Rumpf die Archivbytes sind', async () => {
    const k = sandkasten(STAND_MIT_UNBEKANNT)
    kaesten.push(k.wurzel)
    const a = await request(k.app).post('/api/sicherung/anlegen').send({}).expect(200)
    // Genau hier ist die Warnung bisher verendet: stdout wird verworfen.
    assert.equal(a.headers['x-mupi-nicht-eingeordnet'], '1')
  })

  it('… und meldet 0, wenn nichts herausgefallen ist', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const a = await request(k.app).post('/api/sicherung/anlegen').send({}).expect(200)
    assert.equal(a.headers['x-mupi-nicht-eingeordnet'], '0')
  })

  it('die Vorschau vorm Zurueckspielen sagt, was dieser Stand NIE enthielt', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const a = await request(k.app)
      .post('/api/sicherung/pruefen')
      .set('Content-Type', 'application/gzip')
      .send(standArchiv(STAND_MIT_UNBEKANNT))
      .expect(200)
    assert.deepEqual(a.body.stand.nichtEingeordnet.pfade, ['server/config/neuartige-ablage.json'])
    assert.match(a.body.stand.nichtEingeordnet.satz, /NICHT in ihm/)
  })

  it('die Vorschau schweigt bei einem sauberen Stand', async () => {
    const k = sandkasten()
    kaesten.push(k.wurzel)
    const a = await request(k.app)
      .post('/api/sicherung/pruefen')
      .set('Content-Type', 'application/gzip')
      .send(standArchiv(STAND_VORGABE))
      .expect(200)
    assert.deepEqual(a.body.stand.nichtEingeordnet.pfade, [])
    assert.equal(a.body.stand.nichtEingeordnet.satz, '')
  })
})
