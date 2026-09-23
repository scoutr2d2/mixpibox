/**
 * Zugriff auf EINZELNE Schalter aus darstellung.json.
 *
 * WOZU DAS UEBERHAUPT: Seit dem 03.08.2026 stehen „Doppelte zusammenfassen"
 * und „Ganze Diskografie" auf der MEDIEN-Seite, nicht mehr auf der
 * Darstellungsseite (G5 — sie beantworten „was ist da", nicht „wie sieht es
 * aus"). Ihr SPEICHERORT hat sich dabei ausdruecklich NICHT geaendert: beide
 * liegen weiterhin in darstellung.json, wo die Box sie liest. Es ist die
 * Bedienung gewandert, nicht das Feld — sonst haette jede Box, die den
 * Schalter schon gestellt hat, ihn still verloren.
 *
 * WARUM LESEN-AENDERN-SCHREIBEN UND KEIN PATCH: `PUT /api/darstellung` nimmt
 * den GANZEN Stand entgegen (aktuell + themen). Wer nur zwei Felder schicken
 * wollte, muesste den Endpunkt aendern — und der hat einen zweiten Anrufer,
 * die Darstellungsseite selbst, die ohnehin den ganzen Stand haelt.
 *
 * DIE FALLE, die das aufmacht: stehen Darstellungs- und Medienseite
 * gleichzeitig offen, kann das Schreiben der einen das der anderen
 * ueberschreiben. Deshalb wird HIER unmittelbar vor dem Schreiben frisch
 * gelesen — das Fenster dieser Datei ist damit einen Netzaufruf lang.
 *
 * DAS SCHLIESST ABER NUR DIE EINE RICHTUNG, und das gehoert dazugesagt
 * (praezisiert 03.08.2026 beim Gegenlesen): die DARSTELLUNGSSEITE liest NICHT
 * frisch. Sie haelt ihren `w()`-Stand von ihrem `holen()` an und schickt ihn
 * bei jedem Klick vollstaendig. Wer /darstellung offen liegen laesst, hier
 * einen Schalter umlegt und drueben irgendetwas drueckt, hat ihn wieder
 * verloren — ohne Meldung. Innerhalb EINER Sitzung passiert das nicht (der
 * Router baut die Seite beim Wechsel neu und liest damit frisch); es braucht
 * zwei Tabs, zwei Geraete oder zwei Personen.
 *
 * Wer es ganz schliessen will, braucht einen Endpunkt fuer einzelne Felder.
 * Das steht als G10 unter E6 im BACKLOG — nachgetragen, denn beim ersten
 * Anlauf behauptete diese Stelle, es stuende dort, und es stand dort nicht.
 */
import { Injectable, signal } from '@angular/core'

/** Nur die Schalter, die diese Datei anfasst. Alles andere bleibt unberuehrt. */
export interface MedienSchalter {
  verschmelzen: boolean
  diskografie: boolean
}

@Injectable({ providedIn: 'root' })
export class DarstellungDienst {
  /** null = noch nicht gelesen oder nicht lesbar. */
  readonly schalter = signal<MedienSchalter | null>(null)
  readonly stand = signal('')

  async holen(): Promise<void> {
    try {
      const r = await fetch('/api/darstellung', { cache: 'no-store' })
      const d = (await r.json()) as { aktuell?: Record<string, unknown> | null }
      const a = d?.aktuell ?? {}
      this.schalter.set({
        // `!== false`: Vorgabe AN seit 06.09.2026 (Betreiber: „default immer
        // verschmolzen ... da wir ja auch so intern arbeiten"). Mit `=== true`
        // zeigte die Verwaltung AUS, während die Box längst verschmilzt — zwei
        // Wahrheiten über denselben Schalter, und die Verwaltung hätte beim
        // nächsten Speichern die falsche festgeschrieben.
        verschmelzen: a['verschmelzen'] !== false,
        diskografie: a['diskografie'] === true,
      })
      this.stand.set('')
    } catch {
      this.schalter.set(null)
      this.stand.set('Die Box antwortet gerade nicht.')
    }
  }

  /**
   * Einen der beiden Schalter umlegen.
   *
   * Gibt zurueck, ob es geklappt hat — die Seite zeigt sonst „an", waehrend in
   * der Datei „aus" steht.
   */
  async umschalten(feld: keyof MedienSchalter): Promise<boolean> {
    this.stand.set('Wird gespeichert …')
    try {
      // FRISCH lesen, nicht den gemerkten Stand nehmen: zwischen dem Laden der
      // Seite und diesem Klick kann die Darstellungsseite geschrieben haben.
      const r = await fetch('/api/darstellung', { cache: 'no-store' })
      const d = (await r.json()) as {
        aktuell?: Record<string, unknown> | null
        themen?: Record<string, unknown>
      }
      const aktuell = { ...(d?.aktuell ?? {}) }
      const neu = aktuell[feld] !== true
      aktuell[feld] = neu

      const w = await fetch('/api/darstellung', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktuell, themen: d?.themen ?? {} }),
      })
      if (!w.ok) {
        this.stand.set('Speichern fehlgeschlagen.')
        return false
      }
      this.schalter.set({
        verschmelzen: aktuell['verschmelzen'] !== false,
        diskografie: aktuell['diskografie'] === true,
      })
      this.stand.set('Gespeichert — die Box übernimmt es gleich.')
      return true
    } catch {
      this.stand.set('Speichern fehlgeschlagen — die Box antwortet nicht.')
      return false
    }
  }
}
