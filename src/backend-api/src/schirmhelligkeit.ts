/**
 * Die Helligkeit des Bildschirms — die REGELN dazu, ohne Gerät.
 *
 * WAS DA GEREGELT WIRD: das Hintergrundlicht des Panels, nicht der Bildinhalt.
 * Der Kernel führt es unter /sys/class/backlight/<geraet>/brightness als ZAHL
 * von 0 bis `max_brightness`. AM GERÄT GEMESSEN (07.08.2026, Pi 5 .169, nur
 * gelesen):
 *
 *   /sys/class/backlight/11-0045/brightness      = 255   (-rw-r--r-- root:root)
 *   /sys/class/backlight/11-0045/max_brightness  = 255
 *   /sys/class/backlight/11-0045/bl_power        = 0
 *
 * `11-0045` ist die I2C-Adresse des Waveshare-Panels. Auf anderer Hardware
 * heißt das Verzeichnis anders (`rpi_backlight`, `10-0045`, `intel_backlight`)
 * oder es gibt gar keins (HDMI-Monitor). Deshalb steht hier NIRGENDS ein
 * fester Name — gesucht wird, und was nicht da ist, wird gesagt.
 *
 * WARUM EINE EIGENE DATEI: die Rechnerei Prozent ↔ Rohwert und die Untergrenze
 * sind die Stelle, an der man sich die Box unbedienbar machen kann. Sie
 * gehören dorthin, wo ein Test sie OHNE Panel festhalten kann. Was hier steht,
 * kennt keine Datei, keinen Prozess und kein Netz.
 *
 * WAS HIER BEWUSST FEHLT: `bl_power`. Diese Datei schaltet das Licht ganz aus
 * (4) und wieder an (0) — sie ist der Schalter, nicht der Regler. Der Weg zum
 * Ausschalten existiert schon (`timeout.idleDisplayOff` und der Monitorwächter
 * `mupi_check_monitor`; der dritte Weg dorthin, eine eigene Route über
 * `xset dpms`, ist am 19.09.2026 mangels Rufer gefallen). Ein zweiter Weg im
 * Regler, der dasselbe anders macht, wäre eine
 * zweite Wahrheit über einen Bildschirm, der aus ist. Gelesen wird sie — damit
 * die Verwaltung sagen kann „der Schirm ist gerade ganz aus, der Regler wirkt
 * erst danach" —, geschrieben nie.
 */

/**
 * ══ DIE UNTERGRENZE ══════════════════════════════════════════════════════
 *
 * NULL IST EIN SCHWARZES DISPLAY, UND EIN SCHWARZES DISPLAY IST EINE KAPUTTE
 * BOX. Wer den Regler am Gerät ganz nach links zieht, sieht danach nichts mehr
 * — auch nicht den Regler, mit dem er es rückgängig machen könnte. Die Box
 * wäre nur noch über SSH zu retten, und wer eine Kinderbox betreibt, hat kein
 * SSH. Es gibt also eine Grenze, und sie steht HIER und nicht in der
 * Oberfläche: eine Oberfläche kann man umgehen, indem man den Endpunkt direkt
 * ruft (die neue Oberfläche läuft ohne Anmeldung im selben Netz).
 *
 * WARUM 20 % UND NICHT WENIGER — die Grenze muss nicht „gibt noch Licht ab"
 * heißen, sondern „ist in einem normal beleuchteten Zimmer noch LESBAR".
 * Sonst ist der Endzustand derselbe: das Kind sieht ein schwarzes Rechteck und
 * kommt nicht zurück. Der einzige belegte Datenpunkt im Baum ist die alte
 * Oberfläche (AdminInterface/www/mupi.php, „Display settings → Brightness"):
 * sie bot 0/20/40/60/80/100 % an, also 0/51/102/153/204/255 als Rohwert. 20 %
 * ist die NIEDRIGSTE Stufe, die dort jahrelang ausgeliefert wurde und über die
 * sich niemand beschwert hat — unterhalb davon gibt es keinerlei Beleg, dass
 * jemand den Schirm noch lesen konnte. (Die 0 daneben ist genau die Falle, die
 * hier zugemacht wird: mupi.php ließ sie zu.)
 *
 * WAS DAS NICHT VERBIETET: eine spätere ZEITGESTEUERTE Nachtabsenkung darf
 * tiefer gehen — sie kommt von allein zurück, und niemand muss im Dunkeln
 * einen Regler finden. Diese Grenze gilt für das, was ein Mensch von Hand
 * einstellt und stehenlässt. Wer die Nachtabsenkung baut, gibt ihr eine eigene
 * Untergrenze (> 0) und einen Wecker, aber nicht diese hier.
 */
export const PROZENT_MIN = 20

/** Voll aufgedreht. Der Rohwert dazu ist immer genau `max_brightness`. */
export const PROZENT_MAX = 100

/**
 * Schrittweite des Reglers.
 *
 * 5 % ergibt 17 Rasterpunkte zwischen 20 und 100 — fein genug, dass man eine
 * Änderung sieht, grob genug, dass man einen Wert mit dem Finger wieder trifft.
 * Steht hier und nicht in der Oberfläche, damit die Box-Oberfläche später
 * dieselbe Rasterung benutzt, ohne sie neu zu erfinden.
 */
export const PROZENT_SCHRITT = 5

/** Was die Verwaltung anzeigt, wenn diese Hardware kein Hintergrundlicht hat. */
export const OHNE_GERAET =
  'Dieser Bildschirm lässt sich nicht dimmen — die Box findet kein regelbares Hintergrundlicht (typisch bei HDMI-Monitoren).'

/**
 * Ist das ein plausibler Name eines Backlight-Verzeichnisses?
 *
 * NICHT KOSMETIK, SONDERN DIE SPERRE GEGEN PFADE: aus diesem Namen wird ein
 * Dateipfad gebaut, der als root beschrieben wird. Erlaubt sind Buchstaben,
 * Ziffern und `_ . : -` — genau das, was Kernel-Treiber vergeben
 * (`11-0045`, `rpi_backlight`, `intel_backlight`, `acpi_video0`). Ein `/`
 * oder `..` fällt damit durch, ebenso der führende Punkt.
 */
export function istGeraeteName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(name)
}

/**
 * ALLE brauchbaren Einträge von /sys/class/backlight, beste zuerst. Pure.
 *
 * AN DER BOX GIBT ES GENAU EINEN, und das ist der Normalfall. Trotzdem wird
 * hier bestimmt und nicht geraten: `readdir` gibt die Namen in der Reihenfolge
 * des Dateisystems zurück, nicht sortiert. Ein Regler, der nach einem Neustart
 * ein anderes Panel bedient als vorher, wäre nicht zu verstehen.
 *
 * REIHENFOLGE: erst die bekannten Panel-Treiber der Box (Waveshare/DSI hängt
 * als I2C-Gerät `<bus>-<adresse>` dort, das offizielle 7"-Panel als
 * `rpi_backlight`), dann alles Übrige alphabetisch. `acpi_video*` steht ganz
 * hinten: auf einem Entwicklungsrechner ist das der Laptopschirm, und der ist
 * hier nie gemeint.
 *
 * WARUM EINE LISTE UND NICHT EIN NAME (nachgetragen 07.08.2026, gemessen mit
 * tools/schirm-helligkeit-loch.mjs): vorher gab diese Stelle GENAU EINEN Namen
 * heraus, und wer ihn bekam, hatte keinen zweiten Versuch. Legt man neben das
 * echte Panel `11-0045` einen zweiten Eintrag, der kein `max_brightness` hat —
 * eine leere Datei `09-0045` genügt, sie steht alphabetisch davor —, dann
 * antwortete der ganze Weg mit „Dieser Bildschirm lässt sich nicht dimmen",
 * obwohl das Panel danebenlag. Die Auswahl ist eine RANGFOLGE, keine
 * Entscheidung; ob ein Eintrag wirklich etwas kann, weiss erst, wer ihn
 * aufmacht.
 */
export function geraeteNachRang(namen: readonly unknown[]): string[] {
  const rang = (n: string): number => {
    if (/^\d+-[0-9a-f]{4}$/i.test(n)) return 0
    if (n === 'rpi_backlight' || n === '10-0045' || n === '11-0045') return 0
    if (/^acpi_video/.test(n)) return 3
    return 1
  }
  return namen.filter(istGeraeteName).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
}

/** Der erste Anwärter. Nur für Aufrufer, die wirklich nur einen wollen. */
export function waehleGeraet(namen: readonly unknown[]): string | null {
  return geraeteNachRang(namen)[0] ?? null
}

/**
 * Eine Zahl aus einer sysfs-Datei lesen. Pure.
 *
 * sysfs liefert „255\n". Alles, was keine nicht-negative ganze Zahl ist, gilt
 * als „nicht lesbar" — lieber gar keine Aussage als eine erfundene.
 */
export function leseZahl(text: unknown): number | null {
  const t = String(text ?? '').trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * `max_brightness` prüfen. Pure.
 *
 * 0 wäre ein Gerät, das nur „aus" kann — damit lässt sich nichts regeln, und
 * jede Rechnung darauf würde durch null teilen.
 *
 * UND 1 IST GENAUSO WENIG EIN REGELBEREICH, auch wenn die Zahl das nicht
 * verrät. Ein Treiber mit `max_brightness` = 1 kennt genau zwei Zustände: 0
 * (aus — das darf hier nie herauskommen) und 1. Jeder erlaubte Prozentwert
 * landet damit auf demselben Rohwert 1. Der Regler ließe sich ziehen, die
 * Zahl daneben liefe von 20 auf 100, und am Bildschirm passierte NICHTS —
 * genau der stille Regler, den es nicht geben soll. Am nachgestellten Gerät
 * gemessen (07.08.2026): 20 % und 100 % schrieben beide die 1.
 *
 * Solche Geräte melden sich deshalb als „kein regelbares Hintergrundlicht",
 * und die Verwaltung schreibt den Satz hin, statt einen Schieber zu zeichnen.
 * Das ist die ehrliche Auskunft: an/aus KANN diese Hardware, aber dimmen
 * nicht — und an/aus regeln `timeout.idleDisplayOff` und `mupi_check_monitor`.
 *
 * Ab 2 gibt es wirklich zwei verschiedene Helligkeiten (20 % → 1, 100 % → 2),
 * und der Regler tut sichtbar etwas.
 */
export function pruefeMaxRoh(text: unknown): number | null {
  const n = leseZahl(text)
  return n !== null && n >= 2 ? n : null
}

/**
 * Der KLEINSTE Rohwert, der gesetzt werden darf. Pure.
 *
 * Zwei Sperren übereinander, und beide sind nötig:
 *
 *   `Math.round(PROZENT_MIN/100 * maxRoh)`  — die eigentliche Grenze.
 *   `Math.max(1, …)`                        — für Panels mit winzigem
 *                                             Wertebereich. Es gibt Treiber
 *                                             mit `max_brightness` = 7 oder 9;
 *                                             dort ergäbe 20 % gerundet
 *                                             durchaus 1, bei max_brightness=2
 *                                             aber 0 — und 0 ist genau das,
 *                                             was hier nie herauskommen darf.
 */
export function rohUntergrenze(maxRoh: number): number {
  return Math.max(1, Math.round((PROZENT_MIN / 100) * maxRoh))
}

/** Prozent in den Wertebereich zwingen. Pure. */
export function klemmeProzent(prozent: number): number {
  if (!Number.isFinite(prozent)) return PROZENT_MAX
  return Math.min(PROZENT_MAX, Math.max(PROZENT_MIN, Math.round(prozent)))
}

/**
 * Prozent → Rohwert. Pure.
 *
 * DIE REIHENFOLGE IST DIE AUSSAGE: erst klemmen, dann rechnen, dann NOCH EINMAL
 * gegen die Untergrenze und gegen `maxRoh` prüfen. Der zweite Riegel ist keine
 * Verdopplung des ersten — er fängt die Rundung ab (siehe `rohUntergrenze`).
 *
 * 100 % ergibt IMMER genau `maxRoh`, nicht `maxRoh - 1`: ein Regler, der ganz
 * rechts nicht ganz hell ist, sieht nach einem Fehler aus.
 */
export function prozentZuRoh(prozent: number, maxRoh: number): number {
  const p = klemmeProzent(prozent)
  const roh = Math.round((p / 100) * maxRoh)
  return Math.min(maxRoh, Math.max(rohUntergrenze(maxRoh), roh))
}

/**
 * Rohwert → Prozent. Pure.
 *
 * ZUM ANZEIGEN, nicht zum Rechnen. Das Ergebnis wird bewusst in denselben
 * Bereich geklemmt wie die Eingabe: findet die Verwaltung eine Box vor, deren
 * Hintergrundlicht von woanders auf 5 herabgesetzt wurde (Kernel-Vorgabe,
 * fremdes Skript), zeigt der Regler 20 % — den kleinsten Wert, den er SETZEN
 * kann. Ein Regler, der einen Wert anzeigt, den er nicht wieder herstellen
 * kann, ist eine Lüge über den eigenen Wertebereich.
 *
 * DAS KLEMMEN BLEIBT — ABER ES MUSS DAZUGESAGT WERDEN. Am nachgestellten Panel
 * gemessen (07.08.2026): `brightness` = 0 bei `max_brightness` = 255 ergab hier
 * 20. Wer die Verwaltung am zweiten Rechner offen hat, liest „20 %" und hält
 * das für in Ordnung, während vor dem Kind ein schwarzes Rechteck steht. Der
 * Fall ist nicht ausgedacht: die alte Oberfläche (AdminInterface/www/mupi.php)
 * bietet weiterhin 0 % an und schreibt dann eine 0 in dieselbe Datei.
 *
 * Deshalb gibt es daneben `unterUntergrenze` und `prozentUngeklemmt`. Diese
 * Funktion sagt, WO DER REGLER STEHEN DARF; jene sagen, WO DER SCHIRM WIRKLICH
 * STEHT. Beides gehört in die Antwort, sonst ist die eine Zahl eine Lüge.
 */
export function rohZuProzent(roh: number, maxRoh: number): number {
  if (!Number.isFinite(roh) || maxRoh < 1) return PROZENT_MAX
  return klemmeProzent((roh / maxRoh) * 100)
}

/**
 * Steht das Gerät UNTER dem, was dieser Regler je einstellen könnte? Pure.
 *
 * Die Frage ist am ROHWERT zu stellen und nicht an den Prozenten: die
 * Prozentzahl aus `rohZuProzent` ist ja bereits geklemmt und kann den
 * Unterschied gar nicht mehr zeigen — das ist genau der Befund.
 *
 * Verglichen wird gegen `rohUntergrenze`, also gegen denselben Wert, den ein
 * PUT mit `PROZENT_MIN` schreiben würde. Ein Gerät, das exakt dort steht, ist
 * NICHT geklemmt: der Regler zeigt dann die Wahrheit.
 */
export function unterUntergrenze(roh: unknown, maxRoh: number): boolean {
  if (typeof roh !== 'number' || !Number.isFinite(roh) || !Number.isFinite(maxRoh) || maxRoh < 1) return false
  return roh < rohUntergrenze(maxRoh)
}

/**
 * Rohwert → Prozent, OHNE Klemmen. Pure. Nur zum HINSCHREIBEN, nie zum Setzen.
 *
 * Das ist die Zahl, die der Mensch braucht, um zu verstehen, warum er nichts
 * sieht: „der Schirm steht wirklich auf 0 %". Sie darf nirgends in
 * `prozentZuRoh` zurückfliessen — täte sie das, wäre die Untergrenze weg.
 *
 * Aufgerundet wird bewusst NICHT: aus einem Rohwert von 1 bei 255 würde sonst
 * „1 %" und damit der Eindruck, da sei noch etwas. `Math.round` macht daraus
 * 0 — und 0 ist die ehrlichere Auskunft über einen Schirm, den niemand lesen
 * kann.
 */
export function prozentUngeklemmt(roh: number, maxRoh: number): number {
  if (!Number.isFinite(roh) || !Number.isFinite(maxRoh) || maxRoh < 1) return PROZENT_MAX
  return Math.max(0, Math.min(PROZENT_MAX, Math.round((roh / maxRoh) * 100)))
}

export type Pruefung = { ok: true; wert: number } | { ok: false; grund: string }

/**
 * Was von außen hereinkommt, prüfen. Pure.
 *
 * ABLEHNEN STATT STILL KLEMMEN: `prozentZuRoh` klemmt zwar ohnehin, aber ein
 * Aufrufer, der 0 schickt und 200 OK zurückbekommt, glaubt danach, die Box
 * stehe auf 0. Beim nächsten Lesen steht 20 da, und niemand versteht, warum.
 * Die Oberfläche kann 0 gar nicht erst anbieten; wer es trotzdem schickt, hat
 * einen Fehler und soll ihn erfahren.
 *
 * Zeichenketten sind erlaubt („60"), weil in dieser Konfiguration Zahlen als
 * Zeichenketten stehen und derselbe Wert von dort zurückkommt.
 */
export function pruefeProzent(roh: unknown): Pruefung {
  const n = typeof roh === 'string' && roh.trim() !== '' ? Number(roh) : roh
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { ok: false, grund: 'Helligkeit muss eine Zahl in Prozent sein' }
  }
  const g = Math.round(n)
  if (g < PROZENT_MIN) {
    return {
      ok: false,
      grund: `Weniger als ${PROZENT_MIN} % ist nicht einstellbar — ein dunkler Bildschirm lässt sich am Gerät nicht mehr zurückdrehen`,
    }
  }
  if (g > PROZENT_MAX) return { ok: false, grund: `Mehr als ${PROZENT_MAX} % gibt es nicht` }
  return { ok: true, wert: g }
}

/**
 * Der Wert, der aus der Konfiguration kommt, für die Anwendung beim Start.
 *
 * NACHSICHTIG, WEIL NIEMAND DABEI IST: fehlt der Schlüssel (jede Box, die
 * update/conf_update.sh noch nicht gesehen hat), gilt VOLLE HELLIGKEIT — das
 * ist der Zustand, den der Kernel ohnehin herstellt, und der einzige, der
 * nie nach einem Defekt aussieht. Steht dort Unsinn, ebenso. Was hier
 * herauskommt, wird ohne weitere Rückfrage auf ein Gerät geschrieben.
 */
export function gespeicherteProzent(wert: unknown): number {
  const p = pruefeProzent(wert)
  return p.ok ? p.wert : PROZENT_MAX
}
