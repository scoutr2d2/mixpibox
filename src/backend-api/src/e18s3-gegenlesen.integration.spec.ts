/**
 * E18 STUFE 3, GEGENGELESEN — der Versuch, die Bruecke zu brechen.
 *
 * `bruecke.integration.spec.ts` prueft, dass die Naht TUT, was sie soll. Diese
 * Datei prueft das andere: dass sie nichts tut, was sie NICHT soll. Sie ist
 * absichtlich unfreundlich — jeder Fall hier ist der Versuch, an Kaleas Stellen
 * zu kommen, ohne Kalea zu sein, oder die Bruecke in einen Zustand zu bringen,
 * in dem der Server sie falsch versteht.
 *
 * WARUM DAS EINEN ZWEITEN TEST BRAUCHT: Der erste geht die WEGE ab, die die
 * Oberflaeche geht. Ein Leck sitzt aber nie auf dem Weg, den jemand gebaut hat,
 * sondern auf dem daneben — und von den Wegen zu resume.json gibt es acht
 * (llmwiki [[resume-wege-gemessen-e18-stufe3]]). Hier wird JEDER angefasst, der
 * ohne Netz erreichbar ist, und zwar mit zwei Kindern gleichzeitig.
 *
 * DREI KLASSEN VON FAELLEN:
 *   1. LESEN — sieht Liam, wo Kalea stehengeblieben ist? Auf allen Wegen.
 *   2. BEHAUPTEN — kann ein Client eine Kennung MITBRINGEN und damit fremde
 *      Stellen lesen oder schreiben?
 *   3. ZERSTOEREN — was macht der Server aus einem alten Ort, der kein Verweis
 *      und keine Datei ist (Ordner, Verweis ins Nichts, Verweis nach draussen)?
 *
 * EIGENER PROZESS: server.ts richtet die Bereiche EINMAL beim Laden des Moduls
 * her; `node --test` gibt jeder Spec-Datei einen eigenen.
 */
import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

const werk = (id: string, title: string) => ({
  id,
  title,
  artist: 'Gegenlesen',
  type: 'spotify',
  category: 'audiobook',
})

const KALEA_WERK = werk('gl-kalea-01', 'Kaleas Hoerspiel')
const LIAM_WERK = werk('gl-liam-01', 'Liams Hoerspiel')
const ALT_WERK = werk('gl-boxweit-01', 'Was vor dem Umzug da war')
const MEDIEN = [KALEA_WERK, LIAM_WERK, ALT_WERK]

/** Eine Stelle in der Form, in der sie in resume.json steht. */
const stelle = (w: typeof KALEA_WERK) => ({
  ...w,
  category: 'resume',
  resumespotifytrack_number: 2,
  resumespotifyprogress_ms: 30_000,
  resumespotifyduration_ms: 900_000,
})

let app: import('express').Express
let ordner = ''
const alterOrt = () => join(ordner, 'resume.json')
const bereich = (k: string) => join(ordner, 'profile', k, 'resume.json')
const ids = (pfad: string) => (JSON.parse(readFileSync(pfad, 'utf8')) as { id?: string }[]).map((e) => e.id)

/** Was `check_network.sh` legt: ein ABSOLUTER Verweis auf den alten Ort. */
function activeResumeLegen(): string {
  const p = join(ordner, 'active_resume.json')
  rmSync(p, { force: true })
  symlinkSync(alterOrt(), p)
  return p
}

/**
 * Den alten Ort raeumen — egal, was dort steht.
 *
 * `unlink` scheitert an einem Ordner (EISDIR), `rmSync` ohne `recursive` an
 * einem vollen. Ein Test, der davon abhaengt, welche der drei Formen gerade da
 * liegt, misst die vorige Zeile mit.
 */
function alterOrtRaeumen(): void {
  rmSync(alterOrt(), { recursive: true, force: true })
}

/** Eine Stelle merken lassen — der Weg, den die neue Oberflaeche geht. */
async function merken(w: typeof KALEA_WERK, titelNr = 2): Promise<void> {
  await request(app)
    .post('/api/weiterhoeren')
    .send({ schluessel: medienSchluessel(w), titelNr, bisher: 120, dauer: 900 })
    .expect(200)
}

describe('E18 Stufe 3 gegengelesen: was NICHT durch die Bruecke darf', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-e18s3-gegen-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify(MEDIEN, null, 2))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify(MEDIEN, null, 2))
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: 'mixpi-hoert.png', angelegt: 1 },
          { kennung: 'kalea', name: 'Kalea', figur: 'mixpi-hoert.png', angelegt: 2 },
          { kennung: 'liam', name: 'Liam', figur: 'mixpi-hoert.png', angelegt: 3 },
        ],
        // DIE AUSGANGSLAGE, DIE DER ERSTE TEST NICHT HAT: beim Umzug ist NICHT
        // der Gast dran. Genau das ist der Fall auf einer Box, an der schon
        // jemand umgeschaltet hat, bevor die neue Fassung eingespielt wird.
        aktiv: 'kalea',
      }),
    )
    // Eine Box, die seit Juli laeuft: box-weit, am alten Ort, echte Datei.
    writeFileSync(alterOrt(), JSON.stringify([stelle(ALT_WERK)], null, 4))
    const konfig = join(ordner, 'mupiboxconfig.json')
    writeFileSync(konfig, JSON.stringify({ mupibox: { resume: 9 } }))
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPIBOX_CONFIG = konfig
    process.env.MUPIBOX_LOCK_DIR = ordner
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_CONFIG = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  // ── 0. Der Umzug, wenn NICHT der Gast dran ist ────────────────────────────

  it('der box-weite Bestand geht an den GAST, auch wenn Kalea dran ist', () => {
    // Das ist die gebaute Entscheidung („ohne Auswahl war alles der Gast"), und
    // sie ist richtig — sie hat aber eine Folge, die man sehen muss: das Kind,
    // das im Augenblick des Updates dran ist, steht danach vor einer leeren
    // Reihe. Verloren ist nichts; sichtbar ist es erst nach einem Wechsel.
    assert.deepEqual(ids(bereich('gast')), [ALT_WERK.id])
    assert.equal(existsSync(bereich('kalea')), false, 'Kalea erbt den box-weiten Bestand NICHT')
  })

  it('die Bruecke zeigt auf das AKTIVE Kind und damit ins Leere — und das ist kein Fehler', () => {
    assert.equal(readlinkSync(alterOrt()), 'profile/kalea/resume.json')
    assert.equal(existsSync(alterOrt()), false, 'existsSync folgt dem Verweis: tot')
    assert.equal(lstatSync(alterOrt()).isSymbolicLink(), true, 'lstat sieht ihn trotzdem')
  })

  it('eine TOTE Bruecke laesst /api/activeresume mit [] antworten, nicht mit einem Fehler', async () => {
    activeResumeLegen()
    const r = await request(app).get('/api/activeresume').expect(200)
    assert.deepEqual(r.body, [])
  })

  it('und get_network.sh heilt sie aus — Schreiben DURCH den toten Verweis legt das Ziel an', async () => {
    // `echo -n "[]" > ${RESUME_FILE}` auf einem toten Verweis legt das ZIEL an.
    writeFileSync(alterOrt(), '[]')
    assert.equal(existsSync(bereich('kalea')), true)
    assert.equal(lstatSync(alterOrt()).isSymbolicLink(), true, 'der Verweis bleibt stehen')
    assert.deepEqual(JSON.parse(readFileSync(bereich('kalea'), 'utf8')), [])
  })

  // ── 1. LESEN: sieht Liam, wo Kalea stehengeblieben ist? ───────────────────

  it('Kalea merkt sich eine Stelle — sie liegt in IHREM Bereich', async () => {
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(KALEA_WERK), titelNr: 2, bisher: 60, dauer: 900 })
      .expect(200)
    assert.deepEqual(ids(bereich('kalea')), [KALEA_WERK.id])
  })

  it('nach dem Wechsel auf Liam sieht KEIN Weg mehr Kaleas Stelle', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)

    // (a) die neue Oberflaeche
    const weiter = await request(app).get('/api/weiterhoeren').expect(200)
    assert.deepEqual(weiter.body.weiter, [], '/api/weiterhoeren')

    // (b) der rohe Weg der klassischen Oberflaeche (medialist.page.ts)
    const roh = await request(app).get('/api/resume')
    assert.notEqual(roh.status, 200, '/api/resume darf nichts Fremdes liefern')

    // (c) der Weg ueber den Verweis, den check_network.sh legt
    const aktiv = await request(app).get('/api/activeresume').expect(200)
    assert.deepEqual(aktiv.body, [], '/api/activeresume')

    // (d) die DATEI selbst — das ist, was die vier root-Skripte sehen
    assert.equal(readlinkSync(alterOrt()), 'profile/liam/resume.json')
    assert.equal(existsSync(alterOrt()), false, 'Liam hat noch nichts: der alte Ort ist leer')

    // (e) und der Verweis, den check_network.sh gelegt hat, zeigt mit
    const ar = join(ordner, 'active_resume.json')
    assert.equal(existsSync(ar), false, 'active_resume -> alter Ort -> Liams (noch leerer) Bereich')

    // (f) Kaleas Bestand ist unangetastet geblieben
    assert.deepEqual(ids(bereich('kalea')), [KALEA_WERK.id])
  })

  it('der Verlauf ist der zweite Halbe des Siebs — auch er zeigt Liam nichts von Kalea', async () => {
    const r = await request(app).get('/api/gespielt').expect(200)
    assert.equal(r.body.profil, 'liam')
    assert.deepEqual(r.body.zuletzt, [])
  })

  // ── 2. BEHAUPTEN: eine Kennung mitbringen ─────────────────────────────────

  it('GET /api/resume?profil=kalea liefert NICHT Kaleas Bestand', async () => {
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(LIAM_WERK), titelNr: 1, bisher: 60, dauer: 900 })
      .expect(200)
    const r = await request(app).get('/api/resume?profil=kalea').expect(200)
    assert.deepEqual(
      (r.body as { id?: string }[]).map((e) => e.id),
      [LIAM_WERK.id],
      'die Angabe wird ignoriert — es kommt der Bestand des aktiven Kindes',
    )
  })

  it('GET /api/weiterhoeren?profil=kalea ebenso wenig', async () => {
    const r = await request(app).get('/api/weiterhoeren?profil=kalea').expect(200)
    assert.deepEqual(
      r.body.weiter.map((z: { titel: string }) => z.titel),
      [LIAM_WERK.title],
    )
  })

  it('POST /api/weiterhoeren mit `profil` schreibt in LIAMS Bereich', async () => {
    await request(app)
      .post('/api/weiterhoeren')
      .send({
        schluessel: medienSchluessel(ALT_WERK),
        titelNr: 1,
        bisher: 60,
        dauer: 900,
        profil: 'kalea',
        kennung: 'kalea',
      })
      .expect(200)
    assert.deepEqual(ids(bereich('kalea')), [KALEA_WERK.id], 'Kaleas Bestand bleibt unveraendert')
    assert.equal(ids(bereich('liam')).includes(ALT_WERK.id), true)
  })

  it('POST /api/addresume mit `profil` im Rumpf ebenso — der klassische Weg', async () => {
    await request(app)
      .post('/api/addresume')
      .send({ ...stelle(ALT_WERK), id: 'gl-behauptet-01', profil: 'kalea' })
      .expect(200)
    assert.deepEqual(ids(bereich('kalea')), [KALEA_WERK.id])
    assert.equal(ids(bereich('liam')).includes('gl-behauptet-01'), true)
  })

  it('POST /api/editresume mit `profil` ebenso', async () => {
    const vorherKalea = ids(bereich('kalea'))
    await request(app)
      .post('/api/editresume')
      .send({ index: 0, profil: 'kalea', data: { ...stelle(ALT_WERK), id: 'gl-behauptet-02' } })
      .expect(200)
    // Der Rueckruf schreibt asynchron — kurz warten, sonst misst man davor.
    await new Promise((f) => setTimeout(f, 60))
    assert.deepEqual(ids(bereich('kalea')), vorherKalea, 'Kaleas Bestand bleibt unveraendert')
    assert.equal(ids(bereich('liam')).includes('gl-behauptet-02'), true)
  })

  it('POST /api/profil/aktiv weist eine Kennung mit Pfadanteilen ab — die Bruecke bleibt stehen', async () => {
    const vorher = readlinkSync(alterOrt())
    for (const kennung of ['../../etc', 'profile/kalea/..', '../gast', 'KALEA', '']) {
      await request(app).post('/api/profil/aktiv').send({ kennung }).expect(400)
    }
    assert.equal(readlinkSync(alterOrt()), vorher, 'kein abgewiesener Versuch verstellt die Bruecke')
  })

  it('PUT /api/profile kann keinen Bereich ausserhalb von profile/ erzwingen', async () => {
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: 'mixpi-hoert.png', angelegt: 1 },
          { kennung: 'kalea', name: 'Kalea', figur: 'mixpi-hoert.png', angelegt: 2 },
          { kennung: 'liam', name: 'Liam', figur: 'mixpi-hoert.png', angelegt: 3 },
          { kennung: '../../../tmp/mupi-ausbruch', name: 'Boese', figur: 'x.png', angelegt: 4 },
        ],
      })
      .expect(200)
    assert.equal(existsSync('/tmp/mupi-ausbruch'), false, 'kein Ordner ausserhalb des Baums')
    assert.equal(existsSync(join(ordner, 'profile', '..', '..', 'tmp')), false)
  })

  // ── 3. ZERSTOEREN: was am alten Ort alles stehen kann ─────────────────────

  it('ein VERWEIS NACH DRAUSSEN am alten Ort wird ersetzt, nicht gelesen', async () => {
    const fremd = join(ordner, 'fremd.json')
    writeFileSync(fremd, JSON.stringify([stelle(KALEA_WERK)], null, 4))
    alterOrtRaeumen()
    symlinkSync(fremd, alterOrt())
    // Ein Lesen richtet die Bruecke, BEVOR es liest.
    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.equal(readlinkSync(alterOrt()), 'profile/liam/resume.json', 'der fremde Verweis ist weg')
    assert.equal(
      r.body.weiter.some((z: { titel: string }) => z.titel === KALEA_WERK.title),
      false,
      'aus dem fremden Ziel darf nichts hereinkommen',
    )
    assert.deepEqual(JSON.parse(readFileSync(fremd, 'utf8')).length, 1, 'und es wird auch nicht ueberschrieben')
  })

  it('ein ORDNER am alten Ort legt die Box nicht still', async () => {
    await merken(LIAM_WERK)
    alterOrtRaeumen()
    mkdirSync(alterOrt())
    writeFileSync(join(alterOrt(), 'darin.txt'), 'x')
    // Die Bruecke laesst sich nicht legen (rename auf einen vollen Ordner) —
    // gelesen und geschrieben wird trotzdem richtig.
    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.equal(
      r.body.weiter.some((z: { titel: string }) => z.titel === LIAM_WERK.title),
      true,
      'Liam sieht weiter seine eigene Stelle',
    )
    const w = await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(LIAM_WERK), titelNr: 4, bisher: 300, dauer: 900 })
      .expect(200)
    assert.equal(w.body.status, 'ok')
    // Und der Ordner ist NICHT weggeraeumt worden — der Server loescht am alten
    // Ort nichts, was er nicht selbst gelegt hat.
    assert.equal(existsSync(join(alterOrt(), 'darin.txt')), true)
    alterOrtRaeumen()
    await request(app).get('/api/weiterhoeren').expect(200)
    assert.equal(lstatSync(alterOrt()).isSymbolicLink(), true, 'danach steht die Bruecke wieder')
  })

  // ── 4. Die UEBERNAHME: was ein root-Skript hinterlaesst ───────────────────

  it('clearresume.sh raeumt auf [] ab — uebernommen, und der Bestand liegt als .vorher daneben', async () => {
    await merken(LIAM_WERK)
    const vorher = ids(bereich('liam'))
    assert.ok(vorher.length > 0, 'Vorbedingung: Liam hat etwas')
    // Genau das, was `mv ${DATA}.tmp ${DATA}` hinterlaesst: eine ECHTE Datei.
    alterOrtRaeumen()
    writeFileSync(alterOrt(), '[]')
    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.deepEqual(r.body.weiter, [], 'die Reihe ist leer — „Clear all resume media" hat gewirkt')
    assert.deepEqual(JSON.parse(readFileSync(bereich('liam'), 'utf8')), [])
    assert.deepEqual(ids(`${bereich('liam')}.vorher`), vorher, 'nichts ist weggeworfen')
    assert.equal(lstatSync(alterOrt()).isSymbolicLink(), true)
  })

  it('remove_max_resume.sh kuerzt — uebernommen, OHNE .vorher (die Liste ist nicht leer)', async () => {
    // Erst wieder Bestand aufbauen.
    for (const w of [LIAM_WERK, ALT_WERK]) {
      await request(app)
        .post('/api/weiterhoeren')
        .send({ schluessel: medienSchluessel(w), titelNr: 2, bisher: 120, dauer: 900 })
        .expect(200)
    }
    assert.equal(ids(bereich('liam')).length, 2, `Vorbedingung: ${ids(bereich('liam'))}`)
    rmSync(`${bereich('liam')}.vorher`, { force: true })
    // Was das Skript hinterlaesst: eine echte Datei mit der GEKUERZTEN Liste.
    alterOrtRaeumen()
    writeFileSync(alterOrt(), JSON.stringify([stelle(ALT_WERK)], null, 4))
    const r = await request(app).get('/api/weiterhoeren').expect(200)
    assert.deepEqual(
      r.body.weiter.map((z: { titel: string }) => z.titel),
      [ALT_WERK.title],
    )
    assert.equal(existsSync(`${bereich('liam')}.vorher`), false, 'ohne Not wird nichts danebengelegt')
  })

  it('die UEBERNAHME beim Wechsel trifft das VORIGE Kind — ihm gehoerte der alte Ort', async () => {
    // Ein Skript schreibt, DANN wird umgeschaltet. Die Datei entstand also,
    // WAEHREND das vorige Kind (hier: Liam) an der Box war — ihr Inhalt ist
    // sein durch die Bruecke gelesener, bearbeiteter Stand. Bis zum
    // 13.08.2026 stand hier das Gegenteil („trifft das AKTIVE Kind"): der
    // Umschalter setzte `aktiv` VOR dem Richten, die Uebernahme las die neue
    // Kennung, und der Stand des vorigen Kindes ueberschrieb den Bereich des
    // neuen — ersatzlos und lautlos (Audit 2026-08-05, 2.1.1; der Umschalter
    // richtet seit heute ERST die alte Bruecke und schaltet dann um).
    alterOrtRaeumen()
    writeFileSync(alterOrt(), JSON.stringify([stelle(KALEA_WERK)], null, 4))
    await request(app).post('/api/profil/aktiv').send({ kennung: 'gast' }).expect(200)
    // Der Umschalter richtet die Bruecke SELBST — die Uebernahme muss also
    // schon beim Umschalten passiert sein, nicht erst beim naechsten Lesen.
    assert.equal(lstatSync(alterOrt()).isSymbolicLink(), true)
    assert.equal(readlinkSync(alterOrt()), 'profile/gast/resume.json')
    // Der Skript-Stand liegt beim VORIGEN Kind; der Gast erbt nichts.
    assert.equal(ids(bereich('liam')).includes(KALEA_WERK.id), true, 'Liams Bereich traegt den Skript-Stand')
    assert.equal(ids(bereich('gast')).includes(KALEA_WERK.id), false, 'der Gast erbt keinen fremden Stand')
  })

  // ── 5. Der Zeitstempel: was `stat` OHNE -L sieht ──────────────────────────

  it('jedes Schreiben frischt den VERWEIS auf, nicht nur sein Ziel', async () => {
    const alt = new Date(Date.now() - 3_600_000)
    // `lutimes` ueber den Umweg: den Verweis neu legen und zurueckdatieren.
    const linkVorher = lstatSync(alterOrt()).mtimeMs
    assert.ok(linkVorher > 0)
    const { lutimesSync } = await import('node:fs')
    lutimesSync(alterOrt(), alt, alt)
    assert.ok(lstatSync(alterOrt()).mtimeMs < Date.now() - 3_000_000, 'Vorbedingung: der Verweis ist alt')
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: medienSchluessel(ALT_WERK), titelNr: 5, bisher: 400, dauer: 900 })
      .expect(200)
    const nachher = lstatSync(alterOrt()).mtimeMs
    assert.ok(nachher > Date.now() - 10_000, `der Verweis muss frisch sein, ist aber ${new Date(nachher)}`)
    // UND DIE BEIDEN ZEITSTEMPEL SIND WIRKLICH ZWEI. Ein `notEqual` auf die
    // Zahlen waere hier untauglich: beide werden im selben Augenblick gesetzt
    // und fallen gern in dieselbe Millisekunde — der Test faellt dann je nach
    // Last mal so, mal so aus (genau so passiert, 05.08.2026). Also wird der
    // Unterschied ERZEUGT: das ZIEL wird zurueckdatiert, und der Verweis muss
    // frisch bleiben. Das ist die Eigenschaft, an der die Offline-Liste haengt
    // — `stat --format='%Y'` in den Skripten sieht den VERWEIS.
    const { utimesSync } = await import('node:fs')
    utimesSync(alterOrt(), alt, alt) // folgt dem Verweis: trifft das Ziel
    assert.ok(statSync(alterOrt()).mtimeMs < Date.now() - 3_000_000, 'das Ziel ist jetzt alt')
    assert.ok(lstatSync(alterOrt()).mtimeMs > Date.now() - 10_000, 'der Verweis ist trotzdem frisch')
  })

  // ── 6. Gleichzeitig schreiben ─────────────────────────────────────────────

  it('acht Meldungen auf einmal: KEINE geht verloren, und KEINE wird abgewiesen', async () => {
    // WAS HIER GEPRUEFT WIRD, ist `resumeNacheinander` (server.ts). Vor ihm
    // reichte die Sperrdatei nicht: ein root-Skript kann sie dem Server
    // wegloeschen, waehrend er schreibt, und dann schreiben zwei Meldungen
    // denselben Stand zurueck. Gemessen mit den ECHTEN Skripten in
    // `tools/e18s3-gegenprobe.py --nur B` — in VIER von acht Laeufen fehlte
    // danach eine quittierte Stelle.
    //
    // DER ZWEITE, LEISERE GEWINN steht in der zweiten Zusicherung: vorher
    // prallten gleichzeitige Meldungen an der Sperrdatei ab („gesperrt") und
    // waren fuer 15 s verloren. Auf der Box melden ZWEI Oberflaechen im Takt.
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)
    rmSync(bereich('liam'), { force: true })
    // ACHT UND NICHT ZEHN: der Deckel steht auf 9 („Zuletzt Gehoertes merken").
    // Bei zehn wirft `weiterStelleEinsetzen` die aelteste Zeile weg — richtig,
    // aber dann misst dieser Test den Deckel statt der Gleichzeitigkeit.
    const werke = Array.from({ length: 8 }, (_, i) => werk(`gl-parallel-${i}`, `Gleichzeitig ${i}`))
    // Die Werke muessen in der Medienliste stehen, sonst gibt es nichts zu merken.
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify([...MEDIEN, ...werke], null, 2))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify([...MEDIEN, ...werke], null, 2))
    const antworten = await Promise.all(
      werke.map((w) =>
        request(app)
          .post('/api/weiterhoeren')
          .send({ schluessel: medienSchluessel(w), titelNr: 2, bisher: 120, dauer: 900 }),
      ),
    )
    const abgewiesen = antworten.filter((a) => a.body?.status === 'gesperrt')
    assert.equal(abgewiesen.length, 0, `${abgewiesen.length} von 8 prallten an der Sperrdatei ab`)
    const drin = new Set(ids(bereich('liam')))
    const fehlt = werke.filter((w) => !drin.has(w.id)).map((w) => w.id)
    assert.deepEqual(fehlt, [], 'jede quittierte Stelle muss im Bestand stehen')
  })

  it('auch ein PROFILWECHSEL frischt auf — sonst friert offline_resume.json ein', async () => {
    const { lutimesSync } = await import('node:fs')
    const alt = new Date(Date.now() - 3_600_000)
    lutimesSync(alterOrt(), alt, alt)
    await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea' }).expect(200)
    assert.ok(lstatSync(alterOrt()).mtimeMs > Date.now() - 10_000)
  })
})
