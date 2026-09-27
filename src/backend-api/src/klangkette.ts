/**
 * DIE KLANGKETTE — was ein Ton-Plugin beschreiben darf, und was daraus wird.
 *
 * ══ DER FALL, WEGEN DEM ES DAS GIBT ═══════════════════════════════════════
 * Betreiber, 21.08.2026: „ich habe die boxen so angebracht das sie seitlich
 * rausstrahlen leicht angewinkelt nach vorne wenn man direkt davor sitzt
 * macht es ein komisches hörgefühl kann man da software seitig was machen.
 * Gibt es sowas wie ‚dolby‘ aber open source um den sound zu verbessern" —
 * und danach: „bitte implementiere ein plugin für den sound der beides
 * ermöglicht".
 *
 * „Beides" sind die zwei Hebel, die bei seitlicher Abstrahlung wirken:
 *   1. die STEREOBASIS verengen — bei grossem Oeffnungswinkel und kurzem
 *      Abstand hoert jedes Ohr fast nur seinen Lautsprecher, die Mitte
 *      (Gesang!) zerfaellt nach links und rechts. Das braucht eine
 *      KANALMATRIX, und die kann der Fuenfband-Entzerrer nicht: er rechnet
 *      je Kanal, er mischt nicht zwischen ihnen.
 *   2. den KLANG entzerren — off-axis fehlt Hochton, und kleine Chassis
 *      geben unter ~120 Hz nichts ausser Hub.
 *
 * ══ WARUM EIN VOKABULAR UND KEINE FREIE PIPEWIRE-CONF ═════════════════════
 * Der naheliegende Entwurf waere: das Plugin liefert `filter.graph`-Text, der
 * Kern schreibt ihn in eine Datei. Das ist genau die Falle, die der
 * Plugin-Vertrag sonst ueberall vermeidet (siehe den Kopf von
 * plugin-vertrag.ts): die Datei wird von einem Prozess gelesen, der Module
 * nachlaedt (`convolver` nimmt einen DATEIPFAD, `ladspa` eine fremde .so) —
 * ein Plugin schriebe sich damit am Kern vorbei beliebigen Code in den
 * Tonstapel. Und ein Tippfehler darin ist eine STUMME BOX, die erst auffaellt,
 * wenn ein Kind davorsteht.
 *
 * Deshalb beschreibt ein Plugin GLIEDER aus einer geschlossenen Liste, und
 * diese Datei uebersetzt sie. Was hier nicht steht, gibt es nicht. Dieselbe
 * Haltung wie `fundPruefen`: im Zweifel wird nicht gebaut.
 *
 * ══ DIE BAUSTEINE SIND NACHGEMESSEN, NICHT ANGENOMMEN ═════════════════════
 * Die builtin-Label stammen aus der Bibliothek selbst (21.08.2026,
 * libspa-filter-graph-plugin-builtin.so, PipeWire 1.6.8):
 *
 *   bq_allpass bq_bandpass bq_highpass bq_highshelf bq_instantiate bq_lowpass
 *   bq_lowshelf bq_notch bq_peaking bq_raw clamp convolver copy dcblock debug
 *   invert linear mixer mult param_eq recip sine
 *
 * Benutzt werden nur `copy`, `mixer` und die `bq_*` — sie gibt es seit
 * 0.3.x, also auch auf der aelteren Fassung der Box. `clamp` waere ein harter
 * Begrenzer (Clipping, keine Attack/Release) — bewusst NICHT im Vokabular:
 * ein Glied, das Verzerrung erzeugt und dabei „Begrenzer" heisst, waere eine
 * Falle. Wer Luft gegen Uebersteuern braucht, nimmt `vorpegel`.
 *
 * ══ REIN ══════════════════════════════════════════════════════════════════
 * Kein Dateisystem, kein Prozess, kein Netz. Herein kommt, was ein Plugin
 * gesagt hat, heraus kommt ein Urteil und ein Text. Wer die Datei schreibt
 * und den Prozess faehrt, steht in server.ts.
 */

/** Die Glieder, die es gibt. Die Liste IST die Grenze. */
export const GLIEDARTEN = [
  'basis',
  'hochpass',
  'tiefpass',
  'kuhschwanz',
  'glocke',
  'vorpegel',
  'kompressor',
  'begrenzer',
] as const
export type Gliedart = (typeof GLIEDARTEN)[number]

/* ══ DIE ZWEI GLIEDER AUS FREMDEM HAUS (21.08.2026) ════════════════════════
 *
 * Betreiber: „ich denke wir machen 1 und 2" — Kompressor und Begrenzer, damit
 * Hoerspiele nicht zwischen fluesterndem Dialog und knallender Musik
 * schwanken, und damit die 3-W-Chassis geschuetzt sind.
 *
 * PIPEWIRE HAT DAFUER NICHTS EIGENES. Die builtins kennen nur `clamp`, und
 * das ist hartes Clipping — ein „Begrenzer", der Verzerrung erzeugt, waere
 * eine Falle. Gebraucht werden echte Dynamikwerkzeuge, und die kommen aus
 * LADSPA (swh-plugins, 6,7 MB, auf der Box installiert am 21.08.2026).
 *
 * ══ UND DAS IST KEIN WIDERSPRUCH ZUM RIEGEL ═══════════════════════════════
 * Weiter oben steht: kein freier `filter.graph`-Text, weil `convolver` und
 * `ladspa` Dateien nachladen. Das gilt WEITER — fuer PLUGINS. Ein Fremdplugin
 * beschreibt nach wie vor nur `{ art: 'kompressor', … }` und kann keinen Pfad
 * angeben; WELCHE .so geladen wird, entscheidet allein diese Datei, und die
 * Liste unten ist geschlossen.
 *
 * Der Unterschied ist der zwischen „das Plugin darf eine Datei benennen" und
 * „der Kern benutzt eine Datei, die er selbst gewaehlt hat".
 *
 * ══ AM GERAET GEMESSEN, NICHT GERATEN ═════════════════════════════════════
 * Drei Dinge, die man nicht erraten kann und die beim ersten Versuch
 * scheiterten:
 *   1. `plugin` braucht den VOLLEN PFAD. Mit dem Kurznamen „sc4" bricht
 *      PipeWire ab („failed to load plugin 'sc4'"), und ohne LADSPA_PATH
 *      sucht es nirgends.
 *   2. Die Label heissen `sc4` und `fastLookaheadLimiter` — nicht wie die
 *      Dateien (`sc4_1882.so`, `fast_lookahead_limiter_1913.so`).
 *   3. BEIDE SIND STEREO-KNOTEN. Sie tragen „Left input"/„Right input" bzw.
 *      „Input 1"/„Input 2" und werden EINMAL gebaut — anders als die `bq_*`,
 *      die je Kanal instanziiert werden. Der Conf-Bau muss beides koennen.
 * Gemessen lief die Kette mit 0,3 % CPU und 8 MB.
 */
export interface LadspaBaustein {
  /** Volle Pfade, in der Reihenfolge, in der gesucht wird. */
  pfade: string[]
  label: string
  /** Anschlussnamen: links/rechts hinein, links/rechts hinaus. */
  ein: [string, string]
  aus: [string, string]
}

/**
 * Die LADSPA-Bausteine, die der Kern benutzen DARF. Geschlossene Liste.
 *
 * MEHRERE PFADE, WEIL DIE DATEINAMEN EINE NUMMER TRAGEN: `sc4_1882.so` ist
 * die LADSPA-Kennung, und eine andere Fassung des Pakets koennte sie
 * aendern. Gefunden wird der erste Pfad, den es gibt; gibt es keinen, faellt
 * das Glied heraus (siehe `ketteConfBauen`) — die uebrige Kette bleibt.
 */
export const LADSPA: Record<'kompressor' | 'begrenzer', LadspaBaustein> = {
  kompressor: {
    pfade: ['/usr/lib/ladspa/sc4_1882.so', '/usr/lib/aarch64-linux-gnu/ladspa/sc4_1882.so'],
    label: 'sc4',
    ein: ['Left input', 'Right input'],
    aus: ['Left output', 'Right output'],
  },
  begrenzer: {
    pfade: [
      '/usr/lib/ladspa/fast_lookahead_limiter_1913.so',
      '/usr/lib/aarch64-linux-gnu/ladspa/fast_lookahead_limiter_1913.so',
    ],
    label: 'fastLookaheadLimiter',
    ein: ['Input 1', 'Input 2'],
    aus: ['Output 1', 'Output 2'],
  },
}

/**
 * Ein Glied der Kette.
 *
 * `basis` ist das einzige, das die Kanaele KREUZT — alle anderen rechnen
 * links und rechts getrennt und werden deshalb doppelt gebaut.
 */
export type Klangglied =
  /**
   * Stereobasis: 100 = unveraendert, 0 = Mono.
   *
   * Die Matrix ist L' = a·L + b·R mit a = 0,5 + breite/200 und
   * b = 0,5 − breite/200. Bei 100 ergibt das a=1/b=0 (nichts passiert), bei 0
   * a=b=0,5 (echtes Mono), bei 50 die 0,75/0,25, die als erster Schritt
   * empfohlen wurde. Ueber 100 gibt es NICHT: eine Verbreiterung zieht die
   * Mitte auseinander, und genau die soll hier zurueckkommen.
   */
  | { art: 'basis'; breite: number }
  | { art: 'hochpass'; freq: number; guete?: number }
  | { art: 'tiefpass'; freq: number; guete?: number }
  /** Kuhschwanz (Shelf): hebt/senkt alles unterhalb ('tief') bzw. oberhalb ('hoch'). */
  | { art: 'kuhschwanz'; lage: 'tief' | 'hoch'; freq: number; dB: number; guete?: number }
  /** Glocke (Peaking): hebt/senkt um `freq` herum. */
  | { art: 'glocke'; freq: number; dB: number; guete?: number }
  /** Vorpegel in dB (nur daempfend) — Luft gegen Uebersteuern nach Anhebungen. */
  | { art: 'vorpegel'; dB: number }
  /**
   * Kompressor (LADSPA sc4) — gegen den Sprung vom Fluestern zum Knall.
   *
   * DER FALL SIND HOERSPIELE: leiser Dialog, dann Musik. Das Kind dreht wegen
   * des Dialogs auf, und die naechste Szene knallt. Ein Kompressor holt die
   * Spitzen herunter und hebt mit `makeup` das Ganze wieder an — die leisen
   * Stellen kommen naeher heran, ohne dass die lauten lauter werden.
   *
   * `verhaeltnis` 1 heisst „nichts tun" (1:1). Bei Sprache sind 2 bis 4
   * ueblich; darueber wird es hoerbar gepresst.
   */
  | {
      art: 'kompressor'
      /** Ab welchem Pegel gearbeitet wird, in dB (negativ). */
      schwelle: number
      /** 1 bis 20. Wieviel ueber der Schwelle zusammengedrueckt wird. */
      verhaeltnis: number
      /** Wie schnell er zupackt, in ms. */
      anstieg?: number
      /** Wie schnell er loslaesst, in ms. Zu kurz „pumpt". */
      abfall?: number
      /** Was danach wieder aufgeholt wird, in dB. */
      makeup?: number
    }
  /**
   * Begrenzer (LADSPA fast_lookahead_limiter) — die harte Decke.
   *
   * ER SCHUETZT DIE CHASSIS und ist etwas anderes als der Vorpegel: der
   * daempft IMMER, der Begrenzer nur, wenn es zu laut wird. Mit Vorausschau,
   * also ohne das Knacken eines harten Clippings.
   */
  | {
      art: 'begrenzer'
      /** Die Decke in dB (negativ, typisch -1 bis -3). */
      grenze: number
      /** Wie schnell er loslaesst, in Sekunden. */
      abfall?: number
    }

/**
 * Wieviele Glieder eine Kette haben darf.
 *
 * Nicht der Ordnung wegen: jedes Glied ist zwei Filterknoten (links/rechts),
 * die auf der Box in JEDEM Puffer gerechnet werden. Eine Kette aus hundert
 * Gliedern waere kein Fehler, den PipeWire meldet — sie waere Aussetzer im
 * Hoerspiel, und niemand suchte die Ursache hier.
 */
export const GLIEDER_HOECHSTENS = 16

/** Hoerbarer Bereich, grosszuegig gefasst. Ausserhalb ist es kein Regler mehr. */
const FREQ_MIN = 20
const FREQ_MAX = 20000
/** Mehr als ±24 dB ist kein Entzerren mehr, sondern ein Defekt. */
const DB_GRENZE = 24
const GUETE_MIN = 0.1
const GUETE_MAX = 10
const GUETE_VORGABE = 1.0

export interface KetteUrteil {
  ok: boolean
  kette: Klangglied[]
  /** Alle Maengel auf einmal — wie im Manifest-Vertrag, nicht nur der erste. */
  maengel: string[]
}

function zahlIm(wert: unknown, min: number, max: number): number | null {
  const n = Number(wert)
  if (!Number.isFinite(n)) return null
  if (n < min || n > max) return null
  return n
}

/**
 * Was ein Plugin geliefert hat, in eine gueltige Kette verwandeln — oder
 * ablehnen. Pure.
 *
 * NACHSICHTIG IST HIER FALSCH. Bei einer Medienquelle heisst „krumm" ein
 * Titel, der nicht spielt; hier hiesse es eine Filterkette, die PipeWire
 * beim Start abweist — und dann ist die Senke weg, auf die der Ton geroutet
 * wurde. Also: ein krummer Wert ist ein Mangel, kein Anlass zum Runden.
 * Fehlende OPTIONALE Werte (`guete`) bekommen dagegen ihre Vorgabe.
 */
export function kettePruefen(roh: unknown): KetteUrteil {
  const maengel: string[] = []
  if (roh === undefined || roh === null) return { ok: true, kette: [], maengel: [] }
  if (!Array.isArray(roh)) {
    return { ok: false, kette: [], maengel: ['Eine Klangkette muss eine Liste von Gliedern sein.'] }
  }
  if (roh.length > GLIEDER_HOECHSTENS) {
    return {
      ok: false,
      kette: [],
      maengel: [`Die Kette hat ${roh.length} Glieder — hoechstens ${GLIEDER_HOECHSTENS} sind erlaubt.`],
    }
  }

  const kette: Klangglied[] = []
  roh.forEach((eintrag, i) => {
    const wo = `Glied ${i + 1}`
    if (!eintrag || typeof eintrag !== 'object') {
      maengel.push(`${wo} ist kein Objekt.`)
      return
    }
    const g = eintrag as Record<string, unknown>
    const art = g.art
    if (typeof art !== 'string' || !(GLIEDARTEN as readonly string[]).includes(art)) {
      maengel.push(`${wo} hat die Art "${String(art)}" — erlaubt: ${GLIEDARTEN.join(', ')}.`)
      return
    }

    // `guete` gilt fuer mehrere Arten, deshalb einmal vorweg.
    let guete = GUETE_VORGABE
    if (g.guete !== undefined) {
      const q = zahlIm(g.guete, GUETE_MIN, GUETE_MAX)
      if (q === null) {
        maengel.push(`${wo}: guete muss zwischen ${GUETE_MIN} und ${GUETE_MAX} liegen.`)
        return
      }
      guete = q
    }

    const freqLesen = (): number | null => {
      const f = zahlIm(g.freq, FREQ_MIN, FREQ_MAX)
      if (f === null) maengel.push(`${wo}: freq muss zwischen ${FREQ_MIN} und ${FREQ_MAX} Hz liegen.`)
      return f
    }
    const dbLesen = (): number | null => {
      const d = zahlIm(g.dB, -DB_GRENZE, DB_GRENZE)
      if (d === null) maengel.push(`${wo}: dB muss zwischen -${DB_GRENZE} und ${DB_GRENZE} liegen.`)
      return d
    }

    switch (art) {
      case 'basis': {
        const b = zahlIm(g.breite, 0, 100)
        if (b === null) {
          maengel.push(`${wo}: breite muss zwischen 0 (Mono) und 100 (unveraendert) liegen.`)
          return
        }
        kette.push({ art: 'basis', breite: b })
        return
      }
      case 'hochpass':
      case 'tiefpass': {
        const f = freqLesen()
        if (f === null) return
        kette.push({ art, freq: f, guete })
        return
      }
      case 'kuhschwanz': {
        const lage = g.lage
        if (lage !== 'tief' && lage !== 'hoch') {
          maengel.push(`${wo}: lage muss "tief" oder "hoch" sein.`)
          return
        }
        const f = freqLesen()
        const d = dbLesen()
        if (f === null || d === null) return
        kette.push({ art: 'kuhschwanz', lage, freq: f, dB: d, guete })
        return
      }
      case 'glocke': {
        const f = freqLesen()
        const d = dbLesen()
        if (f === null || d === null) return
        kette.push({ art: 'glocke', freq: f, dB: d, guete })
        return
      }
      case 'vorpegel': {
        // NUR DAEMPFEND: ein „Vorpegel" von +6 dB waere ein Lautmacher, der
        // den eingemessenen Deckel der Ton-Seite hinterruecks aushebelt.
        const d = zahlIm(g.dB, -DB_GRENZE, 0)
        if (d === null) {
          maengel.push(`${wo}: vorpegel darf nur daempfen — dB zwischen -${DB_GRENZE} und 0.`)
          return
        }
        kette.push({ art: 'vorpegel', dB: d })
        return
      }
      case 'kompressor': {
        // DIE GRENZEN SIND DIE DES BAUSTEINS (sc4), nicht ausgedacht: Schwelle
        // -30..0 dB, Verhaeltnis 1..20, Anstieg 1,5..400 ms, Abfall 2..800 ms,
        // Makeup 0..24 dB. Ein Wert ausserhalb waere kein Fehler, den LADSPA
        // meldet — er wuerde still eingefangen, und der Regler zeigte etwas
        // anderes als der Klang tut.
        const schwelle = zahlIm(g.schwelle, -30, 0)
        const verhaeltnis = zahlIm(g.verhaeltnis, 1, 20)
        if (schwelle === null || verhaeltnis === null) {
          maengel.push(`${wo}: kompressor braucht schwelle (-30..0 dB) und verhaeltnis (1..20).`)
          return
        }
        const anstieg = g.anstieg === undefined ? 10 : zahlIm(g.anstieg, 1.5, 400)
        const abfall = g.abfall === undefined ? 200 : zahlIm(g.abfall, 2, 800)
        const makeup = g.makeup === undefined ? 0 : zahlIm(g.makeup, 0, 24)
        if (anstieg === null || abfall === null || makeup === null) {
          maengel.push(`${wo}: kompressor — anstieg 1,5..400 ms, abfall 2..800 ms, makeup 0..24 dB.`)
          return
        }
        kette.push({ art: 'kompressor', schwelle, verhaeltnis, anstieg, abfall, makeup })
        return
      }
      case 'begrenzer': {
        // Grenze -20..0 dB, Abfall 0,01..2 s — die Spanne von
        // fast_lookahead_limiter.
        const grenze = zahlIm(g.grenze, -20, 0)
        if (grenze === null) {
          maengel.push(`${wo}: begrenzer braucht grenze zwischen -20 und 0 dB.`)
          return
        }
        const abfall = g.abfall === undefined ? 0.2 : zahlIm(g.abfall, 0.01, 2)
        if (abfall === null) {
          maengel.push(`${wo}: begrenzer — abfall zwischen 0,01 und 2 s.`)
          return
        }
        kette.push({ art: 'begrenzer', grenze, abfall })
        return
      }
    }
  })

  return { ok: maengel.length === 0, kette: maengel.length === 0 ? kette : [], maengel }
}

/** Die Matrixfaktoren einer Stereobasis. Pure — getrennt, damit prüfbar. */
export function basisFaktoren(breite: number): { eigen: number; ueber: number } {
  const b = Math.max(0, Math.min(100, breite))
  return { eigen: 0.5 + b / 200, ueber: 0.5 - b / 200 }
}

/** dB in einen linearen Faktor. Pure. */
export function dbFaktor(dB: number): number {
  return 10 ** (dB / 20)
}

/** Auf vier Nachkommastellen, ohne Exponentialschreibweise — PipeWire liest Text. */
function zahl(n: number): string {
  return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0')
}

interface Knoten {
  zeile: string
  /** Anschlussname des Ausgangs, z. B. `hp_l:Out`. */
  aus: string
}

/**
 * Ein `bq_*`-Knoten fuer einen Kanal.
 *
 * DIE CONTROL-NAMEN SIND DIE AUS DER BESTEHENDEN KETTE (61-entzerrer.conf,
 * am Geraet in Betrieb): "Freq", "Q", "Gain". Nicht neu erfunden — wer sie
 * anders schreibt, bekommt keinen Fehler, sondern einen Filter, der auf
 * seiner Vorgabe stehen bleibt.
 */
function bqKnoten(name: string, label: string, freq: number, guete: number, dB?: number): Knoten {
  const steuer =
    dB === undefined
      ? `control = { "Freq" = ${zahl(freq)} "Q" = ${zahl(guete)} }`
      : `control = { "Freq" = ${zahl(freq)} "Q" = ${zahl(guete)} "Gain" = ${zahl(dB)} }`
  return { zeile: `          { type = builtin label = ${label} name = ${name} ${steuer} }`, aus: `${name}:Out` }
}

export interface KetteConfGaben {
  /** Name der Senke, in die alles hineinspielt. */
  sinkName: string
  /** Name des Ausgangsknotens — auf ihn zielt `move-sink-input`. */
  ausgangName: string
  /** Was in der Lautstaerkeanzeige des Systems steht. */
  beschreibung: string
  /**
   * Prueft, ob eine Datei da ist — fuer die LADSPA-Bausteine.
   *
   * ══ WARUM DAS HEREINGEREICHT WIRD UND NICHT `fs` HIER STEHT ══════════════
   * Diese Datei ist REIN (kein Dateisystem, kein Netz, kein Prozess), und das
   * ist der Grund, warum sie ohne Box pruefbar ist. Ein `existsSync` mittendrin
   * machte aus jedem Test eine Aussage ueber den Rechner, auf dem er laeuft.
   *
   * FEHLT SIE, WIRD ANGENOMMEN, DASS ALLES DA IST. Das ist die richtige
   * Vorgabe fuer Tests; der Server reicht die echte Pruefung herein.
   */
  gibtDatei?: (pfad: string) => boolean
}

/**
 * Der erste vorhandene Pfad eines Bausteins — oder null. Pure.
 *
 * NULL HEISST: DAS GLIED FAELLT HERAUS, die uebrige Kette bleibt. Das ist der
 * Unterschied zwischen „auf dieser Box gibt es keinen Kompressor" und „auf
 * dieser Box gibt es keinen Ton": eine Kette, die auf eine fehlende .so
 * zeigt, laedt GAR NICHT, und dann waere die Senke weg, auf die der Ton schon
 * geroutet ist (am 21.08.2026 genau so gemessen, mit einem erfundenen Label).
 */
export function ladspaPfad(baustein: LadspaBaustein, gibtDatei?: (p: string) => boolean): string | null {
  if (!gibtDatei) return baustein.pfade[0]
  return baustein.pfade.find((p) => gibtDatei(p)) ?? null
}

/**
 * Aus einer geprueften Kette die PipeWire-Filterkette bauen. Pure.
 *
 * ZWEI KANAELE, IMMER. Jedes Glied ausser `basis` wird doppelt gebaut (`_l`
 * und `_r`); `basis` ist der eine Punkt, an dem Signal zwischen den Kanaelen
 * fliesst, und dafuer gibt es `mixer` mit zwei Eingaengen.
 *
 * EINE LEERE KETTE ERGIBT EINEN DURCHGANG (`copy`), keinen leeren Graph: ein
 * `filter.graph` ohne Knoten laedt nicht, und dann fehlte die Senke, auf die
 * der Ton schon geroutet ist.
 */
export function ketteConfBauen(kette: readonly Klangglied[], gaben: KetteConfGaben): string {
  const knoten: string[] = []
  const links: string[] = []

  // Der Eingang. `copy` ist der Anker: ohne ihn haette eine leere Kette
  // keinen Knoten, und eine `basis` an erster Stelle keinen Vorgaenger.
  knoten.push('          { type = builtin label = copy name = ein_l }')
  knoten.push('          { type = builtin label = copy name = ein_r }')
  let vorherL = 'ein_l:Out'
  let vorherR = 'ein_r:Out'

  kette.forEach((g, i) => {
    const n = `g${i}`
    if (g.art === 'basis') {
      const { eigen, ueber } = basisFaktoren(g.breite)
      knoten.push(
        `          { type = builtin label = mixer name = ${n}_l control = { "Gain 1" = ${zahl(eigen)} "Gain 2" = ${zahl(ueber)} } }`,
      )
      knoten.push(
        `          { type = builtin label = mixer name = ${n}_r control = { "Gain 1" = ${zahl(ueber)} "Gain 2" = ${zahl(eigen)} } }`,
      )
      // KREUZWEISE: beide Mischer bekommen BEIDE Kanaele, die Gewichte oben
      // machen den Unterschied. „In 1" ist links, „In 2" ist rechts — in
      // beiden Mischern gleich, sonst waere der rechte Kanal vertauscht.
      links.push(`          { output = "${vorherL}" input = "${n}_l:In 1" }`)
      links.push(`          { output = "${vorherR}" input = "${n}_l:In 2" }`)
      links.push(`          { output = "${vorherL}" input = "${n}_r:In 1" }`)
      links.push(`          { output = "${vorherR}" input = "${n}_r:In 2" }`)
      vorherL = `${n}_l:Out`
      vorherR = `${n}_r:Out`
      return
    }

    if (g.art === 'vorpegel') {
      const f = dbFaktor(g.dB)
      knoten.push(`          { type = builtin label = mixer name = ${n}_l control = { "Gain 1" = ${zahl(f)} } }`)
      knoten.push(`          { type = builtin label = mixer name = ${n}_r control = { "Gain 1" = ${zahl(f)} } }`)
      links.push(`          { output = "${vorherL}" input = "${n}_l:In 1" }`)
      links.push(`          { output = "${vorherR}" input = "${n}_r:In 1" }`)
      vorherL = `${n}_l:Out`
      vorherR = `${n}_r:Out`
      return
    }

    // ══ DIE ZWEI LADSPA-GLIEDER: EIN STEREO-KNOTEN, NICHT ZWEI ═════════════
    // sc4 und fast_lookahead_limiter tragen beide Kanaele in EINEM Knoten
    // („Left input"/„Right input"). Sie je Kanal zu bauen waere nicht nur
    // doppelte Arbeit — zwei getrennte Kompressoren regelten UNABHAENGIG, und
    // ein lauter Ton links zoege dann nur links den Pegel herunter. Das
    // wandert hoerbar in der Mitte.
    if (g.art === 'kompressor' || g.art === 'begrenzer') {
      const baustein = LADSPA[g.art]
      const pfad = ladspaPfad(baustein, gaben.gibtDatei)
      // FEHLT DIE .so, WIRD DAS GLIED UEBERSPRUNGEN. Die Kette bleibt heil.
      if (!pfad) return
      const steuer =
        g.art === 'kompressor'
          ? `"Threshold level (dB)" = ${zahl(g.schwelle)} "Ratio (1:n)" = ${zahl(g.verhaeltnis)} ` +
            `"Attack time (ms)" = ${zahl(g.anstieg ?? 10)} "Release time (ms)" = ${zahl(g.abfall ?? 200)} ` +
            `"Makeup gain (dB)" = ${zahl(g.makeup ?? 0)} "Knee radius (dB)" = 3.0 "RMS/peak" = 0.0`
          : `"Limit (dB)" = ${zahl(g.grenze)} "Release time (s)" = ${zahl(g.abfall ?? 0.2)} "Input gain (dB)" = 0.0`
      knoten.push(
        `          { type = ladspa plugin = "${pfad}" label = ${baustein.label} name = ${n} control = { ${steuer} } }`,
      )
      links.push(`          { output = "${vorherL}" input = "${n}:${baustein.ein[0]}" }`)
      links.push(`          { output = "${vorherR}" input = "${n}:${baustein.ein[1]}" }`)
      vorherL = `${n}:${baustein.aus[0]}`
      vorherR = `${n}:${baustein.aus[1]}`
      return
    }

    const label =
      g.art === 'hochpass'
        ? 'bq_highpass'
        : g.art === 'tiefpass'
          ? 'bq_lowpass'
          : g.art === 'glocke'
            ? 'bq_peaking'
            : g.lage === 'tief'
              ? 'bq_lowshelf'
              : 'bq_highshelf'
    const dB = g.art === 'hochpass' || g.art === 'tiefpass' ? undefined : g.dB
    const guete = g.guete ?? GUETE_VORGABE
    const kl = bqKnoten(`${n}_l`, label, g.freq, guete, dB)
    const kr = bqKnoten(`${n}_r`, label, g.freq, guete, dB)
    knoten.push(kl.zeile, kr.zeile)
    links.push(`          { output = "${vorherL}" input = "${n}_l:In" }`)
    links.push(`          { output = "${vorherR}" input = "${n}_r:In" }`)
    vorherL = kl.aus
    vorherR = kr.aus
  })

  const linkBlock =
    links.length === 0
      ? ''
      : `        links = [
${links.join('\n')}
        ]
`

  return `# VOM MIXPI-SERVER GENERIERT — Aenderungen ueberleben keinen Neuaufbau.
# Quelle der Kette: die Ton-Plugins mit dem Recht "klang" (Ton-Seite der
# Verwaltung). Gebaut von klangkette.ts, geprueft von kettePruefen().
context.properties = { log.level = 2 }
context.spa-libs = {
  audio.convert.* = audioconvert/libspa-audioconvert
  support.*       = support/libspa-support
}
context.modules = [
  { name = libpipewire-module-protocol-native }
  { name = libpipewire-module-client-node }
  { name = libpipewire-module-adapter }
  { name = libpipewire-module-filter-chain
    args = {
      node.description = "${gaben.beschreibung}"
      media.name = "${gaben.beschreibung}"
      filter.graph = {
        nodes = [
${knoten.join('\n')}
        ]
${linkBlock}        inputs  = [ "ein_l:In" "ein_r:In" ]
        outputs = [ "${vorherL}" "${vorherR}" ]
      }
      capture.props = {
        node.name = "${gaben.sinkName}"
        media.class = Audio/Sink
        audio.position = [ FL FR ]
      }
      playback.props = {
        node.name = "${gaben.ausgangName}"
        node.passive = true
        audio.position = [ FL FR ]
      }
    }
  }
]
`
}

/* ══ LIVE REGELN, OHNE NEUBAU ══════════════════════════════════════════════
 *
 * Betreiber, 21.08.2026: „ich hätte gerne was mehr grafisches auf der box und
 * mit reglern am besten ‚live‘ zum hören".
 *
 * DAS PROBLEM MIT DEM NEUBAU: jede Aenderung startete bisher das Plugin neu,
 * baute die Conf neu und startete den Filterprozess neu — der Ton setzt dabei
 * aus. Zum Einstellen nach Gehoer ist das unbrauchbar: man hoert die Wirkung
 * erst, wenn die Musik wieder da ist, und hat den Vergleich verloren.
 *
 * DER AUSWEG IST DERSELBE WIE BEIM ENTZERRER: PipeWire kann die Steuerwerte
 * einer laufenden Filterkette zur Laufzeit setzen (`pw-cli s <id> Props`).
 * Der Fuenfband-Entzerrer macht das seit dem 15.08.2026 mit `eq_<band>:Gain`.
 *
 * DAMIT DAS GEHT, MUSS DIE STRUKTUR STEHEN BLEIBEN. Ein Glied, das bei
 * Vorgabewert verschwindet, aendert den Graphen — und ein geaenderter Graph
 * heisst Neubau. Deshalb liefert ein live-taugliches Plugin IMMER dieselben
 * Glieder und veraendert nur deren Werte. Die paar Filter, die dabei neutral
 * mitlaufen, kosten nichts: der ganze Prozess stand auf der Box bei 0,0 %
 * CPU (21.08.2026 gemessen).
 */

/** Ein Steuerwert einer laufenden Kette: Knoten, Anschluss, Wert. */
export interface Stellwert {
  /** Name wie im Graphen, z. B. `g0_l`. */
  knoten: string
  /** Anschlussname, z. B. `Gain 1` oder `Gain`. */
  anschluss: string
  wert: number
}

/**
 * Die Steuerwerte einer Kette — dieselbe Reihenfolge wie `ketteConfBauen`. Pure.
 *
 * WICHTIG: Die Knotennamen muessen exakt denen aus `ketteConfBauen`
 * entsprechen (`g<i>_l` / `g<i>_r`). Beide Funktionen laufen deshalb ueber
 * DIESELBE Indexlogik — wer eine aendert, aendert die andere mit. Ein Test
 * haelt sie zusammen.
 */
export function ketteStellwerte(kette: readonly Klangglied[]): Stellwert[] {
  const raus: Stellwert[] = []
  kette.forEach((g, i) => {
    const n = `g${i}`
    if (g.art === 'basis') {
      const { eigen, ueber } = basisFaktoren(g.breite)
      raus.push(
        { knoten: `${n}_l`, anschluss: 'Gain 1', wert: eigen },
        { knoten: `${n}_l`, anschluss: 'Gain 2', wert: ueber },
        { knoten: `${n}_r`, anschluss: 'Gain 1', wert: ueber },
        { knoten: `${n}_r`, anschluss: 'Gain 2', wert: eigen },
      )
      return
    }
    if (g.art === 'vorpegel') {
      const f = dbFaktor(g.dB)
      raus.push({ knoten: `${n}_l`, anschluss: 'Gain 1', wert: f }, { knoten: `${n}_r`, anschluss: 'Gain 1', wert: f })
      return
    }
    if (g.art === 'kompressor') {
      // EIN Knoten, keine Seiten — deshalb `n` statt `n_l`/`n_r`.
      raus.push(
        { knoten: n, anschluss: 'Threshold level (dB)', wert: g.schwelle },
        { knoten: n, anschluss: 'Ratio (1:n)', wert: g.verhaeltnis },
        { knoten: n, anschluss: 'Attack time (ms)', wert: g.anstieg ?? 10 },
        { knoten: n, anschluss: 'Release time (ms)', wert: g.abfall ?? 200 },
        { knoten: n, anschluss: 'Makeup gain (dB)', wert: g.makeup ?? 0 },
      )
      return
    }
    if (g.art === 'begrenzer') {
      raus.push(
        { knoten: n, anschluss: 'Limit (dB)', wert: g.grenze },
        { knoten: n, anschluss: 'Release time (s)', wert: g.abfall ?? 0.2 },
      )
      return
    }
    // bq_*: Freq und Q sind auch live stellbar, Gain nur wo es einen gibt.
    const guete = g.guete ?? GUETE_VORGABE
    for (const seite of ['l', 'r'] as const) {
      raus.push(
        { knoten: `${n}_${seite}`, anschluss: 'Freq', wert: g.freq },
        { knoten: `${n}_${seite}`, anschluss: 'Q', wert: guete },
      )
      if (g.art !== 'hochpass' && g.art !== 'tiefpass') {
        raus.push({ knoten: `${n}_${seite}`, anschluss: 'Gain', wert: g.dB })
      }
    }
  })
  return raus
}

/**
 * Haben zwei Ketten DIESELBE STRUKTUR? Pure.
 *
 * Entscheidet ueber live stellen oder neu bauen. Gleiche Struktur heisst:
 * gleiche Zahl Glieder, gleiche Arten in gleicher Reihenfolge — und bei den
 * Kuhschwaenzen dieselbe Lage, denn `tief` und `hoch` sind VERSCHIEDENE
 * Bausteine (`bq_lowshelf` gegen `bq_highshelf`), kein Steuerwert.
 */
export function gleicheStruktur(a: readonly Klangglied[], b: readonly Klangglied[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    if (x.art !== y.art) return false
    if (x.art === 'kuhschwanz' && y.art === 'kuhschwanz') return x.lage === y.lage
    return true
  })
}

/** Die Props-Zeile fuer `pw-cli s <id> Props`. Pure. */
export function stellwerteAlsProps(werte: readonly Stellwert[]): string {
  const paare = werte.map((w) => `"${w.knoten}:${w.anschluss}" ${zahl(w.wert)}`).join(' ')
  return `{ params = [ ${paare} ] }`
}

/* ══ DER FREQUENZGANG — RECHNEN STATT MALEN ═══════════════════════════════
 *
 * Betreiber, 21.08.2026: eine Kurve, die sich beim Ziehen mitbewegt, und eine
 * Pegelanzeige, „damit man Uebersteuern durch Anhebungen sieht statt hoert".
 *
 * DIE KURVE IST KEINE ILLUSTRATION, SONDERN DIE ECHTE WIRKUNG. PipeWires
 * `bq_*` sind Biquads nach dem RBJ Audio EQ Cookbook — dieselben Formeln
 * stehen hier. Was die Kurve zeigt, ist also das, was die Filterkette
 * tatsaechlich tut, nicht eine hingemalte Ahnung davon.
 *
 * WAS NICHT IN DIE KURVE GEHOERT: die Stereobasis. Sie mischt zwischen den
 * KANAELEN und aendert am Frequenzgang eines Kanals nichts. Wer sie
 * einzeichnete, behauptete eine Wirkung, die es nicht gibt — dafuer gibt es
 * die Buehne auf der Ton-Seite.
 */

/** Abtastrate der Kette. Die Box faehrt 48 kHz (am Geraet abgelesen). */
export const ABTASTRATE = 48000

/** Biquad-Koeffizienten, wie sie das RBJ-Cookbook liefert. */
interface Biquad {
  b0: number
  b1: number
  b2: number
  a0: number
  a1: number
  a2: number
}

/**
 * Die Koeffizienten eines Gliedes. Pure. Null, wenn es keinen Filter ergibt
 * (Stereobasis, Vorpegel — die haben keinen Frequenzgang bzw. einen flachen).
 */
function biquadVon(g: Klangglied): Biquad | null {
  // KOMPRESSOR UND BEGRENZER HABEN KEINEN FREQUENZGANG. Was sie tun, haengt
  // vom PEGEL des Signals ab, nicht von der Frequenz — eine Linie im Bild
  // waere eine Behauptung ueber etwas, das die Kurve nicht zeigen kann.
  if (g.art === 'basis' || g.art === 'vorpegel' || g.art === 'kompressor' || g.art === 'begrenzer') return null
  const w0 = (2 * Math.PI * g.freq) / ABTASTRATE
  const cw = Math.cos(w0)
  const sw = Math.sin(w0)
  const q = g.guete ?? GUETE_VORGABE
  const alpha = sw / (2 * q)

  if (g.art === 'hochpass') {
    return { b0: (1 + cw) / 2, b1: -(1 + cw), b2: (1 + cw) / 2, a0: 1 + alpha, a1: -2 * cw, a2: 1 - alpha }
  }
  if (g.art === 'tiefpass') {
    return { b0: (1 - cw) / 2, b1: 1 - cw, b2: (1 - cw) / 2, a0: 1 + alpha, a1: -2 * cw, a2: 1 - alpha }
  }
  if (g.art === 'glocke') {
    const A = 10 ** (g.dB / 40)
    return { b0: 1 + alpha * A, b1: -2 * cw, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cw, a2: 1 - alpha / A }
  }
  // Kuhschwanz
  const A = 10 ** (g.dB / 40)
  const wurzel = 2 * Math.sqrt(A) * alpha
  if (g.lage === 'tief') {
    return {
      b0: A * (A + 1 - (A - 1) * cw + wurzel),
      b1: 2 * A * (A - 1 - (A + 1) * cw),
      b2: A * (A + 1 - (A - 1) * cw - wurzel),
      a0: A + 1 + (A - 1) * cw + wurzel,
      a1: -2 * (A - 1 + (A + 1) * cw),
      a2: A + 1 + (A - 1) * cw - wurzel,
    }
  }
  return {
    b0: A * (A + 1 + (A - 1) * cw + wurzel),
    b1: -2 * A * (A - 1 + (A + 1) * cw),
    b2: A * (A + 1 + (A - 1) * cw - wurzel),
    a0: A + 1 - (A - 1) * cw + wurzel,
    a1: 2 * (A - 1 - (A + 1) * cw),
    a2: A + 1 - (A - 1) * cw - wurzel,
  }
}

/** Der Betrag eines Biquads bei einer Frequenz, in dB. Pure. */
function biquadDb(bq: Biquad, hz: number): number {
  const w = (2 * Math.PI * hz) / ABTASTRATE
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const zr = bq.b0 + bq.b1 * c1 + bq.b2 * c2
  const zi = -(bq.b1 * s1 + bq.b2 * s2)
  const nr = bq.a0 + bq.a1 * c1 + bq.a2 * c2
  const ni = -(bq.a1 * s1 + bq.a2 * s2)
  const betrag = Math.sqrt((zr * zr + zi * zi) / (nr * nr + ni * ni))
  // Unter -60 dB abschneiden: darunter ist alles gleich still, und eine
  // Kurve, die ins Bodenlose faellt, staucht den interessanten Bereich.
  return Math.max(-60, 20 * Math.log10(Math.max(1e-9, betrag)))
}

/** Ein Punkt der Kurve. */
export interface Gangpunkt {
  hz: number
  dB: number
}

/**
 * Der Frequenzgang der ganzen Kette. Pure.
 *
 * LOGARITHMISCH VERTEILTE STUETZSTELLEN (20 Hz bis 20 kHz): linear verteilt
 * laegen fast alle Punkte im Hochton, und genau der Bereich, in dem ein
 * Hochpass wirkt, haette drei davon.
 */
export function frequenzgang(kette: readonly Klangglied[], punkte = 96): Gangpunkt[] {
  const bqs = kette.map(biquadVon).filter((b): b is Biquad => b !== null)
  const vorpegel = kette.reduce((s, g) => s + (g.art === 'vorpegel' ? g.dB : 0), 0)
  const von = Math.log10(20)
  const bis = Math.log10(20000)
  const raus: Gangpunkt[] = []
  for (let i = 0; i < punkte; i++) {
    const hz = 10 ** (von + ((bis - von) * i) / (punkte - 1))
    let dB = vorpegel
    for (const bq of bqs) dB += biquadDb(bq, hz)
    raus.push({ hz, dB: Math.round(dB * 100) / 100 })
  }
  return raus
}

/**
 * Die hoechste Anhebung der Kette in dB — die Pegelanzeige. Pure.
 *
 * ══ WOZU, UND WARUM DAS EHRLICHER IST ALS EIN ZEIGER ══════════════════════
 * Betreiber: „damit man Uebersteuern durch Anhebungen sieht statt hoert".
 *
 * Es waere auch moeglich, den ECHTEN Pegel zu messen (Monitor-Strom vom
 * Sink). Das zeigte aber, wie laut das Stueck GERADE ist — und das schwankt
 * mit der Musik. Was der Betreiber beim Einstellen wissen will, ist etwas
 * anderes: wieviel Luft die KETTE frisst, unabhaengig vom Material. Genau das
 * ist die Spitze des Frequenzgangs.
 *
 * UEBER 0 dB HEISST NICHT AUTOMATISCH VERZERRUNG: nur, dass ein Signal, das
 * schon voll ausgesteuert war, es nun nicht mehr ist. Deshalb heisst es auf
 * der Seite „kann uebersteuern" und nicht „uebersteuert".
 */
export function spitzeDb(kette: readonly Klangglied[]): number {
  if (kette.length === 0) return 0
  return Math.max(...frequenzgang(kette, 192).map((p) => p.dB))
}

/**
 * Was auf der Ton-Seite ueber der Kette steht — eine Zeile Klartext.
 *
 * WOZU: „3 Glieder" sagt niemandem etwas. Wer die Box einstellt, will lesen,
 * was gerade im Signalweg haengt, ohne die Plugin-Einstellungen
 * durchzuklicken.
 */
export function ketteBeschreiben(kette: readonly Klangglied[]): string {
  if (kette.length === 0) return 'nichts eingehängt'
  return kette.map(gliedBeschreiben).join(', ')
}

/** Ein Glied in Worten. Eigene Funktion, damit jeder Zweig etwas zurueckgibt. */
function gliedBeschreiben(g: Klangglied): string {
  switch (g.art) {
    case 'basis':
      return g.breite === 0 ? 'Mono' : `Stereobasis ${Math.round(g.breite)} %`
    case 'hochpass':
      return `Hochpass ${Math.round(g.freq)} Hz`
    case 'tiefpass':
      return `Tiefpass ${Math.round(g.freq)} Hz`
    case 'kuhschwanz':
      return `${g.lage === 'tief' ? 'Bass' : 'Höhen'} ${g.dB > 0 ? '+' : ''}${Math.round(g.dB)} dB`
    case 'glocke':
      return `${Math.round(g.freq)} Hz ${g.dB > 0 ? '+' : ''}${Math.round(g.dB)} dB`
    case 'vorpegel':
      return `Vorpegel ${Math.round(g.dB)} dB`
    case 'kompressor':
      return `Kompressor ${Math.round(g.schwelle)} dB / ${Math.round(g.verhaeltnis)}:1`
    case 'begrenzer':
      return `Begrenzer ${Math.round(g.grenze)} dB`
  }
}
