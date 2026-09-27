/**
 * DIE FIGUREN — gefunden, nicht aufgezaehlt. Und was passiert, wenn nichts da
 * ist.
 *
 * WORUM ES GEHT: Der Betreiber will die Bilder erst erzeugen („ich habe vor
 * von den mixpis unterschiedliche zu generieren mit brille maedchen
 * jungen....", 05.08.2026). Zum Zeitpunkt dieses Tests gibt es GENAU EIN
 * MixPi und keine einzige Figur. Der leere Ordner ist also nicht der
 * Randfall, sondern der Normalfall — und genau deshalb steht er hier an
 * erster Stelle.
 *
 * WARUM DAS EINEN TEST BRAUCHT, obwohl `figurPruefen` schon rein getestet ist:
 * Die drei Dinge, die hier schiefgehen koennen, haben mit der PLATTE zu tun
 * und koennen in einer reinen Datei gar nicht geprueft werden —
 *
 *   1. Ein Ordner, den es nicht gibt, darf keinen Fehler ergeben, sondern eine
 *      leere Liste. Ein 500 an dieser Stelle liesse die Oberflaeche mit einer
 *      Auswahl stehen, die aussieht wie ein Defekt.
 *   2. Ein UNTERVERZEICHNIS namens `mixpi-alt.png` kaeme durch `figurPruefen`
 *      glatt durch — im Browser ergaebe es ein leeres Bild.
 *   3. `POST /api/profil/figur` darf keinen Namen annehmen, zu dem es keine
 *      Datei gibt. Sonst steht im Kopf ein leeres Bildzeichen, das niemand
 *      mehr wegbekommt, weil die Auswahl diesen Namen gar nicht mehr anbietet.
 *
 * UND DIE REGEL, DIE UEBER ALLEM STEHT: LESEN darf ein Profil nennen,
 * SCHREIBEN nicht. Der Besitzer kommt vom Server (`profilAktiv()`), nie aus
 * dem Rumpf.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { FIGUR_ORDNER } from './profile'

let app: import('express').Express
let konfig: string
let figurenOrdner: string

/** Ein winziges, gueltiges PNG (1x1, durchsichtig). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

describe('Die Figuren: ein Ordner, ein Namensmuster', () => {
  before(async () => {
    konfig = mkdtempSync(join(tmpdir(), 'mupi-figuren-konfig-'))
    writeFileSync(join(konfig, 'active_data.json'), '[]')
    writeFileSync(join(konfig, 'data.json'), '[]')
    process.env.MUPIBOX_CONFIG_DIR = konfig

    // DER WWW-ORDNER WIRD HIER ANGELEGT, ABER NOCH NICHT DER FIGURENORDNER.
    // Der erste Fall dieses Tests ist genau der heutige Stand der Box: es gibt
    // ihn nicht.
    const www = mkdtempSync(join(tmpdir(), 'mupi-figuren-www-'))
    process.env.MUPIBOX_WWW_DIR = www
    figurenOrdner = join(www, 'neu', FIGUR_ORDNER)

    const modul = await import('./server.js')
    app = modul.app
  })

  // `delete` UND NICHT `= undefined`: eine Zuweisung von `undefined` an
  // `process.env` legt die ZEICHENKETTE "undefined" ab. `wwwOrdner()` haelt
  // die fuer einen Pfad, und der Ordner ist dann weder gesetzt noch leer,
  // sondern falsch — die Figuren waren damit ploetzlich alle „nicht da".
  // Genau daran ist der erste Lauf dieses Tests gescheitert.
  after(() => {
    delete process.env.MUPIBOX_CONFIG_DIR
    delete process.env.MUPIBOX_WWW_DIR
  })

  it('OHNE ORDNER eine leere Liste — kein Fehler, denn so steht die Box heute da', async () => {
    const r = await request(app).get('/api/figuren').expect(200)
    assert.deepEqual(r.body.figuren, [])
    assert.deepEqual(r.body.uebergangen, [])
  })

  it('der Ordner kommt MIT — damit die Oberflaeche den Pfad nicht zweimal baut', async () => {
    const r = await request(app).get('/api/figuren').expect(200)
    assert.equal(r.body.ordner, FIGUR_ORDNER)
  })

  it('ohne Figur zeigt der Gast keine — leer heisst „noch keines ausgesucht"', async () => {
    const r = await request(app).get('/api/profile').expect(200)
    assert.equal(r.body.profile[0].kennung, 'gast')
    assert.equal(r.body.profile[0].figur, '')
  })

  it('findet, was hineingelegt wird — ohne Bau, ohne Neustart', async () => {
    mkdirSync(figurenOrdner, { recursive: true })
    writeFileSync(join(figurenOrdner, 'mixpi-brille.png'), PNG)
    writeFileSync(join(figurenOrdner, 'mixpi-maedchen.png'), PNG)
    const r = await request(app).get('/api/figuren').expect(200)
    assert.deepEqual(r.body.figuren, ['mixpi-brille.png', 'mixpi-maedchen.png'])
  })

  it('nennt, was es UEBERGEHT — sonst sucht der Betreiber eine halbe Stunde', async () => {
    // Der Betreiber legt diese Bilder von Hand hinein. Eine Datei, die daliegt
    // und nicht erscheint, ohne dass irgendwo steht warum, ist die
    // schlechteste aller Antworten — und die Loesung waere ein Grossbuchstabe.
    writeFileSync(join(figurenOrdner, 'Brille.PNG'), PNG)
    writeFileSync(join(figurenOrdner, 'foto.jpg'), PNG)
    const r = await request(app).get('/api/figuren').expect(200)
    assert.deepEqual(r.body.uebergangen.sort(), ['Brille.PNG', 'foto.jpg'])
    assert.ok(!r.body.figuren.includes('Brille.PNG'))
  })

  it('LIESMICH.md ist kein uebergangenes Bild, sondern Beiwerk des Ordners', async () => {
    writeFileSync(join(figurenOrdner, 'LIESMICH.md'), '# hier hinein')
    const r = await request(app).get('/api/figuren').expect(200)
    assert.ok(!r.body.uebergangen.includes('LIESMICH.md'))
  })

  it('ein VERZEICHNIS mit gueltigem Namen ist keine Figur', async () => {
    // `figurPruefen('mixpi-alt.png')` ist wahr — der Name sagt nichts darueber,
    // ob dahinter eine Datei steckt. Im Browser ergaebe es ein leeres Bild.
    mkdirSync(join(figurenOrdner, 'mixpi-alt.png'), { recursive: true })
    const r = await request(app).get('/api/figuren').expect(200)
    assert.ok(!r.body.figuren.includes('mixpi-alt.png'))
  })

  // EINGEHAENGT UND NICHT DANEBENGESTELLT: Ein zweiter Block auf oberster
  // Ebene liefe NACH dem `after` des ersten — und damit ohne
  // `MUPIBOX_WWW_DIR`. Der erste Lauf meldete daraufhin `figurFehlt` fuer
  // Dateien, die dalagen.
  describe('Das Kind sucht sich sein Bild aus', () => {
    it('nimmt eine Figur an, die es GIBT', async () => {
      const r = await request(app).post('/api/profil/figur').send({ figur: 'mixpi-brille.png' }).expect(200)
      const gast = r.body.profile.find((p: { kennung: string }) => p.kennung === 'gast')
      assert.equal(gast.figur, 'mixpi-brille.png')
    })

    it('und merkt es — ein Tipp, der nur die Anzeige aendert, waere wertlos', async () => {
      const r = await request(app).get('/api/profile').expect(200)
      assert.equal(r.body.profile[0].figur, 'mixpi-brille.png')
    })

    it('LEER ist erlaubt und heisst „kein Bild" — sonst waere die Wahl eine Einbahnstrasse', async () => {
      const r = await request(app).post('/api/profil/figur').send({ figur: '' }).expect(200)
      assert.equal(r.body.profile[0].figur, '')
    })

    it('weist einen Namen ab, zu dem es KEINE Datei gibt', async () => {
      // Sonst steht im Kopf ein leeres Bildzeichen, das niemand mehr wegbekommt:
      // die Auswahl bietet diesen Namen ja gar nicht mehr an.
      const r = await request(app).post('/api/profil/figur').send({ figur: 'mixpi-gibtsnicht.png' }).expect(400)
      assert.equal(r.body.error, 'figurFehlt')
    })

    it('weist alles ab, was ein Pfad werden koennte', async () => {
      for (const f of ['../../etc/passwd', 'a/b.png', '%2e%2e/x.png', 'mixpi-brille', 'boese.svg']) {
        const r = await request(app).post('/api/profil/figur').send({ figur: f }).expect(400)
        assert.equal(r.body.error, 'unbrauchbareFigur', JSON.stringify(f))
      }
    })

    it('und laesst die Figur unangetastet, wenn es abweist', async () => {
      const r = await request(app).get('/api/profile').expect(200)
      assert.equal(r.body.profile[0].figur, '')
    })

    it('DER BESITZER KOMMT VOM SERVER — eine Kennung im Rumpf wird ignoriert', async () => {
      // Dieselbe Regel wie bei /api/gespielt und /api/weiterhoeren: LESEN darf
      // ein Profil nennen, SCHREIBEN nicht. Hier steht sie als Naht: Liam wird
      // angelegt, aber der Gast ist dran — also bekommt der GAST das Bild.
      await request(app)
        .put('/api/profile')
        .send({ profile: [{ kennung: 'liam', name: 'Liam' }] })
        .expect(200)
      const r = await request(app)
        .post('/api/profil/figur')
        .send({ figur: 'mixpi-maedchen.png', kennung: 'liam' })
        .expect(200)
      assert.equal(r.body.aktiv, 'gast')
      const gast = r.body.profile.find((p: { kennung: string }) => p.kennung === 'gast')
      const liam = r.body.profile.find((p: { kennung: string }) => p.kennung === 'liam')
      assert.equal(gast.figur, 'mixpi-maedchen.png', 'der AKTIVE bekommt es')
      assert.equal(liam.figur, '', 'und der genannte NICHT')
    })

    it('nach dem Umschalten trifft es das andere Kind — und nur seines', async () => {
      await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)
      const r = await request(app).post('/api/profil/figur').send({ figur: 'mixpi-brille.png' }).expect(200)
      const gast = r.body.profile.find((p: { kennung: string }) => p.kennung === 'gast')
      const liam = r.body.profile.find((p: { kennung: string }) => p.kennung === 'liam')
      assert.equal(liam.figur, 'mixpi-brille.png')
      assert.equal(gast.figur, 'mixpi-maedchen.png', 'das Bild des Gasts bleibt seines')
    })
  })

  /**
   * DIE WANDERUNG VON DER ALTEN FASSUNG — und warum sie nicht auf Platte geht.
   *
   * GEMESSEN AM GERAET (05.08.2026): die laufende Box .169 antwortet auf
   * `GET /api/profile` mit `"figur":"mixpi-hoert.png"`. Der Name stammt aus
   * `GAST_FIGUR` der Fassung vor heute, wo die Bilder direkt in `bilder/`
   * lagen. Seit sie in `bilder/figuren/` liegen, zeigt er ins Leere — und er
   * kommt durch `figurPruefen` glatt durch (klein, endet auf `.png`).
   *
   * DER WEG HIER HINEIN IST ECHT, nicht gestellt: `PUT /api/profile` (die
   * Verwaltung) prueft NICHT, ob es die Datei gibt — es kann das auch nicht,
   * denn `profilNormalisieren` ist rein. Nur `POST /api/profil/figur` sieht
   * auf der Platte nach. Genau durch diese Tuer kommt ein toter Name herein.
   */
  describe('Eine Figur, die es nicht gibt, wird nicht genannt', () => {
    it('der alte Vorgabewert `mixpi-hoert.png` kommt nicht mehr durch', async () => {
      await request(app)
        .put('/api/profile')
        .send({ profile: [{ kennung: 'gast', name: 'Gast', figur: 'mixpi-hoert.png' }] })
        .expect(200)
      const r = await request(app).get('/api/profile').expect(200)
      assert.equal(r.body.profile[0].figur, '', 'sonst holt der Browser bei jedem Laden eine 404')
    })

    it('und was DA ist, kommt weiter durch — sonst waere die Regel eine Loeschtaste', async () => {
      await request(app)
        .put('/api/profile')
        .send({ profile: [{ kennung: 'gast', name: 'Gast', figur: 'mixpi-brille.png' }] })
        .expect(200)
      const r = await request(app).get('/api/profile').expect(200)
      assert.equal(r.body.profile[0].figur, 'mixpi-brille.png')
    })

    it('NUR IN DER ANTWORT: legt der Betreiber die Datei nach, steht die Wahl wieder da', async () => {
      // Das ist der eigentliche Grund, warum hier nichts geschrieben wird.
      // Waere der Ordner einmal nicht lesbar — mitten in einer Auslieferung —,
      // loeschte ein Schreiben die Wahl JEDES Kindes unwiderruflich.
      await request(app)
        .put('/api/profile')
        .send({ profile: [{ kennung: 'gast', name: 'Gast', figur: 'mixpi-neu.png' }] })
        .expect(200)
      const ohne = await request(app).get('/api/profile').expect(200)
      assert.equal(ohne.body.profile[0].figur, '', 'noch gibt es die Datei nicht')

      writeFileSync(join(figurenOrdner, 'mixpi-neu.png'), PNG)
      const mit = await request(app).get('/api/profile').expect(200)
      assert.equal(mit.body.profile[0].figur, 'mixpi-neu.png', 'die Wahl war nur verdeckt, nicht weg')
    })
  })
})
