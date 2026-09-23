#!/usr/bin/env node
/**
 * FARBWAEHLER — GEGENGELESEN. Fuenf Fragen, die kein Einheitstest beantwortet.
 *
 * ══ WOZU NOCH EIN WERKZEUG ═════════════════════════════════════════════════
 * `tools/farbwaehler-wirkung.mjs` misst, ob eine Variable ANKOMMT
 * (`getComputedStyle` am Wurzelelement). Das ist die halbe Wahrheit: eine
 * Variable kann gesetzt sein und trotzdem keinen einzigen Bildpunkt aendern,
 * weil die Regel daneben eine feste Farbe traegt. Dieses Werkzeug schaut
 * deshalb auf das BILD — es holt den Schirmabzug ueber CDP, dekodiert das PNG
 * selbst und liest echte Bildpunkte aus. „Der Punkt bei (400,240) ist
 * #FF00FF" ist eine Aussage, die eine Variable nicht vortaeuschen kann.
 *
 * Und es fragt vier Dinge, die vorher niemand gefragt hat:
 *
 *   ueberlebt   Bleibt die Farbe, wenn die Seite NEU GELADEN wird? Das Blatt
 *               wird einmal beim Laden gelesen — ein zweiter Aufbau ist der
 *               einzige Beweis, dass sie nicht nur im laufenden Fenster steht.
 *   fremd       Was passiert bei einem Farbthema, das die neuen Variablen
 *               NICHT kennt (alle 38 mitgelieferten)? Halb gefaerbt waere der
 *               schlimmste Ausgang: drei eigene Farben, zwei ausgelieferte.
 *   aussperren  Schrift auf Grundfarbe — ist die Box dann unbenutzbar, und
 *               kommt man ueber die Verwaltung zurueck?
 *   doppelt     Steht danach eine Farbe an zwei Stellen?
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Die Datei des EINGESTELLTEN Farbthemas (`/home/dietpi/MuPiBox/themes/
 * <Name>.css`) — sie wird vorher byteweise gesichert und am Ende
 * zurueckgelegt; die Pruefsumme davor und danach steht im Bericht. Der
 * geschriebene Inhalt kommt aus dem ECHTEN `blockErsetzen` des Servers
 * (`src/backend-api/src/farbthema.ts`), nicht aus einem Nachbau — sonst misst
 * man seinen eigenen Nachbau.
 *
 * MIT `--fremd` zusaetzlich: `mupibox.theme` in `/etc/mupibox/mupiboxconfig.json`
 * fuer die Dauer der Messung auf ein anderes Thema, dann zurueck. Die Datei
 * wird vorher nach `<pfad>.gegenlesen-sicherung` kopiert (Nutzerdaten).
 *
 * OHNE `--probe` wird NICHTS geschrieben — dann nur Bestand + ein Schirmabzug.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node_modules/.bin/tsx tools/farbwaehler-gegenlesen.mjs            nur sehen
 *     node_modules/.bin/tsx tools/farbwaehler-gegenlesen.mjs --probe
 *     ... --probe --fremd          zusaetzlich Themenwechsel messen
 *     ... --nach-neustart          nur nachsehen, was nach einem Boot dasteht
 *     ... --bilder /pfad/zum/ordner
 *
 * `tsx` und nicht `node`, weil farbthema.ts hereingeholt wird.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { blockErsetzen, blockLesen } from '../src/backend-api/src/farbthema.ts'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}

const BOX = opt('box', '192.168.178.169')
const PROBE = hat('probe')
const FREMD = hat('fremd')
/** Die Box wirklich AUSSCHALTEN — nur mit `--neustart`, nie nebenbei. */
const NEUSTART = hat('neustart')
const BILDER = opt('bilder', '/tmp/farbwaehler-gegenlesen')
const THEMENDIR = '/home/dietpi/MuPiBox/themes'
const WURZEL = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master'
const VERWEIS = `${WURZEL}/www/active_theme.css`
const KONFIG = '/etc/mupibox/mupiboxconfig.json'

/**
 * Probefarben, die in KEINER Datei des Bestandes vorkommen.
 *
 * Sonst beweist ein Treffer nichts: faende man `#FFF7EC` wieder, koennte das
 * ebensogut der unveraenderte Vorgabewert sein. Und sie sind ABSICHTLICH
 * haesslich — ein zartes Beige laesst sich auf einem Schirmabzug mit dem
 * Vorgabewert verwechseln, Magenta nicht.
 */
const SCHREIEND = {
  '--bg': '#FF00FF',
  '--surface': '#00FF00',
  '--ink': '#0000FF',
  '--line2': '#FF8000',
  '--accent': '#00FFFF',
}
/** Schrift = Grund. Der Fall „ich habe mich ausgesperrt". */
const UNSICHTBAR = { '--bg': '#101010', '--ink': '#101010', '--surface': '#101010' }

const ssh = (cmd) =>
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `dietpi@${BOX}`, cmd], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

/** Eine Datei von der Box holen — base64, damit nichts an der Zeilenendung stirbt. */
const holen = (pfad) => Buffer.from(ssh(`base64 -w0 < ${JSON.stringify(pfad)}`), 'base64').toString('utf8')
/** … und hinlegen. Ueber eine Zwischendatei im GLEICHEN Verzeichnis, wie der Server es tut. */
const legen = (pfad, inhalt) => {
  const b64 = Buffer.from(inhalt, 'utf8').toString('base64')
  ssh(
    `printf %s ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(`${pfad}.gegenlesen.tmp`)} && mv ${JSON.stringify(`${pfad}.gegenlesen.tmp`)} ${JSON.stringify(pfad)}`,
  )
}
const md5 = (pfad) =>
  ssh(`md5sum ${JSON.stringify(pfad)} 2>/dev/null || echo '(nicht da)'`)
    .trim()
    .split(/\s+/)[0]

// ── PNG lesen, ohne Abhaengigkeit ──────────────────────────────────────────
/**
 * Nur so viel PNG, wie ein Schirmabzug von Chromium braucht: 8 Bit, RGBA oder
 * RGB, nicht verschraenkt.
 *
 * WARUM UEBERHAUPT: `getComputedStyle` sagt, was im Stilblatt steht. Ein
 * Bildpunkt sagt, was ein Mensch sieht. Zwischen beidem liegen Ueberdeckungen,
 * feste Farben in Regeln und Bilder — genau die Stellen, an denen ein
 * Farbwaehler nichts faerbt und trotzdem „wirkt" meldet.
 */
function pngLesen(buf) {
  let p = 8
  let breite = 0
  let hoehe = 0
  let tiefe = 0
  let typ = 0
  const teile = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const art = buf.toString('ascii', p + 4, p + 8)
    const d = buf.subarray(p + 8, p + 8 + len)
    if (art === 'IHDR') {
      breite = d.readUInt32BE(0)
      hoehe = d.readUInt32BE(4)
      tiefe = d[8]
      typ = d[9]
      if (tiefe !== 8 || (typ !== 6 && typ !== 2)) throw new Error(`PNG-Form ${tiefe}/${typ} nicht vorgesehen`)
      if (d[12] !== 0) throw new Error('verschraenktes PNG nicht vorgesehen')
    } else if (art === 'IDAT') teile.push(d)
    else if (art === 'IEND') break
    p += 12 + len
  }
  const roh = inflateSync(Buffer.concat(teile))
  const k = typ === 6 ? 4 : 3
  const zeile = breite * k
  const bild = Buffer.alloc(hoehe * zeile)
  for (let y = 0; y < hoehe; y++) {
    const f = roh[y * (zeile + 1)]
    const ein = roh.subarray(y * (zeile + 1) + 1, y * (zeile + 1) + 1 + zeile)
    const aus = bild.subarray(y * zeile, (y + 1) * zeile)
    for (let x = 0; x < zeile; x++) {
      const a = x >= k ? aus[x - k] : 0
      const b = y > 0 ? bild[(y - 1) * zeile + x] : 0
      const c = x >= k && y > 0 ? bild[(y - 1) * zeile + x - k] : 0
      let v = ein[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      aus[x] = v & 255
    }
  }
  const hex = (x, y) => {
    const i = y * zeile + x * k
    return `#${[bild[i], bild[i + 1], bild[i + 2]]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`
  }
  /** Die HAEUFIGSTE Farbe eines Ausschnitts — robuster als ein einzelner Punkt. */
  const haeufigste = (x0, y0, x1, y1) => {
    const zaehl = new Map()
    for (let y = y0; y < Math.min(y1, hoehe); y++) {
      for (let x = x0; x < Math.min(x1, breite); x++) {
        const h = hex(x, y)
        zaehl.set(h, (zaehl.get(h) || 0) + 1)
      }
    }
    return [...zaehl.entries()].sort((a, b) => b[1] - a[1])[0] || ['(leer)', 0]
  }
  return { breite, hoehe, hex, haeufigste }
}

// ── Browser ────────────────────────────────────────────────────────────────
// Der eigene Browser laeuft auf einem FREIEN Port mit eigenem Profil statt auf
// einer festen Nummer, die ein Ueberlebender eines harten Abbruchs noch halten
// koennte — /json/list liefert dann klaglos die Ziele des fremden. Die
// Messungen dahinter: tools/leihgabe.mjs.
let ws = null
let brw = null
let rufId = 0
const offen = new Map()

async function browserAuf() {
  // `--hide-scrollbars` wie bisher: die Schirmabzuege werden byteweise
  // ausgewertet, ein Rollbalken waere ein Fremdkoerper im Bild.
  brw = await eigenerBrowser({ fenster: '800,480', zusatz: ['--hide-scrollbars'] })
  if (!brw) throw new Error('kein Browser gefunden (playwright/chromium)')
  const { default: WebSocket } = await import('ws')
  ws = new WebSocket(await brw.seite())
  await new Promise((r, x) => {
    ws.on('open', r)
    ws.on('error', x)
  })
  ws.on('message', (d) => {
    const n = JSON.parse(d)
    if (n.id && offen.has(n.id)) {
      offen.get(n.id)(n)
      offen.delete(n.id)
    }
  })
  const ruf = (method, params = {}) =>
    new Promise((r) => {
      const i = ++rufId
      offen.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  await ruf('Page.enable')
  await ruf('Runtime.enable')
  await ruf('Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  browserAuf.ruf = ruf
}
const ruf = (m, p) => browserAuf.ruf(m, p)
const browserZu = async () => {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await brw?.schliessen()
}

/**
 * Eine Seite laden, messen und abbilden.
 *
 * `licht` setzt vorher `localStorage` — der dunkle Stand haengt an
 * `mupibox_neu_licht_v1`, gelesen von einem Einzeiler ganz oben in index.html,
 * also VOR jedem Malen. Ohne eigenen Ladevorgang danach greift es nicht.
 */
async function seite(name, url, { licht = null, js = null, warten = 2600 } = {}) {
  if (licht) {
    await ruf('Page.navigate', { url: `http://${BOX}:8200/neu/` })
    await new Promise((r) => setTimeout(r, 1400))
    await ruf('Runtime.evaluate', {
      expression: `localStorage.setItem('mupibox_neu_licht_v1', ${JSON.stringify(licht)})`,
      returnByValue: true,
    })
  }
  await ruf('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, warten))
  const gemessen = js
    ? (await ruf('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })).result?.result?.value
    : null
  const { result: bild } = await ruf('Page.captureScreenshot', { format: 'png' })
  mkdirSync(BILDER, { recursive: true })
  const pfad = join(BILDER, `${name}.png`)
  const buf = Buffer.from(bild.data, 'base64')
  writeFileSync(pfad, buf)
  return { pfad, png: pngLesen(buf), gemessen }
}

/**
 * Was faerbt eine PIN-Taste — aus der REGEL, nicht aus dem Bild.
 *
 * Das Tastenfeld erscheint erst nach einem langen Druck auf den Eltern-Bereich;
 * die Geste im Schirmabzug nachzustellen waere ein zweiter, eigener Weg, der
 * schiefgehen kann und dann faelschlich „in Ordnung" meldete. Stattdessen wird
 * ein Element mit der echten Klasse in die echte Seite gehaengt und gefragt,
 * was der Browser daraus macht — dieselbe Kaskade, dasselbe Blatt.
 *
 * `.tor-taste` traegt BEIDE Merkmale (`background: var(--surface)` und
 * `color: var(--ink)`) und steht damit zwischen dem Kind und den
 * Einstellungen.
 */
async function tasteMessen() {
  return (
    await ruf('Runtime.evaluate', {
      expression: `(() => {
        const e = document.createElement('div')
        e.className = 'tor-taste'
        e.textContent = '5'
        document.body.appendChild(e)
        const s = getComputedStyle(e)
        const raus = { flaeche: s.backgroundColor, ziffer: s.color }
        e.remove()
        return raus
      })()`,
      returnByValue: true,
    })
  ).result?.result?.value
}

/** Was steht am laufenden Schirm an — Variablen UND echte Flaechen. */
const MESSEN = `(() => {
  const s = getComputedStyle(document.documentElement)
  const v = {}
  for (const n of ['--bg','--surface','--ink','--line2','--accent']) v[n] = s.getPropertyValue(n).trim()
  const w = (sel, eig) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[eig] : '(nicht da)' }
  return {
    licht: document.documentElement.getAttribute('data-licht') || 'hell',
    vars: v,
    body: getComputedStyle(document.body).backgroundColor,
    schrift: getComputedStyle(document.body).color,
    stellen: {
      Kachel: w('.kachel, .lane-kachel', 'backgroundColor'),
      Kacheltitel: w('.kachel-titel, .lane-titel', 'color'),
      Kopfzeile: w('.kopf, header', 'backgroundColor'),
    },
    blaetter: [...document.styleSheets].map((b) => {
      let n = -1; try { n = b.cssRules.length } catch { n = -2 }
      return ((b.href || '(inline)').replace(location.origin, '')) + ' (' + n + ')'
    }),
  }
})()`

// ── Bericht ────────────────────────────────────────────────────────────────
const kopf = (t) => console.log(`\n  ${t}\n  ${'─'.repeat(74)}`)
const zeile = (a, b) => console.log(`    ${String(a).padEnd(28)} ${b}`)
const punkte = []
const punkt = (gut, was, mehr = '') => {
  punkte.push({ gut, was })
  console.log(`    ${gut ? 'JA  ' : 'NEIN'}  ${was}${mehr ? `  — ${mehr}` : ''}`)
}

async function main() {
  console.log(`\n  FARBWAEHLER — GEGENGELESEN (Box ${BOX})`)
  console.log(`  Bilder: ${BILDER}`)

  // ── Bestand ──────────────────────────────────────────────────────────────
  kopf('0. Bestand — was steht da, bevor irgendetwas angefasst wird')
  const konfig = JSON.parse(holen(KONFIG))
  const thema = String(konfig?.mupibox?.theme ?? '').trim()
  const themaDatei = `${THEMENDIR}/${thema}.css`
  const md5Vorher = md5(themaDatei)
  const verweisZiel = ssh(`readlink -f ${JSON.stringify(VERWEIS)} 2>/dev/null || echo '(kein Verweis)'`).trim()
  zeile('mupibox.theme', thema)
  zeile('Themendatei', `${themaDatei}  md5 ${md5Vorher}`)
  zeile('active_theme.css ->', verweisZiel)
  zeile('Oberflaeche', String(konfig?.mupibox?.oberflaeche ?? '(nicht gesetzt)'))
  const cssVorher = holen(themaDatei)
  zeile('Block schon drin?', Object.keys(blockLesen(cssVorher)).length ? 'JA' : 'nein')

  await browserAuf()
  let fehlgeschlagen = false
  /**
   * Steht die Konfiguration gerade auf einem FREMDEN Thema?
   *
   * Muss ausserhalb des `try` stehen: bricht die Messung mittendrin ab, liefe
   * die Box sonst mit einem Thema weiter, das niemand gewaehlt hat — und der
   * Betreiber suchte den Fehler morgen an der falschen Stelle.
   */
  let fremdAktiv = false
  try {
    // ── 1. Vorher ──────────────────────────────────────────────────────────
    kopf('1. Der Schirm VORHER')
    const vorher = await seite('1-vorher-hell', `http://${BOX}:8200/neu/`, { licht: 'hell', js: MESSEN })
    zeile('Blaetter', vorher.gemessen.blaetter.join('  |  '))
    zeile('--bg / body', `${vorher.gemessen.vars['--bg']} / ${vorher.gemessen.body}`)
    const grundVorher = vorher.png.haeufigste(0, 400, 800, 480)
    zeile('haeufigster Punkt unten', `${grundVorher[0]} (${grundVorher[1]} Punkte)`)
    zeile('Bild', vorher.pfad)

    if (!PROBE) {
      console.log('\n  (ohne --probe wird nichts geschrieben — hier ist Schluss)')
      return
    }

    // ── 2. Schreiend faerben — mit dem ECHTEN blockErsetzen ────────────────
    kopf('2. FAERBT ES WIRKLICH? — schreiende Farben, am Bild geprueft')
    legen(themaDatei, blockErsetzen(cssVorher, SCHREIEND))
    const bunt = await seite('2-bunt-hell', `http://${BOX}:8200/neu/`, { licht: 'hell', js: MESSEN })
    for (const [n, w] of Object.entries(SCHREIEND)) {
      const ist = bunt.gemessen.vars[n]
      punkt(ist.toUpperCase() === w, `${n} steht am Schirm auf ${w}`, `gemessen ${ist}`)
    }
    const grundBunt = bunt.png.haeufigste(0, 400, 800, 480)
    punkt(
      grundBunt[0] === SCHREIEND['--bg'],
      `der GRUND ist im BILD ${SCHREIEND['--bg']}`,
      `haeufigste Farbe ${grundBunt[0]} (${grundBunt[1]} Punkte)`,
    )
    punkt(
      grundVorher[0] !== grundBunt[0],
      'das Bild hat sich ueberhaupt geaendert',
      `vorher ${grundVorher[0]}, jetzt ${grundBunt[0]}`,
    )
    zeile('Bild', bunt.pfad)

    // ── 3. Dunkel bleibt heil ──────────────────────────────────────────────
    kopf('3. Der DUNKLE Stand — bleibt er heil?')
    const dunkel = await seite('3-bunt-dunkel', `http://${BOX}:8200/neu/`, { licht: 'dunkel', js: MESSEN })
    const DUNKEL_SOLL = { '--bg': '#1A1726', '--surface': '#241F33', '--ink': '#F2EDE4', '--line2': '#3A3350' }
    for (const [n, w] of Object.entries(DUNKEL_SOLL)) {
      punkt(
        dunkel.gemessen.vars[n].toUpperCase() === w,
        `dunkel ${n} bleibt ${w}`,
        `gemessen ${dunkel.gemessen.vars[n]}`,
      )
    }
    // --accent steht im dunklen Block GAR NICHT — der Waehler trifft ihn also
    // auch dunkel nicht, und dunkel behaelt den AUSGELIEFERTEN Wert.
    zeile('dunkel --accent', `${dunkel.gemessen.vars['--accent']} (im dunklen Block nicht gesetzt)`)
    const grundDunkel = dunkel.png.haeufigste(0, 400, 800, 480)
    punkt(
      grundDunkel[0] === '#1A1726',
      'der dunkle GRUND ist im BILD unveraendert',
      `haeufigste Farbe ${grundDunkel[0]}`,
    )
    zeile('Bild', dunkel.pfad)

    // ── 4. Ueberlebt ein zweiter Seitenaufbau ──────────────────────────────
    kopf('4. Ueberlebt die Farbe einen NEUAUFBAU der Oberflaeche?')
    const wieder = await seite('4-nach-neuaufbau', `http://${BOX}:8200/neu/?t=${Date.now()}`, {
      licht: 'hell',
      js: MESSEN,
    })
    punkt(
      wieder.gemessen.vars['--bg'].toUpperCase() === SCHREIEND['--bg'],
      'nach dem zweiten Laden steht die Farbe noch',
      `${wieder.gemessen.vars['--bg']}`,
    )
    const grundWieder = wieder.png.haeufigste(0, 400, 800, 480)
    punkt(grundWieder[0] === SCHREIEND['--bg'], 'und sie ist im Bild', grundWieder[0])

    // ── 5. Aussperren ──────────────────────────────────────────────────────
    kopf('5. KANN MAN SICH AUSSPERREN? Schrift = Grund')
    legen(themaDatei, blockErsetzen(cssVorher, UNSICHTBAR))
    const blind = await seite('5-unsichtbar', `http://${BOX}:8200/neu/`, { licht: 'hell', js: MESSEN })
    const alles = blind.png.haeufigste(0, 0, 800, 480)
    punkt(
      true,
      'die Box IST dann unlesbar (das ist erlaubt, aber es soll dastehen)',
      `${alles[1]} von ${800 * 480} Punkten sind ${alles[0]}`,
    )
    // Die Verwaltung laeuft auf einem anderen Blatt. Wenn das nicht stimmt,
    // ist der Rueckweg zu.
    const verw = await seite('5-verwaltung', `http://${BOX}:8200/admin/darstellung`, {
      js: `(() => { const s = getComputedStyle(document.body); return { grund: s.backgroundColor, schrift: s.color, text: (document.body.innerText||'').slice(0,120) } })()`,
      warten: 3200,
    })
    const gleich = verw.gemessen.grund === verw.gemessen.schrift
    punkt(
      !gleich,
      'die VERWALTUNG bleibt lesbar — der Rueckweg steht offen',
      `Grund ${verw.gemessen.grund}, Schrift ${verw.gemessen.schrift}`,
    )
    punkt(
      (verw.gemessen.text || '').length > 10,
      'und sie zeigt Text',
      JSON.stringify((verw.gemessen.text || '').replace(/\s+/g, ' ').slice(0, 60)),
    )
    zeile('Bilder', `${blind.pfad}  ${verw.pfad}`)

    // ── 6. Fremdes Thema ───────────────────────────────────────────────────
    if (FREMD) {
      kopf('6. EIN THEMA, DAS DIE NEUEN VARIABLEN NICHT KENNT')
      // Wieder die schreienden Farben ins EIGENE Thema, damit ein Unterschied
      // sichtbar waere, wenn das fremde Thema etwas davon mitnaehme.
      legen(themaDatei, blockErsetzen(cssVorher, SCHREIEND))
      ssh(`test -f ${KONFIG}.gegenlesen-sicherung || sudo -n cp -a ${KONFIG} ${KONFIG}.gegenlesen-sicherung`)
      const fremd = ssh(`ls ${THEMENDIR} | grep -v '^${thema}\\.css$' | head -1`)
        .trim()
        .replace(/\.css$/, '')
      zeile('fremdes Thema', fremd)
      fremdAktiv = true
      ssh(
        `sudo -n /usr/bin/jq '.mupibox.theme="${fremd}"' ${KONFIG} > /tmp/mk.json && sudo -n cp /tmp/mk.json ${KONFIG} && sudo -n /usr/local/bin/mupibox/setting_update.sh >/dev/null 2>&1; readlink -f ${VERWEIS}`,
      )
      zeile('Verweis jetzt', ssh(`readlink -f ${JSON.stringify(VERWEIS)}`).trim())
      const f = await seite('6-fremdes-thema', `http://${BOX}:8200/neu/`, { licht: 'hell', js: MESSEN })
      const VORGABE = {
        '--bg': '#FFF7EC',
        '--surface': '#FFFFFF',
        '--ink': '#2E2A3B',
        '--line2': '#EFE7DA',
        '--accent': '#FF6B57',
      }
      const abweichend = Object.entries(VORGABE).filter(([n, w]) => f.gemessen.vars[n].toUpperCase() !== w)
      punkt(
        abweichend.length === 0,
        'ALLE fuenf stehen auf der Auslieferung — nicht halb gefaerbt',
        abweichend.length
          ? JSON.stringify(Object.fromEntries(abweichend.map(([n]) => [n, f.gemessen.vars[n]])))
          : `${Object.keys(VORGABE).length}/5`,
      )
      const gf = f.png.haeufigste(0, 400, 800, 480)
      punkt(gf[0] === '#FFF7EC', 'und das Bild zeigt den ausgelieferten Grund', gf[0])
      zeile('Bild', f.pfad)
    }

    // ── 6b. Die Zahl, die daneben steht — deckt sie, was sie zu decken vorgibt?
    kopf('6b. DER KONTRASTWERT gegen die zweite Flaeche')
    // Der Waehler misst `--ink` auf `--bg`. Auf `--surface` sitzen aber die
    // Seitenleiste, die PIN-Tasten (`.tor-taste { background: var(--surface);
    // color: var(--ink) }`) und die Karten. Wer NUR die Flaeche verstellt,
    // laesst die gemeldete Zahl unberuehrt.
    legen(themaDatei, blockErsetzen(cssVorher, { '--surface': '#2E2A3B' }))
    const falle = await seite('6b-flaeche-gleich-schrift', `http://${BOX}:8200/neu/`, { licht: 'hell', js: MESSEN })
    const leiste = falle.png.haeufigste(0, 120, 80, 400)
    zeile('--ink / --surface', `${falle.gemessen.vars['--ink']} / ${falle.gemessen.vars['--surface']}`)
    zeile('Seitenleiste im Bild', `${leiste[0]} (${leiste[1]} Punkte)`)
    punkt(
      leiste[0] !== '#2E2A3B',
      'die Seitenleiste ist noch von ihrer Schrift zu unterscheiden',
      'sonst meldet der Waehler 13,09 : 1 und die Leiste ist trotzdem unlesbar',
    )
    zeile('Bild', falle.pfad)
    // Die schaerfste Stelle: `.tor-taste` traegt BEIDE Merkmale
    // (`background: var(--surface); color: var(--ink)`). Sind sie gleich, ist
    // die PIN-Eingabe eine leere Flaeche — und genau sie steht zwischen dem
    // Kind und den Einstellungen.
    const taste = await tasteMessen()
    punkt(
      taste.flaeche !== taste.ziffer,
      'die PIN-Taste hebt sich von ihrer Ziffer ab',
      `Flaeche ${taste.flaeche}, Ziffer ${taste.ziffer}`,
    )

    // ── 7. Neustart der BOX ────────────────────────────────────────────────
    if (NEUSTART) {
      kopf('7. UEBERLEBT DIE FARBE EINEN NEUSTART DER BOX?')
      // Die Frage ist ernster, als sie klingt: `setting_update.sh` laeuft laut
      // eigenem Kopf „before Shutdown", und ein Boot koennte Dateien
      // wiederherstellen. Argumentieren hilft hier nicht — nur ausschalten.
      legen(themaDatei, blockErsetzen(cssVorher, SCHREIEND))
      const vorNeustart = md5(themaDatei)
      zeile('md5 mit Block', vorNeustart)
      try {
        ssh('sudo -n systemctl reboot')
      } catch {
        /* die Verbindung stirbt mit dem Befehl — das ist der Normalfall */
      }
      let zurueck = false
      for (let i = 0; i < 90 && !zurueck; i++) {
        await new Promise((r) => setTimeout(r, 4000))
        try {
          const r = await fetch(`http://${BOX}:8200/neu/app.css`, { signal: AbortSignal.timeout(3000) })
          zurueck = r.status === 200 && (r.headers.get('content-type') || '').includes('css')
        } catch {
          /* noch unterwegs */
        }
      }
      punkt(zurueck, 'die Box ist wieder da', `nach dem Neustart, ${ssh('uptime -p').trim()}`)
      punkt(
        md5(themaDatei) === vorNeustart,
        'die Themendatei hat den Neustart unveraendert ueberstanden',
        md5(themaDatei),
      )
      const nachVerweis = ssh(`readlink -f ${JSON.stringify(VERWEIS)} 2>/dev/null || echo '(kein Verweis)'`).trim()
      punkt(nachVerweis === themaDatei, 'der Verweis zeigt nach dem Neustart noch richtig', nachVerweis)
      const n = await seite('7-nach-neustart', `http://${BOX}:8200/neu/`, { licht: 'hell', js: MESSEN, warten: 4000 })
      punkt(
        n.gemessen.vars['--bg'].toUpperCase() === SCHREIEND['--bg'],
        'und die Farbe steht am Schirm',
        n.gemessen.vars['--bg'],
      )
      const gn = n.png.haeufigste(0, 400, 800, 480)
      punkt(gn[0] === SCHREIEND['--bg'], 'und im Bild', gn[0])
      zeile('Bild', n.pfad)
    }
  } catch (e) {
    fehlgeschlagen = true
    console.log(`\n  ABBRUCH: ${e?.message || e}`)
  } finally {
    // ── Zuruecklegen ───────────────────────────────────────────────────────
    kopf('Z. Zuruecklegen')
    if (fremdAktiv) {
      try {
        ssh(
          `sudo -n cp -a ${KONFIG}.gegenlesen-sicherung ${KONFIG} && sudo -n /usr/local/bin/mupibox/setting_update.sh >/dev/null 2>&1; true`,
        )
        const zurueck = ssh(`readlink -f ${JSON.stringify(VERWEIS)}`).trim()
        zeile('mupibox.theme', JSON.parse(holen(KONFIG))?.mupibox?.theme)
        punkt(zurueck === themaDatei, 'der Verweis zeigt wieder auf das eigene Thema', zurueck)
      } catch (e) {
        console.log(`    THEMA ZURUECKSETZEN FEHLGESCHLAGEN: ${e?.message || e}`)
      }
    }
    try {
      legen(themaDatei, cssVorher)
      const md5Nachher = md5(themaDatei)
      zeile('md5 vorher', md5Vorher)
      zeile('md5 nachher', md5Nachher)
      punkt(md5Vorher === md5Nachher, 'die Themendatei liegt byteweise wieder da')
      ssh(`rm -f ${JSON.stringify(`${themaDatei}.gegenlesen.tmp`)}`)
    } catch (e) {
      console.log(`    ZURUECKLEGEN FEHLGESCHLAGEN: ${e?.message || e}`)
    }
    await browserZu()
  }

  kopf('ERGEBNIS')
  const schlecht = punkte.filter((p) => !p.gut)
  console.log(`    ${punkte.length - schlecht.length} von ${punkte.length} Punkten.`)
  for (const s of schlecht) console.log(`    OFFEN: ${s.was}`)
  process.exit(fehlgeschlagen || schlecht.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await browserZu()
  process.exit(1)
})
