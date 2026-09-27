/**
 * DER SPIELSTAND — eine Auskunft, zwei Quellen (E75).
 *
 * ══ WORUM ES GEHT ══════════════════════════════════════════════════════════
 *
 * `/api/spotify/laeuft` fragt bis heute Spotifys Web-API: alle drei Sekunden,
 * ueber das Internet, mit einem Token, das ablaufen kann. Soloist liefert
 * dasselbe LOKAL und von sich aus — er hat einen WebSocket, der auf dieser Box
 * seit jeher offen steht (`-w 127.0.0.1:5033`) und den bisher NICHTS benutzt.
 *
 * ══ NACH FAEHIGKEIT, NICHT NACH MOTOR ══════════════════════════════════════
 *
 * Betreiber, 22.08.2026: „normal ist webapi falls verfuegbar wechselt man in
 * beiden auf websocket egal woher".
 *
 * Der erste Entwurf wollte nach der MASCHINE verzweigen (Soloist → WebSocket,
 * librespot → Web-API). Das waere bruechig gewesen: am selben Vormittag war
 * Soloists WebSocket zehn Minuten lang weg, waehrend gekoppelt wurde
 * (`ws: not available`) — eine Box, die „Soloist laeuft, also WebSocket"
 * denkt, horcht dann ins Leere.
 *
 * Gefragt wird deshalb nicht „welcher Motor", sondern „gibt es einen lokalen
 * Draht". Gibt es ihn, wird er genommen; faellt er weg, uebernimmt die Web-API
 * im Betrieb, nicht erst beim naechsten Start.
 *
 * ══ WAS DIESES MODUL IST UND WAS NICHT ═════════════════════════════════════
 *
 * NUR DIE UEBERSETZUNG. Kein Netz, keine Verbindung, keine Uhr — zwei fremde
 * Formen hinein, EINE Form hinaus. Genau hier gehen solche Umbauten still
 * kaputt (ein Feld heisst anders, eine Kennung traegt ein Praefix), und genau
 * hier laesst es sich ohne Box pruefen.
 */

/**
 * Die Form, die `/api/spotify/laeuft` seit dem 12.08.2026 liefert.
 *
 * SIE IST DER VERTRAG, nicht ein Vorschlag: der Kinderschirm liest sie, und
 * `albumId`/`kontextUri` haengen am „Quick Add" fuer boxfremde Inhalte. Wer
 * hier ein Feld anders fuellt, merkt es erst, wenn eine Kachel nicht mehr
 * startet.
 */
export interface Spielstand {
  aktiv: boolean
  aufDieserBox: boolean
  spielt: boolean
  geraet: string
  titel: string
  interpret: string
  album: string
  bild: string
  positionMs: number
  dauerMs: number
  albumId: string
  albumName: string
  kontextUri: string
  kontextArt: string
}

export const SPIELSTAND_LEER: Spielstand = {
  aktiv: false,
  aufDieserBox: false,
  spielt: false,
  geraet: '',
  titel: '',
  interpret: '',
  album: '',
  bild: '',
  positionMs: 0,
  dauerMs: 0,
  albumId: '',
  albumName: '',
  kontextUri: '',
  kontextArt: '',
}

function text(x: unknown): string {
  return typeof x === 'string' ? x : ''
}

function zahl(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

/**
 * Aus `spotify:album:2ITVvr…` wird `2ITVvr…`.
 *
 * DIE WEB-API LIEFERT DIE NACKTE KENNUNG, der WebSocket die volle URI. Wer das
 * uebersieht, baut eine Kachel, deren Kennung ein `spotify:album:` vorne
 * traegt — sie sieht richtig aus und startet nichts.
 */
export function kennungAusUri(uri: unknown): string {
  const u = text(uri)
  if (!u) return ''
  const teile = u.split(':')
  return teile.length >= 3 ? teile[teile.length - 1] : u
}

/** Die Antwort von `GET /v1/me/player` in unsere Form. */
export function ausWebApi(roh: unknown, eigenName: unknown): Spielstand {
  const d = (roh ?? {}) as {
    is_playing?: unknown
    progress_ms?: unknown
    device?: { name?: unknown }
    context?: { uri?: unknown; type?: unknown }
    item?: {
      name?: unknown
      duration_ms?: unknown
      artists?: { name?: unknown }[]
      album?: { id?: unknown; name?: unknown; images?: { url?: unknown }[] }
      // EINE EPISODE HAT KEIN ALBUM (11.09.2026). Spotify liefert fuer einen
      // Podcast `currently_playing_type: 'episode'` — und dann ist `album`
      // schlicht NICHT DA. Das Bild steht stattdessen an der Episode selbst
      // (`item.images`) und noch einmal an der Sendung (`item.show.images`).
      images?: { url?: unknown }[]
      show?: { name?: unknown; images?: { url?: unknown }[] }
    }
  }
  const it = d.item ?? {}
  const geraet = text(d.device?.name)
  const eigen = text(eigenName) || 'MixPiBox'
  return {
    aktiv: Boolean(text(it.name)),
    // DER NAMENSVERGLEICH IST DIE SCHWAECHE DIESER QUELLE — mehr hat sie
    // nicht. Der WebSocket weiss es direkt (`is_active`).
    aufDieserBox: geraet.trim().toLowerCase() === eigen.trim().toLowerCase(),
    spielt: Boolean(d.is_playing),
    geraet,
    titel: text(it.name),
    interpret: (Array.isArray(it.artists) ? it.artists : [])
      .map((x) => text(x?.name))
      .filter(Boolean)
      .join(', '),
    album: text(it.album?.name) || text(it.show?.name),
    // DREI ORTE, IN DIESER REIHENFOLGE — Betreiber-Befund 11.09.2026: „zudem
    // laed das cover nicht wenn ich abspiele". Am Geraet nachgestellt mit
    // „Quarks Science Cops": `item.album` war null, `item.images` und
    // `item.show.images` trugen beide die Adresse. Hier stand nur der erste
    // Zugriff — bei jedem Podcast kam damit ein leeres Bild heraus, und die
    // Oberflaeche hatte nichts, womit sie es haette besser machen koennen.
    //
    // `server.ts` (Zeile ~9564) loeste denselben Fall laengst mit genau
    // diesem Rueckfall. Zwei Stellen lesen dieselbe Antwort, nur eine kannte
    // die Episode — das ist die Sorte Drift, die niemandem auffaellt, weil
    // beide fuer sich genommen richtig aussehen.
    bild:
      text(it.album?.images?.[0]?.url) ||
      text(it.images?.[0]?.url) ||
      text(it.show?.images?.[0]?.url),
    positionMs: zahl(d.progress_ms),
    dauerMs: zahl(it.duration_ms),
    albumId: text(it.album?.id),
    albumName: text(it.album?.name),
    kontextUri: text(d.context?.uri),
    kontextArt: text(d.context?.type),
  }
}

/**
 * Das grosse Bild aus Soloists `visual_identity.cover[]`.
 *
 * Die Web-API liefert `images[0]`, und das ist bei Spotify das GROESSTE. Der
 * WebSocket liefert benannte Groessen in unbestimmter Reihenfolge — am Geraet
 * gemessen: small, default, large, xlarge. Ohne diese Wahl bekaeme der
 * Kinderschirm ploetzlich das Daumennagelbild, und niemand wuesste warum.
 */
export function grosstesBild(cover: unknown): string {
  const liste = Array.isArray(cover) ? cover : []
  const rang: Record<string, number> = { xlarge: 4, large: 3, default: 2, small: 1 }
  let bestes = ''
  let besterRang = -1
  for (const c of liste) {
    const url = text((c as { url?: unknown })?.url)
    if (!url) continue
    const r = rang[text((c as { size?: unknown })?.size)] ?? 0
    if (r > besterRang) {
      besterRang = r
      bestes = url
    }
  }
  return bestes
}

/**
 * WO DER TITEL JETZT STEHT — hochgerechnet, nicht abgelesen.
 *
 * ══ DER UNTERSCHIED ZWISCHEN DEN QUELLEN ═══════════════════════════════════
 *
 * Die Web-API wird GEFRAGT und antwortet mit dem Stand von eben. Der WebSocket
 * MELDET, und zwar nur, wenn sich etwas aendert — dazwischen liegt sein
 * `position_ms` fest. Ein Fortschrittsbalken, der das roh nimmt, bleibt
 * zwischen zwei Ereignissen stehen und springt dann.
 *
 * Soloist liefert deshalb `timestamp_ms` und `speed` mit: Stand ZU DEM
 * ZEITPUNKT, und wie schnell es seither weitergeht. `speed: 0` heisst
 * angehalten — dann bleibt die Zahl mit Recht stehen.
 *
 * OHNE `jetztMs` WIRD NICHT GERECHNET. Ein Zeuge soll den rohen Wert pruefen
 * koennen, ohne die Uhr zu stellen ([[tests-duerfen-keine-zahlen-festnageln]]).
 */
export function positionJetzt(position: unknown, dauerMs: number, jetztMs?: number): number {
  const p = (position ?? {}) as { position_ms?: unknown; timestamp_ms?: unknown; speed?: unknown }
  const stand = zahl(p.position_ms)
  if (typeof jetztMs !== 'number' || !Number.isFinite(jetztMs)) return stand
  const stempel = zahl(p.timestamp_ms)
  if (!stempel) return stand
  const tempo = typeof p.speed === 'number' && Number.isFinite(p.speed) ? p.speed : 1
  if (tempo <= 0) return stand
  const gelaufen = (jetztMs - stempel) * tempo
  // NIE RUECKWAERTS UND NIE UEBER DAS ENDE. Ein Zeitstempel aus der Zukunft
  // (Uhr verstellt, RTC frisch gesetzt) machte den Balken sonst negativ.
  const roh = stand + Math.max(0, gelaufen)
  return dauerMs > 0 ? Math.min(roh, dauerMs) : roh
}

/**
 * Soloists `playback_state` (plus `auth_state`) in unsere Form.
 *
 * `auth_state` liefert `is_active` und `device_name` — beides steht auch im
 * vollen `playback_state`, aber nicht in den granularen Ereignissen. Der
 * Aufrufer haelt den letzten bekannten Stand und reicht ihn herein.
 */
export function ausSoloist(zustand: unknown, anmeldung: unknown, jetztMs?: number): Spielstand {
  const p = (zustand ?? {}) as {
    status?: unknown
    is_active?: unknown
    position?: { position_ms?: unknown; timestamp_ms?: unknown; speed?: unknown }
    context?: { uri?: unknown; entity_type?: unknown }
    item?: {
      decorations?: {
        identity?: { name?: unknown }
        visual_identity?: { cover?: unknown }
        parent?: { entity?: { uri?: unknown; decorations?: { identity?: { name?: unknown } } } }
        creators?: { entity?: { decorations?: { identity?: { name?: unknown } } } }[]
        playback?: { duration_ms?: unknown }
      }
    }
  }
  const a = (anmeldung ?? {}) as { is_active?: unknown; device_name?: unknown }
  const dek = p.item?.decorations ?? {}
  const titel = text(dek.identity?.name)
  const album = text(dek.parent?.entity?.decorations?.identity?.name)

  // `is_active` STEHT AN ZWEI STELLEN und kann sich unterscheiden: das
  // Ereignis `device_changed` frischt `auth_state` auf, ohne dass ein neuer
  // `playback_state` kommen muesste. Der juengere Wert gewinnt, und das ist
  // der aus der Anmeldung — sie wird bei JEDER Aenderung geschickt.
  const aktivesGeraet = typeof a.is_active === 'boolean' ? a.is_active : Boolean(p.is_active)

  return {
    aktiv: Boolean(titel),
    aufDieserBox: aktivesGeraet,
    spielt: text(p.status) === 'playing',
    geraet: text(a.device_name),
    titel,
    interpret: (Array.isArray(dek.creators) ? dek.creators : [])
      .map((c) => text(c?.entity?.decorations?.identity?.name))
      .filter(Boolean)
      .join(', '),
    album,
    bild: grosstesBild(dek.visual_identity?.cover),
    positionMs: positionJetzt(p.position, zahl(dek.playback?.duration_ms), jetztMs),
    dauerMs: zahl(dek.playback?.duration_ms),
    albumId: kennungAusUri(dek.parent?.entity?.uri),
    albumName: album,
    kontextUri: text(p.context?.uri),
    kontextArt: text(p.context?.entity_type),
  }
}
