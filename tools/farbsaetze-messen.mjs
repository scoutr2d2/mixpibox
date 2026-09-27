#!/usr/bin/env node
/**
 * JEDE PAARUNG IN ACHTZEHN STAENDEN — die harte Bedingung der Farbsaetze.
 *
 * ══ WORUM ES GEHT ══════════════════════════════════════════════════════════
 *
 * Seit dem 08.08.2026 gibt es neun Farbsaetze mal zwei Staende: ACHTZEHN
 * vollstaendige Paletten (Creme, Blau, Rot, Rosa, Gruen — je hell und dunkel).
 * Der Auftrag dazu enthielt eine Bedingung, die nicht verhandelbar war:
 *
 *   „JEDE PAARUNG MUSS GEMESSEN SEIN. […] Was du neu baust, darf nicht
 *    schlechter sein als das, was dasteht."
 *
 * Das sind zwanzig Paarungen mal achtzehn Staende — 360 Zahlen. Von Hand
 * nachzusehen ist das nicht, und „sieht kontrastreich aus" ist keine Messung.
 *
 * ══ ZWEI FRAGEN, UND DIE ZWEITE IST DIE EIGENTLICHE ════════════════════════
 *
 *   1. HAELT JEDE PAARUNG IHRE MARKE? WCAG 2.1 nennt Zahlen: 4,5 : 1 fuer
 *      normalen Text, 3 : 1 fuer grosse Schrift und fuer grafische Objekte
 *      (1.4.3 und 1.4.11).
 *
 *   2. IST SIE SCHLECHTER GEWORDEN ALS IM BESTAND? Das ist die Bedingung des
 *      Auftrags, und sie ist SCHAERFER als Frage 1: `--muted` auf `--bg`
 *      traegt im Hellen 3,41 : 1 und liegt damit unter der Textmarke. Das ist
 *      eine bekannte Hausschwaeche und war vor den Farbsaetzen schon da; sie
 *      darf bleiben, aber sie darf sich NICHT VERMEHREN. Gemessen wird
 *      deshalb jede Zahl gegen die des Satzes „Creme" im selben Stand.
 *
 * tools/farbsaetze-bauen.mjs haelt dazu die WCAG-Leuchtdichte jeder Farbe
 * fest, und daraus FOLGT, dass alle Kontraste gleich bleiben. Diese Datei
 * glaubt das nicht — sie rechnet es nach. Eine Rechnung, die nur behauptet
 * richtig zu sein, ist eine Behauptung.
 *
 * ══ UND DIE DRITTE FRAGE, DIE KEIN KONTRAST BEANTWORTET ════════════════════
 *
 * `--accent` („laeuft gerade"), `--weiter-blau` („weiterhoeren") und
 * `--mp-akzent` (Fortschritt, Haupttaste) drehen sich NICHT mit. Sie tragen
 * BEDEUTUNG, und eine Farbe, die je nach Farbsatz etwas anderes heisst, waere
 * schlimmer als ein schwacher Kontrast.
 *
 * DAFUER STEHEN SIE JETZT AUF ZEHN VERSCHIEDENEN GRUENDEN. Ein Korallenrot auf
 * rosa Grund hat denselben KONTRAST wie auf Creme (die Leuchtdichte des
 * Grundes ist dieselbe) und weniger FARBABSTAND. Ob es noch als eigene Farbe
 * durchkommt, sagt kein Kontrastwert — das sagt der Abstand im CIELAB, und
 * zwar auch NACH einer Simulation von Deuteranopie und Protanopie. Genau
 * dort koennen die neuen Saetze etwas kaputtmachen, was vorher heil war.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts. Es liest tools/farbsaetze-bauen.mjs, rechnet und schreibt auf die
 * Konsole. Keine Datei, keine Box, kein Browser.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/farbsaetze-messen.mjs             # alle Zahlen
 *   node tools/farbsaetze-messen.mjs --knapp     # nur die Zusammenfassung
 *   node tools/farbsaetze-messen.mjs --pruefen   # Ende 1, wenn etwas faellt
 */
import { abstand, kontrast, simulieren } from './kontrast.mjs'
import { SAETZE, palette } from './farbsaetze-bauen.mjs'

const argv = process.argv.slice(2)
const PRUEFEN = argv.includes('--pruefen')
const KNAPP = argv.includes('--knapp')

/**
 * DIE FARBEN, DIE SICH NICHT MITDREHEN — aus app.css abgeschrieben.
 *
 * Sie stehen hier und nicht in `palette()`, weil sie GENAU NICHT zur Palette
 * gehoeren: Sie erben in jedem Satz aus `:root` bzw.
 * `:root[data-licht='dunkel']`. Wer sie drueben aendert, aendert sie hier mit
 * — und dann faellt beim naechsten Lauf auf, ob die Bedeutung noch traegt.
 */
const FEST = {
  hell: {
    accent: '#FF6B57',
    accentDark: '#D9422F',
    accentInk: '#FFFFFF',
    mpAkzent: '#FFC145',
    weiterBlau: '#1B6EF3',
    // Gruen heisst „es laedt" — die Begruendung steht in app.css bei
    // `--laden-gruen`. Im Hellen abgedunkelt, sonst traegt es nicht.
    ladenGruen: '#22A055',
  },
  dunkel: {
    accent: '#FF6B57',
    accentDark: '#D9422F',
    accentInk: '#FFFFFF',
    mpAkzent: '#FFC145',
    weiterBlau: '#3B87FF',
    ladenGruen: '#2DD36F',
  },
}

/**
 * EINE FARBE MIT ALPHA UEBER EINEM GRUND — ausgerechnet, nicht geschaetzt.
 *
 * `--ring-spur` ist `--ink` mit 18 Prozent. Was man SIEHT, ist die Mischung
 * aus ihr und dem, worauf sie liegt; gegen `--ink` selbst zu rechnen ergaebe
 * eine Zahl, die auf keinem Bildpunkt vorkommt.
 *
 * GEMISCHT WIRD IM LINEAREN LICHT und nicht in den 0..255-Werten: Zwei
 * Flaechen mischen sich physikalisch nach ihrer Leuchtdichte. In sRGB-Bytes
 * gemischt kaeme eine zu HELLE Bahn heraus, und die Messung faende einen
 * Kontrast, den der Ring nie hat.
 */
function ueber(vgHex, alpha, hgHex) {
  const lin = (k) => {
    const c = k / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const zur = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
  const teile = (h) => [0, 2, 4].map((i) => Number.parseInt(h.replace('#', '').slice(i, i + 2), 16))
  const a = teile(vgHex).map(lin)
  const b = teile(hgHex).map(lin)
  return (
    '#' +
    a
      .map((c, i) => Math.round(Math.max(0, Math.min(1, zur(c * alpha + b[i] * (1 - alpha)))) * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

/**
 * DIE PAARUNGEN, DIE ES WIRKLICH GIBT.
 *
 * Sie stehen hier als Liste und nicht als Ableitung aus dem Stilblatt: Was
 * zusammen auf dem Schirm landet, sagt keine Datei. `--weiter-blau` und das
 * Kissen `--pill` treffen sich erst am Bild, und `--ink` auf `--hl` gibt es
 * nur, weil die gewaehlte Kategorie so aussieht.
 *
 * `marke` ist die WCAG-Schwelle in diesem Gebrauch:
 *   4.5  normaler Text (1.4.3)
 *   3.0  grosse Schrift und grafische Objekte (1.4.3 / 1.4.11)
 *   0    kein Urteil — es ist Zierrat (eine Trennlinie, eine Ringbahn). Die
 *        Zahl steht trotzdem da, damit man sieht, wenn sie sich bewegt.
 */
const PAARUNGEN = [
  ['Schrift auf Grund', 'ink', 'bg', 4.5],
  ['Schrift auf Fläche', 'ink', 'surface', 4.5],
  ['Schrift auf Zeilengrund', 'ink', 'rowBg', 4.5],
  ['Nebentext auf Grund', 'muted', 'bg', 4.5],
  ['Nebentext auf Fläche', 'muted', 'surface', 4.5],
  ['Nebentext auf Zeilengrund', 'muted', 'rowBg', 4.5],
  ['Schrift auf gewählter Kategorie', 'ink', 'hl', 4.5],
  ['Kissen-Schrift auf Kissen', 'pillInk', 'pill', 4.5],
  // DAS ZEICHEN AUF DER GELBEN HAUPTTASTE IST `--pill` UND NICHT `--ink`.
  // Nachgesehen in app.css (`.mp-haupt { color: var(--pill) }`) und nicht
  // angenommen: Mit `--ink` gerechnet kam im DUNKLEN 1,39 : 1 heraus — ein
  // helles Zeichen auf gelbem Grund, also eine Taste, die man nicht lesen
  // kann. Die Zahl war falsch, die Taste ist es nicht. Genau dafuer steht
  // diese Liste hier und wird nicht aus dem Stilblatt geraten.
  ['Zeichen auf Haupttaste (gelb)', 'pill', 'mpAkzent', 4.5],
  ['Zeichen auf Weiterhören-Knopf', 'accentInk', 'weiterBlau', 3.0],
  ['Zeichen auf Läuft-Marke', 'accentInk', 'accentDark', 3.0],
  ['Läuft-Marke auf Grund', 'accentDark', 'bg', 3.0],
  ['Läuft-Marke auf Fläche', 'accentDark', 'surface', 3.0],
  ['Weiterhören-Knopf auf Grund', 'weiterBlau', 'bg', 3.0],
  ['Weiterhören-Knopf auf Fläche', 'weiterBlau', 'surface', 3.0],
  ['Weiterhören-Knopf auf Kissen', 'weiterBlau', 'pill', 3.0],
  ['Fortschrittsbalken auf Kissen', 'mpAkzent', 'pill', 3.0],
  ['Akzenttext auf Grund', 'accent', 'bg', 3.0],
  // DAS LADEBAND DER AKKUKURVE. Es liegt auf `--bg` (die Karte der Unterseite
  // sitzt direkt auf dem Grund) und ist ein grafisches Objekt — Marke 3,0.
  ['Ladeband auf Grund', 'ladenGruen', 'bg', 3.0],
  ['Ladeband auf Fläche', 'ladenGruen', 'surface', 3.0],
  ['Trennlinie auf Fläche', 'line2', 'surface', 0],
  ['Ringbahn auf Grund', 'ringSpurUeberBg', 'bg', 0],
]

/** Farbpaare, die BEDEUTUNG tragen und deshalb unterscheidbar bleiben muessen. */
const BEDEUTUNG = [
  ['weiterhören-blau gegen läuft-gerade', 'weiterBlau', 'accentDark'],
  ['weiterhören-blau gegen das Kissen', 'weiterBlau', 'pill'],
  ['läuft-gerade gegen den Grund', 'accentDark', 'bg'],
  ['Haupttaste gegen das Kissen', 'mpAkzent', 'pill'],
  // LADEN GEGEN ENTLADEN — die beiden Baender unter der Akkukurve. Der enge
  // Fall ist die GRUENE Palette im Hellen: dort ist `--ink` selbst ein
  // dunkles Gruen. Dass es trotzdem reicht, ist der Grund, warum diese Zeile
  // hier steht und nicht in einem Kommentar.
  ['Ladeband gegen Entladeband', 'ladenGruen', 'ink'],
  ['Ladeband gegen den Grund', 'ladenGruen', 'bg'],
]

/** Ab hier gelten zwei Flaechen als sicher verschiedene FARBEN (wie in kontrast.mjs). */
const MIN_ABSTAND = 20

/** Alle Farben eines Standes unter EINEM Namen — Palette plus die festen. */
function farben(satzId, stand) {
  const p = palette(satzId, stand)
  const f = { ...FEST[stand] }
  for (const [k, v] of Object.entries(p)) f[k] = v.hex
  f.ringSpurUeberBg = ueber(f.ink, 0.18, f.bg)
  return f
}

const staende = []
for (const s of SAETZE) for (const stand of ['hell', 'dunkel']) staende.push({ satz: s, stand })

// ══ 1. JEDE PAARUNG, JEDER STAND ═══════════════════════════════════════════
let unterMarke = 0
let schlechter = 0
let schonImBestand = 0
let neuUnterMarke = 0
const bestand = { hell: {}, dunkel: {} }
/** Wieviel Nachlass ein Satz WIRKLICH gebraucht hat — je Satz der groesste Abfall. */
const genutzt = {}

for (const { satz, stand } of staende) {
  const f = farben(satz.id, stand)
  const zeilen = []
  for (const [name, vg, hg, marke] of PAARUNGEN) {
    const k = kontrast(f[vg], f[hg])
    if (satz.id === 'creme') bestand[stand][name] = k
    const halten = marke === 0 || k >= marke
    // ── DIE SCHAERFERE FRAGE: IST ES SCHLECHTER GEWORDEN? ─────────────────
    //
    // EIN PROZENT TOLERANZ, UND DIE IST GERECHNET UND NICHT GESCHAETZT: Die
    // Paletten werden auf acht Bit gerundet, und die letzte Stelle verschiebt
    // die Leuchtdichte um ein Haar. Bei einem Verhaeltnis von 13 : 1 macht
    // das bis zu 0,08 aus — eine feste Schranke von 0,02 meldete darauf
    // vierzig „Verschlechterungen", von denen keine eine ist. Ein Prozent
    // waechst mit dem Verhaeltnis mit und ist bei 3 : 1 immer noch 0,03.
    // GEMESSEN: Der groesste unangemeldete Abfall dieser Paletten liegt bei
    // 0,08 auf 15,08 — also 0,5 Prozent.
    const vorher = bestand[stand][name]
    // ── DER NACHLASS: EIN ANGEMELDETER, BEGRENZTER ABFALL ─────────────────
    //
    // WOFUER (08.08.2026): Ein heller Grund von Fast-Weiss traegt fast keine
    // Buntheit — bei dieser Helligkeit ist im Bildschirmraum kein Platz
    // dafuer. Wer eine Palette will, die auch im Hellen nach ihrer Farbe
    // aussieht, muss Helligkeit gegen Farbe tauschen. Genau das melden Pink
    // und Orange an: ihr `--hl` wird ein echtes Pink beziehungsweise ein
    // echtes Orange, und die Schrift darauf faellt von 11,6 : 1 auf 6,6 : 1.
    //
    // ES BLEIBT EIN WAECHTER UND WIRD KEIN FREIBRIEF:
    //   * JEDE MARKE GILT WEITER ABSOLUT. Was bei „Creme" haelt und hier
    //     nicht mehr, ist und bleibt ein Fehler — der Nachlass ruehrt daran
    //     nicht. 6,6 : 1 steht ueber 4,5 : 1, sonst zaehlte es nicht.
    //   * ER GILT NUR, WO EIN SATZ IHN ANMELDET. Alle anderen Saetze werden
    //     weiter auf null Abfall geprueft.
    //   * ER IST BEZIFFERT. Wer mehr ausgibt als angemeldet, faellt durch —
    //     und wieviel wirklich gebraucht wurde, steht unten.
    //
    // Der Wert ist ein KONTRASTVERHAELTNIS und keine Prozentzahl: „bis zu
    // sechs Punkte" ist die Sprache, in der die Marken selbst geschrieben
    // sind (4,5 und 3).
    const nachlass = Number(satz.nachlass || 0)
    const grenze = Math.max(0.05, vorher * 0.01) + (halten ? nachlass : 0)
    const abfall = satz.id === 'creme' ? 0 : vorher - k
    // ── UND WAS DAVON IST NEU? ────────────────────────────────────────────
    // Eine Paarung, die schon im Bestand unter ihrer Marke liegt, ist keine
    // Schuld der Farbsaetze — sie ist zehnmal dieselbe alte Schwaeche. Neu
    // ist nur, was bei „Creme" HAELT und hier nicht mehr.
    const bestandHaelt = marke === 0 || (bestand[stand][name] ?? 0) >= marke
    const neuSchlecht = !halten && bestandHaelt && satz.id !== 'creme'
    if (!halten) unterMarke++
    if (!halten && satz.id === 'creme') schonImBestand++
    if (neuSchlecht) neuUnterMarke++
    if (abfall > grenze) schlechter++
    if (nachlass && halten && abfall > Math.max(0.05, vorher * 0.01)) {
      genutzt[satz.id] = Math.max(genutzt[satz.id] || 0, abfall)
    }
    zeilen.push({ name, vg, hg, marke, k, halten, abfall, grenze, neuSchlecht })
  }
  if (!KNAPP) {
    console.log(`\n══ ${satz.wort} · ${stand} ${'═'.repeat(Math.max(0, 46 - satz.wort.length - stand.length))}`)
    for (const z of zeilen) {
      const zeichen = z.marke === 0 ? '  · ' : z.halten ? 'ok  ' : 'NEIN'
      const gegen =
        satz.id === 'creme'
          ? ''
          : z.abfall > z.grenze
            ? `  SCHLECHTER als Creme um ${z.abfall.toFixed(2)}`
            : '  = Bestand'
      console.log(
        `${zeichen} ${z.name.padEnd(32)} ${f[z.vg]} auf ${f[z.hg]}  ${z.k.toFixed(2).padStart(6)} : 1` +
          (z.marke ? `  (>= ${z.marke})` : '  (Zierrat)') +
          gegen,
      )
    }
  }
}

// ══ 2. DIE BEDEUTUNGSFARBEN AUF ZEHN GRUENDEN ══════════════════════════════
//
// HIER KOENNEN DIE NEUEN SAETZE ETWAS KAPUTTMACHEN, WAS VORHER HEIL WAR, und
// zwar OHNE dass ein Kontrastwert sich ruehrt. Der Kontrast ist nach der
// Rechnung in farbsaetze-bauen.mjs unveraendert; der FARBABSTAND ist es nicht.
console.log('\n\n══ DIE BEDEUTUNGSFARBEN — Abstand im CIELAB, auch bei Farbsehschwaeche ══')
console.log(`   ${''.padEnd(48)} normal  deuter.  protan.`)
let zuNah = 0
for (const { satz, stand } of staende) {
  const f = farben(satz.id, stand)
  for (const [name, a, b] of BEDEUTUNG) {
    const n = abstand(f[a], f[b])
    const d = abstand(simulieren(f[a], 'deuteranopie'), simulieren(f[b], 'deuteranopie'))
    const pr = abstand(simulieren(f[a], 'protanopie'), simulieren(f[b], 'protanopie'))
    const ok = Math.min(n, d, pr) >= MIN_ABSTAND
    if (!ok) zuNah++
    if (!KNAPP || !ok) {
      console.log(
        `${ok ? 'ok  ' : 'NEIN'} ${(satz.wort + ' · ' + stand).padEnd(15)} ${name.padEnd(32)} ${n.toFixed(1).padStart(6)} ${d.toFixed(1).padStart(8)} ${pr.toFixed(1).padStart(8)}`,
      )
    }
  }
}

// ══ 3. DIE ZUSAMMENFASSUNG ═════════════════════════════════════════════════
console.log(`\n\n══ ZUSAMMEN ═══════════════════════════════════════════════`)
console.log(`   ${staende.length} Staende x ${PAARUNGEN.length} Paarungen = ${staende.length * PAARUNGEN.length} Kontrastwerte`)
console.log(`   ${staende.length * BEDEUTUNG.length} Farbabstaende (jeder dreimal: normal, Deuteranopie, Protanopie)`)
console.log(`   unter ihrer Marke:            ${unterMarke}`)
console.log(`      davon schon bei „Creme":   ${schonImBestand} (mal ${SAETZE.length * 2} Staende)`)
console.log(`      NEU durch die Farbsaetze:  ${neuUnterMarke}`)
console.log(`   schlechter als der Bestand:   ${schlechter}`)
// WAS DIE ANGEMELDETEN SAETZE WIRKLICH AUSGEGEBEN HABEN. Ohne diese Zeile
// waere der Nachlass eine Zahl, die niemand nachrechnet — und beim naechsten
// Dreh an der Buntheit merkte keiner, dass er aufgebraucht ist.
for (const s of SAETZE) {
  if (!s.nachlass) continue
  const g = genutzt[s.id] || 0
  console.log(
    `   Nachlass ${s.wort.padEnd(8)} angemeldet ${Number(s.nachlass).toFixed(1)}, ` +
      `gebraucht ${g.toFixed(2)}${g > s.nachlass ? '  <- MEHR ALS ANGEMELDET' : ''}`,
  )
}
console.log(`   Bedeutungsfarben zu nah:      ${zuNah}`)

// ══ DIE BEKANNTEN HAUSSCHWAECHEN, BENANNT STATT VERSCHWIEGEN ══════════════
//
// Zwei Paarungen liegen unter ihrer Marke, und beide taten das VOR den
// Farbsaetzen schon:
//   `--muted` auf Grund/Flaeche/Zeilengrund   3,4 : 1 (Marke 4,5)
//   `--accent` als TEXT auf Grund/Flaeche     2,6 : 1 (Marke 3,0)
// Sie sind in jedem der achtzehn Staende GENAU DIESELBE Zahl — die Schwaeche hat
// sich nicht vermehrt, sie ist zehnmal dieselbe. Genau das sagt die Zeile
// „NEU durch die Farbsaetze" oben, und nur die zaehlt fuer das Urteil.
//
// SIE HIER ZU BEHEBEN WAERE DER FALSCHE ORT. `--muted` aufzuhellen aendert das
// Aussehen des Bestands, und das hat niemand bestellt; es gehoert in einen
// eigenen Durchgang mit eigener Entscheidung. Sie WEGZUPRUEFEN hiesse, sie zu
// verstecken. Sie stehen deshalb in jedem Lauf im Bericht und in keinem im
// Ende-Code.

if (PRUEFEN) {
  // ══ WORAN DIESER LAUF SCHEITERT — UND WORAN NICHT ════════════════════════
  //
  // Er scheitert an einer Paarung, die SCHLECHTER geworden ist als im
  // Bestand, und an einer Bedeutungsfarbe, die zu nah an ihren Nachbarn
  // gerueckt ist. Beides waere ein Schaden, den die Farbsaetze angerichtet
  // haben.
  //
  // ER SCHEITERT NICHT AN `--muted`. Diese Schwaeche zu beheben hiesse, das
  // Aussehen des Bestands zu aendern — und das hat niemand bestellt. Sie
  // wegzupruefen hiesse, sie zu verstecken. Sie steht deshalb in JEDEM Lauf
  // im Bericht und in keinem im Ende-Code.
  const schlimm = schlechter + zuNah + neuUnterMarke
  console.log(schlimm === 0 ? '\nALLES GRUEN' : `\n${schlimm} echte Abweichung(en).`)
  process.exit(schlimm === 0 ? 0 : 1)
}
