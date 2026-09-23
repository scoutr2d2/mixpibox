/**
 * Werke — die Kacheln der NEUEN Box-Oberflaeche.
 *
 * REINE LOGIK: kein Netz, kein Dateisystem, kein express. Hereinkommen die
 * rohen Eintraege aus data.json, heraus kommt die Form, die eine Oberflaeche
 * ohne Dienstwissen anzeigen kann.
 *
 * WARUM ES DIESES STUECK GIBT: ein Eintrag der Box traegt seine Herkunft offen
 * mit sich herum. Mal steckt die Kennung in `id`, mal in `playlistid`, mal in
 * `showid`; das Cover ist bei lokalen Aufnahmen eine eingebettete Datenadresse,
 * bei Spotify eine CDN-Adresse und bei Jellyfin eine Adresse MIT
 * Zugangsschluessel darin. Die bestehende Angular-App kennt jede dieser
 * Eigenheiten und behandelt sie an vielen Stellen einzeln. Die zweite
 * Oberflaeche soll das NICHT noch einmal lernen muessen — sonst gibt es zwei
 * Wahrheiten darueber, was ein Album ist, und sie laufen auseinander.
 *
 * MEHRQUELLENFAEHIG AB TAG EINS, heute einelementig gefuellt: `quellen` ist
 * eine Liste, obwohl genau ein Eintrag darin steht. Wird spaeter dasselbe Album
 * aus Jellyfin UND Spotify zu EINER Kachel zusammengefasst, aendert sich nur
 * die Fuellung hier — keine Zeile Oberflaeche. Ein `quelle`-Einzelfeld jetzt
 * und eine Liste spaeter waere genau der Umbau, den das verhindern soll.
 *
 * DER SCHLUESSEL WIRD NICHT NEU ERFUNDEN. Er kommt aus dem vorhandenen
 * `medienSchluessel()` (medien.ts) und ist damit derselbe, ueber den auch die
 * Verwaltung aendert und loescht. Ausdruecklich NICHT aus `gruppiereTreffer()`:
 * dessen `gruppe` ist eine laufende Nummer JE AUFRUF — beim naechsten Abruf
 * derselben Liste kann sie eine andere sein, und eine Kachel zeigte danach ein
 * fremdes Bild.
 */
import {
  dienstVon,
  type Eintrag,
  interpretSchluesselAus,
  istKategorie,
  type Kategorie,
  medienSchluessel,
} from './medien'
// NUR die Aufloesung kommt von dort, nicht die Erkennung — und nur sie laeuft
// zur Laufzeit hier hinein. `verschmelzung.ts` holt sich umgekehrt bloss die
// TYPEN dieser Datei (`import type`), es entsteht also kein Ringschluss beim
// Laden.
import path from 'node:path'

import { type Dienst, type VerschmolzenesWerk, verschmelzeWerke, type Zuordnung } from './verschmelzung'

/**
 * Woher ein Werk kommt.
 *
 * ABGELEITET, NICHT ABGESCHRIEBEN (04.08.2026). Hier stand bis heute dieselbe
 * Aufzaehlung noch einmal, mit dem Kommentar „keine zweite Liste" darueber —
 * sie WAR aber eine, sie stimmte nur zufaellig noch. `verschmelzung.ts` haengt
 * seinerseits an dieser hier (`type Dienst = Quelle['dienst']`), es waeren also
 * drei Stellen gewesen. Der Rueckgabetyp von `dienstVon()` ist die eine, aus der
 * die anderen sie beziehen; ein neuer Dienst wird dort eingetragen und wirkt
 * hier von selbst. Was NICHT so geht — Browser-JS, CSS und die Verwaltung
 * koennen dieses Modul nicht einlesen —, faengt `tools/dienste-deckung.mjs`.
 */
export interface Quelle {
  dienst: ReturnType<typeof dienstVon>
  kennung: string
  /**
   * Wie viele Titel dieses Werk hat — und wie viele davon DIESE Quelle
   * wirklich liefern kann.
   *
   * WOZU, UND WARUM BEIDES FEHLEN DARF: ein Streamingdienst hat immer alles;
   * fuer ihn sind die Zahlen bedeutungslos, und sie fehlen. Eine LOKALE Ablage
   * dagegen fuellt sich nach und nach — ein Mitschnitt enthaelt genau die
   * Titel, die jemand gehoert hat, also anfangs drei von zwoelf.
   *
   * Ohne diese Angabe wuerde die Bevorzugung (`lokal` vor `spotify`) genau das
   * Falsche tun: das halbe lokale Album verdraengte das ganze aus dem Stream,
   * und die Kinder bekaemen auf die gewohnte Kachel nur noch drei Lieder. Das
   * ist REGEL 1 aus E17/V6 — siehe `quellenOrdnen` in verschmelzung.ts.
   *
   * FEHLT = VOLLSTAENDIG. Wer nichts sagt, hat alles; damit bleibt jedes
   * bestehende Werk und jeder bestehende Test unveraendert.
   */
  titelGesamt?: number
  /** Wie viele Titel hier wirklich abspielbar sind. Fehlt = alle. */
  titelDa?: number
  /**
   * Die Kategorie DIESER Quelle — nicht die des (verschmolzenen) Werks.
   *
   * AM GERAET GEMESSEN (30.08.2026, „ich kann keine alben abspielen die
   * zusammen gefasst sind und aufgenommen"): „Nah" fuehrt als Spotify-Werk
   * mit Kategorie `music`, der Mitschnitt liegt unter
   * `audiobook/Alin Coen/Nah`. Der lokale Abspielbefehl heisst
   * `musicsearch/library/album/<kategorie>:<interpret>:<titel>` — mit der
   * Kategorie des WERKS suchte er in `media/music/`, das es fuer diesen
   * Interpreten nicht gibt, und die Kachel spielte nichts. Die
   * Verschmelzung reicht Quellen unveraendert durch (verschmelzung.ts,
   * `quellen.push(q)`), also muss die Herkunft HIER stehen.
   *
   * Fehlt = die Kategorie des Werks gilt (Bestandsdaten, fremde Ablagen).
   */
  kategorie?: string
  /**
   * NUR BEI `dienst: 'lokal'`: die PLATTENFORM des Albums — Kategorie,
   * Interpret und Titel exakt so, wie die Ordner auf der Platte heissen.
   *
   * AM GERAET GEMESSEN (30.08.2026, „Guten Morgen / Good Morning"): die
   * Aufnahme sanitisiert Sonderzeichen (`/` wird `_`), die verschmolzene
   * Kachel fuehrt aber mit den SPOTIFY-Metadaten. Ein musicsearch-Befehl
   * aus Werk-Titel und -Interpret sucht dann einen Ordner, den es nie gab
   * — und faengt im Zweifel etwas AEHNLICHES: falsches Lied, falsche
   * Anzeige, Spruenge. Der Abspielweg nimmt darum diese Plattenform,
   * nie die Anzeige-Metadaten (spielfunktion.ts, `startPlan`).
   */
  lokalPfad?: { kategorie: string; interpret: string; titel: string }
}

/** Was fuer ein Ding die Kachel oeffnet. */
export const ARTEN = ['album', 'interpret', 'playlist', 'show', 'radio', 'rss', 'anderes'] as const
export type Art = (typeof ARTEN)[number]

export interface Werk {
  /** STABIL, aus dem Inhalt abgeleitet (medienSchluessel). Nie ein Listenindex. */
  schluessel: string
  art: Art
  titel: string
  interpret?: string
  /** IMMER ein Weg ueber die Box — nie die Adresse eines Dienstes. */
  bild: string
  /**
   * Liegt hinter `bild` wirklich eines? (E85)
   *
   * WOZU, UND WARUM ES NICHT AUS `bild` ABZULESEN IST: `bild` ist aus dem
   * SCHLUESSEL gerechnet (`bildPfad`) und steht deshalb IMMER da, auch wenn
   * der Eintrag gar kein Cover traegt — `/api/bild/<schluessel>` antwortet
   * dann mit 404, und die Kachel zeigt ihren Anfangsbuchstaben. Das ist so
   * gewollt.
   *
   * BEI DER VERSCHMELZUNG WIRD ES ABER ZUR FRAGE. Wenn die Metadaten aus der
   * bevorzugten Quelle kommen sollen (Spotify zuerst), darf das Bild nur dann
   * dorthin zeigen, wenn dort auch eines liegt — sonst tauschte man ein
   * vorhandenes Cover gegen einen Buchstaben. Ohne dieses Feld liesse sich
   * das nicht entscheiden, ohne die Eintraege ein zweites Mal zu lesen.
   */
  hatBild?: boolean
  kategorie: Kategorie
  /** Heute genau EIN Eintrag. Die Mehrzahl steht in der Form, nicht in den Daten. */
  quellen: Quelle[]
  /**
   * Wonach Werke DESSELBEN Interpreten zusammengefasst werden.
   *
   * WARUM IM SERVER UND NICHT IN DER OBERFLAECHE: Diese Regel gaebe es sonst
   * DREIMAL — in `media.service.ts` (sourcesByArtist), in `media.ts`
   * (medienVonInterpret, dessen Kopfkommentar denselben Fehler schon einmal
   * beschreibt) und in der neuen Seite. Das Wissenspaket fuehrt unter
   * [box-kachel-zeigt-fremde-quelle] einen bis heute offenen Fall genau
   * daraus: eine Kachel zeigte zwei Dienste, drinnen lag einer.
   *
   * NORMALISIERT, nicht roh: „Die drei ???" und „Die Drei ???" sind derselbe
   * Interpret; roh verglichen waeren es zwei Regale.
   *
   * FEHLT bei Werken ohne Interpret. Kein leerer Schluessel — sonst faenden
   * sich alle namenlosen Eintraege in EINEM Regal wieder, und das waere ein
   * Sammelposten, den niemand zuordnen kann.
   *
   * NICHT ZU VERWECHSELN mit dem Verschmelzen mehrerer Quellen zu EINEM Werk
   * (Wissenspaket [quellen-verschmelzen]). Das ist eine andere Frage: dort
   * geht es um dasselbe ALBUM aus mehreren Diensten, hier um mehrere ALBEN
   * desselben Interpreten. Dort gilt ausdruecklich, NIE allein auf
   * Interpret+Titel zu verschmelzen — hier wird gar nichts verschmolzen,
   * sondern nur einsortiert.
   */
  interpretSchluessel?: string
  /**
   * Beim ANBIETER geloescht — die Kachel wird gekennzeichnet, nicht versteckt.
   *
   * WIRD NICHT HIER GESETZT, sondern vom Server (`/api/werke`), weil dafuer
   * die Verfuegbarkeitspruefung nachgesehen werden muss und diese Datei rein
   * bleibt. Sie steht trotzdem hier in der Form: eine Oberflaeche, die das
   * Feld liest, soll es in der Schnittstelle finden und nicht raten muessen.
   *
   * VERSTECKEN WAERE FALSCH: ein verschwundenes Lieblingsalbum wirft sonst
   * die Frage auf, wo es hin ist. Die klassische Oberflaeche graut es aus und
   * legt eine Schaerpe darueber — das Kind sieht WARUM nichts kommt.
   */
  fehlt?: boolean
  /**
   * Die Quelle ist VON HAND ABGESCHALTET (E76) — der Wert ist der Dienst
   * (`spotify`, `jellyfin`, `ard`), damit die Schaerpe ihn benennen kann.
   *
   * Dieselbe Bauart wie `fehlt`, aus denselben Gruenden: gesetzt vom Server
   * (`/api/werke`, dort liegt die Konfiguration), gekennzeichnet statt
   * versteckt, und beim Verschmelzen bleibt es nur stehen, wenn ALLE Quellen
   * des Werks abgeschaltet sind — die Kachel, deren zweite Quelle noch
   * spielt, darf nicht grau werden.
   */
  quelleAus?: string
}

/**
 * Die Bildadresse zu einem Schluessel.
 *
 * Steht hier und nicht in der Oberflaeche, damit Seite und Server dieselbe
 * Regel benutzen. `encodeURIComponent` ist Pflicht und kein Schmuck: der
 * Schluessel eines Radiosenders IST eine Adresse
 * (`radio:http://.../stream.mp3`) und wuerde ohne Kodierung in mehrere
 * Pfadstuecke zerfallen.
 */
export function bildPfad(schluessel: string): string {
  return `/api/bild/${encodeURIComponent(schluessel)}`
}

/** Traegt der Eintrag dieses Feld mit Inhalt? (Eintrag ist offen typisiert.) */
function hatFeld(e: Eintrag, feld: string): boolean {
  return Boolean(String(e?.[feld] ?? '').trim())
}

/**
 * Was die Kachel oeffnet — abgeleitet aus den Feldern, die der Eintrag TRAEGT.
 *
 * An der Kennung allein ist es nicht zu erkennen; entscheidend ist, in WELCHEM
 * Feld sie steht. Die Reihenfolge folgt der schon vorhandenen Regel des Servers
 * (`e.playlistid ? 'playlist' : e.showid || e.audiobookid ? 'show' : 'album'`).
 * Sie hier anders zu treffen hiesse, zwei Antworten auf dieselbe Frage zu
 * haben.
 */
export function artVon(eintrag: Eintrag): Art {
  const e = eintrag ?? ({} as Eintrag)
  const dienst = dienstVon(e)
  // ZUERST Radio und RSS: die tragen ihre Stream-Adresse in `id` und saehen
  // sonst wie ein gewoehnliches Album aus.
  if (dienst === 'radio') return 'radio'
  if (dienst === 'rss') return 'rss'
  // EINE ARD-KACHEL IST EINE SENDUNG, also eine Folge nach der anderen — genau
  // das, was `show` meint. Sie traegt ihre Kennung in `id` und saehe sonst wie
  // ein Album aus; die Oberflaeche haette dann eine feste Titelliste erwartet,
  // waehrend hinter der Kachel eine Liste steht, die sich jede Woche aendert
  // (BACKLOG E4/A5, 04.08.2026).
  if (dienst === 'ard') return 'show'
  /* EIN PLUGIN-WERK IST EINE LISTE (E87), aus demselben Grund wie eine
   * ARD-Sendung: was dahintersteckt, liefert `inhalt()` (E78) — eine Folge
   * nach der anderen, und die Liste kann sich zwischen zwei Blicken aendern.
   * `album` waere die Behauptung einer festen Titelliste, die das Plugin nie
   * zugesagt hat. Und `anderes`, was hier bis E87 herauskam, ist eine Kachel,
   * die sich nicht oeffnen laesst. */
  if (dienst === 'plugin') return 'show'
  if (hatFeld(e, 'playlistid')) return 'playlist'
  // `audiobookid` bekommt bewusst KEINE eigene Art: fuer die Oberflaeche ist es
  // dasselbe wie eine Show (eine Folge nach der anderen). Ob es ein Hoerbuch
  // ist, sagt die KATEGORIE — dafuer eine zweite Stelle zu haben waere eine
  // Wahrheit zu viel.
  if (hatFeld(e, 'showid') || hatFeld(e, 'audiobookid')) return 'show'
  // `artistid` heisst: dahinter liegen die Werke EINES Interpreten, nicht ein
  // Album (genau dieses Feld benutzt die bestehende App dafuer).
  if (hatFeld(e, 'artistid')) return 'interpret'
  // Ein unbekannter Typ wird nicht zum Album erklaert — „anderes" ist ehrlicher
  // als eine Behauptung, die die Kachel nicht einloesen kann.
  if (dienst === 'anderes') return 'anderes'
  return 'album'
}

/**
 * TAUGT DIESE QUELLE ALS INTERPRET? — die Regel gegen „Unknown".
 *
 * NICHT JEDER EINTRAG IST EIN MEDIUM. „External Playback" ist MuPiBox'
 * Markierung fuer Wiedergabe von aussen (vom Telefon). Der Eintrag hat WEDER
 * `id` NOCH `playlistid`, `medienSchluessel` baut ihm deshalb einen
 * Ersatzschluessel aus Art, Interpret und Titel — auf der Box gemessen
 * (2026-08-02):
 *
 *     spotify:t:unknown|external playback     interpret "Unknown"
 *
 * Weil es bei Spotify wirklich einen Kuenstler namens „Unknown" gibt,
 * ueberstand er sogar die Namenspruefung der Oberflaeche. Gemeldet als „ich
 * sehe noch Unknown".
 *
 * EINE NAMENSLISTE WAERE DIE FALSCHE ABHILFE — beim naechsten Platzhalter
 * finge es von vorn an. Die Frage ist nicht, wie er HEISST, sondern ob hinter
 * ihm ueberhaupt etwas Abspielbares steht.
 *
 * DIE REGEL IST JE DIENST VERSCHIEDEN, und das ist keine Bequemlichkeit,
 * sondern der Punkt, an dem der erste Entwurf falsch war. „Kein Ersatz-
 * schluessel" allein haette auch LOKALE Alben getroffen: die haben von Haus
 * aus keine Kennung, sondern werden ueber Kategorie, Interpret und Titel
 * angesprochen (`musicsearch/library/album/<kat>:<interpret>:<titel>`, siehe
 * `startPlan`). Dort IST der Interpret die Adresse — ihn wegzunehmen haette
 * genau die Kacheln entwertet, die ohne Netz noch spielen.
 *
 *   lokal              immer. Der Interpret ist Teil des Abspielwegs.
 *   spotify            nur mit einer Kennung, die AUSSIEHT wie eine: 22
 *                      Zeichen aus Buchstaben und Ziffern — auch wenn sie als
 *                      Adresse oder als `spotify:<typ>:<id>` daherkommt.
 *                      Genau hier faellt „External Playback" heraus.
 *   jellyfin, radio,   nur mit echter Kennung. `medienSchluessel` setzt beim
 *   rss, anderes       Ersatz ein `t:` davor, und keine echte Kennung faengt
 *                      so an (Jellyfin: Hex, Radio/RSS: eine http-Adresse).
 *
 * WARUM IM SERVER: Dieselbe Frage stellte die neue Oberflaeche bisher selbst
 * (`werkTaugtFuerInterpret`, dort geloescht — hier ist es `interpretTaugt`),
 * und zwar NUR fuer die Interpreten-Reihe. Das
 * Regal (`anordnen`) fragte sie nie — dort haette ein zweiter
 * „External Playback"-Eintrag prompt ein Regal „Unknown" erzeugt. Als Feld am
 * Werk wirkt sie an allen drei Stellen auf einmal: Regal, Reihe und
 * Kachel-Untertitel.
 */
export function interpretTaugt(dienst: Quelle['dienst'], kennung: string): boolean {
  if (dienst === 'lokal') return true
  const k = String(kennung ?? '').trim()
  if (!k || k.startsWith('t:')) return false
  if (dienst !== 'spotify') return true
  const netz = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?[a-z]+\/([A-Za-z0-9]+)/.exec(k)
  const verweis = /^spotify:[a-z]+:([A-Za-z0-9]+)$/.exec(k)
  return /^[A-Za-z0-9]{22}$/.test(netz ? netz[1] : verweis ? verweis[1] : k)
}

/**
 * Ein data.json-Eintrag als Werk.
 *
 * Wirft NIE. Ein halber Eintrag wird zu einem halben Werk, nicht zu einem
 * Fehler: eine Startseite, die wegen einer einzigen krummen Zeile gar nichts
 * zeigt, ist auf einer Kinderbox das schlechtere Ergebnis.
 */
export function werkAus(eintrag: Eintrag): Werk {
  const e = eintrag ?? ({} as Eintrag)
  const dienst = dienstVon(e)
  const schluessel = medienSchluessel(e)
  // Die Kennung wird NICHT ein zweites Mal aus den Feldern gefischt, sondern
  // vom Schluessel abgeschnitten: `medienSchluessel()` baut ihn als
  // `<dienst>:<kennung>`. So koennen die beiden gar nicht auseinanderlaufen,
  // auch wenn dort spaeter ein Feld dazukommt.
  const kennung = schluessel.startsWith(`${dienst}:`) ? schluessel.slice(dienst.length + 1) : schluessel
  const titel = String(e.title ?? '').trim()
  const interpret = String(e.artist ?? '').trim()

  const werk: Werk = {
    schluessel,
    art: artVon(e),
    // Fehlt der Titel, beschriftet der Interpret die Kachel. Den Eintrag
    // WEGZULASSEN waere schlimmer: dann zeigte die neue Oberflaeche eine andere
    // Bibliothek als die alte, und niemand faende heraus, warum.
    titel: titel || interpret,
    bild: bildPfad(schluessel),
    // Vorgabe `music` — dieselbe wie beim Anlegen eines Eintrags (medien.ts).
    // Eine unbekannte Kategorie durchzulassen hiesse, dass die Kachel in keinem
    // Abschnitt der Startseite auftaucht, also unsichtbar waere.
    kategorie: istKategorie(e.category) ? e.category : 'music',
    // Die Quelle kennt ihre Kategorie SELBST (Begruendung am Feld in
    // `Quelle`): nach einer Verschmelzung kann die des Werks eine andere
    // sein, und der lokale Abspielweg braucht die der QUELLE.
    quellen: [{ dienst, kennung, kategorie: istKategorie(e.category) ? e.category : 'music' }],
  }
  // Lokale Quellen tragen zusaetzlich ihre PLATTENFORM (Begruendung am
  // Feld `lokalPfad`) — dieselben rohen Felder, aus denen auch der
  // /inhalt-Zweig den Pfad baut (server.ts, `${category}/${artist}/${title}`).
  if (dienst === 'lokal') {
    werk.quellen[0].lokalPfad = {
      kategorie: istKategorie(e.category) ? e.category : 'music',
      interpret: String(e.artist ?? ''),
      titel: String(e.title ?? ''),
    }
  }
  /* DIESELBE PRUEFUNG WIE IN `/api/bild/<schluessel>`, und das ist Absicht:
   * dort gilt der alte Platzhalter `nocover_mupi` ausdruecklich als KEIN Bild
   * (am Geraet gefunden, 31.07.2026 — `spotify.service.ts` traegt ihn an sechs
   * Stellen ein). Wer hier grosszuegiger waere, liesse die Verschmelzung auf
   * ein Cover zeigen, das die Route gleich darauf mit 404 abweist. */
  const cover = String(e.cover ?? '').trim()
  if (cover && !/nocover_mupi/i.test(cover)) werk.hatBild = true
  // Nur setzen, wenn es ihn gibt: ein leerer Interpret ist keine Angabe,
  // sondern ein leeres Feld unter der Kachel.
  //
  // UND NUR, WENN ETWAS DAHINTER STEHT. Ein Interpret an einem Eintrag ohne
  // brauchbare Kennung fuehrt nirgendwohin — er beschriftet eine Kachel, die
  // sich nicht oeffnen laesst, und sammelt gleichnamige Platzhalter in einem
  // Regal. Genau das war „ich sehe noch Unknown"; siehe `interpretTaugt`.
  // Der TITEL bleibt davon unberuehrt (er wurde oben schon gebildet): eine
  // Kachel ohne jede Beschriftung waere die schlechtere Antwort.
  if (interpret && interpretTaugt(dienst, kennung)) {
    werk.interpret = interpret
    // Der Schluessel des Regals. Siehe die Begruendung an der Feldform oben.
    //
    // NICHT `normal()`, seit 19.08.2026 (E45-Bestandsreview): der warf jedes
    // Satzzeichen weg und liess damit „Die drei ???" und „Die drei !!!" auf
    // DENSELBEN Schluessel fallen — ein Regal fuer zwei echte Serien, und wer
    // die eine freischaltete, loeschte still die andere. Die ganze Kette und
    // die Abwaegung stehen an `interpretSchluesselAus` (medien.ts).
    const k = interpretSchluesselAus(interpret)
    if (k) werk.interpretSchluessel = k
  }
  return werk
}

export interface WerkeOptionen {
  /**
   * Dasselbe Werk aus mehreren Diensten zu EINER Kachel zusammenfassen.
   *
   * Vorgabe AUS. Die Box sieht damit unveraendert aus, solange niemand es
   * einschaltet — und weil `zuordnungen` heute noch niemand fuellt, waere
   * selbst ein `true` folgenlos.
   */
  verschmelzen?: boolean
  /**
   * Welche Werke dasselbe sind. Wird NUR bei `verschmelzen: true` beachtet.
   *
   * Hier wird nichts ERKANNT, sondern eine fertige Behauptung verbraucht —
   * die Erkennung ist eine eigene Frage (verschmelzung.ts, Kopfkommentar).
   */
  zuordnungen?: Zuordnung[]
  /** Abweichende Bevorzugung. Vorgabe: lokal -> jellyfin -> spotify. */
  reihenfolge?: readonly Dienst[]
}

/**
 * Eine ganze Liste in Werke verwandeln.
 *
 * `verschmelzen: true` WARF frueher, weil es das Zusammenfassen noch gar nicht
 * gab und ein Aufrufer, der es bestellt und nicht bekommt, doppelte Kacheln
 * fuer richtig gehalten haette. Die Regel steht jetzt in `verschmelzung.ts`
 * (rein und getestet) — der Waechter ist damit erledigt, nicht entfallen: OHNE
 * Zuordnungen bleibt die Liste unveraendert, und das ist dann die WAHRHEIT und
 * kein Verschweigen (auf der Box gemessen 2026-08-02 mit
 * tools/quellen-ueberschneidung.mjs: 22 Eintraege, 21 spotify, 1 jellyfin,
 * 0 lokal — Ueberschneidung null, es gibt derzeit nichts zu verschmelzen).
 *
 * DIE QUELLEN WERDEN AUCH OHNE ZUORDNUNG GEORDNET, sobald `verschmelzen` an
 * ist: `quellen[0]` ist danach ueberall die bevorzugte Quelle, und die
 * Oberflaeche (`quelleVon` in NewDesign/app.js) muss dafuer nichts dazulernen.
 */
export function werkeAus(liste: Eintrag[], opt: WerkeOptionen = {}): VerschmolzenesWerk[] {
  const werke = (Array.isArray(liste) ? liste : []).map((e) => werkAus(e))
  if (!opt.verschmelzen) return werke
  return verschmelzeWerke(werke, opt.zuordnungen ?? [], { reihenfolge: opt.reihenfolge })
}

/* ══ DER ORDNER EINES LOKALEN ALBUMS — ALS PFAD, MIT RIEGEL (E126) ══════════
 *
 * Betreiber, 04.09.2026: „von der box auf den rechner runterladen." Dafuer
 * muss der Server einen Ordner packen, und der Weg dorthin kommt aus
 * FREMDEN Feldern (`lokalPfad`, aus der Mediendatei). Genau da beginnt die
 * Gefahr: Ein `..` in einem dieser drei Teile fuehrte aus dem Medienordner
 * heraus — und ein Download-Endpunkt, der aus dem Medienordner
 * herausfuehrt, gibt die ganze Box heraus.
 *
 * DESHALB REIN UND GEPRUEFT, nicht im Handler: Dieselbe Trennung wie bei
 * `klangDateiErlaubt` (ton.ts) und `istTonAusgangsname`. Der Handler ruft
 * nur, was hier entschieden wurde.
 *
 * DREI RIEGEL, und jeder hat seinen Grund:
 *   1. Alle drei Teile muessen da sein — ein leerer ergaebe einen Pfad, der
 *      auf den ELTERNORDNER zeigt (also auf alle Alben eines Interpreten).
 *   2. Kein `..`, kein `/`, kein Backslash, kein NUL in den Teilen.
 *   3. Und zum Schluss die Gegenprobe am ERGEBNIS: der aufgeloeste Pfad
 *      muss unter dem Medienordner liegen. Wer nur die Teile prueft,
 *      verlaesst sich darauf, alle Tricks zu kennen; wer das Ergebnis
 *      prueft, braucht das nicht.
 */
export function albumOrdnerPfad(
  medienOrdner: string,
  lokalPfad: { kategorie?: unknown; interpret?: unknown; titel?: unknown } | null | undefined,
): string | null {
  const teile = [lokalPfad?.kategorie, lokalPfad?.interpret, lokalPfad?.titel].map((x) => String(x ?? '').trim())
  if (teile.some((t) => !t)) return null
  if (teile.some((t) => t === '.' || t === '..' || /[/\\\0]/.test(t))) return null
  const wurzel = path.resolve(medienOrdner)
  const voll = path.resolve(wurzel, ...teile)
  // GEGENPROBE AM ERGEBNIS: mit Trennzeichen, sonst passierte ein
  // Nachbarordner mit gleichem Praefix („…/media-fremd").
  if (voll !== wurzel && !voll.startsWith(wurzel + path.sep)) return null
  return voll
}
