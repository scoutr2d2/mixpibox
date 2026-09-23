/**
 * Die Netzlaufwerk-Seite: ein NAS-Ort für Sicherungen und Mitschnitte
 * (BACKLOG E28/N6–N9, N15 und E29/B4).
 *
 * „ich habe überlegt ob man nicht einfach noch einen nas ort angeben kann"
 * (Betreiber, 04.08.2026).
 *
 * Drei Zustände, drei Karten — und immer nur die eine, die gerade dran ist:
 *
 *   1. Das Werkzeug fehlt   -> sagen, was fehlt und wie es auf die Box kommt.
 *                              Ohne cifs-utils kann kein Knopf hier etwas.
 *   2. Nichts hinterlegt    -> das Formular: Adresse, Freigabe, Anmeldung.
 *                              Mit dem Satz, der zur Entscheidung gehört —
 *                              die Karte bleibt der Rückweg ohne SSH, das
 *                              NAS ist die zweite Kopie, nicht die einzige.
 *   3. Freigabe liegt vor   -> der ehrliche Zustand (nicht „Einheit aktiv",
 *                              sondern: hängt es, und lässt sich darauf
 *                              SCHREIBEN), der Schalter für die Spiegelung
 *                              und der Weg zurück.
 *
 * Das Passwort steht in keiner Antwort und wird nach dem Übernehmen sofort
 * aus dem Feld genommen: es liegt dann auf der Box, root und 0600 (E28/N8).
 */
import { ChangeDetectionStrategy, Component, inject, type OnDestroy, signal } from '@angular/core'
import { type Art, NetzlaufwerkDienst, type NetzlaufwerkLage } from '../netzlaufwerk.dienst'

@Component({
  selector: 'mupi-netzlaufwerk',
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
    label { display: block; margin-bottom: 0.7rem; font-size: 0.92rem; }
    label span { display: block; color: var(--gedaempft); margin-bottom: 0.25rem; }
    input {
      width: 100%; box-sizing: border-box; min-height: 2.5rem;
      background: var(--grund); color: var(--schrift); border: 1px solid var(--rand);
      border-radius: 10px; padding: 0.4rem 0.6rem; font-size: 0.95rem;
    }
    .sorten { display: flex; gap: 0.5rem; margin-bottom: 0.9rem; flex-wrap: wrap; }
    .sorten button.an { background: var(--gut); border-color: transparent; color: #fff; }
    .sorten button:disabled { opacity: 0.5; }
    .paar { display: grid; grid-template-columns: 1fr 1fr; gap: 0 0.8rem; }
    @media (max-width: 34rem) { .paar { grid-template-columns: 1fr; } }
    .zeile { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; margin-top: 0.8rem; }
    button {
      min-height: 2.4rem; padding: 0 0.9rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
      font-size: 0.9rem; line-height: 1;
    }
    button.an { background: var(--gut); border-color: transparent; color: #fff; }
    button.gefahr { background: transparent; border: 1px solid var(--fehler); color: var(--fehler); }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 0.3rem 1rem; margin: 0 0 0.9rem; font-size: 0.92rem; }
    dt { color: var(--gedaempft); }
    dd { margin: 0; overflow-wrap: anywhere; }
    dd.mono { font-family: ui-monospace, monospace; }
    .stufe { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
             padding: 0.55rem 0; border-top: 1px solid var(--rand); }
    .stufe .was { min-width: 13rem; color: var(--gedaempft); font-size: 0.9rem; }
    .marke {
      font-size: 0.78rem; padding: 0.12rem 0.5rem; border-radius: 999px;
      border: 1px solid var(--rand); color: var(--gedaempft); white-space: nowrap;
    }
    .marke.steht { border-color: var(--gut); color: var(--gut); }
    .marke.nie { border-color: var(--warn); color: var(--warn); }
    .fuss { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;
            margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid var(--rand); }
    code { font-family: ui-monospace, monospace; font-size: 0.85em; }
    .abdruck { font-family: ui-monospace, monospace; font-size: 0.8rem;
               overflow-wrap: anywhere; margin: 0.3rem 0; }
  `,
  template: `
    <h1>Netzlaufwerk</h1>
    <p class="unter">
      Eine Freigabe im Heimnetz — SMB oder WebDAV — als zweite Ablage: die Sicherungsstände liegen dann nicht nur auf derselben
      Karte wie die Box, und Mitschnitte können dorthin, wo das Jellyfin sie ohnehin findet. Die Box hängt es
      NICHT beim Hochfahren ein, sondern erst beim Zugriff — ein ausgeschaltetes NAS hält sie nie auf.
    </p>

    @if (fehler()) {
      <div class="meldung fehler">{{ fehler() }}</div>
    }
    @if (zertifikat(); as z) {
      <div class="meldung hinweis">
        <strong>Fingerabdruck des Servers (SHA-256):</strong>
        <div class="abdruck">{{ z.fingerabdruck }}</div>
        @if (z.aussteller) {
          <div class="klein">ausgestellt von: {{ z.aussteller }}</div>
        }
        <p class="klein">
          Gehört er zu deinem Gerät? Auf dem NAS steht derselbe Wert in den TLS-Einstellungen; am Rechner zeigt
          ihn <code>openssl s_client -connect &lt;adresse&gt;:443 | openssl x509 -fingerprint -sha256</code>.
          Danach prüft die Box weder Gültigkeit noch Namen dieses Zertifikats mehr — richtig bei einem eigenen
          NAS im Heimnetz, falsch bei allem anderen.
        </p>
        <div class="zeile">
          <button class="an" [disabled]="sendet()" (click)="uebernehmen(true)">Diesem Zertifikat vertrauen</button>
          <button (click)="zertifikat.set(null)">Abbrechen</button>
        </div>
      </div>
    }
    @if (erfolg()) {
      <div class="meldung gut">{{ erfolg() }}</div>
    }
    @if (hinweise().length > 0) {
      <div class="meldung hinweis">
        Beim Übernehmen gesetzt:
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
            Auf der Box ist weder <code>cifs-utils</code> noch <code>davfs2</code> installiert — ohne eines von
            beiden lässt sich keine Freigabe einhängen. Es kommt per SSH auf die Box:
            <code>sudo apt install cifs-utils</code> für Windows-Freigaben (SMB),
            <code>sudo apt install davfs2</code> für WebDAV (Nextcloud &amp; Co.).
            Danach zeigt diese Seite die Einrichtung an.
          </p>
        </div>
      } @else if (!l.konfiguration) {
        <div class="karte">
          <h2>Freigabe eintragen</h2>
          <p class="klein">
            Auf dem NAS gehört dafür ein EIGENER Benutzer angelegt, der nur auf diese eine Freigabe darf — nicht
            der Hauptzugang. Das Passwort landet auf der Box in einer Datei, die nur root lesen darf; in dieser
            Oberfläche taucht es danach nie wieder auf.
          </p>
          <div class="sorten">
            <button
              [class.an]="art() === 'smb'"
              [disabled]="!l.werkzeuge.smb"
              (click)="art.set('smb')"
              title="Windows-Freigabe, wie jedes NAS sie anbietet"
            >
              SMB {{ l.werkzeuge.smb ? '' : '(cifs-utils fehlt)' }}
            </button>
            <button
              [class.an]="art() === 'webdav'"
              [disabled]="!l.werkzeuge.webdav"
              (click)="art.set('webdav')"
              title="WebDAV, z. B. Nextcloud oder ein Hoster"
            >
              WebDAV {{ l.werkzeuge.webdav ? '' : '(davfs2 fehlt)' }}
            </button>
          </div>

          @if (art() === 'webdav') {
            <label>
              <span>Adresse der Freigabe</span>
              <input
                [value]="adresse()"
                (input)="adresse.set(wert($event))"
                placeholder="https://nas.fritz.box/remote.php/dav/files/achim/MuPiBox"
              />
            </label>
            <p class="klein">
              Bei Nextcloud steht sie unten links unter „Einstellungen" als WebDAV-Adresse. Anmeldedaten gehören
              NICHT hinein — dafür sind die Felder darunter da. Und wenn der Anbieter es anbietet: ein
              App-Passwort statt des eigenen, dann liegt auf der Box nie das Hauptkennwort.
            </p>
          }

          <div class="paar">
            @if (art() === 'smb') {
              <label>
                <span>Adresse des NAS</span>
                <input [value]="host()" (input)="host.set(wert($event))" placeholder="192.168.178.199" />
              </label>
              <label>
                <span>Freigabe</span>
                <input [value]="freigabe()" (input)="freigabe.set(wert($event))" placeholder="mupibox" />
              </label>
            }
            <label>
              <span>Anmeldename</span>
              <input [value]="nutzer()" (input)="nutzer.set(wert($event))" autocomplete="off" />
            </label>
            <label>
              <span>Passwort</span>
              <input type="password" [value]="passwort()" (input)="passwort.set(wert($event))" autocomplete="off" />
            </label>
            @if (art() === 'smb') {
              <label>
                <span>Unterordner (kann leer bleiben)</span>
                <input [value]="unterpfad()" (input)="unterpfad.set(wert($event))" placeholder="MuPiBox" />
              </label>
            }
            <label>
              <span>Einhängepunkt auf der Box</span>
              <input [value]="einhaengepunkt()" (input)="einhaengepunkt.set(wert($event))" />
            </label>
          </div>
          <p class="klein">
            Der Einhängepunkt muss unter <code>{{ l.wurzel }}/</code> liegen. Das ist Absicht: auf dem Weg, den
            das Abspielen nimmt, hat ein Netzlaufwerk nichts zu suchen — eine hängende Freigabe fröre sonst die
            Wiedergabe ein.
          </p>
          <div class="zeile">
            <button class="an" [disabled]="sendet() || !vollstaendig()" (click)="uebernehmen()">
              {{ sendet() ? 'Einen Moment…' : 'Übernehmen' }}
            </button>
          </div>
        </div>
      } @else {
        <div class="karte">
          <h2>Eingetragene Freigabe</h2>
          <dl>
            <dt>Sorte</dt>
            <dd>{{ l.konfiguration.art === 'webdav' ? 'WebDAV (davfs2)' : 'SMB (cifs)' }}</dd>
            <dt>Freigabe</dt>
            <dd class="mono">{{ l.konfiguration.quelle }}</dd>
            <dt>Anmeldename</dt>
            <dd>{{ l.konfiguration.nutzer }}</dd>
            @if (l.konfiguration.zertifikatVertraut) {
              <dt>Zertifikat</dt>
              <dd>ausdrücklich vertraut — Gültigkeit und Name werden nicht geprüft</dd>
            }
            <dt>Eingehängt unter</dt>
            <dd class="mono">{{ l.konfiguration.einhaengepunkt }}</dd>
            @if (l.konfiguration.uebernommen) {
              <dt>Übernommen</dt>
              <dd>{{ datum(l.konfiguration.uebernommen) }}</dd>
            }
          </dl>

          <div class="stufe">
            <span class="was">Bei Bedarf einhängen</span>
            <span class="marke" [class.steht]="l.einheit.beimStart">
              {{ l.einheit.beimStart ? 'ist eingeschaltet' : 'aus' }}
            </span>
          </div>
          <div class="stufe">
            <span class="was">Hängt gerade</span>
            <span class="marke" [class.steht]="l.eingehaengt" [class.nie]="!l.eingehaengt">
              {{ l.eingehaengt ? 'ja' : 'nein — wird beim nächsten Zugriff eingehängt' }}
            </span>
          </div>
          <div class="stufe">
            <span class="was">Sicherungen dorthin spiegeln</span>
            <button
              [class.an]="l.konfiguration.spiegeln"
              [disabled]="schaltet()"
              (click)="spiegeln(!l.konfiguration.spiegeln)"
            >
              {{ l.konfiguration.spiegeln ? 'an' : 'aus' }}
            </button>
            <span class="klein">
              Zusätzlich zur Karte — die bleibt der Rückweg ohne SSH.
            </span>
          </div>

          <div class="fuss">
            <button [disabled]="prueft()" (click)="pruefen()">
              {{ prueft() ? 'Probe läuft…' : 'Jetzt prüfen (schreiben und wieder wegnehmen)' }}
            </button>
            @if (!entfernenFrage()) {
              <button class="gefahr" (click)="entfernenFrage.set(true)">Freigabe entfernen</button>
            } @else {
              <button class="gefahr" [disabled]="schaltet()" (click)="entfernen()">Ja, entfernen</button>
              <button (click)="entfernenFrage.set(false)">Abbrechen</button>
            }
          </div>
        </div>
      }
    }
  `,
})
export class NetzlaufwerkSeite implements OnDestroy {
  private readonly api = inject(NetzlaufwerkDienst)

  readonly lage = signal<NetzlaufwerkLage | null>(null)
  readonly laedt = signal(true)
  readonly fehler = signal('')
  readonly erfolg = signal('')
  readonly hinweise = signal<string[]>([])
  readonly sendet = signal(false)
  readonly schaltet = signal(false)
  readonly prueft = signal(false)
  readonly entfernenFrage = signal(false)
  /** Der Fingerabdruck, den die Box gemessen hat — nur im Rückfragefall gesetzt. */
  readonly zertifikat = signal<{ fingerabdruck: string; aussteller: string | null } | null>(null)

  readonly art = signal<Art>('smb')
  readonly adresse = signal('')
  readonly host = signal('')
  readonly freigabe = signal('')
  readonly nutzer = signal('')
  readonly passwort = signal('')
  readonly unterpfad = signal('')
  readonly einhaengepunkt = signal('/mnt/nas')

  /**
   * Alle 10 s still nachsehen: „hängt gerade" ändert sich von allein (die
   * Einheit hängt nach zehn Minuten Ruhe wieder aus). Ein Fehlschlag hier
   * überschreibt keine Meldung, die gerade jemand liest.
   */
  private readonly takt = setInterval(() => void this.still(), 10000)

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

  wert(e: Event): string {
    return (e.target as HTMLInputElement).value
  }

  vollstaendig(): boolean {
    const anmeldung = !!(this.nutzer().trim() && this.passwort())
    if (this.art() === 'webdav') return anmeldung && !!this.adresse().trim()
    return anmeldung && !!this.host().trim() && !!this.freigabe().trim()
  }

  async uebernehmen(zertifikatVertrauen = false): Promise<void> {
    this.sendet.set(true)
    this.fehler.set('')
    this.erfolg.set('')
    this.hinweise.set([])
    if (!zertifikatVertrauen) this.zertifikat.set(null)
    // Je Sorte NUR ihre Felder mitschicken: ein liegengebliebener Host aus
    // einem abgebrochenen SMB-Versuch hat in einer WebDAV-Eingabe nichts zu
    // suchen, auch wenn das Backend ihn ohnehin ignorierte.
    const a = await this.api.uebernehmen(
      this.art() === 'webdav'
        ? {
            art: 'webdav',
            adresse: this.adresse().trim(),
            nutzer: this.nutzer().trim(),
            passwort: this.passwort(),
            einhaengepunkt: this.einhaengepunkt().trim(),
            zertifikatVertrauen,
          }
        : {
            art: 'smb',
            host: this.host().trim(),
            freigabe: this.freigabe().trim(),
            unterpfad: this.unterpfad().trim(),
            nutzer: this.nutzer().trim(),
            passwort: this.passwort(),
            einhaengepunkt: this.einhaengepunkt().trim(),
          },
    )
    this.sendet.set(false)
    if (!a.ok) {
      this.fehler.set(a.grund)
      // Hat die Box ein Zertifikat gemessen, ist das keine Sackgasse, sondern
      // eine Rückfrage — der Fingerabdruck erscheint darunter.
      this.zertifikat.set(a.zertifikat ?? null)
      return
    }
    this.zertifikat.set(null)
    // Das Passwort liegt jetzt auf der Box — im Feld hat es nichts mehr verloren.
    this.passwort.set('')
    this.hinweise.set(a.hinweise)
    this.erfolg.set('Übernommen. Mit „Jetzt prüfen" nachsehen, ob die Box darauf auch schreiben darf.')
    await this.laden()
  }

  async pruefen(): Promise<void> {
    this.prueft.set(true)
    this.fehler.set('')
    this.erfolg.set('')
    const a = await this.api.pruefen()
    this.prueft.set(false)
    if (a.ok) this.erfolg.set('Die Freigabe ist eingehängt und beschreibbar.')
    else this.fehler.set(a.grund || 'Die Freigabe antwortet nicht.')
    await this.laden()
  }

  async spiegeln(an: boolean): Promise<void> {
    this.schaltet.set(true)
    this.fehler.set('')
    this.erfolg.set('')
    const a = await this.api.spiegeln(an)
    this.schaltet.set(false)
    if (!a.ok) {
      this.fehler.set(a.grund)
      return
    }
    await this.laden()
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
    this.erfolg.set('Entfernt. Die Sicherungen liegen weiter auf der Karte.')
    await this.laden()
  }

  datum(iso: string): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
  }
}
