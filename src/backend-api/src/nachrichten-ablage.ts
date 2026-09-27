/**
 * Was von den Nachrichten auf die Karte geht — und was der Eltern-Bereich
 * eintragen darf.
 *
 * GETRENNT VON nachrichten.ts und nachrichten-holer.ts: dort steht, was eine
 * Nachricht IST und WIE sie hereinkommt; hier, wie sie liegt und wie die
 * Erlaubnisliste geprueft wird, bevor jemand sie speichert.
 *
 * ══ DIE PRUEFUNG BEIM EINTRAGEN IST DER EIGENTLICHE GRUND ══════════════════
 *
 * `absenderSchluessel` gibt bei einer nationalen Telefonnummer eine LEERE
 * Zeichenkette zurueck — und ein leerer Schluessel trifft nie. Wuerde der
 * Eltern-Bereich `0170 …` stumm aufnehmen, stuende danach ein Eintrag in der
 * Liste, der aussieht wie eine Freigabe und keine ist. Genau diese Sorte
 * Fehler sucht niemand an der richtigen Stelle. Deshalb weist
 * `erlaubtPruefen` ihn AB und sagt, was fehlt.
 */
import fs from 'node:fs'
import { jsonAtomarSchreiben } from './atomar'
import { absenderSchluessel, DECKEL, type Erlaubt, type Nachricht, WEGE, type Weg } from './nachrichten'

export const DATEINAME = 'nachrichten.json'

/** Was in der Datei liegt. */
export interface Ablage {
  nachrichten: Nachricht[]
  /**
   * Wo jeder Weg beim naechsten Mal weitermacht.
   *
   * WARUM AUF DER KARTE UND NICHT IM ARBEITSSPEICHER: ein Neustart des
   * Servers (Aktualisierung, Absturz, Stromausfall) wuerde sonst bei Matrix
   * den Ausgangspunkt verlieren und bei Telegram alles noch einmal holen,
   * was der Dienst noch vorhaelt — die Box rufe das Kind nach jedem Neustart
   * erneut. Es sind drei kurze Zeichenketten.
   */
  marken: Partial<Record<Weg, string>>
  /**
   * Wie oft jemand geklopft hat, der nicht auf der Liste steht — je Weg.
   *
   * NUR EINE ZAHL UND DIE LETZTE KENNUNG, NIE DER TEXT. Der Eltern-Bereich
   * soll sehen, DASS jemand schreibt (dann fehlt vielleicht ein Eintrag),
   * ohne dass die Box zur Ablage fremder Nachrichten wird.
   */
  abgewiesen: Partial<Record<Weg, { anzahl: number; zuletzt: string; wann: number }>>
}

export function leereAblage(): Ablage {
  return { nachrichten: [], marken: {}, abgewiesen: {} }
}

function istWeg(w: unknown): w is Weg {
  return typeof w === 'string' && (WEGE as readonly string[]).includes(w)
}

/**
 * Macht aus allem, was in der Datei stand, eine brauchbare Ablage.
 *
 * KEIN WURF, NIE. Eine halbe Datei (Stromausfall beim Schreiben) darf nicht
 * dazu fuehren, dass die Box keine Nachrichten mehr annimmt — dieselbe
 * Haltung wie bei `profilStandNormalisieren` in server.ts.
 */
export function ablageNormalisieren(roh: unknown): Ablage {
  const a = leereAblage()
  const r = roh as Record<string, unknown> | null
  if (!r || typeof r !== 'object') return a
  if (Array.isArray(r.nachrichten)) {
    for (const n of r.nachrichten) {
      const x = n as Record<string, unknown>
      if (!x || typeof x.id !== 'string' || !istWeg(x.weg) || typeof x.text !== 'string') continue
      a.nachrichten.push({
        id: x.id,
        weg: x.weg,
        absender: String(x.absender ?? ''),
        absenderName: String(x.absenderName ?? ''),
        text: x.text,
        zeit: Number(x.zeit) || 0,
        gelesen: x.gelesen === true,
        gesprochen: x.gesprochen === true,
      })
    }
    a.nachrichten = a.nachrichten.slice(0, DECKEL)
  }
  const m = r.marken as Record<string, unknown> | undefined
  if (m && typeof m === 'object') {
    for (const w of WEGE) if (typeof m[w] === 'string') a.marken[w] = m[w] as string
  }
  const ab = r.abgewiesen as Record<string, unknown> | undefined
  if (ab && typeof ab === 'object') {
    for (const w of WEGE) {
      const e = ab[w] as Record<string, unknown> | undefined
      if (!e || typeof e !== 'object') continue
      a.abgewiesen[w] = {
        anzahl: Number(e.anzahl) || 0,
        zuletzt: String(e.zuletzt ?? ''),
        wann: Number(e.wann) || 0,
      }
    }
  }
  return a
}

export function ablageLesen(pfad: string): Ablage {
  try {
    return ablageNormalisieren(JSON.parse(fs.readFileSync(pfad, 'utf8')))
  } catch {
    return leereAblage()
  }
}

export async function ablageSchreiben(pfad: string, a: Ablage): Promise<void> {
  await jsonAtomarSchreiben(pfad, a)
}

// ─────────────────────────────────────────────────────────────────────────
// Die Erlaubnisliste, wie der Eltern-Bereich sie setzt
// ─────────────────────────────────────────────────────────────────────────

/** Was beim Eintragen schiefgehen kann — je Fall ein Satz fuer den Menschen. */
export const EINTRAG_FEHLER: Record<string, string> = {
  weg: 'Unbekannter Weg. Erlaubt sind Matrix, Signal und Telegram.',
  leer: 'Es fehlt die Kennung des Absenders.',
  matrix: 'Eine Matrix-ID sieht so aus: @mama:server.example — mit @ davor und dem Server dahinter.',
  signal:
    'Die Nummer muss international geschrieben sein: +49 170 … oder 0049 170 …. ' +
    'Eine Nummer ohne Landeskennzahl passt nie zu dem, was Signal meldet.',
  telegram: 'Eine Telegram-Chat-ID ist eine Zahl, oft mit Minus davor. Der @-Name ist keine.',
  doppelt: 'Dieser Absender steht schon auf der Liste.',
}

export type EintragUrteil = { ok: true; eintrag: Erlaubt } | { ok: false; grund: string; satz: string }

/**
 * Prueft EINEN Eintrag, bevor er in die Liste kommt.
 *
 * DIE MATRIX-FORM WIRD HIER GEPRUEFT UND NICHT IN `absenderSchluessel`: der
 * Schluessel formt um, er urteilt nicht. Beim EINTRAGEN dagegen ist ein
 * Urteil genau das, was gebraucht wird — `mama` ohne `@` und ohne Server ist
 * keine Matrix-ID, und wer ihn so eintraegt, wartet danach vergeblich.
 */
export function erlaubtPruefen(roh: unknown, schon: readonly Erlaubt[] = []): EintragUrteil {
  const r = roh as Record<string, unknown> | null
  const weg = r?.weg
  if (!istWeg(weg)) return { ok: false, grund: 'weg', satz: EINTRAG_FEHLER.weg }
  const roheKennung = String(r?.absender ?? '').trim()
  if (!roheKennung) return { ok: false, grund: 'leer', satz: EINTRAG_FEHLER.leer }
  const schluessel = absenderSchluessel(weg, roheKennung)
  if (!schluessel) return { ok: false, grund: weg, satz: EINTRAG_FEHLER[weg] }
  if (weg === 'matrix' && !/^@[^:\s]+:[^:\s]+$/.test(schluessel)) {
    return { ok: false, grund: 'matrix', satz: EINTRAG_FEHLER.matrix }
  }
  if (schon.some((e) => e.weg === weg && absenderSchluessel(weg, e.absender) === schluessel)) {
    return { ok: false, grund: 'doppelt', satz: EINTRAG_FEHLER.doppelt }
  }
  const name = String(r?.name ?? '')
    .trim()
    .slice(0, 40)
  return { ok: true, eintrag: name ? { weg, absender: schluessel, name } : { weg, absender: schluessel } }
}

/**
 * Prueft eine GANZE Liste und wirft heraus, was nicht taugt.
 *
 * Wofuer das gebraucht wird: die Liste steht in der Konfiguration, und eine
 * Konfiguration kann von Hand bearbeitet worden sein (`jsoneditor`, ein
 * Backup von einer alten Box, ein Tippfehler in der Vorlage). Der Holer darf
 * sich darauf nicht verlassen — er bekommt nur, was durchkommt.
 */
export function listePruefen(roh: unknown): { liste: Erlaubt[]; verworfen: number } {
  if (!Array.isArray(roh)) return { liste: [], verworfen: 0 }
  const liste: Erlaubt[] = []
  let verworfen = 0
  for (const e of roh) {
    const u = erlaubtPruefen(e, liste)
    if (u.ok) liste.push(u.eintrag)
    else verworfen++
  }
  return { liste, verworfen }
}

/** Zaehlt einen Abgewiesenen — ohne seinen Text. */
export function abweisungBuchen(a: Ablage, weg: Weg, absender: string, jetzt: number): Ablage {
  const vorher = a.abgewiesen[weg]
  return {
    ...a,
    abgewiesen: {
      ...a.abgewiesen,
      [weg]: { anzahl: (vorher?.anzahl ?? 0) + 1, zuletzt: absender, wann: jetzt },
    },
  }
}
