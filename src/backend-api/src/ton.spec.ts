/**
 * Tests für die Tonausgabe.
 *
 * Die erzeugte ALSA-Konfiguration wird Zeichen für Zeichen geprüft, denn sie
 * ist eine DATEI, die ALSA als root liest — ein Tippfehler darin ist eine
 * stumme Box, und das merkt man erst, wenn ein Kind davorsteht.
 *
 * Die Form stammt von der echten Box (Pi 5, bluealsa), inklusive der
 * Erkenntnis, dass `softvol` auch VOR bluealsa funktioniert und der Regler
 * dabei auf der internen Karte bleiben darf.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  REGLER_KARTE,
  REGLER_NAME,
  type Ziel,
  asoundConf,
  darfUmschalten,
  darfUmschaltenPw,
  istMac,
  istZiel,
  deckelFuer,
  klangDateiErlaubt,
  klangNormalisieren,
  klangVorgabe,
  parseAsound,
  parsePactlSinks,
  sinkFuerZiel,
  sinkInputNachKnotenname,
  ueberallConfBauen,
  ueberallMitglied,
  zielAusSinkName,
  zielGleich,
  quellenAnzeigeName,
  quellenAusPactlJson,
  quellenPegelGueltig,
  senkenMitPegelAusPactlJson,
  zielName,
  istHardwareSenke,
  regelndeSenkeWaehlen,
} from './ton.js'

const MAC = '00:9E:C8:61:1A:EA'

describe('istMac / istZiel', () => {
  it('nimmt echte Ziele an', () => {
    assert.equal(istZiel({ art: 'intern' }), true)
    assert.equal(istZiel({ art: 'bluetooth', mac: MAC }), true)
  })

  it('weist ab, was in eine Konfigurationsdatei geschrieben würde', () => {
    // Dieser Wert landet in einer Datei, die ALSA als root liest.
    for (const x of [
      { art: 'bluetooth', mac: '00:9E:C8:61:1A:EA"\n}\npcm.boese {' },
      { art: 'bluetooth', mac: 'nichts' },
      { art: 'bluetooth' },
      { art: 'irgendwas' },
      null,
      'intern',
      42,
    ])
      assert.equal(istZiel(x), false, JSON.stringify(x))
  })

  it('prüft die Adresse streng', () => {
    assert.equal(istMac(MAC), true)
    assert.equal(istMac(`${MAC} `), false)
    assert.equal(istMac('00:9E:C8:61:1A'), false)
  })
})

describe('asoundConf — intern', () => {
  const c = asoundConf({ art: 'intern' })

  it('schickt den Ton an den eingebauten Verstärker', () => {
    assert.match(c, /slave\.pcm "plughw:CARD=MAX98357A,DEV=0"/)
    assert.equal(/type\s+bluealsa/.test(c), false)
  })

  it('behält den einen Lautstärkeregler', () => {
    assert.match(c, new RegExp(`control\\.name "${REGLER_NAME}"`))
    assert.match(c, new RegExp(`control\\.card "${REGLER_KARTE}"`))
  })

  it('setzt default und ctl wie bisher', () => {
    assert.match(c, /pcm\.!default \{/)
    assert.match(c, /slave\.pcm "mupibox"/)
    assert.match(c, /ctl\.!default \{/)
  })
})

describe('asoundConf — Bluetooth', () => {
  const c = asoundConf({ art: 'bluetooth', mac: MAC })

  it('schickt den Ton an bluealsa', () => {
    assert.match(c, /type\s+bluealsa/)
    assert.match(c, new RegExp(`device "${MAC}"`))
    assert.match(c, /profile "a2dp"/)
  })

  it('lässt den Regler auf der internen Karte — am Gerät geprüft', () => {
    // Genau das ist der Kniff: softvol funktioniert auch vor bluealsa, und
    // damit bleibt es bei EINEM Regler statt zweien mit verschiedener Wirkung.
    assert.match(c, /type\s+softvol/)
    assert.match(c, new RegExp(`control\\.card "${REGLER_KARTE}"`))
  })

  it('schreibt die Adresse in Großbuchstaben, wie BlueZ sie meldet', () => {
    assert.match(asoundConf({ art: 'bluetooth', mac: MAC.toLowerCase() }), new RegExp(MAC))
  })

  it('lässt den Rest der Datei unverändert', () => {
    assert.match(c, /pcm\.!default \{/)
    assert.match(c, /slave\.pcm "mupibox"/)
  })
})

describe('parseAsound', () => {
  it('erkennt die eigene Bluetooth-Fassung wieder', () => {
    const z = parseAsound(asoundConf({ art: 'bluetooth', mac: MAC }))
    assert.deepEqual(z, { art: 'bluetooth', mac: MAC })
  })

  it('erkennt die eigene interne Fassung wieder', () => {
    assert.deepEqual(parseAsound(asoundConf({ art: 'intern' })), { art: 'intern' })
  })

  it('liest die Fassung, die vorher auf der Box stand, als intern', () => {
    // Woertlich von der Box abgeschrieben.
    const alt = [
      'pcm.mupibox {',
      '    type softvol',
      '    slave.pcm "plughw:CARD=MAX98357A,DEV=0"',
      '    control.name "Master"',
      '    control.card "MAX98357A"',
      '}',
      'pcm.!default { type plug; slave.pcm "mupibox" }',
    ].join('\n')
    assert.deepEqual(parseAsound(alt), { art: 'intern' })
  })

  it('hält Unklares für intern — das ist der Zustand mit Ton', () => {
    assert.deepEqual(parseAsound(''), { art: 'intern' })
    assert.deepEqual(parseAsound('völliger Unsinn'), { art: 'intern' })
    // bluealsa ohne lesbare Adresse: lieber intern als eine geratene Adresse.
    assert.deepEqual(parseAsound('type bluealsa\ndevice "kaputt"'), { art: 'intern' })
  })
})

describe('zielGleich / zielName', () => {
  it('vergleicht ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    const a: Ziel = { art: 'bluetooth', mac: MAC }
    const b: Ziel = { art: 'bluetooth', mac: MAC.toLowerCase() }
    assert.equal(zielGleich(a, b), true)
    assert.equal(zielGleich(a, { art: 'intern' }), false)
    assert.equal(zielGleich({ art: 'intern' }, { art: 'intern' }), true)
  })

  it('benennt verständlich', () => {
    assert.equal(zielName({ art: 'intern' }), 'Eingebauter Lautsprecher')
    assert.match(zielName({ art: 'bluetooth', mac: MAC }, '小米蓝牙音箱'), /小米蓝牙音箱/)
    // Ohne Namen wenigstens die Adresse, statt "undefined".
    assert.match(zielName({ art: 'bluetooth', mac: MAC }), new RegExp(MAC))
  })
})

describe('PipeWire: Senken lesen', () => {
  // Wortlaut von der laufenden Box (2026-07-27), nicht erfunden.
  const echt = [
    '53\talsa_output.platform-soc_107c000000_sound.stereo-fallback\tPipeWire\ts32le 2ch 48000Hz\tIDLE',
    '849\tbluez_output.00_9E_C8_61_1A_EA.1\tPipeWire\ts16le 2ch 48000Hz\tRUNNING',
  ].join('\n')

  it('liest Nummer und Namen', () => {
    const s = parsePactlSinks(echt)
    assert.equal(s.length, 2)
    assert.equal(s[0].id, 53)
    assert.equal(s[1].name, 'bluez_output.00_9E_C8_61_1A_EA.1')
  })

  it('übergeht Unfug, statt zu werfen', () => {
    // Die Liste ist eine Momentaufnahme — ein Gerät kann mitten im Lesen gehen.
    assert.deepEqual(parsePactlSinks(''), [])
    assert.deepEqual(parsePactlSinks('kaputt\n\nauch kaputt'), [])
    assert.equal(parsePactlSinks(`${echt}\nhalbe Zeile`).length, 2)
  })

  it('holt die Adresse aus dem Bluetooth-Namen', () => {
    // PipeWire schreibt die MAC mit Unterstrichen in den Senkennamen — sie
    // muss also nirgends nachgeschlagen werden.
    assert.deepEqual(zielAusSinkName('bluez_output.00_9E_C8_61_1A_EA.1'), {
      art: 'bluetooth',
      mac: '00:9E:C8:61:1A:EA',
    })
  })

  it('hält alles Übrige für intern — das ist der Zustand MIT Ton', () => {
    assert.deepEqual(zielAusSinkName('alsa_output.platform-soc_107c000000_sound.stereo-fallback'), {
      art: 'intern',
    })
    assert.deepEqual(zielAusSinkName(''), { art: 'intern' })
    assert.deepEqual(zielAusSinkName('bluez_output.kaputt.1'), { art: 'intern' })
  })

  it('findet die Senke zu einem Ziel', () => {
    const s = parsePactlSinks(echt)
    assert.equal(sinkFuerZiel(s, { art: 'intern' })?.startsWith('alsa_output.'), true)
    assert.equal(
      sinkFuerZiel(s, { art: 'bluetooth', mac: '00:9e:c8:61:1a:ea' }),
      'bluez_output.00_9E_C8_61_1A_EA.1',
      'Schreibweise der Adresse darf keine Rolle spielen',
    )
    assert.equal(sinkFuerZiel(s, { art: 'bluetooth', mac: 'AA:BB:CC:DD:EE:FF' }), null)
  })

  it('lässt nur umschalten, was gerade DA ist', () => {
    const s = parsePactlSinks(echt)
    assert.equal(darfUmschaltenPw(s, { art: 'intern' }).ok, true)
    assert.equal(darfUmschaltenPw(s, { art: 'bluetooth', mac: '00:9E:C8:61:1A:EA' }).ok, true)
    assert.equal(darfUmschaltenPw(s, { art: 'bluetooth', mac: 'AA:BB:CC:DD:EE:FF' }).ok, false)
    // Intern geht IMMER — auch wenn die Liste leer ist. Sonst säße man bei
    // einem Fehlgriff fest.
    assert.equal(darfUmschaltenPw([], { art: 'intern' }).ok, true)
  })
})

describe('darfUmschalten — der Schutz vor der stummen Box', () => {
  it('lässt zurück auf intern IMMER zu', () => {
    // Der Weg zurueck darf nie versperrt sein.
    assert.equal(darfUmschalten({ art: 'intern' }, []).ok, true)
  })

  it('lässt Bluetooth zu, wenn das Gerät verbunden ist', () => {
    assert.equal(darfUmschalten({ art: 'bluetooth', mac: MAC }, [{ mac: MAC }]).ok, true)
  })

  it('VERWEIGERT ein nicht verbundenes Gerät', () => {
    // Sonst waere die Box stumm, und ALSA schaltet nicht von selbst zurueck.
    const p = darfUmschalten({ art: 'bluetooth', mac: MAC }, [])
    assert.equal(p.ok, false)
    assert.match(p.grund ?? '', /stumm/)
  })

  it('vergleicht die Adresse ohne Rücksicht auf Schreibweise', () => {
    assert.equal(
      darfUmschalten({ art: 'bluetooth', mac: MAC.toLowerCase() }, [{ mac: MAC }]).ok,
      true,
    )
  })
})

/**
 * DAS ZIEL „UEBERALL" (15.08.2026) — die Kombi-Senke aller Bluetooth-
 * Lautsprecher. Vier Regeln, jede einzeln kippbar:
 *   1. Der Senkenname `ueberall` ist ein EIGENES Ziel — nicht „intern"
 *      (sonst zeigte die Anzeige den eingebauten Lautsprecher, waehrend
 *      zwei Boxen spielen).
 *   2. Umschalten braucht die Senke UND mindestens einen verbundenen
 *      Bluetooth-Lautsprecher — sonst waere „Überall" Stille.
 *   3. Der alte ALSA-Stapel kennt kein Überall und sagt es ehrlich.
 *   4. `intern` findet nie versehentlich die Kombi-Senke.
 */
describe('Ziel Überall', () => {
  const SENKEN = [
    { id: 57, name: 'alsa_output.platform-soc.stereo-fallback' },
    { id: 36, name: 'ueberall' },
    { id: 73, name: 'bluez_output.7C_96_D2_89_35_CC.1' },
  ]

  it('der Senkenname ueberall ist ein eigenes Ziel, nicht intern', () => {
    assert.deepEqual(zielAusSinkName('ueberall'), { art: 'ueberall' })
    assert.equal(zielName({ art: 'ueberall' }), 'Überall (alle Bluetooth-Lautsprecher)')
    assert.equal(istZiel({ art: 'ueberall' }), true)
  })

  it('sinkFuerZiel findet die Kombi-Senke — und intern findet sie NICHT', () => {
    assert.equal(sinkFuerZiel(SENKEN, { art: 'ueberall' }), 'ueberall')
    assert.equal(sinkFuerZiel(SENKEN, { art: 'intern' }), 'alsa_output.platform-soc.stereo-fallback')
  })

  it('mit Senke und einem verbundenen Lautsprecher darf umgeschaltet werden', () => {
    assert.equal(darfUmschaltenPw(SENKEN, { art: 'ueberall' }).ok, true)
  })

  it('ohne verbundenen Lautsprecher: nein — Überall wäre Stille', () => {
    const ohneBt = SENKEN.filter((s) => !s.name.startsWith('bluez'))
    const u = darfUmschaltenPw(ohneBt, { art: 'ueberall' })
    assert.equal(u.ok, false)
    assert.match(u.grund || '', /Stille/)
  })

  it('ohne die Kombi-Senke selbst: nein — sie steht nicht bereit', () => {
    const ohneKombi = SENKEN.filter((s) => s.name !== 'ueberall')
    assert.equal(darfUmschaltenPw(ohneKombi, { art: 'ueberall' }).ok, false)
  })

  it('der alte ALSA-Stapel sagt ehrlich ab', () => {
    const u = darfUmschalten({ art: 'ueberall' }, [{ mac: '7C:96:D2:89:35:CC' }])
    assert.equal(u.ok, false)
    assert.match(u.grund || '', /PipeWire/)
  })
})

/**
 * PEGEL JE SENKE UND JE QUELLE (15.08.2026) — die Zerleger der Ton-Seite.
 */
describe('Quellen und Senken mit Pegel', () => {
  const QUELLEN_JSON = JSON.stringify([
    {
      index: 54,
      sink: 233,
      volume: { 'front-left': { value_percent: '80%' }, 'front-right': { value_percent: '80%' } },
      properties: { 'application.name': 'PipeWire ALSA [librespot]' },
    },
    // Der interne Zubringer der Kombi-Senke: KEIN application.name — er darf
    // nie als Quelle erscheinen (sonst gaebe es zwei Regler fuer dieselbe
    // Musik, und einer verstellte heimlich eine einzelne Box der Kombi).
    { index: 117, sink: 116, volume: { 'front-left': { value_percent: '100%' } }, properties: {} },
    {
      index: 88,
      sink: 233,
      volume: { mono: { value_percent: '105%' } },
      properties: { 'application.name': 'mpv' },
    },
  ])

  it('liest Quellen, uebersetzt Namen und ueberspringt Kombi-Interna', () => {
    const q = quellenAusPactlJson(QUELLEN_JSON)
    assert.equal(q.length, 2, 'der namenlose Zubringer muss draussen bleiben')
    assert.deepEqual(q[0], { kennung: 54, name: 'Spotify', roh: 'PipeWire ALSA [librespot]', prozent: 80 })
    assert.equal(q[1].name, 'Hörspiele & Radio')
    assert.equal(q[1].prozent, 105, 'auch mono-Lautstaerken werden gelesen')
  })

  it('der Soloist-Strom heisst schlicht "spotify" — und wird trotzdem Spotify', () => {
    // llmwiki soloist-erste-messung: der PipeWire-Knoten von Soloist traegt weder
    // "soloist" noch "librespot" im Namen. Bis 22.08.2026 fiel er hier durch
    // und stand im Quellen-Regler unter seinem Rohnamen.
    const q = quellenAusPactlJson(
      JSON.stringify([
        {
          index: 91,
          sink: 233,
          volume: { 'front-left': { value_percent: '70%' } },
          properties: { 'application.name': 'spotify' },
        },
      ]),
    )
    assert.equal(q[0].name, 'Spotify')
    // Aber NUR der genaue Name: "MeinSpotifyMitschnitt" ist nicht die Maschine.
    assert.equal(quellenAnzeigeName('MeinSpotifyMitschnitt'), 'MeinSpotifyMitschnitt')
  })

  it('Unsinn ist eine leere Liste, kein Fehler', () => {
    assert.deepEqual(quellenAusPactlJson('kaputt'), [])
    assert.deepEqual(quellenAusPactlJson('{}'), [])
  })

  it('liest Senken samt Ziel-Art — die Kombi als ueberall, der HAT als intern', () => {
    const s = senkenMitPegelAusPactlJson(
      JSON.stringify([
        { name: 'alsa_output.platform-soc_sound.stereo-fallback', volume: { 'front-left': { value_percent: '40%' } } },
        { name: 'ueberall', volume: { 'front-left': { value_percent: '100%' } } },
        // Der Entzerrer MUSS herausfallen: als Senke gilt er als „intern"
        // und stand sonst als zweiter „Eingebauter Lautsprecher" da.
        { name: 'entzerrer', volume: { 'front-left': { value_percent: '100%' } } },
        { name: 'bluez_output.7C_96_D2_89_35_CC.1', volume: { 'front-left': { value_percent: '57%' } } },
      ]),
    )
    assert.equal(s.length, 3)
    assert.ok(!s.some((x) => x.sinkName === 'entzerrer'))
    assert.equal(s[0].ziel.art, 'intern')
    assert.equal(s[0].prozent, 40)
    assert.equal(s[1].ziel.art, 'ueberall')
    assert.equal(s[2].ziel.art, 'bluetooth')
  })

  it('der Pegel-Riegel: ganzzahlig, 0 bis 125', () => {
    for (const gut of [0, 50, 100, 125]) assert.equal(quellenPegelGueltig(gut), true, String(gut))
    for (const schlecht of [-1, 126, 50.5, '80', null, Number.NaN]) {
      assert.equal(quellenPegelGueltig(schlecht), false, String(schlecht))
    }
  })
})

describe('Klang: Equalizer, Versatz, Überall-Auswahl', () => {
  it('normalisiert Unsinn zur Vorgabe und faengt Zahlen ein', () => {
    assert.deepEqual(klangNormalisieren(null), klangVorgabe())
    assert.deepEqual(klangNormalisieren('kaputt'), klangVorgabe())
    const k = klangNormalisieren({
      entzerrer: { an: true, baender: { tief: -99, mitte: 4.4, hoch: 'laut', fremd: 3 } },
      // Ein von Hand uebertriebener Versatz darf keine sekundenversetzte
      // Box ergeben — und 0 ist KEIN Eintrag, sonst wuechse die Datei mit
      // jedem Zuruecksetzen.
      versatz: { '7C:96:D2:89:35:CC': 5000, '00:9e:c8:61:1a:ea': 120.6, 'keine-mac': 80, 'AA:BB:CC:DD:EE:FF': 0 },
      ueberall: { intern: true, '7C:96:D2:89:35:CC': false, 'AA:BB': false, '00:9E:C8:61:1A:EA': 'ja' },
    })
    assert.equal(k.entzerrer.an, true)
    assert.equal(k.entzerrer.baender.tief, -12)
    assert.equal(k.entzerrer.baender.mitte, 4)
    assert.equal(k.entzerrer.baender.hoch, 0)
    assert.ok(!('fremd' in k.entzerrer.baender))
    assert.deepEqual(k.versatz, { '7C:96:D2:89:35:CC': 1000, '00:9E:C8:61:1A:EA': 121 })
    assert.deepEqual(k.ueberall, { intern: true, '7C:96:D2:89:35:CC': false })
  })

  it('Überall-Mitglied: Bluetooth spielt ohne Eintrag mit, intern nur auf Wunsch', () => {
    const leer = klangVorgabe()
    assert.equal(ueberallMitglied(leer, '7C:96:D2:89:35:CC'), true)
    assert.equal(ueberallMitglied(leer, 'intern'), false)
    const gewaehlt = klangNormalisieren({ ueberall: { intern: true, '7C:96:D2:89:35:CC': false } })
    assert.equal(ueberallMitglied(gewaehlt, '7c:96:d2:89:35:cc'), false)
    assert.equal(ueberallMitglied(gewaehlt, 'intern'), true)
    assert.equal(ueberallMitglied(gewaehlt, '00:9E:C8:61:1A:EA'), true)
  })

  it('die generierte Überall-Conf traegt Ausgleich und GENAU die Gewaehlten', () => {
    const conf = ueberallConfBauen(true, ['7C:96:D2:89:35:CC', 'quatsch'])
    assert.match(conf, /combine\.latency-compensate = true/)
    assert.match(conf, /node\.name = "ueberall"/)
    assert.match(conf, /~alsa_output\.\*/)
    assert.match(conf, /~bluez_output\.7C_96_D2_89_35_CC\.\*/)
    // Was keine MAC ist, kommt nicht in die Regeln — die Conf liest ein
    // Tonserver, kein Mensch.
    assert.ok(!conf.includes('quatsch'))
    // Ohne intern kein alsa-Treffer.
    assert.ok(!ueberallConfBauen(false, ['7C:96:D2:89:35:CC']).includes('alsa_output'))
    // OHNE Glieder KEINE Regel: `matches = []` traefe sonst alles.
    assert.ok(!ueberallConfBauen(false, []).includes('stream.rules'))
  })

  it('der Entzerrer ist nie ein Ziel — die intern-Suche ueberspringt ihn', () => {
    const senken = parsePactlSinks(
      ['40\tentzerrer\tPipeWire', '67\talsa_output.platform-soc_sound.stereo-fallback\tPipeWire'].join('\n'),
    )
    assert.equal(sinkFuerZiel(senken, { art: 'intern' }), 'alsa_output.platform-soc_sound.stereo-fallback')
  })

  it('Deckel: eingefangen, 125 heisst keiner, Unbekanntes faellt weg', () => {
    const k = klangNormalisieren({
      deckel: { intern: 80, '7C:96:D2:89:35:CC': 200, '00:9E:C8:61:1A:EA': 125, quatsch: 50 },
    })
    // 200 wird auf 125 eingefangen — und 125 heisst „kein Deckel", also
    // KEIN Eintrag; nur der echte Deckel bleibt stehen.
    assert.deepEqual(k.deckel, { intern: 80 })
    // Und die Abfrage: ohne Eintrag 125, Überall hat nie einen Deckel.
    assert.equal(deckelFuer(k, { art: 'intern' }), 80)
    assert.equal(deckelFuer(k, { art: 'bluetooth', mac: '7C:96:D2:89:35:CC' }), 125)
    assert.equal(deckelFuer(k, { art: 'bluetooth', mac: '00:9E:C8:61:1A:EA' }), 125)
    assert.equal(deckelFuer(k, { art: 'ueberall' }), 125)
  })

  it('Klang-Probe: nur Ton-Dateien aus dem Klang-Ordner', () => {
    const w = '/home/dietpi/MuPiBox/sysmedia/sound'
    assert.equal(klangDateiErlaubt(w, `${w}/startup.wav`), true)
    assert.equal(klangDateiErlaubt(w, `${w}/eigene.mp3`), true)
    // Der Ausbruchsversuch: normalisiert zeigt er aus dem Ordner heraus.
    assert.equal(klangDateiErlaubt(w, `${w}/../../../../etc/passwd`), false)
    assert.equal(klangDateiErlaubt(w, '/etc/passwd'), false)
    assert.equal(klangDateiErlaubt(w, `${w}/skript.sh`), false)
    assert.equal(klangDateiErlaubt(w, ''), false)
  })

  it('findet den Strom eines benannten Knotens in den sink-inputs', () => {
    const json = JSON.stringify([
      { index: 41, sink: 98, properties: { 'node.name': 'entzerrer.ausgang' } },
      { index: 99, sink: 87, properties: { 'node.name': 'output.ueberall_bluez_output.X.1' } },
    ])
    assert.deepEqual(sinkInputNachKnotenname(json, 'entzerrer.ausgang'), { kennung: 41, sinkNr: 98 })
    assert.equal(sinkInputNachKnotenname(json, 'gibtsnicht'), null)
    assert.equal(sinkInputNachKnotenname('kein json', 'entzerrer.ausgang'), null)
  })
})

describe('istHardwareSenke / regelndeSenkeWaehlen', () => {
  it('erkennt echte Ausgaenge an ihrem Praefix', () => {
    assert.equal(istHardwareSenke('alsa_output.platform-soc_107c000000_sound.stereo-fallback'), true)
    assert.equal(istHardwareSenke('bluez_output.00_9E_C8_61_1A_EA.1'), true)
  })

  it('DIE VIRTUELLEN NICHT — auch die eines Plugins, das der Server nicht kennt', () => {
    // Genau der Fall vom 05.09.2026: mixpi-mitschnitt fiel in die
    // Auffangregel "alles andere ist intern" und wurde in der Verwaltung
    // zum Gesamt-Regler, der bei jedem Zug auf 100 zuruecksprang.
    assert.equal(istHardwareSenke('mixpi-mitschnitt'), false)
    assert.equal(istHardwareSenke('klangwerk'), false)
    assert.equal(istHardwareSenke('entzerrer'), false)
    assert.equal(istHardwareSenke('ueberall'), false)
    // Eine erfundene Plugin-Senke muss ohne Nachpflege durchfallen.
    assert.equal(istHardwareSenke('mixpi-irgendwas-neues'), false)
    assert.equal(istHardwareSenke(''), false)
    assert.equal(istHardwareSenke(null), false)
  })

  it('waehlt Bluetooth VOR der Karte — wie regelnde_senke im Skript', () => {
    const senken = [
      { sinkName: 'mixpi-mitschnitt' },
      { sinkName: 'alsa_output.platform-soc_107c000000_sound.stereo-fallback' },
      { sinkName: 'klangwerk' },
      { sinkName: 'bluez_output.00_9E_C8_61_1A_EA.1' },
    ]
    assert.equal(regelndeSenkeWaehlen(senken)?.sinkName, 'bluez_output.00_9E_C8_61_1A_EA.1')
  })

  it('ohne Kopfhoerer die Karte — und nie eine virtuelle', () => {
    const senken = [
      { sinkName: 'mixpi-mitschnitt' },
      { sinkName: 'ueberall' },
      { sinkName: 'alsa_output.platform-soc_107c000000_sound.stereo-fallback' },
    ]
    assert.equal(regelndeSenkeWaehlen(senken)?.sinkName, 'alsa_output.platform-soc_107c000000_sound.stereo-fallback')
  })

  it('gibt es GAR KEINE Hardware, ist die Antwort null — nicht die erste beste', () => {
    // Lieber kein Regler als einer, der ins Leere stellt.
    assert.equal(regelndeSenkeWaehlen([{ sinkName: 'klangwerk' }, { sinkName: 'mixpi-mitschnitt' }]), null)
    assert.equal(regelndeSenkeWaehlen([]), null)
  })
})
