/**
 * Gruppen — welche Interpretennamen zusammengehoeren (26.09.2026).
 *
 * WOZU (Betreiber): „die meta gruppen besser sortieren, bspw sendung maus
 * ueber verschiedene dienste". Dieselbe Serie heisst bei Spotify, in der ARD
 * und im eigenen Ordner verschieden. Die Box hat seit E64b eine eigene
 * Kennung, unter der mehrere Namen stehen koennen
 * (src/backend-api/src/interpretenkennung.ts); diese Seite ist die erste, die
 * sie fuellt.
 *
 * DIE ARBEITSTEILUNG, und sie ist der Grund fuer den Aufbau:
 *   VORSCHLAGEN  tut das Plugin mixpi-gruppen (Jev ueber OpenRouter/TypeSafe),
 *                nur auf Knopfdruck.
 *   ENTSCHEIDEN  tut der Mensch hier. Erst sein Klick ruft den Kern, und zwar
 *                mit Stufe hand — eine Maschine darf nicht zusammenlegen
 *                (llmwiki interpretenkennung-gehoert-der-box).
 *   ZURUECK      geht jede Entscheidung: „Lösen" gibt einem Namen wieder eine
 *                eigene Kennung, „wieder vorschlagen" holt ein Nein zurueck.
 *
 * WAS SICH DADURCH HEUTE AENDERT — ehrlich: an der runden Reihe der Box noch
 * nichts. Die Interpretenreihe arbeitet weiter ueber den Namensschluessel; das
 * Umstellen auf die Kennung ist ein eigener Block. Die Seite sagt das dazu,
 * damit niemand eine Wirkung sucht, die es noch nicht gibt.
 *
 * DAS VORBILD ist „Interpreten" und „Doppelte": Karten, ein Knopf je Zeile,
 * zwei Klicks fuer alles, was wegnimmt.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'

export const PLUGIN = 'mixpi-gruppen'

export interface NamenSeite {
  name: string
  dienste: string[]
  anzahl: number
}

export interface Vorschlag {
  paar: string
  haupt: NamenSeite
  neben: NamenSeite
  wahl: 'dieselbe' | 'mitwirkung' | 'verschieden'
  sicherheit: number
  gemeinsam: string[]
}

export interface Lauf {
  begonnen: string
  fertig: string | null
  namen: number
  paare: number
  gefragt: number
  fehler: string[]
  abgebrochen: string | null
  kosten: number
  anbieter: string
  modell: string
}

export interface Stand {
  lauf: Lauf | null
  laeuft: boolean
  schwelle: number
  vorschlaege: Vorschlag[]
  unsicher: number
  beantwortet: number
  angenommen: number
  abgelehnt: number
}

export interface Kennung {
  id: string
  namen: { name: string; stufe: string }[]
  verweise: { dienst: string; kennung: string }[]
}

/**
 * Ein Name fuer den Vergleich HIER auf der Seite. Der Kern vergleicht mit
 * `interpretSchluesselAus`, das es im Browser nicht gibt; diese grobere Form
 * reicht, um schon Zusammengelegtes auszublenden. Irrt sie, erscheint ein
 * Vorschlag einmal zu oft — und der Kern antwortet auf das Zusammenlegen mit
 * „stand schon da". Kein Schaden, nur ein Klick.
 */
export function vergleichsName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Zu welcher Kennung ein Name gehoert — oder null. */
export function kennungVon(kennungen: Kennung[], name: string): string | null {
  const n = vergleichsName(name)
  return kennungen.find((k) => k.namen.some((x) => vergleichsName(x.name) === n))?.id ?? null
}

/** Nur die Vorschlaege, die noch nicht erledigt sind — beide Namen schon unter einer Kennung heisst erledigt. */
export function offeneVorschlaege(vorschlaege: Vorschlag[], kennungen: Kennung[]): Vorschlag[] {
  return vorschlaege.filter((v) => {
    const a = kennungVon(kennungen, v.haupt.name)
    return !a || a !== kennungVon(kennungen, v.neben.name)
  })
}

const WAHL_TEXT: Record<string, string> = {
  dieselbe: 'dieselbe Serie',
  mitwirkung: 'Mitwirkung',
  verschieden: 'verschieden',
}

@Component({
  selector: 'mupi-gruppen',
  standalone: true,
  imports: [RouterLink],
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
    button.tun {
      border: 1px solid var(--betont, #2b6cb0); background: rgba(43,108,176,0.18); color: inherit;
      border-radius: 9px; padding: 0.5rem 0.95rem; cursor: pointer; font-size: 0.92rem;
    }
    button:disabled { opacity: 0.5; cursor: default; }
    ul { list-style: none; margin: 0.9rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
    li {
      display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;
      border: 1px solid var(--rand, #24313f); border-radius: 10px; padding: 0.55rem 0.65rem;
    }
    .text { flex: 1; min-width: 14rem; }
    .text b { display: block; font-size: 0.96rem; overflow-wrap: anywhere; }
    .text span { color: var(--gedaempft); font-size: 0.84rem; }
    /* DARF SCHRUMPFEN UND UMBRECHEN: der Knopf nennt den Zielnamen, und
       „Unter „Hello Kitty Hörspiele“ zusammenlegen" ist auf dem Telefon
       breiter als die Zeile (gemessen 26.09.2026: 419 statt 375 px). */
    .knoepfe { display: flex; gap: 0.35rem; flex: 0 1 auto; min-width: 0; align-items: center; flex-wrap: wrap; }
    .knoepfe button.ja { white-space: normal; text-align: left; max-width: 100%; }
    .knoepfe button {
      border: 1px solid var(--rand, #24313f); background: transparent; color: inherit;
      border-radius: 8px; padding: 0.3rem 0.6rem; cursor: pointer; font-size: 0.86rem;
    }
    .knoepfe button.ja { border-color: var(--betont, #2b6cb0); }
    .knoepfe button.weg { border-color: var(--warnung, #e06c75); }
    .marke { font-size: 0.76rem; border-radius: 999px; padding: 0.05rem 0.5rem; border: 1px solid var(--rand, #24313f); }
    .namen { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.35rem; }
    .namen .marke { display: inline-flex; gap: 0.35rem; align-items: center; font-size: 0.84rem; padding: 0.15rem 0.55rem; }
    .namen .marke button { border: none; background: transparent; color: var(--warnung, #e06c75); cursor: pointer; padding: 0; font-size: 0.8rem; }
    .hinweis { color: var(--gedaempft); font-size: 0.86rem; line-height: 1.5; margin: 0.8rem 0 0; }
    .meldung { margin-top: 0.8rem; font-size: 0.9rem; }
    .meldung.schlecht { color: var(--warnung, #e06c75); }
    .fortschritt { height: 6px; border-radius: 3px; background: var(--rand, #24313f); overflow: hidden; margin-top: 0.6rem; }
    .fortschritt i { display: block; height: 100%; background: var(--betont, #2b6cb0); }
  `,
  template: `
    <h1>Gruppen</h1>
    <p class="unter">
      Dieselbe Serie heißt bei Spotify, in der ARD und im eigenen Ordner oft verschieden. Hier
      entscheidest du, welche Namen zusammengehören — vorgeschlagen von der Erweiterung
      „Interpreten-Gruppen (Jev)“, zusammengelegt erst durch deinen Klick.
    </p>

    <div class="karte">
      <h2>Durchlauf</h2>
      @if (nichtBereit()) {
        <p class="hinweis">
          Die Erweiterung antwortet nicht. Unter
          <a [routerLink]="['/plugins', plugin]">Erweiterungen → Interpreten-Gruppen</a> einschalten
          und einen OpenRouter-Schlüssel eintragen.
        </p>
      } @else {
        <button type="button" class="tun" (click)="durchlaufen()" [disabled]="laeuft() || arbeitet()">
          {{ laeuft() ? 'Läuft …' : 'Jetzt vorschlagen lassen' }}
        </button>
        @if (stand()?.lauf; as l) {
          <p class="hinweis">
            @if (laeuft()) {
              {{ l.gefragt }} von {{ l.paare }} Paaren gefragt ({{ l.anbieter }}, {{ l.modell }}).
            } @else {
              Letzter Durchlauf: {{ l.paare }} Paare aus {{ l.namen }} Namen, {{ zeit(l.fertig || l.begonnen) }}.
              @if (l.kosten > 0) {
                Kosten laut Anbieter: {{ kosten(l.kosten) }}.
              }
            }
            @if (l.abgebrochen) {
              <br /><span class="meldung schlecht">Abgebrochen: {{ l.abgebrochen }}</span>
            } @else if (l.fehler.length) {
              <br />{{ l.fehler.length }} Paare ohne Antwort, zuerst: {{ l.fehler[0] }}
            }
          </p>
          @if (laeuft() && l.paare > 0) {
            <div class="fortschritt"><i [style.width.%]="(100 * l.gefragt) / l.paare"></i></div>
          }
        }
      }
      <p class="hinweis">
        Gefragt werden nur Namenspaare, die ein Wort teilen — im Namen oder in den Titeln — und
        nur solche, die noch keine Antwort haben. An Jev gehen Namen und einige Titel, sonst nichts.
      </p>
    </div>

    <div class="karte">
      <h2>Vorschläge ({{ offen().length }})</h2>
      @if (offen().length) {
        <ul>
          @for (v of offen(); track v.paar) {
            <li>
              <span class="text">
                <b>{{ v.haupt.name }} ⟷ {{ v.neben.name }}</b>
                <span>
                  <span class="marke">{{ wahlText(v.wahl) }}</span>
                  · Sicherheit {{ prozent(v.sicherheit) }} %
                  · {{ v.haupt.dienste.join(', ') }} / {{ v.neben.dienste.join(', ') }}
                </span>
              </span>
              <span class="knoepfe">
                <button type="button" class="ja" (click)="zusammenlegen(v)" [disabled]="arbeitet()">
                  Unter „{{ v.haupt.name }}“ zusammenlegen
                </button>
                <button type="button" (click)="entscheiden(v.paar, 'abgelehnt')" [disabled]="arbeitet()">Nein</button>
              </span>
            </li>
          }
        </ul>
      } @else {
        <p class="hinweis">Keine offenen Vorschläge.</p>
      }
      @if (stand(); as s) {
        <p class="hinweis">
          Gezeigt wird ab {{ prozent(s.schwelle) }} % Sicherheit; {{ s.unsicher }} weitere liegen darunter
          (die Schwelle steht in den Einstellungen der Erweiterung). {{ s.angenommen }} angenommen,
          {{ s.abgelehnt }} abgelehnt.
          @if (s.abgelehnt) {
            <button type="button" class="tun" (click)="abgelehnteZurueck()" [disabled]="arbeitet()">
              Abgelehnte wieder vorschlagen
            </button>
          }
        </p>
      }
    </div>

    <div class="karte">
      <h2>Bestehende Gruppen ({{ gruppen().length }})</h2>
      @if (gruppen().length) {
        <ul>
          @for (g of gruppen(); track g.id) {
            <li>
              <span class="text">
                <b>{{ g.namen[0].name }}</b>
                <span class="namen">
                  @for (n of g.namen.slice(1); track n.name) {
                    <span class="marke">
                      {{ n.name }}
                      <button
                        type="button"
                        (click)="loesen(n.name)"
                        [disabled]="arbeitet()"
                        [attr.aria-label]="'„' + n.name + '“ aus der Gruppe lösen'"
                      >
                        {{ bestaetigen() === n.name ? 'wirklich lösen?' : '✕' }}
                      </button>
                    </span>
                  }
                </span>
              </span>
            </li>
          }
        </ul>
      } @else {
        <p class="hinweis">Noch keine Gruppe mit mehr als einem Namen.</p>
      }
      <p class="hinweis">
        Die Gruppen stehen in config/interpreten.json. Die runde Interpretenreihe der Box richtet
        sich noch nach den einzelnen Namen — das Umstellen auf die Gruppen ist der nächste Schritt.
      </p>
    </div>

    @if (meldung()) {
      <p class="meldung" [class.schlecht]="meldungSchlecht()">{{ meldung() }}</p>
    }
  `,
})
export class GruppenSeite {
  private readonly http = inject(HttpClient)
  readonly plugin = PLUGIN

  readonly stand = signal<Stand | null>(null)
  readonly kennungen = signal<Kennung[]>([])
  readonly nichtBereit = signal(false)
  readonly arbeitet = signal(false)
  readonly bestaetigen = signal('')
  readonly meldung = signal('')
  readonly meldungSchlecht = signal(false)

  readonly laeuft = computed(() => Boolean(this.stand()?.laeuft))
  readonly offen = computed(() => offeneVorschlaege(this.stand()?.vorschlaege ?? [], this.kennungen()))
  readonly gruppen = computed(() => this.kennungen().filter((k) => k.namen.length > 1))

  private wecker: ReturnType<typeof setTimeout> | null = null
  private weg = false

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.weg = true
      if (this.wecker) clearTimeout(this.wecker)
    })
    void this.laden()
  }

  wahlText(w: string): string {
    return WAHL_TEXT[w] ?? w
  }

  prozent(x: number): number {
    return Math.round(x * 100)
  }

  kosten(usd: number): string {
    return usd < 0.01 ? 'unter 1 Cent' : `${usd.toFixed(2)} $`
  }

  zeit(iso: string): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  }

  private sag(text: string, schlecht: boolean): void {
    this.meldung.set(text)
    this.meldungSchlecht.set(schlecht)
  }

  private async standLaden(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<Stand>(`/api/plugins/${PLUGIN}/http/stand`))
      this.stand.set(s)
      this.nichtBereit.set(false)
    } catch {
      this.nichtBereit.set(true)
    }
    // WAEHREND EIN LAUF LAEUFT, alle zwei Sekunden nachsehen. Das Plugin
    // kann nicht melden, wenn es fertig ist; ein Ruf in es hinein darf nur
    // 8 s dauern, der Lauf dauert laenger.
    if (this.wecker) clearTimeout(this.wecker)
    if (this.stand()?.laeuft && !this.weg) this.wecker = setTimeout(() => void this.standLaden(), 2000)
  }

  private async kennungenLaden(): Promise<void> {
    try {
      const a = await firstValueFrom(this.http.get<{ kennungen: Kennung[] }>('/api/interpretenkennungen'))
      this.kennungen.set(a.kennungen ?? [])
    } catch {
      this.sag('Die Gruppen der Box konnten nicht geladen werden.', true)
    }
  }

  private async laden(): Promise<void> {
    await Promise.all([this.standLaden(), this.kennungenLaden()])
  }

  async durchlaufen(): Promise<void> {
    this.arbeitet.set(true)
    try {
      const r = await firstValueFrom(
        this.http.post<{ ok: boolean; text: string }>(`/api/plugins/${PLUGIN}/http/durchlauf`, {}),
      )
      this.sag(r.text, !r.ok)
    } catch (e) {
      const text = (e as { error?: { text?: string } })?.error?.text
      this.sag(text || 'Der Durchlauf ließ sich nicht starten.', true)
    } finally {
      this.arbeitet.set(false)
    }
    await this.standLaden()
  }

  /**
   * Zusammenlegen, IN DIESER REIHENFOLGE:
   *   1. Kennung fuer den Hauptnamen holen oder anlegen. Gibt es sie schon,
   *      kommt die vorhandene zurueck — der Kern legt keinen Namen doppelt an.
   *   2. Den zweiten Namen daranhaengen, mit Stufe hand. Stand er schon in
   *      einer anderen Gruppe, zieht er um (so will es die Stufe hand).
   *   3. Erst DANACH dem Plugin sagen, dass entschieden ist. Andersherum
   *      verschwaende ein Vorschlag, dessen Zusammenlegen gescheitert ist.
   */
  async zusammenlegen(v: Vorschlag): Promise<void> {
    this.arbeitet.set(true)
    try {
      const a = await firstValueFrom(
        this.http.post<{ id: string }>('/api/interpretenkennungen', { name: v.haupt.name, stufe: 'hand' }),
      )
      await firstValueFrom(
        this.http.post('/api/interpretenkennungen/name', { id: a.id, name: v.neben.name, stufe: 'hand' }),
      )
      await firstValueFrom(
        this.http.post(`/api/plugins/${PLUGIN}/http/entscheiden`, { paar: v.paar, urteil: 'angenommen' }),
      )
      this.sag(`„${v.neben.name}“ steht jetzt unter „${v.haupt.name}“.`, false)
    } catch (e) {
      const hinweis = (e as { error?: { hinweis?: string } })?.error?.hinweis
      this.sag(`Zusammenlegen ging nicht${hinweis ? `: ${hinweis}` : '.'}`, true)
    } finally {
      this.arbeitet.set(false)
    }
    await this.laden()
  }

  async entscheiden(paar: string, urteil: 'abgelehnt' | 'offen'): Promise<void> {
    this.arbeitet.set(true)
    try {
      await firstValueFrom(this.http.post(`/api/plugins/${PLUGIN}/http/entscheiden`, { paar, urteil }))
    } catch {
      this.sag('Die Entscheidung ließ sich nicht speichern.', true)
    } finally {
      this.arbeitet.set(false)
    }
    await this.standLaden()
  }

  /** Alle Neins zuruecknehmen — der Rueckweg fuer ein vorschnelles „Nein". */
  async abgelehnteZurueck(): Promise<void> {
    this.arbeitet.set(true)
    try {
      await firstValueFrom(
        this.http.post(`/api/plugins/${PLUGIN}/http/entscheiden`, { alle: 'abgelehnt', urteil: 'offen' }),
      )
      this.sag('Die abgelehnten Vorschläge stehen wieder da.', false)
    } catch {
      this.sag('Das Zurückholen ging nicht.', true)
    } finally {
      this.arbeitet.set(false)
    }
    await this.standLaden()
  }

  /** Einen Namen aus seiner Gruppe loesen — mit zweitem Klick, weil es wegnimmt. */
  async loesen(name: string): Promise<void> {
    if (this.bestaetigen() !== name) {
      this.bestaetigen.set(name)
      return
    }
    this.bestaetigen.set('')
    this.arbeitet.set(true)
    try {
      await firstValueFrom(this.http.post('/api/interpretenkennungen/loesen', { name, stufe: 'hand' }))
      this.sag(`„${name}“ steht wieder für sich.`, false)
    } catch (e) {
      const hinweis = (e as { error?: { hinweis?: string } })?.error?.hinweis
      this.sag(`Lösen ging nicht${hinweis ? `: ${hinweis}` : '.'}`, true)
    } finally {
      this.arbeitet.set(false)
    }
    await this.kennungenLaden()
  }
}
