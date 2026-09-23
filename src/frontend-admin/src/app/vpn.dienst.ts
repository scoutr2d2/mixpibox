/**
 * Zugriff auf den VPN-Heimweg der Box (BACKLOG E30).
 *
 * Wie beim Netzwerk-Zugriff: keine Regeln hier, nur Übermittlung. Was eine
 * gültige WireGuard-Datei ist, entscheidet das Backend — dort steht die
 * Prüfung, die zählt, weil der Text von dort nach /etc/wireguard wandert.
 * Und von dort kommen auch die Fehlertexte: sie nennen den Weg (meist „beim
 * Export auf der FRITZ!Box anders wählen") und werden wörtlich gezeigt.
 *
 * Was hier NIE auftaucht: der private Schlüssel. Das Backend legt ihn ab und
 * beantwortet jede Frage danach mit der Begleitbeschreibung ohne Geheimnisse.
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { firstValueFrom } from 'rxjs'

/** Die Beschreibung der hinterlegten Verbindung — ohne Geheimnisse. */
export interface VpnKonfiguration {
  adressen: string[]
  endpunkt: string
  erlaubteNetze: string[]
  gegenstelle: string
  keepalive: number
  mtu: number | null
  hinweise: string[]
  uebernommen?: string
}

export interface VpnTunnel {
  da: boolean
  endpunkt?: string | null
  erlaubteNetze?: string[]
  /** null heißt: seit dem Start dieses Tunnels kam KEINE Antwort. */
  handschlagVorSek?: number | null
  urteil?: 'steht' | 'stand' | 'nie'
  empfangen?: number
  gesendet?: number
}

export interface VpnEinheit {
  aktiv: boolean
  beimStart: boolean
}

export interface VpnLage {
  werkzeugDa: boolean
  kern: 'geladen' | 'als-modul-da' | 'unbekannt'
  konfiguration: VpnKonfiguration | null
  einheit: VpnEinheit
  tunnel: VpnTunnel
}

@Injectable({ providedIn: 'root' })
export class VpnDienst {
  private readonly http = inject(HttpClient)

  /** Derselbe Fehlertext-Weg wie im Netzwerk-Dienst — das Backend nennt den Grund. */
  private grundAus(e: unknown, standard: string): string {
    if (e instanceof HttpErrorResponse) {
      const gemeldet = (e.error as { error?: string } | null)?.error
      if (gemeldet) return gemeldet
      if (e.status === 401) return 'Die Anmeldung ist abgelaufen.'
      if (e.status === 0) return 'Die Box antwortet nicht.'
    }
    return standard
  }

  async lage(): Promise<VpnLage> {
    return await firstValueFrom(this.http.get<VpnLage>('/api/vpn'))
  }

  /** Dasselbe, aber ohne Wurf — für das Abfragen im Takt auf der Seite. */
  async lageSicher(): Promise<{ ok: true; lage: VpnLage } | { ok: false; grund: string }> {
    try {
      return { ok: true, lage: await this.lage() }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Der Zustand ließ sich nicht lesen.') }
    }
  }

  /**
   * Den Text der FRITZ!Box-Datei übernehmen.
   *
   * `hinweise` sagt, was dabei verändert wurde (DNS gestrichen, Keepalive
   * ergänzt) — das gehört angezeigt, nicht verschluckt. `neuGestartet` heißt:
   * der Tunnel lief schon und trägt jetzt die neue Fassung.
   */
  async uebernehmen(
    text: string,
  ): Promise<
    | { ok: true; konfiguration: VpnKonfiguration; hinweise: string[]; neuGestartet: boolean }
    | { ok: false; grund: string }
  > {
    try {
      const a = await firstValueFrom(
        this.http.post<{ konfiguration: VpnKonfiguration; hinweise: string[]; neuGestartet: boolean }>(
          '/api/vpn/konfiguration',
          { text },
        ),
      )
      return { ok: true, konfiguration: a.konfiguration, hinweise: a.hinweise ?? [], neuGestartet: !!a.neuGestartet }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Das Übernehmen ist fehlgeschlagen.') }
    }
  }

  /**
   * Schalten — zwei GETRENNTE Schalter, wie auf der Dienste-Seite:
   * `an` wirkt sofort, `beimStart` erst beim nächsten Hochfahren.
   */
  async schalten(wunsch: {
    an?: boolean
    beimStart?: boolean
  }): Promise<{ ok: true; einheit: VpnEinheit; tunnel: VpnTunnel } | { ok: false; grund: string }> {
    try {
      const a = await firstValueFrom(
        this.http.post<{ einheit: VpnEinheit; tunnel: VpnTunnel }>('/api/vpn/aktiv', wunsch),
      )
      return { ok: true, einheit: a.einheit, tunnel: a.tunnel }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Das Schalten ist fehlgeschlagen.') }
    }
  }

  /** Verbindung entfernen: anhalten, Autostart weg, Datei weg. */
  async entfernen(): Promise<{ ok: true } | { ok: false; grund: string }> {
    try {
      await firstValueFrom(this.http.delete('/api/vpn/konfiguration'))
      return { ok: true }
    } catch (e) {
      return { ok: false, grund: this.grundAus(e, 'Das Entfernen ist fehlgeschlagen.') }
    }
  }
}
