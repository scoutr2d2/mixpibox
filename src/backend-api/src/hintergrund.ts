/**
 * HINTERGRUNDBILDER FUER THEMEN — pruefen, benennen, in Themendateien tragen.
 *
 * ══ WOFUER (Gestalter, BACKLOG E144, 27.09.2026) ═════════════════════════════
 * Betreiber: „auch hintergründe definieren und farben. alles drag und drop."
 * Ein Bild, das auf den Gestalter gezogen wird, landet auf der Box in
 * `server/config/hintergruende/` — NICHT in darstellung.json: die fragt die
 * Box alle 3 s ab (`ABGLEICH_MS`), und ein eingebettetes Bild waere bei
 * jedem Takt ein paar hundert Kilobyte Verkehr fuer nichts. In der Darstellung
 * steht nur der NAME (`hgBild`), und der ist der Inhalts-Hash:
 *
 *     <16 Hex-Zeichen sha256>.<jpg|png|webp>
 *
 * Damit gilt dreierlei ohne weitere Buchfuehrung:
 *   * dasselbe Bild zweimal hochgeladen ist EINE Datei;
 *   * ein Name kann nie auf einen anderen Inhalt zeigen — auch nicht, wenn
 *     eine fremde Themendatei einen vorhandenen Namen mitbringt (der Name
 *     wird beim Import NEU gerechnet, nicht geglaubt);
 *   * im Namen steht nie ein Pfad (`BILD_NAME` in mixpi-thema.ts).
 *
 * ══ TAUSCHBAR BLEIBT ES TROTZDEM ════════════════════════════════════════════
 * Eine Themendatei (mixpi-thema/1) darf die Bilder, auf die sie zeigt, unter
 * `anhaenge: { "<name>": "data:image/...;base64,..." }` MITBRINGEN. Der
 * Export legt sie bei, der Import legt sie ab. Ohne den Anhang waere ein
 * getauschtes Thema auf der zweiten Box eines ohne Hintergrund — genau die
 * Sorte „wirkt nicht", die niemand findet.
 *
 * REIN bis auf `node:crypto` — kein Dateizugriff; das Ablegen macht server.ts.
 */
import { createHash } from 'node:crypto'
import { BILD_NAME } from './mixpi-thema'

/** Groesstes Bild in Bytes. Der Gestalter verkleinert vorher auf 1280 px Kante. */
export const GROESSTE_BYTES = 3 * 1024 * 1024

/** Hoechstens so viele Anhaenge je Themendatei — ein Thema hat EINEN Hintergrund. */
export const HOECHSTENS_ANHAENGE = 2

export type BildArt = 'jpg' | 'png' | 'webp'

const MIME: Record<BildArt, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** Die Bildart aus den ersten Bytes — NICHT aus dem Dateinamen oder dem Content-Type. */
export function bildArt(b: Uint8Array): BildArt | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return 'png'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && // R
    b[1] === 0x49 && // I
    b[2] === 0x46 && // F
    b[3] === 0x46 && // F
    b[8] === 0x57 && // W
    b[9] === 0x45 && // E
    b[10] === 0x42 && // B
    b[11] === 0x50 // P
  )
    return 'webp'
  return null
}

export function mimeVon(name: string): string {
  const endung = name.slice(name.lastIndexOf('.') + 1) as BildArt
  return MIME[endung] || 'application/octet-stream'
}

/** Pruefen und benennen. `null` = kein Bild, zu gross oder leer. */
export function bildBenennen(b: Uint8Array): { name: string; art: BildArt } | null {
  if (!b || b.length === 0 || b.length > GROESSTE_BYTES) return null
  const art = bildArt(b)
  if (!art) return null
  const hash = createHash('sha256').update(b).digest('hex').slice(0, 16)
  return { name: `${hash}.${art}`, art }
}

/** Ist das ein gueltiger Ablagename? Dieselbe Regel wie am Format-Tor. */
export function istBildName(name: unknown): name is string {
  return typeof name === 'string' && BILD_NAME.test(name)
}

/** Ein Bild als data:-Adresse — fuer den Export. */
export function alsDatenAdresse(name: string, b: Uint8Array): string {
  return `data:${mimeVon(name)};base64,${Buffer.from(b).toString('base64')}`
}

/** data:image/…;base64,… -> Bytes. Alles andere -> null. */
export function datenAdresseLesen(s: unknown): Uint8Array | null {
  if (typeof s !== 'string') return null
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(s)
  if (!m) return null
  // Vor dem Dekodieren abschaetzen: base64 ist 4/3 so lang wie der Inhalt.
  if ((m[2].length * 3) / 4 > GROESSTE_BYTES + 4) return null
  const b = Buffer.from(m[2], 'base64')
  return b.length ? new Uint8Array(b) : null
}

export interface AnhangBefund {
  fehler: string[]
  /** Je angenommenem Anhang: der Name in der Datei, der gerechnete Name, die Bytes. */
  bilder: { alt: string; name: string; bytes: Uint8Array }[]
}

/**
 * Die `anhaenge` einer Themendatei pruefen. Fehlt der Schluessel, ist das
 * kein Fehler (die meisten Themen haben kein Bild). Jeder Anhang wird am
 * INHALT geprueft und neu benannt — der mitgebrachte Name ist nur der
 * Schluessel, ueber den der Block `hintergrund.bild` auf ihn zeigt.
 */
export function anhaengePruefen(anhaenge: unknown): AnhangBefund {
  const fehler: string[] = []
  const bilder: AnhangBefund['bilder'] = []
  if (anhaenge === undefined || anhaenge === null) return { fehler, bilder }
  if (typeof anhaenge !== 'object' || Array.isArray(anhaenge)) {
    return { fehler: ['anhaenge ist kein Objekt'], bilder }
  }
  const eintraege = Object.entries(anhaenge as Record<string, unknown>)
  if (eintraege.length > HOECHSTENS_ANHAENGE) {
    fehler.push(`anhaenge: hoechstens ${HOECHSTENS_ANHAENGE} Bilder je Thema`)
    return { fehler, bilder }
  }
  for (const [alt, wert] of eintraege) {
    if (!istBildName(alt)) {
      fehler.push(`anhaenge: "${String(alt).slice(0, 40)}" ist kein Bildname`)
      continue
    }
    const bytes = datenAdresseLesen(wert)
    const benannt = bytes ? bildBenennen(bytes) : null
    if (!bytes || !benannt) {
      fehler.push(`anhaenge.${alt}: kein JPEG/PNG/WebP bis ${GROESSTE_BYTES / 1024 / 1024} MB`)
      continue
    }
    bilder.push({ alt, name: benannt.name, bytes })
  }
  return { fehler, bilder }
}

/**
 * `hintergrund.bild` auf den gerechneten Namen umschreiben. Zeigt der Block
 * auf einen Namen, fuer den KEIN Anhang kam, bleibt er stehen — das Bild
 * kann auf dieser Box schon liegen (dasselbe Thema zum zweiten Mal).
 */
export function bildNamenUmschreiben(
  bloecke: Readonly<Record<string, unknown>>,
  umbenannt: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const hg = bloecke.hintergrund as Record<string, unknown> | undefined
  if (!hg || typeof hg !== 'object' || typeof hg.bild !== 'string') return { ...bloecke }
  const neu = umbenannt.get(hg.bild)
  if (!neu || neu === hg.bild) return { ...bloecke }
  return { ...bloecke, hintergrund: { ...hg, bild: neu } }
}
