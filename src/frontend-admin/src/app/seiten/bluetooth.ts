/**
 * Die Bluetooth-Seite.
 *
 * Zwei Dinge, die den Unterschied zwischen brauchbar und ärgerlich ausmachen:
 *
 * 1. NAMENLOSE GERÄTE SIND VERSTECKT. Eine Suche findet auf der echten Box
 *    ein Dutzend Geräte, von denen die meisten nur ihre eigene Adresse als
 *    „Namen" tragen — Handys, Fitnessbänder, Werbe-Beacons. Wer seinen
 *    Lautsprecher zwischen zwanzig Zahlenreihen suchen muss, findet ihn nicht.
 *    Sie sind einblendbar, aber nicht im Weg.
 *
 * 2. KOPPELN IST EIN SCHRITT, NICHT DREI. Die alte Seite verlangte koppeln,
 *    vertrauen und verbinden einzeln und in der richtigen Reihenfolge — ohne
 *    „vertrauen" verbindet sich ein Lautsprecher nach dem Einschalten nie
 *    wieder von allein. Das macht der Server jetzt in einem Zug.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, type OnDestroy, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'

interface Geraet {
  mac: string
  name: string
  gekoppelt?: boolean
  verbunden?: boolean
  vertraut?: boolean
  art?: 'lautsprecher' | 'kopfhoerer' | 'telefon' | 'eingabe' | 'rechner' | 'unbekannt'
  namenlos?: boolean
  /** Ladezustand in Prozent — nur vorhanden, wenn das Geraet ihn selbst meldet. */
  akku?: number
  /** Ausgehandelter Audio-Codec (sbc, aptx, …) — nur bei verbundenem Tongeraet. */
  codec?: string
}

interface Funkadapter {
  name: string
  bezeichnung: string
  bus: string
  fassung: string
  mtu: number
  puffer: number
  kennung: string
  chip: string
  note: number
  urteil: string
  traegtTon: boolean
  an: boolean
}

interface Adapter {
  mac: string
  name: string
  an: boolean
  sucht: boolean
  sichtbar: boolean
}

@Component({
  selector: 'mupi-bluetooth',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.2rem; font-size: 0.94rem; }
    .kopf { display: flex; gap: 0.8rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.2rem; }
    .klein { color: var(--gedaempft); font-size: 0.88rem; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
    li {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.9rem 1rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
    }
    li.verbunden { border-color: var(--gut); }
    .zeichen { font-size: 1.4rem; width: 1.8rem; text-align: center; }
    .wer { flex: 1 1 14rem; min-width: 0; }
    .titel { font-weight: 500; overflow-wrap: anywhere; }
    .adresse { color: var(--gedaempft); font-size: 0.78rem; font-family: ui-monospace, monospace; }
    .marken { display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.2rem; }
    .marke {
      font-size: 0.72rem; padding: 0.1rem 0.45rem; border-radius: 999px;
      border: 1px solid var(--rand); color: var(--gedaempft);
    }
    .marke.an { border-color: var(--gut); color: var(--gut); }
    .marke.akku { font-variant-numeric: tabular-nums; }
    .marke.codec { border-color: var(--gut); color: var(--gut); text-transform: uppercase; }
    /* SBC ist der Pflicht-Codec: kein Fehler, aber auch kein Gewinn — deshalb
       neutral statt gruen. */
    .marke.codec.einfach { border-color: var(--rand); color: var(--gedaempft); }
    .marke.akku.leer { border-color: var(--schlecht, #eb445a); color: var(--schlecht, #eb445a); }
    .knoepfe { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .knoepfe button { padding: 0.45rem 0.8rem; font-size: 0.88rem; }
    button.gefahr { background: transparent; border: 1px solid var(--fehler); color: var(--fehler); }
    /* Der AKTIVE Ausgang. Vorher war er nur ein deaktivierter Knopf — und weil
       beide blau sind und der eingebaute „Eingebauter Lautsprecher" heisst,
       klickt man genau den und haelt die Seite fuer kaputt. Jetzt sieht man,
       dass er GEWAEHLT ist, nicht bloss tot. */
    .knoepfe button.aktiv,
    .knoepfe button.aktiv:disabled {
      background: transparent;
      border: 1px solid var(--gut);
      color: var(--gut);
      opacity: 1;
      cursor: default;
    }
    .meldung { padding: 0.75rem 0.9rem; border-radius: 10px; margin-bottom: 1rem; font-size: 0.9rem; }
    .meldung.fehler { background: color-mix(in srgb, var(--fehler) 18%, transparent); color: var(--fehler); }
    .meldung.gut { background: color-mix(in srgb, var(--gut) 16%, transparent); color: var(--gut); }
    .meldung.hinweis { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }

    /* Adapterwahl: dieselbe Formensprache wie auf der Darstellungsseite,
       damit ein Schalter ueberall gleich aussieht. */
    .stufe { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
    .stufe .was { min-width: 5rem; color: var(--gedaempft); font-size: 0.9rem; }
    .stufe button {
      min-height: 2.4rem; padding: 0 0.8rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
      font-size: 0.9rem; line-height: 1;
    }
    .stufe button.an { background: var(--gut); border-color: transparent; color: #fff; }
    .stufe button:disabled { opacity: 0.4; }
    p.hinweis { color: var(--gedaempft); font-size: 0.88rem; margin: 0.4rem 0 0.8rem; }
    p.hinweis.warn { color: var(--warn); }
    h2 { font-size: 1.02rem; margin: 2rem 0 0.5rem; }
    label.zeigen { display: inline-flex; gap: 0.35rem; align-items: center; font-size: 0.88rem; color: var(--gedaempft); }
    /* Funkadapter — die Tabelle soll auf einen Blick sagen, welcher Stecker
       den Ton trägt und ob ein besserer danebensteckt. */
    details.funk { margin: 0 0 1rem; border: 1px solid var(--rand, #24313f); border-radius: 10px; padding: 0.6rem 0.8rem; }
    details.funk > summary { cursor: pointer; font-weight: 600; }
    details.funk > summary .rat { color: var(--warnung, #e0a33a); font-weight: 400; margin-left: 0.5rem; }
    table.funktab { width: 100%; border-collapse: collapse; margin-top: 0.6rem; }
    table.funktab th { text-align: left; color: var(--gedaempft); font-size: 0.78rem; font-weight: 600; padding: 0.3rem 0.5rem; }
    table.funktab td { padding: 0.45rem 0.5rem; border-top: 1px solid var(--rand, #24313f); vertical-align: top; }
    table.funktab tr.laeuft { background: rgba(61, 194, 90, 0.07); }
    table.funktab tr.rat { background: rgba(224, 163, 58, 0.09); }
    table.funktab td.eng { color: var(--warnung, #e0a33a); }
    table.funktab tr.aus td { opacity: 0.55; }
    .marke.aus { background: var(--eingabe, #0e1720); color: var(--gedaempft); }
    .marke { display: inline-block; font-size: 0.72rem; padding: 0.05rem 0.4rem; border-radius: 999px; margin-left: 0.4rem; }
    .marke.gut { background: rgba(61, 194, 90, 0.18); color: var(--gut, #3dc25a); }
    .marke.rat { background: rgba(224, 163, 58, 0.18); color: var(--warnung, #e0a33a); }
    .balken { display: block; height: 6px; border-radius: 3px; background: var(--rand, #24313f); overflow: hidden; margin-bottom: 0.25rem; }
    .balken i { display: block; height: 100%; background: var(--gut, #3dc25a); }
    table.funktab .klein { display: block; color: var(--gedaempft); font-size: 0.78rem; line-height: 1.35; }
    details.funk .hinweis { color: var(--gedaempft); font-size: 0.85rem; line-height: 1.5; margin: 0.7rem 0 0; }
    details.funk code { background: var(--eingabe, #0e1720); padding: 0.05rem 0.35rem; border-radius: 4px; }

  `,
  template: `
    <h1>Bluetooth</h1>
    <p class="unter">Lautsprecher und Kopfhörer suchen, koppeln und verbinden.</p>

    @if (fehler(); as f) {
      <div class="meldung fehler">{{ f }}</div>
    }
    @if (getan(); as g) {
      <div class="meldung gut">{{ g }}</div>
    }

    @if (adapter(); as a) {
      @if (!a.an) {
        <div class="meldung hinweis">Das Bluetooth-Funkteil der Box ist ausgeschaltet.</div>
      }
      @if (funk().length > 1) {
        <!-- WOFÜR: der Ton lief hier über einen billigen Stecker mit 310 Byte
             je Paket, während ein besserer mit 1021 Byte ungenutzt daneben
             steckte — dreimal so viele Pakete für dieselbe Musik, und genau
             daran bricht die Übertragung zuerst. Sichtbar war das nirgends. -->
        <details class="funk" [open]="besser() !== ''">
          <summary>
            Funkadapter ({{ funk().length }})
            @if (besser()) { <span class="rat">ein besserer steckt schon drin</span> }
          </summary>
          <table class="funktab">
            <thead>
              <tr><th>Adapter</th><th>Bluetooth</th><th>Pakete</th><th>Eignung für Musik</th></tr>
            </thead>
            <tbody>
              @for (f of funk(); track f.name) {
                <tr [class.laeuft]="f.traegtTon" [class.rat]="f.name === besser()" [class.aus]="!f.an">
                  <td>
                    <b>{{ f.bezeichnung }}</b>
                    @if (f.traegtTon) { <span class="marke gut">trägt den Ton</span> }
                    @if (f.name === besser()) { <span class="marke rat">besser geeignet</span> }
                    @if (!f.an) { <span class="marke aus">aus</span> }
                    <span class="klein">{{ f.bus === 'UART' ? 'eingebaut' : 'USB' }}</span>
                  </td>
                  <td>{{ f.fassung || '—' }}</td>
                  <td [class.eng]="f.mtu > 0 && f.mtu < 400">
                    {{ f.mtu ? f.mtu + ' Byte' : '—' }}
                    <span class="klein">{{ f.puffer ? f.puffer + ' gleichzeitig' : '' }}</span>
                  </td>
                  <td>
                    @if (f.an) {
                      <span class="balken"><i [style.width.%]="f.note * 10"></i></span>
                    }
                    <span class="klein">{{ f.urteil }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          @if (besser()) {
            <p class="hinweis">
              Aussetzer beim Hören kommen oft von zu kleinen Paketen — dann muss für
              dieselbe Musik viel öfter gefunkt werden. Der Wechsel geschieht auf der
              Box mit <code>bt-wechsel --auf {{ besser() }}</code>; der Lautsprecher
              muss dabei anmeldebereit sein, und die bisherige Kopplung bleibt erhalten.
            </p>
          }
        </details>
      }

      <div class="kopf">
        <button type="button" [disabled]="beschaeftigt() !== ''" (click)="suchen()">
          {{ beschaeftigt() === 'suche' ? 'Sucht… (10 s)' : 'Geräte suchen' }}
        </button>
        <span class="klein">Adapter: {{ a.name }}</span>
        @if (versteckte() > 0) {
          <label class="zeigen">
            <input type="checkbox" [checked]="alleZeigen()" (change)="alleZeigen.set(!alleZeigen())" />
            {{ versteckte() }} namenlose Geräte einblenden
          </label>
        }
      </div>
    } @else if (!laedt()) {
      <div class="meldung fehler">
        Kein Bluetooth-Adapter gefunden. Hat die Box überhaupt Bluetooth, und läuft der Dienst?
      </div>
    }

    <!-- ALLE Adapter einzeln, nicht „eingebaut/USB": an dieser Box steckten
         zeitweise drei, davon zwei am USB — eine Zweiteilung traefe dann
         willkuerlich einen davon. -->
    @if (btAdapter(); as ba) {
      @if (ba.alle.length > 1) {
        <div class="stufe" style="margin-bottom:0.6rem">
          <span class="was">Adapter</span>
          @for (a of ba.alle; track a.hci) {
            <button type="button" [class.an]="a.hci === ba.aktiv"
                    [disabled]="btSchaltet() || a.hci === ba.aktiv"
                    [title]="a.mac + ' · ' + a.bus"
                    (click)="btAdapterWaehlen(a)">
              {{ adapterName(a) }}
            </button>
          }
        </div>
        <p class="hinweis">
          Der Pi teilt sich einen Funkbaustein zwischen WLAN und Bluetooth — die häufigste Ursache
          für stockenden Ton. Ein Dongle am USB nimmt Bluetooth davon herunter; hier gemessen:
          <strong>vorher rund 50 Funkfehler je Minute, mit Dongle null</strong>.
          <strong>Kopplungen gehören zum Adapter</strong>: auf einem neuen ist die Liste leer, bis
          der Lautsprecher dort einmal gekoppelt wurde.
        </p>
        @if (btAdapterHinweis()) { <p class="hinweis warn">{{ btAdapterHinweis() }}</p> }
      }
    }

    @if (laedt()) {
      <p class="klein">Einen Moment…</p>
    } @else if (sichtbare().length === 0) {
      <p class="klein">
        Noch keine Geräte. Schalte den Lautsprecher ein, bring ihn in den
        Koppel-Modus und drücke „Geräte suchen".
      </p>
    } @else {
      <ul>
        @for (g of sichtbare(); track g.mac) {
          <li [class.verbunden]="g.verbunden">
            <span class="zeichen">{{ zeichen(g) }}</span>
            <div class="wer">
              <div class="titel">{{ g.name }}</div>
              <div class="adresse">{{ g.mac }}</div>
              <div class="marken">
                @if (g.verbunden) { <span class="marke an">verbunden</span> }
                <!-- Nur wenn gemeldet: die meisten Lautsprecher am Netzteil
                     sagen nichts dazu, und ein leerer Balken waere eine
                     Behauptung statt einer Auskunft. -->
                @if (g.akku !== undefined) {
                  <span class="marke akku" [class.leer]="g.akku <= 20">🔋 {{ g.akku }} %</span>
                }
                <!-- Der Codec sagt, WIE gut der Ton uebertragen wird. SBC kann
                     jedes Geraet und ist das anfaelligste; aptX/AAC/LDAC sind
                     besser. Nur bei verbundenen Geraeten vorhanden — vorher
                     ist nichts ausgehandelt. -->
                @if (g.codec) {
                  <span class="marke codec" [class.einfach]="g.codec === 'sbc'">{{ codecName(g.codec) }}</span>
                }
                @if (g.gekoppelt) { <span class="marke">gekoppelt</span> }
                @if (g.vertraut) { <span class="marke">vertraut</span> }
              </div>
            </div>
            <span class="knoepfe">
              @if (!g.gekoppelt) {
                <button type="button" [disabled]="beschaeftigt() !== ''" (click)="tun(g, 'koppeln')">
                  {{ beschaeftigt() === g.mac ? 'Läuft…' : 'Koppeln' }}
                </button>
              } @else if (g.verbunden) {
                <button type="button" class="still" [disabled]="beschaeftigt() !== ''" (click)="tun(g, 'trennen')">
                  Trennen
                </button>
              } @else {
                <button type="button" [disabled]="beschaeftigt() !== ''" (click)="tun(g, 'verbinden')">
                  Verbinden
                </button>
              }
              @if (g.gekoppelt || g.vertraut) {
                <button type="button" class="gefahr" [disabled]="beschaeftigt() !== ''" (click)="tun(g, 'entfernen')">
                  Entfernen
                </button>
              }
            </span>
          </li>
        }
      </ul>
    }

    <!-- DIE TONAUSGABE IST UMGEZOGEN (15.08.2026). Betreiber: „beim
         bluetooth soll mehr verbinden koppeln und managen der schnittstelle
         sein. ton soll alles verwalten auch für den mupi hat." Diese Seite
         ist seither die SCHNITTSTELLE (koppeln, verbinden, Adapter); wohin
         der Ton geht und wie laut, steht auf der Seite „Ton". Der Verweis
         bleibt hier, damit der alte Weg nicht ins Leere fuehrt. -->
    <h2>Tonausgabe</h2>
    <p class="klein">
      Wohin der Ton geht (auch „Überall"), und wie laut je Ausgabe und Quelle:
      auf der eigenen Seite <a routerLink="/ton">Ton</a>.
    </p>
  `,
})
export class BluetoothSeite implements OnDestroy {
  private readonly http = inject(HttpClient)

  readonly geraete = signal<Geraet[]>([])
  readonly adapter = signal<Adapter | null>(null)
  /** Die Funkadapter der Box mit ihrer Eignung für Musik. */
  readonly funk = signal<Funkadapter[]>([])
  /** Name des Adapters, der spürbar besser wäre als der laufende. Leer = keiner. */
  readonly besser = signal('')
  readonly laedt = signal(true)
  readonly fehler = signal('')
  readonly getan = signal('')
  /** '' = frei, 'suche' = Suche läuft, sonst die MAC des Geräts. */
  readonly beschaeftigt = signal('')
  readonly btAdapter = signal<{
    aktiv: string
    alle: { hci: string; bus: string; mac: string; oben: boolean; standard: boolean; name: string }[]
  } | null>(null)
  readonly btSchaltet = signal(false)
  readonly btAdapterHinweis = signal('')

  private async btAdapterLesen(): Promise<void> {
    try {
      const r = await fetch('/api/bt-adapter', { cache: 'no-store' })
      if (r.ok) this.btAdapter.set(await r.json())
    } catch {
      /* dann bleibt die Anzeige, wie sie war */
    }
  }

  /** „eingebaut" ist verstaendlicher als „hci1 · UART". */
  protected adapterName(a: { bus: string; name: string; hci: string; mac?: string }): string {
    if (a.bus.toUpperCase() === 'UART') return 'eingebaut'
    // BlueZ nennt jeden Adapter nach dem Rechnernamen („mupibox #3"), was bei
    // mehreren Dongles nichts unterscheidet. Dann die letzten vier Stellen der
    // Adresse — das steht auch auf dem Stecker und ist wiedererkennbar.
    if (a.name && !/^mupibox\b/i.test(a.name)) return a.name
    const kurz = (a.mac || '').slice(-5)
    return kurz ? `USB-Dongle ${kurz}` : `USB-Dongle (${a.hci})`
  }

  protected async btAdapterWaehlen(a: { hci: string; mac: string; bus: string; name: string }): Promise<void> {
    // KEINE Rueckfrage: das Umstellen ist umkehrbar (ein Tipp zurueck), und
    // ein Fenster, das man wegklicken muss, kostet bei jedem Versuch einen
    // Handgriff. Die Folge steht stattdessen sofort in der Zeile darunter —
    // dort, wo man ohnehin hinsieht.
    this.btSchaltet.set(true)
    this.btAdapterHinweis.set(`Stelle auf „${this.adapterName(a)}" um …`)
    try {
      const r = await fetch('/api/bt-adapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Die ADRESSE, nicht die Nummer: hciX wandert beim Neuaufzaehlen, und
        // eine beim Aufschlagen gelesene Nummer trifft dann die falsche
        // Hardware. Genau daran scheiterte das Umschalten zuerst.
        body: JSON.stringify({ mac: a.mac, hci: a.hci }),
      })
      const d = await r.json()
      if (!r.ok) {
        this.btAdapterHinweis.set(`Fehlgeschlagen: ${d.error ?? 'unbekannt'}`)
      } else {
        await this.btAdapterLesen()
        await this.laden(true)
        const gekoppelt = this.geraete().filter((g) => g.gekoppelt).length
        // „ZEHN SEKUNDEN" STEHT DA, WEIL SIE GEFEHLT HABEN (15.08.2026): Der
        // Wechsel startet seither den Tonstapel neu (server.ts, bt-adapter),
        // und wer in dieser Luecke „Verbinden" drueckt, bekommt
        // `br-connection-profile-unavailable` — genau die Meldung, mit der
        // der Betreiber einen Nachmittag lang zwischen drei Adaptern
        // gewechselt hat. Jeder Wechsel riss die Luecke neu auf.
        this.btAdapterHinweis.set(
          gekoppelt
            ? `Aktiv: ${this.adapterName(a)} — ${gekoppelt} gekoppelte${gekoppelt === 1 ? 's' : ''} Gerät${gekoppelt === 1 ? '' : 'e'}. Der Ton-Dienst startet gerade neu — etwa zehn Sekunden warten, dann verbinden.`
            : `Aktiv: ${this.adapterName(a)} — hier ist noch nichts gekoppelt. Der Ton-Dienst startet gerade neu; nach etwa zehn Sekunden Lautsprecher einschalten und „Geräte suchen".`,
        )
      }
    } catch {
      this.btAdapterHinweis.set('Die Box antwortet nicht.')
    } finally {
      this.btSchaltet.set(false)
    }
  }


  readonly alleZeigen = signal(false)

  /** Namenlose Streuer sind versteckt, solange man sie nicht anfordert. */
  readonly sichtbare = computed(() =>
    this.alleZeigen()
      ? this.geraete()
      : this.geraete().filter((g) => !g.namenlos || g.gekoppelt || g.verbunden),
  )

  readonly versteckte = computed(() => this.geraete().length - this.sichtbare().length)

  /**
   * Wie oft der Zustand nachgelesen wird.
   *
   * Ladestand und Verbindung aendern sich langsam; haeufiger fragen hiesse nur,
   * dass auf der Box staendig `bluetoothctl` laeuft. Zwanzig Sekunden ist
   * derselbe Takt wie in der Kopfleiste der Box.
   */
  private static readonly TAKT_MS = 20_000
  private uhr: ReturnType<typeof setInterval> | null = null

  constructor() {
    void this.btAdapterLesen()
    void this.laden()
    // STILL nachladen: mit Ladeanzeige waere die Liste alle zwanzig Sekunden
    // kurz weg, und wer gerade koppelt, verlaere den Knopf unter dem Finger.
    this.uhr = setInterval(() => {
      if (!this.beschaeftigt()) void this.laden(true)
    }, BluetoothSeite.TAKT_MS)
  }

  ngOnDestroy(): void {
    if (this.uhr) clearInterval(this.uhr)
  }

  private async laden(still = false): Promise<void> {
    if (!still) this.laedt.set(true)
    try {
      const a = await firstValueFrom(
        this.http.get<{
          adapter: Adapter | null
          geraete: Geraet[]
          funk?: Funkadapter[]
          besser?: string
          fehler?: string
        }>('/api/bluetooth'),
      )
      this.adapter.set(a.adapter)
      this.geraete.set(a.geraete)
      this.funk.set(a.funk ?? [])
      this.besser.set(a.besser ?? '')
      if (a.fehler) this.fehler.set(a.fehler)
    } catch {
      // Ein Aussetzer im Hintergrund ist kein Grund, eine stehende Liste durch
      // eine Fehlermeldung zu ersetzen — beim naechsten Takt ist sie wieder da.
      if (!still) this.fehler.set('Der Bluetooth-Zustand ließ sich nicht lesen.')
    } finally {
      if (!still) this.laedt.set(false)
    }
  }

  /** Die ueblichen Schreibweisen, wie man sie auf Geraeten liest. */
  protected codecName(c: string): string {
    const bekannt: Record<string, string> = {
      sbc: 'SBC', sbc_xq: 'SBC-XQ', aptx: 'aptX', aptx_hd: 'aptX HD',
      aptx_ll: 'aptX LL', aac: 'AAC', ldac: 'LDAC', msbc: 'mSBC', lc3: 'LC3',
    }
    return bekannt[c.toLowerCase()] ?? c
  }

  zeichen(g: Geraet): string {
    switch (g.art) {
      case 'lautsprecher':
        return '🔈'
      case 'kopfhoerer':
        return '🎧'
      case 'telefon':
        return '📱'
      case 'eingabe':
        return '⌨'
      case 'rechner':
        return '💻'
      default:
        return '•'
    }
  }

  async suchen(): Promise<void> {
    if (this.beschaeftigt()) return
    this.beschaeftigt.set('suche')
    this.fehler.set('')
    this.getan.set('')
    try {
      const a = await firstValueFrom(
        this.http.post<{ geraete: Geraet[] }>('/api/bluetooth/suche', { sekunden: 10 }),
      )
      this.geraete.set(a.geraete)
      this.getan.set(`${a.geraete.length} Geräte bekannt.`)
    } catch {
      this.fehler.set('Die Suche ist fehlgeschlagen.')
    } finally {
      this.beschaeftigt.set('')
    }
  }

  async tun(g: Geraet, aktion: 'koppeln' | 'verbinden' | 'trennen' | 'entfernen'): Promise<void> {
    if (this.beschaeftigt()) return
    this.beschaeftigt.set(g.mac)
    this.fehler.set('')
    this.getan.set('')
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; meldung: string; geraete: Geraet[] }>(
          `/api/bluetooth/${encodeURIComponent(g.mac)}/${aktion}`,
          {},
        ),
      )
      this.geraete.set(a.geraete)
      // AUCH die Tonausgabe neu lesen — sonst zeigt der Abschnitt weiter den
      // Stand vom Seitenaufruf. Wer gerade erst einen Lautsprecher verbunden
      // hat, sieht dann NUR den ausgegrauten „Eingebauter Lautsprecher" und
      // hält die Seite für kaputt (am Gerät genau so passiert). Gilt für alle
      // vier Aktionen: verbinden bringt ein Ziel dazu, trennen und entfernen
      // nehmen eines weg — und wenn es das AKTIVE war, muss die Warnung
      // „stumme Box" erscheinen.
            if (a.ok) this.getan.set(`${g.name}: ${a.meldung || 'erledigt'}`)
      // Der Server sagt, WARUM es nicht ging — das ist brauchbarer als ein
      // eigenes „fehlgeschlagen".
      else this.fehler.set(`${g.name}: ${a.meldung || 'hat nicht geklappt'}`)
    } catch {
      this.fehler.set(`${g.name}: die Box hat nicht geantwortet.`)
    } finally {
      this.beschaeftigt.set('')
    }
  }
}
