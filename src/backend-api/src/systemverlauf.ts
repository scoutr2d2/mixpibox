/**
 * Der Systemverlauf: Last, Waerme und Speicher ueber die Zeit.
 *
 * WOFUER: `GET /api/system` sagt LIVE alles — 0.29 Last, 46,9 °C, 714 von
 * 2010 MB belegt. Es sagt nicht, ob die 46,9 °C seit einer Stunde steigen,
 * ob die Box nachts um drei regelmaessig heiss wird, ob der Speicher ueber
 * eine Woche langsam volllaeuft (ein Leck) oder nur atmet. Genau das ist die
 * Frage, wegen der jemand auf eine Kurve schaut. Ein einzelner Messwert kann
 * sie nicht beantworten, und keine Kurve kann zeigen, was niemand mitschreibt.
 *
 * REIN: kein Netz, kein Dateizugriff, keine Uhr — jede Zeit und jeder Messwert
 * kommt als Parameter herein. Was auf die Karte geht, steht in
 * systemverlaufablage.ts; wer misst und wie oft, steht in server.ts. Hier
 * steht nur, WAS ein Punkt ist und wie die Reihe sich verhaelt.
 *
 * ══ DIESELBE BAUART WIE DIE AKKUKURVE ══════════════════════════════════════
 * akkuverlauf.ts gibt die Form vor: kurze Feldnamen, Mindestabstand,
 * Ringgrenze, `bereinigen`/`spanne`/`ausduennen` mit denselben Namen und
 * derselben Bedeutung, und ein Weg, der `punkte`, `abschnitte`, `jetzt`,
 * `stunden` und `gesamt` liefert. Zwei Zeitreihen mit zwei Bauarten waeren
 * zwei Orte zum Auseinanderlaufen.
 *
 * WAS BEWUSST ANDERS IST — und beides ist gemessen, nicht Geschmack:
 *   1. DIE ABLAGE. Die Akkukurve schreibt die GANZE Datei neu, alle zehn
 *      Minuten. Diese hier haengt an. Die Rechnung dazu steht weiter unten in
 *      `aufwandAnhaengen`/`aufwandNeuschreiben` — als Code, damit sie
 *      nachgerechnet und nicht geglaubt werden muss.
 *   2. DIE ABSCHNITTE. Beim Akku trennen sie Laden von Entladen. Hier gibt es
 *      nichts zu trennen ausser der Zeit, in der die Box AUS war — und genau
 *      das braucht die Kurve, damit sie nicht ueber eine Nacht hinwegluegt.
 *
 * ES WIRD ABSICHTLICH NICHT GETEILT, obwohl `spanne` und `ausduennen` in
 * akkuverlauf.ts fast gleich stehen: akkuverlauf.ts wird gerade von einem
 * zweiten Lauf bearbeitet (Akkukurve, Farbe und Schieber), und ein Import
 * quer hinein waere eine Kopplung an eine Datei, die sich unter der Hand
 * aendert. Sobald jener Lauf steht, gehoeren die beiden Funktionen in EIN
 * Modul ueber `{ t: number }` — das ist der eine bewusst offene Punkt hier.
 */

/**
 * Ein Messpunkt. Kurze Namen mit Absicht — davon liegen Zehntausende auf einer
 * SD-Karte, und jedes Zeichen im Namen kostet dort einmal je Punkt.
 */
export interface Punkt {
  /** Zeitstempel in Millisekunden. */
  t: number
  /**
   * CPU-Auslastung in Prozent (0…100), ueber ALLE Kerne, ueber das GANZE
   * Messfenster.
   *
   * WARUM NICHT DAS LASTMITTEL, das /api/system zeigt: `last[0] = 0.29` bei
   * vier Kernen heisst 7 % ausgelastet, nicht 29 %. Wer das verwechselt, baut
   * eine Kurve, die dauernd Alarm schlaegt. Diese Zahl hat das Problem gar
   * nicht — sie kommt aus der Differenz zweier /proc/stat-Staende und ist
   * schon ein Anteil. Sie ist ausserdem der ehrlichere Wert: das Lastmittel
   * ist ein exponentiell abklingender Mittelwert ueber die letzte Minute und
   * zaehlt auch Prozesse mit, die auf die Karte warten statt zu rechnen.
   *
   * IOWAIT ZAEHLT ALS UNTAETIG. Auf einer Box, die von einer SD-Karte lebt,
   * ist Warten auf die Karte der Normalfall; zaehlte man es als Last, staende
   * die Kurve beim Einlesen der Medien bei 100 % und saehe aus wie ein
   * Rechenproblem, das keines ist.
   */
  c: number
  /**
   * Belegter Speicher in Prozent (0…100) — gerechnet aus MemAvailable.
   *
   * DAS IST DIE EINZIGE ZAHL, DIE „WIRD ES ENG?" BEANTWORTET, und sie ist
   * nicht die naheliegende. Am Geraet gemessen (.169, 08.08.2026):
   *     MemTotal 2 058 432 kB
   *     MemFree    474 992 kB  ->  23 % frei  ->  77 % „belegt"
   *     MemAvailable 1 345 280 kB -> 65 % frei -> 35 % belegt
   * `free -m` nennt in seiner Spalte `used` 699 MB, also dieselben 35 %. Die
   * 77 % waeren eine Kurve, die dauerhaft im roten Bereich klebt, weil sie
   * Puffer und Zwischenspeicher (101 MB + 761 MB) als „weg" zaehlt — die gibt
   * der Kernel aber jedem Programm zurueck, das sie braucht.
   *
   * ACHTUNG, HIER LIEGT AUCH EINE FALLE IN NODE: `os.freemem()` liefert
   * MemFree, nicht MemAvailable. Genau deshalb liest die Aufzeichnung
   * /proc/meminfo selbst, statt den Wert zu nehmen, der eine Zeile weiter
   * schon herumliegt.
   */
  m: number
  /**
   * Temperatur in °C, auf ein Zehntel gerundet. `null` = kein Sensor.
   *
   * Nicht 0, sondern null: eine 0 saehe in der Kurve aus wie eine eiskalte
   * Box. Dieselbe Regel wie in system.ts (`parseTemperatur`).
   */
  g: number | null
  /**
   * Lastmittel der letzten Minute, in Hundertsteln (0.53 -> 53).
   * `null`, wenn es nicht zu haben ist.
   *
   * WARUM ES TROTZ `c` MITGESCHRIEBEN WIRD: es ist die einzige der beiden
   * Zahlen, die ueber 100 % hinausgehen KANN. `c` ist ein Anteil und bei
   * voller Auslastung bei 100 — ob dort vier Prozesse rechnen oder vierzig
   * warten, sieht man ihm nicht an. Das Lastmittel zeigt genau diese
   * Warteschlange (Last 8 bei 4 Kernen = doppelt so viel, wie die Box
   * abarbeiten kann). Vier Zeichen je Punkt sind dafuer billig, und was hier
   * nicht mitgeschrieben wird, ist unwiederbringlich weg.
   *
   * IN HUNDERTSTELN UND NICHT ALS ANTEIL DER KERNE: die Kernzahl steht am
   * Weg (`kerne`), nicht am Punkt. Wanderte die Karte je in einen Pi mit
   * anderer Kernzahl, waere ein eingebackener Anteil falsch und nicht mehr
   * zurueckzurechnen; die rohe Zahl bleibt richtig.
   */
  l: number | null
}

/**
 * Wie oft gemessen wird (ms). Die Begruendung steht bei MESS_MS in server.ts.
 *
 * ZWANZIG STATT SECHZIG SEKUNDEN (E61, 20.08.2026). Betreiber: „koennen wir
 * cpu speicher oefter aktualisieren?" Im Minutentakt ist ein Lastberg von
 * dreissig Sekunden — die Laenge eines Albumstarts oder eines
 * Kiosk-Neustarts — entweder unsichtbar oder ein einzelner Zacken, aus dem
 * sich nichts ablesen laesst. Drei Punkte je Minute zeigen die Form.
 *
 * ══ VIER ZAHLEN, DIE SICH GEGENSEITIG BEDINGEN ═══════════════════════════
 * MESS_MS, MAX_PUNKTE, SCHREIB_JE und UEBERHANG (in systemverlaufablage.ts)
 * haengen aneinander: Wer den Takt verdreifacht, verdreifacht Schreiblast,
 * Dateigroesse und Verdichtungsfrequenz gleich mit. Der erste Versuch tat
 * genau das und riss zwei Grenzen — 5,1 GB Schreiblast im Jahr statt 1,7 und
 * eine 1,9-MB-Datei, die der Server bei JEDEM Start Zeile fuer Zeile liest.
 *
 * DESHALB SIND DIE ANDEREN DREI HIER ABGELEITET und nicht eingetippt, und
 * deshalb gibt es tools/verlauf-takt-rechnen.mjs: das Werkzeug spielt die
 * Kombinationen mit demselben Kostenmodell durch, das auch die Tests
 * benutzen, und sagt, welche alle drei Grenzen haelt. Wer diesen Takt
 * aendert, laesst es vorher laufen.
 *
 * GEWAEHLT wurde die Kombination mit der besten Reserve: 20 s bei zwei Tagen
 * Historie lastet keine Grenze staerker aus als der Minutentakt vorher
 * (Karte 88 %, Datei 69 %, Verfahrensfaktor 29 gegen ein Minimum von 20).
 */
export const MESS_MS = 20_000

/**
 * Kleinster Abstand zwischen zwei aufgezeichneten Punkten (ms).
 *
 * Knapp unter dem Messtakt, damit ein Zeitgeber, der einmal ein paar
 * Millisekunden zu frueh feuert, nicht jeden zweiten Punkt verschluckt.
 * ALS ANTEIL DES TAKTES und nicht als eigene Zahl: hier stand 55_000 zu einem
 * Takt von 60_000. Bliebe die Zahl stehen, waehrend der Takt auf 20_000
 * faellt, verschluckte die Reihe zwei von drei Punkten — und die Kurve saehe
 * genauso grob aus wie vorher, obwohl dreimal so oft gemessen wird.
 */
export const MIN_ABSTAND_MS = MESS_MS - 2_000

/** Wie lange die Historie reicht (ms) — die eigentliche Entscheidung. */
export const HISTORIE_MS = 2 * 24 * 3600 * 1000

/**
 * Wie viele Punkte die Reihe hoechstens haelt.
 *
 * AUSGERECHNET UND NICHT EINGETIPPT: Als feste Zahl haette die Umstellung des
 * Taktes die Historie still verkuerzt — 10080 Punkte sind sieben Tage im
 * Minutentakt, aber nur zwei Tage und acht Stunden bei 20 s. Niemand haette
 * es gemerkt, bis jemand nach der letzten Woche gefragt haette.
 *
 * ZWEI TAGE STATT SIEBEN — ein Tausch, kein Versehen. Die Historie ist der
 * Preis fuer die dreifache Aufloesung: bei sieben Tagen waere die Datei auf
 * 1,9 MB gewachsen, und der Server liest sie beim Start. Die Frage vor einer
 * Kurve lautet „was war da gerade los", nicht „wie war es vorletzten
 * Dienstag".
 */
export const MAX_PUNKTE = Math.round(HISTORIE_MS / MESS_MS)

/**
 * Wie viele Punkte gesammelt werden, bevor auf die Karte geschrieben wird.
 *
 * HIER UND NICHT IM SERVER: Die Zahl stand doppelt — als SYS_SCHREIB_JE im
 * Server und als Vorgabe im Kostenmodell weiter unten. Beim Wechsel des
 * Taktes wandert sonst die eine mit und die andere nicht, und die Rechnung
 * fuer die SD-Karte prueft etwas anderes, als die Box tut.
 *
 * ZEHN MINUTEN, IN PUNKTEN DES JEWEILIGEN TAKTES. Der Abstand zwischen zwei
 * Schreibvorgaengen bleibt damit derselbe wie beim Minutentakt — und genauso
 * das Risiko: nach einem harten Stromverlust fehlen bis zu zehn Minuten
 * Verlauf.
 */
export const SCHREIB_JE = Math.round(600_000 / MESS_MS)

/**
 * Ab welchem Abstand zwei Punkte NICHT mehr zusammenhaengen (ms).
 *
 * Vier Messtakte. Ein einzelner ausgefallener Messpunkt (der Server war
 * gerade beschaeftigt) ist keine Luecke und darf die Linie nicht zerschneiden;
 * eine Nacht mit ausgeschalteter Box ist eine und muss sie zerschneiden.
 */
export const LUECKE_MS = 4 * MESS_MS

/**
 * Der Anteil untaetiger Zeit aus einer /proc/stat-Kopfzeile.
 *
 * Der Kernel zaehlt in Jiffies, seit dem Start, aufsteigend. Ein einzelner
 * Stand sagt darum GAR NICHTS ueber die Auslastung — nur die Differenz
 * zweier Staende tut es, und die ist dann ein echter Mittelwert ueber das
 * ganze Fenster dazwischen.
 */
export interface Statstand {
  /** Summe aller Zeitspalten (Jiffies). */
  gesamt: number
  /** Untaetig: idle + iowait (Jiffies). */
  untaetig: number
}

/**
 * Die Kopfzeile von /proc/stat lesen. Pure.
 *
 * Format: `cpu  142776 45 43454 2669342 2262 0 831 0 0 0` — user, nice,
 * system, idle, iowait, irq, softirq, steal, guest, guest_nice.
 *
 * NUR DIE ERSTEN ACHT WERDEN SUMMIERT, und das ist kein Schlampen: `guest`
 * und `guest_nice` sind in `user` bzw. `nice` BEREITS enthalten. Wer alle
 * zehn addiert, zaehlt Gastzeit doppelt und bekommt auf einer Box mit
 * Virtualisierung eine zu niedrige Auslastung heraus.
 *
 * `cpu ` mit Leerzeichen: `cpu0`, `cpu1`, … sind die einzelnen Kerne und
 * duerfen nicht mitgezaehlt werden.
 */
export function statLesen(text: string): Statstand | null {
  const zeile = String(text ?? '')
    .split('\n')
    .find((z) => z.startsWith('cpu '))
  if (!zeile) return null
  const felder = zeile.trim().split(/\s+/).slice(1, 9).map(Number)
  if (!felder.length || felder.some((z) => !Number.isFinite(z) || z < 0)) return null
  const gesamt = felder.reduce((s, z) => s + z, 0)
  // idle (Feld 4) + iowait (Feld 5); fehlt iowait auf einem alten Kernel, ist
  // es eben nur idle.
  const untaetig = (felder[3] ?? 0) + (felder[4] ?? 0)
  return gesamt > 0 ? { gesamt, untaetig } : null
}

/**
 * Aus zwei /proc/stat-Staenden die Auslastung in Prozent. Pure.
 *
 * `null` statt einer Zahl, wenn die Differenz nichts hergibt:
 *   — gleicher Stand (kein Fenster),
 *   — RUECKWAERTS laufende Zaehler. Das passiert nach einem Neustart, und
 *     es passiert auch, wenn die Box ihre Uhr stellt und dabei springt: dann
 *     kommt der naechste Messpunkt viel zu frueh oder viel zu spaet, und die
 *     Rechnung waere Unsinn. Lieber ein fehlender Punkt als ein erfundener.
 */
export function cpuAnteil(vorher: Statstand | null, nachher: Statstand | null): number | null {
  if (!vorher || !nachher) return null
  const gesamt = nachher.gesamt - vorher.gesamt
  const untaetig = nachher.untaetig - vorher.untaetig
  if (gesamt <= 0 || untaetig < 0 || untaetig > gesamt) return null
  return Math.round(((gesamt - untaetig) / gesamt) * 100)
}

export interface Speicherstand {
  /** MemTotal in kB. */
  gesamtKb: number
  /** Was einem Programm wirklich zur Verfuegung steht, in kB. */
  verfuegbarKb: number
}

/**
 * /proc/meminfo lesen. Pure.
 *
 * MemAvailable ist die richtige Zahl (siehe `Punkt.m`). Auf Kerneln vor 3.14
 * gibt es sie nicht — dann wird sie aus MemFree + Buffers + Cached
 * angenaehert. Das ist genau die Naeherung, die der Kernel selbst ersetzt
 * hat, weil sie zu optimistisch ist; sie ist hier der Rueckfall und nicht der
 * Regelfall, und auf dieser Box (6.x) greift sie nie.
 */
export function speicherLesen(text: string): Speicherstand | null {
  const zahl = (name: string): number | null => {
    const m = new RegExp(`^${name}:\\s+(\\d+)\\s*kB`, 'm').exec(String(text ?? ''))
    return m ? Number(m[1]) : null
  }
  const gesamtKb = zahl('MemTotal')
  if (!gesamtKb || gesamtKb <= 0) return null
  const verfuegbar = zahl('MemAvailable')
  if (verfuegbar !== null) return { gesamtKb, verfuegbarKb: Math.min(verfuegbar, gesamtKb) }
  const frei = zahl('MemFree')
  if (frei === null) return null
  const genaehert = frei + (zahl('Buffers') ?? 0) + (zahl('Cached') ?? 0)
  return { gesamtKb, verfuegbarKb: Math.min(genaehert, gesamtKb) }
}

/** Belegter Speicher in Prozent. Pure. */
export function speicherAnteil(stand: Speicherstand | null): number | null {
  if (!stand || stand.gesamtKb <= 0) return null
  const anteil = ((stand.gesamtKb - stand.verfuegbarKb) / stand.gesamtKb) * 100
  return Math.max(0, Math.min(100, Math.round(anteil)))
}

/**
 * Aus den Messwerten einen Punkt machen.
 *
 * `null`, wenn Last ODER Speicher fehlen — lieber eine LUECKE in der Kurve
 * als eine erfundene Null, die spaeter wie eine schlafende Box aussieht.
 * Dieselbe Regel wie `punktAus` beim Akku.
 *
 * Die Temperatur darf fehlen (Rechner ohne Sensor) und wandert dann als
 * `null` mit: die beiden anderen Kurven sind deshalb nicht weniger wahr.
 */
export function punktBauen(o: {
  t: number
  cpu: number | null
  speicher: number | null
  temperatur?: number | null
  last?: number | null
}): Punkt | null {
  if (!Number.isFinite(o.t)) return null
  if (o.cpu === null || o.cpu === undefined || !Number.isFinite(o.cpu)) return null
  if (o.speicher === null || o.speicher === undefined || !Number.isFinite(o.speicher)) return null
  const g = o.temperatur
  const l = o.last
  return {
    t: Math.round(o.t),
    c: Math.max(0, Math.min(100, Math.round(o.cpu))),
    m: Math.max(0, Math.min(100, Math.round(o.speicher))),
    g: g === null || g === undefined || !Number.isFinite(g) ? null : Math.round(g * 10) / 10,
    l: l === null || l === undefined || !Number.isFinite(l) ? null : Math.max(0, Math.round(l * 100)),
  }
}

/** Sieht das wie ein Punkt aus? Pure — der Torwaechter beim Einlesen. */
export function istPunkt(x: unknown): x is Punkt {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false
  const p = x as Record<string, unknown>
  const zahl = (w: unknown) => typeof w === 'number' && Number.isFinite(w)
  const zahlOderNichts = (w: unknown) => w === null || zahl(w)
  return zahl(p.t) && zahl(p.c) && zahl(p.m) && zahlOderNichts(p.g) && zahlOderNichts(p.l)
}

/**
 * Einen Punkt anhaengen.
 *
 * Zu dicht am letzten -> verworfen. Ueber der Obergrenze -> die aeltesten
 * fallen weg. Ein Punkt aus der VERGANGENHEIT wird ebenfalls verworfen.
 *
 * DER ZEITSPRUNG IST HIER KEIN GEDANKENSPIEL: auf dieser Box lagen am
 * 07.08.2026 Journal und Uhr 43 Minuten auseinander („Time jumped backwards,
 * rotating" im Protokoll). Ein Pi hat keine gepufferte Uhr; er startet in der
 * Vergangenheit und springt vorwaerts, sobald das Netz da ist — und er kann
 * rueckwaerts springen, wenn die Zeitquelle etwas anderes sagt als der
 * Schaetzwert beim Start. Ohne diese Zeile laege die Reihe danach
 * durcheinander, und jede Kurve waere Unsinn.
 */
export function anhaengen(
  reihe: ReadonlyArray<Punkt>,
  punkt: Punkt | null,
  opts: { maxPunkte?: number; minAbstandMs?: number } = {},
): Punkt[] {
  const max = opts.maxPunkte ?? MAX_PUNKTE
  const abstand = opts.minAbstandMs ?? MIN_ABSTAND_MS
  if (!punkt) return [...reihe]
  const letzter = reihe[reihe.length - 1]
  if (letzter && punkt.t - letzter.t < abstand) return [...reihe]
  const neu = [...reihe, punkt]
  return neu.length > max ? neu.slice(neu.length - max) : neu
}

/**
 * Nach einem Zeitsprung aufraeumen: was in der ZUKUNFT liegt, fliegt raus,
 * der Rest wird sortiert.
 *
 * Eine Minute Nachsicht, damit ein Punkt, der beim Laden gerade eben
 * geschrieben wurde, nicht an der eigenen Uhr scheitert.
 */
export function bereinigen(reihe: ReadonlyArray<Punkt>, jetzt: number): Punkt[] {
  return reihe.filter((p) => Number.isFinite(p.t) && p.t <= jetzt + 60_000).sort((a, b) => a.t - b.t)
}

/**
 * Ab wann ein Rueckwaertssprung der Uhr ein SPRUNG ist und nicht Rauschen (ms).
 *
 * Fuenf Minuten. Ein Zeitdienst, der die Uhr um Sekunden zurechtruckelt, soll
 * die Reihe nicht anfassen; 43 Minuten (der gemessene Fall vom 07.08.2026)
 * sollen es sehr wohl.
 */
export const ZEITSPRUNG_MS = 5 * 60_000

/**
 * Steht die Reihe in der Zukunft? Dann ist die UHR gesprungen, nicht die Reihe.
 *
 * WARUM DAS EIGENS GEFRAGT WIRD, obwohl `anhaengen` Punkte aus der
 * Vergangenheit schon verwirft: genau dieses Verwerfen waere hier der Fehler.
 * Springt die Uhr um 43 Minuten zurueck, liegt die ganze bisherige Reihe in
 * der Zukunft — und `anhaengen` wuerde dann DREIVIERTEL STUNDE LANG jeden
 * neuen Punkt ablehnen, weil er „aelter" ist als der letzte. Die Kurve
 * bekaeme ein Loch, das niemand erklaeren kann, und der Server saehe gesund
 * dabei aus.
 *
 * Richtig ist das Gegenteil: die Uhr hat jetzt recht, die Reihe hat unrecht.
 * Was in der Zukunft liegt, geht mit `bereinigen` weg, und die Aufzeichnung
 * laeuft sofort weiter.
 */
export function uhrGesprungen(reihe: ReadonlyArray<Punkt>, jetzt: number, schwelleMs = ZEITSPRUNG_MS): boolean {
  const letzter = reihe[reihe.length - 1]
  return !!letzter && letzter.t > jetzt + schwelleMs
}

/** Nur die letzten `stunden` Stunden. */
export function spanne(reihe: ReadonlyArray<Punkt>, stunden: number, jetzt: number): Punkt[] {
  const ab = jetzt - stunden * 3_600_000
  return reihe.filter((p) => p.t >= ab)
}

/** Ein zusammenhaengendes Stueck Aufzeichnung. */
export interface Abschnitt {
  von: number
  bis: number
  /** Wie viele ROHE Messpunkte darin liegen (vor dem Ausduennen). */
  punkte: number
}

/**
 * Die Reihe an ihren LUECKEN zerlegen.
 *
 * DAS IST DIE ZEILE, WEGEN DER DIE KURVE NICHT LUEGT. Die Box wird abends
 * ausgeschaltet; zwischen 21:40 und 07:10 gibt es keine Messwerte. Eine
 * Linie, die darueber hinwegzeichnet, behauptet einen gleichmaessigen Verlauf
 * ueber eine Nacht, in der niemand gemessen hat — und ausgerechnet bei der
 * Temperatur waere das die Aussage „die Box war die ganze Nacht 47 °C warm".
 *
 * WARUM DER SERVER DAS RECHNET UND NICHT DIE OBERFLAECHE: die Oberflaeche
 * bekommt eine AUSGEDUENNTE Reihe und muesste die Schwelle aus deren
 * mittlerem Abstand schaetzen (so macht es `akkuLuecke` in NewDesign/app.js,
 * und es ist dort die einzig moegliche Loesung). Der Server kennt den echten
 * Messtakt. Beide Wege sind vertraeglich — die Oberflaeche darf weiter
 * schaetzen —, aber hier steht die Wahrheit, und sie kostet nichts.
 */
export function abschnitte(reihe: ReadonlyArray<Punkt>, lueckeMs = LUECKE_MS): Abschnitt[] {
  const raus: Abschnitt[] = []
  for (const p of reihe) {
    const letzter = raus[raus.length - 1]
    if (letzter && p.t - letzter.bis <= lueckeMs) {
      letzter.bis = p.t
      letzter.punkte++
      continue
    }
    raus.push({ von: p.t, bis: p.t, punkte: 1 })
  }
  return raus
}

/**
 * Fuer die Anzeige ausduennen.
 *
 * Sieben Tage im Minutentakt sind 10 080 Punkte; der Schirm der Box ist
 * 800 x 480 gross, und die Kurve bekommt davon vielleicht 560 Pixel. Es wird
 * gleichmaessig gerafft und der LETZTE Punkt immer behalten — er ist der
 * aktuelle Stand.
 *
 * WAS DABEI VERLOREN GEHT, und warum es hinnehmbar ist: eine Spitze, die
 * kuerzer ist als ein Raffschritt, faellt weg. Bei der Last ist das schon
 * VORHER passiert und mit Absicht — `c` ist der Mittelwert ueber eine ganze
 * Minute, ein Lastsprung von acht Sekunden steht dort ohnehin nur als
 * Dreizehntel drin. Die Alternative (je Fenster den GROESSTEN Wert nehmen)
 * saehe schaerfer aus und waere unehrlich: sie zeichnete eine Kurve, die
 * dauerhaft hoeher laeuft als die Maschine je war.
 */
export function ausduennen(reihe: ReadonlyArray<Punkt>, max: number): Punkt[] {
  if (max <= 0) return []
  if (reihe.length <= max) return [...reihe]
  const schritt = reihe.length / max
  const raus: Punkt[] = []
  for (let i = 0; i < max; i++) raus.push(reihe[Math.floor(i * schritt)])
  const letzter = reihe[reihe.length - 1]
  if (raus[raus.length - 1].t !== letzter.t) raus[raus.length - 1] = letzter
  return raus
}

/* ══ DIE RECHNUNG, BEVOR GEBAUT WIRD ═══════════════════════════════════════
 *
 * DIE BOX LAEUFT VON EINER SD-KARTE (/dev/mmcblk0p2, ext4, noatime,lazytime
 * — am Geraet nachgesehen). Eine Zeitreihe, die im Minutentakt geschrieben
 * wird, ist der klassische Weg, so eine Karte in einem Jahr kaputtzuschreiben.
 * Deshalb steht die Rechnung hier als CODE und nicht als Kommentar: sie ist
 * gepruefte Aussage (systemverlauf.spec.ts) und das Werkzeug
 * tools/systemverlauf-am-server.ts haelt sie gegen eine echte Messung aus
 * /proc/self/io.
 *
 * WAS EINE KARTE WIRKLICH SCHLUCKT: nicht die Bytes, die man schreibt. Ein
 * Dateisystem schreibt in BLOECKEN (ext4: 4096 Bytes). Wer 44 Bytes an eine
 * Datei anhaengt, laesst den angebrochenen letzten Block komplett neu
 * schreiben — plus einen Journaleintrag, weil sich die Dateigroesse aendert.
 * Aus 44 Bytes werden so rund 8 kB. Darunter liegt noch die Karte selbst mit
 * Loeschbloecken von mehreren Megabyte; die rechnet hier niemand mit, sie
 * macht den Unterschied zwischen den beiden Verfahren aber nur GROESSER,
 * weil sie fortlaufendes Anhaengen belohnt und Neuschreiben bestraft.
 */

/** Blockgroesse des Dateisystems (ext4 auf dieser Box). */
export const BLOCK_BYTES = 4096

/**
 * Womit die Rechnung je Punkt kalkuliert (Bytes, mit Zeilenumbruch).
 *
 * NACHGEZAEHLT statt geschaetzt: eine gewoehnliche Zeile
 * `{"t":1800000000000,"c":13,"m":35,"g":46.9,"l":53}` wiegt 50 Bytes, der
 * schlimmste Fall (dreistellig ueberall, Last ueber 16) 55. Gerechnet wird
 * mit 56 — eine Rechnung ueber die Haltbarkeit einer Karte darf zu teuer
 * sein, nie zu guenstig. Dass die Zeile die Zahl wirklich haelt, prueft
 * systemverlaufablage.spec.ts; laeuft das je auseinander, wird der Test rot
 * und nicht die Karte kaputt.
 */
export const BYTES_JE_PUNKT = 56

/** Was am Ende einer Rechnung herauskommt. Alles in Bytes. */
export interface Aufwand {
  /** Reine Nutzdaten je Stunde. */
  datenJeStunde: number
  /** Was der Karte je Stunde wirklich zugemutet wird. */
  karteJeStunde: number
  /** Dasselbe aufs Jahr. */
  karteJeJahr: number
  /** Wie gross die Datei dabei hoechstens wird. */
  dateiGroesse: number
}

export interface Rechnungswerte {
  /** Wie viele Punkte je Stunde entstehen (60 = Minutentakt). */
  punkteJeStunde?: number
  /** Wie viele Bytes eine Zeile wiegt, mit Zeilenumbruch. */
  bytesJePunkt?: number
  /** Wie viele Punkte gesammelt werden, bevor geschrieben wird. */
  punkteJeSchreiben?: number
  /** Wie viele Punkte die Reihe haelt. */
  ringPunkte?: number
  /** Wie weit die Datei ueber den Ring hinauswachsen darf, bevor verdichtet wird. */
  ueberhang?: number
  blockBytes?: number
}

const aufBlock = (bytes: number, block: number) => Math.ceil(bytes / block) * block
const STUNDEN_JE_JAHR = 8766

/**
 * ANHAENGEN — das Verfahren dieser Reihe.
 *
 * Je Schreibvorgang gehen auf die Karte: die neuen Bytes, der angebrochene
 * Block am Ende (der wird mitgeschrieben) und ein Journalblock fuer die
 * geaenderte Dateigroesse. Dazu kommt die VERDICHTUNG: anhaengen allein kann
 * nichts wegwerfen, also wird die Datei ab und zu einmal ganz neu geschrieben
 * und dabei auf den Ring gekuerzt. Ihr Anteil wird auf die Stunde umgelegt.
 */
export function aufwandAnhaengen(w: Rechnungswerte = {}): Aufwand {
  const punkteJeStunde = w.punkteJeStunde ?? 3_600_000 / MESS_MS
  const bytesJePunkt = w.bytesJePunkt ?? BYTES_JE_PUNKT
  const punkteJeSchreiben = w.punkteJeSchreiben ?? SCHREIB_JE
  const ringPunkte = w.ringPunkte ?? MAX_PUNKTE
  // EIN TAG IN PUNKTEN DES TAKTES und nicht die feste 1440 — die war ein Tag
  // im Minutentakt. Bliebe sie stehen, wuerde bei feinerem Takt dreimal so oft
  // verdichtet, und Verdichten schreibt die GANZE Datei neu.
  const ueberhang = w.ueberhang ?? Math.round(86_400_000 / MESS_MS)
  const block = w.blockBytes ?? BLOCK_BYTES

  const datenJeStunde = punkteJeStunde * bytesJePunkt
  const schreibungen = punkteJeStunde / punkteJeSchreiben
  const jeSchreiben = punkteJeSchreiben * bytesJePunkt + block + block
  const anhaengenJeStunde = schreibungen * jeSchreiben

  // Verdichtet wird, wenn `ueberhang` Punkte ueber dem Ring liegen — also
  // alle (ueberhang / punkteJeStunde) Stunden.
  const verdichtStunden = ueberhang / punkteJeStunde
  const verdichtBytes = aufBlock(ringPunkte * bytesJePunkt, block) * 2 + block
  const verdichtenJeStunde = verdichtBytes / verdichtStunden

  const karteJeStunde = anhaengenJeStunde + verdichtenJeStunde
  return {
    datenJeStunde: Math.round(datenJeStunde),
    karteJeStunde: Math.round(karteJeStunde),
    karteJeJahr: Math.round(karteJeStunde * STUNDEN_JE_JAHR),
    dateiGroesse: Math.round((ringPunkte + ueberhang) * bytesJePunkt),
  }
}

/**
 * DIE GANZE DATEI NEU — das Verfahren der Akkukurve, zum Vergleich.
 *
 * `jsonfile.writeFile` schreibt die vollstaendige Reihe, alle zehn Minuten
 * (server.ts, AKKU_SCHREIB_JE). Bei 10 080 Punkten sind das jedes Mal ein
 * paar hundert Kilobyte — unabhaengig davon, dass sich nur zehn Zeilen
 * geaendert haben.
 *
 * DIESE FUNKTION IST NICHT DAZU DA, DIE AKKUKURVE ZU REPARIEREN. Sie gehoert
 * einem anderen Lauf, und hier wird nichts an ihr angefasst. Sie ist dazu da,
 * die Entscheidung fuer das Anhaengen nachrechenbar zu machen — und ja, das
 * Ergebnis gilt fuer die Akkukurve genauso. Das gehoert gesagt und steht auch
 * im Bericht.
 */
export function aufwandNeuschreiben(w: Rechnungswerte = {}): Aufwand {
  const punkteJeStunde = w.punkteJeStunde ?? 3_600_000 / MESS_MS
  const bytesJePunkt = w.bytesJePunkt ?? BYTES_JE_PUNKT
  const punkteJeSchreiben = w.punkteJeSchreiben ?? 10
  const ringPunkte = w.ringPunkte ?? MAX_PUNKTE
  const block = w.blockBytes ?? BLOCK_BYTES

  const schreibungen = punkteJeStunde / punkteJeSchreiben
  const karteJeStunde = schreibungen * (aufBlock(ringPunkte * bytesJePunkt, block) + block)
  return {
    datenJeStunde: Math.round(punkteJeStunde * bytesJePunkt),
    karteJeStunde: Math.round(karteJeStunde),
    karteJeJahr: Math.round(karteJeStunde * STUNDEN_JE_JAHR),
    dateiGroesse: Math.round(ringPunkte * bytesJePunkt),
  }
}

/* c8 ignore next 3 */
declare const module: { exports: unknown } | undefined
if (typeof module !== 'undefined')
  module.exports = {
    statLesen,
    cpuAnteil,
    speicherLesen,
    speicherAnteil,
    punktBauen,
    istPunkt,
    anhaengen,
    bereinigen,
    uhrGesprungen,
    spanne,
    abschnitte,
    ausduennen,
    aufwandAnhaengen,
    aufwandNeuschreiben,
    MESS_MS,
    MIN_ABSTAND_MS,
    MAX_PUNKTE,
    LUECKE_MS,
    ZEITSPRUNG_MS,
    BLOCK_BYTES,
    BYTES_JE_PUNKT,
  }
