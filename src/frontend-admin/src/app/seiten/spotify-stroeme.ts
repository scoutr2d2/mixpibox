/**
 * DIE STROEME DER BOX (E72) — die Flaeche zum Modell.
 *
 * `stroeme.ts` fuehrt seit dem 20.08.2026 nummerierte Stroeme: jeder mit
 * eigenem Spotify-Zugang und eigenem Tonziel, damit zwei Kinder gleichzeitig
 * Verschiedenes hoeren koennen. Die Box hat davon zwei — und die standen
 * bisher NUR in der Konfigurationsdatei (Betreiber, 21.08.2026: „wir haben 2
 * soloist instanzen … das muss noch vertreten werden in den spotify bereich").
 *
 * ══ WARUM DAS EINE EIGENE FLAECHE BRAUCHT ══════════════════════════════════
 *
 * Der zweite Strom ist von Hand in die Konfiguration geschrieben worden. Damit
 * war er unsichtbar: wer in der Verwaltung nachsah, fand EINEN Spotify-Zugang
 * und die Engine-Wahl — die Box spielte aber schon mit zweien. Eine Box, die
 * mehr tut, als ihre Verwaltung zeigt, ist die Vorstufe zu jedem spaeteren
 * „warum hoert die Musik mitten im Stueck auf".
 *
 * ══ DIE REGEL, DIE HIER SICHTBAR WIRD ══════════════════════════════════════
 *
 * ZWEI STROEME DUERFEN SICH KEINEN ZUGANG TEILEN. Ein Spotify-Konto spielt
 * genau EINEN Strom; startet ein zweiter mit demselben Schluessel, nimmt er
 * dem ersten die Wiedergabe weg — fuer das Kind hoert die Musik einfach auf.
 * `pruefen()` rechnet das im Server aus, diese Karte zeigt es an. GEMELDET,
 * NICHT VERBOTEN: gespeichert wird trotzdem, sonst laesst sich ein halb
 * eingerichteter Zustand nie zu Ende einrichten.
 *
 * ══ DER SCHLUESSEL KOMMT NIE ZURUECK ═══════════════════════════════════════
 *
 * Der Server schickt statt des Schluessels zwei Aussagen: OB einer da ist und
 * ob er die FORM hat. Die Form ist die wichtigere — am 20.08. stand eine Weile
 * der Platzhalter `SPAK_HIER_EINSETZEN` als zweiter Schluessel, verschieden vom
 * ersten, also haette jede Gleichheitspruefung „zwei Konten" gemeldet. Erst die
 * Laenge verriet es.
 *
 * Beim Speichern heisst ein leeres Feld deshalb UNVERAENDERT, nicht „loeschen"
 * — die Oberflaeche kennt die Schluessel ja gar nicht.
 *
 * KEINE BACKTICKS in Vorlage und Kommentaren ([[backticks-in-angular-vorlagen]]).
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

interface StromAussen {
  nr: number
  zweck: 'wiedergabe' | 'mitschnitt'
  maschine: 'soloist' | 'librespot'
  senke: string
  /** So heisst er in der Geraeteliste von Spotify. */
  name: string
  schluesselGesetzt: boolean
  /** `null` = keiner gesetzt, `false` = gesetzt, aber keine spak_-Form. */
  schluesselForm: boolean | null
  /** Wo dieser Strom seine Anmeldung ablegt. */
  datenOrdner: string
  /** Angemeldete Spotify-Konten. `null` = konnte nicht nachsehen, NICHT „keines". */
  konten: number | null
  klang: { wort: string; waehlbar: boolean }
}

interface Befund {
  nr: number[]
  was: string
  schwer: boolean
}

interface StroemeStand {
  stroeme: StromAussen[]
  befunde: Befund[]
}

interface Ausgang {
  name: string
  wort: string
  art: 'bluetooth' | 'box' | 'anders'
}

/** Eine Zeile im Entwurf: der Strom plus das, was nur die Oberflaeche weiss. */
interface Zeile extends StromAussen {
  neuerSchluessel: string
  ersetzen: boolean
}

@Component({
  selector: 'mupi-spotify-stroeme',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .stroeme { display: grid; gap: 0.6rem; }
    .strom {
      border: 1px solid var(--rand); border-radius: 10px;
      padding: 0.7rem 0.85rem; display: grid; gap: 0.5rem;
    }
    .strom.schwer { border-color: var(--fehler); }
    .kopf { display: flex; gap: 0.6rem; align-items: baseline; flex-wrap: wrap; }
    .geraet { font-weight: 600; }
    .nr { color: var(--gedaempft); font-size: 0.8rem; }
    .marken { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
    .marke {
      font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 999px;
      border: 1px solid var(--rand); color: var(--gedaempft);
    }
    .marke.gut { color: var(--gut); border-color: var(--gut); }
    .marke.fehlt { color: var(--fehler); border-color: var(--fehler); }
    .marke.unklar { color: var(--warn); border-color: var(--warn); }
    .felder { display: flex; gap: 0.8rem; flex-wrap: wrap; align-items: flex-end; }
    .feld { display: grid; gap: 0.2rem; }
    .feld > label { font-size: 0.78rem; color: var(--gedaempft); }
    select, input[type='password'] {
      font: inherit; padding: 0.4rem 0.5rem; border-radius: 8px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
    }
    input[type='password'] { width: 15rem; }
    .zugang { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; font-size: 0.85rem; }
    .gut { color: var(--gut); }
    .fehlt { color: var(--fehler); }
    .befund {
      border-left: 3px solid var(--warn); padding: 0.35rem 0 0.35rem 0.6rem;
      font-size: 0.86rem; color: var(--gedaempft);
    }
    .befund.schwer { border-left-color: var(--fehler); color: var(--fehler); }
    .fuss { display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap; margin-top: 0.2rem; }
    /* ZWEI NEBENSTILE AUS DEM HAUS (bluetooth.ts, sicherung.ts). Ohne sie
       traegt jeder Knopf hier dieselbe volle Farbe — und „Diesen Strom
       entfernen" sah damit genauso wichtig aus wie „Speichern". Ein Knopf,
       der etwas wegwirft, darf nicht die kraeftigste Flaeche der Karte sein. */
    button.leise {
      font: inherit; font-size: 0.85em;
      background: transparent; color: var(--leit); border: 1px solid var(--rand);
    }
    button.gefahr {
      font: inherit; font-size: 0.85em;
      background: transparent; border: 1px solid var(--fehler); color: var(--fehler);
    }
    .klein { color: var(--gedaempft); font-size: 0.85rem; margin: 0; }
    .meldung.fehler { color: var(--fehler); font-size: 0.9rem; }
    .meldung.gut { color: var(--gut); font-size: 0.9rem; }
  `,
  template: `
    @if (zeilen().length > 0) {
      <div class="stroeme">
        @for (z of zeilen(); track z.nr) {
          <div class="strom" [class.schwer]="hatSchweren(z.nr)">
            <div class="kopf">
              <span class="geraet">{{ z.name }}</span>
              <span class="nr">so heißt er in der Spotify-Geräteliste</span>
            </div>

            <!-- KOPPLUNG UND KLANG, je Strom (21.08.2026). Betreiber: „wie
                 verhindert man das man stetig neu koppeln muss?" — am Geraet
                 gemessen ging nichts verloren (NRestarts=0, beide Ordner
                 trugen ihre Konten). Der Eindruck kommt daher, dass JEDER
                 Strom seine eigene Anmeldung hat: wer in der App „die Box"
                 waehlt, koppelt immer nur EINEN. Sichtbar gemacht ist das
                 halb behoben; wer sieht, was gekoppelt ist, koppelt nicht
                 blind nach. -->
            <div class="marken">
              @if (z.konten === null) {
                <span class="marke unklar" title="Der Ordner war nicht lesbar">Kopplung nicht nachsehbar</span>
              } @else if (z.konten === 0) {
                <span class="marke fehlt">nicht gekoppelt</span>
              } @else {
                <span class="marke gut">gekoppelt · {{ z.konten }} {{ z.konten === 1 ? 'Konto' : 'Konten' }}</span>
              }
              <span class="marke">{{ z.klang.wort }}</span>
              @if (!z.klang.waehlbar) {
                <span class="nr">nicht umschaltbar</span>
              }
            </div>

            @if (z.konten === 0) {
              <p class="befund">
                Dieser Strom ist noch nicht angemeldet. In der Spotify-App etwas abspielen, das
                Geräte-Symbol antippen und „{{ z.name }}" wählen — einmal, dann merkt er es sich.
              </p>
            }

            <div class="felder">
              <div class="feld">
                <label [attr.for]="'zweck' + z.nr">Wofür</label>
                <select
                  [id]="'zweck' + z.nr"
                  [value]="z.zweck"
                  (change)="setzen(z.nr, 'zweck', wert($event))"
                >
                  <option value="wiedergabe">Wiedergabe — ein Kind hört</option>
                  <option value="mitschnitt">Mitschnitt — nimmt still auf</option>
                </select>
              </div>

              <div class="feld">
                <label [attr.for]="'maschine' + z.nr">Client</label>
                <select
                  [id]="'maschine' + z.nr"
                  [value]="z.maschine"
                  (change)="setzen(z.nr, 'maschine', wert($event))"
                >
                  <option value="soloist">Soloist — braucht einen Schlüssel</option>
                  <option value="librespot">librespot — meldet sich selbst an</option>
                </select>
              </div>

              <div class="feld">
                <label [attr.for]="'senke' + z.nr">Ton geht nach</label>
                <!-- [selected] AN DER OPTION, nicht nur [value] am Feld. Das
                     Auswahlfeld bekommt seinen Wert, BEVOR die Optionen aus
                     dem @for im Baum stehen — die Zuweisung findet dann nichts
                     und faellt still auf den ersten Eintrag zurueck. Am
                     21.08.2026 zeigte Strom 2 deshalb „der Standard-Ausgabe
                     folgen", obwohl mixpi-mitschnitt eingetragen war: das Feld
                     hatte die richtige Option und die falsche Anzeige. Die
                     festen Felder darueber (Wofuer, Client) sind nicht
                     betroffen — ihre Optionen stehen fest in der Vorlage. -->
                <select [id]="'senke' + z.nr" [value]="z.senke" (change)="setzen(z.nr, 'senke', wert($event))">
                  <option value="" [selected]="!z.senke">der Standard-Ausgabe folgen</option>
                  @for (a of ausgaengeFuer(z.senke); track a.name) {
                    <option [value]="a.name" [selected]="a.name === z.senke">{{ a.wort }}</option>
                  }
                </select>
              </div>
            </div>

            <!-- DER ZUGANG. Bei librespot ist ein fehlender Schluessel KEIN
                 Mangel — er meldet sich per Zeroconf an und benutzt ihn nie.
                 Deshalb steht hier nicht stumpf „fehlt", sondern was es fuer
                 DIESEN Client bedeutet. -->
            <div class="zugang">
              <span>Zugang:</span>
              @if (z.maschine === 'librespot') {
                <span class="klein">braucht keinen Schlüssel</span>
              } @else if (z.schluesselForm === true) {
                <strong class="gut">hinterlegt</strong>
              } @else if (z.schluesselForm === false) {
                <strong class="fehlt">hinterlegt, aber keine spak_-Form</strong>
              } @else {
                <strong class="fehlt">fehlt</strong>
              }
              @if (z.neuerSchluessel.trim()) {
                <span class="klein">— wird beim Speichern ersetzt</span>
              }
              @if (!z.ersetzen) {
                <button type="button" class="leise" (click)="ersetzenZeigen(z.nr)">
                  {{ z.schluesselGesetzt ? 'Ersetzen…' : 'Eintragen…' }}
                </button>
              }
            </div>

            @if (z.ersetzen) {
              <input
                type="password"
                placeholder="spak_…"
                autocomplete="off"
                [value]="z.neuerSchluessel"
                (input)="setzen(z.nr, 'neuerSchluessel', wert($event))"
              />
            }

            @for (b of befundeFuer(z.nr); track b.was) {
              <p class="befund" [class.schwer]="b.schwer">{{ b.was }}</p>
            }

            @if (zeilen().length > 1) {
              <div class="fuss">
                <button type="button" class="gefahr" (click)="entfernen(z.nr)">Diesen Strom entfernen</button>
                <span class="klein">Der hinterlegte Schlüssel geht dabei verloren.</span>
              </div>
            }
          </div>
        }
      </div>

      <div class="fuss">
        <button type="button" [disabled]="beschaeftigt() || !geaendert()" (click)="speichern()">
          {{ beschaeftigt() ? 'Speichert…' : 'Ströme speichern' }}
        </button>
        <!-- DIE GRENZE STEHT AM KNOPF, nicht in einer Hilfe (Betreiber,
             21.08.2026: „bis zu 5 ströme … es gibt ja im family account 5").
             Sie folgt aus der Regel, dass zwei Stroeme sich kein Konto teilen
             duerfen: so viele eigene Konten gibt der Tarif her. Der Knopf
             verschwindet nicht, er sagt warum — ein Knopf, der wortlos fehlt,
             sieht aus wie ein Fehler der Seite. -->
        @if (zeilen().length < hoechstens) {
          <button type="button" class="leise" (click)="hinzufuegen()">Strom hinzufügen</button>
        } @else {
          <span class="klein">
            {{ hoechstens }} Ströme — mehr eigene Spotify-Konten gibt der Familientarif nicht her.
          </span>
        }
        @if (geaendert()) {
          <span class="klein">Nicht gespeichert.</span>
        }
      </div>

      @if (fehler()) {
        <p class="meldung fehler">{{ fehler() }}</p>
      }
      @if (getan()) {
        <p class="meldung gut">{{ getan() }}</p>
      }
    } @else {
      <p class="klein">Die Ströme lassen sich gerade nicht lesen.</p>
    }
  `,
})
export class SpotifyStroeme implements OnInit {
  private readonly http = inject(HttpClient)

  /**
   * Die Hoechstzahl — DOPPELT, und das ist hier vertretbar.
   *
   * Der Server rechnet sie in `stroeme.ts` (STROEME_HOECHSTENS) und meldet das
   * Ueberschreiten als Befund; das ist die Wahrheit. Diese Zahl hier verhindert
   * nur, dass die Oberflaeche einen sechsten Strom ANBIETET, den sie im selben
   * Atemzug rot anstreichen muesste. Laufen sie auseinander, gewinnt der
   * Server: er meldet weiter, die Oberflaeche bietet nur weniger an.
   */
  readonly hoechstens = 5

  readonly zeilen = signal<Zeile[]>([])
  readonly befunde = signal<Befund[]>([])
  readonly ausgaenge = signal<Ausgang[]>([])
  readonly beschaeftigt = signal(false)
  readonly fehler = signal('')
  readonly getan = signal('')

  /** Der Stand, wie er beim Laden kam — als Vergleich fuer „geaendert". */
  private gelesen = ''

  readonly geaendert = computed(() => JSON.stringify(this.zumSchicken()) !== this.gelesen)

  async ngOnInit(): Promise<void> {
    await Promise.all([this.laden(), this.ausgaengeLaden()])
  }

  wert(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value
  }

  befundeFuer(nr: number): Befund[] {
    return this.befunde().filter((b) => b.nr.includes(nr))
  }

  hatSchweren(nr: number): boolean {
    return this.befundeFuer(nr).some((b) => b.schwer)
  }

  /**
   * Die Auswahl fuer EINEN Strom.
   *
   * DER GERADE EINGETRAGENE AUSGANG BLEIBT DRIN, auch wenn `pactl` ihn nicht
   * meldet. Sonst faellt eine ausgeschaltete Bluetooth-Box aus der Liste, die
   * Auswahl springt stumm auf „Standard" — und das naechste Speichern schreibt
   * diese Aenderung fest, ohne dass jemand sie getroffen hat.
   */
  ausgaengeFuer(senke: string): Ausgang[] {
    const alle = this.ausgaenge()
    if (!senke || alle.some((a) => a.name === senke)) return alle
    return [...alle, { name: senke, wort: senke + ' (gerade nicht da)', art: 'anders' }]
  }

  ersetzenZeigen(nr: number): void {
    this.zeilen.update((zs) => zs.map((z) => (z.nr === nr ? { ...z, ersetzen: true } : z)))
  }

  setzen(nr: number, feld: 'zweck' | 'maschine' | 'senke' | 'neuerSchluessel', wert: string): void {
    this.zeilen.update((zs) => zs.map((z) => (z.nr === nr ? { ...z, [feld]: wert } : z)))
  }

  hinzufuegen(): void {
    this.zeilen.update((zs) => {
      const nr = zs.reduce((h, z) => Math.max(h, z.nr), 0) + 1
      return [
        ...zs,
        {
          nr,
          zweck: 'wiedergabe',
          maschine: 'soloist',
          senke: '',
          // DEN NAMEN VERGIBT DER SERVER (`<Boxname> Stream n`). Hier steht
          // nur ein Platzhalter bis zum ersten Speichern — er selbst zu raten
          // hiesse, den Boxnamen in der Oberflaeche zu verdoppeln.
          name: 'Stream ' + nr,
          schluesselGesetzt: false,
          schluesselForm: null,
          // NOCH NICHT NACHGESEHEN, nicht „nichts gefunden": den Ordner gibt
          // es erst nach dem Speichern. `0` hiesse „nicht gekoppelt" und
          // forderte zu einer Anmeldung auf, die noch gar nicht gehen kann.
          datenOrdner: '',
          konten: null,
          klang: { wort: 'verlustfrei', waehlbar: false },
          neuerSchluessel: '',
          ersetzen: true,
        },
      ]
    })
  }

  entfernen(nr: number): void {
    this.zeilen.update((zs) => zs.filter((z) => z.nr !== nr))
  }

  private zumSchicken(): unknown[] {
    return this.zeilen().map((z) => ({
      nr: z.nr,
      zweck: z.zweck,
      maschine: z.maschine,
      senke: z.senke,
      schluessel: z.neuerSchluessel.trim(),
    }))
  }

  private uebernehmen(stand: StroemeStand): void {
    this.zeilen.set(stand.stroeme.map((s) => ({ ...s, neuerSchluessel: '', ersetzen: false })))
    this.befunde.set(stand.befunde ?? [])
    this.gelesen = JSON.stringify(this.zumSchicken())
  }

  async laden(): Promise<void> {
    try {
      this.uebernehmen(await firstValueFrom(this.http.get<StroemeStand>('/api/stroeme')))
    } catch {
      this.zeilen.set([])
      this.befunde.set([])
    }
  }

  private async ausgaengeLaden(): Promise<void> {
    try {
      const a = await firstValueFrom(this.http.get<{ ausgaenge: Ausgang[] }>('/api/ton/ausgaenge'))
      this.ausgaenge.set(a.ausgaenge ?? [])
    } catch {
      // Ohne Liste bleibt die Auswahl bei „Standard" plus dem, was eingetragen
      // ist — schmaler, aber nicht falsch.
      this.ausgaenge.set([])
    }
  }

  async speichern(): Promise<void> {
    if (this.beschaeftigt()) return
    this.beschaeftigt.set(true)
    this.fehler.set('')
    this.getan.set('')
    try {
      const antwort = await firstValueFrom(
        this.http.put<StroemeStand & { ok: boolean }>('/api/stroeme', { stroeme: this.zumSchicken() }),
      )
      this.uebernehmen(antwort)
      // DIE BEFUNDE STEHEN AUCH IM ERFOLGSFALL. Gespeichert und in Ordnung
      // sind zwei verschiedene Aussagen; die Karte darf die zweite nicht
      // verschlucken, nur weil die erste geklappt hat.
      const schwer = (antwort.befunde ?? []).filter((b) => b.schwer).length
      this.getan.set(schwer > 0 ? 'Gespeichert — es steht aber noch etwas an (siehe oben).' : 'Gespeichert.')
    } catch (f: unknown) {
      const grund = (f as { error?: { error?: string } })?.error?.error
      this.fehler.set(grund || 'Speichern fehlgeschlagen — es bleibt beim bisherigen Stand.')
    } finally {
      this.beschaeftigt.set(false)
    }
  }
}
