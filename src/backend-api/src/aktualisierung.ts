/**
 * Aktualisierung: was ist installiert, was wird angeboten, und darf man das
 * überhaupt einspielen?
 *
 * DER ANLASS ist kein Schönheitswunsch. Der Update-Knopf des PHP-Admins tut
 * heute dies (admin.php:137):
 *
 *   curl -L https://raw.githubusercontent.com/splitti/MuPiBox/main/update/
 *        start_mupibox_update.sh | sudo bash -s -- stable
 *
 * Das Skript lädt dann das UPSTREAM-Zip (…/splitti/MuPiBox/archive/…/4.3.0.zip)
 * und installiert es als root über die Box. Auf einer Box, die einen FORK
 * fährt, löscht dieser eine Knopf die gesamte eigene Arbeit — ohne Rückfrage,
 * ohne Hinweis, ohne Weg zurück.
 *
 * Deshalb dreht dieses Modul die Reihenfolge um: erst WISSEN, dann handeln.
 *
 *   1. HERKUNFT. Die Box merkt sich beim Ausliefern, woher ihre Software kam
 *      (Quelle, Commit, Zeitpunkt). Ohne das ist jede Update-Frage Raterei.
 *   2. VERGLEICH. Angeboten wird nur, was aus DERSELBEN Herkunft stammt.
 *   3. VERWEIGERUNG. Kommt das Angebot woanders her, ist die Antwort nicht
 *      „ist halt neuer", sondern eine Warnung. Ein Fork ist keine ältere
 *      Fassung von Upstream, sondern etwas anderes.
 */

export const KANAELE = ['stable', 'beta', 'dev'] as const
export type Kanal = (typeof KANAELE)[number]

export function istKanal(x: unknown): x is Kanal {
  return typeof x === 'string' && (KANAELE as readonly string[]).includes(x)
}

/**
 * Zwei Fassungsnummern vergleichen. Pure.
 *
 * Rückgabe: negativ wenn a älter, 0 bei gleich, positiv wenn a neuer.
 * Bewusst tolerant: Upstream führt neben „4.3.0" auch Platzhalter wie „X.X.X"
 * (im dev-Kanal) und lange Formen mit Anhängseln. Was sich nicht in Zahlen
 * zerlegen lässt, gilt als UNVERGLEICHBAR (null) — und unvergleichbar heißt
 * hier ausdrücklich NICHT „neuer".
 *
 * ══ DAS FÜHRENDE `v` (31.08.2026, an der Box gemessen) ══════════════════════
 * MixPiBox-Fassungen heißen `v1.1.0`, nicht `1.1.0` — das `v` trennt sie in
 * derselben Tag-Liste von den geerbten Upstream-Marken (4.2.4). Diese Funktion
 * kannte die Form nicht: `v1.1.0` fiel durch die Ziffernprüfung, galt als
 * unvergleichbar, und `neuestesAngebot()` übersprang den Eintrag als
 * „Platzhalter". Ergebnis auf Box .79: ein gefülltes Verzeichnis, ein
 * erreichbarer Feed, `feedFehler` leer — und trotzdem „kein Angebot". Ein
 * Fehlerbild ohne Fehlermeldung, das man im Verzeichnis sucht statt hier.
 *
 * Die Ursache war eine Naht: `scripts/box/mixpi-zieher.py` beherrschte die
 * Form von Anfang an (es hat die Namensform eingeführt), diese Datei nicht.
 * Zwei Implementierungen derselben Regel, und nur eine wurde nachgezogen.
 */
/**
 * Die Rangfolge der Vorabstufen.
 *
 * ══ WAS DIE DREI KANÄLE BEDEUTEN (Betreiber, 31.08.2026) ════════════════════
 *   dev     „alle Änderungen"      — läuft mit, sobald etwas fertig ist
 *   beta    „ein Stable-Kandidat"  — das, was stable werden soll
 *   stable  „ist dann ja stable"
 * Daraus folgt die Ordnung dev → beta → fertig, und daraus wiederum, dass eine
 * Fassung ihren Weg als `v1.2.0-dev.N` beginnt, als `v1.2.0-beta.N` zum
 * Kandidaten wird und als `v1.2.0` ankommt. Der Kern bleibt derselbe, nur die
 * Stufe steigt — deshalb muss der Vergleich bei gleichem Kern die STUFE
 * entscheiden lassen.
 *
 * ══ WARUM NICHT ALPHABETISCH (wie Semver es täte) ═══════════════════════════
 * Semver vergleicht Vorabkennungen als Text, und da käme „beta" vor „dev" —
 * also genau verkehrt herum zur Bedeutung in diesem Projekt, wo der Weg
 * dev → beta → fertig läuft. Deshalb steht die Ordnung hier ausdrücklich da,
 * statt sie einer Zeichenkettensortierung zu überlassen.
 *
 * UNBEKANNTES RANGIERT GANZ UNTEN, nicht in der Mitte. Ein Anhängsel, das
 * niemand kennt (Upstream führt allerlei), darf nie als neuer gelten als eine
 * Stufe, die wir kennen — sonst zieht sich eine Box an etwas hoch, das keiner
 * eingeordnet hat.
 */
const STUFEN: Record<string, number> = { dev: 1, beta: 2 }
const STUFE_UNBEKANNT = 0
const STUFE_FERTIG = 3

interface Fassungsteile {
  kern: number[]
  stufe: number
  lauf: number
}

/**
 * Eine Fassungsnummer in Kern, Stufe und Laufnummer zerlegen. Pure.
 *
 * ACHTUNG, NAHT: `scripts/box/mixpi-zieher.py` muss GENAU dasselbe tun — die
 * Box urteilt mit dem einen, die Seite mit dem anderen. Laufen sie
 * auseinander, bietet die Seite etwas an, das der Zieher ablehnt (oder
 * umgekehrt). `tools/mixpi-fassungsvergleich-deckung.py` fährt beide gegen
 * dieselbe Fälleliste und meldet jeden Unterschied.
 */
export function zerlegeFassung(v: string): Fassungsteile | null {
  // Upstreams lange Formen („4.2.0 stable", „DEV main 2026-08-31") am ersten
  // Leerzeichen abschneiden; das führende `v` der eigenen Namensform weg.
  const roh = String(v ?? '')
    .trim()
    .replace(/^[vV](?=\d)/, '')
    .split(' ')[0]
  if (!roh) return null
  const [kernText, ...rest] = roh.split('-')
  const kern = (kernText ?? '').split('+')[0]
  if (!/^\d+(\.\d+)*$/.test(kern)) return null
  const zahlen = kern.split('.').map((x) => Number.parseInt(x, 10))
  if (rest.length === 0) return { kern: zahlen, stufe: STUFE_FERTIG, lauf: 0 }
  // `-beta.2`, `-dev.7`, oder bloss `-beta` (dann Laufnummer 0, also älter als
  // `-beta.1` — eine unnummerierte Vorabfassung ist die früheste).
  const teile = rest.join('-').split('+')[0].split('.')
  const lauf = Number.parseInt(teile[1] ?? '0', 10)
  return {
    kern: zahlen,
    stufe: STUFEN[(teile[0] ?? '').toLowerCase()] ?? STUFE_UNBEKANNT,
    lauf: Number.isNaN(lauf) ? 0 : lauf,
  }
}

export function vergleicheVersionen(a: string, b: string): number | null {
  const x = zerlegeFassung(a)
  const y = zerlegeFassung(b)
  if (!x || !y) return null
  const laenge = Math.max(x.kern.length, y.kern.length)
  for (let i = 0; i < laenge; i++) {
    const d = (x.kern[i] ?? 0) - (y.kern[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  // GLEICHER KERN, VERSCHIEDENE STUFE: die Vorabfassung ist die ältere.
  // Ohne diesen Schritt waren `v1.1.0-beta.1` und `v1.1.0-beta.3` GLEICH, und
  // der beta-Kanal — dessen ganzer Zweck schnell aufeinanderfolgende Fassungen
  // sind — war der einzige, der nicht funktionierte: eine Box auf beta.1 bekam
  // beta.3 angeboten, urteilte „aktuell" und aktualisierte nie (31.08.2026).
  if (x.stufe !== y.stufe) return x.stufe < y.stufe ? -1 : 1
  if (x.lauf !== y.lauf) return x.lauf < y.lauf ? -1 : 1
  return 0
}

export interface Angebot {
  version: string
  url: string
  info: string
}

/**
 * Den neuesten Eintrag eines Kanals aus dem Versionsverzeichnis holen. Pure.
 *
 * Form ist die von Upstream: { release: { stable: [ …, {version,url,…} ] } },
 * neuester Eintrag am ENDE. Ein Eintrag ohne brauchbare Fassungsnummer (der
 * dev-Kanal führt „X.X.X") wird übersprungen statt angeboten.
 */
export function neuestesAngebot(feed: unknown, kanal: Kanal): Angebot | null {
  const r = (feed as { release?: Record<string, unknown> })?.release
  const liste = r?.[kanal]
  if (!Array.isArray(liste)) return null
  for (let i = liste.length - 1; i >= 0; i--) {
    const e = liste[i] as Record<string, unknown>
    const version = typeof e?.['version'] === 'string' ? e['version'] : ''
    const url = typeof e?.['url'] === 'string' ? e['url'] : ''
    // Ohne vergleichbare Nummer ist es kein Angebot, sondern ein Platzhalter.
    if (!version || !url) continue
    if (vergleicheVersionen(version, '0.0.0') === null) continue
    return {
      version,
      url,
      info: typeof e['releaseinfo'] === 'string' ? e['releaseinfo'] : '',
    }
  }
  return null
}

export interface Herkunft {
  /** Woher die installierte Software stammt (Git-Adresse, normalisiert). */
  quelle: string
  /** Commit, aus dem gebaut wurde — die einzige wirklich eindeutige Angabe. */
  commit: string
  /** Wann gebaut wurde (ISO). */
  gebautAm: string
  /** Zweig, falls bekannt. */
  zweig?: string
  /** Commits, die dieser Bau VOR seiner Quelle hatte. */
  eigeneCommits?: number
  /** Beim Bauen geänderte, nicht eingecheckte Dateien. */
  unsauber?: number
}

/**
 * Zwei Quellenangaben auf „dieselbe Herkunft?" prüfen. Pure.
 *
 * Normalisiert, was an einer Git-Adresse nichts zur Sache tut: Schema,
 * `git@host:pfad` gegen `https://host/pfad`, ein `.git` am Ende, Groß- und
 * Kleinschreibung, abschließende Schrägstriche. `github.com/splitti/MuPiBox`
 * und `git@github.com:splitti/MuPiBox.git` sind dieselbe Quelle — ein Fork
 * unter anderem Namen ist es NICHT.
 */
export function gleicheQuelle(a: string, b: string): boolean {
  const norm = (s: string): string =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/^git\+/, '')
      .replace(/^[a-z]+:\/\//, '')
      .replace(/^git@/, '')
      .replace(/:/g, '/')
      .replace(/\.git$/, '')
      .replace(/\/+$/, '')
  const x = norm(a)
  const y = norm(b)
  return x !== '' && x === y
}

export type Urteil =
  /** Nichts zu tun. */
  | 'aktuell'
  /** Es gibt eine neuere Fassung DERSELBEN Herkunft. */
  | 'neuer'
  /** Das Angebot kommt woanders her — einspielen würde den Fork löschen. */
  | 'fremdeQuelle'
  /** Gleiche Quelle, aber der Bau lief VOR ihr her — ein Update wäre ein Rückschritt. */
  | 'eigenbau'
  /** Die Box weiß nicht, was sie fährt (keine Herkunft hinterlegt). */
  | 'herkunftUnbekannt'
  /** Kein Angebot erreichbar (offline, Verzeichnis kaputt). */
  | 'keinAngebot'
  /** Fassungsnummern nicht vergleichbar. */
  | 'unklar'

export interface Lage {
  urteil: Urteil
  installiert: string
  angeboten: string
  /** Nur gesetzt, wenn das Urteil eine Erklärung braucht. */
  grund?: string
}

/**
 * Das eigentliche Urteil. Pure — und der Kern dieses Moduls.
 *
 * Die Reihenfolge der Prüfungen ist Absicht: die Frage „woher kommt das?"
 * steht VOR der Frage „ist es neuer?". Andersherum wäre die Antwort auf einer
 * Fork-Box regelmäßig „ja, neuer" — und genau das ist die Falle.
 */
export function beurteile(o: {
  herkunft: Herkunft | null
  installierteVersion: string
  angebot: Angebot | null
  angebotsQuelle: string
}): Lage {
  const installiert = o.installierteVersion || ''
  const angeboten = o.angebot?.version || ''

  if (!o.angebot) {
    return { urteil: 'keinAngebot', installiert, angeboten: '' }
  }

  if (!o.herkunft || !o.herkunft.quelle) {
    return {
      urteil: 'herkunftUnbekannt',
      installiert,
      angeboten,
      grund:
        'Die Box hat nicht hinterlegt, woher ihre Software stammt. ' +
        'Ein Update könnte etwas anderes einspielen, als hier läuft.',
    }
  }

  if (!gleicheQuelle(o.herkunft.quelle, o.angebotsQuelle)) {
    return {
      urteil: 'fremdeQuelle',
      installiert,
      angeboten,
      grund:
        `Installiert ist eine Fassung aus ${o.herkunft.quelle}, angeboten wird ` +
        `eine aus ${o.angebotsQuelle}. Das ist kein Update, sondern ein Austausch — ` +
        'alle eigenen Änderungen wären danach weg.',
    }
  }

  // Die Adresse kann stimmen und die Arbeit trotzdem nur auf der Box liegen.
  // Am Gerät gemessen: dieser Fork lag 98 Commits VOR seinem origin, bei
  // identischer Adresse — die Quellprüfung allein hätte "passt" gesagt und ein
  // Update hätte alle 98 verworfen. Deshalb zählt der ABSTAND, nicht nur die
  // Herkunft.
  const eigene = o.herkunft.eigeneCommits ?? 0
  const unsauber = o.herkunft.unsauber ?? 0
  if (eigene > 0 || unsauber > 0) {
    const teile: string[] = []
    if (eigene > 0) teile.push(`${eigene} eigene Commits`)
    if (unsauber > 0) teile.push(`${unsauber} geänderte Datei(en)`)
    return {
      urteil: 'eigenbau',
      installiert,
      angeboten,
      grund:
        `Diese Box läuft ein selbst gebautes Abbild (${teile.join(', ')} gegenüber ` +
        'der Quelle). Ein Update von dort wäre kein Fortschritt, sondern ein ' +
        'Rückschritt — die eigene Arbeit wäre danach weg.',
    }
  }

  const v = vergleicheVersionen(angeboten, installiert)
  if (v === null) {
    return {
      urteil: 'unklar',
      installiert,
      angeboten,
      grund: 'Die Fassungsnummern lassen sich nicht vergleichen.',
    }
  }
  return { urteil: v > 0 ? 'neuer' : 'aktuell', installiert, angeboten }
}
