/**
 * Zugriff auf die Nachrichten-Wege der Box.
 *
 * Wie beim Netzlaufwerk-Dienst: keine Regeln hier, nur Übermittlung. Was ein
 * gültiger Absender ist, entscheidet das Backend — dort steht die Prüfung,
 * die zählt, weil hinter ihr ein Kinderschirm liegt. Und von dort kommen auch
 * die Sätze zum Fehlschlag; sie werden **wörtlich** gezeigt.
 *
 * Die beiden Zugangstoken kommen hier NIE zurück: sie werden über die
 * Konfigurationsseite gesetzt (Feldart `geheim`) und aus jeder Antwort
 * gestrichen. Die Erlaubnisliste kommt nur über ihren eigenen Weg — über
 * `/api/config` geht auch sie nicht hinaus.
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { inject, Injectable } from '@angular/core'
import { firstValueFrom } from 'rxjs'

export type Weg = 'matrix' | 'signal' | 'telegram'

export interface Erlaubt {
  weg: Weg
  absender: string
  name?: string
}

export interface Nachricht {
  id: string
  weg: Weg
  absender: string
  absenderName: string
  text: string
  zeit: number
  gelesen: boolean
  gesprochen: boolean
}

export interface Wegstand {
  an: boolean
  laeuft: boolean
  zuletzt: number
  fehler: string
}

export interface Stand {
  an: boolean
  wege: Record<Weg, Wegstand>
  abgewiesen: Partial<Record<Weg, { anzahl: number; zuletzt: string; wann: number }>>
  erlaubte: number
  vorlesen: boolean
  /** `null` heißt: Signal ist aus, es wurde gar nicht erst nachgesehen. */
  signalDa: boolean | null
  signalHinweis?: string
}

/** Was beim Setzen der Liste schiefging — der Satz und die Zeile dazu. */
export interface ListenFehler {
  grund: string
  satz: string
  zeile: number
}

@Injectable({ providedIn: 'root' })
export class NachrichtenDienst {
  private http = inject(HttpClient)

  stand(): Promise<Stand> {
    return firstValueFrom(this.http.get<Stand>('/api/nachrichten/stand'))
  }

  liste(): Promise<{ nachrichten: Nachricht[]; ungelesen: number; vorlesen: boolean }> {
    return firstValueFrom(
      this.http.get<{ nachrichten: Nachricht[]; ungelesen: number; vorlesen: boolean }>('/api/nachrichten'),
    )
  }

  erlaubt(): Promise<{ erlaubt: Erlaubt[]; verworfen: number }> {
    return firstValueFrom(this.http.get<{ erlaubt: Erlaubt[]; verworfen: number }>('/api/nachrichten/erlaubt'))
  }

  /**
   * Die ganze Liste setzen — ganz oder gar nicht.
   *
   * GIBT DEN FEHLER ZURÜCK, STATT IHN ZU WERFEN: der Satz aus dem Backend ist
   * das Einzige, was dem Bedienenden weiterhilft („die Nummer muss
   * international geschrieben sein"), und ein geworfener Fehler landet in
   * einem `catch`, das ihn zu „ging nicht" einebnet.
   */
  async erlaubtSetzen(erlaubt: Erlaubt[]): Promise<ListenFehler | null> {
    try {
      await firstValueFrom(this.http.put('/api/nachrichten/erlaubt', { erlaubt }))
      return null
    } catch (e) {
      const f = e as HttpErrorResponse
      const k = (f.error ?? {}) as Partial<ListenFehler>
      return {
        grund: String(k.grund ?? 'unbekannt'),
        satz: String(k.satz ?? 'Die Liste wurde nicht übernommen.'),
        zeile: Number(k.zeile ?? -1),
      }
    }
  }

  leeren(): Promise<unknown> {
    return firstValueFrom(this.http.delete('/api/nachrichten'))
  }

  /** `null` heißt „wieder wie die Box", nicht „aus". */
  vorlesenSetzen(kennung: string, wert: boolean | null): Promise<unknown> {
    return firstValueFrom(this.http.post('/api/profil/nachrichten-vorlesen', { kennung, wert }))
  }
}
