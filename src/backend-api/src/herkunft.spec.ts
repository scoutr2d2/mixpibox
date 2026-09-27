/**
 * DER HERKUNFTSRIEGEL, FALL FUER FALL.
 *
 * Diese Pruefungen messen die FORMEL (herkunftBeurteilen). Ob die Formel im
 * laufenden Server auch wirklich vor `cors()` haengt und die Kopfzeile
 * verschwindet, misst tools/herkunftsriegel-probe.mjs an einem echten
 * Serverprozess — das kann eine Pruefung im selben Prozess nicht.
 *
 * DIE REIHENFOLGE HIER IST DIE DER GEFAHR: zuerst „was darf NICHT ausgesperrt
 * werden" (die Verwaltung, der Kiosk, curl), dann „was muss abprallen".
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { namenBilden } from './eigene-namen'
import {
  gastgeberZerlegen,
  herkunftBeurteilen,
  herkunftsriegelBauen,
  herkunftZerlegen,
  seitenNamensriegelBauen,
  zusatzLesen,
} from './herkunft'

const IP = '192.168.178.169'

describe('Herkunftsriegel — wer durchkommen MUSS', () => {
  it('der Kiosk auf der Box: http://localhost:8200', () => {
    const u = herkunftBeurteilen({ origin: 'http://localhost:8200', host: 'localhost:8200', site: 'same-origin' })
    assert.equal(u.erlaubt, true)
  })

  it('die Verwaltung von einem zweiten Rechner: http://<ip>:8200/admin', () => {
    const u = herkunftBeurteilen({ origin: `http://${IP}:8200`, host: `${IP}:8200`, site: 'same-origin' })
    assert.equal(u.erlaubt, true)
  })

  it('dieselbe Seite ueber TLS: https://<ip>:8443', () => {
    const u = herkunftBeurteilen({ origin: `https://${IP}:8443`, host: `${IP}:8443`, tls: true, site: 'same-origin' })
    assert.equal(u.erlaubt, true)
  })

  it('ueber den Namen statt ueber die Adresse: http://mupibox.local:8200', () => {
    const u = herkunftBeurteilen({ origin: 'http://mupibox.local:8200', host: 'mupibox.local:8200' })
    assert.equal(u.erlaubt, true)
  })

  it('Grossschreibung im Namen aendert nichts (MuPiBox vs mupibox)', () => {
    const u = herkunftBeurteilen({ origin: 'http://MuPiBox:8200', host: 'mupibox:8200' })
    assert.equal(u.erlaubt, true)
  })

  it('IPv6 mit Klammern: http://[::1]:8200', () => {
    const u = herkunftBeurteilen({ origin: 'http://[::1]:8200', host: '[::1]:8200' })
    assert.equal(u.erlaubt, true)
  })

  it('curl und die Werkzeuge in tools/ — gar keine Herkunft', () => {
    const u = herkunftBeurteilen({ host: `${IP}:8200` })
    assert.equal(u.erlaubt, true)
    assert.equal(u.erlaubt && u.herkunft, 'keine')
  })

  it('ein Lesezeichen oder die Adresszeile (Sec-Fetch-Site: none)', () => {
    const u = herkunftBeurteilen({ host: `${IP}:8200`, site: 'none', modus: 'navigate', ziel: 'document' })
    assert.equal(u.erlaubt, true)
  })

  it('der alte PHP-Admin auf Port 80 laedt die Oberflaeche im <embed> (same-site, ohne Origin)', () => {
    const u = herkunftBeurteilen({ host: `${IP}:8200`, site: 'same-site', modus: 'navigate', ziel: 'embed' })
    assert.equal(u.erlaubt, true)
  })

  it('ein Link von aussen auf eine SEITE der Box (Navigation der obersten Ebene)', () => {
    // Die Vorgabe gilt fuer einen Weg, an dem eine Seite liegt — `/player`.
    // Unter `/api` ist dieselbe Regel abgeschaltet, siehe den eigenen Block
    // „die Ausnahme fuer die Navigation" weiter unten.
    const u = herkunftBeurteilen({ host: '127.0.0.1:8200', site: 'cross-site', modus: 'navigate', ziel: 'document' })
    assert.equal(u.erlaubt, true)
  })

  it('OHNE Host-Kopfzeile wird nicht geraten — durchlassen statt aussperren', () => {
    const u = herkunftBeurteilen({ origin: 'http://irgendwas:1234' })
    assert.equal(u.erlaubt, true)
  })

  it('eine zusaetzlich eingetragene Herkunft (ng serve auf 4200)', () => {
    const zusatz = zusatzLesen('http://localhost:4200/, http://127.0.0.1:4200')
    const u = herkunftBeurteilen({ origin: 'http://localhost:4200', host: `${IP}:8200` }, zusatz)
    assert.equal(u.erlaubt, true)
    assert.equal(u.erlaubt && u.herkunft, 'zusatz')
  })
})

describe('Herkunftsriegel — wer abprallen MUSS', () => {
  it('eine fremde Webseite im Heimnetz', () => {
    const u = herkunftBeurteilen({ origin: 'https://boese.example', host: `${IP}:8200`, site: 'cross-site' })
    assert.equal(u.erlaubt, false)
    assert.equal(u.erlaubt === false && u.grund, 'fremde-herkunft')
  })

  it('DIESELBE Box, ANDERER Port — der alte Admin auf 80 duerfte nicht lesen', () => {
    const u = herkunftBeurteilen({ origin: `http://${IP}`, host: `${IP}:8200`, site: 'same-site' })
    assert.equal(u.erlaubt, false)
    assert.equal(u.erlaubt === false && u.grund, 'fremde-herkunft')
  })

  it('ein anderer Rechner im selben Netz', () => {
    const u = herkunftBeurteilen({ origin: 'http://192.168.178.42:8200', host: `${IP}:8200` })
    assert.equal(u.erlaubt, false)
  })

  it('Origin: null — lokale Datei oder abgeschotteter Rahmen', () => {
    const u = herkunftBeurteilen({ origin: 'null', host: `${IP}:8200` })
    assert.equal(u.erlaubt, false)
    assert.equal(u.erlaubt === false && u.grund, 'herkunft-null')
  })

  it('ein Formular-POST von fremder Seite — der Weg, der ohne Vorabfrage schreibt', () => {
    // Der Browser setzt `Origin` bei JEDEM POST, auch beim Formular. Genau
    // deshalb faengt der Riegel das SCHREIBEN und nicht nur das LESEN.
    const u = herkunftBeurteilen({
      origin: 'https://boese.example',
      host: `${IP}:8200`,
      site: 'cross-site',
      modus: 'navigate',
      ziel: 'document',
    })
    assert.equal(u.erlaubt, false)
    assert.equal(u.erlaubt === false && u.grund, 'fremde-herkunft')
  })

  it('ein <img> von fremder Seite auf ein GET mit Wirkung — ohne Origin, aber cross-site', () => {
    const u = herkunftBeurteilen({ host: `${IP}:8200`, site: 'cross-site', modus: 'no-cors', ziel: 'image' })
    assert.equal(u.erlaubt, false)
    assert.equal(u.erlaubt === false && u.grund, 'fremde-seite')
  })

  it('ein unsichtbarer Rahmen einer fremden Seite ist KEINE Navigation der obersten Ebene', () => {
    const u = herkunftBeurteilen({ host: `${IP}:8200`, site: 'cross-site', modus: 'navigate', ziel: 'iframe' })
    assert.equal(u.erlaubt, false)
  })

  it('eine Erweiterung oder eine lokale Datei mit eigenem Schema', () => {
    const u = herkunftBeurteilen({ origin: 'chrome-extension://abcdef', host: `${IP}:8200` })
    assert.equal(u.erlaubt, false)
  })
})

describe('Herkunftsriegel — die Zerlegung', () => {
  it('Vorgabeports: http ist 80, https ist 443', () => {
    assert.deepEqual(herkunftZerlegen('http://box'), { rechner: 'box', port: 80 })
    assert.deepEqual(herkunftZerlegen('https://box'), { rechner: 'box', port: 443 })
  })

  it('der Vorgabeport des Gastgebers haengt daran, ob DIESE Verbindung TLS war', () => {
    assert.deepEqual(gastgeberZerlegen('box', false), { rechner: 'box', port: 80 })
    assert.deepEqual(gastgeberZerlegen('box', true), { rechner: 'box', port: 443 })
  })

  it('Muell ergibt keine Herkunft', () => {
    assert.equal(herkunftZerlegen('nicht wirklich eine adresse'), null)
    assert.equal(herkunftZerlegen('file://'), null)
    assert.equal(gastgeberZerlegen('', false), null)
  })

  it('das Schema wird NICHT verglichen — nur Rechner und Port (Begruendung im Kopf)', () => {
    const u = herkunftBeurteilen({ origin: `https://${IP}:8200`, host: `${IP}:8200` })
    assert.equal(u.erlaubt, true)
  })
})

describe('Herkunftsriegel — die Zwischenschicht', () => {
  /**
   * DIE NAMEN DER BOX, NICHT DIE DIESER MASCHINE.
   *
   * Diese Pruefungen sprechen von `192.168.178.169:8200` — das ist die Box
   * beim Betreiber. Ohne diese Angabe wuerde `namenErmitteln()` die Namen der
   * Maschine ableiten, auf der gerade geprueft wird, und das Urteil haenge
   * daran, in welchem Netz die haengt. Eine Pruefung, deren Ergebnis vom
   * Rechner abhaengt, misst nichts.
   */
  const ALS_BOX = () => namenBilden({ rechnername: 'mupibox', adressen: ['127.0.0.1', IP], konfigHost: 'MixPiBox' })

  const antwort = () => {
    const kopf: Record<string, unknown> = {}
    let stand = 0
    let rumpf: unknown = null
    const entfernt: string[] = []
    return {
      setHeader: (n: string, w: unknown) => {
        kopf[n] = w
      },
      removeHeader: (n: string) => {
        entfernt.push(n)
        delete kopf[n]
      },
      status(n: number) {
        stand = n
        return this
      },
      json(o: unknown) {
        rumpf = o
        return this
      },
      lage: () => ({ kopf, stand, rumpf, entfernt }),
    }
  }

  const anfrage = (h: Record<string, string>) => ({
    headers: h,
    method: 'GET',
    originalUrl: '/api/konfiguration',
    socket: {},
  })

  it('laesst die eigene Oberflaeche durch und setzt Vary: Origin', () => {
    const riegel = herkunftsriegelBauen({ eigeneNamen: ALS_BOX, zusatz: new Set() })
    const res = antwort()
    let weiter = false
    riegel(
      anfrage({ origin: `http://${IP}:8200`, host: `${IP}:8200` }) as never,
      res as never,
      (() => {
        weiter = true
      }) as never,
    )
    assert.equal(weiter, true)
    assert.equal(res.lage().kopf.Vary, 'Origin')
  })

  it('weist eine fremde Seite mit 403 ab und nimmt Access-Control-Allow-Origin weg', () => {
    const gemeldet: string[] = []
    const riegel = herkunftsriegelBauen({ eigeneNamen: ALS_BOX, zusatz: new Set(), melden: (s) => gemeldet.push(s) })
    const res = antwort()
    let weiter = false
    riegel(
      anfrage({ origin: 'https://boese.example', host: `${IP}:8200` }) as never,
      res as never,
      (() => {
        weiter = true
      }) as never,
    )
    assert.equal(weiter, false)
    const lage = res.lage()
    assert.equal(lage.stand, 403)
    assert.ok(lage.entfernt.includes('Access-Control-Allow-Origin'))
    assert.equal((lage.rumpf as { ok: boolean }).ok, false)
    // BEIDE SCHLUESSEL, weil die beiden Oberflaechen verschiedene lesen.
    assert.ok((lage.rumpf as { fehler: string }).fehler.length > 10)
    assert.equal((lage.rumpf as { error: string }).error, (lage.rumpf as { fehler: string }).fehler)
    assert.equal(gemeldet.length, 1)
  })

  it('abgeschaltet laesst er alles durch — DAS ist die Gegenprobe', () => {
    const riegel = herkunftsriegelBauen({ eigeneNamen: ALS_BOX, zusatz: new Set(), aus: true })
    const res = antwort()
    let weiter = false
    riegel(
      anfrage({ origin: 'https://boese.example', host: `${IP}:8200` }) as never,
      res as never,
      (() => {
        weiter = true
      }) as never,
    )
    assert.equal(weiter, true)
  })
})

/**
 * DIE AUSNAHME FUER DIE NAVIGATION — UND WO SIE NICHT GILT.
 *
 * Der Riegel haengt in server.ts an ZWEI Wegen, und an denen liegt nicht
 * dasselbe: unter `/player` liegen Seiten, unter `/api` liegen Wege mit
 * Wirkung. Gemessen wurde der Unterschied am laufenden Server
 * (tools/riegel-durchkommen.mjs, Ring 4); hier steht die Formel dazu.
 */
describe('Herkunftsriegel — die Ausnahme fuer die Navigation', () => {
  const seitenwechsel = { host: `${IP}:8200`, site: 'cross-site', modus: 'navigate', ziel: 'document' }

  it('unter /api ist sie AUS: ein Klick auf einen fremden Link erreicht kein GET mit Wirkung', () => {
    const u = herkunftBeurteilen(seitenwechsel, new Set(), false)
    assert.equal(u.erlaubt, false)
    assert.equal(u.erlaubt === false && u.grund, 'fremder-seitenwechsel')
  })

  it('der Satz dazu sagt, was zu tun ist — er ist der einzige, den ein Mensch zu sehen bekommt', () => {
    const u = herkunftBeurteilen(seitenwechsel, new Set(), false)
    assert.equal(u.erlaubt, false)
    // Nicht „403": eine Adresse, mit der er weiterkommt.
    assert.ok(u.erlaubt === false && u.satz.includes('/admin'))
  })

  it('unter /player bleibt sie AN — dort liegen die Seiten der Oberflaeche', () => {
    assert.equal(herkunftBeurteilen(seitenwechsel, new Set(), true).erlaubt, true)
  })

  it('sie aendert NICHTS an den Faellen ohne cross-site: Lesezeichen und Adresszeile bleiben offen', () => {
    const u = herkunftBeurteilen(
      { host: `${IP}:8200`, site: 'none', modus: 'navigate', ziel: 'document' },
      new Set(),
      false,
    )
    assert.equal(u.erlaubt, true)
  })

  it('sie aendert NICHTS an curl: ohne Sec-Fetch-Kopfzeilen kommt weiterhin alles durch', () => {
    assert.equal(herkunftBeurteilen({ host: `${IP}:8200` }, new Set(), false).erlaubt, true)
  })

  it('sie aendert NICHTS an der eigenen Oberflaeche', () => {
    const u = herkunftBeurteilen(
      { origin: `http://${IP}:8200`, host: `${IP}:8200`, site: 'same-origin' },
      new Set(),
      false,
    )
    assert.equal(u.erlaubt, true)
  })

  it('ein RAHMEN bleibt abgewiesen, mit oder ohne Ausnahme — und mit demselben Grund wie bisher', () => {
    const rahmen = { host: `${IP}:8200`, site: 'cross-site', modus: 'navigate', ziel: 'iframe' }
    for (const erlaubt of [true, false]) {
      const u = herkunftBeurteilen(rahmen, new Set(), erlaubt)
      assert.equal(u.erlaubt, false)
      assert.equal(u.erlaubt === false && u.grund, 'fremde-seite')
    }
  })

  it('die Zwischenschicht reicht die Einstellung durch (Vorgabe: an)', () => {
    const bau = (seitenwechselErlaubt?: boolean) => {
      let weiter = false
      // `eigeneNamen: () => null` schaltet den NAMENSTEIL ab. Hier geht es um
      // den Seitenwechsel; wuerde der Namensteil mitlaufen, haenge das Urteil
      // daran, ob die Maschine, auf der geprueft wird, gerade zufaellig
      // 192.168.178.169 heisst — und die Pruefung wuerde nichts mehr aussagen.
      const riegel = herkunftsriegelBauen({ zusatz: new Set(), seitenwechselErlaubt, eigeneNamen: () => null })
      riegel(
        {
          headers: {
            host: `${IP}:8200`,
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-dest': 'document',
          },
          method: 'GET',
          originalUrl: '/api/vorlesen/sprich',
          socket: {},
        } as never,
        {
          setHeader: () => {},
          removeHeader: () => {},
          status: () => ({ json: () => {} }),
        } as never,
        (() => {
          weiter = true
        }) as never,
      )
      return weiter
    }
    assert.equal(bau(undefined), true)
    assert.equal(bau(true), true)
    assert.equal(bau(false), false)
  })
})

/**
 * ══ DER NAMENSTAUSCH ══════════════════════════════════════════════════════
 *
 * Der Befund vom 07.08.2026: `Origin` gegen `Host` zu halten ist blind, wenn
 * BEIDE denselben fremden Namen tragen. Genau das stellt ein Angreifer her,
 * indem er seinen eigenen Namen nach dem ersten Laden auf die Box zeigen
 * laesst — der Browser haelt die Anfrage dann fuer gleichherkuenftig und
 * meldet sogar `Sec-Fetch-Site: same-origin`.
 *
 * DIE REIHENFOLGE IST WIEDER DIE DER GEFAHR: erst die sechs Namen, unter denen
 * die Box heute wirklich erreicht wird, dann der Angriff.
 */
describe('Herkunftsriegel — der Namenstausch', () => {
  const BOX = namenBilden({
    rechnername: 'mupibox',
    adressen: ['127.0.0.1', '::1', IP],
    konfigHost: 'MixPiBox',
  })

  /** Die sechs Wege, ueber die die Box heute wirklich bedient wird. */
  const ECHTE_WEGE: [string, string, boolean][] = [
    ['der Kiosk auf der Box selbst', 'localhost:8200', false],
    ['Werkzeuge und Skripte auf der Box', '127.0.0.1:8200', false],
    ['ein zweiter Rechner im Heimnetz', `${IP}:8200`, false],
    ['dieselbe Seite ueber TLS', `${IP}:8443`, true],
    ['der Rechnername', 'mupibox:8200', false],
    ['der mDNS-Name', 'mupibox.local:8200', false],
    ['der Name aus der Konfiguration', 'MixPiBox:8200', false],
    ['ein Name, den der Router vergibt', 'mupibox.fritz.box:8200', false],
  ]

  for (const [wozu, host, tls] of ECHTE_WEGE) {
    it(`kommt durch — ${wozu} (${host})`, () => {
      const schema = tls ? 'https' : 'http'
      // LESEND (ohne Herkunft, wie curl) …
      assert.equal(herkunftBeurteilen({ host, tls }, new Set(), false, BOX).erlaubt, true)
      // … und SCHREIBEND aus der eigenen Oberflaeche.
      const u = herkunftBeurteilen(
        { host, tls, origin: `${schema}://${host}`, site: 'same-origin' },
        new Set(),
        false,
        BOX,
      )
      assert.equal(u.erlaubt, true, `${host} waere ausgesperrt`)
    })
  }

  it('DER ANGRIFF: Host und Origin tragen denselben FREMDEN Namen', () => {
    // Gemessen mit tools/riegel-durchkommen.mjs, Ring 3: so kam ein
    // `POST /api/konfiguration` mit 200 durch und die Lautstaerke in
    // mupiboxconfig.json sprang von 41 auf 57.
    const u = herkunftBeurteilen(
      { host: 'boese.example', origin: 'http://boese.example', site: 'same-origin' },
      new Set(),
      false,
      BOX,
    )
    assert.equal(u.erlaubt, false)
    assert.equal(u.erlaubt === false && u.grund, 'fremder-name')
  })

  it('… auch lesend, und auch ganz ohne Herkunft', () => {
    for (const kopf of [{ host: 'boese.example' }, { host: 'boese.example:8200', site: 'none' }]) {
      const u = herkunftBeurteilen(kopf, new Set(), false, BOX)
      assert.equal(u.erlaubt, false)
      assert.equal(u.erlaubt === false && u.grund, 'fremder-name')
    }
  })

  it('… und die Vorabfrage faellt mit ab (sonst antwortet cors() freundlich)', () => {
    const u = herkunftBeurteilen(
      { host: 'boese.example', origin: 'http://boese.example', site: 'same-origin', modus: 'cors' },
      new Set(),
      false,
      BOX,
    )
    assert.equal(u.erlaubt, false)
  })

  it('ein Praefix eines erlaubten Namens ist nicht der erlaubte Name', () => {
    for (const host of [`${IP}.boese.example`, `${IP}-boese.example:8200`, 'mupibox.local.boese.example']) {
      const u = herkunftBeurteilen({ host }, new Set(), false, BOX)
      assert.equal(u.erlaubt, false, `${host} kam durch`)
    }
  })

  it('OHNE lesbaren Host wird nicht geraten — HTTP/1.0, leerer Host, kein Host', () => {
    // Ein Browser schickt die Kopfzeile immer und kann sie aus einer Seite
    // heraus nicht faelschen. Der Fall kommt also nicht aus einem Angriff, und
    // Aussperren waere hier der teurere Fehler.
    for (const kopf of [{}, { host: '' }, { host: '   ' }]) {
      assert.equal(herkunftBeurteilen(kopf, new Set(), false, BOX).erlaubt, true)
    }
  })

  it('KONNTE DIE BOX IHRE NAMEN NICHT ERMITTELN, prueft sie sie nicht', () => {
    // Die Richtung ist eine Entscheidung: eine Box, die niemanden mehr
    // hereinlaesst, ist verloren — kein Bildschirm, keine Tastatur, und der
    // Besitzer kann es nicht einmal melden.
    const blind = namenBilden({ netzGelesen: false })
    assert.equal(herkunftBeurteilen({ host: 'boese.example' }, new Set(), false, blind).erlaubt, true)
    assert.equal(herkunftBeurteilen({ host: 'boese.example' }, new Set(), false, null).erlaubt, true)
  })

  it('der abgewiesene Mensch bekommt den Weg zurueck in die Hand', () => {
    const u = herkunftBeurteilen({ host: 'mupibox.wasauchimmer:8200' }, new Set(), false, BOX)
    assert.equal(u.erlaubt, false)
    const satz = u.erlaubt === false ? u.satz : ''
    assert.match(satz, /mupibox\.wasauchimmer/)
    assert.match(satz, new RegExp(`http://${IP.replace(/\./g, '\\.')}:8200/`))
    assert.match(satz, /hostZusatz/)
  })

  it('die Zwischenschicht antwortet mit 403, dem Grund und BEIDEN Schluesseln', () => {
    let stand = 0
    let rumpf: Record<string, string> = {}
    const gemeldet: string[] = []
    const riegel = herkunftsriegelBauen({
      zusatz: new Set(),
      melden: (s) => gemeldet.push(s),
      eigeneNamen: () => BOX,
    })
    let weiter = false
    riegel(
      {
        headers: { host: 'boese.example', origin: 'http://boese.example' },
        method: 'POST',
        originalUrl: '/api/konfiguration',
        socket: {},
      } as never,
      {
        setHeader: () => {},
        removeHeader: () => {},
        status(n: number) {
          stand = n
          return this
        },
        json(o: Record<string, string>) {
          rumpf = o
          return this
        },
      } as never,
      (() => {
        weiter = true
      }) as never,
    )
    assert.equal(weiter, false)
    assert.equal(stand, 403)
    assert.equal(rumpf.grund, 'fremder-name')
    assert.equal(rumpf.error, rumpf.fehler)
    assert.match(gemeldet[0] ?? '', /fremder-name/)
  })
})

/**
 * DER SEITENRIEGEL — die Erklaerung fuer den, der ausgesperrt ist.
 *
 * WARUM ES IHN GIBT, GEMESSEN (tools/riegel-ausgesperrt-was-sieht-er.mjs,
 * Ring C, echter Browser, Name den die Box nicht kennt): `/` zeigte NULL
 * Zeichen sichtbaren Text, `/neu/` meldete eine Stoerung mit „Noch einmal
 * versuchen" (hilft nie), `/admin` verlangte ein Passwort, das es nicht gibt.
 *
 * DIE TESTS HIER STEHEN IN DER REIHENFOLGE DER GEFAHR: zuerst alles, was
 * UNBERUEHRT bleiben muss — ein Riegel vor den Seiten ist der gefaehrlichste
 * von allen, weil an `/` auch der <embed> des alten PHP-Admin haengt.
 */
describe('Seitenriegel — er darf fast nichts anfassen', () => {
  const ALS_BOX2 = () => namenBilden({ rechnername: 'mupibox', adressen: ['127.0.0.1', IP], konfigHost: 'MixPiBox' })

  const lauf = (kopfzeilen: Record<string, string>, mehr: Record<string, unknown> = {}, einst = {}) => {
    let weiter = false
    let stand = 0
    let rumpf = ''
    let art = ''
    const res = {
      setHeader: () => {},
      status(n: number) {
        stand = n
        return this
      },
      type(t: string) {
        art = t
        return this
      },
      send(o: string) {
        rumpf = o
        return this
      },
    }
    const riegel = seitenNamensriegelBauen({ eigeneNamen: ALS_BOX2, ...einst })
    riegel(
      { headers: kopfzeilen, method: 'GET', path: '/', originalUrl: '/', socket: {}, ...mehr } as never,
      res as never,
      (() => {
        weiter = true
      }) as never,
    )
    return { weiter, stand, rumpf, art }
  }

  it('ein EIGENER Name geht durch wie bisher', () => {
    assert.equal(lauf({ host: `${IP}:8200`, accept: 'text/html' }).weiter, true)
  })

  it('der <embed> des PHP-Admin laeuft ueber mupibox.host — und der gilt', () => {
    // AdminInterface/www/content.php bettet http://<mupibox.host>:8200 ein.
    // Genau daran haette ein VOLLER Riegel gehangen (ein Rahmen ist
    // cross-site); dieser hier sieht `Origin` und `Sec-Fetch` gar nicht an.
    const r = lauf({
      host: 'mixpibox:8200',
      accept: 'text/html',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-dest': 'embed',
    })
    assert.equal(r.weiter, true)
  })

  it('ein Stilblatt bleibt unberuehrt — auch unter fremdem Namen', () => {
    assert.equal(lauf({ host: 'boese.example', accept: 'text/css,*/*;q=0.1' }).weiter, true)
  })

  it('ein fetch ohne Accept bleibt unberuehrt', () => {
    assert.equal(lauf({ host: 'boese.example' }).weiter, true)
  })

  it('ein POST bleibt unberuehrt — hier wird nur eine Seite beantwortet', () => {
    assert.equal(lauf({ host: 'boese.example', accept: 'text/html' }, { method: 'POST' }).weiter, true)
  })

  it('/api behaelt seine eigene Antwortform (JSON) — der Seitenriegel geht nicht ran', () => {
    assert.equal(lauf({ host: 'boese.example', accept: 'text/html' }, { path: '/api/konfiguration' }).weiter, true)
  })

  it('/player ebenso', () => {
    assert.equal(lauf({ host: 'boese.example', accept: 'text/html' }, { path: '/player/x' }).weiter, true)
  })

  it('kennt die Box ihre Namen NICHT, bleibt alles wie bisher', () => {
    const r = lauf(
      { host: 'boese.example', accept: 'text/html' },
      {},
      { eigeneNamen: () => namenBilden({ netzGelesen: false }) },
    )
    assert.equal(r.weiter, true)
  })

  it('ohne lesbaren Host wird nicht geraten', () => {
    assert.equal(lauf({ accept: 'text/html' }).weiter, true)
  })

  it('abgeschaltet (MUPIBOX_HERKUNFT_AUS) fasst er nichts an', () => {
    assert.equal(lauf({ host: 'boese.example', accept: 'text/html' }, {}, { aus: true }).weiter, true)
  })

  it('NUR der eine Fall wird beantwortet: Seite + fremder Name', () => {
    // MIT Port, wie ein Browser ihn schickt — die genannten Wege muessen
    // denselben Port tragen, sonst zeigt der Ausweg auf Port 80, wo nichts ist.
    const r = lauf({ host: 'boese.example:8200', accept: 'text/html,application/xhtml+xml' })
    assert.equal(r.weiter, false)
    assert.equal(r.stand, 403)
    assert.equal(r.art, 'html')
    // Und der Mensch liest, was los ist UND wie er weiterkommt.
    assert.match(r.rumpf, /kennt sich unter dem Namen/)
    assert.match(r.rumpf, new RegExp(`href="http://${IP.replace(/\./g, '\\.')}:8200/"`))
    assert.match(r.rumpf, /hostZusatz/)
  })
})
