#!/usr/bin/env -S npx tsx
/**
 * DER PLUGIN-PRUEFSTAND (E77) — ein Plugin pruefen, OHNE Box und OHNE Server.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 *
 * Betreiber, 22.08.2026: „eine anleitung fuer plugins verfassen wie auch eine
 * testumgebung". Das hier ist die Testumgebung: ein Fremdentwickler (oder wir)
 * richtet ein Plugin-Verzeichnis und bekommt in Sekunden das Urteil, das sonst
 * erst das Laden auf der Box faellt — Manifest, Icon, Methodenformen, und auf
 * Wunsch echte Laeufe gegen das Netz.
 *
 * DER VERTRAG WIRD NICHT NACHGEBAUT, SONDERN IMPORTIERT: `manifestPruefen`
 * ist exakt die Funktion, die auch der Wirt ruft. Ein Pruefstand mit eigener
 * Kopie der Regeln segnete Manifeste ab, die die Box dann abweist — die
 * Ausfallart „zwei Wahrheiten" in ihrer reinsten Form. (Deshalb laeuft dieses
 * Werkzeug unter tsx, siehe erste Zeile: die Vertragsdatei ist TypeScript.)
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *
 *   npx tsx tools/mixpi-plugin-pruefstand.mjs plugins/mixpi-ardsounds
 *   npx tsx tools/mixpi-plugin-pruefstand.mjs plugins/x --ohne-netz
 *   npx tsx tools/mixpi-plugin-pruefstand.mjs plugins/x --http kategorien
 *   npx tsx tools/mixpi-plugin-pruefstand.mjs plugins/x --aufloesen "https://…"
 *
 * Ohne Schalter laufen Manifest, Icon und `befinden`; jede angemeldete Aktion
 * wird gerufen. `--ohne-netz` ersetzt `holen` durch eine Attrappe, die wirft —
 * damit prueft man, ob ein Plugin den Netzausfall in WORTE fasst statt zu
 * sterben. ENDE 0, wenn alles haelt.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { einstellungenNormalisieren, manifestPruefen } from '../src/backend-api/src/plugin-vertrag'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const ORDNER = argv.find((a) => !a.startsWith('--'))
const wert = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
if (!ORDNER) {
  console.error('Aufruf: npx tsx tools/mixpi-plugin-pruefstand.mjs <plugin-ordner> [--ohne-netz] [--http PFAD] [--inhalt REST] [--aufloesen REST] [--suchen BEGRIFF]')
  process.exit(2)
}
const ordner = path.resolve(process.cwd(), ORDNER)

let fehler = 0
const sagen = (gut, was, befund) => {
  if (!gut) fehler++
  console.log(`${gut ? '  ok  ' : ' FEHL '} ${was}${befund ? `\n         ${befund}` : ''}`)
}

// ── 1. Das Manifest — durch den ECHTEN Vertrag ─────────────────────────────
let manifest = null
try {
  const roh = JSON.parse(readFileSync(path.join(ordner, 'plugin.json'), 'utf8'))
  const urteil = manifestPruefen(roh)
  if (urteil.ok) {
    manifest = urteil.manifest
    sagen(true, `Manifest: ${manifest.kennung} ${manifest.fassung}`,
      `Rechte: ${manifest.rechte.join(', ') || 'keine'}` +
      (manifest.sektion ? ` · Sektion: ${manifest.sektion}` : '') +
      (manifest.aktionen.length ? ` · Aktionen: ${manifest.aktionen.map((a) => a.kennung).join(', ')}` : ''))
    const basis = path.basename(ordner)
    if (basis !== manifest.kennung)
      sagen(false, 'Ordnername == Kennung?', `Ordner heisst "${basis}" — der Wirt verlangt "${manifest.kennung}".`)
  } else {
    sagen(false, 'Manifest', urteil.maengel.join(' | '))
  }
} catch (f) {
  sagen(false, 'plugin.json lesen', f.message)
}

// ── 2. Das Icon — Datei da und als Bild lesbar ─────────────────────────────
if (manifest?.icon) {
  try {
    const inhalt = readFileSync(path.join(ordner, manifest.icon))
    const svg = manifest.icon.endsWith('.svg')
    const gut = svg ? inhalt.toString('utf8').includes('<svg') : inhalt.subarray(1, 4).toString() === 'PNG'
    sagen(gut, `Icon ${manifest.icon}`, gut ? `${inhalt.length} B` : 'Datei traegt nicht die erwartete Form')
  } catch (f) {
    sagen(false, `Icon ${manifest.icon}`, f.message)
  }
}

// ── 3. Das Plugin laden und die Methoden pruefen ───────────────────────────
if (manifest) {
  const datenOrdner = mkdtempSync(path.join(tmpdir(), 'pruefstand-'))
  const protokolle = []
  const ohneNetz = argv.includes('--ohne-netz')
  /** Der Kontext — dieselben Felder, die das Laufwerk baut, als Attrappe. */
  const kontext = {
    protokoll: (t) => protokolle.push(String(t)),
    einstellungen: Object.freeze(einstellungenNormalisieren({}, manifest.felder)),
    datenOrdner,
  }
  if (manifest.rechte.includes('netz')) {
    kontext.holen = ohneNetz
      ? async () => {
          throw new Error('kein Netz (Pruefstand, --ohne-netz)')
        }
      : (adresse, gaben) => fetch(adresse, { ...gaben, signal: AbortSignal.timeout(8000) })
  }
  if (manifest.rechte.includes('geraetestand')) {
    // DIESELBEN REZEPTE WIE IM LAUFWERK — der Pruefstand laeuft unter tsx
    // und darf das Kern-Modul direkt ziehen. Auf dem Entwicklerrechner
    // antworten die Rezepte ehrlich (kein soloist-Binary -> ok:false,
    // keine Unit -> Wort statt Wurf); am Geraet messen sie echt.
    const { geraetBauen } = await import('../src/backend-api/src/plugin-geraet.ts')
    kontext.geraet = geraetBauen()
  }

  try {
    const modul = await import(pathToFileURL(path.join(ordner, manifest.haupt)).href)
    const plugin = modul.default ?? modul
    const kann = ['aufloesen', 'suchen', 'inhalt', 'befinden', 'ereignis', 'klangkette', 'aktion', 'http']
      .filter((m) => typeof plugin[m] === 'function')
    sagen(kann.length > 0, `laedt, kann: ${kann.join(', ') || 'nichts'}`)

    if (manifest.aktionen.length && !kann.includes('aktion'))
      sagen(false, 'Aktionen angemeldet, aber keine aktion()-Methode', 'die Knoepfe liefen ins Leere')
    if (manifest.sektion && !kann.includes('befinden'))
      sagen(false, 'Sektion ohne befinden()', 'die Steckleiste zeigt sonst nur den Namen — ein Satz gehoert dazu')

    if (kann.includes('befinden')) {
      const b = await plugin.befinden(kontext)
      sagen(typeof b?.ok === 'boolean', 'befinden()', `ok=${b?.ok} — ${b?.text ?? '(ohne Text)'}`)
    }
    for (const a of manifest.aktionen) {
      if (!kann.includes('aktion')) break
      const e = await plugin.aktion(a.kennung, kontext)
      sagen(typeof e?.ok === 'boolean', `aktion(${a.kennung})`, `ok=${e?.ok} — ${e?.text ?? '(ohne Text)'}`)
    }
    const httpPfad = wert('--http')
    if (httpPfad && kann.includes('http')) {
      // `pfad?a=b` wird getrennt wie in der echten Route: der Query-Teil
      // reist in `abfrage`, nie im Pfad — beim ersten Lauf steckte er im
      // Pfad, und das Plugin meldete voellig zu Recht 404.
      const [reinerPfad, query] = httpPfad.split('?', 2)
      const abfrage = Object.fromEntries(new URLSearchParams(query ?? ''))
      const antwort = await plugin.http({ methode: 'GET', pfad: reinerPfad, abfrage, rumpf: null }, kontext)
      const status = antwort?.status ?? 200
      sagen(status >= 200 && status < 500 && antwort && 'inhalt' in antwort, `http(${httpPfad})`,
        `Status ${status}, ${JSON.stringify(antwort?.inhalt).slice(0, 160)}`)
    }
    const rest = wert('--aufloesen')
    if (rest && kann.includes('aufloesen')) {
      const fund = await plugin.aufloesen(rest, kontext)
      sagen(Boolean(fund?.titel?.name && fund?.quelle?.adresse), `aufloesen(${rest.slice(0, 40)}…)`,
        `${fund?.titel?.name ?? '?'} -> ${String(fund?.quelle?.adresse ?? '?').slice(0, 60)}`)
    }
    const inhaltRest = wert('--inhalt')
    if (inhaltRest && kann.includes('inhalt')) {
      const inhalt = await plugin.inhalt(inhaltRest, kontext)
      const n = Array.isArray(inhalt?.folgen) ? inhalt.folgen.length : -1
      sagen(n >= 0 && typeof inhalt?.titel === 'string', `inhalt(${inhaltRest})`,
        `"${inhalt?.titel}", ${n} Folgen, vollstaendig=${inhalt?.vollstaendig}` +
        (n > 0 ? ` — 1. ${inhalt.folgen[0].name} (${inhalt.folgen[0].kennung})` : ''))
    }
    const begriff = wert('--suchen')
    if (begriff && kann.includes('suchen')) {
      const treffer = await plugin.suchen(begriff, kontext)
      sagen(Array.isArray(treffer), `suchen(${begriff})`, `${Array.isArray(treffer) ? treffer.length : '?'} Treffer`)
    }
  } catch (f) {
    sagen(false, 'Laden/Rufen', f.message)
  } finally {
    rmSync(datenOrdner, { recursive: true, force: true })
  }
  if (protokolle.length) console.log(`         Protokoll des Plugins: ${protokolle.join(' | ').slice(0, 300)}`)
}

console.log(fehler === 0 ? '\nHAELT.' : `\nNICHT IN ORDNUNG: ${fehler} Befund(e).`)
process.exit(fehler === 0 ? 0 : 1)
