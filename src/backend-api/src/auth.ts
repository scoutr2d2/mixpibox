/**
 * Anmeldung für die API.
 *
 * WARUM ÜBERHAUPT — am Gerät nachgemessen (2026-07): die API war aus dem LAN
 * OHNE jede Anmeldung erreichbar, über HTTP wie über HTTPS. Darunter
 * /api/shutdown und /api/reboot (beide führen `sudo` aus) sowie die Schreiber
 * für Medien und Konfiguration. Ein einziger curl von einem fremden Rechner
 * genügte. Bevor die neue Verwaltungsoberfläche weitere Befehle hier
 * hereinlegt, muss diese Tür ein Schloss haben.
 *
 * DREI ENTWURFSREGELN, jede mit einem Grund:
 *
 * 1. DAS VORHANDENE PASSWORT, kein zweites Geheimnis. Es steht als
 *    bcrypt-Hash in mupiboxconfig.json unter interfacelogin.password — dort
 *    hat der PHP-Admin es schon immer gelesen. Zwei Passwörter für dieselbe
 *    Box wären eine Einladung, eines davon schwach zu wählen.
 *
 * 2. DER VORHANDENE SCHALTER interfacelogin.state entscheidet. Steht er auf
 *    false, bleibt alles offen wie bisher — eine Bestandsbox darf nach einem
 *    Update nicht plötzlich nach einem Passwort fragen, das ihr Besitzer nie
 *    gesetzt hat. Die API sagt den Zustand aber ANSAGE, damit die Oberfläche
 *    darauf hinweisen kann.
 *
 * 3. DIE BOX SELBST BRAUCHT NIE EIN PASSWORT. Der Kiosk-Browser läuft auf der
 *    Box und ruft über die Rückschleife; verlangte man dort eine Anmeldung,
 *    bliebe der Bildschirm nach dem Einschalten leer. Alles, was NICHT von
 *    127.0.0.1 kommt, ist dagegen „von außen" und braucht eine Sitzung.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'

/** Wie lange eine Anmeldung gilt (ms). Bewusst großzügig: eine Einrichtung
 *  dauert, und ein Abmelden mitten im Spotify-Ablauf wäre ärgerlich. */
export const SITZUNGSDAUER_MS = 12 * 60 * 60 * 1000
export const COOKIE_NAME = 'mupi_admin'

/**
 * Kommt die Anfrage von der Box selbst? Pure.
 *
 * Node liefert IPv4-Adressen über einen IPv6-Sockel als „::ffff:127.0.0.1" —
 * ein Vergleich auf „127.0.0.1" allein übersieht genau den Normalfall.
 */
export function istRueckschleife(addr?: string | null): boolean {
  if (!addr) return false
  const a = addr.trim().toLowerCase().replace(/^::ffff:/, '')
  if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a)
}

/** Cookie-Kopfzeile in ein Wörterbuch zerlegen. Pure, ohne Zusatzpaket. */
export function cookiesLesen(kopf?: string): Record<string, string> {
  const raus: Record<string, string> = {}
  if (!kopf) return raus
  for (const teil of kopf.split(';')) {
    const i = teil.indexOf('=')
    if (i < 1) continue
    const k = teil.slice(0, i).trim()
    if (!k) continue
    try {
      raus[k] = decodeURIComponent(teil.slice(i + 1).trim())
    } catch {
      raus[k] = teil.slice(i + 1).trim() // kaputte Kodierung: roh nehmen
    }
  }
  return raus
}

/**
 * Sitzungen im Arbeitsspeicher.
 *
 * Bewusst NICHT auf der Platte: die Box wird ausgesteckt statt heruntergefahren,
 * und eine Sitzung, die einen Stromausfall überlebt, ist eher ein Risiko als
 * eine Bequemlichkeit. Ein Neustart des Backends meldet alle ab — richtig so.
 */
export class Sitzungen {
  private readonly offen = new Map<string, number>()

  constructor(private readonly dauerMs: number = SITZUNGSDAUER_MS) {}

  anlegen(jetzt: number = Date.now()): string {
    this.aufraeumen(jetzt)
    const id = randomBytes(32).toString('base64url')
    this.offen.set(id, jetzt + this.dauerMs)
    return id
  }

  gueltig(id?: string, jetzt: number = Date.now()): boolean {
    if (!id) return false
    const bis = this.offen.get(id)
    if (bis === undefined) return false
    if (bis <= jetzt) {
      this.offen.delete(id)
      return false
    }
    return true
  }

  beenden(id?: string): void {
    if (id) this.offen.delete(id)
  }

  alleBeenden(): void {
    this.offen.clear()
  }

  get anzahl(): number {
    return this.offen.size
  }

  private aufraeumen(jetzt: number): void {
    for (const [id, bis] of this.offen) if (bis <= jetzt) this.offen.delete(id)
  }
}

/**
 * Passwort gegen den gespeicherten Hash prüfen.
 *
 * PHP schreibt seine bcrypt-Hashes mit der Kennung `$2y$`, bcryptjs erzeugt
 * `$2b$` — die Verfahren sind identisch und die Bibliothek akzeptiert beide
 * (nachgeprüft). Ein leerer Hash ergibt IMMER false: eine Box ohne gesetztes
 * Passwort darf niemanden hereinlassen, nicht jeden.
 *
 * ASYNCHRON, UND DAS IST DER PUNKT (AUDIT-2026-09-05-B §7.1): `compareSync`
 * hielt je Versuch den GANZEN Ereignis-Kreisel an — bcrypt ist mit Absicht
 * langsam, und der Kiosk pollt dieselbe API im Sekundentakt. Wer parallel
 * falsche Passwörter schickte, ließ damit nicht nur den Login rechnen,
 * sondern die Box stottern. `bcrypt.compare` rechnet in Häppchen und lässt
 * die übrigen Anfragen zwischendurch dran. Eine synchrone Fassung gibt es
 * bewusst NICHT mehr — wer sie wieder einführt, führt die Blockade wieder
 * ein.
 */
export async function passwortStimmt(eingabe: string, hash?: string | null): Promise<boolean> {
  if (!hash || !eingabe) return false
  try {
    return await bcrypt.compare(eingabe, hash)
  } catch {
    return false // unbrauchbarer Hash -> abweisen, nicht durchwinken
  }
}

/** Zwei Zeichenketten zeitkonstant vergleichen (für Sitzungskennungen). */
export function gleichOhneZeitverrat(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

export interface TorEinstellungen {
  /** Ist die Anmeldung eingeschaltet? (interfacelogin.state) */
  anmeldungNoetig: () => boolean
  sitzungen: Sitzungen
  /** Pfade, die IMMER offen sind — die Anmeldung selbst und ihr Zustand. */
  offenePfade?: string[]
}

export const OFFENE_PFADE = [
  '/api/auth/login',
  '/api/auth/state',
  '/api/auth/logout',
  // Die Sperre vor den Einstellungen der Box.
  //
  // WARUM OFFEN: sie wird am Bildschirm der Box bedient. Regel 3 oben deckt
  // das eigentlich schon ab — aber nur dann, wenn der Kiosk wirklich über
  // 127.0.0.1 anruft. Ruft er die Box unter ihrem eigenen Namen oder ihrer
  // LAN-Adresse an (und genau so ist sie verlinkt, damit die Einrichtung von
  // einem anderen Rechner aus funktioniert), gilt er als „von außen" und
  // bekäme bei eingeschalteter Anmeldung eine 401 — der Dialog vor den
  // Einstellungen hinge dann für immer.
  //
  // WARUM VERTRETBAR: die Antwort ist ausschließlich ja/nein. Sie verrät nicht
  // einmal, OB eine PIN gesetzt ist, sie gibt nichts heraus und sie ändert
  // nichts. Wer sie richtig rät, kommt an die BILDSCHIRMSEITEN der Box — die
  // gefährlichen Wege dahinter (/api/network, /api/shutdown, die
  // Medienschreiber) liegen weiterhin hinter diesem Tor. Und wer vor der Box
  // steht, könnte sie ohnehin einfach ausschalten.
  '/api/einstellungen/pin-pruefen',
  // /api/wartung steht BEWUSST NICHT hier: dieses Tor prueft nur req.path,
  // ohne Methode — ein Eintrag oeffnete GET UND POST zugleich, und genau das
  // POST (Sperr-Schirm setzen) muss zu bleiben. Die Trennung macht die
  // Express-Reihenfolge in server.ts: GET vor dem Tor, POST dahinter.
]

/**
 * Das Tor als Express-Zwischenschicht.
 *
 * Reihenfolge der Prüfungen ist Absicht: erst „ist überhaupt abgeschlossen?",
 * dann „kommt es von der Box selbst?", dann „darf dieser Pfad immer?", zuletzt
 * die Sitzung. So kann ein Fehler in der Sitzungsverwaltung die Box nie
 * aussperren.
 */
export function torBauen(o: TorEinstellungen) {
  const offen = new Set(o.offenePfade ?? OFFENE_PFADE)
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!o.anmeldungNoetig()) {
      next()
      return
    }
    if (istRueckschleife(req.socket?.remoteAddress)) {
      next()
      return
    }
    if (offen.has(req.path)) {
      next()
      return
    }
    const id = cookiesLesen(req.headers.cookie)[COOKIE_NAME]
    if (o.sitzungen.gueltig(id)) {
      next()
      return
    }
    res.status(401).json({ error: 'anmeldung erforderlich' })
  }
}

/** Cookie-Kopfzeile für eine frische Sitzung. `sicher` = nur über HTTPS. */
export function sitzungsCookie(id: string, sicher: boolean): string {
  const teile = [
    `${COOKIE_NAME}=${id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SITZUNGSDAUER_MS / 1000)}`,
  ]
  // Secure NUR über TLS setzen: auf der Box läuft die Oberfläche über
  // http://<box>:8200, ein Secure-Cookie käme dort nie an.
  if (sicher) teile.push('Secure')
  return teile.join('; ')
}

/** Cookie-Kopfzeile, die eine Sitzung im Browser löscht. */
export function abmeldeCookie(sicher: boolean): string {
  const teile = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
  if (sicher) teile.push('Secure')
  return teile.join('; ')
}
