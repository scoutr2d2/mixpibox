/**
 * DIE ABLAGE DES GESTALTERS — wohin ein Thema geht und woher es kommt.
 *
 * ══ ZWEI WEGE, EINE SCHNITTSTELLE (BACKLOG E144, 27.09.2026) ═══════════════
 * Betreiber: „auch vorbereiten, dass es eine Desktop-App win/linux/mac geben
 * kann, um Themes zu gestalten." Der Gestalter selbst weiss deshalb NICHT,
 * wo er laeuft. Er redet mit dieser Datei, und die kennt zwei Lagen:
 *
 *   BOX        die Seite kommt von einer Box (/neu/gestalter/) — oder die
 *              Desktop-App hat sie von dort geladen. Dann gibt es /api: die
 *              Themen der Box, Bilder hochladen, anwenden, ablegen.
 *   OHNE BOX   die Desktop-App zeigt den Gestalter aus ihren eigenen Dateien
 *              (kein Netz, keine Box). Dann bleibt: gestalten, als Datei
 *              speichern, Datei oeffnen. Bilder reisen als Anhang der Datei.
 *
 * DATEIEN oeffnen und speichern geht in beiden Lagen, und zwar ueber die
 * Bruecke der Desktop-App (`window.mixpiDesktop`, desktop/gestalter/
 * preload.cjs), wenn es sie gibt — sonst ueber den Browser (Download bzw.
 * <input type=file>). Die Bruecke ist mit Absicht klein: zwei Dateidialoge,
 * sonst nichts. Alles andere laeuft im Browser-Teil, damit es EINEN Gestalter
 * gibt und nicht einen je Plattform.
 */

const API = '../../api'

/** Ein Fehler mit dem Satz des Servers (das Tor lehnt mit Saetzen ab). */
export class AblageFehler extends Error {
  constructor(satz, { status = 0, fehler = [], name = '' } = {}) {
    super(satz)
    this.status = status
    this.fehler = fehler
    this.themaName = name
  }
}

async function antwort(r) {
  let body = null
  try {
    body = await r.json()
  } catch {
    /* kein JSON */
  }
  if (!r.ok) {
    const satz =
      r.status === 401
        ? 'Nicht angemeldet — bitte in der Verwaltung anmelden und diese Seite neu laden.'
        : (body && (body.error || (Array.isArray(body.fehler) && body.fehler.join(' · ')))) || `Fehler ${r.status}`
    throw new AblageFehler(satz, { status: r.status, fehler: body?.fehler || [], name: body?.name || '' })
  }
  return body
}

function jsonSenden(pfad, methode, daten) {
  return fetch(`${API}${pfad}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(daten),
  }).then(antwort)
}

/**
 * Ist eine Box da? Gefragt wird GET /api/darstellung — derselbe Endpunkt, den
 * der Gestalter ohnehin zuerst braucht. 401 heisst: Box da, aber nicht
 * angemeldet (dann soll der Hinweis kommen, nicht „ohne Box").
 */
export async function verbinden() {
  try {
    const r = await fetch(`${API}/darstellung`, { credentials: 'same-origin', cache: 'no-store' })
    if (r.status === 401) return { box: true, angemeldet: false, stand: null }
    if (!r.ok) return { box: false, angemeldet: false, stand: null }
    const stand = await r.json()
    if (!stand || typeof stand !== 'object' || !('themen' in stand)) return { box: false, angemeldet: false, stand: null }
    return { box: true, angemeldet: true, stand }
  } catch {
    return { box: false, angemeldet: false, stand: null }
  }
}

export const box = {
  /** Den Entwurf auf das aktive Profil legen (zusammengefuehrt, nicht ersetzt). */
  anwenden: (dokument) => jsonSenden('/thema/anwenden', 'POST', { dokument }),
  /** Unter seinem Namen ablegen. 409 = gibt es schon (dann mit ueberschreiben). */
  ablegen: (dokument, ueberschreiben = false) => jsonSenden('/thema/import', 'POST', { dokument, ueberschreiben }),
  /** Ein abgelegtes Thema als Dokument — MIT Bild-Anhang. */
  holen: (name) =>
    fetch(`${API}/thema/export/${encodeURIComponent(name)}`, { credentials: 'same-origin' }).then(antwort),
  bilder: () => fetch(`${API}/gestalter/hintergruende`, { credentials: 'same-origin' }).then(antwort),
  bildAdresse: (name) => `${API}/gestalter/hintergrund/${encodeURIComponent(name)}`,
  async bildHochladen(blob) {
    const r = await fetch(`${API}/gestalter/hintergrund`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      credentials: 'same-origin',
      body: blob,
    })
    return antwort(r)
  },
  bildLoeschen: (name) =>
    fetch(`${API}/gestalter/hintergrund/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    }).then(antwort),
  /** Ein Bild der Box als data:-Adresse — fuer die Themendatei. */
  async bildAlsDaten(name) {
    const r = await fetch(`${API}/gestalter/hintergrund/${encodeURIComponent(name)}`, { credentials: 'same-origin' })
    if (!r.ok) return null
    return blobAlsDaten(await r.blob())
  },
}

export function blobAlsDaten(blob) {
  return new Promise((gut, schlecht) => {
    const l = new FileReader()
    l.onload = () => gut(String(l.result))
    l.onerror = () => schlecht(l.error)
    l.readAsDataURL(blob)
  })
}

/**
 * Ein Bild fuer den Schirm vorbereiten: hoechstens 1280x800 (der Schirm hat
 * 800x480 — mehr ist Speicher ohne Nutzen, aber ein Beamer-Bild darf etwas
 * Luft haben), als JPEG. Ein PNG mit Durchsicht verliert sie dabei; fuer
 * einen HINTERGRUND ist das richtig, dahinter liegt ohnehin nichts.
 */
export async function bildVerkleinern(datei) {
  const bild = await createImageBitmap(datei)
  const f = Math.min(1, 1280 / bild.width, 800 / bild.height)
  const b = Math.max(1, Math.round(bild.width * f))
  const h = Math.max(1, Math.round(bild.height * f))
  const leinwand = document.createElement('canvas')
  leinwand.width = b
  leinwand.height = h
  leinwand.getContext('2d').drawImage(bild, 0, 0, b, h)
  bild.close?.()
  return new Promise((gut, schlecht) =>
    leinwand.toBlob((blob) => (blob ? gut(blob) : schlecht(new Error('Bild nicht lesbar'))), 'image/jpeg', 0.85),
  )
}

/**
 * Ein VORLAEUFIGER Name fuer ein Bild ohne Box: 16 Hex-Zeichen wie auf der
 * Box, aber aus einer einfachen Pruefsumme (FNV-1a, zweimal) statt sha256 —
 * `crypto.subtle` gibt es auf einer http-Box nicht. Das ist unbedenklich: der
 * Name ist nur der Schluessel zwischen Block und Anhang, die Box rechnet beim
 * Import den echten Namen am Inhalt neu (hintergrund.ts).
 */
export async function vorlaeufigerName(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0
    b = Math.imul(b ^ bytes[bytes.length - 1 - i], 0x811c9dc5) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}.jpg`
}

/** Die Desktop-Bruecke, falls es sie gibt (desktop/gestalter/preload.cjs). */
function bruecke() {
  const d = globalThis.mixpiDesktop
  return d && typeof d.dateiSpeichern === 'function' && typeof d.dateiOeffnen === 'function' ? d : null
}

export const istDesktop = () => !!bruecke()

/** Eine Themendatei speichern — Dialog der App oder Download des Browsers. */
export async function dateiSpeichern(dokument) {
  const text = `${JSON.stringify(dokument, null, 2)}\n`
  const vorschlag = `${(dokument.name || 'thema').replace(/[\\/:*?"<>|]+/g, '-')}.mixpi-thema.json`
  const d = bruecke()
  if (d) return d.dateiSpeichern(vorschlag, text)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = vorschlag
  document.body.append(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 1000)
  return true
}

/** Eine Themendatei oeffnen — Dialog der App oder Dateiwahl des Browsers. Gibt den TEXT. */
export async function dateiOeffnen() {
  const d = bruecke()
  if (d) return d.dateiOeffnen()
  return new Promise((gut) => {
    const eingabe = document.createElement('input')
    eingabe.type = 'file'
    eingabe.accept = '.json,application/json'
    eingabe.addEventListener('change', async () => {
      const f = eingabe.files?.[0]
      gut(f ? await f.text() : null)
    })
    eingabe.click()
  })
}
