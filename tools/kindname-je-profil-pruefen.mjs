#!/usr/bin/env node
/**
 * GILT DER NAME DES KINDES WIRKLICH JE PROFIL?
 *
 * ══ WOZU ══════════════════════════════════════════════════════════════════
 * Dass `profile.json` ein Feld `name` je Eintrag HAT, beweist gar nichts. Die
 * drei Arten, auf die genau diese Aussage sonst kippt:
 *   1. Das Feld steht da, aber NIEMAND LIEST es (reine Definition).
 *   2. Es ist profilbewusst gebaut, aber die AUSGELIEFERTE Oberflaeche bietet
 *      keinen Weg dorthin — dann hat der Betreiber es nicht.
 *   3. Es liegt in Wahrheit im localStorage, gilt also je BROWSER und wandert
 *      beim Profilwechsel gar nicht mit.
 * Dieses Werkzeug misst gegen alle drei — und zwar an dem, was AUF DER BOX
 * liegt (www/neu/app.js, www/neu/index.html), nicht an dem, was im Arbeitsbaum
 * steht. Die beiden laufen regelmaessig auseinander.
 *
 * ══ WAS ES AENDERT ════════════════════════════════════════════════════════
 * NICHTS. Ausschliesslich GET. Kein POST, kein PUT, keine Datei auf der Box.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *   node tools/kindname-je-profil-pruefen.mjs
 *   node tools/kindname-je-profil-pruefen.mjs --box 192.168.178.169 --port 8200
 */
const argv = process.argv.slice(2)
const opt = (n, v) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const BOX = opt('box', '192.168.178.169')
const PORT = opt('port', '8200')
const URL = `http://${BOX}:${PORT}`

let fehl = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehl++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '\n        ' + wie : ''}`)
}

const holen = async (weg, roh = false) => {
  const a = await fetch(URL + weg)
  if (!a.ok) throw new Error(`${weg} -> HTTP ${a.status}`)
  return roh ? a.text() : a.json()
}

console.log(`Box ${URL}\n`)

// ── 1. DIE ABLAGE: steht der Name wirklich JE EINTRAG? ─────────────────────
const stand = await holen('/api/profile')
const namen = stand.profile.map((p) => `${p.kennung}=${JSON.stringify(p.name)}`)
console.log('Profile:', namen.join('  '), ' · dran:', stand.aktiv, '\n')
ja(stand.profile.length >= 2, 'mehr als ein Profil vorhanden (sonst ist „je Profil" unbeobachtbar)')
ja(
  stand.profile.every((p) => typeof p.name === 'string' && p.name.length > 0),
  'jeder Eintrag traegt einen eigenen `name`',
)
ja(
  new Set(stand.profile.map((p) => p.name)).size === stand.profile.length,
  'die Namen sind untereinander verschieden — kein gemeinsamer Wert',
)
ja(
  stand.profile.some((p) => p.name !== p.kennung),
  'mindestens ein Name ist NICHT bloss die Kennung (also wirklich gepflegt)',
  stand.profile.map((p) => `${p.kennung} -> ${p.name}`).join(', '),
)

// ── 2. LIEGT ES AUF DEM SERVER ODER IM BROWSER? ────────────────────────────
const app = await holen('/neu/app.js', true)
const html = await holen('/neu/index.html', true)
const lsNamen = [...app.matchAll(/localStorage\.(?:get|set)Item\(([^,)]{0,60})/g)].map((m) => m[1].trim())
ja(
  // `name(…)`, `alterName(…)` und `speicherName(…)` sind die FORMEL fuer den
  // Namensraum (`mupibox_p_<kennung>_<schluessel>`) — kein gespeicherter Name.
  !lsNamen.some((s) => /name/i.test(s) && !/(^|[^A-Za-z])(alterName|speicherName|name)\(/.test(s)),
  'kein Namensschluessel im localStorage — der Name kommt vom Server, nicht aus dem Browser',
  'localStorage-Schluessel: ' + [...new Set(lsNamen)].join(' | '),
)

// ── 3. WELCHE OBERFLAECHE STEHT UEBERHAUPT AUF DEM SCHIRM? ─────────────────
const konf = await holen('/api/konfiguration')
const ober = konf.felder.find((f) => f.id === 'oberflaeche')
ja(
  ober && ober.wert === 'neu',
  'der Kiosk startet die NEUE Oberflaeche — nur sie kennt Profile',
  `mupibox.oberflaeche = ${ober && ober.wert}`,
)

// ── 4. DIE ZWEI WEGE — AM AUSGELIEFERTEN STAND, NICHT IM ARBEITSBAUM ───────
ja(/id="ich-umbenennen"/.test(html), 'Fenster „wer hoert": der Knopf „Namen aendern" STEHT in der ausgelieferten index.html')
ja(
  /\$\('ich-umbenennen'\)\.addEventListener\('click'[\s\S]{0,1600}?ich\.nameTippen\(\)/.test(app),
  '… und app.js haengt ihn an `ich.nameTippen()`',
)
ja(/nameTippen\(\)\s*\{[\s\S]{0,900}?frage: 'Wie heißt du\?'/.test(app), '… `nameTippen` oeffnet die Tastatur mit „Wie heißt du?"')
ja(
  /name: 'Name',[\s\S]{0,200}?this\.kindNameTippen\(p\.kennung\)/.test(app),
  'Eltern-Bereich > Kinder > <Kind>: die Zeile „Name" ruft `kindNameTippen(kennung)`',
)
ja(/\{ id: 'kinder', gruppe: 'system'/.test(app), '… und die Seite „Kinder" ist in der Gruppe „System" registriert (erreichbar)')
ja(
  /async umbenennen\(kennung, name\)[\s\S]{0,700}?\/profil\/name[\s\S]{0,700}?listeSchreiben/.test(app),
  'beide Wege schreiben durch DIESELBE Funktion `kinder.umbenennen` (POST fuers aktive Kind, sonst PUT)',
)

// ── 5. DIE LESER — wer zeigt den Namen ueberhaupt an? ──────────────────────
const leser = [
  ["ich-ueber-du („Du bist …“)", /ich-ueber-du'\)\.textContent = selbst \? 'Du bist ' \+ \(selbst\.name/],
  ['Kachelreihe „Wer hoert?"', /ichKachel\(ichBildPfad\(p\.figur, profil\.ordner\), p\.name \|\| p\.kennung/],
  ['Bildueberschrift „Bild fuer <Kind>"', /`Bild für \$\{wer\.name \|\| wer\.kennung\}`/],
  ['Vorlesetext des Zeichens oben links', /const name = \(wer && wer\.name\) \|\| 'niemand'/],
  ['Kinder-Liste im Eltern-Bereich', /name: p\.name \|\| p\.kennung,/],
  ['Unterzeile der Uebersicht „Kinder"', /andere\.map\(\(p\) => p\.name \|\| p\.kennung\)\.join\(' · '\)/],
]
for (const [was, muster] of leser) ja(muster.test(app), `gelesen wird der Name in: ${was}`)

// ── 6. DER SERVER: nimmt der schmale Weg wirklich KEINE Kennung? ───────────
ja(
  /\/profil\/name`, \{[\s\S]{0,200}?JSON\.stringify\(\{ name: sauber \}\)/.test(app),
  'POST /api/profil/name schickt NUR den Namen — welcher Eintrag, sagt der Server (aktives Profil)',
)

console.log(`\n${fehl ? fehl + ' Aussage(n) FEHLGESCHLAGEN' : 'alle Aussagen halten'}`)
process.exit(fehl ? 1 : 0)
