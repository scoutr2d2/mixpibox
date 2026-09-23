#!/usr/bin/env node
/**
 * DAS QR-ZEICHEN AUS DEM BILDSCHIRMFOTO WIEDER EINLESEN — die einzige Aussage,
 * die den Unterschied zwischen einem QR und einem Muster kennt.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * NewDesign/app.js erzeugt das Zeichen SELBST (Byte-Modus, Fehlerklasse M,
 * Version 1–3; die Begruendung gegen die Bibliothek steht dort). Alles daran
 * laesst sich falsch machen, ohne dass man es sieht: eine verdrehte Maske, ein
 * falsches Formatbit, eine vergessene Ruhezone, ein Modul um eins verschoben.
 * JEDER DIESER FEHLER ERGIBT EIN BILD, DAS WIE EIN QR-ZEICHEN AUSSIEHT.
 *
 * Ein Bildschirmfoto anzusehen beweist deshalb nichts. Beweisen laesst es sich
 * nur so: das Zeichen so aufnehmen, wie es am Schirm steht, es mit einem
 * FREMDEN Leser dekodieren und die herausgekommene Zeichenkette mit der
 * erwarteten Adresse vergleichen. Der fremde Leser ist `zbarimg` (zbar) und,
 * wenn vorhanden, zusaetzlich der Detektor von OpenCV — zwei unabhaengige
 * Leser, weil ein einzelner auch mal grosszuegig ist.
 *
 * ══ ES WIRD NICHT DAS SVG GELESEN, SONDERN DAS BILD ════════════════════════
 * Der Ausschnitt kommt aus `Page.captureScreenshot` mit `clip` auf das
 * Rechteck des Zeichens — also durch Stilblatt, Layout und Rasterung
 * hindurch. Ein Zeichen, das die Karte anschneidet, ein `border-radius`, der
 * die Ruhezone frisst, ein `transform: scale()`, das Module verschmiert: all
 * das faellt hier durch und faellt in einer Pruefung des Datenmodells nicht auf.
 *
 * ══ ES FASST DIE BOX NICHT AN ══════════════════════════════════════════════
 * Eigene Vorschau auf einem freien Port (`--port` wird ausdruecklich
 * mitgegeben — ohne ihn bediente sie 8299, und der gehoert womoeglich einem
 * anderen Arbeitsbaum, [[vorschau-wird-geliehen]]). Die Vorschau ist eine
 * Attrappe; nichts von hier erreicht jemals eine Box.
 *
 * ══ WAS ES PRUEFT ══════════════════════════════════════════════════════════
 *   1. Das Zeichen ist da und steht GANZ in der Karte (nicht angeschnitten).
 *   2. Es ist gross genug: die Modulkante in Millimetern auf dem 5-Zoll-Schirm.
 *   3. ZWEI Leser bekommen daraus GENAU die Adresse, die die Attrappe unter
 *      `/api/netzwerk` meldet — `http://<ip>:8200/spotify`.
 *   4. IM ZEICHEN STEHT NICHTS ANDERES. Kein Merkmal, keine Client-ID, kein
 *      Fragezeichen: die dekodierte Zeichenkette wird ZEICHENGENAU verglichen,
 *      nicht „enthaelt".
 *   5. Ohne Netz steht ein SATZ da und kein Zeichen (`/vorschau/netz-weg`).
 *   6. Die Adresse steht auch im Klartext auf der Seite — zum Abtippen.
 *   7. Ohne Client-ID steht das Zeichen trotzdem da (dort nuetzt es am meisten),
 *      und der Weg von Hand verlaesst das Blatt, BEVOR er eine Meldung erzeugt.
 *
 * ══ DIE GEGENPROBE IST GELAUFEN ════════════════════════════════════════════
 * Am 06.08.2026 wurde in NewDesign/app.js EIN Formatbit verdreht
 * (`qrFormatSchreiben`, Maske um eins verschoben) und dieses Werkzeug erneut
 * aufgerufen. Beide Leser erkannten daraufhin GAR NICHTS mehr, drei Aussagen
 * wurden rot. Das Zeichen sah dabei am Schirm unveraendert aus. Genau dafuer
 * gibt es dieses Werkzeug — und genau dabei fiel auf, dass die Zeile
 * „mindestens EIN fremder Leser" bis dahin nur die ANWESENHEIT geprueft hatte.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/qr-zurueckgelesen.mjs
 *   node tools/qr-zurueckgelesen.mjs --bilder /tmp/qr
 *   node tools/qr-zurueckgelesen.mjs --ziel http://127.0.0.1:9011/neu/
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const BEKANNT = ['ziel', 'bilder', 'port']
for (const a of argv) {
  if (!a.startsWith('--')) continue
  if (BEKANNT.includes(a.slice(2))) continue
  console.error(`${a} kennt dieses Werkzeug nicht. Bekannt: ${BEKANNT.map((f) => '--' + f).join(' ')}`)
  process.exit(2)
}
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const MITGEGEBEN = opt('ziel')
const BILDER = opt('bilder')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** 9011, wenn dort niemand lauscht — sonst irgendein freier. */
async function portOderFrei(wunsch) {
  try {
    await fetch(`http://127.0.0.1:${wunsch}/`, { signal: AbortSignal.timeout(400) })
    return await freierPort()
  } catch (e) {
    return e && e.name === 'TimeoutError' ? await freierPort() : wunsch
  }
}

/** Der Schirm der Box: 800x480 auf 5 Zoll = 0,1397 mm je Bildpunkt. */
const MM = 0.1397
/**
 * DIE UNTERGRENZE FUER EIN MODUL — 0,4 mm.
 *
 * Sie ist keine Norm, sondern eine Faustzahl aus der Praxis: unterhalb davon
 * wird ein Zeichen fuer Handykameras bei Zimmerlicht zaeh, weil ein Modul auf
 * weniger als zwei Kamerapixel faellt. Sie steht hier als ZAHL, damit ein
 * spaeterer Umbau der Karte („das Zeichen passt sonst nicht") nicht still
 * darunter rutscht. Ist sie gerissen, gehoert das Zeichen auf eine eigene
 * Seite und nicht kleiner gemacht.
 */
const MODUL_MM_MIN = 0.4

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '  — ' + wie : ''}`)
}

// ── Vorschau: eigene oder mitgegebene ──────────────────────────────────────
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
  // 9011 UND NICHT DER VORGABEPORT DER VORSCHAU: 8299 gehoert womoeglich einem
  // anderen Arbeitsbaum, und ein Lauf, der dessen Seite misst, sieht aus wie
  // der eigene ([[vorschau-wird-geliehen]]). Ist auch 9011 belegt, wird ein
  // freier genommen — aber nie stillschweigend ein fremder benutzter.
  const p = opt('port') || (await portOderFrei(9011))
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
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
console.log(`ZIEL: ${ZIEL}${vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)

/* ══ DIE ZWEI FREMDEN LESER ═════════════════════════════════════════════════
 *
 * SIE MUESSEN FREMD SEIN. Das Zeichen mit demselben Code zurueckzulesen, der
 * es erzeugt hat, prueft nur, dass er zu sich selbst passt — ein
 * spiegelverkehrtes Zeichen bestuende diese Probe. `zbarimg` und OpenCV kennen
 * NewDesign/app.js nicht.
 *
 * FEHLT EINER, WIRD DAS GESAGT UND NICHT UEBERGANGEN. Ein Werkzeug, das
 * stillschweigend nichts prueft, meldet gruen.
 */
function mitZbar(pfad) {
  try {
    const aus = execFileSync('zbarimg', ['-q', '--raw', '-Sbinary', pfad], { encoding: 'utf8' })
    return { da: true, text: aus.replace(/\n+$/, '') }
  } catch (e) {
    if (e && e.code === 'ENOENT') return { da: false, text: '' }
    // Ende 4 heisst bei zbarimg „nichts gefunden" — das ist eine ANTWORT.
    return { da: true, text: '' }
  }
}
function mitOpenCv(pfad) {
  const code = [
    'import sys, cv2',
    'b = cv2.imread(sys.argv[1])',
    'd = cv2.QRCodeDetector()',
    't, *_ = d.detectAndDecode(b)',
    'sys.stdout.write(t or "")',
  ].join('\n')
  try {
    return { da: true, text: execFileSync('python3', ['-c', code, pfad], { encoding: 'utf8' }) }
  } catch {
    return { da: false, text: '' }
  }
}

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

const ablage = BILDER || (await mkdtemp(join(tmpdir(), 'qr-zurueckgelesen-')))
await mkdir(ablage, { recursive: true })

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

let ws = null
try {
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }
  const bild = async (name, clip) => {
    const s = await send(ws, 'Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' })
    const p = join(ablage, `${name}.png`)
    await writeFile(p, Buffer.from(s.data, 'base64'))
    return p
  }
  const hinein = async () => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 1100 })
  }
  const gruppe = async (id) => {
    await ev(`document.querySelector('#eltern-faecher [data-fach="${id}"]').click()`)
    await warte(800)
  }
  const zeile = async (name) => {
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.trim().startsWith(${JSON.stringify(name)})) continue
        const k = z.querySelector('.zeile-tat')
        if (k && !k.disabled) { k.click(); return true }
        if (z.tagName === 'BUTTON') { z.click(); return true }
      }
      return false })()`)
    await warte(900)
    return ok === true
  }
  const zurueck = async () => {
    await ev(`document.getElementById('zurueck').click()`)
    await warte(700)
  }

  /** Wohin das QR-Blatt zeigen MUSS — aus der Attrappe selbst, nicht abgeschrieben. */
  const erwartet = await (async () => {
    const d = await (await fetch(new URL('/api/netzwerk', ZIEL))).json()
    for (const s of d.schnittstellen || []) {
      if (!s || s.aktiv === false) continue
      for (const a of s.adressen || []) {
        const t = typeof a === 'string' ? a : a && a.familie === 'v4' ? String(a.adresse || '') : ''
        if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) return `http://${t}:8200/spotify`
      }
    }
    return ''
  })()

  const zumQr = async () => {
    await laden()
    await hinein()
    await gruppe('medien')
    await zeile('Dienste')
    await zeile('Spotify')
    await zeile('Erneuerungsmerkmal')
  }

  // ══ 1. DER WEG DAHIN IST EINE EBENE TIEFER ══════════════════════════════
  console.log('\n══ DER WEG ══════════════════════════════════════════════════')
  await stand('voll')
  await stand('sperre-aus')
  await stand('netz-gut')
  await zumQr()
  const wo = JSON.parse(
    await ev(`JSON.stringify({
      kopf: (document.getElementById('fach-name')||{}).textContent || '',
      unter: (document.getElementById('eltern-unter')||{}).textContent || '',
      tat: (() => { const k = document.getElementById('fach-tat'); return k && !k.hidden ? k.textContent : '' })(),
      klartext: (document.querySelector('.qr-adresse-wert')||{}).textContent || '',
      zeichen: !!document.querySelector('.qr-bild svg'),
    })`),
  )
  ja(wo.kopf === 'Mit dem Handy', 'die Unterseite ist aufgeschlagen', `Kopf „${wo.kopf}"`)
  ja(wo.unter.endsWith('Spotify · Mit dem Handy'), 'die Brotkrume nennt den ganzen Weg', wo.unter)
  ja(wo.tat === 'Von Hand', 'der Weg von Hand ist nicht verschwunden, er steht im Kopf', `Knopf „${wo.tat}"`)
  ja(wo.zeichen === true, 'ein QR-Zeichen ist da')

  // EIN TIPP AUF DEN RUECKWEG NIMMT GENAU EINE EBENE.
  await zurueck()
  const zurueckKopf = await ev(`(document.getElementById('fach-name')||{}).textContent || ''`)
  ja(zurueckKopf === 'Spotify', 'zurueck landet bei Spotify und nicht in der Dienste-Uebersicht', `„${zurueckKopf}"`)
  await zeile('Erneuerungsmerkmal')

  // ══ 2. DIE KARTE TRAEGT ES GANZ ══════════════════════════════════════════
  console.log('\n══ PASST ES IN DIE KARTE ════════════════════════════════════')
  const mass = JSON.parse(
    await ev(`JSON.stringify((() => {
      const f = document.getElementById('fach-zeilen')
      const fr = f.getBoundingClientRect()
      const s = document.querySelector('.qr-bild svg')
      const b = s.getBoundingClientRect()
      const a = document.querySelector('.qr-adresse')
      const ar = a ? a.getBoundingClientRect() : null
      const w = document.querySelector('.qr-adresse-wert')
      const teil = (r) => Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top))
      return {
        sicht: Math.round(fr.height), inhalt: Math.round(f.scrollHeight),
        x: Math.round(b.x), y: Math.round(b.y), b: Math.round(b.width), h: Math.round(b.height),
        ganz: Math.round(teil(b)),
        adresseGanz: ar ? Math.round(teil(ar)) : 0, adresseHoch: ar ? Math.round(ar.height) : 0,
        adresseBreit: w ? w.scrollWidth : 0, adressePlatz: w ? w.clientWidth : 0,
        module: Number(s.getAttribute('viewBox').split(' ')[2]),
      }
    })())`),
  )
  console.log(
    `      Karte ${mass.sicht} px Sicht, ${mass.inhalt} px Inhalt${mass.inhalt > mass.sicht + 1 ? ' — rollt' : ''}`,
  )
  ja(mass.inhalt <= mass.sicht + 1, 'die Seite rollt nicht', `${mass.inhalt} in ${mass.sicht} px`)
  ja(mass.ganz === mass.h, 'das Zeichen steht GANZ in der Karte', `${mass.ganz} von ${mass.h} px`)
  ja(
    mass.adresseGanz === mass.adresseHoch,
    'die Adresse im Klartext steht GANZ da',
    `${mass.adresseGanz} von ${mass.adresseHoch} px`,
  )
  // ── GEKUERZT IST NICHT DA ─────────────────────────────────────────────
  // Die Klartextadresse steht in einer Zeile mit `text-overflow: ellipsis`.
  // Ein „http://192.168.17…" ist zum Abtippen wertlos und sieht am Schirm
  // trotzdem nach einer Adresse aus — genau die Sorte Fehler, die ein Blick
  // uebersieht.
  ja(
    mass.adresseBreit <= mass.adressePlatz,
    'die Adresse ist nicht seitlich gekuerzt',
    `${mass.adresseBreit} px Text in ${mass.adressePlatz} px Platz`,
  )
  const modulMm = (mass.b / mass.module) * MM
  ja(
    modulMm >= MODUL_MM_MIN,
    `ein Modul ist mindestens ${MODUL_MM_MIN} mm gross`,
    `${mass.b} px / ${mass.module} Module = ${modulMm.toFixed(2)} mm`,
  )
  console.log(`      Zeichen ${mass.b}x${mass.h} px = ${(mass.b * MM).toFixed(1)} mm Kante`)

  // ══ 3. DIE PROBE, DIE ZAEHLT: ZURUECKLESEN ══════════════════════════════
  console.log('\n══ ZURUECKGELESEN ═══════════════════════════════════════════')
  const ganzesBild = await bild('1-qr-blatt')
  console.log(`      Bild: ${ganzesBild}`)
  // AUS DEM BILDSCHIRMFOTO AUSGESCHNITTEN und nicht aus dem SVG erzeugt: was
  // hier gelesen wird, ist das, was am Schirm steht — durch Stilblatt, Layout
  // und Rasterung hindurch. Der Ausschnitt bekommt vier Bildpunkte Luft, damit
  // ein Rundungsfehler nicht die Ruhezone anknabbert.
  const aus = await bild('2-nur-das-zeichen', {
    x: mass.x - 4,
    y: mass.y - 4,
    width: mass.b + 8,
    height: mass.h + 8,
    scale: 1,
  })
  console.log(`      Ausschnitt: ${aus}`)
  console.log(`      erwartet:   ${erwartet}`)

  const z = mitZbar(aus)
  const o = mitOpenCv(aus)
  ja(z.da, 'zbarimg ist da und hat gelesen', z.da ? `„${z.text}"` : 'zbarimg fehlt — apt install zbar-tools')
  if (z.da) {
    ja(z.text !== '', 'zbarimg findet ueberhaupt ein Zeichen', z.text === '' ? 'nichts erkannt' : 'erkannt')
    ja(z.text === erwartet, 'zbarimg liest GENAU die erwartete Adresse', `„${z.text}"`)
  }
  ja(o.da, 'OpenCV ist da und hat gelesen', o.da ? `„${o.text}"` : 'cv2 fehlt — dann zaehlt nur zbarimg')
  if (o.da) ja(o.text === erwartet, 'OpenCV liest GENAU dieselbe Adresse', `„${o.text}"`)
  // DER SATZ MEINT DAS ERGEBNIS UND NICHT DIE ANWESENHEIT. Hier stand
  // `z.da || o.da` — das war „ein Leser ist installiert" und blieb in der
  // Gegenprobe (ein verdrehtes Formatbit) gruen, waehrend beide Leser nichts
  // erkannten. Eine Aussage, die bei kaputtem Zeichen haelt, ist keine.
  ja(z.text === erwartet || o.text === erwartet, 'mindestens EIN fremder Leser hat das Zeichen bestaetigt')

  // ══ 4. IM ZEICHEN STEHT NICHTS AUSSER DER ADRESSE ═══════════════════════
  //
  // Punkt 1 der nicht verhandelbaren Liste. Ein QR-Zeichen wird
  // abfotografiert, weitergeschickt und liegt danach in einer Galerie. Der
  // Vergleich ist deshalb ZEICHENGENAU und nicht „enthaelt": ein angehaengtes
  // `?token=…` faellt durch, ein `#client_id=…` auch.
  const gelesen = z.text || o.text
  console.log('\n══ WAS DRINSTEHT ════════════════════════════════════════════')
  ja(gelesen === erwartet, 'im Zeichen steht die Adresse und sonst nichts', `„${gelesen}"`)
  ja(!/[?#&=]/.test(gelesen), 'kein Fragezeichen, kein Rautezeichen, kein Gleichheitszeichen', gelesen)
  ja(gelesen.startsWith('http://'), 'schlichtes HTTP — kein Zeugnis, keine Warnseite am Handy')
  ja(gelesen.endsWith(':8200/spotify'), 'Port 8200 und der Pfad der Einrichtungsseite')
  ja(wo.klartext === erwartet, 'dieselbe Adresse steht im Klartext zum Abtippen da', `„${wo.klartext}"`)

  // ══ 5. OHNE NETZ EIN SATZ UND KEIN ZEICHEN ══════════════════════════════
  //
  // Punkt 2 der nicht verhandelbaren Liste. Ein Zeichen auf `http://:8200/…`
  // saehe genauso aus wie ein gutes und fuehrte ins Leere — und wer davorsteht,
  // sucht den Fehler danach beim Handy.
  console.log('\n══ OHNE NETZ ════════════════════════════════════════════════')
  await stand('netz-weg')
  await zumQr()
  const ohne = JSON.parse(
    await ev(`JSON.stringify({
      zeichen: !!document.querySelector('.qr-bild svg'),
      wort: (document.querySelector('.qr-kein-wort')||{}).textContent || '',
      satz: (document.querySelector('.qr-kein-satz')||{}).textContent || '',
      klartext: (document.querySelector('.qr-adresse-wert')||{}).textContent || '',
      tat: (() => { const k = document.getElementById('fach-tat'); return k && !k.hidden ? k.textContent : '' })(),
    })`),
  )
  const ohneBild = await bild('3-ohne-netz')
  console.log(`      Bild: ${ohneBild}`)
  ja(ohne.zeichen === false, 'ohne Netz steht KEIN Zeichen da')
  ja(ohne.wort !== '' && ohne.satz !== '', 'statt dessen ein Satz, der es benennt', `${ohne.wort} / ${ohne.satz}`)
  ja(ohne.klartext === '—', 'und die Klartextzeile behauptet keine Adresse', `„${ohne.klartext}"`)
  ja(ohne.tat === 'Von Hand', 'der Weg von Hand bleibt auch ohne Netz erreichbar')

  // ══ 6. OHNE CLIENT-ID — DIE LAGE, IN DER DIESE SEITE AM MEISTEN NUETZT ══
  //
  // Vorher war die Spotify-Einrichtung hier eine Sackgasse: der Knopf war aus,
  // und die Client-ID ist 32 Zeichen auf einer 8x4-Tastatur. Das QR-Zeichen
  // MUSS deshalb gerade dann dastehen — und die Seite darf dabei nicht rollen,
  // denn die Fussnote kommt hinzu.
  console.log('\n══ OHNE CLIENT-ID ═══════════════════════════════════════════')
  await stand('netz-gut')
  await fetch(new URL('/vorschau/lage', ZIEL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ zugang: { spotifyClientId: '' } }),
  }).catch(() => null)
  await zumQr()
  const ohneId = JSON.parse(
    await ev(`JSON.stringify((() => {
      const f = document.getElementById('fach-zeilen')
      const k = document.getElementById('fach-tat')
      const fuss = document.querySelector('.qr-fussnote')
      const fr = f.getBoundingClientRect()
      const t = (e) => { const r = e.getBoundingClientRect()
        return Math.round(Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top)) - r.height) }
      return {
        zeichen: !!document.querySelector('.qr-bild svg'),
        tatAus: !!(k && k.disabled), tat: k && !k.hidden ? k.textContent : '',
        fuss: fuss ? fuss.textContent : '',
        fussGanz: fuss ? t(fuss) === 0 : false,
        sicht: Math.round(fr.height), inhalt: Math.round(f.scrollHeight),
        hinweis: (() => { const h = document.getElementById('fach-hinweis'); return h && !h.hidden ? h.textContent : '' })(),
      }
    })())`),
  )
  const idBild = await bild('4-ohne-client-id')
  console.log(`      Bild: ${idBild}`)
  console.log(`      Karte ${ohneId.sicht} px Sicht, ${ohneId.inhalt} px Inhalt`)
  ja(ohneId.zeichen === true, 'ohne Client-ID steht das Zeichen trotzdem da — hier nuetzt es am meisten')
  ja(ohneId.tatAus === true, '„Von Hand" ist aus statt in eine Absage zu laufen', `Knopf „${ohneId.tat}"`)
  ja(ohneId.fuss !== '', 'und der Grund steht als Fussnote da', ohneId.fuss)
  ja(ohneId.fussGanz, 'die Fussnote steht GANZ in der Karte')
  ja(ohneId.inhalt <= ohneId.sicht + 1, 'auch mit Fussnote rollt die Seite nicht', `${ohneId.inhalt} in ${ohneId.sicht} px`)
  ja(ohneId.hinweis === '', 'und es steht KEINE Meldung im Kopf — die kostete 28 px', `„${ohneId.hinweis}"`)

  // ══ 7. DER WEG VON HAND VERLAESST DAS BLATT, BEVOR ER SCHREIBT ══════════
  //
  // DAS IST EINE LAYOUTFRAGE UND KEINE BEQUEMLICHKEIT: `spotifyTokenSetzen`
  // schreibt „Speichert …" und danach das Ergebnis in den Kopf, und eine
  // Meldung dort kostet 28 px. Die hat dieses Blatt nicht — es rollte, und
  // abgeschnitten waere ausgerechnet die Adresse. Bleibt jemand also nach dem
  // Tippen hier stehen, ist die Rechnung der Seite kaputt, ohne dass irgendeine
  // Zahl sich geaendert haette.
  console.log('\n══ VON HAND ═════════════════════════════════════════════════')
  await fetch(new URL('/vorschau/lage', ZIEL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ zugang: { spotifyClientId: 'aaaaaaaabbbbbbbbccccccccdddddddd' } }),
  }).catch(() => null)
  await zumQr()
  await ev(`document.getElementById('fach-tat').click()`)
  await warte(700)
  const tast = JSON.parse(
    await ev(`JSON.stringify({
      auf: !document.getElementById('tastatur').hidden,
      frage: (document.getElementById('tast-frage')||{}).textContent || '',
      geheim: !(document.getElementById('tast-auge')||{}).hidden,
    })`),
  )
  ja(tast.auf, 'der Kopfknopf oeffnet die Tastatur und nicht die Erreichbarkeitsprobe', tast.frage)
  ja(tast.geheim, 'und sie ist VERDECKT — ein Erneuerungsmerkmal ist ein Geheimnis')
  // NUR BUCHSTABEN: die Ziffern liegen auf der zweiten Ebene, und ein
  // Ebenenwechsel mitten in dieser Messung pruefte die Tastatur statt der Seite.
  await ev(`(() => { for (const t of 'qwertzui') {
    const k = [...document.querySelectorAll('#tast-feld button')].find((b) => b.textContent === t)
    if (k) k.click() } return true })()`)
  await warte(250)
  await ev(`(() => { const f = [...document.querySelectorAll('#tast-feld button')]
    .find((b) => b.textContent === 'Fertig'); if (f && !f.disabled) { f.click(); return true } return false })()`)
  await warte(1400)
  const danach = JSON.parse(
    await ev(`JSON.stringify((() => {
      const f = document.getElementById('fach-zeilen')
      const fr = f.getBoundingClientRect()
      const teil = (r) => Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top))
      return {
        kopf: (document.getElementById('fach-name')||{}).textContent || '',
        hinweis: (() => { const h = document.getElementById('fach-hinweis'); return h && !h.hidden ? h.textContent : '' })(),
        zeichen: !!document.querySelector('.qr-bild svg'),
        sicht: Math.round(fr.height), inhalt: Math.round(f.scrollHeight),
        knoepfe: [...f.querySelectorAll('.zeile-tat')].map((k) => Math.round(teil(k.getBoundingClientRect()))),
      }
    })())`),
  )
  console.log(`      danach: „${danach.kopf}"  ·  Hinweis „${danach.hinweis}"`)
  ja(danach.kopf === 'Spotify', 'nach dem Tippen steht die Spotify-Einrichtung da, nicht mehr das QR-Blatt')
  ja(danach.zeichen === false, 'und das Zeichen ist weg — die Meldung braucht den Platz')
  ja(danach.hinweis !== '', 'die Meldung steht da, wo sie eingeplant ist', danach.hinweis)
  // ── DORT DARF SIE ROLLEN, UND ZWAR GENAU SO WEIT WIE DOKUMENTIERT ─────
  // Die Spotify-Einrichtung rechnet mit einer Zeile Meldung: 246 px in 238,
  // also 8 px Rollweg (`jellyfinMalen` in app.js). Die Grenze ist nicht das
  // Rollen selbst, sondern die 9-mm-Marke des angeschnittenen Knopfes. Wer
  // dieses Blatt anfasst, darf jene Rechnung nicht mitverschieben.
  ja(danach.inhalt - danach.sicht <= 8, 'die Spotify-Seite rollt hoechstens die eingeplanten 8 px', `${danach.inhalt} in ${danach.sicht} px`)
  const zuKlein = danach.knoepfe.filter((h) => h * MM < 9)
  ja(
    zuKlein.length === 0,
    'und jeder Knopf dort haelt trotz Meldung die 9-mm-Marke',
    danach.knoepfe.map((h) => `${(h * MM).toFixed(2)} mm`).join(' · '),
  )
  const spuren = await ev(`document.documentElement.outerHTML`)
  ja(!spuren.includes('qwertzui'), 'das Getippte steht nirgends mehr im Baum')

  console.log(`\n${fehler === 0 ? 'alles gehalten' : fehler + ' Aussage(n) gerissen'}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
}
process.exit(fehler === 0 ? 0 : 1)
