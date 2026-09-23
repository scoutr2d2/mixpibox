/**
 * Tests für die Konfiguration.
 *
 * Zwei Eigenschaften stehen im Vordergrund, weil ihr Bruch sich erst spät und
 * dann unerklärlich zeigt:
 *   - der TYP eines Wertes bleibt erhalten (Zahlen stehen hier als Text, weil
 *     die Shell-Skripte sie mit `jq -r` lesen),
 *   - eine Konfiguration, die die Box aussperrt oder stumm schaltet, wird
 *     GAR NICHT ERST geschrieben.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { Feld } from './konfiguration.js'
import {
  auswahlFuer,
  BEREICHE,
  FELDER,
  feldNach,
  feldNachAussen,
  holeWert,
  holeWertOderStandard,
  ohneGeheimnisse,
  pruefeAuswahl,
  pruefeEinstellungsPin,
  pruefeFeld,
  pruefeKonfig,
  pruefePasswort,
  pruefeUrl,
  setzeWert,
  unterschiede,
} from './konfiguration.js'
import { ABSTUFUNGEN, istAbstufung } from './medien'

const KONFIG = (): Record<string, unknown> => ({
  mupibox: {
    host: 'MuPiBox',
    startVolume: '40',
    maxVolume: '100',
    theme: 'blue',
    installedThemes: ['blue', 'red', 'green'],
    ttsLanguage: 'de',
    googlettslanguages: ['de', 'en'],
    mediaCheckTimer: '300',
    audioDevice: 'Master',
  },
  interfacelogin: { state: true, password: '$2y$10$abc' },
  timeout: { idlePiShutdown: '0', idleDisplayOff: '10', pressDelay: '2' },
  chromium: { kiosk: true, gpu: false, sccrollanimation: false, cachesize: '128' },
  fan: { fan_active: false, fan_temp_25: '45', fan_temp_50: '55', fan_temp_75: '65', fan_temp_100: '75' },
})

const feld = (id: string) => {
  const f = feldNach(id)
  assert.ok(f, `Feld ${id} fehlt`)
  return f
}

describe('feldNach', () => {
  it('findet die bekannten Felder', () => {
    for (const f of FELDER) assert.equal(feldNach(f.id)?.id, f.id)
  })

  it('weist Unbekanntes und Pfadversuche ab', () => {
    // Ein freier Pfad waere ein Weg, interfacelogin.password zu setzen.
    for (const x of ['interfacelogin.password', 'mupibox/host', '__proto__', 'constructor', '', null, 42])
      assert.equal(feldNach(x), null, String(x))
  })
})

describe('pruefeFeld — der Typ bleibt', () => {
  it('schreibt eine Zahl als TEXT zurück, wenn dort Text stand', () => {
    // Genau hier bricht man sonst die Shell-Skripte: `jq -r .mupibox.startVolume`
    // liefert dann eine Zahl statt einer Zeichenkette.
    const p = pruefeFeld(feld('startLautstaerke'), 75, '40')
    assert.equal(p.ok, true)
    assert.strictEqual(p.wert, '75')
    assert.equal(typeof p.wert, 'string')
  })

  it('schreibt eine Zahl als Zahl zurück, wenn dort eine Zahl stand', () => {
    const p = pruefeFeld(feld('startLautstaerke'), 75, 40)
    assert.strictEqual(p.wert, 75)
  })

  it('nimmt Text-Eingaben für Zahlen an', () => {
    assert.strictEqual(pruefeFeld(feld('startLautstaerke'), '75', '40').wert, '75')
  })

  it('hält die Grenzen ein', () => {
    assert.equal(pruefeFeld(feld('startLautstaerke'), 101, '40').ok, false)
    assert.equal(pruefeFeld(feld('startLautstaerke'), -1, '40').ok, false)
    assert.equal(pruefeFeld(feld('startLautstaerke'), 0, '40').ok, true)
    assert.equal(pruefeFeld(feld('startLautstaerke'), 100, '40').ok, true)
  })

  it('weist Nicht-Zahlen ab', () => {
    for (const x of ['laut', '', null, {}])
      assert.equal(pruefeFeld(feld('startLautstaerke'), x, '40').ok, false, String(x))
  })

  it('behält bei Schaltern die gespeicherte Form', () => {
    assert.strictEqual(pruefeFeld(feld('kioskModus'), false, true).wert, false)
    // Stand dort "1"/"0", bleibt es dabei.
    assert.strictEqual(pruefeFeld(feld('kioskModus'), true, '0').wert, '1')
    assert.strictEqual(pruefeFeld(feld('kioskModus'), false, '1').wert, '0')
  })

  it('verlangt bei Schaltern ja/nein statt Text', () => {
    assert.equal(pruefeFeld(feld('kioskModus'), 'ja', true).ok, false)
    assert.equal(pruefeFeld(feld('kioskModus'), 1, true).ok, false)
  })

  it('prüft Text auf Länge und Steuerzeichen', () => {
    assert.equal(pruefeFeld(feld('name'), 'Kinderzimmer', 'MuPiBox').ok, true)
    assert.equal(pruefeFeld(feld('name'), '', 'MuPiBox').ok, false)
    assert.equal(pruefeFeld(feld('name'), 'a'.repeat(65), 'MuPiBox').ok, false)
    assert.equal(pruefeFeld(feld('name'), 'a\nb', 'MuPiBox').ok, false)
    assert.equal(pruefeFeld(feld('name'), '  getrimmt  ', 'x').wert, 'getrimmt')
  })
})

describe('pruefeAuswahl', () => {
  it('nimmt nur an, was in der Liste steht', () => {
    // DAS FELD IST GEBAUT, nicht aus FELDER geholt — dasselbe Muster wie im
    // Objektlisten-Test darunter: das letzte echte auswahlAus-Feld („thema",
    // die CSS-Themen der alten Oberflaeche) ist mit E118/1d gefallen, die
    // FAEHIGKEIT bleibt und wird weiter geprueft.
    const k = KONFIG()
    const f: Feld = {
      id: 'probe-auswahlliste',
      bereich: 'medien',
      pfad: ['mupibox', 'probeWahl'],
      art: 'auswahl',
      auswahlAus: ['mupibox', 'installedThemes'],
      titel: 'Probe',
      hinweis: 'Nur fuer diesen Test — steht in keiner ausgelieferten Liste.',
    }
    const liste = auswahlFuer(k, f)
    assert.deepEqual(
      liste.map((a) => a.wert),
      ['blue', 'red', 'green'],
    )
    assert.equal(pruefeAuswahl(f, 'red', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'pink', liste).ok, false)
    assert.equal(pruefeAuswahl(f, 42, liste).ok, false)
  })

  it('versteht eine Liste aus OBJEKTEN — sonst bleibt so ein Feld leer', () => {
    // googlettslanguages sieht so aus: { "iso639-1": "de", "Language": "German" }.
    // Nur auf Zeichenketten zu filtern ergaebe eine leere Auswahl, und jeder
    // Wert wuerde abgelehnt — am gerenderten Formular aufgefallen.
    //
    // DAS FELD IST HIER GEBAUT, nicht aus FELDER geholt: seit dem 04.08.2026
    // benutzt kein ausgeliefertes Feld mehr `wertSchluessel` — „Sprache beim
    // Vorlesen" ist mit der Google-Abloesung entfallen. Die FAEHIGKEIT bleibt
    // aber noetig (Objektlisten stehen weiter in der Konfiguration jeder Box),
    // also wird sie weiter geprueft. Ein Test, der an einem echten Feld haengt,
    // stirbt mit ihm — und nimmt die Regel mit ins Grab.
    const k = KONFIG()
    ;(k['mupibox'] as Record<string, unknown>)['googlettslanguages'] = [
      { 'iso639-1': 'de', Language: 'German' },
      { 'iso639-1': 'en', Language: 'English' },
      { kaputt: true },
    ]
    const f: Feld = {
      id: 'probe-objektliste',
      bereich: 'medien',
      pfad: ['mupibox', 'ttsLanguage'],
      art: 'auswahl',
      auswahlAus: ['mupibox', 'googlettslanguages'],
      wertSchluessel: 'iso639-1',
      titelSchluessel: 'Language',
      titel: 'Probe',
      hinweis: 'Nur fuer diesen Test — steht in keiner ausgelieferten Liste.',
    }
    const liste = auswahlFuer(k, f)
    assert.deepEqual(liste, [
      { wert: 'de', titel: 'German' },
      { wert: 'en', titel: 'English' },
    ])
    assert.equal(pruefeAuswahl(f, 'de', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'German', liste).ok, false, 'gespeichert wird der Code')
    assert.equal(pruefeAuswahl(f, 'xx', liste).ok, false)
  })

  it('gibt eine leere Liste zurück, wenn es keine gibt', () => {
    assert.deepEqual(auswahlFuer(KONFIG(), feld('name')), [])
    // Eine Konfiguration OHNE die Quell-Liste: leere Auswahl, kein Wurf.
    const f: Feld = {
      id: 'probe-ohne-quelle',
      bereich: 'medien',
      pfad: ['mupibox', 'probeWahl'],
      art: 'auswahl',
      auswahlAus: ['mupibox', 'installedThemes'],
      titel: 'Probe',
      hinweis: 'Nur fuer diesen Test.',
    }
    assert.deepEqual(auswahlFuer({}, f), [])
  })
})

describe('setzeWert', () => {
  it('lässt die Vorlage unangetastet', () => {
    // Ein Fehlschlag auf halbem Weg darf nichts hinterlassen.
    const k = KONFIG()
    const n = setzeWert(k, feld('startLautstaerke'), '75')
    assert.equal(holeWert(k, feld('startLautstaerke')), '40', 'Original unverändert')
    assert.equal(holeWert(n, feld('startLautstaerke')), '75')
  })

  it('lässt die übrigen Felder der Gruppe stehen', () => {
    const n = setzeWert(KONFIG(), feld('startLautstaerke'), '75')
    assert.equal(holeWert(n, feld('maxLautstaerke')), '100')
    assert.equal((n['mupibox'] as Record<string, unknown>)['audioDevice'], 'Master')
  })
})

describe('pruefeKonfig — die Box muss danach noch laufen', () => {
  it('nimmt eine gesunde Konfiguration an', () => {
    assert.equal(pruefeKonfig(KONFIG()).ok, true)
  })

  it('VERWEIGERT Anmeldung an ohne Passwort — das wäre die Aussperrung', () => {
    const k = KONFIG()
    ;(k['interfacelogin'] as Record<string, unknown>)['password'] = ''
    const p = pruefeKonfig(k)
    assert.equal(p.ok, false)
    assert.match(p.grund ?? '', /niemand käme mehr herein/)
  })

  it('erlaubt fehlendes Passwort, solange die Anmeldung AUS ist', () => {
    const k = KONFIG()
    ;(k['interfacelogin'] as Record<string, unknown>)['state'] = false
    ;(k['interfacelogin'] as Record<string, unknown>)['password'] = ''
    assert.equal(pruefeKonfig(k).ok, true)
  })

  it('VERWEIGERT Sperre auf „pin" ohne gesetzte PIN — die Box käme nirgends mehr hinein', () => {
    // Die Prüfung vergliche gegen einen leeren Hash und sagte zu jeder Eingabe
    // nein. Am Bildschirm bliebe nur „Abbrechen" — auch für das WLAN, über das
    // man die Verwaltung erreichen müsste, um es wieder aufzuschließen.
    const k = KONFIG()
    ;(k['mupibox'] as Record<string, unknown>)['einstellungssperre'] = 'pin'
    const p = pruefeKonfig(k)
    assert.equal(p.ok, false)
    assert.match(p.grund ?? '', /keine PIN gesetzt/)
  })

  it('erlaubt „pin", sobald eine PIN da ist', () => {
    const k = KONFIG()
    ;(k['mupibox'] as Record<string, unknown>)['einstellungssperre'] = 'pin'
    ;(k['mupibox'] as Record<string, unknown>)['einstellungsPin'] = '$2b$10$abcdefghijklmnopqrstuv'
    assert.equal(pruefeKonfig(k).ok, true)
  })

  it('lässt „aus" und „rechnen" ohne PIN durch — sie brauchen keine', () => {
    for (const modus of ['aus', 'rechnen', undefined]) {
      const k = KONFIG()
      ;(k['mupibox'] as Record<string, unknown>)['einstellungssperre'] = modus
      assert.equal(pruefeKonfig(k).ok, true, `Modus ${modus}`)
    }
  })

  it('VERWEIGERT eine Konfiguration ohne Tonausgabe', () => {
    const k = KONFIG()
    ;(k['mupibox'] as Record<string, unknown>)['audioDevice'] = ''
    assert.match(pruefeKonfig(k).grund ?? '', /keinen Ton/)
  })

  it('VERWEIGERT eine Startlautstärke über der Höchstlautstärke', () => {
    const k = KONFIG()
    ;(k['mupibox'] as Record<string, unknown>)['startVolume'] = '90'
    ;(k['mupibox'] as Record<string, unknown>)['maxVolume'] = '50'
    assert.match(pruefeKonfig(k).grund ?? '', /Höchstlautstärke/)
  })

  it('VERWEIGERT Lüfterstufen, die nicht ansteigen', () => {
    // Stünde 50 % über 75 %, liefe der Lüfter bei mittlerer Waerme voll und
    // bei hoher gar nicht — die Regelung stuende auf dem Kopf.
    const k = KONFIG()
    ;(k['fan'] as Record<string, unknown>)['fan_temp_75'] = '50'
    const p = pruefeKonfig(k)
    assert.equal(p.ok, false)
    assert.match(p.grund ?? '', /ansteigen/)
  })

  it('VERWEIGERT zwei gleiche Lüfterstufen', () => {
    const k = KONFIG()
    ;(k['fan'] as Record<string, unknown>)['fan_temp_50'] = '45'
    assert.equal(pruefeKonfig(k).ok, false)
  })

  it('stört sich nicht an fehlenden Lüfterangaben', () => {
    const k = KONFIG()
    delete k['fan']
    assert.equal(pruefeKonfig(k).ok, true)
  })

  it('VERWEIGERT eine Konfiguration ohne die tragenden Gruppen', () => {
    for (const weg of ['interfacelogin', 'mupibox']) {
      const k = KONFIG()
      delete k[weg]
      assert.equal(pruefeKonfig(k).ok, false, weg)
    }
  })

  it('verträgt Unsinn statt zu werfen', () => {
    for (const x of [null, undefined, 'text', 42, []]) assert.equal(pruefeKonfig(x).ok, false, String(x))
  })
})

describe('unterschiede', () => {
  it('nennt nur, was sich wirklich ändert', () => {
    const alt = KONFIG()
    const neu = setzeWert(alt, feld('startLautstaerke'), '75')
    const u = unterschiede(alt, neu)
    assert.equal(u.length, 1)
    assert.equal(u[0].id, 'startLautstaerke')
    assert.equal(u[0].vorher, '40')
    assert.equal(u[0].nachher, '75')
  })

  it('merkt an, was einen Neustart braucht', () => {
    const alt = KONFIG()
    const neu = setzeWert(alt, feld('kioskModus'), false)
    assert.equal(unterschiede(alt, neu)[0].neustart, true)
  })

  it('meldet nichts, wenn nichts anders ist', () => {
    assert.deepEqual(unterschiede(KONFIG(), KONFIG()), [])
  })
})

describe('pruefePasswort', () => {
  it('nimmt ein brauchbares Passwort an', () => {
    assert.equal(pruefePasswort('geheim1').ok, true)
  })

  it('weist zu kurze ab', () => {
    assert.equal(pruefePasswort('kurz').ok, false)
    assert.match(pruefePasswort('kurz').grund ?? '', /mindestens/)
  })

  it('verrät das Passwort nicht im Grund', () => {
    assert.equal((pruefePasswort('kurz').grund ?? '').includes('kurz'), false)
  })

  it('weist Steuerzeichen und Nicht-Text ab', () => {
    assert.equal(pruefePasswort('mit\nUmbruch').ok, false)
    for (const x of [null, undefined, 42, {}]) assert.equal(pruefePasswort(x).ok, false, String(x))
  })

  it('weist übermäßig lange ab', () => {
    assert.equal(pruefePasswort('a'.repeat(201)).ok, false)
  })
})

describe('Sperre vor den Einstellungen', () => {
  it('bietet genau die vier Stufen an — und Aus ist keine davon zu viel', () => {
    const f = feldNach('einstellungssperre')
    assert.ok(f)
    const liste = auswahlFuer({}, f)
    // SEIT DEM 06.08.2026 VIER, nicht drei: „geste" ist der zweite waehlbare
    // Weg aus E31/P1 („Geste UND Zahlenfolge, waehlbar. Beide Wege bauen,
    // einer davon aktiv."). Die REIHENFOLGE wird mitgeprueft, weil sie am
    // Bildschirm die Reihenfolge der Auswahl ist — und weil „aus" oben stehen
    // muss, damit niemand es aus Versehen ueberspringt.
    assert.deepEqual(
      liste.map((a) => a.wert),
      ['aus', 'rechnen', 'pin', 'geste'],
    )
    assert.equal(pruefeAuswahl(f, 'pin', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'geste', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'passwort', liste).ok, false)
  })

  /**
   * DIE GESTE BRAUCHT KEINE EINRICHTUNG — und deshalb keine zweite Wache.
   *
   * `pruefeKonfig` verweigert „pin", solange keine PIN gesetzt ist (weiter
   * unten begruendet: sonst laege ausgerechnet das WLAN hinter einer Sperre,
   * die auf jede Eingabe nein sagt). Bei „geste" gibt es nichts zu setzen; die
   * Beschreibung steht im `hinweis` und ist auf jeder Box dieselbe. Wuerde
   * hier trotzdem etwas verlangt, waere „geste" auf einer frischen Box
   * unwaehlbar — und das faellt nur auf, wenn es jemand versucht.
   */
  it('laesst „geste" ohne jede Einrichtung speichern', () => {
    const k = KONFIG()
    const m = k['mupibox'] as Record<string, unknown>
    m['einstellungssperre'] = 'geste'
    m['einstellungsPin'] = ''
    assert.equal(pruefeKonfig(k).ok, true)
  })

  /**
   * WAS DER `hinweis` LEISTEN MUSS: Der Bildschirm der Box sagt „Mit einer
   * Geste gesperrt" und verweist auf die Verwaltung — er sagt NICHT, welche
   * Geste. Damit ist dieser Text die einzige Stelle, an der ein zweiter
   * Elternteil sie erfaehrt. Steht sie hier nicht vollstaendig, ist die Sorte
   * „geste" eine Aussperrung mit Ansage.
   *
   * GEPRUEFT WIRD DER INHALT, NICHT DIE LAENGE: Reihenfolge und Zeitgrenze
   * sind die beiden Teile, die man nicht erraten kann.
   */
  it('erklaert die Geste im Hinweis vollstaendig — sie steht sonst nirgends', () => {
    const f = feldNach('einstellungssperre')
    assert.ok(f)
    const h = f.hinweis ?? ''
    assert.ok(h.includes('Uhrzeigersinn'), 'die Richtung fehlt')
    assert.ok(h.includes('links oben'), 'der Anfangspunkt fehlt')
    assert.ok(h.includes('vier Sekunden'), 'die Zeitgrenze fehlt')
    // UND DIE EINSCHRAENKUNG. `alsModus` in der klassischen Oberflaeche kennt
    // „geste" nicht und bildet sie auf „aus" ab — auf einer Box mit
    // `oberflaeche: klassisch` waere diese Wahl gar keine Sperre, waehrend das
    // Feld „Geste" anzeigt. Solange das so ist, muss es dastehen.
    assert.ok(h.includes('neuen Oberfläche'), 'die Einschraenkung auf die neue Oberflaeche fehlt')
    const f2 = feldNach('einstellungssperre')
    const geste = (f2?.festeAuswahl ?? []).find((a) => a.wert === 'geste')
    assert.ok(geste?.titel.includes('neue Oberfläche'), 'der Auswahleintrag sagt es nicht')
  })

  it('schreibt nach mupibox.einstellungssperre — dorthin, wo die Box liest', () => {
    const f = feldNach('einstellungssperre')
    assert.ok(f)
    assert.deepEqual(f.pfad, ['mupibox', 'einstellungssperre'])
    const n = setzeWert(KONFIG(), f, 'rechnen') as Record<string, Record<string, unknown>>
    assert.equal(n.mupibox.einstellungssperre, 'rechnen')
    assert.equal(n.mupibox.audioDevice, 'Master', 'der Rest der Gruppe bleibt stehen')
  })

  it('nennt im Hinweis, WAS dahinter liegt', () => {
    // Der Kachel „Einstellungen" sieht man nicht an, dass von dort aus WLAN,
    // die Löschknöpfe der Mediendatenbank und das Ausschalten erreichbar sind.
    // Wer das nicht weiß, lässt die Sperre aus Versehen aus.
    const f = feldNach('einstellungssperre')
    assert.ok(f)
    assert.match(f.hinweis, /WLAN/)
    assert.match(f.hinweis, /Löschknöpfe/)
  })

  it('gilt als AUS, solange nichts in der Konfiguration steht', () => {
    // Die Vorgabe ist bewusst „aus": eine Bestandsbox darf nach einem Update
    // nicht plötzlich nach einer PIN fragen, die ihr Besitzer nie gesetzt hat.
    const f = feldNach('einstellungssperre')
    assert.ok(f)
    assert.equal(holeWert(KONFIG(), f), undefined)
  })
})

describe('pruefeEinstellungsPin', () => {
  it('nimmt vier bis acht Ziffern an', () => {
    assert.equal(pruefeEinstellungsPin('1234').wert, '1234')
    assert.equal(pruefeEinstellungsPin('12345678').ok, true)
  })

  it('weist zu kurze und zu lange ab', () => {
    assert.equal(pruefeEinstellungsPin('123').ok, false)
    assert.equal(pruefeEinstellungsPin('123456789').ok, false)
  })

  it('nimmt NUR Ziffern — alles andere wäre auf der Box nicht eingebbar', () => {
    // Am Bildschirm der Box gibt es keine Systemtastatur, nur das eigene
    // Ziffernfeld des Sperrdialogs. Eine PIN mit Buchstaben ließe sich setzen,
    // aber nie wieder eingeben.
    for (const x of ['12a4', 'abcd', '12 34', '1234\n', '１２３４']) assert.equal(pruefeEinstellungsPin(x).ok, false, x)
  })

  it('nimmt leer als LÖSCHEN an', () => {
    assert.deepEqual(pruefeEinstellungsPin(''), { ok: true, wert: '' })
  })

  it('verrät die PIN nicht im Grund', () => {
    assert.equal((pruefeEinstellungsPin('123').grund ?? '').includes('123'), false)
  })

  it('weist Nicht-Text ab', () => {
    for (const x of [null, undefined, 1234, {}]) assert.equal(pruefeEinstellungsPin(x).ok, false, String(x))
  })
})

describe('Geheimnisse verlassen den Server nicht', () => {
  const mit = () => ({
    interfacelogin: { state: true, password: '$2y$10$geheim' },
    spotify: { clientId: 'oeffentlich', refreshToken: 'SEHR-GEHEIM', accessToken: 'AUCH' },
    jellyfin: { server: 'https://jf.local:8096', apiKey: 'SCHLUESSEL' },
    telegram: { token: 'BOT-TOKEN' },
    mupibox: { host: 'MuPiBox', einstellungssperre: 'pin', einstellungsPin: '$2y$10$PIN-HASH' },
    spotifyCacheLevel: 'medium',
  })

  it('feldNachAussen meldet bei einem Geheimnis nur OB es gesetzt ist', () => {
    const f = feldNach('jellyfinSchluessel')
    assert.ok(f)
    const raus = feldNachAussen(mit(), f)
    assert.deepEqual(raus, { gesetzt: true })
    assert.equal('wert' in raus, false, 'der Wert darf gar nicht erst auftauchen')
  })

  it('feldNachAussen meldet ein leeres Geheimnis als nicht gesetzt', () => {
    const f = feldNach('jellyfinSchluessel')
    assert.ok(f)
    const k = mit()
    ;(k.jellyfin as Record<string, unknown>)['apiKey'] = ''
    assert.deepEqual(feldNachAussen(k, f), { gesetzt: false })
  })

  it('feldNachAussen gibt gewöhnliche Felder normal heraus', () => {
    const f = feldNach('spotifyClientId')
    assert.ok(f)
    assert.deepEqual(feldNachAussen(mit(), f), { wert: 'oeffentlich' })
  })

  it('ohneGeheimnisse streicht Hash, Token und Schlüssel', () => {
    // /api/config liefert die GANZE Datei aus; ohne diesen Filter stünden
    // Passwort-Hash und Jellyfin-Schluessel im Browser.
    const raus = ohneGeheimnisse(mit()) as Record<string, Record<string, unknown>>
    assert.equal(raus['interfacelogin']['password'], '')
    assert.equal(raus['spotify']['refreshToken'], '')
    assert.equal(raus['spotify']['accessToken'], '')
    assert.equal(raus['jellyfin']['apiKey'], '')
    assert.equal(raus['telegram']['token'], '')
  })

  it('ohneGeheimnisse streicht auch die Soloist-Schlüssel — flach UND in der Strom-Liste', () => {
    // Die spak_-Schluessel sind volle Wiedergabe-Zugaenge zum Konto. Der
    // flache lag in der Gruppe (und fehlte in der Streichliste), die je-Strom-
    // Schluessel liegen in einer LISTE, die die flache Schleife nie erreicht —
    // beide gingen bis 22.08.2026 im Klartext an jeden Kiosk-Browser.
    const k = mit() as unknown as Record<string, Record<string, unknown>>
    k['spotify']['soloistApiKey'] = 'spak_geheim'
    k['spotify']['soloistApiKeyMitschnitt'] = 'spak_zweitzugang'
    k['spotify']['stroeme'] = [
      { nr: 1, zweck: 'wiedergabe', maschine: 'soloist', schluessel: 'spak_strom1', senke: '' },
      { nr: 2, zweck: 'mitschnitt', maschine: 'soloist', schluessel: 'spak_strom2', senke: '' },
    ]
    const raus = ohneGeheimnisse(k) as Record<string, Record<string, unknown>>
    assert.equal(raus['spotify']['soloistApiKey'], '')
    assert.equal(raus['spotify']['soloistApiKeyMitschnitt'], '', 'der Zweitzugang des Mitschnitts')
    const stroeme = raus['spotify']['stroeme'] as Record<string, unknown>[]
    assert.equal(stroeme.length, 2, 'die Listenform bleibt')
    for (const s of stroeme) assert.equal(s.schluessel, '')
    assert.equal(stroeme[0].zweck, 'wiedergabe', 'nur der Schluessel wird geleert')
  })

  it('ohneGeheimnisse streicht die PIN vor den Einstellungen', () => {
    // Sie liegt in `mupibox` — der Gruppe, die das Box-Frontend ohnehin
    // ausliest. Ohne diesen Strich stuende der Hash in jedem Kiosk-Browser,
    // und vier Ziffern sind aus einem Hash in Sekunden zurueckgerechnet.
    const raus = ohneGeheimnisse(mit()) as Record<string, Record<string, unknown>>
    assert.equal(raus['mupibox']['einstellungsPin'], '')
  })

  it('ohneGeheimnisse lässt alles andere unangetastet', () => {
    const raus = ohneGeheimnisse(mit()) as Record<string, unknown>
    assert.equal((raus['spotify'] as Record<string, unknown>)['clientId'], 'oeffentlich')
    assert.equal((raus['jellyfin'] as Record<string, unknown>)['server'], 'https://jf.local:8096')
    // Genau dieses Feld ist der einzige Grund, warum /api/config existiert.
    assert.equal(raus['spotifyCacheLevel'], 'medium')
    // Welche Sperre gilt, MUSS herauskommen — das Frontend entscheidet daran,
    // ob es ueberhaupt fragt. Nur das Geheimnis bleibt drin.
    assert.equal((raus['mupibox'] as Record<string, unknown>)['einstellungssperre'], 'pin')
    assert.equal((raus['mupibox'] as Record<string, unknown>)['host'], 'MuPiBox')
  })

  it('ohneGeheimnisse verändert die Vorlage nicht', () => {
    const k = mit()
    ohneGeheimnisse(k)
    assert.equal(k.interfacelogin.password, '$2y$10$geheim')
  })

  it('ohneGeheimnisse verträgt Unsinn', () => {
    for (const x of [null, undefined, 'text', 42, []]) assert.equal(ohneGeheimnisse(x), x)
  })
})

describe('pruefeUrl', () => {
  it('nimmt vollständige Adressen an', () => {
    assert.equal(pruefeUrl('https://jellyfin.local:8096').wert, 'https://jellyfin.local:8096')
    assert.equal(pruefeUrl('http://192.168.178.9:8096').ok, true)
  })

  it('schneidet den abschließenden Schrägstrich ab', () => {
    // Sonst entsteht beim Anhaengen ein doppelter, und manche Server melden 404.
    assert.equal(pruefeUrl('https://jf.local:8096///').wert, 'https://jf.local:8096')
  })

  it('erlaubt leer als „nicht eingerichtet"', () => {
    assert.deepEqual(pruefeUrl('  '), { ok: true, wert: '' })
  })

  it('weist alles ab, was keine Web-Adresse ist', () => {
    for (const x of ['jellyfin.local', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x', 42])
      assert.equal(pruefeUrl(x).ok, false, String(x))
  })
})

describe('Wiedergabe-Maschine', () => {
  it('bietet genau die zwei Maschinen an, die es gibt', () => {
    // Ein dritter Wert waere eine stumme Box: spotify-control kennt nur diese
    // beiden und faellt bei allem anderen auf mplayer zurueck.
    const f = feldNach('wiedergabeMaschine')
    assert.ok(f)
    const liste = auswahlFuer({}, f)
    assert.deepEqual(
      liste.map((a) => a.wert),
      ['mplayer', 'mpv'],
    )
    assert.equal(pruefeAuswahl(f, 'mpv', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'mplayer', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'vlc', liste).ok, false)
  })

  it('schreibt nach mupibox.playerEngine — genau dorthin, wo der Player liest', () => {
    const f = feldNach('wiedergabeMaschine')
    assert.ok(f)
    assert.deepEqual(f.pfad, ['mupibox', 'playerEngine'])
    const k: Record<string, unknown> = { mupibox: { host: 'x', maxVolume: '70' } }
    const n = setzeWert(k, f, 'mpv') as Record<string, Record<string, unknown>>
    assert.equal(n.mupibox.playerEngine, 'mpv')
    assert.equal(n.mupibox.maxVolume, '70', 'die Zeichenketten-Zahl bleibt unangetastet')
    assert.equal((k.mupibox as Record<string, unknown>).playerEngine, undefined, 'Vorlage unberührt')
  })

  it('nennt im Hinweis beide Bedingungen — Installation UND Neustart', () => {
    // Beides ist unsichtbar: ohne mpv startet der Dienst nicht, und ohne
    // Neustart aendert sich gar nichts. Wer nur eines erfaehrt, sucht falsch.
    const f = feldNach('wiedergabeMaschine')
    assert.ok(f)
    assert.match(f.hinweis, /apt install mpv/)
    assert.match(f.hinweis, /Neustart/)
  })
})

describe('Kiosk-Browser', () => {
  it('bietet genau die zwei an, die das Kioskskript kennt', () => {
    // chromium-autostart.sh liest `.mupibox.kioskBrowser // "chromium"` und
    // vergleicht gegen "cog". Ein dritter Wert waere stumm Chromium — die
    // Einstellung zeigte dann etwas an, das nirgends ankommt.
    const f = feldNach('kioskBrowser')
    assert.ok(f)
    const liste = auswahlFuer({}, f)
    assert.deepEqual(
      liste.map((a) => a.wert),
      ['chromium', 'cog'],
    )
    assert.equal(pruefeAuswahl(f, 'cog', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'chromium', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'firefox', liste).ok, false)
  })

  it('schreibt nach mupibox.kioskBrowser — genau dorthin, wo das Kioskskript liest', () => {
    const f = feldNach('kioskBrowser')
    assert.ok(f)
    assert.deepEqual(f.pfad, ['mupibox', 'kioskBrowser'])
    const k: Record<string, unknown> = { mupibox: { oberflaeche: 'neu', maxVolume: '70' } }
    const n = setzeWert(k, f, 'cog') as Record<string, Record<string, unknown>>
    assert.equal(n.mupibox.kioskBrowser, 'cog')
    assert.equal(n.mupibox.oberflaeche, 'neu', 'die Oberflaechen-Wahl bleibt unangetastet')
  })

  it('steht ohne Schluessel auf chromium — dem Weg, der ueberall laeuft', () => {
    // Dieselbe Vorgabe wie im Skript (jq '// "chromium"'). Eine Box, die ihre
    // Konfiguration nicht lesen kann, darf nicht im schlanken Versuch landen.
    const f = feldNach('kioskBrowser')
    assert.ok(f)
    assert.equal(f.standard, 'chromium')
  })

  it('nennt im Hinweis den Preis und nicht nur den Gewinn', () => {
    // 180 MB sind das Argument, WebKit ist die Bedingung. Wer nur die Zahl
    // liest, stellt um und sucht den Fehler danach in der Oberflaeche.
    const f = feldNach('kioskBrowser')
    assert.ok(f)
    assert.match(f.hinweis, /WebKit/)
    assert.match(f.hinweis, /Chromium/, 'der Rueckfall gehoert in den Hinweis')
    assert.match(f.hinweis, /Neustart/)
  })
})

describe('Pfade mit einem Segment', () => {
  it('liest und schreibt auf oberster Ebene', () => {
    // spotifyCacheLevel liegt dort, weil das Box-Frontend es so liest.
    const f = feldNach('spotifyCacheStufe')
    assert.ok(f)
    assert.equal(f.pfad.length, 1)
    const k: Record<string, unknown> = { spotifyCacheLevel: 'medium', mupibox: { host: 'x' } }
    assert.equal(holeWert(k, f), 'medium')
    const n = setzeWert(k, f, 'max')
    assert.equal(n['spotifyCacheLevel'], 'max')
    assert.equal(k['spotifyCacheLevel'], 'medium', 'Vorlage unberührt')
    assert.deepEqual(n['mupibox'], { host: 'x' }, 'der Rest bleibt stehen')
  })

  it('bietet die festen Stufen an, ohne sie aus der Konfiguration zu holen', () => {
    const f = feldNach('spotifyCacheStufe')
    assert.ok(f)
    const liste = auswahlFuer({}, f)
    assert.deepEqual(
      liste.map((a) => a.wert),
      ['off', 'medium', 'max'],
    )
    assert.equal(pruefeAuswahl(f, 'max', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'riesig', liste).ok, false)
  })
})

/**
 * DIE GLIEDERUNG (G5, 2026-08-03).
 *
 * Warum das getestet wird, obwohl es „nur" eine Sortierung ist: die Verwaltung
 * baut DREI Seiten aus dieser einen Tabelle (Konfiguration, Darstellung,
 * Streaming-Dienste). Ein Feld mit unbekanntem oder vergessenem Bereich
 * erscheint auf KEINER davon — kein Fehler, keine Meldung, es ist einfach weg.
 * Dieselbe Falle wie in darstellung.service.ts, wo ein Schalter ohne Eintrag
 * in pruefen() still herausfaellt.
 */
describe('Bereiche — jedes Feld hat einen Ort', () => {
  it('gibt jedem Feld einen Bereich, den es wirklich gibt', () => {
    const bekannt = new Set(BEREICHE.map((b) => b.id))
    for (const f of FELDER) {
      assert.ok(f.bereich, `Feld ${f.id} ohne Bereich`)
      assert.ok(bekannt.has(f.bereich), `Feld ${f.id} nennt unbekannten Bereich ${f.bereich}`)
    }
  })

  it('laesst keinen Bereich leer stehen — sonst steht eine Ueberschrift ohne Inhalt', () => {
    for (const b of BEREICHE) {
      assert.ok(
        FELDER.some((f) => f.bereich === b.id),
        `Bereich ${b.id} hat kein einziges Feld`,
      )
    }
  })

  it('weist jeden Bereich genau EINER Seite zu', () => {
    for (const b of BEREICHE) {
      assert.ok(
        ['konfiguration', 'darstellung', 'streaming', 'ton'].includes(b.seite),
        `Bereich ${b.id} zeigt auf die unbekannte Seite ${b.seite}`,
      )
    }
    // Die Konfigurationsseite darf nicht leer werden: sie ist der Ort, an dem
    // man sucht, wenn man nicht weiss, wo etwas steht.
    assert.ok(BEREICHE.filter((b) => b.seite === 'konfiguration').length >= 3)
    // Und der Ton-Bereich wohnt seit dem 15.08.2026 auf der Ton-Seite —
    // faellt er auf 'konfiguration' zurueck, wandern seine Felder dorthin
    // zurueck und die Grundeinstellungen-Karte der Ton-Seite steht leer da.
    assert.equal(BEREICHE.find((b) => b.id === 'ton')?.seite, 'ton')
  })

  it('sortiert nach der Leitfrage, nicht nach der Datei', () => {
    // Der Kiosk-Browser liegt unter `mupibox` in derselben Datei wie „Name
    // der Box" — die Leitfrage trennt sie trotzdem: das eine sieht man, das
    // andere ist die Box. (Bis E118/1d standen hier thema und oberflaeche;
    // beide Felder sind mit der einen Oberflaeche gefallen.)
    assert.equal(feld('kioskBrowser').bereich, 'darstellung')
    assert.equal(feld('name').bereich, 'box')
    // Spotify und Jellyfin sind Quellen, keine Eigenschaften der Box.
    assert.equal(feld('spotifyClientId').bereich, 'streaming')
    assert.equal(feld('jellyfinServer').bereich, 'streaming')
  })

  /**
   * DIE DARSTELLUNGSSEITE ZEICHNET NUR ZWEI ARTEN — Schalter und Auswahl.
   *
   * Sie hat keine Speichern-Leiste und keine Texteingaben: dort steht die
   * Vorschau daneben, jeder Klick wirkt sofort. Ein Feld der Art 'text',
   * 'zahl', 'url' oder 'geheim' im Bereich 'darstellung' waere deshalb
   * NIRGENDS zu bedienen — die Konfigurationsseite zeigt diesen Bereich
   * absichtlich nicht, und die Anbieterseite kennt nur Streaming-Felder.
   * Es faellt genau so still heraus wie ein Feld ohne Bereich; deshalb hier
   * dieselbe Sorte Waechter.
   */
  it('gibt der Darstellungsseite nur Felder, die sie auch zeichnen kann', () => {
    for (const f of FELDER.filter((x) => x.bereich === 'darstellung')) {
      assert.ok(
        f.art === 'schalter' || f.art === 'auswahl',
        `Feld ${f.id} ist auf der Darstellungsseite nicht bedienbar (Art ${f.art})`,
      )
    }
  })
})

/**
 * DER TEURESTE FEHLER DIESES UMBAUS — und der einzige, der GAR NICHT auffällt.
 *
 * Die Umsortierung vom 03.08.2026 (G5) hat sechs Felder auf eine andere SEITE
 * geschoben. Sie ist deshalb gefahrlos, weil kein einziges Feld dabei seinen
 * SPEICHERORT gewechselt hat — jede Box findet ihren Wert genau dort wieder,
 * wo sie ihn hingeschrieben hat.
 *
 * DAS STAND BIS HIERHER NUR IN KOMMENTAREN. Ein Kommentar hält niemanden auf:
 * wer beim nächsten Aufräumen `thema` nach `darstellung.theme` legt, weil das
 * Feld ja auf der Darstellungsseite steht, hat auf JEDER laufenden Box das
 * eingestellte Farbthema stillgelegt — die Box liest weiter `mupibox.theme`,
 * das Board schreibt woandershin, und beide behaupten etwas anderes. Es gibt
 * keine Meldung, keinen Fehler, nur eine Box, die plötzlich wieder blau ist.
 *
 * Deshalb sind die Pfade hier festgenagelt. Wer einen ändert, ändert damit
 * bewusst das Dateiformat und muss update/conf_update.sh mitbringen.
 */
describe('Der Umzug hat den SPEICHERORT nicht angefasst', () => {
  const ORTE: [string, string[]][] = [
    // (thema und oberflaeche standen hier bis E118/1d — die Felder sind mit
    // der einen Oberflaeche gefallen, ihre Schluessel in Bestandsdateien
    // bleiben liegen.)
    ['kioskModus', ['chromium', 'kiosk']],
    ['bildlauf', ['chromium', 'sccrollanimation']],
    // Auf die Seite „Streaming-Dienste" gewandert — Datei unverändert.
    ['spotifyClientId', ['spotify', 'clientId']],
    ['spotifyZwischenspeicher', ['spotify', 'cachestate']],
    ['spotifyPlaylistSuche', ['spotify', 'disableScraperForPlaylists']],
    ['jellyfinServer', ['jellyfin', 'server']],
    ['jellyfinSchluessel', ['jellyfin', 'apiKey']],
    // ABSICHTLICH auf oberster Ebene: media-cache.service.ts der Box liest
    // `spotifyCacheLevel` direkt aus /api/config.
    ['spotifyCacheStufe', ['spotifyCacheLevel']],
  ]

  for (const [id, pfad] of ORTE) {
    it(`${id} liegt weiterhin unter ${pfad.join('.')}`, () => {
      assert.deepEqual(feld(id).pfad, pfad)
    })
  }

  /**
   * Und die Gegenprobe, die zeigt, worum es geht: eine Box, die den Wert
   * SCHON GESETZT hat, bekommt ihn nach dem Umbau unverändert zu sehen — der
   * Vorgabewert darf ihn nicht überdecken.
   */
  it('zeigt einer Box, die schon gewählt hat, weiterhin IHREN Wert', () => {
    const box = {
      mupibox: { theme: 'matrix', oberflaeche: 'neu' },
      spotify: { clientId: 'abc123', disableScraperForPlaylists: true },
      jellyfin: { server: 'http://haus:8096', apiKey: 'geheim' },
      spotifyCacheLevel: 'max',
    }
    assert.equal(feldNachAussen(box, feld('spotifyClientId')).wert, 'abc123')
    assert.equal(feldNachAussen(box, feld('spotifyPlaylistSuche')).wert, true)
    assert.equal(feldNachAussen(box, feld('jellyfinServer')).wert, 'http://haus:8096')
    assert.equal(feldNachAussen(box, feld('spotifyCacheStufe')).wert, 'max')
    // Beim Geheimnis geht nur „hinterlegt" hinaus — aber eben `true`.
    assert.equal(feldNachAussen(box, feld('jellyfinSchluessel')).gesetzt, true)
  })
})

/**
 * DIE DREI FELDER, DIE INS LEERE ZEIGTEN (gemessen 03.08.2026 an der Pi 5).
 *
 * Sie sind NICHT falsch benannt — ihre Pfade stehen genau so in
 * config/templates/mupiboxconfig.json. Die Konfiguration DIESER Box ist nur
 * aelter als sie. Ohne Vorgabewert zeigte die Oberflaeche dann den ersten
 * Auswahleintrag an, ohne dass dieser Wert irgendwo stuende.
 */
describe('Fehlende Schluessel haben eine bestimmte Antwort', () => {
  it('zeigt fuer die drei Felder den Vorgabewert statt undefined', () => {
    const leer = {}
    // SEIT DEM 06.08.2026 „rechnen" UND NICHT MEHR „aus". Der Vorgabewert ist
    // hier die ANZEIGE des Boards, und er muss zu dem passen, was die Box bei
    // fehlendem Schluessel wirklich tut — NewDesign/app.js `sperrModus` gibt
    // dafuer seit derselben Aenderung „rechnen" zurueck. Stuende hier weiter
    // „aus", behauptete das Board „jeder kommt hinein" ueber eine Box, die
    // nachfragt.
    assert.equal(feldNachAussen(leer, feld('einstellungssperre')).wert, 'rechnen')
    assert.equal(feldNachAussen(leer, feld('spotifyPlaylistSuche')).wert, false)
    assert.equal(feldNachAussen(leer, feld('jellyfinSchluessel')).gesetzt, false)
  })

  // HIER STAND „nennt fuer die Oberflaechen-Wahl dasselbe wie
  // chromium-autostart.sh": das Feld und der jq-Rueckfall auf "klassisch"
  // sind mit E118/1d gefallen — der Kiosk laedt fest /neu/, das Skript
  // liest den Schluessel nicht mehr.

  it('unterscheidet weiterhin „fehlt" von „steht auf dem Vorgabewert"', () => {
    // holeWert bleibt ROH — sonst meldete das Speichern keine Aenderung,
    // obwohl der Schluessel neu angelegt wird.
    assert.equal(holeWert({}, feld('einstellungssperre')), undefined)
    assert.equal(holeWertOderStandard({}, feld('einstellungssperre')), 'rechnen')
  })

  /**
   * EINE FRISCHE BOX STEHT NICHT MEHR OFFEN — und das entscheidet sich NICHT
   * an einem `standard`, sondern in der Installationsvorlage.
   *
   * Der `standard` darueber wird nur von `feldNachAussen` eingesetzt, also nur
   * auf dem Weg `GET /api/konfiguration` (Verwaltungs-Board). Die Box liest
   * `GET /api/config`, und das gibt die DATEI heraus. Eine frisch
   * installierte Box faellt deshalb gar nicht in den Fall „Schluessel fehlt":
   * autosetup legt config/templates/mupiboxconfig.json an die Stelle der
   * Konfiguration, und ein gesetzter Wert gewinnt gegen jede Vorgabe.
   *
   * DIESER FALL IST DER EINZIGE, DER DEN SATZ DES BETREIBERS PRUEFT. Faellt
   * die Vorlage auf „aus" zurueck, sind alle anderen Zusicherungen hier
   * Zierde — und das faellt sonst niemandem auf, weil das Board dank des
   * Vorgabewerts trotzdem „Rechenaufgabe" anzeigt.
   */
  it('die Installationsvorlage schreibt eine geschlossene Sperre aus', () => {
    const vorlage = JSON.parse(
      readFileSync(new URL('../../../config/templates/mupiboxconfig.json', import.meta.url), 'utf8'),
    )
    assert.equal(vorlage.mupibox.einstellungssperre, 'rechnen')
    // UND NICHT „pin": in derselben Vorlage ist `einstellungsPin` leer. „pin"
    // ohne gesetzte PIN sperrt AUS statt aufzufallen — das Backend vergleicht
    // gegen einen leeren Hash und sagt auf jede Eingabe nein. Ausgerechnet das
    // WLAN, ueber das man die Box wieder aufmachen muesste, laege dann hinter
    // der Sperre.
    assert.notEqual(vorlage.mupibox.einstellungssperre, 'pin')
    assert.equal(vorlage.mupibox.einstellungsPin, '')
  })

  /**
   * DREI VORGABEN, DIE DER BETREIBER AM 09.08.2026 BENANNT HAT.
   *
   * Alle drei stehen NUR in dieser Vorlage — autosetup legt sie an die Stelle
   * der Konfiguration, und ein gesetzter Wert gewinnt danach gegen jede
   * Vorgabe im Code. Wer sie hier zuruecksetzt, bekommt es an keiner anderen
   * Stelle gesagt: die frische Box faehrt einfach falsch hoch.
   */
  it('die Installationsvorlage bringt Name, Player und Oberflaeche mit', () => {
    const vorlage = JSON.parse(
      readFileSync(new URL('../../../config/templates/mupiboxconfig.json', import.meta.url), 'utf8'),
    )
    // Der Name steht nicht im Verborgenen: `mupibox.host` ist der
    // SPOTIFY-GERAETENAME (LIBRESPOT_NAME), die Kopfzeile der Verwaltung und
    // der Rechnername im Netz. Dieser Fork heisst MixPiBox — an allen dreien.
    assert.equal(vorlage.mupibox.host, 'MixPiBox')
    // mpv ist der Nachfolger von mplayer und wird vom Rezept installiert
    // (mupibox.yaml, "mpv (der Player, den die Konfiguration nennt)").
    // Blieb hier `mplayer` stehen, faehrt jede frische Box den alten Aufsatz.
    assert.equal(vorlage.mupibox.playerEngine, 'mpv')
    // SEIT E118/1d GIBT ES EINE OBERFLAECHE — und die Vorlage darf die
    // Schluessel der Erprobungszeit nicht wieder einschleppen: ein
    // `oberflaeche`-Feld suggeriert einen Schalter, den der Kiosk nicht
    // mehr liest, und `theme`/`installedThemes` zeigten auf die 29
    // CSS-Themen der ALTEN App (Symlink-Weg, gefallen mit E118/1c). Eine
    // frische Box soll gar nicht erst mit toten Schluesseln anfangen;
    // Bestandsboxen behalten ihre und stoeren nicht.
    assert.equal(Object.hasOwn(vorlage.mupibox, 'oberflaeche'), false, 'oberflaeche ist Geschichte (E118/1d)')
    assert.equal(Object.hasOwn(vorlage.mupibox, 'theme'), false, 'theme ist Geschichte (E118/1c+1d)')
    assert.equal(Object.hasOwn(vorlage.mupibox, 'installedThemes'), false, 'installedThemes ist Geschichte')
  })

  /**
   * DAS VIERTE FELD — nachgetragen am 03.08.2026 beim Gegenlesen.
   *
   * Die Bestandsaufnahme hatte DREI Felder ohne Schluessel auf der Box
   * gefunden, weil sie die Box FRAGTE. `mupibox.mediaCheckTimer` stand dort
   * noch — der Schluessel verschwindet nicht von selbst, sondern erst beim
   * naechsten Lauf von update/conf_update.sh, das ihn in Zeile 10 ersatzlos
   * loeschte. Ein Abgleich gegen den Ist-Stand einer Box kann so etwas gar
   * nicht sehen; gefunden hat es tools/konfig-umzug-probe.py, das das Skript
   * wirklich laufen laesst.
   *
   * `change_checker.sh` schliesst seine Schleife mit `sleep ${CHECK_TIMER}`.
   * Ohne Schluessel steht dort `null`, `sleep null` bricht sofort ab, und aus
   * der Warteschleife wird eine Dauerschleife.
   *
   * ZEICHENKETTE, NICHT ZAHL: so steht der Wert in der Vorlage, so hat ihn
   * jede gewachsene Box, und `pruefeFeld` erhaelt bei 'zahl' den Typ des
   * Altwerts. Eine Zahl hier hiesse: das Board schriebe beim ersten Speichern
   * einen anderen Typ hin, als jede Box bisher hat.
   */
  it('zeigt fuer die Medienpruefung den Takt der Vorlage', () => {
    assert.equal(feldNachAussen({}, feld('medienpruefung')).wert, '300')
    assert.equal(typeof feld('medienpruefung').standard, 'string')
  })

  it('erhaelt beim Speichern den Typ, den die Box schon hat', () => {
    // Steht "300" als Text da, kommt "600" als Text zurueck — die Shell liest
    // mit `jq -r`, ein Typwechsel unter ihr weg faellt erst Wochen spaeter auf.
    assert.deepEqual(pruefeFeld(feld('medienpruefung'), 600, '300'), {
      ok: true,
      wert: '600',
    })
  })
})

describe('Leere Eingaben — nur wo es einen Rueckweg braucht', () => {
  it('laesst den Namen der Box NICHT leeren', () => {
    assert.equal(pruefeFeld(feld('name'), '', 'MuPiBox').ok, false)
  })

  it('laesst Client-ID und Chat-ID leeren — das ist der Rueckweg', () => {
    assert.equal(pruefeFeld(feld('spotifyClientId'), '', 'abc').ok, true)
    assert.equal(pruefeFeld(feld('telegramChat'), '', '-100').ok, true)
  })
})

/**
 * DAS LICHT IM EINSCHALTKNOPF UND DIE HALTEDAUER DER TASTE.
 *
 * Beides konnte die alte PHP-Oberflaeche (mupi.php, Abschnitt „Power"), beides
 * fehlte hier: die LED ganz — die Haltedauer war da, aber mit einer Obergrenze,
 * die der Hardware widerspricht.
 *
 * WAS DAS DATENBLATT SAGT und woran diese Tests haengen: die LED des
 * Einschaltknopfs sitzt seit Platinenstand 2.2 (03/2024) auf GPIO13 mit PWM
 * (Stecker J15, der Taster an J1) — deshalb an, aus UND dimmbar. Derselbe
 * Taster schaltet ab 6 Sekunden Haltedauer HART ab, in Hardware, ohne zu
 * fragen.
 *
 * Die Kette dahinter (mupi_start_led.sh -> /tmp/.power_led -> led_control.py)
 * misst tools/knopflicht-probe.py; hier steht nur, was das Board zulaesst.
 */
describe('Knopflicht und Haltedauer', () => {
  it('kennt die drei Felder und legt sie zur uebrigen Hardware', () => {
    for (const id of ['knopflicht', 'knopflichtHell', 'knopflichtGedimmt']) {
      assert.equal(feld(id).bereich, 'hardware', `${id} steht im falschen Bereich`)
    }
    assert.equal(feld('knopflicht').art, 'schalter')
    assert.deepEqual(feld('knopflicht').pfad, ['shim', 'ledEnabled'])
    assert.deepEqual(feld('knopflichtHell').pfad, ['shim', 'ledBrightnessMax'])
    assert.deepEqual(feld('knopflichtGedimmt').pfad, ['shim', 'ledBrightnessMin'])
  })

  it('laesst die Helligkeiten nur zwischen 0 und 100 zu', () => {
    for (const id of ['knopflichtHell', 'knopflichtGedimmt']) {
      assert.equal(pruefeFeld(feld(id), 0, '100').ok, true)
      assert.equal(pruefeFeld(feld(id), 100, '100').ok, true)
      assert.equal(pruefeFeld(feld(id), 101, '100').ok, false, `${id} liess 101 durch`)
      assert.equal(pruefeFeld(feld(id), -1, '100').ok, false, `${id} liess -1 durch`)
    }
  })

  it('schreibt die Helligkeit als Text zurueck — so steht sie in der Vorlage', () => {
    // `shim.ledBrightnessMax` ist eine ZEICHENKETTE ("100"), weil
    // mupi_start_led.sh sie mit `jq -r` liest. Wer daraus eine Zahl macht,
    // aendert das Dateiformat unter dem Skript weg.
    assert.deepEqual(pruefeFeld(feld('knopflichtHell'), 70, '100'), { ok: true, wert: '70' })
  })

  it('haelt den Schalter als echten Boolean — wie fan_active daneben', () => {
    // Die Vorlage schreibt `true`, nicht "1". Steht in der Datei ein Boolean,
    // muss auch ein Boolean zurueckkommen: led_an() in mupi_start_led.sh
    // vergleicht gegen `false`, und ein "0" daneben waere eine zweite
    // Schreibweise, die jeder Leser kennen muesste.
    assert.deepEqual(pruefeFeld(feld('knopflicht'), false, true), { ok: true, wert: false })
    assert.deepEqual(pruefeFeld(feld('knopflicht'), true, false), { ok: true, wert: true })
  })

  it('legt den Schalter in die Vorlage, und zwar auf AN', () => {
    const vorlage = JSON.parse(
      readFileSync(new URL('../../../config/templates/mupiboxconfig.json', import.meta.url), 'utf8'),
    )
    // AN und nicht AUS: eine frische Box soll leuchten. Ein dunkler Knopf nach
    // der Installation sieht nach einem Defekt aus, und gesucht wird am Kabel.
    assert.equal(vorlage.shim.ledEnabled, true)
    assert.equal(typeof vorlage.shim.ledEnabled, 'boolean', 'muss ein echter Boolean sein')
    // Die Helligkeiten stehen daneben als Text — der Typ, den pruefeFeld erhaelt.
    assert.equal(typeof vorlage.shim.ledBrightnessMax, 'string')
    assert.equal(typeof vorlage.shim.ledBrightnessMin, 'string')
  })

  it('laesst den Knopf gedimmt nicht heller werden als normal', () => {
    // Sonst leuchtet er HELLER, sobald der Bildschirm ausgeht — genau
    // verkehrt herum. An den beiden Zahlen fuer sich ist der Dreher nicht zu
    // sehen, beide sind gueltig.
    const k = KONFIG()
    k['shim'] = { ledBrightnessMax: '20', ledBrightnessMin: '80' }
    const urteil = pruefeKonfig(k)
    assert.equal(urteil.ok, false)
    assert.match(String(urteil.grund), /gedimmt/)
  })

  it('laesst gleiche Werte zu — dimmen ist erlaubt, aber keine Pflicht', () => {
    const k = KONFIG()
    k['shim'] = { ledBrightnessMax: '40', ledBrightnessMin: '40' }
    assert.equal(pruefeKonfig(k).ok, true)
  })

  it('stoert sich nicht an einer Box ohne shim-Abschnitt', () => {
    // Die Pruefung darf keine Konfiguration ablehnen, nur weil ein Abschnitt
    // fehlt — sonst kaeme eine gewachsene Box gar nicht mehr zum Speichern.
    assert.equal(pruefeKonfig(KONFIG()).ok, true)
  })

  it('begrenzt die Haltedauer auf 5 Sekunden — ab 6 schaltet der HAT hart ab', () => {
    // Das ist keine Vorsicht, sondern Hardware: bei 6 Sekunden nimmt der
    // MuPiHAT den Strom weg, mitten im Schreiben. Stuenden hier 10, faehre die
    // Box bei JEDEM langen Druck hart herunter — und es saehe aus, als taete
    // sie genau das, was eingestellt wurde.
    assert.equal(feld('druckdauer').max, 5)
    assert.equal(pruefeFeld(feld('druckdauer'), 5, '2').ok, true)
    assert.equal(pruefeFeld(feld('druckdauer'), 6, '2').ok, false)
  })

  it('zeigt auf einer Box ohne den Schluessel AN — nicht aus', () => {
    // Die aeltere Box hat `shim.ledEnabled` noch nicht (update/conf_update.sh
    // legt ihn erst an). Ohne Vorgabe zeigte das Board einen ausgeschalteten
    // Schalter ueber einem Knopf, der leuchtet — und der erste Klick darauf
    // („dann mache ich ihn mal an") schriebe false und machte ihn aus.
    assert.equal(feldNachAussen({}, feld('knopflicht')).wert, true)
    // Dieselbe Antwort geben led_an() in mupi_start_led.sh und ist_an() in
    // led_control.py; gemessen in tools/knopflicht-probe.py.
    assert.equal(feldNachAussen({}, feld('knopflichtHell')).wert, '100')
    assert.equal(feldNachAussen({}, feld('knopflichtGedimmt')).wert, '10')
    // ROH bleibt roh: sonst meldete das Speichern keine Aenderung, obwohl der
    // Schluessel neu angelegt wird.
    assert.equal(holeWert({}, feld('knopflicht')), undefined)
  })

  it('macht aus einer Bruchzahl eine ganze Sekunde', () => {
    // mupi.php bot 0,25-Schritte an. off_trigger.sh zaehlt damit
    // `for ((i=0;i<2.25;i++))` — das bricht in bash sofort ab, `button_held`
    // steht da schon auf true, und die Box faehrt beim Antippen herunter.
    // 'zahl' liest mit parseInt, hier darf also nie ein Komma durchkommen.
    assert.deepEqual(pruefeFeld(feld('druckdauer'), 2.25, '2'), { ok: true, wert: '2' })
    assert.deepEqual(pruefeFeld(feld('druckdauer'), '3.75', '2'), { ok: true, wert: '3' })
  })
})

describe('Abgleich-Stufe (E86)', () => {
  it('kennt genau die drei Stufen aus medien.ts — keine vierte', () => {
    // DIE LISTEN MUESSEN DIESELBEN SEIN. Steht hier ein Wert, den
    // `istAbstufung()` nicht kennt, faellt der Server still auf „normal"
    // zurueck: die Einstellung zeigte dann etwas an, das nirgends ankommt —
    // derselbe Fehler wie bei einem dritten Kiosk-Browser.
    const f = feldNach('abgleichStufe')
    assert.ok(f)
    const liste = auswahlFuer({}, f)
    assert.deepEqual(
      liste.map((a) => a.wert),
      Object.keys(ABSTUFUNGEN),
    )
    for (const a of liste) assert.equal(istAbstufung(a.wert), true, `${a.wert} muss medien.ts bekannt sein`)
    assert.equal(pruefeAuswahl(f, 'locker', liste).ok, true)
    assert.equal(pruefeAuswahl(f, 'fingerabdruck', liste).ok, false, 'was es nicht gibt, wird abgewiesen')
  })

  it('steht bei den Medien und traegt „normal" als Vorgabe', () => {
    const f = feldNach('abgleichStufe')
    assert.equal(f?.bereich, 'medien')
    assert.equal(f?.standard, 'normal')
    assert.deepEqual(f?.pfad, ['mupibox', 'abgleichStufe'])
  })
})
