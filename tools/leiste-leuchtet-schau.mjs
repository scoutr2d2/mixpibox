#!/usr/bin/env node
/**
 * LEUCHTET AUF JEDER SEITE DER VERWALTUNG DER RICHTIGE LEISTENEINTRAG?
 *
 * WOFUER: Am 05.08.2026 wurde die Kopfleiste in vier Gruppen geteilt und der
 * Elternreiter „Medien" auf ein gerechnetes `[class.hier]` umgestellt, damit
 * er auf seinen Unterseiten mitleuchtet. Beides sind Aenderungen, deren
 * Fehlschlag STILL ist: eine Leiste, in der nichts angewaehlt ist, sieht aus
 * wie eine Leiste. Der Umbau selbst ist genau darin zweimal steckengeblieben
 * (erst leuchtete `/` nicht, dann `/medien` gar nicht mehr), und beide Male
 * war alles gruen — kein Test der Verwaltung sieht eine gezeichnete Klasse.
 *
 * tools/verwaltung-wege-schau.mjs prueft die BEHAUPTUNG (UNTERSEITE_VON gegen
 * die erhobene Elternschaft). Es kann nicht sehen, was Angular daraus macht:
 * `routerLinkActive="hier"` und `[class.hier]="…"` am selben Element schreiben
 * dieselbe Klasse, und die Bindung loescht, was die Direktive setzt. Das ist
 * nur im Browser messbar. Hier wird es gemessen.
 *
 * WAS ES PRUEFT — je Weg der Verwaltung genau eine Frage: welche Eintraege der
 * Kopfleiste tragen die Klasse `hier`?
 *   1. GENAU EINER leuchtet. Keiner heisst: man steht in einer Verwaltung,
 *      die nicht sagt, wo man ist. Zwei heissen: sie sagt es falsch.
 *   2. ES IST DER RICHTIGE. Auf einem Leisteneintrag er selbst; auf einer
 *      Unterseite ihr Elternteil aus UNTERSEITE_VON (rahmen.ts) — gelesen,
 *      nicht hier noch einmal hingeschrieben.
 *   3. DER RUECKWEG IST DA UND KLICKBAR. Auf jeder Unterseite ein sichtbarer
 *      Verweis auf die Elternseite — und er wird ANGEKLICKT, nicht nur
 *      gefunden. Danach steht man auf der Elternseite, und dort leuchtet sie.
 *
 * DIE GEGENPROBE IST PFLICHT (llmwiki attrappe-luegt-durch-weglassen): eine
 * Messung, die „genau einer leuchtet" sagt, ist nichts wert, solange nicht
 * dieselbe Messung an einem erfundenen Weg zeigt, dass sie auch KEINEN sehen
 * kann. Deshalb faehrt sie zum Schluss /gibtesnicht an und verlangt dort
 * genau den Leisteneintrag der Uebersicht (dorthin schickt der **-Zweig).
 *
 * ES BAUT SELBST, und das ist keine Bequemlichkeit. Ein vorhandenes
 * src/deploy/www-admin ist der Stand von IRGENDWANN; misst man den, meldet die
 * Pruefung „leuchtet richtig" ueber eine Leiste, die es im Quelltext gar nicht
 * mehr gibt. Genau die Sorte gruen, gegen die dieses Werkzeug antritt. Gebaut
 * wird deshalb bei jedem Lauf in ein eigenes Verzeichnis unter dem
 * Systemzwischenspeicher — src/deploy bleibt unberuehrt.
 *
 * WAS ES AENDERT: nichts am Bestand. Es baut in ein Wegwerf-Verzeichnis,
 * liefert das auf der Rueckschleife aus und leitet /api an
 * tools/neu-vorschau.mjs weiter. Keine Box, keine Nutzerdatei.
 *
 * AUFRUF
 *     node tools/leiste-leuchtet-schau.mjs             # Tabelle
 *     node tools/leiste-leuchtet-schau.mjs --pruefen   # Ende 1 bei Abweichung
 */
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'
import { kopfleiseLesen } from './verwaltung-suchbestand.mjs'
import { elternBehauptungLesen } from './verwaltung-wege-schau.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, '..')
const RAHMEN = join(WURZEL, 'src/frontend-admin/src/app/rahmen.ts')
const PRUEFEN = process.argv.includes('--pruefen')

/** Wo die Attrappe lauscht — derselbe Vorgabeport wie in neu-vorschau.mjs. */
const ATTRAPPE = 'http://127.0.0.1:8299'
/** Eigener Port fuer die Rueckschleife, damit eine laufende Vorschau nicht gestoert wird. */
const PORT = 8311

// VOR dem Bau nachsehen, ob es ueberhaupt einen Browser gibt: der Bau kostet
// Minuten, und ohne Browser gaebe es danach nichts zu messen.
if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

// ── Frisch bauen, in ein Verzeichnis, das uns gehoert ────────────────────────

const BAUORT = mkdtempSync(join(tmpdir(), 'leiste-leuchtet-'))
// DIREKT das Programm, nicht `npx ng`: dieser Baum ist ein npm-Arbeitsbereich
// mit einem Skript namens `ng`, und npx ruft dann das SKRIPT auf statt des
// Programms — es schluckt `--output-path` und baut nach src/deploy. Genau das
// waere hier der stille Fehler: gebaut wird, gemessen wird trotzdem woanders.
const NG = join(WURZEL, 'node_modules/.bin/ng')
const bau = spawnSync(NG, ['build', '--output-path', BAUORT], {
  cwd: join(WURZEL, 'src/frontend-admin'),
  encoding: 'utf8',
  timeout: 300_000,
})
// Der Exitcode allein genuegt nicht — dieselbe Regel wie in tools/pruefen.sh:
// ein Bau kann 0 melden und die Datei nicht geschrieben haben.
//
// UND DER ORT WIRD GESUCHT, NICHT ANGENOMMEN: angular.json setzt
// `outputPath.browser` auf "" (die Dateien liegen dann flach). `--output-path`
// ersetzt die ganze Angabe durch eine Zeichenkette, und damit kehrt der
// Vorgabewert `browser/` zurueck. Wer hier den Pfad hinschreibt, misst je nach
// Angular-Fassung ein leeres Verzeichnis.
const WWW = [BAUORT, join(BAUORT, 'browser')].find((d) => existsSync(join(d, 'index.html')))
if (!WWW) {
  console.error(`  Bau fehlgeschlagen — keine index.html unter ${BAUORT}`)
  console.error((bau.stderr || bau.stdout || '').split('\n').slice(-15).join('\n'))
  rmSync(BAUORT, { recursive: true, force: true })
  process.exit(1)
}

// ── Was gemessen werden soll, kommt aus dem Quelltext ────────────────────────

const kopfleiste = kopfleiseLesen()
const elternVon = elternBehauptungLesen(RAHMEN) ?? {}

/** Weg -> welcher Leisteneintrag dort leuchten MUSS (als Name). */
const soll = new Map()
for (const k of kopfleiste) soll.set(k.weg, k.name)
for (const [weg, elternWeg] of Object.entries(elternVon)) {
  const name = kopfleiste.find((k) => k.weg === elternWeg)?.name
  if (name) soll.set(weg, name)
}

// ── Die Vorschau: gebaute Dateien + /api an die Attrappe ─────────────────────

// EINE SCHON LAUFENDE ATTRAPPE WIRD GELIEHEN — UND ZURUECKGELEGT. Laeuft
// keine, startet vorschauLeihen selbst eine auf dem Port aus ATTRAPPE und
// beendet sie mit zurueckgeben(). Warum das an EINER Stelle liegt, statt hier
// abgeschrieben zu stehen: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ATTRAPPE)

const TYP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  // Die Wache schickt ohne diese Antwort JEDE Seite auf /anmeldung — dieselbe
  // eine Ausnahme wie in tools/verwaltung-vorschau.mjs, und aus demselben Grund.
  if (url.pathname === '/api/auth/state') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ angemeldet: true, anmeldungNoetig: false }))
    return
  }
  if (url.pathname.startsWith('/api')) {
    try {
      const a = await fetch(`${ATTRAPPE}${url.pathname}${url.search}`, { signal: AbortSignal.timeout(4000) })
      res.statusCode = a.status
      res.setHeader('Content-Type', a.headers.get('content-type') ?? 'application/json')
      res.end(Buffer.from(await a.arrayBuffer()))
    } catch {
      res.statusCode = 502
      res.end('{}')
    }
    return
  }
  // Alles unter /admin/ ist die gebaute Oberflaeche; was keine Datei ist, ist
  // eine Route und bekommt die index.html (derselbe Vertrag wie auf der Box).
  const rein = normalize(url.pathname.replace(/^\/admin/, '')).replace(/^(\.\.[/\\])+/, '')
  const datei = join(WWW, rein)
  if (rein !== '/' && existsSync(datei) && !datei.endsWith('/')) {
    res.setHeader('Content-Type', TYP[extname(datei)] ?? 'application/octet-stream')
    createReadStream(datei).pipe(res)
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(readFileSync(join(WWW, 'index.html')))
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

// ── Der Browser ──────────────────────────────────────────────────────────────
//
// Auf einem FREIEN Port mit eigenem Profil statt auf einer festen Nummer, die
// ein Ueberlebender eines harten Abbruchs noch halten koennte — /json/list
// liefert dann klaglos die Ziele des fremden. Die Messungen dahinter:
// tools/leihgabe.mjs.
const brw = await eigenerBrowser({ fenster: '1440,900' }).catch(async (e) => {
  // Auch auf dem roten Weg alles zuruecklegen und wegraeumen, was schon steht.
  await leihe.zurueckgeben()
  server.close()
  rmSync(BAUORT, { recursive: true, force: true })
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  // browserSuchen() oben hat einen gefunden — fehlt er JETZT trotzdem, gilt
  // dieselbe Antwort wie oben: ueberspringen, aber Geliehenes zurueck.
  await leihe.zurueckgeben()
  server.close()
  rmSync(BAUORT, { recursive: true, force: true })
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let lfd = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  BEFUND  ${z}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(32)} ${wert}`)

try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  /** Welche Leisteneintraege leuchten GERADE — der gezeichnete Zustand. */
  const leuchtend = () => ev(`[...document.querySelectorAll('nav a.hier')].map((a) => a.textContent.trim())`)

  /** Auf welchem Weg steht der Browser gerade (ohne /admin-Praefix). */
  const wegJetzt = () => ev(`location.pathname.replace(/^\\/admin/, '') || '/'`)

  const hin = async (weg) => {
    await send(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/admin${weg === '/' ? '/' : weg}` })
    await warte(1100)
  }

  console.log(`Kopfleiste: ${kopfleiste.length} Eintraege · Unterseiten: ${Object.keys(elternVon).length}`)

  // ── 1./2. Auf jedem Weg leuchtet genau der richtige Eintrag ───────────────
  for (const [weg, name] of soll) {
    await hin(weg)
    const an = (await leuchtend()) ?? []
    const ok = an.length === 1 && an[0] === name
    zeile(
      weg,
      ok ? `leuchtet „${name}"` : `leuchtet ${an.length === 0 ? 'NICHTS' : an.map((x) => `„${x}"`).join(' + ')}`,
    )
    if (!ok) melde(`${weg}: erwartet genau „${name}", gezeichnet ${an.length === 0 ? 'nichts' : an.join(' + ')}`)
  }

  // ── 3. Der Rueckweg jeder Unterseite wird ANGEKLICKT ──────────────────────
  for (const [weg, elternWeg] of Object.entries(elternVon)) {
    await hin(weg)
    const geklickt = await ev(
      `(() => {
         const a = [...document.querySelectorAll('main a')]
           .find((x) => x.getAttribute('href') === '/admin${elternWeg}' || x.getAttribute('href') === '${elternWeg}')
         if (!a) return 'kein Rueckweg im Inhalt'
         const r = a.getBoundingClientRect()
         if (r.width === 0 || r.height === 0) return 'Rueckweg unsichtbar'
         a.click()
         return 'ok'
       })()`,
    )
    if (geklickt !== 'ok') {
      zeile(`${weg} → ${elternWeg}`, geklickt)
      melde(`${weg}: ${geklickt}`)
      continue
    }
    await warte(900)
    const nun = await wegJetzt()
    const an = (await leuchtend()) ?? []
    const name = kopfleiste.find((k) => k.weg === elternWeg)?.name
    const ok = nun === elternWeg && an.length === 1 && an[0] === name
    zeile(`${weg} → zurueck`, ok ? `${nun}, leuchtet „${name}"` : `${nun}, leuchtet ${an.join(' + ') || 'NICHTS'}`)
    if (!ok) melde(`Rueckweg von ${weg}: gelandet auf ${nun}, gezeichnet ${an.join(' + ') || 'nichts'}`)
  }

  // ── Gegenprobe: kann die Messung ueberhaupt etwas anderes sehen? ──────────
  await hin('/gibtesnicht')
  const irr = (await leuchtend()) ?? []
  const uebersicht = kopfleiste.find((k) => k.weg === '/')?.name
  const gegenprobeOk = irr.length === 1 && irr[0] === uebersicht
  zeile(
    '/gibtesnicht (Gegenprobe)',
    gegenprobeOk ? `leuchtet „${uebersicht}"` : `leuchtet ${irr.join(' + ') || 'NICHTS'}`,
  )
  if (!gegenprobeOk) {
    melde(
      `Gegenprobe: ein unbekannter Weg sollte auf die Uebersicht umgeleitet werden und dort „${uebersicht}" ` +
        `zeigen, gezeichnet wurde ${irr.join(' + ') || 'nichts'}`,
    )
  }

  console.log(fehler === 0 ? '\n  auf jedem Weg leuchtet genau der richtige Eintrag' : `\n  ${fehler} Befund(e)`)
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // Browser und selbst gestartete Attrappe gerade dann stehen, wenn es einen
  // Befund gemeldet hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  server.close()
  rmSync(BAUORT, { recursive: true, force: true })
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler > 0 ? 1 : 0)
