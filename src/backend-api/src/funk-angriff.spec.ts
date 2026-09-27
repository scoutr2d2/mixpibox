/**
 * GEGENPROBE: kann sich die Box aussperren?
 *
 * Die Lage der echten Box: NUR wlan0 traegt, eth0 ist da und hat nichts. Von
 * dort aus wird versucht, das WLAN loszuwerden — ueber jeden Weg, der offen
 * steht. Kommt einer durch, ist die Box nur noch mit Stromziehen zurueckzuholen.
 *
 * NICHTS DAVON LAEUFT AN DER BOX. `ip`, `bluetoothctl` und `sudo` sind
 * Attrappen aus einem Verzeichnis vor dem PATH, /sys/class/net ist nachgebaut.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner: string
let ipDatei: string
let sudoLog: string

const NUR_WLAN = [
  { ifname: 'eth0', operstate: 'DOWN', addr_info: [] },
  {
    ifname: 'wlan0',
    operstate: 'UP',
    addr_info: [{ family: 'inet', local: '192.168.178.169', prefixlen: 24, scope: 'global' }],
  },
]

/** Kabel ab, Adresse noch da: der Kernel wirft eine DHCP-Adresse nicht sofort weg. */
const KABEL_AB_ADRESSE_BLEIBT = [
  {
    ifname: 'eth0',
    operstate: 'DOWN',
    addr_info: [{ family: 'inet', local: '192.168.178.42', prefixlen: 24, scope: 'global' }],
  },
  {
    ifname: 'wlan0',
    operstate: 'UP',
    addr_info: [{ family: 'inet', local: '192.168.178.169', prefixlen: 24, scope: 'global' }],
  },
]

/** eth0 ohne DHCP-Server: 169.254.x.y, scope link — erreicht niemand aus dem LAN. */
const NUR_ZEROCONF = [
  {
    ifname: 'eth0',
    operstate: 'UP',
    addr_info: [{ family: 'inet', local: '169.254.7.9', prefixlen: 16, scope: 'link' }],
  },
  {
    ifname: 'wlan0',
    operstate: 'UP',
    addr_info: [{ family: 'inet', local: '192.168.178.169', prefixlen: 24, scope: 'global' }],
  },
]

/** Ein VPN oder Container-Bruecke, die selbst ueber das WLAN laeuft. */
const TUNNEL_UEBER_WLAN = [
  { ifname: 'eth0', operstate: 'DOWN', addr_info: [] },
  {
    ifname: 'wlan0',
    operstate: 'UP',
    addr_info: [{ family: 'inet', local: '192.168.178.169', prefixlen: 24, scope: 'global' }],
  },
  {
    ifname: 'tun0',
    operstate: 'UNKNOWN',
    addr_info: [{ family: 'inet', local: '10.8.0.6', prefixlen: 24, scope: 'global' }],
  },
]

/** sysfs je Anschluss setzen — Traeger und Zustand gehoeren zur Lage dazu. */
function sysSetzen(name: string, carrier: string, operstate: string): void {
  writeFileSync(join(ordner, 'sys-net', name, 'carrier'), carrier)
  writeFileSync(join(ordner, 'sys-net', name, 'operstate'), `${operstate}\n`)
}

function lage(daten: unknown): void {
  writeFileSync(ipDatei, JSON.stringify(daten))
}

function geschaltet(): string[] {
  try {
    return readFileSync(sudoLog, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** Warten und dann sehen, ob doch noch etwas abgesetzt wurde. */
async function nichtsPassiert(vorher: number, was: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 1000))
  assert.equal(geschaltet().length, vorher, `${was}: es wurde doch geschaltet — ${JSON.stringify(geschaltet())}`)
}

describe('Aussperr-Gegenprobe', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-funk-angriff-'))
    ipDatei = join(ordner, 'ip.json')
    sudoLog = join(ordner, 'sudo.log')
    lage(NUR_WLAN)
    writeFileSync(sudoLog, '')

    const sys = join(ordner, 'sys-net')
    mkdirSync(join(sys, 'eth0'), { recursive: true })
    mkdirSync(join(sys, 'wlan0'), { recursive: true })
    mkdirSync(join(sys, 'tun0'), { recursive: true })
    // Echte Hardware hat `device`, Funk hat `wireless` — an der Box
    // nachgesehen. tun0 bekommt ABSICHTLICH kein `device`: genau daran ist ein
    // Tunnel zu erkennen, der selbst ueber das WLAN laeuft.
    mkdirSync(join(sys, 'eth0', 'device'), { recursive: true })
    mkdirSync(join(sys, 'wlan0', 'device'), { recursive: true })
    mkdirSync(join(sys, 'wlan0', 'wireless'), { recursive: true })
    writeFileSync(join(sys, 'eth0', 'carrier'), '')
    writeFileSync(join(sys, 'eth0', 'operstate'), 'down\n')
    writeFileSync(join(sys, 'wlan0', 'carrier'), '1\n')
    writeFileSync(join(sys, 'wlan0', 'operstate'), 'up\n')
    writeFileSync(join(sys, 'tun0', 'carrier'), '1\n')
    writeFileSync(join(sys, 'tun0', 'operstate'), 'unknown\n')

    const bin = join(ordner, 'bin')
    mkdirSync(bin, { recursive: true })
    const skript = (name: string, inhalt: string) => {
      const p = join(bin, name)
      writeFileSync(p, `#!/bin/sh\n${inhalt}\n`)
      chmodSync(p, 0o755)
    }
    skript('ip', `cat "${ipDatei}"`)
    skript('bluetoothctl', 'echo "	Powered: yes"')
    skript('sudo', `echo "$*" >> "${sudoLog}"`)

    process.env.PATH = `${bin}:${process.env.PATH ?? ''}`
    process.env.MUPIBOX_SYS_NET = sys
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPIBOX_FUNK_SCHALTWEG = 'ifupdown'
    const modul = await import('./server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_SYS_NET = undefined
    process.env.MUPIBOX_FUNK_SCHALTWEG = undefined
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('A: nackter Aufruf ohne alles -> 409', async () => {
    lage(NUR_WLAN)
    writeFileSync(sudoLog, '')
    await request(app).post('/api/funk/wlan').send({ an: false }).expect(409)
    await request(app).post('/api/funk/flug').send({ an: true }).expect(409)
    await nichtsPassiert(0, 'nackter Aufruf')
  })

  it('B: vorOrt in allen Verkleidungen, die kein echtes true sind -> 409', async () => {
    lage(NUR_WLAN)
    writeFileSync(sudoLog, '')
    for (const v of ['true', 1, 'ja', [true], { toString: () => 'true' }, 'TRUE']) {
      await request(app).post('/api/funk/wlan').send({ an: false, vorOrt: v }).expect(409)
    }
    // Formular statt JSON: alles wird zu Text, `an` ist dann kein false mehr.
    await request(app)
      .post('/api/funk/wlan')
      .type('form')
      .send('an=false&vorOrt=true')
      .expect((r) => assert.notEqual(r.status, 200))
    // Erst den Prototyp vergiften, dann ohne vorOrt anklopfen: waere `vorOrt`
    // ueber Object.prototype erreichbar, gaebe der naechste Aufruf 200.
    await request(app)
      .post('/api/funk/bluetooth')
      .set('Content-Type', 'application/json')
      .send('{"an":true,"__proto__":{"vorOrt":true}}')
    await request(app).post('/api/funk/wlan').send({ an: false }).expect(409)
    assert.equal(({} as { vorOrt?: unknown }).vorOrt, undefined, 'Object.prototype wurde vergiftet')
    await nichtsPassiert(0, 'verkleidetes vorOrt')
  })

  it('C: Koepfe, die „ich bin die Box" behaupten, aendern nichts -> 409', async () => {
    lage(NUR_WLAN)
    writeFileSync(sudoLog, '')
    // DIE DRITTE SPALTE IST DER STATUS, DEN DIESER KOPF BEKOMMT — und dass es
    // zwei verschiedene gibt, ist die Aussage:
    //
    //   409  Der Weg selbst hat abgelehnt: „vorOrt fehlt". Genau das soll ein
    //        geschickter Kopf NICHT aendern.
    //   403  Der Herkunftsriegel (herkunft.ts) hat schon vorher abgelehnt.
    //        `Origin: http://localhost:8200` gegen einen `Host`, der auf den
    //        Testport zeigt, IST eine fremde Herkunft — mehr noch: aus einem
    //        Browser kann diese Kombination gar nicht entstehen, denn er baut
    //        beide Kopfzeilen aus derselben Adresse. Wer hier 409 verlangte,
    //        verlangte, dass ein gefaelschter `Origin` bis zum Weg durchkommt.
    //
    // Beide Male passiert NICHTS — das prueft `nichtsPassiert` unten, und das
    // ist die eigentliche Zusage dieses Falls.
    const koepfe: [string, string, number][] = [
      ['X-Forwarded-For', '127.0.0.1', 409],
      ['X-Real-IP', '127.0.0.1', 409],
      ['Forwarded', 'for=127.0.0.1', 409],
      ['Host', 'localhost', 409],
      ['Origin', 'http://localhost:8200', 403],
      ['Referer', 'http://127.0.0.1:8200/admin', 409],
    ]
    for (const [k, v, erwartet] of koepfe) {
      await request(app).post('/api/funk/wlan').set(k, v).send({ an: false }).expect(erwartet)
      await request(app).post('/api/funk/flug').set(k, v).send({ an: true }).expect(erwartet)
    }
    await nichtsPassiert(0, 'geschickte Koepfe')
  })

  /** Eine eigene Adresse, die KEIN Loopback ist — damit „aus der Ferne" echt ist. */
  function eigeneLanAdresse(): string | null {
    for (const liste of Object.values(networkInterfaces())) {
      for (const a of liste ?? []) {
        if (a.family === 'IPv4' && !a.internal) return a.address
      }
    }
    return null
  }

  it('D: AUS DER FERNE hilft weder vorOrt noch ein Kopf -> 409', async () => {
    lage(NUR_WLAN)
    const lan = eigeneLanAdresse()
    if (!lan) {
      // Ohne eine zweite eigene Adresse laesst sich „aus der Ferne" auf diesem
      // Rechner nicht herstellen. Dann wird die Aussage NICHT behauptet —
      // lieber eine Luecke im Testlauf als ein gruener Haken ohne Deckung.
      return
    }
    // supertest verbindet IMMER ueber 127.0.0.1 und ist damit blind fuer genau
    // diese Frage. Deshalb hier ein echter Zuhoerer auf der LAN-Adresse: die
    // Gegenstelle der Verbindung ist dann nachweislich kein Loopback.
    writeFileSync(sudoLog, '')
    const srv = createServer(app)
    await new Promise<void>((f) => srv.listen(0, lan, () => f()))
    const port = (srv.address() as { port: number }).port
    try {
      for (const kopf of [{}, { 'X-Forwarded-For': '127.0.0.1' }, { 'X-Real-IP': '::1' }]) {
        for (const wohin of ['wlan', 'flug']) {
          const r = await fetch(`http://${lan}:${port}/api/funk/${wohin}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...kopf },
            body: JSON.stringify({ an: wohin === 'flug', vorOrt: true }),
          })
          assert.equal(r.status, 409, `aus der Ferne mit ${JSON.stringify(kopf)} auf ${wohin} durchgekommen`)
        }
      }
    } finally {
      srv.close()
    }
    await nichtsPassiert(0, 'aus der Ferne')
  })

  it('E: KABEL AB, Adresse noch da -> es gibt KEINEN zweiten Weg', async () => {
    lage(KABEL_AB_ADRESSE_BLEIBT)
    // Der Kernel meldet ausdruecklich „kein Traeger" — die DHCP-Adresse steht
    // nur noch da, bis ihre Laufzeit ablaeuft.
    sysSetzen('eth0', '0\n', 'down')
    writeFileSync(sudoLog, '')
    const g = await request(app).get('/api/funk').expect(200)
    assert.equal(g.body.ausErlaubt, false, 'eine Adresse ohne Kabel traegt niemanden')
    await request(app).post('/api/funk/wlan').send({ an: false }).expect(409)
    await nichtsPassiert(0, 'Kabel ab')
  })

  it('F: 169.254.x.y ist kein Weg ins LAN -> 409', async () => {
    lage(NUR_ZEROCONF)
    // Kabel steckt, Anschluss ist oben — nur hat kein DHCP-Server geantwortet.
    sysSetzen('eth0', '1\n', 'up')
    writeFileSync(sudoLog, '')
    const g = await request(app).get('/api/funk').expect(200)
    assert.equal(g.body.ausErlaubt, false, 'scope link erreicht niemand von aussen')
    await request(app).post('/api/funk/wlan').send({ an: false }).expect(409)
    await nichtsPassiert(0, 'zeroconf')
  })

  it('G: ein Tunnel, der selbst ueber das WLAN laeuft, ist kein Rueckweg -> 409', async () => {
    lage(TUNNEL_UEBER_WLAN)
    sysSetzen('eth0', '', 'down')
    writeFileSync(sudoLog, '')
    const g = await request(app).get('/api/funk').expect(200)
    assert.equal(g.body.ausErlaubt, false, 'tun0 geht mit dem WLAN weg')
    await request(app).post('/api/funk/wlan').send({ an: false }).expect(409)
    await nichtsPassiert(0, 'tunnel')
  })

  it('H: schnelles Doppeltippen ohne zweiten Weg bleibt bei 409', async () => {
    lage(NUR_WLAN)
    writeFileSync(sudoLog, '')
    const antworten = await Promise.all([
      request(app).post('/api/funk/wlan').send({ an: false }),
      request(app).post('/api/funk/flug').send({ an: true }),
      request(app).post('/api/funk/wlan').send({ an: false }),
      request(app).post('/api/funk/flug').send({ an: true }),
    ])
    for (const a of antworten) assert.equal(a.status, 409)
    await nichtsPassiert(0, 'Doppeltippen')
  })
})
