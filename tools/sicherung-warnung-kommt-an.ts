/**
 * KOMMT DIE WARNUNG BEI EINEM MENSCHEN AN — oder stirbt sie auf stdout?
 *
 * DIE FRAGE, DIE HIER BEANTWORTET WIRD:
 *
 *     Jemand legt eine neue Ablage in server/config, die in keinem Muster
 *     der Sicherung steht. `mupibox-sicherung.py` MELDET das seit jeher
 *     („! nicht eingeordnet, NICHT gesichert: …") und traegt es im Stand
 *     unter `unbekannt`. Sieht das jemand, der nur den Bildschirm hat?
 *
 * BIS ZUM 07.08.2026 WAR DIE ANTWORT NEIN, und sie war teuer: `/api/sicherung/
 * anlegen` verwirft stdout vollstaendig (die Antwort SIND die Archivbytes),
 * und `standKopfLesen` las das Feld `unbekannt` nicht. Genau so ist
 * `server/config/profile.json` aus jeder Sicherung gefallen — die Datei, die
 * sagt, DASS es die Kinder gibt. Die Warnung stand da. Niemand hat sie
 * gehoert, seit der Weg ueber den Bildschirm laeuft statt ueber die
 * Befehlszeile.
 *
 * WAS DIESER LAUF MISST — vier Ringe, und der zweite ist der wichtigste:
 *
 *   1  STILLE IM NORMALFALL   Eine Box, auf der alles eingeordnet ist, sagt
 *                             GAR NICHTS. Kein Hinweis, kein Kaestchen, kein
 *                             gelber Rand. Das ist keine Nachlaessigkeit,
 *                             sondern die Bedingung dafuer, dass Ring 3
 *                             ueberhaupt jemanden erreicht.
 *   2  DAS BEWUSST DRAUSSENE  Schluesselmaterial (etc/mupibox/tls), der
 *                             Coverspeicher, eine .bak-Altlast, ein Verweis:
 *                             alles Dinge, die die Sicherung ABSICHTLICH
 *                             auslaesst. Sie duerfen NICHT warnen. Waere das
 *                             anders, stuende bei jeder Sicherung eine
 *                             Warnung, und nach dreimal liest sie niemand
 *                             mehr — der Kanal waere gebaut und trotzdem taub.
 *   3  DIE NEUE ABLAGE        Eine Datei, die in keinem Muster steht, faellt
 *                             AUF: im Kopf des Downloads, in der Lage der
 *                             Seite, mit PFAD und mit einem Satz, der sagt,
 *                             was das bedeutet und was zu tun ist.
 *   4  AM BILDSCHIRM          Die Verwaltungsseite bindet genau diese Felder
 *                             — und zwar so, dass sie im Normalfall nichts
 *                             zeigt. Ein Backend, das es sagt, und eine
 *                             Seite, die es wegwirft, waere derselbe Fehler
 *                             eine Etage hoeher.
 *
 * UND MAN KANN ES ANSEHEN. Mit `--stehenlassen` bleibt der Server oben und
 * die GEBAUTE Verwaltungsoberflaeche liegt unter /admin/ daneben; dann ist
 * http://127.0.0.1:9601/admin/sicherung die Seite mit dem echten Sandkasten
 * dahinter. Der Bau dafuer wird NICHT hier ausgeloest (er dauert Sekunden und
 * schriebe in ein Verzeichnis, das anderen gehoert): `--oberflaeche <verz>`
 * nimmt einen fertigen Bau entgegen.
 *
 * NIEMALS GEGEN DIE ECHTE BOX. Wie tools/sicherung-ohne-ssh-ring.ts baut
 * dieser Lauf einen vollstaendigen Sandkasten in einem Wegwerfverzeichnis und
 * faehrt eine PATCHKOPIE von mupibox-sicherung.py, deren Pfadkonstanten dorthin
 * zeigen. Greift der Patch nicht vollstaendig, bricht der Lauf ab, statt gegen
 * /etc/mupibox dieses Rechners zu laufen.
 *
 * FAHREN
 *   npx tsx tools/sicherung-warnung-kommt-an.ts
 *   npx tsx tools/sicherung-warnung-kommt-an.ts --port 9602
 *   npx tsx tools/sicherung-warnung-kommt-an.ts --stehenlassen \
 *        --oberflaeche /tmp/admin-bau
 *
 * ENDE 0, wenn jeder Ring haelt. ENDE 1 mit dem Wortlaut, was nicht hielt.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { sicherungWegeBauen } from '../src/backend-api/src/sicherung'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = dirname(HIER)
const ECHTES_SKRIPT = join(WURZEL, 'scripts/mupibox/mupibox-sicherung.py')
const SEITE = join(WURZEL, 'src/frontend-admin/src/app/seiten/sicherung.ts')

/** Die Datei, die es in keinem Muster gibt — der eigentliche Versuchsaufbau. */
const NEUARTIG = 'neuartige-ablage.json'

/* ── Buchfuehrung ──────────────────────────────────────────────────────── */

let gut = 0
const schlecht: string[] = []
let ring = ''

function chk(satz: string, bedingung: boolean, mehr = ''): void {
  if (bedingung) {
    gut++
    console.log(`  ok    ${satz}`)
  } else {
    schlecht.push(`${ring}: ${satz}${mehr ? ` — ${mehr}` : ''}`)
    console.log(`  ROT   ${satz}${mehr ? `\n        ${mehr}` : ''}`)
  }
}

function kopf(name: string): void {
  ring = name
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 66 - name.length))}`)
}

/* ── Der Sandkasten ────────────────────────────────────────────────────── */

interface Kasten {
  wurzel: string
  etc: string
  config: string
  staende: string
  skript: string
}

/**
 * Die Pfadkonstanten von mupibox-sicherung.py in den Sandkasten biegen.
 *
 * ES WIRD GEZAEHLT, WIE VIELE ZEILEN GETROFFEN WURDEN, und ein Fehltreffer
 * ist ein Abbruch. Ohne vollstaendigen Patch liefe dieser Lauf gegen die
 * ECHTEN Verzeichnisse dieses Rechners — das waere kein ungenaues Ergebnis,
 * sondern ein Schaden. (Dieselbe Vorkehrung wie in
 * tools/sicherung-ohne-ssh-ring.ts; sie steht hier noch einmal, weil ein
 * Werkzeug, das seine eigene Sicherung importiert, sie beim Umbau des anderen
 * still verlieren kann.)
 */
function patchen(quelle: string, k: { box: string; staende: string; karte: string; etc: string; sperre: string }) {
  let text = readFileSync(quelle, 'utf8')
  const ersatz: [RegExp, string][] = [
    [/^BOX = "[^"]*"$/m, `BOX = ${JSON.stringify(k.box)}`],
    [/^STAENDE = "[^"]*"$/m, `STAENDE = ${JSON.stringify(k.staende)}`],
    [/^KARTE = "[^"]*"/m, `KARTE = ${JSON.stringify(k.karte)}`],
    [/^SPERRE = "[^"]*"/m, `SPERRE = ${JSON.stringify(k.sperre)}`],
    [/^ {4}"etc\/mupibox": "\/etc\/mupibox",$/m, `    "etc/mupibox": ${JSON.stringify(k.etc)},`],
  ]
  let treffer = 0
  for (const [muster, neu] of ersatz) {
    const vorher = text
    text = text.replace(muster, neu)
    if (text !== vorher) treffer++
  }
  return { text, treffer, erwartet: ersatz.length }
}

function sandkastenBauen(): Kasten {
  const wurzel = mkdtempSync(join(tmpdir(), 'mupi-warnung-'))
  const box = join(wurzel, 'box')
  const etc = join(wurzel, 'etc-mupibox')
  const config = join(box, 'server/config')
  const staende = join(wurzel, 'sicherungen')
  for (const d of [etc, config, staende, join(config, 'profile/gast')]) mkdirSync(d, { recursive: true })

  const schreib = (p: string, o: unknown) => writeFileSync(p, `${JSON.stringify(o, null, 4)}\n`)

  // ── Eine Box, auf der ALLES eingeordnet ist. Weniger als hier waere
  //    bequemer, aber Ring 1 („Stille im Normalfall") behauptet dann eine
  //    Stille, die nur aus Armut kommt.
  schreib(join(etc, 'mupiboxconfig.json'), {
    mupibox: { audioDevice: 'MuPiHAT', startVolume: 25, maxVolume: 75, mediaCheckTimer: 300 },
    interfacelogin: { state: false, password: '' },
    spotify: { clientId: 'kennung', clientSecret: '', refreshToken: '', accessToken: '' },
  })
  writeFileSync(join(etc, 'bt-adapter'), 'AA:BB:CC:DD:EE:FF\n')
  schreib(join(config, 'data.json'), [{ id: 'spotify:album:1', title: 'Hoerspiel', type: 'spotify' }])
  schreib(join(config, 'darstellung.json'), { thema: 'nacht' })
  schreib(join(config, 'kinderzeit.json'), { standard: 60, je: {} })
  schreib(join(config, 'verschmelzung.json'), { paare: [] })
  schreib(join(config, 'monitor.json'), { helligkeit: 60 })
  schreib(join(config, 'network.json'), { hostname: 'mupibox' })
  schreib(join(config, 'verfuegbarkeit.json'), {})
  schreib(join(config, 'vorlesen.json'), { stimme: 'de_DE-thorsten' })
  schreib(join(config, 'wlan.json'), [])
  schreib(join(config, 'config.json'), {})
  schreib(join(config, 'akkuverlauf.json'), { punkte: [] })
  schreib(join(config, 'profile.json'), {
    profile: [{ kennung: 'gast', name: 'Gast', figur: '', angelegt: 0 }],
    aktiv: 'gast',
  })
  const gast = join(config, 'profile/gast')
  schreib(join(gast, 'gespielt.json'), [])
  schreib(join(gast, 'kinderzeit-verbrauch.json'), {})
  schreib(join(gast, 'listen.json'), [])
  schreib(join(gast, 'resume.json'), {})
  schreib(join(gast, 'auswahl.json'), { erlaubt: [] })
  symlinkSync('profile/gast/resume.json', join(config, 'resume.json'))

  const gepatcht = patchen(ECHTES_SKRIPT, {
    box,
    staende,
    karte: join(wurzel, 'karte'),
    etc,
    sperre: join(wurzel, 'sperre'),
  })
  const skript = join(wurzel, 'mupibox-sicherung.py')
  writeFileSync(skript, gepatcht.text)
  chmodSync(skript, 0o755)

  kopf('Der Sandkasten steht')
  chk(
    `die Patchkopie greift (${gepatcht.treffer}/${gepatcht.erwartet} Konstanten umgebogen)`,
    gepatcht.treffer === gepatcht.erwartet,
    gepatcht.treffer === gepatcht.erwartet ? '' : 'Ohne vollstaendigen Patch liefe dieser Lauf gegen die ECHTEN Pfade.',
  )
  if (gepatcht.treffer !== gepatcht.erwartet) {
    console.log('\nNICHT WEITER — der Lauf wuerde die echten Verzeichnisse anfassen.')
    process.exit(1)
  }
  return { wurzel, etc, config, staende, skript }
}

/* ── Der eigene Server, auf einem eigenen Port ─────────────────────────── */

function serverStarten(k: Kasten, port: number, oberflaeche: string | null) {
  const app = express()
  // Die Wache der Verwaltungsseite fragt als erstes hier nach. Ohne diese
  // Antwort landet der Browser auf /anmeldung statt auf /sicherung — die
  // Seite waere dann nicht zu sehen, obwohl alles stimmt.
  app.get('/api/auth/state', (_q, s) => {
    s.json({ anmeldungNoetig: false, angemeldet: true, passwortGesetzt: false })
  })
  app.use(
    sicherungWegeBauen({
      skript: k.skript,
      staende: k.staende,
      // KEIN sudo im Sandkasten — alles gehoert dem laufenden Benutzer.
      vorspann: [],
      host: () => 'warn-box',
      anmeldungOffen: () => false,
    }),
  )
  if (oberflaeche) {
    app.use('/admin', express.static(oberflaeche))
    // Angular routet ueber Pfade; /admin/sicherung ist keine Datei.
    app.get(/^\/admin\//, (_q, s) => s.sendFile(join(oberflaeche, 'index.html')))
  }
  return new Promise<{ schliessen: () => void; basis: string }>((fertig, scheitern) => {
    const s = app.listen(port, '127.0.0.1')
    s.on('listening', () => fertig({ schliessen: () => s.close(), basis: `http://127.0.0.1:${port}` }))
    s.on('error', scheitern)
  })
}

interface Lage {
  ok: boolean
  nichtEingeordnet: { stand: string; erzeugt: string; pfade: string[]; satz: string; rat: string[] } | null
}

async function lageHolen(basis: string): Promise<Lage> {
  const a = await fetch(`${basis}/api/sicherung`)
  return (await a.json()) as Lage
}

/**
 * Sichern wie die Seite es tut — und die Kopfzeilen mitnehmen.
 *
 * DIE SEKUNDE PAUSE IST KEINE BEQUEMLICHKEIT, sondern eine gemessene
 * Eigenschaft der Box: der Dateiname eines Standes traegt den Zeitstempel auf
 * die SEKUNDE genau (mupibox-sicherung.py, `strftime("%Y%m%d-%H%M%S")`). Zwei
 * `--anlegen` in derselben Sekunde ergeben denselben Namen; der zweite
 * ueberschreibt den ersten, der Weg findet danach keinen NEUEN Namen und
 * antwortet mit 500 („kein neuer Stand entstanden"). Ohne diese Pause misst
 * dieser Lauf also nicht die Warnung, sondern jenen Zusammenstoss.
 */
async function anlegen(basis: string): Promise<{ status: number; nichtEingeordnet: number; dateien: number }> {
  await new Promise((f) => setTimeout(f, 1100))
  const a = await fetch(`${basis}/api/sicherung/anlegen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const bytes = Buffer.from(await a.arrayBuffer())
  return {
    status: a.status,
    nichtEingeordnet: Number(a.headers.get('X-Mupi-Nicht-Eingeordnet') ?? '-1'),
    // Nur damit die Antwort auch wirklich gelesen wurde: es sind Bytes.
    dateien: bytes.length > 0 ? Number(a.headers.get('X-Mupi-Dateien') ?? '0') : -1,
  }
}

/* ── Los ───────────────────────────────────────────────────────────────── */

async function main(): Promise<number> {
  const i = process.argv.indexOf('--port')
  const port = i > 0 ? Number(process.argv[i + 1]) : 9601
  const j = process.argv.indexOf('--oberflaeche')
  const oberflaeche = j > 0 ? String(process.argv[j + 1]) : null
  const stehenlassen = process.argv.includes('--stehenlassen')
  if (oberflaeche && !existsSync(join(oberflaeche, 'index.html'))) {
    console.log(`\n--oberflaeche ${oberflaeche}: dort liegt keine index.html. Erst bauen:`)
    console.log('  cd src/frontend-admin && npx ng build --output-path=<verz>')
    return 1
  }

  const k = sandkastenBauen()
  const { schliessen, basis } = await serverStarten(k, port, oberflaeche)
  console.log(`        eigener Server auf ${basis}`)

  try {
    /* ══ Ring 1 — Stille im Normalfall ═════════════════════════════════ */
    kopf('Ring 1: eine eingeordnete Box sagt GAR NICHTS')
    const a1 = await anlegen(basis)
    chk('die Sicherung entsteht', a1.status === 200 && a1.dateien > 0, `Status ${a1.status}`)
    chk('der Download meldet 0 nicht eingeordnete Ablagen', a1.nichtEingeordnet === 0, `${a1.nichtEingeordnet}`)
    const l1 = await lageHolen(basis)
    chk(
      'die Seite bekommt NICHTS zu zeigen (null, keine leere Huelse)',
      l1.nichtEingeordnet === null,
      JSON.stringify(l1.nichtEingeordnet),
    )

    /* ══ Ring 2 — das bewusst Draussene ════════════════════════════════ */
    //
    // DER WICHTIGSTE RING. Waeren diese vier eine Warnung, stuende bei JEDER
    // Sicherung eine da — und eine Warnung, die immer da steht, ist keine.
    kopf('Ring 2: was ABSICHTLICH draussen bleibt, warnt NICHT')
    mkdirSync(join(k.config, 'coverspeicher'), { recursive: true })
    writeFileSync(join(k.config, 'coverspeicher/abc.jpg'), 'nicht wirklich ein Bild')
    writeFileSync(join(k.config, 'data.json.bak'), '{}\n')
    writeFileSync(join(k.config, 'data-vor-aufraeumen-20260801.json'), '{}\n')
    symlinkSync('data.json', join(k.config, 'active_data.json'))
    mkdirSync(join(k.etc, 'tls'), { recursive: true })
    writeFileSync(join(k.etc, 'tls/schluessel.pem'), 'GEHEIM\n')
    const a2 = await anlegen(basis)
    chk('die Sicherung entsteht weiterhin', a2.status === 200, `Status ${a2.status}`)
    chk(
      'Coverspeicher, .bak, Altlast, Verweis und Schluesselmaterial warnen NICHT',
      a2.nichtEingeordnet === 0,
      `${a2.nichtEingeordnet} statt 0 — die Warnung waere ab jetzt Rauschen`,
    )
    const l2 = await lageHolen(basis)
    chk('die Seite bekommt weiterhin NICHTS zu zeigen', l2.nichtEingeordnet === null)

    /* ══ Ring 3 — die neue Ablage ══════════════════════════════════════ */
    kopf('Ring 3: eine Ablage, die in KEINEM Muster steht, faellt auf')
    writeFileSync(
      join(k.config, NEUARTIG),
      `${JSON.stringify({ was: 'etwas, das es gestern noch nicht gab', wichtig: true }, null, 2)}\n`,
    )
    const a3 = await anlegen(basis)
    chk(
      'der Download meldet sie im Kopf — dort, wo sonst nur die Bytes sind',
      a3.nichtEingeordnet === 1,
      `X-Mupi-Nicht-Eingeordnet: ${a3.nichtEingeordnet}`,
    )
    const l3 = await lageHolen(basis)
    chk('die Seite bekommt etwas zu zeigen', l3.nichtEingeordnet !== null)
    const n = l3.nichtEingeordnet
    chk(
      `sie nennt den PFAD (server/config/${NEUARTIG})`,
      n?.pfade.includes(`server/config/${NEUARTIG}`) === true,
      JSON.stringify(n?.pfade),
    )
    chk('sie sagt, dass die Datei in KEINE Sicherung geht', /KEINE Sicherung/.test(n?.satz ?? ''), n?.satz)
    chk(
      'sie sagt, was das BEDEUTET (nach einem Kartenschaden weg)',
      (n?.rat ?? []).some((r) => /Kartenschaden/.test(r)),
    )
    chk(
      'sie sagt, WER etwas tun kann (Fehler in der Software, nicht in der Bedienung)',
      (n?.rat ?? []).some((r) => /Box-Software/.test(r)),
    )
    chk(
      'sie nimmt die Angst vorm Zurueckspielen, statt sie zu machen',
      (n?.rat ?? []).some((r) => /Zurückspielen/.test(r)),
    )
    chk('sie sagt, aus welchem Stand der Befund kommt', /^mupibox-sicherung-/.test(n?.stand ?? ''), n?.stand)

    // Und die Gegenprobe: weg damit, und es ist wieder still. Ohne diesen
    // Schritt koennte die Warnung auch einfach kleben bleiben.
    rmSync(join(k.config, NEUARTIG))
    const a4 = await anlegen(basis)
    chk('nach dem Aufraeumen ist es wieder still', a4.nichtEingeordnet === 0, `${a4.nichtEingeordnet}`)
    chk('… auch auf der Seite', (await lageHolen(basis)).nichtEingeordnet === null)

    /* ══ Ring 4 — am Bildschirm ════════════════════════════════════════ */
    //
    // Ein Backend, das es sagt, und eine Seite, die es wegwirft, waere
    // derselbe Fehler eine Etage hoeher. Gelesen wird die Vorlage der
    // Komponente, nicht ein Bau — ein Bau kann alt sein.
    kopf('Ring 4: die Verwaltungsseite zeigt es auch')
    const seite = readFileSync(SEITE, 'utf8')
    chk('die Lage-Schnittstelle kennt das Feld', /nichtEingeordnet: NichtEingeordnet \| null/.test(seite))
    chk('die Vorlage zeigt es nur, wenn etwas anliegt', /@if \(l\.nichtEingeordnet; as n\)/.test(seite))
    chk('sie schreibt den Satz hin', /\{\{ n\.satz \}\}/.test(seite))
    chk('sie zaehlt die Pfade auf', /@for \(p of n\.pfade; track p\)/.test(seite))
    chk('sie zaehlt auf, was daraus folgt', /@for \(r of n\.rat; track r\)/.test(seite))
    chk('die Karte ist die auffaellige (ernst), nicht eine stille Zeile', /karte ernst[\s\S]{0,200}n\.satz/.test(seite))
    chk(
      'der Erfolgssatz nach dem Sichern schraenkt sich selbst ein',
      /X-Mupi-Nicht-Eingeordnet/.test(seite) && /NICHT dabei/.test(seite),
    )
    chk(
      'auch die Vorschau vorm Zurueckspielen zeigt, was der Stand nie enthielt',
      /v\.stand\.nichtEingeordnet\.pfade\.length/.test(seite),
    )

    if (oberflaeche) {
      // Damit man es wirklich ANSEHEN kann: die Ablage wieder hinlegen und
      // einen Stand darueber anlegen, damit die Lage sie meldet.
      writeFileSync(join(k.config, NEUARTIG), '{"was":"etwas, das es gestern noch nicht gab"}\n')
      await anlegen(basis)
      console.log(`\n        Zum Ansehen:  ${basis}/admin/sicherung`)
    }
  } finally {
    if (stehenlassen) {
      console.log(`\n        --stehenlassen: Server bleibt oben, Sandkasten: ${k.wurzel}`)
      console.log('        Beenden mit Strg-C.')
    } else {
      schliessen()
      rmSync(k.wurzel, { recursive: true, force: true })
    }
  }

  console.log(`\n${'═'.repeat(70)}`)
  if (schlecht.length === 0) {
    console.log(`  ${gut} Aussagen, alle gruen. Die Warnung hat einen Empfaenger.`)
    return 0
  }
  console.log(`  ${gut} gruen, ${schlecht.length} ROT:`)
  for (const s of schlecht) console.log(`    ${s}`)
  return 1
}

// Kein `await` auf oberster Ebene: dieses Verzeichnis wird als CommonJS
// uebersetzt (wie tools/sicherung-ohne-ssh-ring.ts), und dort gibt es das
// nicht. Der Fehlerfall geht ABSICHTLICH mit Ende 1 hinaus statt als
// Stapelabzug — ein Werkzeug, das beim Scheitern anders aussieht als beim
// Rotwerden, wird beim Scheitern uebersehen.
main().then(
  (ende) => {
    if (!process.argv.includes('--stehenlassen')) process.exit(ende)
  },
  (e: unknown) => {
    console.log(`\nABGEBROCHEN: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  },
)
