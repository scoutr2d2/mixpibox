import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import request from 'supertest'

/* ═══════════════════════════════════════════════════════════════════════════
 * DIE UMGEBUNG STEHT VOR DEM SERVER — deshalb wird er unten GELADEN, nicht
 * oben importiert.
 *
 * `configBasePath`, `mupiboxConfigPath`, `VPN_ZIEL`, `vorleseCacheDir` und
 * `piperBin` entstehen beim Laden von server.ts aus der Umgebung. Ein
 * `import { app } from './server'` ganz oben ist in ESM VOR jeder Anweisung
 * dieser Datei fertig — die Zuweisungen kaemen zu spaet, und die Tests
 * schrieben in /etc/mupibox und /home/dietpi. Genau deshalb steht hier ein
 * `await import(...)`, wie in vpn.integration.spec.ts.
 *
 * AN DER BOX WIRD NICHTS GESCHALTET: `sudo`, `systemctl` und `piper` kommen
 * aus einem Attrappenverzeichnis vor dem PATH. Die sudo-Attrappe ist dabei
 * kein Luxus, sondern Pflicht — ein echtes `sudo -n` aus einem Testlauf
 * erzeugt Fehlversuche, und faillock sperrt danach das Konto (llmwiki
 * `sudo-ohne-terminal-sperrt-das-konto`).
 * ═══════════════════════════════════════════════════════════════════════════ */

const ordner = mkdtempSync(join(tmpdir(), 'mixpi-server-spec-'))
const bin = join(ordner, 'bin')
const wgZiel = join(ordner, 'etc-wireguard', 'wg0.conf')
const sudoLog = join(ordner, 'sudo.log')
/** Was `install` WIRKLICH in der Hand hatte — je Aufruf eine Endpoint-Zeile. */
const installLog = join(ordner, 'install-inhalt.log')
/** Solange die Datei da ist, braucht `systemctl is-active` zwoelf Sekunden. */
const systemctlHaengt = join(ordner, 'systemctl-haengt')
const konfigDatei = join(ordner, 'mupiboxconfig.json')
const vorleseCache = join(ordner, 'vorlesen-cache')
const piperVenv = join(ordner, 'piper-venv')
const stimmen = join(ordner, 'piper-stimmen')

mkdirSync(bin, { recursive: true })
mkdirSync(vorleseCache, { recursive: true })
mkdirSync(join(piperVenv, 'bin'), { recursive: true })
mkdirSync(stimmen, { recursive: true })
writeFileSync(sudoLog, '')
writeFileSync(installLog, '')

function skript(pfad: string, inhalt: string): void {
  writeFileSync(pfad, `#!/bin/sh\n${inhalt}\n`)
  chmodSync(pfad, 0o755)
}

// Die sudo-Attrappe schreibt mit, WOMIT geschaltet wurde, und fuehrt
// `install` wirklich aus — nur eben auf einer Wegwerfdatei statt unter /etc.
skript(
  join(bin, 'sudo'),
  [
    `echo "$*" >> "${sudoLog}"`,
    'befehl="$2"',
    'letzt=""; vorletzt=""',
    'for a in "$@"; do vorletzt="$letzt"; letzt="$a"; done',
    'case "$befehl" in',
    // MIT PAUSE: erst dadurch ueberlappen zwei Uebernahmen wirklich. Ohne sie
    // waere der Wettlauf-Test eine Frage des Zufalls.
    //
    // UND MIT MITSCHRIFT DES INHALTS, nicht nur des Namens: der Schaden ist
    // nicht „eine Anfrage scheitert" (das passiert nur bei einer bestimmten
    // Reihenfolge), sondern „eine Anfrage legt die Konfiguration der ANDEREN
    // nach /etc/wireguard und meldet 200". Das sieht man nur am INHALT.
    '  install)',
    '    sleep 0.4',
    `    (grep '^Endpoint' "$vorletzt" || echo "QUELLE-WEG") >> "${installLog}" 2>/dev/null`,
    '    mkdir -p "$(dirname "$letzt")" && cp "$vorletzt" "$letzt" ;;',
    'esac',
    'exit 0',
  ].join('\n'),
)
skript(
  join(bin, 'systemctl'),
  [`if [ -f "${systemctlHaengt}" ]; then sleep 12; fi`, 'echo inactive', 'exit 0'].join('\n'),
)
// Piper scheitert — und laesst dabei ein angefangenes Bruchstueck liegen.
// Genau der Ausgang, nach dem niemand aufgeraeumt hat.
skript(
  join(piperVenv, 'bin', 'piper'),
  ['for a in "$@"; do letzt="$a"; done', 'echo halb > "$letzt"', 'exit 1'].join('\n'),
)

writeFileSync(
  konfigDatei,
  `${JSON.stringify(
    { mupihat: { battery_types: [{ name: 'LiIon 18650' }, { name: 'LiPo' }], selected_battery: 'LiPo' } },
    null,
    4,
  )}\n`,
)
chmodSync(konfigDatei, 0o664)

process.env.PATH = `${bin}:${process.env.PATH ?? ''}`
process.env.MUPIBOX_CONFIG_DIR = ordner
process.env.MUPIBOX_CONFIG = konfigDatei
process.env.MUPIBOX_VPN_ZIEL = wgZiel
process.env.MUPIBOX_VORLESE_CACHE = vorleseCache
process.env.MUPIBOX_PIPER_VENV = piperVenv
process.env.MUPIBOX_PIPER_STIMMEN = stimmen

const { app } = await import('./server.js')

/**
 * HIER STANDEN DIE TESTS VON /api/rssfeed — der Endpunkt ist mit E131/B7
 * gefallen (05.09.2026). Er war eine „hol mir BELIEBIGE URL"-Durchreiche
 * (SSRF, AUDIT-2026-09-05-B §7.3), und sein einziger Aufrufer ging schon
 * mit E118. Dieser Rest ist die WACHE dagegen, dass er unbemerkt
 * wiederkommt: wer ihn absichtlich neu baut (hinter dem Tor, mit
 * Zielliste), nimmt diesen Fall bewusst heraus.
 *
 * AM GERÄT ANTWORTET DERSELBE PFAD 302 → /neu/ (der SPA-Sammelfänger
 * fängt auch unbekannte /api-Pfade; am 05.09.2026 an Box .62 gemessen) —
 * die 404 hier gilt für das Testumfeld, in dem der Sammelfänger nicht
 * hängt. Beides heißt dasselbe: keine Durchreiche mehr.
 */
describe('rss feeds', () => {
  it('den offenen Durchreiche-Endpunkt gibt es nicht mehr', (_t, done) => {
    request(app).get('/api/rssfeed?url=http://example.com').expect(404, done)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * /api/monitor — DIE WEICHE, DIE AM `Host`-KOPF AUFGING (AUDIT-2026-09-19, Rang 4)
 *
 * ── WARUM NICHT MIT supertest ALLEIN ──────────────────────────────────────
 * supertest verbindet sich über die Rückschleife. Der Riegel an /api/monitor
 * fragt genau danach — über supertest ist also JEDER Ruf „von der Box", und
 * ein kaputter Riegel sieht aus wie ein ganzer. Dieselbe Falle wie beim
 * Anmelde-Tor (Wissenspaket: `rueckschleife-macht-die-tor-probe-blind`).
 *
 * ── WAS STATTDESSEN GEMESSEN WIRD, UND WAS DAFÜR GEFÄLSCHT WIRD ───────────
 * Gefälscht wird NUR DER TRANSPORT: ein eigener `http.createServer` setzt
 * `req.socket.remoteAddress` auf die gewünschte Adresse und übergibt dann an
 * die ECHTE App. Alles, worum es geht, bleibt echt — Express' `req.hostname`,
 * die Reihenfolge der Zwischenschichten, der Herkunftsriegel, der Handler.
 *
 * Dass ein FREMDER Rechner sich keinen Absender aus 127/8 aussuchen kann, ist
 * eine Eigenschaft des Kerns und keine dieses Servers: 127.0.0.0/8 verlässt
 * den Rechner nie (RFC 1122 3.2.1.3), und Linux verwirft 127/8 auf einem
 * anderen Gerät als `lo` als Martian-Quelle (`route_localnet` 0, die Vorgabe).
 * Diese Hälfte gehört nicht in einen Test dieses Servers, sondern in seine
 * Begründung — sie steht bei der Route.
 *
 * ── DIE 403 WIRD AUF IHRE HERKUNFT GEPRÜFT ────────────────────────────────
 * Vor /api liegt der Herkunftsriegel, und der antwortet AUCH mit 403. Ein
 * Test, der nur `status === 403` prüft, wäre deshalb grün, ohne den Riegel an
 * der Route je berührt zu haben. Geprüft wird darum der Rumpf: der
 * Herkunftsriegel schickt `{ok:false, fehler, error, grund}`, die Route
 * `{error:'nur von der Box selbst'}` und KEIN `grund`.
 * ═══════════════════════════════════════════════════════════════════════════ */

type Antwort = { status: number; koerper: Record<string, unknown>; roh: string }

/**
 * Ein Ruf an die echte App mit frei gesetztem Absender und frei gesetztem
 * `Host`-Kopf.
 *
 * Roher Sockel und nicht `fetch`: `Host` ist bei fetch ein verbotener
 * Kopfname und wird STILL verworfen — eine Messung damit misst nichts (am
 * 19.09.2026 erst so gemessen und dabei fast das Gegenteil geglaubt).
 */
function ruf(o: { weg: string; absender: string; hostKopf?: string }): Promise<Antwort> {
  return new Promise((fertig, schiefgegangen) => {
    const lauscher = http.createServer((anfrage, antwort) => {
      Object.defineProperty(anfrage.socket, 'remoteAddress', {
        value: o.absender,
        configurable: true,
      })
      app(anfrage, antwort)
    })
    lauscher.listen(0, '127.0.0.1', () => {
      const port = (lauscher.address() as AddressInfo).port
      const s = net.connect(port, '127.0.0.1', () => {
        const host = o.hostKopf ?? `127.0.0.1:${port}`
        s.write(`GET ${o.weg} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
      })
      let roh = ''
      s.on('data', (d) => {
        roh += String(d)
      })
      s.on('close', () => {
        lauscher.close()
        const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(roh)?.[1] ?? 0)
        const rumpf = roh.slice(roh.indexOf('\r\n\r\n') + 4)
        let koerper: Record<string, unknown> = {}
        try {
          koerper = JSON.parse(rumpf) as Record<string, unknown>
        } catch {
          koerper = {}
        }
        fertig({ status, koerper, roh })
      })
      s.on('error', (e) => {
        lauscher.close()
        schiefgegangen(e)
      })
    })
  })
}

/** Die Route hat abgewiesen — und nicht der Herkunftsriegel davor. */
function abgewiesenVonDerRoute(a: Antwort, dazu: string): void {
  assert.equal(a.status, 403, `${dazu}: erwartet 403, bekam ${a.status} — ${a.roh.slice(0, 200)}`)
  assert.equal(a.koerper.error, 'nur von der Box selbst', `${dazu}: 403 kam von woanders`)
  assert.equal(a.koerper.grund, undefined, `${dazu}: das ist die 403 des Herkunftsriegels`)
  assert.equal(a.koerper.monitor, undefined, `${dazu}: der Rumpf trägt trotzdem eine Auskunft`)
}

/** Die Route hat geantwortet — mit einer Auskunft, nicht mit einer Abfuhr. */
function auskunftBekommen(a: Antwort, dazu: string): void {
  assert.equal(a.status, 200, `${dazu}: erwartet 200, bekam ${a.status} — ${a.roh.slice(0, 200)}`)
  assert.ok('monitor' in a.koerper, `${dazu}: 200 ohne Auskunft — ${a.roh.slice(0, 200)}`)
}

describe('/api/monitor — nur von der Box selbst', () => {
  it('weist einen LAN-Ruf mit gefälschtem Host: localhost ab', async () => {
    // DER FUND IN EINER ZEILE. Die alte Bedingung lautete
    // `... || host.indexOf('localhost') !== -1`, und `req.hostname` ist der
    // Kopf `Host` — also Client-Ware. `curl -H 'Host: localhost'
    // http://<box>:8200/api/monitor` genügte aus dem Netz.
    //
    // Dieser Kopf ist zugleich der HÄRTESTE Fall: `localhost` IST einer der
    // eigenen Namen der Box, der Herkunftsriegel davor lässt ihn also durch.
    // Wer hier abweist, weist an der Route ab.
    abgewiesenVonDerRoute(
      await ruf({ weg: '/api/monitor', absender: '192.168.178.75', hostKopf: 'localhost' }),
      'Host: localhost aus dem LAN',
    )
  })

  it('weist einen LAN-Ruf mit gefälschtem Host: localhost.beliebig ab', async () => {
    // DIE FORM AUS DEM AUDIT — UND SIE KAM NIE BIS ZUR ROUTE. `indexOf` prüft
    // auf VORKOMMEN statt auf Gleichheit, die alte Klausel wäre also
    // aufgegangen; davor steht aber seit dem 07.08.2026 der Namensriegel
    // (herkunft.ts), und „localhost.beliebig" ist keiner der eigenen Namen
    // dieser Box. Am 19.09.2026 gemessen: er antwortet mit seiner eigenen 403.
    //
    // Deshalb wird hier NUR geprüft, dass keine Auskunft herauskommt — wer
    // welchen Riegel getroffen hat, steht im Test darüber. Sonst wäre dieser
    // Test grün, ohne /api/monitor je berührt zu haben.
    const a = await ruf({
      weg: '/api/monitor',
      absender: '192.168.178.75',
      hostKopf: 'localhost.beliebig',
    })
    assert.equal(a.status, 403, `erwartet 403, bekam ${a.status}`)
    assert.equal(a.koerper.monitor, undefined, 'trotz 403 eine Auskunft im Rumpf')
  })

  it('weist einen LAN-Ruf ohne jeden Trick ab', async () => {
    abgewiesenVonDerRoute(await ruf({ weg: '/api/monitor', absender: '192.168.178.75' }), 'LAN ohne Host-Trick')
  })

  it('erfindet aus der Ferne keine Antwort', async () => {
    // Der Fern-Zweig schickte `{monitor:'On'}` — dieselbe Antwort wie „der
    // Bildschirm ist an". Ein Anrufer konnte Auskunft und Abfuhr nicht
    // unterscheiden, und ein Leser des Codes nicht, ob der Riegel greift.
    const a = await ruf({ weg: '/api/monitor', absender: '192.168.178.75', hostKopf: 'localhost' })
    assert.notEqual(a.koerper.monitor, 'On', 'die erfundene Antwort ist zurück')
    assert.equal(a.status, 403)
  })

  it('lässt 127.0.1.1 durch — den Namen, den der Installer in /etc/hosts schreibt', async () => {
    // `remote-step-installer/recipes/mupibox-app.yaml:233` schreibt
    // `127.0.1.1 <Rechnername>` in /etc/hosts. Die alte Dreier-Liste
    // (127.0.0.1 / ::1 / ::ffff:127.0.0.1) kannte diese Adresse nicht: wer so
    // ankam, stand vor der Box und galt trotzdem als fern.
    auskunftBekommen(await ruf({ weg: '/api/monitor', absender: '127.0.1.1' }), '127.0.1.1')
  })

  it('lässt auch die IPv4-in-IPv6-Form von 127.0.1.1 durch', async () => {
    // Über einen Sockel, der auf `::` hört — und das tut der Server auf der
    // Box —, liefert Node genau diese Form. Am 19.09.2026 gemessen: ein Ruf
    // mit gebundener Quelle 127.0.1.1 kommt dort als `::ffff:127.0.1.1` an.
    auskunftBekommen(await ruf({ weg: '/api/monitor', absender: '::ffff:127.0.1.1' }), '::ffff:127.0.1.1')
  })

  it('lässt den Kiosk weiter durch (127.0.0.1, ::1, ::ffff:127.0.0.1)', async () => {
    // DIE GEGENRICHTUNG. Ein Riegel, der die Box selbst aussperrt, lässt den
    // Bildschirm nach dem Einschalten leer — das ist der teurere Fehler.
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']) {
      auskunftBekommen(await ruf({ weg: '/api/monitor', absender: a }), a)
    }
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * DIE ZWISCHENDATEI GEHOERT EINEM AUFRUF (AUDIT-2026-09-19, Rang 3)
 *
 * Vier Schreibstellen in server.ts trugen im Namen ihrer Zwischendatei nur
 * die Prozesskennung und KEINEN Zaehler. Zwei gleichzeitige Anfragen
 * DESSELBEN Prozesses teilen sich damit eine Datei — bei der VPN-Uebernahme
 * ist das die Datei mit dem privaten Schluessel darin.
 *
 * WARUM NICHT NACHEINANDER GEMESSEN WIRD: ein Test, der zweimal hintereinander
 * uebernimmt, sieht nie ein Problem — die erste Anfrage ist fertig, bevor die
 * zweite anfaengt. Die Frage lautet „was passiert, wenn sich die beiden
 * ueberlappen", und die stellt man nur mit `Promise.all`.
 * ═══════════════════════════════════════════════════════════════════════════ */

function fritzExport(endpunkt: string, adresse: string): string {
  return [
    '[Interface]',
    `PrivateKey = k${'A'.repeat(42)}=`,
    `Address = ${adresse}/24`,
    'DNS = 192.168.178.1',
    '',
    '[Peer]',
    `PublicKey = p${'B'.repeat(42)}=`,
    'AllowedIPs = 192.168.178.0/24',
    `Endpoint = ${endpunkt}:51820`,
    '',
  ].join('\n')
}

/** Die Quelldateien, mit denen `sudo install` gerufen wurde — vorletztes Wort. */
function installQuellen(): string[] {
  return readFileSync(sudoLog, 'utf8')
    .split('\n')
    .filter((z) => z.includes(' install '))
    .map((z) => {
      const w = z.trim().split(/\s+/)
      return w[w.length - 2] ?? ''
    })
}

describe('VPN-Uebernahme: zwei gleichzeitige Anfragen teilen sich KEINE Zwischendatei', () => {
  it('beide kommen durch, jede mit ihrer eigenen Datei, und es bleibt nichts liegen', async () => {
    const vorher = installQuellen().length

    const [a, b] = await Promise.all([
      request(app)
        .post('/api/vpn/konfiguration')
        .send({ text: fritzExport('eins.myfritz.net', '192.168.178.201') }),
      request(app)
        .post('/api/vpn/konfiguration')
        .send({ text: fritzExport('zwei.myfritz.net', '192.168.178.202') }),
    ])

    // 1. KEINE DER BEIDEN DARF SCHEITERN. Mit geteilter Zwischendatei loescht
    //    das `finally` der ersten die Datei, waehrend `install` der zweiten
    //    sie noch braucht — dann bekommt eine der beiden eine 500.
    assert.equal(a.status, 200, `erste Uebernahme: ${a.status} ${JSON.stringify(a.body)}`)
    assert.equal(b.status, 200, `zweite Uebernahme: ${b.status} ${JSON.stringify(b.body)}`)

    // 2. DER EIGENTLICHE SCHADEN, und er ist STILL: beide melden 200, aber
    //    `install` traegt zweimal DIESELBE Konfiguration nach /etc/wireguard
    //    — die des jeweils anderen. Nur der Inhalt zeigt das; am Rueckgabe-
    //    wert und am Journal sieht es aus, als waere alles gutgegangen.
    //    (Am 19.09.2026 in genau dieser Reihenfolge gemessen: mit geteiltem
    //    Namen kamen zwei 200 UND zweimal „zwei.myfritz.net".)
    const inhalte = readFileSync(installLog, 'utf8').trim().split('\n').filter(Boolean)
    assert.equal(inhalte.length, 2, `erwartet zwei install-Aufrufe, waren ${inhalte.length}`)
    assert.equal(new Set(inhalte).size, 2, `beide Male dieselbe Konfiguration eingespielt: ${inhalte.join(' | ')}`)

    // 3. Dasselbe eine Ebene tiefer: verschiedene Zwischendateien.
    const quellen = installQuellen().slice(vorher)
    assert.equal(new Set(quellen).size, 2, `beide Anfragen schrieben nach ${quellen[0]}`)

    // 4. Und keine Leiche mit dem privaten Schluessel darin.
    assert.deepEqual(
      readdirSync(ordner).filter((n) => n.startsWith('wg-uebernahme')),
      [],
    )

    // 5. Was unter /etc/wireguard liegt, ist GANZ und gehoert zu genau einer
    //    der beiden Anfragen — kein Gemisch aus zweien.
    const abgelegt = readFileSync(wgZiel, 'utf8')
    const endpunkte = abgelegt.split('\n').filter((z) => z.startsWith('Endpoint'))
    assert.equal(endpunkte.length, 1, abgelegt)
    assert.match(endpunkte[0] ?? '', /(eins|zwei)\.myfritz\.net:51820/)
  })
})

describe('Batterie-Profil: die Konfiguration behaelt ihre Rechte', () => {
  it('schreibt 0664 — auch unter strenger umask — und laesst nichts liegen', async () => {
    // DIE UMASK IST DER PUNKT. `writeFile({mode})` ist nur ein Wunsch; 0664
    // kommt unter umask 022 als 0644 an, und dann darf www-data nicht mehr
    // schreiben. Hier wird sie ABSICHTLICH streng gestellt, damit der Test
    // nicht von der Einstellung des Rechners abhaengt, auf dem er laeuft.
    const vorherige = process.umask(0o022)
    try {
      const r = await request(app).post('/api/mupihat/batterie').send({ name: 'LiIon 18650' })
      assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(statSync(konfigDatei).mode & 0o777, 0o664, 'die Gruppe darf nicht mehr schreiben')
    } finally {
      process.umask(vorherige)
    }

    const roh = readFileSync(konfigDatei, 'utf8')
    assert.equal((JSON.parse(roh) as { mupihat: { selected_battery: string } }).mupihat.selected_battery, 'LiIon 18650')
    // VIER LEERZEICHEN, wie die Datei auf jeder Box liegt — sonst waere jeder
    // Schreibvorgang von hier ein Diff ueber die ganze Datei.
    assert.ok(roh.includes('\n    "mupihat"'), roh.slice(0, 120))
    assert.deepEqual(
      readdirSync(ordner).filter((n) => n.startsWith('mupiboxconfig.json.')),
      [],
    )
  })
})

describe('Vorlesen: ein gescheiterter Sprechversuch laesst keine Leiche im Speicher', () => {
  it('raeumt die Zwischendatei weg, wenn Piper abbricht', async () => {
    const r = await request(app).get('/api/vorlesen/sprich').query({ text: 'Hallo Kalea' })
    assert.equal(r.status, 500, `erwartet 500, bekam ${r.status} ${JSON.stringify(r.body)}`)

    // Der Deckel (`vlCacheDeckeln`) sieht jede Datei im Ordner: jede Leiche
    // verdraengt einen brauchbaren Satz, und geraeumt wird erst bei 300.
    assert.deepEqual(
      readdirSync(vorleseCache).filter((n) => n.endsWith('.tmp')),
      [],
    )
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * FRIST UND FEHLERANTWORT (AUDIT-2026-09-19, Rang 10 a und f)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('Einspielen: der Waechter haelt den Browser nicht fest', () => {
  it('antwortet auch dann, wenn systemctl haengt', async () => {
    // Die HTTP-Antwort entsteht NUR im Rueckruf von `systemctl is-active`.
    // Ohne Frist wartet der Browser am Einspiel-Knopf so lange wie systemctl
    // — ein belegter D-Bus ist auf dem Pi Alltag. Die Attrappe haengt zwoelf
    // Sekunden; mit Frist ist nach fuenf Schluss.
    writeFileSync(systemctlHaengt, '')
    const begonnen = Date.now()
    try {
      const r = await request(app).post('/api/aktualisierung/einspielen').send({})
      const gedauert = Date.now() - begonnen
      assert.ok(r.status === 200 || r.status === 409 || r.status === 500, `unerwartet: ${r.status}`)
      assert.ok(gedauert < 9000, `${gedauert} ms — der Waechter hat keine Frist`)
    } finally {
      rmSync(systemctlHaengt, { force: true })
    }
  })
})

describe('Fehlerantworten nennen keinen Serverpfad', () => {
  it('ein Schreibfehler geht als Satz hinaus, nicht als absoluter Pfad', async () => {
    // EIN VERZEICHNIS, WO EINE DATEI HINGEHOERT: das Umbenennen scheitert mit
    // EISDIR, und `err.message` traegt beide absoluten Pfade. `String(e)`
    // stellte dem nur noch „Error: " voran — die Schwesterroute mit
    // `String((e as Error)?.message ?? e)` leckte GENAUSO VIEL. Das Audit
    // nennt sie als Vorbild; sie war keines.
    const sperre = join(ordner, 'vorlesen.json')
    rmSync(sperre, { force: true })
    mkdirSync(sperre, { recursive: true })
    try {
      const r = await request(app).put('/api/vorlesen').send({})
      assert.equal(r.status, 500, `erwartet 500, bekam ${r.status} ${JSON.stringify(r.body)}`)
      const hinaus = JSON.stringify(r.body)
      assert.ok(!hinaus.includes(ordner), `der Serverpfad steht in der Antwort: ${hinaus}`)
      assert.ok(!hinaus.includes('.tmp'), `der Name der Zwischendatei steht in der Antwort: ${hinaus}`)
      assert.ok(!hinaus.includes('EISDIR'), `die rohe Systemmeldung steht in der Antwort: ${hinaus}`)
      // Und trotzdem eine Auskunft: „was" bleibt, nur „wo" faellt weg.
      assert.match(hinaus, /Verzeichnis/)
    } finally {
      rmSync(sperre, { recursive: true, force: true })
    }
  })
})
