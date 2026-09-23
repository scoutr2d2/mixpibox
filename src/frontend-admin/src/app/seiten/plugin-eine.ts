/**
 * EIN Plugin — seine eigene Seite.
 *
 * WOFÜR: Auf der Liste standen bis zum 14.08.2026 alle Erweiterungen mit allen
 * Feldern untereinander. Das liest sich bei zwei Plugins noch, bei fünf nicht
 * mehr — und vor allem sieht man dort nicht, WO man ist. Eine eigene Seite je
 * Plugin gibt jedem einen Ort, den man verlinken und wiederfinden kann; der
 * Menüpunkt „Plugins" bleibt dabei hervorgehoben (`leuchtet()` in rahmen.ts).
 *
 * DIE SEITE ERFINDET KEINE FELDER — sie kommen aus dem Manifest des Plugins,
 * durchgereicht vom Server. Die beiden Fallen dabei (Geheimnisse, Neustart)
 * stehen bei `plugins.ts` erklärt und gelten hier genauso.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'

interface Feld {
  schluessel: string
  art: 'text' | 'zahl' | 'schalter' | 'geheim'
  name: string
  hinweis?: string
  vorgabe?: string | number | boolean
}

interface Stand {
  kennung: string
  name: string
  fassung: string
  rechte: string[]
  zustand: 'laedt' | 'bereit' | 'gescheitert' | 'aus'
  grund?: string
  kann: { aufloesen: boolean; suchen: boolean; befinden: boolean; ereignis: boolean }
  felder: Feld[]
  /* ══ WARUM DIE AKTIONEN HIER STEHEN UND NICHT IN EINER SEKTION ═══════════
   *
   * Ein Plugin meldet seine Knoepfe im Manifest an (`aktionen`). Gezeichnet
   * wurden sie bis heute NUR von `mixpi-plugin-abschnitt`, und der haengt an
   * genau EINER Stelle im ganzen Baum: in `streaming.ts`, gefiltert auf
   * `sektion === 'streaming/<anbieter>'`.
   *
   * FOLGE: jedes Plugin mit Aktionen, aber ohne passende Sektion, hatte
   * Knoepfe, die NIEMAND DRUECKEN KANN. Am 29.08.2026 nachgezaehlt waren das
   * zwei — `mixpi-mitschnitt` (zwei Aktionen, gar keine Sektion) und
   * `mixpi-archive` (`sektion: medien`, aber `medien` ist nirgends
   * eingehaengt). Gemerkt hat es niemand: die Anmeldung war gueltig, die
   * Route antwortete, das Plugin tat seine Arbeit — es fehlte nur der Ort.
   *
   * DESHALB HIER. Diese Seite gehoert JEDEM Plugin, sie ist ueber die Karte
   * erreichbar, und sie braucht keine Sektion. Damit kann eine Aktion nicht
   * mehr verwaisen — die Sektionen bleiben fuer die Faelle, in denen ein
   * Knopf ZUSAETZLICH dort stehen soll, wo man ihn gerade braucht.
   *
   * UND SIE STEHT IN DER VERWALTUNG, nicht auf der Box: das hier ist nichts
   * fuer Kinder. Die Verwaltung liegt hinter `torBauen(…anmeldungNoetig…)`.
   */
  aktionen?: { kennung: string; name: string; hinweis?: string }[]
}

const RECHT_WORT: Record<string, string> = {
  medienquelle: 'darf Medien liefern',
  ereignisse: 'reagiert auf die Box',
  netz: 'darf ins Internet',
}

const ZUSTAND_WORT: Record<string, string> = {
  bereit: 'bereit',
  laedt: 'lädt …',
  gescheitert: 'nicht geladen',
  aus: 'abgeschaltet',
}

@Component({
  selector: 'mupi-plugin-eine',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="unter"><a routerLink="/plugins">← Alle Erweiterungen</a></p>

    @if (fehler()) {
      <div class="karte"><b>{{ fehler() }}</b></div>
    } @else if (p(); as pl) {
      <h1>
        {{ pl.name }}
        <span class="marke" [class.gut]="pl.zustand === 'bereit'"
              [class.schlecht]="pl.zustand === 'gescheitert'">{{ wort(pl.zustand) }}</span>
      </h1>
      <p class="unter"><code>{{ pl.kennung }}</code> · Fassung {{ pl.fassung }}</p>

      <div class="karte">
        <h2>Eingeschaltet</h2>
        <label class="schalter">
          <input type="checkbox" [checked]="pl.zustand !== 'aus'" [disabled]="werkelt()"
                 (change)="umschalten($any($event.target).checked)" />
          <span>
            @if (pl.zustand === 'aus') {
              Abgeschaltet — es läuft nicht und braucht keinen Speicher. Die Einstellungen bleiben erhalten.
            } @else {
              Läuft. Abschalten beendet es sofort; die Einstellungen bleiben stehen.
            }
          </span>
        </label>
        @if (pl.rechte.length) {
          <p class="hinweis">Es darf: {{ rechteWort(pl.rechte) }}.</p>
        }
      </div>

      @if (pl.zustand === 'gescheitert') {
        <div class="karte">
          <h2>Warum es nicht lädt</h2>
          <p class="fehlgrund">{{ pl.grund || 'Ohne gemeldeten Grund.' }}</p>
        </div>
      }

      @if (pl.felder.length) {
        <div class="karte">
          <h2>Einstellungen</h2>
          @for (f of pl.felder; track f.schluessel) {
            <label class="feld">
              <span class="feldname">{{ f.name }}</span>
              @if (f.art === 'schalter') {
                <input type="checkbox" [checked]="!!wert(f.schluessel)"
                       (change)="setze(f.schluessel, $any($event.target).checked)" />
              } @else {
                <input [type]="f.art === 'geheim' ? 'password' : f.art === 'zahl' ? 'number' : 'text'"
                       [value]="wert(f.schluessel)"
                       [placeholder]="f.art === 'geheim' ? 'unverändert — leer lassen behält den bisherigen' : ''"
                       (input)="setze(f.schluessel, $any($event.target).value)" />
              }
              @if (f.hinweis) { <span class="hinweis">{{ f.hinweis }}</span> }
            </label>
          }
          <div class="taten">
            <button type="button" [disabled]="werkelt()" (click)="speichern()">
              {{ werkelt() === 'speichern' ? 'Wird gespeichert …' : 'Speichern' }}
            </button>
            @if (pl.zustand !== 'aus') {
              <button type="button" class="still" (click)="befinden()">Verbindung prüfen</button>
            }
            @if (meldung()) { <span class="meldung">{{ meldung() }}</span> }
          </div>
          @if (pl.zustand !== 'aus') {
            <p class="hinweis">Ein Speichern startet die Erweiterung neu — das dauert einen Augenblick.</p>
          } @else {
            <p class="hinweis">Sie ist abgeschaltet: gespeichert wird trotzdem, wirksam beim Einschalten.</p>
          }
        </div>
      } @else {
        <div class="karte"><p class="hinweis">Diese Erweiterung braucht nichts eingestellt.</p></div>
      }

      <!-- DIE KNOEPFE DES PLUGINS. Sie standen bis heute nur in den Sektionen,
           und wer keine hatte, hatte Knoepfe, die niemand druecken kann. -->
      @if (pl.aktionen?.length) {
        <div class="karte">
          <h2>Aktionen</h2>
          @if (pl.zustand === 'aus') {
            <p class="hinweis">Die Erweiterung ist abgeschaltet — ihre Aktionen laufen erst wieder nach dem Einschalten.</p>
          }
          @for (a of pl.aktionen; track a.kennung) {
            <div class="feld">
              <button type="button" class="still"
                      [disabled]="pl.zustand === 'aus' || werkelt() === 'aktion:' + a.kennung"
                      (click)="aktionAusloesen(a.kennung)">
                {{ werkelt() === 'aktion:' + a.kennung ? 'Läuft …' : a.name }}
              </button>
              @if (a.hinweis) { <span class="hinweis">{{ a.hinweis }}</span> }
            </div>
          }
          @if (aktionText()) { <pre class="meldung">{{ aktionText() }}</pre> }
        </div>
      }
    } @else {
      <p class="hinweis">Wird geladen …</p>
    }
  `,
  styles: `
    .marke { font-size: .5em; padding: .15em .5em; border-radius: 1em; vertical-align: middle;
             background: var(--rand, #8884); margin-left: .5em; }
    .marke.gut { background: #2a7a3a; color: #fff }
    .marke.schlecht { background: #8a2a2a; color: #fff }
    .fehlgrund { background: #8a2a2a22; border-left: 3px solid #8a2a2a; padding: .5em .7em;
                 white-space: pre-wrap; overflow-wrap: anywhere }
    .schalter { display: flex; gap: .6em; align-items: flex-start }
    .feld { display: block; margin: .8em 0 }
    .feldname { display: block; font-weight: 600; margin-bottom: .2em }
    .feld input[type=text], .feld input[type=password], .feld input[type=number] { width: 100%; max-width: 32em }
    .taten { display: flex; gap: .6em; align-items: center; flex-wrap: wrap; margin-top: 1em }
    .meldung { font-size: .9em }
    /* Mehrzeilig, weil eine Aktion mehrzeilig antworten darf — der Umbruch ist
       hier der Inhalt, nicht die Form. */
    pre.meldung { white-space: pre-wrap; overflow-wrap: anywhere; margin: .8em 0 0 }
  `,
})
export class PluginEineSeite {
  /**
   * Die Kennung aus der Route.
   *
   * ÜBER `ActivatedRoute` UND NICHT ÜBER `input()`: dafür müsste
   * `withComponentInputBinding()` in main.ts stehen, und das tut es nicht.
   * Es dort nachzutragen wäre eine Änderung an der Router-Konfiguration ALLER
   * Seiten — für einen Parameter, den genau diese eine Seite braucht.
   */
  private route = inject(ActivatedRoute)
  private kennungWert = String(this.route.snapshot.paramMap.get('kennung') || '')
  kennung(): string {
    return this.kennungWert
  }

  private http = inject(HttpClient)
  p = signal<Stand | null>(null)
  fehler = signal('')
  meldung = signal('')
  /** Die Antwort der zuletzt gedrueckten Aktion — mehrzeilig, siehe `aktionAusloesen`. */
  aktionText = signal('')
  /** '' | 'speichern' | 'schalten' — sperrt die Knöpfe, solange etwas läuft. */
  werkelt = signal('')
  private entwurf = signal<Record<string, unknown>>({})

  constructor() {
    void this.holen()
  }

  wort(z: string): string {
    return ZUSTAND_WORT[z] ?? z
  }
  rechteWort(r: string[]): string {
    return r.map((x) => RECHT_WORT[x] ?? x).join(', ')
  }
  wert(schluessel: string): unknown {
    return this.entwurf()[schluessel] ?? ''
  }
  setze(schluessel: string, wert: unknown): void {
    this.entwurf.update((e) => ({ ...e, [schluessel]: wert }))
  }

  async holen(): Promise<void> {
    try {
      const l = await firstValueFrom(this.http.get<{ geladen: Stand[] }>('/api/plugins'))
      const p = l.geladen.find((x) => x.kennung === this.kennung())
      if (!p) {
        this.fehler.set(`Es gibt keine Erweiterung „${this.kennung()}".`)
        return
      }
      this.p.set(p)
      if (p.felder.length) {
        const a = await firstValueFrom(
          this.http.get<{ werte: Record<string, unknown> }>(`/api/plugins/${p.kennung}/einstellungen`),
        )
        this.entwurf.set({ ...a.werte })
      }
      this.fehler.set('')
    } catch {
      this.fehler.set('Die Erweiterung ist gerade nicht zu erreichen.')
    }
  }

  async umschalten(an: boolean): Promise<void> {
    this.werkelt.set('schalten')
    this.meldung.set('')
    try {
      await firstValueFrom(this.http.put(`/api/plugins/${this.kennung()}/aktiv`, { an }))
      // NEU LESEN UND NICHT RATEN: beim Einschalten steht einen Moment „lädt",
      // und ob es danach wirklich bereit ist, weiß nur der Server.
      await this.holen()
      this.meldung.set(an ? 'Eingeschaltet.' : 'Abgeschaltet.')
    } catch {
      this.meldung.set('Das hat nicht geklappt.')
    } finally {
      this.werkelt.set('')
    }
  }

  async speichern(): Promise<void> {
    this.werkelt.set('speichern')
    this.meldung.set('')
    try {
      await firstValueFrom(this.http.put(`/api/plugins/${this.kennung()}/einstellungen`, this.entwurf()))
      await this.holen()
      this.meldung.set('Gespeichert.')
    } catch {
      this.meldung.set('Konnte nicht gespeichert werden.')
    } finally {
      this.werkelt.set('')
    }
  }

  async befinden(): Promise<void> {
    this.meldung.set('wird geprüft …')
    try {
      const b = await firstValueFrom(
        this.http.get<{ ok: boolean; text?: string }>(`/api/plugins/${this.kennung()}/befinden`),
      )
      this.meldung.set((b.ok ? '✓ ' : '✗ ') + (b.text || (b.ok ? 'in Ordnung' : 'meldet ein Problem')))
    } catch {
      this.meldung.set('✗ nicht erreichbar')
    }
  }

  /**
   * Einen Knopf des Plugins druecken.
   *
   * `<pre>` und nicht `<span>` fuer die Antwort: eine Aktion darf MEHRZEILIG
   * antworten, und genau die Zeilen sind der Zweck. Die Nachschau des
   * Mitschnitt-Plugins nennt in ihrer Antwort jede kaputte Datei einzeln —
   * in einer einzeiligen Anzeige bliebe davon die Zahl uebrig und die Liste
   * ginge verloren. (Im Journal ist genau das passiert, am 29.08.2026.)
   *
   * KEINE FRIST HIER. Die Route selbst begrenzt den Plugin-Aufruf auf acht
   * Sekunden; laenger laufende Arbeit meldet sich ueber `befinden` zurueck.
   * Eine zweite Frist an dieser Stelle wuerde nur eine zweite Wahrheit
   * erzeugen.
   */
  async aktionAusloesen(aktion: string): Promise<void> {
    this.werkelt.set('aktion:' + aktion)
    this.aktionText.set('')
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; text?: string }>(`/api/plugins/${this.kennung()}/aktion/${aktion}`, {}),
      )
      this.aktionText.set((a.ok ? '✓ ' : '✗ ') + (a.text || (a.ok ? 'erledigt' : 'ging schief')))
    } catch {
      this.aktionText.set('✗ Die Erweiterung hat nicht geantwortet.')
    } finally {
      this.werkelt.set('')
    }
  }
}
