#!/usr/bin/env node
/*
 * WAS EIN ZUG AM HELLIGKEITSREGLER KOSTET — UND OB MAN AUS DEM DUNKLEN
 * ZURUECKKOMMT.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Der Regler unter „Farbe und Form" stellt die Hintergrundbeleuchtung. Hinter
 * jedem Setzen steht ein `sudo tee` auf /sys/class/backlight — auf einem Pi
 * Zero ist das kein Nebenbei. Zwei Aussagen sind darueber aufgeschrieben
 * worden, und beide waren bis heute nur GERECHNET:
 *
 *   1. „Setzen bei `change`, nicht bei `input` — ein Zug sind sonst rund
 *      dreissig sudo-Aufrufe."
 *   2. „Bei `geklemmt` steht der Regler schon ganz links; ein Zug auf den
 *      kleinsten Wert loest gar kein Ereignis aus. Deshalb der Knopf."
 *
 * Die erste laesst sich ZAEHLEN, die zweite laesst sich DRUECKEN. Genau das
 * tut dieses Werkzeug — es zieht den Regler in siebzehn Schritten von links
 * nach rechts und zaehlt mit, wie oft die Seite dabei den Server ruft.
 *
 * ══ WARUM GEZAEHLT UND NICHT GELESEN ══════════════════════════════════════
 * Im Quelltext steht `addEventListener('change', …)`, und das sieht richtig
 * aus. Es sagt aber nichts darueber, ob nicht ANDERSWO noch etwas am selben
 * Regler haengt — ein `input`, das die Zeile neu baut und dabei den Stand
 * holt, waere schon zu viel. Gezaehlt wird deshalb, was den Rechner wirklich
 * verlaesst: jeder `fetch` auf /api/schirm/helligkeit.
 *
 * ══ AUFRUF ═══════════════════════════════════════════════════════════════
 *     node tools/licht-regler-rufe.mjs --port 9815
 *
 * Rueckgabe 0 = beide Aussagen halten.
 */
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
for (const a of argv) {
  if (a.startsWith('--') && !['port'].includes(a.slice(2))) {
    console.error(`${a} kennt dieses Werkzeug nicht. Bekannt: --port`)
    process.exit(2)
  }
}
const PORT = Number(opt('port', 8299))
const BASIS = `http://127.0.0.1:${PORT}`
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Dieses Werkzeug stellt Lagen (licht-da, licht-geklemmt, …); was jetzt in der
// Vorschau steht, muss am Ende wieder dastehen, sonst misst der naechste Lauf
// gegen einen Schirm, den dieser Lauf verstellt hat. Laeuft auf dem Port keine
// Vorschau, startet die Leihgabe selbst eine. Und der eigene Browser laeuft
// auf einem FREIEN Port mit eigenem Profil statt auf einer festen Nummer, die
// ein Ueberlebender eines harten Abbruchs noch halten koennte — /json/list
// liefert dann klaglos die Ziele des fremden.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(`${BASIS}/neu/`)
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
// Warten muss hier niemand mehr: eigenerBrowser() kehrt erst zurueck, wenn
// eine Seite da ist UND der Port nachweislich dem eigenen Browser gehoert.
const ws = new WebSocket(await brw.seite(), { maxPayload: 64 * 1024 * 1024 })
await new Promise((ok) => ws.on('open', ok))
let lfd = 0
const send = (m, p = {}) =>
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
await send('Page.enable')
await send('Runtime.enable')
const ev = async (code) => {
  const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'JS-Fehler')
  return r.result.value
}

/**
 * DER ZAEHLER HAENGT AM `fetch` DER SEITE.
 *
 * Nicht am Zugriffsbuch der Attrappe: dort stuenden auch die Rufe, die
 * irgendein Takt nebenher macht, und die Zuordnung waere geraten. Hier wird
 * genau das gezaehlt, was diese Seite an /api/schirm/helligkeit schickt, samt
 * Methode — ein GET zum Nachlesen ist etwas anderes als ein PUT, das schreibt.
 */
const ZAEHLER_AN = `(() => {
  window.__licht = { get: 0, put: 0 }
  const alt = window.fetch
  window.fetch = function (u, o) {
    const s = String((u && u.url) || u || '')
    if (s.includes('/schirm/helligkeit')) {
      const m = String((o && o.method) || 'GET').toUpperCase()
      window.__licht[m === 'PUT' ? 'put' : 'get']++
    }
    return alt.apply(this, arguments)
  }
  return true
})()`

/**
 * Ins Admin-Menue, Gruppe „Darstellung", Seite „Farbe und Form".
 *
 * Derselbe Weg wie in tools/admin-menue-schau.mjs: `#eltern-faecher
 * [data-fach]` fuer die Gruppe, dann die Zeile ueber ihren NAMEN. Ueber den
 * Namen und nicht ueber die Nummer — eine Zeile, die woanders hinrutscht,
 * soll die Messung nicht still auf eine andere umlenken.
 */
async function zurFarbseite() {
  await adminAuf(ev, { warteMs: 1100 })
  await ev(`document.querySelector('#eltern-faecher [data-fach="anzeige"]').click()`)
  await warte(800)
  const auf = await ev(`(() => {
    for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
      const n = z.querySelector('.zeile-name')
      if (!n || !n.textContent.trim().startsWith('Farbe und Form')) continue
      const k = z.querySelector('.zeile-tat')
      if (k) { k.click(); return true }
      if (z.tagName === 'BUTTON') { z.click(); return true }
    }
    return false })()`)
  if (!auf) throw new Error('Die Zeile „Farbe und Form" war nicht zu finden.')
  await warte(1200)
}

/** Der Helligkeitsregler, sofern er dasteht. */
const REGLER_JS = `(() => {
  const z = [...document.querySelectorAll('.fach-zeile')]
    .find((e) => /Helligkeit des Bildschirms/.test(e.textContent || ''))
  if (!z) return null
  const r = z.querySelector('input[type=range]')
  const k = [...z.querySelectorAll('button')].map((b) => b.textContent.trim())
  return { regler: !!r, min: r ? Number(r.min) : null, max: r ? Number(r.max) : null,
           schritt: r ? Number(r.step) : null, wert: r ? Number(r.value) : null,
           knoepfe: k, unter: (z.querySelector('.zeile-unter') || {}).textContent || '' }
})()`

const funde = []
const zeilen = []

// DIE LAGEN WERDEN IM try GESTELLT. Bricht die Messung mittendrin ab, muss
// die geliehene Vorschau trotzdem wieder so daliegen, wie sie vorgefunden
// wurde — dafuer steht das finally am Ende.
try {
  /* ══ 1. WAS EIN ZUG KOSTET ═══════════════════════════════════════════════
   * Ein echter Zug ueber den Regler feuert `input` bei JEDER Stufe und `change`
   * genau EINMAL, beim Loslassen. Genau das wird hier nachgestellt: siebzehn
   * `input`, dann ein `change`. Waere das Setzen an `input` gehaengt, stuenden
   * hier siebzehn PUT statt einem. */
  await fetch(`${BASIS}/vorschau/licht-da`)
  await send('Page.navigate', { url: `${BASIS}/neu/` })
  await warte(2200)
  await zurFarbseite()
  await ev(ZAEHLER_AN)
  {
    const vor = await ev(REGLER_JS)
    if (!vor || !vor.regler) {
      funde.push('[licht-da] Es steht gar kein Regler da.')
    } else {
      const stufen = await ev(`(() => {
        const z = [...document.querySelectorAll('.fach-zeile')].find((e)=>/Helligkeit des Bildschirms/.test(e.textContent||''))
        const r = z.querySelector('input[type=range]')
        let n = 0
        for (let v = Number(r.min); v <= Number(r.max); v += Number(r.step)) {
          r.value = String(v)
          r.dispatchEvent(new Event('input', { bubbles: true }))
          n++
        }
        r.dispatchEvent(new Event('change', { bubbles: true }))
        return n
      })()`)
      await warte(900)
      const z = await ev(`JSON.stringify(window.__licht)`)
      const { get, put } = JSON.parse(z)
      zeilen.push(`  Zug ueber ${stufen} Stufen: ${put} PUT, ${get} GET auf /api/schirm/helligkeit`)
      if (put !== 1) {
        funde.push(`Ein Zug ueber ${stufen} Stufen schickt ${put} PUT statt genau einem — jedes davon ist ein sudo auf der Box.`)
      }
      // Ein GET nach dem Setzen ist richtig (die Seite holt den Stand, den die
      // Box wirklich angenommen hat). Mehr als eins je Stufe waere es nicht.
      if (get > 3) funde.push(`Ein Zug fragt ${get}-mal den Stand nach — einmal nach dem Setzen reicht.`)
    }
  }

  /* ══ 2. DER GEKLEMMTE ZUSTAND ═════════════════════════════════════════════
   * Die Anzeige sagt 20 %, der Schirm steht auf 0. Der Regler steht damit schon
   * ganz links — ihn dorthin zu ziehen, wo er schon ist, loest KEIN `change`
   * aus. Die Frage ist deshalb nicht „geht es irgendwie", sondern:
   *     KOMMT MAN MIT EINER EINZIGEN BEDIENUNG HERAUS?
   * Geprueft wird beides: dass der Zug ins Leere laeuft (sonst braeuchte es den
   * Knopf nicht) und dass der Knopf da ist und es in einem Griff tut. */
  await fetch(`${BASIS}/vorschau/licht-geklemmt`)
  await send('Page.navigate', { url: `${BASIS}/neu/` })
  await warte(2200)
  await zurFarbseite()
  await ev(ZAEHLER_AN)
  {
    const s = await ev(REGLER_JS)
    if (!s) {
      funde.push('[licht-geklemmt] Die Helligkeitszeile fehlt.')
    } else {
      zeilen.push(`  geklemmt: Regler steht auf ${s.wert} (min ${s.min}), Knoepfe: ${JSON.stringify(s.knoepfe)}`)
      if (s.wert !== s.min) funde.push(`[licht-geklemmt] Der Regler steht auf ${s.wert}, nicht am Anschlag ${s.min} — die Begruendung fuer den Knopf stimmt dann nicht.`)
      if (!/dunkler|wirklich/i.test(s.unter)) {
        funde.push(`[licht-geklemmt] Die Unterzeile sagt nicht, dass der Schirm dunkler ist als der Regler zeigt: „${s.unter}"`)
      }
      /* DER ZUG AUF DEN KLEINSTEN WERT — ER MUSS INS LEERE LAUFEN.
       *
       * NUR `input`, KEIN `change`, und das ist der ganze Punkt: Ein Browser
       * feuert `change` beim Loslassen nur, wenn sich der Wert GEAENDERT hat.
       * Der Regler steht hier schon auf `min`; ein Finger, der ihn ans linke
       * Ende zieht, aendert nichts und loest deshalb nichts aus.
       * (Wer hier von Hand ein `change` verschickt, stellt nicht den Zug nach,
       * sondern erfindet ein Ereignis, das der Browser nie schickt — und
       * bekommt dann prompt zu sehen, dass „der Regler ja doch funktioniert".
       * Beim ersten Lauf genau so hereingefallen.) */
      await ev(`(() => {
        const z=[...document.querySelectorAll('.fach-zeile')].find((e)=>/Helligkeit des Bildschirms/.test(e.textContent||''))
        const r=z.querySelector('input[type=range]')
        r.value=r.min
        r.dispatchEvent(new Event('input',{bubbles:true}))
        return true
      })()`)
      await warte(700)
      const nachZug = JSON.parse(await ev(`JSON.stringify(window.__licht)`))
      zeilen.push(`  geklemmt: ein Zug an den Anschlag schickt ${nachZug.put} PUT (soll: 0 — der Wert aendert sich nicht)`)
      if (nachZug.put !== 0) {
        funde.push(`[licht-geklemmt] Ein Zug, der den Wert nicht aendert, schickt trotzdem ${nachZug.put} PUT.`)
      }
      if (!s.knoepfe.length) {
        funde.push('[licht-geklemmt] Es gibt keinen Knopf — und der Regler steht schon am Anschlag. Aus dieser Lage fuehrt nichts heraus.')
      } else {
        const vorher = nachZug.put
        await ev(`(() => {
          const z=[...document.querySelectorAll('.fach-zeile')].find((e)=>/Helligkeit des Bildschirms/.test(e.textContent||''))
          const k=[...z.querySelectorAll('button')][0]
          k.click()
          return true
        })()`)
        await warte(1200)
        const nachKnopf = JSON.parse(await ev(`JSON.stringify(window.__licht)`))
        const stand = await (await fetch(`${BASIS}/api/schirm/helligkeit`)).json()
        zeilen.push(
          `  geklemmt: „${s.knoepfe[0]}" schickt ${nachKnopf.put - vorher} PUT, ` +
            `danach geklemmt: ${stand.geklemmt}, prozentEcht: ${stand.prozentEcht}`,
        )
        if (nachKnopf.put - vorher !== 1) {
          funde.push(`[licht-geklemmt] Der Knopf „${s.knoepfe[0]}" schickt ${nachKnopf.put - vorher} PUT statt einem.`)
        }
        if (stand.geklemmt === true) {
          funde.push(`[licht-geklemmt] Nach EINER Bedienung ist der Schirm immer noch geklemmt (prozentEcht: ${stand.prozentEcht}).`)
        }
      }
    }
  }

  /* ══ 3. DAS GERAET IST DA UND SAGT NICHT, WO ES STEHT ════════════════════
   * server.ts kennt diesen Zweig: laesst sich die Datei im sysfs nicht LESEN,
   * bleibt `da: true`, aber `prozent` ist `null`. Der Regler darf dann stehen —
   * stellen laesst sich die Helligkeit ja weiterhin —, er darf nur nicht
   * BEHAUPTEN, wo sie gerade ist. Und genau das ist die Stelle, an der ein
   * `Number(null)` sich in eine glatte 0 verwandelt: „Jetzt 0 %" ueber einem
   * Schirm, der voll aufgedreht sein kann. */
  await fetch(`${BASIS}/vorschau/licht-unlesbar`)
  await send('Page.navigate', { url: `${BASIS}/neu/` })
  await warte(2200)
  await zurFarbseite()
  {
    const s = await ev(REGLER_JS)
    if (!s) funde.push('[licht-unlesbar] Die Helligkeitszeile fehlt.')
    else {
      zeilen.push(`  Wert unlesbar: Regler ${s.regler ? `auf ${s.wert}` : 'weg'}, Unterzeile „${String(s.unter).slice(0, 70)}"`)
      if (/Jetzt\s*0\s*%/.test(String(s.unter))) {
        funde.push(`[licht-unlesbar] Die Box konnte den Wert nicht lesen, die Zeile behauptet trotzdem „${String(s.unter).slice(0, 40)}".`)
      }
      if (s.regler && s.wert === 0) funde.push('[licht-unlesbar] Der Regler steht auf 0 — unter der eigenen Untergrenze.')
    }
  }

  /* ══ 4. KEINE HARDWARE — DANN AUCH KEIN REGLER ════════════════════════════
   * Ein Regler, der sich bewegen laesst und nichts tut, ist schlimmer als ein
   * Satz, der sagt warum. */
  await fetch(`${BASIS}/vorschau/licht-weg`)
  await send('Page.navigate', { url: `${BASIS}/neu/` })
  await warte(2200)
  await zurFarbseite()
  {
    const s = await ev(REGLER_JS)
    if (!s) funde.push('[licht-weg] Die Helligkeitszeile fehlt ganz — der Grund muesste dastehen.')
    else {
      zeilen.push(`  ohne Hardware: Regler ${s.regler ? 'DA' : 'weg'}, Grund: „${String(s.unter).slice(0, 60)}…"`)
      if (s.regler) funde.push('[licht-weg] Ohne Hintergrundlicht steht trotzdem ein Regler da.')
      if (!String(s.unter).trim()) funde.push('[licht-weg] Es steht kein Grund da.')
    }
  }
} finally {
  // IM finally: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Befund
  // gemacht hat — also genau dann, wenn als naechstes jemand hinsieht. Das
  // fruehere fetch auf licht-da entfaellt: die Leihe legt den GANZEN
  // vorgefundenen Stand zurueck, nicht nur das Licht.
  ws.close()
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log('\nDER HELLIGKEITSREGLER — GEZAEHLT, NICHT GELESEN')
console.log(zeilen.join('\n'))
if (!funde.length) {
  console.log('\n  Der Zug kostet einen Ruf, und aus dem geklemmten Zustand fuehrt ein Griff heraus.\n')
  process.exit(0)
}
console.log(`\n  ${funde.length} Befund(e):`)
for (const f of funde) console.log(`   * ${f}`)
console.log()
process.exit(1)
