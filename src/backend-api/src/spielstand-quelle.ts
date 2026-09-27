/**
 * DIE QUELLE DES SPIELSTANDS — nach Faehigkeit, nicht nach Motor (E75).
 *
 * Der Grundweg ist die Web-API; gibt es einen lokalen Draht, wird er genommen.
 * Die ausfuehrliche Begruendung steht im Kopf von `spielstand.ts`.
 *
 * ══ WAS HIER DAS PRUEFBARE STUECK IST ══════════════════════════════════════
 *
 * `aufnehmen()`. Ein Ereignis hinein, der innere Stand fort — ohne Steckdose,
 * ohne Uhr, ohne Netz. Soloist schickt naemlich NICHT bei jeder Aenderung den
 * vollen Zustand, sondern meistens Haeppchen (`track_changed`,
 * `volume_changed`, `position_sync`), und wer die falsch zusammensetzt, hat
 * einen Schirm, der irgendwann etwas anderes zeigt als die Box spielt.
 *
 * Das Verbinden selbst bleibt duenn und wird von aussen hereingereicht — ein
 * echter Socket in der Box, ein Doppel im Zeugenstand.
 */
import { type Spielstand, ausSoloist } from './spielstand'

/** Ein lokaler Draht. Absichtlich schmal — mehr braucht es hier nicht. */
export interface Draht {
  /** Wird bei jeder Nachricht gerufen. Der Text ist ein JSON-Rahmen. */
  beiNachricht(cb: (roh: string) => void): void
  /** Wird gerufen, wenn der Draht faellt — gleich aus welchem Grund. */
  beiEnde(cb: () => void): void
  senden(text: string): void
  schliessen(): void
}

export interface QuelleGaben {
  /**
   * Wo der lokale Draht steckt — oder `null`.
   *
   * DAS FINDEN BLEIBT QUELLENSPEZIFISCH, und das ist Absicht: Soloist legt
   * `ws.addr` und `ws.port` in seinen Datenordner, eine andere Maschine legte
   * es woanders hin. Agnostisch ist der VERBRAUCHER, nicht das Verzeichnis.
   */
  endpunkt: () => Promise<string | null>
  /** Der Grundweg. Wird gefragt, solange kein Draht steht. */
  webApi: () => Promise<Spielstand>
  verbinden: (url: string) => Promise<Draht>
  uhr?: () => number
  melden?: (zeile: string) => void
}

export class SpielstandQuelle {
  private draht: Draht | null = null
  private zustand: unknown = null
  private anmeldung: unknown = null
  /** Wie viele Ereignisse seit dem Verbinden ankamen — fuer `--pruefen`. */
  private ereignisse = 0

  constructor(private readonly gaben: QuelleGaben) {}

  private get uhr(): number {
    return (this.gaben.uhr ?? Date.now)()
  }

  private sagen(zeile: string): void {
    this.gaben.melden?.(zeile)
  }

  /** `websocket`, solange der Draht steht — sonst `webapi`. */
  get quelle(): 'websocket' | 'webapi' {
    return this.draht && this.zustand !== null ? 'websocket' : 'webapi'
  }

  /**
   * Ist die Box bei Spotify angemeldet? `null` = nicht zu erfahren.
   *
   * DAS IST DIE AUSKUNFT, DIE ES BISHER NIRGENDS GAB. Am 22.08.2026 war die
   * Box zwei Tage lang abgemeldet und niemand erfuhr es — die Web-API kann das
   * nicht sagen, sie sieht nur, ob IRGENDWO etwas spielt.
   */
  get angemeldet(): boolean | null {
    const a = this.anmeldung as { logged_in?: unknown } | null
    return typeof a?.logged_in === 'boolean' ? a.logged_in : null
  }

  /**
   * Ein Ereignis einarbeiten. Liefert `true`, wenn es verstanden wurde.
   *
   * DIE HAEPPCHEN AENDERN NUR IHR FELD. Ein `volume_changed` darf den Titel
   * nicht loeschen, ein `track_changed` nicht den Status — sonst zeigt der
   * Schirm nach dem ersten Lautstaerkeknopf eine leere Kachel.
   */
  aufnehmen(roh: string): boolean {
    let n: Record<string, unknown>
    try {
      n = JSON.parse(roh) as Record<string, unknown>
    } catch {
      return false
    }
    const art = typeof n.type === 'string' ? n.type : ''
    const alt = (this.zustand ?? {}) as Record<string, unknown>
    this.ereignisse++

    switch (art) {
      case 'auth_state':
        this.anmeldung = n
        return true
      case 'playback_state':
        // DER VOLLE STAND ERSETZT, die Haeppchen ergaenzen.
        this.zustand = n
        return true
      case 'track_changed':
        this.zustand = { ...alt, item: n.item }
        return true
      case 'playback_changed':
        this.zustand = { ...alt, status: n.status }
        return true
      case 'context_changed':
        this.zustand = { ...alt, context: n.context }
        return true
      case 'position_sync':
        this.zustand = { ...alt, position: n.position }
        return true
      case 'device_changed':
        // GEHOERT ZUR ANMELDUNG, nicht zum Zustand: `is_active` und
        // `device_name` stehen dort, und `ausSoloist` nimmt den juengeren Wert.
        this.anmeldung = { ...((this.anmeldung ?? {}) as object), ...n }
        return true
      default:
        // volume_changed, options_changed, queue_changed, command_result,
        // error — nichts davon steht im Spielstand. Sie werden gezaehlt und
        // sonst in Ruhe gelassen.
        return false
    }
  }

  /**
   * Der Spielstand jetzt.
   *
   * KEIN WARTEN AUF DEN DRAHT. Steht er nicht, wird gefragt — sofort, nicht
   * nach einem Verbindungsversuch. Ein Endpunkt, der auf den Draht wartet,
   * haengt genau dann, wenn der Draht das Problem ist.
   */
  async jetzt(): Promise<Spielstand> {
    if (this.draht && this.zustand !== null) {
      return ausSoloist(this.zustand, this.anmeldung, this.uhr)
    }
    return this.gaben.webApi()
  }

  /**
   * Den Draht suchen und halten.
   *
   * FAELLT ER, WIRD ER VERGESSEN — nicht „vielleicht kommt er wieder".
   * Solange nichts steht, laeuft die Web-API weiter; das naechste
   * `verbindenVersuchen` holt ihn zurueck. Am 22.08. war Soloists Draht zehn
   * Minuten weg, waehrend gekoppelt wurde: eine Box, die in dieser Zeit ihren
   * letzten bekannten Stand weitermeldet, zeigt einen Titel, der laengst
   * vorbei ist.
   */
  async verbindenVersuchen(): Promise<boolean> {
    if (this.draht) return true
    const url = await this.gaben.endpunkt().catch(() => null)
    if (!url) return false
    try {
      const d = await this.gaben.verbinden(url)
      this.draht = d
      this.ereignisse = 0
      d.beiNachricht((roh) => this.aufnehmen(roh))
      d.beiEnde(() => this.drahtVerloren())
      // NACH DEM VERBINDEN FRAGEN, nicht auf ein Ereignis warten: Soloist
      // schickt beim Verbinden zwar einen vollen Stand, aber nur, wenn er
      // angemeldet ist. Sonst bliebe `zustand` leer und `quelle` stuende
      // still auf `webapi`, obwohl der Draht steht.
      d.senden(JSON.stringify({ type: 'command', command: 'get_auth_state' }))
      d.senden(JSON.stringify({ type: 'command', command: 'get_state' }))
      this.sagen(`Spielstand: lokaler Draht steht (${url})`)
      return true
    } catch (f) {
      this.sagen(`Spielstand: kein lokaler Draht (${(f as Error).message}) — Web-API bleibt`)
      return false
    }
  }

  private drahtVerloren(): void {
    if (!this.draht) return
    this.draht = null
    this.zustand = null
    this.anmeldung = null
    this.sagen('Spielstand: lokaler Draht weg — zurueck auf die Web-API')
  }

  /** Beim Herunterfahren. */
  schliessen(): void {
    try {
      this.draht?.schliessen()
    } catch {
      /* schon weg */
    }
    this.draht = null
  }

  /** Was die Quelle ueber sich selbst weiss — fuer `/api/spotify/quelle`. */
  befund(): { quelle: string; angemeldet: boolean | null; ereignisse: number } {
    return { quelle: this.quelle, angemeldet: this.angemeldet, ereignisse: this.ereignisse }
  }
}
