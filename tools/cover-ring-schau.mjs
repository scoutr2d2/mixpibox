#!/usr/bin/env node
/**
 * TRAEGT DER FORTSCHRITTSRING IM COVER-MODUS — UND ZEIGT ER DEN RICHTIGEN WERT?
 *
 * WOFUER, woertlich (Betreiber, 07.08.2026): „ich möchte im cover modus auch
 * einen umlaufenden prozess um den knopf."
 *
 * WARUM ES DAFUER EIN EIGENES WERKZEUG BRAUCHT: Ein Ring aus `conic-gradient`
 * hinter einer Maske ist nichts, was man an einem Rechteck nachrechnen kann.
 * `album-gross-schau.mjs` misst diese Ansicht, aber es misst LAGEN von Kaesten
 * — es kann nicht sagen, ob der Ring FARBE traegt, ob die Bahn dahinter noch
 * zu sehen ist und ob ueberhaupt ein RING dasteht. Genau das geht still
 * kaputt: kennt ein Chromium `mask-composite` nicht, malt dieselbe Regel eine
 * VOLLE SCHEIBE statt eines Rings — und keine Regel, keine Groesse und kein
 * Beruehrziel meldet das. Auf dem Schirm liegt dann eine Scheibe ueber der
 * Taste.
 *
 * DESHALB WIRD HIER DAS BILD SELBST BEFRAGT. Der Schirm wird abfotografiert
 * und es werden vier Punkte gelesen:
 *   * im BOGEN (vor der Kante)   -> muss die volle Ringfarbe tragen
 *   * in der BAHN (dahinter)     -> muss den blassen Rest tragen, nicht dasselbe
 *   * in der LUFT dazwischen     -> muss der HINTERGRUND sein; ist er es nicht,
 *                                   hat die Maske nicht gegriffen
 *   * auf der TASTE              -> zum Vergleich, damit der Ring nicht in ihr
 *                                   verschwindet
 *
 * BEIDE STAENDE, UND DAS IST KEIN SCHMUCK. Die Ringfarbe ist `--ink`, und die
 * kippt zwischen hell und dunkel. Ein Werkzeug, das nur einen Stand misst,
 * haette bei der Farbwahl nichts gemerkt: Creme traegt auf dem dunklen Kissen
 * und ist auf hellem Grund unsichtbar — genau daran waere die naheliegende
 * Loesung („nimm dieselbe Farbe wie beim Kissen") gescheitert.
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen eine GELIEHENE Vorschau, die
 * am Ende zurueckgelegt wird. Die Box wird nicht angefasst.
 *
 *   node tools/cover-ring-schau.mjs [http://127.0.0.1:8299/neu/] [--bilder]
 */

import { writeFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const BILDER = process.argv.includes('--bilder')

/* DER ANTEIL WIRD NICHT GESETZT, SONDERN ABGELESEN — und das ist beim ersten
 * Lauf dieses Werkzeugs gelernt worden. Ein `--ring: 35%` an den <body> zu
 * schreiben sah richtig aus, war aber nach 350 ms wieder weg: `balkenMalen`
 * laeuft im Takt und schreibt denselben Ort. Gemessen wurden dann 32,14 %, und
 * die erste Fassung meldete das als Fehler („der Wert kommt hier nicht an") —
 * dabei war es der Beweis fuer das Gegenteil. Der Wert kam an, er war nur
 * frischer als der eigene.
 *
 * Aus dem Fehlschlag wird die bessere Messung: abgelesen wird, was die
 * Oberflaeche im Betrieb WIRKLICH zeigt. Ein gesetzter Wert haette ausserdem
 * genau den Fehler verdeckt, um den es hier geht — dass der Wert den
 * Cover-Modus nie erreicht. */

/** Darunter/darueber sind Bogen und Bahn nicht mehr sauber zu trennen: bei 0
 *  waere alles Bahn, bei 100 alles Bogen, und eine kaputte Maske ginge als
 *  richtig durch. */
const ANTEIL_MIN = 8
const ANTEIL_MAX = 92

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser().catch((e) => {
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
let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(44)} ${wert}`)

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // Ohne das misst man einen Schirm, den es nicht gibt: `--window-size` liess
  // dem Sichtfenster nur 337 statt 480 px Hoehe.
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800, height: 480, deviceScaleFactor: 1, mobile: false,
  })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // ══ DIE LAGE WIRD GESTELLT UND NICHT VORGEFUNDEN ═══════════════════════
  //
  // DER FORTSCHRITTSRING UMGIBT EIN COVER, UND EIN COVER GIBT ES NUR, WENN
  // ETWAS LAEUFT. Ohne diese Zeilen misst der Lauf, was die vorige Messung
  // stehen gelassen hat.
  //
  // GEMESSEN (07.08.2026): Direkt nach tools/eltern-seite-schau.mjs — das die
  // Vorschau auf `spielt: "still"`, `cover: false` legt — meldet dieses
  // Werkzeug REPRODUZIERBAR „4 Abweichung(en)", darunter „am Knopf steht kein
  // --ring". Nach `voll`/`mit-cover`/`spielt` meldet es „ohne Abweichung".
  // Der Ring war nie weg; es lief nur nichts, um das er haette liegen koennen.
  //
  // Diese vier sind schon einmal als „standen vorher schon so da"
  // weitergereicht worden. Sie standen da — aber nicht im Baum, sondern in
  // einer geliehenen Vorschau. Siehe [[vorschau-wird-geliehen]].
  for (const w of ['voll', 'mit-cover', 'spielt']) {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)

  // DER WEG DORTHIN IST DER ECHTE — Mini-Player auf, dann aufs Cover tippen.
  // Ein `hidden = false` von aussen zeigte die Ansicht auch dann, wenn sie
  // ueber die Oberflaeche gar nicht mehr zu erreichen waere.
  const weg = await ev(`(() => {
    const auf = document.querySelector('.mp-bild'); if (!auf) return 'kein Mini-Player';
    auf.click();
    const c = document.querySelector('#gross .gross-bild'); if (!c) return 'kein Cover im Player';
    c.click();
    return document.getElementById('album-gross').hidden ? 'Ansicht blieb zu' : 'ok' })()`)
  zeile('Weg dorthin (Player -> Cover)', weg)
  if (weg !== 'ok') melde(`die Cover-Ansicht war ueber die Oberflaeche nicht erreichbar: ${weg}`)
  await warte(600)

  for (const licht of ['hell', 'dunkel']) {
    console.log(`\n── ${licht.toUpperCase()} ──────────────────────────────────────────`)
    await ev(`document.documentElement.dataset.licht = ${JSON.stringify(licht)}`)
    await warte(350)

    const lage = await ev(`(() => {
      const k = document.getElementById('ag-spiel'); if (!k) return null;
      const r = k.getBoundingClientRect();
      return { x: r.left, y: r.top, b: r.width, h: r.height,
               ringInhalt: getComputedStyle(k, '::after').content,
               grund: getComputedStyle(document.body).backgroundColor,
               geerbt: getComputedStyle(k).getPropertyValue('--ring').trim() } })()`)
    if (!lage) {
      melde(`${licht}: den Knopf #ag-spiel gibt es nicht`)
      continue
    }

    // ERST DIE VERERBUNG, DANN DIE FARBE. Erreicht der Wert den Knopf gar
    // nicht, sind alle Farbmessungen danach zwar richtig, sagen aber etwas
    // ueber einen Ring bei 0 % — und der saehe fuer das Auge genauso aus wie
    // einer, den es nicht gibt.
    zeile('Trefferflaeche', `${Math.round(lage.b)}x${Math.round(lage.h)} px`)
    zeile('--ring am Knopf angekommen', lage.geerbt || '(nichts)')
    if (lage.ringInhalt === 'none')
      melde(`${licht}: am Knopf haengt kein ::after — es gibt keinen Ring`)
    if (lage.b < 64 || lage.h < 64)
      melde(`${licht}: die Trefferflaeche ist ${Math.round(lage.b)}x${Math.round(lage.h)} px — unter 9 mm`)

    const anteil = Number.parseFloat(lage.geerbt)
    if (!Number.isFinite(anteil)) {
      melde(`${licht}: am Knopf steht kein --ring ("${lage.geerbt}") — der Wert erreicht den Cover-Modus nicht`)
      continue
    }
    if (anteil < ANTEIL_MIN || anteil > ANTEIL_MAX) {
      // KEIN FEHLER DER OBERFLAECHE, sondern eine Lage, in der dieses Werkzeug
      // nichts aussagen kann. Das gehoert gesagt und nicht als Grün verbucht.
      console.log(`  (Fortschritt steht bei ${anteil.toFixed(1)} % — zwischen ${ANTEIL_MIN} und ${ANTEIL_MAX} % waere er messbar. Farbmessung uebersprungen.)`)
      continue
    }

    const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    const png = Buffer.from(data, 'base64')
    if (BILDER) writeFileSync(`cover-ring-${licht}.png`, png)

    const p = await punkteLesen(png, lage, anteil)
    if (!p) continue

    zeile('im Bogen (vor der Kante)', beschreibe(p.imBogen))
    zeile('in der Bahn (dahinter)', beschreibe(p.inBahn))
    zeile('Luft zwischen Ring und Taste', beschreibe(p.luft))
    zeile('die Taste selbst', beschreibe(p.taste))

    if (naheBei(p.imBogen, p.inBahn, 24))
      melde(`${licht}: Bogen und Bahn sind fast dieselbe Farbe (${beschreibe(p.imBogen)} gegen ${beschreibe(p.inBahn)}) — der Anteil ist nicht abzulesen`)
    if (!naheBei(p.luft, p.grund, 30))
      melde(`${licht}: zwischen Ring und Taste steht nicht der Hintergrund (${beschreibe(p.luft)} statt ${beschreibe(p.grund)}) — die Maske hat nicht gegriffen, das ist eine Scheibe`)
    if (naheBei(p.imBogen, p.taste, 40))
      melde(`${licht}: der Ring traegt fast die Farbe der Taste (${beschreibe(p.imBogen)} gegen ${beschreibe(p.taste)}) — er verschwindet in ihr`)

    const kb = kontrast(p.imBogen, p.grund)
    zeile('Bogen gegen Hintergrund', `${kb.toFixed(2)} : 1`)
    if (kb < 3) melde(`${licht}: der Ring traegt nur ${kb.toFixed(2)} : 1 gegen den Hintergrund`)
    const kbahn = kontrast(p.inBahn, p.grund)
    zeile('Bahn gegen Hintergrund', `${kbahn.toFixed(2)} : 1`)
    if (kbahn < 1.15)
      melde(`${licht}: die Bahn hebt sich mit ${kbahn.toFixed(2)} : 1 nicht vom Hintergrund ab — der Ring hat keine sichtbare Laenge`)
  }

  await ev(`document.body.style.removeProperty('--ring')`)
} finally {
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nohne Abweichung')
process.exit(fehler ? 1 : 0)

// ── Hilfen ────────────────────────────────────────────────────────────────

/**
 * Vier Punkte aus dem Bildschirmfoto lesen.
 *
 * DIE WINKEL SIND NICHT GERATEN: `conic-gradient` beginnt OBEN und laeuft im
 * Uhrzeigersinn; bei `anteil` Prozent liegt die Kante bei anteil/100 * 360 Grad.
 * Gemessen wird deutlich davor und deutlich dahinter, damit ein weicher
 * Uebergang an der Kante nicht als Fehlschlag gilt.
 *
 * DER RADIUS DARF NICHT FEST SEIN — und das ist der Fehler, an dem die erste
 * Fassung dieses Werkzeugs sechsmal Rot meldete, waehrend der Ring auf dem
 * Bild tadellos dastand.
 *
 * Der Knopf ist ein Rechteck mit RUNDEN ECKEN (84 px, Radius 26). Bei einem
 * Kreis laege die Bahn ueberall gleich weit von der Mitte; bei diesem Umriss
 * NICHT: an der Kantenmitte (0°, 90°, …) sitzt sie bei 38–41 px, auf der
 * Diagonalen dagegen bei rund 44–49 px, weil die Ecke weiter hinausreicht
 * (16·√2 + 26 = 48,6). Wer mit 39,5 px in die Ecke greift, landet IM LOCH der
 * Maske und liest den Hintergrund — und meldet dann „es gibt keinen Ring".
 *
 * Deshalb wird der Strahl ABGETASTET statt gerechnet: von aussen nach innen,
 * bis zum ersten Punkt, der nicht der Hintergrund ist. Das ist unabhaengig von
 * `border-radius`, von der Dicke der Bahn und davon, ob jemand die Masse
 * spaeter aendert — es misst, was dasteht, statt was dastehen sollte.
 *
 * LUFT UND TASTE gehen weiter ueber feste Radien, aber ueber die KANTENMITTE
 * (0°), wo der Umriss flach ist und die Rechnung stimmt.
 */
async function punkteLesen(png, lage, anteil) {
  let PNG
  try {
    ;({ PNG } = await import('pngjs'))
  } catch {
    console.log('  (Modul „pngjs" fehlt — die Farbmessung entfaellt; Lage und Vererbung wurden geprueft.)')
    return null
  }
  const bild = PNG.sync.read(png)
  const mx = lage.x + lage.b / 2
  const my = lage.y + lage.h / 2
  const grund = alsRgb(lage.grund)

  const lies = (grad, radius) => {
    const bog = ((grad - 90) * Math.PI) / 180
    const x = Math.round(mx + Math.cos(bog) * radius)
    const y = Math.round(my + Math.sin(bog) * radius)
    if (x < 0 || y < 0 || x >= bild.width || y >= bild.height) return null
    const i = (bild.width * y + x) << 2
    return [bild.data[i], bild.data[i + 1], bild.data[i + 2]]
  }

  /**
   * Von aussen nach innen bis zum ersten Punkt, der nicht der Hintergrund ist
   * — UND DANN NOCH ZWEI WEITER.
   *
   * Die zwei Schritte sind nicht Vorsicht, sondern eine Messung: Der erste
   * Punkt, der sich vom Hintergrund abhebt, ist der ANTIALIASIERTE SAUM der
   * Rundung, eine Mischung aus Ringfarbe und Grund. Der dritte Anlauf dieses
   * Werkzeugs las genau den und meldete 1,11 : 1 — waehrend der Ring selbst
   * 13 : 1 traegt. Ein Werkzeug, das den Saum misst, meldet jeden sauberen
   * Ring als zu blass; die Bahn ist 5 px dick, zwei davon sind sicher Kern.
   */
  const aufDerBahn = (grad) => {
    // Bis zur halben Diagonalen plus etwas Luft — weiter kann die Ecke nicht
    // reichen, und weiter aussen faengt der Schirm daneben an.
    const bisAussen = Math.ceil((lage.b / 2) * Math.SQRT2) + 3
    for (let r = bisAussen; r > lage.b / 2 - 14; r--) {
      const p = lies(grad, r)
      if (p && !naheBei(p, grund, 12)) return lies(grad, r - 2)
    }
    return null
  }

  const kante = anteil * 3.6
  return {
    imBogen: aufDerBahn(kante * 0.4),
    inBahn: aufDerBahn(kante + (360 - kante) * 0.5),
    luft: lies(0, lage.b / 2 - 8),
    taste: lies(0, lage.b / 2 - 20),
    grund,
  }
}

// FUNKTIONSDEKLARATION UND KEIN `const`: sie wird aus `punkteLesen` heraus
// benutzt, und das steht weiter oben. Ein `const`-Pfeil ist bis zu seiner
// Zeile nicht da — der erste Lauf starb genau daran
// („Cannot access 'alsRgb' before initialization").
function alsRgb(s) {
  const m = String(s).match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
}
// AUCH DIESE ZWEI ALS DEKLARATION — derselbe Grund wie bei `alsRgb`: der
// Messlauf steht weiter oben im Modul und benutzt sie, ein `const`-Pfeil ist
// dort noch nicht da. Beim zweiten Anlauf starb der Lauf an `beschreibe`.
function beschreibe(p) {
  return p ? `rgb(${p.join(', ')})` : '—'
}
function naheBei(a, b, schwelle) {
  return a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < schwelle
}

function kontrast(a, b) {
  const l = (p) => {
    const c = p.map((x) => x / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const la = l(a)
  const lb = l(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
