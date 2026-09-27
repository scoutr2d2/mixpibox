#!/usr/bin/env node
/**
 * MEDIATHEKVIEW-PROBE — faehrt mixpi-mediathekview gegen den ECHTEN Dienst.
 *
 * WOZU, wenn es doch 26 Zeugen gibt: die fahren gegen `mvw.fixture.json`, also
 * gegen die Antwort VON EINEM TAG. Sie bleiben gruen, wenn der Dienst morgen
 * ein Feld umbenennt — genau dann, wenn es darauf ankommt.
 *
 * SIE FAEHRT DEN GANZEN WEG, nicht nur die Suche: suchen, eine Kennung
 * nehmen, sie wieder aufloesen, und die gefundene Adresse mit einem HEAD
 * anfassen. DAS IST DER PUNKT — die Kennung dieses Plugins ist der SUCHWEG
 * ZURUECK (der Dienst kennt kein Nachschlagen), und ob der traegt, zeigt sich
 * nur, wenn man ihn geht.
 *
 * SIE GEHOERT IN KEINEN LAEUFER: sie braucht das Internet und einen fremden
 * Dienst. Eine Wache, die rot wird, weil jemandes WLAN klemmt, lehrt niemanden
 * etwas. Von Hand fahren — vor dem Ausliefern, und wenn etwas klemmt.
 *
 * AUFRUF
 *     node tools/mediathekview-probe.mjs
 *     node tools/mediathekview-probe.mjs --begriff "Löwenzahn" --hoehe 540
 *     node tools/mediathekview-probe.mjs --anzahl 5
 *     node tools/mediathekview-probe.mjs --stufe klein
 *     node tools/mediathekview-probe.mjs --vorlage-erneuern
 *
 * `--vorlage-erneuern` schreibt `plugins/mixpi-mediathekview/mvw.fixture.json`
 * neu — danach `node --test` fahren und SEHEN, was rot wird. Das ist der
 * eigentliche Zweck: die Alterung der Vorlage sichtbar machen, statt sie zu
 * verstecken.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = path.join(WURZEL, 'plugins', 'mixpi-mediathekview')
const VORLAGE = path.join(PLUGIN, 'mvw.fixture.json')

const args = process.argv.slice(2)
function schalter(name, vorgabe = null) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
const begriff = schalter('--begriff', 'Sendung mit der Maus')
const hoehe = schalter('--hoehe', null)
const stufe = schalter('--stufe', null)
const erneuern = args.includes('--vorlage-erneuern')

/**
 * DER KONTEXT DES WIRTS, nachgebildet — aber ohne die Riegel.
 *
 * Richtig hier und falsch im Betrieb: `kontext.holen` des Wirts verwehrt die
 * eigene Box und haelt eine Frist. Diese Probe misst den DIENST, nicht den
 * Wirt; wer den Wirt messen will, nimmt `tools/plugin-pruefen.mjs`.
 */
const kontext = {
  protokoll: (s) => console.log(`   [plugin] ${s}`),
  einstellungen: Object.freeze({}),
  holen: (adresse, opt) => fetch(adresse, { ...opt, signal: AbortSignal.timeout(20000) }),
}

const plugin = (await import(path.join(PLUGIN, 'index.mjs'))).default
let fehler = 0

function sagen(gut, text) {
  if (!gut) fehler++
  console.log(`  ${gut ? 'ok  ' : 'FEHL'}  ${text}`)
}

console.log(`\n── mixpi-mediathekview gegen den echten Dienst ──\n`)

/* ══ 1. SUCHEN ═════════════════════════════════════════════════════════════ */

// DIE ZAHL IST DIE DER PROBE, NICHT DIE DES DIENSTES. Sie stand zuerst auf 8,
// und genau so sah die Ausgabe dann aus wie eine magere Quelle — „Sendung mit
// der Maus" hat 476 Treffer. Verstellbar ueber `--anzahl`.
const abfrageSuche = { begriff, anzahl: schalter('--anzahl', '24') }
if (hoehe) abfrageSuche.hoehe = hoehe
const ab = Date.now()
const suche = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: abfrageSuche }, kontext)
const msSuche = Date.now() - ab
const treffer = suche.inhalt?.treffer ?? []
sagen(
  (suche.status ?? 200) === 200 && treffer.length > 0,
  `Suche „${begriff}": ${treffer.length} von hoechstens ${abfrageSuche.anzahl} in ${msSuche} ms` +
    (suche.inhalt?.fehler ? ` — ${suche.inhalt.fehler}` : ''),
)
for (const t of treffer.slice(0, 5)) {
  console.log(`         ${(t.sender || '?').padEnd(9)} ${t.name.slice(0, 54)}`)
}

/* ══ 2. DENSELBEN TREFFER WIEDERFINDEN ════════════════════════════════════ */

if (treffer.length) {
  const erster = treffer[0]
  const abfrageVideo = {}
  if (hoehe) abfrageVideo.hoehe = hoehe
  if (stufe) abfrageVideo.stufe = stufe
  const antwort = await plugin.http(
    { methode: 'GET', pfad: `video/${encodeURIComponent(erster.kennung)}`, abfrage: abfrageVideo },
    kontext,
  )
  const video = antwort.inhalt ?? {}
  // DIESE ZEILE IST DER GRUND FUER DIE GANZE PROBE: findet der Weg zurueck
  // denselben Eintrag, oder hat der Dienst den Titel geaendert?
  sagen(
    video.ok === true,
    `Weg zurueck ueber die Kennung: ${video.ok ? `„${video.name}"` : `FEHLGESCHLAGEN (${video.grund ?? video.fehler})`}`,
  )
  if (video.ok) {
    sagen(true, `Stufe „${video.quelle.stufe}", Hoehe ${video.quelle.hoehe || 'unbekannt'}`)
    console.log(`         ${video.quelle.adresse}`)
    try {
      const kopf = await fetch(video.quelle.adresse, { method: 'HEAD', signal: AbortSignal.timeout(20000) })
      const art = kopf.headers.get('content-type') ?? '?'
      // `application/octet-stream` ist KEIN Fehler: KiKA antwortet so, und
      // Chromium schnueffelt. Es steht trotzdem da, damit es auffaellt.
      sagen(kopf.ok, `HEAD ${kopf.status} ${art}${art.includes('octet') ? '  (Chromium schnueffelt — am Geraet nachsehen)' : ''}`)
    } catch (f) {
      sagen(false, `HEAD scheiterte: ${f.message}`)
    }
  }
}

/* ══ 3. DER KNOPF AUS DER VERWALTUNG ══════════════════════════════════════ */

const befund = await plugin.aktion('pruefen', kontext)
sagen(befund.ok, `aktion("pruefen"): ${befund.text}`)

/* ══ 4. DIE VORLAGE, WENN JEMAND SIE WILL ═════════════════════════════════ */

if (erneuern) {
  const roh = async (felder, q, size) => {
    const a = await kontext.holen('https://mediathekviewweb.de/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ queries: [{ fields: felder, query: q }], sortBy: 'timestamp', sortOrder: 'desc', future: false, offset: 0, size }),
    })
    return await a.json()
  }
  const felder = [
    'channel', 'topic', 'title', 'description', 'timestamp', 'duration', 'size',
    'url_website', 'url_subtitle', 'url_video', 'url_video_low', 'url_video_hd', 'id',
  ]
  const kurz = (r) => ({ result: { results: (r?.result?.results ?? []).map((x) => Object.fromEntries(felder.map((f) => [f, x[f]]))) } })
  const neu = {
    _wozu: `Gekuerzte ECHTE Antwort von mediathekviewweb.de/api/query vom ${new Date().toISOString().slice(0, 10)}.`,
    suche: kurz(await roh(['topic', 'title'], 'Sendung mit der Maus', 8)),
    srf: kurz(await roh(['channel'], 'SRF', 2)),
    zdf: kurz(await roh(['channel'], 'ZDF', 3)),
  }
  writeFileSync(VORLAGE, `${JSON.stringify(neu, null, 2)}\n`)
  console.log(`\n  Vorlage erneuert: ${path.relative(WURZEL, VORLAGE)}`)
  console.log('  JETZT `node --test plugins/mixpi-mediathekview/index.spec.mjs` fahren und SEHEN, was rot wird.')
}

console.log(`\nBILANZ: ${fehler === 0 ? 'der ganze Weg traegt' : `${fehler} Auffaelligkeit(en)`}\n`)
process.exit(fehler === 0 ? 0 : 1)
