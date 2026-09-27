#!/usr/bin/env node
/**
 * DIE OBERFLAECHE IN EINEM BROWSER, DER NUR DIE SCHRIFTEN DER BOX KENNT.
 *
 * ══ WOZU, UND WARUM DAS ETWAS ANDERES IST ALS `zeichen-ohne-schrift.py` ════
 *
 * Am 07.08.2026 standen auf der Box 41 Zeichen als leeres Rechteck, weil
 * `fc-list` dort GENAU DREI Schriften kennt — DejaVu Sans, DejaVu Sans Mono,
 * DejaVu Serif — und keine davon ein Emoji zeichnet. Auf dem Arbeitsplatz war
 * davon nichts zu sehen: der hat eine Emoji-Schrift.
 *
 * `tools/zeichen-ohne-schrift.py` faengt das im QUELLTEXT ab, gegen die
 * cmap-Tabellen der Schriften. Das ist die schaerfere Pruefung fuer alles, was
 * in einer Datei steht — und sie hat eine Luecke, die sie nicht schliessen
 * kann: WAS ERST IM BROWSER ENTSTEHT. Ein Zeichen aus einer Antwort der Box,
 * eines aus `String.fromCodePoint`, eines aus einer Bibliothek, eines aus
 * einem `content:` in app.css. Der Quelltext weiss davon nichts.
 *
 * Deshalb hier der andere Weg: ein Chromium, dem man die Schriften des
 * Rechners WEGNIMMT, bis nur die der Box uebrig sind. Was danach am Schirm
 * steht, ist das, was im Wohnzimmer steht.
 *
 * ══ WIE MAN CHROMIUM DIE SCHRIFTEN WEGNIMMT ═══════════════════════════════
 *
 * NICHT mit `--disable-remote-fonts` — das schaltet die WEBSCHRIFTEN ab
 * (Nunito, Baloo2 in NewDesign/schriften/), und genau die HAT die Box, weil
 * sie mit der Oberflaeche ausgeliefert werden. Damit misst man das Gegenteil
 * dessen, was man wissen will.
 *
 * Der Weg fuehrt ueber fontconfig: Chromium fragt fuer JEDEN Rueckfall
 * fontconfig, und fontconfig liest die Datei aus `FONTCONFIG_FILE`. Diese
 * Datei zeigt hier auf ein Verzeichnis, in dem NUR die sechs DejaVu-Dateien
 * liegen, die ein DietPi ohne Schreibtisch mitbringt (fonts-dejavu-core).
 * Alles andere — Noto Color Emoji zuerst — ist damit unerreichbar.
 *
 * GEPRUEFT WIRD DAS, NICHT GEGLAUBT: vor dem Messen fragt das Werkzeug
 * fontconfig selbst, welche Familien es sieht, und ob fuer ein Emoji noch eine
 * Schrift uebrigbleibt. Ein Sandkasten, der still nicht greift, sagte sonst
 * „alles gut" ueber den Rechner statt ueber die Box — die teuerste Sorte
 * Fehlalarm, naemlich die gruene.
 *
 * ══ WIE TOFU ERKANNT WIRD, OHNE HINZUSEHEN ════════════════════════════════
 *
 * Auf jeder Seite werden alle sichtbaren Zeichen eingesammelt und EINZELN auf
 * eine Leinwand gezeichnet — mit derselben Schriftfolge, die das Element hat,
 * also mit demselben Rueckfallweg. Daneben kommt U+10FFFD, ein Kodepunkt, den
 * KEINE Schrift zeichnet. Sind die beiden Bilder gleich, ist das Zeichen ein
 * leeres Rechteck.
 *
 * DAS IST DER PUNKT: nicht „steht es in einer Liste", sondern „malt der
 * Browser dasselbe wie fuer etwas, das es nicht gibt".
 *
 * ══ WAS ES NICHT TUT ══════════════════════════════════════════════════════
 * Es aendert keine Datei, ruft keine Box an und richtet keine Schrift ein. Der
 * Sandkasten ist ein Verzeichnis mit SYMLINKS in /tmp und verschwindet wieder.
 * Ohne Adresse startet es seine eigene Vorschau auf einem freien Port.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *   node tools/schrift-wie-die-box.mjs
 *   node tools/schrift-wie-die-box.mjs http://127.0.0.1:9921/neu/ --bilder /tmp/box
 * ENDE 0, wenn kein sichtbares Zeichen ein leeres Rechteck ist.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync, symlinkSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'
import { spawn } from 'node:child_process'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const MITGEGEBEN = argv.find((a) => a.startsWith('http')) || null
const BILDER = (() => {
  const i = argv.indexOf('--bilder')
  return i < 0 ? null : argv[i + 1]
})()
/* ── DIE GEGENPROBE ───────────────────────────────────────────────────────
 * Ein Werkzeug, das „nichts gefunden" meldet, sagt damit ZWEI Dinge, und nur
 * eines davon ist gemeint: entweder ist nichts da, oder es sucht nicht. Mit
 * `--gegenprobe` schreibt es sich selbst ein Emoji in die erste Zeile des
 * Admin-Menues und muss es finden. Wird es dann NICHT rot, ist jedes gruene
 * Ergebnis dieses Werkzeugs wertlos.
 */
const GEGENPROBE = argv.includes('--gegenprobe')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log((b ? 'ok  ' : 'FEHL') + '  ' + satz + (wie ? '  — ' + wie : ''))
}

/* ══ DER SANDKASTEN ════════════════════════════════════════════════════════
 *
 * DIESE SECHS DATEIEN UND KEINE MEHR. `fonts-dejavu-core` — das Paket, das ein
 * DietPi ohne Schreibtisch mitbringt — enthaelt genau sie, und `fc-list` auf
 * 192.168.178.169 nannte am 07.08.2026 genau die drei Familien daraus.
 *
 * DejaVuSansCondensed.ttf FEHLT MIT ABSICHT, obwohl sie sich ebenfalls „DejaVu
 * Sans" nennt: sie liegt auf diesem Arbeitsplatz herum und nicht auf der Box.
 * Wer sie mitnaehme, maesse wieder den eigenen Rechner.
 */
const BOX_DATEIEN = [
  'DejaVuSans.ttf',
  'DejaVuSans-Bold.ttf',
  'DejaVuSansMono.ttf',
  'DejaVuSansMono-Bold.ttf',
  'DejaVuSerif.ttf',
  'DejaVuSerif-Bold.ttf',
]
const SUCHORTE = ['/usr/share/fonts/TTF', '/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/dejavu']

function sandkastenBauen() {
  const verz = mkdtempSync(join(tmpdir(), 'boxschriften-'))
  const schriften = join(verz, 'schriften')
  execFileSync('mkdir', ['-p', schriften, join(verz, 'cache')])
  const genommen = []
  for (const datei of BOX_DATEIEN) {
    const quelle = SUCHORTE.map((o) => join(o, datei)).find((p) => existsSync(p))
    if (!quelle) continue
    symlinkSync(quelle, join(schriften, datei))
    genommen.push(datei)
  }
  // Die Zuordnung `sans-serif -> DejaVu Sans` steht hier, weil ohne sie auf
  // manchen Rechnern gar keine Vorgabe uebrigbleibt und fontconfig dann jede
  // Anfrage leer beantwortet. Auf der Box macht das die Systemdatei.
  writeFileSync(
    join(verz, 'fonts.conf'),
    '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n' +
      '  <dir>' + schriften + '</dir>\n' +
      '  <cachedir>' + join(verz, 'cache') + '</cachedir>\n' +
      '  <match target="pattern"><test qual="any" name="family"><string>sans-serif</string></test>' +
      '<edit name="family" mode="prepend" binding="same"><string>DejaVu Sans</string></edit></match>\n' +
      '</fontconfig>\n',
  )
  return { verz, conf: join(verz, 'fonts.conf'), genommen }
}

/** Was fontconfig IN DIESEM SANDKASTEN sieht — gefragt, nicht angenommen. */
function sandkastenPruefen(conf) {
  const lauf = (args) => {
    try {
      return execFileSync(args[0], args.slice(1), { env: { ...process.env, FONTCONFIG_FILE: conf }, encoding: 'utf8' })
    } catch {
      return ''
    }
  }
  const familien = [...new Set(lauf(['fc-list', ':', 'family']).split('\n').map((z) => z.trim()).filter(Boolean))].sort()
  /* Bleibt fuer ein Emoji noch eine Schrift uebrig?
   *
   * `fc-list :charset=…` UND NICHT `fc-match -s :charset=…`. Der erste Anlauf
   * hier nahm `fc-match -s` und bekam prompt sechs Schriften gemeldet — nicht,
   * weil sie das Emoji koennten, sondern weil `-s` die SORTIERTE Rangliste
   * aller Kandidaten ausgibt und den Zeichensatz dabei nur als Wunsch behandelt.
   * `fc-list` filtert wirklich: leer heisst, niemand kann es zeichnen.
   *
   * Gegengeprobt, damit das nicht bloss behauptet ist: mit U+2713 (dem Haken,
   * den DejaVu KENNT) muss dieselbe Frage eine Antwort liefern. Tut sie das
   * nicht, filtert `fc-list` in dieser Umgebung ueberhaupt nicht — und ein
   * leeres Ergebnis beim Emoji waere dann nichts wert.
   */
  const zeilen = (s) => s.split('\n').map((z) => z.trim()).filter(Boolean)
  const fuerEmoji = zeilen(lauf(['fc-list', ':charset=1F4CA', 'family']))
  const fuerHaken = zeilen(lauf(['fc-list', ':charset=2713', 'family']))
  return { familien, emojiSchriften: fuerEmoji.length, hakenSchriften: fuerHaken.length }
}

/* ══ DIE SEITE FRAGEN: WELCHES ZEICHEN MALT DER BROWSER ALS TOFU ═══════════
 *
 * OHNE GEGENHAKEN im Text: dieser Block geht als Zeichenkette an den Browser,
 * und ein Gegenhaken darin zerbraeche die Zeichenkette, die ihn traegt.
 */
const TOFU_JS = [
  'JSON.stringify((() => {',
  '  const gesehen = new Map()',
  '  const lauf = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)',
  '  for (let k = lauf.nextNode(); k; k = lauf.nextNode()) {',
  '    const t = k.nodeValue || ""',
  '    if (!t.trim()) continue',
  '    const el = k.parentElement',
  '    if (!el) continue',
  '    const s = getComputedStyle(el)',
  '    if (s.display === "none" || s.visibility === "hidden") continue',
  '    if (!el.getClientRects().length) continue',
  '    const schrift = s.fontStyle + " " + s.fontWeight + " 24px " + s.fontFamily',
  '    for (const z of Array.from(t)) {',
  '      if (z.codePointAt(0) < 128) continue',
  '      const schl = z + "\\u0000" + schrift',
  '      if (!gesehen.has(schl)) gesehen.set(schl, { z, schrift, wo: (el.className || el.tagName) + "" })',
  '    }',
  '  }',
  '  const lw = document.createElement("canvas")',
  '  lw.width = 40; lw.height = 40',
  '  const c = lw.getContext("2d")',
  '  const malen = (z, schrift) => {',
  '    c.clearRect(0, 0, 40, 40)',
  '    c.font = schrift',
  '    c.fillStyle = "#000"',
  '    c.textBaseline = "middle"',
  '    c.fillText(z, 4, 20)',
  '    return Array.from(c.getImageData(0, 0, 40, 40).data).join(",")',
  '  }',
  '  const raus = []',
  '  for (const e of gesehen.values()) {',
  // U+10FFFD ist der letzte Kodepunkt der privaten Ebene 16. Keine Schrift
  // dieser Welt zeichnet ihn; sein Bild IST das leere Rechteck.
  '    const tofu = malen("\\u{10FFFD}", e.schrift)',
  '    const leer = malen(" ", e.schrift)',
  '    const bild = malen(e.z, e.schrift)',
  '    if (bild === tofu && bild !== leer) raus.push({ z: e.z, kp: e.z.codePointAt(0), wo: e.wo })',
  '  }',
  '  return raus',
  '})())',
].join('\n')

/* ══ DIE VORSCHAU ══════════════════════════════════════════════════════════ */
let vorschau = null
let ZIEL = MITGEGEBEN
if (!ZIEL) {
  const port = await freierPort()
  ZIEL = 'http://127.0.0.1:' + port + '/neu/'
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(port)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try {
      const a = await fetch(ZIEL)
      if (a.ok) break
    } catch {
      /* noch nicht oben */
    }
    await warte(150)
  }
}
console.log('ZIEL: ' + ZIEL + (vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'))

/* ══ SANDKASTEN STELLEN, BEVOR DER BROWSER STARTET ═════════════════════════
 * `spawn` erbt `process.env`; die Umgebung muss also VOR `eigenerBrowser()`
 * stehen, sonst startet ein Chromium mit den Schriften des Arbeitsplatzes und
 * jede Aussage danach gilt fuer den falschen Rechner.
 */
const kasten = sandkastenBauen()
process.env.FONTCONFIG_FILE = kasten.conf
const stand = sandkastenPruefen(kasten.conf)

console.log('')
console.log('══ DER SANDKASTEN ════════════════════════════════════')
ja(kasten.genommen.length === BOX_DATEIEN.length, 'die sechs Schriftdateien der Box liegen darin', kasten.genommen.length + ' von ' + BOX_DATEIEN.length)
ja(
  stand.familien.length === 3 && stand.familien.every((f) => f.startsWith('DejaVu')),
  'fontconfig sieht NUR die drei Familien der Box',
  stand.familien.join(' · ') || '(nichts)',
)
ja(stand.hakenSchriften > 0, 'die Frage nach einem Zeichensatz wird ueberhaupt beantwortet (U+2713)', stand.hakenSchriften + ' Schrift(en)')
ja(stand.emojiSchriften === 0, 'fuer ein Emoji bleibt KEINE Schrift uebrig (U+1F4CA)', stand.emojiSchriften + ' Schrift(en)')
if (fehler) {
  console.log('')
  console.log('ABBRUCH: der Sandkasten greift nicht. Gemessen waere der Arbeitsplatz, nicht die Box —')
  console.log('und ein gruenes Ergebnis daraus waere schlimmer als gar keines.')
  vorschau?.kill()
  rmSync(kasten.verz, { recursive: true, force: true })
  process.exit(2)
}

/* ══ MESSEN ════════════════════════════════════════════════════════════════ */
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

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  vorschau?.kill()
  rmSync(kasten.verz, { recursive: true, force: true })
  process.exit(0)
}

const tofuGesamt = new Map()
let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, name + '.png'), Buffer.from(s.data, 'base64'))
  }
  const licht = (w) => ev('(document.documentElement.setAttribute("data-licht", ' + JSON.stringify(w) + '), true)')
  const klick = (wahl) => ev('(() => { const e = ' + wahl + '; if (!e) return false; e.click(); return true })()')

  /** Eine Lage ansehen: Bild hell und dunkel, und in beiden nach Tofu suchen. */
  const schauen = async (name) => {
    for (const w of ['hell', 'dunkel']) {
      await licht(w)
      // Das eingeschmuggelte Emoji kommt in den NAMEN einer Zeile, also an
      // genau die Stelle, an der am 07.08.2026 die leeren Rechtecke standen.
      if (GEGENPROBE)
        await ev(
          '(() => { const n = document.querySelector(".zeile-name") || document.querySelector("h1,h2,p,div");' +
            ' if (n) n.textContent = "Gegenprobe \\u{1F4CA}"; return true })()',
        )
      await warte(220)
      await bild(name + '-' + w)
      const funde = JSON.parse(await ev(TOFU_JS))
      for (const f of funde) {
        const s = tofuGesamt.get(f.z) || { kp: f.kp, wo: new Set() }
        s.wo.add(name + ' · ' + f.wo)
        tofuGesamt.set(f.z, s)
      }
    }
    await licht('hell')
  }

  const laden = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL + '?frisch=' + Date.now() })
    await warte(600)
    await ev('(localStorage.removeItem("mupibox_eltern_freigabe"), true)')
    await send(ws, 'Page.navigate', { url: ZIEL + '?frisch=' + Date.now() })
    await warte(2200)
  }
  const gruppe = async (id) => {
    await klick('document.querySelector("#eltern-faecher [data-fach=\\"" + ' + JSON.stringify(id) + ' + "\\"]")')
    await warte(700)
  }
  const punkt = async (name) => {
    const ok = await ev(
      '(() => { for (const z of document.querySelectorAll("#fach-zeilen .fach-zeile")) {' +
        ' const n = z.querySelector(".zeile-name");' +
        ' if (!n || !n.textContent.trim().startsWith(' + JSON.stringify(name) + ')) continue;' +
        ' if (z.tagName === "BUTTON") { z.click(); return true }' +
        ' const k = z.querySelector(".zeile-tat"); if (k) { k.click(); return true } } return false })()',
    )
    await warte(800)
    return ok === true
  }

  const GLIEDERUNG = [
    ['verbindung', ['WLAN', 'Bluetooth', 'Funk an und aus']],
    ['medien', ['Suchen und verwalten', 'Dienste']],
    ['anzeige', ['Indikatoren', 'Farbe und Form', 'Verhalten']],
    ['system', ['Info', 'Sperre vor diesem Bereich', 'Neu laden und neu starten', 'Benutzer']],
  ]

  console.log('')
  console.log('══ DIE KINDERSEITEN ══════════════════════════════════')
  await laden()
  await schauen('kind-regal')
  await klick('document.querySelector("#wappen")')
  await warte(300)

  console.log('══ DAS ADMIN-MENUE ═══════════════════════════════════')
  await laden()
  await adminAuf(ev, { warteMs: 1100, pruefen: false })
  await schauen('admin-tor-oder-gruppen')
  for (const [id, punkte] of GLIEDERUNG) {
    await gruppe(id)
    await schauen('gruppe-' + id)
    for (const p of punkte) {
      if (!(await punkt(p))) continue
      await schauen('punkt-' + id + '-' + p.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 22))
      await gruppe(id)
    }
  }

  console.log('')
  console.log('══ WAS DER BROWSER ALS LEERES RECHTECK MALT ══════════')
  if (GEGENPROBE)
    ja(
      tofuGesamt.has('\u{1F4CA}'),
      'GEGENPROBE: das eingeschmuggelte Emoji WURDE gefunden',
      tofuGesamt.has('\u{1F4CA}') ? 'ja' : 'nein — dieses Werkzeug sucht nicht, und sein Gruen ist wertlos',
    )
  else ja(tofuGesamt.size === 0, 'kein sichtbares Zeichen ist ein leeres Rechteck', tofuGesamt.size + ' Zeichen')
  for (const [z, s] of tofuGesamt) {
    console.log('      ' + z + '  U+' + s.kp.toString(16).toUpperCase().padStart(4, '0') + '  ' + [...s.wo].slice(0, 4).join(' | '))
  }
} finally {
  await browser?.schliessen()
  vorschau?.kill()
  rmSync(kasten.verz, { recursive: true, force: true })
}

console.log('')
if (BILDER) console.log('Bilder: ' + BILDER)
console.log(fehler ? fehler + ' Aussage(n) halten nicht.' : 'ALLES GRUEN — die Box sieht dasselbe wie dieser Lauf.')
process.exit(fehler ? 1 : 0)
