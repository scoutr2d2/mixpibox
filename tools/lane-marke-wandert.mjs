#!/usr/bin/env node
/**
 * WANDERT DIE MARKE „SPIELT GERADE" MIT, WENN DER TITEL WECHSELT?
 *
 * WOZU: Gemeldet wurde am 03.08.2026 „beim wechsel des titels geht die marke
 * spielt gerade nicht mit". Der Verdacht, die Box verlasse dabei die Playlist,
 * ist an der Box widerlegt (llmwiki `next-verlaesst-die-playlist-nicht`) — der
 * Zusammenhang bleibt. Damit steht die Frage offen, und sie steht in der
 * OBERFLAECHE: `spieltMarkieren()` laeuft aus `dienstHolen()` im
 * 2-Sekunden-Takt. Ob die Marke danach wirklich eine Kachel weiterrueckt, ist
 * am Quelltext nicht abzulesen — nur zu messen.
 *
 * DAS KONNTE VOR DEM 03.08.2026 NIEMAND MESSEN: tools/neu-vorschau.mjs kannte
 * genau EINEN Spotify-Zustand. Zwei aufeinanderfolgende /player/state mit
 * verschiedenem `item.uri` liessen sich gar nicht stellen
 * [attrappe-luegt-durch-weglassen]. Seit es `/vorschau/spotify-weiter` gibt,
 * geht es — und dieses Werkzeug nutzt genau das.
 *
 * WAS ES AENDERT: nichts. Eigener Browser (headless) gegen die Vorschau auf
 * 127.0.0.1:8299. Die BOX wird NICHT angefasst, keine Datei geschrieben.
 *
 * WAS ES MISST
 *   1. Sitzt die Marke vor dem Wechsel auf GENAU der Kachel, deren `uri`
 *      `item.uri` aus /player/state ist? (Die Erwartung kommt aus der
 *      Attrappe, nicht aus app.js — sonst prueft man seine eigene Vermutung.)
 *   2. Rueckt sie nach `/vorschau/spotify-weiter` auf die naechste Kachel?
 *   3. Bleibt genau EINE Titelkachel markiert (nicht null, nicht zwei)?
 *   4. Und dasselbe fuer die ALBUM-Kachel eine Ebene darueber (sie traegt die
 *      Kennungen ALLER ihrer Stuecke in `data-spielt`).
 *
 * AUFRUF
 *     node tools/lane-marke-wandert.mjs             # Tabelle
 *     node tools/lane-marke-wandert.mjs --pruefen   # Ende 1 bei Abweichung
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** Die Playlist, die in der Vorschau eine Lane aufmacht — dieselbe wie in
 *  tools/lane-marken-schau.mjs, und dieselbe, deren Kennung `context.uri` traegt. */
const PLAYLIST = 'Bibi Blocksberg'

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
const stellen = (was) => fetch(new URL(`/vorschau/${was}`, ZIEL)).then((r) => r.json())

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => console.log(`  ${String(n).padEnd(38)} ${w}`)

/**
 * Was die Oberflaeche gerade als „laeuft" markiert.
 *
 * GELESEN WIRD BEIDES: die Klasse `spielt` UND der eingehaengte Punkt
 * `.spielt-marke`. Sie werden in `spieltMarkieren` getrennt gesetzt; nur eines
 * von beiden zu lesen, uebersaehe genau den Fall, in dem sie auseinanderlaufen.
 *
 * SEIT 03.08.2026 STEHT DIE KENNUNG IN `data-spielt` statt in
 * `data-uri`/`data-uris`, und sie traegt den ZUSAMMENHANG mit:
 * "stueck|<playlist>|<uri>". Titel- und Album-Kacheln lassen sich damit nicht
 * mehr am Merkmalsnamen auseinanderhalten — die Titelkachel traegt die Klasse
 * `stueck`, und danach wird jetzt gefragt. Das ist auch die ehrlichere Frage:
 * ein Album mit genau einem Stueck darin waere sonst als Titel durchgegangen.
 */
const LESEN = `(() => {
  const kacheln = [...document.querySelectorAll('.lane-kachel[data-spielt]')]
  const nimm = (k) => ({
    titel: (k.querySelector('.lane-titel') || {}).textContent || '',
    kennung: k.dataset.spielt || '',
    anzahl: (k.dataset.spielt || '').split(' ').filter(Boolean).length,
    spielt: k.classList.contains('spielt'),
    punkt: !!k.querySelector('.spielt-marke'),
  })
  return {
    stuecke: kacheln.filter((k) => k.classList.contains('stueck')).map(nimm),
    alben: kacheln.filter((k) => !k.classList.contains('stueck')).map(nimm),
    // WARUM DER ZUSAMMENHANG MIT AUSGELESEN WIRD: Die Bedingung in
    // spieltMarkieren ist eine Schnittmenge zweier Kennungslisten. Passt sie
    // nicht, sagt "keine Marke" nicht, WORAN es lag. Der mittlere Teil der
    // Kennung ist die Playlist; ihn neben context.uri zu legen trennt
    // "falsche Playlist" von "falsche Kennung des Stuecks" in einem Blick.
    // (KEINE Backticks in diesem Block — er steht selbst in einem
    //  Schablonenliteral und wuerde es sonst beenden.)
    laneZusammenhang: [...new Set(kacheln.map((k) => ((k.dataset.spielt || '').split(' ')[0] || '').split('|')[1] || ''))],
  }
})()`

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  await stellen('voll')
  await stellen('alben-voll')
  await stellen('spotify')

  // DIE ZWEITE MEINUNG KOMMT AUS DER ATTRAPPE: welcher Titel LAEUFT laut
  // /player/state, und wie heisst die Kachel mit genau dieser Kennung?
  const werk = (await (await fetch(new URL('/api/werke', ZIEL))).json()).werke.find((w) => w.titel === PLAYLIST)
  if (!werk) throw new Error(`„${PLAYLIST}" steht nicht in /api/werke — Vorschau geaendert?`)
  const zerlegt = await (await fetch(new URL(`/api/werke/${encodeURIComponent(werk.schluessel)}/alben`, ZIEL))).json()
  const nameZuUri = new Map(zerlegt.alben.flatMap((a) => a.stuecke.map((s) => [String(s.uri), s.titel])))

  let zustandRoh = null
  /**
   * Die Kennung, die die Oberflaeche markieren MUESSTE — gebaut aus der
   * Antwort der Attrappe, nicht aus app.js.
   *
   * Sie hat seit 03.08.2026 die Form "stueck|<playlist>|<uri>"; die Playlist
   * ist das letzte Stueck von context.uri. Wer hier nur `item.uri` vergleicht,
   * bemerkt nicht, wenn die Oberflaeche den ZUSAMMENHANG verliert — und genau
   * der trennt zwei Playlisten, die denselben Titel enthalten.
   */
  const sollKennung = async () => {
    zustandRoh = await (await fetch(new URL('/player/state', ZIEL))).json()
    const uri = String(zustandRoh?.item?.uri || '')
    const roh = String(zustandRoh?.context?.uri || '')
    const zush = roh.slice(roh.lastIndexOf(':') + 1)
    return { uri, zush, kennung: zush && uri ? `stueck|${zush}|${uri}` : '' }
  }

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)

  // Die Lane bis zu den Titeln aufmachen: Playlist -> erstes Album -> Titel.
  // ERST DAS REGAL, DANN DIE PLAYLIST — genau wie in tools/lane-marken-schau.mjs:
  // „Bibi Blocksberg" gehoert zum Interpreten „Kiddinx", der zwei Werke traegt;
  // im Raster steht deshalb das Regal und nicht die Playlist. Wer das
  // uebersieht, bekommt „keine Kachel gefunden" und haelt die Vorschau fuer kaputt.
  const tippe = (titel) =>
    ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .kachel')]
        .find((e) => ((e.querySelector('.kachel-titel') || {}).textContent || '') === ${JSON.stringify(titel)})
      if (!k) return false
      k.click()
      return true
    })()`)
  if (!(await tippe(PLAYLIST))) {
    if (!(await tippe('Kiddinx'))) melde(`weder „${PLAYLIST}" noch das Regal „Kiddinx" im Raster`)
    await warte(900)
    if (!(await tippe(PLAYLIST))) melde(`keine Kachel „${PLAYLIST}" im Regal`)
  }
  await warte(1500)
  const auf2 = await ev(`(() => {
    const k = document.querySelector('#raster > .lane > .lane-reihe > .lane-kachel')
    if (k) k.click()
    return !!k
  })()`)
  if (!auf2) melde('die Album-Lane ist nicht aufgegangen')
  await warte(1500)

  const messe = async (wann) => {
    const { uri, zush, kennung } = await sollKennung()
    const d = await ev(LESEN)
    const markiert = d.stuecke.filter((s) => s.spielt || s.punkt)
    const soll = nameZuUri.get(uri) || '(kein Titel mit dieser Kennung)'
    zeile(`${wann}: /player/state item.uri`, `${uri}  -> „${soll}"`)
    zeile(`${wann}: Titelkacheln im Baum`, `${d.stuecke.length} Titel, ${d.alben.length} Alben (data-spielt)`)
    zeile(`${wann}: context.uri der Wiedergabe`, String(zustandRoh?.context?.uri || '— fehlt —'))
    zeile(`${wann}: Zusammenhang in den Kennungen`, d.laneZusammenhang.map((z) => `„${z}"`).join(', ') || '— keine —')
    if (zush && d.laneZusammenhang.length && !d.laneZusammenhang.includes(zush)) {
      melde(`${wann}: keine Kachel traegt den laufenden Zusammenhang „${zush}" — die Marke kann gar nicht passen`)
    }
    zeile(
      `${wann}: markierte Titelkacheln`,
      markiert.length ? markiert.map((m) => `„${m.titel.trim()}"`).join(', ') : '— KEINE —',
    )
    zeile(
      `${wann}: markierte Albumkacheln`,
      d.alben
        .filter((a) => a.spielt || a.punkt)
        .map((a) => `„${a.titel.trim()}"`)
        .join(', ') || '— KEINE —',
    )
    // STEHT DER LAUFENDE TITEL UEBERHAUPT IN DER OFFENEN LISTE? Ohne diese
    // Unterscheidung waere „keine Marke" zweideutig: einmal ein Fehler
    // (der Titel ist da, wird aber nicht markiert), einmal richtig
    // (er gehoert zu einem anderen Album, dessen Liste gar nicht offen ist).
    const inListe = d.stuecke.some((s) => s.kennung === kennung)
    zeile(`${wann}: laeuft in der offenen Liste?`, inListe ? 'ja' : 'nein — anderes Album')
    if (inListe && markiert.length !== 1) melde(`${wann}: ${markiert.length} markierte Titelkacheln statt genau einer`)
    else if (inListe && markiert[0].kennung !== kennung)
      melde(`${wann}: markiert ist „${markiert[0].titel.trim()}" (${markiert[0].kennung}), laufen tut ${kennung}`)
    else if (!inListe && markiert.length)
      melde(`${wann}: markiert ist „${markiert[0].titel.trim()}", obwohl dieser Titel gar nicht laeuft`)
    for (const m of markiert) {
      if (m.spielt !== m.punkt) melde(`${wann}: „${m.titel.trim()}" hat Klasse=${m.spielt} aber Punkt=${m.punkt}`)
    }
    return { uri, kennung, markiert, inListe }
  }

  console.log('\n  ── VOR DEM TITELWECHSEL ──────────────────────────────────')
  let vorher = await messe('vorher')

  // ZWEI SCHRITTE, NICHT EINER. Der erste bleibt IM Album — das ist der
  // haeufige Fall. Der zweite verlaesst es; das passiert an der Box alle zehn
  // bis dreizehn Titel und ist der Fall, in dem die Marke die geoeffnete
  // Titel-Lane verlassen MUSS. Nur den ersten zu messen hiesse, die Haelfte
  // der Wirklichkeit fuer das Ganze zu halten.
  for (const schritt of ['im selben Album', 'ueber die Albumgrenze']) {
    await stellen('spotify-weiter')
    // Der Takt ist 2 s; ein bisschen Zugabe, damit ein LANGSAMERER Weg (ein
    // eigener Nachzug beim Aufgehen etwa) nicht als Fehler gemeldet wird.
    await warte(4000)

    console.log(`\n  ── NACH DEM WECHSEL (${schritt}) ─────────────────────`)
    const nachher = await messe('nachher')
    if (vorher.uri === nachher.uri) {
      melde('die Vorschau hat den Titel gar nicht gewechselt — dieser Schritt prueft nichts')
    } else if (nachher.markiert.length === 1 && nachher.markiert[0].kennung === nachher.kennung) {
      zeile('  DIE MARKE WANDERT MIT', 'ja')
    } else if (!nachher.markiert.length && nachher.inListe === false) {
      // KEIN FEHLER, ABER DIE ANTWORT AUF DIE MELDUNG: Der laufende Titel
      // steht gar nicht in der geoeffneten Liste. Die Marke ist dann nicht
      // falsch — sie ist an der Albumkachel eine Ebene hoeher. Fuer den, der
      // auf die Titelliste schaut, sieht das aus, als ginge sie nicht mit.
      zeile('  DIE MARKE VERLAESST DIE OFFENE LISTE', 'der laufende Titel gehoert zu einem anderen Album')
    } else {
      melde('DIE MARKE WANDERT NICHT MIT — das ist die gemeldete Beobachtung')
    }
    vorher = nachher
  }
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
