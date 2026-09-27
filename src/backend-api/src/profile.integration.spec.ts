/**
 * Die UEBERNAHME am laufenden Server — und die eine Eigenschaft, auf die es
 * ankommt: WER HEUTE ETWAS HAT, HAT ES NACHHER IMMER NOCH.
 *
 * WORUM ES GEHT: Verlauf und Kinderzeitverbrauch lagen bis heute box-weit in
 * `gespielt.json` und `kinderzeit-verbrauch.json`, die Regeln als blankes
 * Objekt in `kinderzeit.json`. Ab jetzt haengt alles an einer Kennung, und
 * ohne Auswahl heisst die `gast`.
 *
 * WARUM DAS EINEN TEST BRAUCHT: Ein misslungener Umzug faellt NICHT auf. Die
 * Box startet, die Oberflaeche laedt, die Reihen sind bloss leer — und das
 * sieht aus wie „noch nichts gehoert". Erst Wochen spaeter merkt jemand, dass
 * der Verlauf von einem Jahr weg ist. Dieser Test prueft deshalb nicht die
 * Dateinamen, sondern das ERGEBNIS: nach dem Start steht dasselbe da wie
 * vorher.
 *
 * UND: eine Box, auf der niemand ein Profil angelegt hat, muss sich GENAU wie
 * heute verhalten. Ein Kind darf von dieser Aenderung nichts merken.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { tagesSchluessel } from './kinderzeit'

const EINTRAG = {
  id: 'test-profil-1',
  title: 'Was vorher schon da war',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
}

/** So sah ein Verlaufseintrag aus, bevor es Profile gab. */
const ALTER_VERLAUF = [{ key: `${EINTRAG.type}:${EINTRAG.id}`, anzahl: 7, zuletzt: Date.now(), title: EINTRAG.title }]

/** Die ALTE Form von kinderzeit.json: ein blankes Regeln-Objekt. */
const ALTE_REGELN = { aktiv: true, nachsichtMin: 3, tage: { mo: { frei: true, ab: '', bis: '20:00', minuten: 45 } } }

let app: import('express').Express
let uebernehmen: (alt: string, neu: string) => void
let ordner: string

describe('Mehrbenutzer-Vorbereitung: der Bestand zieht mit um', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-profile-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify([EINTRAG], null, 2))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify([EINTRAG], null, 2))
    // DER BESTAND VON GESTERN, an genau den Stellen, an denen er heute liegt.
    writeFileSync(join(ordner, 'gespielt.json'), JSON.stringify(ALTER_VERLAUF))
    writeFileSync(join(ordner, 'kinderzeit.json'), JSON.stringify(ALTE_REGELN))
    writeFileSync(
      join(ordner, 'kinderzeit-verbrauch.json'),
      JSON.stringify({ tag: tagesSchluessel(new Date()), sekunden: 600, bonusMin: 0 }),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    app = modul.app
    uebernehmen = modul.ablageUebernehmen
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('ohne Profile ist der Gast dran — es gibt keinen Zustand „niemand"', async () => {
    const r = await request(app).get('/api/profile').expect(200)
    assert.equal(r.body.aktiv, 'gast')
    assert.equal(r.body.profile.length, 1)
    assert.equal(r.body.profile[0].kennung, 'gast')
  })

  it('der alte Verlauf ist noch da — „oft gehoert" verliert nichts', async () => {
    const r = await request(app).get('/api/gespielt?max=50').expect(200)
    assert.equal(r.body.profil, 'gast')
    const treffer = r.body.haeufigste.find((e: { key: string }) => e.key === ALTER_VERLAUF[0].key)
    assert.ok(treffer, 'der Eintrag von vorher muss weiter im Verlauf stehen')
    assert.equal(treffer.anzahl, 7, 'und mit derselben Zahl')
  })

  it('umbenannt, nicht kopiert — zwei Wahrheiten waeren schlimmer als eine alte', () => {
    // SEIT E18 STUFE 2 IN DEN BEREICH, nicht mehr in einen Namenszusatz. Was
    // der Umzug im Einzelnen aushalten muss (beide alten Formen, ein Verweis,
    // ein gescheiterter Umzug), steht in bereich.integration.spec.ts.
    assert.equal(existsSync(join(ordner, 'profile', 'gast', 'gespielt.json')), true)
    assert.equal(existsSync(join(ordner, 'gespielt.gast.json')), false)
    assert.equal(existsSync(join(ordner, 'gespielt.json')), false)
  })

  it('ein zweiter Anlauf fasst nichts an — auf dieser Box laufen zwei Node-Prozesse', () => {
    // Wiki mupi-two-node-processes: das ist hier passiert, nicht ausgedacht.
    const alt = join(ordner, 'gespielt.json')
    const neu = join(ordner, 'profile', 'gast', 'gespielt.json')
    const vorher = readFileSync(neu, 'utf8')
    // Fall A: die alte Datei ist weg — nichts zu tun.
    uebernehmen(alt, neu)
    assert.equal(readFileSync(neu, 'utf8'), vorher)
    // Fall B: jemand legt wieder eine alte Datei hin (ein zweiter Prozess,
    // ein Rueckbau). Das Ziel gewinnt, es wird NICHT ueberschrieben.
    writeFileSync(alt, '[]')
    uebernehmen(alt, neu)
    assert.equal(readFileSync(neu, 'utf8'), vorher, 'das Ziel darf nicht ueberschrieben werden')
    assert.equal(existsSync(alt), true, 'und die alte Datei bleibt liegen, statt still zu verschwinden')
  })

  it('die alte Regelform wird gelesen — eine Zeitgrenze faellt nicht still aus', async () => {
    const r = await request(app).get('/api/kinderzeit').expect(200)
    assert.equal(r.body.aktiv, true)
    assert.equal(r.body.nachsichtMin, 3)
    assert.equal(r.body.tage.mo.minuten, 45)
  })

  it('der verbrauchte Tageszaehler zieht mit um', async () => {
    const r = await request(app).get('/api/kinderzeit/stand').expect(200)
    assert.equal(r.body.profil, 'gast')
    assert.equal(r.body.verbrauchtMin, 10, '600 Sekunden von vorher')
  })

  it('kennt kein Profil, das es nicht gibt', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(400)
    await request(app).get('/api/gespielt?profil=../../etc').expect(400)
    await request(app).get('/api/kinderzeit/stand?profil=liam').expect(400)
  })

  it('legt ein Profil an — der Gast bleibt und steht vorn', async () => {
    const r = await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'liam', name: 'Liam', figur: 'mixpi-hoert.png' }] })
      .expect(200)
    assert.deepEqual(
      r.body.profile.map((p: { kennung: string }) => p.kennung),
      ['gast', 'liam'],
    )
    assert.equal(r.body.aktiv, 'gast', 'anlegen ist nicht anmelden')
  })

  it('umgeschaltet: jetzt zaehlt Liams Topf, und der des Gasts bleibt liegen', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)

    const liam = await request(app).get('/api/gespielt?max=50').expect(200)
    assert.equal(liam.body.profil, 'liam')
    assert.equal(liam.body.haeufigste.length, 0, 'Liam faengt bei null an')

    const gast = await request(app).get('/api/gespielt?max=50&profil=gast').expect(200)
    assert.equal(gast.body.haeufigste.length, 1, 'und der Gast behaelt seins')
  })

  it('der BESITZER kommt vom Server, nicht aus der Meldung', async () => {
    // Duerfte der Client ihn mitschicken, meldete die eine Oberflaeche unter
    // Gast und die andere unter dem Kind — derselbe Titel stuende zweimal im
    // Verlauf. Deshalb wird `profil` in der Meldung IGNORIERT.
    const r = await request(app)
      .post('/api/gespielt')
      .send({ key: 'spotify:fremd', title: 'Fremdes', profil: 'gast' })
      .expect(200)
    assert.equal(r.body.profil, 'liam')

    const gast = await request(app).get('/api/gespielt?max=50&profil=gast').expect(200)
    assert.equal(
      gast.body.zuletzt.some((e: { key: string }) => e.key === 'spotify:fremd'),
      false,
      'beim Gast darf nichts angekommen sein',
    )
  })

  it('Liam erbt die Hausregel, hat aber ein eigenes Zeitkonto', async () => {
    // Ein neues Kind soll nicht unbegrenzt starten duerfen, nur weil es neu
    // ist — es erbt die Regel der Box. Sein VERBRAUCH faengt trotzdem bei
    // null an, sonst zahlte es fuer das, was der Gast gehoert hat.
    const r = await request(app).get('/api/kinderzeit/stand').expect(200)
    assert.equal(r.body.profil, 'liam')
    assert.equal(r.body.aktiv, true, 'die Hausregel gilt weiter')
    assert.equal(r.body.verbrauchtMin, 0, 'aber der Zaehler ist seiner')

    const gast = await request(app).get('/api/kinderzeit/stand?profil=gast').expect(200)
    assert.equal(gast.body.verbrauchtMin, 10)
  })

  it('eine Ausnahme je Profil laesst die Hausregel unangetastet', async () => {
    await request(app)
      .put('/api/kinderzeit?profil=liam')
      .send({ aktiv: true, nachsichtMin: 1, tage: { mo: { frei: true, ab: '', bis: '', minuten: 15 } } })
      .expect(200)
    const liam = await request(app).get('/api/kinderzeit?profil=liam').expect(200)
    assert.equal(liam.body.tage.mo.minuten, 15)
    const haus = await request(app).get('/api/kinderzeit').expect(200)
    assert.equal(haus.body.tage.mo.minuten, 45, 'die Hausregel darf sich nicht mitverschieben')
  })

  it('das Kind aendert SEINEN Namen — und nur seinen', async () => {
    // Der Weg des Profilfensters (`#ich`, 07.08.2026). Es steht VOR der Sperre,
    // schickt deshalb NIE eine Liste und kann nur den treffen, der gerade dran
    // ist. Hier ist das Liam (die Aussage darueber hat umgeschaltet).
    const r = await request(app).post('/api/profil/name').send({ name: '  Liam der Zweite  ' }).expect(200)
    const liam = r.body.profile.find((p: { kennung: string }) => p.kennung === 'liam')
    assert.equal(liam.name, 'Liam der Zweite', 'die Leerzeichen aussen fallen weg')
    const gast = r.body.profile.find((p: { kennung: string }) => p.kennung === 'gast')
    assert.equal(gast.name, 'Gast', 'und das Geschwister bleibt unangetastet')
  })

  it('ein leerer Name wird abgewiesen — nicht auf die Kennung gebogen', async () => {
    // `profilNormalisieren` setzt bei leerem Namen die Kennung ein. Als Rettung
    // einer kaputten Datei ist das richtig; als Antwort auf „alles wegwischen
    // und Fertig" waere es eine Ueberraschung.
    await request(app).post('/api/profil/name').send({ name: '   ' }).expect(400)
    await request(app).post('/api/profil/name').send({}).expect(400)
    const r = await request(app).get('/api/profile').expect(200)
    const liam = r.body.profile.find((p: { kennung: string }) => p.kennung === 'liam')
    assert.equal(liam.name, 'Liam der Zweite', 'der Name von vorhin steht noch')
  })

  it('eine Umbenennung ueber die LISTE loescht keine Bildwahl', async () => {
    // DER FALL, DEN `figurenBewahren` ABFAENGT: Die Seite „Kinder" benennt um
    // und sagt ueber Bilder nichts. Ohne die Bewahrung stuende danach ueberall
    // `figur: ''` — und zwar dauerhaft, weil `GET /api/profile` in genau dem
    // Augenblick, in dem der Figurenordner nicht lesbar ist, ueberall '' meldet.
    //
    // GEPRUEFT WIRD AM GESCHRIEBENEN STAND, nicht an der Antwort des GET: der
    // filtert selbst. Hier zaehlt, was auf der Platte liegt.
    await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'liam', name: 'Liam', figur: 'mixpi-hoert.png' }] })
      .expect(200)
    const r = await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'liam', name: 'Liam der Dritte' }] })
      .expect(200)
    const liam = r.body.profile.find((p: { kennung: string }) => p.kennung === 'liam')
    assert.equal(liam.name, 'Liam der Dritte')
    assert.equal(liam.figur, 'mixpi-hoert.png', 'die Bildwahl steht noch')
  })

  it('aber ein ausdrueckliches leeres Bild setzt sie zurueck', async () => {
    const r = await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'liam', name: 'Liam der Dritte', figur: '' }] })
      .expect(200)
    const liam = r.body.profile.find((p: { kennung: string }) => p.kennung === 'liam')
    assert.equal(liam.figur, '')
  })

  /* ══ DAS SCHLOSS DES AKTIVEN PROFILS — POST /api/profil/anmelden ════════
   *
   * DIE LUECKE, UM DIE ES GEHT: `POST /api/profil/aktiv` prueft das Passwort
   * nur bei einem ECHTEN Wechsel. Wer im „Wer hoert?"-Fenster sein eigenes,
   * bereits aktives Profil antippte, kam ohne Passwort hinein — an dem
   * Fenster vorbei, das nach einem Kaltstart genau davor steht. Der erste
   * Zeuge hier haelt GENAU DIESE alte Luecke fest, damit niemand sie fuer
   * behoben haelt, wo sie es nicht ist.
   */
  it('der alte Weg laesst das AKTIVE Profil weiter ohne Passwort durch — deshalb gibt es die neue Route', async () => {
    await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'liam', name: 'Liam', figur: 'mixpi-hoert.png' }] })
      .expect(200)
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)
    await request(app)
      .post('/api/profil/passwort')
      .send({ art: 'zahlen', neu: '1234' })
      .expect(200)
    // Liam ist aktiv UND geschuetzt. Der Wechsel auf sich selbst geht durch:
    // das ist die dokumentierte Ecke, nicht ein Fehler dieser Zeile.
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)
  })

  it('anmelden verlangt das Passwort des aktiven Profils — ohne zu wechseln', async () => {
    const ohne = await request(app).post('/api/profil/anmelden').send({ kennung: 'liam' }).expect(401)
    assert.equal(ohne.body.error, 'passwortNoetig')
    assert.equal(ohne.body.art, 'zahlen', 'die Art sagt der Oberflaeche, WELCHE Eingabe sie zeigt')

    const falsch = await request(app)
      .post('/api/profil/anmelden')
      .send({ kennung: 'liam', passwort: '9999' })
      .expect(403)
    assert.equal(falsch.body.error, 'passwortFalsch')

    const richtig = await request(app)
      .post('/api/profil/anmelden')
      .send({ kennung: 'liam', passwort: '1234' })
      .expect(200)
    assert.equal(richtig.body.ok, true)
    assert.equal(richtig.body.geschuetzt, true)
  })

  it('und sie WECHSELT nichts — wer aktiv war, bleibt es', async () => {
    // Der Unterschied zu /api/profil/aktiv ist der ganze Zweck: Diese Route
    // beantwortet eine Frage, sie tut nichts. Waere sie ein zweiter
    // Umschalter, haette sie die Sorgfalt des ersten (anhalten, Bruecke
    // richten, Nachsicht zuruecksetzen) still zu umgehen gelernt.
    const vorher = await request(app).get('/api/profile').expect(200)
    await request(app).post('/api/profil/anmelden').send({ kennung: 'liam', passwort: '1234' }).expect(200)
    const nachher = await request(app).get('/api/profile').expect(200)
    assert.equal(nachher.body.aktiv, vorher.body.aktiv)
    assert.equal(nachher.body.aktiv, 'liam')
  })

  it('ein Profil ohne Schloss sagt es freundlich, statt 401 zu werfen', async () => {
    // „Kein Passwort" ist eine Antwort und kein Fehler: die Oberflaeche
    // fragt dann gar nicht erst, und ein 401 haette sie in eine Eingabe
    // geschickt, die niemand beantworten kann.
    const r = await request(app).post('/api/profil/anmelden').send({ kennung: 'gast' }).expect(200)
    assert.equal(r.body.ok, true)
    assert.equal(r.body.geschuetzt, false)
  })

  it('ein Profil, das es nicht gibt, wird abgewiesen — nicht gebogen', async () => {
    await request(app).post('/api/profil/anmelden').send({ kennung: 'gibtesnicht' }).expect(400)
  })

  it('wer geloescht wird, ist nicht mehr dran — Musik geht weiter, unter Gast', async () => {
    const r = await request(app).put('/api/profile').send({ profile: [] }).expect(200)
    assert.deepEqual(
      r.body.profile.map((p: { kennung: string }) => p.kennung),
      ['gast'],
    )
    assert.equal(r.body.aktiv, 'gast')
  })
})
