/**
 * HABEN WIR ZU VIEL ZUGEMACHT? — der Papierkorb gegen ECHTE Albumnamen.
 *
 * tools/loeschen-sandkasten.ts fragt: „faellt der Angriff durch?"
 * DIESES Werkzeug fragt die andere Haelfte, und die meldet niemand:
 *
 *     Welches Album, das ein Elternteil WIRKLICH auf der Box hat, laesst
 *     sich seit dem 07.08.2026 nicht mehr ueber den Muelleimer loeschen?
 *
 * Ein Schutz, der auch das Richtige verhindert, wird umgangen — dann wird von
 * Hand ueber SSH geloescht, oder es wird gar nicht mehr aufgeraeumt und die
 * Karte laeuft voll. Beides ist schlimmer als der Fehler, gegen den der Schutz
 * gebaut wurde.
 *
 * WIE GEMESSEN WIRD: fuer jeden Namen wird im Sandkasten ein ECHTER Ordner mit
 * ECHTEN Dateien angelegt, die Kette der Box darueber gefahren
 *
 *     player.service.ts:233  ->  spotify-control.ts (req.url)  ->  loeschen.ts
 *
 * und danach NACHGESEHEN, ob der Ordner weg ist. Kein Nachbau der Regeln —
 * sonst pruefte das Werkzeug, wie ich die Regeln verstehe.
 *
 * Zusaetzlich laeuft derselbe Name durch die ALTE Fassung (Shell + `rm -r`),
 * damit „geht nicht mehr" von „ging noch nie" unterschieden werden kann. Nur
 * das erste ist ein Rueckschritt.
 *
 * SANDKASTEN: `mkdtemp` unter dem Temp-Verzeichnis, Abbruch wenn die Wurzel
 * woanders liegt, am Ende aufgeraeumt. Die Box wird nicht beruehrt.
 *
 *     npx tsx tools/loeschen-echte-namen.ts
 *     npx tsx tools/loeschen-echte-namen.ts --behalten
 *
 * Rueckgabewert 0, wenn jeder Name so ausging wie hier erwartet.
 */

import { exec } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { loeschenAusfuehren, loeschgliedAusUrl } from '../src/backend-player/src/loeschen'

const BEHALTEN = process.argv.includes('--behalten')

/** Was die Oberflaeche schickt (player.service.ts:233), Zeichen fuer Zeichen. */
const urlBauen = (k: string, i: string, t: string) =>
  `/current/deletelocal/${encodeURIComponent(k)}:${encodeURIComponent(i)}:${encodeURIComponent(t)}`

/** Die alte Fassung, nachgebaut (spotify-control.ts bis 07.08.2026). */
function altBefehl(url: string, wurzel: string): string | null {
  const name = path.parse(url.split('?')[0]).name
  try {
    return `rm -r "${wurzel}/${decodeURIComponent(decodeURI(name).replace(/:/g, '/'))}"`
  } catch {
    return null
  }
}
const altAusfuehren = (cmd: string) =>
  new Promise<void>((fertig) => exec(cmd, () => fertig()))

// ── DIE NAMEN ────────────────────────────────────────────────────────────────
//
// Jeder einzelne ist ein LEGALER Verzeichnisname unter Linux, und jeder ist
// auf einer Kinder-Hoerbuchbox plausibel. Wo das nicht so ist, steht es dabei.

type Fall = {
  name: string
  kategorie: string
  interpret: string
  titel: string
  /** Erwartung an die NEUE Fassung. */
  sollLoeschen: boolean
  warum: string
}

const FAELLE: Fall[] = [
  {
    name: 'Punkt im Titel (der Anlass der Reparatur)',
    kategorie: 'audiobook',
    interpret: 'Benjamin Bluemchen',
    titel: 'Folge 12. Der Ausflug',
    sollLoeschen: true,
    warum: 'ALT traf den Nachbarn. NEU muss genau dieses Album treffen.',
  },
  {
    name: 'Abkuerzungspunkt',
    kategorie: 'music',
    interpret: 'Rolf Zuckowski',
    titel: 'Vol. 2',
    sollLoeschen: true,
    warum: 'ALT traf „Vol" — den es nicht gibt.',
  },
  {
    name: 'Fragezeichen im Namen',
    kategorie: 'audiobook',
    interpret: 'Die drei ???',
    titel: 'Folge 001 - Und der Super-Papagei',
    sollLoeschen: true,
    warum: 'Die meistverkaufte Kinderhoerspielreihe im deutschen Sprachraum.',
  },
  {
    name: 'Kaufmaennisches Und',
    kategorie: 'audiobook',
    interpret: 'Bibi & Tina',
    titel: 'Folge 1 — Das Sprechende Pferd',
    sollLoeschen: true,
    warum: '`&` haette in einer Shell den Befehl in den Hintergrund geschickt.',
  },
  {
    name: 'Doppelpunkt im Titel',
    kategorie: 'audiobook',
    interpret: 'Wickie',
    titel: 'Staffel 1: Der Anfang',
    sollLoeschen: true,
    warum:
      'Der Doppelpunkt ist der TRENNER in dieser URL. Die Oberflaeche kodiert ' +
      'ihn als %3A; wird VOR dem Entschluesseln getrennt, geht das gut. ' +
      'Ein Fehler hier hiesse: dieses Album ist nicht loeschbar.',
  },
  {
    name: 'Prozentzeichen im Titel',
    kategorie: 'music',
    interpret: 'Kinderlieder',
    titel: '100% Sommer',
    sollLoeschen: true,
    warum: 'Ein einzelnes % wirft URIError. Kodiert als %25 darf es nicht.',
  },
  {
    name: 'Umlaute und scharfes S',
    kategorie: 'audiobook',
    interpret: 'Raeuber Hotzenplotz',
    titel: 'Groesste Schaetze — Fuenf Suesse Straeusse',
    sollLoeschen: true,
    warum: 'Selbstverstaendlich, und genau deshalb gemessen.',
  },
  {
    name: 'Fuehrender Punkt im Ordnernamen',
    kategorie: 'audiobook',
    interpret: 'Sandmann',
    titel: '.zwischengespeichert',
    sollLoeschen: true,
    warum:
      'Ein Ordner mit fuehrendem Punkt ist ein gewoehnlicher Ordner. Er darf ' +
      'nicht mit „.` oder `..`" verwechselt werden — das waere zu viel zugemacht.',
  },
  {
    name: 'Zwei Punkte MITTEN im Namen',
    kategorie: 'audiobook',
    interpret: 'Sandmann',
    titel: 'Teil 1..3',
    sollLoeschen: true,
    warum: '`..` als TEIL eines Namens ist kein Aufstieg. Nur der ganze Name.',
  },
  {
    name: 'Ordner, der nur aus drei Punkten besteht',
    kategorie: 'audiobook',
    interpret: 'Sandmann',
    titel: '...',
    sollLoeschen: true,
    warum: '„..." ist ein ganz normaler Ordnername, nur „." und „.." sind es nicht.',
  },
  {
    name: 'Leerzeichen vorn und hinten',
    kategorie: 'audiobook',
    interpret: ' Bibi ',
    titel: ' Folge 3 ',
    sollLoeschen: true,
    warum:
      'Entsteht beim Auspacken eines Archivs. `trim()` prueft nur auf LEER — ' +
      'wuerde es auch abschneiden, zeigte der Pfad auf einen anderen Ordner.',
  },
  {
    name: 'Emoji im Titel',
    kategorie: 'music',
    interpret: 'Kinderlieder',
    titel: 'Gute Nacht 🌙',
    sollLoeschen: true,
    warum: 'Von Hand benannt, kommt vor.',
  },
  {
    name: 'Rueckwaertsschraegstrich im Interpretennamen',
    kategorie: 'music',
    interpret: 'AC\\DC',
    titel: 'Album',
    sollLoeschen: true,
    warum:
      'UNTER LINUX EIN LEGALES ZEICHEN IM DATEINAMEN. Er ist KEIN Pfadtrenner ' +
      '— nur unter Windows. DIESER FALL WAR ROT: die erste Fassung von ' +
      'loeschen.ts wies ihn ab („enthaelt einen Schraegstrich"), ALT loeschte ' +
      'ihn. Seit 07.08.2026 steht `\\` nicht mehr in KEIN_NAME.',
  },
  {
    name: 'Ordner, der nur aus einem Leerzeichen besteht',
    kategorie: 'audiobook',
    interpret: 'Sandmann',
    titel: ' ',
    sollLoeschen: false,
    warum:
      'Legal, aber nicht plausibel — und nicht vom Muelleimer erzeugbar. ' +
      'Hier ist Zumachen vertretbar; steht nur da, damit es GEMESSEN ist.',
  },
]

// ── SANDKASTEN ───────────────────────────────────────────────────────────────

async function anlegen(medien: string, f: Fall): Promise<string> {
  const ordner = path.join(medien, f.kategorie, f.interpret, f.titel)
  await fsp.mkdir(ordner, { recursive: true })
  await fsp.writeFile(path.join(ordner, '01.mp3'), 'ton')
  return ordner
}

async function daNoch(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p)
    return true
  } catch {
    return false
  }
}

async function frisch(): Promise<string> {
  const wurzel = await fsp.mkdtemp(path.join(os.tmpdir(), 'mupi-echte-namen-'))
  const echt = await fsp.realpath(os.tmpdir())
  if (!(await fsp.realpath(wurzel)).startsWith(echt)) {
    throw new Error(`Sandkasten liegt nicht im Temp-Verzeichnis: ${wurzel}`)
  }
  return wurzel
}

// ── ZUSATZFALL: DAS ALBUM LIEGT AUF EINEM USB-STICK ──────────────────────────
//
// Eine haeufige MuPiBox-Aufstellung: die Medien liegen auf einem Stick, und im
// Medienordner steht ein VERWEIS darauf. Fuer das Loeschen ist das die Frage,
// an der sich „Schutz" und „zu viel zugemacht" trennen.

async function verweisFaelle(): Promise<{ zeile: string; gut: boolean }[]> {
  const raus: { zeile: string; gut: boolean }[] = []
  const wurzel = await frisch()
  const medien = path.join(wurzel, 'media')
  const stick = path.join(wurzel, 'usb')

  // (a) das ALBUM selbst ist ein Verweis auf einen Ordner am Stick
  await fsp.mkdir(path.join(stick, 'Album A'), { recursive: true })
  await fsp.writeFile(path.join(stick, 'Album A', '01.mp3'), 'ton')
  await fsp.mkdir(path.join(medien, 'audiobook', 'Stick'), { recursive: true })
  await fsp.symlink(path.join(stick, 'Album A'), path.join(medien, 'audiobook', 'Stick', 'Album A'))

  // (b) der INTERPRET ist ein Verweis auf einen Ordner am Stick
  await fsp.mkdir(path.join(stick, 'Interpret B', 'Album B'), { recursive: true })
  await fsp.writeFile(path.join(stick, 'Interpret B', 'Album B', '01.mp3'), 'ton')
  await fsp.symlink(path.join(stick, 'Interpret B'), path.join(medien, 'audiobook', 'Interpret B'))

  // (c) die WURZEL selbst ist ein Verweis (media -> /mnt/usb/media).
  //     Das ist die haeufigste Bauart und MUSS gehen.
  const wurzel2 = await frisch()
  const echteMedien = path.join(wurzel2, 'platte', 'media')
  await fsp.mkdir(path.join(echteMedien, 'audiobook', 'Interpret C', 'Album C'), { recursive: true })
  await fsp.writeFile(path.join(echteMedien, 'audiobook', 'Interpret C', 'Album C', '01.mp3'), 'ton')
  await fsp.symlink(echteMedien, path.join(wurzel2, 'media'))

  const proben: [string, string, string, string, string, boolean, string][] = [
    [
      'ALBUM ist ein Verweis auf den USB-Stick',
      medien,
      'audiobook',
      'Stick',
      'Album A',
      false,
      'wird abgelehnt („ist eine Verknuepfung"). Der Betreiber kommt ueber den ' +
        'Muelleimer nicht mehr an dieses Album — vorher raeumte `rm -r` den Verweis weg.',
    ],
    [
      'INTERPRET ist ein Verweis auf den USB-Stick',
      medien,
      'audiobook',
      'Interpret B',
      'Album B',
      false,
      'wird abgelehnt (aufgeloest liegt es ausserhalb). Genau der Schutz — und ' +
        'genau die Aufstellung „Medien auf dem Stick, Verweis im Ordner".',
    ],
    [
      'die WURZEL media ist ein Verweis (die haeufige Bauart)',
      path.join(wurzel2, 'media'),
      'audiobook',
      'Interpret C',
      'Album C',
      true,
      'muss gehen — sonst waere auf halben Boxen gar nichts mehr loeschbar.',
    ],
  ]

  for (const [name, mw, k, i, t, sollWeg, satz] of proben) {
    const ziel = path.join(mw, k, i, t)
    const ausgang = await loeschenAusfuehren(loeschgliedAusUrl(urlBauen(k, i, t)), mw)
    const weg = !(await daNoch(ziel))
    const gut = weg === sollWeg
    raus.push({
      zeile:
        `${gut ? 'ok    ' : 'ACHTUNG'} ${name}\n` +
        `        geloescht: ${weg ? 'ja' : 'NEIN'}   erwartet: ${sollWeg ? 'ja' : 'nein'}\n` +
        `        Antwort:   ${ausgang.ok ? 'ok ' + ausgang.pfad : ausgang.grund}\n` +
        `        ${satz}`,
      gut,
    })
  }

  if (!BEHALTEN) {
    await fsp.rm(wurzel, { recursive: true, force: true })
    await fsp.rm(wurzel2, { recursive: true, force: true })
  }
  return raus
}

// ── LAUF ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  let rot = 0
  let rueckschritte = 0
  console.log('DER PAPIERKORB GEGEN ECHTE ALBUMNAMEN — alt gegen neu\n')

  for (const f of FAELLE) {
    // NEU
    const wNeu = await frisch()
    const mNeu = path.join(wNeu, 'media')
    const zielNeu = await anlegen(mNeu, f)
    const url = urlBauen(f.kategorie, f.interpret, f.titel)
    const ausgang = await loeschenAusfuehren(loeschgliedAusUrl(url), mNeu)
    const wegNeu = !(await daNoch(zielNeu))

    // ALT — dieselbe URL, damit wirklich dasselbe verglichen wird
    const wAlt = await frisch()
    const mAlt = path.join(wAlt, 'media')
    const zielAlt = await anlegen(mAlt, f)
    const cmd = altBefehl(url, mAlt)
    if (cmd) await altAusfuehren(cmd)
    const wegAlt = !(await daNoch(zielAlt))

    const gut = wegNeu === f.sollLoeschen
    if (!gut) rot++
    const rueckschritt = wegAlt && !wegNeu
    if (rueckschritt) rueckschritte++

    console.log(`${gut ? 'ok    ' : 'ROT   '} ${f.name}`)
    console.log(`        ${f.kategorie}/${f.interpret}/${f.titel}`)
    console.log(
      `        NEU: ${wegNeu ? 'geloescht' : 'NICHT geloescht'}` +
        `   ALT: ${wegAlt ? 'geloescht' : 'nicht geloescht'}` +
        `${rueckschritt ? '   <<< RUECKSCHRITT: ging vorher, geht jetzt nicht' : ''}`,
    )
    if (!ausgang.ok) console.log(`        Grund:  ${ausgang.grund}`)
    console.log(`        ${f.warum}`)
    console.log()

    if (!BEHALTEN) {
      await fsp.rm(wNeu, { recursive: true, force: true })
      await fsp.rm(wAlt, { recursive: true, force: true })
    }
  }

  console.log('MEDIEN AUF EINEM USB-STICK — Verweise\n')
  for (const v of await verweisFaelle()) {
    console.log(v.zeile)
    console.log()
    if (!v.gut) rot++
  }

  console.log(`${FAELLE.length + 3} Faelle, ${rot} nicht wie erwartet, ${rueckschritte} Rueckschritte gegenueber ALT.`)
  return rot === 0 ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (fehler) => {
    console.error(fehler)
    process.exit(2)
  },
)
