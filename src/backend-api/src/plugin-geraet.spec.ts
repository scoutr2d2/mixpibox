/**
 * Zeugen fuer kontext.geraet (E82) — die geschlossenen Listen und die
 * systemctl-Deutung. Alles lesend; hier wird nichts gestartet oder gestoppt.
 */
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GERAET_BEFEHLE, GERAET_DATEIEN, geraetBauen } from './plugin-geraet.js'

const geraet = geraetBauen(2500)

function systemctlDa(): boolean {
  try {
    execFileSync('systemctl', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('die geschlossenen Listen', () => {
  it('ein Dienst ausserhalb der Liste ist unbekannt — kein Ruf ins Blaue', async () => {
    // Absichtlich am Typsystem vorbei: genau so kaeme ein boeswilliger oder
    // vertippter Name aus einem Plugin an.
    const wort = await geraet.dienstZustand('sshd.service' as never)
    assert.equal(wort, 'unbekannt')
  })

  it('ein unbenanntes Rezept laeuft nicht', async () => {
    const a = await geraet.ausfuehren('rm-rf' as never)
    assert.equal(a.ok, false)
    assert.match(a.text, /kein Rezept/)
  })

  it('eine unbenannte Datei wird nicht gelesen', async () => {
    assert.equal(await geraet.lesen('/etc/shadow' as never), null)
  })

  it('die Rezepte sind lesende Blicke — kein restart, kein stop, kein write', () => {
    for (const [name, [programm, argumente]] of Object.entries(GERAET_BEFEHLE)) {
      const zeile = `${programm} ${argumente.join(' ')}`
      assert.ok(!/restart|stop|start|enable|disable|write|rm\b/.test(zeile), `${name}: ${zeile}`)
    }
    for (const pfad of Object.values(GERAET_DATEIEN)) {
      assert.ok(pfad.startsWith('/var/lib/') || pfad.startsWith('/etc/'), pfad)
    }
  })
})

describe('die Deutung', () => {
  it('eine fehlende Datei ist eine AUSKUNFT (null), kein Fehler', async () => {
    // Auf dem Entwicklerrechner gibt es /var/lib/soloist nicht — genau der
    // Normalfall "keine Warnung hinterlegt".
    assert.equal(await geraet.lesen('soloist-warnung'), null)
  })

  it('das WORT zaehlt, nie der Exit-Code: inactive kommt mit Exit != 0', { skip: !systemctlDa() }, async () => {
    // `is-active` fuer eine hier nicht existierende Unit antwortet mit
    // "inactive" UND Exit 4. Wer den Exit-Code laese, meldete "gescheitert".
    const wort = await geraet.dienstZustand('librespot.service')
    assert.equal(wort, 'steht')
  })
})
