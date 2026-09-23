/**
 * Tests fuer die NEUE Oberflaeche (NewDesign/) — im echten Browser.
 *
 * WOZU: Gezaehlt am 2026-08-02 hatte `NewDesign/` KEINE einzige Testdatei —
 * bei 3609 Zeilen app.js. Die einzige Absicherung war
 * `tools/player-befehle.py --oberflaeche`, und die prueft nur die NAMEN der
 * verschickten Befehle, nicht ob die Seite tut, was sie soll. Am besten
 * geprueft war ausgerechnet die alte Angular-Oberflaeche (35 Testdateien),
 * die abgeloest werden soll. Wer hier etwas aendert, hatte kein Netz.
 *
 * WIE — und warum genau so:
 *
 * 1. KEINE ZEILE AN app.js. Die Datei ist eine IIFE ohne einen einzigen
 *    Export; nichts daraus ist importierbar. Statt sie fuer die Tests
 *    aufzubohren (und damit die Produktionsdatei zu veraendern), laeuft sie
 *    hier als das, was sie ist: eine Seite im Browser. Geprueft wird das
 *    VERHALTEN, nicht die Innerei.
 *
 * 2. KEINE EIGENE ATTRAPPE. Die Antworten kommen aus `tools/neu-vorschau.mjs`.
 *    Das ist Absicht und der teuerste Punkt an der ganzen Sache: eine
 *    Attrappe, die dem Vertrag nicht folgt, prueft nichts und luegt dabei in
 *    die falsche Richtung (llmwiki: neue-oberflaeche-ohne-box-ansehen — dort
 *    zeigte die Seite GAR KEINEN Player, weil die Attrappe `title`/`state`
 *    statt `currentTrackname`/`playing` lieferte; gesucht wurde daraufhin in
 *    der Seite). Eine zweite, unbelegte Meinung ueber die Feldnamen waere
 *    genau dieser Fehler noch einmal.
 *
 * 3. KEINE NEUE ABHAENGIGKEIT. Weder vitest noch jsdom sind im Baum
 *    installiert. Der Browser wird wie in den uebrigen e2e-Werkzeugen ueber
 *    CDP gesteuert (`ws`, 8.17.1, ist da).
 *
 * WAS ES NICHT TUT
 *   * Es ersetzt keine Pruefung auf dem Geraet. Ob es auf 800x480 hinter
 *     Chromium taugt, sagt nur die Box.
 *   * Es prueft kein Aussehen — keine Bildvergleiche, keine Pixel. Nur, ob
 *     die richtigen Dinge da sind und die richtigen Anfragen hinausgehen.
 *   * Es spielt nichts ab. Die Attrappe quittiert Befehle, mehr nicht.
 *
 * AUFRUF
 *     node --test tools/e2e/neu-oberflaeche.test.mjs
 *
 * OHNE BROWSER wird uebersprungen statt zu scheitern — auf einem Rechner
 * ohne Chrome soll die Pruefung nicht rot werden, sondern sagen, was fehlt.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, freierPort } from '../leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** DIE ATTRAPPE BEKOMMT EINEN FREIEN PORT — nicht mehr die feste 8397.
 *
 *  HIER STAND `const PORT_VORSCHAU = 8397`, UND DAS WAR DIESELBE FALLE, VOR DER
 *  DER ABSATZ DARUNTER WARNT — nur eine Tuer weiter. `spawn` auf einen
 *  belegten Port scheitert STILL (`stdio: 'ignore'`, niemand liest den
 *  Fehler); danach fragt die Warteschleife `GET /api/werke` und bekommt eine
 *  Antwort — von der FREMDEN Vorschau. Der ganze Lauf misst dann deren Baum:
 *  `Page.navigate` holt DEREN NewDesign, `/vorschau/...` stellt DEREN Zustand
 *  um. Am Ende steht „27/27 gruen" ueber einem Arbeitsbaum, den niemand
 *  angesehen hat — und waehrend `tools/rotprobe.py` laeuft, ist genau das der
 *  Normalfall: sie startet den Lauf ein zweites Mal aus einer Wegwerfkopie.
 *  GEMESSEN am 06.08.2026: derselbe Fall war abwechselnd gruen und rot, je
 *  nachdem, wer 8397 gerade hielt.
 *
 *  ZWEI HAELFTEN, wie bei `eigenerBrowser()`: `freierPort()` holt einen, den
 *  in diesem Augenblick niemand haelt, und `before()` weist danach nach, dass
 *  die Antwort vom EIGENEN Kind kommt (es lebt noch). Ein fremder Server auf
 *  einem frisch erfragten Port waere sonst weiterhin moeglich.
 *
 *  DEN DEBUG-PORT DES BROWSERS GIBT ES HIER NICHT MEHR: Er stand fest auf
 *  9353 — derselben Nummer wie in tools/marke-am-geraet.mjs. Ein fester Port
 *  ist doppelt gefaehrlich: Haelt ihn ein Browser, der einen harten Abbruch
 *  ueberlebt hat, so bindet der eigene ihn NICHT und sagt darueber nichts, und
 *  `/json/list` liefert klaglos die Ziele des FREMDEN. `eigenerBrowser()`
 *  (tools/leihgabe.mjs) holt einen freien und weist nach, dass der Browser
 *  dahinter der eigene ist. */
let PORT_VORSCHAU = 0
const FRIST_MS = 10_000

const BROWSER = browserSuchen()

let vorschau
let chrome
let ws
let lfd = 0
/** Alle Anfragen, die die Seite stellt — fuer die Pruefung des Abspielwegs. */
let anfragen = []
/**
 * JEDER SPIELWUNSCH MIT RUMPF (E95/V Stufe 2, 31.08.2026): Die Seite schickt
 * fuer jeden Abspielwunsch EINEN `POST /api/spielen` statt selbstgebauter
 * /player-Befehle. Die URL allein sagt dann nichts mehr — ob „von vorne"
 * wirklich vorn anfaengt, steht NUR im Rumpf (titelNr ohne positionMs) und
 * nirgendwo sonst. Deshalb wird er hier aus `Network.requestWillBeSent`
 * mitgelesen (postData ist bei so kleinen Ruempfen immer dabei); dasselbe
 * Mitlesen, nur im Browser statt am CDP, macht tools/kachel-spielt-je-dienst.mjs.
 */
let wuensche = []

const senden = (methode, params = {}) =>
  new Promise((ok, nein) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: methode, params }))
    const h = (roh) => {
      const x = JSON.parse(roh)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? nein(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

/** Einen Ausdruck IM BROWSER auswerten und den Wert zurueckgeben. */
const ev = async (ausdruck) =>
  (
    await senden('Runtime.evaluate', {
      expression: ausdruck,
      returnByValue: true,
      awaitPromise: true,
    })
  )?.result?.value

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Warten, bis ein Ausdruck wahr wird.
 *
 * MIT AUSKUNFT BEIM SCHEITERN: ein blosses `assert(await ev(...))` nach
 * fester Wartezeit sagt im Fehlerfall nur "false" und laesst einen raten, ob
 * die Seite langsam war oder kaputt. Deshalb wird hier die Frist genannt.
 */
async function warteAuf(ausdruck, was, frist = FRIST_MS) {
  const bis = Date.now() + frist
  while (Date.now() < bis) {
    if (await ev(ausdruck)) return true
    await schlafen(100)
  }
  assert.fail(`nach ${frist} ms nicht eingetreten: ${was}\n  Ausdruck: ${ausdruck}`)
}

/** Zustand der Attrappe umschalten (siehe Kopf von tools/neu-vorschau.mjs). */
async function zustand(name) {
  const a = await fetch(`http://127.0.0.1:${PORT_VORSCHAU}/vorschau/${name}`)
  assert.equal(a.ok, true, `Vorschau-Zustand "${name}" liess sich nicht setzen`)
}

/** Seite frisch laden und warten, bis app.js durch ist. */
async function neuLaden() {
  anfragen = []
  wuensche = []
  await senden('Page.navigate', { url: `http://127.0.0.1:${PORT_VORSCHAU}/neu/` })
  // `#buehne` steht im HTML; erst wenn app.js gelaufen ist, ist entweder das
  // Raster oder ein Zustand sichtbar. Auf genau das warten, nicht auf eine
  // feste Zeit — sonst misst man die Geschwindigkeit des Rechners.
  await warteAuf(
    `!!document.getElementById('zustand') && (!document.getElementById('raster').hidden || !document.getElementById('zustand').hidden)`,
    'die Seite hat Raster oder Zustand angezeigt',
  )
}

before(async () => {
  if (!BROWSER) return
  PORT_VORSCHAU = await freierPort()
  vorschau = spawn('node', ['tools/neu-vorschau.mjs', '--port', String(PORT_VORSCHAU)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  // OB DAS KIND NOCH LEBT, IST DIE ZWEITE HAELFTE DES NACHWEISES. Eine
  // Antwort auf `/api/werke` beweist nur, dass IRGENDWER auf diesem Port
  // sitzt. Ist unser eigener Prozess dabei schon gestorben (weil ihn jemand
  // im Wimpernschlag zwischen `freierPort()` und `spawn` weggeschnappt hat),
  // dann waere die Antwort die eines Fremden — und alles Folgende eine
  // Messung an dessen Arbeitsbaum.
  let gestorben = null
  vorschau.on('exit', (code) => {
    gestorben = code
  })
  // Warten, bis die Attrappe antwortet — nicht blind schlafen.
  const bis = Date.now() + 10_000
  for (;;) {
    if (gestorben !== null) {
      throw new Error(
        `tools/neu-vorschau.mjs ist sofort beendet (Ende ${gestorben}) — Port ${PORT_VORSCHAU} war belegt.\n` +
          'Alles Weitere waere an einem FREMDEN Baum gemessen worden.',
      )
    }
    try {
      await fetch(`http://127.0.0.1:${PORT_VORSCHAU}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await schlafen(150)
    }
  }

  // Auf den Browser warten muss hier niemand mehr: `eigenerBrowser()` kehrt
  // erst zurueck, wenn eine Seite da ist und der Port nachweislich dem eigenen
  // Browser gehoert.
  chrome = await eigenerBrowser()
  ws = new WebSocket(await chrome.seite())
  await new Promise((r) => ws.on('open', r))
  await senden('Runtime.enable')
  await senden('Page.enable')
  await senden('Network.enable')
  // JEDE Anfrage mitschreiben. Darauf beruht die Pruefung des Abspielwegs:
  // sie soll nicht nur sehen, dass /player gerufen wurde, sondern auch, dass
  // NICHTS DANEBEN gerufen wurde.
  ws.on('message', (roh) => {
    const x = JSON.parse(roh)
    if (x.method === 'Network.requestWillBeSent') {
      anfragen.push(x.params.request.url)
      // Der Spielwunsch samt Rumpf — siehe die Erklaerung an `wuensche`.
      if (/\/api\/spielen$/.test(String(x.params.request.url))) {
        let rumpf = null
        try {
          rumpf = JSON.parse(x.params.request.postData || 'null')
        } catch {
          /* unlesbarer Rumpf bleibt null — und faellt unten als Fehler auf */
        }
        wuensche.push(rumpf)
      }
    }
  })
})

after(async () => {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  // ERST das Ende des Browsers abwarten, DANN sein Profil loeschen — das tut
  // `schliessen()`. Ein `kill()` ohne Warten laesst ein mkdtemp-Verzeichnis
  // stehen, das Chromium beim Beenden noch einmal anschreibt.
  await chrome?.schliessen()
  vorschau?.kill()
})

describe('Neue Oberflaeche (NewDesign/)', { skip: BROWSER ? false : 'kein Browser gefunden' }, () => {
  test('zeigt die Alben, wenn die Bibliothek gefuellt ist', async () => {
    await zustand('voll')
    await neuLaden()
    await warteAuf(`document.getElementById('raster').children.length > 0`, 'das Raster hat Kacheln')
    assert.equal(await ev(`document.getElementById('raster').hidden`), false)
    assert.equal(await ev(`document.getElementById('zustand').hidden`), true)
  })

  test('bleibt bei leerer Bibliothek nicht im Ladezustand haengen', async () => {
    await zustand('leer')
    await neuLaden()
    // DIE EIGENTLICHE GEFAHR ist nicht "leer", sondern "laedt ewig": ein
    // Kind sieht dann einen Kreisel statt einer Auskunft. Also ausdruecklich
    // gegen den Lader pruefen, nicht nur auf irgendeinen Zustand.
    await warteAuf(
      `!document.getElementById('zustand').hidden && !document.querySelector('#zustand .lader')`,
      'ein Zustand OHNE Kreisel steht da',
    )
    const text = await ev(`(document.getElementById('zustand').textContent||'').trim()`)
    assert.ok(text.length > 0, 'der leere Zustand sagt nichts')
  })

  test('meldet einen Serverfehler, statt ewig zu laden (500)', async () => {
    await zustand('kaputt')
    await neuLaden()
    await warteAuf(
      `!document.getElementById('zustand').hidden && !document.querySelector('#zustand .lader')`,
      'ein Zustand OHNE Kreisel steht da',
    )
    const text = await ev(`(document.getElementById('zustand').textContent||'').trim()`)
    assert.ok(text.length > 0, 'der Fehlerzustand sagt nichts')
  })

  test('meldet einen fehlenden Endpunkt, statt ewig zu laden (404)', async () => {
    await zustand('fehlt')
    await neuLaden()
    await warteAuf(
      `!document.getElementById('zustand').hidden && !document.querySelector('#zustand .lader')`,
      'ein Zustand OHNE Kreisel steht da',
    )
  })

  test('zeigt den Mini-Player, wenn etwas laeuft', async () => {
    await zustand('voll')
    await zustand('spielt')
    await neuLaden()
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
    const titel = await ev(`(document.getElementById('mp-titel').textContent||'').trim()`)
    assert.ok(titel.length > 0, 'der Mini-Player zeigt keinen Titel')
  })

  test('verbirgt den Mini-Player, wenn nichts laeuft', async () => {
    await zustand('voll')
    await zustand('still')
    await neuLaden()
    await warteAuf(`document.getElementById('mp').hidden === true`, 'der Mini-Player ist weg')
  })

  /**
   * DIE WEITERHOEREN-REIHE FOLGT DER AUSWAHL.
   *
   * WOHER DIE REGEL KOMMT: gemeldet am 02.08.2026 — „wenn ich europa
   * hoerspiel bin sehe ich die zukunft wird gross, was keinen bezug zu den
   * hoerspielen hat". Die Reihe zeigte, was der Server schickte, ohne zu
   * fragen, was gerade zur Wahl steht.
   *
   * WARUM SIE IN DER OBERFLAECHE GEPRUEFT WIRD UND NICHT IN weiterhoeren.ts:
   * Der Server kennt die Auswahl nicht. Welche Kategorie gedrueckt und welches
   * Regal offen ist, steht ausschliesslich in dieser Seite; ein Endpunkt, dem
   * man das jedes Mal mitschickt, waere ein Netzabruf pro Tipp auf die Leiste.
   * Die Regel gehoert also hierher — und damit auch ihre Pruefung.
   *
   * DIE ATTRAPPE MUSS DAFUER MEHRERE KATEGORIEN LIEFERN. Bis zum 02.08.2026
   * waren alle fuenf Weiterhoeren-Zeilen `audiobook`; gegen so eine Vorlage
   * sieht jede Filterregel richtig aus. „Rolf Zuckowski" ist seither die
   * Musik-Zeile, und dieser Test haengt an ihr.
   */
  test('Weiterhoeren zeigt in einer Kategorie nur deren Werke', async () => {
    await zustand('voll')
    await zustand('verlauf-voll')
    await neuLaden()
    await warteAuf(`!document.getElementById('weiter').hidden`, 'die Weiterhoeren-Reihe steht da')

    const titel = `[...document.querySelectorAll('#weiter-reihe .weiter-kachel .weiter-titel')].map((e) => e.textContent.trim())`
    const inUebersicht = await ev(titel)
    assert.ok(inUebersicht.includes('Rolf Zuckowski'), `Musik fehlt in der Uebersicht: ${JSON.stringify(inUebersicht)}`)
    assert.ok(inUebersicht.includes('Die Maus'), `Hoerbuch fehlt in der Uebersicht: ${JSON.stringify(inUebersicht)}`)

    // „Hörbuch" ist die dritte Kachel der Leiste (KATEGORIEN in app.js).
    await ev(`document.querySelectorAll('#leiste .kat')[2].click(), true`)
    // SOFORT, nicht erst beim naechsten Takt: `sichtbarerTakt(TAKT_WEITER)`
    // laeuft alle 60 Sekunden. Wer erst danach richtig zeigt, zeigt eine
    // Minute lang das Falsche — deshalb hier eine KURZE Frist.
    await warteAuf(`!${titel}.includes('Rolf Zuckowski')`, 'der Musiktitel ist aus der Reihe verschwunden', 2000)
    const inHoerbuch = await ev(titel)
    assert.ok(inHoerbuch.includes('Die Maus'), `Hoerbuch-Eintrag fehlt: ${JSON.stringify(inHoerbuch)}`)
    assert.equal(await ev(`document.getElementById('weiter').hidden`), false)

    // Umgekehrt: unter „Musik" bleibt nur der Musiktitel.
    await ev(`document.querySelectorAll('#leiste .kat')[1].click(), true`)
    await warteAuf(`${titel}.includes('Rolf Zuckowski')`, 'der Musiktitel ist zurueck', 2000)
    assert.deepEqual(await ev(titel), ['Rolf Zuckowski'])
  })

  test('Weiterhoeren zeigt im Regal nur die Werke dieses Interpreten', async () => {
    await zustand('voll')
    await zustand('verlauf-voll')
    await neuLaden()
    await warteAuf(`!document.getElementById('weiter').hidden`, 'die Weiterhoeren-Reihe steht da')

    // „Kiddinx" traegt in der Vorschau zwei Werke — daraus baut die Seite ein
    // Regal. Ein Regal laesst `werke.kategorie` auf „alle" stehen; genau
    // deshalb griff die alte Kategoriepruefung hier gar nicht.
    const getroffen = await ev(`(() => {
      const k = [...document.querySelectorAll('#raster > .kachel.regal')]
        .find((e) => (e.querySelector('.kachel-titel') || {}).textContent === 'Kiddinx')
      if (!k) return false
      k.click()
      return true
    })()`)
    assert.equal(getroffen, true, 'kein Regal „Kiddinx" im Raster — Vorschau geaendert?')

    const titel = `[...document.querySelectorAll('#weiter-reihe .weiter-kachel .weiter-titel')].map((e) => e.textContent.trim())`
    await warteAuf(`!${titel}.includes('Die Maus')`, 'fremde Werke sind aus der Reihe verschwunden', 2000)
    // BEIDE „Kiddinx"-Werke, und darauf kommt es hier an.
    //
    // Bis 02.08.2026 stand hier nur „Bibi Blocksberg" — nicht weil die
    // Filterregel das andere aussortiert haette, sondern weil es die Seite nie
    // erreichte: `weiterHolen` fragte mit `?max=6` und schnitt SOFORT auf
    // sechs, also VOR beiden Sieben. Die drei unstartbaren Zeilen der Vorschau
    // (auf der Box sind es vier von sieben) belegten drei dieser Plaetze, und
    // „Benjamin Bluemchen" fiel hinten heraus. Im Regal blieb eine Kachel
    // uebrig, wo zwei Stellen gemerkt sind. Deshalb holt die Seite jetzt
    // `WEITER_HOLEN` Zeilen und schneidet erst NACH dem Filtern.
    assert.deepEqual(await ev(titel), ['Bibi Blocksberg', 'Benjamin Bluemchen'])
  })

  /**
   * DER DECKEL DARF NICHT VOR DEM SIEB STEHEN.
   *
   * GEMESSEN AN DER BOX (192.168.178.169, 2026-08-02, nur gelesen):
   * resume.json haelt 9 Stellen (die Obergrenze), `?max=6` liefert sechs
   * Zeilen — davon hatten drei gar kein Werk mehr. Die Seite baute daraus drei
   * Kacheln und liess zwei startbare Stellen liegen, die es gab.
   *
   * DIE VORSCHAU BILDET DAS SEIT DEM 02.08.2026 NACH: neun Zeilen, die drei
   * neuesten ohne `schluessel`. Ohne diesen Nachbau kann der Fall gar nicht
   * entstehen und jede Reihenfolge von Deckel und Sieb sieht richtig aus.
   */
  test('Weiterhoeren verliert keine Stelle an weggefilterte Zeilen', async () => {
    await zustand('voll')
    await zustand('verlauf-voll')
    await neuLaden()
    await warteAuf(`!document.getElementById('weiter').hidden`, 'die Weiterhoeren-Reihe steht da')

    const titel = `[...document.querySelectorAll('#weiter-reihe .weiter-kachel .weiter-titel')].map((e) => e.textContent.trim())`
    const stand = await ev(titel)
    // „Benjamin Bluemchen" und „Die drei ???" liegen HINTER den drei
    // unstartbaren Zeilen. Wer zuerst auf das Abruffenster schneidet, bekommt
    // sie nie zu sehen — obwohl beide Stellen gemerkt und startbar sind.
    assert.ok(stand.includes('Benjamin Bluemchen'), `hinten abgeschnitten: ${JSON.stringify(stand)}`)
    assert.ok(stand.includes('Die drei ???'), `hinten abgeschnitten: ${JSON.stringify(stand)}`)
    // UND KEINE UNSTARTBARE KACHEL — der Platz darf nicht dadurch entstehen,
    // dass die Seite Zeilen ohne Werk durchlaesst.
    assert.ok(!stand.some((t) => t.startsWith('Pummeleinhorn')), `unstartbare Kachel: ${JSON.stringify(stand)}`)
    // Und trotzdem hoechstens WEITER_ANZAHL: mehr passen bei 800 px nicht
    // nebeneinander (gemessen 02.08.2026: sechs sind um eine Luecke zu breit).
    assert.ok(stand.length <= 5, `mehr als fuenf Kacheln: ${JSON.stringify(stand)}`)
  })

  test('Weiterhoeren bleibt stehen, wenn die Medienliste ausfaellt', async () => {
    // DER RUECKFALL, und er ist Absicht: ohne Medienliste gibt es keine
    // Auswahl, gegen die sich vergleichen liesse. Wuerde dann gefiltert,
    // naehme eine haengende Liste dem Kind ausgerechnet den einen Weg, der
    // noch funktioniert — schlimmer als der Fehler, um den es ging.
    await zustand('verlauf-voll')
    await zustand('kaputt')
    await neuLaden()
    await warteAuf(`!document.getElementById('weiter').hidden`, 'die Reihe steht trotz 500 da')
    const titel = await ev(
      `[...document.querySelectorAll('#weiter-reihe .weiter-kachel .weiter-titel')].map((e) => e.textContent.trim())`,
    )
    assert.ok(titel.includes('Rolf Zuckowski'), `ohne Medienliste gefiltert: ${JSON.stringify(titel)}`)
    await zustand('voll')
  })

  test('spielt AUSSCHLIESSLICH ueber /player/<raum>/<befehl>', async () => {
    // DIE HARTE REGEL, und der Grund fuer diesen Test: die Kinderzeit haengt
    // genau an diesem Weg (server.ts ruft istStartbefehl aus kinderzeit.ts).
    // Ein eigener, bequemer Abspielendpunkt wuerde die Zeitbegrenzung
    // aushebeln, ohne dass es jemand merkt — bis ein Kind um Mitternacht
    // Musik hoert. Deshalb wird hier nicht nur geprueft, DASS /player gerufen
    // wird, sondern auch, dass daneben nichts Abspielartiges hinausgeht.
    //
    // SEIT E95/V STUFE 2 (31.08.2026) GILT DIE REGEL NUR NOCH FUER DIESEN
    // REST: Abspielwuensche (Kacheltipp, Weiterhoeren, Lane) gehen als
    // `POST /api/spielen` hinaus — die Kinderzeit prueft der Server dort
    // selbst (spielfunktion, gedeckt von
    // src/backend-api/src/spielen.integration.spec.ts). Was der Seite an
    // /player-Befehlen BLEIBT, ist das Umschalten am Mini-Player
    // (play/pause, Lautstaerke) — und genau das misst dieser Fall: der
    // Spielknopf bei laufender Wiedergabe schickt `pause` ueber
    // /player/<raum>/<befehl> und nichts Abspielartiges daneben.
    await zustand('voll')
    await zustand('spielt')
    await neuLaden()
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')

    anfragen = []
    await ev(`document.getElementById('mp-spiel').click(), true`)
    // Kurz warten statt auf ein Element zu lauern: geprueft wird hier, WAS
    // hinausgeht, nicht was danach erscheint. Ein Wartezustand gaebe es
    // dafuer nicht — die Anfragen sind das Ergebnis.
    await schlafen(600)

    const pfade = anfragen
      .map((u) => {
        try {
          return new URL(u).pathname
        } catch {
          return u
        }
      })
      .filter((p) => !p.startsWith('/neu/'))

    // ZWEI SORTEN unter /player/, und nur EINE ist ein Befehl:
    //   /player/local, /player/state   ABFRAGEN (app.js:2752, 2764) — lesen
    //                                  nur den Stand und starten nichts
    //   /player/<raum>/<befehl>        BEFEHLE (app.js:1844) — nur DIESE
    //                                  laufen durch die Kinderzeit-Pruefung
    // Der erste Lauf dieses Tests ist genau darueber gestolpert und hat
    // `/player/local` als Regelbruch gemeldet. Die Unterscheidung gehoert
    // also in den Test, sonst prueft er die falsche Sache.
    const ABFRAGEN = ['/player/local', '/player/state']
    const spielbefehle = pfade.filter((p) => p.startsWith('/player/') && !ABFRAGEN.includes(p))
    assert.ok(spielbefehle.length > 0, `kein Abspielbefehl gesehen. Gesehene Pfade: ${JSON.stringify(pfade)}`)
    for (const p of spielbefehle) {
      assert.match(p, /^\/player\/[^/]+\/.+/, `Abspielbefehl geht nicht ueber /player/<raum>/<befehl>: ${p}`)
    }
    // Nichts ausserhalb der beiden bekannten Praefixe.
    const fremd = pfade.filter((p) => !p.startsWith('/player/') && !p.startsWith('/api/'))
    assert.deepEqual(fremd, [], `unerwartete Anfragen neben /api und /player: ${JSON.stringify(fremd)}`)
  })

  // ── PLATZ BEIM BLAETTERN: die beiden Klemmzustaende ────────────────────
  //
  // WOZU HIER UND NICHT NUR IM MESSWERKZEUG: tools/leiste-platz-schau.mjs
  // misst Zahlen (Ruhezeiten, Bildpunkte) und gehoert einem Menschen, der sie
  // liest. Die beiden Klemmzustaende sind dagegen ein JA/NEIN, das nie wieder
  // zurueckkommen darf — und sie sind zweimal zurueckgekommen. Genau dafuer
  // sind Tests da.
  //
  // GEMESSEN WIRD DIE WIRKUNG: `platzBeimBlaettern` liegt in einer IIFE und
  // ist von aussen nicht lesbar. Ablesbar ist `body.platz-machen`.
  //
  // DIE VORSCHAU MUSS ES EINGESCHALTET HABEN — sonst prueft das hier das
  // Nichts (llmwiki attrappe-luegt-durch-weglassen). Deshalb steht die
  // Gegenprobe „ein Rollen faehrt ueberhaupt ein" als eigener Test davor.

  /**
   * Warten, bis „Darstellung" angewendet ist.
   *
   * DAS IST KEINE VORSICHTSMASSNAHME, SONDERN DIE URSACHE EINES FEHLLAUFS:
   * `platzBeimBlaettern` wird erst in `anwenden()` eingeschaltet, und das
   * laeuft aus einem eigenen Takt — der Mini-Player steht laengst da, wenn die
   * Antwort noch unterwegs ist. Ein Rollen davor tut GAR NICHTS, und weil
   * danach kein zweites kommt, wartet der Test zehn Sekunden auf etwas, das
   * niemand mehr ausloest. Genau so sind diese vier Tests im ersten Lauf
   * gescheitert.
   *
   * `--mupi-mp` setzt ausschliesslich `anwenden()` — das ist der Beleg, dass
   * die Antwort da war.
   */
  const darstellungAbwarten = () =>
    warteAuf(`!!document.documentElement.style.getPropertyValue('--mupi-mp')`, 'die Darstellung ist angewendet')

  /** Ein Rollereignis in der Buehne. */
  const rollen = (top) =>
    ev(`(() => { const b = document.getElementById('buehne'); b.scrollTop = ${top};
                 b.dispatchEvent(new Event('scroll')); return true })()`)

  /** Die Playlist-Kachel finden und antippen — sie steht in einem REGAL. */
  const laneOeffnen = async () => {
    const tippen = () =>
      ev(`(() => {
        const k = [...document.querySelectorAll('#raster > .kachel:not(.regal)')]
          .find((x) => (x.querySelector('.kachel-titel')||{}).textContent === 'Bibi Blocksberg');
        if (!k) return false; k.click(); return true })()`)
    if (await tippen()) return true
    const regale = await ev(`document.querySelectorAll('#raster > .kachel.regal').length`)
    for (let i = 0; i < regale; i++) {
      await ev(`(document.querySelectorAll('#raster > .kachel.regal')[${i}] || {click(){}}).click()`)
      await schlafen(400)
      if (await tippen()) return true
      // `#zurueck` statt `#regal-zurueck`: seit 03.08.2026 gibt es EINEN Ausgang.
      await ev(`(document.getElementById('zurueck') || { click() {} }).click()`)
      await schlafen(300)
    }
    return false
  }

  test('Rollen faehrt die Leiste ein (Gegenprobe fuer die beiden naechsten)', async () => {
    await zustand('voll')
    await zustand('spielt')
    await neuLaden()
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
    await darstellungAbwarten()
    assert.equal(await ev(`document.body.classList.contains('platz-machen')`), false)
    await rollen(220)
    await warteAuf(`document.body.classList.contains('platz-machen')`, 'die Leiste ist eingefahren')
  })

  test('die Leiste kommt auch dann zurueck, wenn waehrenddessen eine Lane aufgeht', async () => {
    // DER GEMELDETE FEHLER, woertlich: „wenn ich bis titel ausgewaehlt habe
    // wird die leiste nie wieder eingeblendet." Ursache war eine Sperre, die
    // die laufende Uhr loeschte und keine neue stellte.
    await zustand('voll')
    await zustand('spielt')
    await neuLaden()
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
    await darstellungAbwarten()
    await rollen(220)
    await warteAuf(`document.body.classList.contains('platz-machen')`, 'die Leiste ist eingefahren')
    assert.ok(await laneOeffnen(), 'die Playlist-Kachel war nicht zu finden')
    await warteAuf(`!!document.querySelector('#raster .lane')`, 'die Lane steht')
    // Grosszuegige Frist: mit offener Lane gilt die LANGE Ruhezeit (4 s), und
    // jede eigene Aenderung stellt sie neu.
    await warteAuf(
      `!document.body.classList.contains('platz-machen')`,
      'die Leiste ist mit offener Lane zurueckgekommen',
      12_000,
    )
  })

  test('mit offener Lane faehrt Rollen weiterhin ein', async () => {
    // Die andere Richtung derselben Sperre: „es gibt auch den fall das es
    // nicht ausgeblendet wird selbst wenn ich scolle und alles ausgeklappt
    // ist." Frueher tat ein Rollen bei offener Lane gar nichts mehr.
    await zustand('voll')
    await zustand('spielt')
    await neuLaden()
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
    await darstellungAbwarten()
    assert.ok(await laneOeffnen(), 'die Playlist-Kachel war nicht zu finden')
    await warteAuf(`!!document.querySelector('#raster .lane')`, 'die Lane steht')
    // Ausgefahren, OHNE die Lane zu schliessen: Der grosse Player faehrt beim
    // Oeffnen alles aus, sein Zurueck-Knopf schliesst ihn wieder. Ohne diesen
    // Schritt begaenne der Test womoeglich schon eingefahren (das Aufklappen
    // rollt selbst, `laneInsBild`), und „faehrt ein" saehe wie ein Erfolg aus,
    // ohne einer zu sein.
    await ev(`(document.querySelector('.mp-bild') || {click(){}}).click(), true`)
    await schlafen(200)
    await ev(`(document.getElementById('zurueck') || {click(){}}).click(), true`)
    await warteAuf(`!document.body.classList.contains('platz-machen')`, 'die Leiste ist ausgefahren')
    // MEHRMALS ROLLEN, NICHT EINMAL. Nach jedem Zurueckfahren gilt eine blinde
    // Zeit (BLIND_NACH_RUECKKEHR_MS), in der Rollereignisse als die eigene
    // Bewegung der Seite gelten — sonst haelt die Oberflaeche sich selbst fuer
    // den Benutzer (llmwiki platz-beim-blaettern-schaukelt-sich-auf). Der
    // Schritt davor hat gerade zurueckgefahren; ein einzelnes Rollen faellt
    // damit womoeglich genau in dieses Fenster, und der Test scheiterte an der
    // Schutzmassnahme statt an der Sache. Geprueft wird, DASS es einfaehrt.
    let ein = false
    for (let i = 0; i < 12 && !ein; i++) {
      await rollen(300 + i * 10)
      await schlafen(200)
      ein = await ev(`document.body.classList.contains('platz-machen')`)
    }
    assert.equal(ein, true, 'die Leiste faehrt mit offener Lane nicht mehr ein')
  })

  test('das eingefahrene Kissen hat den Lautstaerke-Knopf und gibt Hoehe frei', async () => {
    await zustand('voll')
    await zustand('spielt')
    await neuLaden()
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
    await darstellungAbwarten()
    const hoheVorher = await ev(`Math.round(document.getElementById('buehne').getBoundingClientRect().height)`)
    await rollen(220)
    await warteAuf(`document.body.classList.contains('platz-machen')`, 'die Leiste ist eingefahren')
    await schlafen(400) // den Uebergang zu Ende laufen lassen
    const hoheNachher = await ev(`Math.round(document.getElementById('buehne').getBoundingClientRect().height)`)
    assert.ok(hoheNachher > hoheVorher, `das Einfahren gibt keine Hoehe frei: ${hoheVorher} -> ${hoheNachher} px`)
    const lautSichtbar = await ev(`getComputedStyle(document.getElementById('mp-laut')).display !== 'none'`)
    assert.equal(lautSichtbar, true, 'im eingefahrenen Kissen fehlt der Lautstaerke-Knopf')
  })

  test('die Buehne haelt den Platz — auch ohne Wellen, und zeigt genau EINEN Bewohner', async () => {
    /* E129. Der Punkt des Umbaus ist nicht, DASS etwas zu sehen ist, sondern
     * dass der Platz an der EINSTELLUNG haengt: vorher gab ihn `wellen-echt`,
     * eine Laufzeit-Tatsache — die Bedienelemente sprangen, sobald die Box
     * keine Pegel lieferte. Die Attrappe liefert keine Pegel; genau deshalb
     * ist sie hier die richtige Zeugin.
     *
     * DARSTELLUNG WIRD GESICHERT UND ZURUECKGELEGT (wie beim Karten-Fall
     * darunter) — sonst messen die Folge-Faelle gegen diesen Stand. */
    const basis = `http://127.0.0.1:${PORT_VORSCHAU}`
    const vorher = await (await fetch(`${basis}/api/darstellung`)).json()
    const setzen = (aktuell) =>
      fetch(`${basis}/api/darstellung`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktuell, themen: vorher.themen || {} }),
      })
    const hoeheDerBuehne = () =>
      ev(`Math.round(document.getElementById('gr-buehne').getBoundingClientRect().height)`)
    try {
      // ── 'aus': der Stand vor E129, kein Platz ─────────────────────────
      await setzen({ ...(vorher.aktuell || {}), buehne: 'aus' })
      await zustand('spielt')
      await neuLaden()
      await darstellungAbwarten()
      await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
      // Das BILD im Kissen oeffnet den grossen Player — dasselbe wie im
      // Cover-Fall weiter unten; ein Klick auf das Kissen selbst tut es nicht.
      await ev(`(document.querySelector('.mp-bild')||{click(){}}).click(), true`)
      await warteAuf(`!document.getElementById('gross').hidden`, 'der grosse Player ist offen')
      const ausHoehe = await hoeheDerBuehne()
      /* HIER STAND `assert.equal(ausHoehe, 0)` — „der Stand vor E129, kein
       * Platz". UMGEDREHT AM 19.09.2026, und der Grund ist wichtiger als die
       * Zeile:
       *
       * DIESER FALL WAR GRUEN, WEIL EIN FEHLER DA WAR. Der Betreiber hatte
       * schon am 07.09.2026 das Gegenteil verlangt („die Position der Tasten
       * soll fix sein … bei Aus sollen sie nicht runtergehen"), und der Code
       * setzte `gross-buehne-an` seitdem dauerhaft — ABER erst ab der ersten
       * Wahl eines Bewohners. `buehneSetzen` reservierte den Platz hinter
       * `if (gewaehlt === buehneArt) return`, und beim Start ruft `anwenden()`
       * sie mit demselben Wert. Dieser Fall laedt vorher NEU, traf also genau
       * die Luecke und nagelte sie fest.
       *
       * Gemeldet wurde sie am 19.09.2026 vom Geraet: „es springt noch immer
       * beim einschalten". Rund 102 px sprangen beim ersten Einschalten hoch
       * und nie wieder zurueck.
       *
       * DIE ZUSICHERUNG IST JETZT SCHAERFER als die alte: nicht „bei aus ist
       * die Buehne 0 hoch", sondern „die Hoehe ist IMMER DIESELBE" — das ist
       * genau das, was der Betreiber meint, wenn er sagt, es soll nicht
       * huepfen. Sichtbar ist sie bei `aus` trotzdem nicht; das macht
       * `gross-buehne-leer` ueber `visibility`, nicht ueber `display`. */
      assert.ok(ausHoehe > 0, `bei 'aus' haelt die Buehne ihren Platz nicht (${ausHoehe} px)`)
      const ausUnsichtbar = await ev(
        `getComputedStyle(document.getElementById('gr-buehne')).visibility === 'hidden'`,
      )
      assert.equal(ausUnsichtbar, true, 'bei "aus" ist die Buehne sichtbar — sie soll nur ihren Platz halten')

      // ── 'titel': Platz da, OHNE dass je ein Pegel geflossen waere ─────
      await setzen({ ...(vorher.aktuell || {}), buehne: 'titel' })
      /* WORAUF HIER GEWARTET WIRD — geaendert am 19.09.2026, und der Grund
       * ist derselbe wie eine Zeile weiter oben: Hier stand
       * `classList.contains('gross-buehne-an')`. Diese Klasse steht seit
       * heute IMMER (der Platz wird ab dem Start gehalten), das Warten kehrte
       * also sofort zurueck — noch BEVOR der Darstellungs-Poll `titel`
       * angewandt hatte. Der Fall lief dann gegen den alten Bewohner und fiel
       * mit „bei titel zeichnet noch die Wellen-Leinwand".
       *
       * EIN WARTEN AUF ETWAS, DAS IMMER GILT, IST KEIN WARTEN. Der Zustand,
       * der sich wirklich aendert, ist `gross-buehne-leer` — sie sitzt bei
       * `aus` und faellt, sobald ein Bewohner da ist. Dasselbe gilt fuer die
       * alte zweite Bedingung (`hoehe > 0`): auch sie ist jetzt dauerhaft
       * wahr; die Hoehe prueft weiter unten die Gleichheits-Zusicherung, und
       * die sagt mehr. */
      await warteAuf(
        `!document.body.classList.contains('gross-buehne-leer')`,
        'die Buehne hat einen Bewohner bekommen',
      )
      const wellenEcht = await ev(`document.body.classList.contains('wellen-echt')`)
      assert.equal(wellenEcht, false, 'die Attrappe liefert Pegel — dann beweist der Fall nichts')

      /* KEIN HUEPFEN (19.09.2026): dieselbe Hoehe wie bei `aus`. Das ist die
       * eigentliche Aussage dieses Falls — dass ueberhaupt Platz da ist, sagt
       * die Zeile darueber schon. Ein Unterschied hier hiesse: die
       * Bedienelemente darunter springen beim Umschalten. */
      const titelHoehe = await hoeheDerBuehne()
      assert.equal(
        titelHoehe,
        ausHoehe,
        `die Buehne wechselt beim Einschalten ihre Hoehe (${ausHoehe} -> ${titelHoehe} px) — die Tasten darunter huepfen`,
      )

      // GENAU EIN BEWOHNER: die Leinwand ist weg, die Textflaeche steht.
      const bewohner = await ev(`(() => {
        const c = document.getElementById('gr-wellen')
        const t = document.getElementById('gr-buehne-text')
        return { leinwand: !c.hidden, text: !t.hidden, zeilen: t.querySelectorAll('.bt-zeile').length }
      })()`)
      assert.equal(bewohner.leinwand, false, 'bei "titel" zeichnet noch die Wellen-Leinwand')
      assert.equal(bewohner.text, true, 'die Textflaeche der Buehne steht nicht da')
      assert.ok(bewohner.zeilen > 0, 'die Buehne bleibt leer, obwohl ein Titel laeuft')

      // ── 'wellen': umgekehrt — Leinwand da, Text weg ───────────────────
      await setzen({ ...(vorher.aktuell || {}), buehne: 'wellen' })
      await warteAuf(`!document.getElementById('gr-wellen').hidden`, 'die Leinwand kommt zurueck')
      const textWeg = await ev(`document.getElementById('gr-buehne-text').hidden`)
      assert.equal(textWeg, true, 'bei "wellen" steht die Textflaeche noch da — zwei Bewohner')
    } finally {
      await setzen(vorher.aktuell || {})
    }
  })

  test('albumTipp "karte": die Titelliste waechst aus der Kachel — und geht sauber wieder zu', async () => {
    /* E121/4d, die Ueberblend-Karte (Idee des alten Flip, ohne rotateY).
     * Die DARSTELLUNG wird gesichert und am Ende ZURUECKGELEGT — ein PUT
     * ersetzt die Attrappen-Fassung, und die Folge-Faelle messen sonst
     * gegen den Stand dieses Tests (die Falle aus dem Kasten bei
     * darstellungAbwarten, dritter Zuschlag dokumentiert). */
    const basis = `http://127.0.0.1:${PORT_VORSCHAU}`
    const vorher = await (await fetch(`${basis}/api/darstellung`)).json()
    const setzen = (aktuell) =>
      fetch(`${basis}/api/darstellung`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktuell, themen: vorher.themen || {} }),
      })
    try {
      await setzen({ ...(vorher.aktuell || {}), albumTipp: 'karte' })
      await zustand('spielt')
      await neuLaden()
      await darstellungAbwarten()

      // Eine ALBUM-Kachel im Raster antippen (die Attrappe traegt welche).
      await warteAuf(`document.querySelectorAll('#raster .kachel').length > 0`, 'das Raster steht')
      const getroffen = await ev(`(() => {
        const k = [...document.querySelectorAll('#raster .kachel')].find((x) => x.querySelector('.tipp-spiel'))
        if (!k) return false
        k.click()
        return true
      })()`)
      assert.equal(getroffen, true, 'keine Album-Kachel mit Zeigen-Weg im Raster')

      await warteAuf(
        `!!document.querySelector('.titelkarte.auf .tk-blatt .lane')`,
        'die Titelkarte ist auf und traegt die echte Lane',
      )
      // Die Lane in der Karte ist DIE Lane — lane.element haengt dort.
      const zeilen = await ev(`document.querySelectorAll('.tk-blatt .lane *').length`)
      assert.ok(zeilen > 2, `die Karte ist leer (${zeilen} Kinder)`)

      // Zu — ueber den Karten-X; die Lane muss mitgeraeumt sein.
      await ev(`(document.querySelector('.tk-zu').click(), true)`)
      await warteAuf(`!document.querySelector('.titelkarte')`, 'die Karte ist wieder weg')
      const laneWeg = await ev(`!document.querySelector('.tk-blatt .lane') && !document.querySelector('#raster .lane')`)
      assert.equal(laneWeg, true, 'die Lane blieb nach dem Schliessen liegen')
    } finally {
      await setzen(vorher.aktuell || {})
    }
  })

  test('die Leiste: KEIN Bild im Wappen, und die Kategorien stehen still', async () => {
    // ── DER BERICHTIGTE WUNSCH (Betreiber, 05.08.2026) ────────────────────
    //
    // „ich wollte niemals die mixpi figur unten links, ich wollte sie oben
    // links, schon vorbereitend fuer den platz des bildes. damals ging was
    // schief :)"
    //
    // ZWEI DINGE HAENGEN ZUSAMMEN, und deshalb stehen sie in EINEM Fall:
    // Das 44-px-Bild aus dem Wappen zu nehmen verkuerzt es um 46 px (44 Bild
    // + 2 gap). Diese 46 px fallen der Kategorienliste zu, und die richtete
    // bis zum 05.08.2026 mit `justify-content: safe center` aus — sie haette
    // den Zugewinn auf beide Seiten geteilt und alle vier Kategorien um
    // 23 px NACH UNTEN geschoben, mitten in die runde Backe des
    // Lautstaerke-Kissens. GEMESSEN (tools/beruehrziele-neu.mjs): „Radio"
    // faellt dabei von 7,56 auf 5,60 mm.
    //
    // WARUM DAS OHNE DIESEN FALL NIEMAND MERKT: Die ANZAHL der zu kleinen
    // Ziele bleibt dabei unveraendert bei 22 von 193. Wer zwei Laeufe nur an
    // ihrer Schlusszahl vergleicht, sieht die Verschlechterung nicht — sie
    // steckt in der Groesse EINES Ziels.
    // AUF 800x480, UND DAS IST HIER KEINE FORMALIE. Headless gibt von sich
    // aus 800x337 her — auf einer 143 px flacheren Leiste schrumpfen die vier
    // Kategorien auf 42 px, und dieser Fall meldete rot fuer eine Sache, die
    // es auf dem Waveshare-Schirm gar nicht gibt. Dieselbe Vorsichtsmassnahme
    // wie beim Fall „ins Bild gerollt" weiter unten.
    await senden('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 480,
      deviceScaleFactor: 1,
      mobile: false,
    })
    try {
    await zustand('voll')
    await neuLaden()
    await darstellungAbwarten()
    const l = await ev(`(() => {
      const kats = [...document.querySelectorAll('#kat-liste .kat')]
      const ich = document.getElementById('ich')
      const erste = kats[0]
      const griff = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--griff'))) || 0
      return {
        wappenBild: !!document.querySelector('.wappen-bild'),
        // WAS UNTEN BLEIBT: Name und Fassung sind der ZWEITE Zielort
        // desselben Wunsches und ausdruecklich gewuenscht.
        name: ((document.getElementById('wappen-oben') || {}).textContent || '').trim(),
        // Die Fassung wohnt seit dem 08.08.2026 im Eltern-Menue (unten
        // links, Betreiberwunsch) — nicht mehr im Wappen der Leiste.
        fassung: ((document.getElementById('eltern-fassung') || {}).textContent || '').trim(),
        fassungInLeiste: !!document.getElementById('wappen-fassung'),
        anzahl: kats.length,
        griff,
        hoehen: kats.map((k) => Math.round(k.getBoundingClientRect().height)),
        // DER ABSTAND, an dem die Ausrichtung haengt. Mit flex-start sind es
        // die 16 px aus dem Innenabstand der Leiste, bei JEDEM Boxnamen. Mit
        // center waeren es 39 — und bei langem Namen 30,5. (KEINE BACKTICKS
        // IN DIESEM BLOCK: er steht in einem Template-Literal.)
        luecke: ich && erste
          ? Math.round(erste.getBoundingClientRect().top - ich.getBoundingClientRect().bottom)
          : -1,
      } })()`)
    // ES IST NICHT VERGESSEN WORDEN, ES GEHOERT NACH OBEN. Steht hier wieder
    // ein Bild, sind es zwei MixPis auf einem Schirm.
    assert.equal(l.wappenBild, false, 'im Wappen steht wieder ein Bild — es gehoert oben links ins Zeichen')
    assert.ok(l.name.length > 0, 'der Boxname ist mit dem Bild verschwunden')
    // Nicht mehr in der LEISTE: die Fassung zog am 08.08.2026 ins
    // Eltern-Menue (unten links). Dort muss sie stehen — und in der Leiste
    // darf sie NICHT wieder auftauchen (zwei Orte, eine Zahl).
    assert.ok(l.fassung.length > 0, 'die laufende Fassung fehlt im Eltern-Menue (#eltern-fassung)')
    assert.equal(l.fassungInLeiste, false, 'die Fassung ist zurueck in der Leiste — sie wohnt im Eltern-Menue')
    assert.equal(l.anzahl, 4, `es sind nicht vier Kategorien: ${l.anzahl}`)
    // DIE MARKE WIRD AUS DER SEITE GELESEN, NICHT ABGESCHRIEBEN — dieselbe
    // Lehre wie beim Fall „GLEICHER HOEHE" weiter unten: eine zweite Fassung
    // derselben Zahl laeuft auseinander, und die Pruefung merkt es als
    // Letzte.
    assert.ok(l.griff >= 44, `--griff kam nicht aus der Seite (gelesen: ${l.griff})`)
    // SIE SCHRUMPFEN STILL, wenn es eng wird: `.kat` traegt `height` statt
    // `min-height`, `flex-shrink` steht auf 1. Es rollt dabei nichts und es
    // wird nichts abgeschnitten — nur die Millimeter aendern sich.
    for (const h of l.hoehen) {
      assert.ok(h >= l.griff, `eine Kategorie ist auf ${h} px geschrumpft, die Marke sind ${l.griff} px`)
    }
    // UND DIE EIGENTLICHE WACHE: Die 46 px Reserve liegen UNTEN, nicht
    // haelftig ueber und unter dem Block. Genau 16 px, wie zwischen
    // `#zurueck` und der Ueberschrift des Eltern-Bereichs.
    assert.equal(l.luecke, 16, `zwischen dem Zeichen und der ersten Kategorie liegen ${l.luecke} px statt 16`)
    } finally {
      // ZURUECKLEGEN, sonst misst jeder folgende Fall in einem Sichtfenster,
      // das er nicht bestellt hat.
      await senden('Emulation.clearDeviceMetricsOverride')
    }
  })

  test('EIN Kind, EIN Bild: die Profilreihe zeigt dasselbe wie das Zeichen oben links', async () => {
    // ── WAS HIER SCHIEFGING, UND WARUM ES KEINE MESSUNG SAH ───────────────
    //
    // Am 05.08.2026 bekam der Leerfall eine Vorgabe: Wer sich noch kein Bild
    // ausgesucht hat, sieht oben links DAS MixPi statt einer Silhouette
    // (llmwiki [[leerer-wert-heisst-nicht-leere-anzeige]]). Eingebaut wurde
    // sie an zwei von DREI Stellen — `#ich-bild` und die Kachel „MixPi" —,
    // aber nicht in der Reihe „Wer hoert?". Dort blieb `figurPfad`, also der
    // leere Pfad, also die Silhouette.
    //
    // BEIDE STANDEN GLEICHZEITIG AUF DEM SCHIRM. Das Fenster deckt mit
    // `rgba(46,42,59,0.42)` ab — 42 %: der Finger kommt nicht mehr durch, das
    // Auge sehr wohl. Fuer EIN UND DASSELBE KIND zeigte die Oberflaeche damit
    // zwei verschiedene Koepfe, 200 px voneinander entfernt.
    //
    // UND ES EBNETE ZWEI LAGEN EIN, die verschieden aussehen MUESSEN:
    // „hat sich nichts ausgesucht" und „das gewaehlte Bild ist weg" ergaben
    // in dieser Reihe dasselbe Bild. Wer das sieht, sucht nie nach der
    // fehlenden Datei.
    //
    // DIE ZAHL DER MASKOTTCHEN VERRAET ES NICHT (tools/maskottchen-zaehlen.mjs
    // zaehlte in beiden Faellen dasselbe), die Beruehrziele auch nicht: die
    // Kachel ist gleich gross, egal was darin steht.
    await zustand('profil-gast')
    await zustand('figuren-keine')
    await neuLaden()
    // GETIPPT WIRD, BIS ES AUFGEHT — und das ist keine Bequemlichkeit.
    // `neuLaden()` wartet darauf, dass Raster oder Zustand sichtbar sind. Das
    // kann die NOCH STEHENDE Seite von vorhin erfuellen, bevor die Navigation
    // ueberhaupt umgeschaltet hat: Der Tipp trifft dann das alte Dokument und
    // ist mit ihm weg. GEMESSEN: einer von drei Laeufen fiel so aus, mit einer
    // Meldung („das Fenster geht nicht auf"), die auf die Oberflaeche zeigte
    // statt auf den Messaufbau. Ein Wiederholtipp trifft in jedem Fall das
    // Dokument, das dann wirklich dasteht.
    await warteAuf(
      `(() => {
        const b = document.getElementById('ich')
        const f = document.getElementById('ich-fenster')
        if (!b || !f) return false
        if (f.hidden) b.click()
        return !f.hidden
      })()`,
      'das Fenster „wer hoert" ist offen',
    )
    // AUCH aufs Oben-Bild warten, nicht nur auf die Reihe: beide setzt
    // derselbe Lauf, aber nicht im selben Augenblick — die Reihe kann
    // stehen, waehrend src oben noch leer ist. Genau in dieses Fenster
    // fiel der Fall am 05.09.2026, als E121-Zeilen den Start um
    // Mikrosekunden verschoben (vorher 28/28, danach reproduzierbar rot).
    await warteAuf(
      `document.querySelectorAll('#ich-leute .ich-kachel').length > 0
        && !!(document.getElementById('ich-bild') || {getAttribute(){return ''}}).getAttribute('src')`,
      'die Profilreihe steht und oben traegt ein Bild',
    )
    const w = await ev(`(() => {
      const kachel = [...document.querySelectorAll('#ich-leute .ich-kachel')].find(
        (k) => k.getAttribute('aria-pressed') === 'true')
      const inKachel = kachel ? kachel.querySelector('img') : null
      const oben = document.getElementById('ich-bild')
      const quelle = (e) => (e ? e.getAttribute('src') || '' : '')
      return { reihe: quelle(inKachel), oben: quelle(oben), gefunden: !!kachel }
    })()`)
    assert.equal(w.gefunden, true, 'in der Profilreihe ist kein Profil als „dran" gekennzeichnet')
    assert.ok(w.oben.endsWith('mixpi-hoert.png'), `oben links steht nicht das Standardbild: "${w.oben}"`)
    // DIE EIGENTLICHE WACHE. Nicht „die Reihe zeigt IRGENDEIN Bild", sondern
    // „sie zeigt DASSELBE" — ein zweites Standardbild an anderer Stelle waere
    // wieder eine zweite Wahrheit ueber dasselbe Kind.
    assert.equal(
      w.reihe,
      w.oben,
      `dasselbe Kind traegt in der Reihe "${w.reihe}" und oben links "${w.oben}"`,
    )
  })

  test('das grosse Cover traegt keine Bedienelemente mehr', async () => {
    // Der Wunsch der Nutzerin: „das cover muss ganz sichtbar sein". Geprueft
    // wird die BEMALTE Flaeche, nicht der Kasten — `object-fit: contain`
    // laesst das <img> groesser sein als das Bild darin.
    await zustand('voll')
    await zustand('spielt')
    await neuLaden()
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
    await ev(`(document.querySelector('.mp-bild')||{click(){}}).click(), true`)
    await schlafen(200)
    await ev(`(document.querySelector('#gross .gross-bild')||{click(){}}).click(), true`)
    await warteAuf(`!document.getElementById('album-gross').hidden`, 'die grosse Albumansicht steht')
    const ueber = await ev(`(() => {
      const img = document.getElementById('ag-bild');
      const r = img.getBoundingClientRect();
      const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
      const f = Math.min(r.width / nw, r.height / nh);
      const c = { left: r.left + (r.width - nw*f)/2, top: r.top + (r.height - nh*f)/2,
                  right: r.left + (r.width + nw*f)/2, bottom: r.top + (r.height + nh*f)/2 };
      const teile = ['#zurueck', '.ag-wort', '.ag-leiste'];
      return teile.map((s) => {
        const e = document.querySelector(s); const b = e.getBoundingClientRect();
        const w = Math.max(0, Math.min(c.right, b.right) - Math.max(c.left, b.left));
        const h = Math.max(0, Math.min(c.bottom, b.bottom) - Math.max(c.top, b.top));
        return { s, flaeche: Math.round(w * h) };
      }) })()`)
    for (const u of ueber) {
      assert.equal(u.flaeche, 0, `${u.s} liegt mit ${u.flaeche} px² auf dem Cover`)
    }
  })

  /**
   * BEIM TITELWECHSEL ZIEHEN ALLE SICHTBAREN ORTE NACH.
   *
   * DIE MELDUNG, aus der dieser Test stammt (03.08.2026): „auch im voll bild
   * aktualiierte es die infromationen nicht". Das Cover-Vollbild setzte Titel
   * und Interpret NUR beim Oeffnen (`albumGrossAuf`); der 2-Sekunden-Takt fasste
   * sie nicht an. Wer die Ansicht offen liess, sah beim naechsten Stueck
   * weiterhin Titel, Interpret UND Cover des vorigen.
   *
   * WARUM DIESER TEST DIE ORTE NICHT AUFZAEHLT: Genau das Aufzaehlen war der
   * Fehler. Drei Orte, drei Sammlungen eigener Zuweisungen, einer vergessen.
   * Ein Test, der `ag-titel` beim Namen nennt, bewacht denselben Ort noch
   * einmal und laesst den VIERTEN wieder durch. Gezaehlt wird deshalb aus dem
   * Baum: jede Huelle mit `data-anzeigeort`, die gerade sichtbar ist, muss den
   * neuen Titel zeigen. Wer einen Ort hinzufuegt, faellt hier automatisch mit
   * hinein.
   *
   * GEGEN DEN LEEREN DURCHLAUF: Faende die Abfrage nichts, waere die Schleife
   * leer und der Test gruen, ohne etwas geprueft zu haben. Deshalb wird zuerst
   * darauf bestanden, dass ALLE DREI bekannten Huellen sichtbar dabei sind.
   */
  const ORTE_LESEN = `(() => [...document.querySelectorAll('[data-anzeigeort]')].map((h) => ({
      name: h.dataset.anzeigeort,
      sichtbar: !h.hidden,
      titel: ((h.querySelector('[data-np="titel"]') || {}).textContent || '').trim(),
      unter: ((h.querySelector('[data-np="unter"]') || {}).textContent || '').trim(),
      cover: (h.querySelector('[data-np="cover"]') || { getAttribute: () => '' }).getAttribute('src') || '',
    })))()`

  test('beim Titelwechsel zeigen ALLE sichtbaren Orte den neuen Titel und sein Cover', async () => {
    await zustand('voll')
    await zustand('spotify')
    await neuLaden()
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')

    // Beide Ansichten aufmachen — nur was offen ist, wird geprueft, und der
    // beanstandete Ort ist ausgerechnet der, den man nebenbei offen laesst.
    await ev(`(document.querySelector('.mp-bild') || { click() {} }).click(), true`)
    await schlafen(200)
    await ev(`(document.querySelector('#gross .gross-bild') || { click() {} }).click(), true`)
    await warteAuf(`!document.getElementById('album-gross').hidden`, 'das Cover-Vollbild steht')

    const vorher = (await ev(ORTE_LESEN)).filter((o) => o.sichtbar)
    const namen = vorher.map((o) => o.name)
    for (const erwartet of ['Mini-Player', 'grosser Player', 'Cover-Vollbild']) {
      assert.ok(
        namen.includes(erwartet),
        `„${erwartet}" ist nicht als sichtbarer Anzeigeort zu finden — steht data-anzeigeort noch im HTML? gefunden: ${namen.join(', ') || 'nichts'}`,
      )
    }
    const titelVorher = vorher[0].titel
    assert.ok(titelVorher.length > 0, 'schon vor dem Wechsel steht nirgends ein Titel')
    for (const o of vorher) {
      assert.equal(o.titel, titelVorher, `„${o.name}" zeigt schon vor dem Wechsel etwas anderes`)
    }

    // Der Wechsel. Die Seite fragt /player/state im 2-Sekunden-Takt; gewartet
    // wird auf die Wirkung, nicht auf eine feste Zeit.
    await zustand('spotify-weiter')
    await warteAuf(
      `[...document.querySelectorAll('[data-anzeigeort]')].some((h) => !h.hidden &&
        ((h.querySelector('[data-np="titel"]') || {}).textContent || '').trim() !== ${JSON.stringify(titelVorher)})`,
      'irgendein Ort hat den Titelwechsel bemerkt',
    )
    // Ein Takt Zugabe: haette ein Ort einen EIGENEN, spaeteren Weg, soll er
    // ihn gehen duerfen. Erst danach wird beanstandet.
    await schlafen(2500)

    const nachher = (await ev(ORTE_LESEN)).filter((o) => o.sichtbar)
    assert.equal(nachher.length, vorher.length, 'ein Anzeigeort ist beim Wechsel verschwunden')
    const titelNeu = nachher.find((o) => o.name === 'Mini-Player').titel
    assert.notEqual(titelNeu, titelVorher, 'die Vorschau hat den Titel gar nicht gewechselt')

    for (const o of nachher) {
      const alt = vorher.find((v) => v.name === o.name)
      assert.equal(o.titel, titelNeu, `„${o.name}" zeigt noch „${o.titel}" statt „${titelNeu}"`)
      // `unter` und `cover` sind FREIWILLIG — der Mini-Player hat keine
      // Interpretenzeile, er ist zu schmal dafuer. Geprueft wird deshalb nur,
      // wo vorher etwas stand; sonst beanstandete der Test das Fehlen eines
      // Elements, das es absichtlich nicht gibt.
      if (alt.unter) {
        assert.notEqual(o.unter, alt.unter, `„${o.name}" hat den Interpreten nicht nachgezogen: „${o.unter}"`)
      }
      // DAS COVER MUSS MIT. Es steht in derselben Meldung
      // (item.album.images) und wurde im Vollbild aus demselben Grund
      // vergessen — der Text allein waere eine halbe Reparatur.
      if (alt.cover) {
        assert.notEqual(o.cover, alt.cover, `„${o.name}" zeigt noch das Cover des vorigen Titels (${o.cover})`)
      }
    }
    const coverGleich = new Set(nachher.filter((o) => o.cover).map((o) => o.cover))
    assert.equal(coverGleich.size, 1, `die Orte zeigen verschiedene Cover: ${[...coverGleich].join(' | ')}`)
  })

  /**
   * DIE WEITERHOEREN-KACHEL SAGT DEN NAMEN DER FOLGE, nicht „Titel 2".
   *
   * WOHER DIE REGEL (06.08.2026): „Titel 2" ist ehrlich und sagt nichts. An
   * einer Sendung mit dreissig Folgen erkennt ein Kind die eine, bei der es
   * aufgehoert hat, am NAMEN. Der Name kommt aus der GEMERKTEN STELLE selbst
   * (weiterhoeren.ts `resumeardfolgentitel`) und wird nicht ein zweites Mal
   * beschafft.
   *
   * WARUM HIER UND NICHT NUR IN pruef-neu-regeln: Dort wird die REGEL geprueft
   * (weiterMarke), hier die KETTE — dass das Feld vom Server bis auf die
   * Plakette durchkommt. Genau diese Kette ist an anderer Stelle schon einmal
   * still gerissen (llmwiki attrappe-luegt-durch-weglassen).
   */
  test('Weiterhoeren zeigt den FOLGENNAMEN statt „Titel 2"', async () => {
    await zustand('voll')
    // Die ARD-Zeile steht sonst ausserhalb des Sechser-Fensters; dieser
    // Hebel holt sie nach vorn (siehe Kopf von tools/neu-vorschau.mjs).
    await zustand('verlauf-ard')
    await neuLaden()
    await warteAuf(`!document.getElementById('weiter').hidden`, 'die Weiterhoeren-Reihe steht da')

    const marken = `[...document.querySelectorAll('#weiter-reihe .weiter-folge')].map((e) => e.textContent.trim())`
    const alle = await ev(marken)
    // GEGEN DEN LEEREN DURCHLAUF: Ohne irgendeine Plakette bewiese der Test
    // nichts — er waere auch dann gruen, wenn die Reihe gar keine zeigte.
    assert.ok(alle.length > 0, 'gar keine Plakette in der Reihe gefunden')
    assert.ok(
      alle.includes('Der Schneemann taut'),
      `der Folgenname steht nicht auf der Kachel: ${JSON.stringify(alle)}`,
    )

    // UND DIE NUMMER BLEIBT DER RUECKFALL. Sie darf nicht verschwinden — die
    // Spotify- und die lokale Zeile haben keinen Namen, und dort ist „Titel 4"
    // weiterhin die beste Auskunft, die es gibt.
    assert.ok(
      alle.some((x) => /^Titel \d+$/.test(x)),
      `die Nummer ist als Rueckfall verschwunden: ${JSON.stringify(alle)}`,
    )

    // Die Vorlesestimme sagt dasselbe. Zwei Saetze, die auseinandergehen, sind
    // hier schon einmal ein eigener Befund gewesen.
    const label = await ev(
      `([...document.querySelectorAll('#weiter-reihe .weiter-kachel')]
        .map((k) => k.getAttribute('aria-label') || '')
        .find((s) => s.includes('Der Schneemann taut')) || '')`,
    )
    assert.ok(label.includes('weiterhören'), `das aria-label nennt den Folgennamen nicht: ${label}`)
  })

  /**
   * DAS COVER FOLGT DER LAUFENDEN POSITION — statt beim Start gemerkt zu werden.
   *
   * DER FALL, GEGEN DEN ES GEBAUT IST (am Geraet gemessen, Box .169,
   * 06.08.2026): Am Titelende zaehlt `currentTracknr` OHNE jeden Befehl von
   * aussen weiter. Ein beim Start festgehaltenes Bild bliebe dann stehen, und
   * die Anzeige zeigte den Zustand von vorhin — und saehe dabei richtig aus.
   *
   * DIE ATTRAPPE KONNTE DEN FALL BIS HEUTE GAR NICHT STELLEN. Bei mpv gibt es
   * keinen `item.uri`, an dem ein Titelwechsel abzulesen waere; die einzige
   * Auskunft ist die Warteschlangennummer, und die war in
   * tools/neu-vorschau.mjs festgenagelt. Dazu fehlte je Folge das `bild`.
   * Beides ist nachgetragen — sonst waere dieser Test unbestehbar gewesen,
   * ganz gleich wie richtig die Oberflaeche rechnet.
   */
  test('das Cover geht bei mpv mit der Warteschlangennummer mit', async () => {
    await zustand('voll')
    await zustand('spielt')
    await zustand('mpv-erste')
    await neuLaden()

    // DEN PLAY-KNOPF DER ARD-KACHEL druecken, nicht die Kachel: Ein Tipp auf
    // eine ARD-Kachel KLAPPT sie AUF (BACKLOG E4/A10), gestartet wird ueber den
    // eigenen Knopf. Erst dadurch kennt die Seite die Liste, gegen die mpv
    // gleich zaehlt (`albumSpielen`, `laufendeFolgen`).
    await warteAuf(`document.getElementById('raster').children.length > 0`, 'das Raster hat Kacheln')
    const getippt = await ev(
      `(() => {
        const k = [...document.querySelectorAll('#raster .kachel')]
          .find((x) => (x.getAttribute('aria-label') || '').includes('MausHörspiel'))
        if (!k) return 'keine Kachel'
        const s = k.querySelector('.tipp-spiel')
        if (!s) return 'kein Play-Knopf'
        s.click()
        return 'ok'
      })()`,
    )
    assert.equal(getippt, 'ok', `die ARD-Kachel liess sich nicht starten: ${getippt}`)

    const coverJetzt = `((document.querySelector('.mp-bild img') || {}).getAttribute
      ? (document.querySelector('.mp-bild img').getAttribute('src') || '') : '')`
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
    await warteAuf(`${coverJetzt}.includes('folge=0')`, 'das Cover der ERSTEN Folge steht im Mini-Player')

    // JETZT RUECKT mpv VON SELBST WEITER — kein Befehl von der Seite.
    await zustand('mpv-weiter')
    await warteAuf(
      `${coverJetzt}.includes('folge=1')`,
      'das Cover ist der Warteschlangennummer NICHT gefolgt (es blieb bei der ersten Folge)',
    )

    // Und noch einmal, damit nicht ein einzelner Zufallstreffer als Beweis
    // durchgeht.
    await zustand('mpv-weiter')
    await warteAuf(`${coverJetzt}.includes('folge=2')`, 'das Cover ist beim zweiten Wechsel stehengeblieben')
  })

  /**
   * DER NAME GEHT MIT — DERSELBE WEG WIE DAS COVER (BACKLOG F1).
   *
   * WARUM ES EIN EIGENER TEST IST UND NICHT EINE ZEILE IM COVER-TEST: Die
   * beiden Anzeigen sind AUSEINANDERGEGANGEN, und genau das ist der Fehler.
   * Seit das Cover der Position folgt (06.08.2026), stand das Bild von Folge N
   * unter dem Namen von Folge 1 — vorher war beides falsch und wenigstens in
   * sich stimmig, seitdem widerspricht die Anzeige sich selbst. Ein Test, der
   * beides in einem Rutsch prueft, koennte an EINER Zusicherung scheitern und
   * saehe wie ein Cover-Fehler aus.
   *
   * DIE ATTRAPPE STELLT DEN FALL SCHARF: `/player/local` meldet
   * `currentTrackname: 'Folge 3 — Die Maus'` — FEST, wie am Geraet gemessen
   * (tools/titelname-je-quelle.mjs, 05.08.2026: `duration`, `timePos` und
   * `currentTracknr` folgen, der Name nie). Steht dieser Text am Ende in der
   * Titelzeile, hat die Seite den gemeldeten Namen geglaubt statt
   * nachzuschlagen.
   */
  test('der Titelname geht bei mpv mit der Warteschlangennummer mit', async () => {
    await zustand('voll')
    await zustand('spielt')
    await zustand('mpv-erste')
    await neuLaden()

    await warteAuf(`document.getElementById('raster').children.length > 0`, 'das Raster hat Kacheln')
    const getippt = await ev(
      `(() => {
        const k = [...document.querySelectorAll('#raster .kachel')]
          .find((x) => (x.getAttribute('aria-label') || '').includes('MausHörspiel'))
        if (!k) return 'keine Kachel'
        const s = k.querySelector('.tipp-spiel')
        if (!s) return 'kein Play-Knopf'
        s.click()
        return 'ok'
      })()`,
    )
    assert.equal(getippt, 'ok', `die ARD-Kachel liess sich nicht starten: ${getippt}`)

    const titelJetzt = `((document.querySelector('#mp-titel') || {}).textContent || '').trim()`
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
    await warteAuf(`${titelJetzt} === 'Fälschung'`, 'der Name der ERSTEN Folge steht im Mini-Player')

    // JETZT RUECKT mpv VON SELBST WEITER — kein Befehl von der Seite.
    await zustand('mpv-weiter')
    await warteAuf(
      `${titelJetzt} === 'Der Schneemann taut'`,
      'der Titelname ist der Warteschlangennummer NICHT gefolgt (er blieb bei der ersten Folge)',
    )

    // Und noch einmal, damit kein Zufallstreffer als Beweis durchgeht.
    await zustand('mpv-weiter')
    await warteAuf(
      `${titelJetzt}.startsWith('Wie kommt der Strom')`,
      'der Titelname ist beim zweiten Wechsel stehengeblieben',
    )

    // ALLE ORTE ZEIGEN DENSELBEN NAMEN. `anzeigeMalen` ist der einzige
    // Schreiber; ginge der grosse Player eigene Wege, faende es sonst
    // niemand — er ist beim Messen meistens zu.
    const alle = await ev(
      `[...document.querySelectorAll('[data-np="titel"]')].map((e) => (e.textContent || '').trim())`,
    )
    const verschieden = [...new Set(alle.filter((s) => s && s !== '—'))]
    assert.equal(
      verschieden.length,
      1,
      `die Anzeigeorte zeigen verschiedene Titel: ${JSON.stringify(verschieden)}`,
    )
    assert.ok(
      !verschieden.some((s) => s.includes('Folge 3 — Die Maus')),
      `der gemeldete (stehengebliebene) Name steht noch auf dem Schirm: ${JSON.stringify(verschieden)}`,
    )
  })

  /**
   * ...UND ES HOERT AUF, DER LISTE ZU FOLGEN, WENN ETWAS ANDERES LAEUFT.
   *
   * DER BEFUND (Gegenlesen, 06.08.2026). Die gemerkte Folgenliste wurde nur
   * gegen `laufendesWerk()` abgesichert — und diese Auskunft ist ausdruecklich
   * UNGEPRUEFT: sie gibt `zuletztGestartet` unbesehen zurueck
   * (`laufendesWerkMitBeweis`, Stufe 2). Beide Seiten des Vergleichs stammten
   * damit aus derselben Zuweisung in `albumSpielen`; er konnte gar nicht nein
   * sagen.
   *
   * WAS DAMIT DURCHKAM: Wirft jemand vom Telefon oder aus der klassischen
   * Oberflaeche etwas anderes an, ersetzt mpv die Warteschlange.
   * `currentTracknr` zaehlt dann in der NEUEN Liste — nachgeschlagen wurde in
   * der alten, und die Leiste zeigte das Bild einer Folge, die gar nicht mehr
   * laeuft. Ein Cover, das zum Ton nicht gehoert, ist schlimmer als gar keins;
   * derselbe Satz steht in `passtZuLaufendem`, und derselbe Vergleich schuetzt
   * `stelleMelden` schon davor, eine Stelle unter das falsche Werk zu
   * schreiben.
   *
   * DER FALL LIESS SICH BIS HEUTE NICHT STELLEN: die Attrappe meldete an
   * `/player/local` IMMER dasselbe Werk. `mpv-fremd` ist deshalb neu
   * (tools/neu-vorschau.mjs) — wieder [attrappe-luegt-durch-weglassen], hier
   * in der Sorte „der fehlende Fall".
   */
  test('das Cover folgt der Liste NICHT mehr, wenn etwas Fremdes laeuft', async () => {
    await zustand('voll')
    await zustand('spielt')
    await zustand('mpv-eigen')
    await zustand('mpv-erste')
    await neuLaden()

    await warteAuf(`document.getElementById('raster').children.length > 0`, 'das Raster hat Kacheln')
    const getippt = await ev(
      `(() => {
        const k = [...document.querySelectorAll('#raster .kachel')]
          .find((x) => (x.getAttribute('aria-label') || '').includes('MausHörspiel'))
        if (!k) return 'keine Kachel'
        const s = k.querySelector('.tipp-spiel')
        if (!s) return 'kein Play-Knopf'
        s.click()
        return 'ok'
      })()`,
    )
    assert.equal(getippt, 'ok', `die ARD-Kachel liess sich nicht starten: ${getippt}`)

    const coverJetzt = `((document.querySelector('.mp-bild img') || {}).getAttribute
      ? (document.querySelector('.mp-bild img').getAttribute('src') || '') : '')`
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')
    // GEGEN DEN LEEREN DURCHLAUF: Erst muss das Folgenbild wirklich dastehen,
    // sonst bewiese das „nicht mehr" darunter nichts — es waere auch dann
    // gruen, wenn die Liste nie befragt worden waere.
    await warteAuf(`${coverJetzt}.includes('folge=')`, 'das Folgenbild steht ueberhaupt im Mini-Player')

    // JETZT WIRFT JEMAND ANDERES ETWAS AN — ein anderes Werk, eine andere
    // Warteschlange. Von dieser Seite geht dabei kein einziger Befehl hinaus.
    await zustand('mpv-fremd')
    await warteAuf(
      `!${coverJetzt}.includes('folge=')`,
      'die Leiste zeigt weiter das Bild einer Folge, die gar nicht mehr laeuft',
    )

    // Und sie zeigt das RICHTIGE: Stufe 1 (`coverFuerLokal`) findet das Werk
    // ueber den gemeldeten Namen. Ein blosses „nicht mehr das alte" waere auch
    // erfuellt, wenn gar nichts mehr dastuende.
    await warteAuf(`${coverJetzt}.length > 0`, 'es steht gar kein Cover mehr da')

    // AUFRAEUMEN: der Hebel bleibt sonst fuer den naechsten Fall umgelegt.
    await zustand('mpv-eigen')
  })

  /**
   * ══ BACKLOG F2: DIE MARKE „SPIELT GERADE" AUF EINER mpv-FOLGE ═════════════
   *
   * DER BEFUND, den dieser Fall festnagelt: Bei einer ARD-Sendung trug bis zum
   * 05.08.2026 KEINE EINZIGE Folgenkachel das Merkmal `data-spielt` — und
   * `spieltMarkieren()` sieht nur Elemente an, die es tragen
   * (`querySelectorAll('[data-spielt]')`). Gemeldet wurde das als „beim Wechsel
   * des Titels geht die Marke nicht mit"; in Wahrheit war sie NIE da.
   *
   * ZWEI SPERREN HINTEREINANDER, und keine davon war ein Versehen:
   *   1. `stueckKennung` braucht `t.uri` — die gibt es bei mpv-Quellen nicht
   *      (am Geraet nachgesehen, Box .169: ARD und Jellyfin fuehren `id`).
   *   2. `laufendeKennungen` setzt `sp` bei mpv-Ton absichtlich auf null, sonst
   *      tanzte die Marke an einem Spotify-Kapitel weiter, waehrend ein
   *      Hoerbuch laeuft.
   * Erst die dritte Kennungsform (`folge|<schluessel>|<id>`) laesst beide
   * zugleich fallen.
   *
   * WARUM DIE PRUEFUNG NICHT BEI „traegt ein Merkmal" AUFHOERT: Ein Merkmal,
   * das nie trifft, sieht am Schirm genauso aus wie gar keins. Geprueft wird
   * deshalb die WIRKUNG (`.spielt` samt eingehaengtem `.spielt-marke`) und dass
   * sie beim Weiterruecken von mpv MITGEHT — auf die NAECHSTE Kachel, nicht
   * irgendeine.
   */
  test('die Marke sitzt bei einer ARD-Folge auf der Kachel — und geht beim Wechsel mit', async () => {
    await zustand('voll')
    await zustand('spielt')
    await zustand('mpv-eigen')
    await zustand('mpv-erste')
    await neuLaden()

    // ERST STARTEN (der Play-Knopf legt `laufendeFolgen` an), DANN AUFKLAPPEN.
    // Andersherum kennt die Seite die Liste noch nicht, gegen die mpv zaehlt —
    // und die Marke koennte gar nicht sitzen, ohne dass etwas kaputt waere.
    await warteAuf(`document.getElementById('raster').children.length > 0`, 'das Raster hat Kacheln')
    const getippt = await ev(
      `(() => {
        const k = [...document.querySelectorAll('#raster .kachel')]
          .find((x) => (x.getAttribute('aria-label') || '').includes('MausHörspiel'))
        if (!k) return 'keine Kachel'
        const s = k.querySelector('.tipp-spiel')
        if (!s) return 'kein Play-Knopf'
        s.click()
        return 'ok'
      })()`,
    )
    assert.equal(getippt, 'ok', `die ARD-Kachel liess sich nicht starten: ${getippt}`)
    await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')

    // JETZT DIE FOLGEN-LANE AUFKLAPPEN — ein Tipp auf die Kachel selbst.
    const auf = await ev(
      `(() => {
        const k = [...document.querySelectorAll('#raster .kachel')]
          .find((x) => (x.getAttribute('aria-label') || '').includes('MausHörspiel'))
        if (!k) return 'keine Kachel'
        k.click()
        return 'ok'
      })()`,
    )
    assert.equal(auf, 'ok', `die ARD-Kachel liess sich nicht aufklappen: ${auf}`)
    await warteAuf(`document.querySelectorAll('.lane-kachel.stueck').length > 0`, 'die Folgen-Lane steht')

    // DAS MERKMAL ZUERST. Ohne es waere ein fehlendes `.spielt` unten kein
    // Vergleichsfehler, sondern ein fehlender Traeger — zwei Befunde, die
    // gleich aussehen und verschiedene Reparaturen haetten.
    const mitMerkmal = await ev(
      `[...document.querySelectorAll('.lane-kachel.stueck')].filter((k) => k.dataset.spielt).length`,
    )
    assert.ok(
      mitMerkmal > 0,
      `keine einzige Folgenkachel traegt data-spielt — die Marke kann hier gar nicht sitzen`,
    )

    // UEBER DEN PLATZ IN DER REIHE, NICHT UEBER DEN NAMEN. Die Folgennamen der
    // Attrappe wiederholen sich (`ardFolgenTitel` zaehlt zyklisch), und in der
    // Lane stehen zwei Kacheln „Der Schneemann taut" — am Bild gesehen. Ein
    // Vergleich ueber den Text traefe die erste davon und meldete einen Sprung
    // um fuenf Plaetze, wo die Marke eine Kachel weitergerueckt ist.
    const platz = `(() => {
      const alle = [...document.querySelectorAll('.lane-kachel.stueck')]
      const i = alle.findIndex((k) => k.classList.contains('spielt'))
      return { i, wieViele: alle.filter((k) => k.classList.contains('spielt')).length,
               titel: i < 0 ? '' : (alle[i].querySelector('.lane-titel') || {}).textContent || '' }
    })()`
    await warteAuf(`${platz}.wieViele === 1`, 'genau EINE Folgenkachel ist markiert')
    // DIE MARKE IST DAS ZEICHEN, NICHT NUR DIE KLASSE. Beide werden getrennt
    // gesetzt (`spieltMarkieren`); nur eines zu pruefen uebersaehe den Fall,
    // in dem sie auseinanderlaufen.
    await warteAuf(
      `!!document.querySelector('.lane-kachel.stueck.spielt .spielt-marke')`,
      'die markierte Kachel traegt auch das Zeichen',
    )
    const vorher = await ev(platz)

    // JETZT RUECKT mpv VON SELBST WEITER — kein Befehl von dieser Seite.
    await zustand('mpv-weiter')
    // UM GENAU EINE KACHEL. Ein Sprung um zwei Plaetze waere derselbe
    // Fehlgriff wie ein Cover, das die Nachbarfolge zeigt — er sieht richtig
    // aus. Deshalb steht die Zahl in der Bedingung und nicht erst danach.
    await warteAuf(
      `${platz}.wieViele === 1 && ${platz}.i === ${vorher.i + 1}`,
      `die Marke stand auf Platz ${vorher.i} („${vorher.titel}") und ist nicht auf ${vorher.i + 1} gerueckt`,
    )

    // ══ UND SIE LAESST WIEDER LOS ══════════════════════════════════════════
    // Wirft jemand vom Telefon oder aus der klassischen Oberflaeche etwas
    // ANDERES an, ersetzt mpv die Warteschlange. `currentTracknr` zaehlt dann
    // in der NEUEN Liste — nachgeschlagen wuerde in der alten, und die Marke
    // behauptete „diese Folge laeuft gerade" ueber eine, die schweigt. Der
    // Schluesselvergleich allein kann das NICHT abfangen: beide Seiten stammen
    // aus derselben Zuweisung in `albumSpielen` (llmwiki
    // vergleich-aus-derselben-zuweisung). Nur `passtZuLaufendem` kann hier
    // nein sagen, und ohne diese Zeilen bewachte niemand sie.
    await zustand('mpv-fremd')
    await warteAuf(
      `document.querySelectorAll('.lane-kachel.stueck.spielt').length === 0`,
      'die Marke klebt an der alten Folgenliste, obwohl etwas Fremdes laeuft',
    )

    // AUFRAEUMEN: der Hebel bleibt sonst fuer den naechsten Fall umgelegt.
    await zustand('mpv-eigen')
  })

  /**
   * ══ BACKLOG F2, ZWEITER TEIL: MAN MUSS SIE AUCH SEHEN ═════════════════════
   *
   * `.lane-reihe` rollt waagerecht (zehn Titel sind 1082 px breit, sichtbar
   * sind 608). `laneInsBild()` holt die Lane SENKRECHT ins Bild; die
   * waagerechte Rollposition ruehrte bis zum 05.08.2026 kein Weg an. Ab Titel 7
   * von 10 stand die markierte Kachel also draussen — die Marke wanderte
   * voellig richtig von einer unsichtbaren Kachel zur naechsten.
   *
   * DIESER FALL IST DIE GEGENPROBE ZUM VORIGEN: dort wandert sie im BAUM, hier
   * steht sie im BILD. Beides zusammen ist die Meldung des Benutzers; eines
   * allein hat sie zweimal fuer erledigt erklaeren lassen.
   *
   * 800x480 WIRD AUSDRUECKLICH GESTELLT und danach zurueckgenommen. Ohne das
   * misst der Fall gegen das Sichtfenster, das headless gerade hergibt (800x337
   * ist gemessen) — und auf einem breiten Schirm rollt gar nichts, der Fall
   * waere gruen, ohne etwas geprueft zu haben. Genau deshalb steht unten auch
   * die Vorbedingung „die Reihe rollt ueberhaupt".
   */
  test('die markierte Kachel wird beim Aufklappen ins Bild gerollt', async () => {
    await senden('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 480,
      deviceScaleFactor: 1,
      mobile: false,
    })
    try {
      await zustand('voll')
      await zustand('spielt')
      await zustand('mpv-eigen')
      await zustand('mpv-erste')
      await neuLaden()

      await warteAuf(`document.getElementById('raster').children.length > 0`, 'das Raster hat Kacheln')
      const getippt = await ev(
        `(() => {
          const k = [...document.querySelectorAll('#raster .kachel')]
            .find((x) => (x.getAttribute('aria-label') || '').includes('MausHörspiel'))
          if (!k) return 'keine Kachel'
          const s = k.querySelector('.tipp-spiel')
          if (!s) return 'kein Play-Knopf'
          s.click()
          return 'ok'
        })()`,
      )
      assert.equal(getippt, 'ok', `die ARD-Kachel liess sich nicht starten: ${getippt}`)
      await warteAuf(`!document.getElementById('mp').hidden`, 'der Mini-Player ist sichtbar')

      // WEIT NACH HINTEN, damit der Fall ueberhaupt scharf ist. Bei Folge 1
      // stuende die Kachel ohnehin links — ein Nachrollen waere dann nicht zu
      // unterscheiden von gar keinem.
      for (let i = 0; i < 6; i++) await zustand('mpv-weiter')
      await schlafen(2200)

      const auf = await ev(
        `(() => {
          const k = [...document.querySelectorAll('#raster .kachel')]
            .find((x) => (x.getAttribute('aria-label') || '').includes('MausHörspiel'))
          if (!k) return 'keine Kachel'
          k.click()
          return 'ok'
        })()`,
      )
      assert.equal(auf, 'ok', `die ARD-Kachel liess sich nicht aufklappen: ${auf}`)
      await warteAuf(`!!document.querySelector('.lane-kachel.stueck.spielt')`, 'eine Folgenkachel ist markiert')

      // DIE VORBEDINGUNG IST TEIL DER PRUEFUNG. Rollte die Reihe gar nicht,
      // waere „die Kachel steht im Bild" wahr, ohne dass irgendetwas geleistet
      // wurde — der leere Durchlauf, gegen den dieses Werkzeug gebaut ist.
      const rollt = await ev(
        `(() => { const r = document.querySelector('.lane .lane-reihe')
          return r ? r.scrollWidth > r.clientWidth + 8 : false })()`,
      )
      assert.equal(rollt, true, 'die Titelreihe rollt gar nicht — dieser Fall prueft dann nichts')

      // Das Rollen laeuft weich (`behavior: 'smooth'`); gewartet wird auf das
      // ERGEBNIS, nicht auf eine Zeitspanne.
      const drin = `(() => {
        const k = document.querySelector('.lane-kachel.stueck.spielt')
        const r = k && k.closest('.lane-reihe')
        if (!k || !r) return false
        const kr = k.getBoundingClientRect(), rr = r.getBoundingClientRect()
        return kr.left >= rr.left - 1 && kr.right <= rr.right + 1
      })()`
      await warteAuf(drin, 'die markierte Folgenkachel steht nicht ganz in der sichtbaren Reihe')

      // UND DAS ZEICHEN SELBST STEHT IM SCHIRM. Die Kachel kann in der Reihe
      // stehen und ihr Zeichen trotzdem ueber dem Rand des Schirms liegen —
      // genau das ist bei der Albumreihe der Fall.
      //
      // GEWARTET, NICHT EINMAL ABGELESEN, und das war ein echter Fehlschlag:
      // Der erste Lauf las die Lage sofort und bekam y=498 auf einem 480 hohen
      // Schirm — mitten in der WEICHEN Bewegung von `laneInsBild()`, die die
      // Lane erst noch heraufholte. Ein Augenblicksbild waehrend einer
      // Bewegung ist kein Befund.
      await warteAuf(
        `(() => {
          const m = document.querySelector('.lane-kachel.stueck.spielt .spielt-marke')
          if (!m) return false
          const r = m.getBoundingClientRect()
          return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
        })()`,
        'das Zeichen der Marke steht nicht im Bild',
      )
    } finally {
      // ZURUECKLEGEN, WAS GEBORGT WURDE — sonst messen alle folgenden Faelle
      // auf 800x480, ohne es zu wissen.
      await senden('Emulation.clearDeviceMetricsOverride')
    }
  })
})

// ══ F6: ZWEI KNOEPFE, GLEICHE HOEHE ════════════════════════════════════════
//
// DIE LUECKE: Bis zum 06.08.2026 gab es EINEN Knopf, der nur die Farbe
// wechselte. Lag zu einem Album eine gemerkte Stelle vor, war er blau und
// setzte fort — und dann fuehrte KEIN Weg mehr zum Anfang desselben Albums.
//
// WARUM DIE KNOEPFE NICHT AUFS COVER GEHOEREN, steht als Rechnung im
// Stilblatt und ist mit tools/beruehrziele-neu.mjs gemessen: 9 mm sind 64 px,
// zwei davon 128 px plus Abstand — die Album-Kachel ist 118 px breit, die
// Titelkachel 96 px. Hier wird geprueft, was daraus gebaut wurde.
describe('F6 — Weiterhoeren ODER von vorne', { skip: BROWSER ? false : 'kein Browser gefunden' }, () => {
  /**
   * Die Titel-Lane des Albums oeffnen, zu dem es eine gemerkte Stelle gibt.
   *
   * NICHT „die erste Kachel": Die Attrappe haengt die Stelle an GENAU EIN
   * Album (tools/neu-vorschau.mjs, `abAlbum` — Versatz 3 liegt im ersten
   * Album des Werks mit der gemerkten Stelle). Wer irgendeine Kachel oeffnet,
   * findet keine Wahlleiste und haelt das fuer ein Ergebnis.
   */
  async function tiefeLaneMitStelle() {
    await zustand('voll')
    await neuLaden()
    await warteAuf(`document.getElementById('raster').children.length > 0`, 'das Raster steht')
    // DURCH ALLE EBENEN SUCHEN, bis eine ALBUM-Kachel mit blauem Knopf
    // dasteht. Drei Fallen liegen hier, jede beim ersten Lauf bezahlt:
    //
    //   * DAS WERK STECKT IN EINEM REGAL. „Bibi Blocksberg" — das einzige
    //     Werk der Attrappe mit einer Stelle auf ALBUM-Ebene — steht nicht im
    //     Raster, sondern hinter der Regal-Kachel „Kiddinx" (zwei Werke
    //     desselben Interpreten fassen sich zusammen).
    //   * EIN REGAL OEFFNET KEINE LANE, es TAUSCHT DAS RASTER aus
    //     (`regalOffen` filtert die Liste). Wer danach mit den alten Knoten
    //     weiterarbeitet, greift ins Leere — nach jedem Regal wird deshalb neu
    //     abgefragt.
    //   * `.lane-kachel` IST NICHT GLEICH ALBUM. Die Folgen einer ARD-Sendung
    //     tragen dieselbe Klasse mit dem Zusatz `.stueck`, und eine von ihnen
    //     hat ebenfalls einen blauen Knopf. Der erste Lauf hat genau die
    //     erwischt und dann auf eine Titel-Lane gewartet, die es zu einer
    //     Folge gar nicht gibt.
    const gefunden = await ev(`(async () => {
      const warte = (ms) => new Promise(r => setTimeout(r, ms))
      const ALBEN = '.lane .lane-kachel:not(.stueck)'
      const blauesAlbum = () => document.querySelector(ALBEN + ' .tipp-spiel.weiter')
      const warteAufLane = async () => {
        for (let n = 0; n < 20; n++) {
          await warte(150)
          if (blauesAlbum()) return 'blau'
          if (document.querySelector(ALBEN)) return 'da'
        }
        return 'nichts'
      }
      // Alle aufklappbaren Werke des GERADE sichtbaren Rasters durchgehen.
      const imRaster = async () => {
        const k = [...document.querySelectorAll('#raster .kachel')].filter(x => x.querySelector('.tipp-spiel'))
        for (const kachel of k) {
          kachel.click()
          const stand = await warteAufLane()
          if (stand === 'blau') return true
          kachel.click()
          await warte(150)
        }
        return false
      }
      if (await imRaster()) { blauesAlbum().closest('.lane-kachel').click(); return true }
      const wieViele = document.querySelectorAll('#raster .kachel.regal').length
      for (let i = 0; i < wieViele; i++) {
        const regal = document.querySelectorAll('#raster .kachel.regal')[i]
        if (!regal) continue
        regal.click()
        await warte(500)
        if (await imRaster()) { blauesAlbum().closest('.lane-kachel').click(); return true }
        const zu = document.getElementById('zurueck')
        if (zu) zu.click()
        await warte(500)
      }
      return false })()`)
    assert.equal(gefunden, true, 'kein Album mit gemerkter Stelle gefunden — traegt die Attrappe noch ein weiterAb?')
    await warteAuf(`!!document.querySelector('.lane-tief .lane-wahl')`, 'die Wahlleiste steht in der Titel-Lane')
  }

  test('zeigt zwei Knoepfe — und beide auf GLEICHER HOEHE', async () => {
    await tiefeLaneMitStelle()
    const mass = await ev(`(() => {
      const l = document.querySelector('.lane-tief .lane-wahl')
      const k = [...l.querySelectorAll('button')]
      const r = k.map(x => x.getBoundingClientRect())
      return {
        anzahl: k.length,
        oben: r.map(x => Math.round(x.top)),
        hoehen: r.map(x => Math.round(x.height)),
        breiten: r.map(x => Math.round(x.width)),
        // Der Abstand zwischen beiden — zwei Knoepfe, die GEGENSAETZLICHES
        // tun, duerfen sich nicht beruehren.
        luecke: r.length === 2 ? Math.round(r[1].left - r[0].right) : -1,
        // DIE MARKE WIRD AUS DER SEITE GELESEN, NICHT ABGESCHRIEBEN. Hier
        // stand sie als nackte 64 im Pruefsatz („die Marke sind 64 px"), und
        // am 05.08.2026 ist sie im Stilblatt auf 66 gestiegen — der Fall blieb
        // gruen und hielt eine Zahl fest, die nicht mehr galt. Dieselbe Lehre
        // wie in tools/rueckweg-schau.mjs: eine zweite Fassung derselben Zahl
        // laeuft irgendwann auseinander, und die Pruefung merkt es als Letzte.
        marke: Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--griff'))) || 0,
      } })()`)
    assert.equal(mass.anzahl, 2, `es sind nicht zwei Knoepfe: ${JSON.stringify(mass)}`)
    // DER AUSDRUECKLICHE WUNSCH — „wichtig die knoepfe muessen auf gleicher
    // hoehe sein". Gemessen an der Oberkante im Bild, nicht am Stilblatt.
    assert.equal(mass.oben[0], mass.oben[1], `die Knoepfe stehen nicht auf gleicher Hoehe: ${JSON.stringify(mass.oben)}`)
    assert.equal(mass.hoehen[0], mass.hoehen[1], `die Knoepfe sind verschieden hoch: ${JSON.stringify(mass.hoehen)}`)
    // HIER WIRD DIE MARKE GEHALTEN — anders als beim 44-px-Knopf auf dem
    // Cover, und genau deswegen sitzt die Leiste dort, wo Platz ist. Die Marke
    // ist `--griff` aus dem Stilblatt (9 mm nach ISO 9241-411, seit dem
    // 05.08.2026 66 px); dass sie ueberhaupt dasteht, wird mitgeprueft — sonst
    // waere ein Tippfehler im Variablennamen eine stumme Null und jeder Knopf
    // gross genug.
    assert.ok(mass.marke >= 44, `--griff kam nicht aus der Seite (gelesen: ${mass.marke})`)
    for (const h of mass.hoehen) assert.ok(h >= mass.marke, `Knopf nur ${h} px hoch, die Marke sind ${mass.marke} px`)
    for (const b of mass.breiten) assert.ok(b >= mass.marke, `Knopf nur ${b} px breit, die Marke sind ${mass.marke} px`)
    assert.ok(mass.luecke >= 12, `die Knoepfe stehen nur ${mass.luecke} px auseinander`)
  })

  test('„VON VORNE" schickt den Anfang — nicht die gemerkte Stelle', async () => {
    // DIE NAHT, AN DER ALLES HAENGT. Ein Knopf mit der richtigen Aufschrift,
    // der `albumSpielenAusLane` ohne den Schalter ruft, findet die gemerkte
    // Stelle und spielt doch wieder dort weiter. Er saehe richtig aus und
    // taete das Gegenteil — sichtbar erst an der Box, und auch dort erst,
    // wenn jemand genau hinhoert.
    //
    // SEIT E95/V STUFE 2 (31.08.2026) STEHT DIE NAHT IM WUNSCH-RUMPF, nicht
    // mehr in einer Befehls-URL: beide Knoepfe schicken EINEN
    // `POST /api/spielen`, und der Unterschied ist, OB die gemerkte Stelle
    // (positionMs) mitreist. Hier stand ein URL-Filter auf `/player/…` — der
    // sah `/api/spielen` in seiner Mitschrift und erkannte es nicht als
    // Abspielbefehl. Geprueft wird deshalb der RUMPF. Was der Server aus dem
    // Wunsch macht (Quelle, Plattform-Befehl, Sprung), prueft
    // src/backend-api/src/spielen.integration.spec.ts.
    await tiefeLaneMitStelle()

    const stelle = await ev(`(() => {
      const l = document.querySelector('.lane-tief .lane-wahl')
      return { weiter: !!l.querySelector('.wahl-weiter'), vorn: !!l.querySelector('.wahl-vorn') } })()`)
    assert.deepEqual(stelle, { weiter: true, vorn: true }, 'die beiden Knoepfe sind nicht zu unterscheiden')

    // KEIN /player-BEFEHL DANEBEN — die Negativ-Haelfte der Umstellung: ein
    // stop oder Startbefehl aus der Seite waere jetzt ein Doppelweg-Fehler
    // (die Seite hielte an, der Server noch einmal). Die Abfragen
    // /player/local und /player/state POLLT die Seite weiterhin — ein Befehl
    // ist nur, was ZWEI Glieder hinter /player/ traegt.
    const alteLeitung = () =>
      anfragen.filter((u) => /\/player\/[^/?#]+\/.+/.test(String(u))).map((u) => new URL(u).pathname)

    anfragen = []
    wuensche = []
    await ev(`(document.querySelector('.lane-tief .wahl-vorn').click(), true)`)
    await schlafen(900)
    const vonVorn = wuensche
    assert.equal(
      vonVorn.length,
      1,
      `„Von vorne" muss GENAU EINEN Spielwunsch schicken (gesehen: ${vonVorn.length}). Anfragen: ${JSON.stringify(anfragen)}`,
    )
    assert.deepEqual(alteLeitung(), [], '„Von vorne" schickt daneben noch selbstgebaute /player-Befehle (Doppelweg)')
    assert.ok(vonVorn[0] && vonVorn[0].schluessel, `der Wunsch traegt keinen Schluessel: ${JSON.stringify(vonVorn[0])}`)
    // DER ANFANG heisst: eine Titelnummer (fuer das erste Album der Attrappe
    // die 1, allgemein `ersterVersatz + 1`) und KEINE gemerkte Stelle. Ein
    // positionMs hier waere exakt der Fehler, gegen den F6 gebaut ist.
    assert.ok(
      Number.isInteger(vonVorn[0].titelNr) && vonVorn[0].titelNr >= 1,
      `„Von vorne" nennt keinen Titelanfang: ${JSON.stringify(vonVorn[0])}`,
    )
    assert.equal(
      vonVorn[0].positionMs,
      undefined,
      `„Von vorne" schleppt die gemerkte Stelle mit: ${JSON.stringify(vonVorn[0])}`,
    )
    assert.equal(
      vonVorn[0].positionProzent,
      undefined,
      `„Von vorne" schleppt eine Prozent-Stelle mit: ${JSON.stringify(vonVorn[0])}`,
    )

    anfragen = []
    wuensche = []
    await ev(`(document.querySelector('.lane-tief .wahl-weiter').click(), true)`)
    await schlafen(900)
    const weiter = wuensche
    assert.equal(
      weiter.length,
      1,
      `„Weiterhören" muss GENAU EINEN Spielwunsch schicken (gesehen: ${weiter.length}). Anfragen: ${JSON.stringify(anfragen)}`,
    )
    assert.deepEqual(alteLeitung(), [], '„Weiterhören" schickt daneben noch selbstgebaute /player-Befehle (Doppelweg)')
    // DIE GEMERKTE STELLE reist mit: Titelnummer UND Millisekunden. Die
    // ZAHLEN selbst werden nicht abgeschrieben (sie gehoeren der Attrappe und
    // aendern sich mit ihr) — dass eine Stelle da ist, ist die Aussage.
    assert.ok(
      Number.isInteger(weiter[0] && weiter[0].titelNr) && weiter[0].titelNr >= 1,
      `„Weiterhören" nennt keine Titelnummer: ${JSON.stringify(weiter[0])}`,
    )
    assert.ok(
      Number.isFinite(weiter[0].positionMs) && weiter[0].positionMs > 0,
      `„Weiterhören" traegt keine gemerkte Stelle (positionMs): ${JSON.stringify(weiter[0])}`,
    )
    assert.equal(weiter[0].schluessel, vonVorn[0].schluessel, 'die beiden Knoepfe meinen nicht dasselbe Werk')

    // DER EIGENTLICHE BEWEIS: die beiden Wuensche sind VERSCHIEDEN. Ein
    // Vergleich gegen erwartete Zahlen waere zerbrechlich (sie haengen an
    // Versatz und Millisekunden der Attrappe); dass sie sich unterscheiden
    // MUESSEN, ist dagegen genau die Aussage von F6.
    assert.notEqual(
      JSON.stringify(vonVorn[0]),
      JSON.stringify(weiter[0]),
      `„Von vorne" und „Weiterhören" schicken denselben Wunsch — der Schalter greift nicht:\n  ${JSON.stringify(vonVorn[0])}`,
    )
  })
})

/**
 * DIE ZWEITE SICHERUNG — und die einzige, die auch OHNE Browser laeuft.
 *
 * Der Test darueber prueft das Ergebnis: alle Orte zeigen dasselbe. Er kann
 * aber nicht verhindern, dass jemand die naechste Anzeige wieder von Hand
 * verdrahtet — solange sie zufaellig stimmt, bleibt er gruen. Genau so ist das
 * Cover-Vollbild entstanden.
 *
 * DIE REGEL IST DESHALB STRENGER ALS DAS VERHALTEN: Wer in `index.html` ein
 * `data-np` traegt, wird VOM ZENTRALEN MALER bedient. Dessen Kennung braucht
 * app.js dann nirgends mehr — er findet sie ueber das Merkmal. Steht eine
 * dieser Kennungen doch in app.js, ist das der Anfang der naechsten zweiten
 * Wahrheit, und dieser Test sagt es, bevor sie auseinanderlaeuft.
 */
describe('Anzeigeorte haben nur EINEN Schreiber', () => {
  test('keine Kennung eines data-np-Elements steht in app.js', () => {
    const html = readFileSync(join(WURZEL, 'NewDesign/index.html'), 'utf8')
    const js = readFileSync(join(WURZEL, 'NewDesign/app.js'), 'utf8')
    const kennungen = [...html.matchAll(/<[^>]*\bdata-np=[^>]*>/g)]
      .map((m) => (m[0].match(/\bid="([^"]+)"/) || [])[1])
      .filter(Boolean)
    // Gegen den leeren Durchlauf: die drei Orte haben zusammen elf Merkmale.
    assert.ok(
      kennungen.length >= 10,
      `zu wenige data-np-Elemente gefunden (${kennungen.length}) — sind die Merkmale noch im HTML?`,
    )
    const verstoesse = kennungen.filter((k) => js.includes(`'${k}'`) || js.includes(`"${k}"`))
    assert.deepEqual(
      verstoesse,
      [],
      `app.js greift diese Anzeige-Elemente einzeln an, statt sie ueber data-np malen zu lassen: ${verstoesse.join(', ')}`,
    )
  })
})

// ── Die Buehne als Songtext-Anzeige (E129 + E84/B2) ────────────────────────
//
// ZWEI FEHLER STANDEN HIER, und beide waren STILL: ihr Symptom war eine leere
// Buehne — also genau das, was auch „zu diesem Titel gibt es keinen Text"
// bedeutet, und das ist auf einer Kinderbox der haeufigste Fall. Ein Fehler,
// dessen Symptom der Normalfall ist, faellt ohne Zeugen nie auf.
describe('Buehne: Songtext', () => {
  /** Wartet NODE-seitig auf eine Anfrage — `warteAuf` lebt im Browser. */
  async function warteAufAnfrage(teil, frist = FRIST_MS) {
    const bis = Date.now() + frist
    while (Date.now() < bis) {
      const treffer = anfragen.filter((a) => a.includes(teil))
      if (treffer.length) return treffer
      await schlafen(100)
    }
    return []
  }

  test('fragt mit dem INTERPRETEN, nicht mit der Unterzeile', async () => {
    // DER ERSTE FEHLER: gefragt wurde mit `np.unter`. Die traegt bei lokaler
    // Wiedergabe das ALBUM — dazu findet keine Quelle etwas, und die Buehne
    // blieb leer. Bei Spotify ist `unter` zufaellig der Interpret; dort faellt
    // es nicht auf, und genau das machte den Fehler langlebig.
    // `lied` ist der einzige lokale Zustand, in dem Interpret und Album
    // VERSCHIEDEN sind ("Rolf Zuckowski" vs. "Bewegungshits"). Mit jedem
    // anderen waere dieser Test gruen, ohne etwas zu zeigen — beide Wege
    // lieferten dasselbe Wort.
    await zustand('buehne-songtext')
    await zustand('lied')
    await neuLaden()
    const gefragt = await warteAufAnfrage('/api/songtext')
    assert.ok(gefragt.length > 0, `keine Songtext-Anfrage gestellt (${anfragen.length} Anfragen)`)
    const frage = decodeURIComponent(gefragt[0])
    assert.match(frage, /interpret=Rolf Zuckowski(&|$)/, `nicht der Interpret: ${frage}`)
    assert.doesNotMatch(frage, /interpret=Bewegungshits/, `das ALBUM statt des Interpreten: ${frage}`)
    assert.match(frage, /dauerSek=150(&|$)/, `die Dauer fehlt oder stimmt nicht: ${frage}`)
  })

  test('zeigt unsynchronen Text — er kommt als `absaetze`, nicht als `zeilen`', async () => {
    // DER ZWEITE FEHLER: gelesen wurde nur `a.zeilen`. Unsynchrone Texte
    // liefert die Route als `absaetze` — getrennt, damit niemand etwas
    // mitlaufen laesst, was keine Zeitmarken hat. Sie kamen also nie an.
    await zustand('buehne-songtext')
    await zustand('songtext-unsynchron')
    await zustand('spielt')
    await neuLaden()
    await warteAufAnfrage('/api/songtext')
    await warteAuf(
      `((document.getElementById('gr-buehne-text')||{}).textContent||'').includes('ohne Marke')`,
      'die Buehne zeigt den unsynchronen Text',
    )
  })

  test('bleibt leer, wenn es keinen Text gibt — ohne Fehlermeldung', async () => {
    // Der haeufigste Fall auf einer Kinderbox (Hoerspiele: 0 von 5 in der
    // Messung). Ein Kind soll dann NICHTS sehen, nicht „nicht gefunden".
    await zustand('buehne-songtext')
    await zustand('songtext-leer')
    await zustand('spielt')
    await neuLaden()
    await warteAufAnfrage('/api/songtext')
    await schlafen(300)
    const inhalt = await ev(`((document.getElementById('gr-buehne-text')||{}).textContent||'').trim()`)
    assert.equal(inhalt, '', `die Buehne zeigt etwas, obwohl es keinen Text gibt: ${JSON.stringify(inhalt)}`)
  })
})
