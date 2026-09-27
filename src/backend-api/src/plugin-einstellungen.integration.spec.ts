/**
 * Die Einstellungs-Wege am LAUFENDEN Server — nicht nur die Bausteine.
 *
 * `plugin-vertrag.spec.ts` prueft das Zusammenfuehren, `plugin-wirt.spec.ts`
 * den Neustart. Was dazwischen liegt, ist Verdrahtung: der richtige
 * Parametername, die richtige Reihenfolge von Maskieren und Ablegen, und ob
 * `express.json()` den Rumpf ueberhaupt schon geparst hat. Genau dort sitzen
 * die Fehler, die keine Logikpruefung findet.
 *
 * DER SERVER WIRD HIER WIRKLICH GEBAUT. Das kostet Zeit, ist aber der einzige
 * Weg, der die Reihenfolge der `app.use`-Kette mitprueft.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const PLUGINS = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-e-plugins-'))
const KONFIG = fs.mkdtempSync(path.join(os.tmpdir(), 'mupi-e-konfig-'))
let app: import('express').Express

before(async () => {
  // Ein Plugin mit Feldern, bevor der Server hochkommt: `pluginsLaden` laeuft
  // beim Import des Moduls, nicht spaeter.
  const ordner = path.join(PLUGINS, 'mupibox-pruefling')
  fs.mkdirSync(ordner, { recursive: true })
  fs.writeFileSync(
    path.join(ordner, 'plugin.json'),
    JSON.stringify({
      kennung: 'mupibox-pruefling',
      name: 'Pruefling',
      fassung: '1.0.0',
      haupt: 'index.mjs',
      rechte: [],
      felder: [
        { schluessel: 'adresse', art: 'text', name: 'Adresse', vorgabe: 'vorgabe.local' },
        { schluessel: 'schluessel', art: 'geheim', name: 'Schluessel' },
      ],
    }),
  )
  fs.writeFileSync(path.join(ordner, 'index.mjs'), 'export default { async befinden() { return { ok: true } } }\n')

  // DAS KONFIGURATIONSVERZEICHNIS MUSS UMGELENKT WERDEN, sonst schreibt der
  // PUT-Weg `plugin-einstellungen.json` in `src/backend-api/config/` — also in
  // den Arbeitsbaum. Beim ersten Lauf dieser Datei ist genau das passiert, und
  // der ZWEITE Lauf war dann rot, weil die Vorgabe schon ueberschrieben war.
  // Ein Test, der seinen eigenen naechsten Lauf verfaelscht, ist schlimmer als
  // keiner. (`.gitignore` haette die Datei aus dem Baum gehalten — aber nicht
  // aus dem naechsten Testlauf.)
  //
  // KOPIERT statt leer angelegt: an `configBasePath` haengen noch data.json,
  // profile.json und ein Dutzend andere. Ein leeres Verzeichnis liesse den
  // Server mit lauter Ersatzwerten hochkommen und pruefte etwas anderes.
  fs.cpSync(path.resolve(import.meta.dirname, '..', 'config'), KONFIG, { recursive: true })
  process.env.MUPIBOX_CONFIG_DIR = KONFIG
  process.env.MUPIBOX_PLUGIN_DIR = PLUGINS
  app = (await import('./server')).app
})

after(async () => {
  // ERST DIE WORKER BEENDEN, DANN LOESCHEN. Der letzte Test aendert
  // Einstellungen, und das startet das Plugin NEU — der neue Worker liest
  // seine Einstiegsdatei asynchron. Wird der Ordner vorher weggeraeumt, meldet
  // das Journal „Cannot find module index.mjs", und der Test ist trotzdem
  // gruen. Genau so ist es hier beim ersten Lauf passiert.
  const { allesBeenden } = await import('./plugin-wirt')
  await allesBeenden()
  fs.rmSync(PLUGINS, { recursive: true, force: true })
  fs.rmSync(KONFIG, { recursive: true, force: true })
})

describe('das Plugin laeuft ueberhaupt', () => {
  it('ist bereit — sonst prueft alles darunter nur das Manifest', async () => {
    // DIESER TEST FEHLTE BEIM ERSTEN LAUF, und deshalb war die Datei gruen,
    // obwohl der Worker gar nicht hochkam: `felderVon` und
    // `einstellungenVon` lesen aus dem MANIFEST und aus dem Arbeitsspeicher,
    // beide auch ohne laufenden Worker. Ohne diese Zeile prueft der Rest der
    // Datei nur die halbe Kette.
    const bis = Date.now() + 10000
    let stand: { zustand: string; grund?: string } | undefined
    while (Date.now() < bis) {
      const a = await request(app).get('/api/plugins').expect(200)
      stand = a.body.geladen.find((s: { kennung: string }) => s.kennung === 'mupibox-pruefling')
      if (stand && stand.zustand !== 'laedt') break
      await new Promise((f) => setTimeout(f, 50))
    }
    assert.equal(stand?.zustand, 'bereit', `Grund: ${stand?.grund ?? '(keiner gemeldet)'}`)
  })
})

describe('GET /api/plugins/:kennung/einstellungen', () => {
  it('liefert die FELDER mit, nicht nur die Werte', async () => {
    // Ohne die Felder muesste der Eltern-Bereich raten, welche Eingabe wozu
    // gehoert und ob sie eine Zahl sein soll.
    const a = await request(app).get('/api/plugins/mupibox-pruefling/einstellungen').expect(200)
    assert.equal(a.body.felder.length, 2)
    assert.equal(a.body.felder[0].name, 'Adresse')
    assert.equal(a.body.werte.adresse, 'vorgabe.local')
  })

  it('antwortet 404 fuer ein Plugin, das es nicht gibt', async () => {
    await request(app).get('/api/plugins/gibtsnicht/einstellungen').expect(404)
  })
})

describe('PUT /api/plugins/:kennung/einstellungen', () => {
  it('nimmt eine Aenderung an und gibt zurueck, was JETZT gilt', async () => {
    const a = await request(app)
      .put('/api/plugins/mupibox-pruefling/einstellungen')
      .send({ adresse: 'neu.local', schluessel: 'hunter2' })
      .expect(200)
    assert.equal(a.body.status, 'ok')
    assert.equal(a.body.werte.adresse, 'neu.local')
    assert.equal(a.body.werte.schluessel, '', 'das Geheimnis darf nicht zurueckkommen')
  })

  it('gibt das Geheimnis auch beim Lesen nicht heraus', async () => {
    const a = await request(app).get('/api/plugins/mupibox-pruefling/einstellungen').expect(200)
    assert.equal(a.body.werte.schluessel, '')
    assert.equal('schluessel' in a.body.werte, true, 'die FORM muss bleiben')
    assert.equal(a.body.werte.adresse, 'neu.local')
  })

  it('VERLIERT DAS GEHEIMNIS NICHT, wenn die Oberflaeche es leer zurueckschickt', async () => {
    // Der teure Fall, hier ueber den ganzen Weg: lesen (Geheimnis maskiert),
    // ein anderes Feld aendern, alles zurueckschicken.
    const gelesen = await request(app).get('/api/plugins/mupibox-pruefling/einstellungen').expect(200)
    await request(app)
      .put('/api/plugins/mupibox-pruefling/einstellungen')
      .send({ ...gelesen.body.werte, adresse: 'dritte.local' })
      .expect(200)

    // Ob es noch dasteht, sieht man von aussen NICHT — es wird ja maskiert.
    // Also wird gegen die Ablage geprueft, die der Weg selbst geschrieben hat.
    const { einstellungenVon } = await import('./plugin-wirt')
    assert.equal(einstellungenVon('mupibox-pruefling').schluessel, 'hunter2')
    assert.equal(einstellungenVon('mupibox-pruefling').adresse, 'dritte.local')
  })

  it('antwortet 404 fuer ein Plugin, das es nicht gibt', async () => {
    await request(app).put('/api/plugins/gibtsnicht/einstellungen').send({ a: 1 }).expect(404)
  })
})
