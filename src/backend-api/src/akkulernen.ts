/**
 * Aus dem eigenen Verlauf LERNEN, statt zu raten.
 *
 * WAS BISHER GERATEN WAR: der Innenwiderstand des Packs (fest 70 mOhm, ein
 * Erfahrungswert) und seine Kapazitaet (aus dem NAMEN des Akkuprofils
 * gelesen — "10.000mAh"). Beides bestimmt, was die Box anzeigt: der
 * Widerstand die Lastkorrektur, die Kapazitaet die Restzeit. Beides ist am
 * echten Pack messbar, sobald genug aufgezeichnet ist.
 *
 * WARUM DAS UEBERHAUPT GEHT, obwohl der BQ25792 kein Fuel-Gauge ist: er misst
 * Strom. Wer Strom UND Zeit hat, kann die Ladungsmenge selbst aufsummieren -
 * das ist ein Coulomb-Zaehler in Software, gebaut aus unserer eigenen Reihe.
 * Der Chip zaehlt nicht; wir zaehlen.
 *
 * WAS ES NICHT KANN: aus wenigen Minuten gleichbleibender Last laesst sich
 * NICHTS lernen. Der Widerstand braucht Lastwechsel, die Kapazitaet einen
 * ordentlichen Hub im Ladestand. Wo die Daten nicht reichen, gibt es `null`
 * und nicht etwa eine schwach begruendete Zahl - eine gelernte Zahl, die
 * schlechter ist als der Erfahrungswert, waere ein Rueckschritt.
 *
 * REIN: kein Netz, kein Dateizugriff, keine Uhr.
 */

import type { Punkt } from './akkuverlauf'

/**
 * AB WELCHEM STROM ETWAS ALS LADEN ZAEHLT (mA).
 *
 * DIESELBE SCHWELLE WIE `RUHE_SCHWELLE` in akkuverlauf.ts — und sie steht hier
 * ABGESCHRIEBEN statt importiert. Der Grund ist keine Bequemlichkeit: dieses
 * Modul haelt bisher NUR einen Typ-Import zu akkuverlauf, und ein Typ
 * verschwindet beim Uebersetzen. Ein Wert-Import waere der erste echte, und
 * die Werkzeuge in tools/ laden diese Datei mit blankem `node` — das loest
 * einen Import ohne Dateiendung nicht auf, waehrend esbuild und tsx es tun.
 * Eine Abschrift, die eine ROTE PRUEFUNG hat, ist billiger als ein Import, der
 * ein Werkzeug erst beim Aufruf umwirft.
 *
 * DIE PRUEFUNG IST DER PREIS: akkulernen.spec.ts haelt die beiden Zahlen
 * gegeneinander. Wer drueben etwas aendert, sieht hier rot.
 */
export const LADE_SCHWELLE_MA = 20

export interface Gelernt {
  /** Gemessener Innenwiderstand in Milliohm, oder null. */
  rMilliOhm: number | null
  /** Wie viele Lastwechsel dahinterstehen (je mehr, desto belastbarer). */
  rPaare: number
  /** Gemessene Kapazitaet in mAh, oder null. */
  kapazitaetMah: number | null
  /** Wie viel Ladestand die groesste verwendete Entladung umspannte (Prozentpunkte). */
  kapazitaetHub: number
  /** Wie viele ENTLADUNGEN in die Kapazitaet eingegangen sind. */
  kapazitaetEntladungen: number
  /**
   * WOHER DIE ZAHL KOMMT, mit der die Restzeit gerechnet wird.
   *
   * `gemessen`  aus eigenen Entladungen dieses Packs.
   * `aufkleber` aus dem Namen des Akkuprofils — eine frische Box hat noch
   *             keine brauchbare Entladung gesehen, und bis dahin ist der
   *             Aufdruck das Beste, was sie hat. Er GEHOERT dann aber
   *             angeschrieben: eine Zahl vom Aufkleber sieht am Schirm genau
   *             so aus wie eine gemessene, und wer das nicht weiss, haelt
   *             eine Herstellerangabe fuer eine Messung an SEINEM Pack.
   * `null`      es gibt weder das eine noch das andere.
   */
  kapazitaetQuelle: 'gemessen' | 'aufkleber' | null
  /** Insgesamt bewegte Ladungsmenge in der Reihe (mAh, Betrag). */
  ladungMah: number
  /** Wie weit die Box mit dem Lernen ist. */
  stand: 'nichts' | 'wenig' | 'brauchbar'
}

/** Groesster Zeitabstand, ueber den noch integriert wird (ms). */
export const LUECKE_MAX_MS = 15 * 60_000

/** Fuer den Widerstand: hoechstens so weit auseinander (ms). */
const R_ABSTAND_MAX_MS = 3 * 60_000
/** Fuer den Widerstand: mindestens so viel Stromaenderung (mA). */
const R_SPRUNG_MIN_MA = 150
/** Plausibler Bereich fuer einen 2S-Pack (mOhm). */
const R_MIN = 10
const R_MAX = 500

/** Fuer die Kapazitaet: mindestens so viel Hub im Ladestand (Prozentpunkte). */
const KAP_HUB_MIN = 20
/** Fuer die Kapazitaet: mindestens so lange (ms). */
const KAP_DAUER_MIN_MS = 15 * 60_000
/**
 * Hoechstens so viele Entladungen gehen in den Median ein — die JUENGSTEN.
 *
 * Ein Akku altert. Nimmt man alles, was in sieben Tagen aufgezeichnet wurde,
 * ist das heute belanglos (sieben Tage altern nichts); nimmt man spaeter
 * einmal eine laengere Reihe, waere eine Entladung von vor einem Jahr ein
 * Gewicht gegen die Gegenwart. Fuenf sind genug fuer einen stabilen Median
 * und kurz genug, um dem Pack zu folgen.
 */
const KAP_ENTLADUNGEN_MAX = 5
/**
 * WIE WEIT DARF DAS ERGEBNIS VOM AUFKLEBER ABWEICHEN.
 *
 * Die alte Pruefung liess 20 % bis 200 % durch, und genau deshalb ist der
 * Fehler des Betreibers durchgekommen: 4859 mAh gegen einen 10-Ah-Aufkleber
 * sind 49 % — glatt im erlaubten Bereich, und trotzdem falsch um mehr als
 * das Doppelte.
 *
 * ENG GENUG, UM MESSFEHLER ZU FANGEN, WEIT GENUG FUER ALTERUNG: Ein drei
 * Jahre alter 10-Ah-Pack hat echte 6 Ah, und das ist KEIN Messfehler, sondern
 * genau die Auskunft, um derentwillen ueberhaupt gemessen wird. 50 % lassen
 * dafuer noch Luft; darunter waere ein Pack so hinueber, dass die Box damit
 * keine Stunde mehr liefe — dann ist ein Rechenfehler die wahrscheinlichere
 * Erklaerung. Nach oben sind 120 % die Grenze: Zellen liegen serienbedingt
 * ein paar Prozent ueber dem Aufdruck, aber kein Pack hat ein Fuenftel mehr.
 */
const KAP_AUFKLEBER_MIN = 0.5
const KAP_AUFKLEBER_MAX = 1.2
/**
 * Hoechstens so viel vom Hub darf ueber LUECKEN weggefallen sein (Anteil).
 * Die ganze Begruendung steht bei `kapazitaetEinzeln`.
 */
const KAP_LUECKE_ANTEIL_MAX = 0.25

export function median(werte: ReadonlyArray<number>): number | null {
  if (!werte.length) return null
  const s = [...werte].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Innenwiderstand aus Lastwechseln.
 *
 * Physik: die Klemmenspannung ist `V_ruhe + I x R`. Aendert sich der Strom
 * zwischen zwei dicht beieinanderliegenden Messungen, aendert sich die
 * Spannung im selben Verhaeltnis - `R = dV / dI`.
 *
 * ZWEI BEDINGUNGEN, damit das stimmt:
 *  - die Messungen duerfen nicht weit auseinanderliegen, sonst hat sich der
 *    Ladestand SELBST veraendert und die Spannung waere auch ohne Lastwechsel
 *    gefallen (bei 600 mA aus 10 Ah sind das in einer Minute rund 0,1 % -
 *    ein bis zwei Millivolt, gegen 50 mV Lastsprung vernachlaessigbar);
 *  - der Stromsprung muss deutlich sein, sonst misst man Rauschen.
 *
 * Zurueck kommt der MEDIAN, nicht der Mittelwert: ein einziger Ausreisser
 * (etwa ein Messwert genau waehrend eines Lastwechsels) zoege den Mittelwert
 * mit, den Median nicht.
 */
export function widerstand(punkte: ReadonlyArray<Punkt>): { mOhm: number | null; paare: number } {
  const werte: number[] = []
  for (let k = 1; k < punkte.length; k++) {
    const a = punkte[k - 1]
    const b = punkte[k]
    const dt = b.t - a.t
    if (dt <= 0 || dt > R_ABSTAND_MAX_MS) continue
    const di = b.i - a.i
    if (Math.abs(di) < R_SPRUNG_MIN_MA) continue
    // mV / mA ergibt Ohm; mal 1000 sind Milliohm.
    const r = ((b.v - a.v) / di) * 1000
    if (r >= R_MIN && r <= R_MAX) werte.push(r)
  }
  const m = median(werte)
  return { mOhm: m === null ? null : Math.round(m), paare: werte.length }
}

/**
 * Die bewegte Ladungsmenge in mAh - der Coulomb-Zaehler in Software.
 *
 * Summiert `|I| x dt` ueber die Reihe. LUECKEN werden uebersprungen: war die
 * Box zwischendurch aus, weiss niemand, was in der Zeit floss, und eine
 * Stunde mit dem letzten bekannten Strom hochzurechnen waere frei erfunden.
 */
export function ladungMah(punkte: ReadonlyArray<Punkt>): number {
  let mAh = 0
  for (let k = 1; k < punkte.length; k++) {
    const dt = punkte[k].t - punkte[k - 1].t
    if (dt <= 0 || dt > LUECKE_MAX_MS) continue
    // Mittlerer Strom ueber das Stueck (Trapez) - bei Lastwechseln genauer
    // als einfach den letzten Wert stehen zu lassen.
    const mittel = (Math.abs(punkte[k].i) + Math.abs(punkte[k - 1].i)) / 2
    mAh += (mittel * dt) / 3_600_000
  }
  return mAh
}

/**
 * ALLE ENTLADUNGEN in der Reihe finden - und NUR die.
 *
 * ══ WARUM LADEN NICHT TAUGT, UND ZWAR NIE ═══════════════════════════════
 * Bis hierher wurde der LAENGSTE Abschnitt in BEIDE Richtungen gesucht. Am
 * 08.08.2026 fiel damit die Wahl auf einen LADEABSCHNITT (08:20-09:41, 26 %
 * -> 73 %, 2284 mAh) und die Box schrieb 4859 mAh unter einen neuen 10-Ah-Pack
 * - unter die Haelfte. Die Rechnung war richtig, der Abschnitt war falsch.
 *
 * Der Ladestand dieser Box kommt aus der SPANNUNG. Beim Laden liegt die
 * Klemmenspannung ueber der Ruhespannung: der Ladestrom drueckt sie durch den
 * Innenwiderstand hoch (am Geraet gemessen 122 mOhm x 1,7 A = 0,21 V), dazu
 * kommt das Ladeplateau der Chemie. Die PROZENTZAHL EILT DER WIRKLICHEN
 * LADUNG VORAUS - der Hub faellt zu gross aus, und weil er im Nenner steht,
 * die Kapazitaet zu klein.
 *
 * DAS STEHT IN DEN ECHTEN DATEN und ist nicht hergeleitet. Dieselbe Reihe,
 * jeder Abschnitt einzeln gerechnet:
 *     entladen  100 % ->  47 %   4418 mAh  =>   8336 mAh
 *     entladen  100 % ->  26 %   6259 mAh  =>   8458 mAh
 *     laden      63 % -> 100 %   3715 mAh  =>  10041 mAh
 *     laden      43 % ->  77 %   2684 mAh  =>   7894 mAh
 *     laden      26 % ->  73 %   2284 mAh  =>   4859 mAh
 * Die beiden Entladungen liegen 1,5 % auseinander. Die Ladungen streuen um
 * mehr als das Doppelte - und je SCHNELLER geladen wurde, desto kleiner das
 * Ergebnis, genau wie die Physik es vorhersagt.
 *
 * ══ WAS EIN ABSCHNITT HIER IST ══════════════════════════════════════════
 * Ein Lauf von Punkten, in dem
 *   NICHTS HINEINFLIESST  (`i <= LADE_SCHWELLE_MA`). Ruhe beendet ihn NICHT: ein
 *     Kind macht mittags Pause, der Strom geht auf 30 mA zurueck, entladen
 *     wird trotzdem weiter. Die Ladungszaehlung nimmt diese Minuten mit dem
 *     kleinen Strom, den sie hatten - das ist richtig und kostet nichts.
 *   DIE ZEIT VORWAERTS LAEUFT. Ein Rueckwaertssprung kommt vor, wenn die Box
 *     ihre Uhr per Netz stellt; danach ist die Reihe keine Reihe mehr.
 *
 * ══ ZWEI PRUEFUNGEN, DIE HIER AUSDRUECKLICH NICHT STEHEN ════════════════
 *
 * OB DER LADESTAND MONOTON FAELLT. Der erste Anlauf brach den Abschnitt ab,
 * sobald der Stand um mehr als zwei Punkte ueber sein bisheriges Minimum
 * zurueckstieg — dieselbe Toleranz, die der alte `laengsterHub` benutzte. AN
 * DEN ECHTEN DATEN GEMESSEN war das falsch: die siebeneinhalbstuendige
 * Entladung vom 07.08. zerfiel dabei in acht Bruchstuecke, von denen nur eines
 * den Mindesthub erreichte. Der Stand springt bei jedem Lastwechsel um bis zu
 * VIER Punkte zurueck (12:45 -> 12:48: 92 % -> 93 % bei -995 mA), denn er wird
 * aus der Spannung geschaetzt, und die erholt sich, sobald die Last nachlaesst.
 * Die Pruefung war ausserdem ueberfluessig: fliesst nichts hinein, KANN der
 * Pack nicht voller werden. Jedes Ansteigen ist Rauschen der Schaetzung.
 *
 * OB EINE LUECKE DARIN LIEGT. Auch das war der erste Anlauf, und auch das ist
 * GEMESSEN schlechter: an den Luecken zerschnitten ergaben dieselben Daten
 * 7426 und 7440 mAh statt 8431 und 8869. Der Grund ist der FLACHE KOPF —
 * frisch vom Ladegeraet steht der Stand eine Weile auf 100 %, waehrend schon
 * Strom fliesst. Schneidet man dort, verliert man Ladung (Zaehler) und behaelt
 * die Prozente (Nenner). Der Schaden durch die Luecke ist real, aber kleiner;
 * er wird deshalb in `kapazitaetEinzeln` BEGRENZT statt hier verhindert.
 *
 * Zurueck kommen INDEXPAARE in `punkte`, in der Reihenfolge der Zeit.
 */
export function entladungen(punkte: ReadonlyArray<Punkt>): { von: number; bis: number }[] {
  const raus: { von: number; bis: number }[] = []
  let start = -1
  const schliessen = (ende: number) => {
    if (start >= 0 && ende > start) raus.push({ von: start, bis: ende })
    start = -1
  }
  for (let k = 0; k < punkte.length; k++) {
    const p = punkte[k]
    const laedt = p.i > LADE_SCHWELLE_MA
    const rueckwaerts = k > 0 && punkte[k].t <= punkte[k - 1].t
    if (laedt || rueckwaerts) schliessen(k - 1)
    if (laedt) continue
    if (start < 0) start = k
  }
  schliessen(punkte.length - 1)
  return raus
}

/**
 * Die Kapazitaet aus EINER Entladung.
 *
 * Ueber den Abschnitt wird die Ladungsmenge gezaehlt; sie entspricht dem
 * gemessenen Anteil des Ladestands. Hochgerechnet auf 100 % ergibt das die
 * Kapazitaet.
 *
 * DIE ABHAENGIGKEIT EHRLICH BENANNT: der Ladestand kommt aus der
 * Herstellerkurve. Ist die falsch, ist auch diese Kapazitaet falsch. Sie ist
 * trotzdem besser als die Zahl auf dem Aufkleber, denn sie misst den ECHTEN
 * Pack in seinem ECHTEN Zustand - ein drei Jahre alter 10-Ah-Pack hat keine
 * 10 Ah mehr.
 *
 * `null`, wenn der Abschnitt zu klein, zu kurz oder unglaubwuerdig ist.
 *
 * DER HUB WIRD MIT VORZEICHEN GERECHNET und nicht als Betrag: Hier kommt nur
 * herein, was NICHT geladen hat, und wo trotzdem der Stand steigt, ist die
 * Schaetzung aus der Spannung durcheinandergekommen. Ein Betrag machte daraus
 * eine Zahl, die aussaehe wie eine Messung.
 *
 * ══ DER RIEGEL GEGEN DIE LUECKE ═════════════════════════════════════════
 * `ladungMah` UEBERSPRINGT eine Luecke - zu Recht, denn niemand weiss, was in
 * einer Stunde ohne Messwert geflossen ist. Der Prozentunterschied ueber
 * dieselbe Luecke zaehlt aber VOLL, weil er aus dem ersten und letzten Punkt
 * kommt. Zaehler zu klein, Nenner ganz: die Kapazitaet faellt zu klein aus.
 *
 * `luecke` ist der Anteil des Hubs, der ueber Luecken WEGGEFALLEN ist. Ein
 * Viertel ist die Grenze: darueber ist ein Viertel der Antwort geraten, und
 * eine geratene Antwort sieht am Schirm aus wie eine gemessene. Darunter wird
 * sie zugelassen und der Median ueber mehrere Entladungen traegt den Rest -
 * die drei Entladungen der echten Box verlieren 18 %, 22 % und 0 % und liegen
 * trotzdem so, dass die mittlere von ihnen stimmt.
 */
export function kapazitaetEinzeln(
  teil: ReadonlyArray<Punkt>,
  nennMah: number | null,
): { mAh: number | null; hub: number; luecke: number } {
  if (teil.length < 2) return { mAh: null, hub: 0, luecke: 0 }
  const spanne = teil[0].p - teil[teil.length - 1].p
  const dauer = teil[teil.length - 1].t - teil[0].t
  // Wie viel vom Hub fiel in Zeit ohne Messwerte?
  let verloren = 0
  for (let k = 1; k < teil.length; k++) {
    const dt = teil[k].t - teil[k - 1].t
    if (dt > LUECKE_MAX_MS) verloren += teil[k - 1].p - teil[k].p
  }
  const anteil = spanne > 0 ? Math.max(0, verloren) / spanne : 0
  if (spanne < KAP_HUB_MIN || dauer < KAP_DAUER_MIN_MS) {
    return { mAh: null, hub: spanne, luecke: anteil }
  }
  if (anteil > KAP_LUECKE_ANTEIL_MAX) return { mAh: null, hub: spanne, luecke: anteil }
  const gemessen = (ladungMah(teil) / spanne) * 100
  if (!Number.isFinite(gemessen) || gemessen <= 0) return { mAh: null, hub: spanne, luecke: anteil }
  if (
    nennMah
    && (gemessen < nennMah * KAP_AUFKLEBER_MIN || gemessen > nennMah * KAP_AUFKLEBER_MAX)
  ) {
    return { mAh: null, hub: spanne, luecke: anteil }
  }
  return { mAh: Math.round(gemessen), hub: spanne, luecke: anteil }
}

/**
 * Die Kapazitaet des Packs - aus MEHREREN Entladungen.
 *
 * ══ WARUM NICHT NUR DIE LETZTE ══════════════════════════════════════════
 * Eine einzelne Entladung traegt alles, was an ihr besonders war: ein
 * Bluetooth-Lautsprecher, der zwanzig Minuten lang suchte, eine Nacht, in der
 * das Kind die Box im Regal vergass. Der Betreiber hat zwei, die 1,5 %
 * auseinanderliegen - daraus laesst sich mehr machen als aus einer.
 *
 * ══ MEDIAN, NICHT MITTELWERT UND NICHT NACH HUB GEWICHTET ═══════════════
 * Der MITTELWERT haengt an jedem Ausreisser; eine einzige Entladung mit einem
 * Zeitsprung darin zoege ihn mit. Nach HUB ZU GEWICHTEN klaenge besser, als es
 * ist: es macht die laengste Entladung zur alleinigen Antwort, sobald sie mehr
 * als die Haelfte des Gewichts traegt - und "lang" heisst nicht "sauber",
 * sondern nur "das Kind hat lange gehoert". Der Mindesthub oben sortiert die
 * unbrauchbaren schon aus; unter den verbliebenen ist keine besser als die
 * andere, und der Median ist die, die kein Ausreisser verschieben kann.
 */
export function kapazitaet(
  punkte: ReadonlyArray<Punkt>,
  nennMah: number | null,
): { mAh: number | null; hub: number; entladungen: number } {
  const werte: number[] = []
  let groesster = 0
  for (const e of entladungen(punkte).slice(-KAP_ENTLADUNGEN_MAX)) {
    const k = kapazitaetEinzeln(punkte.slice(e.von, e.bis + 1), nennMah)
    if (k.mAh === null) continue
    werte.push(k.mAh)
    if (k.hub > groesster) groesster = k.hub
  }
  const m = median(werte)
  return {
    mAh: m === null ? null : Math.round(m),
    hub: groesster,
    entladungen: werte.length,
  }
}

/**
 * Alles zusammen — mit ZWEI Zeitskalen.
 *
 * AM GERAET GELERNT (2026-07-30): der Innenwiderstand braucht eine FEINE
 * Reihe. Die Akkukurve zeichnet einen Punkt je Minute auf; ein Lastwechsel
 * von 40 Sekunden liegt komplett ZWISCHEN zwei Punkten, und beide sehen
 * gleich aus. Am Geraet lernte die Box deshalb "nichts", waehrend dieselbe
 * Rechnung auf der Sekunden-Aufzeichnung 199 mOhm aus 6 Lastwechseln fand.
 *
 * Die Kapazitaet braucht umgekehrt die LANGE Reihe — ein Hub von 20
 * Prozentpunkten passt in keine Minutenmessung.
 *
 * Deshalb: `punkte` = die lange Kurve (Kapazitaet, Ladungsmenge),
 * `feinReihe` = die dichte Aufzeichnung, wenn eine vorliegt (Widerstand).
 */
export function lernen(
  punkte: ReadonlyArray<Punkt>,
  nennMah: number | null,
  feinReihe?: ReadonlyArray<Punkt>,
): Gelernt {
  const r = widerstand(feinReihe?.length ? feinReihe : punkte)
  const k = kapazitaet(punkte, nennMah)
  return {
    rMilliOhm: r.mOhm,
    rPaare: r.paare,
    kapazitaetMah: k.mAh,
    kapazitaetHub: Math.round(k.hub),
    kapazitaetEntladungen: k.entladungen,
    // EINE FRISCHE BOX HAT NOCH KEINE ENTLADUNG GESEHEN und darf trotzdem
    // nicht ewig ohne Zahl bleiben - ohne Kapazitaet gibt es keine Restzeit,
    // und "wie lange reicht das noch" ist die Frage, wegen der jemand auf
    // diese Seite geht. Bis zur ersten brauchbaren Entladung gilt deshalb der
    // Aufdruck; was hier steht, ist nur, WELCHE der beiden es gerade ist.
    kapazitaetQuelle: k.mAh !== null ? 'gemessen' : nennMah ? 'aufkleber' : null,
    ladungMah: Math.round(ladungMah(punkte)),
    // "brauchbar" erst, wenn BEIDES steht und der Widerstand auf mehr als
    // einer Handvoll Lastwechsel beruht.
    stand:
      r.mOhm !== null && r.paare >= 5 && k.mAh !== null
        ? 'brauchbar'
        : r.mOhm !== null || k.mAh !== null
          ? 'wenig'
          : 'nichts',
  }
}

/* c8 ignore next 3 */
declare const module: { exports: unknown } | undefined
if (typeof module !== 'undefined')
  module.exports = {
    median,
    widerstand,
    ladungMah,
    entladungen,
    kapazitaetEinzeln,
    kapazitaet,
    lernen,
    LUECKE_MAX_MS,
  }
