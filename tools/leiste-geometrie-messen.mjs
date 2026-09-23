#!/usr/bin/env node
/**
 * WAS PASSIERT MIT DER SEITENLEISTE, WENN OBEN ODER UNTEN ETWAS WEGFAELLT.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Am 05.08.2026 wurde entschieden, dass das MixPi-Bild aus dem Wappen unten
 * links verschwindet und stattdessen oben links im Zeichen `#ich` steht (der
 * Ursprungswunsch vom 03.08. meinte die Ecke OBEN links, gebaut wurde unten).
 * Der Name (MixPi/Box) und die laufende Fassung bleiben unten.
 *
 * DAS IST KEINE HARMLOSE AENDERUNG. `.wappen-bild` ist 44 px hoch, dazu 2 px
 * `gap` — faellt es weg, wird das Wappen um 46 px kuerzer. `.kat-liste` hat
 * `flex: 1` und `justify-content: safe center`; der Kategorienblock bekommt
 * die 46 px als Spielraum und rutscht ZENTRIERT um die Haelfte NACH UNTEN —
 * in das Laut-Fenster hinein, das ohnehin schon an „Radio" knabbert
 * ([[laut-fenster-schlaegt-kategorienknopf]]).
 *
 * `tools/ecke-oben-links-messen.mjs` beantwortet das nicht: es sieht nur den
 * Ausschnitt OBEN LINKS (360 x 170) und die Kategorien zwei und drei liegen
 * darunter. `tools/beruehrziele-neu.mjs` sieht die GROESSE jedes Ziels, aber
 * nicht, wie hoch das Wappen ist und ob die Rechnung im Kommentar bei
 * `.leiste` (480 - 82 - 10 - 100 - 6 = 282) noch stimmt.
 *
 * ══ WAS ES MISST ═══════════════════════════════════════════════════════════
 * Je Variante (Probe-CSS) und je Boxname:
 *   * das Rechteck jeder der vier Kategorien (y oben, y unten, Hoehe) —
 *     und, weil das die eigentliche Frage ist, die WANDERUNG gegenueber der
 *     ersten Variante, Knopf fuer Knopf;
 *   * die Hoehe des Wappens und seiner drei Teile (Bild, Name, Fassung);
 *   * die Rechnung aus dem Kommentar bei `.leiste` in ihren Einzelposten,
 *     GEMESSEN statt abgeschrieben: Leistenhoehe minus padding oben minus
 *     padding unten minus Wappen minus dessen `padding-top` — und daneben,
 *     was die vier Knoepfe wirklich brauchen;
 *   * ob `.kat-liste` UEBERLAEUFT (scrollHeight > clientHeight) und ob dabei
 *     oben etwas unerreichbar wird (der Fall, fuer den `safe` dasteht);
 *   * den freien Raum ueber der ersten und unter der letzten Kategorie.
 *
 * GEMESSEN WIRD MIT `getBoundingClientRect`, UND DAS IST HIER RICHTIG: Die
 * Frage lautet „wohin rutscht der Block", nicht „was traefe ein Finger". Fuer
 * die zweite Frage ist `tools/beruehrziele-neu.mjs` zustaendig, das tastet.
 * Beide Antworten gehoeren zusammen und keine ersetzt die andere.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts. Eigener headless-Browser, eigene `tools/neu-vorschau.mjs`. Die
 * Probe-Regeln leben im Browser dieses Laufs und sind mit ihm vorbei; in
 * `NewDesign/app.css` wird kein Zeichen geschrieben. Laeuft auf dem Zielport
 * schon eine Vorschau, wird sie GELIEHEN und ihre Lage hinterher wieder
 * hingelegt ([[vorschau-wird-geliehen]], tools/leihgabe.mjs).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/leiste-geometrie-messen.mjs
 *     node tools/leiste-geometrie-messen.mjs --name lang
 *     node tools/leiste-geometrie-messen.mjs --name mitbox,ohnebox,lang
 *     node tools/leiste-geometrie-messen.mjs --probe '.wappen-bild{display:none}'
 *     node tools/leiste-geometrie-messen.mjs --md
 *     node tools/leiste-geometrie-messen.mjs http://127.0.0.1:8502/neu/
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8502/neu/'
const MD = hat('md')
/*
 * `--laut` — MIT OFFENEM LAUTSTAERKE-FENSTER MESSEN.
 *
 * Das ist der Schirm, auf dem die Kategorie „Radio" heute schon beschnitten
 * ist ([[laut-fenster-schlaegt-kategorienknopf]]), und der einzige, auf dem
 * eine Verschiebung des Kategorienblocks ueberhaupt WEHTUT. Das Fenster ist
 * ein Kissen mit `border-radius: 999px` — seine linke Kante ist ein
 * HALBKREIS, keine Gerade. Wie tief es in einen Knopf hineinragt, haengt also
 * davon ab, wie weit dessen Mitte von der Mitte des Fensters entfernt liegt.
 * Genau deshalb ist „der Block rutscht nach unten" hier nicht gleichbedeutend
 * mit „es wird schlimmer" oder „es wird besser": es kommt auf die Richtung an,
 * und die laesst sich am Halbkreis nicht raten.
 */
const LAUT = hat('laut')
const NAMEN = (() => {
  const w = opt('name', 'mitbox,lang')
  return typeof w === 'string' ? w.split(',').map((s) => s.trim()).filter(Boolean) : ['mitbox']
})()

/** 800x480 auf 5" Waveshare — dieselbe Zahl wie in beruehrziele-neu.mjs. */
const MM_JE_PIXEL = 0.14
const mmS = (px) => (px * MM_JE_PIXEL).toFixed(2)

/*
 * DIE VARIANTEN. Sie stehen HIER und nicht auf der Kommandozeile, weil die
 * Frage aus vier Vergleichen besteht und ein einzelner Lauf davon nichts
 * beantwortet: „heute" ohne Gegenstueck ist eine Zahl ohne Aussage.
 * `--probe` haengt eine fuenfte an, fuer den naechsten Vorschlag.
 */
const VARIANTEN = [
  { name: 'heute', was: 'wie HEAD: Bild im Wappen, safe center', css: '' },
  {
    name: 'ohne-bild',
    was: 'Bild faellt aus dem Wappen, Ausrichtung bleibt safe center',
    css: '.wappen-bild{display:none}',
  },
  {
    name: 'ohne-bild-oben',
    was: 'Bild faellt weg UND die Liste wird oben angeheftet (flex-start)',
    css: '.wappen-bild{display:none} .kat-liste{justify-content:flex-start}',
  },
  {
    // DIE GEGENPROBE, und sie ist nicht ueberfluessig: Sie trennt die Wirkung
    // des fehlenden Bildes von der Wirkung der geaenderten Ausrichtung. Ohne
    // sie liesse sich eine Verbesserung der einen Sache der anderen zuschreiben.
    name: 'nur-oben',
    was: 'Bild BLEIBT, nur die Ausrichtung wird flex-start (Wirkung trennen)',
    css: '.kat-liste{justify-content:flex-start}',
  },
]
const EXTRA = typeof opt('probe', null) === 'string' ? opt('probe', null) : null
if (EXTRA) VARIANTEN.push({ name: 'probe', was: EXTRA, css: EXTRA })

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT; und der
// eigene Browser laeuft auf einem FREIEN Port mit eigenem Profil statt auf
// einer festen Nummer, die ein Ueberlebender eines harten Abbruchs noch
// halten koennte. Beides samt der Messungen dahinter: tools/leihgabe.mjs.
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

// ── DIE MESSUNG, IM BROWSER ────────────────────────────────────────────────
const MESSEN_JS = String.raw`
(() => {
  const r = (e) => {
    if (!e) return null
    const b = e.getBoundingClientRect()
    return { x: +b.left.toFixed(1), y: +b.top.toFixed(1), b: +b.width.toFixed(1),
             h: +b.height.toFixed(1), un: +b.bottom.toFixed(1) }
  }
  const q = (s) => document.querySelector(s)
  const leiste = q('.leiste')
  const liste = q('.kat-liste')
  const wappen = q('.wappen')
  const ls = leiste ? getComputedStyle(leiste) : null
  const ws_ = wappen ? getComputedStyle(wappen) : null
  const kats = [...document.querySelectorAll('.kat')].map((k) => ({
    /* DER NAME KOMMT AUS DEM ELEMENT, nicht aus einer Liste hier — eine
       fuenfte Kategorie oder eine Umbenennung faellt sonst nicht auf. */
    wort: (k.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20) ||
          (k.getAttribute('aria-label') || '').slice(0, 20),
    ...r(k),
  }))
  return {
    breite: innerWidth, hoehe: innerHeight,
    griff: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--griff')) || 0,
    leiste: r(leiste),
    leistePadOben: ls ? parseFloat(ls.paddingTop) : null,
    leistePadUnten: ls ? parseFloat(ls.paddingBottom) : null,
    leisteGap: ls ? parseFloat(ls.rowGap || ls.gap) || 0 : null,
    /* ZWEI VERSCHIEDENE ABSTAENDE, UND SIE SIND SEIT DEM 06.08.2026 NICHT MEHR
       GLEICH. (KEINE RUECKWAERTS-HOCHKOMMAS IN DIESEM BLOCK: er steht selbst
       in einem Vorlagenliteral und beendet es sonst mitten im Kommentar —
       dieselbe Falle wie in eltern-muster-schau.mjs, hier beim Schreiben
       dieser Zeilen zum dritten Mal zugeschlagen.)
       Der gap der .leiste (6 px) liegt EINMAL zwischen Liste und Wappen;
       der gap der .kat-liste liegt DREIMAL zwischen den vier Kategorien und
       steht seit dem Umbau des Eltern-Bereichs auf 15 px (2 mm statt 0,84).
       Bis dahin waren beide 6, und die Verwechslung unten in der RECHNUNG fiel
       nicht auf: sie rechnete die vier Knoepfe mit 4*66 + 3*6 = 282 statt
       4*66 + 3*15 = 309 und meldete bei dreizeiligem Boxnamen 29 px UEBRIG,
       wo 2 uebrig sind. Genau diese Reserve traegt seit dem 06.08. die
       9-mm-Marke (siehe .wappen-name in app.css) — eine um 27 px zu
       freundliche Zahl ist hier keine Ungenauigkeit, sondern eine Einladung. */
    listeGap: liste ? parseFloat(getComputedStyle(liste).rowGap || getComputedStyle(liste).gap) || 0 : null,
    liste: r(liste),
    listeAusrichtung: liste ? getComputedStyle(liste).justifyContent : null,
    listeScrollH: liste ? liste.scrollHeight : null,
    listeClientH: liste ? liste.clientHeight : null,
    listeScrollTop: liste ? liste.scrollTop : null,
    wappen: r(wappen),
    wappenPadOben: ws_ ? parseFloat(ws_.paddingTop) : null,
    wappenBild: r(q('.wappen-bild')),
    wappenBildAn: (() => { const e = q('.wappen-bild'); return e ? getComputedStyle(e).display !== 'none' : false })(),
    wappenName: r(q('.wappen-name')),
    wappenNameText: (q('.wappen-name')?.textContent || '').replace(/\s+/g, ' ').trim(),
    wappenNameZeilen: (() => {
      /* WIE VIELE ZEILEN WIRKLICH GESETZT SIND — nicht wie viele der Name
         haette. „-webkit-line-clamp: 3" schneidet ab (keine Backticks: Vorlagenzeichenkette); die Hoehe geteilt durch
         die Zeilenhoehe sagt, was UEBRIG blieb. */
      const e = q('.wappen-name'); if (!e) return null
      const s = getComputedStyle(e)
      const zh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.02
      return +(e.getBoundingClientRect().height / zh).toFixed(2)
    })(),
    wappenNameAbgeschnitten: (() => {
      const e = q('.wappen-name'); if (!e) return null
      return e.scrollHeight > e.clientHeight + 1
    })(),
    wappenFassung: r(q('.wappen-fassung')),
    kats,
    /* DAS LAUT-FENSTER, falls es offen steht — die Kante, an der „Radio"
       heute schon abgeschnitten wird. */
    lautFenster: (() => {
      const e = q('#mp-laut-fenster')
      if (!e || e.hidden || getComputedStyle(e).display === 'none') return null
      return r(e)
    })(),
  }
})()
`

// ── Lauf ───────────────────────────────────────────────────────────────────
const ergebnisse = []
try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => null)
    await warte(150)
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }

  for (const nm of NAMEN) {
    await stand('voll')
    await stand('spielt')
    await stand(`name-${nm}`)
    await neuLaden()
    /* DIE FASSUNGSZEILE KOMMT UEBER DAS NETZ NACH. Wird gemessen, bevor sie
       da ist, ist das Wappen 11 px zu kurz — genau der Grund, aus dem an
       `.wappen-fassung` ein `min-height` steht. Also warten, bis sie steht. */
    for (let n = 0; n < 20; n++) {
      const da = await ev(`(document.getElementById('wappen-fassung')||{}).textContent`)
      if (da && String(da).trim()) break
      await warte(200)
    }
    if (LAUT) {
      const r = await ev(`(() => {
        const k = document.getElementById('mp-laut'); if (!k) return 'kein Lautknopf'
        k.click(); return 'ok' })()`)
      if (r !== 'ok') throw new Error(`Laut-Fenster: ${r}`)
      await warte(700)
    }
    for (const v of VARIANTEN) {
      await ev(`(() => {
        document.getElementById('leiste-probe')?.remove()
        const s = document.createElement('style')
        s.id = 'leiste-probe'
        s.textContent = ${JSON.stringify(v.css)}
        document.head.appendChild(s)
        return true })()`)
      await warte(250)
      const m = await ev(MESSEN_JS)
      ergebnisse.push({ name: nm, variante: v, m })
    }
    await ev(`document.getElementById('leiste-probe')?.remove()`)
  }
  /* DEN BOXNAMEN ZURUECKSTELLEN. Er ist Zustand der VORSCHAU und ueberlebt
     diesen Lauf — wer danach `tools/beruehrziele-neu.mjs` an derselben
     Vorschau startet, mass sonst weiter mit „Kinderzimmer Erdgeschoss Box"
     und bekam 33 statt 21 zu kleine Ziele, ohne dass sich eine Zeile Code
     geaendert haette. Genau so ist es am 06.08.2026 passiert. Das Werkzeug
     dort setzt den Namen seither selbst; hier wird trotzdem aufgeraeumt,
     denn eine geliehene Vorschau gibt man so zurueck, wie man sie vorfand
     ([[vorschau-wird-geliehen]]). */
  await stand('name-mitbox')
  ws.close()
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

// ── Bericht ────────────────────────────────────────────────────────────────
const z = (n, w = 7) => (n === null || n === undefined ? '—'.padStart(w) : String(n).padStart(w))

for (const nm of NAMEN) {
  const reihe = ergebnisse.filter((e) => e.name === nm)
  if (!reihe.length) continue
  const grund = reihe[0]
  console.log('')
  console.log('═'.repeat(96))
  console.log(`BOXNAME „${nm}"  —  im Wappen steht: „${grund.m.wappenNameText}"`)
  console.log('═'.repeat(96))

  for (const e of reihe) {
    const m = e.m
    console.log('')
    console.log(`── ${e.variante.name}  (${e.variante.was})`)
    if (e.variante.css) console.log(`   Regel: ${e.variante.css}`)
    console.log(
      `   Leiste  y ${m.leiste.y}..${m.leiste.un} (h ${m.leiste.h}), padding ${m.leistePadOben} oben / ${m.leistePadUnten} unten, gap ${m.leisteGap}`,
    )
    console.log(
      `   Wappen  y ${m.wappen.y}..${m.wappen.un}  HOEHE ${m.wappen.h}` +
        `   (Bild ${m.wappenBildAn ? m.wappenBild.h : 'weg'}, Name ${m.wappenName.h} = ${m.wappenNameZeilen} Zeilen${m.wappenNameAbgeschnitten ? ' ABGESCHNITTEN' : ''}, Fassung ${m.wappenFassung.h}, padding-top ${m.wappenPadOben})`,
    )
    console.log(
      `   Liste   y ${m.liste.y}..${m.liste.un} (h ${m.liste.h}), ${m.listeAusrichtung}, scrollH ${m.listeScrollH} / clientH ${m.listeClientH}` +
        (m.listeScrollH > m.listeClientH + 1 ? '  ← LAEUFT UEBER' : ''),
    )
    const ersteLuft = m.kats.length ? +(m.kats[0].y - m.liste.y).toFixed(1) : null
    const letzteLuft = m.kats.length ? +(m.liste.un - m.kats[m.kats.length - 1].un).toFixed(1) : null
    console.log(`   Luft    ${ersteLuft} px ueber der ersten, ${letzteLuft} px unter der letzten Kategorie`)
    if (m.lautFenster) {
      const f = m.lautFenster
      const rad = Math.min(f.h, f.b) / 2
      const fmy = f.y + f.h / 2
      console.log(`   LAUT-FENSTER  x ${f.x}..${+(f.x + f.b).toFixed(1)}  y ${f.y}..${f.un}  (h ${f.h}, Halbkreis r ${rad})`)
      /* WIE WEIT DAS KISSEN IN JEDEN KNOPF RAGT — gerechnet aus dem Halbkreis
         und daneben gestellt, damit die Zahl aus beruehrziele-neu.mjs eine
         Erklaerung hat und nicht bloss ein Befund ist. */
      for (const k of m.kats) {
        const my = k.y + k.h / 2
        const dy = Math.abs(my - fmy)
        if (dy >= rad || k.un <= f.y || k.y >= f.un) continue
        const ein = f.x + rad - Math.sqrt(Math.max(0, rad * rad - dy * dy))
        const rest = +(ein - k.x).toFixed(1)
        console.log(
          `                 „${k.wort}" Mitte y ${my}, ${(+dy.toFixed(1))} px von der Fenstermitte` +
            ` → Kissenkante bei x ${+ein.toFixed(1)} → frei ${rest} px = ${mmS(rest)} mm`,
        )
      }
    }
    console.log('   Kategorie          y oben   y unten    Hoehe   Wanderung ggue. „heute"')
    const basis = reihe.find((x) => x.variante.name === 'heute')
    for (let i = 0; i < m.kats.length; i++) {
      const k = m.kats[i]
      const b = basis?.m.kats[i]
      const d = b ? +(k.y - b.y).toFixed(1) : null
      const dtxt = d === null ? '' : d === 0 ? '   0' : `${d > 0 ? '+' : ''}${d} px ${d > 0 ? 'nach unten' : 'nach oben'}`
      console.log(`   ${k.wort.padEnd(16)} ${z(k.y)}  ${z(k.un)}  ${z(k.h)}   ${dtxt}`)
    }
    /* DIE RECHNUNG AUS DEM KOMMENTAR BEI `.leiste`, in Einzelposten und
       gemessen. Sie steht dort als 480 - 82 - 10 - 100 - 6 = 282.
       WAS DIE KNOEPFE BRAUCHEN, RECHNET MIT `.kat-liste{gap}` (`listeGap`) UND
       NICHT MIT `.leiste{gap}`. Hier stand `m.leisteGap` — richtig, solange
       beide 6 px waren, und seit dem 06.08.2026 falsch: `.kat-liste` steht auf
       15. Die Begruendung fuer die Trennung steht bei `listeGap` in MESS_FN. */
    const brauchen = m.kats.reduce((s, k) => s + k.h, 0) + Math.max(0, m.kats.length - 1) * (m.listeGap ?? m.leisteGap)
    const bleibt = +(m.leiste.h - m.leistePadOben - m.leistePadUnten - m.wappen.h - m.leisteGap).toFixed(1)
    console.log(
      `   RECHNUNG  ${m.leiste.h} - ${m.leistePadOben} - ${m.leistePadUnten} - ${m.wappen.h} (Wappen) - ${m.leisteGap} (Abstand) = ${bleibt}` +
        `   |  die ${m.kats.length} Knoepfe brauchen ${brauchen} (${m.kats.length} x Griff + ${Math.max(0, m.kats.length - 1)} x ${m.listeGap ?? m.leisteGap} Abstand)` +
        `   |  ${bleibt >= brauchen ? `${+(bleibt - brauchen).toFixed(1)} px UEBRIG` : `${+(brauchen - bleibt).toFixed(1)} px ZU WENIG`}`,
    )
  }
}

if (MD) {
  console.log('')
  console.log('| Boxname | Variante | Wappen h | Liste y | Radio y oben | Radio y unten | Wanderung | Ueberlauf |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const e of ergebnisse) {
    const m = e.m
    const letzte = m.kats[m.kats.length - 1]
    const basis = ergebnisse.find((x) => x.name === e.name && x.variante.name === 'heute')
    const bl = basis?.m.kats[basis.m.kats.length - 1]
    const d = bl ? +(letzte.y - bl.y).toFixed(1) : ''
    console.log(
      `| ${e.name} | ${e.variante.name} | ${m.wappen.h} | ${m.liste.y} | ${letzte.y} | ${letzte.un} | ${d > 0 ? '+' : ''}${d} | ${m.listeScrollH > m.listeClientH + 1 ? 'ja' : 'nein'} |`,
    )
  }
}

console.log('')
console.log(`Millimeter: 1 px = ${MM_JE_PIXEL} mm (800x480 auf 5"). Ein Ziel von 9 mm sind ${(9 / MM_JE_PIXEL).toFixed(1)} px.`)
console.log('GEMESSEN wurde mit getBoundingClientRect — die Frage ist die LAGE des Blocks.')
console.log('Wie gross ein Ziel wirklich ist (verdeckt/abgeschnitten), sagt tools/beruehrziele-neu.mjs.')
