/**
 * E18 STUFE 3: `resume.json` GEHOERT JE KIND — und der alte Ort bleibt begehbar.
 *
 * WORUM ES GEHT: Bis heute lagen die gemerkten Stellen box-weit in
 * `server/config/resume.json`. `weiterhoerbare()` sieht den Verlauf nur als
 * ZEIT (`zeiten.get(m.key) ?? 0`) und siebt gar nicht nach Besitzer — Liam sah
 * also mit Titel, Bild und Fortsetzen-Knopf, wo Kalea stehengeblieben ist.
 * Ab jetzt liegt der Bestand in `profile/<kennung>/resume.json`, und damit
 * siebt niemand: es liegt nur das Richtige da.
 *
 * DER TEURE TEIL IST NICHT DER UMZUG, SONDERN DER ALTE ORT. An ihm haengen
 * vier root-Skripte, die den neuen Pfad NIE lernen werden — jedes Update von
 * upstream tauscht sie gegen ihre alte Fassung zurueck. Was sie dort tun,
 * misst `tools/resume-bruecke-probe.py` mit den ECHTEN Skripten. Hier wird das
 * andere Ende geprueft: dass der SERVER die Bruecke legt, sie nach einem
 * Profilwechsel umhaengt und die Arbeit der Skripte hereinholt, wenn sie ihm
 * die Bruecke unter den Fuessen wegziehen.
 *
 * WARUM DAS EINEN EIGENEN TEST BRAUCHT: jeder Fehler dieser Naht ist STILL.
 * Eine Box, die nichts mehr fortsetzt, sieht aus wie eine Box, an der noch
 * niemand etwas angefangen hat — kein Fehler, kein Protokolleintrag, HTTP 200.
 *
 * EIGENER PROZESS: server.ts richtet die Bereiche EINMAL beim Laden des Moduls
 * her; `node --test` gibt jeder Spec-Datei einen eigenen.
 */
import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

const GAST_WERK = {
  id: 'bruecke-gast-01',
  title: 'Was der Gast angefangen hat',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
}
const KALEA_WERK = {
  id: 'bruecke-kalea-01',
  title: 'Was Kalea angefangen hat',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
}
const MEDIEN = [GAST_WERK, KALEA_WERK]

/** Eine Stelle in der Form, in der sie in resume.json steht. */
const stelle = (werk: typeof GAST_WERK) => ({
  ...werk,
  category: 'resume',
  resumespotifytrack_number: 2,
  resumespotifyprogress_ms: 30_000,
  resumespotifyduration_ms: 900_000,
})

const GAST_BOXWEIT = [stelle(GAST_WERK)]

let app: import('express').Express
let ordner = ''
const alterOrt = () => join(ordner, 'resume.json')
const bereich = (kennung: string) => join(ordner, 'profile', kennung, 'resume.json')
const inhalt = (pfad: string) => JSON.parse(readFileSync(pfad, 'utf8')) as { id?: string }[]

describe('E18 Stufe 3: die gemerkten Stellen gehoeren je Kind — und die Bruecke bleibt', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-bruecke-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify(MEDIEN, null, 2))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify(MEDIEN, null, 2))
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: 'mixpi-hoert.png', angelegt: 1 },
          { kennung: 'kalea', name: 'Kalea', figur: 'mixpi-hoert.png', angelegt: 2 },
        ],
        aktiv: 'gast',
      }),
    )
    // DIE AUSGANGSLAGE EINER BOX, DIE SEIT JULI LAEUFT: box-weit, am alten Ort.
    writeFileSync(alterOrt(), JSON.stringify(GAST_BOXWEIT, null, 4))
    const konfig = join(ordner, 'mupiboxconfig.json')
    writeFileSync(konfig, JSON.stringify({ mupibox: { resume: 9 } }))
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPIBOX_CONFIG = konfig
    // EIGENE SPERRDATEI: `node --test` faehrt die Spec-Dateien parallel. An der
    // gemeinsamen /tmp-Sperre haetten zwei Laeufe einander alles stumm
    // uebersprungen — und waeren gruen gewesen, ohne je geschrieben zu haben.
    process.env.MUPIBOX_LOCK_DIR = ordner
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_CONFIG = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  // ── Der Umzug ─────────────────────────────────────────────────────────────

  it('der box-weite Bestand gehoert jetzt dem Gast — vollstaendig, umbenannt statt kopiert', () => {
    assert.deepEqual(
      inhalt(bereich('gast')).map((e) => e.id),
      [GAST_WERK.id],
      'der Bestand muss im Bereich des Gasts stehen',
    )
    assert.equal(lstatSync(alterOrt()).isSymbolicLink(), true, 'am alten Ort steht nur noch die Bruecke')
  })

  it('die Bruecke zeigt RELATIV — sie ueberlebt damit einen Umzug des ganzen Baums', () => {
    // Ein absoluter Verweis auf /home/dietpi/... zeigte nach einem
    // Zurueckspielen auf einer anderen Karte oder in einem Testverzeichnis ins
    // Leere, und `existsSync` sagte dazu nur „nein" — ohne zu sagen, warum.
    assert.equal(readlinkSync(alterOrt()), 'profile/gast/resume.json')
  })

  it('ueber die Bruecke gelesen steht dasselbe da wie im Bereich', () => {
    // Das ist die EIGENSCHAFT, an der die vier root-Skripte haengen: sie lesen
    // und schreiben weiter den alten Pfad und treffen den Bestand des Kindes,
    // das gerade an der Box ist.
    assert.deepEqual(inhalt(alterOrt()), inhalt(bereich('gast')))
  })

  // ── Die Trennung ──────────────────────────────────────────────────────────

  it('der Gast sieht seine Stelle in der Weiterhoeren-Reihe', async () => {
    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.deepEqual(
      r.body.weiter.map((z: { titel: string }) => z.titel),
      [GAST_WERK.title],
    )
  })

  it('nach dem Wechsel sieht Kalea NICHTS vom Gast — weder in der Reihe noch roh', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea' }).expect(200)
    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.deepEqual(r.body.weiter, [], 'die Reihe des Gasts darf bei Kalea nicht auftauchen')
    // Und auch nicht auf dem rohen Weg, den die klassische Oberflaeche geht.
    const roh = await request(app).get('/api/resume')
    assert.notEqual(roh.status, 200, 'ohne eigenen Bestand gibt es nichts zu zeigen')
  })

  it('die Bruecke zieht beim Wechsel mit', () => {
    // Alles ausserhalb des Servers findet den Bestand ueber den alten Ort:
    // active_resume.json, die Offline-Liste, der Deckel, „Clear all resume
    // media". Bliebe die Bruecke stehen, arbeitete das alles weiter am
    // vorigen Kind — genau der Fehler, den diese Stufe abstellen soll.
    assert.equal(readlinkSync(alterOrt()), 'profile/kalea/resume.json')
  })

  it('was Kalea merkt, landet in IHREM Bereich — der Gast bleibt unberuehrt', async () => {
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(KALEA_WERK), titelNr: 3, bisher: 45, dauer: 600 })
      .expect(200)
    assert.deepEqual(
      inhalt(bereich('kalea')).map((e) => e.id),
      [KALEA_WERK.id],
    )
    assert.deepEqual(
      inhalt(bereich('gast')).map((e) => e.id),
      [GAST_WERK.id],
      'der Bestand des Gasts darf sich beim Schreiben eines anderen nicht aendern',
    )
  })

  it('und der Gast findet nach dem Zurueckwechseln genau seine Stelle wieder', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'gast' }).expect(200)
    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.deepEqual(
      r.body.weiter.map((z: { titel: string }) => z.titel),
      [GAST_WERK.title],
    )
  })

  it('eine Meldung darf sich ihr Profil NICHT selbst aussuchen', async () => {
    // „DER BESITZER KOMMT NICHT VOM CLIENT" — dieselbe Regel wie bei
    // POST /api/gespielt. Der einzige Weg, auf dem eine Kennung von aussen
    // etwas bewegt, ist der Umschalter POST /api/profil/aktiv.
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(KALEA_WERK), titelNr: 1, bisher: 10, dauer: 600, profil: 'kalea' })
      .expect(200)
    assert.deepEqual(
      inhalt(bereich('gast'))
        .map((e) => e.id)
        .sort(),
      [GAST_WERK.id, KALEA_WERK.id].sort(),
      'die Meldung gehoert dem AKTIVEN Profil, nicht dem genannten',
    )
    assert.equal(inhalt(bereich('kalea')).length, 1, 'Kaleas Bestand darf davon nichts abbekommen')
  })

  // ── Die Bruecke gegen die Skripte ─────────────────────────────────────────

  it('holt herein, was ein Skript am alten Ort abgelegt hat — und legt die Bruecke neu', async () => {
    // GENAU DAS TUN remove_max_resume.sh UND clearresume.sh: `mv` ueber den
    // alten Ort. Gemessen (tools/resume-bruecke-probe.py, gleiches UND fremdes
    // Dateisystem): der Verweis ist danach weg und liegt als echte Datei da,
    // waehrend im Bereich noch der Stand von davor steht. Ohne die Uebernahme
    // waeren der Deckel und „Clear all resume media" ab dem Umzug wirkungslos —
    // lautlos, denn beide melden nichts.
    const geschnitten = [stelle(GAST_WERK)]
    writeFileSync(join(ordner, 'resume.json.skript'), JSON.stringify(geschnitten, null, 4))
    renameSync(join(ordner, 'resume.json.skript'), alterOrt())
    assert.equal(lstatSync(alterOrt()).isSymbolicLink(), false, 'Vorbedingung: die Bruecke ist weg')

    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.deepEqual(
      r.body.weiter.map((z: { titel: string }) => z.titel),
      [GAST_WERK.title],
      'gelesen wird, was das Skript hinterlassen hat — nicht der Stand von davor',
    )
    assert.equal(lstatSync(alterOrt()).isSymbolicLink(), true, 'die Bruecke steht wieder')
    assert.deepEqual(
      inhalt(bereich('gast')).map((e) => e.id),
      [GAST_WERK.id],
      'und die Arbeit des Skripts liegt im Bereich',
    )
  })

  it('nimmt auch eine LEERE Liste an — und hebt den bisherigen Stand daneben auf', async () => {
    // clearresume.sh raeumt auf `[]` ab, und auf dieser Box tragen ALLE
    // Eintraege `category: "resume"` (am Geraet nachgezaehlt, 05.08.2026) —
    // „geleert" ist hier also die richtige Antwort und darf nicht abgewiesen
    // werden. Zugleich ist `[]` genau das, was get_network.sh schreibt, wenn
    // der alte Ort einmal fehlt. Von hier aus sind die beiden nicht zu
    // unterscheiden: es wird uebernommen UND aufgehoben.
    writeFileSync(join(ordner, 'resume.json.skript'), '[]')
    renameSync(join(ordner, 'resume.json.skript'), alterOrt())

    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.deepEqual(r.body.weiter, [], 'geleert ist geleert')
    assert.deepEqual(inhalt(bereich('gast')), [])
    assert.equal(existsSync(`${bereich('gast')}.vorher`), true, 'nichts wird weggeworfen')
    assert.deepEqual(
      inhalt(`${bereich('gast')}.vorher`).map((e) => e.id),
      [GAST_WERK.id],
    )
  })

  // ── Der Zeitstempel, an dem die Offline-Liste haengt ──────────────────────

  it('frischt die BRUECKE auf, wenn geschrieben wurde — nicht ihr Ziel', async () => {
    // `check_network.sh`/`get_network.sh` erzeugen offline_resume.json nur,
    // wenn `stat --format='%Y' ${RESUME_FILE}` neuer ist. Und `stat` FOLGT dem
    // Verweis NICHT (gemessen: GNU stat braucht dafuer -L). Gemessen wird also
    // die Bruecke selbst, und deren Zeitstempel steht fest, seit sie gelegt
    // wurde. Ohne Auffrischen bliebe die Offline-Liste auf dem Stand des
    // letzten PROFILWECHSELS stehen — sichtbar erst ohne Netz, Wochen spaeter.
    const vorhin = new Date(Date.now() - 3_600_000)
    utimesSync(alterOrt(), vorhin, vorhin) // folgt dem Verweis: faerbt das ZIEL
    const links = lstatSync(alterOrt()).mtimeMs
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(GAST_WERK), titelNr: 5, bisher: 90, dauer: 600 })
      .expect(200)
    assert.ok(
      lstatSync(alterOrt()).mtimeMs > links,
      'der Zeitstempel des VERWEISES muss nach einem Schreiben neuer sein',
    )
  })

  // ── active_resume.json: der Verweis, den der Server NIE anfasst ───────────

  it('active_resume.json loest ueber die Bruecke auf — und folgt dem Wechsel von selbst', async () => {
    // So legt check_network.sh ihn an: ABSOLUT, auf den alten Ort. Die Kette
    // active_resume.json -> resume.json -> profile/<aktiv>/resume.json loest
    // sich auf, und der Server muss den Verweis dafuer nie anfassen. Das ist
    // der Kern der Loesung: das Skript darf ihn jederzeit neu legen, auch in
    // seiner alten Fassung nach einem Update — es kommt dasselbe heraus.
    symlinkSync(alterOrt(), join(ordner, 'active_resume.json'))
    const alsGast = await request(app).get('/api/activeresume').expect(200)
    assert.deepEqual(
      alsGast.body.map((e: { id: string }) => e.id),
      [GAST_WERK.id],
    )

    await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea' }).expect(200)
    const alsKalea = await request(app).get('/api/activeresume').expect(200)
    assert.deepEqual(
      alsKalea.body.map((e: { id: string }) => e.id),
      [KALEA_WERK.id],
      'ohne dass jemand active_resume.json angefasst haette',
    )
    assert.equal(readlinkSync(join(ordner, 'active_resume.json')), alterOrt(), 'der Verweis ist unveraendert')
  })

  // ── Der Wechsel selbst, waehrend am alten Ort eine ECHTE Datei liegt ──────

  it('ein Realstand am alten Ort gehoert beim Wechsel dem VORIGEN Kind', async () => {
    // DIE KOMBINATION, DIE ZWEI AUDITS LANG UNGEDECKT WAR (2026-08-05, 2.1.1):
    // ein Skript legt per mv eine echte Datei ueber die Bruecke — und DANN
    // wechselt jemand das Profil. Die Uebernahme liest die aktive Kennung
    // selbst; richtete der Wechsel die Bruecke erst NACH dem Umschalten,
    // wanderte Kaleas Stand in den Bereich des Gasts: der Gast erbte fremde
    // Stellen, Kalea verlor ihre — ersatzlos und lautlos, HTTP 200.
    // Hier ist Kalea aktiv (voriger Test), und ihr Skript-Stand traegt eine
    // Marke (Titel 9), die es in keinem Bereich schon gibt.
    const skriptStand = [{ ...stelle(KALEA_WERK), resumespotifytrack_number: 9 }]
    writeFileSync(join(ordner, 'resume.json.skript'), JSON.stringify(skriptStand, null, 4))
    renameSync(join(ordner, 'resume.json.skript'), alterOrt())
    assert.equal(lstatSync(alterOrt()).isSymbolicLink(), false, 'Vorbedingung: echte Datei, keine Bruecke')

    await request(app).post('/api/profil/aktiv').send({ kennung: 'gast' }).expect(200)

    const kalea = inhalt(bereich('kalea')) as { id?: string; resumespotifytrack_number?: number }[]
    assert.deepEqual(
      kalea.map((e) => [e.id, e.resumespotifytrack_number]),
      [[KALEA_WERK.id, 9]],
      'der Skript-Stand muss beim VORIGEN Kind (Kalea) ankommen',
    )
    assert.equal(
      inhalt(bereich('gast')).some((e) => e.id === KALEA_WERK.id),
      false,
      'der Gast darf Kaleas Stand nicht erben',
    )
    assert.equal(readlinkSync(alterOrt()), 'profile/gast/resume.json', 'und die Bruecke zeigt aufs neue Kind')
  })
})
