#!/usr/bin/env node
/**
 * VIDEOQUELLEN-PROBE — misst, WELCHE weitere Quelle ein Belohnungs-Video
 * liefern koennte, das der Kiosk-Browser OHNE Bibliothek abspielt.
 *
 * DIE FRAGE, DIE SIE BEANTWORTET, ist nicht „gibt es dort Videos" (ja, ueberall),
 * sondern die einzige, die fuer diesen Baum zaehlt:
 *
 *     Kommt am Ende eine progressive `video/mp4`-Adresse heraus — oder nur HLS?
 *
 * WARUM DAS ALLES ENTSCHEIDET: der Bildweg der Belohnungs-Videos ist ein
 * `<video>`-Element im Kiosk (llmwiki `mediathek-plugin-weiss-kern-zaehlt`).
 * Chromium spielt `application/vnd.apple.mpegurl` NICHT von sich aus; dafuer
 * braucht es hls.js im Kinderschirm. Eine Quelle, die nur HLS liefert, ist
 * deshalb kein kleiner Nachbau von mixpi-mediathek, sondern ein zweiter Bauteil.
 * Genau dieselbe Regel steht schon in `besteQuelle()` des Plugins.
 *
 * SIE GEHOERT IN KEINEN LAEUFER — wie `mediathek-probe.mjs` braucht sie das
 * Internet und drei fremde Dienste. Eine Wache, die rot wird, weil jemandes
 * WLAN klemmt, lehrt niemanden etwas.
 *
 * AUFRUF
 *     node tools/videoquellen-probe.mjs
 *     node tools/videoquellen-probe.mjs --sender ZDF,KiKA --begriff Maus
 *     node tools/videoquellen-probe.mjs --ohne-head    # nur Form, kein Abruf
 *
 * WAS SIE NICHT MISST: YouTube und Netflix. Bei beiden ist die Antwort keine
 * Messung, sondern eine Rechtslage — sie steht im Wissenspaket unter
 * `videoquellen-jenseits-der-ard`.
 */

const args = process.argv.slice(2)
function schalter(name, vorgabe = null) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
const senderListe = schalter('--sender', 'ARD,ZDF,KiKA,3Sat,ARTE.DE,SRF,ORF,Funk')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const begriff = schalter('--begriff', null)
const ohneHead = args.includes('--ohne-head')

/** Der oeffentliche Suchdienst von MediathekView — EIN Tor fuer alle Sender. */
const MVW = 'https://mediathekviewweb.de/api/query'

/**
 * WARUM `Content-Type: text/plain` UND KEIN JSON: der Dienst lehnt
 * `application/json` mit HTTP 400 ab (gemessen 20.09.2026). Der Rumpf IST
 * JSON — nur der Kopf luegt, und er muss es. Wer das nicht weiss, haelt den
 * Dienst fuer kaputt.
 */
async function fragen(rumpf) {
  const antwort = await fetch(MVW, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(rumpf),
    signal: AbortSignal.timeout(20000),
  })
  if (!antwort.ok) throw new Error(`MVW antwortet mit ${antwort.status}`)
  return await antwort.json()
}

/**
 * Die Form einer Adresse — und NUR sie.
 *
 * Es ist absichtlich der Pfad und nicht der `Content-Type`: die Entscheidung
 * faellt im Kinderschirm, bevor irgendetwas abgerufen wurde.
 */
export function form(adresse) {
  const s = String(adresse ?? '').split('?')[0].toLowerCase()
  if (!s) return 'nichts'
  if (s.endsWith('.m3u8')) return 'HLS'
  if (s.endsWith('.mpd')) return 'DASH'
  if (s.endsWith('.mp4')) return 'MP4'
  return 'unbekannt'
}

let fehler = 0
console.log(`Frage MediathekViewWeb nach ${senderListe.length} Sendern${begriff ? ` (Begriff „${begriff}")` : ''}\n`)

for (const sender of senderListe) {
  const queries = [{ fields: ['channel'], query: sender }]
  if (begriff) queries.push({ fields: ['title', 'topic'], query: begriff })
  let treffer = []
  try {
    const rumpf = await fragen({ queries, sortBy: 'timestamp', sortOrder: 'desc', future: false, offset: 0, size: 5 })
    treffer = rumpf?.result?.results ?? []
  } catch (f) {
    console.log(`  ${sender.padEnd(9)} FEHLER  ${f.message}`)
    fehler++
    continue
  }
  if (!treffer.length) {
    console.log(`  ${sender.padEnd(9)} LEER    keine Treffer`)
    fehler++
    continue
  }
  // Die Form je Treffer zaehlen: ein einzelner Treffer traegt kein Urteil ueber
  // einen ganzen Sender (siehe `einmal-hinsehen-ist-keine-messung`).
  const formen = {}
  for (const t of treffer) formen[form(t.url_video)] = (formen[form(t.url_video)] ?? 0) + 1
  const mp4 = treffer.find((t) => form(t.url_video) === 'MP4')
  const bilanz = Object.entries(formen)
    .map(([k, n]) => `${k}×${n}`)
    .join(' ')
  let kopf = ''
  if (mp4 && !ohneHead) {
    try {
      const a = await fetch(mp4.url_video, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
      kopf = `  → HEAD ${a.status} ${a.headers.get('content-type') ?? '?'}`
      if (!a.ok) fehler++
    } catch (f) {
      kopf = `  → HEAD scheiterte: ${f.message}`
      fehler++
    }
  }
  const urteil = mp4 ? 'SPIELBAR' : 'NUR HLS/DASH — braucht hls.js'
  console.log(`  ${sender.padEnd(9)} ${urteil.padEnd(28)} ${bilanz}${kopf}`)
}

console.log(
  `\nBILANZ: ${fehler === 0 ? 'alle gefragten Sender geantwortet' : `${fehler} Auffaelligkeit(en)`} — ` +
    'SPIELBAR heisst: eine progressive MP4-Adresse, die ein <video> ohne Bibliothek nimmt.',
)
process.exit(fehler === 0 ? 0 : 1)
