#!/usr/bin/env node
/**
 * DIE MARKE „SPIELT GERADE" AN IHREN RAENDERN — vier Faelle, die die
 * bequemen Messungen nicht stellen.
 *
 * WOFUER: tools/raster-marke-schau.mjs misst den Hauptfall (Spotify spielt
 * eine Playlist, die im Raster steht) und die Gegenprobe (mpv spielt, niemand
 * hat es hier gestartet). Beide gehen von einer EINDEUTIGEN Lage aus. Die
 * teuren Faelle liegen daneben, und sie sind beim Gegenlesen des Umbaus vom
 * 03.08.2026 aufgefallen:
 *
 *   1. VERSCHMOLZENES WERK, das ueber seine ZWEITE Quelle laeuft.
 *      Nach [verschmelzung-aufloesung-stufe1] ist `quellen[0]` die
 *      BEVORZUGUNG, nicht die einzige Quelle. „Die drei ???" traegt Jellyfin
 *      und Spotify; von dieser Seite aus spielt es ueber Jellyfin, vom Telefon
 *      aus kann dasselbe Album ueber SPOTIFY laufen. Dann meldet
 *      /player/state den `context.uri` der Spotify-Quelle — und die steht auf
 *      `quellen[1]`.
 *
 *   2. NACHLAUF: mpv spielt, /player/state traegt den alten Spotify-Zustand
 *      noch weiter ([spotify-nachlauf-muster]). Es gibt dann ZWEI Auskuenfte
 *      darueber, was laeuft, und sie widersprechen sich. Die Frage dieser
 *      Messung ist, ob die Oberflaeche dabei an EINER Stelle antwortet — oder
 *      ob Raster und Lane auseinanderlaufen.
 *
 *   3. WIE VIELE MARKEN TANZEN GLEICHZEITIG. Der Kommentar in app.css
 *      behauptet „nie mehr als eine oder zwei"; seit die Marke auch im Raster
 *      steht, traegt sie ausserdem das Regal, die Album-Kachel und die
 *      Titel-Kachel der offenen Lane. Auf einem Pi ist das eine Zahl, die man
 *      zaehlt und nicht schaetzt.
 *
 *   4. DER LAUFENDE TITEL GEHOERT ZU KEINEM GANZEN ALBUM. Nachgetragen am
 *      03.08.2026, nachdem genau das an der Box aufschlug und HIER nicht zu
 *      sehen war: Alle drei Messungen oben spielen einen Titel AUS EINEM
 *      ALBUM. Ein loser Titel hatte in der Album-Lane gar keine Kachel — die
 *      Marke konnte dort nicht stehen, und keine Pruefung hat es bemerkt.
 *
 * DIE ATTRAPPE IST NICHT DAS GERAET. Alle Faelle hier laufen gegen
 * tools/neu-vorschau.mjs. Was die BOX wirklich antwortet, misst
 * tools/marke-am-geraet.mjs — der Fall 4 ist dort gefunden worden, nicht hier.
 *
 * WAS ES AENDERT: nichts. Eigener Browser (headless) gegen
 * tools/neu-vorschau.mjs auf 127.0.0.1:8299. Die BOX wird NICHT angefasst.
 *
 * ES BRAUCHT ZWEI LAGEN, DIE ES VORHER NICHT GAB, und beide sind mit diesem
 * Werkzeug in tools/neu-vorschau.mjs entstanden — ohne sie misst man das
 * Nichts ([attrappe-luegt-durch-weglassen]):
 *     /vorschau/nachlauf              mpv spielt UND Spotify-Zustand steht
 *     /vorschau/kontext-<uri>         ein anderer context.uri
 *
 * AUFRUF
 *     node tools/marke-grenzfaelle.mjs
 *     node tools/marke-grenzfaelle.mjs --pruefen   # Ende 1 bei Abweichung
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** Das verschmolzene Werk der Vorschau, bei dem Identitaet und Bevorzugung
 *  AUSEINANDERFALLEN — gefuehrt vom Spotify-Eintrag, gespielt ueber Jellyfin.
 *  Das ist der Fall „Das Lumpenpack" von der Box. */
const VERSCHMOLZEN = 'Die drei ???'
/** Das lokale Werk, das die Vorschau ueber mpv abspielt. */
const LOKAL = 'Die Maus'
/** Die Playlist, deren Titel-Lane sich aufklappen laesst. Sie steht NICHT
 *  frei im Raster: „Bibi Blocksberg" und „Benjamin Bluemchen" haben denselben
 *  Interpreten, und ab zwei Werken baut die Startseite ein Regal. Wer das
 *  uebersieht, tippt ins Leere und haelt es fuer einen Befund — derselbe
 *  Stolperstein steht schon im Kopf von tools/raster-marke-schau.mjs. */
const PLAYLIST = 'Bibi Blocksberg'
const REGAL = 'Kiddinx'

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => console.log(`  ${String(n).padEnd(40)} ${w}`)

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
  console.log('\n  kein Browser gefunden — nichts gemessen\n')
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

/**
 * Einen Schalter der Vorschau umlegen — UND NACHSEHEN, OB ER ANGEKOMMEN IST.
 *
 * DAS `pruefe` IST DER GANZE GRUND FUER DIESE HUELLE. Der Umschalter der
 * Vorschau hat einen Auffangzweig: alles Unbekannte landet in `lage.spielt`.
 * Eine Vorschau, die von VOR diesen beiden neuen Lagen laeuft, quittiert
 * `/vorschau/nachlauf` also brav mit 200 — und spielt danach gar nichts mehr.
 * Beim ersten Anlauf dieser Messung ist genau das passiert: Sie meldete zwei
 * Befunde, und beide waren nur eine seit Stunden laufende Vorschau
 * ([veraltete-vorschau-meldet-falsches-rot]).
 * Ein Werkzeug, das das nicht bemerkt, meldet Rot fuer heilen Code.
 */
const stellen = async (was, pruefe) => {
  const a = await (await fetch(new URL(`/vorschau/${was}`, ZIEL))).json()
  if (pruefe && !pruefe(a.lage || {})) {
    melde(`die laufende Vorschau kennt /vorschau/${was} nicht — sie ist aelter als diese Messung. Erst neu starten.`)
    console.error('\n  ABGEBROCHEN: gegen eine veraltete Attrappe gemessen heisst nichts gemessen.\n')
    await brw.schliessen()
    await leihe.zurueckgeben()
    process.exit(PRUEFEN ? 1 : 0)
  }
  return a
}

/**
 * WER TRAEGT EINE MARKE — im Raster UND in der Lane, in EINEM Blick.
 *
 * Beides zusammen zu lesen ist der ganze Punkt: Seit dem Umbau teilen sich
 * Raster und Lane eine Entscheidung. Wer nur eine Seite liest, sieht einen
 * Widerspruch zwischen ihnen nie.
 *
 * (KEINE Rueckstriche und keine Backticks in diesem Block — er steht in einem
 *  Schablonenliteral.)
 */
const LESEN = `(() => {
  const text = (e, s) => ((e.querySelector(s) || {}).textContent || '').trim()
  return {
    raster: [...document.querySelectorAll('#raster > .kachel')]
      .filter((k) => k.classList.contains('spielt') || k.querySelector('.spielt-marke'))
      .map((k) => text(k, '.kachel-titel')),
    lane: [...document.querySelectorAll('.lane-kachel')]
      .filter((k) => k.classList.contains('spielt') || k.querySelector('.spielt-marke'))
      .map((k) => text(k, '.lane-titel')),
    // Alle tanzenden Figuren im ganzen Baum — die Zahl, um die es bei Punkt 3
    // geht. Gezaehlt werden die BALKEN, denn jeder ist eine eigene Animation.
    marken: document.querySelectorAll('.spielt-marke').length,
    balken: document.querySelectorAll('.spielt-marke svg rect').length,
    // OHNE DIESE ZWEI ZAHLEN IST EIN „— KEINE —" ZWEIDEUTIG: Es kann heissen
    // „richtig nichts markiert" oder „die Lane stand gar nicht offen". Der
    // erste Anlauf dieser Messung hat genau daran getaeuscht.
    laneKacheln: document.querySelectorAll('.lane-kachel').length,
    rasterKacheln: document.querySelectorAll('#raster > .kachel').length,
  }
})()`

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // ═══════════════════════════════════════════════════════════════════════
  //  1. VERSCHMOLZENES WERK, das ueber seine ZWEITE Quelle laeuft
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\nMARKE-GRENZFAELLE  (Vorschau, Fenster 800x480)\n')
  await stellen('voll')
  await stellen('verschmolzen-an')
  // ══ DER SCHALTER MUSS AUCH BEIM LESER ANKOMMEN — NICHT NUR IN DER LAGE ══
  //
  // GEMESSEN AM 31.08.2026 (im E95/V-Stufe-2-Lauf nachgestellt): Traegt die
  // geliehene Vorschau eine GESCHRIEBENE Darstellung (irgendwer hat ihr
  // einmal `PUT /api/darstellung` geschickt, DARSTELLUNG.geschrieben), dann
  // erreicht `/vorschau/verschmolzen-an` `/api/darstellung` nie mehr — die
  // Oberflaeche fragt ohne `verschmelzen=1`, „Die drei ???" bleibt zweimal
  // im Raster, und Fall 1 meldete hier ein Rot samt FALSCHER Ursache („der
  // Vergleich sieht nur quellen[0] an") fuer heilen Code. Der Schnappschuss
  // der Leihgabe kennt das Feld nicht, Zuruecklegen heilt es nicht. Dieselbe
  // Wache wie in tools/marke-tanzt.mjs: erst fragen, was der Leser WIRKLICH
  // serviert bekommt — sonst gilt „nichts gemessen", nicht „Befund".
  let dServiert = null
  try {
    dServiert = await (await fetch(new URL('/api/darstellung', ZIEL))).json()
  } catch {
    /* bleibt null und faellt gleich auf */
  }
  if (!dServiert || (dServiert.aktuell || {}).verschmelzen !== true) {
    melde('/vorschau/verschmolzen-an kommt bei /api/darstellung nicht an — die Vorschau traegt eine ' +
        'GESCHRIEBENE Darstellung (DARSTELLUNG.geschrieben); erst neu starten, dann messen.')
    console.error('\n  ABGEBROCHEN: gegen eine verstellte Attrappe gemessen heisst nichts gemessen.\n')
    await brw.schliessen()
    await leihe.zurueckgeben()
    process.exit(PRUEFEN ? 1 : 0)
  }
  await stellen('spotify')

  // DIE ERWARTUNG KOMMT AUS DER ATTRAPPE, nicht aus app.js: welches Werk
  // traegt die Spotify-Quelle, und steht sie wirklich NICHT an erster Stelle?
  // Ohne diese Frage vorweg prueft der Rest das Nichts.
  const werke = (await (await fetch(new URL('/api/werke?verschmelzen=1', ZIEL))).json()).werke
  const werk = werke.find((w) => w.titel === VERSCHMOLZEN)
  if (!werk) throw new Error(`„${VERSCHMOLZEN}" steht nicht in /api/werke — Vorschau geaendert?`)
  const dienste = (werk.quellen || []).map((q) => q.dienst)
  const spq = (werk.quellen || []).find((q) => q.dienst === 'spotify')
  zeile(`Quellen von „${VERSCHMOLZEN}"`, dienste.join(' + ') || '— KEINE —')
  if (dienste.length < 2) melde(`„${VERSCHMOLZEN}" ist nicht verschmolzen — der Fall wird gar nicht gestellt`)
  if (!spq) melde(`„${VERSCHMOLZEN}" hat keine Spotify-Quelle — der Fall wird gar nicht gestellt`)
  else if (dienste[0] === 'spotify') {
    melde('die Spotify-Quelle steht an ERSTER Stelle — dann ist es der bequeme Fall, nicht der gemeinte')
  }

  if (spq) {
    await stellen(`kontext-spotify:album:${spq.kennung}`, (l) => l.kontext === `spotify:album:${spq.kennung}`)
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(3500)
    const v = await ev(LESEN)
    zeile('Spotify spielt die zweite Quelle', v.raster.map((t) => `„${t}"`).join(', ') || '— KEINE Marke —')
    if (!v.raster.includes(VERSCHMOLZEN)) {
      melde(
        `„${VERSCHMOLZEN}" laeuft ueber seine Spotify-Quelle und traegt trotzdem keine Marke — ` +
          'der Vergleich sieht nur `quellen[0]` an',
      )
    }
    await stellen('kontext-standard')
  }
  await stellen('verschmolzen-aus')

  // ═══════════════════════════════════════════════════════════════════════
  //  1b. DER DOPPELTE SCHLUESSEL — markiert das Raster dann zu viel?
  // ═══════════════════════════════════════════════════════════════════════
  //
  // AUF DER BOX GEMESSEN, NICHT AUSGEDACHT: dieselbe `playlistid` steht dort
  // zweimal in data.json, einmal unter `music` und einmal unter `audiobook`
  // ([medienschluessel-kollision-gleiche-playlistid]). /api/werke liefert
  // deshalb ZWEI Werke mit demselben `schluessel`.
  //
  // DIE FRAGE IST NICHT AKADEMISCH: `laufendesWerkMitBeweis` gibt den ERSTEN
  // Treffer zurueck. Haenge die Marke an DIESEM Werk, markierte sie bei zwei
  // Zwillingen die falsche Kachel. Sie haengt aber an der KENNUNG, und die ist
  // der Schluessel — Zwillinge tragen also dieselbe, und welcher der beiden
  // gefunden wurde, ist gleichgueltig. Das ist gemessen und nicht geglaubt.
  await stellen('doppelt-an', (l) => l.doppelt === 'an')
  await stellen('spotify')
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(3500)
  const dopp = await ev(`(() => {
    const alle = [...document.querySelectorAll('#raster > .kachel')]
    return {
      // GENAU vergleichen, nicht per Teilzeichenkette: der erste Anlauf
      // zaehlte hier zwei Kacheln, weil werk|vorschau:1 auch in
      // werk|vorschau:10 steckt. Eine halbe Kennung darf nie treffen —
      // dieselbe Vorsicht, die stueckKennung in app.js im Kommentar traegt.
      // (Keine Backticks in diesem Block, er steht im Schablonenliteral.)
      gleicheKennung: alle.filter((k) => (k.dataset.spielt || '').split(' ').includes('werk|vorschau:1')).length,
      markiert: alle.filter((k) => k.classList.contains('spielt') || k.querySelector('.spielt-marke'))
        .map((k) => ((k.querySelector('.kachel-titel') || {}).textContent || '').trim()),
    }
  })()`)
  zeile('doppelter Schluessel: gleiche Kennung', `${dopp.gleicheKennung} Kachel(n) im Abschnitt`)
  zeile('doppelter Schluessel: markiert', dopp.markiert.map((t) => `„${t}"`).join(', ') || '— KEINE —')
  if (dopp.markiert.length !== 1) {
    melde(`${dopp.markiert.length} markierte Kacheln beim doppelten Schluessel statt genau einer`)
  }
  await stellen('doppelt-aus', (l) => l.doppelt === 'aus')

  // ═══════════════════════════════════════════════════════════════════════
  //  2. NACHLAUF — zwei Auskuenfte, die sich widersprechen
  // ═══════════════════════════════════════════════════════════════════════
  //
  // MPV SPIELT „Die Maus", angetippt von DIESER Seite. Spotify meldet dabei
  // seinen alten Zusammenhang und sein altes `item` weiter. Richtig ist die
  // LOKALE Auskunft (`jetztLaeuft` gibt lokal den Vorrang, Herkunft
  // now-playing.ts). Wer den Spotify-Zustand ungebremst liest, markiert einen
  // Titel, der nicht toent.
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(3000)
  await stellen('spielt')
  await warte(2500)
  const getippt = await ev(`(() => {
    const k = [...document.querySelectorAll('#raster > .kachel')]
      .find((e) => ((e.querySelector('.kachel-titel') || {}).textContent || '').trim() === ${JSON.stringify(LOKAL)})
    if (!k) return false
    k.click()
    return true
  })()`)
  if (!getippt) melde(`keine Raster-Kachel „${LOKAL}" — die Vorschau hat sich geaendert`)
  await warte(3000)

  // Und jetzt die Lane der Spotify-Playlist aufklappen, waehrend mpv spielt.
  // Der Play-Knopf der Kachel startet, ein Tipp auf die Kachel KLAPPT NUR AUF
  // — genau deshalb bleibt „Die Maus" dabei das Laufende.
  //
  // ERST INS REGAL: die Playlist steht nicht frei im Raster (siehe REGAL).
  const tippe = (titel) => `(() => {
    const k = [...document.querySelectorAll('#raster > .kachel')]
      .find((e) => ((e.querySelector('.kachel-titel') || {}).textContent || '').trim() === ${JSON.stringify('')} + ${JSON.stringify(titel)})
    if (!k) return false
    k.click()
    return true
  })()`
  const imRegal = await ev(tippe(REGAL))
  if (!imRegal) melde(`kein Regal „${REGAL}" im Raster — die Vorschau hat sich geaendert`)
  await warte(2000)
  const auf = await ev(tippe(PLAYLIST))
  if (!auf) melde(`keine Kachel „${PLAYLIST}" im Regal „${REGAL}" — die Lane laesst sich nicht oeffnen`)
  await warte(2500)
  // UND EINE EBENE TIEFER: die Titelliste des laufenden Albums. Die
  // Album-Kachel hat KEINE eigene Klasse (app.js baut sie als schlichtes
  // `lane-kachel`), nur die Titel-Kachel traegt `stueck` — der erste Anlauf
  // suchte `.lane-kachel.album`, fand nichts, klickte nichts, und die
  // Titel-Lane blieb still zu. Gezaehlt wurden danach zwei Marken statt drei.
  const tiefer = await ev(`(() => {
    const a = [...document.querySelectorAll('.lane-kachel')].find((e) => !e.classList.contains('stueck'))
    if (!a) return false
    a.click()
    return true
  })()`)
  if (!tiefer) melde('keine Album-Kachel in der Lane — die Titelliste liess sich nicht aufklappen')
  await warte(3000)
  const stuecke = await ev(`document.querySelectorAll('.lane-kachel.stueck').length`)
  if (!stuecke) melde('die Titelliste steht nicht offen — der tiefste Fall wurde nicht gestellt')

  // DER SCHALTER MUSS ANKOMMEN — und er muss auch WIRKEN: /player/state hat
  // dabei einen `context` UND ein `item` zu tragen, sonst gibt es gar nichts
  // zu verwechseln und die Messung liefe ins Leere.
  await stellen('nachlauf', (l) => l.spielt === 'nachlauf')
  const roh = await (await fetch(new URL('/player/state', ZIEL))).json()
  const rohLokal = await (await fetch(new URL('/player/local', ZIEL))).json()
  zeile('Nachlauf: /player/state', `${roh?.context?.uri || '— ohne context —'} / ${roh?.item?.uri || '— ohne item —'}`)
  zeile(
    'Nachlauf: /player/local',
    rohLokal?.playing ? `mpv spielt „${rohLokal.currentTrackname}"` : '— mpv spielt NICHT —',
  )
  if (!roh?.context?.uri || !roh?.item?.uri)
    melde('die Vorschau traegt im Nachlauf keinen Spotify-Zustand — der Widerspruch wird nicht gestellt')
  if (!rohLokal?.playing) melde('mpv spielt im Nachlauf nicht — der Widerspruch wird nicht gestellt')
  await warte(3000)
  const nach = await ev(LESEN)
  zeile('Nachlauf: Kacheln Raster / Lane', `${nach.rasterKacheln} / ${nach.laneKacheln}`)
  if (!nach.laneKacheln) melde('die Lane stand beim Nachlauf gar nicht offen — der Fall wurde nicht gestellt')
  zeile('Nachlauf: markiert im Raster', nach.raster.map((t) => `„${t}"`).join(', ') || '— KEINE —')
  zeile('Nachlauf: markiert in der Lane', nach.lane.map((t) => `„${t}"`).join(', ') || '— KEINE —')
  if (nach.lane.length) {
    melde(
      `die Lane markiert „${nach.lane.join('", „')}" als laufend, obwohl mpv „${LOKAL}" spielt — ` +
        'die Stueck-Kennung fragt nicht, welche Maschine den Ton macht',
    )
  }
  if (nach.raster.some((t) => t !== LOKAL)) {
    melde(`im Raster markiert: ${nach.raster.join(', ')} — laufen tut „${LOKAL}"`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  3. WIE VIELE MARKEN TANZEN GLEICHZEITIG
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Der schlimmste Fall, den die Oberflaeche heute stellen kann: Spotify
  // spielt, die Lane der laufenden Playlist steht offen, und ein Album darin
  // ist aufgeklappt. Dann tragen Regal, Album-Kachel und Titel-Kachel je eine.
  await stellen('spotify')
  await warte(3000)
  const viele = await ev(LESEN)
  zeile('Marken gleichzeitig (Lane offen)', String(viele.marken))
  zeile('… tanzende Balken', String(viele.balken))
  zeile('… davon im Raster', viele.raster.map((t) => `„${t}"`).join(', ') || '—')
  zeile('… davon in der Lane', viele.lane.map((t) => `„${t}"`).join(', ') || '—')
  // DIE ZAHL IST KEIN FEHLER, SIE IST EIN MASS. Gemeldet wird erst, wenn der
  // Kommentar in app.css („nie mehr als eine oder zwei") deutlich daneben
  // liegt — vier Marken sind zwoelf Animationen, und das ist die Groessenordnung,
  // ab der es auf einem Pi eine Frage wird.
  if (viele.marken > 6)
    melde(`${viele.marken} Marken gleichzeitig (${viele.balken} Animationen) — das ist keine „eine oder zwei" mehr`)

  // ═══════════════════════════════════════════════════════════════════════
  //  4. DER LAUFENDE TITEL GEHOERT ZU KEINEM GANZEN ALBUM
  // ═══════════════════════════════════════════════════════════════════════
  //
  // DER FALL, DEN ALLE BISHERIGEN MESSUNGEN AUSGELASSEN HABEN — und der an
  // der Box am 03.08.2026 aufschlug: „nun sind die indikatoren bei album und
  // titel weg ich wollte ja alles". Die Playlist „EMMA6 - Complete" beginnt
  // mit zwoelf einzelnen Titeln, die zu keinem ganzen Album gehoeren; die Box
  // spielte einen davon. Das Raster trug die Marke, Album- und Titel-Lane
  // trugen keine.
  //
  // DER VERGLEICH WAR NICHT SCHULD. Er stimmte an allen drei Orten, gemessen
  // mit den echten Antworten der Box (tools/marke-am-geraet.mjs). Es gab in
  // der Album-Lane nur GAR KEINE KACHEL, die eine Marke haette tragen koennen:
  // dort stand fuer die losen Titel ein blosser Satz. Seitdem sammelt sie eine
  // Kachel „Einzelne Titel", und die verhaelt sich wie jedes andere Album.
  //
  // ALLE DREI MARKEN-WERKZEUGE WAREN HIER BLIND, und zwar auf dieselbe Weise:
  // Sie spielten immer einen Titel AUS EINEM ALBUM. Eine Pruefung, die eine
  // ganze Sorte von Titel nie stellt, laesst deren Regression durch.
  const EINZELNE = 'Einzelne Titel'
  const LOSER = 'Introsong'
  await stellen('spotify-lose', (l) => l.spielt === 'spotify' && l.spotifyTitel === 3)
  // Die offene Titelliste gehoert noch zum ersten Album — sie zumachen, sonst
  // misst man ihre (richtige) Leere und haelt sie fuer den Befund.
  await ev(`(() => {
    const a = [...document.querySelectorAll('.lane-kachel.auf')].find(Boolean)
    if (a) a.click()
    return true
  })()`)
  await warte(3000)
  const los = await ev(LESEN)
  zeile('loser Titel: Kacheln Raster / Lane', `${los.rasterKacheln} / ${los.laneKacheln}`)
  if (!los.laneKacheln) melde('die Album-Lane stand nicht offen — der Fall wurde nicht gestellt')
  zeile('loser Titel: markiert im Raster', los.raster.map((t) => `„${t}"`).join(', ') || '— KEINE —')
  zeile('loser Titel: markiert in der Lane', los.lane.map((t) => `„${t}"`).join(', ') || '— KEINE —')
  if (!los.raster.length) melde('das Raster markiert nichts, obwohl Spotify einen Titel der Playlist spielt')
  if (!los.lane.includes(EINZELNE)) {
    melde(`die Album-Lane markiert „${EINZELNE}" nicht — ein loser Titel hat dort wieder keine Kachel`)
  }
  // Und eine Ebene tiefer: die Titel-Lane der Sammelkachel.
  const auf3 = await ev(`(() => {
    const k = [...document.querySelectorAll('.lane-kachel')]
      .find((e) => ((e.querySelector('.lane-titel') || {}).textContent || '').trim() === ${JSON.stringify(EINZELNE)})
    if (!k) return false
    k.click()
    return true
  })()`)
  if (!auf3) melde(`keine Kachel „${EINZELNE}" in der Album-Lane`)
  await warte(3000)
  const tief3 = await ev(LESEN)
  zeile('loser Titel: markiert in der Titel-Lane', tief3.lane.map((t) => `„${t}"`).join(', ') || '— KEINE —')
  const stuecke3 = await ev(`document.querySelectorAll('.lane-kachel.stueck').length`)
  zeile('loser Titel: Titelkacheln', String(stuecke3))
  if (!stuecke3) melde(`die Titel-Lane von „${EINZELNE}" steht nicht offen`)
  if (!tief3.lane.includes(LOSER)) melde(`die Titel-Lane markiert „${LOSER}" nicht — die dritte Ebene bleibt stumm`)

  console.log(fehler ? `\n  ${fehler} Abweichung(en).\n` : '\n  keine Abweichung.\n')
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

if (PRUEFEN && fehler) process.exit(1)
