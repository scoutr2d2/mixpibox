/**
 * DIE BOX-EIGENE INTERPRETENKENNUNG (E64b).
 *
 * Auftrag (Betreiber, 20.08.2026): „koennen wir nicht box intern eine
 * interpreten ID machen, an die wir einfach aufnahme und Spotify usw
 * knuepfen".
 *
 * ══ WARUM ES DAS BRAUCHT, OBWOHL E45 UND E49 SCHON DA WAREN ════════════════
 *
 * E45 hat entschieden: „Der NAME ist die Identitaet, nicht die Kennung" — und
 * das war richtig, denn eine Spotify-Kennung als Eintrittskarte liess die
 * Interpreten mit Spotify verschwinden. E49 hat den Schluessel dann so
 * geschaerft, dass „Die drei ???" und „Die drei !!!" auseinanderfallen.
 *
 * BEIDE LASSEN DIESELBE LUECKE: der Schluessel wird AUS DEM NAMEN abgeleitet.
 * Daraus folgen zwei Dinge, die sich nicht wegschaerfen lassen:
 *
 *   1. Heisst derselbe Interpret in zwei Quellen verschieden — bei Spotify
 *      „ARD Sounds", im Aufnahmeordner „Die Sendung mit der Maus" —, gibt es
 *      keine Stelle, an der beide zusammenkommen. Ein besserer Schluessel
 *      hilft da nicht: die Namen SIND verschieden.
 *   2. Aendert sich ein Name, aendert sich der Schluessel, und alles, was
 *      daran hing, verwaist still.
 *
 * Diese Ablage loest genau das und NICHTS SONST: eine Kennung, die der Box
 * gehoert, mit mehreren Namen und mehreren Dienstverweisen daran.
 *
 * ══ DIE RICHTUNG DES ZWEIFELSFALLS — UNVERAENDERT AUS E49 ══════════════════
 *
 * „Zwei Interpreten unter einem Schluessel ist ein stiller, nicht
 * zurueckholbarer Schaden; ein Interpret unter zwei Schluesseln ist eine
 * sichtbare Kachel zu viel."
 *
 * Deshalb VERWEIGERT `nameHinzufuegen` das Zusammenlegen, sobald der Name
 * schon zu einer anderen Kennung gehoert — es sei denn, ein Mensch sagt es
 * (`stufe: 'hand'`). Eine Maschine darf hier nicht grosszuegig sein: sie
 * wuerde die Aufnahmen eines Fremden unter einen bekannten Interpreten
 * haengen, und im Regal des Kindes sieht das aus wie Absicht.
 *
 * ══ WARUM DIE STUFE AN JEDER EINZELNEN VERKNUEPFUNG HAENGT ═════════════════
 *
 * Dieselbe Ueberlegung wie bei `Zuordnung.stufe` in verschmelzung.ts: die
 * Stufe ist keine Verzierung, sondern das, woran ein Mensch in der Verwaltung
 * ablesen soll, WEM er diese Verknuepfung zu verdanken hat. Eine geratene
 * Verbindung und eine von Hand gesetzte sehen sonst gleich aus — und dann
 * traut man beiden gleich viel, also der falschen zu viel.
 *
 * ══ WAS DIESES MODUL NICHT TUT ═════════════════════════════════════════════
 *
 * Es stellt KEINEN Verbraucher um. Die Freischaltungen (`interpreten.ts`), die
 * Verschmelzung und die Interpretenseite arbeiten unveraendert weiter ueber
 * den Namensschluessel. Dieser Block legt nur die Ablage und ihre Regeln an,
 * samt Wanderung aus dem Bestand — umgestellt wird erst, wenn das hier steht.
 *
 * Die Ablage wohnt in `interpreten.json` neben `frei` und `abgelehnt`, die
 * unberuehrt bleiben. Diese Datei liegt seit E65 im Sicherungsnetz; ohne sie
 * kaemen alle Entscheidungen der Box ueber ihre Interpreten wieder.
 */
import { interpretSchluesselAus } from './medien'

/** Woher eine Verknuepfung stammt. Reihenfolge = Verlaesslichkeit, absteigend. */
export const KENNUNG_STUFEN = ['hand', 'erkannt', 'wanderung'] as const
export type KennungStufe = (typeof KENNUNG_STUFEN)[number]

export function istKennungStufe(x: unknown): x is KennungStufe {
  return typeof x === 'string' && (KENNUNG_STUFEN as readonly string[]).includes(x)
}

/**
 * Die Kennung selbst: `int_` und zwoelf Hexziffern.
 *
 * SIE WIRD NICHT AUS DEM NAMEN ABGELEITET, und das ist der ganze Punkt. Ein
 * abgeleiteter Wert wandert mit dem, woraus er abgeleitet ist — genau daran
 * scheitert der Namensschluessel, wenn ein Interpret umbenannt wird.
 */
const ID_MUSTER = /^int_[0-9a-f]{12}$/

export function istKennungsId(x: unknown): x is string {
  return typeof x === 'string' && ID_MUSTER.test(x)
}

/**
 * Trennzeichen im zusammengesetzten Schluessel Dienst+Dienstkennung.
 *
 * KEIN LEERZEICHEN. Eine Dienstkennung darf Leerzeichen enthalten — ein
 * Aufnahmeordner heisst "music/Die Sendung mit der Maus" —, und dann fielen
 * zwei verschiedene Paare unter einen Schluessel. U+0000 kommt in keinem der
 * beiden Teile vor.
 *
 * ES STAND HIER ALS ROHES, UNSICHTBARES BYTE: im Quelltext nicht zu erkennen
 * und in jedem Diff ein Raetsel. Ein Trennzeichen, das man nicht sieht, ist
 * eines, das beim naechsten Anfassen versehentlich geaendert wird.
 */
const VERWEIS_TRENNER = '\u0000'

/** Ein Name, der zu dieser Kennung gehoert. Der erste ist der Anzeigename. */
export interface Namenseintrag {
  name: string
  stufe: KennungStufe
}

/** Was ein Dienst fuer diesen Interpreten fuehrt — Spotify-Id, Ordner, … */
export interface Dienstverweis {
  dienst: string
  kennung: string
  stufe: KennungStufe
}

export interface Interpretenkennung {
  id: string
  namen: Namenseintrag[]
  verweise: Dienstverweis[]
}

export interface Kennungsablage {
  kennungen: Interpretenkennung[]
}

export const KENNUNGSABLAGE_LEER: Kennungsablage = { kennungen: [] }

/**
 * Eine neue Kennung erzeugen.
 *
 * Der Zufall kommt als Parameter herein, damit Tests ihn festnageln koennen,
 * OHNE dass das Erzeugte dadurch vorhersagbar wird, wenn es zaehlt. Ein
 * Zaehler waere die naheliegende Alternative und die schlechtere: zwei Boxen,
 * die je fuer sich zaehlen, vergeben dieselbe Nummer an verschiedene
 * Interpreten, und das faellt erst beim Zusammenfuehren auf.
 */
export function neueId(zufall: () => string = standardZufall): string {
  const roh = String(zufall() ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
  // Zu kurz geratener Zufall wird aufgefuellt statt still eine ungueltige
  // Kennung zu ergeben — ungueltig faellt erst beim Lesen auf, und dann ist
  // die Verknuepfung schon geschrieben.
  const auffuellung = '0'.repeat(12)
  return `int_${(roh + auffuellung).slice(0, 12)}`
}

function standardZufall(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '')
}

/**
 * NUR STRINGS SIND NAMEN.
 *
 * `String(x)` waere der bequeme Weg und der falsche: aus der Zahl 42 in einer
 * Namensliste wuerde ein Interpret „42", und der stuende dann mit eigener
 * Kennung im Regal. Eine Zahl an dieser Stelle ist ein Datenfehler, kein Name
 * — und ein Datenfehler, den man in einen Eintrag verwandelt, ist hinterher
 * nicht mehr von einer Entscheidung zu unterscheiden.
 *
 * (Von einem Zeugen gefunden, nicht beim Schreiben bedacht.)
 */
function nameSauber(x: unknown): string {
  if (typeof x !== 'string') return ''
  return x.replace(/\s+/g, ' ').trim()
}

/**
 * Eine einzelne Kennung aus rohem JSON — oder `null`, wenn sie nicht taugt.
 *
 * OHNE GUELTIGE ID UND OHNE WENIGSTENS EINEN NAMEN gibt es nichts zu retten:
 * eine Kennung ohne Namen ist unauffindbar, eine ohne gueltige Id nicht
 * verknuepfbar. Beides still mitzuschleppen hiesse, einen Eintrag zu fuehren,
 * den niemand je trifft.
 */
export function kennungAus(roh: unknown): Interpretenkennung | null {
  if (!roh || typeof roh !== 'object') return null
  const r = roh as Record<string, unknown>
  if (!istKennungsId(r.id)) return null

  const namen: Namenseintrag[] = []
  const gesehen = new Set<string>()
  for (const n of Array.isArray(r.namen) ? r.namen : []) {
    const eintrag = n as Record<string, unknown> | null
    const name = nameSauber(eintrag?.name)
    if (!name) continue
    const schluessel = interpretSchluesselAus(name)
    // Derselbe Name zweimal ist keine zweite Information. Der erste gilt —
    // dieselbe Regel wie in `interpretenAblageAus`.
    if (!schluessel || gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    namen.push({ name, stufe: istKennungStufe(eintrag?.stufe) ? eintrag.stufe : 'wanderung' })
  }
  if (namen.length === 0) return null

  const verweise: Dienstverweis[] = []
  const verweisGesehen = new Set<string>()
  for (const v of Array.isArray(r.verweise) ? r.verweise : []) {
    const eintrag = v as Record<string, unknown> | null
    const dienst = nameSauber(eintrag?.dienst).toLowerCase()
    const kennung = nameSauber(eintrag?.kennung)
    if (!dienst || !kennung) continue
    const paar = `${dienst}${VERWEIS_TRENNER}${kennung}`
    if (verweisGesehen.has(paar)) continue
    verweisGesehen.add(paar)
    verweise.push({
      dienst,
      kennung,
      stufe: istKennungStufe(eintrag?.stufe) ? eintrag.stufe : 'wanderung',
    })
  }

  return { id: r.id, namen, verweise }
}

/**
 * Die ganze Ablage aus rohem JSON.
 *
 * ZWEI KENNUNGEN MIT DERSELBEN ID: die erste gilt. Zwei Kennungen, die
 * denselben NAMEN fuehren: ebenfalls die erste — und der Name faellt bei der
 * zweiten weg, nicht die ganze Kennung. Der Grund ist die Richtung des
 * Zweifelsfalls: eine Kennung, die einen Namen verliert, ist auffindbar
 * geblieben, solange sie einen zweiten hat; eine geloeschte Kennung nimmt
 * ihre Dienstverweise mit.
 */
export function kennungsablageAus(roh: unknown): Kennungsablage {
  const quelle = (roh && typeof roh === 'object' ? (roh as Record<string, unknown>) : {}).kennungen
  const kennungen: Interpretenkennung[] = []
  const ids = new Set<string>()
  const namensSchluessel = new Set<string>()

  for (const r of Array.isArray(quelle) ? quelle : []) {
    const k = kennungAus(r)
    if (!k || ids.has(k.id)) continue
    const namen = k.namen.filter((n) => !namensSchluessel.has(interpretSchluesselAus(n.name)))
    if (namen.length === 0) continue
    for (const n of namen) namensSchluessel.add(interpretSchluesselAus(n.name))
    ids.add(k.id)
    kennungen.push({ ...k, namen })
  }
  return { kennungen }
}

/** Namensschluessel -> Kennungs-Id. Der Weg, den jeder Verbraucher nehmen wird. */
export function namenKarte(ablage: Kennungsablage | null | undefined): Map<string, string> {
  const karte = new Map<string, string>()
  for (const k of ablage?.kennungen ?? []) {
    for (const n of k.namen) {
      const s = interpretSchluesselAus(n.name)
      if (s && !karte.has(s)) karte.set(s, k.id)
    }
  }
  return karte
}

/** Dienst + Dienstkennung -> Kennungs-Id. Der Weg fuer Aufnahme und Spotify. */
export function verweisKarte(ablage: Kennungsablage | null | undefined): Map<string, string> {
  const karte = new Map<string, string>()
  for (const k of ablage?.kennungen ?? []) {
    for (const v of k.verweise) {
      const s = `${v.dienst}${VERWEIS_TRENNER}${v.kennung}`
      if (!karte.has(s)) karte.set(s, k.id)
    }
  }
  return karte
}

export function kennungFuerNamen(ablage: Kennungsablage, name: unknown): string | null {
  const s = interpretSchluesselAus(nameSauber(name))
  return s ? (namenKarte(ablage).get(s) ?? null) : null
}

/**
 * Die Kennung hinter einem Dienstverweis — oder `null`.
 *
 * KEIN AUFRUFER AUSSER DER SPEC, UND DAS BLEIBT VORERST SO (19.09.2026,
 * AUDIT-2026-09-19 Rang 7). Das Audit hatte sie auf die Loeschliste gesetzt
 * mit der Begruendung, ihr eigener Kopf nenne den Abloeser. Er tut es nicht,
 * und es gibt keinen: sie ist die VERWEIS-Haelfte zu `kennungFuerNamen`
 * daneben. Die Namens-Haelfte ist verdrahtet (anlegen, umhaengen,
 * /api/interpretenkennungen), die Verweis-Haelfte noch nicht — E64b ist
 * halb gebaut, nicht tot.
 *
 * Zwei Dinge haengen zusaetzlich an ihr, die sonst niemand tut: der
 * Dienstname wird zum Nachschlagen KLEINGESCHRIEBEN (gespeichert wird
 * „spotify", gefragt wird oft „Spotify"), und der Trenner `VERWEIS_TRENNER`
 * bleibt modulintern. Wer sie loescht, muss entweder den Trenner
 * veroeffentlichen oder ein NUL-Byte in eine Spec schreiben — beides ist
 * teurer als die sechs Zeilen hier.
 */
export function kennungFuerVerweis(ablage: Kennungsablage, dienst: unknown, kennung: unknown): string | null {
  const d = nameSauber(dienst).toLowerCase()
  const k = nameSauber(kennung)
  if (!d || !k) return null
  return verweisKarte(ablage).get(`${d}${VERWEIS_TRENNER}${k}`) ?? null
}

/** Was eine aendernde Aufgabe zurueckgibt: die neue Ablage UND ob sie griff. */
export interface Ergebnis {
  ablage: Kennungsablage
  ok: boolean
  grund: string
  id: string | null
}

/**
 * Eine Kennung anlegen. Gibt es den Namen schon, wird NICHTS Neues angelegt —
 * die vorhandene Kennung kommt zurueck. Zwei Kennungen fuer denselben Namen
 * waeren die Sorte Dublette, die niemand mehr aufloest.
 */
export function anlegen(
  ablage: Kennungsablage,
  name: unknown,
  stufe: KennungStufe = 'hand',
  neueIdFn: () => string = () => neueId(),
): Ergebnis {
  const sauber = nameSauber(name)
  if (!sauber || !interpretSchluesselAus(sauber)) {
    return { ablage, ok: false, grund: 'kein brauchbarer Name', id: null }
  }
  const vorhanden = kennungFuerNamen(ablage, sauber)
  if (vorhanden) {
    return { ablage, ok: false, grund: `Name gehoert schon zu ${vorhanden}`, id: vorhanden }
  }
  let id = neueIdFn()
  if (!istKennungsId(id)) id = neueId()
  if (ablage.kennungen.some((k) => k.id === id)) {
    return { ablage, ok: false, grund: `Kennung ${id} ist vergeben`, id: null }
  }
  return {
    ablage: { kennungen: [...ablage.kennungen, { id, namen: [{ name: sauber, stufe }], verweise: [] }] },
    ok: true,
    grund: '',
    id,
  }
}

/**
 * Einen weiteren Namen an eine Kennung haengen.
 *
 * HIER SITZT DIE REGEL AUS E49. Gehoert der Name schon zu einer ANDEREN
 * Kennung, waere das Zusammenlegen zweier Interpreten — und das ist der
 * stille, nicht zurueckholbare Schaden. Eine Maschine (`erkannt`,
 * `wanderung`) wird deshalb abgewiesen; nur ein Mensch (`hand`) darf es, und
 * dann steht es hinterher als `hand` in der Ablage und ist ablesbar.
 */
export function nameHinzufuegen(
  ablage: Kennungsablage,
  id: string,
  name: unknown,
  stufe: KennungStufe = 'hand',
): Ergebnis {
  const sauber = nameSauber(name)
  const schluessel = interpretSchluesselAus(sauber)
  if (!schluessel) return { ablage, ok: false, grund: 'kein brauchbarer Name', id: null }
  const ziel = ablage.kennungen.find((k) => k.id === id)
  if (!ziel) return { ablage, ok: false, grund: `Kennung ${id} gibt es nicht`, id: null }

  const gehoert = kennungFuerNamen(ablage, sauber)
  if (gehoert === id) return { ablage, ok: true, grund: 'stand schon da', id }
  if (gehoert && stufe !== 'hand') {
    return {
      ablage,
      ok: false,
      grund: `Name gehoert zu ${gehoert} — Zusammenlegen braucht stufe hand`,
      id: gehoert,
    }
  }

  const kennungen = ablage.kennungen.map((k) => {
    if (k.id === id) return { ...k, namen: [...k.namen, { name: sauber, stufe }] }
    // Von Hand umgehaengt: der Name verlaesst seine alte Kennung, sonst
    // faende ihn `namenKarte` weiterhin dort (der erste gewinnt).
    if (gehoert && k.id === gehoert) {
      return { ...k, namen: k.namen.filter((n) => interpretSchluesselAus(n.name) !== schluessel) }
    }
    return k
  })
  // Eine Kennung, die dabei ihren letzten Namen verloren hat, faellt weg —
  // sie waere ueber keinen Namen mehr auffindbar.
  return { ablage: { kennungen: kennungen.filter((k) => k.namen.length > 0) }, ok: true, grund: '', id }
}

/**
 * Einen Dienstverweis setzen — Spotify-Kennung, Aufnahmeordner, Jellyfin-Id.
 *
 * Anders als beim Namen ist ein Verweis, der schon woanders haengt, KEIN
 * Zusammenlegen zweier Interpreten: er ist eine Korrektur an genau einer
 * Zuordnung. Er wandert deshalb, aber die alte Stelle wird geraeumt — sonst
 * zeigte derselbe Spotify-Interpret auf zwei Kennungen, und `verweisKarte`
 * entschiede nach Reihenfolge, also nach Zufall.
 */
export function verweisSetzen(
  ablage: Kennungsablage,
  id: string,
  dienst: unknown,
  dienstkennung: unknown,
  stufe: KennungStufe = 'hand',
): Ergebnis {
  const d = nameSauber(dienst).toLowerCase()
  const k = nameSauber(dienstkennung)
  if (!d || !k) return { ablage, ok: false, grund: 'Dienst oder Kennung fehlt', id: null }
  if (!ablage.kennungen.some((x) => x.id === id)) {
    return { ablage, ok: false, grund: `Kennung ${id} gibt es nicht`, id: null }
  }
  const kennungen = ablage.kennungen.map((x) => {
    const ohne = x.verweise.filter((v) => !(v.dienst === d && v.kennung === k))
    return x.id === id ? { ...x, verweise: [...ohne, { dienst: d, kennung: k, stufe }] } : { ...x, verweise: ohne }
  })
  return { ablage: { kennungen }, ok: true, grund: '', id }
}

/**
 * Aus dem Bestand wandern: fuer jeden vorhandenen Namen eine Kennung.
 *
 * EINMALWEG, KEIN ENDPUNKT — und das ist Absicht, nicht Vergessen
 * (festgehalten am 19.09.2026, AUDIT-2026-09-19 Rang 7, das sie als Export
 * ohne Aufrufer gezaehlt hat). Eine Wanderung laeuft EINMAL ueber einen
 * gewachsenen Bestand. Sie hinter eine Route zu haengen hiesse, dass sie
 * jemand zweimal ausloesen kann; ihr Platz ist ein Werkzeug, das ein Mensch
 * startet und dessen Ausgabe er liest. Wer den Lauf baut, ruft sie von dort
 * und schreibt das Ergebnis EINMAL zurueck.
 *
 * SIE LEGT NICHTS ZUSAMMEN. Die Wanderung weiss nicht, ob „ARD Sounds" und
 * „Die Maus" derselbe sind — das ist gerade die Frage, die ein Mensch spaeter
 * beantwortet. Sie stellt nur sicher, dass jeder Name, den die Box heute
 * kennt, eine Kennung HAT, an die sich danach etwas haengen laesst. Alles
 * Weitere waere Raten mit dem Anschein von Ordnung.
 */
export function ausNamenWandern(
  ablage: Kennungsablage,
  namen: readonly unknown[] | null | undefined,
  neueIdFn: () => string = () => neueId(),
): { ablage: Kennungsablage; angelegt: string[] } {
  let stand = ablage
  const angelegt: string[] = []
  for (const n of Array.isArray(namen) ? namen : []) {
    const e = anlegen(stand, n, 'wanderung', neueIdFn)
    if (e.ok && e.id) {
      stand = e.ablage
      angelegt.push(e.id)
    }
  }
  return { ablage: stand, angelegt }
}
