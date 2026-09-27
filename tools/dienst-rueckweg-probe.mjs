#!/usr/bin/env node
/**
 * KOMMT MAN ZURUECK? — gemessen am ECHTEN Server, gegen eine ATTRAPPE von systemctl.
 *
 * ══ DER BEFUND, DER DIESES WERKZEUG AUSGELOEST HAT (07.08.2026) ════════════
 * Die Seite „Systemdienste" bot fuer JEDEN Dienst dieselben zwei Bedienungen
 * an, in derselben Aufmachung: den Knopf „Anhalten" und das Haekchen „startet
 * mit". Darunter stand `mupibox-server.service` als ganz normale Zeile — und
 * dieser eine Prozess bedient 8200 UND 8443, also die Verwaltung selbst, die
 * ganze API und das Bild auf dem Schirm der Box. Wer sein Haekchen wegnahm,
 * sperrte sich aus: nicht sofort, sondern beim naechsten Stromausfall. Eine
 * Kinderbox wird ausgesteckt, nicht heruntergefahren; zwischen Ursache und
 * Wirkung lagen also Tage.
 *
 * Die Prueffrage lautet nicht „ist das gefaehrlich?", sondern:
 *
 *     Ein Elternteil tut das. Es hat kein zweites Geraet, kein SSH und keine
 *     Anleitung. Kommt es zurueck?
 *
 * ══ WARUM EIN WERKZEUG UND NICHT NUR TESTS ═════════════════════════════════
 * dienste.spec.ts prueft die reinen Funktionen — die Einstufung, das Wort,
 * die Vollstaendigkeit der Tabelle. Was es NICHT prueft, ist die Stelle, an
 * der es darauf ankommt: die ROUTE. Eine Warnung, die nur in der Oberflaeche
 * steht, ist keine, sobald jemand `curl` benutzt. Hier laeuft deshalb der
 * WIRKLICHE `src/backend-api/src/server.ts` — mit express, mit dem Verteiler,
 * mit der Zweitpruefung gegen die systemd-Liste — und wird ueber HTTP
 * angesprochen.
 *
 * ══ WAS ERSETZT WIRD, UND WARUM DAS EHRLICH BLEIBT ═════════════════════════
 *   systemctl   eine ATTRAPPE: ein Skript im PATH, das `list-unit-files` und
 *               `show` aus einer Festlegung beantwortet und JEDEN Aufruf
 *               mitschreibt. Genau darum geht es — die entscheidende Frage
 *               ist „wurde geschaltet oder nicht", und die beantwortet nur
 *               ein Mitschrieb.
 *   sudo        eine Attrappe, die nur das Folgende ausfuehrt. Sonst fragte
 *               dieser Lauf nach einem Passwort.
 *   config/     ein leeres Verzeichnis (MUPIBOX_CONFIG_DIR). Die echten
 *               Dateien gehoeren root und jemand arbeitet damit.
 * Der Server, die Route, die Einstufung und die Sperre sind ECHT.
 *
 * ══ DIE BOX WIRD NICHT ANGEFASST ═══════════════════════════════════════════
 * Dieses Werkzeug kennt keine Adresse einer Box und kann keine bekommen. Es
 * startet seinen EIGENEN Server auf 127.0.0.1 und einem eigenen Port und
 * redet ausschliesslich mit dem. Ein `disable` gegen die echte Box waere
 * genau der Schaden, gegen den hier geprueft wird.
 *
 * AUFRUF
 *   node tools/dienst-rueckweg-probe.mjs                Tabelle, Ende 0/1
 *   node tools/dienst-rueckweg-probe.mjs --pruefen      still, Ende 1 bei Befund
 *   node tools/dienst-rueckweg-probe.mjs --port 8577
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.join(HIER, '..')
const PRUEFEN = process.argv.includes('--pruefen')
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8577

/**
 * Die Dienstliste, wie systemd sie auf Box .169 wirklich meldet
 * (`systemctl list-unit-files --type=service`, gelesen am 07.08.2026).
 *
 * Sie steht hier ABSICHTLICH vollstaendig und nicht auf drei Zeilen gekuerzt:
 * die Frage „hat jemand fuer JEDEN Dienst beantwortet, was ohne ihn am Geraet
 * noch geht" laesst sich nur an der ganzen Liste stellen. Wer einen Dienst
 * dazubaut und die Antwort vergisst, wird hier rot.
 */
const VON_DER_BOX = [
  ['bluetooth.service', 'enabled', 'active'],
  ['dietpi-dashboard.service', 'disabled', 'inactive'],
  ['librespot-waechter.service', 'static', 'inactive'],
  ['librespot.service', 'enabled', 'active'],
  ['mupi-network-info.service', 'static', 'inactive'],
  ['mupi_autoconnect-wifi.service', 'disabled', 'inactive'],
  ['mupi_change_checker.service', 'enabled', 'active'],
  ['mupi_check_internet.service', 'enabled', 'active'],
  ['mupi_check_monitor.service', 'enabled', 'active'],
  ['mupi_fan.service', 'disabled', 'inactive'],
  ['mupi_hat.service', 'enabled', 'active'],
  ['mupi_hat_control.service', 'enabled', 'active'],
  ['mupi_idle_shutdown.service', 'disabled', 'inactive'],
  ['mupi_mqtt.service', 'enabled', 'active'],
  ['mupi_novnc.service', 'disabled', 'inactive'],
  ['mupi_powerled.service', 'disabled', 'inactive'],
  ['mupi_splash.service', 'disabled', 'inactive'],
  ['mupi_startstop.service', 'disabled', 'inactive'],
  ['mupi_telegram.service', 'disabled', 'inactive'],
  ['mupi_vnc.service', 'disabled', 'inactive'],
  ['mupi_wifi.service', 'disabled', 'inactive'],
  ['mupibox-alsa-init.service', 'disabled', 'active'],
  ['mupibox-boot-splash.service', 'enabled', 'inactive'],
  ['mupibox-bt-reconnect.service', 'static', 'inactive'],
  ['mupibox-netz-watchdog-boot.service', 'enabled', 'inactive'],
  ['mupibox-player.service', 'enabled', 'active'],
  ['mupibox-server.service', 'enabled', 'active'],
  ['mupibox-sicherung.service', 'static', 'inactive'],
  ['mupibox-sicherungsprobe.service', 'static', 'inactive'],
  ['mupibox-touch-bridge.service', 'enabled', 'active'],
  ['mupibox-wiederherstellung.service', 'enabled', 'inactive'],
  ['pulseaudio.service', 'disabled', 'inactive'],
  ['spotifyd.service', 'disabled', 'inactive'],
  ['wifi-powersave-off.service', 'enabled', 'active'],
]

const arbeit = mkdtempSync(path.join(tmpdir(), 'mupi-rueckweg-'))
const attrappe = path.join(arbeit, 'attrappe')
const mitschrieb = path.join(arbeit, 'systemctl-aufrufe.txt')
mkdirSync(attrappe)
mkdirSync(path.join(arbeit, 'config'))
writeFileSync(mitschrieb, '')

/* ── DIE ATTRAPPE ─────────────────────────────────────────────────────────
 * `show` beantwortet ALLE Namen in einem Rutsch, so wie systemd es tut:
 * Bloecke, durch eine leere Zeile getrennt. Der Mitschrieb ist die eigentliche
 * Messung — er sagt, ob wirklich geschaltet wurde. */
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
// `sudo` faellt nur die Optionen weg und fuehrt aus — sonst fragte dieser Lauf
// nach einem Passwort, und ein Werkzeug, das nach einem Passwort fragt, laeuft
// in keiner Pruefkette mit.
writeFileSync(
  path.join(attrappe, 'sudo'),
  '#!/bin/bash\nwhile [ "${1:0:1}" = "-" ]; do shift; done\nexec "$@"\n',
)
chmodSync(path.join(attrappe, 'systemctl'), 0o755)
chmodSync(path.join(attrappe, 'sudo'), 0o755)

const aufrufe = () =>
  readFileSync(mitschrieb, 'utf8')
    .split('\n')
    .map((z) => z.trim())
    .filter(Boolean)

/** Nur die SCHALTENDEN Aufrufe — `show` und `list-unit-files` sind Lesen. */
const geschaltet = () =>
  aufrufe().filter((z) => /^(start|stop|restart|enable|disable) /.test(z))

const server = spawn(
  'npx',
  ['tsx', 'src/server.ts'],
  {
    cwd: path.join(WURZEL, 'src/backend-api'),
    env: {
      ...process.env,
      PATH: `${attrappe}:${process.env.PATH}`,
      // development: sonst will der Server sein gebautes Angular ausliefern
      // und faellt ueber `__dirname` im ESM-Modus.
      NODE_ENV: 'development',
      MUPIBOX_HTTP_PORT: String(PORT),
      MUPIBOX_NO_AUTO_TLS: '1',
      MUPIBOX_CONFIG_DIR: path.join(arbeit, 'config'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let serverAusgabe = ''
server.stdout.on('data', (d) => (serverAusgabe += d))
server.stderr.on('data', (d) => (serverAusgabe += d))

const wurzel = `http://127.0.0.1:${PORT}`

async function warten() {
  for (let i = 0; i < 60; i++) {
    try {
      const a = await fetch(`${wurzel}/api/dienste`, { signal: AbortSignal.timeout(2000) })
      if (a.ok) return
    } catch {
      /* noch nicht oben */
    }
    await new Promise((f) => setTimeout(f, 500))
  }
  throw new Error(`Server kam auf ${PORT} nicht hoch:\n${serverAusgabe}`)
}

async function schalten(name, aktion, koerper) {
  const a = await fetch(`${wurzel}/api/dienste/${encodeURIComponent(name)}/${aktion}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(koerper ?? {}),
    signal: AbortSignal.timeout(8000),
  })
  return { status: a.status, leib: await a.json() }
}

const befunde = []
const zeilen = []
function pruefe(frage, gut, was) {
  zeilen.push(`${gut ? '  ok  ' : ' FEHL '} ${frage}${gut ? '' : `  → ${was}`}`)
  if (!gut) befunde.push(`${frage}: ${was}`)
}

try {
  await warten()

  // ── 1. TRAEGT JEDE ZEILE IHRE ANTWORT? ──────────────────────────────────
  const liste = await (await fetch(`${wurzel}/api/dienste`)).json()
  const dienste = liste.dienste ?? []
  pruefe(
    'die Attrappe kommt vollstaendig durch',
    dienste.length === VON_DER_BOX.length,
    `${dienste.length} von ${VON_DER_BOX.length} Diensten`,
  )
  const ohne = dienste.filter((d) => !d.tragweite).map((d) => d.name)
  pruefe(
    'JEDER Dienst sagt, was ohne ihn am Geraet noch geht',
    ohne.length === 0,
    `ohne Antwort: ${ohne.join(', ')}`,
  )
  const rohnamig = dienste.filter((d) => d.titel.startsWith('technische Description'))
  pruefe(
    'kein Dienst steht mit seiner technischen Description da',
    rohnamig.length === 0,
    `noch technisch benannt: ${rohnamig.map((d) => d.name).join(', ')}`,
  )
  const server_ = dienste.find((d) => d.name === 'mupibox-server.service')
  pruefe(
    'mupibox-server ist als „kein Weg zurueck" gekennzeichnet — VOR dem Klick',
    server_?.tragweite?.startetMit?.stufe === 'kein-rueckweg',
    `stufe = ${server_?.tragweite?.startetMit?.stufe}`,
  )
  pruefe(
    '… und „Anhalten" dort ausdruecklich NICHT (es ist zuruecknehmbar)',
    server_?.tragweite?.anhalten?.stufe === 'warnung',
    `stufe = ${server_?.tragweite?.anhalten?.stufe}`,
  )
  pruefe(
    'der Beleg bleibt im Quelltext und geht nicht ueber die Leitung',
    !JSON.stringify(liste).includes('/proc/bus/input/devices'),
    'die Antwort traegt Messnotizen mit sich herum',
  )

  // ── 2. DIE SPERRE SITZT AM ENDPUNKT, NICHT IM BROWSER ───────────────────
  const vorher = geschaltet().length
  const blank = await schalten('mupibox-server.service', 'disable')
  pruefe('`disable` ohne Bestaetigung wird nicht ausgefuehrt', blank.status === 409, `HTTP ${blank.status}`)
  pruefe(
    'und es wurde WIRKLICH nichts geschaltet (Mitschrieb der Attrappe)',
    geschaltet().length === vorher,
    `neue Schaltaufrufe: ${geschaltet().slice(vorher).join(' | ')}`,
  )
  pruefe(
    'die Antwort sagt, was man verliert',
    (blank.leib.verliert ?? '').length > 40,
    `verliert = ${JSON.stringify(blank.leib.verliert)}`,
  )
  pruefe(
    'die Antwort sagt, was der Weg zurueck waere',
    /SSH/.test(blank.leib.rueckweg ?? ''),
    `rueckweg = ${JSON.stringify(blank.leib.rueckweg)}`,
  )
  pruefe(
    'die Antwort nennt den zweiten Schritt beim Namen',
    typeof blank.leib.bestaetigung === 'string' && blank.leib.bestaetigung.length > 10,
    `bestaetigung = ${JSON.stringify(blank.leib.bestaetigung)}`,
  )

  const blind = await schalten('mupibox-server.service', 'disable', { bestaetigt: true })
  pruefe(
    'ein blindes {"bestaetigt":true} reicht NICHT',
    blind.status === 409,
    `HTTP ${blind.status} — dann liesse sich die Sperre pauschal mitschicken`,
  )

  const fremd = await schalten('mupibox-server.service', 'disable', {
    bestaetigt: 'kein-rueckweg:mupibox-server.service:stop',
  })
  pruefe(
    'die Bestaetigung fuer „Anhalten" oeffnet NICHT „startet mit"',
    fremd.status === 409,
    `HTTP ${fremd.status}`,
  )

  const fremderDienst = await schalten('mupibox-touch-bridge.service', 'disable', {
    bestaetigt: blank.leib.bestaetigung,
  })
  pruefe(
    'die Bestaetigung eines anderen Dienstes passt auch nicht',
    fremderDienst.status === 409,
    `HTTP ${fremderDienst.status}`,
  )

  // ── 3. ES IST SEINE BOX: mit dem Wort geht es durch ──────────────────────
  const vorDemVollzug = geschaltet().length
  const echt = await schalten('mupibox-server.service', 'disable', {
    bestaetigt: blank.leib.bestaetigung,
  })
  pruefe('mit dem Wort wird ausgefuehrt — verboten ist nichts', echt.status === 200, `HTTP ${echt.status}`)
  pruefe(
    'und zwar GENAU EINMAL',
    geschaltet().slice(vorDemVollzug).join('|') === 'disable mupibox-server.service',
    `geschaltet: ${geschaltet().slice(vorDemVollzug).join(' | ')}`,
  )

  // ── 4. UND DER REST WIRD NICHT SCHIKANIERT ──────────────────────────────
  const anhalten = await schalten('mupibox-server.service', 'stop')
  pruefe(
    '„Anhalten" braucht keine Zeremonie — es ist zuruecknehmbar',
    anhalten.status === 200,
    `HTTP ${anhalten.status}`,
  )
  const luefter = await schalten('mupi_fan.service', 'disable')
  pruefe(
    'der Luefter bleibt eine ganz normale Wahl',
    luefter.status === 200,
    `HTTP ${luefter.status}`,
  )
  const bruecke = await schalten('mupibox-touch-bridge.service', 'disable')
  pruefe(
    'die Touch-Bruecke fragt ebenso zurueck (sie IST der Beruehrungsschirm)',
    bruecke.status === 409,
    `HTTP ${bruecke.status}`,
  )

  // ── 5. EINE WAHRHEIT, NICHT ZWEI ────────────────────────────────────────
  // Die Oberflaeche darf keine eigene Liste gefaehrlicher Dienste fuehren:
  // sonst warnt sie, wo der Server durchlaesst, oder schweigt, wo er sperrt.
  const seite = readFileSync(
    path.join(WURZEL, 'src/frontend-admin/src/app/seiten/dienste.ts'),
    'utf8',
  )
  const dienstschicht = readFileSync(
    path.join(WURZEL, 'src/frontend-admin/src/app/dienste.dienst.ts'),
    'utf8',
  )
  // Im Kopfkommentar darf der Name stehen — er erklaert den Anlass. In der
  // Vorlage und im Rumpf nicht: dort waere er eine zweite Wahrheit.
  const ohneKommentare = (t) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [wo, text] of [
    ['seiten/dienste.ts', seite],
    ['dienste.dienst.ts', dienstschicht],
  ]) {
    const treffer = ohneKommentare(text).match(/mupibox-(server|touch-bridge|wiederherstellung)/g)
    pruefe(
      `${wo} fuehrt KEINE eigene Liste gefaehrlicher Dienste`,
      !treffer,
      `nennt ${[...new Set(treffer ?? [])].join(', ')} im Code`,
    )
  }
} catch (e) {
  befunde.push(`Messung abgebrochen: ${e?.message ?? e}`)
  zeilen.push(` FEHL  ${e?.message ?? e}`)
} finally {
  server.kill('SIGTERM')
  setTimeout(() => server.kill('SIGKILL'), 2000).unref()
  rmSync(arbeit, { recursive: true, force: true })
}

if (!PRUEFEN) {
  console.log('\nKOMMT MAN ZURUECK? — eigener Server, Attrappe von systemctl, keine Box\n')
  for (const z of zeilen) console.log(z)
  console.log(
    befunde.length === 0
      ? '\nAlles gruen: die Sperre sitzt am Endpunkt, nicht nur im Browser.\n'
      : `\n${befunde.length} Befund(e).\n`,
  )
}
process.exit(befunde.length === 0 ? 0 : 1)
