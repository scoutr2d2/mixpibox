/**
 * Die Seite „Streaming-Dienste".
 *
 * WOZU SIE DA IST. Bis zum 03.08.2026 lag die Antwort auf „welche Quellen hat
 * diese Box und welche davon antworten?" an drei Orten: zwei Jellyfin-Felder
 * und vier Spotify-Felder mitten in der Konfigurationsliste, ein Absatz zur
 * Spotify-Anmeldung darunter, und die Medienseite, die stumm nichts fand,
 * wenn etwas fehlte. Das ist die häufigste Frage beim Aufsetzen einer Box und
 * hatte keinen Ort.
 *
 * DIE LEITFRAGE, nach der hier sortiert wird (G5): Medien = was DA IST. Ein
 * Anbieter ist keine Eigenschaft der Box, sondern eine Quelle.
 *
 * WAS JE ANBIETER SICHTBAR IST — und warum genau das:
 *   KANN ER WAS      Katalog, Suche, Abspielen. Ohne diese Zeile sieht ein
 *                    „geplant" aus wie ein „kaputt".
 *   IST ER DA        bereit / unvollständig / aus / geplant, jeweils MIT
 *                    Begründung. „Unvollständig" ohne die Angabe, welche
 *                    Hälfte fehlt, kostet bei einem API-Schlüssel, den man
 *                    nicht zurücklesen kann, einen ganzen Nachmittag.
 *   SEINE FELDER     dieselben Felder wie auf der Konfigurationsseite, aus
 *                    derselben Tabelle — nur eben BEIM Anbieter.
 *
 * DIE ENTSCHEIDUNG selbst steht nicht hier, sondern in
 * src/backend-api/src/streaming.ts und ist dort getestet. Hier wird sie
 * angezeigt.
 *
 * KEINE BACKTICKS in dieser Vorlage — sie steht in einem Template-Literal
 * ([[backticks-in-angular-vorlagen]]).
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'
import { JellyfinSchnellverbindung } from './jellyfin-schnellverbindung'
import { SpotifyAssistent } from './spotify-assistent'
import { SpotifyMaschine } from './spotify-maschine'
import { MixpiPluginAbschnitt } from './mixpi-plugin-abschnitt'
import { SpotifyStroeme } from './spotify-stroeme'

interface Feld {
  id: string
  art: 'text' | 'zahl' | 'schalter' | 'auswahl' | 'geheim' | 'url'
  bereich: string
  titel: string
  hinweis: string
  neustart: boolean
  wert?: unknown
  gesetzt?: boolean
  auswahl: { wert: string; titel: string }[]
}

interface Anbieter {
  id: string
  name: string
  faehigkeiten: ('katalog' | 'suche' | 'abspielen')[]
  stand: 'bereit' | 'unvollstaendig' | 'aus' | 'abgeschaltet' | 'geplant'
  warum: string
  felder: string[]
}

/** Ein Anbieter samt der Felder, die ihn einrichten. */
interface Karte {
  anbieter: Anbieter
  felder: Feld[]
}

const STAND_TEXT: Record<Anbieter['stand'], string> = {
  bereit: 'eingerichtet',
  // E76: von Hand ausgeknipst — bewusst NICHT „nicht eingerichtet", die
  // Einrichtung ist ja noch da.
  abgeschaltet: 'abgeschaltet',
  unvollstaendig: 'unvollständig',
  aus: 'nicht eingerichtet',
  geplant: 'noch nicht gebaut',
}

const FAEHIGKEIT_TEXT: Record<string, string> = {
  katalog: 'Katalog',
  suche: 'Suche',
  abspielen: 'Abspielen',
}

@Component({
  selector: 'mupi-streaming',
  standalone: true,
  imports: [JellyfinSchnellverbindung, MixpiPluginAbschnitt, SpotifyAssistent, SpotifyMaschine, SpotifyStroeme],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.4rem; font-size: 0.94rem; }
    .karte {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 1rem 1.1rem; margin-bottom: 0.9rem;
    }
    .kopf { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
    .name { font-weight: 600; font-size: 1.05rem; }
    /* ══ DIE GRENZE, DIE GEFEHLT HAT (21.08.2026) ═══════════════════════════
     *
     * Betreiber: „irgendwie wirkt client id und lautsprecher ton als ob es
     * auch zu soloist gehoert". Zu Recht — in EINER Karte standen der
     * Assistent, die Engine-Wahl und danach ohne jede Trennung die
     * allgemeinen Felder. Wer von oben liest, ordnet sie dem letzten
     * Ueberschriftsblock zu, und das war Soloist.
     *
     * Es stand sogar ein erklaerender Satz dagegen („gilt fuer BEIDE
     * Maschinen"). EIN SATZ, DER EINE FALSCHE GRUPPIERUNG ERKLAERT, IST
     * SCHWAECHER ALS DIE RICHTIGE GRUPPIERUNG — er wird gelesen, nachdem der
     * Blick die Zuordnung schon getroffen hat. */
    .abschnitt {
      margin: 1.1rem 0 0.55rem; padding-top: 0.9rem;
      border-top: 1px solid var(--rand);
    }
    .abschnitt .was { font-weight: 600; font-size: 0.95rem; }
    .abschnitt .wofuer { display: block; color: var(--gedaempft); font-size: 0.84rem; margin-top: 0.15rem; }
    .schild {
      font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em;
      padding: 0.2rem 0.5rem; border-radius: 999px; border: 1px solid var(--rand);
      color: var(--gedaempft);
    }
    .schild.bereit { color: var(--gut); border-color: var(--gut); }
    .schild.unvollstaendig { color: var(--warn); border-color: var(--warn); }
    /* E76: abgeschaltet ist kein Fehler und kein Mangel — gedaempft, aber mit
       eigenem Rand, damit es nicht wie „noch nicht gebaut" aussieht. */
    .schild.abgeschaltet { color: var(--gedaempft); border-color: var(--gedaempft); border-style: dashed; }
    .kann { display: flex; gap: 0.35rem; flex-wrap: wrap; margin: 0.55rem 0 0; }
    .kann span {
      font-size: 0.8rem; padding: 0.15rem 0.5rem; border-radius: 6px;
      background: var(--grund); color: var(--gedaempft);
    }
    .warum { color: var(--gedaempft); font-size: 0.9rem; margin: 0.55rem 0 0; }
    ul { list-style: none; margin: 0.9rem 0 0; padding: 0; display: grid; gap: 0.5rem; }
    li {
      background: var(--grund); border: 1px solid var(--rand); border-radius: 10px;
      padding: 0.7rem 0.85rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
    }
    li.geaendert { border-color: var(--leit); }
    .wer { flex: 1 1 16rem; min-width: 0; }
    .titel { font-weight: 500; }
    .hinweis { color: var(--gedaempft); font-size: 0.85rem; }
    .marke { font-size: 0.72rem; color: var(--warn); text-transform: uppercase; letter-spacing: 0.04em; }
    .eingabe input[type=text], .eingabe input[type=password] { width: 15rem; }
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
    .klein { color: var(--gedaempft); font-size: 0.88rem; }
    .anmeldelink { color: var(--leit); word-break: break-all; }
  `,
  template: `
    <h1>Streaming-Dienste</h1>
    <p class="unter">
      Woher die Musik kommt. Je Anbieter steht hier, was er beitragen kann und ob
      er eingerichtet ist — nachgesehen wird nur in der Konfiguration, es wird
      niemand gefragt.
    </p>

    @if (fehler(); as f) {
      <div class="meldung fehler">{{ f }}</div>
    }
    @if (getan(); as g) {
      <div class="meldung gut">{{ g }}</div>
    }

    @if (laedt()) {
      <p class="klein">Einen Moment…</p>
    } @else {
      @for (k of karten(); track k.anbieter.id) {
        <div class="karte">
          <div class="kopf">
            <span class="name">{{ k.anbieter.name }}</span>
            <span class="schild" [class]="'schild ' + k.anbieter.stand">
              {{ standText(k.anbieter.stand) }}
            </span>
          </div>
          <div class="kann">
            @for (f of k.anbieter.faehigkeiten; track f) {
              <span>{{ faehigkeitText(f) }}</span>
            }
          </div>
          <p class="warum">{{ k.anbieter.warum }}</p>

          <!-- DIE STECKLEISTE (E77): Plugins, die sich fuer DIESE Karte
               angemeldet haben (Manifest-Feld sektion). Die Karte kennt kein
               einzelnes Plugin - sie fragt nur, wer sich gemeldet hat. -->
          <mixpi-plugin-abschnitt [sektion]="'streaming/' + k.anbieter.id" />

          <!-- SPOTIFY: DER EINRICHTUNGS-ASSISTENT (14.08.2026). Hier stand ein
               Absatz mit dem Anmeldelink des E22-Flusses; der Ton-Zugang hatte
               in der Verwaltung GAR KEINE Flaeche und lebte nur im Eltern-
               Bereich der Box. Nach dem gemessenen Ende des Ein-Login-Traums
               (Wiki: ton-token-traegt-keine-web-api) sind zwei Anmeldungen
               Spotifys Architektur — also fuehrt jetzt EIN Assistent durch
               beide. Die Lehren des alten Absatzes sind mit umgezogen (Kopf
               von spotify-assistent.ts): der Weg steht auch bei „eingerichtet"
               da (der Weg ZURUECK, [[box-token-laeuft-ab-sdk-laeuft-trotzdem]],
               [[librespot-fremdes-konto-uebernommen]]), und „bereit" heisst
               „hinterlegt", nicht „funktioniert".
               KEINE BACKTICKS HIER: Template-Literal
               ([[backticks-in-angular-vorlagen]]). -->
          @if (k.anbieter.id === 'spotify') {
            <mupi-spotify-assistent
              [stand]="k.anbieter.stand"
              [warum]="k.anbieter.warum"
              [anmeldeWeg]="spotifyLink()"
              (fertig)="laden()"
            />
            <!-- DIE SPOTIFY ENGINE (E42, bis 21.08.2026 „Tonmaschine") wohnt
                 HIER und nicht auf der Ton-Seite: Ton ist die
                 dienstunabhaengige Geschichte, WELCHER Spotify-Client spielt,
                 eine Eigenschaft dieses Dienstes.
                 MIT EIGENER GRENZE, sonst klebt sie am Assistenten darueber
                 und dessen Client-ID wirkt wie ihr Zubehoer. -->
            <div class="abschnitt">
              <span class="was">Welcher Client spielt</span>
              <span class="wofuer">
                Betrifft nur die Wiedergabe. Der Zugang oben gilt für beide.
              </span>
            </div>
            <mupi-spotify-maschine />

            <!-- DIE STROEME (E72). Die Box fuehrt nummerierte Spotify-Zugaenge
                 — jeder mit eigenem Konto und eigenem Lautsprecher, damit zwei
                 Kinder gleichzeitig Verschiedenes hoeren koennen. Sie standen
                 bis zum 21.08.2026 NUR in der Konfigurationsdatei; der zweite
                 war von Hand eingetragen und in der Verwaltung unsichtbar
                 (Betreiber: "das muss noch vertreten werden in den spotify
                 bereich").
                 EIGENER ABSCHNITT aus demselben Grund wie bei der Engine
                 darueber: ohne Grenze liest sich die Liste wie Zubehoer der
                 Client-Wahl, und sie ist etwas anderes — WELCHER Client spielt,
                 gilt fuer alle Stroeme gemeinsam. -->
            <div class="abschnitt">
              <span class="was">Die Ströme</span>
              <span class="wofuer">
                Je Strom ein eigener Spotify-Zugang und ein eigener Lautsprecher — so hören zwei Kinder
                gleichzeitig Verschiedenes. Zwei Ströme dürfen sich kein Konto teilen.
              </span>
            </div>
            <mupi-spotify-stroeme />
          }

          <!-- JELLYFIN: ANMELDEN OHNE SCHLUESSEL (08.08.2026).
               Gemeldet: der QuickConnect sei "verlorhen ... man kann es auch
               nicht mehr anstossen". Er war nicht kaputt, sondern
               unerreichbar - er lebt in der klassischen Oberflaeche auf der
               Seite /jellyfin, und auf die verweist NICHTS.
               ER STEHT AUCH BEI "bereit" DA, aus demselben Grund wie der
               Spotify-Link darueber: ein hinterlegter Schluessel heisst nicht,
               dass er noch gilt, und der Weg zurueck darf nicht davon
               abhaengen. -->
          @if (k.anbieter.id === 'jellyfin') {
            <mupi-jellyfin-schnellverbindung (angemeldet)="laden()" />
          }

          <!-- DIE FELDER GEHOEREN DEM DIENST, NICHT DER ENGINE. Ohne diese
               Ueberschrift standen sie unmittelbar unter der Engine-Wahl und
               wurden ihr zugeschlagen — siehe die Begruendung beim Stil
               .abschnitt weiter oben. KEINE BACKTICKS: Template-Literal. Der Text nennt die Zugehoerigkeit ausdruecklich,
               statt sie der Anordnung zu ueberlassen. -->
          @if (k.felder.length > 0) {
            <div class="abschnitt">
              <span class="was">Einstellungen für {{ k.anbieter.name }}</span>
              @if (k.anbieter.id === 'spotify') {
                <span class="wofuer">
                  Gelten für den ganzen Dienst — unabhängig davon, welche Engine oben gewählt ist.
                </span>
              }
            </div>
            <ul>
              @for (f of k.felder; track f.id) {
                <li [class.geaendert]="istGeaendert(f.id)">
                  <div class="wer">
                    <div class="titel">{{ f.titel }}</div>
                    <div class="hinweis">{{ f.hinweis }}</div>
                    @if (f.neustart) {
                      <div class="marke">wirkt nach einem Neustart</div>
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
                      @case ('auswahl') {
                        <select [disabled]="speichert()" (change)="setze(f.id, $any($event.target).value)">
                          @for (a of f.auswahl; track a.wert) {
                            <option [value]="a.wert" [selected]="a.wert === wert(f.id)">{{ a.titel }}</option>
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
        </div>
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
export class StreamingSeite {
  private readonly http = inject(HttpClient)

  readonly anbieter = signal<Anbieter[]>([])
  readonly felder = signal<Feld[]>([])
  readonly laedt = signal(true)
  readonly speichert = signal(false)
  readonly fehler = signal('')
  readonly getan = signal('')
  readonly offen = signal<Record<string, unknown>>({})
  readonly anmeldeWeg = signal('/spotify')
  // HIER STAND `httpsPort = signal(8443)`. Er hing allein am Anmeldelink, und
  // der geht seit E22/R1 wieder ueber die eigene Herkunft (siehe spotifyLink).
  // Der Server nennt das Feld weiterhin — es wird hier nur nicht mehr
  // gebraucht.

  readonly anzahl = computed(() => Object.keys(this.offen()).length)

  /**
   * Anbieter und ihre Felder zusammenfuehren.
   *
   * Die Zuordnung kommt vom Server (`anbieter.felder`), nicht aus einem
   * Namensmuster wie „faengt mit spotify an". Ein Muster haette bei
   * `spotifyCacheStufe` funktioniert und bei `jellyfinSchluessel` auch — und
   * beim naechsten Feld still danebengegriffen.
   */
  readonly karten = computed<Karte[]>(() => {
    const felder = this.felder()
    return this.anbieter().map((a) => ({
      anbieter: a,
      felder: a.felder.map((id) => felder.find((f) => f.id === id)).filter((f): f is Feld => !!f),
    }))
  })

  constructor() {
    void this.laden()
  }

  standText(s: Anbieter['stand']): string {
    return STAND_TEXT[s]
  }

  faehigkeitText(f: string): string {
    return FAEHIGKEIT_TEXT[f] ?? f
  }

  /**
   * Der Anmeldelink zeigt zur BOX — und zwar auf DIESE Herkunft.
   *
   * HIER STAND `https://${location.hostname}:8443…`, und dafuer gab es genau
   * einen Grund: die Anmeldeseite war selbst das Ziel der Spotify-
   * Rueckleitung, und Spotify nimmt nur https oder die Rueckschleife. Seit
   * BACKLOG E22/R1 schickt die Anmeldeseite eine FESTE Adresse mit
   * (`http://127.0.0.1:8200/spotify`) und ist gar kein Rueckweg mehr — der
   * Umweg ueber 8443 kostete danach nur noch die Warnung vor dem
   * selbstsignierten Zeugnis, also genau eine der drei Beschwerden, die E22
   * abgeschafft hat.
   *
   * `location.origin` ist dabei richtig, nicht bequem: diese Verwaltung wird
   * von der Box ausgeliefert (`app.use('/admin', …)` im backend-api). Ihre
   * Herkunft IST die Box, auch wenn die Seite auf einem Laptop angezeigt wird
   * — der Rechnername des Laptops kommt hier gar nicht vor.
   *
   * Und die alte Zeile daneben — „angemeldet wird auf der Box selbst" — war
   * ebenfalls ueberholt: am Geraet ist die Anmeldung seit E22/R4 nachweislich
   * NICHT abschliessbar (der Kiosk laeuft auf `localhost:8200`, die
   * Rueckleitung auf `127.0.0.1:8200` — andere Herkunft, kein Verifier).
   */
  spotifyLink(): string {
    return `${location.origin}${this.anmeldeWeg()}`
  }

  // NICHT MEHR `private`: die Schnellverbindung meldet eine geglueckte
  // Anmeldung, und dann muss die Anbieterliste neu geholt werden — sonst steht
  // darueber weiter „unvollstaendig", waehrend die Box laengst angemeldet ist.
  async laden(): Promise<void> {
    this.laedt.set(true)
    try {
      // Zwei Abrufe, weil es zwei Fragen sind: WELCHE Anbieter gibt es (und in
      // welchem Zustand) und WIE stellt man sie ein. Die Feldtabelle ist
      // dieselbe wie auf der Konfigurationsseite — sie wird gelesen, nicht
      // nachgebaut.
      const [s, k] = await Promise.all([
        firstValueFrom(
          this.http.get<{
            anbieter: Anbieter[]
            spotifyAnmeldeWeg?: string
          }>('/api/streaming'),
        ),
        firstValueFrom(this.http.get<{ felder: Feld[] }>('/api/konfiguration')),
      ])
      this.anbieter.set(s.anbieter ?? [])
      if (s.spotifyAnmeldeWeg) this.anmeldeWeg.set(s.spotifyAnmeldeWeg)
      this.felder.set(k.felder ?? [])
      this.offen.set({})
    } catch {
      this.fehler.set('Die Anbieter ließen sich nicht laden.')
    } finally {
      this.laedt.set(false)
    }
  }

  wert(id: string): unknown {
    const o = this.offen()
    if (Object.hasOwn(o, id)) return o[id]
    const f = this.felder().find((x) => x.id === id)
    if (f?.art === 'schalter') return f.wert === true || f.wert === '1'
    return f?.wert ?? ''
  }

  istGeaendert(id: string): boolean {
    return Object.hasOwn(this.offen(), id)
  }

  setze(id: string, wert: unknown): void {
    const f = this.felder().find((x) => x.id === id)
    const urspruenglich = f?.art === 'schalter' ? f.wert === true || f.wert === '1' : f?.wert
    const o = { ...this.offen() }
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
        this.http.post<{ ok: boolean; geaendert: { titel: string }[] }>('/api/konfiguration', {
          aenderungen: this.offen(),
        }),
      )
      this.getan.set(`Gespeichert: ${a.geaendert.map((g) => g.titel).join(', ')}.`)
      await this.laden()
    } catch (e) {
      const gemeldet = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(gemeldet || 'Das Speichern ist fehlgeschlagen.')
    } finally {
      this.speichert.set(false)
    }
  }
}
