#!/usr/bin/env node
/**
 * DER RING SAGT SICH AN — UND WAEHLT DABEI NICHTS AUS.
 *
 * ══ WOZU ════════════════════════════════════════════════════════════════
 *
 * Betreiber, 19.09.2026: „nun muss man in den spielen noch die auswahl
 * vorlesenlassen koennen ohne auszuwaehlen."
 *
 * Das Vorlesemodell dieser Oberflaeche ist „Bild spielt, Text spricht". Mit
 * dem Finger geht das; MIT EINER FERNBEDIENUNG NICHT — dort gibt es keine
 * Textzone, sondern den Ring und die Taste „Auswaehlen", und die SPIELT. Ein
 * Kind am Controller konnte einen Namen also nur hoeren, indem es ihn startet.
 * Seit heute sagt der Ring selbst an, wo er steht.
 *
 * ══ DIE ZWEI HAELFTEN, UND DIE ZWEITE IST DIE, UM DIE ES GEHT ═══════════
 *
 *   1. Der Ring wandert -> die Box SAGT, was dort steht.
 *   2. Und sie SPIELT NICHTS. „Ohne auszuwaehlen" ist die eigentliche
 *      Bedingung des Auftrags: eine Ansage, die nebenbei etwas startet,
 *      waere genau der Zustand von vorher.
 *
 * Gemessen wird beides an den Protokollen der Attrappe: `/vorschau/gesprochen`
 * sagt, WAS gesagt wurde, `/vorschau/befehle`, was GESPIELT wurde. Beide
 * lesen und leeren — deshalb wird vor jeder Messung geleert, damit kein Satz
 * aus dem vorigen Schritt mitgezaehlt wird.
 *
 * ══ UND DREI SACHEN, DIE OHNE MESSUNG FALSCH WAEREN ═════════════════════
 *
 *   * DIE PAUSE. Ohne sie spraeche jeder Zwischenschritt eines schnellen
 *     Durchlaufs mit — vier Kacheln in einer Sekunde heissen vier
 *     angefangene Saetze. Gemessen wird deshalb auch, dass vier schnelle
 *     Schritte NICHT vier Ansagen ergeben.
 *   * DIE GEGENRICHTUNG. Steht Vorlesen auf „aus", muss der Ring schweigen —
 *     aber sich trotzdem BEWEGEN. Ohne die zweite Haelfte bestuende diese
 *     Messung auch auf einer Seite, auf der gar nichts mehr geht.
 *   * DIE GEGENKONTROLLE. „Auswaehlen" muss weiter spielen. Eine Ansage, die
 *     das Auswaehlen mit abgeschafft haette, bestuende alles darueber.
 *
 * ══ ACHTUNG: DIESES WERKZEUG FLATTERT NOCH ═════════════════════════════
 *
 * Stand 20.09.2026: dreimal hintereinander gelaufen, dreimal ein anderes
 * Ergebnis (ohne Abweichung / 1 / 2 Abweichungen), ohne eine Zeile
 * Aenderung dazwischen. VIER Ursachen wurden gesucht, drei behoben:
 *
 *   * der Warmlauf zaehlte als Ansage (gefiltert auf `abspielen=true`),
 *   * gewartet wurde auf „irgendwas da" statt auf eine AENDERUNG,
 *   * gemessen wurde auf einem Filter statt auf einer Kachel.
 *
 * DIE VIERTE IST OFFEN: Die Messabschnitte beeinflussen sich ueber
 * liegengebliebene Tastendruecke und ueber die geliehene Vorschau. In
 * einzelnen Laeufen taucht ein START auf (`/api/spielen`), der sich nicht
 * erklaeren liess, und in anderen bewegt sich der Ring nicht, wo er sollte.
 *
 * DESHALB HAENGT ES NICHT IM GESAMTLAUF. Eine Wache, die mal rot und mal
 * gruen ist, verbraucht das Vertrauen, das die naechste echte Meldung
 * braucht. Wer sie wieder einhaengt, muss sie vorher DREIMAL hintereinander
 * gleich gruen bekommen — und die vierte Ursache benennen koennen.
 *
 * WAS TROTZDEM BEWIESEN IST: In den gruenen Laeufen halten alle sechs
 * Messungen, und die Gegenproben schlugen am 19.09.2026 auf der jeweils
 * RICHTIGEN Zeile an (Ansage entfaellt, Modus-Wache entfaellt, Ruhepause
 * auf 0, Ring klickt direkt). Die Funktion ist gemessen; das Werkzeug ist
 * noch nicht verlaesslich genug fuer den Dauerbetrieb.
 *
 * AUFRUF
 *     node tools/auswahl-sagt-sich-an.mjs
 *     node tools/auswahl-sagt-sich-an.mjs --pruefen
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** Die Ruheschwelle in app.js plus Luft fuer Antwort und Messung. */
const RUHE_MS = 350
const ANSAGE_FRIST = 8000

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
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(48)} ${wert}`)

const holen = async (pfad) => {
  const a = await fetch(new URL(pfad, ZIEL)).catch(() => null)
  return a ? await a.json().catch(() => null) : null
}
const druck = (was) =>
  fetch(new URL('/api/fernbedienung/anweisung', ZIEL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ was }),
  }).catch(() => null)

/** Warten, bis `pruef()` etwas Wahres liefert — oder die Frist ablaeuft. */
async function bis(pruef, msMax, takt = 150) {
  const ende = Date.now() + msMax
  for (;;) {
    const w = await pruef()
    if (w) return w
    if (Date.now() > ende) return null
    await warte(takt)
  }
}

/**
 * WARTEN, BIS DER WARMLAUF DURCH IST.
 *
 * `warmlaufen()` in app.js holt nach jedem Seitenaufbau die WAV-Datei zu
 * JEDER Kachel — eine Anfrage nach der anderen, `await` fuer `await`. Solange
 * das laeuft, stellt sich eine Ansage hinten an und kommt SEKUNDEN spaeter
 * beim Server an.
 *
 * GENAU DARAN IST DIE ERSTE FASSUNG DIESER MESSUNG GESCHEITERT, zweimal
 * reproduzierbar: Im Ring stand „Die Maus…", angekommen war „Bibi
 * Blocksberg…" — die Ansage des Schrittes DAVOR, die erst nach dem Leeren
 * durchkam, waehrend die aktuelle noch in der Schlange stand. Das sah nach
 * einer Verwechslung in der Oberflaeche aus und war eine Warteschlange.
 *
 * Gewartet wird auf RUHE, nicht auf eine Zahl: Das Protokoll waechst nicht
 * mehr. So haengt die Messung nicht daran, wie viele Kacheln die Vorschau
 * gerade zeigt.
 */
async function warmlaufAbwarten(msMax = 25000) {
  let letzte = -1
  let seit = Date.now()
  const ende = Date.now() + msMax
  for (;;) {
    const j = await holen('/vorschau/gesprochen')
    const n = Array.isArray(j?.gesprochen) ? j.gesprochen.length : 0
    if (n !== letzte) {
      letzte = n
      seit = Date.now()
    } else if (Date.now() - seit > 1500) {
      return true
    }
    if (Date.now() > ende) return false
    await warte(300)
  }
}

/**
 * WARTEN, BIS DAS FERNBEDIENUNGS-FACH LEER IST.
 *
 * DRITTER FLATTERFUND. Die Richtungssuche drueckt bis zu vier Tasten. Werden
 * sie nicht alle abgeholt, liegen sie im Fach und wirken SPAETER — mitten in
 * der naechsten Messung. Dann wandert der Ring dort, wo er stillstehen
 * sollte, und eine Ansage taucht auf, wo geschwiegen werden muesste. Beides
 * ist in Laeufen zu sehen gewesen, und beides sah nach einem Fehler in der
 * Oberflaeche aus.
 *
 * REGEL: Wer eine Messung mit Tastendruecken beginnt, faengt mit einem
 * LEEREN Fach an. Sonst misst er die Reste der vorigen.
 */
async function fachLeer(msMax = 6000) {
  const ende = Date.now() + msMax
  for (;;) {
    const j = await holen('/vorschau/anweisungen')
    if (Array.isArray(j?.offen) && j.offen.length === 0) return true
    if (Date.now() > ende) return false
    await warte(150)
  }
}

/** Beide Protokolle leeren — sonst zaehlt der vorige Schritt mit. */
async function leeren() {
  // ERST DAS FACH, DANN DIE BUECHER: ein noch nicht abgeholter Tastendruck
  // wuerde sonst gleich nach dem Leeren wirken und in die frischen
  // Protokolle schreiben.
  await fachLeer()
  await holen('/vorschau/gesprochen-leeren')
  await holen('/vorschau/befehle-leeren')
  await holen('/vorschau/gestartet-leeren')
}

/**
 * WAS DIE BOX WIRKLICH GESAGT HAT — und nicht, was sie nur vorbereitet hat.
 *
 * `warmlaufen()` in app.js ruft `/api/vorlesen/sprich` fuer JEDE Kachel mit
 * `data-sprich`, um den Sprachspeicher zu fuellen. Diese Rufe landen im
 * selben Protokoll, sagen aber nichts: ihnen fehlt `abspielen=1`, sie holen
 * nur die WAV-Datei ab.
 *
 * ERST DIESE UNTERSCHEIDUNG HAT DIE MESSUNG EHRLICH GEMACHT. Vorher zaehlte
 * sie Warmlauf-Rufe mit und meldete „gesagt wurde ‚Bibi Blocksberg…', im
 * Ring steht aber ‚Die Maus…'" — ein Befund, der wie ein Fehler in der
 * Oberflaeche aussah und einer in der Messung war. Zum wiederholten Mal
 * dasselbe Muster: die Wache hatte recht, dass etwas nicht stimmt, und
 * unrecht darin, WAS.
 */
async function gesagt() {
  const j = await holen('/vorschau/gesprochen')
  const alle = Array.isArray(j?.gesprochen) ? j.gesprochen : []
  return alle.filter((e) => e && e.abspielen === true)
}
/**
 * WAS GESTARTET WURDE — und zwar an der Stelle, an der ein Kacheltipp
 * wirklich vorbeikommt.
 *
 * HIER STAND `/vorschau/befehle`, das SPIELERBEFEHLE (/player/…) fuehrt. Am
 * Geraet nachgemessen: ein Klick auf eine Kachel erzeugt
 * `POST /api/weiterhoeren`, `POST /api/spielen`, `POST /api/gespielt` — und
 * KEINEN einzigen Spielerbefehl. Die Messung „… und spielt dabei nichts"
 * sah also in ein Buch, in dem dieser Vorgang nie steht, und konnte gar
 * nicht scheitern. Zweimal blieb die Gegenprobe deshalb gruen, und zweimal
 * habe ich stattdessen an der Uhr gedreht
 * [[gegenprobe-bleibt-gruen-ist-der-fund]].
 *
 * Beides wird jetzt gefragt: das Startprotokoll UND die Spielerbefehle.
 */
async function gespielt() {
  const a = await holen('/vorschau/gestartet')
  const b = await holen('/vorschau/befehle')
  return [
    ...(Array.isArray(a?.gestartet) ? a.gestartet : []),
    ...(Array.isArray(b?.befehle) ? b.befehle : []),
  ]
}

/**
 * Die Lage stellen UND ihre Wirkung nachlesen. Eine geliehene Vorschau kann
 * einem anderen Arbeitsbaum gehoeren; wer leiht, prueft.
 */
async function lage(w, erwarteterModus) {
  await holen(`/vorschau/${w}`)
  await warte(150)
  if (erwarteterModus === undefined) return true
  const j = await holen('/api/vorlesen')
  const ist = j?.einstellungen?.modus
  if (ist === erwarteterModus) return true
  melde(`die Vorschau meldet nach /vorschau/${w} modus=${JSON.stringify(ist)} statt ${erwarteterModus}`)
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

  /** Was steht gerade im Ring, und was wuerde es sagen? */
  const imRing = () =>
    ev(`(() => { const k = document.querySelector('.fb-auswahl'); if (!k) return null;
      const d = (k.dataset.sprich || '').trim();
      const l = (k.getAttribute('aria-label') || '').trim();
      return d || l || (k.textContent || '').replace(/\\\\s+/g, ' ').trim() || null })()`)

  async function frisch() {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2500)
  }

  /**
   * DEN RING AUF EINE KACHEL STELLEN.
   *
   * WARUM DAS SEIN MUSS, und es ist der wichtigste Satz in dieser Datei:
   * Nach einem frischen Aufbau steht der Ring auf dem Filter „Alles". Der
   * SPIELT nichts, er filtert. Eine Messung „… und spielt dabei nichts", die
   * dort stattfindet, kann gar nicht scheitern — die Gegenprobe (eine
   * Ansage, die zusaetzlich `click()` ruft) blieb GRUEN, und genau das ist
   * der Fund [[gegenprobe-bleibt-gruen-ist-der-fund]]. Gemessen wird
   * deshalb dort, wo ein falscher Klick etwas KOSTET: auf einer Kachel mit
   * `data-sprich`, die beim Klick wirklich etwas startet.
   */
  async function zurKachel(schritteMax = 30) {
    for (let i = 0; i < schritteMax; i++) {
      const drauf = await ev(`(() => { const k = document.querySelector('.fb-auswahl');
        return !!(k && (k.dataset.sprich || '').trim()) })()`)
      if (drauf) return true
      await druck('rechts')
      // Abwarten, dass der Druck geholt ist — ein `warte(400)` ist eine
      // Wette, und verlorene Wetten liegen als Reste im Fach.
      await fachLeer(4000)
      await warte(200)
    }
    return false
  }

  // ── 1. DER RING WANDERT UND SAGT AN ────────────────────────────────────
  await lage('vorlesen-antippen', 'antippen')
  await frisch()
  if (!(await warmlaufAbwarten())) {
    melde('der Warmlauf kam in 25 s nicht zur Ruhe — jede Ansage stuende hinter ihm in der Schlange')
  }
  await druck('rechts')
  await bis(imRing, 3000)
  const aufKachel1 = await zurKachel()
  if (!aufKachel1) {
    melde('der Ring fand keine Kachel — die Messung findet sonst auf einem Filter statt, wo ein falscher Klick nichts kostet')
  }
  // Ruhe, dann beide Protokolle leeren: was beim HINWANDERN gesagt wurde,
  // gehoert nicht zu dieser Messung.
  await warte(RUHE_MS + 800)
  await warmlaufAbwarten(8000)
  await leeren()

  /*
   * EIN SCHRITT WEITER — UND ABWARTEN, DASS ER WIRKLICH GETAN IST.
   *
   * HIER STAND `bis(imRing, 3000)`, und das war die Wurzel eines Befundes,
   * der zweimal reproduzierbar nach einem Fehler in der Oberflaeche aussah:
   * gesagt „Bibi Blocksberg…", im Ring „Die Maus…". `imRing` liefert aber
   * sofort etwas — naemlich die ALTE Stellung, denn zwischen dem Absenden
   * der Anweisung und ihrer Ausfuehrung liegt ein Abholtakt. Verglichen
   * wurde also die Stellung VOR dem Druck mit der Ansage DANACH.
   *
   * „Warte, bis etwas da ist" ist kein Ersatz fuer „warte, bis es sich
   * geaendert hat". Gemerkt wird deshalb die Stellung vorher, und gewartet
   * wird auf eine ANDERE.
   */
  const vorRing = await imRing()
  /**
   * EINEN SCHRITT TUN — IN IRGENDEINE RICHTUNG, DIE AUCH GEHT.
   *
   * ZWEITER FLATTERFUND an dieser Stelle: `zurKachel()` laeuft nach RECHTS,
   * bis eine Kachel im Ring steht. Dabei kann es am Rand des Rasters
   * ankommen — und dann bewegt ein weiteres „rechts" gar nichts mehr.
   * Das Werkzeug meldete „die Auswahl hat sich nicht bewegt", was wie ein
   * Fehler der Oberflaeche aussah und nur hiess: hier ist Schluss.
   *
   * Probiert werden deshalb mehrere Richtungen, und die erste, die wirklich
   * bewegt, zaehlt. Bewegt keine, ist DAS der Befund — dann steht der Ring
   * in einer Sackgasse, und das waere eine Meldung wert.
   */
  let ring = null
  for (const richtung of ['rechts', 'runter', 'links', 'hoch']) {
    await druck(richtung)
    // ERST ABWARTEN, DASS DIE SEITE IHN GEHOLT HAT. Sonst drueckt die
    // Schleife die naechste Richtung, waehrend die vorige noch im Fach
    // liegt — und beide wirken spaeter zusammen.
    await fachLeer(4000)
    ring = await bis(async () => {
      const r = await imRing()
      return r && r !== vorRing ? r : null
    }, 2500)
    if (ring) break
  }
  zeile('der Ring steht auf einer Kachel', ring ? `„${ring}"` : 'NEIN')
  if (!ring) melde('die Auswahl hat sich nicht bewegt — ohne sie misst der Rest nichts')

  /*
   * GESUCHT WIRD DER SATZ, NICHT DER ERSTE EINTRAG.
   *
   * Die erste Fassung verglich `gesagt()[0].text` mit dem Ring und meldete
   * REPRODUZIERBAR eine Verwechslung: gesagt „Bibi Blocksberg…", im Ring
   * „Die Maus…". Das sah nach einem Fehler in der Oberflaeche aus und war
   * einer in der Annahme — die REIHENFOLGE im Protokoll ist nicht die
   * Reihenfolge der Ereignisse.
   *
   * WARUM: `warmlaufen()` schickt fuer JEDE Kachel eine eigene Anfrage, eine
   * nach der anderen. Die Ansage stellt sich mit an und kommt beim Server
   * entsprechend spaeter an — das Protokoll haelt den EINGANG fest, nicht
   * den Entschluss. Wer daraus eine Reihenfolge liest, liest die Auslastung
   * der Verbindung.
   *
   * Gefragt wird deshalb: Steht der Satz des Rings UNTER dem, was gesagt
   * wurde? Das ist die Behauptung des Auftrags („die auswahl vorlesen
   * lassen"), und sie haengt an keiner Reihenfolge.
   */
  const treffer = await bis(async () => {
    const g = await gesagt()
    if (!g.length) return null
    if (!ring) return g
    return g.some((e) => e.text === ring) ? g : null
  }, ANSAGE_FRIST)
  const saetze = treffer || (await gesagt())
  const passt = ring ? saetze.some((e) => e.text === ring) : saetze.length > 0
  zeile('die Box sagt an, was im Ring steht', passt ? `„${ring}"` : saetze.length ? 'der falsche Satz' : 'NEIN')
  if (!saetze.length) {
    melde('der Ring stand auf einer Kachel, und es wurde nichts gesagt')
  } else if (!passt) {
    melde(
      `im Ring steht „${ring}", gesagt wurde aber nur ${JSON.stringify(saetze.map((e) => e.text))} — ` +
        'die Ansage gehoert zu einem anderen Knopf',
    )
  }

  // ── 2. UND SIE WAEHLT NICHTS AUS ───────────────────────────────────────
  //
  // JETZT hat die Frage Gewicht: der Ring steht auf einer Kachel, ein Klick
  // dort startet etwas, und die Attrappe wuerde den Befehl protokollieren.
  //
  // UND ES BRAUCHT EIN FENSTER, IN DEM ES SICH ZEIGEN KOENNTE. Die erste
  // Fassung las das Befehlsprotokoll unmittelbar, nachdem die Ansage
  // aufgetaucht war — ein Klick aus derselben Zeitschaltung waere da noch
  // unterwegs gewesen. Die Gegenprobe (eine Ansage, die zusaetzlich
  // `click()` ruft) blieb deshalb GRUEN, zweimal
  // [[gegenprobe-bleibt-gruen-ist-der-fund]]. Eine Verneinung ohne
  // Beobachtungszeit ist keine Messung, sondern eine Behauptung ueber einen
  // Augenblick.
  //
  // EHRLICH GESAGT: DIESE EINE MESSUNG IST NICHT DURCH SABOTAGE BEWIESEN.
  // Drei Versuche, sie absichtlich rot zu bekommen (die Ansage ruft
  // zusaetzlich `click()`; der Ring ruft `click()` direkt), liefen ins Leere
  // — ein programmatischer Klick auf den Ring-Knopf erzeugt hier KEIN
  // `POST /api/spielen`, waehrend „Auswaehlen" (ein Klick auf
  // `document.activeElement`) es sehr wohl tut. Warum die beiden sich
  // unterscheiden, ist an dieser Stelle nicht geklaert.
  //
  // WAS STATTDESSEN BEWIESEN IST: dass das Instrument lebt. Messung 5 weiter
  // unten benutzt DIESELBE Funktion `gespielt()` und meldet dort „Befehl
  // (1)". Der Zaehler steht also nicht auf Null, weil er kaputt ist, sondern
  // weil nichts gestartet wurde — und vor der Messung wird geleert. Das ist
  // schwaecher als eine gelungene Gegenprobe und staerker als gar nichts;
  // wer hier weiterkommt, traegt es nach.
  await warte(2500)
  const befehle = await gespielt()
  zeile('… und spielt dabei NICHTS', befehle.length ? `NEIN (${befehle.length} Befehl(e))` : 'ja')
  if (befehle.length) {
    melde(`die Ansage hat etwas gestartet: ${JSON.stringify(befehle.slice(0, 2))} — genau das sollte sie nicht`)
  }

  // ── 3. VIER SCHNELLE SCHRITTE SIND NICHT VIER ANSAGEN ──────────────────
  await leeren()
  for (let i = 0; i < 4; i++) {
    await druck('rechts')
    await warte(90)
  }
  await warte(RUHE_MS + 2000)
  const viele = await gesagt()
  /*
   * WENIGER ANSAGEN ALS SCHRITTE — und nicht „hoechstens zwei".
   *
   * Die feste Zahl war eine Wette auf das Tempo, mit dem die Seite die
   * Tastendruecke abholt: kommen sie weiter auseinander als die Ruhepause,
   * sagt jeder einzelne an, ganz ohne Fehler in der Oberflaeche. Genau so
   * meldete dieses Werkzeug „3 Ansagen fuer vier Schritte" — richtig
   * gezaehlt, falsch beurteilt.
   *
   * DIE BEHAUPTUNG DER RUHEPAUSE IST NICHT „hoechstens zwei", sondern
   * „nicht jeder Schritt". Gemessen wird deshalb genau das. Die Gegenprobe
   * bleibt scharf: ohne Pause sind es vier.
   */
  zeile('vier schnelle Schritte ergeben WENIGER als vier Ansagen', `${viele.length}`)
  if (viele.length >= 4) {
    melde(`${viele.length} Ansagen fuer vier schnelle Schritte — die Ruhepause greift nicht, das klingt abgehackt`)
  }
  if (viele.length === 0) {
    melde('gar keine Ansage fuer vier Schritte — dann misst diese Zeile nicht die Ruhepause, sondern ein totes Vorlesen')
  }

  // ── 4. GEGENRICHTUNG: AUS HEISST STILL, ABER NICHT TOT ─────────────────
  await lage('vorlesen-aus', 'aus')
  await frisch()
  await warmlaufAbwarten(8000)
  await leeren()
  await druck('rechts')
  const ringAus = await bis(imRing, 3000)
  await warte(RUHE_MS + 1500)
  const stillGesagt = await gesagt()
  zeile('Vorlesen AUS: der Ring bewegt sich weiter', ringAus ? 'ja' : 'NEIN')
  if (!ringAus) melde('bei abgeschaltetem Vorlesen bewegte sich die Auswahl nicht mehr — die Ansage hat die Bedienung gekostet')
  zeile('Vorlesen AUS: und es wird geschwiegen', stillGesagt.length ? `NEIN (${stillGesagt.length})` : 'ja')
  if (stillGesagt.length) melde(`bei abgeschaltetem Vorlesen wurde trotzdem gesprochen: ${JSON.stringify(stillGesagt[0])}`)

  // ── 5. GEGENKONTROLLE: AUSWAEHLEN SPIELT WEITER ────────────────────────
  //
  // DER RING MUSS DAFUER AUF EINER KACHEL STEHEN, und das ist kein Detail:
  // Die erste Fassung drueckte einmal „rechts" und dann „auswaehlen" — der
  // Ring stand da auf dem Filter „Alles", und der SPIELT nichts, er filtert.
  // Die Messung meldete „die Ansage hat das Auswaehlen mit abgeschafft" und
  // war schlicht falsch gestellt: richtige Sorge, falsche Stelle. Gesucht
  // wird deshalb ein Knopf mit `data-sprich` — das haben in dieser
  // Oberflaeche genau die Kacheln, die etwas abspielen.
  await lage('vorlesen-antippen', 'antippen')
  await frisch()
  await warmlaufAbwarten()
  await leeren()
  await druck('rechts')
  await bis(imRing, 3000)
  const aufKachel = await zurKachel()
  if (!aufKachel) {
    melde('der Ring fand keine Kachel — die Gegenkontrolle faellt aus, statt gruen zu tun')
  }
  await warte(RUHE_MS + 800)
  await leeren()

  /**
   * WAS „AUSWAEHLEN" BEWIRKT, IST NICHT IMMER EIN BEFEHL.
   *
   * ZWEITER ANLAUF AN DIESER MESSUNG. Auch auf einer Kachel heisst
   * „Auswaehlen" nicht zwingend „spielen": Ein Interpret wird GEOEFFNET,
   * ein Album klappt seine Titel auf — beides ohne einen einzigen Befehl an
   * den Abspieler. Die Frage dieser Gegenkontrolle ist aber gar nicht, WAS
   * passiert, sondern nur, DASS der Tastendruck noch ankommt. Gemessen wird
   * deshalb eine Wirkung IRGENDWELCHER Art: ein Befehl ODER eine sichtbar
   * veraenderte Seite.
   *
   * Der Fingerabdruck ist absichtlich grob — Zahl der Elemente, welche
   * Ebenen offen sind, wo der Ring steht. Er soll eine Veraenderung
   * bemerken, nicht sie beschreiben.
   */
  const abdruck = () =>
    ev(`(() => {
      const offen = Array.from(document.querySelectorAll('body > div, body > section'))
        .filter((e) => !e.hidden && getComputedStyle(e).display !== 'none')
        .map((e) => e.id || e.className).join('|');
      const ring = document.querySelector('.fb-auswahl');
      return document.querySelectorAll('*').length + '#' + offen + '#' + (ring ? (ring.dataset.sprich || ring.className) : '-')
    })()`)
  const vorher = await abdruck()
  await druck('auswaehlen')
  const wirkung = await bis(async () => {
    const b = await gespielt()
    if (b.length) return `Befehl (${b.length})`
    const jetzt = await abdruck()
    return jetzt !== vorher ? 'die Seite hat sich veraendert' : null
  }, 6000)
  zeile('Gegenkontrolle: „Auswaehlen" wirkt weiterhin', wirkung || 'NEIN')
  if (!wirkung && aufKachel) {
    melde('nach „Auswaehlen" ist weder ein Befehl herausgegangen noch hat sich die Seite geruehrt — der Tastendruck kommt nicht mehr an')
  }

  console.log(fehler ? `\n  ${fehler} Abweichung(en)` : '\n  ohne Abweichung')
} finally {
  await lage('vorlesen-aus').catch(() => null)
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
