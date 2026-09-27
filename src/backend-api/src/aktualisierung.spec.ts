/**
 * Tests für die Aktualisierungs-Beurteilung.
 *
 * Der wichtigste Test dieser Datei ist „erkennt eine fremde Quelle": genau
 * dort entscheidet sich, ob ein Klick die eigene Arbeit auf der Box behält
 * oder löscht. Alles andere ist Beiwerk.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type Herkunft,
  KANAELE,
  beurteile,
  gleicheQuelle,
  istKanal,
  neuestesAngebot,
  vergleicheVersionen,
} from './aktualisierung.js'

const FORK: Herkunft = {
  quelle: 'https://github.com/achim/MuPiBox.git',
  commit: 'abc1234',
  gebautAm: '2026-07-26T16:00:00.000Z',
  zweig: 'main',
}

describe('vergleicheVersionen', () => {
  it('vergleicht der Größe nach, nicht dem Text nach', () => {
    assert.ok((vergleicheVersionen('4.3.0', '4.2.9') ?? 0) > 0)
    assert.ok((vergleicheVersionen('4.10.0', '4.9.0') ?? 0) > 0, '10 ist mehr als 9')
    assert.equal(vergleicheVersionen('4.3.0', '4.3.0'), 0)
    assert.ok((vergleicheVersionen('4.2.0', '4.3.0') ?? 0) < 0)
  })

  /**
   * AN DER BOX GEMESSEN (31.08.2026, .79). Ohne diese Regel fiel `v1.1.0`
   * durch die Ziffernprüfung, `neuestesAngebot()` hielt den Eintrag für einen
   * Platzhalter und übersprang ihn — die Seite meldete „kein Angebot" bei
   * gefülltem Verzeichnis und leerem `feedFehler`. Ein Fehlerbild ohne
   * Fehlermeldung.
   */
  it('versteht die eigene Namensform mit führendem v', () => {
    assert.equal(vergleicheVersionen('v1.1.0', 'v1.1.0'), 0)
    assert.ok((vergleicheVersionen('v1.1.0', 'v1.0.0') ?? 0) > 0)
    // Gemischt, weil die installierte Fassung aus einer Zeit ohne `v` stammt.
    assert.ok((vergleicheVersionen('v1.1.0', '1.0.0') ?? 0) > 0)
    // BIS ZUM 31.08.2026 STAND HIER DAS GEGENTEIL: „der Anhang zählt hier
    // nicht — beide sind 1.1.0". Das war als Toleranz gegenüber Upstreams
    // Anhängseln gemeint und für `stable` auch richtig — aber es machte den
    // beta-Kanal wirkungslos: eine Box auf beta.1 bekam beta.3 angeboten,
    // urteilte „aktuell" und aktualisierte nie.
  })

  it('ordnet die drei Kanäle: dev < beta < fertig', () => {
    // Der Weg einer Fassung: v1.2.0-dev.N -> v1.2.0-beta.N -> v1.2.0.
    assert.ok((vergleicheVersionen('v1.2.0-beta.1', 'v1.2.0-dev.9') ?? 0) > 0,
      'ein Kandidat ist neuer als jede dev-Fassung desselben Kerns')
    assert.ok((vergleicheVersionen('v1.2.0', 'v1.2.0-beta.9') ?? 0) > 0,
      'die fertige Fassung schlägt jeden Kandidaten')
    assert.ok((vergleicheVersionen('v1.2.0-dev.2', 'v1.2.0-dev.1') ?? 0) > 0,
      'innerhalb einer Stufe zählt die Laufnummer')
    assert.ok((vergleicheVersionen('v1.2.0-dev.1', 'v1.1.0') ?? 0) > 0,
      'der Kern schlägt die Stufe — 1.2.0-dev ist neuer als fertiges 1.1.0')
  })

  it('lässt Unbekanntes nie gewinnen', () => {
    // Ein Anhängsel, das niemand eingeordnet hat, darf nicht als neuer gelten
    // als eine Stufe, die wir kennen — sonst zieht sich eine Box daran hoch.
    assert.ok((vergleicheVersionen('v1.2.0-dev.1', 'v1.2.0-irgendwas.9') ?? 0) > 0)
    assert.ok((vergleicheVersionen('v1.2.0-irgendwas', 'v1.2.0') ?? 0) < 0)
  })

  it('hält ein v ohne Ziffer dahinter weiterhin für unvergleichbar', () => {
    // Sonst würde aus „version" still eine 0 und aus Unsinn ein Angebot.
    assert.equal(vergleicheVersionen('version', '1.0.0'), null)
    assert.equal(vergleicheVersionen('X.X.X', '1.0.0'), null)
  })

  it('verträgt unterschiedlich viele Stellen', () => {
    assert.equal(vergleicheVersionen('4.3', '4.3.0'), 0)
    assert.ok((vergleicheVersionen('4.3.1', '4.3') ?? 0) > 0)
  })

  it('hält eine Vorabfassung für älter als die fertige', () => {
    // Früher galten beide als gleich. Eine Beta von 4.3.0 IST aber älter als
    // 4.3.0 — sonst käme eine Box, die auf der Beta sitzt, nie auf die
    // fertige Fassung.
    assert.ok((vergleicheVersionen('4.3.0-beta', '4.3.0') ?? 0) < 0)
  })

  it('meldet Unvergleichbares als null — NICHT als neuer', () => {
    // Upstream führt im dev-Kanal "X.X.X". Als "neuer" gewertet, böte die Box
    // dauerhaft ein Update an, das keines ist.
    assert.equal(vergleicheVersionen('X.X.X', '4.3.0'), null)
    assert.equal(vergleicheVersionen('4.3.0', 'irgendwas'), null)
    assert.equal(vergleicheVersionen('', '4.3.0'), null)
  })
})

describe('neuestesAngebot', () => {
  const feed = {
    release: {
      stable: [
        { version: '4.2.0', url: 'u/4.2.0.zip' },
        { version: '4.3.0', url: 'u/4.3.0.zip', releaseinfo: 'Neues' },
      ],
      dev: [{ version: 'X.X.X', url: 'u/dev.zip' }],
      beta: [],
    },
  }

  it('nimmt den letzten Eintrag des Kanals', () => {
    const a = neuestesAngebot(feed, 'stable')
    assert.equal(a?.version, '4.3.0')
    assert.equal(a?.info, 'Neues')
  })

  it('überspringt Platzhalter statt sie anzubieten', () => {
    assert.equal(neuestesAngebot(feed, 'dev'), null)
  })

  it('verträgt leere und kaputte Verzeichnisse', () => {
    assert.equal(neuestesAngebot(feed, 'beta'), null)
    assert.equal(neuestesAngebot({}, 'stable'), null)
    assert.equal(neuestesAngebot(null, 'stable'), null)
    assert.equal(neuestesAngebot({ release: { stable: 'kaputt' } }, 'stable'), null)
  })

  it('überspringt Einträge ohne Adresse', () => {
    assert.equal(neuestesAngebot({ release: { stable: [{ version: '9.9.9' }] } }, 'stable'), null)
  })
})

describe('gleicheQuelle', () => {
  it('erkennt dieselbe Quelle in verschiedenen Schreibweisen', () => {
    const paare: [string, string][] = [
      ['https://github.com/splitti/MuPiBox.git', 'https://github.com/splitti/MuPiBox'],
      ['git@github.com:splitti/MuPiBox.git', 'https://github.com/splitti/MuPiBox'],
      ['https://github.com/Splitti/MuPiBox/', 'https://github.com/splitti/mupibox'],
      ['git+https://github.com/splitti/MuPiBox.git', 'github.com/splitti/MuPiBox'],
    ]
    for (const [a, b] of paare) assert.equal(gleicheQuelle(a, b), true, `${a} ~ ${b}`)
  })

  it('unterscheidet einen Fork vom Original — darauf kommt alles an', () => {
    assert.equal(
      gleicheQuelle('https://github.com/achim/MuPiBox.git', 'https://github.com/splitti/MuPiBox.git'),
      false,
    )
    assert.equal(gleicheQuelle('https://git.local/mupibox', 'https://github.com/splitti/MuPiBox'), false)
  })

  it('behandelt Leeres als „nicht dieselbe"', () => {
    assert.equal(gleicheQuelle('', ''), false)
    assert.equal(gleicheQuelle('', 'https://github.com/splitti/MuPiBox'), false)
  })
})

describe('beurteile', () => {
  const angebot = { version: '4.3.0', url: 'u.zip', info: '' }
  const UPSTREAM = 'https://github.com/splitti/MuPiBox.git'

  it('VERWEIGERT ein Angebot aus fremder Quelle', () => {
    // Der Kern: die Box fährt den Fork, angeboten wird Upstream. Ein blosser
    // Versionsvergleich sagte hier "neuer" — und der Klick loeschte den Fork.
    const l = beurteile({
      herkunft: FORK,
      installierteVersion: '4.2.0',
      angebot,
      angebotsQuelle: UPSTREAM,
    })
    assert.equal(l.urteil, 'fremdeQuelle')
    assert.match(l.grund ?? '', /eigenen Änderungen/)
  })

  it('VERWEIGERT, wenn der Bau vor seiner eigenen Quelle liegt', () => {
    // Am Geraet gemessen: gleiche Adresse, aber 98 eigene Commits. Die
    // Quellpruefung allein sagte "passt" — und der Klick haette sie verworfen.
    const l = beurteile({
      herkunft: { ...FORK, quelle: UPSTREAM, eigeneCommits: 98 },
      installierteVersion: '4.2.0',
      angebot,
      angebotsQuelle: UPSTREAM,
    })
    assert.equal(l.urteil, 'eigenbau')
    assert.match(l.grund ?? '', /98 eigene Commits/)
  })

  it('VERWEIGERT auch bei blossen ungespeicherten Aenderungen', () => {
    const l = beurteile({
      herkunft: { ...FORK, quelle: UPSTREAM, eigeneCommits: 0, unsauber: 3 },
      installierteVersion: '4.2.0',
      angebot,
      angebotsQuelle: UPSTREAM,
    })
    assert.equal(l.urteil, 'eigenbau')
  })

  it('bietet an, wenn Quelle gleich und Fassung neuer ist', () => {
    const l = beurteile({
      herkunft: { ...FORK, eigeneCommits: 0, unsauber: 0 },
      installierteVersion: '4.2.0',
      angebot,
      angebotsQuelle: FORK.quelle,
    })
    assert.equal(l.urteil, 'neuer')
  })

  it('meldet aktuell, wenn nichts Neueres da ist', () => {
    for (const v of ['4.3.0', '4.4.0']) {
      const l = beurteile({
        herkunft: { ...FORK, eigeneCommits: 0, unsauber: 0 },
        installierteVersion: v,
        angebot,
        angebotsQuelle: FORK.quelle,
      })
      assert.equal(l.urteil, 'aktuell', v)
    }
  })

  it('prüft die Herkunft VOR der Fassung', () => {
    // Selbst wenn das fremde Angebot aelter waere, bleibt es ein Austausch.
    const l = beurteile({
      herkunft: FORK,
      installierteVersion: '9.9.9',
      angebot,
      angebotsQuelle: UPSTREAM,
    })
    assert.equal(l.urteil, 'fremdeQuelle')
  })

  it('sagt es, wenn die Box ihre Herkunft nicht kennt', () => {
    const l = beurteile({
      herkunft: null,
      installierteVersion: '4.2.0',
      angebot,
      angebotsQuelle: UPSTREAM,
    })
    assert.equal(l.urteil, 'herkunftUnbekannt')
    assert.ok(l.grund)
  })

  it('meldet fehlendes Angebot statt zu raten', () => {
    const l = beurteile({
      herkunft: FORK,
      installierteVersion: '4.2.0',
      angebot: null,
      angebotsQuelle: FORK.quelle,
    })
    assert.equal(l.urteil, 'keinAngebot')
  })

  it('meldet unklar statt neuer, wenn die Nummern nicht vergleichbar sind', () => {
    const l = beurteile({
      herkunft: { ...FORK, eigeneCommits: 0, unsauber: 0 },
      installierteVersion: 'selbst gebaut',
      angebot,
      angebotsQuelle: FORK.quelle,
    })
    assert.equal(l.urteil, 'unklar')
  })
})

describe('istKanal', () => {
  it('kennt genau drei', () => {
    assert.deepEqual([...KANAELE], ['stable', 'beta', 'dev'])
    for (const k of KANAELE) assert.equal(istKanal(k), true, k)
  })

  it('weist alles andere ab', () => {
    for (const x of ['', 'main', 'toString', null, 42]) assert.equal(istKanal(x), false, String(x))
  })
})
