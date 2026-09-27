#!/usr/bin/env node
/**
 * DER ABSTAND ZWISCHEN `stop` UND DEM SPOTIFY-START — an der Attrappe.
 *
 * WOZU: Der am 03.08.2026 gemeldete Fehler („es spielt, zeigt aber keinen
 * Fortschritt, der Knopf steht auf play") ist AM GERAET gefunden worden
 * (tools/weiterhoeren-wettlauf.mjs: 3 von 4 Runden fehlerhaft ohne Atempause,
 * 0 von 4 mit). Am Geraet zu messen kostet aber je Runde fast eine Minute,
 * braucht die Box und macht Krach. Diese Pruefung fasst das, was daraus
 * FOLGT, in Saetze, die in Sekunden laufen.
 *
 * ── WAS SICH AM 04.08.2026 GEAENDERT HAT (BACKLOG E24/O1 + O2) ────────────
 * Die Ursache liegt nicht in der Oberflaeche, sondern im Abspieldienst:
 * `stop()` rief `spotifyApi.pause()` und antwortete 200, OHNE das Versprechen
 * abzuwarten. Das ist jetzt dort repariert (spotify-control.ts,
 * `ANHALTE_FRIST_MS`), und die Antwort sagt im Feld `angehalten`, wie es
 * ausging. Die feste Atempause von 1500 ms ist damit vom REGELFALL zum
 * RUECKFALL geworden — sie greift nur noch, wenn die Pause wirklich noch
 * unterwegs sein koennte.
 *
 * DIE FRAGE DIESER PRUEFUNG LAUTETE VOM 04. BIS ZUM 31.08.2026:
 *
 *     Haelt die Oberflaeche genau DANN Abstand, wenn er noetig ist — und
 *     genau dann NICHT, wenn er nur Stille waere?
 *
 * (Die heutige Frage steht im Abschnitt E95/V weiter unten.)
 * Und weil der Wettlauf im GEWOEHNLICHEN Kacheltipp genauso stand wie im
 * Weiterhoeren-Weg (das war O1), wird seit dem 04.08.2026 BEIDES geprueft.
 * Der Dateiname ist der alte geblieben, damit die Verweise aus dem
 * Wissenspaket und aus tools/pruefen.sh nicht ins Leere zeigen.
 *
 * WARUM DIE ATTRAPPE DEN FEHLER SELBST NICHT ZEIGEN KANN — und das gehoert
 * benannt statt verschwiegen: Der Schaden entsteht bei SPOTIFY, nicht in der
 * Oberflaeche. Die Oberflaeche zeigt korrekt, was /player/state meldet. Eine
 * Attrappe kann also nur den AUSLOESER pruefen, nicht die Wirkung — die
 * Wirkung misst tools/weiterhoeren-am-geraet.mjs. Beides zusammen ergibt die
 * Kette; einzeln ist keines von beiden ein Beweis.
 *
 * ── WAS SICH AM 31.08.2026 GEAENDERT HAT (E95/V STUFE 2) ──────────────────
 * Die Oberflaeche baut fuer den Kacheltipp und fuers Weiterhoeren GAR KEINE
 * /player-Befehle mehr. Jeder Abspielwunsch ist EIN `POST /api/spielen`
 * (NewDesign/app.js `spielenAnfordern`); das Anhalten samt Atempause macht
 * der SERVER (server.ts `spielenAnhalten`, `SPIEL_SPOTIFY_ATEMPAUSE_MS`) —
 * gedeckt von src/backend-api/src/spielen.integration.spec.ts (entsteht
 * parallel zu diesem Umbau). Die alte Frage „haelt die OBERFLAECHE Abstand?"
 * ist damit gegenstandslos; die Sorten-Faelle unten bleiben trotzdem stehen,
 * denn sie sind das Raster, auf dem der Rueckfall am ehesten zurueckkaeme.
 *
 * DIE NEUE WAHRHEIT DIESES WERKZEUGS lautet:
 *
 *     Je Fall geht GENAU EIN `POST /api/spielen` hinaus, mit den Feldern
 *     der gemerkten Stelle (titelNr/positionMs, `ausStelle`, `gemerktBei`)
 *     beim Weiterhoeren und mit dem nackten Schluessel beim Kacheltipp.
 *     Und die Seite schickt selbst KEIN `/player/current/stop` und KEINEN
 *     /player-Startbefehl mehr — das waere jetzt ein DOPPELWEG-Fehler:
 *     die Seite hielte an, der Server hielte noch einmal an, und der
 *     muehsam reparierte Abstand laege wieder in zwei Haenden.
 *
 * Die Untergrenze der Atempause (1500 ms, am Geraet gemessen) wird weiter
 * geprueft — nur eben dort, wo die Zahl jetzt wohnt: in server.ts.
 *
 * ── WAS SICH AM 19.09.2026 GEAENDERT HAT (DIE GELIEHENE VORSCHAU) ─────────
 * Dieses Werkzeug stuerzte in `tools/pruefen.sh` mit
 * „Unexpected token 'k', "kaputt" is not valid JSON" ab und riss vier
 * spaetere Schritte mit. Die Ursache lag NICHT hier: ein abgebrochener Lauf
 * hatte die GETEILTE Vorschau auf `liste=kaputt` stehen lassen, `/api/werke`
 * antwortete deshalb 500 mit dem Text „kaputt", und das `finally` legte den
 * kaputten Stand brav wieder hin. Die ganze gemessene Kette steht unten bei
 * `aufbauHerstellen()`. Seither gilt:
 *
 *   * Keine Antwort wird mehr blind geparst (`holen()`), und kein Fall reisst
 *     die anderen mit — am Ende steht IMMER eine Bilanz-Zeile.
 *   * Die Lage, die diese Messung braucht (`liste=voll`), stellt sie sich
 *     selbst — und legt eine vorgefundene KAPUTTE nicht zurueck.
 *
 * AUFRUF
 *   node tools/weiterhoeren-atempause.mjs
 *   node tools/weiterhoeren-atempause.mjs --pruefen     # Rueckgabewert 1 bei Abweichung
 *
 * ABHAENGIG von tools/neu-vorschau.mjs (wird selbst gestartet, wenn sie nicht
 * schon laeuft), deren Befehlsprotokoll unter /vorschau/befehle und deren
 * Umschalter /vorschau/anhalten-<sorte> und /vorschau/{voll|kaputt}.
 */
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** DIE ERWARTUNG WIRD NICHT ABGESCHRIEBEN, SONDERN GELESEN — seit E95/V
 *  Stufe 2 (31.08.2026) aus server.ts, denn DORT wohnt die Atempause jetzt
 *  (`spielenAnhalten`). Stuende die Zahl hier noch einmal, waeren es zwei
 *  Wahrheiten — und die Pruefung bliebe gruen, wenn jemand sie im Server auf
 *  0 setzt. (app.js behaelt ein eigenes SPOTIFY_ATEMPAUSE_MS fuer das
 *  Anhalten beim PROFILWECHSEL, `anhaltenUndAbstand` — das ist nicht der
 *  Gegenstand dieses Werkzeugs.) */
const QUELLE = readFileSync(new URL('../src/backend-api/src/server.ts', import.meta.url), 'utf8')
const ERWARTET_MS = Number((QUELLE.match(/const SPIEL_SPOTIFY_ATEMPAUSE_MS = (\d+)/) || [])[1])
if (!Number.isFinite(ERWARTET_MS)) {
  console.error('SPIEL_SPOTIFY_ATEMPAUSE_MS steht nicht in src/backend-api/src/server.ts — wurde die Reparatur entfernt?')
  process.exit(1)
}

/**
 * DIE UNTERGRENZE IST GEMESSEN UND STEHT DESHALB HIER FEST.
 *
 * Ohne sie waere diese Pruefung wertlos: Sie liest ihre Erwartung aus
 * server.ts, also bliebe sie gruen, wenn jemand `SPIEL_SPOTIFY_ATEMPAUSE_MS`
 * auf 0 setzt — und genau dann waere der Fehler zurueck. 1500 ms ist die
 * einzige Zahl, fuer die am Geraet ein Ergebnis vorliegt (0 von 4 Runden
 * fehlerhaft, tools/weiterhoeren-wettlauf.mjs, 03.08.2026). Ob 800 ms auch
 * genuegen, ist NICHT gemessen — wer die Zahl senken will, misst zuerst.
 * OB der Server sie im richtigen Augenblick auch wirklich abwartet, prueft
 * src/backend-api/src/spielen.integration.spec.ts — hier steht nur die Zahl.
 */
const UNTERGRENZE_MS = 1500

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

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

/**
 * EIN ABSTURZ IST KEIN BEFUND (19.09.2026).
 *
 * GEMESSEN, NICHT VERMUTET: Stand die geteilte Vorschau auf `liste=kaputt`,
 * antwortete `/api/werke` mit HTTP 500 und dem nackten Text „kaputt"
 * (tools/neu-vorschau.mjs, `if (lage.liste === 'kaputt')`). Das hier war ein
 * blankes `.json()`, also endete der ganze Lauf mit
 *
 *     FEHLER: Unexpected token 'k', "kaputt" is not valid JSON
 *
 * — einer Meldung, die nach einem Fehler der OBERFLAECHE aussieht und in
 * Wahrheit diesem Werkzeug gehoerte. Dieselbe Falle hat
 * tools/interpreten-auswahl-schau.mjs am 03.08.2026 schon einmal gekostet;
 * dort steht sie im Kommentar, hier fehlte sie.
 *
 * `holen()` liest deshalb ERST den Text und parst DANN — und sagt beim
 * Scheitern, WER geantwortet hat, mit welchem Status und was im Rumpf stand.
 * Der Wurf ist ein `AufbauFehlt`: er unterscheidet „die Lage stimmt nicht"
 * von „die Oberflaeche weicht ab". Der Unterschied ist genau der, den
 * [[vorschau-wird-geliehen]] verlangt — nicht „Abweichung", sondern „Aufbau
 * fehlt".
 */
class AufbauFehlt extends Error {}

async function holen(weg, wofuer) {
  let a
  try {
    a = await fetch(new URL(weg, ZIEL), { signal: AbortSignal.timeout(5000) })
  } catch (e) {
    throw new AufbauFehlt(`${wofuer} (${weg}) antwortete gar nicht: ${e.message} — laeuft tools/neu-vorschau.mjs?`)
  }
  const roh = await a.text()
  try {
    return JSON.parse(roh)
  } catch {
    throw new AufbauFehlt(
      `${wofuer} (${weg}) antwortete ${a.status} und keinen JSON-Rumpf, sondern „${roh.slice(0, 60).trim()}" — ` +
        'die Vorschau steht in einer fremden Lage (Umschalter /vorschau/voll)',
    )
  }
}

const lage = (was) => holen(`/vorschau/${was}`, 'der Umschalter der Vorschau')
const befehle = () => holen('/vorschau/befehle', 'das Befehlsprotokoll der Vorschau')

let fehler = 0
const sagen = (gut, text) => {
  console.log(`  ${gut ? 'OK  ' : 'FEHL'}  ${text}`)
  if (!gut) fehler++
}

/**
 * ══ DIE LAGE, DIE DIESE MESSUNG BRAUCHT, STELLT SIE SICH SELBST ═══════════
 *
 * WAS AM 19.09.2026 GEMESSEN WURDE — die Kette, nicht die Vermutung:
 *
 *   1. tools/weiter-auswahl-schau.mjs (pruefen.sh) und
 *      tools/interpreten-auswahl-schau.mjs stellen mitten im Lauf
 *      `/vorschau/kaputt`; beide raeumen es auf dem gruenen Weg wieder weg.
 *   2. Ein Abbruch DAZWISCHEN raeumt es NICHT weg: der SIGINT/SIGTERM-Griff
 *      in tools/leihgabe.mjs schliesst den Browser und ruft `process.exit()`
 *      — `leihe.zurueckgeben()` wird nie erreicht, und ein `finally` laeuft
 *      bei einem Signal ohnehin nicht. NACHGESTELLT: SIGTERM im offenen
 *      Fenster, danach stand die Vorschau dauerhaft auf `liste=kaputt`.
 *   3. Dieses Werkzeug lieh sie sich in genau dem Zustand. `vorschauLeihen`
 *      haelt eine 500er-Antwort fuer „erreichbar" (sie kommt ja an), der
 *      Schnappschuss trug also `liste: 'kaputt'` —
 *   4. … `rasterKachelTippen()` stuerzte an `/api/werke` ab, und das
 *      `finally` legte den KAPUTTEN Schnappschuss brav wieder hin — die
 *      Aufraeumerei TRUG DEN SCHADEN ALSO WEITER, an jeden Schritt danach.
 *
 * WIE WEIT DER SCHADEN REICHT, IST NACHGEMESSEN UND NICHT GESCHAETZT: von den
 * vier Schritten hinter diesem faellt an `liste=kaputt` nachweislich
 * tools/lane-marken-schau.mjs („Marken und Umriss der Lanes") — und zwar mit
 * demselben Einzeiler, ohne jedes `try`. tools/raster-marke-schau.mjs,
 * tools/marke-grenzfaelle.mjs und tools/album-gross-schau.mjs liefen am
 * 19.09.2026 auch gegen eine kaputte Vorschau gruen; wer sie rot sieht, sucht
 * die Ursache also woanders.
 *
 * WARUM SELBST STELLEN UND NICHT EINS DER ANDEREN ZWEI:
 *
 *   * NUR BEIM VERLASSEN ZURUECKSETZEN ist genau der Weg, der den Schaden
 *     WEITERTRAEGT: zurueckgelegt wird, was vorgefunden wurde — also der
 *     kaputte Stand, und zwar an die vier Schritte danach.
 *   * EINE EIGENE VORSCHAU AUF EIGENEM PORT rettet diesen Lauf und sonst
 *     nichts. Die vier Nachbarn messen weiter gegen die geteilte, und wer
 *     ausweicht, hoert auf, ihr Zeuge zu sein. (Fuer PARALLELE Laeufe bleibt
 *     der eigene Port richtig — tools/leihgabe.mjs sagt, warum.)
 *   * DEN AUSGANGSPUNKT SELBST HERSTELLEN ist das, was
 *     [[vorschau-wird-geliehen]] verlangt („den Vorzustand einzeln pruefen
 *     und BENENNEN, bevor die eigentliche Messung laeuft") und was
 *     tools/interpreten-auswahl-schau.mjs mit seinem `zuruecksetzen()` oben
 *     schon vormacht. `liste = voll` ist keine fremde Vorliebe, sondern die
 *     Voraussetzung dieser Messung: ohne Medienliste gibt es keine Kachel.
 *
 * UND DER KAPUTTE STAND GEHT NICHT ZURUECK. Das ist die eine Stelle, an der
 * von „zurueckgelegt wird, was da war" abgewichen wird — mit Ansage und nur
 * fuer das eine Feld. Vorbild ist `vorschauLeihen` selbst: trifft es einen
 * Stand, den es nicht zuruecklegen kann, dreht es den Schaden wenigstens
 * zurueck, statt ihn treu zu bewahren.
 */
const BRAUCHT_LISTE = 'voll'
let fremdeListe = null

async function aufbauHerstellen() {
  const gefunden = (await holen('/vorschau/lage', 'die Lage der Vorschau'))?.lage?.liste
  if (gefunden === BRAUCHT_LISTE) return
  fremdeListe = gefunden ?? '(kein Feld `liste`)'
  console.warn(`  ACHTUNG  die geliehene Vorschau stand auf liste=${fremdeListe}, nicht auf ${BRAUCHT_LISTE}.`)
  console.warn('           Das ist KEIN Befund dieser Messung, sondern ein Rest eines abgebrochenen')
  console.warn('           Laufs (tools/{weiter,interpreten}-auswahl-schau.mjs stellen /vorschau/kaputt).')
  console.warn(`           Der Ausgangspunkt wird selbst hergestellt — und NICHT zurueckgelegt.`)
  await holen(`/vorschau/${BRAUCHT_LISTE}`, 'der Umschalter der Vorschau')
  // GEGENPROBE ZUR REPARATUR: hilft sie nicht, ist die Vorschau wirklich
  // kaputt — dann steht hier ein Satz statt eines Stacktrace.
  await holen('/api/werke', 'die Medienliste der Vorschau')
}

try {
  // ERST DEN AUFBAU, DANN DIE MESSUNG. Steht die Vorschau in einer fremden
  // Lage, wird sie hier benannt und hergestellt — nicht spaeter als
  // „Abweichung" gemeldet.
  await aufbauHerstellen()
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  /**
   * DIE SPOTIFY-WEITERHOEREN-KACHEL ANTIPPEN — NICHT DIE ERSTE.
   *
   * Beim ersten Anlauf traf `[0]` die LOKALE Zeile („Die Maus" ueber mpv) —
   * die geht einen ganz anderen Weg (drei Befehle mit festen Wartezeiten) und
   * hat mit dem Abstand nichts zu tun. Die Pruefung meldete daraufhin „kein
   * spotify:-Startbefehl", und das sah aus wie ein Fehler in der Reparatur.
   *
   * Zugeordnet wird ueber den TITEL: die Kachel traegt ihn in
   * `.weiter-titel`, und /api/weiterhoeren sagt, welcher davon `typ:
   * 'spotify'` ist. Der Index in der Reihe taugt nicht — die Reihe ist
   * gefiltert (Auswahl, fehlende Werke), die Antwort nicht.
   */
  async function weiterKachelTippen() {
    const zeilen = await holen('/api/weiterhoeren?max=20', 'die Weiterhoeren-Reihe der Vorschau')
    const spotifyZeilen = (zeilen.weiter || []).filter((z) => z.typ === 'spotify' && z.schluessel)
    if (!spotifyZeilen.length) throw new AufbauFehlt('die Vorschau fuehrt keine Spotify-Weiterhoeren-Zeile mit Werk')
    const getroffen = await ev(
      `(() => { const wunsch = ${JSON.stringify(spotifyZeilen.map((z) => String(z.titel || '')))};
        for (const k of document.querySelectorAll('#weiter-reihe .weiter-kachel')) {
          const t = (k.querySelector('.weiter-titel') || {}).textContent || '';
          if (wunsch.includes(t)) { k.click(); return t }
        }
        return null })()`,
    )
    if (!getroffen) throw new Error('keine Spotify-Weiterhoeren-Kachel in der Reihe — laeuft tools/neu-vorschau.mjs?')
    // DIE ZEILE GEHT MIT ZURUECK: gegen ihre Felder wird der Wunsch-Rumpf
    // verglichen — die Erwartung kommt aus /api/weiterhoeren selbst, nicht
    // aus abgeschriebenen Zahlen.
    return { getroffen, zeile: spotifyZeilen.find((z) => String(z.titel || '') === getroffen) }
  }

  /**
   * EINE GEWOEHNLICHE SPOTIFY-KACHEL IM RASTER ANTIPPEN — der Weg aus E24/O1.
   *
   * NICHT JEDE KACHEL SPIELT BEIM TIPP: eine Playlist zeigt ihre Alben, eine
   * Interpreten-Kachel oeffnet die Interpretenseite (dieselbe Falle, die
   * tools/kachel-spielt-je-dienst.mjs am 04.08.2026 einen Fehlalarm gekostet
   * hat — die erste Spotify-Kachel der Vorschau ist „Bibi Blocksberg", eine
   * Playlist). Gesucht wird deshalb ein Werk, das ein Album oder ein
   * einzelner Titel ist. Und wenn es in einem Regal steckt, wird das Regal
   * geoeffnet.
   */
  async function rasterKachelTippen() {
    // ├─ HIER STAND DER ABSTURZ VOM 19.09.2026 (siehe `holen()` oben): ein
    // │  blankes `.json()` auf eine 500er-Antwort mit dem Text „kaputt".
    const werke = (await holen('/api/werke', 'die Medienliste der Vorschau')).werke || []
    const spielbar = werke.filter(
      (w) =>
        (Array.isArray(w.quellen) ? w.quellen[0]?.dienst : null) === 'spotify' && ['album', 'titel'].includes(w.art),
    )
    if (!spielbar.length) throw new AufbauFehlt('die Vorschau fuehrt kein spielbares Spotify-Werk (Album oder Titel)')
    const titel = spielbar.map((w) => String(w.titel || ''))
    /* GESTARTET WIRD UEBER DEN PLAY-KNOPF, WO ES EINEN GIBT — nachgezogen am
     * 31.08.2026 (E112). Eine ALBUM-Kachel klappt seither ihre Titel auf,
     * statt zu starten, und traegt den Start in ihrem eigenen Cover-Knopf
     * (.tipp-spiel) wie Playlist und ARD schon vorher. Genau ein Album sucht
     * diese Funktion sich aber aus; ohne den Knopf meldeten drei Faelle
     * „gezaehlt: 0" und beschrieben einen Umbau als Fehler.
     *
     * DER KOMMENTAR STEHT HIER UND NICHT IN DER VORLAGE DARUNTER: Ein
     * Backtick — etwa um einen Klassennamen — beendet das Template-Literal
     * mitten im Satz. Der Rest wird dann als Ausdruck gelesen, `node --check`
     * geht glatt durch, und im Browser kommt „spiel is not defined" heraus.
     * Genau so passiert, beim Bau dieser Zeile (llmwiki
     * backticks-beenden-jede-vorlage).
     *
     * DER REGAL-TIPP DARUEBER BLEIBT EIN KACHELTIPP: ein Regal traegt keinen
     * Play-Knopf, sondern eine .regal-zahl. */
    const getroffen = await ev(
      `(() => { const wunsch = ${JSON.stringify(titel)};
        const raus = document.getElementById('zurueck'); if (raus && !raus.disabled) raus.click();
        const suche = () => [...document.querySelectorAll('#raster .kachel')]
          .find((k) => wunsch.includes(((k.querySelector('.kachel-titel') || {}).textContent || '')));
        let k = suche();
        if (!k) {
          for (const r of [...document.querySelectorAll('#raster .kachel')]) {
            if (!r.querySelector('.regal-zahl')) continue
            r.click(); k = suche(); if (k) break
          }
        }
        if (!k) return null
        const knopf = k.querySelector('.tipp-spiel')
        ;(knopf || k).click()
        return (k.querySelector('.kachel-titel') || {}).textContent || '?' })()`,
    )
    if (!getroffen) throw new Error('keine spielbare Spotify-Kachel im Raster gefunden')
    // DAS WERK GEHT MIT ZURUECK: sein Schluessel ist die Erwartung an den
    // Wunsch-Rumpf des Kacheltipps.
    return { getroffen, werk: spielbar.find((w) => String(w.titel || '') === getroffen) }
  }

  /**
   * Einen Durchgang: Lage einstellen, Seite laden, das Mitlesen einhaengen,
   * antippen, BEIDE Leitungen auswerten.
   *
   * NEU GELADEN WIRD JEDES MAL. `zustand.lokal` entsteht aus dem Takt; wer die
   * Lage umschaltet und sofort tippt, tippt gegen den Stand von vorhin.
   *
   * ZWEI LEITUNGEN, ZWEI ZEUGEN (31.08.2026, Vorbild
   * tools/kachel-spielt-je-dienst.mjs): Den WUNSCH liest ein fetch-Haken im
   * Browser mit — samt Rumpf, denn die Attrappe protokolliert POSTs auf
   * /api/spielen nirgends abrufbar. Die GEGENPROBE liefert /vorschau/befehle:
   * dort landet jeder /player/<raum>/<befehl>, der die Leitung wirklich
   * erreicht (auch `stop`). Ein leeres Befehlsprotokoll beweist also, dass
   * die Seite den alten Weg nicht mehr betreten hat.
   *
   * @param spielLage  'spotify' oder 'still'
   * @param anhalten   welche Sorte `stop`-Antwort die Attrappe GAEBE — seit
   *                   E95/V fragt nur noch der Server-Weg sie ab, die Seite
   *                   selbst nie mehr. Die Hebel bleiben trotzdem umgelegt:
   *                   kaeme der Doppelweg zurueck, faellt er in jeder Sorte auf.
   * @param wo         'weiter' (Weiterhoeren-Kachel) oder 'raster' (E24/O1)
   */
  async function durchgang(spielLage, anhalten, wo) {
    await lage(spielLage)
    await lage(`anhalten-${anhalten}`)
    await lage('befehle-leeren')
    await send(ws, 'Page.navigate', { url: `${ZIEL}?t=${Date.now()}` })
    await warte(3000)
    await ev(`window.__wuensche = [];
      if (!window.__mitgelesen) { window.__mitgelesen = true;
        const alt = window.fetch;
        window.fetch = function (u) {
          try {
            const s = String(u && u.url ? u.url : u);
            if (/\\/api\\/spielen$/.test(s)) {
              let rumpf = {};
              try { rumpf = JSON.parse((arguments[1] || {}).body || '{}') } catch {}
              window.__wuensche.push(rumpf);
            }
          } catch {}
          return alt.apply(this, arguments)
        } }
      true`)
    const wer = wo === 'raster' ? await rasterKachelTippen() : await weiterKachelTippen()
    console.log(`  angetippt: „${wer.getroffen}"`)
    // Der Wunsch geht im Augenblick des Tipps hinaus (mitgelesen wird der
    // ABRUF, nicht die Antwort). Gewartet wird trotzdem: ein Doppelweg-Befehl
    // oder ein zweiter POST kaeme, wenn ueberhaupt, in diesen Sekunden.
    await warte(2500)
    const wuensche = (await ev('window.__wuensche')) || []
    const { befehle: b } = await befehle()
    return { ...wer, wuensche, spielerBefehle: b }
  }

  /**
   * Einen Durchgang gegen die NEUE Wahrheit auswerten (siehe Kopf,
   * 31.08.2026): GENAU EIN POST /api/spielen, die richtigen Felder im Rumpf,
   * und KEIN einziger /player-Befehl aus der Seite. Ob der Server danach
   * `stop` schickt und den Abstand haelt, prueft
   * src/backend-api/src/spielen.integration.spec.ts — nicht mehr dieses
   * Werkzeug.
   */
  async function fall(ueberschrift, spielLage, anhalten, wo, warum) {
    console.log(`\n${ueberschrift}`)
    /* EIN FALL, DER NICHT MESSEN KANN, NIMMT DIE ANDEREN SECHS NICHT MIT
     * (19.09.2026). Vorher riss der erste Wurf aus `durchgang()` den ganzen
     * Lauf ab — wer die Ausgabe las, sah einen Stacktrace-Einzeiler und
     * WUSSTE NICHT, ob die uebrigen Faelle gehalten haetten. Jetzt endet der
     * Fall mit einem Urteil, wird als Abweichung gezaehlt (`--pruefen` bleibt
     * rot) und der naechste laeuft. Ein Absturz ist kein Befund; ein Befund
     * steht in einer Zeile, die ein Mensch versteht. */
    let d
    try {
      d = await durchgang(spielLage, anhalten, wo)
    } catch (e) {
      sagen(false, `${e instanceof AufbauFehlt ? 'AUFBAU FEHLT' : 'MESSUNG GESCHEITERT'} — ${e.message}`)
      return
    }
    const w = d.wuensche[0] || {}
    console.log(`  Wunsch: ${d.wuensche.map((x) => JSON.stringify(x)).join('  ') || '(keiner)'}`)
    sagen(d.wuensche.length === 1, `genau EIN POST /api/spielen (gezaehlt: ${d.wuensche.length}) — ${warum}`)
    // DIE NEGATIV-ERWARTUNG IST DIE NEUE WAHRHEIT DES WERKZEUGS: ein stop
    // oder ein Startbefehl aus der Seite waere jetzt ein DOPPELWEG-Fehler.
    sagen(
      d.spielerBefehle.length === 0,
      `die Seite schickt selbst KEIN stop und keinen /player-Startbefehl (gesehen: ${
        d.spielerBefehle.map((x) => x.befehl).join(', ') || 'keiner'
      })`,
    )
    if (wo === 'weiter') {
      // Die Felder der gemerkten Stelle — verglichen mit der ZEILE, die
      // /api/weiterhoeren selbst genannt hat, nicht mit abgeschriebenen
      // Zahlen.
      const z = d.zeile || {}
      sagen(w.ausStelle === true, 'im Wunsch steht ausStelle (der Server darf auf die wiedergefundene Folge ausweichen)')
      sagen(
        w.titelNr === z.titelNr && w.positionMs === z.positionMs,
        `Titel und Stelle wie gemerkt (geschickt: ${w.titelNr}/${w.positionMs} ms, gemerkt: ${z.titelNr}/${z.positionMs} ms)`,
      )
      sagen(
        w.gemerktBei === z.typ,
        `gemerktBei nennt den Nummernraum der Stelle (geschickt: ${w.gemerktBei}, gemerkt bei: ${z.typ})`,
      )
    } else {
      const soll = (d.werk || {}).schluessel
      sagen(w.schluessel === soll, `der Wunsch traegt den Schluessel der Kachel (geschickt: ${w.schluessel}, Kachel: ${soll})`)
      sagen(
        w.titelNr === undefined && w.positionMs === undefined && !w.ausStelle,
        'und KEINE Stelle — ein Kacheltipp faengt vorn an, die Wahl trifft der Server',
      )
    }
  }

  console.log(`Atempause der Spielfunktion aus src/backend-api/src/server.ts: ${ERWARTET_MS} ms\n`)
  sagen(
    ERWARTET_MS >= UNTERGRENZE_MS,
    `SPIEL_SPOTIFY_ATEMPAUSE_MS ist mindestens ${UNTERGRENZE_MS} ms (die am Geraet gemessene Zahl)`,
  )

  /*
   * DIE SORTEN, NICHT DIE FAELLE. Was die Reparatur von E24 unterschied, war
   * die ANTWORT DES DIENSTES auf `stop` (ANHALTE_SORTEN in
   * tools/neu-vorschau.mjs). Seit E95/V entscheidet darueber der SERVER
   * (`spielenAnhalten`); fuer die Seite sind alle Sorten gleich — und GENAU
   * DAS wird hier je Sorte nachgemessen: egal was der Dienst auf `stop`
   * antworten wuerde, die Seite schickt einen Wunsch und sonst nichts. Die
   * Sorten-Wahrheit selbst (wann gewartet wird, wann nicht) prueft
   * src/backend-api/src/spielen.integration.spec.ts.
   */

  await fall(
    'Fall 1 — Weiterhoeren-Kachel, Dienst BESTAETIGT die Pause:',
    'spotify',
    'bestaetigt',
    'weiter',
    'der Wunsch ist derselbe, egal was der Dienst auf stop antwortete',
  )

  await fall(
    'Fall 2 — Weiterhoeren-Kachel, ALTER Dienst ohne das Feld `angehalten`:',
    'spotify',
    'alt',
    'weiter',
    'auch gegen einen alten Dienst: nur der Wunsch — den Rueckfall-Abstand haelt der Server',
  )

  await fall(
    'Fall 3 — Weiterhoeren-Kachel, der Dienst meldet FRIST-ABGELAUFEN:',
    'spotify',
    'frist-abgelaufen',
    'weiter',
    'die noch unterwegs befindliche Pause ist Sache des Servers, nicht der Seite',
  )

  // ── DER GEWOEHNLICHE KACHELTIPP (E24/O1) ────────────────────────────
  // Er ging bis zum 04.08.2026 dieselbe Folge `stop` -> Start OHNE jeden
  // Abstand; seit E95/V baut er gar keine Folge mehr, sondern stellt den
  // einen Wunsch.
  await fall(
    'Fall 4 — GEWOEHNLICHE Kachel, Dienst BESTAETIGT die Pause:',
    'spotify',
    'bestaetigt',
    'raster',
    'der Kacheltipp geht denselben EINEN Weg wie das Weiterhoeren',
  )

  await fall(
    'Fall 5 — GEWOEHNLICHE Kachel, ALTER Dienst:',
    'spotify',
    'alt',
    'raster',
    'der Wettlauf aus E24/O1 ist damit vollstaendig Server-Sache',
  )

  // ── DIE GEGENPROBE, die es seit dem 03.08.2026 gibt ──────────────────
  // Laeuft NICHTS, war der Abstand schon immer umsonst. Seit E95/V heisst
  // die Gegenprobe: auch aus der Stille heraus aendert sich am Wunsch nichts.
  await fall(
    'Fall 6 — nichts laeuft, ALTER Dienst (Gegenprobe):',
    'still',
    'alt',
    'weiter',
    'auch aus der Stille heraus: ein Wunsch, kein Selbst-Anhalten',
  )

  await fall(
    'Fall 7 — Dienst meldet NICHTS-ZU-TUN (Gegenprobe):',
    'still',
    'nichts-zu-tun',
    'weiter',
    'die Seite fragt den Dienst gar nicht mehr selbst',
  )
} catch (e) {
  /* DER LETZTE FANG. Hierher kommt seit dem 19.09.2026 nur noch, was NICHT
   * einem einzelnen Fall gehoert — die Faelle fangen selbst. Und auch hier
   * steht ein Satz statt eines Stacktrace: `AUFBAU FEHLT` heisst „die Lage
   * stimmte nicht", `ABBRUCH` heisst „die Messung selbst ging kaputt". */
  console.error(`  ${e instanceof AufbauFehlt ? 'AUFBAU FEHLT' : 'ABBRUCH'}  ${e.message}`)
  fehler++
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  //
  // JEDER SCHRITT EINZELN GEFANGEN: stand hier `await brw.schliessen()` nackt,
  // nahm ein Wurf daraus das Zurueckgeben mit — und dann steht die geliehene
  // Vorschau verstellt da, WEIL aufgeraeumt werden sollte.
  try {
    await brw.schliessen()
  } catch (e) {
    console.error(`  der eigene Browser liess sich nicht schliessen: ${e.message}`)
  }
  try {
    await leihe.zurueckgeben()
  } catch (e) {
    console.error(`  die geliehene Lage liess sich nicht zuruecklegen: ${e.message}`)
  }
  // ── UND JETZT DER KAPUTTE STAND, DER NICHT ZURUECK DARF ─────────────────
  // `zurueckgeben()` legt hin, was vorgefunden wurde — also auch eine
  // `liste=kaputt`, die ein abgebrochener Lauf hinterlassen hat. Daran starb
  // am 19.09.2026 der naechste Schritt des Laeufers (lane-marken-schau, ohne
  // jedes `try`). Die Ausnahme steht hier, HINTER dem Zuruecklegen — davor
  // waere sie wirkungslos —, und sie gilt fuer genau das eine Feld.
  if (fremdeListe !== null) {
    try {
      await holen(`/vorschau/${BRAUCHT_LISTE}`, 'der Umschalter der Vorschau')
      console.warn(`  die vorgefundene liste=${fremdeListe} wurde NICHT zurueckgelegt — sie steht jetzt auf ${BRAUCHT_LISTE}.`)
      console.warn('  (ein abgebrochener Lauf hat sie verstellt; die Schritte danach messen sonst Phantome)')
    } catch (e) {
      console.error(`  die Medienliste liess sich nicht wieder herstellen: ${e.message}`)
    }
  }
  // DIE BILANZ-ZEILE STEHT IM `finally` UND NICHT IM `try`: sie ist das
  // Urteil, und ein Urteil, das bei einem Abbruch ausfaellt, laesst den Leser
  // mit einem Einzeiler zurueck, den er nicht einordnen kann.
  console.log(`\n${fehler ? `${fehler} Abweichung(en)` : 'keine Abweichung'}`)
}

process.exit(PRUEFEN && fehler ? 1 : 0)
