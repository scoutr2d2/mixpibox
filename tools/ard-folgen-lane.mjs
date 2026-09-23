#!/usr/bin/env node
/**
 * LOEST EINE ARD-SENDUNG AUF EINZELNE FOLGEN AUF — und landet eine angehoerte
 * Folge im Weiterhoeren?
 *
 * ── DIE MELDUNG, DIE DIESES WERKZEUG AUSGELOEST HAT (05.08.2026) ───────────
 * Der Benutzer hat die ARD auf der Box .169 benutzt:
 *
 *     „ard sounds zeigt nur alben loest aber nicht auf einzelne tracks,
 *      die angespielten tracks landen nicht in weiterhoeren"
 *
 * Beides ging auf EINE Ursache zurueck, und es war kein Fehler, sondern ein
 * fehlender ANSCHLUSS: `/api/werke/<s>/inhalt` loest eine Sendung seit dem
 * 04.08.2026 in Folgen auf — benutzt hat das nur `albumSpielen`, um ALLES am
 * Stueck abzuspielen.
 *
 * ── WARUM DIE VORHANDENEN WERKZEUGE DAS NICHT SEHEN ───────────────────────
 * `kachel-spielt-je-dienst` fragt „kommt ueberhaupt ein Startbefehl?" — die
 * Antwort war JA, seit dem 04.08. Die Frage HIER ist eine andere: kommt der
 * Befehl der Folge, die man angetippt hat? `lane-marken-schau` und
 * `raster-marke-schau` sehen Zeichen und Farben, nicht Ziele.
 *
 * ── WAS ES PRUEFT, in vier Faellen ────────────────────────────────────────
 * SEIT E95/V STUFE 2 (31.08.2026) WIRD DER WUNSCH GEMESSEN, NICHT DER BEFEHL:
 * Die Seite schickt fuer jeden Abspielwunsch genau EINEN `POST /api/spielen`
 * — Startbefehl, Warteschlange und Sprung baut der SERVER. Was frueher hier
 * an der /player-Leitung stand (1x ard/ + 13x ardqueue/ + tracknr/seekpos),
 * prueft jetzt src/backend-api/src/spielen.integration.spec.ts. Hier bleibt
 * die Frage, die nur die Oberflaeche beantworten kann: TRAEGT der Wunsch die
 * richtige Folge, die richtige Nummer und die Stelle in der richtigen EINHEIT?
 *
 *   lane        Ein Tipp auf die ARD-Kachel klappt die FOLGEN auf (und
 *               schickt weder Spielerbefehl noch Spielwunsch).
 *   folge       Ein Tipp auf Folge 3 schickt EINEN Wunsch mit `folge` =
 *               Kennung GENAU DIESER Folge und `titelNr` = ihrer Nummer —
 *               die Nummer ist der Schiedsrichter, wenn die Kennung nicht
 *               mehr trifft (die Liste der Audiothek ROLLT, llmwiki
 *               ard-folgenliste-rollt).
 *   blau        Die Folge MIT gemerkter Stelle traegt einen blauen Knopf, und
 *               nur sie. Sein Wunsch traegt `folge` und `positionProzent` —
 *               PROZENT, und AUSDRUECKLICH KEIN `positionMs`: mpv rechnet in
 *               Prozent und nimmt alles ueber 100 als „ans Ende". Diese
 *               Wahrheit bleibt am POST-Rumpf messbar.
 *   reihe       Die Weiterhoeren-Reihe oben schickt denselben Wunsch wieder —
 *               mit `ausStelle` (bei rollender Liste darf der Server auf die
 *               wiedergefundene Folge ausweichen) und `gemerktBei` (in WESSEN
 *               Liste die Zahlen entstanden sind).
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs, nur
 * gelesen und getippt. Weder die Box noch Dateien werden angefasst.
 *
 * AUFRUF
 *     node tools/ard-folgen-lane.mjs             # Tabelle
 *     node tools/ard-folgen-lane.mjs --pruefen   # Ende 1 bei Befund
 *
 * GEMESSEN AM 05.08.2026 (Vorschau, Chromium 800x480), nach dem Bau — die
 * alte Form, als die Seite die Befehle noch selbst baute:
 *     lane    14 Folgen-Kacheln, 0 Befehle beim Oeffnen
 *     folge   1x ard/ + 13x ardqueue/ + tracknr:3
 *     blau    genau 1 blauer Knopf (Folge 2)  ->  tracknr:2  seekpos:41.5
 *     reihe   1x ard/ + 13x ardqueue/ + tracknr:2  seekpos:41.5
 *
 * UND VORHER, mit demselben Aufruf (die Meldung des Benutzers):
 *     lane    0 Folgen-Kacheln, 15 Befehle beim Oeffnen — ein Tipp startete
 *             die GANZE Sendung, und einzelne Folgen gab es gar nicht
 *
 * GEMESSEN AM 31.08.2026 (E95/V Stufe 2, dieselbe Vorschau):
 *     folge   Wunsch {folge:"16600002", titelNr:3}, 0 Spielerbefehle
 *     blau    Wunsch {folge:"16600001", positionProzent:41.5}, KEIN positionMs
 *     reihe   Wunsch mit ausStelle:true, gemerktBei:"ard", positionProzent:41.5
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const zeig = PRUEFEN ? () => {} : console.log

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT: dieses
// Werkzeug stellt `verlauf-ard`, und die Reihenfolge der Weiterhoeren-Reihe
// gehoert dem, der die Vorschau vorher hatte. Laeuft keine, startet die
// Leihgabe selbst eine auf dem Port des Ziels. Und der eigene Browser laeuft
// auf einem FREIEN Port mit eigenem Profil statt auf der festen 9351, die ein
// Ueberlebender eines harten Abbruchs noch halten koennte — /json/list
// lieferte dann klaglos die Ziele des fremden.
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
let id = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++id
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

const befunde = []
const merk = (fall, gut, text) => {
  befunde.push({ fall, gut, text })
  if (!gut) console.error(`FEHLT: ${fall} — ${text}`)
}

try {
  // Warten muss hier niemand mehr: eigenerBrowser() kehrt erst zurueck, wenn
  // eine Seite da ist UND der Port nachweislich dem eigenen Browser gehoert.
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  const konsole = []
  ws.on('message', (r) => {
    const x = JSON.parse(r)
    if (x.method === 'Runtime.consoleAPICalled' && (x.params.type === 'error' || x.params.type === 'warning')) {
      konsole.push(`${x.params.type}: ${(x.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`)
    }
    if (x.method === 'Runtime.exceptionThrown') {
      konsole.push(`ausnahme: ${x.params.exceptionDetails?.exception?.description || x.params.exceptionDetails?.text}`)
    }
  })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // ZWEI LEITUNGEN, EIN MITLESER (E95/V Stufe 2, 31.08.2026, Vorbild
  // tools/kachel-spielt-je-dienst.mjs): Die alte /player-Leitung wird WEITER
  // gelesen — an der Zahl der Abschnitte erkannt, nicht an einer Namensliste
  // (Begruendung dort) —, denn ein Rueckfall der Seite auf selbstgebaute
  // Befehle waere hier ein Befund. Dazu kommt der Spielfunktions-Wunsch:
  // `POST /api/spielen` samt RUMPF, denn nur im Rumpf steht, WELCHE Folge und
  // WELCHE Stelle die Seite bestellt.
  //
  // DIE BREMSE (`window.__bremse`) IST WEG, UND MIT IHR IHR GRUND: Sie
  // streckte die client-seitige Anhaeng-Schleife (30 Befehle ueber WLAN), um
  // den Fall „fremder Tipp MITTEN in der Schleife" stellen zu koennen. Seit
  // E95/V gibt es diese Schleife in der Seite nicht mehr — Warteschlange und
  // Sprung baut der Server, und dass ein SPAETER Sprung keine fremde
  // Warteschlange mehr treffen darf (409/abgeloest), prueft
  // src/backend-api/src/spielen.integration.spec.ts. Siehe Fall „nachzuegler".
  const mitlesen = `window.__befehle = []; window.__wuensche = [];
    if (!window.__mitgelesen) { window.__mitgelesen = true;
      const alt = window.fetch;
      window.fetch = function (u) {
        try {
          const s = String(u && u.url ? u.url : u);
          const m = /\\/player\\/([^/?#]+)\\/(.+)$/.exec(s);
          if (m) window.__befehle.push(m[2]);
          if (/\\/api\\/spielen$/.test(s)) {
            let w = null;
            try { w = JSON.parse((arguments[1] || {}).body || '{}') } catch {}
            window.__wuensche.push(w || {});
          }
        } catch {}
        return alt.apply(this, arguments)
      } }
    true`

  /** Die ARD-Kachel im Raster — ueber den DIENST, nicht ueber einen Titel:
   *  wer die Vorschau umbenennt, soll dieses Werkzeug nicht stillegen. */
  const werke = (await (await fetch(new URL('/api/werke', ZIEL))).json()).werke || []
  const ardWerk = werke.find((w) => (w.quellen || []).some((q) => q && q.dienst === 'ard'))
  if (!ardWerk) {
    console.error('FEHLT: tools/neu-vorschau.mjs fuehrt kein Werk mit dienst ard — hier wird nichts gemessen')
    process.exit(1)
  }
  const suchen = `(() => {
      const raus = document.getElementById('zurueck')
      if (raus && !raus.disabled) raus.click()
      const suche = () => [...document.querySelectorAll('#raster .kachel')]
        .find((k) => (k.querySelector('.kachel-titel') || {}).textContent === ${JSON.stringify(String(ardWerk.titel))})
      let k = suche()
      if (!k) {
        for (const r of [...document.querySelectorAll('#raster .kachel')]) {
          if (!r.querySelector('.regal-zahl')) continue
          r.click(); k = suche(); if (k) break
        }
      }
      return k })()`

  const frisch = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1600)
    await ev(mitlesen)
    konsole.length = 0
  }
  const befehle = async () => (await ev('window.__befehle')) || []
  const wuensche = async () => (await ev('window.__wuensche')) || []
  const meldung = async () =>
    await ev(`((document.querySelector('#meldung, .meldung') || {}).textContent || '').trim() || null`)

  // DIE ERWARTUNG KOMMT AUS DER ATTRAPPE, NICHT AUS app.js: `/inhalt` sagt
  // selbst, welche Kennung Folge 3 traegt und an welcher Folge die gemerkte
  // Stelle haengt (`weiterAb`). Wer die Erwartung aus der Oberflaeche liest,
  // prueft seine eigene Vermutung.
  const inhalt = await (
    await fetch(new URL(`/api/werke/${encodeURIComponent(ardWerk.schluessel)}/inhalt`, ZIEL))
  ).json()
  const folgenSoll = Array.isArray(inhalt.titel) ? inhalt.titel : []
  const stelleSoll = folgenSoll.find((t) => t && t.weiterAb)
  if (folgenSoll.length < 3 || !stelleSoll) {
    console.error('FEHLT: /inhalt der Vorschau traegt keine drei Folgen samt weiterAb — hier wird das Nichts gemessen')
    process.exit(1)
  }
  /** Ein Wunsch in einer Zeile, fuer die Meldungen. */
  const kurz = (w) => (w ? JSON.stringify(w) : '(keiner)')

  // ── FALL „lane": ein Tipp OEFFNET, er spielt nicht ──────────────────────
  await frisch()
  await ev(`(() => { const k = ${suchen}; if (k) k.click(); return true })()`)
  await warte(1800)
  const folgen = await ev(`document.querySelectorAll('#raster .lane .lane-kachel.stueck').length`)
  const beimOeffnen = await befehle()
  const wuenscheBeimOeffnen = await wuensche()
  merk(
    'lane',
    folgen > 0 && beimOeffnen.length === 0 && wuenscheBeimOeffnen.length === 0,
    `${folgen} Folgen-Kacheln, ${beimOeffnen.length} Befehle, ${wuenscheBeimOeffnen.length} Wuensche beim Oeffnen` +
      (beimOeffnen.length || wuenscheBeimOeffnen.length ? ` — ein Tipp soll OEFFNEN, nicht starten` : ''),
  )

  // ── FALL „folge": Tipp auf Folge 3 ─────────────────────────────────────
  // Die Kachel selbst, nicht ihr Knopf: Titelkacheln haben nur dann einen,
  // wenn dort eine Stelle gemerkt ist (dann ist er BLAU, siehe Fall „blau").
  //
  // SEIT E95/V STUFE 2 (31.08.2026) IST DIE ERWARTUNG DER WUNSCH: genau EIN
  // `POST /api/spielen` mit der KENNUNG dieser Folge (`folge`) und ihrer
  // NUMMER (`titelNr`, der Schiedsrichter bei rollender Liste) — und KEIN
  // selbstgebauter Spielerbefehl mehr. Die alte Wahrheit „1x ard/ +
  // (folgen-1)x ardqueue/ + tracknr:3 — die Warteschlange MUSS die ganze
  // Sendung sein, sonst zaehlt mpv falsch (llmwiki ard-folgenliste-rollt)"
  // ist mit dem Befehlsbau in den Server gezogen:
  // src/backend-api/src/spielen.integration.spec.ts prueft sie dort.
  await ev(
    `(() => { const k = [...document.querySelectorAll('#raster .lane .lane-kachel.stueck')][2];
       if (k) k.click(); return true })()`,
  )
  await warte(3500)
  const nachFolge = await befehle()
  const folgeWuensche = await wuensche()
  const w3 = folgeWuensche[0] || null
  const dritte = folgenSoll[2]
  merk(
    'folge',
    folgeWuensche.length === 1 &&
      nachFolge.length === 0 &&
      !!w3 &&
      w3.schluessel === ardWerk.schluessel &&
      w3.folge === String(dritte.id) &&
      Number(w3.titelNr) === Number(dritte.nr),
    `${folgeWuensche.length} Wunsch/Wuensche ${kurz(w3)}, ${nachFolge.length} Spielerbefehle — ` +
      `erwartet genau einer mit folge:"${dritte.id}" und titelNr:${dritte.nr}`,
  )

  // ── FALL „blau": genau EINE Folge traegt die gemerkte Stelle ───────────
  //
  // DIE EINHEIT BLEIBT MESSBAR — AM RUMPF (E95/V Stufe 2, 31.08.2026): Der
  // blaue Knopf einer ARD-Folge schickt `positionProzent`, und der Wunsch
  // darf AUSDRUECKLICH KEIN `positionMs` tragen. Frueher stand dieselbe
  // Wahrheit am Befehl (`seekpos:41.5`, nie vierstellig): mpv rechnet in
  // Prozent und nimmt alles ueber 100 als „ans Ende" (llmwiki
  // resume-lokal-ist-prozent-nicht-sekunden). Was der Server DARAUS baut,
  // prueft src/backend-api/src/spielen.integration.spec.ts.
  await frisch()
  await ev(`(() => { const k = ${suchen}; if (k) k.click(); return true })()`)
  await warte(1800)
  const blaue = await ev(
    `[...document.querySelectorAll('#raster .lane .lane-kachel.stueck .tipp-spiel.weiter')]
       .map((k) => (k.closest('.lane-kachel').querySelector('.lane-titel') || {}).textContent || '')`,
  )
  await ev(
    `(() => { const k = document.querySelector('#raster .lane .lane-kachel.stueck .tipp-spiel.weiter');
       if (k) k.click(); return true })()`,
  )
  await warte(4000)
  const nachBlau = await befehle()
  const blauWuensche = await wuensche()
  const wb = blauWuensche[0] || null
  const blauFolgeSoll = String((stelleSoll.weiterAb || {}).folge || stelleSoll.id)
  const wbProzent = wb ? Number(wb.positionProzent) : 0
  merk(
    'blau',
    (blaue || []).length === 1 &&
      blauWuensche.length === 1 &&
      nachBlau.length === 0 &&
      !!wb &&
      wb.folge === blauFolgeSoll &&
      wbProzent > 0 &&
      wbProzent <= 100 &&
      !Object.hasOwn(wb, 'positionMs'),
    `${(blaue || []).length} blaue Knoepfe (${(blaue || []).join(', ') || '—'}), Wunsch ${kurz(wb)}, ` +
      `${nachBlau.length} Spielerbefehle — erwartet folge:"${blauFolgeSoll}" mit positionProzent (0..100) ` +
      'und OHNE positionMs',
  )

  // ── FALL „reihe": die Weiterhoeren-Reihe startet dieselbe Folge ────────
  //
  // DIE ZEILE MUSS ERST NACH VORN GEHOLT WERDEN. Die Vorschau fuehrt sechs
  // gemerkte Stellen und einen Deckel von sechs; drei davon fuehren auf nichts
  // (der Fall von der Box), die ARD-Zeile faellt darum hinten heraus. Das ist
  // die Vorgabe und soll es bleiben — sonst verloere ein anderes Werkzeug
  // seine Zeile. `verlauf-ard` gibt ihr den juengsten Zeitpunkt.
  await fetch(new URL('/vorschau/verlauf-ard', ZIEL))
  await frisch()
  const getippt = await ev(
    `(() => { const k = [...document.querySelectorAll('#weiter-reihe .weiter-kachel')]
        .find((x) => ((x.querySelector('.weiter-titel') || {}).textContent || '')
          .includes(${JSON.stringify(String(ardWerk.titel))}))
       if (!k) return null; k.click(); return true })()`,
  )
  await warte(5000)
  const nachReihe = await befehle()
  const reiheWuensche = await wuensche()
  const wr = reiheWuensche[0] || null
  // `positionMs` DARF hier stehen, aber nur als 0: `weiterSpielen` schickt
  // immer alle drei Zahlenfelder, und die Verlaufszeile einer ARD-Folge
  // traegt ihre Stelle in PROZENT. Truege positionMs den Wert, waere die
  // Einheit vertauscht — derselbe Fehler, den Fall „blau" streng prueft.
  const wrProzent = wr ? Number(wr.positionProzent) : 0
  merk(
    'reihe',
    !!getippt &&
      reiheWuensche.length === 1 &&
      nachReihe.length === 0 &&
      !!wr &&
      wr.schluessel === ardWerk.schluessel &&
      wr.folge === blauFolgeSoll &&
      wrProzent > 0 &&
      wrProzent <= 100 &&
      !(Number(wr.positionMs) > 0) &&
      wr.ausStelle === true &&
      wr.gemerktBei === 'ard',
    getippt
      ? `Wunsch ${kurz(wr)}, ${nachReihe.length} Spielerbefehle — erwartet folge:"${blauFolgeSoll}" ` +
          'mit positionProzent (0..100), positionMs hoechstens 0, ausStelle:true, gemerktBei:"ard"'
      : 'keine ARD-Kachel in der Weiterhoeren-Reihe — fuehrt tools/neu-vorschau.mjs dort eine ard-Zeile?',
  )

  // ── FALL „nachzuegler": zwei schnelle Tipps, zwei saubere Wuensche ──────
  //
  // WAS HIER GESTELLT WIRD: Ein Kind tippt „weiterhören" auf einer ARD-Folge
  // und GLEICH DANACH eine andere Kachel an.
  //
  // WAS DER FALL FRUEHER MASS — UND WO DIESE WAHRHEIT HEUTE WOHNT (E95/V
  // Stufe 2, 31.08.2026): `ardSendungAb` startete die Sendung als
  // client-seitige Schleife (ein Befehl je Folge, per `__bremse` auf
  // WLAN-Tempo gestreckt) und sprang HINTERHER mit `tracknr:`/`seekpos:`.
  // Ein Sprung nach dem fremden Tipp traf dann eine Warteschlange, die
  // inzwischen einem anderen Werk gehoerte — Kapitel 8 des falschen
  // Hoerspiels, mitten hinein, ohne Fehlermeldung. Diese Schleife gibt es in
  // der Seite NICHT MEHR; das Rennen zwischen Sprung und Abloesung liegt im
  // Server (Startlauf/409 „abgeloest") und wird dort geprueft:
  // src/backend-api/src/spielen.integration.spec.ts.
  //
  // WAS DIE OBERFLAECHE NOCH FALSCH MACHEN KANN, und deshalb hier bleibt:
  //   * ein Tipp koennte doch wieder eigene `tracknr:`/`seekpos:`-Befehle
  //     hinterherschicken (Rueckfall in den Alt-Weg) — dann gilt das Rennen
  //     wieder client-seitig, wo es niemand mehr prueft;
  //   * die zwei Wuensche koennten sich vermischen (der zweite Tipp muss den
  //     SCHLUESSEL DES FREMDEN Werks tragen, nicht den der Sendung).
  const fremd = werke.find(
    (w) => w && w.dienst === 'lokal' && w.art === 'album' && String(w.titel) !== String(ardWerk.titel),
  )
  if (!fremd) {
    merk('nachzuegler', false, 'kein lokales Album in der Vorschau — der fremde Tipp ist nicht zu stellen')
  } else {
    await fetch(new URL('/vorschau/verlauf-ard', ZIEL))
    await frisch()
    await ev(`(() => { const k = ${suchen}; if (k) k.click(); return true })()`)
    await warte(1800)
    await ev(mitlesen)
    await ev(
      `(() => { const k = document.querySelector('#raster .lane .lane-kachel.stueck .tipp-spiel.weiter');
         if (k) k.click(); return true })()`,
    )
    // SOFORT hinterher, nicht nach der Quittung: der zweite Tipp soll den
    // ersten Wunsch ueberholen wollen — genau die Lage, die der Server
    // schlichten muss.
    await warte(150)
    // UEBER DEN PLAY-KNOPF, WO ES EINEN GIBT — nachgezogen am 31.08.2026
    // (E112). Das fremde Werk ist ein lokales ALBUM, und eine Album-Kachel
    // klappt seit E112 ihre TITEL auf, statt zu starten; den Start traegt ihr
    // eigener Play-Knopf (wie bei Playlist und ARD schon vorher). Ohne diese
    // Zeile tippte dieser Fall auf „Titel zeigen", bekaeme keinen zweiten
    // Wunsch und meldete den Umbau als Fehler — er misst aber das RENNEN
    // ZWEIER WUENSCHE und nicht, welcher Weg zum Ton fuehrt.
    const dazwischen = await ev(
      `(() => { const k = [...document.querySelectorAll('#raster .kachel')]
           .find((x) => (x.querySelector('.kachel-titel') || {}).textContent === ${JSON.stringify(String(fremd.titel))})
         if (!k) return null
         const knopf = k.querySelector('.tipp-spiel')
         ;(knopf || k).click()
         return true })()`,
    )
    await warte(4000)
    const alle = await befehle()
    const beide = await wuensche()
    const spaeteSpruenge = alle.filter((b) => b.startsWith('tracknr:') || b.startsWith('seekpos:'))
    const erster = beide[0] || null
    const letzter = beide[beide.length - 1] || null
    merk(
      'nachzuegler',
      dazwischen !== null &&
        spaeteSpruenge.length === 0 &&
        beide.length === 2 &&
        !!erster &&
        erster.schluessel === ardWerk.schluessel &&
        !!letzter &&
        letzter.schluessel === fremd.schluessel,
      dazwischen === null
        ? `keine Kachel „${fremd.titel}" im Raster — der fremde Tipp ging nicht hinaus`
        : `${beide.length} Wuensche (${beide.map((w) => (w || {}).schluessel).join(' -> ') || '—'}), ` +
            `${spaeteSpruenge.length} eigene Spruenge (${spaeteSpruenge.join(' ') || '—'}) — ` +
            `erwartet erst „${ardWerk.schluessel}", dann „${fremd.schluessel}", und keinen client-gebauten Sprung`,
    )
  }

  const laut = [...konsole]
  merk('konsole', laut.length === 0, laut.length ? laut.join(' | ') : 'nichts')

  zeig(`\n  Vorschau: ${ZIEL}   Sendung: „${ardWerk.titel}"\n`)
  const breite = Math.max(...befunde.map((b) => b.fall.length))
  for (const b of befunde) zeig(`    ${b.gut ? 'ok   ' : 'FEHLT'} ${b.fall.padEnd(breite)}  ${b.text}`)
  const letzteMeldung = await meldung()
  if (letzteMeldung) zeig(`\n    Meldung auf dem Schirm: „${letzteMeldung}"`)
  zeig('')
} finally {
  // DIE LAGE ZURUECKLEGEN, falls die Vorschau jemand anderem gehoert. Sie
  // laeuft dann weiter, und `verlauf-ard` stehenzulassen hiesse, dem naechsten
  // Werkzeug eine andere Weiterhoeren-Reihe unterzuschieben, als es erwartet.
  // Die Leihe legt den GANZEN vorgefundenen Stand wieder hin — praeziser als
  // das fruehere pauschale Zurueckstellen auf `verlauf-voll`.
  await brw.schliessen()
  await leihe.zurueckgeben()
}

const schlecht = befunde.filter((b) => !b.gut).length
if (!schlecht) zeig(`geprueft: ${befunde.length} Faelle, die ARD loest auf einzelne Folgen auf`)
process.exit(schlecht ? 1 : 0)
