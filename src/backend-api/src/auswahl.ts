/**
 * Die AUSWAHL — was ein Kind von der Bibliothek sehen darf.
 *
 * REINE LOGIK: kein Dateisystem, kein Netz, keine Uhr. Herein kommt die
 * gelesene Liste und der gelesene Stand, heraus kommt die Sicht darauf.
 *
 * ══ DER BEFUND, DER DAZU GEFUEHRT HAT (gemessen 07.08.2026) ════════════════
 *
 * `BEREICH_ABLAGEN` (profile.ts) zaehlte VIER Ablagen je Kind — gespielt,
 * kinderzeit-verbrauch, listen, resume. Alle vier sind VERLAUF. Die
 * Bibliothek selbst liegt in `active_data.json` und gehoert der ganzen Box;
 * `GET /api/data` und `GET /api/werke` kannten kein Profil. Beim Wechsel des
 * Profils aenderte sich also nur, was ein Kind GEHOERT hat, nicht, was es
 * SEHEN darf. Der Betreiber hat es selbst gemeldet: „beim wechsel vom profil
 * werden alle titel wie bei gast gezeigt".
 *
 * ══ WORAUF EINE AUSWAHL STEHT — UND WARUM GENAU DARAUF ═════════════════════
 *
 * Auf dem WERKSCHLUESSEL aus `medienSchluessel()` (medien.ts), also auf
 * Zeichenketten der Form `spotify:55XPZzSH04MoODZpb6nCV2`,
 * `jellyfin:7d9a37e2732ca78bc68eacb3232960c0`, `ard:81889970`.
 *
 * NICHT AUF DEM LISTENINDEX. Der ist keine Identitaet — er verschiebt sich,
 * sobald jemand etwas einfuegt oder loescht, und `active_data.json` ist im
 * Offline-Betrieb eine ANDERE, kuerzere Liste als `data.json`. Der Kopf von
 * medien.ts fuehrt diesen Fehler schon einmal aus; ihn hier zu wiederholen
 * hiesse, dass eine Auswahl nach dem naechsten Loeschen auf fremde Alben
 * zeigt. Das waere schlimmer als gar keine Auswahl.
 *
 * NICHT AUF DEM TITEL. Ein Titel ist Beschriftung, keine Kennung: Er wird
 * korrigiert („EMMA6 - Completehttp://…" stand am 04.08. wirklich so in
 * data.json), er kommt beim naechsten Medienlauf in anderer Schreibweise
 * herein, und er ist bei Folgen derselben Reihe fast gleich. Eine Auswahl auf
 * Titeln waere beim naechsten Lauf halb kaputt — und zwar STILL.
 *
 * NICHT AUF DEM INTERPRETEN. Das waere ein ZWEITES Vokabular neben dem
 * Werkschluessel, und ein zweites Vokabular ist genau die Naht, an der dieser
 * Baum schon dreimal auseinandergelaufen ist. Dazu zwei Sachgruende:
 *   1. `interpretSchluessel` ist ein NORMALISIERTER NAME (werke.ts), kein
 *      Kennzeichen. Wer den Interpreten in der Verwaltung berichtigt, verliert
 *      die Auswahl seines Kindes, ohne dass irgendwo etwas dazu dastuende.
 *   2. Eine Auswahl „alles von X" ist eine REGEL und keine Liste — sie nimmt
 *      kuenftige Alben stillschweigend mit auf. Der Betreiber hat genau diese
 *      Bauart fuer „alles" ausdruecklich abgelehnt („statt eine Liste mit
 *      allem zu fuellen, die beim naechsten neuen Album veraltet"), und was
 *      fuer „alles" gilt, gilt fuer „alles von X" genauso.
 * Die OBERFLAECHE darf trotzdem nach Interpret anbieten — ein Griff, der die
 * Schluessel dieses Regals in dem Augenblick einsammelt, in dem der Erwachsene
 * ihn benutzt. Was danach in der Datei steht, sind Werkschluessel.
 *
 * ══ AN DEN ECHTEN DATEN DER BOX BELEGT (192.168.178.169, lesend, 07.08.2026)
 *
 *   28 Eintraege in data.json — 24 spotify, 2 jellyfin-album, 2 ard
 *   15 audiobook, 11 music, 2 other; 20 verschiedene Interpreten
 *   27 von 28 tragen eine Dienstkennung (`id` / `playlistid`), also einen
 *      Schluessel, der einen Medienlauf ueberlebt.
 *   1  von 28 traegt keine: „External Playback" (spotify, artist „Unknown").
 *      Sein Schluessel ist der Ersatz `spotify:t:unknown|external playback`.
 *
 * DIESER EINE FALL IST KEIN MANGEL DER ENTSCHEIDUNG, sondern ein bekanntes
 * Sonderding: `interpretTaugt()` in werke.ts wirft ihn schon heute aus der
 * Interpreten-Reihe, weil hinter ihm gar nichts Abspielbares steht — es ist
 * MuPiBox' Markierung fuer Wiedergabe vom Telefon. Ein Ersatzschluessel steht
 * auf Interpret und Titel und ist damit die einzige Zeile, deren Auswahl beim
 * Umbenennen verlorenginge. Bei 1 von 28 und bei diesem einen Eintrag ist das
 * der richtige Preis; die Alternative waere ein zweites Kennzeichenwesen fuer
 * alle 28.
 *
 * ══ DIE REGEL, DIE NICHTS VERSCHWINDEN LAESST ══════════════════════════════
 *
 * WER KEINE AUSWAHL HAT, SIEHT ALLES. Erst wenn jemand eine anlegt, wird
 * gefiltert. Eine bestehende Box hat keine — also zeigt sie nach dem Update
 * auf das Byte genau dasselbe wie vorher, bis ein Erwachsener etwas
 * einstellt. Der Bestand gehoert weiterhin allen (Entscheidung des Betreibers
 * vom 05.08.2026).
 *
 * ES GIBT DESHALB KEINEN ZUSTAND „AUSDRUECKLICH NICHTS". Eine leere Liste ist
 * dasselbe wie keine Liste, und „alles" ist es auch. Das ist keine
 * Nachlaessigkeit, sondern die einzige Richtung, in die der Zweifelsfall
 * fallen darf: Eine Box, die einem Kind gar nichts zeigt, ist fuer das Kind
 * eine kaputte Box, und niemand kann ihr ansehen, dass sie tut, was jemand
 * eingestellt hat.
 *
 * DIE AUSWAHL WIRD NIE AUTOMATISCH AUFGERAEUMT. Ein Schluessel, zu dem es
 * gerade kein Medium gibt, BLEIBT STEHEN. Zwei Gruende, und beide sind
 * gemessen und nicht befuerchtet:
 *   1. `active_data.json` ist im Offline-Betrieb eine ANDERE, kuerzere Liste.
 *      Wer beim Lesen aufraeumte, loeschte die halbe Auswahl jedes Kindes,
 *      sobald einmal das Netz weg war.
 *   2. Raeumte man sie bis auf null leer, kippte sie nach obiger Regel von
 *      „nur diese" auf „alles" — die Einschraenkung verschwaende, ohne dass
 *      jemand etwas getan haette. Von allen stillen Fehlern waere das der
 *      unangenehmste.
 * Was ein leeres Regal dem Kind sagt, entscheidet die Oberflaeche; damit sie
 * es KANN, gibt der Server die Anzahl der gewaehlten Schluessel mit heraus
 * (`auswahlStand`).
 */
import { type Eintrag, medienSchluessel } from './medien'

/** Der Stand, wie er in `profile/<kennung>/auswahl.json` liegt. */
export interface Auswahl {
  /**
   * Werkschluessel — `medienSchluessel()`, siehe Kopf dieser Datei.
   *
   * EIN OBJEKT UM DIE LISTE HERUM und nicht die blanke Liste: Kaeme spaeter
   * ein zweites Feld dazu (etwa eine Sperrliste), muesste sonst die FORM der
   * Datei wechseln — und eine Box, die zwischen zwei Formen steht, ist genau
   * die Sorte Umbau, die hier vermieden werden soll. `verschmelzung.json`
   * macht es aus demselben Grund so.
   */
  werke: string[]
}

/** Keine Auswahl — also: alles sehen. */
export const AUSWAHL_LEER: Auswahl = { werke: [] }

/**
 * Wie viele Schluessel hoechstens.
 *
 * NICHT GEGRIFFEN, sondern am Zweck gemessen: Es ist ein Deckel gegen eine
 * kaputte oder boesartige Eingabe, die sonst eine Datei im Megabytebereich
 * auf die SD-Karte schriebe. Die Box .169 fuehrt 28 Eintraege; eine gut
 * gefuellte fuehrt einige hundert. Zweitausend ist also weit ueber jedem
 * echten Bestand und weit unter allem, was der Platte weh tut.
 *
 * ABGESCHNITTEN WIRD HINTEN, nicht abgelehnt: eine zu lange Eingabe ist
 * beinahe sicher ein Fehler im Aufrufer, und eine Fehlermeldung, die die
 * ganze Auswahl verwirft, kostet mehr als die Kuerzung.
 */
export const AUSWAHL_MAX = 2000

/** Wie lang ein einzelner Schluessel hoechstens sein darf. */
const SCHLUESSEL_MAX = 400

/**
 * Fremde Eingaben in eine gueltige Auswahl verwandeln.
 *
 * DIESELBE HALTUNG WIE `profileNormalisieren` UND `regelnNormalisieren`: alles
 * Unlesbare wird auf die freundliche Seite gebogen. Eine halbe oder mutwillig
 * kaputte `auswahl.json` darf NIEMALS dazu fuehren, dass die Box nichts mehr
 * zeigt — und die freundliche Seite ist hier die LEERE Auswahl, denn die
 * heisst „alles".
 *
 * BEIDE FORMEN werden angenommen: die blanke Liste und der ganze Stand. Die
 * Oberflaeche schickt mal das eine, mal das andere, und eine Datei, die beim
 * naechsten Schreiben in der anderen Form landet, waere ein stiller Verlust.
 *
 * DOPPELTE FALLEN WEG, die REIHENFOLGE BLEIBT: die Datei laesst sich von Hand
 * lesen, und zwei gleiche Zeilen darin waeren eine Frage, die niemand
 * beantworten kann.
 */
export function auswahlNormalisieren(roh: unknown): Auswahl {
  const roheListe = Array.isArray(roh) ? roh : (roh as { werke?: unknown })?.werke
  const liste = Array.isArray(roheListe) ? roheListe : []
  const werke: string[] = []
  const gesehen = new Set<string>()
  for (const e of liste) {
    if (werke.length >= AUSWAHL_MAX) break
    if (typeof e !== 'string') continue
    const s = e.trim()
    if (!s || s.length > SCHLUESSEL_MAX || gesehen.has(s)) continue
    gesehen.add(s)
    werke.push(s)
  }
  return { werke }
}

/**
 * Schraenkt diese Auswahl ueberhaupt etwas ein?
 *
 * Die EINE Stelle, an der „leer heisst alles" steht. Wer stattdessen
 * `a.werke.length` an drei Orten abfragt, hat drei Gelegenheiten, es einmal
 * andersherum zu meinen.
 */
export function hatAuswahl(a: Auswahl | null | undefined): boolean {
  return Boolean(a?.werke?.length)
}

/**
 * Die Liste auf das eindampfen, was dieses Kind sehen darf.
 *
 * OHNE AUSWAHL KOMMT DIE LISTE UNVERAENDERT ZURUECK — dasselbe Objekt, nicht
 * einmal eine Kopie. Das ist der Normalfall jeder heute laufenden Box, und er
 * soll nicht einmal einen Durchlauf kosten.
 *
 * GEFILTERT WIRD AUF DER EBENE DER EINTRAEGE, nicht der Werke. Verschmelzung
 * (mehrere Dienste zu EINER Kachel) und Regale (mehrere Alben eines
 * Interpreten) entstehen erst DANACH aus dem, was uebrigbleibt. Andersherum
 * — erst verschmelzen, dann filtern — muesste diese Datei wissen, was ein
 * fuehrender Schluessel ist, und die Antwort darauf laege dann an zwei Orten.
 */
export function auswahlFiltern<T extends Eintrag>(liste: T[], auswahl: Auswahl | null | undefined): T[] {
  if (!Array.isArray(liste) || !hatAuswahl(auswahl)) return liste
  const erlaubt = new Set(auswahl?.werke ?? [])
  return liste.filter((e) => erlaubt.has(medienSchluessel(e)))
}

/**
 * Was die Oberflaeche wissen muss, um ein leeres Regal zu ERKLAEREN.
 *
 * „EIN LEERES REGAL SAGT, WARUM" ist eine Forderung an die Oberflaeche, aber
 * sie kann sie nur einloesen, wenn sie die drei Zahlen auseinanderhalten
 * kann. Ohne sie sieht sie in allen drei Faellen dasselbe — eine leere Liste:
 *
 *   gewaehlt 0                    keine Auswahl. Leer heisst: die Box ist leer.
 *   gewaehlt >0, sichtbar 0       die Auswahl steht, aber nichts davon ist da
 *                                 (Medien geloescht — oder die Box ist offline
 *                                 und `active_data.json` ist gerade die kurze
 *                                 Liste). Hier gehoert ein Satz hin.
 *   gewaehlt >0, sichtbar >0      der Normalfall.
 *
 * `vorrat` ist die Zahl VOR dem Filtern. Sie steht dabei, weil „nichts
 * gewaehlt und nichts da" und „nichts gewaehlt, aber 28 da" fuer die
 * Oberflaeche zwei verschiedene Saetze sind.
 */
export function auswahlStand(liste: Eintrag[], auswahl: Auswahl | null | undefined): {
  gewaehlt: number
  vorrat: number
  sichtbar: number
} {
  const vorrat = Array.isArray(liste) ? liste.length : 0
  const gewaehlt = auswahl?.werke?.length ?? 0
  return { gewaehlt, vorrat, sichtbar: gewaehlt ? auswahlFiltern(liste, auswahl).length : vorrat }
}
