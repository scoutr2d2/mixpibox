#!/usr/bin/env node
/**
 * DER SPIELE-SCHALTER — wirkt er wirklich, und wirkt er SOFORT?
 *
 * ══ WOZU ════════════════════════════════════════════════════════════════
 *
 * Betreiberwunsch 19.09.2026: „bei vorlesen noch die spiele als einschalt
 * option mit reinnehmen". Vorher liess sich die Spielecke NIRGENDS
 * abschalten — sie oeffnet sich ueber die Fernbedienungs-Anweisung
 * `spielecke` und kam in der Verwaltung gar nicht vor.
 *
 * Der Schalter geht durch vier Haende: Verwaltungsseite -> PUT /api/vorlesen
 * -> `einstellungenNormalisieren` -> GET /api/vorlesen -> `stimme.laden()`
 * in app.js -> `spieleckeOeffnen()`. Die Zeugen in vorlesen.spec.ts messen
 * das MODELL; hier wird die KETTE gemessen, und zwar durch den Browser, weil
 * nur dort steht, ob die Tuer wirklich zu ist.
 *
 * ══ DREI FRAGEN, UND DIE DRITTE IST DIE, DIE MAN VERGISST ═══════════════
 *
 *   1. AN  -> die Anweisung `spielecke` oeffnet das Spiel.
 *   2. AUS -> dieselbe Anweisung oeffnet NICHTS. Ohne diese Gegenrichtung
 *      beweist (1) gar nichts: ein Spiel, das immer aufgeht, besteht sie
 *      auch.
 *   3. AUS WAEHREND GESPIELT WIRD -> das laufende Spiel wird beendet. Wer
 *      abschaltet, meint JETZT; faellt der Schalter erst, wenn das Kind von
 *      selbst aufhoert, braucht ihn niemand mehr. Diese Messung kostet
 *      einen Vorlese-Takt (15 s) und ist trotzdem die wichtigste: sie ist
 *      die einzige, die die Zusage der Verwaltungsseite prueft („ein gerade
 *      laufendes Spiel wird binnen einer halben Minute beendet").
 *
 * ══ WARUM DIE ANWEISUNG UND KEIN DIREKTER AUFRUF ════════════════════════
 *
 * `spieleckeOeffnen()` steht in einer Kapsel und ist von aussen nicht zu
 * rufen — gut so. Gemessen wird deshalb der ECHTE Weg: die Attrappe nimmt
 * per POST /api/fernbedienung/anweisung einen Tastendruck an, die Seite holt
 * ihn im Takt ab. Ein Werkzeug, das die Kapsel aufbricht, misst einen Weg,
 * den es an der Box nicht gibt.
 *
 * ══ WARTEN AUF EINEN ZUSTAND, NICHT AUF EINE ZAHL ═══════════════════════
 *
 * DIE ERSTE FASSUNG DIESES WERKZEUGS WAR FLATTERHAFT, und sie hat es teuer
 * gezeigt: zweimal derselbe Sabotage-Lauf, zweimal ein anderes Ergebnis —
 * einmal eine Abweichung, einmal drei, und beim ersten Mal auf der FALSCHEN
 * Zeile. Ursachen waren zwei, und beide sind Anfaengerfehler mit teurer
 * Wirkung:
 *
 *   1. FESTE WARTEZEITEN. `warte(1200)` nach einem Tastendruck ist eine
 *      Wette darauf, dass die Seite ihn in dieser Zeit holt. Verliert man
 *      sie, meldet das Werkzeug „blieb zu" — also den Erfolg des Fehlers.
 *      Jetzt wird auf einen ZUSTAND gewartet, mit Frist; laeuft die Frist
 *      ab, ist DAS der Befund und nicht ein stilles Weiter.
 *   2. ZUSTAND AUS DEM VORIGEN SCHRITT. `spieleckeOeffnen()` steigt bei
 *      `spiel.an` sofort aus. Blieb ein Spiel aus Schritt 1 offen, sah
 *      Schritt 2 „offen" und urteilte ueber den Schalter, obwohl er nie
 *      gefragt wurde. Jetzt beginnt JEDE Messung mit einem frischen
 *      Seitenaufbau.
 *
 * UND DIE ZWEIDEUTIGKEIT, DIE DAS GANZE ERST MOEGLICH MACHTE: „das Spiel
 * blieb zu" kann heissen, dass der Schalter wirkt — oder dass der
 * Tastendruck nie ankam. Deshalb sieht das Werkzeug ueber
 * `/vorschau/anweisungen` nach, OB DIE SEITE DEN TASTENDRUCK GEHOLT HAT,
 * bevor es ueber die Tuer urteilt. Die Schau nimmt dabei nichts aus dem
 * Fach (im Gegensatz zu GET /api/fernbedienung/anweisung, das entnimmt).
 *
 * ══ SEIT DEM 20.09.2026 DREI FRAGEN MEHR ════════════════════════════════
 *
 * Betreiber: „in der spiele sektion will ich das vorlesen noch einschalten
 * koennen und auch verschiedene spiele ein und ausschalten koennen."
 *
 *   4. EINZELSCHALTER: Steht nur EIN Spiel an, faellt die Auswahl weg und
 *      genau dieses startet. Gemessen wird der Kopf des Blattes — er traegt
 *      den Namen des laufenden Spiels, und das ist die einzige Stelle
 *      ausserhalb der Zeichenflaeche, an der ueberhaupt steht, WAS laeuft.
 *   5. JEDES SPIEL EINZELN AUS heisst zu. Sonst ginge die Tuer auf und
 *      dahinter staende eine leere Liste.
 *   6. DIE STIMME: eingeschaltet spricht das Oeffnen, ausgeschaltet nicht.
 *      Beide Richtungen, denn eine Box, die immer schweigt, besteht die
 *      erste Haelfte muehelos.
 *   7. DIE SCHUBLADE, der ZWEITE Spielort (Tipp-Apps am Schirm, apps.js).
 *      Sie war bis zum 20.09.2026 nirgends abschaltbar. Gemessen wird
 *      OHNE Seitenaufbau: Der Schalter muss im laufenden Betrieb wirken,
 *      und `schubladeBauen` steigt bei gleicher Werkliste frueh aus — ein
 *      Abschalten, das erst beim naechsten Kiosk-Start ankommt, wuerde
 *      genau hier durchrutschen.
 *
 * AUFRUF
 *     node tools/spiele-schalter-schau.mjs
 *     node tools/spiele-schalter-schau.mjs --pruefen
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** Der Vorlese-Takt in app.js (TAKT_VORLESEN) plus Luft fuer die Antwort. */
const TAKT_MS = 15000

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

/** Einen Tastendruck in das Fach der Attrappe legen — der echte Weg. */
async function anweisung(was) {
  const a = await fetch(new URL('/api/fernbedienung/anweisung', ZIEL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ was }),
  }).catch(() => null)
  return a?.ok === true
}

/**
 * Die Lage stellen UND NACHSEHEN, DASS SIE STEHT.
 *
 * WARUM NACHSEHEN: `/vorschau/spiele-aus` ist ein Schuss ins Blaue —
 * antwortet die Vorschau nicht, faellt sie auf einen Auffangzweig zurueck
 * oder gehoert sie einem anderen Arbeitsbaum, in dem es den Schalter noch
 * gar nicht gibt, dann misst dieser Lauf hinterher den EINGESCHALTETEN
 * Zustand und nennt ihn „ausgeschaltet". Die Vorschau wird geliehen
 * [[vorschau-wird-geliehen]]; wer leiht, prueft.
 *
 * Gefragt wird die Stelle, an der es die OBERFLAECHE auch abholt:
 * GET /api/vorlesen. Nicht der Lage-Schalter, sondern seine Wirkung.
 */
async function lage(w, erwartetSpiele) {
  await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
  await warte(150)
  if (erwartetSpiele === undefined) return true
  // SEIT DEM 20.09.2026 HAT DER BEREICH EINE EIGENE ROUTE. Gefragt wird die
  // Stelle, an der es die OBERFLAECHE auch abholt — nicht der Lage-Schalter,
  // sondern seine Wirkung.
  const a = await fetch(new URL('/api/spiele', ZIEL)).catch(() => null)
  const j = a ? await a.json().catch(() => null) : null
  const ist = j?.an
  if (ist === erwartetSpiele) return true
  melde(
    `die Vorschau meldet nach /vorschau/${w} weiterhin spiele=${JSON.stringify(ist)} ` +
      `statt ${erwartetSpiele} — gemessen wuerde sonst der falsche Zustand`,
  )
  return false
}

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  /** Steht das Spielblatt im Baum? */
  const offen = () => ev(`!!document.getElementById('spielecke')`)

  /** Warten, bis `pruef()` wahr wird — oder die Frist abgelaufen ist. */
  async function bis(pruef, msMax, takt = 200) {
    const ende = Date.now() + msMax
    for (;;) {
      if (await pruef()) return true
      if (Date.now() > ende) return false
      await warte(takt)
    }
  }

  /** Frisch laden: `spiel.an` ist danach sicher false. */
  async function frisch() {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2500)
  }

  /**
   * Einen Tastendruck absetzen UND abwarten, dass die SEITE ihn geholt hat.
   * Gibt false zurueck, wenn er liegenbleibt — dann sagt der Aufrufer das,
   * statt ueber eine Tuer zu urteilen, an die nie jemand geklopft hat.
   */
  async function gedrueckt(was) {
    if (!(await anweisung(was))) return false
    return bis(async () => {
      const a = await fetch(new URL('/vorschau/anweisungen', ZIEL)).catch(() => null)
      const j = a ? await a.json().catch(() => null) : null
      return Array.isArray(j?.offen) && j.offen.length === 0
    }, 6000)
  }

  // ── VORBEDINGUNG: NIMMT DIE ATTRAPPE UEBERHAUPT ANWEISUNGEN AN ─────────
  if (!(await anweisung('unsinn-zur-probe'))) {
    melde('die Vorschau nimmt keine Anweisungen an (POST /api/fernbedienung/anweisung) — ohne die misst dieses Werkzeug nichts')
    console.log(`\n  ${fehler} Abweichung(en)`)
    process.exit(PRUEFEN ? 1 : 0)
  }
  zeile('Vorbedingung: Anweisungen kommen an', 'ja')

  // ── DIE AUSGANGSLAGE HERSTELLEN, NICHT VORAUSSETZEN ───────────────────
  //
  // GEMESSEN, NICHT BEFUERCHTET (20.09.2026): Ein Lauf begann mit einer
  // Vorschau, in der aus einer frueheren Messung noch „nur ein Spiel an"
  // stand — und meldete prompt, die Tuer gehe bei eingeschalteten Spielen
  // nicht auf. Das ist derselbe Fehler, den der Kopf dieser Datei unter
  // „Zustand aus dem vorigen Schritt" schon einmal beschreibt: Ein
  // `finally`, das aufraeumt, hilft nur dem NAECHSTEN Lauf — und auch nur,
  // wenn der vorige heil zu Ende kam. [[vorschau-wird-geliehen]]
  await lage('alle-spiele')
  await lage('spielstimme-aus')
  await lage('alle-apps')

  // ── 1. AN: die Tuer geht auf ───────────────────────────────────────────
  await lage('spiele-an', true)
  await frisch()
  const geholt1 = await gedrueckt('spielecke')
  if (!geholt1) melde('die Seite hat den Tastendruck nicht abgeholt — der Messweg selbst ist kaputt, nicht die Tuer')
  const auf = await bis(offen, 3000)
  zeile('Spiele AN: die Anweisung oeffnet das Spiel', auf ? 'ja' : 'NEIN')
  if (geholt1 && !auf) melde('bei eingeschalteten Spielen ging die Spielecke nicht auf')

  // ── 2. AUS: dieselbe Anweisung tut nichts ──────────────────────────────
  //
  // FRISCH, damit kein Spiel aus Schritt 1 offensteht: sonst urteilte diese
  // Messung ueber eine Tuer, an der `spiel.an` schon vorher abgewiesen hat.
  await lage('spiele-aus', false)
  await frisch()
  const geholt2 = await gedrueckt('spielecke')
  if (!geholt2) {
    melde('die Seite hat den Tastendruck nicht abgeholt — „blieb zu" waere hier kein Urteil ueber den Schalter')
  } else {
    // Der Tastendruck IST geholt. Bleibt das Blatt jetzt noch kurz weg, ist
    // das ein Urteil ueber die Tuer und nicht ueber die Laufzeit.
    const gingAuf = await bis(offen, 2000)
    zeile('Spiele AUS: dieselbe Anweisung oeffnet nichts', gingAuf ? 'NEIN' : 'ja')
    if (gingAuf) melde('bei abgeschalteten Spielen ging die Spielecke trotzdem auf')
  }

  // ── 3. ABSCHALTEN WAEHREND GESPIELT WIRD ───────────────────────────────
  await lage('spiele-an', true)
  await frisch()
  await gedrueckt('spielecke')
  const laeuft = await bis(offen, 3000)
  if (!laeuft) {
    melde('fuer die dritte Messung liess sich kein Spiel oeffnen — sie faellt aus, statt gruen zu tun')
  } else {
    await lage('spiele-aus', false)
    console.log(`  … wartet auf den Vorlese-Takt (bis ${(TAKT_MS + 6000) / 1000} s), bis die Seite den Schalter holt`)
    const zuGegangen = await bis(async () => !(await offen()), TAKT_MS + 6000, 500)
    zeile('Abschalten waehrend des Spiels beendet es', zuGegangen ? 'ja' : 'NEIN')
    if (!zuGegangen) {
      melde('der Schalter wurde umgelegt, das laufende Spiel lief weiter — die Zusage der Verwaltungsseite haelt nicht')
    }
  }

  // ── 4. NUR EIN SPIEL AN: KEINE AUSWAHL, SONDERN SOFORT DIESES ─────────
  //
  // Gemessen am KOPF des Blattes. Die Auswahl steht auf der Zeichenflaeche
  // und ist von aussen nicht lesbar; der Kopf traegt dagegen entweder
  // „Spiele" (Auswahl) oder den Namen des laufenden Spiels.
  const kopf = () => ev(`document.getElementById('spiel-name')?.textContent || ''`)

  await lage('spiele-an', true)
  await lage('nurspiel-memory')
  await frisch()
  if (!(await gedrueckt('spielecke'))) {
    melde('die Seite hat den Tastendruck nicht abgeholt — Messung 4 faellt aus')
  } else {
    const direkt = await bis(async () => (await kopf()) === 'Paare', 4000)
    zeile('Nur „Paare" an: startet ohne Auswahl', direkt ? 'ja' : 'NEIN')
    if (!direkt) {
      melde(`bei einem einzigen eingeschalteten Spiel stand im Kopf „${await kopf()}" statt „Paare"`)
    }
  }

  // ── 5. JEDES SPIEL EINZELN AUS: DIE TUER BLEIBT ZU ────────────────────
  await lage('kein-spiel')
  await frisch()
  if (!(await gedrueckt('spielecke'))) {
    melde('die Seite hat den Tastendruck nicht abgeholt — „blieb zu" waere hier kein Urteil')
  } else {
    const gingAuf = await bis(offen, 2000)
    zeile('Jedes Spiel einzeln aus: nichts geht auf', gingAuf ? 'NEIN' : 'ja')
    if (gingAuf) melde('mit lauter abgeschalteten Spielen ging die Spielecke trotzdem auf')
  }
  await lage('alle-spiele')

  // ── 6. DIE STIMME IM SPIELBEREICH, BEIDE RICHTUNGEN ───────────────────
  //
  // Die Vorschau schreibt jede Ansage in ein Protokoll; gefragt wird also
  // nicht „hat es geklungen" (das kann niemand messen), sondern „ist der
  // Satz abgeschickt worden".
  const gesprochen = async () => {
    const a = await fetch(new URL('/vorschau/gesprochen', ZIEL)).catch(() => null)
    const j = a ? await a.json().catch(() => null) : null
    return Array.isArray(j?.gesprochen) ? j.gesprochen.map((g) => g.text) : []
  }
  const protokollLeeren = () => fetch(new URL('/vorschau/gesprochen-leeren', ZIEL)).catch(() => null)

  await lage('spielstimme-an')
  await frisch()
  await protokollLeeren()
  if (!(await gedrueckt('spielecke'))) {
    melde('die Seite hat den Tastendruck nicht abgeholt — Messung 6 faellt aus')
  } else {
    await bis(offen, 3000)
    const mitStimme = await bis(async () => (await gesprochen()).length > 0, 4000)
    zeile('Stimme AN: das Oeffnen wird angesagt', mitStimme ? 'ja' : 'NEIN')
    if (!mitStimme) melde('mit eingeschalteter Spielstimme wurde beim Oeffnen kein Satz abgeschickt')

    // UND DIE GEGENRICHTUNG. Ohne sie beweist die Messung darueber nichts:
    // eine Oberflaeche, die IMMER spricht, besteht sie auch.
    await lage('spielstimme-aus')
    await frisch()
    await protokollLeeren()
    if (await gedrueckt('spielecke')) {
      await bis(offen, 3000)
      // Eine Sekunde Nachlauf: Ein Satz, der erst spaeter kaeme, wuerde
      // sonst als „geschwiegen" durchgehen.
      await warte(1200)
      const still = (await gesprochen()).length === 0
      zeile('Stimme AUS: kein Satz wird abgeschickt', still ? 'ja' : 'NEIN')
      if (!still) melde(`mit ausgeschalteter Spielstimme wurde gesprochen: ${JSON.stringify(await gesprochen())}`)
    }
  }

  // ── 7. DIE SCHUBLADE: EINE APP AUS, DIE ANDEREN BLEIBEN ───────────────
  //
  // `.sch-app` steht im Baum, auch wenn die Schublade zu ist — gezaehlt wird
  // also die Leiste selbst und nicht, was gerade sichtbar ist.
  const schubApps = async () =>
    String((await ev(`[...document.querySelectorAll('.sch-app')].map(b => b.dataset.app).join(',')`)) || '')
      .split(',')
      .filter(Boolean)

  await lage('alle-apps')
  await frisch()
  const vorher = await bis(async () => (await schubApps()).length > 0, 8000)
  if (!vorher) {
    melde('die Schublade blieb leer — ohne eine einzige App misst dieser Schritt nichts')
  } else {
    const alle = await schubApps()
    // NICHT IRGENDEINE APP: „malen" braucht weder Bibliothek noch Stimme und
    // ist deshalb immer dabei. Eine App zu waehlen, die schon an `kann()`
    // scheitern kann, hiesse den eigenen Schalter mit fremden Gruenden
    // verwechseln.
    if (!alle.includes('malen')) {
      melde(`„malen" fehlt in der Schublade (${alle.join(', ') || 'leer'}) — der Messpunkt selbst stimmt nicht`)
    } else {
      // OHNE NEUEN SEITENAUFBAU: der Schalter muss im Lauf ankommen.
      await lage('app-aus-malen')
      console.log(`  … wartet auf den Vorlese-Takt (bis ${(TAKT_MS + 6000) / 1000} s), bis die Schublade nachzieht`)
      const weg = await bis(async () => !(await schubApps()).includes('malen'), TAKT_MS + 6000, 500)
      zeile('Schublade: abgeschaltete App verschwindet', weg ? 'ja' : 'NEIN')
      if (!weg) melde('„malen" wurde abgeschaltet und stand weiter in der Schublade')

      const rest = await schubApps()
      const andereDa = rest.length > 0
      zeile('Schublade: die anderen bleiben', andereDa ? 'ja' : 'NEIN')
      if (!andereDa) melde('mit EINER abgeschalteten App war die ganze Schublade leer — der Schalter trifft zu viel')

      // UND ZURUECK, sonst beweist das Verschwinden nichts: eine Schublade,
      // die nach 15 s immer leer laeuft, bestuende die Messung auch.
      await lage('alle-apps')
      const wiederDa = await bis(async () => (await schubApps()).includes('malen'), TAKT_MS + 6000, 500)
      zeile('Schublade: wieder AN, und sie ist zurueck', wiederDa ? 'ja' : 'NEIN')
      if (!wiederDa) melde('nach dem Wiedereinschalten kam „malen" nicht zurueck')
    }
  }

  // ── UND DIE GEGENKONTROLLE, OHNE DIE DIE DREI NICHTS BEWEISEN ──────────
  //
  // Eine Seite, auf der GAR NICHTS mehr geht, besteht Messung 2 und 3
  // muehelos.
  await lage('spiele-an', true)
  await frisch()
  await gedrueckt('spielecke')
  const wieder = await bis(offen, 3000)
  zeile('Gegenkontrolle: wieder AN, und es geht wieder auf', wieder ? 'ja' : 'NEIN')
  if (!wieder) melde('nach dem Wiedereinschalten ging die Spielecke nicht mehr auf — der Weg ist kaputt, nicht gesperrt')

  console.log(fehler ? `\n  ${fehler} Abweichung(en)` : '\n  ohne Abweichung')
} finally {
  // Im `finally`, damit eine geliehene Vorschau nicht gerade dann verstellt
  // stehenbleibt, wenn dieser Lauf etwas gefunden hat.
  await lage('spiele-an').catch(() => null)
  // Die neuen Lagen sind genauso klebrig wie die alten — wer sie stehen
  // laesst, misst der naechsten Messung eine Box vor, die still ist oder nur
  // ein Spiel kennt. [[vorschau-wird-geliehen]]
  await lage('alle-spiele').catch(() => null)
  await lage('spielstimme-aus').catch(() => null)
  await lage('alle-apps').catch(() => null)
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
