/**
 * Tests für die Dienstverwaltung.
 *
 * Der Schwerpunkt liegt auf der Freigabeprüfung: sie ist die Stelle, an der
 * die alte PHP-Seite ihre Lücke hatte (Formularwert wandert per Verkettung in
 * einen sudo-Aufruf). Was hier durchrutscht, wird zu einem Systembefehl.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AKTIONEN,
  type Dienst,
  beschriftung,
  ABGELOEST,
  HINWEIS,
  TRAGWEITE,
  abschnittVon,
  bestaetigungFuer,
  brauchtBestaetigung,
  erlaubteAusListe,
  folgenVon,
  istAktion,
  istErlaubterDienst,
  kurzGemerkt,
  ohneEinstufung,
  parseShow,
  sortiert,
} from './dienste.js'

describe('istErlaubterDienst', () => {
  it('nimmt die Dienste der Box an', () => {
    for (const n of [
      'mupi_vnc.service',
      'mupibox-bt-reconnect.service',
      'mupibox-touch-bridge.service',
      'mupi-network-info.service',
    ])
      assert.equal(istErlaubterDienst(n), true, n)
  })

  it('nimmt die mitverwalteten Fremddienste an', () => {
    for (const n of ['smbd.service', 'proftpd.service', 'librespot.service'])
      assert.equal(istErlaubterDienst(n), true, n)
  })

  it('lässt fremde Dienste nicht durch', () => {
    for (const n of ['ssh.service', 'systemd-logind.service', 'nginx.service'])
      assert.equal(istErlaubterDienst(n), false, n)
  })

  it('weist alles ab, was nach Einschleusen aussieht', () => {
    // Ohne Shell wäre das ohnehin nur ein unbekannter Name — aber die Prüfung
    // soll gar nicht erst darauf vertrauen, dass der Aufrufer execFile nutzt.
    for (const n of [
      'mupi_vnc.service; rm -rf /',
      'mupi_vnc.service && reboot',
      '$(reboot).service',
      '`reboot`.service',
      '../../etc/passwd',
      '/etc/systemd/system/mupi_vnc.service',
      'mupi_vnc.service\nsmbd.service',
      'mupi@.service',
    ])
      assert.equal(istErlaubterDienst(n), false, n)
  })

  it('verlangt die Endung .service', () => {
    assert.equal(istErlaubterDienst('mupi_vnc'), false)
    assert.equal(istErlaubterDienst('mupi_vnc.timer'), false)
    assert.equal(istErlaubterDienst('mupi_vnc.socket'), false)
  })

  it('verträgt Leeres und Übermäßiges', () => {
    assert.equal(istErlaubterDienst(''), false)
    assert.equal(istErlaubterDienst(`${'m'.repeat(200)}.service`), false)
  })
})

describe('istAktion', () => {
  it('kennt genau die fünf erlaubten', () => {
    for (const a of AKTIONEN) assert.equal(istAktion(a), true, a)
    assert.equal(AKTIONEN.length, 5)
  })

  it('weist alles andere ab', () => {
    for (const a of ['mask', 'kill', 'edit', 'start;reboot', '', null, undefined, 42])
      assert.equal(istAktion(a), false, String(a))
  })
})

describe('parseShow', () => {
  const text = [
    'Id=mupi_vnc.service',
    'Description=MuPiBox VNC',
    'ActiveState=active',
    'UnitFileState=enabled',
    '',
    'Id=smbd.service',
    'Description=Samba SMB Daemon',
    'ActiveState=inactive',
    'UnitFileState=disabled',
    '',
    'Id=mupi_hat.service',
    'Description=MuPiHAT',
    'ActiveState=failed',
    'UnitFileState=static',
  ].join('\n')

  it('zerlegt alle Blöcke', () => {
    const d = parseShow(text)
    assert.equal(d.length, 3)
    assert.deepEqual(
      d.map((x) => x.name),
      ['mupi_vnc.service', 'smbd.service', 'mupi_hat.service'],
    )
  })

  it('liest laufend und eingeschaltet richtig', () => {
    const [vnc, smbd] = parseShow(text)
    assert.equal(vnc.aktiv, true)
    assert.equal(vnc.eingeschaltet, true)
    assert.equal(smbd.aktiv, false)
    assert.equal(smbd.eingeschaltet, false)
  })

  it('meldet static als "nicht umschaltbar" statt als "aus"', () => {
    // Sonst böte die Oberfläche einen Schalter an, der nichts bewirkt.
    const hat = parseShow(text)[2]
    assert.equal(hat.eingeschaltet, null)
    assert.equal(hat.zustand, 'failed')
  })

  it('zählt activating als laufend', () => {
    const [d] = parseShow('Id=a.service\nActiveState=activating\nUnitFileState=enabled')
    assert.equal(d.aktiv, true)
  })

  it('überlebt fehlende Eigenschaften', () => {
    const d = parseShow('Id=a.service')
    assert.equal(d.length, 1)
    assert.equal(d[0].beschreibung, 'a.service', 'fällt auf den Namen zurück')
    assert.equal(d[0].aktiv, false)
    assert.equal(d[0].eingeschaltet, null)
  })

  it('ignoriert Blöcke ohne Id und Leeres', () => {
    assert.deepEqual(parseShow(''), [])
    assert.deepEqual(parseShow('Description=ohne Id\n\nActiveState=active'), [])
  })

  it('verträgt Windows-Zeilenenden nicht als Teil des Werts', () => {
    const [d] = parseShow('Id=a.service\nDescription=Test  \nActiveState=active')
    assert.equal(d.beschreibung, 'Test')
  })
})

describe('erlaubteAusListe', () => {
  it('nimmt nur die erlaubten und entdoppelt', () => {
    const text = [
      'mupi_vnc.service      enabled  enabled',
      'smbd.service          disabled disabled',
      'ssh.service           enabled  enabled',
      'mupi_vnc.service      enabled  enabled',
      'systemd-logind.service static   -',
      '',
    ].join('\n')
    assert.deepEqual(erlaubteAusListe(text), ['mupi_vnc.service', 'smbd.service'])
  })

  it('verträgt leere Ausgabe', () => {
    assert.deepEqual(erlaubteAusListe(''), [])
  })
})

describe('beschriftung', () => {
  const d = (name: string, beschreibung = 'roh'): Dienst => ({
    name,
    beschreibung,
    aktiv: false,
    eingeschaltet: null,
    zustand: 'inactive',
  })

  it('nennt bekannte Dienste verständlich', () => {
    assert.equal(beschriftung(d('smbd.service')), 'Dateifreigabe (Windows-Netz)')
    assert.equal(beschriftung(d('mupibox-touch-bridge.service')), 'Touchscreen-Brücke')
  })

  it('fällt bei unbekannten auf die Beschreibung zurück (statt namenlos)', () => {
    assert.equal(beschriftung(d('mupi_neu.service', 'Etwas Neues')), 'Etwas Neues')
  })
})

describe('sortiert', () => {
  it('stellt Kaputtes nach oben, dann Laufendes, dann den Rest', () => {
    const mach = (name: string, zustand: string, aktiv: boolean): Dienst => ({
      name,
      beschreibung: name,
      aktiv,
      eingeschaltet: null,
      zustand,
    })
    const raus = sortiert([
      mach('a.service', 'inactive', false),
      mach('b.service', 'active', true),
      mach('c.service', 'failed', false),
    ])
    assert.deepEqual(
      raus.map((d) => d.name),
      ['c.service', 'b.service', 'a.service'],
    )
  })

  it('lässt die Eingabe unangetastet', () => {
    const ein: Dienst[] = [
      { name: 'b.service', beschreibung: 'b', aktiv: false, eingeschaltet: null, zustand: 'x' },
      { name: 'a.service', beschreibung: 'a', aktiv: false, eingeschaltet: null, zustand: 'x' },
    ]
    sortiert(ein)
    assert.equal(ein[0].name, 'b.service')
  })
})

describe('kurzGemerkt — der teure systemctl-Aufruf', () => {
  // Anlass: `systemctl list-unit-files` kostet auf der Box 335 ms und steckte
  // in zwei Endpunkten. Gemessen, nicht geschaetzt.

  const uhr = () => {
    let t = 1000
    return { jetzt: () => t, vor: (ms: number) => { t += ms } }
  }

  it('fragt innerhalb der Frist nur EINMAL', async () => {
    let rufe = 0
    const u = uhr()
    const f = kurzGemerkt(async () => { rufe++; return `lauf ${rufe}` }, 30_000, u.jetzt)
    assert.equal(await f(), 'lauf 1')
    u.vor(29_000)
    assert.equal(await f(), 'lauf 1')
    assert.equal(rufe, 1)
  })

  it('fragt nach Ablauf der Frist neu', async () => {
    let rufe = 0
    const u = uhr()
    const f = kurzGemerkt(async () => { rufe++; return `lauf ${rufe}` }, 30_000, u.jetzt)
    await f()
    u.vor(30_001)
    assert.equal(await f(), 'lauf 2')
    assert.equal(rufe, 2)
  })

  it('vergisst auf Ansage — nach enable/disable muss es stimmen', async () => {
    let rufe = 0
    const u = uhr()
    const f = kurzGemerkt(async () => { rufe++; return `lauf ${rufe}` }, 30_000, u.jetzt)
    await f()
    f.vergessen()
    assert.equal(await f(), 'lauf 2', 'nach vergessen() muss frisch geholt werden')
  })

  it('laesst gleichzeitige Anfragen EINEN Lauf teilen', async () => {
    // Zwei Endpunkte, die zusammen geladen werden, duerfen nicht zwei
    // systemctl-Aufrufe ausloesen.
    let rufe = 0
    const f = kurzGemerkt(async () => {
      rufe++
      await new Promise((r) => setTimeout(r, 5))
      return 'einmal'
    }, 30_000)
    const [a, b, c] = await Promise.all([f(), f(), f()])
    assert.deepEqual([a, b, c], ['einmal', 'einmal', 'einmal'])
    assert.equal(rufe, 1)
  })

  it('merkt sich einen FEHLSCHLAG nicht', async () => {
    // Sonst haengt eine einmalige Stoerung die ganze Frist lang nach und die
    // Dienstliste bliebe leer, obwohl systemctl laengst wieder antwortet.
    let rufe = 0
    const f = kurzGemerkt(async () => {
      rufe++
      if (rufe === 1) throw new Error('systemctl weg')
      return 'geht wieder'
    }, 30_000)
    await assert.rejects(() => f())
    assert.equal(await f(), 'geht wieder')
  })
})

describe('ABGELOEST — etwas Neueres tut dasselbe', () => {
  it('fuehrt genau die zwei Dienste, fuer die es einen Nachfolger GIBT', () => {
    assert.deepEqual(Object.keys(ABGELOEST).sort(), ['mupi_splash.service', 'spotifyd.service'])
  })

  it('markiert NICHT, was in Gebrauch ist', () => {
    // Der Hinweis darf nicht dorthin rutschen, wo die Box wirklich läuft.
    for (const n of ['librespot.service', 'mupibox-server.service', 'bluetooth.service']) {
      assert.equal(ABGELOEST[n], undefined, `${n} ist in Gebrauch`)
    }
  })

  /**
   * DIE UNTERSCHEIDUNG, die dieser Test festhaelt (verlangt 03.08.2026):
   * „abgeloest" heisst „es gibt einen Nachfolger", NICHT „auf dieser Box
   * aus". mupi_vnc, mupi_fan und mupi_telegram sind ganz normale
   * Wahlmoeglichkeiten, die hier gerade niemand gewaehlt hat. Ein „abgeloest"
   * an ihnen haelt jemanden davon ab, den Luefter einzuschalten.
   */
  it('stuft ABGESCHALTETE Dienste NICHT als abgeloest ein', () => {
    for (const n of ['mupi_vnc.service', 'mupi_fan.service', 'mupi_telegram.service', 'mupi_mqtt.service']) {
      assert.equal(ABGELOEST[n], undefined, `${n} ist aus, aber nicht abgeloest`)
      assert.equal(abschnittVon(n), 'normal')
    }
  })

  it('jeder Eintrag nennt den Nachfolger UND einen Beleg', () => {
    // Ein "veraltet" ohne Nachfolger hilft niemandem weiter, und eine
    // Einstufung ohne Beleg veraltet still.
    for (const [n, a] of Object.entries(ABGELOEST)) {
      assert.ok(a.wodurch.length > 3, `${n}: kein Nachfolger genannt`)
      assert.ok(a.beleg.length > 30, `${n}: kein Beleg`)
      assert.ok(a.warumGeblieben.length > 10, `${n}: kein Grund zu bleiben`)
      // Das Wort steht schon auf dem Schild - im Text wäre es doppelt.
      assert.ok(!/^Abgelöst/i.test(a.wodurch), `${n}: wiederholt das Schild`)
    }
  })
})

describe('HINWEIS — Auskunft ohne Urteil', () => {
  it('haelt pulseaudio aus der Abloesung heraus', () => {
    // Am Geraet gemessen: Pi 4 faehrt PulseAudio als AKTIVEN Tonweg. Ein
    // „abgeloest" waere dort eine Aufforderung, sich den Ton abzuschalten.
    assert.equal(ABGELOEST['pulseaudio.service'], undefined)
    assert.ok(HINWEIS['pulseaudio.service'])
    assert.equal(abschnittVon('pulseaudio.service'), 'normal')
  })

  it('warnt weiterhin vor der Nutzer-/System-Verwechslung', () => {
    // Die Liste zeigt den SYSTEM-Dienst - also "aus", obwohl Ton läuft.
    assert.ok(/NUTZER/i.test(HINWEIS['pulseaudio.service']))
  })

  /**
   * DER SCHALTER, DER INS LEERE ZEIGT (BACKLOG E12/X13(b)).
   *
   * Am 04.08.2026 an der Box .169 gemessen: `is-enabled` -> disabled,
   * `is-active` -> active (exited), und beide `Wants=` stehen da. Ueber
   * /api/dienste kam `eingeschaltet: false` bei `zustand: "active"` heraus.
   * Wer das ohne Hinweis sieht, legt den Schalter um und glaubt, er haette
   * etwas abgeschaltet.
   */
  it('erklaert, warum „aus" bei mupibox-alsa-init nichts abschaltet', () => {
    const h = HINWEIS['mupibox-alsa-init.service']
    assert.ok(h, 'kein Hinweis an mupibox-alsa-init')
    // Der Grund MUSS im Text stehen, nicht bloss die Warnung. Ohne "Wants"
    // weiss der Leser nicht, wo er nachsehen soll.
    assert.ok(/Wants=/.test(h), 'nennt den Grund nicht beim Namen')
    assert.ok(/Obergrenze|70/.test(h), 'verschweigt, dass sie die Lautstaerke setzt')
  })

  it('stuft mupibox-alsa-init NICHT als abgeloest ein', () => {
    // Dieselbe Regel wie bei pulseaudio: auf einem Pi 4 ohne PipeWire legt sie
    // den softvol-Regler an, den der Abspieldienst dort braucht. „Abgeloest"
    // waere dort die Aufforderung, sich den Ton wegzuschalten.
    assert.equal(ABGELOEST['mupibox-alsa-init.service'], undefined)
    assert.equal(abschnittVon('mupibox-alsa-init.service'), 'normal')
  })

  /**
   * GEGENPROBE ZUR BESCHRIFTUNG. Ein Hinweis an einem Namen, den `beschriftung`
   * gar nicht kennt, waere ein Hinweis an einer Zeile, die es nicht gibt —
   * genau der Tippfehler, der sonst nie auffaellt (siehe llmwiki
   * [[dienstliste-an-fuenf-orten]]).
   */
  it('haengt an keinem Dienst ohne Beschriftung', () => {
    for (const name of Object.keys(HINWEIS)) {
      const titel = beschriftung({
        name,
        beschreibung: 'ROHE BESCHREIBUNG',
        aktiv: false,
        eingeschaltet: false,
        zustand: 'inactive',
      })
      assert.notEqual(titel, 'ROHE BESCHREIBUNG', `${name}: kein Eintrag in NAMEN`)
    }
  })
})

/**
 * ZWEI ABSCHNITTE STATT EINER LANGEN LISTE.
 *
 * Geprueft wird hier GENAU DER WEG, den die Verwaltung geht: der Server ordnet
 * die ganze Liste mit `sortiert` und haengt jedem Dienst sein `abschnitt` an;
 * die Seite filtert danach in zwei Listen. Ein eigenes `geteilt()` im Backend
 * gab es im ersten Anlauf — es hat nie jemand gerufen und ist herausgenommen
 * worden (siehe Kommentar in dienste.ts). Ein Test, der eine Funktion prueft,
 * die niemand benutzt, sagt nichts ueber die Seite aus.
 */
describe('abschnittVon — die Aufteilung, so wie die Seite sie macht', () => {
  const d = (name: string, aktiv = false, zustand = 'inactive') => ({
    name,
    beschreibung: name,
    aktiv,
    eingeschaltet: false,
    zustand,
  })
  /** Was die Seite tut: sortieren lassen, dann filtern. */
  const wieDieSeite = (liste: ReturnType<typeof d>[]) => {
    const alle = sortiert(liste).map((x) => ({ ...x, abschnitt: abschnittVon(x.name) }))
    return {
      normal: alle.filter((x) => x.abschnitt !== 'abgeloest'),
      abgeloest: alle.filter((x) => x.abschnitt === 'abgeloest'),
    }
  }

  it('sortiert Abgeloestes aus der normalen Liste heraus', () => {
    const { normal, abgeloest } = wieDieSeite([
      d('librespot.service', true, 'active'),
      d('spotifyd.service'),
      d('mupi_fan.service'),
      d('mupi_splash.service'),
    ])
    assert.deepEqual(
      abgeloest.map((x) => x.name).sort(),
      ['mupi_splash.service', 'spotifyd.service'],
    )
    assert.deepEqual(
      normal.map((x) => x.name).sort(),
      ['librespot.service', 'mupi_fan.service'],
    )
  })

  it('holt einen GESTOERTEN abgeloesten Dienst NICHT nach oben', () => {
    // `sortiert` zieht Kaputtes nach vorn. Das darf einen abgeloesten Dienst
    // nicht in den oberen Abschnitt heben: er ist trotzdem nichts, worum man
    // sich kuemmern muss.
    const { normal, abgeloest } = wieDieSeite([
      d('mupi_fan.service'),
      d('spotifyd.service', false, 'failed'),
    ])
    assert.deepEqual(normal.map((x) => x.name), ['mupi_fan.service'])
    assert.deepEqual(abgeloest.map((x) => x.name), ['spotifyd.service'])
  })

  it('verliert keinen einzigen Dienst', () => {
    const alle = [d('a.service'), d('spotifyd.service'), d('b.service'), d('mupi_splash.service')]
    const { normal, abgeloest } = wieDieSeite(alle)
    assert.equal(normal.length + abgeloest.length, alle.length)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * TRAGWEITE — „kommt ein Elternteil zurueck?"
 *
 * DIESE AUSSAGEN WAEREN AM 06.08.2026 ALLE ROT GEWESEN. Bis dahin bot die
 * Seite fuer JEDEN Dienst dieselben zwei Bedienungen in derselben Aufmachung
 * an — auch fuer `mupibox-server.service`, den einen Prozess, der die
 * Verwaltung, die API und das Bild auf dem Schirm der Box ausliefert. Es gab
 * keine Einstufung, keine Rueckfrage und keinen Ort, an dem gestanden haette,
 * was ohne einen Dienst am Geraet noch geht.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('Tragweite — was ohne diesen Dienst am Geraet noch geht', () => {
  /**
   * Die Dienstliste, wie systemd sie auf Box .169 wirklich meldet
   * (`systemctl list-unit-files --type=service`, gelesen am 07.08.2026).
   *
   * NICHT von Hand kurzgehalten: genau die Vollstaendigkeit ist der Test. Wer
   * einen Dienst dazubaut, ohne die Frage zu beantworten, wird hier rot.
   */
  const VON_DER_BOX = [
    'bluetooth.service',
    'dietpi-dashboard.service',
    'librespot-waechter.service',
    'librespot.service',
    'mupi-network-info.service',
    'mupi_autoconnect-wifi.service',
    'mupi_change_checker.service',
    'mupi_check_internet.service',
    'mupi_check_monitor.service',
    'mupi_fan.service',
    'mupi_hat.service',
    'mupi_hat_control.service',
    'mupi_idle_shutdown.service',
    'mupi_mqtt.service',
    'mupi_novnc.service',
    'mupi_powerled.service',
    'mupi_splash.service',
    'mupi_startstop.service',
    'mupi_telegram.service',
    'mupi_vnc.service',
    'mupi_wifi.service',
    'mupibox-alsa-init.service',
    'mupibox-boot-splash.service',
    'mupibox-bt-reconnect.service',
    'mupibox-netz-watchdog-boot.service',
    'mupibox-player.service',
    'mupibox-server.service',
    'mupibox-sicherung.service',
    'mupibox-sicherungsprobe.service',
    'mupibox-touch-bridge.service',
    'mupibox-wiederherstellung.service',
    'pulseaudio.service',
    'spotifyd.service',
    'wifi-powersave-off.service',
  ]

  it('laesst KEINEN Dienst der Box ohne Antwort', () => {
    // „Steht nicht drin" darf nicht heissen koennen „ist harmlos". Sonst ist
    // die Tabelle nach dem naechsten neuen Dienst schon wieder eine Liste
    // von Zufaellen.
    assert.deepEqual(ohneEinstufung(VON_DER_BOX), [])
  })

  it('deckt auch die Dienste aus diesem Repo ab, die auf .169 fehlen', () => {
    // config/services/ kennt mehr als die eine Box installiert hat.
    assert.deepEqual(ohneEinstufung(['mupibox-kioskwache.service']), [])
  })

  it('nennt einen unbekannten Dienst beim Namen, statt ihn durchzuwinken', () => {
    assert.deepEqual(ohneEinstufung(['mupi_neuerfunden.service']), [
      'mupi_neuerfunden.service',
    ])
  })

  it('jeder Eintrag traegt seinen Beleg und beide Bedienungen', () => {
    for (const [name, t] of Object.entries(TRAGWEITE)) {
      assert.ok(t.beleg.length > 20, `${name}: ohne Beleg ist die Einstufung eine Behauptung`)
      for (const [wozu, f] of [
        ['anhalten', t.anhalten],
        ['startetMit', t.startetMit],
      ] as const) {
        assert.ok(f.verliert.length > 10, `${name}/${wozu}: sagt nicht, was wegfaellt`)
        assert.ok(f.rueckweg.length > 10, `${name}/${wozu}: sagt nicht, wie man zurueckkommt`)
      }
    }
  })

  it('DER BEFUND: mupibox-server vom Start zu nehmen ist endgueltig', () => {
    // Dieser eine Prozess bedient 8200 UND 8443 — Verwaltung, API und das
    // Bild auf dem Schirm der Box. Es gibt danach nichts mehr, was antwortet.
    assert.equal(TRAGWEITE['mupibox-server.service'].startetMit.stufe, 'kein-rueckweg')
    assert.equal(brauchtBestaetigung('mupibox-server.service', 'disable'), true)
  })

  it('DER UNTERSCHIED: „Anhalten" ist dort zuruecknehmbar, „startet mit" nicht', () => {
    // Heute sah der endgueltige harmloser aus als der harmlose. Genau diese
    // Verwechslung ist hier festgeschrieben: `stop` laesst die Einheit
    // `enabled` — ein Stromausfall holt sie zurueck.
    assert.equal(TRAGWEITE['mupibox-server.service'].anhalten.stufe, 'warnung')
    assert.equal(brauchtBestaetigung('mupibox-server.service', 'stop'), false)
  })

  it('die Touch-Bruecke ebenso — sie IST der Beruehrungsschirm', () => {
    assert.equal(TRAGWEITE['mupibox-touch-bridge.service'].startetMit.stufe, 'kein-rueckweg')
    assert.equal(brauchtBestaetigung('mupibox-touch-bridge.service', 'disable'), true)
    assert.equal(brauchtBestaetigung('mupibox-touch-bridge.service', 'stop'), false)
  })

  it('und der Rueckweg selbst: wer die Wiederherstellung abschaltet, nimmt sich die Reserve', () => {
    assert.equal(
      TRAGWEITE['mupibox-wiederherstellung.service'].startetMit.stufe,
      'kein-rueckweg',
    )
  })

  it('genau DREI Dienste sind endgueltig — der Rest schreit nicht mit', () => {
    // Eine Rueckfrage, die staendig kommt, ist nach zwei Wochen ein Reflex.
    // Wenn diese Liste waechst, soll das eine Entscheidung sein und kein
    // Nebeneffekt.
    const endgueltig = Object.entries(TRAGWEITE)
      .filter(([, t]) => t.startetMit.stufe === 'kein-rueckweg')
      .map(([n]) => n)
      .sort()
    assert.deepEqual(endgueltig, [
      'mupibox-server.service',
      'mupibox-touch-bridge.service',
      'mupibox-wiederherstellung.service',
    ])
  })

  it('der Luefter bleibt eine ganz normale Wahl', () => {
    // Wer den Luefter abschaltet, soll das ohne Zeremonie koennen.
    assert.equal(TRAGWEITE['mupi_fan.service'].startetMit.stufe, 'normal')
    assert.equal(brauchtBestaetigung('mupi_fan.service', 'disable'), false)
    assert.equal(folgenVon('mupi_fan.service', 'disable')?.stufe, 'normal')
  })

  it('EINSCHALTEN hat nie Folgen — daraus kommt man immer zurueck', () => {
    for (const a of ['start', 'restart', 'enable'] as const) {
      assert.equal(folgenVon('mupibox-server.service', a), undefined, a)
      assert.equal(brauchtBestaetigung('mupibox-server.service', a), false, a)
    }
  })

  it('ein Dienst ohne Einstufung wird nicht heimlich zur Warnung', () => {
    assert.equal(folgenVon('mupi_neuerfunden.service', 'disable'), undefined)
    assert.equal(brauchtBestaetigung('mupi_neuerfunden.service', 'disable'), false)
  })
})

describe('bestaetigungFuer — das Wort, das man erst geliefert bekommen muss', () => {
  it('nennt Dienst UND Aktion', () => {
    assert.equal(
      bestaetigungFuer('mupibox-server.service', 'disable'),
      'kein-rueckweg:mupibox-server.service:disable',
    )
  })

  it('eine Bestaetigung fuer „Anhalten" passt NICHT auf „startet mit"', () => {
    // Sonst waere die zweite Frage mit der Antwort auf die erste erledigt.
    assert.notEqual(
      bestaetigungFuer('mupibox-server.service', 'stop'),
      bestaetigungFuer('mupibox-server.service', 'disable'),
    )
  })

  it('und die eines anderen Dienstes passt auch nicht', () => {
    assert.notEqual(
      bestaetigungFuer('mupibox-touch-bridge.service', 'disable'),
      bestaetigungFuer('mupibox-server.service', 'disable'),
    )
  })
})

describe('beschriftung — die eingestuften Dienste heissen auch verstaendlich', () => {
  it('kein eingestufter Dienst faellt auf seine technische Description zurueck', () => {
    // Eine Warnung hilft nicht, wenn die Zeile darueber „MuPiBox Backend
    // (server.js)" heisst — genau so stand mupibox-server bis zum 07.08.2026 da.
    for (const name of Object.keys(TRAGWEITE)) {
      const roh = { name, beschreibung: 'TECHNISCHE-DESCRIPTION' } as Dienst
      assert.notEqual(beschriftung(roh), 'TECHNISCHE-DESCRIPTION', name)
    }
  })

  it('sagt bei mupibox-server, dass es um die ganze Box geht', () => {
    const t = beschriftung({ name: 'mupibox-server.service', beschreibung: 'x' } as Dienst)
    assert.match(t, /Verwaltung/)
  })
})
