/**
 * Der Funkschalter am laufenden Server — und die Aussage, auf die es ankommt:
 *
 *   POST /api/funk/wlan {an:false} OHNE zweiten Weg  ->  409
 *   dasselbe MIT Kabel                                ->  200
 *
 * WARUM ALS INTEGRATIONSTEST UND NICHT NUR REIN: die Regel steht in funk.ts
 * und ist dort geprueft. Was hier bewiesen wird, ist etwas anderes — dass der
 * ENDPUNKT sie auch anwendet. Genau das ist der Unterschied zwischen einer
 * Warnung und einer Bedingung: eine Oberflaeche kann man umgehen, einen
 * Endpunkt, der 409 antwortet, nicht.
 *
 * AN DER BOX WIRD DABEI NICHTS GESCHALTET. `ip`, `bluetoothctl` und `sudo`
 * kommen aus einem Attrappenverzeichnis, das dem Lauf vor den PATH gelegt
 * wird; /sys/class/net wird ebenfalls nachgebaut. Der Test schaltet also
 * wirklich — nur eben nichts Echtes, und er schreibt mit, WOMIT geschaltet
 * wurde. Das ist die einzige Art, diese Regel zu pruefen, ohne genau das
 * Risiko einzugehen, das sie verhindern soll.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'
import { GRUND_KEIN_ZWEITER_WEG } from './funk'

let app: import('express').Express
let ordner: string
let ipDatei: string
let btDatei: string
let sudoLog: string
let sysNetz: string

/** `ip -j addr show`, so wie es an der Box aussieht: nur wlan0 traegt. */
const NUR_WLAN = [
  {
    ifname: 'eth0',
    operstate: 'DOWN',
    addr_info: [],
  },
  {
    ifname: 'wlan0',
    operstate: 'UP',
    addr_info: [{ family: 'inet', local: '192.168.178.169', prefixlen: 24 }],
  },
]

/** Dieselbe Box, aber mit Kabel MIT Adresse. */
const MIT_KABEL = [
  {
    ifname: 'eth0',
    operstate: 'UP',
    addr_info: [{ family: 'inet', local: '192.168.178.42', prefixlen: 24 }],
  },
  {
    ifname: 'wlan0',
    operstate: 'UP',
    addr_info: [{ family: 'inet', local: '192.168.178.169', prefixlen: 24 }],
  },
]

/**
 * Die Lage setzen — `ip addr` UND sysfs zusammen.
 *
 * BEIDES ZUSAMMEN, WEIL BEIDES ZUSAMMENGEHOERT: eine Adresse an eth0 ohne
 * Traeger ist keine Lage, die es gibt, sondern der Fall „Kabel gerade
 * gezogen". Wer nur die Adresse setzt, prueft eine Box, die es nicht gibt.
 */
function lage(daten: unknown, kabelSteckt = false): void {
  writeFileSync(ipDatei, JSON.stringify(daten))
  writeFileSync(join(sysNetz, 'eth0', 'carrier'), kabelSteckt ? '1\n' : '')
  writeFileSync(join(sysNetz, 'eth0', 'operstate'), kabelSteckt ? 'up\n' : 'down\n')
}

/** Was die Attrappe `sudo` mitgeschrieben hat. */
function geschaltet(): string[] {
  try {
    return readFileSync(sudoLog, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

describe('Funk: an, aus — und die Bedingung dazwischen', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-funk-'))
    ipDatei = join(ordner, 'ip.json')
    btDatei = join(ordner, 'bt-power')
    sudoLog = join(ordner, 'sudo.log')
    writeFileSync(btDatei, 'yes\n')
    writeFileSync(sudoLog, '')

    // /sys/class/net nachbauen — mit dem LEEREN carrier bei eth0, so wie der
    // Kernel es an der Box liefert (nicht '0'; die Datei ist bei einer
    // heruntergefahrenen Schnittstelle nicht lesbar).
    const sys = join(ordner, 'sys-net')
    sysNetz = sys
    mkdirSync(join(sys, 'eth0'), { recursive: true })
    mkdirSync(join(sys, 'wlan0'), { recursive: true })
    // `device` gibt es nur bei echter Hardware, `wireless` nur bei Funk — an
    // der Box nachgesehen und hier nachgebaut. Ohne `device` zaehlt eth0
    // NICHT als Rueckweg, und das ist Absicht: ein Tunnel hat keins.
    mkdirSync(join(sys, 'eth0', 'device'), { recursive: true })
    mkdirSync(join(sys, 'wlan0', 'device'), { recursive: true })
    mkdirSync(join(sys, 'wlan0', 'wireless'), { recursive: true })
    writeFileSync(join(sys, 'eth0', 'carrier'), '')
    writeFileSync(join(sys, 'eth0', 'operstate'), 'down\n')
    writeFileSync(join(sys, 'wlan0', 'carrier'), '1\n')
    writeFileSync(join(sys, 'wlan0', 'operstate'), 'up\n')
    lage(NUR_WLAN)

    // Die Attrappen. `ip` gibt die gerade gesetzte Lage aus, `bluetoothctl`
    // fuehrt seinen Zustand in einer Datei (damit das Zuruecklesen nach dem
    // Schalten etwas Echtes prueft), `sudo` schreibt nur mit.
    const bin = join(ordner, 'bin')
    mkdirSync(bin, { recursive: true })
    const skript = (name: string, inhalt: string) => {
      const p = join(bin, name)
      writeFileSync(p, `#!/bin/sh\n${inhalt}\n`)
      chmodSync(p, 0o755)
    }
    skript('ip', `cat "${ipDatei}"`)
    skript(
      'bluetoothctl',
      [
        'for a in "$@"; do',
        '  case "$a" in',
        `    on) echo yes > "${btDatei}" ;;`,
        `    off) echo no > "${btDatei}" ;;`,
        '  esac',
        'done',
        `echo "	Powered: $(cat "${btDatei}")"`,
      ].join('\n'),
    )
    skript('sudo', `echo "$*" >> "${sudoLog}"`)

    process.env.PATH = `${bin}:${process.env.PATH ?? ''}`
    process.env.MUPIBOX_SYS_NET = sys
    process.env.MUPIBOX_CONFIG_DIR = ordner
    // Fest auf ifupdown, damit der Test nicht davon abhaengt, ob auf dem
    // Entwicklungsrechner zufaellig /sbin/ifdown liegt.
    process.env.MUPIBOX_FUNK_SCHALTWEG = 'ifupdown'
    const modul = await import('./server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_SYS_NET = undefined
    process.env.MUPIBOX_FUNK_SCHALTWEG = undefined
    process.env.MUPIBOX_CONFIG_DIR = undefined
  })

  it('GET /api/funk sagt, welche Wege es nach draussen gibt', async () => {
    lage(NUR_WLAN)
    const r = await request(app).get('/api/funk').expect(200)
    assert.equal(r.body.wlan.an, true)
    assert.equal(r.body.wlan.name, 'wlan0')
    assert.equal(r.body.wlan.adresse, '192.168.178.169')
    assert.equal(r.body.bluetooth.an, true)
    assert.equal(r.body.flug, false)

    // Der wichtige Teil: JEDE Schnittstelle mit Adresse und Kabel — und die
    // Antwort auf „gibt es einen zweiten Weg zu dieser Box".
    const eth = r.body.wege.find((w: { name: string }) => w.name === 'eth0')
    assert.equal(eth.adresse, '')
    assert.equal(eth.kabel, null, 'leerer carrier heisst „unbekannt", nicht „kein Kabel"')
    assert.equal(eth.traegt, false)
    assert.equal(r.body.zweiterWeg, null)
    assert.equal(r.body.ausErlaubt, false)
    assert.equal(r.body.grund, GRUND_KEIN_ZWEITER_WEG)
    assert.equal(r.body.schaltweg, 'ifupdown')
  })

  it('DIE BEDINGUNG: WLAN aus ohne zweiten Weg wird mit 409 abgelehnt', async () => {
    lage(NUR_WLAN)
    const vorher = geschaltet().length
    const r = await request(app).post('/api/funk/wlan').send({ an: false }).expect(409)
    assert.equal(r.body.ok, false)
    assert.equal(r.body.error, GRUND_KEIN_ZWEITER_WEG)
    // Und es ist wirklich nichts passiert — nicht nur die Antwort war rot.
    await new Promise((r2) => setTimeout(r2, 900))
    assert.equal(geschaltet().length, vorher, 'abgelehnt heisst: kein Befehl')
  })

  it('Flugmodus ohne zweiten Weg ebenso — es ist derselbe Eingriff', async () => {
    lage(NUR_WLAN)
    const r = await request(app).post('/api/funk/flug').send({ an: true }).expect(409)
    assert.equal(r.body.error, GRUND_KEIN_ZWEITER_WEG)
  })

  it('MIT Kabel geht es durch — und die Antwort nennt die andere Adresse', async () => {
    lage(MIT_KABEL, true)
    const r = await request(app).get('/api/funk').expect(200)
    assert.equal(r.body.ausErlaubt, true)
    assert.equal(r.body.zweiterWeg.name, 'eth0')
    assert.equal(r.body.zweiterWeg.adresse, '192.168.178.42')

    const p = await request(app).post('/api/funk/wlan').send({ an: false }).expect(200)
    assert.equal(p.body.ok, true)
    assert.equal(p.body.ueber.adresse, '192.168.178.42')
    assert.match(p.body.hinweis, /192\.168\.178\.42/)
    // Wer gerade ueber WLAN verbunden ist, verliert trotzdem SEINE Sitzung —
    // das muss im selben Satz stehen.
    assert.match(p.body.hinweis, /über WLAN/)

    // Und jetzt WOMIT geschaltet wurde. Erst nach der Antwort, mit Absicht:
    // der Befehl kappt die Verbindung, ueber die die Antwort laufen wuerde.
    await new Promise((r2) => setTimeout(r2, 1200))
    assert.ok(
      geschaltet().some((z) => z.includes('/sbin/ifdown') && z.includes('wlan0')),
      `erwartet ifdown wlan0, mitgeschrieben: ${JSON.stringify(geschaltet())}`,
    )
  })

  it('DER WEG ZURUECK: an schaltet mit ifup wieder ein und belegt die Adresse', async () => {
    lage(MIT_KABEL, true)
    writeFileSync(sudoLog, '')
    const r = await request(app).post('/api/funk/wlan').send({ an: true }).expect(200)
    assert.equal(r.body.an, true)
    assert.equal(r.body.adresse, '192.168.178.169', 'die Adresse ist der Beleg, nicht der Rueckgabewert von ifup')
    const zeilen = geschaltet()
    assert.ok(
      zeilen.some((z) => z.includes('/sbin/ifup') && z.includes('wlan0')),
      `erwartet ifup wlan0, mitgeschrieben: ${JSON.stringify(zeilen)}`,
    )
  })

  it('von der Box selbst geht es auch ohne Kabel — aber nur ausdruecklich', async () => {
    lage(NUR_WLAN)
    writeFileSync(sudoLog, '')
    // supertest verbindet sich ueber 127.0.0.1, ist also „von der Box".
    // OHNE vorOrt bleibt es trotzdem bei 409 — Loopback allein reicht nicht,
    // sonst koennte ein Klick in einer alten Oberflaeche die Box aussperren.
    await request(app).post('/api/funk/wlan').send({ an: false }).expect(409)

    const r = await request(app).post('/api/funk/wlan').send({ an: false, vorOrt: true }).expect(200)
    assert.equal(r.body.nurVorOrt, true)
    assert.match(r.body.hinweis, /von der Box selbst/)
  })

  it('Bluetooth an/aus — und der Zustand wird nachgelesen, nicht behauptet', async () => {
    const aus = await request(app).post('/api/funk/bluetooth').send({ an: false }).expect(200)
    assert.equal(aus.body.an, false)
    assert.match(aus.body.hinweis, /Lautsprecher/)
    assert.equal(readFileSync(btDatei, 'utf8').trim(), 'no')

    const r = await request(app).get('/api/funk').expect(200)
    assert.equal(r.body.bluetooth.an, false)

    const an = await request(app).post('/api/funk/bluetooth').send({ an: true }).expect(200)
    assert.equal(an.body.an, true)
  })

  it('weist Unsinn ab, statt ihn als „aus" zu deuten', async () => {
    await request(app).post('/api/funk/bluetooth').send({}).expect(400)
    await request(app).post('/api/funk/wlan').send({ an: 'nein' }).expect(400)
    await request(app).post('/api/funk/flug').send({ an: 0 }).expect(400)
  })
})
