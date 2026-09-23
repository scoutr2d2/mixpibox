/**
 * Die Aktualisierungs-Seite.
 *
 * Sie beantwortet zuerst die Fragen, die VOR dem Knopf kommen:
 *   Was läuft hier? Woher kam es? Ist das Angebot überhaupt dasselbe?
 * Der alte Admin hatte den Knopf ohne diese Fragen — und dahinter lag
 * `curl … | sudo bash` mit dem Upstream-Zip, das eine Fork-Box überschrieben
 * hätte.
 *
 * ══ SEIT DEM 31.08.2026 GIBT ES DEN KNOPF ═══════════════════════════════════
 * Bis dahin stand hier: „Einspielen geht absichtlich noch nicht — ein Update,
 * das sich nicht zurückdrehen lässt, gehört erst dann in diese Oberfläche,
 * wenn es auf einer echten Box erprobt ist." Beide Bedingungen sind erfüllt:
 * der Rückweg liegt lokal (`mixpi-zieher.py --zurueckdrehen`, braucht weder
 * Netz noch diese Seite), und der Weg ist auf Box .79 gefahren worden.
 *
 * ZWEI DINGE, DIE DIESE SEITE ANDERS MACHEN MÜSSEN ALS JEDER ANDERE KNOPF:
 *   1. Der Lauf gehört ihr NICHT. Er hängt in einer eigenen systemd-Unit,
 *      weil er `mupibox-server.service` neu startet — also den Server, der
 *      diese Seite ausliefert. Ein Lauf als Kind des Servers stürbe mitten im
 *      Tausch.
 *   2. Der Fortschritt kommt aus einer DATEI, nicht aus der Antwort. Die
 *      Verbindung reißt während des Laufs ab; die Seite sieht danach einfach
 *      weiter nach, was inzwischen passiert ist.
 * Der eigentliche Boden ist keins von beidem, sondern die Standwache: kommt
 * der Server nicht wieder, dreht die Box von selbst zurück.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

interface Herkunft {
  quelle: string
  commit: string
  zweig?: string
  gebautAm: string
  eigeneCommits?: number
  unsauber?: number
}

/** Der Verlauf eines Zieher-Laufs, wie ihn `GET /api/aktualisierung/lauf` liefert. */
interface LaufStand {
  da: boolean
  laeuft: boolean
  rc?: number | null
  zeilen?: { art: string; text: string }[]
}

interface Lage {
  urteil:
    | 'aktuell'
    | 'neuer'
    | 'fremdeQuelle'
    | 'eigenbau'
    | 'herkunftUnbekannt'
    | 'keinAngebot'
    | 'unklar'
  installiert: string
  angeboten: string
  grund?: string
  kanal: string
  herkunft: Herkunft | null
  angebotsQuelle: string
  feedFehler: string
  releaseinfo: string
}

@Component({
  selector: 'mupi-aktualisierung',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.4rem; font-size: 0.94rem; }
    h2 { font-size: 1rem; margin: 1.8rem 0 0.6rem; }
    .urteil { border-radius: 12px; padding: 1rem 1.1rem; border: 1px solid var(--rand); background: var(--flaeche); }
    .urteil.gut { border-color: var(--gut); }
    .urteil.warn { border-color: var(--warn); }
    .urteil.stop { border-color: var(--fehler); background: color-mix(in srgb, var(--fehler) 12%, var(--flaeche)); }
    .urteil .kopf { font-size: 1.08rem; font-weight: 500; margin-bottom: 0.4rem; }
    .urteil.gut .kopf { color: var(--gut); }
    .urteil.warn .kopf { color: var(--warn); }
    .urteil.stop .kopf { color: var(--fehler); }
    .urteil p { margin: 0 0 0.5rem; }
    .urteil p:last-child { margin-bottom: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--rand); vertical-align: top; }
    th { color: var(--gedaempft); font-weight: 500; width: 12rem; }
    td.mono { font-family: ui-monospace, monospace; word-break: break-all; }
    .klein { color: var(--gedaempft); font-size: 0.87rem; }
    .kanaele { display: flex; gap: 0.4rem; margin-bottom: 0.35rem; }
    .kanaele button { text-transform: none; }
    .kanaele button.gewaehlt { border-color: var(--gut); color: var(--gut); }
    .knopf { margin-top: 1rem; }
    /* Der Verlauf kann lang werden und enthaelt Pfade, die nicht umbrechen
       sollen — er scrollt in sich, statt die Seite breit zu machen. */
    .verlauf {
      max-height: 18rem; overflow: auto; margin: 0 0 1rem;
      padding: 0.7rem 0.8rem; border: 1px solid var(--rand); border-radius: 10px;
      background: var(--flaeche); font-size: 0.82rem; line-height: 1.5;
      font-family: ui-monospace, monospace;
    }
    .verlauf div { white-space: pre-wrap; word-break: break-word; }
    .verlauf div.warnung { color: var(--warn); }
    .verlauf div.fehler { color: var(--fehler); }
  `,
  template: `
    <h1>Aktualisierung</h1>
    <p class="unter">Was läuft auf dieser Box, woher kam es, und gibt es etwas Neueres?</p>

    <h2>Wartungsmodus</h2>
    @if (wartung(); as w) {
      @if (w.aktiv) {
        <div class="urteil warn">
          <div class="kopf">Der Sperr-Schirm liegt über der Box</div>
          <p>
            Die Box zeigt „Kleine Pause" und nimmt keine Bedienung an{{ wartungSeit() }}.
            Ein Neustart der Box beendet die Wartung ebenfalls.
          </p>
        </div>
        <button type="button" [disabled]="wartungSchaltet()" (click)="wartungSetzen(false)">
          Wartung beenden
        </button>
      } @else {
        <p class="klein">
          Solange der Wartungsmodus an ist, legt die Box-Oberfläche einen
          Sperr-Schirm über alles — kein Kind funkt dazwischen, während hier
          gearbeitet wird. Er überlebt keinen Neustart.
        </p>
        <button type="button" class="still" [disabled]="wartungSchaltet()" (click)="wartungSetzen(true)">
          Wartungsmodus einschalten
        </button>
      }
    } @else {
      <p class="klein">Der Wartungszustand ließ sich nicht abrufen.</p>
    }

    @if (laedt()) {
      <p class="klein">Einen Moment…</p>
    } @else if (lage(); as l) {
      <div class="urteil" [class]="farbe()">
        <div class="kopf">{{ ueberschrift() }}</div>
        @if (l.grund) {
          <p>{{ l.grund }}</p>
        }
        @if (l.urteil === 'neuer') {
          <p>Installiert ist {{ l.installiert || '–' }}, angeboten wird {{ l.angeboten }}.</p>
          @if (l.releaseinfo) {
            <p class="klein">{{ l.releaseinfo }}</p>
          }
        }
        @if (l.urteil === 'keinAngebot') {
          <p>
            Das Versionsverzeichnis war nicht erreichbar. Wenn die Box gerade
            kein Internet hat, ist das normal.
          </p>
          @if (l.feedFehler) {
            <p class="klein">{{ l.feedFehler }}</p>
          }
        }
      </div>

      <h2>Was hier läuft</h2>
      <table>
        <tbody>
          <tr><th>Fassung</th><td>{{ l.installiert || 'nicht hinterlegt' }}</td></tr>
          @if (l.herkunft; as h) {
            <tr><th>Quelle</th><td class="mono">{{ h.quelle || 'unbekannt' }}</td></tr>
            <tr><th>Stand</th><td class="mono">{{ h.commit ? h.commit.slice(0, 10) : '–' }}{{ h.zweig ? ' (' + h.zweig + ')' : '' }}</td></tr>
            <tr><th>Gebaut</th><td>{{ gebaut() }}</td></tr>
            @if ((h.eigeneCommits ?? 0) > 0 || (h.unsauber ?? 0) > 0) {
              <tr>
                <th>Eigene Arbeit</th>
                <td>
                  {{ h.eigeneCommits ?? 0 }} Commits vor der Quelle@if ((h.unsauber ?? 0) > 0) {, {{ h.unsauber }} geänderte Datei(en)}
                  <div class="klein">Genau diese Arbeit stünde bei einem Update aus der Quelle auf dem Spiel.</div>
                </td>
              </tr>
            }
          } @else {
            <tr>
              <th>Herkunft</th>
              <td>
                nicht hinterlegt
                <div class="klein">
                  Diese Box wurde vor der Einführung des Herkunftsstempels
                  ausgeliefert. Beim nächsten Ausliefern steht sie hier.
                </div>
              </td>
            </tr>
          }
        </tbody>
      </table>

      <h2>Was angeboten wird</h2>
      <table>
        <tbody>
          <tr><th>Quelle</th><td class="mono">{{ l.angebotsQuelle }}</td></tr>
          <tr>
            <th>Kanal</th>
            <td>
              <div class="kanaele">
                @for (k of KANAELE; track k) {
                  <button
                    type="button"
                    [class]="k === l.kanal ? 'gewaehlt' : 'still'"
                    [disabled]="kanalSchaltet() || k === l.kanal"
                    (click)="kanalSetzen(k)"
                  >{{ k }}</button>
                }
              </div>
              <div class="klein">{{ kanalErklaerung(l.kanal) }}</div>
              @if (kanalFehler(); as f) {
                <div class="klein">Umstellen ging nicht: {{ f }}</div>
              }
            </td>
          </tr>
          <tr><th>Neueste Fassung</th><td>{{ l.angeboten || 'nicht ermittelbar' }}</td></tr>
        </tbody>
      </table>

      <h2>Einspielen</h2>
      @if (lauf(); as v) {
        @if (v.laeuft) {
          <p class="klein">
            Der Lauf ist unterwegs. Die Box startet dabei ihre Dienste neu —
            dass diese Seite kurz nicht antwortet, gehört dazu.
          </p>
        } @else if (v.da) {
          @if (v.rc === 0) {
            <p class="klein">Der letzte Lauf ging durch.</p>
          } @else {
            <p class="klein">
              Der letzte Lauf ging NICHT durch (Rückgabe {{ v.rc }}). Die Zeilen
              unten sagen, wo er stehengeblieben ist.
            </p>
          }
        }
        @if (v.zeilen?.length) {
          <div class="verlauf">
            @for (z of v.zeilen; track $index) {
              <div [class]="z.art">{{ z.text }}</div>
            }
          </div>
        }
      }

      @if (einspielFehler(); as f) {
        <p class="klein">Der Lauf ließ sich nicht starten: {{ f }}</p>
      }

      @if (lage()?.urteil === 'neuer') {
        <button type="button" [disabled]="startet() || lauf()?.laeuft" (click)="einspielen(false)">
          {{ lauf()?.laeuft ? 'läuft …' : 'Jetzt einspielen' }}
        </button>
      } @else if (lage()?.urteil === 'aktuell' || lage()?.urteil === 'keinAngebot') {
        <p class="klein">Es gibt nichts einzuspielen.</p>
      } @else {
        <!--
          ABGELEHNT HEISST ABGELEHNT — aber nicht unsichtbar. Bei Eigenbau und
          fremder Quelle steht der Grund oben im Urteil; hier steht der Weg
          daran vorbei, und zwar mit der Folge DAVOR, nicht dahinter.
          (Keine Backticks in diesem Kommentar: er steht INNERHALB des
          Template-Literals und ein Backtick beendet es mitten im Bauteil.)
        -->
        <p class="klein">
          Einspielen ist hier gesperrt: {{ ueberschrift() }}. Wer es trotzdem
          tut, überschreibt genau die Arbeit, die im Urteil oben benannt ist.
        </p>
        <button
          type="button"
          class="still"
          [disabled]="startet() || lauf()?.laeuft"
          (click)="einspielen(true)"
        >
          Trotzdem einspielen
        </button>
      }

      <p class="klein">
        Geht der Lauf schief, dreht die Box selbst zurück — der Rückweg liegt
        lokal, dafür braucht sie weder Netz noch dieses Fenster.
      </p>

      <button type="button" class="still" [disabled]="laedt()" (click)="laden()">
        Erneut nachsehen
      </button>
    } @else {
      <p class="klein">Der Aktualisierungsstand ließ sich nicht ermitteln.</p>
    }
  `,
})
export class AktualisierungSeite {
  private readonly http = inject(HttpClient)

  readonly lage = signal<Lage | null>(null)
  readonly laedt = signal(true)

  readonly farbe = computed(() => {
    switch (this.lage()?.urteil) {
      case 'aktuell':
        return 'gut'
      case 'fremdeQuelle':
      case 'eigenbau':
        return 'stop'
      case 'neuer':
      case 'herkunftUnbekannt':
      case 'unklar':
        return 'warn'
      default:
        return ''
    }
  })

  readonly ueberschrift = computed(() => {
    switch (this.lage()?.urteil) {
      case 'aktuell':
        return 'Alles aktuell'
      case 'neuer':
        return 'Eine neuere Fassung liegt vor'
      case 'fremdeQuelle':
        return 'Kein Update — das Angebot kommt woanders her'
      case 'eigenbau':
        return 'Kein Update — diese Box läuft einen Eigenbau'
      case 'herkunftUnbekannt':
        return 'Herkunft unbekannt'
      case 'keinAngebot':
        return 'Kein Angebot erreichbar'
      case 'unklar':
        return 'Nicht vergleichbar'
      default:
        return ''
    }
  })

  readonly gebaut = computed(() => {
    const t = this.lage()?.herkunft?.gebautAm
    if (!t) return '–'
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? t : d.toLocaleString('de-DE')
  })

  readonly wartung = signal<{ aktiv: boolean; seit?: string } | null>(null)
  readonly wartungSchaltet = signal(false)

  readonly wartungSeit = computed(() => {
    const t = this.wartung()?.seit
    if (!t) return ''
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? '' : ` (seit ${d.toLocaleTimeString('de-DE')})`
  })

  /**
   * Die drei Kanaele in der Reihenfolge, in der eine Fassung sie durchlaeuft.
   * Betreiber, 31.08.2026: dev sind alle Aenderungen, beta ist ein
   * Stable-Kandidat, stable ist stable.
   */
  readonly KANAELE = ['dev', 'beta', 'stable'] as const
  readonly kanalSchaltet = signal(false)
  readonly kanalFehler = signal('')

  kanalErklaerung(jetzt: string): string {
    switch (jetzt) {
      case 'dev':
        return 'Alle Änderungen, sobald sie fertig sind. Am nächsten am Baum, am wenigsten erprobt.'
      case 'beta':
        return 'Was stable werden soll — ein Kandidat, der sich bewähren muss.'
      default:
        return 'Nur erprobte Fassungen.'
    }
  }

  async kanalSetzen(kanal: string): Promise<void> {
    this.kanalSchaltet.set(true)
    this.kanalFehler.set('')
    try {
      await firstValueFrom(this.http.post('/api/aktualisierung/kanal', { kanal }))
    } catch (e: unknown) {
      this.kanalFehler.set((e as { error?: { error?: string } })?.error?.error || 'unbekannt')
    } finally {
      // Der anschliessende Abruf zeigt den ECHTEN Kanal — auch im Fehlerfall,
      // und mit ihm gleich das neue Urteil fuer diesen Kanal.
      await this.laden()
      this.kanalSchaltet.set(false)
    }
  }

  readonly lauf = signal<LaufStand | null>(null)
  readonly startet = signal(false)
  readonly einspielFehler = signal('')

  constructor() {
    void this.laden()
    void this.wartungLaden()
    void this.laufLaden()
    // ── WARUM HIER EIN TAKT LAEUFT UND KEIN ABWARTEN ─────────────────────────
    // Der Zieher startet `mupibox-server.service` neu — also den Server, der
    // diese Seite bedient. Ein `await` auf das Ende des Laufs koennte nie
    // zurueckkommen: die Verbindung stirbt mitten darin. Stattdessen liegt der
    // Verlauf in einer Datei auf der Box, und diese Seite sieht im Sekundentakt
    // nach. Faellt der Server dabei kurz weg, schlaegt ein Abruf fehl und der
    // naechste holt es nach — die Seite ueberlebt ihren eigenen Server.
    const takt = setInterval(() => void this.laufLaden(), 2000)
    inject(DestroyRef).onDestroy(() => clearInterval(takt))
  }

  async laufLaden(): Promise<void> {
    try {
      const vorher = this.lauf()?.laeuft
      const jetzt = await firstValueFrom(this.http.get<LaufStand>('/api/aktualisierung/lauf'))
      this.lauf.set(jetzt)
      // Ist der Lauf eben fertig geworden, stimmt die Lage oben nicht mehr:
      // installiert ist jetzt etwas anderes. Einmal nachziehen, nicht staendig.
      if (vorher && !jetzt.laeuft) void this.laden()
    } catch {
      // Ein fehlgeschlagener Abruf WAEHREND eines Laufs ist der Normalfall
      // (der Server startet gerade neu) und darf den letzten bekannten Stand
      // nicht loeschen — sonst blinkt die Anzeige bei jedem Neustart auf leer.
    }
  }

  async einspielen(erzwingen: boolean): Promise<void> {
    this.startet.set(true)
    this.einspielFehler.set('')
    try {
      await firstValueFrom(this.http.post('/api/aktualisierung/einspielen', { erzwingen }))
    } catch (e: unknown) {
      const f = (e as { error?: { error?: string } })?.error?.error
      this.einspielFehler.set(f === 'laeuftSchon' ? 'Es läuft bereits einer.' : f || 'unbekannt')
    } finally {
      this.startet.set(false)
      await this.laufLaden()
    }
  }

  async laden(): Promise<void> {
    this.laedt.set(true)
    try {
      this.lage.set(await firstValueFrom(this.http.get<Lage>('/api/aktualisierung')))
    } catch {
      this.lage.set(null)
    } finally {
      this.laedt.set(false)
    }
  }

  async wartungLaden(): Promise<void> {
    try {
      this.wartung.set(await firstValueFrom(this.http.get<{ aktiv: boolean; seit?: string }>('/api/wartung')))
    } catch {
      this.wartung.set(null)
    }
  }

  async wartungSetzen(an: boolean): Promise<void> {
    this.wartungSchaltet.set(true)
    try {
      await firstValueFrom(this.http.post('/api/wartung', { aktiv: an }))
    } catch {
      // Der anschliessende Abruf zeigt den ECHTEN Zustand — auch im Fehlerfall.
    } finally {
      await this.wartungLaden()
      this.wartungSchaltet.set(false)
    }
  }
}
