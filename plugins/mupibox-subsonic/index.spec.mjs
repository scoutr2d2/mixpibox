import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { antwort, formStimmt, kontext as pruefstand } from '../pruefstand.mjs'
import plugin from './index.mjs'

/**
 * Tests für Subsonic — ohne Server, ohne Netz.
 *
 *     node --test plugins/mupibox-subsonic/index.spec.mjs
 *
 * Die wichtigste Frage dieser Datei steht nicht bei „was kommt heraus",
 * sondern bei „was geht HINAUS": das Passwort darf in keiner Adresse stehen.
 * `geholt` sammelt jede abgefragte Adresse mit, also lässt sich genau das
 * prüfen — und zwar über alle Wege hinweg.
 */

const SERVER = 'https://musik.example.org'
const PASSWORT = 'hunter2-und-noch-was'

/** Eine Subsonic-Antwort, wie der Server sie schickt. */
const gut = (inhalt) => antwort(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...inhalt } }))
const schlecht = (code, message) =>
  antwort(JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code, message } } }))

const LIED = { id: '300', title: 'Die Maus', artist: 'WDR', duration: 1234, coverArt: 'al-7' }

function kontext(inhalt, { netz = true, ...mehr } = {}) {
  return pruefstand({
    netz,
    einstellungen: { adresse: SERVER, benutzer: 'kind', passwort: PASSWORT, treffer: 20, ...mehr },
    antworten: () => (typeof inhalt === 'function' ? inhalt() : inhalt),
  })
}

describe('das Passwort geht nie im Klartext hinaus', () => {
  it('nicht beim Auflösen', async () => {
    const { k, geholt } = kontext(gut({ song: LIED }))
    const f = await plugin.aufloesen('300', k)
    // JEDE abgefragte Adresse UND die zurückgegebene Quelle — bei Subsonic
    // steckt die Anmeldung in der Strom-Adresse, die danach an mpv geht und
    // in `/player/local` steht.
    for (const a of [...geholt, f.quelle.adresse, f.titel.bild]) {
      assert.ok(!String(a).includes(PASSWORT), `Passwort steht in: ${a}`)
    }
  })

  it('nicht beim Suchen', async () => {
    const { k, geholt } = kontext(gut({ searchResult3: { song: [LIED] } }))
    await plugin.suchen('maus', k)
    for (const a of geholt) assert.ok(!a.includes(PASSWORT), `Passwort steht in: ${a}`)
  })

  it('nicht beim Befinden', async () => {
    const { k, geholt } = kontext(gut({}))
    await plugin.befinden(k)
    for (const a of geholt) assert.ok(!a.includes(PASSWORT), `Passwort steht in: ${a}`)
  })

  it('sondern als Marke mit Salz — und das Salz wechselt', async () => {
    const { k, geholt } = kontext(gut({ song: LIED }))
    await plugin.aufloesen('300', k)
    await plugin.aufloesen('300', k)
    const salze = geholt.map((a) => new URL(a).searchParams.get('s'))
    const marken = geholt.map((a) => new URL(a).searchParams.get('t'))
    assert.ok(salze.every(Boolean), 'jede Adresse braucht ein Salz')
    assert.ok(
      marken.every((m) => /^[0-9a-f]{32}$/.test(m)),
      'die Marke ist eine md5-Summe',
    )
    // WIEDERVERWENDETES SALZ WAERE KEIN FEHLER DER SCHNITTSTELLE, aber es
    // machte aus einer abgehörten Marke einen dauerhaft gültigen Schlüssel.
    assert.equal(new Set(salze).size, salze.length, 'jedes Salz nur einmal')
  })
})

describe('aufloesen', () => {
  it('macht aus einer Titel-Kennung einen abspielbaren Strom', async () => {
    const { k } = kontext(gut({ song: LIED }))
    const f = await plugin.aufloesen('300', k)
    assert.deepEqual(formStimmt(f), [])
    assert.equal(f.titel.name, 'Die Maus')
    assert.equal(f.titel.kuenstler, 'WDR')
    assert.equal(f.titel.dauerSek, 1234)
    assert.match(f.quelle.adresse, /\/rest\/stream\?/)
    assert.match(f.titel.bild, /\/rest\/getCoverArt\?/)
  })

  it('besteht auf einer Kennung', async () => {
    const { k } = kontext(gut({ song: LIED }))
    await assert.rejects(() => plugin.aufloesen('  ', k), /Titel-Kennung/)
  })

  it('meldet einen unbekannten Titel als solchen', async () => {
    const { k } = kontext(gut({}))
    await assert.rejects(() => plugin.aufloesen('999', k), /kennt den Titel/)
  })
})

describe('suchen', () => {
  it('gibt die Treffer als Titel zurück', async () => {
    const { k, geholt } = kontext(gut({ searchResult3: { song: [LIED, { id: '4', title: 'Zweitens' }] } }))
    const t = await plugin.suchen('maus', k)
    assert.equal(t.length, 2)
    assert.equal(t[0].name, 'Die Maus')
    assert.equal(new URL(geholt[0]).searchParams.get('query'), 'maus')
  })

  it('hält sich an die eingestellte Trefferzahl', async () => {
    const { k, geholt } = kontext(gut({ searchResult3: {} }), { treffer: 5 })
    await plugin.suchen('x', k)
    assert.equal(new URL(geholt[0]).searchParams.get('songCount'), '5')
  })

  it('verträgt eine Antwort ganz ohne Treffer', async () => {
    const { k } = kontext(gut({ searchResult3: {} }))
    assert.deepEqual(await plugin.suchen('nichts', k), [])
  })
})

describe('der Server antwortet IMMER mit 200 — auch bei Ablehnung', () => {
  it('erkennt die abgelehnte Anmeldung im Rumpf', async () => {
    // WER NUR `antwort.ok` PRUEFT, haelt das hier fuer einen Erfolg. Genau
    // dieselbe Falle wie beim Abspieldienst der Box.
    const { k } = kontext(schlecht(40, 'Wrong username or password'))
    await assert.rejects(() => plugin.aufloesen('300', k), /Anmeldung abgelehnt/)
  })

  it('reicht andere Server-Fehler mit Begründung durch', async () => {
    const { k } = kontext(schlecht(70, 'The requested data was not found'))
    await assert.rejects(() => plugin.aufloesen('300', k), /Der Server meldet/)
  })

  it('erkennt eine Antwort, die gar kein Subsonic ist', async () => {
    const { k } = kontext(antwort('<html>Anmeldeseite</html>'))
    await assert.rejects(() => plugin.aufloesen('300', k), /nicht mit JSON/)
  })
})

describe('was noch schiefgehen kann', () => {
  it('sagt es, wenn keine Adresse eingestellt ist', async () => {
    const { k } = kontext(gut({}), { adresse: '' })
    await assert.rejects(() => plugin.aufloesen('300', k), /keine Serveradresse/)
    assert.match((await plugin.befinden(k)).text, /keine Serveradresse/)
  })

  it('sagt es, wenn das Netz-Recht fehlt', async () => {
    const { k } = kontext(gut({}), { netz: false })
    await assert.rejects(() => plugin.aufloesen('300', k), /Recht "netz"/)
  })

  it('baut keine doppelten Schrägstriche, wenn die Adresse einen hat', async () => {
    const { k, geholt } = kontext(gut({ song: LIED }), { adresse: `${SERVER}/` })
    await plugin.aufloesen('300', k)
    assert.ok(!geholt[0].includes('//rest/'), geholt[0])
  })

  it('warnt bei http statt https, statt nur einen Haken zu setzen', async () => {
    const { k } = kontext(gut({}), { adresse: 'http://musik.example.org' })
    const b = await plugin.befinden(k)
    assert.equal(b.ok, true)
    assert.match(b.text, /http, nicht https/)
  })

  it('meldet fehlende Zugangsdaten einzeln, nicht als „geht nicht"', async () => {
    assert.match((await plugin.befinden(kontext(gut({}), { benutzer: '' }).k)).text, /Benutzername/)
    assert.match((await plugin.befinden(kontext(gut({}), { passwort: '' }).k)).text, /Passwort/)
  })
})
