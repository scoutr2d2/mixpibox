/**
 * Der Ladestand FEINER, als der Treiber ihn liefert.
 *
 * AUSGANGSLAGE: `mupihat_bq25792.py` (`battery_soc()`) kennt genau fuenf
 * Antworten — "100%","75%","50%","25%","0%" — und faellt der Pack unter die
 * unterste Schwelle, einen leeren String. Zwischen "halb" und "dreiviertel"
 * liegen bei einem 10-Ah-Pack aber gut zwei Stunden Spielzeit; eine Anzeige,
 * die das zu einem Sprung zusammenfasst, ist fuer die Frage "reicht das noch
 * bis nach Hause?" wertlos.
 *
 * WARUM NICHT GENAUER MESSEN: der BQ25792 ist ein LADEREGLER mit ADC
 * (VBAT/IBAT/VBUS), kein Fuel-Gauge — er zaehlt keine Ladungsmenge. Die
 * einzige verfuegbare Groesse ist die Spannung. Mehr als eine gute
 * Interpolation der Entladekurve ist damit nicht zu holen, und alles, was so
 * tut als ob, waere erfunden.
 *
 * DIE KURVE: eine Li-Ion-Zelle faellt von 4,20 auf 3,90 V ueber die obersten
 * 20 % der Ladung, haelt dann zwischen 3,90 und 3,50 V ueber ganze 60 %
 * beinahe die Spannung, und bricht unter 3,50 V rasch auf 3,00 V ein. Ein 2S-
 * Pack verdoppelt das. Deshalb wird NICHT linear zwischen leer und voll
 * gerechnet, sondern STUECKWEISE zwischen den fuenf Stuetzpunkten des
 * eingestellten Akkuprofils — die geben die Kurve bereits wieder.
 *
 * REIN: kein Netz, kein Dateizugriff, keine Uhr.
 */

/** Die fuenf Stuetzpunkte eines Akkuprofils, in Millivolt. */
export interface Akkuprofil {
  v_0: number
  v_25: number
  v_50: number
  v_75: number
  v_100: number
}

/**
 * Innenwiderstand des Packs in Milliohm — fuer die Lastkorrektur.
 *
 * Unter Last bricht die Klemmenspannung ein; ohne Korrektur zeigt die Box
 * beim Abspielen weniger an als in Ruhe, und der Wert SPRINGT beim Pausieren
 * nach oben. 70 mOhm ist ein vorsichtiger Erfahrungswert fuer einen gesunden
 * 2S2P-Verbund aus Rundzellen. Er ist eine SCHAETZUNG und darf das Ergebnis
 * deshalb nur wenig verschieben (siehe Deckelung unten).
 */
export const R_INNEN_MOHM = 70

/** Wie weit die Lastkorrektur die Spannung hoechstens anheben darf (mV). */
export const KORREKTUR_MAX_MV = 250

const REIHE: ReadonlyArray<readonly [keyof Akkuprofil, number]> = [
  ['v_0', 0],
  ['v_25', 25],
  ['v_50', 50],
  ['v_75', 75],
  ['v_100', 100],
]

/**
 * Ein Akkuprofil aus der Konfiguration holen.
 *
 * `selected_battery` traf am Geraet auf KEINEN Listeneintrag ("USB-C mode"
 * gegen "USB-C mode (no battery)"), und der Treiber fiel still auf seine
 * eingebauten Werte zurueck. Ein Namensvergleich, der solche Schreibweisen
 * ueberlebt, ist hier mehr wert als ein exakter: verglichen wird ohne
 * Gross-/Kleinschreibung und ohne Beiwerk in Klammern.
 */
export function profilAus(mupihat: unknown): Akkuprofil | null {
  const m = (mupihat ?? {}) as {
    battery_types?: Array<{ name?: string; config?: Record<string, unknown> }>
    selected_battery?: string
  }
  const liste = Array.isArray(m.battery_types) ? m.battery_types : []
  if (!liste.length) return null
  const schlank = (s: unknown) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[^a-z0-9]/g, '')
  const gesucht = schlank(m.selected_battery)
  const treffer =
    liste.find((e) => schlank(e.name) === gesucht) ??
    liste.find((e) => gesucht && schlank(e.name).startsWith(gesucht))
  const c = treffer?.config
  if (!c) return null
  const p: Partial<Akkuprofil> = {}
  for (const [k] of REIHE) {
    const v = Number(c[k])
    if (!Number.isFinite(v)) return null
    p[k] = v
  }
  const fertig = p as Akkuprofil
  // Eine Kurve, die nicht steigt, ist keine. Das "USB-C mode"-Akkuprofil setzt
  // alle Punkte auf 1 - damit laesst sich nichts interpolieren, und die
  // grobe Stufe des Treibers bleibt die ehrlichere Antwort.
  for (let i = 1; i < REIHE.length; i++) {
    if (fertig[REIHE[i][0]] <= fertig[REIHE[i - 1][0]]) return null
  }
  return fertig
}

/**
 * Die Ruhespannung schaetzen: was die Klemmenspannung ohne Last waere.
 *
 * `ibat` ist NEGATIV beim Entladen, also hebt die Korrektur an; beim Laden
 * ist sie positiv und senkt entsprechend. Gedeckelt, weil der Widerstand
 * geraten ist - ein Rechenfehler soll die Anzeige nicht davonschicken.
 */
export function ruhespannung(vbat: number, ibat: number, rMilliOhm = R_INNEN_MOHM): number {
  if (!Number.isFinite(vbat) || !Number.isFinite(ibat)) return vbat
  const delta = (-ibat * rMilliOhm) / 1000
  const gedeckelt = Math.max(-KORREKTUR_MAX_MV, Math.min(KORREKTUR_MAX_MV, delta))
  return vbat + gedeckelt
}

/**
 * Der Ladestand in Prozent, stueckweise zwischen den Stuetzpunkten.
 *
 * Ergebnis auf ganze Prozent gerundet — mehr Stellen waeren eine Genauigkeit,
 * die die Spannungsmessung nicht hergibt.
 */
export function prozentAusSpannung(mv: number, p: Akkuprofil): number {
  if (!Number.isFinite(mv)) return 0
  if (mv <= p.v_0) return 0
  if (mv >= p.v_100) return 100
  for (let i = 1; i < REIHE.length; i++) {
    const [unten, pUnten] = REIHE[i - 1]
    const [oben, pOben] = REIHE[i]
    if (mv <= p[oben]) {
      const anteil = (mv - p[unten]) / (p[oben] - p[unten])
      return Math.round(pUnten + anteil * (pOben - pUnten))
    }
  }
  return 100
}

/**
 * Der feine Ladestand aus einem HAT-Stand und der Konfiguration.
 *
 * `null`, wenn sich nichts Belastbares sagen laesst (kein Akkuprofil, keine
 * plausible Spannung) — dann bleibt die grobe Stufe des Treibers stehen,
 * statt eine erfundene Zahl anzuzeigen.
 */
export function feinerStand(
  hat: unknown,
  mupihatConfig: unknown,
  rMilliOhm: number = R_INNEN_MOHM,
): number | null {
  const h = (hat ?? {}) as { Vbat?: unknown; Ibat?: unknown }
  const vbat = Number(h.Vbat)
  if (!Number.isFinite(vbat) || vbat <= 3000 || vbat >= 13000) return null
  const profil = profilAus(mupihatConfig)
  if (!profil) return null
  const ibat = Number(h.Ibat)
  const ruhe = ruhespannung(vbat, Number.isFinite(ibat) ? ibat : 0, rMilliOhm)
  return prozentAusSpannung(ruhe, profil)
}

/* c8 ignore next 3 */
declare const module: { exports: unknown } | undefined
if (typeof module !== 'undefined')
  module.exports = { profilAus, ruhespannung, prozentAusSpannung, feinerStand, R_INNEN_MOHM, KORREKTUR_MAX_MV }
