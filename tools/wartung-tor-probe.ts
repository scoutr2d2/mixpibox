/**
 * STEHT /api/wartung WIRKLICH HINTER DEM ANMELDE-TOR?
 *
 * Der Kopfkommentar der Route in server.ts behauptet es ("Das Setzen laeuft
 * wie jede Schreibroute hinter dem Anmelde-Tor"). Diese Probe misst es, statt
 * es aus der Zeilennummer zu schliessen.
 *
 * WARUM NICHT MIT supertest: `torBauen` laesst JEDE Rueckschleifen-Adresse
 * ohne Anmeldung durch (auth.ts, istRueckschleife). supertest verbindet ueber
 * 127.0.0.1 — dort antwortet auch eine korrekt getorte Route mit 200, die
 * Probe koennte offen und zu nicht unterscheiden. Deshalb bindet diese Probe
 * an 0.0.0.0 und ruft ueber die LAN-Adresse der Maschine an: erst dann ist
 * remoteAddress keine Rueckschleife und das Tor greift ueberhaupt.
 *
 * DIE KONTROLLE IST DER SINN DER SACHE: /api/dienste steht nachweislich hinter
 * dem Tor. Antwortet die Kontrolle nicht mit 401, misst die Probe gar nichts
 * (falsche Konfiguration, Tor aus) und meldet das, statt Entwarnung zu geben.
 *
 * Aufruf:  npx tsx tools/wartung-tor-probe.ts
 * Rueckgabe: 0 = Wartung ist getort wie behauptet, 1 = ungetort, 2 = Probe blind.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'

const KONTROLLE = '/api/dienste' // steht nachweislich hinter torBauen
const KANDIDAT = '/api/wartung'

function lanAdresse(): string | undefined {
  for (const liste of Object.values(networkInterfaces())) {
    for (const n of liste ?? []) {
      if (n.family === 'IPv4' && !n.internal) return n.address
    }
  }
  return undefined
}

async function main(): Promise<number> {
  const adresse = lanAdresse()
  if (!adresse) {
    console.error('BLIND: keine Nicht-Rueckschleifen-Adresse gefunden — das Tor kaeme nie zum Zug.')
    return 2
  }

  // Konfiguration mit EINGESCHALTETER Anmeldung: ohne sie laesst torBauen
  // alles durch (anmeldungNoetig() === false) und die Probe misst nichts.
  const ordner = mkdtempSync(join(tmpdir(), 'mupi-tor-probe-'))
  const konfigPfad = join(ordner, 'mupiboxconfig.json')
  writeFileSync(
    konfigPfad,
    JSON.stringify({
      mupibox: { host: 'MuPiBox', startVolume: '40', maxVolume: '100' },
      interfacelogin: { state: true, password: 'probe-passwort' },
      timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
    }),
  )
  process.env.NODE_ENV = 'test'
  process.env.MUPIBOX_CONFIG = konfigPfad
  process.env.MUPIBOX_CONFIG_DIR = ordner
  process.env.MIXPI_WARTUNG_DATEI = join(ordner, 'wartung.json')

  const { app } = (await import('../src/backend-api/src/server.js')) as {
    app: import('express').Express
  }

  const server = app.listen(0, '0.0.0.0')
  await new Promise<void>((fertig) => server.once('listening', () => fertig()))
  const port = (server.address() as { port: number }).port
  const wurzel = `http://${adresse}:${port}`

  try {
    const kontrolle = await fetch(wurzel + KONTROLLE)
    if (kontrolle.status !== 401) {
      console.error(
        `BLIND: Kontrolle ${KONTROLLE} antwortet ${kontrolle.status}, erwartet 401.\n` +
          '  Das Tor greift in diesem Aufbau nicht — ein 200 beim Kandidaten haette nichts zu sagen.',
      )
      return 2
    }
    console.log(`Kontrolle  ${KONTROLLE}: 401 — das Tor greift, die Probe misst.`)

    // Der teure Fall ist das SCHREIBEN: wer das ungetort erreicht, sperrt die
    // Box fuer die Kinder, ohne je ein Passwort gesehen zu haben.
    const schreiben = await fetch(wurzel + KANDIDAT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aktiv: true }),
    })
    const lesen = await fetch(wurzel + KANDIDAT)

    console.log(`Kandidat   POST ${KANDIDAT}: ${schreiben.status}`)
    console.log(`Kandidat   GET  ${KANDIDAT}: ${lesen.status}`)

    if (schreiben.status === 401) {
      console.log('\nOK: Das Setzen steht hinter dem Tor — so, wie der Kommentar es behauptet.')
      return 0
    }
    console.error(
      `\nUNGETORT: POST ${KANDIDAT} antwortet ohne Anmeldung ${schreiben.status}.\n` +
        '  Jeder im selben Netz kann die Box damit fuer die Kinder sperren.\n' +
        '  Der Kopfkommentar der Route in server.ts behauptet das Gegenteil.',
    )
    return 1
  } finally {
    await new Promise<void>((fertig) => server.close(() => fertig()))
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('Probe gescheitert:', e)
    process.exit(2)
  },
)
