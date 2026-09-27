#!/usr/bin/env node
/**
 * KOMM TROTZDEM DURCH — die Dienst-Sperre unter Beschuss.
 *
 * `tools/dienst-rueckweg-probe.mjs` zeigt, dass die Sperre GREIFT. Dieses
 * Werkzeug stellt die umgekehrte Frage: laesst sie sich UMGEHEN, wenn man die
 * Route direkt ruft statt ueber die Seite? Genau das ist der Punkt, an dem
 * eine Warnung, die nur im Browser steht, nichts wert waere.
 *
 * Gemessen wird nicht die Antwort, sondern der MITSCHRIEB der systemctl-
 * Attrappe: die einzige Frage ist „wurde geschaltet oder nicht". Eine 409 mit
 * einem heimlich abgesetzten `disable` dahinter waere schlimmer als gar keine
 * Sperre, weil sie beruhigt.
 *
 * ══ DIE BOX WIRD NICHT ANGEFASST ═══════════════════════════════════════════
 * Eigener Server auf 127.0.0.1:9981 (`--port` aendert das), eigener PATH mit
 * Attrappen fuer `systemctl` und `sudo`, eigenes leeres Konfigurationsverzeichnis
 * unter /tmp. Dieses Werkzeug kennt keine Adresse einer Box.
 *
 * AUFRUF
 *   node tools/durchkommen-dienst.mjs
 *   node tools/durchkommen-dienst.mjs --port 9991
 *
 * Rueckgabewert 0, wenn KEIN Angriff durchkam und der gewollte Weg (mit Wort)
 * noch funktioniert — sonst 1.
 */

import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.join(HIER, '..')
const iPort = process.argv.indexOf('--port')
const PORT = iPort > 0 ? Number(process.argv[iPort + 1]) : 9981

/** Die Dienstliste wie auf Box .169 (07.08.2026 gelesen) — gekuerzt auf das,
 *  was fuer diese Frage zaehlt, plus ein paar harmlose als Umgebung. */
const VON_DER_BOX = [
  ['bluetooth.service', 'enabled', 'active'],
  ['mupi_fan.service', 'disabled', 'inactive'],
  ['mupi_idle_shutdown.service', 'disabled', 'inactive'],
  ['mupibox-player.service', 'enabled', 'active'],
  ['mupibox-server.service', 'enabled', 'active'],
  ['mupibox-touch-bridge.service', 'enabled', 'active'],
  ['mupibox-wiederherstellung.service', 'enabled', 'inactive'],
  ['mupibox-netz-watchdog-boot.service', 'enabled', 'inactive'],
]

const arbeit = mkdtempSync(path.join(tmpdir(), 'mupi-durchkommen-dienst-'))
const attrappe = path.join(arbeit, 'attrappe')
const mitschrieb = path.join(arbeit, 'systemctl-aufrufe.txt')
mkdirSync(attrappe)
mkdirSync(path.join(arbeit, 'config'))
writeFileSync(mitschrieb, '')

const zeigen = VON_DER_BOX.map(
  ([name, datei, zustand]) =>
    `Id=${name}\nActiveState=${zustand}\nUnitFileState=${datei}\nDescription=technische Description von ${name}\n`,
).join('\n')

writeFileSync(
  path.join(attrappe, 'systemctl'),
  `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(mitschrieb)}
case "$1" in
  list-unit-files) cat <<'ENDE'
${VON_DER_BOX.map(([n, d]) => `${n} ${d} enabled`).join('\n')}
ENDE
  ;;
  show) cat <<'ENDE'
${zeigen}
ENDE
  ;;
esac
exit 0
`,
)
writeFileSync(
  path.join(attrappe, 'sudo'),
  '#!/bin/bash\nwhile [ "${1:0:1}" = "-" ]; do shift; done\nexec "$@"\n',
)
chmodSync(path.join(attrappe, 'systemctl'), 0o755)
chmodSync(path.join(attrappe, 'sudo'), 0o755)

/** Nur die SCHALTENDEN Aufrufe. `show`/`list-unit-files` sind Lesen. */
const geschaltet = () =>
  readFileSync(mitschrieb, 'utf8')
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => /^(start|stop|restart|enable|disable|mask|unmask) /.test(z))

const server = spawn('npx', ['tsx', 'src/server.ts'], {
  cwd: path.join(WURZEL, 'src/backend-api'),
  env: {
    ...process.env,
    PATH: `${attrappe}:${process.env.PATH}`,
    NODE_ENV: 'development',
    MUPIBOX_HTTP_PORT: String(PORT),
    MUPIBOX_NO_AUTO_TLS: '1',
    MUPIBOX_CONFIG_DIR: path.join(arbeit, 'config'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let ausgabe = ''
server.stdout.on('data', (d) => (ausgabe += d))
server.stderr.on('data', (d) => (ausgabe += d))

const basis = `http://127.0.0.1:${PORT}`

async function warten() {
  for (let i = 0; i < 80; i++) {
    try {
      const a = await fetch(`${basis}/api/dienste`, { signal: AbortSignal.timeout(2000) })
      if (a.ok) return
    } catch {
      /* noch nicht oben */
    }
    await new Promise((f) => setTimeout(f, 500))
  }
  throw new Error(`Server kam auf ${PORT} nicht hoch:\n${ausgabe}`)
}

/**
 * Ein Angriff. `roh` erlaubt eine Adresse, die `encodeURIComponent` nicht
 * erzeugen wuerde — genau darum geht es hier.
 */
async function schicken({ pfad, koerper, kopf, methode }) {
  const einst = { method: methode ?? 'POST', signal: AbortSignal.timeout(8000) }
  if (koerper !== undefined) {
    einst.headers = kopf ?? { 'Content-Type': 'application/json' }
    einst.body = typeof koerper === 'string' ? koerper : JSON.stringify(koerper)
  } else if (kopf) {
    einst.headers = kopf
  }
  const a = await fetch(`${basis}${pfad}`, einst)
  let leib = null
  try {
    leib = await a.json()
  } catch {
    leib = await a.text().catch(() => null)
  }
  return { status: a.status, leib }
}

let gruen = 0
let rot = 0
const befunde = []

function melde(ok, name, text) {
  if (ok) {
    gruen++
    console.log(`  OK    ${name}${text ? ` — ${text}` : ''}`)
  } else {
    rot++
    befunde.push(`${name}: ${text}`)
    console.log(`  ROT   ${name} — ${text}`)
  }
}

const ZIEL = 'mupibox-server.service'
const WORT = `kein-rueckweg:${ZIEL}:disable`

/**
 * Der Kern: nach dem Angriff darf im Mitschrieb NICHTS Neues stehen. Die
 * Antwort ist nur die zweite Aussage — es zaehlt, was systemctl gesehen hat.
 */
async function angriff(name, anfrage, was) {
  const vorher = geschaltet().length
  let a
  try {
    a = await schicken(anfrage)
  } catch (f) {
    melde(false, name, `Anfrage geworfen: ${f.message}`)
    return
  }
  const neu = geschaltet().slice(vorher)
  if (neu.length > 0) {
    melde(false, name, `DURCHGEKOMMEN — systemctl bekam: ${neu.join(' | ')} (HTTP ${a.status})`)
  } else {
    melde(true, name, `${was ?? 'nichts geschaltet'}, HTTP ${a.status} ${a.leib?.error ?? ''}`)
  }
}

try {
  await warten()
  console.log(`KOMM TROTZDEM DURCH — Dienst-Sperre, eigener Server auf ${basis}\n`)

  // ── 1. DER GERADE WEG, OHNE WORT ─────────────────────────────────────────
  await angriff('disable ohne Koerper', { pfad: `/api/dienste/${ZIEL}/disable` })
  await angriff('disable mit leerem Koerper', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: {},
  })

  // ── 2. DIE BESTAETIGUNG RATEN ────────────────────────────────────────────
  await angriff('bestaetigt: true (das blinde Ja)', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: { bestaetigt: true },
  })
  await angriff('bestaetigt: 1', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: { bestaetigt: 1 },
  })
  await angriff('bestaetigt: "ja"', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: { bestaetigt: 'ja' },
  })
  await angriff('bestaetigt als Liste mit dem richtigen Wort', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: { bestaetigt: [WORT] },
  })
  await angriff('bestaetigt als Objekt mit dem richtigen Wort', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: { bestaetigt: { toString: WORT } },
  })
  await angriff('das Wort fuer ANHALTEN auf disable', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: { bestaetigt: `kein-rueckweg:${ZIEL}:stop` },
  })
  await angriff('das Wort eines ANDEREN Dienstes', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: { bestaetigt: 'kein-rueckweg:mupi_fan.service:disable' },
  })
  await angriff('das Wort mit angehaengtem Leerzeichen', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: { bestaetigt: `${WORT} ` },
  })

  // ── 3. AN DER PRUEFUNG VORBEI ────────────────────────────────────────────
  await angriff('Prototypenverschmutzung: __proto__.bestaetigt', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: `{"__proto__":{"bestaetigt":${JSON.stringify(WORT)}}}`,
  })
  await angriff('constructor.prototype.bestaetigt', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: `{"constructor":{"prototype":{"bestaetigt":${JSON.stringify(WORT)}}}}`,
  })
  await angriff('das Wort in der Abfrage statt im Koerper', {
    pfad: `/api/dienste/${ZIEL}/disable?bestaetigt=${encodeURIComponent(WORT)}`,
  })
  // WARUM DIESE DREI EINZELN STEHEN: `express.json()` haengt zwar an der
  // Route, aber `app.use(express.urlencoded({extended:false}))` (server.ts:1636)
  // hat den Rumpf da schon gelesen. Ein Formular-Rumpf kommt also durch.
  // Das ist fuer sich richtig — das Wort MUSS trotzdem stimmen. Genau das
  // wird hier gemessen, statt es zu glauben.
  await angriff('Formular-Rumpf OHNE Wort', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: 'irgendwas=1',
    kopf: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  await angriff('Formular-Rumpf mit FALSCHEM Wort', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: `bestaetigt=${encodeURIComponent('kein-rueckweg:mupi_fan.service:disable')}`,
    kopf: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  await angriff('Formular-Rumpf, bestaetigt=true', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: 'bestaetigt=true',
    kopf: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  await angriff('multipart-Rumpf mit dem Wort (kein Parser dafuer)', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: `--x\r\nContent-Disposition: form-data; name="bestaetigt"\r\n\r\n${WORT}\r\n--x--\r\n`,
    kopf: { 'Content-Type': 'multipart/form-data; boundary=x' },
  })
  await angriff('Text-Rumpf, der das Wort enthaelt', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: WORT,
    kopf: { 'Content-Type': 'text/plain' },
  })
  await angriff('kaputtes JSON', {
    pfad: `/api/dienste/${ZIEL}/disable`,
    koerper: '{"bestaetigt":',
  })

  // ── 4. DEN NAMEN VERBIEGEN ───────────────────────────────────────────────
  await angriff('Name ohne .service (systemctl haengt es selbst an)', {
    pfad: '/api/dienste/mupibox-server/disable',
  })
  await angriff('Name mit angehaengtem Leerzeichen', {
    pfad: `/api/dienste/${ZIEL}%20/disable`,
  })
  await angriff('Name mit angehaengtem Zeilenumbruch', {
    pfad: `/api/dienste/${ZIEL}%0A/disable`,
  })
  await angriff('Name mit NUL', {
    pfad: `/api/dienste/${ZIEL}%00/disable`,
  })
  await angriff('Name gross geschrieben', {
    pfad: '/api/dienste/MuPiBox-Server.service/disable',
  })
  await angriff('Name mit kodiertem Schraegstrich', {
    pfad: `/api/dienste/mupibox-${encodeURIComponent('../mupibox-server.service')}/disable`,
  })
  await angriff('Name als systemctl-Option (--all)', {
    pfad: '/api/dienste/mupibox---all/disable',
  })
  await angriff('Name mit angehaengtem zweiten Dienst', {
    pfad: `/api/dienste/${encodeURIComponent(`${ZIEL} mupibox-touch-bridge.service`)}/disable`,
  })
  await angriff('Sternchen als Name', {
    pfad: '/api/dienste/mupibox-%2A/disable',
  })

  // ── 5. EINE AKTION, DIE DIE LISTE NICHT KENNT ────────────────────────────
  await angriff('mask statt disable (waere schlimmer als disable)', {
    pfad: `/api/dienste/${ZIEL}/mask`,
  })
  await angriff('Aktion gross geschrieben', {
    pfad: `/api/dienste/${ZIEL}/Disable`,
  })
  await angriff('Aktion mit angehaengtem zweiten Wort', {
    pfad: `/api/dienste/${ZIEL}/${encodeURIComponent('disable --now')}`,
  })

  // ── 6. DIE ANDEREN BEIDEN SACKGASSEN ─────────────────────────────────────
  for (const d of ['mupibox-touch-bridge.service', 'mupibox-wiederherstellung.service']) {
    await angriff(`${d}: disable ohne Wort`, { pfad: `/api/dienste/${d}/disable` })
  }

  // ── 7. DIE GEGENPROBEN — kommt der Betreiber noch durch? ──────────────────
  {
    const vorher = geschaltet().length
    const a = await schicken({
      pfad: `/api/dienste/${ZIEL}/disable`,
      koerper: { bestaetigt: WORT },
    })
    const neu = geschaltet().slice(vorher)
    melde(
      a.status === 200 && neu.length === 1 && neu[0] === `disable ${ZIEL}`,
      'GEGENPROBE: mit dem richtigen Wort geht es durch',
      `HTTP ${a.status}, systemctl bekam: ${neu.join(' | ') || '(nichts)'}`,
    )
  }
  {
    // Ein harmloser Dienst darf NICHT nach einem Wort verlangen — eine
    // Rueckfrage, die staendig kommt, ist nach zwei Wochen ein Reflex.
    const vorher = geschaltet().length
    const a = await schicken({ pfad: '/api/dienste/mupi_fan.service/disable', koerper: {} })
    const neu = geschaltet().slice(vorher)
    melde(
      a.status === 200 && neu.length === 1,
      'GEGENPROBE: ein harmloser Dienst braucht KEIN Wort',
      `HTTP ${a.status}, systemctl bekam: ${neu.join(' | ') || '(nichts)'}`,
    )
  }
  {
    // Anhalten ist zurueckzunehmen (Strom aus/an) — und darf deshalb ohne Wort
    // gehen. Gemessen, damit die Einstufung nicht nur behauptet ist.
    const vorher = geschaltet().length
    const a = await schicken({ pfad: `/api/dienste/${ZIEL}/stop`, koerper: {} })
    const neu = geschaltet().slice(vorher)
    melde(
      a.status === 200 && neu.length === 1 && neu[0] === `stop ${ZIEL}`,
      'GEGENPROBE: Anhalten von mupibox-server geht ohne Wort (Strom aus/an holt es zurueck)',
      `HTTP ${a.status}, systemctl bekam: ${neu.join(' | ') || '(nichts)'}`,
    )
  }
  {
    // Die 409 muss den Text MITLIEFERN — sonst muesste die Oberflaeche eine
    // eigene Liste gefaehrlicher Dienste fuehren, und die laeuft auseinander.
    const a = await schicken({ pfad: `/api/dienste/${ZIEL}/disable`, koerper: {} })
    const l = a.leib ?? {}
    melde(
      a.status === 409 && !!l.verliert && !!l.rueckweg && l.bestaetigung === WORT,
      'die 409 traegt Folgen, Rueckweg und das Wort',
      `HTTP ${a.status}, Felder: ${Object.keys(l).join(',')}`,
    )
  }

  // ── 8. WAS DIE SPERRE NICHT LEISTET, UND AUCH NIE SOLLTE ────────────────
  //
  // Das Wort ist keine Geheimzahl, sondern ein Ablauf: es steht in der 409
  // und laesst sich aus dem Quelltext ableiten. Gegen einen MENSCHEN, der die
  // Route direkt ruft, wirkt es (der zweite Schritt kommt mit dem Text, den
  // er lesen soll). Gegen ein SKRIPT wirkt es nicht — und das ist keine
  // Luecke dieser Reparatur, sondern der Zustand der ganzen API: sie steht in
  // der Vorgabe (`interfacelogin.state=false`) ohne Anmeldung im Heimnetz,
  // und `app.use(cors())` (server.ts:637) laesst jede Herkunft zu.
  //
  // Gemessen wird das hier, damit es im Bericht nicht behauptet, sondern
  // belegt ist. Es faellt NICHT rot — sonst waere die Farbe eine Meinung.
  {
    const vorher = geschaltet().length
    const a = await schicken({
      pfad: '/api/dienste/mupibox-touch-bridge.service/disable',
      koerper: `bestaetigt=${encodeURIComponent('kein-rueckweg:mupibox-touch-bridge.service:disable')}`,
      kopf: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://beliebige-fremde-seite.example',
      },
    })
    const neu = geschaltet().slice(vorher)
    console.log(
      `\n  NOTIZ  Formular-POST von fremder Herkunft MIT dem Wort: HTTP ${a.status}, ` +
        `systemctl bekam: ${neu.join(' | ') || '(nichts)'}\n` +
        `         Ein Formular-POST braucht keine Vorabfrage (CORS-preflight). Das Wort steht in\n` +
        `         der 409 und im Quelltext — gegen ein Skript ist es kein Hindernis. Die API hat\n` +
        `         in der Vorgabe ohnehin keine Anmeldung; /api/system/reboot steht daneben offen.\n` +
        `         Das ist kein Rueckschritt durch diese Reparatur, gehoert aber in den Bericht.`,
    )
  }

  console.log(`\n${gruen} gruen, ${rot} rot`)
  if (rot) console.log(`\nBEFUNDE:\n${befunde.map((b) => `  - ${b}`).join('\n')}`)
} finally {
  server.kill('SIGTERM')
  await new Promise((f) => setTimeout(f, 400))
  server.kill('SIGKILL')
  if (!process.argv.includes('--behalten')) rmSync(arbeit, { recursive: true, force: true })
  else console.log(`Arbeitsverzeichnis: ${arbeit}`)
}

process.exit(rot === 0 ? 0 : 1)
