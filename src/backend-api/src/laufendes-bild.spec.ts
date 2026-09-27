import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { bildFuerLaufendes, istBoxAdresse, namensKern } from './laufendes-bild'

const KARTE = new Map([
  ['bennyblu|dieritter', '/cover/audiobook/Benny Blu/Die Ritter/cover.jpg'],
  ['wdr|quarkssciencecops', '/cover/audiobook/WDR/Quarks Science Cops/cover.jpg'],
])

const LAEUFT = { playing: true }

describe('namensKern — wortgleich zum Frontend', () => {
  it('wirft alles ausser Buchstaben und Ziffern weg, auch Leerzeichen', () => {
    assert.equal(namensKern('Die Ritter'), 'dieritter')
    assert.equal(namensKern('Quarks Science Cops'), 'quarkssciencecops')
  })

  it('macht die sanitisierte Schreibweise dem Original gleich', () => {
    // DER BEFUND VOM 31.08.2026: der Abspieldienst meldet „Guten Morgen _
    // Good Morning", das Werk traegt den Schraegstrich. Beide muessen
    // denselben Kern ergeben, sonst findet die Karte nie etwas.
    assert.equal(namensKern('Guten Morgen _ Good Morning'), namensKern('Guten Morgen / Good Morning'))
  })

  it('nimmt null und undefined, ohne zu werfen', () => {
    assert.equal(namensKern(null), '')
    assert.equal(namensKern(undefined), '')
  })
})

describe('bildFuerLaufendes — lokal geht vor Dienst', () => {
  it('findet ueber den Pfad', () => {
    const b = bildFuerLaufendes({ ...LAEUFT, path: 'audiobook/Benny Blu/Die Ritter/01.flac' }, null, KARTE)
    assert.equal(b, '/cover/audiobook/Benny Blu/Die Ritter/cover.jpg')
  })

  it('findet ueber das Feld album als ALBUM gelesen', () => {
    const b = bildFuerLaufendes({ ...LAEUFT, album: 'Die Ritter' }, null, KARTE)
    assert.equal(b, '/cover/audiobook/Benny Blu/Die Ritter/cover.jpg')
  })

  it('findet ueber das Feld album als INTERPRET gelesen — so faellt es bei Jellyfin an', () => {
    const b = bildFuerLaufendes({ ...LAEUFT, album: 'WDR' }, null, KARTE)
    assert.equal(b, '/cover/audiobook/WDR/Quarks Science Cops/cover.jpg')
  })

  it('nimmt das lokale Bild, OBWOHL der Dienst auch eines haette', () => {
    // Die Reihenfolge ist die Entscheidung: was die Box selbst hat, laeuft
    // ohne Netz, ohne Konto und ohne Verfallsdatum.
    const dienst = { item: { album: { images: [{ url: 'https://i.scdn.co/image/xyz' }] } } }
    const b = bildFuerLaufendes({ ...LAEUFT, path: 'audiobook/Benny Blu/Die Ritter/01.flac' }, dienst, KARTE)
    assert.equal(b, '/cover/audiobook/Benny Blu/Die Ritter/cover.jpg')
  })
})

describe('bildFuerLaufendes — ein stehengebliebener Pfad ist kein laufender Titel', () => {
  it('uebergeht den lokalen Stand, wenn nichts laeuft', () => {
    // `/local` behaelt nach dem Stoppen seine Felder. Ohne diese Pruefung
    // zeigte der Schirm das zuletzt gehoerte Album, waehrend der Dienst
    // laengst etwas anderes spielt — derselbe Fehler wie E138 bei den Pegeln.
    const lokal = { playing: false, path: 'audiobook/Benny Blu/Die Ritter/01.flac' }
    const dienst = { item: { album: { images: [{ url: 'https://i.scdn.co/image/xyz' }] } } }
    assert.equal(bildFuerLaufendes(lokal, dienst, KARTE), 'https://i.scdn.co/image/xyz')
  })

  it('ein Titelname allein zaehlt als laufend — pausiert ist nicht gestoppt', () => {
    const lokal = { playing: false, currentTrackname: '01 Kapitel', path: 'audiobook/Benny Blu/Die Ritter/01.flac' }
    assert.equal(bildFuerLaufendes(lokal, null, KARTE), '/cover/audiobook/Benny Blu/Die Ritter/cover.jpg')
  })
})

describe('bildFuerLaufendes — der Episoden-Fall (Betreiber 11.09.2026)', () => {
  it('findet das Bild, wenn album fehlt und nur item.images da ist', () => {
    // AM GERAET GEMESSEN, „Quarks Science Cops": bei
    // currently_playing_type 'episode' ist `album` NICHT DA.
    const dienst = { item: { album: null, images: [{ url: 'https://i.scdn.co/image/episode' }] } }
    assert.equal(bildFuerLaufendes(null, dienst, new Map()), 'https://i.scdn.co/image/episode')
  })

  it('findet es auch, wenn nur show.images da ist', () => {
    const dienst = { item: { album: null, images: null, show: { images: [{ url: 'https://i.scdn.co/image/show' }] } } }
    assert.equal(bildFuerLaufendes(null, dienst, new Map()), 'https://i.scdn.co/image/show')
  })

  it('DIE GEGENPROBE: nur album zu lesen wuerde hier nichts finden', () => {
    // Dieser Zeuge haelt fest, WARUM es drei Orte sind. Faellt jemand auf
    // einen Zugriff zurueck, faellt dieser Test — und zwar mit der
    // Begruendung, nicht nur mit einer Zahl.
    const dienst = { item: { album: null, images: [{ url: 'https://i.scdn.co/image/episode' }] } }
    assert.equal(dienst.item.album, null, 'eine Episode hat kein Album — das ist die Lage')
    assert.notEqual(bildFuerLaufendes(null, dienst, new Map()), '')
  })

  it('ueberspringt leere Adressen in der Liste, statt sie zurueckzugeben', () => {
    const dienst = { item: { images: [{ url: '' }, { url: '   ' }, { url: 'https://i.scdn.co/image/drittes' }] } }
    assert.equal(bildFuerLaufendes(null, dienst, new Map()), 'https://i.scdn.co/image/drittes')
  })
})

describe('bildFuerLaufendes — wenn es nichts gibt', () => {
  it('gibt leer zurueck statt zu werfen', () => {
    assert.equal(bildFuerLaufendes(null, null, new Map()), '')
    assert.equal(bildFuerLaufendes({}, {}, new Map()), '')
    assert.equal(bildFuerLaufendes({ ...LAEUFT, path: 'nichts/dabei' }, null, KARTE), '')
  })

  it('haelt kaputte Formen aus — images ist kein Array, item ist null', () => {
    assert.equal(bildFuerLaufendes(null, { item: null }, new Map()), '')
    assert.equal(bildFuerLaufendes(null, { item: { images: 'kaputt' } } as never, new Map()), '')
  })
})

describe('istBoxAdresse — eine Umleitung darf nur nach innen zeigen', () => {
  it('erkennt boxeigene Adressen', () => {
    assert.equal(istBoxAdresse('/cover/audiobook/X/Y/cover.jpg'), true)
  })

  it('erkennt Dienstadressen als fremd', () => {
    // Ein 302 auf i.scdn.co machte den Browser zum Spotify-Client und braeche
    // denselben Vertrag, nur eine Ebene tiefer.
    assert.equal(istBoxAdresse('https://i.scdn.co/image/xyz'), false)
    assert.equal(istBoxAdresse('https://api.ardmediathek.de/image-service/x'), false)
    assert.equal(istBoxAdresse(''), false)
  })
})

describe('namensKern steht an ZWEI Orten — sie muessen gleich bleiben', () => {
  it('die Fassung in NewDesign/app.js ist zeichengleich', () => {
    // WARUM ALS TEST UND NICHT ALS VORSATZ: Der erste Entwurf dieser Datei
    // trug einen namensKern AUS DEM GEDAECHTNIS — er machte Trennzeichen zu
    // Leerzeichen statt sie zu werfen. Fuer jeden mehrteiligen Namen haette
    // er einen anderen Schluessel gebildet als das Frontend, und die
    // Coverkarte waere still leergelaufen: kein Fehler, keine Meldung, nur
    // nie ein Treffer. Ein Zwilling, der auseinanderlaeuft, braucht eine
    // Wache, keinen guten Willen.
    // OHNE __dirname: diese Suite laeuft als ES-Modul (`npm test` ruft tsx),
    // dort gibt es das nicht — und `import.meta.url` waere ein zweiter
    // Stolperstein, sobald jemand nach CJS zurueckbaut. Der Aufrufort ist
    // ausserdem nicht fest: `npm test` startet in src/backend-api/, ein
    // Einzelaufruf von Hand in der Wurzel. Also beide Wege versuchen.
    const kandidaten = [
      join(process.cwd(), 'NewDesign', 'app.js'),
      join(process.cwd(), '..', '..', 'NewDesign', 'app.js'),
    ]
    const pfad = kandidaten.find((p) => existsSync(p))
    assert.ok(pfad, `NewDesign/app.js nicht gefunden, gesucht in:\n  ${kandidaten.join('\n  ')}`)
    const app = readFileSync(pfad, 'utf8')
    const stelle = app.indexOf('function namensKern(s) {')
    assert.notEqual(stelle, -1, 'namensKern in NewDesign/app.js nicht gefunden — wurde es umbenannt?')
    // NICHT BIS ZUR ERSTEN `}` SCHNEIDEN — die steht mitten im Muster, in
    // `\p{Letter}`. Der erste Entwurf tat genau das und schnitt sich damit
    // die Stelle ab, die er pruefen wollte: zwei Zusicherungen hielten, die
    // dritte fiel, und der Grund stand nirgends. Ein fester Ausschnitt ist
    // hier ehrlicher als ein Klammerzaehler, der dasselbe Problem haette.
    const koerper = app.slice(stelle, stelle + 400)
    assert.ok(koerper.includes("normalize('NFC')"), 'NFC fehlt im Frontend-Zwilling')
    assert.ok(koerper.includes('toLowerCase()'), 'toLowerCase fehlt im Frontend-Zwilling')
    assert.ok(
      koerper.includes('[^\\p{Letter}\\p{Number}]+'),
      'das Muster im Frontend-Zwilling ist ein anderes — hier nachziehen',
    )
  })
})
