/**
 * Der Zwischenspeicher — JSON-Dateien im Datenordner, kein SQLite.
 *
 * ══ WARUM KEIN SQLITE, OBWOHL DER ENTWURF ES VORSAH ═══════════════════════
 *
 * Der Entwurf nannte `better-sqlite3` oder `node:sqlite`. Beide gehen hier
 * nicht, und zwar aus einem Grund, der aelter ist als dieses Plugin:
 *
 *   „Ein Plugin ist ein Ordner mit zwei Dateien. Mehr nicht — kein
 *    `npm install`, kein Bauschritt." (plugins/README.md)
 *
 * `better-sqlite3` ist eine NATIVE Abhaengigkeit: sie braucht einen
 * Uebersetzungsschritt je Architektur, und der Ausrollweg kopiert Plugins
 * mit `cp` (scripts/mixpi/mixpi-plugins-nachziehen.sh). Ein Plugin mit einer
 * `.node`-Datei darin waere auf einem Pi 4 gebaut und auf einem Pi 5 kaputt,
 * und der Fehler saehe aus wie ein kaputtes Plugin, nicht wie ein
 * Kopierbefehl — dieselbe Falle wie beim `cp -rn` von damals.
 *
 * `node:sqlite` fiele nicht darunter, ist aber an die Node-Fassung der BOX
 * gebunden, nicht an die des Entwicklerrechners (`autosetup.sh:349` haelt die
 * Box auf v22; hier laeuft v26). Ein Plugin, das auf der einen Maschine laeuft
 * und auf der anderen beim Import stirbt, ist schlimmer als eines, das
 * langsamer ist.
 *
 * WAS ES KOSTET: Bei den Groessen, um die es geht — ein paar hundert
 * Interpreten, je eine Handvoll Aehnlichkeitslisten — ist eine JSON-Datei im
 * Speicher schneller als jede Datenbank, weil sie einmal geladen und nie
 * abgefragt wird. Die Grenze liegt nicht bei der Geschwindigkeit, sondern beim
 * SPEICHER: ein Plugin hat 48 MB. Deshalb steht unten ein Deckel, und deshalb
 * faellt beim Ueberlauf das AELTESTE heraus.
 *
 * ══ WARUM UEBERHAUPT IN DEN DATENORDNER ═══════════════════════════════════
 *
 * `kontext.datenOrdner` ist nicht irgendein Pfad, sondern der eine, den das
 * Sicherungsnetz kennt (E65). Was daneben liegt, ist beim naechsten
 * Kartenschaden weg — und ein Zwischenspeicher, der bei jedem Neuaufsetzen
 * verschwindet, laesst die Box beim ersten Start in vier fremde Dienste
 * rennen, statt aus der Sicherung zu lesen.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Wie viele Eintraege eine Kartei hoechstens haelt.
 *
 * GEMESSEN, NICHT GERATEN: eine Aehnlichkeitsliste mit 100 Treffern wiegt als
 * JSON rund 8 KB. 2000 Eintraege sind damit ~16 MB — bei 48 MB Deckel und
 * ~11 MB Grundlast des Workers ist das die Stelle, an der es eng wird. Der
 * Deckel liegt bewusst darunter.
 */
export const EINTRAEGE_HOECHSTENS = 1000

/** Millisekunden je Tag — einmal hier, damit die Umrechnung nicht wandert. */
const TAG_MS = 24 * 60 * 60 * 1000

/**
 * Eine Kartei: eine JSON-Datei, im Speicher gehalten, verzoegert geschrieben.
 *
 * OHNE DATENORDNER LAEUFT SIE TROTZDEM — dann eben nur im Speicher, und beim
 * naechsten Plugin-Neustart ist sie leer. Das ist die Regel aus dem Handbuch:
 * „alles ausser Zustand ist mehr als nichts". Ein Plugin, das ohne Datenordner
 * gar nicht erst antwortet, waere in genau dem Moment kaputt, in dem die Box
 * ohnehin schon ein Problem hat.
 */
export class Kartei {
  #pfad
  #daten = new Map()
  #geladen = false
  #schmutzig = false

  constructor(datenOrdner, name) {
    this.#pfad = datenOrdner ? join(datenOrdner, `${name}.json`) : null
  }

  get fluechtig() {
    return this.#pfad === null
  }

  async laden() {
    if (this.#geladen) return
    this.#geladen = true
    if (!this.#pfad) return
    try {
      const roh = await readFile(this.#pfad, 'utf8')
      const gelesen = JSON.parse(roh)
      if (gelesen && typeof gelesen === 'object') {
        for (const [k, v] of Object.entries(gelesen)) this.#daten.set(k, v)
      }
    } catch (fehler) {
      // EINE FEHLENDE DATEI IST DER NORMALFALL (erster Start), und eine
      // KAPUTTE ist kein Grund, das Plugin zu beenden: ein Zwischenspeicher
      // darf jederzeit weggeworfen werden, das ist seine Natur. Wer hier
      // wirft, macht aus einem halben Stromausfall einen Totalausfall.
      if (fehler?.code !== 'ENOENT') this.#daten.clear()
    }
  }

  /**
   * Einen Eintrag holen — MIT der Auskunft, ob er noch frisch ist.
   *
   * `abgelaufen` ist kein Fehler und kein `null`: ein abgelaufener Eintrag ist
   * das, was die Box zeigt, wenn das Netz weg ist. Der Aufrufer entscheidet,
   * ob er ihn nimmt (und `stale` meldet) oder neu holt — diese Kartei
   * entscheidet das nicht fuer ihn.
   */
  holen(schluessel, haltbarkeitTage) {
    const eintrag = this.#daten.get(schluessel)
    if (!eintrag) return null
    const haltbar = Number(haltbarkeitTage)
    const alter = Date.now() - Number(eintrag.geholtAm ?? 0)
    const abgelaufen = Number.isFinite(haltbar) && haltbar > 0 ? alter > haltbar * TAG_MS : false
    return { wert: eintrag.wert, geholtAm: eintrag.geholtAm, abgelaufen }
  }

  setzen(schluessel, wert) {
    this.#daten.set(schluessel, { wert, geholtAm: Date.now() })
    this.#schmutzig = true
    // DER AELTESTE FAELLT, NICHT DER NAECHSTBESTE. `Map` haelt die
    // Einfuegereihenfolge, und `setzen` ueberschreibt ohne die Position zu
    // erneuern — deshalb wird beim Ueberschreiben erst geloescht.
    if (this.#daten.size > EINTRAEGE_HOECHSTENS) {
      const ueberzaehlig = this.#daten.size - EINTRAEGE_HOECHSTENS
      let i = 0
      for (const k of this.#daten.keys()) {
        if (i++ >= ueberzaehlig) break
        this.#daten.delete(k)
      }
    }
  }

  loeschen(schluessel) {
    if (this.#daten.delete(schluessel)) this.#schmutzig = true
  }

  /** Alles weg — der Weg hinter `DELETE …/cache`. */
  leeren() {
    this.#daten.clear()
    this.#schmutzig = true
  }

  eintraege() {
    return [...this.#daten.entries()].map(([schluessel, e]) => ({ schluessel, ...e }))
  }

  get groesse() {
    return this.#daten.size
  }

  /**
   * Schreiben — ueber eine Nebendatei und `rename`.
   *
   * WARUM NICHT DIREKT: ein Stromausfall mitten im `writeFile` hinterliesse
   * eine halbe JSON-Datei, und die naechste Ladung faende Schutt. `rename` ist
   * innerhalb eines Dateisystems unteilbar — entweder die alte Datei oder die
   * neue, nie eine dritte. Auf einer Box, die per Steckerziehen ausgeschaltet
   * wird, ist das kein akademischer Fall, sondern der Regelfall.
   */
  async sichern() {
    if (!this.#pfad || !this.#schmutzig) return
    const alsObjekt = Object.fromEntries(this.#daten)
    await mkdir(dirname(this.#pfad), { recursive: true })
    const neben = `${this.#pfad}.neu`
    await writeFile(neben, JSON.stringify(alsObjekt), 'utf8')
    await rename(neben, this.#pfad)
    this.#schmutzig = false
  }
}
