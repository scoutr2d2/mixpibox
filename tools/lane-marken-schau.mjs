#!/usr/bin/env node
/**
 * WAS IST AN EINER LANE-KACHEL ZU SEHEN — und was wird ABGESCHNITTEN?
 *
 * WOFUER: Gemeldet wurde „bei auswahl von alben sieht man keinen kompletten
 * auswahl umriss auch bei den titeln". Ein Umriss ist ein paar Bildpunkte
 * breit; ob er ganz dasteht, laesst sich am Quelltext nicht ablesen und am
 * Bildschirm schlecht abzaehlen. Hier wird gerechnet: Die Kachel wird
 * angetippt, dann werden ihr Rechteck, ihr Umriss (Breite + Abstand + Saum)
 * und das SICHTFENSTER der rollenden Reihe nebeneinandergelegt. Was ausserhalb
 * liegt, ist weg — `overflow-x: auto` beschneidet auf BEIDEN Achsen.
 *
 * Dazu die beiden anderen Fragen desselben Auftrags:
 *   * Bleibt die Auswahl stehen, waehrend ein Titel laeuft — und sieht
 *     „ausgewaehlt" anders aus als „laeuft gerade"?
 *   * Steht der BLAUE Weiterhoeren-Knopf genau dort, wo eine gemerkte Stelle
 *     liegt (Album und Titel), und nirgends sonst?
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs, nur
 * gelesen. Weder die Box noch Dateien werden angefasst.
 *
 * AUFRUF
 *     node tools/lane-marken-schau.mjs            # Tabelle
 *     node tools/lane-marken-schau.mjs --pruefen  # Ende 1 bei Abweichung
 *     node tools/lane-marken-schau.mjs --bild x.png   # dazu ein PNG
 *
 * DIE ERWARTUNG KOMMT AUS DER ATTRAPPE, NICHT AUS app.js: `/api/werke/<s>/alben`
 * sagt selbst, welches Album und welcher Titel ein `weiterAb` tragen. Wer die
 * Erwartung aus der Oberflaeche liest, prueft seine eigene Vermutung.
 *
 * DIE FALLE, DIE DIESE MESSUNG ERST MOEGLICH GEMACHT HAT: Die Vorschau lieferte
 * bis 02.08.2026 unter `/player/state` immer `item: null` und unter `/alben`
 * weder `uri` noch `weiterAb`. Gegen so eine Attrappe gemessen, gaebe es nie
 * einen blauen Knopf und nie einen laufenden Titel — und das saehe aus wie ein
 * Ergebnis [attrappe-luegt-durch-weglassen].
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { LICHT_STELLEN_JS } from './licht-weg.mjs'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
/** `--bild <datei>` legt am Ende ein PNG des gemessenen Zustands ab.
 *  WOZU: Zahlen sagen „nicht abgeschnitten", sie sagen nicht „sieht gut aus".
 *  Beides ist noetig, und das Bild spart den Umweg ueber einen Browser von Hand. */
const BILD = (() => {
  const i = process.argv.indexOf('--bild')
  return i >= 0 ? process.argv[i + 1] || 'lane-marken.png' : null
})()

/** Beruehrziel-Untergrenze: 800x480 sind 0,14 mm/px, 64 px sind 9 mm (ISO 9241-411). */
const ZIEL_PX = 64

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
// wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
// eine Vorschau, die jemand anders verstellt hat. Und der eigene Browser
// laeuft auf einem FREIEN Port mit eigenem Profil statt auf einer festen
// Nummer, die ein Ueberlebender eines harten Abbruchs noch halten koennte —
// `/json/list` liefert dann klaglos die Ziele des fremden.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
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

let fehler = 0
const melde = (zeile) => {
  fehler++
  console.error(`  FEHLER  ${zeile}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(34)} ${wert}`)

/** Die Playlist, die in der Vorschau eine Lane aufmacht UND eine Stelle hat. */
const PLAYLIST = 'Bibi Blocksberg'

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // Was die Seite dabei auf die Konsole schreibt. Auf der Box gibt es keine
  // Konsole; eine Ausnahme in `laneZeichnen` sieht dort genauso aus wie „die
  // Lane ist eben leer".
  const laut = []
  ws.on('message', (r) => {
    try {
      const x = JSON.parse(r)
      const t = x?.params?.type
      if (x?.method === 'Runtime.consoleAPICalled' && (t === 'error' || t === 'warning')) {
        laut.push(`${t}: ${(x.params.args || []).map((a) => a?.value ?? a?.description ?? '?').join(' ')}`)
      }
      if (x?.method === 'Runtime.exceptionThrown') {
        const d = x.params?.exceptionDetails
        laut.push(`Ausnahme: ${d?.exception?.description || d?.text || '?'}`)
      }
    } catch {
      /* kein JSON */
    }
  })

  // ── Die zweite Meinung: was SOLL blau sein? ────────────────────────────
  const werke = (await (await fetch(new URL('/api/werke', ZIEL))).json()).werke
  const werk = werke.find((w) => w.titel === PLAYLIST)
  if (!werk) throw new Error(`„${PLAYLIST}" steht nicht in /api/werke — Vorschau geaendert?`)
  const zerlegt = await (await fetch(new URL(`/api/werke/${encodeURIComponent(werk.schluessel)}/alben`, ZIEL))).json()
  const sollAlbum = zerlegt.alben.filter((a) => a.weiterAb).map((a) => a.titel)
  const sollTitel = zerlegt.alben.flatMap((a) => a.stuecke.filter((s) => s.weiterAb).map((s) => s.titel))
  if (!sollAlbum.length || !sollTitel.length) {
    melde('die Attrappe liefert gar kein `weiterAb` — ohne das prueft diese Messung das Nichts')
  }

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)

  /**
   * Wird der Umriss einer Kachel beschnitten?
   *
   * DER UMRISS IST NICHT NUR `outline`. Gerechnet wird die LUFT, die die
   * Markierung wirklich braucht: Umrissbreite + Abstand, und dazu der Saum aus
   * `box-shadow` (dessen Streuung steht nicht einzeln im errechneten Stil, sie
   * wird deshalb aus der Zeichenkette gelesen — die letzte Laengenangabe vor
   * der Farbe ist die Streuung).
   */
  const messFn = `
    function luftVon(el) {
      const s = getComputedStyle(el)
      // OHNE STIL KEIN UMRISS. Chrome meldet fuer outline-style none
      // trotzdem eine Breite (medium = 3px) — wer nur die Breite liest,
      // findet ueberall einen Umriss und misst anschliessend Phantome.
      const breite = s.outlineStyle === 'none' ? 0 : parseFloat(s.outlineWidth) || 0
      const abstand = breite ? parseFloat(s.outlineOffset) || 0 : 0
      // EIN SAUM IST EIN SCHATTEN OHNE VERSATZ. Die Kachelbilder tragen einen
      // Schlagschatten (0 5px 0 0) — wer jeden box-shadow als Markierung
      // zaehlt, findet an jeder Kachel einen Umriss und misst Phantome.
      let saum = 0
      const m = String(s.boxShadow || '').match(/(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px/)
      if (m && parseFloat(m[1]) === 0 && parseFloat(m[2]) === 0) saum = Math.abs(parseFloat(m[4]))
      return Math.max(breite + abstand, saum)
    }
    /**
     * Buendigkeit und Platzbedarf einer Reihe — gegen den ELTERN-Inhaltskasten.
     *
     * NICHT GEGEN DAS EIGENE RECHTECK: Die Reihe schafft sich den Platz fuer
     * den Umriss mit padding und nimmt ihn mit einem gleich grossen negativen
     * margin wieder zurueck. (KEINE Rueckstriche in diesem Kommentar — er
     * steht in einem Vorlagenliteral und beendete es sonst mitten im Satz.)
     * Wer die erste Kachel gegen die Kante
     * der Reihe misst, sieht dann eine Einrueckung, die es auf dem Schirm
     * nicht gibt — die Reihe selbst ist genauso weit nach aussen gerutscht.
     * Und die Hoehe, die eine Reihe WIRKLICH kostet, ist ihr Rechteck PLUS
     * ihre (hier negativen) Aussenabstaende.
     */
    function reihenMass(reihe) {
      const erste = reihe.firstElementChild
      const er = erste.getBoundingClientRect()
      const rr = reihe.getBoundingClientRect()
      const s = getComputedStyle(reihe)
      const e = reihe.parentElement
      const es = getComputedStyle(e)
      const ekasten = e.getBoundingClientRect()
      const links = ekasten.left + (parseFloat(es.borderLeftWidth) || 0) + (parseFloat(es.paddingLeft) || 0)
      return {
        ersteBuendig: Math.round(er.left - links),
        reiheHoehe: Math.round(rr.height + (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0)),
        breite: Math.round(er.width),
        hoehe: Math.round(er.height),
      }
    }
    function beschnitt(el, reihe) {
      // WER TRAEGT DEN UMRISS? Liegt er am BILD statt an der Kachel, ist das
      // Bild auch das Rechteck, das beschnitten wird — die Kachel misst dann
      // eine Luft von null und meldete faelschlich „nichts abgeschnitten".
      const traeger = luftVon(el) > 0 ? el : (el.querySelector('.lane-bild, .kachel-bild, .leute-bild, .weiter-bild') || el)
      const luft = luftVon(traeger)
      const k = traeger.getBoundingClientRect()
      const r = reihe.getBoundingClientRect()
      const s = getComputedStyle(reihe)
      const oben = r.top + (parseFloat(s.borderTopWidth) || 0)
      const unten = r.bottom - (parseFloat(s.borderBottomWidth) || 0)
      // NUR WAS AM UMRISS FEHLT, NICHT WAS GERADE WEGGEROLLT IST. Steht die
      // Kachel selbst schon halb ausserhalb, ist das kein Beschnitt des
      // Umrisses, sondern Rollstand — beides zu verwechseln meldet
      // dreistellige Fehlbetraege und schickt in die falsche Ecke.
      const gerollt = k.top < oben - 0.5 || k.bottom > unten + 0.5
      return {
        luft: Math.round(luft),
        gerollt,
        oben: gerollt ? 0 : Math.round(Math.max(0, oben - (k.top - luft))),
        unten: gerollt ? 0 : Math.round(Math.max(0, k.bottom + luft - unten)),
      }
    }`

  /**
   * Die Playlist im Raster antippen — das oeffnet die Album-Lane.
   *
   * ERST DAS REGAL: „Bibi Blocksberg" gehoert zum Interpreten „Kiddinx", und
   * der traegt zwei Werke — daraus baut die Startseite EIN Regal. Im Raster
   * steht deshalb nicht die Playlist, sondern „Kiddinx". Wer das uebersieht,
   * bekommt „keine Kachel gefunden" und haelt die Vorschau fuer kaputt.
   */
  const playlistTippen = async () => {
    const tippe = async (titel) =>
      ev(`(() => {
        const k = [...document.querySelectorAll('#raster > .kachel')]
          .find((e) => (e.querySelector('.kachel-titel')||{}).textContent === ${JSON.stringify(titel)})
        if (!k) return false
        k.click()
        return true
      })()`)
    if (!(await tippe(PLAYLIST))) {
      if (!(await tippe('Kiddinx'))) throw new Error(`weder „${PLAYLIST}" noch das Regal „Kiddinx" im Raster`)
      await warte(700)
      if (!(await tippe(PLAYLIST))) throw new Error(`keine Kachel „${PLAYLIST}" im Regal`)
    }
    await warte(1400)
  }

  console.log(`\nLANE-MARKEN  (${ZIEL}, Fenster 800x480)\n`)

  // ── 1. Die Album-Lane: Umriss der GEOEFFNETEN Raster-Kachel ────────────
  await playlistTippen()

  const rasterMass = await ev(`(() => {
    ${messFn}
    const k = document.querySelector('#raster > .kachel.auf')
    if (!k) return null
    const b = document.getElementById('buehne')
    return { ...beschnitt(k, b), hatUmriss: luftVon(k) > 0,
             amBild: luftVon(k.querySelector('.kachel-bild')) > 0 }
  })()`)
  if (!rasterMass) melde('nach dem Tippen ist keine Raster-Kachel markiert (.kachel.auf fehlt)')
  else {
    // SEIT DEM 08.08.2026 GEHOERT DER UMRISS ANS BILD (Betreiber: „beim
    // auswählen von album zu titeln wird nicht nur das albumcover umrahmt
    // sondern mit text" — die ganze Abwaegung steht in app.css am
    // Auswahl-Umriss: kein Rueckzieher, das Abschneiden von damals loeste
    // der Platz an der Reihe). Dieses Werkzeug trug noch die Erwartung vom
    // 02.08. (ganze Kachel) und meldete eine Woche lang die BESTELLTE Form
    // als Fehler. Jetzt ist das Bild das Soll — und die Ganz-Kachel-Form
    // der Befund, damit ein stiller Rueckbau nicht wieder unbemerkt bleibt.
    const rasterMarkiert = rasterMass.hatUmriss || rasterMass.amBild
    zeile('Raster-Kachel markiert', rasterMarkiert ? 'ja' : 'NEIN')
    zeile('… am BILD (Soll seit 08.08.)', rasterMass.amBild ? 'ja' : 'nein')
    zeile('… an der ganzen Kachel', rasterMass.hatUmriss ? 'ja — alte Form' : 'nein')
    zeile(
      '… abgeschnitten oben/unten',
      rasterMass.gerollt ? '(gerade weggerollt)' : `${rasterMass.oben} / ${rasterMass.unten} px`,
    )
    if (!rasterMarkiert) melde('die geoeffnete Raster-Kachel traegt gar keine Markierung')
    if (rasterMass.hatUmriss && !rasterMass.amBild)
      melde('der Umriss umfasst wieder die GANZE Kachel — seit dem 08.08. gehoert er ans BILD')
    if (rasterMass.oben || rasterMass.unten)
      melde(`Raster-Umriss beschnitten: ${rasterMass.oben} px oben, ${rasterMass.unten} px unten`)
  }

  // ── 1b. DIE OBERSTE MARKIERBARE KACHEL, ganz nach oben gerollt ─────────
  //
  // ZWEI DINGE AUF EINMAL, und beide gehen nur in dieser Stellung:
  //
  //   * Die Weiterhoeren-Reihe ganz oben rollt ebenfalls waagerecht und
  //     beschneidet damit auch senkrecht. Ihre Kachel bekommt beim Tippen
  //     einen 4-px-Ring (`.weiter-kachel.laeuft`) — der lag oben ausserhalb.
  //   * Die Buehne selbst rollt. Wieviel Luft ueber ihrem ersten Kind steht,
  //     entscheidet, ob eine Markierung in der ERSTEN Zeile ganz dasteht.
  //     (Das Raster ist NICHT das erste Kind: darueber liegen die
  //     Weiterhoeren- und die Interpreten-Reihe. Wer am Raster misst, misst
  //     eine Stelle, die ohnehin Platz hat.)
  const obenMass = await ev(`(() => {
    ${messFn}
    const b = document.getElementById('buehne')
    b.scrollTop = 0
    const reihe = document.getElementById('weiter-reihe')
    const k = reihe && reihe.firstElementChild
    const erstes = [...b.children].find((e) => !e.hidden && e.getBoundingClientRect().height > 0)
    const bs = getComputedStyle(b)
    const luftOben = erstes
      ? Math.round(erstes.getBoundingClientRect().top - b.getBoundingClientRect().top - (parseFloat(bs.borderTopWidth) || 0))
      : 0
    if (!k) return { luftOben, erstes: erstes ? erstes.id || erstes.className : '—' }
    k.classList.add('laeuft')
    const m = beschnitt(k, reihe)
    k.classList.remove('laeuft')
    return { ...m, luftOben, erstes: erstes ? erstes.id || erstes.className : '—' }
  })()`)
  if (obenMass) {
    zeile('Luft ueber dem ersten Buehnenkind', `${obenMass.luftOben} px (${obenMass.erstes})`)
    if (obenMass.luft !== undefined) {
      zeile('Weiterhoeren-Ring abgeschnitten', `${obenMass.luft} px Luft, ${obenMass.oben} / ${obenMass.unten} px weg`)
      if (obenMass.oben || obenMass.unten)
        melde(`Ring der Weiterhoeren-Kachel beschnitten: ${obenMass.oben} px oben, ${obenMass.unten} px unten`)
    }
    if (obenMass.luftOben < 7)
      melde(`nur ${obenMass.luftOben} px Luft ueber dem ersten Buehnenkind — ein Umriss braucht 7`)
  }

  // ── 2. Ein Album antippen: Umriss in der ROLLENDEN Album-Reihe ─────────
  const albumTippen = async (n = 0) => {
    await ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .lane > .lane-reihe > .lane-kachel')][${n}]
      if (k) k.click()
      return !!k
    })()`)
    await warte(900)
  }
  await albumTippen(0)

  const albumMass = await ev(`(() => {
    ${messFn}
    const k = document.querySelector('#raster > .lane > .lane-reihe > .lane-kachel.auf')
    if (!k) return null
    const reihe = k.parentElement
    return { ...beschnitt(k, reihe), ...reihenMass(reihe),
             amBild: luftVon(k.querySelector('.lane-bild')) > 0,
             hatUmriss: luftVon(k) > 0,
             rollt: reihe.scrollWidth > reihe.clientWidth + 1 }
  })()`)
  if (!albumMass) melde('kein aufgeklapptes Album markiert (.lane-kachel.auf fehlt)')
  else {
    zeile('Album-Kachel markiert', albumMass.hatUmriss || albumMass.amBild ? 'ja' : 'NEIN')
    zeile('… am BILD (Soll seit 08.08.)', albumMass.amBild ? 'ja' : 'nein')
    zeile('… an der ganzen Kachel', albumMass.hatUmriss ? 'ja — alte Form' : 'nein')
    zeile(
      '… abgeschnitten oben/unten',
      albumMass.gerollt ? '(gerade weggerollt)' : `${albumMass.oben} / ${albumMass.unten} px`,
    )
    zeile('erste Kachel buendig bei', `${albumMass.ersteBuendig} px`)
    zeile('Platzbedarf der Album-Reihe', `${albumMass.reiheHoehe} px${albumMass.rollt ? ' (rollt)' : ''}`)
    zeile('Beruehrziel Album-Kachel', `${albumMass.breite}x${albumMass.hoehe} px`)
    if (albumMass.oben || albumMass.unten)
      melde(`Album-Umriss beschnitten: ${albumMass.oben} px oben, ${albumMass.unten} px unten`)
    if (albumMass.ersteBuendig !== 0)
      melde(`die erste Album-Kachel steht ${albumMass.ersteBuendig} px eingerueckt statt buendig`)
    if (!albumMass.rollt) melde('die Album-Reihe rollt nicht mehr waagerecht — sechs Alben muessen erreichbar bleiben')
    if (albumMass.breite < ZIEL_PX || albumMass.hoehe < ZIEL_PX) melde(`Album-Kachel unter ${ZIEL_PX} px`)
  }

  // ── 3. Die Titel-Reihe darunter ────────────────────────────────────────
  const titelMass = await ev(`(() => {
    ${messFn}
    const reihe = document.querySelector('.lane-tief > .lane-reihe')
    if (!reihe) return null
    const erste = reihe.firstElementChild
    // Die Luft, die eine MARKIERTE Titelkachel braucht — dafuer wird eine
    // versuchsweise markiert und gleich wieder freigegeben. Sonst misst man
    // die Luft einer unmarkierten Kachel, also null.
    erste.classList.add('auf')
    const m = beschnitt(erste, reihe)
    const amBild = luftVon(erste.querySelector('.lane-bild')) > 0
    const hatUmriss = luftVon(erste) > 0
    erste.classList.remove('auf')
    return { ...m, ...reihenMass(reihe), amBild, hatUmriss }
  })()`)
  if (!titelMass) melde('keine Titel-Reihe aufgegangen (.lane-tief > .lane-reihe fehlt)')
  else {
    zeile('Titel-Kachel markierbar', titelMass.hatUmriss || titelMass.amBild ? 'ja' : 'NEIN')
    zeile('… am BILD (Soll seit 08.08.)', titelMass.amBild ? 'ja' : 'nein')
    zeile(
      '… abgeschnitten oben/unten',
      titelMass.gerollt ? '(gerade weggerollt)' : `${titelMass.oben} / ${titelMass.unten} px`,
    )
    zeile('erste Titel-Kachel buendig bei', `${titelMass.ersteBuendig} px`)
    zeile('Platzbedarf der Titel-Reihe', `${titelMass.reiheHoehe} px`)
    zeile('Beruehrziel Titel-Kachel', `${titelMass.breite}x${titelMass.hoehe} px`)
    if (titelMass.oben || titelMass.unten)
      melde(`Titel-Umriss beschnitten: ${titelMass.oben} px oben, ${titelMass.unten} px unten`)
    if (titelMass.ersteBuendig !== 0)
      melde(`die erste Titel-Kachel steht ${titelMass.ersteBuendig} px eingerueckt statt buendig`)
    if (titelMass.breite < ZIEL_PX || titelMass.hoehe < ZIEL_PX) melde(`Titel-Kachel unter ${ZIEL_PX} px`)
  }

  // ── 4. Der BLAUE Knopf — steht er genau dort, wo eine Stelle liegt? ────
  const blau = await ev(`(() => {
    const beschriftet = (k) => (k.closest('.lane-kachel').querySelector('.lane-titel')||{}).textContent || ''
    const alle = [...document.querySelectorAll('#raster > .lane .tipp-spiel')]
    return {
      blaueAlben: [...document.querySelectorAll('#raster > .lane > .lane-reihe > .lane-kachel > .lane-bild > .tipp-spiel.weiter')].map(beschriftet),
      blaueTitel: [...document.querySelectorAll('.lane-tief .tipp-spiel.weiter')].map(beschriftet),
      knoepfe: alle.length,
      // Beruehrziel und Farbe des ersten blauen Knopfes.
      mass: (() => {
        const b = document.querySelector('#raster > .lane .tipp-spiel.weiter')
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height),
                 farbe: getComputedStyle(b).backgroundColor,
                 label: b.getAttribute('aria-label') || '' }
      })(),
    }
  })()`)
  zeile('blaue Knoepfe auf Alben', blau.blaueAlben.length ? blau.blaueAlben.join(', ') : '(keiner)')
  zeile('blaue Knoepfe auf Titeln', blau.blaueTitel.length ? blau.blaueTitel.join(', ') : '(keiner)')
  zeile('erwartet (aus der Attrappe)', `${sollAlbum.join(', ') || '—'} | ${sollTitel.join(', ') || '—'}`)
  if (blau.mass) {
    zeile('… Beruehrziel / Farbe', `${blau.mass.w}x${blau.mass.h} px, ${blau.mass.farbe}`)
    zeile('… Beschriftung', `„${blau.mass.label}"`)
    if (!/weiter/i.test(blau.mass.label))
      melde('der blaue Knopf heisst nicht „Weiterhören" — die Farbe allein traegt nichts vor')
  }
  if (JSON.stringify(blau.blaueAlben) !== JSON.stringify(sollAlbum)) {
    melde(
      `blaue Album-Knoepfe stimmen nicht: ${blau.blaueAlben.join(', ') || '(keiner)'} statt ${sollAlbum.join(', ')}`,
    )
  }
  if (JSON.stringify(blau.blaueTitel) !== JSON.stringify(sollTitel)) {
    melde(
      `blaue Titel-Knoepfe stimmen nicht: ${blau.blaueTitel.join(', ') || '(keiner)'} statt ${sollTitel.join(', ')}`,
    )
  }

  // ── 4b. WAS SCHICKT DER BLAUE KNOPF WIRKLICH? ─────────────────────────
  //
  // DIE TEUERSTE FRAGE DES GANZEN UMBAUS, denn hier stossen zwei Zaehlweisen
  // aneinander: `versatz` ist 0-basiert und bekommt die +1 beim Bauen des
  // Wunsches, `weiterAb.titelNr` ist SCHON 1-basiert und darf sie NICHT
  // bekommen. Der Unterschied ist ein Titel — und ein Kapitel, das ein Kind
  // nie gehoert hat. Deshalb wird abgehoert, nicht der Code gelesen.
  //
  // SEIT E95/V STUFE 2 (31.08.2026) IST DIE LEITUNG DER WUNSCH: Die Seite
  // schickt `POST /api/spielen {schluessel, titelNr, positionMs}` — welcher
  // Befehl daraus wird (spotify:playlist:<kennung>:…, die Quellenwahl, die
  // Nummernraeume) entscheidet der Server, und diese Wahrheit prueft
  // src/backend-api/src/spielen.integration.spec.ts. Die BEIDEN Zaehlweisen
  // oben bleiben aber Sache der Seite und stehen im Rumpf — genau darum wird
  // er hier gelesen, mitsamt der /player-Leitung: ein Rueckfall auf
  // selbstgebaute Befehle waere ein Befund.
  const stelle = zerlegt.alben.map((a) => a.weiterAb).find(Boolean)
  const sollWunsch = `{schluessel:"${werk.schluessel}", titelNr:${stelle.titelNr}, positionMs:${stelle.positionMs}}`
  const passtStelle = (w) =>
    !!w &&
    w.schluessel === werk.schluessel &&
    Number(w.titelNr) === Number(stelle.titelNr) &&
    Number(w.positionMs) === Number(stelle.positionMs)
  // NUR BEFEHLE, NICHT DIE ABFRAGEN: `/player/local` und `/player/state`
  // fragt die Seite im Takt ab — ein Befehl steht IMMER hinter einem Raum
  // (`/player/current/stop`). An der Zahl der Abschnitte erkannt, nicht an
  // einer Namensliste; Begruendung in tools/kachel-spielt-je-dienst.mjs.
  await ev(`(() => {
    window.__befehle = []
    window.__wuensche = []
    if (!window.__mitgelesen) { window.__mitgelesen = true
      const f = window.fetch
      window.fetch = function (u) {
        try {
          const s = String(u && u.url ? u.url : u)
          const m = /\\/player\\/([^/?#]+)\\/(.+)$/.exec(s)
          if (m) window.__befehle.push(m[2])
          if (/\\/api\\/spielen$/.test(s)) {
            let w = null
            try { w = JSON.parse((arguments[1] || {}).body || '{}') } catch (e) {}
            window.__wuensche.push(w || {})
          }
        } catch (e) {}
        return f.apply(this, arguments)
      } }
    return true
  })()`)
  await ev(
    `(() => { const b = document.querySelector('#raster > .lane > .lane-reihe .tipp-spiel.weiter'); if (b) b.click(); return !!b })()`,
  )
  await warte(900)
  const albumWunsch = await ev(`JSON.stringify((window.__wuensche || [])[0] || null)`)
  const albumBefehle = await ev(`(window.__befehle || []).length`)
  zeile('Album-Knopf wuenscht', albumWunsch === 'null' ? '(nichts)' : albumWunsch)
  zeile('erwartet', sollWunsch)
  if (!passtStelle(JSON.parse(albumWunsch)) || albumBefehle > 0) {
    melde(
      `der blaue Album-Knopf schickt nicht die gemerkte Stelle als Wunsch (erwartet ${sollWunsch}, ` +
        `${albumBefehle} Spielerbefehle)`,
    )
  }

  await ev(`(window.__befehle = []), (window.__wuensche = []), true`)
  await ev(
    `(() => { const b = document.querySelector('.lane-tief .tipp-spiel.weiter'); if (b) b.click(); return !!b })()`,
  )
  await warte(900)
  const titelWunsch = await ev(`JSON.stringify((window.__wuensche || [])[0] || null)`)
  const titelBefehle = await ev(`(window.__befehle || []).length`)
  zeile('Titel-Knopf wuenscht', titelWunsch === 'null' ? '(nichts)' : titelWunsch)
  if (!passtStelle(JSON.parse(titelWunsch)) || titelBefehle > 0) {
    melde(
      `der blaue Titel-Knopf schickt nicht die gemerkte Stelle als Wunsch (erwartet ${sollWunsch}, ` +
        `${titelBefehle} Spielerbefehle)`,
    )
  }

  // Und die Gegenprobe: ein Tipp auf die TITELKACHEL faengt von vorn an, mit
  // dem 0-basierten Versatz plus eins UND OHNE Stelle. Waere hier dieselbe
  // Zahl samt positionMs wie oben, dann hiesse „von vorn" in Wahrheit
  // „weiterhoeren" — und die Farbe versprach einen Unterschied, den es nicht
  // gibt.
  const ersterVersatz = zerlegt.alben[0].stuecke[0].versatz
  await ev(`(window.__befehle = []), (window.__wuensche = []), true`)
  await ev(`(() => { const k = document.querySelector('.lane-tief .lane-kachel'); if (k) k.click(); return !!k })()`)
  await warte(900)
  const vonVornRoh = await ev(`JSON.stringify((window.__wuensche || [])[0] || null)`)
  const vonVorn = JSON.parse(vonVornRoh)
  const sollVorn = `{schluessel:"${werk.schluessel}", titelNr:${ersterVersatz + 1}} ohne positionMs`
  zeile('Tipp auf die Titelkachel', vonVornRoh === 'null' ? '(nichts)' : vonVornRoh)
  if (
    !vonVorn ||
    vonVorn.schluessel !== werk.schluessel ||
    Number(vonVorn.titelNr) !== ersterVersatz + 1 ||
    Number(vonVorn.positionMs) > 0
  ) {
    melde(`ein Tipp auf die Titelkachel wuenscht nicht „${sollVorn}"`)
  }

  // ── 5. Bleibt die Auswahl stehen, waehrend ein Titel laeuft? ───────────
  //
  // DER FALL, DEN DER BENUTZER MELDET. Die Vorschau meldet unter der Lage
  // `spotify` einen LAUFENDEN Titel dieser Playlist (Versatz 6) — absichtlich
  // einen anderen als die gemerkte Stelle (Versatz 3). Nur so laesst sich
  // pruefen, dass „ausgewaehlt", „laeuft gerade" und „hier geht es weiter"
  // drei verschiedene Dinge sind.
  await fetch(new URL('/vorschau/spotify', ZIEL))
  await ev(`(() => { const k = document.querySelector('.lane-tief .lane-kachel'); if (k) k.click(); return !!k })()`)
  await warte(2600)

  const nachStart = await ev(`(() => {
    const tief = document.querySelector('.lane-tief')
    const auf = document.querySelector('#raster > .lane > .lane-reihe > .lane-kachel.auf')
    const spielt = [...document.querySelectorAll('.lane-kachel.spielt')]
    const stil = (e) => { const s = getComputedStyle(e); return { umriss: s.outlineWidth, farbe: s.outlineColor } }
    return {
      laneOffen: !!document.querySelector('#raster > .lane'),
      titelReiheOffen: !!tief,
      albumNochMarkiert: !!auf,
      spieltAnzahl: spielt.length,
      spieltTitel: spielt.map((k) => (k.querySelector('.lane-titel')||{}).textContent || ''),
      // Sehen „ausgewaehlt" und „laeuft gerade" gleich aus? Sie duerfen nicht.
      aufStil: auf ? stil(auf) : null,
      spieltStil: spielt[0] ? stil(spielt[0]) : null,
      spieltMarke: !!document.querySelector('.lane-kachel.spielt .spielt-marke'),
    }
  })()`)
  zeile('Lane nach dem Starten', nachStart.laneOffen ? 'steht noch offen' : 'WEG')
  zeile('Titelliste nach dem Starten', nachStart.titelReiheOffen ? 'steht noch offen' : 'WEG')
  zeile('Album noch markiert', nachStart.albumNochMarkiert ? 'ja' : 'NEIN')
  zeile('dauerhaft „laeuft gerade"', nachStart.spieltAnzahl ? nachStart.spieltTitel.join(', ') : '(nichts markiert)')
  zeile('… eigene Marke im Bild', nachStart.spieltMarke ? 'ja' : 'nein')
  if (!nachStart.laneOffen) melde('die Lane schliesst sich beim Starten — die Auswahl geht verloren')
  if (!nachStart.titelReiheOffen) melde('die Titelliste schliesst sich beim Starten')
  if (!nachStart.albumNochMarkiert) melde('das aufgeklappte Album verliert seine Markierung')
  if (!nachStart.spieltAnzahl) melde('der laufende Titel ist in der Liste nicht dauerhaft zu erkennen')
  if (
    nachStart.aufStil &&
    nachStart.spieltStil &&
    JSON.stringify(nachStart.aufStil) === JSON.stringify(nachStart.spieltStil) &&
    !nachStart.spieltMarke
  ) {
    melde('„ausgewaehlt" und „laeuft gerade" sehen gleich aus')
  }

  // ── 5b. DIE GEGENPROBE: laeuft etwas ANDERES, darf nichts markiert sein ─
  //
  // Ohne sie prueft der Punkt darueber nur, dass ueberhaupt etwas markiert
  // wird — nicht, dass es das RICHTIGE ist. Unter der Lage `spielt` laeuft
  // mpv (ein lokales Hoerbuch), Spotify meldet keinen Zusammenhang. In der
  // Lane einer Spotify-Playlist darf dann keine Kachel behaupten, sie liefe.
  await fetch(new URL('/vorschau/spielt', ZIEL))
  await warte(2600)
  const fremd = await ev(`document.querySelectorAll('.lane-kachel.spielt').length`)
  zeile('markiert, waehrend mpv laeuft', String(fremd))
  if (fremd) melde(`${fremd} Kachel(n) behaupten „laeuft", obwohl etwas anderes spielt`)
  await fetch(new URL('/vorschau/spotify', ZIEL))
  await warte(2600)

  // ── 6. Und dasselbe im DUNKELN ─────────────────────────────────────────
  //
  // HIER STAND `document.getElementById('licht-knopf').click()` — der Mond in
  // der Kopfzeile. Er ist am 07.08.2026 entfallen; der einzige Schalter steht
  // jetzt im Admin-Menue unter Darstellung -> Farbe und Form. Waere die Zeile
  // stehengeblieben, haette `null.click()` geworfen, `ev()` `undefined`
  // geliefert — und dieses Werkzeug haette danach WEITER GEMESSEN, im hellen
  // Stand, unter der Ueberschrift „dunkel".
  //
  // GEMESSEN WIRD HIER DIE LANE IM DUNKELN, NICHT DER SCHALTER. Deshalb wird
  // der STAND gesetzt (`data-licht` + Speicher, genau was app.js tut) und
  // nicht der Weg ins Menue gegangen: der raeumte den Schirm ab, den diese
  // Messung gerade braucht. Den Schalter selbst prueft
  // tools/licht-weg-probe.mjs. Beides steht in tools/licht-weg.mjs.
  if (!(await ev(LICHT_STELLEN_JS('dunkel')))) melde('der dunkle Stand liess sich nicht setzen')
  await warte(400)
  const dunkel = await ev(`(() => {
    const b = document.querySelector('#raster > .lane .tipp-spiel.weiter')
    const n = document.querySelector('#raster > .lane .tipp-spiel:not(.weiter)')
    return { blau: b ? getComputedStyle(b).backgroundColor : null,
             neutral: n ? getComputedStyle(n).backgroundColor : null,
             spielt: document.querySelectorAll('.lane-kachel.spielt').length }
  })()`)
  zeile('dunkel: blau / neutral', `${dunkel.blau || '—'} / ${dunkel.neutral || '—'}`)
  zeile('dunkel: laufend markiert', String(dunkel.spielt))
  if (dunkel.blau && dunkel.blau === dunkel.neutral) melde('im Dunkeln sind beide Knoepfe gleich gefaerbt')
  if (!dunkel.spielt) melde('im Dunkeln ist der laufende Titel nicht markiert')
  await ev(LICHT_STELLEN_JS('hell'))

  if (BILD) {
    const d = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(BILD, Buffer.from(d.data, 'base64'))
    zeile('Bild abgelegt', BILD)
  }

  if (laut.length) {
    console.log('\n  KONSOLE')
    for (const l of laut) melde(`Konsole — ${l}`)
  }

  console.log(fehler ? `\n  ${fehler} Abweichung(en).\n` : '\n  keine Abweichung.\n')
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

if (PRUEFEN && fehler) process.exit(1)
