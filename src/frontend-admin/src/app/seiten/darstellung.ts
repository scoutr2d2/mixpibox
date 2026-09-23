/**
 * Die Darstellungs-Seite: das Aussehen der Box von hier aus einstellen.
 *
 * DIE VORSCHAU IST KEINE NACHBILDUNG. Sie zeigt die ECHTE Oberfläche der Box
 * in einem Rahmen, im Format des echten Schirms (800x480) und auf die
 * verfügbare Breite herunterskaliert. Eine nachgebaute Vorschau wäre eine
 * zweite Wahrheit, die man pflegen müsste und die genau dann falsch ist, wenn
 * man sich auf sie verlässt.
 *
 * Der Kreis schließt sich so: hier speichern → das Backend legt es in
 * darstellung.json ab → die Box fragt alle drei Sekunden nach und übernimmt
 * es → der Rahmen zeigt es. Deshalb dauert es einen Moment, bis eine Änderung
 * sichtbar wird, und deshalb steht das auch da.
 *
 * Was hier NICHT geht: Elemente ziehen. Das bleibt am Gerät (Einstellungen →
 * Darstellung → Am Bildschirm anordnen), wo man den Finger auf dem hat, was
 * man verschiebt.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core'
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser'
import { schwaechsterKontrast, wurzelFarben } from '../farben'
import { klemmhinweis, lagesaetze, reglerAusgabe } from '../schirm-text'

/**
 * Ein Feld aus /api/konfiguration — nur die Angaben, die diese Seite braucht.
 *
 * Bewusst eine eigene, KLEINE Schnittstelle statt der ganzen aus dem Backend:
 * was diese Seite nicht liest, kann sie auch nicht falsch anzeigen.
 */
interface KonfigFeld {
  id: string
  art: 'text' | 'zahl' | 'schalter' | 'auswahl' | 'geheim' | 'url'
  bereich: string
  titel: string
  hinweis: string
  wert?: unknown
  auswahl: { wert: string; titel: string }[]
}

/** Muss zu darstellung.service.ts der Box passen. */
/*
 * NUR WIRKSAME FELDER (05.09.2026, Betreiber: „da kein altes Theme-System
 * mehr da, gibt es nur noch wirksame"). Seit die klassische Oberflaeche weg
 * ist, gilt: jedes Feld hier hat einen Leser in NewDesign/app.js — was
 * niemand liest, steht auch nicht hier und bekommt keinen Schalter.
 * `tools/darstellung-felder-wer.mjs --pruefen` misst genau das. Die alten
 * Angular-Felder (favKnopf, kopfIcons, zeige*, …) sind ersatzlos gefallen;
 * was davon im NewDesign weiterlebt, traegt seinen NEUEN flachen Namen aus
 * `mixpi-thema.ts` (zeigeTimer→schlummer, btAkkuArt→btAkku, …).
 */
interface Darstellung {
  miniPlayer: number
  bezeichnung: boolean
  bilder: number
  tasten: number
  abstandAlben: number
  statusLeiste: boolean
  /** Farbe des Punktes auf dem Fortschritt — '' heisst: kein Punkt. */
  fortschrittPunkt?: string
  /** Form des Punktes — '' heisst: runder Punkt. */
  fortschrittForm?: string
  /** Kategorienleiste und Mini-Player fahren beim Rollen ein (neue Oberflaeche). */
  platzBeimBlaettern: boolean
  /**
   * Zu erkannten Interpreten die ganze Diskografie holen (neue Oberflaeche).
   *
   * WIRD HIER NICHT MEHR BEDIENT (seit 03.08.2026 auf der Medienseite), MUSS
   * ABER STEHENBLEIBEN: `schreiben()` schickt den GANZEN Stand per PUT. Wer
   * das Feld aus dieser Schnittstelle und aus STANDARD entfernt, loescht es
   * bei der naechsten Aenderung an der Darstellung aus darstellung.json —
   * still, und erst der Benutzer merkt es. Dasselbe gilt fuer `verschmelzen`.
   */
  diskografie: boolean
  ruhigeMarke: boolean
  /**
   * Dasselbe Album aus mehreren Diensten zu EINER Kachel (neue Oberflaeche).
   *
   * Nur der Schalter. WELCHE Werke dasselbe sind, entsteht auf der Seite
   * „Doppelte" — dieser Knopf schaltet die dort abgelegten Zuordnungen scharf
   * oder eben nicht.
   *
   * BEDIENT WIRD ER SEIT 03.08.2026 AUF DER MEDIENSEITE. Er bleibt hier
   * trotzdem stehen, aus demselben Grund wie `diskografie`: dieses PUT
   * schreibt den ganzen Stand.
   */
  verschmelzen: boolean
  /** E121: „endet um HH:MM" im Streifen des Kissens. */
  endeZeit: boolean
  mpBreite: number
  mpHoehe: number
  /** E121: 'liste' wie bisher oder 'einer' — EIN durchschaltender Knopf. */
  kategorien: string
  kachelForm: string
  kachelRand: boolean
  kachelRandFarbe: string
  kachelRandBreite: number
  skalen: Record<string, number>
  /**
   * E44 (MuPi-Brücke): der Tipp auf ein Album SPIELT sofort, statt die
   * Titelliste zu zeigen. SEIT E121 fuehrt `albumTipp` (drei Wege) — dieses
   * aeltere Bool bleibt daneben bestehen und wird MITGESCHRIEBEN
   * ('spielt' ↔ true), damit Bestandsdaten und Format uebereinstimmen;
   * dieselbe Doppelschreibung macht der Uebersetzer in `mixpi-thema.ts`.
   */
  albumTippSpielt: boolean
  /** E121: was der Album-Tipp tut — 'lanes' (Titelliste), 'spielt', 'karte'. */
  albumTipp: string
  /** E44: Größenfaktor der Cover-Reihen (Lanes), 1 = heutige 118 px. */
  reihenFaktor: number
  /** E44: ein Werk je Seite, die Bühne rastet beim Wischen (nur neue Oberfläche). */
  vollbildBlaettern: boolean
  /**
   * Betreiberwunsch 29.08.2026: die Statuszeile des großen Players bewegt
   * sich wellenartig, SOLANGE Musik spielt (Pause/Stopp = Wellen ruhen).
   * Der Ton läuft nicht im Browser (librespot/mpv spielen auf der Box
   * selbst), im Browser ist also nichts zu analysieren. SEIT E99 (30.08.2026)
   * misst die BOX statt dessen: src/backend-player/src/pegel.ts greift über
   * `pw-record` den Standard-Monitor ab, rechnet vier Frequenzbänder per
   * Goertzel und liefert sie additiv als `pegel[]` im Zustands-Poll mit.
   *
   * ZWEI AUSPRÄGUNGEN, JE NACHDEM WAS ANKOMMT — dieser Schalter deckt beide:
   * fließen echte Pegel, zeichnet die neue Oberfläche sie auf einem Canvas
   * (`body.wellen-echt`); fehlt das Feld (alte Box, kein PipeWire, kein
   * `pw-record`), bleibt die reine CSS-Animation als Rückfall stehen -
   * mehrere überlagerte, phasenverschobene Bewegungen, an den
   * Wiedergabezustand gekoppelt, aber nicht an den Rhythmus der Musik.
   */
  statusWellen: boolean
  /** Wellenlinien im Regenbogen statt Themenfarbe - Wunsch der Tochter, 30.08.2026. */
  wellenRegenbogen: boolean

  /* ══ WISCHGESTEN VOM RAND (21.08.2026) ═══════════════════════════════════
   *
   * Acht Felder, alle NUR für die neue Oberfläche. Die klassische kennt sie
   * absichtlich nicht — sie hat keine solchen Gesten, und ein Feld in ihrem
   * `pruefen()` trüge dort einen STANDARD, den ein Geräte-Speichern
   * zurücksendete (llmwiki darstellung-feld-faellt-still-heraus).
   *
   * SIE SIND FLACH UND NICHT VERSCHACHTELT. Ein Objekt je Tat wäre kürzer zu
   * lesen und die falsche Wahl: Eine feldweise Prüfung lässt weg, was sie
   * nicht kennt, und ein halb angekommenes Objekt — Rand da, Fingerzahl weg —
   * sähe aus wie eine Einstellung, die jemand so gewollt hat.
   *
   * DIE BOX HAT DIESELBEN FELDER IN IHREM ELTERN-BEREICH, aber nur die
   * einfache Form: EIN Rand für alle drei Gesten. Hier steht die ganze
   * Matrix — und die Randbreite, für die auf dem 800x480-Schirm der Box keine
   * sechste Zeile mehr frei war. */
  /** Zwei Finger, überall: Ton, Titel, Doppeltipp. Ab Werk aus. */
  zweiFinger: boolean
  /** Ein schnelles Streichen über das Kissen blendet es aus. Ab Werk aus. */
  playerStreichen: boolean
  /** Nach so vielen Sekunden kommt das Kissen von selbst zurück. */
  playerZurueckSek: number
  /** Randgeste (heute nur das Schnellfenster). Ab Werk aus. */
  wischGesten: boolean
  /** Breite des Randstreifens in Bildpunkten. */
  wischRandBreite: number
  /** Von welchem Rand ('aus' = die Geste gibt es nicht) und mit wie vielen. */
  wischSchnellRand: string
  wischSchnellFinger: number

  /* ══ E121: DIE UEBERNAHMEN AUS DEM ALTEN (05.09.2026) ════════════════════
   * Die flachen Namen kommen aus `mixpi-thema.ts` (BLOECKE) — Vorgaben
   * spiegeln die Lese-Stellen in NewDesign/app.js, nicht umgekehrt. */
  /** Abstand Bild↔Name in Bildpunkten (auch negativ: Name rueckt ins Bild). */
  namenAbstand: number
  /** Laenge des Fortschrittsstreifens als Anteil der Kissenbreite (0.3–1). */
  streifenLaenge: number
  /** Kopfzeile: Rest des Schlummers, wenn einer laeuft. */
  schlummer: boolean
  /** Kopfzeile: Restdauer des laufenden Stuecks. */
  titelRest: boolean
  /** Kopfzeile: Ladestand des BT-Kopfhoerers — 'aus' oder 'prozent'. */
  btAkku: string
  /** Verlassen der Titelebene: 'weiter' spielt, 'stopp' haelt an. */
  beimVerlassen: string
  /** Beim Start dieser Kategorie oeffnen ('alle' = kein Sprung). */
  startKategorie: string

  /* ══ KOPFZEILE UND PLAYER — bislang nur im Eltern-Bereich der Box stellbar,
   * seit 05.09.2026 auch hier (Themen bauen braucht alle Schrauben). ══════ */
  /** Kopfzeile: die Uhr. */
  uhrzeit: boolean
  /**
   * Ein Tipp auf die Uhr sagt die Zeit (20.09.2026, Betreiber: „schalter in
   * beiden menues ... uhrzeit beim anklicken vorlesen"). Wirkt nur mit
   * `uhrzeit`; gesprochen wird ueber Piper (/api/vorlesen/sprich), NICHT ueber
   * den Kachel-Vorlesemodus aus config/vorlesen.json.
   */
  uhrzeitSprechen: boolean
  /** Kopfzeile: Restzeit des Stuecks als Zahl neben der Uhr. */
  restzeit: boolean
  /** Kopfzeilen-Anzeigen einzeln; Vorgabe folgt `statusLeiste`. */
  stAkku: boolean
  stLautstaerke: boolean
  stInternet: boolean
  stWlan: boolean
  stBluetooth: boolean
  /** Kissen und grosser Player als Glasflaeche. */
  mpGlas: boolean
  grossGlas: boolean
  /** Akzentfarbe des grossen Players: bernstein, koralle, gruen, blau. */
  playerAkzent: string
  /**
   * E129: wer auf der Bühne über den Tasten steht — 'aus', 'wellen',
   * 'songtext', 'titel'. Alles außer 'aus' hält den Platz dauerhaft, damit
   * die Bedienelemente nicht bei jedem Titelwechsel springen.
   */
  buehne: string
  /** Wellen: Hub und Tempo in drei Stufen (1–3); der Hub ist die Bühnenhöhe. */
  wellenHub: number
  wellenTempo: number
  /** Titelzeile / Albumzeile im Kissen zeigen. */
  spielTitel: boolean
  spielAlbum: boolean
}

const STANDARD: Darstellung = {
  miniPlayer: 1,
  bezeichnung: true,
  bilder: 1,
  tasten: 1,
  abstandAlben: 24,
  statusLeiste: true,
  fortschrittPunkt: '',
  fortschrittForm: '',
  platzBeimBlaettern: false,
  diskografie: false,
  ruhigeMarke: false,
  verschmelzen: false,
  // false, nicht true: die Vorgabe der Lese-Stelle (w.endeZeit === true).
  // Das alte true galt der klassischen Bar, die es nicht mehr gibt.
  endeZeit: false,
  mpBreite: 1,
  mpHoehe: 1,
  kategorien: 'liste',
  kachelForm: 'rund',
  kachelRand: true,
  kachelRandFarbe: '#ffffff',
  kachelRandBreite: 6,
  skalen: {},
  albumTippSpielt: false,
  albumTipp: 'lanes',
  namenAbstand: 0,
  streifenLaenge: 1,
  schlummer: false,
  titelRest: false,
  btAkku: 'aus',
  beimVerlassen: 'weiter',
  startKategorie: 'alle',
  uhrzeit: false,
  // AUS wie die Uhr selbst: Eine Box, die nach einem Update auf Beruehrung
  // ploetzlich spricht, hat sich ohne Zutun ihres Besitzers veraendert.
  uhrzeitSprechen: false,
  restzeit: false,
  // Die fuenf folgen in app.js der statusLeiste, solange sie nie gesetzt
  // wurden — statusLeiste steht ab Werk an, also stehen sie es auch.
  stAkku: true,
  stLautstaerke: true,
  stInternet: true,
  stWlan: true,
  stBluetooth: true,
  mpGlas: false,
  grossGlas: false,
  playerAkzent: 'bernstein',
  // 'aus' ist der Stand vor E129 — kein Platz über den Tasten.
  buehne: 'aus',
  wellenHub: 2,
  wellenTempo: 2,
  spielTitel: true,
  spielAlbum: true,
  reihenFaktor: 1,
  vollbildBlaettern: false,
  statusWellen: false,
  wellenRegenbogen: false,
  // DIE WERKSBELEGUNG: alle drei vom RECHTEN Rand, unterschieden nach der
  // Fingerzahl. Rechts ist der einzige Rand der neuen Oberfläche, an dem
  // sonst nichts liegt — links die Kategorienleiste, unten das Kissen, oben
  // die Kopfzeile. Dieselben Werte stehen in NewDesign/app.js (WISCH_WERK);
  // dass sie gleich bleiben, misst tools/wischrand-schau.mjs.
  zweiFinger: false,
  playerStreichen: false,
  playerZurueckSek: 10,
  wischGesten: false,
  wischRandBreite: 28,
  wischSchnellRand: 'rechts',
  wischSchnellFinger: 3,
}

/** Die vier Ränder plus „aus" — dieselbe Reihenfolge wie in NewDesign/app.js. */
const WISCH_RAENDER = ['aus', 'links', 'rechts', 'oben', 'unten'] as const

/*
 * Die Gesten AM RAND. Seit dem 21.08.2026 ist es genau eine: Lautstärke und
 * Player sind abgewandert — die eine zu den zwei Fingern (überall), der
 * andere auf den Player selbst. Die Liste bleibt eine Liste, weil die
 * Mechanik dahinter mehrzahlfähig ist und die nächste Geste bestimmt kommt.
 */
const WISCH_TATEN = [
  {
    id: 'schnell',
    name: 'Schnellfenster',
    rand: 'wischSchnellRand' as const,
    finger: 'wischSchnellFinger' as const,
    hinweis: 'Helligkeit und Ton wirken sofort; Hörzeit und Funk gehen durch die Eltern-Sperre.',
  },
]

const STUFEN = [0.75, 1, 1.35]

/**
 * WELCHE Farben der neuen Oberfläche einstellbar sind — die einzige Liste
 * dieser Art im ganzen Baum.
 *
 * WARUM NUR FÜNF, wo app.css sechzehn Farben führt: Fünf ergeben zusammen ein
 * Bild (Grund, Fläche, Schrift, Linien, Akzent). Die übrigen elf sind
 * Feinabstimmungen darauf — `--accentDark` ist der dunklere Zwilling von
 * `--accent`, `--pillInk` die Schrift auf dem Mini-Player, `--muted` der
 * Nebentext. Wer sie einzeln stellbar macht, bevor die fünf sitzen, gibt
 * sechzehn Regler für eine Frage.
 *
 * NICHT DABEI, MIT ABSICHT:
 *
 *   `--line` — GEMESSEN am 05.08.2026 (tools/farbwaehler-wirkung.mjs): steht
 *   zweimal in app.css und wird NULL Mal mit `var()` gelesen. Ein Regler
 *   darauf sähe richtig aus und färbte nichts. Die Linien hängen an `--line2`
 *   (20 Verwendungen) — deshalb steht hier `--line2` unter dem Namen „Linien".
 *
 *   Die PLAKETTENFARBEN DER DIENSTE (rss, lokal, ard, spotify, radio,
 *   jellyfin) stehen nicht als Variablen in `:root`, sondern fest in den
 *   Regeln `.marke-*`. Das ist kein Versehen: sie sind eine ABGEMESSENE Runde
 *   um den Farbkreis (339°, 211°, 175°, 141°, 17°, 268°), damit sich auf
 *   29 Bildpunkten aus zwei Metern kein Dienst mit einem anderen verwechseln
 *   lässt. Frei wählbar könnte man zwei davon ununterscheidbar machen — und
 *   das Kind sähe dann nicht mehr, woher ein Album kommt. Ob sie trotzdem
 *   hineinsollen, gehört dem Betreiber; hier wird es nicht vorweggenommen.
 *
 * Die WERTE stehen NICHT hier, sondern kommen aus /neu/app.css.
 */
const FARBFELDER = [
  { v: '--bg', name: 'Hintergrund', wozu: 'der Grund hinter allem' },
  { v: '--surface', name: 'Flächen', wozu: 'Seitenleiste, Fenster, Karten' },
  { v: '--ink', name: 'Schrift', wozu: 'jeder Text' },
  { v: '--line2', name: 'Linien', wozu: 'Ränder, Balken, leere Cover' },
  { v: '--accent', name: 'Akzent', wozu: 'Ring um das laufende Album, Fortschritt' },
] as const

/* ══ KEINE SCHIRM-LISTEN MEHR (05.09.2026) ══════════════════════════════════
 *
 * Hier standen NUR_NEU und NUR_KLASSISCH: welches Feld auf welcher der zwei
 * Oberflaechen wirkt, samt „auch Unwirksames zeigen". Seit E118 gibt es EINE
 * Oberflaeche, und der Betreiber hat es auf den Punkt gebracht: „da kein
 * altes Theme-System mehr da, gibt es nur noch wirksame." Jedes Feld im
 * Interface oben hat einen Leser in NewDesign/app.js —
 * `tools/darstellung-felder-wer.mjs --pruefen` weist es nach, und ein Feld
 * ohne Leser kommt gar nicht erst hierher statt in eine Ausblende-Liste.
 */

/**
 * Die Reiter ganz oben. EINE Zeile statt sieben Abschnitten untereinander:
 * die Seite war 2584 Zeilen lang und zeigte alles gleichzeitig.
 *
 * Die VORSCHAU bleibt dabei ausserhalb der Reiter stehen und ist immer zu
 * sehen — man stellt etwas und will im selben Moment sehen, was es tut. Der
 * Reiter „Vorschau" traegt nur ihre eigenen Bedienelemente (Groesse,
 * Anordnen, welche Seite).
 */
const REITER = [
  // OPTIK ZUERST — und zwar als erster Reiter, nicht als einer von sechsen.
  // „erstmal die optik im ersten schritt, das verhalten kann man in einer
  // anderen ansicht machen" (Betreiber, 22.08.2026). Wer diese Seite oeffnet,
  // will fast immer sehen, WIE die Box aussieht; was ein Tipp TUT, ist eine
  // andere Frage und ein anderer Besuch.
  //
  // FARBEN UND ELEMENTE SIND HIER AUFGEGANGEN. Sie waren eigene Reiter und
  // beantworteten doch dieselbe Frage — die Trennung zwang dazu, fuer eine
  // Kachel (Form hier, Farbe dort) zweimal umzuschalten.
  { id: 'optik', name: 'Optik' },
  // VERHALTEN: was ein Tipp, ein Wisch, ein Start tut.
  { id: 'verhalten', name: 'Verhalten' },
  { id: 'themen', name: 'Themen' },
  { id: 'box', name: 'Box' },
] as const

/**
 * Die Abschnitte INNERHALB der Optik — die zweite Ebene.
 *
 * Vier Reiter statt vier Karten untereinander: nebeneinander gestellt sieht
 * man, dass es genau vier Fragen sind, und beantwortet eine davon, ohne an den
 * anderen dreien vorbeizurollen.
 *
 * FARBEN gehoert dazu und nicht nach oben: eine Kachel hat eine Form UND eine
 * Farbe. Wer dafuer die oberste Ebene wechseln muss, stellt sie nacheinander
 * statt nebeneinander.
 */
const OPTIK_TEILE = [
  // Die felder-Listen je Teil sind mit der Schirm-Mechanik gefallen
  // (05.09.2026): jeder Teil hat auf der EINEN Oberflaeche Inhalt.
  { id: 'mp', name: 'Mini-Player' },
  { id: 'kacheln', name: 'Kacheln & Knöpfe' },
  { id: 'anzeigen', name: 'Anzeigen' },
  { id: 'farben', name: 'Farben' },
] as const

@Component({
  selector: 'mupi-darstellung',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1rem; font-size: 0.94rem; }

    section {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.9rem 1rem; margin-bottom: 0.9rem;
    }
    h2 { font-size: 1rem; margin: 0 0 0.2rem; }
    .hinweis { color: var(--gedaempft); font-size: 0.85rem; margin: 0 0 0.7rem; }
    /* NICHT gedaempft wie .hinweis — das hier ist die Meldung, die jemand
       liest, waehrend vor ihm ein schwarzer Bildschirm steht. Sie darf nicht
       aussehen wie eine Fussnote. */
    .warnung {
      color: var(--warn); font-size: 0.9rem; margin: 0.6rem 0 0.5rem;
      border-left: 3px solid var(--warn); padding-left: 0.6rem;
    }
    .warnung + button {
      min-height: 2.6rem; padding: 0 0.9rem; border-radius: 10px;
      border: 1px solid var(--warn); background: var(--grund); color: var(--schrift);
      font-size: 0.9rem;
    }
    /* AUSSAGE UEBER DIE JETZIGE LAGE DER BOX — und deshalb NICHT .hinweis.
       AM BILD GEMESSEN (08.08.2026, tools/schirm-regler-ansehen.mjs): der Satz
       „der Bildschirm ist gerade ganz abgeschaltet" trug dieselbe Klasse wie
       die immergleiche Beschreibung zwei Zeilen darueber — gleiche Farbe
       (#9a9aa0), gleiches Gewicht, gleiche Groesse. Daneben stand ein Regler
       auf 100 %. Wer die Seite ueberfliegt, sieht den vollen Regler und liest
       das Graue nicht: genau die Luege, gegen die der Satz geschrieben wurde.
       NICHT .warnung (gelb): es ist nichts kaputt und es gibt nichts zu
       druecken. Volle Schriftfarbe und eine Kante reichen, damit es sich vom
       Kleingedruckten abhebt, ohne wie ein Fehler auszusehen.

       KEIN SCHRAEGSTRICH-ANFUEHRUNGSZEICHEN (das Zeichen unter der Tilde) IM
       KOMMENTAR: dieser ganze Block steht in einem Template-Literal, und genau
       dieses Zeichen beendet es. Der Uebersetzer meldet dann „Failed to
       resolve @Component.styles", zwanzig Zeilen von der Ursache entfernt.
       Hier am 08.08.2026 prompt passiert — zweimal .hinweis in Zeichen
       gesetzt, und der ganze Bau stand. */
    .lage {
      color: var(--schrift); font-size: 0.9rem; margin: 0.6rem 0 0.5rem;
      border-left: 3px solid var(--leit); padding-left: 0.6rem;
    }
    .wahl { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .wahl button {
      min-height: 2.6rem; padding: 0 0.9rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
      font-size: 0.9rem;
    }
    .wahl button.an { background: var(--leit); border-color: transparent; color: #fff; }
    .zahl { display: flex; align-items: center; gap: 0.6rem; }
    .zahl input[type='range'] { flex: 1 1 12rem; max-width: 18rem; }
    .zahl output { min-width: 3.5rem; font-family: ui-monospace, monospace; font-size: 0.9rem; }

    /* DAS FELD haelt immer den Platz der GROESSTEN Vorschau, die hier passt.
       Deshalb springt beim Zoomen nichts: was darunter steht, bleibt liegen,
       wo es liegt. Es sitzt linksbuendig — die Vorschau darin ist zentriert. */
    .feld {
      display: flex; align-items: center; justify-content: center;
      border: 1px dashed var(--rand); border-radius: 14px;
      background: repeating-linear-gradient(45deg, transparent 0 8px, rgba(255,255,255,0.02) 8px 16px);
      margin: 0 auto 0.9rem 0;
    }
    .buehne { overflow: hidden; border: 1px solid var(--rand); border-radius: 12px; background: #000; }
    .schirm { width: 800px; height: 480px; border: 0; background: #000; transform-origin: top left; }

    /* Eine Schrittreihe: Beschriftung, − Wert +, dann Schnellwege. Grosse
       Flaechen, weil hier nichts gezogen werden soll — Ziehen trifft man auf
       einem Regler schlecht, ein Knopf immer. */
    .stufe {
      display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem;
      margin-bottom: 0.5rem;
    }
    .stufe .was { flex: 0 0 11rem; color: var(--gedaempft); font-size: 0.9rem; }
    .stufe button {
      min-width: 2.8rem; min-height: 2.6rem; padding: 0 0.7rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
      font-size: 1.05rem; line-height: 1;
    }
    .stufe button.klein { font-size: 0.85rem; min-width: 0; }
    .stufe button.an { background: var(--leit); border-color: transparent; color: #fff; }
    .stufe .wert {
      min-width: 4.2rem; text-align: center; font-family: ui-monospace, monospace;
      font-size: 0.95rem;
    }

    .kontext { border-color: var(--leit); }

    /* Eine Zeile je Anzeige: Zeichen, Name, an/aus, Ort, Reihenfolge. */
    .iconliste { display: flex; flex-direction: column; gap: 0.35rem; }
    .iconzeile {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.3rem 0.4rem; border: 1px solid var(--rand); border-radius: 10px;
    }
    .iconzeile.aus { opacity: 0.55; }
    .izeichen { width: 1.5rem; text-align: center; font-size: 1.1rem; }
    .iname { flex: 1 1 auto; min-width: 6rem; }
    .iconzeile button { min-height: 2.2rem; padding: 0 0.6rem; border-radius: 9px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift); font-size: 0.85rem; }
    .iconzeile button.an { background: var(--leit); border-color: transparent; color: #fff; }
    .iconzeile button:disabled { opacity: 0.35; }
    .ipfeile { display: flex; gap: 0.2rem; }

    /* Reiter: dieselbe Formensprache wie die Stufen-Knoepfe, nur als Zeile
       mit Unterkante — damit man sieht, dass darunter etwas dazugehoert. */
    .reiter {
      display: flex; gap: 0.4rem; flex-wrap: wrap;
      border-bottom: 1px solid var(--rand); padding-bottom: 0.5rem; margin: 0.2rem 0 0.7rem;
    }
    .reiter button {
      min-height: 2.4rem; padding: 0 0.8rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
      font-size: 0.9rem; line-height: 1;
    }
    .reiter button.an { background: var(--leit); border-color: transparent; color: #fff; }

    /* DIE OBERSTE REITERZEILE traegt die ganze Seite und darf deshalb nicht
       aussehen wie die Unterreiter innerhalb eines Abschnitts (Mini-Player /
       Buttons / Icons). Groesser, kraeftigere Kante, mehr Luft darunter. */
    .reiter-oben {
      border-bottom-width: 2px; padding-bottom: 0.6rem; margin: 0.6rem 0 0.9rem;
    }
    .reiter-oben button { min-height: 2.7rem; padding: 0 1rem; font-size: 0.95rem; }

    /* Welcher Schirm laeuft — und der Schalter fuer das Unwirksame.
       KEINE eigene Sektion: der Satz gehoert ueber ALLES und wuerde als Karte
       mit Rahmen wie ein weiterer Abschnitt unter vielen aussehen. */
    .schirmzeile {
      display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;
      margin: 0.2rem 0 0;
    }
    .schirmname { font-size: 0.9rem; color: var(--gedaempft); }
    .schirmname strong { color: var(--schrift); }

    /* WAS AUF DIESEM SCHIRM NICHTS TUT — nur sichtbar, wenn man ausdruecklich
       danach fragt. Blass UND durchgestrichen, weil blass allein sich auf
       einem kleinen Schirm nicht von „gerade aus" unterscheidet: „aus" ist
       ein Zustand, den man aendern kann, „schlaeft" ist keiner.
       KEIN pointer-events:none — man DARF es stellen. Der Wert bleibt
       gespeichert und gilt, sobald die andere Oberflaeche laeuft; das
       Vorbereiten vor dem Umschalten ist ein sinnvoller Handgriff. */
    .schlaeft { opacity: 0.5; }
    .schlaeft .was, button.schlaeft, label.schlaeft { text-decoration: line-through; }

    /* ══ WERKBANK: Leinwand und Regler nebeneinander ═══════════════════════
       EINE SPALTE IST DIE VORGABE, zwei sind der Zugewinn. Andersherum
       gedacht (zwei Spalten, die auf schmalen Schirmen umbrechen) waere die
       Verwaltung auf dem Telefon der Ausnahmefall — sie wird aber oft genug
       vom Telefon aus bedient, waehrend die Box auf dem Tisch steht.

       DIE 1100px SIND GERECHNET, nicht geraten: die Leinwand haelt bei 55 %
       Vorschaugroesse 440 px plus Rahmen, die Reglerspalte braucht rund
       420 px, damit eine „stufe"-Zeile (Beschriftung + drei Knoepfe) nicht
       umbricht. Darunter stuenden zwei zu enge Spalten statt einer
       brauchbaren. */
    .werkbank { display: block; }

    @media (min-width: 1100px) {
      .werkbank {
        display: grid;
        grid-template-columns: auto minmax(420px, 1fr);
        gap: 1rem;
        align-items: start;
      }
      /* DAS BILD BLEIBT STEHEN, waehrend rechts gerollt wird — der eine
         Punkt, an dem sich diese Seite wie ein Editor anfuehlt. Das halbe rem
         oben haelt Abstand zur Kopfzeile der Verwaltung.
         KEINE BACKTICKS IN DIESEM KOMMENTAR: er steht INNERHALB des
         styles-Template-Literals, und der erste beendet es mitten im CSS
         (llmwiki backticks-beenden-jede-vorlage). Beim Schreiben genau dieser
         Zeilen passiert — acht Fehler, keiner davon nannte den Grund. */
      .leinwand {
        position: sticky; top: 0.5rem;
      }
    }

    /* Die Reglerspalte traegt die Abschnitte; ihre Karten sollen dort nicht
       noch einmal einen Aussenabstand nach oben mitbringen. */
    .regler > section:first-of-type { margin-top: 0; }

    /* Die Sammlung: kleine Skizzen der Bauformen. Sie zeigen die ANORDNUNG,
       nicht den Inhalt — es geht um Bild/Text/Tasten/Streifen und wo sie
       liegen. */
    .sammlung { display: flex; flex-wrap: wrap; gap: 0.6rem; }
    .karte {
      display: flex; flex-direction: column; align-items: center; gap: 0.35rem;
      padding: 0.5rem; border: 1px solid var(--rand); border-radius: 12px;
      background: var(--grund); color: var(--schrift); cursor: grab;
    }
    .karte.an { border-color: var(--leit); background: color-mix(in srgb, var(--leit) 18%, var(--grund)); }
    .karte-name { font-size: 0.78rem; }
    .skizze {
      position: relative; display: block; width: 108px; height: 42px;
      border: 1px solid var(--rand); border-radius: 8px; background: #0d1117;
    }
    .skizze i { position: absolute; background: var(--gedaempft); border-radius: 2px; }
    .s-bild { left: 5px; top: 5px; width: 18px; height: 18px; }
    .s-text { left: 27px; top: 8px; width: 34px; height: 4px; }
    .s-tasten { right: 5px; top: 10px; width: 38px; height: 8px; background: var(--leit) !important; }
    .s-streifen { left: 5px; right: 5px; bottom: 4px; height: 3px; }

    .skizze.ohneBild .s-bild { display: none; }
    .skizze.ohneBild .s-text { left: 8px; }
    .skizze.ohneTitel .s-text { display: none; }
    .skizze.nurTasten .s-bild,
    .skizze.nurTasten .s-text,
    .skizze.nurTasten .s-streifen { display: none; }
    /* Der Streifen sitzt UEBER der Leiste, nicht am oberen Rand. */
    .skizze.statusOben .s-streifen { top: 3px; bottom: auto; left: 5px; right: 5px; }
    .skizze.statusOben .s-bild { top: 12px; }
    .skizze.statusOben .s-text { top: 15px; }
    .skizze.statusOben .s-tasten { top: 17px; }
    /* Zeiten in der Leiste: der Streifen liegt INNEN, die Leiste ist hoeher. */
    .skizze.statusInnen .s-streifen { left: 5px; right: 5px; bottom: 8px; height: 3px; }
    .skizze.statusInnen .s-bild { top: 4px; height: 14px; width: 14px; }
    .skizze.statusInnen .s-text { top: 6px; }
    .skizze.statusInnen .s-tasten { top: 6px; }

    .skizze.statusInnenOben .s-streifen { top: 6px; bottom: auto; left: 5px; right: 5px; height: 3px; }
    .skizze.statusInnenOben .s-bild { top: 14px; height: 14px; width: 14px; }
    .skizze.statusInnenOben .s-text { top: 16px; }
    .skizze.statusInnenOben .s-tasten { top: 16px; }
    .skizze.statusUeberAllem .s-streifen { top: 2px; bottom: auto; }
    .skizze.statusUnterAllem .s-streifen { bottom: 2px; }

    .skizze.integriert .s-streifen { left: 5px; right: 40px; bottom: 6px; height: 2px; background: var(--leit) !important; }

    /* Das Feld nimmt eine Karte an — sichtbar, sonst zieht man ins Ungewisse. */
    .feld.ziel { border-color: var(--leit); border-style: solid; }
    .stufe button.weg { color: var(--fehler); }
    .stufe input[type='text'] { width: 9rem; }

    .themen { display: grid; gap: 0.5rem; max-width: 26rem; }
    .thema { display: flex; gap: 0.5rem; }
    .thema button.name { flex: 1 1 auto; text-align: left; }
    .thema button.weg { color: var(--fehler); }
    input[type='text'] {
      min-height: 2.6rem; padding: 0 0.7rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
    }
    /* Nur fuer die Auswahlfelder aus der Konfigurationsdatei mit vielen
       Eintraegen (Farbthema). Dieselbe Formensprache wie auf der
       Konfigurationsseite — es ist dasselbe Feld, nur an einem anderen Ort. */
    .stufe select {
      font: inherit; min-height: 2.6rem; padding: 0 0.6rem; border-radius: 10px;
      border: 1px solid var(--rand); background: var(--grund); color: var(--schrift);
    }
    .stand { color: var(--gedaempft); font-size: 0.85rem; margin: 0.4rem 0 0; }
    .reihen { display: grid; gap: 0.9rem; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }

    /* FARBFELDER — der einzige andere Farbwaehler dieser Seite (die Umrandung
       der Kacheln) ist ein nackter <input type="color"> ohne jedes CSS. Er
       wird auf dem Tastschirm der Verwaltung mit dem Finger getroffen, und
       dafuer ist die Vorgabe des Browsers zu klein. Deshalb hier eine Groesse,
       die zum Rest der Seite passt (2,6rem wie jeder Knopf). */
    .stufe input[type='color'] {
      width: 3.4rem; min-height: 2.6rem; padding: 2px;
      border: 1px solid var(--rand); border-radius: 10px;
      background: var(--grund); cursor: pointer;
    }
    /* Der Hexwert daneben: er ist die Auskunft, die man abschreiben und
       weitergeben kann — ein Farbfleck allein laesst sich nicht nennen. */
    .farbwert { font-family: ui-monospace, monospace; font-size: 0.85rem; min-width: 5.2rem; }
    .farbe-eigen { color: var(--schrift); }
    .farbe-vorgabe { color: var(--gedaempft); }
  `,
  template: `
    <h1>Darstellung</h1>
    <p class="unter">
      Das Aussehen der Box. Änderungen gelten sofort und erscheinen binnen weniger Sekunden im Bild — es ist die echte
      Oberfläche, kein Nachbau.
    </p>

    <!-- Hier stand bis 05.09.2026 die Schirmzeile („Diese Box zeigt … / auch
         Unwirksames zeigen"): zwei Oberflaechen, dreissig schlafende
         Schalter. Es gibt nur noch eine Oberflaeche, und jedes Feld dieser
         Seite wirkt — die Zeile haette nichts mehr zu sagen. -->
    <div class="schirmzeile">
      <button type="button" class="klein" [class.an]="erklaerungen()" (click)="erklaerungenUm()"
              [attr.aria-pressed]="erklaerungen()"
              title="Erklärungen zu jeder Einstellung ein- oder ausblenden">
        ? Erklärungen
      </button>
    </div>

    <!-- ══ DIE REITER ═══════════════════════════════════════════════════════
         Die Seite zeigte bisher sieben Abschnitte am Stueck. Jetzt steht
         immer nur einer da — die VORSCHAU aber ausserhalb und immer, weil man
         beim Stellen sehen will, was man stellt. Der Reiter „Vorschau" traegt
         deshalb nur ihre eigenen Bedienelemente, nicht das Bild selbst. -->
    <div class="reiter reiter-oben">
      @for (r of reiter(); track r.id) {
        <button type="button" [class.an]="reiterAktiv() === r.id" (click)="reiterSetzen(r.id)">{{ r.name }}</button>
      }
    </div>

    <!-- DAS BILD: steht ueber allen Reitern und bleibt stehen.
         Das Feld hält den Platz der größten hier möglichen Größe, das Bild
         sitzt darin zentriert. -->
    <!-- ══ DIE WERKBANK ═══════════════════════════════════════════════════
         Leinwand und Regler NEBENEINANDER, sobald Platz ist (ab 1100 px).
         Vorher stand das Bild oben und die Regler darunter: wer einen Wert
         verstellte, war weit genug weggerollt, um die Wirkung nicht mehr zu
         sehen — und rollte zurueck, um nachzusehen. Genau die Schleife, die
         ein Editor nicht haben darf.

         AUF SCHMALEN SCHIRMEN bleibt es untereinander (eine Spalte); 800x480
         nebeneinander waere zweimal zu wenig Platz statt einmal genug. -->
    <div class="werkbank">
      <!-- LINKS: das Bild bleibt stehen, waehrend rechts gerollt wird. -->
      <div class="leinwand">
    <div
      class="feld"
      [style.width.px]="feldBreite()" [style.height.px]="feldHoehe()">
      <div class="buehne" [style.width.px]="800 * massEff() + 2" [style.height.px]="480 * massEff() + 2">
        <iframe
          #rahmen
          class="schirm"
          title="Vorschau der Box-Oberfläche"
          [src]="quelle()"
          [style.transform]="'scale(' + massEff() + ')'"
          (load)="rahmenBereit()"
        ></iframe>
      </div>
    </div>
    @if (gewaehlt(); as g) {
      <!-- Nur das, was zum angetippten Element gehoert. Der Rest steht
           weiterhin unter „Elemente" — wer nichts auswaehlt, sieht alles. -->
      <section class="kontext">
        <div class="stufe">
          <span class="was"><strong>{{ stueckName(g) }}</strong></span>
          <button type="button" class="klein" (click)="gewaehlt.set(null)">Auswahl aufheben</button>
        </div>

        @if (hatGroesse(g)) {
          <div class="stufe">
            <span class="was">Größe</span>
            <button type="button" (click)="schrittStueck(g, -0.05)">−</button>
            <span class="wert">{{ (groesseVon(g) * 100).toFixed(0) }} %</span>
            <button type="button" (click)="schrittStueck(g, 0.05)">+</button>
          </div>
        }
        @if (g === 'mp') {
          <div class="stufe">
            <span class="was">Länge</span>
            <button type="button" (click)="schritt('mpBreite', -0.05)">−</button>
            <span class="wert">{{ (w().mpBreite * 100).toFixed(0) }} %</span>
            <button type="button" (click)="schritt('mpBreite', 0.05)">+</button>
            <button type="button" class="klein" (click)="setz({ mpBreite: 1 })">Standard</button>
          </div>
          <div class="stufe">
            <span class="was">Höhe</span>
            <button type="button" (click)="schritt('mpHoehe', -0.05)">−</button>
            <span class="wert">{{ (w().mpHoehe * 100).toFixed(0) }} %</span>
            <button type="button" (click)="schritt('mpHoehe', 0.05)">+</button>
            <button type="button" class="klein" (click)="setz({ mpHoehe: 1 })">Standard</button>
          </div>
        }
        @if (g === 'alben') {
          <div class="stufe">
            <span class="was">Abstand der Alben</span>
            <button type="button" (click)="schritt('abstandAlben', -4)">−</button>
            <span class="wert">{{ w().abstandAlben }} px</span>
            <button type="button" (click)="schritt('abstandAlben', 4)">+</button>
            <button type="button" class="klein" (click)="setz({ abstandAlben: 0 })">eng</button>
            <button type="button" class="klein" (click)="setz({ abstandAlben: 24 })">normal</button>
          </div>
        }
        @if (g === 'status') {
          <div class="stufe">
            <span class="was">Länge der Zeile</span>
            <button type="button" (click)="schritt('streifenLaenge', -0.05)">−</button>
            <span class="wert">{{ (w().streifenLaenge * 100).toFixed(0) }} %</span>
            <button type="button" (click)="schritt('streifenLaenge', 0.05)">+</button>
            <button type="button" class="klein" (click)="setz({ streifenLaenge: 1 })">Standard</button>
          </div>
          <div class="stufe">
            <span class="was">„endet um …"</span>
            <button type="button" [class.an]="w().endeZeit" (click)="setz({ endeZeit: !w().endeZeit })">
              {{ w().endeZeit ? 'an' : 'aus' }}
            </button>
          </div>
        }
        @if (g === 'bezeichnung') {
          <div class="stufe">
            <span class="was">Abstand zum Bild</span>
            <button type="button" (click)="schritt('namenAbstand', -2)">−</button>
            <span class="wert">{{ w().namenAbstand }} px</span>
            <button type="button" (click)="schritt('namenAbstand', 2)">+</button>
          </div>
        }
        @if (kannAus(g)) {
          <div class="stufe">
            <span class="was">Sichtbar</span>
            <button type="button" [class.an]="sichtbar(g)" (click)="sichtbarUmschalten(g)">
              {{ sichtbar(g) ? 'an' : 'aus' }}
            </button>
          </div>
        }
      </section>
    }
    <p class="stand">{{ stand() }}</p>
      </div>

      <!-- RECHTS: nur der gewaehlte Reiter. -->
      <div class="regler">

    <!-- AUS DER KONFIGURATION DER BOX (G5, 2026-08-03).
         Farbthema, Vollbild, weicher Bildlauf und vor allem die Wahl der
         Oberflaeche standen bis dahin in der langen Liste auf der
         Konfigurationsseite. Sie beantworten aber nicht „was IST die Box",
         sondern „was SIEHT man" — und sie gehoeren neben die Vorschau, weil
         genau hier verglichen wird. Gespeichert werden sie weiterhin ueber
         /api/konfiguration; die Zuordnung kommt vom Server, nicht von hier. -->
    @if (reiterAktiv() === 'box') {
      @if (konfigFelder().length > 0) {
        <section class="konfig">
          <h2>Aus der Konfiguration der Box</h2>
          <!-- KEINE ZAHL IM SATZ ("diese vier"): sie stimmt genau bis zum
               naechsten Feld, das im Bereich 'darstellung' dazukommt, und danach
               luegt sie leise. -->
          @if (erklaerungen()) {
            <p class="hinweis">
              Diese Einstellungen stehen in der Konfigurationsdatei, nicht im Thema — sie
              wirken deshalb auch dann, wenn du oben ein anderes Thema lädst.
            </p>
          }
          @for (f of konfigFelder(); track f.id) {
            <div class="stufe">
              <span class="was">{{ f.titel }}</span>
              @if (f.art === 'schalter') {
                <button type="button" class="klein" [class.an]="!!konfigWert(f.id)" (click)="konfigSetzen(f.id, !konfigWert(f.id))">
                  {{ konfigWert(f.id) ? 'an' : 'aus' }}
                </button>
              } @else if (f.art === 'auswahl') {
                <!-- KNOEPFE NUR BEI WENIGEN WAHLMOEGLICHKEITEN, sonst eine
                     Klappliste. Beim ersten Anlauf (03.08.2026) zeichnete diese
                     Zeile IMMER einen Knopf je Eintrag — und das Farbthema holt
                     seine Liste aus mupibox.installedThemes, wo in der Vorlage
                     28 Namen stehen. Das waere eine Wand aus 28 Knoepfen ganz
                     oben auf der Seite gewesen, oberhalb der Vorschau, um die es
                     hier eigentlich geht. Auf der Konfigurationsseite, von der
                     das Feld kommt, war es eine Klappliste.
                     Die Grenze steht hier und nicht am Feld: sie ist eine
                     Eigenschaft DIESER Anzeige, nicht des Feldes.
                     KEINE BACKTICKS in diesem Kommentar — die Vorlage steht in
                     einem Template-Literal, und der erste Backtick beendet sie
                     mitten im HTML. Beim Schreiben genau dieses Kommentars
                     passiert; gemeldet hat es tools/verwaltung-suchbestand.mjs,
                     dem daraufhin 51 Eintraege der Seite fehlten. -->
                @if (f.auswahl.length <= KNOEPFE_MAX) {
                  @for (a of f.auswahl; track a.wert) {
                    <button type="button" class="klein" [class.an]="konfigWert(f.id) === a.wert" (click)="konfigSetzen(f.id, a.wert)">
                      {{ a.titel }}
                    </button>
                  }
                } @else {
                  <select (change)="konfigSetzen(f.id, $any($event.target).value)">
                    @for (a of f.auswahl; track a.wert) {
                      <option [value]="a.wert" [selected]="a.wert === konfigWert(f.id)">{{ a.titel }}</option>
                    }
                  </select>
                }
              } @else {
                <!-- DIESE SEITE ZEICHNET NUR SCHALTER UND AUSWAHLEN. Ein Feld
                     anderer Art (Text, Zahl, Geheimnis) im Bereich
                     'darstellung' stuende sonst mit Ueberschrift da und ohne
                     jedes Bedienelement — und waere auch sonst nirgends zu
                     bedienen, denn die Konfigurationsseite zeigt diesen Bereich
                     absichtlich nicht. Genau die stille Sorte Ausfall, die
                     dieses Board schon einmal einen Nachmittag gekostet hat.
                     Der eigentliche Waechter ist der Test „die Darstellungsseite
                     kann jedes ihrer Felder auch zeichnen" in
                     konfiguration.spec.ts; das hier ist die sichtbare Notbremse,
                     falls doch etwas ausgeliefert wird.

                     NICHT class="was" — dieser Text ist keine Beschriftung,
                     sondern eine Stoermeldung. Der Suchbestand erhebt genau die
                     was-Spalte (tools/verwaltung-suchbestand.mjs, Muster
                     'stufe'), und beim ersten Anlauf landete hier deshalb ein
                     Eintrag „Art „ " — hier (noch) nicht einstellbar" in der
                     Suche: eine Beschriftung, die kein Mensch je sucht, mit
                     einem Loch, wo die Interpolation stand. -->
                <span class="hinweis">Art „{{ f.art }}" — hier (noch) nicht einstellbar</span>
              }
            </div>
            <p class="hinweis">{{ f.hinweis }}</p>
          }
          <p class="stand">{{ konfigStand() }}</p>
        </section>
      }
    }

    <!-- ══ HELLIGKEIT DES BILDSCHIRMS ═══════════════════════════════════════
         Das EINZIGE auf dieser Seite, was den Schirm der Box selbst betrifft
         und nicht das, was darauf gezeichnet wird. Es steht trotzdem hier und
         nicht auf der Systemseite: wer „zu hell" denkt, sucht unter
         „Darstellung", nicht unter „System".

         DER REGLER GEHT NICHT BIS NULL, und das entscheidet der SERVER. Die
         Grenzen kommen aus der Antwort (min/max/schritt) und stehen nicht hier
         — sonst gäbe es zwei Untergrenzen, und die in der Oberfläche wäre die,
         die man umgehen kann. Warum es überhaupt eine gibt, steht ausführlich
         in schirmhelligkeit.ts: ein schwarzes Display lässt sich AM GERÄT
         nicht mehr zurückdrehen.

         KEIN REGLER OHNE WIRKUNG: sagt der Server da:false (HDMI-Monitor,
         anderes Panel), erscheint der Regler gar nicht, sondern der Grund. Ein
         Schieber, der sich bewegen lässt und nichts bewirkt, ist schlimmer als
         keiner. -->
    @if (reiterAktiv() === 'box') {
      @if (helligkeitDa() !== null) {
        <section>
          <h2>Helligkeit des Bildschirms</h2>
          @if (helligkeitDa()) {
            @if (erklaerungen()) {
              <p class="hinweis">
                Gilt sofort und bleibt nach dem Ausschalten erhalten. Ganz dunkel geht mit Absicht nicht — am Gerät
                käme man aus einem schwarzen Bild nicht mehr heraus.
              </p>
            }
            <div class="zahl">
              <label for="h-schirm">Helligkeit</label>
              <input
                id="h-schirm"
                type="range"
                [min]="helligkeitMin()"
                [max]="helligkeitMax()"
                [step]="helligkeitSchritt()"
                [value]="helligkeit()"
                (input)="helligkeit.set(+$any($event.target).value)"
                (change)="helligkeitSetzen(+$any($event.target).value)"
              />
              <!-- DIE ZAHL IST EINE BEHAUPTUNG UEBER DAS GERAET — und wenn es
                   keine gibt, darf hier keine stehen. Kam prozent:null herein
                   (der Rohwert war nicht lesbar), stand hier bis zum 08.08.2026
                   „100 %": die Vorbelegung des Signals, die mangels Zahl niemand
                   ueberschrieben hatte. Das Backend hatte die Auskunft
                   ausdruecklich verweigert, die Oberflaeche gab sie trotzdem.
                   Jetzt steht dort „? %", und darunter der Satz. -->
              <output>{{ helligkeitAusgabe() }}</output>
            </div>
            <!-- DER REGLER ZEIGT NICHT IMMER, WAS DAS GERAET TUT.
                 Der Server klemmt den angezeigten Wert auf die Untergrenze —
                 steht das Panel darunter (die alte Seite kann 0 % schreiben),
                 stuende hier sonst „20 %" neben einem schwarzen Bildschirm.
                 DER KNOPF IST DER PUNKT: der Regler steht in dieser Lage bereits
                 ganz links, ein Zug auf 20 aendert seinen Wert nicht und loest
                 deshalb gar kein change-Ereignis aus. Ohne Knopf beginnt der
                 kuerzeste gedachte Weg zurueck mit einem Griff, der nichts
                 schickt. -->
            @if (helligkeitKlemmung().hinweis) {
              <p class="warnung">{{ helligkeitKlemmung().satz }}</p>
              <button type="button" (click)="helligkeitSetzen(helligkeitMin())">
                {{ helligkeitKlemmung().knopf }}
              </button>
            }
            <!-- AUSSAGEN UEBER DIE JETZIGE LAGE, nicht ueber die Einrichtung.
                 ALS SCHLEIFE UND NICHT ALS ZWEI @if: beide Lagen koennen zugleich
                 gelten (Schirm abgeschaltet UND Rohwert unlesbar), und dann
                 muessen beide Saetze dastehen. Der Wortlaut steht in
                 schirm-text.ts, damit er ohne Angular pruefbar ist. -->
            @for (satz of helligkeitLage(); track satz) {
              <p class="lage">{{ satz }}</p>
            }
            <p class="stand">{{ helligkeitStand() }}</p>
          } @else {
            <p class="hinweis">{{ helligkeitGrund() }}</p>
          }
        </section>
      }
    }

    <!-- OBEN: was die Vorschau selbst betrifft.

         DIE UEBERSCHRIFT IST NICHT KOSMETIK (nachgetragen 03.08.2026 beim
         Gegenlesen). tools/verwaltung-suchbestand.mjs gibt jedem Eintrag den
         ABSCHNITT der zuletzt gelesenen Ueberschrift. Bis hierher hatte diese
         Seite ihre erste Ueberschrift erst bei „Elemente", alles davor stand
         also mit leerem Abschnitt im Bestand. Mit dem neuen „Aus der
         Konfiguration der Box" ganz oben erbten neunzehn Eintraege — „Groesse",
         „Startseite der Box", „Thema", „Abgelegt", „Laenge", „Hoehe", „Abstand
         der Alben" … — genau diesen Abschnitt, obwohl keiner von ihnen dort
         steht. Die Suche schickte einen also in einen Abschnitt mit vier
         Konfigurationsfeldern und liess ihn dort weitersuchen. -->
    @if (reiterAktiv() === 'optik') {
      <section>
        <h2>Vorschau</h2>
        <div class="wahl" style="margin-bottom:0.6rem">
          <button type="button" [class.an]="seite() === '/'" (click)="seiteSetzen('/')">Startseite</button>
          <button type="button" [class.an]="seite() === '/player'" (click)="seiteSetzen('/player')">Player</button>
          <button type="button" (click)="neuLaden()">Neu laden</button>
        </div>
        <p class="hinweis" style="margin:0 0 0.6rem">
          Das Bild oben ist die echte Oberfläche unter <strong>/neu</strong>, kein Nachbau. Größen und Abstände:
          das Element im Bild antippen — dann erscheinen oben genau seine Regler.
        </p>
        <div class="zahl">
          <label for="v-mass">Größe</label>
          <input
            id="v-mass"
            type="range"
            min="0.3"
            [max]="maxMass()"
            step="0.05"
            [value]="mass()"
            (input)="massSetzen(+$any($event.target).value)"
          />
          <output>{{ (massEff() * 100).toFixed(0) }} %</output>
        </div>
      </section>
    }

    <!-- ══ THEMEN ═══════════════════════════════════════════════════════════
         Sichern und Verwerfen standen bis zum 22.08.2026 im Abschnitt
         „Vorschau" — mit der Begruendung, dort probiere man herum. Das stimmt
         weiter, nur ist die Vorschau jetzt IMMER zu sehen und steht ueber
         allen Reitern; die Begruendung traegt den gemeinsamen Abschnitt also
         nicht mehr. Ein eigener Reiter macht ausserdem sichtbar, dass ein
         Thema den GANZEN Stand ablegt und nicht nur die Vorschau betrifft. -->
    @if (reiterAktiv() === 'themen') {
      <section>
        <h2>Themen</h2>
        <!-- „Startseite der Box" stand bis 05.09.2026 hier — sie heisst jetzt
             Startkategorie und wohnt im Reiter „Verhalten", wo sie hingehoert. -->
        <div class="stufe">
          <span class="was">Thema</span>
          <input type="text" placeholder="Name" [value]="name()" (input)="name.set($any($event.target).value)" />
          <button type="button" class="klein" (click)="sichern()">Speichern</button>
          <button type="button" class="klein" (click)="zuruecksetzen()">
            {{ resetBereit() ? 'Wirklich?' : 'Zurücksetzen' }}
          </button>
        </div>
        @if (namen().length) {
          <div class="stufe">
            <span class="was">Abgelegt</span>
            @for (n of namen(); track n) {
              <button type="button" class="klein" (click)="laden(n)">{{ n }}</button>
              <!-- ⬇ als DATEI: mixpi-thema/1 (E120) — gestalten, herunterladen,
                   auf einer anderen Box hochladen. -->
              <button type="button" class="klein" (click)="themaHerunterladen(n)" title="Als Datei herunterladen">⬇</button>
              <!-- Die mitgelieferten drei lassen sich nicht loeschen: sie sind
                   der Rueckweg, wenn eine eigene Einstellung nicht gefaellt.
                   Aendern und speichern geht - dann gilt die eigene Fassung. -->
              @if (!mitgeliefert(n)) {
                <button type="button" class="klein weg" (click)="loeschen(n)">{{ weg() === n ? 'Wirklich?' : '✕' }}</button>
              }
            }
          </div>
        }
        <div class="stufe">
          <span class="was">Aus Datei</span>
          <!-- Reines JSON ueber FileReader + POST — kein Upload-Unterbau. Das
               Tor (pruefeThema) lehnt mit Saetzen ab; die stehen dann hier. -->
          <input type="file" accept=".json,application/json" #themaDatei (change)="themaHochladen(themaDatei)" />
          @if (importKonflikt()) {
            <button type="button" class="klein" (click)="themaErsetzen()">„{{ importKonflikt() }}" ersetzen</button>
            <button type="button" class="klein" (click)="importAbbrechen(themaDatei)">Abbrechen</button>
          }
        </div>
        @if (importStand()) {
          <p class="hinweis" style="margin:0.3rem 0 0; white-space: pre-line">{{ importStand() }}</p>
        }
        @if (erklaerungen()) {
          <p class="hinweis" style="margin-top:0.7rem">
            Ein Thema legt den <strong>ganzen</strong> Stand unter dem eingetippten Namen ab — auch das, was auf dieser
            Oberfläche gerade nichts tut. Ein vorhandener Name wird überschrieben.
          </p>
        }
      </section>
    }



    <!-- UNTEN steht nur noch, WAS zu sehen ist. Alles andere haengt an
         einem Element und erscheint, wenn man es im Bild antippt — eine lange
         Liste neben einer Vorschau ist zweimal dieselbe Auskunft. -->
    <!-- BEDIENUNG (E44): nicht wie etwas AUSSIEHT, sondern was ein TIPP tut.
         Es sind trotzdem Felder der Darstellung: sie reisen mit den Themen
         und gelten je Profil - genau das macht die MuPi-Bruecke als Thema
         moeglich. KEINE BACKTICKS IN DIESEM KOMMENTAR (Template-Literal). -->
    @if (reiterAktiv() === 'verhalten') {
      <section>
        <h2>Verhalten</h2>
        @if (erklaerungen()) {
          <p class="hinweis">
            Was ein Tipp auf der neuen Oberfläche tut — Teil des Themas, gilt je Profil. Das mitgelieferte Thema
            „MuPi-Brücke" (unter „Themen") stellt alles zusammen wie die alte MuPiBox-Bedienung: große Cover-Reihen,
            ein Tipp spielt.
          </p>
        }
        <!-- E121: DREI Wege statt des alten an/aus. albumTippSpielt wird
             MITGESCHRIEBEN ('spielt' zu true) — dieselbe Doppelschreibung wie
             im Uebersetzer (mixpi-thema.ts), damit Bestandsdaten stimmen.
             KEINE BACKTICKS IN DIESEM KOMMENTAR (Template-Literal). -->
        <div class="stufe">
          <span class="was">Album-Tipp</span>
          <button type="button" class="klein" [class.an]="w().albumTipp === 'lanes'"
                  (click)="setz({ albumTipp: 'lanes', albumTippSpielt: false })">Titelliste</button>
          <button type="button" class="klein" [class.an]="w().albumTipp === 'spielt'"
                  (click)="setz({ albumTipp: 'spielt', albumTippSpielt: true })">spielt sofort</button>
          <button type="button" class="klein" [class.an]="w().albumTipp === 'karte'"
                  (click)="setz({ albumTipp: 'karte', albumTippSpielt: false })">Titelkarte</button>
        </div>
        @if (erklaerungen()) {
          <p class="hinweis">
            Was ein Tipp auf ein Album tut (Interpretenseite, aufgeklappte Playlist): <strong>Titelliste</strong> öffnet
            die Reihe wie bisher. <strong>Spielt sofort</strong> startet ohne Liste, wie die alte MuPiBox.
            <strong>Titelkarte</strong> lässt die Titel als Karte aus der angetippten Kachel wachsen — der Flip der
            alten Oberfläche, als Überblendung. Die Startseite spielt immer sofort.
          </p>
        }
        <div class="stufe">
          <span class="was">Cover-Reihen</span>
          <button type="button" (click)="reihenSchritt(-0.05)">−</button>
          <span class="wert">{{ (w().reihenFaktor * 100).toFixed(0) }} %</span>
          <button type="button" (click)="reihenSchritt(0.05)">+</button>
          <button type="button" class="klein" (click)="setz({ reihenFaktor: 1 })">Standard</button>
          <button type="button" class="klein" (click)="setz({ reihenFaktor: 1.45 })">wie früher</button>
        </div>
        @if (erklaerungen()) {
          <p class="hinweis">Größe der Alben- und Titelreihen. 145 % entspricht den ~170-px-Covern der alten Oberfläche.</p>
        }
        <div class="stufe">
          <button
            type="button"
            [class.an]="w().vollbildBlaettern"
            (click)="setz({ vollbildBlaettern: !w().vollbildBlaettern })"
          >
            Vollbild-Blättern {{ w().vollbildBlaettern ? 'an' : 'aus' }}
          </button>
        </div>
        @if (erklaerungen()) {
          <p class="hinweis">
            An: die Auswahl zeigt ein Werk je Seite — großes Cover, gewischt wird seitenweise, jede Seite rastet ein.
            Aus: das Raster wie bisher.
          </p>
        }

        <!-- ══ E121: DIE UEBERNAHMEN — Verhalten der alten Box ════════════ -->
        <div class="stufe">
          <span class="was">Beim Verlassen der Titel</span>
          <button type="button" class="klein" [class.an]="w().beimVerlassen !== 'stopp'"
                  (click)="setz({ beimVerlassen: 'weiter' })">spielt weiter</button>
          <button type="button" class="klein" [class.an]="w().beimVerlassen === 'stopp'"
                  (click)="setz({ beimVerlassen: 'stopp' })">stoppt</button>
        </div>
        @if (erklaerungen()) {
          <p class="hinweis">
            Was passiert, wenn das Kind aus der Titelebene zurückgeht: weiterspielen wie bisher, oder anhalten wie die
            alte MuPiBox.
          </p>
        }
        <div class="stufe">
          <span class="was">Startkategorie</span>
          <button type="button" class="klein" [class.an]="w().startKategorie === 'alle'"
                  (click)="setz({ startKategorie: 'alle' })">keine</button>
          @for (k of seiten; track k.wert) {
            <button type="button" class="klein" [class.an]="w().startKategorie === k.wert"
                    (click)="setz({ startKategorie: k.wert })">{{ k.name }}</button>
          }
        </div>
        @if (erklaerungen()) {
          <p class="hinweis">Diese Kategorie öffnet die Box nach dem Start von selbst; „keine" lässt alles stehen.</p>
        }
        <div class="stufe">
          <span class="was">Kategorienleiste</span>
          <button type="button" class="klein" [class.an]="w().kategorien !== 'einer'"
                  (click)="setz({ kategorien: 'liste' })">Liste</button>
          <button type="button" class="klein" [class.an]="w().kategorien === 'einer'"
                  (click)="setz({ kategorien: 'einer' })">ein Knopf</button>
        </div>
        @if (erklaerungen()) {
          <p class="hinweis">
            „Ein Knopf" zeigt statt der Liste EINEN Knopf, der die Kategorien der Reihe nach durchschaltet — weniger
            Ziele für kleine Finger.
          </p>
        }

        <!-- ══ WISCHGESTEN VOM RAND ═══════════════════════════════════════
             Hier steht die GANZE Matrix: je Geste ein Rand und eine
             Fingerzahl, dazu die Randbreite. Der Eltern-Bereich auf der Box
             kann nur die einfache Form (ein Rand für alle drei) — dort war auf
             800x480 keine sechste Zeile mehr frei.

             EINE DOPPELBELEGUNG WIRD HIER NICHT VERHINDERT, sondern GEMELDET:
             Zwei Gesten auf demselben Rand mit derselben Fingerzahl sind
             einstellbar, und dann gewinnt die obere (so steht es in wischTat).
             Ein Board, das die zweite still auf „aus" zöge, nähme dem
             Bedienenden die Entscheidung ab; ein rotes Wort erklärt sie.

             KEINE BACKTICKS IN DIESEM KOMMENTAR. Er steht INNERHALB des
             Template-Literals der Komponente — ein Backtick beendet es, und die
             Datei bricht ab (llmwiki backticks-beenden-jede-vorlage). Genau das
             ist hier am 21.08.2026 passiert. -->
        <h3>Gesten</h3>

        <div class="stufe">
          <button type="button" [class.an]="w().zweiFinger" (click)="setz({ zweiFinger: !w().zweiFinger })">
            Zwei Finger {{ w().zweiFinger ? 'an' : 'aus' }}
          </button>
        </div>
        @if (erklaerungen()) {
          <p class="hinweis">
            Überall auf dem Schirm: hoch und runter regelt die Lautstärke, links und rechts blättert den Titel
            (links = vorwärts), ein Doppeltipp hält an und spielt weiter. Ein Finger rollt weiter wie bisher.
            Ab Werk aus — eine Bedienung, die man nicht sieht, soll man eingeschaltet haben.
          </p>
        }

        <div class="stufe">
          <button type="button" [class.an]="w().playerStreichen" (click)="setz({ playerStreichen: !w().playerStreichen })">
            Über den Player streichen {{ w().playerStreichen ? 'an' : 'aus' }}
          </button>
          @if (w().playerStreichen) {
            <span class="was">kommt zurück nach</span>
            <button type="button" (click)="playerZurueckSchritt(-5)">−</button>
            <span class="wert">{{ w().playerZurueckSek }} s</span>
            <button type="button" (click)="playerZurueckSchritt(5)">+</button>
          }
        </div>
        @if (erklaerungen()) {
          <p class="hinweis">
            Ein schnelles Streichen über das Kissen blendet es aus — die Geste liegt auf dem, was sie betrifft.
            Langsames Ziehen zählt nicht: darüber liegen drei Knöpfe, und ein Fehlgriff beim Zielen soll den Player
            nicht wegnehmen. Er kommt von selbst zurück; 0 s gibt es nicht.
          </p>
        }

        <div class="stufe">
          <button type="button" [class.an]="w().wischGesten" (click)="setz({ wischGesten: !w().wischGesten })">
            Vom Rand {{ w().wischGesten ? 'an' : 'aus' }}
          </button>
        </div>
        @if (erklaerungen()) {
          <p class="hinweis">
            Ein Zug vom Bildschirmrand nach innen. Er trägt heute genau eine Geste — das Schnellfenster. Ab Werk aus.
            Gilt nur für die neue Oberfläche.
          </p>
        }
        @if (w().wischGesten) {
          @for (t of wischTaten; track t.id) {
            <div class="stufe">
              <span class="was">{{ t.name }}</span>
              @for (r of wischRaender; track r) {
                <button type="button" class="klein" [class.an]="wischRand(t) === r" (click)="wischRandSetzen(t, r)">
                  {{ r }}
                </button>
              }
              @if (wischRand(t) !== 'aus') {
                @for (f of wischFingerzahlen; track f) {
                  <button type="button" class="klein" [class.an]="wischFinger(t) === f" (click)="wischFingerSetzen(t, f)">
                    {{ f }} F
                  </button>
                }
              }
            </div>
            <p class="hinweis">
              {{ t.hinweis }}
              @if (wischDoppelt(t.id)) {
                <strong> — Achtung: dieselbe Belegung wie „{{ wischDoppelt(t.id) }}". Dort wirkt sie nicht mehr.</strong>
              }
            </p>
          }
          <div class="stufe">
            <span class="was">Randstreifen</span>
            <button type="button" (click)="wischRandSchritt(-4)">−</button>
            <span class="wert">{{ w().wischRandBreite }} px</span>
            <button type="button" (click)="wischRandSchritt(4)">+</button>
            <button type="button" class="klein" (click)="setz({ wischRandBreite: 28 })">Standard</button>
          </div>
          @if (erklaerungen()) {
            <p class="hinweis">
              Wie breit der Streifen am Rand ist, in dem ein Zug beginnen muss. Schmaler ist schwerer zu treffen,
              breiter reicht in die Bedienelemente daneben. Die Box deckelt ihn auf ein Viertel der kürzeren Kante.
            </p>
          }
          @if (erklaerungen()) {
            <p class="hinweis">
              Rechts ist der einzige freie Rand der neuen Oberfläche: links liegt die Kategorienleiste, unten das
              Kissen, oben die Kopfzeile. Links mit EINEM Finger holt außerdem die eingefahrene Leiste zurück — diese
              Geste hat dort Vorrang, solange die Leiste weg ist.
            </p>
          }
        }
      </section>
    }

    <!-- ELEMENTE: alles, was auf dem Schirm liegen kann, in drei Gruppen.
         Vorher war es eine lange Liste, in der der Mini-Player neben der
         Wolke stand — Dinge, die man nie zusammen sucht. Jetzt fragt man
         zuerst WELCHES Element, dann dessen Regler. -->
    @if (reiterAktiv() === 'optik') {
      <section>
        <div class="reiter">
          @for (g of optikTeile(); track g.id) {
            <button type="button" [class.an]="optikTeilEff() === g.id" (click)="optikTeil.set(g.id)">
              {{ g.name }}
            </button>
          }
        </div>
      <!-- ══ FARBEN DER NEUEN OBERFLAECHE ═══════════════════════════════════
           Wo die Werte landen und warum ausgerechnet dort, steht ausfuehrlich
           in farbthema.ts im Backend. Was hier gezeigt wird, hat KEINE eigene
           Liste von Vorgabewerten: farbVorgaben wird aus /neu/app.css gelesen,
           also aus genau der Datei, die die Oberflaeche selbst liest. Zwei
           gepflegte Listen liefen auseinander [[drei-orte-eine-anzeige]].
           KEINE BACKTICKS IN DIESER VORLAGE — sie steht in einem
           Template-Literal, und der erste beendet es mitten im HTML. Beim
           Schreiben genau dieses Kommentars prompt passiert (TS1005), obwohl
           die Warnung zwei Abschnitte weiter unten schon dasteht. -->
      @if (optikTeilEff() === 'farben') {
          @if (farbVorgabenDa()) {
            @if (erklaerungen()) {
              <p class="hinweis">
                Gilt für den <strong>hellen</strong> Stand der neuen Oberfläche. Der dunkle behält seine eigenen Farben —
                sonst leuchtete die Box abends hell. Abgelegt wird es in einer festen Datei auf der Box
                (mixpi-farben.css) und gilt unabhängig vom gewählten Farbsatz.
              </p>
            }
            <!-- farbFelder() und NICHT FARBFELDER: ein Feld, dessen Vorgabe nicht
                 in app.css steht, kann nicht sagen, ob es abweicht — es stuende
                 auf Schwarz und behauptete „wie ausgeliefert". -->
            @for (f of farbFelder(); track f.v) {
              <div class="stufe">
                <span class="was">{{ f.name }}</span>
                <input
                  type="color"
                  [value]="farbe(f.v)"
                  (input)="farbeSetzen(f.v, $any($event.target).value)"
                  [attr.aria-label]="f.name"
                />
                <span class="farbwert" [class.farbe-eigen]="istEigen(f.v)" [class.farbe-vorgabe]="!istEigen(f.v)">
                  {{ farbe(f.v) }}
                </span>
                @if (istEigen(f.v)) {
                  <button type="button" class="klein" (click)="farbeLoesen(f.v)">zurück</button>
                } @else {
                  <span class="hinweis" style="margin:0">wie ausgeliefert</span>
                }
                <span class="hinweis" style="margin:0">{{ f.wozu }}</span>
              </div>
            }

            <!-- DIE ZAHL STEHT DA, DAS VERBOT NICHT. Ein Waehler, der jede Farbe
                 erlaubt, erlaubt auch Grau auf Grau — das zu verbieten hiesse, dem
                 Betreiber eine Entscheidung abzunehmen, die ihm gehoert. Also wird
                 gemessen und hingeschrieben, was Sache ist. -->
            <p class="hinweis" style="margin-top:0.7rem">
              Schlechtester Kontrast der Schrift: <strong>{{ kontrastText() }}</strong>. WCAG&nbsp;2.1 verlangt 4,5&nbsp;:&nbsp;1
              für gewöhnlichen Text — auf zwei Meter Abstand und für Kinderaugen ist mehr besser.
              @if (kontrastWert() < 4.5) {
                <strong> Darunter ist der Text auf der Box schwer zu lesen.</strong>
              }
            </p>
            <!-- Nicht verschweigen, was mitgeschrieben wird: solche Werte stehen
                 im Farbthema, gehen bei jedem Speichern mit zurueck in die Datei
                 und faerben womoeglich weiter — nur zeigen kann der Waehler sie
                 nicht, weil er ihre Vorgabe nicht kennt. -->
            @if (farbUnbekannt().length > 0) {
              <p class="hinweis">
                Im Farbthema stehen ausserdem Farben, die diese Oberfläche nicht (mehr) kennt:
                <strong>{{ farbUnbekannt().join(', ') }}</strong>. Sie werden hier nicht angezeigt, aber beim Speichern
                mitgeschrieben. „Alle Farben zurücksetzen" entfernt auch sie.
              </p>
            }
            <div class="stufe">
              <button type="button" class="klein" (click)="farbenZuruecksetzen()">
                {{ farbResetBereit() ? 'Wirklich?' : 'Alle Farben zurücksetzen' }}
              </button>
            </div>
            <p class="stand">{{ farbStand() }}</p>
          } @else {
            <!-- OHNE VORGABEN KEIN WAEHLER. Es gaebe sonst Farbfelder, die auf
                 Schwarz stehen, weil app.css nicht gelesen werden konnte — und der
                 erste Klick schriebe dieses Schwarz in die Box. -->
            <p class="hinweis">{{ farbStand() }}</p>
          }
      }

        @if (optikTeilEff() === 'mp') {
          <div class="wahl">
            <button type="button" [class.an]="w().miniPlayer > 0" (click)="sichtbarUmschalten('mp')">
              Mini-Player {{ w().miniPlayer > 0 ? 'an' : 'aus' }}
            </button>
            <button type="button" [class.an]="w().statusLeiste" (click)="setz({ statusLeiste: !w().statusLeiste })">
              Fortschrittsstreifen {{ w().statusLeiste ? 'an' : 'aus' }}
            </button>
            <!-- DIE WELLEN STEHEN BEIM STREIFEN, DEN SIE BEWEGEN (Betreiber,
                 30.08.2026: "der schalter ist nicht da ich haette ihn im
                 player vermutet darstellung player" - die erste Fassung lag
                 im Verhalten-Reiter bei Vollbild-Blaettern). Optik heisst:
                 wie es aussieht - und Wellen sind Aussehen. Sie folgen nur
                 dem Wiedergabezustand, keine Tonanalyse (der Ton laeuft auf
                 der Box, nicht im Browser). -->
            <button
              type="button"
              [class.an]="w().statusWellen"
              (click)="setz({ statusWellen: !w().statusWellen })"
              title="Die Fortschrittszeile des großen Players bewegt sich wellenartig, solange Musik läuft"
            >
              Wellen im Player {{ w().statusWellen ? 'an' : 'aus' }}
            </button>
            @if (w().statusWellen) {
              <button
                type="button"
                [class.an]="w().wellenRegenbogen"
                (click)="setz({ wellenRegenbogen: !w().wellenRegenbogen })"
                title="Die Wellenlinien laufen durch alle Farben statt in der Themenfarbe"
              >
                Wellen in Regenbogenfarben {{ w().wellenRegenbogen ? 'an' : 'aus' }}
              </button>
            }
            <!-- DER PUNKT AUF DEM FORTSCHRITT (Wunsch der Tochter, 15.08.2026:
                 „beim fortschrittsbalken noch einen punkt in verschiedenen
                 farben"). Er reitet auf dem Ende der Fuellung und wandert von
                 selbst mit; die Farbe steht hier. Die Kennungen sind dieselben
                 wie in NewDesign/app.js und app.css. -->
            <label class="fp-wahl">
              Punkt auf dem Balken
              <select [value]="w().fortschrittPunkt || ''" (change)="setz({ fortschrittPunkt: $any($event.target).value })">
                <option value="">kein Punkt</option>
                @for (f of FORTSCHRITT_PUNKTE; track f.id) {
                  <option [value]="f.id">{{ f.wort }}</option>
                }
              </select>
            </label>
            <!-- FORM UND FARBE SIND ZWEI SACHEN: die Form kommt als Maske, die
                 Farbe fuellt sie — ein pinkes Einhorn und ein blauer Bagger
                 kosten keine zweite Zeichnung. Die Form wirkt nur, wenn eine
                 Farbe gewaehlt ist; das steht am Feld. -->
            <label class="fp-wahl">
              Form
              <!-- NICHT MEHR GESPERRT (15.08.2026): Wer ein Einhorn waehlt,
                   will ein Einhorn sehen — ohne erst eine Farbe suchen zu
                   muessen. Ohne Farbe gilt der Player-Akzent. -->
              <select
                [value]="w().fortschrittForm || ''"
                title="Die Form des Punktes. Ohne eigene Farbe trägt sie den Akzent des Players."
                (change)="setz({ fortschrittForm: $any($event.target).value })"
              >
                <!-- NUR die value-Bindung AM SELECT, KEIN selected an den
                     Optionen (Betreiber 16.08.2026: „die zuordnung ist
                     verschoben ... wenn auto gemalt angezeigt wird ist bonbon
                     ausgewählt"). Beides zusammen streitet sich: der Browser
                     waehlt nach dem selected-Attribut, Angular setzt danach den
                     Wert am Select — und je nachdem, was zuletzt greift, zeigt
                     das Feld etwas anderes an als gilt. Eine Quelle genuegt. -->
                @for (f of FORTSCHRITT_FORMEN; track f.id) {
                  <option [value]="f.id">{{ f.wort }}</option>
                }
              </select>
            </label>
            <button type="button" [class.an]="w().endeZeit" (click)="setz({ endeZeit: !w().endeZeit })">
              „endet um" {{ w().endeZeit ? 'an' : 'aus' }}
            </button>
            <button type="button" [class.an]="w().platzBeimBlaettern"
                    (click)="setz({ platzBeimBlaettern: !w().platzBeimBlaettern })">
              Platz beim Blättern {{ w().platzBeimBlaettern ? 'an' : 'aus' }}
            </button>
            <!-- „Ganze Diskografie" und „Doppelte zusammenfassen" STANDEN HIER
                 bis zum 03.08.2026 und sind nach „Medien" gewandert (G5).
                 BEGRUENDUNG, je Punkt einzeln:
                   Ganze Diskografie loest NETZABRUFE aus — je erkanntem
                   Interpreten einen bei Spotify. Was Daten holt, ist keine
                   Darstellung.
                   Doppelte zusammenfassen aendert die ANZAHL der Werke: aus
                   zwei Kacheln wird eine. Es raeumt den Bestand auf, es faerbt
                   ihn nicht.
                 Beide liegen weiterhin in derselben Ablage (darstellung.json) —
                 es ist die BEDIENUNG gewandert, nicht der Speicherort. Damit
                 reist kein Feld durch pruefen() und keine Box verliert still
                 ihre Einstellung. -->
            <!-- Der Knopf sagt, was der Benutzer SIEHT (bewegt sich / steht still),
                 nicht wie das Feld heisst. Das Feld ruhigeMarke ist negativ
                 benannt, damit die Vorgabe false „Bewegung" heisst — die
                 Begruendung steht in darstellung.service.ts.
                 KEINE BACKTICKS IN DIESER VORLAGE: Sie steht in einem
                 Template-Literal, ein Backtick beendet es mitten im HTML. Beim
                 Schreiben dieses Kommentars prompt passiert (TS1005). -->
            <button type="button" [class.an]="!w().ruhigeMarke"
                    (click)="setz({ ruhigeMarke: !w().ruhigeMarke })">
              Spielt-Marke {{ w().ruhigeMarke ? 'steht still' : 'bewegt sich' }}
            </button>
          </div>
          <!-- Hier standen die zehn BAUFORMEN-Kaertchen (mpVariante) der
               klassischen Oberflaeche — mit ihr gefallen (05.09.2026). -->

          <!-- ══ E129: DIE BUEHNE UEBER DEN TASTEN ═══════════════════════
               Betreiber 05.09.2026: die Bedienelemente sollen dauerhaft
               hochruecken, und der Platz darunter traegt umschaltbar Welle,
               Songtext oder Titel. Deshalb EINE Reihe zur Wahl und kein
               Schalter: es kommen weitere Bewohner dazu. -->
          <div class="stufe" style="margin-top:0.7rem">
            <span class="was">Bühne über den Tasten</span>
            @for (b of buehnenBewohner; track b.id) {
              <button type="button" class="klein" [class.an]="w().buehne === b.id"
                      (click)="setz({ buehne: b.id })">{{ b.wort }}</button>
            }
          </div>
          @if (erklaerungen()) {
            <p class="hinweis">
              Rückt die Bedienelemente dauerhaft nach oben und zeigt darunter <strong>eines</strong>:
              die Frequenz-Wellen, den Songtext des laufenden Stücks (findet sich nicht immer — bei Hörspielen
              so gut wie nie) oder die Titel des laufenden Albums. „Aus“ lässt den Player wie bisher.
            </p>
          }
          @if (w().buehne !== 'aus') {
            <div class="stufe">
              <span class="was">Höhe der Bühne</span>
              @for (s of dreiStufen; track s) {
                <button type="button" class="klein" [class.an]="w().wellenHub === s"
                        (click)="setz({ wellenHub: s })">{{ s }}</button>
              }
              @if (w().buehne === 'wellen') {
                <span class="was">Tempo</span>
                @for (s of dreiStufen; track s) {
                  <button type="button" class="klein" [class.an]="w().wellenTempo === s"
                          (click)="setz({ wellenTempo: s })">{{ s }}</button>
                }
              }
            </div>
          }
          <!-- E121/Eltern-Bereich-Angleich: Glas, Akzent und die zwei
               Textzeilen des Kissens — bislang nur an der Box stellbar. -->
          <div class="stufe" style="margin-top:0.7rem">
            <span class="was">Glasflächen</span>
            <button type="button" class="klein" [class.an]="w().mpGlas" (click)="setz({ mpGlas: !w().mpGlas })">
              Kissen {{ w().mpGlas ? 'an' : 'aus' }}
            </button>
            <button type="button" class="klein" [class.an]="w().grossGlas" (click)="setz({ grossGlas: !w().grossGlas })">
              großer Player {{ w().grossGlas ? 'an' : 'aus' }}
            </button>
          </div>
          <div class="stufe">
            <span class="was">Akzent des Players</span>
            @for (a of playerAkzente; track a.id) {
              <button type="button" class="klein" [class.an]="w().playerAkzent === a.id"
                      (click)="setz({ playerAkzent: a.id })">{{ a.wort }}</button>
            }
          </div>
          <div class="stufe">
            <span class="was">Zeilen im Kissen</span>
            <button type="button" class="klein" [class.an]="w().spielTitel" (click)="setz({ spielTitel: !w().spielTitel })">
              Titel {{ w().spielTitel ? 'an' : 'aus' }}
            </button>
            <button type="button" class="klein" [class.an]="w().spielAlbum" (click)="setz({ spielAlbum: !w().spielAlbum })">
              Album {{ w().spielAlbum ? 'an' : 'aus' }}
            </button>
          </div>
        }

        @if (optikTeilEff() === 'kacheln') {
          <div class="wahl">
            <button type="button" [class.an]="w().bezeichnung" (click)="setz({ bezeichnung: !w().bezeichnung })">
              Namen unter den Alben {{ w().bezeichnung ? 'an' : 'aus' }}
            </button>
          </div>
          @if (w().bezeichnung) {
            <div class="stufe" style="margin-top:0.7rem">
              <span class="was">Abstand Name↔Bild</span>
              <button type="button" (click)="schritt('namenAbstand', -2)">−</button>
              <span class="wert">{{ w().namenAbstand }} px</span>
              <button type="button" (click)="schritt('namenAbstand', 2)">+</button>
              <button type="button" class="klein" (click)="setz({ namenAbstand: 0 })">Standard</button>
            </div>
          }
          <div class="stufe" style="margin-top:0.7rem">
            <span class="was">Albumkacheln</span>
            <button type="button" [class.an]="w().kachelForm === 'rund'" (click)="setz({ kachelForm: 'rund' })">rund</button>
            <button type="button" [class.an]="w().kachelForm === 'abgerundet'" (click)="setz({ kachelForm: 'abgerundet' })">
              abgerundet
            </button>
            <button type="button" [class.an]="w().kachelForm === 'eckig'" (click)="setz({ kachelForm: 'eckig' })">eckig</button>
          </div>
          <div class="stufe">
            <span class="was">Umrandung</span>
            <button type="button" [class.an]="w().kachelRand" (click)="setz({ kachelRand: !w().kachelRand })">
              {{ w().kachelRand ? 'an' : 'aus' }}
            </button>
            @if (w().kachelRand) {
              <input
                type="color"
                [value]="w().kachelRandFarbe"
                (input)="setz({ kachelRandFarbe: $any($event.target).value })"
                aria-label="Farbe der Umrandung"
              />
              <input
                type="range" min="1" max="16" step="1"
                [value]="w().kachelRandBreite"
                (input)="setz({ kachelRandBreite: +$any($event.target).value })"
                aria-label="Breite der Umrandung"
              />
              <span class="wert">{{ w().kachelRandBreite }} px</span>
            }
          </div>
          <!-- „Startseite" (startAufbau) und „Kategorien oben" (reihe/knoepfe/
               aus) waren Felder der klassischen Oberflaeche — mit ihr gefallen
               (05.09.2026). Die Kategorienleiste als EIN Knopf (kategorien:
               'einer') lebt weiter und wohnt im Reiter „Verhalten". -->
        }

        @if (optikTeilEff() === 'anzeigen') {
          <!-- Die alte Tabelle (kopfIcons: an? wo? Reihenfolge?) gehoerte der
               klassischen Kopfzeile — mit ihr gefallen (05.09.2026). Die neue
               Oberflaeche hat EINE Kopfzeile: Mitte Uhr/Zeiten, rechts die
               Standanzeigen; hier steht nur noch an/aus je Anzeige. -->
          <div class="stufe">
            <span class="was">Mitte der Kopfzeile</span>
            <button type="button" class="klein" [class.an]="w().uhrzeit" (click)="setz({ uhrzeit: !w().uhrzeit })">
              Uhr {{ w().uhrzeit ? 'an' : 'aus' }}
            </button>
            <!-- Der zweite Schalter zur Uhr und nicht zum Vorlesen: Er wirkt an
                 DIESER Anzeige, und er wirkt nur mit ihr. Dieselbe Zeile steht
                 im Eltern-Bereich der Box („Uhrzeit ansagen"). -->
            <button type="button" class="klein" [class.an]="w().uhrzeitSprechen"
                    [disabled]="!w().uhrzeit"
                    (click)="setz({ uhrzeitSprechen: !w().uhrzeitSprechen })">
              Tipp sagt die Zeit {{ w().uhrzeitSprechen ? 'an' : 'aus' }}
            </button>
            <button type="button" class="klein" [class.an]="w().restzeit" (click)="setz({ restzeit: !w().restzeit })">
              Restzeit des Stücks {{ w().restzeit ? 'an' : 'aus' }}
            </button>
            <button type="button" class="klein" [class.an]="w().titelRest" (click)="setz({ titelRest: !w().titelRest })">
              Titel-Rest {{ w().titelRest ? 'an' : 'aus' }}
            </button>
            <button type="button" class="klein" [class.an]="w().schlummer" (click)="setz({ schlummer: !w().schlummer })">
              Schlummer-Rest {{ w().schlummer ? 'an' : 'aus' }}
            </button>
          </div>
          @if (erklaerungen()) {
            <p class="hinweis" style="margin:0.4rem 0 0">
              Restzeit und Schlummer erscheinen nur, wenn es etwas zu zeigen gibt — ein „0:00" wäre eine Behauptung.
              „Tipp sagt die Zeit" braucht die Uhr und eine eingerichtete Sprachausgabe (Seite „Vorlesen").
            </p>
          }
          <div class="stufe" style="margin-top:0.6rem">
            <span class="was">Standanzeigen rechts</span>
            <button type="button" class="klein" [class.an]="w().stAkku" (click)="setz({ stAkku: !w().stAkku })">Akku</button>
            <button type="button" class="klein" [class.an]="w().stLautstaerke"
                    (click)="setz({ stLautstaerke: !w().stLautstaerke })">Lautstärke</button>
            <button type="button" class="klein" [class.an]="w().stInternet"
                    (click)="setz({ stInternet: !w().stInternet })">Internet</button>
            <button type="button" class="klein" [class.an]="w().stWlan" (click)="setz({ stWlan: !w().stWlan })">WLAN</button>
            <button type="button" class="klein" [class.an]="w().stBluetooth"
                    (click)="setz({ stBluetooth: !w().stBluetooth })">Bluetooth</button>
          </div>
          <div class="stufe" style="margin-top:0.6rem">
            <span class="was">Bluetooth-Ladestand</span>
            <button type="button" class="klein" [class.an]="w().btAkku === 'prozent'"
                    (click)="setz({ btAkku: 'prozent' })">Prozent</button>
            <button type="button" class="klein" [class.an]="w().btAkku === 'aus'"
                    (click)="setz({ btAkku: 'aus' })">aus</button>
          </div>
          @if (erklaerungen()) {
            <p class="hinweis" style="margin:0.4rem 0 0">
              Erscheint nur bei Geräten, die ihn selbst melden — Kopfhörer meist ja,
              Lautsprecher am Netzteil meist nicht.
            </p>
          }
        }

        @if (erklaerungen()) {
          <p class="hinweis" style="margin:0.7rem 0 0">
            Größen und Abstände: das Element im Bild antippen — dann erscheinen oben genau seine Regler.
          </p>
        }
      </section>
    }
      </div>
    </div>
  `,
})
export class DarstellungSeite {
  protected readonly stufen = STUFEN
  /**
   * Die Farben des Fortschritts-Punktes. DIESELBEN KENNUNGEN wie in
   * NewDesign/app.js (FORTSCHRITT_PUNKTE) und app.css (body.fp-…) — wer hier
   * eine hinzufuegt, muss sie dort ebenfalls eintragen, sonst waehlt man eine
   * Farbe, die es im Stilblatt nicht gibt, und der Punkt bleibt unsichtbar.
   */
  /**
   * Die Formen des Punktes — dieselben Kennungen wie in NewDesign/app.js
   * (FORTSCHRITT_FORMEN) und app.css (body.ff-…). Wer hier eine hinzufuegt,
   * muss die Silhouette dort zeichnen, sonst waehlt man eine Form, die es
   * im Stilblatt nicht gibt.
   */
  protected readonly FORTSCHRITT_FORMEN = [
    { id: '', wort: 'runder Punkt' },
    { id: 'einhorn', wort: 'Einhorn' },
    { id: 'auto', wort: 'Auto' },
    { id: 'bagger', wort: 'Bagger' },
    { id: 'fussball', wort: 'Fußball' },
    { id: 'bonbon', wort: 'Bonbon' },
    // DIE GEMALTEN (16.08.2026): sie bringen ihre eigenen Farben mit, die
    // Farbwahl darunter gilt fuer sie also nicht. Das steht als Zusatz im
    // Namen, damit es nicht erst beim Ausprobieren auffaellt. Die Liste muss
    // zu FORTSCHRITT_FORMEN in NewDesign/app.js passen.
    { id: 'b-auto', wort: 'Auto (gemalt, eigene Farbe)' },
    { id: 'b-katze', wort: 'Katze (gemalt, eigene Farbe)' },
    { id: 'b-hund', wort: 'Hund (gemalt, eigene Farbe)' },
    { id: 'b-bagger', wort: 'Bagger (gemalt, eigene Farbe)' },
    { id: 'b-geist', wort: 'Geist (gemalt, eigene Farbe)' },
    { id: 'b-meerjungfrau', wort: 'Meerjungfrau (gemalt, eigene Farbe)' },
    { id: 'b-rakete', wort: 'Rakete (gemalt, eigene Farbe)' },
    { id: 'b-einhorn', wort: 'Einhorn (gemalt, eigene Farbe)' },
  ]

  protected readonly FORTSCHRITT_PUNKTE = [
    { id: 'akzent', wort: 'wie der Player' },
    { id: 'bernstein', wort: 'Bernstein' },
    { id: 'koralle', wort: 'Koralle' },
    { id: 'gruen', wort: 'Grün' },
    { id: 'blau', wort: 'Blau' },
    { id: 'pink', wort: 'Pink' },
    { id: 'lila', wort: 'Lila' },
    { id: 'weiss', wort: 'Weiß' },
  ]
  protected readonly seiten = [
    { wert: 'audiobook', name: 'Hörbuch' },
    { wert: 'music', name: 'Musik' },
    { wert: 'other', name: 'Sonstiges' },
  ]
  /** Wellen-Hub und -Tempo: drei Stufen, wie wellenStufe() in app.js sie liest. */
  protected readonly dreiStufen = [1, 2, 3]
  /**
   * E129: die Bewohner der Bühne — DIESELBEN Kennungen wie BUEHNE_BEWOHNER in
   * NewDesign/app.js und die Wahl in mixpi-thema.ts (player.buehne). Wer hier
   * einen hinzufügt, trägt ihn an beiden anderen Stellen nach; sonst lässt
   * sich etwas wählen, das die Box nicht kennt.
   */
  protected readonly buehnenBewohner = [
    { id: 'aus', wort: 'aus' },
    { id: 'wellen', wort: 'Wellen' },
    { id: 'songtext', wort: 'Songtext' },
    { id: 'titel', wort: 'Titel des Albums' },
  ]
  /** DIESELBEN Kennungen wie PLAYER_AKZENTE in NewDesign/app.js. */
  protected readonly playerAkzente = [
    { id: 'bernstein', wort: 'Bernstein' },
    { id: 'koralle', wort: 'Koralle' },
    { id: 'gruen', wort: 'Grün' },
    { id: 'blau', wort: 'Blau' },
  ]
  /**
   * Verkleinerung der Vorschau — 800px passen auf keinen Beistelltisch.
   *
   * Bleibt im Browser der VERWALTUNG (nicht auf der Box): das ist die
   * Bequemlichkeit dessen, der gerade davorsitzt, und hat mit dem Aussehen
   * der Box nichts zu tun.
   */
  protected readonly mass = signal(this.massHolen())

  /**
   * Wie breit die Seite gerade ist.
   *
   * Wird bei jeder Fensteraenderung nachgefuehrt — davon haengt ab, wie gross
   * die Vorschau ueberhaupt werden DARF. Ohne das waere „passt sich an" eine
   * Behauptung: der Regler liesse 120 % zu, und auf einem schmalen Fenster
   * ragte das Bild hinaus.
   */
  protected readonly breite = signal(typeof window === 'undefined' ? 1200 : window.innerWidth)

  /**
   * Der groesste Zoom, der hier noch hineinpasst.
   *
   * SEIT DER WERKBANK (22.08.2026) GEHOERT DER LEINWAND NICHT MEHR DAS GANZE
   * FENSTER. Rechts steht die Reglerspalte, und wer das uebersieht, laesst die
   * Vorschau nach der vollen Breite rechnen: sie beansprucht dann Platz, den
   * das Raster ihr nicht gibt, und die Regler werden zusammengedrueckt.
   *
   * DIE DREI ZAHLEN MUESSEN ZUM CSS PASSEN — sie stehen dort im
   * @media-Block und in grid-template-columns. Zwei Orte, das ist wahr; ein
   * dritter waere eine CSS-Variable, die TypeScript erst wieder auslesen
   * muesste. Laufen sie auseinander, ist der Schaden klein und sichtbar (die
   * Vorschau ist etwas zu gross oder zu klein), nicht still.
   */
  private static readonly WERKBANK_AB = 1100
  private static readonly REGLER_MIN = 420
  private static readonly SPALT = 16

  protected readonly maxMass = computed(() => {
    // 3rem Rand fuer die Seitenpolsterung, dann in 5er-Schritten abrunden —
    // sonst stimmt der Reglerwert nie genau mit seinem Maximum ueberein.
    const b = this.breite()
    const zweiSpalten = b >= DarstellungSeite.WERKBANK_AB
    const abzug = zweiSpalten ? 48 + DarstellungSeite.REGLER_MIN + DarstellungSeite.SPALT : 48
    const platz = Math.max(240, b - abzug)
    return Math.max(0.3, Math.min(1.2, Math.floor((platz / 800) * 20) / 20))
  })

  /**
   * Der WIRKSAME Zoom: der eingestellte, gedeckelt auf das, was passt.
   *
   * Der eingestellte Wert bleibt unangetastet — wird das Fenster wieder
   * breiter, ist er noch da. Ein Wert, den das Fenster einmal weggeklemmt
   * hat, waere sonst dauerhaft verloren.
   */
  protected readonly massEff = computed(() => Math.min(this.mass(), this.maxMass()))

  /** Das Feld haelt den Platz der GROESSTEN hier moeglichen Vorschau. */
  protected readonly feldBreite = computed(() => 800 * this.maxMass() + 4)
  protected readonly feldHoehe = computed(() => 480 * this.maxMass() + 4)

  protected readonly w = signal<Darstellung>(STANDARD)
  protected readonly themen = signal<Record<string, Darstellung>>({})
  protected readonly namen = computed(() => Object.keys(this.themen()).sort())
  /**
   * Mitgeliefert und damit nicht löschbar — DIE LISTE KOMMT VOM SERVER.
   *
   * Hier stand eine Handkopie mit dem Kommentar „dieselbe Liste wie im
   * Server". Sie WAR es nicht mehr: mit „MuPi-Brücke" (E44, 19.08.2026) kam
   * ein viertes mitgeliefertes Thema dazu, und diese Zeile blieb bei drei.
   * Die Folge war eine Oberfläche, die Löschen anbietet, wo der Server es
   * verweigert — der Betreiber drückt, und nichts passiert.
   *
   * Der Server schickt die Namen ohnehin mit (`auslieferung` in
   * GET /api/darstellung, dort für „ein überschriebenes Thema zurückholen").
   * Damit gibt es wieder EINE Wahrheit, und das nächste mitgelieferte Thema
   * kommt ohne eine einzige Zeile hier an.
   */
  private readonly fest = signal<string[]>([])
  protected mitgeliefert(n: string): boolean {
    return this.fest().includes(n)
  }
  protected readonly name = signal('')
  protected readonly weg = signal<string | null>(null)
  protected readonly resetBereit = signal(false)
  protected readonly stand = signal('Lade …')

  // ── Felder aus der KONFIGURATIONSDATEI (nicht aus dem Thema) ────────────
  /**
   * Was man SIEHT, aber was in mupiboxconfig.json steht: Farbthema, Vollbild,
   * weicher Bildlauf und die Wahl der Oberflaeche.
   *
   * WARUM NICHT EINFACH IN darstellung.json MITSPEICHERN: diese vier haben
   * andere Leser. `mupibox.oberflaeche` liest chromium-autostart.sh beim
   * Hochfahren mit `jq`, lange bevor irgendein Browser laeuft; `mupibox.theme`
   * liest die Box-Oberflaeche selbst. Ein Umzug in die Themen-Ablage haette
   * jedem dieser Leser die Grundlage weggenommen.
   *
   * WELCHE Felder es sind, entscheidet der SERVER (Bereich 'darstellung' in
   * konfiguration.ts). Stuende die Liste hier, gaebe es zwei Wahrheiten.
   */
  protected readonly konfigFelder = signal<KonfigFeld[]>([])
  protected readonly konfigStand = signal('')

  // ── Helligkeit des Bildschirms ─────────────────────────────────────────
  /**
   * `null` heisst „noch nicht gefragt" und ist NICHT dasselbe wie `false`.
   *
   * Ohne diesen dritten Zustand blitzte beim Laden der Seite kurz „Dieser
   * Bildschirm laesst sich nicht dimmen" auf, bevor die Antwort da war — eine
   * Aussage ueber die Hardware, die man beim Vorbeiscrollen liest und die
   * falsch ist. Solange `null` gilt, steht der ganze Abschnitt nicht da.
   */
  protected readonly helligkeitDa = signal<boolean | null>(null)
  protected readonly helligkeit = signal(100)
  /**
   * Die Grenzen kommen vom SERVER und werden hier nur vorbelegt.
   *
   * Die Vorbelegung ist absichtlich die UNGEFAEHRLICHE: 100/100/5 laesst gar
   * nichts verstellen. Sollte die Antwort einmal ohne Grenzen kommen, ist der
   * Regler damit nutzlos — aber er kann die Box nicht verdunkeln. Die
   * umgekehrte Vorbelegung (0…100) waere genau die Falle, gegen die die
   * Untergrenze gebaut ist.
   */
  protected readonly helligkeitMin = signal(100)
  protected readonly helligkeitMax = signal(100)
  protected readonly helligkeitSchritt = signal(5)
  protected readonly helligkeitSchirmAus = signal(false)
  protected readonly helligkeitGrund = signal('')
  protected readonly helligkeitStand = signal('')
  /**
   * WAS DAS GERAET WIRKLICH TUT — nicht, was der Regler zeigen darf.
   *
   * Der Server klemmt den ANGEZEIGTEN Wert auf die Untergrenze (mit gutem
   * Grund, siehe schirmhelligkeit.ts). Ohne diese beiden Felder waere die
   * Verwaltung in genau einer Lage eine Luege: Geraet auf 0, Anzeige „20 %",
   * Schirm schwarz — und wer hier sitzt, haelt das fuer in Ordnung.
   */
  protected readonly helligkeitGeklemmt = signal(false)
  protected readonly helligkeitEcht = signal<number | null>(null)
  /**
   * HAT DIE ANTWORT UEBERHAUPT EINE ZAHL GEBRACHT?
   *
   * `helligkeit` ist ein Signal mit Vorbelegung; kommt `prozent: null` herein,
   * bleibt darin der ALTE Wert stehen (beim ersten Laden die 100). Ohne dieses
   * Feld zeigte die Seite dann eine Zahl an, die in keiner Antwort stand — am
   * Bild gemessen (08.08.2026, tools/schirm-regler-ansehen.mjs, `f-unlesbar`):
   * voller Regler, „100 %", kein Wort dazu. Das Backend hatte ausdruecklich
   * gesagt, dass es den Wert nicht kennt.
   */
  protected readonly helligkeitStandBekannt = signal(false)
  /** Der fertige Satz und die Knopfbeschriftung — die Regeln stehen in schirm-text.ts. */
  protected readonly helligkeitKlemmung = computed(() =>
    klemmhinweis({
      geklemmt: this.helligkeitGeklemmt(),
      prozentEcht: this.helligkeitEcht(),
      min: this.helligkeitMin(),
    }),
  )
  /** Was neben dem Regler steht — „? %", solange niemand den Stand kennt. */
  protected readonly helligkeitAusgabe = computed(() =>
    reglerAusgabe(this.helligkeitStandBekannt() ? this.helligkeit() : null),
  )
  /** Die Saetze ueber die jetzige Lage der Box. Wortlaut in schirm-text.ts. */
  protected readonly helligkeitLage = computed(() =>
    lagesaetze({ schirmAus: this.helligkeitSchirmAus(), standBekannt: this.helligkeitStandBekannt() }),
  )

  /**
   * Bis zu wie vielen Wahlmoeglichkeiten eine Auswahl als Knopfreihe erscheint.
   *
   * Darueber wird es eine Klappliste. Die Zahl ist gemessen und nicht geraten:
   * `mupibox.oberflaeche` hat zwei Werte (Knoepfe sind dort das Richtige — man
   * sieht beide Namen ohne Klick), `mupibox.theme` liest seine Liste aus
   * `installedThemes`, und dort stehen in der Vorlage 28 Namen.
   */
  protected readonly KNOEPFE_MAX = 5

  // ── Farben der neuen Oberflaeche ───────────────────────────────────────
  /**
   * Die AUSGELIEFERTEN Farben — gelesen aus /neu/app.css, nicht hier gepflegt.
   *
   * Das ist der Kern der Sache: app.css ist die Datei, aus der die Oberflaeche
   * ihre Farben WIRKLICH nimmt. Stuenden die Vorgaben zusaetzlich hier, waeren
   * es zwei Listen — und die eine liefe der anderen davon, sobald jemand in
   * app.css einen Ton aendert. Die Verwaltung zeigt dann eine Farbe an, die die
   * Box gar nicht hat.
   */
  protected readonly farbVorgaben = signal<Record<string, string>>({})
  /** Nur das, was ABWEICHT — aus dem erzeugten Block im Farbthema. */
  protected readonly farbEigen = signal<Record<string, string>>({})
  protected readonly farbStand = signal('Lade …')
  protected readonly farbResetBereit = signal(false)
  /**
   * NUR FELDER, DEREN VORGABE WIRKLICH IN app.css STEHT.
   *
   * Der Schutz „ohne Vorgaben kein Wähler" war ein Alles-oder-nichts: er
   * greift, wenn app.css GAR NICHT lesbar ist. Fehlt aber nur EINE der fünf
   * Variablen — weil app.css sie umbenennt oder wegräumt, wie es `--line`
   * schon einmal passiert ist —, dann fiel `farbe()` still auf `'#000000'`
   * zurück. Daneben stand „wie ausgeliefert", und das war schlicht falsch;
   * der erste Griff ins Farbfeld hätte dieses Schwarz in die Box geschrieben.
   *
   * Ein Feld ohne bekannte Vorgabe kann nicht ehrlich anzeigen, ob es
   * abweicht, und es hat kein Ziel für „zurück". Es gehört deshalb nicht hin.
   */
  protected readonly farbFelder = computed(() => FARBFELDER.filter((f) => this.farbVorgaben()[f.v] !== undefined))
  protected readonly farbVorgabenDa = computed(() => this.farbFelder().length > 0)
  /**
   * Was im Farbthema steht, aber hier NICHT gezeigt wird.
   *
   * Es verschweigen wäre der teurere Weg: solche Werte gehen bei jedem
   * Speichern mit in die Datei zurück (`farbEigen` wird als Ganzes
   * geschickt) und färben womöglich weiter. Wer sie loswerden will, hat
   * „Alle Farben zurücksetzen" — deshalb steht hier, dass es sie gibt.
   */
  protected readonly farbUnbekannt = computed(() =>
    Object.keys(this.farbEigen())
      .filter((n) => !this.farbFelder().some((f) => f.v === n))
      .sort(),
  )

  private readonly rahmen = viewChild<ElementRef<HTMLIFrameElement>>('rahmen')
  private readonly sanitizer = inject(DomSanitizer)
  private readonly nachladen = signal(0)
  /** Welches Element im Rahmen zuletzt angetippt wurde. */
  protected readonly gewaehlt = signal<string | null>(null)
  /** Welche Seite der Box im Rahmen steht. */
  protected readonly seite = signal<'/' | '/player'>('/')
  protected readonly quelle = computed<SafeResourceUrl>(() =>
    // Gleiche Herkunft wie die Verwaltung (beides Port 8200), deshalb genügt
    // ein relativer Pfad — und deshalb darf der Rahmen ihn überhaupt zeigen.
    this.sanitizer.bypassSecurityTrustResourceUrl(
      // IMMER `/neu/` laden, nie /player: dort liegt auf der Box ein
      // Weiterreicher zum Player-Dienst, der Pfad liefert JSON statt der
      // Seite. Welche Seite gezeigt wird, sagt `seite=` — die Oberfläche
      // navigiert dann selbst.
      //
      // `vorschau=`: eine geänderte Adresse lädt den Rahmen neu. Das ist der
      // ganze Zweck von „Neu laden".
      `/neu/?vorschau=${this.nachladen()}` + `${this.seite() === '/player' ? '&seite=player' : ''}`,
    ),
  )
  private wegFrist: ReturnType<typeof setTimeout> | undefined
  private resetFrist: ReturnType<typeof setTimeout> | undefined
  private farbFrist: ReturnType<typeof setTimeout> | undefined
  private farbResetFrist: ReturnType<typeof setTimeout> | undefined

  constructor() {
    void this.holen()
    // NACHEINANDER, nicht parallel: ohne die Vorgaben aus app.css lässt sich
    // nicht entscheiden, ob eine abgelegte Farbe eine ABWEICHUNG ist — und der
    // Abschnitt bliebe sonst kurz mit fünf schwarzen Feldern stehen.
    void this.farbVorgabenHolen().then(() => this.farbEigenHolen())
  }

  /**
   * Fensteraenderungen ueber Angular, nicht von Hand.
   *
   * Ein selbst angehaengter Horcher blieb beim Verlassen der Seite stehen —
   * ein kleines Leck, aber eines, das sich bei jedem Besuch wiederholt.
   * @HostListener meldet ihn beim Zerstoeren des Bauteils ab.
   */
  @HostListener('window:resize')
  fensterGeaendert(): void {
    this.breite.set(window.innerWidth)
  }

  private massHolen(): number {
    const n = Number(localStorage.getItem('mupibox_admin_vorschau') || '')
    return Number.isFinite(n) && n >= 0.3 && n <= 1.2 ? n : 0.55
  }

  protected massSetzen(n: number): void {
    const g = Math.min(1.2, Math.max(0.3, n))
    this.mass.set(g)
    try {
      localStorage.setItem('mupibox_admin_vorschau', String(g))
    } catch {
      /* dann gilt es nur diese Sitzung */
    }
  }

  /**
   * Die Konfigurationsfelder dieser Seite holen.
   *
   * Ein Fehlschlag ist KEIN Fehler dieser Seite: dann bleibt der Abschnitt
   * leer und alles andere funktioniert weiter. Die Darstellung darf nie daran
   * scheitern, dass die Konfigurationsdatei gerade klemmt.
   */
  private async konfigHolen(): Promise<void> {
    try {
      const r = await fetch('/api/konfiguration', { cache: 'no-store' })
      const d = (await r.json()) as { felder?: KonfigFeld[] }
      this.konfigFelder.set((d?.felder ?? []).filter((f) => f.bereich === 'darstellung'))
    } catch {
      this.konfigFelder.set([])
      this.konfigStand.set('Die Konfiguration ließ sich nicht laden.')
    }
  }

  /**
   * Die Helligkeit des Bildschirms holen.
   *
   * Antwortet der Server gar nicht (altes Backend auf der Box, Netz weg),
   * bleibt `helligkeitDa` auf `null` und der Abschnitt erscheint nicht. Eine
   * Verwaltung, die einen Regler fuer einen Endpunkt zeigt, den es dort nicht
   * gibt, waere schlimmer als eine, die ihn weglaesst.
   */
  private async helligkeitHolen(): Promise<void> {
    try {
      const r = await fetch('/api/schirm/helligkeit', { cache: 'no-store' })
      if (!r.ok) return
      const d = (await r.json()) as {
        da?: boolean
        prozent?: number | null
        prozentEcht?: number | null
        geklemmt?: boolean
        min?: number
        max?: number
        schritt?: number
        schirmAus?: boolean
        grund?: string
      }
      if (typeof d?.da !== 'boolean') return
      this.helligkeitDa.set(d.da)
      this.helligkeitGrund.set(d.grund ?? '')
      this.helligkeitSchirmAus.set(d.schirmAus === true)
      if (typeof d.min === 'number' && typeof d.max === 'number' && d.min < d.max) {
        this.helligkeitMin.set(d.min)
        this.helligkeitMax.set(d.max)
      }
      if (typeof d.schritt === 'number' && d.schritt > 0) this.helligkeitSchritt.set(d.schritt)
      // ZWEI SCHRITTE, UND DER ZWEITE IST DER WICHTIGE: der Wert wird nur
      // gesetzt, wenn einer da ist — und es wird MITGESCHRIEBEN, ob einer da
      // war. Ohne die zweite Zeile bliebe bei `prozent: null` die alte Zahl im
      // Signal stehen und die Seite zeigte sie als Auskunft ueber das Geraet.
      if (typeof d.prozent === 'number') this.helligkeit.set(d.prozent)
      this.helligkeitStandBekannt.set(typeof d.prozent === 'number')
      // NUR AUS DER ANTWORT, nie nachgerechnet: ein aelteres Backend kennt
      // diese Felder nicht, dann bleibt der Hinweis weg — und nicht etwa eine
      // hier erfundene zweite Untergrenze stehen.
      this.helligkeitGeklemmt.set(d.geklemmt === true)
      this.helligkeitEcht.set(typeof d.prozentEcht === 'number' ? d.prozentEcht : null)
    } catch {
      /* dann steht der Abschnitt eben nicht da */
    }
  }

  /**
   * Die Helligkeit setzen — beim LOSLASSEN des Reglers, nicht bei jeder
   * Bewegung.
   *
   * Jede Bewegung zu schicken hiesse, waehrend eines Zugs dutzendfach als root
   * in eine Geraetedatei zu schreiben. Der Wert unter dem Finger folgt
   * trotzdem sofort — das macht `(input)` in der Vorlage, ohne den Server zu
   * fragen.
   *
   * WIRD DIE ANFRAGE ABGELEHNT, wandert der Regler zurueck auf den Wert, der
   * WIRKLICH gilt (`helligkeitHolen`). Ein Regler, der auf einer Zahl
   * stehenbleibt, die die Box nicht hat, ist die naechste Luege.
   */
  protected async helligkeitSetzen(prozent: number): Promise<void> {
    this.helligkeitStand.set('Wird gesetzt …')
    try {
      const r = await fetch('/api/schirm/helligkeit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prozent }),
      })
      // `gespeichert`, NICHT `gemerkt`. Der alte Name trug im PUT einen
      // Wahrheitswert und im GET daneben eine Prozentzahl — ein Name, zwei
      // Typen. Wer hier `if (!a.gemerkt)` schrieb, bekam fuer die 55 aus dem
      // GET zufaellig das Richtige aus dem falschen Grund. Die Begruendung
      // steht in server.ts ueber dem GET.
      const a = (await r.json().catch(() => null)) as { error?: string; gespeichert?: boolean } | null
      if (!r.ok) {
        this.helligkeitStand.set(a?.error || 'Die Helligkeit ließ sich nicht setzen.')
        await this.helligkeitHolen()
        return
      }
      this.helligkeitStand.set(
        a?.gespeichert === false
          ? 'Gesetzt — konnte aber nicht gespeichert werden, nach einem Neustart ist es wieder hell.'
          : 'Gesetzt — bleibt auch nach dem Neustart.',
      )
      // NACHFRAGEN, statt es zu glauben: nur so verschwindet der Klemmhinweis
      // wieder — und nur so faellt auf, wenn er NICHT verschwindet, weil ein
      // anderer Schreiber (die alte Seite) gleich wieder eine 0 hineingelegt
      // hat.
      await this.helligkeitHolen()
    } catch {
      this.helligkeitStand.set('Die Box antwortet gerade nicht.')
      await this.helligkeitHolen()
    }
  }

  /**
   * Den angezeigten Wert eines Konfigurationsfeldes lesen.
   *
   * Schalter stehen in dieser Datei teils als "0"/"1" statt als true/false —
   * die Vereinheitlichung passiert hier, gespeichert wird wieder die Form, die
   * vorher dastand (das erledigt `pruefeFeld` im Backend).
   */
  protected konfigWert(id: string): unknown {
    const f = this.konfigFelder().find((x) => x.id === id)
    if (!f) return ''
    if (f.art === 'schalter') return f.wert === true || f.wert === '1'
    return f.wert ?? ''
  }

  /* Die schirm()-Konstante ('neu' | 'klassisch') ist am 05.09.2026 gefallen:
   * seit E118 gibt es EINE Oberflaeche, und die letzten klassisch-Zweige
   * (Vorschau-Weiche, Anordnen-Modus) sind mit ihr gegangen. */

  /**
   * Stehen die Erklärungen da?
   *
   * AB WERK NICHT (22.08.2026, Betreiber: „es steht sehr viel text da").
   * Gemessen waren es 894 Wörter Fließtext in der Vorlage — neben rund siebzig
   * Bedienelementen, die alle selbst schon beschriftet sind. Wer täglich hier
   * arbeitet, liest diese Sätze nie wieder und muss trotzdem an jedem
   * vorbeirollen.
   *
   * GELÖSCHT WERDEN SIE NICHT. Jeder dieser Sätze beantwortet eine Frage, die
   * jemand einmal hatte („warum ist mein Timer weg", „was heißt frei"). Sie
   * stehen einen Klick entfernt statt gar nicht.
   *
   * WAS TROTZDEM IMMER DASTEHT: Aussagen über den JETZIGEN Stand — der
   * gemessene Kontrast, die unbekannten Farben im Thema, die Warnung bei
   * doppelt belegter Geste, der Grund für einen fehlenden Regler. Das sind
   * Rückmeldungen, keine Erläuterungen; sie wegzuklappen hieße, die Seite
   * verschweigt etwas über den Zustand der Box.
   */
  protected readonly erklaerungen = signal(this.erklaerungenHolen())

  private erklaerungenHolen(): boolean {
    return localStorage.getItem('mupibox_admin_darstellung_text') === '1'
  }

  protected erklaerungenUm(): void {
    const n = !this.erklaerungen()
    this.erklaerungen.set(n)
    try {
      localStorage.setItem('mupibox_admin_darstellung_text', n ? '1' : '0')
    } catch {
      /* dann gilt es nur diese Sitzung */
    }
  }

  /* wirkt()/zeigen()/unwirksam()/wirktNurAuf()/unwirksamZahl standen hier —
   * die Ausblende-Mechanik der Zwei-Schirm-Zeit. Seit dem 05.09.2026 wirkt
   * jedes Feld dieser Seite; was keinen Leser in NewDesign/app.js hat, fliegt
   * aus dem Interface statt in eine Liste. */

  /**
   * Ein Konfigurationsfeld setzen — SOFORT, ohne Speichern-Knopf.
   *
   * Absichtlich anders als auf der Konfigurationsseite: hier steht die
   * Vorschau daneben, und dort will man das Ergebnis sehen, waehrend man
   * einstellt. Jeder Schritt ist einzeln umkehrbar.
   *
   * Die Antwort wird ANGEZEIGT und nicht verschluckt: das Backend lehnt eine
   * Konfiguration ab, die die Box aussperren wuerde, und nennt den Grund
   * woertlich. Ein stiller Fehlschlag saehe hier aus wie ein Erfolg.
   */
  protected async konfigSetzen(id: string, wert: unknown): Promise<void> {
    this.konfigStand.set('Wird gespeichert …')
    try {
      const r = await fetch('/api/konfiguration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aenderungen: { [id]: wert } }),
      })
      if (!r.ok) {
        const a = (await r.json().catch(() => null)) as { error?: string } | null
        this.konfigStand.set(a?.error || 'Speichern fehlgeschlagen.')
        return
      }
      const a = (await r.json()) as { neustartNoetig?: boolean }
      this.konfigStand.set(
        a?.neustartNoetig
          ? 'Gespeichert — wirkt, sobald die Box neu startet.'
          : 'Gespeichert.',
      )
      await this.konfigHolen()
    } catch {
      this.konfigStand.set('Speichern fehlgeschlagen — die Box antwortet nicht.')
    }
  }

  private async holen(): Promise<void> {
    void this.konfigHolen()
    void this.helligkeitHolen()
    try {
      const r = await fetch('/api/darstellung', { cache: 'no-store' })
      const d = (await r.json()) as {
        aktuell?: Darstellung | null
        themen?: Record<string, Darstellung>
        /** Der Auslieferungsstand AUS DEM CODE — seine Schlüssel sind die mitgelieferten Namen. */
        auslieferung?: Record<string, unknown>
      }
      if (d?.aktuell) this.w.set({ ...STANDARD, ...d.aktuell })
      if (d?.themen) this.themen.set(d.themen)
      // Welche Themen mitgeliefert sind, sagt der Server — nicht eine Liste
      // hier, die beim nächsten neuen Thema veraltet.
      if (d?.auslieferung) this.fest.set(Object.keys(d.auslieferung))
      this.stand.set(d?.aktuell ? 'Stand von der Box übernommen.' : 'Die Box hat noch nichts gespeichert.')
    } catch {
      this.stand.set('Die Box antwortet gerade nicht.')
    }
  }

  /**
   * Speichern.
   *
   * Ohne Speichern-Knopf: man will das Ergebnis sehen, während man einstellt,
   * und es gibt nichts, das man verlieren könnte — jeder Schritt ist einzeln
   * umkehrbar, und „Alles zurücksetzen" steht daneben.
   */
  private async schreiben(): Promise<void> {
    try {
      const r = await fetch('/api/darstellung', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktuell: this.w(), themen: this.themen() }),
      })
      this.stand.set(r.ok ? `Gespeichert — die Box übernimmt es gleich.` : 'Speichern fehlgeschlagen.')
    } catch {
      this.stand.set('Speichern fehlgeschlagen — die Box antwortet nicht.')
    }
  }

  protected setz(teil: Partial<Darstellung>): void {
    this.w.update((v) => ({ ...v, ...teil }))
    void this.schreiben()
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Wischgesten vom Rand
  // ═══════════════════════════════════════════════════════════════════════
  protected readonly wischRaender = WISCH_RAENDER
  protected readonly wischTaten = WISCH_TATEN
  protected readonly wischFingerzahlen = [1, 2, 3]

  /* LESEN UND SCHREIBEN GEHEN UEBER METHODEN und nicht direkt im Gerüst.
   * Angular-Ausdrücke kennen keinen berechneten Schlüssel: `setz({ [t.rand]: r })`
   * übersetzt nicht („',' expected"), und `w()[t.rand]` wäre zwar erlaubt,
   * stünde dann aber neben einem Schreibweg, der anders aussieht. Beide
   * Richtungen hier, in derselben Form. */
  protected wischRand(t: (typeof WISCH_TATEN)[number]): string {
    return this.w()[t.rand]
  }

  protected wischFinger(t: (typeof WISCH_TATEN)[number]): number {
    return this.w()[t.finger]
  }

  protected wischRandSetzen(t: (typeof WISCH_TATEN)[number], rand: string): void {
    this.setz({ [t.rand]: rand } as Partial<Darstellung>)
  }

  protected wischFingerSetzen(t: (typeof WISCH_TATEN)[number], finger: number): void {
    this.setz({ [t.finger]: finger } as Partial<Darstellung>)
  }

  /** Die Randbreite in Schritten von 4 px, gedeckelt wie in der Oberfläche. */
  /**
   * Wie lange der weggewischte Player wegbleibt, in Schritten von 5 s.
   *
   * DER BODEN LIEGT BEI 5 UND NICHT BEI 0. Null Sekunden hiessen: Er
   * verschwindet und ist im selben Augenblick wieder da — die Geste sähe aus,
   * als tue sie nichts. Der Deckel bei 600 s ist derselbe wie in der
   * Oberfläche (playerStreichen.einstellen); wer länger will, blendet das
   * Kissen dauerhaft aus (Element „Mini-Player" weiter unten).
   */
  protected playerZurueckSchritt(um: number): void {
    const jetzt = Number(this.w().playerZurueckSek) || 10
    this.setz({ playerZurueckSek: Math.max(5, Math.min(600, jetzt + um)) })
  }

  protected wischRandSchritt(um: number): void {
    const jetzt = Number(this.w().wischRandBreite) || 28
    // 12 bis 96 — dieselben Grenzen wie WISCH_RAND_MIND_PX und
    // WISCH_RAND_HOECHST_PX in NewDesign/app.js. Der Deckel „ein Viertel der
    // kürzeren Kante" greift zusätzlich in der Box und steht nicht hier: er
    // hängt am Schirm, den dieses Board gar nicht kennt.
    this.setz({ wischRandBreite: Math.max(12, Math.min(96, jetzt + um)) })
  }

  /**
   * Liegt diese Geste auf derselben Belegung wie eine andere?
   *
   * Gibt den NAMEN der anderen zurück, sonst ''. Gemeldet wird nur bei der
   * SPÄTEREN von beiden — die frühere gewinnt (`wischTat` in NewDesign/app.js
   * geht WISCH_TATEN der Reihe nach durch), und ein Hinweis an ihr wäre eine
   * Warnung vor etwas, das ihr nicht passiert.
   */
  protected wischDoppelt(id: string): string {
    const i = WISCH_TATEN.findIndex((t) => t.id === id)
    if (i < 0) return ''
    const w = this.w()
    const meiner = w[WISCH_TATEN[i].rand]
    if (meiner === 'aus') return ''
    const meineFinger = w[WISCH_TATEN[i].finger]
    for (let k = 0; k < i; k++) {
      if (w[WISCH_TATEN[k].rand] === meiner && w[WISCH_TATEN[k].finger] === meineFinger) return WISCH_TATEN[k].name
    }
    return ''
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Farben der neuen Oberfläche
  // ═══════════════════════════════════════════════════════════════════════
  //
  // DREI DINGE, JEDES AUS GENAU EINER QUELLE:
  //   was ausgeliefert wurde   /neu/app.css      (farbVorgaben)
  //   was abweicht             /api/farbthema    (farbEigen)
  //   was stellbar ist         FARBFELDER        (diese Datei, einmal)
  //
  // Der WEG bis zum Bildpunkt steht in farbthema.ts im Backend — er wurde
  // gemessen (tools/thema-weg-schau.mjs, tools/farbwaehler-wirkung.mjs) und
  // nicht hergeleitet.

  /**
   * Die ausgelieferten Farben aus der app.css DER BOX holen.
   *
   * NICHT aus einer Kopie im Quelltext dieser Seite und nicht aus dem
   * Repository: geholt wird `/neu/app.css` vom selben Server, also genau die
   * Datei, die auf dem Schirm der Box liegt. Ist dort ein älterer Stand
   * ausgeliefert als im Repository, zeigt die Verwaltung dessen Farben — und
   * das ist richtig so.
   *
   * SCHEITERT SICHTBAR. Der Server dieser Box antwortet auf JEDEN Pfad mit
   * 200 und schickt notfalls die index.html; ein `r.ok` bewiese also nichts.
   * Erkannt wird der Fehlschlag daran, dass `wurzelFarben` nichts findet —
   * dann bleibt der Abschnitt zu, statt fünf Felder auf Schwarz zu zeigen und
   * beim ersten Klick Schwarz in die Box zu schreiben.
   */
  private async farbVorgabenHolen(): Promise<void> {
    try {
      const r = await fetch('/neu/app.css', { cache: 'no-store' })
      const gefunden = wurzelFarben(await r.text())
      this.farbVorgaben.set(gefunden)
      // ZWEI VERSCHIEDENE FEHLSCHLAEGE, zwei verschiedene Saetze. „Gar nichts
      // gelesen" heisst: die Datei kam nicht an (der Server antwortet auf jeden
      // Pfad mit 200 und schickt notfalls die index.html). „Gelesen, aber keine
      // der stellbaren Farben dabei" heisst: app.css hat sie umbenannt — ein
      // ganz anderes Problem, und wer beide Male denselben Satz liest, sucht
      // an der falschen Stelle.
      if (Object.keys(gefunden).length === 0) {
        this.farbStand.set(
          'Die Farben der neuen Oberfläche ließen sich nicht lesen (/neu/app.css). Solange das so ist, bleibt der Wähler zu.',
        )
      } else if (!this.farbVorgabenDa()) {
        this.farbStand.set(
          'In /neu/app.css steht keine der stellbaren Farben mehr. Der Wähler bleibt zu, statt Schwarz anzubieten.',
        )
      }
    } catch {
      this.farbVorgaben.set({})
      this.farbStand.set('Die Box antwortet gerade nicht — /neu/app.css war nicht zu lesen.')
    }
  }

  /** Was im Farbthema abweichend gesetzt ist. */
  private async farbEigenHolen(): Promise<void> {
    try {
      const r = await fetch('/api/farbthema', { cache: 'no-store' })
      const d = (await r.json()) as { farben?: Record<string, string>; grund?: string }
      this.farbEigen.set(d?.farben ?? {})
      if (this.farbVorgabenDa()) this.farbStand.set(d?.grund ?? '')
    } catch {
      this.farbEigen.set({})
      this.farbStand.set('Die abgelegten Farben ließen sich nicht lesen.')
    }
  }

  /** Der Wert, der im Feld steht: die eigene Farbe, sonst die ausgelieferte. */
  protected farbe(v: string): string {
    return this.farbEigen()[v] ?? this.farbVorgaben()[v] ?? '#000000'
  }

  /** Weicht diese Farbe von der Auslieferung ab? */
  protected istEigen(v: string): boolean {
    return this.farbEigen()[v] !== undefined
  }

  /**
   * Eine Farbe setzen.
   *
   * SOFORT IM BILD, VERZÖGERT AUF DER BOX. `<input type="color">` feuert
   * `input` bei JEDER Bewegung im Farbfeld — daraus würden dutzende Schreib-
   * vorgänge in eine Datei auf der SD-Karte, und jeder davon ruft ausserdem
   * `setting_update.sh`. Der Wert steht deshalb sofort im Signal (damit der
   * Hexwert daneben mitläuft) und wird erst nach einer Ruhepause geschickt.
   *
   * GLEICH WIE AUSGELIEFERT HEISST „NICHT GESETZT". Wer eine Farbe zufällig
   * genau auf ihren Auslieferungswert zieht, soll keinen Eintrag hinterlassen,
   * den er nachher nicht mehr los wird.
   */
  protected farbeSetzen(v: string, wert: string): void {
    const w = String(wert || '').toUpperCase()
    if (!/^#[0-9A-F]{6}$/.test(w)) return
    this.farbEigen.update((f) => {
      const neu = { ...f }
      if (this.farbVorgaben()[v] === w) delete neu[v]
      else neu[v] = w
      return neu
    })
    this.farbenSpaeterSchreiben()
  }

  /** Diese eine Farbe zurück auf die Auslieferung. */
  protected farbeLoesen(v: string): void {
    this.farbEigen.update((f) => {
      const neu = { ...f }
      delete neu[v]
      return neu
    })
    this.farbenSpaeterSchreiben()
  }

  /** Zwei Schritte — wie überall, wo etwas verschwindet. */
  protected farbenZuruecksetzen(): void {
    if (!this.farbResetBereit()) {
      this.farbResetBereit.set(true)
      clearTimeout(this.farbResetFrist)
      this.farbResetFrist = setTimeout(() => this.farbResetBereit.set(false), 4000)
      return
    }
    clearTimeout(this.farbResetFrist)
    this.farbResetBereit.set(false)
    this.farbEigen.set({})
    this.farbenSpaeterSchreiben()
  }

  /**
   * 400 ms Ruhe, dann schreiben.
   *
   * Die Zahl ist gewählt, nicht gemessen: kürzer als das Loslassen der Maus im
   * Farbfeld dauert, und kurz genug, dass es nach einem Klick nicht wie ein
   * Hänger wirkt.
   */
  private farbenSpaeterSchreiben(): void {
    this.farbStand.set('Wird gespeichert …')
    clearTimeout(this.farbFrist)
    this.farbFrist = setTimeout(() => void this.farbenSchreiben(), 400)
  }

  private async farbenSchreiben(): Promise<void> {
    try {
      const r = await fetch('/api/farbthema', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ farben: this.farbEigen() }),
      })
      const a = (await r.json().catch(() => null)) as {
        ok?: boolean
        farben?: Record<string, string>
        error?: string
      } | null
      if (!r.ok || !a?.ok) {
        this.farbStand.set(a?.error || 'Speichern fehlgeschlagen.')
        return
      }
      // DAS ERGEBNIS ÜBERNEHMEN, nicht den eigenen Stand behalten: das Backend
      // liest den geschriebenen Block zurück und meldet, was WIRKLICH in der
      // Datei steht. Fiele ein Wert dort heraus, stünde er hier sonst weiter.
      if (a.farben) this.farbEigen.set(a.farben)

      // DIE BOX MUSS NEU LADEN, sonst sieht man nichts.
      //
      // Die neue Oberfläche liest `/farben.css` EINMAL beim Laden der
      // Seite. Der Kiosk läuft aber durch. Ohne diesen Anstoss stünde die
      // neue Farbe in der Datei und auf dem Schirm die alte — und wer das
      // sieht, hält den Wähler für kaputt.
      //
      // `POST /api/oberflaeche/neuladen` ist der vorhandene, erprobte Weg
      // dafür: er lädt nicht selbst neu, sondern verändert nur den gemeldeten
      // Stand; die Oberfläche entscheidet und lädt höchstens einmal je
      // Änderung. Die Musik läuft in librespot bzw. mpv auf der Box, nicht im
      // Browser — sie reisst dabei nicht ab.
      let neuLaden = false
      try {
        neuLaden = (await fetch('/api/oberflaeche/neuladen', { method: 'POST' })).ok
      } catch {
        /* dann bleibt es beim nächsten Start der Box */
      }
      // KEIN VERWEIS MEHR, DER FEHLEN KÖNNTE (E118/1c): `/farben.css` liest
      // die feste Datei direkt — der alte Symlink-Warnpfad ist mit dem
      // Symlink gefallen.
      this.farbStand.set(
        neuLaden
          ? 'Gespeichert — die Box lädt die neue Oberfläche binnen einer Minute neu.'
          : 'Gespeichert — sichtbar wird es beim nächsten Laden der Box.',
      )
    } catch {
      this.farbStand.set('Speichern fehlgeschlagen — die Box antwortet nicht.')
    }
  }

  /**
   * Kontrast der Schrift — die Zahl, nicht das Verbot.
   *
   * BEIDE FLÄCHEN, nicht nur der Grund. Die erste Fassung mass `--ink` auf
   * `--bg`; wer nur `--surface` verstellte, liess die Zahl unberührt bei
   * „13,09 : 1 (reichlich)" und machte trotzdem die Seitenleiste und das
   * PIN-Tastenfeld unlesbar (am Gerät gemessen, siehe SCHRIFTPAARE in
   * farben.ts). Gemeldet wird jetzt die SCHLECHTESTE Stelle samt Ort.
   *
   * Gerechnet wird mit genau den Werten, die im Wähler stehen (eigene Farbe,
   * sonst ausgelieferte), also mit dem, was auf der Box gilt.
   */
  protected readonly kontrastPaar = computed(() =>
    schwaechsterKontrast({
      '--ink': this.farbe('--ink'),
      '--bg': this.farbe('--bg'),
      '--surface': this.farbe('--surface'),
    }),
  )
  protected readonly kontrastWert = computed(() => this.kontrastPaar().wert)

  protected kontrastText(): string {
    const k = this.kontrastWert()
    if (!k) return 'nicht messbar'
    const urteil = k >= 7 ? 'reichlich' : k >= 4.5 ? 'ausreichend' : k >= 3 ? 'knapp' : 'zu wenig'
    return `${k.toFixed(2).replace('.', ',')} : 1 (${urteil}) — ${this.kontrastPaar().wo}`
  }

  /**
   * Einen Wert um einen Schritt aendern.
   *
   * Die Grenzen stehen hier, nicht im Aufruf: sie gehoeren zum Feld, nicht zur
   * Schaltflaeche. Gerundet wird auf zwei Stellen, sonst sammelt sich beim
   * wiederholten Druecken der Rest der Gleitkommarechnung an (0.7499999).
   */
  protected schritt(
    feld:
      | 'bilder'
      | 'tasten'
      | 'miniPlayer'
      | 'namenAbstand'
      | 'abstandAlben'
      | 'mpBreite'
      | 'mpHoehe'
      | 'streifenLaenge',
    d: number,
  ): void {
    // Dieselben Klemmen wie in mixpi-thema.ts (zahl(...)) — was das Format
    // annimmt, laesst sich hier auch einstellen, und nichts darueber hinaus.
    const grenzen: Record<string, [number, number]> = {
      bilder: [0.6, 1.8],
      tasten: [0.6, 1.8],
      miniPlayer: [0.6, 1.8],
      mpBreite: [0.6, 1.8],
      mpHoehe: [0.6, 1.8],
      streifenLaenge: [0.3, 1],
      namenAbstand: [-12, 60],
      abstandAlben: [0, 240],
    }
    const [min, max] = grenzen[feld]
    const roh = (this.w()[feld] as number) + d
    const neu = Math.min(max, Math.max(min, Math.round(roh * 100) / 100))
    this.setz({ [feld]: neu } as Partial<Darstellung>)
  }

  protected stufenName(s: number): string {
    return s < 1 ? 'klein' : s > 1 ? 'groß' : 'normal'
  }

  /** E44: Cover-Reihen schrittweise — geklemmt auf 0.8..2, wie die Box es liest. */
  protected reihenSchritt(d: number): void {
    const jetzt = Number(this.w().reihenFaktor) || 1
    const neu = Math.round(Math.min(2, Math.max(0.8, jetzt + d)) * 100) / 100
    this.setz({ reihenFaktor: neu })
  }

  protected sichern(): void {
    const n = this.name().trim().slice(0, 40)
    if (!n) return
    this.themen.update((t) => ({ ...t, [n]: { ...this.w() } }))
    this.name.set('')
    void this.schreiben()
  }

  protected laden(n: string): void {
    const t = this.themen()[n]
    if (t) this.setz(t)
  }

  // ── Themen als Datei tauschen (E120, mixpi-thema/1) ────────────────────
  protected readonly importStand = signal('')
  protected readonly importKonflikt = signal('')
  private importDokument: unknown = null

  protected async themaHerunterladen(n: string): Promise<void> {
    // Ueber fetch + Blob statt eines nackten Links: so traegt der Fehlerfall
    // einen Satz auf der Seite statt einer Browser-Fehlerseite im Rahmen.
    try {
      const r = await fetch(`/api/thema/export/${encodeURIComponent(n)}`)
      if (!r.ok) {
        this.importStand.set(`Herunterladen fehlgeschlagen (${r.status}).`)
        return
      }
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${n}.mixpi-thema.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      this.importStand.set('Herunterladen fehlgeschlagen — die Box antwortet nicht.')
    }
  }

  protected async themaHochladen(feld: HTMLInputElement): Promise<void> {
    this.importKonflikt.set('')
    this.importDokument = null
    const datei = feld.files?.[0]
    if (!datei) return
    let dokument: unknown
    try {
      dokument = JSON.parse(await datei.text())
    } catch {
      this.importStand.set('Die Datei ist kein lesbares JSON.')
      return
    }
    await this.importSchicken(dokument, false, feld)
  }

  /** Der Konflikt-Knopf: dasselbe Dokument, jetzt mit Erlaubnis. */
  protected async themaErsetzen(): Promise<void> {
    if (this.importDokument) await this.importSchicken(this.importDokument, true, null)
  }

  protected importAbbrechen(feld: HTMLInputElement): void {
    this.importKonflikt.set('')
    this.importDokument = null
    this.importStand.set('Nichts eingespielt.')
    feld.value = ''
  }

  private async importSchicken(dokument: unknown, ueberschreiben: boolean, feld: HTMLInputElement | null): Promise<void> {
    try {
      const r = await fetch('/api/thema/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dokument, ueberschreiben }),
      })
      const a = (await r.json().catch(() => null)) as {
        ok?: boolean
        name?: string
        fehler?: string[]
        error?: string
      } | null
      if (r.status === 409 && a?.name) {
        // KEIN stilles Ersetzen — der Mensch entscheidet mit einem Knopf,
        // der den NAMEN nennt.
        this.importKonflikt.set(a.name)
        this.importDokument = dokument
        this.importStand.set(`Ein Thema „${a.name}" gibt es schon.`)
        return
      }
      if (!r.ok || !a?.ok) {
        // Die Saetze des Tors (pruefeThema) — Zeile fuer Zeile lesbar.
        this.importStand.set(a?.fehler?.length ? a.fehler.join('\n') : a?.error || 'Einspielen fehlgeschlagen.')
        return
      }
      this.importKonflikt.set('')
      this.importDokument = null
      if (feld) feld.value = ''
      this.importStand.set(`„${a.name}" eingespielt — unter Abgelegt zum Anwenden.`)
      // Die Themen-Liste neu holen: der frische Name soll sofort dastehen.
      await this.holen()
    } catch {
      this.importStand.set('Einspielen fehlgeschlagen — die Box antwortet nicht.')
    }
  }

  /** Zwei Schritte — wie überall, wo etwas verschwindet. */
  protected loeschen(n: string): void {
    if (this.weg() !== n) {
      this.weg.set(n)
      clearTimeout(this.wegFrist)
      this.wegFrist = setTimeout(() => this.weg.set(null), 4000)
      return
    }
    clearTimeout(this.wegFrist)
    this.weg.set(null)
    this.themen.update((t) => {
      const alle = { ...t }
      delete alle[n]
      return alle
    })
    void this.schreiben()
  }

  protected zuruecksetzen(): void {
    if (!this.resetBereit()) {
      this.resetBereit.set(true)
      clearTimeout(this.resetFrist)
      this.resetFrist = setTimeout(() => this.resetBereit.set(false), 4000)
      return
    }
    clearTimeout(this.resetFrist)
    this.resetBereit.set(false)
    this.setz(STANDARD)
  }

  protected neuLaden(): void {
    this.nachladen.update((n) => n + 1)
  }

  /**
   * Sobald der Rahmen steht: auf Tipser darin hoeren.
   *
   * Der Rahmen ist gleicher Herkunft, wir duerfen also hineinhoeren. Die
   * Oberflaeche markiert ihre anfassbaren Elemente mit `data-stueck` bzw.
   * `data-bezug` — genau daran erkennen wir, WAS angetippt wurde, ohne dass
   * die Verwaltung deren Aufbau kennen muesste.
   *
   * Bei jedem Laden neu: der Rahmen wird beim Seitenwechsel neu geladen, und
   * ein Horcher am alten Dokument waere danach wirkungslos.
   */
  protected rahmenBereit(): void {
    const d = this.rahmen()?.nativeElement.contentDocument
    if (!d) return
    d.addEventListener(
      'pointerdown',
      (ev) => {
        const ziel = ev.target as HTMLElement | null
        if (!ziel?.closest) return
        const el = ziel.closest('[data-stueck], [data-bezug]') as HTMLElement | null
        let s = el?.getAttribute('data-stueck') ?? el?.getAttribute('data-bezug') ?? null
        // Der GANZE Kachelbereich zaehlt, nicht nur die Kachel selbst.
        // Zwischen den Kacheln liegt seit dem engeren Abstand kaum noch Platz;
        // wer knapp danebentippt, traf sonst die Folie darunter, die keine
        // Kennung traegt.
        if (!s) {
          if (ziel.closest('.title-row')) s = 'bezeichnung'
          else if (ziel.closest('swiper-container, swiper-slide')) s = 'alben'
        }
        // Ein Fehlgriff hebt die Auswahl NICHT auf. Vorher verschwand das
        // Feld, sobald man knapp danebentippte — und genau das passiert beim
        // Zielen auf ein kleines Element staendig. Zum Aufheben gibt es einen
        // Knopf.
        if (s) this.gewaehlt.set(s)
      },
      true,
    )
  }

  protected stueckName(s: string): string {
    const namen: Record<string, string> = {
      mp: 'Mini-Player',
      status: 'Fortschrittsstreifen',
      cover: 'Albumbild im Player',
      titel: 'Titel im Player',
      alben: 'Albumkacheln',
      bezeichnung: 'Namen unter den Bildern',
    }
    return namen[s] ?? s
  }

  protected hatGroesse(s: string): boolean {
    return ['mp', 'cover', 'titel', 'alben', 'bezeichnung', 'status'].includes(s)
  }

  protected groesseVon(s: string): number {
    if (s === 'mp') return this.w().miniPlayer || 1
    if (s === 'alben') return this.w().bilder
    return this.w().skalen[s] ?? 1
  }

  protected schrittStueck(s: string, d: number): void {
    const neu = Math.min(1.8, Math.max(0.6, Math.round((this.groesseVon(s) + d) * 100) / 100))
    if (s === 'mp') this.setz({ miniPlayer: neu })
    else if (s === 'alben') this.setz({ bilder: neu })
    else this.setz({ skalen: { ...this.w().skalen, [s]: neu } })
  }

  protected kannAus(s: string): boolean {
    return ['mp', 'bezeichnung', 'status'].includes(s)
  }

  protected sichtbar(s: string): boolean {
    if (s === 'mp') return this.w().miniPlayer > 0
    if (s === 'status') return this.w().statusLeiste
    return this.w().bezeichnung
  }

  protected sichtbarUmschalten(s: string): void {
    if (s === 'mp') this.setz({ miniPlayer: this.w().miniPlayer > 0 ? 0 : 1 })
    else if (s === 'status') this.setz({ statusLeiste: !this.w().statusLeiste })
    else this.setz({ bezeichnung: !this.w().bezeichnung })
  }

  /* Die zehn BAUFORMEN-Karten (varianten/bauformGruppen/bauformTab) und die
   * fav/res-Bildelemente gehoerten der klassischen Oberflaeche — gefallen am
   * 05.09.2026, zusammen mit dem Ziehen der Karten in die Vorschau. */
  protected readonly optikTeile = computed(() => OPTIK_TEILE)
  protected readonly optikTeil = signal('mp')

  /**
   * Der WIRKSAME Unterreiter — nie einer, den es gerade nicht gibt.
   *
   * `elementTab` behält seinen Wert, wenn eine Gruppe verschwindet (z. B.
   * „Icons" beim Wechsel auf die neue Oberfläche). Ohne diese Umleitung stünde
   * die Seite dann auf einem Reiter, dessen Knopf nirgends mehr sichtbar ist:
   * kein Inhalt, keine Markierung, kein Weg zurück ausser Raten. Der Wert
   * selbst wird NICHT zurückgesetzt — wer zur klassischen Oberfläche
   * zurückkehrt, ist wieder da, wo er war.
   */
  protected readonly optikTeilEff = computed(() => {
    const g = this.optikTeile()
    const n = this.optikTeil()
    return g.some((x) => x.id === n) ? n : (g[0]?.id ?? 'mp')
  })

  /**
   * Der Reiter ganz oben — WELCHER Abschnitt unter der Vorschau steht.
   *
   * Er überlebt einen Seitenwechsel (localStorage), weil man beim Einstellen
   * zwischen Verwaltung und Box hin und her geht: nach jedem Rückweg wieder
   * bei „Vorschau" zu landen und sich erneut zu „Elemente" durchzuklicken,
   * ist genau die Sorte Reibung, gegen die dieser Umbau gebaut ist.
   */
  protected readonly reiter = computed(() => REITER)

  private readonly reiterGewaehlt = signal(this.reiterHolen())

  /**
   * Der WIRKSAME Reiter. Gleiche Überlegung wie bei `elementTabEff`: stand die
   * Seite auf „Bedienung" und die Box wechselt auf die klassische Oberfläche,
   * gäbe es sonst einen aktiven Reiter ohne Knopf und ohne Inhalt.
   */
  protected readonly reiterAktiv = computed(() => {
    const r = this.reiter()
    const n = this.reiterGewaehlt()
    // ZURUECK AUF DEN ERSTEN, nicht auf einen fest genannten. Hier stand
    // 'vorschau' — ein Reiter, den es nach dem Umbau vom 22.08.2026 nicht mehr
    // gibt; die Seite fiel damit auf einen leeren Namen zurueck und zeigte gar
    // nichts. Der erste ist immer da und ist die Optik.
    return r.some((x) => x.id === n) ? n : (r[0]?.id ?? 'optik')
  })

  private reiterHolen(): string {
    // Ein gemerkter Name aus der Zeit VOR dem Umbau ('vorschau', 'farben',
    // 'elemente', 'bedienung') steht in keinem REITER mehr und faellt hier
    // heraus, statt eine leere Seite zu ergeben.
    const n = localStorage.getItem('mupibox_admin_darstellung_reiter') || ''
    return REITER.some((r) => r.id === n) ? n : 'optik'
  }

  protected reiterSetzen(id: string): void {
    this.reiterGewaehlt.set(id)
    try {
      localStorage.setItem('mupibox_admin_darstellung_reiter', id)
    } catch {
      /* dann gilt es nur diese Sitzung */
    }
  }

  /* Die kopfIcons-Tabelle (ANZ, anzeigeReihe, an/anUm/ortUm, schieben) und
   * die Bauform-Karten samt Ziehen auf die Vorschau (bauformGruppen,
   * sichtbareVarianten, ueberFeld/aufsFeld) gehoerten der klassischen
   * Oberflaeche — gefallen am 05.09.2026. Die neue Kopfzeile wird im Teil
   * „Anzeigen“ mit einfachen an/aus-Schaltern bedient. */


  protected seiteSetzen(s: '/' | '/player'): void {
    if (this.seite() === s) return
    this.seite.set(s)
    this.nachladen.update((n) => n + 1)
  }
}
