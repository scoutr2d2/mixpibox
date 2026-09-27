#!/usr/bin/env node
/**
 * WIE KOMMT EIN FARBTHEMA AUF DEN SCHIRM — der ganze Weg, gemessen.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Der Betreiber will „das neue design auch im theme editor bearbeitbar machen,
 * fuers erste die farben, hintergrund mit einem farbwaehler". Bevor man einen
 * Waehler baut, muss feststehen, WOHIN dessen Wert eigentlich fliesst. Zwischen
 * der Datei `themes/<Name>.css` und einem gefaerbten Pixel liegen FUENF Stellen,
 * und jede einzelne kann still nichts tun:
 *
 *   1. DIE DATEI      /home/dietpi/MuPiBox/themes/<Name>.css
 *   2. DER NAME       mupibox.theme in /etc/mupibox/mupiboxconfig.json
 *   3. DER SCHREIBER  setting_update.sh legt den Verweis um  — laeuft er ueberhaupt?
 *   4. DER VERWEIS    www/active_theme.css -> themes/<Name>.css
 *   5. DER LESER      index.html bindet ihn ein — und app.css kommt DANACH.
 *
 * Punkt 5 ist der, an dem die neue Oberflaeche haengt: sie laedt
 * `/active_theme.css` VOR `app.css`. Bei gleicher Spezifitaet gewinnt das
 * SPAETERE Blatt. Ein `:root{--bg:...}` im Thema waere also wirkungslos, ein
 * `:root{--bg:... !important}` nicht. Das ist keine Theorie — `--probe` misst es.
 *
 * ══ WARUM NICHT EINFACH LESEN ══════════════════════════════════════════════
 * Das Wiki beschreibt den Weg seit 2026-07 (mupi-neues-thema-anlegen,
 * mupi-themawechsel-teilstring). Zustandsaussagen haben aber Haltbarkeit: ein
 * Ausrollvorgang, der www/ austauscht, nimmt den Verweis mit — er ist kein
 * Bauergebnis und wird nicht wiederhergestellt. Danach steht in der
 * Konfiguration weiter ein Thema, und es faerbt nichts. HTTP 200 verraet das
 * NICHT: der Server antwortet auf JEDEN Pfad mit 200 und liefert die
 * index.html ([[server-antwortet-200-auf-alles]]). Erst der Inhaltstyp
 * (`text/html` statt `text/css`) zeigt es.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * OHNE --probe: nichts. Nur Lesen (ssh, HTTP GET) und ein eigener
 * headless-Browser.
 *
 * MIT --probe: legt fuer die Dauer der Messung eine Datei
 * `/home/dietpi/MuPiBox/themes/__probe.css` an und richtet den Verweis
 * `www/active_theme.css` darauf. Der VORHERIGE Zustand des Verweises wird
 * gemerkt und am Ende exakt wiederhergestellt (auch „gab es nicht" — dann wird
 * er wieder entfernt). Die Probedatei wird geloescht. Es wird KEINE
 * Konfiguration und keine Nutzerdatei angefasst.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/thema-weg-schau.mjs                      nur messen
 *     node tools/thema-weg-schau.mjs --probe              zusaetzlich: kommt ein Thema an?
 *     node tools/thema-weg-schau.mjs --thema MupiNew      ein ECHTES Thema anlegen und messen
 *     node tools/thema-weg-schau.mjs --box 192.168.178.169
 *     node tools/thema-weg-schau.mjs --themen             je Thema: was setzt es?
 */
import { execFileSync } from 'node:child_process'
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}

const BOX = opt('box', '192.168.178.169')
const PROBE = hat('probe')
const THEMEN = hat('themen')
/** Ein VORHANDENES Thema kurz einhaengen und beide Oberflaechen messen.
 *  Trennt „der Mechanismus ist kaputt" von „nur der Verweis fehlt". */
const THEMA = opt('thema', null)
const WURZEL = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master'
const THEMENDIR = '/home/dietpi/MuPiBox/themes'
const VERWEIS = `${WURZEL}/www/active_theme.css`
const PROBEDATEI = `${THEMENDIR}/__probe.css`

/** Die Farbe, mit der geprueft wird. Absichtlich eine, die in KEINER Datei
 *  des Bestandes vorkommt — sonst beweist ein Treffer nichts. */
const PROBE_BG = 'rgb(18, 52, 86)' // #123456
const PROBE_INK = 'rgb(101, 67, 33)' // #654321

const ssh = (cmd) =>
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', `dietpi@${BOX}`, cmd], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

// ── 1..4  Der Weg bis zur Auslieferung ─────────────────────────────────────
function wegMessen() {
  const roh = ssh(`
    echo "THEMENZAHL=$(ls -1 ${THEMENDIR}/*.css 2>/dev/null | wc -l)"
    echo "NAME=$(/usr/bin/jq -r '.mupibox.theme // "(fehlt)"' /etc/mupibox/mupiboxconfig.json)"
    echo "OBERFLAECHE=$(/usr/bin/jq -r '.mupibox.oberflaeche // "klassisch(Vorgabe)"' /etc/mupibox/mupiboxconfig.json)"
    echo "LISTE=$(/usr/bin/jq -r '.mupibox.installedThemes | length' /etc/mupibox/mupiboxconfig.json)"
    if [ -L ${VERWEIS} ]; then echo "VERWEIS=symlink -> $(readlink ${VERWEIS})"
    elif [ -f ${VERWEIS} ]; then echo "VERWEIS=datei ($(stat -c%s ${VERWEIS}) Bytes)"
    else echo "VERWEIS=FEHLT"; fi
    echo "SCHREIBER=$(command -v /usr/local/bin/mupibox/setting_update.sh >/dev/null 2>&1 && echo da || echo fehlt)"
    echo "SHUTDOWNRUF=$(grep -c '^[^#]*setting_update' /usr/local/bin/mupibox/mupi_shutdown.sh 2>/dev/null)"
    echo "DEVIDRUF=$(grep -c '^[^#]*setting_update' /usr/local/bin/mupibox/set_deviceid.sh 2>/dev/null)"
  `)
  const m = Object.fromEntries(
    roh
      .split('\n')
      .filter((z) => z.includes('='))
      .map((z) => [z.slice(0, z.indexOf('=')), z.slice(z.indexOf('=') + 1)]),
  )
  return m
}

/** Was liefert der Server WIRKLICH — 200 beweist hier nichts, der Typ schon. */
async function auslieferungMessen(pfad) {
  const r = await fetch(`http://${BOX}:8200${pfad}`)
  const text = await r.text()
  return {
    status: r.status,
    typ: r.headers.get('content-type') || '(keiner)',
    bytes: text.length,
    istCss: /^\s*[/@:.a-zA-Z#*[]/.test(text) && !/^\s*<!DOCTYPE/i.test(text),
    anfang: text.slice(0, 60).replace(/\s+/g, ' '),
  }
}

// ── Browser ────────────────────────────────────────────────────────────────
// Der eigene Browser laeuft auf einem FREIEN Port mit eigenem Profil statt auf
// einer festen Nummer, die ein Ueberlebender eines harten Abbruchs noch halten
// koennte — /json/list liefert dann klaglos die Ziele des fremden. Die
// Messungen dahinter: tools/leihgabe.mjs.
async function imBrowser(url, js) {
  const brw = await eigenerBrowser()
  if (!brw) throw new Error('kein Browser gefunden')
  try {
    const ws = new WebSocket(await brw.seite())
    await new Promise((r, x) => {
      ws.on('open', r)
      ws.on('error', x)
    })
    let id = 0
    const offen = new Map()
    ws.on('message', (d) => {
      const n = JSON.parse(d)
      if (n.id && offen.has(n.id)) {
        offen.get(n.id)(n)
        offen.delete(n.id)
      }
    })
    const ruf = (method, params = {}) =>
      new Promise((r) => {
        const i = ++id
        offen.set(i, r)
        ws.send(JSON.stringify({ id: i, method, params }))
      })
    await ruf('Page.enable')
    await ruf('Runtime.enable')
    await ruf('Page.navigate', { url })
    await new Promise((r) => setTimeout(r, 2500))
    const a = await ruf('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    ws.close()
    return a.result?.result?.value
  } finally {
    // Im finally, damit auch ein Fehlversuch keinen Browser stehen laesst.
    await brw.schliessen()
  }
}

/** Was steht wirklich an :root — und welche Blaetter hat der Browser genommen? */
const ABLESEN = `(() => {
  const w = getComputedStyle(document.documentElement)
  const v = (n) => w.getPropertyValue(n).trim()
  const blaetter = [...document.styleSheets].map(s => {
    let regeln = -1
    try { regeln = s.cssRules.length } catch (e) { regeln = -2 }
    return { href: s.href || '(inline)', regeln }
  })
  return JSON.stringify({
    bg: v('--bg'), ink: v('--ink'), surface: v('--surface'), accent: v('--accent'),
    koerperBg: getComputedStyle(document.body).backgroundColor,
    koerperFarbe: getComputedStyle(document.body).color,
    licht: document.documentElement.getAttribute('data-licht') || 'hell',
    blaetter,
  })
})()`

const ABLESEN_KLASSISCH = `(() => {
  const w = getComputedStyle(document.body)
  const v = (n) => w.getPropertyValue(n).trim()
  const blaetter = [...document.styleSheets].map(s => {
    let regeln = -1
    try { regeln = s.cssRules.length } catch (e) { regeln = -2 }
    return { href: s.href || '(inline)', regeln }
  })
  return JSON.stringify({
    ionBg: v('--ion-background-color'), ionLight: v('--ion-color-light'),
    koerperBg: w.backgroundColor, blaetter,
  })
})()`

// ── Themen-Inventur: was setzt jedes Thema, und kann es /neu/ treffen? ──────
/**
 * WAS /neu/ AN ELEMENTEN HAT: html, body, div, button, nav, img, svg, input …
 * WAS ES NICHT HAT: irgendetwas mit `ion-` und die Ionic-Klassen
 * (.ion-page, .home-content, .md, .ios, .medialist-*, .player-*, .circle-card).
 * Ein Selektor, der eines davon verlangt, kann dort NIE zutreffen.
 */
const IONISCH = /(^|[\s>+~,(])(ion-[a-z-]+|\.ion-[a-z-]+|\.md|\.ios|\.home-\w+|\.medialist-\w+|\.player-\w+|\.circle-card|\.media-card|\.edit-header|\.add-header|\.wifi-header|\.mupi-loading-spinner)\b/
function themenInventur() {
  const roh = ssh(`for f in ${THEMENDIR}/*.css; do echo "===DATEI $f"; cat "$f"; done`)
  const teile = roh.split('===DATEI ').slice(1)
  const raus = []
  for (const t of teile) {
    const nl = t.indexOf('\n')
    const name = t.slice(0, nl).trim().split('/').pop()
    const inhalt = t.slice(nl + 1).replace(/\/\*[\s\S]*?\*\//g, '')
    const regeln = [...inhalt.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    const vars = new Set()
    let trifftNeu = 0
    for (const [, sel, koerper] of regeln) {
      for (const m of koerper.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) vars.add(m[1])
      const s = sel.trim()
      if (s.startsWith('@')) continue
      if (!IONISCH.test(s)) trifftNeu++
    }
    raus.push({
      name,
      regeln: regeln.length,
      vars: [...vars],
      nichtIonisch: trifftNeu,
    })
  }
  return raus
}

// ── Probe: kann ein Thema die neue Oberflaeche ueberhaupt erreichen? ────────
const PROBE_CSS = `/* Probe von tools/thema-weg-schau.mjs — wird wieder entfernt. */
:root { --bg: #123456; }
:root { --ink: #654321 !important; }
`

function verweisMerken() {
  const z = ssh(
    `if [ -L ${VERWEIS} ]; then echo "L $(readlink ${VERWEIS})"; elif [ -e ${VERWEIS} ]; then echo "F"; else echo "N"; fi`,
  ).trim()
  return z
}
function verweisSetzen(ziel) {
  ssh(`ln -sfn ${ziel} ${VERWEIS}`)
}
function verweisWiederherstellen(z) {
  if (z.startsWith('L ')) ssh(`ln -sfn ${z.slice(2).trim()} ${VERWEIS}`)
  else ssh(`rm -f ${VERWEIS}`)
  ssh(`rm -f ${PROBEDATEI}`)
}

// ── Hauptlauf ──────────────────────────────────────────────────────────────
const A = (s) => console.log(s)
A(`\n╔═ WIE EIN FARBTHEMA AUF DEN SCHIRM KOMMT — gemessen an ${BOX}, ${new Date().toLocaleString()}`)

const w = wegMessen()
A(`\n── 1..4  Der Weg bis zur Auslieferung ───────────────────────────────────`)
A(`   Dateien in ${THEMENDIR}      ${w.THEMENZAHL}`)
A(`   mupibox.theme                            ${w.NAME}`)
A(`   mupibox.installedThemes (Anzahl)         ${w.LISTE}`)
A(`   mupibox.oberflaeche (was der Kiosk zeigt) ${w.OBERFLAECHE}`)
A(`   www/active_theme.css                     ${w.VERWEIS}`)
A(`   setting_update.sh                        ${w.SCHREIBER}`)
A(`   … Aufruf beim Herunterfahren aktiv?      ${w.SHUTDOWNRUF === '0' ? 'NEIN (auskommentiert)' : 'ja'}`)
A(`   … Aufruf in set_deviceid.sh aktiv?       ${w.DEVIDRUF === '0' ? 'NEIN' : 'ja'}`)
A(`   … Aufruf aus dem Server (PUT /api/konfiguration) steht in server.ts`)

A(`\n── 5  Was der Server auf die Anfrage wirklich liefert ───────────────────`)
for (const p of ['/active_theme.css', '/neu/app.css']) {
  const a = await auslieferungMessen(p)
  A(`   ${p.padEnd(20)} ${a.status}  ${a.typ.padEnd(28)} ${String(a.bytes).padStart(7)} B  ${a.istCss ? 'CSS' : 'KEIN CSS'}`)
  if (!a.istCss) A(`        -> ${a.anfang}`)
}

A(`\n── Was an :root der NEUEN Oberflaeche ankommt ───────────────────────────`)
const vorher = JSON.parse(await imBrowser(`http://${BOX}:8200/neu/`, ABLESEN))
A(`   --bg ${vorher.bg}   --ink ${vorher.ink}   --accent ${vorher.accent}   (licht: ${vorher.licht})`)
A(`   body background ${vorher.koerperBg}`)
A(`   geladene Blaetter:`)
for (const b of vorher.blaetter) A(`     ${String(b.regeln).padStart(5)} Regeln  ${b.href}`)

A(`\n── Was an der KLASSISCHEN Oberflaeche ankommt ───────────────────────────`)
try {
  const k = JSON.parse(await imBrowser(`http://${BOX}:8200/`, ABLESEN_KLASSISCH))
  A(`   --ion-background-color ${k.ionBg || '(leer)'}   --ion-color-light ${k.ionLight || '(leer)'}`)
  A(`   body background ${k.koerperBg}`)
  for (const b of k.blaetter) A(`     ${String(b.regeln).padStart(5)} Regeln  ${b.href}`)
} catch (e) {
  A(`   nicht gemessen: ${e.message}`)
}

if (THEMEN) {
  A(`\n── Was jedes Thema setzt (und ob ein Selektor /neu/ treffen KANN) ──────`)
  const inv = themenInventur()
  A(`   ${'Thema'.padEnd(26)} Regeln  nicht-ionisch  Variablen`)
  for (const t of inv.sort((a, b) => a.name.localeCompare(b.name))) {
    A(
      `   ${t.name.padEnd(26)} ${String(t.regeln).padStart(6)}  ${String(t.nichtIonisch).padStart(13)}  ${t.vars.join(' ') || '(keine)'}`,
    )
  }
  const alle = new Set(inv.flatMap((t) => t.vars))
  A(`\n   Alle je gesetzten Variablen (${alle.size}): ${[...alle].sort().join(' ')}`)
  A(`   Davon in app.css der neuen Oberflaeche verwendet: KEINE, wenn diese Liste`)
  A(`   nur --ion-* enthaelt — die neue Oberflaeche kennt --ion-* nicht.`)
}

if (THEMA) {
  A(`\n── EIN ECHTES THEMA EINGEHAENGT: ${THEMA} ─────────────────────────────`)
  const merk = verweisMerken()
  A(`   Zustand vorher: ${merk === 'N' ? 'kein Verweis' : merk}`)
  try {
    verweisSetzen(`${THEMENDIR}/${THEMA}.css`)
    const a = await auslieferungMessen('/active_theme.css')
    A(`   /active_theme.css: ${a.status} ${a.typ} ${a.bytes} B  ${a.istCss ? 'CSS' : 'KEIN CSS'}`)
    const k = JSON.parse(await imBrowser(`http://${BOX}:8200/`, ABLESEN_KLASSISCH))
    A(`   KLASSISCH  --ion-background-color ${k.ionBg || '(leer)'}  --ion-color-light ${k.ionLight || '(leer)'}  body ${k.koerperBg}`)
    const n = JSON.parse(await imBrowser(`http://${BOX}:8200/neu/`, ABLESEN))
    A(`   NEU        --bg ${n.bg}  --ink ${n.ink}  --accent ${n.accent}  body ${n.koerperBg}`)
    const regeln = n.blaetter.find((b) => b.href.endsWith('active_theme.css'))?.regeln
    A(`   In /neu/ geparste Regeln aus dem Thema: ${regeln}`)
  } finally {
    verweisWiederherstellen(merk)
    const jetzt = verweisMerken()
    if (jetzt === merk) A(`   Zustand wiederhergestellt: ja`)
    else {
      // AM 05.08.2026 GENAU SO PASSIERT: waehrend der Messung speicherte eine
      // andere Sitzung eine Einstellung, der Server rief `sudo setting_update.sh`,
      // und das legte den Verweis neu an (root:root) — nach unserem `rm`.
      // Das ist KEIN Fehler dieses Werkzeugs, aber es muss dastehen.
      A(`   Zustand NICHT wie vorher: vorher "${merk}", jetzt "${jetzt}".`)
      A(`     Erwartbar, wenn parallel jemand eine Einstellung gespeichert hat —`)
      A(`     PUT /api/konfiguration ruft setting_update.sh und legt den Verweis an.`)
      A(`     Nachsehen: sudo -n journalctl --since -10min | grep setting_update`)
    }
  }
}

if (PROBE) {
  A(`\n── PROBE: erreicht ein Thema die neue Oberflaeche ueberhaupt? ──────────`)
  const merk = verweisMerken()
  A(`   Zustand vorher: ${merk === 'N' ? 'kein Verweis' : merk}`)
  try {
    ssh(`cat > ${PROBEDATEI} <<'CSSENDE'\n${PROBE_CSS}CSSENDE`)
    verweisSetzen(PROBEDATEI)
    const a = await auslieferungMessen('/active_theme.css')
    A(`   /active_theme.css liefert jetzt ${a.status} ${a.typ} ${a.bytes} B  ${a.istCss ? 'CSS' : 'KEIN CSS'}`)
    const nach = JSON.parse(await imBrowser(`http://${BOX}:8200/neu/`, ABLESEN))
    A(`   --bg  ${nach.bg}    (Probe wollte ${PROBE_BG}, OHNE !important)`)
    A(`   --ink ${nach.ink}   (Probe wollte ${PROBE_INK}, MIT !important)`)
    const bgAn = nach.bg.toLowerCase().includes('123456')
    const inkAn = nach.ink.toLowerCase().includes('654321')
    A(``)
    A(`   ERGEBNIS:`)
    A(`     Weg ueberhaupt offen (Datei wird geliefert und geparst): ${a.istCss ? 'JA' : 'NEIN'}`)
    A(`     ohne !important wirksam: ${bgAn ? 'JA' : 'NEIN — app.css kommt spaeter und gewinnt'}`)
    A(`     mit  !important wirksam: ${inkAn ? 'JA' : 'NEIN'}`)
  } finally {
    verweisWiederherstellen(merk)
    const jetzt = verweisMerken()
    if (jetzt === merk) A(`   Zustand wiederhergestellt: ja`)
    else {
      // AM 05.08.2026 GENAU SO PASSIERT: waehrend der Messung speicherte eine
      // andere Sitzung eine Einstellung, der Server rief `sudo setting_update.sh`,
      // und das legte den Verweis neu an (root:root) — nach unserem `rm`.
      // Das ist KEIN Fehler dieses Werkzeugs, aber es muss dastehen.
      A(`   Zustand NICHT wie vorher: vorher "${merk}", jetzt "${jetzt}".`)
      A(`     Erwartbar, wenn parallel jemand eine Einstellung gespeichert hat —`)
      A(`     PUT /api/konfiguration ruft setting_update.sh und legt den Verweis an.`)
      A(`     Nachsehen: sudo -n journalctl --since -10min | grep setting_update`)
    }
  }
}

A(``)
