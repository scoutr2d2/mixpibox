/**
 * Tests für die API-Anmeldung.
 *
 * Der Anlass ist real: die API antwortete aus dem LAN ohne jede Anmeldung,
 * inklusive /api/shutdown. Die Prüfungen hier halten die drei Entwurfsregeln
 * fest, damit sie beim Umbau nicht still verloren gehen — vor allem die
 * dritte: die Box selbst darf NIE nach einem Passwort gefragt werden, sonst
 * bleibt ihr Bildschirm nach dem Einschalten leer.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import bcrypt from 'bcryptjs'
import {
  COOKIE_NAME,
  Sitzungen,
  abmeldeCookie,
  cookiesLesen,
  gleichOhneZeitverrat,
  istRueckschleife,
  passwortStimmt,
  sitzungsCookie,
  torBauen,
} from './auth.js'

describe('istRueckschleife', () => {
  it('erkennt die üblichen Schreibweisen', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '0:0:0:0:0:0:0:1'])
      assert.equal(istRueckschleife(a), true, a)
  })

  it('erkennt die IPv4-in-IPv6-Form, die Node tatsächlich liefert', () => {
    // Genau hier stolpert ein Vergleich auf "127.0.0.1": über einen
    // IPv6-Sockel kommt der Normalfall so an.
    assert.equal(istRueckschleife('::ffff:127.0.0.1'), true)
    assert.equal(istRueckschleife('::FFFF:127.0.0.1'), true)
  })

  it('lässt fremde Adressen nicht durch', () => {
    for (const a of ['192.168.178.75', '10.0.0.1', '::ffff:192.168.178.75', '1.2.3.4'])
      assert.equal(istRueckschleife(a), false, a)
  })

  it('behandelt Fehlendes als „von außen"', () => {
    assert.equal(istRueckschleife(undefined), false)
    assert.equal(istRueckschleife(''), false)
    assert.equal(istRueckschleife(null), false)
  })
})

describe('cookiesLesen', () => {
  it('zerlegt mehrere Cookies', () => {
    assert.deepEqual(cookiesLesen('a=1; b=zwei'), { a: '1', b: 'zwei' })
  })

  it('verträgt Kodierung und Gleichheitszeichen im Wert', () => {
    assert.deepEqual(cookiesLesen('t=a%20b'), { t: 'a b' })
    assert.deepEqual(cookiesLesen('t=abc=def'), { t: 'abc=def' })
  })

  it('ignoriert Unbrauchbares statt abzustürzen', () => {
    assert.deepEqual(cookiesLesen(undefined), {})
    assert.deepEqual(cookiesLesen(''), {})
    assert.deepEqual(cookiesLesen('kaputt'), {})
    assert.deepEqual(cookiesLesen('=leer; a=1'), { a: '1' })
  })
})

describe('passwortStimmt', () => {
  const hash2b = bcrypt.hashSync('geheim', 10)
  // PHP schreibt seine Hashes mit der Kennung $2y$ — dasselbe Verfahren.
  const hash2y = hash2b.replace(/^\$2[ab]\$/, '$2y$')

  // Seit E131/B3 asynchron — compareSync hielt je Versuch den ganzen
  // Ereignis-Kreisel an (Begründung am Funktionskopf in auth.ts).
  it('nimmt das richtige Passwort an', async () => {
    assert.equal(await passwortStimmt('geheim', hash2b), true)
  })

  it('nimmt auch PHPs $2y$-Hash an (das ist der Fall auf der Box)', async () => {
    assert.equal(await passwortStimmt('geheim', hash2y), true)
  })

  it('weist das falsche Passwort ab', async () => {
    assert.equal(await passwortStimmt('falsch', hash2y), false)
  })

  it('lässt OHNE gesetzten Hash niemanden herein', async () => {
    // Eine Box ohne Passwort darf nicht jeden hereinlassen.
    assert.equal(await passwortStimmt('irgendwas', ''), false)
    assert.equal(await passwortStimmt('irgendwas', undefined), false)
    assert.equal(await passwortStimmt('', hash2y), false)
  })

  it('weist einen unbrauchbaren Hash ab, statt zu werfen', async () => {
    assert.equal(await passwortStimmt('geheim', 'kein-hash'), false)
  })
})

describe('Sitzungen', () => {
  it('legt gültige Sitzungen an und beendet sie', () => {
    const s = new Sitzungen()
    const id = s.anlegen()
    assert.equal(s.gueltig(id), true)
    s.beenden(id)
    assert.equal(s.gueltig(id), false)
  })

  it('kennt fremde Kennungen nicht', () => {
    const s = new Sitzungen()
    s.anlegen()
    assert.equal(s.gueltig('ausgedacht'), false)
    assert.equal(s.gueltig(undefined), false)
  })

  it('lässt Sitzungen ablaufen', () => {
    const s = new Sitzungen(1000)
    const t = 10_000
    const id = s.anlegen(t)
    assert.equal(s.gueltig(id, t + 999), true)
    assert.equal(s.gueltig(id, t + 1000), false, 'genau am Ende ist Schluss')
  })

  it('räumt abgelaufene beim Anlegen weg (kein unbegrenztes Wachsen)', () => {
    const s = new Sitzungen(1000)
    s.anlegen(0)
    s.anlegen(0)
    assert.equal(s.anzahl, 2)
    s.anlegen(5000)
    assert.equal(s.anzahl, 1, 'die beiden alten sind weg')
  })

  it('vergibt keine zweimal gleiche Kennung', () => {
    const s = new Sitzungen()
    const alle = new Set(Array.from({ length: 200 }, () => s.anlegen()))
    assert.equal(alle.size, 200)
  })
})

describe('gleichOhneZeitverrat', () => {
  it('vergleicht richtig', () => {
    assert.equal(gleichOhneZeitverrat('abc', 'abc'), true)
    assert.equal(gleichOhneZeitverrat('abc', 'abd'), false)
    assert.equal(gleichOhneZeitverrat('abc', 'abcd'), false)
  })
})

describe('torBauen', () => {
  const anfrage = (o: { addr?: string; pfad?: string; cookie?: string }) =>
    ({
      socket: { remoteAddress: o.addr },
      path: o.pfad ?? '/api/data',
      headers: o.cookie ? { cookie: o.cookie } : {},
    }) as never

  const antwort = () => {
    const r = { code: 0, koerper: null as unknown }
    return {
      status(c: number) {
        r.code = c
        return this
      },
      json(b: unknown) {
        r.koerper = b
        return this
      },
      _r: r,
    } as never as { _r: typeof r } & Record<string, unknown>
  }

  const lauf = (tor: ReturnType<typeof torBauen>, req: never) => {
    const res = antwort()
    let weiter = false
    tor(req, res as never, () => {
      weiter = true
    })
    return { weiter, code: (res as { _r: { code: number } })._r.code }
  }

  it('lässt alles durch, solange die Anmeldung AUS ist', () => {
    // Bestandsboxen dürfen nach einem Update nicht plötzlich fragen.
    const tor = torBauen({ anmeldungNoetig: () => false, sitzungen: new Sitzungen() })
    assert.equal(lauf(tor, anfrage({ addr: '192.168.178.9' })).weiter, true)
  })

  it('lässt die BOX SELBST immer durch — sonst bleibt ihr Bildschirm leer', () => {
    const tor = torBauen({ anmeldungNoetig: () => true, sitzungen: new Sitzungen() })
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
      assert.equal(lauf(tor, anfrage({ addr: a })).weiter, true, a)
  })

  it('weist von außen ohne Sitzung ab', () => {
    const tor = torBauen({ anmeldungNoetig: () => true, sitzungen: new Sitzungen() })
    const e = lauf(tor, anfrage({ addr: '192.168.178.9' }))
    assert.equal(e.weiter, false)
    assert.equal(e.code, 401)
  })

  it('lässt von außen MIT gültiger Sitzung durch', () => {
    const s = new Sitzungen()
    const tor = torBauen({ anmeldungNoetig: () => true, sitzungen: s })
    const id = s.anlegen()
    const e = lauf(tor, anfrage({ addr: '192.168.178.9', cookie: `${COOKIE_NAME}=${id}` }))
    assert.equal(e.weiter, true)
  })

  it('weist eine erfundene Sitzung ab', () => {
    const tor = torBauen({ anmeldungNoetig: () => true, sitzungen: new Sitzungen() })
    const e = lauf(tor, anfrage({ addr: '192.168.178.9', cookie: `${COOKIE_NAME}=ausgedacht` }))
    assert.equal(e.weiter, false)
    assert.equal(e.code, 401)
  })

  it('hält die Anmeldewege selbst offen (sonst kommt niemand mehr herein)', () => {
    const tor = torBauen({ anmeldungNoetig: () => true, sitzungen: new Sitzungen() })
    for (const p of ['/api/auth/login', '/api/auth/state', '/api/auth/logout'])
      assert.equal(lauf(tor, anfrage({ addr: '192.168.178.9', pfad: p })).weiter, true, p)
  })

  it('hält die PIN-Prüfung der Box offen — sonst hinge ihr Sperrdialog fest', () => {
    // Der Dialog vor den Einstellungen laeuft im Kiosk auf der Box, ruft die
    // Box aber unter ihrem eigenen Namen an (so ist sie verlinkt, damit die
    // Einrichtung von einem anderen Rechner aus geht). Das gilt hier als „von
    // aussen" — mit 401 kaeme man nie wieder in die Einstellungen.
    const tor = torBauen({ anmeldungNoetig: () => true, sitzungen: new Sitzungen() })
    const e = lauf(tor, anfrage({ addr: '192.168.178.9', pfad: '/api/einstellungen/pin-pruefen' }))
    assert.equal(e.weiter, true)
  })

  it('lässt das SETZEN der PIN aber NICHT offen', () => {
    // Vertretbar ist nur die Frage „stimmt diese PIN" — ihre Antwort ist
    // ja/nein und aendert nichts. Wer die PIN neu setzen darf, hebt die
    // Kindersicherung auf; das gehoert hinter die Anmeldung.
    const tor = torBauen({ anmeldungNoetig: () => true, sitzungen: new Sitzungen() })
    const e = lauf(tor, anfrage({ addr: '192.168.178.9', pfad: '/api/konfiguration/einstellungs-pin' }))
    assert.equal(e.weiter, false)
    assert.equal(e.code, 401)
  })

  it('schützt die gefährlichen Wege von außen', () => {
    const tor = torBauen({ anmeldungNoetig: () => true, sitzungen: new Sitzungen() })
    // `/api/delete` stand hier bis zum 19.09.2026 mit in der Liste; die Route
    // ist gefallen (AUDIT-2026-09-19 Rang 7). Eine Zusicherung ueber einen Weg,
    // den es nicht gibt, beweist nichts — dafuer steht jetzt der Loeschweg der
    // Medienverwaltung da, der dieselbe Wirkung hat und lebt.
    for (const p of ['/api/shutdown', '/api/reboot', '/api/medien/abc', '/api/spotify/config'])
      assert.equal(lauf(tor, anfrage({ addr: '192.168.178.9', pfad: p })).weiter, false, p)
  })
})

describe('Cookie-Kopfzeilen', () => {
  it('setzt die schützenden Merkmale', () => {
    const c = sitzungsCookie('abc', false)
    assert.match(c, /HttpOnly/)
    assert.match(c, /SameSite=Strict/)
    assert.match(c, /Path=\//)
  })

  it('setzt Secure NUR über TLS', () => {
    // Über http://<box>:8200 käme ein Secure-Cookie nie an.
    assert.equal(/Secure/.test(sitzungsCookie('abc', false)), false)
    assert.equal(/Secure/.test(sitzungsCookie('abc', true)), true)
  })

  it('löscht die Sitzung beim Abmelden', () => {
    assert.match(abmeldeCookie(false), /Max-Age=0/)
  })
})
