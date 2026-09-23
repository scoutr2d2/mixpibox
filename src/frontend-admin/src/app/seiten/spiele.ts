/**
 * DER SPIELBEREICH — eine eigene Seite.
 *
 * Betreiber am 19.09.2026: „bei vorlesen noch die spiele als einschalt
 * option mit reinnehmen." Einen Tag spaeter: „ich moechte den spiel bereich
 * seperat einschalten koennen."
 *
 * Beides ist richtig, nur nacheinander: Erst musste es den Schalter
 * ueberhaupt geben, dann gehoerte er an seinen Platz. Mit Sprache hatte er
 * nie etwas zu tun — dieselbe Bewegung wie beim TON am 15.08.2026.
 *
 * DIESE SEITE SCHREIBT IHRE EIGENE DATEI (`PUT /api/spiele`). Sie fasst die
 * Vorlese-Einstellungen nicht an — sonst ueberschriebe sie deren Stand,
 * sobald jemand zwei Reiter offen hat.
 *
 * ══ ZWEITER ZUG, 20.09.2026 ═════════════════════════════════════════════
 *
 * Betreiber: „in der spiele sektion will ich das vorlesen noch einschalten
 * koennen und auch verschiedene spiele ein und ausschalten koennen."
 *
 * Dazu kamen zwei Karten. Die STIMME ist nicht das Kachel-Vorlesen (dort
 * entscheidet `modus`, ob ein ANTIPPEN spricht — im Spiel wird nichts
 * angetippt); sie benutzt nur dieselbe Piper-Stimme. Die EINZELNEN SPIELE
 * kommen aus `GET /api/spiele` mit, damit hier genau die Schalter stehen,
 * die diese Box kennt — eine Liste in der Oberflaeche waere beim naechsten
 * Spiel veraltet, und niemand wuesste, wo sie steht.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

interface Werk {
  id: string
  name: string
  was: string
}

interface Einstellungen {
  an: boolean
  vorlesen: boolean
  spiele: Record<string, boolean>
  apps: Record<string, boolean>
}

/** Was GET /api/spiele zurueckgibt — die Einstellung plus beide Werklisten. */
interface Auskunft extends Einstellungen {
  werke?: Werk[]
  appWerke?: Werk[]
}

@Component({
  selector: 'mupi-spiele',
  standalone: true,
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
    .wahl { display: flex; flex-direction: column; gap: 0.7rem; }
    .wahl label {
      display: flex; gap: 0.7rem; align-items: flex-start;
      padding: 0.6rem 0.7rem; border-radius: 9px;
      border: 1px solid var(--rand, #24313f); cursor: pointer;
    }
    .wahl label.an { border-color: var(--betont, #2b6cb0); background: rgba(43,108,176,0.12); }
    .wahl input { margin-top: 0.2rem; }
    .wahl b { display: block; font-size: 0.98rem; }
    .wahl span { color: var(--gedaempft); font-size: 0.86rem; line-height: 1.45; }
    .hinweis { color: var(--gedaempft); font-size: 0.86rem; line-height: 1.5; margin: 0.7rem 0 0; }
    .meldung { margin-top: 0.8rem; font-size: 0.9rem; }
    .meldung.schlecht { color: var(--warnung, #e06c75); }
    .karte.matt { opacity: 0.55; }
    .warn { color: var(--warnung, #e06c75); font-size: 0.88rem; line-height: 1.5; margin: 0.7rem 0 0; }
  `,
  template: `
    <h1>Spiele</h1>
    <p class="unter">Der Spielbereich der Box — getrennt von allem anderen ein- und ausschaltbar.</p>

    <div class="karte">
      <h2>Darf gespielt werden?</h2>
      <div class="wahl">
        <label [class.an]="entwurf().an">
          <input type="radio" name="spiele" [checked]="entwurf().an" (change)="setze(true)" />
          <span>
            <b>Ja</b>
            <span>
              Die Taste der Fernbedienung öffnet den Spielbereich. Gespielt wird mit
              Steuerkreuz oder Stick; welche Spiele darin stehen, steht eine Karte
              weiter unten. Die Musik läuft dabei weiter.
            </span>
          </span>
        </label>
        <label [class.an]="!entwurf().an">
          <input type="radio" name="spiele" [checked]="!entwurf().an" (change)="setze(false)" />
          <span>
            <b>Nein</b>
            <span>
              Die Taste tut nichts mehr, und ein gerade laufendes Spiel wird binnen
              einer halben Minute beendet. Sonst ändert sich nichts.
            </span>
          </span>
        </label>
      </div>
      <p class="hinweis">
        Bis zum 20.09.2026 stand dieser Schalter auf der Vorlesen-Seite — ein eingestelltes
        „Nein" von dort gilt hier weiter.
      </p>
      @if (meldung()) {
        <p class="meldung" [class.schlecht]="meldungSchlecht()">{{ meldung() }}</p>
      }
    </div>

    <div class="karte" [class.matt]="!entwurf().an">
      <h2>Welche Spiele?</h2>
      @if (werke().length === 0) {
        <p class="hinweis">Die Box hat noch keine Liste geschickt.</p>
      } @else {
        <div class="wahl">
          @for (w of werke(); track w.id) {
            <label [class.an]="istAn(w.id)">
              <input type="checkbox" [checked]="istAn(w.id)" (change)="setzeSpiel(w.id, !istAn(w.id))" />
              <span>
                <b>{{ w.name }}</b>
                <span>{{ w.was }}</span>
              </span>
            </label>
          }
        </div>
      }
      @if (keinesAn()) {
        <p class="warn">
          Kein einziges Spiel ist eingeschaltet — die Taste öffnet dann nichts, genau wie
          bei „Nein" oben. Das ist erlaubt, sieht an der Box aber aus wie ein Fehler.
        </p>
      }
      <p class="hinweis">
        Ein abgeschaltetes Spiel steht nicht mehr in der Auswahl. Bleibt genau eines übrig,
        startet die Taste es sofort, ohne Auswahl dazwischen.
      </p>
    </div>

    <div class="karte" [class.matt]="!entwurf().an">
      <h2>Spricht die Box beim Spielen?</h2>
      <div class="wahl">
        <label [class.an]="entwurf().vorlesen">
          <input type="radio" name="spielstimme" [checked]="entwurf().vorlesen" (change)="setzeStimme(true)" />
          <span>
            <b>Ja, vorlesen</b>
            <span>
              Die Box sagt an, welches Spiel gewählt ist, bei „Paare" jedes aufgedeckte Bild,
              bei „Farben merken" die Farbfolge, und am Ende den Ausgang. Für Kinder, die
              noch nicht lesen.
            </span>
          </span>
        </label>
        <label [class.an]="!entwurf().vorlesen">
          <input type="radio" name="spielstimme" [checked]="!entwurf().vorlesen" (change)="setzeStimme(false)" />
          <span>
            <b>Nein, still</b>
            <span>Geschrieben steht ohnehin alles am Schirm. So war es bisher.</span>
          </span>
        </label>
      </div>
      <p class="hinweis">
        Das ist NICHT das Vorlesen der Kacheln — der Schalter dort entscheidet, ob ein
        Antippen spricht, und im Spiel wird nichts angetippt. Gesprochen wird mit derselben
        Stimme; liegt Piper nicht auf der Box, bleibt es still, ohne dass etwas hakt.
      </p>
    </div>

    <div class="karte">
      <h2>Die Schublade am Schirm</h2>
      <p class="hinweis" style="margin-top:0">
        Der zweite Spielort: Tipp-Apps neben den Kategorien auf dem Schirm der Box — für
        den Finger, nicht für den Controller. Sie hängen <strong>nicht</strong> am Schalter
        oben; wer den Spielbereich abschaltet, lässt die Schublade unberührt und umgekehrt.
      </p>
      @if (appWerke().length === 0) {
        <p class="hinweis">Die Box hat noch keine Liste geschickt.</p>
      } @else {
        <div class="wahl">
          @for (w of appWerke(); track w.id) {
            <label [class.an]="appAn(w.id)">
              <input type="checkbox" [checked]="appAn(w.id)" (change)="setzeApp(w.id, !appAn(w.id))" />
              <span>
                <b>{{ w.name }}</b>
                <span>{{ w.was }}</span>
              </span>
            </label>
          }
        </div>
      }
      <p class="hinweis">
        Manche Apps zeigen sich ohnehin nur, wenn sie können: „Lesen" braucht Titel und
        eingeschaltetes Vorlesen, „Puzzle" braucht Bilder. Ein Haken hier heißt „darf",
        nicht „steht immer da". Ist keine einzige übrig, bleibt die Schublade zu.
      </p>
    </div>
  `,
})
export class SpieleSeite {
  private http = inject(HttpClient)

  readonly entwurf = signal<Einstellungen>({ an: true, vorlesen: false, spiele: {}, apps: {} })
  /**
   * Die Werkliste kommt VON DER BOX und bleibt in einem eigenen Signal.
   *
   * WARUM NICHT IM ENTWURF: `PUT /api/spiele` antwortet mit dem
   * normalisierten Objekt, und darin ist `werke` nicht enthalten (der
   * Server wirft es weg — es gehoert nicht in die Datei). Laege die Liste im
   * Entwurf, waere sie nach dem ersten Speichern verschwunden und die Karte
   * leer.
   */
  readonly werke = signal<Werk[]>([])
  readonly appWerke = signal<Werk[]>([])
  readonly meldung = signal('')
  readonly meldungSchlecht = signal(false)

  constructor() {
    void this.laden()
  }

  private async laden(): Promise<void> {
    try {
      const a = await firstValueFrom(this.http.get<Auskunft>('/api/spiele'))
      this.werke.set(Array.isArray(a.werke) ? a.werke : [])
      this.appWerke.set(Array.isArray(a.appWerke) ? a.appWerke : [])
      this.entwurf.set(this.ausAntwort(a))
    } catch {
      this.sag('Die Einstellung konnte nicht geladen werden.', true)
    }
  }

  /** Was der Server sagt — an EINER Stelle, damit Laden und Speichern gleich lesen. */
  private ausAntwort(a: Einstellungen): Einstellungen {
    return {
      an: a.an !== false,
      vorlesen: a.vorlesen === true,
      spiele: a.spiele ?? {},
      apps: a.apps ?? {},
    }
  }

  istAn(id: string): boolean {
    // `!== false` wie im Server: ein Spiel, das die Datei noch nicht kennt,
    // ist an — sonst staende ein frisch dazugekommenes hier ungefragt aus.
    return this.entwurf().spiele[id] !== false
  }

  appAn(id: string): boolean {
    return this.entwurf().apps[id] !== false
  }

  setzeApp(id: string, an: boolean): void {
    this.entwurf.update((e) => ({ ...e, apps: { ...e.apps, [id]: an } }))
    void this.speichern()
  }

  keinesAn(): boolean {
    return this.werke().length > 0 && this.werke().every((w) => !this.istAn(w.id))
  }

  setze(an: boolean): void {
    this.entwurf.update((e) => ({ ...e, an }))
    void this.speichern()
  }

  setzeStimme(vorlesen: boolean): void {
    this.entwurf.update((e) => ({ ...e, vorlesen }))
    void this.speichern()
  }

  setzeSpiel(id: string, an: boolean): void {
    this.entwurf.update((e) => ({ ...e, spiele: { ...e.spiele, [id]: an } }))
    void this.speichern()
  }

  private async speichern(): Promise<void> {
    try {
      // Der Server biegt zurecht, was nicht geht — dann soll auch hier
      // stehen, was wirklich gilt, und nicht das, was gewünscht war.
      // NUR DIE EINSTELLUNG geht hinaus; `werke` bleibt hier, sonst
      // schriebe die Verwaltung der Box vor, welche Spiele es gibt.
      const a = await firstValueFrom(this.http.put<Einstellungen>('/api/spiele', this.entwurf()))
      this.entwurf.set(this.ausAntwort(a))
      this.sag('Gespeichert.', false)
    } catch {
      this.sag('Speichern fehlgeschlagen.', true)
    }
  }

  private sag(text: string, schlecht: boolean): void {
    this.meldung.set(text)
    this.meldungSchlecht.set(schlecht)
    setTimeout(() => this.meldung.set(''), 2500)
  }
}
