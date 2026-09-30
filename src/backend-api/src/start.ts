/**
 * WAS DIE BOX BEIM KALTSTART TUT — fragen oder weitermachen.
 *
 * ══ DER WUNSCH (20.09.2026) ═════════════════════════════════════════════
 *
 * Betreiber: „ich moechte eine moeglichkeit vom jetzigen modus auf den
 * letztes profil startet automatisch, falls kein passwort eingestellt ist
 * komplett, ansonsten in die passwort abfrage."
 *
 * ══ WAS HEUTE GESCHIEHT, UND WARUM ES SO GEBAUT WURDE ═══════════════════
 *
 * Ist der Gast ABGESCHALTET (E39), zeigt die Box nach einem Kaltstart „Wer
 * hoert?" (app.js, `profilHolen`). Der Grund steht dort: „nach einem
 * Kaltstart stuende die Box sonst einfach im letzten Kinderprofil, am
 * Schloss vorbei." Das ist richtig — aber es ist eine ANTWORT AUF DAS
 * SCHLOSS, keine auf den Normalfall. Wo gar kein Passwort gesetzt ist,
 * fragt die Box jeden Morgen nach etwas, das niemand schuetzt.
 *
 * HIER STAND BIS ZUM 30.09.2026 „sobald das aktive Profil NICHT der Gast
 * ist" — das war falsch: app.js fragt `/api/start` nur bei
 * `gastAktiv === false`. MIT GAST (die Vorgabe jeder Box) gilt dieser Modus
 * NICHT. Dort macht die Box mit dem zuletzt aktiven Profil weiter; hat es
 * ein Schloss, steht beim Kaltstart dessen Schloss davor, „Ich bin jemand
 * anderes" fuehrt zu „Wer hoert?" samt Gast (E143/5, Betreiber 29.09.2026:
 * Weg a, „nur das Schloss"). Den Modus auch mit Gast gelten zu lassen
 * (Weg b) hiesse mit `fragen` als Vorgabe: jede Box fragt ab dem Update
 * jeden Morgen — genau das stille Umspringen, das der Kasten „WARUM
 * `fragen` DIE VORGABE BLEIBT" ausschliesst. Gemessen in
 * tools/start-modus-schau.mjs.
 *
 * ══ DIE ZWEI MODI (nur ohne Gast) ══════════════════════════════════════
 *
 *   fragen   Wie bisher: nach dem Kaltstart kommt „Wer hoert?".
 *   letztes  Das zuletzt gewaehlte Profil macht weiter —
 *              ohne Passwort: sofort und ganz,
 *              mit Passwort:  direkt in dessen Passwortfrage.
 *
 * `letztes` UEBERSPRINGT DAS SCHLOSS ALSO NICHT. Es ueberspringt nur die
 * Frage, WER — und die ist bei einem geschuetzten Profil ohnehin schon
 * beantwortet.
 *
 * ══ WARUM `fragen` DIE VORGABE BLEIBT ═══════════════════════════════════
 *
 * Weil es der heutige Zustand jeder Box ist. Ein Modus, der beim Update
 * stillschweigend umspringt, ist keine neue Moeglichkeit, sondern eine
 * weggenommene Entscheidung — dieselbe Regel wie beim Spiele-Schalter
 * (llmwiki `ein-neuer-schalter-darf-nichts-wegnehmen`).
 *
 * REIN: kein fs, kein Netz, keine Uhr.
 */

export type StartModus = 'fragen' | 'letztes'

export interface StartEinstellungen {
  modus: StartModus
}

export const START_VORGABE: StartEinstellungen = { modus: 'fragen' }

/**
 * Alles, was nicht ausdruecklich `letztes` heisst, ist `fragen`.
 *
 * ANDERSHERUM ALS BEIM SPIELE-SCHALTER, und mit Absicht: Dort war „an" der
 * Bestand, hier ist „fragen" der Bestand. Die Richtung des Zweifels zeigt
 * beide Male auf das, was die Box HEUTE tut — nicht auf das, was huebscher
 * aussieht. Ein verunglueckter Wert darf niemals dazu fuehren, dass eine
 * Box ungefragt in ein Kinderprofil startet.
 */
export function startNormalisieren(roh: unknown): StartEinstellungen {
  const r = (roh ?? {}) as Record<string, unknown>
  return { modus: r.modus === 'letztes' ? 'letztes' : 'fragen' }
}
