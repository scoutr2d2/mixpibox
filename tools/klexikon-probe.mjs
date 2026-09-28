#!/usr/bin/env node
/**
 * KLEXIKON-PROBE — faehrt mixpi-klexikon gegen das ECHTE Klexikon.
 *
 * WOZU, wenn es doch Zeugen gibt: die Zeugen fahren gegen
 * `plugins/mixpi-klexikon/klexikon.fixture.json` und gegen erfundene
 * Antworten, also gegen die Schnittstelle VON EINEM TAG. Sie bleiben gruen,
 * wenn das Klexikon morgen die Ueberschriften anders auszeichnet oder die
 * Kategorie umbenennt — genau dann, wenn es darauf ankommt. Diese Probe ist
 * die Gegenfrage: traegt das Plugin noch, mit echtem Netz?
 *
 * WAS SIE FAEHRT (das echte Plugin, echtes `fetch` mit der 8-s-Frist des
 * Wirts, ein Wegwerf-Datenordner, und ein GEFAELSCHTES `sprechen`, das die
 * Texte aufzeichnet und eine Adresse nach der Regel des Kerns baut):
 *
 *   1. Schnittstelle roh: wie viele Volltexte eine Mehrfach-Anfrage liefert,
 *      wie gross „Klexikon-Artikel" ist, ob es „Übersichtsseite" noch gibt
 *   2. Suche „Mond" ueber http/angebot — Treffer, keine Uebersichtsseite,
 *      Vorschlag in der Form, die der Kern versteht
 *   3. inhalt „Deutschland" — eine Folge je Abschnitt, keine Markup-Reste,
 *      Lizenzsatz nur an der letzten
 *   4. inhalt „Hund" — die Weiterleitung auf „Hunde"
 *   5. inhalt „heute" zweimal — gleich? und kalt, warm, nach Neustart: wie
 *      viele Anfragen?
 *   6. aufloesen, Vorschaubild erreichbar, befinden, aktion
 *
 * Am Ende EINE Bilanzzeile mit der Zeichenzahl aller gesprochenen Texte und
 * dem laengsten Ruf gegen die Frist; Ende 0 oder 1.
 *
 * SIE GEHOERT IN KEINEN LAEUFER (nicht in `doku-luecken-probe.sh`, nirgends):
 * sie braucht das Internet und einen fremden Dienst. Eine Wache, die rot
 * wird, weil jemandes WLAN klemmt, lehrt niemanden etwas — dasselbe Argument
 * wie bei `tools/mediathek-probe.mjs`. Von Hand fahren: vor dem Ausliefern,
 * und wenn am Klexikon etwas klemmt.
 *
 * AUFRUF
 *     node tools/klexikon-probe.mjs
 *     node tools/klexikon-probe.mjs --themen "Geschichte, Erdkunde"
 *     node tools/klexikon-probe.mjs --begriff Dinosaurier     # kalte Suche: der teure Fall
 *     node tools/klexikon-probe.mjs --vorlage-erneuern
 *
 * `--vorlage-erneuern` schreibt `plugins/mixpi-klexikon/klexikon.fixture.json`
 * neu — GEKUERZT (je Absatz der erste Satz, Ueberschriften und Wegweiser
 * vollstaendig) und mit Quelle und Lizenz. Danach `node --test` fahren und
 * SEHEN, was rot wird: das ist der Zweck, die Alterung der Vorlage sichtbar
 * zu machen statt sie zu verstecken.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = path.join(WURZEL, 'plugins', 'mixpi-klexikon')
const VORLAGE = path.join(PLUGIN, 'klexikon.fixture.json')
const API = 'https://klexikon.zum.de/api.php'
/** Die Frist des Wirts (`FRIST_MS` in plugin-wirt.ts) — je Ruf, nicht je Anfrage. */
const FRIST_MS = 8000
/** Die Obergrenze von `sprechen()` im Kern (SPRECH_TEXT_MAX in sprechstrom.ts). */
const SPRECH_MAX = 20_000

const args = process.argv.slice(2)
function schalter(name, vorgabe = null) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : vorgabe
}
const themen = schalter('--themen', 'Tiere und Natur, Wissenschaft und Technik')
/* EIN KALTER BEGRIFF IST DER TEURE FALL: das Klexikon holt jedes Vorschaubild
 * beim ersten Mal bei Commons nach (~0,23 s je Bild, gemessen 28.09.2026).
 * „Mond" ist nach dem ersten Lauf warm; wer die Frist wirklich pruefen will,
 * nimmt ein Wort, das heute noch niemand gesucht hat. */
const begriff = schalter('--begriff', 'Mond')
const erneuern = args.includes('--vorlage-erneuern')

const plugin = await import(path.join(PLUGIN, 'index.mjs'))
const { default: kx, zwischenspeicherLeeren, LIZENZ_SATZ } = plugin

let fehler = 0
let gut = 0
function sagen(ok, text) {
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${text}`)
  if (ok) gut++
  else fehler++
}
const hinweis = (text) => console.log(`  ——    ${text}`)

/* ── Der Kontext ──────────────────────────────────────────────────────────
 * `holen` wie im Wirt: echtes fetch MIT der Frist. Gezaehlt wird jede
 * Anfrage — „heute kostet im Normalfall EINE" ist eine Behauptung des
 * Plugins, und hier wird sie nachgezaehlt.
 *
 * `sprechen` GEFAELSCHT: die Probe misst das Klexikon und das Plugin, nicht
 * Piper. Die Adresse folgt der Regel von `sprechName` in sprechstrom.ts
 * (sha256 ueber Text und Tempo), damit „zweimal dieselbe Liste" hier
 * dasselbe heisst wie auf der Box. Und sie wirft wie der Kern bei leerem
 * oder zu langem Text. */
const gesprochen = []
let anfragen = 0
const ordner = mkdtempSync(path.join(tmpdir(), 'klexikon-probe-'))
function kontextBauen({ mitStimme = true } = {}) {
  const k = {
    protokoll: (s) => console.log(`        [plugin] ${s}`),
    einstellungen: Object.freeze({ tempo: 1.1, themen }),
    datenOrdner: ordner,
    holen: (adresse, gaben) => {
      anfragen++
      return fetch(adresse, { ...gaben, signal: AbortSignal.timeout(FRIST_MS) })
    },
  }
  if (mitStimme) {
    k.sprechen = async (roh, gaben) => {
      const text = String(roh ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text) throw new Error('sprechen: kein Text')
      if (text.length > SPRECH_MAX) throw new Error(`sprechen: ${text.length} Zeichen sind zu viel`)
      const tempo = Number(gaben?.tempo ?? 1)
      gesprochen.push(text)
      const name = createHash('sha256')
        .update(JSON.stringify({ t: text, s: tempo }))
        .digest('hex')
        .slice(0, 32)
      return { art: 'strom', adresse: `http://127.0.0.1:8200/api/sprechen/${name}.wav` }
    }
  }
  return k
}
const kontext = kontextBauen()

/** Einen Plugin-Ruf fahren und gegen die Frist messen. */
let laengster = { ms: 0, was: '' }
async function ruf(was, fn) {
  const ab = Date.now()
  const vorher = anfragen
  try {
    const wert = await fn()
    return { wert, ms: Date.now() - ab, anfragen: anfragen - vorher }
  } catch (f) {
    return { fehler: f, ms: Date.now() - ab, anfragen: anfragen - vorher }
  } finally {
    const ms = Date.now() - ab
    if (ms > laengster.ms) laengster = { ms, was }
  }
}

async function roh(gaben) {
  const p = new URLSearchParams({ ...gaben, format: 'json', formatversion: '2' })
  const a = await fetch(`${API}?${p}`, { signal: AbortSignal.timeout(15000) })
  if (!a.ok) throw new Error(`HTTP ${a.status}`)
  return a.json()
}

console.log(`── mixpi-klexikon gegen das echte Klexikon (${new Date().toISOString()}) ──`)

try {
  /* ── 1. Die Schnittstelle selbst ───────────────────────────────────────── */
  console.log('\n1. Schnittstelle')
  const mehr = await roh({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    titles: 'Mond|Deutschland|Elefanten',
  })
  const mitText = (mehr?.query?.pages ?? []).filter((s) => String(s.extract ?? '').length > 0)
  hinweis(
    `Mehrfach-Anfrage: ${mitText.length} von 3 mit Volltext (${mitText.map((s) => s.title).join(', ') || '—'})` +
      ' — das Plugin fragt ohnehin je Artikel einzeln',
  )
  const info = await roh({
    action: 'query',
    prop: 'categoryinfo',
    titles: 'Kategorie:Klexikon-Artikel|Kategorie:Übersichtsseite',
  })
  const groesse = Object.fromEntries((info?.query?.pages ?? []).map((s) => [s.title, s.categoryinfo?.pages ?? 0]))
  sagen(
    groesse['Kategorie:Klexikon-Artikel'] > 1000,
    `„Klexikon-Artikel" traegt ${groesse['Kategorie:Klexikon-Artikel']} Artikel — die Sorte, nach der die Suche filtert`,
  )
  sagen(
    groesse['Kategorie:Übersichtsseite'] > 0,
    `„Übersichtsseite" traegt ${groesse['Kategorie:Übersichtsseite']} Seiten — die, die heraus muessen`,
  )

  /* ── 2. Suche ─────────────────────────────────────────────────────────── */
  console.log(`\n2. Suche „${begriff}" ueber http/angebot`)
  const leer = await ruf('angebot ohne q', () => kx.http({ methode: 'GET', pfad: 'angebot', abfrage: {} }, kontext))
  sagen(
    leer.wert?.inhalt?.werke?.length === 1 && leer.wert.inhalt.werke[0].kennung === 'heute' && leer.anfragen === 0,
    `ohne Begriff: ${leer.wert?.inhalt?.werke?.map((w) => w.titel).join(', ')} — ${leer.anfragen} Anfragen`,
  )
  const s = await ruf(`angebot?q=${begriff}`, () =>
    kx.http({ methode: 'GET', pfad: 'angebot', abfrage: { q: begriff } }, kontext),
  )
  const werke = s.wert?.inhalt?.werke ?? []
  sagen(
    (s.wert?.status ?? 200) === 200 && werke.length > 0,
    `${werke.length} Treffer von ${s.wert?.inhalt?.gesamt} (${s.ms} ms)${s.fehler ? ` — ${s.fehler.message}` : ''}`,
  )
  // Nur bei der Vorgabe weiss die Probe, wer oben stehen muss.
  if (begriff === 'Mond') sagen(werke[0]?.titel === 'Mond', `erster Treffer: „${werke[0]?.titel}"`)
  else hinweis(`erster Treffer: „${werke[0]?.titel}"`)
  const uebersichten = werke.filter((w) => /bersicht|Staaten der Erde/.test(w.titel))
  sagen(uebersichten.length === 0, `keine Uebersichtsseite unter den Treffern (${uebersichten.map((w) => w.titel)})`)
  const v = werke[0]?.vorschlag
  sagen(
    v?.type === 'plugin' && v?.id === `mixpi-klexikon:${werke[0]?.kennung}` && v?.artist === 'Klexikon',
    `Vorschlag: ${JSON.stringify(v)}`,
  )
  sagen(
    werke.every((w) => w.hinweis && !/[<>]/.test(w.hinweis)),
    `Fundstellen ohne HTML: „${werke[0]?.hinweis?.slice(0, 70)}"`,
  )

  /* ── 3. Deutschland ───────────────────────────────────────────────────── */
  console.log('\n3. inhalt „Deutschland"')
  const vorD = gesprochen.length
  const d = await ruf('inhalt Deutschland', () => kx.inhalt('Deutschland', kontext))
  const texteD = gesprochen.slice(vorD)
  const folgenD = d.wert?.folgen ?? []
  sagen(folgenD.length >= 3, `${folgenD.length} Folgen (${d.ms} ms)${d.fehler ? ` — ${d.fehler.message}` : ''}`)
  for (const f of folgenD) console.log(`          ${f.kennung}`)
  sagen(folgenD[0]?.name === 'Deutschland', `erste Folge heisst wie der Artikel: „${folgenD[0]?.name}"`)
  // DER NAME TRAEGT DEN ARTIKEL: sonst findet die gemerkte Stelle ueber den
  // Namen „Wie sieht das Land aus?" auch im Artikel von morgen wieder.
  sagen(
    folgenD.slice(1).every((f) => f.name.startsWith('Deutschland: ')),
    `Abschnittsnamen tragen den Artikel: „${folgenD[1]?.name}"`,
  )
  sagen(
    texteD.slice(1).every((t, i) => t.startsWith(folgenD[i + 1]?.name.slice('Deutschland: '.length))),
    'gesprochen wird die Ueberschrift ohne den Artikel davor',
  )
  sagen(
    new Set(folgenD.map((f) => f.kennung)).size === folgenD.length && folgenD.every((f) => f.kennung),
    'jede Folge traegt eine eigene Kennung',
  )
  const reste = texteD.filter((t) => /==|⇒|\[\[|\{\{|<\/?[a-z]/i.test(t))
  sagen(reste.length === 0, `keine Markup-Reste im Vorlesetext${reste.length ? `: ${reste[0].slice(0, 80)}` : ''}`)
  const mitLizenz = texteD.map((t, i) => (t.includes(LIZENZ_SATZ) ? i : -1)).filter((i) => i >= 0)
  sagen(
    mitLizenz.length === 1 && mitLizenz[0] === texteD.length - 1,
    `Lizenzsatz nur an der letzten Folge (${mitLizenz.join(', ')} von ${texteD.length})`,
  )

  /* ── 4. Hund → Hunde ──────────────────────────────────────────────────── */
  console.log('\n4. inhalt „Hund" (Weiterleitung)')
  const h = await ruf('inhalt Hund', () => kx.inhalt('Hund', kontext))
  sagen(
    h.wert?.titel === 'Hunde' && (h.wert?.folgen?.length ?? 0) >= 1,
    `„Hund" -> „${h.wert?.titel}", ${h.wert?.folgen?.length} Folgen (${h.ms} ms)${h.fehler ? ` — ${h.fehler.message}` : ''}`,
  )

  /* ── 5. Wissen des Tages ──────────────────────────────────────────────── */
  console.log('\n5. inhalt „heute"')
  zwischenspeicherLeeren()
  const kalt = await ruf('heute kalt', () => kx.inhalt('heute', kontext))
  const warm = await ruf('heute warm', () => kx.inhalt('heute', kontext))
  sagen(
    Boolean(kalt.wert?.folgen?.length),
    `kalt: „${kalt.wert?.folgen?.[0]?.name}", ${kalt.anfragen} Anfragen, ${kalt.ms} ms` +
      `${kalt.fehler ? ` — ${kalt.fehler.message}` : ''}`,
  )
  sagen(
    JSON.stringify(kalt.wert) === JSON.stringify(warm.wert),
    `zweimal gefragt, Zeichen fuer Zeichen dieselbe Liste (warm: ${warm.anfragen} Anfragen, ${warm.ms} ms)`,
  )
  // NEUSTART NACHSTELLEN: der Worker vergisst, der Datenordner bleibt.
  zwischenspeicherLeeren()
  const neu = await ruf('heute nach Neustart', () => kx.inhalt('heute', kontext))
  sagen(
    neu.anfragen === 1 && JSON.stringify(neu.wert) === JSON.stringify(kalt.wert),
    `nach Neustart aus dem Datenordner: ${neu.anfragen} Anfrage(n), dieselbe Liste (${neu.ms} ms)`,
  )

  /* ── 6. Rest ──────────────────────────────────────────────────────────── */
  console.log('\n6. aufloesen, Bild, befinden, aktion')
  const a = await ruf('aufloesen', () => kx.aufloesen('Deutschland#1', kontext))
  sagen(
    a.wert?.titel?.name === folgenD[1]?.name && a.wert?.quelle?.adresse === folgenD[1]?.quelle?.adresse,
    `Deutschland#1 -> „${a.wert?.titel?.name}"`,
  )
  // Das Bild kann fehlen (Kopf von index.mjs, Messung 7) — das erste, das da ist.
  const bild = [...folgenD, ...(h.wert?.folgen ?? [])].find((f) => f.bild)?.bild
  if (bild) {
    const b = await fetch(bild, { signal: AbortSignal.timeout(15000) }).catch((f) => ({ ok: false, status: f.message }))
    sagen(
      b.ok && /^image\//.test(b.headers?.get('content-type') ?? ''),
      `Vorschaubild laedt: ${b.status} ${bild.slice(0, 70)}…`,
    )
  } else {
    hinweis('weder „Deutschland" noch „Hunde" mit Vorschaubild — nichts zu laden')
  }
  const bef = await ruf('befinden', () => kx.befinden(kontext))
  sagen(bef.wert?.ok === true, `befinden: ${bef.wert?.text}`)
  const ohne = await kx.befinden(kontextBauen({ mitStimme: false }))
  sagen(ohne.ok === false && /Piper/.test(ohne.text), `befinden ohne Stimme: ${ohne.text}`)
  const akt = await ruf('aktion pruefen', () => kx.aktion('pruefen', kontext))
  sagen(akt.wert?.ok === true, `aktion pruefen: ${akt.wert?.text}`)

  /* ── Vorlage ──────────────────────────────────────────────────────────── */
  if (erneuern) {
    const kuerzen = (auszug) =>
      String(auszug ?? '')
        .split('\n')
        // „Im 19. Jahrhundert" ist kein Satzende — dieselbe Regel wie
        // `stueckeBilden` in sprechstrom.ts: nicht hinter einer Ziffer.
        .map((z) => (/^\s*==|^\s*⇒|^\s*$/.test(z) ? z : (z.match(/^.*?(?<!\d)[.!?](?=\s+[A-ZÄÖÜ„"]|$)/)?.[0] ?? z)))
        .join('\n')
    const volltext = (titel) =>
      roh({
        action: 'query',
        prop: 'extracts|pageimages',
        explaintext: '1',
        exsectionformat: 'wiki',
        piprop: 'thumbnail',
        pithumbsize: '400',
        redirects: '1',
        titles: titel,
      })
    const [deutschland, hund, sucheMond] = await Promise.all([
      volltext('Deutschland'),
      volltext('Hund'),
      roh({
        action: 'query',
        list: 'search',
        srsearch: 'Mond',
        srnamespace: '0',
        srlimit: '8',
        srprop: 'snippet',
        generator: 'search',
        gsrsearch: 'Mond',
        gsrnamespace: '0',
        gsrlimit: '8',
        prop: 'pageimages|categories',
        piprop: 'thumbnail',
        pithumbsize: '400',
        pilimit: 'max',
        clcategories: 'Kategorie:Klexikon-Artikel',
        cllimit: 'max',
      }),
    ])
    for (const a of [deutschland, hund]) for (const s of a.query.pages) s.extract = kuerzen(s.extract)
    const vorlage = {
      _quelle:
        'https://klexikon.zum.de/api.php — Texte aus dem Klexikon (CC BY-SA), GEKUERZT auf den ersten Satz je Absatz',
      _abgerufen: new Date().toISOString(),
      _erneuern: 'node tools/klexikon-probe.mjs --vorlage-erneuern',
      deutschland,
      hund,
      sucheMond,
    }
    writeFileSync(VORLAGE, `${JSON.stringify(vorlage, null, 2)}\n`)
    // IN DER FORM DES BAUMS ablegen — sonst meldet `biome check` die frisch
    // erneuerte Vorlage als Fehler, und wer sie committet, formatiert von Hand.
    try {
      execFileSync('npx', ['biome', 'format', '--write', VORLAGE], { cwd: WURZEL, stdio: 'ignore' })
    } catch {
      hinweis(`biome lief nicht — von Hand: npx biome format --write ${path.relative(WURZEL, VORLAGE)}`)
    }
    hinweis(`Vorlage neu geschrieben: ${path.relative(WURZEL, VORLAGE)} — jetzt node --test fahren`)
  }
} finally {
  rmSync(ordner, { recursive: true, force: true })
}

const zeichen = gesprochen.reduce((n, t) => n + t.length, 0)
console.log(
  `\nBILANZ: ${gut} ok, ${fehler} FEHL — ${gesprochen.length} Texte, ${zeichen} Zeichen gesprochen — ` +
    `laengster Ruf ${laengster.ms} ms (${laengster.was}) gegen die Frist von ${FRIST_MS} ms` +
    `${laengster.ms > FRIST_MS ? ' — RISSE SIE' : ''}`,
)
process.exit(fehler === 0 && laengster.ms <= FRIST_MS ? 0 : 1)
