/**
 * Die Nachrichten-Seite: wer dem Kind schreiben darf — und ob es etwas hört.
 *
 * Betreiber, 20.09.2026: „integriere eine messenger integration um nachrichten
 * auf die box zu senden (im ersten schritt) matrix, signal und telegram", dazu
 * „das vorlesen soll an und ausgeschaltet werden können für das jeweilige
 * profil" und als Antwort auf die Frage nach fremden Absendern: feste
 * Erlaubnisliste.
 *
 * ══ WARUM DIESE SEITE UND NICHT NUR DIE KONFIGURATIONSSEITE ════════════════
 *
 * Die Schalter und Zugänge der drei Wege stehen als `FELDER` in
 * `konfiguration.ts` und erscheinen dort unter *Melden* — dafür braucht es
 * keine eigene Seite. Drei Dinge passen aber in kein Feld:
 *
 *   1. DIE ERLAUBNISLISTE ist eine Liste, kein Wert. Und sie ist das
 *      eigentliche Stück: wer darauf steht, redet mit einem Kind.
 *   2. DER ZUSTAND. „Der Schalter steht auf an" ist nicht dieselbe Frage wie
 *      „kommt etwas an" — ein Weg kann angeschaltet sein und seit Tagen an
 *      einem abgelaufenen Token scheitern. Deshalb steht hier je Weg, WANN
 *      zuletzt etwas hereinkam und was zuletzt schiefging.
 *   3. WER GEKLOPFT HAT. Ein Absender, der nicht auf der Liste steht, wird
 *      gezählt und seine Kennung gezeigt — sein TEXT nicht. Meistens ist das
 *      der Hinweis, dass ein Eintrag fehlt.
 *
 * DAS VORLESEN JE KIND steht hier und nicht auf der Profilseite: es ist eine
 * Eigenschaft DIESER Sache, und wer sie einschaltet, entscheidet im selben
 * Atemzug, wer es hören soll. Drei Stufen je Kind, und „wie die Box" ist eine
 * eigene davon — nicht dasselbe wie „an".
 */
import { ChangeDetectionStrategy, Component, computed, inject, type OnInit, signal } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'
import {
  type Erlaubt,
  type Nachricht,
  NachrichtenDienst,
  type Stand,
  type Weg,
} from '../nachrichten.dienst'

interface ProfilZeile {
  kennung: string
  name: string
  nachrichtenVorlesen?: boolean
}

const WEG_NAME: Record<Weg, string> = { matrix: 'Matrix', signal: 'Signal', telegram: 'Telegram' }

/** Was über dem Eingabefeld steht — je Weg die Form, die wirklich gemeint ist. */
const WEG_BEISPIEL: Record<Weg, string> = {
  matrix: '@mama:server.example',
  signal: '+49 170 1234567',
  telegram: '123456789',
}

@Component({
  selector: 'mupi-nachrichten',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.2rem; font-size: 0.94rem; }
    h2 { font-size: 1.02rem; margin: 0 0 0.7rem; }
    .karte {
      background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 12px; padding: 1rem 1.1rem; max-width: 44rem; margin-bottom: 1.2rem;
    }
    .klein { color: var(--gedaempft); font-size: 0.88rem; }
    .meldung { padding: 0.75rem 0.9rem; border-radius: 10px; font-size: 0.9rem; margin-bottom: 1rem; max-width: 44rem; }
    .meldung.fehler { background: color-mix(in srgb, var(--fehler) 18%, transparent); color: var(--fehler); }
    .meldung.hinweis { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
    .meldung.gut { background: color-mix(in srgb, var(--gut) 16%, transparent); color: var(--gut); }
    button {
      min-height: 2.4rem; padding: 0 0.9rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
      font-size: 0.9rem; line-height: 1;
    }
    button.an { background: var(--gut); border-color: transparent; color: #fff; }
    button.gefahr { background: transparent; border: 1px solid var(--fehler); color: var(--fehler); }
    button:disabled { opacity: 0.5; }
    input, select {
      box-sizing: border-box; min-height: 2.5rem;
      background: var(--grund); color: var(--schrift); border: 1px solid var(--rand);
      border-radius: 10px; padding: 0.4rem 0.6rem; font-size: 0.95rem;
    }
    .stufe { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
             padding: 0.6rem 0; border-top: 1px solid var(--rand); }
    .stufe .was { min-width: 8rem; font-size: 0.95rem; }
    .marke { font-size: 0.78rem; padding: 0.12rem 0.5rem; border-radius: 999px;
             border: 1px solid var(--rand); color: var(--gedaempft); white-space: nowrap; }
    .marke.steht { border-color: var(--gut); color: var(--gut); }
    .marke.nie { border-color: var(--warn); color: var(--warn); }
    .marke.aus { opacity: 0.6; }
    .zeile { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .zeile.eintrag { padding: 0.5rem 0; border-top: 1px solid var(--rand); }
    .zeile .weg { min-width: 5.5rem; color: var(--gedaempft); font-size: 0.9rem; }
    .zeile .wer { font-family: ui-monospace, monospace; font-size: 0.88rem; overflow-wrap: anywhere; }
    .neu { display: grid; grid-template-columns: 8rem 1fr 9rem auto; gap: 0.5rem; margin-top: 0.9rem; }
    @media (max-width: 40rem) { .neu { grid-template-columns: 1fr; } }
    .nachricht { padding: 0.6rem 0; border-top: 1px solid var(--rand); }
    .nachricht .kopf { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; }
    .nachricht .text { margin: 0.25rem 0 0; overflow-wrap: anywhere; }
    .stufen { display: flex; gap: 0.3rem; }
    .fuss { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;
            margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid var(--rand); }
    code { font-family: ui-monospace, monospace; font-size: 0.85em; }
  `,
  template: `
    <h1>Nachrichten an die Box</h1>
    <p class="unter">
      Eltern schreiben dem Kind — über Matrix, Signal oder Telegram. Die Box zeigt die
      Nachricht auf dem Schirm und kann sie vorlesen.
    </p>

    @if (fehler(); as f) { <div class="meldung fehler">{{ f }}</div> }

    @if (stand(); as s) {
      @if (!s.an) {
        <div class="meldung hinweis">
          Nachrichten sind ausgeschaltet. Der Schalter dafür steht unter
          <a routerLink="/konfiguration">Konfiguration → Melden</a>, zusammen mit den Zugängen
          der drei Wege.
        </div>
      } @else if (s.erlaubte === 0) {
        <div class="meldung hinweis">
          Eingeschaltet, aber <b>niemand</b> auf der Erlaubnisliste — es kommt nichts durch.
          Eine leere Liste heißt hier niemand, nicht alle.
        </div>
      }

      <div class="karte">
        <h2>Die drei Wege</h2>
        <p class="klein">
          „Angeschaltet“ ist nicht dasselbe wie „es kommt etwas an“. Hier steht, wann zuletzt
          wirklich etwas hereinkam.
        </p>
        @for (w of wege(); track w.weg) {
          <div class="stufe">
            <span class="was">{{ name(w.weg) }}</span>
            @if (w.lage.an) {
              <span class="marke steht">an</span>
              <span class="marke" [class.nie]="!w.lage.zuletzt">{{ wann(w.lage.zuletzt) }}</span>
            } @else {
              <span class="marke aus">aus</span>
            }
            @if (w.lage.fehler) { <span class="klein">{{ w.lage.fehler }}</span> }
          </div>
        }
        @if (s.signalDa === false) {
          <div class="meldung hinweis" style="margin-top:0.8rem">
            {{ s.signalHinweis }}
          </div>
        }
        <p class="klein" style="margin-top:0.8rem">
          Verschlüsselte Matrix-Räume gehen nicht: dort steht kein Klartext, den die Box lesen
          könnte. Der Raum für die Box muss unverschlüsselt sein.
        </p>
        <p class="klein">
          Telegram braucht einen <b>eigenen</b> Bot — nicht den, mit dem die Box hinaus meldet.
          Jede Nachricht wird nur einmal ausgeliefert; zwei Abholer nehmen sie sich gegenseitig weg.
        </p>
      </div>

      <div class="karte">
        <h2>Wer der Box schreiben darf</h2>
        <p class="klein">
          Nur diese Absender kommen durch. Alles andere wird verworfen — gezählt wird, <i>dass</i>
          jemand geschrieben hat, der Text wird nicht aufgehoben.
        </p>

        @for (e of liste(); track $index) {
          <div class="zeile eintrag">
            <span class="weg">{{ name(e.weg) }}</span>
            <span class="wer">{{ e.absender }}</span>
            @if (e.name) { <span class="klein">{{ e.name }}</span> }
            <span style="flex:1"></span>
            <button class="gefahr" (click)="entfernen($index)" [disabled]="beschaeftigt()">Entfernen</button>
          </div>
        }
        @if (!liste().length) { <p class="klein">Noch niemand eingetragen.</p> }

        <div class="neu">
          <select [value]="neuWeg()" (change)="neuWeg.set($any($event.target).value)">
            @for (w of alleWege; track w) { <option [value]="w">{{ name(w) }}</option> }
          </select>
          <input
            [value]="neuAbsender()"
            (input)="neuAbsender.set($any($event.target).value)"
            [placeholder]="beispiel()"
            aria-label="Kennung des Absenders" />
          <input
            [value]="neuName()"
            (input)="neuName.set($any($event.target).value)"
            placeholder="Mama"
            aria-label="Anzeigename" />
          <button class="an" (click)="hinzufuegen()" [disabled]="beschaeftigt() || !neuAbsender()">
            Eintragen
          </button>
        </div>
        @if (listenSatz(); as l) { <div class="meldung fehler" style="margin-top:0.8rem">{{ l }}</div> }
        <p class="klein" style="margin-top:0.6rem">
          Telefonnummern <b>international</b>: <code>+49 170 …</code> oder <code>0049 170 …</code>.
          Eine Nummer ohne Landeskennzahl passt nie zu dem, was Signal meldet — sie wird deshalb
          abgewiesen statt geraten.
        </p>

        @for (a of abgewiesen(); track a.weg) {
          <div class="meldung hinweis" style="margin-top:0.8rem">
            Über {{ name(a.weg) }} haben {{ a.anzahl }} Nachrichten von nicht eingetragenen Absendern
            angeklopft, zuletzt <code>{{ a.zuletzt }}</code>.
            Wenn das jemand ist, den das Kind kennt: oben eintragen.
          </div>
        }
      </div>

      <div class="karte">
        <h2>Vorlesen — je Kind</h2>
        <p class="klein">
          Ein Kind, das noch nicht liest, erfährt sonst nie, dass jemand geschrieben hat.
          „Wie die Box“ heißt: es folgt der Vorgabe unter Konfiguration → Melden
          (gerade <b>{{ s.vorlesen ? 'an' : 'aus' }}</b> für das Kind an der Box).
        </p>
        @for (p of profile(); track p.kennung) {
          <div class="stufe">
            <span class="was">{{ p.name }}</span>
            <span class="stufen">
              <button [class.an]="p.nachrichtenVorlesen === undefined" (click)="vorlesen(p, null)">Wie die Box</button>
              <button [class.an]="p.nachrichtenVorlesen === true" (click)="vorlesen(p, true)">An</button>
              <button [class.an]="p.nachrichtenVorlesen === false" (click)="vorlesen(p, false)">Aus</button>
            </span>
          </div>
        }
      </div>

      <div class="karte">
        <h2>Was angekommen ist</h2>
        @if (!nachrichten().length) {
          <p class="klein">Noch nichts angekommen.</p>
        } @else {
          @for (n of nachrichten(); track n.id) {
            <div class="nachricht">
              <div class="kopf">
                <b>{{ n.absenderName || n.absender }}</b>
                <span class="klein">{{ name(n.weg) }} · {{ wann(n.zeit) }}</span>
                @if (!n.gelesen) { <span class="marke steht">neu</span> }
                @if (n.gesprochen) { <span class="marke">vorgelesen</span> }
              </div>
              <p class="text">{{ n.text }}</p>
            </div>
          }
        }
        <div class="fuss">
          <button class="gefahr" (click)="leeren()" [disabled]="beschaeftigt() || !nachrichten().length">
            Alle löschen
          </button>
          <span class="klein">Löscht auch die Zählung der abgewiesenen Absender.</span>
        </div>
      </div>
    } @else {
      <p class="klein">Wird geholt …</p>
    }
  `,
})
export class NachrichtenSeite implements OnInit {
  private dienst = inject(NachrichtenDienst)
  private http = inject(HttpClient)

  readonly alleWege: Weg[] = ['matrix', 'signal', 'telegram']
  readonly stand = signal<Stand | null>(null)
  readonly liste = signal<Erlaubt[]>([])
  readonly nachrichten = signal<Nachricht[]>([])
  readonly profile = signal<ProfilZeile[]>([])
  readonly fehler = signal('')
  readonly listenSatz = signal('')
  readonly beschaeftigt = signal(false)

  readonly neuWeg = signal<Weg>('matrix')
  readonly neuAbsender = signal('')
  readonly neuName = signal('')
  readonly beispiel = computed(() => WEG_BEISPIEL[this.neuWeg()])

  readonly wege = computed(() => {
    const s = this.stand()
    if (!s) return []
    return this.alleWege.map((weg) => ({ weg, lage: s.wege?.[weg] ?? { an: false, laeuft: false, zuletzt: 0, fehler: '' } }))
  })

  readonly abgewiesen = computed(() => {
    const s = this.stand()
    if (!s?.abgewiesen) return []
    return this.alleWege
      .map((weg) => ({ weg, ...(s.abgewiesen[weg] ?? { anzahl: 0, zuletzt: '', wann: 0 }) }))
      .filter((a) => a.anzahl > 0)
  })

  ngOnInit(): void {
    void this.holen()
  }

  name(w: Weg): string {
    return WEG_NAME[w] ?? w
  }

  /**
   * Wie lange ist das her?
   *
   * KEINE UHRZEIT. Eine Uhrzeit ohne Datum lügt am nächsten Tag, und ein
   * volles Datum liest hier niemand. „vor 3 min" beantwortet die Frage, die
   * jemand auf dieser Seite wirklich hat.
   */
  wann(ms: number): string {
    if (!ms) return 'noch nie etwas'
    const verstrichen = Date.now() - ms
    if (verstrichen < 0) return 'gerade eben'
    const min = Math.floor(verstrichen / 60000)
    if (min < 1) return 'gerade eben'
    if (min < 120) return `vor ${min} min`
    const std = Math.floor(min / 60)
    if (std < 48) return `vor ${std} h`
    return `vor ${Math.floor(std / 24)} Tagen`
  }

  private async holen(): Promise<void> {
    try {
      const [stand, erlaubt, liste, profile] = await Promise.all([
        this.dienst.stand(),
        this.dienst.erlaubt(),
        this.dienst.liste(),
        firstValueFrom(this.http.get<{ profile: ProfilZeile[] }>('/api/profile')),
      ])
      this.stand.set(stand)
      this.liste.set(erlaubt.erlaubt)
      this.nachrichten.set(liste.nachrichten)
      this.profile.set(profile.profile ?? [])
      this.fehler.set('')
    } catch {
      this.fehler.set('Die Box antwortet gerade nicht.')
    }
  }

  /**
   * Einen Eintrag hinzufügen — und ihn NUR dann in die Liste übernehmen,
   * wenn die Box ihn genommen hat.
   *
   * Die Gegenrichtung (erst anzeigen, dann senden) zeigte einen Eintrag, den
   * es auf der Box nicht gibt. Danach wartet jemand auf eine Nachricht, die
   * nie kommt, und die Oberfläche behauptet das Gegenteil.
   */
  async hinzufuegen(): Promise<void> {
    const neu = [...this.liste(), { weg: this.neuWeg(), absender: this.neuAbsender().trim(), name: this.neuName().trim() }]
    await this.setzen(neu, () => {
      this.neuAbsender.set('')
      this.neuName.set('')
    })
  }

  async entfernen(i: number): Promise<void> {
    await this.setzen(this.liste().filter((_e, n) => n !== i))
  }

  private async setzen(neu: Erlaubt[], danach?: () => void): Promise<void> {
    this.beschaeftigt.set(true)
    this.listenSatz.set('')
    const f = await this.dienst.erlaubtSetzen(neu)
    this.beschaeftigt.set(false)
    if (f) {
      this.listenSatz.set(f.satz)
      return
    }
    danach?.()
    await this.holen()
  }

  async vorlesen(p: ProfilZeile, wert: boolean | null): Promise<void> {
    this.beschaeftigt.set(true)
    try {
      await this.dienst.vorlesenSetzen(p.kennung, wert)
    } catch {
      this.fehler.set('Das Vorlesen wurde nicht umgestellt.')
    }
    this.beschaeftigt.set(false)
    await this.holen()
  }

  async leeren(): Promise<void> {
    this.beschaeftigt.set(true)
    try {
      await this.dienst.leeren()
    } catch {
      this.fehler.set('Es wurde nichts gelöscht.')
    }
    this.beschaeftigt.set(false)
    await this.holen()
  }
}
