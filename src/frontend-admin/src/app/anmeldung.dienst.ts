/**
 * Der Anmeldezustand der Verwaltungsoberflaeche.
 *
 * Er bildet die drei Regeln ab, die im Backend (auth.ts) festgelegt sind — und
 * zwar so, dass die Oberflaeche NICHT strenger ist als das Backend:
 *
 *  - Steht die Anmeldung auf AUS (interfacelogin.state = false), ist man
 *    angemeldet. Eine Bestandsbox darf nach einem Update nicht ploetzlich
 *    fragen.
 *  - Ruft man VON DER BOX SELBST auf, laesst das Backend einen ohne Sitzung
 *    durch; dann meldet /state ebenfalls "angemeldet".
 *  - Nur von aussen und bei eingeschalteter Anmeldung braucht es das Passwort.
 *
 * Deshalb fragt die Oberflaeche IMMER erst das Backend und raet nie selbst.
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { Injectable, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

export interface Anmeldelage {
  anmeldungNoetig: boolean
  angemeldet: boolean
  passwortGesetzt: boolean
}

/** Ausgangslage vor der ersten Antwort: bewusst "nicht angemeldet".
 *  Andersherum blitzte die Oberflaeche kurz auf, bevor sie zurueckwirft. */
export const UNBEKANNT: Anmeldelage = {
  anmeldungNoetig: true,
  angemeldet: false,
  passwortGesetzt: true,
}

@Injectable({ providedIn: 'root' })
export class AnmeldeDienst {
  private readonly http = inject(HttpClient)

  readonly lage = signal<Anmeldelage>(UNBEKANNT)
  readonly geprueft = signal(false)

  /** Zustand beim Backend erfragen. Fehler = "nicht angemeldet", nicht Absturz. */
  async pruefen(): Promise<Anmeldelage> {
    try {
      const l = await firstValueFrom(this.http.get<Anmeldelage>('/api/auth/state'))
      this.lage.set(l)
      return l
    } catch {
      // Backend nicht erreichbar: es waere falsch, jetzt "angemeldet" anzunehmen.
      this.lage.set(UNBEKANNT)
      return UNBEKANNT
    } finally {
      this.geprueft.set(true)
    }
  }

  /**
   * Anmelden. Gibt bei Misserfolg einen ANZEIGBAREN Grund zurueck statt zu werfen —
   * die Seite soll eine Meldung zeigen koennen, nicht in einen Fehlerbaum laufen.
   */
  async anmelden(passwort: string): Promise<{ ok: true } | { ok: false; grund: string }> {
    try {
      await firstValueFrom(this.http.post('/api/auth/login', { password: passwort }))
      await this.pruefen()
      return { ok: true }
    } catch (e) {
      const status = e instanceof HttpErrorResponse ? e.status : 0
      if (status === 401) return { ok: false, grund: 'falsch' }
      if (status === 0) return { ok: false, grund: 'keine-verbindung' }
      return { ok: false, grund: 'unbekannt' }
    }
  }

  async abmelden(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}))
    } catch {
      // Auch ein fehlgeschlagenes Abmelden soll die Oberflaeche zuruecksetzen.
    }
    await this.pruefen()
  }
}
