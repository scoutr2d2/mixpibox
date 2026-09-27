#!/usr/bin/env node
/**
 * WIE SCHNELL SPRICHT DIE BOX WIRKLICH? — am Geraet gemessen, nicht geschaetzt.
 *
 * WOZU: Die neue Oberflaeche soll sprechen (Auftrag 04.08.2026). Ob das
 * bedienbar ist, entscheidet EINE Zahl: wie lange zwischen dem Tipp und dem
 * ersten Ton vergeht. Das Wissenspaket nennt fuer den warmen Piper-Dienst
 * 0,17-0,30 s — ABER nur fuer `-low`-Stimmen. Auf DIESER Box steht
 * `de_DE-thorsten-high` bei Tempo 2 eingestellt, und dafuer nennt
 * [mupi-vorlesen-schnell] rund 6 s je neuem Satz. Wer das nicht nachmisst,
 * baut eine Funktion, die im Test gut aussieht und am Geraet ein Kind
 * sechs Sekunden warten laesst.
 *
 * WAS GEMESSEN WIRD (drei Zahlen, und alle drei sind noetig):
 *   1. KALT   — ein Satz, den es im Zwischenspeicher noch nicht gibt. Das ist
 *               der schlechteste Fall und der einzige, den ein Kind bei einer
 *               frisch angelegten Kachel erlebt.
 *   2. WARM   — ein ZWEITER neuer Satz gleich danach. Jetzt laeuft der
 *               Piper-Dienst schon; der Unterschied zu (1) ist die Zeit, die
 *               das Laden des Sprachmodells kostet.
 *   3. NOCHMAL— derselbe Satz wie (1). Er kommt aus dem Zwischenspeicher; das
 *               ist der Normalfall, denn dieselbe Kachel wird immer wieder
 *               angetippt.
 *
 * WAS DIESES WERKZEUG AN DER BOX AENDERT: Es legt WAV-Dateien im
 * Zwischenspeicher an (~/.mupibox/vorlesen-cache) und startet dabei den
 * Piper-Dienst, falls er noch nicht laeuft. Beides ist der NORMALE Betrieb der
 * Box, keine Umstellung — die Einstellungen (`config/vorlesen.json`) werden
 * NICHT angefasst. Die Saetze tragen einen Zeitstempel, damit sie nicht mit
 * echten Titeln kollidieren; sie bleiben als ein paar Kilobyte liegen.
 *
 * NICHT GEMESSEN WIRD DIE LAUTSTAERKE. Dafuer muesste die Box wirklich toenen,
 * und sie steht nachts im Kinderzimmer. Die WAV-Groesse sagt immerhin, dass
 * etwas Gesprochenes zurueckkam und keine Fehlermeldung
 * (llmwiki: „eine 153-Byte-Antwort ist keine Sprache, sondern ein Fehler").
 *
 * AUFRUF
 *   node tools/vorlesen-am-geraet.mjs
 *   node tools/vorlesen-am-geraet.mjs --box 192.168.178.169:8200
 *   node tools/vorlesen-am-geraet.mjs --pruefen    # Rueckgabewert 1 bei Abweichung
 *
 * Ist die Box nicht erreichbar, endet der Lauf mit 0 und einer Zeile — dieses
 * Werkzeug darf einen Gesamtlauf am Schreibtisch nicht rot faerben.
 */

const argv = process.argv.slice(2)
const PRUEFEN = argv.includes('--pruefen')
const BOX = (() => {
  const i = argv.indexOf('--box')
  if (i >= 0 && argv[i + 1]) return argv[i + 1]
  return process.env.MUPIBOX_BOX || '192.168.178.169:8200'
})()
const WURZEL = BOX.startsWith('http') ? BOX : `http://${BOX}`

/**
 * Ab wann ist es zu langsam?
 *
 * 4000 ms ist KEIN geratener Wert: genau so lange wartet der Vorlese-Zaun in
 * der klassischen Oberflaeche (`WARTE_MAX_MS` in vorlese.service.ts) und in
 * der neuen (`VL_WARTE_MAX_MS`). Braucht die Synthese laenger, laeuft die
 * Musik los, BEVOR der Satz da ist — die Ansage kommt dann mitten hinein oder
 * gar nicht. Das ist die Grenze, an der die Funktion aufhoert zu funktionieren.
 */
const ZAUN_MS = 4000

let fehler = 0
const sagen = (gut, text) => {
  console.log(`  ${gut ? '✓' : '✗'} ${text}`)
  if (!gut) fehler++
}

async function hol(pfad, ms = 60_000) {
  const abbruch = AbortSignal.timeout(ms)
  const t0 = Date.now()
  const a = await fetch(`${WURZEL}${pfad}`, { signal: abbruch, headers: { accept: '*/*' } })
  const roh = Buffer.from(await a.arrayBuffer())
  return { ms: Date.now() - t0, status: a.status, bytes: roh.length, typ: a.headers.get('content-type') || '' }
}

try {
  // Erreichbar? Und was ist eingestellt?
  const e = await fetch(`${WURZEL}/api/vorlesen`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json())
    .catch(() => null)
  if (!e) {
    console.log(`Box ${BOX} antwortet nicht — uebersprungen.`)
    process.exit(0)
  }

  const ein = e.einstellungen || {}
  console.log(`Box ${BOX}`)
  console.log(`  Modus    ${ein.modus}`)
  console.log(`  Stimme   ${ein.stimme}   Tempo ${ein.tempo}   Interpret ${ein.interpret}`)
  console.log(`  Piper    ${e.bereit ? 'da' : 'FEHLT'}   Stimmen: ${(e.stimmen || []).length}`)
  console.log()

  sagen(!!e.bereit, 'Piper ist auf der Box installiert (`bereit`)')
  sagen((e.stimmen || []).length > 0, 'mindestens eine Stimme liegt auf der Box')

  // Ein Satz, den es sicher noch nicht gibt.
  const marke = new Date().toISOString().slice(11, 19).replace(/:/g, '')
  const eins = `Prüfsatz eins ${marke}`
  const zwei = `Prüfsatz zwei ${marke}`
  const enc = encodeURIComponent

  console.log('Messung (Zeit bis die WAV-Datei vollstaendig da ist):')
  const kalt = await hol(`/api/vorlesen/sprich?text=${enc(eins)}`)
  console.log(`  1. kalt      ${String(kalt.ms).padStart(6)} ms   ${kalt.bytes} B   ${kalt.typ}`)
  const warm = await hol(`/api/vorlesen/sprich?text=${enc(zwei)}`)
  console.log(`  2. warm      ${String(warm.ms).padStart(6)} ms   ${warm.bytes} B`)
  const nochmal = await hol(`/api/vorlesen/sprich?text=${enc(eins)}`)
  console.log(`  3. nochmal   ${String(nochmal.ms).padStart(6)} ms   ${nochmal.bytes} B   (Zwischenspeicher)`)
  console.log()

  // 44 Byte ist ein leerer WAV-Kopf; alles darunter kann keine Sprache sein.
  sagen(kalt.status === 200 && kalt.bytes > 1000, 'der erste Satz kam als hoerbare WAV-Datei zurueck')
  sagen(nochmal.bytes === kalt.bytes, 'derselbe Satz liefert dieselbe Datei (der Zwischenspeicher greift)')
  sagen(nochmal.ms < 200, `aus dem Zwischenspeicher unter 200 ms (gemessen: ${nochmal.ms} ms)`)

  // DIE EIGENTLICHE FRAGE. Sie darf rot werden — dann ist die eingestellte
  // Stimme fuer die Box zu teuer, und das ist ein Befund, kein Programmfehler.
  sagen(
    warm.ms < ZAUN_MS,
    `ein NEUER Satz kommt bei warmem Dienst unter ${ZAUN_MS} ms (dem Zaun der Oberflaeche) — gemessen: ${warm.ms} ms`,
  )
  if (warm.ms >= ZAUN_MS) {
    console.log(`    -> Bei „${ein.stimme}" mit Tempo ${ein.tempo} laeuft die Musik los, bevor der Satz da ist.`)
    console.log('       Eine `-low`-Stimme ist auf diesem Pi rund siebenmal schneller (llmwiki mupi-vorlesen-schnell).')
  }

  // Silben — der Lernmodus haengt daran.
  const s = await fetch(`${WURZEL}/api/vorlesen/silben?text=${enc('Pummeleinhorn')}`, {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json())
  console.log(`\nSilben: „Pummeleinhorn" -> „${s.silben}"`)
  sagen(typeof s.silben === 'string' && s.silben.includes('-'), '/api/vorlesen/silben trennt')

  // ── DIE ZWEITE HAELFTE DES SPRECHWEGS ──────────────────────────────────
  //
  // Ein Satz, der die Musik nicht zuruecktreten laesst, geht darin unter. Die
  // REGEL, was gedaempft wird (alles ausser der Sprache), steht in
  // daempfen.ts und ist dort geprueft — was hier gemessen wird, ist etwas
  // anderes: ob der Endpunkt auf DIESER Box ueberhaupt antwortet. Er ruft
  // `pactl` auf, und das ist eine Voraussetzung, die kein Test am
  // Schreibtisch stellen kann.
  //
  // WAS DABEI AN DER BOX PASSIERT: Laeuft nichts, findet `zuDaempfen` keinen
  // Strom und es wird gar nichts angefasst. Laeuft etwas, wird es fuer den
  // Augenblick zwischen den beiden Aufrufen leiser — und das `aus` steht in
  // einem `finally`, nicht in der Absicht: bricht die Messung dazwischen ab,
  // bliebe die Box sonst leise zurueck, und niemand wuesste warum.
  console.log('\nDaempfung (/api/ton/daempfen) — der zweite Teil des Sprechwegs:')
  const daempfen = (an) =>
    fetch(`${WURZEL}/api/ton/daempfen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ an }),
      signal: AbortSignal.timeout(8000),
    }).then((r) => r.json())
  let d1 = null
  try {
    d1 = await daempfen(true)
    console.log(`  an  -> ${JSON.stringify(d1)}`)
  } finally {
    const d2 = await daempfen(false).catch((e) => ({ fehler: String(e) }))
    console.log(`  aus -> ${JSON.stringify(d2)}`)
    sagen(!!d2 && d2.gedaempft === 0, 'nach dem `aus` ist kein Strom mehr gedaempft (die Box bleibt nicht leise)')
  }
  sagen(!!d1 && d1.status === 'ok', 'der Endpunkt antwortet (pactl ist auf dieser Box erreichbar)')
  if (d1 && d1.gedaempft === 0) {
    console.log('    (kein Tonstrom offen — dass NICHTS gedaempft wurde, ist hier richtig, nicht auffaellig)')
  }

  console.log(`\n${fehler ? `${fehler} Abweichung(en)` : 'keine Abweichung'}`)
} catch (err) {
  console.error('FEHLER:', err.message)
  fehler++
}

process.exit(PRUEFEN && fehler ? 1 : 0)
