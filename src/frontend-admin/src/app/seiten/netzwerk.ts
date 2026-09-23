/**
 * Die Netzwerkseite.
 *
 * Sie beantwortet zuerst die Frage, mit der man hierherkommt: „Unter welcher
 * Adresse erreiche ich die Box?" — deshalb steht die IP-Adresse oben und groß,
 * nicht in einer Tabelle unter ferner liefen.
 *
 * Beim WLAN-Formular ist die Warnung kein Zierrat: auf der Box holt ein
 * Hintergrunddienst den Eintrag nach etwa zwei Sekunden ab und startet die
 * Funkverbindung neu. Wer die Verwaltung GERADE über dieses WLAN bedient,
 * verliert die Seite dabei kurz. Das vorher zu sagen ist der Unterschied
 * zwischen „kurz weg" und „kaputt".
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { knopflage, rueckfrage } from '../funk-text'
import {
  type FunkAntwort,
  type Funklage,
  type Funknetz,
  // E115 (31.08.2026): gespeicherte Netze per Klick, ohne Passwort.
  type GespeichertesNetz,
  type Netzlage,
  NetzwerkDienst,
} from '../netzwerk.dienst'

@Component({
  selector: 'mupi-netzwerk',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 1.2rem; }
    h2 { font-size: 1.02rem; margin: 2rem 0 0.7rem; }
    .karte {
      background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 12px; padding: 1rem 1.1rem;
    }
    .adresse { font-size: 1.6rem; font-family: ui-monospace, monospace; margin: 0.2rem 0; }
    .klein { color: var(--gedaempft); font-size: 0.88rem; }
    .funk { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.9rem;
            padding-top: 0.9rem; border-top: 1px solid var(--rand); flex-wrap: wrap; }
    .balken { display: inline-flex; gap: 2px; align-items: flex-end; height: 1rem; }
    .balken i { width: 4px; background: var(--rand); border-radius: 1px; display: block; }
    .balken i:nth-child(1) { height: 35%; }
    .balken i:nth-child(2) { height: 65%; }
    .balken i:nth-child(3) { height: 100%; }
    .balken.gut i { background: var(--gut); }
    .balken.mittel i:nth-child(-n+2) { background: var(--warn); }
    .balken.schwach i:nth-child(1) { background: var(--fehler); }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--rand); }
    th { color: var(--gedaempft); font-weight: 500; }
    td.mono { font-family: ui-monospace, monospace; }
    .aus { color: var(--gedaempft); }
    form { display: grid; gap: 0.8rem; max-width: 26rem; }
    label { font-size: 0.9rem; color: var(--gedaempft); display: block; margin-bottom: 0.35rem; }
    .meldung { padding: 0.75rem 0.9rem; border-radius: 10px; font-size: 0.9rem; }
    .meldung.fehler { background: color-mix(in srgb, var(--fehler) 18%, transparent); color: var(--fehler); }
    .meldung.hinweis { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
    .meldung.gut { background: color-mix(in srgb, var(--gut) 16%, transparent); color: var(--gut); }
    .netze { list-style: none; padding: 0; margin: 0.8rem 0 0; max-width: 34rem; }
    .netze li { border-bottom: 1px solid var(--rand); }
    .netze button.netz {
      display: flex; align-items: center; gap: 0.7rem; width: 100%;
      background: none; border: 0; padding: 0.6rem 0.4rem; cursor: pointer;
      text-align: left; color: inherit; font: inherit;
    }
    .netze button.netz:hover { background: color-mix(in srgb, var(--rand) 40%, transparent); }
    .netze button.netz[aria-pressed='true'] { background: color-mix(in srgb, var(--gut) 14%, transparent); }
    .netz .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .netz .marke { font-size: 0.8rem; color: var(--gedaempft); }
    .netz .schloss { font-size: 0.95rem; }
    .wps-marke {
      font-size: 0.72rem; border: 1px solid var(--rand); border-radius: 999px;
      padding: 0.05rem 0.45rem; color: var(--gedaempft);
    }
    .netze.gespeichert li {
      display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 0.4rem; flex-wrap: wrap;
    }
    .netze.gespeichert .name { flex: 1 1 8rem; overflow: hidden; text-overflow: ellipsis; }
    .netze.gespeichert .marke { font-size: 0.8rem; color: var(--gedaempft); }
    .netze.gespeichert .marke.jetzt { color: var(--gut); }
    .netze.gespeichert .knoepfe { display: flex; gap: 0.4rem; }
    .zeile { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
    .schalter { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap;
                padding: 0.75rem 0; border-bottom: 1px solid var(--rand); }
    .schalter:last-child { border-bottom: 0; padding-bottom: 0; }
    .schalter .name { font-weight: 500; min-width: 7.5rem; }
    .schalter .rest { flex: 1 1 12rem; color: var(--gedaempft); font-size: 0.88rem; }
    .gesperrt { color: var(--gedaempft); font-size: 0.88rem; flex: 1 1 100%; }
  `,
  template: `
    <h1>Netzwerk</h1>

    @if (laedt()) {
      <p class="klein">Einen Moment…</p>
    } @else if (lage(); as l) {
      <div class="karte">
        <div class="klein">Die Box ist erreichbar unter</div>
        @if (hauptadresse(); as a) {
          <p class="adresse">{{ a }}</p>
        } @else {
          <p class="adresse aus">keine Adresse</p>
        }
        <div class="klein">Name im Netz: {{ l.hostname }}</div>

        @if (l.wlan; as w) {
          <div class="funk">
            <span class="balken" [class]="l.stufe"><i></i><i></i><i></i></span>
            <span>{{ w.ssid || 'unbekanntes Netz' }}</span>
            <span class="klein">{{ funkText(l) }}</span>
          </div>
        } @else if (l.funkAktiv) {
          <div class="funk klein">
            Funk ist aktiv, die Einzelheiten sind aber nicht auslesbar.
          </div>
        } @else {
          <div class="funk klein">Keine WLAN-Verbindung (oder per Kabel verbunden).</div>
        }
      </div>

      <!-- WLAN-Adapter: eingebaut oder USB-Stecker. Steht VOR den Anschluessen,
           weil es die Frage davor beantwortet: WORUEBER die Box funkt. -->
      <h2>WLAN-Adapter</h2>
      @if (adapter(); as ad) {
        <p class="klein">
          Der Pi hat <strong>einen</strong> Funkbaustein für WLAN und Bluetooth. Läuft die Musik
          über WLAN herein und über Bluetooth wieder hinaus, teilen sich beide denselben Chip —
          das ist die häufigste Ursache für stockenden Bluetooth-Ton. Ein WLAN-Stick am USB nimmt
          das WLAN davon herunter — ein Bluetooth-Dongle umgekehrt das Bluetooth (Bluetooth-Seite).
        </p>
        <div class="stufe">
          <button type="button" [class.an]="ad.aktiv === 'intern'"
                  [disabled]="schaltet() || ad.aktiv === 'intern'" (click)="adapterWaehlen('intern')">
            Eingebaut{{ ad.intern.adresse ? ' · ' + ad.intern.adresse : '' }}
          </button>
          <button type="button" [class.an]="ad.aktiv === 'extern'"
                  [disabled]="schaltet() || !ad.extern.da || ad.aktiv === 'extern'"
                  (click)="adapterWaehlen('extern')">
            WLAN-Stick{{ ad.extern.da ? (ad.extern.adresse ? ' · ' + ad.extern.adresse : '') : ' — keiner gefunden' }}
          </button>
        </div>
        @if (adapterHinweis()) {
          <p class="klein warn">{{ adapterHinweis() }}</p>
        }
      } @else {
        <p class="klein">Adapter werden gelesen …</p>
      }

      <!-- Funk an und aus. Steht NACH dem Adapter, weil es die haertere
           Sache ist: der Adapterwechsel gibt der Box eine andere Adresse,
           das Abschalten nimmt ihr den Weg. -->
      <h2>Funk an und aus</h2>
      @if (funk(); as f) {
        <div class="karte">
          <div class="schalter">
            <span class="name">Bluetooth</span>
            <span class="rest">{{ btText(f) }}</span>
            @if (f.bluetooth.vorhanden) {
              <button type="button" [disabled]="funkSchaltet()" (click)="btSchalten(!f.bluetooth.an)">
                {{ f.bluetooth.an ? 'Ausschalten' : 'Einschalten' }}
              </button>
            }
          </div>

          <div class="schalter">
            <span class="name">WLAN</span>
            <span class="rest">{{ wlanText(f) }}</span>
            @if (!f.wlan.an) {
              <!-- Einschalten ist nie gefaehrlich — und der Weg zurueck muss
                   immer offenstehen. -->
              <button type="button" [disabled]="funkSchaltet()" (click)="wlanAn()">Einschalten</button>
            } @else if (knopf().knopf) {
              <button type="button" [disabled]="funkSchaltet()" (click)="wlanAusFragen()">Ausschalten</button>
            } @else {
              <!-- KEIN Knopf. Ein Knopf, der 409 kassiert, sieht aus wie ein
                   Fehler der Box — dabei ist es der Schutz vorm Aussperren. -->
              <span class="gesperrt">{{ knopf().satz }}</span>
            }
          </div>

          <div class="schalter">
            <span class="name">Flugmodus</span>
            <span class="rest">
              {{ f.flug ? 'an — beides ist aus' : 'aus — Bluetooth und WLAN zusammen abschalten' }}
            </span>
            @if (f.flug) {
              <button type="button" [disabled]="funkSchaltet()" (click)="flugAus()">Beenden</button>
            } @else if (knopf().knopf) {
              <button type="button" [disabled]="funkSchaltet()" (click)="flugAnFragen()">Einschalten</button>
            } @else {
              <span class="gesperrt">{{ knopf().satz }}</span>
            }
          </div>
        </div>

        @if (funkFrage()) {
          <div class="meldung hinweis">
            {{ funkFrage() }}
            <div class="zeile" style="margin-top:0.6rem">
              <button type="button" (click)="funkJa()" [disabled]="funkSchaltet()">Ja, abschalten</button>
              <button type="button" (click)="funkNein()" [disabled]="funkSchaltet()">Abbrechen</button>
            </div>
          </div>
        }
        @if (funkHinweis()) {
          <div class="meldung hinweis">{{ funkHinweis() }}</div>
        }
        @if (funkFehler()) {
          <div class="meldung fehler">{{ funkFehler() }}</div>
        }
      } @else {
        <p class="klein">Der Funkzustand wird gelesen …</p>
      }

      <h2>Anschlüsse</h2>
      @if (l.schnittstellen.length === 0) {
        <p class="klein">Keine Anschlüsse gefunden.</p>
      } @else {
        <table>
          <thead>
            <tr><th>Anschluss</th><th>Zustand</th><th>Adressen</th></tr>
          </thead>
          <tbody>
            @for (s of l.schnittstellen; track s.name) {
              <tr>
                <td class="mono">{{ s.name }}{{ s.funk ? ' (Funk)' : '' }}</td>
                <td [class.aus]="!s.aktiv">{{ s.aktiv ? 'aktiv' : 'aus' }}</td>
                <td class="mono">
                  @if (s.adressen.length === 0) {
                    <span class="aus">–</span>
                  } @else {
                    {{ adressText(s.adressen) }}
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    } @else {
      <div class="meldung fehler">Der Netzwerkzustand ließ sich nicht lesen.</div>
    }

    <!-- ══ GESPEICHERTE NETZE (E115, 31.08.2026) ═══════════════════════════
         Betreiber woertlich: „was wir unbedingt noch einbauen muessen ist ein
         'netzwerk manager' das man bei gespeicherten verbindungen einfach
         verbinden klicken kann. das geht nicht ueber die box es ist immer ein
         passwort erforderlich."

         Der Abschnitt steht VOR „WLAN einrichten", und das ist die ganze
         Aussage der Reihenfolge: wer hierherkommt, weil das Netz wackelt,
         soll zuerst sehen, was die Box schon kennt — und nicht erst ein
         Formular, das ein Passwort verlangt, das sie laengst hat. -->
    <h2>Gespeicherte Netze</h2>
    <p class="klein">
      Diese Netze kennt die Box schon — Passwort liegt vor. Ein Klick auf
      „Verbinden" wechselt dorthin, ohne dass etwas eingetippt werden muss.
    </p>

    @if (gespeichertLaedt()) {
      <p class="klein">Wird gelesen …</p>
    } @else if (gespeicherte().length === 0) {
      <p class="klein">
        Die Box hat noch kein WLAN gespeichert. Unten unter „WLAN einrichten"
        das erste einrichten.
      </p>
    } @else {
      <ul class="netze gespeichert">
        @for (n of gespeicherte(); track n.id) {
          <li>
            <span class="name">{{ n.ssid }}</span>
            @if (n.aktuell) {
              <span class="marke jetzt">verbunden</span>
            } @else if (n.abgeschaltet) {
              <span class="marke">abgeschaltet</span>
            }
            <span class="knoepfe">
              <button
                type="button"
                [disabled]="n.aktuell || gespeichertTut()"
                (click)="gespeichertVerbinden(n)"
              >
                Verbinden
              </button>
              <!-- Vergessen ist die einzige Tat auf dieser Seite, die etwas
                   WEGNIMMT: das Passwort ist danach fort und muss neu getippt
                   werden. Deshalb eine Rueckfrage, und deshalb steht der Name
                   des Netzes darin. -->
              <button
                type="button"
                [disabled]="gespeichertTut()"
                (click)="vergessenFragen(n)"
              >
                Vergessen
              </button>
            </span>
          </li>
        }
      </ul>
    }

    @if (vergessenFrage(); as v) {
      <div class="meldung hinweis">
        „{{ v.ssid }}" wirklich vergessen? Das Passwort ist danach weg und muss
        beim nächsten Mal neu eingegeben werden.
        <div class="zeile" style="margin-top:0.6rem">
          <button type="button" [disabled]="gespeichertTut()" (click)="vergessenJa()">
            Ja, vergessen
          </button>
          <button type="button" [disabled]="gespeichertTut()" (click)="vergessenNein()">
            Abbrechen
          </button>
        </div>
      </div>
    }
    @if (gespeichertHinweis()) {
      <div class="meldung hinweis">{{ gespeichertHinweis() }}</div>
    }
    @if (gespeichertFehler()) {
      <div class="meldung fehler">{{ gespeichertFehler() }}</div>
    }

    <h2>WLAN einrichten</h2>

    <div class="zeile">
      <button type="button" (click)="suchen()" [disabled]="sucht() || sendet()">
        {{ sucht() ? 'Suche läuft…' : 'Netze suchen' }}
      </button>
      <button type="button" (click)="wpsStarten()" [disabled]="sucht() || sendet()">
        WPS-Knopf
      </button>
      @if (sucht()) {
        <span class="klein">Der Funkscan dauert einige Sekunden.</span>
      }
    </div>

    @if (wpsLaeuft()) {
      <div class="meldung hinweis">
        WPS läuft. Drücke jetzt den WPS-Knopf am Router — die Box verbindet
        sich dann von selbst. Das Fenster ist etwa zwei Minuten offen.
      </div>
    }

    @if (netze().length) {
      <ul class="netze">
        @for (n of netze(); track n.ssid) {
          <li>
            <button
              type="button"
              class="netz"
              [attr.aria-pressed]="ssid === n.ssid"
              [disabled]="n.sicherheit === 'wpa-enterprise'"
              (click)="waehlen(n)"
            >
              <span class="balken" [class]="n.stufe"><i></i><i></i><i></i></span>
              <span class="name">{{ n.ssid }}</span>
              @if (n.wps) { <span class="wps-marke">WPS</span> }
              <span class="schloss">{{ n.sicherheit === 'offen' ? '' : '🔒' }}</span>
              <span class="marke">{{ marke(n) }}</span>
            </button>
          </li>
        }
      </ul>
    }

    <div class="meldung hinweis">
      Die Box übernimmt das Netz nach wenigen Sekunden und startet die
      Funkverbindung neu. Wenn du diese Seite <em>über WLAN</em> bedienst, ist
      sie dabei kurz nicht erreichbar.
    </div>

    <form (ngSubmit)="absenden()">
      <div>
        <label for="ssid">Netzwerkname (SSID)</label>
        <input id="ssid" name="ssid" type="text" [(ngModel)]="ssid" [disabled]="sendet()" />
      </div>
      <div>
        <label for="psk">
          Passwort <span class="klein">(leer lassen für ein offenes Netz)</span>
        </label>
        <input
          id="psk"
          name="psk"
          type="password"
          autocomplete="off"
          [(ngModel)]="psk"
          [disabled]="sendet()"
        />
      </div>
      <div>
        <button type="submit" [disabled]="sendet() || !ssid">
          {{ sendet() ? 'Wird übernommen…' : 'WLAN übernehmen' }}
        </button>
      </div>
      @if (fehler(); as f) {
        <div class="meldung fehler">{{ f }}</div>
      }
      @if (erfolg()) {
        <div class="meldung gut">
          Übernommen. Die Box verbindet sich in den nächsten Sekunden neu.
        </div>
      }
    </form>

    <!-- SEIT DER SELBSTBESTAETIGUNG (14.08.2026) VERSPRICHT DER KASTEN NICHT
         MEHR DAS FALSCHE: vorher stand hier, man MUESSE binnen der Frist
         bestaetigen, sonst werde zurueckgerollt — und genau der gelungene
         Wechsel machte das oft unmoeglich (neue Adresse der Box, Handy noch
         im alten Netz): das Passwort war dann trotz Erfolg nie gespeichert.
         Jetzt prueft die Box selbst und speichert von allein; der Knopf ist
         die Abkuerzung. Laeuft der Zaehler ab, holt die Seite den AUSGANG
         beim Server ab, statt zu schweigen. -->
    @if (bestaetigenRest() > 0) {
      <div class="meldung hinweis">
        <strong>Wird geprüft.</strong> Die Box hat das neue Netz übernommen und
        prüft selbst, ob es trägt — dann speichert sie von allein (spätestens
        in <strong>{{ bestaetigenRest() }} s</strong> fällt die Entscheidung).
        Trägt es nicht, stellt sie das vorherige Netz wieder her. Bestätigen
        kürzt ab:
        <div class="zeile" style="margin-top:0.6rem">
          <button type="button" (click)="bestaetigen()">Verbindung bestätigen</button>
        </div>
      </div>
    }
    @if (bestaetigt()) {
      <div class="meldung gut">{{ ausgangText() }}</div>
    }
  `,
})
export class NetzwerkSeite {
  private readonly api = inject(NetzwerkDienst)

  readonly lage = signal<Netzlage | null>(null)
  readonly laedt = signal(true)
  readonly fehler = signal('')
  readonly erfolg = signal(false)
  readonly sendet = signal(false)

  readonly netze = signal<Funknetz[]>([])
  readonly sucht = signal(false)
  readonly wpsLaeuft = signal(false)
  readonly bestaetigenRest = signal(0)
  readonly bestaetigt = signal(false)
  readonly ausgangText = signal('Bestätigt — die Einstellung ist jetzt dauerhaft.')
  private uhr: ReturnType<typeof setInterval> | null = null

  readonly adapter = signal<{
    aktiv: string
    intern: { da: boolean; oben: boolean; adresse: string }
    extern: { da: boolean; oben: boolean; adresse: string }
  } | null>(null)
  readonly schaltet = signal(false)
  readonly adapterHinweis = signal('')

  private async adapterLesen(): Promise<void> {
    try {
      const r = await fetch('/api/wlan-adapter', { cache: 'no-store' })
      if (r.ok) this.adapter.set(await r.json())
    } catch {
      /* dann bleibt die letzte Anzeige stehen */
    }
  }

  /**
   * Umschalten — und dabei ehrlich sagen, was passiert.
   *
   * Die Box bekommt eine ANDERE Adresse (andere Hardware-Adresse, anderer
   * DHCP-Eintrag). Diese Seite verliert damit ihre Verbindung. Das laesst
   * sich nicht vermeiden, also wird die neue Adresse vorher genannt, statt
   * den Benutzer suchen zu lassen.
   */
  protected async adapterWaehlen(ziel: 'intern' | 'extern'): Promise<void> {
    // Keine Rueckfrage — aber die Folge MUSS vorher dastehen, denn diese ist
    // nicht harmlos: die Box bekommt eine andere Adresse, und diese Seite
    // verliert ihre Verbindung. Deshalb wird die neue Adresse zuerst
    // angezeigt und erst dann umgeschaltet.
    const ad = this.adapter()
    const neueAdresse = (ziel === 'extern' ? ad?.extern.adresse : ad?.intern.adresse) || ''
    this.schaltet.set(true)
    this.adapterHinweis.set(
      neueAdresse
        ? `Schalte um — die Box ist danach unter http://${neueAdresse}/admin erreichbar. Diese Seite verliert gleich die Verbindung.`
        : 'Schalte um — die Box bekommt eine andere Adresse. Diese Seite verliert gleich die Verbindung.',
    )
    try {
      const r = await fetch('/api/wlan-adapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter: ziel }),
      })
      const d = await r.json()
      this.adapterHinweis.set(
        r.ok
          ? `Umgeschaltet. Neue Adresse: http://${d.adresse || '<siehe Router>'}/admin`
          : `Fehlgeschlagen: ${d.error ?? 'unbekannt'}`,
      )
    } catch {
      this.adapterHinweis.set(
        'Die Box antwortet nicht mehr — beim Umschalten normal. Unter der neuen Adresse weitermachen.',
      )
    } finally {
      this.schaltet.set(false)
    }
  }


  // ── Funk an und aus ────────────────────────────────────────────────────
  //
  // Die Bedingung („WLAN aus nur, wenn die Box danach noch erreichbar ist")
  // wird hier NICHT nachgerechnet. Sie kommt als `ausErlaubt` aus /api/funk,
  // und dort steht sie auch wirklich — diese Seite zeigt sie nur an. Alles
  // andere waere eine Regel, die man mit einem HTTP-Aufruf umgeht.
  readonly funk = signal<Funklage | null>(null)
  readonly funkSchaltet = signal(false)
  readonly funkHinweis = signal('')
  readonly funkFehler = signal('')
  readonly funkFrage = signal('')
  /** Was passiert, wenn die Rueckfrage mit „Ja" beantwortet wird. */
  private funkTat: (() => Promise<void>) | null = null

  readonly knopf = computed(() => knopflage(this.funk()))

  private async funkLesen(): Promise<void> {
    try {
      this.funk.set(await this.api.funklage())
    } catch {
      /* dann bleibt die letzte Anzeige stehen — falsche Angaben sind schlimmer */
    }
  }

  protected btText(f: Funklage): string {
    if (!f.bluetooth.vorhanden) return 'kein Adapter gefunden'
    return f.bluetooth.an
      ? 'an — der gekoppelte Lautsprecher wird beim Abschalten getrennt'
      : 'aus'
  }

  protected wlanText(f: Funklage): string {
    if (!f.wlan.vorhanden) return 'keine WLAN-Schnittstelle'
    if (!f.wlan.an) return `aus (${f.wlan.name})`
    return f.wlan.adresse ? `an — ${f.wlan.adresse} (${f.wlan.name})` : `an (${f.wlan.name})`
  }

  /**
   * Wie lange nach einem ABSCHALTEN gewartet wird, bevor der Zustand neu
   * gelesen wird.
   *
   * Der Server antwortet beim Abschalten SOFORT und schaltet erst danach —
   * er muss, sonst kappt der Befehl die Antwort. Wer gleich darauf `/api/funk`
   * liest, bekommt deshalb noch das alte Bild („WLAN an") und haelt das
   * Abschalten fuer misslungen. Etwas mehr als die Verzoegerung des Servers.
   */
  private static readonly NACHLAUF_MS = 2000

  /** Einschalten fragt nie nach: der Weg zurueck muss immer offenstehen. */
  protected async wlanAn(): Promise<void> {
    await this.funkTun(() => this.api.wlanSchalten(true))
  }

  protected async flugAus(): Promise<void> {
    await this.funkTun(() => this.api.flugSchalten(false))
  }

  protected wlanAusFragen(): void {
    const f = this.funk()
    if (!f) return
    this.funkFehler.set('')
    this.funkHinweis.set('')
    this.funkFrage.set(rueckfrage(f, 'WLAN'))
    this.funkTat = () =>
      this.funkTun(() => this.api.wlanSchalten(false, this.knopf().vorOrt), NetzwerkSeite.NACHLAUF_MS)
  }

  protected flugAnFragen(): void {
    const f = this.funk()
    if (!f) return
    this.funkFehler.set('')
    this.funkHinweis.set('')
    this.funkFrage.set(rueckfrage(f, 'Flugmodus'))
    this.funkTat = () =>
      this.funkTun(() => this.api.flugSchalten(true, this.knopf().vorOrt), NetzwerkSeite.NACHLAUF_MS)
  }

  protected async funkJa(): Promise<void> {
    const tat = this.funkTat
    this.funkFrage.set('')
    this.funkTat = null
    if (tat) await tat()
  }

  protected funkNein(): void {
    this.funkFrage.set('')
    this.funkTat = null
  }

  protected async btSchalten(an: boolean): Promise<void> {
    await this.funkTun(() => this.api.bluetoothSchalten(an))
  }

  private async funkTun(tat: () => Promise<FunkAntwort>, nachlaufMs = 0): Promise<void> {
    this.funkSchaltet.set(true)
    this.funkFehler.set('')
    this.funkHinweis.set('')
    try {
      const a = await tat()
      if (a.ok) this.funkHinweis.set(a.hinweis)
      else this.funkFehler.set(a.grund)
    } finally {
      // Der Nachlauf gehoert VOR das Freigeben der Knoepfe: sonst kann in
      // genau dem Fenster, in dem der Server noch schaltet, schon der
      // Gegenbefehl abgeschickt werden.
      if (nachlaufMs > 0) await new Promise((f) => setTimeout(f, nachlaufMs))
      this.funkSchaltet.set(false)
      // Nach jedem Schalten den Zustand neu holen. Er kann anders ausgefallen
      // sein als gewuenscht — behaupten waere hier das Schlimmste.
      await this.funkLesen()
    }
  }

  ssid = ''
  psk = ''

  /** Die eine Adresse, unter der man die Box wirklich aufruft: IPv4 zuerst. */
  readonly hauptadresse = computed(() => {
    const l = this.lage()
    if (!l) return ''
    for (const s of l.schnittstellen) {
      if (!s.aktiv) continue
      const v4 = s.adressen.find((a) => a.familie === 'v4')
      if (v4) return v4.adresse
    }
    return ''
  })

  // ── Gespeicherte Netze (E115, 31.08.2026) ──────────────────────────────
  //
  // Betreiber woertlich: „was wir unbedingt noch einbauen muessen ist ein
  // 'netzwerk manager' das man bei gespeicherten verbindungen einfach
  // verbinden klicken kann. das geht nicht ueber die box es ist immer ein
  // passwort erforderlich."
  //
  // DIE KENNUNGEN WERDEN NIE GEMERKT. wpa_supplicant vergibt sie nach einem
  // Vergessen und einem Neustart neu — eine im Browser stehengebliebene Zahl
  // waere spaeter ein Loeschbefehl auf ein ANDERES Netz. Deshalb wird die
  // Liste nach jeder Tat frisch geholt, statt sie hier fortzuschreiben.
  readonly gespeicherte = signal<GespeichertesNetz[]>([])
  readonly gespeichertLaedt = signal(true)
  readonly gespeichertTut = signal(false)
  readonly gespeichertFehler = signal('')
  readonly gespeichertHinweis = signal('')
  /** Welches Netz die Rueckfrage gerade betrifft — `null` heisst: keine Frage. */
  readonly vergessenFrage = signal<GespeichertesNetz | null>(null)

  private async gespeicherteLaden(): Promise<void> {
    this.gespeichertLaedt.set(true)
    const e = await this.api.gespeicherte()
    this.gespeichertLaedt.set(false)
    if (e.ok) {
      this.gespeicherte.set(e.netze)
      this.gespeichertFehler.set('')
    } else {
      // Die Liste NICHT leeren: „keine gespeicherten Netze" waere eine
      // Aussage, und zwar eine falsche. Die letzte gelesene stehenzulassen
      // und den Fehler danebenzuschreiben ist ehrlicher.
      this.gespeichertFehler.set(e.grund)
    }
  }

  protected async gespeichertVerbinden(n: GespeichertesNetz): Promise<void> {
    if (this.gespeichertTut()) return
    this.gespeichertTut.set(true)
    this.gespeichertFehler.set('')
    this.gespeichertHinweis.set('')
    this.bestaetigt.set(false)
    const e = await this.api.gespeichertVerbinden(n.id)
    this.gespeichertTut.set(false)
    if (!e.ok) {
      this.gespeichertFehler.set(e.grund)
      return
    }
    this.gespeichertHinweis.set(e.hinweis || `Wechsel auf „${e.ssid}" eingeleitet.`)
    // Derselbe Countdown wie beim Verbinden mit Passwort, und aus demselben
    // Grund: solange er laeuft, steht die Aenderung NUR im Arbeitsspeicher der
    // Box. Bleibt der Beweis aus, rollt sie zurueck — das soll sichtbar sein.
    if (e.bestaetigenBis > 0) this.uhrStarten(e.bestaetigenBis)
    if (!e.gesichert && !e.schonVerbunden)
      this.gespeichertFehler.set(
        'Achtung: Der Rückweg ließ sich nicht sichern. Bei einem Fehlschlag hilft nur ein Kabel.',
      )
    await this.gespeicherteLaden()
    void this.laden()
  }

  protected vergessenFragen(n: GespeichertesNetz): void {
    this.gespeichertFehler.set('')
    this.gespeichertHinweis.set('')
    this.vergessenFrage.set(n)
  }

  protected vergessenNein(): void {
    this.vergessenFrage.set(null)
  }

  protected async vergessenJa(): Promise<void> {
    const n = this.vergessenFrage()
    this.vergessenFrage.set(null)
    if (!n || this.gespeichertTut()) return
    this.gespeichertTut.set(true)
    const e = await this.api.gespeichertVergessen(n.id)
    this.gespeichertTut.set(false)
    if (!e.ok) {
      // Der 409 fuer das aktuelle Netz kommt woertlich vom Backend und sagt,
      // was stattdessen zu tun ist. Ihn durch ein eigenes „fehlgeschlagen" zu
      // ersetzen waere der Unterschied zwischen Hilfe und Achselzucken.
      this.gespeichertFehler.set(e.grund)
      return
    }
    this.gespeichertHinweis.set(`„${e.ssid}" ist vergessen.`)
    // Die Antwort traegt die neue Liste schon — trotzdem frisch holen, damit
    // hier nur eine Quelle die Wahrheit sagt.
    await this.gespeicherteLaden()
  }

  constructor() {
    void this.adapterLesen()
    void this.funkLesen()
    void this.gespeicherteLaden()
    void this.laden()
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

  /** Empfang, Feldstärke und Band in einer Zeile — dBm allein sagt Laien nichts. */
  funkText(l: Netzlage): string {
    const teile: string[] = []
    if (l.stufe === 'gut') teile.push('guter Empfang')
    else if (l.stufe === 'mittel') teile.push('brauchbarer Empfang')
    else if (l.stufe === 'schwach') teile.push('schwacher Empfang')
    if (l.wlan?.signal !== null && l.wlan?.signal !== undefined) teile.push(`${l.wlan.signal} dBm`)
    if (l.wlan?.frequenzMhz) teile.push(l.wlan.frequenzMhz >= 5000 ? '5 GHz' : '2,4 GHz')
    return teile.join(' · ')
  }

  adressText(a: { adresse: string; praefix: number }[]): string {
    return a.map((x) => `${x.adresse}/${x.praefix}`).join(', ')
  }

  /** Kurzer Beisatz je Netz: Band, Empfang, und wie viele Punkte es ausstrahlen. */
  marke(n: Funknetz): string {
    const teile: string[] = []
    if (n.band) teile.push(n.band)
    if (n.signalDbm !== null) teile.push(`${n.signalDbm} dBm`)
    if (n.punkte > 1) teile.push(`${n.punkte} Punkte`)
    if (n.sicherheit === 'wpa-enterprise') teile.push('Firmennetz — Passwort reicht nicht')
    return teile.join(' · ')
  }

  async suchen(): Promise<void> {
    if (this.sucht()) return
    this.sucht.set(true)
    this.fehler.set('')
    const e = await this.api.suchen()
    this.sucht.set(false)
    if (e.ok) this.netze.set(e.netze)
    else this.fehler.set(e.grund)
  }

  /**
   * Ein Netz aus der Liste uebernehmen.
   *
   * Bei einem OFFENEN Netz wird das Passwortfeld geleert — dort gibt es
   * keines, und ein stehengebliebener Rest waere schlimmer als ein leeres
   * Feld.
   */
  waehlen(n: Funknetz): void {
    if (n.sicherheit === 'wpa-enterprise') return
    this.ssid = n.ssid
    if (n.sicherheit === 'offen') this.psk = ''
  }

  async wpsStarten(): Promise<void> {
    this.fehler.set('')
    const e = await this.api.wps()
    if (!e.ok) {
      this.fehler.set(e.grund)
      return
    }
    this.wpsLaeuft.set(true)
    setTimeout(() => this.wpsLaeuft.set(false), e.fensterSek * 1000)
  }

  /** Den Countdown fuer die Bestaetigung laufen lassen — und dabei alle
   *  fuenf Sekunden nachsehen, ob die Box sich schon SELBST bestaetigt hat
   *  (dann ist der Zaehler Theater und verschwindet). Am Ende wird der
   *  Ausgang abgeholt statt geschwiegen. */
  private uhrStarten(sekunden: number): void {
    if (this.uhr) clearInterval(this.uhr)
    this.bestaetigenRest.set(sekunden)
    this.uhr = setInterval(() => {
      const rest = this.bestaetigenRest() - 1
      this.bestaetigenRest.set(Math.max(0, rest))
      if (rest <= 0 && this.uhr) {
        clearInterval(this.uhr)
        this.uhr = null
        void this.ausgangHolen(true)
        return
      }
      if (rest % 5 === 0) void this.ausgangHolen(false)
    }, 1000)
  }

  /** Beim Server nachsehen, wie der Wechsel ausging. `endgueltig` heisst:
   *  der Zaehler ist abgelaufen, ein fehlender Ausgang ist dann ein
   *  Rueckroll — und der wird gesagt, nicht verschluckt. */
  private async ausgangHolen(endgueltig: boolean): Promise<void> {
    const a = await this.api.wechselAusgang()
    if (a) {
      if (this.uhr) clearInterval(this.uhr)
      this.uhr = null
      this.bestaetigenRest.set(0)
      this.ausgangText.set(
        a.wie === 'selbst'
          ? 'Gespeichert — die Box hat das neue Netz selbst festgeschrieben.'
          : 'Bestätigt — die Einstellung ist jetzt dauerhaft.',
      )
      this.bestaetigt.set(true)
      void this.laden()
      return
    }
    if (endgueltig) {
      this.fehler.set(
        'Nicht gespeichert — die Box ist im neuen Netz nicht angekommen und hat den Wechsel zurückgerollt.',
      )
    }
  }

  async bestaetigen(): Promise<void> {
    const e = await this.api.bestaetigen()
    if (!e.ok) {
      this.fehler.set(e.grund)
      return
    }
    if (this.uhr) clearInterval(this.uhr)
    this.uhr = null
    this.bestaetigenRest.set(0)
    this.ausgangText.set('Bestätigt — die Einstellung ist jetzt dauerhaft.')
    this.bestaetigt.set(true)
    void this.laden()
  }

  async absenden(): Promise<void> {
    if (this.sendet() || !this.ssid) return
    this.sendet.set(true)
    this.fehler.set('')
    this.erfolg.set(false)
    this.bestaetigt.set(false)
    const e = await this.api.verbinden(this.ssid, this.psk)
    this.sendet.set(false)
    if (e.ok) {
      this.erfolg.set(true)
      // Das Passwort nicht im Feld stehen lassen — der nächste, der auf den
      // Bildschirm sieht, muss es nicht mitlesen können.
      this.psk = ''
      // Der Countdown ist kein Zierrat: solange er läuft, ist die Änderung
      // NUR im Arbeitsspeicher. Bleibt die Bestätigung aus, rollt die Box
      // zurück — und genau das soll sichtbar sein.
      if (e.bestaetigenBis > 0) this.uhrStarten(e.bestaetigenBis)
      if (!e.gesichert)
        this.fehler.set(
          'Achtung: Der Rückweg ließ sich nicht sichern. Bei einem Fehlschlag hilft nur ein Kabel.',
        )
      return
    }
    this.fehler.set(e.grund)
  }
}
