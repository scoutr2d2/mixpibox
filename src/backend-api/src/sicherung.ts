/**
 * SICHERN UND ZURUECKSPIELEN OHNE SSH — die Wege /api/sicherung*.
 *
 * WARUM ES DAS GIBT (BACKLOG E29/B3, Befund vom 07.08.2026)
 * `scripts/mupibox/mupibox-sicherung.py` ist vollstaendig und geprueft. Es ist
 * aber ein BEFEHLSZEILENWERKZEUG. Wer eine Kinderbox betreibt, hat kein SSH.
 * Damit war JEDER Rueckweg, den heute jemand braucht, an eine Tastatur auf
 * einem fremden Rechner gebunden — und genau das macht aus einem Aergernis
 * („ich habe die Lautstaerke verstellt") eine Sackgasse („die Bibliothek ist
 * weg"). Diese Datei ist der Hebel: sie macht das vorhandene Werkzeug am
 * Bildschirm bedienbar. Sie erfindet KEINE zweite Sicherungslogik — jede
 * Pruefung, jede Reihenfolge, jedes atomare Schreiben bleibt im Python.
 *
 * ─── DIE VIER FRAGEN, DIE VOR DEM CODE STANDEN ───────────────────────────
 *
 * 1. WOHIN GEHT DIE SICHERUNG?  ->  IN DEN BROWSER, ALS DOWNLOAD.
 *
 *    Ein Stand, der nur auf der SD-Karte derselben Box liegt, rettet vor
 *    einem falschen Handgriff — aber nicht vor dem haeufigsten Tod eines Pi,
 *    der muede gewordenen Karte. Dagegen hilft nur, dass die Bytes das Geraet
 *    VERLASSEN. Der Browser ist der einzige Weg dorthin, den ein Elternteil
 *    ohne zweites Geraet, ohne SSH und ohne Anleitung hat.
 *
 *    WOVOR DIESE ABLAGE NICHT SCHUETZT — das gehoert hierher und wortgleich
 *    auf die Seite, nicht in eine Fussnote:
 *      * Die Datei liegt danach im Download-Ordner eines Rechners. Geht der
 *        kaputt oder wird der Ordner geleert, ist der Stand weg. Ein Stand,
 *        von dem es genau eine Kopie gibt, ist kein Stand.
 *      * Es ist KEIN Abbild der Karte. Musikdateien, Bilder und das
 *        Betriebssystem sind NICHT drin. Nach einem Kartentausch muss die Box
 *        erst wieder aufgesetzt werden; dieser Stand bringt danach die
 *        Bibliothek, die gemerkten Stellen, die Kinderzeit und die
 *        Einstellungen zurueck.
 *      * Er ist so frisch wie der Knopfdruck. Was danach kommt, ist nicht
 *        drin.
 *    Die drei Saetze stehen in `ABLAGE_HINWEISE` und gehen mit jeder Antwort
 *    hinaus, damit die Oberflaeche sie nicht abschreiben muss (und sie damit
 *    auseinanderlaufen koennen).
 *
 *    ZUSAETZLICH bleibt der Stand auf der Box liegen (das Python legt ihn in
 *    `STAENDE` ab) und wandert ueber `--auf-karte` auf die FAT-Partition. Der
 *    Download ist die DRITTE Ablage, nicht die einzige — genau darum geht es.
 *
 * 2. WAS STEHT DRIN?  ->  ZUGANGSDATEN NUR VERSCHLUESSELT, NUR AUF WUNSCH.
 *
 *    Die Vorgabe des Betreibers (05.08.2026): verschluesselt, freiwillig, mit
 *    Passwort. Das Python setzt das bereits um; hier wird nur der Weg gebaut,
 *    auf dem das Passwort ankommt — und zwar so, dass es NIRGENDS liegen
 *    bleibt:
 *      * NICHT in der Adresse. Alle Wege, die ein Passwort tragen, sind POST
 *        mit JSON-Koerper. Eine Adresse steht im Verlauf, im Verweiser und im
 *        Zugriffsprotokoll jedes Zwischenstuecks.
 *      * NICHT in der Befehlszeile. `ps` zeigt argv jedem Benutzer. Das
 *        Passwort geht ueber **stdin** an das Python (den Weg, den
 *        `passwort_holen` selbst als den dichtesten benennt).
 *      * NICHT in der Umgebung. `MUPIBOX_SICHERUNG_PW` waere bequem und stuende
 *        waehrend des ganzen Laufs in `/proc/<pid>/environ` — lesbar fuer jeden
 *        Vorgang desselben Benutzers, auf dieser Box also fuer Server und
 *        Abspieldienst. Wird hier ausdruecklich NICHT benutzt, und die Variable
 *        wird aus der Umgebung des Kindes ENTFERNT (`umgebungOhnePasswort`),
 *        damit ein von aussen gesetzter Wert nicht heimlich gewinnt.
 *      * NICHT im Protokoll. Es wird nie ausgegeben, nie in eine Antwort
 *        gelegt, nie in eine Fehlermeldung eingebaut. `stderr` des Kindes geht
 *        durch `spurenFrei`, bevor es irgendwohin geht.
 *    Was der Browser tun muss (kein DOM, keine Adresse, kein Speicher), steht
 *    in `seiten/sicherung.ts` und wird von `tools/sicherung-ohne-ssh-ring.ts`
 *    nachgemessen.
 *
 * 3. DAS ZURUECKSPIELEN IST DER GEFAEHRLICHE TEIL.  ->  ZWEI SCHRITTE, UND
 *    DAZWISCHEN STEHEN ZAHLEN.
 *
 *    `POST /api/sicherung/pruefen`         nimmt die Datei entgegen, schreibt
 *      sie in den Eingang, laesst das Python TROCKEN laufen und gibt den PLAN
 *      zurueck: wie viele Dateien geschrieben wuerden, welche davon sich
 *      wirklich aendern, welche Felder danach von Hand nachgetragen werden
 *      muessen, ob der Stand von DIESER Box stammt. Es wird nichts angefasst.
 *    `POST /api/sicherung/zurueckspielen`  bekommt die KENNUNG aus Schritt 1
 *      (sha256 der hochgeladenen Bytes). Stimmt sie nicht mehr mit der Datei
 *      im Eingang ueberein, wird abgebrochen. Damit kann nie ein anderer Stand
 *      eingespielt werden als der, ueber den die Zahlen standen.
 *
 *    DIE VIER SCHLECHTEN FAELLE, und wo sie scheitern — jeder VOR dem ersten
 *    geschriebenen Byte:
 *      beschaedigte Datei   `stand_oeffnen` prueft sha256 je Datei UND liest
 *                           den gzip-Strom zu Ende. Wirft, bevor irgendetwas
 *                           geschrieben wird.
 *      falsches Passwort    `geheim_aus_stand` laeuft VOR dem Schreiben, und
 *                           AES256-OCB ist echtes AEAD: ein falsches Passwort
 *                           scheitert laut statt Unsinn einzuspielen.
 *      andere Box           `stand.host` steht im Archiv. Wir vergleichen ihn
 *                           mit dem eigenen Namen und WARNEN — verbieten aber
 *                           nicht: eine Box, deren Karte gestorben ist, wird
 *                           neu aufgesetzt und heisst dann womoeglich anders.
 *                           Ein Verbot waere hier die naechste Sackgasse.
 *      aeltere/neuere       `stand.format` wird verglichen. Eine hoehere
 *      Fassung             Fassung wird ABGELEHNT (wir wissen nicht, was drin
 *                           steht), eine niedrigere nur benannt.
 *
 *    NIE EIN ZUSTAND, DER WEDER ALT NOCH NEU IST: Das Python prueft erst
 *    alles (`konfig_pruefen`, `klagen_ueber`) und schreibt dann jede Datei
 *    ueber `atomar_schreiben` (danebenlegen, fsync, umbenennen). Was hier
 *    dazukommt: **`--trotzdem` ist ueber diese API NICHT erreichbar**. Der
 *    Schalter uebergeht genau die Pruefungen, die eine unbrauchbare Box
 *    verhindern. Am Bildschirm waere er ein Knopf, den man drueckt, weil der
 *    andere nicht ging — und danach kommt niemand mehr in die Verwaltung.
 *    Wer ihn braucht, hat einen Grund und dann auch eine Tastatur.
 *
 * 4. WER DARF DAS?  ->  DAS VORHANDENE TOR, PLUS EIN AUSGESPROCHENER HINWEIS.
 *
 *    In der Vorgabe steht `interfacelogin.state=false`; die API ist dann im
 *    Heimnetz ohne Anmeldung offen. Ein Weg, der die ganze Konfiguration
 *    HERAUSGIBT, ist etwas anderes als einer, der die Lautstaerke setzt.
 *    Trotzdem bekommt er hier KEIN zweites Schloss, und das ist eine
 *    Entscheidung mit Begruendung:
 *
 *    WAS HERAUSGEHT ist ohne `mitZugangsdaten` genau das, was
 *    `GET /api/konfiguration`, `GET /api/data` und `GET /api/listen` heute
 *    schon durch dasselbe Tor herausgeben — die Geheimnisse sind vom Python
 *    herausgeschnitten, bevor das Archiv entsteht. Mit `mitZugangsdaten`
 *    liegen sie in einem AES256-OCB-Behaelter; wer die Datei ohne das Passwort
 *    hat, hat einen Klumpen. Der Schutz der Geheimnisse haengt also am
 *    PASSWORT, nicht an der Netzstellung — und deshalb wuerde ein zweites
 *    Schloss davor nichts schuetzen, was nicht schon geschuetzt ist.
 *
 *    WAS HINEINGEHT (das Zurueckspielen) ist nicht gefaehrlicher als
 *    `POST /api/konfiguration` oder `DELETE /api/medien/:schluessel`, die
 *    hinter demselben Tor stehen.
 *
 *    VERWORFEN: „das Verwaltungspasswort auch dann verlangen, wenn die
 *    Anmeldung aus ist". Klingt vorsichtig, baut aber genau die Sackgasse, um
 *    die es heute geht: eine Box, auf der vor einem Jahr einmal ein Passwort
 *    gesetzt und die Anmeldung danach ausgeschaltet wurde, koennte dann NICHT
 *    MEHR zurueckspielen — und der Rueckweg fiele aus in dem Moment, in dem
 *    man ihn braucht. Ein Schutz, der den Rueckweg verschliesst, ist kein
 *    Schutz.
 *
 *    WAS STATTDESSEN GETAN WIRD: `GET /api/sicherung` sagt ANSAGE, ob die
 *    Anmeldung aus ist (`anmeldungOffen`). Die Seite schreibt dann neben die
 *    Knoepfe, dass jeder im Heimnetz diese Sicherung anlegen und zurueckspielen
 *    kann, und verlinkt den Schalter. Aus einem stillen Risiko wird ein
 *    sichtbares — das ist mehr wert als ein Schloss, das man umgeht.
 *
 * ─── DER EINGANG, und warum die Dateien so heissen ────────────────────────
 * Das Python spielt AUS `STAENDE` zurueck (`stand_waehlen` sucht nur dort).
 * Eine hochgeladene Datei muss also dorthin. Sie darf aber auf keinen Fall
 * als gewoehnlicher Stand mitzaehlen: `--wiederherstellen neueste` wuerde sie
 * sonst greifen, `--anlegen --wenn-anders` gegen sie vergleichen und
 * `auslese` einen echten Stand fuer sie verdraengen.
 *
 * DER NAME LOEST DAS OHNE EINE ZEILE PYTHON: `mupibox-sicherung-0eingang-…`.
 *   * `mupibox-sicherung-` … `.tar.gz` — sonst faende `stand_waehlen` sie nie.
 *   * die `0` unmittelbar danach — `staende_lesen` sortiert ABSTEIGEND, und
 *     '0' (0x30) liegt unter jeder Jahreszahl ('2', 0x32). Ein Eingang steht
 *     damit IMMER am Ende der Liste und kann nie „neueste" sein.
 *   * `auslese` wirft beim naechsten `--anlegen` als erstes die hintersten
 *     weg — ein vergessener Eingang raeumt sich also von selbst ab.
 * Zusaetzlich faellt jeder Eingang, der aelter als `EINGANG_FRIST_MS` ist,
 * beim naechsten Aufruf weg. Ein Plan, den niemand bestaetigt, soll nicht
 * ewig auf der Box liegen — er traegt die halbe Konfiguration einer Box.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import express, { type Request, type Response, type Router } from 'express'

/* ══ Namen und Grenzen ═══════════════════════════════════════════════════ */

/** Vorsilbe des Eingangs. Herleitung jedes Zeichens im Kopfkommentar. */
export const EINGANG_VORSILBE = 'mupibox-sicherung-0eingang-'
export const EINGANG_NACHSILBE = '.tar.gz'

/** Wie lange ein unbestaetigter Eingang liegen bleiben darf. Eine halbe
 *  Stunde reicht, um einen Plan zu lesen und zu klicken; laenger liegt dort
 *  nur die halbe Konfiguration einer Box herum. */
export const EINGANG_FRIST_MS = 30 * 60 * 1000

/** Groesstes Archiv, das entgegengenommen wird. Ein Stand der Box wiegt
 *  ~12 KB bis ~200 KB (die Akku-Messreihe ist der dickste Posten, gedeckelt
 *  bei sieben Tagen). 8 MB sind das Vierzigfache des groessten gemessenen
 *  Standes und immer noch klein genug, dass niemand die Karte damit
 *  vollschreibt. */
export const MAX_ARCHIV_BYTES = 8 * 1024 * 1024

/**
 * Groesstes ENTPACKTES Archiv — und das ist eine andere Grenze als die oben.
 *
 * GEMESSEN (tools/sicherung-was-geht-hinaus.ts, Ring 5): gzip presst
 * gleichfoermige Bytes 1029:1. Eine erlaubte Anfrage von 8 MB wird beim
 * Entpacken also zu 8 GB — und `gunzipSync` ohne Deckel legt sie am Stueck in
 * den Speicher DIESES Vorgangs. Auf einem Pi ist das kein Fehler, sondern das
 * Ende des Servers: der Kern raeumt ihn ab. Damit waere ausgerechnet der Weg,
 * der aus jeder Sackgasse herausfuehrt, der billigste Weg, die Box
 * abzuschalten — eine einzige POST-Anfrage, im Heimnetz ohne Anmeldung, und
 * `express.raw({type: () => true})` nimmt jeden Inhaltstyp an.
 *
 * 32 MB sind das Vierfache dessen, was ueberhaupt hereinkommen darf, und
 * hundertfach mehr als der groesste gemessene Stand entpackt wiegt.
 */
export const MAX_ENTPACKT_BYTES = 32 * 1024 * 1024

/**
 * Wie viele unbestaetigte Vorschauen gleichzeitig liegen duerfen.
 *
 * Jede `--pruefen`-Anfrage legt die hochgeladenen Bytes in `STAENDE` ab —
 * bis zu 8 MB, und sie fallen erst nach `EINGANG_FRIST_MS` weg. Ohne Deckel
 * sind das bei 200 Anfragen 1,6 GB auf einer Karte, auf der auch die
 * Bibliothek liegt. Zwei Eltern an zwei Geraeten brauchen zwei; drei sind
 * grosszuegig, und der aelteste weicht.
 */
export const EINGANG_HOECHSTENS = 3

/** Die Fassungsnummer, die dieses Backend versteht (`stand.format`). */
export const FORMAT_BEKANNT = 1

/** Kuerzestes Passwort. Kuerzer ist Theater: der Behaelter waere in Minuten
 *  offen, und die Datei liegt danach in einem Download-Ordner. */
export const PASSWORT_MIN = 8

/**
 * WOVOR DER DOWNLOAD NICHT SCHUETZT. Wortgleich auf der Seite — deshalb steht
 * er hier und nicht dort: zwei Fassungen desselben Satzes laufen auseinander,
 * und die, die niemand liest, veraltet zuerst.
 */
export const ABLAGE_HINWEISE: readonly string[] = [
  'Die Datei liegt danach in Ihrem Download-Ordner. Geht dieser Rechner kaputt oder wird der Ordner geleert, ist der Stand weg — legen Sie ihn zusaetzlich woandershin (Stick, zweiter Rechner, Wolke).',
  'Es ist KEIN Abbild der Speicherkarte: Musik, Bilder und das Betriebssystem sind nicht darin. Nach einem Kartentausch muss die Box neu aufgesetzt werden; dieser Stand bringt danach Bibliothek, gemerkte Stellen, Kinderzeit und Einstellungen zurueck.',
  'Er ist so frisch wie dieser Knopfdruck. Was Sie danach aendern, steht nicht darin.',
]

/* ══ Kleines Werkzeug, alles rein ════════════════════════════════════════ */

export function sha256(b: Buffer | Uint8Array): string {
  return createHash('sha256').update(b).digest('hex')
}

/** Der Dateiname im Eingang zu einer Kennung. Nur die ersten 16 Zeichen der
 *  sha256 — der Rest steht in der Datei und muesste nirgends abgetippt
 *  werden. Der Name ist damit unauffaellig kurz und trotzdem eindeutig. */
export function eingangName(kennung: string): string {
  const kurz = /^[0-9a-f]{16,64}$/.test(kennung) ? kennung.slice(0, 16) : ''
  if (!kurz) throw new Error('unbrauchbare Kennung')
  return `${EINGANG_VORSILBE}${kurz}${EINGANG_NACHSILBE}`
}

export function istEingang(name: string): boolean {
  return name.startsWith(EINGANG_VORSILBE) && name.endsWith(EINGANG_NACHSILBE)
}

/**
 * Ein Passwort annehmen oder begruenden, warum nicht.
 *
 * KEINE Zeichenklassen-Regeln („mindestens eine Ziffer"). Sie treiben zu
 * `Sommer1!` und sind an einem Behaelter, den niemand tausendfach probieren
 * kann, ohnehin nutzlos — der einzige Angriff ist Raten an der Datei, und
 * dagegen hilft LAENGE.
 */
export function passwortPruefen(roh: unknown): { ok: boolean; grund?: string } {
  if (typeof roh !== 'string' || roh === '') {
    return { ok: false, grund: 'Ohne Passwort koennen die Zugangsdaten nicht mitgehen.' }
  }
  if (roh.length < PASSWORT_MIN) {
    return { ok: false, grund: `Das Passwort braucht mindestens ${PASSWORT_MIN} Zeichen.` }
  }
  if (roh.length > 512) return { ok: false, grund: 'Das Passwort ist unsinnig lang.' }
  if (roh.includes('\n')) {
    // Es geht ZEILENWEISE ueber stdin an das Python — ein Zeilenumbruch darin
    // wuerde stillschweigend abschneiden, und der Behaelter waere mit einem
    // anderen Passwort verschluesselt als dem eingegebenen. Das faellt erst
    // auf, wenn jemand ihn braucht.
    return { ok: false, grund: 'Das Passwort darf keinen Zeilenumbruch enthalten.' }
  }
  return { ok: true }
}

/**
 * Alles aus einer Ausgabe entfernen, was ein Passwort sein koennte.
 *
 * Das Python gibt das Passwort nirgends aus — aber `gpg` koennte es in einer
 * Fehlermeldung wiederholen, und diese Meldung geht in eine HTTP-Antwort. Die
 * Regel ist deshalb: was wir gesendet haben, wird aus allem, was zurueckkommt,
 * ersetzt. Kostet nichts und schliesst den ganzen Zweig.
 */
export function spurenFrei(text: string, geheim?: string | null): string {
  if (!geheim) return text
  return text.split(geheim).join('«Passwort»')
}

/** Die Umgebung fuer das Kind — OHNE die Passwortvariable.
 *
 *  Nicht, weil wir sie setzen (wir tun es ausdruecklich nicht), sondern weil
 *  sie von aussen gesetzt sein KOENNTE. Stuende sie in der Umgebung des
 *  Servers, gaebe `passwort_holen` ihr den Vorrang vor stdin — und der
 *  Behaelter waere mit einem Passwort verschluesselt, das der Benutzer nie
 *  eingegeben hat. */
export function umgebungOhnePasswort(quelle: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { MUPIBOX_SICHERUNG_PW: _weg, ...rest } = quelle
  return rest
}

/* ══ Den Stand lesen, ohne das Python zu fragen ══════════════════════════ */

export interface StandFeld {
  datei: string
  zeiger: string
  warum: string
}

/**
 * Eine Ablage, die auf der Box lag und in KEINE der beiden Listen der
 * Sicherung passte — weder in HINEIN (mitnehmen) noch in DRAUSSEN (bewusst
 * auslassen).
 *
 * DAS IST DIE EINZIGE SPALTE, DIE EINEN FEHLER MELDET. Die anderen beiden
 * melden eine Entscheidung. Der Unterschied ist der ganze Punkt: `nicht_dabei`
 * fuehrt Schluesselmaterial, Zwischenspeicher und Altlasten — Dinge, die
 * absichtlich draussen bleiben. Wuerde daraus eine Warnung, stuende bei JEDER
 * Sicherung eine, und nach dreimal liest sie niemand mehr. `unbekannt` ist im
 * Normalfall LEER, und genau deshalb ist eine Zeile darin es wert, jemandem
 * gezeigt zu werden.
 */
export interface NichtEingeordnet {
  /** Wie die Datei im Archiv hiesse, z. B. `server/config/profile.json`. */
  pfad: string
  /** null bei einem Ordner. */
  bytes: number | null
  /** Der Satz des Pythons — fuer den Bericht, nicht fuer den Bildschirm. */
  warum: string
}

export interface StandKopf {
  format: number
  erzeugt: string
  grund: string
  host: string
  dateien: { pfad: string; bytes: number; sha256: string }[]
  ausgelassenAnzahl: number
  zugangsdaten: StandFeld[]
  verweise: Record<string, string>
  /**
   * WARUM DIESES FELD DIE TEUERSTE ZEILE DIESER DATEI IST.
   *
   * `mupibox-sicherung.py` hat es immer geschrieben und immer auch auf stdout
   * gerufen („! nicht eingeordnet, NICHT gesichert: …"). Nur: `--anlegen`
   * laeuft ueber `/api/sicherung/anlegen`, und dessen Antwort SIND die
   * Archivbytes — stdout wird dort vollstaendig verworfen. Seit der Weg ueber
   * den Bildschirm laeuft statt ueber die Befehlszeile, hat diese Warnung
   * keinen Empfaenger mehr gehabt.
   *
   * SO IST `server/config/profile.json` AUS JEDER SICHERUNG GEFALLEN — die
   * Datei, die sagt, DASS es die Kinder gibt (Herleitung in HINEIN in
   * mupibox-sicherung.py, gemessen am 07.08.2026). Die Warnung stand da.
   * Gelesen hat sie niemand.
   *
   * Heute ist die Liste leer, die Luecke also geschlossen. Der KANAL ist es,
   * der hier gebaut wird: die naechste neue Ablage soll nicht noch einmal
   * still herausfallen.
   */
  nichtEingeordnet: NichtEingeordnet[]
}

/**
 * Einen einzelnen Eintrag aus einem gzip-ten tar holen — ohne Fremdpaket.
 *
 * WARUM NICHT DAS PYTHON FRAGEN: Diese Auskunft (von welcher Box? welche
 * Fassung? wie viele Dateien?) wird gebraucht, BEVOR entschieden ist, ob
 * ueberhaupt etwas laufen darf. Sie muss auch dann noch kommen, wenn das
 * Python gar nicht erst startet (fehlt, falscher Pfad, keine Rechte) — sonst
 * stuende der Benutzer vor einem „geht nicht" ohne Anhaltspunkt.
 *
 * ABSICHTLICH ENG: nur einfache Dateieintraege, Namen bis 100 Zeichen. Genau
 * das schreibt `schreiben()` im Python. Alles andere wird uebergangen statt
 * geraten — ein Tar-Leser, der klug sein will, ist ein Angriffsziel.
 */
export function tarEintragLesen(archiv: Buffer, gesucht: string): Buffer | null {
  // MIT DECKEL. Ohne `maxOutputLength` legt gunzipSync so viel in den Speicher
  // dieses Vorgangs, wie im Strom steht — und was darin steht, bestimmt der
  // Absender. Begruendung und Messung bei MAX_ENTPACKT_BYTES.
  const roh = gunzipSync(archiv, { maxOutputLength: MAX_ENTPACKT_BYTES })
  let p = 0
  while (p + 512 <= roh.length) {
    const kopf = roh.subarray(p, p + 512)
    // Zwei Nullbloecke sind das Ende.
    if (kopf.every((b) => b === 0)) return null
    const ende = kopf.indexOf(0)
    const name = kopf.subarray(0, ende < 0 || ende > 100 ? 100 : ende).toString('utf8')
    const groesseRoh = kopf.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim()
    const groesse = Number.parseInt(groesseRoh || '0', 8)
    if (!Number.isFinite(groesse) || groesse < 0) return null
    const typ = String.fromCharCode(kopf[156] ?? 0)
    const daten = p + 512
    if (name === gesucht && (typ === '0' || typ === '\0')) {
      return roh.subarray(daten, daten + groesse)
    }
    p = daten + Math.ceil(groesse / 512) * 512
  }
  return null
}

/**
 * Den Kopf eines Standes lesen. Wirft mit einem Satz, den man einem Elternteil
 * zeigen kann — nicht mit „unexpected token".
 */
export function standKopfLesen(archiv: Buffer): StandKopf {
  let roh: Buffer | null
  try {
    roh = tarEintragLesen(archiv, 'stand.json')
  } catch (e) {
    // Der Deckel hat gegriffen — das ist etwas anderes als „kaputt" und wird
    // auch anders gesagt. Eine Sicherung dieser Box wird beim Entpacken nicht
    // groesser als ein paar hundert Kilobyte.
    if (String((e as { code?: unknown })?.code ?? '') === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(
        `Diese Datei blaeht sich beim Entpacken auf mehr als ${Math.round(MAX_ENTPACKT_BYTES / 1024 / 1024)} MB auf. Eine Sicherung dieser Box wiegt entpackt ein paar hundert Kilobyte — das hier ist keine.`,
      )
    }
    throw new Error(
      'Diese Datei ist keine MuPiBox-Sicherung (sie laesst sich nicht einmal entpacken). Bitte die Datei waehlen, die beim Sichern heruntergeladen wurde — sie heisst mupibox-sicherung-….tar.gz.',
    )
  }
  if (!roh) {
    throw new Error('In dieser Datei steht kein stand.json. Es ist ein Archiv, aber keine MuPiBox-Sicherung.')
  }
  let d: Record<string, unknown>
  try {
    d = JSON.parse(roh.toString('utf8')) as Record<string, unknown>
  } catch {
    throw new Error('Das stand.json in dieser Datei ist beschaedigt — sie ist unbrauchbar.')
  }
  const dateien = Array.isArray(d['dateien'])
    ? (d['dateien'] as Record<string, unknown>[]).map((x) => ({
        pfad: String(x['pfad'] ?? ''),
        bytes: Number(x['bytes'] ?? 0),
        sha256: String(x['sha256'] ?? ''),
      }))
    : []
  const zug = (d['zugangsdaten'] ?? null) as Record<string, unknown> | null
  const felder = Array.isArray(zug?.['felder'])
    ? (zug['felder'] as Record<string, unknown>[]).map((f) => ({
        datei: String(f['datei'] ?? ''),
        zeiger: String(f['zeiger'] ?? ''),
        warum: String(f['warum'] ?? ''),
      }))
    : []
  // `unbekannt` FEHLT IN ALTEN STAENDEN NICHT — das Python schreibt es seit
  // der ersten Fassung. Es fehlt hier trotzdem tolerant, weil ein Stand von
  // einer fremden oder halb kaputten Box nicht dazu fuehren darf, dass die
  // ganze Auskunft platzt: eine leere Liste heisst „nichts zu melden", und das
  // ist die richtige Vorgabe.
  const nichtEingeordnet = Array.isArray(d['unbekannt'])
    ? (d['unbekannt'] as Record<string, unknown>[])
        .map((u) => ({
          pfad: String(u['pfad'] ?? ''),
          bytes: typeof u['bytes'] === 'number' ? (u['bytes'] as number) : null,
          warum: String(u['warum'] ?? ''),
        }))
        .filter((u) => u.pfad !== '')
    : []
  return {
    format: Number(d['format'] ?? 0),
    erzeugt: String(d['erzeugt'] ?? ''),
    grund: String(d['grund'] ?? ''),
    host: String(d['host'] ?? ''),
    dateien,
    ausgelassenAnzahl: Array.isArray(d['ausgelassen']) ? d['ausgelassen'].length : 0,
    zugangsdaten: felder,
    verweise: (d['verweise'] as Record<string, string>) ?? {},
    nichtEingeordnet,
  }
}

/* ══ Aus der Warnung einen Satz machen, den ein Elternteil versteht ══════ */

/**
 * WIE VIELE STELLEN AUFGEZAEHLT WERDEN, und warum ueberhaupt ein Deckel.
 *
 * `stand.json` kommt aus dem Sicherungswerkzeug, und wie viel darin steht,
 * bestimmt nicht diese Stelle. Ohne Deckel wandert alles davon ungeprueft in
 * eine Antwort, die auf einem 800x480-Schirm landet: 400 Eintraege zu je 200
 * Zeichen ergaben gemessen 87 127 Zeichen. Eine Warnung dieser Groesse ist
 * keine mehr.
 *
 * 20 IST DIE ZAHL, bei der die Karte noch auf den Schirm passt und trotzdem
 * jedes gewoehnliche Vorkommnis vollstaendig zeigt (heute steht dort NICHTS,
 * ein echter Fehler traefe ein bis zwei Stellen).
 */
export const NICHT_EINGEORDNET_HOECHSTENS = 20
/** Wie lang ein einzelner Pfad in der Aufzaehlung werden darf. */
export const PFAD_HOECHSTENS_ZEICHEN = 120

/**
 * Einen zu langen Pfad in der MITTE kuerzen.
 *
 * Vorn steht, WO es liegt, hinten steht, WAS es ist — beide Enden tragen die
 * Auskunft, die Mitte nicht. Vorn abzuschneiden hiesse, aus
 * `/home/dietpi/.mupibox/…/eigenes.json` ein `…/eigenes.json` zu machen, und
 * damit waere der Pfad zum Melden unbrauchbar.
 */
function pfadKuerzen(p: string): string {
  if (p.length <= PFAD_HOECHSTENS_ZEICHEN) return p
  const haelfte = Math.floor((PFAD_HOECHSTENS_ZEICHEN - 1) / 2)
  return `${p.slice(0, haelfte)}…${p.slice(p.length - haelfte)}`
}

export interface NichtEingeordnetBefund {
  /** Die betroffenen Pfade. LEER ist der Normalfall — dann schweigt alles. */
  pfade: string[]
  /** Die Ueberschrift. Leer, solange `pfade` leer ist. */
  satz: string
  /** Was daraus folgt und was zu tun ist. Leer, solange `pfade` leer ist. */
  rat: string[]
}

/**
 * WIE LAUT DARF DAS SEIN? Genau so laut, wie es selten ist.
 *
 * Diese Funktion gibt bei einer leeren Liste ALLES leer zurueck, und darauf
 * beruht die ganze Konstruktion: eine Warnung, die bei jeder Sicherung
 * erscheint, ist nach dreimal unsichtbar. Der Normalfall ist heute die leere
 * Liste — also erscheint im Normalfall nichts, und wenn doch etwas erscheint,
 * ist es neu und wird gelesen.
 *
 * WAS SOLL DER MENSCH TUN? „profile.json wurde nicht gesichert" hilft niemandem,
 * der nicht weiss, was profile.json ist. Also steht hier nicht, WAS die Datei
 * ist (das weiss diese Stelle nicht und darf es auch nicht raten), sondern was
 * ihr FEHLEN bedeutet — und dass der Fehler in der Box-Software liegt und
 * nicht in der Bedienung. Der Pfad selbst ist die Angabe, mit der er sich
 * melden laesst.
 *
 * ZWEI LAGEN, weil die Folge eine andere ist:
 *   `jetzt`  — der letzte Stand dieser Box. Die Datei liegt noch da, sie geht
 *              nur in keine Sicherung. Handlungsbedarf: melden.
 *   `stand`  — ein Stand, der gleich zurueckgespielt werden soll. Die Datei
 *              war nie darin; auf einer neu aufgesetzten Box waere sie weg.
 */
export function nichtEingeordnetDeuten(liste: NichtEingeordnet[], lage: 'jetzt' | 'stand'): NichtEingeordnetBefund {
  const alle = liste.map((u) => u.pfad).filter((p) => p !== '')
  if (alle.length === 0) return { pfade: [], satz: '', rat: [] }
  const eine = alle.length === 1
  // DER DECKEL. Ohne ihn kommt so viel heraus, wie in `stand.json` steht — und
  // das ist eine Datei, ueber deren Inhalt diese Stelle nicht bestimmt.
  // Gemessen (07.08.2026): 400 Eintraege zu je 200 Zeichen ergaben eine
  // Antwort von 87 127 Zeichen. Auf 800x480 ist das keine Warnung mehr,
  // sondern eine Wand — und eine Wand wird weggewischt, nicht gelesen.
  // Die ZAHL bleibt vollstaendig (sie steht im Satz), nur die Aufzaehlung wird
  // kurz: wer 400 Stellen hat, braucht nicht 400 Zeilen, um sich zu melden.
  const pfade = alle.slice(0, NICHT_EINGEORDNET_HOECHSTENS).map(pfadKuerzen)
  const weitere = alle.length - pfade.length
  // DIE SAETZE STEHEN MIT UMLAUTEN DA, obwohl die Kommentare dieser Datei
  // ohne auskommen. Sie gehen auf einen Bildschirm, auf dem daneben „Sichern
  // und Zurückspielen" steht; ein „Zurueckspielen" mittendrin liest sich wie
  // eine Fehlermeldung aus dem Maschinenraum — und genau als solche wird es
  // dann auch behandelt, naemlich uebergangen.
  // DER SATZ NENNT DIE VOLLE ZAHL, die Aufzaehlung darunter nicht. Stuende
  // hier `pfade.length`, haette der Deckel die Warnung selbst verfaelscht: aus
  // 400 Stellen waeren stillschweigend 20 geworden.
  const wieviele = alle.length
  const gedeckelt =
    weitere > 0 ? [`Aufgezählt sind die ersten ${pfade.length}; ${weitere} weitere stehen im Stand.`] : []
  if (lage === 'stand') {
    return {
      pfade,
      satz: eine
        ? 'Eine Ablage lag auf der Box, als dieser Stand entstand — und ist NICHT in ihm.'
        : `${wieviele} Ablagen lagen auf der Box, als dieser Stand entstand — und sind NICHT in ihm.`,
      rat: [
        ...gedeckelt,
        'Zurückspielen bleibt gefahrlos: was jetzt an diesen Stellen liegt, wird weder überschrieben noch gelöscht.',
        'Auf eine NEU aufgesetzte Box gespielt, fehlt dieser Inhalt dort danach — der Stand kann ihn nicht mitbringen.',
        'Gemeint sind nicht die bewusst ausgelassenen Dinge (Schlüsselmaterial, Zwischenspeicher, Altlasten). Die stehen hier nie.',
      ],
    }
  }
  return {
    pfade,
    satz: eine
      ? 'Eine Ablage auf dieser Box geht in KEINE Sicherung — auch nicht in die nächste.'
      : `${wieviele} Ablagen auf dieser Box gehen in KEINE Sicherung — auch nicht in die nächste.`,
    rat: [
      ...gedeckelt,
      'Die Sicherung nimmt nur mit, was namentlich in ihrer Liste steht. Was hier steht, steht auf keiner der beiden Listen — weder auf der zum Mitnehmen noch auf der zum Auslassen. Absichtlich Ausgelassenes (Schlüsselmaterial, Zwischenspeicher, Altlasten) taucht hier NIE auf.',
      'Was darin steht, ist nach einem Kartenschaden weg — auch wenn Sie regelmäßig sichern.',
      'Das ist ein Fehler in der Box-Software, nicht in Ihrer Bedienung. Wer ihn meldet, nennt den Pfad von oben; damit ist er in Minuten behoben.',
      'Bis dahin: Sichern und Zurückspielen bleiben brauchbar. Alles andere geht mit, und diese Stellen werden beim Zurückspielen nicht angefasst.',
    ],
  }
}

export interface Fremdheit {
  /** Darf gar nicht erst probiert werden. */
  ablehnen: string | null
  /** Muss vor dem Klick dastehen — verbietet aber nichts. */
  warnungen: string[]
}

/**
 * Ist dieser Stand ueberhaupt fuer diese Box?
 *
 * DIE ENTSCHEIDUNG, die hier steckt: eine ANDERE Box ist eine WARNUNG, eine
 * unbekannte FASSUNG ist eine ABLEHNUNG.
 *
 * Der Name der Box ist kein Sicherheitsmerkmal — er aendert sich beim
 * Neuaufsetzen, und genau dann (Karte gestorben, Box neu) will jemand
 * zurueckspielen. Ein Verbot waere hier die naechste Sackgasse. Die Fassung
 * dagegen sagt, ob wir den Inhalt ueberhaupt deuten koennen; bei einer
 * hoeheren wissen wir es nicht und duerfen nicht raten.
 */
export function fremdheitPruefen(kopf: StandKopf, eigenerHost: string): Fremdheit {
  const warnungen: string[] = []
  if (kopf.format > FORMAT_BEKANNT) {
    return {
      ablehnen: `Dieser Stand hat Fassung ${kopf.format}; diese Box versteht nur bis ${FORMAT_BEKANNT}. Er stammt aus einer neueren MuPiBox — erst die Box aktualisieren, dann zurueckspielen.`,
      warnungen,
    }
  }
  if (kopf.format < FORMAT_BEKANNT) {
    warnungen.push(
      `Der Stand hat die aeltere Fassung ${kopf.format} (diese Box: ${FORMAT_BEKANNT}). Er laesst sich einspielen; Einstellungen, die es damals noch nicht gab, behalten ihren jetzigen Wert.`,
    )
  }
  if (kopf.host && eigenerHost && kopf.host !== eigenerHost) {
    warnungen.push(
      `Dieser Stand kommt von einer ANDEREN Box: «${kopf.host}», diese heisst «${eigenerHost}». Das ist in Ordnung, wenn Sie die Box neu aufgesetzt haben — sonst spielen Sie gerade fremde Einstellungen ein.`,
    )
  }
  if (kopf.dateien.length === 0) {
    warnungen.push('Dieser Stand enthaelt gar keine Dateien. Es gibt nichts zurueckzuspielen.')
  }
  return { ablehnen: null, warnungen }
}

/* ══ Den Bericht des Pythons in Zahlen uebersetzen ═══════════════════════ */

export interface Plan {
  kopfzeile: string
  /** Dateien, die sich wirklich aendern. */
  aendert: { ziel: string; bytes: number }[]
  /** Dateien, die schon genau so dastehen. */
  unveraendert: { ziel: string; bytes: number }[]
  /** Eintraege im Archiv ohne Ziel auf dieser Box. */
  uebersprungen: string[]
  /** Verweise, die nicht angefasst werden. */
  verweise: string[]
  /**
   * Stellen, an denen auf DIESER BOX ein Verweis steht und der Stand einen
   * Inhalt traegt. Sie werden nicht ueberschrieben — sonst stuende danach eine
   * gewoehnliche Datei am Ort der Bruecke, und server.ts schoebe ihren Inhalt
   * beim naechsten Lesen ueber den Bestand des aktiven Kindes. Der Fall ist
   * nicht theoretisch: jeder Stand aus der Zeit vor E18 Stufe 3 traegt
   * `server/config/resume.json` als Datei, und eine aeltere Fassung wird
   * ausdruecklich angenommen. Das gehoert AUF DEN SCHIRM, nicht nur ins
   * Protokoll — es ist die einzige Stelle im Plan, an der etwas aus dem Stand
   * NICHT eingespielt wird, obwohl es hineingehoerte.
   */
  verweisZiele: string[]
  /** Zugangsdaten, die aus dem Behaelter kommen wuerden. */
  eingespielt: string[]
  /** Ausgelassene Schluessel, die den Wert der Box behalten. */
  behaelt: string[]
  /** Was danach von Hand eingegeben werden muss. */
  vonHand: string[]
  /** Zugangsdaten liegen verschluesselt im Stand, ohne Passwort bleiben sie liegen. */
  verschluesseltLiegenGeblieben: string[]
  /** Was das Python sonst noch mit `!!` angemerkt hat. */
  anmerkungen: string[]
}

/**
 * Der Bericht aus `wiederherstellen(trocken=True)`, Zeile fuer Zeile gedeutet.
 *
 * WARUM NICHT DIE ROHEN ZEILEN ANZEIGEN: „Daten werden ersetzt" ist keine
 * Aussage, „5 Dateien werden geaendert, 3 stehen schon so da, 2 Felder muessen
 * Sie danach neu eingeben" ist eine. Wer entscheiden soll, braucht Zahlen. Die
 * rohen Zeilen gehen trotzdem MIT hinaus (`zeilen` in der Antwort) — sie sind
 * das, woran man im Zweifel nachliest.
 *
 * REIN: hinein gehen Zeilen, heraus geht ein Plan. Deshalb pruefbar, ohne
 * dass irgendwo ein Python laufen muss.
 */
export function berichtDeuten(zeilen: readonly string[]): Plan {
  const p: Plan = {
    kopfzeile: '',
    aendert: [],
    unveraendert: [],
    uebersprungen: [],
    verweise: [],
    verweisZiele: [],
    eingespielt: [],
    behaelt: [],
    vonHand: [],
    verschluesseltLiegenGeblieben: [],
    anmerkungen: [],
  }
  // Welche Sammelliste gerade gefuellt wird: die eingerueckten Zeilen unter
  // einem `!!`-Kopf gehoeren zu diesem Kopf.
  let sammel: 'vonHand' | 'verschluesselt' | null = null
  for (const z of zeilen) {
    if (!p.kopfzeile && z.startsWith('Stand vom ')) {
      p.kopfzeile = z
      continue
    }
    const datei = /^ {2}([>=]) (.+?) {2}\((\d+) B\)$/.exec(z)
    if (datei) {
      sammel = null
      const eintrag = { ziel: datei[2] as string, bytes: Number(datei[3]) }
      if (datei[1] === '>') p.aendert.push(eintrag)
      else p.unveraendert.push(eintrag)
      continue
    }
    const ohneZiel = /^ {2}uebersprungen \(kein Ziel\): (.+)$/.exec(z)
    if (ohneZiel) {
      sammel = null
      p.uebersprungen.push(ohneZiel[1] as string)
      continue
    }
    // DIESE PRUEFUNG STEHT VOR DER NAECHSTEN, und das ist keine Kosmetik:
    // beide Zeilen fangen mit „  Verweis" an. Stuende die kuerzere zuerst,
    // fiele der Fall, in dem etwas NICHT eingespielt wurde, in denselben Topf
    // wie der harmlose — und verschwaende genau dort, wo er auffallen soll.
    const verweisZiel = /^ {2}Verweis auf der Box \(NICHT ueberschrieben\): (.+)$/.exec(z)
    if (verweisZiel) {
      sammel = null
      p.verweisZiele.push(verweisZiel[1] as string)
      continue
    }
    const verweis = /^ {2}Verweis \(NICHT angefasst\): (.+)$/.exec(z)
    if (verweis) {
      sammel = null
      p.verweise.push(verweis[1] as string)
      continue
    }
    if (z.startsWith('Zugangsdaten AUS DEM STAND eingespielt')) {
      sammel = null
      p.eingespielt = teileNachDoppelpunkt(z)
      continue
    }
    if (z.startsWith('Ausgelassene Schluessel behalten den Wert der Box')) {
      sammel = null
      p.behaelt = teileNachDoppelpunkt(z)
      continue
    }
    if (z.startsWith('!! DIESE MUESSEN VON HAND NEU EINGEGEBEN WERDEN')) {
      sammel = 'vonHand'
      continue
    }
    if (/^!! \d+ Feld\(er\) liegen/.test(z)) {
      sammel = 'verschluesselt'
      continue
    }
    if (z.startsWith('!!')) {
      sammel = null
      p.anmerkungen.push(z.replace(/^!!\s*/, ''))
      continue
    }
    // „   Nachholen (…)" steht mit DREI Leerzeichen und beendet den Absatz.
    // Was darunter folgt, sind zwei Befehlszeilen mit SSH — und die waeren
    // hier genau falsch: die Oberflaeche kann das Passwort abfragen. Wer den
    // Hinweis trotzdem durchreicht, schickt den Benutzer in das SSH, das
    // dieser ganze Weg ueberfluessig macht. Diese Pruefung MUSS vor der
    // naechsten stehen — die Befehlszeilen sind fuenf Leerzeichen tief und
    // saehen sonst aus wie ein Feld.
    if (/^ {3}\S/.test(z)) {
      sammel = null
      continue
    }
    if (sammel && /^ {5}\S/.test(z)) {
      const wert = z.trim()
      if (sammel === 'vonHand') p.vonHand.push(wert)
      else p.verschluesseltLiegenGeblieben.push(wert)
      continue
    }
    sammel = null
  }
  return p
}

function teileNachDoppelpunkt(z: string): string[] {
  const i = z.indexOf(': ')
  if (i < 0) return []
  return z
    .slice(i + 2)
    .split(', ')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Ein Satz, der den Plan zusammenfasst — mit ZAHLEN.
 *
 * Er steht ueber dem roten Knopf. Wer ihn liest, weiss, was gleich passiert,
 * ohne die Liste durchzugehen.
 */
export function planSatz(p: Plan): string {
  const t: string[] = []
  t.push(p.aendert.length === 1 ? '1 Datei wird ueberschrieben' : `${p.aendert.length} Dateien werden ueberschrieben`)
  if (p.unveraendert.length) t.push(`${p.unveraendert.length} stehen schon genau so da`)
  if (p.eingespielt.length) t.push(`${p.eingespielt.length} Zugangsdaten werden eingespielt`)
  if (p.behaelt.length) t.push(`${p.behaelt.length} Zugangsdaten behalten den Wert dieser Box`)
  if (p.verschluesseltLiegenGeblieben.length)
    t.push(`${p.verschluesseltLiegenGeblieben.length} Zugangsdaten bleiben verschluesselt liegen (ohne Passwort)`)
  if (p.vonHand.length) t.push(`${p.vonHand.length} muessen Sie danach von Hand eingeben`)
  // STEHT IM SATZ UEBER DEM ROTEN KNOPF, nicht in einer Liste weiter unten:
  // es ist die einzige Zahl, die sagt, dass etwas aus dem Stand NICHT
  // ankommt.
  if (p.verweisZiele.length)
    t.push(
      p.verweisZiele.length === 1
        ? '1 Stelle bleibt stehen, weil dort auf dieser Box ein Verweis liegt'
        : `${p.verweisZiele.length} Stellen bleiben stehen, weil dort auf dieser Box Verweise liegen`,
    )
  return `${t.join(', ')}.`
}

/**
 * NACH EINEM ABBRUCH: STEHT DIE BOX NOCH GANZ DA?
 *
 * Das Python schreibt in einer Reihenfolge, die man an seiner Ausgabe ablesen
 * kann, und es gibt sie ZEILENWEISE aus. Was bis zum Abbruch angekommen ist,
 * sagt deshalb genau, wie weit es gekommen war:
 *
 *   `vorher gesichert als …`   der Rueckweg AUS dem Rueckweg steht schon.
 *   `  > /pfad  (N B)`         diese Datei ist geschrieben.
 *   `  = /pfad  (N B)`         diese stand schon so da — nichts geschehen.
 *
 * WOZU DAS GEBRAUCHT WIRD: Ein Abbruch mitten in der Schreibschleife
 * hinterlaesst eine Box, die halb alt und halb neu ist. Jede einzelne Datei
 * ist heil (`atomar_schreiben`), der ZUSTAND ist es nicht. Wer dann liest
 * „es wurde nichts geaendert", sucht den Stand „vorher" nicht — und der ist
 * das einzige, was hier noch hilft.
 *
 * Nachgemessen 07.08.2026: SIGTERM 1,8 s in die Schleife, vier Dateien
 * zurueckgespielt, eine nicht.
 *
 * REIN: hinein geht die (womoeglich abgeschnittene) Ausgabe, heraus geht eine
 * Lage. Kein fs, keine Uhr — deshalb ohne laufendes Python pruefbar.
 */
export interface AbbruchLage {
  /** Wie viele Dateien laut Ausgabe schon geschrieben waren. */
  geschrieben: number
  /** Der Stand, den das Python vor dem Schreiben angelegt hat — der Rueckweg. */
  vorherStand: string | null
  /** Der Satz, der dem Elternteil gesagt werden muss. */
  satz: string
}

export function abbruchLage(aus: string): AbbruchLage {
  let geschrieben = 0
  let vorherStand: string | null = null
  for (const z of aus.split('\n')) {
    if (/^ {2}> .+ {2}\(\d+ B\)$/.test(z)) geschrieben++
    else if (z.startsWith('vorher gesichert als ')) {
      vorherStand = z.replace('vorher gesichert als ', '').trim() || null
    }
  }
  if (geschrieben === 0) {
    return { geschrieben, vorherStand, satz: 'Es wurde nichts geaendert.' }
  }
  const wo = vorherStand
    ? `Der Zustand von VORHER liegt als Stand «${vorherStand}» auf der Box — er steht in der Liste oben und laesst sich von hier aus zurueckspielen.`
    : 'Auf der Box liegt kein Stand «vorher» — hier hilft nur ein aelterer Stand aus der Liste oben.'
  return {
    geschrieben,
    vorherStand,
    satz:
      `ACHTUNG: der Vorgang wurde abgebrochen, NACHDEM bereits ${geschrieben} ` +
      `${geschrieben === 1 ? 'Datei' : 'Dateien'} geschrieben ${geschrieben === 1 ? 'war' : 'waren'}. ` +
      `Die Box traegt jetzt teils den alten, teils den neuen Stand. Jede einzelne Datei ist heil — der Zustand ist es nicht. ` +
      `${wo} Bitte spielen Sie EINEN von beiden vollstaendig ein, bevor Sie die Box weiter benutzen.`,
  }
}

/** Der Dateiname, unter dem der Browser die Sicherung ablegt. */
export function downloadName(kopf: StandKopf, jetzt = new Date()): string {
  const stempel = (kopf.erzeugt || jetzt.toISOString()).replace(/[^0-9]/g, '').slice(0, 14)
  const box = (kopf.host || 'mupibox').replace(/[^A-Za-z0-9-]/g, '') || 'mupibox'
  const zug = kopf.zugangsdaten.length ? '-mit-zugangsdaten' : ''
  return `mupibox-sicherung-${box}-${stempel}${zug}.tar.gz`
}

/* ══ Das Python rufen ════════════════════════════════════════════════════ */

export interface SicherungUmgebung {
  /** Pfad auf mupibox-sicherung.py. */
  skript: string
  /** Verzeichnis der Staende (muss zu dem im Skript passen). */
  staende: string
  /** Wie das Python heisst. */
  python?: string
  /** Was VOR das Python gehoert. Im Betrieb LEER — und das ist keine
   *  Nachlaessigkeit, sondern gemessen: `/etc/mupibox` gehoert dietpi und
   *  vererbt ueber das setgid-Bit die Gruppe www-data, der Server laeuft als
   *  dietpi. Ein `['sudo','-n']` hier waere nicht bloss ueberfluessig, sondern
   *  SCHAEDLICH: mit `Defaults use_pty` in der sudoers bekaeme das Kind ein
   *  Pseudo-Terminal, `passwort_holen` verzweigt auf `sys.stdin.isatty()` und
   *  wartete auf eine Tastatur — kein Fehler, ein Haenger bis zur Frist. Die
   *  lange Fassung steht bei der Montage in server.ts. */
  vorspann?: string[]
  /** Name dieser Box — fuer die Fremdheitspruefung. */
  host?: () => string
  /** Ist die Anmeldung ausgeschaltet? Wird nur GEMELDET, nie durchgesetzt. */
  anmeldungOffen?: () => boolean
  /** Frist je Lauf. Ein Stand der Box entsteht in unter einer Sekunde;
   *  90 s decken auch eine muede Karte ab. */
  fristMs?: number
  jetzt?: () => number
}

export interface Lauf {
  code: number
  aus: string
  fehler: string
  /** Wurde das Kind an der Frist abgewuergt? (Dann sagt `fehler` nichts ueber
   *  den Zustand der Box — siehe `abbruchLage`.) */
  gewuergt?: boolean
}

/**
 * Einen Lauf des Pythons starten. Das Passwort geht ueber **stdin**.
 *
 * DREI DINGE, DIE HIER NICHT PASSIEREN DUERFEN und deshalb bezeichnet sind:
 *   1. KEINE SHELL. `execFile` mit einem Argument-Array; ein Dateiname mit
 *      einem Anfuehrungszeichen darin ist dann ein Dateiname.
 *   2. DAS PASSWORT STEHT IN KEINEM ARGUMENT. Es geht als eine Zeile nach
 *      stdin und wird sofort geschlossen.
 *   3. DAS PASSWORT STEHT IN KEINER UMGEBUNG — auch nicht in der geerbten
 *      (siehe umgebungOhnePasswort).
 */
export function pythonLaufen(umg: SicherungUmgebung, argumente: string[], passwort?: string | null): Promise<Lauf> {
  const befehl = [...(umg.vorspann ?? []), umg.python ?? 'python3', umg.skript, ...argumente]
  const [kopf, ...rest] = befehl as [string, ...string[]]
  return new Promise((fertig) => {
    const kind = execFile(
      kopf,
      rest,
      {
        timeout: umg.fristMs ?? 90_000,
        maxBuffer: 4 * 1024 * 1024,
        env: umgebungOhnePasswort(process.env),
      },
      (err, aus, fehler) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? ((err as { code?: number }).code as number)
            : err
              ? 1
              : 0
        // DIE FRIST HAT EINEN EIGENEN SATZ, und zwar aus einem konkreten
        // Grund: `passwort_holen` verzweigt auf `sys.stdin.isatty()`. Bekaeme
        // das Kind je ein Pseudo-Terminal (ein `sudo` mit `use_pty` davor
        // waere so ein Fall), wartete es auf eine Tastatur, an der niemand
        // sitzt — und der Ausgang waere ein STUMMES Ende nach 90 Sekunden.
        // Ohne diese Zeilen stuende danach „ohne Begruendung gescheitert" und
        // niemand wuesste, wo er suchen soll.
        //
        // WAS HIER FRUEHER STAND UND FALSCH WAR: „… und wurde abgebrochen. Es
        // wurde nichts geaendert." Das weiss diese Stelle NICHT. Sie startet
        // Prozesse; ob einer davon schon geschrieben hat, steht in seiner
        // Ausgabe. Nachgemessen (07.08.2026, Sandkasten, SIGTERM 1,8 s in die
        // Schreibschleife): data.json, darstellung.json, kinderzeit.json und
        // der Verlauf des Kindes waren zurueckgespielt, verfuegbarkeit.json
        // stand noch auf dem alten Wert. Halb alt, halb neu — und der Satz
        // sagte, es sei nichts geschehen. Wer das liest, sucht den Stand
        // „vorher" nicht, den das Python zuvor angelegt hat.
        //
        // Den Satz spricht jetzt der Weg, der weiss, ob geschrieben wurde
        // (`abbruchLage` unten). Hier steht nur noch, WAS passiert ist.
        const gewuergt = Boolean((err as { killed?: boolean } | null)?.killed)
        fertig({
          code,
          aus: spurenFrei(String(aus ?? ''), passwort),
          gewuergt,
          fehler: gewuergt
            ? `Das Sicherungswerkzeug hat nach ${Math.round((umg.fristMs ?? 90_000) / 1000)} s nicht geantwortet und wurde abgebrochen.`
            : spurenFrei(String(fehler ?? err?.message ?? ''), passwort),
        })
      },
    )
    // stdin IMMER schliessen, auch ohne Passwort: `passwort_holen` liest bei
    // einer Eingabe, die keine Tastatur ist, eine Zeile — bliebe der Kanal
    // offen, haenge das Python bis zur Frist. Genau so ist es beim Bauen
    // dieses Weges einmal passiert (90 s Warten statt einer Fehlermeldung).
    try {
      if (passwort) kind.stdin?.write(`${passwort}\n`)
      kind.stdin?.end()
    } catch {
      // Kind schon tot — der Rueckruf oben meldet es.
    }
  })
}

/* ══ Der Eingang ═════════════════════════════════════════════════════════ */

/** Alte Eingaenge wegraeumen. Wird bei JEDEM Aufruf gemacht, damit ein
 *  abgebrochener Plan nicht ewig liegen bleibt. Fasst ausschliesslich Dateien
 *  an, deren Name die Vorsilbe traegt — ein echter Stand ist nie dabei. */
export function eingangAufraeumen(staende: string, jetzt: number, fristMs = EINGANG_FRIST_MS): number {
  if (!existsSync(staende)) return 0
  let weg = 0
  for (const n of readdirSync(staende)) {
    if (!istEingang(n)) continue
    const p = join(staende, n)
    try {
      if (jetzt - statSync(p).mtimeMs > fristMs) {
        rmSync(p)
        weg++
      }
    } catch {
      // Weg oder nicht lesbar: nichts zu tun.
    }
  }
  return weg
}

/**
 * Platz fuer einen neuen Eingang schaffen — der aelteste weicht.
 *
 * DIE FRIST ALLEIN REICHT NICHT. `eingangAufraeumen` raeumt nach ZEIT, und
 * innerhalb einer halben Stunde passen beliebig viele Vorschauen mit je bis zu
 * 8 MB auf die Karte. Gemessen wurde es (tools/sicherung-was-geht-hinaus.ts,
 * Ring 6): sieben Anfragen, sieben Dateien, keine Grenze in Sicht. Auf einer
 * Karte, auf der auch die Bibliothek liegt, ist das keine theoretische Groesse.
 *
 * Geraeumt wird nach mtime, aeltester zuerst — das ist der, den mit der
 * groessten Wahrscheinlichkeit niemand mehr bestaetigen will. Wer trotzdem auf
 * ihn klickt, bekommt den Satz „die geprueften Bytes liegen nicht mehr auf der
 * Box, bitte die Datei noch einmal waehlen" und ist damit einen Klick von der
 * Vorschau entfernt — kein Rueckweg geht verloren.
 */
export function eingangPlatzSchaffen(staende: string, hoechstens = EINGANG_HOECHSTENS): number {
  if (!existsSync(staende)) return 0
  const da: { p: string; zeit: number }[] = []
  for (const n of readdirSync(staende)) {
    if (!istEingang(n)) continue
    const p = join(staende, n)
    try {
      da.push({ p, zeit: statSync(p).mtimeMs })
    } catch {
      // Weg zwischen readdir und stat: dann ist er ohnehin kein Platzhalter.
    }
  }
  // `hoechstens - 1`: es soll ja gleich noch einer dazukommen.
  const zuviel = da.length - Math.max(0, hoechstens - 1)
  if (zuviel <= 0) return 0
  let weg = 0
  for (const e of da.sort((a, b) => a.zeit - b.zeit).slice(0, zuviel)) {
    try {
      rmSync(e.p)
      weg++
    } catch {
      // Nicht loeschbar: dann bleibt er liegen, die Frist holt ihn.
    }
  }
  return weg
}

/* ══ Die Wege ════════════════════════════════════════════════════════════ */

/**
 * Nur EIN Lauf gleichzeitig.
 *
 * Zwei Eltern an zwei Geraeten, beide druecken „zurueckspielen": das Python
 * haelt fuer die Wiederherstellung selbst eine Sperre (`/run/...`), aber die
 * greift erst, wenn der zweite Lauf schon angefangen hat, und sie hilft nicht
 * gegen „anlegen waehrend zurueckgespielt wird". Hier ist die billigste
 * Stelle: ein Riegel im Server, und der zweite bekommt einen Satz statt eines
 * halben Ergebnisses.
 */
let laeuft: null | string = null

function riegel(was: string): boolean {
  if (laeuft) return false
  laeuft = was
  return true
}

function riegelAuf(): void {
  laeuft = null
}

function fehlerAntwort(res: Response, code: number, satz: string, mehr?: object): void {
  res.status(code).json({ ok: false, fehler: satz, ...(mehr ?? {}) })
}

/**
 * Die Wege. Ein Router, damit derselbe Code im Sandkasten gegen ein
 * Testverzeichnis laufen kann (tools/sicherung-ohne-ssh-ring.ts) — eine
 * zweite Fassung „nur fuer den Test" waere genau die Fassung, die nicht das
 * misst, was im Betrieb laeuft.
 */
export function sicherungWegeBauen(umg: SicherungUmgebung): Router {
  const r = express.Router()
  const jetzt = () => (umg.jetzt ? umg.jetzt() : Date.now())
  const eigenerHost = () => (umg.host ? umg.host() : hostname())

  const aufraeumen = () => {
    try {
      eingangAufraeumen(umg.staende, jetzt())
    } catch {
      // Ein nicht raeumbarer Eingang darf keinen Weg blockieren.
    }
  }

  /**
   * DIESE WEGE GEHOEREN DER SEITE DER BOX — nicht einer fremden Webseite.
   *
   * WARUM DAS HIER STEHT UND NICHT BEI DER ANMELDUNG: In der Vorgabe ist
   * `interfacelogin.state=false`, das Tor also offen; und in server.ts liegt
   * `app.use(cors())` VOR dem Tor. Damit antwortet die Box jeder Herkunft mit
   * `Access-Control-Allow-Origin: *` — und eine nicht angemeldete Anfrage darf
   * dann auch GELESEN werden. Gemessen (tools/sicherung-was-geht-hinaus.ts,
   * Ring 2): eine Seite auf einem fremden Rechner, die ein Elternteil im
   * gleichen Heimnetz aufmacht, holt sich mit einem einzigen
   * `fetch('http://mupibox:8200/api/sicherung/anlegen', {method:'POST'})` die
   * ganze Konfiguration der Box — ohne Passwort, ohne Anmeldung, ohne dass
   * jemand etwas merkt. Ein Formular-POST braucht dafuer nicht einmal eine
   * Vorabfrage.
   *
   * ZWEI STRICHE, und beide sind absichtlich SCHWACH gewaehlt, weil ein zu
   * scharfer Riegel hier die naechste Sackgasse waere:
   *
   *   1. `Access-Control-Allow-Origin` wird fuer DIESE Wege wieder entfernt.
   *      Eine gleichherkuenftige Seite (die Verwaltung selbst) braucht die
   *      Kopfzeile nicht; ohne sie verweigert der Browser einer fremden Seite
   *      das LESEN der Antwort. Das gilt in jedem Browser, auch einem alten.
   *
   *   2. `Sec-Fetch-Site: cross-site` wird abgewiesen. Diese Kopfzeile setzt
   *      der BROWSER, sie laesst sich aus einer Seite heraus nicht faelschen.
   *      Abgewiesen wird NUR dieser eine Wert: `same-origin`, `same-site`,
   *      `none` (Adresszeile) und „gar nicht da" (curl, ein aelterer Browser,
   *      ein Zwischenstueck, das sie streicht) kommen durch. Der Preis dafuer
   *      ist, dass ein Browser ohne diese Kopfzeile nicht geschuetzt ist; der
   *      Preis der scharfen Fassung waere, dass ein Elternteil hinter einem
   *      Zwischenstueck seinen Rueckweg verliert. In dieser Reihenfolge.
   *
   * ── DER PFAD IST TRAGEND, NICHT ZIERDE (nachgetragen 07.08.2026) ────────
   * Hier stand `r.use(fn)` OHNE Pfad. Dieser Router wird in server.ts mit
   * `app.use(sicherungWegeBauen({...}))` eingehaengt — ebenfalls ohne Pfad.
   * Beides zusammen heisst: die Zwischenschicht lief fuer JEDE Anfrage der
   * ganzen Anwendung, nicht fuer die fuenf Wege, ueber die dieser Kommentar
   * spricht („fuer DIESE Wege"). Drei Folgen, alle gemessen:
   *
   *   1. DER RUECKWEG VON SPOTIFY WAR TOT. `accounts.spotify.com` schickt den
   *      Browser auf `http://<box>:8200/spotify` — eine Navigation der
   *      obersten Ebene und damit `Sec-Fetch-Site: cross-site`. Ergebnis: 403
   *      mit dem Satz von hier, auf einer Seite, die mit Sicherungen nichts zu
   *      tun hat. Wer Spotify einrichten wollte, kam nicht mehr an.
   *   2. `Access-Control-Allow-Origin` wurde auf JEDER Antwort entfernt. Damit
   *      war der Ausweg `MUPIBOX_HERKUNFT_ZUSATZ` (herkunft.ts, fuer
   *      `ng serve`) wirkungslos: die Anfrage kam durch, die Antwort war fuer
   *      den Browser trotzdem nicht lesbar.
   *   3. Die in herkunft.ts beschriebene Ausnahme fuer die Navigation der
   *      obersten Ebene konnte nirgends greifen — dieser Riegel lag dahinter
   *      und kennt sie nicht.
   *
   * Der Pfad nimmt NICHTS weg: seit dem 07.08.2026 liegt der Herkunftsriegel
   * (herkunft.ts) vor `/api` und `/player` und zieht dort dieselben zwei
   * Striche schaerfer — mit Origin, also auch ohne `Sec-Fetch-*`.
   */
  r.use('/api/sicherung', (req: Request, res: Response, next) => {
    res.removeHeader('Access-Control-Allow-Origin')
    res.setHeader('Vary', 'Origin')
    if (String(req.headers['sec-fetch-site'] ?? '') === 'cross-site') {
      fehlerAntwort(
        res,
        403,
        'Dieser Weg laesst sich nur von der Verwaltung dieser Box aus benutzen — die Anfrage kam von einer anderen Webseite.',
      )
      return
    }
    next()
  })

  /* ── Lage ───────────────────────────────────────────────────────────── */
  r.get('/api/sicherung', async (_req, res) => {
    aufraeumen()
    const lauf = await pythonLaufen(umg, ['--liste', '--json'])
    let staende: unknown[] = []
    let lesbar = true
    try {
      const roh = JSON.parse(lauf.aus || '[]')
      staende = Array.isArray(roh) ? roh.filter((s) => !istEingang(String(s?.name ?? ''))) : []
    } catch {
      lesbar = false
    }
    res.json({
      ok: true,
      // Ohne das Skript geht gar nichts — dann soll die Seite das SAGEN und
      // nicht mit toten Knoepfen dastehen.
      werkzeugDa: existsSync(umg.skript),
      // WANN SIEHT MAN ES? HIER — beim Aufschlagen der Seite.
      //
      // Der naheliegende Ort waere die Antwort auf „Sichern": dort ist der
      // Mensch aber gerade zufrieden und liest den gruenen Satz nicht zu Ende.
      // Beim ZURUECKSPIELEN ist es zu spaet. Diese Auskunft steht deshalb
      // OBEN AUF DER SEITE, jedes Mal, bevor irgendein Knopf gedrueckt wurde —
      // und sie steht nur dann da, wenn wirklich etwas herausgefallen ist.
      nichtEingeordnet: letzteNichtEingeordnet(umg.staende),

      lesbar,
      host: eigenerHost(),
      // Die Entscheidung aus Frage 4: gemeldet, nicht durchgesetzt.
      anmeldungOffen: umg.anmeldungOffen ? umg.anmeldungOffen() : false,
      ablageHinweise: ABLAGE_HINWEISE,
      passwortMin: PASSWORT_MIN,
      maxBytes: MAX_ARCHIV_BYTES,
      staende,
      meldung: lesbar ? '' : lauf.fehler.trim().split('\n').slice(-3).join(' '),
    })
  })

  /* ── Anlegen und herunterladen ──────────────────────────────────────── */
  //
  // POST, obwohl es ein Download ist — weil ein Passwort mitkommen kann und
  // ein Passwort NIE in eine Adresse gehoert. Der Browser holt die Bytes
  // deshalb per fetch und legt sie ueber einen Objekt-URL ab; das ist der
  // Preis fuer die Adresse ohne Geheimnis und er ist klein.
  r.post('/api/sicherung/anlegen', express.json({ limit: '8kb' }), async (req, res) => {
    const koerper = (req.body ?? {}) as Record<string, unknown>
    const mitZugangsdaten = koerper['mitZugangsdaten'] === true
    let passwort: string | null = null
    if (mitZugangsdaten) {
      const p = passwortPruefen(koerper['passwort'])
      if (!p.ok) {
        fehlerAntwort(res, 400, p.grund as string)
        return
      }
      passwort = koerper['passwort'] as string
    }
    if (!riegel('anlegen')) {
      fehlerAntwort(res, 409, 'Es laeuft gerade schon eine Sicherung. Bitte einen Moment warten.')
      return
    }
    try {
      aufraeumen()
      const vorher = new Set(standNamen(umg.staende))
      const args = ['--anlegen', '--grund', 'verwaltung']
      // `--behalten` MIT Zugangsdaten: einen Stand, fuer den jemand ein
      // Passwort getippt hat, darf die Auslese nicht wegwerfen. (Das Python
      // heftet ihn ohnehin an; hier steht es, damit es auch dann so bleibt,
      // wenn sich das dort einmal aendert.)
      if (mitZugangsdaten) args.push('--mit-zugangsdaten', '--behalten')
      const lauf = await pythonLaufen(umg, args, passwort)
      if (lauf.code !== 0) {
        // HIER darf der Satz stehen, und zwar ohne Vorbehalt: `--anlegen`
        // LIEST die Box und schreibt nur in das Verzeichnis der Staende.
        // Scheitert es — an welcher Stelle auch immer —, steht die
        // Konfiguration unveraendert da.
        fehlerAntwort(res, 500, `${standFehlerSatz(lauf)}\nAn der Box wurde nichts geaendert.`, {
          ausgabe: kurz(lauf),
        })
        return
      }
      const neu = standNamen(umg.staende).filter((n) => !vorher.has(n))
      // Der frischeste NEUE Stand. Nicht „neueste" aus der Liste: ein
      // Zeitgeber koennte in derselben Sekunde einen angelegt haben, und dann
      // bekaeme der Benutzer eine Datei, die nicht die seine ist.
      const name = neu.sort().reverse()[0]
      if (!name) {
        fehlerAntwort(
          res,
          500,
          'Die Box meldet Erfolg, aber es ist kein neuer Stand entstanden. Nichts heruntergeladen.',
          { ausgabe: kurz(lauf) },
        )
        return
      }
      const bytes = readFileSync(join(umg.staende, name))
      let kopf: StandKopf
      try {
        kopf = standKopfLesen(bytes)
      } catch (e) {
        fehlerAntwort(res, 500, e instanceof Error ? e.message : String(e))
        return
      }
      // GEGENGELESEN, BEVOR ES HINAUSGEHT: Wer `mitZugangsdaten` angekreuzt
      // und ein Passwort getippt hat, muss sich darauf verlassen koennen,
      // dass sie DRIN sind. Waeren sie es nicht (kein gpg auf der Box, ein
      // Fehler im Behaelter), bekaeme er sonst eine Datei, die aussieht wie
      // eine vollstaendige Sicherung und keine ist — und das faellt erst dann
      // auf, wenn er sie braucht.
      if (mitZugangsdaten && kopf.zugangsdaten.length === 0) {
        fehlerAntwort(
          res,
          500,
          'Der Stand ist entstanden, aber OHNE die Zugangsdaten — vermutlich fehlt gpg auf dieser Box. Er liegt auf der Box; heruntergeladen wurde nichts, damit keine Datei herumliegt, die vollstaendig aussieht und es nicht ist.',
          { ausgabe: kurz(lauf) },
        )
        return
      }
      res.setHeader('Content-Type', 'application/gzip')
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName(kopf)}"`)
      res.setHeader('X-Mupi-Stand', name)
      res.setHeader('X-Mupi-Dateien', String(kopf.dateien.length))
      res.setHeader('X-Mupi-Zugangsdaten', String(kopf.zugangsdaten.length))
      // DIE ZAHL MUSS HIER MIT, WEIL DIE ANTWORT DIE ARCHIVBYTES SIND.
      // Genau daran ist die Warnung bisher verendet: `--anlegen` ruft sie auf
      // stdout, und stdout wird an dieser Stelle vollstaendig verworfen. Ein
      // Kopfzeilenwert ist das einzige, was hier neben den Bytes noch Platz
      // hat — er reicht der Seite, um den gruenen Satz sofort in einen
      // anderen zu verwandeln, statt ihn erst beim naechsten Laden zu
      // korrigieren. Die PFADE stehen unter /api/sicherung; hierhin gehoeren
      // keine Dateinamen, denn Kopfzeilen sind nur ASCII und begrenzt.
      res.setHeader('X-Mupi-Nicht-Eingeordnet', String(kopf.nichtEingeordnet.length))
      res.setHeader('Content-Length', String(bytes.length))
      res.end(bytes)
    } finally {
      riegelAuf()
    }
  })

  /* ── Einen Stand, der schon auf der Box liegt, herunterladen ────────── */
  //
  // WOZU, wenn es doch „anlegen" gibt: Wer gerade etwas kaputt gemacht hat,
  // will NICHT den jetzigen Zustand sichern, sondern den von VORHER in
  // Sicherheit bringen — der Zeitgeber und der Pfad-Wachhund legen laufend
  // welche an. Ohne diesen Weg waeren sie nur ueber SSH erreichbar, und damit
  // waere die haeufigste Rettung wieder SSH-only.
  r.get('/api/sicherung/stand/:name', (req, res) => {
    const name = String(req.params['name'] ?? '')
    // Der Name kommt aus der Adresse. Er wird NICHT zusammengesetzt, sondern
    // gegen die Liste gehalten, die die Box selbst kennt — damit ist jeder
    // Ausbruch aus dem Verzeichnis ausgeschlossen, ohne dass irgendwo ein
    // Pfadmuster geraten werden muss.
    if (!standNamen(umg.staende).includes(name)) {
      fehlerAntwort(res, 404, 'Diesen Stand gibt es auf der Box nicht (mehr).')
      return
    }
    let bytes: Buffer
    try {
      bytes = readFileSync(join(umg.staende, name))
    } catch {
      fehlerAntwort(res, 500, 'Der Stand liegt da, laesst sich aber nicht lesen.')
      return
    }
    let kopf: StandKopf
    try {
      kopf = standKopfLesen(bytes)
    } catch (e) {
      fehlerAntwort(res, 500, e instanceof Error ? e.message : String(e))
      return
    }
    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName(kopf)}"`)
    res.setHeader('Content-Length', String(bytes.length))
    res.end(bytes)
  })

  /* ── Schritt 1: pruefen, was passieren WUERDE ───────────────────────── */
  r.post(
    '/api/sicherung/pruefen',
    express.raw({ type: () => true, limit: MAX_ARCHIV_BYTES }),
    async (req: Request, res: Response) => {
      const bytes = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0)
      if (bytes.length === 0) {
        fehlerAntwort(res, 400, 'Es kam keine Datei an.')
        return
      }
      let kopf: StandKopf
      try {
        kopf = standKopfLesen(bytes)
      } catch (e) {
        fehlerAntwort(res, 400, e instanceof Error ? e.message : String(e))
        return
      }
      const fremd = fremdheitPruefen(kopf, eigenerHost())
      if (fremd.ablehnen) {
        fehlerAntwort(res, 400, fremd.ablehnen)
        return
      }
      if (!riegel('pruefen')) {
        fehlerAntwort(res, 409, 'Es laeuft gerade schon eine Sicherung. Bitte einen Moment warten.')
        return
      }
      try {
        aufraeumen()
        const kennung = sha256(bytes)
        const name = eingangName(kennung)
        try {
          mkdirSync(umg.staende, { recursive: true })
          // PLATZ MACHEN, BEVOR ETWAS DAZUKOMMT. Die Frist raeumt nach ZEIT
          // und laesst innerhalb einer halben Stunde beliebig viele zu.
          eingangPlatzSchaffen(umg.staende)
          // Danebenlegen und umbenennen — dieselbe Regel wie ueberall sonst.
          // Ein halb geschriebener Eingang saehe aus wie ein Archiv.
          const neben = join(umg.staende, `${name}.imbau`)
          writeFileSync(neben, bytes, { mode: 0o600 })
          renameSync(neben, join(umg.staende, name))
        } catch (e) {
          fehlerAntwort(
            res,
            500,
            `Die Datei liess sich auf der Box nicht ablegen: ${e instanceof Error ? e.message : String(e)}`,
          )
          return
        }
        // TROCKEN. Es wird nichts geschrieben — das Python sagt nur, was es
        // taete. `--mit-zugangsdaten` steht hier ABSICHTLICH nicht: fuer den
        // Plan wird kein Passwort gebraucht, und ein Passwort, das man nicht
        // braucht, soll man auch nicht eingeben.
        const lauf = await pythonLaufen(umg, ['--wiederherstellen', name, '--trocken'])
        if (lauf.code !== 0) {
          // AUCH HIER ohne Vorbehalt: der Lauf traegt `--trocken`, und diese
          // Schleife schreibt unter `if not trocken`. Es GIBT keinen Weg, auf
          // dem hier etwas an der Box haengen bleibt.
          fehlerAntwort(res, 400, `${standFehlerSatz(lauf)}\nEs wurde nichts geaendert.`, {
            ausgabe: kurz(lauf),
          })
          return
        }
        const zeilen = lauf.aus.split('\n').filter((z) => z !== '')
        const plan = berichtDeuten(zeilen)
        res.json({
          ok: true,
          kennung,
          gueltigBis: jetzt() + EINGANG_FRIST_MS,
          stand: {
            erzeugt: kopf.erzeugt,
            grund: kopf.grund,
            host: kopf.host,
            format: kopf.format,
            dateien: kopf.dateien.length,
            bytes: bytes.length,
            zugangsdaten: kopf.zugangsdaten,
            // WAS DIESER STAND NIE ENTHIELT. Beim Zurueckspielen ist es zu
            // spaet, um es noch zu aendern — aber nicht zu spaet, um es zu
            // WISSEN: wer diesen Stand auf eine neu aufgesetzte Box spielt,
            // bekommt genau diese Stellen nicht wieder. Ohne diese Zeile
            // stuende „N Dateien" da und der Rest waere unsichtbar.
            nichtEingeordnet: nichtEingeordnetDeuten(kopf.nichtEingeordnet, 'stand'),
          },
          warnungen: fremd.warnungen,
          plan,
          satz: planSatz(plan),
          zeilen,
        })
      } finally {
        riegelAuf()
      }
    },
  )

  /* ── Schritt 2: wirklich zurueckspielen ─────────────────────────────── */
  r.post('/api/sicherung/zurueckspielen', express.json({ limit: '8kb' }), async (req, res) => {
    const koerper = (req.body ?? {}) as Record<string, unknown>
    const kennung = String(koerper['kennung'] ?? '')
    if (!/^[0-9a-f]{64}$/.test(kennung)) {
      fehlerAntwort(res, 400, 'Ohne die Kennung aus der Vorschau wird nichts eingespielt.')
      return
    }
    const mitZugangsdaten = koerper['mitZugangsdaten'] === true
    let passwort: string | null = null
    if (mitZugangsdaten) {
      const p = passwortPruefen(koerper['passwort'])
      if (!p.ok) {
        fehlerAntwort(res, 400, p.grund as string)
        return
      }
      passwort = koerper['passwort'] as string
    }
    let name: string
    try {
      name = eingangName(kennung)
    } catch {
      fehlerAntwort(res, 400, 'Unbrauchbare Kennung.')
      return
    }
    const pfad = join(umg.staende, name)
    if (!existsSync(pfad)) {
      fehlerAntwort(
        res,
        410,
        'Die geprueften Bytes liegen nicht mehr auf der Box (zu lange her oder ein Neustart dazwischen). Bitte die Datei noch einmal waehlen — dann steht die Vorschau wieder da.',
      )
      return
    }
    // DIE GLEICHE DATEI WIE IN DER VORSCHAU — nachgerechnet, nicht geglaubt.
    // Ohne diese vier Zeilen koennte zwischen Vorschau und Klick etwas
    // anderes an dieser Stelle liegen, und die Zahlen, die der Benutzer
    // gelesen hat, gaelten fuer einen anderen Stand.
    let bytes: Buffer
    try {
      bytes = readFileSync(pfad)
    } catch {
      fehlerAntwort(res, 500, 'Die geprueften Bytes liessen sich nicht mehr lesen.')
      return
    }
    if (sha256(bytes) !== kennung) {
      fehlerAntwort(
        res,
        409,
        'Die Datei auf der Box ist nicht mehr die, ueber der die Vorschau stand. Es wurde NICHTS eingespielt.',
      )
      return
    }
    if (!riegel('zurueckspielen')) {
      fehlerAntwort(res, 409, 'Es laeuft gerade schon eine Sicherung. Bitte einen Moment warten.')
      return
    }
    try {
      // `--trotzdem` steht hier NICHT und wird auch nie aus dem Koerper
      // uebernommen. Begruendung im Kopfkommentar, Frage 3.
      const args = ['--wiederherstellen', name]
      if (mitZugangsdaten) args.push('--mit-zugangsdaten')
      const lauf = await pythonLaufen(umg, args, passwort)
      if (lauf.code !== 0) {
        // IM REGELFALL IST HIER NICHTS GESCHRIEBEN. Das Python prueft alles,
        // bevor es die erste Datei anfasst (Passwort, Pruefsummen,
        // konfig_pruefen, klagen_ueber) — und der Satz sagt das auch, damit
        // niemand aus einer roten Meldung auf eine halbe Box schliesst.
        //
        // ES IST ABER NICHT IMMER SO, UND DAS WURDE GEMESSEN. Wird das Kind
        // MITTEN IN DER SCHREIBSCHLEIFE abgebrochen — an der Frist, an einem
        // Absturz, an einem Neustart —, steht die Box halb alt und halb neu
        // da (07.08.2026: SIGTERM nach 1,8 s, vier Dateien zurueckgespielt,
        // eine nicht). Der Satz „es wurde nichts geaendert" waere dann die
        // gefaehrlichste Auskunft von allen: wer ihn glaubt, sucht den Stand
        // „vorher" nicht, den das Python zuvor angelegt hat.
        //
        // ALSO WIRD NACHGESEHEN statt behauptet: `abbruchLage` zaehlt die
        // Zeilen, die das Python fuer jede geschriebene Datei ausgibt, und
        // nennt den Rueckweg beim Namen.
        const lage = abbruchLage(lauf.aus)
        const grund = lauf.gewuergt ? lauf.fehler : standFehlerSatz(lauf)
        fehlerAntwort(res, lage.geschrieben > 0 ? 500 : 400, `${grund}\n${lage.satz}`, {
          ausgabe: kurz(lauf),
          geschrieben: lage.geschrieben,
          vorherStand: lage.vorherStand,
        })
        return
      }
      const zeilen = lauf.aus.split('\n').filter((z) => z !== '')
      const plan = berichtDeuten(zeilen)
      // Das Python legt vor dem Schreiben selbst einen Stand „vorher" an und
      // nennt ihn in der ersten Zeile. Der ist der Rueckweg AUS dem Rueckweg
      // — er gehoert deshalb in die Antwort und auf den Schirm.
      const vorher = zeilen.find((z) => z.startsWith('vorher gesichert als '))
      res.json({
        ok: true,
        satz: planSatz(plan),
        plan,
        zeilen,
        vorherStand: vorher ? vorher.replace('vorher gesichert als ', '').trim() : null,
        // Was jetzt noch fehlt, ist die eine Angabe, die zaehlt.
        vonHand: plan.vonHand,
        neustartNoetig: plan.aendert.length > 0,
      })
    } finally {
      riegelAuf()
      // Der Eingang hat seinen Zweck erfuellt. Er bleibt NICHT liegen: er
      // traegt die halbe Konfiguration einer Box, und ein zweites Einspielen
      // desselben Standes geht ueber die Liste der Staende (das Python hat
      // ihn beim Anlegen von „vorher" ohnehin nicht angefasst).
      try {
        rmSync(pfad)
      } catch {
        // Bleibt liegen — `eingangAufraeumen` holt ihn beim naechsten Aufruf.
      }
    }
  })

  return r
}

/* ══ Kleinkram ═══════════════════════════════════════════════════════════ */

/**
 * Was hat der LETZTE Stand dieser Box nicht eingeordnet?
 *
 * WARUM AUS DEM STAND UND NICHT AUS EINEM FRISCHEN LAUF: ein Lauf des Pythons
 * beim blossen Aufschlagen der Seite waere ein Nebeneffekt, den niemand
 * angestossen hat — und er kostet auf einer muede gewordenen Karte Sekunden.
 * Der letzte Stand traegt dieselbe Auskunft, sie ist im schlimmsten Fall so
 * alt wie er, und Staende entstehen von selbst (Zeitgeber, Pfad-Wachhund, vor
 * jedem Update). Der Preis ist also ein Verzug, nicht ein blinder Fleck.
 *
 * SCHWEIGT, WENN ES NICHTS ZU SAGEN GIBT. Kein Stand da, leere Liste — dann
 * `null`, und die Seite zeigt nichts. Diese Auskunft darf niemals der Grund
 * sein, dass die Seite mit einer Fehlermeldung dasteht: sie ist ein Zusatz.
 *
 * ── ABER SIE SCHWEIGT NICHT MEHR UEBER EINEN UNLESBAREN STAND ───────────
 * Bis zum 07.08.2026 stand hier ein `try` um alles und ein `return null` im
 * `catch`. Gemessen: liegt ein gueltiger Stand mit einem Fund da, steht die
 * Warnung; legt man einen NEUEREN daneben, der kein gzip ist, ist sie WEG —
 * und in der Antwort steht kein Wort darueber. Das ist DIESELBE Bauart wie der
 * Fehler, gegen den diese ganze Karte gebaut ist: eine Warnung, die niemand
 * hoert. Ein kaputter neuester Stand ist ausserdem fuer sich genommen eine
 * Nachricht — er ist das, was im Ernstfall zurueckgespielt werden soll.
 *
 * JETZT WIRD WEITERGESUCHT: unlesbare Staende werden gezaehlt und GENANNT, und
 * die Auskunft kommt aus dem neuesten Stand, der sich oeffnen liess. Steht
 * darin nichts, bleibt die Karte trotzdem stehen — dann traegt sie nur den
 * einen Satz ueber den unlesbaren Stand.
 */
function letzteNichtEingeordnet(verz: string): (NichtEingeordnetBefund & { stand: string; erzeugt: string }) | null {
  const namen = standNamen(verz).sort().reverse()
  /** Die unlesbaren, neueste zuerst. */
  const uebersprungen: { name: string; warum: string }[] = []
  for (const name of namen) {
    let kopf: StandKopf
    try {
      kopf = standKopfLesen(readFileSync(join(verz, name)))
    } catch (e) {
      uebersprungen.push({ name, warum: e instanceof Error ? e.message : String(e) })
      continue
    }
    const befund = nichtEingeordnetDeuten(kopf.nichtEingeordnet, 'jetzt')
    if (befund.pfade.length === 0 && uebersprungen.length === 0) return null
    return {
      pfade: befund.pfade,
      satz: befund.satz || unlesbarSatz(uebersprungen),
      rat: [...unlesbarRat(uebersprungen, name), ...befund.rat],
      stand: name,
      erzeugt: kopf.erzeugt,
    }
  }
  // Kein einziger Stand liess sich oeffnen. Wenn ueberhaupt keiner da ist, ist
  // das der Normalfall einer frischen Box — dann schweigt es weiter.
  if (uebersprungen.length === 0) return null
  return {
    pfade: [],
    satz: unlesbarSatz(uebersprungen),
    rat: unlesbarRat(uebersprungen, null),
    stand: uebersprungen[0].name,
    erzeugt: '',
  }
}

function unlesbarSatz(uebersprungen: { name: string }[]): string {
  if (uebersprungen.length === 0) return ''
  return uebersprungen.length === 1
    ? 'Der neueste Stand auf dieser Box lässt sich nicht öffnen.'
    : `Die ${uebersprungen.length} neuesten Stände auf dieser Box lassen sich nicht öffnen.`
}

function unlesbarRat(uebersprungen: { name: string; warum: string }[], genutzt: string | null): string[] {
  if (uebersprungen.length === 0) return []
  const erste = uebersprungen[0]
  return [
    `Betroffen ist ${erste.name}${uebersprungen.length > 1 ? ` (und ${uebersprungen.length - 1} weitere)` : ''}: ${erste.warum}`,
    'Was das heißt: dieser Stand ist im Ernstfall NICHT zurückzuspielen. Legen Sie jetzt einen neuen an — der Knopf darunter genügt.',
    genutzt
      ? `Die Angaben in dieser Karte stammen deshalb aus ${genutzt} — was seither dazugekommen ist, hat niemand geprüft.`
      : 'Es ließ sich KEIN Stand öffnen; ob etwas aus den Sicherungen herausfällt, ist damit unbekannt.',
  ]
}

function standNamen(verz: string): string[] {
  try {
    return readdirSync(verz).filter(
      (n) => n.startsWith('mupibox-sicherung-') && n.endsWith('.tar.gz') && !istEingang(n),
    )
  } catch {
    return []
  }
}

/**
 * Aus dem Gejammer des Pythons einen Satz machen, den man zeigen kann.
 *
 * `SystemExit("…")` landet als letzte Zeile auf stderr — und genau die ist
 * die Begruendung („dieser Stand wuerde die Box unbrauchbar machen: …").
 * Steht dort nichts, sagen wir das auch, statt eine Ursache zu erfinden.
 */
export function standFehlerSatz(lauf: Lauf): string {
  const zeilen = (lauf.fehler || '')
    .split('\n')
    .map((z) => z.trim())
    .filter(Boolean)
  const letzte = zeilen[zeilen.length - 1] ?? ''
  // OB ETWAS GEAENDERT WURDE, STEHT HIER NICHT MEHR DRIN. Diese Funktion
  // sieht nur stderr; ob die Schreibschleife schon gelaufen war, steht auf
  // stdout. Beide Saetze zusammenzuziehen hiess, die haeufige Vermutung
  // („vor dem ersten Byte gescheitert") als Tatsache auszugeben — und im
  // seltenen Fall genau die Auskunft zu geben, die schadet. Den Zusatz
  // spricht der Weg, der nachgesehen hat (`abbruchLage`).
  if (/Traceback|^ *File "/.test(lauf.fehler) && !letzte) {
    return 'Das Sicherungswerkzeug ist gescheitert.'
  }
  if (!letzte) return 'Das Sicherungswerkzeug ist ohne Begruendung gescheitert.'
  // Mehrzeilige SystemExit-Meldungen (die interessanten sind mehrzeilig)
  // wollen wir ganz — aber nicht das halbe Journal.
  return zeilen.slice(-8).join('\n')
}

function kurz(lauf: Lauf): string {
  return [lauf.aus, lauf.fehler].filter(Boolean).join('\n').split('\n').slice(-20).join('\n')
}
