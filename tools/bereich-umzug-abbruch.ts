/**
 * DEN UMZUG WIRKLICH ABBRECHEN — mit SIGKILL, nicht mit einem Gedanken.
 *
 * Im Quelltext steht: „Wenn es mittendrin abbricht, ist nichts verloren —
 * `rename` ist innerhalb eines Dateisystems atomar, und jede Ablage zieht
 * einzeln." Das ist richtig gedacht. Gedacht ist aber nicht gemessen, und der
 * Satz deckt nur den Fall ab, an den der Bauende gedacht hat.
 *
 * WAS DIESER LAUF TUT: er startet den Server als EIGENEN Prozess auf einem
 * vorbereiteten Verzeichnis und schiesst ihn nach einer wachsenden Zahl von
 * Millisekunden ab — SIGKILL, kein Aufraeumen, kein `finally`, genau wie ein
 * Stromausfall oder ein `kill -9` beim Herunterfahren. Nach JEDEM Schuss wird
 * nachgezaehlt, und zwar auf die einzige Art, die hier zaehlt:
 *
 *     JEDE Ablage liegt entweder am ALTEN Ort oder im BEREICH — nie nirgends,
 *     nie halb, und ihr Inhalt ist unveraendert.
 *
 * DANACH laeuft ein Start ohne Schuss durch, und alles muss angekommen sein.
 * Ein Abbruch, der sauber ist, aber nie fertig wird, waere kein Trost.
 *
 * SIGKILL UND NICHT SIGTERM: bei SIGTERM darf Node noch aufraeumen. Genau das
 * soll hier NICHT passieren — geprueft wird, was auf der Platte steht, wenn
 * niemand mehr aufraeumt.
 *
 * Fahren:
 *   NODE_ENV=test npx tsx tools/bereich-umzug-abbruch.ts
 *   NODE_ENV=test npx tsx tools/bereich-umzug-abbruch.ts --schuesse 40
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const BAUM = dirname(HIER)
const SERVER = join(BAUM, 'src', 'backend-api', 'src', 'server.ts')

/** Die drei Ablagen: wie sie ALT heissen, wie sie im Bereich heissen. */
const ABLAGEN = [
  { alt: 'gespielt.gast.json', neu: 'gespielt.json' },
  { alt: 'kinderzeit-verbrauch.gast.json', neu: 'kinderzeit-verbrauch.json' },
  { alt: 'listen.json', neu: 'listen.json' },
] as const

/** Was in jeder Ablage steht — unverwechselbar, damit ein Tausch auffiele. */
const INHALT: Record<string, string> = {
  'gespielt.gast.json': JSON.stringify(
    Array.from({ length: 31 }, (_, i) => ({ key: `spotify:werk-${i}`, anzahl: i + 2, zuletzt: 1_700_000_000 + i })),
  ),
  'kinderzeit-verbrauch.gast.json': JSON.stringify({ tag: '2026-08-05', sekunden: 1234, bonusMin: 7 }),
  'listen.json': JSON.stringify([{ id: 'meine', name: 'Meine Liste', titel: [] }]),
}

function ausgangslage(): string {
  const o = mkdtempSync(join(tmpdir(), 'mupi-abbruch-'))
  writeFileSync(join(o, 'data.json'), '[]')
  writeFileSync(join(o, 'active_data.json'), '[]')
  writeFileSync(
    join(o, 'profile.json'),
    JSON.stringify({ profile: [{ kennung: 'gast', name: 'Gast', figur: 'x.png', angelegt: 1 }], aktiv: 'gast' }),
  )
  for (const a of ABLAGEN) writeFileSync(join(o, a.alt), INHALT[a.alt])
  return o
}

/**
 * Ist jede Ablage genau EINMAL da, mit unveraendertem Inhalt?
 *
 * „Genau einmal" ist die Naht. An BEIDEN Orten waere eine zweite Wahrheit; an
 * keinem waere sie weg. Beides muss dieser Lauf sehen koennen.
 */
function nachzaehlen(o: string): string[] {
  const klagen: string[] = []
  for (const a of ABLAGEN) {
    const alt = join(o, a.alt)
    const neu = join(o, 'profile', 'gast', a.neu)
    const da = [alt, neu].filter((p) => existsSync(p))
    if (da.length === 0) klagen.push(`${a.alt}: WEG — weder alt noch im Bereich`)
    else if (da.length === 2) klagen.push(`${a.alt}: ZWEIMAL da — alt UND im Bereich`)
    else if (readFileSync(da[0], 'utf8') !== INHALT[a.alt]) klagen.push(`${a.alt}: Inhalt veraendert (${da[0]})`)
  }
  return klagen
}

/** Den Server starten und nach `msBisSchuss` abschiessen (0 = laufen lassen). */
function starten(o: string, msBisSchuss: number): Promise<void> {
  return new Promise((fertig) => {
    const k = spawn(process.execPath, ['--import', 'tsx', SERVER], {
      env: { ...process.env, NODE_ENV: 'test', MUPIBOX_CONFIG_DIR: o },
      stdio: 'ignore',
    })
    let geschossen = false
    if (msBisSchuss > 0) {
      setTimeout(() => {
        geschossen = true
        k.kill('SIGKILL')
      }, msBisSchuss).unref()
    }
    k.on('exit', () => fertig())
    // Ohne Schuss beendet sich der Prozess nicht von selbst (im Testmodus
    // horcht er nicht, aber Zeitgeber halten ihn offen) — also nach einer
    // grosszuegigen Frist selbst beenden und DANN nachsehen.
    if (msBisSchuss === 0) {
      setTimeout(() => {
        if (!geschossen) k.kill('SIGKILL')
      }, 6000).unref()
    }
  })
}

async function main(): Promise<number> {
  const arg = process.argv.indexOf('--schuesse')
  const schuesse = arg > 0 ? Number(process.argv[arg + 1]) : 25

  console.info('Der Umzug, mit SIGKILL unterbrochen')
  console.info('──────────────────────────────────────────────────────')
  console.info(`  ${schuesse} Laeufe, jeder mit einer eigenen Ausgangslage`)

  let kaputt = 0
  let unterbrochen = 0
  let vollstaendig = 0
  /** Wie oft der Schuss 0, 1, 2 bzw. 3 umgezogene Ablagen vorfand. */
  const verteilung = [0, 0, 0, 0]

  for (let i = 0; i < schuesse; i++) {
    const o = ausgangslage()
    // Die Frist waechst in kleinen Schritten durch das Anlaufen des Servers:
    // irgendwo darin liegt `bereicheHerrichten()`, und jeder Lauf trifft eine
    // andere Stelle. Genau ins Schwarze zu zielen ginge nur mit einem
    // Eingriff im Quelltext — und dann pruefte man den Eingriff.
    const ms = 30 + i * 25
    await starten(o, ms)
    const klagen = nachzaehlen(o)
    const fertigMit = ABLAGEN.filter((a) => existsSync(join(o, 'profile', 'gast', a.neu))).length
    verteilung[fertigMit]++
    if (fertigMit === ABLAGEN.length) vollstaendig++
    else unterbrochen++
    if (klagen.length) {
      kaputt++
      console.info(`  ${String(ms).padStart(4)} ms  ${fertigMit}/3 umgezogen  ROT`)
      for (const k of klagen) console.info(`           ${k}`)
    }
    rmSync(o, { recursive: true, force: true })
  }

  console.info(`  ${unterbrochen} Laeufe wurden mitten im Anlauf getroffen, ${vollstaendig} kamen durch.`)
  console.info(`  Vorgefunden: ${verteilung.map((n, i) => `${i}/3 -> ${n}x`).join('   ')}`)
  if (unterbrochen === 0) {
    console.info('\n  NICHT GEMESSEN: kein einziger Lauf wurde wirklich unterbrochen —')
    console.info('  die Fristen sind zu lang. Mit kleineren Werten wiederholen.')
    return 2
  }
  // DIE EHRLICHE EINSCHRAENKUNG. Nur 1/3 und 2/3 sind der Fall „mittendrin";
  // 0/3 heisst bloss, dass der Schuss VOR dem Umzug fiel, und 3/3, dass er
  // danach fiel. Beides ist kein Beweis fuer die Naht. Wer diesen Lauf liest,
  // muss sehen, ob er den Fall ueberhaupt getroffen hat.
  const mittendrin = verteilung[1] + verteilung[2]
  if (kaputt) {
    console.info(`\n  ROT: ${kaputt} von ${schuesse} Laeufen liessen eine Ablage kaputt zurueck.`)
    return 1
  }
  console.info('  Nach jedem Schuss lag JEDE Ablage genau einmal da, unveraendert.')
  if (mittendrin === 0) {
    // DIE EHRLICHE EINSCHRAENKUNG, und sie ist selbst ein Befund. Der Schuss
    // trifft immer 0/3 oder 3/3, nie dazwischen: die drei `rename` liegen
    // Mikrosekunden auseinander, das Fenster ist also verschwindend klein.
    // Klein ist aber nicht null (eine volle Karte, ein Stromausfall), und
    // „habe ich nicht getroffen" ist kein Beweis. Der Fall wird deshalb
    // gleich GESTELLT statt erwuerfelt.
    console.info(`\n  Kein Schuss traf ZWISCHEN zwei Ablagen (${verteilung[1] + verteilung[2]}x) —`)
    console.info('  das Fenster zwischen den drei `rename` ist zu klein, um es zu erwischen.')
    console.info('  Also wird es gestellt:')
  }

  // ── JEDE Zwischenlage einzeln aufgebaut: als waere ein voriger Lauf nach
  //    k von 3 Umzuegen gestorben. Das ist der Fall, den der Schuss nicht
  //    trifft, und der einzige, der die Naht wirklich fragt.
  for (let k = 0; k <= ABLAGEN.length; k++) {
    const o = ausgangslage()
    const bereich = join(o, 'profile', 'gast')
    mkdirSync(bereich, { recursive: true })
    for (let j = 0; j < k; j++) {
      renameSync(join(o, ABLAGEN[j].alt), join(bereich, ABLAGEN[j].neu))
    }
    const klagenVorher = nachzaehlen(o)
    await starten(o, 0)
    const klagenNachher = nachzaehlen(o)
    const alleDa = ABLAGEN.every((a) => existsSync(join(bereich, a.neu)))
    const gut = klagenVorher.length === 0 && klagenNachher.length === 0 && alleDa
    console.info(`    ${k}/3 vorgefunden -> ${alleDa ? '3/3' : 'NICHT vollstaendig'}  ${gut ? 'ok' : 'ROT'}`)
    for (const c of [...klagenVorher, ...klagenNachher]) console.info(`         ${c}`)
    rmSync(o, { recursive: true, force: true })
    if (!gut) return 1
  }

  // ── Und der Nachlauf: ein Abbruch, der nie fertig wird, waere kein Trost.
  const o = ausgangslage()
  await starten(o, 120) // mitten hinein
  const zwischen = ABLAGEN.filter((a) => existsSync(join(o, 'profile', 'gast', a.neu))).length
  await starten(o, 0) // und noch einmal, diesmal ganz
  const klagen = nachzaehlen(o)
  const alleDa = ABLAGEN.every((a) => existsSync(join(o, 'profile', 'gast', a.neu)))
  console.info(
    `\n  Nachlauf: nach dem Schuss ${zwischen}/3 umgezogen, nach dem zweiten Start ${alleDa ? '3/3' : 'NICHT vollstaendig'}`,
  )
  if (klagen.length || !alleDa) {
    for (const k of klagen) console.info(`    ${k}`)
    console.info('  ROT: der naechste Start holt den Rest NICHT nach.')
    rmSync(o, { recursive: true, force: true })
    return 1
  }
  for (const a of ABLAGEN) {
    if (readFileSync(join(o, 'profile', 'gast', a.neu), 'utf8') !== INHALT[a.alt]) {
      console.info(`  ROT: ${a.neu} ist im Bereich angekommen, aber veraendert.`)
      rmSync(o, { recursive: true, force: true })
      return 1
    }
  }
  rmSync(o, { recursive: true, force: true })
  console.info('  Der naechste Start holt den Rest nach — inhaltlich unveraendert.')
  return 0
}

main().then((c) => process.exit(c))
