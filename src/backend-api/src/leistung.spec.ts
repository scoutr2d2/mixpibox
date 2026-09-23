import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { blameLesen, gruppieren, nameVon, psLesen, startzeitLesen, zeitachseLesen } from './leistung'

describe('nameVon', () => {
  it('nennt den Kiosk beim Namen, egal welcher Teilprozess', () => {
    // ACHT PROZESSE, EINE SACHE. Wer hier trennt, bekommt im Diagramm einen
    // Balken „Kiosk" neben fuenf Balken „Renderer" — und die Frage „was
    // kostet der Kiosk" bleibt unbeantwortet.
    assert.equal(nameVon('/usr/lib/chromium/chromium --type=renderer --lang=de'), 'Kiosk (Chromium)')
    assert.equal(nameVon('/usr/lib/chromium/chromium --type=gpu-process'), 'Kiosk (Chromium)')
    assert.equal(nameVon('cog -O renderer=gles --platform=drm http://localhost:8200/neu/'), 'Kiosk (Cog)')
    assert.equal(nameVon('/usr/libexec/wpe-webkit-2.0/WPEWebProcess 7 12'), 'Kiosk (Cog)')
  })

  it('verwechselt Cog nicht mit Chromium — die Reihenfolge der Pruefung zaehlt', () => {
    // WPEWebProcess traegt kein "cog" im Namen; stuende die Chromium-Regel
    // vorn und griffe auf "chrome" in irgendeinem Pfad, landete er falsch.
    assert.equal(nameVon('WPENetworkProcess'), 'Kiosk (Cog)')
    assert.notEqual(nameVon('WPEWebProcess'), 'Kiosk (Chromium)')
  })

  it('nennt Python-Dienste nach ihrem Skript, nicht nach dem Interpreter', () => {
    // Sonst stuenden Bootwache, HAT-Dienst und Sicherung als eine Zeile
    // „python3" da — die groesste Gruppe, die nichts aussagt.
    assert.equal(nameVon('/usr/bin/python3 /usr/local/bin/mupibox/mupibox-kioskwache.py'), 'mupibox-kioskwache')
    assert.equal(nameVon('/usr/bin/python3 /usr/local/bin/mupibox/mupihat.py -j /tmp/mupihat.json'), 'MuPiHAT')
  })

  it('faellt auf den Programmnamen zurueck statt auf den ganzen Pfad', () => {
    assert.equal(nameVon('/usr/sbin/irgendwas --mit --schaltern'), 'irgendwas')
    assert.equal(nameVon(''), 'unbekannt')
  })
})

describe('psLesen', () => {
  it('liest pid, Laufzeit, CPU und den vollen Befehl', () => {
    const p = psLesen('  962 45231  1.4 mpv --idle=yes --no-video\n 1204   77  0.0 /bin/sh -c foo')
    assert.equal(p.length, 2)
    assert.deepEqual(p[0], { pid: 962, laufzeit: 45231, cpu: 1.4, befehl: 'mpv --idle=yes --no-video' })
    assert.equal(p[1].pid, 1204)
  })

  it('ueberspringt kaputte Zeilen, statt alles zu verwerfen', () => {
    // Eine Prozessliste aendert sich waehrend des Lesens; abgeschnittene
    // Zeilen kommen vor. Sie duerfen die ganze Anzeige nicht leeren.
    const p = psLesen('962 45231 1.4 mpv\nMUELL\n\n1204 77 0.0 sh')
    assert.equal(p.length, 2)
  })
})

describe('gruppieren', () => {
  const roh = psLesen(
    [
      '100 900 2.0 /usr/lib/chromium/chromium --type=renderer',
      '101 800 1.0 /usr/lib/chromium/chromium --type=gpu-process',
      '102 1000 0.5 /usr/lib/xorg/Xorg :0',
      '103 5000 0.1 node /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server.js',
    ].join('\n'),
  )
  const speicher = new Map([
    [100, 200_000],
    [101, 150_000],
    [102, 50_000],
    [103, 90_000],
  ])

  it('fasst die Kiosk-Prozesse zu EINER Zeile mit Anzahl zusammen', () => {
    const { gruppen } = gruppieren(roh, speicher)
    const kiosk = gruppen.find((g) => g.name === 'Kiosk (Chromium)')
    assert.ok(kiosk)
    assert.equal(kiosk.speicher, 350_000, 'die Summe beider Teilprozesse')
    assert.equal(kiosk.anzahl, 2, 'die Verdichtung bleibt sichtbar')
  })

  it('nimmt die Laufzeit des AELTESTEN Mitglieds', () => {
    // Ein frisch nachgestarteter Renderer macht den Kiosk nicht juenger.
    const { gruppen } = gruppieren(roh, speicher)
    assert.equal(gruppen.find((g) => g.name === 'Kiosk (Chromium)')?.laufzeit, 900)
  })

  it('ordnet nach Speicher, damit der groesste Posten oben steht', () => {
    const { gruppen } = gruppieren(roh, speicher)
    assert.deepEqual(
      gruppen.map((g) => g.name),
      ['Kiosk (Chromium)', 'Server (Backend)', 'X-Server'],
    )
  })

  it('nennt den Rest, statt ihn wegzulassen', () => {
    // Ein Diagramm, dessen Summe nicht aufgeht, laedt zu falschen Schluessen
    // ein: „die Box braucht nur 400 MB" waere schlicht falsch.
    // VIER PROZESSE ERGEBEN DREI GRUPPEN — die beiden Chromium-Teilprozesse
    // verschmelzen. Bei Grenze 2 bleibt also genau eine uebrig; der erste
    // Entwurf dieses Tests erwartete zwei und lag falsch, nicht der Code.
    const { gruppen, rest, gesamt } = gruppieren(roh, speicher, 2)
    assert.equal(gruppen.length, 2)
    assert.ok(rest)
    assert.equal(rest.name, 'Übrige')
    assert.equal(rest.anzahl, 1, 'wie viele es sind, steht in anzahl — nicht im Namen')
    assert.equal(gruppen[0].speicher + gruppen[1].speicher + rest.speicher, gesamt)
  })

  it('zaehlt Prozesse ohne Speicherangabe als 0 statt zu scheitern', () => {
    // smaps_rollup ist fuer fremde Prozesse nicht lesbar — die Zeile soll
    // trotzdem erscheinen, nur eben ohne Zahl.
    const { gesamt, gruppen } = gruppieren(roh, new Map())
    assert.equal(gesamt, 0)
    assert.equal(gruppen.length, 3)
  })
})

describe('startzeitLesen', () => {
  it('liest Kernel und Userland aus der Pi-Zeile', () => {
    const s = startzeitLesen('Startup finished in 3.552s (kernel) + 21.918s (userspace) = 25.470s')
    assert.equal(s.kernel, 3.55)
    assert.equal(s.userland, 21.92)
    assert.equal(s.gesamt, 25.47)
  })

  it('versteht Millisekunden — der Kernel ist auf dem Pi schneller als eine Sekunde', () => {
    // WOERTLICH VON DER BOX (20.08.2026): "Startup finished in 794ms (kernel)
    // + 7.725s (userspace) = 8.520s". Der erste Entwurf verlangte ein "s"
    // direkt hinter der Zahl und lieferte fuer den Kernel null — der Balken
    // war halb leer und sah aus, als sei der Start reine Dienstezeit.
    const s = startzeitLesen('Startup finished in 794ms (kernel) + 7.725s (userspace) = 8.520s')
    assert.equal(s.kernel, 0.79)
    assert.equal(s.userland, 7.73)
    assert.equal(s.gesamt, 8.52)
  })

  it('versteht Minuten, wo sie vorkommen', () => {
    const s = startzeitLesen('Startup finished in 4.1s (kernel) + 1min 12.5s (userspace) = 1min 16.6s')
    assert.equal(s.userland, 72.5)
    assert.equal(s.gesamt, 76.6)
  })

  it('sucht nach BENANNTEN Posten und nicht nach Position', () => {
    // Auf x86 stehen Firmware und Loader mit davor. Wer das dritte Feld
    // nimmt, liest dort den Kernel als Userland.
    const s = startzeitLesen(
      'Startup finished in 6.9s (firmware) + 2.1s (loader) + 3.5s (kernel) + 20.0s (userspace) = 32.5s',
    )
    assert.equal(s.kernel, 3.5)
    assert.equal(s.userland, 20)
  })

  it('gibt null statt einer erfundenen Zahl, wenn nichts dasteht', () => {
    const s = startzeitLesen('systemd-analyze: command not found')
    assert.equal(s.kernel, null)
    assert.equal(s.userland, null)
    assert.equal(s.gesamt, null)
  })
})

describe('blameLesen', () => {
  it('rechnet Millisekunden und Minuten in Sekunden um', () => {
    const b = blameLesen(['9.412s dietpi-postboot.service', '850ms mupibox-server.service', '1min 2s foo.service'].join('\n'))
    assert.deepEqual(b, [
      { name: 'dietpi-postboot.service', sekunden: 9.41 },
      { name: 'mupibox-server.service', sekunden: 0.85 },
      { name: 'foo.service', sekunden: 62 },
    ])
  })

  it('nimmt nur die obersten — hundert Balken zeigen nichts', () => {
    const viele = Array.from({ length: 40 }, (_, i) => `${i}ms dienst-${i}.service`).join('\n')
    assert.equal(blameLesen(viele, 5).length, 5)
  })
})

describe('zeitachseLesen', () => {
  const roh = [
    'Id=dietpi-ramlog.service',
    'InactiveExitTimestampMonotonic=3510380',
    'ActiveEnterTimestampMonotonic=3771671',
    '',
    'Id=ifup@wlan0.service',
    'InactiveExitTimestampMonotonic=3931390',
    'ActiveEnterTimestampMonotonic=7481000',
    '',
    'Id=nie-gelaufen.service',
    'InactiveExitTimestampMonotonic=0',
    'ActiveEnterTimestampMonotonic=0',
  ].join('\n')

  it('rechnet Mikrosekunden in Sekunden und schneidet .service ab', () => {
    const b = zeitachseLesen(roh)
    const wlan = b.find((x) => x.name === 'ifup@wlan0')
    assert.ok(wlan)
    assert.equal(wlan.von, 3.93)
    assert.equal(wlan.bis, 7.48)
  })

  it('laesst Dienste weg, die nie liefen', () => {
    // Beide Stempel auf 0 hiesse ein Balken von 0 bis 0 — eine Marke am
    // Ursprung, die aussieht wie „ganz am Anfang gestartet".
    assert.equal(zeitachseLesen(roh).some((b) => b.name === 'nie-gelaufen'), false)
  })

  it('ordnet nach DAUER, nicht nach Startzeit', () => {
    // Die Frage lautet „was hat aufgehalten", nicht „was kam zuerst".
    // ifup@wlan0 braucht 3,55 s, dietpi-ramlog 0,26 s.
    assert.equal(zeitachseLesen(roh)[0].name, 'ifup@wlan0')
  })

  it('wirft rueckwaerts laufende Paare weg', () => {
    // Ein Dienst, der neu gestartet wurde, kann einen Aktiv-Stempel aus dem
    // ERSTEN Lauf und einen Start-Stempel aus dem zweiten tragen. Der Balken
    // liefe dann rueckwaerts und zoege die ganze Achse in die Breite.
    const kaputt = 'Id=x.service\nInactiveExitTimestampMonotonic=9000000\nActiveEnterTimestampMonotonic=1000000'
    assert.deepEqual(zeitachseLesen(kaputt), [])
  })

  it('kommt ohne abschliessende Leerzeile aus', () => {
    // `systemctl show` beendet die Ausgabe ohne Trenner — der letzte Eintrag
    // fiele sonst weg, und zwar genau der, den man zuletzt hinzugefuegt hat.
    const eins = 'Id=a.service\nInactiveExitTimestampMonotonic=1000000\nActiveEnterTimestampMonotonic=2000000'
    assert.equal(zeitachseLesen(eins).length, 1)
  })
})

describe('zeitachseLesen mit Bootgrenze', () => {
  const roh = [
    'Id=beim-boot.service',
    'InactiveExitTimestampMonotonic=3000000',
    'ActiveEnterTimestampMonotonic=4000000',
    '',
    'Id=spaeter-neugestartet.service',
    'InactiveExitTimestampMonotonic=17360000',
    'ActiveEnterTimestampMonotonic=21570000',
  ].join('\n')

  it('laesst weg, was NACH dem Boot anlief', () => {
    // WOERTLICH VON DER BOX (20.08.2026): ifup@wlan0 stand mit 17,4 bis 21,6 s
    // in der Liste, waehrend der Boot nach 8,5 s durch war — ein Reconnect.
    // Auf einer gemeinsamen Achse zieht das alle anderen Balken auf ein
    // Zehntel zusammen.
    const b = zeitachseLesen(roh, 14, 9.5)
    assert.deepEqual(b.map((x) => x.name), ['beim-boot'])
  })

  it('behaelt alles, wenn die Startzeit unbekannt ist', () => {
    // Lieber eine unscharfe Achse als eine leere: ohne systemd-analyze gibt
    // es keine Schranke, und dann ist jeder Balken besser als keiner.
    assert.equal(zeitachseLesen(roh, 14, 0).length, 2)
  })
})
