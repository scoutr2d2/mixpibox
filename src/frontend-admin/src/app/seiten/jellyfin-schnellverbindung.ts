/**
 * Jellyfin anmelden, ohne einen Schlüssel zu suchen.
 *
 * GEMELDET AM 08.08.2026: „der jellyfin quickconnect ist verlorhen in beiden
 * admin menüs … man kann es auch nicht mehr anstoßen." Er war nicht kaputt, er
 * war unerreichbar: der Ablauf lebt in der klassischen Oberfläche auf der Seite
 * /jellyfin, und auf die verweist NICHTS — kein Knopf, kein Menü. Nur wer die
 * Adresse tippt, kommt hin.
 *
 * ══ DIE BOX FÜHRT, NICHT DIESER BROWSER ═════════════════════════════════
 * Hier wird nur gedrückt und gewartet. Das Anstoßen, das Nachfragen, der
 * Eintausch und das Schreiben in die Konfiguration laufen im Server
 * (/api/jellyfin/schnellverbindung); die Begründung steht im Kopf von
 * backend-api/src/jellyfin-schnellverbindung.ts. Kurz: die alte Fassung legte
 * den Zugang im localStorage EINES Browsers ab — dann weiß die Box selbst
 * nichts davon, der Server auch nicht, und ein geleerter Browserspeicher
 * löscht die Anmeldung.
 *
 * WAS HIER NIE ANKOMMT: das Secret und der Schlüssel. Der Server gibt nur den
 * CODE heraus (der ist zum Vorzeigen gedacht) und einen Stand.
 *
 * ══ ES FRAGT SELBST NACH, ABER NICHT EWIG ═══════════════════════════════
 * Solange ein Code steht, fragt die Seite alle drei Sekunden nach. Sie hört
 * auf, sobald er verfällt, sobald es geklappt hat und wenn die Komponente
 * verschwindet — ein Takt, der weiterläuft, während niemand hinsieht, ist
 * Arbeit für nichts und hält den Jellyfin-Server beschäftigt.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, type OnDestroy, type OnInit, inject, output, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

/** Was `GET /api/jellyfin/schnellverbindung` sagt. */
interface Lage {
  moeglich: boolean
  grund: string
  server: string
  angemeldet: boolean
  laeuft: boolean
  code: string | null
  restSekunden: number
}

@Component({
  selector: 'mupi-jellyfin-schnellverbindung',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; margin: 0.6rem 0 0; }
    .klein { color: var(--gedaempft); font-size: 0.88rem; margin: 0 0 0.6rem; }
    .code {
      font-size: 2.1rem; letter-spacing: 0.28em; font-weight: 600;
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.7rem 1rem; display: inline-block; margin: 0.3rem 0;
      /* Zum Abtippen gedacht — der Zeilenumbruch mitten in einer sechsstelligen
         Zahl waere genau der Fehler, den man beim Abtippen macht. */
      white-space: nowrap;
    }
    .rest { color: var(--gedaempft); font-size: 0.85rem; }
    .gut { color: var(--gut); }
    .fehler { color: var(--fehler); }
    .knoepfe { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.5rem; }
    .serverliste { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-start; margin-top: 0.3rem; }
  `,
  template: `
    @if (lage(); as l) {
      @if (l.angemeldet && !l.laeuft) {
        <p class="klein gut">
          Diese Box ist bei Jellyfin angemeldet. Neu anmelden geht trotzdem — etwa für ein anderes Konto.
        </p>
      }

      @if (!l.moeglich) {
        <p class="klein">{{ l.grund }}</p>
        <!-- DIE SUCHE, DIE DER TOUCHSCREEN SCHON HAT (Betreiber 15.08.2026:
             „da waren wir im admin menu vom touchscreen schon besser"): der
             Rundruf laeuft auf der BOX (GET /api/jellyfin/suchen, UDP kann
             kein Browser), ein Tipp uebernimmt die Adresse ueber den einen
             Schreibweg (Feld jellyfinServer). -->
        <div class="knoepfe">
          <button type="button" [disabled]="sucht()" (click)="suchen()">
            {{ sucht() ? 'Suche läuft…' : 'Jellyfin im Netz suchen' }}
          </button>
        </div>
        @if (gefundene(); as g) {
          @if (g.length === 0) {
            <p class="klein">{{ suchHinweis() || 'Im Netz der Box hat sich kein Jellyfin gemeldet.' }}</p>
          } @else {
            <p class="klein">Gefunden — antippen zum Übernehmen:</p>
            <div class="serverliste">
              @for (s of g; track s.adresse) {
                <button type="button" (click)="uebernehmen(s.adresse)">{{ s.name }} — {{ s.adresse }}</button>
              }
            </div>
          }
        }
      } @else if (l.laeuft && l.code) {
        <p class="klein">
          Diesen Code in Jellyfin eintippen: oben rechts aufs Benutzer-Symbol, dann „Schnellverbindung" (Quick
          Connect). Die Box wartet und merkt es selbst.
        </p>
        <div class="code">{{ l.code }}</div>
        <p class="rest">Noch {{ minSek(l.restSekunden) }} gültig.</p>
        <div class="knoepfe">
          <button type="button" class="still" (click)="abbrechen()">Abbrechen</button>
        </div>
      } @else {
        <!-- DAS DING BEIM NAMEN NENNEN (Betreiber 15.08.2026: „hab es
             gefunden war nur nicht ganz gut erklärt"): der Knopf hiess
             „Ohne Schlüssel anmelden" — wer nach Jellyfins eigenem Wort
             „Quick Connect" sucht, erkannte ihn nicht. -->
        <p class="klein">
          Quick Connect (Schnellverbindung) ist Jellyfins Anmeldung ohne Passwort und ohne API-Schlüssel: Die Box holt
          einen sechsstelligen Code; den tippst du in Jellyfin ein — dort oben rechts aufs Benutzer-Symbol, dann
          „Schnellverbindung". Der Zugang wird auf der BOX gespeichert, nicht in diesem Browser.
        </p>
        <div class="knoepfe">
          <button type="button" [disabled]="laeuftGerade()" (click)="anstossen()">
            {{ laeuftGerade() ? 'Einen Moment…' : 'Quick Connect starten' }}
          </button>
        </div>
      }

      @if (meldung(); as m) {
        <p class="klein" [class.fehler]="!geschafft()" [class.gut]="geschafft()">{{ m }}</p>
      }
    }
  `,
})
export class JellyfinSchnellverbindung implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient)

  /** Feuert, wenn eine Anmeldung durchgegangen ist — die Seite darüber soll
   *  ihre Anbieterliste neu holen, sonst steht dort weiter „unvollständig". */
  readonly angemeldet = output<void>()

  readonly lage = signal<Lage | null>(null)
  readonly meldung = signal<string>('')
  readonly geschafft = signal(false)
  readonly laeuftGerade = signal(false)
  readonly sucht = signal(false)
  /** null = noch nicht gesucht (ein Knopf), leere Liste = gesucht, nichts da
   *  (ein Befund) — derselbe Unterschied wie auf dem Touchscreen. */
  readonly gefundene = signal<{ name: string; adresse: string }[] | null>(null)
  /** Der Hinweis des Servers zur leeren Suche — er weiss, WARUM (Router, VPN). */
  readonly suchHinweis = signal('')

  private uhr: ReturnType<typeof setInterval> | null = null

  ngOnInit(): void {
    void this.lageHolen()
  }

  ngOnDestroy(): void {
    this.taktAus()
  }

  private taktAn(): void {
    if (this.uhr !== null) return
    // DREI SEKUNDEN. Jellyfin verträgt das mühelos, und schneller zu fragen
    // brächte nichts: zwischen „eingetippt" und „gesehen" liegt ohnehin die
    // Zeit, die ein Mensch zum Tippen braucht.
    this.uhr = setInterval(() => void this.nachfragen(), 3000)
  }

  private taktAus(): void {
    if (this.uhr !== null) clearInterval(this.uhr)
    this.uhr = null
  }

  async lageHolen(): Promise<void> {
    try {
      const l = await firstValueFrom(this.http.get<Lage>('/api/jellyfin/schnellverbindung'))
      this.lage.set(l)
      if (l.laeuft) this.taktAn()
      else this.taktAus()
    } catch {
      // KEIN LEERER KASTEN. Ein Server ohne diese Wege (ältere Fassung) soll
      // sagen, warum hier nichts steht — sonst sucht jemand den Knopf, den es
      // auf dieser Box noch gar nicht gibt.
      this.lage.set({
        moeglich: false,
        grund: 'Dieser Server kennt die Jellyfin-Schnellverbindung noch nicht. Ein Update der Box bringt sie mit.',
        server: '',
        angemeldet: false,
        laeuft: false,
        code: null,
        restSekunden: 0,
      })
    }
  }

  async suchen(): Promise<void> {
    this.sucht.set(true)
    this.meldung.set('')
    try {
      const a = await firstValueFrom(
        this.http.get<{ server: { name: string; adresse: string }[]; hinweis?: string }>('/api/jellyfin/suchen'),
      )
      this.gefundene.set(a.server ?? [])
      this.suchHinweis.set(a.hinweis ?? '')
    } catch {
      this.geschafft.set(false)
      this.meldung.set('Die Suche ließ sich nicht ausführen.')
    } finally {
      this.sucht.set(false)
    }
  }

  async uebernehmen(adresse: string): Promise<void> {
    this.meldung.set('')
    try {
      // DER EINE SCHREIBWEG: dasselbe geprüfte Feld, das auch die
      // Streaming-Seite bedient — kein zweiter Pfad in die Konfiguration.
      await firstValueFrom(
        this.http.post('/api/konfiguration', { aenderungen: { jellyfinServer: adresse } }),
      )
      this.gefundene.set(null)
      this.geschafft.set(true)
      this.meldung.set(`Server übernommen: ${adresse}. Jetzt „Ohne Schlüssel anmelden".`)
      await this.lageHolen()
      // Die Seite darüber soll ihre Felder neu holen — dort steht die
      // Adresse jetzt auch im Feld „Jellyfin-Server".
      this.angemeldet.emit()
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.geschafft.set(false)
      this.meldung.set(g || 'Die Adresse ließ sich nicht übernehmen.')
    }
  }

  async anstossen(): Promise<void> {
    this.laeuftGerade.set(true)
    this.meldung.set('')
    this.geschafft.set(false)
    try {
      await firstValueFrom(this.http.post('/api/jellyfin/schnellverbindung', {}))
      await this.lageHolen()
    } catch (e) {
      this.meldung.set(fehlerText(e))
    } finally {
      this.laeuftGerade.set(false)
    }
  }

  async abbrechen(): Promise<void> {
    this.taktAus()
    try {
      await firstValueFrom(this.http.delete('/api/jellyfin/schnellverbindung'))
    } catch {
      /* Ein Abbruch, der nicht ankommt, verfällt von selbst — das ist kein
         Grund für eine Fehlermeldung an jemanden, der gerade aufhören will. */
    }
    this.meldung.set('')
    await this.lageHolen()
  }

  private async nachfragen(): Promise<void> {
    try {
      const a = await firstValueFrom(
        this.http.post<{ stand: string; benutzer?: string; code?: string; restSekunden?: number }>(
          '/api/jellyfin/schnellverbindung/pruefen',
          {},
        ),
      )
      if (a.stand === 'wartet') {
        // NUR DIE RESTZEIT NACHZIEHEN, nicht die ganze Lage neu holen: das
        // wären zwei Anfragen je Takt, und die zweite sagte dasselbe.
        const l = this.lage()
        if (l) this.lage.set({ ...l, code: a.code ?? l.code, restSekunden: a.restSekunden ?? l.restSekunden })
        return
      }
      this.taktAus()
      if (a.stand === 'fertig') {
        this.geschafft.set(true)
        this.meldung.set(
          a.benutzer ? `Angemeldet als ${a.benutzer}. Der Zugang liegt jetzt auf der Box.` : 'Angemeldet. Der Zugang liegt jetzt auf der Box.',
        )
        this.angemeldet.emit()
      } else if (a.stand === 'abgelaufen') {
        this.meldung.set('Der Code ist abgelaufen — noch einmal anstoßen.')
      } else {
        this.meldung.set('Jellyfin hat nicht wie erwartet geantwortet.')
      }
      await this.lageHolen()
    } catch (e) {
      this.taktAus()
      this.meldung.set(fehlerText(e))
      await this.lageHolen()
    }
  }

  /** „4 min 12 s" statt „252 s" — die Frist ist zum Abschätzen da. */
  minSek(s: number): string {
    const n = Math.max(0, Math.round(Number(s) || 0))
    return n < 60 ? `${n} s` : `${Math.floor(n / 60)} min ${n % 60} s`
  }
}

/** Was der Server im Fehlerfall mitgibt — und sonst ein Satz statt eines Codes. */
function fehlerText(e: unknown): string {
  const b = (e as { error?: { error?: string } })?.error
  return b?.error || 'Die Box hat nicht geantwortet.'
}
