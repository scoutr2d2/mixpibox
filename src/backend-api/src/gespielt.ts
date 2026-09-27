/**
 * Was wurde gespielt - wie oft und wann zuletzt?
 *
 * WOFUER: die Startseite soll „Zuletzt gespielt" und „Oft gehoert" zeigen
 * koennen. Bisher zaehlt in der ganzen Box NICHTS mit; beide Ueberschriften
 * waeren ohne diese Daten eine Behauptung.
 *
 * GEMELDET WIRD VON DER OBERFLAECHE, nicht aus der URL des Abspielbefehls
 * geraten: sie kennt das Medium vollstaendig (Kennung, Titel, Interpret, Bild),
 * waehrend in der URL bei Jellyfin nur ein Datenstrom steht. Was nicht ueber
 * die Oberflaeche gestartet wurde, faellt damit durch - das ist selten und
 * ehrlicher als ein falscher Zaehlerstand.
 *
 * REIN: keine Datei, keine Uhr. Der Aufrufer haelt den Stand und reicht die
 * Zeit herein.
 */

/** Ein Eintrag im Verlauf. */
export interface Gespielt {
  /** Der Schluessel des Mediums - dieselbe Form wie in der Oberflaeche. */
  key: string
  /** Wie oft gestartet. */
  anzahl: number
  /** Wann zuletzt (ms seit 1970). */
  zuletzt: number
  /** Damit die Kachel ohne Nachschlagen gebaut werden kann. */
  title?: string
  artist?: string
  type?: string
  category?: string
  cover?: string
  id?: string
  playlistid?: string
}

/** So viele Medien werden behalten. */
export const MAX_EINTRAEGE = 200

/**
 * Zwei Starts desselben Mediums binnen dieser Zeit zaehlen als EINER.
 *
 * Ein Kind tippt gern mehrfach, und die Oberflaeche startet beim Fortsetzen
 * ebenfalls neu. Ohne diese Sperre stuende ein einziges Hoeren mit fuenf im
 * Zaehler und verdraengte alles andere aus „Oft gehoert".
 */
export const SPERRE_MS = 60_000

/**
 * Einen Start vermerken.
 *
 * @param stand  bisheriger Verlauf (wird NICHT veraendert)
 * @param neu    was gestartet wurde
 * @param jetzt  Zeitpunkt in ms
 */
export function vermerken(
  stand: readonly Gespielt[],
  neu: Partial<Gespielt> & { key: string },
  jetzt: number,
): Gespielt[] {
  const key = String(neu?.key || '').trim()
  if (!key) return [...stand]

  const raus = stand.map((e) => ({ ...e }))
  const da = raus.find((e) => e.key === key)
  if (da) {
    // Innerhalb der Sperre nur die Zeit nachfuehren, nicht den Zaehler.
    if (jetzt - (da.zuletzt || 0) >= SPERRE_MS) da.anzahl = (da.anzahl || 0) + 1
    da.zuletzt = jetzt
    for (const f of ['title', 'artist', 'type', 'category', 'cover', 'id', 'playlistid'] as const) {
      if (neu[f]) (da as Record<string, unknown>)[f] = neu[f]
    }
  } else {
    raus.push({ ...neu, key, anzahl: 1, zuletzt: jetzt })
  }

  // Das AELTESTE faellt heraus, nicht das seltenste: was seit Wochen niemand
  // hoert, gehoert auf keine Startseite - auch wenn es frueher oft lief.
  raus.sort((a, b) => (b.zuletzt || 0) - (a.zuletzt || 0))
  return raus.slice(0, MAX_EINTRAEGE)
}

/** Die zuletzt gespielten, das Neueste zuerst. */
export function zuletzt(stand: readonly Gespielt[], max = 12): Gespielt[] {
  return [...stand].sort((a, b) => (b.zuletzt || 0) - (a.zuletzt || 0)).slice(0, Math.max(0, max))
}

/**
 * Die haeufigsten, das Meiste zuerst.
 *
 * Erst ab ZWEI Starts: was einmal lief, ist nicht „oft gehoert". Bei gleichem
 * Stand entscheidet die juengere Zeit, damit die Reihenfolge nicht springt.
 */
export function haeufigste(stand: readonly Gespielt[], max = 12): Gespielt[] {
  return [...stand]
    .filter((e) => (e.anzahl || 0) >= 2)
    .sort((a, b) => (b.anzahl || 0) - (a.anzahl || 0) || (b.zuletzt || 0) - (a.zuletzt || 0))
    .slice(0, Math.max(0, max))
}

/**
 * Ist das ueberhaupt eine Meldung?
 *
 * Der Endpunkt nimmt Fremdes entgegen; was nicht passt, wird verworfen statt
 * gezaehlt. Ein kaputter Eintrag verdirbt sonst beide Listen.
 */
export function istMeldung(x: unknown): x is Partial<Gespielt> & { key: string } {
  if (!x || typeof x !== 'object') return false
  const m = x as Record<string, unknown>
  return typeof m.key === 'string' && !!m.key.trim()
}

/** Die Felder eines Roheintrags, die fuer eine Meldung gebraucht werden. */
interface RohEintrag {
  type?: unknown
  id?: unknown
  playlistid?: unknown
  artist?: unknown
  title?: unknown
  category?: unknown
  cover?: unknown
}

/**
 * Aus einem ROHEINTRAG der Medienliste eine Meldung bauen.
 *
 * WOFUER: Bisher bildete NUR die Angular-Oberflaeche den Schluessel
 * (player.service.ts:249-263). Die neue Oberflaeche kann das nicht — ihr
 * Vertrag (`/api/werke`) fuehrt `type` gar nicht, und fuer lokale Eintraege
 * traegt sie einen NORMALISIERTEN Schluessel (`lokal:t:…`), wo die alte App
 * die rohen Namen benutzt. Sie meldete deshalb GAR NICHTS, und „Oft gehoert"
 * waere mit jedem Tag, an dem die neue Oberflaeche laeuft, veralteter geworden.
 *
 * DIE FORMEL IST WOERTLICH DIESELBE wie dort — das ist der ganze Zweck:
 *     kern = id || playlistid || `${artist}|${title}`
 *     key  = `${type || 'medium'}:${kern}`
 * Weicht sie ab, stuende dasselbe Album zweimal im Verlauf, je nachdem welche
 * Oberflaeche es gestartet hat. Wer hier etwas aendert, muss es DORT auch
 * aendern.
 *
 * Gibt `null` zurueck, wenn kein brauchbarer Kern herauskommt — dann wird
 * nichts vermerkt, statt einen Eintrag mit leerem Schluessel anzulegen.
 */
export function meldungAusEintrag(e: RohEintrag | null | undefined): (Partial<Gespielt> & { key: string }) | null {
  if (!e || typeof e !== 'object') return null
  const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
  const kern = s(e.id) || s(e.playlistid) || `${s(e.artist)}|${s(e.title)}`
  if (!kern || kern === '|') return null
  return {
    key: `${s(e.type) || 'medium'}:${kern}`,
    title: s(e.title) || undefined,
    artist: s(e.artist) || undefined,
    type: s(e.type) || undefined,
    category: s(e.category) || undefined,
    cover: s(e.cover) || undefined,
    id: s(e.id) || undefined,
    playlistid: s(e.playlistid) || undefined,
  }
}
