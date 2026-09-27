#!/usr/bin/env node
/**
 * HANDY-APP-VM-LOG — was die Handy-App ausgibt, direkt aus ihrer Dart-VM.
 *
 * WOZU (27.09.2026): Auf dem Honor-Handy des Betreibers (PGT-N19, Android 16)
 * steht `persist.log.tag` ab Werk auf `S` — logcat verschluckt JEDE Zeile der
 * App, und der Rest ist verschluesselt ((HKS)…(HKE)). Damit sieht man:
 *   * keine Ausnahme der App (ein unbehandelter Fehler in einem Future ist
 *     schlicht weg),
 *   * und `flutter run` haengt nach „Installing …" fuer immer, weil es die
 *     Adresse der Dart-VM aus logcat liest.
 * Den zweiten Punkt umgeht tools/handy-app-debug.sh (fester Port, kein
 * Zugangscode, `flutter attach`). Den ersten dieses Werkzeug: es fragt die VM
 * selbst ueber ihre JSON-RPC-Schnittstelle, an logcat vorbei.
 *
 * AUFRUF
 *     node tools/handy-app-vm-log.mjs                    # ws://127.0.0.1:43000/ws
 *     node tools/handy-app-vm-log.mjs --adresse ws://127.0.0.1:43000/ws
 *     node tools/handy-app-vm-log.mjs --sekunden 20      # nach 20 s beenden
 *
 * Vorher muss der Port durchgeleitet sein (handy-app-debug.sh tut das):
 *     adb forward tcp:43000 tcp:43000
 *
 * WAS AUSGEGEBEN WIRD: jede Zeile aus Stdout/Stderr (print, debugPrint,
 * FlutterError), jedes dart:developer-log, jede Ausnahme, an der die VM
 * haelt, und beim Verbinden der Zustand jedes Isolats — ein Isolat, das an
 * einer Ausnahme steht, ist genau der Fall, den logcat hier verschweigt.
 *
 * KEINE ABHAENGIGKEITEN: Node ab 22 bringt WebSocket mit.
 */

const arg = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const ADRESSE = arg('--adresse', 'ws://127.0.0.1:43000/ws')
const SEKUNDEN = Number(arg('--sekunden', '0'))

let naechste = 1
const offen = new Map()
const ws = new WebSocket(ADRESSE)

function rufen(methode, params = {}) {
  const id = String(naechste++)
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: methode, params }))
  return new Promise((gut, schlecht) => offen.set(id, { gut, schlecht }))
}

const zeit = () => new Date().toLocaleTimeString('de-DE')
const text64 = (b) => Buffer.from(b ?? '', 'base64').toString('utf8').replace(/\n$/, '')

ws.addEventListener('error', (e) => {
  console.error(`Keine Verbindung zu ${ADRESSE}: ${e.message ?? e.type}`)
  console.error('Laeuft die App mit festem Port, und ist er durchgeleitet? (tools/handy-app-debug.sh)')
  process.exit(2)
})
ws.addEventListener('close', () => {
  console.log(`${zeit()} Verbindung zu. (App beendet oder neu gestartet?)`)
  process.exit(0)
})

ws.addEventListener('message', (m) => {
  const n = JSON.parse(m.data)
  if (n.id && offen.has(n.id)) {
    const { gut, schlecht } = offen.get(n.id)
    offen.delete(n.id)
    return n.error ? schlecht(new Error(JSON.stringify(n.error))) : gut(n.result)
  }
  if (n.method !== 'streamNotify') return
  const e = n.params?.event ?? {}
  switch (e.kind) {
    case 'WriteEvent':
      console.log(`${zeit()} [${n.params.streamId}] ${text64(e.bytes)}`)
      break
    case 'Logging': {
      const r = e.logRecord ?? {}
      console.log(`${zeit()} [log ${r.loggerName?.valueAsString ?? ''}] ${r.message?.valueAsString ?? ''}`)
      if (r.error?.valueAsString && r.error.valueAsString !== 'null') console.log(`    Fehler: ${r.error.valueAsString}`)
      break
    }
    case 'PauseException':
      console.log(`${zeit()} [AUSNAHME] ${e.exception?.valueAsString ?? e.exception?.classRef?.name ?? '?'}`)
      break
    case 'Extension':
      if (e.extensionKind === 'Flutter.Error') {
        console.log(`${zeit()} [Flutter.Error] ${e.extensionData?.description ?? JSON.stringify(e.extensionData).slice(0, 300)}`)
      }
      break
    default:
      break
  }
})

ws.addEventListener('open', async () => {
  const vm = await rufen('getVM')
  console.log(`${zeit()} verbunden: Dart ${vm.version.split(' ')[0]}, ${vm.targetCPU}, ${vm.isolates.length} Isolat(e)`)
  for (const i of vm.isolates) {
    const iso = await rufen('getIsolate', { isolateId: i.id })
    const halt = iso.pauseEvent?.kind ?? '?'
    console.log(`  ${iso.name}: ${halt}${halt === 'PauseException' ? ` — ${iso.pauseEvent.exception?.valueAsString}` : ''}`)
  }
  for (const s of ['Stdout', 'Stderr', 'Logging', 'Debug', 'Extension']) {
    try {
      await rufen('streamListen', { streamId: s })
    } catch {
      // Schon abonniert (DDS teilt Stroeme) — kein Grund aufzuhoeren.
    }
  }
  console.log(`${zeit()} hoere mit (Stdout, Stderr, Logging, Debug, Extension) …`)
  if (SEKUNDEN > 0) setTimeout(() => ws.close(), SEKUNDEN * 1000)
})
