/**
 * Zeugen fuer mixpi-archive — und zwar fuer die drei MESSUNGEN, die dieses
 * Plugin begruenden (siehe Kopf von index.mjs). Jede von ihnen ist mit
 * tools/archive-probe.mjs am 22.08.2026 an der echten Schnittstelle
 * genommen; hier stehen sie als Zeuge, damit sie nicht still kippen.
 *
 * GEFAELSCHTES NETZ, ECHTE FLAECHEN: geprueft wird ueber `suchen()`,
 * `inhalt()`, `aufloesen()` und `http()` — die Wege, die auch die Box nimmt.
 * Der gefaelschte `holen` verzweigt nach der ADRESSE, weil Suche und
 * Metadaten an verschiedene gehen.
 *
 *   node --test plugins/mixpi-archive/index.spec.mjs
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import plugin, { zwischenspeicherLeeren } from './index.mjs'

function kontextMit(antworten, einstellungen = {}) {
  return {
    protokoll: () => {},
    einstellungen: Object.freeze(einstellungen),
    holen: async (adresse) => {
      for (const [muster, daten] of antworten) {
        if (String(adresse).includes(muster)) return { ok: true, json: async () => daten }
      }
      throw new Error(`keine gefaelschte Antwort fuer: ${String(adresse).slice(0, 80)}`)
    },
  }
}

/** Eine Datei, wie das Archiv sie in `files` fuehrt. */
function datei(name, format, extra = {}) {
  return { name, format, ...extra }
}

/**
 * DER GEMESSENE FALL: faust1teil_1412_librivox fuehrt jede Spur dreimal.
 * `length` steht nur an der 128k-Fassung, `original` zeigt auf die Quelle.
 */
function librivoxSpur(nr, titel, sekunden) {
  const stamm = `faust1_${String(nr).padStart(2, '0')}_goethe`
  return [
    datei(`${stamm}.mp3`, 'VBR MP3', { title: titel, track: String(nr) }),
    datei(`${stamm}_128kb.mp3`, '128Kbps MP3', { title: titel, track: String(nr), length: sekunden, original: `${stamm}.mp3` }),
    datei(`${stamm}_64kb.mp3`, '64Kbps MP3', { title: titel, track: String(nr), original: `${stamm}.mp3` }),
  ]
}

const werkMit = (dateien, meta = {}) => [
  ['/metadata/', { metadata: { title: 'Faust', creator: 'Goethe', ...meta }, files: dateien }],
]
const sucheMit = (docs, numFound = docs.length) => [['advancedsearch', { response: { numFound, docs } }]]

describe('die Dubletten-Regel (Messung 1)', () => {
  beforeEach(() => zwischenspeicherLeeren())

  it('drei Fassungen derselben Spur werden EIN Stueck — sonst kaeme jedes Kapitel dreimal', async () => {
    const dateien = [...librivoxSpur(1, '01 - Zueignung', 134), ...librivoxSpur(2, '02 - Vorspiel', 603)]
    assert.equal(dateien.length, 6, 'sechs Dateien gehen hinein')
    const inhalt = await plugin.inhalt('faust', kontextMit(werkMit(dateien)))
    assert.equal(inhalt.folgen.length, 2, 'zwei Stuecke kommen heraus')
    assert.deepEqual(
      inhalt.folgen.map((f) => f.name),
      ['01 - Zueignung', '02 - Vorspiel'],
    )
  })

  it('gespielt wird die 128k-Fassung — kleinste Datei, die durchgehend eine Dauer traegt', async () => {
    const inhalt = await plugin.inhalt('faust', kontextMit(werkMit(librivoxSpur(1, 'Zueignung', 134))))
    assert.match(inhalt.folgen[0].quelle.adresse, /faust1_01_goethe_128kb\.mp3$/)
  })

  it('ohne `original` bleibt jede Datei ein eigenes Stueck', async () => {
    // Der Fall hoespielprojekt-de-archiv: 341 MP3, 341 Stuecke, kein original.
    const dateien = [
      datei('abgang.mp3', 'VBR MP3', { title: 'Abgang' }),
      datei('abtruennig.mp3', 'VBR MP3', { title: 'Abtruennig' }),
    ]
    const inhalt = await plugin.inhalt('hsp', kontextMit(werkMit(dateien)))
    assert.equal(inhalt.folgen.length, 2)
  })
})

describe('die Dauer-Regel (Messung 2)', () => {
  beforeEach(() => zwischenspeicherLeeren())

  it('die Dauer gehoert der GRUPPE — auch wenn die GESPIELTE Fassung keine traegt', async () => {
    /* DIESER ZEUGE WAR EINMAL BLIND, und die Gegenprobe hat es gezeigt
     * (22.08.2026): mit dem gemessenen LibriVox-Satz traegt ausgerechnet die
     * 128k-Fassung die Dauer — und die wird auch gespielt. Ob die Dauer aus
     * der GRUPPE kommt oder nur aus der gewaehlten Datei, war daran nicht zu
     * unterscheiden; die Sabotage blieb gruen.
     *
     * Hier fehlt sie deshalb an der gespielten Fassung: VBR wird gewaehlt
     * (Rang 2 schlaegt Rang 4), die Zahl steht nur an der 64k. */
    const dateien = [
      datei('a.mp3', 'VBR MP3', { title: 'A' }),
      datei('a_64kb.mp3', '64Kbps MP3', { title: 'A', length: 134, original: 'a.mp3' }),
    ]
    const inhalt = await plugin.inhalt('x', kontextMit(werkMit(dateien)))
    assert.match(inhalt.folgen[0].quelle.adresse, /\/a\.mp3$/, 'gespielt wird die VBR-Fassung')
    assert.equal(inhalt.folgen[0].dauerSek, 134, 'die Dauer kommt trotzdem an')
  })

  it('und der gemessene LibriVox-Fall bleibt richtig', async () => {
    const inhalt = await plugin.inhalt('faust', kontextMit(werkMit(librivoxSpur(1, 'Zueignung', 134))))
    assert.equal(inhalt.folgen[0].dauerSek, 134)
  })

  it('fehlt sie ueberall, ist das kein Fehler — die Kachel bleibt ohne Zahl', async () => {
    const ohne = [datei('a.mp3', 'VBR MP3', { title: 'A' })]
    const inhalt = await plugin.inhalt('x', kontextMit(werkMit(ohne)))
    assert.equal(inhalt.folgen[0].dauerSek, undefined)
    assert.equal(inhalt.folgen[0].name, 'A')
  })

  it('NaN gilt nicht als Dauer', async () => {
    const kaputt = [datei('a.mp3', '128Kbps MP3', { title: 'A', length: 'kaputt' })]
    const inhalt = await plugin.inhalt('x', kontextMit(werkMit(kaputt)))
    assert.equal(inhalt.folgen[0].dauerSek, undefined)
  })
})

describe('Ton heraussieben (Messung 3)', () => {
  beforeEach(() => zwischenspeicherLeeren())

  it('Bilder, Spektrogramme und Scans sind kein Ton', async () => {
    // Der gemessene Fall: 1038 Dateien, davon 345 PNG und 344 Spectrogram.
    const dateien = [
      datei('cover.png', 'PNG'),
      datei('a_spectrogram.png', 'Spectrogram'),
      datei('scan.pdf', 'Text PDF'),
      datei('meta.xml', 'Metadata'),
      datei('echt.mp3', '128Kbps MP3', { title: 'Echt', length: 60 }),
    ]
    const inhalt = await plugin.inhalt('x', kontextMit(werkMit(dateien)))
    assert.equal(inhalt.folgen.length, 1)
    assert.equal(inhalt.folgen[0].name, 'Echt')
  })

  it('LEER IST EIN ERGEBNIS: ein Werk aus lauter Scans ist kein Fehler', async () => {
    const inhalt = await plugin.inhalt('x', kontextMit(werkMit([datei('scan.pdf', 'Text PDF')])))
    assert.deepEqual(inhalt.folgen, [])
    assert.equal(inhalt.titel, 'Faust')
  })
})

describe('Ordnung und Auflösen', () => {
  beforeEach(() => zwischenspeicherLeeren())

  it('EINE HALBE SPURLISTE ordnet gar nicht — sonst rutscht das Spurlose nach vorn', async () => {
    /* AUCH DIESER ZEUGE WAR BLIND (Gegenprobe 22.08.2026). Mit zwei GLEICHEN
     * Spurnummern faellt der Vergleich ohnehin auf den Namen durch — ob der
     * Riegel `spurTaugt` greift, war daran nicht zu sehen.
     *
     * Der Fall, der ihn braucht, ist der GEMISCHTE: traegt ein Stueck eine
     * Spur und das andere keine, dann rechnet `a.spur - b.spur` mit null als
     * Null, und das Spurlose stuende vor Spur 5 — unabhaengig vom Namen.
     * Hier ist der Name die richtige Ordnung, und die Spur luegt. */
    const dateien = [
      datei('alpha.mp3', 'VBR MP3', { title: 'Alpha', track: '5' }),
      datei('zulu.mp3', 'VBR MP3', { title: 'Zulu' }),
    ]
    const inhalt = await plugin.inhalt('x', kontextMit(werkMit(dateien)))
    assert.deepEqual(inhalt.folgen.map((f) => f.name), ['Alpha', 'Zulu'])
  })

  it('und eine Spur, die alle teilen, ordnet auch nicht — der gemessene 341-Fall', async () => {
    const dateien = [
      datei('zulu.mp3', 'VBR MP3', { title: 'Zulu', track: '1' }),
      datei('alpha.mp3', 'VBR MP3', { title: 'Alpha', track: '1' }),
    ]
    const inhalt = await plugin.inhalt('x', kontextMit(werkMit(dateien)))
    assert.deepEqual(inhalt.folgen.map((f) => f.name), ['Alpha', 'Zulu'])
  })

  it('echte Spurnummern ordnen gegen den Namen', async () => {
    const dateien = [
      datei('b.mp3', 'VBR MP3', { title: 'Alpha', track: '2' }),
      datei('a.mp3', 'VBR MP3', { title: 'Zulu', track: '1' }),
    ]
    const inhalt = await plugin.inhalt('x', kontextMit(werkMit(dateien)))
    assert.deepEqual(inhalt.folgen.map((f) => f.name), ['Zulu', 'Alpha'])
  })

  it('aufloesen nimmt ohne # das erste Stueck, mit #n das n-te', async () => {
    const dateien = [...librivoxSpur(1, 'Eins', 10), ...librivoxSpur(2, 'Zwei', 20)]
    const erst = await plugin.aufloesen('faust', kontextMit(werkMit(dateien)))
    assert.equal(erst.titel.name, 'Eins')
    assert.equal(erst.quelle.art, 'strom')
    zwischenspeicherLeeren()
    const zweit = await plugin.aufloesen('faust#1', kontextMit(werkMit(dateien)))
    assert.equal(zweit.titel.name, 'Zwei')
    assert.equal(zweit.titel.dauerSek, 20)
  })

  it('ein Werk ohne Ton laesst sich nicht aufloesen — mit einem Satz, der es sagt', async () => {
    await assert.rejects(
      () => plugin.aufloesen('x', kontextMit(werkMit([datei('s.pdf', 'Text PDF')]))),
      /kein abspielbares Stueck/,
    )
  })

  it('UNBEKANNTES WERK: das Archiv liefert HTTP 200 mit {} — das ist ein Fehler, kein leeres Werk', async () => {
    // Wer nur auf den Status sieht, haelt ein unbekanntes Werk fuer ein leeres.
    await assert.rejects(() => plugin.inhalt('gibtsnicht', kontextMit([['/metadata/', {}]])), /kennt das Archiv nicht/)
  })
})

describe('Suche und Verwaltungsflaeche', () => {
  beforeEach(() => zwischenspeicherLeeren())

  const DOCS = [{ identifier: 'w1', title: 'Ein Hörspiel', creator: 'Wer', year: '1954', downloads: 99 }]

  it('die Suche liefert WERKE, nicht Einzelstuecke', async () => {
    const t = await plugin.suchen('hörspiel', kontextMit(sucheMit(DOCS)))
    assert.deepEqual(t, [{ name: 'Ein Hörspiel', kuenstler: 'Wer' }])
  })

  it('leerer Begriff geht gar nicht erst ins Netz', async () => {
    // Der gefaelschte Kontext WIRFT bei jeder Adresse — kaeme eine Anfrage
    // heraus, waere dieser Test rot statt gruen.
    const t = await plugin.suchen('   ', kontextMit([]))
    assert.deepEqual(t, [])
  })

  it('`creator` kommt mal als Liste — beides gesehen, beides muss gehen', async () => {
    const t = await plugin.suchen('x', kontextMit(sucheMit([{ identifier: 'w', title: 'T', creator: ['A', 'B'] }])))
    assert.equal(t[0].kuenstler, 'A')
  })

  it('die Einstellungen reisen in die Sucheadresse: Sprache und Trefferzahl', async () => {
    let gesehen = ''
    const kontext = {
      protokoll: () => {},
      einstellungen: Object.freeze({ sprache: 'ger', treffer: 7 }),
      holen: async (adresse) => {
        gesehen = String(adresse)
        return { ok: true, json: async () => ({ response: { numFound: 0, docs: [] } }) }
      },
    }
    await plugin.suchen('faust', kontext)
    assert.match(gesehen, /language%3Ager/, 'die Sprache steht in der Abfrage')
    assert.match(gesehen, /rows=7/, 'die Trefferzahl auch')
    assert.match(gesehen, /mediatype%3Aaudio/, 'und der Ton-Filter immer')
  })

  it('http/suche reicht den fertigen data.json-Vorschlag durch', async () => {
    const a = await plugin.http({ methode: 'GET', pfad: 'suche', abfrage: { q: 'x' }, rumpf: null }, kontextMit(sucheMit(DOCS, 4552)))
    assert.equal(a.inhalt.gesamt, 4552)
    /* DIE FORM, DIE DER KERN SEIT E87 VERSTEHT. Bis dahin stand hier
     * `type: 'mixpi-archive'`, und das war eine Kachel, die nicht spielt:
     * `dienstVon()` machte daraus `anderes`. Jetzt `type: 'plugin'` mit der
     * VOLLEN Medienkennung in `id` — daraus baut `medienSchluessel()` ohne
     * Zutun `plugin:mixpi-archive:w1`. */
    assert.deepEqual(a.inhalt.werke[0].vorschlag, {
      type: 'plugin',
      category: 'audiobook',
      id: 'mixpi-archive:w1',
      title: 'Ein Hörspiel',
      artist: 'Wer',
      cover: 'https://archive.org/download/w1/__ia_thumb.jpg',
    })
  })

  it('die Kennung im Vorschlag ist die, die `/api/plugins/spielen` annimmt', () => {
    // Der Doppelpunkt trennt Plugin von Rest — `kennungZerlegen` im Kern
    // teilt am ERSTEN. Stuende hier nur `w1`, waere der Eintrag unauflösbar.
    const i = 'mixpi-archive:w1'.indexOf(':')
    assert.equal('mixpi-archive:w1'.slice(0, i), 'mixpi-archive')
    assert.equal('mixpi-archive:w1'.slice(i + 1), 'w1')
  })

  it('http/werk nennt die LIZENZ — das Archiv haelt auch Nicht-Gemeinfreies', async () => {
    const antwort = werkMit([datei('a.mp3', 'VBR MP3', { title: 'A' })], {
      licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    })
    const a = await plugin.http({ methode: 'GET', pfad: 'werk/w1', abfrage: {}, rumpf: null }, kontextMit(antwort))
    assert.equal(a.inhalt.lizenz, 'https://creativecommons.org/publicdomain/mark/1.0/')
    assert.equal(a.inhalt.stuecke[0].nr, 0)
  })

  it('nur GET, und ein unbekannter Pfad ist ein 404 mit Begruendung', async () => {
    const post = await plugin.http({ methode: 'POST', pfad: 'suche', abfrage: {}, rumpf: null }, kontextMit([]))
    assert.equal(post.status, 405)
    const weg = await plugin.http({ methode: 'GET', pfad: 'quatsch', abfrage: {}, rumpf: null }, kontextMit([]))
    assert.equal(weg.status, 404)
  })
})

describe('die KENNUNG je Folge (E87)', () => {
  beforeEach(() => zwischenspeicherLeeren())

  /* DIESER ZEUGE FEHLTE, UND DAS HAT GEKOSTET. Bis zum 22.08.2026 gab
   * `inhalt()` die Folgen OHNE `kennung` zurueck. Das Plugin war gruen, seine
   * 22 Zeugen waren gruen — und `inhaltPruefen` im Kern haette jede einzelne
   * Folge STILL uebergangen („Folge ohne Kennung uebergangen"). Die Kachel
   * haette eine leere Liste gezeigt, ohne dass irgendwo ein Fehler stand.
   *
   * Gefunden wurde es nicht vom Plugin-Zeugen, sondern beim Schreiben des
   * NAHT-Zeugen gegen den echten Kern. Genau dafuer gibt es ihn. */
  it('jede Folge traegt eine Kennung — ohne sie uebergeht der Kern sie STILL', async () => {
    const dateien = [...librivoxSpur(1, 'Eins', 10), ...librivoxSpur(2, 'Zwei', 20)]
    const inhalt = await plugin.inhalt('faust', kontextMit(werkMit(dateien)))
    for (const f of inhalt.folgen) {
      assert.ok(f.kennung, `Folge "${f.name}" ohne Kennung`)
    }
  })

  it('die Kennung ist die QUELLDATEI, nicht die gespielte Fassung', async () => {
    // `original` zeigt von jeder Ableitung auf dieselbe Quelle. Naehme man
    // den Namen der gespielten Fassung, aenderte sich die Kennung — und mit
    // ihr der Verlauf —, sobald das Archiv eine Fassung nachliefert.
    const inhalt = await plugin.inhalt('faust', kontextMit(werkMit(librivoxSpur(1, 'Eins', 10))))
    assert.equal(inhalt.folgen[0].kennung, 'faust1_01_goethe.mp3')
    assert.match(inhalt.folgen[0].quelle.adresse, /faust1_01_goethe_128kb\.mp3$/)
  })

  it('sie ist je Werk EINDEUTIG — sonst faellt die zweite Folge heraus', async () => {
    // `inhaltPruefen` wirft Dubletten weg: „steht doppelt drin".
    const dateien = [...librivoxSpur(1, 'Eins', 10), ...librivoxSpur(2, 'Zwei', 20)]
    const inhalt = await plugin.inhalt('faust', kontextMit(werkMit(dateien)))
    const kennungen = inhalt.folgen.map((f) => f.kennung)
    assert.equal(new Set(kennungen).size, kennungen.length)
  })
})
