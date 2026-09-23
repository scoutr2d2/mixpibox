/**
 * DAS SKRIPT, DAS DIE ADAPTERWAHL ÜBER DEN NEUSTART RETTET (MixPi).
 *
 * `ifdown` haelt bis zum Neustart; danach kommen beide Schnittstellen wieder
 * hoch. Zwei Schnittstellen im selben Teilnetz sind aber nicht nur unschoen —
 * am 21.08.2026 an der Box gemessen war sie unter der Adresse des Sticks per
 * Ping erreichbar und nahm dort KEINE TCP-Verbindung an (ARP-Flux,
 * `arp_ignore` steht ueberall auf 0). Deshalb dieses Skript.
 *
 * ══ WIE HIER GEPRUEFT WIRD ═════════════════════════════════════════════════
 *
 * Das Skript wird WIRKLICH AUSGEFUEHRT, aber mit vorgetaeuschtem `ip` und
 * `ifdown` ganz vorn im PATH. Es fasst also nichts Echtes an und schreibt
 * stattdessen auf, was es getan haette. Ein Test, der ein Skript nur liest,
 * ueberlebt einen auskommentierten Aufruf.
 *
 * ══ DIE EINE REGEL, UM DIE ES GEHT ═════════════════════════════════════════
 *
 * ES WIRD NIE DIE LETZTE FUNKTIONIERENDE SCHNITTSTELLE ABGESCHALTET. Eine Box,
 * die sich beim Start selbst aussperrt, ist schlimmer als eine mit zwei
 * Schnittstellen oben — an die erste kommt niemand mehr heran, um es zu
 * richten. Der zweite Test unten ist der wichtigste dieser Datei.
 */
import assert from 'node:assert/strict'
import { match } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SKRIPT = fileURLToPath(new URL('../../../scripts/mixpi/mixpi-wlan-adapter.sh', import.meta.url))

let hof: string

/** Ein `ip`, das behauptet, die genannten Schnittstellen haetten eine Adresse. */
function attrappenBauen(mitAdresse: string[]): void {
  const tagebuch = join(hof, 'getan.txt')
  const ip = `#!/bin/sh
echo "ip $*" >> ${tagebuch}
case "$*" in
  *"route replace"*) [ -n "$ATTRAPPE_ROUTE_SCHEITERT" ] && { echo "RTNETLINK answers: Network is unreachable" >&2; exit 2; }; exit 0 ;;
  *"route"*) exit 0 ;;
  *"-br addr show"*)
    for n in ${mitAdresse.join(' ')}; do
      case "$*" in *" $n"*) echo "$n UP 192.168.178.99/24"; exit 0 ;; esac
    done
    exit 0 ;;
  *"-br link show"*) echo "wlan0 DOWN"; exit 0 ;;
esac
exit 0
`
  const ifdown = `#!/bin/sh\necho "ifdown $*" >> ${tagebuch}\nexit 0\n`
  for (const [name, inhalt] of [['ip', ip], ['ifdown', ifdown]] as const) {
    const p = join(hof, name)
    writeFileSync(p, inhalt)
    chmodSync(p, 0o755)
  }
}

function laufen(
  wahl: string | null,
  mitAdresse: string[],
  zusatz: Record<string, string> = {},
): { aus: string; getan: string } {
  const wahlDatei = join(hof, 'wahl')
  if (wahl !== null) writeFileSync(wahlDatei, `${wahl}\n`)
  attrappenBauen(mitAdresse)
  const aus = execFileSync('bash', [SKRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${hof}:${process.env.PATH ?? ''}`,
      MIXPI_WLAN_WAHL: wahlDatei,
      MIXPI_WLAN_WARTEN: '1', // sonst wartet der Test 45 s auf nichts
      ...zusatz,
    },
  })
  let getan = ''
  try {
    getan = readFileSync(join(hof, 'getan.txt'), 'utf8')
  } catch {
    /* nichts getan ist ein gueltiges Ergebnis */
  }
  return { aus, getan }
}

describe('MixPi: die WLAN-Adapterwahl nach dem Start anwenden', () => {
  beforeEach(() => {
    hof = mkdtempSync(join(tmpdir(), 'mixpi-wlan-'))
  })
  afterEach(() => {
    rmSync(hof, { recursive: true, force: true })
  })

  it('legt die andere hin, wenn die gewaehlte traegt', () => {
    const { aus, getan } = laufen('extern', ['wlan1'])
    assert.match(getan, /ifdown wlan0/, 'die nicht gewaehlte muss hingelegt werden')
    assert.match(aus, /wlan1 traegt/)
  })

  it('SCHALTET NICHTS AB, wenn die gewaehlte keine Adresse hat', () => {
    // DER WICHTIGSTE TEST DIESER DATEI. Stick abgezogen, aber „extern"
    // hinterlegt: wer jetzt wlan0 hinlegt, sperrt sich aus der Box aus.
    const { aus, getan } = laufen('extern', ['wlan0'])
    assert.ok(!/ifdown/.test(getan), `es wurde abgeschaltet: ${getan}`)
    assert.match(aus, /NICHTS abgeschaltet/)
  })

  it('tut nichts ohne hinterlegte Wahl', () => {
    // Kein Eintrag heisst „keine Wahl getroffen", nicht „nimm die Vorgabe".
    const { aus, getan } = laufen(null, ['wlan0', 'wlan1'])
    assert.ok(!/ifdown/.test(getan))
    assert.match(aus, /keine Wahl hinterlegt/)
  })

  it('tut nichts bei einem unbekannten Eintrag', () => {
    const { aus, getan } = laufen('vielleicht', ['wlan0', 'wlan1'])
    assert.ok(!/ifdown/.test(getan))
    assert.match(aus, /unbekannte Wahl/)
  })

  it('vertraegt Grossschreibung und Leerzeichen in der Datei', () => {
    // Die Datei wird auch von Hand berichtigt werden.
    const { getan } = laufen('  EXTERN  ', ['wlan1'])
    assert.match(getan, /ifdown wlan0/)
  })

  it('SETZT DIE VORGABEROUTE NEU — sonst ist die Box ohne Internet', () => {
    // DER FEHLER, DER DER BOX DAS INTERNET GEKOSTET HAT (21.08.2026):
    // Das Tor wurde aus der VORHANDENEN Vorgaberoute gelesen — die `ifdown`
    // eine Zeile darueber gerade entfernt hatte. Henne und Ei, verschluckt
    // von `2>/dev/null || true`. Die Box erreichte den Router und meldete
    // fuer alles dahinter „Network is unreachable".
    //
    // Das Tor kommt jetzt aus dem DHCP-Mietvertrag, der unabhaengig davon
    // dasteht, welche Routen gerade existieren.
    writeFileSync(join(hof, 'dhclient.wlan1.leases'), 'lease {\n  option routers 192.168.178.1;\n}\n')
    const { aus, getan } = laufen('extern', ['wlan1'], { MIXPI_WLAN_VERTRAGSORDNER: hof })
    match(getan, /ip route replace default via 192\.168\.178\.1 dev wlan1/)
    match(aus, /Vorgaberoute steht/)
  })

  it('sagt es LAUT, wenn kein Tor zu finden ist', () => {
    // Kein Mietvertrag, keine Route: dann ist die Box ohne Internet, und die
    // Meldung ist das Einzige, was noch hilft. Schweigen war der Fehler.
    const { aus } = laufen('extern', ['wlan1'], { MIXPI_WLAN_VERTRAGSORDNER: join(hof, 'gibtsnicht') })
    match(aus, /ACHTUNG.*kein Tor/)
  })

  it('MELDET ES, wenn das Setzen der Vorgaberoute scheitert', () => {
    // Der Fehlerpfad ist der wichtige: schlaegt das fehl, ist die Box ohne
    // Internet — und dann ist die Meldung das Einzige, was noch hilft. Genau
    // das hatte die erste Fassung mit `2>/dev/null` verschluckt.
    writeFileSync(join(hof, 'dhclient.wlan1.leases'), 'lease {\n  option routers 192.168.178.1;\n}\n')
    const { aus } = laufen('extern', ['wlan1'], {
      MIXPI_WLAN_VERTRAGSORDNER: hof,
      ATTRAPPE_ROUTE_SCHEITERT: '1',
    })
    match(aus, /ACHTUNG.*liess sich nicht setzen/)
    match(aus, /kein Internet/)
    // UND DER GRUND MUSS MIT. Ohne ihn steht da nur, DASS es schiefging.
    match(aus, /Network is unreachable/)
  })

  it('legt bei „intern" die andere Richtung hin', () => {
    const { getan } = laufen('intern', ['wlan0'])
    assert.match(getan, /ifdown wlan1/)
  })
})
