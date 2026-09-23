#!/usr/bin/env node
/*
 * WIRD FUER DIESEN DIENST UEBERHAUPT EINE STELLE GESCHRIEBEN — UND WAS STEHT DRIN?
 *
 * WOZU
 *   Drei Fragen vom 06.08.2026, alle nur AM GERAET zu beantworten:
 *
 *   A) JELLYFIN: Kommt beim Anspielen eines Jellyfin-Albums ein Eintrag in
 *      resume.json? Welche Felder? Stimmt die Titelnummer mit der Position
 *      im Album?
 *   B) ARD: Aendert sich `currentTracknr` beim Uebergang von Folge zu Folge
 *      VON SELBST? Davon haengt ab, ob das Folgen-Cover ueber die POSITION
 *      nachgeschlagen werden kann.
 *   C) Traegt eine Spotify- oder Jellyfin-Stelle einen TITELNAMEN — und wenn
 *      nein, wo liegt einer herum?
 *
 * WARUM NICHT „einmal curl und fertig"
 *   Der Server (8200) und der Abspieldienst (5005) antworten auf JEDEN Pfad
 *   mit 200, der Abspieldienst sogar mit application/json
 *   ([[server-antwortet-200-auf-alles]]). Gemessen wird deshalb ausschliesslich
 *   ueber die WIRKUNG: `/player/local` vorher/nachher und der INHALT von
 *   resume.json — nicht ueber Statuscodes.
 *
 * WAS ES AN DER BOX AENDERT
 *   Es startet und haelt an. Am Ende steht IMMER ein `stop` (finally).
 *
 *   RESUME.JSON: Der Jellyfin-Lauf setzt die Merkmeldung WIRKLICH ab — anders
 *   ist die Frage „kommt ein Eintrag?" nicht zu beantworten. Sie kann bei
 *   Jellyfin aber nichts anrichten: `POST /api/weiterhoeren` entscheidet VOR
 *   dem Schreibblock (`if (!stelle) return res.json({status:'nichtMerkbar'})`),
 *   und dass wirklich nichts geschrieben wurde, PRUEFT dieses Werkzeug nach —
 *   es liest /api/resume vorher und nachher und vergleicht Zeichen fuer
 *   Zeichen. Sollte doch etwas geschrieben worden sein, ist genau DAS der
 *   Befund und steht in der Ausgabe.
 *   Der ARD-Lauf meldet gar nichts; er liest nur mit.
 *
 * AUFRUF
 *   node tools/stelle-je-dienst-am-geraet.mjs --box 192.168.178.169 --lage
 *       nur lesen: Was liegt in resume.json, was meldet /player/local
 *
 *   node tools/stelle-je-dienst-am-geraet.mjs --box … --jellyfin
 *       Frage A: Jellyfin-Album anspielen, auf Titel 2 springen, messen
 *
 *   node tools/stelle-je-dienst-am-geraet.mjs --box … --ard --ab-ende 20
 *       Frage B: ARD-Sendung anspielen, 20 s vor Folgenende einsteigen und
 *       ueber den Uebergang hinweg `currentTracknr` mitschreiben
 *
 *   --merken     die POST-Meldung wirklich absetzen (schreibt resume.json)
 *   --sekunden N wie lange gemessen wird (Vorgabe 20)
 */

const argv = process.argv.slice(2)
const opt = (name, vorgabe = null) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return vorgabe
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const hat = (name) => argv.includes(`--${name}`)

const BOX = String(opt('box', '192.168.178.169'))
const API = `http://${BOX}:8200/api`
const SPIELER = `http://${BOX}:8200/player`
const RAUM = 'current'
const SEKUNDEN = Number(opt('sekunden', 20)) || 20

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms))

async function json(url, opts) {
  const a = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, ...opts })
  const text = await a.text()
  const typ = a.headers.get('content-type') || ''
  // DER CONTENT-TYPE IST DIE AUSKUNFT, NICHT DER CODE. text/html heisst
  // „SPA-Rueckfallseite", also: den Endpunkt gibt es auf DIESER Box nicht.
  if (!typ.includes('json')) throw new Error(`${url} -> ${a.status} ${typ} (${text.length} B) — kein JSON`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${url} -> unlesbares JSON: ${text.slice(0, 120)}`)
  }
}

const befehl = (pfad) =>
  fetch(`${SPIELER}/${RAUM}/${pfad}`, { cache: 'no-store', headers: { accept: 'application/json' } }).catch(() => null)

const lokal = () => json(`${SPIELER}/local`).catch(() => null)
const dienst = () => json(`${SPIELER}/state`).catch(() => null)

/** Die Felder, auf die es hier ankommt — kurz genug fuer eine Zeile. */
function zeile(lo) {
  if (!lo) return '(keine Antwort)'
  return [
    `player=${lo.currentPlayer || '-'}`,
    `typ=${lo.currentType || '-'}`,
    `nr=${lo.currentTracknr === '' ? '""' : lo.currentTracknr}`,
    `von=${lo.totalTracks === '' ? '""' : lo.totalTracks}`,
    `t=${lo.timePos == null ? '-' : Number(lo.timePos).toFixed(1)}`,
    `dauer=${lo.duration == null ? '-' : Number(lo.duration).toFixed(1)}`,
    `%=${lo.progressTime == null ? '-' : Number(lo.progressTime).toFixed(2)}`,
    `name=${JSON.stringify(lo.currentTrackname || '')}`,
    `album=${JSON.stringify(lo.album || '')}`,
  ].join('  ')
}

async function resumeLesen() {
  // Ueber /api/resume, damit kein SSH noetig ist. Fehlt der Endpunkt auf
  // dieser Box, sagt json() es ueber den Content-Type.
  return json(`${API}/resume`)
}

/*
 * VERSCHMELZEN GEHOERT MITGEMESSEN, und es war beim ersten Anlauf am
 * 06.08.2026 der Unterschied zwischen zwei entgegengesetzten Befunden.
 * OHNE `verschmelzen=1` fuehrt das Raster vier Kacheln (zweimal HAMM,
 * zweimal „Die Zukunft wird gross"), jede mit EINER Quelle. MIT bleiben zwei
 * uebrig — und WELCHE Kennung dann fuehrt, ist je Werk verschieden:
 *   HAMM                  -> jellyfin:7d9a…   (Jellyfin fuehrt)
 *   Die Zukunft wird gross-> spotify:0Pyu…    (Spotify fuehrt, Jellyfin spielt)
 * Der Schluessel der Kachel ist genau das, was `merkStand()` meldet — an ihm
 * haengt, welchen `type` der Server in resume.json schreibt. Wer hier mit 0
 * misst, misst eine Anordnung, die das Kind nie sieht.
 */
const VERSCHMELZEN = hat('unverschmolzen') ? 0 : 1

async function werke() {
  const d = await json(`${API}/werke?verschmelzen=${VERSCHMELZEN}`)
  return Array.isArray(d?.werke) ? d.werke : []
}

async function inhalt(schluessel, wunschDienst = null) {
  const q = wunschDienst ? `&quelle=${encodeURIComponent(wunschDienst)}` : ''
  return json(`${API}/werke/${encodeURIComponent(schluessel)}/inhalt?verschmelzen=${VERSCHMELZEN}${q}`)
}

/** Genau der Koerper, den `merkStand()` in NewDesign/app.js baut. */
function merkKoerper(schluessel, lo) {
  return {
    schluessel,
    titelNr: Number(lo?.currentTracknr) || 0,
    titelUri: '',
    gesamt: Number(lo?.totalTracks) || 0,
    bisher: Math.max(0, Number(lo?.timePos) || 0),
    dauer: Number(lo?.duration) || 0,
  }
}

async function melden(koerper) {
  const a = await fetch(`${API}/weiterhoeren`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(koerper),
  })
  const t = await a.text()
  return { code: a.status, typ: a.headers.get('content-type') || '', text: t }
}

// ── A: JELLYFIN ────────────────────────────────────────────────────────────
async function frageJellyfin() {
  const liste = await werke()
  const jf = liste.filter((w) => (w.quellen || []).some((q) => q.dienst === 'jellyfin'))
  console.log(`Jellyfin-Werke im Raster (verschmelzen=${VERSCHMELZEN}): ${jf.length}`)
  for (const w of jf) {
    const qs = (w.quellen || []).map((q) => q.dienst)
    console.log(`  ${w.schluessel}\n      „${w.titel}" (${w.interpret})  quellen=${qs.join('+')}  fuehrend=${qs[0]}  schluesselDienst=${w.schluessel.split(':')[0]}`)
  }
  if (!jf.length) return

  // WELCHE KACHEL: die mit `--titel <teil>` gewaehlte, sonst die erste. Die
  // beiden auf dieser Box unterscheiden sich in genau dem Punkt, um den es
  // geht (fuehrende Kennung), und deshalb muss man beide einzeln stellen
  // koennen.
  const wunsch = String(opt('titel', '') || '').toLowerCase()
  const w = wunsch ? jf.find((x) => String(x.titel).toLowerCase().includes(wunsch)) || jf[0] : jf[0]
  const d = await inhalt(w.schluessel)
  const titel = (d.titel || []).filter((t) => t.befehl)
  console.log(`\n„${w.titel}": ${titel.length} Titel, Dienst laut /inhalt = ${d.dienst}`)
  console.log(`  Titel 1 = „${titel[0]?.titel}"   Titel 2 = „${titel[1]?.titel}"`)

  console.log('\nVORHER:')
  console.log('  ' + zeile(await lokal()))

  await befehl('stop')
  await schlaf(500)
  await befehl(titel[0].befehl)
  // Nur die ersten paar anhaengen — fuer „Titel 2" reicht das, und es sind
  // weniger Anfragen auf einem Pi.
  for (const t of titel.slice(1, 4)) await befehl(t.anhaengen)
  await schlaf(2500)
  console.log('  nach Start:      ' + zeile(await lokal()))

  await befehl('tracknr:2')
  await schlaf(2500)
  const lo = await lokal()
  console.log('  nach tracknr:2:  ' + zeile(lo))

  // Ein paar Sekunden laufen lassen, damit `bisher` nicht 0 ist.
  await schlaf(Math.max(3000, SEKUNDEN * 1000))
  const lo2 = await lokal()
  console.log(`  nach ${Math.round(Math.max(3, SEKUNDEN))} s:      ` + zeile(lo2))

  const koerper = merkKoerper(w.schluessel, lo2)
  console.log('\nWAS DIE OBERFLAECHE MELDEN WUERDE (merkStand):')
  console.log('  ' + JSON.stringify(koerper))
  console.log(`  Titel-2-Probe: currentTracknr=${lo2?.currentTracknr}  erwartet 2  ->  ${Number(lo2?.currentTracknr) === 2 ? 'STIMMT' : 'WEICHT AB'}`)
  console.log(`  Titelname in /player/local: ${JSON.stringify(lo2?.currentTrackname || '')}  (erwartet „${titel[1]?.titel}")`)

  const vorher = await resumeLesen()
  const antwort = await melden(koerper)
  console.log(`\nPOST /api/weiterhoeren -> ${antwort.code} ${antwort.typ}`)
  console.log('  ' + antwort.text.slice(0, 300))
  const nachher = await resumeLesen()
  const gleich = JSON.stringify(vorher) === JSON.stringify(nachher)
  console.log(`  resume.json ${gleich ? 'UNVERAENDERT' : 'VERAENDERT'} (${vorher.length} -> ${nachher.length} Eintraege)`)
  const treffer = nachher.filter((e) => String(e.type || '').startsWith('jellyfin'))
  console.log(`  Eintraege mit type jellyfin*: ${treffer.length}`)
  if (treffer.length) console.log('  ' + JSON.stringify(treffer, null, 2))
  // Und die Zeile zu GENAU DIESEM Werk — sie kann unter einem anderen `type`
  // stehen als dem der spielenden Maschine, und das ist der eigentliche Punkt.
  const zeigen = (liste, wie) => {
    const e = liste.find((x) => String(x.title || '') === String(w.titel))
    console.log(`  ${wie}: ` + (e ? JSON.stringify(e) : '(keine Zeile fuer dieses Werk)'))
  }
  zeigen(vorher, 'vorher ')
  zeigen(nachher, 'nachher')
  const w2 = await json(`${API}/weiterhoeren`).catch(() => null)
  const inReihe = (w2?.weiter || []).find((z) => String(z.titel) === String(w.titel))
  console.log(`  in der Weiterhoeren-Reihe: ` + (inReihe ? JSON.stringify(inReihe) : 'NEIN'))
}

// ── B: ARD ────────────────────────────────────────────────────────────────
/*
 * DERSELBE UEBERGANG, ZWEI DIENSTE — und deshalb steht er in EINER Funktion.
 * Die ARD-Folgen sind alle 3606 s lang (Nennlaenge, gemessen 04.08.2026); ob
 * `duration` beim Uebergang stehenbleibt oder nur zufaellig gleich ist, laesst
 * sich an ihnen gar nicht entscheiden. An einem Jellyfin-Album mit
 * verschieden langen Titeln schon. Wer nur die ARD misst, kann den
 * Unterschied nicht sehen.
 */
async function frageUebergang(dienstName = 'ard') {
  const liste = await werke()
  const ard = liste.filter((w) => (w.quellen || []).some((q) => q.dienst === dienstName))
  if (!ard.length) return console.log(`Kein Werk mit Quelle „${dienstName}" im Raster.`)
  const wunsch = String(opt('titel', '') || '').toLowerCase()
  const w = wunsch ? ard.find((x) => String(x.titel).toLowerCase().includes(wunsch)) || ard[0] : ard[0]
  const d = await inhalt(w.schluessel)
  const titel = (d.titel || []).filter((t) => t.befehl)
  console.log(`${dienstName} „${w.titel}": ${titel.length} Folgen/Titel`)
  console.log(`  1 = „${titel[0]?.titel}" (${Math.round((titel[0]?.dauerMs || 0) / 1000)} s laut /inhalt)`)
  console.log(`  2 = „${titel[1]?.titel}" (${Math.round((titel[1]?.dauerMs || 0) / 1000)} s laut /inhalt)`)

  await befehl('stop')
  await schlaf(500)
  await befehl(titel[0].befehl)
  for (const t of titel.slice(1, 3)) await befehl(t.anhaengen)
  await schlaf(3000)
  let lo = await lokal()
  console.log('\n  nach Start:  ' + zeile(lo))

  // KURZ VOR SCHLUSS EINSTEIGEN. Die Nennlaenge aus /inhalt taugt dafuer
  // NICHT (an der Maus-Sendung gemessen: alle 30 Folgen 3606000 ms — eine
  // Nennlaenge, keine echte). Gesprungen wird deshalb ueber PROZENT, und die
  // echte Laenge steht in `duration` von /player/local.
  const abEnde = Number(opt('ab-ende', 20)) || 20
  const echt = Number(lo?.duration) || 0
  if (!echt) {
    console.log('  KEINE DAUER GEMELDET — der Sprung ans Ende ist damit nicht stellbar.')
    return
  }
  const ziel = Math.max(0, ((echt - abEnde) / echt) * 100)
  console.log(`  echte Dauer laut mpv: ${echt.toFixed(1)} s  -> seekpos:${ziel.toFixed(2)} (${abEnde} s vor Schluss)`)
  await befehl(`seekpos:${ziel.toFixed(2)}`)

  // NACH DEM UEBERGANG WEITERMESSEN, und das ist keine Bequemlichkeit: beim
  // ersten Anlauf (06.08.2026) endete die Schleife ZWEI Sekunden nach dem
  // Wechsel. `currentTracknr` war da schon auf 2, `currentTrackname` und
  // `duration` standen noch auf der alten Folge — und ob das ein NACHLAUF von
  // Sekunden oder ein DAUERZUSTAND ist, entscheidet die ganze Frage. Eine
  // Messung, die genau am interessanten Punkt aufhoert, beweist nichts.
  const nachlauf = Number(opt('nachlauf', 60)) || 60
  // GROSSZUEGIG WARTEN. `seekpos:` landet auf dieser Box messbar frueher als
  // gerechnet (06.08.2026: Ziel 3566 s, erste Ablesung 3534 s — rund eine
  // halbe Minute davor). Zweimal lief die Schleife deshalb ab, BEVOR der
  // Uebergang kam, und eine Messung, die vor dem Messgegenstand endet, ist
  // keine. Die Obergrenze ist nur die Notbremse; ausgestiegen wird ueber
  // `wechselUm`.
  const bis = Date.now() + (abEnde + 120) * 1000
  let letzteNr = null
  let wechselUm = 0
  for (;;) {
    // Zwei Abbruchgruende, und sie duerfen sich nicht ins Gehege kommen:
    // NACH dem Wechsel zaehlt nur noch der Nachlauf, VOR ihm nur die
    // Notbremse.
    if (wechselUm ? Date.now() - wechselUm > nachlauf * 1000 : Date.now() > bis) break
    lo = await lokal()
    const nr = lo?.currentTracknr
    if (String(nr) !== String(letzteNr)) {
      if (letzteNr !== null) wechselUm = Date.now()
      console.log(`  [${new Date().toLocaleTimeString()}] WECHSEL nr ${letzteNr} -> ${nr}`)
      letzteNr = nr
    }
    const seit = wechselUm ? ` (+${Math.round((Date.now() - wechselUm) / 1000)}s)` : ''
    console.log(`  [${new Date().toLocaleTimeString()}]${seit} ` + zeile(lo))
    await schlaf(2000)
  }
}

// ── C: WAS LIEGT AN NAMEN HERUM ───────────────────────────────────────────
async function frageLage() {
  const r = await resumeLesen()
  console.log(`resume.json: ${r.length} Eintraege`)
  for (const e of r) {
    const felder = Object.keys(e).filter((k) => k.startsWith('resume'))
    console.log(`  type=${e.type}  title=${JSON.stringify(e.title)}  artist=${JSON.stringify(e.artist)}`)
    console.log(`      ${felder.map((k) => `${k}=${JSON.stringify(e[k])}`).join('  ')}`)
  }
  console.log('\n/player/local:')
  console.log('  ' + zeile(await lokal()))
  const sp = await dienst()
  console.log('\n/player/state (Auszug):')
  console.log(`  is_playing=${sp?.is_playing}  item.name=${JSON.stringify(sp?.item?.name || '')}  track_number=${sp?.item?.track_number}  uri=${sp?.item?.uri || ''}`)
  console.log(`  context.uri=${sp?.context?.uri || ''}`)
}

async function main() {
  try {
    if (hat('lage')) await frageLage()
    if (hat('jellyfin')) await frageJellyfin()
    if (hat('ard')) await frageUebergang('ard')
    if (hat('uebergang')) await frageUebergang(String(opt('uebergang', 'jellyfin')))
    if (!hat('lage') && !hat('jellyfin') && !hat('ard') && !hat('uebergang')) await frageLage()
  } finally {
    await befehl('stop')
    console.log('\n(angehalten)')
  }
}

main().catch((e) => {
  console.error('FEHLER:', e.message)
  process.exit(1)
})
