/**
 * Die Plugin-Liste — welche Erweiterungen es gibt und wie es ihnen geht.
 *
 * WOFÜR: Ein Plugin, dessen Adresse oder Zugangsschlüssel man per `curl`
 * eintragen muss, benutzt niemand. Bis zu dieser Seite war genau das der Weg.
 *
 * SIE IST SEIT DEM 14.08.2026 NUR NOCH EINE LISTE. Vorher standen hier alle
 * Erweiterungen mit allen Feldern untereinander — das liest sich bei zwei noch,
 * bei fünf nicht mehr, und man sah nicht, wo man ist. Die Felder liegen jetzt
 * auf `/plugins/<kennung>` (plugin-eine.ts); hier steht, was man auf einen
 * Blick wissen will: was da ist, ob es läuft, und der Schalter dafür.
 *
 * DER SCHALTER STEHT SCHON HIER und nicht nur auf der Unterseite: „eine
 * Erweiterung stilllegen" ist die häufigste Handlung auf dieser Seite, und
 * dafür soll man nicht erst hineingehen müssen.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'

interface Stand {
  kennung: string
  name: string
  fassung: string
  rechte: string[]
  zustand: 'laedt' | 'bereit' | 'gescheitert' | 'aus'
  grund?: string
  kann: { aufloesen: boolean; suchen: boolean; befinden: boolean; ereignis: boolean }
  felder: { schluessel: string; art: string; name: string }[]
}

interface Lage {
  geladen: Stand[]
  abgewiesen: { ordner: string; maengel: string[] }[]
}

/** Was ein Recht in Worten bedeutet — „netz" allein sagt Eltern nichts. */
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
  selector: 'mupi-plugins',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Plugins</h1>
    <p class="unter">Erweiterungen bringen der Box neue Medienquellen bei oder lassen sie auf Ereignisse reagieren.</p>

    @if (fehler()) {
      <div class="karte"><b>{{ fehler() }}</b></div>
    }

    @if (lage(); as l) {
      @if (!l.geladen.length && !l.abgewiesen.length) {
        <div class="karte">
          <b>Auf dieser Box liegt noch keine Erweiterung.</b>
          <p class="hinweis">
            Plugins liegen unter <code>/home/dietpi/.mupibox/plugins/</code> — je ein Ordner
            mit <code>plugin.json</code> und der Einstiegsdatei. Nach dem Hinlegen muss der
            Dienst einmal neu starten.
          </p>
        </div>
      }

      @for (p of l.geladen; track p.kennung) {
        <div class="karte reihe" [class.schlaeft]="p.zustand === 'aus'">
          <label class="schalter" [title]="p.zustand === 'aus' ? 'Einschalten' : 'Abschalten'">
            <input type="checkbox" [checked]="p.zustand !== 'aus'" [disabled]="werkelt() === p.kennung"
                   (change)="umschalten(p.kennung, $any($event.target).checked)" />
          </label>
          <div class="was">
            <a [routerLink]="['/plugins', p.kennung]"><b>{{ p.name }}</b></a>
            <span class="marke" [class.gut]="p.zustand === 'bereit'"
                  [class.schlecht]="p.zustand === 'gescheitert'">{{ wort(p.zustand) }}</span>
            <div class="hinweis">
              <code>{{ p.kennung }}</code> · {{ p.fassung }}
              @if (p.rechte.length) { · {{ rechteWort(p.rechte) }} }
              @if (p.felder.length) { · {{ p.felder.length }} Einstellung@if (p.felder.length !== 1) {en} }
            </div>
            <!-- DER GRUND STEHT IN DER LISTE UND NICHT ERST AUF DER UNTERSEITE:
                 ein Plugin, das nicht lädt, ist der einzige Fall, in dem hier
                 überhaupt etwas zu tun ist. -->
            @if (p.zustand === 'gescheitert') {
              <p class="fehlgrund">{{ p.grund || 'Ohne gemeldeten Grund.' }}</p>
            }
          </div>
          <a class="hin" [routerLink]="['/plugins', p.kennung]">Einstellen ›</a>
        </div>
      }

      <!-- ABGEWIESENE ZUM SCHLUSS UND NICHT WEG. Ein Plugin, das gar nicht
           erst geladen wurde, ist sonst unsichtbar: Es steht in keiner Liste,
           und im Journal sucht niemand. -->
      @if (l.abgewiesen.length) {
        <div class="karte">
          <h2>Nicht geladen</h2>
          @for (a of l.abgewiesen; track a.ordner) {
            <p><b>{{ a.ordner }}</b></p>
            <ul>@for (m of a.maengel; track m) { <li>{{ m }}</li> }</ul>
          }
        </div>
      }
    } @else if (!fehler()) {
      <p class="hinweis">Wird geladen …</p>
    }
  `,
  styles: `
    .reihe { display: flex; gap: 1em; align-items: flex-start }
    .reihe .was { flex: 1 }
    .reihe .hin { white-space: nowrap; align-self: center }
    /* ABGESCHALTETE BLEIBEN LESBAR, nur ruhiger — ausgegraut bis zur
       Unlesbarkeit wäre eine Strafe für eine Einstellung, die man selbst
       gewählt hat. */
    .schlaeft { opacity: .62 }
    .marke { font-size: .75em; padding: .15em .5em; border-radius: 1em;
             background: var(--rand, #8884); margin-left: .5em; }
    .marke.gut { background: #2a7a3a; color: #fff }
    .marke.schlecht { background: #8a2a2a; color: #fff }
    .fehlgrund { background: #8a2a2a22; border-left: 3px solid #8a2a2a; padding: .4em .6em;
                 margin-top: .5em; white-space: pre-wrap; overflow-wrap: anywhere }
  `,
})
export class PluginsSeite {
  private http = inject(HttpClient)

  lage = signal<Lage | null>(null)
  fehler = signal('')
  /** Welche Kennung gerade umgeschaltet wird — sperrt genau deren Schalter. */
  werkelt = signal('')

  constructor() {
    void this.holen()
  }

  wort(z: string): string {
    return ZUSTAND_WORT[z] ?? z
  }

  rechteWort(rechte: string[]): string {
    return rechte.map((r) => RECHT_WORT[r] ?? r).join(' · ')
  }

  async holen(): Promise<void> {
    try {
      this.lage.set(await firstValueFrom(this.http.get<Lage>('/api/plugins')))
      this.fehler.set('')
    } catch {
      this.fehler.set('Die Liste der Erweiterungen ist gerade nicht zu erreichen.')
    }
  }

  async umschalten(kennung: string, an: boolean): Promise<void> {
    this.werkelt.set(kennung)
    try {
      await firstValueFrom(this.http.put(`/api/plugins/${kennung}/aktiv`, { an }))
      // NEU LESEN UND NICHT RATEN: beim Einschalten steht einen Moment „lädt",
      // und ob es danach wirklich bereit ist, weiß nur der Server.
      await this.holen()
    } catch {
      this.fehler.set(`„${kennung}" ließ sich nicht umschalten.`)
    } finally {
      this.werkelt.set('')
    }
  }
}
