/**
 * DER PAPIERKORB, GEGEN ECHTE ORDNER GEFAHREN — alt gegen neu.
 *
 * WOZU: `src/backend-player/src/loeschen.spec.ts` prueft die ENTSCHEIDUNG.
 * Dieses Werkzeug prueft die WIRKUNG: es legt unter /tmp einen Medienordner
 * mit echten Dateien an, faehrt DIESELBE Kette wie die Box darueber —
 *
 *     1. player.service.ts:233   `deletelocal/${enc(cat)}:${enc(artist)}:${enc(title)}`
 *     2. spotify-control.ts      das Glied aus `req.url` holen
 *     3. loeschen.ts             pruefen und wirklich loeschen
 *
 * — und sieht danach NACH, was verschwunden ist. Jeder Fall laeuft zweimal,
 * in zwei frischen Sandkaesten: einmal ueber die ALTE Fassung (`rm -r` durch
 * eine Shell, hier Zeichen fuer Zeichen nachgebaut), einmal ueber die neue.
 * Die alte Fassung wird dabei WIRKLICH AUSGEFUEHRT — anders liesse sich nicht
 * zeigen, dass sie das Falsche trifft.
 *
 * WAS ES AENDERT: nichts ausserhalb seines Sandkastens. Der Sandkasten wird
 * mit `mkdtemp` unter dem Temp-Verzeichnis angelegt, das Werkzeug BRICHT AB,
 * wenn die Wurzel nicht dort liegt, und raeumt am Ende auf. Es beruehrt die
 * Box nicht und /home/dietpi/MuPiBox/media schon gar nicht.
 *
 * AUFRUF (aus dem Repo-Wurzelverzeichnis):
 *     npx tsx tools/loeschen-sandkasten.ts
 *     npx tsx tools/loeschen-sandkasten.ts --behalten   (Sandkaesten stehen lassen)
 *
 * Rueckgabewert 0, wenn jeder Fall so ausging wie erwartet — sonst 1.
 *
 * DIE GEGENPROBE STEHT ALS ERSTER FALL, nicht als letzter: ein Schutz, der
 * auch das Richtige verhindert, wird umgangen, und dann war die ganze Arbeit
 * umsonst. Wer hier etwas verschaerft, sieht sofort, ob das Loeschen noch
 * loescht.
 */

import { exec } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { loeschenAusfuehren, loeschgliedAusUrl, MEDIEN_WURZEL } from '../src/backend-player/src/loeschen'

const BEHALTEN = process.argv.includes('--behalten')

// ── DER SANDKASTEN ───────────────────────────────────────────────────────────

/**
 * Ein Medienordner, wie er auf einer benutzten Box aussieht — mit dem Fall,
 * der Fehler A so teuer macht: „Folge 12" UND „Folge 12. Der Ausflug" liegen
 * nebeneinander. Das ist keine Konstruktion, sondern die uebliche Mischung
 * aus einer Serie, die mal mit und mal ohne Untertitel benannt wurde.
 */
async function sandkastenBauen(): Promise<string> {
  const wurzel = await fsp.mkdtemp(path.join(os.tmpdir(), 'mupi-papierkorb-'))
  if (!wurzel.startsWith(await fsp.realpath(os.tmpdir()))) {
    throw new Error(`Sandkasten liegt nicht im Temp-Verzeichnis: ${wurzel}`)
  }
  const medien = path.join(wurzel, 'media')

  const alben: [string, string, string][] = [
    ['audiobook', 'Benjamin', 'Folge 12. Der Ausflug'],
    ['audiobook', 'Benjamin', 'Folge 12'],
    ['audiobook', 'Benjamin', 'Folge 13'],
    ['audiobook', 'Bibi', 'Folge 1'],
    ['audiobook', 'Bibi', 'Folge 2'],
    ['music', 'Rolf Zuckowski', 'Vol. 2'],
  ]
  for (const [k, i, t] of alben) {
    const ordner = path.join(medien, k, i, t)
    await fsp.mkdir(ordner, { recursive: true })
    await fsp.writeFile(path.join(ordner, '01.mp3'), `ton ${k}/${i}/${t}`)
    await fsp.writeFile(path.join(ordner, 'playlist.m3u'), '01.mp3\n')
  }

  // Die selbst aufgenommene Gute-Nacht-Geschichte — der Grund, warum es hier
  // um mehr als Datenbankzeilen geht. Sie liegt AUSSERHALB des Medienordners
  // und darf von einem Loeschbefehl nie erreichbar sein.
  await fsp.mkdir(path.join(wurzel, 'draussen/Album'), { recursive: true })
  await fsp.writeFile(path.join(wurzel, 'draussen/oma-erzaehlt.mp3'), 'unersetzlich')
  await fsp.symlink(path.join(wurzel, 'draussen'), path.join(medien, 'audiobook/Fremd'))

  return wurzel
}

/** Alles, was im Sandkasten steht — relativ, sortiert, Verknuepfungen als
 *  solche (kein Verfolgen: sonst wuerde das Aufzaehlen selbst hinauslaufen). */
async function bestand(wurzel: string): Promise<string[]> {
  const raus: string[] = []
  async function ab(ordner: string) {
    const eintraege = await fsp.readdir(ordner, { withFileTypes: true })
    for (const e of eintraege.sort((a, b) => a.name.localeCompare(b.name))) {
      const voll = path.join(ordner, e.name)
      raus.push(path.relative(wurzel, voll) + (e.isDirectory() ? '/' : ''))
      if (e.isDirectory() && !e.isSymbolicLink()) await ab(voll)
    }
  }
  await ab(wurzel)
  return raus
}

// ── GLIED 1: WAS DIE OBERFLAECHE SCHICKT ─────────────────────────────────────

const urlBauen = (kategorie: string, interpret: string, titel: string) =>
  `/current/deletelocal/${encodeURIComponent(kategorie)}:${encodeURIComponent(interpret)}:${encodeURIComponent(titel)}`

// ── DIE ALTE FASSUNG, ZEICHEN FUER ZEICHEN ───────────────────────────────────

/**
 * spotify-control.ts, Stand bis 07.08.2026:
 *
 *     const command = path.parse(req.url)                       // .name!
 *     const deleteFilePath = decodeURI(deleteFile).replace(/:/g, '/')
 *     const deleteCMD = `rm -r ".../media/${decodeURIComponent(deleteFilePath)}"`
 *     exec(deleteCMD, …)
 */
function altBefehl(url: string, wurzel: string): string | null {
  const name = path.parse(url.split('?')[0]).name
  try {
    const p = decodeURI(name).replace(/:/g, '/')
    return `rm -r "${wurzel}/${decodeURIComponent(p)}"`
  } catch {
    // Der alte Weg WARF hier (URIError bei einem einzelnen `%`) — im
    // Verteiler wurde daraus eine 500er Antwort.
    return null
  }
}

function altAusfuehren(cmd: string): Promise<string> {
  return new Promise((fertig) => {
    exec(cmd, (e: unknown) => fertig(e ? `Shell meldete Fehler: ${(e as Error).message.split('\n')[0]}` : 'ok'))
  })
}

// ── DIE FAELLE ───────────────────────────────────────────────────────────────

type Fall = {
  name: string
  /**
   * Die ANFRAGE, so wie sie beim Abspieldienst ankaeme. Beide Wege — der alte
   * und der neue — bekommen genau diese Zeichenkette; nur so vergleicht das
   * Werkzeug wirklich dasselbe. Der Sandkastenpfad wird durchgereicht, weil
   * ein Fall (der Ausbruch aus der Shell) seinen Beleg dort ablegen will.
   */
  url: (wurzel: string) => string
  /** Was NEU verschwinden lassen SOLL. Leer heisst: gar nichts. */
  sollWeg: string[]
  /** Soll NEU ablehnen? */
  sollAblehnen: boolean
  warum: string
}

/** Eine Anfrage, wie die Oberflaeche sie stellt (player.service.ts:233). */
const wieOberflaeche = (kategorie: string, interpret: string, titel: string) => () =>
  urlBauen(kategorie, interpret, titel)

/** Eine GEFAELSCHTE Anfrage — dieselbe Form, aber von Hand geschrieben. Die
 *  API steht in der Vorgabe ohne Anmeldung im Heimnetz offen; das hier ist
 *  also kein Gedankenspiel, sondern ein `curl`. */
const rohesGlied = (glied: (wurzel: string) => string) => (wurzel: string) => `/current/deletelocal/${glied(wurzel)}`

const FAELLE: Fall[] = [
  {
    name: 'DIE GEGENPROBE — das gewollte Album',
    url: wieOberflaeche('audiobook', 'Benjamin', 'Folge 12. Der Ausflug'),
    sollWeg: ['media/audiobook/Benjamin/Folge 12. Der Ausflug/'],
    sollAblehnen: false,
    warum:
      'Loeschen muss loeschen. Sonst wird der Schutz umgangen. — Und hier ' +
      'zeigt sich Fehler A von seiner schlimmsten Seite: neben dem gewollten ' +
      'Album liegt „Folge 12", und genau das trifft ALT.',
  },
  {
    name: 'A — der Punkt im Titel („Vol. 2")',
    url: wieOberflaeche('music', 'Rolf Zuckowski', 'Vol. 2'),
    sollWeg: ['media/music/Rolf Zuckowski/Vol. 2/'],
    sollAblehnen: false,
    warum: 'ALT schnitt am letzten Punkt ab und traf „Vol" — es gibt keinen.',
  },
  {
    name: 'B — leerer Titel',
    url: wieOberflaeche('audiobook', 'Bibi', ''),
    sollWeg: [],
    sollAblehnen: true,
    warum: 'ALT loescht ALLE Alben des Interpreten.',
  },
  {
    name: 'B — leerer Interpret und Titel',
    url: wieOberflaeche('audiobook', '', ''),
    sollWeg: [],
    sollAblehnen: true,
    warum: 'ALT loescht die ganze Kategorie.',
  },
  {
    name: 'C — Ausbruch aus der Shell',
    url: rohesGlied((w) => `audiobook:Bibi:${encodeURIComponent(`x" ; touch ${w}/beleg ; "`)}`),
    sollWeg: [],
    sollAblehnen: true,
    warum: 'ALT fuehrt das eingeschobene Kommando aus (Beleg im Sandkasten).',
  },
  {
    name: 'C — doppelt verschluesseltes `../Benjamin`',
    url: rohesGlied(() => 'audiobook:Bibi:%252e%252e%252fBenjamin'),
    sollWeg: [],
    sollAblehnen: true,
    warum:
      'ALT entschluesselt ZWEIMAL (decodeURI, dann decodeURIComponent): aus ' +
      '`%252e%252e%252fBenjamin` wird `../Benjamin`, und das ist der Ordner des ' +
      'NACHBAR-Interpreten. Ein blosses `..` haette GNU-rm noch selbst ' +
      'verweigert („wird uebersprungen"); mit einem Ziel dahinter verweigert ' +
      'es nichts mehr.',
  },
  {
    name: 'Verknuepfung zeigt aus dem Medienordner heraus',
    url: wieOberflaeche('audiobook', 'Fremd', 'Album'),
    sollWeg: [],
    sollAblehnen: true,
    warum: 'ALT folgt ihr und loescht ausserhalb von media.',
  },
  {
    name: 'ein Album, das es nicht gibt',
    url: wieOberflaeche('audiobook', 'Bibi', 'Folge 99'),
    sollWeg: [],
    sollAblehnen: true,
    warum: 'ALT meldete trotzdem Erfolg — der Betreiber glaubte, Platz zu haben.',
  },
]

// ── DER LAUF ─────────────────────────────────────────────────────────────────

function verschwunden(vorher: string[], nachher: string[]): string[] {
  const da = new Set(nachher)
  return vorher.filter((p) => !da.has(p))
}

function neuGekommen(vorher: string[], nachher: string[]): string[] {
  const da = new Set(vorher)
  return nachher.filter((p) => !da.has(p))
}

/** Nur die OBERSTEN verschwundenen Pfade — ein geloeschter Ordner nimmt seinen
 *  Inhalt mit, und den einzeln aufzuzaehlen verdeckt, was eigentlich weg ist. */
function obersteWeg(weg: string[]): string[] {
  return weg.filter((p) => !weg.some((q) => q !== p && q.endsWith('/') && p.startsWith(q)))
}

async function fallFahren(fall: Fall): Promise<boolean> {
  const zeile = (t: string) => console.log(`   ${t}`)
  console.log(`\n── ${fall.name}`)
  zeile(`warum: ${fall.warum}`)

  // ALT ---------------------------------------------------------------------
  const wAlt = await sandkastenBauen()
  const urlAlt = fall.url(wAlt)
  const vorAlt = await bestand(wAlt)
  const cmd = altBefehl(urlAlt, path.join(wAlt, 'media'))
  let altMeldung = 'wirft URIError (Antwort 500)'
  if (cmd) {
    altMeldung = await altAusfuehren(cmd)
    zeile(`ALT  ${cmd.replace(wAlt, '<sandkasten>')}`)
  } else {
    zeile('ALT  (kein Befehl — decodeURI warf)')
  }
  const nachAlt = await bestand(wAlt)
  const wegAlt = obersteWeg(verschwunden(vorAlt, nachAlt))
  const dazuAlt = neuGekommen(vorAlt, nachAlt)
  zeile(`ALT  meldete an die Oberflaeche: {status:'ok'}   (intern: ${altMeldung})`)
  zeile(`ALT  wirklich weg: ${wegAlt.length ? wegAlt.join(', ') : '— nichts —'}`)
  if (dazuAlt.length) zeile(`ALT  NEU ENTSTANDEN: ${dazuAlt.join(', ')}`)

  // NEU ---------------------------------------------------------------------
  const wNeu = await sandkastenBauen()
  // GENAU DER SCHRITT, den der Verteiler heute tut — das rohe Glied nach
  // Position, nicht `path.parse(...).name`.
  const gliedNeu = loeschgliedAusUrl(fall.url(wNeu))
  const vorNeu = await bestand(wNeu)
  const ausgang = await loeschenAusfuehren(gliedNeu, path.join(wNeu, 'media'))
  const nachNeu = await bestand(wNeu)
  const wegNeu = obersteWeg(verschwunden(vorNeu, nachNeu))
  const dazuNeu = neuGekommen(vorNeu, nachNeu)
  zeile(
    `NEU  Antwort: ${ausgang.ok ? `ok — ${ausgang.pfad.replace(wNeu, '<sandkasten>')}` : `abgelehnt — ${ausgang.grund.replace(wNeu, '<sandkasten>')}`}`,
  )
  zeile(`NEU  wirklich weg: ${wegNeu.length ? wegNeu.join(', ') : '— nichts —'}`)
  if (dazuNeu.length) zeile(`NEU  NEU ENTSTANDEN: ${dazuNeu.join(', ')}`)

  // Urteil ------------------------------------------------------------------
  const fehler: string[] = []
  if (fall.sollAblehnen && ausgang.ok) fehler.push('NEU hat NICHT abgelehnt')
  if (!fall.sollAblehnen && !ausgang.ok) fehler.push(`NEU hat abgelehnt: ${ausgang.grund}`)
  const sollSortiert = [...fall.sollWeg].sort()
  const istSortiert = [...wegNeu].sort()
  if (JSON.stringify(sollSortiert) !== JSON.stringify(istSortiert)) {
    fehler.push(`NEU liess verschwinden: [${istSortiert.join(', ')}] — erwartet: [${sollSortiert.join(', ')}]`)
  }
  if (dazuNeu.length) fehler.push(`NEU hat etwas ANGELEGT: ${dazuNeu.join(', ')}`)

  if (!BEHALTEN) {
    await fsp.rm(wAlt, { recursive: true, force: true })
    await fsp.rm(wNeu, { recursive: true, force: true })
  } else {
    zeile(`Sandkaesten bleiben: ALT ${wAlt} / NEU ${wNeu}`)
  }

  if (fehler.length) {
    for (const f of fehler) zeile(`>>> DURCHGEFALLEN: ${f}`)
    return false
  }
  zeile('BESTANDEN')
  return true
}

async function main() {
  console.log('DER PAPIERKORB IM SANDKASTEN — alt gegen neu, mit echten Ordnern.')
  console.log(`Die Box wird NICHT beruehrt. Echte Medienwurzel waere: ${MEDIEN_WURZEL}`)

  let alleGut = true
  for (const fall of FAELLE) {
    if (!(await fallFahren(fall))) alleGut = false
  }

  console.log(`\n${alleGut ? 'ALLE FAELLE BESTANDEN.' : 'ES SIND FAELLE DURCHGEFALLEN.'}`)
  process.exit(alleGut ? 0 : 1)
}

main().catch((f) => {
  console.error(f)
  process.exit(1)
})
