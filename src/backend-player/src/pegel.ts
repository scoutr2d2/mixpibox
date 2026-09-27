/**
 * PEGEL — vier Frequenzbaender fuer die Wellen-Anzeige (BACKLOG.md E99).
 *
 * ══ DER VERTRAG (die Oberflaeche wird PARALLEL exakt dagegen gebaut) ═══════
 *
 *   `pegel: [b1, b2, b3, b4]` — vier Zahlen 0..1 (Bass ~60-250 Hz, untere
 *   Mitten 250-1000 Hz, obere Mitten 1-4 kHz, Hoehen 4-10 kHz), additiv in
 *   der vorhandenen Zustands-Antwort, ~10x/s aktualisiert, solange Ton
 *   laeuft. Bei Stille oder Pause exakt [0,0,0,0]. Das Feld FEHLT GANZ,
 *   wenn der Abgriff nicht verfuegbar ist (alte Box, kein PipeWire, kein
 *   `pw-record`) — die Oberflaeche behandelt Fehlen wie "Funktion nicht da".
 *
 * ══ WIE ABGEGRIFFEN WIRD — UND WARUM ANDERS ALS BEIM MITSCHNITT ════════════
 *
 * plugins/mixpi-mitschnitt haengt sich MIT ABSICHT NICHT an den Monitor der
 * Standard-Senke, weil der auch Piper-Ansagen mitschneidet ("Noch fuenf
 * Minuten") — ein Archiv, in dem eine Ansage mitten im Lied steckt, waere
 * keins. Hier ist es GENAU UMGEKEHRT: diese Anzeige soll "was die Familie
 * gerade hoert" zeigen, Ansagen eingeschlossen — eine Welle, die bei einer
 * Ansage flach bleibt, waere eine Welle, die luegt.
 *
 * Deshalb wird `pw-record` bewusst OHNE `--target` aufgerufen. Was das
 * bedeutet, hat plugins/mixpi-mitschnitt/arbeiter.mjs (`mitschnittArgumente`,
 * am Geraet gemessen 22./23.08.2026) bereits herausgefunden und dort als
 * FALLE dokumentiert: ohne `--target` sucht sich `pw-record` die
 * Standardquelle selbst — den Monitor der Standard-Senke, also den
 * Lautsprecher. Fuer den Mitschnitt war das der Fehler, der vier stille
 * Aufnahmen erzeugt hat. Fuer PEGEL ist es exakt der gewuenschte Vertrag,
 * und zwar durch bereits vorhandene, an dieser Box gemessene Erfahrung
 * belegt — nicht neu erraten.
 *
 * ══ WAS HIER NICHT GEPRUEFT IST (siehe Abschlussbericht) ═══════════════════
 *
 * Dieses Modul ist auf einem Entwicklungsrechner entstanden, der `pw-record`
 * zwar besitzt (PipeWire 1.6.8), aber nicht die Box ist. Ob der Name des
 * Standard-Monitors auf der Box tatsaechlich der Lautsprecher ist (und nicht
 * z. B. eine Bluetooth-Senke), ob `pw-record` dort ueberhaupt installiert
 * ist, und wie hoch die tatsaechliche CPU-Last ausfaellt — das bleibt eine
 * Messung AM GERAET (siehe BACKLOG E99, Messlatte unter 2 %).
 *
 * ══ AUFBAU DIESER DATEI ═════════════════════════════════════════════════
 *
 * Oben REIN (Goertzel, Normierung, Bandaufteilung, Kommandozeile) — pruefbar
 * ohne Ton und ohne Prozess, siehe pegel.spec.ts, nach dem Muster von
 * mpv-protokoll.ts/.spec.ts. Unten die Verkabelung (Kindprozess, Start/Stopp,
 * Fehlertoleranz) — bewusst duenn gehalten, mit einer injizierbaren
 * Spawn-Funktion fuer kuenftige Tests nach dem Muster von mpv-wrapper.ts.
 */

import { type ChildProcess, spawn } from 'node:child_process'

// ─────────────────────────────────────────────────────────────────────────
// REIN: Vertrag, Baender, Goertzel, Normierung
// ─────────────────────────────────────────────────────────────────────────

export type Pegel = readonly [number, number, number, number]

/** s16 mono, 16 kHz — schlank genug fuer Goertzel ohne FFT (BACKLOG E99). */
export const ABTASTRATE = 16000
/** 1600 Proben bei 16 kHz = 100 ms — der Fensterrahmen aus BACKLOG E99. */
export const FENSTER_PROBEN = 1600
const FENSTER_BYTES = FENSTER_PROBEN * 2 // s16 = 2 Byte je Probe

/**
 * Ab wann ein gemessener Pegel nicht mehr gilt (E138).
 *
 * DREI FENSTER. Bei laufendem Ton kommt alle 100 ms eines; bleibt drei Runden
 * lang keines, liefert `pw-record` nichts mehr — PipeWire suspendiert den
 * Monitor, sobald nichts mehr spielt. Kuerzer waere zappelig (ein einzelnes
 * verspaetetes Fenster liesse die Welle zucken), laenger bliebe die Welle nach
 * dem Stoppen sichtbar stehen, und genau das war der gemeldete Fehler.
 */
export const VERFALL_MS = 300

/** Eigener Knotenname, so wie `mixpi-mitschnitt` es fuer seinen Zweck tut. */
export const EIGENNAME = 'mixpi-pegel'

/**
 * Bezug fuer die Normierung — der Nenner, BEVOR Wurzel und Deckel greifen.
 *
 * Eine einzelne, exakt getroffene Sinuslinie bei s16-Vollausschlag ergibt in
 * `goertzelBetrag` (analytisch wie numerisch nachgerechnet, N=1600) einen
 * Betrag von rund Vollausschlag/2 = 16383,5. Mit diesem Bezug (ein Viertel
 * Vollausschlag) erreicht eine einzelne Frequenz schon bei HALBER
 * Vollaussteuerung den Deckel — die Anzeige zeigt "voll", bevor eine
 * Aufnahme an die digitale Decke stoesst. Siehe pegel.spec.ts fuer die
 * nachgerechneten Werte.
 */
const NORMIERUNGS_BEZUG = 8192

interface Band {
  readonly name: string
  readonly hz: readonly number[]
}

/**
 * Vier Baender, DREI Abhorch-Frequenzen je Band statt einer.
 *
 * WARUM DREI: Ein Goertzel-Fenster von 1600 Proben bei 16 kHz hat eine
 * Aufloesung von Rate/N = 10 Hz — eine Linie, die mehr als ein, zwei Bins
 * daneben liegt, faellt praktisch auf 0 (siehe pegel.spec.ts, "eine Linie
 * knapp daneben"). Bei "obere Mitten" (1-4 kHz) oder "Hoehen" (4-10 kHz)
 * waere EIN Abhorch-Punkt in einem so breiten Band fast immer daneben. Drei
 * ueber das Band verteilte Frequenzen, je Fenster per MAXIMUM zusammengefasst
 * (nicht Summe/Mittel — ein einzelner deutlicher Ton soll das Band
 * ausschlagen lassen, nicht von zwei stillen Nachbarn verduennt werden),
 * decken mehr vom Band ab. Das kostet nur ein paar zusaetzliche
 * Multiplikationen je Probe — immer noch weit von einer FFT entfernt.
 *
 * HOEHEN BLEIBT UNTER NYQUIST: bei 16 kHz Abtastrate ist bei 8000 Hz Schluss.
 * Der angeforderte Bereich "4-10 kHz" ist oberhalb 8 kHz bei DIESER
 * Abtastrate grundsaetzlich nicht darstellbar — die Abhorch-Frequenzen
 * bleiben deshalb mit Sicherheitsabstand darunter (bis 7200 Hz).
 */
const BAENDER: readonly Band[] = [
  { name: 'bass', hz: [80, 130, 200] }, // 60-250 Hz
  { name: 'untereMitten', hz: [350, 440, 750] }, // 250-1000 Hz; 440 Hz = Kammerton A
  { name: 'obereMitten', hz: [1400, 2200, 3200] }, // 1-4 kHz
  { name: 'hoehen', hz: [4500, 5800, 7200] }, // 4-10 kHz gefordert, unter Nyquist (8000 Hz) gedeckelt
]

/**
 * Goertzel — die Energie bei EINER Frequenz, ohne FFT.
 *
 * Wortgleiche Formel wie `goertzel()` in tools/box/mitschnitt-machbar.py
 * (dort gegen einen bekannten Testton geprueft) — hier direkt auf dem
 * Rohpuffer: `readInt16LE` liest jede Probe unmittelbar aus dem Byte-Puffer,
 * ohne Zwischenarray und ohne Kopie.
 *
 * @param puffer       s16-LE-Proben, mindestens `anzahlProben * 2` Byte lang
 * @param anzahlProben wie viele Proben ab Byte 0 gelesen werden
 * @param hz           die Zielfrequenz
 * @param rate         die Abtastrate, mit der `puffer` aufgenommen wurde
 */
export function goertzelBetrag(puffer: Buffer, anzahlProben: number, hz: number, rate: number): number {
  const k = 2 * Math.cos((2 * Math.PI * hz) / rate)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < anzahlProben; i++) {
    const probe = puffer.readInt16LE(i * 2)
    const s0 = probe + k * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - k * s1 * s2)) / anzahlProben
}

/**
 * Einen Goertzel-Betrag auf 0..1 bringen — sanfte Saettigung per Wurzel,
 * danach ein harter Deckel (BACKLOG E99: "Normierung auf 0..1 mit sanfter
 * Saettigung, z. B. sqrt + Deckel").
 *
 * Die Wurzel hebt leise Passagen sichtbar an (ein Zehntel Bezug wird 0,32
 * statt 0,1) und staucht laute zusammen — eine uebliche Kurve fuer
 * Pegelanzeigen, damit nicht alles unterhalb "laut" im Rauschen verschwindet.
 * Der Deckel faengt alles ab dem Bezugswert ab (siehe NORMIERUNGS_BEZUG).
 */
function normieren(betrag: number): number {
  const anteil = betrag / NORMIERUNGS_BEZUG
  return Math.min(1, Math.sqrt(anteil))
}

/**
 * Die vier Baender ueber EIN Fenster (100 ms, 1600 Proben bei 16 kHz per
 * Vorgabe — siehe ABTASTRATE/FENSTER_PROBEN).
 */
export function pegelAusFenster(
  puffer: Buffer,
  anzahlProben: number = FENSTER_PROBEN,
  rate: number = ABTASTRATE,
): Pegel {
  const ergebnis: [number, number, number, number] = [0, 0, 0, 0]
  for (let b = 0; b < BAENDER.length; b++) {
    let staerkstes = 0
    for (const hz of BAENDER[b].hz) {
      const betrag = goertzelBetrag(puffer, anzahlProben, hz, rate)
      if (betrag > staerkstes) staerkstes = betrag
    }
    ergebnis[b] = normieren(staerkstes)
  }
  return ergebnis
}

/**
 * Die Schalter fuer `pw-record`.
 *
 * OHNE `--target`, UND DAS IST ABSICHT — siehe den Kopfkommentar dieser
 * Datei: ohne `--target` sucht sich `pw-record` die Standardquelle selbst,
 * und das ist der Monitor der Standard-Senke, also "was die Familie gerade
 * hoert" (an dieser Box bereits einmal gemessen, in
 * plugins/mixpi-mitschnitt/arbeiter.mjs `mitschnittArgumente` dokumentiert —
 * dort als Falle, hier als Vertrag).
 *
 * `--raw` liefert reines PCM ohne Container: `-` als Ausgabe bedeutet
 * stdout, und ohne `--raw` muesste `pw-record` mangels Dateiendung raten,
 * welchen Container es dorthin schreiben soll.
 *
 * Der eigene `node.name` macht den Knoten in `pw-link -l`/`pw-dump`
 * erkennbar, so wie `mixpi-mitschnitt` es fuer seinen Zweck tut.
 */
export function pwRecordArgumente(): readonly string[] {
  return [
    '-P',
    `{ node.name = "${EIGENNAME}" }`,
    '--rate',
    String(ABTASTRATE),
    '--channels',
    '1',
    '--format',
    's16',
    '--raw',
    '-',
  ]
}

// ─────────────────────────────────────────────────────────────────────────
// UNREIN: Kindprozess, Start/Stopp, Fehlertoleranz
// ─────────────────────────────────────────────────────────────────────────

/**
 * Dieselbe Umgebungs-Reparatur wie `pwUmgebung()` in
 * plugins/mixpi-mitschnitt/index.mjs (dort ausfuehrlich begruendet): ein
 * systemd-Dienst erbt kein `XDG_RUNTIME_DIR`, und ohne die Variable findet
 * PipeWire seinen Socket nicht (`pw_context_connect() failed: Host is
 * down`). Eine gemeinsame Datei fuer beide Pakete gibt es nicht — plugins/
 * und src/backend-player/ sind getrennte Pakete —, deshalb steht die
 * Reparatur hier noch einmal, absichtlich wortnah.
 */
function pwUmgebung(): NodeJS.ProcessEnv {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
  return { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}` }
}

/** Wie `spawn`, austauschbar fuer Tests (kein echter Prozess noetig). */
type SpawnFn = (
  befehl: string,
  argumente: readonly string[],
  optionen: { stdio: readonly ['ignore', 'pipe', 'pipe']; env: NodeJS.ProcessEnv },
) => ChildProcess

export interface PegelSteuerung {
  /** Idempotent: ein zweiter Aufruf waehrend der Abgriff schon laeuft tut nichts. */
  starten(protokoll?: (text: string) => void): void
  /** Idempotent: sicher aufrufbar, auch wenn nichts laeuft. Setzt sofort [0,0,0,0]. */
  stoppen(): void
  /** `undefined`, wenn der Abgriff nicht verfuegbar ist — siehe Kopfkommentar. */
  lesen(): Pegel | undefined
}

/**
 * Eine Pegel-Steuerung erzeugen — als Fabrik, damit Tests eine eigene,
 * isolierte Instanz mit einer FAKE-Spawn-Funktion bauen koennen, ohne das
 * Modul-Singleton (siehe unten) anzufassen. Fuer den Alltag reicht das
 * Singleton (`pegelStarten`/`pegelStoppen`/`pegelLesen`).
 */
export function erzeugePegelSteuerung(
  spawnFn: SpawnFn = spawn as unknown as SpawnFn,
  jetzt: () => number = Date.now,
): PegelSteuerung {
  let prozess: ChildProcess | null = null
  // Optimistisch: bis zum ERSTEN echten Fehlschlag gilt der Abgriff als
  // moeglich. Das vermeidet ein Feld, das schon vor dem ersten Abspielen aus
  // der Antwort verschwindet, nur weil noch niemand `pw-record` versucht hat.
  let verfuegbar = true
  // "Genau einmal" (AUFGABEN 2d): erst NACH diesem Flag wird still geschwiegen.
  let gemeldet = false
  let aktuell: [number, number, number, number] = [0, 0, 0, 0]
  /* ══ DER WERT HAT EIN ALTER (E138, 10.09.2026) ════════════════════════════
   *
   * `aktuell` wird NUR bei einem vollen Fenster ueberschrieben. Bleibt
   * `pw-record` stumm — und genau das tut PipeWire bei Pause, es suspendiert
   * den Monitor —, reicht `lesen()` das letzte Fenster ewig weiter. Die Welle
   * im Player lief deshalb bei gestoppter Wiedergabe munter weiter, mit den
   * Pegeln des letzten gehoerten Augenblicks eingefroren.
   *
   * DREI ANLAEUFE IM FRONTEND SIND DARAN GESCHEITERT, und sie mussten es:
   * dort wurde versucht, einen falschen Wert zu erkennen, statt ihn gar nicht
   * erst zu liefern. Der Kopfkommentar dieser Datei verspricht [0,0,0,0] bei
   * Pause — der Vertrag war HIER gebrochen, also gehoert er hier geheilt.
   *
   * `jetzt` ist injizierbar, damit ein Zeuge das Altern pruefen kann, ohne
   * echte Zeit zu verbrauchen.
   */
  let gemessenUm = 0
  // EINMALIG angelegt, danach nur noch ueberschrieben — "keine Allokationen
  // je Chunk" (BACKLOG E99 / AUFGABEN 4).
  const fenster = Buffer.alloc(FENSTER_BYTES)
  let gefuellt = 0

  function fehlerEinmalig(protokoll: ((text: string) => void) | undefined, text: string): void {
    verfuegbar = false
    aktuell = [0, 0, 0, 0]
    gefuellt = 0
    if (!gemeldet) {
      gemeldet = true
      protokoll?.(`Pegel-Abgriff nicht verfuegbar (${text}) — pegel bleibt ab jetzt aus der Zustands-Antwort`)
    }
  }

  function verarbeiten(chunk: Buffer): void {
    let off = 0
    while (off < chunk.length) {
      const n = Math.min(FENSTER_BYTES - gefuellt, chunk.length - off)
      chunk.copy(fenster, gefuellt, off, off + n)
      gefuellt += n
      off += n
      if (gefuellt === FENSTER_BYTES) {
        aktuell = pegelAusFenster(fenster) as [number, number, number, number]
        gemessenUm = jetzt()
        gefuellt = 0
      }
    }
  }

  function starten(protokoll?: (text: string) => void): void {
    if (!verfuegbar || prozess) return

    let p: ChildProcess
    try {
      p = spawnFn('pw-record', pwRecordArgumente(), { stdio: ['ignore', 'pipe', 'pipe'], env: pwUmgebung() })
    } catch (f: any) {
      fehlerEinmalig(protokoll, f?.message || String(f))
      return
    }
    prozess = p
    gefuellt = 0

    // Die erste Zeile von stderr fuer eine verstaendliche Meldung — wie in
    // plugins/mixpi-mitschnitt/index.mjs (`starten`/`meckern`).
    let meckern = ''
    p.stderr?.on('data', (s: Buffer) => {
      meckern += String(s)
    })
    p.stdout?.on('data', (chunk: Buffer) => verarbeiten(chunk))
    // ENOENT (kein `pw-record` auf der Box) kommt NICHT als Wurf, sondern als
    // `error`-Ereignis auf dem zurueckgegebenen Objekt — Node meldet einen
    // fehlgeschlagenen Start so, nicht synchron.
    p.on('error', (f: any) => fehlerEinmalig(protokoll, f?.message || String(f)))
    p.on('exit', (code: number | null, signal: string | null) => {
      // Nur reagieren, wenn DIESER Prozess noch der aktuell verantwortliche
      // ist — `stoppen()` hat `prozess` davor bereits synchron auf null
      // gesetzt, ein Exit danach ist der ERWARTETE, kein Fehler.
      if (prozess !== p) return
      prozess = null
      if (!verfuegbar) return
      const erste = meckern
        .split('\n')
        .map((z) => z.trim())
        .find((z) => z.length > 0)
      fehlerEinmalig(protokoll, erste || `pw-record beendet (code=${code}, signal=${signal})`)
    })
  }

  function stoppen(): void {
    if (prozess) {
      try {
        prozess.kill('SIGTERM')
      } catch {
        /* schon weg */
      }
    }
    prozess = null
    gefuellt = 0
    aktuell = [0, 0, 0, 0]
    gemessenUm = 0
  }

  function lesen(): Pegel | undefined {
    if (!verfuegbar) return undefined
    // STILLE IST NICHT DASSELBE WIE „NICHTS GEMESSEN". Ein Fenster ist 100 ms;
    // kommt drei Fenster lang keines mehr, hoert die Box nichts mehr — dann
    // sind Nullen die WAHRHEIT und der letzte Wert eine Erinnerung. Die Frist
    // ist grosszuegig, damit ein einzelnes verspaetetes Fenster die Welle nicht
    // zucken laesst.
    if (gemessenUm === 0 || jetzt() - gemessenUm > VERFALL_MS) return [0, 0, 0, 0]
    return aktuell
  }

  return { starten, stoppen, lesen }
}

const SINGLETON = erzeugePegelSteuerung()

/** Abgriff einschalten — aufrufen an DER EINEN Stelle, die auf "spielt" schaltet. */
export function pegelStarten(protokoll?: (text: string) => void): void {
  SINGLETON.starten(protokoll)
}

/** Abgriff ausschalten — aufrufen an DER EINEN Stelle, die auf "Pause/Stopp" schaltet. */
export function pegelStoppen(): void {
  SINGLETON.stoppen()
}

/** Die vier aktuellen Werte, oder `undefined`, wenn der Abgriff nicht verfuegbar ist. */
export function pegelLesen(): Pegel | undefined {
  return SINGLETON.lesen()
}
