/**
 * Tests des unteilbaren Schreibens.
 *
 * DER WICHTIGSTE FALL IST DER GLEICHZEITIGE. Alles andere hier ist
 * Buchhaltung; die Frage, wegen der es dieses Modul gibt, lautet: was
 * passiert, wenn zwei Anfragen im selben Augenblick dieselbe Datei schreiben?
 *
 * DAS IST KEIN ERFUNDENER FALL. Der Kommentar bei `darstellungSchreiben` in
 * server.ts hielt ihn fest, bevor es dieses Modul gab: „zwei Anfragen
 * gleichzeitig teilten sich sonst dieselbe Zwischendatei und schrieben sich
 * gegenseitig mitten hinein." Zwei der vierzehn Fundstellen in server.ts
 * hatten genau diesen Fehler noch — sie schrieben nach
 * `${ziel}.${process.pid}.tmp`, ohne Zaehler.
 *
 * WARUM DIE NUTZLAST GROSS IST: Bei einer kurzen Zeichenkette geht ein
 * Schreibvorgang oft in einem Zug durch, und der Fehler versteckt sich. Erst
 * mit einer Nutzlast, die in mehreren Stuecken geschrieben wird, wird aus
 * „teilen sich die Datei" ein sichtbar zerrissener Inhalt.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { atomarSchreiben, jsonAtomarSchreiben, laufZuruecksetzen, zwischenname } from './atomar'

let ordner = ''

describe('unteilbar schreiben', () => {
  before(() => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-atomar-'))
  })

  after(() => {
    // Der Ordner liegt in tmpdir und wird vom System geraeumt; ihn hier zu
    // loeschen brauchte rekursives Entfernen, und das gehoert nicht in einen
    // Test, der auch mal abbricht.
  })

  it('gibt bei jedem Aufruf einen ANDEREN Zwischennamen', () => {
    // Ohne diesen Zaehler teilten sich zwei gleichzeitige Anfragen dieselbe
    // Zwischendatei — genau der Fehler, der zwei Fundstellen in server.ts
    // noch anhaftete.
    const namen = new Set([...Array(50)].map(() => zwischenname('/x/ziel.json', 4711)))
    assert.equal(namen.size, 50)
  })

  it('legt die Zwischendatei NEBEN das Ziel, nicht nach /tmp', () => {
    // Umbenennen ist nur INNERHALB eines Dateisystems unteilbar. Ueber eine
    // Grenze hinweg wird daraus Kopieren und Loeschen — und in der Mitte
    // liegt der halbe Stand.
    const ziel = '/ein/tiefer/pfad/darstellung.json'
    assert.equal(dirname(zwischenname(ziel, 1)), dirname(ziel))
  })

  it('schreibt JSON eingerueckt — die Dateien sollen von Hand lesbar sein', () => {
    const ziel = join(ordner, 'eingerueckt.json')
    return jsonAtomarSchreiben(ziel, { a: 1, b: { c: 2 } }).then(() => {
      const roh = readFileSync(ziel, 'utf8')
      assert.ok(roh.includes('\n  "a"'), roh)
      assert.deepEqual(JSON.parse(roh), { a: 1, b: { c: 2 } })
    })
  })

  it('laesst Bytes unveraendert durch', async () => {
    const ziel = join(ordner, 'bytes.bin')
    const daten = Uint8Array.from([0, 1, 2, 253, 254, 255])
    await atomarSchreiben(ziel, daten)
    assert.deepEqual(new Uint8Array(readFileSync(ziel)), daten)
  })

  it('setzt die Rechte an EINER Stelle', async () => {
    const ziel = join(ordner, 'rechte.json')
    await jsonAtomarSchreiben(ziel, { x: 1 })
    assert.equal(statSync(ziel).mode & 0o777, 0o644)
  })

  it('laesst keine Zwischendatei liegen', async () => {
    const ziel = join(ordner, 'sauber.json')
    await jsonAtomarSchreiben(ziel, { x: 1 })
    assert.deepEqual(
      readdirSync(ordner).filter((n) => n.startsWith('sauber.json.')),
      [],
    )
  })

  it('DER FALL, WEGEN DEM ES DAS MODUL GIBT: vierzig gleichzeitige Schreibvorgaenge', async () => {
    laufZuruecksetzen()
    const ziel = join(ordner, 'gleichzeitig.json')
    // Gross genug, dass ein Schreibvorgang nicht in einem Zug durchgeht.
    const fuellung = 'x'.repeat(200_000)
    const werte = [...Array(40)].map((_, i) => ({ nr: i, fuellung }))

    await Promise.all(werte.map((w) => jsonAtomarSchreiben(ziel, w)))

    // 1. Die Datei ist GANZ — kein zerrissener Inhalt.
    const gelesen = JSON.parse(readFileSync(ziel, 'utf8'))
    // 2. Und sie ist EINER der geschriebenen Staende, kein Gemisch aus zweien.
    assert.ok(Number.isInteger(gelesen.nr) && gelesen.nr >= 0 && gelesen.nr < 40, String(gelesen.nr))
    assert.equal(gelesen.fuellung.length, fuellung.length)
    // 3. Keine Leiche bleibt liegen.
    assert.deepEqual(
      readdirSync(ordner).filter((n) => n.startsWith('gleichzeitig.json.')),
      [],
    )
  })

  it('setzt die Rechte AUCH GEGEN EINE STRENGE UMASK', async () => {
    // `writeFile({mode})` ist ein WUNSCH: die umask des Prozesses nagt daran.
    // Unter 022 kommt aus 0664 ein 0644 — und genau das war der Schaden an
    // `/etc/mupibox/mupiboxconfig.json` (dietpi:www-data 664): nach einem
    // Schreibvorgang durfte die Gruppe nicht mehr hinein. Deshalb `chmod`.
    const vorherige = process.umask(0o022)
    try {
      const ziel = join(ordner, 'umask.json')
      await jsonAtomarSchreiben(ziel, { x: 1 }, { mode: 0o664 })
      assert.equal(statSync(ziel).mode & 0o777, 0o664)
    } finally {
      process.umask(vorherige)
    }
  })

  it('rueckt mit vier ein, wenn vier verlangt sind', async () => {
    // `mupiboxconfig.json` liegt auf jeder Box mit vier Leerzeichen. Ein
    // stiller Wechsel auf zwei machte aus jedem Schreibvorgang einen Diff
    // ueber die ganze Datei.
    const ziel = join(ordner, 'vier.json')
    await jsonAtomarSchreiben(ziel, { a: 1 }, { einzug: 4 })
    assert.ok(readFileSync(ziel, 'utf8').includes('\n    "a"'), readFileSync(ziel, 'utf8'))
  })

  it('laesst auch BEIM FEHLSCHLAG keine Zwischendatei liegen', async () => {
    // Bis zum 19.09.2026 war das Aufraeumen Sache des Aufrufers — und genau
    // deshalb fehlte es an den zwei Piper-Stellen: ein abgebrochener
    // Sprechversuch liess seine `.tmp` im Vorlese-Speicher liegen.
    //
    // Der Fehlschlag wird hier ECHT erzeugt: das Ziel ist ein VERZEICHNIS,
    // also scheitert das Umbenennen mit EISDIR — nachdem die Zwischendatei
    // schon geschrieben ist. Der einzige Ausgang, in dem eine Leiche
    // entstehen kann.
    const ziel = join(ordner, 'istEinOrdner.json')
    mkdirSync(ziel, { recursive: true })
    await assert.rejects(() => jsonAtomarSchreiben(ziel, { x: 1 }))
    assert.deepEqual(
      readdirSync(ordner).filter((n) => n.startsWith('istEinOrdner.json.')),
      [],
    )
  })

  it('ueberschreibt einen vorhandenen Stand, statt danebenzulegen', async () => {
    const ziel = join(ordner, 'zweimal.json')
    await jsonAtomarSchreiben(ziel, { stand: 'alt' })
    await jsonAtomarSchreiben(ziel, { stand: 'neu' })
    assert.deepEqual(JSON.parse(readFileSync(ziel, 'utf8')), { stand: 'neu' })
    assert.ok(existsSync(ziel))
  })
})
