/**
 * Die Systemseite.
 *
 * Zwei Entscheidungen, die sich im Betrieb auszahlen:
 *
 * 1. „Box ausschalten" und „Box neu starten" fragen NACH. Beim alten Admin
 *    saßen sie als kleine Symbole in der Kopfleiste, direkt neben harmlosen
 *    Knöpfen — ein Fehlgriff kostete den Weg zum Gerät. Hier stehen sie unten,
 *    getrennt, und verlangen eine Bestätigung.
 *
 * 2. Der Plattenplatz wird gewarnt, nicht nur angezeigt. Eine volle Karte ist
 *    auf dieser Box schon als „Backend plötzlich tot" aufgetreten, weil ein
 *    fehlgeschlagener Schreibvorgang den Server mitnahm.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'
import { textOderUnbekannt } from '../dauer-text'
import { type SystemAktion, SystemDienst, type Systemlage } from '../system.dienst'
import { Systemkurve } from './systemkurve'

@Component({
  selector: 'mupi-system',
  standalone: true,
  imports: [Systemkurve],
  // KEIN FormsModule mehr: das einzige [(ngModel)] dieser Seite sass am
  // Schlummer-Timer, und der steht seit dem 03.08.2026 unter „Kinderzeit".
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 1.2rem; }
    h2 { font-size: 1.02rem; margin: 2rem 0 0.7rem; }
    .werte { display: grid; gap: 0.7rem; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
    .wert {
      background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 12px; padding: 0.85rem 1rem;
    }
    .wert .was { color: var(--gedaempft); font-size: 0.82rem; }
    .wert .zahl { font-size: 1.25rem; margin-top: 0.15rem; }
    .wert.warnung { border-color: var(--warn); }
    .wert.warnung .zahl { color: var(--warn); }
    .leiste { height: 5px; border-radius: 3px; background: var(--rand); margin-top: 0.5rem; overflow: hidden; }
    .leiste i { display: block; height: 100%; background: var(--leit); }
    .leiste i.warnung { background: var(--warn); }
    .knoepfe { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    .tat {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.9rem 1rem; flex: 1 1 16rem;
    }
    .tat .titel { font-weight: 500; margin-bottom: 0.2rem; }
    .tat .hinweis { color: var(--gedaempft); font-size: 0.85rem; margin-bottom: 0.8rem; }
    .tat.hart { border-color: color-mix(in srgb, var(--fehler) 45%, var(--rand)); }
    .tat.hart button { background: var(--fehler); }
    .frage {
      background: color-mix(in srgb, var(--fehler) 14%, transparent);
      border: 1px solid var(--fehler); border-radius: 12px; padding: 1rem;
      margin-bottom: 1rem;
    }
    .frage p { margin: 0 0 0.9rem; }
    .frage .knoepfe button:first-child { background: var(--fehler); }
    .meldung { padding: 0.75rem 0.9rem; border-radius: 10px; margin-bottom: 1rem; font-size: 0.9rem; }
    .meldung.fehler { background: color-mix(in srgb, var(--fehler) 18%, transparent); color: var(--fehler); }
    .meldung.gut { background: color-mix(in srgb, var(--gut) 16%, transparent); color: var(--gut); }
    .klein { color: var(--gedaempft); font-size: 0.88rem; }
    .schraube {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.85rem 1rem; display: flex; gap: 1rem; align-items: center;
      flex-wrap: wrap; margin-bottom: 0.6rem;
    }
    .schraube .wer { flex: 1 1 18rem; }
    select {
      font: inherit; padding: 0.5rem 0.6rem; border-radius: 8px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
    }
  `,
  template: `
    <h1>System</h1>

    @if (fehler(); as f) {
      <div class="meldung fehler">{{ f }}</div>
    }
    @if (getan(); as g) {
      <div class="meldung gut">{{ g }}</div>
    }

    @if (laedt()) {
      <p class="klein">Einen Moment…</p>
    } @else if (lage(); as l) {
      <div class="werte">
        <div class="wert">
          <div class="was">Läuft seit</div>
          <div class="zahl">{{ laufzeit() }}</div>
        </div>
        <div class="wert">
          <div class="was">Arbeitsspeicher</div>
          <div class="zahl">{{ speicherText() }}</div>
          <div class="leiste"><i [style.width.%]="speicherProzent()"></i></div>
        </div>
        <div class="wert" [class.warnung]="platteKnapp()">
          <div class="was">Speicherkarte</div>
          @if (l.platte; as p) {
            <div class="zahl">{{ p.prozent }} % belegt</div>
            <div class="leiste"><i [class.warnung]="platteKnapp()" [style.width.%]="p.prozent"></i></div>
            <div class="klein">{{ groesse(p.frei) }} frei von {{ groesse(p.gesamt) }}</div>
          } @else {
            <div class="zahl">–</div>
          }
        </div>
        @if (l.temperatur !== null) {
          <div class="wert">
            <div class="was">Temperatur</div>
            <div class="zahl">{{ l.temperatur }} °C</div>
          </div>
        }
        <div class="wert">
          <div class="was">Auslastung ({{ l.kerne }} Kerne)</div>
          <div class="zahl">{{ lastText() }}</div>
        </div>
      </div>

      @if (platteKnapp()) {
        <p class="meldung fehler">
          Die Speicherkarte ist fast voll. Wenn kein Platz mehr ist, schlagen
          Schreibvorgänge fehl — lösche Medien oder Protokolle, bevor es so weit
          kommt.
        </p>
      }

      <!-- LAST, WAERME UND SPEICHER UEBER DIE ZEIT (08.08.2026).
           SIE STEHT DIREKT UNTER DEN KAESTCHEN, weil diese GENAU DIESE Zahlen
           als Augenblickswert zeigen. Die Kurve beantwortet die naechste Frage
           („und vorhin?"); sie in einen eigenen Abschnitt weiter unten zu
           haengen hiesse, dass man erst an den Ausschaltknoepfen vorbei muss,
           um sie zu finden.
           DIE ZWILLINGSFASSUNG steht im Eltern-Bereich der Box
           (NewDesign/app.js, sysKurveBauen) — der Auftrag lautete „in beiden
           admin bereichen". Dass die beiden nicht auseinanderlaufen, misst
           tools/systemkurve-gleich.py. -->
      <h2>Verlauf</h2>
      <mupi-systemkurve />

      <!-- „MEDIEN NEU EINLESEN" STAND HIER BIS ZUM 03.08.2026 unter einer
           eigenen Ueberschrift „Medien", zusammen mit der Schleife ueber alle
           NICHT einschneidenden Aktionen. Der Knopf lebt (er ruft
           m3u_generator.sh, und ohne ihn taucht eine frisch aufgespielte Datei
           erst beim naechsten Lauf von change_checker.sh auf) — er steht nur
           woanders: auf der Medienseite. Er beantwortet „was ist da?", nicht
           „wie geht es der Maschine?".
           DIE SCHLEIFE IST MITGEGANGEN, obwohl sie allgemein war. Ein leerer
           Abschnitt mit Ueberschrift waere kein Platzhalter, sondern eine
           Luege: die Suche erhebt Ueberschriften und haette „Wartung — System"
           angeboten, hinter dem nie etwas steht. Ein Treffer, der ins Leere
           fuehrt, ist schlimmer als keiner.
           WAS PASSIERT, WENN JEMAND EINE NEUE SANFTE AKTION EINTRAEGT: Sie
           haette hier keinen Bedienweg — und genau deshalb steht in
           backend-api/src/system.spec.ts „sagt an jeder Aktion, auf welche
           Seite sie gehoert" mit einer namentlichen Liste. Der Test wird rot,
           bevor die Aktion still unbedienbar wird. -->

      <!-- OBERFLAECHE NEU LADEN — die letzte der beiden „nur Endpunkt, kein
           Bedienweg"-Luecken aus der Bestandsaufnahme (G3).
           WARUM NICHT IN DER AKTIONEN-TABELLE, obwohl das Backlog es dort
           vorschlug: die Tabelle in system.ts fuehrt BEFEHLE aus (befehl +
           args, ueber execFile). Dieser Weg startet nichts, er zaehlt einen
           Zaehler hoch, den die Box-Oberflaeche abfragt und woraufhin sie
           SELBST neu laedt. Ein Eintrag mit einem erfundenen Befehl waere eine
           Luege in einer Tabelle, deren ganzer Sinn ihre Genauigkeit ist. -->
      <!-- DIE UEBERSCHRIFT KAM AM 08.08.2026 DAZU, und zwar nicht aus
           Ordnungsliebe: darueber steht seither „Verlauf", und der Suchbestand
           (tools/verwaltung-suchbestand.mjs) ordnet jeden Knopf der letzten
           Ueberschrift ueber ihm zu. „Oberfläche neu laden" hiess in der Suche
           damit „Verlauf › Oberfläche neu laden" — ein Treffer, der auf eine
           Kurve zeigt, wo ein Knopf gemeint ist.
           SIE IST KEIN LEERER ABSCHNITT (der Einwand von weiter oben, wegen
           dem „Wartung — System" 2026-08-03 verschwand): hier steht etwas
           darunter, und zwar genau eine Sache. -->
      <h2>Wartung</h2>
      <div class="tat">
        <div class="titel">Oberfläche neu laden</div>
        <div class="hinweis">
          Die Box lädt ihre Oberfläche neu — die Musik läuft weiter, sie spielt nicht
          im Browser. Hilft, wenn nach einer Änderung noch die alte Fassung steht.
        </div>
        <button type="button" [disabled]="neuladenLaeuft()" (click)="oberflaecheNeuladen()">
          {{ neuladenLaeuft() ? 'Angefordert…' : 'Oberfläche neu laden' }}
        </button>
      </div>

      <p class="klein">
        Ein Knopf „Anzeige neu starten" fehlt hier bewusst: er beendet den
        Bildschirm-Browser, und dieser lässt sich aus der Verwaltung heraus
        nicht wieder starten (er braucht eine Konsole, die es hier nicht gibt).
        Wenn die Anzeige klemmt oder eine neue Fassung greifen soll, hilft
        „Box neu starten" — das dauert etwa 25 Sekunden und geht immer.
      </p>

      <!-- DER SCHLUMMER-TIMER STAND HIER BIS ZUM 03.08.2026 und steht jetzt
           unter „Kinderzeit". Beides sind Zeitgrenzen fuer ein Kind; sie an
           zwei Orten zu haben hiess, dass man beim Suchen raet. Der Endpunkt
           (/api/schlummer) ist unveraendert — es ist die Bedienung gewandert,
           nicht der Timer. -->

      @if (schrauben().length > 0) {
        <h2>Systemeinstellungen</h2>
        <p class="klein">
          Wirken sofort, überstehen aber keinen Blick in die Zukunft: was hier
          steht, lässt sich nicht auslesen, nur setzen.
        </p>
        @for (s of schrauben(); track s.id) {
          <div class="schraube">
            <div class="wer">
              <div class="titel">{{ s.titel }}</div>
              <div class="hinweis">{{ s.hinweis }}</div>
            </div>
            <select #sel (change)="schraubeSetzen(s, sel.value)">
              <option value="">— wählen —</option>
              @for (w of s.werte; track w) {
                <option [value]="w">{{ w }}</option>
              }
            </select>
          </div>
        }
        <p class="klein">
          Bildschirm-Drehung, SD-Übertaktung und Boot-Warnungen fehlen hier
          absichtlich: sie ändern <code>/boot/config.txt</code>, und ein Fehler
          dort ist ein schwarzer Bildschirm nach dem Neustart.
        </p>
      }

      <h2>Box aus- und einschalten</h2>
      @if (frage(); as f) {
        <div class="frage">
          <p><strong>{{ f.titel }}</strong> — {{ f.hinweis }}</p>
          <div class="knoepfe">
            <button type="button" (click)="bestaetigen()">Ja, {{ f.titel }}</button>
            <button type="button" class="still" (click)="frage.set(null)">Abbrechen</button>
          </div>
        </div>
      }
      <div class="knoepfe">
        @for (a of harte(); track a.id) {
          <div class="tat hart">
            <div class="titel">{{ a.titel }}</div>
            <div class="hinweis">{{ a.hinweis }}</div>
            <button type="button" [disabled]="laeuft()" (click)="frage.set(a)">
              {{ a.titel }}
            </button>
          </div>
        }
      </div>
    } @else {
      <div class="meldung fehler">Der Systemzustand ließ sich nicht lesen.</div>
    }
  `,
})
export class SystemSeite {
  private readonly api = inject(SystemDienst)
  private readonly http = inject(HttpClient)

  readonly lage = signal<Systemlage | null>(null)
  readonly laedt = signal(true)
  readonly fehler = signal('')
  readonly getan = signal('')
  readonly laeuft = signal('')
  /** Die Aktion, für die gerade nachgefragt wird (null = keine Frage offen). */
  readonly frage = signal<SystemAktion | null>(null)

  readonly schrauben = signal<{ id: string; titel: string; hinweis: string; werte: string[] }[]>([])

  /** Läuft gerade eine Neulade-Anforderung? Sperrt nur den einen Knopf. */
  readonly neuladenLaeuft = signal(false)

  /**
   * Die Aktionen, die die Box wegnehmen — die einzigen, die diese Seite noch
   * zeigt.
   *
   * Die sanfte Haelfte bestand aus genau einer Aktion („Medien neu einlesen"),
   * und die steht seit dem 03.08.2026 auf der Medienseite. Ein Filter auf
   * `bereich !== 'medien'` waere hier eine zweite Meinung darueber, was wohin
   * gehoert; gefragt wird stattdessen nach dem, was diese Seite ausmacht.
   */
  readonly harte = computed(() => this.lage()?.aktionen.filter((a) => a.einschneidend) ?? [])

  /**
   * Die Laufzeit — GENOMMEN, NICHT GERECHNET.
   *
   * Hier stand bis zum 19.09.2026 eine eigene Umrechnung aus
   * `laufzeitSekunden`. Sie war die Kopie von `laufzeitText` (backend-api,
   * src/system.ts) — nur ohne dessen erste Zeile, den Wächter gegen negative
   * und nicht-endliche Werte. Statt „unbekannt" sagte sie durch `?? 0` dann
   * „0 min": eine fehlende Auskunft, die aussah wie eine Messung.
   *
   * Der Server schickt den fertigen Satz seit demselben Tag mit
   * (server.ts:5540). Damit entscheidet EINE geprüfte Stelle über die
   * Grenzfälle, und diese Seite prüft nur noch, ob etwas ankam.
   */
  readonly laufzeit = computed(() => textOderUnbekannt(this.lage()?.laufzeit))

  readonly speicherProzent = computed(() => {
    const l = this.lage()
    if (!l || !l.speicherGesamt) return 0
    return Math.round(((l.speicherGesamt - l.speicherFrei) / l.speicherGesamt) * 100)
  })

  readonly speicherText = computed(() => {
    const l = this.lage()
    if (!l) return '–'
    return `${this.groesse(l.speicherGesamt - l.speicherFrei)} / ${this.groesse(l.speicherGesamt)}`
  })

  readonly lastText = computed(() => {
    const l = this.lage()
    if (!l?.last?.length) return '–'
    return l.last.map((x) => x.toFixed(2)).join(' · ')
  })

  readonly platteKnapp = computed(() => (this.lage()?.platte?.prozent ?? 0) >= 90)

  constructor() {
    void this.laden()
    void this.schraubenLesen()
  }

  private async schraubenLesen(): Promise<void> {
    try {
      const a = await firstValueFrom(
        this.http.get<{ schrauben: { id: string; titel: string; hinweis: string; werte: string[] }[] }>(
          '/api/schrauben',
        ),
      )
      this.schrauben.set(a.schrauben)
    } catch {
      this.schrauben.set([])
    }
  }

  async schraubeSetzen(
    s: { id: string; titel: string },
    wert: string,
  ): Promise<void> {
    if (!wert) return
    this.fehler.set('')
    try {
      await firstValueFrom(this.http.post(`/api/schrauben/${s.id}`, { wert }))
      this.getan.set(`${s.titel}: auf „${wert}" gesetzt.`)
    } catch (e) {
      const g = (e as { error?: { error?: string } })?.error?.error
      this.fehler.set(`${s.titel}: ${g || 'fehlgeschlagen'}`)
    }
  }

  private async laden(): Promise<void> {
    this.laedt.set(true)
    try {
      this.lage.set(await this.api.lage())
    } catch {
      this.lage.set(null)
    } finally {
      this.laedt.set(false)
    }
  }

  groesse(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '–'
    const e = ['B', 'kB', 'MB', 'GB', 'TB']
    let i = 0
    let z = bytes
    while (z >= 1024 && i < e.length - 1) {
      z /= 1024
      i++
    }
    return `${z.toFixed(z < 10 && i > 0 ? 1 : 0)} ${e[i]}`
  }

  bestaetigen(): void {
    const a = this.frage()
    this.frage.set(null)
    if (a) void this.ausloesen(a)
  }

  /**
   * Die Box bitten, ihre Oberflaeche neu zu laden.
   *
   * Geht NICHT ueber die Aktionen-Tabelle (siehe Kommentar in der Vorlage):
   * der Endpunkt fuehrt keinen Befehl aus, sondern erhoeht einen Zaehler, den
   * die Box-Oberflaeche ohnehin abfragt. Sie entscheidet dann selbst und laedt
   * hoechstens einmal je Aenderung.
   */
  async oberflaecheNeuladen(): Promise<void> {
    if (this.neuladenLaeuft()) return
    this.neuladenLaeuft.set(true)
    this.fehler.set('')
    this.getan.set('')
    try {
      await firstValueFrom(this.http.post('/api/oberflaeche/neuladen', {}))
      this.getan.set('Angefordert — die Box lädt binnen weniger Sekunden neu.')
    } catch {
      this.fehler.set('Die Box hat die Anforderung nicht angenommen.')
    } finally {
      this.neuladenLaeuft.set(false)
    }
  }

  async ausloesen(a: SystemAktion): Promise<void> {
    if (this.laeuft()) return
    this.laeuft.set(a.id)
    this.fehler.set('')
    this.getan.set('')
    const e = await this.api.ausloesen(a.id)
    this.laeuft.set('')
    if (e.ok) {
      this.getan.set(
        a.einschneidend
          ? `${a.titel}: Die Box führt das jetzt aus. Diese Seite ist gleich nicht mehr erreichbar.`
          : `${a.titel}: erledigt.`,
      )
      if (!a.einschneidend) void this.laden()
      return
    }
    // Bei Neustart/Herunterfahren ist ein Abriss zu ERWARTEN — die Box nimmt
    // den antwortenden Prozess mit. Das als Fehler zu melden wäre falsch.
    if (a.einschneidend) {
      this.getan.set(`${a.titel}: ausgelöst. Die Box ist gleich nicht mehr erreichbar.`)
      return
    }
    this.fehler.set(`${a.titel}: ${e.grund}`)
  }
}
