#!/usr/bin/env node
// ton-vollmacht-probe.mjs — traegt das Ton-Login-Token auch die Web-API?
//
// DIE FRAGE DAHINTER (Betreiber, 14.08.2026): "wir melden uns ja einmal an
// [...] finden wir den keinen weg das fuer librespot zu verwenden" — die Box
// verlangt heute ZWEI Anmeldungen: die Web-API (eigene Client-ID, PKCE,
// freshSpotifyCreds im backend-player) und den Ton (librespot, Spotifys
// gesegneter Client TONLOGIN_CLIENT). Die Richtung "eigene Client-ID ->
// librespot" ist serverseitig zu (nur gesegnete Clients kommen an den
// Audio-Strom). Diese Probe misst die GEGENRICHTUNG: der Geraete-Code-Login
// (spotify.com/pair) holt ein Token des gesegneten Clients, und
// TONLOGIN_RECHTE fragt schon heute user-modify/read-playback-state an.
//
// MESSSTAND NACH ZWEI LAEUFEN (14.08.2026):
//   * Rechte: Spotify GEWAEHRT dem gesegneten Client am Geraete-Code-Endpunkt
//     sogar playlist-read-private und user-library-read. Kein Rechte-Problem.
//   * Auffrischen ohne Secret: GRUEN (wie pkceRefreshApi).
//   * ABER: alle sechs Lese-Endpunkte 429. Retry-After zaehlte 59->52 s
//     herunter (rollendes ~60-s-Fenster), war aber schon VOR der ersten
//     eigenen Anfrage voll, und einmal 15 s warten leerte es nicht.
//   * Offen ist nur noch: teilen sich ALLE Nutzer dieses Clients das Fenster
//     (Weltkontingent -> Weg tot) oder ist das eigene Budget bloss winzig?
//     Das misst der --takt-Modus: 70 s Funkstille, dann GENAU EINE Anfrage;
//     wenn gruen, zaehlen bis zur ersten 429.
//
// AUFRUFE
//   --nur-annahme        nimmt accounts.spotify.com die Rechte-Saetze an?
//                        (Code wird geholt, nie eingeloest; kein Mensch noetig)
//   (ohne Schalter)      Koppeln + nur-lesende Batterie + Refresh-Beweis
//   --takt               Koppeln + 70 s Stille + Einzelanfrage + Budget zaehlen
//   --merken <datei>     Auffrisch-Token in <datei> ablegen (chmod 600) —
//                        NUR auf ausdruecklichen Wunsch, fuer Folgemessungen
//                        ohne erneutes Koppeln. Gehoert in die Sitzungs-
//                        Ablage, NIE ins Repo.
//   --gemerkt <datei>    statt Koppeln: Token aus <datei> auffrischen
//
// Die Probe steuert NIE etwas (kein play/pause/volume) und gibt keine Token
// auf der Konsole aus. Die Box wird nicht angefasst.

import fs from 'node:fs'

const CLIENT = '65b708073fc0480ea92a077233ca87bd' // TONLOGIN_CLIENT (server.ts)

const RECHTE_HEUTE =
  'streaming user-read-email user-read-private app-remote-control ' +
  'user-modify-playback-state user-read-playback-state'
const RECHTE_ERWEITERT = `${RECHTE_HEUTE} playlist-read-private user-library-read`

const ruhen = (ms) => new Promise((r) => setTimeout(r, ms))

function schalterWert(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

async function codeHolen(scope) {
  const a = await fetch('https://accounts.spotify.com/oauth2/device/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT, scope }).toString(),
  })
  const d = await a.json().catch(() => null)
  return { status: a.status, d }
}

async function stufe1() {
  let befund = 0
  for (const [name, scope] of [
    ['heutige Ton-Rechte', RECHTE_HEUTE],
    ['erweitert (+playlist-read-private +user-library-read)', RECHTE_ERWEITERT],
  ]) {
    const { status, d } = await codeHolen(scope)
    const ok = status === 200 && d?.device_code && d?.user_code
    console.log(`${ok ? 'ANGENOMMEN' : `ABGELEHNT (${status}: ${d?.error_description || d?.error || '?'})`}  — ${name}`)
    if (!ok) befund = 1
  }
  return befund
}

/** Koppeln ueber spotify.com/pair; gibt {access_token, refresh_token, scope} oder null. */
async function koppeln() {
  let scope = RECHTE_ERWEITERT
  let { status, d } = await codeHolen(scope)
  if (!(status === 200 && d?.device_code)) {
    scope = RECHTE_HEUTE
    ;({ status, d } = await codeHolen(scope))
    if (!(status === 200 && d?.device_code)) {
      console.log(`Kein Code zu bekommen (${status}). Ende.`)
      return null
    }
  }
  const endet = Date.now() + (d.expires_in || 600) * 1000
  const takt = Math.max(5, d.interval || 5) * 1000
  console.log(`CODE: ${d.user_code}`)
  console.log(`Eintippen auf ${d.verification_uri || 'https://spotify.com/pair'} (gilt ${Math.round((endet - Date.now()) / 60000)} min)`)
  console.log(`Angefragt: ${scope}\n`)
  while (Date.now() < endet) {
    await ruhen(takt)
    const a = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: d.device_code,
      }).toString(),
    })
    const t = await a.json().catch(() => null)
    if (a.ok && t?.access_token) return t
    if (t?.error && t.error !== 'authorization_pending' && t.error !== 'slow_down') {
      console.log(`Spotify beendet den Anlauf: ${t.error}. Ende.`)
      return null
    }
  }
  console.log('Code ist verfallen, niemand hat ihn eingeloest. Ende.')
  return null
}

async function auffrischen(refreshToken) {
  const a = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })
  const t = await a.json().catch(() => null)
  return a.ok && t?.access_token ? t : null
}

/** Koppeln ODER aus gemerkter Datei auffrischen; auf Wunsch merken. */
async function tokenBesorgen() {
  const gemerkt = schalterWert('--gemerkt')
  let token = null
  if (gemerkt) {
    const roh = JSON.parse(fs.readFileSync(gemerkt, 'utf8'))
    token = await auffrischen(roh.refresh_token)
    if (!token) { console.log('Gemerktes Token liess sich nicht auffrischen. Ende.'); return null }
    token.refresh_token ||= roh.refresh_token
    console.log('Token aus der Merkdatei aufgefrischt.')
  } else {
    token = await koppeln()
    if (!token) return null
    console.log(`EINGELOEST. Gewaehrte Rechte: ${token.scope || '(keine Angabe)'}`)
    console.log(`Refresh-Token dabei: ${token.refresh_token ? 'JA' : 'NEIN'}`)
  }
  const merken = schalterWert('--merken')
  if (merken && token.refresh_token) {
    fs.writeFileSync(merken, JSON.stringify({ refresh_token: token.refresh_token }), { mode: 0o600 })
    console.log(`Auffrisch-Token abgelegt: ${merken} (Rechte 600)`)
  }
  console.log('')
  return token
}

async function anfrage(accessToken, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  return { status: r.status, frist: Number(r.headers.get('retry-after') || '') }
}

const BATTERIE = [
  ['GET /v1/me                (user-read-private)', 'https://api.spotify.com/v1/me'],
  ['GET /v1/me/player/devices (user-read-playback-state)', 'https://api.spotify.com/v1/me/player/devices'],
  ['GET /v1/me/player         (user-read-playback-state)', 'https://api.spotify.com/v1/me/player'],
  ['GET /v1/search            (ohne Nutzer-Recht)', 'https://api.spotify.com/v1/search?q=hoerspiel&type=album&limit=1'],
  ['GET /v1/me/playlists      (playlist-read-private)', 'https://api.spotify.com/v1/me/playlists?limit=1'],
  ['GET /v1/me/albums         (user-library-read)', 'https://api.spotify.com/v1/me/albums?limit=1'],
]

async function stufe2() {
  const token = await tokenBesorgen()
  if (!token) return 1
  let rot = 0
  let schonGewartet = false
  for (const [name, url] of BATTERIE) {
    let r = await anfrage(token.access_token, url)
    if (r.status === 429 && !schonGewartet && Number.isFinite(r.frist) && r.frist > 0 && r.frist <= 45) {
      console.log(`      … 429 mit Retry-After ${r.frist}s — warte einmal und wiederhole`)
      schonGewartet = true
      await ruhen((r.frist + 1) * 1000)
      r = await anfrage(token.access_token, url)
    }
    const ok = r.status === 200 || r.status === 204
    const zusatz = r.status === 429 ? ` Retry-After=${Number.isFinite(r.frist) ? `${r.frist}s` : '(fehlt)'}` : ''
    console.log(`${ok ? 'GRUEN' : `ROT (${r.status})${zusatz}`}  ${name}`)
    if (!ok && r.status !== 404) rot++
    await ruhen(1200)
  }
  if (token.refresh_token) {
    const t = await auffrischen(token.refresh_token)
    console.log(`${t ? 'GRUEN' : 'ROT'}  Auffrischen ohne Secret (der pkceRefreshApi-Weg)`)
    if (!t) rot++
  }
  console.log(rot === 0
    ? '\nBEFUND: EIN Login traegt beides — der Geraete-Code deckt Ton UND Web-API.'
    : `\nBEFUND: ${rot} rote Stelle(n) — Einzelheiten oben.`)
  return rot === 0 ? 0 : 1
}

// Das Entscheidungsexperiment: ist das 60-s-Fenster UNSERES oder das der Welt?
async function taktMessung() {
  const token = await tokenBesorgen()
  if (!token) return 1
  const ziel = 'https://api.spotify.com/v1/me/player/devices'

  console.log('70 s Funkstille — kein einziger api.spotify.com-Aufruf …')
  await ruhen(70_000)

  let r = await anfrage(token.access_token, ziel)
  console.log(`Einzelanfrage nach Stille: ${r.status}${r.status === 429 ? ` (Retry-After ${r.frist}s)` : ''}`)

  if (r.status === 429) {
    // Noch einmal, mit doppelter Stille — erst zwei Rote nach echter Ruhe
    // sind der Beweis, dass FREMDE das Fenster fuellen.
    console.log('120 s Funkstille, zweiter Versuch …')
    await ruhen(120_000)
    r = await anfrage(token.access_token, ziel)
    console.log(`Einzelanfrage nach laengerer Stille: ${r.status}${r.status === 429 ? ` (Retry-After ${r.frist}s)` : ''}`)
    if (r.status === 429) {
      console.log('\nBEFUND: WELTKONTINGENT. Das Fenster ist voll, ohne dass wir es fuellen —')
      console.log('alle Nutzer des gesegneten Clients teilen sich die Web-API-Rate.')
      console.log('Der Ein-Login-Weg ueber diesen Client ist damit TOT, gemessen, nicht gefuehlt.')
      return 1
    }
  }

  console.log('Budget zaehlen: 1 Anfrage/s bis zur ersten 429 (Deckel 40) …')
  let gruene = r.status === 200 || r.status === 204 ? 1 : 0
  for (let i = 0; i < 40; i++) {
    await ruhen(1000)
    const w = await anfrage(token.access_token, ziel)
    if (w.status === 429) {
      console.log(`Erste 429 nach insgesamt ${gruene} gruenen Anfragen (Retry-After ${w.frist}s).`)
      console.log(`\nBEFUND: eigenes Budget von ~${gruene} Anfragen je Fenster. Zum Vergleich: die`)
      console.log('Box fragt im Betrieb alle 2 s den Spielstand ab — das Budget muss dazu passen.')
      return 0
    }
    gruene++
  }
  console.log(`Kein 429 in ${gruene} Anfragen — Budget reicht fuer mindestens 1/s.`)
  console.log('\nBEFUND: EIN Login truege beides; die 429 vom ersten Lauf waren selbstgemacht.')
  return 0
}

const modus = process.argv.includes('--nur-annahme') ? stufe1
  : process.argv.includes('--takt') ? taktMessung
  : stufe2
process.exit(await modus())
