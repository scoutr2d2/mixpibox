/**
 * CUE-SCHALTER — die Naht zwischen dem Plan und `pw-link` (BACKLOG E114).
 *
 * tonpfad.ts sagt, WELCHE Kante der Spotify-Ton ist. Diese Datei ist die
 * einzige Stelle, die daraufhin ein Programm aufruft. Sie ist absichtlich
 * duenn: trennen, Uhr spannen, zurueckverbinden. Alles Denken steht nebenan.
 *
 * ══ SIE IST NOCH AN NICHTS ANGESCHLOSSEN ═══════════════════════════════════
 *
 * Kein Aufruf aus spotify-control.ts, keine Verdrahtung in die Wiedergabe.
 * Das ist keine Vergesslichkeit, sondern die Baustufe: der Eingriff in den
 * laufenden Tonweg braucht einen Beweis AM GERAET (Ohr des Betreibers,
 * Pegelstrom, Mitschnitt gegengehoert), und den gab es am Bautag nicht — die
 * Box war offline. Bis dahin liegt hier ein Baustein, kein Verhalten.
 *
 * ══ SICHERUNG 1: DER UMGEBUNGSSCHALTER `MIXPI_CUE` ═════════════════════════
 *
 * Ohne `MIXPI_CUE=1` ruft diese Datei GAR NICHTS auf; sie schreibt eine
 * Zeile ins Protokoll und meldet `aus`. Der Grund ist nicht Vorsicht als
 * Geste, sondern die Bauform des Diensts: `spotify-control.ts` ist EIN
 * Prozess, der auf der Box als systemd-Dienst laeuft und den Ton der ganzen
 * Familie fuehrt. Wer hier baut, aendert ein Programm, das im Kinderzimmer
 * spielt. Ein Schalter, der standardmaessig AUS ist, macht den Unterschied
 * zwischen „ein neuer Codepfad liegt ungenutzt herum" und „ein neuer
 * Codepfad greift ab dem naechsten Ausrollen in den Ton ein". Nur das Erste
 * darf ohne Geraetebeweis passieren.
 *
 * Erlaubt ist EXAKT `1`. Nicht `true`, nicht `ja`, nicht „irgendwas gesetzt".
 * Ein Schalter, der auf jede nichtleere Belegung anspringt, waere bei
 * `MIXPI_CUE=0` an — und genau so herum tippt man es, wenn man ihn ausmachen
 * will.
 *
 * ══ SICHERUNG 2: DER RUECKVERBINDE-ZWANG ═══════════════════════════════════
 *
 * Wird getrennt, laeuft eine Uhr. Nach Ablauf verbindet DIESE Datei zurueck,
 * ohne dass der Aufrufer etwas tun muss — auch dann, wenn der Aufrufer
 * zwischendurch geworfen hat, haengt, oder den Faden schlicht verloren hat.
 *
 * Der Grund ist der schlimmstmoegliche Ausgang: eine Box, die stumm bleibt,
 * weil ein Cue haengengeblieben ist. Sie zeigt dabei „spielt", der
 * Fortschritt laeuft, das Kind tippt und tippt, und niemand kommt darauf,
 * dass eine Kante im Tongraphen fehlt. Ein Cue, das misslingt, darf hoechstens
 * die 1–2 Sekunden Stille kosten, die es abschaffen sollte.
 *
 * DREI ENTSCHEIDUNGEN, DIE DIESEN ZWANG ERST ZU EINEM MACHEN:
 *
 *  a) Erst merken und Uhr spannen, DANN trennen. Wuerde erst getrennt und
 *     danach gemerkt, gaebe es ein Fenster, in dem die Kante weg ist und
 *     niemand mehr weiss, dass sie zurueck muss. Der Preis ist ein
 *     Rueckverbinden fuer Kanten, die nie getrennt wurden — `pw-link` sagt
 *     dann „File exists" und tut nichts. Ein folgenloser Fehlversuch gegen
 *     ein moegliches Dauerschweigen: leichte Wahl.
 *
 *  b) Die Frist ist ABSOLUT, nicht gleitend. Ein zweites `stumm()` waehrend
 *     das Cue laeuft schiebt die Uhr NICHT nach hinten. Sonst koennte eine
 *     Schleife, die versehentlich alle 100 ms stumm schaltet, die Box
 *     beliebig lange stumm halten — der Zwang waere dann genau in dem Fall
 *     unwirksam, fuer den es ihn gibt.
 *
 *  c) Die Uhr wird NICHT `unref()`t. Ein `unref()`ter Zeitgeber laesst Node
 *     den Prozess beenden, waehrend die Rueckverbindung noch aussteht — und
 *     dann bleibt die Kante fuer immer getrennt. Solange ein Cue laeuft,
 *     soll dieser Prozess ausdruecklich am Leben bleiben; es geht um 5
 *     Sekunden.
 *
 * RESTRISIKO, ehrlich benannt: gegen `SIGKILL` hilft das nicht. Wird der
 * Dienst im stummen Fenster hart abgeschossen, bleibt die Kante getrennt,
 * bis jemand sie herstellt (`pw-link <ausgang> <eingang>`, die Nummern
 * stehen im Protokoll) oder die Spotify-Maschine neu einspeist. Das ist der
 * Punkt, an dem die Verdrahtung (Stufe 3b) eine Signalbehandlung braucht:
 * `klar()` ist absichtlich mehrfach und aus jeder Lage aufrufbar, damit ein
 * kuenftiger `SIGTERM`-Griff genau das tun kann.
 *
 * ══ KEINE NEBENWIRKUNG BEIM LADEN ══════════════════════════════════════════
 *
 * Diese Datei meldet beim Import NICHTS an — kein `process.on`, kein
 * Zeitgeber, kein Aufruf. Ein Modul, das schon durch sein Vorhandensein
 * etwas tut, waere in einem Tondienst die falsche Sorte Baustein.
 */

import { execFile } from 'node:child_process'

import { type Befehl, type CuePlan, planBeschreiben, trennBefehle, verbindBefehle } from './tonpfad'

/** Der Name des Schalters. Steht als Konstante, damit ihn Tests nicht abtippen. */
export const CUE_UMGEBUNGSSCHALTER = 'MIXPI_CUE'

/** Der einzige Wert, der einschaltet. Siehe Kopfkommentar, Sicherung 1. */
export const CUE_EIN = '1'

/**
 * Die Frist bis zum erzwungenen Zurueckverbinden.
 *
 * 5000 ms sind reichlich fuer das gedachte Fenster (Start, Puffern,
 * Pausieren, Sprung auf 0 — im Bereich von 1–2 s) und kurz genug, dass ein
 * haengendes Cue als kleiner Aussetzer durchgeht statt als kaputte Box.
 * Nicht am Ton gemessen; die Zahl gehoert zu dem, was der Geraetebeweis
 * bestaetigen oder korrigieren muss.
 */
export const CUE_FRIST_MS = 5000

/** Ein Befehl wird ausgefuehrt. Austauschbar, damit Tests einsammeln statt zu schalten. */
export type Ausfuehrer = (befehl: Befehl) => void

/** Was `setTimeout` zurueckgibt, auf das Noetige eingedampft. */
export interface UhrGriff {
  loeschen(): void
}

/** Wie `setTimeout`, austauschbar fuer Tests mit einer Uhr, die man selbst dreht. */
export type UhrStellen = (fn: () => void, ms: number) => UhrGriff

/** Was ein Schaltversuch ergeben hat. Nie ein Wurf — siehe tonpfad.ts. */
export type CueErgebnis =
  | { readonly art: 'gewirkt'; readonly befehle: readonly Befehl[]; readonly fehlschlaege: number }
  | { readonly art: 'aus'; readonly grund: string }
  | { readonly art: 'nichts-zu-tun'; readonly grund: string }

export interface CueSchalter {
  /** Den Spotify-Zulauf trennen und die Rueckverbinde-Uhr spannen. */
  stumm(plan: CuePlan): CueErgebnis
  /** Sofort zurueckverbinden. Idempotent, aus jeder Lage aufrufbar. */
  klar(): CueErgebnis
  /** Laeuft gerade ein Cue? */
  istStumm(): boolean
}

export interface CueSchalterGaben {
  /** Vorgabe: `execFile`, ohne auf die Antwort zu warten. */
  ausfuehrer?: Ausfuehrer
  /** Vorgabe: `process.env`. */
  umgebung?: NodeJS.ProcessEnv
  /** Vorgabe: `setTimeout` (ausdruecklich OHNE `unref` — Kopfkommentar c). */
  uhrStellen?: UhrStellen
  /** Vorgabe: `CUE_FRIST_MS`. */
  fristMs?: number
  protokoll?: (text: string) => void
}

/**
 * Dieselbe Umgebungs-Reparatur wie in pegel.ts und
 * plugins/mixpi-mitschnitt/index.mjs (dort ausfuehrlich begruendet): ein
 * systemd-Dienst erbt kein `XDG_RUNTIME_DIR`, und ohne die Variable findet
 * PipeWire seinen Socket nicht (`pw_context_connect() failed: Host is
 * down`). Sie steht hier zum dritten Mal, absichtlich wortnah — eine
 * gemeinsame Datei gibt es nicht, plugins/ und src/backend-player/ sind
 * getrennte Pakete.
 */
export function pwUmgebung(basis: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
  return { ...basis, XDG_RUNTIME_DIR: basis.XDG_RUNTIME_DIR || `/run/user/${uid}` }
}

/** Ist der Schalter gesetzt? Exakt `1`, siehe Kopfkommentar. */
export function cueErlaubt(umgebung: NodeJS.ProcessEnv = process.env): boolean {
  return umgebung[CUE_UMGEBUNGSSCHALTER] === CUE_EIN
}

/** Der echte Ausfuehrer: startet und schaut nicht zurueck. */
function echterAusfuehrer(protokoll?: (text: string) => void): Ausfuehrer {
  return (befehl) => {
    execFile(befehl.programm, [...befehl.argumente], { env: pwUmgebung(), timeout: 4000 }, (fehler) => {
      // Ein Fehlschlag beim Trennen heisst: der Ton laeuft weiter (harmlos).
      // Ein Fehlschlag beim Verbinden heisst: die Box koennte stumm bleiben.
      // Beides gehoert ins Protokoll, damit die Nummern zum Handaufraeumen
      // dastehen — unterschieden wird hier nicht, das tut der Aufrufer.
      if (fehler) protokoll?.(`Cue: ${befehl.programm} ${befehl.argumente.join(' ')} scheiterte: ${fehler.message}`)
    })
  }
}

/** Die echte Uhr. Kein `unref()` — Kopfkommentar, Sicherung 2c. */
const echteUhr: UhrStellen = (fn, ms) => {
  const griff = setTimeout(fn, ms)
  return { loeschen: () => clearTimeout(griff) }
}

/**
 * Einen Cue-Schalter erzeugen.
 *
 * Als Fabrik und NICHT als Modul-Singleton: ein Singleton mit einem
 * gespannten Zeitgeber waere zwischen zwei Tests nicht wieder sauber, und
 * im Dienst soll spaeter sichtbar sein, WER den Schalter haelt.
 */
export function erzeugeCueSchalter(gaben: CueSchalterGaben = {}): CueSchalter {
  const protokoll = gaben.protokoll
  const ausfuehrer = gaben.ausfuehrer ?? echterAusfuehrer(protokoll)
  const umgebung = gaben.umgebung ?? process.env
  const uhrStellen = gaben.uhrStellen ?? echteUhr
  const fristMs = gaben.fristMs ?? CUE_FRIST_MS

  /** Der Plan, der gerade getrennt ist — `null` heisst: es laeuft kein Cue. */
  let laufend: CuePlan | null = null
  let uhr: UhrGriff | null = null

  /** Alle Befehle absetzen; ein Wurf beendet die Reihe NICHT. */
  function absetzen(befehle: readonly Befehl[]): number {
    let fehlschlaege = 0
    for (const b of befehle) {
      try {
        ausfuehrer(b)
      } catch (f: unknown) {
        // Ein Ausfuehrer, der wirft (ENOENT: kein pw-link auf dieser Box),
        // darf die restlichen Kanten nicht mitreissen — und beim
        // Zurueckverbinden schon gar nicht.
        fehlschlaege++
        protokoll?.(`Cue: ${b.programm} ${b.argumente.join(' ')} warf: ${f instanceof Error ? f.message : String(f)}`)
      }
    }
    return fehlschlaege
  }

  function zurueckverbinden(anlass: string): CueErgebnis {
    const plan = laufend
    if (!plan) return { art: 'nichts-zu-tun', grund: 'es laeuft kein Cue' }
    // ZUERST den Zustand aufloesen: liefe `absetzen` in einen Wurf, darf
    // nicht ein zweiter Aufruf denselben Plan noch einmal herstellen wollen.
    laufend = null
    uhr?.loeschen()
    uhr = null
    const befehle = verbindBefehle(plan)
    const fehlschlaege = absetzen(befehle)
    protokoll?.(`Cue ${anlass}: ${befehle.length} Kante(n) zurueckverbunden — ${planBeschreiben(plan)}`)
    return { art: 'gewirkt', befehle, fehlschlaege }
  }

  function stumm(plan: CuePlan): CueErgebnis {
    if (!cueErlaubt(umgebung)) {
      protokoll?.(
        `Cue AUS (${CUE_UMGEBUNGSSCHALTER}!=${CUE_EIN}) — es wird nichts geschaltet. Geplant waere: ${planBeschreiben(plan)}`,
      )
      return { art: 'aus', grund: `${CUE_UMGEBUNGSSCHALTER} nicht gesetzt` }
    }
    if (laufend) {
      // Frist bleibt, wo sie ist — Kopfkommentar, Sicherung 2b.
      return { art: 'nichts-zu-tun', grund: 'es laeuft bereits ein Cue' }
    }
    if (plan.kanten.length === 0) {
      return { art: 'nichts-zu-tun', grund: 'der Plan hat keine Kante' }
    }

    // ERST merken und spannen, DANN trennen — Kopfkommentar, Sicherung 2a.
    laufend = plan
    uhr = uhrStellen(() => {
      protokoll?.(`Cue: Frist von ${fristMs} ms abgelaufen — RUECKVERBINDE-ZWANG greift`)
      zurueckverbinden('erzwungen')
    }, fristMs)

    const befehle = trennBefehle(plan)
    const fehlschlaege = absetzen(befehle)
    protokoll?.(`Cue AN: ${befehle.length} Kante(n) getrennt — ${planBeschreiben(plan)}`)
    return { art: 'gewirkt', befehle, fehlschlaege }
  }

  return {
    stumm,
    klar: () => zurueckverbinden('beendet'),
    istStumm: () => laufend !== null,
  }
}
