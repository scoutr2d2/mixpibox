/**
 * Die Konfiguration der Box lesen und ändern.
 *
 * ERSETZT mupi.php (1577 Zeilen) und jsoneditor.php. Drei Dinge macht das
 * hier anders, und jedes hat einen Anlass:
 *
 * 1. NUR BEKANNTE FELDER. Der Anrufer schickt einen Feldnamen aus einer festen
 *    Tabelle und einen Wert; ein freier Pfad in die Konfiguration wäre ein Weg,
 *    beliebige Schlüssel zu setzen — auch `interfacelogin.password`.
 *
 * 2. DER TYP BLEIBT. In dieser Konfiguration stehen Zahlen als ZEICHENKETTEN
 *    ("40", "0", "128"), weil die Shell-Skripte sie mit `jq -r` lesen. Wer
 *    daraus eine echte Zahl macht, ändert das Dateiformat unter den Skripten
 *    weg. `alsGespeicherterTyp` schreibt deshalb zurück, was vorher dastand.
 *
 * 3. DIE BOX MUSS DANACH NOCH LAUFEN. Vor dem Schreiben prüft `pruefeKonfig`,
 *    ob die Angaben erhalten sind, ohne die die Box stumm oder unerreichbar
 *    wäre. Eine Konfiguration, die sich selbst aussperrt, wird nicht
 *    geschrieben — nicht einmal auf ausdrücklichen Wunsch.
 *
 * Was hier bewusst FEHLT: die Bildschirm-Drehung. Die steht nicht in dieser
 * Datei, sondern in /boot/config.txt, und ein falscher Wert dort ist ein
 * schwarzer Bildschirm nach dem Neustart (siehe die Wiki-Signatur
 * mupi-config-txt-treiber-auskommentiert). Das gehört in einen eigenen,
 * vorsichtigeren Schritt.
 */

export type Feldart = 'text' | 'zahl' | 'schalter' | 'auswahl' | 'geheim' | 'url'

/**
 * WOHIN ein Feld gehoert — sortiert nach einer LEITFRAGE, nicht nach Gewohnheit
 * (entschieden 2026-08-03, G5).
 *
 *   Konfiguration = was die Box IST      (Netz, Zugaenge, Hardware)
 *   Darstellung   = was man SIEHT        (Farben, Groessen, Themen, Bewegung)
 *   Streaming     = welche Quelle DA IST (Anbieter und ihre Zugaenge)
 *
 * Warum das als DATUM am Feld steht und nicht als Reihenfolge in der Vorlage:
 * die Verwaltung rendert drei verschiedene Seiten aus DERSELBEN Tabelle. Stuende
 * die Zuordnung in den Vorlagen, muesste man sie an drei Stellen pflegen — und
 * ein Feld ohne Zuordnung faellt still aus allen dreien heraus. Genau diese
 * Falle kostet in darstellung.service.ts regelmaessig einen Nachmittag
 * ([[darstellung-feldweise-neu]]). Deshalb ist `bereich` PFLICHT und es gibt
 * einen Test, der jedes Feld gegen BEREICHE haelt.
 */
export type Bereich = 'box' | 'ton' | 'zugang' | 'medien' | 'melden' | 'hardware' | 'darstellung' | 'streaming'

export interface Bereichsangabe {
  id: Bereich
  titel: string
  hinweis: string
  /** Welche Seite der Verwaltung diesen Bereich zeigt. */
  seite: 'konfiguration' | 'darstellung' | 'streaming' | 'ton'
}

/**
 * Die Bereiche in Anzeigereihenfolge.
 *
 * Die Reihenfolge ist die der Nutzungshaeufigkeit, nicht die der Technik: den
 * Namen der Box und die Lautstaerke aendert man oft, GPIO-nahe Hardware fast
 * nie.
 */
export const BEREICHE: Bereichsangabe[] = [
  {
    id: 'box',
    titel: 'Die Box selbst',
    hinweis: 'Wie sie heisst und wann sie von allein Schluss macht.',
    seite: 'konfiguration',
  },
  {
    /*
     * SEIT 15.08.2026 AUF DER TON-SEITE („in konfiguration gibt es noch
     * eine ton sektion die kann man umziehen"). Die Seite /ton verwaltet
     * seither ALLES Hoerbare — Ziele, Pegel, Klang — und diese drei Felder
     * gehoeren dazu. Die Zuordnung steht hier als Datum am Bereich, damit
     * Konfigurationsseite und Suche denselben Umzug sehen; die IDs und
     * Pfade der Felder bleiben unveraendert.
     */
    id: 'ton',
    titel: 'Ton',
    hinweis: 'Lautstaerke und womit abgespielt wird.',
    seite: 'ton',
  },
  {
    id: 'zugang',
    titel: 'Zugang und Sperren',
    hinweis: 'Wer an die Verwaltung kommt und wer an die Einstellungen der Box.',
    seite: 'konfiguration',
  },
  {
    /*
     * HIESZ BIS ZUM 05.08.2026 „Medien und Vorlesen", und der Hinweis endete
     * mit „in welcher Sprache sie liest". Beides war seit dem 04.08. falsch:
     * „Sprache beim Vorlesen" ist an jenem Tag ERSATZLOS entfallen (die
     * Begruendung steht weiter unten bei den Feldern). In diesem Bereich
     * stehen seither genau zwei Felder — „Medien pruefen alle … Sekunden" und
     * „Zuletzt Gehoertes merken" — und keines hat mit Vorlesen zu tun.
     *
     * WARUM DAS MEHR IST ALS EIN SCHREIBFEHLER: die Ueberschrift versprach
     * eine Einstellung, die dort nie stand. Wer sie sucht, liest hier
     * „Vorlesen", sieht zwei Felder ohne Bezug — und sucht dann NICHT mehr
     * unter /vorlesen weiter, wo die Stimme wirklich liegt. Dieselbe Bauart
     * wie die Verweise, die ein Umzug stehenlaesst
     * ([[umzug-laesst-die-verweise-darauf-zurueck]]), nur an einer
     * Ueberschrift statt an einem Link.
     *
     * ES IST AUSSERDEM EIN SUCHEINTRAG: der `titel` eines Bereichs geht mit
     * /api/konfiguration hinaus und wird von suche.ts erhoben — „Medien und
     * Vorlesen" stand also als Treffer in der Suche und fuehrte nach
     * /konfiguration. Der `hinweis` wird NICHT erhoben; was dort steht,
     * findet niemand.
     */
    id: 'medien',
    titel: 'Medien und Weiterhören',
    hinweis: 'Wie oft die Box nachsieht, was neu ist — und wie viel sie sich vom Zuletzt-Gehörten merkt.',
    seite: 'konfiguration',
  },
  {
    id: 'melden',
    titel: 'Meldungen nach aussen',
    hinweis: 'Wohin die Box schreibt, wenn etwas passiert.',
    seite: 'konfiguration',
  },
  {
    id: 'hardware',
    titel: 'Hardware',
    hinweis: 'Luefter und Grafik. Selten noetig — und ein falscher Wert ist hier teuer.',
    seite: 'konfiguration',
  },
  {
    id: 'darstellung',
    titel: 'Aus der Konfiguration der Box',
    hinweis: 'Was man SIEHT, steht hier — auch wenn es in derselben Datei liegt wie der Rest.',
    seite: 'darstellung',
  },
  {
    id: 'streaming',
    titel: 'Zugaenge der Anbieter',
    hinweis: 'Was ein Anbieter braucht, um zu antworten.',
    seite: 'streaming',
  },
]

/*
 * KEIN `bereichsangabe(id)` HIER. Der erste Anlauf hatte eines und niemand
 * rief es: BEREICHE geht als Ganzes mit `/api/konfiguration` hinaus, und die
 * Zuordnung Bereich → Seite macht die Verwaltung mit einer Map darueber.
 * Eine Nachschlagefunktion, die nur ihr eigener Test benutzt, sieht beim
 * naechsten Lesen aus wie ein tragender Teil.
 */

export interface Feld {
  /** Kennung, die der Anrufer schickt. */
  id: string
  /**
   * Pfad in der Konfiguration, als Segmente — nie vom Anrufer.
   * Ein Segment = Schlüssel auf oberster Ebene (spotifyCacheLevel liegt dort,
   * weil das Box-Frontend ihn genau so liest).
   */
  pfad: [string] | [string, string]
  art: Feldart
  /**
   * Auf welcher Seite der Verwaltung das Feld erscheint. PFLICHT — ohne
   * Angabe zeigt es keine Seite, und das faellt niemandem auf.
   */
  bereich: Bereich
  titel: string
  hinweis: string
  /**
   * Was gilt, solange der Schluessel in der Datei fehlt.
   *
   * GEMESSEN (03.08.2026, Pi 5 .169): drei Felder des Boards zeigten dort ins
   * Leere — `mupibox.einstellungssperre`, `spotify.disableScraperForPlaylists`
   * und `jellyfin.apiKey` stehen zwar in der Vorlage, aber die Konfiguration
   * DIESER Box ist aelter als sie. Ohne Vorgabe zeigte die Oberflaeche dann
   * einfach den ersten Auswahleintrag an, ohne dass irgendwo dieser Wert
   * gespeichert waere: die Anzeige war zufaellig richtig statt bestimmt. Mit
   * `standard` steht die Antwort im Code und nicht im Zufall — den Schluessel
   * selbst legt update/conf_update.sh nach.
   */
  standard?: unknown
  /**
   * Darf das Textfeld leer sein?
   *
   * Vorgabe ist NEIN, und das mit Grund: „Name der Box" leer zu speichern
   * nimmt der Box ihren Netzwerknamen und ihren Spotify-Connect-Namen zugleich
   * ([[rahmen.ts]] erklaert die Dreifachbelegung). Bei einer Chat-ID oder einer
   * Client-ID ist leer dagegen eine gueltige Aussage: „nicht eingerichtet".
   * Ohne diesen Schalter gaebe es fuer solche Felder keinen Rueckweg — man
   * koennte sie setzen, aber nie wieder loeschen.
   */
  leerErlaubt?: boolean
  min?: number
  max?: number
  /** Bei 'auswahl': aus welcher Liste in der Konfiguration die Werte stammen. */
  auswahlAus?: [string, string]
  /**
   * Wenn die Liste aus OBJEKTEN besteht: welcher Schlüssel den gespeicherten
   * Wert trägt und welcher den lesbaren Namen. `googlettslanguages` sieht so
   * aus: { "iso639-1": "de", "Language": "German" } — ohne diese Angabe
   * bliebe die Auswahl leer und jeder Wert würde abgelehnt.
   *
   * SEIT 04.08.2026 BENUTZT KEIN FELD DAS MEHR — das einzige war „Sprache beim
   * Vorlesen" (siehe die Begründung weiter unten, wo es stand). Die Fähigkeit
   * bleibt trotzdem: Listen aus Objekten stehen weiterhin in der
   * Konfiguration jeder Box (`googlettslanguages`), und wer das nächste Feld
   * daran hängt, soll nicht wieder herausfinden müssen, warum ein Filter auf
   * Zeichenketten die Auswahl leer lässt. Geprüft wird sie in
   * konfiguration.spec.ts an einem eigens gebauten Feld, nicht mehr an einem
   * echten.
   */
  wertSchluessel?: string
  titelSchluessel?: string
  /** Bei 'auswahl' mit FESTEN Werten (statt einer Liste aus der Konfiguration). */
  festeAuswahl?: Auswahl[]
  /** true = wirkt erst nach einem Neustart der Box. */
  neustart?: boolean
}

/**
 * Die änderbaren Felder.
 *
 * Absichtlich eine Auswahl, keine Vollständigkeit. Nicht dabei sind die
 * Angaben, bei denen ein falscher Wert die Box unbrauchbar macht und die man
 * nicht am Küchentisch ändert: `audioDevice` (falsch = kein Ton), die
 * GPIO-Nummern unter `shim` (falsch = Hardware reagiert nicht), `resX`/`resY`,
 * `cachepath` und `version`.
 */
export const FELDER: Feld[] = [
  {
    id: 'name',
    bereich: 'box',
    pfad: ['mupibox', 'host'],
    art: 'text',
    titel: 'Name der Box',
    hinweis: 'Erscheint im Netzwerk und auf dem Bildschirm.',
  },
  {
    /*
     * WIE maxLautstaerke (eine Zeile tiefer): bedient wird das Feld seit
     * dem 15.08.2026 als LANGER SCHIEBER „Beim Einschalten" auf der
     * Ausgaben-Karte der Ton-Seite, nicht mehr als Zahlenfeld. Schreibweg
     * unveraendert; es bleibt in der Tabelle, weil sie der eine Ort ist,
     * der sagt, was geschrieben werden darf.
     */
    id: 'startLautstaerke',
    bereich: 'ton',
    pfad: ['mupibox', 'startVolume'],
    art: 'zahl',
    min: 0,
    max: 100,
    titel: 'Lautstärke beim Einschalten',
    hinweis: 'Mit welcher Lautstärke die Box startet.',
  },
  {
    /*
     * BEDIENT WIRD DIESES FELD NICHT MEHR ALS ZAHLENFELD: seit dem
     * 15.08.2026 stellt es der ROTE GRIFF der Zeile „Alle zusammen" auf
     * der Ton-Seite („einen roten knopf bei alle zusammen … dann können
     * wir die maximal lautstärke unten rauswerfen"). Der Schreibweg ist
     * derselbe geblieben (POST /api/konfiguration, dieses Feld) — nur die
     * Darstellung ist ein Griff. Es bleibt in der Tabelle, weil die
     * Tabelle der EINE Ort ist, der sagt, was geschrieben werden darf.
     */
    id: 'maxLautstaerke',
    bereich: 'ton',
    pfad: ['mupibox', 'maxVolume'],
    art: 'zahl',
    min: 0,
    max: 100,
    titel: 'Höchste Lautstärke',
    hinweis: 'Weiter lässt sich nicht aufdrehen — der Gehörschutz für Kinderohren.',
  },
  {
    /*
     * BEIDE KLAENGE SIND TEXTFELDER (Pfade), KEINE AUSWAHL: welche Dateien
     * es gibt, weiss nur die Box (Ordner sysmedia/sound) — die Ton-Seite
     * holt die Liste ueber GET /api/ton/klaenge und zeichnet daraus ihre
     * Auswahl samt Probehoeren; gespeichert wird ueber DIESES Feld, damit
     * der eine Schreibweg (POST /api/konfiguration, nur bekannte Felder)
     * gilt. Betreiber 15.08.2026: „möglichkeit den einschalt ton zu setzen".
     */
    id: 'startKlang',
    bereich: 'ton',
    pfad: ['mupibox', 'startSound'],
    art: 'text',
    titel: 'Einschalt-Klang',
    hinweis:
      'Spielt beim Hochfahren. Eigene Klänge (.wav) in den Ordner ' +
      'MuPiBox/sysmedia/sound der Box legen — sie erscheinen dann in der Auswahl.',
  },
  {
    id: 'schlussKlang',
    bereich: 'ton',
    pfad: ['mupibox', 'shutSound'],
    art: 'text',
    titel: 'Ausschalt-Klang',
    hinweis: 'Spielt beim Herunterfahren.',
  },
  {
    id: 'wiedergabeMaschine',
    bereich: 'ton',
    pfad: ['mupibox', 'playerEngine'],
    art: 'auswahl',
    festeAuswahl: [
      { wert: 'mplayer', titel: 'mplayer (bewährt)' },
      { wert: 'mpv', titel: 'mpv (neu, in Erprobung)' },
    ],
    titel: 'Wiedergabe-Maschine',
    // Der Hinweis nennt BEIDE Bedingungen, weil ein Fehlgriff hier eine
    // stumme Box ergibt und man den Grund sonst nicht sieht: mpv muss
    // installiert sein, und die Umstellung greift erst nach einem Neustart
    // des Wiedergabe-Dienstes (die Maschine wird beim Start gewählt).
    hinweis:
      'Spielt lokale Dateien, Radio und Hörspiele ab. mpv ist der Nachfolger und ' +
      'kommt mit Sonderzeichen in Dateinamen zurecht, muss aber installiert sein ' +
      '(apt install mpv). Wirkt erst nach einem Neustart der Box.',
  },
  /*
   * HIER STAND „Welche Oberflaeche auf dem Bildschirm der Box"
   * (`mupibox.oberflaeche`, klassisch/neu) aus der Erprobungszeit der neuen
   * Oberflaeche. Mit E118/1d gibt es EINE: der Kiosk laedt fest /neu/, der
   * Server leitet alles Unbekannte dorthin. Ein Feld, dessen einer Wert auf
   * eine geloeschte App zeigt, waere eine Falle im Waehler. Der Schluessel
   * in Bestandskonfigurationen bleibt liegen und stoert nicht.
   */
  {
    /**
     * WOMIT der Kiosk die Oberflaeche zeigt (E56, 20.08.2026).
     *
     * AN DIESER BOX GEMESSEN (Pi 5, 800x480 ueber DSI-2):
     *     Chromium + Xorg   511 MB PSS, 8 Prozesse plus X-Server
     *     Cog auf DRM       331 MB PSS, 6 Prozesse, kein X-Server
     * Das sind 180 MB auf einer Box mit 2 GB — die Groessenordnung, in der
     * sonst muehsam einzelne Dienste beschnitten werden.
     *
     * DIE WERTE STEHEN NICHT ZUR DEBATTE, wie schon bei `oberflaeche`
     * darueber: chromium-autostart.sh liest `.mupibox.kioskBrowser //
     * "chromium"` und vergleicht gegen "cog". Ein dritter Wert waere stumm
     * Chromium.
     *
     * WARUM DAS TROTZDEM GEFAHRLOS IST: Das Kioskskript faellt auf Chromium
     * zurueck, wenn Cog fehlt oder binnen fuenf Sekunden stirbt (nachgewiesen
     * durch Sabotage am Geraet: cog beiseitegelegt -> 8 Chromium-Prozesse,
     * Xorg an, Box bedienbar). Eine Box ohne Tastatur darf an einer
     * Einstellung nicht am schwarzen Schirm haengenbleiben.
     */
    id: 'kioskBrowser',
    bereich: 'darstellung',
    pfad: ['mupibox', 'kioskBrowser'],
    art: 'auswahl',
    standard: 'chromium',
    festeAuswahl: [
      { wert: 'chromium', titel: 'Chromium — bewährt, mit X-Server' },
      { wert: 'cog', titel: 'Cog — schlank, ohne X-Server (spart ~180 MB)' },
    ],
    titel: 'Womit der Kiosk die Oberfläche zeigt',
    // Der Hinweis nennt BEIDES, weil der Preis sonst erst am Geraet auffaellt
    // — und dann als Fehler der zuletzt geaenderten Oberflaeche.
    hinweis:
      'Cog spart rund 180 MB, bringt aber WebKit statt Blink mit: einzelne Bedienelemente ' +
      'können sich anders verhalten. Fehlende Pakete holt die Box beim Start selbst nach; ' +
      'kommt Cog nicht hoch, startet automatisch wieder Chromium. Wirkt nach einem Neustart.',
    neustart: true,
  },
  /*
   * HIER STAND „Farbthema" (`mupibox.theme`, Auswahl aus
   * `mupibox.installedThemes`) — die 29 CSS-Themen der ALTEN Oberflaeche,
   * per Symlink getauscht. Mit E118/1d faellt das Feld aus der Verwaltung:
   * die neue Oberflaeche faerbt ueber Farbsaetze (app.css) und den
   * Farbwaehler (/farben.css, E118/1c); die Themendateien selbst fallen mit
   * E118/1e. Bestandskonfigurationen behalten ihre Schluessel, sie werden
   * nur nicht mehr angeboten.
   */
  /*
   * HIER STAND „Sprache beim Vorlesen" (`mupibox.ttsLanguage`, Auswahl aus
   * `mupibox.googlettslanguages`). Das Feld ist am 04.08.2026 ERSATZLOS
   * entfallen, und zwar nicht aus Ordnungsliebe:
   *
   * Sein einziger Verbraucher war `downloadTTS` im Abspieldienst — der Weg
   * ueber Google TTS. Der ist abgeloest (siehe backend-player/src/sprechen.ts,
   * am Geraet gemessen). Damit las NIEMAND den Wert mehr. Ein Auswahlfeld, das
   * man bedienen kann und das nichts bewirkt, ist schlimmer als keines: es
   * behauptet eine Wirkung. Die Verwaltung soll nicht luegen.
   *
   * WO DIE EINSTELLUNG JETZT LEBT: Verwaltung -> Vorlesen (`/vorlesen`). Dort
   * waehlt man keine SPRACHE, sondern eine STIMME — mit Probeknopf, weil eine
   * Stimme man nicht nach Datenblatt aussucht.
   *
   * NACHGEZAEHLT AM 05.08.2026, weil hier bis dahin stand, die Suche finde sie
   * ueber „Stimme", „Sprache", „Vorlesen": in such-bestand.ts kommt „Stimme"
   * 9-mal vor und „Vorlesen" 14-mal — „SPRACHE" ABER NULLMAL. Wer das Wort
   * tippt, unter dem das Feld frueher stand, findet nichts. Kein Beinbruch
   * (das Feld gibt es ja nicht mehr), aber die Behauptung gehoerte
   * richtiggestellt: eine Zusicherung im Kommentar, die niemand nachrechnet,
   * veraltet leiser als Code.
   *
   * WARUM DAS FELD NICHT EINFACH AUF PIPER-STIMMEN UMGEBOGEN WURDE: dann gaebe
   * es die Stimmenwahl an ZWEI Stellen derselben Verwaltung, in zwei Dateien
   * (mupiboxconfig.json hier, vorlesen.json dort). Zwei Schalter fuer eine
   * Sache laufen auseinander — genau die Falle, die bei `hat_active` schon
   * einmal zuschlug (der Weg, der beides nebeneinanderlegte, ist am
   * 19.09.2026 gefallen; die Regel steht weiter in hat.ts).
   *
   * DIE SCHLUESSEL BLEIBEN, BEIDE. `mupibox.ttsLanguage` und
   * `mupibox.googlettslanguages` stehen weiter in der Konfiguration jeder Box
   * und werden von update/conf_update.sh weiter geschrieben. Sie hier
   * WEGZUNEHMEN waere ein Datenumzug auf fremden Geraeten fuer null Gewinn —
   * und `googlettslanguages` ist ein Datenschluessel jeder gewachsenen Box.
   * Sie sind ab jetzt nur noch tot, nicht falsch.
   */
  {
    id: 'medienpruefung',
    bereich: 'medien',
    pfad: ['mupibox', 'mediaCheckTimer'],
    art: 'zahl',
    /*
     * DAS VIERTE FELD INS LEERE — und das einzige, dem der Schluessel nicht
     * bloss FEHLT, sondern AKTIV WEGGENOMMEN wird (gefunden 03.08.2026 beim
     * Gegenlesen, mit tools/konfig-umzug-probe.py).
     *
     * update/conf_update.sh loescht in Zeile 10 `.mupibox.mediaCheckTimer`
     * ersatzlos — ein Rest aus 1.0.8, wo `googlettslanguages`,
     * `mediaCheckTimer` und `AudioDevices` gemeinsam entfernt und drei Zeilen
     * spaeter nur `googlettslanguages` wieder angelegt wurde. Seither nimmt
     * JEDES Update jeder Box diesen Schluessel mit.
     *
     * WAS DAS KOSTET, und deshalb steht hier ein Wert und keine Notiz:
     * `scripts/mupibox/change_checker.sh` liest ihn mit `jq -r` in
     * CHECK_TIMER und ruft am Schleifenende `sleep ${CHECK_TIMER}`. Ohne
     * Schluessel steht dort woertlich `null`; `sleep null` bricht sofort mit
     * „ungueltiges Zeitintervall" ab, und aus der Warteschleife wird eine
     * Dauerschleife, die `stat` ueber jedes Medienverzeichnis jagt — auf
     * einem Pi, der nebenher Musik abspielt. Am Bildschirm meldet das nichts.
     *
     * DER WERT ist der der Vorlage, als ZEICHENKETTE wie dort: `pruefeFeld`
     * erhaelt bei 'zahl' den Typ des Altwerts, jede gewachsene Box hat "300"
     * als Text, und die Shell liest ihn ohnehin mit `jq -r`.
     *
     * Der Schluessel selbst entsteht in update/conf_update.sh — beide Haelften
     * sind noetig ([[board-feld-ohne-schluessel-auf-der-box]]).
     */
    standard: '300',
    min: 0,
    max: 86400,
    titel: 'Medien prüfen alle … Sekunden',
    hinweis: 'Wie oft die Box nach neuen Medien sieht. 0 = nie.',
  },
  {
    id: 'ausschaltenNach',
    bereich: 'box',
    pfad: ['timeout', 'idlePiShutdown'],
    art: 'zahl',
    min: 0,
    max: 1440,
    titel: 'Ausschalten nach … Minuten Nichtstun',
    hinweis: '0 = nie von allein ausschalten.',
  },
  {
    id: 'bildschirmAusNach',
    bereich: 'box',
    pfad: ['timeout', 'idleDisplayOff'],
    art: 'zahl',
    min: 0,
    max: 1440,
    titel: 'Bildschirm aus nach … Minuten',
    hinweis: '0 = Bildschirm bleibt an.',
  },
  {
    id: 'druckdauer',
    bereich: 'box',
    pfad: ['timeout', 'pressDelay'],
    art: 'zahl',
    min: 0,
    // ── WARUM 5 UND NICHT 20 ────────────────────────────────────────────
    //
    // Weil ab 6 Sekunden nicht mehr die Box entscheidet, sondern die
    // Platine. Das MuPiHAT-Datenblatt beschreibt drei Griffe an derselben
    // Taste (J1): druecken = einschalten, kurz druecken = herunterfahren,
    // laenger als 6 Sekunden = HARTES Abschalten. Das letzte ist der
    // Notaus in Hardware und fragt niemanden.
    //
    // Stuenden hier 10 Sekunden, kaeme off_trigger.sh nie bis zu seinem
    // `poweroff`: bei 6 Sekunden nimmt der HAT den Strom weg, mitten im
    // Schreiben. Die Box faehrt dann bei JEDEM langen Druck hart
    // herunter — und zwar so, dass es aussieht, als taete sie genau das,
    // was eingestellt wurde. Die Grenze liegt deshalb mit Abstand
    // darunter.
    max: 5,
    titel: 'Haltedauer der Taste (Sekunden)',
    hinweis:
      'Wie lange die Taste gedrückt werden muss. Ganze Sekunden. Ab 6 Sekunden schaltet der MuPiHAT selbst hart ab — deshalb höchstens 5.',
  },
  {
    id: 'anmeldung',
    bereich: 'zugang',
    pfad: ['interfacelogin', 'state'],
    art: 'schalter',
    titel: 'Anmeldung für die Verwaltung',
    hinweis: 'Aus bedeutet: jeder im Netzwerk kann diese Verwaltung öffnen und die Box abschalten.',
  },
  {
    id: 'einstellungssperre',
    bereich: 'zugang',
    pfad: ['mupibox', 'einstellungssperre'],
    art: 'auswahl',
    // ── DIESER `standard` ZIEHT NUR NACH, ER ENTSCHEIDET NICHTS ─────────────
    //
    // Hier stand „aus", mit der Begruendung: auf einer Box, deren
    // Konfiguration aelter ist als dieses Feld, fehle der Schluessel ganz, und
    // „aus" sei dann nicht bloss die Vorgabe, sondern die WAHRHEIT.
    //
    // Die erste Haelfte stimmt und ist am 06.08.2026 an der Box .169
    // nachgesehen worden — der Schluessel fehlt dort wirklich. Die zweite
    // Haelfte war eine Annahme ueber eine andere Datei, und sie war falsch.
    // GEMESSEN (tools/tor-kette-messen.mjs):
    //   * `standard` wird ausschliesslich von `holeWertOderStandard` (unten)
    //     eingesetzt, und das hat genau einen Aufrufer: `feldNachAussen`.
    //     Dessen einziger Aufrufer ausserhalb der Tests ist
    //     `GET /api/konfiguration` (server.ts) — der Weg des Verwaltungs-
    //     Boards.
    //   * Die BOX liest `GET /api/config`. Der Weg gibt die Datei roh heraus,
    //     kennt diesen Katalog nicht und setzt keine Vorgabe ein.
    // Dieser Wert faerbt also die ANZEIGE, nicht das Verhalten. Er steht hier
    // trotzdem auf „rechnen", weil die Ruecknahme beim LESEN es jetzt auch tut
    // (NewDesign/app.js, `sperrModus`): stuende hier weiter „aus", behauptete
    // das Board „jeder kommt hinein" ueber eine Box, die nachfragt. Ein Feld,
    // das etwas anderes anzeigt als die Box tut, ist schlimmer als ein
    // fehlendes.
    //
    // WER DIESE ZEILE ALLEIN AENDERT, HAT NICHTS GESCHLOSSEN. Sie gehoert in
    // denselben Zug wie `sperrModus` in NewDesign/app.js und der Wert in
    // config/templates/mupiboxconfig.json.
    //
    // ── DER SATZ, DER HIER STAND, WAR EINEN TAG SPAETER UEBERHOLT ──────────
    // Bis zum 25.08.2026 endete dieser Block mit: „Und `alsModus` in
    // src/frontend-box/…/sperrlogik.ts faellt weiterhin auf „aus" zurueck —
    // auf einer Box mit `oberflaeche: klassisch` und fehlendem Schluessel
    // luegt dieses Feld deshalb bis heute."
    //
    // Geschrieben am 05.08.2026 (ea2c09bf), behoben am 06.08.2026 (f51833ed):
    // `alsModus` gibt fuer alles Unbekannte `rechnen` zurueck, den fehlenden
    // Schluessel eingeschlossen. Die drei Orte sagen seit dem 06.08. dasselbe,
    // und dieses Feld luegt nicht mehr.
    //
    // STEHEN GEBLIEBEN IST ER 19 TAGE. Das ist die teurere Haelfte von
    // [[drei-orte-eine-anzeige]]: nicht die Werte driften hier, sondern die
    // BEFUNDE ueber sie. Ein Kommentar, der einen Fehler in einer FREMDEN
    // Datei behauptet, wird nicht mit ihr zusammen geaendert — er faellt nur
    // auf, wenn jemand nachsieht. Wer so einen Satz schreibt, schreibt das
    // Datum dazu; wer den Fehler behebt, sucht nach dem, was ihn behauptet.
    standard: 'rechnen',
    festeAuswahl: [
      { wert: 'aus', titel: 'Aus — jeder kommt hinein' },
      { wert: 'rechnen', titel: 'Rechenaufgabe — z. B. 7 × 8' },
      { wert: 'pin', titel: 'PIN — 4 bis 8 Ziffern' },
      // DIE GESTE BRAUCHT NICHTS EINGERICHTET, anders als die PIN — es gibt
      // deshalb auch keine zweite Wache wie die gegen „pin ohne PIN" unten.
      // Was sie ist, steht im `hinweis`; das ist der einzige Ort, an dem sie
      // steht, und das ist Absicht (siehe dort).
      //
      // DER ZUSATZ IM TITEL IST KEINE ZIERDE: Die Geste ist nur in der NEUEN
      // Oberfläche gebaut. `alsModus` in
      // src/frontend-box/.../sperrlogik.ts kennt drei Werte und bildet alles
      // andere — auch „geste" — auf „aus" ab. Auf einer Box mit
      // `oberflaeche: klassisch` wäre diese Wahl also gar keine Sperre,
      // während dieses Feld „Geste" anzeigt. Solange die vierte Sorte dort
      // nicht nachgezogen ist, muss der Satz an der auffälligsten Stelle
      // stehen, die es gibt: im Auswahleintrag selbst.
      { wert: 'geste', titel: 'Geste — vier Ecken im Uhrzeigersinn (nur neue Oberfläche)' },
    ],
    titel: 'Sperre vor den Einstellungen der Box',
    // Der Hinweis zählt AUF, was dahinterliegt, weil man es der Kachel
    // „Einstellungen" nicht ansieht: von dort aus sind WLAN, Bluetooth, die
    // rohe Mediendatenbank samt Löschknöpfen und das Herunterfahren mit
    // wenigen Tippern erreichbar. Bisher stand davor nur „2 Sekunden lang
    // gedrückt halten" — und die Startseite verriet diesen Griff nach drei
    // kurzen Tippern sogar von selbst.
    // ── HIER UND NUR HIER STEHT DIE GESTE ──────────────────────────────────
    //
    // Der Bildschirm der Box sagt „Mit einer Geste gesperrt" und verweist auf
    // diese Stelle — er sagt NICHT, welche Geste es ist. Ein Tor, das seine
    // eigene Lösung anschreibt, ist keine Sperre.
    //
    // Damit ist dieser Satz die einzige Stelle, an der ein zweiter Elternteil
    // sie erfährt, und er muss sie VOLLSTÄNDIG nennen: welche Fläche, welche
    // Reihenfolge, welche Zeitgrenze. `{{ f.hinweis }}` in der Verwaltung ist
    // Interpolation — kein Umbruch, keine Aufzählung, kein Bild. Eine Geste,
    // die man zeigen müsste, ließe sich hier nicht erklären; genau deshalb ist
    // es eine, die man in einem Satz sagen kann.
    //
    // ZU FINDEN IST DIESER TEXT ÜBER DIE SUCHE DER VERWALTUNG NICHT: der
    // Suchbestand (such-bestand.ts) enthält kein einziges Feld aus FELDER,
    // weil sein Erzeuger die `@for`-Schleife der Feldliste entfernt. Wer
    // „Geste" sucht, findet nichts und muss von selbst auf /konfiguration
    // gehen. Das ist ein offener Punkt und steht als solcher im Bericht —
    // repariert gehört er im Erzeuger, nicht durch einen zweiten Text hier.
    hinweis:
      'Fragt am Bildschirm der Box nach, bevor Einstellungen, WLAN, Bluetooth, Mediendatenbank ' +
      'und Darstellung aufgehen — dort liegen der Netzwerkzugang, die Löschknöpfe und das ' +
      'Ausschalten. Aus bedeutet: jedes Kind kommt hinein. Für „PIN" muss vorher eine PIN ' +
      'gesetzt sein. Bei „Rechenaufgabe" wartet die Box nach dem ersten falschen Ergebnis ' +
      'fünf Sekunden, und die Wartezeit wächst mit jedem weiteren Fehlversuch bis auf eine ' +
      'Minute — wer sich einmal vertippt, merkt davon nichts, wer durchprobiert, sitzt ' +
      'Minuten davor. Die Geste ist: die vier Ecken der gesperrten Fläche nacheinander ' +
      'antippen, im Uhrzeigersinn beginnend links oben — links oben, rechts oben, rechts ' +
      'unten, links unten. Zwischen zwei Ecken dürfen höchstens vier Sekunden liegen; jede ' +
      'Berührung daneben fängt die Folge von vorn an. Die Punkte auf dem Bildschirm zählen ' +
      'dabei nur die Berührungen und sagen NICHT, ob eine Ecke richtig war — sonst ließe ' +
      'sich die Geste durch Herumtippen ertasten. Nach zwölf erfolglosen Berührungen wartet ' +
      'die Box ebenfalls, und auch hier wächst die Wartezeit — drei volle Versuche sind frei. ' +
      'Auf dem Bildschirm der Box steht sie mit ' +
      'Absicht nicht. Die Geste gibt es nur in der neuen Oberfläche — auf einer Box, die ' +
      'noch die bisherige fährt, wäre sie keine Sperre.',
  },
  {
    id: 'kioskModus',
    bereich: 'darstellung',
    pfad: ['chromium', 'kiosk'],
    art: 'schalter',
    titel: 'Vollbild auf dem Bildschirm der Box',
    hinweis: 'Aus zeigt die Browserleisten — nur zur Fehlersuche sinnvoll.',
    neustart: true,
  },
  {
    id: 'grafikbeschleunigung',
    bereich: 'hardware',
    pfad: ['chromium', 'gpu'],
    art: 'schalter',
    titel: 'Grafikbeschleunigung',
    hinweis: 'Flüssiger, aber nicht auf jeder Hardware stabil.',
    neustart: true,
  },
  {
    id: 'bildlauf',
    bereich: 'darstellung',
    pfad: ['chromium', 'sccrollanimation'],
    art: 'schalter',
    titel: 'Weicher Bildlauf',
    hinweis: 'Sanftes Scrollen auf dem Touchbildschirm.',
    neustart: true,
  },
  {
    id: 'zwischenspeicher',
    bereich: 'hardware',
    pfad: ['chromium', 'cachesize'],
    art: 'zahl',
    min: 0,
    max: 4096,
    titel: 'Zwischenspeicher des Browsers (MB)',
    hinweis: 'Größer heißt weniger Nachladen, kostet aber Platz.',
    neustart: true,
  },
  {
    id: 'luefter',
    bereich: 'hardware',
    pfad: ['fan', 'fan_active'],
    art: 'schalter',
    titel: 'Lüfter verwenden',
    hinweis: 'Nur einschalten, wenn wirklich einer angeschlossen ist.',
  },
  // Die vier Schwellen: ab welcher Temperatur der Lüfter wie stark läuft.
  // Sie müssen aufsteigend bleiben — siehe pruefeKonfig.
  {
    id: 'luefter25',
    bereich: 'hardware',
    pfad: ['fan', 'fan_temp_25'],
    art: 'zahl',
    min: 20,
    max: 90,
    titel: 'Lüfter 25 % ab … °C',
    hinweis: 'Erste Stufe. Darunter steht der Lüfter still.',
  },
  {
    id: 'luefter50',
    bereich: 'hardware',
    pfad: ['fan', 'fan_temp_50'],
    art: 'zahl',
    min: 20,
    max: 90,
    titel: 'Lüfter 50 % ab … °C',
    hinweis: 'Zweite Stufe.',
  },
  {
    id: 'luefter75',
    bereich: 'hardware',
    pfad: ['fan', 'fan_temp_75'],
    art: 'zahl',
    min: 20,
    max: 90,
    titel: 'Lüfter 75 % ab … °C',
    hinweis: 'Dritte Stufe.',
  },
  {
    id: 'luefter100',
    bereich: 'hardware',
    pfad: ['fan', 'fan_temp_100'],
    art: 'zahl',
    min: 20,
    max: 90,
    titel: 'Lüfter 100 % ab … °C',
    hinweis: 'Volle Drehzahl. Der Pi drosselt sich selbst ab etwa 80 °C.',
  },
  // ── Die LED im Einschaltknopf ─────────────────────────────────────────
  /*
   * WAS DA LEUCHTET: der beleuchtete Knopf, mit dem die Box an- und
   * ausgeht. Das MuPiHAT-Datenblatt fuehrt ihn seit Platinenstand 2.2
   * (03/2024) als „LED des Einschaltknopfs auf GPIO13 (PWM)" — Stecker J15,
   * der Taster daneben an J1. PWM ist der Grund, warum hier drei Felder
   * stehen und nicht eines: die LED kann aus, hell und gedimmt.
   *
   * WARUM EIN EIGENER SCHALTER UND NICHT „Helligkeit auf 0":
   * Die alte Oberflaeche (mupi.php) konnte nur die Helligkeit. Wer die LED
   * abends ausmachen wollte, zog den Regler auf 0 — und musste am naechsten
   * Morgen WISSEN, dass vorher 70 dastand. Der Schalter laesst beide
   * Helligkeiten stehen und gibt sie unveraendert zurueck.
   *
   * WAS ABSICHTLICH FEHLT: die GPIO-Nummer (`shim.ledPin`), die mupi.php als
   * Auswahlliste hatte. Eine falsche Nummer schaltet einen fremden Pin, und
   * das sieht man der Box nicht an — sie bleibt einfach dunkel, waehrend
   * irgendwo anders ein Ausgang klappert. Das gehoert zum Aufbau, nicht in
   * die laufende Verwaltung (dieselbe Begruendung wie oben bei `shim`).
   *
   * DASS DAS SOFORT WIRKT und nicht erst nach einem Neustart, liegt an
   * scripts/mupibox/mupi_start_led.sh: die Schleife dort liest die
   * Konfiguration jede Sekunde und reicht Aenderungen an led_control.py
   * weiter. Deshalb steht an diesen Feldern KEIN `neustart: true`.
   */
  {
    id: 'knopflicht',
    bereich: 'hardware',
    pfad: ['shim', 'ledEnabled'],
    art: 'schalter',
    // ── DIESER `standard` IST KEINE ZIERDE ──────────────────────────────
    //
    // Auf einer Box, die update/conf_update.sh noch nicht gesehen hat, FEHLT
    // der Schluessel. Ohne Vorgabe zeigte das Board dann einen ausgeschalteten
    // Schalter ueber einem Knopf, der LEUCHTET — und der erste Klick darauf
    // („dann mache ich ihn mal an") schriebe `false` und machte ihn aus.
    //
    // `true` ist hier nicht der bequeme, sondern der WAHRE Wert: sowohl
    // mupi_start_led.sh (`led_an`) als auch led_control.py (`ist_an`) werten
    // einen fehlenden Schluessel als AN, und die Vorlage schreibt `true`.
    // Alle vier Stellen sagen dasselbe.
    standard: true,
    titel: 'Licht im Einschaltknopf',
    hinweis: 'Aus lässt den Knopf dunkel — die eingestellten Helligkeiten bleiben erhalten.',
  },
  {
    id: 'knopflichtHell',
    bereich: 'hardware',
    pfad: ['shim', 'ledBrightnessMax'],
    art: 'zahl',
    min: 0,
    max: 100,
    // Wie in der Vorlage, und als ZEICHENKETTE wie dort: `pruefeFeld` erhaelt
    // bei 'zahl' den Typ des Altwerts, und mupi_start_led.sh liest ihn mit
    // `jq -r`. (Dieselbe Begruendung wie bei `medienpruefung`.)
    standard: '100',
    titel: 'Helligkeit des Knopfs (%)',
    hinweis: 'Solange der Bildschirm an ist.',
  },
  {
    id: 'knopflichtGedimmt',
    bereich: 'hardware',
    pfad: ['shim', 'ledBrightnessMin'],
    art: 'zahl',
    min: 0,
    max: 100,
    standard: '10',
    // Nicht groesser als die normale Helligkeit — siehe pruefeKonfig.
    titel: 'Helligkeit des Knopfs gedimmt (%)',
    hinweis: 'Sobald der Bildschirm ausgeht. Nachts im Kinderzimmer der wichtigere Wert.',
  },
  // ── Telegram ──────────────────────────────────────────────────────────
  /*
   * WARUM TELEGRAM UND NICHT MQTT ODER WLED, obwohl alle drei aus derselben
   * PHP-Seite (smart.php) stammen:
   *
   *   Telegram hat 17 Leser im Baum (12 Python-Skripte, idle_shutdown.sh,
   *   mupi_shutdown.sh, server.ts, spotify-control.ts) und drei Schluessel.
   *   Der Schalter wirkt, die Felder sind wenige, der Token ist ein Geheimnis
   *   und wird auch so behandelt (siehe `ohneGeheimnisse`).
   *
   *   MQTT haette 14 Felder gekostet — und `mqtt.py` LIEST `mqtt.active` zwar
   *   in eine Variable, wertet sie aber nie aus (gefunden 03.08.2026,
   *   mqtt.py:908). Ein Feld dafuer waere ein Schalter, der nichts schaltet.
   *   WLED hat mit `startup_id` und `boot_active` schon zwei solche.
   *   Erst reparieren, dann bedienbar machen — siehe BACKLOG E6.
   */
  {
    id: 'telegramAktiv',
    bereich: 'melden',
    pfad: ['telegram', 'active'],
    art: 'schalter',
    standard: false,
    titel: 'Telegram-Nachrichten',
    hinweis: 'Die Box meldet Start, Abschalten und Störungen an einen Chat.',
  },
  {
    id: 'telegramToken',
    bereich: 'melden',
    pfad: ['telegram', 'token'],
    art: 'geheim',
    standard: '',
    titel: 'Telegram Bot-Token',
    hinweis: 'Vom BotFather. Wird nie angezeigt — nur gesetzt oder gelöscht.',
  },
  {
    id: 'telegramChat',
    bereich: 'melden',
    pfad: ['telegram', 'chatId'],
    art: 'text',
    standard: '',
    leerErlaubt: true,
    titel: 'Telegram Chat-ID',
    hinweis: 'An welchen Chat geschrieben wird. Eine Zahl, oft mit Minus davor.',
  },
  // ── Nachrichten AN die Box (20.09.2026) ───────────────────────────────
  //
  // DIE GEGENRICHTUNG ZU TELEGRAM DARUEBER. Die drei Felder oben melden
  // HINAUS ("die Box sagt Bescheid"); diese hier lassen jemanden HEREIN
  // reden. Das ist ein anderer Gegenstand, kein zweiter Schalter fuer
  // denselben — deshalb ein eigener Aktiv-Schalter und ein eigener Token.
  //
  // WARUM EIN ZWEITER TELEGRAM-TOKEN UND NICHT DER VON OBEN: `getUpdates`
  // liefert jede Nachricht GENAU EINMAL. Laeuft daneben noch
  // `scripts/telegram/telegram_receiver.py` mit demselben Token, holen sich
  // die beiden die Nachrichten gegenseitig weg — mal kommt sie an, mal nicht.
  // Ein eigener Bot ist beim BotFather eine Minute Arbeit und der einzige
  // Weg, bei dem beide Richtungen zuverlaessig sind. `nachrichtenPruefen`
  // sagt es, wenn doch derselbe Token dasteht.
  {
    id: 'nachrichtenAktiv',
    bereich: 'melden',
    pfad: ['nachrichten', 'active'],
    art: 'schalter',
    standard: false,
    titel: 'Nachrichten an die Box',
    hinweis: 'Eltern schreiben dem Kind. Nur Absender von der Erlaubnisliste kommen durch.',
  },
  {
    id: 'nachrichtenVorlesen',
    bereich: 'melden',
    pfad: ['nachrichten', 'vorlesen'],
    art: 'schalter',
    standard: true,
    titel: 'Nachrichten vorlesen',
    hinweis: 'Die Box spricht die Nachricht aus. Je Profil umstellbar — hier steht nur die Vorgabe.',
  },
  {
    id: 'nachrichtenMatrixAktiv',
    bereich: 'melden',
    pfad: ['nachrichten', 'matrixActive'],
    art: 'schalter',
    standard: false,
    titel: 'Weg: Matrix',
    hinweis: 'Braucht ein eigenes Konto fuer die Box. Verschluesselte Raeume gehen nicht.',
  },
  {
    id: 'nachrichtenMatrixServer',
    bereich: 'melden',
    pfad: ['nachrichten', 'matrixServer'],
    art: 'url',
    standard: '',
    leerErlaubt: true,
    titel: 'Matrix-Server',
    hinweis: 'Die Adresse des Heimservers, z. B. https://matrix.example.org — ohne Pfad dahinter.',
  },
  {
    id: 'nachrichtenMatrixToken',
    bereich: 'melden',
    pfad: ['nachrichten', 'matrixToken'],
    art: 'geheim',
    standard: '',
    titel: 'Matrix-Zugangstoken',
    hinweis: 'Der access_token des Box-Kontos. Wird nie angezeigt — nur gesetzt oder geloescht.',
  },
  {
    id: 'nachrichtenMatrixRaum',
    bereich: 'melden',
    pfad: ['nachrichten', 'matrixRaum'],
    art: 'text',
    standard: '',
    leerErlaubt: true,
    titel: 'Matrix-Raum',
    hinweis: 'Nur aus diesem Raum, z. B. !abc:server.example. Leer heisst: aus allen Raeumen der Box.',
  },
  {
    id: 'nachrichtenTelegramAktiv',
    bereich: 'melden',
    pfad: ['nachrichten', 'telegramActive'],
    art: 'schalter',
    standard: false,
    titel: 'Weg: Telegram',
    hinweis: 'Braucht einen EIGENEN Bot — nicht den von oben, sonst gehen Nachrichten verloren.',
  },
  {
    id: 'nachrichtenTelegramToken',
    bereich: 'melden',
    pfad: ['nachrichten', 'telegramToken'],
    art: 'geheim',
    standard: '',
    titel: 'Telegram-Bot-Token (Eingang)',
    hinweis: 'Vom BotFather, fuer den Eingangs-Bot. Wird nie angezeigt.',
  },
  {
    id: 'nachrichtenSignalAktiv',
    bereich: 'melden',
    pfad: ['nachrichten', 'signalActive'],
    art: 'schalter',
    standard: false,
    titel: 'Weg: Signal',
    hinweis: 'Braucht signal-cli als Dienst auf der Box. Fehlt er, sagt die Seite es.',
  },
  {
    id: 'nachrichtenSignalHost',
    bereich: 'melden',
    pfad: ['nachrichten', 'signalHost'],
    art: 'text',
    standard: '127.0.0.1',
    titel: 'signal-cli: Rechner',
    hinweis: 'Wo der JSON-RPC-Zugang von signal-cli horcht. Ueblich: 127.0.0.1.',
  },
  {
    id: 'nachrichtenSignalPort',
    bereich: 'melden',
    pfad: ['nachrichten', 'signalPort'],
    art: 'zahl',
    standard: '7583',
    min: 1,
    max: 65535,
    titel: 'signal-cli: Port',
    hinweis: 'Vorgabe von signal-cli daemon --tcp ist 7583.',
  },
  {
    id: 'nachrichtenSignalNummer',
    bereich: 'melden',
    pfad: ['nachrichten', 'signalNummer'],
    art: 'text',
    standard: '',
    leerErlaubt: true,
    titel: 'signal-cli: Nummer der Box',
    hinweis: 'Die bei signal-cli verbundene Nummer, international: +49…',
  },
  // ── Spotify ───────────────────────────────────────────────────────────
  //
  // DIE AKTIV-SCHALTER (E76, 22.08.2026). Je Streaming-Anbieter einer, Vorgabe
  // AN: Bestandsboxen kennen das Feld nicht, und eine Aktualisierung darf
  // keiner Familie den Ton abdrehen. Ausgewertet werden sie DREIFACH — in
  // `anbieterLage` (Verwaltung), im `/api/werke`-Handler (Kacheln ausgrauen)
  // und im /player-Proxy (Abspielen verweigern, mit Grund). Die Warnung von
  // mqtt.active weiter oben gilt: ein Schalter ohne Verbraucher ist verboten;
  // dieser hier hat drei.
  {
    id: 'spotifyAktiv',
    bereich: 'streaming',
    pfad: ['spotify', 'aktiv'],
    art: 'schalter',
    standard: true,
    titel: 'Spotify eingeschaltet',
    hinweis:
      'Aus = Kacheln bleiben sichtbar, sind aber ausgegraut; das Abspielen wird mit einem freundlichen Satz verweigert. Die Einrichtung bleibt erhalten.',
  },
  {
    id: 'spotifyClientId',
    bereich: 'streaming',
    pfad: ['spotify', 'clientId'],
    art: 'text',
    // Leeren muss gehen: eine falsch eingetippte Client-ID laesst die Anmeldung
    // wortlos scheitern, und ohne Rueckweg bliebe sie fuer immer stehen.
    leerErlaubt: true,
    titel: 'Spotify Client-ID',
    hinweis: 'Aus dem Spotify-Entwicklerbereich. Kein Geheimnis — die Anmeldung läuft ohne Client-Secret (PKCE).',
  },
  {
    id: 'spotifyZwischenspeicher',
    bereich: 'streaming',
    pfad: ['spotify', 'cachestate'],
    art: 'schalter',
    titel: 'Spotify-Zwischenspeicher verwenden',
    hinweis: 'Spart Datenverkehr, belegt aber Platz auf der Karte.',
  },
  {
    id: 'spotifyCacheStufe',
    bereich: 'streaming',
    // ABSICHTLICH auf oberster Ebene: das Box-Frontend liest genau
    // `spotifyCacheLevel` aus /api/config (media-cache.service.ts).
    pfad: ['spotifyCacheLevel'],
    art: 'auswahl',
    festeAuswahl: [
      { wert: 'off', titel: 'Aus — nichts zwischenspeichern' },
      { wert: 'medium', titel: 'Mittel — Playlists beim Öffnen prüfen' },
      { wert: 'max', titel: 'Maximal — 7 Tage halten, alles vorladen' },
    ],
    titel: 'Umfang des Spotify-Zwischenspeichers',
    hinweis: 'Mittel spart die meisten Abfragen bei kaum Nachteil.',
  },
  {
    id: 'spotifyPlaylistSuche',
    bereich: 'streaming',
    pfad: ['spotify', 'disableScraperForPlaylists'],
    art: 'schalter',
    // Fehlt der Schluessel, laeuft die Notloesung — genau das heisst `false`.
    standard: false,
    titel: 'Playlist-Notlösung abschalten',
    hinweis:
      'Manche Playlists findet die Spotify-Schnittstelle nicht; dann hilft ein Umweg über die Webseite. Abschalten spart Rechenzeit, lässt aber Playlists verschwinden.',
  },
  // ── Jellyfin ──────────────────────────────────────────────────────────
  {
    id: 'jellyfinAktiv',
    bereich: 'streaming',
    pfad: ['jellyfin', 'aktiv'],
    art: 'schalter',
    standard: true,
    titel: 'Jellyfin eingeschaltet',
    hinweis: 'Aus = Kacheln ausgegraut, Abspielen freundlich verweigert. Server und Schlüssel bleiben eingetragen.',
  },
  {
    id: 'jellyfinServer',
    bereich: 'streaming',
    pfad: ['jellyfin', 'server'],
    art: 'url',
    titel: 'Jellyfin-Server',
    hinweis: 'Vollständige Adresse mit http:// oder https:// und Port. Leer = nicht eingerichtet.',
  },
  {
    id: 'jellyfinSchluessel',
    bereich: 'streaming',
    pfad: ['jellyfin', 'apiKey'],
    art: 'geheim',
    // Fehlender Schluessel und leerer Schluessel bedeuten dasselbe: nichts
    // hinterlegt. Bei 'geheim' geht ohnehin nur `gesetzt` nach aussen.
    standard: '',
    titel: 'Jellyfin API-Schlüssel',
    hinweis: 'Wird nie angezeigt — nur gesetzt oder gelöscht.',
  },
  // ── ARD Sounds ────────────────────────────────────────────────────────
  //
  // DAS ERSTE ARD-FELD UEBERHAUPT: die Audiothek braucht keinen Schluessel
  // (gemessen 04.08.2026, siehe streaming.ts), also gab es bis E76 nichts
  // einzustellen. Die Gruppe `ard` entsteht in der Konfiguration erst, wenn
  // jemand diesen Schalter zum ersten Mal umlegt.
  {
    id: 'ardAktiv',
    bereich: 'streaming',
    pfad: ['ard', 'aktiv'],
    art: 'schalter',
    standard: true,
    titel: 'ARD Sounds eingeschaltet',
    hinweis: 'Aus = Kacheln ausgegraut, Abspielen freundlich verweigert.',
  },
  {
    id: 'fortsetzen',
    bereich: 'medien',
    pfad: ['mupibox', 'resume'],
    art: 'zahl',
    min: 0,
    max: 99,
    titel: 'Zuletzt Gehörtes merken (Anzahl)',
    hinweis: 'Wie viele angefangene Titel die Box zum Weiterhören vormerkt.',
  },
  {
    /*
     * DIE STUFE IST EINE EINSTELLUNG, KEIN BEFUND (E86).
     *
     * Sie steht deshalb HIER und nicht in `verschmelzung.json`: jene Datei
     * haelt fest, WAS entschieden wurde („zuordnungen") und was ausdruecklich
     * nicht („getrennt"). Beides bleibt gueltig, wenn jemand morgen strenger
     * vergleichen will — nur die VORSCHLAEGE des naechsten Abgleichs fallen
     * anders aus.
     *
     * SIE AENDERT NICHTS VON SELBST. Der Abgleich laeuft ausdruecklich nur
     * auf Knopfdruck (siehe Kopf von abgleich.ts), und alles, was er
     * vorschlaegt, ist umkehrbar. Wer hier umstellt, sieht die Wirkung beim
     * naechsten „abgleichen" — nicht an der Bibliothek des Kindes.
     */
    id: 'abgleichStufe',
    bereich: 'medien',
    pfad: ['mupibox', 'abgleichStufe'],
    art: 'auswahl',
    standard: 'normal',
    festeAuswahl: [
      { wert: 'streng', titel: 'Streng — nur gleiche Titel' },
      { wert: 'normal', titel: 'Normal — erkennt auch vertauschte Felder' },
      { wert: 'locker', titel: 'Locker — findet mehr, irrt auch mehr' },
    ],
    titel: 'Wie streng zwei Dienste abgeglichen werden',
    /*
     * DER HINWEIS NENNT DEN PREIS JEDER STUFE, weil er sonst erst am Katalog
     * auffaellt — und dann als Fehler des Abgleichs statt als gewaehlte
     * Einstellung. „Quarks" ist ein echtes Beispiel: die WDR-Sendung und
     * „Quarks Science Cops" fallen auf `locker` zusammen.
     */
    hinweis:
      'Normal erkennt auch, wenn zwei Dienste dieselben Wörter anders auf Titel und Interpret ' +
      'verteilen („Quarks Science Cops“/WDR und „Science Cops“/Quarks). Streng verlangt gleiche ' +
      'Titel. Locker findet mehr Paare, wirft dabei aber auch Ähnliches zusammen — etwa „Quarks“ ' +
      'und „Quarks Science Cops“. Wirkt beim nächsten „abgleichen“; nichts ändert sich von selbst.',
  },
]

export function feldNach(id: unknown): Feld | null {
  if (typeof id !== 'string') return null
  return FELDER.find((f) => f.id === id) ?? null
}

/**
 * Wert an einem Feldpfad lesen — ROH, ohne Vorgabe. Pure.
 *
 * Bewusst ohne `standard`: `unterschiede` vergleicht mit dieser Funktion, und
 * dort muss „Schluessel fehlt" von „Schluessel steht auf dem Vorgabewert"
 * unterscheidbar bleiben. Sonst meldete das Speichern keine Aenderung, obwohl
 * der Schluessel neu angelegt wurde.
 */
export function holeWert(konfig: unknown, feld: Feld): unknown {
  const k = konfig as Record<string, unknown> | undefined
  if (feld.pfad.length === 1) return k?.[feld.pfad[0]]
  const g = k?.[feld.pfad[0]]
  return (g as Record<string, unknown>)?.[feld.pfad[1]]
}

/**
 * Wert MIT Vorgabe — das, was ein Mensch sehen soll. Pure.
 *
 * Fehlt der Schluessel in der Datei, gilt der Vorgabewert des Feldes. Ohne
 * diesen Schritt zeigte eine Auswahl den ersten Eintrag an, ohne dass irgendwo
 * dieser Wert stuende — richtig aus Zufall statt aus Absicht.
 */
export function holeWertOderStandard(konfig: unknown, feld: Feld): unknown {
  const w = holeWert(konfig, feld)
  return w === undefined || w === null ? feld.standard : w
}

export interface Auswahl {
  /** Was gespeichert wird. */
  wert: string
  /** Was der Mensch liest. */
  titel: string
}

/**
 * Auswahlliste eines Feldes lesen. Pure.
 *
 * Verträgt BEIDE Formen, die in dieser Konfiguration vorkommen: eine schlichte
 * Liste von Namen (`installedThemes`) und eine Liste von Objekten
 * (`googlettslanguages`: { "iso639-1": "de", "Language": "German" }). Die
 * zweite Form nur mit Filter auf Zeichenketten zu behandeln ergäbe eine leere
 * Auswahl — das Feld wäre unbedienbar und jeder Wert würde abgelehnt.
 */
export function auswahlFuer(konfig: unknown, feld: Feld): Auswahl[] {
  if (feld.festeAuswahl) return feld.festeAuswahl
  if (!feld.auswahlAus) return []
  const g = (konfig as Record<string, unknown>)?.[feld.auswahlAus[0]]
  const l = (g as Record<string, unknown>)?.[feld.auswahlAus[1]]
  if (!Array.isArray(l)) return []
  const raus: Auswahl[] = []
  for (const e of l) {
    if (typeof e === 'string') {
      raus.push({ wert: e, titel: e })
      continue
    }
    if (e && typeof e === 'object' && feld.wertSchluessel) {
      const o = e as Record<string, unknown>
      const wert = o[feld.wertSchluessel]
      if (typeof wert !== 'string' || wert === '') continue
      const titel = feld.titelSchluessel ? o[feld.titelSchluessel] : undefined
      raus.push({ wert, titel: typeof titel === 'string' && titel ? titel : wert })
    }
  }
  return raus
}

export interface Pruefung {
  ok: boolean
  wert?: unknown
  grund?: string
}

/**
 * Einen eingehenden Wert prüfen und in die Form bringen, die in der Datei
 * steht. Pure.
 *
 * Der Kern ist die Typerhaltung: stand dort `"40"`, kommt `"75"` zurück und
 * nicht `75`. Die Shell-Skripte lesen diese Werte mit `jq -r`; ein
 * Typwechsel unter ihnen weg ist genau die Art Fehler, die erst Wochen
 * später und dann unerklärlich auftritt.
 */
export function pruefeFeld(feld: Feld, roh: unknown, alt: unknown): Pruefung {
  switch (feld.art) {
    case 'schalter': {
      if (typeof roh !== 'boolean') return { ok: false, grund: 'muss ja oder nein sein' }
      // Manche Schalter stehen als "0"/"1" in der Datei.
      if (typeof alt === 'string') return { ok: true, wert: roh ? '1' : '0' }
      return { ok: true, wert: roh }
    }
    case 'zahl': {
      // ── GANZE ZAHL, AUCH WENN EINE ZAHL ANKOMMT ─────────────────────────
      //
      // Hier stand `typeof roh === 'number' ? roh : parseInt(...)`, und darin
      // lag eine Unwucht: eine ZEICHENKETTE "2.25" wurde von parseInt auf 2
      // gekuerzt, eine ZAHL 2.25 ging UNVERAENDERT durch. Derselbe Wert, zwei
      // Ergebnisse — je nachdem, wie die Oberflaeche ihn schickt.
      //
      // WAS DARAN HAENGT: `timeout.pressDelay` landet so als "2.25" in der
      // Konfiguration, und scripts/OnOffShim/off_trigger.sh zaehlt damit
      // `for ((i=0; i<2.25; i++))`. Bash bricht das mit "Ungueltiger
      // arithmetischer Operator" ab — BEVOR ein einziges Mal geprueft wird,
      // ob die Taste noch gedrueckt ist. `button_held` steht da schon auf
      // true, also faehrt die Box beim kuerzesten Antippen herunter. Genau so
      // konnte der 0,25-Schieber der alten mupi.php Boxen lahmlegen.
      //
      // Kein Feld dieser Tabelle meint je eine Kommazahl: Prozente, Sekunden,
      // Minuten, Grad, Megabyte. Abgeschnitten wird wie bei parseInt (zur Null
      // hin), damit beide Wege dasselbe ergeben.
      const roh_n = typeof roh === 'number' ? roh : Number.parseInt(String(roh ?? ''), 10)
      const n = Number.isFinite(roh_n) ? Math.trunc(roh_n) : roh_n
      if (!Number.isFinite(n)) return { ok: false, grund: 'keine Zahl' }
      if (feld.min !== undefined && n < feld.min) return { ok: false, grund: `kleiner als ${feld.min}` }
      if (feld.max !== undefined && n > feld.max) return { ok: false, grund: `größer als ${feld.max}` }
      return { ok: true, wert: typeof alt === 'number' ? n : String(n) }
    }
    case 'geheim': {
      // Leer heisst hier ausdrücklich LÖSCHEN — nicht „unverändert".
      // Unverändert wird gar nicht erst geschickt (die Oberfläche sendet
      // das Feld nur, wenn jemand etwas eingetippt hat).
      if (typeof roh !== 'string') return { ok: false, grund: 'kein Text' }
      const t = roh.trim()
      if (t.length > 500) return { ok: false, grund: 'zu lang' }
      // biome-ignore lint/suspicious/noControlCharactersInRegex: genau die sollen raus
      if (/[\u0000-\u001f\u007f]/.test(t)) return { ok: false, grund: 'enthält Steuerzeichen' }
      return { ok: true, wert: t }
    }
    case 'url':
      return pruefeUrl(roh)
    case 'text': {
      if (typeof roh !== 'string') return { ok: false, grund: 'kein Text' }
      const t = roh.trim()
      if (t.length === 0 && !feld.leerErlaubt) return { ok: false, grund: 'leer' }
      if (t.length > 64) return { ok: false, grund: 'länger als 64 Zeichen' }
      // biome-ignore lint/suspicious/noControlCharactersInRegex: genau die sollen raus
      if (/[\u0000-\u001f\u007f]/.test(t)) return { ok: false, grund: 'enthält Steuerzeichen' }
      return { ok: true, wert: t }
    }
    default:
      return { ok: false, grund: 'unbekannte Feldart' }
  }
}

/**
 * Eine Server-Adresse prüfen. Pure.
 *
 * Nur http/https, kein Schrägstrich am Ende (der Jellyfin-Aufruf hängt seinen
 * eigenen Pfad an — mit doppeltem Schrägstrich antworten manche Server 404).
 * Leer ist erlaubt und heißt „nicht eingerichtet".
 */
export function pruefeUrl(roh: unknown): Pruefung {
  if (typeof roh !== 'string') return { ok: false, grund: 'kein Text' }
  const t = roh.trim().replace(/\/+$/, '')
  if (t === '') return { ok: true, wert: '' }
  if (t.length > 255) return { ok: false, grund: 'zu lang' }
  let u: URL
  try {
    u = new URL(t)
  } catch {
    return { ok: false, grund: 'keine gültige Adresse (mit http:// oder https://)' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, grund: 'nur http:// oder https://' }
  return { ok: true, wert: t }
}

/** Prüfen, ob ein Auswahlwert in der zugehörigen Liste steht. Pure. */
export function pruefeAuswahl(feld: Feld, roh: unknown, liste: Auswahl[]): Pruefung {
  if (typeof roh !== 'string') return { ok: false, grund: 'kein Text' }
  if (!liste.some((a) => a.wert === roh)) return { ok: false, grund: 'steht nicht zur Auswahl' }
  return { ok: true, wert: roh }
}

/**
 * Wert setzen — ohne die Vorlage zu verändern. Pure.
 *
 * Gibt eine neue Konfiguration zurück; die alte bleibt unangetastet, damit ein
 * Fehlschlag auf halbem Weg nichts hinterlässt.
 */
export function setzeWert(konfig: Record<string, unknown>, feld: Feld, wert: unknown): Record<string, unknown> {
  if (feld.pfad.length === 1) return { ...konfig, [feld.pfad[0]]: wert }
  const [g, k] = feld.pfad
  const gruppe = { ...((konfig[g] as Record<string, unknown>) ?? {}) }
  gruppe[k] = wert
  return { ...konfig, [g]: gruppe }
}

/**
 * Darf diese Konfiguration geschrieben werden? Pure.
 *
 * Die Frage ist nicht „ist sie schön", sondern „läuft die Box danach noch".
 * Was hier durchfällt, wird NICHT geschrieben — auch nicht auf Wunsch. Eine
 * Oberfläche, mit der man sich selbst aussperren kann, ist keine Bedienung,
 * sondern eine Falle.
 */
export function pruefeKonfig(konfig: unknown): Pruefung {
  if (!konfig || typeof konfig !== 'object' || Array.isArray(konfig)) return { ok: false, grund: 'keine Konfiguration' }
  const k = konfig as Record<string, unknown>

  const anmeldung = k['interfacelogin'] as Record<string, unknown> | undefined
  if (!anmeldung || typeof anmeldung !== 'object')
    return { ok: false, grund: 'interfacelogin fehlt — die Verwaltung wäre nicht mehr erreichbar' }

  // Anmeldung EIN ohne Passwort = ausgesperrt. Das ist der eine Fall, in dem
  // ein an sich gültiger Wert die Box unbedienbar macht.
  const an = anmeldung['state'] === true || anmeldung['state'] === '1'
  const hash = typeof anmeldung['password'] === 'string' ? anmeldung['password'] : ''
  if (an && hash.length === 0)
    return {
      ok: false,
      grund: 'Anmeldung eingeschaltet, aber kein Passwort gesetzt — niemand käme mehr herein',
    }

  const box = k['mupibox'] as Record<string, unknown> | undefined
  if (!box || typeof box !== 'object') return { ok: false, grund: 'mupibox fehlt' }
  if (typeof box['audioDevice'] !== 'string' || box['audioDevice'] === '')
    return { ok: false, grund: 'audioDevice fehlt — die Box hätte keinen Ton' }

  // Sperre auf „pin" ohne gesetzte PIN = ausgesperrt. Dieselbe Falle wie
  // „Anmeldung an ohne Passwort" oben, nur eine Etage tiefer: die Prüfung
  // vergleicht gegen einen leeren Hash und sagt zu JEDER Eingabe nein. Am
  // Bildschirm der Box bliebe dann nur noch „Abbrechen" — und damit wären
  // Einstellungen, WLAN, Bluetooth, Mediendatenbank und Darstellung von der
  // Box aus nicht mehr erreichbar. Ausgerechnet das WLAN: wer die Box danach
  // ins Netz bringen müsste, um sie über die Verwaltung wieder aufzuschließen,
  // käme genau da nicht mehr hin. Erst die PIN setzen, dann umschalten.
  if (
    String(box['einstellungssperre'] ?? '')
      .trim()
      .toLowerCase() === 'pin'
  ) {
    const pin = typeof box['einstellungsPin'] === 'string' ? box['einstellungsPin'] : ''
    if (pin.length === 0)
      return {
        ok: false,
        grund: 'Sperre auf „PIN" gestellt, aber keine PIN gesetzt — die Box käme in keine Einstellung mehr',
      }
  }

  const zahl = (x: unknown): number => Number.parseInt(String(x ?? ''), 10)
  const start = zahl(box['startVolume'])
  const max = zahl(box['maxVolume'])
  if (Number.isFinite(start) && Number.isFinite(max) && start > max)
    return { ok: false, grund: 'Startlautstärke liegt über der Höchstlautstärke' }

  // Die Lüfterstufen müssen aufsteigen. Stünde 50 % über 75 %, liefe der
  // Lüfter bei mittlerer Wärme voll und bei hoher gar nicht — die Regelung
  // stünde auf dem Kopf, ohne dass es jemand am Verhalten sofort merkt.
  const luefter = k['fan'] as Record<string, unknown> | undefined
  if (luefter && typeof luefter === 'object') {
    const stufen: [string, number][] = [
      ['25 %', zahl(luefter['fan_temp_25'])],
      ['50 %', zahl(luefter['fan_temp_50'])],
      ['75 %', zahl(luefter['fan_temp_75'])],
      ['100 %', zahl(luefter['fan_temp_100'])],
    ].filter(([, v]) => Number.isFinite(v)) as [string, number][]
    for (let i = 1; i < stufen.length; i++) {
      if (stufen[i][1] <= stufen[i - 1][1])
        return {
          ok: false,
          grund: `Lüfterstufen müssen ansteigen: ${stufen[i][0]} liegt nicht über ${stufen[i - 1][0]}`,
        }
    }
  }

  // Die gedimmte Helligkeit des Einschaltknopfs darf die normale nicht
  // übersteigen. Sonst leuchtet der Knopf HELLER, sobald der Bildschirm
  // ausgeht — genau verkehrt herum, und im dunklen Zimmer fällt es erst auf,
  // wenn das Kind schon liegt. Am Wert selbst ist der Dreher nicht zu sehen:
  // beide Zahlen sind für sich gültig.
  const knopf = k['shim'] as Record<string, unknown> | undefined
  if (knopf && typeof knopf === 'object') {
    const hell = zahl(knopf['ledBrightnessMax'])
    const gedimmt = zahl(knopf['ledBrightnessMin'])
    if (Number.isFinite(hell) && Number.isFinite(gedimmt) && gedimmt > hell)
      return {
        ok: false,
        grund: 'Der Knopf wäre gedimmt heller als normal — die gedimmte Helligkeit muss kleiner sein',
      }
  }

  return { ok: true }
}

export interface Unterschied {
  id: string
  titel: string
  vorher: unknown
  nachher: unknown
  neustart: boolean
}

/**
 * Was würde sich ändern? Pure.
 *
 * Damit die Oberfläche VOR dem Speichern zeigen kann, was passiert — und
 * hinterher sagen kann, was ein Neustart braucht.
 */
export function unterschiede(alt: Record<string, unknown>, neu: Record<string, unknown>): Unterschied[] {
  const raus: Unterschied[] = []
  for (const f of FELDER) {
    const a = holeWert(alt, f)
    const b = holeWert(neu, f)
    if (a === b) continue
    raus.push({ id: f.id, titel: f.titel, vorher: a, nachher: b, neustart: f.neustart === true })
  }
  return raus
}

/** Kürzestes zulässiges Verwaltungspasswort. */
export const PASSWORT_MIN = 6

/**
 * Ein neues Verwaltungspasswort prüfen. Pure — das HASHEN passiert außerhalb.
 *
 * Warum es das überhaupt gibt: `pruefeKonfig` verweigert „Anmeldung an ohne
 * Passwort". Ohne einen Weg, ein Passwort zu SETZEN, wäre das eine Sackgasse —
 * man könnte die Anmeldung nie einschalten. Die Sperre und dieser Weg gehören
 * zusammen.
 */
export function pruefePasswort(roh: unknown): Pruefung {
  if (typeof roh !== 'string') return { ok: false, grund: 'kein Text' }
  if (roh.length < PASSWORT_MIN) return { ok: false, grund: `mindestens ${PASSWORT_MIN} Zeichen` }
  if (roh.length > 200) return { ok: false, grund: 'zu lang' }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: genau die sollen raus
  if (/[\u0000-\u001f\u007f]/.test(roh)) return { ok: false, grund: 'enthält Steuerzeichen' }
  return { ok: true, wert: roh }
}

/** Kürzeste und längste PIN vor den Einstellungen der Box. */
export const PIN_MIN = 4
export const PIN_MAX = 8

/**
 * Eine neue Einstellungs-PIN prüfen. Pure — das HASHEN passiert außerhalb.
 *
 * NUR ZIFFERN, und das ist keine Bequemlichkeit: eingegeben wird diese PIN am
 * Bildschirm der Box, und dort gibt es keine Systemtastatur. Der Sperrdialog
 * bringt ein eigenes Ziffernfeld mit (0–9, Löschen, Bestätigen). Eine PIN mit
 * Buchstaben ließe sich setzen, aber nie wieder eingeben — die Sperre wäre
 * dann keine Sperre, sondern eine Mauer.
 *
 * Leer heißt LÖSCHEN. Ohne diesen Weg gäbe es kein Zurück zu „keine PIN".
 */
export function pruefeEinstellungsPin(roh: unknown): Pruefung {
  if (typeof roh !== 'string') return { ok: false, grund: 'kein Text' }
  if (roh === '') return { ok: true, wert: '' }
  if (!/^[0-9]+$/.test(roh)) return { ok: false, grund: 'nur Ziffern' }
  if (roh.length < PIN_MIN || roh.length > PIN_MAX) return { ok: false, grund: `${PIN_MIN} bis ${PIN_MAX} Ziffern` }
  return { ok: true, wert: roh }
}

/**
 * Was die Oberfläche über ein Feld erfahren darf. Pure.
 *
 * Der Punkt sind die GEHEIMNISSE: Jellyfins API-Schlüssel und Spotifys Token
 * sind Zugangsdaten. Sie werden nie mitgeschickt — die Oberfläche erfährt
 * ausschließlich, OB etwas hinterlegt ist. Sonst stünde der Schlüssel im
 * Browser, im Verlauf, im Zwischenspeicher und in jedem Mitschnitt.
 */
export function feldNachAussen(konfig: unknown, feld: Feld): { wert?: unknown; gesetzt?: boolean } {
  if (feld.art === 'geheim') {
    const w = holeWert(konfig, feld)
    return { gesetzt: typeof w === 'string' && w.length > 0 }
  }
  return { wert: holeWertOderStandard(konfig, feld) }
}

/**
 * Alle Werte, die niemals aus dem Backend hinausgehen dürfen. Pure.
 *
 * Gebraucht für /api/config: der Weg liefert die GANZE Konfigurationsdatei
 * aus — samt Passwort-Hash, Spotify-Token und Jellyfin-Schlüssel. Sein
 * einziger Verbraucher (media-cache.service.ts) liest daraus genau ein Feld.
 */
export function ohneGeheimnisse(konfig: unknown): unknown {
  if (!konfig || typeof konfig !== 'object' || Array.isArray(konfig)) return konfig
  const k = { ...(konfig as Record<string, unknown>) }
  const streichen: [string, string[]][] = [
    ['interfacelogin', ['password']],
    // Die PIN vor den Einstellungen. Sie steht als bcrypt-Hash in derselben
    // Gruppe, die das Box-Frontend ohnehin ausliest (mupibox) — ohne diesen
    // Strich läge sie in jedem Kiosk-Browser und in jedem Mitschnitt. Ein
    // Hash ist kein Klartext, aber vier Ziffern sind aus einem Hash in
    // Sekunden zurückgerechnet. Das Frontend braucht aus dieser Gruppe
    // ausschließlich `einstellungssperre`, nie die PIN selbst.
    ['mupibox', ['einstellungsPin']],
    [
      'spotify',
      [
        'clientSecret',
        'accessToken',
        'refreshToken',
        'username',
        'password',
        'soloistApiKey',
        'soloistApiKeyMitschnitt',
      ],
    ],
    ['jellyfin', ['apiKey']],
    ['telegram', ['token']],
    // DIE GEGENRICHTUNG HAT EIGENE GEHEIMNISSE. Zwei Zugangstoken, mit denen
    // jemand im Namen der Box lesen und schreiben koennte — sie gehen
    // denselben Weg wie der Telegram-Token darueber.
    ['nachrichten', ['matrixToken', 'telegramToken']],
    ['mqtt', ['password']],
  ]
  for (const [gruppe, schluessel] of streichen) {
    const g = k[gruppe]
    if (!g || typeof g !== 'object') continue
    const kopie = { ...(g as Record<string, unknown>) }
    for (const sch of schluessel) {
      // Nicht löschen, sondern leeren: die FORM bleibt gleich, damit nichts
      // stolpert, das die Felder erwartet — nur der Inhalt ist weg.
      if (sch in kopie) kopie[sch] = ''
    }
    k[gruppe] = kopie
  }
  // DIE ERLAUBNISLISTE IST KEIN SCHLUESSEL, SONDERN EINE LISTE — und die
  // Schleife oben kennt nur Zeichenketten-Felder. Sie faende sie nie, dabei
  // stehen darin die Matrix-IDs und Telefonnummern der Eltern. /api/config
  // liest jeder Kiosk-Browser; dieselbe Falle wie bei den Strom-Schluesseln
  // darunter. Leeren, nicht loeschen: die Listenform bleibt.
  const na = k['nachrichten']
  if (na && typeof na === 'object' && !Array.isArray(na)) {
    const kopie = { ...(na as Record<string, unknown>) }
    if (Array.isArray(kopie.erlaubt)) kopie.erlaubt = []
    k['nachrichten'] = kopie
  }

  // DIE STROM-SCHLUESSEL (spak_) LIEGEN IN EINER LISTE, nicht flach in der
  // Gruppe — die Schleife oben erreicht sie nie. Bis 22.08.2026 gingen sie
  // deshalb über /api/config im Klartext an jeden Kiosk-Browser hinaus,
  // während /api/stroeme sie mühsam maskiert. Gleiche Regel wie oben:
  // leeren, nicht löschen — die Listenform bleibt.
  const sp = k['spotify']
  if (sp && typeof sp === 'object' && Array.isArray((sp as Record<string, unknown>).stroeme)) {
    const kopie = { ...(sp as Record<string, unknown>) }
    kopie.stroeme = (kopie.stroeme as unknown[]).map((s) =>
      s && typeof s === 'object' && 'schluessel' in (s as Record<string, unknown>)
        ? { ...(s as Record<string, unknown>), schluessel: '' }
        : s,
    )
    k['spotify'] = kopie
  }
  return k
}
