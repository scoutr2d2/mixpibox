/**
 * DAS DOPPELTIPPEN IN DIE ANDERE RICHTUNG — und warum es die Box kosten kann.
 *
 * Der Aus-Weg MUSS sofort antworten und erst danach schalten: der Befehl
 * kappt die Verbindung, ueber die die Antwort sonst laufen wuerde. Zwischen
 * Antwort und Befehl liegen 600 ms. Was in diesem Fenster passiert, entscheidet,
 * ob der Schalter in beide Richtungen geht.
 *
 * NACHGESTELLT UND GEMESSEN, NICHT VERMUTET — vor der Ausbesserung stand hier:
 *
 *   POST /api/funk/wlan {an:false}   -> 200, ifdown liegt im Zeitgeber
 *   POST /api/funk/wlan {an:true}    -> 200 {"an":true,"adresse":"192.168.178.169"}
 *   … 600 ms spaeter faellt das ifdown und nimmt das WLAN wieder weg.
 *
 * Der Server hatte „die Box ist unter 192.168.178.169 erreichbar" gemeldet,
 * und sie war es nicht. Auf einem Geraet ohne Tastatur ist das genau die
 * Einbahnstrasse, die es hier nicht geben darf.
 *
 * Drei Faelle stehen deshalb hier, und jeder prueft den ZUSTAND danach, nicht
 * die Antwort:
 *   A/B  „an" faellt IN das Fenster    -> das geplante Aus wird zurueckgenommen
 *   C    „an" faellt NACH dem Fenster  -> die Befehle reihen sich, statt sich
 *                                          zu ueberkreuzen; am Ende gilt der
 *                                          zuletzt gewuenschte Zustand
 *   D    das Kabel faellt IM Fenster   -> die Bedingung wird unmittelbar vor
 *                                          der Ausfuehrung noch einmal geprueft
 *
 * AN DER BOX WIRD DABEI NICHTS GESCHALTET: `ip`, `bluetoothctl` und `sudo`
 * sind Attrappen aus einem Verzeichnis, das dem Lauf vor den PATH gelegt wird;
 * die Attrappe `sudo` schaltet wirklich — nur eben eine Datei.
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
let log: string

const eth0Auf = {
  ifname: 'eth0',
  operstate: 'UP',
  addr_info: [{ family: 'inet', local: '192.168.178.42', prefixlen: 24 }],
}
const wlan0Auf = {
  ifname: 'wlan0',
  operstate: 'UP',
  addr_info: [{ family: 'inet', local: '192.168.178.169', prefixlen: 24 }],
}

/** Kabel UND WLAN — nur so ist ein Abschalten ueberhaupt erlaubt. */
const WLAN_AN = [eth0Auf, wlan0Auf]
/** Nach `ifdown wlan0`: die Schnittstelle ist noch da, Adresse und Zustand weg. */
const WLAN_AUS = [eth0Auf, { ifname: 'wlan0', operstate: 'DOWN', addr_info: [] }]

function zustand(): 'an' | 'aus' {
  return readFileSync(ipDatei, 'utf8').includes('192.168.178.169') ? 'an' : 'aus'
}

function befehle(): string[] {
  return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
}

/** Startlage: Kabel steckt, WLAN laeuft — in `ip` UND in sysfs. */
function startlage(): void {
  writeFileSync(ipDatei, JSON.stringify(WLAN_AN))
  for (const n of ['eth0', 'wlan0']) {
    writeFileSync(join(ordner, 'sys-net', n, 'operstate'), 'up\n')
    writeFileSync(join(ordner, 'sys-net', n, 'carrier'), '1\n')
  }
  writeFileSync(log, '')
}

/** Warten, bis ein geplantes Aus gefallen sein MUESSTE (600 ms + Luft). */
function abwarten(ms = 2200): Promise<void> {
  return new Promise((f) => setTimeout(f, ms))
}

describe('Funk: aus und sofort wieder an', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-funk-wett-'))
    ipDatei = join(ordner, 'ip.json')
    anDatei = join(ordner, 'an.json')
    ausDatei = join(ordner, 'aus.json')
    btDatei = join(ordner, 'bt-power')
    log = join(ordner, 'befehle.log')
    writeFileSync(anDatei, JSON.stringify(WLAN_AN))
    writeFileSync(ausDatei, JSON.stringify(WLAN_AUS))
    writeFileSync(btDatei, 'yes\n')

    const sys = join(ordner, 'sys-net')
    for (const n of ['eth0', 'wlan0']) {
      mkdirSync(join(sys, n, 'device'), { recursive: true })
    }
    mkdirSync(join(sys, 'wlan0', 'wireless'), { recursive: true })
    startlage()

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
    // Die Attrappe schreibt MIT (fuer die Reihenfolge) und schaltet WIRKLICH:
    // sie aendert, was `ip` danach ausgibt. Nur so beweist der Lauf einen
    // Zustand statt einer Antwort.
    skript(
      'sudo',
      [
        `echo "$*" >> "${log}"`,
        'case "$*" in',
        '  *ifdown*wlan0*|*"link set wlan0 down"*)',
        `    cp "${ausDatei}" "${ipDatei}"`,
        `    printf 'down\\n' > "${join(sys, 'wlan0', 'operstate')}"`,
        `    printf '' > "${join(sys, 'wlan0', 'carrier')}" ;;`,
        '  *ifup*wlan0*)',
        `    cp "${anDatei}" "${ipDatei}"`,
        `    printf 'up\\n' > "${join(sys, 'wlan0', 'operstate')}"`,
        `    printf '1\\n' > "${join(sys, 'wlan0', 'carrier')}" ;;`,
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

  it('A: WLAN aus, dann sofort wieder an — am Ende ist es AN', async () => {
    startlage()
    assert.equal((await request(app).post('/api/funk/wlan').send({ an: false })).status, 200)
    // Sofort hinterher: der Aus-Befehl liegt noch im Zeitgeber.
    const an = await request(app).post('/api/funk/wlan').send({ an: true })
    assert.equal(an.status, 200)
    assert.equal(an.body.an, true)
    await abwarten()
    // Das geplante Aus wurde zurueckgenommen — es faellt gar nicht erst.
    assert.deepEqual(
      befehle().filter((b) => b.includes('ifdown')),
      [],
    )
    assert.equal(zustand(), 'an', 'der Server hat „an" gemeldet — dann muss es auch an sein')
  })

  it('B: Flugmodus an, dann sofort beenden — Funk ist am Ende zurueck', async () => {
    startlage()
    assert.equal((await request(app).post('/api/funk/flug').send({ an: true })).status, 200)
    const zurueck = await request(app).post('/api/funk/flug').send({ an: false })
    assert.equal(zurueck.status, 200)
    assert.equal(zurueck.body.wlan.an, true)
    await abwarten()
    assert.equal(zustand(), 'an', 'nach „Flugmodus beenden" muss das WLAN an sein')
    assert.equal(readFileSync(btDatei, 'utf8').trim(), 'yes', 'und Bluetooth ebenso')
  })

  it('C: „an" NACH dem Fenster — die Befehle reihen sich, statt sich zu kreuzen', async () => {
    startlage()
    await request(app).post('/api/funk/wlan').send({ an: false })
    // Diesmal ist das Aus schon gefallen: es geht nicht mehr ums Abbrechen,
    // sondern darum, dass ifup nicht mitten in ein laufendes ifdown faellt.
    await new Promise((f) => setTimeout(f, 900))
    const an = await request(app).post('/api/funk/wlan').send({ an: true })
    assert.equal(an.body.an, true)
    await abwarten(1500)
    const reihe = befehle()
    assert.ok(
      reihe.findIndex((b) => b.includes('ifdown')) < reihe.findIndex((b) => b.includes('ifup')),
      `ifdown muss VOR ifup liegen, war: ${JSON.stringify(reihe)}`,
    )
    assert.equal(zustand(), 'an')
  })

  it('D: faellt das Kabel im Fenster weg, faellt das Aus nicht mehr', async () => {
    startlage()
    assert.equal((await request(app).post('/api/funk/wlan').send({ an: false })).status, 200)
    // In den 600 ms zieht jemand das Netzwerkkabel. Die Freigabe von vorhin
    // gilt damit einer Lage, die es nicht mehr gibt — und die Box haenge
    // danach an nichts.
    writeFileSync(ipDatei, JSON.stringify([{ ifname: 'eth0', operstate: 'DOWN', addr_info: [] }, wlan0Auf]))
    writeFileSync(join(ordner, 'sys-net', 'eth0', 'carrier'), '')
    writeFileSync(join(ordner, 'sys-net', 'eth0', 'operstate'), 'down\n')
    await abwarten()
    assert.deepEqual(befehle(), [], 'ohne Rueckweg darf ueberhaupt nichts geschaltet werden')
    assert.equal(zustand(), 'an')
  })
})
