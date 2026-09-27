#!/usr/bin/env node
/**
 * JEDE PAARUNG AUF JEDER SEITE IN ACHTZEHN STAENDEN — an den PUNKTEN gemessen.
 *
 * ══ WARUM ES DIESES WERKZEUG GIBT, OBWOHL ES SCHON ZWEI ANDERE GIBT ════════
 *
 * tools/farbsaetze-messen.mjs rechnet zweihundert Kontrastwerte aus den zehn
 * Paletten aus. tools/farbsatz-am-schirm.mjs prueft, dass diese zehn Werte am
 * `<html>` wirklich ankommen. BEIDE REDEN UEBER DIE ZEHN VARIABLEN.
 *
 * Der Schirm zeigt aber nicht Variablen, sondern Punkte. Und dazwischen liegen
 * drei Dinge, die keine Palette kennt:
 *
 *   1. DECKKRAFT IST NICHT LEUCHTDICHTE-TREU. Die Paletten sind so
 *      gerechnet, dass jede Farbe die WCAG-Leuchtdichte ihrer Vorlage behaelt
 *      — daraus FOLGT, dass jeder Kontrast zweier PALETTENFARBEN gleich
 *      bleibt. Fuer eine Farbe mit Alpha gilt das NICHT: `rgba(x, .75)` wird
 *      Kanal fuer Kanal in sRGB gemischt, und zwei Gruende mit gleicher
 *      Leuchtdichte, aber anderem Farbton, ergeben danach VERSCHIEDENE
 *      Leuchtdichten. Genau hier kann ein neuer Satz kaputtmachen, was heil
 *      war, ohne dass eine einzige Palettenzahl falsch waere.
 *
 *   2. FESTE FARBEN, DIE SICH NICHT MITDREHEN. Wer irgendwo eine Zahl
 *      hinschreibt statt eine Variable zu nehmen, faellt im Bestand nicht auf
 *      — dort ist die Zahl ja richtig. Er faellt erst auf, wenn daneben eine
 *      Palette steht, die etwas anderes sagt.
 *
 *   3. WAS DAVOR LIEGT. Ein `::before` mit `inset` und Hintergrund, ein
 *      Verlauf, ein Cover. Keine Regel im Stilblatt sagt, welche Farbe am Ende
 *      unter einem Buchstaben liegt.
 *
 * ══ DESHALB WIRD NICHT GERECHNET, SONDERN NACHGESEHEN ══════════════════════
 *
 * Der Grund einer Schrift wird NICHT aus dem Stilblatt hergeleitet, sondern
 * aus dem SCHIRMBILD: `Page.captureScreenshot`, das Bild zurueck in die Seite
 * auf ein Canvas, `getImageData`, und dann der HAEUFIGSTE Punkt im Rechteck
 * des Elements. Buchstaben sind eine Minderheit der Punkte in ihrem eigenen
 * Kasten; der haeufigste Punkt IST der Grund — samt jedem `::before`, jedem
 * Verlauf und jedem Cover, das darunter liegt.
 *
 * Die Schriftfarbe kommt aus `getComputedStyle`, weil sie dort exakt steht
 * (ein Buchstabenpunkt ist kantengeglaettet und traegt deshalb einen Wert
 * dazwischen), und wird mit ihrem Alpha und der aufgesammelten Deckkraft
 * ihrer Vorfahren UEBER den gemessenen Grund gerechnet.
 *
 * WO DER GRUND NICHT EINFARBIG IST (Cover, Verlauf), sagt der haeufigste Punkt
 * wenig. Dann wird zusaetzlich der SCHLIMMSTE Punkt gesucht — der, gegen den
 * die Schrift am wenigsten Kontrast hat. Das ist die Frage „verschwindet der
 * Titel vor einem roten Cover", und sie hat keine andere Antwort.
 *
 * ══ ZWEI URTEILE, UND DAS ZWEITE IST DAS SCHAERFERE ════════════════════════
 *
 *   MARKE   4,5 : 1 fuer Text, 3 : 1 fuer grosse Schrift (ab 18,66 px fett
 *           bzw. 24 px) und fuer Zeichen ohne Text (WCAG 2.1, 1.4.3/1.4.11).
 *   BESTAND Dieselbe Stelle im Satz „Creme", im selben Stand (hell/dunkel).
 *           `--muted` traegt hell 3,41 : 1 und ist eine bekannte
 *           Hausschwaeche; sie darf bleiben, aber sie darf sich NICHT
 *           VERMEHREN. Was gegenueber Creme faellt, ist ein Befund, auch wenn
 *           es die Marke noch haelt.
 *
 * ══ WAS ES NICHT MISST ═════════════════════════════════════════════════════
 *   * Nur was SICHTBAR im Sichtfeld steht. Was gescrollt werden muesste,
 *     steht nicht im Bild und wird uebersprungen (und gezaehlt).
 *   * Keine Bewegung: gemessen wird ein stehendes Bild.
 *   * Keine Box. Nur die eigene Vorschau und ein eigener Browser.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/farbsatz-jede-paarung.mjs --ziel http://127.0.0.1:9721/neu/
 *   node tools/farbsatz-jede-paarung.mjs --ziel … --bilder /tmp/farbe
 *   node tools/farbsatz-jede-paarung.mjs --ziel … --lage regal,mp
 *   node tools/farbsatz-jede-paarung.mjs --ziel … --knapp
 * ENDE 1, wenn eine Paarung gegenueber Creme FAELLT oder neu unter die Marke
 * rutscht. Ende 0 sonst.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SAETZE as FARBSAETZE } from './farbsaetze-bauen.mjs'
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = typeof opt('ziel', null) === 'string' ? opt('ziel') : argv.find((a) => a.startsWith('http')) || null
const BILDER = typeof opt('bilder', null) === 'string' ? opt('bilder') : null
const KNAPP = argv.includes('--knapp')
/* `--roh <datei>` legt JEDE Messung als JSON ab. DER GRUND IST NICHT
   Bequemlichkeit: ein voller Lauf dauert eine knappe Stunde, und wer danach
   merkt, dass die SCHWELLE des Urteils falsch war, muesste ihn wiederholen.
   Mit der Rohdatei laesst sich neu urteilen, ohne neu zu messen. */
const ROH = typeof opt('roh', null) === 'string' ? opt('roh') : null
const NUR = typeof opt('lage', null) === 'string' ? opt('lage').split(',') : null
/* `--satz` teilt einen Lauf auf mehrere Prozesse auf. CREME MUSS IMMER DABEI
   SEIN: es ist der Massstab, gegen den verglichen wird, und ein Prozess ohne
   ihn haette nichts, woran er misst. */
const NUR_SATZ = typeof opt('satz', null) === 'string' ? [...new Set(['creme', ...opt('satz').split(',')])] : null

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── DIE STAENDE ───────────────────────────────────────────────────────────
 * JEDER Farbsatz, hell und dunkel. DIE LISTE WIRD NICHT ABGESCHRIEBEN,
 * sondern aus `SAETZE` in tools/farbsaetze-bauen.mjs geholt — dort steht sie
 * ohnehin, und eine zweite Abschrift lief am 08.08.2026 schon einmal
 * zurueck: Das Werkzeug mass fuenf Saetze weiter, als es neun gab, und
 * meldete dabei GRUEN. Ein Pruefer, der die Haelfte nicht ansieht und
 * trotzdem gruen sagt, ist schlimmer als keiner.
 *
 * `creme` TRAEGT KEIN ATTRIBUT — so steht es auch in app.js
 * (`FARB_VORGABE`), und ein `data-farbe='creme'` waere ein anderer Wahler
 * als die Vorgabe. */
const SAETZE = FARBSAETZE.map((x) => x.id)
const LICHTER = ['hell', 'dunkel']

/**
 * WAS AM SCHIRM STEHT — geerntet, nicht hergeleitet.
 *
 * Laeuft IM Browser. Bekommt das Schirmbild als Datenadresse und gibt fuer
 * jedes sichtbare Stueck Schrift und jedes Zeichen eine Zeile zurueck.
 *
 * KEINE GEGENHAKEN in dieser Funktion — sie wird als Quelltext an den Browser
 * gereicht.
 */
async function ernten(bildDatenAdresse) {
  const B = 800
  const H = 480

  /* Das Schirmbild in Punkte aufloesen — der Browser macht das Auspacken. */
  const bild = new Image()
  await new Promise((gut, schlecht) => {
    bild.onload = gut
    bild.onerror = schlecht
    bild.src = bildDatenAdresse
  })
  const leinwand = document.createElement('canvas')
  leinwand.width = B
  leinwand.height = H
  const stift = leinwand.getContext('2d', { willReadFrequently: true })
  stift.drawImage(bild, 0, 0)
  const punkte = stift.getImageData(0, 0, B, H).data

  const lin = (c) => {
    const x = c / 255
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  const leucht = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const verhaeltnis = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)

  /* Was der Browser als Farbe zurueckgibt, in vier Zahlen. Zwei Formen:
     'rgb(6, 47, 75)' und 'rgba(255, 247, 236, 0.75)'; neuere Browser schreiben
     auch 'rgb(6 47 75 / 0.75)'. Alle drei bestehen nur aus Zahlen. */
  const zahlen = (s) => {
    const m = String(s).match(/[\d.]+/g)
    if (!m || m.length < 3) return null
    const n = m.map(Number)
    return [n[0], n[1], n[2], m.length > 3 ? n[3] : 1]
  }
  const ueber = (v, g) => {
    const a = v[3]
    if (a >= 0.999) return [v[0], v[1], v[2], 1]
    return [v[0] * a + g[0] * (1 - a), v[1] * a + g[1] * (1 - a), v[2] * a + g[2] * (1 - a), 1]
  }
  const hex = (v) =>
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(v[i]).toString(16).padStart(2, '0').toUpperCase())
      .join('')

  /* Die aufgesammelte Deckkraft: jede `opacity` eines Vorfahren wirkt auf das
     Element mit. Sie hebt sich NICHT heraus, weil der Grund aus dem Bild kommt
     — das Bild zeigt den Grund bereits so, wie er nach allen Deckkraeften
     aussieht, die Schrift aber noch nicht. */
  const deckkraft = (el) => {
    let d = 1
    let n = el
    while (n && n.nodeType === 1) {
      const o = parseFloat(getComputedStyle(n).opacity)
      if (!Number.isNaN(o)) d *= o
      n = n.parentElement
    }
    return d
  }

  /* Ein Weg, der dasselbe Element im naechsten Stand wiederfindet. Die zehn
     Staende zeichnen denselben Baum; nur die Farben sind andere. */
  const weg = (el) => {
    const teile = []
    let n = el
    let tiefe = 0
    while (n && n.nodeType === 1 && tiefe < 8) {
      if (n.id) {
        teile.unshift('#' + n.id)
        break
      }
      const kl = [...n.classList].slice(0, 2).join('.')
      let i = 1
      let v = n.previousElementSibling
      while (v) {
        if (v.tagName === n.tagName) i++
        v = v.previousElementSibling
      }
      teile.unshift(n.tagName.toLowerCase() + (kl ? '.' + kl : '') + ':' + i)
      n = n.parentElement
      tiefe++
    }
    return teile.join('>')
  }

  /**
   * LIEGT DAS ELEMENT WIRKLICH OBEN — oder nur im Baum?
   *
   * ══ DER FEHLER, DEN DAS HIER ABFAENGT ═════════════════════════════════════
   *
   * `display`, `visibility` und die Groesse sagen NICHTS darueber, ob man ein
   * Element sieht. Das Regal steht auch dann noch im Baum, wenn der grosse
   * Player, die Albumansicht oder das Admin-Menue darueberliegen — mit
   * derselben Groesse, an derselben Stelle, voll „sichtbar".
   *
   * GEMESSEN UND FALSCH GEMELDET (07.08.2026): Ein Lauf ueber alle zehn
   * Staende meldete 41 Paarungen als „NEU unter der Marke". JEDE EINZELNE war
   * ein verdecktes Element. Der Interpretenname „Kiddinx" wurde gegen
   * #04042F gehalten — das ist das Cover der Albumansicht, die davorlag.
   * Die Ueberschrift „Interpreten" gegen #FF6B57, den Akzent eines Knopfes im
   * Admin-Menue. Zahlen von 1,02 : 1, und keine davon stand je am Schirm.
   *
   * DIE MESSUNG WAR DER GRUND: Der Grund kommt aus dem SCHIRMBILD, und im
   * Schirmbild steht an dieser Stelle das, was OBEN liegt. Die Schriftfarbe
   * kam aber weiter aus `getComputedStyle` des verdeckten Elements. So
   * verglich der Lauf eine Farbe, die niemand sieht, mit einem Grund, der zu
   * etwas anderem gehoert — und je bunter der neue Satz, desto groesser der
   * erfundene Unterschied. EIN WERKZEUG, DAS SO MELDET, IST SCHLIMMER ALS
   * KEINES: es haette vierzig Stunden Suche nach Fehlern ausgeloest, die es
   * nicht gibt.
   *
   * ══ WIE GEPRUEFT WIRD ═════════════════════════════════════════════════════
   * `elementFromPoint` an fuenf Stellen des Rechtecks. Zurueckkommen darf das
   * Element selbst, ein Kind davon (der Buchstabe liegt in einem Kasten) oder
   * ein VORFAHR — letzteres, weil ein Element mit `pointer-events: none` den
   * Treffer nach oben durchreicht. Alles andere liegt davor.
   * Es muessen MEHR ALS DIE HAELFTE der Stellen uns gehoeren: ein Rand, der
   * unter einem Nachbarn liegt, ist normal; eine Flaeche, die zur Haelfte
   * verdeckt ist, misst nicht mehr das, was sie zu messen glaubt.
   */
  const liegtOben = (el, k) => {
    const stellen = [
      [(k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2],
      [k.x0 + (k.x1 - k.x0) * 0.2, (k.y0 + k.y1) / 2],
      [k.x0 + (k.x1 - k.x0) * 0.8, (k.y0 + k.y1) / 2],
      [(k.x0 + k.x1) / 2, k.y0 + (k.y1 - k.y0) * 0.25],
      [(k.x0 + k.x1) / 2, k.y0 + (k.y1 - k.y0) * 0.75],
    ]
    let unser = 0
    for (const [x, y] of stellen) {
      const t = document.elementFromPoint(x, y)
      if (!t) continue
      if (t === el || el.contains(t) || t.contains(el)) unser++
    }
    return unser * 2 > stellen.length
  }

  const rechteck = (el) => {
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') return null
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null
    const x0 = Math.max(0, Math.ceil(r.left))
    const y0 = Math.max(0, Math.ceil(r.top))
    const x1 = Math.min(B, Math.floor(r.right))
    const y1 = Math.min(H, Math.floor(r.bottom))
    if (x1 - x0 < 2 || y1 - y0 < 2) return null
    return { x0, y0, x1, y1 }
  }

  /**
   * DER GRUND UNTER EINEM RECHTECK — der haeufigste Punkt.
   *
   * Buchstaben sind die Minderheit in ihrem eigenen Kasten; der haeufigste
   * Punkt ist deshalb der Grund. Beim zweiten Durchgang wird ausserdem alles
   * aussortiert, was auf der STRECKE zwischen Schrift- und Grundfarbe liegt —
   * das sind die kantengeglaetteten Raender der Buchstaben.
   *
   * ══ WARUM DIE STRECKE UND NICHT EIN ABSTAND ZUR SCHRIFTFARBE ════════════
   * Ein Rand zwischen weisser Schrift und fast weissem Grund ist von BEIDEN
   * weit genug weg, um jeden Abstandstest zu ueberleben — und wurde dann als
   * „schlimmster Grund #F0F0F1" gemeldet. Gemessen war damit die
   * Kantenglaettung und nicht der Schirm. Ein Mischpunkt liegt aber IMMER auf
   * der Verbindungslinie der beiden Farben; genau das wird geprueft.
   */
  /**
   * IST DIESER PUNKT EIN BUCHSTABE ODER SEIN GEGLAETTETER RAND?
   *
   * `a` ist die Schriftfarbe, `e` der grob gemessene Grund. Ein Mischpunkt der
   * Kantenglaettung liegt auf der Verbindungslinie der beiden.
   *
   * ══ DIE ZEILE, DIE HIER GEFEHLT HAT (t < BIS_ZUM_GRUND) ══════════════════
   *
   * DER GRUND SELBST IST DAS ENDE DIESER STRECKE. Ohne die Bedingung an `t`
   * wurde er als „Buchstabe" aussortiert — und zwar JEDER Punkt einer
   * einfarbigen Flaeche. Uebrig blieb nichts, `grundVon` gab null zurueck, und
   * das Element verschwand still aus der Messung.
   *
   * GEMESSEN, WIE TEUER DAS WAR: Ein voller Lauf ueber sechs Staende zaehlte
   * danach noch 12 Paarungen je Schirm statt 41. Was uebrig blieb, waren
   * ausgerechnet die Stellen mit BUNTEM Grund — dort liegen die Punkte nicht
   * auf der Strecke. Der Lauf meldete also fast nur noch Cover und Bilder und
   * behauptete dabei, alles gemessen zu haben. Ein Werkzeug, das die Haelfte
   * seiner Fragen stillschweigend nicht stellt, ist gefaehrlicher als eines,
   * das gar nicht laeuft.
   *
   * `t` = 0 ist die Schriftfarbe, `t` = 1 der Grund. Aussortiert wird nur, was
   * DEUTLICH zur Schrift hin liegt.
   */
  const BIS_ZUM_GRUND = 0.85
  const aufStrecke = (p, a, e) => {
    let oben = 0
    let unten = 0
    for (let i = 0; i < 3; i++) {
      const d = e[i] - a[i]
      oben += (p[i] - a[i]) * d
      unten += d * d
    }
    const t = unten < 1 ? 0 : Math.max(0, Math.min(1, oben / unten))
    if (t >= BIS_ZUM_GRUND) return false
    let ab = 0
    for (let i = 0; i < 3; i++) {
      const q = a[i] + t * (e[i] - a[i])
      ab += (p[i] - q) * (p[i] - q)
    }
    return Math.sqrt(ab) < 16
  }

  const grundVon = (k, schriftPunkt, groberGrund) => {
    const zaehler = new Map()
    /* Fuer den schlimmsten Grund wird auf 4 Bit je Kanal gerastert: zwei
       Punkte eines Covers, die sich um einen Zahlenwert unterscheiden, sind
       derselbe Grund. Und nur ein Haeufchen ab 2 % zaehlt — ein einzelner
       Punkt ist kein Grund, auf dem ein Buchstabe steht. */
    const grob = new Map()
    let gesamt = 0
    for (let y = k.y0; y < k.y1; y++) {
      for (let x = k.x0; x < k.x1; x++) {
        const i = (y * B + x) * 4
        const r = punkte[i]
        const g = punkte[i + 1]
        const b = punkte[i + 2]
        if (schriftPunkt && groberGrund && aufStrecke([r, g, b], schriftPunkt, groberGrund)) continue
        gesamt++
        const s = (r << 16) | (g << 8) | b
        zaehler.set(s, (zaehler.get(s) || 0) + 1)
        const gs = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
        const e = grob.get(gs)
        if (e) {
          e.n++
          e.r += r
          e.g += g
          e.b += b
        } else grob.set(gs, { n: 1, r, g, b })
      }
    }
    if (!gesamt) return null
    let best = 0
    let bestN = 0
    for (const [s, n] of zaehler) {
      if (n > bestN) {
        bestN = n
        best = s
      }
    }
    let schlimmstesVerh = null
    let schlimmsterPunkt = null
    if (schriftPunkt) {
      const lSchrift = leucht(schriftPunkt[0], schriftPunkt[1], schriftPunkt[2])
      const marke = Math.max(4, gesamt * 0.02)
      for (const e of grob.values()) {
        if (e.n < marke) continue
        const p = [e.r / e.n, e.g / e.n, e.b / e.n, 1]
        const v = verhaeltnis(lSchrift, leucht(p[0], p[1], p[2]))
        if (schlimmstesVerh === null || v < schlimmstesVerh) {
          schlimmstesVerh = v
          schlimmsterPunkt = p
        }
      }
    }
    return {
      grund: [(best >> 16) & 255, (best >> 8) & 255, best & 255, 1],
      anteil: bestN / gesamt,
      schlimmstesVerh,
      schlimmsterPunkt,
    }
  }

  /** Traegt das Element selbst sichtbaren Text (nicht nur seine Kinder)? */
  const eigenerText = (el) => {
    for (const k of el.childNodes) {
      if (k.nodeType === 3 && k.textContent.trim().length) return k.textContent.trim()
    }
    return null
  }

  const ergebnis = []
  const uebersprungen = { ausserhalb: 0, leer: 0, verdeckt: 0 }

  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el)
    const d = deckkraft(el)
    if (d < 0.05) continue

    const text = eigenerText(el)
    const istZeichen = el.tagName.toLowerCase() === 'svg'
    if (!text && !istZeichen) continue

    const roher = rechteck(el)
    if (!roher) {
      uebersprungen.ausserhalb++
      continue
    }
    if (!liegtOben(el, roher)) {
      uebersprungen.verdeckt++
      continue
    }
    const k = roher

    /* Die Vordergrundfarbe. Bei einem Zeichen ist es `currentColor` — das
       steht in `color` desselben Elements, denn `color` erbt. */
    const vFarbe = zahlen(s.color)
    if (!vFarbe) continue
    const vAlpha = vFarbe[3] * d

    /* Ohne Grund gerechnet: erst der Grund aus dem Bild, dann die Schrift
       darauf. Die Schriftfarbe zum Aussortieren der Buchstabenpunkte ist die
       ueber einem groben Grund gerechnete — dafuer reicht der Mittelwert des
       Rechtecks als erster Anlauf. */
    const roh = grundVon(k, null, null)
    if (!roh) {
      uebersprungen.leer++
      continue
    }
    const ersterVordergrund = ueber([vFarbe[0], vFarbe[1], vFarbe[2], vAlpha], roh.grund)
    const genau = grundVon(k, ersterVordergrund, roh.grund)
    if (!genau) {
      uebersprungen.leer++
      continue
    }
    const vg = ueber([vFarbe[0], vFarbe[1], vFarbe[2], vAlpha], genau.grund)
    const lVg = leucht(vg[0], vg[1], vg[2])
    const lGrund = leucht(genau.grund[0], genau.grund[1], genau.grund[2])

    const groesse = parseFloat(s.fontSize)
    const fett = parseInt(s.fontWeight, 10) >= 700
    const gross = istZeichen || (fett ? groesse >= 18.66 : groesse >= 24)
    const marke = gross ? 3 : 4.5

    ergebnis.push({
      weg: weg(el),
      art: istZeichen ? 'zeichen' : 'text',
      text: istZeichen ? (el.parentElement && el.parentElement.getAttribute('aria-label')) || '' : text.slice(0, 34),
      groesse: Math.round(groesse * 10) / 10,
      gewicht: parseInt(s.fontWeight, 10) || 400,
      marke,
      vordergrund: hex(vg),
      grund: hex(genau.grund),
      anteil: Math.round(genau.anteil * 100) / 100,
      verh: Math.round(verhaeltnis(lVg, lGrund) * 100) / 100,
      schlimmst: genau.schlimmstesVerh === null ? null : Math.round(genau.schlimmstesVerh * 100) / 100,
      schlimmsterGrund: genau.schlimmsterPunkt ? hex(genau.schlimmsterPunkt) : null,
    })
  }
  return { ergebnis, uebersprungen }
}

/* ── DIE LAGEN — jede Seite der Oberflaeche, einmal ────────────────────────
 * `stand` sind Zustaende der Vorschau, `tun` ist der Weg dorthin. Die
 * Reihenfolge ist die des Bedienens: erst das Regal, dann was daraus folgt,
 * dann das Admin-Menue mit seinen vier Gruppen und allen Unterseiten. */
const LAGEN = [
  { id: 'regal', wort: 'Kinderregal', stand: ['voll', 'spielt'] },
  { id: 'regal-leer', wort: 'Regal ohne Inhalt', stand: ['leer', 'still'] },
  { id: 'regal-kaputt', wort: 'Regal, Abruf gescheitert', stand: ['kaputt', 'still'] },
  { id: 'raster', wort: 'Album-Raster', stand: ['voll', 'spielt'], tun: 'erste-kachel' },
  { id: 'leute', wort: 'Interpreten', stand: ['voll', 'spielt'], tun: 'interpreten' },
  { id: 'interpret', wort: 'Interpret', stand: ['voll', 'spielt'], tun: 'erster-interpret' },
  { id: 'mp', wort: 'Mini-Player', stand: ['voll', 'spielt'] },
  { id: 'mp-pause', wort: 'Mini-Player, angehalten', stand: ['voll', 'pause'] },
  { id: 'laut', wort: 'Lautstaerke-Fenster', stand: ['voll', 'spielt'], tun: 'laut-auf' },
  { id: 'gross', wort: 'grosser Player', stand: ['voll', 'spielt'], tun: 'gross-auf' },
  { id: 'album-gross', wort: 'Cover-Vollbild', stand: ['voll', 'spielt'], tun: 'album-gross-auf' },
  { id: 'ich', wort: 'Wer hoert', stand: ['voll', 'spielt'], tun: 'ich-auf' },
  /* DAS KLEINSTE KISSEN. Es hat als einziges einen FORTSCHRITTSRING, und der
     ist ein `conic-gradient` mit einer fest hingeschriebenen Farbe
     (`rgba(255, 247, 236, .18)` — das Creme des Bestands). Ein Ring, der sich
     nicht mitdreht, faellt genau hier auf und nirgends sonst. */
  { id: 'mp-micro', wort: 'Micro-Kissen (nur Bild)', stand: ['voll', 'spielt'], tun: 'micro-an' },
  /* DIE BILDSCHIRMTASTATUR — die groesste zusammenhaengende Flaeche der
     Oberflaeche. Sie steht ueber allem, also misst nur ein Lauf, der sie
     wirklich aufmacht, was auf ihr steht. */
  { id: 'tastatur', wort: 'Bildschirmtastatur', stand: ['voll', 'spielt', 'sperre-aus'], tun: 'tastatur-auf' },
  /* DIE ARD-BAHN GEHOERT AUSDRUECKLICH DAZU. Sie ist die einzige Stelle der
     Oberflaeche, an der eine Schrift eine eigene DECKKRAFT bekommt
     (`.lane-kachel.stueck.passt-nicht .lane-titel { opacity: .7 }`) — und
     genau daran ist an diesem Baum schon einmal ein Titel unter die
     Lesbarkeitsmarke gerutscht (3,35 : 1). Eine Deckkraft rechnet Kanal fuer
     Kanal in sRGB; sie ist NICHT leuchtdichtetreu, und damit ist sie die
     Stelle, an der die gerechneten Paletten auseinandergehen KOENNEN. */
  { id: 'lane-ard', wort: 'ARD-Folgen (Bahn)', stand: ['voll', 'spielt', 'verlauf-ard'], tun: 'erste-weiter-kachel' },
  { id: 'tor-pin', wort: 'Admin-Tor (PIN)', stand: ['voll', 'still', 'sperre-pin'], tun: 'wappen' },
  { id: 'tor-rechnen', wort: 'Admin-Tor (Rechnen)', stand: ['voll', 'still', 'sperre-rechnen'], tun: 'wappen' },
  { id: 'admin-verbindung', wort: 'Admin · Verbindung', stand: ['voll', 'spielt', 'sperre-aus'], tun: 'gruppe:verbindung' },
  { id: 'admin-medien', wort: 'Admin · Medien', stand: ['voll', 'spielt', 'sperre-aus'], tun: 'gruppe:medien' },
  { id: 'admin-anzeige', wort: 'Admin · Darstellung', stand: ['voll', 'spielt', 'sperre-aus'], tun: 'gruppe:anzeige' },
  { id: 'admin-system', wort: 'Admin · System', stand: ['voll', 'spielt', 'sperre-aus'], tun: 'gruppe:system' },
]

/* Die Unterseiten. Jede haengt an ihrer Gruppe und wird ueber ihren Namen
   angetippt — wie ein Mensch. */
const UNTERSEITEN = [
  ['verbindung', 'WLAN', 'u-wlan'],
  ['verbindung', 'Bluetooth', 'u-bt'],
  ['verbindung', 'Funk an und aus', 'u-funk'],
  ['medien', 'Suchen und verwalten', 'u-medien'],
  ['medien', 'Dienste', 'u-dienste'],
  ['anzeige', 'Indikatoren', 'u-ind'],
  ['anzeige', 'Farbe und Form', 'u-farbe'],
  ['anzeige', 'Player', 'u-player'],
  ['anzeige', 'Verhalten', 'u-verhalten'],
  ['system', 'Info', 'u-info'],
  ['system', 'Akku', 'u-akku'],
  ['system', 'Sperre vor diesem Bereich', 'u-sperre'],
  ['system', 'Neu laden und neu starten', 'u-strom'],
  ['system', 'Benutzer', 'u-kinder'],
]
for (const [gruppe, name, id] of UNTERSEITEN) {
  LAGEN.push({
    id,
    wort: 'Admin · ' + name,
    stand: ['voll', 'spielt', 'sperre-aus'],
    tun: 'unterseite:' + gruppe + ':' + name,
  })
}

const ZIEL = MITGEGEBEN || 'http://127.0.0.1:8299/neu/'

console.log(`══ JEDE PAARUNG, JEDE SEITE, ${SAETZE.length * 2} STAENDE ═══════════════`)
console.log(`   Vorschau: ${ZIEL}`)

const geliehen = await vorschauLeihen(ZIEL).catch(() => null)
const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

/** Alle Messungen: `messungen[stand][lage][weg] = zeile`. */
const messungen = {}
/** Lagen, die nicht aufgingen — sie fehlen im Urteil und werden benannt. */
const nichtHergestellt = []
/** Was die Ernte je Schirm verworfen hat — Summe ueber alle Laeufe. */
const uebersprungenGesamt = { ausserhalb: 0, leer: 0, verdeckt: 0 }
let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  let nr = 0
  const offen = new Map()
  ws.on('message', (d) => {
    const m = JSON.parse(d)
    if (m.id && offen.has(m.id)) {
      offen.get(m.id)(m.result)
      offen.delete(m.id)
    }
  })
  const send = (methode, params = {}) =>
    new Promise((r) => {
      const id = ++nr
      offen.set(id, r)
      ws.send(JSON.stringify({ id, method: methode, params }))
    })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) =>
    (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(90)
  }

  /** Einen Knopf ueber seine Aufschrift antippen — wie ein Mensch. */
  const tippenName = async (name) => {
    const ok = await ev(
      '(() => { for (const z of document.querySelectorAll("#fach-zeilen .fach-zeile")) {' +
        ' const n = z.querySelector(".zeile-name");' +
        ' if (!n || n.textContent.trim() !== ' +
        JSON.stringify(name) +
        ') continue;' +
        ' const k = z.querySelector(".zeile-tat");' +
        ' if (k && !k.disabled) { k.click(); return true }' +
        ' if (z.tagName === "BUTTON") { z.click(); return true }' +
        ' z.click(); return true } return false })()',
    )
    await warte(600)
    return ok === true
  }

  const wege = {
    'erste-kachel': async () => {
      await ev('(() => { const k = document.querySelector(".kat-liste .kat"); if (k) k.click() })()')
      await warte(700)
    },
    interpreten: async () => {
      await ev(
        '(() => { const k = [...document.querySelectorAll(".kat-liste .kat")]' +
          '.find((x) => /nterpret|eute/.test(x.textContent)); if (k) k.click() })()',
      )
      await warte(700)
    },
    'erster-interpret': async () => {
      await ev(
        '(() => { const k = [...document.querySelectorAll(".kat-liste .kat")]' +
          '.find((x) => /nterpret|eute/.test(x.textContent)); if (k) k.click() })()',
      )
      await warte(700)
      await ev('(() => { const k = document.querySelector("#leute-reihe > *"); if (k) k.click() })()')
      await warte(800)
    },
    'laut-auf': async () => {
      await ev('(() => { const k = document.getElementById("mp-laut"); if (k) k.click() })()')
      await warte(500)
    },
    'gross-auf': async () => {
      await ev('(() => { const k = document.getElementById("mp-titel"); if (k) k.click() })()')
      await warte(800)
    },
    'album-gross-auf': async () => {
      await ev('(() => { const k = document.getElementById("mp-titel"); if (k) k.click() })()')
      await warte(800)
      await ev('(() => { const k = document.getElementById("gr-cover"); if (k) k.click() })()')
      await warte(800)
    },
    'erste-weiter-kachel': async () => {
      /* `verlauf-ard` holt die ARD-Zeile in der Reihe „Weiterhoeren" nach
         vorn; die erste Kachel ist dann die, hinter der die Bahn liegt. */
      await ev('(() => { const k = document.querySelector("#weiter-reihe .weiter-kachel"); if (k) k.click() })()')
      await warte(3200)
    },
    'micro-an': async () => {
      await adminAuf(ev, { warteMs: 1100, pruefen: false })
      await warte(300)
      await ev('(() => { const k = document.querySelector(\'#eltern-faecher [data-fach="anzeige"]\'); if (k) k.click() })()')
      await warte(600)
      await tippenName('Player')
      await warte(500)
      await tippenName('Kissen: nur das Bild')
      await warte(600)
      /* Zurueck bis zum Regal — das Kissen steht nur dort. */
      for (let i = 0; i < 4; i++) {
        await ev('(() => { const k = document.getElementById("zurueck"); if (k && !k.disabled) k.click() })()')
        await warte(360)
      }
      await warte(500)
    },
    'tastatur-auf': async () => {
      await adminAuf(ev, { warteMs: 1100, pruefen: false })
      await warte(300)
      await ev('(() => { const k = document.querySelector(\'#eltern-faecher [data-fach="verbindung"]\'); if (k) k.click() })()')
      await warte(600)
      await tippenName('WLAN')
      await warte(900)
      /* „Verbinden" an einem gesicherten Netz — DAS holt die Tastatur herauf.
         Ein Tipp auf die Zeile allein tut es nicht; das offene Netz und das
         schon verbundene tragen den Knopf gar nicht. */
      await ev(
        '(() => { const k = [...document.querySelectorAll("#fach-zeilen .zeile-tat")]' +
          '.find((x) => x.textContent.trim() === "Verbinden" && !x.disabled);' +
          ' if (k) { k.click(); return true } return false })()',
      )
      await warte(1300)
    },
    'ich-auf': async () => {
      await ev('(() => { const k = document.getElementById("ich"); if (k) k.click() })()')
      await warte(600)
    },
    wappen: async () => {
      await adminAuf(ev, { warteMs: 1100, pruefen: false })
      await warte(400)
    },
  }

  /** Eine Lage herstellen. Gibt zurueck, ob sie steht. */
  const lageHerstellen = async (lage) => {
    for (const s of lage.stand || []) await stand(s)
    await send('Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(1700)
    const t = lage.tun
    if (!t) return true
    if (wege[t]) {
      await wege[t]()
      return true
    }
    if (t.startsWith('gruppe:')) {
      await adminAuf(ev, { warteMs: 1100, pruefen: false })
      await warte(300)
      const g = t.slice(7)
      await ev(
        '(() => { const k = document.querySelector(' +
          JSON.stringify('#eltern-faecher [data-fach="' + g + '"]') +
          '); if (k) { k.click(); return true } return false })()',
      )
      await warte(600)
      return true
    }
    if (t.startsWith('unterseite:')) {
      const [, g, name] = t.split(':')
      await adminAuf(ev, { warteMs: 1100, pruefen: false })
      await warte(300)
      await ev(
        '(() => { const k = document.querySelector(' +
          JSON.stringify('#eltern-faecher [data-fach="' + g + '"]') +
          '); if (k) k.click() })()',
      )
      await warte(600)
      return await tippenName(name)
    }
    return true
  }

  const erntenJs = '(' + String(ernten) + ')(FOTO)'

  for (const satz of SAETZE) {
    if (NUR_SATZ && !NUR_SATZ.includes(satz)) continue
    for (const licht of LICHTER) {
      const standName = `${satz}-${licht}`
      messungen[standName] = {}
      process.stdout.write(`\n── ${standName} `)
      for (const lage of LAGEN) {
        if (NUR && !NUR.includes(lage.id)) continue
        /* EINE LAGE, DIE NICHT AUFGEHT, DARF NICHT DEN GANZEN LAUF KOSTEN.
           Gemessen am 07.08.2026: Ein Lauf ueber neun der damals zehn Staende starb
           in der zehnten Zeile daran, dass `#wappen` einmal nicht im Baum
           stand — eine andere Sitzung hatte app.js in genau dem Augenblick
           halbfertig auf der Platte liegen. Vierzig Minuten Messung waren weg,
           und zwar OHNE Ergebnis: der Bericht steht am Ende.
           Jetzt wird die Lage vermerkt und der Lauf geht weiter; was fehlt,
           steht unten unter „nicht hergestellt" und nicht als „alles gut". */
        let stehtDa = false
        let letzterFehler = null
        /* ZWEIMAL VERSUCHEN. Der Fehlschlag ist nicht immer derselbe: einmal
           steht `#wappen` nach vier Sekunden noch nicht im Baum, obwohl
           dieselbe Lage im Stand davor dreissigmal aufging. Ein zweiter
           Anlauf mit frisch geladener Seite raeumt das aus; bleibt es beim
           zweiten Mal stehen, ist es kein Zufall und gehoert in den Bericht. */
        for (let anlauf = 0; anlauf < 2 && !stehtDa; anlauf++) {
          try {
            await lageHerstellen(lage)
            stehtDa = true
          } catch (e) {
            letzterFehler = e
            await warte(800)
          }
        }
        if (!stehtDa) {
          nichtHergestellt.push(
            `${satz}-${licht} · ${lage.id}: ${String(letzterFehler?.message || '').split('\n')[0].slice(0, 90)}`,
          )
          process.stdout.write('x')
          continue
        }
        /* Farbsatz und Licht NACH dem Laden stellen — der Baum steht dann
           schon, und `farbeSetzen` bzw. der Umschalter greifen auf ihn. */
        await ev(
          '(() => { const w = document.documentElement;' +
            (satz === 'creme' ? ' w.removeAttribute("data-farbe");' : ` w.setAttribute("data-farbe", "${satz}");`) +
            (licht === 'dunkel' ? ' w.setAttribute("data-licht", "dunkel");' : ' w.removeAttribute("data-licht");') +
            ' return true })()',
        )
        await warte(320)
        const foto = await send('Page.captureScreenshot', { format: 'png' })
        if (!foto || !foto.data) continue
        if (BILDER) await writeFile(join(BILDER, `${standName}--${lage.id}.png`), Buffer.from(foto.data, 'base64'))
        const roh = await ev(erntenJs.replace('FOTO', JSON.stringify('data:image/png;base64,' + foto.data)))
        if (!roh || !roh.ergebnis) {
          process.stdout.write('!')
          continue
        }
        const tafel = {}
        for (const t of Object.keys(uebersprungenGesamt)) uebersprungenGesamt[t] += (roh.uebersprungen || {})[t] || 0
        for (const z of roh.ergebnis) tafel[z.weg + '|' + z.art] = z
        messungen[standName][lage.id] = tafel
        process.stdout.write('.')
      }
    }
  }
  console.log('')
} finally {
  if (ws) ws.close()
  if (browser) await browser.schliessen()
  if (geliehen) await geliehen.zurueckgeben().catch(() => null)
}

/* ══ DAS URTEIL ══════════════════════════════════════════════════════════ */

/**
 * WIE VIEL UNTERSCHIED NOCH KEINER IST — 0,15.
 *
 * HIER STAND 0,06, UND DAS WAR ZU SCHARF. Die Paletten halten die
 * WCAG-Leuchtdichte ihrer Vorlage auf sechs Stellen — aber sie muessen als
 * SECHSSTELLIGE HEX-ZAHL in der Datei stehen, und damit liegt jede Farbe auf
 * einem Raster von 1/255 je Kanal. Diese Quantisierung allein verschiebt ein
 * Kontrastverhaeltnis um bis zu rund einem Zehntel: `--ink` auf `--bg` traegt
 * bei Creme 13,09 und bei Gruen 13,01, ohne dass irgendetwas falsch waere.
 * Mit 0,06 meldete der Lauf genau diese Rundung als Befund.
 *
 * 0,15 LAESST DIE RUNDUNG DURCH UND FAENGT DIE SORTE, UM DIE ES GEHT: Was
 * durch eine Deckkraft ueber einem anders gefaerbten Grund wirklich abrutscht,
 * bewegt sich um Zehntel bis ganze Punkte, nicht um Hundertstel.
 */
const NACHSICHT = 0.15

/**
 * NUR EINFARBIGE GRUENDE WERDEN VERGLICHEN — 0,6.
 *
 * DER VERGLEICH GEGEN CREME SETZT VORAUS, DASS DIE MESSUNG WIEDERHOLBAR IST.
 * Bei einer Schrift auf einer Flaeche ist sie das: der haeufigste Punkt im
 * Rechteck ist die Flaeche, in jedem Stand derselbe.
 *
 * BEI EINER SCHRIFT AUF EINEM BILD IST SIE ES NICHT, und das hat prompt
 * Gespenster gemeldet: Das Zeichen `#ich > svg.ich-schatten` liegt auf dem
 * Maskottchen. Der haeufigste Punkt in seinem Rechteck war im Creme-Lauf
 * #EFE7DA und im Rosa-Lauf #8A55FB — das Lila des Kopfhoerers. Gemeldet wurde
 * „von 2,95 auf 1,21 gefallen"; in Wahrheit hatte sich keine Farbe geaendert,
 * sondern der Punkt, den der Zaehler zufaellig vorn sah.
 *
 * Wo der haeufigste Punkt weniger als 60 % traegt, ist der Grund ein Bild.
 * Solche Stellen gehoeren nicht in den Vergleich, sondern in den Abschnitt
 * „Schrift auf buntem Grund" — dort wird nicht verglichen, sondern der
 * schlimmste Grund gesucht, und das ist die Frage, die dort wirklich zaehlt.
 */
const EINFARBIG_AB = 0.6
const befunde = []
let gezaehlt = 0
let unterMarkeCreme = 0
/** Paarungen auf Bildgrund — gemessen, aber nicht gegen Creme vergleichbar. */
let nichtVergleichbar = 0

for (const satz of SAETZE) {
  for (const licht of LICHTER) {
    const standName = `${satz}-${licht}`
    const cremeName = `creme-${licht}`
    for (const lageId of Object.keys(messungen[standName] || {})) {
      const hier = messungen[standName][lageId]
      const dort = (messungen[cremeName] || {})[lageId] || {}
      for (const schluessel of Object.keys(hier)) {
        const z = hier[schluessel]
        gezaehlt++
        const v = dort[schluessel]
        const untenHier = z.verh < z.marke - 0.005
        const untenDort = v ? v.verh < v.marke - 0.005 : false
        if (satz === 'creme' && untenHier) unterMarkeCreme++
        if (satz === 'creme') continue
        if (!v) continue
        /* Siehe EINFARBIG_AB: auf einem Bild ist der gemessene Grund nicht
           wiederholbar, und ein Vergleich zweier nicht wiederholbarer Zahlen
           ist keine Messung. */
        if (z.anteil < EINFARBIG_AB || v.anteil < EINFARBIG_AB) {
          nichtVergleichbar++
          continue
        }
        const schlechter = v.verh - z.verh > NACHSICHT
        const neuUnten = untenHier && !untenDort
        if (!schlechter && !neuUnten) continue
        befunde.push({
          stand: standName,
          lage: lageId,
          weg: z.weg,
          art: z.art,
          text: z.text,
          groesse: z.groesse,
          marke: z.marke,
          hier: z.verh,
          creme: v.verh,
          farbeHier: `${z.vordergrund} auf ${z.grund}`,
          farbeCreme: `${v.vordergrund} auf ${v.grund}`,
          neuUnten,
          schlechter,
        })
      }
    }
  }
}

if (ROH) {
  await writeFile(ROH, JSON.stringify({ messungen, nichtHergestellt }, null, 1))
  console.log(`\n   Rohdaten: ${ROH}`)
}

befunde.sort((a, b) => a.hier - b.hier)

if (!KNAPP) {
  console.log('\n══ WAS GEGENUEBER CREME FAELLT ════════════════════════════════')
  if (!befunde.length) console.log('   nichts.')
  for (const b of befunde) {
    console.log(
      `  ${b.neuUnten ? 'UNTER MARKE' : 'schlechter '}  ${b.stand.padEnd(12)} ${b.lage.padEnd(17)} ` +
        `${b.hier.toFixed(2)} : 1  (Creme ${b.creme.toFixed(2)})  Marke ${b.marke}`,
    )
    console.log(`                  ${b.art} ${b.groesse}px  „${b.text}"  ${b.weg}`)
    console.log(`                  jetzt ${b.farbeHier}   —   Creme ${b.farbeCreme}`)
  }
}

/* Der bunte Grund: wo der haeufigste Punkt weniger als 60 % traegt, steht die
   Schrift auf einem Bild oder Verlauf. Dort zaehlt der schlimmste Punkt. */
const aufBild = []
for (const satz of SAETZE) {
  for (const licht of LICHTER) {
    const standName = `${satz}-${licht}`
    for (const lageId of Object.keys(messungen[standName] || {})) {
      for (const z of Object.values(messungen[standName][lageId])) {
        if (z.anteil >= 0.6) continue
        if (z.schlimmst === null || z.schlimmst >= z.marke) continue
        aufBild.push({ stand: standName, lage: lageId, ...z })
      }
    }
  }
}
if (!KNAPP && aufBild.length) {
  console.log('\n══ SCHRIFT AUF BUNTEM GRUND — der schlimmste Punkt ════════════')
  const gesehen = new Set()
  for (const z of aufBild.sort((a, b) => a.schlimmst - b.schlimmst)) {
    const k = z.lage + z.weg
    if (gesehen.has(k)) continue
    gesehen.add(k)
    console.log(
      `  ${z.stand.padEnd(12)} ${z.lage.padEnd(17)} schlimmster Punkt ${z.schlimmst.toFixed(2)} : 1 ` +
        `(Marke ${z.marke})  ${z.vordergrund} auf ${z.schlimmsterGrund}`,
    )
    console.log(`                  „${z.text}"  ${z.weg}  (einfarbiger Anteil ${Math.round(z.anteil * 100)} %)`)
  }
}

console.log('\n══ ZUSAMMEN ═══════════════════════════════════════════════════')
console.log(`   ${gezaehlt} Paarungen gemessen (alle Staende, alle Lagen)`)
console.log(`   unter der Marke schon bei Creme:  ${unterMarkeCreme}`)
console.log(`   auf Bildgrund, nicht vergleichbar: ${nichtVergleichbar}`)
console.log(
  `   verworfen: ${uebersprungenGesamt.verdeckt} verdeckt, ` +
    `${uebersprungenGesamt.ausserhalb} ausserhalb/unsichtbar, ${uebersprungenGesamt.leer} ohne messbaren Grund`,
)
console.log(`   NEU unter der Marke:              ${befunde.filter((b) => b.neuUnten).length}`)
console.log(`   schlechter als Creme:             ${befunde.length}`)
console.log(`   auf buntem Grund unter der Marke: ${aufBild.length}`)
if (nichtHergestellt.length) {
  console.log(`\n   NICHT HERGESTELLT — diese Lagen fehlen im Urteil (${nichtHergestellt.length}):`)
  for (const z of nichtHergestellt) console.log(`     ${z}`)
}

process.exit(befunde.length || nichtHergestellt.length ? 1 : 0)
