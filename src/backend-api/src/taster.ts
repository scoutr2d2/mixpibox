/**
 * Der Austaster — was ein Druck BEDEUTET, ohne Gerät.
 *
 * WOZU ES DIESE DATEI GIBT: Auf dem Schirm soll ein Ring zeigen, dass der
 * Knopf gedrückt ist und WIE LANGE NOCH bis zum Herunterfahren. Damit dieser
 * Ring nicht lügt, muss er dieselbe Schwelle meinen wie das Skript, das
 * tatsächlich abschaltet — `scripts/OnOffShim/off_trigger.sh`. Zwei Wahrheiten
 * über eine Schaltschwelle wären schlimmer als gar keine Anzeige: ein Ring,
 * der bei 2 s voll ist, während das Skript bei 3 s schaltet, macht aus einer
 * Hilfe eine Irreführung.
 *
 * ══ WARUM DAS ÜBERHAUPT GEBRAUCHT WIRD (gemessen am 31.08.2026, Box .79) ══
 *
 * Auf dieser Pi-4-Box las den Taster NIEMAND: `mupi_offtrigger` war disabled,
 * postboot.d leer, kein `gpio-shutdown`-Overlay, und GPIO17 stand in
 * /sys/kernel/debug/gpio ohne Besitzer. Ein kurzer Druck bewirkte nichts; was
 * blieb, war der 6-Sekunden-Griff des MuPiHAT an J1 — hart, an jeder Software
 * vorbei, mitten in Schreibvorgänge hinein.
 *
 * DANN WURDE MITGESCHRIEBEN, was ein Mensch am Gerät wirklich tut
 * (tools/taster-druck-mitschnitt.sh, 27 Drücke in 40 Sekunden):
 *
 *     kürzester 116 ms · Median 432 ms · längster 2827 ms
 *     über der Schwelle von 2000 ms:  1 von 27
 *
 * DAS IST DIE GANZE BEGRÜNDUNG FÜR DEN RING. Der Betreiber drückt im Median
 * 432 ms und liegt damit um den Faktor fünf unter der Schwelle. Er kann das
 * nicht wissen, weil nichts es ihm sagt — die Box sieht beim 400-ms-Druck
 * genauso aus wie beim 1900-ms-Druck. Eine Anzeige, die nur „gedrückt" blinkt,
 * beantwortet die falsche Frage; gebraucht wird „noch so lange".
 *
 * ══ WAS HIER BEWUSST NICHT STEHT ═════════════════════════════════════════
 *
 * Das LESEN der Leitung. Das tut `taster_wache.py` unter `off_trigger.sh`, und
 * zwar als EINZIGER — GPIO17 lässt sich nur einmal beanspruchen. Ein zweiter
 * Leser im Server nähme dem Ausschalter die Leitung weg und die Box wäre
 * wieder da, wo sie herkam. Der Server liest deshalb nur MIT, über die
 * Zustandsdatei, die die Wache ohnehin schreibt.
 *
 * Und das MELDEROHR (/run/mupibox/taster.melderohr) wird nicht angefasst.
 * Daraus liest `off_trigger.sh`; zwei Leser an einer FIFO teilen sich die
 * Bytes, und die Hälfte der Flanken käme beim Ausschalter nie an. Eine
 * Anzeige, die den Ausschalter kaputtmacht, den sie erklären soll, wäre der
 * teuerste denkbare Fehler.
 */

/**
 * ══ DIE VIER STUFEN ══════════════════════════════════════════════════════
 *
 * `off_trigger.sh` lässt am Ende seiner Prüfung GENAU diese vier Zahlen durch
 * (Zeile 244, `case "${wert}" in 2|3|4|5`) und behält bei allem anderen den
 * zuletzt gültigen Wert. Die Liste steht hier ein zweites Mal, und das ist
 * eine Doppelung mit Ansage: `taster.deckung.spec.ts` liest das Skript und
 * fällt durch, wenn die beiden auseinanderlaufen.
 *
 * WARUM NICHT AUS DEM SKRIPT LESEN statt zu doppeln: Das Skript liegt auf der
 * Box unter /usr/local/bin/mupibox/ und im Baum unter scripts/ — und
 * `scripts/` ist im Auslieferweg nicht enthalten, die beiden können also
 * verschieden alt sein. Ein Server, der seine Schwelle aus einer Datei liest,
 * die er nicht mitliefert, hätte eine Wahrheit, die vom Zufall abhängt.
 */
export const HALTEDAUER_STUFEN = [2, 3, 4, 5] as const

/**
 * Was gilt, wenn in der Konfiguration Unsinn steht.
 *
 * DIESELBE ZAHL WIE IM SKRIPT (`PRESS_DELAY=3`, Zeile 120) und aus demselben
 * Grund: Sie ist der mittlere der vier Werte. Wer sich verstellt, landet nicht
 * am gefährlichen Ende.
 *
 * NICHT die 2 aus der ausgelieferten Vorlage. Die 2 ist der EINGESTELLTE Wert
 * einer frisch aufgesetzten Box; die 3 ist, was gilt, wenn die Einstellung
 * unlesbar ist. Das sind zwei verschiedene Fragen, und sie hier zusammenfallen
 * zu lassen hieße, einen kaputten Wert wie eine bewusste Wahl zu behandeln.
 */
export const HALTEDAUER_VORGABE = 3

/**
 * Die Haltedauer in Sekunden — aus dem, was in `shim.pressDelay` steht.
 *
 * ES WIRD NICHT GERECHNET, ES WIRD VERGLICHEN. Das Skript kam an genau dieser
 * Stelle schon einmal zu Fall: `[ "2.25" -lt 2 ]` sagt nicht „nein", sondern
 * gibt 2 zurück und schreibt „integer expression expected" — für ein `if` sieht
 * das aus wie „Bedingung nicht erfüllt", der Riegel FÄLLT AUS statt zu greifen.
 * Danach zählte `for ((i=0; i<2.25; i++))` gar nicht erst, und die Box fuhr
 * beim kürzesten Antippen herunter (siehe `mupi-haltedauer-bruchzahl` im
 * Wissenspaket).
 *
 * HIER GILT DASSELBE IN ANDERER SPRACHE: `Number("2.25")` ist 2.25 und
 * `parseInt("2.25")` ist 2 — derselbe Wert, zwei Ergebnisse, je nachdem wie
 * man fragt. Deshalb wird der Wert auf Zugehörigkeit zu den vier Stufen
 * geprüft und sonst verworfen. Ein Vergleich auf Gleichheit kann nicht
 * halb misslingen.
 */
export function haltedauerSekunden(roh: unknown): number {
  // Zahl und Zeichenkette kommen beide vor: die alte PHP-Oberfläche schrieb
  // "2", die neue Verwaltung schickt je nach Weg 2 oder "2". Beide Formen
  // müssen zum selben Ergebnis führen — genau daran ist `pruefeFeld` in
  // konfiguration.ts schon einmal gescheitert (dort ließ eine ZAHL 2.25
  // unverändert durch, während eine ZEICHENKETTE "2.25" per parseInt auf 2
  // gekürzt wurde).
  const text = typeof roh === 'number' ? String(roh) : typeof roh === 'string' ? roh.trim() : ''
  for (const stufe of HALTEDAUER_STUFEN) {
    if (text === String(stufe)) return stufe
  }
  return HALTEDAUER_VORGABE
}

/**
 * Der Stand der Leitung, wie ihn die Wache in die Zustandsdatei schreibt.
 *
 * `null` heißt NICHT „losgelassen", sondern „ich weiß es nicht" — die Wache
 * läuft nicht, die Datei fehlt, oder es steht etwas Unerwartetes darin. Das
 * ist ein eigener Zustand und muss einer bleiben: Eine Anzeige, die bei
 * fehlender Wache „nicht gedrückt" behauptet, sagt genau dann etwas Falsches,
 * wenn der Ausschalter kaputt ist — also in dem einzigen Fall, in dem es
 * darauf ankommt.
 */
export type TasterStand = 'gedrueckt' | 'los' | null

/**
 * Was in der Zustandsdatei steht, gedeutet.
 *
 * DIE LEITUNG IST INVERTIERT, und das ist keine Konvention, sondern gemessen:
 * GPIO17 hat einen Hochzieher, im Ruhezustand liest sie 1. Der Taster zieht
 * gegen Masse — gedrückt ist also 0. Die Wache meldet den Druck folgerichtig
 * als FALLENDE Flanke.
 *
 *     31.08.2026, Box .79:  GPIO17 (Ruhe) = 1
 *     /sys/kernel/debug/gpio:  gpio-17 (GPIO17 |lg) in hi IRQ
 *
 * Die Wache schreibt mit abschließendem Zeilenumbruch (`f"{stand}\n"`), und
 * die Datei ist deshalb 2 Bytes groß. Das `trim()` ist also nicht Vorsicht,
 * sondern notwendig.
 */
export function standDeuten(inhalt: string | null | undefined): TasterStand {
  if (typeof inhalt !== 'string') return null
  const t = inhalt.trim()
  if (t === '0') return 'gedrueckt'
  if (t === '1') return 'los'
  return null
}

/**
 * WO die Haltedauer in mupiboxconfig.json steht.
 *
 * `timeout.pressDelay` — und das ist die unintuitive Stelle. Der Abschnitt
 * `shim` führt alles andere zum Ausschalter (`triggerPin`, `poweroffPin`,
 * `cutPin`, `ledPin`) und sieht deshalb wie der richtige Ort aus. Die
 * Haltedauer liegt daneben, bei den Zeiten.
 *
 * AM 31.08.2026 IST GENAU DAS SCHIEFGEGANGEN: Der Server las `shim.pressDelay`,
 * bekam `undefined`, fiel still auf die Vorgabe zurück und meldete dem Schirm
 * 3 Sekunden — während `off_trigger.sh` bei 2 Sekunden abschaltete. Kein
 * Fehler, keine Warnung, nur eine Zahl, die zu nichts passte. Gefunden wurde
 * es erst am Gerät, nach dem Ausliefern.
 *
 * Die Konstante steht hier, damit `taster.deckung.spec.ts` sie gegen die
 * `jq`-Zeile in `off_trigger.sh` halten kann — und `haltedauerAusKonfig()`
 * unten benutzt sie WIRKLICH, statt sie nur zu behaupten. Eine Konstante, die
 * bewacht wird, aber niemanden steuert, ist Deko.
 */
export const KONFIG_PFAD_HALTEDAUER = 'timeout.pressDelay'

/**
 * Die Haltedauer aus der ganzen Konfiguration — über den Pfad oben.
 *
 * Nimmt die GESAMTE Konfiguration, nicht schon den herausgegriffenen Wert.
 * Genau dieses Herausgreifen war der Fehler: Es geschah beim Aufrufer, wo
 * keine Wache hinsieht.
 */
export function haltedauerAusKonfig(konfig: unknown): number {
  let stelle: unknown = konfig
  for (const teil of KONFIG_PFAD_HALTEDAUER.split('.')) {
    if (typeof stelle !== 'object' || stelle === null) return HALTEDAUER_VORGABE
    stelle = (stelle as Record<string, unknown>)[teil]
  }
  return haltedauerSekunden(stelle)
}

/** Was der Schirm braucht, um den Ring zu zeichnen. */
export interface TasterLage {
  /** Gedrückt, losgelassen — oder unbekannt, weil niemand die Leitung liest. */
  stand: TasterStand
  /** Ab wann der Ring voll ist und die Box herunterfährt, in Millisekunden. */
  haltedauerMs: number
}

/**
 * Die Lage aus Dateiinhalt und GANZER Konfiguration.
 *
 * Beide Teile kommen aus verschiedenen Quellen und können unabhängig
 * voneinander fehlen — deshalb eine Funktion, die beide Lücken kennt, statt
 * zweier Aufrufe, deren Zusammenspiel niemand prüft.
 *
 * ══ WARUM DIE GANZE KONFIGURATION UND NICHT DER FERTIGE WERT ═════════════
 *
 * Hier stand `pressDelayRoh: unknown`, und der Aufrufer griff sich den Wert
 * selbst heraus — mit `konfig?.shim?.pressDelay`, also am falschen Ort. Das
 * ergab `undefined`, der Rückfall auf die Vorgabe griff lautlos, und der Ring
 * zeigte eine Schwelle, bei der nichts passierte.
 *
 * DAS WAR KEIN TIPPFEHLER, SONDERN EINE OFFENE STELLE: Solange der Aufrufer
 * den Pfad wählt, kann er ihn falsch wählen, und keine Wache sieht dort hin —
 * der Integrationstest schrieb dieselbe falsche Annahme in seine
 * Testkonfiguration und bestätigte sie. Seit die ganze Konfiguration
 * hereingereicht wird, gibt es die Wahl nicht mehr: Der Pfad steht an genau
 * einer Stelle (`KONFIG_PFAD_HALTEDAUER`), und die wird gegen `off_trigger.sh`
 * gehalten.
 */
export function lageBilden(zustandsInhalt: string | null | undefined, konfig: unknown): TasterLage {
  return {
    stand: standDeuten(zustandsInhalt),
    haltedauerMs: haltedauerAusKonfig(konfig) * 1000,
  }
}
