/**
 * DER RIEGEL VOR DER MERKTIEFE — an BEIDEN Wegen, die an dieselbe Zahl fuehren.
 *
 * WORUM ES GEHT: Seit dem 07.08.2026 gehoert die Merktiefe dem Kind
 * (`Profil.merken`). Sie herabzusetzen kostet gemerkte Stellen, und dafuer gibt
 * es KEINE Sicherung — anders als beim Leeren, das `resume.json.vorher`
 * danebenlegt. `PUT /api/profil/merken` fragt deshalb vorher nach (409 mit
 * `verliert`, erst `bestaetigt: true` setzt).
 *
 * WARUM DIESE DATEI DAZUKAM: Die Zahl steht in `profile.json`, und dieselbe
 * Datei schreibt `PUT /api/profile` — die Verwaltung, die Kinder anlegt,
 * umbenennt und loescht. Dieser zweite Weg nahm das Feld entgegen und fragte
 * NICHT. Gemessen am 07.08.2026 mit `tools/merken-verlust-linse.py --nur K`:
 * ein Kind mit zwoelf gemerkten Stellen, `PUT /api/profile` mit `merken: 1`,
 * Antwort 200 ohne ein Wort — und der naechste Lauf von
 * `remove_max_resume.sh` liess EINE Stelle uebrig.
 *
 * Der Satz, der am anderen Endpunkt steht — „der Riegel steht im Server, damit
 * ihn JEDE Oberflaeche erbt" — war damit nur halb wahr. Hier wird er geprueft.
 *
 * UND DIE GEGENRICHTUNG GLEICH MIT: was NICHTS kostet, muss weiter durchgehen.
 * Ein Riegel, der auch das Heraufsetzen abweist, macht das Feld auf diesem Weg
 * unbenutzbar — und ein Riegel, der eine Liste OHNE das Feld abweist, macht die
 * Seite „Kinder" unbedienbar, die es gar nicht kennt.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const WERKE = Array.from({ length: 12 }, (_, i) => ({
  id: `riegel-w${i}`,
  title: `Werk ${i}`,
  artist: 'Riegel',
  type: 'spotify',
  category: 'audiobook',
}))

/** Die Box-Zahl. Weder 9 (Vorgabe) noch eine der Kinderzahlen. */
const BOX_ZAHL = 6

let app: import('express').Express
let ordner = ''

/** Der Eintrag eines Kindes aus `profile.json` — die DATEI, nicht die Antwort. */
function ausDatei(kennung: string): Record<string, unknown> | undefined {
  const roh = JSON.parse(readFileSync(join(ordner, 'profile.json'), 'utf8'))
  return (roh.profile as Record<string, unknown>[]).find((p) => p.kennung === kennung)
}

function stellenVon(kennung: string): unknown[] {
  const p = join(ordner, 'profile', kennung, 'resume.json')
  if (!existsSync(p)) return []
  const roh = JSON.parse(readFileSync(p, 'utf8'))
  return Array.isArray(roh) ? roh : []
}

/**
 * Die ganze Liste so schicken, wie eine Verwaltung es tut — erst holen, dann
 * ALLES zurueckschicken. Genau das macht die Seite „Kinder", und genau darin
 * liegt die Gefahr: sie schickt auch die Kinder mit, die sie gar nicht meint.
 *
 * `status` steht hier drin und nicht beim Aufrufer, weil diese Funktion
 * `await`en muss (sie holt erst) und ein `.expect()` am Rueckgabewert damit
 * ins Leere liefe.
 */
async function listeSchicken(
  aenderung: (p: Record<string, unknown>) => Record<string, unknown>,
  status = 200,
) {
  const jetzt = await request(app).get('/api/profile').expect(200)
  const liste = (jetzt.body.profile as Record<string, unknown>[]).map((p) =>
    aenderung({ kennung: p.kennung, name: p.name, figur: p.figur, angelegt: p.angelegt }),
  )
  return request(app).put('/api/profile').send(liste).expect(status)
}

describe('Die Merktiefe herabsetzen: beide Wege fragen vorher', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-riegel-'))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify(WERKE, null, 2))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify(WERKE, null, 2))
    writeFileSync(join(ordner, 'resume.json'), '[]')
    writeFileSync(join(ordner, 'gespielt.json'), '[]')
    const konfig = join(ordner, 'mupiboxconfig.json')
    writeFileSync(konfig, JSON.stringify({ mupibox: { resume: BOX_ZAHL } }))
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPIBOX_CONFIG = konfig
    // Ein Rest aus einem abgebrochenen Lauf liesse JEDES Schreiben still
    // ausfallen — die Tests waeren gruen, ohne je geschrieben zu haben.
    if (existsSync('/tmp/.resume.lock')) rmSync('/tmp/.resume.lock')
    app = (await import('./server.js')).app

    await request(app)
      .put('/api/profile')
      .send([{ kennung: 'mira', name: 'Mira', figur: '', angelegt: 1 }])
      .expect(200)
    await request(app).post('/api/profil/aktiv').send({ kennung: 'mira' }).expect(200)
    await request(app)
      .put('/api/profil/merken')
      .send({ profil: 'mira', merken: 12, bestaetigt: true })
      .expect(200)
    for (const w of WERKE) {
      await request(app)
        .post('/api/weiterhoeren')
        .send({ schluessel: `spotify:${w.id}`, titelNr: 2, bisher: 120, dauer: 900 })
        .expect(200)
    }
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_CONFIG = undefined
  })

  it('Vorbedingung: Mira hat zwoelf gemerkte Stellen und ihre eigene Zahl', () => {
    assert.equal(stellenVon('mira').length, 12)
    assert.equal(ausDatei('mira')?.merken, 12)
  })

  it('`PUT /api/profile` mit einer kleineren Zahl wird ABGEWIESEN — 409, nichts geschrieben', async () => {
    const r = await listeSchicken((p) => (p.kennung === 'mira' ? { ...p, merken: 1 } : p), 409)
    assert.equal(r.body.error, 'verliertStellen')
    // Die Absage muss sagen, WESSEN Stellen und WIE VIELE — sonst kann eine
    // Oberflaeche daraus keinen Satz bauen, den ein Mensch versteht.
    assert.deepEqual(r.body.kinder, [{ profil: 'mira', hatte: 12, gilt: 1, verliert: 11 }])
    // Und sie nennt den Weg, der die Rueckfrage stellen KANN.
    assert.equal(r.body.ueber, '/api/profil/merken')
    // NICHTS ANGEFASST — weder die Zahl noch eine einzige Stelle.
    assert.equal(ausDatei('mira')?.merken, 12)
    assert.equal(stellenVon('mira').length, 12)
  })

  it('eine Liste OHNE das Feld aendert nichts — die Seite „Kinder" kennt es nicht', async () => {
    await listeSchicken((p) => (p.kennung === 'mira' ? { ...p, name: 'Mira B.' } : p))
    assert.equal(ausDatei('mira')?.merken, 12)
    assert.equal(ausDatei('mira')?.name, 'Mira B.')
  })

  it('HERAUFsetzen ueber denselben Weg geht durch — es kann nichts kosten', async () => {
    await listeSchicken((p) => (p.kennung === 'mira' ? { ...p, merken: 40 } : p))
    assert.equal(ausDatei('mira')?.merken, 40)
    assert.equal(stellenVon('mira').length, 12)
  })

  it('und dieselbe Zahl noch einmal kostet nichts und wird nicht gefragt', async () => {
    await listeSchicken((p) => (p.kennung === 'mira' ? { ...p, merken: 40 } : p))
    assert.equal(ausDatei('mira')?.merken, 40)
  })

  it('ein NEUES Kind darf jede Zahl mitbringen — es hat nichts zu verlieren', async () => {
    const jetzt = await request(app).get('/api/profile').expect(200)
    const liste = (jetzt.body.profile as Record<string, unknown>[]).map((p) => ({
      kennung: p.kennung,
      name: p.name,
      figur: p.figur,
      angelegt: p.angelegt,
    }))
    liste.push({ kennung: 'neu', name: 'Neu', figur: '', angelegt: 2, merken: 1 } as never)
    await request(app).put('/api/profile').send(liste).expect(200)
    assert.equal(ausDatei('neu')?.merken, 1)
  })

  it('die eigene Zahl WEGZUNEHMEN wird gefragt, wenn die Box-Zahl kleiner ist', async () => {
    // merken: null heisst „richte dich nach der Box". Die Box sagt 6, es liegen
    // zwoelf Stellen da — also kostet auch DIESER Weg sechs Stellen. Er sieht
    // nur nicht danach aus, und genau deshalb steht er hier.
    const r = await listeSchicken((p) => (p.kennung === 'mira' ? { ...p, merken: null } : p), 409)
    assert.deepEqual(r.body.kinder, [{ profil: 'mira', hatte: 12, gilt: BOX_ZAHL, verliert: 12 - BOX_ZAHL }])
    assert.equal(ausDatei('mira')?.merken, 40)
  })

  it('und der Weg, der fragen kann, setzt sie danach — mit `bestaetigt`', async () => {
    await request(app)
      .put('/api/profil/merken')
      .send({ profil: 'mira', merken: 1 })
      .expect(409)
    assert.equal(ausDatei('mira')?.merken, 40)
    await request(app)
      .put('/api/profil/merken')
      .send({ profil: 'mira', merken: 1, bestaetigt: true })
      .expect(200)
    assert.equal(ausDatei('mira')?.merken, 1)
    // DAS SETZEN LOESCHT NICHTS. Gekappt wird beim naechsten Merken und beim
    // naechsten Lauf des Skripts — solange ist ein Vertipper folgenlos.
    assert.equal(stellenVon('mira').length, 12)
  })

  it('die Auskunft nennt den ANSTEHENDEN Verlust — nicht erst die Absage', async () => {
    // DER ZUSTAND DAZWISCHEN: die Zahl steht auf 1, es liegen zwoelf Stellen
    // da, und elf davon fallen beim naechsten Merken. Wer die Seite JETZT
    // oeffnet, muss das lesen koennen, ohne es selbst auszurechnen.
    const r = await request(app).get('/api/profil/merken?profil=mira').expect(200)
    assert.equal(r.body.gilt, 1)
    assert.equal(r.body.hatte, 12)
    assert.equal(r.body.verliert, 11)
  })

  it('und sie sagt 0, sobald nichts mehr ansteht', async () => {
    await request(app).put('/api/profil/merken').send({ profil: 'mira', merken: 40 }).expect(200)
    const r = await request(app).get('/api/profil/merken?profil=mira').expect(200)
    assert.equal(r.body.verliert, 0)
  })

  // ══ GEZAEHLT WIRD, WAS GEMERKT IST — nicht, was in der Datei steht ═══════
  //
  // `resume.json` ist eine MEDIENLISTE. Dass heute nur `category: 'resume'`
  // darin liegt (07.08.2026 an .169 nachgesehen: gast 9, kalea 7), ist ein
  // Zustand, keine Zusage: `stelleEinsetzen` laesst Fremdes ausdruecklich
  // stehen, und `remove_max_resume.sh` zaehlt seit heute `select(.category ==
  // "resume")`. Zaehlte die Auskunft alles mit, versprache sie einen Verlust,
  // den niemand herbeifuehrt — und die Rueckfrage vor dem Herunterstellen
  // nennte eine Zahl, die nicht stimmt.
  it('fremde Eintraege in resume.json zaehlen weder als „hatte" noch als Verlust', async () => {
    const datei = join(ordner, 'profile', 'mira', 'resume.json')
    const echt = JSON.parse(readFileSync(datei, 'utf8')) as Record<string, unknown>[]
    assert.equal(echt.length, 12)
    const fremd = Array.from({ length: 6 }, (_, i) => ({
      id: `fremd-${i}`,
      type: 'spotify',
      category: 'audiobook',
      title: `Fremd ${i}`,
    }))
    writeFileSync(datei, JSON.stringify([...fremd, ...echt], null, 2))

    const r = await request(app).get('/api/profil/merken?profil=mira').expect(200)
    assert.equal(r.body.hatte, 12, 'zwoelf gemerkte Stellen — nicht achtzehn Zeilen')
    assert.equal(r.body.verliert, 0)

    const abgewiesen = await request(app)
      .put('/api/profil/merken')
      .send({ profil: 'mira', merken: 5 })
      .expect(409)
    assert.equal(abgewiesen.body.hatte, 12)
    assert.equal(abgewiesen.body.verliert, 7, 'zwoelf minus fuenf — nicht achtzehn minus fuenf')

    // UND DAS KAPPEN SELBST HAELT SICH AN DIESELBE ZAEHLUNG: die Stelle, die
    // jetzt gemerkt wird, laesst genau fuenf gemerkte Stellen uebrig und
    // keinen einzigen fremden Eintrag fallen.
    await request(app).put('/api/profil/merken').send({ profil: 'mira', merken: 5, bestaetigt: true }).expect(200)
    await request(app)
      .post('/api/weiterhoeren')
      .send({ schluessel: `spotify:${WERKE[0].id}`, titelNr: 3, bisher: 300, dauer: 900 })
      .expect(200)
    const danach = JSON.parse(readFileSync(datei, 'utf8')) as Record<string, unknown>[]
    assert.equal(danach.filter((e) => e.category === 'resume').length, 5)
    assert.equal(danach.filter((e) => e.category !== 'resume').length, 6)

    // Den Stand fuer die folgenden Messungen wiederherstellen.
    writeFileSync(datei, JSON.stringify(echt, null, 2))
    await request(app).put('/api/profil/merken').send({ profil: 'mira', merken: 40 }).expect(200)
  })

  it('ein geloeschtes Kind wird nicht gefragt — sein Bestand geht einen anderen Weg', async () => {
    const jetzt = await request(app).get('/api/profile').expect(200)
    const ohne = (jetzt.body.profile as Record<string, unknown>[])
      .filter((p) => p.kennung !== 'mira')
      .map((p) => ({ kennung: p.kennung, name: p.name, figur: p.figur, angelegt: p.angelegt }))
    await request(app).put('/api/profile').send(ohne).expect(200)
    assert.equal(ausDatei('mira'), undefined)
  })
})
