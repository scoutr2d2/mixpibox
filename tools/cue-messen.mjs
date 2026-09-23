#!/usr/bin/env node
/**
 * CUE-MESSEN — den Spotify-Zweig im PipeWire-Graphen ZEIGEN, und auf Wunsch
 * den Gerätebeweis für das Cue erbringen (BACKLOG E114).
 *
 * ══ WOZU ════════════════════════════════════════════════════════════════════
 *
 * `src/backend-player/src/tonpfad.ts` weiss, WELCHE Kante der Spotify-Ton ist,
 * und `cue-schalter.ts` kann sie trennen und zurückverbinden. Beides ist gegen
 * eine Vorlage geprüft — und beides hat AM TON noch nie stattgefunden. Dieses
 * Werkzeug ist die Messung, die das nachholt:
 *
 *     Pegel vorher  →  Link trennen  →  Pegel  →  zurückverbinden  →  Pegel
 *
 * Fällt der mittlere Pegel auf ~0 und kommt der letzte zurück, ist bewiesen,
 * was bisher nur plausibel war. Bleibt der mittlere Pegel stehen, war die
 * getrennte Kante die falsche — und das will man wissen, BEVOR ein Dienst sie
 * im Betrieb trennt.
 *
 * ══ OHNE `--probe` WIRD NUR GELESEN ═════════════════════════════════════════
 *
 * Der Vorgabelauf ruft `pw-dump` und druckt. Er fasst nichts an. Erst
 * `--probe` trennt wirklich — und das ist eine Handlung am laufenden Ton
 * einer Box, an der jemand Musik hört. Die Trennung dauert etwa eine Sekunde
 * und wird IMMER zurückgenommen (siehe „Rückverbinde-Zwang" unten).
 *
 * ══ AUFRUF ══════════════════════════════════════════════════════════════════
 *
 *     node tools/cue-messen.mjs                  # lesen: Kartierung + Plan
 *     node tools/cue-messen.mjs --json           # dasselbe, maschinenlesbar
 *     node tools/cue-messen.mjs --dump datei     # eine GESPEICHERTE Ausgabe
 *     node tools/cue-messen.mjs --probe          # der Gerätebeweis (schaltet!)
 *
 * `--dump` liest eine abgelegte `pw-dump`-Ausgabe statt einer frischen. Damit
 * läuft das Werkzeug auch fern der Box — und, wichtiger, gegen dieselbe
 * Vorlage, gegen die die Spec des Abspieldiensts misst:
 *
 *     node tools/cue-messen.mjs --dump src/backend-player/src/tonpfad.fixture.json
 *
 * ══ WARUM DIE AUSWAHL HIER EIN ZWEITES MAL STEHT ════════════════════════════
 *
 * Die Regeln (Klasse `Stream/Output/Audio`, drei Namensplätze, Kanten zur
 * Senke) stehen auch in `tonpfad.ts`. Das ist eine bewusste Doppelung, keine
 * Nachlässigkeit: auf der Box liegt vom Abspieldienst nur das gebündelte
 * `spotify-control.js`, keine TypeScript-Quelle und kein `tsx`. Ein Werkzeug,
 * das sich dort nicht starten lässt, erbringt keinen Gerätebeweis.
 *
 * Damit die Doppelung nicht auseinanderläuft, gibt es die GEMEINSAME VORLAGE:
 * `src/backend-player/src/tonpfad.fixture.json` ist die Vorlage der Spec UND
 * eine gültige Eingabe für `--dump`. Beide Seiten müssen dafür dieselbe Zeile
 * drucken (`planBeschreiben` dort, `planBeschreiben` hier). Wer eine Seite
 * ändert, prüft es mit einem Aufruf.
 */
import { execFile, execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

// ─────────────────────────────────────────────────────────────────────────
// Die Auswahl — wortgleich zu src/backend-player/src/tonpfad.ts
// ─────────────────────────────────────────────────────────────────────────

const EINSPEISE_KLASSE = 'Stream/Output/Audio'
const SPOTIFY_NAMEN = ['spotify', 'librespot', 'soloist']
const KLANGWERK_SENKE = 'klangwerk'
/** Die Frist des Rückverbinde-Zwangs, gleich der in cue-schalter.ts. */
const FRIST_MS = 5000
/**
 * Wie lange je Pegelmessung mitgehört wird.
 *
 * 3 s, und das ist am Gerät bezahlt: Mit 1200 ms lieferte `parec` GAR NICHTS
 * (Puffer < 2 Byte -> Pegel `null` -> die Probe druckte `?` und urteilte
 * „Cue wirkt: NEIN"), weil das Werkzeug erst anlaufen muss. Das Wiki nennt
 * für genau diese Messung ~3 s ([dienste-umschalten]: „Kürzere Scheiben
 * (<1 s) liefern nichts").
 *
 * Die Obergrenze setzt FRIST_MS: gemessen wird IM getrennten Zustand, und
 * der Rückverbinde-Zwang schlägt nach 5 s zu. Ein Fenster, das dort
 * hineinragt, würde den Ton mitten in der Messung zurückholen und das
 * Ergebnis verfälschen — 3 s lassen 2 s Luft.
 */
const MESSFENSTER_MS = 3000
/** Eigener Knotenname, wie ihn mixpi-pegel und mixpi-mitschnitt auch führen. */
const EIGENNAME = 'mixpi-cue-messung'

const nameTrifft = (wert) => {
  const klein = String(wert ?? '')
    .trim()
    .toLowerCase()
  if (klein === '') return false
  return SPOTIFY_NAMEN.some((n) => klein === n || (klein.startsWith(n) && /[.\s(]/.test(klein.charAt(n.length))))
}

const knotenAus = (dump) =>
  (Array.isArray(dump) ? dump : [])
    .filter((o) => o && o.type === 'PipeWire:Interface:Node' && typeof o.id === 'number')
    .map((o) => {
      const p = o.info?.props ?? {}
      return {
        id: o.id,
        name: p['node.name'] ?? '',
        klasse: p['media.class'] ?? '',
        anwendung: p['application.name'] ?? '',
        programm: p['application.process.binary'] ?? '',
      }
    })

const linksAus = (dump) =>
  (Array.isArray(dump) ? dump : [])
    .filter((o) => o && o.type === 'PipeWire:Interface:Link' && typeof o.id === 'number')
    .map((o) => ({
      id: o.id,
      ausgangKnoten: o.info?.['output-node-id'],
      ausgangPort: o.info?.['output-port-id'],
      eingangKnoten: o.info?.['input-node-id'],
      eingangPort: o.info?.['input-port-id'],
    }))
    .filter((l) => [l.ausgangKnoten, l.ausgangPort, l.eingangKnoten, l.eingangPort].every((n) => typeof n === 'number'))

const istEinspeisung = (k) =>
  k.klasse === EINSPEISE_KLASSE && (nameTrifft(k.anwendung) || nameTrifft(k.name) || nameTrifft(k.programm))

/** Gibt `{plan}` oder `{grund}` — nie einen Wurf, wie das Vorbild in tonpfad.ts. */
function planen(dump) {
  const knoten = knotenAus(dump)
  const links = linksAus(dump)
  const kandidaten = knoten.filter(istEinspeisung).sort((a, b) => a.id - b.id)
  if (kandidaten.length === 0) return { grund: 'kein-spotify' }

  const senke = knoten.find((k) => k.name === KLANGWERK_SENKE)
  if (!senke) return { grund: 'keine-senke' }

  const zurSenke = (k) => links.filter((l) => l.ausgangKnoten === k.id && l.eingangKnoten === senke.id)
  const spielende = kandidaten.filter((k) => zurSenke(k).length > 0)
  if (spielende.length > 1) return { grund: 'mehrdeutig', kandidaten: spielende }

  const quelle = spielende[0] ?? kandidaten[0]
  const kanten = zurSenke(quelle)
  if (kanten.length === 0) return { grund: 'keine-links', quelle, senke }

  const geschont = links.filter((l) => l.ausgangKnoten === quelle.id && l.eingangKnoten !== senke.id)
  return { plan: { quelle, senke, kanten, geschont } }
}

/** Dieselbe Zeile, die `planBeschreiben` in tonpfad.ts druckt — die Gegenstelle. */
const planBeschreiben = (plan) => {
  const kanten = plan.kanten.map((k) => `${k.ausgangPort}->${k.eingangPort} (Link ${k.id})`).join(', ')
  const geschont = plan.geschont.length > 0 ? `, geschont: ${plan.geschont.map((k) => k.id).join(', ')}` : ''
  return `${plan.quelle.name} (${plan.quelle.id}) -> ${plan.senke.name} (${plan.senke.id}): ${kanten}${geschont}`
}

// ─────────────────────────────────────────────────────────────────────────
// PipeWire ansprechen
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ein systemd-Dienst erbt kein `XDG_RUNTIME_DIR`, und ohne die Variable findet
 * PipeWire seinen Socket nicht (`pw_context_connect() failed: Host is down`).
 * Von Hand aufgerufen ist sie meist gesetzt; das Werkzeug soll aber auch aus
 * einer Unit heraus laufen können.
 */
const pwUmgebung = () => ({
  ...process.env,
  XDG_RUNTIME_DIR:
    process.env.XDG_RUNTIME_DIR || `/run/user/${typeof process.getuid === 'function' ? process.getuid() : 1000}`,
})

const laufen = (programm, argumente) =>
  new Promise((fertig, scheitern) => {
    execFile(programm, argumente, { env: pwUmgebung(), timeout: 15000, maxBuffer: 64 * 1024 * 1024 }, (f, aus) =>
      f ? scheitern(f) : fertig(aus),
    )
  })

async function dumpLesen(datei) {
  const roh = datei ? readFileSync(datei, 'utf8') : await laufen('pw-dump', [])
  return JSON.parse(roh)
}

/**
 * Effektivwert des Tons an der Endstation, 0..1.
 *
 * Gemessen wird der MONITOR der ALSA-Senke — der hängt hinter deren Regler und
 * führt genau das, was zur Karte geht. Dasselbe Vorgehen wie in
 * tools/tonweg-durchgang.py; der Unterschied zu `mixpi-pegel` ist nur, dass
 * hier ein Zahlenwert statt vier Bänder gebraucht wird.
 */
function pegelMessen(ziel, ms = MESSFENSTER_MS) {
  return new Promise((fertig) => {
    const stuecke = []
    /* ══ `parec`, NICHT `pw-record` — am Geraet gemessen (04.09.2026) ═══════
     *
     * Hier stand `pw-record --target <senke>.monitor`. Das misst auf dieser
     * Box IMMER Stille, auch bei voll ausgesteuertem Ton, und zwar mit und
     * ohne die Endung `.monitor` — nachgemessen bei spielendem Spotify,
     * derselbe Augenblick, dasselbe Ziel:
     *
     *     pw-record --target klangwerk.monitor        32   (Stille)
     *     pw-record --target klangwerk                36   (Stille)
     *     parec     --device=klangwerk.monitor     25757   (Ton)
     *
     * Die Folge war die schlimmste Sorte Messfehler: Die Probe brach mit
     * „Vorher-Pegel ist praktisch still" ab und schickte den Leser los,
     * Spotify zu reparieren — waehrend Spotify einwandfrei lief. Ein
     * Messgeraet, das immer dasselbe sagt, misst nichts.
     *
     * DIE ENDUNG `.monitor` IST PULSEAUDIO-SCHREIBWEISE und gehoert zu
     * `parec`; `pw-record` kennt sie nicht als Ziel. Dass beide Formen still
     * bleiben, heisst: dieser Weg trifft den Monitor hier ueberhaupt nicht.
     *
     * ACHTUNG, DIESELBE FALLE STECKT NOCH IN tools/tonweg-durchgang.py
     * (Zeile 72, `pw-record --target <ende>.monitor`) — jede Aussage „kein
     * Ton", die von dort stammt, ist zu wiederholen.
     */
    const kind = spawn('parec', [`--device=${ziel}`, '--format=s16le', '--rate=48000', '--channels=1'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: pwUmgebung(),
    })
    kind.stdout.on('data', (s) => stuecke.push(s))
    kind.on('error', () => fertig(null))
    const uhr = setTimeout(() => {
      kind.kill('SIGTERM')
    }, ms)
    kind.on('close', () => {
      clearTimeout(uhr)
      const puffer = Buffer.concat(stuecke)
      if (puffer.length < 2) return fertig(null)
      let summe = 0
      const n = Math.floor(puffer.length / 2)
      for (let i = 0; i < n; i++) {
        const wert = puffer.readInt16LE(i * 2) / 32768
        summe += wert * wert
      }
      fertig(Math.sqrt(summe / n))
    })
  })
}

const dB = (v) => (v === null ? '  ?  ' : v <= 0.00001 ? '-inf ' : (20 * Math.log10(v)).toFixed(1).padStart(5))

// ─────────────────────────────────────────────────────────────────────────
// Die zwei Betriebsarten
// ─────────────────────────────────────────────────────────────────────────

function kartierungDrucken(dump, plan) {
  const knoten = knotenAus(dump)
  const links = linksAus(dump)
  const name = (id) => knoten.find((k) => k.id === id)?.name ?? `?${id}`

  console.log('── Tonknoten ────────────────────────────────────────────────')
  for (const k of knoten) {
    const merk = istEinspeisung(k) ? '  <== SPOTIFY-EINSPEISUNG' : k.name === KLANGWERK_SENKE ? '  <== SENKE' : ''
    console.log(`  ${String(k.id).padStart(4)}  ${k.klasse.padEnd(20)}  ${k.name}${merk}`)
  }
  console.log('── Kanten ───────────────────────────────────────────────────')
  for (const l of links) {
    const treffer = plan?.kanten.some((k) => k.id === l.id) ? '  <== CUE TRENNT' : ''
    const schont = plan?.geschont.some((k) => k.id === l.id) ? '  <== bleibt (Mitschnitt!)' : ''
    console.log(
      `  ${String(l.id).padStart(4)}  ${name(l.ausgangKnoten)}:${l.ausgangPort} -> ${name(l.eingangKnoten)}:${l.eingangPort}${treffer}${schont}`,
    )
  }
}

async function probeFahren(dump, plan) {
  /* ══ GEMESSEN WIRD AN DER SENKE DES PLANS, NICHT AM ALSA-ENDE ════════════
   *
   * Hier stand `alsa_output….monitor`, und damit war die Probe bei
   * kindgerechter Lautstärke UNBRAUCHBAR. Am Gerät gemessen (04.09.2026,
   * Spotify spielte, Position lief normal weiter):
   *
   *     klangwerk.monitor                 32767   (Vollausschlag)
   *     alsa_output….monitor                 21
   *     Lautstärke                            7 %
   *
   * Der ALSA-Monitor hängt HINTER dem Regler; 7 % lesen sich dort als
   * Stille, und die Probe brach mit „Vorher-Pegel ist praktisch still" ab,
   * obwohl der Ton einwandfrei floss. Wer dem folgt, dreht die Box laut, um
   * ein Cue zu messen — auf einer Kinderbox die falsche Antwort.
   *
   * DIE SENKE DES PLANS IST DER RICHTIGE ORT, und zwar aus einem sachlichen
   * Grund, nicht nur der Empfindlichkeit wegen: Das Cue trennt genau die
   * Kanten `spotify -> <senke>`. Deren Wirkung ist an DIESER Senke
   * vollständig sichtbar, ohne den Lautstärkeregler als Störgröße
   * dazwischen. Der Weg dahinter (Senke -> Karte) ist nicht Gegenstand des
   * Cue und muss deshalb auch nicht mitgemessen werden.
   *
   * Genommen wird `plan.senke` — derselbe Knoten, dessen Kanten getrennt
   * werden. Heute ist das immer `klangwerk` (die Planung sucht die Senke
   * über diese Namenskonstante); sollte die Klangkette einmal anders
   * heissen, wandert die Messung von selbst mit, weil sie nicht ein zweites
   * Mal nach einem Namen sucht. Zwei Orte, die dieselbe Senke bestimmen,
   * wären genau die Bauart, die in diesem Baum schon mehrfach auseinander
   * gelaufen ist.
   */
  const ziel = `${plan.senke.name}.monitor`
  console.log(`\nProbe gegen ${ziel} — je ${MESSFENSTER_MS} ms.\n`)

  const vorher = await pegelMessen(ziel)
  if (vorher !== null && vorher < 0.0005) {
    // Ein Beweis braucht einen Ausgangspegel. Ohne Ton misst die Probe nur,
    // dass Stille still bleibt — und das ist keine Aussage über das Cue.
    console.error(`Vorher-Pegel ist praktisch still (${dB(vorher)} dB). Erst Spotify spielen lassen, dann messen.`)
    return 3
  }

  // ══ RÜCKVERBINDE-ZWANG, dieselbe Sicherung wie in cue-schalter.ts ═══════
  // Getrennt wird nur, wenn das Zurückverbinden aus JEDER Lage passiert:
  // aus dem regulären Ablauf (finally), bei Strg-C (SIGINT/SIGTERM) und
  // nach einer Frist, falls diese Datei selbst hängen bleibt. Eine Box, die
  // stumm bleibt, weil eine Messung abgebrochen ist, wäre der schlimmste
  // Ausgang — schlimmer als gar nicht zu messen.
  let getrennt = false
  const zurueck = () => {
    if (!getrennt) return
    getrennt = false
    for (const k of plan.kanten) {
      try {
        // SYNCHRON, mit Absicht: dieser Weg muss auch aus einem Signalgriff
        // heraus durchlaufen, und dort kommt keine Ereignisschleife mehr.
        execFileSync('pw-link', [String(k.ausgangPort), String(k.eingangPort)], {
          env: pwUmgebung(),
          stdio: 'ignore',
          timeout: 5000,
        })
      } catch {
        console.error(`ACHTUNG: pw-link ${k.ausgangPort} ${k.eingangPort} scheiterte — von Hand nachholen!`)
      }
    }
  }
  const beiSignal = () => {
    zurueck()
    process.exit(130)
  }
  process.on('SIGINT', beiSignal)
  process.on('SIGTERM', beiSignal)
  const wachhund = setTimeout(() => {
    console.error('Frist abgelaufen — RÜCKVERBINDE-ZWANG greift.')
    zurueck()
  }, FRIST_MS)

  let waehrend = null
  let nachher = null
  try {
    for (const k of plan.kanten) await laufen('pw-link', ['-d', String(k.id)])
    getrennt = true
    waehrend = await pegelMessen(ziel)
  } finally {
    clearTimeout(wachhund)
    zurueck()
    process.off('SIGINT', beiSignal)
    process.off('SIGTERM', beiSignal)
  }
  nachher = await pegelMessen(ziel)

  console.log('  Pegel vorher      ', dB(vorher), 'dB')
  console.log('  Pegel getrennt    ', dB(waehrend), 'dB   <== soll einbrechen')
  console.log('  Pegel danach      ', dB(nachher), 'dB   <== soll zurück sein')

  const eingebrochen = waehrend !== null && vorher !== null && waehrend < vorher * 0.05
  const zurueckDa = nachher !== null && vorher !== null && nachher > vorher * 0.3
  console.log(`\n  Cue wirkt:        ${eingebrochen ? 'JA' : 'NEIN'}`)
  console.log(`  Ton kommt zurück: ${zurueckDa ? 'JA' : 'NEIN'}`)
  if (!eingebrochen) console.log('  -> die getrennte Kante war nicht der Spotify-Ton. NICHT verdrahten.')
  if (!zurueckDa) console.log('  -> ACHTUNG: der Ton ist NICHT zurück. Kanten von Hand prüfen (pw-link -l).')
  return eingebrochen && zurueckDa ? 0 : 1
}

// ─────────────────────────────────────────────────────────────────────────

async function haupt() {
  const argumente = process.argv.slice(2)
  const alsJson = argumente.includes('--json')
  const probe = argumente.includes('--probe')
  const dumpDatei = argumente[argumente.indexOf('--dump') + 1]
  const ausDatei = argumente.includes('--dump') ? dumpDatei : null

  if (probe && ausDatei) {
    console.error('--probe braucht die echte Box; mit --dump gibt es nichts zu schalten.')
    return 2
  }

  let dump
  try {
    dump = await dumpLesen(ausDatei)
  } catch (f) {
    console.error(`pw-dump nicht lesbar: ${f.message}`)
    return 2
  }

  const ergebnis = planen(dump)
  if (alsJson) {
    console.log(JSON.stringify(ergebnis, null, 2))
    return ergebnis.plan ? 0 : 1
  }

  kartierungDrucken(dump, ergebnis.plan)
  console.log('── Plan ─────────────────────────────────────────────────────')
  if (!ergebnis.plan) {
    const erklaerung = {
      'kein-spotify': 'Spotify spielt gerade nicht — der Knoten existiert NUR bei laufender Wiedergabe.',
      'keine-senke': `Es gibt keine Senke namens "${KLANGWERK_SENKE}" — Klangwerk aus?`,
      'keine-links': 'Der Spotify-Knoten steht, führt aber keinen Ton (Soloist bleibt in der Pause stehen).',
      mehrdeutig: 'ZWEI Einspeisungen führen Ton. Es wird ausdrücklich nichts geplant.',
    }
    console.log(`  kein Plan: ${erklaerung[ergebnis.grund] ?? ergebnis.grund}`)
    return 1
  }
  console.log(`  ${planBeschreiben(ergebnis.plan)}`)
  console.log(`  trennen:  ${ergebnis.plan.kanten.map((k) => `pw-link -d ${k.id}`).join('  ')}`)
  console.log(`  zurück:   ${ergebnis.plan.kanten.map((k) => `pw-link ${k.ausgangPort} ${k.eingangPort}`).join('  ')}`)

  if (!probe) {
    console.log('\n  (nur gelesen — nichts geschaltet. Für den Gerätebeweis: --probe)')
    return 0
  }
  return await probeFahren(dump, ergebnis.plan)
}

haupt().then(
  (code) => process.exit(code),
  (f) => {
    console.error(f?.stack ?? String(f))
    process.exit(2)
  },
)
