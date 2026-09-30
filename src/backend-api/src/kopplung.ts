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
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

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
/**
 * So oft darf EIN Geraet (eine Absenderadresse) falsch raten — danach ist der
 * Code fuer dieses Geraet verbrannt, fuer die anderen nicht.
 */
export const MAX_FEHLVERSUCHE = 5
/**
 * Und so oft alle zusammen, dann ist das Fenster zu. Sechs Ziffern sind eine
 * Million Moeglichkeiten: 20 Versuche je Fenster sind 1 zu 50 000, und jedes
 * Fenster braucht einen Menschen vor der Box.
 */
export const MAX_FEHLVERSUCHE_GESAMT = 20

/**
 * Was die App OHNE Kopplung erreichen darf: sich als Box ausweisen lassen
 * (die Suche im WLAN), koppeln, fragen, ob sie gekoppelt ist, und — seit
 * 29.09.2026 — pruefen, ob eine neue Adresse dieselbe Box ist (`beweis`).
 * Sonst nichts.
 */
export const OFFEN_FUER_APP: readonly string[] = [
  '/api/box',
  '/api/kopplung/anfrage',
  '/api/kopplung/beweis',
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
 * Wie eine Code-Pruefung ausgeht.
 *
 * `vergeben` und `zuOft` gibt es seit 29.09.2026. Vorher hiess beides
 * „keins" — und ein Handy, das zu spaet kam, las „An der Box ist gerade kein
 * Code offen", waehrend die Eltern ihn dort noch sahen. Dass ein ANDERES
 * Geraet schneller war, ist genau der Satz, der sie stutzig machen soll.
 */
export type Urteil = 'ok' | 'falsch' | 'zuOft' | 'vergeben' | 'abgelaufen' | 'keins'

/**
 * Das offene Kopplungsfenster — hoechstens eins, im Speicher der Box.
 *
 * NICHT GESPEICHERT: ein Neustart der Box schliesst es. Das ist gewollt; ein
 * Code, der einen Neustart ueberlebt, lebte laenger, als ihn jemand ansieht.
 *
 * ── WARUM EIN VON HAND GEOEFFNETES FENSTER AN KEIN GERAET GEBUNDEN IST ────
 * (Entscheidung 29.09.2026, AUDIT-2026-09-28 §1b Rang 6c.) Die Bitte aus der
 * App bindet, weil es dort ein Geraet gibt, BEVOR der Code existiert: die Box
 * zeigt, wer fragt, und wer am Schirm das Fenster oeffnet, sagt Ja zu genau
 * diesem Handy. Ein Fenster, das jemand von Hand oeffnet (der QR-Weg fuer eine
 * neue Box), hat kein solches Geraet. Die naheliegende Bindung „an das erste
 * Geraet, das einen Code probiert" waere keine Zustimmung, sondern ein
 * Wettlauf: wer den Code vom Schirm abliest, ist mit ihr genauso schnell wie
 * ohne — und EIN beliebiger Rateversuch irgendeines Geraets im WLAN (das
 * Tablet des Kindes) sperrte das Handy der Eltern aus, wo es heute fuenf
 * brauchte. Der Code bliebe gleich geheim, das Fenster wuerde leichter
 * kaputtzumachen. Was es statt dessen gibt:
 *   * JE GERAET EIN EIGENES FEHLERKONTO (MAX_FEHLVERSUCHE), und erst
 *     MAX_FEHLVERSUCHE_GESAMT schliessen das Fenster fuer alle. Ein einzelnes
 *     Geraet kann den Code der Eltern nicht mehr verbrennen (Rang 6d) — das
 *     gilt auch fuer ein gebundenes Fenster: fremde Versuche gingen bis
 *     hierher vom Konto des gebetenen Handys ab.
 *   * `vergeben`: war ein anderes Geraet mit dem richtigen Code schneller,
 *     erfaehrt das das naechste — statt „kein Code offen".
 * Was wirklich bindet, waere eine Rueckfrage AM SCHIRM nach dem richtigen
 * Code („Handy ‹Name› koppeln?"). Das aendert den Ablauf und den
 * Kinderschirm; es steht als Vorschlag in der README der App.
 */
export class Kopplungsfenster {
  private code: string | null = null
  private bis = 0
  /** Fehlversuche je Absenderadresse — hoechstens MAX_FEHLVERSUCHE_GESAMT Eintraege je Fenster. */
  private fehlerJe = new Map<string, number>()
  private fehlerGesamt = 0
  /** Nur fuer DIESE Absenderadresse — gesetzt, wenn ein Handy selbst gefragt hat. */
  private fuer: string | null = null
  /** Warum das Fenster vor seiner Zeit zuging — das erfaehrt, wer bis `bis` noch kommt. */
  private zuWeil: 'vergeben' | 'zuOft' | null = null

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
    this.fehlerJe.clear()
    this.fehlerGesamt = 0
    this.fuer = fuer
    this.zuWeil = null
    return { code, bis: this.bis }
  }

  /** Von Hand zu (die Eltern verlassen das Fach): danach weiss niemand mehr, warum. */
  schliessen(): void {
    this.code = null
    this.zuWeil = null
  }

  /** Ist gerade eins offen? (Fuer die Anzeige an der Box.) */
  offen(jetzt: number): { code: string; bis: number } | null {
    if (!this.code || jetzt > this.bis) return null
    return { code: this.code, bis: this.bis }
  }

  /**
   * Einen Code pruefen. `ok` schliesst das Fenster — ein Code koppelt genau
   * EIN Handy. Nach MAX_FEHLVERSUCHE falschen ist er fuer DIESES Geraet
   * verbrannt (`zuOft`), nach MAX_FEHLVERSUCHE_GESAMT fuer alle.
   *
   * `von` ist die Absenderadresse; `null` (Zeugen) zaehlt wie ein Geraet.
   */
  pruefen(code: unknown, jetzt: number, von: string | null = null): Urteil {
    if (!this.code) return this.zuWeil !== null && jetzt <= this.bis ? this.zuWeil : 'keins'
    if (jetzt > this.bis) {
      this.code = null
      return 'abgelaufen'
    }
    const wer = von ?? ''
    const bisher = this.fehlerJe.get(wer) ?? 0
    // VOR DEM VERGLEICH: wer sein Konto aufgebraucht hat, bekommt auch fuer
    // den richtigen Code keine Antwort mehr, die etwas ueber ihn verraet.
    if (bisher >= MAX_FEHLVERSUCHE) return 'zuOft'
    const passt =
      (this.fuer === null || this.fuer === von) &&
      typeof code === 'string' &&
      code.length === this.code.length &&
      timingSafeEqual(Buffer.from(code), Buffer.from(this.code))
    if (passt) {
      this.code = null
      this.zuWeil = 'vergeben'
      return 'ok'
    }
    this.fehlerJe.set(wer, bisher + 1)
    this.fehlerGesamt++
    if (this.fehlerGesamt >= MAX_FEHLVERSUCHE_GESAMT) {
      this.code = null
      this.zuWeil = 'zuOft'
    }
    return 'falsch'
  }
}

/**
 * DER BEWEIS, DASS EINE BOX EIN HANDY KENNT — ohne dass der Schluessel dafuer
 * irgendwohin muss (29.09.2026, AUDIT-2026-09-28 §1b Rang 6a).
 *
 * Wofuer: die App bekommt fuer eine gekoppelte Box eine neue Adresse (neues
 * DHCP-Lease, oder ein Tippfehler). Bis hierher schickte sie ihren Schluessel
 * dorthin, ohne zu wissen, wer antwortet. Jetzt fragt sie erst `beweis` mit
 * einer frischen Zufallsfrage und rechnet selbst nach.
 *
 * WARUM DER ABDRUCK DER RICHTIGE SCHLUESSEL FUER DEN HMAC IST: er ist das
 * einzige Geheimnis, das Box und Handy teilen, ohne dass es je uebers Netz
 * ging — die Box speichert nur ihn, das Handy kann ihn aus seinem Schluessel
 * rechnen. Ihn zu kennen oeffnet die Sperre NICHT (`geraetZuSchluessel` will
 * das Urbild), und aus dem HMAC laesst er sich nicht zurueckrechnen.
 *
 * Die Vorsilbe trennt diesen Gebrauch von jedem kuenftigen anderen HMAC mit
 * demselben Abdruck. Der Prueffall in kopplung.spec.ts steht wortgleich in
 * handy-app/test/box_client_test.dart (`kopplungsBeweis`).
 */
export const BEWEIS_VORSILBE = 'mixpi-kopplung-beweis:'

export function beweisVon(abdruck: string, frage: string): string {
  return createHmac('sha256', Buffer.from(abdruck, 'hex'))
    .update(BEWEIS_VORSILBE + frage, 'utf8')
    .digest('hex')
}

/**
 * Je gekoppeltem Handy ein Beweis — `null` fuer eine Frage, die keine ist.
 *
 * FUER ALLE HANDYS STATT FUER EINES: sonst muesste die App sagen, WELCHES sie
 * ist, und dieser Hinweis (Kennung oder Teil des Abdrucks) ginge an eine
 * Adresse, der sie gerade nicht traut. So verraet die Antwort nur, wie viele
 * Handys gekoppelt sind.
 */
export function beweiseFuer(ablage: Kopplungsablage, frage: unknown): string[] | null {
  if (typeof frage !== 'string' || !/^[0-9a-f]{32,128}$/.test(frage)) return null
  return ablage.geraete.map((g) => beweisVon(g.abdruck, frage))
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
