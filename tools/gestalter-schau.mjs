#!/usr/bin/env node
/**
 * GESTALTER-SCHAU — der Theme-Gestalter einmal ganz durch, im Browser.
 *
 * ══ WAS SIE PRUEFT (BACKLOG E144, 27.09.2026) ═══════════════════════════════
 * Der Gestalter ist eine Bedienoberflaeche — ob Ziehen und Ablegen wirklich
 * etwas an der Box aendert, sagt kein Unit-Test. Diese Schau startet die
 * Attrappe (tools/neu-vorschau.mjs) auf einem freien Port, oeffnet
 * /neu/gestalter/ in Chromium und macht, was ein Mensch macht:
 *
 *   1. Titelband, Maskottchen, Mini-Player (oben Mitte) und die Uhr auf den
 *      Schirm ziehen — und in der VORSCHAU (dem echten app.js) nachsehen,
 *      dass die Klassen/Knoten wirklich stehen;
 *   2. eine Farbe auf „Akzent" und einen Verlauf auf den Hintergrund ziehen
 *      — die CSS-Variablen der Vorschau muessen sie tragen;
 *   3. Strg+Z nimmt den Verlauf zurueck;
 *   4. das Eigenschaften-Blatt des Mini-Players hat Regler;
 *   5. „Auf der Box anwenden" landet in /api/darstellung, „Als Thema
 *      ablegen" in der Themenliste, „Datei speichern" gibt eine Datei, die
 *      das Format-Tor besteht;
 *   6. keine Seitenfehler (pageerror) im Gestalter und in der Vorschau.
 *
 * DER BEFUND, DER SIE AUSGELOEST HAT: Beim ersten Durchlauf blieb jeder Zug
 * am Zeiger kleben — das Loslassen ueber der Vorschau landete im iframe,
 * nicht im Gestalter. Kein Unit-Test haette das gesehen.
 *
 * AUFRUF
 *     node tools/gestalter-schau.mjs              # Bericht, Rueckgabe 0/1
 *     node tools/gestalter-schau.mjs --bild DATEI # dazu ein Bildschirmfoto
 *
 * OHNE BROWSER (kein playwright auffindbar) meldet sie „uebersprungen" und
 * endet mit 0 — dieselbe Regel wie die anderen Browser-Schauen in pruefen.sh.
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')

function playwrightLaden() {
  const orte = [join(WURZEL, 'package.json')]
  try {
    orte.push(join(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 'noop.js'))
  } catch {
    /* kein npm */
  }
  for (const ort of orte) {
    try {
      return createRequire(ort)('playwright')
    } catch {
      /* weiter */
    }
  }
  return null
}

function freierPort() {
  return new Promise((gut) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => gut(port))
    })
  })
}

const pw = playwrightLaden()
if (!pw) {
  console.log('Gestalter-Schau: uebersprungen (kein playwright gefunden).')
  process.exit(0)
}

const port = await freierPort()
const attrappe = spawn(process.execPath, [join(WURZEL, 'tools/neu-vorschau.mjs'), '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((gut, schlecht) => {
  const t = setTimeout(() => schlecht(new Error('Attrappe startet nicht')), 15000)
  attrappe.stdout.on('data', (d) => {
    if (String(d).includes('Vorschau:')) {
      clearTimeout(t)
      gut()
    }
  })
})

const basis = `http://127.0.0.1:${port}`
const befunde = []
const pruefe = (ok, satz) => {
  befunde.push({ ok: !!ok, satz })
}

const kandidaten = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
const pfad = kandidaten.find((k) => existsSync(k))
const browser = await pw.chromium.launch(pfad ? { executablePath: pfad } : {})
try {
  const seite = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true })
  const fehler = []
  seite.on('pageerror', (e) => fehler.push(e.message))
  await seite.goto(`${basis}/neu/gestalter/`)
  await seite.waitForSelector('[data-element="titelband"]')
  await seite.waitForTimeout(1500)

  const inSchirm = async (x, y) => {
    const r = await seite.locator('#schirm-innen').boundingBox()
    const s = r.width / 800
    return { x: r.x + x * s, y: r.y + y * s }
  }
  const mitte = async (auswahl) => {
    const r = await seite.locator(auswahl).first().boundingBox()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }
  const ziehe = async (von, nach) => {
    await seite.locator(von).first().scrollIntoViewIfNeeded()
    const a = await mitte(von)
    await seite.mouse.move(a.x, a.y)
    await seite.mouse.down()
    await seite.mouse.move(a.x + 12, a.y + 12, { steps: 3 })
    await seite.waitForTimeout(300)
    const z = await nach()
    await seite.mouse.move(z.x, z.y, { steps: 10 })
    await seite.mouse.up()
    await seite.waitForTimeout(400)
  }
  const inVorschau = (fn) => seite.evaluate(`(${fn})(document.querySelector('#vorschau').contentDocument)`)

  // 1. Elemente andocken
  await ziehe('[data-element="titelband"]', () => inSchirm(400, 88))
  await ziehe('[data-element="maskottchen"]', () => inSchirm(150, 420))
  await ziehe('[data-element="kissen"]', () => inSchirm(440, 110))
  await ziehe('[data-element="kopf.uhr"]', () => inSchirm(400, 30))
  await seite.waitForTimeout(500)
  const v1 = await inVorschau(`(d) => ({
    klassen: d.body.className,
    band: !d.getElementById('titelband').hidden,
    bandText: d.getElementById('tb-text').textContent,
    mk: !d.getElementById('maskottchen').hidden,
    ecke: d.getElementById('maskottchen').dataset.ecke,
  })`)
  pruefe(v1.band && v1.bandText === 'Meine MixPiBox', `Titelband steht in der Vorschau (${JSON.stringify(v1.bandText)})`)
  pruefe(v1.mk && v1.ecke === 'unten-links', `Maskottchen steht unten links (${v1.ecke})`)
  pruefe(/\bmp-oben\b/.test(v1.klassen) && /\bmp-mitte\b/.test(v1.klassen), 'Mini-Player oben Mitte (body.mp-oben.mp-mitte)')

  // 2. Farben und Hintergrund
  await ziehe('.farbe[data-farbe="#8E5CF7"]', () => mitte('[data-farbziel="farben.akzent"]'))
  await ziehe('#p-hg .hg >> nth=1', () => inSchirm(400, 240))
  await seite.waitForTimeout(400)
  const v2 = await inVorschau(`(d) => ({
    akzent: d.documentElement.style.getPropertyValue('--accent'),
    hg: d.documentElement.style.getPropertyValue('--mupi-hg'),
  })`)
  pruefe(v2.akzent === '#8E5CF7', `Akzent in der Vorschau (${v2.akzent})`)
  pruefe(/linear-gradient/.test(v2.hg), 'Verlauf als Hintergrund in der Vorschau')

  // 3. Rueckgaengig
  await seite.keyboard.press('Control+z')
  await seite.waitForTimeout(400)
  const v3 = await inVorschau(`(d) => d.documentElement.style.getPropertyValue('--mupi-hg')`)
  pruefe(v3 === '', 'Strg+Z nimmt den Hintergrund zurueck')

  // 4. Eigenschaften des Mini-Players
  await seite.locator('[data-element="kissen"]').first().click()
  await seite.waitForTimeout(200)
  const regler = await seite.locator('#b-element .feld').count()
  pruefe(regler >= 10, `Eigenschaften-Blatt des Mini-Players hat Regler (${regler})`)

  // 5. Speichern, Anwenden, Ablegen
  await seite.fill('#name', 'Schau-Thema')
  const [download] = await Promise.all([seite.waitForEvent('download'), seite.click('#speichern')])
  const datei = JSON.parse(await (await download.createReadStream()).toArray().then((t) => Buffer.concat(t).toString()))
  const format = await import(new URL('../NewDesign/gestalter/format.mjs', import.meta.url).href)
  const tor = format.pruefeThema(datei)
  pruefe(tor.ok && datei.name === 'Schau-Thema', `Gespeicherte Datei besteht das Tor (${tor.fehler.join('; ') || 'ok'})`)

  await seite.click('#anwenden')
  await seite.waitForTimeout(500)
  const stand = await (await fetch(`${basis}/api/darstellung`)).json()
  pruefe(stand.aktuell?.titelBandAn === true && stand.aktuell?.mpPlatz === 'oben', 'Anwenden landet in /api/darstellung')

  await seite.click('#ablegen')
  await seite.waitForTimeout(500)
  const stand2 = await (await fetch(`${basis}/api/darstellung`)).json()
  pruefe(Object.hasOwn(stand2.themen || {}, 'Schau-Thema'), 'Ablegen: das Thema steht in der Themenliste')

  // 6. Player-Ansicht laedt, keine Seitenfehler
  await seite.click('[data-ansicht="player"]')
  await seite.waitForTimeout(1500)
  const player = await inVorschau(`(d) => !!d.getElementById('gross') && !d.getElementById('gross').hidden`)
  pruefe(player, 'Player-Ansicht zeigt den grossen Player')
  const bild = process.argv.indexOf('--bild')
  if (bild > 0 && process.argv[bild + 1]) {
    await seite.click('[data-ansicht="start"]')
    await seite.waitForTimeout(1500)
    await seite.screenshot({ path: process.argv[bild + 1] })
  }
  pruefe(fehler.length === 0, `keine Seitenfehler${fehler.length ? `: ${fehler.join(' | ')}` : ''}`)
} finally {
  await browser.close()
  attrappe.kill()
}

for (const b of befunde) console.log(`${b.ok ? '  ok ' : 'FEHL '} ${b.satz}`)
const schief = befunde.filter((b) => !b.ok).length
console.log(schief ? `\nGestalter-Schau: ${schief} von ${befunde.length} schief.` : `\nGestalter-Schau: alle ${befunde.length} gruen.`)
process.exit(schief ? 1 : 0)
