#!/usr/bin/env node
/**
 * DER FARBSATZ AM SCHIRM — kommt die gerechnete Palette wirklich an?
 *
 * ══ WARUM ES DIESES WERKZEUG GIBT ══════════════════════════════════════════
 *
 * tools/farbsaetze-bauen.mjs RECHNET achtzehn Paletten aus, tools/farbsaetze-
 * messen.mjs prueft ihre zweihundert Kontrastwerte. Beide reden ueber Zahlen
 * in einer Datei. DAS IST NICHT DER SCHIRM.
 *
 * Der Trugschluss „es steht doch so in der Datei" hat an diesem Baum schon
 * dreimal zugeschlagen: eine Regel griff nach `var(--akzent)` statt `--accent`,
 * und CSS wirft so eine Erklaerung STILL weg — kein Fehler, keine Konsole,
 * nichts. Beim Wappen-Ring war es dasselbe: die Groesse stimmte,
 * `--wappen-fuell` wuchs sauber von 0 auf 1, UND ES WURDE NICHTS GEMALT.
 *
 * Bei den Farbsaetzen kommen zwei eigene Fallen dazu:
 *
 *   1. DIE SPEZIFITAET. `:root[data-farbe='blau']` und
 *      `:root[data-licht='dunkel']` haben BEIDE 0,2,0 — welcher gewinnt,
 *      entscheidet allein die Reihenfolge in der Datei. Wer die Bloecke
 *      verschiebt, aendert die Farben, ohne eine Farbe angefasst zu haben.
 *      Dagegen steht der kombinierte Wahler (0,3,0), und ob der wirklich
 *      greift, sagt nur der Browser.
 *
 *   2. DAS AUFBLITZEN. `data-farbe` wird an ZWEI Stellen gesetzt: vom
 *      Einzeiler im Kopf von index.html (gegen das Aufblitzen) und von
 *      `farbeStarten()` in app.js. Faellt der Einzeiler aus, faellt NICHTS
 *      aus — die Box wird nur bei jedem Neuladen erst cremefarben und dann
 *      blau. Das meldet niemand als Fehler; man sieht es und findet sich
 *      damit ab. Fall 4 misst, dass das Attribut schon steht, BEVOR der erste
 *      Knopf im Baum ist.
 *
 * ══ WAS BEHAUPTET WIRD ═════════════════════════════════════════════════════
 *   1. Ohne Wahl steht KEIN `data-farbe` da, und die Farben sind die des
 *      Bestands.
 *   2. Jeder der neun Knoepfe im Admin-Menue stellt SEINE Palette — alle
 *      zehn Werte, am `<html>` gemessen, gegen die Rechnung gehalten.
 *   3. Die Wahl ueberlebt das Neuladen.
 *   4. Und sie steht schon VOR dem ersten Element des Baums (kein Aufblitzen).
 *   5. Hell und dunkel gehen mit: derselbe Farbsatz traegt im Dunklen die
 *      dunkle Palette — der kombinierte Wahler greift.
 *   6. Ein unbekannter Wert im Speicher faellt auf die Vorgabe zurueck UND
 *      wird dabei aufgeraeumt.
 *   7. Die neun Muster halten die 9-mm-Marke und zeigen JE ihre eigene
 *      Palette (nicht fuenfmal die gerade eingestellte).
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Es schreibt in den
 * localStorage seines EIGENEN headless-Browsers.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/farbsatz-am-schirm.mjs
 *   node tools/farbsatz-am-schirm.mjs --ziel http://127.0.0.1:9701/neu/
 *   node tools/farbsatz-am-schirm.mjs --ziel … --bilder /tmp/farbe
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { SAETZE, palette } from './farbsaetze-bauen.mjs'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = typeof opt('ziel', null) === 'string' ? opt('ziel') : argv.find((a) => a.startsWith('http')) || null
const BILDER = typeof opt('bilder', null) === 'string' ? opt('bilder') : null

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let fehler = 0
const ja = (gut, satz, dazu = '') => {
  if (!gut) fehler++
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${satz}${dazu ? `  — ${dazu}` : ''}`)
}

const ROLLEN = ['bg', 'surface', 'rowBg', 'ink', 'muted', 'line', 'line2', 'pill', 'pillInk', 'hl']

/**
 * WAS DER BROWSER ZURUECKGIBT, IN EINE HEX-SCHREIBWEISE.
 *
 * ZWEI FORMEN, UND DIE ERSTE HAT DIESES WERKZEUG SCHON EINMAL BLIND GEMACHT:
 * `getComputedStyle(...).getPropertyValue('--bg')` gibt bei einer
 * BENUTZERDEFINIERTEN Eigenschaft den ROHEN Text zurueck, also genau das, was
 * im Stilblatt steht — `#FFF7EC`. Nur bei ECHTEN Farbeigenschaften
 * (`color`, `background-color`) rechnet der Browser das in `rgb(...)` um.
 *
 * Der erste Anlauf kannte nur `rgb(...)` und zog aus `#2E2A3B` die drei
 * Ziffernfolgen „2", „2", „3" heraus — und meldete `#020203`. Sechzehn Zeilen
 * rot, kein einziger Fehler in der Sache. Genau die Sorte Messfehler, die wie
 * ein Befund aussieht.
 */
const hex = (s) => {
  const t = String(s).trim()
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toUpperCase()
  if (/^#[0-9a-fA-F]{3}$/.test(t)) return ('#' + [...t.slice(1)].map((c) => c + c).join('')).toUpperCase()
  const m = t.match(/(\d+(?:\.\d+)?)/g)
  if (!m || m.length < 3) return null
  return '#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase()
}

let vorschau = null
let ZIEL = MITGEGEBEN
process.on('exit', () => {
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
})

if (!ZIEL) {
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], { cwd: WURZEL, stdio: 'ignore' })
  vorschau.unref()
  let gestorben = null
  vorschau.on('exit', (c) => {
    gestorben = c
  })
  const bis = Date.now() + 10000
  for (;;) {
    if (gestorben !== null) throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} belegt`)
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
}
console.log(`ZIEL: ${ZIEL}${vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'}\n`)

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
  process.exit(0)
}

let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  /**
   * DER SPITZEL GEGEN DAS AUFBLITZEN.
   *
   * Er wird VOR jedem Skript der Seite eingesetzt (`addScriptToEvaluateOn
   * NewDocument`) und haengt einen `MutationObserver` an das `<html>`. Sobald
   * `data-farbe` auftaucht, schreibt er auf, WIE VIEL VOM BAUM DA WAR:
   *
   *   0 Elemente im `<body>`  -> es war der Einzeiler im `<head>`
   *   der ganze Baum          -> es war app.js am Ende des `<body>`
   *
   * Nur der erste Fall verhindert das Aufblitzen. Ohne diese Unterscheidung
   * saehen beide Faelle gleich aus: das Attribut steht ja am Ende so oder so
   * da, und ein Bildschirmfoto NACH dem Laden zeigt in beiden Faellen die
   * richtige Farbe.
   */
  await send(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__farbeWann = null
      // ── AM document UND NICHT AM html-Element ───────────────────────
      // Dieses Skript laeuft VOR jedem Skript der Seite — und zu diesem
      // Zeitpunkt gibt es document.documentElement NOCH GAR NICHT. Der erste
      // Anlauf beobachtete es und starb still an einem null; die Aussage
      // „das Attribut wurde ueberhaupt gesetzt" war danach rot, obwohl es
      // gesetzt wurde. Das document gibt es immer, und subtree faengt das
      // html-Element, sobald der Zerleger es anlegt.
      // KEIN GEGENHAKEN IN DIESEM BLOCK: Er geht als Zeichenkette an den
      // Browser, und ein einziger beendete sie hier — der Fehler erschiene
      // dann zweihundert Zeilen weiter unten.
      new MutationObserver((m) => {
        for (const x of m) {
          if (x.attributeName !== 'data-farbe' || window.__farbeWann !== null) continue
          window.__farbeWann = {
            wert: document.documentElement.getAttribute('data-farbe'),
            koerperKinder: document.body ? document.body.children.length : -1,
            bereit: document.readyState,
          }
        }
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-farbe'] })
    `,
  })

  const ev = async (e) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  const bild = async (name) => {
    if (!BILDER) return null
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    const p = join(BILDER, `${name}.png`)
    await writeFile(p, Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${p}`)
    return p
  }

  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }

  /** Die zehn Farben, wie sie WIRKLICH am `<html>` stehen. */
  const amSchirm = () =>
    ev(`(() => {
      const s = getComputedStyle(document.documentElement)
      const raus = { farbe: document.documentElement.getAttribute('data-farbe'),
                     licht: document.documentElement.getAttribute('data-licht') }
      for (const r of ${JSON.stringify(ROLLEN)}) raus[r] = s.getPropertyValue('--' + r).trim()
      return raus
    })()`)

  /** Die Seite „Farbe und Form" aufschlagen. Ueber die Tastatur — siehe akkukurve-schau. */
  const farbseiteAuf = () =>
    ev(`(async () => {
      const w = document.getElementById('wappen')
      if (!w) return 'kein Wappen'
      w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise((r) => setTimeout(r, 1200))
      const g = [...document.querySelectorAll('#eltern-faecher button')].find((b) => b.textContent.trim() === 'Darstellung')
      if (!g) return 'keine Gruppe Darstellung'
      g.click()
      await new Promise((r) => setTimeout(r, 500))
      const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
        .find((x) => ((x.querySelector('.zeile-name') || {}).textContent || '') === 'Farbe und Form')
      if (!z) return 'keine Zeile Farbe und Form'
      ;(z.querySelector('button') || z).click()
      await new Promise((r) => setTimeout(r, 1500))
      // DIE ZAHL KOMMT AUS SAETZE UND STEHT NICHT MEHR FEST. Sie stand als
      // 5 da; mit dem sechsten Satz (Super-Rosa, 08.08.2026) brach dieses
      // Werkzeug ab, bevor es EINE Farbe gemessen hatte.
      return document.querySelectorAll('.farbwahl-muster').length === ${SAETZE.length}
        ? 'ok'
        : 'nicht ${SAETZE.length} Muster, sondern ' + document.querySelectorAll('.farbwahl-muster').length
    })()`)

  /** Alle Werte eines Satzes als Hex, so wie die Rechnung sie will. */
  const soll = (satzId, stand) => {
    const p = palette(satzId, stand)
    const raus = {}
    for (const r of ROLLEN) raus[r] = p[r].hex
    return raus
  }

  const vergleichen = (ist, satzId, stand, wo) => {
    const s = soll(satzId, stand)
    const falsch = ROLLEN.filter((r) => hex(ist[r]) !== s[r])
    ja(
      falsch.length === 0,
      `${wo}: alle zehn Farben sind die gerechneten`,
      falsch.length ? falsch.map((r) => `--${r} ist ${hex(ist[r])}, soll ${s[r]}`).join(' · ') : `--bg ${s.bg}`,
    )
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  1. OHNE WAHL — der Bestand, und KEIN Attribut
  // ═════════════════════════════════════════════════════════════════════════
  //
  // DAS FEHLENDE ATTRIBUT IST DIE AUSSAGE. Die Vorgabe „Creme" hat mit
  // Absicht keinen eigenen Block am `:root`; ein `data-farbe='creme'` waere
  // eine zweite Abschrift derselben zehn Werte und die erste Stelle, an der
  // die beiden auseinanderlaufen.
  console.log('══ 1. Ohne Wahl ══')
  await laden()
  await ev(`(() => { try { localStorage.clear(); sessionStorage.clear() } catch (_) {} return true })()`)
  await laden()
  {
    const s = await amSchirm()
    ja(s.farbe === null, 'am <html> steht KEIN data-farbe', String(s.farbe))
    // SEIT 66d12813 (10.08.2026) IST DUNKEL DIE VORGABE — „leer heisst
    // dunkel", nur eine ausdrueckliche Wahl bleibt hell (Einzeiler in
    // index.html). Dieses Werkzeug erwartete hier noch Hell und war damit
    // zwei Tage aelter als der Beschluss: alle 13 roten Aussagen vom
    // 15.08. waren DIESE Veraltung, kein Farbfehler.
    ja(s.licht === 'dunkel', 'und ohne Wahl steht der dunkle Stand — die Vorgabe seit dem 10.08.', String(s.licht))
    vergleichen(s, 'creme', 'dunkel', 'Vorgabe')
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  2. + 7. DIE KNOEPFE, SO VIELE ES SIND
  // ═════════════════════════════════════════════════════════════════════════
  console.log(`\n══ 2. Die ${SAETZE.length} Muster im Admin-Menue ══`)
  {
    // DIE HELL-VERGLEICHE DIESES ABSCHNITTS BRAUCHEN EINE AUSDRUECKLICHE
    // WAHL: seit Dunkel die Vorgabe ist (66d12813), erbt ein geleerter
    // Speicher den dunklen Stand — und die Muster zeigten ihre
    // Dunkel-Gruende, waehrend hier die hellen verglichen werden.
    await ev(`(() => { localStorage.setItem('mupibox_neu_licht_v1', 'hell'); return true })()`)
    await laden()
    const auf = await farbseiteAuf()
    if (auf !== 'ok') throw new Error(`Die Seite „Farbe und Form" liess sich nicht aufschlagen: ${auf}`)

    // ── DIE MARKE, BEVOR IRGENDETWAS GETIPPT WIRD ──────────────────────
    // Knoepfe zu 66 px sind 9,24 mm (ISO 9241-411). Sie sind BEDIENUNG
    // und zaehlen in tools/beruehrziele-neu.mjs mit; hier stehen sie, weil
    // sie zu DIESER Reihe gehoeren und ein Umbau der Karte sie alle fuenf auf
    // einmal verschiebt.
    const masse = await ev(`[...document.querySelectorAll('.farbwahl-muster')].map((k) => {
      const b = k.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)] })`)
    const klein = masse.filter(([b, h]) => Math.min(b, h) * 0.14 < 9)
    ja(klein.length === 0, `jedes der ${SAETZE.length} Muster haelt die 9-mm-Marke`, masse.map((m) => m.join('x')).join(' '))

    // ── JEDES MUSTER ZEIGT SEINE EIGENE PALETTE ────────────────────────
    // Der Fehler, den das faengt: Waeren die Muster nicht ueber `data-farbe`
    // eingefaerbt, zeigten alle fuenf die GERADE EINGESTELLTE Palette. Am
    // Schirm saehe das aus wie fuenf gleiche Knoepfe — und man haelt es fuer
    // Absicht, nicht fuer einen Fehler.
    const gruende = await ev(`[...document.querySelectorAll('.farbwahl-muster')].map((k) =>
      getComputedStyle(k).getPropertyValue('--bg').trim())`)
    const sollGruende = SAETZE.map((s) => palette(s.id, 'hell').bg.hex)
    const passen = gruende.every((g, i) => hex(g) === sollGruende[i])
    ja(passen, 'jedes Muster traegt den Grund SEINER Palette', gruende.map(hex).join(' '))
    await bild('alle-muster')  // hiess 'die-fuenf-muster', als es fuenf waren

    for (let i = 0; i < SAETZE.length; i++) {
      const satz = SAETZE[i]
      await ev(`(async () => {
        document.querySelectorAll('.farbwahl-muster')[${i}].click()
        await new Promise((r) => setTimeout(r, 400)); return true })()`)
      const s = await amSchirm()
      const willAttribut = satz.id === 'creme' ? null : satz.id
      ja(s.farbe === willAttribut, `„${satz.wort}" setzt data-farbe richtig`, `${s.farbe}`)
      vergleichen(s, satz.id, 'hell', `„${satz.wort}"`)
      const gewaehlt = await ev(`[...document.querySelectorAll('.farbwahl-muster')]
        .map((k) => k.getAttribute('aria-pressed')).join(' ')`)
      const willPressed = SAETZE.map((x) => (x.id === satz.id ? 'true' : 'false')).join(' ')
      ja(gewaehlt === willPressed, `  und genau eines traegt aria-pressed="true"`, gewaehlt)
      if (satz.id === 'gruen') await bild('gruen-gewaehlt')
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  3. + 4. DAS NEULADEN — und WANN das Attribut steht
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n══ 3./4. Neuladen, und kein Aufblitzen ══')
  {
    await ev(`localStorage.setItem('mupibox_neu_farbe_v1', 'blau')`)
    await laden()
    const s = await amSchirm()
    ja(s.farbe === 'blau', 'die Wahl ueberlebt das Neuladen', String(s.farbe))
    vergleichen(s, 'blau', 'hell', 'nach dem Neuladen')
    const wann = await ev(`window.__farbeWann`)
    ja(!!wann, 'das Attribut wurde ueberhaupt gesetzt', JSON.stringify(wann))
    // NULL KINDER IM `<body>` HEISST: der Einzeiler im `<head>` war es. Waere
    // es app.js am Ende des Koerpers, staende hier der ganze Baum — und die
    // Box wuerde bei jedem Neuladen erst cremefarben aufblitzen.
    ja(
      !!wann && wann.koerperKinder <= 0,
      'und zwar VOR dem ersten Element des Baums (kein Aufblitzen)',
      wann ? `${wann.koerperKinder} Kinder im <body>, readyState ${wann.bereit}` : '—',
    )
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  5. HELL UND DUNKEL GEHEN MIT — der kombinierte Wahler
  // ═════════════════════════════════════════════════════════════════════════
  //
  // DIE FALLE HIER IST DIE SPEZIFITAET. `:root[data-farbe='blau']` und
  // `:root[data-licht='dunkel']` haben beide 0,2,0; welcher gewinnt, saget
  // allein die Reihenfolge in app.css. Der kombinierte Wahler hat 0,3,0 und
  // gewinnt immer — aber nur, wenn er auch da ist und alle zehn Werte nennt.
  console.log('\n══ 5. Derselbe Satz im Dunklen ══')
  for (const satz of SAETZE) {
    await ev(
      `(() => { localStorage.setItem('mupibox_neu_farbe_v1', '${satz.id}')
        localStorage.setItem('mupibox_neu_licht_v1', 'dunkel'); return true })()`,
    )
    await laden()
    const s = await amSchirm()
    ja(s.licht === 'dunkel', `„${satz.wort}": der dunkle Stand steht`, String(s.licht))
    vergleichen(s, satz.id, 'dunkel', `„${satz.wort}" dunkel`)
    if (satz.id === 'rosa') await bild('rosa-dunkel')
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  6. EIN UNBEKANNTER WERT
  // ═════════════════════════════════════════════════════════════════════════
  //
  // `data-farbe` faehrt in einen CSS-Wahler. Ein Name, den das Stilblatt nicht
  // kennt (ein alter Eintrag, ein Tippfehler), waere ein Wahler, den es nicht
  // gibt — die Palette fiele STILL auf die Vorgabe zurueck, und im Admin-Menue
  // traege KEIN Muster den Haken. Man saehe eine cremefarbene Box und faende
  // den Grund nicht.
  console.log('\n══ 6. Ein unbekannter Wert im Speicher ══')
  {
    await ev(
      `(() => { localStorage.setItem('mupibox_neu_farbe_v1', 'tuerkis')
        localStorage.setItem('mupibox_neu_licht_v1', 'hell'); return true })()`,
    )
    await laden()
    const s = await amSchirm()
    ja(s.farbe === null, 'er faellt auf die Vorgabe zurueck', String(s.farbe))
    vergleichen(s, 'creme', 'hell', 'nach dem Rueckfall')
    const drin = await ev(`localStorage.getItem('mupibox_neu_farbe_v1')`)
    // UND ER WIRD AUFGERAEUMT. Bliebe „tuerkis" liegen, faerbte er bei jedem
    // Start nichts — und beim naechsten Umbau, der einen Satz „tuerkis"
    // einfuehrt, waere er ploetzlich wieder da.
    ja(drin === 'creme', 'und der Speicher traegt danach die Vorgabe', String(drin))
  }

  console.log(`\n${fehler === 0 ? 'ALLES GRUEN' : `${fehler} Aussage(n) halten NICHT`}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
  vorschau?.kill()
}
process.exit(fehler === 0 ? 0 : 1)
