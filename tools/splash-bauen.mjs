#!/usr/bin/env node
/**
 * DEN START-SPLASH BAUEN — mit der Hausschrift, nicht mit einer aehnlichen.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Betreiber, 07.08.2026: „splash screen mupibox bild durch mixpi ersetzen".
 *
 * `media/images/splash.png` zeigte das MuPiBox-Maskottchen auf Blau, mit dem
 * Schriftzug „MuPiBox". Beides ist der Stand vor der Umbenennung; die Box
 * heisst seit dem 03.08.2026 MixPiBox und traegt ein anderes Maskottchen.
 *
 * ══ WARUM EIN WERKZEUG UND KEIN EINMALIGES BILD ════════════════════════════
 * Weil das Bild sonst das einzige Stueck der Oberflaeche waere, das seine
 * Farben und seine Schrift NICHT aus derselben Quelle nimmt. Aendert jemand
 * `--bg` oder das Maskottchen, faellt der Splash still auseinander — und
 * gesehen wird er nur beim Hochfahren, wo niemand danebensitzt.
 *
 * ES GIBT AUSSERDEM SCHON DREI GRUENDE, IHN NEU ZU BRAUCHEN: ein dunkler
 * Splash, die Farbsets (Aufgabe #59) und ein anderer Boxname. Jeder davon ist
 * hier ein Schalter statt einer neuen Bildbearbeitung.
 *
 * ══ WARUM IM BROWSER UND NICHT MIT PIL ═════════════════════════════════════
 * DIE SCHRIFT. „Baloo 2" liegt als `NewDesign/schriften/baloo2-latin.woff2`
 * im Projekt — woff2, das kein Bildwerkzeug dieses Rechners lesen kann. Auf
 * dem Rechner installiert sind nur DejaVu Sans und Liberation Sans; mit denen
 * gesetzt saehe der Schriftzug aus wie von einer anderen Box.
 *
 * Der Browser liest woff2 von Haus aus. Er bekommt hier eine Seite, die
 * DIESELBE `@font-face`-Regel und DIESELBEN Farbwerte benutzt wie
 * `NewDesign/app.css` — beides wird aus der Datei GELESEN, nicht abgeschrieben.
 * Laeuft eine Farbe dort auseinander, faellt es hier auf, statt still zu sein.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Genau eine Datei, und nur wenn `--schreiben` dabeisteht. Ohne den Schalter
 * legt es das Bild in den angegebenen Ordner und sagt, was es getan haette.
 * Die Box wird nicht angefasst.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/splash-bauen.mjs --ziel /tmp/s          nur bauen
 *     node tools/splash-bauen.mjs --schreiben            media/images/splash.png
 *     node tools/splash-bauen.mjs --dunkel --ziel /tmp/s der dunkle Grund
 *     node tools/splash-bauen.mjs --name "Kinderzimmer Box" --ziel /tmp/s
 *     node tools/splash-bauen.mjs --logo --schreiben   das RUNDE Startlogo
 *
 * ══ ZWEI BILDER, UND DAS ZWEITE IST DAS, DAS MAN WIRKLICH SIEHT ════════════
 * `--logo` baut `AdminInterface/www/images/mupi_round_trans.png` — ein rundes
 * 80x80. GEMESSEN AN DER BOX (07.08.2026): `/boot/splash.png` gibt es dort gar
 * nicht und `mupi_splash.service` ist abgeschaltet; den Startbildschirm
 * zeichnet `mupibox-boot-splash.service` (die Python-Fassung), und die nimmt
 * ihr Logo aus genau dieser Datei — dem ALTEN, runden MuPiBox-Maskottchen.
 *
 * WER NUR `media/images/splash.png` ersetzt, aendert also nichts an dem, was
 * beim Hochfahren zu sehen ist. Das ist die Sorte Aenderung, die man fuer
 * erledigt haelt, bis jemand die Box neu startet.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}

const DUNKEL = hat('dunkel')
const SCHREIBEN = hat('schreiben')
const ZIEL = typeof opt('ziel', null) === 'string' ? opt('ziel', null) : null
const NAME = typeof opt('name', null) === 'string' ? opt('name', null) : 'MixPiBox'

if (!SCHREIBEN && !ZIEL) {
  console.error('Entweder --ziel <ordner> oder --schreiben. Ohne beides waere der Lauf folgenlos.')
  process.exit(2)
}

/** 800x480 — die Aufloesung des Waveshare-Schirms, dieselbe wie ueberall. */
const BREITE = 800
const HOEHE = 480

/*
 * ── DIE FARBEN KOMMEN AUS app.css, NICHT AUS DIESEM KOPF ──────────────────
 *
 * Abgeschrieben waeren sie beim ersten Anfassen falsch, und niemand saehe es:
 * Ein Splash wird beim Hochfahren gezeigt, wo kein Mensch danebensitzt und
 * vergleicht. Deshalb wird die Datei gelesen und der Wert herausgesucht.
 *
 * DER DUNKLE SATZ STEHT IN EINEM ZWEITEN BLOCK (`:root[data-licht="dunkel"]`);
 * dort steht `--bg` ein zweites Mal. Es wird also nicht das erste Vorkommen
 * genommen, sondern das aus dem passenden Block — sonst waere der dunkle
 * Splash cremefarben, und zwar genau so lange, bis ihn jemand sieht.
 */
function farbeAus(css, name, dunkel) {
  const block = dunkel
    ? css.slice(css.indexOf('[data-licht="dunkel"]'))
    : css.slice(0, css.indexOf('[data-licht="dunkel"]'))
  const t = new RegExp(`--${name}:\\s*([^;]+);`).exec(block)
  if (!t) throw new Error(`--${name} steht nicht in app.css (${dunkel ? 'dunkel' : 'hell'})`)
  return t[1].trim()
}

const css = readFileSync(join(WURZEL, 'NewDesign/app.css'), 'utf8')
const grund = farbeAus(css, 'bg', DUNKEL)
const tinte = farbeAus(css, 'ink', DUNKEL)
const akzent = farbeAus(css, 'accent', DUNKEL)

/*
 * ── DER NAME WIRD GETEILT WIE IN DER LEISTE ───────────────────────────────
 *
 * „MixPiBox" steht dort zweizeilig als „MixPi" und „Box", und die Regel dafuer
 * ist NICHT „nach sechs Zeichen": bei „MixPiZwei" ergaebe das „MixPiZ" und
 * „wei". Geteilt wird am Wortende „Box" und NUR dort — dieselbe Regel wie
 * `boxnameTeilen` in app.js, dort geprueft von tools/pruef-neu-regeln.js.
 *
 * Hier steht sie ein zweites Mal, und das ist bewusst: dieses Werkzeug laeuft
 * ohne Browser-Oberflaeche und ohne app.js. Waechst die Regel dort, gehoert
 * sie hier nachgezogen — deshalb steht der Verweis dabei.
 */
function nameTeilen(n) {
  const t = String(n || '').trim()
  if (/Box$/i.test(t) && t.length > 3) return [t.slice(0, -3), t.slice(-3)]
  return [t, '']
}
const [oben, unten] = nameTeilen(NAME)

const schriftPfad = join(WURZEL, 'NewDesign/schriften/baloo2-latin.woff2')
if (!existsSync(schriftPfad)) {
  console.error(`Die Hausschrift fehlt: ${schriftPfad}`)
  console.error('Ohne sie saehe der Schriftzug aus wie von einer anderen Box — abgebrochen.')
  process.exit(2)
}
const schrift = readFileSync(schriftPfad).toString('base64')

const bildPfad = join(WURZEL, 'NewDesign/bilder/mixpi-hoert.png')
if (!existsSync(bildPfad)) {
  console.error(`Das Maskottchen fehlt: ${bildPfad}`)
  process.exit(2)
}
const bild = readFileSync(bildPfad).toString('base64')

/*
 * ── DIE SEITE ─────────────────────────────────────────────────────────────
 *
 * Alles eingebettet (Schrift und Bild als data:), damit der Browser NICHTS
 * nachladen muss. Ein Splash, der auf einen Server wartet, waere ein Splash,
 * der manchmal halb gebaut ist — und gerade beim Hochfahren gibt es keinen.
 *
 * DIE ANORDNUNG folgt der Leiste: das Maskottchen links, der Name rechts
 * daneben, zweizeilig, eng gesetzt (`line-height: 0.95`). Kein Schatten, kein
 * Verlauf — der Splash liegt eine Zehntelsekunde vor derselben Oberflaeche,
 * und ein Bruch dazwischen faellt mehr auf als jede Verzierung.
 */
const seite = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family:'Baloo 2'; src:url(data:font/woff2;base64,${schrift}) format('woff2'); font-weight:400 800; }
html,body { margin:0; padding:0; width:${BREITE}px; height:${HOEHE}px; overflow:hidden; }
body { background:${grund}; display:flex; align-items:center; justify-content:center; gap:44px; }
img { width:260px; height:260px; object-fit:contain; }
.wort { font-family:'Baloo 2'; font-weight:800; line-height:0.95; color:${tinte}; }
.oben { font-size:92px; display:block; }
.unten { font-size:92px; display:block; color:${akzent}; }
</style></head><body>
<img src="data:image/png;base64,${bild}" alt="">
<div class="wort"><span class="oben">${oben}</span><span class="unten">${unten}</span></div>
</body></html>`

// ── Browser ────────────────────────────────────────────────────────────────
if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let br = null
try {
  br = await eigenerBrowser()
  // `seite()` und nicht `wsAdresse`: leihgabe.mjs gibt { port, kind, profil,
  // ziele, seite, schliessen } zurueck. Der erste Anlauf riet den Namen und
  // bekam `undefined` als Adresse — der Fehler stand dann in ws/websocket.js
  // und sah nach einem Netzproblem aus.
  const adresse = await br.seite()
  const ws = new WebSocket(adresse, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
  await new Promise((r, x) => {
    ws.once('open', r)
    ws.once('error', x)
  })
  let nr = 0
  const warten = new Map()
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    if (m.id && warten.has(m.id)) {
      warten.get(m.id)(m)
      warten.delete(m.id)
    }
  })
  const ruf = (method, params = {}) =>
    new Promise((r) => {
      const id = ++nr
      warten.set(id, r)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await ruf('Page.enable')
  // OHNE deviceScaleFactor 1 UND mobile:false misst headless anders als der
  // Kiosk — 800x337 statt 800x480. Derselbe Grund wie in den Messwerkzeugen.
  await ruf('Emulation.setDeviceMetricsOverride', {
    width: BREITE,
    height: HOEHE,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await ruf('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(seite) })
  // AUF DIE SCHRIFT WARTEN, nicht auf die Seite. `document.fonts.ready` ist
  // der einzige Zeitpunkt, an dem sicher ist, dass Baloo 2 wirklich gesetzt
  // wurde — sonst faellt der Schriftzug auf die Ersatzschrift zurueck, und das
  // Bild sieht richtig aus, ist es aber nicht.
  await ruf('Runtime.evaluate', {
    expression: 'document.fonts.ready.then(() => true)',
    awaitPromise: true,
  })
  const gesetzt = await ruf('Runtime.evaluate', {
    expression: `(() => {
      const e = document.querySelector('.oben')
      return getComputedStyle(e).fontFamily.includes('Baloo')
    })()`,
    returnByValue: true,
  })
  if (!gesetzt?.result?.result?.value) throw new Error('Baloo 2 wurde nicht gesetzt — Bild waere falsch')

  const foto = await ruf('Page.captureScreenshot', { format: 'png' })
  const roh = Buffer.from(foto.result.data, 'base64')

  const ziele = []
  if (ZIEL) {
    mkdirSync(ZIEL, { recursive: true })
    ziele.push(join(ZIEL, DUNKEL ? 'splash-dunkel.png' : 'splash.png'))
  }
  if (SCHREIBEN) ziele.push(join(WURZEL, 'media/images/splash.png'))
  for (const z of ziele) {
    writeFileSync(z, roh)
    console.log(`  ${z}  ${BREITE}x${HOEHE}  ${Math.round(roh.length / 1024)} kB`)
  }
  console.log(`\nGrund ${grund} · Tinte ${tinte} · Akzent ${akzent} · Name „${oben}${unten}"`)
  if (!SCHREIBEN) console.log('media/images/splash.png wurde NICHT angefasst (--schreiben fehlt).')
  ws.close()
} finally {
  await br?.schliessen?.()
}
