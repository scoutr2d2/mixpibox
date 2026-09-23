/**
 * DER UMZUG IN DEN BEREICH — und die eine Eigenschaft, auf die es ankommt:
 * AUF EINER BESTEHENDEN BOX DARF SICH NICHTS VERLIEREN.
 *
 * WORUM ES GEHT: Bis heute trug jede benutzerbezogene Ablage einen
 * NAMENSZUSATZ (`gespielt.gast.json`). Ab E18 Stufe 2 liegt sie im BEREICH
 * ihres Profils (`profile/gast/gespielt.json`). Der Weg dorthin fuehrt ueber
 * eine Box, auf der DREI Formen gleichzeitig herumliegen koennen:
 *
 *   gespielt.json              box-weit, von vor dem 02.08.2026
 *   gespielt.gast.json         mit Namenszusatz, seit dem 02.08.2026
 *   profile/gast/gespielt.json im Bereich, ab jetzt
 *
 * WARUM DAS EINEN TEST BRAUCHT: ein misslungener Umzug faellt NICHT auf. Die
 * Box startet, die Oberflaeche laedt, die Reihen sind bloss leer — und das
 * sieht aus wie „noch nichts gehoert". Geprueft wird deshalb nicht der
 * Dateiname, sondern das ERGEBNIS: nach dem Start steht dasselbe da wie vorher,
 * und was nicht mitziehen durfte, liegt unangetastet an seinem Platz.
 *
 * EIGENER LAUF, EIGENES VERZEICHNIS: server.ts richtet die Bereiche EINMAL
 * beim Laden des Moduls her. Zwei Ausgangslagen brauchen deshalb zwei
 * Prozesse — `node --test` gibt jeder Testdatei einen eigenen.
 */
import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { tagesSchluessel } from './kinderzeit'
import { kennungPruefen } from './profile'

const EINTRAG = {
  id: 'test-bereich-1',
  title: 'Was vorher schon da war',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
}

const verlauf = (key: string, anzahl: number) => [{ key, anzahl, zuletzt: Date.now(), title: EINTRAG.title }]

/** Der Bestand des Gasts — box-weit, wie vor dem 02.08.2026. */
const GAST_BOXWEIT = verlauf(`${EINTRAG.type}:${EINTRAG.id}`, 7)
/** Liams Bestand — mit Namenszusatz, wie seit dem 02.08.2026. */
const LIAM_ZUSATZ = verlauf('spotify:liam-hoerte-das', 3)
/** Was ein Kind sich zusammengestellt hat. */
const GAST_LISTEN = [{ id: 'meine', name: 'Meine Liste', category: 'music', titel: [] }]

let app: import('express').Express
let ordner: string
const bereich = (kennung: string, datei: string) => join(ordner, 'profile', kennung, datei)

describe('E18 Stufe 2: der Bestand zieht in den Bereich um', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-bereich-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify([EINTRAG], null, 2))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify([EINTRAG], null, 2))

    // DREI PROFILE, damit alle drei Faelle in EINEM Lauf vorkommen.
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: 'mixpi-hoert.png', angelegt: 1 },
          { kennung: 'liam', name: 'Liam', figur: 'mixpi-hoert.png', angelegt: 2 },
          { kennung: 'kalea', name: 'Kalea', figur: 'mixpi-hoert.png', angelegt: 3 },
        ],
        aktiv: 'gast',
      }),
    )

    // FALL 1 — box-weit: der Verlauf und die Listen gehoeren dem Gast.
    writeFileSync(join(ordner, 'gespielt.json'), JSON.stringify(GAST_BOXWEIT))
    writeFileSync(join(ordner, 'listen.json'), JSON.stringify(GAST_LISTEN))
    writeFileSync(
      join(ordner, 'kinderzeit-verbrauch.json'),
      JSON.stringify({ tag: tagesSchluessel(new Date()), sekunden: 600, bonusMin: 0 }),
    )

    // FALL 2 — mit Namenszusatz: Liams Verlauf.
    writeFileSync(join(ordner, 'gespielt.liam.json'), JSON.stringify(LIAM_ZUSATZ))

    // FALL 3 — BEIDE Formen fuer den Gast beim Verbrauch: der Zusatz ist die
    // juengere Wahrheit und muss gewinnen, die box-weite bleibt LIEGEN.
    writeFileSync(
      join(ordner, 'kinderzeit-verbrauch.gast.json'),
      JSON.stringify({ tag: tagesSchluessel(new Date()), sekunden: 1200, bonusMin: 0 }),
    )

    // FALL 4 — EIN VERWEIS. `fs.renameSync` benennt den Verweis um, nicht sein
    // Ziel; er laege danach im Bereich und zeigte weiter nach draussen. Genau
    // so ein Verweis haengt an resume.json (naechste Stufe), deshalb steht die
    // Naht hier schon.
    writeFileSync(join(ordner, 'anderswo.json'), JSON.stringify(verlauf('spotify:fremd', 1)))
    symlinkSync(join(ordner, 'anderswo.json'), join(ordner, 'gespielt.kalea.json'))

    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('jedes Profil hat seinen Ordner — angelegt beim Anlegen, nicht beim ersten Schreiben', () => {
    for (const k of ['gast', 'liam', 'kalea']) {
      assert.equal(lstatSync(join(ordner, 'profile', k)).isDirectory(), true, k)
    }
  })

  it('der box-weite Verlauf gehoert jetzt dem Gast — und ist vollstaendig da', async () => {
    assert.equal(existsSync(bereich('gast', 'gespielt.json')), true)
    assert.equal(existsSync(join(ordner, 'gespielt.json')), false, 'umbenannt, nicht kopiert')
    const r = await request(app).get('/api/gespielt?max=50').expect(200)
    assert.equal(r.body.profil, 'gast')
    const treffer = r.body.haeufigste.find((e: { key: string }) => e.key === GAST_BOXWEIT[0].key)
    assert.ok(treffer, 'der Eintrag von vorher muss weiter im Verlauf stehen')
    assert.equal(treffer.anzahl, 7, 'und mit derselben Zahl')
  })

  it('die Form mit Namenszusatz zieht ebenfalls um — auch fuer ein anderes Kind', async () => {
    assert.equal(existsSync(bereich('liam', 'gespielt.json')), true)
    assert.equal(existsSync(join(ordner, 'gespielt.liam.json')), false)
    const r = await request(app).get('/api/gespielt?max=50&profil=liam').expect(200)
    assert.equal(r.body.haeufigste[0]?.key, LIAM_ZUSATZ[0].key)
  })

  it('liegen BEIDE Formen da, gewinnt der Namenszusatz — und die aeltere bleibt liegen', async () => {
    const r = await request(app).get('/api/kinderzeit/stand?profil=gast').expect(200)
    assert.equal(r.body.verbrauchtMin, 20, '1200 s aus der juengeren Form, nicht 600 aus der aelteren')
    assert.equal(existsSync(bereich('gast', 'kinderzeit-verbrauch.json')), true)
    assert.equal(existsSync(join(ordner, 'kinderzeit-verbrauch.gast.json')), false, 'die juengere ist umgezogen')
    assert.equal(
      existsSync(join(ordner, 'kinderzeit-verbrauch.json')),
      true,
      'die aeltere wird NICHT weggeworfen — sie liegt da und stoert niemanden',
    )
  })

  it('die eigenen Listen ziehen mit — sie hingen bisher an gar keiner Kennung', async () => {
    assert.equal(existsSync(bereich('gast', 'listen.json')), true)
    assert.equal(existsSync(join(ordner, 'listen.json')), false)
    const r = await request(app).get('/api/listen').expect(200)
    assert.equal(r.body.profil, 'gast')
    assert.equal(r.body.listen.length, 1)
    assert.equal(r.body.listen[0].name, 'Meine Liste')
  })

  it('ein VERWEIS zieht NICHT mit — sonst zeigte er aus dem Bereich nach draussen', async () => {
    const verweis = join(ordner, 'gespielt.kalea.json')
    assert.equal(lstatSync(verweis).isSymbolicLink(), true, 'er liegt noch da, wo er lag')
    assert.equal(existsSync(bereich('kalea', 'gespielt.json')), false, 'und ist NICHT in den Bereich gewandert')
    // Und die Box kommt damit klar: Kalea faengt bei null an, statt zu stuerzen.
    const r = await request(app).get('/api/gespielt?max=50&profil=kalea').expect(200)
    assert.equal(r.body.haeufigste.length, 0)
  })

  it('kinderzeit.json bleibt box-weit — der Regelsatz gehoert allen zusammen', () => {
    assert.equal(existsSync(bereich('gast', 'kinderzeit.json')), false)
  })

  it('resume.json bleibt box-weit — es ist eine eigene Stufe', () => {
    assert.equal(existsSync(bereich('gast', 'resume.json')), false)
  })

  it('geschrieben wird IN den Bereich — und nicht daneben', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)
    await request(app).post('/api/listen').send({ name: 'Liams Liste' }).expect(200)
    assert.equal(existsSync(bereich('liam', 'listen.json')), true)
    assert.equal(existsSync(join(ordner, 'listen.liam.json')), false, 'kein Namenszusatz mehr')
    assert.equal(existsSync(join(ordner, 'listen.json')), false, 'und nichts wieder box-weit')

    // Und die Trennung haelt in beide Richtungen.
    const liam = await request(app).get('/api/listen').expect(200)
    assert.deepEqual(
      liam.body.listen.map((l: { name: string }) => l.name),
      ['Liams Liste'],
    )
    assert.equal(JSON.parse(readFileSync(bereich('gast', 'listen.json'), 'utf8')).length, 1, 'der Gast behaelt seine')
  })

  it('ein NEUES Profil bekommt seinen Ordner sofort, ohne dass etwas hineinfaellt', async () => {
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'liam', name: 'Liam' },
          { kennung: 'kalea', name: 'Kalea' },
          { kennung: 'nele', name: 'Nele' },
        ],
      })
      .expect(200)
    assert.equal(lstatSync(join(ordner, 'profile', 'nele')).isDirectory(), true)
  })

  it('ein GELOESCHTES Profil bekommt seinen Ordner BEISEITEGELEGT — nicht weggeworfen', async () => {
    // ══ HIER STAND BIS ZUM 07.08.2026 DAS GEGENTEIL ═══════════════════════
    // „ein GELOESCHTES Profil behaelt seinen Ordner": der Ordner blieb liegen,
    // wo er lag. Das war richtig, SOLANGE niemand nachfragte — die Verwaltung
    // konnte gar nicht loeschen. Seit die Seite „Kinder" im Admin-Menue mit
    // NAMEN fragt und aufzaehlt, was mitgeht, dreht sich die Abwaegung um: Die
    // Kennung kommt aus dem NAMEN, also bekommt das zweite Kind namens Liam
    // dieselbe — und faende den Verlauf des ersten vor.
    //
    // ZWEI DINGE WERDEN GEPRUEFT, UND DAS ZWEITE IST DAS WICHTIGERE:
    //   1. AN DER ALTEN STELLE liegt nichts mehr. Sonst erbte das naechste Kind.
    //   2. ES IST NICHT WEG. Ein Fehlgriff auf einem Beruehrschirm darf den
    //      Verlauf eines Kindes nicht unwiederbringlich kosten.
    // ETWAS HINEINLEGEN, DAS SICH WIEDERERKENNEN LAESST: Kalea hat in diesem
    // Lauf keinen umgezogenen Verlauf (ihr Bestand haengt an einem VERWEIS,
    // der absichtlich liegen bleibt). Ein Test, der auf einen leeren Ordner
    // schaut, koennte den Unterschied zwischen „beiseitegelegt" und
    // „weggeworfen" gar nicht sehen.
    const vorher = JSON.stringify(verlauf('spotify:kaleas-eigenes', 5))
    writeFileSync(bereich('kalea', 'gespielt.json'), vorher)
    await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'liam', name: 'Liam' }] })
      .expect(200)
    assert.equal(existsSync(join(ordner, 'profile', 'nele')), false, 'die alte Stelle ist frei')
    assert.equal(existsSync(bereich('kalea', '.')), false, 'auch die von Kalea')

    const graeber = readdirSync(join(ordner, 'profile')).filter((n) => n.startsWith('geloescht-'))
    assert.equal(graeber.some((n) => n.startsWith('geloescht-nele-')), true, 'Nele liegt beiseite')
    const kaleaGrab = graeber.find((n) => n.startsWith('geloescht-kalea-'))
    assert.ok(kaleaGrab, 'Kalea auch')
    assert.equal(
      readFileSync(join(ordner, 'profile', kaleaGrab, 'gespielt.json'), 'utf8'),
      vorher,
      'und ihr Verlauf steht unangetastet darin',
    )
    // KEIN GRABSTEIN KANN JE EINE KENNUNG SEIN: `geloescht-` (10) + Kennung
    // (mind. 1) + `-` + Millisekunden (13) sind mindestens 25 Zeichen, und
    // KENNUNG_MUSTER laesst hoechstens 24 zu. Damit kann ein neues Kind
    // niemals einen Bereich bekommen, der auf einen Grabstein zeigt.
    for (const g of graeber) assert.equal(kennungPruefen(g), false, g)
  })

  it('ein UMBENANNTES Kind behaelt alles — die Kennung bleibt dieselbe', async () => {
    // Die Gegenprobe zum Test darueber. Umbenennen ist der haeufige Griff,
    // Loeschen der seltene; wuerde `verschwundeneKennungen` den Namen statt der
    // Kennung vergleichen, legte jede Umbenennung den Bereich beiseite — und
    // das faellt erst auf, wenn das Kind das naechste Mal weiterhoeren will.
    const vorher = readFileSync(bereich('liam', 'gespielt.json'), 'utf8')
    await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'liam', name: 'Liam der Zweite' }] })
      .expect(200)
    assert.equal(readFileSync(bereich('liam', 'gespielt.json'), 'utf8'), vorher)
    assert.equal(
      readdirSync(join(ordner, 'profile')).some((n) => n.startsWith('geloescht-liam-')),
      false,
    )
  })

  it('ein zweiter Start fasst nichts mehr an — der Umzug ist einmalig', async () => {
    // Was ein zweiter Prozess taete (Wiki mupi-two-node-processes): er findet
    // die Ziele vor und laesst die Finger davon. Nachgestellt, indem eine alte
    // Form WIEDER hingelegt und das Herrichten ueber /api/profile ausgeloest
    // wird — genau der Weg, den auch ein Neustart nimmt.
    const vorher = readFileSync(bereich('gast', 'gespielt.json'), 'utf8')
    writeFileSync(join(ordner, 'gespielt.gast.json'), '[]')
    await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'liam', name: 'Liam' }] })
      .expect(200)
    assert.equal(readFileSync(bereich('gast', 'gespielt.json'), 'utf8'), vorher, 'das Ziel gewinnt')
    assert.equal(
      existsSync(join(ordner, 'gespielt.gast.json')),
      true,
      'und die wieder hingelegte Datei verschwindet nicht still',
    )
  })

  it('ein Umzug, der GAR NICHT stattfinden kann, verliert trotzdem nichts', async () => {
    // DER SCHLIMMSTE FALL, DEN ES HIER GIBT: der Bereich laesst sich nicht
    // anlegen (schreibgeschuetzte Karte, volle Partition). Ohne Rueckfall
    // saehe die Box dann aus wie neu — Verlauf leer, keine Meldung, und
    // gemerkt haette es jemand erst Wochen spaeter.
    //
    // NACHGESTELLT, indem an der Stelle des Bereichs eine DATEI liegt: mkdir
    // scheitert, das Umbenennen scheitert, und der Bestand liegt weiter unter
    // seinem alten Namen. Gelesen werden muss er trotzdem.
    writeFileSync(join(ordner, 'profile', 'pia'), 'im Weg')
    writeFileSync(join(ordner, 'gespielt.pia.json'), JSON.stringify(verlauf('spotify:pia', 5)))
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'liam', name: 'Liam' },
          { kennung: 'pia', name: 'Pia' },
        ],
      })
      .expect(200)
    assert.equal(lstatSync(join(ordner, 'profile', 'pia')).isFile(), true, 'der Umzug ist wirklich gescheitert')
    assert.equal(existsSync(join(ordner, 'gespielt.pia.json')), true, 'und der Bestand liegt noch, wo er lag')
    const r = await request(app).get('/api/gespielt?max=50&profil=pia').expect(200)
    assert.equal(r.body.haeufigste[0]?.key, 'spotify:pia', 'gelesen wird er trotzdem')
  })

  it('nach einem geglueckten Umzug wird die alte Stelle NIE wieder gelesen', async () => {
    // DER RUECKFALL DARF KEIN ZWEITER WAHRHEITSORT WERDEN. Liegt im Bereich
    // etwas, gewinnt er — auch wenn daneben eine aeltere Form auftaucht (ein
    // Rueckbau, ein zweiter Prozess, eine Sicherung von Hand).
    // Mit einem FRISCHEN Profil geprueft: bei einem schon gelesenen kaeme die
    // Antwort aus dem Zwischenspeicher, und der Test waere gruen, ohne je die
    // Platte gefragt zu haben.
    mkdirSync(join(ordner, 'profile', 'mia'), { recursive: true })
    writeFileSync(bereich('mia', 'gespielt.json'), JSON.stringify(verlauf('spotify:im-bereich', 4)))
    writeFileSync(join(ordner, 'gespielt.mia.json'), JSON.stringify(verlauf('spotify:untergeschoben', 99)))
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'liam', name: 'Liam' },
          { kennung: 'mia', name: 'Mia' },
        ],
      })
      .expect(200)
    const r = await request(app).get('/api/gespielt?max=50&profil=mia').expect(200)
    assert.equal(r.body.haeufigste[0]?.key, 'spotify:im-bereich')
    assert.equal(existsSync(join(ordner, 'gespielt.mia.json')), true, 'die aeltere Form bleibt liegen, unbeachtet')
  })
})
