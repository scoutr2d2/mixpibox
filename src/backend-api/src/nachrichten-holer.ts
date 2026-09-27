/**
 * Die drei Abholwege — und nichts sonst.
 *
 * GETRENNT VON nachrichten.ts, wie akkuverlauf/akkuverlaufablage und
 * systemverlauf/systemverlaufablage: dort steht, WAS eine Nachricht ist,
 * hier, WIE sie hereinkommt. Die Trennung ist nicht Ordnungsliebe — die
 * Absenderpruefung muss ohne Netz pruefbar sein, und der Abholweg ohne
 * Absenderpruefung.
 *
 * ══ DREI DIENSTE, DREI GRUNDVERSCHIEDENE WEGE ══════════════════════════════
 *
 * MATRIX holt mit `GET /_matrix/client/v3/sync` und einem Bearer-Token. Der
 * Ruf HAENGT bis zu `timeout` ms, wenn nichts da ist (Long Poll) — das ist
 * kein Fehler, sondern der Normalfall, und wer ihm eine kurze Frist setzt,
 * baut sich einen Dauerabbruch. Die Antwort traegt einen `next_batch`, der
 * beim naechsten Mal als `since` mitgeht; ohne ihn kommt jedes Mal die ganze
 * Vergangenheit.
 *
 * TELEGRAM holt mit `GET /bot<token>/getUpdates?offset=…&timeout=…`. Auch
 * Long Poll. Der `offset` ist `update_id + 1` der zuletzt gesehenen — und
 * ihn zu setzen ist das, was die Nachricht beim Dienst BESTAETIGT. Wer das
 * vergisst, bekommt dieselben Nachrichten bis in alle Ewigkeit.
 *
 * SIGNAL hat kein HTTP-Konto. Es braucht `signal-cli` als Dienst auf der Box
 * (`signal-cli daemon --tcp`), und der schiebt eintreffende Nachrichten als
 * JSON-RPC-Meldungen ueber eine TCP-Verbindung — eine JSON-Zeile je Meldung.
 * Deshalb ist Signal hier der einzige Weg mit einer stehenden Verbindung.
 *
 * ══ FEHLT SIGNAL-CLI, WIRD DAS GESAGT ══════════════════════════════════════
 *
 * Betreiber, 20.09.2026: Signal mitbauen, der Dienst darf fehlen. Dann sagt
 * `zustand()` genau das — `grund: 'kein-dienst'` samt Installationsbefehl —
 * statt dass ein Schalter ANsteht und nichts passiert. Ein Schalter, der
 * nichts schaltet, ist in diesem Baum ausdruecklich verboten
 * (konfiguration.ts, zum Fall mqtt.active).
 */
import net from 'node:net'
import {
  type AbgewiesenGrund,
  ausMatrix,
  ausSignal,
  ausTelegram,
  type Erlaubt,
  type Nachricht,
  type Weg,
} from './nachrichten'

/** Wie lange ein Long Poll haengen darf (ms). */
export const POLL_MS = 30_000

/**
 * Die Frist fuer EINE Abfrage — POLL_MS plus Luft.
 *
 * WER HIER `AbortSignal.timeout(POLL_MS)` SETZT, baut den Dauerabbruch: der
 * Dienst antwortet bestimmungsgemaess erst NACH dieser Zeit, wenn nichts
 * vorliegt. Die Luft ist fuer den Rueckweg.
 */
export const FRIST_MS = POLL_MS + 10_000

/** Wie lange nach einem Fehlschlag gewartet wird, bevor es wieder losgeht. */
export const RUHE_MS = 15_000

/**
 * Der kuerzeste Abstand zwischen zwei Runden EINES Weges.
 *
 * Er greift nur, wenn ein Dienst SOFORT und leer antwortet — dann ist der
 * Long Poll, auf den sich die Schleife verlaesst, nicht da, und ohne diesen
 * Abstand dreht sie mit voller Rechenlast. Im Normalfall ist eine Runde
 * laengst laenger als diese Sekunde.
 */
export const MINDEST_MS = 1000

export interface MatrixKonf {
  /** `https://matrix.example.org` — ohne Pfad. */
  server: string
  token: string
  /** Raumkennung `!abc:server` ODER leer fuer „alle Raeume, in denen ich bin". */
  raum?: string
}

export interface TelegramKonf {
  token: string
}

export interface SignalKonf {
  host: string
  port: number
  /** Die eigene Nummer der Box, wie sie bei signal-cli registriert ist. */
  nummer?: string
}

/** Was ein Abholvorgang zutage gefoerdert hat. */
export interface Ausbeute {
  nachrichten: Nachricht[]
  /** Abgewiesene — nur gezaehlt, der Text wird NICHT aufgehoben. */
  abgewiesen: { weg: Weg; absender: string; grund: AbgewiesenGrund }[]
  /** Wo es beim naechsten Mal weitergeht (Matrix `next_batch`, Telegram offset). */
  marke?: string
  /** Gesetzt, wenn der Dienst nicht mochte. Dann ist alles andere leer. */
  fehler?: string
}

function leer(): Ausbeute {
  return { nachrichten: [], abgewiesen: [] }
}

// ─────────────────────────────────────────────────────────────────────────
// Matrix
// ─────────────────────────────────────────────────────────────────────────

/**
 * Baut die Sync-Adresse. Rein — damit die Filterform pruefbar ist, ohne dass
 * jemand einen Homeserver aufsetzt.
 *
 * DER FILTER IST NICHT KOSMETIK. Ohne ihn liefert der erste Sync die
 * vollstaendige Zustandsgeschichte jedes Raums — auf einer Box mit einem
 * grossen Familienraum sind das Megabytes, bei jedem Neustart.
 * `limit: 20` je Raum und `lazy_load_members` halten es klein.
 */
export function matrixAdresse(k: MatrixKonf, seit?: string): string {
  const basis = k.server.replace(/\/+$/, '')
  const filter = {
    room: {
      timeline: { limit: 20 },
      state: { lazy_load_members: true },
      ...(k.raum ? { rooms: [k.raum] } : {}),
    },
    presence: { types: [] as string[] },
  }
  const p = new URLSearchParams({ timeout: String(POLL_MS), filter: JSON.stringify(filter) })
  // `since` FEHLT BEIM ERSTEN MAL, und das ist der Punkt: ein erster Sync
  // ohne Marke liefert den JETZT-Stand, kein Archiv. Was geschrieben wurde,
  // bevor die Box zuhoerte, ist nicht ihre Nachricht.
  if (seit) p.set('since', seit)
  return `${basis}/_matrix/client/v3/sync?${p.toString()}`
}

/** Wertet eine Sync-Antwort aus. Rein. */
export function matrixAuswerten(antwort: unknown, liste: readonly Erlaubt[]): Ausbeute {
  const a = antwort as Record<string, unknown> | null
  const aus = leer()
  if (!a || typeof a !== 'object') return aus
  aus.marke = typeof a.next_batch === 'string' ? a.next_batch : undefined
  const raeume = (a.rooms as Record<string, unknown> | undefined)?.join as Record<string, unknown> | undefined
  if (!raeume || typeof raeume !== 'object') return aus
  for (const raum of Object.values(raeume)) {
    const zeitstrahl = (raum as Record<string, unknown>)?.timeline as Record<string, unknown> | undefined
    const ereignisse = zeitstrahl?.events
    if (!Array.isArray(ereignisse)) continue
    for (const e of ereignisse) {
      const u = ausMatrix(e, liste)
      if (!u) continue
      if (u.ok) aus.nachrichten.push(u.nachricht)
      else aus.abgewiesen.push({ weg: u.weg, absender: u.absender, grund: u.grund })
    }
  }
  return aus
}

// ─────────────────────────────────────────────────────────────────────────
// Telegram
// ─────────────────────────────────────────────────────────────────────────

export function telegramAdresse(k: TelegramKonf, offset?: number): string {
  const p = new URLSearchParams({ timeout: String(Math.round(POLL_MS / 1000)) })
  if (offset !== undefined) p.set('offset', String(offset))
  // `allowed_updates` schneidet alles weg, was die Box nie auswertet —
  // Umfragen, Mitgliederwechsel, Kanalbeitraege. Weniger Netz, und vor allem
  // weniger, was ueberhaupt erst in die Auswertung geraet.
  p.set('allowed_updates', JSON.stringify(['message', 'edited_message']))
  return `https://api.telegram.org/bot${k.token}/getUpdates?${p.toString()}`
}

export function telegramAuswerten(antwort: unknown, liste: readonly Erlaubt[]): Ausbeute {
  const a = antwort as Record<string, unknown> | null
  const aus = leer()
  if (!a || typeof a !== 'object') return aus
  if (a.ok === false) {
    aus.fehler = String(a.description ?? 'Telegram lehnt ab')
    return aus
  }
  const updates = a.result
  if (!Array.isArray(updates)) return aus
  let hoechste = -1
  for (const u of updates) {
    const nr = Number((u as Record<string, unknown>)?.update_id)
    if (Number.isFinite(nr) && nr > hoechste) hoechste = nr
    const r = ausTelegram(u, liste)
    if (!r) continue
    if (r.ok) aus.nachrichten.push(r.nachricht)
    else aus.abgewiesen.push({ weg: r.weg, absender: r.absender, grund: r.grund })
  }
  // DIE MARKE WIRD AUCH BEI ABGEWIESENEN GESETZT. Sonst holt die Box die
  // Nachricht des Fremden bei jedem Takt erneut, weist sie erneut ab und
  // kommt nie an der nachfolgenden Nachricht der Mutter vorbei.
  if (hoechste >= 0) aus.marke = String(hoechste + 1)
  return aus
}

// ─────────────────────────────────────────────────────────────────────────
// Signal
// ─────────────────────────────────────────────────────────────────────────

/**
 * Schneidet aus einem Lesepuffer die ganzen Zeilen heraus.
 *
 * WARUM DAS EIN EIGENES STUECK IST: ein TCP-Lesevorgang liefert BYTES, keine
 * Nachrichten. Eine JSON-Zeile kann in zwei Paketen ankommen, und zwei
 * Zeilen koennen in einem stecken. Wer `JSON.parse` direkt auf das anwendet,
 * was aus dem Socket faellt, verliert bei Last genau die Nachricht, auf die
 * jemand wartet — und zwar unregelmaessig.
 */
export function zeilenSchneiden(puffer: string): { zeilen: string[]; rest: string } {
  const teile = puffer.split('\n')
  const rest = teile.pop() ?? ''
  return { zeilen: teile.map((z) => z.trim()).filter(Boolean), rest }
}

/**
 * Eine JSON-RPC-Zeile von signal-cli auswerten.
 *
 * EINE MELDUNG `method: 'receive'` IST EINE NACHRICHT; alles andere sind
 * Antworten auf eigene Rufe oder Rueckmeldungen des Dienstes und gehen hier
 * mit `null` heraus.
 */
export function signalZeile(zeile: string, liste: readonly Erlaubt[]): Ausbeute | null {
  let roh: unknown
  try {
    roh = JSON.parse(zeile)
  } catch {
    // Eine kaputte Zeile ist KEIN Grund, die Verbindung wegzuwerfen: der
    // Rest des Stroms ist in Ordnung, und ein Neuaufbau verliert, was
    // waehrenddessen ankommt.
    return null
  }
  const m = roh as Record<string, unknown>
  if (m?.method !== 'receive') return null
  const u = ausSignal(m.params, liste)
  if (!u) return null
  const aus = leer()
  if (u.ok) aus.nachrichten.push(u.nachricht)
  else aus.abgewiesen.push({ weg: u.weg, absender: u.absender, grund: u.grund })
  return aus
}

/**
 * Horcht, ob auf `host:port` ueberhaupt jemand ist.
 *
 * DAS IST DIE FRAGE HINTER „Signal geht nicht". `systemctl is-active` waere
 * hier die falsche Frage (siehe AGENTS.md: „Ein Dienst, der laeuft, tut
 * nicht, was er soll") — gefragt ist, ob die JSON-RPC-Tuer offen steht.
 */
export function dienstErreichbar(host: string, port: number, fristMs = 1500): Promise<boolean> {
  return new Promise((fertig) => {
    const s = new net.Socket()
    let raus = false
    const schluss = (antwort: boolean) => {
      if (raus) return
      raus = true
      s.destroy()
      fertig(antwort)
    }
    s.setTimeout(fristMs)
    s.once('connect', () => schluss(true))
    s.once('timeout', () => schluss(false))
    s.once('error', () => schluss(false))
    s.connect(port, host)
  })
}

/** Der Befehl, den der Eltern-Bereich anzeigt, wenn signal-cli fehlt. */
export const SIGNAL_HINWEIS =
  'signal-cli ist auf der Box nicht erreichbar. Einrichten: ' +
  'sudo apt install -y openjdk-17-jre-headless, signal-cli entpacken nach /opt/signal-cli, ' +
  'Nummer mit "signal-cli link -n MuPiBox" verbinden, dann den Dienst ' +
  'mupibox-signal.service starten (signal-cli daemon --tcp 127.0.0.1:7583).'
