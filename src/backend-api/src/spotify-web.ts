/**
 * Was die Web-API-Durchreiche durchlaesst.
 *
 * WARUM ES DIE DURCHREICHE GIBT: Spotify beantwortet Aufrufe der Web-API, die
 * eine Origin-Kopfzeile tragen — also jeden Aufruf aus einem Browser — mit 403
 * und LEEREM Koerper. Ausgenommen sind allein die Wiedergabe-Endpunkte
 * (/me/player*). Serverseitig geht mit demselben Token alles.
 *
 * WARUM EIGENES STUECK: die Liste ist die einzige Grenze der Durchreiche, und
 * die traegt den Token der Box. Waere sie offen, koennte jeder im selben Netz
 * mit den Rechten der Box beliebige Aufrufe machen — auch schreibende. Als
 * eigenes Stueck ist sie pruefbar, ohne den Server zu starten; abgeschrieben in
 * den Test waere sie es nur scheinbar (zwei Listen laufen auseinander).
 */

/** Die Formen, die durchgelassen werden — bewusst eng und lesend. */
export const WEB_API_ERLAUBT: RegExp[] = [
  /^me$/,
  // Die EINE Wiedergabe-Ausnahme: die GERAETELISTE. Sie ist rein lesend und
  // die Oberflaeche braucht sie aus jeder Herkunft (auch ein Verwaltungs-
  // Browser ohne eigene Spotify-Anmeldung), um zu pruefen, ob das
  // librespot-Geraet der Box angemeldet ist. Steuerbefehle (play/pause/...)
  // bleiben draussen — die gehen aus dem Browser weiterhin direkt.
  /^me\/player\/devices$/,
  /^me\/(playlists|albums|shows|tracks|episodes|following)(\/|$)/,
  /^(playlists|albums|shows|tracks|artists|episodes|audiobooks|chapters)\/[A-Za-z0-9]+(\/[a-z]+)?$/,
  // DIE BELIEBTESTEN TITEL EINES INTERPRETEN — eine eigene Zeile, und zwar
  // wegen des BINDESTRICHS. Das allgemeine Muster darueber laesst als
  // Unterpfad nur `[a-z]+` zu; `top-tracks` faellt still hindurch, und die
  // Durchreiche antwortet 400 „Pfad nicht vorgesehen".
  //
  // BEWUSST NICHT den Bindestrich ins allgemeine Muster nehmen: das oeffnete
  // zugleich `artists/<id>/related-artists`, und den hat Spotify am
  // 2024-11-27 fuer neue Anwendungen abgeschaltet (mit `recommendations` und
  // `audio-features`). GEMESSEN an der Box am 2026-08-02, an der Erlaubnis-
  // liste vorbei mit dem Token der Box (tools/spotify-endpunkt-probe.sh):
  //     artists/<id>/top-tracks?market=DE   HTTP 200, 10 Titel
  //     artists/<id>/related-artists        HTTP 404
  // Eine Erlaubnis, die nie eine Antwort bringt, ist eine Erlaubnis zu viel.
  //
  // ENGER ALS DIE NACHBARZEILE: `{22}` statt `+`. Spotify-Kennungen sind
  // 22 Zeichen aus [A-Za-z0-9]; alles andere ist ohnehin kein Interpret,
  // und diese Zeile ist neu — sie muss den alten, weiteren Zuschnitt nicht
  // erben.
  /^artists\/[A-Za-z0-9]{22}\/top-tracks$/,
  /^search$/,
  /^browse\//,
]

/**
 * Darf dieser Pfad durch?
 *
 * Die Wiedergabe-STEUERUNG ist ABSICHTLICH nicht dabei: sie ist der einzige
 * Teil, den Spotify aus dem Browser noch beantwortet, und ueber die Box zu
 * laufen machte sie nur langsamer und stoeranfaelliger. Einzig die lesende
 * Geraeteliste ist erlaubt (siehe Kommentar in der Liste).
 */
export function webApiPfadErlaubt(pfad: string): boolean {
  return WEB_API_ERLAUBT.some((r) => r.test(pfad))
}

/**
 * Darf diese Kennung an die Warteschlange angehaengt werden?
 *
 * WOZU DIESE FRAGE UEBERHAUPT SERVERSEITIG GESTELLT WIRD (BACKLOG E15/S3):
 * Das Anhaengen war der EINZIGE Zweck, fuer den die Oberflaeche noch einen
 * echten Spotify-Zugang im Browser brauchte — alles Lesende geht laengst ueber
 * die Durchreiche. Solange dieser eine Rest bleibt, muss `/api/spotify/config`
 * weiterhin `clientId` und `refreshToken` herausgeben, und E15/S4 ist
 * unmoeglich. Also wandert er hierher.
 *
 * DAS IST EIN SCHREIBENDER WEG und deshalb NICHT in `WEB_API_ERLAUBT`, sondern
 * ein eigener, benannter Weg mit genau einer Wirkung: einen TITEL anhaengen.
 * Waere er in der Liste, waere die Durchreiche keine lesende mehr, und die
 * naechste schreibende Form kaeme umsonst mit.
 *
 * NUR TITEL UND FOLGEN. Eine Album- oder Playlist-uri nimmt Spotify hier
 * ohnehin nicht an (die Schnittstelle ist titelweise) — und ein `spotify:user:`
 * oder gar eine fremde URL hat in einem Aufruf mit dem Zugang der Box nichts
 * verloren. Spotify-Kennungen sind 22 Zeichen aus [A-Za-z0-9].
 */
const WARTESCHLANGE_ERLAUBT = /^spotify:(track|episode):[A-Za-z0-9]{22}$/

export function warteschlangeUriErlaubt(uri: unknown): boolean {
  return typeof uri === 'string' && WARTESCHLANGE_ERLAUBT.test(uri)
}

/** Ein Geraet aus Spotifys Liste — mehr als Name und Kennung braucht die Wahl nicht. */
export interface SpotifyGeraet {
  id?: string | null
  name?: string
}

/**
 * WIE die Box in Spotifys Geraeteliste gefunden wurde — oder warum nicht.
 *
 *   name         Der Boxname steht namensgenau in der Liste. Der Normalfall.
 *   ohne-namen   Wir kennen unseren eigenen Namen nicht (Konfiguration nicht
 *                lesbar). Dann darf nicht geurteilt werden; das erste Geraet
 *                ist die einzige Wahl, die es gibt.
 *   ersatz       Der Name passt auf nichts, aber es steht GENAU EIN Geraet in
 *                der Liste. Dann kann es nur die Box sein.
 *   mehrdeutig   Mehrere Geraete, keines traegt unseren Namen. Hier wird NICHT
 *                geraten.
 *   keine-geraete  Die Liste ist leer.
 */
export type Geraetewahl =
  | { wie: 'name' | 'ohne-namen' | 'ersatz'; geraet: SpotifyGeraet }
  | { wie: 'mehrdeutig' | 'keine-geraete'; geraet: null }

/**
 * WELCHES GERAET IST DIE BOX? — die eine Antwort fuer beide Dienste.
 *
 * WARUM SIE HIER STEHT UND NICHT ZWEIMAL: Dieselbe Frage wurde bisher an zwei
 * Stellen verschieden beantwortet — `bereitschaftUrteil` (der Waechter VOR dem
 * Abspielen, hier) sagte bei einem unbekannten Namen nein, `geraetAufloesen`
 * (spotify-control.ts, der Dienst, der WIRKLICH spielt) fiel auf `geraete[0]`
 * zurueck und spielte. Zwei Meinungen ueber dieselbe Lage heissen: die
 * Oberflaeche verweigert etwas, das funktioniert haette.
 *
 * DAS SZENARIO, DAS ES AUSLOEST: Jemand aendert den Boxnamen in der
 * Verwaltung. `mupibox.host` ist zugleich LIBRESPOT_NAME (env-librespot), und
 * librespot liest ihn NUR BEIM START — bis zum naechsten Neustart heisst das
 * Geraet bei Spotify weiter alt. Die Box spielt einwandfrei, und der Waechter
 * haette jede Spotify-Kachel abgewiesen.
 *
 * WARUM DER RUECKFALL AUF `geraete[0]` TROTZDEM NICHT BLEIBT: In der
 * Geraeteliste stehen auch Geister — ein Browser-Tab vom Rechner, das Telefon
 * der Eltern. Fiele die Wahl darauf, spielte Spotify unsichtbar im
 * Nachbarzimmer, waehrend das Kind vor einer stillen Box sitzt (die Falle
 * steht im Wiki bei setActiveDevice). Ein Rueckfall ist deshalb nur dann
 * eindeutig, wenn es NICHTS ANDERES gibt: genau ein Geraet in der Liste. Bei
 * mehreren wird nicht geraten — dann ist „nicht bereit" die ehrliche Antwort,
 * und sie stimmt fuer beide Seiten.
 */
/**
 * Zwei Geraetenamen, die DIESELBE Box meinen.
 *
 * Zwei Arten von Abweichung sind erlaubt, und beide sind belegt:
 *
 *   1. SCHREIBWEISE — „MixPi Box", „mixpibox", „MixPi-Box". Klein-/Grossschrift
 *      und Trennzeichen sagen nichts ueber die Identitaet.
 *   2. DIE UMBENENNUNG DES PROJEKTS — „MuPiBox" wurde zu „MixPiBox". Ein
 *      Geraet, das noch den alten Namen ansagt, IST diese Box: der Name kam
 *      einmal aus der falschen Datei, und ein Waechter, der daraufhin nein
 *      sagt, erzeugt die Stoerung, gegen die er gebaut ist (der bestehende
 *      Test haelt genau das fest).
 *
 * ALLES ANDERE IST EIN ANDERES GERAET. „Smart Soundbar 10158750" ist keine
 * Schreibweise von „MixPiBox".
 */
function aehnlich(a: string | undefined, b: string): boolean {
  const raeumen = (s: string) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      // Die Umbenennung des Projekts auf EINEN Namen zurueckfuehren.
      .replace(/^mupibox/, 'mixpibox')
  const x = raeumen(a || '')
  const y = raeumen(b)
  return x.length > 0 && x === y
}

export function geraetWaehlen(geraete: ReadonlyArray<SpotifyGeraet>, name: string): Geraetewahl {
  const liste = (geraete ?? []).filter((g) => !!g)
  if (liste.length === 0) return { wie: 'keine-geraete', geraet: null }
  const gesucht = String(name ?? '').trim()
  // OHNE NAMEN WIRD NICHT GEURTEILT. Der Name kam schon einmal aus der
  // falschen Datei und lautete „MuPiBox", waehrend die Box „MixPiBox" heisst —
  // ein Waechter, der daraufhin nein sagt, erzeugt die Stoerung, gegen die er
  // gebaut ist.
  if (!gesucht) return { wie: 'ohne-namen', geraet: liste[0] }
  const eigen = liste.find((g) => g.name === gesucht)
  if (eigen) return { wie: 'name', geraet: eigen }
  // ══ EIN EINZELNES FREMDES GERAET IST NICHT DIE BOX ═══════════════════════
  //
  // Betreiber, 12.08.2026: „wenn ich von einem anderen account das geraet als
  // ausgabe medium verwende spielt die box nicht das lied sondern das zuvor
  // gehoerte lied ab und zwar auf einem anderen medium konkret hier die
  // soundbar."
  //
  // Genau diese Zeile war es. Uebernimmt ein FREMDES Konto librespot, faellt
  // die Box aus der Geraeteliste IHRES Kontos. Blieb dort genau ein Geraet
  // uebrig — die Soundbar im Wohnzimmer —, nahm `ersatz` sie unbesehen, und
  // der Abspieldienst schickte seinen eigenen letzten Stand dorthin. Also:
  // falsches Lied, falscher Raum.
  //
  // DIE REGEL BLEIBT, ABER SIE PRUEFT JETZT DEN NAMEN. Sie entstand, weil der
  // Boxname einmal aus der falschen Datei kam („MuPiBox" statt „MixPiBox") —
  // eine Schreibweise daneben soll nicht zum Verstummen fuehren. Ein voellig
  // anderer Name ist aber kein Schreibfehler, sondern ein anderes Geraet.
  //
  // VERGLICHEN WIRD ENTSCHAERFT: Kleinschreibung, ohne Leer- und Bindezeichen.
  // „MixPi Box", „mixpibox" und „MixPi-Box" sind dieselbe Box; „Smart Soundbar
  // 10158750" ist es nicht.
  //
  // UND IM ZWEIFEL LIEBER STILL: Auf einer Kinderbox ist Schweigen mit einem
  // lesbaren Grund besser als Ton im falschen Zimmer.
  if (liste.length === 1 && aehnlich(liste[0]?.name, gesucht)) {
    return { wie: 'ersatz', geraet: liste[0] }
  }
  return { wie: 'mehrdeutig', geraet: null }
}

/**
 * Ist die Box abspielbereit — gemessen an Spotifys Geraeteliste?
 *
 * Diese Auskunft wird VOR dem Abspielen gefragt, und ein Nein verhindert es.
 * Ein Fehlalarm erzeugt damit genau die Stoerung, gegen die er gebaut ist.
 * Deshalb urteilt sie ueber GENAU DIE Wahl, die der Abspieldienst gleich
 * treffen wird (`geraetWaehlen`) — und nicht ueber eine eigene, strengere.
 */
export function bereitschaftUrteil(
  geraete: Array<SpotifyGeraet>,
  name: string,
): { bereit: boolean; grund?: 'keine-geraete' | 'box-fehlt' | 'ersatzgeraet' } {
  const wahl = geraetWaehlen(geraete, name)
  if (wahl.wie === 'keine-geraete') return { bereit: false, grund: 'keine-geraete' }
  if (wahl.wie === 'mehrdeutig') return { bereit: false, grund: 'box-fehlt' }
  // ERSATZ IST BEREIT, sagt es aber dazu: der Abspieldienst nimmt dasselbe
  // Geraet, und die Oberflaeche kann den Hinweis in der Diagnose zeigen, ohne
  // dass er das Abspielen verhindert.
  if (wahl.wie === 'ersatz') return { bereit: true, grund: 'ersatzgeraet' }
  return { bereit: true }
}
