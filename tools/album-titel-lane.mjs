#!/usr/bin/env node
/**
 * KLAPPT EINE ALBUM-KACHEL AUF, UND SAGT JEDER TITEL, WOHER ER KOMMT? (E112)
 *
 * ── DIE MELDUNG, DIE DIESES WERKZEUG AUSGELOEST HAT (31.08.2026) ───────────
 * Der Betreiber an der Box:
 *
 *     „ich kann auch die alben nicht mehr aufklappen und die titel sehen"
 *     „was ich auch irritierend finde das nicht alle titel da sind ich hätte
 *      erwartet es gemischt zu sehen lokal und spotify"
 *
 * Zwei Saetze, zwei Luecken, und beide waren KEINE Regression:
 *
 *   1. Die Weiche in `kachelBauen` liess nur Spotify-Playlisten und
 *      ARD-Sendungen aufklappen (`istPlaylist || istArdSendung`); ein Album
 *      spielte beim Tippen sofort. Seine Titel gab es nur ueber Umwege. Das
 *      war erklaerbar, solange Album- und Playlist-Kacheln verschieden
 *      AUSSAHEN — seit sie verschmolzen sind, sehen zwei gleiche Kacheln
 *      Verschiedenes tun.
 *   2. Die Herkunft je Titel liefert der Server seit E108 mit (`quelle`,
 *      `quellen` an jedem Titel von `/api/werke/<s>/inhalt`, titelkarte.ts).
 *      Gelesen hat sie bis dahin nur die Plakette am Player-Cover — also erst,
 *      WAEHREND etwas laeuft. Dort, wo man auswaehlt, stand nichts.
 *
 * ── WARUM DIE VORHANDENEN WERKZEUGE DAS NICHT SEHEN ───────────────────────
 * `tools/quellen-plakette-schau.mjs` misst die EINE Plakette am Player und
 * damit die laufende Wiedergabe. `tools/ard-folgen-lane.mjs` misst eine Lane,
 * die es schon gab (die Folgen einer Sendung), und keine Plaketten.
 * `tools/kachel-spielt-je-dienst.mjs` fragt „kommt ein Startbefehl?" — und
 * genau das ist hier die FALSCHE Antwort: eine Album-Kachel soll auf einen
 * Tipp nichts mehr starten.
 *
 * ── WAS ES PRUEFT, in sechs Faellen ───────────────────────────────────────
 *
 *   oeffnen    Ein Tipp auf eine ALBUM-Kachel des Rasters klappt eine Lane
 *              mit Titel-Kacheln auf — und schickt dabei WEDER einen
 *              Spielwunsch NOCH einen /player-Befehl.
 *   knopf      Die Kachel traegt einen Play-Knopf, und der schickt genau
 *              EINEN Wunsch mit dem Schluessel dieses Werks, ohne die Lane
 *              zu oeffnen. Sonst waere „Ton" einen Tipp weiter weg als
 *              vorher — das ist der Preis, den das Aufklappen nicht kosten
 *              darf.
 *   plaketten  JEDE Titel-Kachel traegt genau die Dienste, die der SERVER zu
 *              diesem Titel nennt, in der Reihenfolge „geltende zuerst" — und
 *              genau die NICHT geltenden tragen `.marke-nebenher`. Die
 *              Erwartung kommt aus `/inhalt`, nicht aus app.js: wer sie aus
 *              der Oberflaeche liest, prueft seine eigene Vermutung.
 *   gemischt   Mindestens ein Titel hat WIRKLICH zwei Quellen. Ohne diesen
 *              Fall waere „alle Plaketten stimmen" die Aussage „eine Plakette
 *              je Titel stimmt" — und der ganze zweite Betreiber-Satz
 *              ungeprueft ([attrappe-luegt-durch-weglassen]).
 *   vorlesen   Die Kachel SAGT, dass sie oeffnet (`data-sprich` und
 *              aria-label), und jede Titel-Kachel nennt ihre Herkunft im
 *              aria-label. Die Box liest vor; eine Kachel, die schweigt oder
 *              das Falsche sagt, ist fuer ein Kind vor dem Schirm kaputt.
 *   bruecke    Mit `albumTippSpielt` (MuPi-Bruecke, Darstellung) SPIELT der
 *              Tipp wieder — und dann gibt es auch keinen Play-Knopf, denn er
 *              waere ein zweites Ziel fuer dieselbe Tat. Wer den Schalter
 *              gestellt hat, bekommt sein Verhalten; E112 biegt es nicht um.
 *
 * WAS ES AENDERT: nichts Bleibendes. Eigener Browser gegen
 * tools/neu-vorschau.mjs. Die Lage (`verschmolzen-an`) und die Darstellung
 * (`albumTippSpielt`) werden gestellt und im `finally` zurueckgelegt.
 * Die BOX wird nicht angefasst.
 *
 * AUFRUF
 *     node tools/album-titel-lane.mjs                              # Tabelle
 *     node tools/album-titel-lane.mjs --pruefen                    # Ende 1 bei Befund
 *     node tools/album-titel-lane.mjs http://127.0.0.1:8385/neu/   # eigene Vorschau
 *
 * GEMESSEN AM 31.08.2026 (eigene Vorschau auf 8385, Chromium 800x480), nach
 * dem Bau:
 *     oeffnen    14 Titel-Kacheln, 0 Wuensche, 0 Befehle
 *     knopf      1 Wunsch {schluessel:"vorschau:5"}, Lane blieb zu
 *     plaketten  14/14 Kacheln stimmen mit /inhalt ueberein
 *     gemischt   7 von 14 Titeln mit zwei Quellen (lokal + jellyfin)
 *     vorlesen   „Die drei ??? von Europa, Titel zeigen"
 *     bruecke    Tipp spielt, kein Play-Knopf
 *
 * UND DIE GEGENPROBE (der Wirkweg absichtlich totgelegt): siehe BACKLOG E112.
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const zeig = PRUEFEN ? () => {} : console.log

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const hol = async (weg) => (await fetch(new URL(weg, ZIEL), { cache: 'no-store' })).json()

const befunde = []
const merk = (fall, gut, text) => {
  befunde.push({ fall, gut, text })
  if (!gut) console.error(`FEHLT: ${fall} — ${text}`)
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

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT: dieses
// Werkzeug stellt `verschmolzen-an` UND schreibt die Darstellung, und beides
// gehoert dem, der die Vorschau vorher hatte. Laeuft keine, startet die
// Leihgabe selbst eine auf dem Port des Ziels. Beides samt der Messungen
// dahinter: tools/leihgabe.mjs.
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

/** Der geschriebene Stand der Darstellung, damit er zurueckgelegt werden kann.
 *  `null` heisst „es war keiner geschrieben" — dann wird auch keiner gesetzt. */
let darstellungVorher = null

try {
  // ══ DIE LAGE STELLEN, BEVOR DER BROWSER LAEDT ═══════════════════════════
  //
  // `verschmolzen-an` ist die Vorbedingung fuer den Fall „gemischt": Ohne den
  // Schalter sieht selbst der echte Server nicht im Albumordner nach, ob eine
  // lokale Schwesterspur daliegt (`const spuren = mischen ? … : null`,
  // server.ts) — und dann hat jeder Titel genau eine Quelle. Gemessen waere
  // dann nur die halbe Sache.
  //
  // UND NACHSEHEN, OB SIE UEBERHAUPT UMGELEGT WURDE: Die Vorschau nimmt jeden
  // unbekannten `/vorschau/<x>`-Pfad an und legt ihn still auf `lage.spielt`
  // — sie antwortet also auch dann mit 200, wenn sie das Wort „verschmolzen"
  // gar nicht kennt (dieselbe Falle wie in tools/verschmelzung-befehle.mjs).
  for (const l of ['voll', 'verschmolzen-an']) await hol(`/vorschau/${l}`)
  const lage = await hol('/vorschau/lage').catch(() => ({}))
  if (lage?.lage?.verschmolzen !== 'an') {
    console.error('FEHLT: die Vorschau kennt „verschmolzen-an" nicht — hier wird das Nichts gemessen')
    process.exit(PRUEFEN ? 1 : 0)
  }

  // ══ DIE ERWARTUNG KOMMT VOM SERVER, NICHT AUS app.js ════════════════════
  //
  // Gesucht wird das Werk ueber seine ART (`album`) und nicht ueber einen
  // Titel: Wer die Vorschau umbenennt, soll dieses Werkzeug nicht stillegen.
  // Und es muss eines mit MEHREREN Quellen sein — das ist der Fall, um den es
  // geht, und in dieser Vorschau gibt es ihn nur unter `verschmolzen-an`.
  const werke = (await hol('/api/werke?verschmelzen=1')).werke || []
  const album =
    werke.find((w) => w.art === 'album' && (w.quellen || []).length > 1) || werke.find((w) => w.art === 'album')
  if (!album) {
    console.error('FEHLT: tools/neu-vorschau.mjs fuehrt kein Werk mit art=album — hier wird nichts gemessen')
    process.exit(1)
  }
  // OHNE Abfrageteil, GENAU wie `albumTitelLaneOeffnen` es tut. Das ist keine
  // Bequemlichkeit: Der Server entscheidet bei fehlendem Schalter nach der
  // DARSTELLUNG (server.ts, `verschmelzenAusDarstellung`), und ein `=1` hier
  // pruefte einen anderen Weg als den, den die Oberflaeche geht.
  const inhalt = await hol(`/api/werke/${encodeURIComponent(album.schluessel)}/inhalt`)
  const sollTitel = Array.isArray(inhalt.titel) ? inhalt.titel : []
  if (sollTitel.length < 2) {
    console.error(`FEHLT: /inhalt zu „${album.titel}" traegt keine zwei Titel — hier wird das Nichts gemessen`)
    process.exit(1)
  }

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

  // ZWEI LEITUNGEN, EIN MITLESER — abgeschrieben aus tools/ard-folgen-lane.mjs
  // und aus demselben Grund: Seit E95/V baut die Seite keine /player-Befehle
  // mehr (jeder Abspielwunsch ist EIN `POST /api/spielen`), aber ein Rueckfall
  // auf selbstgebaute Befehle waere hier ein Befund. Also werden beide
  // gelesen.
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

  /** Die Kachel des Messwerks im Raster — ueber den Titel gesucht, aber der
   *  Titel kommt aus `/api/werke` und nicht aus diesem Quelltext. Steckt sie
   *  in einem Regal, wird das Regal vorher geoeffnet. */
  const suchen = `(() => {
      const raus = document.getElementById('zurueck')
      if (raus && !raus.disabled) raus.click()
      const suche = () => [...document.querySelectorAll('#raster > .kachel')]
        .find((k) => ((k.querySelector('.kachel-titel') || {}).textContent || '') === ${JSON.stringify(String(album.titel))})
      let k = suche()
      if (!k) {
        for (const r of [...document.querySelectorAll('#raster > .kachel')]) {
          if (!r.querySelector('.regal-zahl')) continue
          r.click(); k = suche(); if (k) break
        }
      }
      return k })()`

  const frisch = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2000)
    await ev(mitlesen)
    konsole.length = 0
  }
  const befehle = async () => (await ev('window.__befehle')) || []
  const wuensche = async () => (await ev('window.__wuensche')) || []
  /** Die Titel-Kacheln der offenen Lane, so wie sie WIRKLICH dastehen. */
  const laneLesen = async () =>
    await ev(`(() => {
      const lane = document.querySelector('#raster > .lane')
      if (!lane) return null
      return {
        kopf: ((lane.querySelector('.lane-kopf') || {}).textContent || '').trim(),
        stuecke: [...lane.querySelectorAll('.lane-kachel.stueck')].map((k) => ({
          titel: ((k.querySelector('.lane-titel') || {}).textContent || '').trim(),
          aria: k.getAttribute('aria-label') || '',
          // DIE KLASSEN, NICHT DIE FARBEN: welcher Dienst und ob blass, steht
          // in .marke-<dienst> bzw. .marke-nebenher. Eine Farbmessung waere
          // hier eine zweite Wahrheit ueber dasselbe.
          marken: [...k.querySelectorAll('.kachel-marken .marke')].map((m) => ({
            dienst: (m.className.match(/marke-(?!nebenher)([a-z]+)/) || [])[1] || '',
            blass: m.classList.contains('marke-nebenher'),
          })),
        })),
      }
    })()`)

  // ── FALL „oeffnen": ein Tipp OEFFNET, er spielt nicht ───────────────────
  await frisch()
  const gefunden = await ev(`(() => { const k = ${suchen}; if (!k) return false; k.click(); return true })()`)
  await warte(2200)
  const auf = await laneLesen()
  const beimOeffnen = await befehle()
  const wuenscheOffen = await wuensche()
  merk(
    'oeffnen',
    !!gefunden &&
      !!auf &&
      auf.stuecke.length === sollTitel.length &&
      beimOeffnen.length === 0 &&
      wuenscheOffen.length === 0,
    !gefunden
      ? `keine Kachel „${album.titel}" im Raster`
      : `${auf ? auf.stuecke.length : 0} Titel-Kacheln (erwartet ${sollTitel.length}), ` +
          `${beimOeffnen.length} Befehle, ${wuenscheOffen.length} Wuensche beim Oeffnen` +
          (beimOeffnen.length || wuenscheOffen.length ? ' — ein Tipp soll OEFFNEN, nicht starten' : ''),
  )

  // ── FALL „plaketten": stimmt jede Kachel mit dem Server ueberein? ───────
  //
  // ERWARTET WIRD AUS `/inhalt` GERECHNET: die geltende Quelle zuerst, danach
  // die weiteren in der Reihenfolge des Servers — und blass ist genau, was
  // nicht die geltende ist. Dieselbe Regel wie `quellenGeordnet` in app.js,
  // hier aber unabhaengig noch einmal formuliert; eine Wache, die die Formel
  // des Geprueften importiert, prueft nichts.
  const KENNT = ['spotify', 'jellyfin', 'lokal', 'radio', 'rss', 'ard', 'plugin']
  const sollMarken = (t) => {
    const alle = (Array.isArray(t.quellen) ? t.quellen : []).map(String)
    const gilt = String(t.quelle || '')
    const geordnet = gilt ? [gilt, ...alle.filter((d) => d !== gilt)] : alle
    const raus = []
    for (const d of geordnet) {
      if (!KENNT.includes(d) || raus.some((x) => x.dienst === d)) continue
      raus.push({ dienst: d, blass: d !== gilt })
    }
    return raus
  }
  if (auf && auf.stuecke.length === sollTitel.length) {
    const schief = []
    for (let i = 0; i < sollTitel.length; i++) {
      const soll = sollMarken(sollTitel[i])
      const ist = auf.stuecke[i].marken
      const gleich =
        soll.length === ist.length && soll.every((s, n) => s.dienst === ist[n].dienst && s.blass === ist[n].blass)
      if (!gleich) {
        const zeile = (l) => l.map((m) => `${m.dienst}${m.blass ? '(blass)' : ''}`).join('+') || '—'
        schief.push(`Titel ${i + 1}: soll ${zeile(soll)}, ist ${zeile(ist)}`)
      }
    }
    merk(
      'plaketten',
      schief.length === 0,
      schief.length ? schief.slice(0, 3).join(' | ') : `${sollTitel.length}/${sollTitel.length} Kacheln stimmen`,
    )

    // ── FALL „gemischt": gibt es den Fall ueberhaupt? ────────────────────
    const mitZwei = sollTitel.filter((t) => sollMarken(t).length > 1)
    const gezeigt = auf.stuecke.filter((s) => s.marken.length > 1)
    merk(
      'gemischt',
      mitZwei.length > 0 && gezeigt.length === mitZwei.length,
      mitZwei.length === 0
        ? 'kein Titel dieser Vorschau hat zwei Quellen — der Betreiber-Satz „gemischt lokal und spotify" bleibt ungeprueft'
        : `${gezeigt.length} von ${mitZwei.length} mehrquelligen Titeln zeigen wirklich zwei Plaketten ` +
            `(${sollMarken(mitZwei[0]).map((m) => m.dienst).join('+')})`,
    )

    // ── FALL „vorlesen": sagt die Oberflaeche, was sie tut? ──────────────
    const kachelWorte = await ev(`(() => { const k = ${suchen}; if (!k) return null
        return { sprich: k.dataset.sprich || '', aria: k.getAttribute('aria-label') || '' } })()`)
    // Die Herkunft muss IM LABEL der Titel-Kachel stehen: `markenBauen` setzt
    // den Plakettenkasten auf `aria-hidden`, ein Bildschirmleser hoert also
    // sonst gar nichts davon.
    const ersterMitZwei = auf.stuecke.find((s) => s.marken.length > 1) || auf.stuecke[0]
    const namen = { lokal: 'auf der Box', spotify: 'Spotify', jellyfin: 'Jellyfin', ard: 'ARD Sounds' }
    const fehltImLabel = ersterMitZwei.marken.filter((m) => !ersterMitZwei.aria.includes(namen[m.dienst] || m.dienst))
    merk(
      'vorlesen',
      !!kachelWorte &&
        kachelWorte.sprich.includes('Titel zeigen') &&
        kachelWorte.aria.includes('Titel zeigen') &&
        fehltImLabel.length === 0,
      !kachelWorte
        ? 'die Kachel war nach dem Oeffnen nicht mehr zu finden'
        : `Kachel sagt „${kachelWorte.sprich}" / Label „${kachelWorte.aria}"; ` +
            `Titel-Label „${ersterMitZwei.aria}"` +
            (fehltImLabel.length ? ` — es fehlt ${fehltImLabel.map((m) => m.dienst).join(', ')}` : ''),
    )
  } else {
    for (const f of ['plaketten', 'gemischt', 'vorlesen']) merk(f, false, 'die Lane ging nicht auf — nichts zu messen')
  }

  // ── FALL „knopf": der Play-Knopf spielt und oeffnet nicht ───────────────
  await frisch()
  const getippt = await ev(`(() => { const k = ${suchen}; if (!k) return false
      const b = k.querySelector('.tipp-spiel'); if (!b) return false; b.click(); return true })()`)
  await warte(2500)
  const nachKnopf = await wuensche()
  const laneNachKnopf = await ev(`!!document.querySelector('#raster > .lane')`)
  merk(
    'knopf',
    !!getippt && nachKnopf.length === 1 && nachKnopf[0].schluessel === album.schluessel && !laneNachKnopf,
    !getippt
      ? 'die Album-Kachel traegt gar keinen Play-Knopf — „Ton" waere einen Tipp weiter weg als vor E112'
      : `${nachKnopf.length} Wunsch/Wuensche (${nachKnopf.map((w) => w.schluessel).join(', ') || '—'}), ` +
          `Lane ${laneNachKnopf ? 'ging auf' : 'blieb zu'}`,
  )

  // ── FALL „bruecke": mit albumTippSpielt spielt der Tipp wieder ──────────
  //
  // ES WIRD GESCHRIEBEN, NICHT GESCHUMMELT: Der Schalter wohnt in der
  // Darstellung, und die Oberflaeche liest ihn dort (`anwenden()`). Ein im
  // Browser gesetztes `bedienung.albumTippSpielt` pruefte die halbe Kette.
  //
  // `verschmelzen: true` MUSS MIT: Ein PUT setzt `DARSTELLUNG.geschrieben`,
  // und danach erreicht `/vorschau/verschmolzen-an` die Darstellung nicht
  // mehr (die Vorschau sagt das in ihrem Kommentar selbst). Ohne das Feld
  // faende die Oberflaeche ploetzlich zwei Ausgaben desselben Albums.
  const dJetzt = await hol('/api/darstellung')
  darstellungVorher = dJetzt && dJetzt.aktuell ? { aktuell: dJetzt.aktuell, themen: dJetzt.themen || {} } : null
  await fetch(new URL('/api/darstellung', ZIEL), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      aktuell: { ...(dJetzt?.aktuell || {}), albumTippSpielt: true, verschmelzen: true },
      themen: dJetzt?.themen || {},
    }),
  })
  await frisch()
  const bruecke = await ev(`(() => { const k = ${suchen}; if (!k) return null
      const mitKnopf = !!k.querySelector('.tipp-spiel')
      k.click()
      return { mitKnopf, sprich: k.dataset.sprich || '', aria: k.getAttribute('aria-label') || '' } })()`)
  await warte(2500)
  const bWuensche = await wuensche()
  const bLane = await ev(`!!document.querySelector('#raster > .lane')`)
  merk(
    'bruecke',
    !!bruecke && !bruecke.mitKnopf && bWuensche.length === 1 && !bLane && bruecke.sprich.includes('abspielen'),
    !bruecke
      ? `keine Kachel „${album.titel}" im Raster (MuPi-Bruecke)`
      : `Play-Knopf ${bruecke.mitKnopf ? 'DA (er waere ein zweites Ziel fuer dieselbe Tat)' : 'weg'}, ` +
          `${bWuensche.length} Wunsch/Wuensche, Lane ${bLane ? 'GING AUF' : 'blieb zu'}, sagt „${bruecke.sprich}"`,
  )

  merk('konsole', konsole.length === 0, konsole.length ? konsole.join(' | ') : 'nichts')

  zeig(`\n  Vorschau: ${ZIEL}   Album: „${album.titel}" (${(album.quellen || []).map((q) => q.dienst).join('+')})\n`)
  const breite = Math.max(...befunde.map((b) => b.fall.length))
  for (const b of befunde) zeig(`    ${b.gut ? 'ok   ' : 'FEHLT'} ${b.fall.padEnd(breite)}  ${b.text}`)
  zeig('')
} finally {
  // ERST DIE DARSTELLUNG, DANN DIE LEIHE: Der geschriebene Stand ist das, was
  // die Leihgabe NICHT zuruecklegen kann (ihr Schnappschuss ist die `lage`,
  // nicht `/api/darstellung`). Wer ihn stehenliesse, gaebe dem naechsten
  // Werkzeug eine Box, in der der Tipp spielt statt zu oeffnen.
  if (darstellungVorher) {
    await fetch(new URL('/api/darstellung', ZIEL), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(darstellungVorher),
    }).catch(() => {})
  }
  await brw.schliessen().catch(() => {})
  await leihe.zurueckgeben()
}

const schlecht = befunde.filter((b) => !b.gut).length
if (!schlecht) zeig(`geprueft: ${befunde.length} Faelle, die Album-Kachel klappt auf und nennt je Titel die Herkunft`)
process.exit(PRUEFEN && schlecht ? 1 : 0)
