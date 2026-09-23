/**
 * MIXPI-ARCHIVE — gemeinfreie Hoerspiele und Sprachaufnahmen aus dem
 * Internet Archive (archive.org), ohne Anmeldung und ohne Schluessel.
 *
 * ══ WARUM DIESES PLUGIN ════════════════════════════════════════════════════
 * Von allen Anbietern der E84-Liste ist das Archiv der einzige, der WEDER
 * einen Server im Haus NOCH ein Abo braucht: die Suche ist offen, die
 * Metadaten sind offen, und die Dateien liegen unter einer festen Adresse.
 * Was dort liegt, ist gemeinfrei oder frei lizenziert — LibriVox-Lesungen,
 * alte Radiostuecke, das Hoerspielprojekt-Archiv (341 deutsche Hoerspiele in
 * EINEM Werk, gemessen 22.08.2026).
 *
 * ══ DIE DREI MESSUNGEN, DIE DIESEN CODE ERKLAEREN ══════════════════════════
 * Alle mit tools/archive-probe.mjs am 22.08.2026 gegen die echte
 * Schnittstelle genommen — nicht aus der Doku abgeschrieben.
 *
 *   1. DUBLETTEN SIND DIE REGEL, nicht die Ausnahme. `faust1teil_1412_librivox`
 *      fuehrt 84 MP3-Dateien und 28 eigenstaendige Stuecke: jede Spur liegt
 *      als VBR MP3, als 128Kbps MP3 und als 64Kbps MP3. Wer die Dateiliste
 *      ungefiltert nimmt, baut ein Hoerbuch, in dem jedes Kapitel dreimal
 *      kommt. Das Feld `original` zeigt von der Ableitung auf die Quelle und
 *      ist damit der Schluessel zum Zusammenfassen.
 *
 *   2. `length` FEHLT AUSGERECHNET AM ORIGINAL. Bei demselben Werk traegt die
 *      128Kbps-Fassung eine Dauer, die VBR- und die 64k-Fassung `NaN`. Die
 *      Dauer gehoert deshalb der GRUPPE, nicht der gewaehlten Datei — sonst
 *      steht auf der Kachel nichts, obwohl die Zahl danebenliegt.
 *
 *   3. EIN WERK IST KEIN ALBUM. 1038 Dateien in einem Werk sind moeglich,
 *      davon 345 Bilder und 344 Spektrogramme. Ton ist, was ein MP3-Format
 *      traegt — alles andere ist Beiwerk und faellt weg.
 *
 * ══ WAS DIESES PLUGIN NICHT TUT ════════════════════════════════════════════
 * Es laedt nichts herunter und legt nichts ab. `quelle.art` ist immer `strom`
 * mit einer https-Adresse; das Archiv liefert direkt, und der Kern entscheidet
 * wie immer, ob daraus Ton wird.
 */

const SUCHE = 'https://archive.org/advancedsearch.php'
const METADATEN = 'https://archive.org/metadata'
const HERUNTER = 'https://archive.org/download'

/** Wie viele Dateien ein Werk hoechstens beitraegt — gegen den 1038-Fall. */
const STUECK_GRENZE = 400

/**
 * WELCHE FASSUNG GESPIELT WIRD, in dieser Reihenfolge.
 *
 * 128Kbps zuerst, und das ist eine Entscheidung fuer die Box, nicht fuer das
 * Ohr: es ist die kleinste Fassung, die durchgehend eine Dauer traegt, und
 * auf einem Pi am WLAN ist sie schon mehr als genug. VBR waere groesser ohne
 * hoerbaren Gewinn auf diesen Lautsprechern.
 */
const FORMAT_RANG = ['128Kbps MP3', 'VBR MP3', 'MP3', '64Kbps MP3']

function istTon(datei) {
  return FORMAT_RANG.includes(String(datei?.format ?? ''))
}

async function fragen(kontext, adresse) {
  if (!kontext.holen) throw new Error('Das Recht `netz` fehlt.')
  const start = Date.now()
  const antwort = await kontext.holen(adresse, { headers: { accept: 'application/json' } })
  if (!antwort.ok) throw new Error(`Das Archiv antwortete mit HTTP ${antwort.status}`)
  return { daten: await antwort.json(), ms: Date.now() - start }
}

/** Die Sucheadresse — `mediatype:audio` ist der halbe Filter. */
function sucheAdresse(begriff, einstellungen) {
  const sprache = String(einstellungen?.sprache ?? '').trim()
  const rohZahl = Number(einstellungen?.treffer)
  const anzahl = Number.isFinite(rohZahl) && rohZahl > 0 ? Math.min(Math.floor(rohZahl), 100) : 25
  const teile = [`(${begriff})`, 'mediatype:audio']
  if (sprache) teile.push(`language:${sprache}`)
  const p = new URLSearchParams()
  p.set('q', teile.join(' AND '))
  for (const f of ['identifier', 'title', 'creator', 'year', 'language', 'downloads']) p.append('fl[]', f)
  p.set('rows', String(anzahl))
  p.set('page', '1')
  p.set('output', 'json')
  // NACH ABRUFEN SORTIERT, nicht nach Datum: das Archiv ist ein Dachboden,
  // und was oft gehoert wurde, ist meist auch das, was hoerbar ist.
  p.append('sort[]', 'downloads desc')
  return `${SUCHE}?${p}`
}

/** Ein Suchtreffer -> die schlanke Form, die Kern und Verwaltung lesen. */
function werkAus(roh) {
  const kennung = String(roh?.identifier ?? '').trim()
  const titel = String(roh?.title ?? '').trim()
  if (!kennung || !titel) return null
  // `creator` kommt mal als Zeichenkette, mal als Liste — beides gesehen.
  const wer = Array.isArray(roh?.creator) ? roh.creator[0] : roh?.creator
  return {
    kennung,
    titel,
    urheber: String(wer ?? '').trim() || 'Internet Archive',
    jahr: String(roh?.year ?? '').trim(),
    abrufe: Number(roh?.downloads) || 0,
  }
}

/**
 * Der data.json-Eintrag zu einem Werk — die EINE Stelle dieser Form.
 *
 * ══ SEIT E87 IST ER EINLOESBAR ═════════════════════════════════════════════
 * Bis dahin stand hier `type: 'mixpi-archive'`, und das war eine Kachel, die
 * nicht spielt: die Box-Oberflaeche hatte keinen allgemeinen Plugin-Weg,
 * `dienstVon()` machte daraus `anderes` und `artVon()` ebenso. Deshalb gab es
 * zu diesem Vorschlag ausdruecklich KEINEN Aufnehmen-Knopf.
 *
 * DIE FORM, DIE DER KERN SEIT E87 VERSTEHT: `type: 'plugin'` und in `id` die
 * VOLLE Medienkennung. Daraus baut `medienSchluessel()` ohne Zutun
 * `plugin:mixpi-archive:<identifier>` — eine stabile Identitaet fuer Verlauf,
 * Weiterhoeren und Favoriten.
 *
 * WARUM NICHT WEITER `type: 'mixpi-archive'`: `dienstVon()` ist rein und kennt
 * kein Plugin-Register — „mixpi-archive" allein sieht aus wie ein geladenes
 * Plugin UND wie ein Tippfehler. Das feste Wort davor beantwortet die Frage
 * syntaktisch. Die Begruendung steht ausfuehrlich in medien.ts.
 */
function vorschlagAus(w) {
  return {
    type: 'plugin',
    category: 'audiobook',
    id: `mixpi-archive:${w.kennung}`,
    title: w.titel,
    artist: w.urheber,
    cover: `${HERUNTER}/${encodeURIComponent(w.kennung)}/__ia_thumb.jpg`,
  }
}

/**
 * Aus der rohen Dateiliste die STUECKE machen — der Kern dieses Plugins.
 *
 * Dreierlei auf einmal, weil es nur zusammen richtig ist: Ton heraussieben,
 * Dubletten ueber `original` zusammenfassen, und je Gruppe die beste Fassung
 * samt der Dauer waehlen, die IRGENDWO in der Gruppe steht (Messung 2 oben).
 */
function stueckeAus(dateien, kennung) {
  const gruppen = new Map()
  for (const d of dateien ?? []) {
    if (!istTon(d)) continue
    const name = String(d?.name ?? '').trim()
    if (!name) continue
    // `original` zeigt von der Ableitung auf die Quelle; fehlt es, ist die
    // Datei selbst die Quelle.
    const schluessel = String(d?.original ?? name)
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, [])
    gruppen.get(schluessel).push(d)
  }

  const stuecke = []
  for (const [schluessel, fassungen] of gruppen) {
    fassungen.sort((a, b) => FORMAT_RANG.indexOf(String(a.format)) - FORMAT_RANG.indexOf(String(b.format)))
    const beste = fassungen[0]
    // DIE DAUER GEHOERT DER GRUPPE: die erste Fassung, die eine traegt.
    let dauerSek
    for (const f of fassungen) {
      const n = Number(f?.length)
      if (Number.isFinite(n) && n > 0) {
        dauerSek = Math.floor(n)
        break
      }
    }
    // Auch der Titel darf aus der Gruppe kommen — er fehlt nicht immer dort,
    // wo die Datei liegt. Ohne ihn steht der Dateiname da, und der ist
    // haesslich, aber ehrlich.
    const titel =
      fassungen.map((f) => String(f?.title ?? '').trim()).find(Boolean) || schluessel.replace(/\.[^.]+$/, '')
    const spurRoh = fassungen.map((f) => f?.track).find((t) => t !== undefined && t !== null)
    const spur = Number.parseInt(String(spurRoh ?? ''), 10)
    stuecke.push({
      /* DIE KENNUNG IST DER GRUPPENSCHLUESSEL, also der Name der QUELLDATEI
       * (`faust1_01_goethe.mp3`), nicht der der gespielten Fassung.
       *
       * WARUM DAS DER RICHTIGE IST: `original` zeigt von jeder Ableitung auf
       * dieselbe Quelle. Naehme man `beste.name`, aenderte sich die Kennung,
       * sobald das Archiv eine Fassung nachliefert oder die Rangfolge
       * umgestellt wird — und mit ihr der Verlauf und die gemerkte Stelle.
       *
       * SIE FEHLTE BIS ZUM 22.08.2026, und das ist genau der Fall, gegen den
       * es Nahtzeugen gibt: `inhaltPruefen` uebergeht eine Folge ohne Kennung
       * STILL („Folge ohne Kennung uebergangen"). Das Plugin war gruen, seine
       * 22 Zeugen waren gruen, und der Kern haette eine leere Liste bekommen. */
      kennung: schluessel,
      name: titel,
      spur: Number.isFinite(spur) ? spur : null,
      dauerSek,
      quelle: { art: 'strom', adresse: `${HERUNTER}/${encodeURIComponent(kennung)}/${encodeURIComponent(beste.name)}` },
    })
  }

  /* ORDNUNG: Spurnummer, dann Name.
   *
   * Die Spur ist im Archiv NICHT verlaesslich — gemessen stand bei einem Werk
   * mit 341 Stuecken ueberall „1" und einmal „05". Deshalb entscheidet sie
   * nur, wo sie WIRKLICH unterscheidet; sonst der Name, und der ist bei
   * Lesungen (`01 - Zueignung`, `02 - Vorspiel`) ohnehin die Reihenfolge. */
  const spuren = new Set(stuecke.map((s) => s.spur))
  const spurTaugt = spuren.size > 1 && !spuren.has(null)
  stuecke.sort((a, b) =>
    spurTaugt ? a.spur - b.spur || a.name.localeCompare(b.name, 'de') : a.name.localeCompare(b.name, 'de'),
  )
  return stuecke.slice(0, STUECK_GRENZE)
}

/** 15-Minuten-Zwischenspeicher im Worker — er lebt, bis das Plugin neu startet. */
const speicher = new Map()

/** TESTNAHT: den Zwischenspeicher leeren. Im Betrieb ruft das niemand. */
export function zwischenspeicherLeeren() {
  speicher.clear()
}
function gemerkt(schluessel) {
  const e = speicher.get(schluessel)
  return e && Date.now() < e.bis ? e.wert : null
}
function merken(schluessel, wert) {
  speicher.set(schluessel, { wert, bis: Date.now() + 15 * 60_000 })
  return wert
}

async function werkHolen(kennung, kontext) {
  const da = gemerkt(`werk:${kennung}`)
  if (da) return da
  const { daten } = await fragen(kontext, `${METADATEN}/${encodeURIComponent(kennung)}`)
  // LEERE METADATEN SIND DIE ANTWORT AUF „GIBT ES NICHT": das Archiv liefert
  // dafuer HTTP 200 mit `{}`, keinen 404. Wer nur auf den Status sieht, haelt
  // ein unbekanntes Werk fuer ein leeres.
  if (!daten || !daten.metadata) throw new Error(`Das Werk "${kennung}" kennt das Archiv nicht`)
  return merken(`werk:${kennung}`, daten)
}

export default {
  /**
   * Suchen — Werke, keine einzelnen Stuecke.
   *
   * Die Box kennt Werke; ein Suchergebnis mit 341 Einzelstuecken waere keine
   * Hilfe, sondern eine Wand. Was in einem Werk steckt, sagt `inhalt()`.
   */
  async suchen(begriff, kontext) {
    const wort = String(begriff ?? '').trim()
    if (!wort) return []
    const { daten } = await fragen(kontext, sucheAdresse(wort, kontext.einstellungen))
    return (daten?.response?.docs ?? [])
      .map(werkAus)
      .filter(Boolean)
      .map((w) => ({ name: w.titel, kuenstler: w.urheber }))
  },

  /**
   * Ein Werk zu seiner geordneten Stueckliste (E78). rest: `<identifier>`.
   */
  async inhalt(rest, kontext) {
    const kennung = String(rest ?? '').split('#', 1)[0].trim()
    if (!kennung) throw new Error('keine Werkkennung')
    const daten = await werkHolen(kennung, kontext)
    const meta = daten.metadata ?? {}
    const wer = Array.isArray(meta.creator) ? meta.creator[0] : meta.creator
    const stuecke = stueckeAus(daten.files, kennung)
    return {
      titel: String(meta.title ?? '').trim() || kennung,
      kuenstler: String(wer ?? '').trim() || 'Internet Archive',
      // LEER IST EIN ERGEBNIS: ein Werk kann ausschliesslich Scans enthalten.
      // Das ist die Wahrheit ueber dieses Werk, kein Fehler dieses Plugins.
      folgen: stuecke.map((s) => ({ kennung: s.kennung, name: s.name, dauerSek: s.dauerSek, quelle: s.quelle })),
      vollstaendig: stuecke.length < STUECK_GRENZE,
    }
  },

  /**
   * EIN Stueck — der Weg direkt vor dem Abspielen.
   *
   * rest: `<identifier>` (dann das erste Stueck) oder `<identifier>#<n>`
   * (das n-te, 0-basiert, wie es die Folgenliste zaehlt).
   */
  async aufloesen(rest, kontext) {
    const [kennung, wunsch] = String(rest ?? '').split('#', 2)
    if (!kennung) throw new Error('keine Werkkennung')
    const daten = await werkHolen(kennung.trim(), kontext)
    const stuecke = stueckeAus(daten.files, kennung.trim())
    const nr = Number.parseInt(String(wunsch ?? '0'), 10)
    const stueck = stuecke[Number.isFinite(nr) && nr >= 0 ? nr : 0]
    if (!stueck) throw new Error(`Das Werk "${kennung}" hat kein abspielbares Stueck`)
    const meta = daten.metadata ?? {}
    return {
      titel: {
        name: stueck.name,
        kuenstler: String(meta.title ?? '').trim() || undefined,
        dauerSek: stueck.dauerSek,
      },
      quelle: stueck.quelle,
    }
  },

  /** Ein Satz fuer die Karte: ist das Archiv von dieser Box aus erreichbar? */
  async befinden(kontext) {
    if (!kontext.holen) return { ok: false, text: 'Das Recht `netz` fehlt — ohne es gibt es nichts zu fragen.' }
    try {
      const { daten, ms } = await fragen(kontext, sucheAdresse('test', { treffer: 1 }))
      const da = Array.isArray(daten?.response?.docs)
      return da
        ? { ok: true, text: `Das Archiv antwortet (${ms} ms). Ohne Anmeldung, wie immer.` }
        : { ok: false, text: 'Das Archiv antwortet, aber nicht in der erwarteten Form.' }
    } catch (f) {
      return { ok: false, text: `Archiv nicht erreichbar: ${f.message}` }
    }
  },

  /** Der Knopf aus dem Manifest. */
  async aktion(kennung, kontext) {
    if (kennung !== 'pruefen') return { ok: false, text: `Unbekannte Aktion "${kennung}".` }
    if (!kontext.holen) return { ok: false, text: 'Das Recht `netz` fehlt.' }
    const zeiten = []
    for (let i = 0; i < 3; i++) {
      try {
        const { ms } = await fragen(kontext, sucheAdresse('test', { treffer: 1 }))
        zeiten.push(ms)
      } catch (f) {
        return { ok: false, text: `Anfrage ${i + 1} von 3 scheiterte: ${f.message}` }
      }
    }
    const schnitt = Math.round(zeiten.reduce((a, b) => a + b, 0) / zeiten.length)
    return { ok: true, text: `Dreimal gefragt: ${zeiten.join(', ')} ms — Mittel ${schnitt} ms.` }
  },

  /**
   * Die freie Flaeche unter /api/plugins/mixpi-archive/http/… (E77).
   *
   *   suche?q=            Werke suchen, mit data.json-Vorschlag je Werk
   *   werk/<identifier>   ein Werk auseinandergenommen, zum Hineinhoeren
   *
   * `schonDa` fehlt mit Absicht — ob ein Werk schon in der Bibliothek steht,
   * weiss die Bibliothek, und die Verwaltungsseite rechnet es aus ihren
   * eigenen Eintraegen. Dasselbe Argument wie bei mixpi-ardsounds.
   */
  async http(anfrage, kontext) {
    if (anfrage.methode !== 'GET') return { status: 405, inhalt: { fehler: 'nur GET' } }
    if (!kontext.holen) return { status: 502, inhalt: { fehler: 'Das Recht `netz` fehlt.' } }
    try {
      if (anfrage.pfad === 'suche') {
        const wort = String(anfrage.abfrage.q ?? '').trim()
        if (!wort) return { inhalt: { werke: [], gesamt: 0 } }
        const { daten } = await fragen(kontext, sucheAdresse(wort, kontext.einstellungen))
        const werke = (daten?.response?.docs ?? []).map(werkAus).filter(Boolean)
        return {
          inhalt: {
            gesamt: Number(daten?.response?.numFound) || werke.length,
            werke: werke.map((w) => ({ ...w, vorschlag: vorschlagAus(w) })),
          },
        }
      }

      if (anfrage.pfad.startsWith('werk/')) {
        const kennung = anfrage.pfad.slice('werk/'.length).trim()
        if (!kennung) return { status: 404, inhalt: { fehler: 'kein Werk angegeben' } }
        const daten = await werkHolen(kennung, kontext)
        const meta = daten.metadata ?? {}
        const wer = Array.isArray(meta.creator) ? meta.creator[0] : meta.creator
        const stuecke = stueckeAus(daten.files, kennung)
        return {
          inhalt: {
            kennung,
            titel: String(meta.title ?? '').trim() || kennung,
            urheber: String(wer ?? '').trim() || 'Internet Archive',
            // DIE LIZENZ GEHOERT AUF DEN SCHIRM. Das Archiv haelt auch Werke,
            // die nicht gemeinfrei sind; wer aufnimmt, soll sehen, was gilt.
            lizenz: String(meta.licenseurl ?? meta.rights ?? '').trim(),
            stuecke: stuecke.map((s, i) => ({ nr: i, name: s.name, dauerSek: s.dauerSek })),
          },
        }
      }

      return { status: 404, inhalt: { fehler: `Unbekannter Pfad "${anfrage.pfad}"` } }
    } catch (f) {
      return { status: 502, inhalt: { fehler: f.message } }
    }
  },
}
