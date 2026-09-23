#!/usr/bin/env node
/**
 * PASST „KINDER" NOCH UNTER „SYSTEM" — ODER BRAUCHT ES EINE EIGENE GRUPPE?
 *
 * ══ WOZU, UND WARUM NICHT EINES DER VORHANDENEN ════════════════════════════
 *
 * Vor dem Bau der Kinderverwaltung steht EINE Frage, und sie entscheidet ueber
 * die Gliederung des ganzen Admin-Menues: Traegt die Karte der Gruppe „System"
 * einen FUENFTEN Punkt, oder wird „Kinder" eine fuenfte Gruppe in der Spalte?
 *
 * DIE ZAHLEN IN app.css BEANTWORTEN SIE NICHT. Bei `.fach-sprung` steht die
 * Rechnung „vier Punkte 4 * 66 + 3 * 15 = 309 in 266 → 23 px der vierten
 * Zeile". Sie stammt vom 06.08.2026 und ist seitdem mehrfach ueberholt worden
 * (der Fachkopf hat seinen Knopf verloren, die Karte ist gewachsen);
 * tools/admin-menue-schau.mjs meldet fuer dieselbe Uebersicht heute „432 px
 * Sicht, 432 px Inhalt". Eine der beiden Zahlen ist alt, und welche, sieht man
 * ihnen nicht an. Genau deshalb wird hier GEMESSEN.
 *
 * DIE VORHANDENEN WERKZEUGE KOENNEN ES NICHT:
 *   * `admin-menue-schau.mjs`   misst, was DA IST. Es kann nicht sagen, was
 *     passierte, wenn eine Zeile dazukaeme.
 *   * `eltern-masse-messen.mjs --faecher 5`   klont FAECHER in die Spalte, nicht
 *     Zeilen in die Karte. Es beantwortet also genau die andere Haelfte.
 *   * `beruehrziele-neu.mjs`   misst Groessen, kennt aber keine Gliederung.
 *
 * ══ WIE GEMESSEN WIRD ══════════════════════════════════════════════════════
 *
 * GEKLONT, NICHT GEBAUT — wie `--faecher` in eltern-masse-messen.mjs: Die
 * fuenfte Zeile wird im BROWSER aus der letzten vervielfaeltigt und umbenannt.
 * NewDesign/ bleibt dabei unangetastet; die Messung sagt etwas ueber den
 * PLATZ, nicht ueber einen halbfertigen Bau.
 *
 * GEZAEHLT WIRD, WAS EIN FINGER SIEHT: je Zeile die Bildpunkte, die innerhalb
 * der Karte liegen. Drei Antworten sind moeglich, und die mittlere ist die
 * gefaehrliche:
 *     GANZ            die Zeile steht vollstaendig da
 *     ANGESCHNITTEN   sie ist zu sehen und sagt „hier geht es weiter"
 *     UNSICHTBAR      sie steht unter dem Rand — ein Punkt, den niemand findet
 *
 * DIE MARKE FUER „ANGESCHNITTEN" IST 10 px. Sie ist dieselbe, die
 * admin-menue-schau.mjs an seine Unterseiten anlegt („von jeder Zeile sind
 * mindestens 10 px zu sehen"); zwei verschiedene Marken fuer dieselbe Frage
 * waeren zwei Berichte, die sich widersprechen duerfen.
 *
 * ══ WAS AM 07.08.2026 HERAUSKAM ════════════════════════════════════════════
 *     System mit 4 Punkten   432 px Sicht, 309 px Inhalt   — rollt nicht
 *     System mit 5 Punkten   432 px Sicht, 402 px Inhalt   — rollt nicht, die
 *                            fuenfte Zeile steht GANZ da
 *     System mit 6 Punkten   432 px Sicht, 471 px Inhalt   — ROLLT, von der
 *                            sechsten sind 27 px zu sehen
 *     Spalte mit 5 Gruppen   476 px Sicht, 396 px Inhalt   — rollt nicht
 * „Kinder" ist deshalb der fuenfte PUNKT unter System geworden und keine
 * fuenfte Gruppe. DIE ANTWORT AUF DIE NAECHSTE FRAGE STEHT DAMIT AUCH SCHON
 * DA: Ein SECHSTER Punkt unter System geht nicht mehr ganz hinein. Das
 * Werkzeug bleibt liegen, weil es sie jederzeit neu stellt — es zaehlt, was
 * es vorfindet, und klont EINEN dazu.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/kinder-platz-messen.mjs
 *   node tools/kinder-platz-messen.mjs --ziel http://127.0.0.1:9601/neu/
 *   node tools/kinder-platz-messen.mjs --bilder /tmp/kinder
 * ENDE 0 immer — das hier ist eine MESSUNG und kein Urteil. Was daraus folgt,
 * entscheidet ein Mensch.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const BILDER = opt('bilder')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Der Schirm der Box: 800x480 auf 5 Zoll = 0,1397 mm je Bildpunkt. */
const MM = 0.1397
/** Ab wann eine angeschnittene Zeile noch sagt „hier geht es weiter". */
const SCHNIPSEL_PX = 10

let ZIEL = opt('ziel')
if (!ZIEL) {
  // Ohne Adresse: ein freier Port — vorschauLeihen startet dort gleich die
  // eigene Vorschau (ausdruecklich mit `--port`, nicht auf dem Vorgabeport
  // 8299, der womoeglich einem anderen Arbeitsbaum gehoert).
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
}

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
// wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
// eine Vorschau, die jemand anders verstellt hat. Laeuft unter ZIEL noch
// keine, startet vorschauLeihen dort selbst eine und beendet sie am Ende.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ZIEL)
console.log(`ZIEL: ${ZIEL}${leihe.eigene ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)

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

/**
 * WAS IN DER KARTE STEHT UND WIEVIEL DAVON ZU SEHEN IST.
 *
 * Der Vergleich ist der Schnittbereich von Zeile und Karte, nicht die Hoehe
 * der Zeile: eine Zeile kann oben ODER unten abgeschnitten sein, und eine
 * Karte, die gerollt ist, hat beides gleichzeitig.
 */
const KARTE_JS = `(() => {
  const f = document.getElementById('fach-zeilen')
  if (!f) return null
  const kb = f.getBoundingClientRect()
  const zeilen = [...f.children].map((z) => {
    const b = z.getBoundingClientRect()
    const sicht = Math.max(0, Math.min(b.bottom, kb.bottom) - Math.max(b.top, kb.top))
    const n = z.querySelector('.zeile-name')
    return {
      name: n ? n.textContent.trim() : (z.textContent || '').trim().slice(0, 30),
      hoch: Math.round(b.height),
      sicht: Math.round(sicht),
      knopf: z.tagName === 'BUTTON' || !!z.querySelector('.zeile-tat'),
    }
  })
  return {
    sichthoehe: Math.round(f.clientHeight),
    inhalt: Math.round(f.scrollHeight),
    rollt: f.scrollHeight > f.clientHeight + 1,
    zeilen,
  }
})()`

/**
 * EINE FUENFTE ZEILE EINSETZEN — geklont, nicht gebaut.
 *
 * Die letzte Zeile wird vervielfaeltigt und umbenannt. Sie traegt damit genau
 * die Masse, die eine echte haette (dieselbe Klasse, derselbe `margin-top`),
 * und keine, die jemand hier haette schaetzen muessen.
 */
const FUENFTE_JS = `(() => {
  const f = document.getElementById('fach-zeilen')
  if (!f || !f.lastElementChild) return false
  const k = f.lastElementChild.cloneNode(true)
  const n = k.querySelector('.zeile-name')
  if (n) n.textContent = 'Benutzer'
  const u = k.querySelector('.zeile-unter')
  if (u) u.textContent = 'Wer an dieser Box hört: anlegen, umbenennen, löschen.'
  f.appendChild(k)
  return true
})()`

/** Die Spalte der Gruppen: rollt sie, wenn eine fuenfte dazukommt? */
const SPALTE_JS = `(() => {
  const s = document.getElementById('eltern-faecher')
  if (!s) return null
  const knoepfe = [...s.querySelectorAll('.fach-knopf')]
  const sb = s.getBoundingClientRect()
  return {
    anzahl: knoepfe.length,
    sichthoehe: Math.round(s.clientHeight),
    inhalt: Math.round(s.scrollHeight),
    rollt: s.scrollHeight > s.clientHeight + 1,
    letzteGanz: knoepfe.length
      ? Math.round(knoepfe[knoepfe.length - 1].getBoundingClientRect().bottom) <= Math.round(sb.bottom) + 1
      : false,
    knopfhoch: knoepfe.length ? Math.round(knoepfe[0].getBoundingClientRect().height) : 0,
  }
})()`

/** Eine fuenfte Gruppe in die Spalte klonen — derselbe Griff wie oben. */
const FUENFTE_GRUPPE_JS = `(() => {
  const s = document.getElementById('eltern-faecher')
  if (!s) return false
  const letzte = [...s.querySelectorAll('.fach-knopf')].pop()
  if (!letzte) return false
  const k = letzte.cloneNode(true)
  k.textContent = 'Benutzer'
  k.classList.remove('hier')
  letzte.after(k)
  return true
})()`

const urteil = (z) => (z.sicht >= z.hoch - 1 ? 'GANZ' : z.sicht >= SCHNIPSEL_PX ? 'angeschnitten' : 'UNSICHTBAR')

function karteZeigen(k, was) {
  if (!k) return console.log(`   ${was}: keine Karte gefunden`)
  console.log(`   ${was}: ${k.sichthoehe} px Sicht, ${k.inhalt} px Inhalt  →  ${k.rollt ? 'ROLLT' : 'rollt nicht'}`)
  for (const z of k.zeilen) {
    const u = urteil(z)
    console.log(
      `      ${u === 'GANZ' ? '✓' : u === 'angeschnitten' ? '~' : '✗'} ${String(z.sicht).padStart(3)} von ${String(z.hoch).padStart(3)} px  ${(z.sicht * MM).toFixed(1).padStart(4)} mm  ${u.padEnd(14)} „${z.name}"`,
    )
  }
}

const browser = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  // Scheitert der Browserstart, ist das finally unten noch nicht erreicht —
  // die geliehene Vorschau muss trotzdem zurueck.
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!browser) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${join(BILDER, `${name}.png`)}`)
  }

  await fetch(new URL('/vorschau/sperre-aus', ZIEL)).catch(() => null)
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2200)
  await adminAuf(ev, { warteMs: 1100 })
  await ev(`document.querySelector('#eltern-faecher [data-fach="system"]').click()`)
  await warte(800)

  console.log('\nMASSE FUER „KINDER" — 800x480, 0.1397 mm/px')
  console.log(`Marke fuer „angeschnitten": ${SCHNIPSEL_PX} px (dieselbe wie in admin-menue-schau.mjs)`)

  console.log('\n── A) DIE KARTE DER GRUPPE „SYSTEM", WIE SIE HEUTE IST ──────────')
  const heute = await ev(KARTE_JS)
  karteZeigen(heute, `System, ${heute.zeilen.length} Punkte`)
  await bild('a-system-vier')

  console.log('\n── B) DIESELBE KARTE MIT EINEM PUNKT MEHR ───────────────────────')
  const gesetzt = await ev(FUENFTE_JS)
  if (gesetzt !== true) console.log('   die fuenfte Zeile liess sich nicht einsetzen')
  await warte(150)
  const mitFuenf = await ev(KARTE_JS)
  karteZeigen(mitFuenf, `System, ${mitFuenf.zeilen.length} Punkte (der letzte geklont)`)
  await bild('b-system-fuenf')

  console.log('\n── C) DIE SPALTE DER GRUPPEN, HEUTE ─────────────────────────────')
  const sp4 = await ev(SPALTE_JS)
  console.log(
    `   ${sp4.anzahl} Gruppen zu ${sp4.knopfhoch} px: ${sp4.sichthoehe} px Sicht, ${sp4.inhalt} px Inhalt  →  ${sp4.rollt ? 'ROLLT' : 'rollt nicht'}`,
  )

  console.log('\n── D) DIESELBE SPALTE MIT EINER GRUPPE MEHR ─────────────────────')
  await ev(FUENFTE_GRUPPE_JS)
  await warte(150)
  const sp5 = await ev(SPALTE_JS)
  console.log(
    `   ${sp5.anzahl} Gruppen zu ${sp5.knopfhoch} px: ${sp5.sichthoehe} px Sicht, ${sp5.inhalt} px Inhalt  →  ${sp5.rollt ? 'ROLLT' : 'rollt nicht'}`,
  )
  console.log(`   die letzte Gruppe steht ganz im Bild: ${sp5.letzteGanz ? 'ja' : 'NEIN'}`)
  await bild('d-spalte-fuenf')

  console.log('\n── WAS DARAUS FOLGT ─────────────────────────────────────────────')
  const fuenfte = mitFuenf?.zeilen?.[mitFuenf.zeilen.length - 1]
  const uf = fuenfte ? urteil(fuenfte) : 'unbekannt'
  console.log(`   Ein ${mitFuenf.zeilen.length}. Punkt unter „System" waere: ${uf}`)
  console.log(`   Eine ${sp5.anzahl}. Gruppe in der Spalte: ${sp5.rollt ? 'die Spalte ROLLT — verboten' : 'passt'}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await leihe.zurueckgeben()
}
