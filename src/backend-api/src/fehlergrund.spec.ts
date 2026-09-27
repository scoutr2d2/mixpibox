import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { grundNachAussen } from './fehlergrund.js'

describe('grundNachAussen — der Grund ohne den Pfad', () => {
  it('sagt bei einer fehlenden Datei, dass sie fehlt', () => {
    const e = Object.assign(new Error("ENOENT: no such file or directory, stat '/var/log/mupibox/idle_shutdown.log'"), {
      code: 'ENOENT',
    })
    assert.equal(grundNachAussen(e), 'Die Datei gibt es (noch) nicht.')
  })

  it('unterscheidet fehlend von verboten — der Betreiber kann mit dem Unterschied etwas anfangen', () => {
    const fehlt = Object.assign(new Error('x'), { code: 'ENOENT' })
    const verboten = Object.assign(new Error('y'), { code: 'EACCES' })
    assert.notEqual(grundNachAussen(fehlt), grundNachAussen(verboten))
  })

  it('DER PUNKT: kein Pfad, kein Fehlercode, keine Meldung geht durch', () => {
    const boesartig = [
      Object.assign(new Error("ENOENT: no such file or directory, open '/etc/mupibox/mupiboxconfig.json'"), {
        code: 'ENOENT',
      }),
      Object.assign(new Error("EACCES: permission denied, mkdir '/home/dietpi'"), { code: 'EACCES' }),
      Object.assign(new Error('Command failed: /usr/bin/journalctl -u foo'), { code: 1 }),
      new Error('at Object.<anonymous> (/home/achim/Downloads/MuPiBox/src/backend-api/src/server.ts:3181:24)'),
      Object.assign(new Error('kaputt'), { code: 'IRGENDWAS_NEUES' }),
      'nur eine Zeichenkette /etc/shadow',
      null,
      undefined,
      { code: { toString: () => '/etc/passwd' } },
    ]
    for (const e of boesartig) {
      const satz = grundNachAussen(e)
      assert.doesNotMatch(satz, /\//, `ein Pfadtrenner im Satz: ${satz}`)
      assert.doesNotMatch(satz, /\b[A-Z]{4,}\b/, `ein roher Fehlercode im Satz: ${satz}`)
      assert.doesNotMatch(satz, /node_modules|\.ts:|\.js:/, `eine Datei im Satz: ${satz}`)
      assert.ok(satz.length > 0 && satz.length < 60, `kein brauchbarer Satz: ${satz}`)
    }
  })

  it('ein unbekannter Code faellt auf den allgemeinen Satz zurueck — nicht auf die Meldung', () => {
    const e = Object.assign(new Error('geheimer Pfad /etc/mupibox/geheim'), { code: 'GIBTESNOCHNICHT' })
    assert.equal(grundNachAussen(e), 'Das hat nicht geklappt.')
  })

  it('ein Code, der keine Zeichenkette ist, wird nicht als Code genommen', () => {
    // exec() setzt `code` gern als ZAHL (der Rueckgabewert des Programms).
    // Waere das ein Schluessel, landete er ueber Umwege in der Antwort.
    assert.equal(grundNachAussen(Object.assign(new Error('x'), { code: 127 })), 'Das hat nicht geklappt.')
  })
})
