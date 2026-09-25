/**
 * Das HAT-Protokoll zum Mitnehmen: JSON, Excel und PDF.
 *
 * WOFUER: die Ursache des blinkenden Lichts liess sich nur an einer REIHE von
 * Messungen erkennen — ein einzelner Blick zeigte mal "nicht anerkannt", mal
 * "kein Eingang". So etwas haelt man als Datei fest, nicht als
 * Bildschirmfoto.
 *
 * OHNE FREMDE BIBLIOTHEK. Eine Tabellen- oder PDF-Bibliothek waere fuer drei
 * Dateiformate ein Vielfaches des Codes hier, muesste mitgeliefert und
 * gepflegt werden und liefe auf einer Box, die von einer SD-Karte startet.
 * Beide Formate sind offen dokumentiert und hier direkt erzeugt:
 *   * XLSX ist ein ZIP mit XML darin (OOXML). Der ZIP-Schreiber unten legt
 *     die Dateien UNKOMPRIMIERT ab ("stored") — das ist gueltig und spart den
 *     ganzen Deflate-Teil.
 *   * PDF ist ein Textformat mit einer Querverweistabelle am Ende.
 *
 * REIN: kein Netz, kein Dateizugriff, keine Uhr. Alles kommt herein, heraus
 * kommen Bytes.
 */

/** Eine Zeile des Protokolls. */
export interface Zeile {
  t: number
  vbus?: number
  ibus?: number
  vbat?: number
  ibat?: number
  temp?: number
  soc?: number
  quelle?: string
  ladezustand?: string
  limit?: number
  /** Rohwerte der Statusregister, als Text "0x1c". */
  regs?: Record<string, string>
}

/** Die Spalten — EINE Stelle, damit alle drei Formate gleich aussehen. */
export const SPALTEN: ReadonlyArray<{ kopf: string; hol: (z: Zeile) => string; breite: number }> = [
  { kopf: 'Zeit', hol: (z) => new Date(z.t).toISOString().replace('T', ' ').slice(0, 19), breite: 20 },
  { kopf: 'VBUS mV', hol: (z) => zahl(z.vbus), breite: 9 },
  { kopf: 'IBUS mA', hol: (z) => zahl(z.ibus), breite: 9 },
  { kopf: 'VBAT mV', hol: (z) => zahl(z.vbat), breite: 9 },
  { kopf: 'IBAT mA', hol: (z) => zahl(z.ibat), breite: 9 },
  { kopf: 'Grad', hol: (z) => zahl(z.temp), breite: 7 },
  { kopf: 'SOC %', hol: (z) => zahl(z.soc), breite: 7 },
  { kopf: 'Limit mA', hol: (z) => zahl(z.limit), breite: 9 },
  { kopf: 'Quelle', hol: (z) => z.quelle ?? '', breite: 26 },
  { kopf: 'Ladevorgang', hol: (z) => z.ladezustand ?? '', breite: 18 },
  { kopf: '0x1B', hol: (z) => z.regs?.['0x1b'] ?? '', breite: 7 },
  { kopf: '0x1C', hol: (z) => z.regs?.['0x1c'] ?? '', breite: 7 },
  { kopf: '0x1D', hol: (z) => z.regs?.['0x1d'] ?? '', breite: 7 },
  { kopf: '0x20', hol: (z) => z.regs?.['0x20'] ?? '', breite: 7 },
  { kopf: '0x21', hol: (z) => z.regs?.['0x21'] ?? '', breite: 7 },
]

function zahl(v: unknown): string {
  return Number.isFinite(Number(v)) && v !== null && v !== undefined ? String(v) : ''
}

/* ── JSON ────────────────────────────────────────────────────────────── */

export function alsJson(zeilen: ReadonlyArray<Zeile>, kopf: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...kopf, spalten: SPALTEN.map((s) => s.kopf), zeilen }, null, 2)
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

/**
 * CSV mit **Semikolon** und BOM.
 *
 * Das Semikolon, weil Excel in deutscher Einstellung sonst alles in EINE
 * Spalte legt; das BOM, weil Excel die Datei sonst nicht als UTF-8 liest und
 * aus "Ladegerät" ein "LadegerÃ¤t" macht.
 */
export function alsCsv(zeilen: ReadonlyArray<Zeile>): string {
  const feld = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const kopf = SPALTEN.map((s) => feld(s.kopf)).join(';')
  const rest = zeilen.map((z) => SPALTEN.map((s) => feld(s.hol(z))).join(';'))
  return '﻿' + [kopf, ...rest].join('\r\n') + '\r\n'
}

/* ── ZIP (nur "stored", das genuegt fuer XLSX) ───────────────────────── */

let crcTabelle: Uint32Array | null = null
export function crc32(daten: Uint8Array): number {
  if (!crcTabelle) {
    crcTabelle = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTabelle[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < daten.length; i++) c = crcTabelle[(c ^ daten[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const roh = (s: string) => new TextEncoder().encode(s)

/**
 * Ein Byte je Zeichen (Latin-1) — NICHT UTF-8.
 *
 * Das PDF deklariert /WinAnsiEncoding, also erwartet der Betrachter EIN Byte
 * je Zeichen. Wer hier UTF-8 schreibt, bekommt aus "Störungen" ein
 * "StÃ¶rungen" (am erzeugten PDF gesehen) — und die Laengenangabe /Length
 * stimmt dann obendrein nicht mehr, weil sie Bytes zaehlt und nicht Zeichen.
 */
const latin1 = (s: string) => {
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff
  return b
}

export function zipStore(dateien: ReadonlyArray<{ name: string; inhalt: string }>): Uint8Array {
  const stuecke: Uint8Array[] = []
  const eintraege: Array<{ name: Uint8Array; crc: number; laenge: number; wo: number }> = []
  let wo = 0
  const schreib = (b: Uint8Array) => {
    stuecke.push(b)
    wo += b.length
  }
  const kopf = (laenge: number) => {
    const b = new Uint8Array(laenge)
    return { b, v: new DataView(b.buffer) }
  }

  for (const d of dateien) {
    const name = roh(d.name)
    const inhalt = roh(d.inhalt)
    const crc = crc32(inhalt)
    const start = wo
    const { b, v } = kopf(30)
    v.setUint32(0, 0x04034b50, true) // Signatur
    v.setUint16(4, 20, true) // benoetigte Fassung
    v.setUint16(6, 0, true)
    v.setUint16(8, 0, true) // 0 = ohne Kompression
    v.setUint32(14, crc, true)
    v.setUint32(18, inhalt.length, true)
    v.setUint32(22, inhalt.length, true)
    v.setUint16(26, name.length, true)
    schreib(b)
    schreib(name)
    schreib(inhalt)
    eintraege.push({ name, crc, laenge: inhalt.length, wo: start })
  }

  const verzeichnisAb = wo
  for (const e of eintraege) {
    const { b, v } = kopf(46)
    v.setUint32(0, 0x02014b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 20, true)
    v.setUint16(10, 0, true)
    v.setUint32(16, e.crc, true)
    v.setUint32(20, e.laenge, true)
    v.setUint32(24, e.laenge, true)
    v.setUint16(28, e.name.length, true)
    v.setUint32(42, e.wo, true)
    schreib(b)
    schreib(e.name)
  }
  const { b, v } = kopf(22)
  v.setUint32(0, 0x06054b50, true)
  v.setUint16(8, eintraege.length, true)
  v.setUint16(10, eintraege.length, true)
  v.setUint32(12, wo - verzeichnisAb, true)
  v.setUint32(16, verzeichnisAb, true)
  schreib(b)

  const alles = new Uint8Array(wo)
  let p = 0
  for (const s of stuecke) {
    alles.set(s, p)
    p += s.length
  }
  return alles
}

/* ── XLSX ────────────────────────────────────────────────────────────── */

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A, B, … Z, AA, … — die Spaltennamen von Excel. */
export function spaltenName(n: number): string {
  let s = ''
  n += 1
  while (n > 0) {
    const rest = (n - 1) % 26
    s = String.fromCharCode(65 + rest) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function alsXlsx(zeilen: ReadonlyArray<Zeile>, titel = 'MuPiHAT-Protokoll'): Uint8Array {
  const zelle = (sp: number, zi: number, wert: string) => {
    // Zahlen als Zahl, alles andere als "inlineStr" — so spart man die
    // sharedStrings-Datei und Excel rechnet trotzdem mit den Messwerten.
    const istZahl = wert !== '' && /^-?\d+(\.\d+)?$/.test(wert)
    const bez = `${spaltenName(sp)}${zi}`
    return istZahl
      ? `<c r="${bez}"><v>${wert}</v></c>`
      : `<c r="${bez}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(wert)}</t></is></c>`
  }
  const kopfZeile =
    `<row r="1">` + SPALTEN.map((s, i) => zelle(i, 1, s.kopf)).join('') + `</row>`
  const datenZeilen = zeilen
    .map((z, k) => `<row r="${k + 2}">` + SPALTEN.map((s, i) => zelle(i, k + 2, s.hol(z))).join('') + `</row>`)
    .join('')
  const spaltenBreiten =
    `<cols>` +
    SPALTEN.map((s, i) => `<col min="${i + 1}" max="${i + 1}" width="${s.breite}" customWidth="1"/>`).join('') +
    `</cols>`

  const blatt =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    spaltenBreiten +
    `<sheetData>${kopfZeile}${datenZeilen}</sheetData></worksheet>`

  return zipStore([
    {
      name: '[Content_Types].xml',
      inhalt:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      inhalt:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      inhalt:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${xmlEsc(titel).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      inhalt:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `</Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', inhalt: blatt },
  ])
}

/* ── PDF ─────────────────────────────────────────────────────────────── */

/**
 * WinAnsi statt UTF-8: die eingebauten PDF-Schriften koennen kein Unicode.
 * Die paar Zeichen, die hier vorkommen (Umlaute, Grad, das lange Minus),
 * werden abgebildet; alles Uebrige wird zu einem Fragezeichen, statt die
 * Datei unlesbar zu machen.
 */
function winAnsi(s: string): string {
  const karte: Record<string, string> = { '—': '-', '–': '-', '„': '"', '“': '"', '”': '"', '…': '...' }
  return Array.from(s)
    .map((c) => {
      if (karte[c]) return karte[c]
      const n = c.charCodeAt(0)
      return n < 256 ? c : '?'
    })
    .join('')
}

/** Fliesstext auf eine Zeilenlaenge umbrechen, an Leerzeichen. */
function umbrechen(text: string, breite: number): string[] {
  const raus: string[] = []
  let zeile = ''
  for (const wort of text.split(/\s+/)) {
    if ((zeile + ' ' + wort).trim().length > breite) {
      if (zeile) raus.push(zeile)
      zeile = wort
    } else {
      zeile = (zeile + ' ' + wort).trim()
    }
  }
  if (zeile) raus.push(zeile)
  return raus
}

const pdfEsc = (s: string) => winAnsi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

/**
 * Der Spannungsverlauf als Zeichnung im PDF.
 *
 * WOFUER: der Fehler ist ein VERLAUF — die Eingangsspannung bricht ein und
 * kommt wieder. In einer Zahlenkolonne sieht das niemand, in einer Kurve
 * sofort. Genau dafuer liegt der Bericht beim Haendler auf dem Tisch.
 *
 * PDF kann Linien von Haus aus (m/l/S), es braucht dafuer keine Bilddatei.
 */
function zeichneVerlauf(
  zeilen: ReadonlyArray<Zeile>,
  x0: number,
  y0: number,
  b: number,
  h: number,
): string[] {
  const t: string[] = []
  const werte = zeilen.filter((z) => Number.isFinite(Number(z.vbus)))
  if (werte.length < 2) return t

  const vs = werte.map((z) => Number(z.vbus))
  const is = werte.map((z) => Number(z.ibus ?? 0))
  const vMax = Math.max(5500, ...vs)
  const iMax = Math.max(500, ...is)
  const t0 = werte[0].t
  const spanne = Math.max(1, werte[werte.length - 1].t - t0)
  const px = (z: Zeile) => x0 + ((z.t - t0) / spanne) * b
  const pyV = (v: number) => y0 + (v / vMax) * h
  const pyI = (i: number) => y0 + (i / iMax) * h

  // Rahmen und waagerechte Hilfslinien bei 0/1/2/3/4/5 V.
  t.push('0.8 w', '0.6 0.6 0.6 RG', `${x0} ${y0} ${b} ${h} re`, 'S')
  t.push('0.3 w', '0.85 0.85 0.85 RG')
  for (let v = 1000; v < vMax; v += 1000) {
    const y = pyV(v)
    t.push(`${x0} ${y.toFixed(1)} m`, `${x0 + b} ${y.toFixed(1)} l`, 'S')
    t.push('BT', '/F1 6 Tf', `1 0 0 1 ${(x0 - 20).toFixed(1)} ${(y - 2).toFixed(1)} Tm`, `(${v / 1000} V) Tj`, 'ET')
  }

  // Die 4,3-V-Schwelle VINDPM einzeichnen: darunter nimmt der Regler von
  // selbst zurueck. Wer den Bericht liest, sieht sofort, ob der Einbruch
  // darunter ging.
  const yS = pyV(4300)
  t.push('0.9 0.5 0.1 RG', '0.7 w', '[3 2] 0 d')
  t.push(`${x0} ${yS.toFixed(1)} m`, `${x0 + b} ${yS.toFixed(1)} l`, 'S', '[] 0 d')
  t.push('BT', '/F1 6 Tf', `1 0 0 1 ${(x0 + b + 3).toFixed(1)} ${(yS - 2).toFixed(1)} Tm`, '(VINDPM 4,3 V) Tj', 'ET')

  // Eingangsstrom hinter der Spannung, damit die Spannung obenauf liegt.
  t.push('0.2 0.5 0.9 RG', '0.8 w')
  werte.forEach((z, k) => {
    t.push(`${px(z).toFixed(1)} ${pyI(Number(z.ibus ?? 0)).toFixed(1)} ${k ? 'l' : 'm'}`)
  })
  t.push('S')

  t.push('0.85 0.2 0.2 RG', '1.4 w')
  werte.forEach((z, k) => {
    t.push(`${px(z).toFixed(1)} ${pyV(Number(z.vbus)).toFixed(1)} ${k ? 'l' : 'm'}`)
  })
  t.push('S')

  t.push('0 0 0 RG', '0 0 0 rg')
  t.push(
    'BT',
    '/F1 6 Tf',
    `1 0 0 1 ${x0} ${(y0 - 9).toFixed(1)} Tm`,
    `(rot: Eingangsspannung VBUS  ·  blau: Eingangsstrom IBUS, Vollausschlag ${Math.round(iMax)} mA  ·  Dauer ${Math.round(spanne / 1000)} s) Tj`,
    'ET',
  )
  return t
}

export function alsPdf(
  zeilen: ReadonlyArray<Zeile>,
  titel = 'MuPiHAT-Protokoll',
  untertitel = '',
  bericht?: {
    kopfdaten?: ReadonlyArray<readonly [string, string]>
    befunde?: ReadonlyArray<{ was: string; wert: string; gewicht: string; bedeutung?: string }>
  },
): Uint8Array {
  // Querformat A4, damit fuenfzehn Spalten nebeneinander passen.
  const [breite, hoehe] = [842, 595]
  const rand = 24
  const zeilenHoehe = 11
  const proSeite = Math.floor((hoehe - rand * 2 - 40) / zeilenHoehe)

  // Spaltenpositionen aus den Breiten — dieselbe Reihenfolge wie ueberall.
  const gesamt = SPALTEN.reduce((s, c) => s + c.breite, 0)
  const nutz = breite - rand * 2
  let x = rand
  const xs = SPALTEN.map((c) => {
    const jetzt = x
    x += (c.breite / gesamt) * nutz
    return jetzt
  })

  const seiten: string[] = []

  // ── Erste Seite: Befunde und Kurve. Wer das Protokoll oeffnet, will
  // zuerst die Aussage sehen und dann die Rohwerte.
  if (bericht) {
    let y = hoehe - rand - 16
    const t: string[] = []
    t.push('BT', '/F2 15 Tf', `1 0 0 1 ${rand} ${y} Tm`, `(${pdfEsc(titel)}) Tj`, 'ET')
    y -= 14
    if (untertitel) {
      t.push('BT', '/F1 8 Tf', `1 0 0 1 ${rand} ${y} Tm`, `(${pdfEsc(untertitel)}) Tj`, 'ET')
      y -= 16
    }
    for (const [k, v] of bericht.kopfdaten ?? []) {
      t.push('BT', '/F2 8 Tf', `1 0 0 1 ${rand} ${y} Tm`, `(${pdfEsc(k)}) Tj`, 'ET')
      t.push('BT', '/F1 8 Tf', `1 0 0 1 ${rand + 130} ${y} Tm`, `(${pdfEsc(v)}) Tj`, 'ET')
      y -= 11
    }
    y -= 8
    t.push('BT', '/F2 10 Tf', `1 0 0 1 ${rand} ${y} Tm`, '(Befunde) Tj', 'ET')
    y -= 13
    for (const b of bericht.befunde ?? []) {
      const marke = b.gewicht === 'fehler' ? '[!]' : b.gewicht === 'warnung' ? '[?]' : '[ok]'
      t.push('BT', '/F2 8 Tf', `1 0 0 1 ${rand} ${y} Tm`, `(${pdfEsc(marke + ' ' + b.was)}) Tj`, 'ET')
      t.push('BT', '/F1 8 Tf', `1 0 0 1 ${rand + 160} ${y} Tm`, `(${pdfEsc(b.wert)}) Tj`, 'ET')
      y -= 10
      if (b.bedeutung) {
        // Umbrechen: eine Zeile Fliesstext passt bei 7 pt in rund 150 Zeichen.
        for (const stueck of umbrechen(b.bedeutung, 150)) {
          t.push('BT', '/F1 7 Tf', `1 0 0 1 ${rand + 12} ${y} Tm`, `(${pdfEsc(stueck)}) Tj`, 'ET')
          y -= 9
        }
      }
      y -= 3
    }
    y -= 10
    t.push('BT', '/F2 10 Tf', `1 0 0 1 ${rand} ${y} Tm`, '(Verlauf der Eingangsspannung) Tj', 'ET')
    const hoeheKurve = Math.max(80, y - rand - 40)
    t.push(...zeichneVerlauf(zeilen, rand + 26, rand + 24, breite - rand * 2 - 90, hoeheKurve))
    seiten.push(t.join('\n'))
  }

  for (let ab = 0; ab < Math.max(1, zeilen.length); ab += proSeite) {
    const teil = zeilen.slice(ab, ab + proSeite)
    let y = hoehe - rand - 14
    const t: string[] = ['BT', '/F2 12 Tf', `1 0 0 1 ${rand} ${y} Tm`, `(${pdfEsc(titel)}) Tj`, 'ET']
    if (untertitel) {
      y -= 13
      t.push('BT', '/F1 8 Tf', `1 0 0 1 ${rand} ${y} Tm`, `(${pdfEsc(untertitel)}) Tj`, 'ET')
    }
    y -= 16
    // Kopfzeile fett, darunter ein Strich — sonst verschwimmen die Spalten.
    t.push('BT', '/F2 7 Tf')
    SPALTEN.forEach((c, i) => {
      t.push(`1 0 0 1 ${xs[i].toFixed(1)} ${y} Tm`, `(${pdfEsc(c.kopf)}) Tj`)
    })
    t.push('ET')
    t.push('0.5 w', `${rand} ${y - 3} m`, `${breite - rand} ${y - 3} l`, 'S')
    y -= zeilenHoehe + 2
    t.push('BT', '/F1 7 Tf')
    for (const z of teil) {
      SPALTEN.forEach((c, i) => {
        t.push(`1 0 0 1 ${xs[i].toFixed(1)} ${y} Tm`, `(${pdfEsc(c.hol(z))}) Tj`)
      })
      y -= zeilenHoehe
    }
    t.push('ET')
    seiten.push(t.join('\n'))
  }

  // Objekte: 1 Katalog, 2 Seitenbaum, 3+4 Schriften, dann je Seite zwei.
  const objekte: string[] = []
  const seitenIds = seiten.map((_, i) => 5 + i * 2)
  objekte.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  objekte.push(
    `<< /Type /Pages /Count ${seiten.length} /Kids [${seitenIds.map((i) => `${i} 0 R`).join(' ')}] >>`,
  )
  objekte.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`)
  objekte.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`)
  seiten.forEach((inhalt, i) => {
    objekte.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${breite} ${hoehe}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
    )
    // /Length ist die Zahl der DATENBYTES; das Zeilenende davor und danach
    // zaehlt NICHT mit. Strenge Betrachter lehnen die Datei sonst ab.
    objekte.push(`<< /Length ${latin1(inhalt).length} >>\nstream\n${inhalt}\nendstream`)
  })

  let pdf = '%PDF-1.4\n'
  const orte: number[] = []
  objekte.forEach((o, i) => {
    orte.push(latin1(pdf).length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = latin1(pdf).length
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`
  for (const o of orte) pdf += `${String(o).padStart(10, '0')} 00000 n \n`
  pdf +=
    `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return latin1(pdf)
}

/* c8 ignore next 3 */
declare const module: { exports: unknown } | undefined
if (typeof module !== 'undefined')
  module.exports = { SPALTEN, alsJson, alsCsv, alsXlsx, alsPdf, zipStore, crc32, spaltenName }
