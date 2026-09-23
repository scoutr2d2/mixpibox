/**
 * DIE LISTE AUF DIE PLATTE UND ZURUECK (E66/E73).
 *
 * `liste.mjs` ist rein — sie kennt kein Dateisystem. Hier steht der schmutzige
 * Teil, und er steht getrennt, damit die Regeln ohne Platte pruefbar bleiben.
 *
 * Abgelegt wird in `kontext.datenOrdner`, dem Ordner, den der Plugin-Wirt je
 * Kennung anlegt und den das Sicherungsnetz kennt (`plugin-daten/*`).
 *
 * ══ WARUM NICHT atomar.ts AUS DEM BACKEND ══════════════════════════════════
 *
 * Weil ein Plugin eine .mjs ist, die im Worker geladen wird, und das Backend
 * TypeScript. Der Weg dorthin fuehrte ueber einen Bauschritt, den ein Plugin
 * nicht hat. Die drei Gruende sind aber DIESELBEN, und sie stehen dort
 * ausfuehrlich — hier nur die Kurzfassung:
 *
 *   1. DER ZAEHLER, NICHT NUR DIE PROZESSKENNUNG. Ohne ihn teilen sich zwei
 *      gleichzeitige Schreiber dieselbe Zwischendatei.
 *   2. UMBENENNEN IM GLEICHEN VERZEICHNIS — nur dort ist es unteilbar.
 *   3. DIE RECHTE AN EINER STELLE.
 *
 * ══ DIE UNTERSCHEIDUNG, AN DER ALLES HAENGT ════════════════════════════════
 *
 * Beim Laden gibt es DREI Ausgaenge, nicht zwei:
 *
 *   NICHT DA        -> leere Liste, alles in Ordnung. Erster Start.
 *   NICHT LESBAR    -> leere Liste, aber `unsicher: true`. Es DARF NICHT
 *                      geschrieben werden: die Datei ist da, wir kommen nur
 *                      nicht heran (Rechte, Ein-/Ausgabefehler). Wer jetzt
 *                      eine leere Liste darueberschreibt, loescht den Bestand
 *                      und die Box nimmt alles ein zweites Mal auf.
 *   NICHT LESBAR ALS JSON -> die kaputte Datei wird BEISEITEGELEGT, dann leer
 *                      weiter. Sie zu ueberschreiben hiesse, den einzigen
 *                      Zeugen zu vernichten; sie liegen zu lassen hiesse, bei
 *                      jedem Start daran zu scheitern.
 *
 * Das ist dieselbe Regel wie bei `abgleichen()`: ein Fehler heisst „unbekannt",
 * nicht „nichts da".
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { LISTE_LEER, listeAus } from './liste.mjs'

export const LISTE_DATEI = 'liste.json'

/** Fortlaufend fuer den ganzen Prozess, nicht je Datei. */
let lauf = 0

/** Nur fuer Tests. */
export function laufZuruecksetzen() {
  lauf = 0
}

/** Der Name der Zwischendatei. Rein, damit die Eindeutigkeit pruefbar ist. */
export function zwischenname(ziel, pid = process.pid) {
  return `${ziel}.${pid}.${++lauf}.tmp`
}

/** Wohin die Liste gehoert — oder `null`, wenn es keinen Datenordner gibt. */
export function listenpfad(ordner) {
  const o = typeof ordner === 'string' ? ordner.trim() : ''
  return o ? join(o, LISTE_DATEI) : null
}

/**
 * Die Liste laden.
 *
 * Gibt immer `{ liste, grund, unsicher }`. `unsicher` heisst: NICHT schreiben.
 */
export async function listeLaden(ordner) {
  const pfad = listenpfad(ordner)
  if (!pfad) return { liste: LISTE_LEER, grund: 'kein Datenordner — die Liste bleibt im Arbeitsspeicher', unsicher: true }

  let roh
  try {
    roh = await readFile(pfad, 'utf8')
  } catch (f) {
    // ENOENT ist der Normalfall beim ersten Start und kein Fehler.
    if (f?.code === 'ENOENT') return { liste: LISTE_LEER, grund: '', unsicher: false }
    return { liste: LISTE_LEER, grund: `Liste nicht lesbar (${f?.code || f?.message}) — es wird nichts geschrieben`, unsicher: true }
  }

  try {
    return { liste: listeAus(JSON.parse(roh)), grund: '', unsicher: false }
  } catch (f) {
    // KAPUTT, ABER VORHANDEN. Beiseitelegen statt ueberschreiben — wer sie
    // spaeter ansieht, kann Eintraege von Hand zurueckholen.
    const beiseite = `${pfad}.kaputt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      await rename(pfad, beiseite)
      return { liste: LISTE_LEER, grund: `Liste war unlesbar (${f.message}) — beiseitegelegt nach ${beiseite}`, unsicher: false }
    } catch (g) {
      // Nicht einmal das ging. Dann erst recht nicht schreiben.
      return { liste: LISTE_LEER, grund: `Liste unlesbar und nicht beiseitezulegen (${g?.code || g?.message})`, unsicher: true }
    }
  }
}

/** Die Liste unteilbar schreiben. Gibt `{ ok, grund }`. */
export async function listeSchreiben(ordner, liste, mode = 0o644) {
  const pfad = listenpfad(ordner)
  if (!pfad) return { ok: false, grund: 'kein Datenordner' }
  const tmp = zwischenname(pfad)
  try {
    await mkdir(ordner, { recursive: true })
    // ZWEI LEERZEICHEN EINRUECKUNG, wie ueberall auf dieser Box: diese Dateien
    // sind ausdruecklich dafuer da, von Hand gelesen und berichtigt zu werden.
    await writeFile(tmp, JSON.stringify(liste ?? LISTE_LEER, null, 2), { mode })
    await rename(tmp, pfad)
    return { ok: true, grund: '' }
  } catch (f) {
    return { ok: false, grund: f?.message || String(f) }
  }
}

/**
 * LESEN, RECHNEN, ZURUECKSCHREIBEN — als EINE Reihe.
 *
 * Der Grund steht schon in atomar.ts: unteilbares Schreiben macht die DATEI
 * heil, nicht die ENTSCHEIDUNG. Zwei Vormerkungen, die sich ueberlappen, laden
 * sonst beide denselben Stand, und die zweite schreibt die erste weg —
 * unteilbar und vollstaendig, aber um einen Eintrag aermer.
 *
 * Das Plugin ist einfaedig, aber `await` ist eine Naht: zwischen dem Laden und
 * dem Schreiben laeuft der naechste Takt. Genau dort passiert es.
 *
 * `aendern(liste)` bekommt den geladenen Stand und gibt den neuen zurueck —
 * oder `null`, wenn nichts zu tun ist. Dann wird auch nicht geschrieben.
 */
let reihe = Promise.resolve()

export function mitListe(ordner, aendern) {
  const naechste = reihe.then(async () => {
    const geladen = await listeLaden(ordner)
    const neu = await aendern(geladen.liste, geladen)
    if (!neu) return { ...geladen, geschrieben: false }
    if (geladen.unsicher) {
      // Der ganze Sinn von `unsicher`: hier NICHT schreiben.
      return { ...geladen, liste: neu, geschrieben: false }
    }
    const w = await listeSchreiben(ordner, neu)
    return { liste: neu, grund: w.ok ? geladen.grund : w.grund, unsicher: false, geschrieben: w.ok }
  })
  // Die Reihe darf nicht abreissen, wenn ein Glied wirft — sonst haengt jede
  // spaetere Aenderung an einer abgelehnten Zusage fest.
  reihe = naechste.then(
    () => undefined,
    () => undefined,
  )
  return naechste
}
