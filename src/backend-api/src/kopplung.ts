/**
 * KOPPLUNG — ein Handy mit der Box verbinden, per Code oder QR (27.09.2026).
 *
 * Betreiber: „ich möchte auch die app mit der box verbinden müssen über code
 * / qrscan ohne das ist die verbindung nicht möglich ggf nur in einem debug
 * modus" und „das menü muss man über die box erreichen nicht über die
 * weboberfläche". Entschieden am selben Tag:
 *   * GESPERRT WIRD DIE APP, nicht das Netz: eine Anfrage mit `x-mixpi-app`
 *     braucht einen gueltigen Schluessel. Die Verwaltung im Browser bleibt
 *     wie sie ist (mit oder ohne Verwaltungspasswort).
 *   * Gekoppelt wird per sechsstelligem Code ODER QR (der QR traegt denselben
 *     Code plus die Adresse der Box).
 *   * Der Debug-Modus ist ein Schalter AN DER BOX (`ohneKopplung`), ab Werk
 *     aus. Die Pruefung sitzt hier — eine App, die „ich bin ein Debug-Build"
 *     behauptet, koennte jede sein.
 *
 * REIN UND OHNE EIN-/AUSGABE: Laden, Schreiben und die Routen stehen in
 * server.ts. Der Zufall kommt als Parameter herein, damit Zeugen ihn
 * festnageln koennen.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/** Ein gekoppeltes Handy. Der Schluessel selbst steht NIRGENDS — nur sein Abdruck. */
export interface Geraet {
  id: string
  name: string
  /** sha256 des Schluessels, hex. */
  abdruck: string
  angelegt: number
  zuletzt: number
}

export interface Kopplungsablage {
  geraete: Geraet[]
  /** Debug-Modus: Apps duerfen ohne Kopplung. Ab Werk aus. */
  ohneKopplung: boolean
}

export const KOPPLUNG_LEER: Kopplungsablage = { geraete: [], ohneKopplung: false }

/** So lange gilt ein angezeigter Code. */
export const FENSTER_MS = 120_000
/** Danach ist der Code verbrannt — sechs Ziffern sind eine Million Moeglichkeiten, nicht mehr. */
export const MAX_FEHLVERSUCHE = 5

/**
 * Was die App OHNE Kopplung erreichen darf: sich als Box ausweisen lassen
 * (die Suche im WLAN), koppeln, und fragen, ob sie gekoppelt ist. Sonst nichts.
 */
export const OFFEN_FUER_APP: readonly string[] = [
  '/api/box',
  '/api/kopplung/anfrage',
  '/api/kopplung/koppeln',
  '/api/kopplung/status',
]

/** So oft darf ein Handy die Box bitten, den Code zu zeigen — sonst spammt es den Kinderschirm. */
export const ANFRAGE_ABSTAND_MS = 30_000

const abdruckVon = (schluessel: string) => createHash('sha256').update(schluessel, 'utf8').digest('hex')

/** Rohes JSON einlesen — kaputtes wird weggelassen, nichts erfunden. */
export function ablageAus(roh: unknown): Kopplungsablage {
  const r = (roh ?? {}) as Record<string, unknown>
  const geraete = (Array.isArray(r.geraete) ? r.geraete : [])
    .map((g) => g as Record<string, unknown>)
    .filter((g) => typeof g.id === 'string' && typeof g.abdruck === 'string' && /^[0-9a-f]{64}$/.test(g.abdruck))
    .map((g) => ({
      id: String(g.id),
      name: nameSauber(g.name),
      abdruck: String(g.abdruck),
      angelegt: Number(g.angelegt) || 0,
      zuletzt: Number(g.zuletzt) || 0,
    }))
  // NUR DAS AUSDRUECKLICHE true schaltet die Sperre ab. Eine kaputte Datei
  // darf die Box nicht still oeffnen.
  return { geraete, ohneKopplung: r.ohneKopplung === true }
}

/** Ein Name fuer Menschen: kurz, einzeilig, nie leer. */
export function nameSauber(name: unknown): string {
  const s = String(name ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
  return s || 'Handy'
}

/** Ein Code aus sechs Ziffern, fuehrende Nullen erlaubt. */
export function codeErzeugen(zufall: () => number = () => randomInt(0, 1_000_000)): string {
  return String(zufall() % 1_000_000).padStart(6, '0')
}

/**
 * Das offene Kopplungsfenster — hoechstens eins, im Speicher der Box.
 *
 * NICHT GESPEICHERT: ein Neustart der Box schliesst es. Das ist gewollt; ein
 * Code, der einen Neustart ueberlebt, lebte laenger, als ihn jemand ansieht.
 */
export class Kopplungsfenster {
  private code: string | null = null
  private bis = 0
  private fehler = 0
  /** Nur fuer DIESE Absenderadresse — gesetzt, wenn ein Handy selbst gefragt hat. */
  private fuer: string | null = null

  /**
   * Ein neues Fenster oeffnen; ein altes wird ersetzt.
   *
   * `fuer`: hat ein Handy aus der App heraus um den Code gebeten
   * (27.09.2026), gilt er NUR fuer dieses Handy. Ein zweites, das den Code
   * am Kinderschirm mitliest, kommt damit nicht hinein.
   */
  oeffnen(jetzt: number, code = codeErzeugen(), fuer: string | null = null): { code: string; bis: number } {
    this.code = code
    this.bis = jetzt + FENSTER_MS
    this.fehler = 0
    this.fuer = fuer
    return { code, bis: this.bis }
  }

  schliessen(): void {
    this.code = null
  }

  /** Ist gerade eins offen? (Fuer die Anzeige an der Box.) */
  offen(jetzt: number): { code: string; bis: number } | null {
    if (!this.code || jetzt > this.bis) return null
    return { code: this.code, bis: this.bis }
  }

  /**
   * Einen Code pruefen. `ok` schliesst das Fenster — ein Code koppelt genau
   * EIN Handy. Nach MAX_FEHLVERSUCHE falschen ist es ebenfalls zu.
   */
  pruefen(code: unknown, jetzt: number, von: string | null = null): 'ok' | 'falsch' | 'abgelaufen' | 'keins' {
    if (!this.code) return 'keins'
    if (jetzt > this.bis) {
      this.code = null
      return 'abgelaufen'
    }
    const passt =
      (this.fuer === null || this.fuer === von) &&
      typeof code === 'string' &&
      code.length === this.code.length &&
      timingSafeEqual(Buffer.from(code), Buffer.from(this.code))
    if (passt) {
      this.code = null
      return 'ok'
    }
    this.fehler++
    if (this.fehler >= MAX_FEHLVERSUCHE) this.code = null
    return 'falsch'
  }
}

/** Ein Handy aufnehmen. Der Schluessel geht EINMAL an die App und nie wieder heraus. */
export function geraetAnlegen(
  ablage: Kopplungsablage,
  name: unknown,
  jetzt: number,
  zufall: () => Buffer = () => randomBytes(32),
): { ablage: Kopplungsablage; schluessel: string; id: string } {
  const schluessel = zufall().toString('hex')
  const id = `hdy_${abdruckVon(schluessel).slice(0, 12)}`
  const geraet: Geraet = {
    id,
    name: nameSauber(name),
    abdruck: abdruckVon(schluessel),
    angelegt: jetzt,
    zuletzt: jetzt,
  }
  return { ablage: { ...ablage, geraete: [...ablage.geraete, geraet] }, schluessel, id }
}

/** Zu welchem Geraet gehoert dieser Schluessel? Vergleich in konstanter Zeit. */
export function geraetZuSchluessel(ablage: Kopplungsablage, schluessel: unknown): Geraet | null {
  if (typeof schluessel !== 'string' || !/^[0-9a-f]{64}$/.test(schluessel)) return null
  const gesucht = Buffer.from(abdruckVon(schluessel), 'hex')
  return ablage.geraete.find((g) => timingSafeEqual(Buffer.from(g.abdruck, 'hex'), gesucht)) ?? null
}

export function geraetEntfernen(ablage: Kopplungsablage, id: string): Kopplungsablage {
  return { ...ablage, geraete: ablage.geraete.filter((g) => g.id !== id) }
}

/**
 * Darf diese Anfrage der App durch?
 *
 * NUR FUER ANFRAGEN, DIE SICH ALS APP AUSWEISEN (`x-mixpi-app`) — so
 * entschieden: gesperrt wird die App, nicht das Netz.
 */
export function appDarf(ablage: Kopplungsablage, pfad: string, schluessel: unknown): boolean {
  if (ablage.ohneKopplung) return true
  if (OFFEN_FUER_APP.includes(pfad)) return true
  return geraetZuSchluessel(ablage, schluessel) !== null
}

/**
 * Was im QR steht: derselbe Code, plus WO die Box ist — so fuegt ein Scan die
 * Box hinzu UND koppelt sie in einem Schritt.
 *
 * SO KURZ, WEIL DER KINDERSCHIRM ES SELBST ZEICHNET: sein QR-Erzeuger
 * (`qrGitter`, NewDesign/app.js) kann hoechstens 42 Bytes. Ein
 * `mixpibox://koppeln?adresse=…&port=…&code=…&name=…` waeren rund 78
 * gewesen; `mixpi:192.168.178.62:8200:012345` sind 32. Den Namen der Box holt
 * die App ohnehin ueber `/api/box`.
 */
export function qrInhalt(adresse: string, port: number, code: string): string {
  return `mixpi:${adresse}:${port}:${code}`
}

/** Das Gegenstueck fuer Zeugen und fuer jeden, der den QR lesen will. */
export function qrLesen(text: unknown): { adresse: string; port: number; code: string } | null {
  const m = /^mixpi:([0-9a-zA-Z.-]{1,63}):(\d{1,5}):(\d{6})$/.exec(String(text ?? ''))
  if (!m) return null
  return { adresse: m[1], port: Number(m[2]), code: m[3] }
}
