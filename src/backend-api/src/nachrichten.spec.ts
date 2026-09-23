/**
 * Die Regeln aus nachrichten.ts, jede an ihrem Beispiel.
 *
 * DIE BEISPIELE SIND ERFUNDEN, und zwar mit Absicht: eine echte Matrix-ID
 * oder eine echte Telefonnummer in einer Testdatei ist eine Kontaktangabe im
 * Versionsverlauf. `example`-Namen und die Nummer +49 170 0000000 sind
 * erkennbar keine.
 *
 * DAS SCHWERGEWICHT LIEGT AUF DER ERLAUBNISLISTE. Alles andere ist
 * Bequemlichkeit; wer hier durchkommt, redet mit einem Kind.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  absenderSchluessel,
  ausMatrix,
  ausSignal,
  ausTelegram,
  DECKEL,
  type Erlaubt,
  einfuegen,
  eintragFuer,
  type Nachricht,
  naechsteZumSprechen,
  sprechtext,
  steuerlos,
  TEXT_DECKEL,
  textSaeubern,
  ungelesen,
  vorlesenAn,
} from './nachrichten'

const LISTE: Erlaubt[] = [
  { weg: 'matrix', absender: '@mama:server.example', name: 'Mama' },
  { weg: 'signal', absender: '+49 170 0000000', name: 'Papa' },
  { weg: 'telegram', absender: '4711', name: 'Oma' },
]

function matrixEreignis(ueber: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'm.room.message',
    event_id: '$abc',
    sender: '@mama:server.example',
    origin_server_ts: 1_700_000_000_000,
    content: { msgtype: 'm.text', body: 'In zehn Minuten gibt es Essen.' },
    ...ueber,
  }
}

describe('absenderSchluessel', () => {
  it('schreibt Matrix-IDs klein — @Mama und @mama sind dasselbe Konto', () => {
    assert.equal(absenderSchluessel('matrix', '@Mama:Server.Example'), '@mama:server.example')
  })

  it('wirft bei Signal jede Schreibweise weg und laesst die Nummer stehen', () => {
    assert.equal(absenderSchluessel('signal', '+49 170 0000000'), '+491700000000')
    assert.equal(absenderSchluessel('signal', '+49-170-0000000'), '+491700000000')
    assert.equal(absenderSchluessel('signal', '(0049) 170 0000000'), '+491700000000')
  })

  it('WEIST EINE NATIONALE NUMMER AB, statt eine zu raten, die nie passt', () => {
    assert.equal(absenderSchluessel('signal', '0170 0000000'), '')
    assert.equal(absenderSchluessel('signal', '170-0000000'), '')
  })

  it('nimmt bei Telegram nur Zahlen — alles andere ist keine Chat-ID', () => {
    assert.equal(absenderSchluessel('telegram', 4711), '4711')
    assert.equal(absenderSchluessel('telegram', '-100123'), '-100123')
    assert.equal(absenderSchluessel('telegram', '@omas_konto'), '')
  })

  it('macht aus nichts nichts — und nicht aus Versehen einen Treffer', () => {
    assert.equal(absenderSchluessel('matrix', undefined), '')
    assert.equal(absenderSchluessel('signal', '+++'), '')
  })
})

describe('eintragFuer — die Erlaubnisliste', () => {
  it('findet den Eintrag trotz anderer Schreibweise', () => {
    assert.equal(eintragFuer('signal', '+491700000000', LISTE)?.name, 'Papa')
    assert.equal(eintragFuer('matrix', '@MAMA:SERVER.EXAMPLE', LISTE)?.name, 'Mama')
  })

  it('haelt die Wege auseinander: dieselbe Zeichenkette auf anderem Weg zaehlt nicht', () => {
    assert.equal(eintragFuer('telegram', '@mama:server.example', LISTE), null)
  })

  it('LEERE LISTE HEISST NIEMAND — nicht alle', () => {
    assert.equal(eintragFuer('matrix', '@mama:server.example', []), null)
  })

  it('laesst einen leeren Absender nie durch', () => {
    assert.equal(eintragFuer('matrix', '', [{ weg: 'matrix', absender: '' }]), null)
  })
})

describe('textSaeubern', () => {
  it('macht aus jedem Weissraum ein Leerzeichen', () => {
    assert.equal(textSaeubern('  Hallo\n\n   du\t da '), 'Hallo du da')
  })

  it('wirft Steuerzeichen heraus — samt der beiden, die eine JS-Zeile beenden', () => {
    const roh = `a${String.fromCodePoint(0)}b${String.fromCodePoint(0x2028)}c`
    assert.equal(textSaeubern(roh), 'a b c')
    assert.ok(!steuerlos(roh).includes(String.fromCodePoint(0)))
  })

  it('schneidet ab UND sagt es', () => {
    const lang = 'x'.repeat(TEXT_DECKEL + 50)
    const aus = textSaeubern(lang)
    assert.equal(aus.length, TEXT_DECKEL)
    assert.ok(aus.endsWith('…'))
  })

  it('macht aus nichts eine leere Zeichenkette, nicht "undefined"', () => {
    assert.equal(textSaeubern(undefined), '')
    assert.equal(textSaeubern(null), '')
  })
})

describe('ausMatrix', () => {
  it('nimmt eine Textnachricht eines erlaubten Absenders an', () => {
    const u = ausMatrix(matrixEreignis(), LISTE)
    assert.ok(u?.ok)
    assert.equal(u.nachricht.text, 'In zehn Minuten gibt es Essen.')
    assert.equal(u.nachricht.absenderName, 'Mama')
    assert.equal(u.nachricht.zeit, 1_700_000_000_000)
    assert.equal(u.nachricht.gelesen, false)
    assert.equal(u.nachricht.gesprochen, false)
  })

  it('weist einen Fremden ab — auch mit tadellosem Text', () => {
    const u = ausMatrix(matrixEreignis({ sender: '@fremd:server.example' }), LISTE)
    assert.ok(u && !u.ok)
    assert.equal(u.grund, 'unbekannt')
  })

  it('laesst einen verschluesselten Raum durchfallen, statt ihn zu zeigen', () => {
    assert.equal(ausMatrix({ type: 'm.room.encrypted', sender: '@mama:server.example' }, LISTE), null)
  })

  it('geht an Beitritten und Reaktionen vorbei', () => {
    assert.equal(ausMatrix({ type: 'm.room.member', sender: '@mama:server.example' }, LISTE), null)
    assert.equal(ausMatrix({ type: 'm.reaction', sender: '@mama:server.example' }, LISTE), null)
  })

  it('meldet ein Bild als kein-text statt es stumm zu verschlucken', () => {
    const u = ausMatrix(matrixEreignis({ content: { msgtype: 'm.image', body: 'katze.png' } }), LISTE)
    assert.ok(u && !u.ok)
    assert.equal(u.grund, 'kein-text')
  })
})

describe('ausTelegram', () => {
  const update = {
    update_id: 7,
    message: {
      message_id: 12,
      from: { id: 4711, first_name: 'Oma', last_name: 'Elli' },
      chat: { id: 4711 },
      date: 1_700_000_000,
      text: 'Gute Nacht!',
    },
  }

  it('rechnet Sekunden in Millisekunden um', () => {
    const u = ausTelegram(update, LISTE)
    assert.ok(u?.ok)
    assert.equal(u.nachricht.zeit, 1_700_000_000_000)
  })

  it('nimmt den Namen aus dem Update, nicht den aus der Liste', () => {
    const u = ausTelegram(update, LISTE)
    assert.ok(u?.ok)
    assert.equal(u.nachricht.absenderName, 'Oma Elli')
  })

  it('PRUEFT DEN MENSCHEN, NICHT DEN CHAT: eine freigegebene Gruppe oeffnet nicht jedem darin', () => {
    const inGruppe = {
      message: { message_id: 13, from: { id: 999 }, chat: { id: 4711 }, date: 1, text: 'hallo' },
    }
    const u = ausTelegram(inGruppe, LISTE)
    assert.ok(u && !u.ok)
    assert.equal(u.grund, 'unbekannt')
  })

  it('nimmt eine bearbeitete Nachricht auch an', () => {
    const u = ausTelegram({ edited_message: update.message }, LISTE)
    assert.ok(u?.ok)
  })

  it('geht an einem Update ohne Nachricht vorbei', () => {
    assert.equal(ausTelegram({ update_id: 8, poll: {} }, LISTE), null)
  })
})

describe('ausSignal', () => {
  const meldung = {
    envelope: {
      source: '+491700000000',
      sourceName: 'Papa',
      timestamp: 1_700_000_000_000,
      dataMessage: { message: 'Bin gleich da.', timestamp: 1_700_000_000_000 },
    },
  }

  it('nimmt eine Textnachricht an', () => {
    const u = ausSignal(meldung, LISTE)
    assert.ok(u?.ok)
    assert.equal(u.nachricht.text, 'Bin gleich da.')
    assert.equal(u.nachricht.absender, '+491700000000')
  })

  it('GEHT AN LESEBESTAETIGUNGEN VORBEI, statt sie als Fremde zu zaehlen', () => {
    const quittung = { envelope: { source: '+491700000000', receiptMessage: { when: 1 } } }
    assert.equal(ausSignal(quittung, LISTE), null)
  })

  it('baut eine Kennung, die dieselbe Nachricht wiedererkennt', () => {
    const a = ausSignal(meldung, LISTE)
    const b = ausSignal(meldung, LISTE)
    assert.ok(a?.ok && b?.ok)
    assert.equal(a.nachricht.id, b.nachricht.id)
  })
})

describe('einfuegen', () => {
  function n(id: string, zeit = 1): Nachricht {
    return { id, weg: 'matrix', absender: '@m:s', absenderName: '', text: 't', zeit, gelesen: false, gesprochen: false }
  }

  it('haengt vorne an — neueste zuerst', () => {
    const l = einfuegen([n('a')], n('b'))
    assert.deepEqual(
      l.map((x) => x.id),
      ['b', 'a'],
    )
  })

  it('WIRFT DIE DUBLETTE WEG: zweimal abgeholt heisst nicht zweimal gerufen', () => {
    const l = einfuegen([n('a')], n('a'))
    assert.equal(l.length, 1)
  })

  it('haelt den Deckel', () => {
    let l: Nachricht[] = []
    for (let i = 0; i < DECKEL + 10; i++) l = einfuegen(l, n(`i${i}`))
    assert.equal(l.length, DECKEL)
    assert.equal(l[0].id, `i${DECKEL + 9}`)
  })
})

describe('zaehlen, sprechen, vorlesen', () => {
  function n(id: string, ueber: Partial<Nachricht> = {}): Nachricht {
    return {
      id,
      weg: 'matrix',
      absender: '@m:s',
      absenderName: '',
      text: 't',
      zeit: 1,
      gelesen: false,
      gesprochen: false,
      ...ueber,
    }
  }

  it('zaehlt nur die ungelesenen', () => {
    assert.equal(ungelesen([n('a'), n('b', { gelesen: true })]), 1)
  })

  it('spricht die AELTESTE zuerst, auch wenn sie hinten liegt', () => {
    const liste = [n('neu', { zeit: 200 }), n('alt', { zeit: 100 })]
    assert.equal(naechsteZumSprechen(liste)?.id, 'alt')
  })

  it('haelt gesprochen und gelesen auseinander', () => {
    const liste = [n('a', { gelesen: true, gesprochen: false })]
    assert.equal(naechsteZumSprechen(liste)?.id, 'a')
    assert.equal(naechsteZumSprechen([n('a', { gesprochen: true })]), null)
  })

  it('stellt den Absender vor den Satz', () => {
    assert.equal(sprechtext({ absenderName: 'Mama', absender: '@m:s', text: 'Essen!' }), 'Nachricht von Mama: Essen!')
  })

  it('nimmt die Kennung, wenn kein Name da ist', () => {
    assert.equal(sprechtext({ absenderName: '', absender: '+4917', text: 'Hi' }), 'Nachricht von +4917: Hi')
  })

  it('FEHLT DAS PROFILFELD, GILT DIE BOX — und nicht eine eigene Vorgabe', () => {
    assert.equal(vorlesenAn(undefined, true), true)
    assert.equal(vorlesenAn(undefined, false), false)
    assert.equal(vorlesenAn(false, true), false)
    assert.equal(vorlesenAn(true, false), true)
  })
})
