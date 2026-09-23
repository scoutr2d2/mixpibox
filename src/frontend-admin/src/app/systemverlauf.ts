/**
 * Last, Wärme und Speicher über die Zeit — die REINEN Regeln.
 *
 * WOFÜR: `GET /api/system/verlauf` liefert eine Reihe von Messpunkten
 * (systemverlauf.ts im Backend). Was daraus wird — wo eine Linie abreißt, was
 * unter dem Ablesestrich steht, wann statt eines Bildes ein Satz kommt —
 * entscheidet sich hier. Ohne DOM, ohne HttpClient, ohne Angular.
 *
 * ══ ES IST DIE ZWEITE FASSUNG DERSELBEN REGELN, UND DAS IST BEABSICHTIGT ══
 *
 * Die Box zeigt dieselbe Kurve in ihrem eigenen Eltern-Bereich
 * (`sysKurveBauen` in NewDesign/app.js). Der Auftrag lautete wörtlich „in
 * beiden admin bereichen", und die beiden Bauwerke können sich keinen Code
 * teilen: NewDesign ist ein `<script src>` ohne einen einzigen `import`, diese
 * Verwaltung ist ein Angular-Bündel. Ein gemeinsames Modul hieße, das eine
 * oder das andere umzubauen — für drei Kurven zu teuer.
 *
 * WAS STATTDESSEN GEGEN DAS AUSEINANDERLAUFEN STEHT: `tools/systemkurve-
 * gleich.py` misst nach, dass die ZAHLEN in beiden Fassungen übereinstimmen
 * (Skala der Wärmebahn, Drosselmarke, Reihenfolge und Feldnamen der Bahnen).
 * Dieselbe Vorkehrung wie bei `MIN_POSITION_S` in merkposition.ts, und aus
 * demselben Grund: eine Bitte im Kommentar hat schon einmal nicht gehalten.
 */

/** Ein Messpunkt, wie ihn `/api/system/verlauf` liefert. Kurze Namen — die
 *  Begründung steht am Original in backend-api/src/systemverlauf.ts. */
export interface Punkt {
  /** Zeitstempel in Millisekunden. */
  t: number
  /** CPU-Auslastung in Prozent über alle Kerne. */
  c: number
  /** Belegter Speicher in Prozent (aus MemAvailable, nicht MemFree). */
  m: number
  /** Temperatur in °C, oder null wenn kein Sensor antwortet. */
  g: number | null
  /** Lastmittel der letzten Minute in Hundertsteln (0,53 → 53). */
  l: number | null
}

/** Was der Weg als Ganzes liefert. */
export interface Verlauf {
  punkte: Punkt[]
  jetzt: Punkt | null
  stunden: number
  gesamt: number
  kerne: number
  speicherGesamt: number
  messAbstandMs: number
  lueckeMs: number
}

/** Ein Satz aus zwei Zeilen — Überschrift und Erklärung. */
export interface Satz {
  kopf: string
  unter: string
}

/* ══ DIE ZAHLEN, DIE MIT DER BOX ÜBEREINSTIMMEN MÜSSEN ═══════════════════
 * Geprüft von tools/systemkurve-gleich.py gegen NewDesign/app.js. */

/** Die beiden wählbaren Zeiträume. 24 Stunden beantworten „was war heute
 *  Nacht", sieben Tage „wie läuft die Box eigentlich". */
export const SPANNEN = [24, 168] as const

/** Wo die Wärmebahn anfängt und aufhört (°C).
 *
 *  FEST UND NICHT AUTOMATISCH: automatisch skaliert sähe eine Box zwischen 46
 *  und 49 Grad aus wie ein Fieberausschlag. Fest skaliert sieht sie aus, wie
 *  sie ist — ruhig, weit unter der Marke. */
export const GRAD_VON = 30
export const GRAD_BIS = 90

/** Ab hier bremst sich ein Pi 5 selbst. Steht als gestrichelte Linie im Bild
 *  und beantwortet „wird sie zu heiß?" ohne eine einzige Zahl. */
export const GRAD_MARKE = 80

/** Ab so vielen Punkten lohnt eine Kurve. Darunter steht ein Satz.
 *  DIESELBEN ZAHLEN WIE `AKKU_MIND_PUNKTE` / `AKKU_MIND_SPANNE_MS` in
 *  NewDesign/app.js — beide Kurven sollen an derselben Stelle aufgeben. */
export const MIND_PUNKTE = 3
/** Und so weit muss die Aufzeichnung mindestens zurückreichen (ms). */
export const MIND_SPANNE_MS = 900000

/** Die Bahnen, in der Reihenfolge von oben nach unten. */
export const BAHNEN = [
  { feld: 'c', name: 'CPU', art: 'prozent' },
  { feld: 'g', name: 'Wärme', art: 'grad' },
  { feld: 'm', name: 'Speicher', art: 'prozent' },
] as const

export type Bahn = (typeof BAHNEN)[number]

/** Zwei Buchstaben je Tag. Reihenfolge von `Date.getDay()`: 0 ist Sonntag. */
export const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/**
 * Eine Zahl aus einer fremden Antwort — und `null` wird NICHT zu 0.
 *
 * `Number(null)` ist NULL und nicht NaN. Ein Punkt ohne Temperatur ginge damit
 * als 0 °C in die Kurve, und 0 °C sieht aus wie eine eiskalte Box statt wie
 * ein fehlender Sensor. Derselbe Riegel wie `akkuZahl` in NewDesign/app.js.
 */
export function zahl(o: unknown, name: string): number {
  if (!o || typeof o !== 'object') return Number.NaN
  const w = (o as Record<string, unknown>)[name]
  if (w === null || w === undefined || w === '') return Number.NaN
  return Number(w)
}

/**
 * Die Reihe an ihren Lücken aufschneiden — je Bahn getrennt.
 *
 * ZWEI GRÜNDE ZU SCHNEIDEN, und beide sind nötig:
 *   ZEIT   mehr als `luecke` zwischen zwei Punkten — die Box war aus. Eine
 *          Linie, die darüber hinwegzeichnet, behauptet Messwerte.
 *   WERT   diese Bahn hat hier keine Zahl. Der häufige Fall ist die
 *          Temperatur: `g` ist null, wenn kein Sensor antwortet.
 *
 * @param feld  'c' | 'm' | 'g' — oder null: dann zählt nur die Zeit. So
 *              entstehen die Flächen „keine Messwerte", die für ALLE drei
 *              Bahnen gelten (die Box war nicht „für die CPU aus").
 */
export function stuecke(punkte: readonly Punkt[], luecke: number, feld: string | null): Punkt[][] {
  const raus: Punkt[][] = []
  let lauf: Punkt[] = []
  for (const p of Array.isArray(punkte) ? punkte : []) {
    const t = zahl(p, 't')
    const w = feld ? zahl(p, feld) : t
    if (!Number.isFinite(t) || !Number.isFinite(w)) {
      if (lauf.length) raus.push(lauf)
      lauf = []
      continue
    }
    if (lauf.length && t - Number(lauf[lauf.length - 1].t) > luecke) {
      raus.push(lauf)
      lauf = []
    }
    lauf.push(p)
  }
  if (lauf.length) raus.push(lauf)
  return raus
}

/** Wie viel Zeit die Stücke zusammen abdecken (ms). */
export function abdeckung(st: readonly Punkt[][]): number {
  let ms = 0
  for (const s of st) {
    if (!s.length) continue
    ms += Number(s[s.length - 1].t) - Number(s[0].t)
  }
  return ms
}

/**
 * Der Messpunkt unter dem Ablesestrich — und ob dort überhaupt gemessen wurde.
 *
 * GIBT EIN PAAR ZURÜCK und nicht den Punkt. Ein `{punkt: null}` ist ein
 * wahres Objekt; wer das Ergebnis direkt auf Wahrheit prüft, liest `undefined`
 * aus einem Wrapper und schreibt „NaN:NaN" auf den Schirm. Genau das ist am
 * 08.08.2026 im Griff der Akkukurve passiert.
 */
export function ablesePunkt(st: readonly Punkt[][], t: number): { punkt: Punkt | null; luecke: boolean } {
  for (const s of st) {
    if (!s.length) continue
    const a = Number(s[0].t)
    const e = Number(s[s.length - 1].t)
    if (!(t >= a && t <= e)) continue
    let best = s[0]
    for (const p of s) if (Math.abs(Number(p.t) - t) < Math.abs(Number(best.t) - t)) best = p
    return { punkt: best, luecke: false }
  }
  return { punkt: null, luecke: true }
}

const ACHS_STUFEN = [900000, 1800000, 3600000, 7200000, 10800000, 21600000, 43200000, 86400000, 172800000]
const ACHS_MARKEN = 7

/**
 * Die Marken der Zeitachse — vier bis sieben, nicht mehr.
 *
 * SIE BEGINNEN AN EINER LOKALEN MITTERNACHT und schreiten in ganzen Stufen
 * fort. In UTC gerechnet hieße „6 Stunden ab 00:00 UTC" im Sommer 02:00,
 * 08:00, 14:00 — Zahlen, die niemand als rund liest.
 */
export function achse(von: number, bis: number): { t: number; tag: boolean }[] {
  const a = Number(von)
  const e = Number(bis)
  if (!Number.isFinite(a) || !Number.isFinite(e) || e <= a) return []
  const spanne = e - a
  const schritt = ACHS_STUFEN.find((s) => spanne / s <= ACHS_MARKEN) || ACHS_STUFEN[ACHS_STUFEN.length - 1]
  const d = new Date(a)
  d.setHours(0, 0, 0, 0)
  const marken: { t: number; tag: boolean }[] = []
  for (let t = d.getTime(); t <= e; t += schritt) {
    if (t < a) continue
    marken.push({ t, tag: schritt >= 86400000 })
  }
  return marken
}

/** Eine Zahl mit einer Nachkommastelle, deutsch. Für Grad: 52,3 °C. */
export function komma(w: number): string {
  return (Math.round(Number(w) * 10) / 10).toFixed(1).replace('.', ',')
}

/**
 * Dasselbe mit ZWEI Stellen — nur für das Lastmittel.
 *
 * WARUM NICHT EINE, wie bei den Graden: eine Last von 0,04 würde zu „0,0" und
 * läse sich wie „nichts". Genau das ist der Unterschied zwischen einer Box im
 * Leerlauf und einer, die im Hintergrund etwas tut — und die zwei Stellen sind
 * ausserdem die Schreibweise, in der `uptime` das Lastmittel überall sonst
 * ausgibt. Herausgefallen beim ersten Lauf von systemverlauf.spec.ts.
 */
export function kommaZwei(w: number): string {
  return (Math.round(Number(w) * 100) / 100).toFixed(2).replace('.', ',')
}

/** Minuten in Worte — „3 h 20 min", „45 min", „2 h". */
export function minutenWort(minuten: number): string {
  const m = Math.round(Number(minuten))
  if (!Number.isFinite(m) || m < 0) return '—'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

/**
 * Das Lastmittel in Worten — mit der Kernzahl, ohne die es nichts sagt.
 *
 * „Last 3,8" ist auf einem Kern eine überlastete Box und auf acht Kernen
 * Leerlauf. Der Punkt trägt die rohe Zahl, die Kernzahl steht am Weg.
 */
export function lastWort(punkt: Punkt, kerne: number): string {
  const l = zahl(punkt, 'l')
  if (!Number.isFinite(l)) return ''
  const k = Number(kerne)
  return 'Last ' + kommaZwei(l / 100) + (Number.isFinite(k) && k > 0 ? ' von ' + k : '')
}

/**
 * WARUM DAS NICHT IMMER „die Box war aus" HEISSEN DARF.
 *
 * AM GERÄT AUFGEFALLEN (08.08.2026, tools/verwaltung-systemkurve-schau.mjs):
 * Die Aufzeichnung lief 44 Minuten, die Achse zeigt 24 Stunden — und für
 * 23:32 der Vornacht stand „Hier wurde nichts gemessen — die Box war aus."
 * Die Box lief zu der Zeit. Sie hat nur noch nichts mitgeschrieben, weil die
 * Reihe bei jedem Serverstart bei null anfängt.
 *
 * Das ist die teuerste Sorte falscher Auskunft: Sie klingt nach einer
 * Messung, ist aber geraten, und wer sie liest, sucht anschliessend nach
 * einem Stromausfall, den es nie gab.
 *
 * DREI LAGEN, DREI SÄTZE:
 *   VOR dem ersten Messwert   die Aufzeichnung reicht nicht so weit zurück
 *   NACH dem letzten          seitdem kam nichts mehr — DAS ist „aus"
 *   DAZWISCHEN                ein echtes Loch in einer laufenden Reihe
 *
 * Ohne `spanne` bleibt es beim alten Satz: ein Aufrufer, der die Grenzen
 * nicht kennt, soll nichts Genaueres behaupten, als er weiss.
 */
function lueckenSatz(t: number, spanne?: { von: number; bis: number }): string {
  if (!spanne || !Number.isFinite(spanne.von) || !Number.isFinite(spanne.bis)) {
    return 'Hier wurde nichts gemessen — die Box war aus.'
  }
  if (t < spanne.von) return 'So weit reicht die Aufzeichnung noch nicht zurück.'
  if (t > spanne.bis) return 'Seitdem wurde nichts mehr aufgezeichnet.'
  return 'Hier wurde nichts gemessen — die Box war aus.'
}

function uhr(ms: number, tage: boolean): string {
  const d = new Date(Number(ms))
  return (
    (tage ? WOCHENTAG[d.getDay()] + ' ' : '') +
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0')
  )
}

/**
 * Der Satz zu EINEM Messpunkt — was unter dem Ablesestrich steht.
 *
 * DIE UHRZEIT IST DIE DES PUNKTES und nicht die des Zeigers: gerastet wird auf
 * den Messwert, und dann gehört dessen Zeit dazu. Sonst stünde „19:41" über
 * Zahlen von 19:38.
 */
export function leseSatz(
  punkt: Punkt | null,
  luecke: boolean,
  t: number,
  tage: boolean,
  kerne: number,
  spanne?: { von: number; bis: number },
): Satz {
  if (luecke || !punkt) {
    return { kopf: uhr(t, tage) + ' · —', unter: lueckenSatz(t, spanne) }
  }
  const c = zahl(punkt, 'c')
  const m = zahl(punkt, 'm')
  const g = zahl(punkt, 'g')
  return {
    kopf: uhr(punkt.t, tage) + ' · ' + (Number.isFinite(c) ? 'CPU ' + Math.round(c) + ' %' : 'CPU —'),
    unter: [
      Number.isFinite(g) ? komma(g) + ' °C' : 'kein Wärmesensor',
      Number.isFinite(m) ? 'Speicher ' + Math.round(m) + ' %' : 'Speicher —',
      lastWort(punkt, kerne),
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

/**
 * Der Satz zum JETZT — was ohne Ablesestrich dasteht.
 *
 * ER NENNT ALLE DREI ZAHLEN: Anders als beim Akku („84 %") gibt es hier keinen
 * einen Wert, wegen dem jemand herkommt.
 */
export function jetztSatz(v: Verlauf | null): Satz {
  const j = v && typeof v === 'object' ? v.jetzt : null
  if (!j || typeof j !== 'object') return { kopf: '—', unter: 'Es liegt noch kein Messwert vor.' }
  const c = zahl(j, 'c')
  const m = zahl(j, 'm')
  const g = zahl(j, 'g')
  const kopf = [
    Number.isFinite(c) ? 'CPU ' + Math.round(c) + ' %' : null,
    Number.isFinite(g) ? komma(g) + ' °C' : null,
    Number.isFinite(m) ? 'Speicher ' + Math.round(m) + ' %' : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const gesamt = Number(v?.speicherGesamt)
  const mb =
    Number.isFinite(m) && Number.isFinite(gesamt) && gesamt > 0
      ? Math.round((m / 100) * (gesamt / 1048576)) + ' von ' + Math.round(gesamt / 1048576) + ' MB belegt'
      : ''
  return {
    kopf: kopf || '—',
    unter: [lastWort(j, v?.kerne ?? Number.NaN), mb].filter(Boolean).join(' · ') || 'Der letzte Messwert trägt keine Zahlen.',
  }
}

/**
 * Wurde es wärmer, als die Bahn zeigen kann?
 *
 * Die Kurve klemmt bei GRAD_BIS, und eine geklemmte Kurve sieht aus wie eine
 * gemessene. Ohne diesen Satz wären 81 und 110 Grad im Bild dasselbe.
 */
export function heissSatz(punkte: readonly Punkt[]): string | null {
  const werte = (Array.isArray(punkte) ? punkte : []).map((p) => zahl(p, 'g')).filter((w) => Number.isFinite(w))
  if (!werte.length) return null
  const max = Math.max(...werte)
  if (max <= GRAD_BIS) return null
  return `Der wärmste Messwert lag bei ${komma(max)} °C — die Bahn reicht nur bis ${GRAD_BIS} °C.`
}

/**
 * Zu wenig für eine Kurve? Dann der Satz statt des Bildes.
 *
 * DIE REIHE FÄNGT BEI JEDEM SERVERSTART BEI NULL AN — sie liegt im Speicher
 * und wird angehängt. Dieser Satz ist also der Normalfall nach einem Update
 * und keine Störung; er sagt das auch.
 */
export function duennSatz(punkte: readonly Punkt[], st: readonly Punkt[][]): string | null {
  const n = Array.isArray(punkte) ? punkte.length : 0
  if (n < MIND_PUNKTE) {
    return (
      'Zu wenig Messwerte für eine Kurve — bisher ' +
      (n === 0 ? 'keiner' : n === 1 ? 'einer' : n + ' Stück') +
      '. Die Box zeichnet jede Minute einen auf; nach einem Neustart fängt sie von vorn an.'
    )
  }
  const ms = abdeckung(st)
  if (ms < MIND_SPANNE_MS) {
    return `Die Aufzeichnung reicht erst ${minutenWort(Math.round(ms / 60000))} zurück — für eine Kurve zu kurz.`
  }
  return null
}
