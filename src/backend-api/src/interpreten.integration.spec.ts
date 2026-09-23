/**
 * Die Interpreten ueber die Schnittstelle — der Weg, auf dem sie wirklich
 * wirken.
 *
 * Die REGELN stehen in interpreten.spec.ts. Hier geht es um die vier Zusagen,
 * die man einer reinen Funktion nicht ansieht:
 *
 *   1. DIE ENTSCHEIDUNG UEBERLEBT. Sie liegt in einer Datei neben data.json
 *      und nicht im sessionStorage — genau daran ist die bisherige Loesung
 *      gescheitert („Jojo" kam bei jedem Start wieder).
 *   2. DIE BIBLIOTHEK BLEIBT UNBERUEHRT. Ein freigeschalteter Interpret wird
 *      KEIN Medieneintrag; /api/werke antwortet Byte fuer Byte wie vorher.
 *      Das ist die ausdrueckliche Entscheidung des Benutzers.
 *   3. DER NEUE FALL TRAEGT. Ein Interpret ohne ein einziges Werk in der
 *      Bibliothek steht trotzdem in der Reihe und traegt seine Kennung.
 *   4. OHNE SPOTIFY BLEIBT DIE REIHE STEHEN. In diesem Test ist kein Token
 *      eingerichtet, jeder Abruf faellt aus — und trotzdem ist die Reihe voll.
 *      Ein leeres Netz darf nicht aussehen wie eine leere Bibliothek.
 *
 * DIE DATEN SIND DIE DER BOX, gemessen am 2026-08-03 mit
 * tools/interpreten-erkennung.mjs (nur lesend).
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

const LUMPENPACK = {
  id: '0PyuOAMz1lv0z737JcQNOg',
  title: 'Die Zukunft wird gross',
  artist: 'Das Lumpenpack',
  type: 'spotify',
  category: 'music',
}
const JOJO = {
  playlistid: '2QqQXuDKNR8HK1cFxf0NhW',
  title: 'Das Pummeleinhorn',
  artist: '🩵Jojo 🩵',
  type: 'spotify',
  category: 'music',
}
// Der echte Eintrag der Box ohne jede Kennung — er darf gar nicht erst als
// Interpret gelten (`interpretTaugt` in werke.ts).
const EXTERN = { title: 'External Playback', artist: 'Unknown', type: 'spotify', category: 'music' }

const KATALOG = [LUMPENPACK, JOJO, EXTERN]

/** Rolf Zuckowski — von ihm steht NICHTS in dieser Bibliothek. */
const ZUCKOWSKI = { id: '2qn4hIXsvRUyFoboMi31XB', name: 'Rolf Zuckowski' }

let app: import('express').Express
let verzeichnis = ''

function ablage() {
  return JSON.parse(readFileSync(join(verzeichnis, 'interpreten.json'), 'utf8'))
}

describe('Interpreten ueber die Schnittstelle', () => {
  before(async () => {
    verzeichnis = mkdtempSync(join(tmpdir(), 'mupi-interpreten-'))
    writeFileSync(join(verzeichnis, 'data.json'), JSON.stringify(KATALOG, null, 2))
    writeFileSync(join(verzeichnis, 'active_data.json'), JSON.stringify(KATALOG, null, 2))
    process.env.MUPIBOX_CONFIG_DIR = verzeichnis
    // Eigene Sperrdatei je Lauf — `node --test` startet die Spec-Dateien
    // parallel, und die gemeinsame /tmp-Sperre sperrte sonst die anderen mit.
    process.env.MUPIBOX_LOCK_DIR = verzeichnis
    app = (await import('./server.js')).app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_LOCK_DIR = undefined
  })

  it('ohne Ablage gibt es die Datei gar nicht — und die Reihe steht trotzdem', async () => {
    assert.equal(existsSync(join(verzeichnis, 'interpreten.json')), false)
    const r = await request(app).get('/api/interpreten').expect(200)
    // OHNE SPOTIFY GILT „LIEBER ZEIGEN". Hier ist kein Token eingerichtet,
    // also faellt jeder Abruf aus — beide Interpreten der Bibliothek stehen da.
    assert.deepEqual(
      r.body.reihe.map((p: { name: string }) => p.name),
      ['Das Lumpenpack', '🩵Jojo 🩵'],
    )
    // „External Playback" traegt keinen interpretSchluessel und faellt heraus,
    // ohne dass diese Schnittstelle eine zweite Regel dafuer braucht.
    assert.equal(
      r.body.reihe.some((p: { name: string }) => p.name === 'Unknown'),
      false,
    )
    assert.deepEqual(r.body.frei, [])
    assert.deepEqual(r.body.abgelehnt, [])
  })

  it('ABLEHNEN nimmt „Jojo" aus der Reihe — und sagt, warum er fehlt', async () => {
    await request(app).post('/api/interpreten/abgelehnt').send({ name: '🩵Jojo 🩵' }).expect(200)
    const r = await request(app).get('/api/interpreten').expect(200)
    assert.deepEqual(
      r.body.reihe.map((p: { name: string }) => p.name),
      ['Das Lumpenpack'],
    )
    assert.deepEqual(
      r.body.versteckt.map((p: { name: string; grund: string }) => [p.name, p.grund]),
      [['🩵Jojo 🩵', 'abgelehnt']],
    )
  })

  it('… und es steht in einer Datei, nicht in einem Browserspeicher', () => {
    // DAS IST DER GANZE PUNKT. Im sessionStorage endete das „nein" mit dem Tab.
    // Der Schluessel ist seit 19.08.2026 `interpretSchluesselAus(name)` und
    // nicht mehr `normal(name)` — die Zeichen bleiben stehen, damit
    // „Die drei ???" und „Die drei !!!" nicht denselben Schluessel bekommen
    // (E45-Bestandsreview, Begruendung in medien.ts).
    assert.deepEqual(ablage().abgelehnt, [
      { schluessel: '🩵 jojo 🩵', name: '🩵Jojo 🩵', seit: ablage().abgelehnt[0].seit },
    ])
    assert.ok(ablage().abgelehnt[0].seit, 'ohne Zeitpunkt laesst sich spaeter nichts nachlesen')
  })

  it('DER NEUE FALL: jemand ohne ein einziges Werk steht in der Reihe', async () => {
    await request(app)
      .post('/api/interpreten/frei')
      .send({ ...ZUCKOWSKI, bild: 'https://i.scdn.co/image/rolf', quelle: 'suche' })
      .expect(200)
    const r = await request(app).get('/api/interpreten').expect(200)
    const rolf = r.body.reihe.find((p: { name: string }) => p.name === 'Rolf Zuckowski')
    assert.ok(rolf, 'freigeschaltet und still aus der Reihe gefallen')
    assert.equal(rolf.anzahl, 0)
    assert.equal(rolf.id, ZUCKOWSKI.id)
    assert.equal(rolf.herkunft, 'frei')
    // UEBER DEN COVERSPEICHER DER BOX, nicht ueber das CDN.
    assert.equal(rolf.bild, `/api/bild/extern?u=${encodeURIComponent('https://i.scdn.co/image/rolf')}`)
  })

  it('DIE BIBLIOTHEK BLEIBT UNBERUEHRT — er ist KEIN Medieneintrag', async () => {
    // Die ausdrueckliche Entscheidung des Benutzers. Ein Interpret laesst sich
    // nicht abspielen; stuende er in data.json, muesste ihn jede Stelle, die
    // dort Eintraege abspielt, eigens uebergehen.
    assert.deepEqual(JSON.parse(readFileSync(join(verzeichnis, 'data.json'), 'utf8')), KATALOG)
    const r = await request(app).get('/api/werke').expect(200)
    assert.equal(r.body.werke.length, KATALOG.length)
  })

  it('weist eine Freischaltung ohne brauchbare Kennung ab, statt eine tote Kachel abzulegen', async () => {
    await request(app).post('/api/interpreten/frei').send({ name: 'Ohne Kennung', id: 'kurz' }).expect(400)
    await request(app).post('/api/interpreten/frei').send({ id: ZUCKOWSKI.id }).expect(400)
    assert.equal(ablage().frei.length, 1)
  })

  it('laesst ein Bild fremder Herkunft weg, statt die Freischaltung zu verweigern', async () => {
    await request(app)
      .post('/api/interpreten/frei')
      .send({ id: '4ZwXKLDWoTGqiV0avfB1Y9', name: 'EMMA6', bild: 'https://angreifer.de/bild.png' })
      .expect(200)
    assert.equal(ablage().frei.find((f: { name: string }) => f.name === 'EMMA6').bild, undefined)
  })

  it('freischalten hebt eine Ablehnung auf — nie beides gleichzeitig', async () => {
    await request(app)
      .post('/api/interpreten/frei')
      .send({ id: '5xuNBZoM7z1Vv8IQ6uM0p6', name: '🩵Jojo 🩵' })
      .expect(200)
    const a = ablage()
    assert.equal(a.abgelehnt.length, 0)
    const r = await request(app).get('/api/interpreten').expect(200)
    assert.equal(
      r.body.reihe.some((p: { name: string }) => p.name === '🩵Jojo 🩵'),
      true,
    )
  })

  it('zuruecknehmen fuehrt zurueck zur Automatik', async () => {
    await request(app).post('/api/interpreten/offen').send({ name: '🩵Jojo 🩵' }).expect(200)
    const a = ablage()
    assert.equal(
      a.frei.some((f: { name: string }) => f.name === '🩵Jojo 🩵'),
      false,
    )
    assert.equal(a.abgelehnt.length, 0)
  })

  it('zuruecksetzen schreibt die Datei LEER, statt sie zu loeschen', async () => {
    await request(app).post('/api/interpreten/zuruecksetzen').expect(200)
    // Eine fehlende Datei kann auch heissen „hier hat noch nie jemand
    // entschieden"; eine leere heisst „ausdruecklich nichts".
    assert.equal(existsSync(join(verzeichnis, 'interpreten.json')), true)
    assert.deepEqual(ablage(), { frei: [], abgelehnt: [] })
  })

  it('vertraegt eine von Hand krumm gemachte Datei — sie soll ja von Hand aenderbar sein', async () => {
    writeFileSync(join(verzeichnis, 'interpreten.json'), '{ das ist kein JSON')
    const r = await request(app).get('/api/interpreten').expect(200)
    assert.equal(r.body.reihe.length, 2)
    assert.deepEqual(r.body.frei, [])
  })

  it('die Suche ohne Wort ist ein Fehler, kein leeres Ergebnis', async () => {
    await request(app).get('/api/interpreten/suche').expect(400)
    await request(app).get('/api/interpreten/suche?q=%20%20').expect(400)
  })

  it('die Suche sagt es, wenn Spotify nicht eingerichtet ist — statt still leer zu bleiben', async () => {
    // In diesem Test gibt es kein Token. Eine leere Trefferliste saehe aus wie
    // „diesen Interpreten gibt es nicht" und schickte den Suchenden in die
    // Irre.
    const r = await request(app).get('/api/interpreten/suche?q=Rolf%20Zuckowski').expect(502)
    assert.equal(r.body.error, 'spotify')
  })

  // ── Was die Datei sonst noch traegt (E64b) ────────────────────────────────
  //
  // Die Datei ist ausdruecklich dafuer gebaut, von Hand gelesen und berichtigt
  // zu werden — und seit E64b wohnen die box-eigenen Interpretenkennungen in
  // derselben Datei. Wer beim Schreiben nur `frei`/`abgelehnt` zurueckgibt,
  // loescht beides still. Genau das tat der Server bis zum 20.08.2026.

  it('laesst fremde Schluessel stehen, statt sie beim Schreiben zu loeschen', async () => {
    writeFileSync(
      join(verzeichnis, 'interpreten.json'),
      JSON.stringify(
        {
          frei: [],
          abgelehnt: [],
          kennungen: [{ id: 'int_000000000001', namen: [{ name: 'EMMA6', stufe: 'hand' }], verweise: [] }],
          notiz: 'von Hand danebengelegt',
        },
        null,
        2,
      ),
    )
    await request(app).post('/api/interpreten/frei').send({ id: '4ZwXKLDWoTGqiV0avfB1Y9', name: 'EMMA6' }).expect(200)
    const a = ablage()
    assert.equal(a.kennungen?.length, 1, 'die Kennungen ueberleben den Schreibvorgang')
    assert.equal(a.notiz, 'von Hand danebengelegt', 'und eine von Hand danebengelegte Zeile auch')
    assert.equal(a.frei.length, 1, 'das Eigentliche ist trotzdem geschrieben')
  })

  // ── Die box-eigene Interpretenkennung ueber die Schnittstelle (E64b) ──────

  it('sagt, WELCHE Interpreten der Box noch keine Kennung haben', async () => {
    // Ohne diese Liste liesse sich in der Verwaltung nichts zusammenlegen: man
    // saehe die Kennungen, aber nicht, wen die Box ausserdem kennt.
    writeFileSync(join(verzeichnis, 'interpreten.json'), JSON.stringify({ frei: [], abgelehnt: [] }))
    const r = await request(app).get('/api/interpretenkennungen').expect(200)
    assert.deepEqual(r.body.kennungen, [])
    assert.ok(r.body.ohneKennung.includes('Das Lumpenpack'))
    assert.ok(r.body.ohneKennung.includes('🩵Jojo 🩵'))
    // „Unknown" ist kein Interpret (interpretTaugt) und darf hier nicht stehen.
    assert.equal(r.body.ohneKennung.includes('Unknown'), false)
  })

  it('legt eine Kennung an — und verlangt dafuer eine ausdrueckliche Stufe', async () => {
    // Eine Vorgabe „hand" waere eine Luege ueber die Herkunft; dieselbe
    // Zurueckhaltung uebt verschmelzung.ts mit `Zuordnung.stufe`.
    await request(app).post('/api/interpretenkennungen').send({ name: 'Das Lumpenpack' }).expect(400)
    const r = await request(app)
      .post('/api/interpretenkennungen')
      .send({ name: 'Das Lumpenpack', stufe: 'hand' })
      .expect(200)
    assert.equal(r.body.angelegt, true)
    assert.match(r.body.id, /^int_[0-9a-f]{12}$/)
  })

  it('legt beim zweiten Mal NICHTS Neues an, sondern nennt die vorhandene', async () => {
    const r = await request(app)
      .post('/api/interpretenkennungen')
      .send({ name: 'das  lumpenpack', stufe: 'hand' })
      .expect(200)
    assert.equal(r.body.angelegt, false)
    assert.match(r.body.id, /^int_[0-9a-f]{12}$/)
  })

  it('VERWEIGERT das Zusammenlegen ueber die Schnittstelle, wenn eine Maschine es will', async () => {
    // Der Riegel sitzt im Modul; hier wird geprueft, dass die Route ihn
    // durchreicht statt daraus einen Erfolg zu machen. 409, weil es ein
    // Konflikt ist und kein Tippfehler.
    const a = await request(app).post('/api/interpretenkennungen').send({ name: '🩵Jojo 🩵', stufe: 'hand' })
    const b = await request(app).get('/api/interpretenkennungen').expect(200)
    const lumpen = b.body.kennungen.find((k: { namen: { name: string }[] }) =>
      k.namen.some((n) => n.name === 'Das Lumpenpack'),
    )
    const r = await request(app)
      .post('/api/interpretenkennungen/name')
      .send({ id: lumpen.id, name: '🩵Jojo 🩵', stufe: 'erkannt' })
      .expect(409)
    assert.equal(r.body.gehoertZu, a.body.id, 'die Absage sagt, wem der Name gehoert')
  })

  it('laesst einen Menschen zusammenlegen — und haelt fest, dass er es war', async () => {
    const b = await request(app).get('/api/interpretenkennungen').expect(200)
    const lumpen = b.body.kennungen.find((k: { namen: { name: string }[] }) =>
      k.namen.some((n) => n.name === 'Das Lumpenpack'),
    )
    const r = await request(app)
      .post('/api/interpretenkennungen/name')
      .send({ id: lumpen.id, name: '🩵Jojo 🩵', stufe: 'hand' })
      .expect(200)
    const jetzt = r.body.kennungen.find((k: { id: string }) => k.id === lumpen.id)
    assert.equal(jetzt.namen.find((n: { name: string }) => n.name === '🩵Jojo 🩵').stufe, 'hand')
    assert.equal(r.body.kennungen.length, 1, 'die leergeraeumte Kennung faellt weg')
  })

  it('haengt Aufnahme und Spotify an dieselbe Kennung', async () => {
    const b = await request(app).get('/api/interpretenkennungen').expect(200)
    const id = b.body.kennungen[0].id
    await request(app)
      .post('/api/interpretenkennungen/verweis')
      .send({ id, dienst: 'spotify', kennung: '0PyuOAMz1lv0z737JcQNOg' })
      .expect(400) // ohne Stufe nicht
    await request(app)
      .post('/api/interpretenkennungen/verweis')
      .send({ id, dienst: 'spotify', kennung: '0PyuOAMz1lv0z737JcQNOg', stufe: 'hand' })
      .expect(200)
    const r = await request(app)
      .post('/api/interpretenkennungen/verweis')
      .send({ id, dienst: 'aufnahme', kennung: 'music/Das Lumpenpack/Die Zukunft wird gross', stufe: 'hand' })
      .expect(200)
    const k = r.body.kennungen.find((x: { id: string }) => x.id === id)
    assert.equal(k.verweise.length, 2)
    assert.deepEqual(k.verweise.map((v: { dienst: string }) => v.dienst).sort(), ['aufnahme', 'spotify'])
  })

  it('die Freischaltungen ueberleben das alles', async () => {
    // Beide wohnen in derselben Datei. Wer die Kennungen schreibt, darf die
    // Entscheidungen nicht mitnehmen — und umgekehrt.
    await request(app).post('/api/interpreten/frei').send({ id: '4ZwXKLDWoTGqiV0avfB1Y9', name: 'EMMA6' }).expect(200)
    const a = ablage()
    assert.equal(a.frei.length, 1)
    assert.equal(a.kennungen.length, 1)
  })

  it('zuruecksetzen nimmt die Entscheidungen zurueck, nicht die Identitaeten', async () => {
    // Sonst verwaiste mit einem Klick jede Aufnahme, die an einer Kennung
    // haengt — und das waere ein Verlust, den niemand mit „zuruecksetzen"
    // gemeint hat. Wer wirklich alles will, loescht die Datei.
    await request(app).post('/api/interpreten/zuruecksetzen').expect(200)
    const a = ablage()
    assert.deepEqual(a.frei, [])
    assert.deepEqual(a.abgelehnt, [])
    assert.equal(a.kennungen?.length, 1, 'die Kennung steht noch')
  })
})
