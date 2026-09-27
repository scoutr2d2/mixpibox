/**
 * ZWEI VERDACHTE GEGEN DEN UMZUG — einer widerlegt, einer bestaetigt.
 *
 * `bereicheHerrichten()` laeuft ZWEIMAL: beim Start und nach jedem
 * `PUT /api/profile`. Der erste Lauf ist unverdaechtig — da hat noch niemand
 * etwas gelesen. Der ZWEITE ist es nicht, denn Verlauf und Kinderzeit-Konto
 * liegen danach in Zwischenspeichern (`gespieltStaende`, `kzKonten`), die beim
 * ERSTEN Zugriff je Kennung von der Platte lesen und danach nie wieder.
 *
 * ── VERDACHT 1: der Zwischenspeicher verschluckt den Umzug — WIDERLEGT ──────
 * Vermutet war: jemand fragt `?profil=liam`, bevor es Liam gibt (die Kennung
 * wird auf ihre FORM geprueft, nicht auf Mitgliedschaft — die Antwort ist 200
 * und leer). Danach zieht Liams Bestand um, aber gefragt wird der
 * Zwischenspeicher, und Liam sieht: nichts gehoert.
 *
 * GEMESSEN IST ES ANDERS, und der Grund ist `bereichLesePfad`: schon der ERSTE
 * Zugriff faellt auf `gespielt.liam.json` zurueck. Der Zwischenspeicher wird
 * also mit dem RICHTIGEN Inhalt gefuellt, und der spaetere Umzug aendert am
 * Inhalt nichts mehr — er aendert nur, wo er liegt.
 *
 * DAS IST DER ZWEITE ZWECK DES RUECKFALLS, und im Quelltext steht nur der
 * erste („falls der Umzug nicht gelingen konnte"). Er macht die
 * Zwischenspeicher gegen einen spaeten Umzug unempfindlich. Wer den Rueckfall
 * eines Tages fuer ueberfluessig haelt, weil „der Umzug ja laengst durch ist",
 * nimmt diese zweite Wirkung mit weg. Deshalb steht der Lauf hier und bleibt.
 *
 * ── VERDACHT 2: eine zurueckgespielte Sicherung wird still ignoriert — TRIFFT
 * Siehe unten. Das ist der Fall, der auf der Liste „nicht gemessen" stand.
 *
 * Fahren:
 *   NODE_ENV=test npx tsx --test tools/bereich-umzug-nach-dem-lesen.ts
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { tagesSchluessel } from '../src/backend-api/src/kinderzeit'

const WERK = {
  id: 'spaet-1',
  title: 'Was Liam schon kannte',
  artist: 'Pruefung',
  type: 'spotify',
  category: 'audiobook',
}
const SCHLUESSEL = `${WERK.type}:${WERK.id}`

let app: import('express').Express
let ordner: string

describe('Umzug NACH dem ersten Lesen', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-spaet-'))
    writeFileSync(join(ordner, 'data.json'), JSON.stringify([WERK], null, 2))
    writeFileSync(join(ordner, 'active_data.json'), JSON.stringify([WERK], null, 2))
    // NUR DER GAST steht in der Liste — Liam wird erst spaeter angelegt.
    writeFileSync(
      join(ordner, 'profile.json'),
      JSON.stringify({ profile: [{ kennung: 'gast', name: 'Gast', figur: 'x.png', angelegt: 1 }], aktiv: 'gast' }),
    )
    // Liams Bestand LIEGT SCHON DA, in der Form vom 02.08.2026. So sieht eine
    // Box aus, auf der Liam entfernt und wieder angelegt wird.
    writeFileSync(
      join(ordner, 'gespielt.liam.json'),
      JSON.stringify([{ key: SCHLUESSEL, anzahl: 9, zuletzt: Date.now(), title: WERK.title }]),
    )
    writeFileSync(
      join(ordner, 'kinderzeit-verbrauch.liam.json'),
      JSON.stringify({ tag: tagesSchluessel(new Date()), sekunden: 1800, bonusMin: 0 }),
    )

    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('../src/backend-api/src/server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('WIDERLEGT: schon der erste Zugriff sieht den Bestand — ueber den Rueckfall', async () => {
    // Vor dem Anlegen. Haette der Rueckfall die alte Form NICHT gelesen, stuende
    // hier 0 — und der Zwischenspeicher waere ab jetzt falsch.
    const r = await request(app).get('/api/gespielt?max=50&profil=liam').expect(200)
    assert.equal(r.body.zuletzt.length, 1, 'der Rueckfall greift schon vor dem Anlegen')
    assert.equal(r.body.zuletzt[0].anzahl, 9)
  })

  it('ZWEI STELLEN, ZWEI ANTWORTEN auf „gibt es dieses Profil?" — gemessen', async () => {
    // BEIM SCHREIBEN DIESES LAUFS AUFGEFALLEN, nicht gesucht: dieselbe Frage
    // wird im selben Quelltext zweimal verschieden beantwortet.
    //
    //   /api/gespielt?profil=      prueft `kennungPruefen(k)` — nur die FORM.
    //                              Eine Kennung, die es nicht gibt, ergibt 200
    //                              und eine leere Liste.
    //   /api/kinderzeit/stand?profil=  prueft `profilStand.profile.some(...)`
    //                              — die MITGLIEDSCHAFT. Dieselbe Kennung
    //                              ergibt 400.
    //
    // Es geht dabei nichts verloren: `bereichSchreibPfad` wird nie mit einer
    // ungeprueften Kennung gerufen, es entsteht also kein Ordner fuer ein
    // Phantomprofil. Was entsteht, ist eine Verwaltungsseite, die bei einem
    // TIPPFEHLER „nichts gehoert" zeigt statt eines Fehlers — und das sieht
    // genauso aus wie ein Kind, das noch nichts gehoert hat.
    //
    // NICHT REPARIERT, WEIL DIE RICHTUNG DEM BETREIBER GEHOERT: streng heisst,
    // dass der Verlauf eines GELOESCHTEN Profils (dessen Ordner absichtlich
    // stehenbleibt) nicht mehr angesehen werden kann. Lose heisst, dass
    // Tippfehler still bleiben. Beides ist vertretbar, aber es muss EINES sein.
    const g = await request(app).get('/api/gespielt?max=50&profil=gibtesnicht')
    const k = await request(app).get('/api/kinderzeit/stand?profil=gibtesnicht')
    assert.equal(g.status, 200, 'der Verlauf nimmt jede wohlgeformte Kennung')
    assert.equal(k.status, 400, 'die Kinderzeit besteht auf Mitgliedschaft')
  })

  it('nach dem Anlegen liegt der Bestand auf der Platte im Bereich', async () => {
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'gast', name: 'Gast' },
          { kennung: 'liam', name: 'Liam' },
        ],
      })
      .expect(200)
    const imBereich = JSON.parse(readFileSync(join(ordner, 'profile', 'liam', 'gespielt.json'), 'utf8'))
    assert.equal(imBereich.length, 1, 'der Umzug selbst hat geklappt')
    assert.equal(imBereich[0].anzahl, 9)
  })

  it('und der spaete Umzug hat am Sichtbaren NICHTS geaendert', async () => {
    const r = await request(app).get('/api/gespielt?max=50&profil=liam').expect(200)
    assert.equal(r.body.zuletzt.length, 1)
    assert.equal(r.body.zuletzt[0].key, SCHLUESSEL)
  })

  it('und der naechste Titel schreibt den Verlauf nicht platt', async () => {
    await request(app).post('/api/profil/aktiv').send({ kennung: 'liam' }).expect(200)
    await request(app).post('/api/gespielt').send({ key: 'spotify:etwas-neues', title: 'Neu' }).expect(200)
    await new Promise((f) => setTimeout(f, 2400))
    const imBereich = JSON.parse(readFileSync(join(ordner, 'profile', 'liam', 'gespielt.json'), 'utf8'))
    assert.equal(imBereich.length, 2, `nur noch ${imBereich.length} — der alte Eintrag ist ueberschrieben`)
    assert.ok(imBereich.some((e: { key: string }) => e.key === SCHLUESSEL))
  })

  it('TRIFFT: eine zurueckgespielte Sicherung in ALTER Form wird still uebergangen', async () => {
    // DER FALL VON DER LISTE „NICHT GEMESSEN": ein Betreiber spielt eine
    // Sicherung von VOR dem Umzug zurueck. Sie bringt `gespielt.<kennung>.json`
    // mit — die Form, die die Sicherung heute noch einsammelt
    // (`tools/bereich-sicherung-deckung.py` zeigt, dass sie den Bereich gar
    // nicht kennt). Im Bereich liegt aber schon etwas.
    //
    // WAS PASSIERT: `bereichUebernehmen` sieht das Ziel und ruehrt nichts an —
    // das ist genau die Idempotenz, die sie haben MUSS. Gelesen wird ebenfalls
    // der Bereich. Die zurueckgespielte Datei liegt da und wirkt NICHT.
    //
    // WARUM DAS NICHT „einfach richtig" IST: der Betreiber hat eine Sicherung
    // zurueckgespielt und bekommt keinerlei Zeichen, dass sein Verlauf nicht
    // angekommen ist. Er sieht den Stand von JETZT und haelt ihn fuer den
    // wiederhergestellten.
    const alteSicherung = [
      { key: 'spotify:aus-der-sicherung-1', anzahl: 40, zuletzt: Date.now(), title: 'Aus der Sicherung' },
      { key: 'spotify:aus-der-sicherung-2', anzahl: 30, zuletzt: Date.now(), title: 'Auch daraus' },
    ]
    writeFileSync(join(ordner, 'gespielt.liam.json'), JSON.stringify(alteSicherung))
    await request(app)
      .put('/api/profile')
      .send({
        profile: [
          { kennung: 'gast', name: 'Gast' },
          { kennung: 'liam', name: 'Liam' },
        ],
      })
      .expect(200)

    const r = await request(app).get('/api/gespielt?max=50&profil=liam').expect(200)
    assert.equal(
      r.body.zuletzt.some((e: { key: string }) => e.key.startsWith('spotify:aus-der-sicherung')),
      false,
      'WIRD DAS HIER GRUEN->ROT, hat jemand den Vorrang umgedreht — dann bitte die Idempotenz nachmessen',
    )
    assert.equal(
      readFileSync(join(ordner, 'gespielt.liam.json'), 'utf8'),
      JSON.stringify(alteSicherung),
      'die zurueckgespielte Datei liegt unveraendert da — sie ist nicht weg, nur wirkungslos',
    )
  })
})
