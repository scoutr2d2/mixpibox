/**
 * Weiterhoeren — was wurde angefangen und nicht zu Ende gehoert?
 *
 * WOFUER: Die neue Oberflaeche zeigte oben eine Reihe „Oft gehoert". Die
 * beantwortet aber eine Frage, die das Raster darunter schon beantwortet — was
 * ein Kind oft hoert, findet es ohnehin. Unbeantwortet blieb die Frage, die
 * NIEMAND sonst beantwortet: „Wo war ich stehengeblieben?" Bei Hoerspielen von
 * einer Stunde ist das der haeufigste Wunsch ueberhaupt.
 *
 * ES GIBT DIESEN SPEICHER SCHON, und deshalb wird hier keiner erfunden: die
 * Box legt Stellen in `resume.json` ab (der klassische Player schreibt sie in
 * `saveResumeFiles`, das schwebende Fenster „Weiterhoeren" liest sie). Ein
 * zweiter Stand haette bedeutet, dass beide Oberflaechen verschiedene
 * Antworten auf dieselbe Frage geben — und der Fehler faellt erst auf, wenn
 * ein Kind an der falschen Stelle weiterhoert.
 *
 * DIE ZEIT KOMMT AUS DEM VERLAUF, nicht aus `resume.json`.
 * `resume.json` traegt KEINEN Zeitstempel; die Eintraege stehen dort in
 * Einfuegereihenfolge. Ein eigenes Zeitfeld haetten nur die Eintraege, die
 * die neue Oberflaeche geschrieben hat — die des klassischen Players stuenden
 * dann immer hinten, ohne dass man saehe warum. `gespielt.json` dagegen fuehrt
 * je Medium `zuletzt` und wird von BEIDEN Oberflaechen gefuettert
 * (player.service.ts gespieltMelden, NewDesign gespieltMelden). Der
 * Verbindungsschluessel ist derselbe wie dort — `meldungAusEintrag()`, nicht
 * nachgebaut.
 *
 *     resume.json   sagt WO      (Titelnummer und Stelle im Titel)
 *     gespielt.json sagt WANN    (zuletzt angefangen)
 *
 * DIE TEUERSTE FALLE DIESER DATEI IST DIE ZAEHLWEISE (Befund 02.08.2026).
 * Fortgesetzt wird ueber `offset.position` IM ABSPIELZUSAMMENHANG. Was
 * Spotifys Wiedergabe-Auskunft nennt, ist `item.track_number` — die Nummer des
 * Stuecks in SEINEM Album. Bei einem Album ist das dieselbe Zahl, bei einer
 * Playlist aus vielen Alben nicht: In einer Hoerspielreihe mit 300 Kapiteln
 * traegt Kapitel 47 die 3, und der Tipp auf „Weiterhoeren" startete Kapitel 3
 * — mitten drin, an einer Stelle, die das Kind nie gehoert hat. Seither wird
 * die Position ueber die Titelliste AUFGELOEST (`zusammenhangAus`, gefuettert
 * vom Server) und der aufgeloeste Stand mit `resumeVersatzGeprueft` markiert.
 * Alles ohne diese Marke gilt bei einer Playlist als unbrauchbar.
 *
 * REIN: kein Netz, kein Dateisystem, keine Uhr. Der Server reicht beide
 * Listen und die aufgeloeste Position herein.
 */
import { type Gespielt, meldungAusEintrag } from './gespielt'
import { dienstVon, type Eintrag, normal } from './medien'

/**
 * Ein Eintrag aus `resume.json`.
 *
 * Es ist ein gewoehnlicher Medieneintrag mit `category: 'resume'` und je nach
 * Dienst ein paar Zusatzfeldern. Die Namen stammen aus `media.ts` der
 * klassischen Oberflaeche und sind hier ABGESCHRIEBEN, nicht neu gewaehlt.
 *
 * DIE EINHEITEN SIND JE DIENST VERSCHIEDEN, und das ist die Falle dieser
 * Datei — nicht ein Versehen, sondern die Schnittstelle der beiden Maschinen:
 *
 *     resumespotifyprogress_ms   MILLISEKUNDEN   (spotifyApi nimmt position_ms)
 *     resumelocalprogressTime    PROZENT 0..100  (mpv percent_pos)
 *     resumerssprogressTime      PROZENT 0..100  (dasselbe, RSS laeuft ueber mpv)
 *
 * GEPRUEFT AM QUELLTEXT (2026-08-02): `spotify-control.ts` setzt
 * `currentMeta.progressTime` im Ereignis `percent_pos` — der Wert, den der
 * klassische Player als `resumelocalprogressTime` ablegt, ist also PROZENT.
 * `merkposition.ts` der klassischen Oberflaeche liest ihn als SEKUNDEN; das
 * ist dort ein Fehler und steht im Wissenspaket.
 */
export interface Stelle extends Eintrag {
  /**
   * Spotify: 1-basierte Nummer im ABSPIELZUSAMMENHANG. 0 heisst „von vorn".
   *
   * „Im Abspielzusammenhang" und nicht „im Album" — genau daran hing der
   * Fehler vom 02.08.2026. Fortgesetzt wird ueber `offset.position` der
   * Playlist; was Spotify meldet (`item.track_number`), ist die Nummer des
   * Stuecks in SEINEM Album. Bei einem Album ist beides dasselbe, bei einer
   * Playlist aus vielen Alben nicht. Ob der Wert die richtige Zaehlweise
   * traegt, sagt `resumeVersatzGeprueft`.
   */
  resumespotifytrack_number?: number
  /**
   * Traegt `resumespotifytrack_number` die Position IM ZUSAMMENHANG?
   *
   * NEU AM 02.08.2026 und der Grund, warum es das Feld gibt: In `resume.json`
   * liegen Eintraege beider Zaehlweisen nebeneinander — die klassische
   * Oberflaeche (`saveResumeFiles`) schreibt bis heute die Album-Nummer, und
   * aeltere Eintraege der neuen taten es auch. Einem Eintrag sieht man die
   * Zaehlweise nicht an: „3" ist in beiden Welten eine gueltige Zahl. Ohne
   * diese Marke muesste geraten werden, und ein falsch geratener Sprung
   * landet in einem Kapitel, das das Kind nie gehoert hat.
   *
   * FEHLT SIE, gilt der Wert NUR bei einem Album als brauchbar (dort waren
   * beide Zaehlweisen immer gleich). Siehe `nummerVerlaesslich`.
   */
  resumeVersatzGeprueft?: boolean
  /**
   * Wie viele Titel der Zusammenhang hatte, als die Stelle gemerkt wurde.
   *
   * WOFUER: ohne diese Zahl ist „Titel 12 zu 99 %" nicht von „mittendrin" zu
   * unterscheiden — ein zu Ende gehoertes Werk blieb deshalb fuer immer in der
   * Weiterhoeren-Reihe stehen. Siehe `istDurch`.
   *
   * ZWEI QUELLEN, BEIDE OHNE EIGENEN ABRUF: bei Spotify faellt sie beim
   * Aufloesen der Position ohnehin ab (`Zusammenhang.gesamt`), bei mpv meldet
   * die Oberflaeche sie aus der laufenden Warteschlange mit (`Stand.gesamt`,
   * `currentMeta.totalTracks`). Ein Netzabruf allein fuer diese Zahl waere zu
   * teuer fuer das, was sie leistet.
   */
  resumeGesamtTitel?: number
  /** Spotify: Stelle im laufenden Titel, MILLISEKUNDEN. */
  resumespotifyprogress_ms?: number
  /** Spotify: Laenge des laufenden Titels, MILLISEKUNDEN. */
  resumespotifyduration_ms?: number
  /** Lokal: die Kategorie, aus der das Album stammt (der Player braucht sie). */
  resumelocalalbum?: string
  /** Lokal: 1-basierte Nummer in der mpv-Warteschlange. */
  resumelocalcurrentTracknr?: number
  /** Lokal: Stelle im laufenden Titel, PROZENT. */
  resumelocalprogressTime?: number
  /** RSS: Stelle in der Folge, PROZENT. */
  resumerssprogressTime?: number
  /**
   * Jellyfin: 1-basierte Nummer in der mpv-Warteschlange.
   *
   * EIGENE FELDER UND NICHT `resumelocal*` (06.08.2026). Ein Jellyfin-Album
   * laeuft zwar ueber dieselbe Maschine wie ein lokales, aber der klassische
   * Player LIEST `resumelocalalbum` und sucht damit ein Verzeichnis auf der
   * SD-Karte. Ein Jellyfin-Album hat keines; die Kachel dort faende nichts und
   * finge wortlos von vorn an. Unter eigenen Namen ist die Stelle fuer die
   * klassische Oberflaeche schlicht unsichtbar — und das ist die ehrliche
   * Lage, solange sie keinen Fortsetzen-Weg dafuer hat (media.service.ts
   * laesst Jellyfin-Stellen aus, wie ARD-Stellen).
   */
  resumejellyfincurrentTracknr?: number
  /** Jellyfin: Stelle im laufenden Titel, PROZENT (mpv, wie lokal und RSS). */
  resumejellyfinprogressTime?: number
  /**
   * ARD: die KENNUNG der Folge, in der die Stelle liegt.
   *
   * DAS IST DAS FELD, AN DEM DIE GANZE ARD-STELLE HAENGT (05.08.2026). Hinter
   * einer ARD-Kachel steht keine feste Titelliste, sondern eine ROLLENDE
   * Folgenliste: kommt eine neue Folge dazu und wird „neueste zuerst"
   * sortiert, ruecken alle anderen um eins nach hinten. Die Warteschlangen-
   * nummer allein zeigte danach in eine Folge, die das Kind nie gehoert hat —
   * derselbe Fehler wie bei der Spotify-Playlist (02.08.2026), nur dass die
   * Liste sich hier von SELBST aendert, ohne dass jemand etwas anfasst.
   *
   * DIE TONADRESSE STEHT HIER AUSDRUECKLICH NICHT. Sie hat eine Verweildauer
   * und wird durchgesetzt (gemessen 04.08.2026: Folge 16657073 antwortete mit
   * 404, waehrend die Schnittstelle sie weiter auflistete). Eine in
   * `resume.json` festgeschriebene Adresse waere eine gemerkte Stelle mit
   * Verfallsdatum. Beim Fortsetzen wird die Folge ueber DIESE Kennung in der
   * frisch geholten Liste wiedergefunden und die Adresse neu aufgeloest.
   * Geprueft in weiterhoeren.spec.ts („keine Tonadresse in der Stelle").
   */
  resumeardfolge?: string
  /**
   * ARD: das BILD der gemerkten Folge (E46).
   *
   * WARUM ES MITGESCHRIEBEN WIRD, statt es beim Lesen aufzuloesen: Die
   * Weiterhoeren-Reihe wird alle 60 Sekunden geholt, und eine Aufloesung je
   * Zeile hiesse ein Netzgang zur Audiothek je Zeile und Minute — fuer ein
   * Bild. Beim MERKEN liegt die Folgenliste ohnehin schon da.
   *
   * ES IST EINE ROHE ARD-ADRESSE, so wie die Titelliste sie auch benutzt
   * (dort seit jeher, gemessen 19.08.2026). Deshalb bleibt das Sendungscover
   * als Rueckfall bestehen und wird NICHT ersetzt: ohne Netz soll die Kachel
   * nicht leer sein, sondern eben das Cover der Sendung zeigen.
   */
  resumeardfolgenbild?: string
  /**
   * ARD: der TITEL der Folge — der RUECKFALL, wenn die Kennung nicht mehr trifft.
   *
   * WOZU, wenn die Kennung doch das Verlaessliche ist (06.08.2026): Weil sie es
   * NICHT immer ist. Gemessen am 04.08.2026: Folge 16657073 antwortete mit 404,
   * WAEHREND die Schnittstelle sie weiter auflistete — die Audiothek setzt
   * Folgen neu ein, und dann traegt dieselbe Sendung denselben Ton unter einer
   * ANDEREN Kennung. Fuer ein Kind sieht das aus wie „diese Folge gibt es nicht
   * mehr", obwohl sie in der Liste steht.
   *
   * DIE REIHENFOLGE IST DIE GANZE REGEL, und sie steht in `folgeWiederfinden`:
   * Kennung zuerst, Titel als Rueckfall, die POSITION als Schiedsrichter, wenn
   * derselbe Titel mehrfach dasteht. Nichts Eindeutiges heisst NICHTS — wie
   * bisher, denn eine falsch geratene Folge klingt fuer ein Kind nach kaputt.
   *
   * AUSDRUECKLICH NICHT DABEI: Interpret und Laenge. An den 30 Folgen der
   * Maus-Sendung gezaehlt (04.08.2026) trugen beide GAR NICHTS bei — ein
   * Interpret, alle 30 mit derselben Nennlaenge 3606000 ms. Sie mitzunehmen
   * haette bei jedem Vergleich „passt" gesagt und damit eine Sicherheit
   * vorgetaeuscht, die es nicht gibt. Der TITEL dagegen war 30-mal verschieden.
   *
   * KEIN PFLICHTFELD. Fehlt der Titel (jede Stelle von vor dem 06.08.2026),
   * bleibt es beim heutigen Verhalten: die Kennung entscheidet allein. Eine
   * brauchbare Stelle darf nicht an einer Kosmetik scheitern.
   */
  resumeardfolgentitel?: string
  /** ARD: 1-basierte Nummer in der mpv-Warteschlange (die Folgenliste). */
  resumeardcurrentTracknr?: number
  /** ARD: Stelle in der Folge, PROZENT (mpv, wie lokal und RSS). */
  resumeardprogressTime?: number
}

/**
 * Ab dieser Stelle im ERSTEN Titel gilt ein Werk als angefangen (Sekunden).
 *
 * Wer kurz hineinhoert und aufhoert, hat nicht angefangen — das heisst
 * „gefiel nicht", und eine Kachel dafuer in der Weiterhoeren-Reihe waere eine
 * Einladung zurueck in etwas, das schon einmal weggelegt wurde.
 *
 * ══ WARUM 10 UND NICHT MEHR 30 ═══════════════════════════════════════════
 *
 * HIER STANDEN 30. Am 07.08.2026 hat der Betreiber gemeldet, dass „Greatest
 * Hits" von den Red Hot Chili Peppers nicht in der Reihe auftauchte, obwohl er
 * es gespielt hatte. An der Box nachgesehen: der Eintrag stand sehr wohl in
 * `profile/kalea/resume.json` — Titel 1, `resumespotifyprogress_ms` 27 883.
 * ZWEIUNDZWANZIG SEKUNDEN ZU FRUEH um 2,1 Sekunden.
 *
 * Die Schwelle soll den VERSEHENTLICHEN Tipp abfangen, und der dauert ein bis
 * drei Sekunden. Eine halbe Minute trifft laengst nicht mehr das Versehen,
 * sondern eine Entscheidung: wer 28 Sekunden lang zuhoert, hat sich das Stueck
 * ausgesucht. Bei Musik ist es besonders schief — Titel 1 eines Albums IST der
 * Anfang, dort faengt jeder an, und ein Lied dauert oft nur drei Minuten.
 *
 * ZEHN SEKUNDEN sind das Dreifache eines Fehlgriffs und die Haelfte dessen,
 * was der Betreiber bewusst gehoert hat. Die Zahl ist gewaehlt, nicht
 * gemessen — wer sie besser weiss, aendert sie hier UND drueben.
 *
 * ══ DIESELBE ZAHL STEHT ZWEIMAL ══════════════════════════════════════════
 * Auch in `src/frontend-box/src/app/merkposition.ts`. Zwei Bauwerke, zwei
 * Programme — ein Import ist nicht moeglich. Wer eine aendert, muss die andere
 * mitnehmen, sonst zeigt die eine Oberflaeche einen Weiter-Knopf, wo die
 * andere keinen anbietet.
 *
 * DAS STAND HIER SCHON ALS BITTE — und eine Bitte ist kein Netz. Vom
 * 07.08.2026 bis zum 19.09.2026 mass `tools/weiterhoeren-schwellen-gleich.py`
 * nach, dass beide Dateien dieselben Zahlen fuehren.
 *
 * DIE WACHE IST GEFALLEN, WEIL IHRE FRAGE GEGENSTANDSLOS WURDE: Die zweite
 * Stelle existiert nicht mehr. Mit dem Fall der alten Oberflaeche (6281ac5c,
 * 05.09.2026) stehen diese Schwellen nur noch HIER; die neue Oberflaeche
 * dupliziert sie nicht, sie holt fertige Zeilen von `GET /api/weiterhoeren`
 * und sagt das selbst (NewDesign/app.js:3839).
 *
 * WAS DAS FUER DEN ABSATZ DARUEBER HEISST: Solange es EINE Stelle gibt, kann
 * nichts auseinanderlaufen. Wer hier je wieder eine zweite Kopie anlegt,
 * braucht die Wache zurueck — die Bitte allein hat schon einmal nicht
 * gehalten, und das ist der Grund, warum es sie ueberhaupt gab.
 */
export const MIN_POSITION_S = 10

/**
 * Dasselbe fuer Eintraege, die nur PROZENT kennen (lokal, RSS).
 *
 * Es MUSS eine zweite Schwelle in einer zweiten Einheit sein: mpv meldet
 * `percent_pos`, und ohne die Laenge des Titels laesst sich daraus keine
 * Sekundenzahl bilden — die Laenge steht in `resume.json` nur fuer Spotify.
 *
 * Zwei Prozent sind bei einem drei Minuten langen Lied rund vier Sekunden und
 * bei einer einstuendigen Hoerspieldatei gut eine Minute. Beides liest sich
 * als „gerade erst angefangen", und genau das soll die Schwelle treffen. Der
 * haeufigere Fall — ein Album, das schon bei Titel 3 steht — faellt ohnehin
 * nicht unter sie (siehe `istWeiterhoerbar`).
 */
export const MIN_ANTEIL = 0.02

/**
 * Ab diesem Anteil gilt ein Stueck als DURCH.
 *
 * Wer bis zum Ende gehoert hat, will beim naechsten Mal von vorn, nicht die
 * letzten Sekunden noch einmal.
 *
 * DIE GESPEICHERTE LAENGE IST DIE DES LAUFENDEN TITELS, nicht die des Werks —
 * das ist der Kern. „Titel 5 ist zu 99 % durch" heisst gerade NICHT „das Album
 * ist durch", sondern dass Titel 6 gleich dran ist. Der Anteil allein genuegt
 * also nie; es braucht dazu die Auskunft, dass es der LETZTE Titel war.
 *
 * ZWEI WEGE ZU DIESER AUSKUNFT, siehe `istDurch`: keine Titelnummer (dann IST
 * der Titel das ganze Werk — eine RSS-Folge, eine einzelne Episode), oder eine
 * Nummer, die die bekannte Gesamtzahl erreicht (`resumeGesamtTitel`, seit dem
 * 02.08.2026). Bis dahin gab es nur den ersten Weg, und ein durchgehoertes
 * Hoerspiel blieb fuer immer in der Reihe stehen.
 */
export const FERTIG_ANTEIL = 0.97

/** Wie viele Kacheln die Reihe hoechstens liefert. */
export const STANDARD_ANZAHL = 6

/** Die wievielte Spur lief — 0, wenn der Dienst keine Nummer nennt. */
export function titelNummer(s: Stelle): number {
  const n = Number(
    s?.resumespotifytrack_number ||
      s?.resumelocalcurrentTracknr ||
      s?.resumeardcurrentTracknr ||
      s?.resumejellyfincurrentTracknr ||
      0,
  )
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** Wie viele Titel das Werk hat — 0, wenn es niemand weiss. */
export function gesamtTitel(s: Stelle): number {
  const n = Number(s?.resumeGesamtTitel)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * Ist dieser Eintrag eine Spotify-PLAYLIST?
 *
 * Nur sie ist von der Zaehlweisen-Falle betroffen: Ein Album hat genau EINE
 * Reihenfolge, und die Nummer im Album ist dort dieselbe wie der Versatz beim
 * Abspielen. Eine Playlist reiht Stuecke aus vielen Alben — dort sind es zwei
 * verschiedene Zahlen, die zufaellig beide klein und plausibel sind.
 */
export function istSpotifyPlaylist(e: Eintrag | null | undefined): boolean {
  if (!e || typeof e !== 'object') return false
  return dienstVon(e) === 'spotify' && Boolean(e.playlistid)
}

/**
 * Darf man der gespeicherten Nummer glauben?
 *
 * DAS IST DIE ANTWORT AUF DIE ALTEN STAENDE. `resume.json` ueberlebt jede
 * Aktualisierung; darin liegen Eintraege, die vor dem 02.08.2026 (oder eben
 * von der klassischen Oberflaeche) geschrieben wurden und die ALBUM-Nummer
 * tragen. Zahlenmaessig sind die von richtigen nicht zu unterscheiden — „3"
 * sieht in beiden Zaehlweisen gleich aus. Nur die Marke unterscheidet sie.
 *
 * IM ZWEIFEL NEIN. Ein Werk, das aus der Reihe faellt, kostet einen Tipp mehr
 * im Raster darunter (und faengt dann ehrlich von vorn an). Ein falscher
 * Sprung dagegen landet in einem Kapitel, das nie gehoert wurde, und klingt
 * fuer ein Kind nicht nach einem Fehler, sondern nach kaputt. Die Eintraege
 * heilen sich beim naechsten Hoeren von selbst: dann schreibt der neue Weg
 * eine geprueste Stelle darueber.
 */
export function nummerVerlaesslich(s: Stelle): boolean {
  // BEI DER ARD ZAEHLT NICHT DIE NUMMER, SONDERN DIE FOLGE (05.08.2026). Die
  // Liste hinter einer Sendung rollt: eine neue Folge schiebt bei „neueste
  // zuerst" alles um eins nach hinten, ganz ohne Zutun. Eine Stelle OHNE
  // `resumeardfolge` ist deshalb nicht bloss ungenau, sondern unbrauchbar —
  // sie zeigt beim naechsten Mal moeglicherweise in eine fremde Folge. Solche
  // Staende gibt es: jeder, der vor dem 05.08.2026 geschrieben wurde.
  /* DASSELBE GILT FUER PLUGIN-INHALT (E90), und aus genau demselben Grund:
   * `inhalt()` liefert eine Liste, die zwischen zwei Blicken anders aussehen
   * darf. Eine Stelle ohne Folgenkennung zeigt dann moeglicherweise in ein
   * fremdes Stueck.
   *
   * DIE FELDER HEISSEN WEITER `resumeard…`, und das ist Absicht: sie stehen
   * so in resume.json auf jeder Box. Sie umzubenennen waere eine Wanderung
   * aller vorhandenen Staende fuer einen Namen — der Name ist inzwischen
   * ungenau („die Folge einer rollenden Liste"), die Bedeutung nicht. */
  const d = dienstVon(s)
  if (d === 'ard' || d === 'plugin') return Boolean(String(s.resumeardfolge ?? '').trim())
  if (!istSpotifyPlaylist(s)) return true
  return Boolean(s.resumeVersatzGeprueft)
}

/**
 * Ist das Werk zu ENDE gehoert?
 *
 * ZWEI FAELLE, und beide brauchen ihren eigenen Beweis:
 *
 *   MIT Gesamtzahl   Der LETZTE Titel und praktisch durch. Seit dem
 *                    02.08.2026 gibt es sie: bei Spotify aus der aufgeloesten
 *                    Titelliste, bei mpv aus der Warteschlange
 *                    (`resumeGesamtTitel`) — vorher wusste `resume.json`
 *                    nicht, wie viele Titel ein Werk hat, und ein
 *                    durchgehoertes Hoerspiel blieb fuer immer in der Reihe
 *                    stehen.
 *   OHNE Titelnummer Dann IST der Titel das ganze Werk (eine RSS-Folge, eine
 *                    einzelne Episode), und der Anteil stimmt.
 *
 * OHNE BEIDES WIRD NICHTS BEHAUPTET: „Titel 5 ist zu 99 % durch" heisst bei
 * unbekannter Laenge des Werks gerade NICHT „das Album ist durch", sondern
 * dass Titel 6 gleich dran ist.
 */
export function istDurch(s: Stelle): boolean {
  const a = anteil(s)
  if (a === null || a < FERTIG_ANTEIL) return false
  const nr = titelNummer(s)
  if (nr === 0) return true
  const gesamt = gesamtTitel(s)
  return gesamt > 0 && nr >= gesamt
}

/** Ein Titel des Abspielzusammenhangs, so wie `titelEinesWerks` ihn liefert. */
export interface ZusammenhangTitel {
  /** Die Spotify-Kennung des Stuecks (`spotify:track:…`). */
  uri?: unknown
  /** Die 0-basierte Stelle IM ZUSAMMENHANG, uebersprungene mitgezaehlt. */
  versatz?: unknown
}

/** Was ueber den laufenden Abspielzusammenhang herausgefunden wurde. */
export interface Zusammenhang {
  /** 1-basierte Position im Zusammenhang. 0 heisst „nicht gefunden". */
  versatzNr: number
  /** Wie viele Titel der Zusammenhang hat. 0 heisst „unbekannt". */
  gesamt: number
  /**
   * ARD: die KENNUNG der Folge an dieser Position — leer, wenn unbekannt.
   *
   * DIE ARD IST DER SPIEGELFALL ZUR SPOTIFY-PLAYLIST, nur andersherum: Dort
   * meldet die Maschine, WELCHES Stueck laeuft (`item.uri`), und die Position
   * muss aufgeloest werden. Hier meldet mpv die POSITION
   * (`currentMeta.currentTracknr`), und aufgeloest werden muss, welche Folge
   * das ist. Beides tut der Server aus der Liste, die er ohnehin holt —
   * geraten wird an keiner der beiden Stellen.
   */
  folge?: string
  /**
   * ARD: der TITEL der Folge an dieser Position — leer, wenn unbekannt.
   *
   * Er reist NUR als Rueckfall mit (siehe `Stelle.resumeardfolgentitel`) und
   * entscheidet nie allein. Fehlt er, aendert sich nichts.
   */
  folgeTitel?: string
  /**
   * ARD: das BILD der Folge an dieser Position — leer, wenn unbekannt (E46).
   *
   * Wie der Titel: reine Anzeige, entscheidet nie ueber die Wiedergabe. Es
   * wird beim Merken mitgeschrieben, weil die Folgenliste GENAU DANN in der
   * Hand liegt — Stunden spaeter, wenn die Kachel gezeichnet wird, kostete
   * dieselbe Auskunft einen Netzgang je Zeile und Minute.
   */
  folgeBild?: string
}

/** Eine Folge, so wie sie in einer frisch geholten Sendungsliste steht. */
export interface FolgenEintrag {
  kennung: string
  titel?: string
  /**
   * Das Bild DIESER Folge (E46).
   *
   * Es war hier ausdruecklich NICHT vorgesehen („Bild und Dauer werden hier
   * von niemandem gebraucht"), und fuer die Titelliste stimmt das bis heute:
   * die holt ihr Bild aus derselben `/inhalt`-Antwort. Fuer die
   * WEITERHOEREN-Kachel stimmt es nicht — sie kommt Stunden spaeter, ohne
   * jede Folgenliste in der Hand, und zeigte deshalb das Sendungscover,
   * waehrend ihre eigene Plakette den richtigen Folgentitel trug (Betreiber,
   * 19.08.2026: „beim weiterspielen ist beim mauszoom nicht das richtige
   * bild").
   *
   * OPTIONAL, und das ist wichtig: eine Sendung ohne Folgenbilder verliert
   * dadurch nichts, sie faellt auf ihr Sendungscover zurueck.
   */
  bild?: string
}

/** Wonach in dieser Liste gesucht wird — alles drei darf fehlen. */
export interface GesuchteFolge {
  /** Die gemerkte Folgenkennung. Sie hat immer Vorrang. */
  kennung?: string
  /** Der gemerkte Folgentitel. Nur Rueckfall. */
  titel?: string
  /** Die gemerkte Warteschlangennummer. Nur Schiedsrichter. */
  nr?: number
}

/**
 * Wo in DIESER frisch geholten Liste steht die gemerkte Folge? — 1-basiert,
 * 0 heisst „nicht eindeutig zu bestimmen".
 *
 * ══ DREI STUFEN, UND JEDE HAT EINEN GRUND ═══════════════════════════════════
 *
 *   1. DIE KENNUNG. Sie ist die Identitaet der Folge und bleibt richtig, auch
 *      wenn die Liste rollt (llmwiki ard-folgenliste-rollt). Trifft sie, ist
 *      die Frage beantwortet und der Rest wird gar nicht erst gefragt.
 *
 *   2. DER TITEL — und zwar erst, wenn die Kennung NICHT trifft. Der Fall ist
 *      gemessen und kein Gedankenspiel: am 04.08.2026 antwortete Folge
 *      16657073 mit 404, waehrend die Schnittstelle sie weiter auflistete. Die
 *      Audiothek setzt Folgen neu ein; dann steht derselbe Ton unter einer
 *      anderen Kennung in der Liste, und ohne diesen Rueckfall bekaeme das
 *      Kind „Diese Folge gibt es nicht mehr" fuer eine Folge, die dasteht.
 *
 *   3. DIE POSITION ALS SCHIEDSRICHTER, und nur dort: wenn derselbe Titel
 *      MEHRFACH in der Liste steht. Sie entscheidet nie fuer sich allein —
 *      genau das waere die Falle, gegen die diese ganze Kette gebaut ist.
 *
 * ══ WAS AUSDRUECKLICH NICHT MITSPIELT ═══════════════════════════════════════
 * INTERPRET UND LAENGE. An den 30 Folgen der Maus-Sendung gezaehlt
 * (04.08.2026): ein einziger Interpret („Die Maus") und eine einzige Laenge
 * (3606000 ms — offenbar eine Nennlaenge, nicht die echte). Beide haetten bei
 * JEDEM Vergleich „passt" gesagt. Und der Interpret traegt grundsaetzlich
 * nichts bei: gesucht wird immer INNERHALB einer Sendung, dort ist er
 * naturgemaess konstant. Sie einzubauen erzeugte falsche Sicherheit — eine
 * Pruefung, die nie nein sagen kann, ist keine.
 *
 * ══ IM ZWEIFEL 0 ════════════════════════════════════════════════════════════
 * Kein Treffer, oder ein Titel mehrfach ohne passende Position: dann NICHTS.
 * Der Aufrufer faellt damit auf sein heutiges Verhalten zurueck (die Sendung
 * faengt vorn an und sagt es). Eine falsch geratene Folge klingt fuer ein Kind
 * nicht nach Fehler, sondern nach kaputt.
 */
export function folgeWiederfinden(
  liste: readonly FolgenEintrag[] | null | undefined,
  gesucht: GesuchteFolge | null | undefined,
): number {
  const l = Array.isArray(liste) ? liste : []
  if (!l.length) return 0

  const kennung = String(gesucht?.kennung ?? '').trim()
  if (kennung) {
    const i = l.findIndex((f) => String(f?.kennung ?? '').trim() === kennung)
    if (i >= 0) return i + 1
  }

  // `normal` ist derselbe Vergleichskern wie im Rest des Hauses (medien.ts):
  // Gross- und Kleinschreibung, Betonungszeichen und Satzzeichen fallen weg.
  // Ein Titel, der beim Neueinsetzen ein Anfuehrungszeichen wechselt, soll
  // deshalb nicht durchfallen.
  const titel = normal(gesucht?.titel)
  if (!titel) return 0
  const treffer: number[] = []
  l.forEach((f, i) => {
    if (normal(f?.titel) === titel) treffer.push(i + 1)
  })
  if (treffer.length === 1) return treffer[0]
  if (treffer.length === 0) return 0

  // MEHRFACH DERSELBE TITEL — jetzt und nur jetzt entscheidet die Position.
  const nr = Math.round(Number(gesucht?.nr) || 0)
  return nr > 0 && treffer.includes(nr) ? nr : 0
}

/**
 * Wo im Abspielzusammenhang steht das laufende Stueck?
 *
 * DAS IST DIE REPARATUR DES BEFUNDS. Spotifys Wiedergabe-Auskunft nennt die
 * Playlist-Position NICHT — sie nennt `context.uri` (welche Playlist) und
 * `item.uri` (welches Stueck). Die Position ergibt sich erst aus der
 * Titelliste, und die holt der Server (`titelEinesWerks`, mit Zwischenspeicher).
 * Hier steht nur die Rechnung, damit sie ohne Netz pruefbar ist.
 *
 * 1-BASIERT HERAUS, 0-BASIERT HEREIN. `versatz` ist Spotifys eigene Zaehlung
 * (`offset.position` beginnt bei 0), der Abspieldienst will 1-basiert, weil er
 * intern wieder eins abzieht. Die +1 steht deshalb GENAU HIER — dieselbe
 * Ueberlegung wie bei `startPlan` in spielfunktion.ts (die sie bis E95/V
 * Stufe 3 von `abspielBefehl` in der Oberflaeche geerbt hat).
 *
 * DER VERSATZ UND NICHT DER RANG IM FELD: `titelEinesWerks` laesst gesperrte
 * und entfernte Stuecke weg, zaehlt den Versatz aber weiter. Wer die Stelle im
 * Feld naehme, laege hinter jeder Luecke um eins daneben.
 *
 * DASSELBE STUECK ZWEIMAL: es gewinnt das ERSTE Vorkommen. Es ist derselbe
 * Ton — das Kind hoert also das richtige Kapitel; nur was danach kommt, kann
 * abweichen. Nichts zu merken waere hier schlechter als das.
 */
export function zusammenhangAus(titel: readonly ZusammenhangTitel[] | null | undefined, uri: string): Zusammenhang {
  const liste = Array.isArray(titel) ? titel : []
  let gesamt = 0
  let versatzNr = 0
  const gesucht = String(uri ?? '').trim()
  for (const t of liste) {
    const v = Number(t?.versatz)
    if (!Number.isFinite(v) || v < 0) continue
    if (v + 1 > gesamt) gesamt = v + 1
    if (versatzNr === 0 && gesucht && String(t?.uri ?? '') === gesucht) versatzNr = Math.round(v) + 1
  }
  return { versatzNr, gesamt }
}

/**
 * Die Stelle im laufenden Titel in MILLISEKUNDEN — oder null.
 *
 * Nur Spotify kennt sie. Bei lokalen Medien und RSS steht dort ein
 * Prozentwert, und den in Millisekunden umzurechnen ginge nur mit einer
 * Laenge, die nicht gespeichert ist. Eine geratene Millisekundenzahl waere
 * schlechter als das ehrliche `null`.
 */
export function positionMs(s: Stelle): number | null {
  const ms = Number(s?.resumespotifyprogress_ms)
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null
}

/** Die Stelle im laufenden Titel in PROZENT (0..100) — oder null. */
export function positionProzent(s: Stelle): number | null {
  const roh =
    s?.resumelocalprogressTime ?? s?.resumerssprogressTime ?? s?.resumeardprogressTime ?? s?.resumejellyfinprogressTime
  const p = Number(roh)
  if (!Number.isFinite(p) || p < 0) return null
  return Math.max(0, Math.min(100, p))
}

/**
 * Wie weit ist der LAUFENDE TITEL — 0..1, oder null wenn unbekannt.
 *
 * Ausdruecklich nicht „wie weit ist das Werk": das weiss hier niemand, weil
 * weder die Anzahl der Titel noch die Gesamtlaenge in `resume.json` steht.
 * Wer daraus einen Werk-Fortschritt macht, behauptet etwas.
 */
export function anteil(s: Stelle): number | null {
  const ms = positionMs(s)
  const dauer = Number(s?.resumespotifyduration_ms)
  if (ms !== null && Number.isFinite(dauer) && dauer > 0) return Math.max(0, Math.min(1, ms / dauer))
  const p = positionProzent(s)
  return p === null ? null : p / 100
}

/**
 * Ist an dieser Stelle etwas zum Weiterhoeren?
 *
 * VIER FRAGEN, in dieser Reihenfolge:
 *
 *   1. Laesst es sich ueberhaupt fortsetzen? Radio hat keine Stelle — ein
 *      Strom laeuft immer „jetzt", es gibt keinen Ort, an den man zurueckkehrt.
 *      `jellyfin` STEHT SEIT DEM 06.08.2026 MIT DRIN. Bis dahin lautete die
 *      Begruendung fuer sein Fehlen: „die KLASSISCHE Oberflaeche kann es nicht
 *      fortsetzen". Das stimmt weiterhin — nur ist es kein Grund mehr, die
 *      Stelle gar nicht erst zu merken: die NEUE Oberflaeche kann es laengst
 *      (`weiterSpielen` startet ein Jellyfin-Album ueber `albumSpielen` und
 *      springt mit `tracknr:`/`seekpos:`), und `fortsetzenMit` bringt die
 *      Stelle sogar schon in mpv-Prozent. Die klassische Oberflaeche laesst
 *      Jellyfin-Stellen dafuer aus (media.service.ts) — dieselbe Loesung wie
 *      bei ARD, statt beide Oberflaechen auf die schwaechere einzunorden.
 *      AM GERAET GEMESSEN (06.08.2026, Box .169, „HAMM" ueber Jellyfin): mpv
 *      meldet nach `tracknr:2` eine `currentTracknr` von 2 und zaehlt am
 *      Titelende von selbst auf 3 weiter — die Nummer STIMMT, sie ist die
 *      Abspielposition in der Warteschlange.
 *      `ard` STEHT SEIT DEM 05.08.2026 MIT DRIN, und zwar aus dem Grund, fuer
 *      den diese Reihe ueberhaupt gebaut wurde: eine Hoerspielfolge von einer
 *      Stunde, die ein Kind mittendrin verlaesst, ist der Regelfall der ARD
 *      und nicht die Ausnahme. Anders als bei Radio gibt es hier eine Stelle,
 *      und anders als bei Jellyfin gibt es einen Weg zurueck dorthin
 *      (`weiterSpielen` in NewDesign/app.js loest die Folge neu auf).
 *   2. WEISS MAN UEBERHAUPT, WO? Ein Playlist-Stand aus der alten Zaehlweise
 *      traegt die Album-Nummer und wuerde in ein fremdes Kapitel springen.
 *      Siehe `nummerVerlaesslich` — das ist der Befund vom 02.08.2026.
 *   3. Ist es schon durch? Siehe `istDurch`.
 *   4. Ist es weit genug? Siehe MIN_POSITION_S / MIN_ANTEIL. Ein Album, das
 *      bereits bei Titel 2 oder spaeter steht, ist IMMER weit genug — die
 *      kleine Zeit zaehlt dort ab dem Anfang DIESES Stuecks und ist kein
 *      Gegenbeweis, sondern der Normalfall.
 *
 * DIE „DURCH"-FRAGE STEHT VOR DER NUMMERN-ABKUERZUNG. Frueher kam `nr > 1`
 * zuerst und schnitt jede weitere Pruefung ab; ein durchgehoertes Werk stand
 * damit fuer immer in der Reihe.
 */
export function istWeiterhoerbar(s: Stelle): boolean {
  if (!s || typeof s !== 'object') return false
  const dienst = dienstVon(s)
  /* `plugin` GEHOERT DAZU (E90). Ohne diese Zeile wird eine Plugin-Stelle
   * zwar GESCHRIEBEN, aber nie wieder herausgegeben — der blaue Knopf bliebe
   * aus, und niemand saehe einen Fehler. Genau diese Sorte Halbheit hat der
   * Zeuge in plugin-inhalt.integration.spec.ts gefunden: der Schreibweg war
   * fertig, der Leseweg filterte still weg. */
  if (
    dienst !== 'spotify' &&
    dienst !== 'lokal' &&
    dienst !== 'rss' &&
    dienst !== 'ard' &&
    dienst !== 'jellyfin' &&
    dienst !== 'plugin'
  )
    return false
  if (!nummerVerlaesslich(s)) return false
  if (istDurch(s)) return false

  const nr = titelNummer(s)
  const a = anteil(s)

  if (nr > 1) return true

  const ms = positionMs(s)
  if (ms !== null) {
    if (ms < MIN_POSITION_S * 1000) return false
  } else {
    if (a === null || a < MIN_ANTEIL) return false
  }
  return true
}

/** Eine Zeile der Weiterhoeren-Reihe. */
export interface Weiter {
  /** Der Verlaufsschluessel (`<type>:<kennung>`) — die Bruecke zu gespielt.json. */
  key: string
  titel: string
  interpret: string
  /** Der `type` des Roheintrags, unveraendert. */
  typ: string
  /** 1-basiert, UNVERAENDERT einzusetzen. 0 = von vorn. Siehe `fortsetzenAb`. */
  titelNr: number
  /** Spotify: Millisekunden. Sonst null. */
  positionMs: number | null
  /** Lokal und RSS: Prozent 0..100. Sonst null. */
  positionProzent: number | null
  /** Wie weit der LAUFENDE Titel ist (0..1) — fuer den Balken. Kann null sein. */
  anteil: number | null
  /** Wann zuletzt angefangen (ms seit 1970), aus dem Verlauf. 0 = unbekannt. */
  zuletzt: number
  /**
   * ARD: die Kennung der Folge, in der die Stelle liegt. Sonst leer.
   *
   * SIE REIST MIT, WEIL DIE NUMMER ALLEIN NICHTS TAUGT: die Folgenliste einer
   * Sendung rollt. Die Oberflaeche sucht diese Kennung in der frisch geholten
   * Liste und springt auf die Nummer, die sie DORT hat — nicht auf `titelNr`.
   */
  folge?: string
  /**
   * ARD: der Titel der Folge. Sonst leer.
   *
   * ZWEI VERBRAUCHER, EIN FELD (06.08.2026): der RUECKFALL beim Wiederfinden
   * (`folgeWiederfinden`, wenn die Kennung nicht mehr trifft) UND die
   * BESCHRIFTUNG der Weiterhoeren-Kachel, die bis heute „Titel 3" sagte. Beide
   * meinen denselben Namen; ihn ein zweites Mal zu beschaffen hiesse, zwei
   * Wahrheiten ueber dieselbe Folge zu fuehren.
   */
  folgeTitel?: string
  /**
   * ARD: das Bild DIESER Folge. Sonst leer (E46).
   *
   * ES ERSETZT `bild` NICHT, es geht ihm VOR. Der Unterschied ist der
   * Rueckfall: `bild` kommt ueber die Box (Coverspeicher, `/api/bild/…`) und
   * traegt auch ohne Netz; dies hier ist eine rohe ARD-Adresse, so wie die
   * Titelliste sie benutzt. Faellt sie aus, soll die Kachel auf das
   * Sendungscover zurueckfallen und nicht leer bleiben — deshalb zwei
   * Felder statt eines ueberschriebenen.
   */
  folgeBild?: string
}

/**
 * DIE STELLE IN DER EINHEIT DER MASCHINE, DIE GLEICH SPIELT.
 *
 * WARUM ES DAS SEIT DEM 03.08.2026 GIBT: Verschmolzene Werke haben mehrere
 * Quellen, und `quellen[0]` — die, die spielt — muss nicht die sein, bei der
 * die Stelle gemerkt wurde. Auf der Box ist das der Regelfall und kein
 * Sonderfall: „Das Lumpenpack" traegt die Identitaet des SPOTIFY-Eintrags
 * (dort haengt der Verlauf), gespielt wird aber ueber JELLYFIN. Die gemerkte
 * Stelle steht also in MILLISEKUNDEN da, und mpv will PROZENT
 * ([resume-lokal-ist-prozent-nicht-sekunden]). Wer die Zahl einfach
 * durchreicht, schickt `seekpos:92500` — und mpv nimmt alles ueber 100 als
 * „ganz ans Ende".
 *
 * DIE TITELNUMMER WIRD NICHT ANGERUEHRT und wandert unveraendert mit. Sie
 * zaehlt in beiden Welten dasselbe (die wievielte Spur), und es ist DASSELBE
 * Album — sonst waere es nicht verschmolzen worden. Sitzt die Reihenfolge bei
 * einer Quelle anders, landet das Kind in einer anderen Folge DESSELBEN
 * Albums; das ist ein sichtbarer Fehlgriff, kein fremdes Werk.
 *
 * DER UMWEG UEBER `anteil` IST DER GANZE TRICK, und er geht nur in EINE
 * Richtung:
 *
 *   Spotify -> mpv   `anteil` = ms / Titeldauer, BEIDES steht in resume.json
 *                    (`resumespotifyprogress_ms`, `resumespotifyduration_ms`).
 *                    Mal hundert, fertig — das ist keine Schaetzung.
 *   mpv -> Spotify   geht NICHT. resume.json merkt sich bei mpv nur den
 *                    Prozentwert, die Laenge des Titels steht nirgends. Aus
 *                    41,5 % Millisekunden zu machen hiesse, eine Dauer zu
 *                    erfinden. Dann lieber `null`: der Titel faengt von vorn
 *                    an, und das Kind hoert eine Folge noch einmal, statt in
 *                    einer fremden Minute zu landen.
 *
 * NULL HEISST „VON VORN", nicht „unbekannt" — der Aufrufer schickt dann
 * schlicht keinen Sprung.
 */
export interface Fortsetzung {
  /** Spotify: MILLISEKUNDEN. Sonst null. */
  positionMs: number | null
  /** mpv (lokal, jellyfin, rss): PROZENT 0..100. Sonst null. */
  positionProzent: number | null
}

/** Welche Maschine spielt diesen Dienst? Die Trennung, an der die Einheit
 *  haengt — Spotify laeuft ueber librespot, alles andere ueber mpv. */
export function ueberMpv(dienst: string): boolean {
  // `plugin` gehoert dazu (E90): der Server baut fuer Plugin-Inhalt das Verb
  // `plugin/…`, und das ist im Abspieldienst eine Kopie des ard-Zweiges —
  // mplayer, endlicher Strom, Dauer und Sprungmarke.
  return (
    dienst === 'lokal' || dienst === 'jellyfin' || dienst === 'rss' || dienst === 'ard' || dienst === 'plugin'
  )
}

/**
 * GILT DIESE STELLE UEBERHAUPT NOCH, wenn ein ANDERER Dienst spielt?
 *
 * ══ DIE FRAGE VOR DER EINHEIT ════════════════════════════════════════════
 * `fortsetzenMit` beantwortet „in welcher EINHEIT?". Diese Funktion
 * beantwortet die Frage davor: „bedeutet die Zahl bei der spielenden Quelle
 * ueberhaupt dasselbe?" Bei einem verschmolzenen ALBUM lautet die Antwort ja,
 * und das steht so an `Fortsetzung`: es ist dasselbe Album, die wievielte Spur
 * zaehlt in beiden Welten dasselbe.
 *
 * ══ BEI DER ARD LAUTET SIE NEIN, und das ist gemessen, nicht vermutet ═════
 * BEFUND BEIM GEGENLESEN (06.08.2026, E4/A10). Die Begruendung, warum `ard`
 * NICHT in QUELLEN_REIHENFOLGE steht, nennt den Fall ausdruecklich
 * (verschmelzung.ts, Punkt 3): „Eine verschmolzene Kachel, deren bevorzugte
 * Quelle wechselt, verloere ihre Stelle STILL: die Zeile bliebe stehen, der
 * Tipp finge von vorn an." Nur TAT der Code das nicht — `titelNr` reiste
 * unveraendert mit:
 *
 *     ARD-Stelle: Folge 7 der Sendung, 41,5 %
 *     verschmolzen mit einem Spotify-Hoerbuch gleichen Namens
 *     -> quelle 'spotify', positionProzent faellt weg, titelNr BLEIBT 7
 *     -> die Box startet KAPITEL 7 DES SPOTIFY-WERKS
 *
 * Und das ist erreichbar, ohne dass jemand etwas falsch macht: `abgleich.ts`
 * SCHLAEGT diese Zuordnung von sich aus vor — eine ARD-Sendung und ein
 * Spotify-Hoerbuch gleichen Titels fallen in EINE Gruppe (ard.spec.ts, „faellt
 * mit einem Spotify-Hoerbuch desselben Namens in EINE Gruppe"). Ein
 * Erwachsener, der „Die Sendung mit der Maus" bei ARD und bei Spotify sieht,
 * nimmt den Vorschlag an — er ist ja richtig, es IST dieselbe Sendung. Nur
 * sind es nicht dieselben Folgen in derselben Reihenfolge, und die ARD-Liste
 * ROLLT obendrein (llmwiki ard-folgenliste-rollt).
 *
 * VON VORN IST DIE EHRLICHE ANTWORT. Eine Folge noch einmal zu hoeren kostet
 * ein Kind nichts; in einer fremden Folge zu landen klingt nach kaputt.
 */
export function stelleGiltFuer(z: Pick<Weiter, 'folge'> | null | undefined, dienst: string): boolean {
  // Die Folgenkennung ist das Merkmal, an dem eine ARD-Stelle haengt — und sie
  // ist ausserhalb der ARD bedeutungslos. Steht sie da, gilt die Stelle nur,
  // solange auch die ARD spielt.
  if (!String(z?.folge ?? '').trim()) return true
  // Und fuer Plugin-Inhalt (E90) — dort haengt die Stelle an derselben Sorte
  // Kennung, und ausserhalb ist sie ebenso bedeutungslos.
  return dienst === 'ard' || dienst === 'plugin'
}

/**
 * Was von einer Stelle uebrigbleibt, die nicht mehr gilt: NICHTS.
 *
 * DIE FOLGE UND IHR TITEL GEHEN MIT WEG, seit dem 06.08.2026 — und das war ein
 * Befund, kein Feinschliff. Bis dahin raeumte `VON_VORN` nur Nummer und
 * Position weg; `folge` blieb stehen, obwohl `stelleGiltFuer` die Stelle gerade
 * fuer ungueltig erklaert hatte. Mit dem Folgentitel waere daraus eine ANZEIGE
 * geworden, die luegt: auf der Kachel stuende „Der Schneemann taut", waehrend
 * die Box ein Spotify-Hoerbuch von vorn anfaengt. Ein stehengebliebenes Feld,
 * das man nicht sieht, ist harmlos; eines, das man liest, ist es nicht.
 *
 * `undefined` UND NICHT `''`: die Werte gehen durch `JSON.stringify` in die
 * Antwort, und `undefined` faellt dabei ganz heraus. Ein leerer String stuende
 * als Feld da und muesste ueberall mitgeprueft werden.
 */
export const VON_VORN = {
  titelNr: 0,
  positionMs: null,
  positionProzent: null,
  anteil: null,
  folge: undefined,
  folgeTitel: undefined,
  // UND DAS BILD GEHT MIT (E46, aus demselben Grund wie der Titel): eine
  // Kachel, die von vorn anfaengt, darf nicht das Gesicht der Folge tragen,
  // die gerade NICHT mehr gilt.
  folgeBild: undefined,
} as const

export function fortsetzenMit(
  z: Pick<Weiter, 'positionMs' | 'positionProzent' | 'anteil'> | null | undefined,
  dienst: string,
): Fortsetzung {
  // `null` IST HIER EINE ANGABE und darf nicht zu 0 werden: `Number(null)` ist
  // 0 und besteht jede Endlichkeitspruefung. Genau daran waere „kein Prozent
  // gemerkt" still zu „bei 0 % weitermachen" geworden — und die Umrechnung aus
  // `anteil` haette nie stattgefunden. Beim ersten Anlauf ist es passiert.
  const zahl = (x: unknown): number | null => {
    if (x === null || x === undefined || x === '') return null
    const n = Number(x)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const ms = zahl(z?.positionMs)
  const prozent = zahl(z?.positionProzent)
  const anteil = zahl(z?.anteil)
  if (dienst === 'spotify') {
    return { positionMs: ms === null ? null : Math.round(ms), positionProzent: null }
  }
  if (!ueberMpv(dienst)) return { positionMs: null, positionProzent: null }
  if (prozent !== null) {
    return { positionMs: null, positionProzent: Math.max(0, Math.min(100, prozent)) }
  }
  if (anteil !== null) {
    // Auf ein Zehntelprozent gerundet — feiner kann `seekpos:` ohnehin nicht,
    // und eine Zahl mit fuenfzehn Nachkommastellen im Befehl liest niemand.
    return { positionMs: null, positionProzent: Math.round(Math.max(0, Math.min(1, anteil)) * 1000) / 10 }
  }
  return { positionMs: null, positionProzent: null }
}

/** Aus einer Stelle die Zeile bauen, die die Oberflaeche braucht. */
export function zeileAus(s: Stelle, zuletzt: number): Weiter | null {
  const m = meldungAusEintrag(s)
  if (!m) return null
  return {
    key: m.key,
    titel: String(s.title ?? '').trim(),
    interpret: String(s.artist ?? '').trim(),
    typ: String(s.type ?? ''),
    titelNr: titelNummer(s),
    positionMs: positionMs(s),
    positionProzent: positionProzent(s),
    anteil: anteil(s),
    zuletzt,
    // Nur setzen, wo es sie gibt: ein leeres Feld an jeder Spotify-Zeile waere
    // eine Auskunft, die keine ist.
    ...(String(s.resumeardfolge ?? '').trim() ? { folge: String(s.resumeardfolge).trim() } : {}),
    ...(String(s.resumeardfolgentitel ?? '').trim() ? { folgeTitel: String(s.resumeardfolgentitel).trim() } : {}),
    ...(String(s.resumeardfolgenbild ?? '').trim() ? { folgeBild: String(s.resumeardfolgenbild).trim() } : {}),
  }
}

/**
 * Die Weiterhoeren-Reihe: was angefangen wurde, das zuletzt Angefangene zuerst.
 *
 * @param stellen  der Inhalt von resume.json
 * @param verlauf  der Inhalt von gespielt.json (liefert nur die ZEIT)
 * @param max      wie viele Zeilen hoechstens
 *
 * DOPPELTE FALLEN GEWINNT DIE HINTERE. `/api/addresume` der Box gleicht
 * Eintraege ueber `item.id === req.body.id` ab — bei einer Playlist ist `id`
 * auf BEIDEN Seiten undefined, und der Vergleich sagt dann faelschlich „schon
 * da". In `resume.json` koennen deshalb zwei Stellen zu demselben Werk
 * stehen. Zwei Kacheln fuer dasselbe Hoerspiel waeren fuer ein Kind schlicht
 * ein Fehler; genommen wird die WEITER HINTEN stehende, denn dort wird
 * angehaengt.
 *
 * OHNE ZEIT NACH HINTEN, aber untereinander in Dateireihenfolge von hinten:
 * `resume.json` waechst per `push`, spaeter im Array heisst also frueher
 * eingefuegt gleich aelter. Das ist kein Zeitstempel, aber die beste Ordnung,
 * die ohne einen zu haben ist.
 */
export function weiterhoerbare(
  stellen: readonly Stelle[],
  verlauf: readonly Gespielt[],
  max = STANDARD_ANZAHL,
): Weiter[] {
  if (!Array.isArray(stellen)) return []
  const zeiten = new Map<string, number>()
  for (const g of Array.isArray(verlauf) ? verlauf : []) {
    if (g?.key) zeiten.set(g.key, Number(g.zuletzt) || 0)
  }

  const nachSchluessel = new Map<string, { z: Weiter; platz: number }>()
  stellen.forEach((s, platz) => {
    if (!istWeiterhoerbar(s)) return
    const m = meldungAusEintrag(s)
    if (!m) return
    const z = zeileAus(s, zeiten.get(m.key) ?? 0)
    if (z) nachSchluessel.set(m.key, { z, platz })
  })

  return [...nachSchluessel.values()]
    .sort((a, b) => b.z.zuletzt - a.z.zuletzt || b.platz - a.platz)
    .slice(0, Math.max(0, max))
    .map((e) => e.z)
}

/**
 * Der Stand, den die Oberflaeche meldet — EINE Einheit: SEKUNDEN.
 *
 * SIE MELDET, WAS SIE SIEHT, und nicht, was daraus folgt. Bei Spotify sieht
 * sie `item.track_number` und `item.uri`; welche Position im Werk das ist,
 * kann sie nicht wissen — dafuer braucht es die Titelliste, und die holt der
 * Server (`zusammenhangFuer`). Der Zusammenhang kommt deshalb als eigener
 * Wert in `stelleAus`, nicht als Feld hier.
 */
export interface Stand {
  /**
   * Die Nummer, die die spielende Maschine nennt. 0, wenn sie keine nennt.
   *
   * ACHTUNG, ZWEI BEDEUTUNGEN: bei mpv ist es die Warteschlangennummer und
   * damit die Abspielposition. Bei Spotify ist es `item.track_number` — die
   * Nummer des Stuecks in SEINEM Album. Bei einem Album ist beides dasselbe,
   * bei einer Playlist nicht (Befund 02.08.2026). Siehe `stelleAus`.
   */
  titelNr?: number
  /**
   * Wie viele Titel die spielende Maschine in der Warteschlange hat. 0 = weiss
   * sie nicht.
   *
   * NUR mpv MELDET DAS SINNVOLL (`currentMeta.totalTracks`, am Geraet gesehen
   * 2026-08-02: `{"currentTracknr":"","totalTracks":"", …}` solange Spotify
   * spielt, gefuellt sobald mpv laeuft). Spotifys Zustand nennt zum
   * Abspielzusammenhang GAR KEINE Gesamtzahl — die kommt dort aus der
   * aufgeloesten Titelliste (`Zusammenhang.gesamt`) und nicht von hier.
   *
   * WOFUER ueberhaupt: ohne sie ist „Titel 12 zu 99 %" nicht von „mittendrin"
   * zu unterscheiden, und ein durchgehoertes Album blieb fuer immer in der
   * Weiterhoeren-Reihe stehen. Siehe `istDurch`.
   */
  gesamt?: number
  /** Wie weit der laufende Titel ist, in SEKUNDEN. */
  bisher?: number
  /** Wie lang der laufende Titel ist, in SEKUNDEN. */
  dauer?: number
}

/**
 * Aus Roheintrag und gemeldetem Stand eine Stelle fuer `resume.json` bauen.
 *
 * HIER UND NUR HIER WIRD DIE EINHEIT UMGERECHNET. Die Oberflaeche schickt
 * Sekunden — eine Einheit, in ihrem eigenen Wortschatz (`bisher`, `dauer`,
 * dieselben Namen wie im Mini-Player). Was `resume.json` daraus braucht,
 * haengt vom Dienst ab (Millisekunden bei Spotify, Prozent bei mpv). Wuerde
 * die Oberflaeche das selbst tun, stuende die Umrechnung an einer Stelle, die
 * sich nicht pruefen laesst — und die Einheitenfalle dieses Projekts hat
 * schon zweimal zugeschlagen.
 *
 * DIE TITELNUMMER WIRD NICHT VERSCHOBEN. Sie ist 1-basiert und geht so in den
 * Abspielbefehl, weil der Abspieldienst intern wieder eins abzieht
 * (`if (resumeOffset > 0) resumeOffset--`). Wer hier +1 rechnet, startet jedes
 * Mal den Titel danach. Die einzige Stelle, die +1 rechnet, ist
 * `zusammenhangAus` — dort, wo Spotifys 0-basierter Versatz hereinkommt.
 *
 * WELCHE NUMMER GILT: die aus dem ZUSAMMENHANG, wenn es eine gibt. Was die
 * Oberflaeche in `stand.titelNr` meldet, ist bei Spotify `item.track_number`
 * — die Nummer im ALBUM des Stuecks. Bei einer Playlist ist das eine andere
 * Zahl als die Abspielposition, und der Sprung landete damit in einem
 * fremden Kapitel (Befund 02.08.2026). Bei mpv gibt es diese Zweideutigkeit
 * nicht: dort IST die Warteschlangennummer die Abspielposition.
 *
 * Gibt `null` zurueck, wenn nichts Sinnvolles gespeichert werden kann — dann
 * wird auch nichts geschrieben, statt eine Stelle mit 0 abzulegen und damit
 * eine echte aeltere zu ueberschreiben.
 *
 * @param zus  was der Server ueber den Zusammenhang aufgeloest hat, falls
 *             ueberhaupt. Bei einer Spotify-PLAYLIST ist er PFLICHT.
 */
export function stelleAus(roh: Eintrag | null | undefined, stand: Stand, zus?: Zusammenhang | null): Stelle | null {
  if (!roh || typeof roh !== 'object') return null
  const dienst = dienstVon(roh)
  const bisher = Number(stand?.bisher)
  const dauer = Number(stand?.dauer)
  if (!Number.isFinite(bisher) || bisher < 0) return null
  const nrRoh = Number(stand?.titelNr)
  const nr = Number.isFinite(nrRoh) && nrRoh > 0 ? Math.round(nrRoh) : 0

  const versatzNr = Number(zus?.versatzNr)
  const geprueft = Number.isFinite(versatzNr) && versatzNr > 0 ? Math.round(versatzNr) : 0
  const gesamtRoh = Number(zus?.gesamt)
  const gesamt = Number.isFinite(gesamtRoh) && gesamtRoh > 0 ? Math.round(gesamtRoh) : 0
  // DIE GEMELDETE GESAMTZAHL IST DIE ZWEITRANGIGE. Sie stammt aus der
  // Maschine (mpv `totalTracks`); der aufgeloeste Zusammenhang stammt aus der
  // Titelliste des Dienstes und ist die genauere Auskunft. Wo es beides gibt,
  // gewinnt der Zusammenhang — nur eine der beiden Zahlen darf in
  // `resumeGesamtTitel` landen, sonst entscheidet `istDurch` mal so, mal so.
  const gemeldetRoh = Number(stand?.gesamt)
  const gemeldet = Number.isFinite(gemeldetRoh) && gemeldetRoh > 0 ? Math.round(gemeldetRoh) : 0

  const s: Stelle = { ...roh, category: 'resume' }

  if (dienst === 'spotify') {
    // LIEBER NICHTS MERKEN ALS FALSCH. Ohne aufgeloeste Position bliebe bei
    // einer Playlist nur die Album-Nummer — und die zeigt beim Fortsetzen in
    // ein fremdes Kapitel. Wer hier `null` bekommt, laesst die VORIGE Stelle
    // stehen; die ist hoechstens 15 Sekunden alt (Merktakt der Oberflaeche)
    // und damit fast so gut wie die neue.
    if (!geprueft && istSpotifyPlaylist(roh)) return null
    s.resumespotifytrack_number = geprueft || nr
    if (geprueft) s.resumeVersatzGeprueft = true
    // DIE GEMELDETE ZAHL IST HIER DER RUECKFALL, und ohne ihn fehlte sie bei
    // verschmolzenen Werken IMMER (Befund beim Gegenlesen, 2026-08-03):
    //
    //   Eine verschmolzene Kachel traegt die Identitaet des SPOTIFY-Eintrags,
    //   gespielt wird aber ueber Jellyfin — auf der Box ist das der Regelfall
    //   („Das Lumpenpack"). Dann meldet die Oberflaeche einen mpv-Stand ohne
    //   `titelUri`, `zusammenhangFuer` gibt daraufhin sofort `null` zurueck
    //   (`if (!kennung || !uri) return null`), und `gesamt` ist 0. `istDurch`
    //   braucht die Gesamtzahl aber — ein zu Ende gehoertes Hoerspiel bliebe
    //   also FUER IMMER in der Weiterhoeren-Reihe stehen und lockte das Kind
    //   in die letzten Sekunden zurueck. Genau der Fehler, der am 02.08.2026
    //   fuer den mpv-Weg schon einmal behoben wurde.
    //
    // DER AUFGELOESTE ZUSAMMENHANG BEHAELT DEN VORRANG: er stammt aus der
    // Titelliste des Dienstes und ist die genauere Auskunft. Bei echtem
    // Spotify-Abspielen meldet die Oberflaeche ohnehin keine Gesamtzahl
    // (`gesamt` nur bei `np.art === 'lokal'`), der Rueckfall greift dort also
    // gar nicht erst.
    const gesamtSpotify = gesamt || gemeldet
    if (gesamtSpotify) s.resumeGesamtTitel = gesamtSpotify
    s.resumespotifyprogress_ms = Math.round(bisher * 1000)
    // Ohne brauchbare Laenge lieber 0 als eine erfundene: `anteil()` liefert
    // dann null, und niemand behauptet einen Fortschritt.
    s.resumespotifyduration_ms = Number.isFinite(dauer) && dauer > 0 ? Math.round(dauer * 1000) : 0
    return s
  }

  // mpv rechnet in PROZENT — ohne Laenge gibt es keinen Prozentwert.
  if (!Number.isFinite(dauer) || dauer <= 0) return null
  const prozent = Math.max(0, Math.min(100, (bisher / dauer) * 100))

  if (dienst === 'lokal') {
    // Der klassische Player braucht die urspruengliche Kategorie, um das
    // Album wiederzufinden — `category` selbst traegt gleich 'resume'.
    s.resumelocalalbum = String(roh.category ?? '')
    s.resumelocalcurrentTracknr = nr
    s.resumelocalprogressTime = prozent
    // WAS DAS ALBUM LANG IST, WEISS NUR DIE WARTESCHLANGE. Bei Spotify faellt
    // die Zahl beim Aufloesen der Position ab; bei mpv gibt es nichts
    // aufzuloesen, und ohne diese Meldung bliebe ein durchgehoertes Album
    // fuer immer in der Reihe stehen (der offene Punkt vom 02.08.2026).
    //
    // NUR NACH OBEN GEFAEHRLICH: Meldet mpv zu WENIG, faellt ein Album zu
    // frueh aus der Reihe — es steht dann noch im Raster darunter und faengt
    // ehrlich von vorn an. Meldet es zu VIEL, bleibt alles wie bisher. Beide
    // Richtungen sind harmlos; ein falscher SPRUNG waere es nicht.
    if (gemeldet) s.resumeGesamtTitel = gemeldet
    return s
  }

  if (dienst === 'rss') {
    s.resumerssprogressTime = prozent
    return s
  }

  if (dienst === 'jellyfin') {
    /*
     * DAS ERSTE VON ZWEI TOREN — und das war der eigentliche Befund
     * (06.08.2026, Box .169, tools/stelle-je-dienst-am-geraet.mjs).
     *
     * Bis heute fiel `jellyfin` hier unten durch auf `return null`. Der Server
     * antwortete `nichtMerkbar` und schrieb NICHTS; die Aufzaehlung in
     * `istWeiterhoerbar` kam nie an die Reihe und hatte deshalb auch nie etwas
     * zu filtern. Wer nur dort `jellyfin` ergaenzt haette, haette gar nichts
     * geaendert — gemessen: `{"status":"nichtMerkbar"}`, resume.json
     * unveraendert (md5 identisch), 0 Eintraege mit `type: jellyfin*`.
     *
     * PROZENT WIE LOKAL UND RSS: ein Jellyfin-Album laeuft ueber mpv, und mpv
     * rechnet in Prozent (llmwiki resume-lokal-ist-prozent-nicht-sekunden).
     *
     * KEIN `resumelocalalbum`: siehe `Stelle.resumejellyfincurrentTracknr` —
     * es gibt kein Verzeichnis auf der SD-Karte, das der klassische Player
     * damit finden koennte.
     */
    s.resumejellyfincurrentTracknr = nr
    s.resumejellyfinprogressTime = prozent
    // Wie beim lokalen Album: nur die Warteschlange weiss, wie lang das Album
    // ist. Ohne diese Zahl bliebe ein durchgehoertes Album fuer immer in der
    // Reihe stehen (`istDurch`). Zu wenig gemeldet heisst „zu frueh aus der
    // Reihe", zu viel „wie bisher" — beide Richtungen sind harmlos.
    if (gemeldet) s.resumeGesamtTitel = gemeldet
    return s
  }

  if (dienst === 'ard' || dienst === 'plugin') {
    /*
     * DIE FOLGENKENNUNG IST PFLICHT, sonst wird NICHTS gemerkt (05.08.2026).
     *
     * Hinter einer ARD-Kachel steht keine feste Titelliste, sondern eine
     * rollende: kommt eine neue Folge dazu, ruecken bei „neueste zuerst" alle
     * anderen um eins nach hinten. Eine Stelle, die nur „Titel 7 bei 41 %"
     * sagt, zeigt danach in eine Folge, die das Kind nie gehoert hat — genau
     * die Falle der Spotify-Playlist (02.08.2026), nur dass sie hier von
     * selbst zuschnappt.
     *
     * LIEBER NICHTS ALS FALSCH, dieselbe Entscheidung wie dort: Wer `null`
     * bekommt, laesst die VORIGE Stelle stehen; die ist hoechstens einen
     * Merktakt (15 s) alt.
     *
     * WAS HIER NICHT HINEINKOMMT: die Tonadresse. Sie steht in keinem der
     * Felder, und sie kann auch nicht ueber `{...roh}` hereinrutschen — der
     * data.json-Eintrag einer ARD-Sendung traegt nur die Sendungskennung
     * (ard.ts `eintragAus`). Der Test „keine Tonadresse in der Stelle" haelt
     * das fest.
     */
    const folge = String(zus?.folge ?? '').trim()
    if (!folge) return null
    s.resumeardfolge = folge
    // DER TITEL IST KEIN PFLICHTFELD, und das ist der Unterschied zur Zeile
    // darueber. Er ist der RUECKFALL fuer den Tag, an dem die Kennung nicht
    // mehr trifft (`folgeWiederfinden`); ihn zur Bedingung zu machen hiesse,
    // eine brauchbare Stelle wegen einer Kosmetik wegzuwerfen. Nur setzen, wo
    // es ihn gibt — ein leeres Feld waere eine Auskunft, die keine ist.
    const folgeTitel = String(zus?.folgeTitel ?? '').trim()
    if (folgeTitel) s.resumeardfolgentitel = folgeTitel
    // DAS BILD IST WIE DER TITEL KEIN PFLICHTFELD (E46) — eine Sendung ohne
    // Folgenbilder darf ihre Stelle behalten und faellt beim Zeichnen auf das
    // Sendungscover zurueck.
    const folgeBild = String(zus?.folgeBild ?? '').trim()
    if (folgeBild) s.resumeardfolgenbild = folgeBild
    s.resumeardcurrentTracknr = nr
    s.resumeardprogressTime = prozent
    // Wie viele Folgen die Sendung beim Merken hatte — sonst waere „Folge 30
    // zu 99 %" nicht von „mittendrin" zu unterscheiden und die Sendung bliebe
    // fuer immer in der Reihe stehen (`istDurch`). Der aufgeloeste
    // Zusammenhang hat wie ueberall Vorrang vor der Meldung der Maschine.
    const gesamtArd = gesamt || gemeldet
    if (gesamtArd) s.resumeGesamtTitel = gesamtArd
    return s
  }

  // Radio hat keine Stelle — ein Strom laeuft immer „jetzt". Bewusst NICHT
  // gemerkt; es gaebe keinen Ort, an den man zurueckkehrte.
  return null
}

/**
 * Eine Stelle in die Liste einsetzen und die Liste im Zaum halten.
 *
 * ERSETZT UEBER DEN MEDIENSCHLUESSEL, nicht ueber `id`: `/api/addresume` der
 * Box vergleicht `item.id === req.body.id`, und bei zwei Playlists sind beide
 * `undefined` — der Vergleich stimmt dann zu, und eine fremde Stelle wird
 * ueberschrieben. Genau dieser Fehler soll sich hier nicht wiederholen.
 *
 * DECKEL WIE AUF DER BOX: `remove_max_resume.sh` schneidet die Liste auf
 * `mupibox.resume` (Vorgabe 9) zurueck — allerdings als root, angestossen aus
 * der klassischen Oberflaeche. Der Server kann das selbst, ohne root und ohne
 * ein zweites Mal dieselbe Regel zu erfinden. Es faellt das AELTESTE heraus
 * (vorn in der Liste), denn dort steht, was am laengsten niemand angefasst hat.
 *
 * ══ DER DECKEL ZAEHLT NUR GEMERKTE STELLEN ════════════════════════════════
 *
 * Hier stand `raus.length > deckel ? raus.slice(raus.length - deckel)` — der
 * Schnitt lief ueber die GANZE Datei, also auch ueber Eintraege, die keine
 * gemerkte Stelle sind. Genau diesen Fehler hat `remove_max_resume.sh` am
 * 07.08.2026 abgelegt (es zaehlte `.category == "resume"` und loeschte nach
 * Position); im Skript steht seither ausdruecklich, `stelleEinsetzen` lasse
 * Fremdes stehen. Das war eine Behauptung ueber diese Funktion, die diese
 * Funktion nicht einloeste — und ein Querverweis, der luegt, ist schlimmer als
 * keiner.
 *
 * GEMESSEN am 07.08.2026: 12 Eintraege (6 resume, 6 fremd) plus eine neue
 * Stelle, Deckel 3. Heraus kamen 3 Eintraege — 2 gemerkte Stellen und 1
 * fremder. Zweimal falsch: fuenf fremde Eintraege waren weg, und der Deckel
 * fuer die gemerkten Stellen war gar nicht getroffen (2 statt 3). Die jq-Kette
 * des Skripts liefert auf derselben Liste 3 gemerkte Stellen und alle 6
 * fremden. Auf einer Box liegt heute nur `resume` in diesen Dateien (am
 * 07.08.2026 an .169 nachgesehen: gast 9, kalea 7, alle `resume`) — fuer eine
 * reine Liste ist die neue Zaehlweise Eintrag fuer Eintrag dieselbe wie die
 * alte, und genau das steht als Messung daneben.
 *
 * NULL HEISST NULL. `max > 0` bog eine ausdrueckliche 0 auf 9 zurueck — die
 * Zahl, die „gar nichts merken" heisst, haette also neun Stellen gemerkt. Der
 * Aufrufer faengt 0 heute vorher ab (`/api/weiterhoeren` antwortet
 * `ausgeschaltet`), aber eine Grenze, die nur haelt, weil ein anderer vorher
 * aufpasst, haelt beim naechsten Aufrufer nicht mehr.
 *
 * @param schluesselVon  wie ein Eintrag zu vergleichen ist (medienSchluessel)
 */
export function stelleEinsetzen(
  liste: readonly Stelle[],
  neu: Stelle,
  schluesselVon: (e: Eintrag) => string,
  max = 9,
): Stelle[] {
  const alt = Array.isArray(liste) ? liste : []
  const k = schluesselVon(neu)
  // Fremde Eintraege (ohne category 'resume') bleiben unangetastet — die
  // Datei ist eine Medienliste, und es steht nirgends geschrieben, dass nur
  // Resume-Eintraege darin sein duerfen.
  const behalten = alt.filter((e) => schluesselVon(e) !== k)
  const raus = [...behalten, neu]
  const deckel = Number.isFinite(max) && max >= 0 ? Math.round(max) : 9
  const zuviel = raus.filter(istGemerkteStelle).length - deckel
  if (zuviel <= 0) return raus
  // DIE AELTESTEN `zuviel` GEMERKTEN STELLEN, UND NUR DIE. Vorn steht, was am
  // laengsten niemand angefasst hat; alles Fremde wird uebersprungen und
  // bleibt an seinem Platz.
  let offen = zuviel
  return raus.filter((e) => {
    if (offen > 0 && istGemerkteStelle(e)) {
      offen -= 1
      return false
    }
    return true
  })
}

/**
 * Ist dieser Eintrag eine GEMERKTE STELLE — oder liegt er nur mit in der Datei?
 *
 * DIE EINE STELLE, an der diese Frage steht. Sie wird an drei Orten gebraucht:
 * beim Deckel (`stelleEinsetzen`), bei der Vorhersage des Verlusts
 * (`/api/profil/merken`) und in der jq-Kette von `remove_max_resume.sh`
 * (`select(.category == "resume")`). Dass die drei bis zum 07.08.2026
 * verschieden zaehlten, ist der ganze Grund, warum sie hier einmal steht.
 */
export function istGemerkteStelle(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { category?: unknown }).category === 'resume'
}
