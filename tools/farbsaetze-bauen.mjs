#!/usr/bin/env node
/**
 * SECHZEHN PALETTEN AUSRECHNEN — acht Farben, hell und dunkel, in den GLEICHEN
 * ABSTUFUNGEN wie das Haus, das schon steht.
 *
 * ══ DER AUFTRAG ════════════════════════════════════════════════════════════
 *
 * Betreiber, 07.08.2026, woertlich: „und noch verschiedene farb sets nicht nur
 * hell und dunkel, sondern blau, rot, rosa, grün ... in den gleichen
 * abstufungen." Ihm wurden drei Tiefen vorgelegt; gewaehlt hat er die teuerste:
 * „Ganze Paletten je Farbe. Jede Farbe bekommt eigene Werte fuer Hintergrund,
 * Flaechen, Schrift — hell UND dunkel."
 *
 * DIE BEIDEN ANDEREN TIEFEN STEHEN HIER, WEIL SIE SONST NIEMAND MEHR FINDET.
 * Wer spaeter auf diese Datei stoesst, sieht hundertsechzig gerechnete Zahlen und
 * haelt sie fuer aufwendig — und der naheliegende Gedanke „das ginge doch
 * einfacher" fuehrt genau auf die beiden Wege, die der Betreiber ABGELEHNT
 * hat:
 *
 *   * NUR DIE AKZENTFARBE TAUSCHEN. Abgelehnt. Es waere auch die falsche
 *     Farbe gewesen: der Akzent traegt in diesem Haus BEDEUTUNG („laeuft
 *     gerade"), und genau deshalb dreht er sich hier NICHT mit (siehe
 *     „WAS SICH NICHT MITDREHT" weiter unten). Ein „blauer" Satz, bei dem
 *     nur die Laeuft-Marke blau wird, waere nicht blau, sondern kaputt.
 *
 *   * ERST EINE FARBE ALS MUSTER, die anderen spaeter. Abgelehnt. Bei einer
 *     einzigen Farbe entscheidet man die Rechnung nach dem, was bei dieser
 *     einen Farbe gut aussieht — und weiss danach nicht, ob eine REGEL
 *     dasteht oder eine gluecklich getroffene Handvoll Werte. Erst vier
 *     Faerbungen zeigen das. Die Buntheits-Skalierung (Punkt 3 weiter unten)
 *     ist die einzige Zahl, die nicht aus dem Bestand folgt; sie mit einer
 *     Farbe zu waehlen und dann auf drei weitere loszulassen, waere geraten
 *     gewesen.
 *
 * „IN DEN GLEICHEN ABSTUFUNGEN" IST DIE EIGENTLICHE ANSAGE, und sie ist der
 * ganze Grund fuer dieses Werkzeug. Es sollen nicht vier bunte Entwuerfe
 * entstehen, sondern DASSELBE HAUS in vier Faerbungen.
 *
 * ══ WIE — UND WARUM NICHT VON HAND ═════════════════════════════════════════
 *
 * Zehn Farbwerte je Stand, sechzehn neue Staende: hundertsechzig Zahlen. Von
 * Hand gewaehlt waeren das hundertsechzig Gelegenheiten, einen Helligkeitsabstand um ein
 * paar Prozent zu verfehlen — und ein verfehlter Abstand sieht am Schirm nicht
 * falsch aus, er sieht nur ein bisschen anders aus. Genau davon handelt der
 * Auftrag.
 *
 * DIE RECHNUNG IST DREI ZEILEN LANG:
 *
 *   1. JEDE FARBE BEHAELT IHRE WCAG-LEUCHTDICHTE, auf fuenf Stellen genau.
 *      Der Kontrast zweier Farben haengt AUSSCHLIESSLICH an ihren
 *      Leuchtdichten (WCAG 2.1, 1.4.3). Bleiben die gleich, ist JEDES
 *      Kontrastverhaeltnis der neuen Palette Zeichen fuer Zeichen dasselbe wie
 *      im Bestand. Damit ist die harte Bedingung des Auftrags — „was du neu
 *      baust, darf nicht schlechter sein als das, was dasteht" — nicht
 *      gehofft, sondern GEBAUT. Gemessen wird sie trotzdem
 *      (tools/farbsaetze-messen.mjs); eine Rechnung, die nur behauptet
 *      richtig zu sein, ist eine Behauptung.
 *
 *   2. JEDE PALETTE HAT GENAU EINEN FARBTON. Hintergrund, Flaechen UND Schrift
 *      stehen auf demselben Grad; verschieden sind nur Helligkeit und
 *      Buntheit. Das ist der Punkt, an dem eine Entscheidung faellt, und sie
 *      ist gemessen entstanden:
 *
 *      DER ERSTE ANLAUF DREHTE ALLES UM DENSELBEN WINKEL und behielt damit
 *      jeden Farbton-Abstand des Bestands. Der Bestand ist naemlich nicht
 *      einfarbig: im Hellen ist der Grund warm (Creme, 76°) und die Schrift
 *      kuehl (Violett, 295°) — 219 Grad auseinander. Auf Blau gedreht (Grund
 *      245°) landet die Schrift bei 104° und wird zu #312D02: ein dunkles
 *      OLIV auf hellblauem Grund. Der Kontrast stimmte auf die Stelle genau,
 *      und es sah nach Schmutz aus. Die Wahrnehmung dunkler, fast neutraler
 *      Farben ist nicht ueber alle Farbtoene gleich — ein dunkles Violett
 *      liest sich als „Tinte", ein dunkles Oliv als „Fleck".
 *
 *      DIE WARM-KUEHL-SPANNUNG DES BESTANDS BLEIBT DESHALB DEM BESTAND. Der
 *      Satz „Creme" wird NICHT angefasst, Byte fuer Byte; er behaelt seinen
 *      warmen Grund und seine violette Tinte. Die vier neuen Saetze sind
 *      einfarbig — und das ist auch das, was ein Mensch meint, der „blau"
 *      sagt.
 *
 *   3. DIE BUNTHEIT WIRD SKALIERT, nicht uebernommen. Das Creme des Hauses hat
 *      eine Buntheit von 0,017 — auf Blau gedreht waere das ein Grau, dem man
 *      nicht ansieht, dass es blau sein soll. Der Faktor steht als eine Zahl
 *      da (BUNTHEIT) und ist die EINZIGE Stelle, an der dieses Werkzeug etwas
 *      entscheidet, das nicht aus dem Bestand folgt.
 *
 * Gerechnet wird in OKLCH: Farbton und Buntheit lassen sich dort drehen und
 * strecken, ohne dass die Helligkeit mitwandert. In HSL waere dieselbe Drehung
 * ein Helligkeitssprung von bis zu 30 Prozent — HSL kennt keine Wahrnehmung.
 *
 * ══ WAS NICHT MITGEDREHT WIRD, UND DAS AUSDRUECKLICH ═══════════════════════
 *
 * `--accent`, `--accentDark`, `--accentInk`, `--mp-akzent` und `--weiter-blau`
 * bleiben in ALLEN acht Staenden, was sie sind. Sie sind keine Stimmung,
 * sondern BEDEUTUNG:
 *   --weiter-blau   „weiterhoeren" — dieselbe Zusage wie das blaue ▶ der
 *                   klassischen Oberflaeche (llmwiki
 *                   schwebende-fenster-favoriten-resume).
 *   --accent(Dark)  „laeuft gerade", und die gewaehlte Kategorie.
 *   --mp-akzent     Fortschritt und Haupttaste.
 * Eine Farbe, die je nach Farbsatz etwas anderes heisst, waere schlimmer als
 * ein schwacher Kontrast. Der Betreiber hat ausserdem „Hintergrund, Flaechen,
 * Schrift" genannt — die Bedeutungsfarben sind keines davon.
 *
 * DER PREIS DAVON WIRD GEMESSEN und nicht weggeredet: Ein Korallenrot auf
 * einem rosa Grund hat weniger FARBABSTAND als auf Creme. Sein KONTRAST
 * bleibt nach Regel 1 unveraendert (die Leuchtdichte des Grundes ist
 * dieselbe), aber der Abstand im CIELAB faellt. tools/farbsaetze-messen.mjs
 * rechnet ihn in allen achtzehn Staenden aus.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Von sich aus NICHTS. Es schreibt die Bloecke auf die Konsole. Mit
 * `--pruefen` vergleicht es, was in NewDesign/app.css steht, mit dem, was es
 * ausrechnet — und meldet jede Abweichung. Damit ist das Stilblatt nicht
 * „einmal erzeugt", sondern dauerhaft nachrechenbar.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/farbsaetze-bauen.mjs             # die sechzehn Bloecke
 *   node tools/farbsaetze-bauen.mjs --pruefen   # steht in app.css dasselbe?
 *   node tools/farbsaetze-bauen.mjs --zahlen    # OKLCH und Leuchtdichte dazu
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
/*
 * WIRD DIESE DATEI AUFGERUFEN ODER EINGEBUNDEN?
 *
 * Dieselbe Wache wie in tools/kontrast.mjs, und aus demselben, dort gemessenen
 * Grund: `palette()` und `SAETZE` werden von tools/farbsaetze-messen.mjs
 * eingebunden. Ohne diese Zeile liefe beim Import der Befehlsteil mit — er
 * liest `process.argv`, und die gehoeren dann einem anderen Werkzeug. Ein
 * `--pruefen` an der Messung wuerde hier ein `process.exit` ausloesen, bevor
 * die Messung ihre erste Zahl gerechnet hat.
 */
const ALS_BEFEHL = import.meta.url === pathToFileURL(process.argv[1] || '').href
const PRUEFEN = ALS_BEFEHL && argv.includes('--pruefen')
const ZAHLEN = ALS_BEFEHL && argv.includes('--zahlen')

// ── sRGB <-> OKLab ────────────────────────────────────────────────────────
const linear = (k) => {
  const c = k / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const zurueck = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const zerlegen = (hex) => {
  const s = String(hex).trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) throw new Error(`keine Farbe: ${hex}`)
  return [0, 2, 4].map((i) => Number.parseInt(s.slice(i, i + 2), 16))
}

/** WCAG 2.1 Relative Luminance — die einzige Groesse, an der der Kontrast haengt. */
const leuchte = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const leuchteHex = (hex) => leuchte(zerlegen(hex).map(linear))

/** AUCH FUER ANDERE WERKZEUGE: tools/farbton-vorbilder.mjs fragt damit, auf
 *  welchem Grad ein Vorbild („Pink", „Gelb", „Orange") wirklich liegt. */
export function oklch(hex) {
  const [r, g, b] = zerlegen(hex).map(linear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}

/** OKLCH -> lineares sRGB. Kann AUSSERHALB des Raums liegen; das prueft `imRaum`. */
function ausOklch(L, C, hGrad) {
  const h = (hGrad * Math.PI) / 180
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147 * s,
  ]
}
const imRaum = (rgb) => rgb.every((c) => c >= -0.0006 && c <= 1.0006)
const zuHex = (rgb) =>
  '#' +
  rgb
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(zurueck(Math.max(0, Math.min(1, c))) * 255))).toString(16).padStart(2, '0'),
    )
    .join('')
    .toUpperCase()

/**
 * EINE FARBE DREHEN — auf den Farbton `ton`, Buntheit mal `bunt`, LEUCHTDICHTE GLEICH.
 *
 * ══ WARUM DIE LEUCHTDICHTE UND NICHT DIE OKLCH-HELLIGKEIT ══════════════════
 * Der naheliegende Weg waere, `L` einfach stehenzulassen — OKLCH ist ja
 * gerade der Raum, in dem `L` die wahrgenommene Helligkeit ist. Fuer den
 * KONTRAST taugt das nicht: WCAG rechnet mit der Leuchtdichte, und die ist
 * nicht dasselbe. Ein Blau und ein Gelb mit gleichem OKLCH-`L` unterscheiden
 * sich in der Leuchtdichte um mehr als den Faktor zwei — die Kontraste der
 * neuen Palette waeren dann eben NICHT dieselben, und genau das war die
 * Bedingung.
 *
 * Gesucht wird `L` deshalb mit einer Bisektion, bis die Leuchtdichte auf sechs
 * Stellen stimmt. 60 Schritte sind weit mehr als noetig (jeder halbiert das
 * Intervall) und kosten nichts.
 *
 * ══ UND WENN DIE FARBE NICHT IN DEN RAUM PASST ═════════════════════════════
 * Ein helles Creme mit doppelter Buntheit auf Blau gedreht kann ausserhalb von
 * sRGB liegen. Dann wird die BUNTHEIT zurueckgenommen, nicht die Helligkeit —
 * eine Palette, in der ein Wert dunkler geworden ist, haette einen anderen
 * Kontrast, und das ist die eine Zahl, die nicht wandern darf.
 */
function drehen(hex, ton, bunt, zug = 1) {
  const ziel = leuchteHex(hex) * zug
  const a = oklch(hex)
  const h = ton
  // Grauwerte haben keinen Farbton. Sie zu drehen ergibt wieder denselben
  // Grauwert — aber `bunt` wuerde aus einer Null nichts machen, und das ist
  // richtig so: Weiss bleibt Weiss.
  let C = a.C * bunt
  for (let versuch = 0; versuch < 40; versuch++) {
    // Bisektion ueber L bei fester Buntheit und festem Farbton.
    let lo = 0
    let hi = 1.2
    let rgb = null
    for (let i = 0; i < 60; i++) {
      const mitte = (lo + hi) / 2
      rgb = ausOklch(mitte, C, h)
      if (leuchte(rgb) < ziel) lo = mitte
      else hi = mitte
    }
    if (imRaum(rgb)) {
      const raus = zuHex(rgb)
      // DIE RUNDUNG AUF ACHT BIT KANN DIE LEUCHTDICHTE UM EIN HAAR VERSCHIEBEN.
      // Gemeldet wird der WIRKLICHE Wert der ausgegebenen Farbe, nicht der
      // gesuchte — sonst stuende in der Pruefung eine Zahl, die kein Bildpunkt
      // je hat.
      return { hex: raus, L: oklch(raus).L, C, h, Y: leuchteHex(raus), YZiel: ziel }
    }
    C *= 0.88
  }
  throw new Error(`${hex} laesst sich bei ${h.toFixed(1)}° nicht mit gleicher Leuchtdichte darstellen`)
}

// ══ DIE VORLAGE — der Bestand, Zeichen fuer Zeichen ════════════════════════
//
// SIE STEHT HIER UND WIRD NICHT AUS app.css GELESEN, und das ist eine
// Entscheidung: Diese zwanzig Werte sind die REFERENZ, gegen die alles andere
// gerechnet wird. Laese das Werkzeug sie aus der Datei, in die es schreibt,
// verschoebe sich beim naechsten Lauf die ganze Familie mit, sobald jemand am
// Bestand dreht — und die sechzehn Paletten waeren still etwas anderes geworden.
// Wer den Bestand aendert, aendert diese Liste bewusst mit; `--pruefen` sagt
// dann sofort, dass app.css nicht mehr dazu passt.
const VORLAGE = {
  hell: {
    bg: '#FFF7EC',
    surface: '#FFFFFF',
    rowBg: '#FBF7F0',
    ink: '#2E2A3B',
    muted: '#8B8397',
    line: '#F3EDE2',
    line2: '#EFE7DA',
    pill: '#2E2A3B',
    pillInk: '#FFF7EC',
    hl: '#FFE7C2',
  },
  dunkel: {
    bg: '#1A1726',
    surface: '#241F33',
    rowBg: '#201B2E',
    ink: '#F2EDE4',
    muted: '#9A92AC',
    line: '#2E2840',
    line2: '#3A3350',
    pill: '#2E2840',
    pillInk: '#F2EDE4',
    hl: '#3B3252',
  },
}

/**
 * DIE VIER FARBTOENE — und warum ausgerechnet diese vier Zahlen.
 *
 * Es sind OKLCH-Grad, und sie gelten fuer die GANZE Palette: Hintergrund,
 * Flaechen und Schrift stehen auf demselben Grad (Begruendung oben, Regel 2).
 *
 * SIE HALTEN ABSTAND ZU DEN BEDEUTUNGSFARBEN, die nicht mitdrehen:
 *   --accent      30°   (Korallenrot, „laeuft gerade")
 *   --mp-akzent   81°   (Gelb, Fortschritt und Haupttaste)
 *   --weiter-blau 260°  („weiterhoeren")
 * Und sie halten Abstand ZUEINANDER, damit vier Saetze auch vier sind: 245,
 * 22, 342, 152 — die engste Nachbarschaft ist Rot zu Rosa mit 40 Grad, und
 * die ist am Schirm deutlich (ein warmes Rot gegen ein kuehles Rosa).
 *
 * ROT LIEGT AUF 22 UND NICHT AUF 30. Auf 30 haette der Grund denselben
 * Farbton wie `--accent`, und die Marke „laeuft gerade" waere im roten Satz
 * eine Flaeche in der Farbe ihres Untergrunds — hell genug, um sichtbar zu
 * sein (die Leuchtdichte bleibt ja), aber nicht mehr als eigene FARBE zu
 * benennen. 22° gegen 30° ist wenig; getragen wird der Unterschied von der
 * Buntheit (0,19 gegen 0,04) und der Helligkeit.
 *
 * BLAU LIEGT AUF 245 UND NICHT AUF 260. Auf 260 waere der Grund im gleichen
 * Ton wie `--weiter-blau`, und genau diese Farbe traegt eine ZUSAGE. Der
 * Abstand bleibt gemessen und steht in tools/farbsaetze-messen.mjs.
 */
export const SAETZE = [
  { id: 'creme', wort: 'Creme', ton: null },
  { id: 'blau', wort: 'Blau', ton: 245 },
  { id: 'rot', wort: 'Rot', ton: 22 },
  { id: 'rosa', wort: 'Rosa', ton: 342 },
  { id: 'gruen', wort: 'Grün', ton: 152 },
  /* ══ SUPER-ROSA — DERSELBE TON, DOPPELT SO BUNT ═══════════════════════
   *
   * Betreiber, 08.08.2026: „ich möchte noch ein rosa farb schema" — und auf
   * den Hinweis, dass es Rosa schon gibt: „es ist zu wenig rosa
   * gutachterin meine tochter", dann „ich finde das rosa gut vielleicht
   * könenn wir ja ein 2tes super rosa einführen".
   *
   * ES IST EIN SECHSTER SATZ UND KEINE AENDERUNG AM FUENFTEN. Wer Rosa
   * eingestellt hat, behaelt es — eine Palette, die sich unter dem Kind
   * veraendert, ist etwas anderes als eine neue zur Wahl.
   *
   * DERSELBE TON (342°) UND NUR MEHR BUNTHEIT. Ein zweiter Rosa-Ton daneben
   * waere ein sechster Grad im Kreis und muesste Abstand zu Rot (22°) und zu
   * den Bedeutungsfarben halten; er saehe ausserdem nach „anderes Rosa" aus,
   * nicht nach „mehr Rosa". Gefragt war mehr.
   *
   * `bunt` GILT NUR HIER. Alle anderen Saetze nehmen weiter BUNTHEIT — die
   * Zahl, die im Kopf dieser Datei begruendet steht. Ein Faktor je Satz
   * waere die Einladung, sechs Zahlen zu pflegen; einer als AUSNAHME mit
   * einem Namen ist eine Entscheidung, die man liest.
   *
   * WARUM 3,8 UND NICHT MEHR — GEMESSEN, NICHT GESCHAETZT. Der erste Versuch
   * stand auf 4,6; tools/farbsaetze-messen.mjs meldete daraufhin EINE
   * Abweichung: „Ladeband gegen Entladeband" im Hellen, bei Rotblindheit 19,9
   * statt der geforderten 20. Das sind die beiden Baender unter der
   * Akkukurve; laufen sie zusammen, zeigt die Kurve zwei Sachen in einer
   * Farbe. Aufgefaechert ergab sich:
   *     3,8 -> 20,8    4,0 -> 20,2    4,2 -> 19,8    4,4 -> 19,2
   * 3,8 haelt die Marke mit Luft. Und WEITER OBEN IST NICHTS ZU HOLEN: ab
   * etwa 4,4 klemmt der Ton am Rand des Bildschirmraums, die Buntheit steigt
   * nicht mehr mit — 4,6 sah kein bisschen rosiger aus als 3,8, nur enger.
   *
   * IM DUNKLEN 2,6 statt 1,5. Derselbe Grund wie im Hellen, nur gedaempft:
   * ein dunkler Grund mit voller Buntheit leuchtet abends im Kinderzimmer. */
  { id: 'superrosa', wort: 'Lila', ton: 342, bunt: { hell: 3.8, dunkel: 2.6 }, zierat: { hell: 0.55 }, nachlass: 5.5 },

  /* ══ PINK, GELB, ORANGE — die drei vom 08.08.2026 ══════════════════════
   *
   * Betreiber: „sie meint es ist lila und nicht pink ich finde es gut jedoch
   * noch ein pinkes", dann „und ein gelbes" und „und oragenes". Die
   * Gutachterin ist seine Tochter.
   *
   * SIE HAT RECHT, UND ES IST NACHGEMESSEN (tools/farbton-vorbilder.mjs):
   *     Lila  (violet, orchid, purple)          Mitte 326°
   *     Pink  (hotpink, deeppink, Barbie)       Mitte 354°
   *     Gelb  (yellow, gold, Sonnenblume)       Mitte  99°
   *     Orange(orange, darkorange, Mandarine)   Mitte  57°
   * Rosa und der starke Satz daneben stehen auf 342° — genau ZWISCHEN Lila
   * und Pink. Mit wenig Buntheit liest sich das als Rosa, mit viel kippt es
   * nach Lila. Deshalb heisst der starke jetzt „Lila" (der TON bleibt, der
   * Betreiber mag ihn) und Pink kommt als eigener Satz dazu.
   *
   * DIE KENNUNG superrosa BLEIBT, obwohl das Wort sich aendert. Sie steht im
   * Browser der Box; eine neue Kennung machte aus einer eingestellten Farbe
   * einen unbekannten Wert, und der faellt auf Creme zurueck — das Kind
   * saehe von einer Umbenennung, dass seine Farbe weg ist.
   *
   * DIE DREI DRAENGELN BEI DEN BEDEUTUNGSFARBEN, und das ist Absicht statt
   * Versehen: Gelb liegt 18° von `--mp-akzent` (81°), Orange 24° davon und
   * 27° von `--accent` (30°). Der Bestand haelt es vor: Rot liegt 8° von
   * `--accent` und traegt trotzdem, weil Buntheit und Helligkeit den
   * Unterschied machen. OB es traegt, sagt hier NICHT der Grad, sondern
   * tools/farbsaetze-messen.mjs — und zwar fuer jede Paarung einzeln, auch
   * bei Rot- und Gruenblindheit. */
  { id: 'pink', wort: 'Pink', ton: 354, bunt: { hell: 3.8, dunkel: 2.6 }, zierat: { hell: 0.55 }, nachlass: 5.5 },
  { id: 'gelb', wort: 'Gelb', ton: 99, bunt: { hell: 3.8, dunkel: 2.6 } },
  { id: 'orange', wort: 'Orange', ton: 57, bunt: { hell: 3.8, dunkel: 2.6 }, zierat: { hell: 0.55 }, nachlass: 5.5 },
  /* ══ KITTYPINK — das Baby-Rosa von #FFC0CB (Betreiber, 15.08.2026) ═════
   *
   * „mach ein farbschema kittypink ffc0cb". Die Vorlage ist das klassische
   * CSS-Pink, und ihr Ton ist GEMESSEN, nicht geraten: oklch('#FFC0CB')
   * ergibt 7° — ein warmes Rosa genau ZWISCHEN Pink (354°) und Rot (22°),
   * ein eigener Platz im Kreis, kein zweiter Aufguss eines vorhandenen.
   *
   * DAS REZEPT IST DAS DER STARKEN WARMTOENE (pink/orange): bunt 3,8/2,6,
   * zierat 0,55, nachlass 5,5. Ob das bei 7° traegt — 23° neben --accent
   * (30°) —, sagt wie immer NICHT der Grad, sondern
   * tools/farbsaetze-messen.mjs, fuer jede Paarung, auch farbenblind. */
  { id: 'kittypink', wort: 'Kittypink', ton: 7, bunt: { hell: 3.8, dunkel: 2.6 }, zierat: { hell: 0.55 }, nachlass: 5.5 },

  /* ══ CLASSIC — die Ur-Toene der alten Oberflaeche (E120, 05.09.2026) ═══
   *
   * Der elfte Satz ist KEIN gedrehter: er traegt FESTWERTE (`werte` statt
   * `ton`), abgelesen an der geloeschten Angular-Oberflaeche — dunkle
   * Flaeche #121212, Leiste #1F1F1F, fast-weisse Schrift #F4F5F8 (das
   * „fast weiss" des hellen Rings, rgb(244,245,248), llmwiki:
   * mupi-themen-und-classic). So sieht das Classic-THEMA (mixpi-thema,
   * farben.satz='classic' + licht='dunkel') aus wie die Ur-MuPiBox, ohne
   * dass irgendwo eine zweite Farbmechanik entsteht: derselbe Wahler,
   * dieselbe /farben.css-Ueberlagerung, dieselben Muster-Knoepfe.
   *
   * DIE HELLE FASSUNG ist neutralgrau abgeleitet (kein Erbe — die alte
   * Oberflaeche WAR dunkel): wer im Classic-Thema auf hell schaltet,
   * bekommt denselben unbunten Charakter statt ploetzlich Creme.
   * Ob die Paarungen tragen, sagt tools/farbsaetze-messen.mjs — auch fuer
   * Festwert-Saetze, sie laufen durch dieselbe Pruefung. */
  {
    id: 'classic',
    wort: 'Classic',
    ton: null,
    werte: {
      dunkel: {
        bg: '#121212',
        surface: '#1F1F1F',
        rowBg: '#181818',
        ink: '#F4F5F8',
        muted: '#9E9EA6',
        line: '#2A2A2A',
        line2: '#343438',
        pill: '#2A2A2A',
        pillInk: '#F4F5F8',
        hl: '#343438',
      },
      hell: {
        bg: '#F4F5F8',
        surface: '#FFFFFF',
        rowBg: '#ECEDF1',
        ink: '#1F1F1F',
        muted: '#6B6B72',
        line: '#E2E3E8',
        line2: '#D6D7DD',
        pill: '#1F1F1F',
        pillInk: '#F4F5F8',
        hl: '#DDDEE4',
      },
    },
  },
]

/**
 * WARUM SUPER-ROSA IM HELLEN NUR WENIG ROSIGER IST — die Grenze ist gemessen.
 *
 * Der helle Grund ist Fast-Weiss: `--bg` hat eine Leuchtdichte von 0,96. Bei
 * dieser Helligkeit passt in den Bildschirmraum FAST KEINE BUNTHEIT mehr; die
 * Bisektion in `drehen` schneidet sie weg, und heraus kommt Zeichen fuer
 * Zeichen dasselbe #FFF6FB wie bei Rosa. Der Faktor 3,8 wirkt deshalb dort,
 * wo Platz ist: in Schrift, Kissen, Nebentext — und im DUNKLEN Stand, wo aus
 * #281220 ein deutlich rosigeres #310825 wird.
 *
 * ES WURDE VERSUCHT, DIE FLAECHEN DUNKLER ZU MACHEN, damit die Buntheit
 * hineinpasst — ein zweiter Regler `flaeche`, der die Ziel-Leuchtdichte der
 * hellen Rollen zieht. Bei 0,86 kam ein echtes Rosa heraus (#FDE0F1), und es
 * kostete GENAU EINE harte Marke: das gruene Ladeband haelt auf diesem Grund
 * nur noch 2,75 : 1 statt der geforderten 3. Aufgefaechert:
 *     1,00 -> 3,18    0,95 -> 3,02    0,93 -> 2,97    0,86 -> 2,75
 * Das Gruen ist keine Zierde — es ist die Ladefarbe der Akkukurve UND die
 * gruene Wahl der Player-Akzentfarbe, die auf ebendiesem Grund sitzt.
 *
 * Der Regler ist deshalb ENTFERNT und nicht auf 1 gestellt: ein Knopf, der
 * nichts tun darf, ist ein Knopf, an dem der Naechste dreht. Wer den Handel
 * doch eingehen will (mehr Rosa gegen die Zusage auf dem Ladeband), findet
 * hier, was er dafuer wieder anfassen muss.
 */

/**
 * WIE VIEL BUNTER ALS DER BESTAND.
 *
 * Das Creme des Hauses hat eine Buntheit von 0,0169 — auf Blau gedreht waere
 * das ein Grau mit einem Hauch Blau, dem niemand ansieht, dass es ein
 * Farbsatz sein soll. 2,2 macht daraus 0,037: deutlich als Farbe zu erkennen
 * und weit entfernt von einem Buntpapier.
 *
 * ES IST DIE EINZIGE ZAHL DIESES WERKZEUGS, DIE NICHT AUS DEM BESTAND FOLGT,
 * und sie steht deshalb allein und benannt da. Alles andere ist gerechnet.
 *
 * IM DUNKLEN WENIGER (1,5): Dort ist die Buntheit des Bestands schon hoeher
 * (bis 0,056 bei `--hl`), und ein dunkler Grund mit 0,12 Buntheit leuchtet
 * abends im Kinderzimmer — genau das, was der dunkle Stand abstellen soll.
 */
export const BUNTHEIT = { hell: 2.2, dunkel: 1.5 }

/** Die zehn Eigenschaften, die eine Palette ausmachen — in der Reihenfolge von app.css. */
const ROLLEN = ['bg', 'surface', 'rowBg', 'ink', 'muted', 'line', 'line2', 'pill', 'pillInk', 'hl']

/** Alle Werte eines Satzes in einem Stand. `creme` gibt die Vorlage unveraendert zurueck. */
export function palette(satzId, stand) {
  const satz = SAETZE.find((s) => s.id === satzId)
  if (!satz) throw new Error(`unbekannter Satz: ${satzId}`)
  const vorlage = VORLAGE[stand]
  if (!vorlage) throw new Error(`unbekannter Stand: ${stand}`)
  // FESTWERT-Saetze (classic): eigene Hex-Werte statt Drehung — dieselbe
  // Rueckgabeform, damit Messung und Block-Bau nichts unterscheiden muessen.
  if (satz.werte) {
    const eigene = satz.werte[stand]
    if (!eigene) throw new Error(`Satz ${satzId} traegt keinen Stand ${stand}`)
    const raus = {}
    for (const r of ROLLEN) raus[r] = { hex: eigene[r], Y: leuchteHex(eigene[r]), ...oklch(eigene[r]) }
    return raus
  }
  if (satz.ton === null) {
    const raus = {}
    for (const r of ROLLEN) raus[r] = { hex: vorlage[r], Y: leuchteHex(vorlage[r]), ...oklch(vorlage[r]) }
    return raus
  }
  const raus = {}
  // `satz.bunt` ist die AUSNAHME und nicht die Regel — siehe Super-Rosa oben.
  const bunt = (satz.bunt && satz.bunt[stand]) || BUNTHEIT[stand]
  const zug = (satz.zierat && satz.zierat[stand]) || 1
  const ZIERAT = ['hl', 'line', 'line2']
  for (const r of ROLLEN) raus[r] = drehen(vorlage[r], satz.ton, bunt, ZIERAT.includes(r) ? zug : 1)
  return raus
}

/**
 * DIE SPUR DES FORTSCHRITTSRINGS — `--ink` mit 18 Prozent, AUSGESCHRIEBEN.
 *
 * Sie wird aus `--ink` gerechnet und nicht als `color-mix` in die Datei
 * geschrieben. Der Grund steht im Bestand bei `--ring-spur`: eine
 * Farbmischung zur Laufzeit waere eine Wette auf die Fassung des Chromium auf
 * der Box, und faellt sie aus, verschwindet die Spur ganz — der Ring waere
 * dann ein Bogen ohne Bahn.
 */
export const ringSpur = (inkHex) => {
  const [r, g, b] = zerlegen(inkHex)
  return `rgba(${r}, ${g}, ${b}, 0.18)`
}

/**
 * DIE WAHLER EINES BLOCKS — und warum es ZWEI je Stand sind.
 *
 * ══ DIE PALETTE MUSS AUCH AUF EINEM EINZELNEN ELEMENT GELTEN ═════════════
 * Die neun Muster im Admin-Menue (`farbwahlBauen`) zeigen JE Satz einen
 * Grund, eine Flaeche und eine Schrift. Sie sollen das aus DEM STILBLATT
 * nehmen und nicht aus einer zweiten Liste im JavaScript — sonst zeigt das
 * Muster nach der naechsten Rechnung eine Farbe, die die Box nicht mehr hat.
 * Also traegt der Knopf selbst `data-farbe`, und der Wahler muss auf ihn
 * passen. `:root[data-farbe='blau']` tut das nicht: `:root` ist das
 * `<html>` und sonst nichts.
 *
 * DESHALB JE STAND ZWEI WAHLER:
 *   hell    `:root[data-farbe='blau']`  fuer die ganze Seite
 *           `[data-farbe='blau']`       fuer das einzelne Muster
 *   dunkel  `:root[data-farbe='blau'][data-licht='dunkel']`
 *           `:root[data-licht='dunkel'] [data-farbe='blau']`
 *
 * WARUM DAS AUFGEHT, obwohl `[data-farbe='blau']` mit 0,1,0 die schwaechste
 * Angabe von allen ist: Ererbte Werte gelten nur dort, wo GAR KEINE Regel auf
 * das Element passt. Eine noch so schwache Regel AM ELEMENT schlaegt jeden
 * geerbten Wert — Spezifitaet entscheidet nur zwischen Regeln, die dasselbe
 * Element treffen. Das Muster bekommt also seine eigene Palette, waehrend die
 * Seite um es herum eine andere traegt.
 *
 * UND „CREME" BRAUCHT NUR DEN ZWEITEN. Die Vorgabe setzt am `<html>` gar kein
 * Attribut (`farbeSetzen` raeumt es weg) — ein `:root[data-farbe='creme']`
 * traefe nie etwas. Das MUSTER braucht ihn trotzdem, sonst zeigte es die
 * Farben des gerade eingestellten Satzes statt der eigenen.
 */
function wahler(satzId, stand) {
  if (satzId === 'creme') {
    return stand === 'dunkel' ? `:root[data-licht='dunkel'] [data-farbe='creme']` : `[data-farbe='creme']`
  }
  return stand === 'dunkel'
    ? `:root[data-farbe='${satzId}'][data-licht='dunkel'],\n:root[data-licht='dunkel'] [data-farbe='${satzId}']`
    : `:root[data-farbe='${satzId}'],\n[data-farbe='${satzId}']`
}

/** Ein CSS-Block je Satz und Stand. */
export function block(satzId, stand) {
  const p = palette(satzId, stand)
  const zeilen = ROLLEN.map((r) => `  --${r}: ${p[r].hex};`)
  zeilen.push(`  --ring-spur: ${ringSpur(p.ink.hex)};`)
  return `${wahler(satzId, stand)} {\n${zeilen.join('\n')}\n}`
}

// ── Ausgabe ───────────────────────────────────────────────────────────────
const bloecke = []
for (const s of SAETZE) for (const stand of ['hell', 'dunkel']) bloecke.push(block(s.id, stand))

if (ZAHLEN) {
  for (const s of SAETZE) {
    for (const stand of ['hell', 'dunkel']) {
      console.log(`\n── ${s.wort} · ${stand} ${s.ton === null ? '(Vorlage)' : `(${s.ton}°)`} ──`)
      const p = palette(s.id, stand)
      for (const r of ROLLEN) {
        const v = p[r]
        console.log(
          `  ${r.padEnd(8)} ${v.hex}   L ${v.L.toFixed(4)}  C ${v.C.toFixed(4)}  h ${v.h.toFixed(1).padStart(5)}  Y ${v.Y.toFixed(5)}`,
        )
      }
    }
  }
}

if (PRUEFEN) {
  // ══ STEHT IN app.css DASSELBE? ═══════════════════════════════════════════
  //
  // WOZU: Ein erzeugter Block, den danach jemand von Hand nachbessert, ist
  // schlimmer als einer, der nie erzeugt wurde — er SIEHT gerechnet aus. Diese
  // Pruefung liest die Datei und vergleicht Wert fuer Wert.
  //
  // UND SIE PRUEFT ZUERST DIE VORLAGE. `VORLAGE` in diesem Werkzeug ist eine
  // Abschrift des Bestands aus `:root` und `:root[data-licht='dunkel']`. Laufen
  // die beiden auseinander — jemand hellt das Creme auf, ohne hier
  // nachzuziehen —, dann sind die acht gerechneten Paletten still zu einer
  // Familie geworden, der die Vorlage nicht mehr angehoert. Und ALLE
  // Kontrastversprechen dieses Werkzeugs waeren gegen die falsche Referenz
  // gerechnet.
  const css = readFileSync(join(WURZEL, 'NewDesign/app.css'), 'utf8')
  let schlecht = 0

  // DER ERSTE WAHLER EINES BLOCKS STEHT ALLEIN AUF SEINER ZEILE und wird von
  // einem Komma oder der geschweiften Klammer gefolgt — je nachdem, ob der
  // Block einen zweiten hat. Beide Faelle muessen hier durch, sonst meldet die
  // Pruefung „steht gar nicht in app.css" ueber Bloecke, die dastehen.
  const rumpfVon = (wahl) => {
    for (const ende of [' {', ',']) {
      const i = css.indexOf(wahl + ende)
      if (i >= 0) return css.slice(i, css.indexOf('}', i))
    }
    return null
  }

  for (const [stand, wahl] of [
    ['hell', ':root'],
    ['dunkel', ":root[data-licht='dunkel']"],
  ]) {
    const rumpf = rumpfVon(wahl)
    if (rumpf === null) {
      console.log(`NEIN  ${wahl} steht gar nicht in app.css`)
      schlecht++
      continue
    }
    for (const [r, soll] of Object.entries(VORLAGE[stand])) {
      const m = rumpf.match(new RegExp(`--${r}:\\s*(#[0-9A-Fa-f]{6})`))
      // `--surface` und `--accentInk` stehen im dunklen Block nicht noch
      // einmal, wo sie sich nicht aendern — was fehlt, erbt aus `:root`.
      if (!m && stand === 'dunkel') continue
      if (!m || m[1].toUpperCase() !== soll.toUpperCase()) {
        console.log(`NEIN  VORLAGE.${stand}.${r}: app.css ${m ? m[1] : '(fehlt)'}, dieses Werkzeug ${soll}`)
        schlecht++
      }
    }
  }

  for (const s of SAETZE) {
    for (const stand of ['hell', 'dunkel']) {
      const erste = wahler(s.id, stand).split(',')[0].trim()
      const rumpf = rumpfVon(erste)
      if (rumpf === null) {
        console.log(`NEIN  ${erste} steht gar nicht in app.css`)
        schlecht++
        continue
      }
      const p = palette(s.id, stand)
      for (const r of ROLLEN) {
        const m = rumpf.match(new RegExp(`--${r}:\\s*(#[0-9A-Fa-f]{6})`))
        const soll = p[r].hex
        if (!m) {
          console.log(`NEIN  ${erste} --${r} fehlt`)
          schlecht++
        } else if (m[1].toUpperCase() !== soll) {
          console.log(`NEIN  ${erste} --${r}: in app.css ${m[1]}, gerechnet ${soll}`)
          schlecht++
        }
      }
      const ms = rumpf.match(/--ring-spur:\s*([^;]+);/)
      if (!ms || ms[1].trim() !== ringSpur(p.ink.hex)) {
        console.log(
          `NEIN  ${erste} --ring-spur: in app.css ${ms ? ms[1].trim() : '(fehlt)'}, gerechnet ${ringSpur(p.ink.hex)}`,
        )
        schlecht++
      }
    }
  }
  // ══ DIE LISTE STEHT AN DREI STELLEN — UND SIE IST SCHON AUSEINANDER ══
  //
  // WAS AM 08.08.2026 PASSIERT IST: `SAETZE` hier und `FARB_SAETZE` in
  // NewDesign/app.js wurden auf neun gebracht. Der Einzeiler im Kopf von
  // NewDesign/index.html — der, der die Farbe VOR dem ersten Bild setzt,
  // damit der Kiosk nicht cremefarben aufblitzt — blieb bei vier. Wer Lila,
  // Pink, Gelb, Orange oder Super-Rosa eingestellt hatte, sah bei jedem
  // Neuladen erst Creme und dann seine Farbe.
  //
  // GEFUNDEN HAT ES EINE SICHTUNG DES GANZEN BAUMS und nicht die Oberflaeche:
  // Ein Aufblitzen von 200 Millisekunden sieht man am Schirm nur, wenn man
  // genau darauf wartet. Deshalb steht die Frage jetzt HIER, wo sie bei jedem
  // `--pruefen` gestellt wird.
  //
  // WARUM DIE DREI NICHT EINE WERDEN: app.css muss die Werte AUSGESCHRIEBEN
  // tragen (eine Rechnung zur Laufzeit waere eine Wette auf das Chromium der
  // Box), und der Einzeiler in index.html laeuft, BEVOR app.js geladen ist —
  // das ist sein ganzer Zweck. Drei Abschriften sind hier unvermeidlich; was
  // vermeidbar ist, ist dass sie STILL auseinanderlaufen.
  const listeAus = (datei, muster, was) => {
    let text
    try {
      text = readFileSync(join(WURZEL, datei), 'utf8')
    } catch {
      console.log(`NEIN  ${datei} laesst sich nicht lesen`)
      return null
    }
    const m = muster.exec(text)
    if (!m) {
      console.log(`NEIN  ${was} steht nicht in ${datei} (Muster passt nicht mehr)`)
      return null
    }
    return [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])
  }

  const ausApp = listeAus('NewDesign/app.js', /const FARB_SAETZE = \[([\s\S]*?)\n  \]/, 'FARB_SAETZE')
  const ausKopf = listeAus('NewDesign/index.html', /var ERLAUBT = \[([^\]]*)\]/, 'die Allowlist des Kopfskripts')
  const sollen = SAETZE.map((x) => x.id)
  // `creme` IST DIE VORGABE UND SETZT KEIN ATTRIBUT — im Kopfskript hat sie
  // deshalb nichts zu suchen; in FARB_SAETZE schon, denn dort ist sie ein
  // waehlbares Muster.
  const sollenOhneCreme = sollen.filter((x) => x !== 'creme')
  const gleich = (a, b) => a && JSON.stringify(a) === JSON.stringify(b)
  if (ausApp && !gleich(ausApp, sollen)) {
    schlecht++
    console.log(`NEIN  FARB_SAETZE in app.js: ${ausApp.join(', ')}`)
    console.log(`      gerechnet wird mit:    ${sollen.join(', ')}`)
  }
  if (ausKopf && !gleich(ausKopf, sollenOhneCreme)) {
    schlecht++
    console.log(`NEIN  ERLAUBT im Kopf von index.html: ${ausKopf.join(', ')}`)
    console.log(`      erwartet (ohne creme):          ${sollenOhneCreme.join(', ')}`)
  }
  if (ausApp === null || ausKopf === null) schlecht++

  console.log(
    schlecht === 0
      ? `ok    app.css, app.js und der Kopf von index.html tragen dieselben ${SAETZE.length} Saetze (x 2 Staende)`
      : `\n${schlecht} Abweichung(en) — die Rechnung und der Baum sind auseinander.`,
  )
  process.exit(schlecht === 0 ? 0 : 1)
}

if (ALS_BEFEHL && !ZAHLEN) {
  console.log(bloecke.join('\n\n'))
}
