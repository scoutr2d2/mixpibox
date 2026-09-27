/**
 * Traegt eine Kachel der Lane eine BRAUCHBARE gemerkte Stelle?
 *
 * WOZU: In den Lanes (Playlist -> Alben -> Titel) soll der Play-Knopf BLAU
 * statt neutral sein, wo es eine gemerkte Stelle gibt — die Farbregel des
 * Hauses, unveraendert uebernommen: gruenes/neutrales Play heisst „von vorn",
 * blaues Play heisst „weiterhoeren" (llmwiki
 * schwebende-fenster-favoriten-resume). Sie galt bisher nur im schwebenden
 * Fenster der klassischen Oberflaeche; hier wird sie durchgezogen, nicht neu
 * erfunden.
 *
 * WARUM DIESE DATEI UND NICHT app.js: Die Frage „gibt es hier eine brauchbare
 * Stelle?" ist eine reine Entscheidung mit unangenehmen Randfaellen (siehe
 * unten). In `NewDesign/app.js` laege sie hinter einem Netzabruf und waere nur
 * am lebenden Geraet zu pruefen. Sie steht deshalb hier und wird vom SERVER
 * angewandt — `/api/werke/<schluessel>/alben` traegt das Ergebnis je Album und
 * je Titel mit aus. Die Oberflaeche faerbt nur noch ein.
 *
 * KEIN ZUSAETZLICHER NETZABRUF JE KACHEL: Die gemerkte Stelle wird EINMAL
 * gelesen, waehrend die Alben ohnehin zusammengesetzt werden.
 *
 * NUR SPOTIFY-PLAYLISTEN KOMMEN HIER AN. Lanes gibt es nur fuer sie
 * (`/alben` antwortet sonst mit `grund: 'keinePlaylist'`). Deshalb zaehlt hier
 * ausschliesslich die Millisekunden-Stelle; die Prozentangabe der
 * mpv-Eintraege (llmwiki resume-lokal-ist-prozent-nicht-sekunden) taucht in
 * dieser Datei bewusst gar nicht erst auf — eine Einheit, die es hier nicht
 * gibt, kann auch nicht vertauscht werden.
 *
 * WAS HIER NICHT MEHR GEPRUEFT WIRD, weil es schon geprueft IST: ob die
 * Zaehlweise der gemerkten Nummer ueberhaupt stimmt. Das entscheidet
 * `nummerVerlaesslich` in weiterhoeren.ts — ein Playlist-Stand ohne die Marke
 * `resumeVersatzGeprueft` traegt die ALBUM-Nummer statt der Position in der
 * Playlist und faellt dort aus der Reihe (llmwiki
 * weiterhoeren-playlist-position). Diese Datei bekommt nur Zeilen, die
 * `weiterhoerbare()` bereits durchgelassen hat. Ein blauer Knopf auf einem
 * unbrauchbaren Stand waere schlimmer als gar kein blauer Knopf: er springt
 * in ein Kapitel, das das Kind nie gehoert hat, und das klingt nicht nach
 * einem Fehler, sondern nach kaputt.
 *
 * REIN: kein Netz, keine Dateien, keine Uhr.
 */

/** Was der blaue Knopf einsetzt — fertig, ohne weitere Umrechnung. */
export interface LaneStelle {
  /**
   * 1-basierte Nummer im ABSPIELZUSAMMENHANG, UNVERAENDERT einzusetzen.
   *
   * DIE +1-FALLE GILT HIER NICHT. Sie gilt fuer den `versatz` (Spotifys
   * eigene, 0-basierte Zaehlung), und die Addition steht an genau einer
   * Stelle — `startPlan` in spielfunktion.ts (bis E95/V Stufe 3 war das
   * `abspielBefehl` in app.js). Diese Zahl kommt aus `resume.json`
   * und ist bereits 1-basiert, so wie `weiterSpielen` sie ebenfalls
   * unveraendert weiterreicht. Wer hier noch einmal addiert, landet einen
   * Titel zu weit.
   */
  titelNr: number
  /** Stelle im laufenden Titel, MILLISEKUNDEN. Immer > 0 — siehe unten. */
  positionMs: number
}

/**
 * Das Stueck einer Weiterhoeren-Zeile, das hier gebraucht wird.
 *
 * Absichtlich nicht `Weiter` selbst: die Regel haengt an zwei Zahlen, und ein
 * Aufrufer, der nur diese beiden hat (ein Test etwa), soll sie nicht erst um
 * Titel, Interpret und Verlaufszeit ergaenzen muessen.
 */
export interface LaneZeile {
  /** 1-basiert. 0 heisst „von vorn" und ist hier ausdruecklich KEINE Stelle. */
  titelNr?: number | null
  /** Millisekunden im laufenden Titel, oder null. */
  positionMs?: number | null
}

/**
 * Die Zeile auf das Noetige eindampfen — oder `null`, wenn nichts uebrigbleibt.
 *
 * `titelNr < 1` FAELLT HERAUS. Die 0 heisst in `resume.json` „von vorn", und
 * genau das tut der gewoehnliche Knopf schon. Ein blauer Knopf, der dasselbe
 * tut wie der neutrale daneben, ist keine Auskunft, sondern eine Behauptung
 * ohne Inhalt.
 */
function ausZeile(z: LaneZeile | null | undefined): LaneStelle | null {
  if (!z || typeof z !== 'object') return null
  const nr = Number(z.titelNr)
  if (!Number.isFinite(nr) || nr < 1) return null
  const ms = Number(z.positionMs)
  return {
    titelNr: Math.round(nr),
    positionMs: Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0,
  }
}

/**
 * Traegt DIESER TITEL eine brauchbare Stelle?
 *
 * @param z        die Zeile aus /api/weiterhoeren zu DEM WERK, in dem der
 *                 Titel steht (oder null, wenn es keine gibt)
 * @param versatz  0-basierte Stelle des Titels in der Playlist
 *
 * ZWEI BEDINGUNGEN, und die zweite ist die, die man vergisst:
 *
 *   1. Es muss GENAU DIESER Titel sein (`versatz + 1 === titelNr`).
 *   2. Es muss MITTEN IM TITEL sein. Steht die Stelle bei 0 ms, faengt
 *      „weiterhoeren" am Anfang dieses Titels an — und das tut ein Tipp auf
 *      die Titelkachel ohnehin. Der blaue Knopf verspraeche dann etwas
 *      anderes, als er tut.
 */
export function stelleAmTitel(z: LaneZeile | null | undefined, versatz: number): LaneStelle | null {
  const s = ausZeile(z)
  if (!s) return null
  const v = Number(versatz)
  if (!Number.isFinite(v) || v < 0) return null
  if (Math.round(v) + 1 !== s.titelNr) return null
  if (s.positionMs <= 0) return null
  return s
}

/**
 * Traegt DIESES ALBUM eine brauchbare Stelle?
 *
 * @param z          die Zeile aus /api/weiterhoeren zu dem Werk
 * @param versaetze  die 0-basierten Versaetze ALLER Titel dieses Albums
 *
 * DIE VERSAETZE WERDEN AUFGEZAEHLT, NICHT AUSGERECHNET. Naheliegend waere
 * `ersterVersatz <= ziel < ersterVersatz + anzahl`. Das geht schief, sobald
 * die Playlist eine Luecke hat: `titelEinesWerks` laesst gesperrte und
 * entfernte Stuecke weg, zaehlt den Versatz aber weiter (dieselbe Ueberlegung
 * wie in server.ts beim Schneiden der Titel). Ein Album mit vier Titeln kann
 * dann auf den Versaetzen 10, 11, 13, 14 liegen — die Rechnung endete bei 13
 * und liesse den letzten Titel heraus, waehrend sie 12 faelschlich
 * einschloesse.
 *
 * WANN DER KNOPF TROTZ TREFFER NEUTRAL BLEIBT: wenn die Stelle auf dem ERSTEN
 * Titel des Albums liegt und dort bei 0 ms. Dann ist „weiterhoeren" Zeichen
 * fuer Zeichen derselbe Befehl wie „von vorn" — siehe `stelleAmTitel`.
 */
export function stelleAmAlbum(
  z: LaneZeile | null | undefined,
  versaetze: readonly number[] | null | undefined,
): LaneStelle | null {
  const s = ausZeile(z)
  if (!s) return null
  const liste = (Array.isArray(versaetze) ? versaetze : [])
    .map(Number)
    .filter((v) => Number.isFinite(v) && v >= 0)
    .map((v) => Math.round(v))
  if (!liste.length) return null
  const ziel = s.titelNr - 1
  if (!liste.includes(ziel)) return null
  if (ziel === Math.min(...liste) && s.positionMs <= 0) return null
  return s
}
