/**
 * Die Anmeldeseite — der erste Baustein der neuen Verwaltungsoberflaeche.
 *
 * Sie ist absichtlich der Einstieg: sie prueft die frisch gebaute API-Tuer
 * (auth.ts) von Anfang bis Ende und ist klein genug, um sie ganz zu verstehen.
 *
 * Zwei Faelle, die man leicht uebersieht und die hier ausdruecklich behandelt
 * sind, weil sie sonst als "kaputt" erlebt werden:
 *
 *  1. ANMELDUNG IST AUS. Dann darf hier keine Passwortfrage stehen, sondern der
 *     Weg muss direkt weitergehen — mit einem Hinweis, dass die Box offen ist.
 *  2. AUFRUF VON DER BOX SELBST. Das Backend laesst die Rueckschleife immer
 *     durch; die Seite schickt dann sofort weiter, statt nach einem Passwort zu
 *     fragen, das gar nicht geprueft wuerde.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { AnmeldeDienst } from '../anmeldung.dienst'

@Component({
  selector: 'mupi-anmeldung',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .mitte { min-height: 100dvh; display: grid; place-items: center; padding: 1.5rem; }
    .karte {
      width: min(26rem, 100%); background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 16px; padding: 1.75rem;
    }
    h1 { margin: 0 0 0.25rem; font-size: 1.35rem; }
    p.unter { margin: 0 0 1.5rem; color: var(--gedaempft); font-size: 0.92rem; }
    label { display: block; margin-bottom: 0.45rem; font-size: 0.9rem; color: var(--gedaempft); }
    .knopfreihe { margin-top: 1.1rem; display: flex; gap: 0.6rem; }
    .knopfreihe button { flex: 1; }
    .meldung { margin-top: 1rem; padding: 0.7rem 0.85rem; border-radius: 10px; font-size: 0.9rem; }
    .meldung.fehler { background: color-mix(in srgb, var(--fehler) 18%, transparent); color: var(--fehler); }
    .meldung.hinweis { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
  `,
  template: `
    <div class="mitte">
      <div class="karte">
        <h1>MixPiBox</h1>
        <p class="unter">Verwaltung</p>

        @if (offen()) {
          <div class="meldung hinweis">
            Diese Box ist ohne Passwort erreichbar. Du kannst die Anmeldung
            spaeter in den Einstellungen einschalten.
          </div>
          <div class="knopfreihe">
            <button type="button" (click)="weiter()">Weiter zur Verwaltung</button>
          </div>
        } @else {
          <form (ngSubmit)="absenden()">
            <label for="pw">Passwort</label>
            <input
              id="pw"
              name="pw"
              type="password"
              autocomplete="current-password"
              [(ngModel)]="passwort"
              [disabled]="laeuft()"
              autofocus
            />
            <div class="knopfreihe">
              <button type="submit" [disabled]="laeuft() || !passwort">
                {{ laeuft() ? 'Einen Moment…' : 'Anmelden' }}
              </button>
            </div>
          </form>

          @if (fehler(); as f) {
            <div class="meldung fehler">{{ f }}</div>
          }
        }
      </div>
    </div>
  `,
})
export class AnmeldeSeite {
  private readonly dienst = inject(AnmeldeDienst)
  private readonly router = inject(Router)

  passwort = ''
  readonly laeuft = signal(false)
  readonly fehler = signal('')
  /** Box ohne eingeschaltete Anmeldung: Passwortfrage waere sinnlos. */
  readonly offen = signal(false)

  constructor() {
    void this.erstePruefung()
  }

  private async erstePruefung(): Promise<void> {
    const lage = await this.dienst.pruefen()
    // Schon drin (Anmeldung aus ODER Aufruf von der Box selbst): weiterschicken.
    if (lage.angemeldet) {
      void this.router.navigate(['/'])
      return
    }
    this.offen.set(!lage.anmeldungNoetig)
  }

  weiter(): void {
    void this.router.navigate(['/'])
  }

  async absenden(): Promise<void> {
    if (this.laeuft() || !this.passwort) return
    this.laeuft.set(true)
    this.fehler.set('')
    const e = await this.dienst.anmelden(this.passwort)
    this.laeuft.set(false)
    if (e.ok) {
      this.passwort = ''
      void this.router.navigate(['/'])
      return
    }
    this.fehler.set(
      e.grund === 'falsch'
        ? 'Das Passwort stimmt nicht.'
        : e.grund === 'keine-verbindung'
          ? 'Die Box antwortet nicht. Laeuft sie noch?'
          : 'Da ist etwas schiefgegangen.',
    )
  }
}
