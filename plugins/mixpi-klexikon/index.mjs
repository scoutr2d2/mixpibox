/**
 * MIXPI-KLEXIKON — Artikel aus dem Klexikon (https://klexikon.zum.de), dem
 * freien Kinderlexikon fuer 6- bis 12-Jaehrige, von der Box VORGELESEN.
 *
 * ══ WARUM DIESES PLUGIN ════════════════════════════════════════════════════
 * Die Box hat eine Stimme (Piper), und das Klexikon hat rund 3500 Artikel,
 * die genau fuer die Kinder geschrieben sind, die vor dieser Box sitzen:
 * kurze Saetze, keine Fremdwoerter ohne Erklaerung. Beides zusammen ist eine
 * Hoerbibliothek, die niemand einsprechen musste.
 *
 * Gesprochen wird NICHT hier. Das Plugin legt je Abschnitt einen Text ueber
 * `kontext.sprechen()` ab (Recht `sprechen`, 28.09.2026) und bekommt sofort
 * eine Quelle zurueck; die Box spricht erst, wenn der Abspieler sie abruft
 * (sprechstrom.ts im Kern). Deshalb passt auch der laengste Artikel in die
 * 8-s-Frist eines Rufs, und deshalb ruft `inhalt()` fuer JEDE Folge
 * `sprechen()` — der Ruf ist billig.
 *
 * ══ MEDIENKENNUNG ══════════════════════════════════════════════════════════
 *
 *   mixpi-klexikon:heute                 Wissen des Tages
 *   mixpi-klexikon:<encodeURIComponent(Titel)>
 *   mixpi-klexikon:<…>#<n>               (nur aufloesen) die n-te Folge, 0-basiert
 *
 * `heute` klein, und das kollidiert mit keinem Artikel: MediaWiki schreibt
 * das erste Zeichen eines Titels immer gross (gemessen: `titles=mond` kommt
 * als „Mond" zurueck). Der Titel ist kodiert, weil er Leerzeichen und Umlaute
 * traegt; ein `#` kann in einem MediaWiki-Titel gar nicht vorkommen, also
 * trennt es sicher.
 *
 * ══ DIE MESSUNGEN, DIE DIESEN CODE ERKLAEREN ═══════════════════════════════
 * Alle am 28.09.2026 gegen die echte Schnittstelle genommen (MediaWiki
 * 1.43.9 mit TextExtracts, PageImages, CirrusSearch); nachmessen mit
 * `node tools/klexikon-probe.mjs`.
 *
 *   1. NUR EIN VOLLTEXT JE ANFRAGE. Mit `titles=Mond|Deutschland|Elefanten`
 *      kommt genau EIN Text, und zwar nicht der des ersten Titels — die
 *      Schnittstelle warnt „exlimit … lowered to 1". Jeder Artikel kostet
 *      also eine eigene Anfrage, und `artikelHolen` fragt nie nach mehreren.
 *
 *   2. UEBERSCHRIFTEN STEHEN ALS ZEILEN IM TEXT (`== Wie sieht das Land
 *      aus? ==`, mit `exsectionformat=wiki`). „Deutschland" hat sechs, in
 *      einer Stichprobe von 150 Zufallsartikeln hatte die HAELFTE gar keine
 *      — ein Artikel ohne Ueberschrift ist also der Normalfall, nicht der
 *      Rand. Unterueberschriften (`===`) kamen in der Stichprobe nicht vor.
 *
 *   3. `redirects=1` IST PFLICHT: „Hund" ist eine Weiterleitung auf „Hunde".
 *      Ohne den Schalter kommt ein leerer Text zurueck, kein Fehler.
 *
 *   4. UEBERSICHTSSEITEN STEHEN IM ARTIKELNAMENSRAUM („Artikelübersicht
 *      Österreich", aber auch „Staaten der Erde" OHNE das Praefix). Sie
 *      tragen die Kategorie „Übersichtsseite", die echten Artikel ALLE die
 *      Kategorie „Klexikon-Artikel" (3529). Gefiltert wird deshalb nach der
 *      SORTE (Kategorie), und das Praefix ist nur der zweite Guertel.
 *
 *   5. WEGWEISER IM TEXT: „⇒ Hier gibt es eine Übersicht mit allen
 *      Klexikon-Artikeln zu Deutschland." steht als eigene Zeile im Auszug.
 *      Vorgelesen waere das ein Satz, der auf einen Link zeigt, den es im
 *      Ohr nicht gibt — er faellt heraus.
 *
 *   6. AUFZAEHLUNGEN KOMMEN OHNE ZEICHEN: „Albert Einstein für Physik, 1921"
 *      steht als eigene Zeile ohne Satzende. Zusammengeklebt hiesse das ein
 *      Satz ueber sechs Nobelpreise; deshalb bekommt jede Zeile ohne
 *      Satzzeichen einen Punkt, und Piper macht eine Pause.
 *
 *   7. VORSCHAUBILDER KOMMEN NICHT IMMER, und langsam. Das Klexikon holt sie
 *      bei Commons nach: fuer „Deutschland" nannte PageImages am Nachmittag
 *      ein Bild, am Abend nur noch den Dateinamen (Flag_of_Germany.svg) ohne
 *      Vorschau, und `Spezial:Dateipfad` antwortete 404 — die Anbindung
 *      wackelt je Datei. `bild` ist deshalb in jeder Folge freiwillig, der
 *      Vorschlag faellt auf das Klexikon-Zeichen zurueck, und die Suche
 *      liefert nur zwoelf Treffer (siehe TREFFER).
 *
 * ══ WAS DIESES PLUGIN NICHT TUT ════════════════════════════════════════════
 * Es spricht nicht selbst und legt keinen Ton ab. Es schaetzt auch KEINE
 * Dauer: eine falsche Zahl auf der Kachel ist schlimmer als keine, und wie
 * lange Piper fuer einen Abschnitt braucht, weiss erst der Kern.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const API = 'https://klexikon.zum.de/api.php'
const WIKI = 'https://klexikon.zum.de/wiki/'
/** Das Zeichen des Klexikons (160×160 PNG, gemessen 28.09.2026) — Kachel fuer „Wissen des Tages". */
const LOGO = 'https://klexikon.zum.de/images-instance/logo.png'
/**
 * DIE LIZENZ, wie der Seitenfuss des Klexikons sie am 28.09.2026 VERLINKT:
 * CC BY-SA 4.0. Die Systemnachricht `MediaWiki:Copyright` sagt am selben Tag
 * noch „3.0 Deutschland" — sie steht aber nicht mehr unter den Artikeln, und
 * die Hilfeseiten sagen nur „CC-BY-SA" ohne Fassung. Massgeblich ist, was am
 * Artikel steht. Fuer die Box aendert der Unterschied nichts: beide Fassungen
 * verlangen Namensnennung (der Schlusssatz der letzten Folge), und die
 * gesprochene Fassung verlaesst die Box nicht.
 */
const LIZENZ = 'CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/deed.de'
const KUENSTLER = 'Klexikon'
const HEUTE = 'heute'
const HEUTE_TITEL = 'Wissen des Tages'
const ALLE = 'Klexikon-Artikel'
const UEBERSICHT = 'Übersichtsseite'
const THEMEN_VORGABE = 'Tiere und Natur, Wissenschaft und Technik'
const PLATZHALTER = 'z. B. Mond, Elefanten, Vulkan'
const UA = 'MixPiBox-Klexikon/0.1 (Musikbox fuer Kinder)'

/** Der Satz, der an die LETZTE Folge kommt — die Namensnennung, die CC BY-SA verlangt, fuers Ohr. */
export const LIZENZ_SATZ = 'Das war ein Artikel aus dem Klexikon, dem freien Kinderlexikon.'
/** Wortlaut aus dem Auftrag: so steht es in der Verwaltung, wenn Piper fehlt. */
export const KEIN_PIPER = 'Die Box kann nicht vorlesen: Piper ist nicht eingerichtet (Verwaltung → Vorlesen).'

/** Piper `length_scale`: 1 normal, groesser langsamer. Die Spanne ist die des Kerns (sprechstrom.ts). */
const TEMPO_VORGABE = 1.1
const TEMPO_MIN = 0.7
const TEMPO_MAX = 2
/**
 * Laenger nimmt `sprechen()` nicht an einem Stueck (20000 Zeichen im Kern).
 * Der laengste echte Artikel hatte am 28.09.2026 17196 Byte QUELLTEXT
 * („Vereinigte Staaten von Amerika") — ein Abschnitt kommt nie in die Naehe.
 * Die Grenze steht trotzdem da: ein Artikel ohne Ueberschrift, der eines
 * Tages waechst, soll zwei Folgen werden, nicht eine Kachel, die nicht spielt.
 */
const TEIL_MAX = 19_000
/**
 * ZWOELF TREFFER, NICHT ZWANZIG — und das ist die Frist, nicht Geschmack.
 * Das Klexikon holt jedes Vorschaubild bei Commons nach, und das erste Mal
 * kostet es rund 0,23 s JE BILD auf SEINER Seite (gemessen 28.09.2026 mit
 * kalten Begriffen: 20 Treffer 4,7–5,0 s, 12 Treffer 2,7–3,3 s; derselbe
 * Begriff danach 0,2 s). 20 kalte Bilder plus ein WLAN mit Aussetzern
 * kommen der 8-s-Frist des Wirts zu nahe.
 */
const TREFFER = 12
/** Mehr als 20 Seiten zu 500 Titeln hat keine Kategorie — gegen ein `continue`, das nie endet. */
const SEITEN_DECKEL = 20
const ARTIKEL_MS = 15 * 60_000
const LISTE_MS = 7 * 24 * 60 * 60_000

/* ══ DIE UHR — eine Testnaht ═══════════════════════════════════════════════
 * „Wissen des Tages" haengt am Kalendertag, der Speicher an der Zeit. Beides
 * soll ein Zeuge verschieben koennen, ohne zu warten. Im Betrieb ruft
 * `uhrStellen` niemand. */
let uhr = () => Date.now()
/** TESTNAHT: die Uhr stellen (Funktion, die Millisekunden liefert); ohne Argument zurueck auf echt. */
export function uhrStellen(fn) {
  uhr = typeof fn === 'function' ? fn : () => Date.now()
}

/* ══ DER SPEICHER IM WORKER ═════════════════════════════════════════════════
 * Artikel 15 Minuten — lang genug, dass Vorschau, Aufnehmen und das erste
 * Abspielen dieselbe Anfrage teilen, kurz genug, dass eine Korrektur im
 * Klexikon noch am selben Tag ankommt. Die Titelliste fuer „heute" lebt
 * daneben (und im Datenordner, siehe `titelListe`). */
const speicher = new Map()
let liste = null

/** TESTNAHT: Artikel und Titelliste im Worker vergessen. Im Betrieb ruft das niemand. */
export function zwischenspeicherLeeren() {
  speicher.clear()
  liste = null
}
function gemerkt(schluessel) {
  const e = speicher.get(schluessel)
  return e && uhr() < e.bis ? e.wert : null
}
function merken(schluessel, wert) {
  speicher.set(schluessel, { wert, bis: uhr() + ARTIKEL_MS })
  return wert
}

/**
 * Eine Anfrage an die Schnittstelle — die EINE Stelle, die ins Netz geht.
 *
 * `text()` + `JSON.parse` statt `json()`: der Pruefstand sagt nur `text()` zu,
 * und die echte Antwort kann beides.
 */
async function fragen(kontext, gaben) {
  if (!kontext.holen) throw new Error('Das Recht `netz` fehlt.')
  const p = new URLSearchParams({ ...gaben, format: 'json', formatversion: '2' })
  const start = Date.now()
  const antwort = await kontext.holen(`${API}?${p}`, { headers: { accept: 'application/json', 'user-agent': UA } })
  if (!antwort.ok) throw new Error(`Das Klexikon antwortete mit HTTP ${antwort.status}`)
  const daten = JSON.parse(await antwort.text())
  // MEDIAWIKI MELDET FEHLER MIT HTTP 200 und einem `error`-Feld. Wer nur auf
  // den Status sieht, haelt einen kaputten Parameter fuer ein leeres Ergebnis.
  if (daten?.error) throw new Error(`Das Klexikon meldet: ${daten.error.info ?? daten.error.code}`)
  return { daten, ms: Date.now() - start }
}

/* ══ TITEL ══════════════════════════════════════════════════════════════════ */

/**
 * Den Titel aus dem Rest der Medienkennung holen.
 *
 * Kodiert ist die Regel, Klartext wird trotzdem genommen („Mond" von Hand
 * eingetragen). Zeichen, die MediaWiki in Titeln verbietet, werden ABGEWIESEN
 * statt weitergereicht: ein `|` im Titel waeren zwei Titel in einer Anfrage,
 * und dann kaeme nach Messung 1 fuer einen davon ein leerer Text.
 */
function titelAus(roh) {
  let t = String(roh ?? '')
  try {
    t = decodeURIComponent(t)
  } catch {
    // Ein einzelnes `%` ohne Ziffern dahinter: das war schon Klartext.
  }
  t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) throw new Error('kein Artikeltitel angegeben')
  if (/[#<>[\]|{}]/.test(t)) throw new Error(`„${t}" ist kein gültiger Artikeltitel.`)
  return t
}

/** Rest → Werk und Folgennummer. `#` kann kodiert nicht vorkommen (%23), also trennt das erste. */
function restZerlegen(rest) {
  const roh = String(rest ?? '').trim()
  const i = roh.indexOf('#')
  const werk = i >= 0 ? roh.slice(0, i) : roh
  const nr = i >= 0 ? Number.parseInt(roh.slice(i + 1), 10) : 0
  return { werk, nr: Number.isFinite(nr) && nr >= 0 ? nr : 0 }
}

/** Das Praefix — der ZWEITE Guertel, die Kategorie ist der erste (Messung 4). */
function istUebersicht(titel) {
  return /^Artikelübersicht\b/.test(String(titel ?? ''))
}

/** Vorschaubild ohne die utm-Anhaengsel von Commons — dieselbe Datei, eine stabile Adresse. */
function bildAus(roh) {
  if (typeof roh !== 'string' || !roh.startsWith('https://')) return undefined
  try {
    const u = new URL(roh)
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return undefined
  }
}

/* ══ VORLESEN: TEXT AUFBEREITEN ═════════════════════════════════════════════ */

/**
 * Reste von Wiki-Markup, die ein Vorleser als Zeichen spraeche.
 *
 * `explaintext` liefert heute sauberen Text — in 150 Zufallsartikeln stand
 * kein einziges `[[`, `{{` oder Tag (28.09.2026). Diese Zeilen sind also ein
 * Netz fuer den Tag, an dem eine Vorlage durchrutscht, keine gemessene
 * Reparatur. `<` allein bleibt stehen: „3 < 5" ist Text, kein Tag.
 */
function saeubern(roh) {
  return (
    String(roh ?? '')
      .replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')
      .replace(/\{\{[^{}]*\}\}/g, ' ')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
      .replace(/\[https?:\/\/\S+\s*([^\]]*)\]/g, '$1')
      .replace(/'{2,}/g, '')
      .replace(/^[*#:;]+\s*/, '')
      .replace(/={2,}/g, ' ')
      .replace(/\s+/g, ' ')
      // Wo ein Tag vor dem Satzzeichen stand, bliebe „fett ." stehen.
      .replace(/ ([.,;:!?])/g, '$1')
      .trim()
  )
}

/** Endet die Zeile schon mit einem Satzzeichen (auch vor schliessendem Anfuehrungszeichen)? */
const SATZENDE = /[.!?…:;,][\s"'“”»«‘’)]*$/

/** „Titel" → „Titel." — aber „Wie sieht das Land aus?" bleibt ohne zweiten Punkt. */
function mitPunkt(satz) {
  return SATZENDE.test(satz) ? satz : `${satz}.`
}

/**
 * Zeilen eines Abschnitts → ein vorlesbarer Absatz (Messungen 5 und 6).
 */
function absatzAus(zeilen) {
  const saetze = []
  for (const roh of zeilen) {
    if (roh.trim().startsWith('⇒')) continue
    const z = saeubern(roh)
    if (z) saetze.push(mitPunkt(z))
  }
  return saetze.join(' ')
}

/**
 * Abkuerzungen, die Piper sonst buchstabiert oder verschluckt.
 *
 * DAS KLEXIKON BENUTZT KAUM WELCHE — es schreibt fuer Kinder. In 150
 * Zufallsartikeln (28.09.2026) standen genau: `km/h` (2×), `ca.`, `&`, `%`.
 * Die Liste ist trotzdem laenger, weil jeder Autor sie anders haelt.
 *
 * `(?<![\p{L}\d])` statt `\b`: `\b` kennt nur ASCII, und vor einem Umlaut
 * saehe es eine Wortgrenze, wo keine ist.
 *
 * ZAHLEN BLEIBEN STEHEN. Piper liest „1.895" und „2,6" richtig; wer sie hier
 * ausschreibt, rechnet mit einer zweiten Grammatik gegen die des Sprechers.
 */
const VOR = '(?<![\\p{L}\\d])'
const NACH = '(?![\\p{L}\\d])'
const ABKUERZUNGEN = [
  [`${VOR}([zZ])\\.\\s?B\\.`, (_, z) => (z === 'Z' ? 'Zum Beispiel' : 'zum Beispiel')],
  [`${VOR}([uU])\\.\\s?a\\.`, (_, u) => (u === 'U' ? 'Unter anderem' : 'unter anderem')],
  [`${VOR}([dD])\\.\\s?h\\.`, (_, d) => (d === 'D' ? 'Das heißt' : 'das heißt')],
  [`${VOR}bzw\\.`, 'beziehungsweise'],
  [`${VOR}ca\\.`, 'circa'],
  [`${VOR}evtl\\.`, 'eventuell'],
  [`${VOR}ggf\\.`, 'gegebenenfalls'],
  [`${VOR}bspw\\.`, 'beispielsweise'],
  [`${VOR}inkl\\.`, 'inklusive'],
  [`${VOR}Nr\\.(?=\\s?\\d)`, 'Nummer'],
  [`${VOR}Mio\\.`, 'Millionen'],
  [`${VOR}Mrd\\.`, 'Milliarden'],
  [`${VOR}Jh\\.`, 'Jahrhundert'],
  // DIESE DREI ENDEN OFT EINEN SATZ: folgt ein Grossbuchstabe oder das Ende,
  // war der Punkt zugleich das Satzende und muss bleiben — sonst liest Piper
  // „… und so weiter Die Katzen …" in einem Atemzug.
  [`${VOR}usw\\.(?=\\s+[A-ZÄÖÜ]|\\s*$)`, 'und so weiter.'],
  [`${VOR}usw\\.`, 'und so weiter'],
  [`${VOR}etc\\.(?=\\s+[A-ZÄÖÜ]|\\s*$)`, 'et cetera.'],
  [`${VOR}etc\\.`, 'et cetera'],
  [`${VOR}v\\.\\s?Chr\\.(?=\\s+[A-ZÄÖÜ]|\\s*$)`, 'vor Christus.'],
  [`${VOR}v\\.\\s?Chr\\.`, 'vor Christus'],
  [`${VOR}n\\.\\s?Chr\\.(?=\\s+[A-ZÄÖÜ]|\\s*$)`, 'nach Christus.'],
  [`${VOR}n\\.\\s?Chr\\.`, 'nach Christus'],
  [`\\s?°\\s?C${NACH}`, ' Grad Celsius'],
  ['\\s?°', ' Grad'],
  [`${VOR}km/h${NACH}`, 'Kilometer pro Stunde'],
  [`${VOR}km²`, 'Quadratkilometer'],
  [`${VOR}m²`, 'Quadratmeter'],
  ['(\\d)\\s?%', '$1 Prozent'],
  ['\\s&\\s', ' und '],
].map(([muster, ersatz]) => [new RegExp(muster, 'gu'), ersatz])

function vorlesbar(text) {
  let t = String(text ?? '')
  for (const [muster, ersatz] of ABKUERZUNGEN) t = t.replace(muster, ersatz)
  return t.replace(/\s+/g, ' ').trim()
}

/**
 * Den Auszug in Abschnitte teilen: vor der ersten Ueberschrift die
 * Einleitung, danach je Ueberschrift einer. Leere fallen weg — eine
 * Ueberschrift ohne Text ist keine Folge.
 */
function abschnitteAus(auszug) {
  const abschnitte = [{ ueberschrift: null, zeilen: [] }]
  for (const zeile of String(auszug ?? '').split('\n')) {
    const u = /^\s*={2,}\s*(.+?)\s*={2,}\s*$/.exec(zeile)
    if (u) abschnitte.push({ ueberschrift: saeubern(u[1]), zeilen: [] })
    else abschnitte.at(-1).zeilen.push(zeile)
  }
  return abschnitte
    .map((a) => ({ ueberschrift: a.ueberschrift || null, text: absatzAus(a.zeilen) }))
    .filter((a) => a.text)
}

/** An Satzenden in Stuecke bis `max` Zeichen packen; ein Satz ueber `max` wird am Leerzeichen geteilt. */
function teilen(text, max) {
  if (text.length <= max) return [text]
  const saetze = text.split(/(?<=[.!?…])\s+(?=[A-ZÄÖÜ0-9„"»(])/u)
  const stuecke = []
  let jetzt = ''
  for (let s of saetze) {
    while (s.length > max) {
      const schnitt = s.lastIndexOf(' ', max) > 0 ? s.lastIndexOf(' ', max) : max
      if (jetzt) stuecke.push(jetzt)
      jetzt = ''
      stuecke.push(s.slice(0, schnitt).trim())
      s = s.slice(schnitt).trim()
    }
    if (jetzt && jetzt.length + 1 + s.length > max) {
      stuecke.push(jetzt)
      jetzt = s
    } else {
      jetzt = jetzt ? `${jetzt} ${s}` : s
    }
  }
  if (jetzt) stuecke.push(jetzt)
  return stuecke
}

/**
 * Ein geholter Artikel → die Teile, aus denen Folgen werden: Kennung, Name,
 * fertiger Vorlesetext. OHNE `sprechen` — die Vorschau der Verwaltung zeigt
 * genau diese Liste, und sie soll nicht auf Piper warten.
 *
 * ══ DIE KENNUNG ════════════════════════════════════════════════════════════
 * Einleitung: der Artikeltitel. Abschnitt: `<Titel>#<Ueberschrift>`. NICHT
 * die Abschnittsnummer: schiebt das Klexikon einen Abschnitt ein, rutschten
 * alle Nummern dahinter, und die gemerkte Stelle (E90 haengt an der
 * FOLGENKENNUNG) zeigte still auf ein anderes Kapitel. Ein `#` kann in einem
 * Titel nicht stehen, also ist die Einleitung nie mit einem Abschnitt zu
 * verwechseln. Doppelte Ueberschriften bekommen „ (2)" — `inhaltPruefen`
 * wirft die zweite gleiche Kennung sonst still weg.
 *
 * Der TITEL in der Kennung ist der AUFGELOESTE („Hunde", auch wenn „Hund"
 * gefragt war) — so tragen beide Wege dieselben Kennungen.
 *
 * ══ DER NAME TRAEGT DEN ARTIKEL MIT ════════════════════════════════════════
 * „Deutschland: Wie sieht das Land aus?", nicht nur die Ueberschrift. Die
 * gemerkte Stelle sucht zuerst die Kennung, faellt dann aber auf den NAMEN
 * zurueck (`folgeWiederfinden` in weiterhoeren.ts). Bei „heute" wechselt der
 * Artikel taeglich, und „Wie sieht das Land aus?" steht in vielen
 * Laenderartikeln: gestern bei „Deutschland" angehalten, heute „Österreich"
 * mit derselben Ueberschrift — und die Box setzte mitten im Abschnitt an der
 * alten Sekunde fort (Hauptsitzung, 28.09.2026). GESPROCHEN wird weiter nur
 * „<Ueberschrift>. <Text>": der Titel steht schon in der ersten Folge.
 */
function teileBauen(artikel) {
  const teile = []
  const gesehen = new Map()
  for (const a of artikel.abschnitte) {
    let kennung = a.ueberschrift ? `${artikel.titel}#${a.ueberschrift}` : artikel.titel
    const n = (gesehen.get(kennung) ?? 0) + 1
    gesehen.set(kennung, n)
    const doppelt = n > 1 ? ` (${n})` : ''
    kennung = `${kennung}${doppelt}`
    const name = a.ueberschrift ? `${artikel.titel}: ${a.ueberschrift}${doppelt}` : artikel.titel
    const ansage = a.ueberschrift ?? artikel.titel
    teile.push({ kennung, name, text: `${mitPunkt(ansage)} ${a.text}` })
  }
  // DIE NAMENSNENNUNG an die LETZTE Folge, und nur dort: wer nach dem ersten
  // Abschnitt aufhoert, hat den Artikel nicht gehoert; wer bis zum Ende
  // bleibt, hoert, woher er kam.
  if (teile.length) teile.at(-1).text = `${teile.at(-1).text} ${LIZENZ_SATZ}`

  const aus = []
  for (const t of teile) {
    const stuecke = teilen(vorlesbar(t.text), TEIL_MAX)
    stuecke.forEach((text, i) => {
      // Das ERSTE Stueck behaelt Kennung und Namen — schrumpft der Abschnitt
      // wieder, bleibt die gemerkte Stelle gueltig.
      const zusatz = i === 0 ? '' : ` (Teil ${i + 1})`
      aus.push({ kennung: `${t.kennung}${zusatz}`, name: `${t.name}${zusatz}`, text })
    })
  }
  return aus
}

/** Das Tempo aus den Einstellungen, auf die Spanne des Kerns gebogen. */
function tempoAus(einstellungen) {
  const n = Number(einstellungen?.tempo)
  if (einstellungen?.tempo === '' || einstellungen?.tempo == null || !Number.isFinite(n)) return TEMPO_VORGABE
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, n))
}

async function folgenBauen(artikel, kontext) {
  if (!kontext.sprechen) throw new Error(KEIN_PIPER)
  const tempo = tempoAus(kontext.einstellungen)
  const folgen = []
  // NACHEINANDER, nicht parallel: `sprechen()` schreibt je Text eine Datei,
  // und die Reihenfolge der Liste ist Teil der Antwort.
  for (const t of teileBauen(artikel)) {
    let quelle
    try {
      quelle = await kontext.sprechen(t.text, { tempo })
    } catch (f) {
      throw new Error(`Abschnitt „${t.name}": ${f.message}`)
    }
    const folge = { kennung: t.kennung, name: t.name, quelle }
    if (artikel.bild) folge.bild = artikel.bild
    folgen.push(folge)
  }
  return folgen
}

/* ══ ARTIKEL HOLEN ══════════════════════════════════════════════════════════ */

/** Ein Fehler „diesen Artikel gibt es nicht (mehr)" — der einzige, bei dem „heute" weitergeht. */
function fehlt(text) {
  const f = new Error(text)
  f.fehlt = true
  return f
}

async function artikelHolen(titel, kontext) {
  const da = gemerkt(`artikel:${titel}`)
  if (da) return da
  const { daten } = await fragen(kontext, {
    action: 'query',
    prop: 'extracts|pageimages',
    explaintext: '1',
    exsectionformat: 'wiki',
    piprop: 'thumbnail',
    pithumbsize: '400',
    redirects: '1',
    titles: titel,
  })
  const seite = daten?.query?.pages?.[0]
  if (!seite || seite.missing || seite.invalid) throw fehlt(`Den Artikel „${titel}" gibt es im Klexikon nicht.`)
  const echt = String(seite.title ?? titel)
  if (istUebersicht(echt)) throw fehlt(`„${echt}" ist eine Übersichtsseite, kein Artikel.`)
  const auszug = String(seite.extract ?? '')
  return merken(`artikel:${titel}`, {
    titel: echt,
    abschnitte: abschnitteAus(auszug),
    bild: bildAus(seite.thumbnail?.source),
  })
}

/* ══ WISSEN DES TAGES ═══════════════════════════════════════════════════════ */

/** Die Themen aus der Einstellung — Kategorien des Klexikons, mit Komma getrennt; leer heisst alle. */
function themenAus(einstellungen) {
  const roh = einstellungen?.themen
  const text = roh === undefined || roh === null ? THEMEN_VORGABE : String(roh)
  const themen = text
    .split(/[,;\n]/)
    .map((t) => t.replace(/^\s*Kategorie:\s*/i, '').trim())
    .filter(Boolean)
  return themen.length ? [...new Set(themen)] : [ALLE]
}

async function kategorieMitglieder(kontext, kategorie) {
  const titel = []
  let weiter = null
  for (let seite = 0; seite < SEITEN_DECKEL; seite++) {
    const gaben = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Kategorie:${kategorie}`,
      cmnamespace: '0',
      cmlimit: 'max',
      cmprop: 'title',
    }
    if (weiter) gaben.cmcontinue = weiter
    const { daten } = await fragen(kontext, gaben)
    for (const m of daten?.query?.categorymembers ?? []) if (m?.ns === 0 && m.title) titel.push(String(m.title))
    // 500 JE ANFRAGE fuer Anonyme (gemessen): „Klexikon-Artikel" sind acht.
    weiter = daten?.continue?.cmcontinue
    if (!weiter) break
  }
  return titel
}

/**
 * Die Vereinigung der Themen, Uebersichtsseiten heraus, SORTIERT.
 *
 * Sortiert nach Codepunkt, nicht mit `localeCompare`: die Liste wird nie
 * gezeigt, sie ist nur die Wuerfelunterlage fuer den Tag — und die soll auf
 * jeder Maschine gleich liegen, unabhaengig davon, welche ICU-Fassung Node
 * mitbringt.
 */
async function titelHolen(themen, kontext) {
  const [listen, weg] = await Promise.all([
    Promise.all(themen.map((k) => kategorieMitglieder(kontext, k))),
    kategorieMitglieder(kontext, UEBERSICHT),
  ])
  const raus = new Set(weg)
  const alle = new Set()
  listen.forEach((l, i) => {
    if (!l.length) kontext.protokoll(`Thema „${themen[i]}" kennt das Klexikon nicht (keine Artikel in der Kategorie).`)
    for (const t of l) if (!raus.has(t) && !istUebersicht(t)) alle.add(t)
  })
  return [...alle].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Die Titelliste fuer „heute" — Worker, dann Datenordner, dann Netz.
 *
 * SO KOSTET „heute" IM NORMALFALL EINE ANFRAGE (den Artikel): die Liste
 * haelt sieben Tage, im Worker und als Datei. Die Datei ueberlebt den
 * Neustart, den jede Einstellungsaenderung ausloest; ohne sie holte jede
 * Aenderung am Tempo acht Kategorie-Seiten neu.
 *
 * EINE ALTE LISTE IST BESSER ALS KEIN ARTIKEL: klemmt das Netz beim
 * Nachholen, bleibt die abgelaufene im Dienst, und das Journal sagt es.
 */
async function titelListe(kontext) {
  const themen = themenAus(kontext.einstellungen)
  const schluessel = [...themen].sort().join('|')
  const jetzt = uhr()
  if (liste && liste.schluessel === schluessel && jetzt - liste.geholtMs < LISTE_MS) return liste

  const datei = kontext.datenOrdner ? join(kontext.datenOrdner, 'heute-titel.json') : null
  let alt = null
  if (datei) {
    try {
      const roh = JSON.parse(await readFile(datei, 'utf8'))
      if (roh?.schluessel === schluessel && Array.isArray(roh.titel) && Number.isFinite(roh.geholtMs)) alt = roh
    } catch {
      // Keine Datei oder eine kaputte: dann eben aus dem Netz.
    }
  }
  if (alt && jetzt - alt.geholtMs < LISTE_MS) {
    liste = alt
    return liste
  }

  let frisch
  try {
    frisch = { fassung: 1, schluessel, themen, geholtMs: jetzt, titel: await titelHolen(themen, kontext) }
  } catch (f) {
    if (!alt) throw f
    kontext.protokoll(
      `Titelliste nicht erneuert (${f.message}) — die vom ${new Date(alt.geholtMs).toISOString()} bleibt.`,
    )
    return alt
  }
  if (datei) {
    try {
      await mkdir(kontext.datenOrdner, { recursive: true })
      await writeFile(`${datei}.neu`, JSON.stringify(frisch))
      await rename(`${datei}.neu`, datei)
    } catch (f) {
      kontext.protokoll(`Titelliste nicht abgelegt: ${f.message}`)
    }
  }
  liste = frisch
  return liste
}

function ggT(a, b) {
  return b === 0 ? a : ggT(b, a % b)
}

/**
 * Welcher Eintrag der Liste heute dran ist.
 *
 * DER TAG IST DER KALENDERTAG DER BOX (Ortszeit), gezaehlt als Tage seit
 * 1970 — daher gleich um 00:05 und um 23:55, und die Sommerzeit verschiebt
 * nichts.
 *
 * KEIN ZUFALLS-HASH, SONDERN EIN SCHRITT: Index = Tag × s mod n, mit s
 * teilerfremd zu n (nahe n × 0,618). Das ist genauso fest je Tag wie ein
 * Hash, aber es sichert zwei Dinge zu, die ein Hash nur meistens hielte: zwei
 * aufeinanderfolgende Tage haben NIE denselben Artikel, und bevor sich einer
 * wiederholt, kommen alle n einmal dran. Ein Hash modulo 1164 trifft im
 * Schnitt alle drei Jahre zweimal hintereinander denselben — und dann ist der
 * Zeuge „anders am naechsten Tag" an einem Datum rot, das keiner nachstellt.
 */
function tagesIndex(ms, anzahl) {
  if (anzahl <= 1) return 0
  const d = new Date(ms)
  const tag = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
  let schritt = Math.max(1, Math.floor(anzahl * 0.618))
  while (ggT(schritt, anzahl) !== 1) schritt++
  return (((tag * schritt) % anzahl) + anzahl) % anzahl
}

async function heuteArtikel(kontext) {
  const { titel, themen } = await titelListe(kontext)
  if (!titel.length) throw new Error(`In den Themen „${themen.join(', ')}" findet das Klexikon keinen Artikel.`)
  const start = tagesIndex(uhr(), titel.length)
  // FEHLT DER ARTIKEL DES TAGES (die Liste ist bis zu sieben Tage alt, und
  // das Klexikon loescht auch mal), geht es FEST zum naechsten — derselbe Tag
  // landet auf jeder Box beim selben. Nur bei „fehlt": ein Netzfehler beim
  // ersten ist auch einer beim zweiten, und drei Versuche reissen die Frist.
  let letzter = null
  for (let i = 0; i < Math.min(3, titel.length); i++) {
    try {
      const a = await artikelHolen(titel[(start + i) % titel.length], kontext)
      if (a.abschnitte.length) return a
      letzter = fehlt(`„${a.titel}" hat keinen Text.`)
    } catch (f) {
      if (!f.fehlt) throw f
      letzter = f
    }
  }
  throw letzter
}

/* ══ SUCHE UND VORSCHLAG ════════════════════════════════════════════════════ */

/** Die Fundstelle als Satz: ohne `<span class="searchmatch">`, ohne Entitaeten. */
function snippetText(roh) {
  const t = String(roh ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? `…${t}…` : ''
}

/**
 * Der data.json-Eintrag — die EINE Stelle dieser Form.
 *
 * `type: 'plugin'` und in `id` die VOLLE Medienkennung (E87): daraus baut
 * `medienSchluessel()` `plugin:mixpi-klexikon:<rest>`, und der generische
 * Zweig von `/api/werke/<s>/inhalt` ruft `inhalt(rest)`. Jeder andere `type`
 * ist eine Kachel, die nicht spielt (siehe mixpi-archive).
 */
function vorschlagAus(rest, titel, bild) {
  return {
    type: 'plugin',
    category: 'other',
    id: `mixpi-klexikon:${rest}`,
    title: titel,
    artist: KUENSTLER,
    cover: bild || LOGO,
  }
}

function werkAus(titel, hinweis, bild) {
  const rest = encodeURIComponent(titel)
  return { kennung: rest, titel, hinweis, bild: bild ?? null, vorschlag: vorschlagAus(rest, titel, bild) }
}

function heuteWerk(kontext) {
  const themen = themenAus(kontext.einstellungen)
  const woher = themen.length === 1 && themen[0] === ALLE ? 'aus dem ganzen Klexikon' : `aus: ${themen.join(', ')}`
  return {
    kennung: HEUTE,
    titel: HEUTE_TITEL,
    hinweis: `Jeden Tag ein anderer Artikel ${woher}.`,
    bild: LOGO,
    vorschlag: vorschlagAus(HEUTE, HEUTE_TITEL, LOGO),
  }
}

/**
 * Suchen — Treffer, Vorschaubild und Artikel-Sorte in EINER Anfrage.
 *
 * `list=search` liefert Reihenfolge, Fundstelle und Gesamtzahl,
 * `generator=search` dieselben Seiten mit Bild und Kategorie. Beides geht in
 * eine Anfrage (gemessen 28.09.2026). `clcategories` fragt nur nach
 * „Klexikon-Artikel": wer die NICHT traegt, ist Uebersicht, Hilfe oder
 * Hauptseite (Messung 4) und faellt heraus.
 */
async function suche(begriff, kontext, anzahl = TREFFER) {
  const n = String(anzahl)
  const { daten } = await fragen(kontext, {
    action: 'query',
    list: 'search',
    srsearch: begriff,
    srnamespace: '0',
    srlimit: n,
    srprop: 'snippet',
    generator: 'search',
    gsrsearch: begriff,
    gsrnamespace: '0',
    gsrlimit: n,
    prop: 'pageimages|categories',
    piprop: 'thumbnail',
    pithumbsize: '400',
    pilimit: 'max',
    clcategories: `Kategorie:${ALLE}`,
    cllimit: 'max',
  })
  const seiten = new Map((daten?.query?.pages ?? []).map((s) => [s.title, s]))
  const werke = []
  for (const t of daten?.query?.search ?? []) {
    const s = seiten.get(t.title)
    const istArtikel = (s?.categories ?? []).some((k) => k?.title === `Kategorie:${ALLE}`)
    if (!istArtikel || istUebersicht(t.title)) continue
    werke.push(werkAus(String(t.title), snippetText(t.snippet), bildAus(s?.thumbnail?.source)))
  }
  return { gesamt: Number(daten?.query?.searchinfo?.totalhits) || werke.length, werke }
}

/* ══ DIE FLAECHEN ═══════════════════════════════════════════════════════════ */

async function inhaltFuer(werk, kontext) {
  // ZUERST: ohne Stimme gibt es nichts zu liefern, und das soll die Meldung
  // sein — nicht ein Netzfehler, der zufaellig vorher kam.
  if (!kontext.sprechen) throw new Error(KEIN_PIPER)
  const heute = werk === HEUTE
  const artikel = heute ? await heuteArtikel(kontext) : await artikelHolen(titelAus(werk), kontext)
  return {
    titel: heute ? HEUTE_TITEL : artikel.titel,
    kuenstler: KUENSTLER,
    folgen: await folgenBauen(artikel, kontext),
    vollstaendig: true,
  }
}

export default {
  /**
   * Ein Werk → seine Folgen, je Abschnitt eine (E78).
   *
   * ZWEIMAL GERUFEN, ZEICHEN FUER ZEICHEN DIESELBE LISTE: der Kern loest
   * spaeter eine Warteschlangennummer gegen eine NEU geholte Liste auf. Die
   * Kennungen haengen am Text des Artikels, die Quellen an Text und Tempo
   * (der Kern benennt sie nach einem Hash davon) — beides ist fest, solange
   * der Artikel sich nicht aendert. Und „heute" haengt nur am Kalendertag.
   */
  async inhalt(rest, kontext) {
    return inhaltFuer(restZerlegen(rest).werk, kontext)
  },

  /** `<titel>` → erste Folge, `<titel>#<n>` → die n-te (0-basiert, wie die Liste zaehlt). */
  async aufloesen(rest, kontext) {
    const { werk, nr } = restZerlegen(rest)
    const inhalt = await inhaltFuer(werk, kontext)
    const f = inhalt.folgen[nr]
    if (!f) throw new Error(`„${inhalt.titel}" hat keine Folge ${nr + 1} (es sind ${inhalt.folgen.length}).`)
    const titel = { name: f.name, kuenstler: KUENSTLER }
    if (f.bild) titel.bild = f.bild
    return { titel, quelle: f.quelle }
  },

  async suchen(begriff, kontext) {
    const wort = String(begriff ?? '').trim()
    if (!wort) return []
    const { werke } = await suche(wort, kontext)
    return werke.map((w) => ({ name: w.titel, kuenstler: KUENSTLER }))
  },

  /** Ein Satz fuer die Steckleiste: erreichbar? und kann die Box vorlesen? */
  async befinden(kontext) {
    if (!kontext.holen) return { ok: false, text: 'Das Recht `netz` fehlt — ohne es gibt es nichts zu fragen.' }
    const stimme = kontext.sprechen
      ? 'vorlesen bereit'
      : 'Piper fehlt — die Box kann nicht vorlesen (Verwaltung → Vorlesen)'
    try {
      const { daten, ms } = await fragen(kontext, { action: 'query', meta: 'siteinfo', siprop: 'general' })
      if (!daten?.query?.general)
        return { ok: false, text: `Das Klexikon antwortet, aber nicht in der erwarteten Form; ${stimme}.` }
      return { ok: Boolean(kontext.sprechen), text: `Klexikon erreichbar (${ms} ms), ${stimme}.` }
    } catch (f) {
      return { ok: false, text: `Klexikon nicht erreichbar: ${f.message}; ${stimme}.` }
    }
  },

  /** Der Knopf „pruefen": je eine Suche, ein Artikel, eine Kategorie — wer ist langsam? */
  async aktion(kennung, kontext) {
    if (kennung !== 'pruefen') return { ok: false, text: `Unbekannte Aktion "${kennung}".` }
    if (!kontext.holen) return { ok: false, text: 'Das Recht `netz` fehlt.' }
    const proben = [
      ['Suche', { action: 'query', list: 'search', srsearch: 'Mond', srnamespace: '0', srlimit: '1' }],
      ['Artikel', { action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: 'Mond' }],
      ['Kategorie', { action: 'query', list: 'categorymembers', cmtitle: `Kategorie:${ALLE}`, cmlimit: '1' }],
    ]
    const zeiten = []
    for (const [name, gaben] of proben) {
      try {
        const { ms } = await fragen(kontext, gaben)
        zeiten.push(`${name} ${ms} ms`)
      } catch (f) {
        return { ok: false, text: `${name} scheiterte: ${f.message}` }
      }
    }
    const stimme = kontext.sprechen ? 'Vorlesen bereit.' : KEIN_PIPER
    return { ok: Boolean(kontext.sprechen), text: `${zeiten.join(', ')}. ${stimme}` }
  },

  /**
   * Die freie Flaeche unter /api/plugins/mixpi-klexikon/http/… (E77). Nur GET.
   *
   *   angebot[?q=]      was die Medien-Seite anbietet: ohne q „Wissen des
   *                     Tages", mit q die Treffer — je mit fertigem Vorschlag
   *   suche?q=          dieselben Treffer ohne Rahmen (plugin-kette-probe)
   *   artikel/<titel>   Vorschau: welche Folgen, wie lang (auch `artikel/heute`)
   */
  async http(anfrage, kontext) {
    if (anfrage.methode !== 'GET') return { status: 405, inhalt: { fehler: 'nur GET' } }
    const pfad = String(anfrage.pfad ?? '').replace(/^\/+/, '')
    const q = String(anfrage.abfrage?.q ?? '').trim()
    try {
      if (pfad === 'angebot') {
        // OHNE BEGRIFF KEIN NETZ: „Wissen des Tages" steht immer da, auch
        // wenn das Klexikon gerade nicht antwortet.
        if (!q) return { inhalt: { suche: true, platzhalter: PLATZHALTER, gesamt: 1, werke: [heuteWerk(kontext)] } }
        const { gesamt, werke } = await suche(q, kontext)
        return { inhalt: { suche: true, platzhalter: PLATZHALTER, gesamt, werke } }
      }

      if (pfad === 'suche') {
        if (!q) return { inhalt: { gesamt: 0, werke: [] } }
        return { inhalt: await suche(q, kontext) }
      }

      if (pfad.startsWith('artikel/')) {
        const roh = pfad.slice('artikel/'.length)
        const artikel = roh === HEUTE ? await heuteArtikel(kontext) : await artikelHolen(titelAus(roh), kontext)
        const teile = teileBauen(artikel)
        return {
          inhalt: {
            kennung: encodeURIComponent(artikel.titel),
            titel: artikel.titel,
            bild: artikel.bild ?? null,
            adresse: `${WIKI}${encodeURIComponent(artikel.titel.replace(/ /g, '_'))}`,
            lizenz: LIZENZ,
            zeichen: teile.reduce((s, t) => s + t.text.length, 0),
            abschnitte: teile.map((t, nr) => ({ nr, kennung: t.kennung, name: t.name, zeichen: t.text.length })),
            vorlesen: Boolean(kontext.sprechen),
          },
        }
      }

      return { status: 404, inhalt: { fehler: `Unbekannter Pfad "${pfad}"` } }
    } catch (f) {
      return { status: f.fehlt ? 404 : 502, inhalt: { fehler: f.message } }
    }
  },
}
