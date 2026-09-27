/**
 * Der Dienst wird GEFAHREN, nicht gelesen.
 *
 * Eine Probe, die nur nachsieht, ob `AbortSignal.timeout` im Quelltext
 * steht, belegt nichts (llmwiki: eine Probe ist kein grep). Hier laeuft die
 * Telegram-Schleife gegen eine Attrappe, und geprueft wird, was danach auf
 * der Platte liegt, was gesprochen wurde und was beim ZWEITEN Durchgang
 * NICHT noch einmal passiert.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { ablageLesen } from './nachrichten-ablage'
import { Nachrichtendienst, type NachrichtenKonf, type Umgebung } from './nachrichten-dienst'

const KONF: NachrichtenKonf = {
  active: true,
  vorlesen: true,
  telegramActive: true,
  telegramToken: 'geheim',
  erlaubt: [{ weg: 'telegram', absender: '4711', name: 'Oma' }],
}

function update(nr: number, von: number, text: string) {
  return {
    update_id: nr,
    message: { message_id: nr, from: { id: von }, chat: { id: von }, date: 1700, text },
  }
}

interface Aufbau {
  dienst: Nachrichtendienst
  pfad: string
  gesprochen: string[]
  adressen: string[]
  weg: () => void
}

const aufraeumen: (() => void)[] = []
afterEach(() => {
  while (aufraeumen.length) aufraeumen.pop()?.()
})

function bauen(antworten: unknown[], konf: NachrichtenKonf = KONF): Aufbau {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'nachrichten-'))
  const pfad = path.join(ordner, 'nachrichten.json')
  const gesprochen: string[] = []
  const adressen: string[] = []
  let dran = 0
  const u: Umgebung = {
    konf: () => konf,
    ablagePfad: pfad,
    jetzt: () => 1_700_000_000_000,
    holen: async (adresse, o) => {
      adressen.push(adresse)
      // DIE FRIST MUSS DA SEIN — ohne sie haengt ein abgerissener Ruf fuer
      // immer, und der Weg ist still tot.
      assert.ok(o.signal instanceof AbortSignal, 'ohne AbortSignal gerufen')
      const a = antworten[Math.min(dran++, antworten.length - 1)]
      return { ok: true, status: 200, json: async () => a }
    },
    melden: () => {},
    // OHNE ABSTAND: der Mindestabstand ist ein Schutz gegen Leerlauf auf dem
    // Geraet, im Test waere er nur Wartezeit. Dass er WIRKT, prueft ein
    // eigener Test weiter unten.
    mindestMs: 0,
    sprechen: async (t) => {
      gesprochen.push(t)
      return true
    },
  }
  const dienst = new Nachrichtendienst(u)
  const weg = () => {
    dienst.anhalten()
    fs.rmSync(ordner, { recursive: true, force: true })
  }
  aufraeumen.push(weg)
  return { dienst, pfad, gesprochen, adressen, weg }
}

/**
 * Laesst die Schleife laufen, bis die Bedingung eintritt — und haelt dann an.
 *
 * NICHT `setImmediate` EIN PAARMAL: eine Runde der Schleife enthaelt mehrere
 * Wartepunkte (Abfrage, JSON, Schreiben auf die Platte), und wie viele es
 * sind, ist eine Eigenschaft des Codes, nicht des Tests. Ein Test, der eine
 * feste Zahl Runden abzaehlt, misst die Bauart statt das Verhalten und wird
 * beim naechsten Wartepunkt rot, ohne dass etwas kaputt ist.
 *
 * DIE OBERGRENZE IST EIN ABBRUCH, KEINE ZUSICHERUNG: wer sie erreicht, hat
 * einen roten Test, und das ist richtig so.
 */
async function drehen(a: Aufbau, fertig: () => boolean = () => true, deckelMs = 2000): Promise<void> {
  a.dienst.nachziehen()
  const bis = Date.now() + deckelMs
  while (Date.now() < bis) {
    await new Promise((f) => setTimeout(f, 2))
    if (fertig()) break
  }
  a.dienst.anhalten()
  await new Promise((f) => setTimeout(f, 5))
}

describe('Nachrichtendienst, gefahren', () => {
  it('nimmt eine erlaubte Nachricht auf, legt sie ab und liest sie vor', async () => {
    const a = bauen([
      { ok: true, result: [update(5, 4711, 'Gute Nacht!')] },
      { ok: true, result: [] },
    ])
    await drehen(a, () => a.gesprochen.length > 0)
    assert.equal(a.dienst.nachrichten().length, 1)
    assert.equal(a.dienst.nachrichten()[0].text, 'Gute Nacht!')
    assert.deepEqual(a.gesprochen, ['Nachricht von Oma: Gute Nacht!'])
  })

  it('SCHREIBT SIE AUF DIE KARTE — ein Neustart darf sie nicht verlieren', async () => {
    const a = bauen([
      { ok: true, result: [update(5, 4711, 'Gute Nacht!')] },
      { ok: true, result: [] },
    ])
    await drehen(a, () => a.gesprochen.length > 0)
    const gelesen = ablageLesen(a.pfad)
    assert.equal(gelesen.nachrichten[0]?.text, 'Gute Nacht!')
    assert.equal(gelesen.marken.telegram, '6')
  })

  it('LIEST NICHT ZWEIMAL VOR, wenn dieselbe Nachricht noch einmal kommt', async () => {
    const a = bauen([
      { ok: true, result: [update(5, 4711, 'Gute Nacht!')] },
      { ok: true, result: [update(5, 4711, 'Gute Nacht!')] },
      { ok: true, result: [] },
    ])
    await drehen(a, () => a.adressen.length >= 3)
    assert.equal(a.dienst.nachrichten().length, 1)
    assert.equal(a.gesprochen.length, 1)
  })

  it('setzt den Offset beim zweiten Ruf — sonst holt sie dasselbe ewig', async () => {
    const a = bauen([
      { ok: true, result: [update(5, 4711, 'Hallo')] },
      { ok: true, result: [] },
    ])
    await drehen(a, () => a.adressen.length >= 2)
    assert.ok(!a.adressen[0].includes('offset='), a.adressen[0])
    assert.ok(a.adressen[1]?.includes('offset=6'), a.adressen[1])
  })

  it('ZAEHLT DEN FREMDEN UND LEGT IHN NICHT AB — und spricht nicht', async () => {
    const a = bauen([
      { ok: true, result: [update(7, 999, 'Hallo Kind')] },
      { ok: true, result: [] },
    ])
    await drehen(a, () => a.dienst.stand().abgewiesen.telegram !== undefined)
    assert.equal(a.dienst.nachrichten().length, 0)
    assert.deepEqual(a.gesprochen, [])
    assert.equal(a.dienst.stand().abgewiesen.telegram?.anzahl, 1)
    assert.ok(!fs.readFileSync(a.pfad, 'utf8').includes('Hallo Kind'))
  })

  it('geht gar nicht erst los, wenn der Hauptschalter aus ist', async () => {
    const a = bauen([{ ok: true, result: [update(5, 4711, 'Hallo')] }], { ...KONF, active: false })
    await drehen(a, () => false, 60)
    assert.equal(a.adressen.length, 0)
    assert.equal(a.dienst.nachrichten().length, 0)
  })

  it('geht nicht los, wenn der Token fehlt — ein Ruf ohne Token ist nur Laerm', async () => {
    const a = bauen([{ ok: true, result: [] }], { ...KONF, telegramToken: '' })
    await drehen(a, () => false, 60)
    assert.equal(a.adressen.length, 0)
    assert.equal(a.dienst.stand().wege.telegram.an, false)
  })

  it('merkt sich den Fehlschlag, statt ihn zu verschlucken', async () => {
    const a = bauen([{ ok: false, description: 'Unauthorized' }])
    await drehen(a, () => a.dienst.stand().wege.telegram.fehler !== '')
    assert.equal(a.dienst.stand().wege.telegram.fehler, 'Unauthorized')
  })

  it('markiert gelesen — und sagt beim zweiten Mal, dass sich nichts aendert', async () => {
    const a = bauen([
      { ok: true, result: [update(5, 4711, 'Hallo')] },
      { ok: true, result: [] },
    ])
    await drehen(a, () => a.dienst.nachrichten().length > 0)
    const id = a.dienst.nachrichten()[0].id
    assert.equal(await a.dienst.marke(id, 'gelesen', true), true)
    assert.equal(await a.dienst.marke(id, 'gelesen', true), false)
    assert.equal(ablageLesen(a.pfad).nachrichten[0].gelesen, true)
  })

  it('leert auf Wunsch alles — auch die Zaehlung der Fremden', async () => {
    const a = bauen([
      { ok: true, result: [update(7, 999, 'x'), update(8, 4711, 'y')] },
      { ok: true, result: [] },
    ])
    await drehen(a, () => a.dienst.nachrichten().length > 0)
    await a.dienst.leeren()
    assert.equal(a.dienst.nachrichten().length, 0)
    assert.deepEqual(a.dienst.stand().abgewiesen, {})
  })

  it('BRICHT EINEN RUF AB, DER NICHT ANTWORTET — belegt, nicht behauptet', async () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'nachrichten-frist-'))
    aufraeumen.push(() => fs.rmSync(ordner, { recursive: true, force: true }))
    let abgebrochen = false
    const dienst = new Nachrichtendienst({
      konf: () => KONF,
      ablagePfad: path.join(ordner, 'n.json'),
      jetzt: () => 1,
      fristMs: 30,
      mindestMs: 0,
      // Antwortet NIE — so wie ein Dienst, dessen Verbindung abgerissen ist,
      // ohne dass das Betriebssystem es gemerkt haette.
      holen: (_a, o) =>
        new Promise((_f, wirf) => {
          o.signal.addEventListener('abort', () => {
            abgebrochen = true
            wirf(o.signal.reason)
          })
        }),
      melden: () => {},
      sprechen: async () => true,
    })
    aufraeumen.push(() => dienst.anhalten())
    dienst.nachziehen()
    await new Promise((f) => setTimeout(f, 200))
    dienst.anhalten()
    assert.equal(abgebrochen, true, 'der Ruf lief ohne Frist')
    assert.match(dienst.stand().wege.telegram.fehler, /Frist/)
  })

  it('haelt den Mindestabstand ein, wenn ein Dienst sofort und leer antwortet', async () => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'nachrichten-takt-'))
    aufraeumen.push(() => fs.rmSync(ordner, { recursive: true, force: true }))
    let rufe = 0
    const dienst = new Nachrichtendienst({
      konf: () => KONF,
      ablagePfad: path.join(ordner, 'n.json'),
      jetzt: () => 1,
      mindestMs: 120,
      holen: async () => {
        rufe++
        return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) }
      },
      melden: () => {},
      sprechen: async () => true,
    })
    aufraeumen.push(() => dienst.anhalten())
    dienst.nachziehen()
    await new Promise((f) => setTimeout(f, 300))
    dienst.anhalten()
    // Ohne Abstand waeren es in 300 ms Tausende.
    assert.ok(rufe > 0 && rufe <= 5, `Rufe in 300 ms: ${rufe}`)
  })

  it('zaehlt die gueltigen Absender und verschweigt die kaputten', async () => {
    const a = bauen([{ ok: true, result: [] }], {
      ...KONF,
      erlaubt: [
        { weg: 'telegram', absender: '4711' },
        { weg: 'signal', absender: '0170 0000000' },
      ],
    })
    assert.equal(a.dienst.stand().erlaubte, 1)
  })
})
