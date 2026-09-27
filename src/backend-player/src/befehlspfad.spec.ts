import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import { abAusName, adresseAusPfad, dateiPfadErlaubt, medienPfadAus, titelAusName, verbAusPfad } from './befehlspfad'

/*
 * VON JEDER SORTE EINE: der Normalfall, der Fall mit dem tueckischen
 * Raumnamen, der unkodierte, der kaputt kodierte, der leere. Die Pfade sind
 * nachgebaut, wie die Oberflaechen sie wirklich schicken
 * (`${SPIELER}/${RAUM}/${befehl}`, NewDesign/app.js `spielerBefehl`).
 */

const ADRESSE = 'https://wdrmedien-a.akamaihd.net/medp/ondemand/de/fsk0/300/3001234/3001234_MP3-128.mp3'

test('holt die Adresse aus einem ard-Befehl', () => {
  const url = `/current/ard/${encodeURIComponent(ADRESSE)}/Bald%20nur%20noch:title:artist:WDR`
  assert.equal(adresseAusPfad(path.parse(url).dir), ADRESSE)
})

test('holt die Adresse aus einem jellyfin-Befehl (unveraendertes Verhalten)', () => {
  const jf = 'https://jf.example.com/Audio/abc/stream?static=true&api_key=KEY123'
  const url = `/current/jellyfin/${encodeURIComponent(jf)}/Song:title:artist:Interpret`
  assert.equal(adresseAusPfad(path.parse(url).dir), jf)
  // Und der alte Weg (`split('jellyfin/').pop()`) kommt hier zum selben
  // Ergebnis — die Umstellung aendert den Normalfall nicht.
  assert.equal(decodeURIComponent(path.parse(url).dir.split('jellyfin/').pop() as string), jf)
})

test('DIE SORTE, DIE DAS ALTE ZERLEGEN VERFEHLT: der Raum heisst wie das Verb', () => {
  // `/standard/ard/…` enthaelt „ard/" ZWEIMAL. Wer nach der Zeichenkette
  // sucht, schneidet an der letzten Fundstelle — und bekommt hier zufaellig
  // dasselbe. Umgekehrt wird es teuer: ein Raum „ard" vor dem Verb
  // „ardqueue" liefert dem alten Weg ein Bruchstueck.
  const url = `/standard/ard/${encodeURIComponent(ADRESSE)}/Titel:title:artist:X`
  assert.equal(adresseAusPfad(path.parse(url).dir), ADRESSE)

  const url2 = `/ard/ardqueue/${encodeURIComponent(ADRESSE)}/Titel:title:artist:X`
  assert.equal(adresseAusPfad(path.parse(url2).dir), ADRESSE)
  // Der Nachweis, dass das alte Zerlegen hier eben NICHT dasselbe liefert:
  assert.notEqual(decodeURIComponent(path.parse(url2).dir.split('ard/').pop() as string), ADRESSE)
})

test('schneidet eine unkodierte Adresse nicht am ersten Schraegstrich ab', () => {
  // Sollte nicht vorkommen (die Oberflaechen kodieren), waere aber ein
  // stiller Fehler: gespielt wuerde „https:" und sonst nichts.
  assert.equal(adresseAusPfad('/current/ard/https:/x.de/a.mp3'), 'https:/x.de/a.mp3')
})

test('wirft nicht bei kaputter Kodierung', () => {
  // `decodeURIComponent('%')` wirft URIError — im Befehlszweig waere das eine
  // 500er Antwort statt Ton.
  assert.equal(adresseAusPfad('/current/ard/100%'), '100%')
})

test('gibt bei fehlender Adresse eine leere Zeichenkette', () => {
  assert.equal(adresseAusPfad('/current/ard'), '')
  assert.equal(adresseAusPfad(''), '')
  assert.equal(adresseAusPfad(null), '')
  assert.equal(adresseAusPfad(undefined), '')
})

/*
 * ── DAS VERB ───────────────────────────────────────────────────────────────
 * Diese Tests sind nicht die Probe auf eine Zerlegung, die ohnehin stimmt.
 * Sie halten die MESSUNG vom 04.08.2026 fest: welche echten Adressen die
 * alten `dir.includes(...)`-Zweige des Abspieldienstes falsch gezogen haben.
 * Wer sie „vereinfacht" zurueckbaut, bricht sie.
 */

/**
 * DIE ECHTE ADRESSE, an der es auffiel. Alles von Deutschlandfunk und
 * Deutschlandradio kommt in der ARD Audiothek ueber diesen Ausspielpartner —
 * darunter „Kakadu", das Kinderhoerspiel, also genau die Sorte Kachel, um die
 * es bei E4 geht. Gemessen mit tools/ard-modul-probe.ts zweige.
 */
const DRADIO = 'https://podcast-mp3.dradio.de/podcast/2026/08/kakadu-folge.mp3'

test('DIE MESSUNG: „dradio" enthaelt „radio" — das Verb tut es nicht', () => {
  const dir = path.parse(`/current/ard/${encodeURIComponent(DRADIO)}/Folge:title:artist:Dlf`).dir
  // Der Nachweis, dass die alte Bedingung hier WIRKLICH zuschlaegt:
  assert.ok(dir.includes('radio'), dir)
  // Und dass die neue es nicht tut.
  assert.equal(verbAusPfad(dir), 'ard')
  // Der zweite Teil des alten Schadens: `split('radio/')` findet kein
  // „radio/" (nach „dradio" steht ein Punkt) und gibt den GANZEN Pfad
  // zurueck — der dann als Adresse abgespielt wurde.
  assert.equal(dir.split('radio/').pop(), dir)
  assert.equal(adresseAusPfad(dir), DRADIO)
})

test('DIE ZWEITE MESSUNG: „ardqueue" und „jfqueue" enthalten „queue"', () => {
  // Beide zogen dadurch auch den Zweig fuer das LOKALE Anhaengen und schoben
  // eine playlist.m3u in die Warteschlange, die es gar nicht gibt.
  for (const [pfad, erwartet] of [
    [`/current/ardqueue/${encodeURIComponent(DRADIO)}/Folge:title:artist:Dlf`, 'ardqueue'],
    [`/current/jfqueue/${encodeURIComponent(DRADIO)}/Folge:title:artist:X`, 'jfqueue'],
    ['/current/queue/musik:Interpret:Album', 'queue'],
  ] as const) {
    const dir = path.parse(pfad).dir
    assert.ok(dir.includes('queue'), dir)
    assert.equal(verbAusPfad(dir), erwartet)
  }
})

test('das Verb ist die ZWEITE Stelle, nicht die erste und nicht irgendeine', () => {
  assert.equal(verbAusPfad('/current/ard/x'), 'ard')
  assert.equal(verbAusPfad('/current/musicsearch/library/album'), 'musicsearch')
  // Der Raum heisst wie ein Verb — trotzdem gewinnt die Stelle.
  assert.equal(verbAusPfad('/radio/ard/x'), 'ard')
  assert.equal(verbAusPfad('/current'), '')
  assert.equal(verbAusPfad(''), '')
  assert.equal(verbAusPfad(null), '')
})

test('Grossschreibung laeuft nicht ins Leere', () => {
  assert.equal(verbAusPfad('/current/ARD/x'), 'ard')
})

// ══ F1: DER TITELNAME AUS DEM BEFEHL ═══════════════════════════════════════
//
// Der Zweig `jfqueue`/`ardqueue` hat den Namen bis zum 06.08.2026 weggeworfen
// und nur `command.dir` benutzt. Er stand die ganze Zeit im Befehl.

test('holt den Titel aus dem letzten Stueck — jfqueue wie ardqueue', () => {
  const jf = `/current/jfqueue/${encodeURIComponent(ADRESSE)}/${encodeURIComponent('Nicht alleine')}:title:artist:${encodeURIComponent('Kapelle Petra')}`
  const ard = `/current/ardqueue/${encodeURIComponent(ADRESSE)}/${encodeURIComponent('Zu Besuch')}:title:artist:${encodeURIComponent('Die Maus')}`
  assert.equal(titelAusName(path.parse(jf).name), 'Nicht alleine')
  assert.equal(titelAusName(path.parse(ard).name), 'Zu Besuch')
})

test('SCHNEIDET GENAU WIE DIE ZWEIGE OBEN — sonst hiesse Folge 1 anders als Folge 2', () => {
  // Der Startbefehl (`ard`/`jellyfin`) zerlegt seit jeher so:
  //     decodeURIComponent(command.name).split(':title:artist:')[0]
  // Schnitte das Anhaengen anders, traege dieselbe Sendung zwei Schreibweisen,
  // und das faellt erst an einem Titel auf, den niemand als Testfall haette.
  for (const roh of ['Zu Besuch', 'Die drei ???', 'Folge 7: Der Fall', 'A & B', '100% Wolle']) {
    const name = `${encodeURIComponent(roh)}:title:artist:${encodeURIComponent('Wer')}`
    assert.equal(titelAusName(name), decodeURIComponent(name).split(':title:artist:')[0])
    assert.equal(titelAusName(name), roh)
  }
})

test('WIRFT NIE — auch nicht bei einem einzelnen Prozentzeichen', () => {
  // DER GRUND FUER DIESE FUNKTION. `decodeURIComponent('50%')` wirft
  // URIError. In den alten Zweigen ist das ein Fehler, den es dort schon
  // immer gab; das Anhaengen darf damit nicht ANFANGEN, nur weil es den Namen
  // jetzt liest. Eine 500er Antwort mitten in einer Sendung mit 30 Folgen
  // risse die halbe Warteschlange weg.
  assert.doesNotThrow(() => titelAusName('50% Rabatt:title:artist:X'))
  assert.equal(titelAusName('50% Rabatt:title:artist:X'), '50% Rabatt')
  // Zum Vergleich: der alte Weg haette hier geworfen.
  assert.throws(() => decodeURIComponent('50% Rabatt:title:artist:X'))
})

test('ohne Anhang bleibt der ganze Name stehen, Leeres bleibt leer', () => {
  assert.equal(titelAusName('Nur%20ein%20Titel'), 'Nur ein Titel')
  assert.equal(titelAusName(''), '')
  assert.equal(titelAusName(null), '')
  assert.equal(titelAusName(undefined), '')
})

test('der Vorspann-Sprung reist im Namen mit', () => {
  // Der Normalfall, so wie ard.ts ihn baut.
  assert.equal(abAusName('Der Bär:title:artist:Die Maus:ab:5'), 5)
  assert.equal(abAusName('Folge:title:artist:X:ab:5.25'), 5.25)
  // Kodiert kommt er genauso an.
  assert.equal(abAusName(encodeURIComponent('Der Bär:title:artist:Die Maus:ab:5')), 5)
})

test('ohne Angabe wird nicht gesprungen — der Befehl von gestern gilt unveraendert', () => {
  assert.equal(abAusName('Der Bär:title:artist:Die Maus'), 0)
  assert.equal(abAusName(''), 0)
  assert.equal(abAusName(null), 0)
  // Und der TITEL bleibt vom Anhang unberuehrt.
  assert.equal(titelAusName('Der Bär:title:artist:Die Maus:ab:5'), 'Der Bär')
})

test('nur das LETZTE :ab: zaehlt, und nur Zahlen', () => {
  // Ein Titel, der zufaellig so heisst, darf den Start nicht verstellen.
  assert.equal(abAusName('Die Sendung :ab: 7 Uhr:title:artist:X'), 0)
  assert.equal(abAusName('Die Sendung :ab: 7 Uhr:title:artist:X:ab:3'), 3)
  assert.equal(abAusName('Folge:title:artist:X:ab:keine'), 0)
  assert.equal(abAusName('Folge:title:artist:X:ab:-5'), 0)
  // Ein Fehlgriff darf keine Folge unhoerbar machen.
  assert.equal(abAusName('Folge:title:artist:X:ab:99999'), 600)
})

test('der Plattenpfad dekodiert JE SEGMENT — das Komma war der Messfall', () => {
  // 31.08.2026, „Team Karacho, Rola": decodeURI liess %2C stehen, der
  // m3u-Pfad zeigte auf einen Ordner, den es nie gab — Buchfuehrung
  // „spielt", Ton keiner. Betroffen war jeder Mitschnitt mit Komma.
  assert.equal(
    medienPfadAus('audiobook:Team%20Karacho%2C%20Rola:Guten%20Morgen%20_%20Good%20Morning%20(Englisch)'),
    'audiobook/Team Karacho, Rola/Guten Morgen _ Good Morning (Englisch)',
  )
  // decodeURI haette auch & und + stehenlassen.
  assert.equal(medienPfadAus('music:Ernie%20%26%20Bert:A%2BB'), 'music/Ernie & Bert/A+B')
})

test('ein kodierter Doppelpunkt IM Inhalt wird nie zum Trenner', () => {
  // Erst trennen, dann dekodieren — sonst zerfiele der Titel in zwei Ordner.
  assert.equal(medienPfadAus('music:X:Mission%3A%20Erde'), 'music/X/Mission: Erde')
})

test('ein unkodierbares Segment bleibt roh stehen, statt den Dienst umzureissen', () => {
  // Dieselbe Regel wie titelAusName: ein einzelnes % wirft in
  // decodeURIComponent eine URIError — hier faellt nur das Segment zurueck.
  assert.equal(medienPfadAus('music:100%:Titel'), 'music/100%/Titel')
  assert.equal(medienPfadAus(''), '')
  assert.equal(medienPfadAus(null), '')
})

test('der datei-Zaun laesst nur den Medienordner durch (E108)', () => {
  // Der Normalfall: eine Mitschnitt-Spur, wie die Mischliste sie schickt.
  assert.equal(
    dateiPfadErlaubt('/home/dietpi/MuPiBox/media/audiobook/Team Karacho, Rola/Guten Morgen/01 Guten Morgen.flac'),
    true,
  )
  // Ausserhalb der Basis: nichts davon spielt, egal wie plausibel es aussieht.
  assert.equal(dateiPfadErlaubt('/etc/shadow'), false)
  assert.equal(dateiPfadErlaubt('/home/dietpi/MuPiBox/config.json'), false)
  assert.equal(dateiPfadErlaubt(''), false)
  assert.equal(dateiPfadErlaubt(null), false)
})

test('der datei-Zaun faengt den Ausbruch per .., nicht den Ordnernamen mit Punkten', () => {
  // `..` als SEGMENT ist der Ausbruch — auch tief im Pfad.
  assert.equal(dateiPfadErlaubt('/home/dietpi/MuPiBox/media/music/../../.ssh/id_rsa'), false)
  assert.equal(dateiPfadErlaubt('/home/dietpi/MuPiBox/media/..'), false)
  // Punkte IM Namen sind kein Ausbruch.
  assert.equal(dateiPfadErlaubt('/home/dietpi/MuPiBox/media/music/Rock..Pop/01 x.mp3'), true)
  // Ein NUL-Byte macht Praefix-Vergleiche in C-Schnittstellen zur Luege.
  assert.equal(dateiPfadErlaubt('/home/dietpi/MuPiBox/media/a\0/etc/passwd'), false)
})
