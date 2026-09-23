/**
 * Tests für Systemzustand und Systemaktionen.
 *
 * Die Aktionstabelle wird mitgeprüft, obwohl sie „nur Daten" ist: sie ist die
 * einzige Stelle, an der Befehle stehen, die als root laufen. Ein Tippfehler
 * dort ist ein Knopf, der etwas anderes tut, als draufsteht.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AKTIONEN,
  groesse,
  istSystemAktion,
  laufzeitText,
  parseDf,
  parseTemperatur,
  platteKnapp,
} from './system.js'

describe('AKTIONEN', () => {
  it('enthält KEIN „Anzeige neu starten" — der Knopf holte X nicht zurück', () => {
    // Am Geraet zweimal erlebt: restart_kiosk.sh toetet X, und aus einem
    // Dienst heraus fehlt die Konsole, die startx braucht. Ein Knopf, der die
    // Anzeige zuverlaessig killt und nicht zurueckholt, gehoert nicht in eine
    // Verwaltung.
    //
    // `kiosk-heim` (14.08.2026) ist KEIN zweites „Anzeige neu starten",
    // sondern dessen Lehre: es toetet nur den Browser (nicht X), verlaesst
    // sich fuer den Neustart auf die Autologin-Kette der Box — und MISST das
    // Wiederkommen (mupi-kiosk-heim.sh wartet auf pgrep und endet sonst
    // rot). Der Anlass steht im Skript: der Kiosk sass auf
    // accounts.spotify.com fest, ohne Tastatur und ohne Rueckweg.
    assert.deepEqual(Object.keys(AKTIONEN).sort(), [
      'drehung-zurueck',
      'herunterfahren',
      'kiosk-heim',
      'medien-neu',
      'neustart',
    ])
  })

  it('setzt keinen Befehl aus Bestandteilen zusammen', () => {
    for (const [id, a] of Object.entries(AKTIONEN)) {
      assert.equal(typeof a.befehl, 'string', id)
      assert.ok(Array.isArray(a.args), id)
      // Kein Argument darf nach Shell aussehen — es gibt keine, aber wenn
      // jemand später doch eine einführt, soll dieser Test anschlagen.
      for (const arg of a.args)
        assert.equal(/[;&|`$()<>]/.test(arg), false, `${id}: ${arg}`)
    }
  })

  it('markiert genau die Aktionen als einschneidend, die dem Menschen etwas wegnehmen', () => {
    const hart = Object.entries(AKTIONEN)
      .filter(([, a]) => a.einschneidend)
      .map(([id]) => id)
      .sort()
    // Auch das Zuruecknehmen der Drehung startet neu — also nachfragen. Und
    // kiosk-heim macht den Schirm kurz schwarz (dazu: box + NICHT
    // einschneidend stuende nirgends in der Bedienung, siehe den
    // Bedienweg-Test unten).
    assert.deepEqual(hart, ['drehung-zurueck', 'herunterfahren', 'kiosk-heim', 'neustart'])
  })

  it('nimmt uns nur bei Neustart und Herunterfahren mit', () => {
    // ══ WORAN DIESER TEST HAENGT ═══════════════════════════════════════════
    //
    // `nimmtUnsMit` entscheidet in server.ts, ob die Antwort VOR oder NACH dem
    // Befehl hinausgeht. Steht es faelschlich auf true, meldet der Knopf
    // Erfolg, bevor irgendetwas passiert ist — und ein Fehlschlag erreicht
    // niemanden ausser dem Serverprotokoll. Genau so meldete
    // „Bildschirm-Drehung zurücknehmen" jahrelang „erledigt" fuer eine Datei,
    // die es auf der Box nicht gibt.
    //
    // Steht es faelschlich auf false, wartet der Server auf einen Befehl, der
    // ihn selbst beendet — die Oberflaeche haengt dann bis zum Zeitablauf.
    // Beide Richtungen sind Fehler, deshalb wird die Liste GENAU verglichen.
    const mit = Object.entries(AKTIONEN)
      .filter(([, a]) => a.nimmtUnsMit)
      .map(([id]) => id)
      .sort()
    assert.deepEqual(mit, ['herunterfahren', 'neustart'])
  })

  it('trennt „nimmt uns mit" von „einschneidend" — sie meinen Verschiedenes', () => {
    // `einschneidend` ist eine Frage an den Menschen, `nimmtUnsMit` eine
    // Aussage ueber die Maschine. Bei `drehung-zurueck` gehen sie
    // auseinander: nachfragen ja, den Server mitnehmen nein. Waeren die
    // beiden immer gleich, braeuchte es das zweite Datum nicht — dieser Test
    // haelt fest, dass es es braucht.
    const a = AKTIONEN['drehung-zurueck']
    assert.equal(a.einschneidend, true)
    assert.equal(a.nimmtUnsMit, false)
  })

  it('sagt an jeder Aktion, auf welche Seite sie gehört', () => {
    // DER UMZUG VOM 03.08.2026: „Medien neu einlesen" stand unter System und
    // steht jetzt auf der Medienseite. Ohne diese Angabe müsste jede der
    // beiden Seiten die Zuordnung selbst kennen — und beim nächsten
    // Umsortieren gäbe es zwei Wahrheiten, von denen keine Prüfung merkt,
    // wenn sie auseinanderlaufen.
    const jeBereich: Record<string, string[]> = { medien: [], box: [] }
    for (const [id, a] of Object.entries(AKTIONEN)) jeBereich[a.bereich].push(id)
    assert.deepEqual(jeBereich.medien.sort(), ['medien-neu'])
    assert.deepEqual(jeBereich.box.sort(), ['drehung-zurueck', 'herunterfahren', 'kiosk-heim', 'neustart'])
  })

  it('gibt jeder Aktion GENAU EINEN Bedienweg — keine ohne, keine doppelt', () => {
    // NACHGESCHAERFT BEIM GEGENLESEN AM 03.08.2026.
    //
    // Seit dem Umzug zeigen zwei Seiten Teile dieser Liste, und beide fragen
    // nach etwas ANDEREM:
    //     Systemseite   alle mit einschneidend === true
    //     Medienseite   alle mit bereich === 'medien'
    // Damit gibt es zwei Loecher, die kein Uebersetzer und kein Test darueber
    // sieht:
    //     bereich 'box'    + einschneidend false  -> steht NIRGENDS
    //     bereich 'medien' + einschneidend true   -> steht ZWEIMAL
    // Der Test daneben prueft die ZUORDNUNG (welche Aktion in welchen
    // Bereich); wer eine neue eintraegt, ergaenzt dort brav die Liste und ist
    // fertig — die Aktion kann trotzdem unbedienbar sein. Hier wird deshalb
    // die Eigenschaft selbst geprueft und nicht die Aufzaehlung.
    for (const [id, a] of Object.entries(AKTIONEN)) {
      const aufMedien = a.bereich === 'medien'
      assert.notEqual(
        aufMedien,
        a.einschneidend,
        `${id}: ${aufMedien ? 'steht auf beiden Seiten' : 'steht auf keiner Seite'} ` +
          `(bereich=${a.bereich}, einschneidend=${a.einschneidend})`,
      )
    }
  })

  it('fasst die Anzeige nur ueber den EINEN messenden Weg an', () => {
    // Nichts hier darf X beenden und dann HOFFEN — siehe den Kopf von
    // system.ts und die Geschichte von „Anzeige neu starten". Seit dem
    // 14.08.2026 gibt es genau EINE Ausnahme: kiosk-heim, und die ist auf
    // das Skript festgenagelt, das das Wiederkommen MISST und sonst rot
    // endet (mupi-kiosk-heim.sh). Jede weitere Aktion, die kiosk oder
    // chromium beruehrt, faellt hier auf — und gehoert erst hinein, wenn
    // sie dieselbe Beweispflicht traegt.
    for (const [id, a] of Object.entries(AKTIONEN)) {
      if (id === 'kiosk-heim') {
        assert.deepEqual(a.args, ['/usr/local/bin/mupibox/mupi-kiosk-heim.sh'], id)
        continue
      }
      assert.equal(
        a.args.some((x) => x.includes('kiosk') || x.includes('chromium')),
        false,
        id,
      )
    }
  })
})

describe('istSystemAktion', () => {
  it('nimmt die bekannten an', () => {
    for (const id of Object.keys(AKTIONEN)) assert.equal(istSystemAktion(id), true, id)
  })

  it('weist alles andere ab', () => {
    for (const x of ['', 'rm', 'neustart; reboot', '__proto__', 'constructor', null, 42, {}])
      assert.equal(istSystemAktion(x), false, String(x))
  })

  it('lässt sich nicht über die Prototypenkette austricksen', () => {
    // Object.hasOwn statt `in` — sonst wäre 'toString' eine gültige Aktion.
    assert.equal(istSystemAktion('toString'), false)
    assert.equal(istSystemAktion('hasOwnProperty'), false)
  })
})

describe('laufzeitText', () => {
  it('antwortet auf die Frage, die gestellt wird', () => {
    assert.equal(laufzeitText(268344), '3 Tage, 2 h')
    assert.equal(laufzeitText(86400), '1 Tag, 0 h')
    assert.equal(laufzeitText(7380), '2 h 3 min')
    assert.equal(laufzeitText(120), '2 min')
    assert.equal(laufzeitText(0), '0 min')
  })

  it('verträgt Unsinn', () => {
    assert.equal(laufzeitText(-1), 'unbekannt')
    assert.equal(laufzeitText(Number.NaN), 'unbekannt')
  })
})

describe('parseTemperatur', () => {
  it('rechnet Milligrad um', () => {
    assert.equal(parseTemperatur('54321'), 54.3)
    assert.equal(parseTemperatur('  48000\n'), 48)
  })

  it('nimmt auch schon-Grad an', () => {
    assert.equal(parseTemperatur('47'), 47)
  })

  it('gibt null statt 0 zurück, wenn es nichts gibt', () => {
    // 0 °C stünde sonst als Messwert da, und jemand sucht einen Fehler.
    assert.equal(parseTemperatur(''), null)
    assert.equal(parseTemperatur('keine Ahnung'), null)
  })

  it('weist unsinnige Werte ab', () => {
    assert.equal(parseTemperatur('999999999'), null)
    assert.equal(parseTemperatur('-99000'), null)
  })
})

describe('parseDf', () => {
  const df = [
    'Dateisystem     1B-Blöcke      Benutzt     Verfügbar Verw% Eingehängt auf',
    '/dev/mmcblk0p2 31000000000  12000000000   17400000000   41% /',
  ].join('\n')

  it('liest die Zahlen richtig', () => {
    const p = parseDf(df)
    assert.equal(p?.gesamt, 31000000000)
    assert.equal(p?.benutzt, 12000000000)
    assert.equal(p?.frei, 17400000000)
    assert.equal(p?.prozent, 41)
  })

  it('zählt von hinten, damit ein langer Gerätename nichts verschiebt', () => {
    const lang =
      'Dateisystem 1B-Blöcke Benutzt Verfügbar Verw% Eingehängt auf\n' +
      '/dev/disk/by-uuid/1234-5678-abcd 31000000000 12000000000 17400000000 41% /'
    assert.equal(parseDf(lang)?.prozent, 41)
  })

  it('gibt null zurück, wenn nichts Brauchbares kommt', () => {
    assert.equal(parseDf(''), null)
    assert.equal(parseDf('nur eine Zeile'), null)
    assert.equal(parseDf('a b c d e\nzu wenig felder'), null)
  })
})

describe('groesse', () => {
  it('rundet lesbar', () => {
    assert.equal(groesse(0), '0 B')
    assert.equal(groesse(1024), '1.0 kB')
    assert.equal(groesse(31000000000), '29 GB')
  })

  it('verträgt Unsinn', () => {
    assert.equal(groesse(-1), '–')
    assert.equal(groesse(Number.NaN), '–')
  })
})

describe('platteKnapp', () => {
  it('warnt ab 90 Prozent', () => {
    const p = (prozent: number) => ({ gesamt: 100, benutzt: prozent, frei: 100 - prozent, prozent })
    assert.equal(platteKnapp(p(89)), false)
    assert.equal(platteKnapp(p(90)), true)
    assert.equal(platteKnapp(null), false)
  })
})
