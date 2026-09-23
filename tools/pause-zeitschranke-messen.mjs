#!/usr/bin/env node
/**
 * WAS KOSTET ES, `spotifyApi.pause()` ABZUWARTEN?
 *
 * WOZU: BACKLOG E24/O2 will `stop()` im Abspieldienst das Versprechen von
 * `spotifyApi.pause()` abwarten lassen, BEVOR es 200 antwortet — dann braucht
 * die Oberflaeche keine feste Atempause mehr
 * (llmwiki weiterhoeren-stop-und-start-im-wettlauf).
 *
 * DIE FRAGE, DIE VORHER BEANTWORTET SEIN MUSS: `stop` geht bei JEDEM Tipp
 * hinaus. Wenn `pause()` bei totem Netz in eine lange Frist laeuft, haengt
 * dann jeder Tipp. Also: WIE LANGE dauert es im schlechtesten Fall?
 *
 * WAS HIER GEMESSEN WIRD — und warum es der richtige Weg ist: nicht
 * `spotifyApi.pause()` selbst (der Wirt `api.spotify.com` steht in
 * webapi-request.js fest und laesst sich nicht umbiegen), sondern der
 * `HttpManager` DERSELBEN Bibliothek mit einem umgebogenen Wirt. Das ist
 * Zeile fuer Zeile derselbe Code, den `pause()` benutzt — inklusive der
 * Stelle, an der superagent NIE eine Zeitschranke gesetzt bekommt
 * (http-manager.js `_makeRequest` ruft `.timeout()` nirgends auf).
 *
 * DIE VIER FAELLE
 *   erreichbar   ein Wirt hier im Haus, der sofort antwortet — der Alltag
 *   stumm        ein Wirt, der die Verbindung annimmt und dann SCHWEIGT.
 *                Das ist der WLAN-Ausfall mitten im Gespraech und der
 *                haesslichste Fall: TCP merkt nichts.
 *   fort         eine Adresse aus TEST-NET-1 (192.0.2.0/24, RFC 5737).
 *                Dorthin geht kein Paket; der Kern versucht den Verbindungs-
 *                aufbau immer wieder. Das ist „Router weg".
 *   schranke     derselbe stumme Fall, aber mit `mitZeitschranke()` darum
 *                herum — der Nachweis, dass die Reparatur die Frist bindet.
 *
 * AUFRUF
 *   node tools/pause-zeitschranke-messen.mjs                 # alle vier
 *   node tools/pause-zeitschranke-messen.mjs --geduld 20000  # laenger warten
 *   node tools/pause-zeitschranke-messen.mjs --nur fort
 *
 * `--geduld` ist NUR die Beobachtungsdauer dieses Werkzeugs, keine
 * Zeitschranke der Bibliothek. Was danach noch laeuft, laeuft weiter — genau
 * das ist der Befund.
 */

import net from 'node:net'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hier = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(hier, '..', 'node_modules', 'x.js'))

let HttpManager
let BaseRequest
try {
  HttpManager = require('spotify-web-api-node/src/http-manager')
  BaseRequest = require('spotify-web-api-node/src/base-request')
} catch (fehler) {
  console.error('spotify-web-api-node nicht gefunden — im Hauptverzeichnis `npm install` laufen lassen.')
  console.error(String(fehler.message || fehler))
  process.exit(2)
}

// ── die Schalter ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const zahl = (name, standard) => {
  const i = argv.indexOf(name)
  if (i < 0) return standard
  const n = Number(argv[i + 1])
  return Number.isFinite(n) ? n : standard
}
const wort = (name, standard) => {
  const i = argv.indexOf(name)
  return i < 0 ? standard : String(argv[i + 1] || standard)
}

const GEDULD_MS = zahl('--geduld', 12000)
const NUR = wort('--nur', '')
const SCHRANKE_MS = zahl('--schranke', 1500)

/**
 * DIE REPARATUR IN KLEIN — dieselbe Form, die in den Abspieldienst gehoert.
 *
 * Sie WIRFT NICHT und sie haengt nicht: entweder das Versprechen wird fertig,
 * oder die Frist laeuft ab. Der Aufrufer erfaehrt, welches von beidem.
 */
function mitZeitschranke(versprechen, ms) {
  return new Promise((fertig) => {
    let entschieden = false
    const uhr = setTimeout(() => {
      if (entschieden) return
      entschieden = true
      fertig('abgelaufen')
    }, ms)
    // `unref` DAMIT DIE UHR DEN PROZESS NICHT AM LEBEN HAELT — im Dienst
    // egal, hier aber der Unterschied zwischen „Werkzeug endet" und „haengt".
    if (typeof uhr.unref === 'function') uhr.unref()
    versprechen.then(
      () => {
        if (entschieden) return
        entschieden = true
        clearTimeout(uhr)
        fertig('fertig')
      },
      () => {
        if (entschieden) return
        entschieden = true
        clearTimeout(uhr)
        fertig('fehler')
      },
    )
  })
}

/** Ein `PUT` ueber den HttpManager der Bibliothek — derselbe Weg wie `pause()`. */
function bibliotheksPut(wirt, port) {
  const anfrage = BaseRequest.builder()
    .withHost(wirt)
    .withPort(port)
    .withScheme('http')
    .withPath('/v1/me/player/pause')
    .withHeaders({ Authorization: 'Bearer messung', 'Content-Type': 'application/json' })
    .build()
  return new Promise((fertig, daneben) => {
    HttpManager.put(anfrage, (fehler, antwort) => {
      if (fehler) daneben(fehler)
      else fertig(antwort)
    })
  })
}

// ── die Gegenstellen ────────────────────────────────────────────────────────

/** Antwortet sofort mit 204 — so wie Spotify es bei geglueckter Pause tut. */
function wirtErreichbar() {
  return new Promise((fertig) => {
    const s = http.createServer((_req, res) => {
      res.statusCode = 204
      res.end()
    })
    s.listen(0, '127.0.0.1', () => fertig({ port: s.address().port, zu: () => s.close() }))
  })
}

/**
 * Nimmt die Verbindung an und schweigt. KEIN http-Server — der wuerde nach
 * seiner eigenen Frist die Verbindung schliessen und der Messung ein Ende
 * schenken, das es im Ernstfall nicht gibt.
 */
function wirtStumm() {
  return new Promise((fertig) => {
    const offen = []
    const s = net.createServer((sock) => {
      offen.push(sock)
      sock.on('error', () => {})
    })
    s.listen(0, '127.0.0.1', () =>
      fertig({
        port: s.address().port,
        zu: () => {
          for (const sock of offen) sock.destroy()
          s.close()
        },
      }),
    )
  })
}

// ── messen ──────────────────────────────────────────────────────────────────

/**
 * Laesst das Versprechen laufen und sieht HOECHSTENS `GEDULD_MS` lang zu.
 * Der Rueckgabewert sagt, ob es von SELBST zu Ende kam.
 */
async function beobachten(versprechen) {
  const start = Date.now()
  let ende = null
  versprechen.then(
    () => {
      ende = { art: 'antwort', ms: Date.now() - start }
    },
    (fehler) => {
      ende = { art: 'fehler', ms: Date.now() - start, was: String((fehler && fehler.code) || fehler.message || fehler) }
    },
  )
  const schritt = 50
  for (let gewartet = 0; gewartet < GEDULD_MS && !ende; gewartet += schritt) {
    await new Promise((f) => setTimeout(f, schritt))
  }
  return ende || { art: 'laeuft-noch', ms: Date.now() - start }
}

function zeile(name, befund, bemerkung) {
  const wie = befund.art === 'laeuft-noch' ? `laeuft nach ${befund.ms} ms NOCH` : `${befund.art} nach ${befund.ms} ms`
  // DER FEHLERGRUND GEHOERT IMMER DAZU, nicht nur wenn sonst nichts dasteht:
  // `ENETUNREACH nach 0,5 s` und `ETIMEDOUT nach 130 s` sind zwei voellig
  // verschiedene Befunde, und welcher von beiden eintritt, haengt daran, ob
  // der Rechner noch eine Standardroute hat.
  const grund = befund.was ? `[${befund.was}] ` : ''
  console.log(`  ${name.padEnd(12)} ${wie.padEnd(34)} ${grund}${bemerkung || ''}`)
}

/**
 * DER PREIS IM ALLTAG — gemessen von der BOX aus, nicht von hier.
 *
 * NUR LESEND: ein `PUT /v1/me/player/pause` OHNE gueltigen Schluessel. Spotify
 * weist das mit 401 ab, BEVOR es irgendetwas anhaelt — gemessen wird also der
 * Weg (DNS, TLS, Antwort), nicht die Wirkung. Die Wiedergabe der Box bleibt
 * unberuehrt.
 */
async function vonDerBox(adresse) {
  const { execFile } = await import('node:child_process')
  const lauf = (befehl, args) =>
    new Promise((fertig) => {
      execFile(befehl, args, { timeout: 60000 }, (fehler, aus, err) =>
        fertig({ fehler, aus: String(aus || ''), err: String(err || '') }),
      )
    })
  // -o ConnectTimeout: haengt die Box, soll das WERKZEUG nicht haengen.
  const kommando =
    'for i in 1 2 3 4 5; do curl -s -o /dev/null -X PUT ' +
    '-w "%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_total}\\n" ' +
    '--max-time 20 https://api.spotify.com/v1/me/player/pause; done'
  const { aus, err } = await lauf('ssh', [
    '-o',
    'ConnectTimeout=6',
    '-o',
    'BatchMode=yes',
    `dietpi@${adresse}`,
    kommando,
  ])
  if (!aus.trim()) {
    console.log(`  box          keine Antwort von ${adresse} ${err.trim().slice(0, 80)}`)
    return
  }
  console.log(`  box ${adresse} — PUT /v1/me/player/pause OHNE Schluessel (401, haelt nichts an)`)
  console.log(`  ${'Runde'.padEnd(8)}${'Code'.padEnd(6)}${'DNS'.padEnd(9)}${'TCP'.padEnd(9)}${'TLS'.padEnd(9)}gesamt`)
  const gesamt = []
  aus
    .trim()
    .split('\n')
    .forEach((z, i) => {
      const [code, dns, tcp, tls, ges] = z.trim().split(/\s+/)
      gesamt.push(Number(ges))
      const ms = (s) => `${Math.round(Number(s) * 1000)} ms`
      console.log(
        `  ${String(i + 1).padEnd(8)}${String(code).padEnd(6)}${ms(dns).padEnd(9)}${ms(tcp).padEnd(9)}${ms(tls).padEnd(9)}${ms(ges)}`,
      )
    })
  const spitze = Math.max(...gesamt)
  console.log(`  Spitze im Alltag: ${Math.round(spitze * 1000)} ms\n`)
}

async function main() {
  console.log(`Zeitschranke von spotifyApi.pause() — Geduld ${GEDULD_MS} ms\n`)

  // Erst der Befund aus dem Quelltext. Er ist die Erklaerung fuer alles
  // Folgende und kostet keine Sekunde.
  const quelle = require('node:fs').readFileSync(
    require.resolve('spotify-web-api-node/src/http-manager'),
    'utf8',
  )
  const setztFrist = /\.timeout\s*\(/.test(quelle)
  console.log(`  Quelltext    http-manager.js ruft .timeout(): ${setztFrist ? 'JA' : 'NEIN'}`)
  console.log('               (NEIN heisst: superagent bekommt keine Frist, es entscheidet allein der Kern)\n')

  const laeuft = (name) => !NUR || NUR === name

  if (laeuft('erreichbar')) {
    const wirt = await wirtErreichbar()
    zeile('erreichbar', await beobachten(bibliotheksPut('127.0.0.1', wirt.port)), 'der Alltag')
    wirt.zu()
  }

  if (laeuft('stumm')) {
    const wirt = await wirtStumm()
    zeile('stumm', await beobachten(bibliotheksPut('127.0.0.1', wirt.port)), 'Verbindung steht, niemand antwortet')
    wirt.zu()
  }

  if (laeuft('fort')) {
    // TEST-NET-1 — garantiert nicht geroutet, RFC 5737.
    zeile('fort', await beobachten(bibliotheksPut('192.0.2.1', 443)), 'TEST-NET-1, kein Paket kommt an')
  }

  const box = wort('--box', '')
  if (box) {
    console.log('')
    await vonDerBox(box)
  }

  if (laeuft('schranke')) {
    const wirt = await wirtStumm()
    const start = Date.now()
    const ausgang = await mitZeitschranke(bibliotheksPut('127.0.0.1', wirt.port), SCHRANKE_MS)
    console.log(
      `  ${'schranke'.padEnd(12)} ${`${ausgang} nach ${Date.now() - start} ms`.padEnd(34)} derselbe stumme Wirt, mit ${SCHRANKE_MS} ms Schranke`,
    )
    wirt.zu()
  }

  console.log('')
}

main().then(
  () => process.exit(0),
  (fehler) => {
    console.error(fehler)
    process.exit(1)
  },
)
