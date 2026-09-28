/**
 * SPRECHSTROM — die Box liest einem Plugin einen Text vor (Recht `sprechen`,
 * 28.09.2026, gebaut fuer mixpi-klexikon).
 *
 * ══ DER WEG ═════════════════════════════════════════════════════════════════
 *
 *   1. Das Plugin ruft `kontext.sprechen(text)`. Im Worker (plugin-laufwerk.ts)
 *      legt `sprechAblegen` den Text als `<name>.json` in den Sprech-Speicher
 *      und gibt SOFORT `{ art: 'strom', adresse: '<basis>/<name>.wav' }`
 *      zurueck. Gesprochen wird dabei nichts — das waere in der 8-s-Frist
 *      eines Plugin-Rufs bei jedem laengeren Artikel gerissen.
 *   2. Die Quelle geht wie jede andere durch `fundPruefen`/`inhaltPruefen`
 *      und spaeter an den Abspieler.
 *   3. Erst wenn der Abspieler die Adresse abruft, spricht `sprechRoute` den
 *      Text — Satzgruppe fuer Satzgruppe ueber den laufenden Piper-Dienst des
 *      Kerns — und schreibt jede fertige Gruppe SOFORT in die Antwort. Das
 *      Kind hoert den ersten Satz, waehrend der Rest noch gerechnet wird.
 *   4. Ist der Text ganz durch, liegt er als `<name>.wav` daneben; jeder
 *      weitere Abruf bekommt die Datei (mit Range, also spulbar).
 *
 * ══ WARUM NICHT DER VORLESE-SPEICHER ════════════════════════════════════════
 * `vorlesen-cache` ist fuer Kachelnamen gebaut: 300 Dateien / 50 MB, und ein
 * einzelner Artikel ist schon 5–10 MB WAV. Ein paar Artikel haetten dort jede
 * Kachelansage verdraengt. Deshalb ein eigener Ordner mit eigenem Deckel.
 *
 * ══ WARUM DER NAME EIN HASH IST ═════════════════════════════════════════════
 * Die Route ist auf der Box ohne Anmeldung erreichbar (Rueckschleife, siehe
 * auth.ts) — sie darf also nur sprechen, was ein Plugin MIT dem Recht
 * abgelegt hat, und nie einen Text aus der Anfrage. Der Name kommt aus Text
 * und Tempo; derselbe Text ist dieselbe Datei, und nach einem Neustart findet
 * die Route ihn wieder.
 *
 * Diese Datei laeuft auch IM WORKER (sprechAblegen) — deshalb nur node:*
 * und keine Laufzeit-Abhaengigkeit auf Express.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response } from 'express'

/** Laenger spricht die Box nicht an einem Stueck — ein Artikel-Abschnitt ist weit darunter. */
export const SPRECH_TEXT_MAX = 20_000
/** Piper `length_scale`: 1 ist normal, groesser ist langsamer. */
export const SPRECH_TEMPO_MIN = 0.7
export const SPRECH_TEMPO_MAX = 2
export const SPRECH_TEMPO_VORGABE = 1

/** Was der Worker braucht, um einem Plugin `kontext.sprechen` zu geben. */
export interface SprechAnschluss {
  /** Der Sprech-Speicher: hier liegen die Auftraege (.json) und die fertigen Dateien (.wav). */
  ordner: string
  /** Die Route ohne Schluss-Schraegstrich, z. B. `http://127.0.0.1:8200/api/sprechen`. */
  basis: string
}

/** Ein abgelegter Auftrag, wie er als `<name>.json` im Speicher steht. */
export interface SprechAuftrag {
  text: string
  tempo: number
  plugin: string
}

const NAME = /^[0-9a-f]{32}$/

/** Ein Tempo aus fremder Hand auf die erlaubte Spanne biegen. */
export function tempoBiegen(roh: unknown): number {
  const n = Number(roh)
  if (roh === undefined || roh === null || roh === '' || !Number.isFinite(n)) return SPRECH_TEMPO_VORGABE
  return Math.min(SPRECH_TEMPO_MAX, Math.max(SPRECH_TEMPO_MIN, Math.round(n * 100) / 100))
}

/**
 * Der Name eines Auftrags — aus Text UND Tempo.
 *
 * Das Tempo gehoert hinein: derselbe Text langsamer ist eine andere Datei,
 * und wer in der Verwaltung das Tempo aendert, soll nicht die alte hoeren.
 * Die STIMME gehoert NICHT hinein — sie steht zum Zeitpunkt des Ablegens gar
 * nicht fest (der Worker kennt sie nicht). Nach einem Stimmwechsel leert die
 * Route den Speicher nicht; das Alte laeuft aus dem Deckel heraus.
 */
export function sprechName(text: string, tempo: number): string {
  return createHash('sha256')
    .update(JSON.stringify({ t: text, s: tempo }))
    .digest('hex')
    .slice(0, 32)
}

/**
 * Einen Text ablegen und die Quelle dazu nennen — der Kern von `kontext.sprechen`.
 *
 * WIRFT MIT KLARTEXT, wenn der Text nichts taugt: das landet beim Plugin, das
 * daraus eine verstaendliche Meldung machen kann, statt eine Folge zu liefern,
 * die spaeter still nicht spielt.
 */
export async function sprechAblegen(
  roh: unknown,
  gaben: unknown,
  anschluss: SprechAnschluss,
  plugin: string,
): Promise<{ art: 'strom'; adresse: string }> {
  const text = typeof roh === 'string' ? roh.replace(/\s+/g, ' ').trim() : ''
  if (!text) throw new Error('sprechen: kein Text')
  if (text.length > SPRECH_TEXT_MAX) {
    throw new Error(`sprechen: ${text.length} Zeichen sind zu viel (hoechstens ${SPRECH_TEXT_MAX} an einem Stueck)`)
  }
  const tempo = tempoBiegen((gaben as { tempo?: unknown } | undefined)?.tempo)
  const name = sprechName(text, tempo)
  const ziel = path.join(anschluss.ordner, `${name}.json`)
  try {
    // ANFASSEN STATT NEU SCHREIBEN: der Deckel raeumt nach Alter, und ein
    // Auftrag, den ein Plugin gerade wieder nennt, ist nicht alt.
    const jetzt = new Date()
    await fs.promises.utimes(ziel, jetzt, jetzt)
  } catch {
    await fs.promises.mkdir(anschluss.ordner, { recursive: true })
    // ERST DANEBEN, DANN UMBENENNEN: die Route liest die Datei womoeglich im
    // selben Augenblick, und eine halbe JSON-Datei waere ein Auftrag, der nie
    // spricht. Der Zwischenname traegt den Prozess, damit zwei Plugins nicht
    // in dieselbe .tmp schreiben.
    const tmp = `${ziel}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    const auftrag: SprechAuftrag = { text, tempo, plugin }
    await fs.promises.writeFile(tmp, JSON.stringify(auftrag))
    await fs.promises.rename(tmp, ziel)
  }
  return { art: 'strom', adresse: `${anschluss.basis}/${name}.wav` }
}

/**
 * Den Text in Stuecke schneiden, die Piper einzeln spricht.
 *
 * DAS ERSTE STUECK IST DER ERSTE SATZ, und nur der: er entscheidet, wie lange
 * das Kind nach dem Antippen Stille hoert. Alles danach wird zu Gruppen bis
 * `max` Zeichen gebuendelt — jede Anfrage an den Dienst kostet etwas, und
 * Piper klingt ueber mehrere Saetze natuerlicher als Satz fuer Satz.
 *
 * GESCHNITTEN WIRD NUR AN SATZENDEN (. ! ? …, dann Leerraum, dann ein
 * Grossbuchstabe, eine Ziffer oder ein Anfuehrungszeichen) — und NICHT hinter
 * einer Zahl: „am 1. Mai" ist kein Satzende. Ein Satz ueber `max` wird an
 * Komma oder Semikolon geteilt, notfalls an einem Leerzeichen.
 */
export function stueckeBilden(text: string, max = 300): string[] {
  const rein = text.replace(/\s+/g, ' ').trim()
  if (!rein) return []
  const saetze = rein.split(/(?<=(?<!\d)[.!?…])\s+(?=[A-ZÄÖÜ0-9„"»(])/u).flatMap((s) => zuLangTeilen(s, max))
  const stuecke = [saetze[0]]
  let jetzt = ''
  for (const s of saetze.slice(1)) {
    if (jetzt && jetzt.length + 1 + s.length > max) {
      stuecke.push(jetzt)
      jetzt = s
    } else {
      jetzt = jetzt ? `${jetzt} ${s}` : s
    }
  }
  if (jetzt) stuecke.push(jetzt)
  return stuecke
}

function zuLangTeilen(satz: string, max: number): string[] {
  if (satz.length <= max) return [satz]
  const teile: string[] = []
  let rest = satz
  while (rest.length > max) {
    const fenster = rest.slice(0, max)
    let schnitt = Math.max(fenster.lastIndexOf(', '), fenster.lastIndexOf('; '))
    if (schnitt < max / 3) schnitt = fenster.lastIndexOf(' ')
    if (schnitt <= 0) schnitt = max - 1
    teile.push(rest.slice(0, schnitt + 1).trim())
    rest = rest.slice(schnitt + 1).trim()
  }
  if (rest) teile.push(rest)
  return teile
}

/**
 * Eine WAV-Antwort von Piper in Format und Tondaten zerlegen.
 *
 * NICHT BLIND 44 BYTE ABSCHNEIDEN: der Kopf ist eine Kette von Bloecken, und
 * wer einen `LIST`-Block mitschreibt, verschiebt `data`. Gesucht wird deshalb
 * Block fuer Block. Null heisst: das ist keine WAV, die wir weiterreichen.
 */
export function wavZerlegen(b: Buffer): { format: Buffer; pcm: Buffer } | null {
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null
  let format: Buffer | null = null
  let stelle = 12
  while (stelle + 8 <= b.length) {
    const art = b.toString('ascii', stelle, stelle + 4)
    const laenge = b.readUInt32LE(stelle + 4)
    const anfang = stelle + 8
    if (art === 'fmt ') format = b.subarray(anfang, anfang + laenge)
    if (art === 'data') {
      if (!format || format.length < 16) return null
      // EIN KOPF MIT UNBEKANNTER LAENGE (0 oder 0xFFFFFFFF) heisst „bis zum Ende".
      const ende = laenge === 0 || laenge === 0xffffffff ? b.length : Math.min(b.length, anfang + laenge)
      return { format: Buffer.from(format), pcm: b.subarray(anfang, ende) }
    }
    // Bloecke ungerader Laenge tragen ein Fuellbyte (RIFF-Regel).
    stelle = anfang + laenge + (laenge % 2)
  }
  return null
}

/** Laenge „unbekannt" im Kopf eines Stroms — ffmpeg (mpv) spielt dann bis zum Ende. */
export const WAV_UNBEKANNT = 0xffffffff

/** Einen WAV-Kopf bauen: RIFF, fmt (aus Piper uebernommen), data. */
export function wavKopf(format: Buffer, datenBytes: number): Buffer {
  const k = Buffer.alloc(12 + 8 + format.length + 8)
  const unbekannt = datenBytes === WAV_UNBEKANNT
  k.write('RIFF', 0, 'ascii')
  k.writeUInt32LE(unbekannt ? WAV_UNBEKANNT : 4 + 8 + format.length + 8 + datenBytes, 4)
  k.write('WAVE', 8, 'ascii')
  k.write('fmt ', 12, 'ascii')
  k.writeUInt32LE(format.length, 16)
  format.copy(k, 20)
  k.write('data', 20 + format.length, 'ascii')
  k.writeUInt32LE(datenBytes, 24 + format.length)
  return k
}

export interface SprechRouteGaben {
  ordner: string
  /** Ein Stueck Text sprechen. Liefert eine WAV oder null (Dienst nicht da, Fehler). */
  sprich(text: string, tempo: number): Promise<Buffer | null>
  melden(text: string): void
  /** Deckel fuer die fertigen .wav im Speicher. */
  bytesMax?: number
  /** Auftraege (.json), die so lange niemand genannt hat, fliegen raus. */
  auftragTageMax?: number
}

/** 200 MB — etwa 100 Minuten Sprache mit einer mittleren Stimme, gut zwanzig Artikel. */
export const SPRECH_BYTES_MAX = 200 * 1024 * 1024
export const SPRECH_AUFTRAG_TAGE_MAX = 60

/**
 * Die Route `GET /api/sprechen/<name>.wav`.
 *
 * STEIGT DER HOERER AUS, HOERT DIE BOX AUF ZU RECHNEN. Ein Kind, das
 * weitertippt, will den Rest nicht — und auf einem Pi ist jede Sekunde Piper
 * eine Sekunde, die der Oberflaeche fehlt. Die halbe Datei wird dann nicht
 * gespeichert; der naechste Abruf spricht von vorn.
 *
 * ZWEI GLEICHZEITIGE ABRUFE DESSELBEN TEXTS sprechen jeder fuer sich. Das ist
 * selten (der Abspieler oeffnet einen Strom einmal), und die Alternative —
 * der zweite haengt sich an den ersten — liesse ihn leer ausgehen, sobald der
 * erste aussteigt. Die fertige Datei entsteht per Umbenennen, also gewinnt
 * einer von beiden sauber.
 */
export function sprechRoute(o: SprechRouteGaben) {
  const bytesMax = o.bytesMax ?? SPRECH_BYTES_MAX
  const tageMax = o.auftragTageMax ?? SPRECH_AUFTRAG_TAGE_MAX

  return async (req: Request, res: Response): Promise<void> => {
    const datei = String(req.params.name ?? '')
    const name = datei.endsWith('.wav') ? datei.slice(0, -4) : ''
    if (!NAME.test(name)) {
      res.status(404).json({ error: 'unbekannt' })
      return
    }
    const fertig = path.join(o.ordner, `${name}.wav`)
    try {
      await fs.promises.access(fertig)
      const jetzt = new Date()
      // noatime auf DietPi: das Alter fuer den Deckel ist die mtime, also
      // wird eine gehoerte Datei beim Hoeren wieder jung.
      await fs.promises.utimes(fertig, jetzt, jetzt).catch(() => undefined)
      res.sendFile(fertig, { headers: { 'content-type': 'audio/wav' } })
      return
    } catch {
      /* noch nie ganz gesprochen */
    }

    let auftrag: SprechAuftrag
    try {
      auftrag = JSON.parse(await fs.promises.readFile(path.join(o.ordner, `${name}.json`), 'utf8'))
      if (typeof auftrag?.text !== 'string' || !auftrag.text) throw new Error('leer')
    } catch {
      res.status(404).json({ error: 'kein Auftrag' })
      return
    }

    let ausgestiegen = false
    res.on('close', () => {
      if (!res.writableFinished) ausgestiegen = true
    })

    const tempo = tempoBiegen(auftrag.tempo)
    const stuecke = stueckeBilden(auftrag.text)
    let format: Buffer | null = null
    const teile: Buffer[] = []
    let vollstaendig = true
    for (const [i, stueck] of stuecke.entries()) {
      if (ausgestiegen) {
        vollstaendig = false
        break
      }
      let roh: Buffer | null = null
      try {
        roh = await o.sprich(stueck, tempo)
      } catch {
        roh = null
      }
      const z = roh ? wavZerlegen(roh) : null
      if (!z || (format && !format.equals(z.format))) {
        // VOR DEM ERSTEN STUECK IST NOCH NICHTS GESAGT: dann ehrlich 503, und
        // der Abspieler meldet einen Fehler. DANACH laesst sich der Status
        // nicht mehr aendern — der Strom endet, und nichts wird gespeichert.
        o.melden(
          `Sprechstrom ${name}: Stueck ${i + 1} von ${stuecke.length} ${z ? 'hat ein anderes Format' : 'kam nicht'}`,
        )
        if (!format) {
          res.status(503).json({ error: 'Die Box kann gerade nicht sprechen (Piper antwortet nicht).' })
          return
        }
        vollstaendig = false
        break
      }
      if (!format) {
        format = z.format
        res.status(200)
        res.setHeader('content-type', 'audio/wav')
        res.setHeader('cache-control', 'no-store')
        res.write(wavKopf(format, WAV_UNBEKANNT))
      }
      teile.push(z.pcm)
      if (!ausgestiegen) res.write(z.pcm)
    }
    if (!res.writableEnded) res.end()
    if (!vollstaendig || !format || ausgestiegen) return

    const pcm = Buffer.concat(teile)
    const tmp = `${fertig}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    try {
      await fs.promises.writeFile(tmp, Buffer.concat([wavKopf(format, pcm.length), pcm]))
      await fs.promises.rename(tmp, fertig)
    } catch (fehler) {
      await fs.promises.rm(tmp, { force: true }).catch(() => undefined)
      o.melden(`Sprechstrom ${name}: nicht gespeichert (${(fehler as Error).message})`)
    }
    await sprechSpeicherDeckeln(o.ordner, bytesMax, tageMax, o.melden)
  }
}

/**
 * Der Deckel auf dem Sprech-Speicher — dieselbe Regel wie beim Vorlese-Speicher.
 *
 * Geraeumt wird nach mtime (atime ist auf der Box nicht verlaesslich). Fertige
 * .wav nach Bytes, Auftraege nach Alter: ein Auftrag kostet fast nichts, aber
 * ohne Grenze waechst der Ordner mit jedem je geoeffneten Artikel. Raeumt der
 * Deckel einen Auftrag, den ein Plugin noch braucht, legt es ihn beim
 * naechsten `inhalt()` wieder an. `.tmp`-Leichen aelter als eine Stunde gehen
 * mit — ein abgebrochener Lauf darf den Deckel nicht dauerhaft belegen.
 */
export async function sprechSpeicherDeckeln(
  ordner: string,
  bytesMax: number,
  tageMax: number,
  melden: (text: string) => void,
  jetzt = Date.now(),
): Promise<void> {
  let namen: string[]
  try {
    namen = await fs.promises.readdir(ordner)
  } catch {
    return
  }
  const wavs: { pfad: string; bytes: number; wann: number }[] = []
  let entfernt = 0
  for (const n of namen) {
    const pfad = path.join(ordner, n)
    let s: fs.Stats
    try {
      s = await fs.promises.stat(pfad)
    } catch {
      continue
    }
    if (!s.isFile()) continue
    const alt = jetzt - s.mtimeMs
    const weg = (n.endsWith('.json') && alt > tageMax * 86_400_000) || (n.endsWith('.tmp') && alt > 3_600_000)
    if (weg) {
      await fs.promises.rm(pfad, { force: true }).catch(() => undefined)
      entfernt += 1
    } else if (n.endsWith('.wav')) {
      wavs.push({ pfad, bytes: s.size, wann: s.mtimeMs })
    }
  }
  let bytes = wavs.reduce((summe, w) => summe + w.bytes, 0)
  wavs.sort((a, b) => a.wann - b.wann)
  for (const w of wavs) {
    if (bytes <= bytesMax) break
    await fs.promises.rm(w.pfad, { force: true }).catch(() => undefined)
    bytes -= w.bytes
    entfernt += 1
  }
  if (entfernt > 0)
    melden(`Sprech-Speicher gedeckelt: ${entfernt} Datei(en) entfernt, ${Math.round(bytes / 1048576)} MB bleiben`)
}
