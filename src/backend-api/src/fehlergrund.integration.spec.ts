/**
 * DER ZWEITE DURCHGANG — wo der Fehlerbehandler AUFHÖRT.
 *
 * `fehlerbehandler.integration.spec.ts` daneben prüft, dass die Express-Kette
 * keine Stapelabzüge mehr herausgibt. Diese Datei prüft die Grenze davon: der
 * Behandler beantwortet nur, was bis zu ihm KOMMT. Ein Weg mit eigenem
 * `try/catch`, der `err.message` in seine Antwort schreibt, geht an ihm
 * vorbei — und `err.message` eines Dateizugriffs IST der Pfad. Gemessen am
 * 07.08.2026 an einem echten Serverprozess ohne NODE_ENV:
 *
 *   GET /api/protokolle/datei/idle-shutdown
 *   → {"error":"Protokoll nicht lesbar",
 *      "grund":"ENOENT: no such file or directory, stat '/var/log/mupibox/idle_shutdown.log'"}
 *   GET /api/vorlesen/sprich?text=hallo
 *   → {"error":"spracheFehlt","detail":"Error: EACCES: permission denied, mkdir '/home/dietpi'"}
 *
 * Dieselbe Bauart wie die Nachbardatei, aus demselben Grund: `npm test` setzt
 * NODE_ENV=test, und in dieser Welt sieht man einen Teil dieser Fälle gar
 * nicht. Also ein eigener Prozess, gebündelt wie auf der Box, gelöschtes
 * NODE_ENV, echtes HTTP.
 *
 * DIE MESSUNG SELBST STEHT IN tools/fehlerbehandler-leck-schau.mjs — sie
 * beschießt zusätzlich ALLE schreibenden Wege mit kaputtem Rumpf, setzt Wege
 * ein, die werfen (synchron, asynchron, nach den Kopfzeilen, hinter dem
 * Behandler angemeldet), und prüft am Ende den PREIS: dass alles, was aus der
 * Antwort verschwunden ist, noch im Protokoll steht. Diese Datei ist nur der
 * Riegel, der dafür sorgt, dass die Messung bei jedem Lauf gemacht wird.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PROBE = join(WURZEL, 'tools', 'fehlerbehandler-leck-schau.mjs')

/** Ein Port, den gerade niemand hat — siehe die Begründung in der Nachbardatei. */
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

describe('Was ein Weg herausgibt, der seinen Fehler selbst beantwortet', () => {
  it(
    'kein Dateipfad, kein Modulname, keine Zeilennummer — und das Protokoll behält alles',
    { timeout: 180_000 },
    async () => {
      const port = await freierPort()
      const { text, code } = await new Promise<{ text: string; code: number | null }>((fertig) => {
        const kind = spawn(process.execPath, [PROBE, '--port', String(port)], {
          cwd: WURZEL,
          // NODE_ENV bleibt hier stehen; die Probe löscht es für IHREN
          // Kindprozess. Genau darum geht es.
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

      assert.equal(code, 0, `tools/fehlerbehandler-leck-schau.mjs meldet Lecks:\n${text}`)

      // Die Probe muss WIRKLICH gemessen haben. Ein Werkzeug, das seine
      // Prüfungen stillschweigend überspringt, wäre ein grüner Test ohne
      // Aussage — die teuerste Sorte.
      assert.match(text, /NODE_ENV ist NICHT gesetzt/)
      assert.match(text, /KEIN LECK GEFUNDEN/)
      // Die vier Fälle, die es ohne eingesetzte Wege gar nicht zu sehen gäbe.
      assert.match(text, /ein Weg, der wirft \(synchron\)/)
      assert.match(text, /ein Weg, der spaeter wirft \(async/)
      assert.match(text, /headersSent/)
      assert.match(text, /HINTER dem Behandler angemeldet/)
      // Und der Preis, den sonst niemand bemerkt.
      assert.match(text, /der Pfad, der nicht mehr ueber das Netz geht, steht im Protokoll/)

      const proben = text.split('\n').filter((z) => z.trimStart().startsWith('ok ')).length
      assert.ok(proben >= 40, `nur ${proben} Proben gelaufen — das kann nicht der ganze Durchgang sein`)
    },
  )
})
