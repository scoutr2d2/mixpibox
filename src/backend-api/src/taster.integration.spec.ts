/**
 * Der Taster-Ereignisstrom AM LAUFENDEN SERVER — mit einer nachgestellten
 * Zustandsdatei, damit dabei kein echter Ausschalter angefasst wird.
 *
 * WARUM DAS NICHT DIE DEUTUNG NOCH EINMAL PRÜFT: die steht in taster.spec.ts
 * und ist dort ohne Gerät festgenagelt. Was hier bewiesen wird, geht mit einer
 * reinen Prüfung nicht — und es ist der Punkt, an dem diese Anzeige still
 * kaputtgehen könnte:
 *
 *   1. DASS DAS UMBENENNEN GESEHEN WIRD. `taster_wache.py` schreibt die
 *      Zustandsdatei über `os.replace`, also atomar über ein Rename. Ein
 *      `fs.watch` auf die DATEI hängt danach an einem Inode, den es nicht mehr
 *      gibt: Es meldet den ersten Druck vielleicht noch und danach nie wieder.
 *      Das wäre grün in jedem Formeltest, grün beim Start des Servers, und tot
 *      auf der Box — die schlimmste Sorte Fehler, weil sie erst auftritt,
 *      nachdem jemand die Anzeige für fertig erklärt hat.
 *   2. dass derselbe Stand NICHT zweimal gemeldet wird (fs.watch meldet je
 *      Rename gern doppelt; der Ring finge sonst mitten im Druck von vorn an).
 *   3. dass eine fehlende Wache `stand: null` ergibt und der Strom trotzdem
 *      OFFEN bleibt, statt mit einem Fehler zu enden.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

let server: Server
let adresse: string
let ordner: string
let laufOrdner: string
let zustandsPfad: string

/**
 * Den Stand schreiben, WIE DIE WACHE ES TUT: erst daneben, dann umbenennen.
 *
 * Das ist der ganze Sinn dieser Datei. Ein `writeFileSync` direkt auf die
 * Zieldatei würde den Fall, um den es geht, gerade NICHT herstellen — und der
 * Test wäre grün, während die Box schweigt.
 */
function standSchreibenWieDieWache(stand: '0' | '1'): void {
  const neben = zustandsPfad + '.neu'
  writeFileSync(neben, stand + '\n')
  renameSync(neben, zustandsPfad)
}

/**
 * Am Ereignisstrom horchen und die nächsten `anzahl` Meldungen einsammeln.
 *
 * Es wird KEIN EventSource benutzt (das gibt es im Server-Node nicht), sondern
 * der Rumpf der Antwort Stück für Stück gelesen — dasselbe, was der Browser
 * tut, nur von Hand.
 */
async function horchen(
  anzahl: number,
  waehrenddessen: () => void | Promise<void>,
  fristMs = 4000,
): Promise<Array<{ stand: string | null; haltedauerMs: number }>> {
  const abbruch = new AbortController()
  const antwort = await fetch(adresse + '/api/taster/strom', { signal: abbruch.signal })
  assert.equal(antwort.status, 200)
  assert.match(antwort.headers.get('content-type') ?? '', /text\/event-stream/)

  const gelesen: Array<{ stand: string | null; haltedauerMs: number }> = []
  const leser = antwort.body!.getReader()
  const entziffern = new TextDecoder()
  let rest = ''

  const sammeln = (async () => {
    while (gelesen.length < anzahl) {
      const { value, done } = await leser.read()
      if (done) break
      rest += entziffern.decode(value, { stream: true })
      // Ereignisse sind durch eine Leerzeile getrennt.
      const teile = rest.split('\n\n')
      rest = teile.pop() ?? ''
      for (const teil of teile) {
        const zeile = teil.split('\n').find((z) => z.startsWith('data: '))
        if (zeile) gelesen.push(JSON.parse(zeile.slice(6)))
      }
    }
  })()

  // Erst horchen, DANN auslösen — sonst ist das Ereignis vorbei, bevor der
  // Beobachter steht, und der Test schlüge aus dem falschen Grund fehl.
  await new Promise((f) => setTimeout(f, 150))
  await waehrenddessen()

  await Promise.race([sammeln, new Promise((f) => setTimeout(f, fristMs))])
  abbruch.abort()
  return gelesen
}

describe('Taster-Ereignisstrom am laufenden Server', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-taster-'))
    laufOrdner = join(ordner, 'run')
    mkdirSync(laufOrdner, { recursive: true })
    zustandsPfad = join(laufOrdner, 'taster.zustand')
    standSchreibenWieDieWache('1')

    // DIE FORM STAMMT VON DER ECHTEN BOX (.79, 31.08.2026, ausgelesen) — und
    // das ist hier kein Detail, sondern der Grund, warum dieser Test etwas
    // wert ist. Vorher stand `shim: { pressDelay: '2' }` darin, weil der
    // `shim`-Abschnitt alles andere zum Ausschalter führt und deshalb wie der
    // richtige Ort aussieht. Der Server las genau dort, der Test schrieb genau
    // dorthin, beide waren sich einig — und beide lagen falsch. Die Haltedauer
    // steht unter `timeout`, und `off_trigger.sh` liest sie von dort.
    //
    // Ein Test, der die Annahme des Gemessenen teilt, prüft sie nicht, sondern
    // bestätigt sie. `shim` steht hier vollständig mit drin, aber OHNE
    // pressDelay — genau so, wie die Box es hat.
    const konfigPfad = join(ordner, 'mupiboxconfig.json')
    writeFileSync(
      konfigPfad,
      JSON.stringify({
        mupibox: { host: 'MuPiBox' },
        interfacelogin: { state: false, password: '' },
        shim: { poweroffPin: '4', triggerPin: '17', cutPin: '27', ledPin: '13' },
        timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
      }),
    )

    process.env.MUPIBOX_CONFIG = konfigPfad
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPI_TASTER_ZUSTAND = zustandsPfad

    const modul = await import('./server.js')
    server = modul.app.listen(0)
    await new Promise((f) => server.once('listening', f))
    const a = server.address()
    adresse = 'http://127.0.0.1:' + (typeof a === 'object' && a ? a.port : 0)
  })

  after(async () => {
    process.env.MUPI_TASTER_ZUSTAND = undefined
    process.env.MUPIBOX_CONFIG = undefined
    process.env.MUPIBOX_CONFIG_DIR = undefined
    await new Promise((f) => server.close(f))
    rmSync(ordner, { recursive: true, force: true })
  })

  it('meldet den Stand sofort beim Anhängen — nicht erst beim nächsten Druck', async () => {
    // Ein Kiosk, der neu lädt, während der Knopf gehalten wird, muss den Ring
    // sehen. Ohne diese erste Meldung bliebe er dunkel bis zum Loslassen.
    const meldungen = await horchen(1, () => {})
    assert.equal(meldungen.length, 1)
    assert.equal(meldungen[0].stand, 'los')
    assert.equal(meldungen[0].haltedauerMs, 2000, 'pressDelay "2" aus der Konfiguration')
  })

  it('SIEHT DAS UMBENENNEN — der Fall, an dem ein Beobachter auf der Datei stirbt', async () => {
    const meldungen = await horchen(2, async () => {
      standSchreibenWieDieWache('0')
    })
    assert.ok(meldungen.length >= 2, `nur ${meldungen.length} Meldung(en) — das Rename kam nicht an`)
    assert.equal(meldungen[0].stand, 'los', 'der Anfangsstand')
    assert.equal(meldungen[1].stand, 'gedrueckt', 'der Druck')
  })

  it('sieht auch den ZWEITEN Druck — genau hier stirbt der Datei-Beobachter', async () => {
    // Der erste Druck kann einem Beobachter auf der Datei noch gelingen; ab
    // dem zweiten Rename ist sein Inode endgültig weg. Deshalb wird hier
    // mehrfach umbenannt.
    standSchreibenWieDieWache('1')
    const meldungen = await horchen(4, async () => {
      standSchreibenWieDieWache('0')
      await new Promise((f) => setTimeout(f, 250))
      standSchreibenWieDieWache('1')
      await new Promise((f) => setTimeout(f, 250))
      standSchreibenWieDieWache('0')
    })
    const staende = meldungen.map((m) => m.stand)
    assert.deepEqual(staende, ['los', 'gedrueckt', 'los', 'gedrueckt'], `bekommen: ${staende.join(', ')}`)
  })

  it('meldet denselben Stand NICHT zweimal — sonst finge der Ring mittendrin von vorn an', async () => {
    standSchreibenWieDieWache('0')
    const meldungen = await horchen(
      3,
      async () => {
        // Dreimal derselbe Stand. fs.watch meldet je Rename gern doppelt
        // (rename + change); ankommen darf davon nichts.
        standSchreibenWieDieWache('0')
        await new Promise((f) => setTimeout(f, 120))
        standSchreibenWieDieWache('0')
        await new Promise((f) => setTimeout(f, 120))
        standSchreibenWieDieWache('0')
      },
      1500,
    )
    assert.equal(meldungen.length, 1, `nur der Anfangsstand darf kommen, bekommen: ${meldungen.length}`)
    assert.equal(meldungen[0].stand, 'gedrueckt')
  })

  it('ohne Wache: stand null, und der Strom bleibt trotzdem offen', async () => {
    // Der Zustand dieser Box vor der Reparatur — mupi_offtrigger disabled,
    // niemand liest GPIO17. Der Kiosk muss das von "Server weg" unterscheiden
    // können, also darf der Strom nicht mit einem Fehler enden.
    rmSync(zustandsPfad, { force: true })
    const meldungen = await horchen(1, () => {})
    assert.equal(meldungen.length, 1, 'der Strom muss antworten, auch ohne Zustandsdatei')
    assert.equal(meldungen[0].stand, null, 'null heisst "weiss ich nicht", nicht "losgelassen"')
    assert.equal(meldungen[0].haltedauerMs, 2000, 'die Haltedauer kommt aus der Konfiguration und fehlt nicht mit')
    standSchreibenWieDieWache('1')
  })
})
