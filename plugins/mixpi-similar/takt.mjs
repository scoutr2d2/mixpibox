/**
 * Der Takt — Anfragen ausbremsen, bevor der Dienst es tut.
 *
 * ══ DER KONFLIKT, DEN DIESE DATEI SICHTBAR MACHT ══════════════════════════
 *
 * Zwei Zahlen aus zwei Welten treffen hier aufeinander:
 *
 *   MusicBrainz erlaubt      1 Anfrage / Sekunde
 *   Ein Plugin-Ruf hat       8 Sekunden (FRIST_MS im Wirt)
 *
 * Also passen in EINEN Ruf hoechstens sieben MusicBrainz-Anfragen, und wer
 * zwanzig Wachlisten-Eintraege in einem Ruf pruefen will, reisst die Frist —
 * und ein Fristriss terminiert den Worker samt allen offenen Rufen, nicht nur
 * den einen. Das ist der Grund, warum die Wachliste NICHT in einem Ruf
 * abgearbeitet wird, sondern im Hintergrund mit `last_geprueft` je Eintrag:
 * ein Durchlauf darf abbrechen und beim naechsten Mal weitermachen.
 *
 * WARTEN IST DESHALB KEINE LOESUNG, SONDERN EINE GEFAHR. Ein Eimer, der
 * beliebig lange wartet, verwandelt ein Rate-Limit in einen Fristriss. Deshalb
 * nimmt `nehmen()` eine Obergrenze und sagt NEIN, statt zu warten, wenn sie
 * nicht reicht. Ein "nein" ist eine Auskunft — der Aufrufer nimmt dann den
 * abgelaufenen Zwischenspeicher und meldet `stale`. Ein Fristriss ist keine
 * Auskunft, sondern ein toter Worker.
 *
 * ══ WARUM NICHT AUF 429 WARTEN UND WIEDERHOLEN ════════════════════════════
 *
 * Weil eine Wiederholschleife das Limit nicht einhaelt, sondern es ertastet —
 * sie erzeugt die Ueberlast, die sie dann abfaengt, und der Dienst sieht einen
 * Client, der gegen die Wand laeuft. Der Entwurf sagt es ausdruecklich:
 * durchgesetzt wird im Client, nicht durch Retry-Schleifen.
 */

/**
 * Ein Eimer je Dienst.
 *
 * Klassischer Token-Bucket: `menge` Marken laufen ueber `fensterMs` nach.
 * Deezer (~50 Anfragen / 5 s) und MusicBrainz (1 / 1 s) sind damit dieselbe
 * Sache mit anderen Zahlen.
 */
export class Eimer {
  #menge
  #fensterMs
  #marken
  #zuletzt

  constructor({ menge, fensterMs }) {
    this.#menge = Math.max(1, Number(menge) || 1)
    this.#fensterMs = Math.max(1, Number(fensterMs) || 1000)
    this.#marken = this.#menge
    this.#zuletzt = Date.now()
  }

  #nachfuellen() {
    const jetzt = Date.now()
    const vergangen = jetzt - this.#zuletzt
    if (vergangen <= 0) return
    this.#zuletzt = jetzt
    this.#marken = Math.min(this.#menge, this.#marken + (vergangen / this.#fensterMs) * this.#menge)
  }

  /** Wie lange es dauert, bis wieder eine Marke da ist (ms). */
  wartezeit() {
    this.#nachfuellen()
    if (this.#marken >= 1) return 0
    return Math.ceil(((1 - this.#marken) / this.#menge) * this.#fensterMs)
  }

  /**
   * Eine Marke nehmen — und dafuer hoechstens `hoechstensMs` warten.
   *
   * Zurueck kommt `true`, wenn die Anfrage rausgehen darf, sonst `false`.
   * Der Rueckgabewert ist zu PRUEFEN; wer ihn wegwirft, hat den Eimer
   * gebaut und nicht benutzt.
   */
  async nehmen(hoechstensMs = 0) {
    /* ══ EINMAL SCHLAFEN REICHT NICHT — DIE UHR IST GROBER ALS DIE RECHNUNG ══
     *
     * HIER STAND: warten ausrechnen, EINMAL so lange schlafen, nachfuellen,
     * und wenn dann noch keine Marke da ist, `false`. Das war um Haaresbreite
     * falsch, und die Breite war genau eine Millisekunde.
     *
     * `wartezeit()` rundet AUF (`Math.ceil`), aber `#nachfuellen()` rechnet
     * mit `Date.now()` — und ein `setTimeout(…, 50)` darf bei 49,7 ms feuern,
     * was als 49 gemessen wird. Dann sind 0,98 Marken da, `< 1` greift, und
     * der Aufrufer bekommt `false`, OBWOHL er reichlich Zeit mitgebracht hat.
     *
     * GEMESSEN (20.09.2026): der Zeuge „wartet, wenn es sich lohnt" faellt
     * etwa in jedem dritten Lauf — 500 ms Zeitbudget fuer ein 50-ms-Fenster,
     * also das Zehnfache dessen, was noetig waere. Im Betrieb heisst dasselbe:
     * eine Anfrage, die hinausgehen duerfte, wird verworfen, und das Plugin
     * laesst eine Empfehlung still aus. Ein Fehler, der nur unter Last
     * auftritt und nie eine Meldung erzeugt.
     *
     * JETZT WIRD BIS ZUM ZEITBUDGET WIEDERHOLT statt einmal zu raten. Das
     * ist auch die ehrlichere Auslegung von `hoechstensMs`: Der Aufrufer
     * sagt, wie lange er warten WILL — nicht, wie oft er es versuchen darf.
     * Die Frist bleibt hart: was darueber liegt, gibt weiter `false`
     * (ein Fristriss terminiert den Worker samt allen offenen Rufen).
     */
    const ende = Date.now() + Math.max(0, hoechstensMs)
    for (;;) {
      const warten = this.wartezeit()
      if (warten === 0) {
        this.#marken -= 1
        return true
      }
      // Passt die Wartezeit nicht mehr ins Budget, wird nicht gewartet.
      if (Date.now() + warten > ende) return false
      // MINDESTENS EINE MILLISEKUNDE: sonst drehte sich diese Schleife bei
      // einer Restwartezeit von 0,x ms ohne Pause und fraesse eine CPU.
      await new Promise((fertig) => setTimeout(fertig, Math.max(1, warten)))
    }
  }
}

/**
 * Ein Eimer je Quelle, gemeinsam fuer alle Rufe.
 *
 * MUSS EIN MODULZUSTAND SEIN, kein Feld im Kontext: der Kontext wird je Ruf
 * gebaut, und ein Eimer, der bei jedem Ruf neu voll ist, ist kein Limit,
 * sondern eine Verzierung. Der Worker lebt ueber alle Rufe hinweg (er wird
 * beim Laden gestartet, nicht beim Rufen) — deshalb traegt das Modul den
 * Zustand richtig.
 */
const eimer = new Map()

export function eimerFuer(quellenId, grenze) {
  let e = eimer.get(quellenId)
  if (!e) {
    e = new Eimer(grenze)
    eimer.set(quellenId, e)
  }
  return e
}

/** Nur fuer Zeugen: alle Eimer vergessen. */
export function eimerZuruecksetzen() {
  eimer.clear()
}
