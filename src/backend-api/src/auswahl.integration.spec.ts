/**
 * WAS EIN KIND SIEHT — die Auswahl, an der laufenden Box gepruefet.
 *
 * ══ DER BEFUND, DER DAZU GEFUEHRT HAT (07.08.2026) ═════════════════════════
 *
 * „beim wechsel vom profil werden alle titel wie bei gast gezeigt ich kann
 *  auch nicht beim anlegen wählen was im profil landen soll habe ich es
 *  übersehen" — hat er nicht. Es gab NIRGENDS eine Medienzuordnung je Kind.
 *
 * ══ WAS HIER GEPRUEFT WIRD, UND ZWAR IN DIESER REIHENFOLGE ═════════════════
 *
 *  1. EINE BOX OHNE JEDE AUSWAHL ZEIGT DASSELBE WIE VORHER. Das ist die erste
 *     der drei nicht verhandelbaren Bedingungen, und sie steht deshalb an
 *     erster Stelle: Wer sie bricht, hat jeder bestehenden Box nach dem Update
 *     die Bibliothek weggenommen.
 *  2. Erst eine gefuellte Auswahl filtert — und zwar an ALLEN Wegen, aus denen
 *     die Oberflaechen ihre Kacheln bauen (`/api/data` fuer die klassische,
 *     `/api/werke` und `/api/interpreten` fuer die neue).
 *  3. DER GAST BEKOMMT NIE EINE. Er ist „alle, die an der Box stehen".
 *  4. DIE AUSWAHL GEHT BEIM LOESCHEN MIT — ueber `BEREICH_ABLAGEN`, nicht
 *     danebengestellt. Und ein neues Kind desselben Namens erbt sie NICHT.
 *  5. „uebernehmen von …" ist zweimal dieselbe Schnittstelle, kein dritter Weg.
 *  6. Ein leeres Regal laesst sich ERKLAEREN: der Server sagt, ob nichts
 *     gewaehlt oder nichts davon da ist.
 *
 * EIGENER LAUF, EIGENES VERZEICHNIS: server.ts richtet die Bereiche EINMAL
 * beim Laden des Moduls her; `node --test` gibt jeder Testdatei einen eigenen
 * Prozess.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

/** Drei Eintraege der Box .169 (07.08.2026, lesend abgeholt) — keine erfundenen. */
const KITTY = {
  type: 'spotify',
  category: 'audiobook',
  title: 'Hello Kitty - Alle Hörspiele',
  artist: 'EUROPA Hörspiele & Kinderlieder',
  playlistid: '1DYDHYJ98WZbHa2OZ4Dljg',
}
const HAMM = {
  type: 'jellyfin-album',
  category: 'music',
  id: '7d9a37e2732ca78bc68eacb3232960c0',
  artist: 'Kapelle Petra',
  title: 'HAMM',
}
const LUMPENPACK = {
  type: 'spotify',
  category: 'music',
  title: 'Die Zukunft wird groß',
  artist: 'Das Lumpenpack',
  id: '0PyuOAMz1lv0z737JcQNOg',
}
const BIBLIOTHEK = [KITTY, HAMM, LUMPENPACK]
const S_KITTY = 'spotify:1DYDHYJ98WZbHa2OZ4Dljg'
const S_HAMM = 'jellyfin:7d9a37e2732ca78bc68eacb3232960c0'

let app: import('express').Express
let ordner: string
const auswahlDatei = (k: string) => join(ordner, 'profile', k, 'auswahl.json')
const titel = (liste: { title?: string }[]) => liste.map((e) => e.title).sort()

const profil = (kennung: string) => request(app).post('/api/profil/aktiv').send({ kennung }).expect(200)

describe('Die Auswahl: was ein Kind von der Bibliothek sieht', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-auswahl-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify(BIBLIOTHEK, null, 2))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify(BIBLIOTHEK, null, 2))
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({
        profile: [
          { kennung: 'gast', name: 'Gast', figur: '', angelegt: 1 },
          { kennung: 'kalea', name: 'Kalea', figur: '', angelegt: 2 },
          { kennung: 'liam', name: 'Liam', figur: '', angelegt: 3 },
        ],
        aktiv: 'gast',
      }),
    )
    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  // ── 1. NICHTS VERSCHWINDET STILL ──────────────────────────────────────────

  it('eine Box OHNE jede Auswahl zeigt jedem alles — Gast wie Kind', async () => {
    for (const wer of ['gast', 'kalea', 'liam']) {
      await profil(wer)
      const d = await request(app).get('/api/data').expect(200)
      assert.equal(d.body.length, 3, `${wer} sieht die ganze Bibliothek in /api/data`)
      const w = await request(app).get('/api/werke').expect(200)
      assert.equal(w.body.werke.length, 3, `${wer} sieht die ganze Bibliothek in /api/werke`)
      assert.equal(w.body.auswahl.gewaehlt, 0, `${wer} hat nichts gewaehlt`)
    }
  })

  it('und es liegt keine Datei herum, die niemand angelegt hat', async () => {
    for (const k of ['gast', 'kalea', 'liam']) {
      assert.equal(existsSync(auswahlDatei(k)), false, k)
    }
  })

  // ── 1b. Die Matrix und ihre zwei Umschlagpunkte (E38) ────────────────────

  it('die Matrix listet alle Profile — ohne den Gast, der keine Auswahl haben darf', async () => {
    const m = await request(app).get('/api/profil/auswahlen').expect(200)
    const kennungen = m.body.profile.map((p: { kennung: string }) => p.kennung)
    assert.ok(!kennungen.includes('gast'), 'der Gast ist keine Spalte')
    assert.ok(kennungen.includes('kalea') && kennungen.includes('liam'))
    for (const p of m.body.profile) assert.equal(p.alle, true, `${p.kennung} sieht anfangs alles`)
  })

  it('EINSPERREN wird gefragt, nicht getan: wer alles sieht, verliert nicht still ein Werk', async () => {
    const q = await request(app)
      .post('/api/profil/auswahl/werk')
      .send({ profil: 'kalea', schluessel: S_KITTY, an: false })
      .expect(409)
    assert.equal(q.body.frage, 'einsperren')
    assert.equal(existsSync(auswahlDatei('kalea')), false, 'ohne Bestaetigung wird NICHTS geschrieben')

    const j = await request(app)
      .post('/api/profil/auswahl/werk')
      .send({ profil: 'kalea', schluessel: S_KITTY, an: false, bestaetigt: true })
      .expect(200)
    // Aus „alles" wird die ausdrueckliche Liste ALLER ANDEREN — nicht eine
    // Liste mit dem einen abgewaehlten Werk darin.
    assert.equal(j.body.alle, false)
    assert.ok(!j.body.werke.includes(S_KITTY))
    assert.equal(j.body.werke.length, 2, 'die zwei uebrigen der drei')
  })

  it('ein Haekchen setzen, wenn das Profil ohnehin alles sieht, schreibt nichts', async () => {
    const j = await request(app)
      .post('/api/profil/auswahl/werk')
      .send({ profil: 'liam', schluessel: S_KITTY, an: true })
      .expect(200)
    assert.equal(j.body.unveraendert, true)
    assert.equal(existsSync(auswahlDatei('liam')), false)
  })

  it('WIEDER OEFFNEN wird auch gefragt: der letzte Haken reisst sonst die Tuer auf', async () => {
    await request(app).put('/api/profil/auswahl').send({ profil: 'liam', werke: [S_KITTY] }).expect(200)
    const q = await request(app)
      .post('/api/profil/auswahl/werk')
      .send({ profil: 'liam', schluessel: S_KITTY, an: false })
      .expect(409)
    assert.equal(q.body.frage, 'oeffnen')
    const nach = await request(app).get('/api/profil/auswahl?profil=liam').expect(200)
    assert.deepEqual(nach.body.werke, [S_KITTY], 'ohne Bestaetigung unveraendert')

    const j = await request(app)
      .post('/api/profil/auswahl/werk')
      .send({ profil: 'liam', schluessel: S_KITTY, an: false, bestaetigt: true })
      .expect(200)
    assert.equal(j.body.alle, true, 'leer heisst alles — und genau davor wurde gewarnt')
    await request(app).put('/api/profil/auswahl').send({ profil: 'liam', werke: [] }).expect(200)
  })

  // ── 2. Erst eine gefuellte Auswahl filtert ────────────────────────────────

  it('Kalea bekommt zwei Werke — und sieht genau die', async () => {
    await profil('kalea')
    const p = await request(app)
      .put('/api/profil/auswahl')
      .send({ werke: [S_KITTY, S_HAMM] })
      .expect(200)
    assert.equal(p.body.profil, 'kalea')
    assert.equal(p.body.alle, false)
    assert.equal(existsSync(auswahlDatei('kalea')), true, 'die Ablage liegt im BEREICH')

    const d = await request(app).get('/api/data').expect(200)
    assert.deepEqual(titel(d.body), ['HAMM', 'Hello Kitty - Alle Hörspiele'])
    const w = await request(app).get('/api/werke').expect(200)
    assert.deepEqual(
      w.body.werke.map((x: { schluessel: string }) => x.schluessel).sort(),
      [S_HAMM, S_KITTY].sort(),
    )
    assert.deepEqual(w.body.auswahl, { gewaehlt: 2, vorrat: 3, sichtbar: 2 })
  })

  it('die runde Interpreten-Reihe zeigt keinen, hinter dem fuer Kalea nichts liegt', async () => {
    const i = await request(app).get('/api/interpreten').expect(200)
    const namen = JSON.stringify(i.body)
    assert.ok(!namen.includes('Lumpenpack'), 'Das Lumpenpack ist nicht in ihrer Auswahl')
  })

  it('was aus der Auswahl genommen wurde, laesst sich auch aus dem Verlauf nicht starten', async () => {
    // DIE ZEILE BLEIBT — sie ist die Wahrheit darueber, was gehoert wurde, und
    // die Zahlen zu stutzen waere eine Faelschung. Was wegfaellt, ist der
    // `schluessel`: die Kachel laesst sich nicht mehr antippen. Genau derselbe
    // Weg wie bei einem aus der Bibliothek genommenen Album.
    await profil('kalea')
    await request(app)
      .post('/api/gespielt')
      .send({ key: `spotify:${LUMPENPACK.id}`, title: LUMPENPACK.title, artist: LUMPENPACK.artist })
      .expect(200)
    const g = await request(app).get('/api/gespielt?max=50').expect(200)
    const zeile = g.body.zuletzt.find((e: { key: string }) => e.key === `spotify:${LUMPENPACK.id}`)
    assert.ok(zeile, 'die Zeile steht im Verlauf')
    assert.equal(zeile.schluessel, undefined, 'aber ohne Weg zum Werk')
  })

  it('Liam daneben sieht weiter alles — die Auswahl gehoert dem KIND', async () => {
    await profil('liam')
    const d = await request(app).get('/api/data').expect(200)
    assert.equal(d.body.length, 3)
  })

  it('der Fingerabdruck aendert sich beim Profilwechsel, sonst zeigt die Seite das alte Regal', async () => {
    await profil('kalea')
    const a = (await request(app).get('/api/werke').expect(200)).body.stand
    await profil('liam')
    const b = (await request(app).get('/api/werke').expect(200)).body.stand
    assert.notEqual(a, b)
  })

  // ── 3. Der Gast ───────────────────────────────────────────────────────────

  it('der Gast bekommt keine Auswahl — die Box wird nicht fuer Gaeste unbrauchbar', async () => {
    const abgewiesen = await request(app)
      .put('/api/profil/auswahl')
      .send({ profil: 'gast', werke: [S_KITTY] })
      .expect(400)
    assert.equal(abgewiesen.body.error, 'gastOhneAuswahl')
    await profil('gast')
    const d = await request(app).get('/api/data').expect(200)
    assert.equal(d.body.length, 3, 'er sieht weiter alles')
  })

  it('ein unbekanntes Profil wird abgewiesen und nicht auf den Gast gebogen', async () => {
    await request(app).put('/api/profil/auswahl').send({ profil: 'niemand', werke: [] }).expect(400)
    await request(app).get('/api/profil/auswahl?profil=niemand').expect(400)
  })

  // ── 5. „uebernehmen von …" ────────────────────────────────────────────────

  it('Liam uebernimmt von Kalea — zweimal dieselbe Schnittstelle', async () => {
    const vorbild = await request(app).get('/api/profil/auswahl?profil=kalea').expect(200)
    await request(app)
      .put('/api/profil/auswahl')
      .send({ profil: 'liam', werke: vorbild.body.werke })
      .expect(200)
    await profil('liam')
    const d = await request(app).get('/api/data').expect(200)
    assert.deepEqual(titel(d.body), ['HAMM', 'Hello Kitty - Alle Hörspiele'])
  })

  it('danach sind es ZWEI Listen und keine Verknuepfung', async () => {
    // Zwei Geschwister mit demselben Anfangsbestand sollen sich
    // auseinanderentwickeln koennen.
    await request(app)
      .put('/api/profil/auswahl')
      .send({ profil: 'liam', werke: [S_KITTY] })
      .expect(200)
    const k = await request(app).get('/api/profil/auswahl?profil=kalea').expect(200)
    assert.equal(k.body.werke.length, 2, 'bei Kalea steht noch beides')
  })

  it('„alles" ist die LEERE Liste und nicht eine Liste mit allem darin', async () => {
    await request(app).put('/api/profil/auswahl').send({ profil: 'liam', werke: [] }).expect(200)
    const a = await request(app).get('/api/profil/auswahl?profil=liam').expect(200)
    assert.equal(a.body.alle, true)
    assert.deepEqual(a.body.werke, [])
    await profil('liam')
    const d = await request(app).get('/api/data').expect(200)
    assert.equal(d.body.length, 3, 'und es heisst wirklich alles')
  })

  // ── 6. Ein leeres Regal sagt, warum ───────────────────────────────────────

  it('sagt „gewaehlt, aber nichts davon da" — statt einer leeren Flaeche', async () => {
    await request(app)
      .put('/api/profil/auswahl')
      .send({ profil: 'liam', werke: ['spotify:gibtesnichtmehr'] })
      .expect(200)
    await profil('liam')
    const w = await request(app).get('/api/werke').expect(200)
    assert.deepEqual(w.body.werke, [])
    assert.deepEqual(w.body.auswahl, { gewaehlt: 1, vorrat: 3, sichtbar: 0 })
  })

  it('und raeumt den Schluessel NICHT weg — sonst kippte die Auswahl auf „alles"', async () => {
    // Der gefaehrlichste stille Fehler dieses Umbaus: Wer beim Lesen
    // aufraeumte, machte aus „nur dieses eine" ein „alles", sobald das Medium
    // fehlt — und im Offline-Betrieb ist `active_data.json` die kurze Liste.
    const a = await request(app).get('/api/profil/auswahl?profil=liam').expect(200)
    assert.deepEqual(a.body.werke, ['spotify:gibtesnichtmehr'])
    assert.equal(a.body.alle, false)
  })

  // ── 4. Die Auswahl geht beim Loeschen mit ─────────────────────────────────

  it('beim Loeschen geht die Auswahl mit dem Bereich', async () => {
    await profil('gast')
    await request(app)
      .put('/api/profile')
      .send({ profile: [{ kennung: 'kalea', name: 'Kalea', angelegt: 2 }] })
      .expect(200)
    assert.equal(existsSync(auswahlDatei('liam')), false, 'die alte Stelle ist frei')
  })

  it('ein neues Kind desselben Namens erbt sie NICHT', async () => {
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'kalea', name: 'Kalea', angelegt: 2 },
          { kennung: 'liam', name: 'Liam', angelegt: 4 },
        ],
      })
      .expect(200)
    const a = await request(app).get('/api/profil/auswahl?profil=liam').expect(200)
    assert.deepEqual(a.body.werke, [], 'keine geerbte Einschraenkung')
    assert.equal(a.body.alle, true)
    await profil('liam')
    const d = await request(app).get('/api/data').expect(200)
    assert.equal(d.body.length, 3, 'das neue Kind sieht die ganze Box')
  })

  it('eine kaputte auswahl.json kostet keine Bibliothek', async () => {
    writeFileSync(auswahlDatei('kalea'), '{ das ist kein JSON')
    await profil('kalea')
    const d = await request(app).get('/api/data').expect(200)
    assert.equal(d.body.length, 3, 'im Zweifel sieht das Kind zu viel, nie zu wenig')
  })
})
