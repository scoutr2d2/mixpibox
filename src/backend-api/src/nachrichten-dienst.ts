/**
 * Der Dienst, der die drei Wege offen haelt.
 *
 * ALLES, WAS MIT DER WELT ZU TUN HAT, steht hier — und nichts davon
 * entscheidet etwas: WER durchkommt, steht in nachrichten.ts, WIE eine
 * Antwort zu lesen ist, in nachrichten-holer.ts, und WAS auf die Karte geht,
 * in nachrichten-ablage.ts. Hier laufen nur die Schleifen.
 *
 * ══ WARUM NICHT DREI setInterval IN server.ts ══════════════════════════════
 *
 * Weil keiner der drei Wege ein TAKT ist. Matrix und Telegram HAENGEN, bis
 * etwas kommt (Long Poll), Signal haelt eine Verbindung. Ein Intervall
 * daneben fuehrte zu zwei gleichzeitigen Abfragen auf demselben Weg — bei
 * Telegram ist das ein Fehler des Dienstes („terminated by other getUpdates
 * request"), bei Matrix doppelte Arbeit. Deshalb: eine Schleife je Weg, die
 * sich selbst weiterzieht, und ein Riegel dagegen, dass zwei davon laufen.
 *
 * ══ ALLES, WAS NACH AUSSEN GEHT, HAT EINE FRIST ════════════════════════════
 *
 * `AbortSignal.timeout(FRIST_MS)` an jedem Ruf. Ohne sie haengt eine
 * abgerissene Verbindung fuer immer, die Schleife zieht nie weiter, und der
 * Weg ist still tot — genau die Sorte Ausfall, die niemand bemerkt, weil
 * nichts im Protokoll steht. Der Dienst zaehlt deshalb mit, wann zuletzt
 * etwas HEREINKAM (`stand()`), und nicht nur, ob er laeuft.
 */
import net from 'node:net'
import type { Erlaubt, Nachricht, Weg } from './nachrichten'
import { einfuegen, naechsteZumSprechen, sprechtext } from './nachrichten'
import { type Ablage, ablageLesen, ablageSchreiben, abweisungBuchen, listePruefen } from './nachrichten-ablage'
import {
  type Ausbeute,
  dienstErreichbar,
  FRIST_MS,
  MINDEST_MS,
  matrixAdresse,
  matrixAuswerten,
  RUHE_MS,
  signalZeile,
  telegramAdresse,
  telegramAuswerten,
  zeilenSchneiden,
} from './nachrichten-holer'

/** Die Nachrichten-Gruppe der Konfiguration, flach wie in der Datei. */
export interface NachrichtenKonf {
  active?: boolean
  vorlesen?: boolean
  erlaubt?: unknown
  matrixActive?: boolean
  matrixServer?: string
  matrixToken?: string
  matrixRaum?: string
  telegramActive?: boolean
  telegramToken?: string
  signalActive?: boolean
  signalHost?: string
  signalPort?: string | number
  signalNummer?: string
}

/** Was der Dienst von aussen braucht — alles gereicht, nichts gegriffen. */
export interface Umgebung {
  /** Immer frisch: die Konfiguration aendert sich im Betrieb. */
  konf: () => NachrichtenKonf
  ablagePfad: string
  jetzt: () => number
  holen: (
    adresse: string,
    o: { signal: AbortSignal; headers?: Record<string, string> },
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
  /** Ins Journal. Kurze Saetze, keine Token. */
  melden: (satz: string) => void
  /**
   * Die Frist fuer EINEN Ruf. Fehlt sie, gilt `FRIST_MS`.
   *
   * SIE STEHT HIER, DAMIT SIE PRUEFBAR IST. Eine Probe, die nur nachsieht,
   * ob ein `AbortSignal` mitkommt, haelt auch ein Signal fuer gut, das nie
   * ausloest — genau das ist beim ersten Anlauf passiert (Gegenprobe „Ruf
   * ohne Frist" blieb gruen). Mit einer kurzen Frist im Test laesst sich
   * BELEGEN, dass der Ruf wirklich abgebrochen wird.
   */
  fristMs?: number
  /** Kuerzester Abstand zwischen zwei Runden. Fehlt er, gilt `MINDEST_MS`. */
  mindestMs?: number
  /**
   * Vorlesen lassen — oder nichts tun.
   *
   * Der Dienst entscheidet NICHT, ob vorgelesen wird; er fragt. Ob das
   * aktive Profil es will, weiss nur, wer die Profile haelt (server.ts).
   */
  sprechen: (text: string) => Promise<boolean>
}

export interface Wegstand {
  an: boolean
  laeuft: boolean
  /** Wann zuletzt etwas hereinkam (ms seit 1970) — 0 heisst: noch nie. */
  zuletzt: number
  /** Der letzte Fehlschlag im Klartext, oder leer. */
  fehler: string
}

export class Nachrichtendienst {
  private u: Umgebung
  private ablage: Ablage
  private stehen: Record<Weg, Wegstand>
  private laufend = false
  private socket: net.Socket | null = null
  private uhren: NodeJS.Timeout[] = []

  constructor(u: Umgebung) {
    this.u = u
    this.ablage = ablageLesen(u.ablagePfad)
    this.stehen = {
      matrix: { an: false, laeuft: false, zuletzt: 0, fehler: '' },
      telegram: { an: false, laeuft: false, zuletzt: 0, fehler: '' },
      signal: { an: false, laeuft: false, zuletzt: 0, fehler: '' },
    }
  }

  /** Die geprueften Absender — aus der Konfiguration, bei JEDEM Ruf neu. */
  private liste(): Erlaubt[] {
    return listePruefen(this.u.konf().erlaubt).liste
  }

  nachrichten(): Nachricht[] {
    return this.ablage.nachrichten
  }

  stand(): { an: boolean; wege: Record<Weg, Wegstand>; abgewiesen: Ablage['abgewiesen']; erlaubte: number } {
    return {
      an: this.u.konf().active === true,
      wege: { ...this.stehen },
      abgewiesen: this.ablage.abgewiesen,
      erlaubte: this.liste().length,
    }
  }

  /**
   * Setzt `gelesen` oder `gesprochen` und schreibt.
   *
   * GIBT ZURUECK, OB SICH ETWAS GEAENDERT HAT. Ein Aufrufer, der „gelesen"
   * auf eine schon gelesene Nachricht setzt, soll 200 bekommen und keine
   * Schreiblast ausloesen — die Box tut das bei jedem Blick auf die Liste.
   */
  async marke(id: string, feld: 'gelesen' | 'gesprochen', wert: boolean): Promise<boolean> {
    let geaendert = false
    const neu = this.ablage.nachrichten.map((n) => {
      if (n.id !== id || n[feld] === wert) return n
      geaendert = true
      return { ...n, [feld]: wert }
    })
    if (!geaendert) return false
    this.ablage = { ...this.ablage, nachrichten: neu }
    await this.sichern()
    return true
  }

  /** Alles weg — der Knopf im Eltern-Bereich. */
  async leeren(): Promise<void> {
    this.ablage = { ...this.ablage, nachrichten: [], abgewiesen: {} }
    await this.sichern()
  }

  private async sichern(): Promise<void> {
    try {
      await ablageSchreiben(this.u.ablagePfad, this.ablage)
    } catch (e) {
      this.u.melden(`Nachrichten nicht gespeichert: ${(e as Error).message}`)
    }
  }

  /**
   * Nimmt eine Ausbeute auf: Nachrichten einlagern, Abweisungen zaehlen,
   * Marke merken — und danach EINMAL schreiben.
   */
  private async aufnehmen(weg: Weg, a: Ausbeute): Promise<void> {
    let ablage = this.ablage
    let neues = false
    for (const n of a.nachrichten) {
      // `einfuegen` wirft die Dublette weg und gibt dieselbe Liste zurueck.
      // Ob etwas NEU ist, sagt deshalb die oberste Kennung — nicht die
      // Laenge: bei vollem Ringspeicher bleibt die Laenge gleich, obwohl
      // eine neue Nachricht dazugekommen ist.
      const liste = einfuegen(ablage.nachrichten, n)
      if (liste[0]?.id === n.id && ablage.nachrichten[0]?.id !== n.id) {
        neues = true
        ablage = { ...ablage, nachrichten: liste }
      }
    }
    for (const ab of a.abgewiesen) ablage = abweisungBuchen(ablage, weg, ab.absender, this.u.jetzt())
    if (a.marke !== undefined) ablage = { ...ablage, marken: { ...ablage.marken, [weg]: a.marke } }
    this.ablage = ablage
    if (a.nachrichten.length || a.abgewiesen.length) this.stehen[weg].zuletzt = this.u.jetzt()
    await this.sichern()
    if (neues) await this.vorlesen()
  }

  /**
   * Liest die aelteste noch nicht gesprochene vor.
   *
   * DIE MARKE WIRD GESETZT, BEVOR GESPROCHEN WIRD — nicht danach. Sonst
   * spricht die Box denselben Satz zweimal, wenn waehrend der Ansage eine
   * zweite Nachricht eintrifft und die Schleife erneut hier landet. Ein
   * doppelt vorgelesener Satz ist auf einer Kinderbox schlimmer als ein
   * verpasster: er weckt.
   */
  private async vorlesen(): Promise<void> {
    const n = naechsteZumSprechen(this.ablage.nachrichten)
    if (!n) return
    await this.marke(n.id, 'gesprochen', true)
    try {
      await this.u.sprechen(sprechtext(n))
    } catch (e) {
      this.u.melden(`Vorlesen ging nicht: ${(e as Error).message}`)
    }
  }

  // ── die drei Schleifen ─────────────────────────────────────────────────

  private async schleife(weg: Weg, schritt: () => Promise<Ausbeute>): Promise<void> {
    if (this.stehen[weg].laeuft) return
    this.stehen[weg].laeuft = true
    while (this.laufend && this.stehen[weg].an) {
      const los = Date.now()
      try {
        const a = await schritt()
        if (a.fehler) {
          this.stehen[weg].fehler = a.fehler
          await this.ruhe()
          continue
        }
        this.stehen[weg].fehler = ''
        await this.aufnehmen(weg, a)
        // MINDESTABSTAND. Matrix und Telegram HAENGEN normalerweise bis zu
        // POLL_MS — eine Runde dauert also von selbst lange. Antwortet ein
        // Dienst aber sofort und leer (falsch eingestellter Server, ein
        // Zwischenspeicher davor, ein Spiegel, der den Long Poll nicht
        // kann), dreht die Schleife ohne Pause und frisst auf einer Box mit
        // passiver Kuehlung einen ganzen Kern. Der Abstand kostet im
        // Normalfall nichts: dort ist die Runde laengst laenger.
        // `Date.now()` UND NICHT `u.jetzt()`: hier wird eine DAUER gemessen,
        // keine Zeit aufgeschrieben. Eine Attrappe, die immer dieselbe Zahl
        // liefert (und das ist die brauchbare Sorte Attrappe), machte aus
        // jeder Runde eine von null Millisekunden.
        const mindestens = this.u.mindestMs ?? MINDEST_MS
        const gedauert = Date.now() - los
        if (gedauert < mindestens) await this.warten(mindestens - gedauert)
      } catch (e) {
        // EIN ABBRUCH IST KEIN FEHLSCHLAG — die Frist greift auch dann, wenn
        // nur nichts zu holen war und der Dienst laenger schweigt als
        // vereinbart. Gemeldet wird er trotzdem, sonst waere ein Weg, der
        // NIE antwortet, von einem, der still arbeitet, nicht zu
        // unterscheiden (dasselbe Muster wie funkTun in der Oberflaeche).
        this.stehen[weg].fehler =
          (e as Error).name === 'TimeoutError' ? 'keine Antwort in der Frist' : (e as Error).message
        await this.ruhe()
      }
    }
    this.stehen[weg].laeuft = false
  }

  private ruhe(): Promise<void> {
    return this.warten(RUHE_MS)
  }

  private warten(ms: number): Promise<void> {
    return new Promise((fertig) => {
      const t = setTimeout(fertig, ms)
      // `unref`, damit eine wartende Schleife den Prozess nicht am Beenden
      // hindert — die Box wird abgeschaltet, waehrend hier jemand ruht.
      t.unref?.()
      this.uhren.push(t)
    })
  }

  private async nachHause(adresse: string, kopf?: Record<string, string>): Promise<unknown> {
    const a = await this.u.holen(adresse, { signal: AbortSignal.timeout(this.u.fristMs ?? FRIST_MS), headers: kopf })
    if (!a.ok) throw new Error(`Antwort ${a.status}`)
    return await a.json()
  }

  private async matrixSchritt(): Promise<Ausbeute> {
    const k = this.u.konf()
    // DER TOKEN GEHT IN DEN KOPF, NICHT IN DIE ADRESSE. `?access_token=` ist
    // bei Matrix seit v1.11 abgekuendigt und faellt weg — und eine Adresse
    // landet unterwegs in jedem Fehlerprotokoll, ein Kopf nicht.
    const antwort = await this.nachHause(
      matrixAdresse(
        { server: String(k.matrixServer ?? ''), token: String(k.matrixToken ?? ''), raum: String(k.matrixRaum ?? '') },
        this.ablage.marken.matrix,
      ),
      { Authorization: `Bearer ${String(k.matrixToken ?? '')}` },
    )
    return matrixAuswerten(antwort, this.liste())
  }

  private async telegramSchritt(): Promise<Ausbeute> {
    const k = this.u.konf()
    const marke = this.ablage.marken.telegram
    const antwort = await this.nachHause(
      telegramAdresse({ token: String(k.telegramToken ?? '') }, marke === undefined ? undefined : Number(marke)),
    )
    return telegramAuswerten(antwort, this.liste())
  }

  /**
   * Signal ist kein Abholen, sondern eine stehende Verbindung.
   *
   * Sie wird aufgebaut, gehalten und bei einem Abriss nach `RUHE_MS` neu
   * versucht — solange der Weg AN ist. Dass `signal-cli` fehlen DARF, ist
   * der ausdrueckliche Auftrag; deshalb steht hinter einem gescheiterten
   * Aufbau ein Satz fuer den Menschen und kein stiller Rueckzug.
   */
  private signalHalten(): void {
    if (!this.laufend || !this.stehen.signal.an) return
    const k = this.u.konf()
    const host = String(k.signalHost || '127.0.0.1')
    const port = Number(k.signalPort || 7583)
    const s = new net.Socket()
    this.socket = s
    let puffer = ''
    s.setEncoding('utf8')
    s.on('data', (stueck: string) => {
      const { zeilen, rest } = zeilenSchneiden(puffer + stueck)
      puffer = rest
      for (const z of zeilen) {
        const a = signalZeile(z, this.liste())
        if (a) void this.aufnehmen('signal', a)
      }
    })
    const wiederholen = (grund: string) => {
      this.stehen.signal.fehler = grund
      s.destroy()
      if (this.socket === s) this.socket = null
      if (!this.laufend || !this.stehen.signal.an) return
      const t = setTimeout(() => this.signalHalten(), RUHE_MS)
      t.unref?.()
      this.uhren.push(t)
    }
    s.once('connect', () => {
      this.stehen.signal.fehler = ''
      this.stehen.signal.laeuft = true
    })
    s.once('error', (e) => {
      this.stehen.signal.laeuft = false
      wiederholen(`signal-cli nicht erreichbar (${host}:${port}): ${e.message}`)
    })
    s.once('close', () => {
      this.stehen.signal.laeuft = false
      wiederholen('Verbindung zu signal-cli abgerissen')
    })
    s.connect(port, host)
  }

  /** Steht die signal-cli-Tuer offen? Fuer die Auskunft im Eltern-Bereich. */
  signalPruefen(): Promise<boolean> {
    const k = this.u.konf()
    return dienstErreichbar(String(k.signalHost || '127.0.0.1'), Number(k.signalPort || 7583))
  }

  /**
   * Startet, was an ist, und haelt an, was aus ist.
   *
   * WIRD BEI JEDER KONFIGURATIONSAENDERUNG GERUFEN, nicht nur beim Start:
   * wer im Eltern-Bereich einen Weg anschaltet, erwartet, dass er laeuft —
   * und nicht, dass er beim naechsten Neustart laeuft.
   */
  nachziehen(): void {
    const k = this.u.konf()
    const an = k.active === true
    this.laufend = an
    this.stehen.matrix.an = an && k.matrixActive === true && !!k.matrixServer && !!k.matrixToken
    this.stehen.telegram.an = an && k.telegramActive === true && !!k.telegramToken
    this.stehen.signal.an = an && k.signalActive === true
    if (this.stehen.matrix.an) void this.schleife('matrix', () => this.matrixSchritt())
    if (this.stehen.telegram.an) void this.schleife('telegram', () => this.telegramSchritt())
    if (this.stehen.signal.an && !this.socket) this.signalHalten()
    if (!this.stehen.signal.an && this.socket) {
      const s = this.socket
      this.socket = null
      s.destroy()
    }
  }

  /** Alles zu. Fuer Tests und fuer ein sauberes Herunterfahren. */
  anhalten(): void {
    this.laufend = false
    for (const w of ['matrix', 'telegram', 'signal'] as Weg[]) this.stehen[w].an = false
    for (const t of this.uhren) clearTimeout(t)
    this.uhren = []
    if (this.socket) {
      const s = this.socket
      this.socket = null
      s.destroy()
    }
  }
}
