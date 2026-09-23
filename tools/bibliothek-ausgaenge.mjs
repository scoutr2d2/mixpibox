#!/usr/bin/env node
/**
 * WO VERLAESST DIE BIBLIOTHEK DEN SERVER — jede Stelle, einmal aufgeschrieben.
 *
 * ── DIE FRAGE, DIE DIESES WERKZEUG BEANTWORTEN SOLL (E18 Stufe 2) ──────────
 * Die Zuweisung „wer sieht welchen Eintrag" darf es nur an EINER Stelle geben.
 * Der BACKLOG sagt das woertlich: „Gefiltert wird im SERVER, nicht in der
 * Oberflaeche … sonst gibt es zwei Antworten auf dieselbe Frage, und die
 * zweite ist ueber einen anderen Weg erreichbar."
 *
 * Nur: WELCHE Stelle? Das laesst sich nicht aus dem Kopf beantworten. Die
 * Bibliothek verlaesst diesen Server heute an 27 Stellen, und sie tun
 * VERSCHIEDENE Dinge — drei Sorten, die nach aussen gleich aussehen:
 *
 *   BOXSICHT     „was steht in der Bibliothek" — die Antwort, die ein Kind
 *                sieht. GENAU DIESE Sorte muss gefiltert werden.
 *   TECHNISCH    liest dieselbe Liste, will aber gar keine Bibliothek: den
 *                Jellyfin-Zugang, ein Cover, die Schluesselbruecke. Wird hier
 *                gefiltert, verliert die Box den Jellyfin-Schluessel in dem
 *                Moment, in dem einem Profil kein Jellyfin-Eintrag gehoert —
 *                und niemand faende den Zusammenhang.
 *   VERWALTUNG   die Elternseite. Sie MUSS alles sehen, sonst kann man nicht
 *                zuweisen, was man nicht sieht.
 *
 * ── WARUM ALS WERKZEUG UND NICHT ALS NOTIZ ────────────────────────────────
 * Weil die Liste WAECHST. `/api/interpreten` und `/api/weiterhoeren` sind erst
 * ein paar Tage alt; beide beantworten „was steht in der Bibliothek" und beide
 * haetten in einer Notiz vom Vortag gefehlt. Genau diese Fehlersorte fuehrt
 * das Wissenspaket unter [[dienstliste-an-fuenf-orten]] und
 * [[drei-orte-eine-anzeige]]: was an N Stellen nachgetragen werden muss, wird
 * irgendwann an einer vergessen, und nichts wird dabei rot.
 *
 * Dieses Werkzeug wird rot. Wer eine neue Stelle einbaut, die die Bibliothek
 * liest, MUSS sie unten einordnen — mit Grund. Der Unterschied zwischen
 * „bewusst ungefiltert" und „vergessen" steht damit aufgeschrieben statt in
 * jemandes Erinnerung.
 *
 * ── WAS ES NICHT TUT ──────────────────────────────────────────────────────
 * Es aendert nichts, fragt kein Netz und keine Box. Es liest Quelltext.
 *
 * AUFRUF
 *   node tools/bibliothek-ausgaenge.mjs             Tabelle, Ende 0/1
 *   node tools/bibliothek-ausgaenge.mjs --pruefen   still, Ende 1 bei Befund
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = 'src/backend-api/src/server.ts'

/**
 * DIE EINSTUFUNGEN — je Umgebung eine, jede mit Grund.
 *
 * Der Schluessel ist die UMGEBUNG (Route oder Funktion), nicht die
 * Zeilennummer: Zeilennummern wandern bei jedem Umbau, die Umgebung nicht.
 *
 *   art: 'boxsicht'   -> muss durch den Filter
 *   art: 'technisch'  -> darf NICHT gefiltert werden
 *   art: 'verwaltung' -> sieht alles, ausdruecklich
 */
const EINSTUFUNG = {
  // ── BOXSICHT: was ein Kind sieht ─────────────────────────────────────────
  'GET /api/data': {
    art: 'boxsicht',
    grund:
      'Die KLASSISCHE Oberflaeche baut ihre ganze Bibliothek hieraus ' +
      '(frontend-box/media.service.ts: fetchMedia -> updateMedia; dazu ' +
      'fetchRawMedia fuer Bearbeiten und Favoritenfenster). Bleibt sie ' +
      'ungefiltert, ist sie der zweite Weg zu allem, was /api/werke wegliesse. ' +
      'ACHTUNG: sie liest die Datei DIREKT (jsonfile.readFile), nicht ueber ' +
      'aktiveMedienLesen() — der Filter erreicht sie also nicht von selbst.',
  },
  'GET /api/werke': {
    art: 'boxsicht',
    grund: 'Die Kacheln der neuen Oberflaeche.',
  },
  'fn sichtbareMedienLesen()': {
    art: 'boxsicht',
    grund:
      'DER GEFILTERTE LESER — die EINE Stelle, an der die Boxsicht entsteht ' +
      '(auswahlFiltern ueber aktiveMedienLesen; Abwaegung im Kopfkommentar der ' +
      'Funktion). /api/interpreten, /api/interpret/:id und /api/weiterhoeren ' +
      'standen frueher einzeln in dieser Liste; seit sie hierueber lesen, ist ' +
      'diese Funktion ihre gemeinsame Einstufung. Wer eine neue Reihe fuer ' +
      'die BOX baut, ruft diese hier — wer fuer die VERWALTUNG baut, ' +
      'aktiveMedienLesen.',
  },
  'fn eintragZurBevorzugtenQuelle()': {
    art: 'boxsicht',
    grund:
      'Sie loest eine ANGETIPPTE Kachel zum Abspielen auf (/inhalt). Ungefiltert waere ein nicht ' +
      'zugewiesenes Werk ueber seinen Schluessel weiter spielbar — der „andere Weg" aus dem BACKLOG.',
  },
  'fn eintraegeInBevorzugung()': {
    art: 'boxsicht',
    grund:
      'DIESELBE ANGETIPPTE KACHEL wie bei eintragZurBevorzugtenQuelle() — nur die ganze ' +
      'Kandidatenreihe fuer den serverseitigen Quellen-Rueckfall in /inhalt statt nur des ' +
      'einen bevorzugten Eintrags. Dieselbe Begruendung gilt unveraendert.',
  },
  'POST /api/spielen': {
    art: 'boxsicht',
    grund:
      'DIE SPIELFUNKTION (E95/V): sie loest das Werk selbst auf und filtert dabei ueber die ' +
      'Profil-Auswahl (auswahlUmZuordnungenErweitern + auswahlFiltern, dieselbe Kette wie ' +
      '/api/werke) — gespielt wird nur, was das aktive Profil sieht. Ungefiltert waere sie ' +
      'der neue „andere Weg": jedes Werk per POST mit rohem Schluessel spielbar.',
  },
  'GET /api/werke/:schluessel/download': {
    art: 'boxsicht',
    grund:
      'DAS ALBUM HINTER EINER KACHEL ALS ZIP (E126, 04.09.2026). Sie loest denselben ' +
      'angetippten Schluessel auf wie /inhalt, gibt aber die DATEIEN heraus — ungefiltert ' +
      'waere sie der „andere Weg" in seiner unangenehmsten Form: nicht nur hoerbar, sondern ' +
      'mitnehmbar. Sie filtert (auswahlFiltern ueber aktiveMedienLesen + auswahlLesen), und ' +
      'zwar VOR dem 404 — ein nicht zugewiesenes Werk ist von einem nicht vorhandenen nicht ' +
      'zu unterscheiden. ' +
      'SIE LIEST SEIT DEM 19.09.2026 sichtbareMedienLesen(). Davor baute sie die Kette von ' +
      'Hand und liess auswahlUmZuordnungenErweitern weg — kein Leck, sondern das Gegenteil: ' +
      'STRENGER als /api/werke. Eine Kachel, die nur ueber eine Hand-Zuordnung sichtbar ist ' +
      '(der Mitschnitt-Fall aus abgleich.ts), stand auf der Box und fiel hier ins 404. Ein ' +
      'Unterschied, den niemand erklaeren kann, ist auf Dauer so teuer wie ein Fehler: was ' +
      'das Kind SIEHT, darf es auch holen — nicht mehr und nicht weniger.',
  },
  // ── DIE FUENF, DIE ERST AM 19.09.2026 SICHTBAR WURDEN ──────────────────
  //
  // Sie lesen alle `sichtbareMedienLesen()` und tun damit das Richtige —
  // genau deshalb kannte die Wache sie nicht: der gefilterte Leser stand
  // nicht in ihrer LESER-Liste. Sie waren nicht „in Ordnung", sie waren
  // UNBEOBACHTET. Ihre Einstufung steht hier nicht, weil an ihnen etwas
  // faul waere, sondern damit ein Umbau, der ihnen den Filter nimmt, auffaellt.
  'GET /api/interpret/:id': {
    art: 'boxsicht',
    grund:
      'DIE WERKE EINES INTERPRETEN. Was unter einem Namen liegt, ist genau das, was dem Kind ' +
      'gehoert — sonst zeigte die Interpretenseite Kacheln, die es auf der Startseite nicht ' +
      'gibt, und das waere der „andere Weg" mit Beschriftung.',
  },
  'GET /api/interpreten': {
    art: 'boxsicht',
    grund:
      'DIE LISTE DER INTERPRETEN. Schon der NAME ist eine Auskunft: ein Interpret, von dem ' +
      'dieses Profil kein Werk hat, gehoert nicht in die Liste. Die Route kennt daneben eine ' +
      'ungefilterte Frage (was Spotify unter dem Namen kennt) — die ist ausdruecklich keine ' +
      'Frage des Kindes und steht im Kommentar daneben.',
  },
  'GET /api/interpretenkennungen': {
    art: 'boxsicht',
    grund:
      'DIE KENNUNGEN ZU DEN NAMEN, fuer die Bildwahl. Sie zieht die Namen aus derselben ' +
      'gefilterten Liste; ungefiltert stuenden hier Kennungen zu Interpreten, die das Profil ' +
      'nicht hat.',
  },
  'fn verlaufMitWerken()': {
    art: 'boxsicht',
    grund:
      'DER VERLAUF, an die heutige Bibliothek gebunden. Er reicht seine Liste an ' +
      'werkSchluesselKarte() weiter — die ist selbst technisch („sie ordnet zu, sie zeigt ' +
      'nichts") und bekommt die Sicht von HIER. Genau dieser Hausbrauch fehlte ' +
      'GET /api/bild/laufend, siehe dort.',
  },
  'GET /api/weiterhoeren': {
    art: 'boxsicht',
    grund:
      'DIE GEMERKTEN STELLEN. Eine Stelle zu einem Werk, das dem Profil nicht gehoert, ist ' +
      'eine Kachel auf der Startseite — der kuerzeste „andere Weg", den es gibt. Nimmt jemand ' +
      'das Werk zurueck in die Auswahl, steht die Stelle wieder da (der Verlauf wird nicht ' +
      'geloescht, nur nicht gezeigt).',
  },

  'GET /api/bild/laufend': {
    art: 'boxsicht',
    grund:
      'DAS BILD ZUM GERADE LAUFENDEN, am <img> des Kinderschirms. Sie baut eine Bruecke ' +
      '<interpretkern>|<albumkern> -> /api/bild/<schluessel> und gibt den Schluessel im ' +
      'Location-Kopf der 302 heraus. Bis zum 19.09.2026 las sie dafuer medienLesen(), den ' +
      'VERWALTUNGS-Leser — als einzige box-seitige Stelle. Gefunden hat es diese Wache; die ' +
      'lange Herleitung steht im TECHNISCH-Abschnitt, wo man die Route zuerst suchen wuerde. ' +
      'Seither sichtbareMedienLesen(). Es MUSS gefiltert bleiben, weil bildFuerLaufendes ' +
      '(laufendes-bild.ts, Schritt 2) auf einen unscharfen Vergleich zurueckfaellt und dafuer ' +
      'die GANZE Karte durchlaeuft — nur Interpretenkern ODER nur Albumkern. Ungefiltert ' +
      'konnte ein Werk, das dem Kind gehoert, auf den Eintrag eines NICHT zugewiesenen ' +
      'fallen: falsches Bild, und ein Schluessel, den dieses Profil nie gewaehlt hat.',
  },
  'fn wahlVorwaermen()': {
    art: 'boxsicht',
    grund:
      'DER WARMHALTER DER E110-WAHL (E118, abends). Nichts von ihm verlaesst den Server — er ' +
      'fuellt nur Merker. Trotzdem BOXSICHT und nicht technisch: er laeuft ueber genau die ' +
      'Kachelliste, die das Kind sieht, um zu entscheiden, WELCHE Werke warm bleiben, und er ' +
      'ruft dafuer eintraegeInBevorzugung() — denselben Aufloeser wie der Tipp. Er fuehrt die ' +
      'volle Kette mit (auswahlUmZuordnungenErweitern + auswahlFiltern ueber ' +
      'aktiveMedienLesen), also dieselbe wie /api/werke. ' +
      'WARUM DAS SO BLEIBEN MUSS: liefe er ungefiltert, holte er im 40-s-Takt Spotify-Listen ' +
      'zu Werken, die kein Profil sieht — und schlimmer, seine Auswahl der „faelligen" Werke ' +
      'liefe auseinander mit der, die der Tipp gleich braucht. Er ist eine VORWEGNAHME der ' +
      'Boxsicht und muss deren Filter teilen, sonst waermt er die falsche Liste.',
  },

  // ── TECHNISCH: dieselbe Liste, andere Frage ──────────────────────────────
  'fn aktiveMedienLesen()': {
    art: 'technisch',
    grund: 'DER LESER SELBST. Er liefert die rohe Liste; der Filter sitzt daneben, nicht darin.',
  },
  'fn werkeStand()': {
    art: 'technisch',
    grund:
      'Nur Anzahl und Aenderungszeit der DATEI — der billige Aenderungstest. ' +
      'ACHTUNG: die Anzahl kommt vom Aufrufer, sie ist also schon gefiltert.',
  },
  'fn eintragZuSchluessel()': {
    art: 'gemischt',
    grund:
      'DER AUFLOESER MIT ZWEI ZWECKEN — siehe die zweite Tabelle. Er bedient das COVER (technisch) ' +
      'UND den Inhalt hinter einer Kachel (Boxsicht). Eine Einstufung fuer beides gibt es nicht; ' +
      'er muss geteilt werden, sonst hat die Zuweisung keine eine Stelle.',
  },
  'fn werkSchluesselKarte()': {
    art: 'technisch',
    grund: 'Die Bruecke Angular-Schluessel -> Werk-Schluessel. Sie ordnet zu, sie zeigt nichts.',
  },
  // `GET /api/werke/:schluessel/inhalt`, `fn jellyfinArt()` und
  // `fn titelEinesWerks()` standen hier als „technisch: fischen nur den
  // Jellyfin-Zugang aus der Liste". Sie LESEN die Liste inzwischen nicht mehr
  // selbst — der Zugang kommt zentral —, und eine Einstufung ohne Stelle ist
  // eine Behauptung ueber gestern. Entfernt am 29.08.2026, die Wache selbst
  // hat es gemeldet.
  'GET /api/bild/:schluessel': {
    art: 'technisch',
    grund: 'Jellyfin-Zugang fuer ein Cover.',
  },
  // ── `GET /api/bild/laufend` — DER FUND DIESER WACHE, am 19.09.2026 behoben ──
  //
  // Sie SIEHT technisch aus — eine Coverroute neben den anderen —, und genau
  // deshalb waere eine Zeile im TECHNISCH-Abschnitt der bequeme Fehler
  // gewesen. Sie ist BOXSICHT, und sie war UNGEFILTERT. Die Einstufung steht
  // jetzt unten bei den boxsicht-Stellen; hier bleibt stehen, WARUM — denn
  // die Herleitung ist das Wertvolle, nicht das Wort „boxsicht".
  //
  // WAS SIE TUT: Sie haengt an einem <img> im KINDERSCHIRM (NewDesign/app.js:
  // 27799) und baut aus `medienLesen()` eine Bruecke
  // `<interpretkern>|<albumkern>` -> `/api/bild/<schluessel>`, um daraus das
  // Bild zum gerade Laufenden zu bestimmen.
  //
  // DREI GRUENDE, WARUM DAS NICHT TECHNISCH IST:
  //
  //   1. FALSCHER LESER. `medienLesen()` ist der VERWALTUNGS-Leser auf
  //      data.json. In der Tabelle oben steht er sonst AUSSCHLIESSLICH unter
  //      VERWALTUNG. Jeder box-seitige Ausgang liest `aktiveMedienLesen()` —
  //      und `aktiveMedienLesen()` sagt im eigenen Kopfkommentar, warum:
  //      offline ist active_data.json eine ANDERE, kuerzere Liste. Diese Route
  //      ist die erste box-seitige, die daran vorbeigreift.
  //   2. SIE GIBT DEN SCHLUESSEL HERAUS. Die Einstufung von
  //      `GET /api/bild/:schluessel` als technisch traegt auf dem Satz „Wer den
  //      Schluessel hat, hat die Kachel schon gesehen." Diese Route ist genau
  //      die, die diesen Satz aufhebt: der Werkschluessel steht im Location-Kopf
  //      der 302, und zwar der eines Eintrags, den das Profil nicht gewaehlt
  //      haben muss. Solange `eintragZuSchluessel()` und
  //      `eintragZurBevorzugtenQuelle()` selbst noch ungefiltert lesen, ist ein
  //      Schluessel mehr wert als ein Bild.
  //   3. UNSCHARFER TREFFER UEBER DIE GANZE LISTE. `bildFuerLaufendes`
  //      (laufendes-bild.ts, Schritt 2) laeuft bei Bedarf die GESAMTE Karte
  //      durch und vergleicht nur den Interpretenkern ODER nur den Albumkern.
  //      Damit kann schon ein zugewiesenes Werk auf den Eintrag eines NICHT
  //      zugewiesenen fallen — die Schluessel-Kollision aus
  //      [[medienschluessel-kollision-gleiche-playlistid]] genuegt.
  //
  // UND DER TECHNISCH-TEST FAELLT NEGATIV AUS: Technisch ist eine Stelle, die
  // beim Filtern etwas verliert, das der BOX gehoert und nicht dem Kind (so
  // `jellyfinZugangAusListe`, so die Verwaltungsseite hinter
  // `/api/bild/:schluessel`). Hier verliert das Filtern NICHTS: die Karte wird
  // nur bei LOKALER Wiedergabe befragt, und fuer jedes Werk, das dem Kind
  // gehoert, bleibt der Treffer derselbe. Es faellt genau der Fall weg, den es
  // nicht geben soll.
  //
  // DIE BEHEBUNG WAR EINE ZEILE, und sie lag in server.ts und nicht hier:
  // `medienLesen()` -> `sichtbareMedienLesen()`. Dieselbe Bauart benutzt
  // `werkSchluesselKarte()` bereits — es ist selbst technisch („sie ordnet zu,
  // sie zeigt nichts"), bekommt aber an server.ts:17086 die GEFILTERTE Liste
  // gereicht. Das ist der Hausbrauch; diese Route hat ihn nicht mitbekommen,
  // weil sie am 11.09.2026 fuer eine ganz andere Frage entstand
  // ([oberflaeche-kennt-keine-dienste]) und der Filter aus E18 vom 05.08.2026
  // stammt. Genau diese Fehlersorte ist der Daseinsgrund dieser Wache.
  'GET /api/bild/jellyfin/:kennung': {
    art: 'technisch',
    grund: 'Jellyfin-Zugang fuer ein Cover.',
  },
  'GET /api/jellyfin/strom/:kennung': {
    art: 'technisch',
    grund: 'Jellyfin-Zugang fuer den Tonstrom.',
  },
  'fn ensureTlsCert()': {
    art: 'technisch',
    grund: 'Kein Lesen — hier steht nur der Dateiname (const activedataFile).',
  },

  // ── VERWALTUNG: sieht alles, mit Absicht ─────────────────────────────────
  'fn medienAendern()': {
    art: 'verwaltung',
    grund: 'Schreibweg auf data.json. Wer aendert, muss die ganze Liste in der Hand haben.',
  },
  'GET /api/medien': {
    art: 'verwaltung',
    grund: 'Die Bibliothek in der Elternseite. HIER wird zugewiesen — ungefiltert ist Bedingung.',
  },
  'POST /api/profil/auswahl/werk': {
    art: 'verwaltung',
    grund:
      'Der Schreibweg der Zuweisung (ein Werk an/aus je Profil). Er liest den Bestand nur, ' +
      'um „sieht alles" beim ersten Einsperren in eine explizite Liste umzumuenzen.',
  },
  'GET /api/medien/:schluessel/andere': {
    art: 'verwaltung',
    grund: 'Gibt es das auch woanders? Eine Frage der Verwaltung.',
  },
  'fn dienstSuche()': {
    art: 'verwaltung',
    grund: '„schon da?" beim Suchen. Ein Eintrag ist auch dann schon da, wenn er niemandem zugewiesen ist.',
  },
  'fn verschmelzungAbgleichen()': {
    art: 'verwaltung',
    grund: 'Der Abgleich laeuft auf data.json und ist eine Frage der Verwaltung.',
  },
  'GET /api/verschmelzung': {
    art: 'verwaltung',
    grund: 'Die Namen zu den Schluesseln in der Verwaltung.',
  },
  'fn aufraeumKandidaten()': {
    art: 'verwaltung',
    grund: 'Beim Anbieter geloescht — betrifft den Eintrag, nicht seinen Besitzer.',
  },
  'fn doppelteEintraege()': {
    art: 'verwaltung',
    grund: 'Mehrdeutige Schluessel, mit Zeilennummer. Eine Frage an die ganze Datei.',
  },
}

/**
 * DIE AUFLOESER — der zweite, INDIREKTE Ausgang.
 *
 * Zwei Funktionen holen aus der Liste EINEN Eintrag zu einem Schluessel. Wer
 * nur die Leser der ganzen Liste zaehlt, uebersieht sie: sie stehen je einmal
 * in der Tabelle oben, bedienen aber FUENF Aufrufer mit VERSCHIEDENEN Zwecken.
 * Ein Cover ist harmlos; „was steckt hinter dieser Kachel" ist die Zuweisung
 * selbst. Deshalb bekommt jeder AUFRUFER hier seine eigene Einordnung.
 */
const AUFLOESER = ['eintragZuSchluessel', 'eintragZurBevorzugtenQuelle']

const AUFLOESER_EINSTUFUNG = {
  'GET /api/werke/:schluessel/alben': {
    art: 'boxsicht',
    grund: 'Die Alben hinter einer Playlist-Kachel — Inhalt, nicht Bild.',
  },
  'GET /api/werke/:schluessel/inhalt': {
    art: 'boxsicht',
    grund:
      'Die Titel hinter einer Kachel. ACHTUNG: OHNE `verschmelzen=1` (die Vorgabe!) laeuft diese ' +
      'Route ueber eintragZuSchluessel, nicht ueber eintragZurBevorzugtenQuelle.',
  },
  'GET /api/bild/:schluessel': {
    art: 'technisch',
    grund: 'Das Cover. Wer den Schluessel hat, hat die Kachel schon gesehen.',
  },
  'POST /api/gespielt': {
    art: 'technisch',
    grund:
      'Meldet, was GESPIELT WURDE. Der Verlauf liegt ohnehin je Profil; hier zu filtern hiesse, ' +
      'eine Meldung zu verschlucken statt eine Anzeige zu ordnen.',
  },
  'POST /api/weiterhoeren': {
    art: 'technisch',
    grund: 'Merkt sich eine Stelle. Dieselbe Begruendung wie bei /api/gespielt.',
  },
  'fn spielVersuch()': {
    art: 'boxsicht',
    grund:
      'EIN Versuch der Spielfunktion mit EINER Quelle (E95/V): loest die angetippte Kachel ' +
      'ueber eintragZurBevorzugtenQuelle zum Abspielen auf — dieselbe /inhalt-Bauart, derselbe ' +
      'Grund. Die Profil-Sicht hat der Aufrufer (POST /api/spielen) bereits geprueft; hier ' +
      'wird nur der Roheintrag zur schon freigegebenen Kachel geholt.',
  },
}

/**
 * Die Muster, an denen ein Lesen der Bibliothek zu erkennen ist.
 *
 * `gefiltert` sagt, ob dieser Leser die Boxsicht SCHON mitbringt. Daran
 * haengt die Pruefung weiter unten — und `sichtbareMedienLesen` fehlte hier
 * bis zum 19.09.2026 ganz:
 *
 * WAS DAS BEDEUTETE, und es ist die unangenehmere Haelfte des Fundes von
 * heute: Wer eine boxsicht-Stelle vom rohen `medienLesen()` auf den
 * RICHTIGEN Leser umstellte, liess sie damit aus dieser Wache VERSCHWINDEN.
 * Aus einem eingeordneten Ausgang wurde ein unsichtbarer. Das Richtige zu
 * tun machte blind — die schlechteste Eigenschaft, die eine Wache haben
 * kann.
 */
const LESER = [
  { name: 'sichtbareMedienLesen', muster: /\bsichtbareMedienLesen\s*\(/, gefiltert: true },
  { name: 'aktiveMedienLesen', muster: /\baktiveMedienLesen\s*\(/, gefiltert: false },
  { name: 'medienLesen', muster: /(?<![A-Za-z])medienLesen\s*\(/, gefiltert: false },
  { name: 'activedataFile', muster: /\bactivedataFile\b/, gefiltert: false },
]

/** Die Zeile, in der eine Funktion oder Route DEFINIERT wird — keine Fundstelle. */
function istDefinition(zeile) {
  return /^\s*(export\s+)?(async\s+)?function\s+(sichtbareMedienLesen|aktiveMedienLesen|medienLesen)\b/.test(zeile)
}

/**
 * EIN KOMMENTAR IST KEINE FUNDSTELLE [[kommentar-und-kompilat-sind-keine-gegenstelle]].
 *
 * Am 19.09.2026 hing genau daran ein Fehlurteil: die Route
 * `GET /api/bild/laufend` war auf `sichtbareMedienLesen()` umgestellt, und
 * die Wache fand sie trotzdem — nicht am Aufruf, sondern an dem KOMMENTAR,
 * der die alte Fassung zitiert. Die Zeile stimmte, die Begruendung war
 * falsch, und wer nachschlaegt, hoert auf zu glauben. Eine Wache, die
 * Prosa mitzaehlt, ist auf beide Arten unbrauchbar: sie erfindet Stellen
 * und sie verdeckt, dass eine echte weggefallen ist.
 *
 * GROB UND MIT ABSICHT: Zeilen, die mit `//` oder `*` beginnen. Ein echter
 * Aufruf steht in dieser Datei nie hinter einem `//` am Zeilenanfang, und
 * ein vollstaendiger Blockkommentar-Zaehler waere mehr Maschine, als die
 * Frage wert ist.
 */
function istKommentar(zeile) {
  return /^\s*(\/\/|\*|\/\*)/.test(zeile)
}

/** Wozu gehoert diese Zeile? Rueckwaerts bis zur naechsten Route oder Funktion. */
function umgebungVon(zeilen, nr) {
  for (let j = nr - 1; j >= 0; j--) {
    const s = zeilen[j]
    const route = /^\s*app\.(get|post|put|delete|use)\(\s*['"`]([^'"`]+)/.exec(s)
    if (route) return `${route[1].toUpperCase()} ${route[2]}`
    const fn = /^(?:export )?(?:async )?function (\w+)/.exec(s)
    if (fn) return `fn ${fn[1]}()`
    const konst = /^(?:export )?const (\w+) = async/.exec(s)
    if (konst) return `fn ${konst[1]}()`
  }
  return '(Dateikopf)'
}

function sammeln(zeilen) {
  const funde = []
  zeilen.forEach((z, i) => {
    if (istDefinition(z) || istKommentar(z)) return
    for (const l of LESER) {
      if (!l.muster.test(z)) continue
      funde.push({ nr: i + 1, leser: l.name, gefiltert: l.gefiltert, umgebung: umgebungVon(zeilen, i), text: z.trim() })
      break
    }
  })
  return funde
}

/** Die AUFRUFER der beiden Aufloeser — ohne ihre Definitionszeilen. */
function aufloeserSammeln(zeilen) {
  const funde = []
  zeilen.forEach((z, i) => {
    for (const name of AUFLOESER) {
      if (!new RegExp(`\\b${name}\\s*\\(`).test(z)) continue
      // Die Definition ist kein Aufruf.
      if (new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${name}\\b`).test(z)) continue
      funde.push({ nr: i + 1, aufloeser: name, umgebung: umgebungVon(zeilen, i) })
      break
    }
  })
  return funde
}

/** Fundstellen zu Umgebungen zusammenfassen — je Umgebung EINE Entscheidung. */
function jeUmgebungFassen(funde) {
  const karte = new Map()
  for (const f of funde) {
    const b = karte.get(f.umgebung) ?? { umgebung: f.umgebung, stellen: [], leser: [] }
    b.stellen.push(f.nr)
    if (f.leser) b.leser.push({ name: f.leser, gefiltert: f.gefiltert, nr: f.nr })
    karte.set(f.umgebung, b)
  }
  return karte
}

/** Eine Tabelle ausgeben und sagen, was fehlt. */
function tabelle(titel, karte, einstufung, still) {
  const unbekannt = [...karte.values()].filter((b) => !einstufung[b.umgebung])
  // Eine Einstufung, die auf nichts zeigt, ist eine Behauptung ueber eine
  // Stelle von gestern — genauso schlimm wie eine fehlende.
  const verwaist = Object.keys(einstufung).filter((k) => !karte.has(k))
  const boxsicht = [...karte.values()].filter((b) => einstufung[b.umgebung]?.art === 'boxsicht')

  // ── DIE EINSTUFUNG IST EINE BEHAUPTUNG — HIER WIRD SIE GEPRUEFT ─────────
  //
  // BIS ZUM 19.09.2026 TAT DAS NIEMAND. Diese Wache verlangte fuer jede
  // Stelle eine Einordnung und zaehlte am Ende „BOXSICHT: n — sie alle
  // brauchen den Filter". Ob sie ihn HABEN, hat sie nie gefragt. Die
  // Gegenprobe machte es sichtbar: `GET /api/bild/laufend` auf den rohen
  // `medienLesen()` zurueckgedreht — die Wache blieb gruen. Eine Gegenprobe,
  // die gruen bleibt, IST der Fund [[gegenprobe-bleibt-gruen-ist-der-fund]].
  //
  // DIE REGEL, und sie ist bewusst die engste, die trotzdem beisst: In einer
  // boxsicht-Stelle darf der ROHE Verwaltungsleser `medienLesen()` nicht
  // vorkommen. Er liest data.json ohne jeden Filter; jede Boxsicht-Stelle
  // nimmt entweder `sichtbareMedienLesen()` oder baut die Kette selbst aus
  // `aktiveMedienLesen()` + `auswahlFiltern`. Was davon richtig ist, sagt
  // die Einstufung im Text; was falsch ist, sagt diese Zeile.
  //
  // WARUM NICHT STRENGER („jede boxsicht-Stelle MUSS gefiltert lesen"):
  // Stellen wie `fn spielVersuch()` bekommen die Freigabe vom AUFRUFER und
  // holen hier nur noch den Roheintrag — das ist begruendet und steht so in
  // ihrer Einstufung. Eine Regel, die sie mitroet, waere in einer Woche
  // abgeschaltet [[dauerrote-wache-ist-keine]].
  const rohInBoxsicht = boxsicht.flatMap((b) =>
    (b.leser ?? []).filter((l) => l.name === 'medienLesen').map((l) => ({ umgebung: b.umgebung, nr: l.nr })),
  )

  // STILL heisst: kein gruener Laerm. Ein BEFUND wird trotzdem genannt —
  // ein Waechter, der rot wird und schweigt, laesst den Leser raten (genau
  // so am 13.08.2026 in der Pruefkette: Exit 1 ohne ein einziges Wort).
  if (still && (unbekannt.length || verwaist.length || rohInBoxsicht.length)) {
    if (rohInBoxsicht.length) {
      console.log(`${titel}: ROHER LESER IN EINER BOXSICHT-STELLE —`)
      for (const r of rohInBoxsicht) console.log(`  ${r.umgebung}  Z. ${r.nr}  liest medienLesen() ungefiltert`)
    }
    if (unbekannt.length) {
      console.log(`${titel}: NICHT EINGEORDNET —`)
      for (const b of unbekannt) console.log(`  ${b.umgebung}  Z. ${b.stellen.join(', ')}`)
    }
    if (verwaist.length) {
      console.log(`${titel}: EINSTUFUNG OHNE STELLE —`)
      for (const k of verwaist) console.log(`  ${k}`)
    }
  }

  if (!still) {
    console.log(`\n══ ${titel} ══\n`)
    const breite = Math.max(...[...karte.keys()].map((k) => k.length))
    for (const art of ['boxsicht', 'gemischt', 'technisch', 'verwaltung']) {
      const reihen = [...karte.values()].filter((b) => einstufung[b.umgebung]?.art === art)
      if (!reihen.length) continue
      console.log(`── ${art.toUpperCase()} (${reihen.length}) ──`)
      for (const b of reihen.sort((a, c) => a.stellen[0] - c.stellen[0])) {
        console.log(`  ${b.umgebung.padEnd(breite)}  Z. ${b.stellen.join(', ')}`)
        console.log(`  ${' '.repeat(breite)}  ${einstufung[b.umgebung].grund}`)
      }
      console.log('')
    }
    if (unbekannt.length) {
      console.log('── NICHT EINGEORDNET ──')
      for (const b of unbekannt) console.log(`  ${b.umgebung}  Z. ${b.stellen.join(', ')}`)
      console.log('')
    }
    if (verwaist.length) {
      console.log('── EINSTUFUNG OHNE STELLE ──')
      for (const k of verwaist) console.log(`  ${k}`)
      console.log('')
    }
    if (rohInBoxsicht.length) {
      console.log('── ROHER LESER IN EINER BOXSICHT-STELLE ──')
      for (const r of rohInBoxsicht) console.log(`  ${r.umgebung}  Z. ${r.nr}  liest medienLesen() ungefiltert`)
      console.log('')
    }
  }
  return {
    fehler: unbekannt.length + verwaist.length + rohInBoxsicht.length,
    boxsicht: boxsicht.length,
    umgebungen: karte.size,
  }
}

function main() {
  const still = process.argv.includes('--pruefen')
  const zeilen = readFileSync(join(WURZEL, SERVER), 'utf8').split('\n')

  const funde = sammeln(zeilen)
  const aufrufe = aufloeserSammeln(zeilen)

  if (!still) console.log(`AUSGAENGE DER BIBLIOTHEK — ${SERVER}`)
  const a = tabelle('WER DIE GANZE LISTE LIEST', jeUmgebungFassen(funde), EINSTUFUNG, still)
  const b = tabelle('WER EINEN EINZELNEN EINTRAG AUFLOEST', jeUmgebungFassen(aufrufe), AUFLOESER_EINSTUFUNG, still)

  if (!still) {
    console.log(
      `${a.umgebungen} Umgebungen / ${funde.length} Fundstellen bei der ganzen Liste, ` +
        `${b.umgebungen} Aufrufer der Aufloeser.\n` +
        `BOXSICHT: ${a.boxsicht} + ${b.boxsicht} — sie alle brauchen den Filter.`,
    )
  }

  if (a.fehler + b.fehler) {
    if (!still) {
      console.log('\nBEFUND: einordnen (mit Grund) in EINSTUFUNG bzw. AUFLOESER_EINSTUFUNG, oben in dieser Datei.')
    }
    process.exit(1)
  }
  process.exit(0)
}

main()
