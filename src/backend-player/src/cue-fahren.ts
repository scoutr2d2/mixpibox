/**
 * CUE-FAHREN — die unreine Haelfte des PipeWire-Cue (BACKLOG E114, Stufe 3b).
 *
 * `tonpfad.ts` weiss, WELCHE Kante der Spotify-Ton ist (rein, gegen eine
 * Vorlage geprueft). `cue-schalter.ts` kann sie trennen und zurueckverbinden
 * (rein bis auf den Ausfuehrer, mit Rueckverbinde-Zwang). Was zwischen beiden
 * fehlte, ist genau zweierlei:
 *
 *   1. den GRAPHEN LESEN — `pw-dump` aufrufen. Das ist der einzige Zugriff
 *      auf die Aussenwelt in dieser Datei.
 *   2. das STUMME FENSTER FUEHREN — trennen, die riskante Handlung
 *      ausfuehren, zurueckverbinden. Und zwar so, dass Punkt drei auch dann
 *      passiert, wenn die Handlung wirft.
 *
 * ══ WOZU DAS FENSTER ueberhaupt ═══════════════════════════════════════════
 *
 * Der Maschinenwechsel mpv -> Spotify kostet 1-2 s Stille (am Geraet
 * gemessen, llmwiki dienste-umschalten). Startet man den Spotify-Titel
 * dagegen im Stummen, laesst ihn puffern, springt auf 0 und macht ihn erst
 * dann hoerbar, liegen alle riskanten Befehle in einem Moment, in dem
 * niemand zuhoert. Der Wechsel wird nicht schneller — er wird unhoerbar.
 *
 * ══ DER GERAETEBEWEIS LIEGT VOR (04.09.2026) ══════════════════════════════
 *
 * Auf der Box, bei spielendem Spotify, ueber `tools/cue-messen.mjs --probe`:
 *
 *     Pegel vorher      -8.3 dB
 *     Pegel getrennt   -inf  dB     bricht vollstaendig ein
 *     Pegel danach      -9.5 dB     kommt zurueck
 *
 * Und die zwei Kanten zum Mitschnitt blieben dabei stehen — genau dafuer
 * wird der LINK getrennt und nicht der Knoten gemutet.
 *
 * ══ WAS DIESE DATEI AUSDRUECKLICH NICHT TUT ═══════════════════════════════
 *
 * Sie startet keinen Titel und kennt keine Titelliste. Sie oeffnet ein
 * stummes Fenster und schliesst es wieder; WAS darin geschieht, gibt der
 * Aufrufer als Funktion herein. So bleibt der Spotify-Start dort, wo er
 * hingehoert (spotify-control.ts), und diese Datei bleibt ohne Meinung
 * darueber testbar.
 */
import { execFile } from 'node:child_process'
import {
  type CueSchalter,
  type CueSchalterGaben,
  cueErlaubt,
  erzeugeCueSchalter,
  pwUmgebung,
} from './cue-schalter'
import { type CueOptionen, type CuePlan, cuePlanAus } from './tonpfad'

/** Wie lange `pw-dump` hoechstens brauchen darf. */
export const DUMP_FRIST_MS = 4000

/**
 * Wie lange der neue Titel im Stummen puffern darf, ehe hoerbar gemacht wird.
 *
 * NICHT GEMESSEN, SONDERN GESETZT — und das gehoert dazugesagt. Der Wert
 * muss zwei Dinge zugleich erfuellen: laenger als der Anlauf von Spotify
 * (sonst hoert man den Rest des Anlaufs doch) und deutlich kuerzer als
 * `CUE_FRIST_MS` des Rueckverbinde-Zwangs (sonst holt der Zwang den Ton
 * mitten im Fenster zurueck und man hoert genau das, was verborgen werden
 * sollte). 1200 ms liegen zwischen den gemessenen 1-2 s Wechselkosten und
 * den 5 s der Frist.
 */
export const PUFFER_MS = 1200

export type DumpLeser = () => Promise<unknown>

export interface FahrGaben extends CueSchalterGaben {
  /** Vorgabe: `pw-dump` aufrufen. In Tests eine abgelegte Ausgabe. */
  dumpLeser?: DumpLeser
  /** Vorgabe: ein frisch erzeugter Schalter. */
  schalter?: CueSchalter
  /** Auswahlregeln fuer `cuePlanAus` (Senkenname, Namensliste). */
  planOptionen?: CueOptionen
  /** Vorgabe: `setTimeout`-Warten. In Tests sofort. */
  warten?: (ms: number) => Promise<void>
}

/** Was aus einer Fahrt herauskam — fuer das Protokoll des Aufrufers. */
export type FahrErgebnis =
  /** Das Fenster stand; die Handlung lief darin. */
  | { art: 'gefahren'; plan: CuePlan }
  /** Kein Fenster (Cue aus, kein Plan, kein Dump) — die Handlung lief TROTZDEM. */
  | { art: 'ohne-fenster'; grund: string }

const echterDumpLeser: DumpLeser = () =>
  new Promise((fertig, scheitern) => {
    execFile('pw-dump', [], { env: pwUmgebung(), timeout: DUMP_FRIST_MS, maxBuffer: 64 * 1024 * 1024 }, (f, aus) =>
      f ? scheitern(f) : fertig(JSON.parse(aus)),
    )
  })

const echtesWarten = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * DEN PLAN HOLEN — der einzige Aussenzugriff dieser Datei.
 *
 * Gibt `null` statt zu werfen, und zwar aus demselben Grund wie ueberall in
 * dieser Familie: Ein Cue, das sich nicht planen laesst, ist ein Grund fuer
 * 1-2 s Stille — kein Grund, den Titelstart platzen zu lassen. Der Aufrufer
 * spielt dann eben hoerbar um.
 */
export async function planHolen(gaben: FahrGaben = {}): Promise<CuePlan | null> {
  const leser = gaben.dumpLeser ?? echterDumpLeser
  try {
    return cuePlanAus(await leser(), gaben.planOptionen ?? {})
  } catch (f: unknown) {
    gaben.protokoll?.(`Cue: pw-dump nicht lesbar (${f instanceof Error ? f.message : String(f)})`)
    return null
  }
}

/**
 * DIE HANDLUNG IM STUMMEN FENSTER AUSFUEHREN.
 *
 * ══ DIE HANDLUNG LAEUFT IMMER ═════════════════════════════════════════════
 *
 * Auch wenn kein Fenster zustande kommt (Cue nicht eingeschaltet, `pw-dump`
 * unlesbar, kein Spotify-Knoten im Graphen, zwei Kandidaten). Das ist die
 * wichtigste Entscheidung dieser Datei: Das Cue ist eine VERSCHOENERUNG des
 * Wechsels, keine Vorbedingung dafuer. Wer es umgekehrt baut, macht eine Box
 * stumm, sobald PipeWire einmal anders aussieht als erwartet — und der Preis
 * fuer den Verzicht ist genau die Stille, die es ohnehin gaebe.
 *
 * ══ UND SIE WIRD IMMER AUFGEDECKT ═════════════════════════════════════════
 *
 * `klar()` steht im `finally`. Wirft die Handlung, kommt der Ton trotzdem
 * zurueck und der Wurf geht unveraendert an den Aufrufer weiter — er soll
 * ihn sehen, nur eben nicht mit einer stummen Box dazu. Das ist die zweite
 * Sicherung neben dem Rueckverbinde-Zwang der Uhr in `cue-schalter.ts`;
 * beide zusammen decken Wurf, Haenger und Vergesslichkeit ab. Gegen
 * `SIGKILL` hilft weiterhin nichts — dagegen braucht der Dienst einen
 * Signalgriff auf `klar()`, und der gehoert an seine Startstelle, nicht
 * hierher.
 */
export async function imStummenFenster<T>(
  handlung: () => Promise<T>,
  gaben: FahrGaben = {},
): Promise<{ wert: T; cue: FahrErgebnis }> {
  const warten = gaben.warten ?? echtesWarten

  // ZUERST DIE BILLIGE FRAGE: Ohne Schalter braucht es kein `pw-dump`. Das
  // spart auf der Box einen Prozessaufruf je Titelwechsel, solange die
  // Verdrahtung ausgeschaltet ist — und ausgeschaltet ist sie per Vorgabe.
  if (!cueErlaubt(gaben.umgebung ?? process.env)) {
    return { wert: await handlung(), cue: { art: 'ohne-fenster', grund: 'MIXPI_CUE nicht gesetzt' } }
  }

  const plan = await planHolen(gaben)
  if (!plan) {
    return { wert: await handlung(), cue: { art: 'ohne-fenster', grund: 'kein Plan' } }
  }

  const schalter = gaben.schalter ?? erzeugeCueSchalter(gaben)
  const ergebnis = schalter.stumm(plan)
  if (ergebnis.art !== 'gewirkt') {
    return { wert: await handlung(), cue: { art: 'ohne-fenster', grund: ergebnis.grund ?? ergebnis.art } }
  }

  try {
    const wert = await handlung()
    // Puffern lassen, SOLANGE ES STILL IST. Erst danach aufdecken.
    // Die Frist geht IMMER hinein; ob gewartet wird, entscheidet die Uhr —
    // in Tests eine, die sofort zurueckkommt. Hier `0` einzusetzen, weil
    // eine Attrappe gesetzt ist, hiesse den Testfall im Code zu erkennen,
    // und dann misst der Test einen anderen Ablauf als die Box faehrt.
    await warten(PUFFER_MS)
    return { wert, cue: { art: 'gefahren', plan } }
  } finally {
    schalter.klar()
  }
}
