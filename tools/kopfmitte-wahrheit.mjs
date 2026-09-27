#!/usr/bin/env node
/*
 * SAGEN UHRZEIT, RESTZEIT UND KINDERZEIT-PASSUNG DIE WAHRHEIT?
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Seit dem 07.08.2026 stehen oben in der Mitte zwei neue Anzeigen (Uhrzeit,
 * Restzeit) und an jeder Titelkachel eine Laenge, die rot wird, wenn der Titel
 * „heute nicht mehr in die Hoerzeit passt". Alle drei behaupten etwas ueber
 * die Kinderzeit — und die Kinderzeit hat einen EIGENEN Richter: den Server.
 *
 * ── WAS HIER GEPRUEFT WIRD, UND WAS NICHT ─────────────────────────────────
 * Nicht „sieht es gut aus" und nicht „steht die Zahl da". Geprueft wird EINE
 * Aussage, und sie ist die einzige, die zaehlt:
 *
 *     DIE ANZEIGE DARF DEM SERVER NICHT WIDERSPRECHEN.
 *
 * `GET /api/kinderzeit/stand` sagt mit `erlaubt` und `grund`, ob JETZT
 * gespielt werden darf. Steht dort „nein", dann ist jede Anzeige, die dem Kind
 * verbleibende Minuten verspricht, eine Luege — und zwar die teuerste Sorte:
 * eine, die genau in dem Moment auffliegt, in dem das Kind auf eine Kachel
 * tippt und die Box sagt „jetzt nicht".
 *
 * ── WARUM DAS BISHER NIEMAND MESSEN KONNTE ────────────────────────────────
 * Der Server kennt SECHS Gruende (kinderzeit.ts, Typ `Grund`): aus, frei,
 * tagGesperrt, zuFrueh, zuSpaet, aufgebraucht. Die Attrappe konnte bis heute
 * nur drei davon hervorbringen — sie wertete das Tagesfenster gar nicht aus
 * und den gesperrten Wochentag ueberhaupt nicht. Wer damit misst, sieht immer
 * gruen. Deshalb sind `kz-gesperrt` und `kz-zufrueh` zusammen mit diesem
 * Werkzeug in tools/neu-vorschau.mjs dazugekommen.
 *
 * DIE ZWEI SIND KEIN RANDFALL: Ein gesperrter Sonntag und ein Fenster, das
 * erst nachmittags aufgeht, sind die zwei Regeln, die Eltern als ERSTES
 * einstellen. In beiden Lagen liefert der Server `restMin` und `fensterBis`
 * MIT (kinderzeit.ts baut `lage` VOR den Abweisungen) — die Zahlen sind da,
 * sie stimmen sogar, sie bedeuten nur nicht, was die Anzeige aus ihnen macht.
 *
 * ── AUFRUF ────────────────────────────────────────────────────────────────
 *     node tools/kopfmitte-wahrheit.mjs --port 9815
 *
 * `--port` ist die EIGENE Vorschau. Ohne ihn misst dieser Lauf die Vorschau
 * eines fremden Arbeitsbaums — [[vorschau-wird-geliehen]]. Der Browser kommt
 * ueber tools/leihgabe.mjs auf einen freien Port mit eigenem Profil; das
 * Fenster eines anderen Laufs laesst sich damit gar nicht mehr erwischen.
 *
 * Rueckgabe 0 = alle Lagen stimmen, 1 = mindestens eine Anzeige widerspricht.
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
const BEKANNT = ['port', 'zeigen']
for (const a of argv) {
  if (!a.startsWith('--')) continue
  if (BEKANNT.includes(a.slice(2))) continue
  console.error(`${a} kennt dieses Werkzeug nicht. Bekannt: ${BEKANNT.map((f) => `--${f}`).join(' ')}`)
  process.exit(2)
}
const PORT = Number(opt('port', 8299))
const BASIS = `http://127.0.0.1:${PORT}`
const ZEIGEN = argv.includes('--zeigen')

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── Die Vorschau muss LAUFEN, und zwar die eigene ────────────────────────
 * Nicht gestartet, sondern verlangt: Wer sie hier startete, koennte sie auf
 * einem Port starten, auf dem schon jemand misst — und dann stellt dieser Lauf
 * einer fremden Messung die Lage um. Erst NACH dieser Pruefung wird geliehen:
 * vorschauLeihen() merkt sich die vorgefundene Lage und legt sie im finally
 * am Ende wieder hin (tools/leihgabe.mjs). */
try {
  await fetch(`${BASIS}/api/werke`, { signal: AbortSignal.timeout(1500) })
} catch {
  console.error(
    `Auf ${BASIS} antwortet keine Vorschau.\n` + `  node tools/neu-vorschau.mjs --port ${PORT} &\n` + `und dann diesen Lauf noch einmal.`,
  )
  process.exit(2)
}
const leihe = await vorschauLeihen(`${BASIS}/neu/`)

// Der eigene Browser: freier Port, eigenes Profil, Eigentumsnachweis — alles
// in tools/leihgabe.mjs, samt der Messungen, die dazu gefuehrt haben. Ein
// fester Debug-Port muss deshalb auch nicht mehr angeklopft werden.
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
const js = async (code) => {
  const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'JS-Fehler')
  return r.result.value
}

/**
 * Die neuen Schalter anstellen — ueber den ECHTEN Weg (PUT /api/darstellung).
 *
 * DAZUGELEGT UND NICHT ERSETZT. `PUT /api/darstellung` tauscht `aktuell`
 * KOMPLETT aus (Vorschau wie Box, server.ts). Wer nur seine drei Felder
 * schickt, loescht Kachelform, Rand, Groessen und Startseite — die Seite sieht
 * danach anders aus, und wer im selben Lauf noch Beruehrziele misst, misst
 * eine Gestalt, die es auf keiner Box gibt. Am 07.08.2026 genau so gestellt
 * und an einer um 18 gestiegenen Zielzahl gemerkt.
 */
async function schalterAn(felder) {
  const jetzt = await (await fetch(`${BASIS}/api/darstellung`)).json()
  await fetch(`${BASIS}/api/darstellung`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aktuell: { ...(jetzt.aktuell || {}), ...felder } }),
  })
}

/**
 * ZUR TITELLISTE — ueber die Interpretenseite.
 *
 * Ein Tipp auf eine Kachel der Startseite SPIELT; die Titel einer Platte
 * bekommt man ueber „Leute" -> Interpret -> Album (`albumTitelOeffnen`).
 * Genommen wird „Europa", weil dort ein Album mit zwoelf Titeln zwischen 4:00
 * und 15:00 haengt — kurz genug, dass bei 45 Minuten Rest ALLE passen, und
 * lang genug, dass bei 3 Minuten KEINER passt. Ein Album, in dem immer alles
 * passt, koennte den Filter nie beim Luegen erwischen.
 */
async function titellisteAuf() {
  await js(`(()=>{const k=[...document.querySelectorAll('.leute-kachel')].find(e=>e.textContent.includes('Europa'));k&&k.click()})()`)
  await warte(1400)
  await js(`(()=>{const k=document.querySelector('.lane-kachel:not(.stueck)');k&&k.click()})()`)
  await warte(1600)
}

/** Was oben in der Mitte steht und was an den Kacheln haengt. */
async function ablesen() {
  return JSON.parse(
    await js(`JSON.stringify({
      jetzt: (()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')})(),
      uhr: (()=>{const u=document.getElementById('km-uhr');return u? (u.hidden?null:u.textContent) : 'FEHLT'})(),
      rest: (()=>{const r=document.getElementById('km-rest');return r? (r.hidden?null:r.textContent) : 'FEHLT'})(),
      knapp: (()=>{const r=document.getElementById('km-rest');return !!r && r.classList.contains('knapp')})(),
      kacheln: [...document.querySelectorAll('.lane-kachel.stueck')].map(k=>({
        titel: (k.querySelector('.lane-titel')||{}).textContent||'',
        dauerMs: k.dataset.dauerMs? Number(k.dataset.dauerMs) : null,
        zeile: (k.querySelector('.stueck-dauer')||{}).textContent||null,
        passtNicht: k.classList.contains('passt-nicht'),
        tippbar: !k.disabled && getComputedStyle(k).pointerEvents !== 'none',
        aria: k.getAttribute('aria-label')||''
      }))
    })`),
  )
}

/* ── DIE LAGEN ────────────────────────────────────────────────────────────
 * `erwartet` bekommt den Stand des Servers und sagt, was oben stehen DARF.
 * Es gibt bewusst keine feste Sollzahl je Lage: Die Zahl haengt an der
 * Tageszeit des Laufs, und ein Werkzeug, das um 15:00 etwas anderes verlangt
 * als um 20:00, ist selbst die Fehlerquelle. */
const LAGEN = [
  { schalter: 'kz-aus', was: 'Kinderzeit aus' },
  { schalter: 'kz-offen', was: 'scharf, heute aber ohne Grenze' },
  { schalter: 'kz-nur-fenster', was: 'nur ein Fenster, kein Minutenkonto' },
  { schalter: 'kz-an', was: 'Regeln scharf, 23 min Guthaben' },
  { schalter: 'kz-knapp', was: 'nur noch 3 Minuten' },
  { schalter: 'kz-leer', was: 'Guthaben aufgebraucht' },
  { schalter: 'kz-gesperrt', was: 'heute gesperrter Wochentag' },
  { schalter: 'kz-zufrueh', was: 'Fenster geht erst spaeter auf' },
]

const funde = []
const zeilen = []

// DIE LAGEN WERDEN IM try GESTELLT. Bricht die Messung mittendrin ab, muss
// die geliehene Vorschau trotzdem wieder so daliegen, wie sie vorgefunden
// wurde — dafuer steht das finally am Ende.
try {
  await schalterAn({ uhrzeit: true, restzeit: true, kinderzeitPassung: true })

  for (const lage of LAGEN) {
    await fetch(`${BASIS}/vorschau/${lage.schalter}`)
    await fetch(`${BASIS}/vorschau/dauer-da`)
    const stand = await (await fetch(`${BASIS}/api/kinderzeit/stand`)).json()
    await send('Page.navigate', { url: `${BASIS}/neu/` })
    await warte(2200)
    await titellisteAuf()
    const s = await ablesen()

    /* ── DIE UHR ───────────────────────────────────────────────────────────
     * Sie muss die ORTSZEIT DIESES RECHNERS zeigen — auf der Box ist das
     * dieselbe Uhr, aus der die Kinderzeit ihre Fenster rechnet. Eine Minute
     * Abweichung ist erlaubt: zwischen Ablesen und Vergleich kann sie umspringen. */
    const uhrHin = (t) => {
      if (!t) return null
      const m = /^(\d{2}):(\d{2})$/.exec(t)
      return m ? Number(m[1]) * 60 + Number(m[2]) : null
    }
    const soll = uhrHin(s.jetzt)
    const ist = uhrHin(s.uhr)
    if (ist === null) funde.push(`[${lage.schalter}] Die Uhr steht nicht da (${JSON.stringify(s.uhr)}).`)
    else if (Math.abs(ist - soll) > 1) funde.push(`[${lage.schalter}] Die Uhr zeigt ${s.uhr}, die Box hat ${s.jetzt}.`)

    /* ── DIE RESTZEIT ──────────────────────────────────────────────────────
     * Drei Faelle, und der dritte ist der, um den es hier geht. */
    const zahl = /^noch (\d+) min$/.exec(String(s.rest || ''))
    const minuten = zahl ? Number(zahl[1]) : null
    if (stand.grund === 'aus') {
      if (s.rest !== null) funde.push(`[${lage.schalter}] Kinderzeit ist AUS, oben steht trotzdem „${s.rest}".`)
    } else if (stand.erlaubt === false) {
      // DER KERN DER PRUEFUNG. Der Server sagt nein — dann darf oben keine
      // Zahl stehen, die etwas anderes verspricht.
      if (minuten !== null && minuten > 0) {
        funde.push(
          `[${lage.schalter}] Der Server sagt NEIN (grund: ${stand.grund}), oben steht „${s.rest}". ` +
            `Das sind ${minuten} Minuten, die es nicht gibt.`,
        )
      }
      // „Noch nicht" ist etwas anderes als „vorbei", und die Anzeige muss den
      // Unterschied hergeben — sonst raeumt ein Kind um 14 Uhr die Box weg,
      // obwohl um 16 Uhr eine Stunde auf es wartet.
      if (stand.grund === 'zuFrueh' && stand.fensterAb && !String(s.rest || '').includes(stand.fensterAb)) {
        funde.push(`[${lage.schalter}] Das Fenster geht um ${stand.fensterAb} auf, oben steht „${s.rest}" — die Zeit fehlt.`)
      }
    } else if (stand.restMin === null && !stand.fensterBis) {
      /* SCHARF, ABER HEUTE OHNE GRENZE. Weder Guthaben noch Fenster — dann gibt
       * es nichts zu sagen, und dann steht dort NICHTS. Nicht „∞": Ein Zeichen,
       * das immer dasteht und nie etwas bedeutet, lernt man zu uebersehen, und
       * dann uebersieht man es auch an dem Tag, an dem es „noch 3 min" sagt. */
      if (s.rest !== null) funde.push(`[${lage.schalter}] Heute gilt keine Grenze, oben steht trotzdem „${s.rest}".`)
    } else if (s.rest === null) {
      funde.push(`[${lage.schalter}] Guthaben da (restMin: ${stand.restMin}), oben steht nichts.`)
    }

    /* ── DIE PASSUNG ───────────────────────────────────────────────────────
     * Zwei Fragen, und beide muessen stimmen:
     *   1. Sagt sie nur ueber Titel etwas, deren Laenge sie KENNT?
     *   2. Sagt sie „passt" ueber Titel, die der Server gar nicht startet? */
    const mitDauer = s.kacheln.filter((k) => k.dauerMs)
    const ohneDauer = s.kacheln.filter((k) => !k.dauerMs)
    for (const k of ohneDauer) {
      if (k.zeile !== null || k.passtNicht) funde.push(`[${lage.schalter}] „${k.titel}" hat keine Laenge, wird aber bewertet.`)
    }
    /*
     * DIE SCHRANKEN KOMMEN AUS DEN FELDERN DES SERVERS, nicht aus der Formel
     * der Oberflaeche — ein Pruefer, der dieselbe Rechnung noch einmal
     * hinschreibt, prueft seine eigene Abschrift.
     *
     *   `hoechstens`  So viele Minuten kann HEUTE hoechstens noch kommen: das
     *                 Tagesguthaben, und wo ein Fenster gesetzt ist, hoechstens
     *                 dessen ganze Laenge. Was laenger ist, MUSS gekennzeichnet
     *                 sein.
     * Bei einem endgueltigen „nein" (gesperrt, zu spaet, aufgebraucht) ist die
     * Schranke 0 — dann muss ALLES gekennzeichnet sein.
     */
    const hhmm = (t) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim())
      return m ? Number(m[1]) * 60 + Number(m[2]) : null
    }
    if (stand.grund !== 'aus') {
      const endgueltigNein = stand.erlaubt === false && stand.grund !== 'zuFrueh'
      const bis = hhmm(stand.fensterBis)
      const ab = hhmm(stand.fensterAb)
      const grenzen = []
      /* `restMin === null` HEISST UNBEGRENZT UND WIRD HIER NICHT MITGEZAEHLT.
       * Die naheliegende Schreibweise `Number.isFinite(Number(stand.restMin))`
       * ist falsch — `Number(null)` ist 0 — und sie war es zuerst auch hier.
       * Damit hat dieses Werkzeug am 07.08.2026 den Fehler in app.js zwar oben
       * in der Mitte gesehen, an den Kacheln aber MITGEMACHT: Es erwartete
       * selbst „alles rot" und nickte zwoelf falsch gefaerbte Titel ab.
       * Ein Pruefer, der dieselbe Rechnung abschreibt, prueft seine Abschrift. */
      if (typeof stand.restMin === 'number' && Number.isFinite(stand.restMin)) grenzen.push(stand.restMin)
      if (bis !== null) grenzen.push(Math.max(0, bis - (ab !== null ? ab : 0)))
      const hoechstens = endgueltigNein ? 0 : grenzen.length ? Math.min(...grenzen) : null
      if (hoechstens === null) {
        // Keine Grenze heisst: keine Aussage. Eine rote Kachel waere hier eine
        // Warnung vor etwas, das es nicht gibt.
        const rot = mitDauer.filter((k) => k.passtNicht)
        if (rot.length) funde.push(`[${lage.schalter}] Heute gilt keine Grenze, ${rot.length} Titel stehen trotzdem als „passt nicht" da.`)
      } else {
        const durchgerutscht = mitDauer.filter((k) => !k.passtNicht && k.dauerMs / 60000 > hoechstens)
        if (durchgerutscht.length) {
          funde.push(
            `[${lage.schalter}] Grund „${stand.grund}": heute sind hoechstens ${hoechstens} Minuten zu holen, ` +
              `${durchgerutscht.length} von ${mitDauer.length} laengeren Titeln stehen trotzdem als passend da ` +
              `(z. B. „${durchgerutscht[0].titel}", ${durchgerutscht[0].zeile}).`,
          )
        }
        // UND DIE ANDERE RICHTUNG. Wer vor dem Fenster alles rot faerbt, sagt
        // „passt heute nicht mehr" ueber Titel, die heute dreimal hineinpassen.
        const zuUnrecht = mitDauer.filter((k) => k.passtNicht && k.dauerMs / 60000 <= hoechstens)
        if (zuUnrecht.length) {
          funde.push(
            `[${lage.schalter}] Grund „${stand.grund}": ${zuUnrecht.length} Titel sind kuerzer als die ` +
              `${hoechstens} Minuten, die heute noch kommen, stehen aber als „passt nicht" da ` +
              `(z. B. „${zuUnrecht[0].titel}", ${zuUnrecht[0].zeile}).`,
          )
        }
      }
    }
    /* ── DER FILTER DARF NICHTS WEGNEHMEN ──────────────────────────────────
     * Was ein Kind sehen und antippen darf, entscheidet die Medienauswahl und
     * der Server — nicht diese Anzeige. Eine Kachel, die durch die Passung
     * unsichtbar oder untippbar wuerde, waere ein ZWEITER Filter ueber der
     * Erlaubnis, und der eine im Browser ist der, den ein Neuladen aushebelt. */
    const weg = s.kacheln.filter((k) => !k.tippbar)
    if (weg.length) funde.push(`[${lage.schalter}] ${weg.length} Titelkacheln sind nicht mehr tippbar — der Filter nimmt etwas weg.`)

    zeilen.push(
      `  ${lage.schalter.padEnd(12)} ${String(stand.grund).padEnd(12)} erlaubt:${String(stand.erlaubt).padEnd(6)} ` +
        `restMin:${String(stand.restMin).padEnd(5)} bis:${String(stand.fensterBis || '—').padEnd(6)} ` +
        `oben:${(s.rest === null ? '(weg)' : s.rest).padEnd(12)} ` +
        `Kacheln: ${mitDauer.filter((k) => k.passtNicht).length}/${mitDauer.length} rot`,
    )
    if (ZEIGEN) zeilen.push(`      ${JSON.stringify(s.kacheln.slice(0, 3))}`)
  }

  /* ── UND DIE LAGE, IN DER ES GAR KEINE LAENGE GIBT ───────────────────────
   * Lokale Alben (playlist.m3u) bringen keine Dauer mit. Die Passung muss dann
   * SCHWEIGEN — „passt nicht" waere geraten, „passt" auch. */
  /*
   * ZWEI SORTEN „KEINE LAENGE", und sie kommen aus verschiedenen Richtungen:
   *   `dauer-weg`   das Feld fehlt ganz — der lokale Fall (playlist.m3u).
   *   `dauer-null`  das Feld ist da und steht auf 0 — ein Dienst, der eine
   *                 Folge noch nicht fertig eingelesen hat.
   * Beide muessen dasselbe bewirken: NICHTS. „0:00" waere eine Laenge, die es
   * nicht gibt, und „passt" waere sie erst recht — null Minuten passen immer,
   * auch wenn gar keine Zeit mehr da ist.
   */
  for (const fall of ['dauer-weg', 'dauer-null']) {
    await fetch(`${BASIS}/vorschau/kz-leer`)
    await fetch(`${BASIS}/vorschau/${fall}`)
    await send('Page.navigate', { url: `${BASIS}/neu/` })
    await warte(2200)
    await titellisteAuf()
    const s = await ablesen()
    const geredet = s.kacheln.filter((k) => k.zeile !== null || k.passtNicht)
    if (geredet.length) {
      funde.push(
        `[${fall}] ${geredet.length} Titel ohne brauchbare Laenge werden trotzdem bewertet ` +
          `(z. B. „${geredet[0].titel}": Zeile ${JSON.stringify(geredet[0].zeile)}, rot ${geredet[0].passtNicht}) — das ist geraten.`,
      )
    }
    zeilen.push(`  ${fall.padEnd(12)} ohne Laenge  ${s.kacheln.length} Kacheln, ${geredet.length} davon bewertet (soll: 0)`)
  }

  /* ══ NIMMT DER FILTER EINEM KIND ETWAS WEG? ══════════════════════════════
   *
   * DIE WICHTIGERE HAELFTE, und sie laesst sich nicht am Quelltext ablesen.
   * Seit gestern gibt es die MEDIENAUSWAHL je Kind (`/api/profil/auswahl`) —
   * sie entscheidet, WAS ein Kind ueberhaupt sieht. Seit heute gibt es die
   * Kinderzeit-Passung — sie soll nur KENNZEICHNEN. Zwei Filter uebereinander
   * sind die Stelle, an der still etwas verschwindet: Der eine nimmt weg, der
   * andere faerbt, und wenn der zweite auch nur eine Kachel verschluckt, faellt
   * es zwischen den beiden niemandem auf.
   *
   * GEMESSEN WIRD DIE HAERTESTE LAGE: eine eingeschraenkte Auswahl UND eine
   * aufgebrauchte Kinderzeit (da wird jede Kachel gekennzeichnet). Die Menge
   * der sichtbaren Werke muss mit und ohne Passung ZEICHEN FUER ZEICHEN
   * dieselbe sein.
   */
  {
    const werke = (await (await fetch(`${BASIS}/api/werke`)).json()).werke || []
    const auswahl = werke.slice(0, 4).map((w) => w.schluessel)
    const aktiv = (await (await fetch(`${BASIS}/api/profile`)).json()).aktiv || 'liam'
    await fetch(`${BASIS}/api/profil/auswahl`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profil: aktiv, werke: auswahl }),
    })
    await fetch(`${BASIS}/vorschau/kz-leer`)
    const sichtbar = async () => {
      await send('Page.navigate', { url: `${BASIS}/neu/` })
      await warte(2400)
      return JSON.parse(
        await js(`JSON.stringify({
          kacheln: [...document.querySelectorAll('.kachel')].map(k=>({
            t: (k.querySelector('.kachel-titel')||k).textContent.trim().slice(0,40),
            tippbar: !k.disabled && getComputedStyle(k).pointerEvents !== 'none' && getComputedStyle(k).display !== 'none'
          })),
          kats: [...document.querySelectorAll('.kat')].map(e=>e.textContent.trim())
        })`),
      )
    }
    await schalterAn({ kinderzeitPassung: false })
    const ohne = await sichtbar()
    await schalterAn({ kinderzeitPassung: true })
    const mit = await sichtbar()
    const liste = (s) => s.kacheln.map((k) => k.t).join(' · ')
    zeilen.push(
      `  Auswahl (${auswahl.length} Werke) fuer „${aktiv}": ohne Passung ${ohne.kacheln.length} Kacheln, ` +
        `mit Passung ${mit.kacheln.length} — Kategorien ${ohne.kats.length}/${mit.kats.length}`,
    )
    if (liste(ohne) !== liste(mit)) {
      funde.push(
        `Die Passung veraendert, WAS zu sehen ist.\n       ohne: ${liste(ohne)}\n        mit: ${liste(mit)}`,
      )
    }
    if (mit.kacheln.some((k) => !k.tippbar)) {
      funde.push('Mit eingeschalteter Passung ist mindestens eine Werkkachel nicht mehr tippbar.')
    }
    if (ohne.kats.join('·') !== mit.kats.join('·')) {
      funde.push(`Die Passung veraendert die Kategorien: „${ohne.kats.join('·')}" gegen „${mit.kats.join('·')}".`)
    }
    // Die Auswahl wieder aufheben — eine leere Liste heisst „alles".
    await fetch(`${BASIS}/api/profil/auswahl`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profil: aktiv, werke: [] }),
    })
  }

  /* ══ UEBERLEBEN DIE SCHALTER EIN NEULADEN? ═══════════════════════════════
   * Sie stehen in `darstellung.json` und gelten fuer die GANZE BOX (die
   * Verwaltung schreibt es unter jede Darstellungsseite: „gilt für die ganze
   * Box"). Das ist eine Aussage ueber den Ort — und Aussagen ueber Orte sind an
   * diesem Baum schon dreimal auseinandergelaufen. Also nachgesehen. */
  {
    await fetch(`${BASIS}/vorschau/kz-an`)
    await schalterAn({ uhrzeit: true, restzeit: true })
    await send('Page.navigate', { url: `${BASIS}/neu/` })
    await warte(2400)
    const eins = await ablesen()
    await send('Page.navigate', { url: `${BASIS}/neu/` })
    await warte(2400)
    const zwei = await ablesen()
    const gespeichert = (await (await fetch(`${BASIS}/api/darstellung`)).json()).aktuell || {}
    zeilen.push(
      `  nach dem Neuladen: Uhr ${zwei.uhr ? 'da' : 'weg'}, Restzeit ${zwei.rest ? 'da' : 'weg'} ` +
        `(darstellung.json: uhrzeit=${gespeichert.uhrzeit}, restzeit=${gespeichert.restzeit}, passung=${gespeichert.kinderzeitPassung})`,
    )
    if (!zwei.uhr || !zwei.rest) funde.push('Nach dem Neuladen ist eine der beiden Anzeigen weg — der Schalter haelt nicht.')
    if (eins.rest !== zwei.rest) funde.push(`Zwei Ladevorgaenge, zwei Auskuenfte: „${eins.rest}" und „${zwei.rest}".`)
  }

} finally {
  // IM finally: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen
  // Widerspruch gefunden hat — also genau dann, wenn als naechstes jemand
  // hinsieht. Das fruehere fetch auf dauer-da entfaellt: die Leihe legt den
  // GANZEN vorgefundenen Stand zurueck.
  ws.close()
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log('\nUHRZEIT, RESTZEIT UND PASSUNG GEGEN DEN STAND DES SERVERS')
console.log(zeilen.join('\n'))
if (!funde.length) {
  console.log('\n  Keine Anzeige widerspricht dem Server.\n')
  process.exit(0)
}
console.log(`\n  ${funde.length} Widerspruch/Widersprueche:`)
for (const f of funde) console.log(`   * ${f}`)
console.log()
process.exit(1)
