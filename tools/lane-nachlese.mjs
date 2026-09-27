#!/usr/bin/env node
/**
 * NACHLESE ZU DEN LANES — die Faelle, die beim Gegenlesen vom 03.08.2026
 * uebrig blieben und die keines der vorhandenen Werkzeuge stellt.
 *
 * WOFUER, vier Fragen, die man am Quelltext nicht beantworten kann:
 *
 *   1. VERWAISTE LANE. `laneOffen()` fragt den Baum
 *      (`document.querySelector('.lane')`) und waehlt danach die Ruhezeit —
 *      4000 ms mit Lane, 1400 ohne. Die Interpretenseite legt ihre
 *      Titelliste als `.lane .lane-tief` in `#interpret-reihen` ab, und
 *      `interpretSeiteZu()` setzt nur `hidden = true`. Bleibt die Lane im
 *      Baum stehen, gilt auf der STARTSEITE dauerhaft die lange Zeit,
 *      obwohl dort gar nichts aufgeklappt ist. Das ist derselbe Klemmzustand
 *      wie die alte Sperre, nur mit einem neuen Namen — deshalb wird er hier
 *      gemessen und nicht gelesen.
 *
 *   2. DIE LETZTE KACHEL DER ROLLENDEN REIHE. Der Umriss-Platz kommt aus
 *      `padding` an `.lane-reihe` und geht als negatives `margin` wieder
 *      hinaus. Fuer die ERSTE Kachel ist das nachgemessen (lane-marken-schau).
 *      Fuer die LETZTE ist es das nicht: In einem Rollbehaelter ist das
 *      rechte `padding` historisch die Stelle, an der Browser sich
 *      unterscheiden. Ein Kind, das bis zum letzten Album blaettert und es
 *      antippt, saehe den Umriss dort dann angeschnitten.
 *
 *   3. NIMMT DIE WISCHGESTE DEN REIHEN DAS BLAETTERN? Sie horcht `passive`
 *      und faengt nichts ab — behauptet der Kommentar. Gemessen wird das
 *      Gegenteil: nach einem Wisch vom linken Rand muss dieselbe Reihe noch
 *      waagerecht rollen.
 *
 *   4. BLAUER KNOPF AUF EINEM ALBUM, DAS DURCH IST. `weiterhoerbare()` siebt
 *      nur das ganze WERK aus (`istDurch`: letzter Titel der Playlist und
 *      ueber 97 %). Steht die Stelle am Ende des letzten Titels EINES ALBUMS
 *      mitten in der Playlist, bleibt sie brauchbar — der blaue Knopf spielt
 *      dann ein paar Sekunden und geht ins naechste Album ueber.
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs, nur
 * gelesen und getippt. Weder die Box noch Dateien werden angefasst.
 *
 * AUFRUF
 *     node tools/lane-nachlese.mjs             # Tabelle
 *     node tools/lane-nachlese.mjs --pruefen   # Ende 1 bei Abweichung
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** Die Ruhezeiten aus app.js — hier wird gegen sie gemessen, nicht geraten. */
const RUHE_OHNE_LANE_MS = 1400
const RUHE_MIT_LANE_MS = 4000

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
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(46)} ${wert}`)

/** Die Playlist, die in der Vorschau eine Lane aufmacht. */
const PLAYLIST = 'Bibi Blocksberg'

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)

  console.log(`\nLANE-NACHLESE  (${ZIEL}, Fenster 800x480)`)

  // ── Bausteine ───────────────────────────────────────────────────────────

  const ein = () => ev(`document.body.classList.contains('platz-machen')`)

  const rollen = (top = 220) =>
    ev(
      `(() => { const b = document.getElementById('buehne'); b.scrollTop = ${top};
                b.dispatchEvent(new Event('scroll')); return b.scrollTop })()`,
    )

  const tippen = () =>
    ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .kachel:not(.regal)')]
        .find((x) => (x.querySelector('.kachel-titel')||{}).textContent === ${JSON.stringify(PLAYLIST)});
      if (!k) return 'keine Kachel'; k.click(); return 'ok' })()`)

  /** Die Playlist antippen — sie steckt womoeglich in einem Regal. */
  const laneAuf = async () => {
    if ((await tippen()) === 'ok') return 'ok'
    const regale = await ev(`document.querySelectorAll('#raster > .kachel.regal').length`)
    for (let i = 0; i < regale; i++) {
      await ev(`(document.querySelectorAll('#raster > .kachel.regal')[${i}] || {click(){}}).click()`)
      await warte(500)
      if ((await tippen()) === 'ok') return 'ok'
      // `#zurueck` statt `#regal-zurueck`: seit 03.08.2026 gibt es EINEN Ausgang.
      await ev(`(document.getElementById('zurueck') || { click() {} }).click()`)
      await warte(400)
    }
    return 'keine Kachel'
  }

  /** Alles auf Anfang: erste Kategorie, Lane zu, oben, ausgefahren. */
  const zuruecksetzen = async () => {
    await ev(`(() => {
      const z = document.getElementById('zurueck'); if (z && !document.getElementById('interpret').hidden) z.click();
      const k = document.querySelector('#leiste .kat'); if (k) k.click();
      const b = document.getElementById('buehne'); b.scrollTop = 0;
      for (const r of document.querySelectorAll('.lane-reihe')) r.scrollLeft = 0;
      return true })()`)
    await warte(120)
    await rollen(0)
    await warte(5600)
  }

  /** Wie lange, bis die Leiste zurueckkommt? `seit` ist das ausloesende Rollen. */
  const bisZurueck = async (seit) => {
    for (let i = 0; i < 90; i++) {
      if (!(await ein())) return Date.now() - seit
      await warte(100)
    }
    return null
  }

  // ── 0. GEGENPROBE ───────────────────────────────────────────────────────
  //
  // Ohne sie ist jede Zahl unten wertlos (llmwiki attrappe-luegt-durch-weglassen).
  console.log('\n  ── Gegenprobe: faehrt ein Rollen ueberhaupt ein? ──')
  await zuruecksetzen()
  const vorher = await ein()
  const t0 = Date.now()
  await rollen(220)
  await warte(250)
  const nach = await ein()
  zeile('vor dem Rollen eingefahren', vorher ? 'JA (unerwartet)' : 'nein')
  zeile('nach dem Rollen eingefahren', nach ? 'ja' : 'NEIN')
  if (vorher || !nach) melde('das Einfahren schlaegt gar nicht an — alles Weitere waere wertlos')
  const ruheFrisch = await bisZurueck(t0)
  zeile('Ruhezeit frisch geladen', ruheFrisch === null ? 'kam NICHT zurueck' : `${ruheFrisch} ms`)

  // ── 1. VERWAISTE LANE DER INTERPRETENSEITE ──────────────────────────────
  console.log('\n  ── Verwaiste Lane: Interpretenseite auf, Titel auf, zurueck ──')
  await zuruecksetzen()
  const leute = await ev(`(() => {
    const k = document.querySelector('#leute .leute-kachel');
    if (!k) return 'keine Interpretenkachel'; k.click(); return 'ok' })()`)
  await warte(1800)
  const seiteDa = await ev(`!document.getElementById('interpret').hidden`)
  // Ein Album auf der Interpretenseite antippen — das legt `.lane .lane-tief` an.
  await ev(`(() => {
    const k = document.querySelector('#interpret-reihen .lane-kachel');
    if (!k) return 'keine Albumkachel'; k.click(); return 'ok' })()`)
  await warte(1500)
  const tiefDa = await ev(`!!document.querySelector('#interpret-reihen .lane-tief')`)
  zeile('Interpretenseite offen', seiteDa ? 'ja' : 'NEIN (Messung wertlos)')
  zeile('Titelliste (.lane-tief) steht', tiefDa ? 'ja' : `NEIN (${leute})`)
  await ev(`document.getElementById('zurueck').click()`)
  await warte(900)
  const zurueckAufStart = await ev(`document.getElementById('interpret').hidden === true`)
  const restLane = await ev(`(() => {
    const l = [...document.querySelectorAll('.lane')];
    return l.map((e) => (e.closest('#interpret') ? 'im (versteckten) #interpret' : 'im Raster')).join(', ') || 'keine' })()`)
  zeile('nach Zurueck: Startseite sichtbar', zurueckAufStart ? 'ja' : 'NEIN')
  zeile('… uebrige `.lane` im Baum', restLane)
  // Und jetzt die Wirkung: welche Ruhezeit gilt auf der Startseite?
  await warte(200)
  await rollen(0)
  await warte(200)
  const tR = Date.now()
  await rollen(220)
  await warte(250)
  const einJetzt = await ein()
  const ruheNachher = einJetzt ? await bisZurueck(tR) : null
  zeile('Rollen faehrt ein', einJetzt ? 'ja' : 'NEIN (Messung wertlos)')
  zeile('Ruhezeit auf der Startseite danach', ruheNachher === null ? 'kam NICHT zurueck' : `${ruheNachher} ms`)
  const grenze = (RUHE_OHNE_LANE_MS + RUHE_MIT_LANE_MS) / 2
  if (ruheNachher !== null && ruheNachher > grenze) {
    melde(
      `VERWAISTE LANE: ohne offene Lane gilt die lange Ruhezeit (${ruheNachher} ms statt ~${RUHE_OHNE_LANE_MS} ms) — ` +
        '`laneOffen()` findet die versteckte Titelliste der Interpretenseite',
    )
  }

  // ── 2. DIE LETZTE KACHEL DER ROLLENDEN REIHE ────────────────────────────
  console.log('\n  ── Umriss an der LETZTEN Kachel einer gerollten Reihe ──')
  await zuruecksetzen()
  await laneAuf()
  await warte(1600)
  const letzte = await ev(`(() => {
    const r = document.querySelector('#raster .lane .lane-reihe');
    if (!r) return null;
    // Ganz ans Ende rollen und die letzte Kachel waehlen.
    r.scrollLeft = r.scrollWidth;
    const ks = [...r.querySelectorAll('.lane-kachel')];
    const k = ks[ks.length - 1];
    if (!k) return null;
    for (const x of ks) x.classList.remove('auf');
    k.classList.add('auf');
    const rr = r.getBoundingClientRect(), kr = k.getBoundingClientRect();
    const luft = parseFloat(getComputedStyle(r).paddingRight) || 0;
    return {
      kacheln: ks.length,
      rollbar: r.scrollWidth > r.clientWidth + 1,
      scrollMax: Math.round(r.scrollWidth - r.clientWidth),
      scrollJetzt: Math.round(r.scrollLeft),
      luftRechts: Math.round(luft),
      // Wie viel steht rechts von der letzten Kachel bis zum Reihenrand?
      restRechts: Math.round(rr.right - kr.right),
      // Der Umriss braucht 3 px Strich + 2 px Abstand + Saum (--umriss-luft).
      brauchtRechts: Math.round(luft),
    } })()`)
  if (!letzte) {
    melde('keine Lane-Reihe gefunden — Vorschau geaendert?')
  } else {
    zeile('Kacheln in der Album-Reihe', String(letzte.kacheln))
    zeile('Reihe rollt waagerecht', letzte.rollbar ? `ja (max ${letzte.scrollMax} px)` : 'NEIN')
    zeile('bis ans Ende gerollt', `${letzte.scrollJetzt} von ${letzte.scrollMax} px`)
    zeile('Luft (padding) rechts', `${letzte.luftRechts} px`)
    zeile('rechts von der letzten Kachel frei', `${letzte.restRechts} px`)
    if (!letzte.rollbar) melde('die Album-Reihe rollt nicht mehr waagerecht')
    if (letzte.scrollJetzt < letzte.scrollMax - 1) {
      melde(`ans Ende der Reihe kommt man nicht: ${letzte.scrollJetzt} von ${letzte.scrollMax} px`)
    }
    if (letzte.restRechts < letzte.brauchtRechts) {
      melde(
        `UMRISS RECHTS ANGESCHNITTEN: nur ${letzte.restRechts} px frei, ` +
          `der Umriss braucht ${letzte.brauchtRechts} px (das rechte padding faellt im Rollbehaelter weg)`,
      )
    }
  }

  // ── 2b. DER NEGATIVE AUSSENABSTAND DER REIHEN ───────────────────────────
  //
  // Der Platz fuer den Umriss kommt aus `padding` und geht als negatives
  // `margin` wieder hinaus — an DREI Reihen (.lane-reihe, .leute-reihe,
  // .weiter-reihe). Ein negatives `margin` reicht ueber den Rand des Elternteils
  // hinaus; auf 800 px Breite ist das genau der Weg, auf dem eine Seite
  // anfaengt, sich WAAGERECHT rollen zu lassen. Ein Kind, das dann senkrecht
  // wischt, verschiebt versehentlich das ganze Bild.
  const rand = await ev(`(() => {
    const b = document.getElementById('buehne');
    // NUR WAS IM BILD LIEGT. Ein ausgeblendetes Element meldet den Kasten
    // (0,0,0,0) — beim ersten Lauf stand deshalb „-88 px" in der Tabelle
    // (die Breite der Leiste), und das sah nach einer Reihe aus, die aus dem
    // Bild ragt. Es war die verborgene Interpreten-Reihe eines offenen Regals.
    const reihen = [...document.querySelectorAll('.leute-reihe, .weiter-reihe')].map((r) => {
      const k = r.querySelector('.leute-kachel, .weiter-kachel');
      if (!k || !k.getClientRects().length) return null;
      return Math.round(k.getBoundingClientRect().left - b.getBoundingClientRect().left);
    }).filter((x) => x !== null);
    return {
      seiteRollt: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1,
      buehneRollt: b.scrollWidth > b.clientWidth + 1,
      ersteKachelAb: reihen.join(', ') || '(keine Reihe)',
    } })()`)
  zeile('Seite rollt waagerecht', rand.seiteRollt ? 'JA' : 'nein')
  zeile('Buehne rollt waagerecht', rand.buehneRollt ? 'JA' : 'nein')
  zeile('erste Kachel der Kopfreihen ab', `${rand.ersteKachelAb} px`)
  if (rand.seiteRollt) melde('die SEITE laesst sich waagerecht rollen — der negative Aussenabstand steht ueber')
  if (rand.buehneRollt) melde('die BUEHNE laesst sich waagerecht rollen — der negative Aussenabstand steht ueber')

  // ── 3. NIMMT DIE WISCHGESTE DEN REIHEN DAS BLAETTERN? ───────────────────
  console.log('\n  ── Waagerecht blaettern nach einem Randwisch ──')
  // Erst einfahren (sonst horcht die Geste gar nicht), dann vom Rand wischen
  // und danach in derselben Reihe waagerecht rollen.
  await rollen(240)
  await warte(300)
  const einVorWisch = await ein()
  const wisch = await ev(`(() => {
    const r = document.querySelector('#raster .lane .lane-reihe');
    if (!r) return 'keine Reihe';
    r.scrollLeft = 0;
    const k = r.querySelector('.lane-kachel');
    const y = Math.round(k.getBoundingClientRect().top + 40);
    const opt = (x) => ({ pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true });
    k.dispatchEvent(new PointerEvent('pointerdown', opt(12)));
    k.dispatchEvent(new PointerEvent('pointermove', opt(50)));
    k.dispatchEvent(new PointerEvent('pointermove', opt(96)));
    k.dispatchEvent(new PointerEvent('pointerup', opt(96)));
    return 'ok' })()`)
  await warte(300)
  const einNachWisch = await ein()
  const rolltNoch = await ev(`(() => {
    const r = document.querySelector('#raster .lane .lane-reihe');
    if (!r) return null;
    r.scrollLeft = 120;
    return { gesetzt: Math.round(r.scrollLeft), max: Math.round(r.scrollWidth - r.clientWidth) } })()`)
  zeile('vor dem Wisch eingefahren', einVorWisch ? 'ja' : 'NEIN (Messung wertlos)')
  zeile('Wisch vom Rand holt die Leiste', einVorWisch && !einNachWisch ? 'ja' : 'NEIN')
  zeile('Reihe rollt danach noch', rolltNoch ? `${rolltNoch.gesetzt} von ${rolltNoch.max} px` : 'keine Reihe')
  if (wisch !== 'ok') melde(`der Wisch kam nicht zustande: ${wisch}`)
  if (einVorWisch && einNachWisch) melde('der Randwisch holt die Leiste nicht mehr zurueck')
  if (rolltNoch && rolltNoch.gesetzt < 1) melde('WAAGERECHTES BLAETTERN WEG: die Reihe rollt nach dem Wisch nicht mehr')

  // ── 4. MEHRFACH EIN UND AUS: zappelt es, springt das Raster? ────────────
  //
  // Das Freigeben der Zeile (negativer oberer Aussenabstand am eingefahrenen
  // Kissen) ist genau die Aenderung, an der ein frueherer Anlauf gescheitert
  // ist. Ein einzelner Durchgang beweist nichts:
  // Die Rueckkopplung braucht mindestens zwei — einfahren macht die Buehne
  // 84 px hoeher, das Zurueckkommen macht sie wieder kleiner, und beides
  // erzeugt Rollereignisse, die als Finger ankommen koennten.
  console.log('\n  ── Vier Mal ein und aus: zappelt es, springt das Raster? ──')
  await zuruecksetzen()
  const takt = []
  const stellen = []
  for (let i = 0; i < 4; i++) {
    await rollen(200 + i * 20)
    await warte(250)
    takt.push((await ein()) ? 'EIN' : 'aus?')
    const zurueck = await bisZurueck(Date.now())
    takt.push(zurueck === null ? 'BLIEB' : 'aus')
    // Im ausgefahrenen Zustand oben messen: steht die erste Kachel wieder da,
    // wo sie vorher stand?
    await ev(`(() => { const b = document.getElementById('buehne'); b.scrollTop = 0; return 1 })()`)
    await warte(400)
    stellen.push(
      await ev(`(() => {
        const k = document.querySelector('#raster > .kachel');
        const b = document.getElementById('buehne');
        if (!k) return null;
        const r = k.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(b.clientHeight)].join('/') })()`),
    )
    await warte(600)
  }
  zeile('Takt (je Durchgang)', takt.join(' '))
  zeile('erste Kachel links/oben, Buehnenhoehe', [...new Set(stellen)].join('  |  '))
  if (takt.filter((t) => t === 'EIN').length !== 4) melde('nicht jeder Durchgang fuhr ein')
  if (takt.includes('BLIEB')) melde('ZAPPELT/KLEMMT: in einem Durchgang kam die Leiste nicht zurueck')
  if (new Set(stellen).size !== 1) {
    melde(`DAS RASTER SPRINGT: die erste Kachel steht nach den Durchgaengen verschieden (${stellen.join(', ')})`)
  }

  console.log('')
  if (fehler) console.error(`  ${fehler} Abweichung(en).`)
  else console.log('  keine Abweichung.')
} catch (e) {
  console.error(`  ABBRUCH  ${e?.message || e}`)
  fehler++
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
