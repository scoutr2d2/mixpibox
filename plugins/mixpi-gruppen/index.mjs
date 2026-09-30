/**
 * MIXPI-GRUPPEN — Interpretennamen, die zusammengehoeren, von Jev vorschlagen lassen.
 *
 * WOZU (Betreiber, 26.09.2026): „die meta gruppen besser sortieren, bspw
 * sendung maus ueber verschiedene dienste". Auf der Box (.62, gemessen am
 * 26.09.2026: 227 Eintraege, 44 Namen) steht „Die Maus" neben „Die Maus, Eva
 * mit Gitarre, Der Elefant", „Gabby's Dollhouse" neben „Gabby’s Dollhouse
 * Deutschland", und unter „EUROPA Hörspiele & Kinderlieder" liegt Hello Kitty,
 * das an anderer Stelle „Hello Kitty Hörspiele" heisst. Die Ablage, in der
 * solche Namen EINE Kennung bekommen, gibt es seit E64b
 * (src/backend-api/src/interpretenkennung.ts) — gefuellt hat sie bisher niemand.
 *
 * WAS ES TUT, UND WAS NICHT:
 *   * Es SCHLAEGT VOR. Zusammenlegen darf nur ein Mensch (Stufe `hand`,
 *     llmwiki `interpretenkennung-gehoert-der-box`): zwei Interpreten unter
 *     einer Kennung sind ein stiller Schaden, eine Kachel zu viel ist keiner.
 *     Die Seite „Gruppen" in der Verwaltung zeigt die Vorschlaege, und erst
 *     ihr Knopf ruft den Kern.
 *   * Es laeuft NUR AUF WUNSCH. Kein Takt, kein Hintergrund-Wecker.
 *   * Es sendet Namen und bis zu fuenf Titel je Name an OpenRouter bzw.
 *     TypeSafe — keine Profile, keine Hoerzeiten, keine Adressen.
 *
 * WARUM JEV UND KEIN CHAT-MODELL: Jev (TypeSafe, ueber OpenRouter) antwortet
 * nicht mit Text, sondern waehlt aus Antworten, die WIR vorgeben, und nennt
 * zu jeder eine Wahrscheinlichkeit. Das ist genau die Frage „dieselbe /
 * Mitwirkung / verschieden?" — ohne Prompt-und-Zerlegen dazwischen.
 * Schnittstelle nachgelesen am 26.09.2026 (openrouter.ai/docs/guides/community/jev,
 * Blog „What Is Jev?"): POST https://openrouter.ai/api/alpha/decisions mit
 * `{model, state, questions}`; TypeSafe selbst: POST
 * https://api.typesafe.ai/v1/systemone, gleicher Rumpf, Modell ohne Praefix.
 * Der Pfad heisst `alpha` — er kann sich aendern. `verbindung` misst ihn.
 *
 * DIE FRIST: jeder Ruf in ein Plugin hat 8 s (plugin-wirt.ts, FRIST_MS).
 * Hundert Fragen passen da nicht hinein. `durchlauf` bereitet deshalb nur vor,
 * gibt sofort zurueck und fragt danach im Worker weiter; den Stand liest die
 * Seite ueber `GET stand`.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { threadId } from 'node:worker_threads'

export const ANBIETER = {
  openrouter: { adresse: 'https://openrouter.ai/api/alpha/decisions', modell: 'typesafe/jev-latest' },
  typesafe: { adresse: 'https://api.typesafe.ai/v1/systemone', modell: 'jev-latest' },
}

/** Gleichzeitig offene Fragen. Mehr bringt wenig und macht Fehlerketten laenger. */
const PARALLEL = 3
/** So viele Fehler hintereinander, dann wird abgebrochen statt weiter Geld zu verbrennen. */
const FEHLER_KETTE = 5
/** Titel je Name, die Jev als Anhalt bekommt. */
const TITEL_JE_NAME = 5

/*
 * Woerter, die in Kindermedien ueberall stehen und deshalb nichts ueber
 * Zusammengehoerigkeit sagen. Ohne sie waeren „Die Schlümpfe" und „Die drei
 * !!!" ein Kandidatenpaar, nur weil beide „die" enthalten. Die Liste ist
 * KEIN Urteil, nur ein Vorfilter — was durchrutscht, entscheidet Jev.
 */
const FUELLWORTE = new Set(
  (
    'der die das den dem des ein eine einer und oder mit von vom zum zur im in am an auf aus fuer für ' +
    'the and of feat ' +
    'folge folgen teil staffel alle hörspiel hörspiele hoerspiel hoerspiele hörbuch hörbücher hoerbuch ' +
    'kinderlieder lieder musik music original deutschland kinder kleine kleiner kleinen'
  ).split(' '),
)

/* ── Namen und Woerter ─────────────────────────────────────────────────── */

/** Ein Name fuer den Vergleich: gleiche Zeichen fuer gleiche Dinge, Klein, ein Leerzeichen. */
export function normal(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Die tragenden Woerter eines Textes — ohne Fuellworte, ohne Kuerzel unter drei Zeichen. */
export function woerter(text) {
  return new Set(
    normal(text)
      .replace(/'/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !FUELLWORTE.has(w)),
  )
}

/**
 * Welcher Dienst hinter einem Eintrag steht — dieselbe Einteilung wie
 * `dienstVon()` im Kern (src/backend-api/src/medien.ts), Zweig fuer Zweig.
 *
 * EINE VERFEINERUNG, MIT ABSICHT: wo der Kern „plugin" sagt, steht hier die
 * Kennung des Plugins (`mixpi-archive`), gelesen wie `pluginKennungAus()` es
 * tut. Jev und die Seite „Gruppen" sollen sehen, WELCHES Plugin; der Kern
 * sagt das erst mit dieser zweiten Funktion. Ohne gueltige Kennung bleibt
 * es beim Sammelwort.
 *
 * KLEINSCHREIBUNG UND `anderes` WIE IM KERN (AUDIT-2026-09-28 §1b Rang 5):
 * vorher lief `type: "Spotify"` hier als „Spotify", im Kern als spotify, und
 * ein unbekannter Typ kam roh durch statt als `anderes` — waehrend dieser
 * Kommentar schon „dieselbe Einteilung" behauptete. Der Zeuge haelt die
 * Funktion deshalb gegen das ECHTE dienstVon(), nicht gegen eine Tabelle.
 */
export function dienstAus(eintrag) {
  const t = String(eintrag?.type ?? '').toLowerCase()
  if (t.startsWith('spotify')) return 'spotify'
  if (t.startsWith('jellyfin')) return 'jellyfin'
  if (t === 'library' || t === 'local') return 'lokal'
  if (t === 'radio' || t === 'rss' || t === 'ard') return t
  if (t === 'plugin') {
    const id = String(eintrag?.id ?? '').trim()
    const i = id.indexOf(':')
    return i > 0 && i < id.length - 1 ? id.slice(0, i) : 'plugin'
  }
  return 'anderes'
}

/**
 * Den Bestand zu einer Namensliste verdichten.
 *
 * Ein Name kommt nur einmal vor, auch wenn er zwanzig Alben hat; gezaehlt
 * wird trotzdem, denn wer mehr Eintraege hat, wird beim Zusammenlegen der
 * Anzeigename (siehe `hauptVon`).
 */
export function namenAus(eintraege) {
  const karte = new Map()
  for (const e of Array.isArray(eintraege) ? eintraege : []) {
    const name = String(e?.artist ?? '').trim()
    if (!name) continue
    const schluessel = normal(name)
    let n = karte.get(schluessel)
    if (!n) {
      n = { name, schluessel, dienste: new Set(), anzahl: 0, titel: [] }
      karte.set(schluessel, n)
    }
    n.anzahl++
    n.dienste.add(dienstAus(e))
    const titel = String(e?.title ?? '').trim()
    if (titel && n.titel.length < TITEL_JE_NAME && !n.titel.includes(titel)) n.titel.push(titel)
  }
  return [...karte.values()].map((n) => ({ ...n, dienste: [...n.dienste].sort() }))
}

/** Der Schluessel eines Paares — unabhaengig von der Reihenfolge. */
export function paarSchluessel(a, b) {
  return [normal(a), normal(b)].sort().join(' ⟷ ')
}

/**
 * Welche Namen Jev ueberhaupt sehen soll.
 *
 * EIN PAAR KOMMT IN FRAGE, wenn ein tragendes Wort aus dem Namen des einen im
 * Namen ODER in den Titeln des anderen steht. Die Titel sind der Grund, warum
 * „EUROPA Hörspiele & Kinderlieder" (Titel: „Hello Kitty - Alle Hörspiele")
 * ueberhaupt neben „Hello Kitty Hörspiele" landet — am Namen allein haengt
 * da nichts.
 *
 * Bei 44 Namen waeren alle Paare 946 Fragen; der Filter laesst davon die
 * uebrig, bei denen es etwas zu entscheiden gibt. Sortiert nach Zahl der
 * gemeinsamen Woerter, damit der Deckel die unwahrscheinlichsten trifft.
 */
export function kandidaten(namen, grenze = Infinity) {
  const w = namen.map((n) => {
    const eigen = woerter(n.name)
    const titel = new Set()
    for (const t of n.titel) for (const x of woerter(t)) titel.add(x)
    return { eigen, alles: new Set([...eigen, ...titel]) }
  })
  const paare = []
  for (let i = 0; i < namen.length; i++) {
    for (let j = i + 1; j < namen.length; j++) {
      const gemeinsam = new Set()
      for (const x of w[i].eigen) if (w[j].alles.has(x)) gemeinsam.add(x)
      for (const x of w[j].eigen) if (w[i].alles.has(x)) gemeinsam.add(x)
      if (gemeinsam.size === 0) continue
      paare.push({ a: namen[i], b: namen[j], gemeinsam: [...gemeinsam].sort() })
    }
  }
  paare.sort(
    (p, q) =>
      q.gemeinsam.length - p.gemeinsam.length ||
      paarSchluessel(p.a.name, p.b.name).localeCompare(paarSchluessel(q.a.name, q.b.name)),
  )
  return Number.isFinite(grenze) ? paare.slice(0, Math.max(0, grenze)) : paare
}

/**
 * Wer bei einem Zusammenlegen die Kennung stiftet, also als Anzeigename vorn steht.
 *
 * Der Name mit mehr Eintraegen; bei Gleichstand der kuerzere — „Die Maus"
 * statt „Die Maus, Eva mit Gitarre, Der Elefant". Die Seite schlaegt das nur
 * vor; wer umgekehrt will, legt von Hand an.
 */
export function hauptVon(a, b) {
  if (a.anzahl !== b.anzahl) return a.anzahl > b.anzahl ? a : b
  if (a.name.length !== b.name.length) return a.name.length < b.name.length ? a : b
  return a.name.localeCompare(b.name) <= 0 ? a : b
}

/* ── Die Frage an Jev ──────────────────────────────────────────────────── */

export const ANTWORTEN = {
  dieselbe:
    'Beide Namen meinen dieselbe Serie, Figur, Sendung oder denselben Interpreten — nur anders geschrieben, in anderer Sprache, oder ein Verlag/Label steht fuer genau diese Serie.',
  mitwirkung:
    'Einer der Namen ist eine Zusammenarbeit oder Sammlung, in der der andere die Hauptfigur oder der Hauptinterpret ist; beide gehoeren auf dieselbe Interpreten-Seite.',
  verschieden: 'Es sind verschiedene Serien oder Interpreten; sie teilen hoechstens ein Wort oder einen Mitwirkenden.',
}

function beschreibung(etikett, n) {
  return [
    `${etikett}: „${n.name}"`,
    `  Dienste: ${n.dienste.join(', ')} · ${n.anzahl} Eintraege`,
    `  Titel: ${n.titel.join(' ; ') || '(keine)'}`,
  ].join('\n')
}

/** Der Rumpf fuer genau ein Paar. */
export function frageRumpf(a, b, modell) {
  return {
    model: modell,
    state: [
      'Medienbibliothek einer Kinder-Hoerbox. Die Namen stammen aus verschiedenen Diensten (Spotify, ARD, eigene Dateien, Jellyfin)',
      'und schreiben dieselbe Serie oft verschieden; manchmal steht statt der Serie der Verlag oder eine Liste von Mitwirkenden.',
      '',
      beschreibung('Name A', a),
      beschreibung('Name B', b),
    ].join('\n'),
    questions: {
      zuordnung: {
        type: 'choice',
        instructions: 'Gehoeren Name A und Name B in dieser Box unter dieselbe Interpreten-Kachel?',
        criteria: ANTWORTEN,
      },
    },
  }
}

/**
 * Jevs Antwort lesen. Wirft, wenn sie nicht die zugesagte Form hat — ein
 * still als „verschieden" gelesener Fehler waere ein Vorschlag, der fehlt,
 * ohne dass es jemand merkt.
 */
export function antwortLesen(rumpf) {
  const z = rumpf?.answers?.zuordnung
  const wahl = z?.choice
  if (!Object.hasOwn(ANTWORTEN, wahl))
    throw new Error(`Antwort ohne gueltige Wahl: ${JSON.stringify(rumpf)?.slice(0, 200)}`)
  const w = {}
  for (const k of Object.keys(ANTWORTEN)) {
    const x = Number(z?.probabilities?.[k])
    w[k] = Number.isFinite(x) ? x : k === wahl ? 1 : 0
  }
  // SICHERHEIT = wie wenig Jev an „verschieden" glaubt. Ob es „dieselbe" oder
  // „Mitwirkung" ist, aendert am Zusammenlegen nichts; die Summe beider ist
  // die Frage, die der Mensch beantworten soll.
  const sicherheit = Math.max(0, Math.min(1, 1 - w.verschieden))
  const kosten = Number(rumpf?.usage?.cost)
  return { wahl, wahrscheinlichkeiten: w, sicherheit, kosten: Number.isFinite(kosten) ? kosten : 0 }
}

/** Was ein Fehlerstatus fuer die Eltern bedeutet. */
function statusText(status) {
  if (status === 401 || status === 403) return 'Schluessel abgelehnt'
  if (status === 402) return 'kein Guthaben beim Anbieter'
  if (status === 404) return 'Adresse oder Modell unbekannt — hat der Anbieter den alpha-Pfad geaendert?'
  if (status === 429) return 'zu viele Anfragen'
  return `HTTP ${status}`
}

/** Anbieter, Adresse, Modell und Schluessel aus den Einstellungen — oder ein Grund, warum nicht. */
export function zugang(einst) {
  const name =
    String(einst?.anbieter ?? 'openrouter')
      .trim()
      .toLowerCase() || 'openrouter'
  const a = ANBIETER[name]
  if (!a) return { fehler: `Anbieter „${name}" gibt es nicht — openrouter oder typesafe` }
  const schluessel = String(
    (name === 'typesafe' ? einst?.typesafeSchluessel : einst?.openrouterSchluessel) ?? '',
  ).trim()
  if (!schluessel) return { fehler: `Kein ${name === 'typesafe' ? 'TypeSafe' : 'OpenRouter'}-Schluessel eingetragen` }
  const modell = String(einst?.modell ?? '').trim() || a.modell
  return { anbieter: name, adresse: a.adresse, modell, schluessel }
}

/** Eine Frage stellen. */
export async function fragen(kontext, z, a, b) {
  const antwort = await kontext.holen(z.adresse, {
    method: 'POST',
    headers: { authorization: `Bearer ${z.schluessel}`, 'content-type': 'application/json' },
    body: JSON.stringify(frageRumpf(a, b, z.modell)),
  })
  const text = await antwort.text()
  if (!antwort.ok) throw new Error(`${statusText(antwort.status)}${text ? `: ${text.slice(0, 160)}` : ''}`)
  let rumpf
  try {
    rumpf = JSON.parse(text)
  } catch {
    throw new Error(`keine JSON-Antwort: ${text.slice(0, 160)}`)
  }
  return antwortLesen(rumpf)
}

/* ── Die Ablage ────────────────────────────────────────────────────────── */

const LEER = () => ({ lauf: null, antworten: {}, entscheidungen: {} })

/*
 * Ohne Datenordner (Pruefstand, oder die Box konnte ihn nicht anlegen) lebt
 * die Ablage nur im Speicher des Workers. Das ist ehrlich genug fuer einen
 * Vorschlag — `befinden` sagt es dazu.
 */
let imSpeicher = null

/*
 * WAEHREND EINES DURCHLAUFS GIBT ES NUR EINE ABLAGE — die im Speicher des
 * Workers. Er schreibt sie alle zehn Antworten GANZ zurueck. Bis 29.09.2026
 * las `entscheiden` derweil von der Platte, trug das Urteil ein und schrieb;
 * der naechste Zwischenstand des Workers kannte das Urteil nicht und schrieb
 * darueber. Der Klick war weg, ohne Meldung, und das Paar tauchte wieder auf
 * (AUDIT-2026-09-28 §1b Rang 2).
 *
 * WARUM KEIN RIEGEL wie bei `vergessen`: ein Durchlauf ueber 300 Paare dauert
 * Minuten, und genau dann sitzt jemand vor der Seite und klickt die ersten
 * Vorschlaege weg. Ihn abzuweisen hiesse, den Fehler hoeflicher zu machen.
 * WARUM KEINE EIGENE DATEI FUER ENTSCHEIDUNGEN: zwei Klicks gleichzeitig
 * haetten dort denselben Wettlauf (lesen, aendern, schreiben), die Kette
 * unten braucht es also ohnehin — und mit ihr reicht eine Datei, ohne
 * Umzug der Entscheidungen, die schon in gruppen.json stehen.
 *
 * Das haelt nur, weil je Plugin genau EIN Worker laeuft: plugin-wirt.ts
 * beendet den alten, bevor es einen neuen startet. `laufend` verlaesst sich
 * seit jeher auf dasselbe.
 */
let laufAblage = null

/*
 * JEDE AENDERUNG DER ABLAGE LAEUFT NACHEINANDER: lesen, aendern, schreiben
 * als EIN Schritt, und der naechste beginnt erst danach. Das deckt, was die
 * geteilte Ablage allein nicht deckt — zwei Klicks gleichzeitig, ein Klick
 * gegen den Start eines Durchlaufs, zwei Starts gegeneinander.
 */
let kette = Promise.resolve()

function nacheinander(schritt) {
  const ergebnis = kette.then(schritt)
  // Der Fehler gehoert dem Aufrufer, der ihn ueber `ergebnis` bekommt. Die
  // Kette selbst darf an ihm nicht reissen, sonst schriebe nie wieder jemand.
  kette = ergebnis.then(
    () => undefined,
    () => undefined,
  )
  return ergebnis
}

/** Lesen, aendern, schreiben — als ein Schritt der Kette. */
function ablageAendern(kontext, aendern) {
  return nacheinander(async () => {
    const ablage = await ablageLesen(kontext)
    const ergebnis = aendern(ablage)
    await ablageSchreiben(kontext, ablage)
    return ergebnis
  })
}

async function ablageLesen(kontext) {
  if (laufAblage) return laufAblage
  if (!kontext.datenOrdner) {
    if (!imSpeicher) imSpeicher = LEER()
    return imSpeicher
  }
  try {
    const roh = JSON.parse(await readFile(join(kontext.datenOrdner, 'gruppen.json'), 'utf8'))
    return { ...LEER(), ...roh }
  } catch {
    return LEER()
  }
}

/** Fortlaufend fuer diesen Worker; zwischen Workern trennt `threadId`. */
let schreibNr = 0

/**
 * Der Name der Zwischendatei — JE AUFRUF ein anderer.
 *
 * Bis 29.09.2026 hiess sie fest `gruppen.json.neu`. Zwei Schreiber zugleich
 * schrieben dann in DIESELBE Datei, der eine benannte die halbe des anderen
 * um, und `ablageLesen` las eine kaputte Ablage als leer — beim naechsten
 * Schreiben waren alle Antworten und Entscheidungen weg. Dieselbe Hausfalle
 * wie die vierzehn Kopien in server.ts (llmwiki
 * `vierzehn-kopien-und-die-abweichung-ist-der-fehler`); das Vorbild ist
 * `zwischenname()` in src/backend-api/src/atomar.ts. Nachgebaut statt
 * importiert, weil auf der Box nur das Buendel server.js liegt, kein Quelltext.
 *
 * WARUM `threadId` ZUSAETZLICH ZUR PROZESSKENNUNG: ein Plugin laeuft in einem
 * Worker-Thread, `process.pid` ist die des Servers — geteilt mit JEDEM Plugin
 * und nach einem Neustart (Einstellungen geaendert) mit dem eigenen
 * Vorgaenger-Worker, dessen Zaehler ebenfalls bei 1 anfing.
 */
export function zwischenname(ziel) {
  return `${ziel}.${process.pid}.${threadId}.${++schreibNr}.tmp`
}

/** Fuer die Zeugen exportiert: schreibt die Ablage, ohne die Kette zu fragen. */
export async function ablageSchreiben(kontext, ablage) {
  if (!kontext.datenOrdner) {
    imSpeicher = ablage
    return
  }
  await mkdir(kontext.datenOrdner, { recursive: true })
  const ziel = join(kontext.datenOrdner, 'gruppen.json')
  // Erst daneben, dann umbenennen: ein Absturz mitten im Schreiben laesst die
  // alte Datei stehen statt einer halben.
  const zwischen = zwischenname(ziel)
  try {
    await writeFile(zwischen, JSON.stringify(ablage, null, 1))
    await rename(zwischen, ziel)
  } catch (e) {
    // Keine Leiche im Datenordner — sie traege mit jedem Fehlschlag eine
    // neue Nummer und wuerde nie wieder ueberschrieben.
    await rm(zwischen, { force: true }).catch(() => undefined)
    throw e
  }
}

/**
 * Der Medienbestand — von der PLATTE, aus demselben Grund wie in
 * mixpi-similar (`bestandLesen`): `kontext.holen` verwehrt die eigene Box.
 * `data.json` liegt zwei Ebenen ueber dem eigenen Datenordner.
 */
async function bestandLesen(kontext) {
  if (!kontext.datenOrdner) return { eintraege: [], fehler: 'kein Datenordner — der Bestand ist nicht lesbar' }
  const pfad = join(kontext.datenOrdner, '..', '..', 'data.json')
  try {
    const roh = JSON.parse(await readFile(pfad, 'utf8'))
    return { eintraege: Array.isArray(roh) ? roh : [], fehler: null }
  } catch (e) {
    return { eintraege: [], fehler: `${pfad}: ${e?.message ?? e}` }
  }
}

/* ── Der Durchlauf ─────────────────────────────────────────────────────── */

let laufend = null

/** Fuer die Zeugen: auf das Ende eines gestarteten Laufs warten. */
export function laufAbwarten() {
  return laufend ?? Promise.resolve()
}

/** Fuer die Zeugen: den Speicher zwischen zwei Tests leeren. */
export function speicherLeeren() {
  imSpeicher = null
}

/**
 * Einen Durchlauf vorbereiten und im Hintergrund starten.
 *
 * Gefragt wird nur, was noch keine Antwort und keine Entscheidung hat —
 * ein zweiter Durchlauf nach neuen Alben kostet also nur die neuen Paare.
 * `eintraege` ist fuer die Zeugen; auf der Box kommt der Bestand von der Platte.
 */
export async function starten(kontext, { eintraege } = {}) {
  const laeuftSchon = { ok: true, text: 'Laeuft schon — der Stand steht unter „Gruppen".' }
  if (laufend) return laeuftSchon
  if (!kontext.holen) return { ok: false, text: 'Recht „netz" fehlt' }
  const z = zugang(kontext.einstellungen)
  if (z.fehler) return { ok: false, text: z.fehler }

  let liste = eintraege
  if (!liste) {
    const b = await bestandLesen(kontext)
    if (b.fehler) return { ok: false, text: `Bestand nicht lesbar: ${b.fehler}` }
    liste = b.eintraege
  }
  const grenze =
    Number(kontext.einstellungen?.hoechstensPaare) > 0 ? Number(kontext.einstellungen.hoechstensPaare) : 300
  const namen = namenAus(liste)
  const paare = kandidaten(namen)

  // PRUEFEN, LESEN UND UEBERNEHMEN IN EINEM SCHRITT DER KETTE. Die Pruefung
  // oben allein liess zwei Starts durch, die beide vor dem ersten `await`
  // standen — zwei Laeufe, doppelte Kosten, und der langsamere schrieb die
  // Antworten des schnelleren weg. Und ein Klick, der gerade von der Platte
  // gelesen hat, darf nicht in eine Ablage schreiben, die der Lauf schon haelt.
  return nacheinander(async () => {
    if (laufend) return laeuftSchon
    const ablage = await ablageLesen(kontext)
    const offen = paare.filter((p) => {
      const s = paarSchluessel(p.a.name, p.b.name)
      return !ablage.antworten[s] && !ablage.entscheidungen[s]
    })
    const dran = offen.slice(0, grenze)

    ablage.lauf = {
      begonnen: new Date().toISOString(),
      fertig: null,
      namen: namen.length,
      paare: dran.length,
      uebersprungen: offen.length - dran.length,
      gefragt: 0,
      fehler: [],
      abgebrochen: null,
      kosten: 0,
      anbieter: z.anbieter,
      modell: z.modell,
    }
    await ablageSchreiben(kontext, ablage)

    laufAblage = ablage
    laufend = abarbeiten(kontext, z, ablage, dran).finally(() => {
      laufend = null
    })
    const rest = ablage.lauf.uebersprungen ? ` (${ablage.lauf.uebersprungen} weitere ueber dem Deckel)` : ''
    return { ok: true, text: `Gestartet: ${dran.length} Paare aus ${namen.length} Namen${rest}.` }
  })
}

async function abarbeiten(kontext, z, ablage, paare) {
  const schlange = [...paare]
  let kette = 0
  const arbeiter = async () => {
    while (schlange.length && !ablage.lauf.abgebrochen) {
      const p = schlange.shift()
      const s = paarSchluessel(p.a.name, p.b.name)
      try {
        const r = await fragen(kontext, z, p.a, p.b)
        const haupt = hauptVon(p.a, p.b)
        const neben = haupt === p.a ? p.b : p.a
        ablage.antworten[s] = {
          haupt: { name: haupt.name, dienste: haupt.dienste, anzahl: haupt.anzahl },
          neben: { name: neben.name, dienste: neben.dienste, anzahl: neben.anzahl },
          gemeinsam: p.gemeinsam,
          ...r,
          gefragt: new Date().toISOString(),
          modell: z.modell,
        }
        ablage.lauf.kosten += r.kosten
        kette = 0
      } catch (e) {
        kette++
        const text = String(e?.message ?? e)
        if (ablage.lauf.fehler.length < 20) ablage.lauf.fehler.push(`${p.a.name} / ${p.b.name}: ${text}`)
        if (kette >= FEHLER_KETTE) ablage.lauf.abgebrochen = `${FEHLER_KETTE} Fehler hintereinander, zuletzt: ${text}`
      }
      const n = ++ablage.lauf.gefragt
      if (n % 10 === 0) {
        // GEMELDET WIE DER SCHLUSS, NICHT VERSCHLUCKT: bis 29.09.2026 stand
        // hier `.catch(() => {})`. Ein voller oder schreibgeschuetzter
        // Datenordner fiel damit erst am Ende auf — nach 300 bezahlten Fragen.
        await nacheinander(() => ablageSchreiben(kontext, ablage)).catch((e) =>
          kontext.protokoll?.(`Zwischenstand nach ${n} Antworten nicht geschrieben: ${e?.message ?? e}`),
        )
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: PARALLEL }, arbeiter))
  } finally {
    ablage.lauf.fertig = new Date().toISOString()
    await nacheinander(async () => {
      try {
        await ablageSchreiben(kontext, ablage)
      } catch (e) {
        kontext.protokoll?.(`Ablage nicht geschrieben: ${e?.message ?? e}`)
      } finally {
        // ERST NACH DEM LETZTEN SCHREIBEN LOSLASSEN, und im selben Schritt der
        // Kette: wer danach dran ist, liest von der Platte — und die traegt
        // jetzt auch jede Entscheidung, die waehrend des Laufs kam.
        laufAblage = null
      }
    })
  }
}

/* ── Was die Seite liest ───────────────────────────────────────────────── */

function schwelleAus(einst) {
  const s = Number(einst?.schwelle)
  return Number.isFinite(s) && s >= 0 && s <= 1 ? s : 0.7
}

/**
 * Der Stand fuer die Seite „Gruppen".
 *
 * GEZEIGT wird, was Jev nicht fuer „verschieden" haelt, ueber der Schwelle
 * liegt und noch nicht entschieden ist. Was darunter liegt, wird nur GEZAEHLT
 * — wer es sehen will, senkt die Schwelle.
 */
export function standAus(ablage, einst) {
  const schwelle = schwelleAus(einst)
  const vorschlaege = []
  let unsicher = 0
  for (const [paar, a] of Object.entries(ablage.antworten ?? {})) {
    if (ablage.entscheidungen?.[paar]) continue
    if (a.wahl === 'verschieden') continue
    if (a.sicherheit < schwelle) {
      unsicher++
      continue
    }
    vorschlaege.push({ paar, ...a })
  }
  vorschlaege.sort((p, q) => q.sicherheit - p.sicherheit || p.paar.localeCompare(q.paar))
  const zaehle = (u) => Object.values(ablage.entscheidungen ?? {}).filter((e) => e.urteil === u).length
  return {
    lauf: ablage.lauf,
    laeuft: Boolean(laufend),
    schwelle,
    vorschlaege,
    unsicher,
    beantwortet: Object.keys(ablage.antworten ?? {}).length,
    angenommen: zaehle('angenommen'),
    abgelehnt: zaehle('abgelehnt'),
  }
}

const URTEILE = new Set(['angenommen', 'abgelehnt', 'offen'])

export default {
  /**
   * Die Flaeche fuer die Seite „Gruppen".
   *
   *   GET  stand                            Lauf, Vorschlaege, Zaehler
   *   POST durchlauf                        wie die Aktion
   *   POST entscheiden {paar, urteil}       angenommen | abgelehnt | offen
   *   POST entscheiden {alle: 'abgelehnt', urteil: 'offen'}   alle Neins zurueck
   *
   * `entscheiden` merkt sich nur, dass ueber ein Paar entschieden ist, damit
   * es nicht wieder auftaucht. Das ZUSAMMENLEGEN selbst tut die Seite beim
   * Kern — ein Plugin hat dort nichts zu schreiben.
   */
  async http(anfrage, kontext) {
    const pfad = String(anfrage?.pfad ?? '').replace(/^\/+/, '')
    if (anfrage?.methode === 'GET' && pfad === 'stand') {
      return { inhalt: standAus(await ablageLesen(kontext), kontext.einstellungen) }
    }
    if (anfrage?.methode === 'POST' && pfad === 'durchlauf') {
      const r = await starten(kontext)
      return { status: r.ok ? 200 : 409, inhalt: r }
    }
    if (anfrage?.methode === 'POST' && pfad === 'entscheiden') {
      const paar = String(anfrage?.rumpf?.paar ?? '')
      const urteil = String(anfrage?.rumpf?.urteil ?? '')
      // ALLE NEINS AUF EINMAL ZURUECK — der Rueckweg der Seite fuer ein
      // vorschnelles „Nein". Nur fuer abgelehnte: ein angenommenes Paar
      // steht als Gruppe beim Kern, und dort ist „Lösen" der Rueckweg.
      if (anfrage?.rumpf?.alle === 'abgelehnt' && urteil === 'offen') {
        const n = await ablageAendern(kontext, (ablage) => {
          let zurueck = 0
          for (const [s, e] of Object.entries(ablage.entscheidungen)) {
            if (e?.urteil === 'abgelehnt') {
              delete ablage.entscheidungen[s]
              zurueck++
            }
          }
          return zurueck
        })
        return { inhalt: { ok: true, zurueck: n } }
      }
      if (!paar || !URTEILE.has(urteil))
        return { status: 400, inhalt: { fehler: 'paar und urteil (angenommen|abgelehnt|offen) noetig' } }
      // Laeuft ein Durchlauf, landet das Urteil in SEINER Ablage und wird
      // sofort geschrieben — siehe `laufAblage`. Kein Abweisen, kein Verlust.
      await ablageAendern(kontext, (ablage) => {
        if (urteil === 'offen') delete ablage.entscheidungen[paar]
        else ablage.entscheidungen[paar] = { urteil, am: new Date().toISOString() }
      })
      return { inhalt: { ok: true } }
    }
    return {
      status: 404,
      inhalt: {
        fehler: `unbekannt: ${anfrage?.methode} ${pfad} — es gibt GET stand, POST durchlauf, POST entscheiden`,
      },
    }
  },

  async befinden(kontext) {
    const z = zugang(kontext.einstellungen)
    if (z.fehler) return { ok: false, text: z.fehler }
    const ablage = await ablageLesen(kontext)
    const l = ablage.lauf
    const speicher = kontext.datenOrdner ? '' : ' (ohne Datenordner — nur im Speicher)'
    if (laufend && l) return { ok: true, text: `laeuft: ${l.gefragt} von ${l.paare} Paaren gefragt${speicher}` }
    if (!l) return { ok: true, text: `bereit — ${z.anbieter}, ${z.modell}; noch kein Durchlauf${speicher}` }
    if (l.abgebrochen) return { ok: false, text: `letzter Durchlauf abgebrochen: ${l.abgebrochen}` }
    const s = standAus(ablage, kontext.einstellungen)
    return {
      ok: true,
      text: `${s.vorschlaege.length} offene Vorschlaege, ${s.unsicher} unter der Schwelle; letzter Durchlauf ${l.fertig ?? l.begonnen}${speicher}`,
    }
  },

  async aktion(kennung, kontext) {
    if (kennung === 'durchlauf') return starten(kontext)
    if (kennung === 'vergessen') {
      // DER RIEGEL BLEIBT HIER, anders als bei `entscheiden`: Antworten
      // wegwerfen, waehrend der Lauf neue hinzufuegt, ist ein Widerspruch in
      // sich — und es ist ein seltener Knopf der Eltern, kein Klick im Fluss.
      // Geprueft IN der Kette, damit kein Start dazwischenrutscht.
      return nacheinander(async () => {
        if (laufend) return { ok: false, text: 'Erst den laufenden Durchlauf abwarten.' }
        const ablage = await ablageLesen(kontext)
        const n = Object.keys(ablage.antworten).length
        ablage.antworten = {}
        await ablageSchreiben(kontext, ablage)
        return { ok: true, text: `${n} Antworten vergessen; Entscheidungen bleiben.` }
      })
    }
    if (kennung === 'verbindung') {
      if (!kontext.holen) return { ok: false, text: 'Recht „netz" fehlt' }
      const z = zugang(kontext.einstellungen)
      if (z.fehler) return { ok: false, text: z.fehler }
      const a = {
        name: 'Die Maus',
        dienste: ['ard'],
        anzahl: 5,
        titel: ['MausZoom – Kindernachrichten', 'Gute Nacht mit der Maus'],
      }
      const b = {
        name: 'Die Sendung mit der Maus',
        dienste: ['lokal'],
        anzahl: 3,
        titel: ['Lach- und Sachgeschichten'],
      }
      const ab = Date.now()
      try {
        const r = await fragen(kontext, z, a, b)
        return {
          ok: true,
          text: `${z.anbieter}/${z.modell} antwortet in ${Date.now() - ab} ms: „${r.wahl}", Sicherheit ${Math.round(r.sicherheit * 100)} %`,
        }
      } catch (e) {
        return { ok: false, text: `${z.anbieter}: ${e?.message ?? e}` }
      }
    }
    return { ok: false, text: `unbekannte Aktion "${kennung}"` }
  },
}
