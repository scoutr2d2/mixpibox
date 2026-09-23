#!/usr/bin/env node
/**
 * WAS FAERBT EIN FARBWERT WIRKLICH — die Wirkung, nicht der Weg.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * `tools/thema-weg-schau.mjs` hat den WEG gemessen: ein Blatt aus
 * `themes/<Name>.css` erreicht die neue Oberflaeche ueber `/active_theme.css`,
 * aber nur mit `!important` — es wird VOR `app.css` eingebunden, und bei
 * gleicher Spezifitaet gewinnt das spaetere Blatt.
 *
 * Damit ist die Frage „kommt etwas an" beantwortet und die naechste offen:
 * WIEVIEL faerbt ein einzelner Wert? Eine Variable, die in app.css zwar
 * dasteht, aber nirgends mit `var()` gelesen wird, ist ein Regler ohne Draht.
 * Genau so einer war beim ersten Durchzaehlen dabei (`--line`: zweimal
 * deklariert, NULL Verwendungen — der Draht haengt an `--line2`). Wer die
 * Liste fuer einen Waehler aus den Deklarationen zieht, baut ihn ein.
 *
 * Und die zweite Frage, die nur eine Messung beantwortet: BLEIBT DER DUNKLE
 * STAND HEIL? `:root[data-licht='dunkel']` ueberschreibt dieselben Variablen.
 * Ein `!important` an `:root` wuerde ihn erschlagen; `:root:not([data-licht=
 * 'dunkel'])` soll ihn stehenlassen. „Soll" ist keine Messung.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * OHNE `--probe`: nichts. Nur Lesen (ssh, HTTP GET) und ein eigener
 * headless-Browser.
 *
 * MIT `--probe`: haengt fuer die Dauer der Messung einen Block mit
 * Probefarben an die Datei des EINGESTELLTEN Farbthemas an
 * (`/home/dietpi/MuPiBox/themes/<Name>.css`). Vorher wird der Inhalt gesichert
 * und am Ende byteweise wiederhergestellt; die Pruefsumme davor und danach
 * wird verglichen und ausgegeben. Es wird KEINE Konfiguration, keine
 * Nutzerdatei und kein Dienst angefasst.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/farbwaehler-wirkung.mjs                nur messen
 *     node tools/farbwaehler-wirkung.mjs --probe        Wirkung hell + dunkel
 *     node tools/farbwaehler-wirkung.mjs --probe --datei <pfad.css>
 *     node tools/farbwaehler-wirkung.mjs --box 192.168.178.169
 *
 * `--datei` legt statt der eingebauten Probefarben ein FERTIGES Themenblatt
 * ein — zum Beispiel genau das, das `PUT /api/farbthema` erzeugt hat. Damit
 * misst man nicht mehr eine nachgebaute Regel, sondern die echte Ausgabe des
 * Servers. Welche Farben darin erwartet werden, liest das Werkzeug aus dem
 * Blatt selbst.
 *
 * Wird `--probe` ohne bestehenden Verweis `www/active_theme.css` gerufen,
 * bricht das Werkzeug ab statt zu messen: ohne Verweis kaeme das Blatt gar
 * nicht an, und ein „wirkt nicht" waere dann eine falsche Auskunft.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
/** Ein fertiges Blatt statt der eingebauten Probefarben (siehe Kopf). */
const DATEI = opt('datei', null)
const WURZEL = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master'
const THEMENDIR = '/home/dietpi/MuPiBox/themes'
const VERWEIS = `${WURZEL}/www/active_theme.css`

/**
 * Probefarben, die in KEINER Datei des Bestandes vorkommen.
 *
 * Sonst beweist ein Treffer nichts: faende man `#FFF7EC` wieder, koennte das
 * ebensogut der unveraenderte Vorgabewert sein.
 */
const PROBEN = {
  '--bg': '#123456',
  '--surface': '#234567',
  '--ink': '#654321',
  '--line2': '#345678',
  '--accent': '#765432',
}

const MARKE_AUF = '/* __farbwaehler-wirkung ANFANG */'
const MARKE_ZU = '/* __farbwaehler-wirkung ENDE */'

const ssh = (cmd) =>
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', `dietpi@${BOX}`, cmd], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

// ── Farbe oder Groesse? ────────────────────────────────────────────────────
/**
 * Eine Variable ist eine FARBE, wenn ihr Wert wie eine aussieht.
 *
 * Das ist wichtiger, als es klingt: in derselben `:root`-Liste stehen
 * `--umriss-luft: 7px` und `--griff: 66px`. Wer die Liste ungefiltert in einen
 * Farbwaehler kippt, bietet einen Farbwaehler fuer einen Abstand an.
 */
const istFarbe = (w) => /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(w.trim())

/** Kommentare weg — IMMER zuerst, siehe `block()`. */
const entkommentieren = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Den ersten Block eines Selektors aus einem Stilblatt holen (ohne Parser).
 *
 * ERWARTET EIN BEREITS ENTKOMMENTIERTES BLATT. Sonst beendet die erste
 * geschweifte Klammer in einem Kommentar den Block — und `:root` in app.css
 * traegt lange erklaerende Absaetze. Dieselbe Falle steckte in der ersten
 * Fassung von `wurzelFarben` in der Verwaltung; dort fehlte `--line2` still.
 */
function block(css, selektor) {
  const i = css.indexOf(selektor)
  if (i < 0) return ''
  const a = css.indexOf('{', i)
  let tiefe = 0
  for (let k = a; k < css.length; k++) {
    if (css[k] === '{') tiefe++
    else if (css[k] === '}') {
      tiefe--
      if (tiefe === 0) return css.slice(a + 1, k)
    }
  }
  return ''
}

/** `--name: wert;` aus einem Block. */
function variablen(text) {
  const raus = {}
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) raus[m[1]] = m[2].trim()
  return raus
}

// ── Browser ────────────────────────────────────────────────────────────────
// Der eigene Browser laeuft auf einem FREIEN Port mit eigenem Profil statt auf
// einer festen Nummer, die ein Ueberlebender eines harten Abbruchs noch halten
// koennte — /json/list liefert dann klaglos die Ziele des fremden. Die
// Messungen dahinter: tools/leihgabe.mjs.

/**
 * Eine Seite laden und darin rechnen.
 *
 * `vorher` laeuft VOR dem Laden im selben Ursprung — nur so laesst sich
 * `localStorage` setzen, und der dunkle Stand haengt genau daran
 * (`mupibox_neu_licht_v1`, gesetzt von einem Einzeiler ganz oben in
 * index.html, also vor jedem Malen).
 */
async function imBrowser(url, js, vorher = null) {
  const brw = await eigenerBrowser()
  if (!brw) throw new Error('kein Browser gefunden (playwright/chromium)')
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
    if (vorher) {
      // Erst auf den Ursprung, DANN schreiben: localStorage haengt am
      // Ursprung, und auf about:blank gibt es keinen.
      await ruf('Page.navigate', { url: `http://${BOX}:8200/neu/` })
      await new Promise((r) => setTimeout(r, 1200))
      await ruf('Runtime.evaluate', { expression: vorher, returnByValue: true })
    }
    await ruf('Page.navigate', { url })
    await new Promise((r) => setTimeout(r, 2600))
    const a = await ruf('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    ws.close()
    return a.result?.result?.value
  } finally {
    // Im finally, damit auch ein Fehlversuch keinen Browser stehen laesst.
    await brw.schliessen()
  }
}

/** Was steht am laufenden Schirm wirklich an? */
const MESSEN = (namen) => `(() => {
  const s = getComputedStyle(document.documentElement)
  const raus = { licht: document.documentElement.getAttribute('data-licht') || 'hell', vars: {} }
  for (const n of ${JSON.stringify(namen)}) raus.vars[n] = s.getPropertyValue(n).trim()
  raus.body = getComputedStyle(document.body).backgroundColor
  raus.schrift = getComputedStyle(document.body).color
  // Ein paar ECHTE Flaechen dazu: eine Variable kann gesetzt sein und trotzdem
  // nichts faerben, wenn die Regel daneben eine feste Farbe traegt.
  const w = (sel, eig) => {
    const e = document.querySelector(sel)
    return e ? getComputedStyle(e)[eig] : '(nicht da)'
  }
  raus.stellen = {
    'Rahmen (Grund)': w('.rahmen', 'backgroundColor'),
    'Kachel (Flaeche)': w('.kachel, .lane-kachel', 'backgroundColor'),
    'Kacheltitel (Schrift)': w('.kachel-titel, .lane-titel', 'color'),
    'Mini-Player (Kissen)': w('.mp, .miniplayer', 'backgroundColor'),
  }
  raus.blaetter = [...document.styleSheets].map((b) => {
    let n = -1
    try { n = b.cssRules.length } catch { n = -2 }
    return { href: (b.href || '(inline)').replace(location.origin, ''), regeln: n }
  })
  return raus
})()`

// ── WCAG-Kontrast ──────────────────────────────────────────────────────────
/**
 * Die Formel steht in `tools/kontrast.mjs` ausfuehrlich; dort laeuft aber beim
 * Laden gleich der ganze Bericht los, ein `import` waere also laut. Hier steht
 * deshalb nur der Kern — eine FORMEL aus einer veroeffentlichten Norm, kein
 * Wert, der auseinanderlaufen koennte.
 */
function zerlegen(farbe) {
  const s = String(farbe).trim()
  const rgb = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const h = s.replace(/^#/, '')
  const v = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6)
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null
  return [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16))
}
const linear = (k) => {
  const c = k / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function kontrast(a, b) {
  const A = zerlegen(a)
  const B = zerlegen(b)
  if (!A || !B) return null
  const l = (p) => 0.2126 * linear(p[0]) + 0.7152 * linear(p[1]) + 0.0722 * linear(p[2])
  const [x, y] = [l(A), l(B)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// ── Ablauf ─────────────────────────────────────────────────────────────────
const kopf = (t) => console.log(`\n  ${t}\n  ${'─'.repeat(74)}`)

async function main() {
  console.log(`\n  FARBWAEHLER — WIRKUNG (Box ${BOX})`)

  // 1. Der Bestand: was steht in app.css, und was davon wird gelesen?
  const r = await fetch(`http://${BOX}:8200/neu/app.css`)
  const typ = r.headers.get('content-type') || '(keiner)'
  const css = await r.text()
  kopf('1. app.css, wie der Schirm sie bekommt')
  console.log(`  ${r.status}  ${typ}  ${css.length} B`)
  if (!typ.includes('css')) {
    console.log('  KEIN Stilblatt — der Server hat die index.html geliefert. Abbruch.')
    process.exit(1)
  }

  const rein = entkommentieren(css)
  const hell = variablen(block(rein, ':root {'))
  const dunkel = variablen(block(rein, ":root[data-licht='dunkel']"))
  const farben = Object.entries(hell).filter(([, w]) => istFarbe(w))
  const groessen = Object.entries(hell).filter(([, w]) => !istFarbe(w))
  console.log(`  :root  ${Object.keys(hell).length} Variablen — ${farben.length} Farben, ${groessen.length} Groessen`)
  console.log(`  :root[data-licht='dunkel']  ${Object.keys(dunkel).length} ueberschrieben`)
  console.log(`  KEINE Farben (gehoeren nicht in einen Waehler): ${groessen.map(([n]) => n).join(' ')}`)

  kopf('2. Welche Farbvariable wird ueberhaupt GELESEN?')
  console.log(`  ${'Variable'.padEnd(16)} ${'hell'.padEnd(24)} var()  dunkel`)
  const tot = []
  for (const [n, w] of farben) {
    const benutzt = (css.match(new RegExp(`var\\(\\s*${n}[,)]`, 'g')) || []).length
    if (benutzt === 0) tot.push(n)
    console.log(
      `  ${n.padEnd(16)} ${w.padEnd(24)} ${String(benutzt).padStart(4)}   ${dunkel[n] ? dunkel[n] : '(bleibt)'}`,
    )
  }
  if (tot.length) {
    console.log(`\n  OHNE DRAHT — deklariert, nirgends mit var() gelesen: ${tot.join(', ')}`)
    console.log('  Ein Waehler auf diese Variable waere ein Regler, der nichts tut.')
  }

  const k = kontrast(hell['--ink'], hell['--bg'])
  console.log(`\n  Kontrast --ink auf --bg: ${k ? k.toFixed(2) : '?'} : 1  (WCAG 2.1 will 4,5 fuer Text)`)

  // 2. Der Ist-Zustand am Schirm
  const namen = farben.map(([n]) => n)
  kopf('3. Am laufenden Schirm (headless, /neu/)')
  const ist = await imBrowser(`http://${BOX}:8200/neu/`, MESSEN(namen))
  if (!ist) {
    console.log('  Keine Antwort aus dem Browser.')
  } else {
    console.log(`  Stand: ${ist.licht}`)
    console.log(`  body background ${ist.body}   color ${ist.schrift}`)
    for (const [w, f] of Object.entries(ist.stellen)) console.log(`  ${w.padEnd(24)} ${f}`)
    console.log('  Stilblaetter:')
    for (const b of ist.blaetter) {
      console.log(`    ${String(b.regeln).padStart(4)} Regeln  ${b.href}${b.regeln === 0 ? '   ← NICHTS geparst' : ''}`)
    }
  }

  if (!PROBE) {
    console.log('\n  (ohne --probe wurde nichts veraendert und keine Wirkung gemessen)\n')
    return
  }

  // 3. Die Probe — ein Block im Blatt des eingestellten Themas
  kopf('4. Probe: wirkt ein Block aus dem Farbthema?')
  const thema = ssh(`/usr/bin/jq -r '.mupibox.theme // ""' /etc/mupibox/mupiboxconfig.json`).trim()
  const verweis = ssh(`readlink -f ${VERWEIS} 2>/dev/null || echo FEHLT`).trim()
  const datei = `${THEMENDIR}/${thema}.css`
  console.log(`  Farbthema: ${thema || '(keins)'}`)
  console.log(`  Verweis:   ${verweis}`)
  if (verweis === 'FEHLT' || !verweis.endsWith(`${thema}.css`)) {
    console.log('  Der Verweis fehlt oder zeigt woanders hin — eine Probe bewiese nichts. Abbruch.')
    console.log('  (Er entsteht neu, sobald in der Verwaltung IRGENDEINE Einstellung gespeichert wird.)')
    process.exit(1)
  }

  const vorher = ssh(`md5sum ${datei} | cut -d' ' -f1`).trim()
  const sicherung = `/tmp/farbwaehler-wirkung.${Date.now()}.css`
  ssh(`cp -p ${datei} ${sicherung}`)
  console.log(`  ${datei}  md5 ${vorher}  gesichert nach ${sicherung}`)

  /**
   * WAS EINGELEGT WIRD — und was daraus erwartet wird.
   *
   * Ohne `--datei`: ein selbst gebauter Block mit Probefarben. Der Selektor
   * `:root:not([data-licht='dunkel'])` statt `:root` ist der Kern der Probe —
   * mit `!important` an `:root` wuerde auch der dunkle Stand erschlagen (seine
   * Regel traegt kein `!important` und verloere). Ob das stimmt, misst der
   * zweite Durchgang.
   *
   * Mit `--datei`: das fertige Blatt, wie es der Server erzeugt hat. Die
   * erwarteten Farben werden dann AUS IHM gelesen — sonst prueft man das
   * Werkzeug gegen sich selbst statt gegen den Server.
   */
  let erwartet = PROBEN
  /** Gesetzt bei --datei: das GANZE Blatt ersetzt die Themendatei. */
  let inhalt = null
  /** Sonst: ein Block, der an die Themendatei ANGEHAENGT wird. */
  let anhang = ''
  if (DATEI) {
    inhalt = readFileSync(DATEI, 'utf8')
    erwartet = {}
    // NUR AUS DEM ERZEUGTEN BLOCK, wenn es einen gibt: der von Hand gepflegte
    // Teil eines Themenblatts traegt selbst `--ion-*: … !important` — die
    // stuenden sonst als „wirkt nicht" im Bericht, obwohl sie an `body`
    // haengen und mit `:root` nichts zu tun haben.
    const a = inhalt.indexOf('ANFANG (erzeugt)')
    const teil = a < 0 ? inhalt : inhalt.slice(a)
    for (const m of teil.matchAll(/(--[A-Za-z][A-Za-z0-9-]*)\s*:\s*(#[0-9a-fA-F]{6})\s*!important\s*;/g)) {
      erwartet[m[1]] = m[2]
    }
    console.log(`  Blatt aus ${DATEI} (${inhalt.length} B), ${Object.keys(erwartet).length} Farben darin`)
    if (Object.keys(erwartet).length === 0) {
      console.log('  Keine Farbe mit !important darin — es gaebe nichts zu messen. Abbruch.')
      process.exit(1)
    }
  } else {
    const regeln = Object.entries(PROBEN)
      .map(([n, w]) => `  ${n}: ${w} !important;`)
      .join('\n')
    // Angehaengt, nicht ersetzt: der von Hand gepflegte Teil bleibt stehen.
    anhang = `${MARKE_AUF}\n:root:not([data-licht='dunkel']) {\n${regeln}\n}\n${MARKE_ZU}\n`
  }

  let heil = false
  try {
    if (inhalt !== null) {
      const b64 = Buffer.from(inhalt).toString('base64')
      ssh(`printf '%s' '${b64}' | base64 -d > ${datei}`)
    } else {
      const b64 = Buffer.from(anhang).toString('base64')
      ssh(`printf '%s' '${b64}' | base64 -d >> ${datei}`)
    }
    const nachher = await imBrowser(`http://${BOX}:8200/neu/`, MESSEN(namen))
    const dunkelMess = await imBrowser(
      `http://${BOX}:8200/neu/`,
      MESSEN(namen),
      `localStorage.setItem('mupibox_neu_licht_v1','dunkel')`,
    )

    console.log(`\n  ${'Variable'.padEnd(12)} ${'Probe'.padEnd(10)} ${'hell'.padEnd(22)} ${'dunkel'.padEnd(22)}`)
    for (const [n, soll] of Object.entries(erwartet)) {
      const h = nachher?.vars?.[n] ?? '?'
      const d = dunkelMess?.vars?.[n] ?? '?'
      const trifft = h.toLowerCase() === soll.toLowerCase()
      const dunkelHeil = d.toLowerCase() !== soll.toLowerCase()
      console.log(
        `  ${n.padEnd(12)} ${soll.padEnd(10)} ${(trifft ? 'WIRKT  ' : 'nichts ') + h.padEnd(14)} ${(dunkelHeil ? 'heil   ' : 'ERSCHLAGEN ') + d}`,
      )
    }
    console.log(`\n  hell:   body ${nachher?.body}  Schrift ${nachher?.schrift}  (Stand ${nachher?.licht})`)
    console.log(`  dunkel: body ${dunkelMess?.body}  Schrift ${dunkelMess?.schrift}  (Stand ${dunkelMess?.licht})`)
    for (const [w, f] of Object.entries(nachher?.stellen || {})) console.log(`  hell  ${w.padEnd(24)} ${f}`)
  } finally {
    ssh(`cp -p ${sicherung} ${datei} && rm -f ${sicherung}`)
    const zurueck = ssh(`md5sum ${datei} | cut -d' ' -f1`).trim()
    heil = zurueck === vorher
    console.log(`\n  Zurueckgelegt: md5 ${zurueck}  ${heil ? '= wie vorher' : '≠ VORHER, BITTE NACHSEHEN'}`)
  }
  if (!heil) process.exit(2)
  console.log('')
}

main().catch((e) => {
  console.error(`\n  Fehlgeschlagen: ${e.message}\n`)
  process.exit(1)
})
