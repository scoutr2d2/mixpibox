/**
 * Box-Sperre — „jetzt ist Pause", von den Eltern ausgeloest, mit Ende.
 *
 * Betreiber, 28.09.2026: „handy app: box sperren". Per Rueckfrage entschieden:
 * eine ECHTE Sperre mit Ende — die Box startet nichts mehr, laufende Musik
 * haelt an, das Kind sieht „Die Box macht Pause"; sie endet von selbst oder
 * per App und uebersteht einen Neustart.
 *
 * REINE LOGIK wie kinderzeit.ts: keine Uhr, keine Datei. Die Uhr kommt herein,
 * damit sich das Ende pruefen laesst, ohne es abzuwarten.
 *
 * WARUM NICHT DER WARTUNGSSCHIRM (/api/wartung): der wohnt mit Absicht in /tmp
 * und faellt mit jedem Neustart — eine Kindersperre, die der Stecker aufhebt,
 * ist keine. Und er sagt „an der Box wird gearbeitet", was fuer ein Kind die
 * falsche Geschichte ist.
 *
 * WARUM IMMER MIT ENDE: der teuerste Fehler dieser Sache ist eine VERGESSENE
 * Sperre — das Handy liegt im Buero, und die Box bleibt fuer das Kind stumm,
 * waehrend niemand mehr weiss, warum (dieselbe Abwaegung wie beim
 * Wartungsschirm in server.ts). Deshalb gibt es keine Sperre ohne `bis`, und
 * `bis` liegt hoechstens `MAX_MIN` in der Zukunft.
 *
 * DIE SPERRE IST EINE GRENZE, keine Erlaubnis (llmwiki
 * `kaputte-datei-darf-nicht-aufsperren`): eine unlesbare Datei darf kein Kind
 * AUSSPERREN. Alles, was nicht passt — kein `bis`, ein `bis` in der
 * Vergangenheit, ein `bis` jenseits der Hoechstdauer —, heisst „nicht
 * gesperrt".
 */
import type { Urteil } from './kinderzeit'

/** Laenger als einen Tag sperrt die Box nicht — siehe Kopf. */
export const MAX_MIN = 24 * 60

export interface Sperre {
  /** Ende der Sperre, Millisekunden seit 1970. */
  bis: number
  /** Wann sie gesetzt wurde — nur zur Auskunft. */
  seit: number
}

/** Was die Box nach aussen sagt — GET /api/boxsperre. */
export interface SperrStand {
  aktiv: boolean
  /** Ende in Millisekunden, oder null. */
  bis: number | null
  /** Ende als „HH:MM" in Ortszeit — fuer den Kinderschirm, '' wenn keine. */
  bisZeit: string
  /** Endet sie erst morgen? Dann schreibt der Schirm „morgen" dazu. */
  morgen: boolean
  /** Ganze Minuten bis zum Ende, aufgerundet; 0 wenn keine. */
  restMin: number
  seit: number | null
}

/**
 * Fremde Eingabe (Datei) in eine gueltige Sperre — oder null.
 *
 * `jetzt` entscheidet mit: eine abgelaufene Sperre ist keine, und eine, die
 * weiter reicht als `MAX_MIN`, ist kaputt und damit ebenfalls keine.
 */
export function sperreNormalisieren(roh: unknown, jetzt: number): Sperre | null {
  if (!roh || typeof roh !== 'object') return null
  const r = roh as Record<string, unknown>
  const bis = Number(r.bis)
  if (!Number.isFinite(bis) || bis <= jetzt) return null
  // Eine Minute Luft fuer Uhrenzittern zwischen Setzen und Lesen.
  if (bis > jetzt + (MAX_MIN + 1) * 60_000) return null
  const seit = Number(r.seit)
  return { bis, seit: Number.isFinite(seit) && seit > 0 && seit <= bis ? seit : jetzt }
}

/**
 * Eine Sperre aus einer Anfrage bauen: `{minuten}` ODER `{bis}` (ms).
 *
 * Wirft mit einem Satz fuer Menschen, wenn nichts Brauchbares darin steht —
 * anders als beim Lesen der Datei: wer sperren WILL und sich vertippt, soll
 * es erfahren, statt eine Box zu haben, die nicht gesperrt ist.
 */
export function sperreAusAnfrage(koerper: unknown, jetzt: number): Sperre {
  const k = (koerper ?? {}) as Record<string, unknown>
  let bis: number
  if (k.minuten !== undefined) {
    const m = Number(k.minuten)
    if (!Number.isFinite(m) || m < 1) throw new Error('Wie lange? Mindestens eine Minute.')
    if (m > MAX_MIN) throw new Error(`Länger als ${MAX_MIN / 60} Stunden sperrt die Box nicht.`)
    bis = jetzt + Math.round(m) * 60_000
  } else if (k.bis !== undefined) {
    bis = Number(k.bis)
    if (!Number.isFinite(bis) || bis <= jetzt) throw new Error('Das Ende der Sperre liegt nicht in der Zukunft.')
    if (bis > jetzt + MAX_MIN * 60_000) throw new Error(`Länger als ${MAX_MIN / 60} Stunden sperrt die Box nicht.`)
  } else {
    throw new Error('Es fehlt, wie lange die Box gesperrt sein soll.')
  }
  return { bis, seit: jetzt }
}

/** Zwei Stellen, Ortszeit — dieselbe Schreibweise wie die Zeitfenster der Kinderzeit. */
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function sperrStand(s: Sperre | null, jetzt: number): SperrStand {
  if (!s || s.bis <= jetzt) return { aktiv: false, bis: null, bisZeit: '', morgen: false, restMin: 0, seit: null }
  const ende = new Date(s.bis)
  const heute = new Date(jetzt)
  const morgen =
    ende.getFullYear() !== heute.getFullYear() ||
    ende.getMonth() !== heute.getMonth() ||
    ende.getDate() !== heute.getDate()
  return {
    aktiv: true,
    bis: s.bis,
    bisZeit: hhmm(ende),
    morgen,
    restMin: Math.ceil((s.bis - jetzt) / 60_000),
    seit: s.seit,
  }
}

/**
 * Das Urteil der Kinderzeit mit der Sperre verrechnen.
 *
 * DIE SPERRE GEWINNT IMMER, auch ueber „Kinderzeit aus": sie ist ein
 * ausdrueckliches Nein der Eltern, keine Regel. Die Zahlen der Kinderzeit
 * (`restMin`, Fenster) fahren unveraendert mit — sie stimmen weiter und gelten
 * wieder, sobald die Sperre endet.
 */
export function mitSperre(urteil: Urteil, s: Sperre | null, jetzt: number): Urteil {
  const st = sperrStand(s, jetzt)
  if (!st.aktiv) return urteil
  return { ...urteil, erlaubt: false, grund: 'gesperrt', gesperrtBis: st.bisZeit }
}
