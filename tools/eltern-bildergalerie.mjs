#!/usr/bin/env node
/**
 * DIE BILDER ZUM ELTERN-BEREICH ALS SEITE — jede Lage einmal, und daneben die
 * paar Zahlen, die ein Bild NICHT hergibt.
 *
 * ══ WOZU, UND WARUM NICHT EINES DER ZEHN VORHANDENEN ═══════════════════════
 *
 * Am 06.08.2026 ist `#eltern` vom DECKEL (`inset: 0`) zur SEITE geworden.
 * Gemessen wurde das reichlich — `eltern-seite-schau.mjs` haelt 43 Aussagen,
 * `beruehrziele-neu.mjs` zaehlt 22 zu kleine Ziele im ganzen Haus.
 *
 * WAS KEINES DIESER WERKZEUGE TUT: die Lagen der Reihe nach ABBILDEN. Sie
 * machen je EIN Bild (`--bild`) von je EINEM Zustand, und welcher das ist,
 * entscheidet der Ablauf des Werkzeugs. Wer sehen will, ob die Rechenaufgabe
 * am Rand klebt, ob die Leiste neben dem Bereich wie ein Rest aussieht oder
 * ob der Rueckweg auf dem Zeichen „wer hoert" steht, braucht die Bilder
 * NEBENEINANDER — und zwar von allen Toren, allen Faechern und einmal mit
 * langem Boxnamen.
 *
 * DER GRUND, WARUM DAS EIN EIGENES WERKZEUG IST UND KEIN WEGWERFBEFEHL, steht
 * im Wissenspaket unter [[rueckweg-verdeckt-die-ueberschrift]]: Dort standen
 * ALLE VIER Durchgaenge des Pruefschritts auf gruen, waehrend der Rueckweg
 * mitten auf dem Wort „Eltern-Bereich" lag. Gefunden hat es das BILD. Eine
 * Ueberschrift ist kein Bedienelement — sie darf beliebig verdeckt werden,
 * ohne dass irgendeine Trefferflaeche schrumpft. Ein Werkzeug, das nur
 * Knoepfe kennt, sieht die halbe Seite nicht.
 *
 * ══ WAS ES NEBEN DEN BILDERN MISST ═════════════════════════════════════════
 * Genau die Sorte Befund, die ein Bild zeigt, aber nicht beziffert:
 *
 *   UEBERDECKUNG   jede Ueberschneidung zwischen den TEXTEN des Bereichs
 *                  (.eltern-titel, .eltern-unter, .fach-name, .tor-frage) und
 *                  allem, was darueber liegt — Rueckweg, Kissen, Zeichen.
 *                  Texte fallen aus jeder Beruehrziel-Rechnung heraus.
 *   RAND           wie viel Luft die Torkarte nach links, rechts und unten
 *                  hat. „Klebt am Rand" ist eine Zahl, keine Meinung.
 *   ROLLEN         ob die Faecherspalte rollt — bei vier Faechern, bei fuenf
 *                  (das ist die Reserve, die der Umbau hergeben sollte) und
 *                  mit langem Boxnamen.
 *   LEISTE         ob neben dem Bereich wirklich die vier Kategorien stehen
 *                  und nicht die Buehne (der Fall aus `platz-machen`).
 *
 * ══ WAS ES NICHT AENDERT ═══════════════════════════════════════════════════
 * Nichts an einer Datei und nichts an der Box. Das FUENFTE Fach fuer die
 * Rollprobe wird im Browser eingehaengt und danach wieder entfernt — es
 * beruehrt `NewDesign/app.js` nicht.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/eltern-bildergalerie.mjs
 *   node tools/eltern-bildergalerie.mjs --ziel http://127.0.0.1:8711/neu/
 *   node tools/eltern-bildergalerie.mjs --ordner /tmp/galerie
 *   node tools/eltern-bildergalerie.mjs --entwurf     # auch den Entwurf ablichten
 *
 * OHNE `--ziel` startet es eine EIGENE Vorschau auf einem freien Port. Eine
 * geliehene bediente den Arbeitsbaum dessen, der sie gestartet hat
 * ([[vorschau-wird-geliehen]]) — und der Debug-Port kommt vom Betriebssystem,
 * weil eine Zahl, die man von Hand waehlt, eine ist, die man doppelt waehlt.
 *
 * ENDE 0, wenn jedes Bild entstanden ist und keine der Zahlen daneben eine
 * Ueberdeckung eines Textes meldet.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = typeof opt('ziel', null) === 'string' ? opt('ziel') : null
const ORDNER = typeof opt('ordner', null) === 'string' ? opt('ordner') : '/tmp/eltern-galerie'
const MIT_ENTWURF = !!opt('entwurf', false)

const mm = (px) => (px * 0.14).toFixed(2)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort })
  console.log(`   ${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
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
    if (gestorben !== null) throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} war belegt`)
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
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

/* ══ DIE MESSUNG IM BROWSER ═══════════════════════════════════════════════
 *
 * SIE MISST TEXTE UND NICHT KNOEPFE, und das ist der ganze Grund fuer diese
 * Datei. Die Knoepfe hat `eltern-seite-schau.mjs` schon; was dort NICHT
 * vorkommt, sind Ueberschrift, Unterzeile, Fachname und Torfrage — genau die
 * Sorte Flaeche, unter der sich am 04.08. ein Rueckweg versteckt hat, ohne
 * dass eine einzige Zahl rot wurde. */
const SCHAU_JS = String.raw`
(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect()
    return { l: Math.round(r.left), o: Math.round(r.top), r: Math.round(r.right), u: Math.round(r.bottom),
             b: Math.round(r.width), h: Math.round(r.height) } }
  const sicht = (e) => { if (!e) return false; const s = getComputedStyle(e)
    return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0 }
  const benennen = (e) => { if (!e) return 'nichts'
    const t = [e.tagName.toLowerCase()]; if (e.id) t.push('#' + e.id)
    const k = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (k.length) t.push('.' + k.join('.'))
    const s = e.getAttribute('aria-label') || (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22)
    return t.join('') + (s ? '  „' + s + '"' : '') }
  const q = (s) => document.querySelector(s)
  const schnitt = (a, b) => {
    if (!a || !b) return 0
    const x = Math.min(a.r, b.r) - Math.max(a.l, b.l)
    const y = Math.min(a.u, b.u) - Math.max(a.o, b.o)
    return x > 0.5 && y > 0.5 ? Math.round(x * y) : 0 }

  /* ── DIE TEXTE, DIE NIEMAND SONST MISST ────────────────────────────────
   * Gegen ALLES, was ueber ihnen liegen kann. Der Rueckweg (z 9) und das
   * Kissen (z 9) sind die beiden, die es schon getan haben. */
  const texte = [
    ['Ueberschrift', '.eltern-titel'], ['Unterzeile', '.eltern-unter'],
    ['Fachname', '#fach-name'], ['Torfrage', '.tor-frage'],
    ['Tormeldung', '.tor-meldung'], ['Boxname', '.leiste-name'],
  ]
  const drueber = [
    ['Rueckweg', '#zurueck'], ['Kissen', '#mp'], ['Zeichen', '#ich'],
    ['Lautfenster', '#mp-laut-fenster'],
  ]
  const ueberdeckt = []
  for (const [tn, ts] of texte) {
    const te = q(ts); if (!sicht(te)) continue
    const tr = R(te)
    for (const [dn, ds] of drueber) {
      const de = q(ds); if (!sicht(de) || de.contains(te) || te.contains(de)) continue
      const px = schnitt(tr, R(de))
      if (px > 0) ueberdeckt.push({ text: tn, durch: dn, px })
    }
  }

  /* ── KLEBT DIE TORKARTE AM RAND? ───────────────────────────────────────
   * Nicht „sieht eng aus", sondern: wie viele Bildpunkte Luft, gemessen vom
   * Rand des Eltern-Bereichs (nicht vom Schirm — der Bereich beginnt bei 88). */
  const be = q('#eltern'), br = sicht(be) ? R(be) : null
  const karte = q('.eltern-tor .tor-karte') || q('.eltern-tor > *') || q('.eltern-tor')
  const kr = sicht(karte) ? R(karte) : null
  const rand = br && kr ? { links: kr.l - br.l, rechts: br.r - kr.r, oben: kr.o - br.o, unten: br.u - kr.u } : null

  const sp = q('#eltern-faecher')
  const knoepfe = [...document.querySelectorAll('.fach-knopf')]
  const kats = [...document.querySelectorAll('.kat')]
  /* WAS STEHT IM 88-PX-STREIFEN LINKS? Die vier Kategorien — oder die Buehne
     mit spielbaren Kacheln (der Fall, wenn platz-machen haengenbleibt).
     KEINE BACKTICKS IN DIESEM ABSCHNITT: er steht in einem Template-Literal,
     und die Shell-Regel aus [[commit-nachricht-ueber-datei]] hat hier ein
     Geschwister — JavaScript beendet daran die Zeichenkette. */
  const imStreifen = [...document.querySelectorAll('button, [role="button"], a[href]')]
    .filter((e) => { if (!sicht(e)) return false; const r = e.getBoundingClientRect()
      return r.right <= 90 && r.width > 8 && r.height > 8 })
    .map(benennen)

  return JSON.stringify({
    klassen: [...document.body.classList],
    offen: { eltern: !!q('#eltern') && !q('#eltern').hidden,
             tor: !!q('#eltern-tor') && !q('#eltern-tor').hidden,
             flaeche: !!q('#eltern-flaeche') && !q('#eltern-flaeche').hidden,
             mp: !!q('#mp') && !q('#mp').hidden },
    eltern: br, leiste: sicht(q('.leiste')) ? R(q('.leiste')) : null,
    kissen: sicht(q('#mp')) ? R(q('#mp')) : null,
    faecher: sicht(sp) ? R(sp) : null, fach: sicht(q('.eltern-fach')) ? R(q('.eltern-fach')) : null,
    zurueck: sicht(q('#zurueck')) ? R(q('#zurueck')) : null,
    titel: sicht(q('.eltern-titel')) ? R(q('.eltern-titel')) : null,
    torKarte: kr, rand,
    fachName: q('#fach-name') ? (q('#fach-name').textContent || '').trim() : null,
    ueberdeckt, imStreifen,
    kats: kats.map((e) => benennen(e)),
    faecherWorte: knoepfe.map((e) => (e.textContent || '').trim()),
    spalte: sicht(sp) ? { sicht: Math.round(sp.clientHeight), inhalt: Math.round(sp.scrollHeight),
      rollt: sp.scrollHeight > sp.clientHeight + 1,
      letztesGanz: knoepfe.length
        ? Math.max(...knoepfe.map((e) => e.getBoundingClientRect().bottom)) <= sp.getBoundingClientRect().bottom + 0.5
        : null } : null,
  })
})()
`

/**
 * Faecher EINHAENGEN, messen, WIEDER WEGNEHMEN. Der Baum bleibt heil — es wird
 * im Browser geklont, `NewDesign/app.js` nicht angefasst.
 *
 * WARUM DAS UEBERHAUPT GEHT UND KEINE ATTRAPPE IST: `.fach-knopf` traegt
 * `flex: 0 0 var(--griff)` — flex-shrink 0. Ein Knopf zu viel kann also nicht
 * heimlich schrumpfen, er muss die Spalte zum Rollen bringen. Waere die
 * Angabe `flex: 1 1 auto`, meldete diese Probe ewig gruen, weil die Knoepfe
 * statt der Spalte nachgaeben — und der Befund waere dann nicht „passt",
 * sondern „jedes Fach ist jetzt kleiner als 9 mm". DIE GEGENPROBE UNTEN
 * BEWEIST ES: mit einem SECHSTEN muss die Spalte rollen. Tut sie es nicht,
 * misst dieses Werkzeug nichts.
 */
const FACH_DAZU_JS = (kennung, wort) => String.raw`
(() => {
  const n = document.getElementById('eltern-faecher'); if (!n) return 'keine Spalte'
  const v = n.querySelector('.fach-knopf'); if (!v) return 'kein Fach zum Nachbauen'
  const k = v.cloneNode(true); k.dataset.fach = '${kennung}'
  const w = k.querySelector('span'); if (w) w.textContent = '${wort}'
  n.appendChild(k); return 'ok'
})()
`
const PROBEN_WEG_JS = `(() => { for (const k of document.querySelectorAll('[data-fach^="probe-"]')) k.remove()
  return 'ok' })()`

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

await mkdir(ORDNER, { recursive: true })
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
  /** Der Weg hinein ist der des Fingers: 700 ms Halten auf dem Zahnrad. */
  const hinein = async () => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 900 })
  }
  const schau = async () => JSON.parse(await ev(SCHAU_JS))
  const bild = async (name) => {
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    const pfad = join(ORDNER, `${name}.png`)
    await writeFile(pfad, Buffer.from(s.data, 'base64'))
    return pfad
  }

  /**
   * EINE LAGE: hinstellen, ablichten, die Zahlen daneben legen.
   * @param {string} name    Dateiname ohne Endung
   * @param {string} was     was hier zu sehen sein soll
   * @param {string[]} staende  Vorschau-Zustaende, in dieser Reihenfolge
   * @param {Function} [dazu]   noch etwas tun, nachdem der Bereich offen ist
   */
  const lage = async (name, was, staende, dazu = null) => {
    console.log(`\n── ${was}  (${name}.png)`)
    for (const s of staende) await stand(s)
    await laden()
    await hinein()
    if (dazu) await dazu(ev)
    const d = await schau()
    const pfad = await bild(name)
    console.log(`   Bild: ${pfad}`)
    ja(d.offen.eltern, 'der Bereich steht offen', `Tor ${d.offen.tor}, Flaeche ${d.offen.flaeche}`)
    ja(d.ueberdeckt.length === 0, 'KEIN TEXT DES BEREICHS IST UEBERDECKT',
       d.ueberdeckt.map((u) => `${u.text} durch ${u.durch} (${u.px} px)`).join(', ') || 'Titel/Unterzeile/Fachname/Torfrage frei')
    ja(!!d.leiste && d.leiste.b === 88 && d.kats.length === 4,
       'DIE LEISTE STEHT DANEBEN UND ZEIGT DIE VIER KATEGORIEN',
       `${d.kats.length} Kategorien, Streifen: ${d.imStreifen.join(' | ') || 'leer'}`)
    if (d.rand) {
      ja(d.rand.links >= 8 && d.rand.rechts >= 8 && d.rand.unten >= 8,
         'DIE TORKARTE KLEBT AN KEINEM RAND',
         `links ${d.rand.links}, rechts ${d.rand.rechts}, oben ${d.rand.oben}, unten ${d.rand.unten} px`)
    }
    if (d.spalte) {
      ja(!d.spalte.rollt && d.spalte.letztesGanz !== false, 'DIE FAECHERSPALTE ROLLT NICHT',
         `Sicht ${d.spalte.sicht} px, Inhalt ${d.spalte.inhalt} px, Faecher: ${d.faecherWorte.join(', ')}`)
    }
    return d
  }

  /* ── DER BOXNAME WIRD BEI JEDER LAGE GESETZT, AUCH DER KURZE ─────────────
   *
   * UND DAS IST HIER SCHON SCHIEFGEGANGEN: Die Zustaende der Vorschau sind
   * KLEBRIG — `/vorschau/name-lang` gilt weiter, bis jemand etwas anderes
   * stellt, ueber das Ende des Laufs hinaus. Der erste Anlauf dieser Datei
   * setzte den langen Namen nur bei den `lang-`-Lagen und liess ihn davor
   * ungesetzt. Beim zweiten Lauf trug deshalb JEDE Lage den langen Namen —
   * auch die sieben, die den kurzen zeigen sollten. Die Bilder sahen
   * vollstaendig aus und waren es nicht: der kurze Name kam nie vor, und die
   * `lang-`-Bilder bewiesen nichts, weil sie sich von den anderen nicht
   * unterschieden.
   *
   * DAS IST [[attrappe-luegt-durch-weglassen]] im Messwerkzeug selbst, und es
   * war nur am BILD zu sehen — an zwei Bildern, die gleich aussahen, obwohl
   * sie es nicht durften. Seither steht der Name in JEDER Liste, und die
   * kurze Sorte ist `name-mitbox` (der Standardfall der Vorschau) und nicht
   * „gar nichts gestellt". */
  const KURZ = ['voll', 'spielt', 'name-mitbox']
  const LANG = ['voll', 'spielt', 'name-lang']

  // ══ DIE DREI TORE ════════════════════════════════════════════════════════
  await lage('tor-rechnen', 'Tor mit Rechenaufgabe', [...KURZ, 'sperre-rechnen'])
  await lage('tor-pin', 'Tor mit PIN', [...KURZ, 'sperre-pin'])
  await lage('tor-geste', 'Tor mit Geste', [...KURZ, 'sperre-geste'])

  /* ══ DIE VIER GRUPPEN ══════════════════════════════════════════════════════
   *
   * HIER STAND: „DREI DER VIER VERLASSEN DIESE OBERFLAECHE (`pfad` in
   * ELTERN_FAECHER — WLAN, Anzeige, System liegen in der Angular-App). Ein
   * Tipp darauf waere ein voller Seitenwechsel und kein Bild dieses
   * Bereichs." DAS WAR EINMAL RICHTIG und ist es seit dem 06.08.2026 in
   * keinem Teil mehr: WLAN und Anzeige sind nacheinander native Faecher
   * geworden, „System" ist eine Gruppe, und in der ganzen SPALTE gibt es
   * keinen `pfad` mehr. Der einzige Sprung in die alte Oberflaeche ist eine
   * ZEILE in der Uebersicht von „System".
   *
   * ES WIRD DESHALB NICHT MEHR NUR DIE SPALTE ABGELICHTET, sondern jede
   * Gruppe MIT ihrer Uebersicht — ein Tipp fuehrt jetzt nirgendwohin ausser
   * eine Ebene tiefer, also ist das Bild auch eines dieses Bereichs.
   */
  for (const [id, wort] of [
    ['verbindung', 'Verbindung'],
    ['medien', 'Medien'],
    ['anzeige', 'Darstellung'],
    ['system', 'System'],
  ]) {
    await lage(`flaeche-${id}`, `Flaeche, Uebersicht der Gruppe ${wort}`,
      [...KURZ, 'sperre-aus'],
      async (e) => {
        await e(`(() => { const k = document.querySelector('#eltern-faecher [data-fach="${id}"]')
          if (!k) return 'fehlt'; k.click(); return 'ok' })()`)
        await warte(700)
      })
  }
  // UND DIE EINE UNTERSEITE, die als einzige wirklich gefuellte Liste
  // aussagekraeftig ist: die Bluetooth-Geraete.
  await lage('flaeche-bluetooth', 'Flaeche, Unterseite Bluetooth (die gefuellte Liste)',
    [...KURZ, 'sperre-aus'],
    async (e) => {
      await e(`(() => { const k = document.querySelector('#eltern-faecher [data-fach="verbindung"]')
        if (!k) return 'fehlt'; k.click(); return 'ok' })()`)
      await warte(700)
      await e(`(() => { for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (n && n.textContent.trim() === 'Bluetooth') { z.click(); return 'ok' } }
        return 'fehlt' })()`)
      await warte(700)
    })

  // ══ DASSELBE MIT LANGEM BOXNAMEN ═════════════════════════════════════════
  await lage('lang-tor-rechnen', 'LANGER BOXNAME: Tor mit Rechenaufgabe', [...LANG, 'sperre-rechnen'])
  await lage('lang-tor-pin', 'LANGER BOXNAME: Tor mit PIN', [...LANG, 'sperre-pin'])
  await lage('lang-tor-geste', 'LANGER BOXNAME: Tor mit Geste', [...LANG, 'sperre-geste'])
  const dlang = await lage('lang-flaeche', 'LANGER BOXNAME: Flaeche mit den vier Faechern',
    [...LANG, 'sperre-aus'])

  // ══ DIE ROLLPROBE — VIER, DANN FUENF ═════════════════════════════════════
  //
  // FUENF IST DIE ZAHL, DIE DER UMBAU HERGEBEN SOLLTE. Die alte Form (Kissen
  // bleibt stehen, `bottom: 84px`) gab der Spalte 306 px; vier Faecher
  // brauchen 4 * 66 + 3 * 15 = 309, es fehlten 3 px und „System" fiel auf
  // 8,82 mm. Wenn die neue Form etwas taugt, traegt sie nicht nur vier,
  // sondern fuenf ohne zu rollen.
  console.log('\n── DIE ROLLPROBE MIT EINEM FUENFTEN FACH  (rollprobe-fuenf.png)')
  const eingehaengt = await ev(FACH_DAZU_JS('probe-fuenf', 'Probe 5'))
  if (eingehaengt !== 'ok') throw new Error(`fuenftes Fach: ${eingehaengt}`)
  await warte(300)
  const d5 = await schau()
  console.log(`   Bild: ${await bild('rollprobe-fuenf')}`)
  ja(!!d5.spalte && !d5.spalte.rollt && d5.spalte.letztesGanz !== false,
     'AUCH FUENF FAECHER ROLLEN NICHT — die Reserve steht, mit langem Namen',
     d5.spalte ? `Sicht ${d5.spalte.sicht} px, Inhalt ${d5.spalte.inhalt} px, ${d5.faecherWorte.length} Faecher` : '—')

  /* ── DIE GEGENPROBE, OHNE DIE DIE ZEILE DARUEBER NICHTS WERT WAERE ────────
   * Fuenf Faecher brauchen 5 * 66 + 4 * 15 = 390 px und die Spalte hat genau
   * 390. Das ist KEIN Spielraum, das ist eine Punktlandung — und eine
   * Punktlandung sieht in `scrollHeight` genauso aus wie ein Meter Luft,
   * weil `scrollHeight` nie unter `clientHeight` faellt. Ein sechstes Fach
   * MUSS die Spalte also zum Rollen bringen. Bleibt sie ruhig, misst dieses
   * Werkzeug die Spalte gar nicht, und alles darueber ist eine gruene Zusage,
   * die niemand eingeloest hat ([[attrappe-luegt-durch-weglassen]]). */
  await ev(FACH_DAZU_JS('probe-sechs', 'Probe 6'))
  await warte(300)
  const d6 = await schau()
  console.log(`   Bild: ${await bild('rollprobe-sechs')}`)
  ja(!!d6.spalte && d6.spalte.rollt,
     'GEGENPROBE: EIN SECHSTES FACH BRINGT DIE SPALTE ZUM ROLLEN — die Zeile darueber misst wirklich',
     d6.spalte ? `Sicht ${d6.spalte.sicht} px, Inhalt ${d6.spalte.inhalt} px, ${d6.faecherWorte.length} Faecher` : '—')
  await ev(PROBEN_WEG_JS)
  ja(dlang.spalte && !dlang.spalte.rollt, 'und vier erst recht nicht',
     dlang.spalte ? `Sicht ${dlang.spalte.sicht} px, Inhalt ${dlang.spalte.inhalt} px` : '—')

  /* ══ DAS LAUT-FENSTER UEBER DEM ELTERN-BEREICH ═════════════════════════════
   *
   * ══ WARUM DIESER ABSCHNITT ERST HEUTE ENTSTEHT ═════════════════════════
   * Solange `#eltern` ein DECKEL war, konnte es diese Lage NICHT geben: das
   * Kissen lag darunter, `#mp-laut` war nicht zu treffen, und ein Fenster,
   * das man nicht aufmachen kann, deckt auch nichts zu. Erst die SEITE macht
   * das Kissen bedienbar — und damit zum ersten Mal auch sein Fenster.
   *
   * KEIN VORHANDENES WERKZEUG SIEHT DAS, und zwar aus drei verschiedenen
   * Gruenden, die sich gegenseitig decken:
   *   * `beruehrziele-neu.mjs` hat einen Schirm „laut" UND Schirme
   *     „eltern-tor"/„eltern-flaeche" — aber der eine ist die STARTSEITE mit
   *     Fenster, die anderen sind der Eltern-Bereich OHNE. Die Kreuzung der
   *     beiden misst niemand.
   *   * `eltern-seite-schau.mjs` misst die Ueberdeckung durch `#mp` — das
   *     Fenster ist ein Geschwister von `#mp` und faellt nicht darunter.
   *   * DIE ECKEN DER GESTE SIND KEINE BEDIENELEMENTE. Sie stehen in keinem
   *     Baum, tragen kein `role`, und `gesteTipp` haengt an `pointerdown` auf
   *     `#eltern-tor`. Jedes Werkzeug, das `button, [role=button], a[href]`
   *     aufzaehlt, sieht von der Geste GAR NICHTS.
   *
   * ══ GEMESSEN (06.08.2026, 800x480) ═════════════════════════════════════
   * `#mp-laut-fenster` steht `fixed` bei x 48..752, y 328..386. Der
   * Eltern-Bereich reicht bis y 378 (Tor) bzw. 386 (Karte). Das Fenster liegt
   * also auf den untersten 50 px von beidem, und dort steht:
   *     Tor „pin"/„rechnen"  „Letzte Ziffer loeschen", „0", „Weiter"
   *     Tor „geste"          die Ecke LINKS UNTEN (eine der vier)
   *     Flaeche              das vierte Fach „System"
   * Ein Finger dort trifft `#mp-laut-fenster` oder `#mp-laut-regler`.
   *
   * ES HEILT SICH NACH 4 s SELBST (`LAUT_FENSTER_MS`), und „Danebentippen
   * schliesst" greift NICHT: der Zuhoerer am Dokument steigt bei
   * `#mp-laut-fenster` ausdruecklich aus. Der Tipp auf die verdeckte Taste
   * tut also gar nichts — er macht das Fenster nicht einmal zu.
   *
   * AM SCHLIMMSTEN IST DIE GESTE, und das ist der Grund, warum dieser
   * Abschnitt rot werden darf: Beim Ziffernfeld SIEHT man die dunkle Pille
   * auf den Tasten liegen. Die Geste hat keine sichtbare Ecke, und ihre
   * Anzeige verraet den Fortschritt seit dem 06.08. ausdruecklich NICHT mehr.
   * Ein Elternteil tippt die vierte Ecke, nichts geschieht, und es gibt
   * nichts, woran man sehen koennte warum.
   *
   * ══ DREI WEGE, ALLE GEMESSEN, KEINER UMSONST ═══════════════════════════
   *   A  Das Fenster faehrt in die Kissenreihe (`bottom: var(--mp-rand)`).
   *      Tor und Flaeche sind dann VOLLSTAENDIG frei — gemessen null tote
   *      Tasten, alle vier Ecken lebendig. ES KOSTET ALLE VIER
   *      KISSENKNOEPFE: „Vorheriger Titel", „Lautstaerke", „Anhalten oder
   *      weiter" und „Naechster Titel" treffen dann den Regler bzw. das
   *      Fenster. „Anhalten" ist der vom Betreiber genannte Grund fuer diese
   *      Form — dieser Weg nimmt ihn weg und ist damit teurer als der Fehler.
   *   B  Das Fenster wird schmal und stellt sich in das freie Feld links vom
   *      eingefahrenen Kissen (x 96..419). Es deckt dann NICHTS zu. Es kostet
   *      die Laenge des Reglers: 582 -> rund 250 px. Genau diese Laenge war
   *      schon einmal der Befund vom Geraet („kleiner Hub, grosse Wirkung"
   *      bei 190 px, siehe [[laut-fenster-schlaegt-kategorienknopf]]) — der
   *      Weg gibt eine Behebung zurueck, um eine andere zu bekommen.
   *   C  `#mp-laut` wird stillgelegt, solange der Bereich offen ist — sichtbar
   *      gedaempft wie `#ich`. Kostet null Bildpunkte und keine Trefferflaeche,
   *      widerspricht aber demselben Satz wie A („anhalten UND lauter sind der
   *      Grund fuer diese Form").
   *
   * ES IST NICHT ENTSCHIEDEN, UND ZWAR ABSICHTLICH NICHT. Jeder der drei Wege
   * nimmt etwas weg, das der Betreiber ausdruecklich genannt hat; das ist
   * dieselbe Sorte Abwaegung wie die Frage nach der Leiste am Tor, und die
   * gehoert entschieden und angeschrieben, nicht nebenbei erledigt. Bis dahin
   * steht dieser Abschnitt ROT — ein Werkzeug, das einen gemessenen Fehler
   * gruen meldet, weil er noch niemandem gehoert, waere die Attrappe. */
  console.log('\n── DAS LAUT-FENSTER UEBER DEM ELTERN-BEREICH ───────────────')
  const LAUT_JS = String.raw`
(() => {
  const nenn = (e) => { if (!e) return 'nichts'
    const a = [e.tagName.toLowerCase()]; if (e.id) a.push('#' + e.id)
    const c = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (c.length) a.push('.' + c.join('.'))
    const s = e.getAttribute('aria-label') || (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20)
    return a.join('') + (s ? '  "' + s + '"' : '') }
  const sicht = (e) => { if (!e) return false; const s = getComputedStyle(e)
    return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0 }
  const t = document.getElementById('eltern-tor')
  const torDa = sicht(t)
  /* DIE VIER ECKEN DER GESTE — nachgerechnet wie gesteEckeKante() in app.js.
     Sie stehen in keinem Baum; wer sie nicht rechnet, misst sie nie. */
  let ecken = []
  if (torDa) {
    const r = t.getBoundingClientRect()
    const k = Math.max(66, Math.min(120, Math.floor(Math.sqrt(0.05 * r.width * r.height))))
    ecken = [['links oben', r.left + k/2, r.top + k/2], ['rechts oben', r.right - k/2, r.top + k/2],
             ['rechts unten', r.right - k/2, r.bottom - k/2], ['links unten', r.left + k/2, r.bottom - k/2]]
      .map(([n, x, y]) => { const g = document.elementFromPoint(Math.round(x), Math.round(y))
        return { n, trifft: nenn(g), ok: !!g && (g === t || t.contains(g)) } })
  }
  const ziele = [...document.querySelectorAll('#eltern button, #eltern [role="button"], #eltern a[href]')]
    .filter(sicht)
    .filter((e) => !e.disabled && e.getAttribute('aria-disabled') !== 'true')
    .map((e) => { const q = e.getBoundingClientRect()
      const g = document.elementFromPoint(Math.round(q.left + q.width/2), Math.round(q.top + q.height/2))
      return { n: nenn(e), trifft: nenn(g), ok: !!g && (g === e || e.contains(g)) } })
  const f = document.getElementById('mp-laut-fenster')
  return JSON.stringify({ fensterOffen: sicht(f), zahl: ziele.length,
    tot: ziele.filter((z) => !z.ok).map((z) => z.n + '  ->  ' + z.trifft),
    eckenTot: ecken.filter((e) => !e.ok).map((e) => e.n + '  ->  ' + e.trifft) })
})()
`
  for (const [art, wort] of [['rechnen', 'Rechenaufgabe'], ['pin', 'PIN'], ['geste', 'Geste'], ['aus', 'Flaeche']]) {
    for (const s of [...KURZ, `sperre-${art}`]) await stand(s)
    await laden()
    await hinein()
    const r = await ev(`(() => { const k = document.getElementById('mp-laut')
      if (!k) return 'kein Lautknopf'; k.click(); return 'ok' })()`)
    if (r !== 'ok') throw new Error(`Lautknopf: ${r}`)
    await warte(700)
    const d = JSON.parse(await ev(LAUT_JS))
    console.log(`   Bild: ${await bild(`laut-ueber-${art}`)}`)
    ja(d.fensterOffen, `${wort}: das Laut-Fenster steht wirklich offen (sonst prueft die Zeile darunter nichts)`)
    ja(d.tot.length === 0 && d.eckenTot.length === 0,
       `${wort}: DAS LAUT-FENSTER NIMMT KEIN BEDIENELEMENT DES BEREICHS WEG`,
       [...d.tot, ...d.eckenTot].join(' | ') || `${d.zahl} Ziele geprueft`)
  }

  // ══ DER ENTWURF ZUM VERGLEICH ════════════════════════════════════════════
  if (MIT_ENTWURF) {
    console.log('\n── DER ENTWURF ZUM VERGLEICH  (entwurf-*.png)')
    await send(ws, 'Page.navigate', { url: `${ZIEL.replace(/\/neu\/$/, '/')}MixPiBox-standalone.html` })
    await warte(1800)
    console.log(`   Bild: ${await bild('entwurf-start')}`)
    const r = await ev(`(() => {
      const k = [...document.querySelectorAll('*')].find((e) =>
        /einstellung|admin|eltern/i.test(e.getAttribute('aria-label') || e.title || ''))
      if (k) { k.click(); return 'ok' } return 'kein Zugang gefunden' })()`)
    await warte(900)
    console.log(`   Entwurf, Eltern-Bereich: ${r} → ${await bild('entwurf-eltern')}`)
  }
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
}

const schlecht = befunde.filter((b) => !b.gut)
console.log(`\n${befunde.length - schlecht.length} von ${befunde.length} Aussagen halten.`)
console.log(`Bilder in ${ORDNER}`)
if (schlecht.length) {
  console.log('NICHT gehalten:')
  for (const b of schlecht) console.log(`  ${b.wort}`)
  process.exit(1)
}
