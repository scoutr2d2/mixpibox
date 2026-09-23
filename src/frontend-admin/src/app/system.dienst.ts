/**
 * Zugriff auf Systemzustand und Systemaktionen.
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { firstValueFrom } from 'rxjs'

export interface Platte {
  gesamt: number
  benutzt: number
  frei: number
  prozent: number
}

export interface SystemAktion {
  id: string
  titel: string
  hinweis: string
  einschneidend: boolean
  /**
   * Auf welcher Seite der Knopf steht — kommt vom Server (system.ts, `bereich`
   * am Eintrag) und wird hier NICHT nachgebaut.
   *
   * Optional, und das ist eine EHRLICHE Angabe und keine Vorsichtsmaßnahme:
   * ein Server ohne dieses Feld lässt die Medienseite ihre Karte weglassen,
   * und die Systemseite zeigt sanfte Aktionen seit dem 03.08.2026 gar nicht
   * mehr. „Medien neu einlesen" wäre dann also NIRGENDS zu sehen.
   *
   * Warum das trotzdem tragbar ist: Verwaltung und Server werden gemeinsam
   * ausgeliefert — der backend-api liefert das Bündel unter /admin selbst aus.
   * Die beiden können nur während eines Updates auseinanderfallen, und danach
   * ist der Fall vorbei.
   */
  bereich?: 'medien' | 'box'
}

export interface Systemlage {
  laufzeitSekunden: number
  /**
   * Dieselbe Laufzeit als FERTIGER SATZ — „3 Tage, 2 h", „2 h 3 min",
   * „unbekannt". Kommt seit dem 19.09.2026 vom Server (server.ts:5540,
   * `laufzeitText`) und wird hier NICHT nachgerechnet.
   *
   * Vorher rechnete die Systemseite selbst, hatte dabei den Wächter für
   * negative und nicht-endliche Werte verloren und zeigte „0 min", wo
   * „unbekannt" hingehörte (AUDIT-2026-09-19 Rang 10d).
   *
   * Optional aus demselben ehrlichen Grund wie `SystemAktion.bereich`: ein
   * Server aus der Zeit vor dem 19.09.2026 schickt das Feld nicht. Dann steht
   * dort „unbekannt" — und nicht eine Zahl, die wie eine Messung aussieht.
   * `laufzeitSekunden` bleibt daneben stehen: wer rechnen will, braucht sie.
   */
  laufzeit?: string
  speicherGesamt: number
  speicherFrei: number
  last: number[]
  kerne: number
  temperatur: number | null
  platte: Platte | null
  rechner: string
  aktionen: SystemAktion[]
}

@Injectable({ providedIn: 'root' })
export class SystemDienst {
  private readonly http = inject(HttpClient)

  async lage(): Promise<Systemlage> {
    return await firstValueFrom(this.http.get<Systemlage>('/api/system'))
  }

  /**
   * Aktion auslösen.
   *
   * Wichtig: bei Neustart und Herunterfahren ist ein Fehlschlag der Anfrage
   * NICHT unbedingt ein Fehler — die Box nimmt genau den Prozess mit, der
   * antworten soll. Deshalb antwortet das Backend zuerst und handelt dann;
   * kommt trotzdem nichts zurück, ist das kein Grund für eine Fehlermeldung.
   */
  async ausloesen(id: string): Promise<{ ok: true } | { ok: false; grund: string }> {
    try {
      await firstValueFrom(this.http.post(`/api/system/${encodeURIComponent(id)}`, {}))
      return { ok: true }
    } catch (e) {
      const status = e instanceof HttpErrorResponse ? e.status : 0
      if (status === 401) return { ok: false, grund: 'Die Anmeldung ist abgelaufen.' }
      if (status === 400) return { ok: false, grund: 'Diese Aktion gibt es nicht.' }
      return { ok: false, grund: 'Die Box hat nicht geantwortet.' }
    }
  }
}
