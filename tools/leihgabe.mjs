#!/usr/bin/env node
/**
 * WAS MAN SICH BORGT, LEGT MAN ZURUECK — die geliehene Vorschau und der
 * eigene Browser, fuer alle Messwerkzeuge an EINER Stelle.
 *
 * ══ WOFUER ═════════════════════════════════════════════════════════════════
 *
 * Neunzehn Werkzeuge in tools/ messen gegen tools/neu-vorschau.mjs, und jedes
 * trug bis zum 04.08.2026 dieselben zwei Bloecke abgeschrieben in sich: „eine
 * schon laufende Vorschau wird NICHT angefasst" und „einen headless-Browser
 * auf Port 93xy starten". Beide Bloecke waren falsch, und zwar auf eine Art,
 * die sich nicht als Fehler meldet, sondern als FALSCHES MESSERGEBNIS.
 *
 * ── 1. DIE GELIEHENE LAGE BLIEB STEHEN ────────────────────────────────────
 *
 * Wer sich die Vorschau leiht, stellt darin Lagen (`/vorschau/sperre-pin`,
 * `/vorschau/marke-ruhig`, …) und geht nach der letzten heim. Die naechsten
 * Werkzeuge messen dann gegen eine Vorschau, die jemand anders verstellt hat.
 *
 * GEMESSEN, NICHT BEFUERCHTET (04.08.2026): tools/marke-tanzt.mjs laeuft seine
 * zwei Faelle in der Reihenfolge `marke-bewegt`, `marke-ruhig` durch. Danach
 * stand die Vorschau auf `marke-ruhig` — also auf „Bewegung abgeschaltet".
 * tools/raster-marke-schau.mjs misst genau diese Bewegung und meldete prompt
 * ZWEI Fehler, die es nicht gab. Am selben Tag stand eine verwaiste Vorschau
 * zwei Stunden lang auf `einstellungssperre: pin`, obwohl die Vorgabe `aus`
 * ist: Der Eltern-Bereich verlangte dort eine PIN, die niemand gestellt hatte.
 *
 * DIE KLEBRIGEN FELDER sind die, die keine Messung nebenbei zuruecksetzt:
 * `sperre-`, `kontext-`, `verschmolzen-`, `doppelt-`, `disko-`, `frei-`,
 * `nein-`, `alben-`, `verlauf-`, `vorlesen-`, `schlummer-`, `marke-`.
 *
 * ── 2. DER FESTE DEBUG-PORT WAR NICHT EINDEUTIG ───────────────────────────
 *
 * `grep -h "const port = 9" tools/*.mjs | sort | uniq -c` zaehlte am
 * 04.08.2026: 9361 in vier Werkzeugen, 9351 in vier, 9357 in drei, 9347 in
 * drei. Ein fester Port ist doppelt gefaehrlich, und der zweite Teil ist der
 * schlimme:
 *
 *   * Ein Browser, der einen harten Abbruch ueberlebt hat, HAELT den Port.
 *   * Der eigene Browser bindet ihn deshalb NICHT — und sagt darueber nichts.
 *   * `/json/list` antwortet trotzdem klaglos, mit den Zielen des FREMDEN
 *     Browsers. Das Werkzeug spricht also mit einer Seite, die es nie geoeffnet
 *     hat, navigiert sie und wartet auf Zustaende, die dort nie eintreten.
 *
 * Gemessen: ein Lauf, der 40 Sekunden dauert, brauchte so ueber acht Minuten
 * und meldete am Ende Fehler ueber eine Seite, die niemand gemessen hatte.
 *
 * ══ DIE ANTWORT ════════════════════════════════════════════════════════════
 *
 *   * `freierPort()` fragt das Betriebssystem nach einem freien Port, statt
 *     einen zu raten.
 *   * Jeder Browser bekommt sein EIGENES `--user-data-dir` in einem
 *     mkdtemp-Verzeichnis. Ohne das teilen sich zwei gleichzeitige Laeufe ein
 *     Profil, und der zweite Chromium haengt sich an den ersten an, statt
 *     selbst hochzukommen.
 *   * Der wirklich benutzte Port kommt vom BROWSER SELBST — aus seiner Zeile
 *     „DevTools listening on ws://…" auf dem eigenen Fehlerkanal, hilfsweise
 *     aus `DevToolsActivePort` im eigenen Profil. Beide tragen auch die
 *     KENNUNG des Browsers, und die wird gegen `/json/version` gehalten. Damit
 *     ist „ich rede mit einem fremden Browser" nicht unwahrscheinlich, sondern
 *     nachweislich ausgeschlossen — statt „ich habe mir einen Port gewuenscht
 *     und hoffe, dass ich ihn bekommen habe".
 *   * Beim Aufraeumen wird ERST auf das Ende des Browsers gewartet, DANN
 *     geloescht. Andersherum loescht man einem laufenden Chromium sein Profil
 *     unter den Fuessen weg; er schreibt es beim Beenden noch einmal an, und
 *     zurueck bleibt genau der Muell, den das mkdtemp vermeiden sollte.
 *
 * ══ SO WIRD ES BENUTZT ═════════════════════════════════════════════════════
 *
 *     import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'
 *
 *     const leihe = await vorschauLeihen(ZIEL)
 *     const brw = await eigenerBrowser()          // null == kein Browser da
 *     try {
 *       …messen, Lagen stellen, was man will…
 *     } finally {
 *       await brw?.schliessen()
 *       await leihe.zurueckgeben()
 *     }
 *
 * DAS `finally` IST DER GANZE PUNKT. Ein Werkzeug, das nur auf dem gruenen Weg
 * aufraeumt, laesst gerade dann eine verstellte Vorschau stehen, wenn es einen
 * Fehler gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
 *
 * ══ WAS DAS HIER NICHT KANN ════════════════════════════════════════════════
 *
 * ZWEI WERKZEUGE, DIE LAGEN STELLEN, DUERFEN TROTZDEM NICHT GLEICHZEITIG
 * LAUFEN. Der freie Port trennt die BROWSER — sechs nebeneinander bekommen
 * sechs Ports, sechs Profile und sechs Seiten, nachgemessen am 04.08.2026.
 * Die VORSCHAU teilen sie sich weiterhin, und die hat nur EINE `lage`.
 *
 * Ebenfalls gemessen, damit es nicht bei einer Vermutung bleibt: marke-tanzt,
 * lane-marken-schau und raster-marke-schau gleichzeitig gestartet — alle drei
 * meldeten Abweichungen, und zwar KEINE einzige aus dem Browser (kein
 * ECONNREFUSED, kein fremdes Ziel), sondern durchweg Messwerte, die einander
 * widersprachen: Der eine stellte `marke-ruhig`, waehrend der andere die
 * Bewegung mass.
 *
 * Wer parallelisieren will, braucht deshalb je Werkzeug eine EIGENE Vorschau
 * (`node tools/neu-vorschau.mjs --port <frei>` und die Adresse als Argument
 * mitgeben), nicht nur einen eigenen Browser. tools/pruefen.sh laeuft die
 * Schritte aus genau diesem Grund nacheinander.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

// ══ EINE STELLE FUER ALLE LEIHGABEN (19.09.2026) ═══════════════════════════
//
// WOZU: Es gibt hier ZWEI Sorten Leihgabe — einen eigenen Browser und eine
// fremde Vorschau. Der Signalweg kannte bis heute nur die erste. Was das
// kostete, ist gemessen: Ein abgebrochener Lauf liess die geteilte Vorschau
// auf Port 8299 im Zustand `liste=kaputt` stehen, und der naechste Nutzer
// bekam von `/api/werke` HTTP 500 mit dem nackten Rumpf `kaputt`. Fuenf rote
// Schritte im Haupt-Laeufer gingen darauf zurueck.
//
// WARUM EINE STELLE UND NICHT ZWEI HOERER: Zwei Signalgriffe, die beide
// `process.exit()` rufen, sind ein Wettlauf — der erste beendet den Prozess,
// waehrend der zweite noch zurueckgibt. Hier sammelt EIN Paar Hoerer alle
// offenen Leihgaben ein und wartet auf ALLE, bevor es aussteigt.
//
// UND DER GRUND, AUS DEM ES `abmelden` GIBT, BLEIBT GEWAHRT: `eigenerBrowser()`
// wird auch mehrfach gerufen (sechs nebeneinander im Nachmessen). Frueher hing
// je Aufruf ein Hoererpaar; ab dem elften warnte node ueber ein Leck, das
// keines war. Jetzt gibt es IMMER genau eines, und es wird abgemeldet, sobald
// die letzte Leihgabe zurueck ist.
//
// ES BLEIBT EIN REST: SIGKILL laesst sich nicht abfangen.
const offeneLeihgaben = new Set()
let signalHoerer = null

function signalwegSichern() {
  if (signalHoerer) return
  const beiSignal = (sig) => () => {
    // Erst leeren, dann zurueckgeben: kommt waehrenddessen ein zweites Signal,
    // soll es nicht dieselben Leihgaben noch einmal aufrollen.
    const alle = [...offeneLeihgaben]
    offeneLeihgaben.clear()
    Promise.allSettled(alle.map((f) => f())).finally(() =>
      process.exit(sig === 'SIGINT' ? 130 : 143),
    )
  }
  signalHoerer = { SIGINT: beiSignal('SIGINT'), SIGTERM: beiSignal('SIGTERM') }
  for (const [sig, h] of Object.entries(signalHoerer)) process.on(sig, h)
}

/** Meldet eine Leihgabe an; der Rueckgabewert meldet sie wieder ab. */
function leiheMerken(zurueck) {
  offeneLeihgaben.add(zurueck)
  signalwegSichern()
  return () => {
    offeneLeihgaben.delete(zurueck)
    if (offeneLeihgaben.size === 0 && signalHoerer) {
      for (const [sig, h] of Object.entries(signalHoerer)) process.off(sig, h)
      signalHoerer = null
    }
  }
}

/**
 * WO LIEGT EIN CHROMIUM? — Playwright zuerst, dann die des Systems.
 *
 * Gibt `null` zurueck, statt zu werfen: Ein Rechner ohne Browser ist kein
 * Fehler, sondern ein Grund, den Browserteil zu ueberspringen. Genau so steht
 * es in jedem der Werkzeuge, die diesen Block bisher abgeschrieben trugen.
 */
export function browserSuchen() {
  // Ausdruecklicher Wunsch schlaegt jede Suche — so kannten es die Werkzeuge,
  // die diesen Block frueher selbst trugen (MUPIBOX_BROWSER).
  if (process.env.MUPIBOX_BROWSER) return process.env.MUPIBOX_BROWSER
  const pw = join(homedir(), '.cache/ms-playwright')
  if (existsSync(pw)) {
    const gefunden = readdirSync(pw)
      .map((d) => join(pw, d, 'chrome-linux64/chrome'))
      .find(existsSync)
    if (gefunden) return gefunden
  }
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync) || null
}

/**
 * EINEN FREIEN PORT VOM BETRIEBSSYSTEM ERFRAGEN, statt einen zu raten.
 *
 * Port 0 heisst „such du einen aus"; der Kern vergibt dann einen, den in
 * diesem Augenblick niemand haelt. Zwischen dem Schliessen hier und dem Binden
 * durch Chromium liegt ein Wimpernschlag, in dem ihn theoretisch jemand
 * anders nehmen koennte — deshalb ist `freierPort()` auch nur die halbe
 * Antwort. Die andere Haelfte steht in `eigenerBrowser()`: dort sagt der
 * Browser SELBST, welchen Port er wirklich bekommen hat, und beweist mit
 * seiner Kennung, dass er der unsere ist.
 *
 * ASYNCHRON, und das ist keine Bequemlichkeit: `listen()` kehrt sofort zurueck,
 * die Adresse steht aber erst mit dem Ereignis `listening` fest. Der erste
 * Anlauf hier las sie direkt nach `listen()` und bekam `null` — also genau die
 * Sorte Fehler, die dieses Modul verhindern soll, nur eine Ebene tiefer.
 */
export function freierPort() {
  return new Promise((ok, no) => {
    const s = createServer()
    s.once('error', no)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => ok(port))
    })
  })
}

/**
 * EIN EIGENER headless-Browser: freier Port, eigenes Profil, sauberes Ende.
 *
 * @param {object} [opt]
 * @param {string} [opt.fenster]  `--window-size`, Vorgabe „800,480" (der Schirm der Box)
 * @param {string[]} [opt.zusatz] weitere Schalter fuer Chromium
 * @param {number} [opt.geduldMs] wie lange auf das Hochkommen gewartet wird
 * @returns {Promise<null|{port:number,kind:object,ziele:Function,seite:Function,schliessen:Function}>}
 *   `null`, wenn es auf diesem Rechner gar keinen Browser gibt.
 * @throws wenn ein Browser da ist, aber nicht hochkommt. LAUT SCHEITERN: ein
 *   stilles `null` waere hier nicht dasselbe — es liesse das Werkzeug „keine
 *   Abweichung" melden, ohne je gemessen zu haben.
 */
export async function eigenerBrowser({ fenster = '800,480', zusatz = [], geduldMs = 15000 } = {}) {
  const pfad = browserSuchen()
  if (!pfad) return null

  // EIGENES PROFIL. Zwei gleichzeitige Laeufe mit demselben `--user-data-dir`
  // enden damit, dass der zweite Chromium sich an den ersten anhaengt und
  // sofort wieder beendet — der Aufrufer sieht dann einen Browser, der „nicht
  // hochkam", waehrend in Wahrheit einer zu viel lief.
  const profil = mkdtempSync(join(tmpdir(), 'mupi-browser-'))
  const gewuenscht = await freierPort()
  const kind = spawn(
    pfad,
    [
      '--headless=new',
      `--remote-debugging-port=${gewuenscht}`,
      `--user-data-dir=${profil}`,
      '--no-sandbox',
      '--disable-gpu',
      `--window-size=${fenster}`,
      ...zusatz,
      'about:blank',
    ],
    // FEHLERKANAL OFFEN, statt `stdio: 'ignore'` wie bisher ueberall. Dort
    // steht die einzige Zeile, die uns der Browser ueber sich selbst sagt:
    // „DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<kennung>".
    // Sie ist der Eigentumsnachweis — siehe unten.
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )

  // DER FEHLERKANAL MUSS GELESEN WERDEN, auch wenn niemand hinsieht: eine
  // Pipe, die keiner leert, laeuft voll, und Chromium bleibt beim Schreiben
  // stehen. Genau so friert ein Lauf ein, ohne je einen Fehler zu melden.
  //
  // GESUCHT WIRD IM VORBEIFLIESSEN, NICHT IM PUFFER. Der erste Anlauf hob die
  // letzten 4000 Zeichen auf und suchte darin — und haette die eine Zeile, auf
  // die es ankommt, verloren, sobald Chromium genug Geschwaetz hinterherschickt
  // (es meldet ungefragt GPU-Warnungen und einen Registrierungsfehler von GCM).
  // Sie kommt frueh und genau einmal; wer sie nicht im Fluss festhaelt, hat sie
  // nicht mehr. `rest` traegt den angebrochenen Zeilenanfang zwischen zwei
  // Bloecken — sonst zerschnitte ein Blockende die Zeile mitten im Port.
  let gemeldet = ''
  let rest = ''
  let selbstauskunft = null
  kind.stderr.setEncoding('utf8')
  kind.stderr.on('data', (s) => {
    gemeldet = (gemeldet + s).slice(-4000)
    if (!selbstauskunft) {
      const m = (rest + s).match(/DevTools listening on ws:\/\/[^:]+:(\d+)\/devtools\/browser\/(\S+)/)
      if (m) selbstauskunft = { port: Number(m[1]), kennung: m[2] }
      else rest = (rest + s).slice(-500)
    }
  })

  /** Erst das Ende des Browsers abwarten, DANN das Profil loeschen. */
  const aufraeumen = async () => {
    abmelden()
    if (kind.exitCode === null && kind.signalCode === null) {
      const geendet = new Promise((r) => kind.once('exit', r))
      kind.kill('SIGTERM')
      // Ein Chromium, der nicht auf SIGTERM hoert, darf den Lauf nicht
      // aufhalten — nach zwei Sekunden wird er hart beendet.
      const hart = setTimeout(() => kind.kill('SIGKILL'), 2000)
      await geendet
      clearTimeout(hart)
    }
    rmSync(profil, { recursive: true, force: true })
  }

  // ══ AUCH WENN DER LAUF ABGEBROCHEN WIRD ════════════════════════════════════
  //
  // Ein `finally` in JavaScript laeuft bei Strg-C NICHT, und bei einem
  // `timeout 400 node …` ebenso wenig — dort kommt ein SIGTERM von aussen, und
  // der Vorgabeumgang damit ist „sofort sterben". Der Browser bleibt dann als
  // Waise stehen und sein mkdtemp-Verzeichnis liegt in /tmp. GEZAEHLT AM
  // 04.08.2026: nach rund fuenfzig Laeufen genau ein solches Verzeichnis, und
  // es stammte aus dem einen Lauf, den `timeout` abgeschossen hatte.
  //
  // ES BLEIBT EIN REST: SIGKILL laesst sich nicht abfangen. Dagegen hilft nur,
  // dass die Verzeichnisse `mupi-browser-*` heissen und in /tmp liegen, wo sie
  // beim naechsten Start verschwinden.
  //
  // `once` UND WIEDER ABMELDEN: `eigenerBrowser()` wird auch mehrfach
  // aufgerufen (sechs nebeneinander im Nachmessen). Bleiben die Hoerer haengen,
  // warnt node ab dem elften ueber ein Leck, das keines ist.
  // Seit dem 19.09.2026 ueber die gemeinsame Stelle oben — der Absatz darueber
  // erklaert weiterhin, WARUM es sie braucht.
  const abmelden = leiheMerken(aufraeumen)

  try {
    // ══ DER EIGENTUMSNACHWEIS ═══════════════════════════════════════════════
    //
    // WEDER `gewuenscht` NOCH `/json/list` BEWEISEN IRGENDETWAS. Genau das war
    // der teure Fehler: Ein ueberlebender Browser haelt den Port, der eigene
    // bindet ihn nicht, und `/json/list` antwortet klaglos mit den Zielen des
    // fremden. Das Werkzeug misst dann stundenlang eine Seite, die es nie
    // geoeffnet hat.
    //
    // Deshalb wird der Port dort gelesen, wo nur DIESER Prozess ihn hingeschrieben
    // haben kann. Zwei Wege, weil verschiedene Chromium-Baende verschieden reden:
    //
    //   * `DevToolsActivePort` im EIGENEN Profil — das Verzeichnis hat sonst
    //     niemand. Aeltere Baende schreiben sie.
    //   * die Zeile „DevTools listening on ws://…" auf dem EIGENEN Fehlerkanal.
    //     Der Chromium aus ms-playwright (1223, gemessen 04.08.2026) schreibt
    //     KEIN DevToolsActivePort mehr und nur noch diese Zeile.
    //
    // Beide tragen ausserdem die KENNUNG des Browsers, und die wird unten gegen
    // `/json/version` gehalten. Erst damit ist „ich rede mit dem Richtigen"
    // nicht wahrscheinlich, sondern nachgewiesen.
    const merker = join(profil, 'DevToolsActivePort')
    let port = 0
    let kennung = ''
    for (const frist = Date.now() + geduldMs; Date.now() < frist; ) {
      if (selbstauskunft) {
        port = selbstauskunft.port
        kennung = selbstauskunft.kennung
        break
      }
      if (existsSync(merker)) {
        const [erste, zweite] = readFileSync(merker, 'utf8').split('\n')
        if (/^\d+$/.test(String(erste).trim())) {
          port = Number(String(erste).trim())
          kennung = String(zweite || '')
            .trim()
            .replace(/^\/devtools\/browser\//, '')
          break
        }
      }
      if (kind.exitCode !== null) {
        throw new Error(
          `Browser beendete sich sofort (Ende ${kind.exitCode}): ${gemeldet.trim().split('\n').pop() || '—'}`,
        )
      }
      await warte(100)
    }
    if (!port) {
      throw new Error(
        `Browser nannte binnen ${geduldMs} ms keinen Debug-Port: ${gemeldet.trim().split('\n').pop() || '—'}`,
      )
    }

    /** Die offenen Ziele — mit Warten, denn `spawn` kehrt zurueck, sobald der
     *  Prozess laeuft, nicht sobald er antwortet. */
    const ziele = async () =>
      await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json()

    // GEGENPROBE: haengt hinter diesem Port wirklich UNSER Browser? Die
    // Kennung aus `/json/version` muss die sein, die er uns selbst genannt
    // hat. Stimmt sie nicht, ist es ein fremder — und dann wird abgebrochen
    // statt gemessen. LAUT SCHEITERN: Weitermessen hiesse, ein Ergebnis ueber
    // eine fremde Seite zu melden, und das ist schlimmer als kein Ergebnis.
    if (kennung) {
      let gesehen = ''
      for (const frist = Date.now() + geduldMs; Date.now() < frist; ) {
        try {
          const v = await (
            await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
          ).json()
          gesehen = String(v.webSocketDebuggerUrl || '')
          if (gesehen) break
        } catch {
          /* noch nicht so weit */
        }
        await warte(150)
      }
      if (!gesehen.endsWith(`/devtools/browser/${kennung}`)) {
        throw new Error(
          `Port ${port} gehoert einem FREMDEN Browser (erwartet …/${kennung}, gefunden ${gesehen || '—'}) — ` +
            'vermutlich haelt ihn ein Ueberlebender eines harten Abbruchs',
        )
      }
    }

    let liste = null
    for (const frist = Date.now() + geduldMs; Date.now() < frist; ) {
      try {
        liste = await ziele()
        if (liste.some((z) => z.type === 'page')) break
      } catch {
        /* noch nicht so weit */
      }
      await warte(150)
    }
    if (!liste || !liste.some((z) => z.type === 'page')) {
      throw new Error(`Browser auf Port ${port} zeigte binnen ${geduldMs} ms keine Seite`)
    }

    /** Die Debug-Adresse der ersten Seite. */
    const seite = async () => (await ziele()).find((z) => z.type === 'page')?.webSocketDebuggerUrl

    return { port, kind, profil, ziele, seite, schliessen: aufraeumen }
  } catch (e) {
    await aufraeumen()
    throw e
  }
}

/**
 * DIE VORSCHAU LEIHEN — oder eine eigene starten, wenn keine laeuft.
 *
 * @param {string|URL} ziel  z. B. `http://127.0.0.1:8299/neu/`
 * @returns {Promise<{eigene:boolean,lage:object|null,zurueckgeben:Function}>}
 *   `eigene` sagt, ob diese Vorschau uns gehoert. Gehoert sie uns, wird sie am
 *   Ende beendet; ist sie geliehen, wird ihre Lage wieder hingelegt.
 */
export async function vorschauLeihen(ziel, { geduldMs = 8000 } = {}) {
  const erreichbar = async (ms = 1500) => {
    try {
      await fetch(new URL('/api/werke', ziel), { signal: AbortSignal.timeout(ms) })
      return true
    } catch {
      return false
    }
  }

  if (await erreichbar()) {
    // GELIEHEN. Was jetzt dasteht, muss am Ende wieder dastehen — und zwar
    // DIESES, nicht die Vorgabe: die Vorschau gehoert jemandem, der sich seine
    // Lage selbst gestellt hat.
    let antwort = null
    try {
      antwort = await (await fetch(new URL('/vorschau/lage', ziel), { signal: AbortSignal.timeout(1500) })).json()
    } catch {
      /* gar keine Antwort — behandelt wie ein alter Stand, siehe unten */
    }

    // ══ EINE ANTWORT IST NOCH KEIN SCHNAPPSCHUSS ═══════════════════════════
    //
    // HIER STAND EINE ZEILE LANG `if (!lage)`, UND DAS WAR FALSCH — gemessen
    // am 04.08.2026 gegen eine Vorschau, die noch aus dem Stand von vorher
    // lief. Der Umschalter von neu-vorschau.mjs hat einen AUFFANGZWEIG: alles
    // Unbekannte landet in `lage.spielt`, und geantwortet wird mit `{ lage }`.
    // Eine alte Vorschau quittiert `/vorschau/lage` also mit HTTP 200 und
    // einem Rumpf, der ein Feld `lage` traegt — die Pruefung „habe ich etwas
    // bekommen?" ging glatt durch. Zurueckgelegt wurde danach mit POST auf
    // denselben Weg, was in der alten Fassung wieder nur den Auffangzweig
    // traf. Ergebnis: `lage.spielt` hiess „lage", die Attrappe meldete weder
    // Wiedergabe noch Stille, und das Werkzeug, das nur AUFRAEUMEN wollte,
    // hatte die Vorschau kaputtgemacht. Dieselbe Falle wie in
    // [veraltete-vorschau-meldet-falsches-rot], nur diesmal im Aufraeumen.
    //
    // Erkannt wird der echte Schnappschuss an den drei Feldern, die der
    // Auffangzweig NICHT mitliefert.
    const echt = !!(antwort?.lage && antwort.ablage && antwort.kinderzeit && antwort.bt)
    const lage = echt ? antwort : null
    if (!echt) {
      console.warn('  ACHTUNG  die laufende Vorschau kennt /vorschau/lage nicht (alter Stand).')
      console.warn('           Ihre Lage laesst sich nicht zuruecklegen — und ihr Auffangzweig hat')
      console.warn('           soeben `spielt` auf „lage" gestellt. Erst neu starten, dann messen:')
      // NICHT `pkill -f neu-vorschau.mjs`. Das Muster trifft auch die SHELL,
      // in der der Befehl steht (ihre Befehlszeile enthaelt ihn ja), und
      // beendet damit den eigenen Lauf mit — hier am 04.08.2026 prompt
      // passiert, gleich zweimal. `pgrep -f … | xargs kill` hat denselben
      // Fehler; nur `-x` hilft, denn es verlangt, dass die GANZE Befehlszeile
      // passt, und die einer Shell ist immer laenger.
      console.warn('             pkill -x -f "(/usr/bin/)?node tools/neu-vorschau.mjs"')
      console.warn('             node tools/neu-vorschau.mjs &')
      // DEN SCHADEN WENIGSTENS ZURUECKDREHEN, den die Frage selbst angerichtet
      // hat. Der Wert von VORHER ist verloren — den kannte nur die Antwort,
      // die es nicht gibt. Die Vorgabe ist trotzdem besser als „lage": mit ihr
      // spielt die Attrappe wieder etwas, und die naechste Messung misst nicht
      // das Nichts.
      if (antwort?.lage?.spielt === 'lage') {
        await fetch(new URL('/vorschau/spielt', ziel)).catch(() => {})
        console.warn('           (`spielt` ersatzweise auf die Vorgabe zurueckgestellt)')
      }
    }
    // AUCH AUF DEM SIGNALWEG (19.09.2026): Bis heute war diese Leihgabe die
    // einzige, die bei Strg-C oder `timeout` NICHT zurueckging — die fremde
    // Vorschau behielt den Zustand, den dieser Lauf ihr gegeben hatte.
    const abmelden = leiheMerken(async () => {
      if (!lage) return
      try {
        await fetch(new URL('/vorschau/lage', ziel), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(lage),
          signal: AbortSignal.timeout(2000),
        })
      } catch {
        // Sie ist inzwischen weg — dann hat sich das Zuruecklegen erledigt.
      }
    })
    return {
      eigene: false,
      lage,
      zurueckgeben: async () => {
        abmelden()
        if (!lage) return false
        try {
          await fetch(new URL('/vorschau/lage', ziel), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(lage),
            signal: AbortSignal.timeout(2000),
          })
          return true
        } catch {
          // Sie ist inzwischen weg — dann hat sich das Zuruecklegen erledigt.
          return false
        }
      },
    }
  }

  // KEINE DA: eine eigene starten. Die gehoert uns, also wird sie am Ende
  // beendet und braucht kein Zuruecklegen.
  //
  // AUF DEM PORT DES ZIELS, nicht auf dem Vorgabeport. Hier stand `['tools/
  // neu-vorschau.mjs']` ohne `--port`, und das war ein stiller Fehler mit
  // teurer Wirkung: Jedes Werkzeug nimmt eine Adresse als Argument
  // (`node tools/… http://127.0.0.1:8391/neu/`), damit es neben einer
  // laufenden Messung arbeiten kann. Fand es dort nichts, startete es die
  // Attrappe trotzdem auf 8299 — also NICHT dort, wo es gleich messen wollte.
  // Danach lief die Wartezeit vergebens ab, und gemessen wurde gegen eine
  // Vorschau, die es nie gab (oder, schlimmer, gegen die FREMDE auf 8299).
  // Gefunden am 04.08.2026 beim Nachmessen auf 8391.
  const port = new URL(ziel).port
  const kind = spawn(process.execPath, ['tools/neu-vorschau.mjs', ...(port ? ['--port', port] : [])], {
    stdio: 'ignore',
  })
  for (const frist = Date.now() + geduldMs; Date.now() < frist; ) {
    await warte(300)
    if (await erreichbar(1000)) break
  }
  // Dieselbe Anmeldung wie oben: eine eigene Vorschau, die ein Abbruch stehen
  // laesst, haelt ihren Port und blockiert den naechsten Lauf.
  const abmeldenEigene = leiheMerken(async () => {
    if (kind.exitCode === null && kind.signalCode === null) kind.kill('SIGTERM')
  })
  return {
    eigene: true,
    lage: null,
    zurueckgeben: async () => {
      abmeldenEigene()
      if (kind.exitCode === null && kind.signalCode === null) {
        const geendet = new Promise((r) => kind.once('exit', r))
        kind.kill('SIGTERM')
        const hart = setTimeout(() => kind.kill('SIGKILL'), 2000)
        await geendet
        clearTimeout(hart)
      }
      return true
    },
  }
}
