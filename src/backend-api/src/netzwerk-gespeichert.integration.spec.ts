/**
 * E115 — DER NETZWERK-MANAGER AM LAUFENDEN SERVER.
 *
 * Betreiber woertlich (31.08.2026): „was wir unbedingt noch einbauen muessen
 * ist ein 'netzwerk manager' das man bei gespeicherten verbindungen einfach
 * verbinden klicken kann. das geht nicht ueber die box es ist immer ein
 * passwort erforderlich".
 *
 * Was hier bewiesen wird, ist etwas anderes als in `netzwerk.spec.ts`. Dort
 * steht, dass `pruefeNetzKennung` eine erfundene Zahl ablehnt. HIER steht,
 * dass der ENDPUNKT sie auch wirklich fragt — und das ist der Unterschied
 * zwischen einer Regel und einem Kommentar ueber eine Regel. Eine Oberflaeche
 * kann man umgehen, einen Endpunkt, der mit 400 antwortet, nicht.
 *
 * ES WIRD AN KEINER BOX ETWAS GESCHALTET. `sudo` kommt aus einem
 * Attrappenverzeichnis, das dem Lauf vor den PATH gelegt wird, und spielt
 * wpa_cli UND den Totmannschalter nach — mit ZUSTAND in Dateien, nicht als
 * blosses Echo. Nur so laesst sich pruefen, was der wichtigste Teil ist:
 * WELCHE Kennung an `select_network` und `remove_network` ging. Ein
 * Attrappen-Echo, das immer „OK" sagt, wuerde ein Loeschen des falschen Netzes
 * genauso gruen melden.
 *
 * ══ WIE DER FERNE-FALL HERGESTELLT WIRD ════════════════════════════════════
 *
 * Die Route unterscheidet „am Geraet" von „aus der Ferne" an
 * `req.socket.remoteAddress` — und zwar absichtlich daran, weil sich das
 * nicht vortaeuschen laesst (ein fremder Rechner kann keine Verbindung mit
 * Absender aus 127.0.0.0/8 aufbauen). Genau deshalb kommt supertest immer als
 * „am Geraet" an: es verbindet sich ueber die Rueckschleife.
 *
 * Der Ferne-Fall — der einzige, in dem es einen Totmannschalter GIBT — waere
 * damit ungeprueft geblieben. Er wird deshalb mit einem eigenen Aufruf
 * gefahren, der den ABSENDER AM TRANSPORT setzt: ein eigener
 * `http.createServer` schreibt `remoteAddress` auf eine LAN-Adresse und
 * uebergibt an die echte App. Kein LAN noetig, keine Abhaengigkeit von
 * vorhandener Hardware, und trotzdem der echte Zweig. Naeheres bei
 * `vonAussen` — dort steht auch, warum hier vorher 127.0.0.2 stand und warum
 * das seit dem 19.09.2026 nicht mehr geht.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { request as httpAnfrage, createServer as httpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner: string
let netzeDatei: string
let prioDatei: string
let statusDatei: string
let logDatei: string

/** Die gespeicherten Netze, so wie wpa_cli sie fuehrt: id, ssid, bssid, flags. */
function netzeSetzen(zeilen: string[]): void {
  writeFileSync(netzeDatei, `${zeilen.join('\n')}\n`)
}

/** Was `wpa_cli status` gerade meldet — der Stoff fuer die Selbstbestaetigung. */
function statusSetzen(text: string): void {
  writeFileSync(statusDatei, `${text}\n`)
}

/** Alles, was ueber die sudo-Attrappe lief. */
function mitgeschrieben(): string[] {
  try {
    return readFileSync(logDatei, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function logLeeren(): void {
  writeFileSync(logDatei, '')
}

/** Der Ausgangszustand: zwei gelernte Netze, die Box haengt im ersten. */
const ZWEI_NETZE = ['0\tHeimnetz\tany\t[CURRENT]', '3\tGastnetz\tany\t']

describe('E115: gespeicherte Netze verbinden und vergessen', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-e115-'))
    netzeDatei = join(ordner, 'netze.tsv')
    prioDatei = join(ordner, 'prio.txt')
    statusDatei = join(ordner, 'status.txt')
    logDatei = join(ordner, 'sudo.log')
    netzeSetzen(ZWEI_NETZE)
    // Zwei Netze mit DERSELBEN Prioritaet 10 — genau der Zustand, den
    // /api/netzwerk/verbinden hinterlaesst (es setzt fest `priority 10`).
    // Zwischen diesen beiden will der Betreiber umschalten.
    writeFileSync(prioDatei, '0=10\n3=10\n')
    statusSetzen('wpa_state=COMPLETED\nssid=Heimnetz\nip_address=192.168.178.34')
    logLeeren()

    const bin = join(ordner, 'bin')
    mkdirSync(bin, { recursive: true })
    const skript = (name: string, inhalt: string) => {
      const p = join(bin, name)
      writeFileSync(p, `#!/bin/sh\n${inhalt}\n`)
      chmodSync(p, 0o755)
    }

    // `ip -j addr show` — nur so viel, dass funkSchnittstelle() wlan0 findet.
    skript(
      'ip',
      `cat <<'ENDE'
[{"ifname":"wlan0","operstate":"UP","addr_info":[{"family":"inet","local":"192.168.178.34","prefixlen":24}]}]
ENDE`,
    )

    // Die sudo-Attrappe MIT ZUSTAND. Sie schreibt jeden Aufruf mit und
    // beantwortet wpa_cli aus den Dateien oben — `select_network` setzt die
    // Marke [CURRENT] wirklich um, `remove_network` entfernt die Zeile
    // wirklich. Wer nur „OK" echote, koennte ein geloeschtes falsches Netz
    // nicht von einem geloeschten richtigen unterscheiden.
    skript(
      'sudo',
      [
        `echo "$*" >> "${logDatei}"`,
        'prog="$2"; shift 2',
        'case "$prog" in',
        '  */wpa_cli)',
        '    shift 2', // -i wlan0
        '    befehl="$1"; shift',
        '    case "$befehl" in',
        `      list_networks) printf 'network id / ssid / bssid / flags\\n'; cat "${netzeDatei}" ;;`,
        `      status) cat "${statusDatei}" ;;`,
        '      get_network)',
        `        w=$(sed -n "s/^$1=//p" "${prioDatei}")`,
        '        if [ -n "$w" ]; then echo "$w"; else echo FAIL; fi ;;',
        '      set_network)',
        `        if [ "$2" = priority ]; then`,
        `          sed -i "/^$1=/d" "${prioDatei}"; echo "$1=$3" >> "${prioDatei}"`,
        '        fi',
        '        echo OK ;;',
        '      select_network)',
        `        awk -F'\\t' -v id="$1" 'BEGIN{OFS="\\t"} {$4 = ($1==id ? "[CURRENT]" : ""); print}' "${netzeDatei}" > "${netzeDatei}.neu"`,
        `        mv "${netzeDatei}.neu" "${netzeDatei}"; echo OK ;;`,
        '      remove_network)',
        `        awk -F'\\t' -v id="$1" '$1 != id' "${netzeDatei}" > "${netzeDatei}.neu"`,
        `        mv "${netzeDatei}.neu" "${netzeDatei}"; echo OK ;;`,
        '      enable_network|save_config|reconfigure) echo OK ;;',
        '      *) echo FAIL ;;',
        '    esac ;;',
        '  */netz-watchdog.py)',
        '    case "$1" in',
        '      stand) echo \'{"scharf":false}\' ;;',
        '      *) echo OK ;;',
        '    esac ;;',
        '  *) echo OK ;;',
        'esac',
      ].join('\n'),
    )

    process.env.PATH = `${bin}:${process.env.PATH ?? ''}`
    process.env.MUPIBOX_CONFIG_DIR = ordner
    const modul = await import('./server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('GET /api/netzwerk/gespeichert nennt Kennung, Name und wo die Box haengt', async () => {
    netzeSetzen(ZWEI_NETZE)
    const r = await request(app).get('/api/netzwerk/gespeichert').expect(200)
    assert.equal(r.body.ok, true)
    assert.equal(r.body.schnittstelle, 'wlan0')
    assert.deepEqual(r.body.netze, [
      { id: 0, ssid: 'Heimnetz', aktuell: true, abgeschaltet: false },
      { id: 3, ssid: 'Gastnetz', aktuell: false, abgeschaltet: false },
    ])
  })

  /* ── Die Schranke ────────────────────────────────────────────────────────
   *
   * Der Endpunkt darf keine Zahl annehmen, die er nicht selbst gerade aus
   * `list_networks` gelesen hat. Geprueft wird beides: die Antwort IST rot,
   * UND es ging kein Befehl hinaus. Nur die Antwort zu pruefen liesse offen,
   * ob der Fehler erst NACH der Tat auffiel.
   */
  it('VERBINDEN lehnt eine Kennung ab, die es nicht gibt — und tut nichts', async () => {
    netzeSetzen(ZWEI_NETZE)
    logLeeren()
    const r = await request(app)
      .post('/api/netzwerk/gespeichert/verbinden')
      .send({ kennung: 7 })
      .expect(400)
    assert.equal(r.body.ok, false)
    assert.match(r.body.error, /Netzkennung/)
    assert.ok(
      !mitgeschrieben().some((z) => z.includes('select_network')),
      `es haette nichts gewaehlt werden duerfen: ${JSON.stringify(mitgeschrieben())}`,
    )
  })

  it('VERGESSEN lehnt dieselbe erfundene Kennung ab — und loescht nichts', async () => {
    netzeSetzen(ZWEI_NETZE)
    logLeeren()
    await request(app)
      .post('/api/netzwerk/gespeichert/vergessen')
      .send({ kennung: 7 })
      .expect(400)
    assert.ok(
      !mitgeschrieben().some((z) => z.includes('remove_network')),
      `es haette nichts geloescht werden duerfen: ${JSON.stringify(mitgeschrieben())}`,
    )
    // Und die Liste steht noch vollstaendig da.
    const r = await request(app).get('/api/netzwerk/gespeichert').expect(200)
    assert.equal(r.body.netze.length, 2)
  })

  it('„all" ist bei wpa_cli ein gueltiges Wort — hier wird es abgewiesen', async () => {
    netzeSetzen(ZWEI_NETZE)
    logLeeren()
    await request(app)
      .post('/api/netzwerk/gespeichert/vergessen')
      .send({ kennung: 'all' })
      .expect(400)
    assert.ok(!mitgeschrieben().some((z) => z.includes('remove_network')))
  })

  /* ── Die Tat ─────────────────────────────────────────────────────────── */

  it('VERBINDEN waehlt GENAU das bestellte Netz — ohne dass ein Passwort fiel', async () => {
    netzeSetzen(ZWEI_NETZE)
    logLeeren()
    const r = await request(app)
      .post('/api/netzwerk/gespeichert/verbinden')
      .send({ kennung: 3 })
      .expect(200)
    assert.equal(r.body.ok, true)
    assert.equal(r.body.ssid, 'Gastnetz')
    // supertest kommt ueber die Rueckschleife — also „am Geraet".
    assert.equal(r.body.amGeraet, true)

    const log = mitgeschrieben()
    assert.ok(
      log.some((z) => /select_network 3$/.test(z)),
      `erwartet select_network 3, mitgeschrieben: ${JSON.stringify(log)}`,
    )
    // Und NICHT das andere Netz. Das ist die Aussage, die eine Attrappe mit
    // blossem „OK" nicht treffen koennte.
    assert.ok(!log.some((z) => /select_network 0$/.test(z)))
    // add_network waere der alte Weg — genau der, der ein Passwort verlangt.
    assert.ok(!log.some((z) => z.includes('add_network')))
    assert.ok(!log.some((z) => z.includes('psk')))

    // Die anderen gelernten Netze bleiben gespeicherte Netze (14.08.2026).
    assert.ok(log.some((z) => z.includes('enable_network all')))
    // Am Geraet wird sofort festgeschrieben — sonst waere die Wahl beim
    // naechsten Neustart wieder weg.
    assert.ok(log.some((z) => z.includes('save_config')))
  })

  it('VON 127.0.1.1 gilt die Box als „am Geraet" — kein Totmannschalter', async () => {
    // Der Installer schreibt `127.0.1.1 <Rechnername>` in /etc/hosts
    // (remote-step-installer/recipes/mupibox-app.yaml:233). Die alte
    // Dreier-Liste (127.0.0.1 / ::1 / ::ffff:127.0.0.1) kannte diese Adresse
    // nicht — wer vor der Box stand und sie unter ihrem Namen ansprach, bekam
    // einen Wecker mit 150 s Frist auf ein Passwort, das er auf einer
    // 8x4-Bildschirmtastatur tippt. Genau die Klage vom 12.08.2026.
    netzeSetzen(ZWEI_NETZE)
    logLeeren()
    const a = await vonAussen('/api/netzwerk/gespeichert/verbinden', { kennung: 3 }, '127.0.1.1')
    assert.equal(a.status, 200)
    assert.equal(a.koerper.amGeraet, true, '127.0.1.1 IST die Rueckschleife')
    const log = mitgeschrieben()
    assert.ok(
      !log.some((z) => z.includes('netz-watchdog.py scharf')),
      `kein Wecker, wenn jemand davorsteht: ${JSON.stringify(log)}`,
    )
    // Am Geraet wird sofort festgeschrieben — sonst waere die Wahl beim
    // naechsten Neustart wieder weg.
    assert.ok(
      log.some((z) => z.includes('save_config')),
      `nicht festgeschrieben: ${JSON.stringify(log)}`,
    )
  })

  it('DER VORRANG WIRD GERECHNET: zwei Netze mit Prioritaet 10 sind ein Gleichstand', async () => {
    netzeSetzen(ZWEI_NETZE)
    writeFileSync(prioDatei, '0=10\n3=10\n')
    logLeeren()
    await request(app).post('/api/netzwerk/gespeichert/verbinden').send({ kennung: 3 }).expect(200)
    const gesetzt = mitgeschrieben().find((z) => z.includes('set_network 3 priority'))
    assert.ok(gesetzt, `keine Prioritaet gesetzt: ${JSON.stringify(mitgeschrieben())}`)
    // 11, nicht 10: eine feste Zahl waere hier kein Vorrang, und
    // wpa_supplicant duerfte nach dem enable_network all zum staerkeren
    // ALTEN Netz zurueckspringen.
    assert.match(gesetzt, /priority 11$/)
  })

  it('schon verbunden ist kein Wechsel — und stellt keinen Wecker', async () => {
    netzeSetzen(ZWEI_NETZE)
    logLeeren()
    const r = await request(app)
      .post('/api/netzwerk/gespeichert/verbinden')
      .send({ kennung: 0 })
      .expect(200)
    assert.equal(r.body.schonVerbunden, true)
    assert.ok(!mitgeschrieben().some((z) => z.includes('select_network')))
    assert.ok(!mitgeschrieben().some((z) => z.includes('netz-watchdog.py scharf')))
  })

  /* ── Vergessen ───────────────────────────────────────────────────────── */

  it('VERGESSEN entfernt genau ein Netz und schreibt es fest', async () => {
    netzeSetzen(ZWEI_NETZE)
    logLeeren()
    const r = await request(app)
      .post('/api/netzwerk/gespeichert/vergessen')
      .send({ kennung: 3 })
      .expect(200)
    assert.equal(r.body.ok, true)
    assert.equal(r.body.ssid, 'Gastnetz')
    // Die Antwort traegt die neue Liste — die Kennungen wandern nach einem
    // Neustart von wpa_supplicant, eine gemerkte Zahl waere ein Loeschbefehl
    // mit Verfallsdatum.
    assert.deepEqual(
      r.body.netze.map((n: { ssid: string }) => n.ssid),
      ['Heimnetz'],
    )
    const log = mitgeschrieben()
    assert.ok(log.some((z) => /remove_network 3$/.test(z)))
    assert.ok(!log.some((z) => /remove_network 0$/.test(z)))
    // Ohne save_config waere das Netz beim naechsten Neustart wieder da —
    // „vergessen" waere eine Anzeige ohne Wirkung.
    assert.ok(log.some((z) => z.includes('save_config')))
  })

  it('DAS AKTUELLE NETZ laesst sich NICHT vergessen — 409 statt Selbstabschaltung', async () => {
    netzeSetzen(ZWEI_NETZE)
    logLeeren()
    const r = await request(app)
      .post('/api/netzwerk/gespeichert/vergessen')
      .send({ kennung: 0 })
      .expect(409)
    assert.equal(r.body.ok, false)
    assert.match(r.body.error, /hängt gerade in diesem Netz/)
    assert.ok(
      !mitgeschrieben().some((z) => z.includes('remove_network')),
      'abgelehnt heisst: kein Befehl',
    )
  })

  /* ── Der Rueckweg ────────────────────────────────────────────────────────
   *
   * Nur AUS DER FERNE gibt es einen Totmannschalter — am Geraet steht jemand
   * davor und kann sich nicht aussperren. Dieser Aufruf setzt deshalb den
   * Absender am Transport auf eine LAN-Adresse (siehe Kopf und `vonAussen`).
   *
   * Bewiesen werden BEIDE Haelften der Sicherung, denn eine ohne die andere
   * ist keine: der Wecker wird SCHARF GESTELLT, bevor etwas geschieht, und er
   * wird ENTSCHAERFT, sobald die Box beweisbar im bestellten Netz haengt
   * (traegtDasNetz: COMPLETED, richtige SSID, DHCP-Adresse). Bliebe die
   * Entwarnung aus, rollte er die gesicherte wpa_supplicant.conf zurueck —
   * das ist der Rueckweg, und er ist derselbe wie beim Verbinden mit Passwort.
   */
  it('AUS DER FERNE: erst Wecker stellen, dann waehlen, dann selbst bestaetigen', async () => {
    netzeSetzen(ZWEI_NETZE)
    logLeeren()
    // Die Box wird gleich beweisbar im Gastnetz haengen — genau das laesst
    // die Selbstpruefung festschreiben und entwarnen.
    statusSetzen('wpa_state=COMPLETED\nssid=Gastnetz\nip_address=192.168.178.34')

    const antwort = await vonAussen('/api/netzwerk/gespeichert/verbinden', { kennung: 3 })
    assert.equal(antwort.status, 200)
    assert.equal(antwort.koerper.amGeraet, false, 'ein Ruf aus dem LAN gilt als fern')
    assert.equal(antwort.koerper.gesichert, true)
    assert.ok(Number(antwort.koerper['bestaetigenBis']) > 0)

    const log = mitgeschrieben()
    // ERST der Wecker, DANN die Wahl — die Reihenfolge ist die Sicherung.
    const scharf = log.findIndex((z) => z.includes('netz-watchdog.py scharf'))
    const gewaehlt = log.findIndex((z) => /select_network 3$/.test(z))
    assert.ok(scharf >= 0, `kein Wecker gestellt: ${JSON.stringify(log)}`)
    assert.ok(gewaehlt > scharf, 'der Wecker muss VOR dem Wechsel stehen')
    // Aus der Ferne wird NICHT sofort festgeschrieben: solange nichts auf
    // Platte steht, ist der alte Stand der Rueckweg.
    assert.ok(
      !log.slice(0, gewaehlt + 1).some((z) => z.includes('save_config')),
      'vor dem Beweis darf nichts auf Platte',
    )

    // Die Selbstpruefung fragt alle drei Sekunden. Etwas Luft dazu.
    await new Promise((f) => setTimeout(f, 7000))
    const spaeter = mitgeschrieben()
    assert.ok(
      spaeter.some((z) => z.includes('save_config')),
      `nach dem Beweis muss festgeschrieben werden: ${JSON.stringify(spaeter)}`,
    )
    assert.ok(
      spaeter.some((z) => z.includes('netz-watchdog.py entwarnung')),
      'und der Wecker muss entschaerft werden, sonst rollt er den Erfolg zurueck',
    )
  })
})

/**
 * Ein Aufruf, der fuer die Route NICHT „am Geraet" ist.
 *
 * ZWEITER ANLAUF (19.09.2026, AUDIT Rang 4). Hier stand `localAddress:
 * '127.0.0.2'` — eine gebundene Quelladresse, die unter der alten
 * Dreier-Liste (127.0.0.1 / ::1 / ::ffff:127.0.0.1) als „fern" durchging.
 * Seit die Route mit `istRueckschleife` prueft, gilt GANZ 127.0.0.0/8 als „am
 * Geraet", und das ist richtig so: 127.0.0.2 IST die Rueckschleife, dort
 * steht jemand vor der Box. Der Trick hat damit aufgehoert zu funktionieren —
 * er hat nie eine Ferne gemessen, sondern eine Luecke in der Adressliste.
 *
 * FERNE WIRD DESHALB AM TRANSPORT ERZEUGT, nicht an einer Adresse, die
 * zufaellig durchs Raster fiel: ein eigener `http.createServer` setzt
 * `remoteAddress` auf eine LAN-Adresse und uebergibt an die echte App. Dass
 * ein fremder Rechner umgekehrt keinen Absender aus 127/8 waehlen kann, ist
 * eine Eigenschaft des Kerns (RFC 1122 3.2.1.3; Linux verwirft 127/8 auf
 * einem anderen Geraet als `lo` als Martian-Quelle) und gehoert nicht in
 * diesen Test.
 */
const FERNE_ADRESSE = '192.168.178.75'

function vonAussen(
  weg: string,
  koerper: unknown,
  absender: string = FERNE_ADRESSE,
): Promise<{ status: number; koerper: Record<string, unknown> }> {
  return new Promise((fertig, fehler) => {
    const lauscher = httpServer((anfrageEin, antwortAus) => {
      Object.defineProperty(anfrageEin.socket, 'remoteAddress', {
        value: absender,
        configurable: true,
      })
      app(anfrageEin, antwortAus)
    }).listen(0, '127.0.0.1', () => {
      const port = (lauscher.address() as AddressInfo).port
      const daten = JSON.stringify(koerper)
      const anfrage = httpAnfrage(
        {
          host: '127.0.0.1',
          port,
          path: weg,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(daten) },
        },
        (antwort) => {
          let text = ''
          antwort.on('data', (t) => {
            text += t
          })
          antwort.on('end', () => {
            lauscher.close()
            try {
              fertig({ status: antwort.statusCode ?? 0, koerper: JSON.parse(text || '{}') })
            } catch (e) {
              fehler(e)
            }
          })
        },
      )
      anfrage.on('error', (e) => {
        lauscher.close()
        fehler(e)
      })
      anfrage.end(daten)
    })
  })
}
