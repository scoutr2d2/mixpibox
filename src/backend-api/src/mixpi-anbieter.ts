/**
 * DER ANBIETER-SCHALTER (E76) — ein Dienst laesst sich abschalten, ohne dass
 * die Box bricht.
 *
 * ══ WORUM ES GEHT ══════════════════════════════════════════════════════════
 *
 * Betreiber, 22.08.2026: „ziel der plugins ist komplette features ohne brechen
 * der box an und auszuschalten". Der Schalter ist die erste Haelfte davon —
 * unabhaengig vom Plugin-System, denn er muss auch fuer das gelten, was noch
 * fest im Kern wohnt (Spotify, Jellyfin, ARD Sounds).
 *
 * ══ DIE DREI REGELN ════════════════════════════════════════════════════════
 *
 * 1. FEHLT DER SCHALTER, IST DER DIENST AN. Bestandsboxen kennen das Feld
 *    nicht, und eine Aktualisierung darf keiner Familie den Ton abdrehen.
 *    Nur ein ausdrueckliches `false` schaltet ab.
 *
 * 2. ABGESCHALTET IST NICHT KAPUTT UND NICHT WEG. Die Kacheln bleiben stehen
 *    (ausgegraut mit Grund — das Kind sucht sie sonst), die Verwaltung zeigt
 *    den Anbieter mit eigenem Stand. Verstecken ist verboten; die Begruendung
 *    steht seit langem in werke.ts beim `fehlt`-Feld und gilt hier genauso.
 *
 * 3. VERWEIGERT WIRD AN EINER TUER, nicht an fuenf Zweigen. Jeder Startbefehl
 *    jeder Oberflaeche laeuft durch den /player-Proxy (der Abspieldienst hoert
 *    nur auf 127.0.0.1) — dort steht schon die Kinderzeit-Pruefung mit dem
 *    Formular „403 + JSON mit Grund", das beide Startwege des Kinderschirms
 *    auswerten. Der Schalter benutzt dieselbe Tuer und dasselbe Formular.
 *
 * ══ WAS BEWUSST NICHT ABGESCHALTET WIRD ════════════════════════════════════
 *
 * Lokale Dateien, Radio und RSS sind Grundfunktion der Box, keine Anbieter —
 * es gibt fuer sie keinen Schalter. Und die SUCHE der Verwaltung fragt einen
 * abgeschalteten Dienst weiter an: Abschalten betrifft das Abspielen und die
 * Kacheln der Kinder, nicht die Arbeit der Eltern am Regal.
 */

/** Die Dienste, die sich schalten lassen — Schluessel wie in `dienstVon()`. */
export const SCHALTBARE_DIENSTE = ['spotify', 'jellyfin', 'ard'] as const
export type SchaltbarerDienst = (typeof SCHALTBARE_DIENSTE)[number]

/** Wo der Schalter in der Konfiguration wohnt, je Dienst. */
const KONFIG_GRUPPE: Record<SchaltbarerDienst, string> = {
  spotify: 'spotify',
  jellyfin: 'jellyfin',
  ard: 'ard',
}

/** Was am Schirm steht, wenn der Dienst gemeint ist. */
export const DIENST_WORT: Record<SchaltbarerDienst, string> = {
  spotify: 'Spotify',
  jellyfin: 'Jellyfin',
  ard: 'ARD Sounds',
}

function istSchaltbar(x: unknown): x is SchaltbarerDienst {
  return typeof x === 'string' && (SCHALTBARE_DIENSTE as readonly string[]).includes(x)
}

/**
 * Ist dieser Dienst an?
 *
 * NUR EIN AUSDRUECKLICHES `false` SCHALTET AB. Fehlende Gruppe, fehlendes
 * Feld, kaputte Konfiguration, unbekannter Dienst — alles heisst „an". Die
 * vorsichtige Richtung: ein Lesefehler darf keiner Familie den Ton abdrehen,
 * und ein Dienst ohne Schalter (lokal, radio, rss) laesst sich nicht
 * versehentlich ausschalten.
 */
export function dienstAktiv(konfig: unknown, dienst: unknown): boolean {
  if (!istSchaltbar(dienst)) return true
  const gruppe = (konfig as Record<string, unknown>)?.[KONFIG_GRUPPE[dienst]]
  if (!gruppe || typeof gruppe !== 'object') return true
  return (gruppe as Record<string, unknown>).aktiv !== false
}

/** Alle gerade abgeschalteten Dienste. Leer im Normalfall. */
export function abgeschalteteDienste(konfig: unknown): SchaltbarerDienst[] {
  return SCHALTBARE_DIENSTE.filter((d) => !dienstAktiv(konfig, d))
}

/**
 * Welchen schaltbaren Anbieter ein Spieler-Befehl anspricht — oder `null`.
 *
 * ══ NUR NACH `istStartbefehl` RUFEN ════════════════════════════════════════
 *
 * Diese Funktion kennt bewusst nur die START-Verben (dieselben, die die
 * START-Regex in kinderzeit.ts aufzaehlt). Zustandsabfragen (`/state`),
 * Lautstaerke (`/setvolume`) und Stop gehen sie nichts an — eine Box mit
 * abgeschaltetem Spotify soll einen laufenden Titel noch ANHALTEN koennen.
 * Die Reihenfolge (erst Startbefehl-Pruefung, dann diese Frage) liegt beim
 * Aufrufer, genau wie bei der Kinderzeit.
 *
 * Die Pfadform ist `/<raum>/<verb>/…`; gematcht wird positionsgenau mit
 * `(\/|$)`, nicht per Teilwortsuche — `ard` darf nicht in einem Titel wie
 * „Leopard" haengenbleiben, der zufaellig im Pfad steht.
 */
export function anbieterAusBefehl(pfad: unknown): SchaltbarerDienst | null {
  if (typeof pfad !== 'string') return null
  const p = pfad.toLowerCase()
  if (/\/spotify\/now(\/|$)/.test(p)) return 'spotify'
  if (/\/(jellyfin|jfqueue)(\/|$)/.test(p)) return 'jellyfin'
  if (/\/(ard|ardqueue)(\/|$)/.test(p)) return 'ard'
  return null
}

/**
 * Das Verweigerungs-Formular fuer den Proxy — parallel zum Kinderzeit-Urteil.
 *
 * `anbieterAus: true` ist der Erkennungsanker fuer die Oberflaeche (wie
 * `kinderzeit: true` dort). Der Grund ist ein ganzer Satz, den man einem Kind
 * vorlesen kann; die Oberflaeche zeigt ihn woertlich.
 */
export function verweigerung(
  dienst: SchaltbarerDienst,
  /* WARUM er schweigt — der Satz muss zum WEG zurueck passen (E127,
   * 04.09.2026). Am Geraet gemessen schickte der Nachtmodus den Betreiber
   * in die Streaming-Dienste, wo der Schalter ordnungsgemaess AN steht: eine
   * Meldung, die in die Irre fuehrt, ist schlimmer als eine knappe. */
  wegen: 'schalter' | 'nachtmodus' = 'schalter',
): { anbieterAus: true; dienst: string; grund: string } {
  return {
    anbieterAus: true,
    dienst,
    grund:
      wegen === 'nachtmodus'
        ? `${DIENST_WORT[dienst]} schweigt gerade: Nachtmodus — die Box nimmt auf. Alles andere spielt weiter; umstellen unter Verwaltung → Aufzeichnen.`
        : `${DIENST_WORT[dienst]} ist gerade abgeschaltet. Zum Anschalten: Verwaltung → Streaming-Dienste.`,
  }
}
