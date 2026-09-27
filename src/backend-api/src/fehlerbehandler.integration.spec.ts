/**
 * STAPELABZÜGE AN JEDEN IM NETZ — geprüft an einem ECHTEN Serverprozess.
 *
 * ══ WARUM DIESE AUSSAGE ANDERS AUSSIEHT ALS ALLE ANDEREN HIER ═════════════
 *
 * Der Fehler, um den es geht, entsteht NICHT im eigenen Code. Er entsteht in
 * der Express-Kette, in `express.json()`, und Express entscheidet an NODE_ENV,
 * ob sein Vorgabe-Fehlerbehandler den vollständigen Stapelabzug IN DIE ANTWORT
 * schreibt. Auf der Box ist NODE_ENV NICHT GESETZT (07.08.2026 im
 * /proc/<pid>/environ des laufenden Backends nachgesehen; die Unit setzt es
 * nicht) — also gilt dort 'development', und ein
 *
 *   curl -X PUT -H 'Content-Type: application/json' --data '{kaputt' …
 *
 * beantwortete JEDEN JSON-Weg mit HTML und darin mit Dateipfaden aus dem
 * Dateisystem der Box. An jeden im Netz: `interfacelogin.state` ist in der
 * Vorlage `false`, die Oberfläche steht ohne Anmeldung offen.
 *
 * EINE PRÜFUNG IM SELBEN PROZESS HÄTTE DAS NIE GESEHEN. `npm test` setzt
 * NODE_ENV=test, und in dieser Welt schweigt Express von sich aus. Wer den
 * Fehler mit supertest gegen `app` suchen wollte, fände genau nichts und
 * hielte den Weg für dicht. Deshalb wird hier ein eigener Prozess gestartet,
 * mit gelöschtem NODE_ENV, gebündelt wie auf der Box — und angefragt wird
 * über echtes HTTP.
 *
 * DIE MESSUNG SELBST STEHT IN tools/fehlerbehandler-probe.mjs und nicht hier.
 * Sie ist ein Werkzeug: sie lässt sich auch von Hand gegen einen laufenden
 * Server richten, wenn wieder jemand fragt, was die Box eigentlich
 * herausgibt. Diese Datei ist nur der Riegel, der dafür sorgt, dass die
 * Messung bei jedem Lauf gemacht wird.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PROBE = join(WURZEL, 'tools', 'fehlerbehandler-probe.mjs')

/**
 * Ein Port, den gerade niemand hat.
 *
 * KEINE FESTE ZAHL: `node --test` startet die Spec-Dateien parallel in eigenen
 * Prozessen, und auf diesem Rechner laufen daneben Vorschauen auf 9951 und
 * aufwärts. Ein fester Port wäre ein Test, der davon abhängt, was sonst
 * gerade offen ist. Das Betriebssystem weiß es besser: Port 0 binden, die
 * vergebene Nummer merken, wieder freigeben.
 */
function freierPort(): Promise<number> {
  return new Promise((fertig, fehler) => {
    const s = createServer()
    s.once('error', fehler)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      const p = typeof a === 'object' && a ? a.port : 0
      s.close(() => (p ? fertig(p) : fehler(new Error('kein Port'))))
    })
  })
}

describe('Kaputter Rumpf: was geht über das Netz, was ins Protokoll', () => {
  it(
    'ein Serverprozess OHNE NODE_ENV verrät keine Stapelabzüge — und sagt trotzdem, was falsch war',
    { timeout: 180_000 },
    async () => {
      const port = await freierPort()
      const { text, code } = await new Promise<{ text: string; code: number | null }>((fertig) => {
        const kind = spawn(process.execPath, [PROBE, '--port', String(port)], {
          cwd: WURZEL,
          // NODE_ENV bleibt hier stehen (der Testlauf braucht es); die Probe
          // löscht es für IHREN Kindprozess. Genau darum geht es.
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let alles = ''
        kind.stdout.on('data', (d) => {
          alles += String(d)
        })
        kind.stderr.on('data', (d) => {
          alles += String(d)
        })
        kind.on('close', (code) => fertig({ text: alles, code }))
      })

      // Der Bericht der Probe gehört in die Ausgabe, wenn etwas fehlt — sonst
      // steht hier nur „exit 1" und niemand weiß, welche der Proben es war.
      assert.equal(code, 0, `tools/fehlerbehandler-probe.mjs meldet Fehlschläge:\n${text}`)

      // Und die Probe muss WIRKLICH gemessen haben. Ein Werkzeug, das seine
      // Prüfungen stillschweigend überspringt, wäre ein grüner Test ohne
      // Aussage — die teuerste Sorte.
      assert.match(text, /NODE_ENV ist NICHT gesetzt/)
      assert.match(text, /ALLES GRÜN/)
      const proben = text.split('\n').filter((z) => z.trimStart().startsWith('ok ')).length
      assert.ok(proben >= 15, `nur ${proben} Proben gelaufen — das kann nicht der ganze Durchgang sein`)
    },
  )
})
