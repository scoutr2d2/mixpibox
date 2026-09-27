/**
 * Tests für das Protokoll-Lesen.
 *
 * Zwei Dinge stehen im Vordergrund: dass kein Pfad von aussen kommt (sonst
 * wäre es ein Leseloch über das ganze Dateisystem) und dass die Einstufung
 * nicht auf Teilzeichenketten hereinfällt — genau daran ist der LogCutter
 * schon einmal gescheitert, als `...WARNINGS=true` als Warnung zählte.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  DATEIEN,
  ZEILEN_MAX,
  ZEILEN_VORGABE,
  istProtokolldatei,
  lesefenster,
  letzteZeilen,
  stufeVonZeile,
  zeilenzahl,
} from './protokolle.js'

describe('DATEIEN', () => {
  it('kennt genau die Dateien, die kein Dienst-Journal ersetzt', () => {
    assert.deepEqual(Object.keys(DATEIEN).sort(), ['chromium', 'idle-shutdown', 'shutdown-control'])
  })

  /**
   * Das Chromium-Protokoll loest debug.php ab (G3, 03.08.2026). Der Hinweis
   * MUSS sagen, dass die Datei nur bei eingeschalteter Fehlersuche entsteht —
   * sonst sieht ein fehlendes Protokoll aus wie ein Fehler der Verwaltung,
   * und man sucht an der falschen Stelle.
   */
  it('sagt beim Chromium-Protokoll, warum es fehlen darf', () => {
    const d = DATEIEN['chromium']
    assert.ok(d)
    assert.equal(d.pfad, '/home/dietpi/.config/chromium/chrome_debug.log')
    assert.match(d.hinweis, /debug/i)
  })

  it('zeigt in kein pm2-Verzeichnis mehr', () => {
    // Hier standen bis 2026-08-02 vier pm2-Protokolle. Seit die Dienste als
    // systemd-Units laufen, schreibt niemand mehr hinein — am Geraet gemessen
    // standen sie seit dem 29.07. still. Weil die Dateien aber noch DA waren,
    // lieferte die Seite sie anstandslos aus: ein leeres Protokoll faellt auf,
    // ein eingefrorenes nicht. Ersatz sind die Journale von mupibox-server und
    // mupibox-player ueber /api/protokolle/dienst/<name>.
    for (const [id, d] of Object.entries(DATEIEN)) {
      assert.equal(d.pfad.includes('.pm2'), false, `${id} zeigt noch auf pm2`)
    }
  })

  /**
   * DIE PROBE AUF DIE SORTE, nicht auf das Symptom des letzten Falls.
   *
   * Der pm2-Test darüber prüft `!includes('.pm2')` — der nächste Fehler heisst
   * aber nicht pm2. Am 30.08.2026 zeigten beide Dateieinträge auf
   * `/var/log/mupibox/`, geschrieben wurde seit jeher nach `/tmp`; die Seite
   * antwortete dauerhaft „Protokoll nicht lesbar". Der pm2-Test war grün.
   *
   * Deshalb wird hier gegen den SCHREIBER gelesen: die Zeile, die den Pfad
   * festlegt, steht in der Shell-Datei, und beide müssen dasselbe sagen.
   * Verschiebt jemand ein Protokoll, fällt die Tabelle mit auf.
   */
  it('nennt bei jedem Protokoll den Pfad, den sein Schreiber wirklich benutzt', () => {
    const wurzel = new URL('../../../', import.meta.url)
    const schreiber: Record<string, string> = {
      'idle-shutdown': 'scripts/mupibox/idle_shutdown.sh',
      'shutdown-control': 'scripts/OnOffShim/off_trigger.sh',
      // `chromium` fehlt mit Absicht: chrome_debug.log legt Chromium selbst an,
      // sobald chromium-autostart.sh mit --enable-logging startet. Es gibt in
      // unserem Baum keine Zeile, die den Pfad setzt.
    }
    for (const [id, datei] of Object.entries(schreiber)) {
      const d = DATEIEN[id]
      assert.ok(d, id)
      const quelle = readFileSync(new URL(datei, wurzel), 'utf8')
      assert.ok(
        quelle.includes(d.pfad),
        `${id}: Tabelle nennt ${d.pfad}, aber ${datei} schreibt woandershin`,
      )
    }
  })

  it('nennt jede Datei mit absolutem Pfad und ohne Sprünge nach oben', () => {
    for (const [id, d] of Object.entries(DATEIEN)) {
      assert.equal(d.id, id, 'Kennung und Schlüssel müssen übereinstimmen')
      assert.ok(d.pfad.startsWith('/'), id)
      assert.equal(d.pfad.includes('..'), false, id)
    }
  })
})

describe('istProtokolldatei', () => {
  it('nimmt die bekannten an', () => {
    for (const id of Object.keys(DATEIEN)) assert.equal(istProtokolldatei(id), true, id)
  })

  it('weist Pfade und Ausbruchsversuche ab', () => {
    for (const x of [
      '/etc/shadow',
      '../../etc/passwd',
      'server-out/../../../etc/passwd',
      '/home/dietpi/.pm2/logs/server-out.log',
      '',
      null,
      42,
    ])
      assert.equal(istProtokolldatei(x), false, String(x))
  })

  it('lässt sich nicht über die Prototypenkette austricksen', () => {
    for (const x of ['toString', 'constructor', '__proto__', 'hasOwnProperty'])
      assert.equal(istProtokolldatei(x), false, x)
  })
})

describe('zeilenzahl', () => {
  it('nimmt vernünftige Werte', () => {
    assert.equal(zeilenzahl('50'), 50)
    assert.equal(zeilenzahl(300), 300)
  })

  it('deckelt nach oben', () => {
    assert.equal(zeilenzahl('999999'), ZEILEN_MAX)
  })

  it('fällt bei Unsinn auf die Vorgabe zurück', () => {
    for (const x of ['', 'viele', '-5', '0', null, undefined, Number.NaN])
      assert.equal(zeilenzahl(x), ZEILEN_VORGABE, String(x))
  })
})

describe('letzteZeilen', () => {
  it('gibt das Ende zurück', () => {
    const t = 'eins\nzwei\ndrei\nvier\nfünf'
    assert.deepEqual(letzteZeilen(t, 2), ['vier', 'fünf'])
  })

  it('zählt einen abschliessenden Umbruch nicht als Zeile', () => {
    // Sonst stünde unten immer eine leere Zeile und die letzte echte fehlte.
    assert.deepEqual(letzteZeilen('eins\nzwei\n', 2), ['eins', 'zwei'])
  })

  it('gibt alles zurück, wenn weniger da ist als verlangt', () => {
    assert.deepEqual(letzteZeilen('nur eine', 100), ['nur eine'])
  })

  it('verträgt Leeres', () => {
    assert.deepEqual(letzteZeilen('', 10), [])
  })
})

describe('lesefenster', () => {
  it('liest genug für die verlangten Zeilen', () => {
    assert.ok(lesefenster(200) >= 200 * 200)
  })

  it('liest auch bei wenigen Zeilen nicht lächerlich wenig', () => {
    assert.ok(lesefenster(1) >= 16 * 1024)
  })

  it('liest NIE die ganze Datei — sonst legt ein 500-MB-Protokoll die Box lahm', () => {
    // Die Eigenschaft, auf die es ankommt: egal was verlangt wird, das Fenster
    // bleibt gedeckelt. (Bei ZEILEN_MAX greift die Deckelung noch nicht —
    // 2000 x 200 Byte sind erst 400 kB.)
    for (const n of [1, 200, ZEILEN_MAX, 99999, Number.MAX_SAFE_INTEGER])
      assert.ok(lesefenster(n) <= 2 * 1024 * 1024, String(n))
    assert.equal(lesefenster(999999), 2 * 1024 * 1024, 'ab hier greift die Deckelung')
  })
})

describe('stufeVonZeile', () => {
  it('erkennt Fehler', () => {
    for (const z of [
      'ERROR: konnte nicht schreiben',
      '[ERROR] etwas',
      'error beim Start',
      'FATAL: aus',
      'Failed: nein',
      'Fehler: kaputt',
    ])
      assert.equal(stufeVonZeile(z), 'fehler', z)
  })

  it('erkennt Warnungen', () => {
    for (const z of ['WARN: knapp', '[WARNING] hm', 'Warnung: achtung'])
      assert.equal(stufeVonZeile(z), 'warnung', z)
  })

  it('fällt NICHT auf Teilzeichenketten herein', () => {
    // Genau das war der LogCutter-Fehler: eine Umgebungsvariable mit
    // "WARNINGS" im Namen zählte als Warnung.
    for (const z of [
      'MUPI_SHOW_WARNINGS=true',
      'keine Fehler aufgetreten',
      'errorhandler wurde geladen',
      'Verzeichnis /var/log/errors angelegt',
    ])
      assert.equal(stufeVonZeile(z), 'info', z)
  })

  it('behandelt Gewöhnliches als Info', () => {
    assert.equal(stufeVonZeile('26.7.2026: Server gestartet'), 'info')
    assert.equal(stufeVonZeile(''), 'info')
  })
})
