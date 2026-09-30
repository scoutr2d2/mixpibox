/**
 * DAS AUSSEHEN GEHOERT DEM PROFIL (15.08.2026) — am Endpunkt gemessen.
 *
 * Betreiber: „bitte koppel die benutzer einstellungen an das profil also auch
 * theme einstellungen und gestaltung, indikator usw." und „man kann es
 * zusammen mit dem kind einstellen es soll aber dem profil zugeordnet sein".
 *
 * Fuenf Zusagen, und jede kann einzeln kippen:
 *
 *   1. ZWEI KINDER, ZWEI FARBEN. Was das eine einstellt, sieht das andere
 *      nicht — der ganze Zweck des Umbaus.
 *   2. WER NOCH NICHTS HAT, ERBT DIE BOX. Auf einer Box, die es seit Monaten
 *      gibt, sieht nach dem Umbau alles aus wie vorher. Es gibt keinen Tag,
 *      an dem eine Box zurueckgesetzt wirkt.
 *   3. DIE THEMEN BLEIBEN BOX-WEIT. Eine Palette ist kein Geschmack; wer eine
 *      baut, baut sie fuer alle. Und `PUT /api/darstellung` darf die
 *      box-weite `aktuell` NICHT mehr anfassen — sonst verstellte jeder Dreh
 *      am Regler auch den Rueckfall aller anderen.
 *   4. EIN FELD BLEIBT EIN FELD. Wer nur das Licht schaltet, verliert nicht
 *      die Farbe (dieselbe `Object.hasOwn`-Regel wie bei den Bewahren-
 *      Geschwistern in profile.ts).
 *   5. UNSINN WIRD ABGEWIESEN. `data-farbe` faehrt in einen CSS-Wahler.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner: string

/** Der Stand der BOX, wie ihn eine gewachsene Box mitbringt. */
const BOX_STAND = {
  aktuell: { kachelForm: 'eckig', zeigeUhr: true, farbe: 'blau' },
  themen: { eigenes: { name: 'Selbstgebaut' } },
}

describe('Aussehen je Profil', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mixpi-aussehen-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify([]))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify([]))
    writeFileSync(join(ordner, 'darstellung.json'), JSON.stringify(BOX_STAND))
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'kalea', name: 'Kalea', angelegt: 1 },
          { kennung: 'liam', name: 'Liam', angelegt: 2 },
          // Mia bekommt NIE ein eigenes Aussehen — sie ist das Profil ohne
          // Eigenes im Wechsel-Test (E72) am Ende dieser Datei.
          { kennung: 'mia', name: 'Mia', angelegt: 3 },
        ],
        aktiv: 'kalea',
      }),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    app = modul.app
  })

  it('die box-weite Datei ueberlebt den Start — sie zieht als einzige NICHT um', () => {
    // Alle anderen Bereichsablagen wandern beim Start in den Bereich; diese
    // hier traegt die Themen und den Rueckfall (OHNE_UMZUG in server.ts).
    assert.equal(existsSync(join(ordner, 'darstellung.json')), true)
  })

  it('wer noch nichts hat, erbt den Stand der Box', async () => {
    const r = await request(app).get('/api/darstellung').expect(200)
    assert.equal(r.body.profil, 'kalea')
    assert.equal(r.body.eigen, false, 'Kalea hat noch nichts Eigenes')
    assert.equal((r.body.aktuell as { kachelForm: string }).kachelForm, 'eckig')
    assert.ok(r.body.themen.eigenes, 'die selbstgebaute Palette muss mitkommen')
  })

  it('Kalea stellt um — und bekommt eine eigene Ablage', async () => {
    // DIE THEMEN KOMMEN MIT, weil die echte Oberflaeche sie mitschickt:
    // `PUT /api/darstellung` ersetzt sie GANZ, und darum liest die
    // Verwaltung erst den vollen Stand, fuegt zusammen und schreibt zurueck
    // (so steht es an der Route und in app.js). Ein Test, der hier `{}`
    // schickt, pruefte eine Zusage, die es nie gab — und faende einen
    // „Fehler", den keine Oberflaeche ausloest.
    await request(app)
      .put('/api/darstellung')
      .send({ aktuell: { kachelForm: 'rund', zeigeUhr: false }, themen: BOX_STAND.themen })
      .expect(200)
    assert.equal(existsSync(join(ordner, 'profile', 'kalea', 'darstellung.json')), true)
    const r = await request(app).get('/api/darstellung').expect(200)
    assert.equal(r.body.eigen, true)
    assert.equal((r.body.aktuell as { kachelForm: string }).kachelForm, 'rund')
  })

  it('DER RUECKFALL BLEIBT UNANGETASTET — Liam sieht weiter den Stand der Box', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)
    const r = await request(app).get('/api/darstellung').expect(200)
    assert.equal(r.body.profil, 'liam')
    assert.equal(r.body.eigen, false)
    assert.equal(
      (r.body.aktuell as { kachelForm: string }).kachelForm,
      'eckig',
      'Kaleas Wahl darf Liam nicht erreichen',
    )
    // Und die Themen sind auch bei ihm da — sie gehoeren der Box.
    assert.ok(r.body.themen.eigenes)
  })

  it('EIN ZWEITER SCHREIBER NIMMT NICHTS WEG, was er nicht kennt', async () => {
    /* Der Fall vom 16.08.2026, Betreiber: „bei kalea hat es gerade nicht mehr
     * das einhorn geladen ... beim profil wechsel". Gemessen war: Kaleas Datei
     * trug 56 Einstellungen, und `fortschrittForm` war nicht falsch gesetzt,
     * sondern GAR NICHT MEHR DA.
     *
     * Zwei Schreiber teilen sich die Datei. Die VERWALTUNG setzt einen
     * Schluessel; die BOX schreibt spaeter ihren ganzen Stand zurueck — und
     * kennt ihn nicht, weil ihre Seite geladen wurde, bevor es ihn gab. Beim
     * Profilwechsel laedt die Box neu, also schreibt sie genau dann.
     *
     * Vorher ersetzte der zweite Schreiber alles und loeschte damit den
     * ersten. Jetzt wird zusammengefuehrt. */
    await request(app)
      .put('/api/darstellung')
      .send({ aktuell: { fortschrittForm: 'b-einhorn', kachelForm: 'rund' }, themen: BOX_STAND.themen })
      .expect(200)

    // Der zweite Schreiber kennt `fortschrittForm` NICHT und schickt es nicht
    // mit — genau die Lage der Box nach dem Neuladen.
    await request(app)
      .put('/api/darstellung')
      .send({ aktuell: { kachelForm: 'eckig', zeigeUhr: true }, themen: BOX_STAND.themen })
      .expect(200)

    const r = await request(app).get('/api/darstellung').expect(200)
    const a = r.body.aktuell as Record<string, unknown>
    assert.equal(a.fortschrittForm, 'b-einhorn', 'das Einhorn darf NICHT verschwinden')
    assert.equal(a.kachelForm, 'eckig', 'was der zweite Schreiber kennt, aendert er sehr wohl')
    assert.equal(a.zeigeUhr, true, 'und Neues kommt dazu')
  })

  it('abschalten geht weiter — nur das FEHLEN heisst nichts mehr', async () => {
    // Die Kehrseite des Zusammenfuehrens, und sie muss geprueft sein: wer
    // etwas wegnehmen will, schickt den Schluessel MIT seinem neuen Wert.
    // Sonst waere aus „ersetzt alles" ein „aendert nie etwas zurueck"
    // geworden, und das waere die naechste stille Falle.
    await request(app)
      .put('/api/darstellung')
      .send({ aktuell: { fortschrittForm: 'b-einhorn' }, themen: BOX_STAND.themen })
      .expect(200)
    await request(app)
      .put('/api/darstellung')
      .send({ aktuell: { fortschrittForm: '' }, themen: BOX_STAND.themen })
      .expect(200)
    const r = await request(app).get('/api/darstellung').expect(200)
    assert.equal((r.body.aktuell as Record<string, unknown>).fortschrittForm, '', 'ausdruecklich leer bleibt leer')
  })

  it('Farbe und Licht: getrennt setzbar, und eines loescht das andere nicht', async () => {
    await request(app).post('/api/profil/aussehen').send({ farbe: 'kittypink' }).expect(200)
    let r = await request(app).get('/api/profil/aussehen').expect(200)
    assert.equal(r.body.farbe, 'kittypink')

    await request(app).post('/api/profil/aussehen').send({ licht: 'hell' }).expect(200)
    r = await request(app).get('/api/profil/aussehen').expect(200)
    assert.equal(r.body.licht, 'hell')
    assert.equal(r.body.farbe, 'kittypink', 'das Licht zu schalten darf die Farbe nicht kosten')
  })

  it('und Kalea behaelt ihre eigene Farbe — zwei Kinder, zwei Farben', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'kalea' }).expect(200)
    const r = await request(app).get('/api/profil/aussehen').expect(200)
    assert.equal(r.body.profil, 'kalea')
    assert.notEqual(r.body.farbe, 'kittypink', 'Liams Farbe darf bei Kalea nicht auftauchen')
  })

  it('E72: Wechsel in BEIDE Richtungen — ohne Eigenes gilt die Box, nie das vorige Kind', async () => {
    /* Gemeldet: „Kalea hell → Papa dunkel (klappt), zurueck nicht". Betreiber
     * (29.09.2026, E72/T3): ein Profil ohne eigenes Aussehen bekommt die
     * Box-VORGABE. Die Oberflaeche (aussehenHolen) verlaesst sich darauf,
     * dass der Server fuer so ein Profil den box-weiten Stand nennt und
     * sonst NICHTS — nie den Rest des vorigen Kindes.
     *
     * DER RUECKWEG IST DER PUNKT: der Hinweg klappte schon in der Meldung.
     * Liam hat seit den Tests oben kittypink/hell, Mia hat nichts. */
    const ansehen = async (kennung: string) => {
      await request(app).post('/api/profil/aktiv').send({ kennung }).expect(200)
      const a = (await request(app).get('/api/profil/aussehen').expect(200)).body
      const d = (await request(app).get('/api/darstellung').expect(200)).body
      return { a, d }
    }
    for (const runde of ['hin', 'zurueck']) {
      const liam = await ansehen('liam')
      assert.equal(liam.a.eigen, true, `${runde}: Liam hat Eigenes`)
      assert.equal(liam.a.farbe, 'kittypink', `${runde}: Liams Farbe`)
      assert.equal(liam.a.licht, 'hell', `${runde}: Liams Licht`)

      const mia = await ansehen('mia')
      assert.equal(mia.a.profil, 'mia')
      assert.equal(mia.a.eigen, false, `${runde}: Mia hat nichts Eigenes`)
      assert.equal(mia.a.farbe, BOX_STAND.aktuell.farbe, `${runde}: Mia bekommt die Farbe der BOX, nicht Liams`)
      assert.equal(mia.a.licht, '', `${runde}: die Box sagt zum Licht nichts — dann gilt die Vorgabe der Oberflaeche`)
      assert.equal(mia.d.eigen, false)
      assert.equal((mia.d.aktuell as { kachelForm: string }).kachelForm, 'eckig', `${runde}: Themenfelder der Box`)
    }
    // Und das Ansehen allein legt nichts an: kein Festschreiben beim Wechsel.
    assert.equal(existsSync(join(ordner, 'profile', 'mia', 'darstellung.json')), false)
  })

  it('Unsinn wird abgewiesen — data-farbe faehrt in einen CSS-Wahler', async () => {
    assert.equal((await request(app).post('/api/profil/aussehen').send({ farbe: 'rot; evil' })).status, 400)
    assert.equal((await request(app).post('/api/profil/aussehen').send({ licht: 'blinkend' })).status, 400)
  })
})
