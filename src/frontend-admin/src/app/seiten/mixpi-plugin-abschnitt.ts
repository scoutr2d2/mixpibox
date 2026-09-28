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
 * ══ DAS ANGEBOT (28.09.2026) ═══════════════════════════════════════════════
 *
 * Auf der Medien-Seite fragt die Leiste zusaetzlich jedes bereite Plugin nach
 * seinem ANGEBOT: GET /api/plugins/<k>/http/angebot, auf Wunsch mit ?q=. Wer
 * etwas anbietet, bekommt darunter eine Liste mit „aufnehmen"; wer die Route
 * nicht kennt (404), bekommt nichts — mixpi-archive hat seinen eigenen Kasten
 * und bleibt davon unberuehrt. Damit braucht ein neues Medien-Plugin KEINE
 * Zeile mehr in seiten/medien.ts: vorher stand dort je Plugin ein eigener
 * Kasten mit seiner Adresse (Archiv, ARD), und „eine dritte Suchflaeche
 * braucht eine Kernaenderung" stand als offene Stelle in plugins/README.md.
 *
 * DER VORSCHLAG WIRD DURCHGEREICHT, nicht nachgebaut — dieselbe Regel wie
 * beim Archiv: das Plugin ist die eine Stelle, die weiss, wie ein Eintrag fuer
 * es selbst aussieht. Die Leiste schickt ihn unveraendert an POST /api/medien.
 *
 * OB ETWAS SCHON DA IST, weiss die Bibliothek, nicht das Plugin: die Seite
 * reicht die Plugin-Kennungen ihrer Eintraege herein (vorhanden), und nach
 * jedem Aufnehmen meldet die Leiste es hinaus (aufgenommen), damit die Seite
 * neu laedt.
 *
 * KEINE BACKTICKS in Vorlage und Kommentaren ([[backticks-in-angular-vorlagen]]).
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core'
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

/** Ein Eintrag, wie ein Plugin ihn unter http/angebot liefert. */
export interface AngebotWerk {
  kennung: string
  titel: string
  hinweis?: string
  bild?: string
  /** Der FERTIGE data.json-Eintrag — type 'plugin', id die volle Medienkennung. */
  vorschlag: { type: string; category: string; id: string; title: string; artist?: string; cover?: string }
}

interface AngebotStand {
  suche: boolean
  platzhalter: string
  werke: AngebotWerk[]
  gesamt: number
  wort: string
  laedt: boolean
  gesucht: boolean
  fehler: string
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
    .angebot { display: grid; gap: 0.4rem; border-top: 1px solid var(--rand); padding-top: 0.5rem; }
    .angebot .reihe { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    .angebot input { font: inherit; min-width: 12rem; flex: 1; }
    .werke { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; }
    .werke li { display: flex; gap: 0.6rem; align-items: center; justify-content: space-between; }
    .werke img { width: 2.2rem; height: 2.2rem; object-fit: cover; border-radius: 6px; flex: none; }
    .werke .wer { display: grid; gap: 0.1rem; flex: 1; min-width: 0; }
    .werke .hinweis { font-size: 0.8rem; color: var(--gedaempft); }
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

            @if (angebote()[p.kennung]; as a) {
              <div class="angebot">
                @if (a.suche) {
                  <div class="reihe">
                    <input
                      type="search"
                      [value]="a.wort"
                      [placeholder]="a.platzhalter"
                      (input)="wortSetzen(p.kennung, $any($event.target).value)"
                      (keyup.enter)="suchen(p.kennung)"
                    />
                    <button type="button" (click)="suchen(p.kennung)" [disabled]="a.laedt">
                      {{ a.laedt ? 'sucht …' : 'suchen' }}
                    </button>
                  </div>
                }
                @if (a.werke.length) {
                  <ul class="werke">
                    @for (w of a.werke; track w.kennung) {
                      <li>
                        @if (w.bild) {
                          <img [src]="w.bild" alt="" loading="lazy" />
                        }
                        <span class="wer">
                          <b>{{ w.titel }}</b>
                          @if (w.hinweis) {
                            <span class="hinweis">{{ w.hinweis }}</span>
                          }
                        </span>
                        <button
                          type="button"
                          (click)="aufnehmen(p.kennung, w)"
                          [disabled]="schonDa(w) || nimmt() === p.kennung + '/' + w.kennung"
                        >
                          {{ schonDa(w) ? 'schon da' : nimmt() === p.kennung + '/' + w.kennung ? 'nimmt …' : 'aufnehmen' }}
                        </button>
                      </li>
                    }
                  </ul>
                } @else if (a.gesucht && !a.laedt) {
                  <p class="befinden">Nichts gefunden zu „{{ a.wort }}“.</p>
                }
                @if (a.fehler) {
                  <p class="ausgang schlecht">{{ a.fehler }}</p>
                }
              </div>
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

  /**
   * Die Plugins nach ihrem Angebot fragen (http/angebot)? Nur die Medien-Seite
   * setzt das — auf einer Streaming-Karte gibt es nichts aufzunehmen.
   */
  @Input() angebot = false

  /** Die vollen Plugin-Medienkennungen, die schon in der Bibliothek stehen. */
  @Input() vorhanden: readonly string[] = []

  /** Nach jedem Aufnehmen — die Seite laedt dann ihre Bibliothek neu. */
  @Output() aufgenommen = new EventEmitter<void>()

  readonly plugins = signal<PluginStand[]>([])
  readonly befinden = signal<Record<string, { ok: boolean; text: string }>>({})
  readonly ausgang = signal<Record<string, { ok: boolean; text: string }>>({})
  readonly laeuft = signal('')
  readonly angebote = signal<Record<string, AngebotStand>>({})
  readonly nimmt = signal('')

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
    // DAS ANGEBOT NEBENHER, nicht hinter dem Befinden: ein traeges Befinden
    // soll die Liste zum Aufnehmen nicht aufhalten — und umgekehrt.
    if (this.angebot) {
      for (const p of this.plugins()) {
        if (p.zustand === 'bereit') void this.angebotHolen(p.kennung, '')
      }
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

  /**
   * Das Angebot eines Plugins holen — beim Aufbau ohne Suchwort, danach mit.
   *
   * EIN 404 IST KEIN FEHLER, sondern die Antwort „ich biete nichts an": dann
   * bleibt der Stecker, wie er war. Jeder andere Fehler steht als Satz da,
   * aber nur, wenn es vorher schon ein Angebot gab — sonst saehe ein Plugin
   * ohne Angebot kaputt aus, nur weil es gerade nicht antwortet.
   */
  async angebotHolen(kennung: string, wort: string): Promise<void> {
    const q = wort.trim()
    const alt = this.angebote()[kennung]
    if (alt) this.angebotSetzen(kennung, { ...alt, laedt: true, fehler: '' })
    try {
      const d = await firstValueFrom(
        this.http.get<{ suche?: boolean; platzhalter?: string; gesamt?: number; werke?: AngebotWerk[] }>(
          '/api/plugins/' + kennung + '/http/angebot' + (q ? '?q=' + encodeURIComponent(q) : ''),
        ),
      )
      const werke = (d.werke ?? []).filter((w) => w?.kennung && w.vorschlag?.id)
      this.angebotSetzen(kennung, {
        suche: d.suche === true,
        platzhalter: d.platzhalter || 'suchen',
        werke,
        gesamt: d.gesamt ?? werke.length,
        wort: q,
        laedt: false,
        gesucht: q !== '',
        fehler: '',
      })
    } catch (f) {
      if (!alt) return
      const status = (f as { status?: number }).status
      this.angebotSetzen(kennung, {
        ...alt,
        laedt: false,
        fehler: status === 404 ? '' : 'Das Plugin hat nicht geantwortet.',
      })
    }
  }

  /**
   * DAS WORT KOMMT AUS DEM ZUSTAND, nicht aus der Vorlage: dort steht das
   * Angebot, wie es beim letzten Zeichnen war. Tippen und Eingabetaste ohne
   * Zeichnen dazwischen schickten sonst das ALTE Wort — der Zeuge dafuer hat
   * genau das beim ersten Lauf gefunden.
   */
  suchen(kennung: string): void {
    void this.angebotHolen(kennung, this.angebote()[kennung]?.wort ?? '')
  }

  wortSetzen(kennung: string, wort: string): void {
    const a = this.angebote()[kennung]
    if (a) this.angebotSetzen(kennung, { ...a, wort })
  }

  schonDa(w: AngebotWerk): boolean {
    return this.vorhanden.includes(w.vorschlag.id)
  }

  async aufnehmen(kennung: string, w: AngebotWerk): Promise<void> {
    if (this.nimmt()) return
    this.nimmt.set(kennung + '/' + w.kennung)
    try {
      await firstValueFrom(this.http.post('/api/medien', w.vorschlag))
      this.aufgenommen.emit()
    } catch {
      const a = this.angebote()[kennung]
      if (a) this.angebotSetzen(kennung, { ...a, fehler: w.titel + ' ließ sich nicht aufnehmen.' })
    } finally {
      this.nimmt.set('')
    }
  }

  private angebotSetzen(kennung: string, a: AngebotStand): void {
    this.angebote.update((m) => ({ ...m, [kennung]: a }))
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
