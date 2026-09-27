/**
 * Spotify einrichten — beide Zugänge in EINEM Durchgang, vom Handy aus.
 *
 * WOHER DER WUNSCH KOMMT (Betreiber, 14.08.2026): „wir melden uns ja einmal
 * an … finden wir den keinen weg" — der Traum vom einen Login. Die Messreihe
 * dazu (tools/ton-vollmacht-probe.mjs, Wiki: ton-token-traegt-keine-web-api)
 * hat ihn in BEIDE Richtungen beerdigt: die eigene Client-ID darf nicht an
 * den Audio-Strom, und das Token des gesegneten Clients scheitert an einem
 * weltweit geteilten Ratenfenster der Web-API. Zwei Anmeldungen sind Spotifys
 * Architektur. Was uns bleibt — und was der Betreiber danach bestellt hat
 * („ja eine ux verbesserung will ich"): aus zwei Ritualen an zwei Orten EINEN
 * geführten Durchgang machen.
 *
 * ══ WAS VORHER WO WAR ════════════════════════════════════════════════════
 * Der Web-API-Zugang wurde auf der Seite /spotify eingerichtet (E22-Fluss:
 * Anmeldeseite, Spotify leitet auf 127.0.0.1, Adresszeile zurückreichen).
 * Der TON-Zugang hatte in der Verwaltung GAR KEINE Fläche — er lebte nur im
 * Eltern-Bereich der Box-Oberfläche. Wer beide einrichten wollte, musste
 * beide Orte kennen. Genau daran sind drei Kiosk-Gefängnisse entstanden.
 *
 * ══ DIE BOX FÜHRT, NICHT DIESER BROWSER ══════════════════════════════════
 * Wie bei der Jellyfin-Schnellverbindung: hier wird nur gedrückt und
 * gewartet. Den Geräte-Code holt die BOX (POST /api/spotify/ton/geraetecode),
 * sie fragt auch selbst bei Spotify nach — ein geschlossenes Fenster bricht
 * nichts ab. Token und Zugangsdaten kommen hier nie an.
 *
 * ══ ES FRAGT SELBST NACH, ABER NICHT EWIG ════════════════════════════════
 * Schritt 1 fragt /api/streaming nur, nachdem die Anmeldeseite geöffnet
 * wurde. Schritt 2 fragt /api/spotify/ton nur, solange ein Code offen ist.
 * Beides endet mit dem Erfolg, dem Verfall und dem Verschwinden der
 * Komponente. Ein Takt ohne Zuschauer ist Arbeit für nichts.
 *
 * KEINE BACKTICKS in der Vorlage — sie steht in einem Template-Literal
 * ([[backticks-in-angular-vorlagen]]).
 */
import { HttpClient } from '@angular/common/http'
import {
  ChangeDetectionStrategy,
  Component,
  type OnDestroy,
  type OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core'
import { firstValueFrom } from 'rxjs'

/** Was GET /api/spotify/ton sagt. */
interface TonLage {
  angemeldet: boolean
  laeuft: boolean
  offen: boolean
  geraet: {
    code: string
    restSekunden: number
    wartet: boolean
    fertig: boolean
    meldung: string
  } | null
}

/** Die Scheibe von GET /api/streaming, die Schritt 1 braucht. */
interface StreamingLage {
  anbieter: { id: string; stand: string }[]
}

function fehlerText(e: unknown): string {
  const gemeldet = (e as { error?: { grund?: string; error?: string } })?.error
  return gemeldet?.grund || gemeldet?.error || 'Das hat nicht geklappt — die Box war nicht erreichbar.'
}

@Component({
  selector: 'mupi-spotify-assistent',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; margin: 0.6rem 0 0; }
    .schritt {
      display: flex; gap: 0.75rem; align-items: flex-start;
      background: var(--grund); border: 1px solid var(--rand); border-radius: 10px;
      padding: 0.7rem 0.85rem; margin-top: 0.5rem;
    }
    .schritt.gruen { border-color: var(--gut); }
    .nummer {
      flex: 0 0 auto; width: 1.6rem; height: 1.6rem; border-radius: 999px;
      display: grid; place-items: center; font-size: 0.85rem; font-weight: 600;
      border: 1px solid var(--rand); color: var(--gedaempft);
    }
    .gruen .nummer { border-color: var(--gut); color: var(--gut); }
    .titel { font-weight: 500; }
    .klein { color: var(--gedaempft); font-size: 0.88rem; margin: 0.15rem 0 0; }
    .gut { color: var(--gut); }
    .fehler { color: var(--fehler); }
    .code {
      font-size: 2.1rem; letter-spacing: 0.28em; font-weight: 600;
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.7rem 1rem; display: inline-block; margin: 0.4rem 0 0.1rem;
      /* Zum Abtippen gedacht — ein Umbruch mitten im Code waere genau der
         Fehler, den man beim Abtippen macht. */
      white-space: nowrap;
    }
    .rest { color: var(--gedaempft); font-size: 0.85rem; }
    .knoepfe { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.5rem; align-items: center; }
    a.knopf {
      display: inline-block; padding: 0.5rem 0.8rem; border-radius: 8px;
      border: 1px solid var(--rand); color: var(--schrift); text-decoration: none;
      background: var(--flaeche);
    }
    .fertigzeile { margin-top: 0.6rem; font-size: 0.92rem; }
  `,
  template: `
    <div class="schritt" [class.gruen]="einsBereit()">
      <span class="nummer">{{ einsBereit() ? '✓' : '1' }}</span>
      <div>
        <div class="titel">Abspielen und Suchen (Web-API)</div>
        @if (einsBereit()) {
          <p class="klein gut">Eingerichtet — ein Zugang ist hinterlegt. Neu anmelden geht über denselben Weg.</p>
        } @else {
          <p class="klein">{{ warum() }}</p>
        }
        <div class="knoepfe">
          <a class="knopf" [href]="anmeldeWeg()" target="_blank" rel="noopener" (click)="einsWartenStarten()">
            Anmeldeseite öffnen
          </a>
          @if (einsWartet()) {
            <span class="klein">Die Box merkt es selbst, sobald die Anmeldung durch ist.</span>
          }
        </div>
        @if (!einsBereit()) {
          <p class="klein">
            Dort anmelden und zustimmen. Spotify leitet danach auf 127.0.0.1 — es kommt eine Fehlerseite, das ist
            richtig so: deren Adresszeile kopieren und im selben Tab in das Feld auf der Anmeldeseite einfügen.
          </p>
        }
      </div>
    </div>

    <div class="schritt" [class.gruen]="zweiBereit()">
      <span class="nummer">{{ zweiBereit() ? '✓' : '2' }}</span>
      <div>
        <div class="titel">Lautsprecher (Ton)</div>
        @if (zweiBereit()) {
          <p class="klein gut">Angemeldet — die Box steht in der Spotify-App als Lautsprecher bereit.</p>
        } @else if (ton()?.geraet; as g) {
          @if (!g.fertig) {
            <p class="klein">
              Diese Zeichen am Handy auf
              <a href="https://spotify.com/pair" target="_blank" rel="noopener">spotify.com/pair</a>
              eintippen. Die Box wartet und merkt es selbst.
            </p>
            <div class="code">{{ g.code }}</div>
            <p class="rest">Noch {{ minSek(g.restSekunden) }} gültig.</p>
            <div class="knoepfe">
              <button type="button" class="still" (click)="abbrechen()">Abbrechen</button>
            </div>
          }
        } @else {
          <p class="klein">
            Damit die Box selbst spielen kann. Sie holt einen Code, du tippst ihn am Handy ein — der Zugang wird auf
            der BOX gespeichert, nicht in diesem Browser.
          </p>
          <div class="knoepfe">
            <button type="button" [disabled]="holt()" (click)="codeHolen()">
              {{ holt() ? 'Einen Moment…' : 'Code holen' }}
            </button>
          </div>
        }
        @if (meldung(); as m) {
          <p class="klein" [class.fehler]="!geschafft()" [class.gut]="geschafft()">{{ m }}</p>
        }
      </div>
    </div>

    @if (einsBereit() && zweiBereit()) {
      <p class="fertigzeile gut">Beide Zugänge stehen — Spotify ist fertig eingerichtet.</p>
    }
  `,
})
export class SpotifyAssistent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient)

  /** Stand des Spotify-Anbieters, wie ihn die Streaming-Seite geladen hat. */
  readonly stand = input<string>('aus')
  /** Die Begründung des Servers („warum unvollständig") — wird 1:1 gezeigt. */
  readonly warum = input<string>('')
  /** Die Anmeldeseite fürs Web-API (E22-Fluss), von der Seite gereicht. */
  readonly anmeldeWeg = input<string>('/spotify')

  /** Feuert bei jedem geglückten Teil — die Seite darüber lädt dann neu. */
  readonly fertig = output<void>()

  readonly ton = signal<TonLage | null>(null)
  readonly meldung = signal('')
  readonly geschafft = signal(false)
  readonly holt = signal(false)
  readonly einsWartet = signal(false)

  readonly einsBereit = computed(() => this.stand() === 'bereit')
  readonly zweiBereit = computed(() => this.ton()?.angemeldet === true)

  private tonUhr: ReturnType<typeof setInterval> | null = null
  private einsUhr: ReturnType<typeof setInterval> | null = null
  /** Schritt-1-Nachfragen endet nach 10 Minuten — länger dauert keine
   *  Anmeldung, die noch gelingt; danach bliebe nur ein Takt ohne Zweck. */
  private einsEndet = 0

  ngOnInit(): void {
    void this.tonHolen()
  }

  ngOnDestroy(): void {
    this.tonTaktAus()
    this.einsTaktAus()
  }

  minSek(s: number): string {
    const m = Math.floor(s / 60)
    return m > 0 ? m + ' min ' + (s % 60) + ' s' : s + ' s'
  }

  // ── Schritt 1: Web-API ───────────────────────────────────────────────────

  einsWartenStarten(): void {
    if (this.einsBereit() || this.einsUhr !== null) return
    this.einsWartet.set(true)
    this.einsEndet = Date.now() + 10 * 60 * 1000
    // FÜNF SEKUNDEN: /api/streaming liest nur die Konfiguration, das trägt
    // die Box mühelos — und schneller brächte nichts, zwischen „zugestimmt"
    // und „eingefügt" liegt ohnehin Tipp-Zeit.
    this.einsUhr = setInterval(() => void this.einsNachfragen(), 5000)
  }

  private einsTaktAus(): void {
    if (this.einsUhr !== null) clearInterval(this.einsUhr)
    this.einsUhr = null
    this.einsWartet.set(false)
  }

  private async einsNachfragen(): Promise<void> {
    if (Date.now() > this.einsEndet) {
      this.einsTaktAus()
      return
    }
    try {
      const s = await firstValueFrom(this.http.get<StreamingLage>('/api/streaming'))
      const spotify = s.anbieter.find((a) => a.id === 'spotify')
      if (spotify?.stand === 'bereit') {
        this.einsTaktAus()
        // Die Seite darüber lädt neu; über das Eingabesignal `stand` wird
        // dieser Schritt dann grün — EINE Quelle der Wahrheit, nicht zwei.
        this.fertig.emit()
      }
    } catch {
      // Ein einzelner Fehlschlag ist keine Nachricht wert — der nächste Takt
      // fragt wieder.
    }
  }

  // ── Schritt 2: Ton ───────────────────────────────────────────────────────

  private tonTaktAn(): void {
    if (this.tonUhr !== null) return
    // VIER SEKUNDEN — derselbe Takt wie auf dem Ton-Blatt der Box. Die BOX
    // fragt bei Spotify nach (5-s-Regel dort); hier wird nur ihr Stand
    // gelesen.
    this.tonUhr = setInterval(() => void this.tonHolen(), 4000)
  }

  private tonTaktAus(): void {
    if (this.tonUhr !== null) clearInterval(this.tonUhr)
    this.tonUhr = null
  }

  async tonHolen(): Promise<void> {
    let t: TonLage
    try {
      t = await firstValueFrom(this.http.get<TonLage>('/api/spotify/ton'))
    } catch {
      // Wie beim Jellyfin-Bruder: kein leerer Kasten, aber auch kein Alarm —
      // der Zustand bleibt einfach der alte, der nächste Takt fragt wieder.
      return
    }
    const vorher = this.ton()
    this.ton.set(t)
    if (t.angemeldet) {
      this.tonTaktAus()
      if (vorher && !vorher.angemeldet) {
        this.meldung.set('Der Ton-Zugang ist gespeichert.')
        this.geschafft.set(true)
        this.fertig.emit()
      }
      return
    }
    if (t.geraet && !t.geraet.fertig && t.geraet.restSekunden > 0) {
      // Ein offener Code — auch einer, den jemand am Gerät geholt hat.
      this.tonTaktAn()
      return
    }
    if (t.geraet?.fertig && t.geraet.meldung) {
      this.meldung.set(t.geraet.meldung)
      this.geschafft.set(false)
    }
    this.tonTaktAus()
  }

  async codeHolen(): Promise<void> {
    this.holt.set(true)
    this.meldung.set('')
    this.geschafft.set(false)
    try {
      await firstValueFrom(this.http.post('/api/spotify/ton/geraetecode', {}))
      await this.tonHolen()
    } catch (e) {
      this.meldung.set(fehlerText(e))
    } finally {
      this.holt.set(false)
    }
  }

  async abbrechen(): Promise<void> {
    try {
      await firstValueFrom(this.http.delete('/api/spotify/ton/geraetecode'))
    } catch {
      // Auch wenn das Abbrechen scheitert: aufhören zu fragen und den Code
      // wegräumen — verfallen wäre er ohnehin.
    }
    this.tonTaktAus()
    this.ton.set(this.ton() ? { ...(this.ton() as TonLage), geraet: null } : null)
  }
}
