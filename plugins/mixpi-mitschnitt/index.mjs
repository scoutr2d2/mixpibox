/**
 * MixPi Mitschnitt — eine TESTFUNKTION, und sie darf niemandem passieren.
 *
 * ══ DER SATZ, DER UEBER ALLEM STEHT ════════════════════════════════════════
 *
 * Es ist das FAMILIENKONTO. Eine Sperrung naehme nicht das Archiv, sondern das
 * Abspielen ueberhaupt — fuer alle, jeden Abend. Das gilt auch dann, wenn der
 * Zweck nur "Puffer" heisst. Deshalb ist dieses Plugin an jeder Stelle so
 * gebaut, dass NICHTS der Normalfall ist:
 *
 *   1. Standardmaessig aus. Im Auslieferungszustand, nach jeder Neuinstallation,
 *      und fuer jeden Dienst, der spaeter dazukommt (`erlaubt()` kennt nur eine
 *      Erlaubnisliste, keine Sperrliste — was nicht drinsteht, ist aus).
 *   2. Je Dienst einzeln. Einen Schalter fuer alle gibt es nicht.
 *   3. Als Testzweck beschriftet, dort wo der Schalter sitzt — in plugin.json,
 *      nicht in einer Hilfeseite.
 *   4. Zwei Haken statt einem: der Dienst UND die bestaetigte Rechtslage.
 *   5. Sichtbar, waehrend er laeuft (`befinden`), und jederzeit abschaltbar.
 *
 * ══ WIE ABGEGRIFFEN WIRD — UND WARUM NICHT ANDERS ══════════════════════════
 *
 * NICHT ueber den Monitor der Senke. Der hoert ALLES, auch die Piper-Ansagen
 * ("Noch fuenf Minuten"). Ein Archiv, in dem mitten im Lied eine Stimme das
 * Ende der Hoerzeit ankuendigt, ist kein Archiv.
 *
 * Stattdessen am Knoten `alsa_playback.librespot` selbst. Am Geraet gemessen
 * (16.08.2026, tools/box/mitschnitt-machbar.py): ein Fremdton, der sich wie
 * eine Ansage verhaelt, steckt im Monitor-Mitschnitt mit dem 2178-fachen der
 * Kontrollfrequenz — im Quell-Mitschnitt mit dem 2,8-fachen, also gar nicht.
 *
 * DREI DINGE, DIE DABEI NICHT FUNKTIONIEREN und die man sonst zuerst probiert:
 *
 *   `pw-record --target <id>`   nimmt die Nummer an und verlinkt trotzdem auf
 *                               den Monitor der Standard-Senke. Ohne Fehler.
 *   `PIPEWIRE_NODE=<id>`        dasselbe.
 *   zwei Aufnahmen ohne Namen   heissen beide `pw-record:input_FL`; danach
 *                               haengt womoeglich beides an derselben Quelle.
 *
 * Es geht nur mit ausdruecklichem `pw-link`, nachdem die selbstgewaehlte
 * Verbindung geloest wurde — und mit eigenem `node.name`.
 *
 * ══ FLAC OHNE FFMPEG ═══════════════════════════════════════════════════════
 *
 * Auf der Box gibt es weder ffmpeg noch flac noch oggenc. Es braucht sie auch
 * nicht: `pw-record` schreibt ueber libsndfile echtes FLAC, wenn die Datei so
 * heisst. Signatur `fLaC` geprueft, Rechenlast nicht messbar.
 *
 * ZUR DATENRATE, mit der noetigen Ehrlichkeit: ein kurzer Probeausschnitt ergab
 * Faktor 7,8 (147 kB statt 1147 kB) — der hatte viel Leerlauf. Ein echter
 * Mitschnitt am Geraet (Hoerspiel, 34 s, 3034 kB) liegt bei Faktor 2,2, also
 * rund 320 MB/h. Wer Platz rechnet, rechnet mit dieser Zahl, nicht mit der
 * ersten.
 */

import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { get, request as anfrage } from 'node:http'
import { get as getSicher } from 'node:https'
import { join } from 'node:path'

import { mitListe } from './ablage.mjs'
import {
  aufnahmeArgumente,
  befehlZumZeigen,
  knotenFuerPid,
  laufDeuten,
  metadatenArgumente,
  mitschnittArgumente,
  veredelungsArgumente,
} from './arbeiter.mjs'
import { nachtmodusGilt, wasJetzt } from './auftrag.mjs'
import {
  abgleichen,
  abschliessen,
  beginnen,
  einordnen,
  istTitelUri,
  naechster,
  scheitern,
  stand,
  vormerken,
  zuruecklegen,
  zuruecksetzen,
} from './liste.mjs'

/** Welche Dienste ueberhaupt einen Schalter haben. Eine ERLAUBNISLISTE. */
export const DIENSTE = ['spotify']

/**
 * Die Umgebung, mit der PipeWire-Programme laufen muessen.
 *
 * OHNE DAS HIER GEHT GAR NICHTS, und der Fehler sieht nach einem Tonproblem
 * aus, obwohl es eines der Umgebung ist:
 *
 *     pw_context_connect() failed: Host is down
 *
 * PipeWire haelt seinen Socket unter `/run/user/<uid>/pipewire-0` und findet
 * ihn ueber `XDG_RUNTIME_DIR`. Eine ANMELDUNG setzt die Variable — ein
 * systemd-Dienst erbt sie nicht. `mupibox-server.service` laeuft zwar als
 * `dietpi`, hat aber ein leeres `Environment=`. Von Hand ueber ssh probiert
 * klappt deshalb alles, aus dem Server heraus nichts.
 *
 * Am Geraet gemessen (tools/box/pipewire-erreichbar.py, 16.08.2026):
 * ohne die Variable 0 Bytes, mit ihr 573484 Bytes.
 *
 * ABGELEITET STATT EINGETRAGEN: `/run/user/1000` waere heute richtig und
 * beim naechsten Benutzer falsch.
 */
function pwUmgebung() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
  return { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}` }
}

/** Wo der Spieler seinen Zustand meldet. */
const SPIELER = { host: '127.0.0.1', port: 5005, pfad: '/state' }

/**
 * Die Aufnahme laeuft ROH und wird erst beim Schneiden zu FLAC.
 *
 * WARUM NICHT GLEICH FLAC: weil dann niemand mehr sagen kann, WO in der Datei
 * eine Stelle liegt. FLAC packt jede Sekunde verschieden dicht; aus der
 * Dateigroesse folgt keine Zeit. Bei rohem s16/48000/stereo folgt sie exakt:
 * jede Sekunde sind es genau 192000 Byte.
 *
 * Und daran haengt die ganze Stueckelung. Die Uhr taugt dafuer nicht — zwischen
 * "librespot meldet neuen Titel" und "der Ton steht in der Datei" liegen
 * Puffer, deren Groesse niemand kennt. Die GESCHRIEBENEN BYTES dagegen sind
 * genau die Audiozeit, die in der Datei steht: latenz- und driftfrei. Das ist
 * die Idee, die im SpotifyRecorder auf dem Arbeitsrechner steckt
 * (spotcap_core.py:1367 `_now_off`), und sie ist der Grund, warum die Schnitte
 * dort sitzen.
 *
 * Der Preis sind rund 660 MB je Stunde waehrend der Aufnahme. Die Karte hat
 * 221 GB frei; die Rohdatei wird nach dem letzten Schnitt geloescht.
 */
const ROH = { rate: 48000, kanaele: 2, bytesJeProbe: 2 }
const BYTES_JE_SEK = ROH.rate * ROH.kanaele * ROH.bytesJeProbe
/** Ein WAV-Kopf steht vor den Daten und zaehlt nicht als Ton. */
const WAV_KOPF = 44
/** Wie oft nachgesehen wird, ob ein anderer Titel laeuft. */
const TAKT_MS = 1000
/** Kuerzer ist kein Titel, sondern ein Durchklicken. Wird nicht abgelegt. */
const MIN_TITEL_SEK = 20

/**
 * WO DIE ROHDATEI LIEGT — und warum das die Frage nach dem NAS entschaerft.
 *
 * Die Rohdatei ist reines Durchgangsmaterial: sie entsteht waehrend der
 * Aufnahme, wird stueckweise ausgeschnitten und danach geloescht. Trotzdem ist
 * sie der GROESSTE Posten auf der Karte — 660 MB/h gegenueber 320 MB/h fuer
 * die fertigen Stuecke.
 *
 * Der Betreiber hat ein NAS vorgeschlagen, und der Grund dafuer ist der
 * Verschleiss der SD-Karte, nicht ihre Kapazitaet (221 GB frei). Genau diesen
 * Verschleiss trifft man hier am billigsten: `/dev/shm` liegt im
 * ARBEITSSPEICHER. Was dort geschrieben wird, beruehrt die Karte nie.
 *
 * Gemessen (tools/box/schreiblast-messen.py, 16.08.2026): 1,0 GB frei in
 * /dev/shm, das traegt 91 Minuten am Stueck. Ohne diesen Weg kostet ein
 * Mitschnitt 980 MB/h, mit ihm 320 — ZWEI DRITTEL WENIGER.
 *
 * DIE NOTBREMSE IST HIER KEINE ZIERDE. Der Speicher ist mit 2 GB knapp, und
 * ein volles /dev/shm trifft nicht nur den Mitschnitt, sondern die ganze Box.
 * Deshalb wird vor dem Start geprueft und waehrenddessen gewacht.
 */
const SPEICHER_ORT = '/dev/shm'
/** Darunter wird nicht im Speicher aufgenommen — dann lieber auf die Karte. */
const SPEICHER_MIN_MB = 400
/** Faellt der freie Speicher darunter, wird der Mitschnitt beendet. */
const SPEICHER_NOT_MB = 120

/**
 * Wie weit ist die Aufnahme — aus der Dateigroesse, nicht aus der Uhr.
 *
 * PUR und deshalb pruefbar. Siehe den Block ueber ROH: hieran haengt, ob die
 * Schnitte sitzen.
 */
export function versatzAusGroesse(bytes) {
  const netto = Math.max(0, Number(bytes ?? 0) - WAV_KOPF)
  return netto / BYTES_JE_SEK
}

/**
 * Ist das ein ANDERER Titel als der bisherige?
 *
 * Nicht "hat sich irgendetwas geaendert": Pause, Fortsetzen und Spulen liefern
 * denselben Titel mit anderer Position, und jedes davon duerfte keinen Schnitt
 * ausloesen. Verglichen wird die Kennung, sonst nichts.
 */
export function istNeuerTitel(bisher, jetzt) {
  const a = bisher?.uri ?? bisher?.id ?? null
  const b = jetzt?.uri ?? jetzt?.id ?? null
  if (!b) return false
  return a !== b
}

/**
 * Wo faengt der neue Titel in der Aufnahme an?
 *
 * `versatz` ist der Stand der Aufnahme in dem Augenblick, in dem der Wechsel
 * AUFFAELLT — und das ist bis zu einen Takt zu spaet. Der Spieler sagt aber,
 * wie weit der neue Titel schon laeuft (`progress_ms`); genau so weit liegt
 * der Schnitt zurueck. Ohne diese Korrektur truege jeder Titel den Schluss des
 * vorigen am Anfang.
 */
export function schnittstelle(versatzSek, fortschrittMs) {
  const zurueck = Math.max(0, Number(fortschrittMs ?? 0)) / 1000
  return Math.max(0, versatzSek - zurueck)
}

/**
 * Wie vollstaendig ist das Stueck? — die Antwort auf E28/N4.
 *
 * „Ein halber Titel im Archiv ist schlimmer als keiner: er sieht vollstaendig
 * aus." Auf DIESER Box ist das kein Sonderfall: das WLAN reisst derzeit alle
 * paar Minuten ab. Dann bricht Spotify mitten im Lied weg — und weil der
 * Spieler danach gar nichts mehr meldet, sieht der Takt KEINEN Titelwechsel.
 * Die Aufnahme laeuft weiter und schreibt Stille hinter die halbe Musik.
 *
 * Der Spieler sagt aber, wie lang der Titel sein SOLL (`duration_ms`). Das
 * Verhaeltnis von aufgenommener zu erwarteter Laenge entlarvt den Abbruch,
 * ohne dass man den Ton ansehen muesste.
 *
 * `null` heisst „nicht zu beurteilen" — ohne Solldauer wird nichts behauptet.
 */
export function vollstaendigkeit(dauerSek, sollMs) {
  const soll = Number(sollMs ?? 0) / 1000
  if (!(soll > 0)) return null
  return dauerSek / soll
}

/**
 * Der Namenszusatz fuer ein Stueck, das nicht ganz ist.
 *
 * ES WIRD NICHT WEGGEWORFEN. Zum Puffern ist ein Titel zu neunzig Prozent
 * mehr wert als gar keiner — er darf nur nicht so tun, als waere er ganz.
 * Deshalb steht es im DATEINAMEN und nicht bloss in einem Tag: den Namen
 * sieht auch, wer nur den Ordner oeffnet.
 */
export function unvollstaendigZusatz(anteil) {
  if (anteil === null || anteil >= 0.97) return ''
  return ` (unvollstaendig ${Math.max(1, Math.round(anteil * 100))}%)`
}

/**
 * RMS-Pegel (0..1) je Zeitfenster aus rohem s16-PCM.
 *
 * Grundlage der Knackser-Erkennung darunter. PUR: Puffer rein, Zahlen raus.
 */
export function pegelFenster(puffer, kanaele = 2, fensterMs = 10, rate = ROH.rate) {
  const bytes = puffer?.length ?? 0
  const proben = Math.floor(bytes / 2)
  if (proben < 1) return []
  const jeFenster = Math.max(1, Math.round((rate * fensterMs) / 1000)) * Math.max(1, kanaele)
  const aus = []
  for (let i = 0; i + jeFenster <= proben; i += jeFenster) {
    let summe = 0
    for (let k = 0; k < jeFenster; k++) {
      const v = puffer.readInt16LE((i + k) * 2)
      summe += v * v
    }
    aus.push(Math.sqrt(summe / jeFenster) / 32768)
  }
  return aus
}

/**
 * Den Knackser am Anfang finden — uebernommen aus dem SpotifyRecorder.
 *
 * WAS ER ERKENNT: am Segmentanfang ein kurzer Stoerimpuls (der Einsatz des
 * Abspielwegs), dann Stille, dann erst Musik. Geliefert wird die Stelle, ab
 * der geschnitten werden soll, in Sekunden — 0 heisst "kein Knackser".
 *
 * WARUM ES SO UMSTAENDLICH IST: die naheliegende Regel „schneide, bis es laut
 * wird" wuerde jedem Lied den Anfang abschneiden, das leise beginnt. Deshalb
 * muss das ganze MUSTER stimmen: der Impuls kommt frueh (< 200 ms), er ist
 * kurz (< 250 ms), und dahinter liegt durchgehende Stille (>= 150 ms). Fehlt
 * eines davon, ist es Musik und bleibt unangetastet.
 *
 * Uebersetzt aus `leading_click_cut`, spotcap_core.py:214 — samt der Schwellen,
 * die dort an echtem Material eingestellt wurden. Die Tests daneben sind
 * dieselben wie in tests/declick_test.py; sie sind die Gegenprobe der
 * Uebersetzung.
 */
export function knacksSchnitt(pegel, einstellungen = {}) {
  const {
    fensterMs = 10,
    maxKnacksMs = 250,
    minLueckeMs = 150,
    maxSchnittMs = 800,
    vorlaufMs = 20,
    boden = 0.004,
  } = einstellungen
  const n = pegel?.length ?? 0
  if (!n) return 0

  const schwelle = Math.max(boden, 0.05 * Math.max(...pegel))
  const erst = pegel.findIndex((v) => v > schwelle)
  // Ein Impuls, der spaet kommt, ist keiner — das ist schon die Musik.
  if (erst < 0 || erst * fensterMs > 200) return 0

  const lueckeN = Math.max(1, Math.floor(minLueckeMs / fensterMs))
  let b = null
  for (let i = erst + 1; i <= n - lueckeN; i++) {
    let still = true
    for (let k = 0; k < lueckeN; k++) {
      if (pegel[i + k] > schwelle) {
        still = false
        break
      }
    }
    if (still) {
      b = i
      break
    }
  }
  // Kein kurzer Impuls mit Stille dahinter -> es war Musik.
  if (b === null || (b - erst) * fensterMs > maxKnacksMs) return 0

  let c = -1
  for (let i = b + lueckeN; i < n; i++) {
    if (pegel[i] > schwelle) {
      c = i
      break
    }
  }
  if (c < 0) return 0 // danach kommt nichts mehr

  const schnittMs = c * fensterMs - vorlaufMs
  if (schnittMs <= 0 || schnittMs > maxSchnittMs) return 0
  return schnittMs / 1000
}

/**
 * Taugt die Aufnahme etwas? — nach `rate_recording`, spotcap_core.py:130.
 *
 * WOZU: eine stille Aufnahme sieht auf jedem `ls` aus wie eine gelungene. Wer
 * das nicht prueft, hat irgendwann ein Album aus Stille im Archiv und merkt es
 * erst beim Hoeren.
 */
export function urteil(spitze, mittel, dauerSek) {
  if (dauerSek < MIN_TITEL_SEK) return { ok: false, wort: 'zu kurz' }
  // Unter -50 dB ist nichts mehr, was jemand hoeren wollte.
  if (mittel <= -50 || spitze <= -40) return { ok: false, wort: 'still' }
  if (spitze >= -0.1) return { ok: true, wort: 'uebersteuert' }
  if (mittel < -35) return { ok: true, wort: 'leise' }
  return { ok: true, wort: 'ok' }
}

/**
 * Derselbe Richter unter einem zweiten Namen — fuer `einenAufnehmen`.
 *
 * Dort steht ein `const urteil = laufDeuten(...)` und verschattet die Funktion
 * oben. Ein Aufruf `urteil(...)` liefe in „urteil is not a function", und weil
 * der Aufnahmeblock in einem try steht, waere daraus ein stiller
 * `fertig: false` geworden — ein Fehler, der wie ein Ergebnis aussieht. Genau
 * die Sorte, die diesen ganzen Befund ausgemacht hat.
 *
 * Die lokale Variable umzubenennen waere der sauberere Schnitt; sie wird in
 * dieser Funktion aber an mehreren Stellen gelesen, und ein zweiter Name fuer
 * dieselbe reine Funktion kostet nichts.
 */
const pegelUrteil = urteil

/**
 * Darf diese Datei in die Mediathek? — die EINE Stelle, die das entscheidet.
 *
 * ══ WARUM ES DIESE FUNKTION GIBT (Befund 23.08.2026) ══════════════════════
 * Der Arbeiterweg hatte als einzige Inhaltspruefung `gross < 10 000 B`. Eine
 * digital stille FLAC wiegt aber 177 B/s — an allen vier Fundstuecken vom
 * 22.08.2026 derselbe Wert (30902/175, 10850/61, 15695/89, 31640/179). Die
 * Grenze faellt damit bei 56,5 SEKUNDEN: alles ab ~57 s Stille rutscht durch.
 * Die kleinste der vier lag 8 % darueber und galt als fertig.
 *
 * EINE GROESSENPRUEFUNG MISST DIE KOMPRIMIERBARKEIT, NICHT DEN TON. Den Ton
 * misst `urteil` — die gab es laengst, aber nur im passiven Weg.
 *
 * ══ WARUM SIE REIN IST ════════════════════════════════════════════════════
 * Gegengeprobt: die Pegelpruefung aus dem eingebetteten Aufnahmeblock
 * entfernt — alle 200 Tests blieben GRUEN. Was in einer Funktion steht, die
 * Prozesse startet, kann kein Zeuge erreichen. Hier steht nur noch die
 * Entscheidung; das Messen bleibt draussen.
 *
 * ES IST DIE KACHEL, DIE ZAEHLT: eine fehlende ist besser als eine, die nicht
 * spielt. Ein Kind, das auf ein Bild drueckt und nichts hoert, kann nicht
 * wissen, ob es falsch gedrueckt hat.
 */
/**
 * Taugt ein SCHON ABGELEGTER Mitschnitt noch etwas? — die Nachschau.
 *
 * ══ WOZU, UND WARUM NICHT `annahmeUrteil` ═════════════════════════════════
 * `annahmeUrteil` entscheidet BEIM AUFNEHMEN. Diese hier sieht sich an, was
 * schon in der Mediathek liegt — und muss deshalb einen Fall erkennen, den
 * die Annahme gar nicht sehen kann: eine Datei, die ANFAENGT wie eine gute
 * und mittendrin in Stille faellt.
 *
 * Genau die entstanden waehrend der Entwicklungszeit, als der Abgriff am
 * LAUTSPRECHER hing statt am eigenen Strom (siehe `mitschnittArgumente`).
 * Solange die Familie hoerte, kam Ton; als sie aufhoerte, kam nichts mehr.
 * Im MITTEL sind solche Dateien voellig unauffaellig — 01 So viele Feelings
 * misst -17,5 dB und ist trotzdem zu 44 % Null.
 *
 * ══ DIE SIGNATUR, AN DER MAN SIE ERKENNT ══════════════════════════════════
 * `stilleAb` ist die Sekunde, ab der ffmpeg Stille meldet (silence_start).
 *
 *   stilleAb === null   keine Stille gefunden ......................... gut
 *   stilleAb === 0      VORLAUFSTILLE, dann Ton — der NORMALE Anfang ... gut
 *   stilleAb > 0        Stille ab der Mitte bis zum Ende ......... VERDAECHTIG
 *
 * DASS `stilleAb === 0` GUT IST, ist die wichtigste Zeile hier. Jede gesunde
 * Aufnahme der Nachtcharge vom 21.08.2026 beginnt so; wer das fuer einen
 * Fehler haelt, wirft 31 einwandfreie Dateien weg.
 *
 * Der Anteil muss ins Gewicht fallen: die letzten Sekunden eines Hoerspiels
 * sind oft leise, und ein Ausklang ist kein Defekt. 15 % ist die Grenze —
 * gemessen liegen die zwei Fundstuecke bei 26 % und 44 %, ein normaler
 * Ausklang deutlich darunter.
 */
export function mitschnittBefund({ mittel, spitze, dauerSek, stilleAb }) {
  if (!Number.isFinite(dauerSek) || dauerSek <= 0) return { gut: false, wort: 'unlesbar', anteil: 0 }
  // Digitale Null ueber alles — der eindeutigste Fall.
  if (Number.isFinite(mittel) && mittel <= -80) return { gut: false, wort: 'ganz still', anteil: 1 }
  const u = pegelUrteil(spitze, mittel, dauerSek)
  if (!u.ok) return { gut: false, wort: u.wort, anteil: 1 }
  if (!Number.isFinite(stilleAb) || stilleAb <= 0) return { gut: true, wort: 'ok', anteil: 0 }
  const anteil = (dauerSek - stilleAb) / dauerSek
  if (anteil >= 0.15) return { gut: false, wort: 'bricht in Stille ab', anteil }
  return { gut: true, wort: 'ok', anteil }
}

export function annahmeUrteil({ gross, spitze, mittel, dauerSek }) {
  if (!Number.isFinite(gross) || gross < LEER_UNTER_BYTES) {
    return { ok: false, grund: `nichts aufgenommen (${gross} B)` }
  }
  const u = pegelUrteil(spitze, mittel, dauerSek)
  if (!u.ok) return { ok: false, grund: `Aufnahme ${u.wort} (Mittel ${mittel} dB)`, wort: u.wort }
  return { ok: true, grund: '', wort: u.wort }
}

/**
 * Darf jetzt mitgeschnitten werden? — die einzige Stelle, die das entscheidet.
 *
 * PUR, damit sie sich pruefen laesst, ohne dass ein Ton faellt. Jede Antwort
 * traegt ihren Grund; er landet im Journal und im `befinden`, damit niemand
 * raten muss, warum nichts passiert.
 */
export function erlaubt(einstellungen, dienst) {
  const e = einstellungen ?? {}
  if (!DIENSTE.includes(dienst)) {
    return { ja: false, grund: `fuer ${dienst || 'diese Quelle'} gibt es keinen Mitschnitt` }
  }
  // ZUERST die Rechtslage, DANN der Dienst. Nicht umgekehrt: wer den
  // Dienstschalter umlegt, ohne bestaetigt zu haben, soll genau das lesen.
  if (e.verstanden !== true) {
    return { ja: false, grund: 'die Rechtslage ist nicht bestaetigt' }
  }
  if (e[dienst] !== true) {
    return { ja: false, grund: `${dienst} ist nicht eingeschaltet` }
  }
  return { ja: true, grund: `${dienst} ist eingeschaltet und bestaetigt` }
}

/** Verbotene Zeichen raus, Laenge begrenzt — sonst zerlegt ein Titel den Pfad. */
export function saeubern(text) {
  return (
    String(text ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Unbekannt'
  )
}

/**
 * Der Dateiname eines Mitschnitts.
 *
 * Der Zeitstempel steht VORNE und nicht hinten: so liegt ein Ordner von selbst
 * in der Reihenfolge, in der gehoert wurde, und zwei Mitschnitte desselben
 * Titels ueberschreiben einander nicht.
 */
export function dateiname(titel, kuenstler, stempel) {
  const wer = saeubern(kuenstler || 'Unbekannt')
  const was = saeubern(titel || 'Unbenannt')
  return `${stempel} ${wer} - ${was}.flac`
}

/**
 * Wo der Abspieldienst lokale Alben sucht.
 *
 * Er baut daraus `<basis>/<kategorie>/<kuenstler>/<album>/playlist.m3u` —
 * siehe spotify-control.ts:1476 und media-provider.ts (`musicsearch/library/
 * album/<kategorie>:<kuenstler>:<album>`). Die drei Ebenen sind also keine
 * Ordnung nach Geschmack, sondern der Vertrag mit dem Abspieldienst.
 */
export const MEDIEN_BASIS = '/home/dietpi/MuPiBox/media'

/** Der Albumordner eines Mitschnitts. PUR — nur Zeichenketten. */
export function albumOrdner(kategorie, kuenstler, album, basis = MEDIEN_BASIS) {
  return join(basis, saeubern(kategorie || 'music'), saeubern(kuenstler || 'Unbekannt'), saeubern(album || 'Ohne Album'))
}

/**
 * Der Name einer einzelnen Spur IM ALBUM — mit der Tracknummer vorn.
 *
 * HIER STEHT KEIN ZEITSTEMPEL, und das ist der ganze Unterschied zum
 * Archivnamen darueber: dort soll jede Aufnahme erhalten bleiben, hier soll
 * ein ALBUM ENTSTEHEN. Zwei Mitschnitte desselben Titels sind dasselbe Stueck
 * und gehoeren auf denselben Namen — sonst haette das Album nach dem zweiten
 * Hoeren jeden Titel doppelt.
 *
 * Die Nummer wird zweistellig aufgefuellt, damit die Datei- und die
 * Titelreihenfolge dieselbe sind: `10` sortiert sonst vor `2`.
 */
export function spurname(nummer, titel) {
  const n = Number(nummer)
  const vorn = Number.isFinite(n) && n > 0 ? `${String(Math.round(n)).padStart(2, '0')} ` : ''
  return `${vorn}${saeubern(titel || 'Unbenannt')}.flac`
}

/**
 * Unter welchen Pfaden koennte die Spur eines Listeneintrags liegen? PUR.
 *
 * Die Kategorie ist beim Vormerken NICHT bekannt — sie wird erst beim Ablegen
 * beim Original erfragt (`kategorieDesOriginals`). Deshalb bekommt diese
 * Funktion ALLE Kategorien, die es im Medienordner gibt, und gibt je eine
 * Moeglichkeit zurueck. Eine davon zu finden reicht.
 *
 * OHNE TITEL UND OHNE INTERPRET GIBT ES KEINEN PFAD — absichtlich. `albumOrdner`
 * und `spurname` haben Ersatzwerte („Unbekannt", „Unbenannt"), und die wuerden
 * hier zu einem TREFFER auf einer fremden Datei fuehren.
 *
 * DIE RICHTUNG DES ZWEIFELS: Ein Eintrag, der faelschlich als „liegt vor" gilt,
 * wird NIE aufgenommen — der Titel ist still verloren. Ein Eintrag, der
 * faelschlich als offen gilt, kostet eine ueberfluessige Aufnahme. Im Zweifel
 * also lieber offen lassen.
 */
export function spurpfade(eintrag, basis, kategorien) {
  // GETRIMMT GEPRUEFT, nicht bloss auf Wahrheitswert: „   " ist wahr, und
  // `spurname` haette daraus „Unbenannt.flac" gemacht — genau der Treffer auf
  // eine fremde Datei, den dieser Absatz ausschliessen soll.
  const wort = (x) => (typeof x === 'string' ? x.trim() : '')
  const titel = wort(eintrag?.titel)
  const kuenstler = wort(eintrag?.albumInterpret) || wort(eintrag?.interpret)
  if (!titel || !kuenstler) return []
  const datei = spurname(eintrag.nummer, titel)
  const wo = Array.isArray(kategorien) ? kategorien.filter((k) => typeof k === 'string' && k) : []
  return wo.map((k) => join(albumOrdner(k, kuenstler, eintrag.album, basis), datei))
}

/**
 * Welche Aufnahme bleibt, wenn dieselbe Spur ein zweites Mal entsteht?
 *
 * PUR, damit die Regel nachlesbar ist statt im Ablauf versteckt. Sie folgt
 * `keep_existing` aus dem SpotifyRecorder, mit dem Unterschied, dass hier die
 * Vollstaendigkeit schon gemessen vorliegt:
 *
 *   1. VOLLSTAENDIG SCHLAEGT UNVOLLSTAENDIG. Immer, egal wie lang.
 *   2. Sind beide gleich vollstaendig, gewinnt die LAENGERE — sie hat mehr
 *      vom Stueck erwischt.
 *   3. Bei Gleichstand bleibt die alte liegen. Neu ist kein Wert an sich, und
 *      jedes Ueberschreiben ist eine Schreiblast auf der Karte.
 */
export function neueBehalten(alt, neu) {
  if (!alt) return true
  const altGanz = (alt.anteil ?? 1) >= 0.97
  const neuGanz = (neu.anteil ?? 1) >= 0.97
  if (altGanz !== neuGanz) return neuGanz
  return (neu.dauer ?? 0) > (alt.dauer ?? 0) + 1
}

/**
 * Der Inhalt der `playlist.m3u` aus den vorhandenen Spuren.
 *
 * PUR: Dateinamen rein, Text raus. Sortiert wird nach dem Namen, und weil die
 * Tracknummer vorn steht und aufgefuellt ist, ist das zugleich die
 * Albumreihenfolge.
 *
 * ABSOLUTE PFADE, keine relativen: der Abspieldienst liest die Liste aus einem
 * anderen Arbeitsverzeichnis heraus und loest relative Angaben sonst falsch
 * auf. Und `#EXTM3U` steht davor, weil eine Liste ohne Kopf zwar meist geht,
 * aber nicht ueberall.
 */
export function m3uInhalt(ordner, dateien) {
  const spuren = [...(dateien ?? [])].filter((n) => n && n.toLowerCase().endsWith('.flac')).sort()
  return `#EXTM3U\n${spuren.map((n) => join(ordner, n)).join('\n')}\n`
}

/**
 * Wie der Knoten der spielenden Tonmaschine heisst — je nach Maschine anders.
 *
 * DAS WAR EIN ECHTER FEHLER, am 21.08.2026 am Geraet gefunden: hier stand fest
 * `librespot`. Diese Box spielt aber mit SOLOIST, und dessen Knoten heisst
 * schlicht `spotify`. Der Abgriff meldete deshalb bei jedem Versuch
 *
 *     Mitschnitt abgebrochen: der librespot-Knoten kam nicht (spielt gerade nichts?)
 *
 * — und die Klammer sagte sogar das Falsche: es spielte sehr wohl etwas.
 *
 * WARUM BEIDE NAMEN NEBENEINANDER STEHEN DUERFEN: Es laeuft immer nur EINE
 * Maschine. `soloist.service` traegt eine ExecCondition auf
 * `spotify.engine == "soloist"`, librespot die umgekehrte — beide zugleich
 * gibt es nicht. Also kann hoechstens einer der Namen passen, und die Suche
 * braucht nicht zu wissen, welche Maschine gerade dran ist.
 *
 * DER LEERLAUF-ARBEITER GEHT TROTZDEM ANDERS VOR (ueber die Prozesskennung,
 * siehe `knotenFuerPid`): SEINE Soloist-Instanz hiesse ebenfalls `spotify`,
 * und zwei gleichnamige Knoten sind ueber den Namen nicht zu trennen. Hier
 * genuegt der Name, weil der passive Abgriff und der Arbeiter sich gegenseitig
 * ausschliessen (`leerlaufDurchgang` steigt bei `lauf.prozess` sofort aus).
 */
export const MASCHINEN_KNOTEN = ['alsa_playback.librespot', 'librespot', 'spotify']

/**
 * Den abzugreifenden Knoten aus der Ausgabe von `pw-cli ls Node` heraussuchen.
 *
 * PUR — die Ausgabe kommt als Text herein. Damit ist die Zerlegung pruefbar,
 * ohne dass PipeWire laufen muss; und sie MUSS geprueft werden, weil sie an
 * einem Ausgabeformat haengt, das niemand versprochen hat.
 */
export function knotenSuchen(text, suchwort = MASCHINEN_KNOTEN) {
  const worte = (Array.isArray(suchwort) ? suchwort : [suchwort])
    .filter((w) => typeof w === 'string' && w)
    .map((w) => w.toLowerCase())
  const zeilen = String(text ?? '').split('\n')
  let id = null
  for (const zeile of zeilen) {
    const t = zeile.match(/^\s*id (\d+),/)
    if (t) id = Number(t[1])
    const n = zeile.match(/node\.name\s*=\s*"([^"]+)"/)
    if (n && id !== null && worte.some((w) => n[1].toLowerCase().includes(w))) {
      return { id, name: n[1] }
    }
  }
  return null
}

function laufen(befehl, argumente, fristMs = 8000) {
  return new Promise((fertig) => {
    execFile(befehl, argumente, { timeout: fristMs, env: pwUmgebung() }, (fehler, aus) =>
      fertig(fehler ? '' : String(aus)),
    )
  })
}

/** Der Zustand des Spielers. Eigenes http statt `kontext.holen`: das ist die
 *  eigene Box, und `holen` ist fuer Fremdadressen gedacht. */
function spielerZustand(fristMs = 3000) {
  return new Promise((fertig) => {
    const bitte = get({ ...SPIELER, path: SPIELER.pfad, timeout: fristMs }, (antwort) => {
      let roh = ''
      antwort.on('data', (stueck) => (roh += stueck))
      antwort.on('end', () => {
        try {
          fertig(JSON.parse(roh))
        } catch {
          fertig(null)
        }
      })
    })
    bitte.on('error', () => fertig(null))
    bitte.on('timeout', () => (bitte.destroy(), fertig(null)))
  })
}

/** Zeitstempel als `2026-08-16 20-45-03` — sortierbar und dateisystemtauglich. */
function stempelJetzt() {
  const d = new Date()
  const z = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`
}

const EIGENNAME = 'mixpi-mitschnitt'

/**
 * Darunter ist es kein Mitschnitt, sondern ein Dateikopf.
 *
 * Ein leeres libsndfile-FLAC wiegt rund 400 Byte und traegt trotzdem die
 * Signatur `fLaC`. Eine Sekunde echter Musik liegt bei etwa 24 kB, also ist
 * diese Grenze grosszuegig und trifft nur den Fall "gar nichts".
 */
const LEER_UNTER_BYTES = 10_000

/** Was gerade laeuft. Bewusst EIN Mitschnitt zur Zeit. */
const lauf = {
  prozess: null,
  /** Die durchgehende ROHDATEI. Aus ihr wird je Titel ein Stueck geschnitten. */
  datei: null,
  ordner: null,
  kategorie: 'music',
  seit: 0,
  quelle: null,
  /** Welcher Strom gerade aufnimmt (E126) — null, wenn keiner laeuft. */
  stromNr: null,
  notbremse: null,
  letzterFehler: null,
  /** Der Takt, der nachsieht, ob ein anderer Titel laeuft. */
  takt: null,
  /** Was gerade laeuft, und ab welcher Sekunde der Rohdatei. */
  titel: null,
  titelAbSek: 0,
  abgelegt: 0,
  /** Solange geschnitten wird, darf der Takt nicht dazwischenfunken. */
  beschaeftigt: false,
  /** Das zuletzt geholte Cover — je Album nur einmal aus dem Netz. */
  coverAdresse: null,
  coverDatei: null,
  /** Liegt die Rohdatei im Arbeitsspeicher? Dann muss darueber gewacht werden. */
  rohImSpeicher: false,
  /** Fuer welche Albumordner schon eine Kachel gemeldet wurde. */
  gemeldet: new Set(),
  /**
   * Die Schluessel der Kacheln, die DIESER Lauf als unvollstaendig markiert
   * hat (E89).
   *
   * WOZU: am Ende eines SAUBEREN Laufs wird die Marke wieder abgeraeumt.
   * Stirbt der Mitschnitt unterwegs, laeuft diese Zeile nie — und genau dann
   * soll die Marke stehenbleiben. Die Richtung ist Absicht; „am Ende setzen"
   * bliebe im Abbruchfall stumm, also in dem einen, auf den es ankommt.
   */
  markiert: new Set(),
}

/**
 * Wie `laufen`, aber es liefert AUCH die Fehlerausgabe.
 *
 * `ffmpeg` schreibt seine Messwerte (volumedetect) nach stderr und beendet
 * sich dabei voellig regulaer. Wer nur stdout liest, bekommt eine leere
 * Zeichenkette und haelt die Messung fuer gescheitert.
 */
function laufenMitFehler(befehl, argumente, fristMs = 30_000) {
  return new Promise((fertig) => {
    execFile(befehl, argumente, { timeout: fristMs, env: pwUmgebung(), maxBuffer: 8 << 20 }, (_f, aus, fehler) =>
      fertig(`${aus || ''}\n${fehler || ''}`),
    )
  })
}

/**
 * Etwas aus dem Netz holen — fuer Songtexte (LRCLIB) und Cover.
 *
 * DAFUER TRAEGT DAS PLUGIN DAS RECHT `netz` in plugin.json. Es geht an genau
 * zwei Stellen hinaus: an LRCLIB und an die Bildadresse, die der Spieler
 * ohnehin schon liefert. Beides ohne Anmeldung, beides ohne dass etwas ueber
 * den Mitschnitt nach draussen ginge.
 */
function httpsHolen(adresse, binaer = false, fristMs = 8000) {
  return new Promise((fertig, scheitern) => {
    const bitte = getSicher(adresse, { timeout: fristMs }, (antwort) => {
      if ((antwort.statusCode ?? 500) >= 400) {
        antwort.resume()
        fertig(null)
        return
      }
      const stuecke = []
      antwort.on('data', (s) => stuecke.push(s))
      antwort.on('end', () => fertig(binaer ? Buffer.concat(stuecke) : Buffer.concat(stuecke).toString('utf8')))
    })
    bitte.on('error', scheitern)
    bitte.on('timeout', () => (bitte.destroy(), fertig(null)))
  })
}

/**
 * Wie viel Platz ist dort frei? — in MB, -1 wenn nicht zu bestimmen.
 *
 * `statfs` gibt es in node:fs; es ist der direkte Weg und braucht kein
 * `df`-Kindprozess, der bei jedem Takt neu startet.
 */
async function freiMb(pfad) {
  try {
    const s = await statfs(pfad)
    return (Number(s.bavail) * Number(s.bsize)) / 1024 / 1024
  } catch {
    return -1
  }
}

/**
 * Wo die Rohdatei hin soll: in den Speicher, wenn er es traegt — sonst auf
 * die Karte, und dann wird das auch gesagt.
 */
export function rohOrtWaehlen(freiImSpeicherMb, ablage, mindestens = SPEICHER_MIN_MB) {
  if (freiImSpeicherMb >= mindestens) {
    return { ort: SPEICHER_ORT, imSpeicher: true, grund: `${Math.round(freiImSpeicherMb)} MB frei im Speicher` }
  }
  return {
    ort: ablage,
    imSpeicher: false,
    grund:
      freiImSpeicherMb < 0
        ? 'der Speicherort ist nicht lesbar'
        : `nur ${Math.round(freiImSpeicherMb)} MB frei im Speicher (noetig: ${mindestens})`,
  }
}

/**
 * Was aus dem Spielerzustand fuer einen Titel gebraucht wird — sonst nichts.
 *
 * ══ DER PLATZHALTER IST KEIN TITEL (20.08.2026) ═════════════════════════════
 *
 * Betreiber: „es legt jetzt was an man kann es aber nicht abspielen und es läd
 * auch kein cover." Am Geraet gefunden:
 *
 *     /home/dietpi/MuPiBox/media/audiobook/Unbekannt/Ohne Album/Unbenannt.flac
 *     129 Sekunden, 12 MB, KEIN title/artist/album — nur der Fingerabdruck.
 *
 * Die Ursache steht eine Zeile hoeher: `spotify-control.js` antwortet auf
 * /state auch dann mit einem `item`, wenn NICHTS laeuft oder eine andere
 * Maschine spielt — woertlich:
 *
 *     {"item":{"album":{"name":"","total_tracks":""},"name":"","track_number":""},
 *      "currently_playing_type":""}
 *
 * `item` IST DA, ein Stueck ist es nicht. `if (!s)` greift also nicht, und
 * aus dem leeren Rumpf wurde ein „Titel" ohne alles.
 *
 * DIE FOLGEN WAREN BEIDE GEMELDETEN SYMPTOME:
 *   * `kachelAnlegen` bricht bei leerem Album ab (unten, `if (!titel?.album`),
 *     also gab es KEIN POST /api/medien und vor allem kein `sichtbarMachen` —
 *     die Kachel entstand nur, weil `m3u_generator.sh` sie aus dem Ordner
 *     nachbaute, und faellt ohne Auswahl-Eintrag durch `auswahlFiltern`:
 *     sie ist da und laesst sich nicht spielen.
 *   * Ohne Album gibt es kein Cover, und der Ersatzweg des Generators greift
 *     ins Leere (siehe scripts/mupibox/m3u_generator.sh).
 *
 * GEPRUEFT WIRD DIE IDENTITAET, NICHT DER NAME: `uri ?? id` ist genau das,
 * woran `istNeuerTitel` einen Titel erkennt — ein zweites Vokabular dafuer
 * waere die naechste Stelle, die auseinanderlaeuft.
 */
export function titelAus(zustand) {
  const s = zustand?.item
  if (!s) return null
  if (!(s.uri ?? s.id)) return null
  return {
    uri: s.uri ?? s.id ?? null,
    name: s.name ?? '',
    kuenstler: (s.artists ?? []).map((a) => a?.name).filter(Boolean).join(', '),
    /* ══ DER ORDNER GEHOERT DEM ALBUM, NICHT DEM TITEL (20.08.2026) ═══════
     *
     * Betreiber: „warum man 2 mal das gleiche cover sieht mit
     * unterschiedlichen batches … beispiel team karacho, another nguyen."
     *
     * Am Geraet gefunden — DASSELBE Album in ZWEI Ordnern:
     *     audiobook/Team Karacho, Rola/Du schaffst das schon …
     *     audiobook/Team Karacho, ANOTHER NGUYEN/Du schaffst das schon …
     *
     * Weil `artists` die Interpreten DES TITELS sind, Gaeste eingeschlossen.
     * Zwei Titel eines Albums mit verschiedenen Gaesten ergaben zwei Alben,
     * und weil `saeubern` daraus zwei Ordnernamen macht, auch zwei Kacheln
     * mit demselben Cover.
     *
     * `album.artists` ist der Interpret der VEROEFFENTLICHUNG — bei Team
     * Karacho also „Team Karacho", einmal, fuer alle Titel. Der Titel-
     * Interpret bleibt daneben stehen: er gehoert in die TAGS der Datei,
     * dort ist der Gast richtig.
     */
    albumKuenstler: (s.album?.artists ?? []).map((a) => a?.name).filter(Boolean).join(', '),
    album: s.album?.name ?? '',
    /* ══ DIE KENNUNG DES ALBUMS, NICHT NUR SEIN NAME (20.09.2026) ═════════
     *
     * Der Ordner gehoert dem ALBUM (Begruendung eine Zeile hoeher) — also
     * gehoert auch die Quelle der Kachel dem Album und nicht dem Kontext, aus
     * dem gerade gespielt wird. `album.uri`/`album.id` steht in derselben
     * Antwort und kostet keinen Abruf. Was daran haengt, steht bei
     * `spotifyQuellSchluessel`. */
    albumUri: s.album?.uri ?? s.album?.id ?? null,
    nummer: s.track_number ?? null,
    bild: s.album?.images?.[0]?.url ?? null,
    dauerMs: s.duration_ms ?? null,
    fortschrittMs: zustand?.progress_ms ?? 0,
    /* ══ DIE SPOTIFY-QUELLE, GENAU (29.08.2026, Befund der Verwaltung) ═════
     *
     * `context.uri` nennt das Album/die Playlist/die Sendung, aus der GERADE
     * gespielt wird — dieselbe Angabe, die server.ts (spielstand.ts:
     * `kontextUri`/`kontextArt`, weiterhoeren.ts) fuer denselben Zweck liest:
     * „welcher Bibliothekseintrag ist das". Anders als `s.uri` (die TRACK-
     * Kennung, oben) ist das die Kennung des WERKS, und daraus laesst sich
     * der Bibliotheksschluessel OHNE Vergleich bilden (`spotifyQuellSchluessel`
     * unten) — exakt das, was `medienSchluessel()` (medien.ts) fuer einen
     * Spotify-Eintrag mit `id`/`playlistid`/`showid`/`audiobookid` ausrechnet.
     *
     * Fehlt der Kontext (Radio, Kuenstler-Autoplay, Wiedergabe ohne feste
     * Quelle) oder ist die Art keine, die die Bibliothek als EIGENE Kachel
     * fuehrt, bleibt es stehen wie es ist — dann wird an anderer Stelle nicht
     * geraten, sondern schlicht nichts festgeschrieben.
     */
    kontextUri: zustand?.context?.uri ?? null,
    kontextArt: zustand?.context?.type ?? null,
  }
}

/**
 * Warteschlangen-Metadaten durch die KANONISCHEN von Spotify ersetzen — PUR.
 *
 * ══ DIE ANFORDERUNG (Betreiber, 06.09.2026, woertlich) ════════════════════
 * „ich will die gleichen matadaten wie bei spotify ob der name abweicht ist
 * egal. aber de tag muss identisch sein."
 *
 * ══ WARUM DIE SCHLANGE NICHT REICHT (gemessen, Box .62) ═══════════════════
 * 8 von 26 library-Kacheln trugen gesaeuberte Namen („Folge 13_ …" statt
 * „Folge 13: …"). Der Weg dorthin: die Aufnahmeliste wird beim Durchsehen
 * des Bestands aus PFADEN geboren (liste.mjs — `<kategorie>/<interpret>/
 * <album>/<nn titel>.flac`), und `saeubern()` hat dem Pfad die Doppelpunkte
 * genommen. Wer aus so einem Listeneintrag neu aufnimmt, schreibt den
 * Pfad-Namen in die TAGS — die Datei erbt den Makel ihres Ordners.
 *
 * Live-Mitschnitte haben das Problem nicht (ihr `titel` kommt aus dem
 * Spotify-Zustand, `titelAus`) — deshalb ist der RUECKFALL die Schlange:
 * fehlt das Kanonische (kein Netz, kein Spotify-Titel), bleibt alles wie
 * bisher. Lieber ein gesaeuberter Tag als gar keiner.
 *
 * DER ORDNER WIRD DADURCH NICHT VERSCHOBEN: `albumOrdner` saeubert ohnehin,
 * und `saeubern` ist idempotent — `saeubern('Folge 13: X')` und
 * `saeubern('Folge 13_ X')` ergeben denselben Ordner. Nur die TAGS (und
 * damit Kachel-Titel kuenftiger Alben) werden wieder wahr.
 */
export function mitKanonischem(titel, kanon) {
  if (!titel || !kanon || typeof kanon !== 'object') return titel
  const wort = (x) => (typeof x === 'string' ? x.trim() : '')
  return {
    ...titel,
    name: wort(kanon.name) || titel.name,
    kuenstler: wort(kanon.kuenstler) || titel.kuenstler,
    album: wort(kanon.album) || titel.album,
    albumKuenstler: wort(kanon.albumKuenstler) || titel.albumKuenstler,
    nummer: Number.isFinite(kanon?.nummer) && kanon.nummer > 0 ? kanon.nummer : titel.nummer,
    // Das Bild NUR als Rueckfall (`||`), wie alles hier: hat der Titel schon
    // eines aus dem Spielerzustand, ist das dieselbe Adresse — und wenn nicht,
    // ist die aus dem Zustand die frischere.
    bild: titel.bild || wort(kanon.bild),
  }
}

/**
 * Die rohe Spotify-Track-Antwort auf die sechs Felder eindampfen, die die
 * Ablage braucht — PUR, und mit DENSELBEN Regeln wie `titelAus` beim
 * Live-Mitschnitt (Album-Interpret = `album.artists`, nicht die Gaeste des
 * Titels; Begruendung dort, „Team Karacho"-Fall).
 */
export function kanonischesAus(roh) {
  if (!roh || typeof roh !== 'object') return null
  const namen = (xs) =>
    Array.isArray(xs)
      ? xs
          .map((a) => a?.name)
          .filter(Boolean)
          .join(', ')
      : ''
  const wort = (x) => (typeof x === 'string' ? x.trim() : '')
  const k = {
    name: wort(roh.name),
    kuenstler: namen(roh.artists),
    album: wort(roh.album?.name),
    albumKuenstler: namen(roh.album?.artists),
    nummer: Number.isFinite(roh.track_number) && roh.track_number > 0 ? roh.track_number : null,
    /* DAS BILD IST DER SECHSTE WERT, UND ES KAM ZULETZT (E135/1c, 10.09.2026).
     *
     * Die Antwort trug `album.images` von Anfang an — dieselbe Liste, aus der
     * `titelAus` beim Live-Mitschnitt sein Cover nimmt. Hier wurde sie nicht
     * gelesen, weil die Umwandlung als „die fuenf Felder, die die ABLAGE
     * braucht" gedacht war: Pfad und Dateiname. Das Bild braucht die Ablage
     * nicht, es fehlt nur lautlos. Genau darum ist es dreimal in Folge
     * durchgerutscht — Vormerkung, Nachschnitt, und hier.
     *
     * `images[0]` ist die groesste Fassung (Spotify sortiert absteigend);
     * eingebettet wird sie ohnehin verkleinert.
     */
    bild: wort(roh.album?.images?.[0]?.url),
  }
  // Eine Antwort ohne Namen UND ohne Album traegt nichts bei — dann lieber
  // ehrlich null, und der Rueckfall (die Schlange) gilt.
  return k.name || k.album ? k : null
}

/**
 * Das Kanonische EINMAL je Titel bei der Box erfragen und gemerkt halten —
 * dieselbe Bauform wie `kategorieJeTitel`. Der Weg ist die BESTEHENDE,
 * bewachte Lese-Durchreiche (`/api/spotify/web/…`, `tracks/<id>` steht in
 * WEB_API_ERLAUBT) — kein neuer Endpunkt, keine Erlaubnis zu viel.
 * `schicken` injizierbar aus demselben Grund wie bei
 * `verschmelzungFestschreiben` (ESM loest eingebaute Importe beim Einlesen).
 */
async function kanonischesNachschlagen(titel, protokoll, schicken = serverSchicken) {
  const uri = String(titel?.uri ?? '')
  const m = /^spotify:track:([A-Za-z0-9]{22})$/.exec(uri)
  if (!m) return titel
  if (!lauf.kanonJeTitel) lauf.kanonJeTitel = new Map()
  if (!lauf.kanonJeTitel.has(uri)) {
    try {
      const a = await schicken(`/api/spotify/web/tracks/${m[1]}?market=DE`, 'GET')
      const kanon = a.status >= 200 && a.status < 300 ? kanonischesAus(a.inhalt) : null
      lauf.kanonJeTitel.set(uri, kanon)
      if (!kanon) protokoll(`kein Kanonisches fuer ${uri} (${a.status}) — Schlange gilt`)
    } catch (e) {
      lauf.kanonJeTitel.set(uri, null)
      protokoll(`Kanonisches nicht erreichbar fuer ${uri}: ${e} — Schlange gilt`)
    }
  }
  const kanon = lauf.kanonJeTitel.get(uri)
  return kanon ? mitKanonischem(titel, kanon) : titel
}

/**
 * Ein Stueck aus der Rohaufnahme herausschneiden und als FLAC ablegen.
 *
 * Die Rohaufnahme LAEUFT WEITER, waehrend das hier passiert — das ist der
 * Sinn des Modells: geschnitten wird aus einer Datei, in die gleichzeitig
 * weitergeschrieben wird. Ein Titel geht deshalb nie verloren, auch wenn das
 * Kodieren laenger dauert als der naechste Titel kurz ist.
 *
 * `-ss` steht VOR `-i`: das ist der schnelle Eingangs-Sprung, und bei rohem
 * WAV ist er zugleich exakt.
 */
async function abschnittAblegen(titel, abSek, bisSek, protokoll) {
  let dauer = bisSek - abSek
  if (!titel || dauer < MIN_TITEL_SEK) {
    if (titel) {
      protokoll(`uebersprungen (nur ${Math.round(dauer)} s): ${titel.name || 'ohne Titel'}`)
      // VERWORFEN HEISST NICHT MEHR VERGESSEN (E66/E73): der Titel kommt auf
      // die Liste und wird im Leerlauf vollstaendig nachgeschnitten.
      await vormerkenFuerSpaeter(titel, dauer, protokoll)
    }
    return false
  }

  // ── DER KNACKSER AM ANFANG ────────────────────────────────────────────────
  // Er entsteht, wenn der Abspielweg einsetzt, und sitzt genau da, wo der
  // Schnitt liegt. Gesucht wird ein MUSTER, nicht blosse Lautstaerke — sonst
  // verloere jedes leise beginnende Lied seinen Anfang.
  const knacks = await knacksVorne(abSek, protokoll)
  if (knacks > 0) {
    abSek += knacks
    dauer -= knacks
    protokoll(`Startknacks: ${Math.round(knacks * 1000)} ms weggeschnitten`)
  }

  // ── DIE STILLE AM ENDE ────────────────────────────────────────────────────
  // Erst sie muss weg, sonst rechnet die Vollstaendigkeit unten falsch: ein
  // abgebrochener Titel mit angehaengter Stille ist LAENGER als erwartet.
  const tonEnde = await tonEndeSuchen(abSek, abSek + dauer, protokoll)
  const stille = abSek + dauer - tonEnde
  if (stille > 2) {
    dauer = Math.max(0, tonEnde - abSek)
    protokoll(`${Math.round(stille)} s Stille am Ende abgeschnitten`)
  }
  if (dauer < MIN_TITEL_SEK) {
    protokoll(`uebersprungen (nach Abzug der Stille nur ${Math.round(dauer)} s): ${titel.name}`)
    await vormerkenFuerSpaeter(titel, dauer, protokoll)
    return false
  }

  // ── IST ES GANZ? (E28/N4, verschaerft am 20.08.2026) ──────────────────────
  //
  // WAS SICH GEAENDERT HAT: Bis heute wurde ein unvollstaendiges Stueck
  // ABGELEGT und bekam nur einen Vermerk im Dateinamen. Die Begruendung stand
  // hier: „zum Puffern ist ein Titel zu neunzig Prozent mehr wert als gar
  // keiner." Am Geraet sah das so aus (Journal vom 20.08., woertlich):
  //
  //     ACHTUNG unvollstaendig: "Chaos im Museum - Teil ..."
  //     KACHEL ANGELEGT: Hello Kitty Hörspiele — Folge ...
  //     fuer kalea sichtbar gemacht
  //
  // Der Mitschnitt ERKANNTE die Luecke — und legte trotzdem eine Kachel an,
  // die ein Kind antippen kann. Betreiber: „auch die waren die aufnahmen
  // unvollstandig und wurden angezeigt", und davor schon: „es ist doch
  // implementiert, dass nur gespeichert wird wenn vollstaendig aufgenommen,
  // sonst verworfen."
  //
  // EIN HALBES HOERSPIEL IST KEIN PUFFER, SONDERN EIN VERSPRECHEN, DAS BRICHT.
  // Ein Kind, das die Kachel antippt, hoert mitten im Satz Stille. Es meldet
  // das nicht als Fehler — es tippt die Kachel nie wieder an. Der Wert eines
  // Bruchstuecks ist damit nicht „besser als nichts", sondern negativ.
  //
  // DIE SCHWELLE IST DIESELBE WIE BISHER (97 %, siehe `unvollstaendigZusatz`)
  // und gilt JE TITEL — nicht je Album: ein Album, dessen letzter Titel fehlt,
  // behaelt seine vollstaendigen Stuecke.
  //
  // `anteil === null` HEISST „NICHT ZU BEURTEILEN" und wird nicht verworfen:
  // ohne Solldauer vom Spieler weiss niemand, ob das Stueck ganz ist. Ein
  // Verwurf auf Verdacht waere schlimmer als ein Stueck ohne Urteil.
  const anteil = vollstaendigkeit(dauer, titel.dauerMs)
  if (anteil !== null && unvollstaendigZusatz(anteil)) {
    protokoll(
      `VERWORFEN, weil unvollstaendig: "${titel.name}" — ${Math.round(dauer)} s von ` +
        `${Math.round((titel.dauerMs ?? 0) / 1000)} s (${Math.round(anteil * 100)} %)`,
    )
    // DIE WICHTIGSTE DER DREI STELLEN. Hier landet, wer wirklich zugehoert und
    // dann gewechselt hat — ueber 30 s, also mit VORRANG. Ein halbes Hoerspiel
    // ist kein Puffer (E28), ein vorgemerktes ganzes schon.
    await vormerkenFuerSpaeter(titel, dauer, protokoll)
    return false
  }
  // Ab hier ist das Stueck ganz — der Namenszusatz kann nur noch leer sein und
  // bleibt nur stehen, damit die Ablage unten unveraendert bleibt.
  const zusatz = ''

  // Die TAGS sollen die Spotify-Wahrheit tragen, nicht den Pfad-Namen der
  // Schlange (Begruendung bei `mitKanonischem`). VOR Ordner- und Tag-Bau,
  // damit auch Album-Interpret und Nummer die kanonischen sind.
  titel = await kanonischesNachschlagen(titel, protokoll)

  // ── DORTHIN, WO DER ABSPIELDIENST LOKALE ALBEN SUCHT ──────────────────────
  //
  // `<basis>/<kategorie>/<kuenstler>/<album>/` — das ist der Vertrag mit dem
  // Abspieldienst, nicht eine Ordnung nach Geschmack. Damit wird aus dem
  // Mitschnitt keine Halde neben der Box, sondern ein Album IN der Box: es
  // bekommt eine Kachel, und die Verschmelzung kann es gegen den Stream
  // stellen (E17). Genau das meint E28 mit "Puffer".
  // Der ALBUM-Interpret baut den Ordner (siehe titelAus) — der Titel-Interpret
  // steht in den Tags. Ohne Album-Angabe bleibt es beim bisherigen Verhalten.
  const ordnerKuenstler = titel.albumKuenstler || titel.kuenstler
  /* DIE KATEGORIE KOMMT VOM ORIGINAL, wenn die Box es kennt (siehe
   * `kategorieDesOriginals`) — sonst verschmelzen Original und Mitschnitt nie.
   * EINMAL JE TITEL gefragt und gemerkt: die Antwort aendert sich waehrend
   * eines Stuecks nicht, und der Schnitt laeuft im Takt. */
  let kategorie = lauf.kategorie
  if (titel.uri) {
    if (!lauf.kategorieJeTitel) lauf.kategorieJeTitel = new Map()
    if (!lauf.kategorieJeTitel.has(titel.uri)) {
      lauf.kategorieJeTitel.set(titel.uri, (await kategorieDesOriginals(titel)) || lauf.kategorie)
    }
    kategorie = lauf.kategorieJeTitel.get(titel.uri) || lauf.kategorie
  }
  const unterordner = albumOrdner(kategorie, ordnerKuenstler, titel.album, lauf.ordner)
  await mkdir(unterordner, { recursive: true })
  const ziel = join(unterordner, spurname(titel.nummer, titel.name))

  // GIBT ES DIE SPUR SCHON? Dann entscheidet eine Regel, nicht der Zufall des
  // Zeitpunkts — sonst ueberschriebe ein abgebrochener zweiter Mitschnitt die
  // vollstaendige erste Aufnahme.
  let vorhanden = null
  try {
    const st = await stat(ziel)
    vorhanden = { dauer: await dauerVon(ziel), anteil: await anteilVon(ziel), bytes: st.size }
  } catch {
    /* noch nicht da — der Normalfall */
  }
  if (vorhanden && !neueBehalten(vorhanden, { dauer, anteil: anteil ?? 1 })) {
    protokoll(`schon vorhanden und nicht schlechter: ${titel.name} — die neue Aufnahme wird verworfen`)
    return false
  }

  const bild = await coverHolen(titel, protokoll)

  const argumente = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', abSek.toFixed(3),
    '-t', dauer.toFixed(3),
    '-i', lauf.datei,
  ]
  if (bild) {
    // Das Bild ist ein zweiter Eingang und wird als angeheftetes Bild
    // markiert — sonst haelt es jeder Abspieler fuer eine Videospur.
    argumente.push('-i', bild, '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic')
  }
  argumente.push('-c:a', 'flac')
  // Die Tags gehoeren IN die Datei, nicht nur in den Namen: ein Dateiname
  // ueberlebt kein Umbenennen, und keine Musikverwaltung liest ihn.
  //
  // UEBER `metadatenArgumente`, SEIT DER NACHSCHNITT SIE AUCH SCHREIBT
  // (E135/1c, 10.09.2026): zwei Stellen mit derselben Schluesselliste laufen
  // auseinander, sobald jemand an einer davon etwas ergaenzt — und dann
  // tragen zwei Aufnahmen desselben Albums verschiedene Merkmale.
  argumente.push(
    ...metadatenArgumente({
      title: titel.name,
      artist: titel.kuenstler,
      album: titel.album,
      track: titel.nummer ? String(titel.nummer) : '',
      // Woher es stammt — dieselbe Spur, die auch der SpotifyRecorder legt,
      // damit sich eine Datei spaeter ihrem Titel zuordnen laesst.
      comment: titel.uri || '',
      // Auch als Tag, nicht nur im Namen: eine Musikverwaltung liest keine
      // Dateinamen, und beim Einsortieren geht der Zusatz sonst verloren.
      MIXPI_VOLLSTAENDIG: anteil === null ? '' : `${Math.round(anteil * 100)}%`,
    }),
  )
  argumente.push(ziel)

  await laufen('ffmpeg', argumente, 120_000)
  let gross = 0
  try {
    gross = (await stat(ziel)).size
  } catch {
    /* wenn ffmpeg nichts geschrieben hat, faellt es unten auf */
  }
  if (gross < LEER_UNTER_BYTES) {
    try {
      await rm(ziel)
    } catch {
      /* dann bleibt sie eben liegen */
    }
    protokoll(`nichts Brauchbares fuer "${titel.name}" (${gross} B) — nicht abgelegt`)
    return false
  }

  // ── TAUGT ES ETWAS? ───────────────────────────────────────────────────────
  // Eine Datei mit richtiger Groesse kann trotzdem Stille enthalten — etwa
  // wenn der Abgriff zwar stand, aber an einem Knoten, der gerade nichts
  // fuehrte. Auf dem `ls` sieht das aus wie ein gelungener Mitschnitt.
  const { spitze, mittel } = await pegelMessen(ziel)
  const u = urteil(spitze, mittel, dauer)
  if (!u.ok) {
    try {
      await rm(ziel)
    } catch {
      /* dann bleibt sie eben liegen */
    }
    protokoll(`verworfen (${u.wort}, Spitze ${spitze} dB): ${titel.name}`)
    return false
  }

  await fingerabdruckSetzen(ziel, protokoll)
  await songtextHolen(ziel, titel, protokoll)

  // DIE PLAYLIST FORTSCHREIBEN. Der Abspieldienst spielt sie, nicht die
  // Dateien — ohne sie waere das Album unsichtbar.
  await playlistSchreiben(unterordner, protokoll)
  await kachelAnlegen(titel, unterordner, protokoll)

  lauf.abgelegt += 1
  protokoll(
    `abgelegt${u.wort === 'ok' ? '' : ` (${u.wort})`}: ${titel.kuenstler} - ${titel.name} ` +
      `(${Math.round(dauer)} s, ${Math.round(gross / 1024)} kB${bild ? ', mit Cover' : ''})`,
  )
  return true
}

/**
 * Wo hoert der Ton wirklich auf? — von hinten gesucht.
 *
 * WARUM DAS NOETIG IST, und warum die Vollstaendigkeitsrechnung ohne es in
 * die Irre liefe: bricht die Wiedergabe mitten im Titel weg (auf dieser Box
 * reisst das WLAN alle paar Minuten ab), meldet der Spieler nichts mehr. Der
 * Takt sieht keinen Wechsel, `pw-record` schreibt weiter — und zwar STILLE.
 * Das Stueck wird dadurch nicht kuerzer als erwartet, sondern LAENGER. Es
 * saehe also nicht nur vollstaendig aus, sondern uebervollstaendig.
 *
 * Gesucht wird deshalb blockweise von hinten, bis ein Block Ton enthaelt.
 * Nur die letzten Bloecke werden gelesen, nicht der ganze Titel — bei drei
 * Minuten waeren das sonst 34 MB fuer eine Auskunft von einer Zahl.
 */
async function tonEndeSuchen(abSek, bisSek, protokoll) {
  const BLOCK_SEK = 5
  const STILL_UNTER = 0.003
  let f = null
  try {
    f = await open(lauf.datei, 'r')
    let ende = bisSek
    while (ende - abSek > BLOCK_SEK) {
      const von = Math.max(abSek, ende - BLOCK_SEK)
      const laenge = Math.round((ende - von) * BYTES_JE_SEK)
      const puffer = Buffer.alloc(laenge)
      const { bytesRead } = await f.read(puffer, 0, laenge, WAV_KOPF + Math.round(von * BYTES_JE_SEK))
      if (bytesRead <= 0) return ende
      const pegel = pegelFenster(puffer.subarray(0, bytesRead), 2, 100)
      // Von hinten im Block: das letzte Fenster mit Ton gibt das Ende.
      for (let i = pegel.length - 1; i >= 0; i--) {
        if (pegel[i] > STILL_UNTER) return von + ((i + 1) * 100) / 1000
      }
      ende = von
    }
    return ende
  } catch (fehler) {
    protokoll(`Endsuche uebersprungen: ${fehler.message}`)
    return bisSek
  } finally {
    await f?.close().catch(() => {})
  }
}

/**
 * DAS VERBINDUNGSSTUECK: aus abgelegten Dateien wird eine Kachel der Box.
 *
 * Ohne diesen Schritt liegen die Mitschnitte zwar richtig, aber die Box weiss
 * nichts von ihnen — keine Kachel, und nichts, was die Verschmelzung (E17)
 * gegen das Spotify-Album stellen koennte. Erst hier wird aus dem Puffer eine
 * QUELLE.
 *
 * ES GEHT UEBER DEN SERVER, NICHT IN DIE DATEI. `data.json` haengt an einer
 * Sperre (dataLock); wer sie umgeht, verliert Eintraege, sobald jemand
 * gleichzeitig etwas in der Verwaltung tut. `POST /api/medien` nimmt die
 * Sperre und weist Doppelte mit 409 ab — was hier kein Fehler ist, sondern
 * der Normalfall ab dem zweiten Titel.
 *
 * `type: 'library'` braucht KEINE Dienstkennung (medien.ts:237: `if
 * (!hatKennung && dienst !== 'lokal') return null`) — der Ordner IST die
 * Kennung.
 */
/**
 * In WELCHER Kategorie fuehrt die Box das Original? — sonst null.
 *
 * ══ WARUM DAS UEBER DIE VERSCHMELZUNG ENTSCHEIDET (20.08.2026) ═════════════
 *
 * Betreiber: „ich dachte wir wollen verschmelzen also der titel ist dann mit
 * mehreren batches … unter interpret team karacho, another nguyen gibt es
 * 2 mal den eintrag alles gleich."
 *
 * Gemessen: die Zuordnung Spotify-Album <-> Mitschnitt wird UEBERGANGEN, und
 * zwar mit dem Grund `kategorie` — das Spotify-Werk steht auf `music`, der
 * Mitschnitt auf `audiobook` (die feste Einstellung des Plugins).
 *
 * DER RIEGEL IN abgleich.ts IST RICHTIG und bleibt: eine verschmolzene Kachel
 * traegt die Kategorie des fuehrenden Werks, und die Oberflaeche siebt danach.
 * Zwei Kategorien zusammenzulegen liesse eine Kachel aus dem Abschnitt
 * verschwinden, in dem ein Kind sie sucht.
 *
 * ALSO WIRD DER KONFLIKT GAR NICHT ERST ERZEUGT. Ein Mitschnitt IST das
 * Original, nur aus einer zweiten Quelle — er gehoert in dieselbe Kategorie.
 * Gefragt wird die Box selbst, ueber die Spotify-Kennung des laufenden
 * Stuecks; findet sie nichts, bleibt es bei der Einstellung.
 */
async function kategorieDesOriginals(titel) {
  const uri = String(titel?.uri ?? '')
  const kennung = uri.startsWith('spotify:') ? uri.split(':').pop() : uri
  if (!kennung) return null
  try {
    const antwort = await serverSchicken('/api/werke', 'GET')
    const liste = Array.isArray(antwort?.inhalt) ? antwort.inhalt : []
    for (const w of liste) {
      for (const q of w?.quellen ?? []) {
        if (q?.dienst !== 'spotify') continue
        // Die Kennung steckt je nach Quelle als nackte Id, als spotify:…-Verweis
        // oder als Netzadresse drin — der Vergleich nimmt das letzte Wegstueck.
        const roh = String(q.kennung ?? '')
        const seine = roh.includes(':') || roh.includes('/') ? roh.split(/[:/]/).pop() : roh
        if (seine && seine === kennung && w.kategorie) return String(w.kategorie)
      }
    }
  } catch {
    /* Box antwortet nicht — dann eben die Einstellung. */
  }
  return null
}

/**
 * Die Aufnahme an die box-eigene Interpretenkennung haengen (E64b).
 *
 * WOZU (Betreiber, 20.08.2026): „koennen wir nicht box intern eine interpreten
 * ID machen, an die wir einfach aufnahme und Spotify usw knuepfen". Das hier
 * ist die Aufnahme-Haelfte davon.
 *
 * WARUM DER ORDNERNAME UND NICHT DER ANZEIGENAME: Der Verweis soll sagen,
 * WORAN man diesen Interpreten auf der PLATTE wiedererkennt. Das ist
 * `saeubern(kuenstler)` — derselbe Wert, den `albumOrdner` in den Pfad
 * schreibt und unter dem der Abspieldienst sucht. Er kann vom Spotify-Namen
 * abweichen (Satzzeichen, Emoji), und genau diese Abweichung ist der Grund,
 * aus dem es die Kennung ueberhaupt gibt.
 *
 * WARUM NICHT DER ALBUMORDNER: Eine Kennung gehoert einem INTERPRETEN, nicht
 * einem Album. Und warum ohne Kategorie: derselbe Interpret kann unter
 * `music/` und unter `audiobook/` liegen; die Kategorie gehoert zum Werk, nicht
 * zur Person.
 *
 * STUFE `erkannt`, NICHT `hand`: Das hier entscheidet eine Maschine. Die
 * Unterscheidung ist keine Formsache — bei `hand` duerfte der Server zwei
 * Interpreten ZUSAMMENLEGEN, und das darf nur ein Mensch (die Regel steht in
 * interpretenkennung.ts und stammt aus E49). Mit `erkannt` legt der Server
 * hoechstens eine NEUE Kennung an oder nennt die vorhandene.
 *
 * ES SCHEITERT LEISE. Ein Mitschnitt, der geglueckt ist, darf nicht daran
 * haengen, ob eine Verknuepfung geklappt hat — die Kachel steht, die Datei
 * liegt, und die Kennung laesst sich jederzeit nachtragen. Gemeldet wird es
 * trotzdem, sonst faellt ein dauerhaft kaputter Weg niemandem auf.
 */
export function kennungAnfragen(kuenstler) {
  const name = String(kuenstler || '').trim()
  if (!name) return null
  return {
    anlegen: { name, stufe: 'erkannt' },
    verweis: { dienst: 'aufnahme', kennung: saeubern(name), stufe: 'erkannt' },
  }
}

async function kennungVerknuepfen(kuenstler, protokoll) {
  const anfrage = kennungAnfragen(kuenstler)
  if (!anfrage) return
  const name = anfrage.anlegen.name
  try {
    const a = await serverSchicken('/api/interpretenkennungen', 'POST', anfrage.anlegen)
    const id = a.inhalt?.id
    if (!id) {
      protokoll(`Interpretenkennung nicht bekommen (${a.status}) fuer ${name}`)
      return
    }
    const v = await serverSchicken('/api/interpretenkennungen/verweis', 'POST', { id, ...anfrage.verweis })
    if (v.status >= 200 && v.status < 300) {
      protokoll(`Aufnahme verknuepft: ${name} -> ${id}${a.inhalt?.angelegt ? ' (neu)' : ''}`)
    } else {
      protokoll(`Verweis nicht gesetzt (${v.status}) fuer ${name}`)
    }
  } catch (e) {
    protokoll(`Interpretenkennung fehlgeschlagen fuer ${name}: ${e}`)
  }
}

/**
 * Welche KONTEXT-Arten noch als Quelle taugen — nur noch `album`.
 *
 * ══ WARUM playlist UND show HIER RAUSGEFALLEN SIND (20.09.2026) ════════════
 *
 * Sie standen hier, weil `medienSchluessel()` (medien.ts) aus allen dreien
 * denselben `spotify:<id>` bildet. Das stimmt — und war trotzdem die falsche
 * Frage. Die richtige lautet: WAS wird hier verbunden? Links steht immer ein
 * ORDNER, und der gehoert einem ALBUM (`albumOrdner`, oben). Rechts stand bei
 * `playlist`/`show` eine Zusammenstellung.
 *
 * `verschmelzeWerke()` weist ein Paar mit verschiedener `art` ab (Fall 2,
 * verschmelzung.ts: der Abspielbefehl entsteht aus `art`, eine Kachel hat nur
 * eine) — und zwar STILL. Auf der Box nachgezaehlt (192.168.178.62,
 * 20.09.2026): VIER solcher Zuordnungen lagen in verschmelzung.json, alle
 * Stufe „hand", alle vom Mitschnitt geschrieben, alle wirkungslos:
 *
 *     spotify:7Hab78tqZ8iuAuvQUgpHdO (Playlist „Die Schluempfe - Alle
 *     Hoerspiele")  <->  Folge 4 UND Folge 10
 *     spotify:6iTRDGpKQ3BLvjh36cM825 <->  Pettersson und Findus Folge 11
 *     spotify:0dOx2eLhuDusJvgYXYzzWP <->  Major Tom 11 und 12
 *     spotify:0MGHvjm7mg2PSvWsknKqxO <->  Das kleine WIR (zwei Alben)
 *
 * Gemessen an `/api/werke?verschmelzen=1`: keines dieser Werke trug ein
 * `auchSchluessel`. Eingebaut, gruen, wirkungslos — genau die Sorte Fehler,
 * vor der abgleich.ts im eigenen Kopf warnt. Haette eines davon GEGRIFFEN,
 * waere es schlimmer gewesen: zwei verschiedene Folgen waeren zu EINER Kachel
 * geworden, und dahinter haette die ganze Playlist gestanden.
 */
const SPOTIFY_KONTEXT_ARTEN = new Set(['album'])

/**
 * Der Bibliotheksschluessel des Spotify-ALBUMS, zu dem die Kachel gehoert —
 * oder null, wenn es keines gibt, das man FESTSCHREIBEN koennte.
 *
 * ══ ZUERST DAS ALBUM DES STUECKS, DANN DER KONTEXT (20.09.2026) ════════════
 *
 * Betreiber-Befund, woertlich: „die box zeigt von ohrwuermer und kinderlieder
 * nur die aufgezeichneten aber nicht die fehlenden. Warum wird nicht
 * aufgefuellt mit den internet verfuegbaren." Am Geraet gemessen: 9 von 15
 * Titeln lagen auf der Platte, die Kachel zeigte 9. Das Auffuellen ist
 * gebaut (`waehleInhalt`, verschmelzung.ts: die vollere Quelle gewinnt) — es
 * braucht nur eine ZWEITE Quelle, und die gab es nicht: das Kind hatte das
 * Album nicht von einer Album-Kachel aus gespielt, also war `kontextArt`
 * keine, aus der hier je ein Schluessel entstand.
 *
 * `titel.albumUri` beantwortet dieselbe Frage unabhaengig davon, WOHER
 * gespielt wurde: das Stueck nennt sein Album selbst. Der Kontext bleibt als
 * zweiter Weg stehen — er kostet nichts und traegt den Fall, in dem der
 * Zustand kein `album.uri` mitschickt.
 *
 * `titel.kontextUri`/`titel.kontextArt` kommen aus `titelAus()`: dieselbe
 * Angabe (`context.uri`/`context.type` des Spielerzustands), die server.ts
 * (spielstand.ts, weiterhoeren.ts) fuer denselben Zweck liest.
 */
export function spotifyQuellSchluessel(titel) {
  const ausAlbum = kennungAus(titel?.albumUri)
  if (ausAlbum) return `spotify:${ausAlbum}`
  if (!SPOTIFY_KONTEXT_ARTEN.has(String(titel?.kontextArt ?? ''))) return null
  const ausKontext = kennungAus(titel?.kontextUri)
  return ausKontext ? `spotify:${ausKontext}` : null
}

/** Der letzte Abschnitt einer `spotify:...:<id>`-Kennung — auch aus blosser id. */
function kennungAus(uri) {
  const s = String(uri ?? '')
  const i = s.lastIndexOf(':')
  return (i >= 0 ? s.slice(i + 1) : s).trim()
}

/**
 * Was an `/api/verschmelzung/festschreiben` zu schicken ist, um die neue
 * Kachel an ihre Spotify-Quelle zu binden — oder null.
 *
 * REINE FUNKTION, wie `kennungAnfragen` weiter oben: das WAS wird hier
 * entschieden, das SCHICKEN uebernimmt `verschmelzungFestschreiben`. Das
 * macht die Entscheidung ohne Netz pruefbar.
 */
export function festschreibenAnfrage(titel, kachelSchluessel) {
  const quelle = spotifyQuellSchluessel(titel)
  const kachel = String(kachelSchluessel ?? '').trim()
  if (!quelle || !kachel || quelle === kachel) return null
  return { schluessel: quelle, auch: kachel }
}

/**
 * Was an `POST /api/medien` zu schicken ist, damit die QUELLE der Aufnahme
 * ueberhaupt als Eintrag existiert — oder null.
 *
 * ══ WARUM DIE ZUORDNUNG ALLEIN NICHTS NUETZT (20.09.2026) ══════════════════
 *
 * `eintraegeInBevorzugung` (server.ts) sucht zu jedem Schluessel eines
 * verschmolzenen Werks den EINTRAG in data.json. Einen Schluessel ohne
 * Eintrag uebergeht `verschmelzeWerke()` — die Zuordnung steht dann in der
 * Datei und wirkt nicht. Genau so lag der Betreiber-Fall: die Kachel war da,
 * die Aufnahme war da, die Spotify-Fassung kannte niemand, und `/inhalt`
 * hatte nur EINEN Kandidaten zu waehlen. Das Auffuellen braucht ZWEI.
 *
 * DIE KATEGORIE KOMMT VON DER KACHEL, nicht aus einer eigenen Ueberlegung:
 * beide stehen danach als EIN Werk da, und `KATEGORIE_TRENNT` (abgleich.ts)
 * liesse ein Paar mit verschiedenen Kategorien gar nicht zusammen.
 *
 * DER INTERPRET IST DER DES ORDNERS (`albumKuenstler`), aus demselben Grund
 * wie in `kachelAnlegen`: unter ihm sucht die Box das Werk.
 */
export function quelleAnfrage(titel, kategorie) {
  const id =
    kennungAus(titel?.albumUri) ||
    (SPOTIFY_KONTEXT_ARTEN.has(String(titel?.kontextArt ?? '')) ? kennungAus(titel?.kontextUri) : '')
  const name = String(titel?.album ?? '').trim()
  if (!id || !name) return null
  const rumpf = {
    type: 'spotify',
    category: String(kategorie || 'music'),
    title: name,
    artist: String(titel?.albumKuenstler || titel?.kuenstler || 'Unbekannt'),
    id,
    spotify_url: `https://open.spotify.com/album/${id}`,
  }
  if (titel?.bild) rumpf.cover = String(titel.bild)
  return rumpf
}

/**
 * Die Zuordnung FESTSCHREIBEN, statt sie der Heuristik der Verwaltung zu
 * ueberlassen.
 *
 * ══ WOFUER (Befund der Verwaltung, 29.08.2026) ══════════════════════════════
 * `GET /api/medien` fasst Eintraege nur zusammen, wenn `meinenDasselbe()`
 * Titel und Interpret fuer aehnlich genug haelt. Wurde der Spotify-Eintrag in
 * der Verwaltung umbenannt oder weicht der von der Box angenommene Interpret
 * (`titel.albumKuenstler || titel.kuenstler || 'Unbekannt'` in
 * `kachelAnlegen`) ab, haelt die Heuristik das Paar nicht zusammen — der
 * Mitschnitt WEISS aber, zu welchem Spotify-Eintrag seine Kachel gehoert
 * (`spotifyQuellSchluessel`), und muss das nicht raten lassen.
 *
 * DERSELBE SCHREIBWEG WIE EINE HANDENTSCHEIDUNG DER VERWALTUNG — nur dass
 * hier der Mitschnitt sie trifft: `handVerbinden` (abgleich.ts) ist idempotent
 * und laesst eine ausdrueckliche Trennung (`getrennt`) unangetastet.
 *
 * SCHEITERT LEISE, wie `kennungVerknuepfen` oben: eine geglueckte Aufnahme
 * darf nicht daran haengen, ob die Zusammenfuehrung geklappt hat.
 *
 * `schicken` IST EIN VIERTES, INJIZIERBARES ARGUMENT — Vorgabe `serverSchicken`.
 * `serverSchicken` selbst spricht `node:http` direkt an (kein Zugang, den ein
 * Test ohne Netz nachstellen koennte); ein Mock von `http.request` erreicht es
 * NICHT, weil ESM benannte Importe eingebauter Module beim Einlesen aufloest
 * und nicht bei jedem Aufruf neu (nachgemessen: `mock.method(http,
 * 'request', …)` liess den bereits importierten `request`-Bezeichner
 * unveraendert). Die Stelle, an der man testweise ansetzen kann, ist deshalb
 * dieser Parameter — derselbe Kunstgriff wie eine austauschbare Abhaengigkeit
 * in jeder anderen Sprache.
 */
export async function verschmelzungFestschreiben(
  titel,
  kachelSchluessel,
  protokoll,
  schicken = serverSchicken,
  kategorie = '',
) {
  const zuordnung = festschreibenAnfrage(titel, kachelSchluessel)
  if (!zuordnung) return
  /* ERST DIE QUELLE, DANN DIE ZUORDNUNG (20.09.2026). Ein 409 heisst „gibt es
   * schon" und ist der Normalfall ab dem zweiten Stueck — kein Fehler. Auch
   * ein Fehlschlag bricht hier nichts ab: die Zuordnung bleibt richtig, sie
   * wirkt dann eben erst, wenn der Eintrag auf anderem Weg entsteht
   * (tools/mitschnitt-quelle-anlegen.py). */
  const quelle = quelleAnfrage(titel, kategorie)
  if (quelle) {
    try {
      const q = await schicken('/api/medien', 'POST', quelle)
      if (q.status >= 200 && q.status < 300) protokoll(`Quelle angelegt: spotify:${quelle.id} („${quelle.title}")`)
      else if (q.status !== 409) protokoll(`Quelle nicht angelegt (${q.status}): ${quelle.title}`)
    } catch (e) {
      protokoll(`Quelle fehlgeschlagen fuer ${quelle.title}: ${e}`)
    }
  }
  try {
    const a = await schicken('/api/verschmelzung/festschreiben', 'POST', zuordnung)
    if (a.status >= 200 && a.status < 300) {
      protokoll(`Verschmelzung festgeschrieben: ${zuordnung.schluessel} = ${zuordnung.auch}`)
    } else {
      protokoll(`Verschmelzung nicht festgeschrieben (${a.status}): ${zuordnung.schluessel}`)
    }
  } catch (e) {
    protokoll(`Verschmelzung fehlgeschlagen fuer ${zuordnung.schluessel}: ${e}`)
  }
}

async function kachelAnlegen(titel, ordner, protokoll) {
  if (!titel?.album || lauf.gemeldet.has(ordner)) return
  lauf.gemeldet.add(ordner)

  const rumpf = {
    type: 'library',
    // DIESELBE Kategorie, die der ORDNER traegt — sonst zeigt die Kachel auf
    // einen Pfad, den der Abspieldienst nicht findet.
    category: lauf.kategorieJeTitel?.get(titel.uri) || lauf.kategorie,
    title: titel.album,
    // Der ALBUM-Interpret, wie beim Ordner: unter ihm sucht die Box das Werk.
    artist: titel.albumKuenstler || titel.kuenstler || 'Unbekannt',
  }
  const bild = await coverKlein(ordner, protokoll)
  if (bild) rumpf.cover = bild
  /* „HIER FEHLT NOCH ETWAS" (E89). Die Kachel entsteht nach dem ERSTEN
   * gelungenen Stueck — sie ist in diesem Moment IMMER unvollstaendig, und
   * beim Betreiber standen deshalb Alben mit 25 Sekunden im Regal, die wie
   * fertige aussahen. Abgeraeumt wird die Marke am Ende eines sauberen
   * Laufs; stirbt der Mitschnitt vorher, bleibt sie stehen. */
  rumpf.unvollstaendig = true

  const antwort = await serverSchicken('/api/medien', 'POST', rumpf)
  const schluessel = antwort.inhalt?.schluessel
  if (schluessel) lauf.markiert.add(schluessel)
  if (antwort.status === 409) {
    protokoll(`Kachel gibt es schon: ${titel.album}`)
    /* DIE MARKE NACHZIEHEN (E89). Beim zweiten Stueck antwortet der Server
     * mit 409, der POST aendert also nichts mehr. Ein Album, das ein
     * FRUEHERER Lauf sauber abgeschlossen hat und das jetzt weiterwaechst,
     * ist wieder unvollstaendig — ohne diesen PATCH bliebe es als fertig
     * markiert stehen. */
    if (schluessel) {
      await serverSchicken(`/api/medien/${encodeURIComponent(schluessel)}`, 'PATCH', { unvollstaendig: true })
    }
    // Auch dann sichtbar machen: beim ersten Lauf kann das Anlegen geklappt
    // und das Sichtbarmachen gefehlt haben.
    await sichtbarMachen(schluessel, titel, protokoll)
  } else if (antwort.status >= 200 && antwort.status < 300) {
    protokoll(`KACHEL ANGELEGT: ${rumpf.artist} — ${rumpf.title}${bild ? ' (mit Cover)' : ''}`)
    await sichtbarMachen(schluessel, titel, protokoll)
  } else {
    protokoll(`Kachel nicht angelegt (${antwort.status}): ${titel.album}`)
  }

  // AUCH BEI 409. Dass die Kachel schon stand, heisst nur, dass ein frueherer
  // Lauf sie angelegt hat — der Interpret ist da, und die Verknuepfung kann aus
  // einer Zeit stammen, in der es die Kennung noch nicht gab. Dieselbe
  // Ueberlegung gilt fuer die Verschmelzung: der Spotify-Kontext von JETZT darf
  // eine Zuordnung nachtragen, auch wenn die Kachel schon vom letzten Stueck
  // stand.
  if (antwort.status === 409 || (antwort.status >= 200 && antwort.status < 300)) {
    await kennungVerknuepfen(rumpf.artist, protokoll)
    // DIE KATEGORIE DER KACHEL REIST MIT: die Quelle muss dieselbe tragen,
    // sonst laesst `KATEGORIE_TRENNT` (abgleich.ts) das Paar nicht zusammen.
    await verschmelzungFestschreiben(titel, schluessel, protokoll, serverSchicken, rumpf.category)
  }
}

/**
 * Das Cover als kleine Datenadresse.
 *
 * WARUM VERKLEINERT: `POST /api/medien` nimmt hoechstens 32 kB fuer den
 * ganzen Rumpf. Das Originalcover ist 640x640 und liegt weit darueber — es
 * wuerde den Eintrag ohne jede Fehlermeldung zurueckweisen. 300 Pixel reichen
 * fuer eine Kachel und bleiben mit Abstand darunter.
 *
 * WARUM UEBERHAUPT EINGEBETTET: der Abspieldienst holt Cover nur aus ID3,
 * also aus MP3 — `fLaC` kommt in seinem Quelltext kein einziges Mal vor. Das
 * in der FLAC-Datei steckende Bild (nachgemessen: 640x640 mjpeg) wuerde er
 * nie finden. Die Kachel bekommt ihr Bild deshalb aus dem Eintrag, wo die
 * uebrigen lokalen Cover ohnehin liegen (server.ts: "so liegen die lokalen
 * Cover in der Liste").
 */
async function coverKlein(ordner, protokoll, ausDatei = null) {
  // Der Nachschnitt reicht seine eigene Quelle herein — er hat keinen `lauf`
  // (siehe `coverHolen`). Ohne Angabe gilt wie bisher die des Live-Laufs.
  const quelle = ausDatei || lauf.coverDatei
  if (!quelle) return null
  const ziel = join(ordner, 'cover.jpg')
  try {
    await laufen('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', quelle,
                            '-vf', 'scale=220:-1', '-q:v', '8', ziel], 60_000)
    const roh = await readFile(ziel)
    // BASE64 WAECHST UM EIN DRITTEL. Der Endpunkt nimmt 32 kB fuer den GANZEN
    // Rumpf. Gemessen: 300 px ergaben 38 kB (zu viel), 220 px ergeben 18 kB —
    // daraus werden rund 24 kB base64, und der Rest des Eintrags passt daneben.
    if (roh.length > 22_000) {
      protokoll(`Cover mit ${Math.round(roh.length / 1024)} kB zu gross fuer den Eintrag — Kachel ohne Bild`)
      return null
    }
    return `data:image/jpeg;base64,${roh.toString('base64')}`
  } catch (f) {
    protokoll(`kein Kachelbild: ${f.message}`)
    return null
  }
}

/** Etwas an den eigenen Server schicken. Liefert Status UND Antwort. */
function serverSchicken(pfad, art, rumpf) {
  return new Promise((fertig) => {
    const daten = rumpf === undefined ? null : Buffer.from(JSON.stringify(rumpf))
    const bitte = anfrage(
      {
        host: '127.0.0.1', port: 8200, path: pfad, method: art, timeout: 10_000,
        headers: daten ? { 'Content-Type': 'application/json', 'Content-Length': daten.length } : {},
      },
      (antwort) => {
        let roh = ''
        antwort.on('data', (stueck) => (roh += stueck))
        antwort.on('end', () => {
          let inhalt = null
          try {
            inhalt = JSON.parse(roh)
          } catch {
            /* keine JSON-Antwort — dann eben nur der Status */
          }
          fertig({ status: antwort.statusCode ?? 0, inhalt })
        })
      },
    )
    bitte.on('error', () => fertig({ status: 0, inhalt: null }))
    bitte.on('timeout', () => (bitte.destroy(), fertig({ status: 0, inhalt: null })))
    bitte.end(daten ?? undefined)
  })
}

/**
 * Das frische Werk sichtbar machen — sonst legt der Mitschnitt eine Kachel an,
 * die niemand sieht.
 *
 * WARUM DAS NOETIG IST, und warum es harmlos ist: `/api/data` filtert mit der
 * MEDIENAUSWAHL des Profils, und der Dienst steckt IM SCHLUESSEL. Dasselbe
 * Album hat als Spotify-Eintrag `spotify:7zkg…` und als Mitschnitt
 * `lokal:t:kuenstler|titel` — zwei verschiedene Schluessel. In der Auswahl
 * steht nur der erste, also faellt der Mitschnitt heraus. Und weil
 * `auswahlFiltern` VOR der Verschmelzung laeuft (server.ts: erst Zeile 8298,
 * dann 8308), rettet ihn auch die nicht.
 *
 * HARMLOS IST ES, WEIL ES NICHTS NEUES ZEIGT: das Profil hoert dieses Album
 * GERADE — es steht also ohnehin in seiner Auswahl, nur unter der anderen
 * Kennung. Aufgenommen wird dieselbe Platte, nicht eine weitere.
 *
 * Hat ein Profil gar keine Auswahl, sieht es ohnehin alles; der Endpunkt
 * meldet dann `unveraendert` und ruehrt nichts an.
 */
async function sichtbarMachen(schluessel, titel, protokoll) {
  if (!schluessel) return
  // UEBER /api/profile, NICHT /api/profil/aktiv: letzteres gibt es nur als
  // POST, zum SETZEN. Der Stand kommt aus der Profilliste, und dort heisst
  // das Feld `aktiv` (profile.ts:148).
  const wer = await serverSchicken('/api/profile', 'GET')
  const profil = wer.inhalt?.aktiv
  if (!profil) {
    protokoll(`Kachel angelegt, aber kein aktives Profil erkannt — sie bleibt womoeglich unsichtbar`)
    return
  }
  const a = await serverSchicken('/api/profil/auswahl/werk', 'POST', {
    profil,
    schluessel,
    an: true,
  })
  if (a.inhalt?.unveraendert) {
    protokoll(`${profil} sieht ohnehin alles — nichts zu tun`)
  } else if (a.status >= 200 && a.status < 300) {
    protokoll(`fuer ${profil} sichtbar gemacht: ${titel.album}`)
  } else {
    protokoll(`nicht sichtbar gemacht (${a.status}) — die Kachel bleibt in der Verwaltung erreichbar`)
  }
}

/** Die Playlist eines Albums neu aus seinen Spuren schreiben. */
async function playlistSchreiben(ordner, protokoll) {
  try {
    const namen = await readdir(ordner)
    await writeFile(join(ordner, 'playlist.m3u'), m3uInhalt(ordner, namen), 'utf8')
  } catch (f) {
    protokoll(`Playlist nicht geschrieben: ${f.message}`)
  }
}

/** Die Spieldauer einer fertigen Datei, in Sekunden. */
async function dauerVon(pfad) {
  const aus = await laufen(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', pfad],
    30_000,
  )
  const n = Number(String(aus).trim())
  return Number.isFinite(n) ? n : 0
}

/** Der gemerkte Vollstaendigkeitsanteil einer fertigen Datei (0..1). */
async function anteilVon(pfad) {
  const aus = await laufen(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format_tags=MIXPI_VOLLSTAENDIG', '-of', 'default=noprint_wrappers=1:nokey=1', pfad],
    30_000,
  )
  const m = /(\d+)\s*%/.exec(String(aus))
  return m ? Number(m[1]) / 100 : 1
}

/** Die ersten anderthalb Sekunden eines Abschnitts auf das Knacksmuster ansehen. */
async function knacksVorne(abSek, protokoll) {
  let f = null
  try {
    f = await open(lauf.datei, 'r')
    const laenge = Math.round(1.5 * BYTES_JE_SEK)
    const puffer = Buffer.alloc(laenge)
    const { bytesRead } = await f.read(puffer, 0, laenge, WAV_KOPF + Math.round(abSek * BYTES_JE_SEK))
    if (bytesRead < BYTES_JE_SEK / 4) return 0
    return knacksSchnitt(pegelFenster(puffer.subarray(0, bytesRead)))
  } catch (fehler) {
    protokoll(`Knackspruefung uebersprungen: ${fehler.message}`)
    return 0
  } finally {
    await f?.close().catch(() => {})
  }
}

/** Spitzen- und Mittelpegel einer fertigen Datei, in dB. */
async function pegelMessen(pfad) {
  // `volumedetect` schreibt nach stderr, nicht nach stdout — deshalb 2>&1
  // ueber die Sammelausgabe von `laufen`.
  const aus = await laufenMitFehler('ffmpeg', ['-hide_banner', '-i', pfad, '-af', 'volumedetect', '-f', 'null', '-'], 90_000)
  const spitze = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(aus)
  const mittel = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(aus)
  return { spitze: spitze ? Number(spitze[1]) : -99, mittel: mittel ? Number(mittel[1]) : -99 }
}

/**
 * Den Chromaprint-Fingerabdruck als Dateimerkmal eintragen.
 *
 * WOZU: er beschreibt, wie die Aufnahme KLINGT. Damit laesst sich spaeter
 * feststellen, ob zwei Dateien denselben Titel enthalten, auch wenn Name und
 * Tags auseinanderlaufen — und ob ein Mitschnitt zu dem passt, was er zu sein
 * behauptet. Der Name `ACOUSTID_FINGERPRINT` ist die Picard-Konvention, damit
 * andere Programme ihn wiedererkennen.
 *
 * Es geht KEINE Anfrage hinaus. Gerechnet wird hier, verglichen wird hier.
 */
async function fingerabdruckSetzen(pfad, protokoll) {
  try {
    const roh = await laufen('fpcalc', ['-json', pfad], 60_000)
    const d = JSON.parse(roh || '{}')
    if (!d.fingerprint) return
    const vorlaeufig = `${pfad}.tag.flac`
    // `-c copy` statt neu zu kodieren: der Ton bleibt Bit fuer Bit derselbe.
    await laufen(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', pfad, '-c', 'copy',
       '-metadata', `ACOUSTID_FINGERPRINT=${d.fingerprint}`, vorlaeufig],
      120_000,
    )
    await rename(vorlaeufig, pfad)
  } catch (f) {
    protokoll(`kein Fingerabdruck: ${f.message}`)
  }
}

/** Songtext von LRCLIB — ohne Schluessel, ohne Anmeldung. */
async function songtextHolen(pfad, titel, protokoll) {
  if (!titel.name || !titel.kuenstler) return
  try {
    const frage = new URLSearchParams({
      track_name: titel.name,
      artist_name: titel.kuenstler,
      album_name: titel.album || '',
    })
    const d = await httpsHolen(`https://lrclib.net/api/get?${frage}`)
    if (!d) return
    const g = JSON.parse(d)
    const text = g.syncedLyrics || g.plainLyrics
    if (!text) return
    // Neben die Tondatei, wie es Abspieler erwarten: gleicher Name, andere
    // Endung. `.lrc` ist der mitlaufende Text, `.txt` der schlichte.
    await writeFile(pfad.replace(/\.flac$/, g.syncedLyrics ? '.lrc' : '.txt'), text, 'utf8')
    protokoll(`Songtext gefunden (${g.syncedLyrics ? 'mitlaufend' : 'schlicht'})`)
  } catch {
    /* kein Text ist der Normalfall, keine Meldung wert */
  }
}

/** Das Cover in eine Datei holen — je Adresse nur einmal. */
async function coverHolen(titel, protokoll, ordner = null) {
  const adresse = titel.bild
  if (!adresse) return null
  /* ZWEI RUFER, EIN WEG (E135/1c, 10.09.2026).
   *
   * Der Live-Mitschnitt legt sein Cover einmal je LAUF ab und merkt es sich
   * (`lauf.coverAdresse`) — er schneidet zwanzig Titel aus derselben Aufnahme
   * und holt das Bild sonst zwanzigmal. Der Nachschnitt hat keinen Lauf: er
   * nimmt EINEN Titel auf, in einen fremden Ordner, womoeglich waehrend
   * nebenan ein Live-Mitschnitt laeuft. Er gibt seinen Ordner mit und laesst
   * den Merker in Ruhe.
   *
   * Der Umweg ueber einen zweiten, fast gleichen Holer waere genau die Falle,
   * aus der dieser ganze Fehler stammt (llmwiki
   * `der-stille-zweitweg-verliert-die-beilage`).
   */
  const eigener = typeof ordner === 'string' && ordner
  if (!eigener && lauf.coverAdresse === adresse && lauf.coverDatei) return lauf.coverDatei
  try {
    const roh = await httpsHolen(adresse, true)
    if (!roh?.length) return null
    const ziel = join(eigener ? ordner : lauf.ordner, '.cover.jpg')
    await writeFile(ziel, roh)
    if (!eigener) {
      lauf.coverAdresse = adresse
      lauf.coverDatei = ziel
    }
    return ziel
  } catch (f) {
    protokoll(`kein Cover: ${f.message}`)
    return null
  }
}

/**
 * Der Takt: laeuft noch derselbe Titel?
 *
 * Er fragt den Spieler, nicht den Ton. Die Box weiss bereits, was sie spielt —
 * das ist ihr Vorteil gegenueber jedem Werkzeug, das Titelgrenzen aus dem
 * Signal raten muss (Stilleerkennung, Fingerabdruck). Was sie NICHT weiss,
 * ist, wo in der Aufnahme das steht; dafuer die Dateigroesse.
 */
/* ══ DIE LISTE (E66/E73) ═══════════════════════════════════════════════════
 *
 * Bis hierher war der Mitschnitt ein PASSIVER ABGRIFF: wer den Titel wechselt,
 * schneidet die Aufnahme ab, und das Bruchstueck wird verworfen. Mit der Liste
 * wird das Verworfene VORGEMERKT und spaeter vollstaendig nachgeschnitten.
 *
 * Es gibt genau DREI Stellen, an denen etwas verworfen wird — sie sind
 * zugleich die drei Stellen, an denen vorgemerkt wird. Mehr braucht es nicht:
 * was abgelegt wurde, liegt ja vor.
 */

/** Der Datenordner des Plugins. Der Wirt reicht ihn je Ereignis herein. */
let datenOrdner = ''

/**
 * Welche Kategorien gibt es im Medienordner?
 *
 * Gebraucht fuer den Abgleich: beim Vormerken ist die Kategorie noch nicht
 * bekannt (sie wird erst beim Ablegen beim Original erfragt), also muss jede
 * in Frage kommende geprueft werden.
 */
async function kategorienLesen(basis) {
  const ersatz = [lauf.kategorie || 'music']
  try {
    const drin = await readdir(basis, { withFileTypes: true })
    const ordner = drin.filter((e) => e.isDirectory()).map((e) => e.name)
    return ordner.length ? ordner : ersatz
  } catch {
    return ersatz
  }
}

/**
 * Einen angespielten, aber nicht abgelegten Titel vormerken.
 *
 * `gehoertSek` entscheidet ueber den Vorrang (Schwelle 30 s aus E73) — nicht
 * ueber das OB. Auch fuenf Sekunden Blaettern kommen auf die Liste, nur eben
 * hinten: der Titel wurde angetippt, also besteht Interesse, und im Leerlauf
 * kostet die Aufnahme nichts als Zeit.
 */
async function vormerkenFuerSpaeter(titel, gehoertSek, protokoll) {
  if (!datenOrdner || !titel?.uri) return
  const { vorrang } = einordnen(gehoertSek)
  let sagen = ''
  try {
    const erg = await mitListe(datenOrdner, (liste) => {
      const v = vormerken(
        liste,
        {
          uri: titel.uri,
          titel: titel.name,
          interpret: titel.kuenstler,
          // Der ORDNER gehoert dem Album — derselbe Grund wie beim Ablegen.
          albumInterpret: titel.albumKuenstler || titel.kuenstler,
          album: titel.album,
          nummer: titel.nummer,
          // DAS BILD GEHOERT MIT AUF DIE LISTE (E135/1c). Es lag hier immer
          // schon bereit — `titelAus` traegt `album.images[0].url` ein —, und
          // wurde bis zum 10.09.2026 nicht mitgenommen. Der Nachschnitt baut
          // seine Aufnahme allein aus dem Eintrag, also war das Bild fuer ihn
          // nie da: 42 von 69 Alben zeigten das Maskottchen.
          bild: titel.bild,
        },
        'automatisch',
        vorrang,
      )
      sagen = v.ok ? v.grund : ''
      return v.ok ? v.liste : null
    })
    if (!erg.geschrieben) {
      // Nur melden, wenn es etwas zu melden GAB. „Steht schon in der Liste"
      // ist der haeufigste Fall und keine Nachricht wert.
      if (sagen || erg.grund) protokoll(`Vormerkung nicht gesichert: ${erg.grund || sagen}`)
      return
    }
    protokoll(
      `vorgemerkt${vorrang ? ' MIT VORRANG' : ''} (${Math.round(gehoertSek)} s gehoert): ` +
        `"${titel.name}"${sagen ? ` — ${sagen}` : ''}`,
    )
  } catch (f) {
    protokoll(`Vormerkung scheiterte: ${f.message}`)
  }
}

/**
 * DIE PLATTE GEGEN DIE LISTE HALTEN (Regel 1).
 *
 * Einmal beim Start eines Mitschnitts. Was schon liegt, wird `fertig` — sonst
 * naehme die Box im Leerlauf Titel ein zweites Mal auf, und die Investition
 * amortisiert sich nie.
 */
async function listeAbgleichen(basis, protokoll) {
  if (!datenOrdner) return
  const kategorien = await kategorienLesen(basis)
  let erledigt = []
  try {
    await mitListe(datenOrdner, (liste) => {
      const a = abgleichen(liste, (e) => {
        const pfade = spurpfade(e, basis, kategorien)
        return pfade.length > 0 && pfade.some((p) => existsSync(p))
      })
      erledigt = a.erledigt
      return erledigt.length ? a.liste : null
    })
  } catch (f) {
    protokoll(`Abgleich mit der Platte scheiterte: ${f.message}`)
    return
  }
  if (erledigt.length) {
    protokoll(`${erledigt.length} vorgemerkte Titel lagen schon auf der Platte — als erledigt vermerkt`)
  }
}

async function nachsehen(protokoll) {
  if (lauf.beschaeftigt || !lauf.prozess) return

  // DIE WACHE UEBER DEN SPEICHER. Ein volles /dev/shm trifft nicht nur den
  // Mitschnitt, sondern die ganze Box — deshalb wird hier beendet, bevor es
  // eng wird, und nicht erst, wenn nichts mehr geht.
  if (lauf.rohImSpeicher) {
    const frei = await freiMb(SPEICHER_ORT)
    if (frei >= 0 && frei < SPEICHER_NOT_MB) {
      protokoll(`nur noch ${Math.round(frei)} MB im Arbeitsspeicher — der Mitschnitt wird beendet`)
      await beenden(protokoll, 'Speicher wird knapp')
      return
    }
  }
  const jetzt = titelAus(await spielerZustand())
  if (!jetzt || !istNeuerTitel(lauf.titel, jetzt)) return

  lauf.beschaeftigt = true
  try {
    let versatz = 0
    try {
      versatz = versatzAusGroesse((await stat(lauf.datei)).size)
    } catch {
      return
    }
    // Der Wechsel faellt bis zu einen Takt zu spaet auf. Wie weit der neue
    // Titel schon laeuft, sagt der Spieler — genau so weit liegt der Schnitt
    // zurueck.
    const grenze = schnittstelle(versatz, jetzt.fortschrittMs)
    if (lauf.titel) await abschnittAblegen(lauf.titel, lauf.titelAbSek, grenze, protokoll)
    lauf.titel = jetzt
    lauf.titelAbSek = grenze
  } finally {
    lauf.beschaeftigt = false
  }
}

/**
 * Auf den SPIELER warten, statt einmal nachzusehen.
 *
 * Gegenstueck zu `aufKnotenWarten` weiter unten, eine Ebene frueher: dort geht
 * es um den PipeWire-Knoten, hier um die Frage, ob der Abspieldienst ueberhaupt
 * schon einen Titel meldet.
 *
 * WARUM ES DAS BRAUCHT (am Geraet gemessen, 21.08.2026): Abspielbefehl um
 * 13:00:45, der Titel stand erst rund VIERZEHN SEKUNDEN spaeter im Zustand.
 * Ein einziger Blick direkt nach dem Ereignis findet also nichts — und das
 * Plugin schloss daraus „fuer diese Quelle gibt es keinen Mitschnitt".
 *
 * ES GIBT DEN ZUSTAND ZURUECK, NICHT DEN TITEL: der Aufrufer braucht beides,
 * und `titelAus(null)` ist ohnehin `null`. Laeuft die Zeit ab, kommt der
 * letzte gesehene Zustand — dann entscheidet der Aufrufer wie bisher, nur
 * eben nach einer fairen Wartezeit statt nach einem Wimpernschlag.
 */
async function aufTitelWarten(hoechstensMs = 25_000) {
  const bis = Date.now() + hoechstensMs
  let zuletzt = null
  while (Date.now() < bis) {
    zuletzt = await spielerZustand()
    if (titelAus(zuletzt)) return zuletzt
    await new Promise((f) => setTimeout(f, 700))
  }
  return zuletzt
}

/**
 * Auf den Quellknoten WARTEN, statt einmal nachzusehen.
 *
 * HIER STAND EIN EINZIGER BLICK, und der ging regelmaessig daneben: das
 * Ereignis „Wiedergabe gestartet" faellt, sobald der Abspieldienst den Befehl
 * bestaetigt hat — librespot verbindet sich danach erst, und der Knoten
 * `alsa_playback.librespot` entsteht ERST, wenn wirklich Ton fliesst. Wer in
 * dem Moment nachsieht, findet nichts und schliesst daraus, es spiele nichts.
 * Gemessen am Geraet (16.08.2026): eine FLAC-Datei mit korrektem Namen und
 * 0 kB Inhalt.
 *
 * Der Anlauf sieht aus wie ein Zustand. Also mehrmals hinsehen.
 */
async function aufKnotenWarten(hoechstensMs = 15_000) {
  const bis = Date.now() + hoechstensMs
  for (;;) {
    const roh = await laufen('pw-cli', ['ls', 'Node'])
    // BEIDE Tonmaschinen (E42): librespots Knoten heisst
    // `alsa_playback.librespot`, Soloists schlicht `spotify` (gemessen
    // 19.08.2026). Zuerst der speziellere Name, damit ein Knoten, der beide
    // Woerter truege, nicht doppelt zaehlt.
    const knoten = knotenSuchen(roh, 'librespot') ?? knotenSuchen(roh, 'spotify')
    if (knoten) return knoten
    if (Date.now() >= bis) return null
    await new Promise((f) => setTimeout(f, 700))
  }
}

async function abgriffHerstellen(protokoll) {
  // Der Knoten ist nur da, WAEHREND gespielt wird — hoert Spotify auf,
  // verschwindet er. Am Geraet gesehen: nach dem Anhalten meldet `pw-cli`
  // null Treffer, und ein `pw-link` darauf sagt "No such file or directory".
  const knoten = await aufKnotenWarten()
  if (!knoten) {
    // DIE MELDUNG NENNT DIE NAMEN, NACH DENEN GESUCHT WURDE. Die alte hiess
    // „der librespot-Knoten kam nicht (spielt gerade nichts?)" — sie nannte
    // eine Maschine, die auf dieser Box gar nicht laeuft, und behauptete in
    // der Klammer etwas Falsches: es spielte sehr wohl. Wer eine Suche meldet,
    // die nichts fand, muss sagen, WONACH er gesucht hat.
    return { ok: false, grund: `kein Tonknoten gefunden (gesucht nach: ${MASCHINEN_KNOTEN.join(', ')})` }
  }

  // Was pw-record sich selbst ausgesucht hat, muss zuerst weg — sonst laeuft
  // der Monitor MIT in dieselbe Datei, und die Ansagen sind wieder drin.
  const verbindungen = await laufen('pw-link', ['-l'])
  let ziel = null
  for (const zeile of verbindungen.split('\n')) {
    if (zeile.startsWith(`${EIGENNAME}:input_`)) ziel = zeile.trim()
    else if (ziel && zeile.trim().startsWith('|<-')) {
      await laufen('pw-link', ['-d', zeile.trim().slice(3).trim(), ziel])
    }
  }

  for (const kanal of ['FL', 'FR']) {
    await laufen('pw-link', [`${knoten.name}:output_${kanal}`, `${EIGENNAME}:input_${kanal}`])
  }

  // GEGENPROBE STATT HOFFNUNG: nachsehen, woran es jetzt wirklich haengt.
  const danach = await laufen('pw-link', ['-l'])
  const haengtRichtig = danach.includes(knoten.name)
  if (!haengtRichtig) return { ok: false, grund: 'die Verlinkung auf den Quellknoten hat nicht gehalten' }
  protokoll(`Abgriff steht an ${knoten.name} (id ${knoten.id})`)
  return { ok: true, knoten }
}


/**
 * Reste eines abgebrochenen Laufs wegraeumen.
 *
 * WOZU: wird der Worker abgeraeumt (Frist ueberschritten, Einstellungen
 * geaendert, Absturz), verschwindet der Zustand hier oben — `pw-record` aber
 * nicht. Es schreibt weiter in eine Datei, die niemand mehr kennt, und haelt
 * dabei den Abgriff besetzt. Beim naechsten Start liegt dann eine fremde
 * Rohdatei herum und ein zweiter Aufnehmer im Weg.
 *
 * Dieselbe Vorsorge wie `cleanup_stale_isolation` im SpotifyRecorder.
 *
 * `pkill -x` UND der eigene Name: `-f` traefe auch andere Prozesse, in deren
 * Befehlszeile der Name nur vorkommt — im Zweifel die eigene Shell.
 */
async function resteRaeumen(protokoll) {
  // Nur was WIRKLICH unseres ist: pw-record, das unter unserem node.name lief.
  const roh = await laufenMitFehler('pgrep', ['-x', 'pw-record'], 8000)
  const pids = roh.split('\n').map((z) => z.trim()).filter((z) => /^\d+$/.test(z))
  let getroffen = 0
  for (const pid of pids) {
    // Die Befehlszeile lesen und nur die eigenen treffen. In /proc stehen die
    // Teile durch Nullbytes getrennt; fuer ein `includes` genuegt das.
    const befehl = await laufenMitFehler('cat', [`/proc/${pid}/cmdline`], 5000)
    if (befehl.includes(EIGENNAME)) {
      await laufenMitFehler('kill', ['-TERM', pid], 5000)
      getroffen += 1
    }
  }
  if (getroffen) protokoll(`${getroffen} verwaiste Aufnahme(n) eines fruheren Laufs beendet`)
}

async function starten(einstellungen, protokoll) {
  if (lauf.prozess) return
  await resteRaeumen(protokoll).catch(() => {})
  const ordner = String(einstellungen.ablage || '/home/dietpi/mitschnitt').trim()
  await mkdir(ordner, { recursive: true })
  lauf.ordner = ordner
  lauf.kategorie = String(einstellungen.kategorie || 'music').trim() || 'music'

  // DIE PLATTE GEGEN DIE LISTE HALTEN, bevor irgendetwas vorgemerkt wird
  // (Regel 1 aus liste.mjs). Hier und nicht im Leerlauf, weil hier der
  // Medienordner feststeht — und weil ein Abgleich vor dem ersten Vormerken
  // verhindert, dass ein laengst vorhandener Titel neu in die Liste rutscht.
  await listeAbgleichen(ordner, protokoll).catch(() => {})

  // DIE ROHDATEI, nicht der Mitschnitt. Sie heisst mit fuehrendem Punkt, damit
  // sie im Ordner nicht wie ein fertiges Stueck aussieht, und sie verschwindet,
  // sobald das letzte Stueck herausgeschnitten ist.
  //
  // BEVORZUGT IM ARBEITSSPEICHER: sie ist Durchgangsmaterial und der groesste
  // Posten auf der Karte. Siehe den Block bei SPEICHER_ORT.
  const wahl = rohOrtWaehlen(await freiMb(SPEICHER_ORT), ordner)
  const datei = join(wahl.ort, `.roh-${stempelJetzt()}.wav`)
  lauf.rohImSpeicher = wahl.imSpeicher
  protokoll(
    wahl.imSpeicher
      ? `Rohdatei im Arbeitsspeicher (${wahl.grund}) — die Karte traegt nur die fertigen Stuecke`
      : `Rohdatei auf der Karte: ${wahl.grund}`,
  )

  // Der eigene node.name ist kein Schmuck: ohne ihn heisst dieser Mitschnitt
  // `pw-record:input_FL` wie jeder andere, und das Umhaengen unten traefe
  // moeglicherweise den falschen.
  const p = spawn('pw-record', ['-P', `{ node.name = "${EIGENNAME}" }`, '--rate', String(ROH.rate), datei], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: pwUmgebung(),
  })
  lauf.prozess = p
  lauf.datei = datei
  lauf.seit = Date.now()
  lauf.letzterFehler = null

  let meckern = ''
  p.stderr?.on('data', (s) => (meckern += String(s)))
  p.on('exit', (code) => {
    if (code && code !== 0 && meckern) lauf.letzterFehler = meckern.split('\n')[0]
    lauf.prozess = null
  })

  // Kurz warten, bis die Ports in der Graphik stehen — vorher findet
  // `pw-link` sie nicht.
  await new Promise((f) => setTimeout(f, 1200))
  const abgriff = await abgriffHerstellen(protokoll)
  if (!abgriff.ok) {
    protokoll(`Mitschnitt abgebrochen: ${abgriff.grund}`)
    await beenden(protokoll, abgriff.grund)
    return
  }
  lauf.quelle = abgriff.knoten.name

  // DIE NOTBREMSE. Wird ein Ende nie gemeldet — abgestuerzter Spieler,
  // verpasstes Ereignis —, liefe die Aufnahme sonst, bis die Karte voll ist.
  const minuten = Number(einstellungen.hoechstensMinuten) || 90
  lauf.notbremse = setTimeout(
    () => {
      protokoll(`Notbremse nach ${minuten} min — der Mitschnitt wird beendet`)
      beenden(protokoll, 'Notbremse')
    },
    Math.max(1, minuten) * 60_000,
  )
  lauf.notbremse.unref?.()

  // Der erste Titel — ab Sekunde 0 der Rohdatei.
  //
  // Meldet der Spieler noch nichts (der Anlauf dauert), wird KEIN leerer
  // Titel gemerkt: sonst steht im Journal "uebersprungen (nur 6 s): ohne
  // Titel", und der erste echte Titel begaenne erst danach. Bleibt es null,
  // uebernimmt ihn der erste Takt — mit `istNeuerTitel(null, …) === true`.
  lauf.titel = titelAus(await spielerZustand())
  lauf.titelAbSek = 0
  lauf.abgelegt = 0

  // AB HIER LAEUFT DIE STUECKELUNG. Der Takt sieht nach, ob ein anderer Titel
  // spielt; die Rohaufnahme laeuft dabei durch.
  lauf.takt = setInterval(() => {
    nachsehen(protokoll).catch((f) => protokoll(`Takt: ${f.message}`))
  }, TAKT_MS)
  lauf.takt.unref?.()

  protokoll(
    `schneidet mit, stueckelt je Titel${lauf.titel ? ` (zuerst: ${lauf.titel.name})` : ''} — roh nach ${datei}`,
  )
}

async function beenden(protokoll, grund = '') {
  if (lauf.notbremse) clearTimeout(lauf.notbremse)
  lauf.notbremse = null
  if (lauf.takt) clearInterval(lauf.takt)
  lauf.takt = null

  const p = lauf.prozess
  const datei = lauf.datei
  if (!p) {
    lauf.datei = null
    lauf.quelle = null
    lauf.titel = null
    return
  }
  // SIGTERM, nicht SIGKILL: die Datei muss noch sauber geschlossen werden. Am
  // Geraet gesehen, was sonst bleibt — ein Dateikopf und nichts dahinter.
  p.kill('SIGTERM')
  await new Promise((f) => setTimeout(f, 1500))
  if (lauf.prozess) lauf.prozess.kill('SIGKILL')
  lauf.prozess = null
  lauf.quelle = null

  let groesse = 0
  try {
    groesse = (await stat(datei)).size
  } catch {
    /* die Datei kann fehlen, wenn der Abgriff nie stand */
  }
  const sek = Math.round((Date.now() - lauf.seit) / 1000)

  // DER LETZTE TITEL. Er endet nicht durch einen Wechsel, sondern durch das
  // Anhalten — ohne diesen Schnitt fehlte genau das Stueck, das gerade lief.
  if (groesse >= LEER_UNTER_BYTES && lauf.titel) {
    try {
      await abschnittAblegen(lauf.titel, lauf.titelAbSek, versatzAusGroesse(groesse), protokoll)
    } catch (f) {
      protokoll(`letztes Stueck nicht abgelegt: ${f.message}`)
    }
  }
  lauf.titel = null

  // DIE ROHDATEI GEHT IMMER WEG. Sie ist Werkzeug, nicht Ergebnis — und mit
  // 660 MB je Stunde das Groesste, was hier liegt. Bliebe sie liegen, liefe
  // die Karte nach ein paar Abenden voll.
  try {
    await rm(datei)
  } catch {
    protokoll(`die Rohdatei liess sich nicht entfernen: ${datei}`)
  }

  if (groesse < LEER_UNTER_BYTES) {
    // Der Abgriff stand nie. Es ist NICHTS abzulegen — und vor allem bleibt
    // auch nichts liegen, was vollstaendig aussieht (E28/N4).
    protokoll(`nichts aufgenommen (${groesse} B) — nichts abgelegt`)
    lauf.datei = null
    return
  }

  protokoll(
    `Mitschnitt beendet${grund ? ` (${grund})` : ''}: ${sek} s roh, ${lauf.abgelegt} Stueck abgelegt`,
  )
  await marken_abraeumen(protokoll)
  lauf.datei = null
}

/**
 * Die „hier fehlt noch etwas"-Marken dieses Laufs wieder abraeumen (E89).
 *
 * ══ DASS DAS HIER STEHT, IST DER GANZE WITZ ════════════════════════════════
 * Diese Zeile laeuft NUR, wenn der Mitschnitt geordnet zu Ende kommt. Wird
 * der Prozess getoetet, faellt der Strom aus oder stirbt der Worker an der
 * 8-s-Frist, dann laeuft sie nicht — und die Marke bleibt stehen. Genau so
 * soll es sein: der Abbruch ist der Fall, auf den es ankommt, und er kann
 * sich nicht selbst melden.
 *
 * SIE WIRFT NICHT. Ein fehlgeschlagenes Abraeumen darf den Lauf nicht
 * nachtraeglich zum Fehlschlag machen — im schlimmsten Fall traegt eine
 * Kachel eine Marke zu viel, und das ist die harmlose Richtung.
 */
async function marken_abraeumen(protokoll) {
  if (!lauf.markiert.size) return
  const schluessel = [...lauf.markiert]
  lauf.markiert.clear()
  let frei = 0
  for (const s of schluessel) {
    try {
      const a = await serverSchicken(`/api/medien/${encodeURIComponent(s)}`, 'PATCH', { unvollstaendig: false })
      if (a.status >= 200 && a.status < 300) frei += 1
    } catch {
      /* siehe oben: eine Marke zu viel ist die harmlose Richtung */
    }
  }
  if (frei) protokoll(`${frei} Kachel(n) als vollstaendig freigegeben`)
}

/* ══ DER LEERLAUF-ARBEITER (E66) ═══════════════════════════════════════════
 *
 * Bis hierher war der Mitschnitt ein PASSIVER ABGRIFF: er hoert mit, was die
 * Familie spielt. Der Arbeiter dreht das um — er spielt SELBST, mit eigenem
 * Zugang, in eine Senke, die niemand hoert, und nimmt dabei auf.
 *
 * ══ WARUM DAS EINFACHER IST ALS DER PASSIVE WEG ════════════════════════════
 *
 * Kein Schneiden. Der passive Weg nimmt einen langen Rohstrom auf und schneidet
 * daraus Stuecke — mit Knacksersuche, Stillefindung und einer 97-%-Schaetzung
 * darueber, ob ein Titel ganz ist. Hier laeuft je Titel EIN Prozess, der sich
 * am Ende des Stuecks selbst beendet: `pw-record` schreibt direkt die fertige
 * FLAC-Datei, und der Rueckgabewert von Soloist ist das harte Signal.
 *
 * ══ DIE REGEL, DIE DIE INVESTITION SCHUETZT ════════════════════════════════
 *
 * Aufgenommen wird unter einem ZWISCHENNAMEN, und erst ein VOLLSTAENDIGER Lauf
 * benennt ihn um. Ein Abbruch laesst nichts liegen, was vollstaendig aussieht —
 * denn ein halbes Hoerspiel ist kein Puffer, sondern ein Versprechen, das
 * bricht (E28). Und die Liste erfaehrt den Ausgang, damit ein Titel nicht
 * ewig wiederkehrt und auch nicht still verschwindet.
 */

/** Wie oft im Leerlauf nachgesehen wird, ob etwas zu tun ist. */
const LEERLAUF_TAKT_MS = 30_000

/**
 * Wie oft ein laufender Mitschnitt fragt, ob er seinen Strom noch hat (E74/4).
 *
 * FUENF SEKUNDEN sind der Preis fuers Warten: so lange steht ein Kind
 * schlimmstenfalls vor einer stummen Box, bis der Mitschnitt den Strom
 * hergibt. Haeufiger zu fragen kostet Anfragen fuer nichts — die Aufnahme
 * dauert Minuten, und niemand tippt zweimal in derselben Sekunde.
 */
const PULS_MS = 5_000

/**
 * Wie viele Mitschnitte hoechstens gleichzeitig laufen (E74/3).
 *
 * NICHT DIE VERGABE ENTSCHEIDET DAS ALLEIN — sie zaehlt Zugaenge, dieser Riegel
 * zaehlt Speicher. Am Geraet gemessen (21.08.2026) wiegt ein Soloist rund
 * 69 MB (49 MB Hauptprozess plus 20 MB Helfer); die Box hat 2 GB gesamt und
 * gut 1,1 GB frei. Drei gleichzeitig sind gut 200 MB und lassen Luft; fuenf
 * waeren 350 MB und damit dichter am Rand, als eine Box sein sollte, auf der
 * nebenher Kinder hoeren.
 */
const HOECHSTENS_PARALLEL = 3

/** Notbremse je Titel. Laenger als das ist kein Stueck, sondern ein Haenger. */
const LAUF_HOECHSTENS_MS = 15 * 60_000

/** Der Aufnahmeknoten des Arbeiters — NICHT derselbe wie beim passiven Abgriff. */
/**
 * Der Name des Mitschneider-Knotens — JE STROM VERSCHIEDEN (E74/3).
 *
 * Er stand bis zum 22.08.2026 fest: `mixpi-mitschnitt-arbeiter`. Das ging, so
 * lange genau ein Lauf zur Zeit erlaubt war. Sobald zwei parallel schneiden,
 * traegen beide `pw-record`-Knoten denselben Namen — und `pw-link` haenge den
 * Ton des einen Spielers an den Mitschneider des anderen, je nachdem, welchen
 * PipeWire zuerst findet. Zwei Aufnahmen, beide falsch, und keine meldet etwas.
 *
 * Die Stromnummer ist die Identitaet und taugt deshalb auch hier.
 */
function arbeiterName(nr) {
  return `mixpi-mitschnitt-arbeiter-${nr}`
}

const arbeit = {
  takt: null,
  /** Ein DURCHGANG bereitet gerade vor. Riegelt nicht die Aufnahmen ab. */
  laeuft: false,
  /** Die laufenden Aufnahmen (E74/3). Ihre Zahl ist der Riegel, nicht `laeuft`. */
  jobs: new Set(),
  grund: 'noch nicht nachgesehen',
  zuletzt: 0,
  gleicheFehler: 0,
  letzterFehlgrund: '',
}

/**
 * Die Stroeme — aus dem KONTEXT, nicht ueber HTTP.
 *
 * HIER STAND EIN `GET /api/stroeme`, und das konnte nie funktionieren: die
 * Route gibt den Zugang bewusst NIE heraus (dort holt sie die
 * Browser-Verwaltung). Das Plugin bekam also Stroeme ohne Schluessel und
 * meldete geduldig „Strom 2 hat keinen Zugang" — obwohl einer eingetragen war.
 * Zwei richtige Entscheidungen, die sich widersprachen.
 *
 * DER WEG FUEHRT UEBER DAS RECHT `aufnahme`: der Plugin-Wirt reicht die
 * Stroeme MIT Zugaengen in `kontext.stroeme`, aber nur an Plugins, die das
 * Recht im Manifest stehen haben. Die Route bleibt verschlossen, und wer
 * aufnehmen soll, bekommt, was das Aufnehmen braucht.
 *
 * `null` HEISST „NICHT ZU ERFAHREN", nicht „keine": ohne das Recht gibt es das
 * Feld gar nicht, und `wasJetzt` soll dann seinen eigenen Grund nennen statt
 * einer erfundenen leeren Aufstellung.
 */
function stroemeAusKontext() {
  return Array.isArray(kontextStroeme) && kontextStroeme.length > 0 ? { stroeme: kontextStroeme } : null
}

/** Was der Wirt an Stroemen hereingereicht hat — je Ereignis aufgefrischt. */
let kontextStroeme = null

/**
 * Auf den Knoten DIESES Prozesses warten.
 *
 * Ueber die Prozesskennung, nicht ueber den Namen — zwei Soloist-Instanzen
 * heissen beide `spotify` (Falle 1). Und ueber `pw-dump`, weil `pw-cli ls
 * Node` die Kennung gar nicht ausgibt (am 21.08.2026 gemessen).
 */
async function knotenDesLaufsSuchen(pid, hoechstensMs = 20_000) {
  const bis = Date.now() + hoechstensMs
  while (Date.now() < bis) {
    // DER GANZE PROZESSBAUM, NICHT NUR DER GESTARTETE. Soloist spaltet Kinder
    // ab (unter anderem einen Absturzsammler), und welcher davon den Ton
    // fuehrt, ist nicht zugesichert. `pgrep -P` fragt nach Kindern; die
    // gestartete Kennung bleibt immer dabei.
    const kinder = await laufen('pgrep', ['-P', String(pid)], 4000)
    const kennungen = [pid, ...String(kinder).split('\n').map((z) => Number(z.trim())).filter(Boolean)]
    const roh = await laufen('pw-dump', [], 8000)
    const knoten = knotenFuerPid(roh, kennungen)
    if (knoten) return knoten
    await new Promise((f) => setTimeout(f, 500))
  }
  return null
}

/**
 * EINEN Titel aufnehmen. Gibt `{ fertig, grund }`.
 *
 * Der Ablauf ist bewusst laenglich, weil jeder Schritt zurueckgenommen werden
 * muss, wenn der naechste scheitert — sonst bleiben Prozesse und halbe Dateien
 * liegen.
 */
async function einenAufnehmen(auftrag, einstellungen, protokoll, marke = null) {
  const { eintrag, strom } = auftrag
  const knotenName = arbeiterName(strom.nr)
  // WER AUFZEICHNET, GEHOERT SICHTBAR (Betreiber, 04.09.2026: „ergaenzt
  // soll auch werden wer aufzeichnet"). Der Wirt teilt IRGENDEINEN freien
  // Strom zu — welchen, war bisher nur im Protokoll zu erraten. Die Zahl
  // steht am Lauf, damit `http/liste` sie mitgeben kann.
  lauf.stromNr = strom.nr
  const basis = String(einstellungen.ablage || MEDIEN_BASIS).trim() || MEDIEN_BASIS
  const kategorie = String(einstellungen.kategorie || 'music').trim() || 'music'
  const kuenstler = eintrag.albumInterpret || eintrag.interpret
  const ordner = albumOrdner(kategorie, kuenstler, eintrag.album, basis)
  const ziel = join(ordner, spurname(eintrag.nummer, eintrag.titel))

  // DIE PLATTE IST DIE WAHRHEIT. Noch einmal nachsehen, bevor Netz und Strom
  // ausgegeben werden — zwischen dem Abgleich und diesem Augenblick kann der
  // passive Weg denselben Titel abgelegt haben.
  if (existsSync(ziel)) return { fertig: true, grund: 'lag schon da' }

  /* JEDER STROM BRAUCHT SEINEN EIGENEN DATENORDNER.
   *
   * Zwei Soloist-Instanzen im selben Ordner treten sich auf die Anmeldung —
   * und die Anmeldung ist genau das, was `--single-track` verlangt:
   *
   *     --single-track requires stored credentials — run with --pair first
   *
   * ABGELEITET AUS DER NUMMER, nicht konfiguriert. Die Nummer IST die
   * Identitaet des Stroms; ein zusaetzliches Feld waere eine zweite Wahrheit,
   * die man falsch setzen kann. Strom 1 ist der Dienst und bringt seinen
   * Ordner von systemd mit (StateDirectory) — hier geht es nur um die
   * kurzlebigen Aufnahmelaeufe ab Strom 2.
   */
  const args = aufnahmeArgumente({
    name: `${einstellungen.boxname || 'MixPiBox'} Stream ${strom.nr}`,
    schluessel: strom.schluessel,
    uri: eintrag.uri,
    // AUS DEM AUFTRAG, NICHT AUS DEM STROM (E74): seit die Vergabe irgendeinen
    // freien Strom zuteilt, traegt dessen `senke` das Ziel fuers HOEREN — bei
    // Strom 1 ist das leer, also der Familienlautsprecher. Ein Mitschnitt geht
    // immer in die Leersenke, gleich welchen Strom er bekommen hat.
    senke: auftrag.senke,
    datenOrdner: strom.datenOrdner || `/var/lib/mixpi-strom-${strom.nr}`,
    cacheOrdner: strom.cacheOrdner || `/var/cache/mixpi-strom-${strom.nr}`,
  })
  if (!args) {
    // Das faengt vor allem die fehlende Senke ab (Falle 2). Lieber gar nicht
    // aufnehmen als der Familie in den Lautsprecher spielen.
    return { fertig: false, grund: 'kein vollstaendiger Aufnahmebefehl (fehlt die Senke?)' }
  }

  await mkdir(ordner, { recursive: true })
  // ZWISCHENNAME MIT FUEHRENDEM PUNKT: Wer in den Ordner sieht, waehrend es
  // laeuft, soll die halbe Datei nicht fuer ein Stueck halten. Und der
  // Abspieldienst listet sie nicht.
  const zwischen = join(ordner, `.${saeubern(eintrag.titel) || 'aufnahme'}.teil.flac`)
  await rm(zwischen, { force: true }).catch(() => {})

  protokoll(`nimmt auf: "${eintrag.titel}" — ${befehlZumZeigen(args)}`)

  let aufnahme = null
  let spieler = null
  try {
    // 1. ERST DER SPIELER, DANN DER MITSCHNEIDER. Andersherum liefe der
    //    Mitschneider ins Leere und schriebe Stille an den Anfang.
    spieler = spawn('/usr/local/bin/soloist', args, { stdio: ['ignore', 'pipe', 'pipe'], env: pwUmgebung() })
    let gesagt = ''
    spieler.stdout?.on('data', (s) => (gesagt += String(s)))
    spieler.stderr?.on('data', (s) => (gesagt += String(s)))

    const knoten = await knotenDesLaufsSuchen(spieler.pid)
    if (!knoten) {
      /* SOLOIST SAGT DEN GRUND — ER WURDE NUR NICHT GELESEN.
       *
       * Hier stand bloss „der Knoten des Aufnahmelaufs kam nicht". Am Geraet
       * (21.08.2026) schrieb Soloist im selben Augenblick daneben:
       *
       *     --single-track requires stored credentials — run with --pair first
       *
       * Der Strom war nie gekoppelt. Der Arbeiter verbrauchte drei Anlaeufe an
       * einer Sache, die in seiner eigenen Ausgabe im Klartext stand — und
       * meldete dabei etwas, das nach einem Tonproblem klang.
       *
       * WER EINE URSACHE ZUR HAND HAT, DARF NICHT SEINE VERMUTUNG MELDEN.
       */
      const erste = gesagt
        .split('\n')
        .map((z) => z.trim())
        .filter((z) => z && !/^\d{4}-\d\d-\d\d .*: soloist \d/.test(z))
        .pop()
      return {
        fertig: false,
        grund: erste ? `Soloist: ${erste.replace(/^\d{4}-\d\d-\d\d [\d:.]+: /, '')}` : 'der Knoten des Aufnahmelaufs kam nicht',
      }
    }

    // 2. `pw-record` schreibt DIREKT FLAC, wenn die Datei so heisst — auf
    //    dieser Box gibt es kein ffmpeg, und es braucht auch keins.
    /* ── DER ABGRIFF GEHOERT AN DEN EIGENEN STROM ───────────────────────────
     *
     * HIER LAG DER FEHLER, DER AM 22.08.2026 VIER MITSCHNITTE STILL GEMACHT
     * HAT — und zwei weitere zur Haelfte mit der FAMILIENWIEDERGABE fuellte,
     * ohne dass es jemand sah.
     *
     * Es waren zwei Fehler, die einander gedeckt haben:
     *
     *  1. `pw-record` lief OHNE `--target`. Dann sucht es sich die
     *     Standardquelle SELBST — und die ist auf dieser Box der
     *     LAUTSPRECHER-MONITOR. AM GERAET VORGEFUEHRT (23.08.2026):
     *         ohne --target  ->  |<- alsa_output…stereo-fallback:monitor_FL
     *     Aufgenommen wurde also, was die Familie gerade hoerte. Solange
     *     jemand hoerte, sah die Datei gesund aus; als niemand mehr hoerte,
     *     war sie digitale Null — bei VOLLER Laufzeit, weil Soloist im
     *     Hintergrund brav weiterspielte.
     *
     *  2. Der `pw-link` dahinter sprach den Quellknoten ueber den NAMEN an.
     *     Beide Soloist-Instanzen heissen `spotify`. Die saubere Aufloesung
     *     ueber die Prozesskennung (arbeiter.mjs, `knotenFuerPid`) wurde
     *     GENAU HIER weggeworfen. Nachts, wenn nur EIN Soloist lief, war der
     *     Name eindeutig und alle 31 Aufnahmen wurden gut — deshalb fiel es
     *     monatelang nicht auf.
     *
     * `--target <object.serial>` erledigt beides in einem Zug: es ist
     * eindeutig (die Seriennummer wird nie doppelt vergeben), und ein
     * gesetztes Ziel verhindert, dass sich der Mitschneider selbst etwas
     * aussucht. Der `pw-link` entfaellt damit ersatzlos.
     *
     * Fehlt die Seriennummer, wird NICHT AUFGENOMMEN. Ein Mitschnitt ohne
     * gesicherten Abgriff ist genau das, was diesen Fehler ausgemacht hat:
     * er sieht aus wie einer.
     */
    const mitschnittArgs = mitschnittArgumente({
      knotenName,
      serial: knoten.serial,
      rate: ROH.rate,
      ziel: zwischen,
    })
    if (!mitschnittArgs) {
      return { fertig: false, grund: 'der Aufnahmestrom hat keine Seriennummer — ohne sie ist der Abgriff nicht eindeutig' }
    }
    aufnahme = spawn('pw-record', mitschnittArgs, { stdio: ['ignore', 'ignore', 'pipe'], env: pwUmgebung() })
    await new Promise((f) => setTimeout(f, 1200))

    // GEGENPROBE STATT HOFFNUNG — dieselbe, die der passive Weg seit jeher
    // hat (siehe `abgriffHerstellen`). Sie fehlte hier, und `laufen()`
    // verschluckt jeden Fehler zu '': ein misslungener Abgriff war unsichtbar.
    const haengtAn = await laufen('pw-link', ['-l'])
    let amEigenen = false
    let beiUns = false
    for (const zeile of haengtAn.split('\n')) {
      if (zeile.startsWith(`${knotenName}:input_`)) beiUns = true
      else if (!zeile.startsWith('  ') && !zeile.startsWith('\t') && zeile.trim() && !zeile.trim().startsWith('|')) beiUns = false
      else if (beiUns && zeile.trim().startsWith('|<-') && zeile.includes(`${knoten.name}:`)) amEigenen = true
    }
    if (!amEigenen) {
      return { fertig: false, grund: `der Abgriff haengt nicht am eigenen Strom (${knoten.name}, Serie ${knoten.serial})` }
    }
    protokoll(`Abgriff steht an ${knoten.name} (id ${knoten.id}, Serie ${knoten.serial})`)

    /* 3. WARTEN — auf DREI Dinge, nicht auf eines.
     *
     * Der Spieler geht von selbst (das harte Signal), die Frist laeuft ab —
     * ODER DER STROM WIRD GEBRAUCHT. Letzteres ist die Verdraengung aus E74/4:
     * Hoeren hat Vorrang, und ein Kind soll nicht warten, bis ein Hoerspielteil
     * zu Ende aufgenommen ist.
     *
     * GEFRAGT WIRD, NICHT ABGESCHOSSEN. Der Wirt nimmt dem Verdraengten den
     * Eintrag weg; das Lebenszeichen kommt dann mit `ok: false` zurueck, und
     * der Arbeiter hoert von selbst auf. Ein Weg, auf dem niemand einen fremden
     * Prozess toeten muss — und der auch dann greift, wenn die Verdraengung von
     * einer ganz anderen Stelle ausgeloest wurde.
     *
     * DIE HALBE DATEI IST VERLOREN, und das ist in Ordnung: sie wird erst bei
     * Erfolg umbenannt, der Titel bleibt in der Liste offen stehen, und beim
     * naechsten freien Strom faengt er von vorn an.
     */
    const ausgang = await new Promise((fertig) => {
      const wecker = setTimeout(() => fertig({ frist: true }), LAUF_HOECHSTENS_MS)
      const puls =
        marke === null
          ? null
          : setInterval(async () => {
              if (await stromNochDa(marke)) return
              clearTimeout(wecker)
              clearInterval(puls)
              fertig({ verdraengt: true })
            }, PULS_MS)
      puls?.unref?.()
      spieler.on('exit', (code, signal) => {
        clearTimeout(wecker)
        if (puls) clearInterval(puls)
        fertig({ code, signal })
      })
    })
    if (ausgang.verdraengt) {
      return { fertig: false, verdraengt: true, grund: 'der Strom wurde fuers Hoeren gebraucht' }
    }
    const urteil = laufDeuten({ ...ausgang, ausgabe: gesagt })

    // 4. Erst jetzt den Mitschneider anhalten — sonst fehlt das Ende.
    aufnahme.kill('SIGTERM')
    await new Promise((f) => setTimeout(f, 1200))

    if (!urteil.fertig) return urteil

    const gross = await stat(zwischen).then((s) => s.size).catch(() => 0)

    /* ── DIE BYTE-GRENZE ALLEIN FAENGT STILLE NICHT ─────────────────────────
     *
     * NACHGERECHNET AN DEN VIER FUNDSTUECKEN vom 22.08.2026: eine digital
     * stille FLAC wiegt 177 B/s (30902/175, 10850/61, 15695/89, 31640/179 —
     * alle vier derselbe Wert). LEER_UNTER_BYTES sind 10 000 B; die Grenze
     * faellt damit bei 56,5 Sekunden. ALLES AB ~57 SEKUNDEN STILLE RUTSCHT
     * DURCH. Die kleinste der vier lag 8 % darueber und galt als fertig.
     *
     * Eine Groessenpruefung misst die Kompressibilitaet, nicht den Ton. Den
     * Ton misst `pegelMessen`/`urteil` — die gab es hier laengst, aber NUR im
     * passiven Weg. Der Arbeiter hat sie nie gerufen.
     *
     * ES IST DIE KACHEL, DIE ZAEHLT: eine fehlende ist besser als eine, die
     * nicht spielt. Ein Kind, das auf ein Bild drueckt und nichts hoert, kann
     * nicht wissen, ob es falsch gedrueckt hat.
     */
    const { spitze, mittel } = await pegelMessen(zwischen)
    const dauerSek = await dauerVon(zwischen)
    const befund = annahmeUrteil({ gross, spitze, mittel, dauerSek })
    if (!befund.ok) {
      protokoll(`VERWORFEN (${befund.wort ?? 'zu klein'}): ${zwischen} — Spitze ${spitze} dB, Mittel ${mittel} dB, ${dauerSek} s`)
      await rm(zwischen, { force: true }).catch(() => {})
      return { fertig: false, grund: befund.grund }
    }

    /* 5. TAGS UND BILD — WAS DER LIVE-WEG IMMER TAT UND DIESER NIE (E135/1c).
     *
     * `pw-record` schreibt reinen Ton. Bis zum 10.09.2026 wurde die Datei
     * danach nur UMBENANNT: keine Tags, kein eingebettetes Bild, keine
     * Ordner-cover.jpg. Am Geraet gemessen (07.09.2026, alle 69 Alben): 42
     * ohne jedes Bild, alle in Nachtstunden entstanden — das ist genau dieser
     * Weg, der nachts im Leerlauf arbeitet.
     *
     * ES SCHEITERT WEICH. Misslingt das Veredeln, wird die rohe Aufnahme
     * trotzdem abgelegt: eine Datei ohne Tags ist ein kleiner Makel, eine
     * verlorene Aufnahme waere der grosse. Der Ton ist an dieser Stelle schon
     * gemessen und fuer gut befunden.
     */
    const mitBild = await kanonischesNachschlagen(
      { uri: eintrag.uri, name: eintrag.titel, kuenstler: eintrag.interpret, album: eintrag.album,
        albumKuenstler: eintrag.albumInterpret, nummer: eintrag.nummer, bild: eintrag.bild || '' },
      protokoll,
    )
    const bildDatei = await coverHolen(mitBild, protokoll, ordner)
    const veredelt = join(ordner, `.${saeubern(eintrag.titel) || 'aufnahme'}.fertig.flac`)
    /* NICHT `args` — DIESER NAME HAT DEN GANZEN WEG TOTGELEGT (20.09.2026).
     *
     * Hier stand `const args`. Er liegt im SELBEN Block wie der Start des
     * Spielers dreihundert Zeilen weiter oben — und eine `const` verdeckt den
     * aeusseren Namen vom BLOCKANFANG an, nicht erst ab ihrer Zeile. Der
     * `spawn('/usr/local/bin/soloist', args, …)` traf damit nicht mehr die
     * Aufnahmeargumente, sondern die Todeszone dieser Deklaration:
     *
     *     Cannot access 'args' before initialization
     *
     * Gefangen hat es der `catch` ganz unten, der jeden Fehler zum `grund`
     * eines gescheiterten Titels macht — es sah zehn Tage lang aus wie ein
     * Aufnahmeproblem. Jeder vorgemerkte Titel verbrauchte daran seine drei
     * Anlaeufe. Eingeschleppt mit 60d39e58 (10.09.2026), ausgeliefert.
     *
     * EIN EIGENER NAME JE ARGUMENTLISTE, auch wenn die aeussere weit weg ist.
     * `tools/tdz-schatten-schau.mjs` haelt die Sorte seither fern.
     */
    const veredelungsArgs = veredelungsArgumente({
      quelle: zwischen,
      ziel: veredelt,
      bild: bildDatei,
      // DIESELBEN SCHLUESSEL WIE IM LIVE-WEG. Weichen sie ab, tragen zwei
      // Aufnahmen desselben Albums verschiedene Merkmale — und keine
      // Musikverwaltung legt sie mehr zusammen.
      tags: {
        title: mitBild.name, artist: mitBild.kuenstler, album: mitBild.album,
        track: mitBild.nummer ? String(mitBild.nummer) : '',
        comment: eintrag.uri || '',
        MIXPI_VOLLSTAENDIG: '100%',
      },
    })
    let abgelegt = zwischen
    if (veredelungsArgs) {
      try {
        await laufen('ffmpeg', veredelungsArgs, 120_000)
        if ((await stat(veredelt).then((s) => s.size).catch(() => 0)) > LEER_UNTER_BYTES) {
          await rm(zwischen, { force: true }).catch(() => {})
          abgelegt = veredelt
        } else {
          protokoll('Veredeln ergab nichts Brauchbares — die rohe Aufnahme gilt')
          await rm(veredelt, { force: true }).catch(() => {})
        }
      } catch (f) {
        protokoll(`Tags/Bild nicht geschrieben (${f.message}) — die rohe Aufnahme gilt`)
        await rm(veredelt, { force: true }).catch(() => {})
      }
    }
    // DIE SICHTBARE cover.jpg. Sie ist es, die in den Medienordner gehoert:
    // der Abspieldienst liest kein Bild aus einer FLAC (Begruendung bei
    // `coverKlein`), und der m3u-Generator legt sonst das Maskottchen ab.
    if (bildDatei) await coverKlein(ordner, protokoll, bildDatei)

    // 6. DER EINE AUGENBLICK, IN DEM DIE DATEI VOLLSTAENDIG WIRD.
    await rename(abgelegt, ziel)
    if (bildDatei) await rm(bildDatei, { force: true }).catch(() => {})
    protokoll(`FERTIG AUFGENOMMEN: ${ziel} (${Math.round(gross / 1024)} kB)${bildDatei ? ' — mit Cover' : ''}`)
    return { fertig: true, grund: '' }
  } catch (f) {
    return { fertig: false, grund: f.message }
  } finally {
    // NICHTS LAEUFT WEITER, UND NICHTS HALBES BLEIBT LIEGEN.
    try {
      if (spieler && spieler.exitCode === null) spieler.kill('SIGTERM')
    } catch {
      /* schon weg */
    }
    try {
      if (aufnahme && aufnahme.exitCode === null) aufnahme.kill('SIGTERM')
    } catch {
      /* schon weg */
    }
    await rm(zwischen, { force: true }).catch(() => {})
  }
}

/**
 * Ein Durchgang des Leerlaufs — er teilt aus, bis der Wirt Nein sagt (E74/3).
 *
 * ══ WAS SICH GEAENDERT HAT ═════════════════════════════════════════════════
 *
 * Hier stand: „ES LAEUFT IMMER NUR EINER. `arbeit.laeuft` ist kein Schmuck: ein
 * Takt, der einen zweiten Lauf anstoesst, waehrend der erste noch schneidet,
 * erzeugt zwei Soloist-Instanzen auf demselben Zugang — und die nehmen sich
 * gegenseitig die Wiedergabe weg."
 *
 * Die Sorge war richtig, das Mittel war grob. „Derselbe Zugang" ist die
 * Gefahr, nicht „mehr als einer" — und seit der Wirt Buch fuehrt, KANN
 * derselbe Zugang gar nicht zweimal vergeben werden. Betreiber, 22.08.2026:
 * „wenn mehr als einer frei ist geht das abarbeiten schneller".
 *
 * `arbeit.laeuft` riegelt jetzt nur noch den DURCHGANG ab (zwei Takte duerfen
 * sich nicht ueberholen), nicht die Aufnahmen. Die laufen nebeneinander und
 * tragen sich in `arbeit.jobs` ein.
 *
 * ══ DER PASSIVE ABGRIFF HAT WEITER VORRANG ═════════════════════════════════
 *
 * `lauf.prozess` bleibt ein hartes Aus. Der passive Weg schneidet mit, was die
 * Familie gerade hoert; ihm nebenher Zugaenge wegzunehmen waere genau die
 * Stoerung, gegen die der ganze Leerlauf gebaut ist.
 */
async function leerlaufDurchgang(einstellungen, protokoll) {
  if (arbeit.laeuft || lauf.prozess) return

  /* ══ DIE ERLAUBNIS GILT AUCH IM LEERLAUF ═══════════════════════════════
   *
   * BEINAHE VERGESSEN, und es waere der schlimmste Fehler dieses Plugins
   * gewesen. Der passive Abgriff fragt `erlaubt()`, bevor er mitschneidet —
   * die beiden Schalter („Ich habe die Rechtslage gelesen" und „Spotify
   * mitschneiden") sind die ganze Zusicherung, die dieses Plugin gibt.
   *
   * Der Leerlauf-Arbeiter nimmt AKTIV auf, nicht bloss mit. Ohne diese
   * Pruefung schnitte er mit, waehrend beide Schalter aus sind — und zwar
   * unsichtbar, weil niemand hoert, was in eine Leersenke laeuft. Eine
   * Zusicherung, die nur der eine von zwei Wegen einhaelt, ist keine.
   */
  const darf = erlaubt(einstellungen, 'spotify')
  if (!darf.ja) {
    if (arbeit.grund !== darf.grund) protokoll(`Leerlauf haelt still: ${darf.grund}`)
    arbeit.grund = darf.grund
    return
  }

  arbeit.laeuft = true
  try {
    const stroeme = stroemeAusKontext()
    const spielt = Boolean(titelAus(await spielerZustand()))

    /* ══ AUSTEILEN, BIS DER WIRT NEIN SAGT ═════════════════════════════════
     *
     * Die Schleife fragt so lange nach Stroemen, wie die Vergabe welche
     * hergibt — die Reserve fuers Hoeren rechnet SIE, nicht diese Stelle. Zwei
     * eigene Riegel stehen daneben:
     *
     *   HOECHSTENS_PARALLEL  zaehlt Speicher, nicht Zugaenge (ein Soloist wiegt
     *                        rund 69 MB, am Geraet gemessen).
     *   `auftrag === null`   heisst: die Liste hat nichts mehr her. Dann ist
     *                        Schluss, auch wenn noch Stroeme frei waeren.
     *
     * DIE AUFNAHMEN WERDEN NICHT ABGEWARTET. Der Durchgang startet sie und
     * geht; jede raeumt hinterher selbst auf (`einenAuftragAusfuehren`). Wer
     * hier `await` schriebe, haette wieder genau einen Lauf zur Zeit.
     */
    let gestartet = 0
    let letzterGrund = ''
    // Einmal je Durchgang gefragt, nicht je Schleifendurchlauf: die Uhr
    // springt nicht mitten im Austeilen.
    const nacht = nachtmodusGilt(einstellungen, new Date())
    while (arbeit.jobs.size < HOECHSTENS_PARALLEL) {
      const zuteilung = await stromAnfordern(nacht)
      if (zuteilung.nr === null) {
        letzterGrund = zuteilung.grund
        break
      }

      const pool = Array.isArray(stroeme?.stroeme) ? stroeme.stroeme : []
      const strom = pool.find((s) => Number(s?.nr) === Number(zuteilung.nr)) ?? null
      if (!strom) {
        // ZUGETEILT, ABER NICHT IM KONTEXT: dann fehlt dem Plugin das Recht
        // `aufnahme` oder der Pool ist gerade auseinandergelaufen. Sofort
        // zurueckgeben — einen Platz zu halten, den man nicht benutzen kann,
        // nimmt ihn nur dem naechsten weg.
        await stromFreigeben(zuteilung.marke)
        letzterGrund = `Strom ${zuteilung.nr} zugeteilt, aber ohne Zugang im Kontext`
        break
      }

      let auftrag = null
      let grund = ''
      await mitListe(datenOrdner, (liste) => {
        // `EIGENNAME` ist die Leersenke aus config/templates/62-mixpi-mitschnitt.conf
        // — dieselbe Zeichenkette, die dort als `node.name` steht.
        const w = wasJetzt({ spielt, stroeme, strom, vergabeGrund: zuteilung.grund, mitschnittSenke: EIGENNAME, liste })
        auftrag = w.auftrag
        grund = w.grund
        if (!auftrag) return null
        // DER VERSUCH ZAEHLT BEIM BEGINN, nicht am Ende (Regel 3 der Liste):
        // endet der Lauf hart, gibt es kein Ende, das noch zaehlen koennte.
        // UND ER SPERRT DEN TITEL fuer den naechsten Rundenlauf: `beginnen`
        // setzt ihn auf `laeuft`, und `wasJetzt` waehlt nur aus `offen`.
        // Ohne das naehmen zwei Stroeme denselben Titel auf.
        return beginnen(liste, auftrag.eintrag.uri).liste
      })

      if (!auftrag) {
        await stromFreigeben(zuteilung.marke)
        letzterGrund = grund
        break
      }

      starteAuftrag(auftrag, zuteilung, einstellungen, protokoll)
      gestartet++
    }

    if (arbeit.jobs.size === 0) {
      // NUR MELDEN, WENN SICH DER GRUND GEAENDERT HAT — sonst ist das Journal
      // alle 30 s eine Zeile laenger und niemand liest es mehr.
      if (letzterGrund && letzterGrund !== arbeit.grund) protokoll(`Leerlauf: ${letzterGrund}`)
      arbeit.grund = letzterGrund
    } else if (gestartet > 0) {
      protokoll(`Leerlauf: ${gestartet} gestartet, ${arbeit.jobs.size} laufen jetzt`)
    }
    arbeit.zuletzt = Date.now()
  } catch (f) {
    protokoll(`Leerlauf: ${f.message}`)
  } finally {
    arbeit.laeuft = false
  }
}

/**
 * EINEN Auftrag von Anfang bis Ende — und hinterher aufraeumen.
 *
 * Absichtlich NICHT `async` nach aussen: der Durchgang soll weitergehen und
 * den naechsten Strom holen, waehrend dieser hier schneidet. Was zurueckkommt,
 * ist das Versprechen, das in `arbeit.jobs` steht.
 *
 * DER PLATZ GEHT IM `finally` ZURUECK — an EINER Stelle, die jeden Ausgang
 * erwischt: Erfolg, Fehlschlag, Verdraengung und Wurf.
 */
function starteAuftrag(auftrag, zuteilung, einstellungen, protokoll) {
  const versprechen = (async () => {
    try {
      const urteil = await einenAufnehmen(auftrag, einstellungen, protokoll, zuteilung.marke)

      /* ══ VERDRAENGUNG IST KEIN FEHLSCHLAG ═══════════════════════════════
       *
       * Der Titel hat nichts falsch gemacht — es wollte nur jemand hoeren.
       * Wuerde er als `scheitern` verbucht, zaehlte der Versuch, und nach drei
       * Kindern, die zwischendurch Musik anmachen, laege er auf `fehler`. Er
       * geht deshalb auf `offen` zurueck und ist beim naechsten freien Strom
       * wieder dran.
       */
      if (urteil.verdraengt) {
        await mitListe(datenOrdner, (liste) => zuruecklegen(liste, auftrag.eintrag.uri).liste)
        protokoll(`zurueckgestellt: "${auftrag.eintrag.titel}" — ${urteil.grund}`)
        return
      }

      await mitListe(datenOrdner, (liste) =>
        urteil.fertig
          ? abschliessen(liste, auftrag.eintrag.uri).liste
          : scheitern(liste, auftrag.eintrag.uri, urteil.grund).liste,
      )

      if (!urteil.fertig) {
        protokoll(`nicht aufgenommen: "${auftrag.eintrag.titel}" — ${urteil.grund}`)

        /* ══ EIN UMSTAND DARF NICHT DIE GANZE LISTE VERBRENNEN ═══════════════
         *
         * Am Geraet gesehen (21.08.2026): Strom 2 war nicht gekoppelt, also
         * scheiterte JEDER Titel — mit demselben Grund. Der Arbeiter haette
         * sich reihum durch alle einunddreissig Eintraege gearbeitet und jeden
         * nach drei Anlaeufen auf `fehler` gelegt. Am Ende stuende eine Liste
         * voller kaputter Titel und EIN kaputter Strom.
         *
         * DASSELBE PRINZIP WIE BEI DER ZEITSPERRE in `laufDeuten`, nur eine
         * Ebene hoeher: Wenn derselbe Grund bei VERSCHIEDENEN Titeln wiederkehrt,
         * liegt es nicht an den Titeln. Dann haelt der Arbeiter an und sagt es —
         * und die Liste bleibt heil, bis jemand die Ursache behebt.
         */
        if (urteil.grund === arbeit.letzterFehlgrund) {
          arbeit.gleicheFehler = (arbeit.gleicheFehler ?? 1) + 1
        } else {
          arbeit.gleicheFehler = 1
          arbeit.letzterFehlgrund = urteil.grund
        }
        if (arbeit.gleicheFehler >= 2) {
          leerlaufTakt(false)
          arbeit.grund = `angehalten nach ${arbeit.gleicheFehler} gleichen Fehlschlaegen: ${urteil.grund}`
          protokoll(
            `Leerlauf ANGEHALTEN — ${arbeit.gleicheFehler} verschiedene Titel scheiterten am selben Grund: ` +
              `${urteil.grund}. Das liegt nicht an den Titeln. Nach der Behebung startet der Takt beim ` +
              `naechsten Abspielen oder beim naechsten Blick in den Eltern-Bereich von selbst wieder.`,
          )
        }
      } else {
        arbeit.gleicheFehler = 0
        arbeit.letzterFehlgrund = ''
      }
    } catch (f) {
      protokoll(`Aufnahme: ${f.message}`)
    } finally {
      await stromFreigeben(zuteilung.marke)
      arbeit.jobs.delete(versprechen)
      arbeit.grund = arbeit.jobs.size > 0 ? `${arbeit.jobs.size} Aufnahmen laufen` : 'bereit'
    }
  })()
  arbeit.jobs.add(versprechen)
  arbeit.grund = `${arbeit.jobs.size} ${arbeit.jobs.size === 1 ? 'Aufnahme laeuft' : 'Aufnahmen laufen'}`
  return versprechen
}

/**
 * Einen Strom beim Wirt anfordern (E74).
 *
 * FAELLT DIE FRAGE AUS, GIBT ES KEINEN AUFTRAG — und einen Grund, der das
 * sagt. Frueher suchte das Plugin selbst und kam damit auch dann zu einem
 * Strom, wenn der Server gerade nicht antwortete; jetzt haengt die Arbeit an
 * einer Auskunft, und ein stilles „dann eben irgendeiner" waere genau das
 * Doppelbelegen, gegen das die Vergabe gebaut ist.
 */
async function stromAnfordern(nacht = false) {
  const leer = { nr: null, marke: null, grund: '' }
  const antwort = await serverSchicken('/api/stroeme/vergabe', 'POST', {
    fuer: 'mitschnitt',
    wer: 'mixpi-mitschnitt',
    // IM NACHTMODUS GIBT DIE WIEDERGABE IHREN PLATZ HER (E127): Reserve 0
    // heisst „alle Stroeme duerfen aufnehmen". Tagsueber bleibt die Vorgabe
    // des Wirts, die EINEN Strom fuers Hoeren freihaelt.
    ...(nacht ? { reserve: 0 } : {}),
  })
  if (antwort.status !== 200 || !antwort.inhalt) {
    return { ...leer, grund: `die Vergabe antwortet nicht (Status ${antwort.status})` }
  }
  const i = antwort.inhalt
  return {
    nr: Number.isInteger(i.nr) ? i.nr : null,
    marke: Number.isInteger(i.marke) ? i.marke : null,
    grund: typeof i.grund === 'string' ? i.grund : '',
  }
}

/** Einen Platz zurueckgeben. Ohne Marke gibt es nichts zurueckzugeben. */
async function stromFreigeben(marke) {
  if (!Number.isInteger(marke)) return
  await serverSchicken('/api/stroeme/freigeben', 'POST', { marke })
}

/**
 * „Habe ich den Strom noch?" — und zugleich das Lebenszeichen (E74/4).
 *
 * `false` heisst VERDRAENGT (oder die Frist ist abgelaufen). Genau daran merkt
 * ein laufender Arbeiter, dass er weichen soll.
 *
 * EINE AUSGEFALLENE FRAGE HEISST „JA". Das ist die vorsichtige Richtung: wer
 * beim ersten Netzhaenger die halbe Aufnahme wegwirft, verliert Arbeit an
 * einem Zweifel. Bleibt der Wirt wirklich weg, laeuft ohnehin die Frist ab,
 * und dann meldet sich der naechste Nachfrager.
 */
async function stromNochDa(marke) {
  if (!Number.isInteger(marke)) return true
  const antwort = await serverSchicken('/api/stroeme/lebenszeichen', 'POST', { marke })
  if (antwort.status !== 200 || !antwort.inhalt) return true
  return antwort.inhalt.ok !== false
}

/** Den Leerlauf-Takt stellen oder anhalten. */
function leerlaufTakt(an, einstellungen, protokoll) {
  if (!an) {
    if (arbeit.takt) clearInterval(arbeit.takt)
    arbeit.takt = null
    return
  }
  if (arbeit.takt) return
  arbeit.takt = setInterval(() => {
    leerlaufDurchgang(einstellungen, protokoll).catch((f) => protokoll(`Leerlauf: ${f.message}`))
  }, LEERLAUF_TAKT_MS)
  arbeit.takt.unref?.()
}

/** Ab welcher Sekunde meldet ffmpeg Stille? `null`, wenn gar keine. */
async function stilleAbMessen(pfad) {
  const aus = await laufenMitFehler(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-i', pfad, '-af', 'silencedetect=n=-60dB:d=1.0', '-f', 'null', '-'],
    90_000,
  )
  const t = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(aus)
  return t ? Number(t[1]) : null
}

/**
 * Den abgelegten Bestand durchsehen — und die kaputten wieder vormerken.
 *
 * ══ WOZU (Betreiberwunsch 29.08.2026) ═════════════════════════════════════
 * „ich habe eine gemischte aufzeichnung gefunden, das kann von unserer
 * entwicklungszeit kommen — da brauchen wir noch einen mechanismus neu
 * aufzeichnen zu lassen."
 *
 * Genau so ist es. Waehrend der Entwicklung hing der Abgriff zeitweise am
 * LAUTSPRECHER statt am eigenen Strom; was dabei entstand, sieht auf jedem
 * `ls` aus wie eine gelungene Aufnahme. Von Hand ist das nicht zu finden —
 * man muesste jede Datei anhoeren.
 *
 * ES SUCHT SELBST. Der Betreiber soll nicht jagen muessen, sondern einen
 * Knopf druecken.
 *
 * ══ WARUM NICHT EIN KNOPF JE DATEI ════════════════════════════════════════
 * Aktionen sind im Plugin-Vertrag PARAMETERLOS (`pluginAktion(kennung,
 * aktionsKennung)`). Das ist hier kein Mangel: ein Knopf je Datei setzte
 * voraus, dass jemand weiss, WELCHE kaputt ist — und das weiss niemand.
 *
 * ══ ZWEI KNOEPFE, WEIL SEHEN UND HANDELN NICHT DASSELBE IST ═══════════════
 * `bestand-pruefen` sieht nur nach und sagt, was es findet. Es fasst nichts
 * an. Wer den Befund gelesen hat, kann dann `kaputte-neu-aufnehmen` druecken.
 * Ein einziger Knopf, der misst UND loescht, waere ein Knopf, den niemand
 * ohne Bauchweh drueckt.
 *
 * ══ WAS DIE ZWEITE AKTION TUT ═════════════════════════════════════════════
 * Die kaputte Datei loeschen und den Eintrag auf `offen` zuruecksetzen
 * (`zuruecksetzen` — seit E66 gebaut und bis heute ohne Aufrufer). Der
 * Leerlauf-Arbeiter nimmt ihn dann von selbst wieder auf, mit dem
 * reparierten Abgriff.
 *
 * GELOESCHT WIRD NUR, WAS AUCH WIEDER VORGEMERKT WERDEN KANN. Findet sich
 * der Eintrag nicht mehr in der Liste, bleibt die Datei liegen — lieber eine
 * kaputte Datei als ein Titel, der ersatzlos verschwindet.
 */
/**
 * Der Stand der letzten Nachschau. Ueberdauert den Knopfdruck.
 *
 * ══ WARUM DAS NOETIG IST (am Geraet gemessen, 29.08.2026) ═════════════════
 * Der erste Anlauf liess die Nachschau IM Knopf laufen und bekam:
 *     „mixpi-mitschnitt hat 8000 ms nicht geantwortet"
 * Der Wirt gibt jedem Plugin-Aufruf acht Sekunden. Ein `ffmpeg`-Lauf je Datei
 * braucht ein Vielfaches davon, und der Bestand hat Dutzende.
 *
 * Also stoesst der Knopf nur AN und kommt sofort zurueck; das Ergebnis holt
 * man sich aus `befinden` oder aus dem Protokoll. Dieselbe Bauform wie beim
 * Aufnehmen selbst (`starten` ohne `await`).
 */
let nachschau = { laeuft: false, seit: 0, text: 'noch nicht nachgemessen' }

async function bestandDurchsehen(kontext, auchHandeln) {
  const e = kontext.einstellungen ?? {}
  const basis = String(e.ablage || MEDIEN_BASIS).trim() || MEDIEN_BASIS
  const kategorie = String(e.kategorie || 'music').trim() || 'music'
  const ordner = typeof kontext.datenOrdner === 'string' && kontext.datenOrdner ? kontext.datenOrdner : datenOrdner
  if (!ordner) return { ok: false, text: 'Ohne Datenordner gibt es keine Liste — nichts zu pruefen.' }

  const geladen = await mitListe(ordner, () => null)
  const fertige = (geladen.liste?.eintraege ?? []).filter((x) => x.zustand === 'fertig')
  if (fertige.length === 0) return { ok: true, text: 'Die Liste enthaelt keinen fertigen Mitschnitt.' }

  const kaputt = []
  let gesehen = 0
  for (const eintrag of fertige) {
    const kuenstler = eintrag.albumInterpret || eintrag.interpret
    const pfad = join(albumOrdner(kategorie, kuenstler, eintrag.album, basis), spurname(eintrag.nummer, eintrag.titel))
    const da = await stat(pfad).then(() => true).catch(() => false)
    if (!da) continue
    gesehen += 1
    const { spitze, mittel } = await pegelMessen(pfad)
    const dauerSek = await dauerVon(pfad)
    const stilleAb = await stilleAbMessen(pfad)
    const b = mitschnittBefund({ mittel, spitze, dauerSek, stilleAb })
    if (!b.gut) kaputt.push({ eintrag, pfad, befund: b, mittel, dauerSek })
  }

  if (kaputt.length === 0) {
    return { ok: true, text: `${gesehen} Mitschnitte nachgemessen — alle in Ordnung.` }
  }

  const zeilen = kaputt.map(
    (k) =>
      `${k.eintrag.titel} (${k.eintrag.album}): ${k.befund.wort}` +
      (k.befund.anteil > 0 && k.befund.anteil < 1 ? `, ${Math.round(k.befund.anteil * 100)} % stumm` : '') +
      `, Mittel ${k.mittel} dB`,
  )

  if (!auchHandeln) {
    return {
      ok: true,
      text: `${gesehen} nachgemessen, ${kaputt.length} kaputt:\n- ${zeilen.join('\n- ')}\n\nMit „Kaputte neu aufnehmen" werden sie geloescht und wieder vorgemerkt.`,
    }
  }

  let neu = 0
  for (const k of kaputt) {
    const erg = await mitListe(ordner, (liste) => {
      const z = zuruecksetzen(liste, k.eintrag.uri)
      return z.ok ? z.liste : null
    })
    // ERST vormerken, DANN loeschen. Andersherum stuende die Datei weg und der
    // Eintrag noch auf `fertig` — dann faende die Box sie nie wieder.
    if (!erg.geschrieben) continue
    await rm(k.pfad, { force: true }).catch(() => {})
    neu += 1
  }
  kontext.protokoll?.(`Bestand durchgesehen: ${gesehen} geprueft, ${neu} zur Neuaufnahme vorgemerkt`)
  return {
    ok: true,
    text: `${gesehen} nachgemessen, ${kaputt.length} kaputt, ${neu} zur Neuaufnahme vorgemerkt:\n- ${zeilen.join('\n- ')}`,
  }
}

export default {
  /**
   * Die Knoepfe aus dem Manifest.
   *
   * Sie STOSSEN AN und warten nicht — der Wirt gibt acht Sekunden, und eine
   * Nachschau ueber den ganzen Bestand braucht Minuten. Was dabei herauskommt,
   * steht danach in `befinden` und im Protokoll.
   */
  async aktion(kennung, kontext) {
    if (kennung !== 'bestand_pruefen' && kennung !== 'kaputte_neu_aufnehmen') {
      return { ok: false, text: `Unbekannte Aktion "${kennung}".` }
    }
    if (nachschau.laeuft) {
      return { ok: false, text: 'Es laeuft schon eine Nachschau. Ihr Ergebnis steht danach im Befinden.' }
    }
    const auchHandeln = kennung === 'kaputte_neu_aufnehmen'
    nachschau = { laeuft: true, seit: Date.now(), text: 'laeuft…' }
    // OHNE `await` — genau deshalb gibt es diesen Knopf in dieser Form.
    void bestandDurchsehen(kontext, auchHandeln)
      .then((e) => {
        nachschau = { laeuft: false, seit: Date.now(), text: e.text }
        // ZEILE FUER ZEILE, NICHT ALS BLOCK. Am Geraet gemessen (29.08.2026):
        // ein mehrzeiliger Protokolleintrag landet im Journal mit seiner
        // ERSTEN Zeile, der Rest ist weg. Der Befund „13 kaputt" war da, die
        // Liste der dreizehn nicht — also genau das, wofuer man nachsieht.
        for (const z of e.text.split('\n')) {
          const s = z.trim()
          if (s) kontext.protokoll?.(`Nachschau: ${s.replace(/^-\s*/, '')}`)
        }
      })
      .catch((f) => {
        nachschau = { laeuft: false, seit: Date.now(), text: `Nachschau scheiterte: ${f.message}` }
      })
    return {
      ok: true,
      text: auchHandeln
        ? 'Nachschau laeuft. Kaputte Mitschnitte werden geloescht und wieder vorgemerkt; das Ergebnis steht danach im Befinden.'
        : 'Nachschau laeuft. Das Ergebnis steht danach im Befinden — es wird nichts angefasst.',
    }
  },

  async ereignis(name, nutzlast, kontext) {
    const e = kontext.einstellungen ?? {}
    // DER DATENORDNER KOMMT MIT JEDEM EREIGNIS und wird hier gemerkt, weil die
    // Arbeit danach ohne `kontext` weiterlaeuft (siehe das `starten` ohne
    // `await` weiter unten). Bleibt er leer, arbeitet das Plugin wie bisher —
    // nur ohne Liste; `vormerkenFuerSpaeter` steigt dann still aus.
    if (typeof kontext.datenOrdner === 'string' && kontext.datenOrdner) datenOrdner = kontext.datenOrdner
    if (Array.isArray(kontext.stroeme)) kontextStroeme = kontext.stroeme

    if (name === 'wiedergabeGestoppt' || name === 'kinderzeitEnde') {
      // OHNE WENN UND ABER, und ohne die Erlaubnis noch einmal zu fragen. Wer
      // den Schalter waehrend eines Mitschnitts umlegt, soll ihn beenden
      // koennen — nicht auf das naechste Ereignis warten muessen.
      if (lauf.prozess) await beenden(kontext.protokoll, name === 'kinderzeitEnde' ? 'Kinderzeit zu Ende' : '')
      // JETZT BEGINNT DER LEERLAUF — der Augenblick, auf den der Arbeiter
      // wartet. Ihn nur beim Starten zu stellen hiesse: eine Box, die seit dem
      // Neustart nichts gespielt hat, nimmt auch nie etwas nach.
      leerlaufTakt(true, e, kontext.protokoll)
      return
    }

    if (name !== 'wiedergabeGestartet') return

    /* ══ DAS WARTEN GEHOERT IN DEN NICHT-AWAIT-TEIL ═══════════════════════
     *
     * HIER STAND EIN EINZIGER BLICK auf den Spieler, und der ging JEDES MAL
     * daneben: das Ereignis faellt, sobald der Abspieldienst den Befehl
     * bestaetigt hat — Soloist verbindet sich DANACH erst.
     *
     * AM GERAET GEMESSEN (21.08.2026): Abspielbefehl um 13:00:45, der Titel
     * stand erst rund VIERZEHN SEKUNDEN spaeter im Zustand. Das Plugin sah
     * vorher nach, fand nichts, und meldete „fuer diese Quelle gibt es keinen
     * Mitschnitt". Es hat also NIE etwas aufgenommen — und dabei jedes Mal
     * ordentlich begruendet, warum nicht. Ein Fehler, der sich als Auskunft
     * tarnt.
     *
     * DIESELBE LEHRE STEHT WEITER UNTEN bei `aufKnotenWarten`: „Der Anlauf
     * sieht aus wie ein Zustand. Also mehrmals hinsehen." Sie galt dort fuer
     * den PipeWire-Knoten und hier genauso — nur hat sie hier niemand
     * angewandt.
     *
     * DIE HUELLE IST EINE PFEILFUNKTION, damit `this` (und damit die
     * Merkzelle `_zuletzt`) dieselbe bleibt. Der Wirt gibt einem Ereignis
     * 8000 ms; bis zu 25 s Warten gehoeren also ausdruecklich hinter das
     * Feuern-und-Vergessen.
     */
    void (async () => {

      // Die Nutzlast von `wiedergabeGestartet` ist leer — sie sagt nicht, WAS
      // spielt. Also selbst nachsehen, statt zu raten.
      const zustand = await aufTitelWarten()
      // DERSELBE DENKFEHLER WIE IN `titelAus` (20.08.2026): ein leeres `item`
      // ist kein spielender Dienst. Hier stand `zustand?.item ? 'spotify' : ''`,
      // und damit begann eine Aufnahme, sobald der Abspieldienst ueberhaupt
      // antwortete — auch wenn gar nichts lief. Am Geraet kostete das 129
      // Sekunden Rohaufnahme und einen Ordner „Unbekannt/Ohne Album".
      const dienst = titelAus(zustand) ? 'spotify' : ''
      const urteil = erlaubt(e, dienst)
      if (!urteil.ja) {
        // EINMAL sagen, nicht bei jedem Kacheltipp — sonst ist das Journal
        // unlesbar, und genau dort sucht man spaeter.
        if (this._zuletzt !== urteil.grund) {
          this._zuletzt = urteil.grund
          kontext.protokoll(`kein Mitschnitt: ${urteil.grund}`)
        }
        return
      }
      this._zuletzt = null

      // DER LEERLAUF-TAKT WIRD HIER GESTELLT und nicht beim Laden: erst hier
      // stehen die Einstellungen fest, und erst hier ist die Erlaubnis geprueft.
      // Ohne diesen Aufruf laege der ganze Arbeiter fertig da und niemand riefe
      // ihn auf — der Fehler, den scripts/systemd/einrichten.sh in seinem Kopf
      // beschreibt.
      leerlaufTakt(true, e, kontext.protokoll)

      // NICHT `await` — UND DAS IST KEINE NACHLAESSIGKEIT.
      //
      // Der Wirt gibt einem Ereignis 8000 ms (FRIST_MS in plugin-wirt.ts).
      // `starten` wartet aber auf den librespot-Knoten, und der kommt erst,
      // wenn wirklich Ton fliesst — das kann laenger dauern. Am Geraet
      // gemessen (16.08.2026) stand daraufhin im Journal:
      //
      //     ueber der Frist — wird abgebrochen
      //     hat 8000 ms nicht geantwortet
      //     startet neu (Versuch 1 von 3)
      //
      // Der Worker wird dabei ABGERAEUMT: der halbe Zustand hier oben ist weg,
      // waehrend `pw-record` als Kindprozess munter weiterschreibt. Zurueck
      // bleibt eine verwaiste Rohdatei, die niemand mehr zuordnet.
      //
      // Ein Ereignis ist eine MITTEILUNG. Sie wird entgegengenommen und
      // beantwortet; die Arbeit laeuft danach.
      starten(e, kontext.protokoll).catch((f) => kontext.protokoll(`Start scheiterte: ${f.message}`))
    })().catch((f) => kontext.protokoll(`Start scheiterte: ${f.message}`))
  },

  /**
   * SICHTBAR, WAEHREND ER LAEUFT — Auflage 5 aus E28.
   *
   * Der Eltern-Bereich zeigt diesen Satz. Er sagt im Klartext, dass gerade
   * mitgeschnitten wird, seit wann und wohin.
   */
  async befinden(kontext) {
    const e = kontext.einstellungen ?? {}
    if (typeof kontext.datenOrdner === 'string' && kontext.datenOrdner) datenOrdner = kontext.datenOrdner
    if (Array.isArray(kontext.stroeme)) kontextStroeme = kontext.stroeme

    // WAS ANSTEHT, GEHOERT SICHTBAR — dieselbe Auflage wie beim laufenden
    // Mitschnitt (E28/Auflage 5). Eine Liste, die still waechst, ist genau die
    // Halde, gegen die sie gebaut ist.
    let warteschlange = ''
    try {
      const { liste } = await mitListe(datenOrdner, () => null)
      const z = stand(liste)
      if (z.offen || z.fehler) {
        const naechst = naechster(liste)
        warteschlange =
          ` — ${z.offen} vorgemerkt${z.fehler ? `, ${z.fehler} liegen mit Fehler` : ''}` +
          (naechst ? `, als naechstes "${naechst.titel || naechst.uri}"` : '')
      }
    } catch {
      /* eine unlesbare Liste darf das Befinden nicht verschlucken */
    }

    // DIE NACHSCHAU MELDET SICH HIER — sie ist der einzige Weg, auf dem ihr
    // Ergebnis herauskommt: der Knopf kann nicht darauf warten (acht Sekunden
    // Frist, Minuten Arbeit).
    if (nachschau.laeuft) {
      const s = Math.round((Date.now() - nachschau.seit) / 1000)
      warteschlange += ` — Nachschau laeuft seit ${s} s`
    } else if (nachschau.seit) {
      warteschlange += ` — letzte Nachschau: ${nachschau.text.split('\n')[0]}`
    }

    if (lauf.prozess) {
      const min = Math.floor((Date.now() - lauf.seit) / 60_000)
      const sek = Math.floor(((Date.now() - lauf.seit) % 60_000) / 1000)
      const wo = lauf.titel?.name ? `, gerade "${lauf.titel.name}"` : ''
      const bisher = lauf.abgelegt ? `, ${lauf.abgelegt} Stueck abgelegt` : ''
      return {
        ok: true,
        text: `SCHNEIDET GERADE MIT — seit ${min}:${String(sek).padStart(2, '0')}${wo}${bisher} → ${lauf.ordner}${warteschlange}`,
      }
    }
    /* DER DRITTE HAKEN — und er schliesst eine echte Luecke.
     *
     * Der Vertrag kennt nur vier Ereignisse und keinen Lade-Haken. Der Takt
     * wird deshalb beim Start und beim Anhalten der Wiedergabe gestellt. Nach
     * einem NEUSTART MIT GEFUELLTER LISTE passierte damit nichts, bis jemand
     * etwas spielt — die vorgemerkten Titel laegen da und warteten auf ein
     * Ereignis, das niemand ausloest.
     *
     * `befinden` wird vom Eltern-Bereich regelmaessig gefragt. Es ist kein
     * schoener Ort, um einen Takt zu stellen, aber der einzige verbleibende —
     * und `leerlaufTakt` ist gegen Doppelstellen abgesichert.
     */
    leerlaufTakt(true, e, kontext.protokoll)

    // WORAN DER LEERLAUF GERADE IST. Ein Arbeiter, der schweigt, ist von einem
    // kaputten nicht zu unterscheiden — deshalb steht der Grund hier.
    const arbeitText = arbeit.laeuft ? ` — ${arbeit.grund}` : arbeit.grund ? ` — Leerlauf: ${arbeit.grund}` : ''

    if (lauf.letzterFehler) return { ok: false, text: `letzter Versuch scheiterte: ${lauf.letzterFehler}` }
    const urteil = erlaubt(e, 'spotify')
    return urteil.ja
      ? { ok: true, text: `bereit — schneidet mit, sobald Spotify spielt (Testfunktion)${warteschlange}${arbeitText}` }
      : { ok: true, text: `aus — ${urteil.grund}${warteschlange}` }
  },

  /**
   * Die freie Flaeche unter /api/plugins/mixpi-mitschnitt/http/… (E97/E98,
   * Betreiberwunsch: „mir fehlt noch die verwaltung sowie anstoßen").
   *
   * ZWEI PFADE — dieselbe Bauart wie mixpi-ardsounds (E77/E79):
   *
   *   liste       GET   der Bestand der Vormerkliste, maschinenlesbar.
   *   vormerken   POST  Titel GEZIELT vormerken.
   *
   * KEINE ZWEITE LISTEN-IMPLEMENTIERUNG: beide Pfade lesen/schreiben
   * ausschliesslich ueber `mitListe()` und `liste.mjs` — denselben Weg, den
   * der passive Abgriff (`vormerkenFuerSpaeter`) und der Leerlauf-Arbeiter
   * auch nehmen. Es gibt also nur EINE Wahrheit ueber den Listenzustand.
   *
   * `vormerken` traegt HERKUNFT `hand` ein — genau die Stufe, die
   * `naechster()` zuerst bedient: „Wer in der Verwaltung etwas eintraegt,
   * wartet darauf." (liste.mjs, Dokumentation zu `naechster`).
   */
  async http(anfrage, kontext) {
    const ordner = typeof kontext.datenOrdner === 'string' && kontext.datenOrdner ? kontext.datenOrdner : datenOrdner
    const pfad = anfrage.pfad

    if (pfad === 'liste') {
      if (anfrage.methode !== 'GET') return { status: 405, inhalt: { fehler: 'nur GET' } }
      const { liste } = await mitListe(ordner, () => null)
      const z = stand(liste)
      return {
        inhalt: {
          // NUR DIE DREI, DIE VON AUSSEN VORKOMMEN: `laeuft` ist ein
          // FLUECHTIGER Zustand, den ein Blick ueber `mitListe`/`liste.mjs`
          // nie zu sehen bekommt — jedes Laden normalisiert ihn zurueck auf
          // `offen` (Regel 2 in liste.mjs: „laeuft muss sich erholen").
          zusammenfassung: { offen: z.offen, fertig: z.fertig, fehler: z.fehler },
          // WAS GERADE AUFGENOMMEN WIRD (E126, Stufe 3): der laufende Titel
          // samt Sekunden seit seinem Beginn IN DER ROHDATEI. `dauerMs`
          // kommt aus dem Spielerzustand — der Fortschrittsbalken der Seite
          // rechnet daraus. `null`, wenn gerade nichts laeuft; die Zahl aus
          // `lauf` selbst, nicht neu erfunden.
          laufend: lauf.prozess && lauf.titel
            ? {
                uri: lauf.titel.uri,
                name: lauf.titel.name,
                interpret: lauf.titel.kuenstler,
                album: lauf.titel.album || '',
                bild: lauf.titel.bild || null,
                // WIE LANG DER TITEL SEIN SOLL — aus dem Spielerzustand
                // (`duration_ms`, titelAus). Ohne diese Zahl waere der
                // Balken der Verwaltung eine Stoppuhr ohne Ziel; MIT ihr
                // ist er ein Fortschritt. `null`, wenn der Dienst sie nicht
                // nennt — die Seite zeigt dann eben nur die Zeit.
                dauerMs: lauf.titel.dauerMs ?? null,
                stromNr: lauf.stromNr ?? null,
                sekunden: lauf.seit ? Math.max(0, Math.round((Date.now() - lauf.seit) / 1000)) : 0,
              }
            : null,
          eintraege: liste.eintraege.map((e) => {
            const eintrag = { uri: e.uri, name: e.titel, interpret: e.interpret, album: e.album, stand: e.zustand }
            // `wort` NUR, WENN ES ETWAS ZU SAGEN GIBT — ein leerer Grund ist
            // keine Auskunft, sondern Rauschen (dieselbe Regel wie beim
            // Protokoll in `vormerkenFuerSpaeter`).
            if (e.grund) eintrag.wort = e.grund
            // FUER DIE VERWALTUNGS-SEITE (E126): nur, wo es etwas sagt —
            // versuche ab dem ersten Fehlschlag, Vorrang und Herkunft nur
            // abseits der Vorgabe. Ein Feld, das fast immer gleich ist,
            // ist Rauschen in jeder Antwort.
            if (e.versuche > 0) eintrag.versuche = e.versuche
            if (e.vorrang === true) eintrag.vorrang = true
            if (e.herkunft && e.herkunft !== 'automatisch') eintrag.herkunft = e.herkunft
            // DER ALBUM-INTERPRET GEHOERT DAZU, sobald die Verwaltung nach
            // Alben gruppiert (E126): `interpret` sind die Mitwirkenden DES
            // TITELS, Gaeste eingeschlossen — nach ihnen gruppiert zerfaellt
            // ein Album in mehrere. Der Ordner gehoert dem ALBUM-Interpreten
            // (dieselbe Lehre wie bei `titelAus`, 20.08.2026).
            if (e.albumInterpret) eintrag.albumInterpret = e.albumInterpret
            // KEIN `gemerktAm`: die Liste fuehrt keinen Zeitstempel je
            // Eintrag (liste.mjs kennt nur uri/titel/interpret/album/
            // albumInterpret/nummer/zustand/herkunft/vorrang/versuche/grund).
            // Ihn zu erfinden hiesse, eine Auskunft vorzutaeuschen, die es
            // nicht gibt — das Feld bleibt deshalb weg statt geraten zu sein.
            return eintrag
          }),
        },
      }
    }

    if (pfad === 'neuladen') {
      // NEU AUFLADEN (E126, Stufe 2, Betreiber: „neuaufladen anstoßen wenn
      // ich nicht zufrieden bin"). Zwei Handgriffe, beide vorhanden:
      //   1. die lokale Datei als unvollstaendig markieren — dann faellt die
      //      Wahl von selbst auf die Cloud zurueck (E110), bis der neue
      //      Mitschnitt vollstaendig ist. Genau `mitschnitt-laengen-pruefen
      //      --richten`, nur ueber die schon vorhandene PATCH-Route.
      //   2. den Titel MIT VORRANG vormerken, damit der Leerlauf ihn als
      //      Naechstes nimmt.
      // KEINE eigene Loeschung, keine neue Wahrheit: dieselbe Marke, derselbe
      // Vormerk-Weg wie ueberall sonst.
      if (anfrage.methode !== 'POST') return { status: 405, inhalt: { fehler: 'nur POST' } }
      const e = kontext.einstellungen ?? {}
      const urteil = erlaubt(e, 'spotify')
      if (!urteil.ja) return { status: 403, inhalt: { fehler: urteil.grund } }
      const rumpf = anfrage.rumpf && typeof anfrage.rumpf === 'object' ? anfrage.rumpf : {}
      const titel = Array.isArray(rumpf.titel) ? rumpf.titel : rumpf.uri ? [rumpf] : null
      if (!titel || !titel.length) return { status: 400, inhalt: { fehler: 'kein Titel angegeben' } }

      let vorgemerkt = 0
      let markiert = 0
      let befreit = 0
      await mitListe(ordner, (liste) => {
        let l = liste
        for (const t of titel) {
          if (!istTitelUri(t?.uri)) continue
          /* ══ ERST BEFREIEN, DANN VORMERKEN ═══════════════════════════════
           *
           * `vormerken` aendert an einem SCHON VORHANDENEN Eintrag nur
           * Herkunft und Vorrang — NICHT den Zustand und NICHT die
           * Versuche. Ein Titel, der nach drei Anlaeufen auf `fehler`
           * liegt, waere damit weiter unerreichbar: `naechster()` nimmt
           * nur `offen`. Der Knopf haette `ok: true` gemeldet und nichts
           * bewirkt — die schlimmste Sorte, weil sie wie Erfolg aussieht.
           *
           * Gefunden am 04.09.2026 durch die Frage des Betreibers zu einem
           * Eintrag mit „login failed" und 3 Fehlversuchen: der Grund war
           * laengst weg (der Rest nahm auf), der Eintrag lag trotzdem fest.
           * GENAU DAS ist der Zweck dieses Knopfes.
           */
          const vorher = l.eintraege.find((x) => x.uri === t.uri)
          if (vorher && (vorher.zustand === 'fehler' || vorher.versuche > 0)) {
            l = zuruecksetzen(l, t.uri).liste
            befreit += 1
          }
          // HERKUNFT 'hand', NICHT 'verwaltung': HERKUENFTE kennt genau zwei
          // Namen (liste.mjs), und ein unbekannter faellt STILL auf
          // 'automatisch' zurueck — der Eintrag saehe dann aus, als haette
          // ihn niemand angefordert. Am 04.09.2026 vom neuen Zeugen
          // gefangen; derselbe Name, den `vormerken` ueber die Medienseite
          // benutzt.
          l = vormerken(l, t, 'hand', true).liste
          vorgemerkt += 1
        }
        return l
      })
      // Die Marke setzen — best effort, jeder Titel fuer sich. Ein Titel
      // OHNE bekannten Medienschluessel (z. B. eine Single) wird trotzdem
      // vorgemerkt; er laedt beim naechsten Lauf einfach neu.
      for (const t of titel) {
        if (t?.schluessel) {
          const ok = await serverSchicken(
            `/api/medien/${encodeURIComponent(String(t.schluessel))}`,
            'PATCH',
            { unvollstaendig: true },
          ).then(() => true).catch(() => false)
          if (ok) markiert += 1
        }
      }
      // UEBER DEN KONTEXT, wie der Nachbar `vormerken`: die freie
      // http-Flaeche hat kein durchgereichtes `protokoll` — das gibt es nur
      // im Arbeiter-Weg. Am Geraet fiel es sofort auf („protokoll is not
      // defined", 502); der Betreiber sah „Das Vormerken hat nicht
      // geklappt". Ein Protokollruf darf eine Tat nie scheitern lassen.
      kontext.protokoll?.(
        `neu aufladen angestossen: ${vorgemerkt} vorgemerkt, ${befreit} aus dem Fehlerzustand geholt, ${markiert} als unvollstaendig markiert`,
      )
      return { inhalt: { ok: true, vorgemerkt, befreit, markiert } }
    }

    if (pfad === 'vormerken') {
      if (anfrage.methode !== 'POST') return { status: 405, inhalt: { fehler: 'nur POST' } }
      // DIESELBE WACHE WIE DER PASSIVE WEG (leerlaufDurchgang, `befinden`):
      // ohne bestaetigte Rechtslage UND eingeschalteten Dienst schneidet
      // nichts mit — und dann darf auch niemand ueber die Verwaltung Titel
      // in eine Liste stellen, die ohnehin nie abgearbeitet wird.
      const e = kontext.einstellungen ?? {}
      const urteil = erlaubt(e, 'spotify')
      if (!urteil.ja) return { status: 403, inhalt: { fehler: urteil.grund } }

      const rumpf = anfrage.rumpf && typeof anfrage.rumpf === 'object' ? anfrage.rumpf : {}
      const angefragt = Array.isArray(rumpf.titel) ? rumpf.titel : null
      if (!angefragt) return { status: 400, inhalt: { fehler: 'kein Array "titel"' } }

      let vorgemerkt = 0
      let schonDa = 0
      let fertigUebersprungen = 0
      let uebersprungenUngueltig = 0
      let geaendert = false
      const erg = await mitListe(ordner, (liste) => {
        let aktuelle = liste
        for (const roh of angefragt) {
          const uri = typeof roh?.uri === 'string' ? roh.uri : ''
          if (!istTitelUri(uri)) {
            uebersprungenUngueltig++
            continue
          }
          const da = aktuelle.eintraege.find((x) => x.uri === uri)
          // FERTIG WIRD NICHT ANGEFASST — Idempotenz heisst hier: ein schon
          // aufgenommener Titel bleibt aufgenommen, er wird nicht erneut in
          // die Warteschlange gestellt (Regel 1 aus liste.mjs: die Platte ist
          // die Wahrheit, ein zweites Mal aufnehmen ist reine Verschwendung).
          if (da && da.zustand === 'fertig') {
            fertigUebersprungen++
            continue
          }
          // DERSELBE AUFRUF WIE `vormerkenFuerSpaeter` — nur mit `hand` statt
          // `automatisch`: die Verwaltung merkt ausdruecklich vor, kein
          // beilaeufig angespielter Titel.
          const v = vormerken(
            aktuelle,
            {
              uri,
              titel: roh.name,
              interpret: roh.interpret,
              album: roh.album,
              albumInterpret: roh.albumKuenstler,
            },
            'hand',
          )
          if (v.ok) {
            aktuelle = v.liste
            geaendert = true
          }
          if (da) schonDa++
          else vorgemerkt++
        }
        return geaendert ? aktuelle : null
      })

      // GEAENDERT, ABER NICHT GESCHRIEBEN — das ist `unsicher` (kein
      // Datenordner, oder die Liste war nicht lesbar): dann WAERE etwas
      // vorgemerkt worden, ist es aber nicht. Die Zahlen zurueckzugeben,
      // waere eine Zusage, die die Platte nicht haelt.
      if (geaendert && !erg.geschrieben) {
        return {
          status: 502,
          inhalt: { fehler: `Vormerkung nicht gesichert: ${erg.grund || 'unbekannt'}` },
        }
      }
      if (uebersprungenUngueltig) {
        kontext.protokoll?.(`vormerken: ${uebersprungenUngueltig} Titel ohne brauchbare Spotify-Adresse ignoriert`)
      }
      return { inhalt: { vorgemerkt, schonDa, fertigUebersprungen } }
    }

    return { status: 404, inhalt: { fehler: `kein Pfad "${pfad}"` } }
  },
}
