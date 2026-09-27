/**
 * Die Vorlesen-Seite — Elternbereich.
 *
 * WOFÜR: ein Kind im Vorschulalter kann die Kachel nicht lesen. Es tippt sie
 * an, weil es das Bild kennt. Wer den Namen dazu hört, lernt ihn. Und wer
 * gerade lesen lernt, dem hilft die Trennung in Sprechsilben — genau die, die
 * in der ersten Klasse geübt wird.
 *
 * DREI DINGE, die die Seite bewusst so macht:
 *
 * 1. ANHÖREN STATT LESEN. Eine Stimme sucht man nicht nach Datenblatt aus,
 *    sondern indem man sie hört. Jede Stimme hat deshalb einen Probeknopf,
 *    und die Probe läuft über den LAUTSPRECHER DER BOX — dort wird sie später
 *    auch gehört, und ein Handylautsprecher klingt anders.
 * 2. DIE TRENNUNG IST EIN VORSCHLAG. Bei zusammengesetzten Wörtern liegen die
 *    Regeln daneben („Pum-me-lein-horn" statt „Pum-mel-ein-horn"), weil sie
 *    die Fuge nicht kennen. Das steht hier so dran, statt es zu verschweigen —
 *    und in der Medienverwaltung lässt es sich am Eintrag richtigstellen.
 * 3. SPEICHER KOSTET. Jede Stimme belegt bis zu 60 MB auf der Karte. Deshalb
 *    steht die Größe dabei und jede lässt sich wieder entfernen.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { firstValueFrom } from 'rxjs'

type Modus = 'aus' | 'antippen' | 'lernen'

interface Einstellungen {
  modus: Modus
  stimme: string
  interpret: boolean
  tempo: number
}

interface Stimme {
  id: string
  sprache: string
  spracheName: string
  name: string
  guete: string
}

interface Antwort {
  einstellungen: Einstellungen
  stimmen: Stimme[]
  bereit: boolean
}

/**
 * Stimmen zum Nachladen — eine Auswahl, keine Vollständigkeit.
 *
 * Piper hat weit über hundert Stimmen. Hier stehen die, die für eine
 * Kinderbox in Frage kommen: pro Sprache eine gute, möglichst weibliche und
 * möglichst in mittlerer Güte. Wer eine andere will, trägt ihren Namen unten
 * von Hand ein — die Liste ist eine Abkürzung, keine Schranke.
 */
const ANGEBOT: { id: string; was: string }[] = [
  { id: 'de_DE-thorsten-high', was: 'Deutsch · Thorsten · hohe Güte (größer, klingt am besten)' },
  { id: 'en_GB-jenny_dioco-medium', was: 'Englisch (britisch) · Jenny' },
  { id: 'en_US-hfc_female-medium', was: 'Englisch (amerikanisch) · weiblich' },
  { id: 'vi_VN-25hours_single-low', was: 'Vietnamesisch · weitere Stimme' },
  { id: 'fr_FR-siwis-medium', was: 'Französisch · Siwis' },
  { id: 'es_ES-sharvard-medium', was: 'Spanisch · Sharvard' },
  { id: 'it_IT-paola-medium', was: 'Italienisch · Paola' },
  { id: 'nl_NL-mls-medium', was: 'Niederländisch' },
  { id: 'pl_PL-gosia-medium', was: 'Polnisch · Gosia' },
  { id: 'tr_TR-fahrettin-medium', was: 'Türkisch · Fahrettin' },
  { id: 'ru_RU-irina-medium', was: 'Russisch · Irina' },
  { id: 'uk_UA-lada-x_low', was: 'Ukrainisch · Lada' },
  { id: 'ar_JO-kareem-medium', was: 'Arabisch · Kareem' },
  { id: 'ro_RO-mihai-medium', was: 'Rumänisch · Mihai' },
]

const PROBE_TEXT = 'Hallo! Welches Album möchtest du hören?'

@Component({
  selector: 'mupi-vorlesen',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.2rem; font-size: 0.94rem; }
    .karte {
      background: var(--flaeche, #16202b);
      border: 1px solid var(--rand, #24313f);
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1.1rem;
    }
    h2 { font-size: 1.02rem; margin: 0 0 0.7rem; }
    .wahl { display: flex; flex-direction: column; gap: 0.7rem; }
    .wahl label {
      display: flex; gap: 0.7rem; align-items: flex-start;
      padding: 0.6rem 0.7rem; border-radius: 9px;
      border: 1px solid var(--rand, #24313f); cursor: pointer;
    }
    .wahl label.an { border-color: var(--betont, #2b6cb0); background: rgba(43,108,176,0.12); }
    .wahl input { margin-top: 0.2rem; }
    .wahl b { display: block; font-size: 0.98rem; }
    .wahl span { color: var(--gedaempft); font-size: 0.86rem; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--rand, #24313f); }
    th { color: var(--gedaempft); font-weight: 600; font-size: 0.82rem; }
    td.rechts, th.rechts { text-align: right; white-space: nowrap; }
    tr.gewaehlt { background: rgba(43,108,176,0.14); }
    .marke {
      display: inline-block; font-size: 0.74rem; padding: 0.1rem 0.45rem;
      border-radius: 999px; border: 1px solid var(--rand, #24313f); color: var(--gedaempft);
      margin-left: 0.4rem;
    }
    button {
      background: var(--eingabe, #0e1720);
      border: 1px solid var(--rand, #24313f);
      border-radius: 8px; color: inherit;
      padding: 0.4rem 0.75rem; font: inherit; cursor: pointer;
    }
    button.wichtig { background: var(--betont, #2b6cb0); border-color: transparent; }
    button.gefahr { border-color: #7a3b3b; color: #e88; }
    button:disabled { opacity: 0.5; cursor: default; }
    input[type='text'], input[type='number'], select {
      background: var(--eingabe, #0e1720);
      border: 1px solid var(--rand, #24313f);
      border-radius: 8px; color: inherit;
      padding: 0.4rem 0.55rem; font: inherit;
    }
    input[type='text'] { min-width: 16rem; }
    .reihe { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; margin-top: 0.9rem; }
    .hinweis { color: var(--gedaempft); font-size: 0.86rem; margin: 0.5rem 0 0; line-height: 1.45; }
    .meldung { margin-top: 0.8rem; font-size: 0.9rem; }
    .meldung.schlecht { color: var(--warnung, #e0a33a); }
    .probe {
      background: var(--eingabe, #0e1720); border: 1px solid var(--rand, #24313f);
      border-radius: 9px; padding: 0.6rem 0.7rem; margin-top: 0.7rem;
      font-size: 1.05rem; letter-spacing: 0.02em;
    }
    .probe em { font-style: normal; color: var(--gedaempft); }
  `,
  template: `
    <h1>Vorlesen</h1>
    <p class="unter">Die Box spricht aus, was auf einer Kachel steht.</p>

    @if (!daten()?.bereit) {
      <div class="karte">
        <b>Die Sprachausgabe ist auf dieser Box nicht eingerichtet.</b>
        <p class="hinweis">
          Es fehlt Piper. Ohne das Programm kann die Box nichts vorlesen — die
          Einstellungen unten lassen sich zwar speichern, bleiben aber wirkungslos.
        </p>
      </div>
    }

    <div class="karte">
      <h2>Wann wird vorgelesen?</h2>
      <div class="wahl">
        @for (m of MODI; track m.wert) {
          <label [class.an]="entwurf().modus === m.wert">
            <input type="radio" name="modus" [value]="m.wert"
                   [checked]="entwurf().modus === m.wert"
                   (change)="setzeModus(m.wert)" />
            <span>
              <b>{{ m.titel }}</b>
              <span>{{ m.was }}</span>
            </span>
          </label>
        }
      </div>
    </div>

    <div class="karte">
      <h2>Stimme</h2>
      @if (!stimmen().length) {
        <p class="hinweis">Auf dieser Box liegt noch keine Stimme.</p>
      } @else {
        <table>
          <thead>
            <tr>
              <th>Stimme</th><th>Sprache</th><th>Güte</th><th class="rechts">Anhören</th>
            </tr>
          </thead>
          <tbody>
            @for (s of stimmen(); track s.id) {
              <tr [class.gewaehlt]="entwurf().stimme === s.id">
                <td>
                  <label style="cursor:pointer">
                    <input type="radio" name="stimme"
                           [checked]="entwurf().stimme === s.id"
                           (change)="setzeStimme(s.id)" />
                    {{ s.name }}
                    @if (entwurf().stimme === s.id) { <span class="marke">wird benutzt</span> }
                  </label>
                </td>
                <td>{{ s.spracheName }}</td>
                <td>{{ s.guete }}</td>
                <td class="rechts">
                  <button (click)="probeHoeren(s.id)" [disabled]="probeLaeuft() === s.id">
                    {{ probeLaeuft() === s.id ? 'spricht …' : '▶ Probe' }}
                  </button>
                  @if (entfernenGefragt() === s.id) {
                    <button class="gefahr" (click)="entfernen(s.id)">wirklich?</button>
                  } @else {
                    <button (click)="entfernenGefragt.set(s.id)" [disabled]="stimmen().length < 2">
                      entfernen
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="hinweis">
          Die Probe läuft über den Lautsprecher der Box — dort wird sie später auch
          gehört, und ein Handylautsprecher klingt anders.
        </p>
      }

      <div class="reihe">
        <label>
          Tempo
          <input type="number" min="0.5" max="2" step="0.1"
                 [ngModel]="entwurf().tempo" (ngModelChange)="setzeTempo($event)" />
        </label>
        <label>
          <input type="checkbox" [checked]="entwurf().interpret"
                 (change)="setzeInterpret($any($event.target).checked)" />
          Interpret mitsprechen
        </label>
      </div>
      <p class="hinweis">
        Größer als 1 heißt langsamer. Bei Spotify-Listen steht als „Interpret" oft
        nur der Benutzername dessen, der die Liste angelegt hat — deshalb ist das
        abschaltbar.
      </p>
    </div>

    <div class="karte">
      <h2>Silben ausprobieren</h2>
      <div class="reihe" style="margin-top:0">
        <input type="text" placeholder="Titel eingeben, z. B. Kinderlieder"
               [ngModel]="silbenEingabe()" (ngModelChange)="silbenPruefen($event)" />
        <button (click)="silbenHoeren()" [disabled]="!silbenErgebnis()">▶ anhören</button>
      </div>
      @if (silbenErgebnis()) {
        <div class="probe">{{ silbenErgebnis() }}</div>
      }
      <p class="hinweis">
        Die Trennung folgt den Sprechsilben-Regeln der ersten Klasse. Bei
        <em>zusammengesetzten</em> Wörtern liegt sie daneben — aus „Pummeleinhorn"
        wird „Pum-me-lein-horn" statt „Pum-mel-ein-horn", weil die Regel die Fuge
        nicht kennt. Für solche Titel lässt sich die Trennung in der
        Medienverwaltung am Eintrag von Hand richtigstellen.
      </p>
    </div>

    <div class="karte">
      <h2>Weitere Stimmen laden</h2>
      <p class="hinweis" style="margin-top:0">
        Jede Stimme belegt 20 bis 110 MB auf der Karte und wird einmalig aus dem
        Netz geholt.
      </p>
      <div class="reihe">
        <select [ngModel]="ladeWahl()" (ngModelChange)="ladeWahl.set($event)">
          <option value="">— auswählen —</option>
          @for (a of angebotOffen(); track a.id) {
            <option [value]="a.id">{{ a.was }}</option>
          }
        </select>
        <button class="wichtig" (click)="laden(ladeWahl())" [disabled]="!ladeWahl() || laedt()">
          {{ laedt() ? 'lädt …' : 'laden' }}
        </button>
      </div>
      <div class="reihe">
        <input type="text" placeholder="oder einen Piper-Namen, z. B. da_DK-talesyntese-medium"
               [ngModel]="ladeFrei()" (ngModelChange)="ladeFrei.set($event)" />
        <button (click)="laden(ladeFrei())" [disabled]="!ladeFrei() || laedt()">laden</button>
      </div>
      @if (meldung()) {
        <p class="meldung" [class.schlecht]="meldungSchlecht()">{{ meldung() }}</p>
      }
    </div>
  `,
})
export class VorlesenSeite {
  private http = inject(HttpClient)

  readonly MODI: { wert: Modus; titel: string; was: string }[] = [
    { wert: 'aus', titel: 'Aus', was: 'Die Box bleibt still und verhält sich wie immer.' },
    {
      wert: 'antippen',
      titel: 'Beim Antippen vorlesen',
      was: 'Ein Tipp auf die Kachel spricht ihren Namen, danach beginnt die Musik. Für Kinder, die noch nicht lesen.',
    },
    {
      wert: 'lernen',
      titel: 'Lernmodus mit Silben',
      was: 'Ein Tipp zeigt den Namen in Sprechsilben und liest ihn Silbe für Silbe vor. Erst der zweite Tipp startet die Musik.',
    },
  ]

  readonly daten = signal<Antwort | null>(null)
  readonly entwurf = signal<Einstellungen>({ modus: 'aus', stimme: '', interpret: false, tempo: 1.1 })
  readonly stimmen = computed(() => this.daten()?.stimmen ?? [])

  readonly probeLaeuft = signal('')
  readonly entfernenGefragt = signal('')
  readonly ladeWahl = signal('')
  readonly ladeFrei = signal('')
  readonly laedt = signal(false)
  readonly meldung = signal('')
  readonly meldungSchlecht = signal(false)
  readonly silbenEingabe = signal('')
  readonly silbenErgebnis = signal('')

  /** Nur anbieten, was noch nicht da ist — sonst lädt man zweimal dasselbe. */
  readonly angebotOffen = computed(() => {
    const da = new Set(this.stimmen().map((s) => s.id))
    return ANGEBOT.filter((a) => !da.has(a.id))
  })

  private klang: HTMLAudioElement | null = null

  constructor() {
    void this.laden0()
  }

  private async laden0(): Promise<void> {
    try {
      const a = await firstValueFrom(this.http.get<Antwort>('/api/vorlesen'))
      this.daten.set(a)
      this.entwurf.set({ ...a.einstellungen })
    } catch {
      this.sag('Die Einstellungen konnten nicht geladen werden.', true)
    }
  }

  setzeModus(m: Modus): void {
    this.entwurf.update((e) => ({ ...e, modus: m }))
    void this.speichern()
  }

  setzeStimme(id: string): void {
    this.entwurf.update((e) => ({ ...e, stimme: id }))
    void this.speichern()
  }

  setzeTempo(t: number): void {
    this.entwurf.update((e) => ({ ...e, tempo: Number(t) }))
    void this.speichern()
  }

  setzeInterpret(an: boolean): void {
    this.entwurf.update((e) => ({ ...e, interpret: an }))
    void this.speichern()
  }


  private async speichern(): Promise<void> {
    try {
      const e = await firstValueFrom(this.http.put<Einstellungen>('/api/vorlesen', this.entwurf()))
      // Der Server biegt zurecht, was nicht geht — dann soll auch das hier
      // stehen, was wirklich gilt, und nicht das, was gewünscht war.
      this.entwurf.set({ ...e })
      this.sag('Gespeichert.', false)
    } catch {
      this.sag('Speichern fehlgeschlagen.', true)
    }
  }

  /**
   * Probe hören — der Ton wird auf dem GERÄT ausgegeben, auf dem diese Seite
   * offen ist. Sitzt man am Rechner, hört man ihn dort; das ist gewollt, denn
   * beim Aussuchen will man ihn sofort hören und nicht in der Küche.
   */
  probeHoeren(id: string): void {
    this.probeLaeuft.set(id)
    this.spiele(`/api/vorlesen/sprich?stimme=${encodeURIComponent(id)}&text=${encodeURIComponent(PROBE_TEXT)}`, () =>
      this.probeLaeuft.set(''),
    )
  }

  silbenHoeren(): void {
    const t = this.silbenEingabe().trim()
    if (t) this.spiele(`/api/vorlesen/sprich?silben=1&text=${encodeURIComponent(t)}`)
  }

  private spiele(url: string, fertig?: () => void): void {
    this.klang?.pause()
    const a = new Audio(url)
    this.klang = a
    a.onended = () => fertig?.()
    // Auch bei einem Fehler den Knopf wieder freigeben — sonst steht dort für
    // immer „spricht …" und die Seite sieht kaputt aus.
    a.onerror = () => {
      fertig?.()
      this.sag('Die Probe konnte nicht abgespielt werden.', true)
    }
    void a.play().catch(() => {
      fertig?.()
      this.sag('Die Probe konnte nicht abgespielt werden.', true)
    })
  }

  async silbenPruefen(text: string): Promise<void> {
    this.silbenEingabe.set(text)
    const t = text.trim()
    if (!t) return this.silbenErgebnis.set('')
    try {
      const a = await firstValueFrom(
        this.http.get<{ silben: string }>(`/api/vorlesen/silben?text=${encodeURIComponent(t)}`),
      )
      this.silbenErgebnis.set(a.silben)
    } catch {
      this.silbenErgebnis.set('')
    }
  }

  async laden(id: string): Promise<void> {
    const name = (id || '').trim()
    if (!name) return
    this.laedt.set(true)
    this.sag(`„${name}" wird geladen — das dauert einen Moment.`, false)
    try {
      const a = await firstValueFrom(this.http.post<{ ok?: boolean; error?: string }>('/api/vorlesen/stimme', { id: name }))
      if (a.error) {
        this.sag(this.fehlerText(a.error, name), true)
      } else {
        this.sag(`„${name}" ist geladen.`, false)
        this.ladeWahl.set('')
        this.ladeFrei.set('')
        await this.laden0()
      }
    } catch (e) {
      const grund = (e as { error?: { error?: string } })?.error?.error ?? ''
      this.sag(this.fehlerText(grund, name), true)
    } finally {
      this.laedt.set(false)
    }
  }

  private fehlerText(grund: string, name: string): string {
    if (grund === 'nameUngueltig') return `„${name}" sieht nicht wie ein Piper-Name aus (z. B. de_DE-ramona-low).`
    if (grund === 'nichtGefunden') return `„${name}" gibt es bei Piper nicht.`
    return `„${name}" konnte nicht geladen werden — steht die Box im Netz?`
  }

  async entfernen(id: string): Promise<void> {
    this.entfernenGefragt.set('')
    try {
      await firstValueFrom(this.http.delete(`/api/vorlesen/stimme/${encodeURIComponent(id)}`))
      this.sag('Stimme entfernt.', false)
      await this.laden0()
    } catch {
      this.sag('Die Stimme konnte nicht entfernt werden.', true)
    }
  }

  private sag(text: string, schlecht: boolean): void {
    this.meldung.set(text)
    this.meldungSchlecht.set(schlecht)
  }
}
