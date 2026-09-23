/**
 * WELCHES WERK LAEUFT GERADE? — vom Server beantwortet, nicht von der Seite.
 *
 * ══ WARUM DIESE DATEI EXISTIERT ════════════════════════════════════════════
 *
 * Die Frage „zu welcher Kachel gehoert der laufende Ton?" beantwortete bisher
 * die OBERFLAECHE — aus drei Gedaechtnissen, die alle nur im Speicher der
 * SEITE leben (`zuletztGestartet`, `laufendeFolgen`, localStorage `GEMERKT`
 * in NewDesign/app.js). Der Kiosk laedt aber staendig neu (Einschalten,
 * Ausrollen), und mpv spielt dabei weiter: nach JEDEM Neuladen war die Seite
 * taub, bis wieder jemand antippte. tools/marke-ohne-eigenen-start.mjs misst
 * genau diesen Alltag und nennt ihn zu Recht keinen Randfall.
 *
 * DABEI WEISS DER SERVER ES LAENGST. Jeder Start laeuft durch ihn — ueber
 * `/api/spielen` oder den `/player`-Proxy —, und im Startaugenblick kennt er
 * WERK und TITELLISTE vollstaendig. Er vergass es nur sofort wieder.
 * `letzterStart` daneben merkt sich die Liste zwar, aber fuer eine ANDERE
 * Frage (Sprung statt Neustart) und wird beim Ein-Befehl-Start bewusst
 * geleert, obwohl das Werk sehr wohl laeuft. Zwei Fragen, zwei Gedaechtnisse.
 *
 * ══ DIE BAUART: PUR, WIE laufendes-bild.ts ═════════════════════════════════
 *
 * Kein Netz, keine Uhr, kein Modulzustand. Das Gedaechtnis selbst haelt
 * server.ts (ein `let` neben `letzterStart`); hier stehen nur die Urteile.
 * So sind die Grenzfaelle ohne laufenden Abspieldienst pruefbar.
 *
 * ══ LIEBER KEINE AUSKUNFT ALS EINE FALSCHE ═════════════════════════════════
 *
 * Dieselbe Regel, die in app.js am GEMERKT-Speicher steht („lieber keine
 * Marke als eine an der falschen Kachel"): Passt der gemeldete Titelname
 * nicht zum gemerkten, ist die Antwort null — dann spielt eine Schlange, die
 * dieses Gedaechtnis nicht kennt (ein Start am Server vorbei, direkt auf dem
 * Abspieldienst). Der Namenskern kommt aus laufendes-bild.ts und ist dort
 * wortgleich zum Frontend begruendet.
 */

import { namensKern } from './laufendes-bild.js'

/** Ein gemerkter Titel — die Felder, die fuer die Zuordnung zaehlen. */
export interface GemerkterTitel {
  nr: number
  /** Kennung aus `/inhalt` (ARD-Folge, Jellyfin-Id, lokal `pfad#nr`) — '' wenn keine. */
  id: string
  /** Spotify-Stueckadresse — '' wenn keine. */
  uri: string
  name: string
  /** Die Quelle DIESES Titels — in der Mischliste (E108) kann Titel 1 lokal
   *  liegen und Titel 2 aus Jellyfin kommen; die Plakette am Player-Cover
   *  (`laufendeQuelle`, app.js) wechselt mit dem Titel. */
  quelle: string
}

/** Was der Server sich beim Start merkt. */
export interface GemerkterStart {
  /** Der `medienSchluessel` des gestarteten Werks. */
  werk: string
  /** Der Dienst der gewaehlten Quelle (`lokal`, `spotify`, `jellyfin`, `ard`, …). */
  quelle: string
  /**
   * Auf WELCHER MASCHINE der Start ausgefuehrt wurde — und das ist NICHT
   * dasselbe wie `quelle`, und zwar nicht als Spitzfindigkeit: Beim
   * E108-Mischweg heisst die gewaehlte Quelle des verschmolzenen Werks
   * `spotify`, die Strecke spielt aber ueber mpv (lokale Schwesterspuren).
   * Am Geraet gemessen (12.09.2026, "Mission Erde" nach der Dubletten-
   * Bereinigung): das Urteil verwarf mit "mpv spielt, Spotify gemerkt"
   * genau den Start, den es benennen sollte. Die Verwerfungsregel haengt
   * deshalb HIER, `quelle` bleibt Auskunft.
   */
  maschine: 'mpv' | 'spotify'
  /** Die volle Warteschlange — LEER beim Ein-Befehl-Start (m3u, Radio,
   *  Spotify): dessen Schlange kennt nur der Abspieldienst. */
  titel: GemerkterTitel[]
}

/** Was `/player/local` meldet — nur die Felder, die hier zaehlen. */
export interface SpielerMeldung {
  currentPlayer?: unknown
  spielerArt?: unknown
  currentTracknr?: unknown
  currentTrackname?: unknown
}

/** Die Auskunft an die Oberflaeche — haengt als `laeuft` an `/player/local`. */
export interface LaufendeAuskunft {
  werk: string
  quelle: string
  /** null, wenn nur das Werk sicher ist (Ein-Befehl-Start, Startaugenblick,
   *  Uebergabe an Spotify). */
  titelNr: number | null
  titelId: string
  titelUri: string
  titelName: string
  /** Die Quelle des laufenden TITELS (Mischliste!) — '' wenn unbekannt. */
  titelQuelle: string
}

function text(x: unknown): string {
  return typeof x === 'string' ? x.trim() : ''
}

/**
 * Aus den Titeln einer `/inhalt`-Antwort das ziehen, was gemerkt wird.
 *
 * DIESELBE LISTE, DIE DIE OBERFLAECHE BEKOMMT: `/api/spielen` gibt sie als
 * `titel` zurueck, und die Kacheln beim Aufklappen bauen ihre Kennungen aus
 * exakt denselben Feldern (`t.uri`, sonst `t.id`). Wer hier eine andere
 * Quelle naehme, vergliche spaeter zwei Wahrheiten miteinander.
 */
export function titelZumMerken(roh: unknown): GemerkterTitel[] {
  if (!Array.isArray(roh)) return []
  return roh.map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>
    return {
      nr: Math.round(Number(o.nr)) || i + 1,
      id: o.id == null ? '' : String(o.id),
      uri: o.uri == null ? '' : String(o.uri),
      name: text(o.titel),
      quelle: text(o.quelle),
    }
  })
}

/**
 * Das Urteil: Was laeuft gerade — gemessen am gemerkten Start und an dem, was
 * der Abspieldienst JETZT meldet?
 *
 * DIE WEICHE IST DIE MASCHINE, nicht die gemerkte Quelle:
 *
 *   * Spielt SPOTIFY, gilt das gemerkte Werk auch dann, wenn die Maschine
 *     des Starts mpv war — das ist die E108-Uebergabe (eine lokal
 *     beginnende Strecke wechselt mitten im Album zu Spotify, das WERK
 *     bleibt dasselbe). Ein Titel wird dann nicht genannt: die
 *     Spotify-Stueckadresse liefert `/player/state`, und `currentTracknr`
 *     zaehlt dort nichts.
 *   * Spielt mpv, waehrend die gemerkte MASCHINE Spotify ist, ist die
 *     Antwort null: diese Richtung gibt es vom Server aus nicht — dann hat
 *     jemand anders gestartet. Verglichen wird die Maschine, NICHT die
 *     Quelle: der E108-Mischweg startet mpv unter der Quelle `spotify`
 *     (Begruendung am Feld `maschine`).
 *
 * DER TITEL NUR MIT ZWEI BEWEISEN: die Nummer muss in die gemerkte Liste
 * passen, UND der gemeldete Name muss zum gemerkten passen (Kern-Vergleich,
 * beide Richtungen — mpv meldet mal den vollen, mal einen gekuerzten Namen).
 * Nummer ohne Namen (Startaugenblick, leeres Feld) ergibt nur das Werk;
 * Name, der WIDERSPRICHT, ergibt gar nichts.
 */
export function laufendeAuskunft(
  start: GemerkterStart | null | undefined,
  meldung: SpielerMeldung | null | undefined,
): LaufendeAuskunft | null {
  if (!start || !meldung) return null
  const nurWerk: LaufendeAuskunft = {
    werk: start.werk,
    quelle: start.quelle,
    titelNr: null,
    titelId: '',
    titelUri: '',
    titelName: '',
    titelQuelle: '',
  }

  const wer = text(meldung.currentPlayer) || text(meldung.spielerArt)
  if (wer === 'spotify') return nurWerk
  if (start.maschine === 'spotify') return null

  if (!start.titel.length) return nurWerk
  const nr = Math.round(Number(meldung.currentTracknr) || 0)
  if (nr < 1 || nr > start.titel.length) return nurWerk
  const t = start.titel[nr - 1]

  const gemeldet = namensKern(meldung.currentTrackname)
  const gemerkt = namensKern(t.name)
  if (gemeldet && gemerkt && !gemeldet.includes(gemerkt) && !gemerkt.includes(gemeldet)) {
    return null
  }

  return {
    werk: start.werk,
    quelle: start.quelle,
    titelNr: nr,
    titelId: t.id,
    titelUri: t.uri,
    titelName: t.name,
    titelQuelle: t.quelle,
  }
}
