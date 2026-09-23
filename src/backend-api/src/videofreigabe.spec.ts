/**
 * ZEUGEN FUER DIE VIDEOFREIGABE.
 *
 * Die teuren Faelle stehen zuerst: eine kaputte Datei darf nichts
 * AUFSPERREN, und eine doppelt gemeldete Sichtung darf nicht doppelt zaehlen.
 * Beides faellt im Betrieb erst auf, wenn ein Kind etwas geschaut hat, das es
 * nicht durfte — oder wenn die Belohnung nach einmal Schauen weg ist.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ANZAHL_MAX,
  entziehen,
  type Freigaben,
  finden,
  freigabeNormalisieren,
  freigabenNormalisieren,
  freigeben,
  fuerAntwort,
  fuerKind,
  geschnitten,
  idAus,
  laenge,
  leer,
  pluginPfad,
  QUELLE_VORGABE,
  stueckeVon,
  rest,
  restSetzen,
  SCHWELLE,
  urteilen,
  VIDEOS_MAX,
  verbrauchen,
  zahl,
} from './videofreigabe'

const JETZT = Date.parse('2026-09-20T10:00:00Z')
const MAUS = { kennung: 'Y3JpZDovL3dkci5kZS9hLWI=', name: 'Klima-Maus Teil 6', sendung: 'Die Maus' }

/** Ein Stand mit einem Video, `anzahl` Mal freigegeben. */
function standMit(anzahl = 3, verbraucht = 0): Freigaben {
  return freigabenNormalisieren({ videos: [{ ...MAUS, anzahl, verbraucht, angelegt: JETZT }] })
}

describe('freigabeNormalisieren — der Fehlerfall zeigt auf „gibt es nicht"', () => {
  it('nimmt eine vollstaendige Freigabe an', () => {
    const f = freigabeNormalisieren({ ...MAUS, anzahl: 3, bild: 'https://x/y.jpg', dauerSek: 1626 })
    assert.equal(f?.anzahl, 3)
    assert.equal(f?.verbraucht, 0)
    assert.equal(f?.bild, 'https://x/y.jpg')
  })

  it('weist ab, was keine Freigabe ist — jedes Stueck einzeln', () => {
    assert.equal(freigabeNormalisieren(null), null)
    assert.equal(freigabeNormalisieren('Y3JpZA=='), null)
    assert.equal(freigabeNormalisieren({ name: 'ohne Kennung', anzahl: 1 }), null)
    assert.equal(freigabeNormalisieren({ kennung: 'abc', anzahl: 1 }), null)
    assert.equal(freigabeNormalisieren({ ...MAUS }), null) // ohne anzahl
    assert.equal(freigabeNormalisieren({ ...MAUS, anzahl: 0 }), null)
    assert.equal(freigabeNormalisieren({ ...MAUS, anzahl: -1 }), null)
    assert.equal(freigabeNormalisieren({ ...MAUS, anzahl: ANZAHL_MAX + 1 }), null)
    assert.equal(freigabeNormalisieren({ ...MAUS, anzahl: 'viele' }), null)
  })

  it('laesst keine Kennung durch, die eine Adresse zerlegen koennte', () => {
    // DIE LAENGENGRENZE LIEGT SEIT DEM 20.09.2026 BEI 512 (vorher 256):
    // `mixpi-mediathekview` kodiert Sender, Sendung und Titel hinein.
    for (const k of ['../../etc/passwd', 'abc def', 'abc?x=1', 'abc#y', 'abc%2e%2e', 'a'.repeat(600), '']) {
      assert.equal(freigabeNormalisieren({ kennung: k, name: 'x', anzahl: 1 }), null, k)
    }
    // BASE64 DER ARD: Buchstaben, Ziffern, `+ / = _ -`. Der Schraegstrich
    // MUSS durch — eine echte Kennung sieht so aus:
    // „Y3JpZDovL3dkci5kZS9CZWl0cmFnLXNvcGhvcmEt…". Er ist deshalb kein
    // Wegtrenner, sondern ein Zeichen wie jedes andere, und jede Stelle, die
    // eine Kennung in eine Adresse setzt, MUSS sie kodieren
    // (`encodeURIComponent` in mixpi-mediathek, Rumpf statt Pfad im Kern).
    assert.notEqual(freigabeNormalisieren({ kennung: 'Y3JpZDovL3dk+/=_-', name: 'x', anzahl: 1 }), null)
    // Der Punkt fehlt in der Liste — und genau daran scheitert `..`.
    assert.equal(freigabeNormalisieren({ kennung: 'a.b', name: 'x', anzahl: 1 }), null)
  })

  it('wirft ein Bild weg, das keine http-Adresse ist — es landet in einem src', () => {
    for (const b of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///etc/passwd', '/lokal.jpg']) {
      assert.equal(freigabeNormalisieren({ ...MAUS, anzahl: 1, bild: b })?.bild, '', b)
    }
    assert.equal(freigabeNormalisieren({ ...MAUS, anzahl: 1, bild: 'https://x/y.jpg' })?.bild, 'https://x/y.jpg')
  })

  it('laesst den Verbrauch nie ueber die Anzahl steigen — sonst wird der Rest negativ', () => {
    const f = freigabeNormalisieren({ ...MAUS, anzahl: 2, verbraucht: 9 })
    assert.equal(f?.verbraucht, 2)
    assert.equal(rest(f), 0)
  })
})

describe('freigabenNormalisieren — ein kaputter Eintrag nimmt nicht die Liste mit', () => {
  it('liest die guten und laesst die kaputten weg', () => {
    const stand = freigabenNormalisieren({
      videos: [{ ...MAUS, anzahl: 1 }, null, { kaputt: true }, { kennung: 'ZZZ', name: 'Zweites', anzahl: 2 }],
    })
    assert.deepEqual(
      stand.videos.map((f) => f.kennung),
      [MAUS.kennung, 'ZZZ'],
    )
  })

  it('macht aus Unsinn eine leere Liste statt zu werfen', () => {
    assert.deepEqual(freigabenNormalisieren(null).videos, [])
    assert.deepEqual(freigabenNormalisieren({ videos: 'alles' }).videos, [])
    assert.deepEqual(freigabenNormalisieren([]).videos, [])
  })

  it('nimmt bei doppelter Kennung die erste — zwei Zaehler waeren zwei Wahrheiten', () => {
    const stand = freigabenNormalisieren({
      videos: [
        { ...MAUS, anzahl: 1, verbraucht: 1 },
        { ...MAUS, anzahl: 9, verbraucht: 0 },
      ],
    })
    assert.equal(stand.videos.length, 1)
    assert.equal(rest(stand.videos[0]), 0)
  })

  it('haelt den Deckel von VIDEOS_MAX', () => {
    const videos = Array.from({ length: VIDEOS_MAX + 10 }, (_, i) => ({ kennung: `k${i}`, name: `n${i}`, anzahl: 1 }))
    assert.equal(freigabenNormalisieren({ videos }).videos.length, VIDEOS_MAX)
  })
})

describe('urteilen', () => {
  it('erlaubt, was freigegeben ist und noch Rest hat', () => {
    assert.deepEqual(urteilen(standMit(3), MAUS.kennung), { erlaubt: true, grund: 'frei', rest: 3 })
  })

  it('unterscheidet „nicht freigegeben" von „aufgebraucht" — das Kind soll es hoeren', () => {
    assert.equal(urteilen(standMit(3), 'etwas-anderes').grund, 'unbekannt')
    assert.equal(urteilen(standMit(2, 2), MAUS.kennung).grund, 'aufgebraucht')
  })

  it('erlaubt in einer leeren Ablage gar nichts', () => {
    assert.equal(urteilen(leer(), MAUS.kennung).erlaubt, false)
  })
})

describe('freigeben', () => {
  it('legt ein Video an', () => {
    const { stand, ok } = freigeben(leer(), MAUS, 3, JETZT)
    assert.equal(ok, true)
    assert.equal(finden(stand, MAUS.kennung)?.anzahl, 3)
    assert.equal(finden(stand, MAUS.kennung)?.angelegt, JETZT)
  })

  it('legt bei einem schon freigegebenen NACH, statt eine zweite Kachel zu machen', () => {
    const a = freigeben(leer(), MAUS, 2, JETZT).stand
    const b = verbrauchen(a, MAUS.kennung, 'lauf-1', 1, JETZT).stand
    const c = freigeben(b, MAUS, 3, JETZT).stand
    assert.equal(c.videos.length, 1)
    // 2 freigegeben, 1 verbraucht, 3 nachgelegt -> noch 4 offen, 1 gelaufen.
    assert.equal(finden(c, MAUS.kennung)?.verbraucht, 1)
    assert.equal(rest(finden(c, MAUS.kennung)), 4)
  })

  it('weist eine unsinnige Anzahl ab, statt sie zu biegen', () => {
    assert.equal(freigeben(leer(), MAUS, 0, JETZT).ok, false)
    assert.equal(freigeben(leer(), MAUS, -3, JETZT).ok, false)
    assert.equal(freigeben(leer(), MAUS, ANZAHL_MAX + 1, JETZT).ok, false)
    assert.equal(freigeben(leer(), MAUS, Number.NaN, JETZT).ok, false)
  })

  it('weist ein Video ohne Namen ab', () => {
    assert.equal(freigeben(leer(), { kennung: 'abc', name: '' }, 1, JETZT).ok, false)
  })

  it('haelt den Deckel je Profil und laesst die Liste dabei unveraendert', () => {
    let stand = leer()
    for (let i = 0; i < VIDEOS_MAX; i++) stand = freigeben(stand, { kennung: `k${i}`, name: `n${i}` }, 1, JETZT).stand
    const voll = freigeben(stand, MAUS, 1, JETZT)
    assert.equal(voll.ok, false)
    assert.equal(voll.stand.videos.length, VIDEOS_MAX)
    // Nachlegen auf ein VORHANDENES geht auch bei voller Liste weiter.
    assert.equal(freigeben(voll.stand, { kennung: 'k0', name: 'n0' }, 1, JETZT).ok, true)
  })
})

describe('verbrauchen — die Schwelle und die doppelte Meldung', () => {
  it('zaehlt erst ab der Schwelle', () => {
    const stand = standMit(3)
    assert.equal(verbrauchen(stand, MAUS.kennung, 'l1', 0, JETZT).grund, 'zuWenigGesehen')
    assert.equal(verbrauchen(stand, MAUS.kennung, 'l1', 0.5, JETZT).grund, 'zuWenigGesehen')
    assert.equal(verbrauchen(stand, MAUS.kennung, 'l1', SCHWELLE - 0.01, JETZT).grund, 'zuWenigGesehen')
    assert.equal(verbrauchen(stand, MAUS.kennung, 'l1', SCHWELLE, JETZT).grund, 'gezaehlt')
    assert.equal(verbrauchen(stand, MAUS.kennung, 'l1', 1, JETZT).grund, 'gezaehlt')
  })

  it('ein Abbruch kostet NICHTS — die Liste kommt unveraendert zurueck', () => {
    const stand = standMit(3)
    const nach = verbrauchen(stand, MAUS.kennung, 'l1', 0.4, JETZT)
    assert.equal(nach.stand, stand)
    assert.equal(rest(finden(nach.stand, MAUS.kennung)), 3)
  })

  it('zaehlt dieselbe Laufkennung NICHT zweimal', () => {
    const eins = verbrauchen(standMit(3), MAUS.kennung, 'lauf-a', 1, JETZT)
    assert.equal(eins.grund, 'gezaehlt')
    assert.equal(eins.rest, 2)
    const zwei = verbrauchen(eins.stand, MAUS.kennung, 'lauf-a', 1, JETZT + 1000)
    assert.equal(zwei.grund, 'schonGezaehlt')
    assert.equal(zwei.rest, 2)
  })

  it('zaehlt einen NEUEN Lauf sehr wohl — zweimal anschauen kostet zweimal', () => {
    const eins = verbrauchen(standMit(3), MAUS.kennung, 'lauf-a', 1, JETZT)
    const zwei = verbrauchen(eins.stand, MAUS.kennung, 'lauf-b', 1, JETZT + 1000)
    assert.equal(zwei.grund, 'gezaehlt')
    assert.equal(zwei.rest, 1)
  })

  it('merkt sich den Zeitpunkt des letzten ganzen Durchlaufs', () => {
    const nach = verbrauchen(standMit(3), MAUS.kennung, 'l1', 1, JETZT)
    assert.equal(finden(nach.stand, MAUS.kennung)?.zuletzt, JETZT)
  })

  it('zaehlt nichts mehr, wenn schon alles verbraucht ist', () => {
    const nach = verbrauchen(standMit(1, 1), MAUS.kennung, 'l9', 1, JETZT)
    assert.equal(nach.grund, 'aufgebraucht')
    assert.equal(nach.rest, 0)
  })

  it('zaehlt nichts fuer ein Video, das gar nicht freigegeben ist', () => {
    assert.equal(verbrauchen(standMit(3), 'fremd', 'l1', 1, JETZT).grund, 'unbekannt')
  })
})

describe('fuerKind — was auf dem Kinderschirm steht', () => {
  it('zeigt nur, was noch laeuft', () => {
    const stand = freigabenNormalisieren({
      videos: [
        { ...MAUS, anzahl: 2, verbraucht: 2 },
        { kennung: 'offen', name: 'Noch da', anzahl: 1, verbraucht: 0 },
      ],
    })
    assert.deepEqual(
      fuerKind(stand).map((f) => f.kennung),
      ['offen'],
    )
    // Fuer die Eltern bleibt das aufgebrauchte stehen.
    assert.equal(stand.videos.length, 2)
  })
})

describe('restSetzen und entziehen', () => {
  it('setzt den REST, nicht die Gesamtzahl', () => {
    const stand = standMit(5, 2) // 5 freigegeben, 2 gesehen -> Rest 3
    const nach = restSetzen(stand, MAUS.kennung, 1)
    assert.equal(nach.ok, true)
    const f = finden(nach.stand, MAUS.kennung)
    assert.equal(rest(f), 1)
    assert.equal(f?.verbraucht, 2) // die Vergangenheit bleibt stehen
    assert.equal(f?.anzahl, 3)
  })

  it('macht mit 0 Schluss, ohne den Eintrag zu loeschen', () => {
    const nach = restSetzen(standMit(5, 2), MAUS.kennung, 0)
    assert.equal(rest(finden(nach.stand, MAUS.kennung)), 0)
    assert.equal(nach.stand.videos.length, 1)
    assert.equal(urteilen(nach.stand, MAUS.kennung).grund, 'aufgebraucht')
  })

  it('meldet ok:false fuer Unbekanntes und Unsinn, statt etwas zu erfinden', () => {
    assert.equal(restSetzen(standMit(3), 'fremd', 1).ok, false)
    assert.equal(restSetzen(standMit(3), MAUS.kennung, -1).ok, false)
    assert.equal(restSetzen(standMit(3), MAUS.kennung, ANZAHL_MAX + 1).ok, false)
  })

  it('entzieht, und meldet ein zweites Entziehen als ok:false', () => {
    const eins = entziehen(standMit(3), MAUS.kennung)
    assert.equal(eins.ok, true)
    assert.deepEqual(eins.stand.videos, [])
    assert.equal(entziehen(eins.stand, MAUS.kennung).ok, false)
  })
})

describe('Kleinkram, der sonst still schiefgeht', () => {
  it('zahl raet nicht, sondern meldet null', () => {
    assert.equal(zahl('3', 1, 9), 3)
    assert.equal(zahl(3.7, 1, 9), 3)
    assert.equal(zahl('drei', 1, 9), null)
    assert.equal(zahl(0, 1, 9), null)
    assert.equal(zahl(10, 1, 9), null)
    assert.equal(zahl(Number.POSITIVE_INFINITY, 1, 9), null)
    assert.equal(zahl(null, 1, 9), null)
  })

  it('fuerAntwort traegt den Rest mit, aber nicht die Laufkennung', () => {
    const nach = verbrauchen(standMit(3), MAUS.kennung, 'geheim-lauf', 1, JETZT)
    const f = finden(nach.stand, MAUS.kennung)
    assert.ok(f)
    const a = fuerAntwort(f)
    assert.equal(a.rest, 2)
    assert.ok(!JSON.stringify(a).includes('geheim-lauf'))
  })

  it('leer() liefert jedes Mal eine EIGENE Liste', () => {
    const a = leer()
    freigeben(a, MAUS, 1, JETZT)
    assert.deepEqual(a.videos, [])
    assert.notEqual(leer().videos, a.videos)
  })
})

describe('quelle — welches Plugin die Kennung aufloesen kann', () => {
  it('eine Freigabe ohne Quelle ist eine aus der Zeit vor den zwei Mediatheken', () => {
    // ALTE ABLAGEN KENNEN DAS FELD NICHT. Sie duerfen deshalb nicht wegfallen
    // — damals gab es nur die ARD, und genau das heisst die Vorgabe.
    const f = freigabeNormalisieren({ ...MAUS, anzahl: 1 })
    assert.equal(f?.quelle, QUELLE_VORGABE)
    assert.equal(QUELLE_VORGABE, 'mixpi-mediathek')
  })

  it('eine genannte Quelle bleibt stehen', () => {
    const f = freigabeNormalisieren({ ...MAUS, anzahl: 1, quelle: 'mixpi-mediathekview' })
    assert.equal(f?.quelle, 'mixpi-mediathekview')
  })

  it('was keine Plugin-Kennung ist, wird zur Vorgabe und NICHT zu einem Pfad', () => {
    // DER SCHADEN WAERE HIER EIN WEG AUS DEM PLUGIN-ORDNER HERAUS: die Quelle
    // steht spaeter in `/api/plugins/<quelle>/http/…`.
    for (const q of ['../../etc', 'mixpi/../x', 'MIT LEERZEICHEN', 'a', '-vorn', 'mixpi.x', 'x'.repeat(80), null]) {
      assert.equal(freigabeNormalisieren({ ...MAUS, anzahl: 1, quelle: q })?.quelle, QUELLE_VORGABE, String(q))
    }
    // DIE FORM IST NICHT DIE EXISTENZ: „42" ist eine formal gueltige
    // Plugin-Kennung und kommt hier durch. Dass es ein solches Plugin nicht
    // gibt, faellt im Server auf (`VIDEO_PLUGINS`) — diese Datei kennt keine
    // Plugin-Liste und soll auch keine bekommen.
    assert.equal(freigabeNormalisieren({ ...MAUS, anzahl: 1, quelle: 42 })?.quelle, '42')
  })

  it('Grossschreibung ist keine zweite Quelle', () => {
    assert.equal(freigabeNormalisieren({ ...MAUS, anzahl: 1, quelle: 'Mixpi-MediathekView' })?.quelle, 'mixpi-mediathekview')
  })

  it('freigeben merkt sich, wer geantwortet hat', () => {
    const a = freigeben(leer(), { ...MAUS, quelle: 'mixpi-mediathekview' }, 2, JETZT)
    assert.equal(finden(a.stand, MAUS.kennung)?.quelle, 'mixpi-mediathekview')
  })

  it('nachlegen aus einer anderen Mediathek zieht die Quelle mit', () => {
    // Dasselbe Video, diesmal woanders gefunden: die NEUE Quelle ist die, die
    // gerade nachweislich geantwortet hat.
    const a = freigeben(leer(), { ...MAUS, quelle: 'mixpi-mediathek' }, 1, JETZT)
    const b = freigeben(a.stand, { ...MAUS, quelle: 'mixpi-mediathekview' }, 1, JETZT)
    const f = finden(b.stand, MAUS.kennung)
    assert.equal(f?.quelle, 'mixpi-mediathekview')
    assert.equal(f?.anzahl, 2)
  })

  it('die Antwort nach aussen nennt die Quelle', () => {
    const f = freigabeNormalisieren({ ...MAUS, anzahl: 1, quelle: 'mixpi-mediathekview' })
    assert.equal(fuerAntwort(f!).quelle, 'mixpi-mediathekview')
  })
})

describe('Stuecke — ein Video, mehrere Belohnungen', () => {
  const GANZ = { ...MAUS, dauerSek: 1500, anzahl: 1 }
  const TEIL1 = { ...MAUS, dauerSek: 1500, anzahl: 1, abSek: 0, bisSek: 500, teil: 'Teil 1' }
  const TEIL2 = { ...MAUS, dauerSek: 1500, anzahl: 1, abSek: 500, bisSek: 1000, teil: 'Teil 2' }

  it('ein ganzes Video behaelt seine Kennung als Schluessel', () => {
    // DARAN HAENGT DIE VERGANGENHEIT: jede Ablage von vor dem 20.09.2026
    // kennt kein Feld `id`, und ihre Eintraege muessen weiter auffindbar
    // sein — ohne Wanderung, ohne Sonderfall.
    const f = freigabeNormalisieren(GANZ)
    assert.equal(f?.id, MAUS.kennung)
    assert.equal(idAus(MAUS.kennung, 0, 0), MAUS.kennung)
    assert.equal(geschnitten(f), false)
  })

  it('drei Stuecke desselben Videos sind drei Zeilen', () => {
    const stand = freigabenNormalisieren({ videos: [GANZ, TEIL1, TEIL2] })
    assert.equal(stand.videos.length, 3)
    assert.equal(new Set(stand.videos.map((v) => v.id)).size, 3)
    // Die Videokennung ist dabei dreimal dieselbe — sie ist die Adresse beim
    // Plugin, nicht der Schluessel der Liste.
    assert.equal(new Set(stand.videos.map((v) => v.kennung)).size, 1)
    assert.equal(stueckeVon(stand, MAUS.kennung).length, 3)
  })

  it('dasselbe Stueck noch einmal freigeben legt nach, statt eine zweite Kachel zu machen', () => {
    const a = freigeben(leer(), TEIL1, 2, JETZT)
    const b = freigeben(a.stand, TEIL1, 1, JETZT)
    assert.equal(b.stand.videos.length, 1)
    assert.equal(b.stand.videos[0].anzahl, 3)
  })

  it('ein ANDERER Schnitt desselben Videos ist eine eigene Zeile', () => {
    const a = freigeben(leer(), TEIL1, 1, JETZT)
    const b = freigeben(a.stand, TEIL2, 1, JETZT)
    assert.equal(b.stand.videos.length, 2)
  })

  it('entziehen nimmt NUR das gemeinte Stueck', () => {
    const stand = freigabenNormalisieren({ videos: [TEIL1, TEIL2] })
    const weg = entziehen(stand, idAus(MAUS.kennung, 0, 500))
    assert.equal(weg.ok, true)
    assert.equal(weg.stand.videos.length, 1)
    assert.equal(weg.stand.videos[0].teil, 'Teil 2')
  })

  it('die Laenge ist die des Stuecks und nicht die des Videos', () => {
    const stand = freigabenNormalisieren({ videos: [GANZ, TEIL1, TEIL2] })
    assert.equal(laenge(finden(stand, MAUS.kennung)), 1500)
    assert.equal(laenge(finden(stand, idAus(MAUS.kennung, 0, 500))), 500)
    assert.equal(laenge(finden(stand, idAus(MAUS.kennung, 500, 1000))), 500)
  })

  it('ein Schnitt ohne Ende laeuft bis zum Schluss des Videos', () => {
    const f = freigabeNormalisieren({ ...MAUS, dauerSek: 1500, anzahl: 1, abSek: 1200 })
    assert.equal(f?.bisSek, 0)
    assert.equal(laenge(f!), 300)
  })

  it('ein Ende VOR dem Anfang faellt weg, statt eine negative Laenge zu ergeben', () => {
    // Eine negative Laenge verdreht jede spaetere Rechnung — die Schwelle
    // waere sofort erreicht, und das Stueck verbrauchte sich beim Start.
    const f = freigabeNormalisieren({ ...MAUS, dauerSek: 1500, anzahl: 1, abSek: 800, bisSek: 300 })
    assert.equal(f?.bisSek, 0)
    assert.ok(laenge(f!) > 0)
  })

  /* ══ DIE FALLE: DIE SCHWELLE GEGEN DAS STUECK ═══════════════════════════ */

  it('500 Sekunden eines 500-Sekunden-Stuecks zaehlen — auch wenn das Video 1500 hat', () => {
    // DAS IST DER GANZE PUNKT. Gegen die Videolaenge gerechnet waeren das
    // 33 % und damit NIE die Schwelle: das Stueck liefe unbegrenzt oft.
    const stand = freigabenNormalisieren({ videos: [TEIL1] })
    const id = idAus(MAUS.kennung, 0, 500)
    const e = verbrauchen(stand, id, 'lauf1', { sekunden: 480 }, JETZT)
    assert.equal(e.grund, 'gezaehlt')
    assert.equal(e.rest, 0)
  })

  it('ein abgebrochenes Stueck kostet nichts', () => {
    const stand = freigabenNormalisieren({ videos: [TEIL1] })
    const e = verbrauchen(stand, idAus(MAUS.kennung, 0, 500), 'lauf1', { sekunden: 120 }, JETZT)
    assert.equal(e.grund, 'zuWenigGesehen')
    assert.equal(e.rest, 1)
  })

  it('ein GANZES Video rechnet weiter ueber den Anteil — die Datei weiss es besser', () => {
    // GEFUNDEN VON tools/video-belohnung-schau.mjs: `dauerSek` ist eine
    // Angabe aus der Suche und kann falsch sein. Ein Video, das laut Ablage
    // 1626 s hat und in Wahrheit 2 s lang ist, erreichte gegen die Ablage
    // gerechnet NIE die Schwelle — es verbrauchte sich nie.
    const stand = freigabenNormalisieren({ videos: [{ ...MAUS, dauerSek: 1626, anzahl: 1 }] })
    const e = verbrauchen(stand, MAUS.kennung, 'l1', { sekunden: 2, anteil: 1 }, JETZT)
    assert.equal(e.grund, 'gezaehlt')
  })

  it('bei einem STUECK gilt umgekehrt die Ablage — der Browser kennt die Grenze nicht', () => {
    const stand = freigabenNormalisieren({ videos: [TEIL1] })
    const e = verbrauchen(stand, idAus(MAUS.kennung, 0, 500), 'l1', { sekunden: 50, anteil: 1 }, JETZT)
    assert.equal(e.grund, 'zuWenigGesehen')
  })

  it('eine Meldung ganz ohne Anteil faellt auf die Sekunden zurueck', () => {
    const stand = freigabenNormalisieren({ videos: [{ ...MAUS, dauerSek: 100, anzahl: 1 }] })
    const e = verbrauchen(stand, MAUS.kennung, 'l1', { sekunden: 95 }, JETZT)
    assert.equal(e.grund, 'gezaehlt')
  })

  it('eine blosse Zahl gilt weiter als Anteil — der alte Aufruf bleibt gueltig', () => {
    const stand = standMit(1)
    const e = verbrauchen(stand, MAUS.kennung, 'lauf1', 0.95, JETZT)
    assert.equal(e.grund, 'gezaehlt')
  })

  it('die Antwort nach aussen nennt Schnitt, Teilnamen und Stuecklaenge', () => {
    const f = freigabeNormalisieren(TEIL2)!
    const a = fuerAntwort(f)
    assert.equal(a.id, idAus(MAUS.kennung, 500, 1000))
    assert.equal(a.kennung, MAUS.kennung)
    assert.equal(a.abSek, 500)
    assert.equal(a.bisSek, 1000)
    assert.equal(a.teil, 'Teil 2')
    assert.equal(a.laengeSek, 500)
  })

  it('das Plugin wird nach dem VIDEO gefragt, nicht nach der Zeile', () => {
    // DER FEHLER, DEN DIESE ZEILE FESTHAELT, WAR EINMAL DA und blieb bei der
    // Gegenprobe gruen, weil ihn nichts las: mit der Zeilen-id im Pfad haette
    // die Mediathek nach `t0-500-…` gesucht.
    const stueck = freigabeNormalisieren(TEIL1)!
    assert.equal(stueck.id.startsWith('t0-500-'), true)
    assert.equal(pluginPfad(stueck), `video/${encodeURIComponent(MAUS.kennung)}`)
    assert.equal(pluginPfad(stueck).includes(stueck.id), false)
    // Beim ganzen Video sind beide dasselbe — genau deshalb fiel es nie auf.
    const ganz = freigabeNormalisieren(GANZ)!
    assert.equal(pluginPfad(ganz), `video/${encodeURIComponent(ganz.id)}`)
  })

  it('jedes Stueck hat seinen eigenen Zaehler', () => {
    const stand = freigabenNormalisieren({ videos: [TEIL1, TEIL2] })
    const eins = verbrauchen(stand, idAus(MAUS.kennung, 0, 500), 'l1', { sekunden: 500 }, JETZT)
    assert.equal(eins.grund, 'gezaehlt')
    // Teil 2 ist davon unberuehrt — er ist eine eigene Belohnung.
    assert.equal(rest(finden(eins.stand, idAus(MAUS.kennung, 500, 1000))), 1)
    assert.equal(fuerKind(eins.stand).length, 1)
  })
})
