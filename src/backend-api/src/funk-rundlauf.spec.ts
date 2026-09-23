/**
 * KOMMT DER FLUGMODUS WIEDER ZURUECK?
 *
 * Ein Schalter, der nur in eine Richtung geht, ist auf einem Geraet ohne
 * Tastatur eine Sackgasse. Deshalb wird hier nicht die Antwort geprueft,
 * sondern der ZUSTAND danach: die Attrappe `sudo` aendert bei `ifdown`/`ifup`
 * wirklich das, was `ip addr` anschliessend ausgibt. Aus und an, mehrfach.
 *
 * Und die zweite Frage, die dazugehoert: WAS, WENN DAS SCHALTEN SCHEITERT?
 * `sudo -n` verlangt kein Passwort, es scheitert stattdessen — und alle
 * An-Befehle sind absichtlich „weich". Der Server darf danach nicht `ok`
 * sagen. Auf dieser Box antwortet jeder Pfad mit 200; die Wirkung zaehlt.
 *
 * NICHTS DAVON LAEUFT AN DER BOX.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner: string
let ipDatei: string
let anDatei: string
let ausDatei: string
let btDatei: string
let sudoSchaltet: string

const eth0Auf = {
  ifname: 'eth0',
  operstate: 'UP',
  addr_info: [{ family: 'inet', local: '192.168.178.42', prefixlen: 24 }],
}

/** WLAN laeuft: Adresse da, Anschluss oben. */
const WLAN_AN = [
  eth0Auf,
  {
    ifname: 'wlan0',
    operstate: 'UP',
    addr_info: [{ family: 'inet', local: '192.168.178.169', prefixlen: 24 }],
  },
]

/** Nach `ifdown wlan0`: die Schnittstelle ist noch da, Adresse und Zustand weg. */
const WLAN_AUS = [eth0Auf, { ifname: 'wlan0', operstate: 'DOWN', addr_info: [] }]

function zustand(): 'an' | 'aus' {
  return readFileSync(ipDatei, 'utf8').includes('192.168.178.169') ? 'an' : 'aus'
}

/** Startlage: WLAN an — in `ip` UND in sysfs, so wie es an der Box zusammengehoert. */
function wlanAnSetzen(): void {
  writeFileSync(ipDatei, JSON.stringify(WLAN_AN))
  writeFileSync(join(ordner, 'sys-net', 'wlan0', 'operstate'), 'up\n')
  writeFileSync(join(ordner, 'sys-net', 'wlan0', 'carrier'), '1\n')
}

describe('Funk: der Weg zurueck', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-funk-rund-'))
    ipDatei = join(ordner, 'ip.json')
    anDatei = join(ordner, 'an.json')
    ausDatei = join(ordner, 'aus.json')
    btDatei = join(ordner, 'bt-power')
    sudoSchaltet = join(ordner, 'sudo-schaltet')
    writeFileSync(anDatei, JSON.stringify(WLAN_AN))
    writeFileSync(ausDatei, JSON.stringify(WLAN_AUS))
    writeFileSync(ipDatei, JSON.stringify(WLAN_AN))
    writeFileSync(btDatei, 'yes\n')
    writeFileSync(sudoSchaltet, 'ja')

    const sys = join(ordner, 'sys-net')
    for (const n of ['eth0', 'wlan0']) {
      mkdirSync(join(sys, n, 'device'), { recursive: true })
      writeFileSync(join(sys, n, 'carrier'), '1\n')
      writeFileSync(join(sys, n, 'operstate'), 'up\n')
    }
    mkdirSync(join(sys, 'wlan0', 'wireless'), { recursive: true })

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
        `  case "$a" in on) echo yes > "${btDatei}" ;; off) echo no > "${btDatei}" ;; esac`,
        'done',
        `echo "	Powered: $(cat "${btDatei}")"`,
      ].join('\n'),
    )
    // Die Attrappe SCHALTET WIRKLICH — sie schreibt um, was `ip` danach
    // ausgibt. Nur so beweist der Testlauf einen Zustand statt einer Antwort.
    // Steht in `sudo-schaltet` etwas anderes als `ja`, verhaelt sie sich wie
    // `sudo -n` ohne Rechte: sie scheitert und aendert nichts.
    skript(
      'sudo',
      [
        `if [ "$(cat "${sudoSchaltet}")" != "ja" ]; then`,
        '  echo "sudo: a password is required" >&2; exit 1',
        'fi',
        'case "$*" in',
        `  *ifdown*wlan0*|*"link set wlan0 down"*)`,
        `    cp "${ausDatei}" "${ipDatei}"`,
        // sysfs geht MIT — der Kernel meldet nach einem ifdown auch dort
        // „down". Nur beides zusammen ist die Lage, die es wirklich gibt.
        `    printf 'down\\n' > "${join(ordner, 'sys-net', 'wlan0', 'operstate')}"`,
        `    printf '' > "${join(ordner, 'sys-net', 'wlan0', 'carrier')}" ;;`,
        `  *ifup*wlan0*)`,
        `    cp "${anDatei}" "${ipDatei}"`,
        `    printf 'up\\n' > "${join(ordner, 'sys-net', 'wlan0', 'operstate')}"`,
        `    printf '1\\n' > "${join(ordner, 'sys-net', 'wlan0', 'carrier')}" ;;`,
        'esac',
        'exit 0',
      ].join('\n'),
    )

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

  it('Flugmodus: an und wieder aus — dreimal hintereinander', async () => {
    for (let runde = 1; runde <= 3; runde++) {
      wlanAnSetzen()
      writeFileSync(btDatei, 'yes\n')

      const an = await request(app).post('/api/funk/flug').send({ an: true }).expect(200)
      assert.equal(an.body.flug, true, `Runde ${runde}`)
      // Erst antworten, dann schalten — deshalb hier warten.
      await new Promise((r) => setTimeout(r, 1400))
      assert.equal(zustand(), 'aus', `Runde ${runde}: das WLAN ist nicht ausgegangen`)
      assert.equal(readFileSync(btDatei, 'utf8').trim(), 'no', `Runde ${runde}: Bluetooth blieb an`)

      const zurueck = await request(app).post('/api/funk/flug').send({ an: false }).expect(200)
      assert.equal(zurueck.body.ok, true, `Runde ${runde}: die Rueckrichtung meldete keinen Erfolg`)
      assert.equal(zurueck.body.wlan.an, true, `Runde ${runde}`)
      assert.equal(zurueck.body.wlan.adresse, '192.168.178.169', `Runde ${runde}: keine Adresse zurueck`)
      assert.equal(zurueck.body.bluetooth.an, true, `Runde ${runde}: Bluetooth kam nicht zurueck`)
      assert.equal(zustand(), 'an', `Runde ${runde}: das WLAN kam nicht zurueck`)
    }
  })

  it('WLAN einzeln: aus und wieder an, und die Adresse ist der Beleg', async () => {
    wlanAnSetzen()
    await request(app).post('/api/funk/wlan').send({ an: false }).expect(200)
    await new Promise((r) => setTimeout(r, 1400))
    assert.equal(zustand(), 'aus')

    const r = await request(app).post('/api/funk/wlan').send({ an: true }).expect(200)
    assert.equal(r.body.an, true)
    assert.equal(r.body.adresse, '192.168.178.169')
    assert.equal(zustand(), 'an')
  })

  it('DER STILLE FALL: scheitert das Einschalten, sagt der Server NICHT ok', async () => {
    // Zuerst wirklich abschalten, dann `sudo` die Rechte nehmen. Genau die
    // Lage, in der die Box haengenbleiben wuerde: aus, und das An geht nicht.
    wlanAnSetzen()
    await request(app).post('/api/funk/wlan').send({ an: false }).expect(200)
    await new Promise((r) => setTimeout(r, 1400))
    assert.equal(zustand(), 'aus')

    writeFileSync(sudoSchaltet, 'nein')
    // Kuerzere Wartezeit auf die Adresse — hier kommt sowieso keine.
    process.env.MUPIBOX_FUNK_SCHALTWEG = 'ip'
    try {
      const r = await request(app).post('/api/funk/wlan').send({ an: true }).expect(200)
      assert.equal(r.body.adresse, '', 'ohne Rechte kann keine Adresse kommen')
      assert.equal(r.body.an, false, 'der Server darf nicht behaupten, das WLAN laufe')
      assert.equal(r.body.ok, false)
      assert.match(r.body.hinweis, /NICHT einschalten/)

      const f = await request(app).post('/api/funk/flug').send({ an: false }).expect(200)
      assert.equal(f.body.ok, false, 'auch der Flugmodus darf sich nicht selbst gruen melden')
      assert.equal(f.body.wlan.an, false)
    } finally {
      writeFileSync(sudoSchaltet, 'ja')
      process.env.MUPIBOX_FUNK_SCHALTWEG = 'ifupdown'
    }
  })
})
