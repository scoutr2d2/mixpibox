import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { loeschenAusfuehren, loeschgliedAusUrl, loeschplanBauen } from './loeschen'

/*
 * DIE FUENF GEMESSENEN FAELLE — und die Gegenprobe.
 *
 * Jeder Fall hier hat drueben in tools/loeschbefehl-nachbauen.mjs einen
 * `rm -r`, der wirklich so entstanden waere. Was hier steht, ist die Antwort
 * darauf. Die Gegenprobe (der GEWOLLTE Fall loescht weiter) steht ganz unten
 * und ist die wichtigste Zeile der Datei: ein Schutz, der auch das Richtige
 * verhindert, wird umgangen, und dann ist niemandem geholfen.
 *
 * Die Kette von der Oberflaeche bis zur Platte faehrt tools/loeschen-sandkasten.ts
 * gegen echte Ordner; hier steht die Entscheidung fuer sich.
 */

/** Genau die Zeile aus player.service.ts:233 — der Anfang der Kette. */
const urlWieOberflaeche = (kategorie: string, interpret: string, titel: string) =>
  `/current/deletelocal/${encodeURIComponent(kategorie)}:${encodeURIComponent(interpret)}:${encodeURIComponent(titel)}`

const plan = (kategorie: string, interpret: string, titel: string, wurzel = '/media') =>
  loeschplanBauen(loeschgliedAusUrl(urlWieOberflaeche(kategorie, interpret, titel)), wurzel)

// ── A: DER PUNKT IM TITEL ────────────────────────────────────────────────────

test('„Folge 12. Der Ausflug" bleibt ganz — path.parse haette hier abgeschnitten', () => {
  const p = plan('audiobook', 'Benjamin', 'Folge 12. Der Ausflug')
  assert.equal(p.ok, true)
  assert.equal(p.ok && p.pfad, '/media/audiobook/Benjamin/Folge 12. Der Ausflug')
  // Der Nachweis, dass das kein Zufall ist: so sah es vorher aus.
  assert.equal(
    path.parse(urlWieOberflaeche('audiobook', 'Benjamin', 'Folge 12. Der Ausflug')).name.endsWith('12'),
    true,
  )
})

test('„Vol. 2" und „Dr. Brumm" ueberleben ebenfalls', () => {
  const a = plan('music', 'Rolf Zuckowski', 'Vol. 2')
  assert.equal(a.ok && a.pfad, '/media/music/Rolf Zuckowski/Vol. 2')
  const b = plan('audiobook', 'Dr. Brumm', 'Folge 1')
  assert.equal(b.ok && b.pfad, '/media/audiobook/Dr. Brumm/Folge 1')
})

// ── B: DAS LEERE GLIED ───────────────────────────────────────────────────────

test('leerer Titel loescht NICHT alle Alben des Interpreten', () => {
  const p = plan('audiobook', 'Bibi', '')
  assert.equal(p.ok, false)
  assert.match(p.ok === false ? p.grund : '', /Titel fehlt/)
})

test('leerer Interpret UND Titel loescht NICHT die ganze Kategorie', () => {
  const p = plan('audiobook', '', '')
  assert.equal(p.ok, false)
  assert.match(p.ok === false ? p.grund : '', /Interpret fehlt/)
})

test('ein Titel aus lauter Leerzeichen zaehlt als leer', () => {
  assert.equal(plan('audiobook', 'Bibi', '   ').ok, false)
})

// ── C: DIE SHELL ─────────────────────────────────────────────────────────────

test('ein Anfuehrungszeichen im Titel ist ein Zeichen, kein Befehl', () => {
  // Es gibt keine Shell mehr, in die man ausbrechen koennte — der Name geht
  // unveraendert als ORDNERNAME durch. Dass er nicht existiert, faellt erst
  // am Dateisystem auf, und dann als ehrliches „nicht vorhanden".
  const p = plan('audiobook', 'Bibi', 'x" ; touch beleg ; "')
  assert.equal(p.ok, true)
  assert.equal(p.ok && p.titel, 'x" ; touch beleg ; "')
  assert.equal(p.ok && p.pfad, '/media/audiobook/Bibi/x" ; touch beleg ; "')
})

test('der gemessene Ausbruch trifft ZUSAETZLICH auf den Schraegstrich-Riegel', () => {
  // Der Fall aus der Messung lautete `x" ; touch /tmp/beleg ; "` — der ging
  // frueher als drei Shell-Befehle durch. Heute scheitert er schon daran,
  // dass ein Ordnername keinen Schraegstrich enthaelt. Beide Riegel greifen
  // unabhaengig voneinander; das ist Absicht.
  const p = plan('audiobook', 'Bibi', 'x" ; touch /tmp/beleg ; "')
  assert.equal(p.ok, false)
  assert.match(p.ok === false ? p.grund : '', /Schraegstrich/)
})

// ── DIE WEGE NACH DRAUSSEN ───────────────────────────────────────────────────

test('`..` im Feld kommt nicht durch', () => {
  assert.equal(plan('audiobook', '..', '..').ok, false)
  assert.equal(plan('..', '..', '..').ok, false)
})

test('doppelt verschluesseltes `..` bleibt ein Dateiname', () => {
  // Der alte Weg entschluesselte ZWEIMAL (decodeURI, dann decodeURIComponent):
  // aus `%252e%252e` wurde `%2e%2e` wurde `..`. Hier wird genau einmal
  // entschluesselt, der Name bleibt also `%2e%2e`.
  const p = loeschplanBauen('audiobook:Bibi:%252e%252e', '/media')
  assert.equal(p.ok, true)
  assert.equal(p.ok && p.titel, '%2e%2e')
  assert.equal(p.ok && p.pfad, '/media/audiobook/Bibi/%2e%2e')
})

test('ein Schraegstrich im Feld ist keine weitere Ebene', () => {
  // „AC/DC" ist ein echter Interpretenname. Auf der Platte kann er so nicht
  // heissen (der Erzeuger nimmt `basename`), und stillschweigend eine Ebene
  // tiefer zu gehen waere geraten. Also: abgelehnt, mit Grund.
  const p = plan('music', 'AC/DC', 'Back in Black')
  assert.equal(p.ok, false)
  assert.match(p.ok === false ? p.grund : '', /Schraegstrich/)
})

test('ein RUECKWAERTSschraegstrich ist ein gewoehnliches Zeichen und kommt durch', () => {
  // GEGENPROBE ZUM RIEGEL DARUEBER, und sie hat ihn korrigiert: die erste
  // Fassung wies `\` mit ab. Unter Linux ist er aber kein Pfadtrenner, sondern
  // ein erlaubtes Zeichen im Dateinamen — `media/music/AC\DC/Album/` ist ein
  // Ordner wie jeder andere. Gemessen an einem echten Ordner mit
  // tools/loeschen-echte-namen.ts: ALT loeschte ihn, NEU verweigerte ihn.
  // Ein Schutz, der auch das Richtige verhindert, wird umgangen.
  const p = plan('music', 'AC\\DC', 'Album')
  assert.equal(p.ok, true)
  assert.equal(p.ok && p.interpret, 'AC\\DC')
  assert.equal(p.ok && p.pfad, '/media/music/AC\\DC/Album')
})

test('ein absoluter Pfad im Feld kommt nicht durch', () => {
  assert.equal(loeschplanBauen('audiobook:Bibi:%2Fetc', '/media').ok, false)
})

test('mehr oder weniger als drei Glieder wird abgelehnt', () => {
  assert.equal(loeschplanBauen('audiobook', '/media').ok, false)
  assert.equal(loeschplanBauen('audiobook:Bibi', '/media').ok, false)
  assert.equal(loeschplanBauen('audiobook:Bibi:Folge 1:extra', '/media').ok, false)
})

test('eine kaputte Prozentfolge wirft nicht, sie wird abgelehnt', () => {
  // „50% Rabatt" — dieses Projekt hat diesen Namen an mpv-protokoll.ts schon
  // einmal bezahlt. `decodeURIComponent('50% Rabatt')` wirft URIError.
  const p = loeschplanBauen('music:Sammlung:50% Rabatt', '/media')
  assert.equal(p.ok, false)
  assert.match(p.ok === false ? p.grund : '', /nicht lesbar/)
})

// ── DAS GLIED AUS DER URL ────────────────────────────────────────────────────

test('das Glied wird nach POSITION genommen, nicht nach Punkt', () => {
  assert.equal(loeschgliedAusUrl('/current/deletelocal/a:b:c'), 'a:b:c')
  assert.equal(loeschgliedAusUrl('/2f8b1/deletelocal/a:b:c%2E1'), 'a:b:c%2E1')
  assert.equal(loeschgliedAusUrl('/current/deletelocal/a:b:c?x=1'), 'a:b:c')
})

test('ohne deletelocal-Glied gibt es kein Ziel', () => {
  assert.equal(loeschgliedAusUrl('/current/stop'), null)
  assert.equal(loeschgliedAusUrl('/current/deletelocal/'), null)
  assert.equal(loeschgliedAusUrl('/current/deletelocal/a:b:c/noch/mehr'), null)
})

// ── AM ECHTEN DATEISYSTEM ────────────────────────────────────────────────────

async function sandkasten(): Promise<string> {
  const wurzel = await fsp.mkdtemp(path.join(os.tmpdir(), 'mupi-loeschen-'))
  await fsp.mkdir(path.join(wurzel, 'media/audiobook/Benjamin/Folge 12. Der Ausflug'), { recursive: true })
  await fsp.writeFile(path.join(wurzel, 'media/audiobook/Benjamin/Folge 12. Der Ausflug/01.mp3'), 'ton')
  await fsp.mkdir(path.join(wurzel, 'media/audiobook/Benjamin/Folge 13'), { recursive: true })
  await fsp.mkdir(path.join(wurzel, 'draussen'), { recursive: true })
  await fsp.writeFile(path.join(wurzel, 'draussen/wichtig.txt'), 'bleibt')
  return wurzel
}

test('DIE GEGENPROBE: der gewollte Fall loescht wirklich', async () => {
  const w = await sandkasten()
  const medien = path.join(w, 'media')
  const ausgang = await loeschenAusfuehren(
    loeschgliedAusUrl(urlWieOberflaeche('audiobook', 'Benjamin', 'Folge 12. Der Ausflug')),
    medien,
  )
  assert.equal(ausgang.ok, true)
  await assert.rejects(() => fsp.stat(path.join(medien, 'audiobook/Benjamin/Folge 12. Der Ausflug')))
  // Und NUR das: der Nachbarordner steht noch.
  assert.equal((await fsp.stat(path.join(medien, 'audiobook/Benjamin/Folge 13'))).isDirectory(), true)
  await fsp.rm(w, { recursive: true, force: true })
})

test('was nicht da ist, wird nicht als geloescht gemeldet', async () => {
  const w = await sandkasten()
  const ausgang = await loeschenAusfuehren('audiobook:Benjamin:Folge 99', path.join(w, 'media'))
  assert.equal(ausgang.ok, false)
  assert.match(ausgang.ok === false ? ausgang.grund : '', /nicht vorhanden/)
  await fsp.rm(w, { recursive: true, force: true })
})

test('eine Verknuepfung traegt das Loeschen NICHT aus dem Medienordner heraus', async () => {
  const w = await sandkasten()
  const medien = path.join(w, 'media')
  // Der Interpretenordner ist eine Verknuepfung nach draussen. Als
  // Zeichenkette liegt das Ziel sauber unter `media` — aufgeloest nicht.
  await fsp.symlink(path.join(w, 'draussen'), path.join(medien, 'audiobook/Fremd'))
  await fsp.mkdir(path.join(w, 'draussen/Album'), { recursive: true })
  const ausgang = await loeschenAusfuehren('audiobook:Fremd:Album', medien)
  assert.equal(ausgang.ok, false)
  assert.equal((await fsp.stat(path.join(w, 'draussen/Album'))).isDirectory(), true)
  assert.equal((await fsp.stat(path.join(w, 'draussen/wichtig.txt'))).isFile(), true)
  await fsp.rm(w, { recursive: true, force: true })
})

test('ein Album, das selbst eine Verknuepfung ist, wird abgelehnt', async () => {
  const w = await sandkasten()
  const medien = path.join(w, 'media')
  await fsp.symlink(path.join(w, 'draussen'), path.join(medien, 'audiobook/Benjamin/Verweis'))
  const ausgang = await loeschenAusfuehren('audiobook:Benjamin:Verweis', medien)
  assert.equal(ausgang.ok, false)
  assert.equal((await fsp.stat(path.join(w, 'draussen/wichtig.txt'))).isFile(), true)
  await fsp.rm(w, { recursive: true, force: true })
})

/**
 * DER FALL, DEN DIE PRUEFUNG DARUEBER NICHT ABDECKTE (07.08.2026, nachgemessen).
 *
 * Der Verweis dort zeigt nach `draussen`, also AUS dem Medienordner heraus.
 * Damit greift schon die aufgeloeste Einschlusspruefung (`tiefePruefen` gegen
 * `realpath`) — dieselbe, die die Pruefung „eine Verknuepfung traegt das
 * Loeschen NICHT aus dem Medienordner heraus" belegt. Nimmt man
 * `art.isSymbolicLink()` heraus, bleibt jene Pruefung deshalb GRUEN: ihr Name
 * verspricht mehr, als sie festnagelt.
 *
 * Hier zeigt der Verweis auf den NACHBARN im selben Interpretenordner. Er
 * bleibt aufgeloest innerhalb von `media` und liegt genau drei Ebenen tief —
 * die Einschluss- und die Tiefenpruefung sagen beide ja. Was den Fall
 * abfaengt, ist die Ordnerfrage: `lstat` beschreibt den VERWEIS selbst, und
 * der ist kein Verzeichnis. Genau das wird hier festgehalten, samt der
 * einzigen Aussage, auf die es ankommt: das Nachbaralbum steht danach noch.
 */
test('ein Verweis auf den NACHBARN loescht nicht das Nachbaralbum', async () => {
  const w = await sandkasten()
  const medien = path.join(w, 'media')
  const nachbar = path.join(medien, 'audiobook/Benjamin/Folge 13')
  await fsp.writeFile(path.join(nachbar, '01.mp3'), 'ton')
  await fsp.symlink(nachbar, path.join(medien, 'audiobook/Benjamin/Verweis'))

  const ausgang = await loeschenAusfuehren('audiobook:Benjamin:Verweis', medien)

  assert.equal(ausgang.ok, false)
  // Das Nachbaralbum und sein Inhalt sind unberuehrt — nicht nur der Verweis.
  assert.equal((await fsp.stat(nachbar)).isDirectory(), true)
  assert.equal((await fsp.stat(path.join(nachbar, '01.mp3'))).isFile(), true)
  await fsp.rm(w, { recursive: true, force: true })
})

test('fehlt das Medienverzeichnis, ist das ein Fehler und kein Erfolg', async () => {
  const ausgang = await loeschenAusfuehren('audiobook:Bibi:Folge 1', '/gibt/es/nicht')
  assert.equal(ausgang.ok, false)
  assert.match(ausgang.ok === false ? ausgang.grund : '', /nicht gefunden/)
})
