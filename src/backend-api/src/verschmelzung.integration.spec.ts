/**
 * Die Verschmelzung ueber die Schnittstelle — der Weg, auf dem sie wirklich
 * wirkt.
 *
 * Die REGELN stehen in abgleich.spec.ts (Erkennung) und verschmelzung.spec.ts
 * (Aufloesung). Hier geht es um die fuenf Zusagen, die man einer reinen
 * Funktion nicht ansieht:
 *
 *   1. AUS ist wirklich aus. Ohne `?verschmelzen=1` liefert /api/werke Byte
 *      fuer Byte dieselbe Liste wie vorher — das ist der Rueckweg.
 *   2. Ohne Knopfdruck passiert NICHTS. Der Abgleich laeuft nicht von selbst;
 *      eingeschaltet allein aendert die Box nichts.
 *   3. Nach dem Knopfdruck sinkt die Zahl der Kacheln um GENAU die Zahl der
 *      gefundenen Paare.
 *   4. Der mehrdeutige Schluessel wird GEMELDET — mit Zeilennummern, damit er
 *      abstellbar ist. Eine eingeschaltete Verschmelzung, die dort still
 *      nichts tut, waere der teuerste denkbare Ausgang.
 *   5. Es ist umkehrbar: trennen, zuruecksetzen, Schalter aus.
 *
 * DIE DATEN SIND DIE DER BOX, gemessen am 2026-08-03 mit
 * tools/quellen-ueberschneidung.mjs (nur lesend): zwei Ueberschneidungen
 * zwischen Jellyfin und Spotify, dazu eine Spotify-Playlist, die zweimal
 * dasteht (einmal `music`, einmal `audiobook`).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

// Zwei Paare: dasselbe Album je einmal in Jellyfin und einmal bei Spotify.
const LUMPEN_JF = {
  id: 'e131865d504a657a93533722fc88bc90',
  title: 'Die Zukunft wird gross',
  artist: 'Das Lumpenpack',
  type: 'jellyfin-album',
  category: 'music',
}
const LUMPEN_SP = {
  id: '0PyuOAMz1lv0z737JcQNOg',
  title: 'Die Zukunft wird gross',
  artist: 'Das Lumpenpack',
  type: 'spotify',
  category: 'music',
}
const HAMM_JF = {
  id: '7d9a37e2732ca78bc68eacb3232960c0',
  title: 'HAMM',
  artist: 'Kapelle Petra',
  type: 'jellyfin-album',
  category: 'music',
}
const HAMM_SP = {
  id: '0l0nQidfDmC4SiTdrpHr4v',
  title: 'HAMM',
  artist: 'Kapelle Petra',
  type: 'spotify',
  category: 'music',
}
// Der mehrdeutige Fall: dieselbe Playlist zweimal, verschieden NUR in category.
const JOJO_MUSIK = {
  playlistid: '2QqQXuDKNR8HK1cFxf0NhW',
  title: 'Das Pummeleinhorn',
  artist: 'Jojo',
  type: 'spotify',
  category: 'music',
}
const JOJO_HB = { ...JOJO_MUSIK, category: 'audiobook' }
// Ein Eintrag ohne Partner — er darf von allem unberuehrt bleiben.
const EINZELN = {
  id: '1aawyAB9vmqN3uQ7FjRGTy',
  title: 'Bibi Blocksberg',
  artist: 'Kiddinx',
  type: 'spotify',
  category: 'audiobook',
}

const KATALOG = [LUMPEN_JF, LUMPEN_SP, HAMM_JF, HAMM_SP, JOJO_MUSIK, JOJO_HB, EINZELN]

let app: import('express').Express
let verzeichnis = ''

function ablage() {
  return JSON.parse(readFileSync(join(verzeichnis, 'verschmelzung.json'), 'utf8'))
}

describe('Verschmelzung ueber die Schnittstelle', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-verschmelzung-'))
    writeFileSync(join(verzeichnis, 'data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'active_data.json'), JSON.stringify(KATALOG, null, 2))
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    // Eigene Sperrdatei je Lauf — `node --test` startet die Spec-Dateien
    // parallel, und die gemeinsame /tmp-Sperre sperrte sonst die anderen mit.
    process.env.MUPIBOX_LOCK_DIR = verzeichnis
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  it('zeigt ohne Schalter alle sieben Eintraege — genau wie vorher', async () => {
    const r = await request(app).get('/api/werke').expect(200)
    assert.equal(r.body.werke.length, KATALOG.length)
  })

  it('aendert eingeschaltet NICHTS, solange niemand abgeglichen hat', async () => {
    // Der Schalter allein legt nichts zusammen. Das ist Absicht: die Erkennung
    // ist eine Behauptung und braucht einen Menschen, der sie annimmt.
    const r = await request(app).get('/api/werke?verschmelzen=1').expect(200)
    assert.equal(r.body.werke.length, KATALOG.length)
  })

  it('meldet die zwei Vorschlaege und den mehrdeutigen Schluessel, bevor irgendetwas geschieht', async () => {
    const r = await request(app).get('/api/verschmelzung').expect(200)
    assert.equal(r.body.zuordnungen.length, 0)
    assert.equal(r.body.neu.length, 2)
    // DER PUNKT DES GANZEN SCHRITTS: der doppelte Schluessel wird gesagt, nicht
    // verschwiegen — und zwar mit den Zeilennummern, ohne die er nicht
    // abstellbar waere (beide Zeilen sehen sonst identisch aus).
    assert.equal(r.body.mehrdeutig.length, 1)
    assert.equal(r.body.mehrdeutig[0].schluessel, medienSchluessel(JOJO_MUSIK))
    assert.deepEqual(r.body.mehrdeutig[0].kategorien, ['music', 'audiobook'])
    assert.equal(r.body.doppelt.length, 1)
    assert.deepEqual(
      r.body.doppelt[0].eintraege.map((e: { nr: number; category: string }) => [e.nr, e.category]),
      [
        [4, 'music'],
        [5, 'audiobook'],
      ],
    )
  })

  it('legt beim Abgleichen zwei Zuordnungen ab — mit der Stufe, die sie behauptet', async () => {
    const r = await request(app).post('/api/verschmelzung/abgleichen').expect(200)
    assert.equal(r.body.zuordnungen.length, 2)
    for (const z of r.body.zuordnungen) assert.equal(z.stufe, 'locker')
    // Und die Ablage steht wirklich auf der Platte — sie muss einen Neustart
    // ueberleben, sonst waere der Knopf eine Sitzungserinnerung.
    assert.equal(ablage().zuordnungen.length, 2)
  })

  it('macht daraus GENAU zwei Kacheln weniger — nicht mehr', async () => {
    const r = await request(app).get('/api/werke?verschmelzen=1').expect(200)
    assert.equal(r.body.werke.length, KATALOG.length - 2)
    // Die bevorzugte Quelle ist Jellyfin: lokal -> jellyfin -> spotify ist
    // Absicherung, nicht Geschmack (verschmelzung.ts).
    const lumpen = r.body.werke.find((w: { schluessel: string }) => w.schluessel === medienSchluessel(LUMPEN_JF))
    assert.equal(lumpen.quellen[0].dienst, 'jellyfin')
    assert.deepEqual(lumpen.auchSchluessel, [medienSchluessel(LUMPEN_SP)])
    assert.equal(lumpen.stufe, 'locker')
  })

  it('laesst den mehrdeutigen Eintrag unangetastet — beide Zeilen stehen noch', async () => {
    const r = await request(app).get('/api/werke?verschmelzen=1').expect(200)
    const jojo = r.body.werke.filter((w: { schluessel: string }) => w.schluessel === medienSchluessel(JOJO_MUSIK))
    assert.equal(jojo.length, 2)
  })

  it('bleibt AUSGESCHALTET bei sieben Kacheln — der ausdrueckliche Rueckweg', async () => {
    /* HIER STAND `.get('/api/werke')` OHNE SCHALTER — und der Fall war
     * deshalb seit dem 06.09.2026 (25b55123) dauerrot, dreizehn Tage lang.
     *
     * WAS SICH GEAENDERT HAT: Ohne Schalter nimmt der Server seitdem NICHT
     * mehr „aus" an, sondern fragt die Darstellung (`server.ts`,
     * `verschmelzenAusDarstellung()` — ein Ruf ohne Schalter bekommt damit
     * dasselbe Bild wie die Oberflaeche, statt eines zweiten
     * Hausverhaltens). Der Fall mass also nicht mehr, was sein Name sagt,
     * sondern die Vorgabe der Einstellung.
     *
     * DAS ANLIEGEN GILT WEITER, nur fuehrt der Rueckweg jetzt ueber den
     * ausdruecklichen Schalter: `verschmelzen=0` muss die sieben Kacheln
     * zurueckgeben. Genau das prueft der Fall ab jetzt.
     *
     * NICHT GEPRUEFT WIRD HIER die schalterlose Vorgabe — die haengt an der
     * Darstellung, und die gehoert diesem Testaufbau nicht. Wer sie
     * festnageln will, braucht einen Fall, der die Einstellung selbst setzt;
     * das ist ein eigener Zuschnitt und keine Zeile in diesem. */
    const r = await request(app).get('/api/werke?verschmelzen=0').expect(200)
    assert.equal(r.body.werke.length, KATALOG.length)
  })

  it('loest eine einzelne Zusammenlegung auf und merkt sich das', async () => {
    const r = await request(app)
      .post('/api/verschmelzung/trennen')
      .send({ schluessel: medienSchluessel(HAMM_JF) })
      .expect(200)
    assert.equal(r.body.zuordnungen.length, 1)
    assert.deepEqual(r.body.getrennt.length, 1)
    // EINE Kachel mehr als eben, nicht zwei: die andere Zusammenlegung bleibt.
    const w = await request(app).get('/api/werke?verschmelzen=1').expect(200)
    assert.equal(w.body.werke.length, KATALOG.length - 1)
  })

  it('holt die getrennte Zusammenlegung beim naechsten Abgleich NICHT zurueck', async () => {
    // Ohne diese Zusage waere „trennen" eine Beruhigung bis zum naechsten
    // Druck auf „abgleichen".
    const r = await request(app).post('/api/verschmelzung/abgleichen').expect(200)
    assert.equal(r.body.zuordnungen.length, 1)
    assert.ok(r.body.uebergangen.some((u: { grund: string }) => u.grund === 'getrennt'))
  })

  it('nimmt die Trennung auf Wunsch zurueck', async () => {
    await request(app)
      .post('/api/verschmelzung/verbinden')
      .send({ a: medienSchluessel(HAMM_JF), b: medienSchluessel(HAMM_SP) })
      .expect(200)
    const r = await request(app).post('/api/verschmelzung/abgleichen').expect(200)
    assert.equal(r.body.zuordnungen.length, 2)
  })

  it('entfernt den doppelten Eintrag ueber die Zeilennummer — mit Sicherung', async () => {
    // Ueber `DELETE /api/medien/:schluessel` geht das NICHT: findeIndex gibt
    // bei zwei Treffern -1 und die Antwort waere „nicht gefunden", obwohl der
    // Eintrag sichtbar dasteht.
    await request(app)
      .delete(`/api/medien/${encodeURIComponent(medienSchluessel(JOJO_MUSIK))}`)
      .expect(404)
    const r = await request(app)
      .post('/api/medien/doppelte/entfernen')
      .send({ schluessel: medienSchluessel(JOJO_MUSIK), nr: 5 })
      .expect(200)
    assert.ok(r.body.sicherung)
    const jetzt = JSON.parse(readFileSync(join(verzeichnis, 'data.json'), 'utf8'))
    assert.equal(jetzt.length, KATALOG.length - 1)
    // Es ist die HOERBUCH-Zeile gefallen, nicht irgendeine.
    assert.equal(jetzt.filter((e: { category: string }) => e.category === 'audiobook').length, 1)
  })

  it('weist eine Zeilennummer ab, die nicht zu dem Schluessel gehoert', async () => {
    // Die Nummer allein waere gefaehrlich (die Liste verschiebt sich), der
    // Schluessel allein ist mehrdeutig — nur zusammen sind sie eindeutig.
    await request(app)
      .post('/api/medien/doppelte/entfernen')
      .send({ schluessel: medienSchluessel(LUMPEN_JF), nr: 0 })
      .expect(404)
  })

  /**
   * W1/W2 (Befund 29.08.2026): `GET /api/medien` gruppierte bisher NUR
   * heuristisch (`meinenDasselbe`), ohne die bestätigte Ablage
   * (`config/verschmelzung.json`) überhaupt zu lesen — bestätigte Paare
   * standen dort als ZWEI Zeilen, obwohl `/api/werke` sie längst zu EINER
   * Kachel zusammenfasst. Und `/api/verschmelzung/festschreiben` ist der
   * neue Schreibweg, über den plugins/mixpi-mitschnitt eine Zuordnung
   * FESTSCHREIBT, statt sie der Heuristik zu überlassen.
   */
  it('GET /api/medien: eine bestaetigte Zuordnung macht aus zwei voellig verschieden beschrifteten Eintraegen EINE Gruppe (W1)', async () => {
    const vorher = await request(app).get('/api/medien').expect(200)
    const gesamtVorher = vorher.body.eintraege.length
    // JOJO_MUSIK ("Das Pummeleinhorn"/Jojo) und EINZELN ("Bibi Blocksberg"/
    // Kiddinx) haben nichts gemein — die Heuristik wuerde sie NIE zusammenlegen.
    await request(app)
      .post('/api/verschmelzung/festschreiben')
      .send({ schluessel: medienSchluessel(JOJO_MUSIK), auch: medienSchluessel(EINZELN) })
      .expect(200)
    const r = await request(app).get('/api/medien').expect(200)
    assert.equal(r.body.eintraege.length, gesamtVorher, 'nichts geht verloren — gruppiert, nicht gefiltert')
    const finden = (s: string) => r.body.eintraege.find((e: { schluessel: string }) => e.schluessel === s)
    const jojo = finden(medienSchluessel(JOJO_MUSIK))
    const einzeln = finden(medienSchluessel(EINZELN))
    assert.ok(jojo && einzeln, 'beide Eintraege stehen weiterhin da')
    assert.equal(jojo.gruppe, einzeln.gruppe, 'nur die FESTGESCHRIEBENE Zuordnung fasst sie zusammen')
  })

  it('POST /api/verschmelzung/festschreiben ist idempotent — ein zweiter Aufruf laesst die Ablage gleich', async () => {
    const vor = ablage()
    const r = await request(app)
      .post('/api/verschmelzung/festschreiben')
      .send({ schluessel: medienSchluessel(JOJO_MUSIK), auch: medienSchluessel(EINZELN) })
      .expect(200)
    assert.deepEqual(r.body, vor)
    assert.deepEqual(ablage(), vor)
  })

  it('GET /api/medien: ein GETRENNTES Paar bleibt zwei Zeilen, obwohl die Heuristik sie fuer dasselbe haelt', async () => {
    // HAMM_JF und HAMM_SP tragen Titel UND Interpret identisch — ohne die
    // Trennung waere das die klassische heuristische Dublette.
    await request(app)
      .post('/api/verschmelzung/trennen')
      .send({ schluessel: medienSchluessel(HAMM_JF), auch: medienSchluessel(HAMM_SP) })
      .expect(200)
    const r = await request(app).get('/api/medien').expect(200)
    const finden = (s: string) => r.body.eintraege.find((e: { schluessel: string }) => e.schluessel === s)
    const jf = finden(medienSchluessel(HAMM_JF))
    const sp = finden(medienSchluessel(HAMM_SP))
    assert.ok(jf && sp)
    assert.notEqual(jf.gruppe, sp.gruppe, 'HAMM/Kapelle Petra ist identisch beschriftet, aber ausdruecklich getrennt')
  })

  it('setzt am Ende alles zurueck — der grobe Rueckweg', async () => {
    await request(app).post('/api/verschmelzung/zuruecksetzen').expect(200)
    assert.deepEqual(ablage(), { zuordnungen: [], getrennt: [] })
    const w = await request(app).get('/api/werke?verschmelzen=1').expect(200)
    // WIEDER ALLE SIEBEN, obwohl oben ein Eintrag aus data.json fiel: /api/werke
    // liest active_data.json, und die ist im Test eine eigene Datei. AUF DER
    // BOX ist sie im Online-Betrieb ein SYMLINK auf data.json (check_network.sh
    // legt ihn an) — dort wirkt das Entfernen also sofort. Offline zeigt sie
    // auf offline_data.json und ist eine andere, kuerzere Liste. Genau deshalb
    // laeuft der ABGLEICH auf data.json: sonst verschwaenden die Zuordnungen
    // ausgerechnet dann, wenn das Netz weg ist.
    assert.equal(w.body.werke.length, KATALOG.length)
  })
})
