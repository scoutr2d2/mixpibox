/**
 * Zugriff auf das Netzlaufwerk der Box (BACKLOG E28/N6–N9, E29/B4).
 *
 * Wie beim VPN-Dienst: keine Regeln hier, nur Übermittlung. Was eine gültige
 * Freigabe ist, entscheidet das Backend — dort steht die Prüfung, die zählt,
 * weil aus den Werten dort zwei systemd-Einheiten entstehen. Und von dort
 * kommen auch die Fehlertexte; sie werden wörtlich gezeigt.
 *
 * Was hier NIE zurückkommt: das Passwort der Freigabe. Es geht EINMAL hin
 * (beim Übernehmen) und liegt danach in /etc/mupibox/nas-zugang, root und
 * 0600. Die Lage kennt nur Adresse, Freigabe und Anmeldenamen.
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { inject, Injectable } from '@angular/core'
import { firstValueFrom } from 'rxjs'

/** Welche Sorte Freigabe — SMB (Windows-Freigabe) oder WebDAV (Nextcloud & Co.). */
export type Art = 'smb' | 'webdav'

/** Was in die Verwaltung eingegeben wird — das Passwort nur auf dem Hinweg. */
export interface NetzlaufwerkEingabe {
  art: Art
  /** Nur bei SMB. */
  host?: string
  freigabe?: string
  unterpfad?: string
  /** Nur bei WebDAV: die ganze Adresse. */
  adresse?: string
  nutzer: string
  passwort: string
  domaene?: string
  einhaengepunkt?: string
  /**
   * Nur WebDAV über https: dem selbstsignierten Zertifikat des Servers
   * ausdrücklich vertrauen. Wird erst gesetzt, NACHDEM die Box den
   * Fingerabdruck gezeigt hat.
   */
  zertifikatVertrauen?: boolean
}

/** Die hinterlegte Freigabe, wie das Backend sie beschreibt — ohne Geheimnis. */
export interface NetzlaufwerkKonfiguration {
  art: Art
  host: string
  freigabe: string
  unterpfad: string
  nutzer: string
  domaene: string
  besitzer: string
  einhaengepunkt: string
  quelle: string
  /** Gilt hier ein Zertifikat, das nur der Betreiber geprüft hat? */
  zertifikatVertraut?: boolean
  uebernommen?: string
  /** Sollen die Sicherungsstände dorthin gespiegelt werden (E29/B4)? */
  spiegeln?: boolean
}

export interface NetzlaufwerkLage {
  /** Ist ueberhaupt ein Einhaengewerkzeug da? Ohne eines geht gar nichts. */
  werkzeugDa: boolean
  /** Und welches: cifs-utils (SMB), davfs2 (WebDAV). */
  werkzeuge: { smb: boolean; webdav: boolean }
  konfiguration: NetzlaufwerkKonfiguration | null
  einheit: { aktiv: boolean; beimStart: boolean }
  /** Hängt gerade wirklich etwas dort — nicht dasselbe wie „Einheit aktiv". */
  eingehaengt: boolean
  wurzel: string
}

@Injectable({ providedIn: 'root' })
export class NetzlaufwerkDienst {
  private readonly http = inject(HttpClient)

  private grundAus(e: unknown, standard: string): string {
    if (e instanceof HttpErrorResponse) {
      const gemeldet = (e.error as { error?: string } | null)?.error
      if (gemeldet) return gemeldet
      if (e.status === 401) return 'Die Anmeldung ist abgelaufen.'
      if (e.status === 0) return 'Die Box antwortet nicht.'
    }
    return standard
  }

  async lage(): Promise<NetzlaufwerkLage> {
    return await firstValueFrom(this.http.get<NetzlaufwerkLage>('/api/netzlaufwerk'))
  }

  /** Dasselbe ohne Wurf — für das stille Nachsehen im Takt. */
  async lageSicher(): Promise<{ ok: true; lage: NetzlaufwerkLage } | { ok: false; grund: string }> {
    try {
      return { ok: true, lage: await this.lage() }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Der Zustand ließ sich nicht lesen.') }
    }
  }

  /**
   * Freigabe übernehmen. `hinweise` sagt, was dabei gesetzt wurde (SMB-Fassung,
   * kein Einhängen beim Start, wohin die Zugangsdaten gehen) — das gehört
   * angezeigt, nicht verschluckt.
   */
  async uebernehmen(
    eingabe: NetzlaufwerkEingabe,
  ): Promise<
    | { ok: true; konfiguration: NetzlaufwerkKonfiguration; hinweise: string[] }
    | { ok: false; grund: string; zertifikat?: { fingerabdruck: string; aussteller: string | null } }
  > {
    try {
      const a = await firstValueFrom(
        this.http.post<{ konfiguration: NetzlaufwerkKonfiguration; hinweise: string[] }>(
          '/api/netzlaufwerk/konfiguration',
          eingabe,
        ),
      )
      return { ok: true, konfiguration: a.konfiguration, hinweise: a.hinweise ?? [] }
    } catch (e) {
      // Der 409-Fall mit Zertifikat ist KEIN gewöhnlicher Fehler: die Box hat
      // gemessen und fragt zurück. Der Fingerabdruck gehört deshalb nach
      // vorne durchgereicht, nicht in einen Fehlertext gequetscht.
      const zertifikat =
        e instanceof HttpErrorResponse
          ? (e.error as { zertifikat?: { fingerabdruck: string; aussteller: string | null } } | null)?.zertifikat
          : undefined
      return { ok: false, grund: this.grundAus(e, 'Das Übernehmen ist fehlgeschlagen.'), zertifikat }
    }
  }

  /**
   * Die ehrliche Probe: eine Datei schreiben und wieder wegnehmen. „Einheit
   * aktiv" beantwortet die Frage nicht — eine Freigabe kann erreichbar und
   * trotzdem nur lesbar sein.
   */
  async pruefen(): Promise<{ ok: boolean; eingehaengt?: boolean; schreibbar?: boolean; grund?: string }> {
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; eingehaengt?: boolean; schreibbar?: boolean; error?: string }>(
          '/api/netzlaufwerk/pruefen',
          {},
        ),
      )
      return { ok: a.ok, eingehaengt: a.eingehaengt, schreibbar: a.schreibbar, grund: a.error }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Die Probe ist fehlgeschlagen.') }
    }
  }

  /** Sicherungsstände dorthin spiegeln — oder eben nicht (E29/B4). */
  async spiegeln(an: boolean): Promise<{ ok: true; spiegeln: boolean } | { ok: false; grund: string }> {
    try {
      const a = await firstValueFrom(this.http.post<{ spiegeln: boolean }>('/api/netzlaufwerk/spiegeln', { an }))
      return { ok: true, spiegeln: a.spiegeln }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Das Schalten ist fehlgeschlagen.') }
    }
  }

  /** Entfernen: aushängen, Autostart weg, Einheiten weg, Zugangsdatei weg. */
  async entfernen(): Promise<{ ok: true } | { ok: false; grund: string }> {
    try {
      await firstValueFrom(this.http.delete('/api/netzlaufwerk/konfiguration'))
      return { ok: true }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Das Entfernen ist fehlgeschlagen.') }
    }
  }
}
