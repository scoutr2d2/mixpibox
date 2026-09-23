#!/usr/bin/env node
/**
 * WENN DIE MARKE DIE OFFENE TITELLISTE VERLAESST — SIEHT MAN SIE DANN NOCH?
 *
 * ══ WARUM ES DIESES WERKZEUG BRAUCHT ═══════════════════════════════════════
 *
 * tools/lane-marke-wandert.mjs beantwortet die Frage „wandert die Marke mit?"
 * und kommt zu diesem Befund (llmwiki [[marke-verlaesst-die-offene-titelliste]],
 * am 05.08.2026 unveraendert nachgemessen):
 *
 *     im selben Album          Marke rueckt eine Kachel weiter   richtig
 *     ueber die Albumgrenze    in der offenen Titelliste KEINE   „nicht falsch:
 *                              Marke                             sie sitzt eine
 *                                                                Ebene hoeher"
 *
 * „SIE SITZT EINE EBENE HOEHER" IST EINE AUSSAGE UEBER DEN BAUM, KEINE UEBER
 * DEN SCHIRM. Ob der Benutzer die Marke dort auch SIEHT, steht damit nicht
 * fest — und genau das ist die Frage, die seine Meldung stellt. Ein Zeichen,
 * das ausserhalb des Bildes sitzt, von einer Ebene verdeckt wird oder in einem
 * weggescrollten Behaelter steht, ist fuer ihn nicht vorhanden. Dann waere
 * „die Marke geht nicht mit" woertlich wahr: auf dem Schirm stuende gar keine.
 *
 * DAS IST NICHT DIESELBE FRAGE WIE raster-marke-schau.mjs (bewegt sie sich?)
 * und nicht dieselbe wie lane-marke-wandert.mjs (rueckt sie weiter?). Es ist
 * die dritte: KANN MAN SIE SEHEN?
 *
 * GETASTET, NICHT GERECHNET — dieselbe Trennung wie in
 * tools/beruehrziele-neu.mjs (llmwiki [[beruehrziele-neue-oberflaeche-gemessen]]):
 * `getBoundingClientRect` kennt weder eine darueberliegende Ebene noch das
 * `overflow: hidden` eines Vorfahren. Deshalb wird zusaetzlich mit
 * `document.elementFromPoint` auf die Mitte der Marke getastet.
 *
 * WAS ES AENDERT: nichts an der Box. Eigener Browser (headless, 800x480 — der
 * Schirm der Box) gegen tools/neu-vorschau.mjs. Die geliehene Lage wird
 * zurueckgelegt (tools/leihgabe.mjs).
 *
 * AUFRUF
 *     node tools/marke-sichtbar-nach-albumwechsel.mjs
 *     node tools/marke-sichtbar-nach-albumwechsel.mjs --pruefen   # Ende 1, wenn
 *          nach der Albumgrenze KEINE Marke sichtbar ist
 *     node tools/marke-sichtbar-nach-albumwechsel.mjs --roh       # alle Zahlen
 */
import { writeFileSync } from 'node:fs'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const ROH = process.argv.includes('--roh')
/** `--bild /pfad/vorsilbe` legt je Schritt ein PNG ab. DAS BILD GEHOERT DAZU,
 *  nicht statt dessen: eine Zahl sagt „ausserhalb des Bildes", das Bild sagt,
 *  WAS statt dessen dort steht (llmwiki [[rueckweg-verdeckt-die-ueberschrift]]). */
const BILD = (() => {
  const i = process.argv.indexOf('--bild')
  return i > 0 ? process.argv[i + 1] : null
})()

/** Dieselbe Playlist wie in lane-marke-wandert.mjs — damit beide Werkzeuge
 *  ueber denselben Fall reden und ihre Befunde vergleichbar bleiben. */
const PLAYLIST = 'Bibi Blocksberg'

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  await leihe.zurueckgeben()
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
const stellen = (was) => fetch(new URL(`/vorschau/${was}`, ZIEL)).then((r) => r.json())

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => console.log(`  ${String(n).padEnd(40)} ${w}`)

/**
 * Jede Marke im Baum — und was zwischen ihr und dem Auge steht.
 *
 * DREI GRUENDE, WARUM EIN VORHANDENES ZEICHEN NICHT ZU SEHEN IST, und jeder
 * wird einzeln benannt, weil jeder eine andere Reparatur haette:
 *   ausserhalb   die Marke liegt ganz oder teilweise neben dem 800x480-Bild
 *   verdeckt     an ihrer Mitte antwortet ein FREMDES Element (eine Ebene
 *                darueber — das Laut-Fenster etwa, oder der grosse Player)
 *   beschnitten  ein Vorfahr mit `overflow` schneidet sie ab; erkennbar
 *                daran, dass ihr Rechteck aus dem Rechteck des Behaelters
 *                herausragt
 * Zusaetzlich `unsichtbar` (display/visibility/opacity) — das waere CSS.
 */
const LESEN = `(() => {
  const w = innerWidth, h = innerHeight
  const scrollEltern = (e) => {
    const l = []
    for (let p = e.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (/(auto|scroll|hidden)/.test(s.overflowX + s.overflowY)) l.push(p)
    }
    return l
  }
  // ZWEI DINGE, NICHT EINS: das ZEICHEN (.spielt-marke, der Balken-Punkt) und
  // die MARKIERTE KACHEL (.spielt, die den Titel einfaerbt). Sie koennen
  // getrennt verschwinden — und tun es: in der Albumreihe ist die Kachel oben
  // angeschnitten, der rote Titel steht im Bild, das Zeichen liegt darueber
  // ausserhalb. Wer nur das Zeichen misst, meldet „keine Marke", waehrend der
  // Benutzer sehr wohl etwas sieht. Wer nur die Kachel misst, uebersieht den
  // umgekehrten Fall. Beides wird deshalb einzeln ausgewiesen.
  const marken = [...document.querySelectorAll('[data-spielt].spielt')].map((k) => {
    const m = k.querySelector('.spielt-marke')
    const r = m ? m.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    const kr = k.getBoundingClientRect()
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2)
    const drin = m && cx >= 0 && cx < w && cy >= 0 && cy < h
    // DIE MARKE IST FUER DEN FINGER DURCHSICHTIG, und das ist Absicht:
    // 'pointer-events: none' in app.css, damit ein Tipp auf sie die KACHEL
    // ausloest und nicht ins Leere geht. Fuer 'elementFromPoint' heisst das
    // aber, dass sie NIE ihre eigene Antwort sein kann — es kommt immer das
    // zurueck, was darunter liegt.
    //
    // GEMESSEN AM 05.08.2026, und es war ein FALSCHER BEFUND: Sobald das
    // Nachrollen die markierte Kachel ins Bild holte, meldete dieses Werkzeug
    // 'verdeckt von .IMG' — also ausgerechnet fuer die Marke, die endlich zu
    // sehen war. Ein Werkzeug, das jede sichtbare Marke als verdeckt meldet,
    // beweist gar nichts mehr.
    //
    // FUER DIE DAUER DES TASTENS WIRD DIE DURCHREICHE ZUGEMACHT. Damit misst
    // der Tastpunkt wieder das, wonach hier gefragt ist — die STAPELUNG (liegt
    // etwas ueber der Marke?) statt der Bedienbarkeit (die soll durchgehen).
    // Danach steht wieder genau, was vorher dastand.
    const durchreiche = m ? m.style.pointerEvents : ''
    if (m) m.style.pointerEvents = 'auto'
    const treffer = drin ? document.elementFromPoint(cx, cy) : null
    if (m) m.style.pointerEvents = durchreiche
    const st = m ? getComputedStyle(m) : { display: 'none', visibility: 'visible', opacity: '1' }
    // BESCHNITTEN: ragt das Rechteck aus einem seiner Scroll-/Hidden-Vorfahren
    // heraus? Genau das passiert einer Kachel, die in einer waagerechten Reihe
    // nach rechts herausgelaufen ist.
    const schneidet = (rr, el) => {
      for (const p of scrollEltern(el)) {
        const pr = p.getBoundingClientRect()
        if (rr.right <= pr.left + 1 || rr.left >= pr.right - 1 || rr.bottom <= pr.top + 1 || rr.top >= pr.bottom - 1)
          return { name: p.className || p.tagName, pr }
      }
      return null
    }
    const beschnitten = m ? (schneidet(r, m) || {}).name || null : null
    const kBeschnitten = schneidet(kr, k)
    // WAS ES KOSTEN WUERDE, SIE INS BILD ZU HOLEN — in Bildpunkten, nicht in
    // Meinung. Wer spaeter ein Nachrollen baut, hat hier die Zahl, gegen die
    // er misst; steht sie bei 0, war die Kachel schon im Bild.
    // (KEINE Backticks in diesem Block — er steht in einem Schablonenliteral
    //  und wuerde es sonst beenden. Genau daran ist der Lauf davor gescheitert.)
    let rollen = 0
    if (kBeschnitten) {
      const pr = kBeschnitten.pr
      if (kr.left >= pr.right - 1) rollen = Math.round(kr.right - pr.right + 8)
      else if (kr.right <= pr.left + 1) rollen = Math.round(kr.left - pr.left - 8)
    }
    return {
      // DREI ZUSTAENDE, NICHT ZWEI. „Ganz im Bild" und „ganz draussen" lassen
      // den haeufigsten Fall der Albumreihe aus: die Kachel ist OBEN
      // ANGESCHNITTEN, ihr eingefaerbter Titel steht aber lesbar da. Das als
      // „weg" zu melden waere dieselbe Uebertreibung, vor der Punkt 6 der
      // Arbeitsweise warnt — nur in die andere Richtung.
      kachelSichtbar: !kBeschnitten && kr.left >= 0 && kr.top >= 0 && kr.right <= w && kr.bottom <= h,
      kachelTeils:
        !kBeschnitten && kr.right > 0 && kr.bottom > 0 && kr.left < w && kr.top < h &&
        !(kr.left >= 0 && kr.top >= 0 && kr.right <= w && kr.bottom <= h),
      kachelGanzDraussen: !!kBeschnitten || kr.right <= 0 || kr.bottom <= 0 || kr.left >= w || kr.top >= h,
      kachelBeschnittenVon: kBeschnitten ? kBeschnitten.name : null,
      rollenNoetig: rollen,
      hatZeichen: !!m,
      titel: ((k.querySelector('.lane-titel') || k.querySelector('.kachel-titel') || {}).textContent || '').trim(),
      art: k.classList.contains('stueck') ? 'Titel' : k.classList.contains('lane-kachel') ? 'Album' : 'Raster',
      kennung: k.dataset ? k.dataset.spielt || '' : '',
      marke: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      kachel: { x: Math.round(kr.left), y: Math.round(kr.top), w: Math.round(kr.width), h: Math.round(kr.height) },
      ausserhalb: !(r.left >= 0 && r.top >= 0 && r.right <= w && r.bottom <= h),
      ganzDraussen: r.right <= 0 || r.bottom <= 0 || r.left >= w || r.top >= h,
      verdecktVon: drin && treffer && !m.contains(treffer) && treffer !== m ? treffer.className || treffer.tagName : null,
      beschnittenVon: beschnitten,
      unsichtbar: st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0,
    }
  })
  // DIE BEHAELTER GEHOEREN DAZU. „Die Marke liegt bei y = -92" ist ohne sie
  // nicht zu deuten: Es kann heissen „die Seite ist weitergescrollt" (dann ist
  // die Marke durch Scrollen erreichbar) oder „sie steht auf einem Schirm, der
  // gar nicht dran ist" (dann nie). Ohne diese Zeilen haelt man das eine fuer
  // das andere — genau der Fehler, den [[raster-marke-schau-gegenprobe]] meint.
  const behaelter = ['.buehne', '#raster', '.lane', '.lane-reihe'].flatMap((s) =>
    [...document.querySelectorAll(s)].map((e) => {
      const r = e.getBoundingClientRect()
      return {
        wahl: s,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        scrollLinks: Math.round(e.scrollLeft), scrollBreite: e.scrollWidth, sichtBreite: e.clientWidth,
        scrollOben: Math.round(e.scrollTop), scrollHoehe: e.scrollHeight, sichtHoehe: e.clientHeight,
      }
    }),
  )
  return { schirm: { w, h }, seiteScrollY: Math.round(scrollY), seiteScrollX: Math.round(scrollX), marken, behaelter }
})()`

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 GENAU — der erste Lauf dieses Werkzeugs am 05.08.2026 mass ohne
  // diese Zeile und bekam vom headless-Chromium trotz `--window-size=800,480`
  // ein Sichtfenster von 800x337. Auf 337 px Hoehe ist die `.buehne` um 703 px
  // weitergescrollt, und JEDE Marke liegt „ausserhalb des Bildes" — das
  // Werkzeug meldete einen Fehler ueber einen Schirm, den es nicht gibt.
  // Dieselbe Falle steht seit dem 05.08. in tools/beruehrziele-neu.mjs; sie
  // war abgeschrieben schneller wiederholt als gelesen.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  await stellen('voll')
  await stellen('alben-voll')
  await stellen('spotify')

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)

  // Erst das Regal „Kiddinx", dann die Playlist — siehe lane-marke-wandert.mjs.
  const tippe = (titel) =>
    ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .kachel')]
        .find((e) => ((e.querySelector('.kachel-titel') || {}).textContent || '') === ${JSON.stringify(titel)})
      if (!k) return false
      k.click()
      return true
    })()`)
  if (!(await tippe(PLAYLIST))) {
    if (!(await tippe('Kiddinx'))) melde(`weder „${PLAYLIST}" noch das Regal „Kiddinx" im Raster`)
    await warte(900)
    if (!(await tippe(PLAYLIST))) melde(`keine Kachel „${PLAYLIST}" im Regal`)
  }
  await warte(1500)
  if (!(await ev(`(() => { const k = document.querySelector('#raster > .lane > .lane-reihe > .lane-kachel'); if (k) k.click(); return !!k })()`)))
    melde('die Album-Lane ist nicht aufgegangen')
  await warte(1500)

  const messe = async (wann) => {
    const zustand = await (await fetch(new URL('/player/state', ZIEL))).json()
    const d = await ev(LESEN)
    console.log(`\n  ── ${wann} ${'─'.repeat(Math.max(0, 56 - wann.length))}`)
    zeile('Schirm', `${d.schirm.w}x${d.schirm.h}, Seite gescrollt auf x=${d.seiteScrollX} y=${d.seiteScrollY}`)
    zeile('laeuft laut /player/state', String(zustand?.item?.uri || '— nichts —'))
    zeile('Marken im Baum', String(d.marken.length))
    const sichtbar = []
    for (const m of d.marken) {
      // ZEICHEN und KACHEL getrennt beurteilen — siehe LESEN.
      const zGruende = []
      if (!m.hatZeichen) zGruende.push('gar kein .spielt-marke im Baum')
      if (m.unsichtbar) zGruende.push('per CSS unsichtbar')
      if (m.ganzDraussen) zGruende.push('ausserhalb des Bildes')
      if (m.beschnittenVon) zGruende.push(`beschnitten von .${m.beschnittenVon}`)
      if (m.verdecktVon) zGruende.push(`verdeckt von .${m.verdecktVon}`)
      const zeichenOk = m.hatZeichen && zGruende.length === 0
      const kachelOk = m.kachelSichtbar || m.kachelTeils
      if (zeichenOk || kachelOk) sichtbar.push({ ...m, zeichenOk, kachelOk })
      const kachelWort = m.kachelSichtbar
        ? 'ganz im Bild'
        : m.kachelTeils
          ? 'angeschnitten im Bild (der eingefaerbte Titel ist lesbar)'
          : `weg${m.kachelBeschnittenVon ? ` (aus .${m.kachelBeschnittenVon} gerollt)` : ''}`
      zeile(
        `  ${m.art} „${m.titel}"`,
        `Zeichen ${zeichenOk ? 'SICHTBAR' : `weg (${zGruende.join('; ') || 'ausserhalb'})`} | Kachel ${kachelWort}` +
          (m.rollenNoetig ? ` | ${Math.abs(m.rollenNoetig)} px rollen wuerden sie holen` : ''),
      )
      if (ROH) console.log(`      ${JSON.stringify(m)}`)
    }
    zeile(
      'der Benutzer sieht',
      sichtbar.length
        ? sichtbar.map((m) => `${m.art} „${m.titel}" (${m.zeichenOk ? 'Zeichen + Farbe' : 'nur eingefaerbt, ohne Zeichen'})`).join(', ')
        : '— NICHTS —',
    )
    if (ROH) for (const b of d.behaelter) console.log(`      ${JSON.stringify(b)}`)
    if (BILD) {
      const png = await send(ws, 'Page.captureScreenshot', { format: 'png' })
      const datei = `${BILD}-${wann.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}.png`
      writeFileSync(datei, Buffer.from(png.data, 'base64'))
      zeile('Bild', datei)
    }
    return { sichtbar, alle: d.marken, behaelter: d.behaelter, uri: String(zustand?.item?.uri || '') }
  }

  let letzte = await messe('VOR DEM TITELWECHSEL')
  const schritte = ['NACH DEM WECHSEL — im selben Album', 'NACH DEM WECHSEL — ueber die Albumgrenze']
  for (const s of schritte) {
    await stellen('spotify-weiter')
    await warte(4000) // 2-s-Takt plus Zugabe
    const jetzt = await messe(s)
    if (jetzt.uri === letzte.uri) melde(`${s}: die Vorschau hat den Titel gar nicht gewechselt — dieser Schritt prueft nichts`)
    else if (!jetzt.sichtbar.length)
      melde(`${s}: KEINE EINZIGE MARKE AUF DEM SCHIRM — fuer den Benutzer ist die Marke verschwunden`)
    letzte = jetzt
  }

  console.log('')
  zeile('ANTWORT', letzte.sichtbar.length
    ? `nach der Albumgrenze bleibt ${letzte.sichtbar.map((m) => `${m.art} „${m.titel}" (${m.zeichenOk ? 'mit Zeichen' : 'nur eingefaerbt'})`).join(' und ')} im Bild`
    : 'nach der Albumgrenze steht KEINE Marke mehr im Bild')
} finally {
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
