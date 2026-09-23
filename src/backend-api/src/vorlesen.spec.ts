import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EINSTELLUNGEN_VORGABE,
  STIMME_VORGABE,
  cacheName,
  einstellungenNormalisieren,
  ersatzStimme,
  lernTrennung,
  silbenSprechText,
  silbenText,
  silbenWort,
  sprechText,
  stimmeErlaubt,
  stimmeIdGueltig,
  stimmeZerlegen,
  stimmenAusDateien,
} from './vorlesen'

/** Was auf der Box liegt, sagt sonst das Dateisystem - hier sagen wir es. */
const DA = ['de_DE-ramona-low', 'de_DE-thorsten-medium', 'en_US-amy-medium', 'vi_VN-vais1000-medium']

const E = EINSTELLUNGEN_VORGABE

describe('silbenWort — Sprechsilben, wie sie in der ersten Klasse geuebt werden', () => {
  it('trennt bei zwei Mitlauten dazwischen den letzten ab', () => {
    // "Fens-ter", nicht "Fen-ster": st ist seit 1996 trennbar.
    assert.deepEqual(silbenWort('Fenster'), ['Fens', 'ter'])
    assert.deepEqual(silbenWort('Wasser'), ['Was', 'ser'])
    assert.deepEqual(silbenWort('Katze'), ['Kat', 'ze'])
  })

  it('schiebt einen einzelnen Mitlaut in die naechste Silbe', () => {
    assert.deepEqual(silbenWort('Vater'), ['Va', 'ter'])
    assert.deepEqual(silbenWort('Ananas'), ['A', 'na', 'nas'])
  })

  it('haelt ck zusammen und zieht es mit', () => {
    // Nach der Reform "Zu-cker", nicht mehr "Zuk-ker".
    assert.deepEqual(silbenWort('Zucker'), ['Zu', 'cker'])
  })

  it('trennt tz und ng, obwohl beide einen Laut schreiben', () => {
    // Duden trennt hier - genau deshalb stehen sie NICHT in den Mitlautpaaren.
    assert.deepEqual(silbenWort('Finger'), ['Fin', 'ger'])
    assert.deepEqual(silbenWort('Mütze'), ['Müt', 'ze'])
  })

  it('haelt sch und ch zusammen', () => {
    assert.deepEqual(silbenWort('Fischer'), ['Fi', 'scher'])
    assert.deepEqual(silbenWort('Mädchen'), ['Mäd', 'chen'])
    assert.deepEqual(silbenWort('waschen'), ['wa', 'schen'])
  })

  it('behandelt das H als Silbenanfang, nicht als Dehnung', () => {
    // Der Stolperstein: zaehlte man "eh" als Silbenkern, kaeme "geh-en" heraus.
    assert.deepEqual(silbenWort('gehen'), ['ge', 'hen'])
    assert.deepEqual(silbenWort('sehen'), ['se', 'hen'])
    // Dehnungs-H am Wortende stoert dabei nicht, es gibt nur einen Kern.
    assert.deepEqual(silbenWort('Mehl'), ['Mehl'])
  })

  it('erkennt Selbstlautpaare als EINEN Kern', () => {
    assert.deepEqual(silbenWort('Biene'), ['Bie', 'ne'])
    assert.deepEqual(silbenWort('Eimer'), ['Ei', 'mer'])
    assert.deepEqual(silbenWort('Beeren'), ['Bee', 'ren'])
  })

  it('trennt zwischen zwei Kernen ohne Mitlaut dazwischen', () => {
    assert.deepEqual(silbenWort('Feuerwehr'), ['Feu', 'er', 'wehr'])
    assert.deepEqual(silbenWort('Station'), ['Sta', 'ti', 'on'])
  })

  it('haelt qu zusammen — das U ist dort kein Silbenkern', () => {
    assert.deepEqual(silbenWort('Quelle'), ['Quel', 'le'])
  })

  it('laesst kurze Woerter und Woerter mit einem Kern in Ruhe', () => {
    assert.deepEqual(silbenWort('Oma'), ['Oma'])
    assert.deepEqual(silbenWort('Baum'), ['Baum'])
    assert.deepEqual(silbenWort('2024'), ['2024'])
    assert.deepEqual(silbenWort(''), [''])
  })

  it('trennt echte Albumnamen richtig', () => {
    assert.deepEqual(silbenWort('Lumpenpack'), ['Lum', 'pen', 'pack'])
    assert.deepEqual(silbenWort('Kinderlieder'), ['Kin', 'der', 'lie', 'der'])
    assert.deepEqual(silbenWort('Zukunft'), ['Zu', 'kunft'])
    assert.deepEqual(silbenWort('Einhorn'), ['Ein', 'horn'])
  })

  it('liegt bei zusammengesetzten Woertern daneben — das ist bekannt und gewollt festgehalten', () => {
    // "Pum-mel-ein-horn" waere richtig. Die Regel kennt die Fuge nicht und
    // schiebt das einzelne L weiter. Wer das braucht, stellt es am Eintrag
    // von Hand richtig (Feld "silben") - siehe lernTrennung.
    assert.deepEqual(silbenWort('Pummeleinhorn'), ['Pum', 'me', 'lein', 'horn'])
  })
})

describe('silbenText', () => {
  it('trennt jedes Wort und laesst Leer- und Satzzeichen stehen', () => {
    assert.equal(silbenText('Das Lumpenpack'), 'Das Lum-pen-pack')
    assert.equal(silbenText('Kinderlieder, Teil 2'), 'Kin-der-lie-der, Teil 2')
  })

  it('zerlegt einen vorhandenen Bindestrich nicht doppelt', () => {
    assert.equal(silbenText('Rock-Musik'), 'Rock-Mu-sik')
  })

  it('gibt bei leerer Eingabe leer zurueck', () => {
    assert.equal(silbenText(''), '')
    assert.equal(silbenText('   '), '')
    assert.equal(silbenText(null as unknown as string), '')
  })
})

describe('silbenSprechText — Silben mit Pause sprechen', () => {
  it('macht aus Bindestrichen Kommas, weil Piper einen Bindestrich ueberliest', () => {
    assert.equal(silbenSprechText('Lumpenpack'), 'Lum, pen, pack')
  })
})

describe('sprechText — was zu einer Kachel gesagt wird', () => {
  it('spricht ohne Interpret nur den Titel', () => {
    assert.equal(sprechText({ title: 'Pummeleinhorn', artist: 'andrea' }, E), 'Pummeleinhorn')
  })

  it('nimmt den Interpret dazu, wenn er eingeschaltet ist', () => {
    const e = { ...E, interpret: true }
    assert.equal(sprechText({ title: 'Nackt', artist: 'Bosse' }, e), 'Nackt, von Bosse')
  })

  it('laesst einen Interpret weg, der schon im Titel steckt', () => {
    // "Bosse, von Bosse" waere Unsinn.
    const e = { ...E, interpret: true }
    assert.equal(sprechText({ title: 'Bosse Live', artist: 'Bosse' }, e), 'Bosse Live')
    assert.equal(sprechText({ title: 'Nackt', artist: 'Nackt Deluxe' }, e), 'Nackt')
  })

  it('kommt ohne Interpret und ohne Titel zurecht', () => {
    const e = { ...E, interpret: true }
    assert.equal(sprechText({ title: 'Nackt' }, e), 'Nackt')
    assert.equal(sprechText({ title: '   ' }, e), '')
    assert.equal(sprechText({}, e), '')
  })
})

describe('lernTrennung — Hand schlaegt Regel', () => {
  it('nimmt die von Hand gesetzte Trennung', () => {
    const e = { title: 'Pummeleinhorn', silben: 'Pum-mel-ein-horn' }
    assert.equal(lernTrennung(e), 'Pum-mel-ein-horn')
  })

  it('faellt ohne Handarbeit auf die Regeln zurueck', () => {
    assert.equal(lernTrennung({ title: 'Lumpenpack' }), 'Lum-pen-pack')
    assert.equal(lernTrennung({ title: 'Lumpenpack', silben: '   ' }), 'Lum-pen-pack')
  })
})

describe('einstellungenNormalisieren — kaputte Vorgaben biegen, nicht abstuerzen', () => {
  it('nimmt gueltige Werte an', () => {
    const e = einstellungenNormalisieren({
      modus: 'lernen',
      stimme: 'de_DE-thorsten-medium',
      interpret: true,
      tempo: 1.4,
    })
    assert.deepEqual(e, { modus: 'lernen', stimme: 'de_DE-thorsten-medium', interpret: true, tempo: 1.4 })
  })

  it('schaltet bei unbekanntem Modus ab — im Zweifel schweigt die Box', () => {
    assert.equal(einstellungenNormalisieren({ modus: 'quatsch' }).modus, 'aus')
    assert.equal(einstellungenNormalisieren(null).modus, 'aus')
    assert.equal(einstellungenNormalisieren(undefined).modus, 'aus')
  })

  it('weist eine Stimme ab, die nicht auf der Box liegt', () => {
    // Der Name landet in einem Dateipfad. "../../etc/passwd" darf dort nie
    // ankommen, und eine Stimme, die es nicht gibt, koennte ohnehin nicht
    // sprechen - die erste Pruefung faengt die Form, die zweite die Wirklichkeit.
    assert.equal(einstellungenNormalisieren({ stimme: '../../etc/passwd' }, DA).stimme, STIMME_VORGABE)
    assert.equal(einstellungenNormalisieren({ stimme: 'de_DE-gibtesnicht-low' }, DA).stimme, STIMME_VORGABE)
    assert.equal(einstellungenNormalisieren({ stimme: '' }, DA).stimme, STIMME_VORGABE)
  })

  it('nimmt eine nachgeladene Stimme an, sobald sie auf der Box liegt', () => {
    // Genau dafuer kommt die Liste von aussen: neue Stimme, kein Code.
    assert.equal(einstellungenNormalisieren({ stimme: 'vi_VN-vais1000-medium' }, DA).stimme, 'vi_VN-vais1000-medium')
  })

  it('behaelt eine gespeicherte Stimme, solange niemand die Liste kennt', () => {
    // Beim Start ist das Verzeichnis noch nicht gelesen. Die Einstellung darf
    // dabei nicht stillschweigend auf die Vorgabe zurueckfallen.
    assert.equal(einstellungenNormalisieren({ stimme: 'en_US-amy-medium' }).stimme, 'en_US-amy-medium')
  })

  it('haelt das Tempo im sinnvollen Bereich', () => {
    assert.equal(einstellungenNormalisieren({ tempo: 0.1 }).tempo, E.tempo)
    assert.equal(einstellungenNormalisieren({ tempo: 9 }).tempo, E.tempo)
    assert.equal(einstellungenNormalisieren({ tempo: 'schnell' }).tempo, E.tempo)
    assert.equal(einstellungenNormalisieren({ tempo: 0.8 }).tempo, 0.8)
  })

  it('ist von Haus aus ausgeschaltet', () => {
    assert.equal(E.modus, 'aus')
  })
})

describe('stimmeIdGueltig — die Schranke zum Dateisystem', () => {
  it('nimmt Piper-Namen an, auch nachgeladene Sprachen', () => {
    assert.equal(stimmeIdGueltig('de_DE-ramona-low'), true)
    assert.equal(stimmeIdGueltig('vi_VN-vais1000-medium'), true)
    assert.equal(stimmeIdGueltig('en_GB-jenny_dioco-medium'), true)
    assert.equal(stimmeIdGueltig('de_DE-eva_k-x_low'), true)
  })

  it('weist alles ab, was ein Pfad werden koennte', () => {
    assert.equal(stimmeIdGueltig('../../etc/passwd'), false)
    assert.equal(stimmeIdGueltig('de_DE-ramona-low/../x'), false)
    assert.equal(stimmeIdGueltig('de_DE-ramona-low.onnx'), false)
    assert.equal(stimmeIdGueltig('de_DE-ramona-mittel'), false)
    assert.equal(stimmeIdGueltig(null), false)
    assert.equal(stimmeIdGueltig(42), false)
  })
})

describe('stimmenAusDateien — eine Stimme sind ZWEI Dateien', () => {
  it('zaehlt eine vollstaendige Stimme', () => {
    assert.deepEqual(stimmenAusDateien(['de_DE-ramona-low.onnx', 'de_DE-ramona-low.onnx.json']), [
      'de_DE-ramona-low',
    ])
  })

  it('zaehlt einen abgerissenen Download NICHT', () => {
    // DER FALL, DER DAS HIER NOETIG MACHT: das Modell sind 60 MB, die
    // Beschreibung 4 KB. Reisst die Leitung dazwischen ab, liegt nur die
    // .onnx da. Vorher meldete der Server sie als waehlbare Stimme, der
    // Abspieler sprach los, und jeder Versuch scheiterte still.
    assert.deepEqual(stimmenAusDateien(['de_DE-ramona-low.onnx']), [])
  })

  it('zaehlt eine Beschreibung ohne Modell ebenso wenig', () => {
    // Die andere Richtung: erst die 4 KB, dann Abbruch. Sieht harmloser aus,
    // waere aber genauso eine Stimme, die es nicht gibt.
    assert.deepEqual(stimmenAusDateien(['de_DE-ramona-low.onnx.json']), [])
  })

  it('laesst die heile Stimme uebrig, wenn nur EINE halb da ist', () => {
    // Genau der Fall, den die Verwaltung zeigen muss: eine Stimme geht,
    // die andere nicht - und nicht "beide" oder "keine".
    assert.deepEqual(
      stimmenAusDateien([
        'de_DE-thorsten-medium.onnx',
        'de_DE-ramona-low.onnx',
        'de_DE-ramona-low.onnx.json',
      ]),
      ['de_DE-ramona-low'],
    )
  })

  it('sortiert und laesst Fremdes im Verzeichnis liegen', () => {
    assert.deepEqual(
      stimmenAusDateien([
        'en_US-amy-medium.onnx.json',
        'LIESMICH.txt',
        'en_US-amy-medium.onnx',
        'de_DE-ramona-low.onnx.json',
        'de_DE-ramona-low.onnx',
      ]),
      ['de_DE-ramona-low', 'en_US-amy-medium'],
    )
  })

  it('haelt die Schranke zum Dateisystem auch hier', () => {
    // Ein Name, der kein Piper-Name ist, kommt nicht durch - auch dann
    // nicht, wenn jemand beide Dateien passend hinlegt.
    assert.deepEqual(stimmenAusDateien(['../../etc/passwd.onnx', '../../etc/passwd.onnx.json']), [])
  })

  it('kommt mit einem leeren Verzeichnis zurecht', () => {
    assert.deepEqual(stimmenAusDateien([]), [])
  })
})

describe('stimmeZerlegen — Namen, die man einem Menschen zeigen kann', () => {
  it('macht aus dem Kuerzel Sprache, Name und Guete', () => {
    assert.deepEqual(stimmeZerlegen('de_DE-ramona-low'), {
      id: 'de_DE-ramona-low',
      sprache: 'de_DE',
      spracheName: 'Deutsch',
      name: 'Ramona',
      guete: 'einfach',
    })
  })

  it('benennt auch die nachgeladenen Sprachen', () => {
    assert.equal(stimmeZerlegen('en_US-amy-medium')?.spracheName, 'Englisch')
    assert.equal(stimmeZerlegen('vi_VN-vais1000-medium')?.spracheName, 'Vietnamesisch')
    assert.equal(stimmeZerlegen('vi_VN-vais1000-medium')?.guete, 'mittel')
  })

  it('laesst eine unbekannte Sprache bei ihrem Kuerzel, statt zu raten', () => {
    assert.equal(stimmeZerlegen('xy_ZZ-neu-low')?.spracheName, 'xy_ZZ')
  })

  it('gibt null bei einem Namen, der nicht passt', () => {
    assert.equal(stimmeZerlegen('quatsch'), null)
    assert.equal(stimmeZerlegen('../../etc/passwd'), null)
  })
})

describe('stimmeErlaubt — Form UND Wirklichkeit', () => {
  it('laesst nur durch, was auf der Box liegt', () => {
    for (const s of DA) assert.equal(stimmeErlaubt(s, DA), true)
    assert.equal(stimmeErlaubt('de_DE-kerstin-low', DA), false)
    assert.equal(stimmeErlaubt(null, DA), false)
  })

  it('reicht eine gut geformte, aber fehlende Stimme nicht durch', () => {
    assert.equal(stimmeErlaubt('fr_FR-siwis-medium', DA), false)
  })
})

describe('ersatzStimme — lieber fremd sprechen als schweigen', () => {
  it('nimmt die Vorgabe, wenn sie da ist', () => {
    assert.equal(ersatzStimme(DA), STIMME_VORGABE)
    assert.equal(E.stimme, 'de_DE-ramona-low')
  })

  it('nimmt sonst eine deutsche Stimme', () => {
    assert.equal(ersatzStimme(['en_US-amy-medium', 'de_DE-thorsten-medium']), 'de_DE-thorsten-medium')
  })

  it('nimmt zur Not irgendeine — eine stumme Box sieht kaputt aus', () => {
    assert.equal(ersatzStimme(['vi_VN-vais1000-medium']), 'vi_VN-vais1000-medium')
  })

  it('nennt die Vorgabe, solange nichts bekannt ist', () => {
    assert.equal(ersatzStimme([]), STIMME_VORGABE)
  })
})

describe('cacheName', () => {
  it('gibt fuer denselben Text denselben Namen', () => {
    assert.equal(cacheName('Lumpenpack', E), cacheName('Lumpenpack', E))
  })

  it('unterscheidet nach Stimme und Tempo', () => {
    // Sonst hoerte man nach einem Stimmwechsel die alte Stimme aus dem Speicher.
    const andere = { ...E, stimme: 'de_DE-thorsten-medium' }
    const langsamer = { ...E, tempo: 1.5 }
    assert.notEqual(cacheName('Lumpenpack', E), cacheName('Lumpenpack', andere))
    assert.notEqual(cacheName('Lumpenpack', E), cacheName('Lumpenpack', langsamer))
  })

  it('unterscheidet verschiedene Texte', () => {
    assert.notEqual(cacheName('Lumpenpack', E), cacheName('Pummeleinhorn', E))
  })

  it('erzeugt einen Namen ohne Pfadanteile', () => {
    const n = cacheName('../../etc/passwd', E)
    assert.match(n, /^[0-9a-f]{8}-\d+\.wav$/)
  })
})
