#!/usr/bin/env node
/*
 * LAEUFT DIE UHR OBEN IN DER MITTE — UND FOLGT DIE RESTZEIT?
 * ═════════════════════════════════════════════════════════════════════════
 *
 * tools/kopfmitte-wahrheit.mjs prueft, ob die zwei Anzeigen im AUGENBLICK des
 * Ladens die Wahrheit sagen. Das ist die halbe Frage. Die andere ist: Sagen
 * sie sie auch noch in zehn Minuten? Eine Uhr, die einmal stimmt und dann
 * stehenbleibt, ist schlimmer als keine — sie sieht ja richtig aus.
 *
 * Der Kiosk auf der Box wird NIE neu geladen. Was hier stehenbleibt, bleibt
 * bis zum Stromausfall stehen.
 *
 * ══ DIE VIER FRAGEN ═══════════════════════════════════════════════════════
 *
 * 1. STEHT DA ETWAS, BEVOR DIE ERSTE ANTWORT DA IST?
 *    Gemessen mit einer GESPERRTEN Adresse (`Network.setBlockedURLs`), also
 *    dem Fall, den es auf der Box wirklich gibt: Der Server antwortet nicht.
 *    Die Uhr darf dann laufen (sie braucht niemanden), die Restzeit MUSS
 *    schweigen. Eine Restzeit aus dem Nichts waere eine Zahl, die niemand
 *    zurueckziehen kann.
 *
 * 2. LAEUFT DIE UHR WEITER, und springt sie AUF DER MINUTE?
 *    Diese Frage hat beim ersten Lauf einen Fehler gefunden: Die Anzeige hing
 *    am 20-Sekunden-Takt der Seite, und der laeuft nicht auf der Minute,
 *    sondern auf dem Zeitpunkt des Ladens — gemessen sprang sie 17,1 Sekunden
 *    NACH der Grenze um. Bis zu zwanzig Sekunden lang stand also die falsche
 *    Minute da, neben einer Anzeige, die „ab 16:00" sagt. Seither stellt sich
 *    `kopfMitte.minutenWecker()` auf die kommende Grenze. Gemessen wird ueber
 *    eine echte Minutengrenze hinweg, mit Stoppuhr.
 *
 * 3. FOLGT DIE RESTZEIT, OHNE DASS JEMAND NEU LAEDT?
 *    Die Kinderzeit sinkt waehrend des Hoerens. Wenn die Anzeige das nicht
 *    mitbekommt, steht dort „noch 23 min", bis die Box mitten im Hoerspiel
 *    aufhoert — genau der Abbruch, den sie ankuendigen sollte.
 *
 * 4. UEBERSTEHT EIN PROFILWECHSEL DIE ZAHL DES VORIGEN KINDES?
 *    Zwei Kinder haben verschiedene Guthaben. Bleibt die Zahl des einen nach
 *    dem Wechsel stehen, sagt sie dem anderen etwas ueber ein Konto, das ihm
 *    nicht gehoert.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/kopfmitte-laeuft.mjs --port 9815
 *
 * DAUERT UEBER EINE MINUTE. Frage 2 wartet auf eine echte Minutengrenze; das
 * laesst sich nicht abkuerzen, ohne genau die Uhr zu faelschen, die geprueft
 * werden soll.
 */
import WebSocket from 'ws'
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
/** Der Takt, in dem app.js die beiden Anzeigen nachzieht (TAKT_ZEIT). */
const TAKT_MS = 20000

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Dieses Werkzeug stellt Lagen (kz-an, kz-knapp, kz-aus); was jetzt in der
// Vorschau steht, muss am Ende wieder dastehen, sonst misst der naechste Lauf
// gegen ein Guthaben, das dieser Lauf verstellt hat. Laeuft auf dem Port
// keine Vorschau, startet die Leihgabe selbst eine. Und der eigene Browser
// laeuft auf einem FREIEN Port mit eigenem Profil statt auf einer festen
// Nummer, die ein Ueberlebender eines harten Abbruchs noch halten koennte.
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
await send('Network.enable')
const ev = async (code) => {
  const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'JS-Fehler')
  return r.result.value
}
const oben = async () =>
  JSON.parse(
    await ev(`JSON.stringify({
      uhr: (()=>{const u=document.getElementById('km-uhr');return u&&!u.hidden?u.textContent:null})(),
      rest: (()=>{const r=document.getElementById('km-rest');return r&&!r.hidden?r.textContent:null})()
    })`),
  )
const jetztHhmm = () => {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
/** Die Schalter dazulegen, nicht ersetzen — sonst faellt die halbe Darstellung weg. */
async function schalterAn(felder) {
  const jetzt = await (await fetch(`${BASIS}/api/darstellung`)).json()
  await fetch(`${BASIS}/api/darstellung`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aktuell: { ...(jetzt.aktuell || {}), ...felder } }),
  })
}

const funde = []
const zeilen = []

// DIE LAGEN WERDEN IM try GESTELLT. Bricht die Messung mittendrin ab — und
// Frage 2 wartet ueber eine Minute —, muss die geliehene Vorschau trotzdem
// wieder so daliegen, wie sie vorgefunden wurde; dafuer steht das finally.
try {
  await schalterAn({ uhrzeit: true, restzeit: true, kinderzeitPassung: true })

  /* ══ 1. OHNE ANTWORT ════════════════════════════════════════════════════ */
  await fetch(`${BASIS}/vorschau/kz-an`)
  await send('Network.setBlockedURLs', { urls: ['*kinderzeit/stand*'] })
  await send('Page.navigate', { url: `${BASIS}/neu/` })
  await warte(3000)
  {
    const s = await oben()
    zeilen.push(`  ohne Antwort:  Uhr „${s.uhr}", Restzeit ${s.rest === null ? '(weg)' : `„${s.rest}"`}`)
    if (s.rest !== null) funde.push(`Der Stand ist nicht abrufbar, oben steht trotzdem „${s.rest}".`)
    if (s.uhr === null) funde.push('Ohne Server steht auch keine Uhr da — sie braucht ihn gar nicht.')
  }
  await send('Network.setBlockedURLs', { urls: [] })

  /* ══ 2. DIE UHR UEBER EINE MINUTENGRENZE ════════════════════════════════
   * Gewartet wird bis kurz vor die naechste volle Minute, dann im
   * Halbsekundentakt geschaut, wann die Anzeige nachzieht. Die Verspaetung darf
   * einen Takt betragen, mehr nicht. */
  await send('Page.navigate', { url: `${BASIS}/neu/` })
  await warte(2500)
  {
    const start = await oben()
    if (start.uhr === null) {
      funde.push('Die Uhr steht gar nicht da — der Rest dieser Messung faellt aus.')
    } else {
      const bisMinute = 60000 - (Date.now() % 60000)
      await warte(Math.max(0, bisMinute - 500))
      const sollAb = Date.now() + 500
      let neu = null
      let alsDann = null
      for (let i = 0; i < 70; i++) {
        await warte(500)
        const s = await oben()
        if (s.uhr !== start.uhr) {
          neu = s.uhr
          alsDann = Date.now()
          break
        }
      }
      if (neu === null) {
        funde.push(`Die Uhr blieb ueber eine Minutengrenze hinweg auf „${start.uhr}" stehen.`)
      } else {
        const spaet = Math.round((alsDann - sollAb) / 100) / 10
        zeilen.push(`  Uhr:           „${start.uhr}" -> „${neu}", ${spaet} s nach der Minutengrenze (Takt ${TAKT_MS / 1000} s)`)
        if (neu !== jetztHhmm()) funde.push(`Die Uhr sprang auf „${neu}", die Box hat „${jetztHhmm()}".`)
        /* ZWEI SEKUNDEN UND NICHT ZWANZIG. Die Grenze ist ausdruecklich NICHT
         * der Takt: Der Wecker (`kopfMitte.minutenWecker`) stellt sich auf die
         * Minutengrenze selbst, die Anzeige muss also praktisch sofort
         * nachziehen. Waere hier ein ganzer Takt erlaubt, ginge derselbe Fehler
         * beim naechsten Umbau still wieder durch — dieses Werkzeug hat ihn ja
         * gerade deshalb gefunden, weil niemand ihn erwartet hatte.
         * 2 s = ein Blick alle 500 ms plus Luft fuer einen langsamen Rechner. */
        if (spaet > 2) {
          funde.push(`Die Uhr sprang erst ${spaet} s nach der Minutengrenze um — so lange stand die falsche Minute da.`)
        }
      }
    }
  }

  /* ══ 3. DIE RESTZEIT SINKT, OHNE DASS JEMAND NEU LAEDT ══════════════════
   * Waehrend die Seite steht, wird das Guthaben umgestellt — genau das tut der
   * Server auch von selbst, waehrend ein Kind hoert. Die Anzeige muss folgen. */
  {
    const vor = (await oben()).rest
    await fetch(`${BASIS}/vorschau/kz-knapp`)
    let nach = vor
    const ab = Date.now()
    for (let i = 0; i < Math.ceil((TAKT_MS * 2.5) / 500); i++) {
      await warte(500)
      nach = (await oben()).rest
      if (nach !== vor) break
    }
    const dauer = Math.round((Date.now() - ab) / 100) / 10
    zeilen.push(`  Restzeit:      „${vor}" -> „${nach}" nach ${dauer} s (ohne Neuladen)`)
    if (nach === vor) {
      funde.push(`Das Guthaben wechselte von 23 auf 3 Minuten, oben stand nach ${dauer} s immer noch „${vor}".`)
    } else if (nach !== 'noch 3 min') {
      funde.push(`Nach dem Wechsel steht oben „${nach}" statt „noch 3 min".`)
    }
  }

  /* ══ 4. DER PROFILWECHSEL ═══════════════════════════════════════════════
   * Der Wechsel laedt die Seite neu (`ich.werWaehlen` -> location.reload()).
   * Geprueft wird nicht der Code, sondern das Ergebnis: Nach dem Wechsel darf
   * die Zahl des vorigen Kindes nicht mehr dastehen. Das Guthaben wird dazu im
   * selben Atemzug umgestellt — bliebe die alte Zahl stehen, waere genau das
   * der Fehler. */
  {
    const vor = (await oben()).rest
    await fetch(`${BASIS}/vorschau/kz-an`)
    const gewechselt = await ev(`(async () => {
      const a = await fetch('/api/profil/aktiv', { method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ kennung: 'gast' }) })
      if (!a.ok) return false
      window.location.reload()
      return true
    })()`)
    await warte(3500)
    const nach = (await oben()).rest
    zeilen.push(`  Profilwechsel: „${vor}" -> „${nach}" (umgeschaltet: ${gewechselt})`)
    if (nach === vor) funde.push(`Nach dem Profilwechsel steht immer noch „${vor}" da — die Zahl des vorigen Kindes.`)
  }
} finally {
  // IM finally: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Befund
  // gemacht hat — also genau dann, wenn als naechstes jemand hinsieht. Das
  // fruehere fetch auf kz-aus entfaellt: die Leihe legt den GANZEN
  // vorgefundenen Stand zurueck, nicht nur die Kinderzeit.
  ws.close()
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log('\nLAEUFT DIE UHR, UND FOLGT DIE RESTZEIT?')
console.log(zeilen.join('\n'))
if (!funde.length) {
  console.log('\n  Beide Anzeigen bleiben in Bewegung und sagen nichts, was sie nicht wissen.\n')
  process.exit(0)
}
console.log(`\n  ${funde.length} Befund(e):`)
for (const f of funde) console.log(`   * ${f}`)
console.log()
process.exit(1)
