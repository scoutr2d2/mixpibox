/**
 * Die Protokoll-Seite.
 *
 * Der Zweck ist eng: herausfinden, warum etwas nicht geht. Deshalb steht das
 * ENDE oben im Blick (dort steht das Neueste), Fehlerzeilen sind farbig, und
 * es gibt einen Filter „nur Fehler und Warnungen" — bei tausend Zeilen ist das
 * der Unterschied zwischen Suchen und Finden.
 *
 * Protokolle, die es (noch) nicht gibt, werden ausgegraut GEZEIGT statt
 * weggelassen: „server-error.log fehlt" ist eine gute Nachricht, aber nur,
 * wenn man sieht, dass danach überhaupt gesucht wurde.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

interface Eintrag {
  id: string
  titel: string
  hinweis: string
  groesse: number
  da: boolean
}
interface Zeile {
  text: string
  stufe: 'fehler' | 'warnung' | 'info'
}
interface Inhalt {
  titel: string
  groesse?: number
  gekuerzt?: boolean
  zeilen: Zeile[]
}

@Component({
  selector: 'mupi-protokolle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.3rem; font-size: 0.94rem; }
    .waehler { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .waehler button {
      background: var(--flaeche); border: 1px solid var(--rand); color: var(--schrift);
      padding: 0.5rem 0.85rem; font-size: 0.9rem;
    }
    .waehler button.hier { background: var(--leit); border-color: var(--leit); color: #fff; }
    .waehler button:disabled { opacity: 0.4; }
    .werkzeuge { display: flex; gap: 0.8rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.7rem; }
    .werkzeuge label { font-size: 0.88rem; color: var(--gedaempft); display: inline-flex; gap: 0.35rem; align-items: center; }
    pre {
      background: #0d0d0f; border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.9rem 1rem; margin: 0; overflow-x: auto;
      font-family: ui-monospace, monospace; font-size: 0.82rem; line-height: 1.5;
      max-height: 60vh; overflow-y: auto;
    }
    pre div { white-space: pre; }
    pre div.fehler { color: var(--fehler); }
    pre div.warnung { color: var(--warn); }
    .klein { color: var(--gedaempft); font-size: 0.85rem; }
    .gruppe { font-size: 0.8rem; color: var(--gedaempft); text-transform: uppercase;
              letter-spacing: 0.04em; margin: 0.2rem 0 0.4rem; width: 100%; }
  `,
  template: `
    <h1>Protokolle</h1>
    <p class="unter">Das Neueste steht unten. Bei einer Störung ist das hier die erste Anlaufstelle.</p>

    <div class="waehler">
      <div class="gruppe">Dateien</div>
      @for (e of dateien(); track e.id) {
        <button
          type="button"
          [class.hier]="gewaehlt() === 'datei:' + e.id"
          [disabled]="!e.da"
          [title]="e.da ? e.hinweis : 'Diese Datei gibt es (noch) nicht.'"
          (click)="waehle('datei:' + e.id)"
        >
          {{ e.titel }}
        </button>
      }
    </div>

    @if (dienste().length > 0) {
      <div class="waehler">
        <div class="gruppe">Dienste (Journal)</div>
        @for (d of dienste(); track d) {
          <button
            type="button"
            [class.hier]="gewaehlt() === 'dienst:' + d"
            (click)="waehle('dienst:' + d)"
          >
            {{ d.replace('.service', '') }}
          </button>
        }
      </div>
    }

    <div class="werkzeuge">
      <label>
        <input type="checkbox" [checked]="nurAuffaellige()" (change)="umschalten()" />
        Nur Fehler und Warnungen
      </label>
      <button type="button" class="still" [disabled]="laedt() || !gewaehlt()" (click)="neuLaden()">
        {{ laedt() ? 'Lädt…' : 'Neu laden' }}
      </button>
      @if (inhalt(); as i) {
        <span class="klein">
          {{ sichtbare().length }} von {{ i.zeilen.length }} Zeilen@if (i.gekuerzt) { · gekürzt }
        </span>
      }
    </div>

    @if (!gewaehlt()) {
      <p class="klein">Wähle oben ein Protokoll.</p>
    } @else if (laedt()) {
      <p class="klein">Einen Moment…</p>
    } @else if (fehler(); as f) {
      <p class="klein">{{ f }}</p>
    } @else if (sichtbare().length === 0) {
      <p class="klein">
        {{ nurAuffaellige() ? 'Keine Fehler oder Warnungen — das ist die gute Nachricht.' : 'Das Protokoll ist leer.' }}
      </p>
    } @else {
      <pre>@for (z of sichtbare(); track $index) {<div [class]="z.stufe">{{ z.text }}</div>}</pre>
    }
  `,
})
export class ProtokolleSeite {
  private readonly http = inject(HttpClient)

  readonly dateien = signal<Eintrag[]>([])
  readonly dienste = signal<string[]>([])
  readonly gewaehlt = signal('')
  readonly inhalt = signal<Inhalt | null>(null)
  readonly laedt = signal(false)
  readonly fehler = signal('')
  readonly nurAuffaellige = signal(false)

  readonly sichtbare = computed(() => {
    const z = this.inhalt()?.zeilen ?? []
    return this.nurAuffaellige() ? z.filter((x) => x.stufe !== 'info') : z
  })

  constructor() {
    void this.liste()
  }

  private async liste(): Promise<void> {
    try {
      const a = await firstValueFrom(
        this.http.get<{ dateien: Eintrag[]; dienste: string[] }>('/api/protokolle'),
      )
      this.dateien.set(a.dateien)
      this.dienste.set(a.dienste)
      // Gleich das erste vorhandene öffnen — ein leerer Bildschirm nach dem
      // Klick auf „Protokolle" hilft niemandem.
      const erstes = a.dateien.find((d) => d.da)
      if (erstes) void this.waehle(`datei:${erstes.id}`)
    } catch {
      this.fehler.set('Die Liste der Protokolle ließ sich nicht laden.')
    }
  }

  umschalten(): void {
    this.nurAuffaellige.set(!this.nurAuffaellige())
  }

  neuLaden(): void {
    if (this.gewaehlt()) void this.waehle(this.gewaehlt())
  }

  async waehle(schluessel: string): Promise<void> {
    this.gewaehlt.set(schluessel)
    this.laedt.set(true)
    this.fehler.set('')
    const [art, ...rest] = schluessel.split(':')
    const name = rest.join(':')
    const weg =
      art === 'dienst'
        ? `/api/protokolle/dienst/${encodeURIComponent(name)}`
        : `/api/protokolle/datei/${encodeURIComponent(name)}`
    try {
      this.inhalt.set(await firstValueFrom(this.http.get<Inhalt>(`${weg}?zeilen=500`)))
    } catch {
      this.inhalt.set(null)
      this.fehler.set('Dieses Protokoll ließ sich nicht lesen.')
    } finally {
      this.laedt.set(false)
    }
  }
}
