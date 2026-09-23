/**
 * ANMELDEWACHE (E121) — merkt, wenn die Box still aus Spotifys Geraeteliste
 * faellt, und stoesst soloist wieder an.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Am 04.09.2026 ist die Box DREIMAL an einem Tag aus der Geraeteliste
 * verschwunden — soloist sagt „logged in", laeuft laut systemd, und ist bei
 * Spotify trotzdem nicht registriert. Jeder Spotify-Tipp endet dann in
 * `spotify-anmeldung`, und fuer ein Kind sieht die Box kaputt aus. Ein
 * `systemctl restart soloist` registriert binnen sechs Sekunden neu — nur
 * merkt ohne diese Wache niemand, DASS es noetig ist. `systemctl is-active`
 * ist fuer diese Frage wertlos (E117): der Dienst LAEUFT ja.
 *
 * ══ REINE LOGIK, wie kinderzeit.ts ═════════════════════════════════════════
 * Kein Netz, keine Uhr, kein systemctl — nur das Urteil. Den Takt, die
 * Bereitschaftsfrage und den Neustart fuehrt server.ts; ob eines davon
 * ANGEBRACHT ist, entscheidet diese Funktion und ist damit ohne Geraet
 * pruefbar. Eine Wache, die nur am lebenden Geraet zu testen ist, testet
 * niemand — und eine Wache, die faelschlich neu startet, unterbricht Musik.
 *
 * ══ DIE REGELN, und warum jede so herum steht ══════════════════════════════
 *   * Nur bei `engine = soloist`. Mit librespot laeuft der Dienst gar nicht
 *     (ExecCondition); ihn neu zu starten waere Rauschen im Protokoll.
 *   * Nur das echte „box-fehlt" zaehlt. `nicht-pruefbar` (Netz, 429, Token)
 *     zaehlt NICHT und setzt NICHT zurueck — eine Stoerung der Frage ist
 *     keine Auskunft ueber die Box [Richtung des Zweifels].
 *   * ZWEI Treffer in Folge vor dem Neustart: ein einzelner kann der
 *     Augenblick zwischen Abriss und Selbstheilung sein (heute Morgen kam
 *     die Box einmal von allein wieder).
 *   * NIE waehrend Spotify hoerbar spielt: ein Neustart risse den Ton ab.
 *     Der Zustand „spielt und fehlt in der Liste" ist widerspruechlich —
 *     dann ist eher die Liste verlogen als die Wiedergabe.
 *   * ABSTAND zwischen Neustarts: hilft der erste nicht, ist der Fehler
 *     woanders, und eine Neustart-Schleife macht die Box erst recht taub.
 */

export const ANMELDEWACHE_TREFFER_BIS_NEUSTART = 2
export const ANMELDEWACHE_NEUSTART_ABSTAND_MS = 10 * 60 * 1000

export interface AnmeldewacheLage {
  /** `spotify.engine` aus der Konfiguration — nur 'soloist' wird bewacht. */
  engine: string
  /** `bereit` aus der Bereitschaftsauskunft (true/false/undefined). */
  bereit: unknown
  /** `grund` derselben Auskunft — nur 'box-fehlt' ist ein Treffer. */
  grund: string
  /** Spielt gerade hoerbar Spotify? (currentPlayer === 'spotify' && playing) */
  spieltSpotify: boolean
  /** Wie viele „box-fehlt" bisher IN FOLGE gesehen wurden. */
  treffer: number
  /** Millisekunden seit dem letzten Neustart durch diese Wache (Infinity, wenn nie). */
  seitNeustartMs: number
}

export interface AnmeldewacheUrteil {
  tat: 'nichts' | 'merken' | 'neustart'
  /** Der neue Zaehlerstand, den der Aufrufer festhaelt. */
  treffer: number
  /** Fuers Protokoll — nur bei 'merken' und 'neustart' gefuellt. */
  meldung?: string
}

export function anmeldewacheUrteil(l: AnmeldewacheLage): AnmeldewacheUrteil {
  if (l.engine !== 'soloist') return { tat: 'nichts', treffer: 0 }
  // Ein klares JA heilt den Zaehler — die Box ist da, was vorher war, ist
  // Geschichte.
  if (l.bereit === true) return { tat: 'nichts', treffer: 0 }
  // Alles ausser dem echten Befund laesst den Zaehler STEHEN: weder Treffer
  // noch Entwarnung. `bereit: false` gibt es nur mit `grund: box-fehlt`
  // (spotify-web.ts), aber die Wache verlaesst sich nicht darauf.
  if (l.bereit !== false || l.grund !== 'box-fehlt') return { tat: 'nichts', treffer: l.treffer }
  if (l.spieltSpotify) {
    return {
      tat: 'nichts',
      treffer: l.treffer,
      meldung: 'box-fehlt gemeldet, aber Spotify spielt hoerbar — kein Neustart in laufende Musik',
    }
  }
  const treffer = l.treffer + 1
  if (treffer >= ANMELDEWACHE_TREFFER_BIS_NEUSTART && l.seitNeustartMs > ANMELDEWACHE_NEUSTART_ABSTAND_MS) {
    return { tat: 'neustart', treffer: 0, meldung: `box-fehlt zum ${treffer}. Mal in Folge — soloist wird neu gestartet` }
  }
  return { tat: 'merken', treffer, meldung: `box-fehlt (${treffer}/${ANMELDEWACHE_TREFFER_BIS_NEUSTART})` }
}
