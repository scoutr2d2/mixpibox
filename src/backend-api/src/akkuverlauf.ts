/**
 * Der Akkuverlauf: Lade- und Entladekurven ueber die Zeit.
 *
 * WOFUER: der Ladestand allein sagt "57 %". Er sagt nicht, ob das seit einer
 * Stunde faellt oder gerade steigt, wie lange eine Ladung dauert, ob der Pack
 * altert. Genau dafuer haben Telefone ihre Akku-Grafik, und genau die fehlt
 * hier.
 *
 * REIN: kein Netz, kein Dateizugriff, keine Uhr - jede Zeit kommt als
 * Parameter herein. Der Server sammelt und speichert, hier steht nur, WAS
 * ein Punkt ist, wie die Reihe waechst und wie sie in Abschnitte zerfaellt.
 *
 * SPARSAM MIT DER KARTE: die Box laeuft von einer SD-Karte, und die stirbt
 * an Schreibzugriffen. Deshalb kurze Feldnamen (die Datei ist ein Viertel so
 * gross wie mit ausgeschriebenen), eine Obergrenze fuer die Punktzahl und
 * ein Mindestabstand, damit ein schneller Abfragetakt die Reihe nicht
 * aufblaeht.
 */

/** Ein Messpunkt. Kurze Namen mit Absicht - davon liegen Tausende auf der Karte. */
export interface Punkt {
  /** Zeitstempel in Millisekunden. */
  t: number
  /** Akkuspannung in mV. */
  v: number
  /** Akkustrom in mA; NEGATIV = die Box zieht. */
  i: number
  /** Ladestand in Prozent (der feine Wert, wenn vorhanden). */
  p: number
}

export type Art = 'laden' | 'entladen' | 'ruhe'

export interface Abschnitt {
  art: Art
  von: number
  bis: number
  vonProzent: number
  bisProzent: number
  /** Mittlerer Strom in mA ueber den Abschnitt. */
  mA: number
}

/** Ab welchem Strom etwas als Laden bzw. Entladen zaehlt (mA). */
export const RUHE_SCHWELLE = 20

/** Wie viele Punkte hoechstens aufgehoben werden (7 Tage im Minutentakt). */
export const MAX_PUNKTE = 10080

/** Kleinster Abstand zwischen zwei aufgezeichneten Punkten (ms). */
export const MIN_ABSTAND_MS = 55_000

/**
 * Aus einem HAT-Stand einen Messpunkt machen.
 *
 * `null`, wenn der Stand nichts hergibt - lieber eine Luecke in der Kurve als
 * eine erfundene Null, die spaeter wie ein leerer Akku aussieht.
 */
export function punktAus(hat: unknown, jetzt: number): Punkt | null {
  const h = (hat ?? {}) as Record<string, unknown>
  const v = Number(h.Vbat)
  if (!Number.isFinite(v) || v <= 3000 || v >= 13000) return null
  const i = Number(h.Ibat)
  const fein = Number(h.Bat_SOC_fein)
  // ACHTUNG `Number('')` ist NULL, nicht NaN: ohne die Laengenpruefung wuerde
  // ein FEHLENDER Ladestand als 0 % in die Kurve gehen und dort spaeter wie
  // ein leerer Akku aussehen. (Der Treiber liefert genau diesen leeren String,
  // wenn der Pack unter die unterste Schwelle faellt.)
  const rohSoc = String(h.Bat_SOC ?? '').replace('%', '').trim()
  const grob = rohSoc.length ? Number(rohSoc) : Number.NaN
  const p = Number.isFinite(fein) ? fein : Number.isFinite(grob) ? grob : NaN
  if (!Number.isFinite(p)) return null
  return {
    t: Math.round(jetzt),
    v: Math.round(v),
    i: Number.isFinite(i) ? Math.round(i) : 0,
    p: Math.max(0, Math.min(100, Math.round(p))),
  }
}

/**
 * Einen Punkt anhaengen.
 *
 * Zu dicht am letzten -> verworfen (der Abfragetakt der Oberflaeche darf die
 * Aufzeichnung nicht bestimmen). Ueber der Obergrenze -> die aeltesten fallen
 * weg. Ein Punkt aus der VERGANGENHEIT wird ebenfalls verworfen: nach einem
 * Zeitsprung (die Box hat keine Uhr mit Batterie und stellt sie erst per
 * Netz) laege die Reihe sonst durcheinander, und jede Kurve waere Unsinn.
 */
export function anhaengen(
  reihe: ReadonlyArray<Punkt>,
  punkt: Punkt | null,
  opts: { maxPunkte?: number; minAbstandMs?: number } = {},
): Punkt[] {
  const max = opts.maxPunkte ?? MAX_PUNKTE
  const abstand = opts.minAbstandMs ?? MIN_ABSTAND_MS
  if (!punkt) return [...reihe]
  const letzter = reihe[reihe.length - 1]
  if (letzter && punkt.t - letzter.t < abstand) return [...reihe]
  const neu = [...reihe, punkt]
  return neu.length > max ? neu.slice(neu.length - max) : neu
}

/**
 * Nach einem Zeitsprung aufraeumen.
 *
 * Stellt die Box ihre Uhr nach dem Start per Netz, springt sie oft um Jahre.
 * Punkte, die danach in der ZUKUNFT liegen, sind aus der Zeit vor dem Sprung
 * und wuerden jede Kurve unlesbar machen.
 */
export function bereinigen(reihe: ReadonlyArray<Punkt>, jetzt: number): Punkt[] {
  return reihe.filter((p) => Number.isFinite(p.t) && p.t <= jetzt + 60_000).sort((a, b) => a.t - b.t)
}

/** Nur die letzten `stunden` Stunden. */
export function spanne(reihe: ReadonlyArray<Punkt>, stunden: number, jetzt: number): Punkt[] {
  const ab = jetzt - stunden * 3_600_000
  return reihe.filter((p) => p.t >= ab)
}

const artVon = (mA: number): Art =>
  mA > RUHE_SCHWELLE ? 'laden' : mA < -RUHE_SCHWELLE ? 'entladen' : 'ruhe'

/**
 * Die Reihe in Lade-, Entlade- und Ruheabschnitte zerlegen.
 *
 * Das ist der eigentliche Nutzen: "seit 20:14 am Laden, von 31 auf 78 %" ist
 * eine Aussage, ein einzelner Prozentwert ist keine.
 *
 * Ein einzelner abweichender Punkt beendet einen Abschnitt NICHT (`mindest`,
 * standardmaessig 2 Punkte): der Strom schwankt bei jedem Titelwechsel, und
 * ohne diese Beruhigung zerfiele eine Nacht am Ladegeraet in hundert
 * Schnipsel.
 */
export function abschnitte(reihe: ReadonlyArray<Punkt>, mindest = 2): Abschnitt[] {
  const raus: Abschnitt[] = []
  let lauf: Punkt[] = []
  const schliessen = () => {
    if (lauf.length < mindest) return
    const a = lauf[0]
    const e = lauf[lauf.length - 1]
    raus.push({
      art: artVon(lauf.reduce((s, p) => s + p.i, 0) / lauf.length),
      von: a.t,
      bis: e.t,
      vonProzent: a.p,
      bisProzent: e.p,
      mA: Math.round(lauf.reduce((s, p) => s + p.i, 0) / lauf.length),
    })
  }
  for (const p of reihe) {
    if (!lauf.length || artVon(p.i) === artVon(lauf[lauf.length - 1].i)) {
      lauf.push(p)
      continue
    }
    schliessen()
    lauf = [p]
  }
  schliessen()
  return raus
}

/**
 * Wie lange noch?
 *
 * Aus dem gemessenen Strom und der Kapazitaet - NICHT aus der bisherigen
 * Steigung der Kurve: die ist im flachen Mittelteil der Entladekurve fast
 * null und ergaebe absurde Hochrechnungen.
 *
 * `null`, wenn nichts fliesst oder die Kapazitaet unbekannt ist.
 */
export function hochrechnen(punkt: Punkt | undefined, kapazitaetMah: number | null): number | null {
  if (!punkt || !kapazitaetMah || Math.abs(punkt.i) <= RUHE_SCHWELLE) return null
  const anteil = punkt.i < 0 ? punkt.p / 100 : (100 - punkt.p) / 100
  const stunden = (kapazitaetMah * anteil) / Math.abs(punkt.i)
  return Number.isFinite(stunden) ? Math.round(stunden * 60) : null
}

/**
 * Die Kapazitaet aus dem Namen des Akkuprofils lesen ("… 10.000mAh").
 *
 * Ein Behelf, aber ein ehrlicher: die Konfiguration fuehrt die Kapazitaet
 * nirgends als Zahl. Gelingt es nicht, wird eben nicht hochgerechnet.
 */
export function kapazitaetAus(name: unknown): number | null {
  const m = /([\d.,]+)\s*mah/i.exec(String(name ?? ''))
  if (!m) return null
  const zahl = Number(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(zahl) && zahl > 0 ? Math.round(zahl) : null
}

/**
 * Die Aufkleber-Kapazitaet der Box: die AUSDRUECKLICH eingetragene Zahl
 * schlaegt den Namens-Behelf. Pure.
 *
 * Seit dem 15.08.2026 kann die Verwaltung die Kapazitaet als Zahl eintragen
 * (`battery_capacity_mah` im mupihat-Abschnitt) — noetig fuer Profile ohne
 * mAh im Namen (Ansmann, Custom) und fuer Packs, deren Aufkleber vom
 * Profilnamen abweicht. Nur glaubwuerdige Zahlen zaehlen: 100..100000 mAh.
 */
export function aufkleberKapazitaet(konfig: unknown): number | null {
  const k = konfig as { selected_battery?: unknown; battery_capacity_mah?: unknown } | null
  const zahl = Number(k?.battery_capacity_mah)
  if (Number.isFinite(zahl) && zahl >= 100 && zahl <= 100000) return Math.round(zahl)
  return kapazitaetAus(k?.selected_battery)
}

/**
 * Fuer die Anzeige ausduennen.
 *
 * Eine Woche im Minutentakt sind 10 000 Punkte; ein Diagramm von 900 Pixeln
 * Breite kann davon nichts zeigen. Es wird gleichmaessig gerafft und der
 * LETZTE Punkt immer behalten - er ist der aktuelle Stand, und der darf beim
 * Ausduennen nicht verschwinden.
 */
export function ausduennen(reihe: ReadonlyArray<Punkt>, max: number): Punkt[] {
  if (max <= 0) return []
  if (reihe.length <= max) return [...reihe]
  const schritt = reihe.length / max
  const raus: Punkt[] = []
  for (let i = 0; i < max; i++) raus.push(reihe[Math.floor(i * schritt)])
  const letzter = reihe[reihe.length - 1]
  if (raus[raus.length - 1].t !== letzter.t) raus[raus.length - 1] = letzter
  return raus
}

/* c8 ignore next 3 */
declare const module: { exports: unknown } | undefined
if (typeof module !== 'undefined')
  module.exports = {
    punktAus,
    anhaengen,
    bereinigen,
    spanne,
    abschnitte,
    hochrechnen,
    kapazitaetAus,
    ausduennen,
    RUHE_SCHWELLE,
    MAX_PUNKTE,
    MIN_ABSTAND_MS,
  }
