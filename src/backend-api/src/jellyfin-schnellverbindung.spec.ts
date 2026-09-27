/**
 * Die Regeln der Jellyfin-Schnellverbindung — geprüft an den Fällen, in denen
 * ein Fehler still bliebe.
 *
 * Nichts hiervon telefoniert. Was mit dem Netz zu tun hat, steht in server.ts;
 * hier stehen die Entscheidungen, die man einer laufenden Box nicht ansieht.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ABLAUF_MS,
  ablaufAus,
  basis,
  geraeteKopf,
  istGenehmigt,
  istServer,
  nochGueltig,
  standVon,
  wegAuthenticate,
  wegConnect,
  wegEnabled,
  wegInitiate,
  zugangAus,
} from './jellyfin-schnellverbindung'

const G = { client: 'MuPiBox', device: 'MixPi Box', deviceId: 'abc123', version: '1.0.0' }

describe('basis / istServer', () => {
  it('wirft abschliessende Schrägstriche weg', () => {
    assert.equal(basis('http://x:8899///'), 'http://x:8899')
    assert.equal(basis('  http://x:8899 '), 'http://x:8899')
  })

  it('erkennt eine unbrauchbare Adresse, statt sie zusammenzubauen', () => {
    // Ohne diese Pruefung baute die Box `/QuickConnect/Initiate` an einen
    // leeren String und riefe die eigene Wurzel auf — die antwortet mit HTML,
    // und der Fehler saehe wie „Jellyfin spinnt" aus.
    assert.equal(istServer(''), false)
    assert.equal(istServer('jellyfin.lan'), false)
    assert.equal(istServer('http://192.168.178.199:8899'), true)
  })
})

describe('die vier Adressen', () => {
  it('stehen so, wie Jellyfin sie erwartet', () => {
    assert.equal(wegEnabled('http://x:8899/'), 'http://x:8899/QuickConnect/Enabled')
    assert.equal(wegInitiate('http://x:8899'), 'http://x:8899/QuickConnect/Initiate')
    assert.equal(wegAuthenticate('http://x:8899'), 'http://x:8899/Users/AuthenticateWithQuickConnect')
  })

  it('kodiert das Secret in der Abfrage', () => {
    assert.equal(wegConnect('http://x:8899', 'a b&c'), 'http://x:8899/QuickConnect/Connect?Secret=a%20b%26c')
  })
})

describe('geraeteKopf', () => {
  it('baut die Kopfzeile, ohne die Jellyfin mit 400 antwortet', () => {
    assert.equal(
      geraeteKopf(G),
      'MediaBrowser Client="MuPiBox", Device="MixPi Box", DeviceId="abc123", Version="1.0.0"',
    )
  })

  it('lässt ein Anführungszeichen im Namen die Kopfzeile NICHT zerbrechen', () => {
    // Ein Boxname wie `Emmas "grosse" Box` ist erlaubt und kommt vor.
    const k = geraeteKopf({ ...G, device: 'Emmas "grosse" Box' })
    assert.ok(String(k).includes('Device="Emmas grosse Box"'))
    assert.equal(k.match(/"/g)?.length, 8)
  })

  it('setzt Ersatzwerte, statt leere Anführungszeichen zu schicken', () => {
    assert.equal(
      geraeteKopf({ client: '', device: '', deviceId: '', version: '' }),
      'MediaBrowser Client="MuPiBox", Device="MuPiBox", DeviceId="mupibox", Version="1.0.0"',
    )
  })
})

describe('ablaufAus', () => {
  it('nimmt Code und Secret aus der Antwort', () => {
    const a = ablaufAus({ Code: '123456', Secret: 'geheim' }, 'http://x:8899/', 1000)
    assert.deepEqual(a, { code: '123456', secret: 'geheim', begonnen: 1000, server: 'http://x:8899' })
  })

  it('lässt einen LEEREN Code nicht durch', () => {
    // Er stuende als leere Zeile am Schirm, und man tippte in Jellyfin ins
    // Nichts — schlimmer als eine Fehlermeldung.
    assert.equal(ablaufAus({ Code: '', Secret: 'geheim' }, 'http://x', 1), null)
    assert.equal(ablaufAus({ Code: '123456' }, 'http://x', 1), null)
    assert.equal(ablaufAus(null, 'http://x', 1), null)
    assert.equal(ablaufAus('nein', 'http://x', 1), null)
  })
})

describe('nochGueltig', () => {
  const a = { code: '1', secret: 's', begonnen: 0, server: 'http://x:8899' }

  it('verfällt nach der Frist', () => {
    assert.equal(nochGueltig(a, 'http://x:8899', ABLAUF_MS - 1), true)
    assert.equal(nochGueltig(a, 'http://x:8899', ABLAUF_MS), false)
  })

  it('gilt NICHT mehr, wenn die Serveradresse gewechselt hat', () => {
    // Sonst tauschte die Box einen Code, der bei Server A entstanden ist,
    // gegen einen Schluessel bei Server B ein — und schriebe ihn in die
    // Konfiguration, wo er zu nichts passt.
    assert.equal(nochGueltig(a, 'http://andere:8899', 1000), false)
  })

  it('gibt es keinen, ist auch nichts gültig', () => {
    assert.equal(nochGueltig(null, 'http://x:8899', 0), false)
  })
})

describe('standVon', () => {
  it('gibt den Code heraus, aber NIE das Secret', () => {
    const s = standVon({ code: '123456', secret: 'geheim', begonnen: 0, server: 'http://x' }, 'http://x', 60000)
    assert.deepEqual(s, { laeuft: true, code: '123456', restSekunden: 240 })
    assert.ok(!String(JSON.stringify(s)).includes('geheim'))
  })

  it('meldet einen abgelaufenen Ablauf als „läuft nicht"', () => {
    const s = standVon({ code: '1', secret: 's', begonnen: 0, server: 'http://x' }, 'http://x', ABLAUF_MS + 1)
    assert.deepEqual(s, { laeuft: false, code: null, restSekunden: 0 })
  })
})

describe('istGenehmigt', () => {
  it('nur ein echtes true zählt', () => {
    assert.equal(istGenehmigt({ Authenticated: true }), true)
    assert.equal(istGenehmigt({ Authenticated: 'true' }), false)
    assert.equal(istGenehmigt({ Authenticated: 1 }), false)
    assert.equal(istGenehmigt({}), false)
    assert.equal(istGenehmigt(null), false)
  })
})

describe('zugangAus', () => {
  it('holt Schlüssel und Benutzernamen', () => {
    assert.deepEqual(zugangAus({ AccessToken: 'tok', User: { Name: 'Achim' } }), {
      schluessel: 'tok',
      benutzer: 'Achim',
    })
  })

  it('ohne Schlüssel ist es KEINE halbe Anmeldung, sondern gar keine', () => {
    // Sonst stuende „angemeldet als Achim" da, waehrend nichts spielt.
    assert.equal(zugangAus({ User: { Name: 'Achim' } }), null)
    assert.equal(zugangAus({ AccessToken: '' }), null)
    assert.equal(zugangAus(null), null)
  })

  it('kommt ohne Benutzernamen aus', () => {
    assert.deepEqual(zugangAus({ AccessToken: 'tok' }), { schluessel: 'tok', benutzer: '' })
  })
})
