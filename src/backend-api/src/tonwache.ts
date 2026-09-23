/**
 * Wann hoert der Ton WIRKLICH auf?
 *
 * WOFUER: der Messmodus misst bisher, wann die ANZEIGE reagiert - der Knopf
 * springt um, die Seite wechselt. Das ist nicht die Frage, die man stellt,
 * wenn man auf Stopp drueckt. Gefragt ist: wann ist es still?
 *
 * Zwischen beidem liegt hier einiges: die Wiedergabe laeuft in librespot bzw.
 * mpv, der Tonserver haelt einen Puffer, und ein Bluetooth-Lautsprecher haelt
 * noch einen. Die Anzeige kann laengst umgesprungen sein, waehrend die Box noch
 * spielt.
 *
 * Gemessen wird am MONITOR der Tonsenke - also an dem, was wirklich
 * herauskommt, nicht an dem, was ein Programm behauptet.
 *
 * REIN: kein Kindprozess, keine Uhr, kein Netz. Der Aufrufer reicht die
 * gemessenen Pegel herein; hier steht nur, wie daraus ein Uebergang wird.
 */

/** Ab hier gilt ein Block als hoerbar. Darunter ist Grundrauschen. */
export const SCHWELLE = 0.005

/**
 * So lange muss es durchgehend still sein, bevor "aus" gemeldet wird.
 *
 * OHNE DIESE ENTPRELLUNG waere jede Pause zwischen zwei Woertern eines
 * Hoerspiels ein "Stopp". Musik hat leise Stellen; ein Werkzeug, das dabei
 * "gestoppt" ruft, ist schlimmer als keines.
 */
export const STILLE_MS = 400

/**
 * So lange muss durchgehend Ton da sein, bevor "an" gemeldet wird.
 *
 * Kuerzer als die Stille-Schwelle: ein einzelner Knackser soll nicht als
 * Wiedergabe zaehlen, aber der Beginn eines Titels soll frueh erkannt werden -
 * es geht ja gerade darum, wie schnell er kommt.
 */
export const TON_MS = 150

/** Ein gemessener Block: Zeitpunkt und Spitzenpegel (0..1). */
export interface Block {
  /** Millisekunden seit 1970 - vom Aufrufer, damit dieses Modul rein bleibt. */
  zeit: number
  /** Hoechster Ausschlag in diesem Block, 0..1. */
  pegel: number
}

/** Ein erkannter Wechsel. */
export interface Uebergang {
  /** Wann der Wechsel WIRKLICH begann - nicht wann er bestaetigt war. */
  zeit: number
  /** true = Ton setzte ein, false = es wurde still. */
  an: boolean
}

/**
 * Aus einer Folge gemessener Bloecke die Wechsel herauslesen.
 *
 * @param bloecke  fortlaufend gemessene Bloecke, aelteste zuerst
 * @param start    Zustand vor dem ersten Block (true = es lief Ton)
 *
 * WICHTIG - GEMELDET WIRD DER BEGINN, NICHT DIE BESTAETIGUNG. Wer erst nach
 * 400 ms Stille "aus" meldet und diesen Zeitpunkt nimmt, zaehlt seine eigene
 * Entprellung zur Reaktionszeit dazu und macht die Box um 400 ms langsamer,
 * als sie ist. Deshalb wird der Zeitpunkt des ERSTEN stillen Blocks gemeldet.
 */
export function uebergaenge(
  bloecke: readonly Block[],
  start = false,
  opts: { schwelle?: number; stilleMs?: number; tonMs?: number } = {},
): Uebergang[] {
  const schwelle = opts.schwelle ?? SCHWELLE
  const stilleMs = opts.stilleMs ?? STILLE_MS
  const tonMs = opts.tonMs ?? TON_MS

  const raus: Uebergang[] = []
  let an = start
  // Seit wann haelt der GEGENTEILIGE Zustand an? null = gar nicht.
  let seit: number | null = null

  for (const b of bloecke) {
    const hoerbar = b.pegel > schwelle
    if (hoerbar === an) {
      seit = null // Rueckfall in den bestehenden Zustand: Zaehlung verwerfen.
      continue
    }
    if (seit === null) seit = b.zeit
    const gehalten = b.zeit - seit
    // >= : eine Schwelle von 400 ms soll bei genau 400 ms ausloesen.
    if (gehalten >= (hoerbar ? tonMs : stilleMs)) {
      an = hoerbar
      raus.push({ zeit: seit, an })
      seit = null
    }
  }
  return raus
}

/**
 * Einen Klick mit dem darauf folgenden Ton-Wechsel zusammenbringen.
 *
 * @param klickZeit  wann getippt wurde
 * @param wechsel    alle bekannten Ton-Wechsel
 * @param maxMs      laenger als das gilt ein Wechsel nicht mehr als Folge
 * @returns  Millisekunden bis es wirklich still/laut wurde, sonst null
 *
 * DER ERSTE WECHSEL NACH DEM KLICK, nicht der naechstgelegene: was VOR dem
 * Klick geschah, kann seine Folge nicht sein. Und ohne die Obergrenze wuerde
 * irgendwann jedes Verstummen irgendeinem alten Klick zugeschrieben - das
 * ergaebe Zahlen, die niemand nachpruefen kann.
 */
export function folgeWechsel(
  klickZeit: number,
  wechsel: readonly Uebergang[],
  maxMs = 8000,
): { ms: number; an: boolean } | null {
  let bester: Uebergang | null = null
  for (const w of wechsel) {
    if (w.zeit < klickZeit) continue
    if (w.zeit - klickZeit > maxMs) continue
    if (!bester || w.zeit < bester.zeit) bester = w
  }
  return bester ? { ms: bester.zeit - klickZeit, an: bester.an } : null
}

/**
 * Spitzenpegel eines Blocks aus rohen 16-Bit-Abtastwerten.
 *
 * Spitze statt Mittelwert: ein kurzer Einsatz soll sofort zaehlen, und ein
 * Mittelwert ueber 50 ms verschluckt ihn.
 */
export function pegelAus(roh: Int16Array): number {
  let max = 0
  for (const w of roh) {
    const a = w < 0 ? -w : w
    if (a > max) max = a
  }
  return max / 32768
}
