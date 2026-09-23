#!/usr/bin/env npx tsx
/**
 * DER SYSTEMVERLAUF AN SEINEN RAENDERN — gegen einen EIGENEN Server, und mit
 * einer echten Zahl fuer die SD-Karte.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 *
 * `systemverlauf.spec.ts` und `systemverlaufablage.spec.ts` pruefen die
 * REGELN. Sie pruefen nicht, was ein Server daraus macht — ob er mit einer
 * unlesbaren Datei ueberhaupt hochkommt, ob der Weg bei leerer Reihe eine
 * Antwort gibt oder einen Fehler, ob der Ring beim Laden wirklich greift.
 * Genau das sind die Faelle, an denen eine Aufzeichnung im Betrieb scheitert,
 * und keiner davon laesst sich mit einer reinen Funktion stellen.
 *
 * Und es misst den SCHREIBAUFWAND. Die Entscheidung, anzuhaengen statt die
 * ganze Datei neu zu schreiben, steht als Rechnung im Code
 * (`aufwandAnhaengen` / `aufwandNeuschreiben` in systemverlauf.ts). Eine
 * Rechnung, die niemand gegen die Wirklichkeit haelt, ist eine Behauptung.
 * Hier wird eine Stunde Aufzeichnung wirklich geschrieben und gezaehlt, was
 * dabei durch die Bloecke des Dateisystems geht — mit den echten Offsets des
 * echten Schreibers, nicht mit einer zweiten Rechnung.
 *
 * ══ WAS ES PRUEFT ══════════════════════════════════════════════════════════
 *   1  Leere Reihe          — Antwort statt Fehler, alles leer
 *   2  Ein einziger Punkt   — ein Abschnitt, von == bis
 *   3  Luecken              — die Nacht zerschneidet die Reihe
 *   4  Ueberlauf des Rings  — 12 000 Zeilen ergeben 10 080 Punkte
 *   5  Unlesbare Datei      — der Server kommt trotzdem hoch
 *   6  Halb geschriebene Datei — die kaputte Zeile kostet EINEN Punkt
 *   7  Zeitsprung rueckwaerts — was in der Zukunft liegt, faellt weg
 *   8  Die Grenzen von `stunden`
 *   9  Der Schreibaufwand, gemessen
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * NICHTS an einer Box und nichts am Arbeitsbaum. Jeder Lauf bekommt ein
 * eigenes Verzeichnis unter /tmp, einen eigenen Port (9401 aufwaerts, vorher
 * wirklich gebunden) und ein eigenes TLS-Verzeichnis; am Ende wird beides
 * weggeraeumt.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   npx tsx tools/systemverlauf-am-server.ts
 *   npx tsx tools/systemverlauf-am-server.ts --port 9411
 * ENDE 0, wenn jede Aussage haelt.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import fs, { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  aufwandAnhaengen,
  aufwandNeuschreiben,
  BYTES_JE_PUNKT,
  MAX_PUNKTE,
  type Punkt,
} from '../src/backend-api/src/systemverlauf'
import { anhaengenAn, DATEINAME, UEBERHANG, verdichten, zeileAus } from '../src/backend-api/src/systemverlaufablage'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = join(WURZEL, 'src', 'backend-api')

const argv = process.argv.slice(2)
const opt = (n: string, v: string | null = null): string | null => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}
const PORT_AB = Number(opt('port', '9401'))

let fehler = 0
const ja = (gut: boolean, satz: string, dazu = ''): void => {
  if (!gut) fehler++
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${satz}${dazu ? `  — ${dazu}` : ''}`)
}
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Einen Port WIRKLICH binden, statt zu hoffen, dass er frei ist. */
async function freierPort(ab: number): Promise<number> {
  for (let p = ab; p < ab + 40; p++) {
    const frei = await new Promise<boolean>((auf) => {
      const s = net.createServer()
      s.once('error', () => auf(false))
      s.once('listening', () => s.close(() => auf(true)))
      s.listen(p, '127.0.0.1')
    })
    if (frei) return p
  }
  throw new Error(`kein freier Port ab ${ab}`)
}

const T0 = Date.now() - 3 * 3_600_000
const punkt = (minute: number, c = 13, ab = T0): Punkt => ({
  t: ab + minute * 60_000,
  c,
  m: 35,
  g: 46.9,
  l: 53,
})

interface Antwort {
  status: number
  körper: Record<string, unknown>
}

/**
 * Einen eigenen Server hochfahren, eine Frage stellen, ihn wieder abraeumen.
 *
 * NODE_ENV=development und nicht `test`: unter `test` bindet server.ts
 * ueberhaupt keinen Port (siehe `if (!testServe)` ganz unten dort). Das
 * TLS-Verzeichnis zeigt mit ins Wegwerf-Verzeichnis, damit der Server sich
 * kein Zertifikat unter /etc/mupibox anlegt.
 */
async function amServer(
  inhalt: string | null,
  fragen: string[],
  opts: { wartenMs?: number } = {},
): Promise<{ antworten: Antwort[]; protokoll: string }> {
  const ordner = mkdtempSync(join(tmpdir(), 'sysverlauf-probe-'))
  if (inhalt !== null) fs.writeFileSync(join(ordner, DATEINAME), inhalt)
  const port = await freierPort(PORT_AB)
  let protokoll = ''
  const kind: ChildProcess = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MUPIBOX_CONFIG_DIR: ordner,
      MUPIBOX_TLS_DIR: join(ordner, 'tls'),
      MUPIBOX_HTTP_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  kind.stdout?.on('data', (d) => {
    protokoll += String(d)
  })
  kind.stderr?.on('data', (d) => {
    protokoll += String(d)
  })

  const antworten: Antwort[] = []
  try {
    // Warten, bis er antwortet — und nicht auf eine feste Zeit hoffen.
    let da = false
    for (let i = 0; i < 120 && !da; i++) {
      await warte(500)
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/system/verlauf`)
        da = r.ok
      } catch {
        /* noch nicht oben */
      }
    }
    if (!da) throw new Error(`Server kam nicht hoch:\n${protokoll}`)
    // Fuer den Fall, in dem der Server selbst messen soll: ihn wirklich
    // laufen lassen. Der erste Punkt entsteht nach 20 s + einem Messtakt.
    if (opts.wartenMs) await warte(opts.wartenMs)
    for (const frage of fragen) {
      const r = await fetch(`http://127.0.0.1:${port}${frage}`)
      antworten.push({ status: r.status, körper: (await r.json()) as Record<string, unknown> })
    }
  } finally {
    kind.kill('SIGKILL')
    rmSync(ordner, { recursive: true, force: true })
  }
  return { antworten, protokoll }
}

const WEG = '/api/system/verlauf'
const SCHNELL = argv.includes('--schnell')

async function lage1Leer(): Promise<void> {
  console.log('\n── 1  LEERE REIHE — es gibt noch gar keine Datei ─────────────')
  const { antworten } = await amServer(null, [WEG])
  const a = antworten[0]
  ja(a.status === 200, 'Zustand 200 statt 404', `war ${a.status}`)
  ja(Array.isArray(a.körper.punkte) && (a.körper.punkte as unknown[]).length === 0, 'punkte ist eine LEERE Liste')
  ja(
    Array.isArray(a.körper.abschnitte) && (a.körper.abschnitte as unknown[]).length === 0,
    'abschnitte ist eine leere Liste',
  )
  ja(a.körper.jetzt === null, 'jetzt ist null und nicht undefined oder 0')
  ja(a.körper.gesamt === 0, 'gesamt ist 0')
  ja(
    typeof a.körper.kerne === 'number' && (a.körper.kerne as number) > 0,
    'die Bezugsgroesse kerne kommt trotzdem mit',
    `kerne=${a.körper.kerne}`,
  )
  ja(typeof a.körper.speicherGesamt === 'number', 'speicherGesamt kommt trotzdem mit')
}

async function lage2EinPunkt(): Promise<void> {
  console.log('\n── 2  EIN EINZIGER PUNKT ────────────────────────────────────')
  const { antworten } = await amServer(zeileAus(punkt(0)), [WEG])
  const k = antworten[0].körper
  const punkte = k.punkte as Punkt[]
  const abschnitte = k.abschnitte as { von: number; bis: number; punkte: number }[]
  ja(punkte.length === 1, 'ein Punkt bleibt ein Punkt', `${punkte.length}`)
  ja(k.gesamt === 1, 'gesamt ist 1')
  ja(abschnitte.length === 1 && abschnitte[0].von === abschnitte[0].bis, 'ein Abschnitt mit von == bis')
  ja((k.jetzt as Punkt)?.t === punkt(0).t, 'jetzt ist genau dieser Punkt')
}

async function lage3Luecken(): Promise<void> {
  console.log('\n── 3  LUECKEN — die Box war ueber Nacht aus ─────────────────')
  // Zwei Stunden vor der Nacht, dann 100 Minuten nichts, dann wieder.
  const vorher = Array.from({ length: 20 }, (_, i) => punkt(i))
  const nachher = Array.from({ length: 20 }, (_, i) => punkt(120 + i))
  const { antworten } = await amServer([...vorher, ...nachher].map(zeileAus).join(''), [WEG])
  const k = antworten[0].körper
  const a = k.abschnitte as { von: number; bis: number; punkte: number }[]
  ja(a.length === 2, 'die Reihe zerfaellt in ZWEI Abschnitte', `${a.length}`)
  ja(a[0]?.punkte === 20 && a[1]?.punkte === 20, 'je 20 Punkte in beiden')
  ja(
    a.length === 2 && a[1].von - a[0].bis === 101 * 60_000,
    'zwischen den Abschnitten steht die ganze Nacht (101 Minuten) und keine Linie',
    a.length === 2 ? `${(a[1].von - a[0].bis) / 60_000} min` : '',
  )
  ja(k.gesamt === 40, 'gesamt zaehlt alle 40 Punkte')
  ja(typeof k.lueckeMs === 'number', 'der Weg sagt der Kurve, ab wann er selbst eine Luecke sieht')
}

async function lage4Ueberlauf(): Promise<void> {
  console.log('\n── 4  UEBERLAUF DES RINGSPEICHERS ──────────────────────────')
  // Mehr Zeilen, als der Ring haelt — so, wie die Datei zwischen zwei
  // Verdichtungen wirklich aussieht.
  const zuviel = MAX_PUNKTE + UEBERHANG + 500
  const ab = Date.now() - zuviel * 60_000
  const zeilen: string[] = []
  for (let i = 0; i < zuviel; i++) zeilen.push(zeileAus(punkt(i, i % 100, ab)))
  const { antworten } = await amServer(zeilen.join(''), [`${WEG}?stunden=168`])
  const k = antworten[0].körper
  ja(k.gesamt === MAX_PUNKTE, `der Ring haelt genau ${MAX_PUNKTE} Punkte`, `gesamt=${k.gesamt}`)
  const punkte = k.punkte as Punkt[]
  ja(punkte.length <= 600, 'fuer die Anzeige auf hoechstens 600 geraffte Punkte', `${punkte.length}`)
  ja(
    (k.jetzt as Punkt)?.t === punkt(zuviel - 1, 0, ab).t,
    'der JUENGSTE Punkt ist noch da — die aeltesten sind gefallen, nicht die neuen',
  )
  ja(punkte[punkte.length - 1]?.t === (k.jetzt as Punkt)?.t, 'auch nach dem Raffen steht der aktuelle Stand am Ende')
}

async function lage5Unlesbar(): Promise<void> {
  console.log('\n── 5  UNLESBARE DATEI ──────────────────────────────────────')
  const { antworten, protokoll } = await amServer('das ist kein JSON\nund das hier auch nicht\n', [WEG])
  ja(antworten[0].status === 200, 'der Server kommt hoch und antwortet')
  ja(antworten[0].körper.gesamt === 0, 'die Reihe faengt neu an, statt den Start zu verhindern')
  ja(/unlesbare Zeile/.test(protokoll), 'und er SAGT es im Protokoll, statt es still zu schlucken')
}

async function lage6HalbGeschrieben(): Promise<void> {
  console.log('\n── 6  HALB GESCHRIEBENE DATEI — Strom weg beim Anhaengen ───')
  const ganz = Array.from({ length: 30 }, (_, i) => punkt(i))
    .map(zeileAus)
    .join('')
  // Genau so sieht es aus, wenn der Strom mitten im letzten Anhaengen weg
  // war: eine abgeschnittene Zeile ohne Umbruch.
  const halb = `${ganz}{"t":${punkt(30).t},"c":13,"m":3`
  const { antworten } = await amServer(halb, [WEG])
  ja(antworten[0].körper.gesamt === 30, 'die 30 heilen Punkte sind alle da', `${antworten[0].körper.gesamt}`)

  console.log('   … und derselbe Ausfall mit Nullbytes mitten in der Datei:')
  const mitNullen = `${Array.from({ length: 10 }, (_, i) => punkt(i))
    .map(zeileAus)
    .join('')}\0\0\0\0\0\0\0\0\n${Array.from({ length: 10 }, (_, i) => punkt(20 + i))
    .map(zeileAus)
    .join('')}`
  const zweite = await amServer(mitNullen, [WEG])
  ja(
    zweite.antworten[0].körper.gesamt === 20,
    'eine kaputte Zeile kostet EINEN Punkt, nicht die Reihe',
    `${zweite.antworten[0].körper.gesamt}`,
  )
}

async function lage7Zeitsprung(): Promise<void> {
  console.log('\n── 7  ZEITSPRUNG RUECKWAERTS ───────────────────────────────')
  // Der gemessene Fall vom 07.08.2026: Journal und Uhr lagen 43 Minuten
  // auseinander. In der Datei stehen dann Punkte, die JETZT in der Zukunft
  // liegen.
  const jetzt = Date.now()
  const echt = Array.from({ length: 10 }, (_, i) => punkt(i, 13, jetzt - 60 * 60_000))
  const zukunft = Array.from({ length: 5 }, (_, i) => punkt(i, 13, jetzt + 43 * 60_000))
  const { antworten } = await amServer([...echt, ...zukunft].map(zeileAus).join(''), [WEG])
  const k = antworten[0].körper
  ja(k.gesamt === 10, 'was in der ZUKUNFT liegt, faellt beim Laden heraus', `gesamt=${k.gesamt}`)
  ja((k.jetzt as Punkt)?.t <= jetzt + 60_000, 'jetzt liegt nicht in der Zukunft')
  const punkte = k.punkte as Punkt[]
  ja(
    punkte.every((p, i) => i === 0 || p.t >= punkte[i - 1].t),
    'die gelieferte Reihe ist aufsteigend sortiert',
  )
}

async function lage8Grenzen(): Promise<void> {
  console.log('\n── 8  DIE GRENZEN VON `stunden` ────────────────────────────')
  const reihe = Array.from({ length: 30 }, (_, i) => punkt(i))
    .map(zeileAus)
    .join('')
  const { antworten } = await amServer(reihe, [WEG, `${WEG}?stunden=99999`, `${WEG}?stunden=-5`, `${WEG}?stunden=abc`])
  ja(antworten[0].körper.stunden === 24, 'ohne Angabe: 24 Stunden')
  ja(antworten[1].körper.stunden === 168, 'nach oben bei 168 (sieben Tagen) gedeckelt')
  ja(antworten[2].körper.stunden === 1, 'eine negative Angabe wird zu 1 und nicht zu einer leeren Reihe')
  ja(antworten[3].körper.stunden === 24, 'Buchstaben ergeben die Vorgabe, keinen Fehler')
  ja(
    antworten.every((a) => a.status === 200),
    'keine dieser Angaben erzeugt einen Fehler',
  )
}

/**
 * DIE AUFZEICHNUNG LAEUFT WIRKLICH — der einzige Fall, den keine gestellte
 * Datei beweisen kann.
 *
 * Alle Faelle davor legen dem Server eine fertige Reihe hin. Ob er selbst je
 * einen Punkt ERZEUGT — /proc/stat zweimal liest, die Differenz bildet,
 * /proc/meminfo auswertet, den Sensor findet —, sagt keiner von ihnen. Genau
 * das ist aber der Auftrag: eine Kurve kann nichts zeigen, was niemand
 * mitschreibt.
 *
 * DAUERT ANDERTHALB MINUTEN, und das laesst sich nicht abkuerzen: der erste
 * Aufruf nach 20 s holt nur den /proc/stat-Stand (ein einzelner Stand sagt
 * nichts), der erste Punkt entsteht einen Messtakt spaeter. Wer es eilig hat,
 * nimmt `--schnell` — und weiss dann eben dieses eine nicht.
 */
async function lage10Aufzeichnung(): Promise<void> {
  console.log('\n── 10 DIE AUFZEICHNUNG LAEUFT WIRKLICH (dauert ~95 s) ──────')
  if (SCHNELL) {
    console.log('   uebersprungen (--schnell)')
    return
  }
  const vorher = Date.now()
  const { antworten } = await amServer(null, [WEG], { wartenMs: 95_000 })
  const k = antworten[0].körper
  const jetzt = k.jetzt as Punkt | null
  ja((k.gesamt as number) >= 1, 'der Server hat von sich aus mindestens einen Punkt geschrieben', `gesamt=${k.gesamt}`)
  ja(!!jetzt && jetzt.t >= vorher, 'der Punkt traegt eine Zeit von JETZT und keine gestellte')
  ja(
    !!jetzt && Number.isFinite(jetzt.c) && jetzt.c >= 0 && jetzt.c <= 100,
    'die Last ist ein Anteil zwischen 0 und 100',
    `c=${jetzt?.c}`,
  )
  ja(
    !!jetzt && jetzt.m > 0 && jetzt.m < 100,
    'der Speicher steht WEDER bei 0 NOCH bei 100 — MemAvailable, nicht MemFree',
    `m=${jetzt?.m} %`,
  )
  ja(
    !!jetzt && (jetzt.g === null || (jetzt.g > 0 && jetzt.g < 120)),
    'die Temperatur ist eine Zahl oder ehrlich null',
    `g=${jetzt?.g}`,
  )
  ja(!!jetzt && jetzt.l !== null && jetzt.l >= 0, 'das Lastmittel ist mitgeschrieben', `l=${jetzt?.l}`)
  console.log(`   gemessener Punkt: ${JSON.stringify(jetzt)}`)
}

/** Was /proc/self/io ueber diesen Prozess sagt. */
function eigeneIo(): Record<string, number> {
  const raus: Record<string, number> = {}
  try {
    for (const z of fs.readFileSync('/proc/self/io', 'utf8').split('\n')) {
      const m = /^(\w+):\s+(\d+)$/.exec(z)
      if (m) raus[m[1]] = Number(m[2])
    }
  } catch {
    /* kein Linux — dann eben ohne */
  }
  return raus
}

const kb = (b: number) => `${(b / 1024).toFixed(1)} kB`
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`
const gb = (b: number) => `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`

/**
 * EINE STUNDE AUFZEICHNUNG WIRKLICH SCHREIBEN und zaehlen, was dabei durch
 * die Bloecke geht.
 *
 * WIE GEZAEHLT WIRD, und warum nicht mit `write_bytes`: der Zaehler in
 * /proc/self/io wird beim ZURUECKSCHREIBEN gefuehrt und dann oft einem
 * Kernel-Faden zugeschlagen, nicht diesem Prozess — er steht hier deshalb nur
 * zur Anschauung. Gezaehlt wird stattdessen, welche 4-kB-Bloecke der ECHTE
 * Schreiber wirklich beruehrt hat: vor und nach jedem Anhaengen die
 * Dateigroesse, daraus die Blocknummern. Das ist keine zweite Rechnung,
 * sondern die Offsets, die tatsaechlich entstanden sind.
 */
function lage9Schreibaufwand(): void {
  console.log('\n── 9  DER SCHREIBAUFWAND, GEMESSEN ─────────────────────────')
  const BLOCK = 4096
  const ordner = mkdtempSync(join(tmpdir(), 'sysverlauf-messen-'))
  const pfad = join(ordner, DATEINAME)
  const groesse = () => {
    try {
      return fs.statSync(pfad).size
    } catch {
      return 0
    }
  }

  const ioVor = eigeneIo()
  let bloecke = 0
  let daten = 0
  // Eine Stunde: 60 Punkte, alle zehn angehaengt.
  for (let block = 0; block < 6; block++) {
    const zehn = Array.from({ length: 10 }, (_, i) => punkt(block * 10 + i))
    const vor = groesse()
    daten += anhaengenAn(pfad, zehn)
    const nach = groesse()
    // Beruehrt wurden die Bloecke von `vor` bis `nach-1`, den angebrochenen
    // ersten eingeschlossen — der wird mitgeschrieben.
    bloecke += Math.floor((nach - 1) / BLOCK) - Math.floor(vor / BLOCK) + 1
  }
  const ioNach = eigeneIo()
  const gemessen = bloecke * BLOCK
  const gerechnet = aufwandAnhaengen({ punkteJeStunde: 60, punkteJeSchreiben: 10 })

  console.log(`   Nutzdaten je Stunde        ${kb(daten)}  (60 Punkte zu ${Math.round(daten / 60)} Bytes)`)
  console.log(`   auf die Karte, gemessen    ${kb(gemessen)}  (${bloecke} Bloecke zu ${BLOCK} Bytes)`)
  console.log(`   auf die Karte, gerechnet   ${kb(gerechnet.karteJeStunde)}  (mit Journal, mit Verdichtung)`)
  console.log(`   /proc/self/io wchar        ${kb((ioNach.wchar ?? 0) - (ioVor.wchar ?? 0))}`)
  console.log(`   /proc/self/io write_bytes  ${kb((ioNach.write_bytes ?? 0) - (ioVor.write_bytes ?? 0))}`)
  // Die gemessene Jahreszahl ist die UNTERGRENZE: in einer Stunde faellt
  // keine Verdichtung an (die kommt einmal am Tag), und der Journaleintrag je
  // Schreibvorgang ist von aussen nicht zu sehen. Genau deshalb rechnet
  // `aufwandAnhaengen` beides mit — eine Kartenrechnung darf zu teuer sein.
  console.log(
    `   hochgerechnet aufs Jahr    ${mb(gemessen * 8766)} gemessen (ohne Journal, ohne Verdichtung), ${gb(gerechnet.karteJeJahr)} gerechnet`,
  )

  ja(
    Math.round(daten / 60) <= BYTES_JE_PUNKT,
    `eine Zeile bleibt unter den ${BYTES_JE_PUNKT} Bytes der Rechnung`,
    `${Math.round(daten / 60)} Bytes`,
  )
  ja(
    gemessen <= gerechnet.karteJeStunde,
    'die Rechnung ist nicht zu guenstig — gemessen liegt unter gerechnet',
    `${kb(gemessen)} gegen ${kb(gerechnet.karteJeStunde)}`,
  )
  ja(gemessen < 64 * 1024, 'unter 64 kB je Stunde gehen auf die Karte', kb(gemessen))

  // ── Und dasselbe im Verfahren der Akkukurve: die GANZE Datei neu.
  const pfadNeu = join(ordner, 'neuschreiben.jsonl')
  const reihe = Array.from({ length: MAX_PUNKTE }, (_, i) => punkt(i))
  let neuBytes = 0
  const ioVor2 = eigeneIo()
  for (let block = 0; block < 6; block++) neuBytes += verdichten(pfadNeu, reihe)
  const ioNach2 = eigeneIo()
  const neuGerechnet = aufwandNeuschreiben({ punkteJeStunde: 60, punkteJeSchreiben: 10 })
  console.log(`\n   ZUM VERGLEICH, dasselbe als „ganze Datei neu" (${MAX_PUNKTE} Punkte, 6 Mal je Stunde):`)
  console.log(`   auf die Karte, gemessen    ${mb(neuBytes)} je Stunde  ->  ${gb(neuBytes * 8766)} im Jahr`)
  console.log(
    `   auf die Karte, gerechnet   ${mb(neuGerechnet.karteJeStunde)} je Stunde  ->  ${gb(neuGerechnet.karteJeJahr)} im Jahr`,
  )
  console.log(`   /proc/self/io wchar        ${mb((ioNach2.wchar ?? 0) - (ioVor2.wchar ?? 0))}`)
  ja(
    neuBytes / gemessen > 20,
    'anhaengen ist um mehr als das Zwanzigfache billiger als neu schreiben',
    `Faktor ${(neuBytes / gemessen).toFixed(0)}`,
  )
  console.log(
    '\n   DIESELBE RECHNUNG GILT FUER akkuverlauf.json — die Akkukurve schreibt\n' +
      '   alle zehn Minuten die ganze Reihe neu (server.ts, AKKU_SCHREIB_JE).\n' +
      '   Das ist eine AUSSAGE und keine Reparatur: die Datei gehoert gerade\n' +
      '   einem anderen Lauf.',
  )
  rmSync(ordner, { recursive: true, force: true })
}

async function haupt(): Promise<void> {
  console.log('DER SYSTEMVERLAUF AN SEINEN RAENDERN — eigener Server, eigener Port, eigenes Verzeichnis')
  await lage1Leer()
  await lage2EinPunkt()
  await lage3Luecken()
  await lage4Ueberlauf()
  await lage5Unlesbar()
  await lage6HalbGeschrieben()
  await lage7Zeitsprung()
  await lage8Grenzen()
  lage9Schreibaufwand()
  await lage10Aufzeichnung()
  console.log(`\n${fehler === 0 ? 'ALLES HAELT.' : `${fehler} Aussage(n) haelt nicht.`}`)
  process.exit(fehler === 0 ? 0 : 1)
}

void haupt()
