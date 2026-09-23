/**
 * Zugriff auf die Dienste der Box.
 *
 * Bewusst dünn: die Oberfläche entscheidet NICHTS über Erlaubtes. Welche
 * Dienste es gibt und was mit ihnen geht, sagt allein das Backend — dort steht
 * die Freigabeliste, die aus systemd selbst stammt. Eine Prüfung hier wäre
 * Kosmetik, denn wer die API direkt anspricht, käme daran vorbei.
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { firstValueFrom } from 'rxjs'

export interface Dienst {
  name: string
  titel: string
  beschreibung: string
  aktiv: boolean
  /** `null` = fest verdrahtet, lässt sich nicht ein-/ausschalten. */
  eingeschaltet: boolean | null
  zustand: string
  /**
   * Gesetzt, wenn ein NEUERES Ding dasselbe tut — der Text nennt es.
   *
   * NICHT dasselbe wie „auf dieser Box aus": ein abgeschalteter Lüfterdienst
   * ist eine Wahlmöglichkeit, kein Auslaufmodell. Die Einstufung trifft das
   * Backend (dienste.ts, ABGELOEST), nicht diese Seite.
   */
  abgeloest?: string
  /** Auskunft ohne Urteil — z.B. „läuft in Wahrheit als Nutzerdienst". */
  hinweis?: string
  /** In welchen Abschnitt der Seite er gehört. Kommt vom Backend. */
  abschnitt?: 'normal' | 'abgeloest'
  /**
   * Was es kostet, diesen Dienst anzuhalten bzw. vom Start zu nehmen.
   *
   * Kommt VOLLSTÄNDIG vom Backend (dienste.ts, TRAGWEITE) — hier steht keine
   * Liste gefährlicher Dienste, und das ist Absicht: die Seite darf nicht
   * warnen können, wo der Server durchlässt, und der Server nicht sperren,
   * wo die Seite schweigt. Fehlt das Feld (älterer Server), zeigt die Seite
   * eben nichts an; ein Dienst darf nie deshalb verschwinden.
   */
  tragweite?: { anhalten: Folgen; startetMit: Folgen }
}

/** Siehe backend-api/src/dienste.ts — dort steht, was die Stufen bedeuten. */
export type Stufe = 'normal' | 'warnung' | 'kein-rueckweg'

export interface Folgen {
  stufe: Stufe
  verliert: string
  rueckweg: string
}

/**
 * Die Rückfrage des Servers vor einer Bedienung ohne Weg zurück.
 *
 * Sie wird NICHT hier gebildet, sondern kommt als 409 zurück. Damit ist es
 * unmöglich, dass die Seite etwas anderes fragt, als der Server verlangt —
 * und unmöglich, dass sie eine Sperre vortäuscht, die es nicht gibt.
 */
export interface Nachfrage {
  stufe: Stufe
  verliert: string
  rueckweg: string
  /** Das Wort, das die zweite Anfrage mitschicken muss. */
  bestaetigung: string
}

export type Aktion = 'start' | 'stop' | 'restart' | 'enable' | 'disable'

interface Antwort {
  dienste: Dienst[]
  fehler?: string
}

@Injectable({ providedIn: 'root' })
export class DiensteDienst {
  private readonly http = inject(HttpClient)

  async liste(): Promise<Antwort> {
    return await firstValueFrom(this.http.get<Antwort>('/api/dienste'))
  }

  /**
   * Aktion ausführen. Gibt bei Misserfolg einen anzeigbaren Grund zurück —
   * die Seite soll melden können, was war, statt in einen Fehlerbaum zu laufen.
   *
   * `bestaetigung` ist das Wort aus einer vorangegangenen 409-Antwort. Ohne
   * es lehnt der Server die Bedienungen ab, aus denen man am Gerät nicht
   * zurückkommt — und schickt statt dessen die `Nachfrage` mit.
   */
  async schalten(
    name: string,
    aktion: Aktion,
    bestaetigung?: string,
  ): Promise<
    | { ok: true; dienste: Dienst[] }
    | { ok: false; grund: string; nachfrage?: Nachfrage }
  > {
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; dienste?: Dienst[] }>(
          `/api/dienste/${encodeURIComponent(name)}/${aktion}`,
          bestaetigung ? { bestaetigt: bestaetigung } : {},
        ),
      )
      return { ok: true, dienste: a.dienste ?? [] }
    } catch (e) {
      const status = e instanceof HttpErrorResponse ? e.status : 0
      // 409 ist KEIN Fehler, sondern die Rückfrage: es wurde nichts geändert.
      // Der Text kommt vom Server; die Seite denkt sich hier nichts aus.
      if (status === 409 && e instanceof HttpErrorResponse) {
        const k = e.error as Partial<Nachfrage> | null
        if (k?.bestaetigung) {
          return {
            ok: false,
            grund: '',
            nachfrage: {
              stufe: k.stufe ?? 'kein-rueckweg',
              verliert: k.verliert ?? '',
              rueckweg: k.rueckweg ?? '',
              bestaetigung: k.bestaetigung,
            },
          }
        }
      }
      return {
        ok: false,
        grund:
          status === 401
            ? 'Die Anmeldung ist abgelaufen.'
            : status === 404
              ? 'Diesen Dienst gibt es auf der Box nicht.'
              : status === 503
                ? 'Die Dienstverwaltung antwortet nicht.'
                : status === 0
                  ? 'Die Box antwortet nicht.'
                  : 'Die Aktion ist fehlgeschlagen.',
      }
    }
  }
}
