#!/usr/bin/env node
/**
 * KINDERNACHRICHTEN-PROBE — faehrt mixpi-kindernachrichten gegen die ECHTEN
 * Feeds (WDR, ZDF, Deutschlandfunk Kultur, GEOlino).
 *
 * WOZU, wenn es doch Zeugen gibt: die Zeugen fahren gegen `*.fixture.xml`,
 * also gegen die Form der Feeds VON EINEM TAG (28.09.2026). Sie bleiben gruen,
 * wenn der WDR morgen die Adresse umzieht, logo! die guid wechselt oder
 * GEOlino die Tonadressen anders verpackt — genau dann, wenn es darauf
 * ankommt. Diese Probe ist die Gegenfrage dazu: stimmt die Form noch, und
 * spielt, was herauskommt?
 *
 * GEFAHREN WIRD DAS ECHTE PLUGIN (import aus plugins/…/index.mjs) mit einem
 * Kontext aus echtem `fetch` — keine Nachbildung des Lesers. Je Quelle:
 *   * erreichbar? (ueber `http quelle/<schluessel>`, mit Antwortzeit)
 *   * Folgen im Feed, neueste Folge und ihr Datum, bei Nachrichten: wie viele frisch
 *   * HEAD auf die erste Tonadresse: Status und content-type. Umleitungen
 *     werden verfolgt: GEOlino leitet JE NACH ABSPIELER um — gemessen am
 *     28.09.2026 bekamen curl und die Kennung von mpv ein 302 auf eine
 *     Adresse mit `listeningSessionID`, Node-fetch direkt ein 200. Diese
 *     Probe sieht also nicht denselben Weg wie mpv auf der Box, nur dasselbe
 *     Ziel.
 * Dann `inhalt('heute')` zweimal, mit geleertem Speicher dazwischen: beide
 * Male dieselben Kennungen, sonst verliert die Box ihre gemerkte Stelle.
 *
 * SIE HAENGT BEWUSST IN KEINEM LAEUFER (nicht in doku-luecken-probe.sh, nicht
 * in pruefen.sh): sie braucht das Internet und vier fremde Dienste. Eine
 * Wache, die rot wird, weil jemandes WLAN klemmt, lehrt niemanden etwas —
 * dieselbe Begruendung wie bei tools/mediathek-probe.mjs. Gefahren wird sie
 * von Hand: vor dem Ausliefern, und wenn eine Kachel leer oder stumm ist.
 *
 * AUFRUF
 *     node tools/kindernachrichten-probe.mjs
 *     node tools/kindernachrichten-probe.mjs --frische 0     # nur von heute
 *
 * Am Ende steht EINE Bilanzzeile; Rueckgabe 0 heisst gruen, 1 rot. Eine leere
 * Kachel „Nachrichten von heute" ist KEIN Befund — am Wochenende nach einem
 * Feiertag kann das die Wahrheit sein —, sie wird aber als Hinweis genannt,
 * weil die Stabilitaetsfrage dann nichts pruefen konnte.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = path.join(WURZEL, 'plugins', 'mixpi-kindernachrichten', 'index.mjs')

const args = process.argv.slice(2)
const frischeIndex = args.indexOf('--frische')
const einstellungen = frischeIndex >= 0 ? { frischeTage: Number(args[frischeIndex + 1]) } : {}

/**
 * DER KONTEXT DES WIRTS, nachgebildet — ohne die Riegel. Das ist hier richtig
 * und waere im Betrieb falsch: diese Probe misst die Feeds, nicht den Wirt.
 * Wer den Wirt messen will, nimmt `npx tsx tools/plugin-pruefen.mjs
 * plugins/mixpi-kindernachrichten --aufloesen heute`.
 */
const kontext = {
  protokoll: (s) => console.log(`        [plugin] ${s}`),
  einstellungen: Object.freeze(einstellungen),
  holen: (adresse, gaben) => fetch(adresse, { ...gaben, signal: AbortSignal.timeout(15000) }),
}

const modul = await import(PLUGIN)
const plugin = modul.default
const { QUELLEN, zwischenspeicherLeeren } = modul

let befunde = 0
let hinweise = 0
function sagen(gut, text) {
  console.log(`  ${gut ? 'ok  ' : 'FEHL'}  ${text}`)
  if (!gut) befunde++
}
function hinweis(text) {
  console.log(`  HINW  ${text}`)
  hinweise++
}
const tag = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : 'ohne Datum')

console.log(`── mixpi-kindernachrichten gegen die echten Feeds (${new Date().toISOString()}) ──`)
zwischenspeicherLeeren()

let erreichbar = 0
let spielbar = 0
for (const q of QUELLEN) {
  console.log(`\n  ${q.name} (${q.sender}, ${q.art})`)
  const ab = Date.now()
  let a
  try {
    // Ein Feed, der nicht antwortet, kommt als 502 MIT GRUND zurueck (unten
    // gemeldet); ein Wurf hier waere ein Fehler des Plugins selbst.
    a = await plugin.http({ methode: 'GET', pfad: `quelle/${q.schluessel}`, abfrage: {}, rumpf: null }, kontext)
  } catch (f) {
    sagen(false, `nicht erreichbar: ${f.message}`)
    continue
  }
  const ms = Date.now() - ab
  const status = a.status ?? 200
  if (status !== 200) {
    sagen(false, `HTTP-Flaeche antwortet ${status} — ${a.inhalt?.fehler ?? '?'}`)
    continue
  }
  erreichbar++
  const s = a.inhalt.stand[0]
  sagen(true, `erreichbar, ${ms} ms`)
  // DERSELBE DECKEL WIE IM WIRT (HTTP_ANTWORT_HOECHSTENS in plugin-vertrag.ts,
  // dort gemessen als JSON.stringify(...).length): darueber zeigte die
  // Verwaltung statt der Uebersicht „Antwort zu gross".
  const zeichen = JSON.stringify(a.inhalt).length
  sagen(zeichen <= 256 * 1024, `Uebersicht ${Math.round(zeichen / 1024)} KB von hoechstens 256 KB`)
  sagen(s.imFeed > 0, `${s.imFeed} Folgen mit Ton im Feed`)
  if (s.neueste) {
    console.log(`        neueste: „${s.neueste.name}" vom ${tag(s.neueste.datum)}`)
  }
  if (q.art === 'nachrichten') {
    console.log(
      `        frisch (hoechstens ${a.inhalt.frischeTage} Tage): ${s.frisch}, in der Kachel: ${a.inhalt.folgen.length}`,
    )
    if (a.inhalt.leer) hinweis(a.inhalt.leer)
  }

  // Die Tonadresse der ersten Folge, die die Kachel zeigt — sonst die
  // neueste im Feed, damit auch eine leere Nachrichtenkachel geprueft wird.
  const ton = a.inhalt.folgen[0]?.adresse ?? s.neueste?.adresse
  if (!ton) {
    sagen(false, 'keine einzige Folge mit Ton — es gibt nichts zu spielen')
    continue
  }
  sagen(!/&amp;/.test(ton), `Tonadresse ohne &amp;: ${ton.length > 90 ? `${ton.slice(0, 87)}…` : ton}`)
  try {
    const h = await fetch(ton, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) })
    const typ = h.headers.get('content-type') ?? ''
    const umgeleitet = h.redirected ? ' (nach Umleitung)' : ''
    const gut = h.ok && /^audio\//i.test(typ)
    if (gut) spielbar++
    sagen(gut, `HEAD erste Tonadresse: ${h.status} ${typ || 'ohne content-type'}${umgeleitet}`)
  } catch (f) {
    sagen(false, `HEAD erste Tonadresse scheiterte: ${f.message}`)
  }
}

// ── Nachrichten von heute: zweimal, mit leerem Speicher dazwischen ──────────
console.log('\n  Nachrichten von heute')
let heuteZahl = 0
let stabil = false
try {
  zwischenspeicherLeeren()
  const erst = await plugin.inhalt('heute', kontext)
  zwischenspeicherLeeren()
  const zweit = await plugin.inhalt('heute', kontext)
  heuteZahl = erst.folgen.length
  for (const f of erst.folgen) console.log(`        ${f.name} (${f.dauerSek ?? '?'} s) — ${f.kennung}`)
  const schluessel = (i) => JSON.stringify(i.folgen.map((f) => [f.kennung, f.name, f.quelle.adresse]))
  stabil = schluessel(erst) === schluessel(zweit)
  sagen(stabil, stabil ? 'zweimal geholt, zweimal dieselbe Liste' : 'zwei Abrufe, zwei verschiedene Listen')
  sagen(
    erst.folgen.every((f) => String(f.kennung ?? '').trim()),
    'jede Folge traegt eine Kennung (ohne sie uebergeht der Kern sie STILL)',
  )
  if (heuteZahl === 0) hinweis('„Nachrichten von heute" ist gerade leer — die Stabilitaet hat nichts geprueft')
} catch (f) {
  sagen(false, `inhalt('heute') scheiterte: ${f.message}`)
}

const urteil = befunde === 0 ? 'GRUEN' : `ROT (${befunde} Befund${befunde === 1 ? '' : 'e'})`
const hinw = hinweise ? `, ${hinweise} Hinweis${hinweise === 1 ? '' : 'e'}` : ''
console.log(
  `\nBILANZ: ${erreichbar}/${QUELLEN.length} Quellen erreichbar, ${spielbar}/${QUELLEN.length} Tonadressen spielbar, ` +
    `heute ${heuteZahl} Folge${heuteZahl === 1 ? '' : 'n'}${stabil ? ' stabil' : ''}${hinw} — ${urteil}`,
)
process.exit(befunde === 0 ? 0 : 1)
