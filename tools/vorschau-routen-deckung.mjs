#!/usr/bin/env node
/**
 * JEDE ROUTE, DIE DIE OBERFLAECHE LIEST, MUSS DIE VORSCHAU AUCH BEANTWORTEN.
 *
 * ══ DER BEFUND, DER DIESE WACHE AUSGELOEST HAT (19.09.2026) ═══════════════
 *
 * `tools/neu-vorschau.mjs` kannte weder `/api/eingabegeraete` noch
 * `/api/fernbedienung/anweisung`. Beide gibt es im echten Server, und
 * NewDesign/app.js ruft beide — die zweite IM TAKT.
 *
 * WAS DAS KOSTETE: kein Kind hat je etwas gemerkt (beide Aufrufer fangen den
 * Fehler ab und zeigen dann eben kein Zeichen). Aber jede Messung mit
 * Browser gegen die Vorschau schleppte einen Strom von 404-Meldungen mit —
 * 203 Stueck in EINEM Lauf von tools/rueckweg-nachlese.mjs. Und deren Zweck
 * ist es, eine stille Ausnahme zu finden, die im 250-ms-Takt liefe. Genau
 * die waere in diesem Rauschen untergegangen. Eine dauerrote Wache ist
 * keine, und eine Wache, die im Rauschen steht, ist noch weniger.
 *
 * ══ WARUM DIE WACHE MISST UND NICHT LIEST ════════════════════════════════
 *
 * Man koennte in `neu-vorschau.mjs` nach `'/api/eingabegeraete'` suchen. Das
 * waere eine Textsuche auf eine SCHREIBWEISE: sie uebersaehe jeden Zweig,
 * der den Pfad aus Teilen zusammensetzt oder mit `startsWith` faengt, und
 * sie waere gruen fuer eine Zeile in einem Kommentar
 * [[kommentar-und-kompilat-sind-keine-gegenstelle]]. Diese Wache startet
 * deshalb eine EIGENE Vorschau auf einem freien Port und FRAGT sie. Was
 * antwortet, ist gedeckt; was 404 sagt, ist eine Luecke.
 *
 * EIGENER PORT UND NICHT 8299: die laufende Vorschau gehoert womoeglich
 * einem anderen Arbeitsbaum, und dann maesse diese Wache dessen Stand
 * [[vorschau-wird-geliehen]]. Ausserdem soll sie den Baum messen, in dem sie
 * liegt — auch wenn gerade gar keine Vorschau laeuft.
 *
 * ══ WELCHE ROUTEN GEMEINT SIND ═══════════════════════════════════════════
 *
 * Die LESENDEN. `json(pfad)` in app.js ist der GET-Helfer — er nimmt keine
 * Methode entgegen, also ist jeder seiner Aufrufe ein GET. Genau diese
 * Sorte erzeugt das Rauschen, denn sie laeuft beim Aufbau und im Takt.
 * Aendernde Wege (POST/PUT/DELETE) gehen einen anderen Helfer und werden
 * hier bewusst NICHT blind angefragt: ein `POST /api/reboot` zur Pruefung
 * abzusetzen waere eine Wache, die Schaden anrichtet.
 *
 * Pfade mit Platzhalter (`werke/${...}/inhalt`) werden nicht geraten,
 * sondern aus den Antworten DERSELBEN Vorschau gefuellt: `/api/werke`
 * liefert echte Schluessel, `/api/werke/<s>/alben` echte Album-Kennungen.
 * Gelingt das nicht, bricht die Wache MIT ANLEITUNG ab statt still zu
 * ueberspringen — ein uebersprungener Pfad ist eine Luecke, die niemand
 * sieht.
 *
 * AUFRUF
 *     node tools/vorschau-routen-deckung.mjs
 *     node tools/vorschau-routen-deckung.mjs --pruefen
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(WURZEL, 'NewDesign', 'app.js')
const VORSCHAU = path.join(WURZEL, 'tools', 'neu-vorschau.mjs')
const PRUEFEN = process.argv.includes('--pruefen')

function abbruch(text) {
  console.error(`\nABBRUCH: ${text}\n`)
  process.exit(2)
}

for (const [datei, name] of [
  [APP, 'NewDesign/app.js'],
  [VORSCHAU, 'tools/neu-vorschau.mjs'],
]) {
  if (!fs.existsSync(datei)) {
    abbruch(
      `${name} gibt es nicht mehr.\n` +
        `  Diese Wache vergleicht die LESENDEN Routen der Oberflaeche mit dem,\n` +
        `  was die Vorschau beantwortet. Ist eine der beiden Seiten umgezogen,\n` +
        `  gehoert der Pfad hier oben nachgezogen — NICHT die Wache entfernt.`,
    )
  }
}

// ── 1. WELCHE ROUTEN LIEST DIE OBERFLAECHE ────────────────────────────────
//
// `json(`${API}/…`)` — der GET-Helfer. Die Klammer direkt hinter `json` ist
// Teil des Musters: sie unterscheidet den AUFRUF von einer Erwaehnung in
// Prosa, und genau daran ist heute schon eine andere Wache gescheitert
// [[prosa-ist-kein-ruf]].
//
// GELESEN WERDEN ALLE .js-DATEIEN DER OBERFLAECHE, nicht nur app.js. Am
// 20.09.2026 kamen die Belohnungs-Videos in einer EIGENEN Datei
// (NewDesign/video.js) — app.js lag bei 99 % ihres Deckels. Die Wache haette
// deren drei Routen nicht gesehen und waere still gruen geblieben: genau die
// Sorte Luecke, gegen die sie gebaut ist. Sie fragt deshalb nach der SORTE
// (jede .js der Oberflaeche) und nicht nach einem Pfad.
const quellen = fs
  .readdirSync(path.join(WURZEL, 'NewDesign'))
  .filter((n) => n.endsWith('.js'))
  .map((n) => fs.readFileSync(path.join(WURZEL, 'NewDesign', n), 'utf8'))
const quelle = fs.readFileSync(APP, 'utf8')
const roh = quellen.flatMap((q) => [...q.matchAll(/json\(`\$\{API\}\/([^`]*)`/g)].map((m) => m[1]))
if (roh.length === 0) {
  abbruch(
    `in NewDesign/app.js findet sich kein einziger json(\`\${API}/…\`)-Aufruf.\n` +
      `  Entweder heisst der GET-Helfer nicht mehr json(), oder die Basis nicht\n` +
      `  mehr API. Ohne Fundstellen waere diese Wache STILL GRUEN — deshalb\n` +
      `  bricht sie hier ab. Muster in dieser Datei nachziehen.`,
  )
}

/** Ohne Abfrageteil: die ROUTE ist der Pfad, nicht seine Parameter. */
const pfade = [...new Set(roh.map((p) => p.split('?')[0]))].sort()

// ── 2. EIGENE VORSCHAU AUF EINEM FREIEN PORT ──────────────────────────────
const port = await new Promise((fertig, schief) => {
  const s = net.createServer()
  s.on('error', schief)
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port
    s.close(() => fertig(p))
  })
})

const kind = spawn(process.execPath, [VORSCHAU, '--port', String(port)], {
  cwd: WURZEL,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let vorschauAus = ''
kind.stdout.on('data', (d) => (vorschauAus += d))
kind.stderr.on('data', (d) => (vorschauAus += d))

function beenden() {
  if (!kind.killed) kind.kill('SIGTERM')
}
process.on('exit', beenden)
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { beenden(); process.exit(130) })

const BASIS = `http://127.0.0.1:${port}`
let bereit = false
for (let i = 0; i < 60; i++) {
  try {
    const a = await fetch(`${BASIS}/neu/`, { signal: AbortSignal.timeout(1000) })
    if (a.ok) { bereit = true; break }
  } catch {
    /* noch nicht oben */
  }
  await new Promise((f) => setTimeout(f, 250))
}
if (!bereit) {
  beenden()
  abbruch(`die eigene Vorschau auf Port ${port} kam nicht hoch.\n  Ausgabe:\n${vorschauAus.slice(-800)}`)
}

// ── 3. PLATZHALTER MIT ECHTEN WERTEN FUELLEN ──────────────────────────────
//
// Geraten wird nichts: die Werte kommen aus DERSELBEN Vorschau. Ein
// erfundener Schluessel bekaeme womoeglich zu Recht eine 404 — und dann
// meldete die Wache eine Luecke, die keine ist.
async function holen(pfad) {
  const a = await fetch(`${BASIS}/api/${pfad}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  return { stand: a.status, rumpf: a.ok ? await a.json().catch(() => null) : null }
}

const werkeAus = await holen('werke')
const werke = Array.isArray(werkeAus.rumpf?.werke) ? werkeAus.rumpf.werke : []
if (werke.length === 0) {
  beenden()
  abbruch(
    `/api/werke der eigenen Vorschau liefert keine Werke (HTTP ${werkeAus.stand}).\n` +
      `  Daraus holt diese Wache die echten Schluessel fuer die Pfade mit\n` +
      `  Platzhalter. Ohne sie koennte sie diese Pfade nur ueberspringen, und\n` +
      `  ein uebersprungener Pfad ist eine Luecke, die niemand sieht.`,
  )
}
const einSchluessel = werke[0].schluessel
const spotifyWerk = werke.find((w) => w.dienst === 'spotify') ?? werke[0]
const albenAus = await holen(`werke/${encodeURIComponent(spotifyWerk.schluessel)}/alben`)
const eineAlbumKennung = albenAus.rumpf?.alben?.[0]?.kennung
if (!eineAlbumKennung) {
  beenden()
  abbruch(
    `aus /api/werke/<schluessel>/alben kommt keine Album-Kennung (HTTP ${albenAus.stand}).\n` +
      `  Sie wird fuer spotify/album/<kennung> gebraucht. Form der Antwort\n` +
      `  geaendert? Dann hier nachziehen.`,
  )
}

/** Ein Pfad mit Platzhalter wird zu einem Pfad mit ECHTEM Wert. */
function fuellen(pfad) {
  if (!pfad.includes('${')) return pfad
  if (/^werke\/\$\{[^}]*\}\//.test(pfad)) {
    return pfad.replace(/\$\{[^}]*\}/, encodeURIComponent(einSchluessel))
  }
  if (/^spotify\/album\/\$\{[^}]*\}$/.test(pfad)) {
    return `spotify/album/${encodeURIComponent(eineAlbumKennung)}`
  }
  return null
}

// ── 4. FRAGEN ─────────────────────────────────────────────────────────────
const luecken = []
const ungedeckt = []
const gut = []
for (const pfad of pfade) {
  const echt = fuellen(pfad)
  if (echt === null) {
    // KEIN STILLES UEBERSPRINGEN: ein Platzhalter, den diese Wache nicht
    // fuellen kann, ist ihr eigener blinder Fleck und gehoert gemeldet.
    ungedeckt.push(pfad)
    continue
  }
  const { stand } = await holen(echt)
  if (stand === 404) luecken.push({ pfad, echt })
  else gut.push({ pfad, stand })
}

beenden()

console.log('\n══ WAS DIE OBERFLAECHE LIEST UND DIE VORSCHAU BEANTWORTET\n')
for (const g of gut) console.log(`  ok    /api/${g.pfad}  (HTTP ${g.stand})`)
for (const l of luecken) console.log(`  LUECKE /api/${l.pfad}  -> 404 (gefragt: /api/${l.echt})`)
for (const u of ungedeckt) console.log(`  UNGEDECKT /api/${u}  (Platzhalter nicht fuellbar)`)

console.log(`\n  ${pfade.length} lesende Routen, ${gut.length} gedeckt, ${luecken.length} Luecke(n), ${ungedeckt.length} ungedeckt.`)

if (luecken.length) {
  console.log(`
  SO WIRD ES GERICHTET: in tools/neu-vorschau.mjs einen Zweig anlegen, der
  den Pfad beantwortet — in der Form, die der echte Server liefert
  (src/backend-api/src/server.ts). Die Vorschau ist die Gegenstelle fuer
  JEDE Browser-Messung dieses Baums; was sie nicht kennt, rauscht in jeder
  einzelnen mit.`)
}
if (ungedeckt.length) {
  console.log(`
  UND DIE UNGEDECKTEN: fuer diese Pfade weiss die Wache keinen echten Wert.
  In \`fuellen()\` eine Regel ergaenzen, die den Wert aus einer Antwort der
  Vorschau holt — nicht einen erfinden.`)
}

if (PRUEFEN && (luecken.length || ungedeckt.length)) process.exit(1)
process.exit(0)
