/**
 * Aufraeumen ueber die Schnittstelle — der Weg, auf dem wirklich etwas
 * verschwindet.
 *
 * Die ENTSCHEIDUNG, was angeboten wird, steht in aufraeumen.spec.ts. Hier geht
 * es um die drei Zusagen, die man einer reinen Funktion nicht ansieht:
 *
 *   1. Es faellt NUR, was die Regel vorgeschlagen hat. Ein Schluessel, den
 *      jemand von Hand hineinschreibt, wird abgelehnt — sonst gaebe es einen
 *      zweiten, leiseren Weg zum Sammelloeschen, an dem die ganze Absicherung
 *      vorbeigeht.
 *   2. Vor dem ersten Entfernen liegt eine benannte Sicherung.
 *   3. Der Rueckweg spielt sie wieder ein.
 *
 * Der Zaehlerstand wird als Datei VORGEGEBEN (verfuegbarkeit.json) — so
 * braucht der Test weder Netz noch eine tote Playlist noch 24 Stunden Geduld.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { medienSchluessel } from './medien.js'

const TOT = { playlistid: 'pl-tot', title: 'Das Pummeleinhorn', artist: 'Hoerspiel', type: 'spotify' }
const LEBT = { playlistid: 'pl-lebt', title: 'Die drei ???', artist: 'Europa', type: 'spotify' }
const JELLY = { id: 'jf-1', title: 'Ein Album', artist: 'Wer auch immer', type: 'jellyfin-album' }

let app: import('express').Express
let verzeichnis = ''

describe('Aufraeumen ueber die Schnittstelle', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-aufraeumen-'))
    const liste = [TOT, LEBT, JELLY]
    writeFileSync(join(verzeichnis, 'data.json'), JSON.stringify(liste, null, 2))
    writeFileSync(join(verzeichnis, 'active_data.json'), JSON.stringify(liste, null, 2))
    // Reif: drei Laeufe und laengst mehr als einen Tag her.
    writeFileSync(
      join(verzeichnis, 'verfuegbarkeit.json'),
      JSON.stringify({ 'pl-tot': { seit: Date.now() - 5 * 24 * 60 * 60 * 1000, laeufe: 3 } }),
    )
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    // EIGENE SPERRDATEI JE LAUF: `node --test` startet die Spec-Dateien
    // parallel, und weiter unten legt ein Test die Sperre absichtlich selbst
    // an. An der gemeinsamen /tmp-Sperre haette das jeden anderen Lauf
    // mitgesperrt — und auf einem Entwicklungsrechner mit laufender Box auch
    // die.
    process.env.MUPIBOX_LOCK_DIR = verzeichnis
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  it('schlaegt den toten Eintrag vor — mit Schluessel UND Kennung', async () => {
    const r = await request(app).get('/api/medien/verfuegbarkeit').expect(200)
    assert.deepEqual(r.body.geloescht, ['pl-tot'])
    assert.equal(r.body.vorschlaege.length, 1)
    const v = r.body.vorschlaege[0]
    // Der SCHLUESSEL kommt vom Server. Baute die Verwaltung ihn aus der
    // Kennung, stuende hier "spotify:pl-tot" - entfernt wird aber unter
    // medienSchluessel, und das ist bei diesem Eintrag derselbe Wert nur
    // zufaellig.
    assert.equal(v.schluessel, medienSchluessel(TOT))
    assert.equal(v.kennung, 'pl-tot')
    assert.equal(v.titel, 'Das Pummeleinhorn')
    assert.equal(v.laeufe, 3)
  })

  it('lehnt einen Schluessel ab, den die Regel NICHT vorgeschlagen hat', async () => {
    const r = await request(app)
      .post('/api/medien/aufraeumen')
      .send({ schluessel: [medienSchluessel(LEBT), medienSchluessel(JELLY)] })
      .expect(409)
    assert.equal(r.body.error, 'nichtVorgeschlagen')
    assert.equal(r.body.abgelehnt.length, 2)
    // Und die Bibliothek steht unveraendert da.
    const liste = JSON.parse(readFileSync(join(verzeichnis, 'data.json'), 'utf8'))
    assert.equal(liste.length, 3)
  })

  it('entfernt den vorgeschlagenen Eintrag und legt vorher eine Sicherung an', async () => {
    const r = await request(app)
      .post('/api/medien/aufraeumen')
      .send({ schluessel: [medienSchluessel(TOT), medienSchluessel(LEBT)] })
      .expect(200)
    assert.equal(r.body.entfernt, 1)
    assert.deepEqual(r.body.abgelehnt, [medienSchluessel(LEBT)])
    assert.match(r.body.sicherung, /^data-vor-aufraeumen-/)

    const liste = JSON.parse(readFileSync(join(verzeichnis, 'data.json'), 'utf8'))
    assert.deepEqual(
      liste.map((e: { title: string }) => e.title),
      ['Die drei ???', 'Ein Album'],
    )

    // Die Sicherung traegt den Stand VOR dem Entfernen.
    const gesichert = JSON.parse(readFileSync(join(verzeichnis, r.body.sicherung), 'utf8'))
    assert.equal(gesichert.length, 3)
    // Und medienAendern hat zusaetzlich seine .bak angelegt.
    assert.ok(existsSync(join(verzeichnis, 'data.json.bak')))
  })

  it('spielt die Sicherung wieder ein', async () => {
    const sicherung = readdirSync(verzeichnis).find((n) => n.startsWith('data-vor-aufraeumen-'))
    assert.ok(sicherung, 'es muss eine Sicherung geben')
    const r = await request(app).post('/api/medien/aufraeumen/zurueck').send({ sicherung }).expect(200)
    assert.equal(r.body.eintraege, 3)
    const liste = JSON.parse(readFileSync(join(verzeichnis, 'data.json'), 'utf8'))
    assert.equal(liste.length, 3)
  })

  it('nimmt keinen erfundenen Dateinamen an', async () => {
    // Ein Dateiname von aussen: streng am Muster, nicht nur auf ".." geprueft.
    for (const name of ['../../etc/passwd', 'data.json', 'data-vor-aufraeumen-xxx.json', '']) {
      const r = await request(app).post('/api/medien/aufraeumen/zurueck').send({ sicherung: name }).expect(400)
      assert.equal(r.body.error, 'nameUngueltig')
    }
  })

  it('eine leere Auswahl ist ein Fehler, kein stiller Erfolg', async () => {
    const r = await request(app).post('/api/medien/aufraeumen').send({ schluessel: [] }).expect(400)
    assert.equal(r.body.error, 'keineAuswahl')
  })

  /**
   * EINE SICHERUNG, DIE MAN VERLIERT, WEIL NICHTS PASSIERT IST, IST SCHLIMMER
   * ALS KEINE.
   *
   * Es bleiben nur die drei juengsten Sicherungen. Entsteht bei jedem
   * FOLGENLOSEN Versuch eine, schieben drei davon die echte heraus — die mit
   * den fuenf Werken, die ein Elternteil vorhin weggeraeumt hat.
   *
   * FOLGENLOS IST NICHT AUSGEDACHT: die Verwaltung darf in einem zweiten,
   * veralteten Fenster offen stehen, und `medienAendern` weist ab, sobald
   * irgendein anderer Schreibweg gerade die Sperre haelt (die Box selbst
   * schreibt data.json beim Hinzufuegen).
   */
  it('legt KEINE Sicherung an, wenn die Bibliothek gerade gesperrt ist', async () => {
    // ERST DIE SEKUNDE WECHSELN LASSEN. Der Name der Sicherung hat
    // Sekundenaufloesung: liefe dieser Test in derselben Sekunde wie der
    // vorige, traege eine neu angelegte Sicherung denselben Namen, ueberschriebe
    // die vorhandene — und die Anzahl bliebe gleich. Der Test waere gruen
    // geblieben, obwohl genau der Fehler passiert ist, den er sucht.
    await new Promise((f) => setTimeout(f, 1100))
    const vorher = readdirSync(verzeichnis).filter((n) => n.startsWith('data-vor-aufraeumen-'))
    writeFileSync(join(verzeichnis, '.data.lock'), '')
    try {
      const r = await request(app)
        .post('/api/medien/aufraeumen')
        .send({ schluessel: [medienSchluessel(TOT)] })
        .expect(409)
      assert.equal(r.body.error, 'gesperrt')
    } finally {
      rmSync(join(verzeichnis, '.data.lock'))
    }
    const nachher = readdirSync(verzeichnis).filter((n) => n.startsWith('data-vor-aufraeumen-'))
    assert.deepEqual(nachher, vorher, 'ein folgenloser Versuch darf keine Sicherung verbrauchen')
    // Und die Bibliothek steht unveraendert da.
    assert.equal(JSON.parse(readFileSync(join(verzeichnis, 'data.json'), 'utf8')).length, 3)
  })

  it('legt die Sicherung erst an, wenn wirklich etwas faellt — und die drei juengsten bleiben', async () => {
    // Erst mehr Sicherungen erzeugen, als behalten werden: entfernen,
    // zuruecknehmen, entfernen ... So steht die Verdraengung unter Beweis,
    // und der Test haengt nicht an der Uhr.
    for (let i = 0; i < 4; i++) {
      const r = await request(app)
        .post('/api/medien/aufraeumen')
        .send({ schluessel: [medienSchluessel(TOT)] })
        .expect(200)
      assert.equal(r.body.entfernt, 1)
      assert.match(r.body.sicherung, /^data-vor-aufraeumen-/)
      // Die Sicherung traegt den Stand VOR dem Entfernen — hier also alle drei.
      assert.equal(JSON.parse(readFileSync(join(verzeichnis, r.body.sicherung), 'utf8')).length, 3)
      await request(app).post('/api/medien/aufraeumen/zurueck').send({ sicherung: r.body.sicherung }).expect(200)
      // Der Zeitstempel hat Sekundenaufloesung: ohne Pause traegt die naechste
      // Sicherung denselben Namen und ueberschreibt die vorige lautlos.
      await new Promise((f) => setTimeout(f, 1100))
    }
    const namen = readdirSync(verzeichnis).filter((n) => n.startsWith('data-vor-aufraeumen-'))
    assert.equal(namen.length, 3, 'es bleiben genau die drei juengsten')
  })
})
