/**
 * Die Konfigurations-Seite.
 *
 * Sie ersetzt mupi.php und den JSON-Editor. Drei Dinge macht sie anders als
 * ein Formular mit „Speichern":
 *
 * 1. Nichts wird beim Tippen gespeichert. Geändertes wird gesammelt und erst
 *    auf Knopfdruck geschrieben — mit einer Liste dessen, was sich ändert.
 * 2. Was einen Neustart braucht, steht am Feld, nicht im Kleingedruckten.
 * 3. Die Anmeldung abzuschalten ist ein eigener Fall: dabei öffnet man die
 *    Box für jeden im Netzwerk, also fragt die Seite ausdrücklich nach.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'
import { type Folge, feldFolge } from '../feld-folgen'

interface Feld {
  id: string
  art: 'text' | 'zahl' | 'schalter' | 'auswahl' | 'geheim' | 'url'
  /** Kennung des Bereichs — siehe konfiguration.ts im Backend. */
  bereich: string
  titel: string
  hinweis: string
  min?: number
  max?: number
  neustart: boolean
  /** Bei 'geheim' NICHT vorhanden — dort kommt nur `gesetzt`. */
  wert?: unknown
  gesetzt?: boolean
  auswahl: { wert: string; titel: string }[]
}

interface Bereich {
  id: string
  titel: string
  hinweis: string
  seite: 'konfiguration' | 'darstellung' | 'streaming' | 'ton'
}

/** Ein Bereich samt seiner Felder — genau so, wie die Seite ihn zeigt. */
interface Gruppe {
  bereich: Bereich
  felder: Feld[]
}

interface Aenderung {
  id: string
  titel: string
  vorher: unknown
  nachher: unknown
  neustart: boolean
}

@Component({
  selector: 'mupi-konfiguration',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.4rem; font-size: 0.94rem; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
    li {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.9rem 1rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
    }
    li.geaendert { border-color: var(--leit); }
    .wer { flex: 1 1 18rem; min-width: 0; }
    .titel { font-weight: 500; }
    .hinweis { color: var(--gedaempft); font-size: 0.85rem; }
    .marke { font-size: 0.72rem; color: var(--warn); text-transform: uppercase; letter-spacing: 0.04em; }
    /* DIE FOLGE EINES WERTES — bewusst NICHT dieselbe graue Kleinschrift wie
       der immergleiche Hinweis darueber. Wer die Seite ueberfliegt, muss den
       Unterschied zwischen „so ist das Feld gemeint" und „DAS passiert mit
       DEINER Zahl" sehen, ohne zu lesen. Deshalb: eigene Zeile, abgesetzt. */
    .folge {
      margin-top: 0.35rem; font-size: 0.85rem; line-height: 1.45;
      border-left: 3px solid var(--rand); padding-left: 0.6rem; color: var(--gedaempft);
    }
    .folge.warnen {
      border-left-color: var(--warn); color: var(--warn);
      background: color-mix(in srgb, var(--warn) 10%, transparent);
      padding: 0.4rem 0.6rem; border-radius: 0 8px 8px 0;
    }
    .eingabe { flex: 0 0 auto; display: flex; align-items: center; gap: 0.5rem; }
    .eingabe input[type=number] { width: 6.5rem; }
    .eingabe input[type=text] { width: 12rem; }
    select {
      font: inherit; padding: 0.5rem 0.6rem; border-radius: 8px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
    }
    .fuss {
      position: sticky; bottom: 0; margin-top: 1.2rem; padding: 0.9rem 0;
      background: linear-gradient(transparent, var(--grund) 35%);
      display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap;
    }
    .meldung { padding: 0.75rem 0.9rem; border-radius: 10px; margin-bottom: 1rem; font-size: 0.9rem; }
    .meldung.fehler { background: color-mix(in srgb, var(--fehler) 18%, transparent); color: var(--fehler); }
    .meldung.gut { background: color-mix(in srgb, var(--gut) 16%, transparent); color: var(--gut); }
    .meldung.warn { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
    .klein { color: var(--gedaempft); font-size: 0.88rem; }
    h2 { font-size: 1rem; margin: 2rem 0 0.4rem; }
    .pwzeile { display: flex; gap: 0.6rem; margin: 0.8rem 0; flex-wrap: wrap; }
    .pwzeile input { width: 16rem; }
    .gut { color: var(--gut); }
    .anmeldelink { color: var(--leit); word-break: break-all; }
  `,
  template: `
    <h1>Konfiguration</h1>
    <p class="unter">Änderungen werden gesammelt und erst beim Speichern geschrieben.</p>

    @if (fehler(); as f) {
      <div class="meldung fehler">{{ f }}</div>
    }
    @if (getan(); as g) {
      <div class="meldung gut">{{ g }}</div>
    }
    @if (warnungAnmeldung()) {
      <div class="meldung warn">
        Du bist dabei, die Anmeldung <strong>abzuschalten</strong>. Danach kann
        jeder im Netzwerk diese Verwaltung öffnen, die Box abschalten und die
        Medien ändern. Nur sinnvoll in einem Netz, dem du vollständig traust.
      </div>
    }

    @if (laedt()) {
      <p class="klein">Einen Moment…</p>
    } @else {
      <!-- GEGLIEDERT nach der Leitfrage „was IST die Box", nicht nach der
           Reihenfolge in der Datei. Die Zuordnung steht am Feld im Backend,
           damit sie nicht in drei Vorlagen doppelt gepflegt wird. -->
      @for (g of gruppen(); track g.bereich.id) {
      <h2>{{ g.bereich.titel }}</h2>
      <p class="klein">{{ g.bereich.hinweis }}</p>
      <ul>
        @for (f of g.felder; track f.id) {
          <li [class.geaendert]="istGeaendert(f.id)">
            <div class="wer">
              <div class="titel">{{ f.titel }}</div>
              <div class="hinweis">{{ f.hinweis }}</div>
              @if (f.neustart) {
                <div class="marke">wirkt nach einem Neustart</div>
              }
              <!-- WAS AUS DIESER ZAHL WIRD. Rechnet mit dem Wert, der GERADE
                   im Feld steht — auch dem noch nicht gespeicherten. Der Satz
                   soll dastehen, BEVOR jemand auf „Speichern" drueckt, nicht
                   danach. Wortlaut und Regel: feld-folgen.ts. -->
              @if (folge(f.id); as fo) {
                @if (fo.hinweis) {
                  <div class="folge" [class.warnen]="fo.schwere === 'warnen'">{{ fo.satz }}</div>
                }
              }
            </div>
            <div class="eingabe">
              @switch (f.art) {
                @case ('schalter') {
                  <input
                    type="checkbox"
                    [checked]="!!wert(f.id)"
                    [disabled]="speichert()"
                    (change)="setze(f.id, $any($event.target).checked)"
                  />
                }
                @case ('zahl') {
                  <input
                    type="number"
                    [min]="f.min ?? 0"
                    [max]="f.max ?? 999999"
                    [value]="wert(f.id)"
                    [disabled]="speichert()"
                    (change)="setze(f.id, +$any($event.target).value)"
                  />
                }
                @case ('auswahl') {
                  <select
                    [disabled]="speichert()"
                    (change)="setze(f.id, $any($event.target).value)"
                  >
                    @for (a of f.auswahl; track a.wert) {
                      <option [value]="a.wert" [selected]="a.wert === wert(f.id)">
                        {{ a.titel }}
                      </option>
                    }
                  </select>
                }
                @case ('geheim') {
                  <input
                    type="password"
                    autocomplete="off"
                    [placeholder]="f.gesetzt ? 'hinterlegt — zum Ersetzen eintippen' : 'nicht hinterlegt'"
                    [disabled]="speichert()"
                    (change)="setze(f.id, $any($event.target).value)"
                  />
                }
                @default {
                  <input
                    type="text"
                    [value]="wert(f.id)"
                    [disabled]="speichert()"
                    (change)="setze(f.id, $any($event.target).value)"
                  />
                }
              }
            </div>
          </li>
        }
      </ul>
      }

      <!-- WOHIN DIE ANBIETER GEWANDERT SIND. Spotify und Jellyfin standen bis
           2026-08-03 hier: sechs Felder ohne Ueberschrift und ein Absatz zur
           Anmeldung darunter. Sie beantworten aber nicht „was IST die Box",
           sondern „welche Quelle ist DA" — und das ist jetzt eine eigene
           Seite. Der Verweis bleibt stehen, weil man sie hier gesucht hat. -->
      <h2>Streaming-Dienste</h2>
      <p class="klein">
        Spotify, Jellyfin und was sonst noch Musik liefert, stehen jetzt auf einer
        eigenen Seite — dort zusammen mit dem, was jeder Anbieter kann und ob er
        eingerichtet ist:
        <a class="anmeldelink" routerLink="/streaming">Streaming-Dienste</a>
      </p>

      <h2>Passwort der Verwaltung</h2>
      <p class="klein">
        Ohne gesetztes Passwort lässt sich die Anmeldung oben nicht einschalten —
        man käme sonst selbst nicht mehr herein.
      </p>
      <div class="pwzeile">
        <input
          type="password"
          autocomplete="new-password"
          placeholder="Neues Passwort"
          [(ngModel)]="neuesPasswort"
          [disabled]="pwLaeuft()"
          name="neuesPasswort"
        />
        <button
          type="button"
          [disabled]="pwLaeuft() || neuesPasswort.length < 6"
          (click)="passwortSetzen()"
        >
          {{ pwLaeuft() ? 'Wird gesetzt…' : 'Passwort setzen' }}
        </button>
      </div>
      @if (pwFehler(); as f) {
        <div class="meldung fehler">{{ f }}</div>
      }
      @if (pwGetan()) {
        <div class="meldung gut">
          Passwort gesetzt. Alle offenen Anmeldungen wurden beendet.
        </div>
      }

      <h2>PIN vor den Einstellungen der Box</h2>
      <p class="klein">
        Nur nötig, wenn die Sperre oben auf „PIN“ steht. Eingetippt wird sie am
        Bildschirm der Box auf einem Ziffernfeld — deshalb sind nur Ziffern
        erlaubt, 4 bis 8 Stück. Leer lassen und setzen löscht die PIN wieder.
      </p>
      <div class="pwzeile">
        <input
          type="password"
          inputmode="numeric"
          autocomplete="off"
          placeholder="Neue PIN (4–8 Ziffern)"
          [(ngModel)]="neuePin"
          [disabled]="pinLaeuft()"
          name="neuePin"
        />
        <button type="button" [disabled]="pinLaeuft() || !pinTauglich()" (click)="pinSetzen()">
          {{ pinLaeuft() ? 'Wird gesetzt…' : 'PIN setzen' }}
        </button>
      </div>
      @if (pinFehler(); as f) {
        <div class="meldung fehler">{{ f }}</div>
      }
      @if (pinGetan()) {
        <div class="meldung gut">{{ pinGetan() }}</div>
      }

      <div class="fuss">
        <button type="button" [disabled]="anzahl() === 0 || speichert()" (click)="speichern()">
          {{ speichert() ? 'Wird gespeichert…' : 'Speichern' }}
        </button>
        <button type="button" class="still" [disabled]="anzahl() === 0 || speichert()" (click)="verwerfen()">
          Verwerfen
        </button>
        <span class="klein">
          @if (anzahl() === 0) { Nichts geändert. } @else { {{ anzahl() }} Änderung(en) offen. }
        </span>
      </div>
    }
  `,
})
export class KonfigurationSeite {
  private readonly http = inject(HttpClient)

  readonly felder = signal<Feld[]>([])
  readonly laedt = signal(true)
  readonly speichert = signal(false)
  readonly fehler = signal('')
  readonly getan = signal('')
  /** Nur die geänderten Werte — die übrigen fasst der Server nicht an. */
  readonly offen = signal<Record<string, unknown>>({})
  readonly bereiche = signal<Bereich[]>([])

  readonly anzahl = computed(() => Object.keys(this.offen()).length)

  /**
   * Die Felder DIESER Seite, nach Bereich gruppiert.
   *
   * Zwei Filter, und beide sind wichtig:
   *   1. Nur Bereiche mit `seite === 'konfiguration'`. Was man SIEHT, zeigt die
   *      Darstellungsseite; die Anbieterzugaenge zeigt „Streaming-Dienste".
   *      Dieselbe Tabelle, drei Seiten — die Zuordnung kommt vom Server.
   *   2. Leere Bereiche fallen weg. Eine Ueberschrift ohne Inhalt liest sich
   *      wie ein Ladefehler.
   */
  readonly gruppen = computed<Gruppe[]>(() => {
    const felder = this.felder()
    return this.bereiche()
      .filter((b) => b.seite === 'konfiguration')
      .map((b) => ({ bereich: b, felder: felder.filter((f) => f.bereich === b.id) }))
      .filter((g) => g.felder.length > 0)
  })

  neuesPasswort = ''
  readonly pwLaeuft = signal(false)
  readonly pwFehler = signal('')
  readonly pwGetan = signal(false)

  neuePin = ''
  readonly pinLaeuft = signal(false)
  readonly pinFehler = signal('')
  /** Text der Erfolgsmeldung — unterscheidet gesetzt von geloescht. */
  readonly pinGetan = signal('')

  /** Die Anmeldung abzuschalten öffnet die Box — das wird ausdrücklich gesagt. */
  readonly warnungAnmeldung = computed(() => this.offen()['anmeldung'] === false)

  constructor() {
    void this.laden()
  }

  private async laden(): Promise<void> {
    this.laedt.set(true)
    try {
      const a = await firstValueFrom(
        this.http.get<{ felder: Feld[]; bereiche?: Bereich[] }>('/api/konfiguration'),
      )
      this.felder.set(a.felder)
      this.bereiche.set(a.bereiche ?? [])
      this.offen.set({})
    } catch {
      this.fehler.set('Die Konfiguration ließ sich nicht laden.')
    } finally {
      this.laedt.set(false)
    }
  }

  wert(id: string): unknown {
    const o = this.offen()
    if (Object.hasOwn(o, id)) return o[id]
    const f = this.felder().find((x) => x.id === id)
    // Schalter stehen teils als "0"/"1" in der Datei — für die Anzeige
    // vereinheitlichen, gespeichert wird wieder die ursprüngliche Form.
    if (f?.art === 'schalter') return f.wert === true || f.wert === '1'
    return f?.wert ?? ''
  }

  istGeaendert(id: string): boolean {
    return Object.hasOwn(this.offen(), id)
  }

  /**
   * Was aus dem Wert wird, der gerade im Feld steht.
   *
   * ABSICHTLICH ÜBER `wert(id)` und nicht über `f.wert`: gemeint ist der
   * Zustand, den das Formular ZEIGT, samt der noch nicht gespeicherten
   * Änderung. Wer die 1 eintippt, soll die Folge lesen, solange er sie noch
   * zurücknehmen kann — hinterher sitzt er vor der Box.
   *
   * Gerechnet wird nichts: die Regeln stehen in feld-folgen.ts und die
   * geltenden Grenzen in den ausführenden Skripten. Eine zweite Rechnung hier
   * wäre eine zweite Wahrheit, und die in der Oberfläche wäre die, an der man
   * vorbeikommt.
   */
  folge(id: string): Folge {
    return feldFolge(id, this.wert(id))
  }

  setze(id: string, wert: unknown): void {
    const f = this.felder().find((x) => x.id === id)
    const urspruenglich = f?.art === 'schalter' ? f.wert === true || f.wert === '1' : f?.wert
    const o = { ...this.offen() }
    // Zurück auf den Ausgangswert heißt: keine Änderung mehr offen.
    if (wert === urspruenglich || String(wert) === String(urspruenglich)) delete o[id]
    else o[id] = wert
    this.offen.set(o)
    this.getan.set('')
  }

  verwerfen(): void {
    this.offen.set({})
    this.fehler.set('')
    this.getan.set('')
  }

  async speichern(): Promise<void> {
    if (this.speichert() || this.anzahl() === 0) return
    this.speichert.set(true)
    this.fehler.set('')
    this.getan.set('')
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; geaendert: Aenderung[]; neustartNoetig: boolean }>(
          '/api/konfiguration',
          { aenderungen: this.offen() },
        ),
      )
      const namen = a.geaendert.map((g) => g.titel).join(', ')
      this.getan.set(
        a.neustartNoetig
          ? `Gespeichert: ${namen}. Ein Teil wirkt erst nach einem Neustart der Box.`
          : `Gespeichert: ${namen}.`,
      )
      await this.laden()
    } catch (e) {
      const gemeldet = (e as { error?: { error?: string } })?.error?.error
      // Der Server nennt den Grund (z.B. „niemand käme mehr herein") — den
      // zeigen wir wörtlich, statt ihn durch ein eigenes „ungültig" zu ersetzen.
      this.fehler.set(gemeldet || 'Das Speichern ist fehlgeschlagen.')
    } finally {
      this.speichert.set(false)
    }
  }

  /**
   * Passwort setzen.
   *
   * Danach sind alle Anmeldungen beendet — auch die eigene. Das ist Absicht:
   * ein Passwortwechsel, der alte Sitzungen weiterlaufen lässt, wäre halb
   * wirkungslos. Die Seite sagt es, statt den Nutzer raten zu lassen.
   */
  async passwortSetzen(): Promise<void> {
    if (this.pwLaeuft() || this.neuesPasswort.length < 6) return
    this.pwLaeuft.set(true)
    this.pwFehler.set('')
    this.pwGetan.set(false)
    try {
      await firstValueFrom(
        this.http.post('/api/konfiguration/passwort', { passwort: this.neuesPasswort }),
      )
      this.neuesPasswort = ''
      this.pwGetan.set(true)
    } catch (e) {
      const gemeldet = (e as { error?: { error?: string } })?.error?.error
      this.pwFehler.set(gemeldet || 'Das Setzen ist fehlgeschlagen.')
    } finally {
      this.pwLaeuft.set(false)
    }
  }

  /**
   * Taugt die Eingabe als PIN?
   *
   * LEER ist ausdruecklich erlaubt — das ist der Weg, eine gesetzte PIN wieder
   * loszuwerden. Alles andere muss aus 4 bis 8 Ziffern bestehen, denn eingegeben
   * wird sie am Bildschirm der Box auf einem Ziffernfeld: eine PIN mit Buchstaben
   * liesse sich hier setzen, dort aber nie wieder eintippen.
   */
  pinTauglich(): boolean {
    const p = this.neuePin.trim()
    return p === '' || /^\d{4,8}$/.test(p)
  }

  /**
   * PIN setzen oder loeschen.
   *
   * Das Backend prueft danach die GANZE Konfiguration: steht die Sperre auf
   * „PIN" und man loescht die PIN, kommt eine 400 zurueck statt einer Box, in
   * deren Einstellungen niemand mehr hineinkaeme.
   */
  async pinSetzen(): Promise<void> {
    if (this.pinLaeuft() || !this.pinTauglich()) return
    const pin = this.neuePin.trim()
    this.pinLaeuft.set(true)
    this.pinFehler.set('')
    this.pinGetan.set('')
    try {
      await firstValueFrom(this.http.post('/api/konfiguration/einstellungs-pin', { pin }))
      this.neuePin = ''
      this.pinGetan.set(pin === '' ? 'PIN geloescht.' : 'PIN gesetzt.')
    } catch (e) {
      const gemeldet = (e as { error?: { error?: string } })?.error?.error
      this.pinFehler.set(gemeldet || 'Das Setzen ist fehlgeschlagen.')
    } finally {
      this.pinLaeuft.set(false)
    }
  }
}
