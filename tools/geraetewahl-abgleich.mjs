#!/usr/bin/env node
/**
 * WOZU
 *   Stellt nebeneinander, was ueber DIESELBE Geraeteliste entschieden wird:
 *     * Spotifys Geraeteliste, wie die Box sie sieht
 *       (GET /api/spotify/web/me/player/devices)
 *     * den Boxnamen aus der Konfiguration (GET /api/config, `mupibox.host`) —
 *       derselbe Wert ist LIBRESPOT_NAME und damit der Connect-Geraetename
 *     * das Urteil des Waechters vor dem Abspielen (GET /api/spotify/bereit)
 *
 *   DIE FRAGE, DIE ES BEANTWORTET: Heisst das librespot-Geraet noch so wie die
 *   Box? `mupibox.host` bedient DREI Dinge zugleich (Anzeigename,
 *   LIBRESPOT_NAME, Systemhostname), und librespot liest den Namen NUR BEIM
 *   START. Wer ihn in der Verwaltung aendert, ohne librespot neu zu starten,
 *   hat eine Box, die unter dem ALTEN Namen bei Spotify steht. Bis zum
 *   02.08.2026 verbot der Waechter dann jeden Spotify-Start, obwohl der
 *   Abspieldienst gespielt haette.
 *
 *   KEINE ZWEITE WAHRHEIT: Die Regel selbst steht in `geraetWaehlen`
 *   (src/backend-api/src/spotify-web.ts) und wird von BEIDEN Seiten gefragt —
 *   vom Waechter und vom Abspieldienst (`geraetAufloesen`). Dieses Werkzeug
 *   rechnet sie NICHT nach. Es zeigt die Eingaben und das Urteil der Box; wer
 *   hier eine eigene Regel einbaute, haette am Ende eine dritte Meinung.
 *
 * WAS ES AENDERT
 *   NICHTS. Drei lesende GET-Abrufe. Es spielt nichts ab, uebernimmt keine
 *   Wiedergabe, schreibt keine Datei.
 *
 * AUFRUF
 *   node tools/geraetewahl-abgleich.mjs
 *   node tools/geraetewahl-abgleich.mjs --box 192.168.178.169:8200
 *   node tools/geraetewahl-abgleich.mjs --pruefen   # Rueckgabe 1, wenn der Name auseinanderlaeuft
 */

const BOX_VORGABE = '192.168.178.169:8200'

function argument(name, ersatz = null) {
  const i = process.argv.indexOf(name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : ersatz
}
const nurPruefen = process.argv.includes('--pruefen')
const box = argument('--box', BOX_VORGABE)

/** Ein GET mit Frist — eine Box, die im Regal steht, antwortet gar nicht. */
async function holen(pfad) {
  const steuerung = new AbortController()
  const frist = setTimeout(() => steuerung.abort(), 8000)
  try {
    const a = await fetch(`http://${box}${pfad}`, { signal: steuerung.signal })
    if (!a.ok) return { fehler: `HTTP ${a.status}` }
    return { wert: await a.json() }
  } catch (e) {
    return { fehler: e?.name === 'AbortError' ? 'keine Antwort (8 s)' : String(e?.message || e) }
  } finally {
    clearTimeout(frist)
  }
}

const [geraeteA, konfigA, urteilA] = await Promise.all([
  holen('/api/spotify/web/me/player/devices'),
  holen('/api/config'),
  holen('/api/spotify/bereit'),
])

console.log(`Box: ${box}`)

if (konfigA.fehler) console.log(`\nBoxname: nicht lesbar (${konfigA.fehler})`)
else console.log(`\nBoxname (mupibox.host = LIBRESPOT_NAME): "${konfigA.wert?.mupibox?.host ?? ''}"`)
const name = konfigA.wert?.mupibox?.host ?? ''

console.log('\nSpotifys Geraeteliste:')
let trefferGenau = false
let anzahl = 0
if (geraeteA.fehler) {
  console.log(`  nicht lesbar (${geraeteA.fehler}) — das ist KEINE Auskunft, weder gut noch schlecht`)
} else {
  const liste = geraeteA.wert?.devices ?? []
  anzahl = liste.length
  if (!liste.length) console.log('  (leer) — librespot ist bei Spotify nicht angemeldet')
  for (const g of liste) {
    const passt = g?.name === name
    if (passt) trefferGenau = true
    console.log(
      `  ${passt ? '=' : ' '} "${g?.name ?? ''}"  ${g?.type ?? '?'}  ${g?.is_active ? 'aktiv' : 'still'}  id=${g?.id ?? '(keine)'}`,
    )
  }
}

console.log('\nUrteil der Box (GET /api/spotify/bereit):')
if (urteilA.fehler) console.log(`  nicht lesbar (${urteilA.fehler})`)
else console.log(`  ${JSON.stringify(urteilA.wert)}`)

// DIE EINE ZEILE, WEGEN DER ES DIESES WERKZEUG GIBT.
let auseinander = false
if (!geraeteA.fehler && !konfigA.fehler && name && anzahl > 0 && !trefferGenau) {
  auseinander = true
  console.log(
    `\nNAME LAEUFT AUSEINANDER: kein Geraet heisst "${name}". Typisch nach einer` +
      '\n  Umbenennung ohne librespot-Neustart. Bei EINEM Geraet spielt die Box' +
      '\n  trotzdem (Ersatz), bei mehreren wird nicht geraten — dann hilft nur:' +
      '\n  librespot neu starten (auf der Box, nicht von hier).',
  )
} else if (trefferGenau) {
  console.log(`\nNAME STIMMT: das librespot-Geraet heisst wie die Box.`)
}

if (nurPruefen && auseinander) process.exit(1)
