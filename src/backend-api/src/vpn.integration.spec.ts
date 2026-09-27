/**
 * Der VPN-Heimweg am laufenden Server — und die drei Aussagen, auf die es
 * ankommt:
 *
 *   1. Was hochgeladen wird, geht GEPRUEFT nach /etc/wireguard — ein
 *      Volltunnel oder eine PostUp-Zeile kommt gar nicht erst an (400,
 *      und es faellt kein einziger sudo-Befehl).
 *   2. Kein Geheimnis verlaesst die Box (E30/W3): weder der private noch
 *      der Preshared-Schluessel stehen je in einer Antwort — auch dann
 *      nicht, wenn `wg show … dump` beide roh liefert.
 *   3. Schalten heisst systemctl auf die EINE Konstante wg-quick@wg0 —
 *      und ohne Konfiguration wird gar nicht geschaltet (409).
 *
 * AN DER BOX WIRD DABEI NICHTS GESCHALTET: `sudo`, `systemctl`, `wg` und
 * `modinfo` kommen aus einem Attrappenverzeichnis vor dem PATH (dasselbe
 * Muster wie funk.integration.spec.ts). Die sudo-Attrappe schreibt mit,
 * WOMIT geschaltet wurde, und fuehrt install/rm wirklich aus — nur eben
 * auf einer Wegwerfdatei statt unter /etc.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import request from 'supertest'

let app: import('express').Express
let ordner: string
let sudoLog: string
let wgZiel: string
let dumpDatei: string
let aktivDatei: string
let enabledDatei: string
let werkzeugWegMarker: string
let sysModul: string

const PRIV = `k${'A'.repeat(42)}=`
const PUB = `p${'B'.repeat(42)}=`
const PSK = `s${'C'.repeat(42)}=`

const FRITZ_EXPORT = [
  '[Interface]',
  `PrivateKey = ${PRIV}`,
  'Address = 192.168.178.201/24',
  'DNS = 192.168.178.1',
  '',
  '[Peer]',
  `PublicKey = ${PUB}`,
  `PresharedKey = ${PSK}`,
  'AllowedIPs = 192.168.178.0/24',
  'Endpoint = beispiel.myfritz.net:51820',
  '',
].join('\n')

function geschaltet(): string[] {
  try {
    return readFileSync(sudoLog, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** Einen frischen Handschlag in die wg-dump-Attrappe legen (Alter in Sekunden). */
function handschlagVor(sekunden: number): void {
  const epoche = Math.floor(Date.now() / 1000) - sekunden
  writeFileSync(
    dumpDatei,
    `${PRIV}\t${PUB}\t51820\toff\n${PUB}\t${PSK}\t93.184.216.34:51820\t192.168.178.0/24\t${epoche}\t111\t222\t25\n`,
  )
}

describe('VPN: uebernehmen, schalten, entfernen — ohne dass ein Geheimnis hinausgeht', () => {
  before(async () => {
    ordner = mkdtempSync(join(tmpdir(), 'mupi-vpn-'))
    sudoLog = join(ordner, 'sudo.log')
    wgZiel = join(ordner, 'etc-wireguard', 'wg0.conf')
    dumpDatei = join(ordner, 'wg-dump')
    aktivDatei = join(ordner, 'einheit-aktiv')
    enabledDatei = join(ordner, 'einheit-enabled')
    werkzeugWegMarker = join(ordner, 'werkzeug-weg')
    sysModul = join(ordner, 'sys-module-wireguard')
    writeFileSync(sudoLog, '')
    mkdirSync(sysModul, { recursive: true })

    const bin = join(ordner, 'bin')
    mkdirSync(bin, { recursive: true })
    const skript = (name: string, inhalt: string) => {
      const p = join(bin, name)
      writeFileSync(p, `#!/bin/sh\n${inhalt}\n`)
      chmodSync(p, 0o755)
    }
    // `wg --version` beantwortet nur die Frage „ist das Werkzeug da" — und
    // genau die laesst sich hier per Markerdatei auf „nein" stellen.
    skript(
      'wg',
      [`if [ -f "${werkzeugWegMarker}" ]; then exit 127; fi`, 'echo "wireguard-tools v1.0.20210914"'].join('\n'),
    )
    skript('modinfo', 'echo "filename: wireguard.ko.xz"')
    // Ohne Rechte wird nur GELESEN: is-active/is-enabled aus den Zustandsdateien.
    skript(
      'systemctl',
      [
        'case "$1" in',
        `  is-active) cat "${aktivDatei}" 2>/dev/null || echo inactive ;;`,
        `  is-enabled) cat "${enabledDatei}" 2>/dev/null || echo disabled ;;`,
        'esac',
      ].join('\n'),
    )
    // Die sudo-Attrappe schreibt mit — und tut das Wenige, was die Tests
    // brauchen, wirklich: install kopiert, rm loescht, systemctl fuehrt die
    // Zustandsdateien, wg liefert den hinterlegten dump (oder scheitert wie
    // das Original, wenn es keine Schnittstelle gibt).
    skript(
      'sudo',
      [
        `echo "$*" >> "${sudoLog}"`,
        'befehl="$2"',
        'letzt=""; vorletzt=""',
        'for a in "$@"; do vorletzt="$letzt"; letzt="$a"; done',
        'case "$befehl" in',
        '  wg)',
        `    if [ -f "${dumpDatei}" ]; then cat "${dumpDatei}"; else echo "Unable to access interface: No such device" >&2; exit 1; fi ;;`,
        '  install)',
        '    mkdir -p "$(dirname "$letzt")" && cp "$vorletzt" "$letzt" ;;',
        '  rm)',
        '    rm -f "$letzt" ;;',
        '  systemctl)',
        '    case "$3" in',
        `      start|restart) echo active > "${aktivDatei}" ;;`,
        `      stop) echo inactive > "${aktivDatei}" ;;`,
        `      enable) echo enabled > "${enabledDatei}" ;;`,
        `      disable) echo disabled > "${enabledDatei}" ;;`,
        '    esac ;;',
        'esac',
      ].join('\n'),
    )

    process.env.PATH = `${bin}:${process.env.PATH ?? ''}`
    process.env.MUPIBOX_CONFIG_DIR = ordner
    process.env.MUPIBOX_VPN_ZIEL = wgZiel
    process.env.MUPIBOX_VPN_SYS_MODUL = sysModul
    const modul = await import('./server.js')
    app = modul.app
  })

  after(() => {
    process.env.MUPIBOX_CONFIG_DIR = undefined
    process.env.MUPIBOX_VPN_ZIEL = undefined
    process.env.MUPIBOX_VPN_SYS_MODUL = undefined
  })

  it('GET /api/vpn ohne Konfiguration: ehrlich leer, Werkzeug und Kern trotzdem beantwortet', async () => {
    const r = await request(app).get('/api/vpn').expect(200)
    assert.equal(r.body.werkzeugDa, true)
    assert.equal(r.body.kern, 'geladen')
    assert.equal(r.body.konfiguration, null)
    assert.equal(r.body.einheit.aktiv, false)
    assert.equal(r.body.tunnel.da, false)
  })

  it('fehlt /sys/module/wireguard, bleibt es beim ehrlichen „als-modul-da"', async () => {
    rmSync(sysModul, { recursive: true, force: true })
    const r = await request(app).get('/api/vpn').expect(200)
    assert.equal(r.body.kern, 'als-modul-da')
    mkdirSync(sysModul, { recursive: true })
  })

  it('fehlt das Werkzeug, sagt der Status das — statt spaeter beim Schalten zu raten', async () => {
    writeFileSync(werkzeugWegMarker, '')
    const r = await request(app).get('/api/vpn').expect(200)
    assert.equal(r.body.werkzeugDa, false)
    rmSync(werkzeugWegMarker, { force: true })
  })

  it('Einschalten ohne Konfiguration: 409, und es faellt KEIN Befehl', async () => {
    const vorher = geschaltet().length
    const r = await request(app).post('/api/vpn/aktiv').send({ an: true }).expect(409)
    assert.equal(r.body.ok, false)
    assert.equal(geschaltet().length, vorher)
  })

  it('ein Volltunnel wird abgelehnt, BEVOR irgendetwas faellt', async () => {
    const vorher = geschaltet().length
    const r = await request(app)
      .post('/api/vpn/konfiguration')
      .send({ text: FRITZ_EXPORT.replace('AllowedIPs = 192.168.178.0/24', 'AllowedIPs = 0.0.0.0/0') })
      .expect(400)
    assert.match(r.body.error, /FRITZ!Box/)
    assert.equal(geschaltet().length, vorher, 'abgelehnt heisst: kein sudo')
    assert.equal(existsSync(wgZiel), false)
  })

  it('eine PostUp-Zeile ebenso — das waere ein Befehl als root', async () => {
    await request(app)
      .post('/api/vpn/konfiguration')
      .send({ text: FRITZ_EXPORT.replace('[Peer]', 'PostUp = /bin/true\n[Peer]') })
      .expect(400)
    assert.equal(existsSync(wgZiel), false)
  })

  it('der FRITZ!Box-Export geht durch: install als root, Begleitdatei ohne Geheimnis', async () => {
    const r = await request(app).post('/api/vpn/konfiguration').send({ text: FRITZ_EXPORT }).expect(200)
    assert.equal(r.body.ok, true)
    assert.equal(r.body.konfiguration.endpunkt, 'beispiel.myfritz.net:51820')
    assert.equal(r.body.hinweise.length, 2)

    // In der ANTWORT steht kein Schluessel …
    const antwort = JSON.stringify(r.body)
    assert.equal(antwort.includes(PRIV), false)
    assert.equal(antwort.includes(PSK), false)

    // … in der Datei fuer wg-quick stehen beide — dort gehoeren sie hin.
    // Der Weg dorthin war `install -D -m 600` ueber sudo.
    assert.equal(
      geschaltet().some((z) => z.startsWith('-n install -D -m 600 ') && z.endsWith(wgZiel)),
      true,
    )
    const datei = readFileSync(wgZiel, 'utf8')
    assert.match(datei, new RegExp(`PrivateKey = ${PRIV.replace('+', '\\+')}`))
    assert.doesNotMatch(datei, /DNS/i)
    assert.match(datei, /PersistentKeepalive = 25/)

    // Die Begleitdatei traegt, was die Oberflaeche wissen darf — mehr nicht.
    const meta = readFileSync(join(ordner, 'vpn.json'), 'utf8')
    assert.equal(meta.includes(PRIV), false)
    assert.equal(meta.includes(PSK), false)
    assert.match(meta, /beispiel\.myfritz\.net:51820/)
  })

  it('Einschalten: systemctl start auf die Konstante — und der Handschlag entscheidet das Urteil', async () => {
    handschlagVor(10)
    const r = await request(app).post('/api/vpn/aktiv').send({ an: true, beimStart: true }).expect(200)
    assert.equal(r.body.ok, true)
    assert.equal(r.body.einheit.aktiv, true)
    assert.equal(r.body.einheit.beimStart, true)
    assert.equal(r.body.tunnel.da, true)
    assert.equal(r.body.tunnel.urteil, 'steht')
    assert.equal(r.body.tunnel.endpunkt, '93.184.216.34:51820')
    assert.equal(
      geschaltet().some((z) => z === '-n systemctl start wg-quick@wg0'),
      true,
    )
    assert.equal(
      geschaltet().some((z) => z === '-n systemctl enable wg-quick@wg0'),
      true,
    )
  })

  it('auch mit stehendem Tunnel verlaesst kein Geheimnis die Box (E30/W3)', async () => {
    handschlagVor(5)
    const r = await request(app).get('/api/vpn').expect(200)
    const antwort = JSON.stringify(r.body)
    assert.equal(antwort.includes(PRIV), false, 'privater Schluessel in der Antwort')
    assert.equal(antwort.includes(PSK), false, 'PresharedKey in der Antwort')
    assert.equal(r.body.tunnel.da, true)
  })

  it('ein alter Handschlag heisst „stand", nicht „steht"', async () => {
    handschlagVor(600)
    const r = await request(app).get('/api/vpn').expect(200)
    assert.equal(r.body.tunnel.urteil, 'stand')
    assert.equal(r.body.tunnel.handschlagVorSek >= 599, true)
  })

  it('eine neue Datei bei laufendem Tunnel: uebernehmen UND neu starten', async () => {
    const r = await request(app)
      .post('/api/vpn/konfiguration')
      .send({ text: FRITZ_EXPORT.replace('beispiel.myfritz.net', 'anders.myfritz.net') })
      .expect(200)
    assert.equal(r.body.neuGestartet, true)
    assert.equal(
      geschaltet().some((z) => z === '-n systemctl restart wg-quick@wg0'),
      true,
    )
  })

  it('Ausschalten laesst den Autostart in Ruhe — es sind zwei Schalter', async () => {
    const r = await request(app).post('/api/vpn/aktiv').send({ an: false }).expect(200)
    assert.equal(r.body.einheit.aktiv, false)
    assert.equal(r.body.einheit.beimStart, true, 'beimStart wurde nicht angefasst')
  })

  it('Entfernen: anhalten, Autostart weg, Datei weg, Begleitdatei weg', async () => {
    rmSync(dumpDatei, { force: true })
    const r = await request(app).delete('/api/vpn/konfiguration').expect(200)
    assert.equal(r.body.ok, true)
    assert.equal(existsSync(wgZiel), false, 'wg0.conf ist noch da')
    assert.equal(existsSync(join(ordner, 'vpn.json')), false, 'vpn.json ist noch da')
    assert.equal(
      geschaltet().some((z) => z === '-n systemctl disable wg-quick@wg0'),
      true,
    )
    const nachher = await request(app).get('/api/vpn').expect(200)
    assert.equal(nachher.body.konfiguration, null)
    assert.equal(nachher.body.einheit.aktiv, false)
  })
})
