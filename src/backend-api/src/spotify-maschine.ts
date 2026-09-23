/**
 * Die Wahl der SPOTIFY ENGINE (E42) — der reine Kern.
 *
 * (Bis 21.08.2026 „Tonmaschine"; das Wort bezeichnet in spotify-control.ts
 * etwas anderes, naemlich Spotify gegen mplayer.)
 *
 * REIN: kein Dateisystem, kein systemctl, keine Uhr. Der Server reicht herein,
 * was er weiss, und bekommt ein Urteil. So laesst sich die einzige Stelle, die
 * ueber den Wechsel entscheidet, pruefen, ohne dass eine Unit faellt.
 *
 * WARUM DIE PRUEFUNG STRENG IST: `engine=soloist` ohne Schluessel hiesse eine
 * Box ohne Spotify — soloist startet, scheitert an der Anmeldung, und
 * librespot laeuft wegen der Condition trotzdem nicht. Der stumme Zustand,
 * den E42 um jeden Preis vermeiden will. Deshalb wird die Wahl ABGELEHNT,
 * nicht angenommen und repariert.
 */

export const MASCHINEN = ['librespot', 'soloist'] as const
export type Maschine = (typeof MASCHINEN)[number]

/** Wie viele Tage ein Soloist-Build ab BAU-Datum traegt. Von Spotify gesetzt. */
export const SOLOIST_VERFALL_TAGE = 90

export interface MaschinenUrteil {
  ok: boolean
  engine?: Maschine
  grund?: string
}

/** Ist diese Wahl vollstaendig und ungefaehrlich? */
export function maschinenWahlPruefen(engine: unknown, hatSchluessel: boolean): MaschinenUrteil {
  const e = String(engine ?? '').trim()
  if (!(MASCHINEN as readonly string[]).includes(e)) {
    return { ok: false, grund: `unbekannte Maschine "${e}" — es gibt ${MASCHINEN.join(' und ')}` }
  }
  if (e === 'soloist' && !hatSchluessel) {
    return {
      ok: false,
      grund:
        'Soloist braucht den Soloist API Key (spak_…) — erzeugen unter developer.spotify.com/dashboard, Seite "Spotify Soloist API Key", mit dem Konto der Box',
    }
  }
  return { ok: true, engine: e as Maschine }
}

/*
 * BAU-DATUM UND VERFALL SIND UMGEZOGEN (E82): die Rechnung wohnt jetzt im
 * Engine-Plugin plugins/mixpi-soloist (bauDatumAus/verfallAus, samt Zeugen) —
 * denn die Auskunft ueber die Maschine kommt seither von dort. Hier bleibt,
 * was der HEBEL braucht: die Wahl-Pruefung fuer PUT /api/spotify/maschine.
 * SOLOIST_VERFALL_TAGE bleibt exportiert, weil die 90 der Grund sind, warum
 * soloist nie Vorgabe sein darf (siehe Kopf).
 */
