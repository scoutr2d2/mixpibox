/**
 * MIXPI-KINDERNACHRICHTEN — Nachrichten und Wissens-Podcasts fuer Kinder als
 * Kacheln, und fuer die Nachrichten eine FRISCHE-REGEL.
 *
 * ══ WARUM NICHT EINFACH EIN PODCAST-EINTRAG ════════════════════════════════
 * Ein Podcast-Eintrag spielt, was im Feed steht. Bei einem Wissens-Podcast ist
 * das richtig: eine Folge ueber Fledermaeuse ist in drei Wochen noch genauso
 * wahr. Bei Nachrichten nicht. Eine MausNachrichten-Folge von vor drei Wochen
 * erzaehlt einem Kind von einem Hochwasser, das laengst vorbei ist, als waere
 * es heute — das ist schlimmer als keine Nachricht. Deshalb fuehrt eine
 * Nachrichtenquelle hier NUR Folgen, die hoechstens `frischeTage` Kalendertage
 * alt sind, und steht sonst LEER da. Leer ist ein Ergebnis, kein Fehler (E78).
 *
 * ══ DIE QUELLEN ════════════════════════════════════════════════════════════
 * Eine feste Tabelle, am 28.09.2026 alle vier live geprueft. Gefragt wird NIE
 * eine Adresse aus einer Anfrage: ein Schluessel, der nicht in der Tabelle
 * steht, ist ein Fehler — keine Feed-Adresse, der man mal nachgeht.
 *
 * ══ WAS DIE FEEDS AM 28.09.2026 TATEN (Zeugen in *.fixture.xml) ═════════════
 *   logo!    Titel nur „Montag, 28. September " — ohne Sendungsnamen, mit
 *            Leerzeichen am Ende. Dauer in Sekunden, Kanalbild ueber http,
 *            kein Bild an der Folge. Die Freitagsfolge vom 25.09. fehlte.
 *   Maus     200 Folgen bis Dezember 2025 zurueck, Dauer hh:mm:ss, pubDate
 *            in GMT. Titel meist „MausNachrichten vom …", einmal klein
 *            geschrieben; aeltere Folgen tragen nur ihr Thema.
 *   Kakadu   Dauer mm:ss. Das Kanaldatum steht auf dem 09.03.2026, obwohl die
 *            neueste Folge vom 25.09. ist — Frische kommt deshalb NUR aus dem
 *            pubDate der Folge, nie aus dem Kanal.
 *   GEOlino  1,2 MB auf wenigen Zeilen, `&amp;` IN JEDER TONADRESSE. Der Leser
 *            im Musterplugin mupibox-podcast dekodiert Attribute nicht und
 *            haette die Adresse verfaelscht — und der Werbedienst dahinter
 *            antwortet auch auf die verfaelschte mit 200 audio/mpeg, man
 *            haette es also nicht einmal gehoert. Werbung in jeder
 *            Beschreibung; das steht deshalb im Hinweis der Quelle.
 *
 * ══ KEINE ABHAENGIGKEITEN ══════════════════════════════════════════════════
 * Der RSS-Leser unten ist von Hand geschrieben, wie im Musterplugin. Er ist
 * KEIN XML-Leser, reicht aber fuer diese vier Feeds; seine Grenzen stehen an
 * ihm dran.
 */

const KENNUNG = 'mixpi-kindernachrichten'

/**
 * DIE TABELLE. `bild` ist das am 28.09.2026 gemessene Kanalbild und nur der
 * Rueckfall, wenn der Feed gerade nicht antwortet — sonst gilt das Bild aus
 * dem Feed. Die Reihenfolge der Nachrichtenquellen ist die von „heute".
 */
export const QUELLEN = Object.freeze(
  [
    {
      schluessel: 'maus',
      name: 'MausNachrichten',
      sender: 'WDR',
      feed: 'https://kinder.wdr.de/radio/diemaus/audio/maus-zoom/maus-zoom-106.podcast',
      art: 'nachrichten',
      hinweis:
        'Nachrichten fuer Kinder, werktags, etwa 5 Minuten. Hiess frueher „KiRaKa Klicker", dann „MausZoom". Nur Folgen der letzten Tage.',
      bild: 'https://www1.wdr.de/mediathek/audio/sendereihen-bilder/maus-nachrichten-neu-100~_v-Podcast.jpg',
      stichworte: 'maus wdr kiraka klicker mauszoom',
    },
    {
      schluessel: 'logo',
      name: 'logo!',
      sender: 'ZDF',
      feed: 'https://www.zdf.de/rss/podcast/audio/zdf/kinder/logo',
      art: 'nachrichten',
      hinweis: 'Nachrichten fuer Kinder, taeglich, etwa 10 Minuten. Nur Folgen der letzten Tage.',
      bild: 'https://module.zdf.de/podcasts/logo_podcast_1400.jpg',
      stichworte: 'logo zdf',
    },
    {
      schluessel: 'kakadu',
      name: 'Kakadu',
      sender: 'Deutschlandfunk Kultur',
      feed: 'https://www.kakadu.de/kakadu-104.xml',
      art: 'wissen',
      hinweis: 'Kinderfragen und Antworten, etwa dreimal pro Woche, 10 bis 30 Minuten.',
      bild: 'https://bilder.deutschlandfunk.de/FI/LE/_8/69/FILE_869f7ed9b25625bceb9bfe2d15fe6f96/kakadu-podcast-100-1920x1920.jpg',
      stichworte: 'kakadu deutschlandfunk deutschlandradio dlf kinderfragen fragen',
    },
    {
      schluessel: 'geolino',
      name: 'GEOlino Spezial',
      sender: 'GEOlino',
      feed: 'https://cdn.audiorella.com/podcasts/1688-geolino-spezial-der-wissenspodcast-fur-junge-entdeckerinnen-und-entdecker/feed.rss',
      art: 'wissen',
      hinweis:
        'Wissenspodcast, etwa monatlich, rund 20 Minuten. ENTHAELT WERBUNG: Rabattcodes in der Beschreibung, und der Anbieter fuegt Werbung in den Ton ein.',
      bild: 'https://cdn.audiorella.com/podcasts/1688-geolino-spezial-der-wissenspodcast-fur-junge-entdeckerinnen-und-entdecker/1688_cover.jpg?v=2',
      stichworte: 'geolino geo spezial werbung',
    },
  ].map((q) => Object.freeze(q)),
)

/** Die virtuelle Quelle: von jeder Nachrichtenquelle die neueste frische Folge. */
const HEUTE = Object.freeze({
  schluessel: 'heute',
  name: 'Nachrichten von heute',
  sender: 'WDR und ZDF',
  art: 'heute',
  hinweis:
    'Von MausNachrichten und logo! je die neueste frische Folge, in dieser Reihenfolge. Leer, wenn gerade keine frisch ist.',
  stichworte: 'heute aktuell',
})

/** Montags ist die letzte Maus vom Freitag — mit 3 Tagen ist sie noch da. */
const FRISCHE_VORGABE = 3
/** Eine Nachrichtenkachel ist ein Rueckblick auf wenige Tage, keine Chronik. */
const NACHRICHTEN_DECKEL = 7
/** Wie FOLGEN_DECKEL im Kern: darueber weist er die GANZE Antwort ab. */
const FOLGEN_DECKEL = 500
/**
 * EIGENE FRIST UNTER DER DES WIRTS. Der Wirt gibt jedem Ruf 8 s und beendet
 * danach den ganzen Worker; `kontext.holen` bricht ebenfalls erst nach 8 s ab.
 * Wer selbst bei 6 s aufgibt, antwortet noch mit einem Satz, statt mitsamt
 * allen offenen Rufen abgeschossen zu werden.
 */
const FRIST_MS = 6000
const MERKDAUER_MS = 15 * 60_000
const TAG_MS = 86_400_000

// ── Uhr und Zwischenspeicher ────────────────────────────────────────────────

let uhr = () => Date.now()

/**
 * TESTNAHT: die Uhr stellen, gegen die Frische und Merkdauer gerechnet
 * werden — ohne sie liesse sich die Frische-Regel nur an einem echten Montag
 * pruefen. `null` stellt auf die echte Zeit zurueck. Im Betrieb ruft das
 * niemand.
 */
export function uhrStellen(fn) {
  uhr = typeof fn === 'function' ? fn : () => Date.now()
}

/** Geparste Feeds, 15 Minuten im Worker — er lebt, bis das Plugin neu startet. */
const speicher = new Map()
/** Laufende Abrufe: zwei gleichzeitige Rufe teilen sich EINEN Abruf. */
const unterwegs = new Map()

/** TESTNAHT: den Zwischenspeicher leeren. Im Betrieb ruft das niemand. */
export function zwischenspeicherLeeren() {
  speicher.clear()
  unterwegs.clear()
}

// ── Der RSS-Leser ──────────────────────────────────────────────────────────

const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/**
 * Entitaeten in EINEM Durchgang aufloesen. Zwei Durchgaenge (erst `&lt;`,
 * dann `&amp;`) machten aus „&amp;lt;" ein „<" statt eines „&lt;".
 * Zahlentitaeten (logo! schreibt „erkl&#228;rt") gehoeren dazu; eine, die
 * kein gueltiges Zeichen ergibt, bleibt stehen, wie sie ist.
 */
function entschluesseln(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (ganz, e) => {
    const k = e.toLowerCase()
    if (!k.startsWith('#')) return ENTITAETEN[k]
    const n = k.startsWith('#x') ? Number.parseInt(k.slice(2), 16) : Number(k.slice(1))
    const gueltig = n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff)
    return gueltig ? String.fromCodePoint(n) : ganz
  })
}

/** Inhalt eines Feldes als Text: CDATA woertlich, der Rest entschluesselt. */
function textAus(roh) {
  return String(roh)
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((teil) => (teil.startsWith('<![CDATA[') ? teil.slice(9, -3) : entschluesseln(teil)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Der rohe Inhalt des ersten Elements `name` in `stueck`.
 *
 * SELBSTSCHLIESSENDE ELEMENTE ZAEHLEN NICHT: GEOlino schreibt
 * `<itunes:author/>`. Ein Muster, das das als oeffnendes Element nimmt, liest
 * bis zum naechsten schliessenden — und das steht dann in einer anderen Folge.
 */
function innen(stueck, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*?)?(?<!/)>([\\s\\S]*?)</${name}\\s*>`, 'i').exec(stueck)
  return m ? m[1] : ''
}

function feld(stueck, name) {
  return textAus(innen(stueck, name))
}

/** Das erste oeffnende Element `name` als Zeichenkette, zum Lesen der Attribute. */
function elementAus(stueck, name) {
  return new RegExp(`<${name}\\b[^>]*>`, 'i').exec(stueck)?.[0] ?? ''
}

/**
 * Ein Attribut — ENTSCHLUESSELT. Genau hier liegt der GEOlino-Fall: im Feed
 * steht `…mp3?v=2&amp;awCollectionId=…`, gemeint ist `&`.
 */
function attribut(element, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(element)
  return m ? entschluesseln(m[1] ?? m[2] ?? '').trim() : ''
}

/** „632" (logo!), „26:18" (Kakadu), „00:05:29" (Maus, GEOlino) → Sekunden. */
function dauerAus(text) {
  const t = String(text ?? '').trim()
  let sek
  if (/^\d+$/.test(t)) sek = Number(t)
  else if (/^\d+(?::\d{1,2}){1,2}$/.test(t)) sek = t.split(':').reduce((summe, teil) => summe * 60 + Number(teil), 0)
  return sek > 0 ? sek : undefined
}

/**
 * Bildadressen immer ueber https. Der einzige http-Fall ist das Kanalbild von
 * logo! (`http://module.zdf.de/…`); gemessen am 28.09.2026 leitet der Server
 * mit 301 auf https um und liefert dort dieselben 732105 Bytes. Ein http-Bild
 * waere in einer https-Seite gemischter Inhalt und fiele still weg.
 */
function bildAdresse(adresse) {
  const a = String(adresse ?? '').trim()
  if (/^https:\/\//i.test(a)) return a
  if (/^http:\/\//i.test(a)) return `https://${a.slice(7)}`
  return undefined
}

/** Ein Feed → Kanalbild und Folgen. Nur Folgen MIT Ton zaehlen. */
function feedLesen(xml, quelle) {
  const text = String(xml ?? '')
  // Kommentare zuerst weg: Kakadu setzt ESI-Kommentare in den Kanal.
  const sauber = text.replace(/<!--[\s\S]*?-->/g, '')
  if (!/<(?:rss|channel)\b/i.test(sauber)) throw new Error(`${quelle.name} liefert keinen RSS-Feed`)
  const erstes = sauber.search(/<item\b/i)
  const kanal = erstes >= 0 ? sauber.slice(0, erstes) : sauber
  const kanalBild = bildAdresse(
    attribut(elementAus(kanal, 'itunes:image'), 'href') || feld(innen(kanal, 'image'), 'url'),
  )

  const folgen = []
  const gesehen = new Set()
  for (const item of sauber.match(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi) ?? []) {
    const anhang = elementAus(item, 'enclosure')
    const adresse = attribut(anhang, 'url')
    const typ = attribut(anhang, 'type')
    // OHNE TON KEINE FOLGE. Ein Anhang, der ein Video oder ein PDF ist, auch nicht.
    if (!/^https?:\/\//i.test(adresse)) continue
    if (typ && !/^audio\//i.test(typ)) continue
    /* DIE KENNUNG IST PFLICHT: `inhaltPruefen` im Kern uebergeht eine Folge
     * ohne Kennung STILL (llmwiki plugin-kette-reisst-an-sechs-stellen). Die
     * guid ist dafuer gemacht und bleibt stabil, wenn der Anbieter die
     * Tonadresse umzieht; fehlt sie, bleibt nur die Adresse. */
    const kennung = feld(item, 'guid') || adresse
    if (gesehen.has(kennung)) continue
    gesehen.add(kennung)
    folgen.push({
      kennung,
      name: feld(item, 'title') || feld(item, 'itunes:title') || 'Folge ohne Titel',
      adresse,
      // Kakadu: fuenf von 55 Folgen ohne eigenes Bild; logo!: keine einzige.
      bild: bildAdresse(attribut(elementAus(item, 'itunes:image'), 'href')) || kanalBild,
      dauerSek: dauerAus(feld(item, 'itunes:duration')),
      zeit: Date.parse(feld(item, 'pubDate')),
      herkunft: quelle,
    })
  }
  return { kanalBild, folgen }
}

// ── Holen ──────────────────────────────────────────────────────────────────

/** Der Grund eines gescheiterten `allSettled`-Eintrags — er nennt die Quelle schon selbst. */
function grundVon(ergebnis) {
  return String(ergebnis.reason?.message ?? ergebnis.reason)
}

function mitFrist(versprechen, ms, wer) {
  let wecker
  const frist = new Promise((_, nein) => {
    wecker = setTimeout(() => nein(new Error(`${wer} antwortet nicht innerhalb von ${ms / 1000} s`)), ms)
  })
  return Promise.race([versprechen, frist]).finally(() => clearTimeout(wecker))
}

/**
 * JEDER FEHLER AUS DIESEM WEG NENNT SEINE QUELLE. `fetch failed` allein sagt
 * bei vier Feeds nicht, welcher es war — und die Aufrufer setzen den Namen
 * deshalb NICHT noch einmal davor.
 */
async function feedLaden(quelle, kontext) {
  const start = Date.now()
  let antwort
  try {
    antwort = await kontext.holen(quelle.feed, {
      headers: { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5' },
    })
  } catch (f) {
    throw new Error(`${quelle.name} nicht erreichbar: ${f?.message ?? f}`)
  }
  if (!antwort.ok) throw new Error(`${quelle.name} antwortete mit HTTP ${antwort.status}`)
  const xml = await antwort.text()
  const ms = Date.now() - start
  return { ...feedLesen(xml, quelle), ms, bytes: Buffer.byteLength(xml) }
}

/**
 * Einen Feed holen — aus dem Speicher, wenn er juenger als 15 Minuten ist.
 * `neu: true` fragt trotzdem (befinden und die Aktion messen die Quelle, nicht
 * den Speicher) und legt das Ergebnis danach ab.
 */
function feedHolen(quelle, kontext, { neu = false } = {}) {
  if (!neu) {
    const da = speicher.get(quelle.schluessel)
    if (da && uhr() < da.bis) return Promise.resolve(da.feed)
    const laeuft = unterwegs.get(quelle.schluessel)
    if (laeuft) return laeuft
  }
  if (!kontext.holen) return Promise.reject(new Error('Dem Plugin fehlt das Recht `netz`.'))
  const versprechen = mitFrist(feedLaden(quelle, kontext), FRIST_MS, quelle.name)
    .then((feed) => {
      speicher.set(quelle.schluessel, { feed, bis: uhr() + MERKDAUER_MS })
      return feed
    })
    .finally(() => {
      if (unterwegs.get(quelle.schluessel) === versprechen) unterwegs.delete(quelle.schluessel)
    })
  unterwegs.set(quelle.schluessel, versprechen)
  return versprechen
}

// ── Die Frische-Regel ──────────────────────────────────────────────────────

let tagFormat
function berlinerTag(ms) {
  if (!tagFormat) {
    const art = { year: 'numeric', month: '2-digit', day: '2-digit' }
    try {
      tagFormat = new Intl.DateTimeFormat('en-US', { ...art, timeZone: 'Europe/Berlin' })
    } catch {
      // Ein Node ohne Zeitzonendaten: lieber einen Tag nach UTC als gar keinen.
      tagFormat = new Intl.DateTimeFormat('en-US', { ...art, timeZone: 'UTC' })
    }
  }
  const t = Object.fromEntries(tagFormat.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return { jahr: Number(t.year), monat: Number(t.month), tag: Number(t.day) }
}

function tagNummer(ms) {
  const { jahr, monat, tag } = berlinerTag(ms)
  return Math.round(Date.UTC(jahr, monat - 1, tag) / TAG_MS)
}

/**
 * FRISCH HEISST: hoechstens `tage` KALENDERTAGE alt, gezaehlt in Berlin.
 *
 * WARUM KALENDERTAGE UND NICHT STUNDEN: die Maus vom Freitag kam am 25.09. um
 * 09:00 Uhr. Mit „72 Stunden" waere sie am Montag ab 09:00 Uhr weg — auch an
 * einem Montag, an dem die neue noch nicht da ist. Mit Kalendertagen gilt sie
 * den ganzen Montag und keinen Dienstag, und genau das meint „montags ist die
 * letzte Maus vom Freitag".
 *
 * WARUM BERLIN: um 00:30 Uhr am Dienstag ist in UTC noch Montag. Ein Kind,
 * das kurz nach Mitternacht hoert, hoert in Berlin.
 *
 * Eine Folge AUS DER ZUKUNFT gilt als frisch: der Pi hat ohne Netz keine
 * verlaessliche Uhr, und bis zum Zeitabgleich laege sonst alles „in der
 * Zukunft" und die Kachel leer.
 */
function istFrisch(zeit, jetzt, tage) {
  return Number.isFinite(zeit) && tagNummer(jetzt) - tagNummer(zeit) <= tage
}

/**
 * EINE NACHRICHTENFOLGE, KEIN TRAILER. Im Maus-Feed stand am 31.08.2026
 * „Trailer - Die Maus am Morgen" (1:18) zwischen den Nachrichten. Frisch waere
 * er die NEUESTE Folge gewesen — und „heute" haette dem Kind statt der
 * Nachrichten eine Vorschau gespielt. Deshalb fliegt bei den Nachrichten
 * heraus, was sich Trailer oder Vorschau nennt oder kuerzer als 90 s ist
 * (die kuerzeste Maus hat knapp 5, logo! rund 10 Minuten). Eine Folge ohne
 * Dauer bleibt: fehlende Angaben sind kein Beleg.
 */
const KURZ_SEK = 90
function istNachricht(f) {
  if (/\b(trailer|vorschau|teaser)\b/i.test(f.name)) return false
  return !(Number.isFinite(f.dauerSek) && f.dauerSek < KURZ_SEK)
}

function frischeTageVon(kontext) {
  const roh = kontext?.einstellungen?.frischeTage
  // Ein geleertes Feld heisst „Vorgabe", nicht „0 Tage" — Number('') ist 0.
  if (roh === null || roh === undefined || String(roh).trim() === '') return FRISCHE_VORGABE
  const n = Number(roh)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : FRISCHE_VORGABE
}

function grenzeText(tage) {
  if (tage === 0) return 'nicht von heute'
  return `aelter als ${tage} ${tage === 1 ? 'Tag' : 'Tage'}`
}

function datumText(ms, mitJahr = true) {
  if (!Number.isFinite(ms)) return 'unbekanntem Datum'
  const { jahr, monat, tag } = berlinerTag(ms)
  const zwei = (n) => String(n).padStart(2, '0')
  return `${zwei(tag)}.${zwei(monat)}.${mitJahr ? jahr : ''}`
}

/** Neueste zuerst; eine Folge ohne lesbares Datum ans Ende, in Feed-Reihenfolge. */
function neuesteZuerst(folgen) {
  const schluessel = (f) => (Number.isFinite(f.zeit) ? f.zeit : Number.NEGATIVE_INFINITY)
  return [...folgen].sort((a, b) => {
    const za = schluessel(a)
    const zb = schluessel(b)
    return za === zb ? 0 : zb > za ? 1 : -1
  })
}

/** „logo! – Montag, 28. September" — die Quelle davor, wenn der Titel sie nicht schon nennt. */
function mitQuelle(quelle, name) {
  // Klein verglichen: die Maus schrieb sich am 15.09. „Mausnachrichten".
  return name.toLowerCase().includes(quelle.name.toLowerCase()) ? name : `${quelle.name} – ${name}`
}

// ── Die Liste einer Kachel ─────────────────────────────────────────────────

function restZerlegen(rest) {
  const [kopf, ...schwanz] = String(rest ?? '').split('#')
  let wunsch = 'neueste'
  let nr = 0
  for (const t of schwanz.map((s) => s.trim().toLowerCase())) {
    if (t === 'aelteste' || t === 'neueste') wunsch = t
    else if (/^\d+$/.test(t)) nr = Number(t)
  }
  return { schluessel: kopf.trim().toLowerCase(), wunsch, nr }
}

function eintragVon(schluessel) {
  if (schluessel === HEUTE.schluessel) return HEUTE
  const q = QUELLEN.find((x) => x.schluessel === schluessel)
  if (q) return q
  const bekannt = [HEUTE, ...QUELLEN].map((x) => x.schluessel).join(', ')
  throw new Error(`Unbekannte Quelle "${schluessel}" — bekannt sind: ${bekannt}.`)
}

/**
 * DIE EINE STELLE, an der die Liste einer Kachel entsteht. `inhalt()`,
 * `aufloesen()` und die Uebersicht fragen alle hier — zwei Wege liefen an dem
 * Tag auseinander, an dem die Frische-Regel sich aendert, und dann spielte
 * `#2` eine andere Folge, als die Liste zeigt.
 *
 * Zurueck kommen die Folgen in der inneren Form (mit Zeit und Herkunft) und
 * je beteiligter Quelle ein Stand, aus dem sich eine leere Liste ERKLAEREN
 * laesst.
 */
async function listeFuer(schluessel, wunsch, kontext) {
  const eintrag = eintragVon(schluessel)
  const jetzt = uhr()
  const tage = frischeTageVon(kontext)

  if (eintrag === HEUTE) {
    const quellen = QUELLEN.filter((q) => q.art === 'nachrichten')
    // PARALLEL: nacheinander kosteten zwei langsame Feeds zusammen die Frist.
    const ergebnisse = await Promise.allSettled(quellen.map((q) => feedHolen(q, kontext)))
    if (ergebnisse.every((e) => e.status === 'rejected')) {
      throw new Error(`Keine Nachrichtenquelle erreichbar — ${ergebnisse.map(grundVon).join('; ')}`)
    }
    const folgen = []
    const stand = []
    ergebnisse.forEach((e, i) => {
      const q = quellen[i]
      if (e.status === 'rejected') {
        // EINE Quelle weg ist eine kuerzere Liste, kein Fehler — das Kind
        // bekommt die andere, und der Grund geht ins Journal.
        kontext.protokoll?.(`heute ohne ${q.name}: ${grundVon(e)}`)
        stand.push({ quelle: q, fehler: grundVon(e) })
        return
      }
      const geordnet = neuesteZuerst(e.value.folgen.filter(istNachricht))
      const frisch = geordnet.filter((f) => istFrisch(f.zeit, jetzt, tage))
      stand.push({ quelle: q, imFeed: geordnet.length, frisch: frisch.length, neueste: geordnet[0] ?? null })
      if (frisch[0]) {
        // Die Kennung traegt die Quelle davor: zwei Anbieter garantieren
        // einander keine verschiedenen guids, und eine doppelte Kennung
        // wirft der Kern als zweite hinaus.
        folgen.push({
          ...frisch[0],
          kennung: `${q.schluessel}:${frisch[0].kennung}`,
          name: mitQuelle(q, frisch[0].name),
        })
      }
    })
    // `wunsch` gilt hier nicht: die Reihenfolge ist die der Quellen, erst die Maus, dann logo!.
    return { eintrag, folgen, vollstaendig: stand.every((s) => !s.fehler), stand, tage }
  }

  const feed = await feedHolen(eintrag, kontext)
  const geordnet = neuesteZuerst(eintrag.art === 'nachrichten' ? feed.folgen.filter(istNachricht) : feed.folgen)
  if (eintrag.art === 'nachrichten') {
    const frisch = geordnet.filter((f) => istFrisch(f.zeit, jetzt, tage))
    const folgen = frisch.slice(0, NACHRICHTEN_DECKEL)
    if (wunsch === 'aelteste') folgen.reverse()
    const stand = [{ quelle: eintrag, imFeed: geordnet.length, frisch: frisch.length, neueste: geordnet[0] ?? null }]
    return { eintrag, folgen, vollstaendig: frisch.length <= NACHRICHTEN_DECKEL, stand, tage }
  }

  // WISSEN: alles, was Ton hat — nur gedeckelt, weil der Kern sonst die GANZE
  // Antwort abweist.
  const reihe = wunsch === 'aelteste' ? [...geordnet].reverse() : geordnet
  const stand = [{ quelle: eintrag, imFeed: geordnet.length, neueste: geordnet[0] ?? null }]
  return { eintrag, folgen: reihe.slice(0, FOLGEN_DECKEL), vollstaendig: geordnet.length <= FOLGEN_DECKEL, stand, tage }
}

/** Warum eine Liste leer ist — in einem Satz fuer Eltern. */
function leerGrund(liste) {
  const grenze = grenzeText(liste.tage)
  if (liste.eintrag === HEUTE) {
    const teile = liste.stand.map((s) => {
      if (s.fehler) return `${s.quelle.name} nicht erreichbar`
      if (!s.neueste) return `${s.quelle.name} ohne Folge`
      return `${s.quelle.name} zuletzt am ${datumText(s.neueste.zeit)}`
    })
    const regel = liste.tage === 0 ? 'nur Folgen von heute zaehlen' : `${grenze} zaehlt nicht`
    return `Keine aktuelle Nachricht — ${teile.join(', ')}; ${regel}.`
  }
  const s = liste.stand[0]
  if (!s?.neueste) return `Keine Folge von ${liste.eintrag.name} — der Feed fuehrt gerade keine mit Ton.`
  return `Keine aktuelle Folge von ${liste.eintrag.name} — die neueste ist vom ${datumText(s.neueste.zeit)}, ${grenze}.`
}

/** Die Form, die der Kern annimmt — Zeit und Herkunft bleiben im Plugin. */
function folgeFuerKern(f) {
  const folge = { kennung: f.kennung, name: f.name, quelle: { art: 'strom', adresse: f.adresse } }
  if (f.bild) folge.bild = f.bild
  if (f.dauerSek) folge.dauerSek = f.dauerSek
  return folge
}

// ── Das Angebot fuer die Verwaltung ────────────────────────────────────────

function normalform(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Passt ein Eintrag zu ALLEN Woertern des Begriffs? */
function passt(eintrag, begriff) {
  const woerter = normalform(begriff).split(' ').filter(Boolean)
  if (woerter.length === 0) return true
  const art = eintrag.art === 'wissen' ? 'wissen' : 'nachrichten'
  const heuhaufen = normalform(
    [eintrag.schluessel, eintrag.name, eintrag.sender, eintrag.hinweis, eintrag.stichworte, art].join(' '),
  )
  return woerter.every((w) => heuhaufen.includes(w))
}

/**
 * Der data.json-Eintrag — die EINE Stelle dieser Form. `type: 'plugin'` und in
 * `id` die VOLLE Medienkennung: nur so erkennt `dienstVon()` den generischen
 * Plugin-Weg (E87); jeder andere `type` wird `anderes`, und die Kachel spielt
 * nicht.
 */
function vorschlagAus(eintrag, bild) {
  return {
    type: 'plugin',
    category: 'other',
    id: `${KENNUNG}:${eintrag.schluessel}`,
    title: eintrag.name,
    artist: eintrag.sender,
    cover: bild,
  }
}

/**
 * Die Eintraege der Verwaltung, `heute` zuerst. Das Bild ist das Kanalbild
 * aus dem Feed (fuer `heute` das der Maus); antwortet ein Feed nicht, das
 * gemessene aus der Tabelle — ein Netzschluckauf soll das Angebot nicht
 * leeren.
 */
async function werkeBauen(eintraege, kontext) {
  const maus = QUELLEN[0]
  const quelleFuerBild = (e) => (e === HEUTE ? maus : e)
  const noetig = [...new Set(eintraege.map(quelleFuerBild))]
  const bilder = new Map()
  if (kontext.holen && noetig.length > 0) {
    const ergebnisse = await Promise.allSettled(noetig.map((q) => feedHolen(q, kontext)))
    ergebnisse.forEach((e, i) => {
      if (e.status === 'fulfilled' && e.value.kanalBild) bilder.set(noetig[i].schluessel, e.value.kanalBild)
    })
  }
  return eintraege.map((e) => {
    const q = quelleFuerBild(e)
    const bild = bilder.get(q.schluessel) ?? q.bild
    return {
      kennung: `${KENNUNG}:${e.schluessel}`,
      titel: e.name,
      urheber: e.sender,
      art: e.art,
      hinweis: e.hinweis,
      bild,
      vorschlag: vorschlagAus(e, bild),
    }
  })
}

function isoOderNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export default {
  /**
   * Eine Kachel zu ihrer Folgenliste (E78). rest: `<schluessel>`, wahlweise
   * mit `#neueste` / `#aelteste`.
   */
  async inhalt(rest, kontext) {
    const { schluessel, wunsch } = restZerlegen(rest)
    const liste = await listeFuer(schluessel, wunsch, kontext)
    return {
      titel: liste.eintrag.name,
      kuenstler: liste.eintrag.sender,
      // LEER IST EIN ERGEBNIS: keine frische Nachricht heisst, das Kind hoert
      // heute keine alte. Das ist die Regel, kein Fehler dieses Plugins.
      folgen: liste.folgen.map(folgeFuerKern),
      vollstaendig: liste.vollstaendig,
    }
  },

  /**
   * EINE Folge. rest: `<schluessel>` (die erste der Liste) oder
   * `<schluessel>#<n>` (die n-te, 0-basiert, wie die Liste zaehlt).
   */
  async aufloesen(rest, kontext) {
    const { schluessel, wunsch, nr } = restZerlegen(rest)
    const liste = await listeFuer(schluessel, wunsch, kontext)
    const f = liste.folgen[nr]
    if (!f) {
      if (liste.folgen.length === 0) throw new Error(leerGrund(liste))
      const art = liste.eintrag.art === 'wissen' ? 'Folgen' : 'aktuelle Folgen'
      throw new Error(`Folge ${nr} gibt es nicht — ${liste.eintrag.name} hat gerade ${liste.folgen.length} ${art}.`)
    }
    return {
      titel: { name: f.name, kuenstler: f.herkunft.name, bild: f.bild, dauerSek: f.dauerSek },
      quelle: { art: 'strom', adresse: f.adresse },
    }
  },

  /** Passende Quellen — ohne Netz, die Tabelle ist das ganze Angebot. */
  async suchen(begriff) {
    if (!normalform(begriff)) return []
    return [HEUTE, ...QUELLEN].filter((e) => passt(e, begriff)).map((e) => ({ name: e.name, kuenstler: e.sender }))
  },

  /** Ein Satz fuer die Karte: alle Feeds gleichzeitig gefragt, nicht aus dem Speicher. */
  async befinden(kontext) {
    if (!kontext.holen) return { ok: false, text: 'Das Recht `netz` fehlt — ohne es gibt es nichts zu fragen.' }
    const ergebnisse = await Promise.allSettled(QUELLEN.map((q) => feedHolen(q, kontext, { neu: true })))
    const erreichbar = ergebnisse.filter((e) => e.status === 'fulfilled').length
    let satz = `${erreichbar} von ${QUELLEN.length} Quellen erreichbar`

    let beste = null
    ergebnisse.forEach((e, i) => {
      if (e.status !== 'fulfilled' || QUELLEN[i].art !== 'nachrichten') return
      const neueste = neuesteZuerst(e.value.folgen)[0]
      if (neueste && Number.isFinite(neueste.zeit) && (!beste || neueste.zeit > beste.zeit)) beste = neueste
    })
    if (beste) {
      satz += `; neueste Nachricht: ${beste.herkunft.name} vom ${datumText(beste.zeit, false)}`
      const tage = frischeTageVon(kontext)
      if (!istFrisch(beste.zeit, uhr(), tage)) satz += ` — ${grenzeText(tage)}, „Nachrichten von heute" bleibt leer`
    }
    const kaputt = ergebnisse.map((e) => (e.status === 'rejected' ? grundVon(e) : null)).filter(Boolean)
    if (kaputt.length) satz += ` — nicht erreichbar: ${kaputt.join('; ')}`
    return { ok: erreichbar === QUELLEN.length, text: satz }
  },

  /** Der Knopf aus dem Manifest: Antwortzeit je Quelle. */
  async aktion(kennung, kontext) {
    if (kennung !== 'pruefen') return { ok: false, text: `Unbekannte Aktion "${kennung}".` }
    if (!kontext.holen) return { ok: false, text: 'Das Recht `netz` fehlt.' }
    // GLEICHZEITIG: vier Feeds nacheinander, einer davon 1,2 MB, kaemen der
    // Frist von 8 s je Ruf zu nahe.
    const ergebnisse = await Promise.allSettled(QUELLEN.map((q) => feedHolen(q, kontext, { neu: true })))
    const teile = ergebnisse.map((e, i) =>
      e.status === 'fulfilled'
        ? `${QUELLEN[i].name} ${e.value.ms} ms (${Math.max(1, Math.round(e.value.bytes / 1024))} KB, ${e.value.folgen.length} Folgen)`
        : grundVon(e),
    )
    return {
      ok: ergebnisse.every((e) => e.status === 'fulfilled'),
      text: `Alle ${QUELLEN.length} gleichzeitig gefragt: ${teile.join(', ')}.`,
    }
  },

  /**
   * Die freie Flaeche unter /api/plugins/mixpi-kindernachrichten/http/… (E77).
   *
   *   angebot[?q=]        die Kacheln zum Aufnehmen, `heute` zuerst; `q` filtert.
   *                       Diesen Pfad liest die Medien-Seite fuer jedes Plugin
   *                       der Sektion `medien`.
   *   suche[?q=]          DASSELBE ANGEBOT, UNGEFILTERT. Dieses Plugin hat keine
   *                       Suche (`suche: false` im Angebot) — der Pfad ist fuer
   *                       Werkzeuge da, die den Suchweg gehen
   *                       (tools/plugin-kette-probe.mts). Filterte er, fiele
   *                       deren Vorgabebegriff „hörspiel" auf eine leere Liste,
   *                       und die Kette hiesse gerissen, obwohl sie traegt.
   *   quelle/<schluessel> die Folgenliste einer Kachel zum Hineinsehen, mit
   *                       Datum und dem Stand des Feeds.
   */
  async http(anfrage, kontext) {
    if (anfrage.methode !== 'GET') return { status: 405, inhalt: { fehler: 'nur GET' } }
    const pfad = String(anfrage.pfad ?? '').replace(/^\/+|\/+$/g, '')
    /* EIN FEED, DER NICHT ANTWORTET, KOMMT ALS 502 MIT GRUND ZURUECK — wie
     * in jedem anderen Plugin. Beim Bau (28.09.2026) warf dieser Weg noch:
     * der Wirt liess damals nur 2xx und 4xx durch und ersetzte ein
     * zurueckgegebenes 502 durch „Status 502 ist nicht erlaubt". Seitdem
     * nimmt er ein 502 MIT `fehler` an (`httpAntwortPruefen` in
     * plugin-vertrag.ts). Werfen bleibt fuer echte Fehler des Plugins — der
     * Stapel landet dann im Journal, und das soll er nicht jedes Mal, wenn
     * ein Sender seinen Feed kurz nicht ausliefert. */

    if (pfad === 'angebot') {
      const q = String(anfrage.abfrage?.q ?? '')
      const eintraege = [HEUTE, ...QUELLEN].filter((e) => passt(e, q))
      const werke = await werkeBauen(eintraege, kontext)
      return { inhalt: { suche: false, gesamt: werke.length, werke } }
    }

    if (pfad === 'suche') {
      const werke = await werkeBauen([HEUTE, ...QUELLEN], kontext)
      return { inhalt: { gesamt: werke.length, werke } }
    }

    if (pfad.startsWith('quelle/')) {
      const { schluessel } = restZerlegen(pfad.slice('quelle/'.length))
      if (![HEUTE, ...QUELLEN].some((e) => e.schluessel === schluessel)) {
        return { status: 404, inhalt: { fehler: `Unbekannte Quelle "${schluessel}"` } }
      }
      let liste
      try {
        liste = await listeFuer(schluessel, 'neueste', kontext)
      } catch (f) {
        return { status: 502, inhalt: { fehler: f?.message ?? String(f) } }
      }
      const e = liste.eintrag
      const jetzt = uhr()
      return {
        inhalt: {
          kennung: `${KENNUNG}:${e.schluessel}`,
          titel: e.name,
          sender: e.sender,
          art: e.art,
          hinweis: e.hinweis,
          frischeTage: e.art === 'wissen' ? null : liste.tage,
          vollstaendig: liste.vollstaendig,
          leer: liste.folgen.length === 0 ? leerGrund(liste) : null,
          stand: liste.stand.map((s) => ({
            quelle: s.quelle.name,
            feed: s.quelle.feed,
            erreichbar: !s.fehler,
            fehler: s.fehler ?? null,
            imFeed: s.imFeed ?? null,
            frisch: s.frisch ?? null,
            neueste: s.neueste
              ? {
                  name: s.neueste.name,
                  datum: isoOderNull(s.neueste.zeit),
                  frisch: istFrisch(s.neueste.zeit, jetzt, liste.tage),
                  // Auch wenn die Kachel leer ist: so laesst sich der Ton
                  // der neuesten Folge trotzdem pruefen.
                  adresse: s.neueste.adresse,
                }
              : null,
          })),
          folgen: liste.folgen.map((f, nr) => ({
            nr,
            name: f.name,
            datum: isoOderNull(f.zeit),
            dauerSek: f.dauerSek ?? null,
            adresse: f.adresse,
          })),
        },
      }
    }

    return { status: 404, inhalt: { fehler: `Unbekannter Pfad "${pfad}"` } }
  },
}
