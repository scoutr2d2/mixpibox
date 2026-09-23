/**
 * DER WIRT — haelt die Plugins auf Abstand und den Kern am Leben.
 *
 * WARUM WORKER UND NICHT `await import()` IN DEN HAUPTPROZESS (der Entwurf).
 *
 * AN DER ECHTEN BOX GEMESSEN (tools/plugin-box-probe.mjs, 2026-08-14, Raspberry
 * Pi 5 Model B Rev 1.1, arm64, 2010 MB, Node 26.6, 16384-Byte-Seiten):
 *
 *   `while(true){}` im Worker      nach 302 ms durch terminate() beendet
 *   `while(true){}` im Hauptstrang mit keinem Mittel abbrechbar
 *   worker_threads                 11,4 MB je Plugin
 *   child_process.fork             43,9 MB je Plugin (Faktor 3,8)
 *   drei Plugins                   34,3 MB von 1325 MB frei — 2,6 %
 *   Speichergrenze greift          „Worker terminated due to reaching memory
 *                                   limit: JS heap out of memory"
 *
 * (Auf dem Entwicklungsrechner, x86: 12,9 gegen 53,8 MB, Faktor 4,2. Die
 * Groessenordnung stimmt also ueberein — die Box ist sogar etwas guenstiger.)
 *
 * Der Hauptstrang haelt den Kinderzeit-Takt (setInterval(kzTakt, 5000)). Steht
 * er, zaehlt niemand mehr die Zeit — waehrend backend-player weiterspielt, denn
 * das ist ein eigener Prozess. Ein Plugin im Hauptstrang koennte also nicht die
 * Musik abschalten, sondern die AUFSICHT, bei laufender Musik. Das ist die
 * schlechteste Richtung, in die dieses Geraet scheitern kann.
 *
 * KEIN TOP-LEVEL AWAIT (esbuild bricht den Bau von backend-api sonst ab).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { type Klangglied, kettePruefen } from './klangkette'
import {
  type Aktion,
  type Ereignisname,
  type Inhalt,
  inhaltPruefen,
  einstellungenNormalisieren,
  einstellungenZusammenfuehren,
  type Feld,
  type Fund,
  fundPruefen,
  type Manifest,
  manifestPruefen,
  songtextPruefen,
  type Titel,
} from './plugin-vertrag'
import type { Songzeile } from './songtext'
import type { Strom } from './stroeme'

/** Speicher je Plugin. Reicht fuer HTTP und JSON; ein Leck stirbt hier statt im Kern. */
const SPEICHER_MB = 48
/**
 * Obergrenze fuer JEDEN Ruf. Die Box am DSL braucht Luft — 134,8 s
 * (zeitschranke.ts) nicht.
 *
 * UMSTELLBAR, WEIL DER TEST SONST ACHT SEKUNDEN STEHT: der Fall
 * „Endlosschleife" muss die Frist wirklich reissen, sonst prueft er nichts.
 * Auf der Box wird die Umgebungsvariable nicht gesetzt.
 */
const FRIST_MS = Number(process.env.MUPIBOX_PLUGIN_FRIST_MS) || 8000
/** So oft wird ein abgestuerztes Plugin neu gestartet, dann ist Schluss. */
const VERSUCHE = 3

/**
 * `aus` IST KEIN FEHLER, sondern eine Entscheidung.
 *
 * Es steht deshalb neben `gescheitert` und nicht darin: „nicht geladen, weil
 * kaputt" und „nicht geladen, weil abgeschaltet" verlangen im Eltern-Bereich
 * genau entgegengesetzte Handlungen — beim einen sucht man den Grund, beim
 * anderen legt man den Schalter um.
 */
export type Zustand = 'laedt' | 'bereit' | 'gescheitert' | 'aus'

export interface PluginStand {
  kennung: string
  name: string
  fassung: string
  rechte: string[]
  zustand: Zustand
  /** Warum gescheitert — im Klartext, fuer den Admin-Bereich. */
  grund?: string
  kann: {
    aufloesen: boolean
    suchen: boolean
    befinden: boolean
    inhalt: boolean
    ereignis: boolean
    klangkette: boolean
    aktion: boolean
    http: boolean
    songtext: boolean
  }
  /** Wo dieses Plugin in der Verwaltung erscheint (E77). Fehlt = nur Plugin-Seite. */
  sektion?: string
  /** Bringt es ein Icon mit? Der Weg dorthin ist immer /api/plugins/<kennung>/icon. */
  icon: boolean
  /** Die angemeldeten Knoepfe (E77). */
  aktionen: Aktion[]
  /** Was der Eltern-Bereich abfragen soll. Ohne das waere jede Einstellung Raten. */
  felder: Feld[]
}

interface Eintrag {
  /** Wo dieses Plugin seinen Zustand ablegen darf. Leer = keiner. */
  datenOrdner?: string
  /** Nur an Plugins mit Recht `aufnahme` — siehe Kontext in plugin-laufwerk.ts. */
  stroeme?: Strom[]
  manifest: Manifest
  ordner: string
  /**
   * DIE EINSTELLUNGEN GEHOEREN IN DEN EINTRAG, nicht in die Aufrufkette von
   * `workerStarten`. Sonst haelt der `exit`-Behandler sie in seinem Abschluss
   * fest, und ein Plugin, das nach einer Aenderung abstuerzt, kaeme mit den
   * ALTEN Werten wieder hoch — ein Fehler, der sich nur beim dritten Hinsehen
   * zeigt und wie ein Zufall aussieht.
   */
  einstellungen: Record<string, unknown>
  worker: Worker | null
  zustand: Zustand
  grund?: string
  kann: PluginStand['kann']
  /** Offene Rufe: Nummer -> wie es ausgeht. */
  offen: Map<number, { fertig: (w: unknown) => void; schiefgegangen: (e: Error) => void; uhr: NodeJS.Timeout }>
  naechsteNr: number
  versuche: number
}

const geladen = new Map<string, Eintrag>()

/** Die Kern-Konfig-Gruppen, wie beim Laden hereingereicht (E80). */
let kernKonfigStand: Record<string, unknown> = {}

/** Was DIESES Plugin davon sehen darf — nach seinem Manifest gefiltert. */
function kernKonfigFuer(m: Manifest): Record<string, unknown> {
  const aus: Record<string, unknown> = {}
  for (const gruppe of m.konfig) {
    const wert = kernKonfigStand[gruppe]
    if (wert && typeof wert === 'object') aus[gruppe] = wert
  }
  return aus
}

/** Die eigenen Adressen — damit ein Plugin nicht ueber die LAN-IP zur Box zurueckfindet. */
function eigeneAdressen(): string[] {
  const aus = new Set<string>(['127.0.0.1', '::1', 'localhost', os.hostname().toLowerCase()])
  for (const liste of Object.values(os.networkInterfaces())) {
    for (const n of liste ?? []) aus.add(n.address.toLowerCase())
  }
  return [...aus]
}

/**
 * Wo liegt das Laufwerk?
 *
 * ZWEI WELTEN, ZWEI ORTE. In der Entwicklung laeuft `tsx watch src/server.ts`,
 * daneben liegt `plugin-laufwerk.ts`. Im Betrieb ist alles zu EINER Datei
 * gebuendelt (src/deploy/server.js) — dort gibt es die Quelle nicht mehr, und
 * das Laufwerk wird als ZWEITER esbuild-Ausgang danebengelegt. Wer das
 * vergisst, merkt es erst auf der Box: der Worker startet nicht, und der
 * Kern laeuft ohne jedes Plugin ruhig weiter.
 */
function laufwerkPfad(): string {
  // EINE AUSDRUECKLICHE ANGABE GEWINNT. Werkzeuge wissen, wo die Datei liegt —
  // die sollen nicht raten muessen.
  const gesetzt = process.env.MUPIBOX_PLUGIN_LAUFWERK
  if (gesetzt && fs.existsSync(gesetzt)) return gesetzt

  // DIE ZWEITE ZEILE STAND HIER FRUEHER ALLEIN, und sie war vom
  // ARBEITSVERZEICHNIS abhaengig: `process.cwd() + '/src'`. Das stimmt, wenn
  // `npm test` aus src/backend-api laeuft — und nur dann. Aufgefallen ist es
  // erst beim Bau von tools/plugin-pruefen.mjs, das aus der Baumwurzel
  // aufgerufen wird: dort zeigte der Pfad auf `<wurzel>/src`, wo kein Laufwerk
  // liegt. Die Tests waren gruen, weil sie zufaellig im richtigen Ordner
  // starteten. Ein Pfad, der vom Aufrufort abhaengt, ist keine Adresse,
  // sondern eine Wette.
  const orte = [
    typeof __dirname !== 'undefined' ? __dirname : null, // gebuendelt: neben server.js
    path.join(process.cwd(), 'src'), // tsx, aufgerufen aus src/backend-api
    path.join(process.cwd(), 'src', 'backend-api', 'src'), // tsx, aufgerufen aus der Baumwurzel
  ].filter((o): o is string => !!o)

  for (const ort of orte) {
    for (const name of ['plugin-laufwerk.js', 'plugin-laufwerk.ts']) {
      const p = path.join(ort, name)
      if (fs.existsSync(p)) return p
    }
  }
  throw new Error(
    `plugin-laufwerk nicht gefunden. Gesucht in: ${orte.join(', ')}. ` +
      'Im Betrieb liegt es neben server.js (zweiter esbuild-Ausgang, siehe package.json). ' +
      'Sonst hilft MUPIBOX_PLUGIN_LAUFWERK=<pfad>.',
  )
}

function melden(text: string): void {
  console.info(`${new Date().toLocaleString()}: [MuPiBox-Server] Plugin: ${text}`)
}

/** Alle offenen Rufe eines Eintrags mit demselben Grund beenden. */
function offeneAufloesen(e: Eintrag, grund: string): void {
  for (const [, o] of e.offen) {
    clearTimeout(o.uhr)
    o.schiefgegangen(new Error(grund))
  }
  e.offen.clear()
}

function workerStarten(e: Eintrag): void {
  e.zustand = 'laedt'
  const w = new Worker(laufwerkPfad(), {
    workerData: {
      manifest: e.manifest,
      ordner: e.ordner,
      datenOrdner: e.datenOrdner ?? '',
      stroeme: e.stroeme ?? [],
      kernKonfig: kernKonfigFuer(e.manifest),
      einstellungen: e.einstellungen,
      fristMs: FRIST_MS,
      eigeneAdressen: eigeneAdressen(),
    },
    // DIE GRENZE, DIE DEN KERN RETTET. Ohne sie holt bei einem Speicherleck der
    // OOM-Killer den Prozess — und der heisst server.js, nicht plugin.js.
    resourceLimits: { maxOldGenerationSizeMb: SPEICHER_MB, maxYoungGenerationSizeMb: 8 },
  })
  e.worker = w

  w.on(
    'message',
    (n: { art: string; nr?: number; wert?: unknown; meldung?: string; spur?: string; text?: string; kann?: any }) => {
      switch (n.art) {
        case 'bereit':
          e.zustand = 'bereit'
          e.kann = n.kann
          e.versuche = 0
          melden(
            `${e.manifest.kennung} ${e.manifest.fassung} bereit (${e.manifest.rechte.join(', ') || 'ohne Rechte'})`,
          )
          break
        case 'protokoll':
          melden(`${e.manifest.kennung}: ${n.text}`)
          break
        case 'ladefehler':
          e.zustand = 'gescheitert'
          e.grund = n.meldung
          // DER STAPEL INS JOURNAL, die Meldung in den Zustand. Wer sucht, hat
          // ihn hier; wer fragt, bekommt einen Satz.
          melden(`${e.manifest.kennung} laedt nicht: ${n.spur ?? n.meldung}`)
          break
        case 'antwort':
        case 'fehler': {
          const o = n.nr !== undefined ? e.offen.get(n.nr) : undefined
          if (!o) return
          clearTimeout(o.uhr)
          e.offen.delete(n.nr as number)
          if (n.art === 'antwort') {
            o.fertig(n.wert)
          } else {
            // DER STAPEL BLEIBT HIER. Was der Aufrufer bekommt, ist die
            // Meldung — sonst steht der Aufbau der Box in einer HTTP-Antwort
            // (am Geraet gesehen, 14.08.2026).
            if (n.spur) melden(`${e.manifest.kennung}: ${n.spur}`)
            o.schiefgegangen(new Error(String(n.meldung)))
          }
          break
        }
      }
    },
  )

  // EIN STERBENDES PLUGIN IST EIN EREIGNIS, KEIN ABSTURZ. Der Hauptstrang
  // erfaehrt davon und macht weiter; das ist der ganze Zweck der Uebung.
  w.on('error', (fehler) => {
    offeneAufloesen(e, `${e.manifest.kennung} ist gestorben: ${fehler.message}`)
    e.grund = fehler.message
    melden(`${e.manifest.kennung} Fehler: ${fehler.message}`)
  })

  w.on('exit', (code) => {
    offeneAufloesen(e, `${e.manifest.kennung} ist beendet (Code ${code})`)
    e.worker = null
    // NICHT NEU STARTEN, WENN DAS BEENDEN ABSICHT WAR.
    //
    // `aus` STAND HIER ANFANGS NICHT, und der Test hat es sofort gefunden:
    // `aktivSetzen(..., false)` setzte den Zustand auf `aus` und beendete den
    // Worker — worauf DIESER Behandler ihn brav wieder hochfuhr. Im Journal
    // stand „sagtwas startet neu (Versuch 1 von 3)" direkt vor „sagtwas
    // abgeschaltet", und der Zustand war danach `bereit`. Ein Abschalten, das
    // sich selbst rueckgaengig macht, ist die unangenehmste Sorte Fehler: der
    // Schalter sieht aus, als haette er gewirkt.
    if (code === 0 || e.zustand === 'gescheitert' || e.zustand === 'aus') return
    e.versuche++
    if (e.versuche > VERSUCHE) {
      // KEIN EWIGER NEUSTART. Ein Plugin in der Absturzschleife verbraucht sonst
      // dauerhaft CPU auf einem Geraet, das auch Ton ausgeben soll.
      e.zustand = 'gescheitert'
      e.grund = e.grund ?? `nach ${VERSUCHE} Versuchen nicht stabil`
      melden(`${e.manifest.kennung} bleibt aus: ${e.grund}`)
      return
    }
    melden(`${e.manifest.kennung} startet neu (Versuch ${e.versuche} von ${VERSUCHE})`)
    workerStarten(e)
  })
}

/** Einen Ruf absetzen — mit Frist. Wirft nie unkontrolliert. */
function rufen(e: Eintrag, verb: string, arg: unknown, name?: Ereignisname): Promise<unknown> {
  return new Promise((fertig, schiefgegangen) => {
    if (!e.worker || e.zustand !== 'bereit') {
      schiefgegangen(new Error(`${e.manifest.kennung} ist nicht bereit (${e.zustand}${e.grund ? `: ${e.grund}` : ''})`))
      return
    }
    const nr = e.naechsteNr++
    // DIE FRIST GILT AUCH FUER EIN PLUGIN, DAS GAR NICHT MEHR ANTWORTET — ein
    // `while(true)` schickt nie eine Nachricht zurueck. Ohne diese Uhr haenge
    // der Aufrufer fuer immer, und mit ihm die Anfrage der Oberflaeche.
    const uhr = setTimeout(() => {
      e.offen.delete(nr)
      schiefgegangen(new Error(`${e.manifest.kennung} hat ${FRIST_MS} ms nicht geantwortet`))
      // UND DANN WIRD ABGERAEUMT. Ein Plugin, das die Frist reisst, dreht
      // womoeglich in einer Endlosschleife; terminate() holt es ein (gemessen:
      // 302 ms). Der exit-Behandler startet es danach neu.
      melden(`${e.manifest.kennung} ueber der Frist — wird abgebrochen`)
      void e.worker?.terminate()
    }, FRIST_MS)
    e.offen.set(nr, { fertig, schiefgegangen, uhr })
    e.worker.postMessage({ art: 'ruf', nr, verb, arg, name })
  })
}

// ── Was der Kern benutzt ──────────────────────────────────────────────────

export interface LadeErgebnis {
  geladen: PluginStand[]
  /** Was NICHT geladen wurde und warum — geht in den Admin-Bereich. */
  abgewiesen: { ordner: string; maengel: string[] }[]
}

/**
 * Alle Plugins aus einem Ordner laden.
 *
 * Ein Plugin, das nicht laedt, ist ein Eintrag in einer Liste — kein Grund,
 * die anderen stehenzulassen und keiner, den Start abzubrechen. Dieselbe
 * Haltung wie bei einer kaputten Kinderzeit-Datei: die Box laeuft weiter.
 */
export function pluginsLaden(
  wurzel: string,
  einstellungenJe: Record<string, Record<string, unknown>> = {},
  /**
   * Kennungen, die NICHT starten sollen.
   *
   * EINE LISTE UND KEIN FELD IN DEN EINSTELLUNGEN: dort gehoeren die Werte des
   * PLUGINS hin, und ein Plugin, das ein Feld `aus` anmeldet, wuerde sich sonst
   * selbst abschalten koennen.
   */
  ausgeschaltet: string[] = [],
  /**
   * Wo jedes Plugin seinen eigenen Zustand ablegen darf: darunter entsteht ein
   * Ordner je Kennung.
   *
   * WARUM DER WIRT DAS VORGIBT UND NICHT JEDES PLUGIN SELBST WAEHLT: Plugins
   * haben ohnehin Dateizugriff — das hier ist keine Befugnis, sondern eine
   * VEREINBARUNG. Ohne sie sucht sich jedes Plugin seinen Pfad, und das
   * Sicherungsnetz kann keinen davon kennen. Genau so verschwand in E65 eine
   * Datei, die niemand eingeordnet hatte. Mit einem festen Ort deckt EIN
   * Eintrag (`plugin-daten/*`) alle Plugins ab, auch die es noch nicht gibt.
   *
   * LEER HEISST: KEIN ORDNER. Dann bekommt das Plugin auch keinen im Kontext
   * und muss ohne auskommen — besser als ein Pfad, den niemand sichert.
   */
  datenWurzel = '',
  /**
   * Die Stroeme der Box — nur Plugins mit Recht `aufnahme` bekommen sie.
   *
   * SIE ENTHALTEN DIE ZUGAENGE. Die Weitergabe entscheidet das Laufwerk
   * anhand des Manifests; hier werden sie nur durchgereicht. Wer sie nicht
   * mitgibt, laesst die Aufnahme-Plugins ohne Zugang — sie melden das dann
   * verstaendlich, statt zu scheitern.
   */
  stroeme: Strom[] = [],
  /**
   * Die Kern-Konfiguration je GRUPPE (E80) — nur Plugins, deren Manifest die
   * Gruppe unter `konfig` anmeldet, bekommen sie in den Kontext gereicht.
   * Der Aufrufer gibt hier bereits NUR die erlaubten Gruppen herein
   * (KONFIG_GRUPPEN); gefiltert je Plugin wird beim Worker-Start.
   */
  kernKonfig: Record<string, unknown> = {},
): LadeErgebnis {
  kernKonfigStand = kernKonfig
  const abgewiesen: LadeErgebnis['abgewiesen'] = []
  let ordner: string[] = []
  try {
    ordner = fs
      .readdirSync(wurzel, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    // Kein Plugin-Ordner ist der Normalfall auf einer frischen Box.
    return { geladen: [], abgewiesen: [] }
  }

  for (const name of ordner.sort()) {
    const pfad = path.join(wurzel, name)
    let roh: unknown
    try {
      roh = JSON.parse(fs.readFileSync(path.join(pfad, 'plugin.json'), 'utf8'))
    } catch (e) {
      abgewiesen.push({ ordner: name, maengel: [`plugin.json nicht lesbar: ${(e as Error).message}`] })
      continue
    }
    const urteil = manifestPruefen(roh)
    if (!urteil.ok || !urteil.manifest) {
      abgewiesen.push({ ordner: name, maengel: urteil.maengel })
      melden(`${name} abgewiesen: ${urteil.maengel.join(' ')}`)
      continue
    }
    const m = urteil.manifest
    // DOPPELTE KENNUNG: das ZWEITE Plugin startet NICHT. Nicht „der letzte
    // gewinnt" — bei zwei Medienquellen entschiede sonst die Ladereihenfolge,
    // welche Sendung ein Kind hoert.
    if (geladen.has(m.kennung)) {
      abgewiesen.push({ ordner: name, maengel: [`Kennung "${m.kennung}" ist bereits vergeben.`] })
      melden(`${name} abgewiesen: Kennung "${m.kennung}" doppelt`)
      continue
    }
    // Der Ordnername MUSS die Kennung sein — sonst zeigt die Route
    // /api/plugins/<kennung>/ woanders hin als der Ordner, und beim Suchen
    // eines Fehlers sucht man an der falschen Stelle.
    if (name !== m.kennung) {
      abgewiesen.push({
        ordner: name,
        maengel: [`Ordner heisst "${name}", Kennung ist "${m.kennung}" — beide muessen gleich sein.`],
      })
      continue
    }

    // DER DATENORDNER ENTSTEHT BEIM LADEN, nicht beim ersten Schreiben. Ein
    // Plugin, das ihn selbst anlegen muesste, koennte es vergessen — und dann
    // faellt sein Zustand beim ersten Fehler auf die Fuesse, nicht beim
    // Einrichten, wo jemand hinsieht.
    let datenOrdner = ''
    if (datenWurzel) {
      datenOrdner = path.join(datenWurzel, m.kennung)
      try {
        fs.mkdirSync(datenOrdner, { recursive: true })
      } catch (fehler) {
        // KEIN GRUND, DAS PLUGIN NICHT ZU STARTEN. Es kann alles ausser
        // Zustand ablegen, und das ist mehr als nichts.
        melden(`${m.kennung}: Datenordner nicht anlegbar (${(fehler as Error).message})`)
        datenOrdner = ''
      }
    }

    const e: Eintrag = {
      manifest: m,
      ordner: pfad,
      datenOrdner,
      stroeme,
      // GEGEN DIE ANGEMELDETEN FELDER GEBOGEN, nicht roh durchgereicht: was in
      // der Ablage steht, ist im Betrieb entstanden und kann alles sein.
      einstellungen: einstellungenNormalisieren(einstellungenJe[m.kennung], m.felder),
      worker: null,
      zustand: 'laedt',
      kann: { aufloesen: false, suchen: false, befinden: false, inhalt: false, ereignis: false, klangkette: false, aktion: false, http: false, songtext: false },
      offen: new Map(),
      naechsteNr: 1,
      versuche: 0,
    }
    geladen.set(m.kennung, e)
    // ABGESCHALTET HEISST: GAR NICHT ERST STARTEN. Kein Worker, kein Speicher,
    // keine Ereignisse — und der Eintrag steht trotzdem in der Liste, sonst
    // gaebe es keinen Weg zurueck. Seine Einstellungen bleiben erhalten.
    if (ausgeschaltet.includes(m.kennung)) {
      e.zustand = 'aus'
      melden(`${m.kennung} ist abgeschaltet — nicht gestartet`)
      continue
    }
    workerStarten(e)
  }

  return { geladen: staende(), abgewiesen }
}

export function staende(): PluginStand[] {
  return [...geladen.values()].map((e) => ({
    kennung: e.manifest.kennung,
    name: e.manifest.name,
    fassung: e.manifest.fassung,
    rechte: e.manifest.rechte,
    zustand: e.zustand,
    grund: e.grund,
    kann: e.kann,
    felder: e.manifest.felder,
    sektion: e.manifest.sektion,
    icon: Boolean(e.manifest.icon),
    aktionen: e.manifest.aktionen,
  }))
}

/** Gibt es ein bereites Plugin dieser Kennung, das aufloesen kann? */
export function kannAufloesen(kennung: string): boolean {
  const e = geladen.get(kennung)
  return !!e && e.zustand === 'bereit' && e.kann.aufloesen
}

/**
 * Eine Kennung aufloesen — und das Ergebnis PRUEFEN, bevor es weitergeht.
 *
 * Die Pruefung steht hier und nicht im Laufwerk: der Worker teilt sich den
 * Speicher mit dem Plugin, der Hauptstrang nicht.
 */
export async function aufloesen(kennung: string, rest: string, medienWurzel: string): Promise<Fund> {
  const e = geladen.get(kennung)
  if (!e) throw new Error(`kein Plugin "${kennung}" geladen`)
  const roh = await rufen(e, 'aufloesen', rest)
  const urteil = fundPruefen(roh, medienWurzel)
  if (!urteil.ok || !urteil.fund) {
    throw new Error(`${kennung} lieferte nichts Abspielbares: ${urteil.maengel.join(' ')}`)
  }
  return urteil.fund
}

/**
 * Die Kern-Konfiguration hat sich geaendert (E80) — betroffene Plugins neu
 * starten, damit ihr eingefrorener Kontext die neuen Werte traegt.
 *
 * NUR DIE BETROFFENEN: ein Plugin ohne `konfig`-Anmeldung merkt nichts, und
 * eines, dessen Gruppen sich nicht geaendert haben, auch nicht — ein
 * Neustart reisst laufende Rufe ab, der Preis faellt nur an, wo er etwas
 * kauft. Der Vergleich laeuft ueber JSON: die Gruppen sind klein.
 */
export async function kernKonfigAktualisieren(kernKonfig: Record<string, unknown>): Promise<void> {
  const alt = kernKonfigStand
  kernKonfigStand = kernKonfig
  for (const e of geladen.values()) {
    if (!e.manifest.konfig.length || e.zustand === 'aus' || e.zustand === 'gescheitert') continue
    const vorher = JSON.stringify(e.manifest.konfig.map((g) => (alt as Record<string, unknown>)[g] ?? null))
    const nachher = JSON.stringify(e.manifest.konfig.map((g) => kernKonfig[g] ?? null))
    if (vorher === nachher) continue
    melden(`${e.manifest.kennung}: Kern-Konfiguration geaendert — Neustart`)
    // DASSELBE MUSTER WIE einstellungenSetzen — und aus denselben Gruenden:
    // Zustand VOR dem terminate umstellen (sonst startet der exit-Behandler
    // seinerseits neu und es laufen zwei Worker), und terminate ABWARTEN
    // (sonst sieht ein warteBereit direkt danach noch den ALTEN Worker als
    // „bereit" — genau dieser Wettlauf hat den ersten Integrationszeugen
    // gerissen: die Antwort kam vom sterbenden Worker).
    offeneAufloesen(e, 'Kern-Konfiguration geaendert')
    const alter = e.worker
    e.worker = null
    e.zustand = 'gescheitert'
    await alter?.terminate()
    e.versuche = 0
    e.grund = undefined
    workerStarten(e)
  }
}

export async function suchen(kennung: string, begriff: string): Promise<Titel[]> {
  const e = geladen.get(kennung)
  if (!e) throw new Error(`kein Plugin "${kennung}" geladen`)
  const roh = await rufen(e, 'suchen', begriff)
  return Array.isArray(roh) ? (roh as Titel[]) : []
}

/**
 * Ein Werk zu einer geordneten Folgenliste machen (E78).
 *
 * DIESELBE HALTUNG WIE BEI `aufloesen`: was der Wirt annimmt, prueft der
 * Wirt — jede Folge durch die Quellen-Pruefung, kaputte fallen heraus, die
 * Maengel gehen ins Journal statt verschluckt zu werden. Kann das Plugin
 * kein `inhalt`, ist das ein Wurf mit Klartext, kein leeres Ergebnis: eine
 * leere Liste heisst „die Sendung hat gerade nichts", nicht „die Methode
 * fehlt".
 */
export async function pluginInhalt(kennung: string, rest: string, medienWurzel: string): Promise<Inhalt> {
  const e = geladen.get(kennung)
  if (!e) throw new Error(`kein Plugin "${kennung}" geladen`)
  if (!e.kann.inhalt) throw new Error(`${kennung} kann keine Folgenlisten liefern (keine inhalt()-Methode)`)
  const roh = await rufen(e, 'inhalt', rest)
  const urteil = inhaltPruefen(roh, medienWurzel)
  if (!urteil.ok || !urteil.inhalt) {
    throw new Error(`${kennung} lieferte keinen brauchbaren Inhalt: ${urteil.maengel.join(' ')}`)
  }
  for (const m of urteil.maengel) melden(`${kennung}: ${m}`)
  return urteil.inhalt
}

/**
 * Den Songtext zum laufenden Stueck holen (E84/B2).
 *
 * WIRFT NICHT, sondern gibt eine LEERE Liste zurueck, wenn es nichts gibt —
 * und das ist der Unterschied zu `pluginInhalt()` daneben. Der Grund steht in
 * B2: „fuer Hoerspiele findet sich nichts; die Anzeige muss LEER BLEIBEN,
 * nicht ‚nicht gefunden' melden". Ein Kind, das ein Hoerspiel hoert, soll
 * keine Fehlermeldung sehen, und der Kern soll deswegen keinen 502 bauen.
 *
 * DAS PLUGIN WIRD NUR GEFRAGT, WENN ES DARF UND KANN — Recht `songtext` im
 * Manifest UND eine `songtext()`-Methode. Fehlt eines, ist das kein Fehler,
 * sondern die Auskunft „dieses Plugin liefert keine Texte".
 *
 * MEHRERE PLUGINS: das erste, das etwas liefert, gewinnt. Eine Zusammenfuehrung
 * waere hier falsch — zwei Quellen haben verschiedene Zeitmarken, und
 * ineinandergeschobene Zeilen ergeben keinen Text, sondern Kauderwelsch.
 */
export async function pluginSongtext(frage: {
  interpret: string
  titel: string
  dauerSek: number
}): Promise<{ kennung: string; zeilen: Songzeile[]; absaetze: string[]; synchron: boolean } | null> {
  for (const [kennung, e] of geladen) {
    if (e.zustand !== 'bereit' || !e.kann.songtext) continue
    if (!e.manifest.rechte.includes('songtext')) continue
    try {
      const roh = await rufen(e, 'songtext', frage)
      const urteil = songtextPruefen(roh)
      for (const m of urteil.maengel) melden(`${kennung}: ${m}`)
      if (!urteil.ok) {
        melden(`${kennung} lieferte keinen brauchbaren Songtext: ${urteil.maengel.join(' ')}`)
        continue
      }
      // EINE LEERE LISTE IST EIN ERGEBNIS, kein Fehlschlag — dieses Plugin
      // kennt das Stueck nicht. Das naechste darf es trotzdem kennen.
      if (urteil.zeilen.length === 0 && urteil.absaetze.length === 0) continue
      return {
        kennung,
        zeilen: urteil.zeilen,
        absaetze: urteil.absaetze,
        synchron: urteil.synchron,
      }
    } catch (f) {
      // Ein Plugin, das beim Textholen stirbt, darf die Wiedergabe nicht
      // anfassen. Ins Journal damit, weiter zum naechsten.
      melden(`${kennung} bei "songtext": ${(f as Error).message}`)
    }
  }
  return null
}

export async function befinden(kennung: string): Promise<{ ok: boolean; text?: string }> {
  const e = geladen.get(kennung)
  if (!e) return { ok: false, text: 'nicht geladen' }
  try {
    return (await rufen(e, 'befinden', null)) as { ok: boolean; text?: string }
  } catch (f) {
    return { ok: false, text: (f as Error).message }
  }
}

/**
 * Einen angemeldeten Knopf druecken (E77).
 *
 * DER WIRT PRUEFT GEGEN DAS MANIFEST, bevor er ruft: nur Kennungen, die unter
 * `aktionen` stehen, erreichen den Worker. Alles andere ist ein 404 der Route,
 * kein Ruf ins Blaue — ein Plugin soll sich darauf verlassen koennen, dass in
 * `aktion()` nur ankommt, was es selbst angemeldet hat.
 *
 * DIE ANTWORT WIRD GEBOGEN, NICHT GEGLAUBT (dieselbe Haltung wie bei
 * fundPruefen: was der Wirt annimmt, prueft der Wirt): ok wird ein echter
 * Boolean, text ein Text. Mehr Form hat die Antwort nicht.
 */
export async function pluginAktion(kennung: string, aktionsKennung: string): Promise<{ ok: boolean; text: string }> {
  const e = geladen.get(kennung)
  if (!e) return { ok: false, text: 'nicht geladen' }
  if (!e.manifest.aktionen.some((a) => a.kennung === aktionsKennung)) {
    return { ok: false, text: `"${aktionsKennung}" ist im Manifest nicht angemeldet` }
  }
  try {
    const roh = (await rufen(e, 'aktion', aktionsKennung)) as { ok?: unknown; text?: unknown } | null
    return { ok: roh?.ok === true, text: typeof roh?.text === 'string' ? roh.text : '' }
  } catch (f) {
    return { ok: false, text: (f as Error).message }
  }
}

/**
 * Der groesste Rumpf, den eine Plugin-Route zurueckgeben darf.
 *
 * 256 KB sind reichlich fuer JSON-Listen (die 18 ARD-Regale wiegen ~2 KB) und
 * klein genug, dass ein Plugin die Verwaltung nicht mit einem Katalogabzug
 * erschlaegt. Der Deckel sitzt im WIRT und nicht im Laufwerk — der Worker
 * teilt seinen Speicher mit dem Plugin, seine Pruefungen sind biegbar.
 */
const HTTP_ANTWORT_HOECHSTENS = 256 * 1024

/**
 * Eine Plugin-Route rufen (E77).
 *
 * STATUS NUR 200-499: ein Plugin, das 500 melden will, hat einen Fehler, und
 * der gehoert als solcher gemeldet (502 der Route), nicht als durchgereichter
 * Server-Status, der aussieht, als kaeme er vom Kern. 3xx faellt mit heraus —
 * Umleitungen ueber diese Flaeche waeren ein stiller Weg nach draussen.
 */
export async function pluginHttp(
  kennung: string,
  anfrage: { methode: 'GET' | 'POST'; pfad: string; abfrage: Record<string, string>; rumpf: unknown },
): Promise<{ status: number; inhalt: unknown }> {
  const e = geladen.get(kennung)
  if (!e) return { status: 404, inhalt: { fehler: 'nicht geladen' } }
  if (!e.kann.http) return { status: 404, inhalt: { fehler: `${kennung} hat keine http()-Methode` } }
  try {
    const roh = (await rufen(e, 'http', anfrage)) as { status?: unknown; inhalt?: unknown } | null
    // NUR 2xx UND 4xx. Der erste Wurf erlaubte „200-499" — und liess damit
    // 3xx durch, obwohl der Kommentar das Gegenteil behauptete. Der
    // Integrationszeuge nahm den Kommentar beim Wort und ueberfuehrte den
    // Code: eine 302 aus einem Plugin waere ein stiller Weg nach draussen.
    const s = roh?.status
    const status =
      typeof s === 'number' && Number.isInteger(s) && ((s >= 200 && s < 300) || (s >= 400 && s < 500))
        ? s
        : s === undefined
          ? 200
          : 0
    if (status === 0) return { status: 502, inhalt: { fehler: `Status ${String(roh?.status)} ist nicht erlaubt (200-499)` } }
    const inhalt = roh?.inhalt ?? null
    if (JSON.stringify(inhalt).length > HTTP_ANTWORT_HOECHSTENS) {
      return { status: 502, inhalt: { fehler: 'Antwort zu gross (Deckel 256 KB)' } }
    }
    return { status, inhalt }
  } catch (f) {
    return { status: 502, inhalt: { fehler: (f as Error).message } }
  }
}

/**
 * Der Pfad zum mitgebrachten Icon (E77) — oder null.
 *
 * AUFGELOEST UND GEGENGEPRUEFT: das Manifest ist zwar schon gegen `..` und
 * fuehrenden `/` geprueft, aber dieser Pfad geht in `res.sendFile` — und ein
 * doppelter Riegel an einer Stelle, die Dateien ins Netz gibt, ist keiner zu
 * viel. Dieselbe Bauart wie das Pfad-Gefaengnis in fundPruefen.
 */
export function pluginIconPfad(kennung: string): string | null {
  const e = geladen.get(kennung)
  if (!e?.manifest.icon) return null
  const voll = path.resolve(e.ordner, e.manifest.icon)
  if (voll !== e.ordner && !voll.startsWith(`${e.ordner}${path.sep}`)) return null
  return voll
}

/**
 * Ein Ereignis an alle horchenden Plugins.
 *
 * WIRFT NIE UND WARTET NICHT. Ein Ereignis ist eine Mitteilung, kein Auftrag —
 * die Lautstaerke darf nicht davon abhaengen, ob ein WLED-Plugin gerade
 * erreichbar ist.
 */
/**
 * EIN Ereignis an EIN Plugin — und diesmal abwarten.
 *
 * Nur fuer Werkzeuge (tools/plugin-pruefen.mjs). Im Betrieb ist ein Ereignis
 * eine Mitteilung und wird gestreut, nicht abgewartet: die Lautstaerke darf
 * nicht davon abhaengen, ob ein Lichtplugin gerade erreichbar ist. Ein
 * Entwickler dagegen will genau wissen, ob sein Plugin wirft.
 */
export async function ereignisSenden(kennung: string, name: Ereignisname, nutzlast: unknown): Promise<void> {
  const e = geladen.get(kennung)
  if (!e) throw new Error(`kein Plugin "${kennung}" geladen`)
  await rufen(e, 'ereignis', nutzlast, name)
}

export function ereignisStreuen(name: Ereignisname, nutzlast: unknown): void {
  for (const e of geladen.values()) {
    if (e.zustand !== 'bereit' || !e.kann.ereignis) continue
    rufen(e, 'ereignis', nutzlast, name).catch((f) => melden(`${e.manifest.kennung} bei "${name}": ${f.message}`))
  }
}

/**
 * Ein Plugin ein- oder ausschalten — sofort, ohne Neustart der Box.
 *
 * AUSSCHALTEN BEENDET DEN WORKER WIRKLICH. Ein „abgeschaltet", das im Speicher
 * weiterlaeuft, waere eine Beschriftung und keine Wirkung — und auf einer Box
 * mit 2 GB sind 11 MB je Erweiterung kein Rundungsfehler.
 *
 * DIE REIHENFOLGE IST DIESELBE WIE IN `einstellungenSetzen`: erst der Zustand,
 * dann `terminate()`. Sonst startet der `exit`-Behandler das gerade
 * abgeschaltete Plugin seinerseits wieder.
 */
export async function aktivSetzen(kennung: string, an: boolean): Promise<Zustand> {
  const e = geladen.get(kennung)
  if (!e) throw new Error(`kein Plugin "${kennung}" geladen`)

  if (!an) {
    offeneAufloesen(e, `${kennung} wurde abgeschaltet`)
    const alter = e.worker
    e.worker = null
    e.zustand = 'aus'
    e.grund = undefined
    await alter?.terminate()
    melden(`${kennung} abgeschaltet`)
    return e.zustand
  }

  // EIN BEREITS LAUFENDES NICHT NOCH EINMAL STARTEN — sonst laegen zwei Worker
  // auf derselben Kennung, und der zweite beantwortete Rufe, die dem ersten
  // galten.
  if (e.zustand !== 'aus' && e.worker) return e.zustand
  e.versuche = 0
  e.grund = undefined
  workerStarten(e)
  melden(`${kennung} eingeschaltet`)
  return e.zustand
}

/**
 * Die Klangketten ALLER bereiten Plugins mit dem Recht `klang`, der Reihe nach.
 *
 * ══ WARUM HIER GEPRUEFT WIRD UND NICHT ERST BEIM SCHREIBEN ════════════════
 * Dieselbe Trennung wie bei `aufloesen`: der Worker teilt sich den Speicher
 * mit dem Plugin, der Hauptstrang nicht. Was von drueben kommt, ist ein
 * Vorschlag, bis es hier durch `kettePruefen` gegangen ist.
 *
 * ══ EIN KRUMMES PLUGIN DARF DIE BOX NICHT STUMM MACHEN ════════════════════
 * Am Entwicklerrechner gemessen (21.08.2026): eine Filterkette mit einem
 * unbekannten Baustein laedt NICHT — `pipewire -c` bricht ab, und die Senke
 * erscheint gar nicht erst. Waere der Ton schon dorthin geroutet, stuende ein
 * Kind vor einer stummen Box. Deshalb faellt ein Plugin mit krummer Kette
 * HERAUS, statt die ganze Kette scheitern zu lassen — die uebrigen spielen
 * weiter, und der Grund steht im Journal.
 *
 * WIRFT NIE. Ein Plugin, das beim Fragen abstuerzt oder seine Frist reisst,
 * liefert eben nichts.
 */
export async function klangketten(
  ueberschreibung?: { kennung: string; werte: Record<string, unknown> } | null,
): Promise<{ kennung: string; kette: Klangglied[] }[]> {
  const raus: { kennung: string; kette: Klangglied[] }[] = []
  for (const e of geladen.values()) {
    if (e.zustand !== 'bereit' || !e.kann.klangkette) continue
    if (!e.manifest.rechte.includes('klang')) continue
    try {
      // Die Vorschau gilt nur fuer GENAU EIN Plugin — die uebrigen liefern
      // ihren gespeicherten Stand, sonst bekaeme ein Reglerzug am einen
      // Plugin die Kette eines anderen zu fassen.
      const arg =
        ueberschreibung && ueberschreibung.kennung === e.manifest.kennung
          ? einstellungenNormalisieren(ueberschreibung.werte, e.manifest.felder)
          : null
      const urteil = kettePruefen(await rufen(e, 'klangkette', arg))
      if (!urteil.ok) {
        melden(`${e.manifest.kennung} lieferte keine brauchbare Klangkette: ${urteil.maengel.join(' ')}`)
        continue
      }
      if (urteil.kette.length > 0) raus.push({ kennung: e.manifest.kennung, kette: urteil.kette })
    } catch (f) {
      melden(`${e.manifest.kennung} bei "klangkette": ${(f as Error).message}`)
    }
  }
  return raus
}

/**
 * Warten, bis ein Plugin wieder antwortet — hoechstens `fristMs`.
 *
 * ══ WOZU, AM GERAET GEMESSEN (21.08.2026) ═════════════════════════════════
 * `einstellungenSetzen` STARTET DAS PLUGIN NEU, und der neue Worker ist nicht
 * sofort da. Wer unmittelbar danach `klangketten()` ruft, bekommt eine LEERE
 * Liste — das Plugin steht auf `laedt` und wird uebersprungen.
 *
 * Auf der Box sah das so aus: Regler auf „Stereobasis 50" gestellt,
 * uebernommen, und die Antwort lautete „nichts eingehängt". Erst der zweite
 * Aufruf baute die Kette. Fuer den Betreiber ist das ein Regler, der beim
 * ersten Mal nichts tut — der aergerlichste Fehler ueberhaupt, weil er wie
 * Einbildung aussieht.
 *
 * Dieselbe Falle stand schon in plugin-einstellungen.integration.spec.ts und
 * in klangwerk.integration.spec.ts — dort wurde sie im TEST umgangen, statt
 * im Kern behoben. Jetzt hier, wo alle etwas davon haben.
 */
export async function warteBereit(kennung: string, fristMs = 5000): Promise<boolean> {
  const bis = Date.now() + fristMs
  for (;;) {
    const e = geladen.get(kennung)
    if (!e) return false
    if (e.zustand !== 'laedt') return e.zustand === 'bereit'
    if (Date.now() >= bis) return false
    await new Promise((f) => setTimeout(f, 50))
  }
}

/** Hat ueberhaupt ein Plugin das Recht `klang`? Billig — fuer die Ton-Seite. */
export function gibtKlangPlugins(): boolean {
  for (const e of geladen.values()) {
    if (e.manifest.rechte.includes('klang')) return true
  }
  return false
}

/** Die angemeldeten Felder eines Plugins — was der Eltern-Bereich abfragen soll. */
export function felderVon(kennung: string): Feld[] {
  return geladen.get(kennung)?.manifest.felder ?? []
}

/** Die gespeicherten Werte, UNMASKIERT. Zum Anzeigen `einstellungenMaskieren` benutzen. */
export function einstellungenVon(kennung: string): Record<string, unknown> {
  return { ...(geladen.get(kennung)?.einstellungen ?? {}) }
}

/**
 * Einstellungen aendern — und das Plugin damit NEU STARTEN.
 *
 * WARUM NEU STARTEN UND NICHT NACHREICHEN: der Kontext wird im Laufwerk EINMAL
 * gebaut und ist eingefroren (`Object.freeze`). Ein Plugin, das seine Adresse
 * beim Start liest, saehe eine Aenderung sonst nie — und der Benutzer haette
 * gespeichert, ohne dass etwas geschieht. Das ist schlimmer als ein kurzer
 * Aussetzer: es sieht aus wie ein kaputtes Plugin.
 *
 * Zurueck kommen die ZUSAMMENGEFUEHRTEN Werte, damit der Aufrufer genau das
 * ablegt, was jetzt gilt — und nicht das, was hereingereicht wurde.
 */
export async function einstellungenSetzen(kennung: string, neu: unknown): Promise<Record<string, unknown>> {
  const e = geladen.get(kennung)
  if (!e) throw new Error(`kein Plugin "${kennung}" geladen`)

  // Geheimnisse, die leer hereinkommen, bleiben stehen — siehe
  // `einstellungenZusammenfuehren`. Ohne das wischt ein Speichern aus dem
  // Eltern-Bereich jeden Schluessel weg, den es gerade nur maskiert angezeigt hat.
  e.einstellungen = einstellungenZusammenfuehren(e.einstellungen, neu, e.manifest.felder)

  // EIN ABGESCHALTETES PLUGIN BLEIBT ABGESCHALTET. Der Neustart unten waere
  // sonst ein Einschalten durch die Hintertuer: wer die Adresse eines
  // ausgeschalteten Lichts korrigiert, will sie korrigieren — nicht das Licht
  // anmachen. Die Werte sind oben schon zusammengefuehrt und bleiben stehen;
  // beim naechsten Einschalten baut `workerStarten` den Kontext daraus.
  if (e.zustand === 'aus') {
    melden(`${kennung}: Einstellungen geaendert (bleibt abgeschaltet)`)
    return { ...e.einstellungen }
  }

  offeneAufloesen(e, `${kennung}: Einstellungen geaendert, Neustart`)
  const alter = e.worker
  e.worker = null
  // ZUSTAND ERST AUF 'gescheitert', DANN BEENDEN: der `exit`-Behandler startet
  // sonst seinerseits neu, und es liefen zwei Worker gegen dieselbe Kennung.
  e.zustand = 'gescheitert'
  await alter?.terminate()
  e.versuche = 0
  e.grund = undefined
  workerStarten(e)
  melden(`${kennung}: Einstellungen geaendert, Plugin startet neu`)
  return { ...e.einstellungen }
}

/** Alles anhalten — fuer Tests und fuer das Herunterfahren. */
export async function allesBeenden(): Promise<void> {
  for (const e of geladen.values()) {
    e.zustand = 'gescheitert' // verhindert den Neustart im exit-Behandler
    offeneAufloesen(e, 'Box faehrt herunter')
    await e.worker?.terminate()
  }
  geladen.clear()
}
