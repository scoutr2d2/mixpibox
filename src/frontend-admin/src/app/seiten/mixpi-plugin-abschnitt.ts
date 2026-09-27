/**
 * DIE STECKLEISTE (E77) — wo Plugins sich in eine Sektion der Verwaltung haengen.
 *
 * ══ DIE RICHTUNG IST DER PUNKT ═════════════════════════════════════════════
 *
 * Betreiber, 22.08.2026: „das plugin system soll ermoeglichen die steuerung in
 * die jeweilige sektion zu haengen" und „plugins so bauen das die sich anmelden
 * koennen in sektionen, icons mit bringen die eingehaengt werden koennen".
 *
 * Das PLUGIN sagt in seinem Manifest „ich gehoere in streaming/ardsounds" —
 * nicht die Karte „ich kenne dieses Plugin". Diese Komponente fragt nur: wer
 * hat sich fuer MEINE Sektion gemeldet? Vorher war jede solche Beziehung im
 * Kern fest verdrahtet (der Klangwerk-Abschnitt der Ton-Seite prueft
 * `gibtKlangPlugins()`), und jedes neue Plugin hiesse eine Stelle mehr.
 *
 * ══ WAS SIE ZEIGT — ALLES DEKLARATIV ═══════════════════════════════════════
 *
 * Icon (bringt das Plugin mit, `/api/plugins/<k>/icon`), Name, Befinden
 * (ein Satz), die angemeldeten AKTIONEN als Knoepfe, und der Weg zu den
 * Einstellungen. KEIN freies Plugin-HTML: die Verwaltung ist kompiliertes
 * Angular, und die geschlossenen Vokabulare (Feldarten, Klangglieder,
 * Aktionen) sind die Linie des Hauses.
 *
 * KEINE BACKTICKS in Vorlage und Kommentaren ([[backticks-in-angular-vorlagen]]).
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'

interface PluginStand {
  kennung: string
  name: string
  fassung: string
  zustand: 'laedt' | 'bereit' | 'gescheitert' | 'aus'
  grund?: string
  sektion?: string
  icon: boolean
  aktionen: { kennung: string; name: string; hinweis?: string }[]
}

@Component({
  selector: 'mixpi-plugin-abschnitt',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .leiste { display: grid; gap: 0.6rem; margin-top: 0.55rem; }
    .stecker {
      border: 1px solid var(--rand); border-radius: 10px;
      padding: 0.7rem 0.85rem; display: grid; gap: 0.45rem;
    }
    .kopf { display: flex; gap: 0.55rem; align-items: center; flex-wrap: wrap; }
    .kopf img { width: 1.5rem; height: 1.5rem; object-fit: contain; }
    .name { font-weight: 600; }
    .fassung { color: var(--gedaempft); font-size: 0.8rem; }
    .zustand { font-size: 0.8rem; color: var(--gedaempft); }
    .zustand.gescheitert { color: var(--fehler); }
    .befinden { font-size: 0.88rem; color: var(--gedaempft); margin: 0; }
    .befinden.schlecht { color: var(--fehler); }
    .taten { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    button { font: inherit; font-size: 0.85em; }
    .ausgang { font-size: 0.85rem; margin: 0; }
    .ausgang.gut { color: var(--gut); }
    .ausgang.schlecht { color: var(--fehler); }
    a.leise { font-size: 0.82rem; color: var(--leit); }
  `,
  template: `
    @if (plugins().length > 0) {
      <div class="leiste">
        @for (p of plugins(); track p.kennung) {
          <div class="stecker">
            <div class="kopf">
              @if (p.icon) {
                <img [src]="'/api/plugins/' + p.kennung + '/icon'" alt="" />
              }
              <span class="name">{{ p.name }}</span>
              <span class="fassung">{{ p.fassung }} · Plugin</span>
              @if (p.zustand !== 'bereit') {
                <span class="zustand" [class.gescheitert]="p.zustand === 'gescheitert'">
                  {{ zustandText(p) }}
                </span>
              }
            </div>

            @if (befinden()[p.kennung]; as b) {
              <p class="befinden" [class.schlecht]="!b.ok">{{ b.text }}</p>
            }

            @if (p.zustand === 'bereit' && p.aktionen.length > 0) {
              <div class="taten">
                @for (a of p.aktionen; track a.kennung) {
                  <button
                    type="button"
                    [disabled]="laeuft() === p.kennung + '/' + a.kennung"
                    [title]="a.hinweis || ''"
                    (click)="ausfuehren(p.kennung, a.kennung)"
                  >
                    {{ laeuft() === p.kennung + '/' + a.kennung ? 'Läuft…' : a.name }}
                  </button>
                }
              </div>
            }

            @if (ausgang()[p.kennung]; as e) {
              <p class="ausgang" [class.gut]="e.ok" [class.schlecht]="!e.ok">{{ e.text }}</p>
            }

            <a class="leise" [routerLink]="['/plugins', p.kennung]">Einstellungen und Schalter…</a>
          </div>
        }
      </div>
    } @else if (leerHinweis) {
      <!-- LEER IST NICHT IMMER NICHTS. Auf der Streaming-Karte sitzt die
           Leiste INNERHALB einer Karte, die schon eine Überschrift und einen
           Text hat — dort wäre eine Zeile „nichts angemeldet" nur Rauschen,
           und deshalb bleibt der Hinweis dort ungesetzt und die Leiste
           unsichtbar. Steht die Leiste dagegen unter einer EIGENEN
           Überschrift (Medien-Seite), wäre eine leere Überschrift eine
           Sackgasse: sie sagt nicht, ob hier nichts angemeldet ist oder ob
           die Anzeige kaputt ist. -->
      <p class="befinden">{{ leerHinweis }}</p>
    }
  `,
})
export class MixpiPluginAbschnitt implements OnInit {
  private readonly http = inject(HttpClient)

  /** Fuer welche Sektion diese Leiste fragt — z. B. 'streaming/ardsounds'. */
  @Input({ required: true }) sektion = ''

  /**
   * Was dastehen soll, wenn sich NIEMAND fuer diese Sektion gemeldet hat.
   *
   * LEER GELASSEN bleibt die Leiste unsichtbar — das ist die Vorgabe und der
   * Stand der Streaming-Karten seit E77. Gesetzt wird er dort, wo die Leiste
   * eine eigene Ueberschrift hat und diese sonst ins Leere zeigte.
   */
  @Input() leerHinweis = ''

  readonly plugins = signal<PluginStand[]>([])
  readonly befinden = signal<Record<string, { ok: boolean; text: string }>>({})
  readonly ausgang = signal<Record<string, { ok: boolean; text: string }>>({})
  readonly laeuft = signal('')

  async ngOnInit(): Promise<void> {
    try {
      const antwort = await firstValueFrom(this.http.get<{ geladen: PluginStand[] }>('/api/plugins'))
      // AUCH GESCHEITERTE UND ABGESCHALTETE stehen in der Leiste — mit ihrem
      // Zustand. Ein Plugin, das sich fuer diese Sektion gemeldet hat und
      // nicht laeuft, ist hier eine Auskunft; es zu verstecken hiesse, dass
      // die Sektion je nach Fehlerlage anders aussieht und niemand weiss warum.
      this.plugins.set((antwort.geladen ?? []).filter((p) => p.sektion === this.sektion))
    } catch {
      // Keine Plugin-Auskunft ist kein Absturz der Karte: die Leiste bleibt
      // leer, die uebrige Sektion bleibt bedienbar.
      this.plugins.set([])
      return
    }
    // Das Befinden je Plugin — nacheinander und NACH dem Aufbau der Leiste:
    // ein traeges Plugin darf die Anzeige der anderen nicht aufhalten.
    for (const p of this.plugins()) {
      if (p.zustand !== 'bereit') continue
      try {
        const b = await firstValueFrom(
          this.http.get<{ ok: boolean; text?: string }>('/api/plugins/' + p.kennung + '/befinden'),
        )
        this.befinden.update((m) => ({ ...m, [p.kennung]: { ok: b.ok, text: b.text || '' } }))
      } catch {
        this.befinden.update((m) => ({ ...m, [p.kennung]: { ok: false, text: 'keine Auskunft' } }))
      }
    }
  }

  zustandText(p: PluginStand): string {
    if (p.zustand === 'gescheitert') return 'gescheitert' + (p.grund ? ' — ' + p.grund : '')
    if (p.zustand === 'aus') return 'abgeschaltet'
    return 'lädt…'
  }

  async ausfuehren(kennung: string, aktion: string): Promise<void> {
    if (this.laeuft()) return
    this.laeuft.set(kennung + '/' + aktion)
    this.ausgang.update((m) => ({ ...m, [kennung]: undefined as never }))
    try {
      const e = await firstValueFrom(
        this.http.post<{ ok: boolean; text: string }>('/api/plugins/' + kennung + '/aktion/' + aktion, {}),
      )
      this.ausgang.update((m) => ({ ...m, [kennung]: { ok: e.ok, text: e.text || (e.ok ? 'Erledigt.' : 'Nein.') } }))
    } catch {
      this.ausgang.update((m) => ({ ...m, [kennung]: { ok: false, text: 'Die Aktion hat nicht geantwortet.' } }))
    } finally {
      this.laeuft.set('')
    }
  }
}
