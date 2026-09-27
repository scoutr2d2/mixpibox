/**
 * Jellyfin-Anmeldung ohne Schlüssel — QuickConnect, aber von der BOX geführt.
 *
 * ══ DER FALL, WEGEN DEM ES DAS GIBT ═══════════════════════════════════════
 * Gemeldet am 08.08.2026: „der jellyfin quickconnect ist verlorhen in beiden
 * admin menüs jellyfin ist verbunden aber er meldet das man noch anmelden muss
 * man kann es auch nicht mehr anstoßen."
 *
 * AM GERÄT NACHGESEHEN (.169), und die Meldung stimmt in jedem Teil:
 *   * QuickConnect gibt es nur in der KLASSISCHEN Oberfläche, auf der Seite
 *     `/jellyfin`. Auf diese Seite verweist NICHTS — kein Knopf, kein Menü.
 *     Sie ist nur erreichbar, wenn man die Adresse tippt.
 *   * In `/etc/mupibox/mupiboxconfig.json` steht unter `jellyfin` allein die
 *     Serveradresse. Kein Schlüssel. `/api/streaming` meldet deshalb zu Recht
 *     „Server eingetragen, aber kein API-Schlüssel".
 *   * In `data.json` liegen 29 Einträge, davon NULL von Jellyfin. Auch der
 *     Rückweg über die Coveradressen (`jellyfinZugangAusListe` in medien.ts)
 *     trägt hier also nichts.
 *
 * ══ WARUM DER ABLAUF AUF DEN SERVER GEHÖRT UND NICHT IN DEN BROWSER ═══════
 *
 * Die klassische Fassung legt den gewonnenen Zugang im `localStorage` DES
 * BROWSERS ab, in dem man die Anmeldung gemacht hat. Das hat drei Folgen, und
 * alle drei sind der Grund für diese Datei:
 *
 *   1. NUR DIESER BROWSER WEISS ES. Wer sich am Rechner anmeldet, hat die Box
 *      selbst nicht angemeldet — und umgekehrt.
 *   2. DER SERVER WEISS ES NIE. Er braucht den Schlüssel aber für Cover
 *      (`/api/bild/jellyfin/:kennung`) und Ton (`/api/jellyfin/strom/:kennung`).
 *      Heute stiehlt er ihn sich aus den Coveradressen gespeicherter Medien —
 *      ein Umweg, der nur funktioniert, wenn schon einmal jemand Medien
 *      aufgenommen hat.
 *   3. EIN GELEERTER BROWSERSPEICHER LÖSCHT DIE ANMELDUNG. Für ein Gerät im
 *      Kinderzimmer ist das die falsche Haltbarkeit.
 *
 * Hier läuft der Ablauf deshalb IN DER BOX: sie holt den Code, sie fragt nach,
 * sie tauscht ihn ein, und sie schreibt das Ergebnis nach `jellyfin.apiKey`.
 * Beide Verwaltungen zeigen danach dasselbe, und der Server kann selbst
 * abspielen.
 *
 * ══ WAS NIE HINAUSGEHT ════════════════════════════════════════════════════
 * DAS `Secret` BLEIBT IM SERVER. Es ist der Griff, mit dem sich ein
 * genehmigter Ablauf in einen Zugangsschlüssel eintauschen lässt — wer es hat,
 * bekommt den Schlüssel. Die Oberfläche bekommt deshalb NUR den `Code` (der
 * ist zum Vorzeigen gedacht) und einen Stand. Der Schlüssel selbst geht
 * ebenfalls nie hinaus; `konfiguration.ts` gibt an einem Feld der Art
 * `geheim` ohnehin nur „gesetzt" heraus.
 *
 * ══ REIN ══════════════════════════════════════════════════════════════════
 * Kein Netz, kein Dateisystem, kein Express. Diese Datei baut Adressen und
 * Kopfzeilen und entscheidet über den Stand eines Ablaufs; wer damit
 * telefoniert, steht in server.ts.
 */

/** Wie sich die Box bei Jellyfin vorstellt. */
export interface Geraet {
  /** Name des Programms — steht in Jellyfin in der Geräteliste. */
  client: string
  /** Name des Geräts. */
  device: string
  /** Beständige Kennung. Wechselt sie, ist es für Jellyfin ein neues Gerät. */
  deviceId: string
  version: string
}

/** Ein laufender Ablauf, wie ihn der Server sich merkt. */
export interface Ablauf {
  /** Was der Mensch in Jellyfin eintippt. Darf hinaus. */
  code: string
  /** Der Griff zum Eintauschen. Darf NIE hinaus — siehe der Kopf dieser Datei. */
  secret: string
  /** Wann er begonnen hat (ms). */
  begonnen: number
  /** Für welchen Server er gilt. Wechselt die Adresse, ist er wertlos. */
  server: string
}

/**
 * Wie lange ein Ablauf gilt.
 *
 * JELLYFIN SELBST WIRFT IHN NACH RUND ZEHN MINUTEN WEG (Vorgabe
 * `QuickConnect.Timeout`, 10 min). Fünf Minuten sind kürzer als das mit
 * Absicht: Ein Code, der am Bildschirm steht, aber serverseitig längst
 * verfallen ist, ist die schlechteste Auskunft von allen — er sieht gültig
 * aus. Lieber sagt die Box früher „abgelaufen, noch einmal anstoßen".
 */
export const ABLAUF_MS = 5 * 60 * 1000

/** Ein Server ohne abschliessenden Schrägstrich. */
export function basis(server: unknown): string {
  return String(server ?? '')
    .trim()
    .replace(/\/+$/, '')
}

export function istServer(server: unknown): boolean {
  return /^https?:\/\/[^\s/]+/i.test(basis(server))
}

export function wegEnabled(server: string): string {
  return `${basis(server)}/QuickConnect/Enabled`
}

export function wegInitiate(server: string): string {
  return `${basis(server)}/QuickConnect/Initiate`
}

export function wegConnect(server: string, secret: string): string {
  return `${basis(server)}/QuickConnect/Connect?Secret=${encodeURIComponent(secret)}`
}

export function wegAuthenticate(server: string): string {
  return `${basis(server)}/Users/AuthenticateWithQuickConnect`
}

/**
 * Die `Authorization`-Kopfzeile, mit der Jellyfin ein Gerät erkennt.
 *
 * SIE IST BEI QUICKCONNECT PFLICHT, obwohl noch niemand angemeldet ist: Der
 * Ablauf ordnet den Code genau diesem Gerät zu, und ohne die Kopfzeile
 * antwortet Jellyfin mit 400.
 *
 * ANFÜHRUNGSZEICHEN UM JEDEN WERT, und die Werte werden von Anführungszeichen
 * BEFREIT, bevor sie hineingehen. Ein Gerätename mit einem " darin zerbräche
 * sonst die Kopfzeile — und ein zerbrochener Kopf sieht wie ein Serverfehler
 * aus, nicht wie ein Name mit einem Sonderzeichen.
 */
export function geraeteKopf(g: Geraet): string {
  const sauber = (w: unknown) =>
    String(w ?? '')
      .replace(/["\\\r\n]/g, '')
      .trim()
  return (
    'MediaBrowser ' +
    [
      `Client="${sauber(g.client) || 'MuPiBox'}"`,
      `Device="${sauber(g.device) || 'MuPiBox'}"`,
      `DeviceId="${sauber(g.deviceId) || 'mupibox'}"`,
      `Version="${sauber(g.version) || '1.0.0'}"`,
    ].join(', ')
  )
}

/**
 * Der Code aus Jellyfins Antwort auf `Initiate`.
 *
 * `null`, wenn die Antwort nicht trägt, was sie soll. Ein leerer Code wäre
 * schlimmer als keiner: er stünde als leere Zeile am Bildschirm, und man
 * tippte in Jellyfin ins Nichts.
 */
export function ablaufAus(antwort: unknown, server: string, jetzt: number): Ablauf | null {
  if (!antwort || typeof antwort !== 'object') return null
  const o = antwort as Record<string, unknown>
  const code = String(o.Code ?? '').trim()
  const secret = String(o.Secret ?? '').trim()
  if (!code || !secret) return null
  return { code, secret, begonnen: Number(jetzt) || 0, server: basis(server) }
}

/** Ist dieser Ablauf noch gültig — und gilt er noch für DIESEN Server? */
export function nochGueltig(a: Ablauf | null, server: unknown, jetzt: number): boolean {
  if (!a) return false
  if (basis(server) !== a.server) return false
  return jetzt - a.begonnen < ABLAUF_MS
}

/** Was die Oberfläche über einen Ablauf erfährt — ohne das Secret. */
export interface Stand {
  laeuft: boolean
  code: string | null
  /** Sekunden, bis er verfällt. */
  restSekunden: number
}

export function standVon(a: Ablauf | null, server: unknown, jetzt: number): Stand {
  if (!nochGueltig(a, server, jetzt) || !a) return { laeuft: false, code: null, restSekunden: 0 }
  return {
    laeuft: true,
    code: a.code,
    restSekunden: Math.max(0, Math.round((ABLAUF_MS - (jetzt - a.begonnen)) / 1000)),
  }
}

/**
 * Hat Jellyfin den Code inzwischen genehmigt?
 *
 * NUR `true` ZÄHLT. Jellyfin antwortet auf `Connect` mit dem ganzen Ablauf und
 * einem Feld `Authenticated`; alles andere (fehlend, "false", 0) heisst
 * „noch nicht". Hier stünde sonst die Falle, dass ein `undefined` als
 * „genehmigt" durchginge und die Box einen Tausch versucht, der nur einen
 * Fehler zurückgibt.
 */
export function istGenehmigt(antwort: unknown): boolean {
  if (!antwort || typeof antwort !== 'object') return false
  return (antwort as Record<string, unknown>).Authenticated === true
}

/** Was beim Eintausch herauskommt. */
export interface Zugang {
  schluessel: string
  benutzer: string
}

/**
 * Den Zugang aus Jellyfins Antwort auf `AuthenticateWithQuickConnect` holen.
 *
 * `null` OHNE SCHLÜSSEL, auch wenn ein Benutzername dasteht: Ein Name ohne
 * Schlüssel ist keine halbe Anmeldung, sondern gar keine — und würde als
 * „angemeldet als Achim" angezeigt, während nichts spielt.
 */
export function zugangAus(antwort: unknown): Zugang | null {
  if (!antwort || typeof antwort !== 'object') return null
  const o = antwort as Record<string, unknown>
  const schluessel = String(o.AccessToken ?? '').trim()
  if (!schluessel) return null
  const u = o.User
  const benutzer = u && typeof u === 'object' ? String((u as Record<string, unknown>).Name ?? '').trim() : ''
  return { schluessel, benutzer }
}
