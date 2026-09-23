#!/usr/bin/env node
/**
 * STEHT DIE MARKE „SPIELT GERADE" IM BILD, WENN MAN DIE LANE AUFKLAPPT?
 *
 * ══ WOZU NOCH EIN MARKEN-WERKZEUG ═════════════════════════════════════════
 *
 * Es gibt drei, und JEDES stellt eine andere Frage. Die vierte fehlte, und an
 * ihr haengt die Meldung des Betreibers:
 *
 *   tools/lane-marke-wandert.mjs            Wandert sie im BAUM mit? (Spotify)
 *   tools/marke-titelwechsel-je-dienst.mjs  Dasselbe JE DIENST — traegt die
 *                                           Kachel ueberhaupt `data-spielt`?
 *   tools/marke-sichtbar-nach-albumwechsel  Steht sie NACH einem Titelwechsel
 *                                           noch im Bild? (Spotify)
 *   ── DIESES ───────────────────────────   Steht sie in dem AUGENBLICK im
 *                                           Bild, in dem der Benutzer die Lane
 *                                           aufklappt — je Dienst?
 *
 * DAS IST DER AUGENBLICK, DER ZAEHLT. Ein Kind tippt eine Kachel an, die Lane
 * geht auf, und es will sehen, wo es stehengeblieben ist. Laeuft Folge 7 von
 * 30, steht die zugehoerige Kachel rund 650 px weit rechts — ausserhalb der
 * 608 px, die von `.lane-reihe` zu sehen sind. Die Marke sitzt dann voellig
 * richtig auf einer Kachel, die niemand sieht. GENAU DIESER BEFUND hat die
 * Aufgabe F2 zweimal zu frueh als erledigt gelten lassen: die anderen
 * Werkzeuge meldeten gruen, weil sie ueber den BAUM sprachen.
 *
 * ══ ES MISST ZWEI RICHTUNGEN GETRENNT, UND DAS IST DER KERN ═══════════════
 *
 *   WAAGERECHT  `.lane-reihe` rollt (`overflow-x: auto`). Was hier fehlt, holt
 *               `markeInsBild()` in NewDesign/app.js beim Aufklappen heran.
 *   SENKRECHT   `.buehne` rollt. Was hier fehlt, ist die Sache von
 *               `laneInsBild()` — und die holt die Lane nur so weit herauf,
 *               dass ihr KOPF nicht ueber den oberen Rand rutscht. Ist die
 *               Lane hoeher als der Rest des Schirms, bleibt ihr unteres Ende
 *               draussen.
 *
 * Wer die beiden zusammenwirft, repariert die falsche Achse. Deshalb nennt
 * dieses Werkzeug bei jedem Befund die RICHTUNG und die fehlenden Bildpunkte.
 *
 * ══ WAS ES AENDERT ════════════════════════════════════════════════════════
 * Nichts an der Box. Eigener headless-Browser gegen die Vorschau; die
 * geliehene Lage wird im `finally` zurueckgelegt (tools/leihgabe.mjs). Ohne
 * dieses Zurueckgeben messen zwei Werkzeuge nacheinander verschiedene
 * Zustaende — daran hat sich „Marke im Raster" dreimal als kaputt gemeldet,
 * obwohl das CSS in Ordnung war.
 *
 * ══ ZWEI FALLEN, BEIDE HIER SCHON BEZAHLT ═════════════════════════════════
 *
 *   1. HEADLESS GIBT 800x337, nicht 800x480, trotz `--window-size`.
 *      `Emulation.setDeviceMetricsOverride` ist Pflicht; ohne sie ist die
 *      `.buehne` um 700 px weitergescrollt und JEDE Marke liegt „draussen".
 *   2. DIE MARKE IST FUER DEN FINGER DURCHSICHTIG (`pointer-events: none`),
 *      damit ein Tipp auf sie die Kachel ausloest. `elementFromPoint` kann sie
 *      deshalb NIE zurueckgeben — wer damit auf „verdeckt" prueft, meldet jede
 *      sichtbare Marke als verdeckt. Hier wird die Durchreiche fuer die Dauer
 *      des Tastens zugemacht und danach wieder geoeffnet.
 *
 * AUFRUF
 *     node tools/marke-beim-aufklappen.mjs
 *     node tools/marke-beim-aufklappen.mjs http://127.0.0.1:8392/neu/
 *     node tools/marke-beim-aufklappen.mjs --bild /tmp/aufklappen   # je Fall ein PNG
 *     node tools/marke-beim-aufklappen.mjs --pruefen                # Ende 1 bei Abweichung
 */
import { writeFileSync } from 'node:fs'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = argv.includes('--pruefen')
const BILD = (() => {
  const i = argv.indexOf('--bild')
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
})()

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const stellen = (was) => fetch(new URL(`/vorschau/${was}`, ZIEL)).then((r) => r.json())

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => console.log(`  ${String(n).padEnd(36)} ${w}`)

/**
 * DIE MARKIERTE KACHEL, IHR ZEICHEN UND DIE BEIDEN BEHAELTER.
 *
 * Gelesen wird ueber `.spielt` (die Klasse, die `spieltMarkieren` setzt) und
 * ueber `.spielt-marke` (das Zeichen, das dieselbe Funktion einhaengt) —
 * GETRENNT. Sie werden getrennt gesetzt, und nur eines zu lesen uebersaehe
 * den Fall, in dem sie auseinanderlaufen.
 *
 * KEINE BACKTICKS IN DIESEM BLOCK — er steht selbst in einem Schablonen-
 * literal und wuerde es sonst beenden. Genau daran ist der erste Lauf zweier
 * Nachbarwerkzeuge gescheitert.
 */
const LESEN = `(() => {
  const w = innerWidth, h = innerHeight
  const zu = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
  // DIE TIEFSTE MARKIERTE KACHEL ZUERST. Beim Aufklappen einer Titelliste ist
  // die Albumkachel darueber EBENFALLS markiert (sie steht fuer alles, was ein
  // Tipp auf sie oeffnet) — und sie steht in der Reihe darueber, die durch das
  // Aufgehen der Titelliste oft nach oben herausgeschoben wird. Wer die erste
  // nimmt, die er findet, misst die falsche und meldet einen Befund ueber eine
  // Ebene, nach der niemand gefragt hat.
  const k = document.querySelector('.lane .lane-kachel.stueck.spielt') || document.querySelector('.lane .lane-kachel.spielt')
  if (!k) return { schirm: { w, h }, kachel: null }
  const reihe = k.closest('.lane-reihe')
  const buehne = document.getElementById('buehne')
  const kr = k.getBoundingClientRect()
  const rr = reihe ? reihe.getBoundingClientRect() : null
  const br = buehne ? buehne.getBoundingClientRect() : null
  const m = k.querySelector('.spielt-marke')
  const mr = m ? m.getBoundingClientRect() : null

  // WAS FEHLT, IN BILDPUNKTEN UND JE RICHTUNG. Eine Zahl statt einer Meinung:
  // wer das Nachrollen baut, misst gegen genau diese.
  const fehltRechts = rr ? Math.round(Math.max(0, kr.right - rr.right)) : 0
  const fehltLinks = rr ? Math.round(Math.max(0, rr.left - kr.left)) : 0
  const fehltUnten = br ? Math.round(Math.max(0, kr.bottom - Math.min(br.bottom, h))) : 0
  const fehltOben = br ? Math.round(Math.max(0, Math.max(br.top, 0) - kr.top)) : 0

  // DIE DURCHREICHE KURZ ZUMACHEN — siehe Kopf des Werkzeugs, Falle 2.
  let verdecktVon = null
  if (mr) {
    const cx = Math.round(mr.left + mr.width / 2), cy = Math.round(mr.top + mr.height / 2)
    if (cx >= 0 && cx < w && cy >= 0 && cy < h) {
      const alt = m.style.pointerEvents
      m.style.pointerEvents = 'auto'
      const treffer = document.elementFromPoint(cx, cy)
      m.style.pointerEvents = alt
      if (treffer && treffer !== m && !m.contains(treffer)) verdecktVon = treffer.className || treffer.tagName
    }
  }
  const st = m ? getComputedStyle(m) : null

  return {
    schirm: { w, h },
    titel: ((k.querySelector('.lane-titel') || {}).textContent || '').trim(),
    art: k.classList.contains('stueck') ? 'Titel/Folge' : 'Album',
    kennung: k.dataset ? k.dataset.spielt || '' : '',
    kachel: zu(kr),
    reihe: rr ? zu(rr) : null,
    reiheRollt: reihe ? reihe.scrollWidth > reihe.clientWidth + 8 : false,
    reiheScrollLinks: reihe ? Math.round(reihe.scrollLeft) : 0,
    zeichen: mr ? zu(mr) : null,
    zeichenUnsichtbar: st ? (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) : null,
    verdecktVon,
    fehltRechts, fehltLinks, fehltUnten, fehltOben,
    kachelnGesamt: document.querySelectorAll('.lane .lane-kachel').length,
    kachelnMitMerkmal: [...document.querySelectorAll('.lane .lane-kachel')].filter((x) => x.dataset.spielt).length,
  }
})()`

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser()
if (!brw) {
  console.log('  kein Browser gefunden — uebersprungen')
  await leihe.zurueckgeben()
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

try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const warteAuf = async (e, ms = 8000) => {
    const bis = Date.now() + ms
    while (Date.now() < bis) {
      if (await ev(e)) return true
      await warte(150)
    }
    return false
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warteAuf(`!!document.getElementById('raster') && document.getElementById('raster').children.length > 0`)
  }
  /** Eine Raster-Kachel ueber ihre Beschriftung finden und etwas darauf tun. */
  const amRaster = (teil, was) =>
    ev(`(() => {
      const k = [...document.querySelectorAll('#raster .kachel')]
        .find((x) => (x.getAttribute('aria-label') || '').includes(${JSON.stringify(teil)}))
      if (!k) return 'keine Kachel'
      ${was}
      return 'ok'
    })()`)

  const FAELLE = [
    {
      name: 'ARD-Sendung, Folge 7 laeuft (mpv)',
      was: 'Die Folgen-Lane — die einzige mpv-Quelle, die im Raster aufklappt',
      hin: async () => {
        await stellen('voll')
        await stellen('spielt')
        await stellen('mpv-eigen')
        await stellen('mpv-erste')
        await neuLaden()
        // ERST STARTEN, DANN AUFKLAPPEN: `albumSpielen` legt die Liste ab,
        // gegen die mpv zaehlt (`laufendeFolgen`). Ohne sie kann die Marke
        // gar nicht sitzen, und das waere kein Befund, sondern ein Fehlgriff
        // des Werkzeugs.
        const g = await amRaster('MausHörspiel', `const s = k.querySelector('.tipp-spiel'); if (!s) return 'kein Play-Knopf'; s.click()`)
        if (g !== 'ok') throw new Error(`die ARD-Kachel liess sich nicht starten: ${g}`)
        if (!(await warteAuf(`!document.getElementById('mp').hidden`))) throw new Error('der Mini-Player kam nicht')
        // WEIT NACH HINTEN. Bei Folge 1 stuende die Kachel ohnehin links —
        // ein Nachrollen waere dann nicht von gar keinem zu unterscheiden.
        for (let i = 0; i < 6; i++) await stellen('mpv-weiter')
        await warte(2400) // der 2-s-Takt plus Zugabe
        const a = await amRaster('MausHörspiel', `k.click()`)
        if (a !== 'ok') throw new Error(`die ARD-Kachel klappte nicht auf: ${a}`)
        if (!(await warteAuf(`document.querySelectorAll('.lane-kachel.stueck').length > 0`)))
          throw new Error('die Folgen-Lane ging nicht auf')
      },
    },
    {
      name: 'Spotify-Playlist, Kapitel 7 von 10 laeuft',
      was: 'Die Titel-Lane der dritten Ebene — Playlist, Album, Titel',
      hin: async () => {
        await stellen('voll')
        await stellen('alben-voll')
        await stellen('kontext-standard')
        await stellen('spotify')
        await neuLaden()
        // DIE PLAYLIST STECKT UNTER UMSTAENDEN IM REGAL „Kiddinx" — zwei Werke
        // desselben Interpreten fassen sich zusammen. Erst direkt versuchen,
        // dann ueber das Regal; dieselbe Reihenfolge wie in
        // tools/marke-sichtbar-nach-albumwechsel.mjs.
        let g = await amRaster('Bibi Blocksberg', `k.click()`)
        if (g !== 'ok') {
          const r = await amRaster('Kiddinx', `k.click()`)
          if (r !== 'ok') throw new Error('weder die Playlist noch das Regal „Kiddinx" im Raster')
          await warte(900)
          g = await amRaster('Bibi Blocksberg', `k.click()`)
          if (g !== 'ok') throw new Error('keine Kachel „Bibi Blocksberg" im Regal')
        }
        if (!(await warteAuf(`document.querySelectorAll('.lane .lane-kachel').length > 0`)))
          throw new Error('die Album-Lane ging nicht auf')
        // Das MARKIERTE Album aufklappen, nicht das erste — sonst misst der
        // Fall eine Titelliste, in der gar nichts laeuft.
        const auf = await ev(`(() => {
          const m = document.querySelector('.lane .lane-kachel.spielt')
          const k = m || document.querySelector('.lane .lane-kachel')
          if (!k) return 'keine Albumkachel'
          k.click()
          return m ? 'markiertes' : 'erstes'
        })()`)
        if (auf === 'keine Albumkachel') throw new Error('keine Albumkachel zum Aufklappen')
        if (!(await warteAuf(`document.querySelectorAll('.lane-kachel.stueck').length > 0`)))
          throw new Error('die Titel-Lane ging nicht auf')
      },
    },
  ]

  for (const f of FAELLE) {
    console.log(`\n══ ${f.name}`)
    zeile('was', f.was)
    try {
      await f.hin()
    } catch (e) {
      melde(`${f.name}: ${e.message}`)
      continue
    }
    // Das Rollen laeuft weich (`behavior: 'smooth'`) — auf das ERGEBNIS
    // warten, nicht auf eine Zeitspanne.
    await warte(900)
    const d = await ev(LESEN)
    zeile('Schirm', `${d.schirm.w}x${d.schirm.h}`)
    if (!d.kachel) {
      melde(`${f.name}: KEINE markierte Kachel in der Lane — die Marke sitzt hier ueberhaupt nicht`)
      continue
    }
    zeile('markiert', `${d.art} „${d.titel}"`)
    zeile('Kennung', d.kennung || '— keine —')
    zeile('Kacheln in der Lane', `${d.kachelnGesamt} — davon ${d.kachelnMitMerkmal} mit data-spielt`)
    zeile(
      'die Reihe',
      d.reihe
        ? `${d.reihe.w} px sichtbar, ${d.reiheRollt ? 'rollt' : 'rollt NICHT'}, steht auf ${d.reiheScrollLinks}`
        : '— keine .lane-reihe —',
    )
    zeile('die Kachel', `${d.kachel.w}x${d.kachel.h} bei ${d.kachel.x},${d.kachel.y}`)
    zeile('das Zeichen', d.zeichen ? `${d.zeichen.w}x${d.zeichen.h} bei ${d.zeichen.x},${d.zeichen.y}` : '— keins —')

    // ══ DAS URTEIL, JE RICHTUNG ═══════════════════════════════════════════
    const wa = d.fehltRechts || d.fehltLinks
    const se = d.fehltUnten || d.fehltOben
    zeile(
      'waagerecht (.lane-reihe)',
      wa ? `${wa} px fehlen ${d.fehltRechts ? 'nach rechts' : 'nach links'}` : 'ganz im Bild',
    )
    zeile('senkrecht (.buehne)', se ? `${se} px fehlen ${d.fehltUnten ? 'nach unten' : 'nach oben'}` : 'ganz im Bild')
    const zGruende = []
    if (!d.zeichen) zGruende.push('gar kein .spielt-marke im Baum')
    if (d.zeichenUnsichtbar) zGruende.push('per CSS unsichtbar')
    if (d.verdecktVon) zGruende.push(`verdeckt von .${d.verdecktVon}`)
    if (
      d.zeichen &&
      !(d.zeichen.x >= 0 && d.zeichen.y >= 0 && d.zeichen.x + d.zeichen.w <= d.schirm.w && d.zeichen.y + d.zeichen.h <= d.schirm.h)
    )
      zGruende.push('ausserhalb des Schirms')
    zeile('SIEHT DER BENUTZER SIE?', zGruende.length ? `NEIN — ${zGruende.join('; ')}` : 'JA')

    // GEPRUEFT WIRD DIE WAAGERECHTE, NICHT DIE SENKRECHTE, und das ist eine
    // Aussage und keine Nachlaessigkeit: Das waagerechte Heranrollen beim
    // Aufklappen ist gebaut (`markeInsBild`). Ob die Seite dem Benutzer auch
    // SENKRECHT hinterherrollen soll, ist eine Frage der Anordnung und gehoert
    // dem Betreiber — sie wird hier gemessen und ausgewiesen, aber nicht als
    // Fehler gewertet.
    if (wa) melde(`${f.name}: die markierte Kachel steht waagerecht ${wa} px ausserhalb der Reihe`)

    if (BILD) {
      const png = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      const datei = `${BILD}-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`
      writeFileSync(datei, Buffer.from(png.data, 'base64'))
      zeile('Bild', datei)
    }
  }

  console.log('')
  console.log(fehler ? `  ${fehler} FEHLER` : '  waagerecht steht in jedem Fall die markierte Kachel im Bild')
} finally {
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
