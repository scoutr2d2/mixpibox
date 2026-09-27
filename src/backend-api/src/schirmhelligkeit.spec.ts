/**
 * Die Regeln für die Bildschirmhelligkeit — OHNE Gerät geprüft.
 *
 * Der Kern dieser Datei ist EIN Satz, und alles andere steht drumherum:
 * aus dieser Rechnerei darf niemals ein Rohwert 0 herauskommen, egal was
 * hereingegeben wird. 0 heißt schwarzer Bildschirm, und ein schwarzer
 * Bildschirm heißt „am Gerät nicht mehr zurückdrehbar".
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  geraeteNachRang,
  gespeicherteProzent,
  istGeraeteName,
  klemmeProzent,
  leseZahl,
  OHNE_GERAET,
  PROZENT_MAX,
  PROZENT_MIN,
  PROZENT_SCHRITT,
  prozentUngeklemmt,
  prozentZuRoh,
  pruefeMaxRoh,
  pruefeProzent,
  rohUntergrenze,
  rohZuProzent,
  unterUntergrenze,
  waehleGeraet,
} from './schirmhelligkeit'

/** Wertebereiche, die es in freier Wildbahn wirklich gibt. */
const MAXWERTE = [1, 2, 3, 7, 9, 10, 15, 100, 255, 4095, 96000]

describe('Bildschirmhelligkeit: die Untergrenze', () => {
  it('KEINE Eingabe der Welt ergibt Rohwert 0', () => {
    const boese = [
      0,
      -1,
      -0.4,
      -1000,
      1,
      19,
      19.4,
      20,
      100,
      101,
      1e9,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.EPSILON,
      -0,
    ]
    for (const max of MAXWERTE) {
      for (const p of boese) {
        const roh = prozentZuRoh(p, max)
        assert.ok(roh >= 1, `${p} % bei max=${max} ergab ${roh} — das ist ein schwarzer Bildschirm`)
        assert.ok(roh >= rohUntergrenze(max), `${p} % bei max=${max} unterschritt die Untergrenze`)
        assert.ok(roh <= max, `${p} % bei max=${max} ergab ${roh} > max`)
        assert.ok(Number.isInteger(roh), 'sysfs nimmt nur ganze Zahlen')
      }
    }
  })

  it('die Untergrenze ist bei 255 genau die niedrigste Stufe der alten Oberfläche (51)', () => {
    // mupi.php bot 0/20/40/60/80/100 % an -> 0/51/102/153/204/255.
    // Alles ausser der 0 bleibt erreichbar; die 0 ist genau die Falle.
    assert.equal(rohUntergrenze(255), 51)
    assert.equal(prozentZuRoh(PROZENT_MIN, 255), 51)
    assert.equal(prozentZuRoh(0, 255), 51)
    assert.equal(prozentZuRoh(-99, 255), 51)
  })

  it('auch ein Panel mit winzigem Wertebereich bleibt an', () => {
    // max_brightness = 2: 20 % waeren gerundet 0.
    assert.equal(rohUntergrenze(2), 1)
    assert.equal(prozentZuRoh(PROZENT_MIN, 2), 1)
    assert.equal(prozentZuRoh(1, 1), 1)
  })

  it('ganz rechts ist wirklich ganz hell', () => {
    for (const max of MAXWERTE) assert.equal(prozentZuRoh(PROZENT_MAX, max), max)
  })
})

describe('Bildschirmhelligkeit: Prozent und Rohwert', () => {
  it('jeder Rasterpunkt des Reglers kommt als derselbe Prozentwert zurück', () => {
    for (const max of [100, 255, 4095, 96000]) {
      for (let p = PROZENT_MIN; p <= PROZENT_MAX; p += PROZENT_SCHRITT) {
        const zurueck = rohZuProzent(prozentZuRoh(p, max), max)
        assert.equal(zurueck, p, `${p} % bei max=${max} kam als ${zurueck} % zurück`)
      }
    }
  })

  /*
   * EIN GROBES PANEL HAT WENIGER STUFEN ALS DER REGLER, und das ist kein
   * Fehler, den man wegrechnen könnte: bei `max_brightness` = 10 gibt es
   * zwischen 20 und 100 % genau neun mögliche Rohwerte, der Regler bietet
   * siebzehn Rasterpunkte an. Zwei benachbarte Punkte landen dann auf
   * demselben Rohwert, und die Anzeige springt auf den, der wirklich gesetzt
   * ist. GLEICHHEIT KANN MAN DA NICHT VERLANGEN. Was man verlangen kann und
   * was zählt: die Anzeige ist STABIL — der Prozentwert, den sie zeigt, führt
   * auf genau den Rohwert zurück, der auch wirklich eingestellt ist. Sonst
   * wanderte der Regler bei jedem Neuladen ein Stück weiter.
   */
  it('auf einem groben Panel ist die Anzeige stabil', () => {
    for (const max of [2, 3, 7, 9, 10, 15]) {
      for (let roh = rohUntergrenze(max); roh <= max; roh++) {
        const p = rohZuProzent(roh, max)
        assert.equal(prozentZuRoh(p, max), roh, `Rohwert ${roh} bei max=${max} zeigte ${p} % und wanderte davon`)
      }
    }
  })

  it('ein von außen gesetzter zu dunkler Rohwert wird als Minimum ANGEZEIGT', () => {
    // Der Kernel oder ein fremdes Skript kann 5 hineinschreiben. Der Regler
    // kann diesen Wert nicht wieder herstellen — also behauptet er ihn auch
    // nicht.
    assert.equal(rohZuProzent(5, 255), PROZENT_MIN)
    assert.equal(rohZuProzent(0, 255), PROZENT_MIN)
    assert.equal(rohZuProzent(255, 255), 100)
    assert.equal(rohZuProzent(128, 255), 50)
  })

  it('unbrauchbare Angaben ergeben volle Helligkeit statt einer Rechnung ins Leere', () => {
    assert.equal(rohZuProzent(Number.NaN, 255), PROZENT_MAX)
    assert.equal(rohZuProzent(100, 0), PROZENT_MAX)
    assert.equal(klemmeProzent(Number.NaN), PROZENT_MAX)
  })
})

describe('Bildschirmhelligkeit: was von außen hereinkommt', () => {
  it('zu dunkel wird ABGELEHNT, nicht still geklemmt', () => {
    for (const p of [0, 1, 19, -5]) {
      const r = pruefeProzent(p)
      assert.equal(r.ok, false, `${p} % müsste abgelehnt werden`)
      if (!r.ok) assert.match(r.grund, /nicht mehr zurückdrehen|nicht einstellbar/)
    }
  })

  it('zu hell ebenso', () => {
    assert.equal(pruefeProzent(101).ok, false)
    assert.equal(pruefeProzent(1000).ok, false)
  })

  it('alles, was keine Zahl ist, fällt durch', () => {
    for (const x of [null, undefined, '', 'hell', {}, [], true, Number.NaN, Number.POSITIVE_INFINITY, '60%']) {
      assert.equal(pruefeProzent(x).ok, false, `${JSON.stringify(x)} durfte nicht durchkommen`)
    }
  })

  it('Zahlen als Zeichenkette gehen — so stehen sie in dieser Konfiguration', () => {
    const r = pruefeProzent('60')
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.wert, 60)
    const g = pruefeProzent(60.4)
    assert.equal(g.ok && g.wert, 60)
  })

  it('der gespeicherte Wert ist nachsichtig: fehlt er, gilt HELL', () => {
    assert.equal(gespeicherteProzent(undefined), PROZENT_MAX)
    assert.equal(gespeicherteProzent(null), PROZENT_MAX)
    assert.equal(gespeicherteProzent('quatsch'), PROZENT_MAX)
    assert.equal(gespeicherteProzent(0), PROZENT_MAX, 'eine gespeicherte 0 macht die Box nicht schwarz')
    assert.equal(gespeicherteProzent('40'), 40)
    assert.equal(gespeicherteProzent(40), 40)
  })
})

describe('Bildschirmhelligkeit: welches Gerät', () => {
  it('ein Name, aus dem ein Pfad gebaut wird, darf kein Pfad sein', () => {
    for (const n of ['..', '.', '../../etc/shadow', 'a/b', '/abs', '', '.versteckt', 'x'.repeat(65), null, 42]) {
      assert.equal(istGeraeteName(n), false, `${JSON.stringify(n)} durfte nicht als Gerätename gelten`)
    }
    for (const n of ['11-0045', '10-0045', 'rpi_backlight', 'intel_backlight', 'acpi_video0']) {
      assert.equal(istGeraeteName(n), true, `${n} ist ein echter Name aus /sys/class/backlight`)
    }
  })

  it('kein Eintrag heißt: diese Hardware kann es nicht', () => {
    assert.equal(waehleGeraet([]), null)
    assert.equal(waehleGeraet(['..', 'a/b', '']), null)
    assert.match(OHNE_GERAET, /HDMI/)
  })

  it('das Panel der Box gewinnt gegen den Laptopschirm — und die Wahl ist bestimmt, nicht zufällig', () => {
    assert.equal(waehleGeraet(['11-0045']), '11-0045')
    assert.equal(waehleGeraet(['acpi_video0', '11-0045']), '11-0045')
    assert.equal(waehleGeraet(['11-0045', 'acpi_video0']), '11-0045')
    assert.equal(waehleGeraet(['acpi_video0', 'intel_backlight']), 'intel_backlight')
    assert.equal(waehleGeraet(['acpi_video0']), 'acpi_video0', 'lieber der einzige als keiner')
    // Zweimal dieselbe Menge in anderer Reihenfolge -> dieselbe Antwort.
    assert.equal(waehleGeraet(['rpi_backlight', 'zz', 'aa']), waehleGeraet(['aa', 'zz', 'rpi_backlight']))
  })

  it('die Auswahl ist eine RANGFOLGE, nicht eine Entscheidung', () => {
    // Warum das eine Liste sein muss und kein einzelner Name: der erste
    // Anwaerter kann sich beim Aufmachen als untauglich herausstellen (kein
    // max_brightness), und dann braucht der Server einen zweiten Versuch.
    // Vorher gab es den nicht — ein leerer Eintrag `09-0045` neben dem echten
    // Panel liess den ganzen Regler verschwinden (gemessen 07.08.2026,
    // tools/schirm-helligkeit-loch.mjs).
    assert.deepEqual(geraeteNachRang([]), [])
    assert.deepEqual(geraeteNachRang(['..', 'a/b', '', null, 42]), [])
    assert.deepEqual(geraeteNachRang(['09-0045', '11-0045']), ['09-0045', '11-0045'])
    assert.deepEqual(geraeteNachRang(['11-0045', '09-0045']), ['09-0045', '11-0045'], 'gleiche Menge, gleiche Antwort')
    assert.deepEqual(geraeteNachRang(['acpi_video0', '11-0045', 'zz']), ['11-0045', 'zz', 'acpi_video0'])
    // Und der Laptopschirm bleibt hinten, auch wenn er alleine dasteht dran
    // kommt.
    assert.deepEqual(geraeteNachRang(['acpi_video0']), ['acpi_video0'])
    // waehleGeraet ist nur noch der erste Anwaerter dieser Liste.
    for (const menge of [['11-0045'], ['acpi_video0', 'intel_backlight'], ['zz', 'rpi_backlight', 'aa'], []]) {
      assert.equal(waehleGeraet(menge), geraeteNachRang(menge)[0] ?? null)
    }
  })

  it('max_brightness: 0 ist kein Regelbereich', () => {
    assert.equal(pruefeMaxRoh('255\n'), 255)
    assert.equal(pruefeMaxRoh('0'), null)
    assert.equal(pruefeMaxRoh(''), null)
    assert.equal(pruefeMaxRoh('-1'), null)
    assert.equal(pruefeMaxRoh('viel'), null)
    assert.equal(leseZahl('255\n'), 255)
    assert.equal(leseZahl('0'), 0)
    assert.equal(leseZahl(' 12 '), 12)
    assert.equal(leseZahl('1.5'), null)
  })

  it('max_brightness 1 auch nicht — sonst gaebe es einen Regler ohne Wirkung', () => {
    // GEMESSEN, NICHT GEDACHT (07.08.2026, nachgestelltes Panel am laufenden
    // Server): bei max_brightness 1 schrieben 20 % und 100 % beide die 1. Der
    // Schieber liess sich ziehen, die Prozentzahl lief mit, am Bildschirm
    // passierte nichts. Genau das darf es nicht geben — also gilt so ein
    // Geraet als „nicht dimmbar", und die Verwaltung schreibt den Satz hin.
    assert.equal(pruefeMaxRoh('1'), null)

    // Ab 2 sind es wirklich zwei verschiedene Helligkeiten.
    assert.equal(pruefeMaxRoh('2'), 2)
    assert.notEqual(prozentZuRoh(PROZENT_MIN, 2), prozentZuRoh(PROZENT_MAX, 2))

    // Und fuer JEDEN Wertebereich, den pruefeMaxRoh durchlaesst, muss der
    // Regler zwischen ganz links und ganz rechts einen Unterschied machen.
    for (const text of ['2', '3', '7', '9', '16', '100', '255', '1024', '4095']) {
      const max = pruefeMaxRoh(text)
      assert.ok(max !== null, `${text} sollte ein Regelbereich sein`)
      const unten = prozentZuRoh(PROZENT_MIN, max as number)
      const oben = prozentZuRoh(PROZENT_MAX, max as number)
      assert.ok(unten >= 1, `max_brightness ${text}: unten waere ${unten}`)
      assert.ok(oben > unten, `max_brightness ${text}: ${unten} bis ${oben} ist kein Regelweg`)
    }
  })
})

describe('Bildschirmhelligkeit: wenn die Anzeige über der Wirklichkeit liegt', () => {
  /**
   * DER BEFUND, DEN DIESE AUSSAGEN FESTHALTEN (07.08.2026, am nachgestellten
   * Panel gemessen): `brightness` = 0 bei `max_brightness` = 255 ergab
   * `prozent: 20, roh: 0`. Die Verwaltung am zweiten Rechner zeigte „20 %",
   * der Bildschirm der Box war schwarz. Das Klemmen selbst ist begründet und
   * bleibt — was fehlte, war die AUSKUNFT darüber.
   */
  it('rohZuProzent klemmt weiter — das ist Absicht und keine Regression', () => {
    assert.equal(rohZuProzent(0, 255), PROZENT_MIN)
    assert.equal(rohZuProzent(5, 255), PROZENT_MIN)
  })

  it('unterUntergrenze sagt, DASS geklemmt wurde — genau dann, wenn es so ist', () => {
    // Der Fall von der Box: die alte PHP-Seite bietet 0 % an und schreibt es.
    assert.equal(unterUntergrenze(0, 255), true)
    assert.equal(unterUntergrenze(5, 255), true)
    assert.equal(unterUntergrenze(50, 255), true, '50 liegt unter der Untergrenze 51')

    // GENAU AUF DER GRENZE ist NICHT geklemmt: dort sagt der Regler die
    // Wahrheit, und ein Hinweis waere ein Fehlalarm bei jeder Box, die
    // schlicht auf der kleinsten erlaubten Stufe steht.
    assert.equal(unterUntergrenze(rohUntergrenze(255), 255), false)
    assert.equal(unterUntergrenze(51, 255), false)
    assert.equal(unterUntergrenze(255, 255), false)

    // Nichts gelesen (Datei nicht lesbar) ist keine Klemmung, sondern gar
    // keine Aussage — hier darf nichts behauptet werden.
    assert.equal(unterUntergrenze(null, 255), false)
    assert.equal(unterUntergrenze(undefined, 255), false)
    assert.equal(unterUntergrenze(Number.NaN, 255), false)
  })

  it('für JEDEN Wertebereich gilt: was prozentZuRoh schreibt, gilt nie als geklemmt', () => {
    for (const max of MAXWERTE.filter((m) => m >= 2)) {
      for (let p = PROZENT_MIN; p <= PROZENT_MAX; p += PROZENT_SCHRITT) {
        const roh = prozentZuRoh(p, max)
        assert.equal(
          unterUntergrenze(roh, max),
          false,
          `max ${max}, ${p} % -> Rohwert ${roh} dürfte kein Fehlalarm sein`,
        )
      }
      // Und alles DARUNTER muss auffallen, sonst wäre die Auskunft nutzlos.
      const grenze = rohUntergrenze(max)
      for (let roh = 0; roh < grenze; roh++) {
        assert.equal(unterUntergrenze(roh, max), true, `max ${max}, Rohwert ${roh} müsste auffallen`)
      }
    }
  })

  it('prozentUngeklemmt nennt die Wirklichkeit — 0 bleibt 0', () => {
    assert.equal(prozentUngeklemmt(0, 255), 0)
    // Ein einzelner Schritt von 255 ist gerundet 0 — und das ist die ehrliche
    // Auskunft über einen Schirm, den niemand lesen kann. „1 %" klänge, als
    // sei da noch etwas.
    assert.equal(prozentUngeklemmt(1, 255), 0)
    assert.equal(prozentUngeklemmt(5, 255), 2)
    assert.equal(prozentUngeklemmt(128, 255), 50)
    assert.equal(prozentUngeklemmt(255, 255), 100)
  })

  it('prozentUngeklemmt fliesst NIE in einen Rohwert zurück — sonst wäre die Sperre weg', () => {
    // Die Zahl ist zum HINSCHREIBEN. Gibt jemand sie trotzdem in prozentZuRoh,
    // muss die Untergrenze weiter halten.
    for (const max of MAXWERTE.filter((m) => m >= 2)) {
      const echt = prozentUngeklemmt(0, max)
      assert.ok(prozentZuRoh(echt, max) >= 1, `max ${max}: aus ${echt} % wurde ein Rohwert 0`)
      // Und über den Endpunkt kommt so ein Wert ohnehin nicht herein.
      assert.equal(pruefeProzent(echt).ok, false)
    }
  })
})
