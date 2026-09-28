/**
 * Zeugen fuer mixpi-klexikon — fuer die Messungen im Kopf von index.mjs und
 * fuer die Zusagen an den Kern (Kennung, dieselbe Liste zweimal, kein Ton
 * ohne Stimme).
 *
 * GEFAELSCHTES NETZ, ECHTE FLAECHEN: geprueft wird ueber `inhalt()`,
 * `aufloesen()`, `suchen()`, `http()` und `befinden()` — die Wege, die auch
 * die Box nimmt. Der gefaelschte `holen` verzweigt nach den PARAMETERN der
 * Anfrage, weil Volltext, Suche und Kategorie an dieselbe Adresse gehen.
 * Das gefaelschte `sprechen` zeichnet die Texte auf und baut die Adresse wie
 * der Kern aus einem Hash ueber Text und Tempo.
 *
 * `klexikon.fixture.json` ist die echte Antwort vom 28.09.2026 (gekuerzt auf
 * den ersten Satz je Absatz) — erneuern mit
 * `node tools/klexikon-probe.mjs --vorlage-erneuern`.
 *
 *   node --test plugins/mixpi-klexikon/index.spec.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import plugin, { KEIN_PIPER, LIZENZ_SATZ, uhrStellen, zwischenspeicherLeeren } from './index.mjs'

const VORLAGE = JSON.parse(readFileSync(new URL('./klexikon.fixture.json', import.meta.url), 'utf8'))
const LOGO = 'https://klexikon.zum.de/images-instance/logo.png'

/** Ein Artikel, wie die Schnittstelle ihn liefert (formatversion 2). */
function artikel(titel, auszug, { bild, von } = {}) {
  const seite = { pageid: 1, ns: 0, title: titel, extract: auszug }
  if (bild) seite.thumbnail = { source: bild, width: 400, height: 300 }
  const query = { pages: [seite] }
  if (von) query.redirects = [{ from: von, to: titel }]
  return { batchcomplete: true, query }
}

/**
 * Das gefaelschte Klexikon.
 *
 * `artikel`: angefragter Titel -> Antwort. `kategorien`: Name -> Titel;
 * geblaettert wird in Seiten zu `seite` Titeln, damit der `continue`-Weg
 * wirklich gegangen wird. `geholt` sammelt die Parameter jeder Anfrage.
 */
function klexikon({ artikel: texte = {}, kategorien = {}, suche = null, seite = 3 } = {}) {
  const geholt = []
  const holen = async (adresse) => {
    const p = new URL(adresse).searchParams
    geholt.push(Object.fromEntries(p))
    let daten
    if (p.get('list') === 'categorymembers') {
      const alle = kategorien[String(p.get('cmtitle')).replace(/^Kategorie:/, '')] ?? []
      const ab = Number(p.get('cmcontinue') ?? 0)
      daten = { query: { categorymembers: alle.slice(ab, ab + seite).map((title) => ({ ns: 0, title })) } }
      if (ab + seite < alle.length) daten.continue = { cmcontinue: String(ab + seite), continue: '-||' }
    } else if (p.get('list') === 'search') {
      daten = suche ?? { query: { searchinfo: { totalhits: 0 }, search: [], pages: [] } }
    } else if (String(p.get('prop') ?? '').includes('extracts')) {
      const t = p.get('titles')
      daten = texte[t] ?? { query: { pages: [{ ns: 0, title: t, missing: true }] } }
    } else if (p.get('meta') === 'siteinfo') {
      daten = { query: { general: { generator: 'MediaWiki 1.43.9' } } }
    } else {
      throw new Error(`keine gefaelschte Antwort fuer: ${adresse}`)
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(daten) }
  }
  return { holen, geholt }
}

function kontextMit(netz, { einstellungen = {}, stimme = true, datenOrdner } = {}) {
  const gesprochen = []
  const k = {
    protokoll: () => {},
    einstellungen: Object.freeze({ tempo: 1.1, themen: 'Tiere und Natur', ...einstellungen }),
    holen: netz.holen,
  }
  if (datenOrdner) k.datenOrdner = datenOrdner
  if (stimme) {
    k.sprechen = async (text, gaben) => {
      gesprochen.push({ text, tempo: gaben?.tempo })
      const name = createHash('sha256')
        .update(JSON.stringify({ t: text, s: gaben?.tempo }))
        .digest('hex')
        .slice(0, 32)
      return { art: 'strom', adresse: `http://127.0.0.1:8200/api/sprechen/${name}.wav` }
    }
  }
  return { k, gesprochen }
}

const DEUTSCHLAND = { Deutschland: VORLAGE.deutschland }
const UEBERSCHRIFTEN_D = VORLAGE.deutschland.query.pages[0].extract
  .split('\n')
  .filter((z) => z.startsWith('=='))
  .map((z) => z.replace(/=/g, '').trim())

/** Ortszeit — der Tag des Kindes, nicht der von Greenwich. */
const am = (j, m, t, h = 12, min = 0) => new Date(j, m - 1, t, h, min).getTime()

beforeEach(() => {
  zwischenspeicherLeeren()
  uhrStellen(() => am(2026, 9, 28))
})
afterEach(() => uhrStellen())

describe('Abschnitte (Messung 2)', () => {
  it('mit Ueberschriften: Einleitung zuerst, dann je Ueberschrift eine Folge', async () => {
    assert.equal(UEBERSCHRIFTEN_D.length, 6, 'die Vorlage traegt die sechs Ueberschriften von „Deutschland"')
    const { k } = kontextMit(klexikon({ artikel: DEUTSCHLAND }))
    const inhalt = await plugin.inhalt('Deutschland', k)
    assert.deepEqual(
      inhalt.folgen.map((f) => f.name),
      ['Deutschland', ...UEBERSCHRIFTEN_D.map((u) => `Deutschland: ${u}`)],
    )
    assert.equal(inhalt.titel, 'Deutschland')
    assert.equal(inhalt.kuenstler, 'Klexikon')
    assert.equal(inhalt.vollstaendig, true)
  })

  it('gesprochen wird „<Titel>. <Text>" bzw. „<Ueberschrift> <Text>" — ohne zweiten Punkt nach dem Fragezeichen', async () => {
    const { k, gesprochen } = kontextMit(klexikon({ artikel: DEUTSCHLAND }))
    await plugin.inhalt('Deutschland', k)
    assert.match(gesprochen[0].text, /^Deutschland\. Deutschland ist ein Land in der Mitte von Europa\./)
    assert.match(gesprochen[1].text, /^Wie sieht das Land aus\? Im Norden/)
  })

  it('ohne Ueberschriften: EINE Folge, die wie der Artikel heisst', async () => {
    const netz = klexikon({ artikel: { Igel: artikel('Igel', 'Igel sind Säugetiere.\nSie fressen Schnecken.') } })
    const { k, gesprochen } = kontextMit(netz)
    const inhalt = await plugin.inhalt('Igel', k)
    assert.deepEqual(
      inhalt.folgen.map((f) => [f.kennung, f.name]),
      [['Igel', 'Igel']],
    )
    assert.equal(gesprochen[0].text, `Igel. Igel sind Säugetiere. Sie fressen Schnecken. ${LIZENZ_SATZ}`)
  })

  it('eine Ueberschrift ohne Text ist keine Folge', async () => {
    const auszug = 'Einleitung.\n\n\n== Leer ==\n\n\n== Voll ==\nText.'
    const { k } = kontextMit(klexikon({ artikel: { X: artikel('X', auszug) } }))
    const inhalt = await plugin.inhalt('X', k)
    assert.deepEqual(
      inhalt.folgen.map((f) => f.name),
      ['X', 'X: Voll'],
    )
  })

  it('der Wegweiser „⇒ Hier gibt es eine Übersicht …" wird nicht vorgelesen (Messung 5)', async () => {
    assert.match(VORLAGE.deutschland.query.pages[0].extract, /⇒/, 'die Vorlage traegt ihn')
    const { k, gesprochen } = kontextMit(klexikon({ artikel: DEUTSCHLAND }))
    await plugin.inhalt('Deutschland', k)
    for (const { text } of gesprochen) {
      assert.doesNotMatch(text, /⇒|Übersicht mit allen/)
      assert.doesNotMatch(text, /==/)
    }
  })

  it('Aufzaehlungszeilen ohne Satzende bekommen einen Punkt (Messung 6)', async () => {
    const auszug = 'Preisträger waren:\nHenri Dunant für Frieden, 1901\nAlbert Einstein für Physik, 1921'
    const { k, gesprochen } = kontextMit(klexikon({ artikel: { N: artikel('N', auszug) } }))
    await plugin.inhalt('N', k)
    assert.match(gesprochen[0].text, /Frieden, 1901\. Albert Einstein für Physik, 1921\. Das war/)
  })

  it('Markup-Reste fallen weg, ein Kleiner-Zeichen im Text bleibt', async () => {
    const auszug = "Ein [[Planet|Planet]] mit '''Ringen'''{{Vorlage}} <b>fett</b>. Es gilt 3 < 5."
    const { k, gesprochen } = kontextMit(klexikon({ artikel: { S: artikel('S', auszug) } }))
    await plugin.inhalt('S', k)
    assert.match(gesprochen[0].text, /^S\. Ein Planet mit Ringen fett\. Es gilt 3 < 5\./)
  })
})

describe('der Lizenzsatz', () => {
  it('steht an der LETZTEN Folge und nur dort', async () => {
    const { k, gesprochen } = kontextMit(klexikon({ artikel: DEUTSCHLAND }))
    const inhalt = await plugin.inhalt('Deutschland', k)
    const mit = gesprochen.map((g, i) => (g.text.includes(LIZENZ_SATZ) ? i : -1)).filter((i) => i >= 0)
    assert.deepEqual(mit, [inhalt.folgen.length - 1])
    assert.ok(gesprochen.at(-1).text.endsWith(LIZENZ_SATZ))
  })
})

describe('die Kennung und dieselbe Liste zweimal', () => {
  it('zweimal gefragt: Zeichen fuer Zeichen dieselbe Liste', async () => {
    const netz = klexikon({ artikel: DEUTSCHLAND })
    const a = await plugin.inhalt('Deutschland', kontextMit(netz).k)
    zwischenspeicherLeeren()
    const b = await plugin.inhalt('Deutschland', kontextMit(netz).k)
    assert.equal(JSON.stringify(a), JSON.stringify(b))
  })

  it('Einleitung = Titel, Abschnitt = Titel#Ueberschrift — nicht die Nummer, die rutscht', async () => {
    const { k } = kontextMit(klexikon({ artikel: DEUTSCHLAND }))
    const inhalt = await plugin.inhalt('Deutschland', k)
    assert.equal(inhalt.folgen[0].kennung, 'Deutschland')
    assert.equal(inhalt.folgen[1].kennung, `Deutschland#${UEBERSCHRIFTEN_D[0]}`)
    const kennungen = inhalt.folgen.map((f) => f.kennung)
    assert.equal(new Set(kennungen).size, kennungen.length, 'eindeutig — sonst wirft der Kern die zweite weg')
  })

  it('eine doppelte Ueberschrift bekommt „ (2)", in Kennung UND Name', async () => {
    const auszug = 'Anfang.\n== Wozu? ==\nEins.\n== Wozu? ==\nZwei.'
    const { k } = kontextMit(klexikon({ artikel: { D: artikel('D', auszug) } }))
    const inhalt = await plugin.inhalt('D', k)
    assert.deepEqual(
      inhalt.folgen.map((f) => [f.kennung, f.name]),
      [
        ['D', 'D'],
        ['D#Wozu?', 'D: Wozu?'],
        ['D#Wozu? (2)', 'D: Wozu? (2)'],
      ],
    )
  })

  it('ZWEI ARTIKEL, DIESELBE UEBERSCHRIFT: verschiedene Namen — sonst springt die gemerkte Stelle ueber den Namen', async () => {
    // Der Fall der Hauptsitzung (28.09.2026): gestern „Deutschland", heute
    // „Österreich", beide mit „Wie sieht das Land aus?" — `folgeWiederfinden`
    // faellt auf den NAMEN zurueck und setzte an der alten Sekunde fort.
    const netz = klexikon({
      artikel: {
        Deutschland: artikel('Deutschland', 'Ein Land.\n== Wie sieht das Land aus? ==\nFlach im Norden.'),
        Österreich: artikel('Österreich', 'Ein Land.\n== Wie sieht das Land aus? ==\nBerge im Westen.'),
      },
    })
    const { k, gesprochen } = kontextMit(netz)
    const d = await plugin.inhalt('Deutschland', k)
    const o = await plugin.inhalt(encodeURIComponent('Österreich'), k)
    assert.notEqual(d.folgen[1].name, o.folgen[1].name)
    assert.equal(o.folgen[1].name, 'Österreich: Wie sieht das Land aus?')
    // Gesprochen wird die Ueberschrift allein — der Titel kam schon in Folge 1.
    assert.match(gesprochen[3].text, /^Wie sieht das Land aus\? Berge/)
  })

  it('die Weiterleitung „Hund" -> „Hunde": Kennungen am AUFGELOESTEN Titel', async () => {
    const { k } = kontextMit(klexikon({ artikel: { Hund: VORLAGE.hund } }))
    const inhalt = await plugin.inhalt('Hund', k)
    assert.equal(inhalt.titel, 'Hunde')
    assert.equal(inhalt.folgen[0].kennung, 'Hunde')
    assert.ok(inhalt.folgen.every((f) => f.kennung.startsWith('Hunde')))
    assert.ok(inhalt.folgen[0].bild?.startsWith('https://thumb.wikimedia.org/'), 'das Vorschaubild reist mit')
    assert.doesNotMatch(inhalt.folgen[0].bild, /utm_/, 'ohne die utm-Anhaengsel von Commons')
  })
})

describe('ohne Stimme', () => {
  it('inhalt wirft den Klartext — und fragt vorher nicht erst das Netz', async () => {
    const netz = klexikon({ artikel: DEUTSCHLAND })
    const { k } = kontextMit(netz, { stimme: false })
    await assert.rejects(() => plugin.inhalt('Deutschland', k), { message: KEIN_PIPER })
    assert.equal(netz.geholt.length, 0)
  })

  it('aufloesen ebenso, und befinden sagt es in der Steckleiste', async () => {
    const { k } = kontextMit(klexikon({ artikel: DEUTSCHLAND }), { stimme: false })
    await assert.rejects(() => plugin.aufloesen('Deutschland#1', k), { message: KEIN_PIPER })
    const b = await plugin.befinden(k)
    assert.equal(b.ok, false)
    assert.match(b.text, /Piper fehlt/)
  })

  it('mit Stimme meldet befinden „vorlesen bereit"', async () => {
    const b = await plugin.befinden(kontextMit(klexikon()).k)
    assert.equal(b.ok, true)
    assert.match(b.text, /vorlesen bereit/)
  })
})

describe('Wissen des Tages', () => {
  const TIERE = ['Aal', 'Biber', 'Dachs', 'Eule', 'Fuchs', 'Igel', 'Wal']
  const UEBERSICHTEN = ['Artikelübersicht Säugetiere', 'Staaten der Erde']
  function tierNetz(extra = {}) {
    const texte = Object.fromEntries(TIERE.map((t) => [t, artikel(t, `${t} ist ein Tier.`)]))
    return klexikon({
      artikel: texte,
      kategorien: {
        // Die Uebersichten stehen hier absichtlich MIT drin: ob sie in einer
        // Themenkategorie auftauchen, entscheidet das Klexikon, nicht wir.
        'Tiere und Natur': [...UEBERSICHTEN, ...TIERE].reverse(),
        Übersichtsseite: UEBERSICHTEN,
        ...extra,
      },
    })
  }
  async function heuteAm(netz, zeit, optionen) {
    uhrStellen(() => zeit)
    const { k } = kontextMit(netz, optionen)
    return plugin.inhalt('heute', k)
  }

  it('ein Tag, ein Artikel — um 00:05 wie um 23:55, und Zeichen fuer Zeichen dieselbe Liste', async () => {
    const netz = tierNetz()
    const frueh = await heuteAm(netz, am(2026, 9, 28, 0, 5))
    const spaet = await heuteAm(netz, am(2026, 9, 28, 23, 55))
    assert.equal(JSON.stringify(frueh), JSON.stringify(spaet))
    assert.equal(frueh.titel, 'Wissen des Tages')
    assert.equal(frueh.kuenstler, 'Klexikon')
  })

  it('am naechsten Tag ein anderer — und nie zweimal hintereinander derselbe', async () => {
    const netz = tierNetz()
    let vorher = null
    for (let t = 1; t <= 30; t++) {
      const heute = (await heuteAm(netz, am(2026, 10, t))).folgen[0].name
      assert.notEqual(heute, vorher, `${t}.10. wie der Vortag: ${heute}`)
      vorher = heute
    }
  })

  it('Uebersichtsseiten kommen nie dran — und jeder echte Artikel kommt einmal, bevor sich einer wiederholt', async () => {
    const netz = tierNetz()
    const gesehen = []
    for (let t = 1; t <= TIERE.length; t++) gesehen.push((await heuteAm(netz, am(2026, 11, t))).folgen[0].name)
    assert.deepEqual([...gesehen].sort(), [...TIERE].sort())
  })

  it('die Titelliste reist im Datenordner: nach einem Neustart kostet „heute" EINE Anfrage, nach 7 Tagen wieder alle', async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'klexikon-spec-'))
    try {
      const netz = tierNetz()
      await heuteAm(netz, am(2026, 9, 28), { datenOrdner: ordner })
      assert.ok(
        netz.geholt.some((p) => p.list === 'categorymembers'),
        'beim ersten Mal wird die Liste geholt',
      )
      assert.ok(
        netz.geholt.some((p) => p.cmcontinue),
        'und geblaettert — die Kategorie hat mehr als eine Seite',
      )

      zwischenspeicherLeeren() // Neustart: der Worker vergisst, der Ordner nicht
      netz.geholt.length = 0
      await heuteAm(netz, am(2026, 9, 29), { datenOrdner: ordner })
      assert.equal(netz.geholt.length, 1, 'nur der Artikel')
      assert.ok(netz.geholt[0].prop.includes('extracts'))

      zwischenspeicherLeeren()
      netz.geholt.length = 0
      await heuteAm(netz, am(2026, 10, 7), { datenOrdner: ordner })
      assert.ok(
        netz.geholt.some((p) => p.list === 'categorymembers'),
        'acht Tage spaeter ist die Liste abgelaufen',
      )
    } finally {
      rmSync(ordner, { recursive: true, force: true })
    }
  })

  it('ohne Datenordner geht es auch — nur im Speicher', async () => {
    const netz = tierNetz()
    await heuteAm(netz, am(2026, 9, 28))
    netz.geholt.length = 0
    await heuteAm(netz, am(2026, 9, 29))
    assert.equal(netz.geholt.length, 1, 'die Liste steht im Worker')
  })

  it('leere Themen heissen: das ganze Klexikon', async () => {
    const netz = klexikon({
      artikel: { Mond: artikel('Mond', 'Der Mond.') },
      kategorien: { 'Klexikon-Artikel': ['Mond'] },
    })
    const inhalt = await heuteAm(netz, am(2026, 9, 28), { einstellungen: { themen: '' } })
    assert.equal(inhalt.folgen[0].name, 'Mond')
    assert.ok(netz.geholt.some((p) => p.cmtitle === 'Kategorie:Klexikon-Artikel'))
  })

  it('fehlt der Artikel des Tages, kommt FEST der naechste', async () => {
    const netz = tierNetz()
    const regulaer = (await heuteAm(netz, am(2026, 12, 1))).folgen[0].name
    // Dieselbe Liste, aber den Artikel des Tages gibt es nicht mehr:
    const texte = Object.fromEntries(
      TIERE.filter((t) => t !== regulaer).map((t) => [t, artikel(t, `${t} ist ein Tier.`)]),
    )
    const geloescht = klexikon({ artikel: texte, kategorien: { 'Tiere und Natur': TIERE, Übersichtsseite: [] } })
    zwischenspeicherLeeren()
    const ersatz = (await heuteAm(geloescht, am(2026, 12, 1))).folgen[0].name
    const nochmal = (await heuteAm(geloescht, am(2026, 12, 1))).folgen[0].name
    assert.notEqual(ersatz, regulaer)
    assert.ok(TIERE.includes(ersatz))
    assert.equal(nochmal, ersatz, 'fest: derselbe Ersatz bei jedem Ruf')
  })
})

describe('Abkuerzungen', () => {
  it('werden ausgeschrieben, Zahlen bleiben stehen', async () => {
    const auszug =
      'Z. B. Wale, u. a. Blauwale, d. h. Säuger, bzw. Tiere. Es gibt Katzen, Hunde usw. Dann ' +
      'ca. 1.895 Meter hoch, 30 °C warm, 60 km/h schnell, 50 % davon, Drake & Josh, Afrika.'
    const { k, gesprochen } = kontextMit(klexikon({ artikel: { T: artikel('T', auszug) } }))
    await plugin.inhalt('T', k)
    assert.equal(
      gesprochen[0].text,
      'T. Zum Beispiel Wale, unter anderem Blauwale, das heißt Säuger, beziehungsweise Tiere. ' +
        'Es gibt Katzen, Hunde und so weiter. Dann circa 1.895 Meter hoch, 30 Grad Celsius warm, ' +
        '60 Kilometer pro Stunde schnell, 50 Prozent davon, Drake und Josh, Afrika. ' +
        LIZENZ_SATZ,
    )
  })

  it('„usw." MITTEN im Satz bekommt keinen Punkt', async () => {
    const { k, gesprochen } = kontextMit(klexikon({ artikel: { U: artikel('U', 'Katzen usw. und noch mehr.') } }))
    await plugin.inhalt('U', k)
    assert.match(gesprochen[0].text, /Katzen und so weiter und noch mehr\./)
  })
})

describe('Suche und Vorschlag', () => {
  /** Die echte Mond-Suche, plus eine Uebersichtsseite OHNE die Artikel-Kategorie. */
  function sucheMitUebersicht() {
    const s = structuredClone(VORLAGE.sucheMond)
    s.query.search.splice(1, 0, { ns: 0, title: 'Artikelübersicht Weltall', snippet: 'alles über den Mond' })
    s.query.search.splice(2, 0, { ns: 0, title: 'Staaten der Erde', snippet: 'Mond und Staaten' })
    s.query.pages.push({ ns: 0, title: 'Artikelübersicht Weltall' }, { ns: 0, title: 'Staaten der Erde' })
    return s
  }

  it('angebot OHNE Begriff: nur „Wissen des Tages", ohne ins Netz zu gehen', async () => {
    const netz = klexikon()
    const a = await plugin.http({ methode: 'GET', pfad: 'angebot', abfrage: {} }, kontextMit(netz).k)
    assert.equal(a.inhalt.suche, true)
    assert.equal(a.inhalt.platzhalter, 'z. B. Mond, Elefanten, Vulkan')
    assert.equal(a.inhalt.werke.length, 1)
    assert.equal(a.inhalt.werke[0].kennung, 'heute')
    assert.match(a.inhalt.werke[0].hinweis, /Tiere und Natur/, 'der Hinweis nennt die Themen')
    assert.deepEqual(a.inhalt.werke[0].vorschlag, {
      type: 'plugin',
      category: 'other',
      id: 'mixpi-klexikon:heute',
      title: 'Wissen des Tages',
      artist: 'Klexikon',
      cover: LOGO,
    })
    assert.equal(netz.geholt.length, 0)
  })

  it('angebot MIT Begriff: Treffer, Uebersichtsseiten heraus (nach der Kategorie, nicht nach dem Namen)', async () => {
    const a = await plugin.http(
      { methode: 'GET', pfad: 'angebot', abfrage: { q: 'Mond' } },
      kontextMit(klexikon({ suche: sucheMitUebersicht() })).k,
    )
    const titel = a.inhalt.werke.map((w) => w.titel)
    assert.equal(titel[0], 'Mond')
    assert.ok(!titel.includes('Artikelübersicht Weltall'))
    assert.ok(!titel.includes('Staaten der Erde'), 'die Uebersicht OHNE Praefix faellt auch heraus')
    assert.equal(a.inhalt.gesamt, 96)
    assert.equal(a.inhalt.suche, true)
  })

  it('der Vorschlag ist ein fertiger data.json-Eintrag mit der VOLLEN Medienkennung', async () => {
    const a = await plugin.http(
      { methode: 'GET', pfad: 'suche', abfrage: { q: 'Mond' } },
      kontextMit(klexikon({ suche: VORLAGE.sucheMond })).k,
    )
    const mond = a.inhalt.werke[0]
    assert.equal(mond.kennung, 'Mond')
    assert.deepEqual(Object.keys(mond).sort(), ['bild', 'hinweis', 'kennung', 'titel', 'vorschlag'])
    assert.equal(mond.vorschlag.type, 'plugin')
    assert.equal(mond.vorschlag.id, 'mixpi-klexikon:Mond')
    assert.equal(mond.vorschlag.artist, 'Klexikon')
    assert.equal(mond.vorschlag.cover, mond.bild, 'mit Vorschaubild: das Bild')
    const ohneBild = a.inhalt.werke.find((w) => !w.bild)
    assert.equal(ohneBild.vorschlag.cover, LOGO, 'ohne: das Klexikon-Zeichen')
  })

  it('die Fundstelle steht ohne HTML da', async () => {
    const a = await plugin.http(
      { methode: 'GET', pfad: 'suche', abfrage: { q: 'Mond' } },
      kontextMit(klexikon({ suche: VORLAGE.sucheMond })).k,
    )
    assert.match(VORLAGE.sucheMond.query.search[0].snippet, /searchmatch/, 'die Vorlage traegt die Markierung')
    for (const w of a.inhalt.werke) assert.doesNotMatch(w.hinweis, /<|&quot;|searchmatch/)
  })

  it('suchen() liefert Name und Kuenstler; ein leerer Begriff geht nicht ins Netz', async () => {
    const netz = klexikon({ suche: VORLAGE.sucheMond })
    const t = await plugin.suchen('Mond', kontextMit(netz).k)
    assert.deepEqual(t[0], { name: 'Mond', kuenstler: 'Klexikon' })
    netz.geholt.length = 0
    assert.deepEqual(await plugin.suchen('  ', kontextMit(netz).k), [])
    assert.equal(netz.geholt.length, 0)
  })

  it('artikel/<titel> zeigt die Folgen mit Zeichenzahl und die Lizenz', async () => {
    const a = await plugin.http(
      { methode: 'GET', pfad: 'artikel/Deutschland', abfrage: {} },
      kontextMit(klexikon({ artikel: DEUTSCHLAND })).k,
    )
    assert.equal(a.inhalt.titel, 'Deutschland')
    assert.equal(a.inhalt.abschnitte.length, 7)
    assert.equal(a.inhalt.abschnitte[1].name, `Deutschland: ${UEBERSCHRIFTEN_D[0]}`)
    assert.ok(a.inhalt.abschnitte.every((x) => x.zeichen > 0))
    assert.match(a.inhalt.lizenz, /CC BY-SA/)
    assert.equal(a.inhalt.adresse, 'https://klexikon.zum.de/wiki/Deutschland')
  })

  it('nur GET, ein unbekannter Pfad ist ein 404, ein fehlender Artikel auch', async () => {
    const k = kontextMit(klexikon()).k
    assert.equal((await plugin.http({ methode: 'POST', pfad: 'angebot', abfrage: {} }, k)).status, 405)
    assert.equal((await plugin.http({ methode: 'GET', pfad: 'quatsch', abfrage: {} }, k)).status, 404)
    assert.equal((await plugin.http({ methode: 'GET', pfad: 'artikel/Gibtsnicht', abfrage: {} }, k)).status, 404)
  })
})

describe('aufloesen', () => {
  it('ohne # die erste Folge, mit #n die n-te — dieselbe Quelle wie in der Liste', async () => {
    const netz = klexikon({ artikel: DEUTSCHLAND })
    const { k } = kontextMit(netz)
    const inhalt = await plugin.inhalt('Deutschland', k)
    const erst = await plugin.aufloesen('Deutschland', k)
    assert.deepEqual(erst.titel, { name: 'Deutschland', kuenstler: 'Klexikon' })
    assert.deepEqual(erst.quelle, inhalt.folgen[0].quelle)
    const dritt = await plugin.aufloesen('Deutschland#2', k)
    assert.equal(dritt.titel.name, inhalt.folgen[2].name)
    assert.deepEqual(dritt.quelle, inhalt.folgen[2].quelle)
    await assert.rejects(() => plugin.aufloesen('Deutschland#99', k), /keine Folge 100/)
  })
})

describe('Titel hin und zurueck', () => {
  it('Umlaut und Leerzeichen: Suchtreffer -> Vorschlag -> inhalt findet denselben Artikel', async () => {
    const titel = 'Schwäbische Alb'
    const suche = {
      query: {
        searchinfo: { totalhits: 1 },
        search: [{ ns: 0, title: titel, snippet: 'ein Gebirge' }],
        pages: [{ ns: 0, title: titel, categories: [{ ns: 14, title: 'Kategorie:Klexikon-Artikel' }] }],
      },
    }
    const netz = klexikon({ suche, artikel: { [titel]: artikel(titel, 'Die Alb ist ein Gebirge.') } })
    const { k } = kontextMit(netz)
    const a = await plugin.http({ methode: 'GET', pfad: 'angebot', abfrage: { q: 'Alb' } }, k)
    const id = a.inhalt.werke[0].vorschlag.id
    assert.equal(id, 'mixpi-klexikon:Schw%C3%A4bische%20Alb')
    // Der Kern teilt am ERSTEN Doppelpunkt (kennungZerlegen) und reicht den Rest durch.
    const rest = id.slice(id.indexOf(':') + 1)
    const inhalt = await plugin.inhalt(rest, k)
    assert.equal(inhalt.titel, titel)
    assert.equal(netz.geholt.at(-1).titles, titel, 'angefragt wird der Klartext-Titel')
  })

  it('Klartext und Unterstriche gehen auch; verbotene Zeichen gehen gar nicht erst ins Netz', async () => {
    const netz = klexikon({ artikel: { 'Schwäbische Alb': artikel('Schwäbische Alb', 'Ein Gebirge.') } })
    const { k } = kontextMit(netz)
    assert.equal((await plugin.inhalt('Schwäbische_Alb', k)).titel, 'Schwäbische Alb')
    netz.geholt.length = 0
    // Ein `|` waeren zwei Titel in einer Anfrage — und nach Messung 1 fuer einen davon kein Text.
    await assert.rejects(() => plugin.inhalt('Mond%7CSonne', k), /kein gültiger Artikeltitel/)
    assert.equal(netz.geholt.length, 0)
  })
})

describe('Speicher, Tempo, Laenge', () => {
  it('ein Artikel haelt 15 Minuten im Worker', async () => {
    const netz = klexikon({ artikel: DEUTSCHLAND })
    const { k } = kontextMit(netz)
    await plugin.inhalt('Deutschland', k)
    uhrStellen(() => am(2026, 9, 28, 12, 10))
    await plugin.inhalt('Deutschland', k)
    assert.equal(netz.geholt.length, 1)
    uhrStellen(() => am(2026, 9, 28, 12, 16))
    await plugin.inhalt('Deutschland', k)
    assert.equal(netz.geholt.length, 2)
  })

  it('das Tempo reist aus den Einstellungen, auf die Spanne des Kerns gebogen', async () => {
    const netz = klexikon({ artikel: DEUTSCHLAND })
    const vorgabe = kontextMit(netz)
    await plugin.inhalt('Deutschland', vorgabe.k)
    assert.ok(vorgabe.gesprochen.every((g) => g.tempo === 1.1))
    const zuLangsam = kontextMit(netz, { einstellungen: { tempo: 5 } })
    await plugin.inhalt('Deutschland', zuLangsam.k)
    assert.ok(zuLangsam.gesprochen.every((g) => g.tempo === 2))
  })

  it('ein Abschnitt ueber der Grenze von sprechen() wird zu Teilen — keiner ueber 20000 Zeichen', async () => {
    const satz = 'Das ist ein ziemlich langer Satz über den Ozean und seine Tiere. '
    const auszug = satz.repeat(Math.ceil(45_000 / satz.length))
    const { k, gesprochen } = kontextMit(klexikon({ artikel: { Ozean: artikel('Ozean', auszug) } }))
    const inhalt = await plugin.inhalt('Ozean', k)
    assert.ok(inhalt.folgen.length >= 3)
    assert.deepEqual(
      inhalt.folgen.slice(0, 2).map((f) => [f.kennung, f.name]),
      [
        ['Ozean', 'Ozean'],
        ['Ozean (Teil 2)', 'Ozean (Teil 2)'],
      ],
    )
    assert.ok(gesprochen.every((g) => g.text.length <= 20_000))
    assert.deepEqual(
      gesprochen.map((g) => g.text.includes(LIZENZ_SATZ)),
      gesprochen.map((_, i) => i === gesprochen.length - 1),
    )
  })
})
