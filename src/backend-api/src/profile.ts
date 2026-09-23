/**
 * Wem gehoert, was auf dieser Box liegt?
 *
 * WOFUER: Verlauf, Weiterhoeren und Kinderzeit sind heute EINE Ablage fuer
 * EINE Box. Sobald zwei Kinder daran hoeren, sind es die Zahlen von beiden —
 * „oft gehoert" zeigt die Mischung, und das Zeitkonto ist ein gemeinsames.
 * Getrennt gehoeren laut Wiki (`mixpi-die-geschichte`) und BACKLOG E18 genau
 * diese drei; die BIBLIOTHEK bleibt gemeinsam.
 *
 * DAS HIER IST DIE VORBEREITUNG, kein Anmeldewesen. Es gibt AB SOFORT einen
 * Besitzer, und er heisst `gast`. Damit aendert sich am Verhalten NICHTS —
 * die Box spielt ohne jede Auswahl wie bisher —, aber jede Ablage hat einen
 * Namen, unter dem sie liegt. Ein Anmeldebildschirm ist danach ein
 * Umschalter, kein Umbau.
 *
 * DIE FRAGE, DIE ZUERST BEANTWORTET WERDEN MUSSTE, steht im Wiki: „Was
 * passiert, wenn NIEMAND angemeldet ist? Eine Box, die erst nach einer
 * Anmeldung Musik macht, ist morgens um sieben das falsche Geraet." Antwort:
 * dann ist `gast` dran. Es gibt keinen Zustand „niemand".
 *
 * EIN PROFIL IST EINE FIGUR, KEIN KONTO. Kein Passwort, keine Tastatur, kein
 * Namensfeld — ein Kind, das noch nicht liest, erkennt seinen Zugang am
 * Wesen. Wer das Anlegen und Aendern schuetzen will, nimmt die vorhandene
 * PIN-Sperre der VERWALTUNG; das Waehlen an der Box bleibt ungeschuetzt.
 *
 * REIN: kein fs, kein Netz, keine Uhr. `angelegt` kommt von aussen herein.
 */

/** Ein Profil — eine Figur mit einem Namen und einer Kennung. */
export interface Profil {
  /**
   * Kurzname fuer DATEINAMEN und Speicherschluessel.
   *
   * Deshalb das enge Muster: die Kennung wandert nach
   * `gespielt.<kennung>.json` und nach `mupibox_p_<kennung>_…`. Ein Kind
   * namens „../../etc" darf keinen Pfad ergeben, und ein Punkt darin wuerde
   * zwei verschiedene Kennungen auf denselben Dateinamen abbilden.
   */
  kennung: string
  /** Was Erwachsene lesen. Fuer das Kind ist die FIGUR das Erkennungszeichen. */
  name: string
  /**
   * Das ERKENNUNGSZEICHEN des Kindes: ein Dateiname aus `FIGUR_ORDNER` —
   * ein NAME, kein Pfad (siehe `FIGUR_MUSTER`).
   *
   * LEER HEISST „noch keines ausgesucht" (`OHNE_FIGUR`), nicht „kaputt".
   * Ein Kind, das nicht liest, erkennt sein Zeug am Bild; deshalb ist die
   * Figur ein Feld des PROFILS und kein Bild in der Oberflaeche.
   */
  figur: string
  /** Wann angelegt (ms seit 1970). Nur zum Anzeigen und Sortieren. */
  angelegt: number
  /**
   * DAS PASSWORT DES KINDES — oder keines (Betreiber, 14.08.2026: „ein
   * passwort aus zeichen, farb punkten, stichmuster, zahlen").
   *
   * Hier liegt NIE das Passwort selbst, sondern sein bcrypt-Abdruck. Die
   * `art` sagt der Oberflaeche nur, WELCHE Eingabe sie zeigen soll
   * (Tastatur, Ziffernfeld, Farbreihe, Musterfeld) — vier Eingaben, EIN
   * Feld: jede Eingabe wird VOR dem Abdruck zu einer Zeichenkette mit
   * Art-Vorsatz (z. B. `n:2580`), damit „1-2-3 in Farben" nie zufaellig
   * „1-2-3 in Ziffern" oeffnet.
   *
   * DER GAST HAT NIE EINES (`profileNormalisieren` streift es ab): er ist
   * der Rueckfall fuer alle — ein Rueckfall mit Schloss davor waere eine
   * Box, an der niemand mehr hoeren kann. Und weil das Feld im Abdruck
   * NIEMALS die Box verlassen darf, gehen Antworten nach draussen ueber
   * `standFuerAntwort` (dort steht die Gegenprobe dazu).
   */
  passwort?: ProfilPasswort
  /**
   * WIE VIELE STELLEN SICH DIE BOX FUER DIESES KIND MERKT — oder gar nichts.
   *
   * FEHLT DAS FELD, GILT DIE BOX-ZAHL (`mupibox.resume`). Das ist keine
   * Bequemlichkeit, sondern die Bedingung, unter der dieses Feld ueberhaupt
   * dazukommen durfte: ein Kind, das nie etwas eingestellt hat, muss sich
   * verhalten wie am Tag davor. Deshalb ist es OPTIONAL und nicht etwa mit
   * einer Vorgabe belegt — eine Vorgabe waere eine zweite Antwort auf dieselbe
   * Frage, und beim naechsten Verstellen der Box-Zahl liefen die beiden
   * auseinander, ohne dass jemand es merkt.
   *
   * ══ WARUM HIER UND NICHT IN EINER EIGENEN DATEI JE KIND ═══════════════════
   *
   * Eine neue Ablage je Kind muss an DREI Stellen nachgetragen werden:
   * `BEREICH_ABLAGEN` (hier drunter), die Aufnahmeliste von
   * `scripts/mupibox/mupibox-sicherung.py` und `tools/bereich-sicherung-
   * deckung.py`. Genau dort ist am 07.08.2026 `profile.json` SELBST
   * durchgefallen und fiel aus jeder Sicherung. Sie ist seitdem drin — eine
   * Zahl DARIN kommt ohne eine einzige weitere Stelle mit.
   *
   * UND SIE VERSCHWINDET MIT DEM KIND, ohne dass jemand daran denken muss.
   * Wird ein Profil geloescht, faellt sein Eintrag aus dieser Liste, und die
   * Zahl faellt mit. Eine eigene Datei muesste `bereichBeiseite()` mitnehmen,
   * ein Eintrag in einer box-weiten Ablage muesste `kennungVergessen()`
   * mitnehmen — und genau dieses Vergessen ist in der Nacht zum 07.08.2026
   * dreimal misslungen (Browserspeicher, kinderzeit.json, Arbeitsspeicher).
   *
   * GRENZEN 0..99 — DIESELBEN WIE BEIM BOX-FELD (`konfiguration.ts`, `min: 0`,
   * `max: 99`). Ein Kinderfeld mit anderen Grenzen als das Feld, das es
   * ueberstimmt, waere eine zweite Wahrheit darueber, was erlaubt ist.
   * `0` ist eine gueltige Wahl und heisst „gar nichts merken" — dasselbe wie
   * `mupibox.resume: 0` heute, und keine Sackgasse: die Zahl laesst sich
   * jederzeit wieder heraufsetzen. Was bis dahin weggefallen ist, kommt
   * allerdings nicht zurueck (siehe `merkenVerlust`).
   */
  /**
   * DER GEBURTSTAG DES KINDES (ISO, `JJJJ-MM-TT`) — oder gar nichts.
   *
   * Betreiber, 15.08.2026: „ich würde gerne im profil das geburtsdatum
   * angeben und basierend darauf die ard sammlungen anzeigen".
   *
   * WARUM DAS DATUM UND NICHT DAS ALTER: ein Alter veraltet. Wer „5"
   * eintraegt, bekommt in zwei Jahren immer noch Geschichten fuer
   * Fuenfjaehrige — und niemand denkt daran, es nachzuziehen. Das Datum
   * rechnet sich jeden Tag selbst um (`alterAus`).
   *
   * FEHLT ES, GILT KEIN ALTER — und kein Alter heisst „alles zeigen",
   * nicht „nichts zeigen". Eine Box, die nach einem Update pl√∂tzlich die
   * halbe Bibliothek versteckt, weil ein Feld leer ist, waere der
   * schlimmste Ausgang.
   */
  geburtstag?: string
  merken?: number
  /**
   * WIRD DIESEM KIND EINE NACHRICHT VORGELESEN? (20.09.2026)
   *
   * Betreiber: „das vorlesen soll an und ausgeschaltet werden koennen fuer
   * das jeweilige profil". Der Anlass liegt auf der Hand, sobald zwei Kinder
   * an einer Box hoeren: das eine liest schon und will nicht unterbrochen
   * werden, das andere liest nicht und erfuehrte sonst nie, dass jemand
   * geschrieben hat.
   *
   * FEHLT DAS FELD, GILT DIE BOX-EINSTELLUNG (`nachrichten.vorlesen`) —
   * dieselbe Regel wie bei `merken` darueber, und aus demselben Grund: ein
   * Kind, das nie etwas eingestellt hat, verhaelt sich wie am Tag davor.
   * Die Entscheidung dazu steht als eine Zeile in nachrichten.ts
   * (`vorlesenAn`), damit sie an EINER Stelle pruefbar ist.
   */
  nachrichtenVorlesen?: boolean
}

/** Der Stand, wie er in `profile.json` liegt. */
/** Die vier Eingabearten eines Profil-Passworts. */
/**
 * Die Arten, in denen ein Schloss eingegeben werden kann.
 *
 * `bilder` (16.08.2026): zehn Tiere und Dinge statt Zeichen — fuer Kinder,
 * die noch nicht lesen. Der Wert ist wie bei `farben` eine Folge von INDIZES
 * in die Bilderliste, nicht der Dateiname: so laesst sich ein Bild spaeter
 * austauschen, ohne dass alle Schloesser ungueltig werden.
 */
export const PASSWORT_ARTEN = ['zeichen', 'zahlen', 'farben', 'muster', 'bilder'] as const
export type PasswortArt = (typeof PASSWORT_ARTEN)[number]

export interface ProfilPasswort {
  art: PasswortArt
  /** bcrypt-Abdruck der kanonischen Eingabe — nie das Passwort selbst. */
  hash: string
}

export interface ProfilStand {
  profile: Profil[]
  /** Wer gerade an der Box ist. IMMER eine Kennung aus `profile`. */
  aktiv: string
  /**
   * Ist der Gast an der Box sichtbar? (E39, 16.08.2026)
   *
   * Betreiber: „vielleicht kann man ja einfach ein gast account aktivierbar
   * machen und deativierbar". ABSCHALTEN HEISST UNSICHTBAR, NICHT WEG: der
   * Gast bleibt im Stand (er ist der Rueckfall — Besitzer von Dateien und
   * der Zustand nach dem Abmelden). Nur seine Kachel verschwindet, und der
   * Wechsel auf ihn wird abgewiesen. `undefined` heisst AN — jede Box, die
   * den Schalter noch nie gesehen hat, verhaelt sich wie bisher.
   */
  gastAktiv?: boolean
  /**
   * Bis wann der Gast an ist (ms seit 1970) — oder unbegrenzt, wenn leer.
   *
   * Betreiber: „kann für einen zeitraum aktiviert werden danach schaltet er
   * sich wieder ab, kann aber auch dauerhaft". Die Frist wird TRAEGE
   * geprueft (beim naechsten Blick auf die Profile), nicht mit einem Timer:
   * ein Timer stirbt mit dem Prozess, die Frist in der Datei nicht.
   */
  gastBis?: number
}

/** Die Kennung, unter der alles laeuft, solange niemand gewaehlt hat. */
export const GAST = 'gast'

/** Wie das Gastprofil heisst, wenn die Verwaltung es anzeigt. */
export const GAST_NAME = 'Gast'

/**
 * KEINE Figur — die leere Zeichenkette, und zwar mit Absicht.
 *
 * BIS ZUM 05.08.2026 STAND HIER `'mixpi-hoert.png'` — ein DATEINAME. Er ist
 * hier falsch aufgehoben, und zwar unabhaengig davon, welches Bild gemeint
 * ist: Jeder Wert dieses Feldes wird zu `<figurordner>/<wert>`, und das
 * Standardbild liegt gar nicht im Figurenordner. Der Name zeigte deshalb ins
 * Leere, kam aber durch jede Pruefung (klein geschrieben, endet auf `.png`,
 * kein Pfadanteil) — die Falle steht im Wissenspaket unter
 * `vorgabewert-ueberlebt-den-umzug-seines-ordners`.
 *
 * DIE ZUSTAENDIGKEIT IST GETEILT, UND DAS IST ABSICHT. Der Server weiss, was
 * in `bilder/figuren/` LIEGT — er liest den Ordner. Er weiss NICHT, welche
 * Bilder die Oberflaeche mitbringt; die sind mit ihr ausgeliefert worden und
 * tauchen hier nie auf. Also sagt er bei einem Kind ohne eigene Wahl LEER und
 * ueberlaesst der Oberflaeche, was sie daraus macht.
 *
 * „LEER" HEISST DESHALB NICHT „KEIN BILD ZEIGEN". Was die Oberflaeche daraus
 * macht, steht in NewDesign/app.js (`ichBildPfad`): Seit dem 05.08.2026 zeigt
 * das Zeichen oben links bei leerer Wahl DAS MixPi (`bilder/mixpi-hoert.png`,
 * ausserhalb des Figurenordners). Der Betreiber hat diese Ecke ausdruecklich
 * als „platz des bildes" bezeichnet.
 *
 * HIER STAND, DAS WAPPEN UNTEN LINKS ZEIGE DIESES BILD BEREITS, und ein
 * zweites oben mache „aus einem Begleiter ein Rudel". Das Wappen traegt seit
 * dem 05.08.2026 kein Bild mehr — es steht nur noch oben links. Die Regel aus
 * dem Wissenspaket (`mixpi-maskottchen-familie`: „Hoechstens eines je
 * Bildschirm") ist damit besser erfuellt als vorher, nicht schlechter.
 *
 * WAS DIE OBERFLAECHE ZEICHNET, WENN AUCH DAS BILD NICHT LAEDT: eine
 * gezeichnete Silhouette (SVG, keine Datei). Sie ist seitdem der NOTFALL und
 * nicht mehr der Normalfall — sie kann nicht fehlen, nicht zerbrechen und
 * nicht als kaputtes Bildzeichen dastehen.
 *
 * ES IST KEIN FEHLERZUSTAND. Der Gast ist „alle, die an dieser Box stehen";
 * dass niemand SEIN Bild ausgesucht hat, ist die Wahrheit ueber ihn, nicht
 * ein Mangel. Sobald ein Kind eines waehlt, steht es hier.
 */
export const OHNE_FIGUR = ''

/**
 * Wie viele Profile hoechstens.
 *
 * NICHT GEGRIFFEN: Auf 800x480 passt eine Reihe von Figurkacheln mit den
 * geforderten 64 px Beruehrziel (ISO 9241-411) etwa fuenfmal nebeneinander;
 * darueber braucht das schwebende Fenster ein Blaettern, und dann greift die
 * Falle `platz-beim-blaettern-schaukelt-sich-auf`. Zwoelf ist also schon
 * reichlich — die Zahl steht hier nicht als Wunsch, sondern als Deckel gegen
 * eine kaputte oder boesartige Eingabe, die sonst hunderte Dateien anlegte.
 */
export const PROFILE_MAX = 12

/** Nur Kleinbuchstaben, Ziffern und Bindestrich — siehe `Profil.kennung`. */
const KENNUNG_MUSTER = /^[a-z0-9-]{1,24}$/

/**
 * WO DIE FIGUREN LIEGEN — ein Ordner, und nur dieser eine.
 *
 * Der Pfad ist relativ zur neuen Oberflaeche (`/neu/`), im Baum also
 * `NewDesign/bilder/figuren/`. Von dort kopiert ihn die Bau-Regel in
 * `src/frontend-box/angular.json` mit nach `www/neu` — ohne Netz erreichbar.
 *
 * WARUM NICHT `bilder/` SELBST, wo die zehn Maskottchen schon liegen: Die
 * sind ZUSTAENDE (hoert, schlaeft, fehler, kein-bild …), erzeugt von
 * `tools/maskottchen-bauen.py` aus `bilder/quellen/`. Eine Figur ist etwas
 * anderes — sie gehoert einem KIND. Laegen beide im selben Ordner, muesste
 * irgendwo eine Liste stehen, welcher Name welcher Sorte ist; und diese Liste
 * waere genau die Stelle, an die ein Kuenftiger nicht denkt, wenn er ein Bild
 * dazulegt. Ein eigener Ordner braucht keine Liste: was darin liegt, ist
 * waehlbar. Was daneben liegt, ist es nicht.
 *
 * ES GIBT DESHALB AUCH KEINE AUFZAEHLUNG IM CODE. `GET /api/figuren` sieht
 * nach, was da ist. Legt der Betreiber `mixpi-brille.png` hinein, taucht es
 * beim naechsten Aufruf auf — ohne Bau, ohne Neustart, ohne Zeile Code.
 */
export const FIGUR_ORDNER = 'bilder/figuren'

/**
 * Ein Figurname — er wird zu einem Pfad (`/neu/bilder/figuren/<figur>`).
 *
 * DREI DINGE STEHEN HIER, UND JEDES HAT SEINEN GRUND:
 *
 *  1. KEIN PFADANTEIL. Kein `/`, kein `\`, kein `%` (also auch kein `%2e%2e`),
 *     kein fuehrender Punkt. Ein Punkt IM Namen ist noetig — die Dateien
 *     heissen `mixpi-hoert.png` —, zwei aufeinander sind es nie: `..` waere
 *     der Ausbruch aus dem Bilderverzeichnis.
 *  2. ES MUSS AUF `.png` ENDEN. Bis zum 05.08.2026 stand hier nur ein
 *     Zeichenvorrat, und `mixpi-brille` ohne Endung ging glatt durch — ein
 *     Name, der im Browser ein leeres Bildzeichen ergibt und dem niemand
 *     ansieht, was ihm fehlt. Die Maskottchen sind alle PNG mit
 *     durchsichtigem Grund (`maskottchen.json`); eine zweite Sorte gibt es
 *     nicht. SVG waere ausserdem ausfuehrbarer Inhalt aus demselben Ursprung
 *     — das will man an dieser Stelle nicht anfangen.
 *  3. KLEIN GESCHRIEBEN, wie alles andere in diesem Projekt. `Brille.PNG`
 *     faellt damit durch — und weil ein stilles Durchfallen die schlechteste
 *     aller Antworten ist, nennt `GET /api/figuren` die uebergangenen Namen
 *     ausdruecklich, statt sie zu verschweigen.
 *
 * WAS HIER NICHT GEPRUEFT WERDEN KANN: ob es die Datei GIBT. Diese Datei ist
 * rein (kein fs). Das prueft der Server beim Setzen — siehe
 * `POST /api/profil/figur` in server.ts.
 */
const FIGUR_MUSTER = /^[a-z0-9][a-z0-9._-]{0,59}\.png$/

/**
 * Die Grenzen der Zahl je Kind — WOERTLICH die des Box-Feldes.
 *
 * Sie stehen hier und nicht in konfiguration.ts, weil diese Datei rein ist und
 * konfiguration.ts nichts von Profilen weiss. Wer eine der beiden verschiebt,
 * ohne die andere anzufassen, baut eine Zahl, die die Verwaltung annimmt und
 * das Kind nicht — deshalb steht es an BEIDEN Stellen ausdruecklich dabei.
 *
 * WARUM NICHT 20, WO `/api/weiterhoeren` DOCH `Math.min(20, …)` HAT: das dort
 * ist der Deckel auf den ABFRAGEPARAMETER `?max=` — ein Riegel gegen
 * `?max=100000`, nicht die Merktiefe. Ueber 20 gemerkte Stellen sind nicht
 * sinnlos: die KLASSISCHE Oberflaeche zeigt alle Eintraege aus `resume.json`,
 * nur die neue Reihe schneidet ab. Die Zahl hier gleichzuziehen hiesse, dem
 * klassischen Player etwas wegzunehmen, um eine Reihe ehrlicher zu machen,
 * die ohnehin nur so viele Kacheln zeigt, wie auf den Schirm passen.
 */
export const MERKEN_MIN = 0
export const MERKEN_MAX = 99

/**
 * Ist das eine Zahl, die ein Mensch so gemeint haben KANN?
 *
 * STRENG — fuer die Eingabe. Text, Bruch und negative Zahl fallen durch und
 * bekommen eine Absage zu hoeren. Ein Bruch wird ausdruecklich NICHT gerundet:
 * „5,5 gemerkte Stellen" ist ein Vertipper, und Runden hiesse, sich fuer eine
 * von zwei moeglichen Absichten zu entscheiden, ohne zu fragen.
 *
 * `null` FAELLT AUCH DURCH. Es ist keine Zahl, sondern die Ansage „keine
 * eigene" — der Weg dorthin steht am Endpunkt, nicht hier.
 */
export function merkenPruefen(u: unknown): boolean {
  return typeof u === 'number' && Number.isInteger(u) && u >= MERKEN_MIN && u <= MERKEN_MAX
}

/**
 * Was in der DATEI steht, in eine Zahl oder in „keine" verwandeln.
 *
 * NACHSICHTIG — fuer das Lesen. Dieselbe Haltung wie ueberall in dieser Datei:
 * eine halbe oder mutwillig kaputte `profile.json` darf nicht dazu fuehren,
 * dass ein Kind nichts mehr merkt. Was unlesbar ist, gilt als „keine eigene
 * Zahl", und dann greift die Box-Zahl — also genau das Verhalten von vorher.
 *
 * DASS ES ZWEI FUNKTIONEN SIND, IST DER GANZE UNTERSCHIED ZWISCHEN „SAGEN" UND
 * „SCHLUCKEN". Die REGEL ist in beiden dieselbe (ganze Zahl, 0..99); nur die
 * Antwort darauf ist verschieden, und sie muss es sein: am Endpunkt ist
 * Schweigen falsch (wer 5,5 tippt und „gespeichert" liest, glaubt an eine Zahl,
 * die nirgends steht), beim Lesen einer Datei ist Abbrechen falsch.
 */
export function merkenNormalisieren(roh: unknown): number | undefined {
  return merkenPruefen(roh) ? (roh as number) : undefined
}

/**
 * Welche Zahl gilt fuer dieses Kind?
 *
 * DIE EINE STELLE, an der „eigene Zahl schlaegt Box-Zahl" steht. Sie ist rein
 * und getestet, damit sie nicht in server.ts, im Skript und in der Oberflaeche
 * dreimal steht und beim naechsten Mal auseinanderlaeuft — dieselbe Sorte
 * Fehler wie `dienstliste-an-fuenf-orten`.
 *
 * OHNE PROFIL GILT DIE BOX-ZAHL: eine Kennung, die es nicht (mehr) gibt, ist
 * kein Grund, gar nichts mehr zu merken.
 */
export function merkenFuer(profil: Profil | undefined | null, boxZahl: number): number {
  const eigen = profil?.merken
  const zahl = merkenPruefen(eigen) ? (eigen as number) : boxZahl
  return Number.isFinite(zahl) && zahl >= 0 ? Math.round(zahl) : 9
}

/**
 * Wie viele gemerkte Stellen ein Herabsetzen kosten WIRD.
 *
 * ES GIBT KEINEN WEG ZURUECK. Von 20 auf 5 heisst fuenfzehn Stellen, und fuer
 * ein Kind heisst das „meine Sachen sind verschwunden" — es gibt fuer diesen
 * Weg keine Sicherung, anders als beim Leeren (`resume.json.vorher`). Deshalb
 * wird die Zahl AUSGERECHNET und vom Endpunkt genannt, BEVOR er sie annimmt.
 *
 * ES IST EINE VORHERSAGE, KEINE TAT. Das Setzen der Zahl loescht NICHTS —
 * gekappt wird beim naechsten Merken (`stelleEinsetzen`) und beim naechsten
 * Lauf von `remove_max_resume.sh`. Solange das nicht passiert ist, laesst sich
 * eine versehentlich zu kleine Zahl folgenlos zurueckdrehen. Das ist der ganze
 * Grund, warum hier nicht gleich gekuerzt wird: EINE Stelle im System loescht
 * gemerkte Stellen, und es ist nicht die, an der man eine Zahl einstellt.
 */
export function merkenVerlust(vorhanden: number, kuenftig: number): number {
  const da = Number.isFinite(vorhanden) && vorhanden > 0 ? Math.floor(vorhanden) : 0
  const k = Number.isFinite(kuenftig) && kuenftig > 0 ? Math.floor(kuenftig) : 0
  return da > k ? da - k : 0
}

/** Ist das eine brauchbare Kennung? */
export function kennungPruefen(s: unknown): boolean {
  return typeof s === 'string' && KENNUNG_MUSTER.test(s)
}

/** Ist das ein brauchbarer Figurname? */
export function figurPruefen(s: unknown): boolean {
  return typeof s === 'string' && FIGUR_MUSTER.test(s) && !s.includes('..')
}

/** Das Gastprofil. `angelegt` kommt herein, damit die Datei rein bleibt. */
export function gastProfil(angelegt = 0): Profil {
  return { kennung: GAST, name: GAST_NAME, figur: OHNE_FIGUR, angelegt }
}

/**
 * Ein Roh-Passwortfeld zu einem `ProfilPasswort` — oder `undefined`.
 *
 * NACHSICHTIG WIE DER REST DER DATEI: ein kaputtes Feld wird zu „kein
 * Passwort", nicht zu einem Fehler. Das ist hier auch die SICHERE Richtung —
 * ein Kind, dessen Passwortfeld unlesbar wurde, kommt wieder an sein Profil,
 * statt fuer immer davor zu stehen. Wer die Datei von Hand kaputt schreibt,
 * hat das Schloss entfernt, nicht die Tuer verriegelt.
 */
export function passwortNormalisieren(roh: unknown): ProfilPasswort | undefined {
  if (!roh || typeof roh !== 'object') return undefined
  const r = roh as Record<string, unknown>
  const art = PASSWORT_ARTEN.find((a) => a === r.art)
  const hash = typeof r.hash === 'string' ? r.hash : ''
  // bcrypt-Abdruecke sind ~60 Zeichen und beginnen mit $2 — die Grenze 200
  // ist nur ein Deckel gegen Muell, keine Formatpruefung: `compare` mit
  // einem unbrauchbaren Abdruck sagt schlicht „falsch".
  if (!art || !hash || hash.length > 200) return undefined
  return { art, hash }
}

/**
 * EIN Roheintrag zu einem Profil — oder `null`, wenn nichts Brauchbares
 * darin steht.
 *
 * Ein Eintrag OHNE gueltige Kennung wird verworfen und nicht etwa auf eine
 * erfundene gebogen: an der Kennung haengen Dateien. Eine geratene Kennung
 * hiesse, den Verlauf eines Kindes unter einem Namen abzulegen, den niemand
 * wiederfindet.
 */
export function profilNormalisieren(roh: unknown): Profil | null {
  if (!roh || typeof roh !== 'object') return null
  const r = roh as Record<string, unknown>
  if (!kennungPruefen(r.kennung)) return null
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 40) : ''
  const angelegt = Number(r.angelegt)
  // KEINE EIGENE ZAHL WIRD NICHT ZU EINER NULL. Das Feld fehlt dann ganz — und
  // nur so ist „nichts eingestellt" von „ausdruecklich 0" (gar nichts merken)
  // unterscheidbar. Schriebe man hier 0 hin, waere jedes Kind der Box ab dem
  // naechsten Speichern stumm.
  const merken = merkenNormalisieren(r.merken)
  const geburtstag = geburtstagNormalisieren(r.geburtstag)
  const passwort = passwortNormalisieren(r.passwort)
  return {
    kennung: r.kennung as string,
    // Ohne Namen steht die Kennung da — besser als eine leere Kachel.
    name: name || (r.kennung as string),
    // EIN UNBRAUCHBARER NAME WIRD ZU „KEIN BILD", nicht zu einem Fehler und
    // nicht zu einem geratenen Bild. Die Oberflaeche zeichnet dann die
    // Silhouette — das Kind sieht ein Zeichen, keine Luecke.
    figur: figurPruefen(r.figur) ? (r.figur as string) : OHNE_FIGUR,
    angelegt: Number.isFinite(angelegt) && angelegt > 0 ? Math.floor(angelegt) : 0,
    ...(merken === undefined ? {} : { merken }),
    // WIE BEI `merken`: kein Wert wird NICHT zu `false`. Nur so ist „nie
    // etwas eingestellt" von „ausdruecklich aus" zu unterscheiden — sonst
    // waere nach dem naechsten Speichern bei jedem Kind der Box das
    // Vorlesen aus, ohne dass jemand es abgeschaltet haette.
    ...(typeof r.nachrichtenVorlesen === 'boolean' ? { nachrichtenVorlesen: r.nachrichtenVorlesen } : {}),
    ...(geburtstag === undefined ? {} : { geburtstag }),
    ...(passwort === undefined ? {} : { passwort }),
  }
}

/**
 * NENNT DIESE EINGABE UEBERHAUPT EINE LISTE?
 *
 * ══ WARUM DAS EINE EIGENE FRAGE IST ═══════════════════════════════════════
 *
 * `profileNormalisieren` ist mit Absicht nachsichtig: was es nicht lesen kann,
 * wird zu einer leeren Liste, und heraus kommt „nur der Gast". Fuer eine
 * kaputte DATEI ist das genau richtig — die Box startet, statt stehenzubleiben.
 *
 * FUER EINE EINGABE AUS DEM NETZ IST ES DAS GEGENTEIL VON RICHTIG. Dort heisst
 * dieselbe Nachsicht: wer nichts ueber die Liste sagt, hat gesagt „loesch sie".
 * GEMESSEN am 07.08.2026 (tools/durchkommen-merken.py, Teil G): ein
 * `PUT /api/profile` mit dem Rumpf `{}` — und ebenso `{profile: null}`,
 * `{profile: 'hallo'}`, `{profile: {}}` — kam mit 200 durch und liess von vier
 * Kindern eines uebrig. Die Bereiche wurden beiseitegelegt, jeder Name, jede
 * Figur und JEDE eingestellte Merktiefe war weg, und die Antwort war die eines
 * gelungenen Speicherns.
 *
 * ══ DER UNTERSCHIED, DEN DIESE FUNKTION MACHT ═════════════════════════════
 *
 * Es ist derselbe Unterschied, auf dem `figurenBewahren` und `merkenBewahren`
 * schon beruhen — „nichts gesagt" gegen „so soll es sein" —, nur eine Ebene
 * hoeher: dort geht es um ein FELD, hier um die LISTE selbst. Dass er beim
 * Feld sorgfaeltig gezogen war und bei der Liste nicht, ist die ganze Luecke.
 *
 *   `[]` und `{profile: []}`  sind eine AUSSAGE („keine Kinder") und gehen
 *                             weiter durch — sonst waere das Leeren der Liste
 *                             ueber diesen Weg gar nicht mehr moeglich.
 *   alles andere              ist KEINE Aussage ueber die Liste.
 *
 * SIE ENTSCHEIDET NICHT, WAS DANN PASSIERT — das steht am Endpunkt (400). Hier
 * steht nur die Frage, und zwar rein und geprueft, damit die Antwort darauf
 * nicht an zwei Stellen verschieden ausfaellt.
 */
export function nenntListe(roh: unknown): boolean {
  if (Array.isArray(roh)) return true
  if (!roh || typeof roh !== 'object') return false
  return Array.isArray((roh as { profile?: unknown }).profile)
}

/**
 * Fremde Eingaben in eine gueltige Profilliste verwandeln.
 *
 * NACHSICHTIG — UND DAS GILT FUER DATEIEN. Wer eine EINGABE aus dem Netz durch
 * diese Funktion schickt, muss vorher `nenntListe` fragen; sonst wird aus
 * „nichts gesagt" ein „alles loeschen". Die Begruendung steht dort.
 *
 * DIESELBE HALTUNG WIE `regelnNormalisieren` IN kinderzeit.ts: alles
 * Unlesbare wird auf die freundliche Seite gebogen. Eine leere, halbe oder
 * mutwillig kaputte `profile.json` darf NIEMALS dazu fuehren, dass gar
 * nichts mehr startet — deshalb steht am Ende immer mindestens der Gast da.
 *
 * DER GAST STEHT IMMER VORN und laesst sich nicht loeschen. Ohne ihn gaebe es
 * einen Zustand „kein Besitzer", und genau den soll es nicht geben.
 */
export function profileNormalisieren(roh: unknown): Profil[] {
  // BEIDE FORMEN: die blanke Liste und der ganze Stand `{profile, aktiv}`.
  // Die Verwaltung schickt mal das eine, mal das andere — und eine Datei, die
  // beim naechsten Schreiben in der anderen Form landet, waere ein stiller
  // Verlust aller Profile.
  const roheListe = Array.isArray(roh) ? roh : (roh as { profile?: unknown })?.profile
  const liste = Array.isArray(roheListe) ? roheListe : []
  const aus: Profil[] = [gastProfil()]
  const kennungen = new Set<string>([GAST])
  for (const e of liste) {
    if (aus.length >= PROFILE_MAX) break
    const p = profilNormalisieren(e)
    if (!p) continue
    if (p.kennung === GAST) {
      // Ein mitgeliefertes Gastprofil darf seine FIGUR setzen — Kennung,
      // Dasein, SCHLOSS und seit E39 auch der NAME stehen nicht zur Wahl.
      //
      // KEIN SCHLOSS: der Gast ist der Rueckfall fuer alle (Abmelden landet
      // hier, ein geloeschtes Kind landet hier). Ein Gast mit Passwort waere
      // eine Box, an der niemand mehr hoeren kann.
      //
      // KEIN EIGENER NAME (Betreiber: „gast kann nicht umbennant werden"):
      // genau ein umbenannter Gast hat den ganzen E39-Bedarf ausgeloest —
      // er hiess „Papa", sah aus wie ein normales Konto und verhielt sich
      // nicht so (kein Schloss moeglich, und niemand wusste warum). Wer ein
      // eigenes Konto will, legt eines an; der Gast bleibt als Gast lesbar.
      const { passwort: _nieAmGast, ...gastOhneSchloss } = p
      aus[0] = { ...gastOhneSchloss, name: GAST_NAME }
      continue
    }
    if (kennungen.has(p.kennung)) continue
    kennungen.add(p.kennung)
    aus.push(p)
  }
  return aus
}

/**
 * DIE FIGUR EINES BESTEHENDEN KINDES STEHENLASSEN, wenn die Eingabe sie gar
 * nicht erwaehnt.
 *
 * ══ WOGEGEN DAS SCHUETZT — ein GEMESSENER Weg, keine Befuerchtung ══════════
 *
 * `PUT /api/profile` ersetzt die GANZE Liste. Eine Verwaltung, die anlegen,
 * umbenennen oder loeschen will, hat ihre Liste aber aus `GET /api/profile` —
 * und DER filtert: „Eine Figur, die es nicht gibt, wird nicht genannt"
 * (server.ts). `figurenLesen()` faengt einen unlesbaren Ordner ab und gibt
 * dann eine LEERE Liste zurueck. In genau diesem Augenblick — waehrend einer
 * Auslieferung, waehrend `www/neu/bilder/figuren` gerade nicht da ist — steht
 * bei JEDEM Kind `figur: ''` in der Antwort. Schriebe die Verwaltung diese
 * Antwort zurueck, waere die Wahl jedes Kindes weg, und zwar dauerhaft.
 *
 * Der Server selbst hat sich diese Falle bei `GET /api/profile` ausdruecklich
 * verboten („NUR IN DER ANTWORT, NIE AUF PLATTE"). Ueber den Umweg durch eine
 * Oberflaeche kam sie zurueck.
 *
 * ══ DIE REGEL ═════════════════════════════════════════════════════════════
 * Ein Eintrag OHNE eigenes Feld `figur` erbt die abgelegte Figur seiner
 * Kennung. Ein Eintrag MIT dem Feld setzt sie — auch auf leer. Damit ist
 * „nichts dazu gesagt" von „weg damit" unterscheidbar, und das ist der ganze
 * Unterschied zwischen einer Verwaltung, die Namen aendert, und einer, die
 * nebenbei Bilder loescht.
 *
 * NICHT `r.figur !== undefined`, SONDERN `Object.hasOwn`: `{figur: undefined}`
 * ist eine Aussage („keine"), und JSON kennt es ohnehin nicht — wer die Datei
 * einmal aus einem anderen Programm fuellt, soll dieselbe Regel vorfinden.
 *
 * REIN: nimmt Rohes herein, gibt Rohes heraus. Was daraus ein `Profil` macht,
 * bleibt `profileNormalisieren`.
 */
export function figurenBewahren(roh: unknown, alt: readonly Profil[]): unknown[] {
  const roheListe = Array.isArray(roh) ? roh : (roh as { profile?: unknown })?.profile
  const liste = Array.isArray(roheListe) ? roheListe : []
  const bekannt = new Map<string, string>(alt.map((p) => [p.kennung, p.figur]))
  return liste.map((e) => {
    if (!e || typeof e !== 'object') return e
    const r = e as Record<string, unknown>
    if (Object.hasOwn(r, 'figur')) return e
    const f = typeof r.kennung === 'string' ? bekannt.get(r.kennung) : undefined
    return f === undefined ? e : { ...r, figur: f }
  })
}

/**
 * DIE ZAHL EINES BESTEHENDEN KINDES STEHENLASSEN, wenn die Eingabe sie gar
 * nicht erwaehnt — die Schwester von `figurenBewahren`, Regel fuer Regel.
 *
 * WOGEGEN: `PUT /api/profile` ersetzt die GANZE Liste. Eine Verwaltung, die
 * nur umbenennt, schickt die Eintraege, die sie kennt — und sie kennt dieses
 * Feld womoeglich nicht (die Seite „Kinder" ist aelter als es). Ohne diese
 * Zeile loeschte jedes Umbenennen und jeder Bildwechsel die Zahl JEDES Kindes,
 * und zwar still: die Box merkte danach wieder box-weit, und niemand koennte
 * sagen, wann das passiert ist.
 *
 * ZWEI FUNKTIONEN STATT EINER `felderBewahren`: Die beiden Felder haben
 * verschiedene Gruende (die Figur kann durch einen unlesbaren Ordner leer
 * WERDEN, die Zahl nicht), und sie sind einzeln geprueft. Eine gemeinsame
 * Fassung waere kuerzer und muesste beim naechsten Feld wieder aufgetrennt
 * werden, sobald eines davon eine Ausnahme braucht.
 *
 * `Object.hasOwn` UND NICHT `!== undefined` — aus demselben Grund wie oben:
 * `{merken: undefined}` ist eine Aussage („keine eigene Zahl"), und wer die
 * Datei einmal aus einem anderen Programm fuellt, soll dieselbe Regel
 * vorfinden.
 */
export function merkenBewahren(roh: unknown, alt: readonly Profil[]): unknown[] {
  const roheListe = Array.isArray(roh) ? roh : (roh as { profile?: unknown })?.profile
  const liste = Array.isArray(roheListe) ? roheListe : []
  const bekannt = new Map<string, number | undefined>(alt.map((p) => [p.kennung, p.merken]))
  return liste.map((e) => {
    if (!e || typeof e !== 'object') return e
    const r = e as Record<string, unknown>
    if (Object.hasOwn(r, 'merken')) return e
    const m = typeof r.kennung === 'string' ? bekannt.get(r.kennung) : undefined
    return m === undefined ? e : { ...r, merken: m }
  })
}

/**
 * DAS SCHLOSS EINES BESTEHENDEN KINDES STEHENLASSEN, wenn die Eingabe es gar
 * nicht erwaehnt — der dritte Geschwister von `figurenBewahren` und
 * `merkenBewahren` (und wie dort: DREI Funktionen statt einer
 * `felderBewahren`, die Begruendung steht bei `merkenBewahren`).
 *
 * WOGEGEN: `PUT /api/profile` ersetzt die GANZE Liste, und die Seite
 * „Benutzer" schickt nur, was sie kennt (kennung, name, angelegt). Ohne
 * diese Zeile loeschte jedes Umbenennen das Passwort JEDES Kindes — still.
 *
 * UND ZUGLEICH IST `passwort: null` DER ELTERN-AUSWEG: ein Eintrag, der das
 * Feld AUSDRUECKLICH nennt (auch als null), setzt es — `Object.hasOwn`,
 * dieselbe Regel wie bei den Geschwistern. Ein Kind, das sein Passwort
 * vergisst, brauchte sonst die Eltern nicht, sondern einen Techniker.
 */
export function passwortBewahren(roh: unknown, alt: readonly Profil[]): unknown[] {
  const roheListe = Array.isArray(roh) ? roh : (roh as { profile?: unknown })?.profile
  const liste = Array.isArray(roheListe) ? roheListe : []
  const bekannt = new Map<string, ProfilPasswort | undefined>(alt.map((p) => [p.kennung, p.passwort]))
  return liste.map((e) => {
    if (!e || typeof e !== 'object') return e
    const r = e as Record<string, unknown>
    if (Object.hasOwn(r, 'passwort')) return e
    const s = typeof r.kennung === 'string' ? bekannt.get(r.kennung) : undefined
    return s === undefined ? e : { ...r, passwort: s }
  })
}

/**
 * EIN PROFIL FUER DIE ANTWORT NACH DRAUSSEN — ohne Abdruck.
 *
 * Der bcrypt-Abdruck ist kein Geheimnis erster Klasse, aber er ist ein
 * ANGRIFFSZIEL (offline durchprobieren) und hat in keiner Antwort etwas
 * verloren. Nach draussen gehen nur `geschuetzt` (gibt es ein Schloss?) und
 * `passwortArt` (welche Eingabe soll die Oberflaeche zeigen?). JEDE Stelle,
 * die `profilStand` beantwortet, geht hier durch — wer eine neue Antwort
 * baut und diese Funktion umgeht, hat das Leck wieder aufgemacht (die
 * Gegenprobe dazu steht in profile.spec.ts).
 */
export function profilFuerAntwort(p: Profil): Record<string, unknown> {
  const { passwort, ...rest } = p
  return {
    ...rest,
    geschuetzt: passwort !== undefined,
    ...(passwort === undefined ? {} : { passwortArt: passwort.art }),
  }
}

/** Der ganze Stand fuer die Antwort nach draussen — siehe `profilFuerAntwort`. */
export function standFuerAntwort(stand: ProfilStand): Record<string, unknown> {
  return {
    profile: stand.profile.map(profilFuerAntwort),
    aktiv: stand.aktiv,
    // AUSDRUECKLICH true statt weggelassen: die Oberflaechen sollen ein
    // einfaches `=== false` pruefen koennen, ohne die Vorgabe zu kennen.
    gastAktiv: stand.gastAktiv !== false,
    ...(stand.gastBis ? { gastBis: stand.gastBis } : {}),
  }
}

/**
 * WELCHE KENNUNGEN VERSCHWINDEN, wenn dieser Stand den alten abloest.
 *
 * Sie steht hier und nicht im Server, weil an ihr eine Tat auf der PLATTE
 * haengt (der Bereich des Kindes wird beiseitegelegt) — und eine Tat, die aus
 * einem Vergleich folgt, sollte den Vergleich nicht selbst anstellen.
 *
 * DER GAST KANN HIER NIE AUFTAUCHEN: `profileNormalisieren` stellt ihn immer
 * voran. Die Zeile ist trotzdem da, weil dieser Rueckgabewert einen Ordner
 * umbenennt und der Gast der einzige ist, dessen Ordner es IMMER geben muss.
 */
export function verschwundeneKennungen(alt: readonly Profil[], neu: readonly Profil[]): string[] {
  const bleibt = new Set(neu.map((p) => p.kennung))
  return alt.map((p) => p.kennung).filter((k) => k !== GAST && !bleibt.has(k))
}

/**
 * Welche Kennung ist aktiv?
 *
 * Ein Wunsch, der auf kein vorhandenes Profil zeigt, faellt auf den Gast
 * zurueck. Das ist der Fall „Profil geloescht, waehrend es dran war": Musik
 * geht weiter, sie wird nur wieder dem Gast zugeschrieben.
 */
export function aktivNormalisieren(roh: unknown, profile: readonly Profil[]): string {
  const k = typeof roh === 'string' ? roh : ''
  return profile.some((p) => p.kennung === k) ? k : GAST
}

/** Den ganzen Stand aus einer (womoeglich kaputten) Datei holen. */
export function standNormalisieren(roh: unknown): ProfilStand {
  const profile = profileNormalisieren(roh)
  const aktiv = aktivNormalisieren((roh as { aktiv?: unknown })?.aktiv, profile)
  const stand: ProfilStand = { profile, aktiv }
  const r = roh as { gastAktiv?: unknown; gastBis?: unknown } | null
  // NUR das ausdrueckliche `false` schaltet ab — alles andere (fehlt, Unsinn,
  // "false" als Text) heisst AN. Ein Tippfehler in der Datei darf den
  // Rueckfall der Box nicht verstecken.
  if (r?.gastAktiv === false) stand.gastAktiv = false
  const bis = Number(r?.gastBis)
  // Eine Frist in der Vergangenheit wird gar nicht erst getragen — sie waere
  // beim ersten Blick ohnehin faellig. So bleibt die Datei frei von Leichen.
  if (Number.isFinite(bis) && bis > 0) stand.gastBis = bis
  return stand
}

/**
 * Der Name eines Speicherschluessels im BROWSER.
 *
 *     speicherName('gast', 'neu_zuletzt_v1')  ->  'mupibox_p_gast_neu_zuletzt_v1'
 *
 * EINE FORMEL, ZWEI OBERFLAECHEN. Baute jede Seite ihren Namen selbst, saehe
 * ein Kind auf der einen Seite seine Sachen und auf der anderen die des
 * Geschwisters — ohne Fehlermeldung. Genau diese Fehlerklasse ist im Bestand
 * schon einmal aufgetreten (`darstellung-feld-faellt-still-heraus`).
 */
export function speicherName(kennung: string, schluessel: string): string {
  return `mupibox_p_${kennungPruefen(kennung) ? kennung : GAST}_${schluessel}`
}

/**
 * Der Name einer ABLAGE auf der Platte — DIE ALTE FORM.
 *
 *     ablageName('gespielt.json', 'gast')  ->  'gespielt.gast.json'
 *
 * NUR NOCH FUER DEN UMZUG. Seit E18 Stufe 2 liegt jede Ablage eines Profils in
 * dessen BEREICH (siehe `ablageOrt` unten); diese Formel sagt bloss noch, wie
 * der Bestand heisst, den es abzuholen gilt. Sie bleibt stehen und getestet,
 * weil eine Box, die seit dem 02.08. laeuft, genau so beschriftete Dateien
 * hat — wer sie loescht, findet den Verlauf nicht mehr.
 */
export function ablageName(basis: string, kennung: string): string {
  const k = kennungPruefen(kennung) ? kennung : GAST
  const punkt = basis.lastIndexOf('.')
  if (punkt <= 0) return `${basis}.${k}`
  return `${basis.slice(0, punkt)}.${k}${basis.slice(punkt)}`
}

// ── Der Bereich: ein ORDNER je Profil ────────────────────────────────────────
//
// WARUM EIN ORDNER UND KEIN NAMENSZUSATZ MEHR (Entscheidung des Betreibers vom
// 05.08.2026): Ein Zusatz je DATEI heisst, dass bei jeder neuen
// benutzerbezogenen Ablage jemand daran DENKEN muss. Genau so war
// `listen.json` box-weit geblieben, obwohl es je Kind gehoerte — dieselbe
// Fehlersorte wie `dienstliste-an-fuenf-orten`. Ein Ordner dreht es um: wer
// eine neue Ablage in den Bereich legt, bekommt die Trennung geschenkt; wer sie
// danebenlegt, muss es begruenden.
//
// DIESER ABSATZ IST DIE BEGRUENDUNG DES ORDNERS, NICHT DER STAND: `listen.json`
// liegt seit E18/S3 im Bereich (`ABLAGE_LISTEN`, gleich unten). Und
// `kinderzeit.json` gehoert NICHT in diese Reihe — es ist box-weit MIT Grund
// (siehe „WAS HIER (NOCH) NICHT STEHT, MIT GRUND" unten: es ist der Regelsatz
// `{standard, je}`, je Bereich abgelegt faende `regelnFuer()` die Hausregel
// nicht mehr). Bis 25.08.2026 stand es hier als vergessene Ablage — wer das
// las, hielt einen Umzug fuer offen, den es nie geben soll.
//
// DER BEREICH WIRD BEIM ANLEGEN DES PROFILS ERZEUGT, nicht beim ersten
// Schreiben. Ein Ordner, den es erst gibt, wenn etwas hineinfaellt, ist wieder
// eine Sache, an die jemand denken muss.

/** Unter welchem Namen die Bereiche im Konfigurationsverzeichnis liegen. */
export const BEREICH_ORDNER = 'profile'

/**
 * Die Ablagen, die einem PROFIL gehoeren — die EINE Liste.
 *
 * Sie treibt drei Dinge, die sonst auseinanderliefen: den Umzug beim Start,
 * das Anlegen eines Bereichs und die Pruefung, ob die SICHERUNG sie noch
 * einsammelt (`tools/bereich-sicherung-deckung.py`). Eine Ablage, die hier
 * fehlt, bleibt box-weit; eine, die hier zu Unrecht steht, zoege einen Umzug
 * nach sich, den niemand wollte. Deshalb steht die Liste hier und nicht
 * dreimal.
 *
 * WAS HIER (NOCH) NICHT STEHT, MIT GRUND:
 *   kinderzeit.json  — das ist der REGELSATZ der Box, `{standard, je}`. Er
 *                      gehoert allen zusammen; je Bereich abgelegt koennte
 *                      `regelnFuer()` die Hausregel gar nicht mehr finden.
 *                      „Zeitbudget je Kind" steckt IM Satz, nicht im Ordner.
 *
 * `resume.json` STEHT SEIT E18 STUFE 3 DABEI (05.08.2026). Er war der
 * groesste Brocken — acht Wege im Server, eine box-weite Sperrdatei, vier
 * root-Skripte und ein SYMLINK (`active_resume.json`) darauf. Die Skripte
 * ziehen NICHT mit und werden es auch nie: ein Update von upstream tauscht
 * sie gegen ihre alte Fassung zurueck (`update/start_mupibox_update.sh`
 * `mv ${MUPI_SRC}/scripts/mupibox/*`). Deshalb bleibt am alten Ort eine
 * BRUECKE stehen — ein Verweis auf den Bereich des aktiven Profils, den
 * server.ts legt und wieder herstellt. Wer sie sucht: `resumeBrueckeRichten`.
 */
export const ABLAGE_GESPIELT = 'gespielt.json'
export const ABLAGE_VERBRAUCH = 'kinderzeit-verbrauch.json'
export const ABLAGE_LISTEN = 'listen.json'
export const ABLAGE_RESUME = 'resume.json'
/**
 * Die AUSWAHL — was dieses Kind von der Bibliothek sehen darf (E18, 07.08.2026).
 *
 * DIE ERSTE ABLAGE, DIE KEIN VERLAUF IST. Die vier darueber sind allesamt
 * Spuren: was gehoert wurde, wie lange, wo es stehengeblieben ist. Diese hier
 * ist eine EINSTELLUNG — und genau deshalb steht sie in DIESER Liste und
 * nicht daneben. Wer sie danebenstellte, haette die naechste Erbschaft
 * gebaut: In der Nacht zum 07.08. ist derselbe Fehler dreimal aufgelaufen
 * (Browserspeicher, kinderzeit.json, Arbeitsspeicher), und jedes Mal bekam
 * das naechste Kind mit demselben Namen etwas vom vorigen. Hier drin nehmen
 * `bereicheHerrichten()`, `bereichBeiseite()` und die Sicherungsdeckung sie
 * ohne Zutun mit; daneben muesste an jeder dieser drei Stellen jemand daran
 * denken.
 *
 * WAS DRINSTEHT UND WARUM GENAU DAS, steht in auswahl.ts — dort mit der
 * Messung an den echten Daten der Box. Kurz: Werkschluessel aus
 * `medienSchluessel()`, keine Indexe, keine Titel, keine Interpreten.
 *
 * DER GAST BEKOMMT NIE EINE. Er ist „alle, die an der Box stehen"; ihn
 * einzuschraenken hiesse, die Box fuer Gaeste unbrauchbar zu machen. Das
 * steht nicht hier, sondern beim Lesen und Schreiben in server.ts — diese
 * Datei kennt nur Namen, keine Rechte.
 */
export const ABLAGE_AUSWAHL = 'auswahl.json'
/**
 * WIE ES AUSSIEHT — Farbsatz, Licht, Indikatoren, Kachelform (15.08.2026).
 *
 * Betreiber: „bitte koppel die benutzer einstellungen an das profil also
 * auch theme einstellungen und gestaltung, indikator usw." und dazu, wie es
 * gemeint ist: „man kann es zusammen mit dem kind einstellen es soll aber
 * dem profil zugeordnet sein". Eingestellt wird also weiter im
 * Eltern-Bereich — nur GESPEICHERT wird am Profil, das gerade dran ist.
 *
 * DIE ZWEITE EINSTELLUNG IN DIESER LISTE (nach der Auswahl) und die erste,
 * die ein Kind selbst sieht: Wer sein Bild aussuchen darf, darf auch seine
 * Farbe haben.
 *
 * ═══ SIE ZIEHT ALS EINZIGE NICHT UM ═══════════════════════════════════════
 * Alle anderen Ablagen wandern beim Start vom box-weiten Ort in den Bereich
 * (`bereicheHerrichten`) — die box-weite Datei ist danach WEG. Hier waere das
 * ein Verlust: `darstellung.json` traegt neben `aktuell` auch die THEMEN,
 * und die gehoeren der Box (ein Kind, das ein Thema baut, teilt es). Die
 * box-weite Datei bleibt deshalb stehen und ist zweierlei zugleich: Heimat
 * der Themen UND Rueckfall fuer jedes Profil, das noch nichts Eigenes hat.
 * Die Ausnahme steht benannt in server.ts (`OHNE_UMZUG`); hier steht, warum
 * es sie gibt.
 *
 * WARUM SIE TROTZDEM IN DIESER LISTE STEHT: an ihr haengen drei weitere
 * Dinge, die sonst jemand einzeln nachziehen muesste — der Bereich wird
 * angelegt, er wird beim Loeschen beiseitegelegt, und
 * `tools/bereich-sicherung-deckung.py` besteht darauf, dass die Sicherung
 * sie einsammelt. Genau diese drei Stellen sind es, an denen dieser Baum
 * schon einmal auseinandergelaufen ist.
 */
export const ABLAGE_DARSTELLUNG = 'darstellung.json'
/**
 * WELCHE VIDEOS DIESES KIND ANSCHAUEN DARF, UND WIE OFT (20.09.2026).
 *
 * Betreiber: „ard videos einzelne videos freischalten mit abspiel
 * haeufigkeit es soll quasi eine belohnung sein." Sie gehoert ins Profil,
 * weil eine Belohnung an einem Kind haengt: Geschwister mit Altersabstand
 * teilen sich diese Box, und was das eine sich verdient hat, ist nicht das
 * Guthaben des anderen.
 *
 * SIE MUSS MIT DEM KIND VERSCHWINDEN. Bliebe sie stehen, faende das zweite
 * Kind mit demselben Namen (die Kennung wird aus dem Namen gebaut) fremde
 * Freigaben vor — dieselbe Erbschaft, die bei `bereichBeiseite()` steht.
 * Der Eintrag in dieser Liste ist die einzige Stelle, an der das steht.
 *
 * Die Regel dazu ist rein und geprueft in `videofreigabe.ts`.
 */
export const ABLAGE_VIDEOFREIGABEN = 'videofreigaben.json'
export const BEREICH_ABLAGEN = [
  ABLAGE_GESPIELT,
  ABLAGE_VERBRAUCH,
  ABLAGE_LISTEN,
  ABLAGE_RESUME,
  ABLAGE_AUSWAHL,
  ABLAGE_DARSTELLUNG,
  ABLAGE_VIDEOFREIGABEN,
] as const

/**
 * In welchen Teilen ein Pfad zerfaellt: Verzeichnis und blosser Name.
 *
 * Absichtlich ohne `node:path`: diese Datei ist REIN (kein fs, kein Netz,
 * keine Uhr), und `path` bringt auf Windows eine zweite Trennzeichenregel mit,
 * die hier nur Fragen aufwuerfe. Die Box ist Linux, die Tests sind es auch.
 */
function zerlegen(pfad: string): { ordner: string; name: string } {
  const schnitt = pfad.lastIndexOf('/')
  if (schnitt < 0) return { ordner: '', name: pfad }
  return { ordner: pfad.slice(0, schnitt), name: pfad.slice(schnitt + 1) }
}

/**
 * Der BEREICH eines Profils.
 *
 *     bereichPfad('./server/config', 'gast')  ->  './server/config/profile/gast'
 *
 * Eine unbrauchbare Kennung landet beim Gast — dieselbe Haltung wie bei
 * `speicherName` und `ablageName`. Sie darf NIEMALS zu einem Pfad werden, der
 * aus dem Konfigurationsverzeichnis herausfuehrt; das verhindert schon
 * `KENNUNG_MUSTER`, aber die Sicherung hier kostet nichts und steht an der
 * Stelle, an der ein Kuenftiger sie sucht.
 */
export function bereichPfad(basisOrdner: string, kennung: string): string {
  const k = kennungPruefen(kennung) ? kennung : GAST
  const kern = `${BEREICH_ORDNER}/${k}`
  // OHNE VERZEICHNIS BLEIBT ES RELATIV. `'/profile/gast'` waere ein absoluter
  // Pfad ins Wurzelverzeichnis — aus einem blossen `'gespielt.json'` darf
  // niemals einer werden.
  const ordner = basisOrdner.replace(/\/+$/, '')
  return ordner ? `${ordner}/${kern}` : kern
}

/**
 * Der Ort einer Ablage IM Bereich ihres Profils.
 *
 *     ablageOrt('./server/config/gespielt.json', 'gast')
 *       ->  './server/config/profile/gast/gespielt.json'
 *
 * Der DATEINAME bleibt, was er war. Das ist kein Schoenheitswunsch: wer im
 * Verzeichnis nachsieht oder ein Werkzeug schreibt, sucht nach `gespielt.json`
 * — und findet es, nur eine Etage tiefer. Ein zusaetzlich umbenannter Name
 * haette zwei Dinge auf einmal geaendert.
 */
export function ablageOrt(basis: string, kennung: string): string {
  const { ordner, name } = zerlegen(basis)
  return `${bereichPfad(ordner, kennung)}/${name}`
}

/**
 * Ein Geburtstag, wie er gespeichert werden darf — oder `undefined`. Pure.
 *
 * NUR `JJJJ-MM-TT`, und nur ein Datum, das es gibt: `2026-02-31` wird
 * abgewiesen statt still zum 3. Maerz zu werden (genau das taete `new
 * Date`). Und nichts in der Zukunft und nichts vor 1900 — beides waere ein
 * Vertipper, und ein Vertipper darf kein Alter ergeben, das Inhalte
 * ausblendet.
 */
export function geburtstagNormalisieren(roh: unknown): string | undefined {
  const s = String(roh ?? '').trim()
  if (!s) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return undefined
  const [j, mo, ta] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(j, mo - 1, ta))
  if (d.getUTCFullYear() !== j || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== ta) return undefined
  if (j < 1900) return undefined
  if (d.getTime() > Date.now()) return undefined
  return s
}

/**
 * Wie alt ist dieses Kind HEUTE? Pure (die Uhr kommt herein). `null`, wenn
 * kein Geburtstag da ist.
 *
 * `jetzt` ist ein Argument und keine Abfrage der Systemuhr: nur so laesst
 * sich der Tag VOR und NACH dem Geburtstag pruefen, ohne die Uhr zu stellen.
 */
export function alterAus(geburtstag: unknown, jetzt = Date.now()): number | null {
  const g = geburtstagNormalisieren(geburtstag)
  if (!g) return null
  const [j, mo, ta] = g.split('-').map(Number)
  const heute = new Date(jetzt)
  let alter = heute.getUTCFullYear() - j
  const monat = heute.getUTCMonth() + 1
  const tag = heute.getUTCDate()
  // Der Geburtstag muss VORBEI sein, sonst ist das Kind noch ein Jahr juenger.
  if (monat < mo || (monat === mo && tag < ta)) alter -= 1
  return alter >= 0 ? alter : null
}
