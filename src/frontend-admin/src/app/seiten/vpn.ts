/**
 * Die VPN-Seite: der Heimweg der Box (BACKLOG E30).
 *
 * Drei Zustände, drei Karten — und immer nur die eine, die gerade dran ist:
 *
 *   1. Das Werkzeug fehlt        -> sagen, was fehlt und wie es auf die Box
 *                                   kommt. Alles andere wäre eine Seite, die
 *                                   auf Knöpfe hereinlegt, die nichts können.
 *   2. Keine Verbindung angelegt -> der Weg an der FRITZ!Box, Schritt für
 *                                   Schritt, und das Feld zum Einfügen der
 *                                   exportierten Datei (E30/W4: einrichten
 *                                   ohne Tastatur an der Box — die Datei
 *                                   entsteht am Router, hier wird sie nur
 *                                   abgegeben).
 *   3. Verbindung liegt vor      -> zwei GETRENNTE Schalter wie auf der
 *                                   Dienste-Seite („läuft gerade" wirkt
 *                                   sofort, „startet mit" erst beim nächsten
 *                                   Hochfahren) und der ehrliche Zustand:
 *                                   nicht „Dienst aktiv", sondern der letzte
 *                                   Handschlag — nur der beweist, dass die
 *                                   Leitung TRÄGT.
 *
 * Der private Schlüssel taucht hier nirgends auf: die Seite bekommt vom
 * Backend nur die Beschreibung ohne Geheimnisse (E30/W3). Auch die
 * eingefügte Datei bleibt nicht liegen — nach dem Übernehmen wird das
 * Textfeld geleert.
 */
import { ChangeDetectionStrategy, Component, inject, type OnDestroy, signal } from '@angular/core'
import { VpnDienst, type VpnLage } from '../vpn.dienst'

@Component({
  selector: 'mupi-vpn',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.2rem; font-size: 0.94rem; }
    h2 { font-size: 1.02rem; margin: 0 0 0.7rem; }
    .karte {
      background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 12px; padding: 1rem 1.1rem; max-width: 40rem; margin-bottom: 1.2rem;
    }
    .klein { color: var(--gedaempft); font-size: 0.88rem; }
    .meldung { padding: 0.75rem 0.9rem; border-radius: 10px; font-size: 0.9rem; margin-bottom: 1rem; max-width: 40rem; }
    .meldung.fehler { background: color-mix(in srgb, var(--fehler) 18%, transparent); color: var(--fehler); }
    .meldung.hinweis { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
    .meldung.gut { background: color-mix(in srgb, var(--gut) 16%, transparent); color: var(--gut); }
    .meldung ul { margin: 0.3rem 0 0; padding-left: 1.1rem; }
    ol { margin: 0.4rem 0 1rem; padding-left: 1.2rem; display: grid; gap: 0.35rem; font-size: 0.92rem; }
    textarea {
      width: 100%; min-height: 11rem; resize: vertical; box-sizing: border-box;
      background: var(--grund); color: var(--schrift); border: 1px solid var(--rand);
      border-radius: 10px; padding: 0.6rem 0.7rem;
      font-family: ui-monospace, monospace; font-size: 0.82rem;
    }
    .zeile { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; margin-top: 0.8rem; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 0.3rem 1rem; margin: 0 0 0.9rem; font-size: 0.92rem; }
    dt { color: var(--gedaempft); }
    dd { margin: 0; overflow-wrap: anywhere; }
    dd.mono { font-family: ui-monospace, monospace; }
    .stufe { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
             padding: 0.55rem 0; border-top: 1px solid var(--rand); }
    .stufe .was { min-width: 11rem; color: var(--gedaempft); font-size: 0.9rem; }
    .stufe button {
      min-height: 2.4rem; padding: 0 0.8rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
      font-size: 0.9rem; line-height: 1;
    }
    .stufe button.an { background: var(--gut); border-color: transparent; color: #fff; }
    .stand { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap;
             padding: 0.7rem 0 0.2rem; border-top: 1px solid var(--rand); font-size: 0.92rem; }
    .marke {
      font-size: 0.78rem; padding: 0.12rem 0.5rem; border-radius: 999px;
      border: 1px solid var(--rand); color: var(--gedaempft); white-space: nowrap;
    }
    .marke.steht { border-color: var(--gut); color: var(--gut); }
    .marke.stand { border-color: var(--warn); color: var(--warn); }
    .marke.nie { border-color: var(--fehler); color: var(--fehler); }
    .fuss { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;
            margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid var(--rand); }
    button.gefahr { background: transparent; border: 1px solid var(--fehler); color: var(--fehler); }
    code { font-family: ui-monospace, monospace; font-size: 0.85em; }
  `,
  template: `
    <h1>VPN</h1>
    <p class="unter">
      Die Box meldet sich als WireGuard-Klient bei einem Server im Heimnetz an — etwa der FRITZ!Box. Nimmt jemand
      die Box mit, bleiben Jellyfin, das NAS und diese Verwaltung erreichbar. Zu Hause muss dafür kein Port auf die
      Box zeigen, und durch den Tunnel geht NUR das Heimnetz: Spotify &amp; Co. laufen weiter direkt.
    </p>

    @if (fehler()) {
      <div class="meldung fehler">{{ fehler() }}</div>
    }
    @if (erfolg()) {
      <div class="meldung gut">{{ erfolg() }}</div>
    }
    @if (hinweise().length > 0) {
      <div class="meldung hinweis">
        Beim Übernehmen wurde verändert:
        <ul>
          @for (h of hinweise(); track h) {
            <li>{{ h }}</li>
          }
        </ul>
      </div>
    }

    @if (laedt()) {
      <p class="klein">Einen Moment…</p>
    } @else if (lage(); as l) {
      @if (!l.werkzeugDa) {
        <div class="karte">
          <h2>Das Werkzeug fehlt noch</h2>
          <p>
            Auf der Box ist <code>wireguard-tools</code> nicht installiert (die Befehle <code>wg</code> und
            <code>wg-quick</code>). Es kommt per SSH auf die Box:
            <code>sudo apt install wireguard-tools</code>. Nur einmal nötig: seit dem 19.09.2026 bringen frisch
            bespielte Karten es mit, und auch das nächste Update dieser Box holt es nach. Danach zeigt diese
            Seite die Einrichtung an.
          </p>
        </div>
      } @else if (l.konfiguration; as k) {
        <div class="karte">
          <h2>Heimweg</h2>
          <dl>
            <dt>Gegenstelle</dt>
            <dd class="mono">{{ k.endpunkt }}</dd>
            <dt>Durch den Tunnel</dt>
            <dd class="mono">{{ k.erlaubteNetze.join(', ') }}</dd>
            <dt>Adresse der Box im Tunnel</dt>
            <dd class="mono">{{ k.adressen.join(', ') }}</dd>
            @if (k.uebernommen) {
              <dt>Übernommen</dt>
              <dd>{{ datum(k.uebernommen) }}</dd>
            }
          </dl>

          <div class="stufe">
            <span class="was">Läuft gerade</span>
            <button type="button" [class.an]="l.einheit.aktiv" [disabled]="schaltet()" (click)="schalten({ an: true })">
              An
            </button>
            <button
              type="button"
              [class.an]="!l.einheit.aktiv"
              [disabled]="schaltet()"
              (click)="schalten({ an: false })"
            >
              Aus
            </button>
          </div>
          <div class="stufe">
            <span class="was">Startet mit der Box</span>
            <button
              type="button"
              [class.an]="l.einheit.beimStart"
              [disabled]="schaltet()"
              (click)="schalten({ beimStart: true })"
            >
              An
            </button>
            <button
              type="button"
              [class.an]="!l.einheit.beimStart"
              [disabled]="schaltet()"
              (click)="schalten({ beimStart: false })"
            >
              Aus
            </button>
          </div>

          @if (l.einheit.aktiv) {
            <div class="stand">
              @if (l.tunnel.da && l.tunnel.urteil === 'steht') {
                <span class="marke steht">steht</span>
                <span>Handschlag {{ vor(l.tunnel.handschlagVorSek) }}</span>
                <span class="klein">↓ {{ menge(l.tunnel.empfangen) }} · ↑ {{ menge(l.tunnel.gesendet) }}</span>
              } @else if (l.tunnel.da && l.tunnel.urteil === 'stand') {
                <span class="marke stand">stand</span>
                <span>letzter Handschlag {{ vor(l.tunnel.handschlagVorSek) }} — das Heimnetz ist gerade nicht erreichbar.</span>
              } @else if (l.tunnel.da) {
                <span class="marke nie">nie</span>
                <span>
                  Noch keine Antwort der Gegenstelle. Direkt nach dem Einschalten ist das normal (ein paar
                  Sekunden); bleibt es so, stimmen Endpunkt oder Schlüssel nicht, die Verbindung wurde am Router
                  gelöscht — oder es fehlt schlicht das Internet.
                </span>
              } @else {
                <span class="klein">Der Dienst läuft, aber die Schnittstelle fehlt — Protokolle ansehen.</span>
              }
            </div>
          } @else {
            <p class="klein">Der Tunnel ist aus. Die Box spricht ganz normal über ihr WLAN.</p>
          }

          <div class="fuss">
            @if (!entfernenFrage()) {
              <button type="button" class="gefahr" [disabled]="schaltet()" (click)="entfernenFrage.set(true)">
                Verbindung entfernen
              </button>
              <span class="klein">Hält den Tunnel an und löscht die Datei samt Schlüssel von der Box.</span>
            } @else {
              <span>Wirklich entfernen? Zum Wiederherstellen muss die Datei neu von der FRITZ!Box kommen.</span>
              <button type="button" class="gefahr" [disabled]="schaltet()" (click)="entfernen()">Ja, entfernen</button>
              <button type="button" [disabled]="schaltet()" (click)="entfernenFrage.set(false)">Abbrechen</button>
            }
          </div>
        </div>
      } @else {
        <div class="karte">
          <h2>Einrichten — die Datei entsteht am Router</h2>
          <ol>
            <li>Auf der FRITZ!Box: <strong>Internet → Freigaben → VPN (WireGuard) → Verbindung hinzufügen</strong>.</li>
            <li>„Vereinfachte Einrichtung" für ein <strong>Einzelgerät</strong> wählen und der Box einen Namen geben.</li>
            <li>
              Die Frage, ob <em>die gesamte Internetverbindung</em> über das VPN laufen soll, <strong>verneinen</strong> —
              durch den Tunnel gehört nur das Heimnetz. Eine Datei mit „alles" lehnt die Box beim Übernehmen ab.
            </li>
            <li>Die angebotenen <strong>WireGuard-Einstellungen herunterladen</strong> (eine <code>.conf</code>-Datei) und ihren Inhalt hier einfügen.</li>
          </ol>
          <textarea
            [value]="text()"
            (input)="text.set(eingabe($event))"
            placeholder="[Interface]&#10;PrivateKey = …&#10;Address = …&#10;&#10;[Peer]&#10;PublicKey = …&#10;Endpoint = …"
            autocomplete="off"
            spellcheck="false"
          ></textarea>
          <div class="zeile">
            <input type="file" accept=".conf,text/plain" (change)="datei($event)" />
            <button type="button" [disabled]="sendet() || text().trim() === ''" (click)="uebernehmen()">
              {{ sendet() ? 'Übernimmt…' : 'Übernehmen' }}
            </button>
          </div>
          <p class="klein">
            Der private Schlüssel aus der Datei wird nur nach <code>/etc/wireguard</code> auf der Box gelegt (nur
            für root lesbar) — er taucht weder in dieser Verwaltung noch in einer Sicherung wieder auf.
          </p>
        </div>
        @if (l.kern === 'unbekannt') {
          <p class="klein">
            Ob der Kern der Box WireGuard trägt, war von hier nicht zu sehen — der erste Start des Tunnels
            beweist es dann.
          </p>
        }
      }
    }
  `,
})
export class VpnSeite implements OnDestroy {
  private readonly api = inject(VpnDienst)

  readonly lage = signal<VpnLage | null>(null)
  readonly laedt = signal(true)
  readonly fehler = signal('')
  readonly erfolg = signal('')
  readonly hinweise = signal<string[]>([])
  readonly text = signal('')
  readonly sendet = signal(false)
  readonly schaltet = signal(false)
  readonly entfernenFrage = signal(false)

  /**
   * Alle 5 s nachsehen — der Handschlag altert von allein, und nach dem
   * Einschalten dauert es ein paar Sekunden, bis die erste Antwort kommt.
   * Stilles Nachsehen: ein Fehlschlag hier überschreibt keine Meldung, die
   * gerade jemand liest; Fehler zeigen die Handlungen selbst.
   */
  private readonly takt = setInterval(() => void this.still(), 5000)

  constructor() {
    void this.laden()
  }

  ngOnDestroy(): void {
    clearInterval(this.takt)
  }

  async laden(): Promise<void> {
    this.laedt.set(true)
    const a = await this.api.lageSicher()
    this.laedt.set(false)
    if (a.ok) this.lage.set(a.lage)
    else this.fehler.set(a.grund)
  }

  private async still(): Promise<void> {
    const a = await this.api.lageSicher()
    if (a.ok) this.lage.set(a.lage)
  }

  eingabe(e: Event): string {
    return (e.target as HTMLTextAreaElement).value
  }

  async datei(e: Event): Promise<void> {
    const eingabe = e.target as HTMLInputElement
    const d = eingabe.files?.[0]
    if (!d) return
    this.text.set(await d.text())
    // Damit dieselbe Datei nach einem Fehler erneut wählbar ist.
    eingabe.value = ''
  }

  async uebernehmen(): Promise<void> {
    this.sendet.set(true)
    this.fehler.set('')
    this.erfolg.set('')
    this.hinweise.set([])
    const a = await this.api.uebernehmen(this.text())
    this.sendet.set(false)
    if (!a.ok) {
      this.fehler.set(a.grund)
      return
    }
    // Die Datei enthält den privaten Schlüssel — sie hat im Feld nichts mehr
    // verloren, sobald sie auf der Box liegt.
    this.text.set('')
    this.hinweise.set(a.hinweise)
    this.erfolg.set(
      a.neuGestartet
        ? 'Übernommen — der laufende Tunnel trägt jetzt die neue Fassung.'
        : 'Übernommen. Jetzt unten einschalten — und für unterwegs „Startet mit der Box" anstellen.',
    )
    await this.laden()
  }

  async schalten(wunsch: { an?: boolean; beimStart?: boolean }): Promise<void> {
    this.schaltet.set(true)
    this.fehler.set('')
    this.erfolg.set('')
    const a = await this.api.schalten(wunsch)
    this.schaltet.set(false)
    if (!a.ok) {
      this.fehler.set(a.grund)
      return
    }
    const l = this.lage()
    if (l) this.lage.set({ ...l, einheit: a.einheit, tunnel: a.tunnel })
  }

  async entfernen(): Promise<void> {
    this.schaltet.set(true)
    this.fehler.set('')
    this.erfolg.set('')
    this.hinweise.set([])
    const a = await this.api.entfernen()
    this.schaltet.set(false)
    this.entfernenFrage.set(false)
    if (!a.ok) {
      this.fehler.set(a.grund)
      return
    }
    this.erfolg.set('Entfernt. Die Box hat keinen VPN-Zugang mehr.')
    await this.laden()
  }

  /** 1234 → „1,2 kB" — Datenmengen in Menschenform. */
  menge(bytes: number | undefined): string {
    const b = bytes ?? 0
    if (b < 1024) return `${b} B`
    const kb = b / 1024
    if (kb < 1024) return `${kb.toFixed(1).replace('.', ',')} kB`
    const mb = kb / 1024
    if (mb < 1024) return `${mb.toFixed(1).replace('.', ',')} MB`
    return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`
  }

  /** Sekunden → „vor 12 s" / „vor 3 min" / „vor 2 h". */
  vor(sek: number | null | undefined): string {
    if (sek === null || sek === undefined) return '—'
    if (sek < 90) return `vor ${sek} s`
    if (sek < 5400) return `vor ${Math.round(sek / 60)} min`
    return `vor ${Math.round(sek / 3600)} h`
  }

  datum(iso: string): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
  }
}
