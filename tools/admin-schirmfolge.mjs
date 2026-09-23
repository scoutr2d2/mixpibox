#!/usr/bin/env node
/**
 * JEDE SEITE DES ADMIN-MENUES, HELL UND DUNKEL — abgebildet und nachgemessen.
 *
 * ══ WOZU, UND WARUM NICHT `eltern-bildergalerie.mjs` ═══════════════════════
 *
 * Die Bildergalerie ist vom 06.08.2026 und bildet die Lagen ab, die es damals
 * gab: die vier Tore, die FUENF flachen Faecher, der lange Boxname. Seit
 * demselben Tag gibt es die Faecher nicht mehr — es gibt VIER GRUPPEN und eine
 * zweite Ebene mit ELF PUNKTEN darunter. Von dieser zweiten Ebene hat noch
 * kein Werkzeug ein Bild gemacht.
 *
 * UND KEINES HAT SIE DUNKEL GESEHEN. `data-licht="dunkel"` ist ein Umschalter
 * am Wurzelelement (index.html); alle Bilder dieses Hauses sind hell. Eine
 * Karte, die hell einen Rand hat und dunkel keinen, faellt in keiner Zahl auf.
 *
 * ══ WAS ES MISST, NEBEN DEN BILDERN ════════════════════════════════════════
 *   SPALTE   Wie viele Gruppen, wie hoch, und ROLLT sie? Die Faecherspalte
 *            darf nicht rollen — was dort unten haengt, findet niemand. (Die
 *            Karte darf; deshalb wird sie anders gemessen.)
 *   KARTE    Sicht gegen Inhalt. Rollt sie, muss von der naechsten Zeile
 *            genug zu sehen sein, dass man sie SUCHT — sonst ist sie weg.
 *   ANSCHNITT  Endet ein Knopf mitten im Kartenrand? Ein Knopf zu 86 Prozent
 *            sieht ganz aus und ist es nicht (der Befund vom 06.08.2026).
 *   WORTE    Steht ueberall „Admin"? Der Bereich hat am 06.08.2026 seinen
 *            Namen gewechselt; ein zurueckgebliebenes „Eltern-Bereich" in
 *            einem SICHTBAREN Satz ist keine Kleinigkeit, sondern die Stelle,
 *            an der die Oberflaeche zwei Namen fuer dieselbe Sache hat.
 *
 * ══ WAS ES NICHT AENDERT ═══════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Ohne Adresse startet es seine
 * eigene Vorschau auf einem freien Port ([[vorschau-wird-geliehen]]). Es faehrt
 * NUR Wege, die nichts ausloesen: keine Rueckfrage wird bestaetigt.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/admin-schirmfolge.mjs --bilder /tmp/admin-folge
 *   node tools/admin-schirmfolge.mjs http://127.0.0.1:8982/neu/ --bilder /tmp/x
 * ENDE 0, wenn jede Aussage haelt.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const MITGEGEBEN = argv.find((a) => a.startsWith('http')) || null
const BILDER = (() => {
  const i = argv.indexOf('--bilder')
  return i < 0 ? null : argv[i + 1]
})()
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const MM = 0.1397

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '  — ' + wie : ''}`)
}

/** Die Gliederung, wie sie dastehen muss. Dieselbe Liste wie in admin-menue-schau. */
const SOLL = [
  ['verbindung', ['WLAN', 'Bluetooth']],
  ['medien', ['Suchen und verwalten', 'Dienste']],
  ['anzeige', ['Indikatoren', 'Farbe und Form', 'Verhalten']],
  ['system', ['Info', 'Sperre vor diesem Bereich', 'Neu laden und neu starten']],
]

/**
 * DIE OFFENEN LISTEN — dort gilt die Anschnitt-Regel NICHT.
 *
 * WLAN, Bluetooth und die Mediensuche zeigen so viele Zeilen, wie es gerade
 * gibt: zwoelf Netze rollen immer, und an welcher Stelle der Kartenrand dabei
 * faellt, hat niemand entschieden. Ein halb angeschnittener Knopf ist dort das
 * uebliche Zeichen, dass es weitergeht.
 *
 * DIE REGEL GILT FUER SEITEN, DEREN ZEILENZAHL IM CODE STEHT — dort ist der
 * Anschnitt eine Entscheidung, und dort war er am 06.08.2026 ein Fehler (ein
 * Knopf zu 86 %). Diese Trennung ist nicht neu; sie steht wortgleich in
 * tools/admin-menue-schau.mjs bei `kartePruefen` und wird hier nur
 * uebernommen, damit die beiden Werkzeuge nicht verschiedene Massstaebe
 * anlegen.
 */
const OFFENE_LISTEN = ['WLAN', 'Bluetooth', 'Suchen und verwalten']

let ZIEL = MITGEGEBEN
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
  ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
  }
  const licht = (w) => ev(`(document.documentElement.setAttribute('data-licht', ${JSON.stringify(w)}), true)`)
  /**
   * LADEN — UND DIE GEMEINSAME FREIGABE WEGRAEUMEN.
   *
   * Sie steht seit dem 06.08.2026 in `localStorage` und gilt ZWEI MINUTEN
   * (NewDesign/freigabe.json). Ein Werkzeug, das vorher schon einmal das Tor
   * geloest hat — auch ein anderes —, findet es beim naechsten Lauf OFFEN und
   * meldet dann „vor dem Tor stehen vier Gruppen im Baum". Das ist kein Befund
   * ueber die Sperre, sondern einer ueber die Reihenfolge der Laeufe; genau so
   * ist dieses Werkzeug beim ersten Mal falsch rot geworden.
   */
  /**
   * DIE SPERRART DER VORSCHAU SETZEN — ausdruecklich, nicht geerbt.
   *
   * `tools/neu-vorschau.mjs` startet mit `sperre: 'aus'`. Wer das nicht setzt,
   * misst ein Tor, das gar nicht da ist — und `rechnen()` gibt still `false`
   * zurueck, waehrend die Aussage „das Tor steht" rot wird und wie ein Befund
   * ueber die Oberflaeche aussieht. Genau so ist dieses Werkzeug beim zweiten
   * Lauf falsch rot geworden; der Fehler lag im Werkzeug.
   */
  const sperre = async (art) => {
    await fetch(new URL(`/vorschau/sperre-${art}`, ZIEL)).catch(() => null)
    await warte(150)
  }

  const laden = async ({ freigabeBehalten = false } = {}) => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(600)
    if (!freigabeBehalten) {
      await ev(`(localStorage.removeItem('mupibox_eltern_freigabe'), true)`)
      await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    }
    await warte(2200)
  }
  const klick = (wahl) => ev(`(() => { const e = ${wahl}; if (!e) return false; e.click(); return true })()`)
  const hinein = async () => {
    // HIER STAND EIN KLICK AUFS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    // `pruefen: false`: dieses Werkzeug geht absichtlich in Lagen, in denen
    // eine Sperre das Tor stellt statt der Faecher — die Pruefung darauf ist
    // die Aufgabe der Schirmfolge selbst.
    await adminAuf(ev, { warteMs: 1100, pruefen: false })
  }
  const rechnen = async () => {
    const f = await ev(`(document.getElementById('tor-frage')||{}).textContent || ''`)
    const m = String(f).match(/(\d+)\s*×\s*(\d+)/)
    if (!m) return false
    for (const z of String(Number(m[1]) * Number(m[2])))
      await klick(`document.querySelector('#tor-feld [data-taste="${z}"]')`)
    await klick(`document.querySelector('#tor-feld .tor-weiter')`)
    await warte(1000)
    return true
  }
  const gruppe = async (id) => {
    await klick(`document.querySelector('#eltern-faecher [data-fach="${id}"]')`)
    await warte(700)
  }
  const punkt = async (name) => {
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.trim().startsWith(${JSON.stringify(name)})) continue
        if (z.tagName === 'BUTTON') { z.click(); return true }
        const k = z.querySelector('.zeile-tat'); if (k) { k.click(); return true }
      }
      return false })()`)
    await warte(800)
    return ok === true
  }

  /** Spalte und Karte in Zahlen — an EINER Stelle, damit die Regeln nicht auseinanderlaufen. */
  const messen = () =>
    ev(`JSON.stringify((() => {
      const sp = document.getElementById('eltern-faecher')
      const k = document.getElementById('fach-zeilen')
      const kr = k ? k.getBoundingClientRect() : null
      const zeilen = k ? [...k.querySelectorAll('.fach-zeile')].map((z) => {
        const r = z.getBoundingClientRect()
        const t = z.querySelector('.zeile-tat')
        const tr = t ? t.getBoundingClientRect() : null
        const sicht = (b) => Math.max(0, Math.min(b.bottom, kr.bottom) - Math.max(b.top, kr.top))
        return {
          n: ((z.querySelector('.zeile-name')||{}).textContent||'').trim(),
          h: Math.round(r.height),
          sichtbar: Math.round(sicht(r)),
          knopfTeil: tr && tr.height ? +(sicht(tr) / tr.height).toFixed(2) : null,
          selbstKnopf: z.tagName === 'BUTTON',
        }
      }) : []
      return {
        spalte: sp ? {
          knoepfe: [...sp.querySelectorAll('.fach-knopf')].map((b) => ({
            w: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height),
          })),
          sicht: Math.round(sp.getBoundingClientRect().height),
          inhalt: Math.round(sp.scrollHeight),
        } : null,
        karte: kr ? { sicht: Math.round(kr.height), inhalt: Math.round(k.scrollHeight) } : null,
        kopf: ((document.getElementById('fach-name')||{}).textContent||'').trim(),
        zeilen,
      }
    })())`)

  /**
   * HEISST ES HIER „ADMIN"?
   *
   * GESUCHT WIRD IM SICHTBAREN TEXT UND IN DEN BESCHRIFTUNGEN, nicht in den
   * Kennungen: `#eltern`, `.eltern-*` und `eltern.auf` bleiben mit Absicht
   * stehen (Entscheidung vom 06.08.2026, index.html). Ein SATZ, den ein Mensch
   * liest oder eine Vorlesestimme spricht, ist etwas anderes.
   */
  /**
   * STEHT AUF DIESER SEITE EINE LEERE SCHEIBE?
   *
   * ── WARUM DIESE FRAGE HIERHER GEHOERT ────────────────────────────────────
   * Seit dem 07.08.2026 sind die Zeichen SVG statt Emoji (die Box kennt nur
   * DejaVu und zeichnete jedes Emoji als leeres Rechteck). Der Name kommt aus
   * dem Datensatz, das Bild aus der Karte `ZEICHEN` in app.js. Kennt die Karte
   * den Namen nicht, setzt `zeichenKnoten()` ein Fragezeichen und
   * `data-zeichen-fehlt` — sichtbar genug, um nicht wie Absicht auszusehen,
   * und still genug, um kein Kind zu erschrecken.
   *
   * DIE STATISCHE PRUEFUNG (python3 tools/zeichen-ohne-schrift.py) liest die
   * Namen aus dem Quelltext und faengt jeden Tippfehler. Sie kann aber nicht
   * sehen, was erst zur Laufzeit ENTSTEHT — etwa `MEDIEN_ZEICHEN[e.dienst]`
   * fuer einen Dienst, den es beim Schreiben der Karte noch nicht gab. Genau
   * DAS sieht dieses Werkzeug, weil es jede Seite wirklich betritt.
   *
   * Es zaehlt auf JEDER Seite, nicht einmal am Ende: die meisten Zeichen sind
   * nur von einer einzigen der elf Seiten aus zu sehen.
   */
  const leereScheiben = []
  const scheibenPruefen = async (wo) => {
    const t = JSON.parse(
      await ev(`JSON.stringify([...document.querySelectorAll('[data-zeichen-fehlt]')]
        .map((e) => e.getAttribute('data-zeichen') || '(ohne Namen)'))`),
    )
    for (const x of new Set(t)) leereScheiben.push(`${wo} → „${x}" steht nicht in ZEICHEN`)
  }

  const gefundeneNamen = []
  const namePruefen = async (wo) => {
    const t = JSON.parse(
      await ev(`JSON.stringify((() => {
        const treffer = []
        const nimm = (s, was) => { if (s && /Eltern/i.test(s)) treffer.push(was + ': ' + String(s).trim().slice(0, 80)) }
        const w = document.getElementById('eltern')
        if (!w || w.hidden) return treffer
        for (const e of w.querySelectorAll('*')) {
          if (!e.children.length) nimm(e.textContent, e.className || e.tagName)
          nimm(e.getAttribute('aria-label'), 'aria ' + (e.className || e.tagName))
        }
        return [...new Set(treffer)] })())`),
    )
    for (const x of t) gefundeneNamen.push(`${wo} → ${x}`)
  }

  // ══ 1. DAS TOR — davor darf NICHTS im Baum stehen ═══════════════════════
  console.log('\n══ VOR DEM TOR ══════════════════════════════════════')
  await sperre('rechnen')
  await laden()
  await hinein()
  const vor = JSON.parse(
    await ev(`JSON.stringify({
      tor: !document.getElementById('eltern-tor').hidden,
      flaeche: !document.getElementById('eltern-flaeche').hidden,
      gruppen: [...document.querySelectorAll('#eltern-faecher .fach-knopf')].map((b) => b.textContent.trim()),
      zeilen: [...document.querySelectorAll('#fach-zeilen .fach-zeile')].length,
    })`),
  )
  ja(vor.tor === true, 'das Tor steht')
  ja(vor.flaeche === false, 'die Flaeche dahinter ist NICHT da')
  // NICHT „unsichtbar", sondern GAR NICHT: ein Knopf im Baum ist ein Knopf,
  // den eine Vorlesestimme vorliest und ein Stilfehler sichtbar macht.
  ja(vor.gruppen.length === 0, 'und KEINE Gruppe steht im Baum', `${vor.gruppen.length} gefunden`)
  ja(vor.zeilen === 0, 'und keine Zeile in der Karte', `${vor.zeilen} gefunden`)
  await bild('0-tor-hell')
  await licht('dunkel')
  await bild('0-tor-dunkel')
  await licht('hell')

  // ══ 2. JEDE GRUPPE, JEDER PUNKT, HELL UND DUNKEL ════════════════════════
  ja(await rechnen(), 'die Rechenaufgabe steht am Schirm und laesst sich loesen')
  for (const [id, punkte] of SOLL) {
    console.log(`\n══ GRUPPE ${id.toUpperCase()} ═════════════════════════════`)
    await gruppe(id)
    const m = JSON.parse(await messen())
    ja(m.spalte.knoepfe.length === 4, 'vier Gruppen in der Spalte', m.spalte.knoepfe.map((k) => k.w).join(' · '))
    const zuKlein = m.spalte.knoepfe.filter((k) => k.h * MM < 9)
    ja(zuKlein.length === 0, 'jede Gruppe haelt die 9-mm-Marke', `${m.spalte.knoepfe[0].h} px = ${(m.spalte.knoepfe[0].h * MM).toFixed(2)} mm`)
    // DIE SPALTE DARF NICHT ROLLEN. Was dort unten haengt, findet niemand —
    // es gibt keinen Anlass, in einer Liste von vier Woertern zu rollen.
    ja(m.spalte.inhalt <= m.spalte.sicht + 1, 'die Spalte rollt NICHT', `${m.spalte.inhalt} in ${m.spalte.sicht} px`)
    console.log(`      Karte: ${m.karte.sicht} px Sicht, ${m.karte.inhalt} px Inhalt${m.karte.inhalt > m.karte.sicht + 1 ? ' — rollt' : ''}`)
    // ROLLT SIE, MUSS DIE NAECHSTE ZEILE ANGESCHNITTEN ZU SEHEN SEIN. 10 px
    // ist die Marke aus admin-menue-schau; darunter ist die Zeile faktisch weg.
    const weg = m.zeilen.filter((z) => z.sichtbar < 10)
    ja(weg.length === 0, 'von jeder Zeile sind mindestens 10 px zu sehen', weg.map((z) => z.n).join(', ') || '—')
    // AUCH DIE UEBERSICHT SELBST, und nicht erst ihre Punkte. Ohne diese Zeile
    // fiel die Gegenprobe durch: ein absichtlich verdrehter Name in
    // `ELTERN_PUNKTE` steht in der UEBERSICHT, und dort war noch niemand.
    // Elf von siebzehn Zeichen des Admin-Menues liegen auf dieser Ebene.
    await scheibenPruefen(`${id} · Übersicht`)
    await bild(`1-${id}-hell`)
    await licht('dunkel')
    await bild(`1-${id}-dunkel`)
    await licht('hell')

    for (const p of punkte) {
      const ok = await punkt(p)
      if (!ok) {
        ja(false, `„${p}" ist antippbar`)
        continue
      }
      const u = JSON.parse(await messen())
      const kurz = p.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 18)
      console.log(`      ${p}: Kopf „${u.kopf}", ${u.karte.sicht}/${u.karte.inhalt} px${u.karte.inhalt > u.karte.sicht + 1 ? ' — rollt' : ''}`)
      // EIN KNOPF STEHT GANZ DA ODER NUR ALS SCHNIPSEL. Alles dazwischen sieht
      // ganz aus und ist es nicht — das ist der Befund vom 06.08.2026, und er
      // gilt auf JEDER Seite, nicht nur auf der, an der er auffiel.
      const halb = u.zeilen.filter((z) => z.knopfTeil !== null && z.knopfTeil > 1 / 3 && z.knopfTeil < 0.95)
      if (OFFENE_LISTEN.includes(p))
        console.log(`      ${p}: offene Liste — Anschnitt nicht bewertet (${halb.length} angeschnitten)`)
      else
        ja(halb.length === 0, `   ${p}: kein Knopf endet mitten im Kartenrand`, halb.map((z) => `${z.n} ${Math.round(z.knopfTeil * 100)} %`).join(', ') || '—')
      // DER NAME WIRD AUF JEDER SEITE GEFRAGT und nicht einmal am Ende. Der
      // Satz, der beim ersten Lauf durchrutschte, steht in der Zeile „Keine
      // Sperre" — sie ist von genau EINER der elf Seiten aus zu sehen.
      await namePruefen(`${id} · ${p}`)
      await scheibenPruefen(`${id} · ${p}`)
      await bild(`2-${id}-${kurz}-hell`)
      await licht('dunkel')
      await bild(`2-${id}-${kurz}-dunkel`)
      await licht('hell')
      await klick(`document.getElementById('zurueck')`)
      await warte(600)
    }
  }

  // ══ 3. HEISST ES UEBERALL „ADMIN"? ═════════════════════════════════════
  //
  // GESUCHT WIRD IM SICHTBAREN TEXT UND IN DEN BESCHRIFTUNGEN, nicht in den
  // Kennungen: `#eltern`, `.eltern-*` und `eltern.auf` bleiben mit Absicht
  // stehen (Entscheidung vom 06.08.2026, index.html). Ein SATZ, den ein
  // Mensch liest, ist etwas anderes.
  console.log('\n══ DER NAME ═════════════════════════════════════════')
  for (const x of gefundeneNamen) console.log(`      ${x}`)
  ja(gefundeneNamen.length === 0, 'kein sichtbarer Text sagt noch „Eltern"', `${gefundeneNamen.length} Stelle(n)`)

  // ══ 4. STEHT IRGENDWO EINE LEERE SCHEIBE? ══════════════════════════════
  console.log('\n══ DIE ZEICHEN ══════════════════════════════════════')
  for (const x of leereScheiben) console.log(`      ${x}`)
  ja(leereScheiben.length === 0, 'jede Scheibe traegt ein Zeichen aus der Karte', `${leereScheiben.length} Stelle(n)`)

  if (BILDER) console.log(`\nBilder: ${BILDER}`)
  console.log(fehler === 0 ? '\nALLES GRUEN' : `\n${fehler} AUSSAGE(N) GEFEHLT`)
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
process.exit(fehler === 0 ? 0 : 1)
