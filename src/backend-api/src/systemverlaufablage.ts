/**
 * Die Ablage des Systemverlaufs — was von der Reihe auf die SD-Karte geht.
 *
 * GETRENNT VON systemverlauf.ts, weil dort NICHTS mit der Welt zu tun sein
 * soll (dieselbe Trennung wie bei akkuverlauf.ts). Hier steht ausschliesslich
 * das Schreiben und Lesen, und zwar so, dass ein Werkzeug es unmittelbar
 * messen kann — `anhaengenAn` und `verdichten` geben zurueck, wie viele Bytes
 * sie herausgegeben haben.
 *
 * ══ EINE ZEILE JE PUNKT, ANGEHAENGT (JSON Lines) ═══════════════════════════
 *
 * Die Akkukurve legt ihre Reihe als EIN JSON-Feld ab und schreibt die GANZE
 * Datei neu, alle zehn Minuten. Diese hier haengt an. Zwei Gruende, beide
 * gerechnet bzw. am Geraet gesehen:
 *
 *  1. DIE KARTE. Bei 10 080 Punkten wiegt die Reihe rund ein halbes Megabyte.
 *     Sie sechsmal je Stunde vollstaendig neu zu schreiben sind ~26 GB im
 *     Jahr, die durch eine SD-Karte gehen, obwohl sich je Schreibvorgang zehn
 *     Zeilen geaendert haben. Anhaengen kostet ein paar Kilobyte je
 *     Schreibvorgang. Die Rechnung steht als Code in systemverlauf.ts
 *     (`aufwandAnhaengen` / `aufwandNeuschreiben`) und wird von
 *     tools/systemverlauf-am-server.ts gegen eine echte Messung gehalten.
 *
 *  2. DER STROMAUSFALL. Bei einer Datei, die EIN JSON-Wert ist, macht ein
 *     Stromausfall waehrend des Schreibens die GANZE Reihe unlesbar — genau
 *     das „Nullbyte-Fenster", das scripts/mupibox/mupibox-sicherung.py bei
 *     data.json und akkuverlauf.json ausdruecklich behandelt. Bei einer Zeile
 *     je Punkt kostet derselbe Ausfall EINE Zeile: `reiheLesen` wirft sie weg
 *     und behaelt den Rest. Das ist kein Nebeneffekt, sondern der Grund fuer
 *     das Format.
 *
 * WAS ANHAENGEN NICHT KANN: etwas wegwerfen. Die Datei waechst, bis sie
 * `verdichtet` wird — dann wird sie EINMAL ganz neu geschrieben und dabei auf
 * den Ring gekuerzt. Bei einem Ueberhang von 1440 Punkten ist das einmal am
 * Tag. Dieser eine Schreibvorgang ist auch der einzige Moment, in dem die
 * ganze Reihe auf dem Spiel steht — deshalb geht er ueber eine Nebendatei und
 * ein `rename` und nicht auf die Zieldatei.
 */
import fs from 'node:fs'
import { istPunkt, MAX_PUNKTE, MESS_MS, type Punkt } from './systemverlauf'

/**
 * Wie weit die Datei ueber den Ring hinauswachsen darf, bevor verdichtet wird.
 *
 * 1440 Punkte = ein Tag im Minutentakt. Kleiner waere haeufigeres
 * Neuschreiben (der teure Vorgang), groesser waere eine Datei, die beim
 * Starten laenger zu lesen ist und mehr Platz belegt. Ein Tag ist der Punkt,
 * an dem beides nicht mehr weh tut.
 */
// EIN TAG IN PUNKTEN DES JEWEILIGEN TAKTES (E61, 20.08.2026).
// Hier stand die feste 1440 — ein Tag im Minutentakt. Bliebe sie fest, wuerde
// bei feinerem Takt dreimal so oft verdichtet, und Verdichten schreibt die
// GANZE Datei neu: genau das teure Verfahren, das diese Anhaenge-Ablage
// vermeiden soll.
export const UEBERHANG = Math.round(86_400_000 / MESS_MS)

/** Der Dateiname — an einer Stelle, damit ihn Server und Werkzeug teilen. */
export const DATEINAME = 'systemverlauf.jsonl'

/** Eine Zeile fuer die Karte. */
export function zeileAus(p: Punkt): string {
  return `${JSON.stringify(p)}\n`
}

export interface Gelesen {
  punkte: Punkt[]
  /** Zeilen, die nichts hergaben (halb geschrieben, Nullbytes, Unfug). */
  verworfen: number
}

/**
 * Eine JSONL-Reihe aus Text lesen.
 *
 * JEDE ZEILE FUER SICH. Eine kaputte Zeile kostet einen Punkt und nicht die
 * Reihe — das ist der ganze Sinn des Formats. Gezaehlt wird, wie viele es
 * waren, damit ein Werkzeug es sehen kann und es nicht still passiert.
 *
 * Leere Zeilen zaehlen NICHT als verworfen: die letzte Zeile einer Datei, die
 * mit `\n` endet, ist immer leer, und das ist der Normalfall.
 */
export function reiheLesen(text: string): Gelesen {
  const punkte: Punkt[] = []
  let verworfen = 0
  for (const zeile of String(text ?? '').split('\n')) {
    // Nullbytes stehen im angebrochenen Block, wenn der Strom mitten im
    // Schreiben weg war. `trim()` entfernt sie nicht — `JSON.parse` scheitert
    // daran, und genau das ist gewollt.
    const roh = zeile.trim()
    if (!roh) continue
    try {
      const w: unknown = JSON.parse(roh)
      if (istPunkt(w)) punkte.push(w)
      else verworfen++
    } catch {
      verworfen++
    }
  }
  return { punkte, verworfen }
}

export interface Stand extends Gelesen {
  /** Wie viele Zeilen die Datei hat — die Zahl, an der die Verdichtung haengt. */
  zeilen: number
}

/**
 * Die Reihe von der Karte holen.
 *
 * Eine fehlende Datei ist KEIN Fehler (beim ersten Start gibt es sie nicht),
 * eine unlesbare auch nicht: dann faengt die Reihe eben neu an. Eine
 * Messreihe darf nie der Grund sein, warum der Server nicht hochkommt.
 */
export function ladenVon(pfad: string): Stand {
  let text = ''
  try {
    text = fs.readFileSync(pfad, 'utf8')
  } catch {
    return { punkte: [], verworfen: 0, zeilen: 0 }
  }
  const g = reiheLesen(text)
  return { ...g, zeilen: g.punkte.length + g.verworfen }
}

/**
 * Punkte anhaengen. Gibt die geschriebenen Bytes zurueck.
 *
 * KEIN fsync. Absichtlich: der Kernel darf mehrere Schreibvorgaenge zu einem
 * zusammenfassen, und das ist genau das, was die Karte schont. Der Preis ist
 * der letzte Puffer bei einem harten Ausschalten — bei einer Messreihe der
 * unschaedliche Teil, und dieselbe Abwaegung, die die Akkukurve mit ihrem
 * Zehn-Minuten-Takt trifft.
 */
export function anhaengenAn(pfad: string, punkte: ReadonlyArray<Punkt>): number {
  if (!punkte.length) return 0
  const text = punkte.map(zeileAus).join('')
  fs.appendFileSync(pfad, text)
  return Buffer.byteLength(text)
}

/** Ist die Datei ueber den Ring hinausgewachsen? Pure. */
export function mussVerdichten(zeilen: number, maxPunkte = MAX_PUNKTE, ueberhang = UEBERHANG): boolean {
  return zeilen > maxPunkte + ueberhang
}

/**
 * Die Datei einmal ganz neu schreiben und dabei auf den Ring kuerzen.
 * Gibt die geschriebenen Bytes zurueck.
 *
 * UEBER EINE NEBENDATEI UND `rename`, weil das der einzige Moment ist, in dem
 * die vollstaendige Reihe auf dem Spiel steht. Ginge der Strom mitten im
 * Neuschreiben der Zieldatei weg, waere alles weg; mit `rename` (auf
 * demselben Dateisystem unteilbar) ist entweder die alte oder die neue Datei
 * da. Genau das leistet `jsonfile.writeFile` bei der Akkukurve NICHT.
 */
export function verdichten(pfad: string, reihe: ReadonlyArray<Punkt>): number {
  const text = reihe.map(zeileAus).join('')
  const neben = `${pfad}.neu`
  fs.writeFileSync(neben, text)
  fs.renameSync(neben, pfad)
  return Buffer.byteLength(text)
}

/* c8 ignore next 3 */
declare const module: { exports: unknown } | undefined
if (typeof module !== 'undefined')
  module.exports = {
    zeileAus,
    reiheLesen,
    ladenVon,
    anhaengenAn,
    mussVerdichten,
    verdichten,
    UEBERHANG,
    DATEINAME,
  }
