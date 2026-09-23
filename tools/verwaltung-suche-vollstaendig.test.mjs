/**
 * DIE PRUEFUNG, DIE ANSCHLAEGT, WENN DIE SUCHE EINEN SCHALTER NICHT KENNT.
 *
 * WOZU: Die Suche der Verwaltung durchsucht eine Datei
 * (src/frontend-admin/src/app/such-bestand.ts), die aus den Seiten erhoben
 * wird. Eine erzeugte Datei ist genau so lange richtig, wie jemand sie
 * erneuert — und der Fehler, der dabei entsteht, ist der leiseste, den es
 * gibt: die Suche findet den neuen Schalter einfach nicht, und niemand merkt
 * es, weil nichts kaputtgeht.
 *
 * Diese Pruefung macht daraus einen lauten Fehler. Sie erhebt den Bestand neu
 * und vergleicht ihn Zeichen fuer Zeichen mit der abgelegten Datei.
 *
 * WAS ES AENDERT: nichts. Es liest nur.
 *
 * AUFRUF
 *     node --test tools/verwaltung-suche-vollstaendig.test.mjs
 *
 * Schlaegt sie an, ist das die ganze Behebung:
 *     node tools/verwaltung-suchbestand.mjs --schreiben
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  bestandErheben,
  dateiInhalt,
  kopfleiseLesen,
  OHNE_EINSTELLUNGEN,
  OHNE_KOPFLEISTE,
  unterseitenLesen,
  vorlageErheben,
  ZIELDATEI,
} from './verwaltung-suchbestand.mjs'

describe('Suchbestand der Verwaltung', () => {
  const { eintraege, ohneNavigation, ohneEintraege } = bestandErheben()

  test('die abgelegte Datei ist die, die aus den Seiten herauskommt', () => {
    const abgelegt = readFileSync(ZIELDATEI, 'utf8')
    assert.equal(
      dateiInhalt(eintraege),
      abgelegt,
      'Der Suchbestand ist nicht mehr der der Seiten. Erneuern mit:\n' +
        '    node tools/verwaltung-suchbestand.mjs --schreiben',
    )
  })

  test('jede Seite der Kopfleiste kommt im Bestand vor', () => {
    for (const k of kopfleiseLesen()) {
      assert.ok(
        eintraege.some((e) => e.weg === k.weg),
        `Die Seite „${k.name}" (${k.weg}) hat keinen einzigen Eintrag.`,
      )
    }
  })

  test('nur die bekannten Seiten stehen nicht in der Kopfleiste', () => {
    // „ohneNavigation" heisst seit dem 03.08.2026: weder in der Leiste NOCH
    // von genau einer Seite dort verlinkt. Eine Unterseite mit Elternteil ist
    // in Ordnung; eine Seite, zu der gar kein Weg fuehrt, ist es nie.
    assert.deepEqual(
      ohneNavigation.filter((d) => !OHNE_KOPFLEISTE.includes(d)),
      [],
    )
  })

  test('nur die bekannten Seiten tragen keine Einstellung', () => {
    assert.deepEqual(
      ohneEintraege.filter((d) => !OHNE_EINSTELLUNGEN.includes(d)),
      [],
    )
  })

  /**
   * Der Fangschuss: EIN Schalter, von dem wir wissen, dass er tief in
   * darstellung.ts liegt (Zeile ~500, in einem @if hinter zwei Reitern). Faellt
   * die Erhebung darauf herein, faellt sie auf alles herein — und genau das
   * hat sie beim ersten Anlauf getan: [class.an]="w().miniPlayer > 0" enthaelt
   * ein >, und der einfache Ausdruck [^>]* nahm den halben Aufruf als Namen
   * des Knopfes.
   */
  test('ein Schalter aus der Tiefe der Darstellungsseite ist dabei', () => {
    for (const gesucht of ['Spielt-Marke', 'Mini-Player', 'Platz beim Blättern']) {
      const treffer = eintraege.find((e) => e.text === gesucht)
      assert.ok(treffer, `„${gesucht}" fehlt im Suchbestand.`)
      assert.equal(treffer.seite, 'Darstellung')
    }
  })

  /**
   * DIE UMZUEGE VOM 03.08.2026 (G5) — und warum sie hier festgehalten werden.
   *
   * „Doppelte zusammenfassen" und „Ganze Diskografie" standen bis dahin auf
   * der Darstellungsseite und stehen jetzt unter Medien; die Wahl der
   * Oberflaeche kam neu hinzu und steht bei der Darstellung. Genau dieser
   * Test hat den ersten der beiden Umzuege gemeldet, bevor irgendein Mensch
   * hinsah — das ist sein Zweck. Er steht hier nicht als Denkmal, sondern
   * damit ein spaeteres Zurueckrutschen wieder auffaellt.
   */
  test('die verschobenen Schalter stehen auf ihrer neuen Seite', () => {
    for (const [gesucht, seite] of [
      ['Doppelte zusammenfassen', 'Medien'],
      ['Ganze Diskografie', 'Medien'],
    ]) {
      const treffer = eintraege.find((e) => e.text === gesucht)
      assert.ok(treffer, `„${gesucht}" fehlt im Suchbestand.`)
      assert.equal(treffer.seite, seite, `„${gesucht}" steht auf der falschen Seite`)
    }
  })

  /**
   * Die neue Seite muss auffindbar sein — sonst hat der Umzug der
   * Anbieter-Felder sie nur versteckt.
   */
  test('die Streaming-Dienste sind als Seite auffindbar', () => {
    const seite = eintraege.find((e) => e.text === 'Streaming-Dienste')
    assert.ok(seite, 'Die Seite „Streaming-Dienste" fehlt im Suchbestand.')
    assert.equal(seite.weg, '/streaming')
  })

  /**
   * DIE UMZUEGE VOM SPAETEN 03.08.2026 — die vier Stellen, die der grosse
   * Umbau nicht erwischt hatte.
   *
   * Der Schlummer-Timer stand unter „System", obwohl er dasselbe tut wie die
   * Kinderzeit: einem Kind eine Zeitgrenze setzen. „Medien neu einlesen"
   * stand ebenfalls dort und beantwortet „was ist da". Beide Umzuege haben
   * genau diesen Bestand veraendert; hier steht ihr Ergebnis, damit ein
   * Zurueckrutschen auffaellt.
   */
  test('der Schlummer-Timer steht bei der Kinderzeit, nicht mehr unter System', () => {
    const t = eintraege.find((e) => e.text === 'Schlummer-Timer')
    assert.ok(t, '„Schlummer-Timer" fehlt im Suchbestand.')
    // Die Seite selbst heisst in der Navigation inzwischen „Profile" (die
    // Kinderzeit ist dort ein Abschnitt, der Weg blieb /kinderzeit). Die
    // Aussage dieses Tests ist die VERORTUNG — nicht mehr unter „System" —
    // und die gilt unveraendert; nur der Seitenname ist gewandert (29.08.2026).
    assert.equal(t.seite, 'Profile')
    assert.equal(t.weg, '/kinderzeit')
    for (const knopf of ['Timer starten', 'Timer abbrechen']) {
      assert.equal(eintraege.find((e) => e.text === knopf)?.seite, 'Profile', knopf)
    }
  })

  /**
   * DIE AKTIONEN DER SYSTEMSEITE — der Befund vom 03.08.2026.
   *
   * Gemeldet wurde: die Suche findet „Box neu starten", „Box ausschalten",
   * „Bildschirm-Drehung zuruecknehmen", „Oberflaeche neu laden" und „Medien
   * neu einlesen" nicht. Die Ursache war EINE (Interpolationen fallen aus der
   * Erhebung), die Behebung sind ZWEI — und die Trennung gehoert festgehalten,
   * sonst sucht der naechste an der falschen Stelle:
   *
   *   * VIER stehen in AKTIONEN (backend-api/src/system.ts) und kommen ueber
   *     GET /api/system. Sie stehen bewusst NICHT in dieser Datei: sie
   *     gehoeren der Box, nicht dem Bau. Die Suche holt sie selbst
   *     (aktionenHolen in suche.ts, geprueft in suche.spec.ts).
   *   * EINE — „Oberflaeche neu laden" — ist gar keine Aktion der Tabelle
   *     (sie fuehrt keinen Befehl aus, sie zaehlt einen Zaehler hoch). Ihr
   *     fester Name steht in der Vorlage, aber in einem
   *     <div class="titel">; den las die Erhebung nicht. Jetzt schon.
   */
  test('„Oberflaeche neu laden" steht im Bestand — der Tat-Titel wird gelesen', () => {
    const t = eintraege.find((e) => e.text === 'Oberfläche neu laden')
    assert.ok(t, '„Oberfläche neu laden" fehlt im Suchbestand.')
    assert.equal(t.seite, 'System')
    assert.equal(t.weg, '/system')
  })

  test('die vier Aktionen der Tabelle stehen NICHT im erhobenen Bestand', () => {
    // Kein Versehen, sondern die Aufteilung: stuenden sie hier, gaebe es sie
    // zweimal — einmal aus dem Bau und einmal von der Box. Zwei Wahrheiten
    // ueber denselben Knopf laufen beim ersten Umbenennen auseinander.
    for (const titel of [
      'Box neu starten',
      'Box ausschalten',
      'Bildschirm-Drehung zurücknehmen',
      'Medien neu einlesen',
    ]) {
      assert.equal(
        eintraege.some((e) => e.text === titel),
        false,
        `„${titel}" steht im erhobenen Bestand — die Suche holt ihn aber schon bei /api/system.`,
      )
    }
  })

  /**
   * DIE ABSCHNITTE, auf die suche.ts die geholten Aktionen setzt.
   *
   * `AKTION_ORT` in suche.ts nennt zwei Ueberschriften beim Namen („Neu
   * einlesen", „Box aus- und einschalten"). Das ist die einzige Stelle, an der
   * die Suche etwas ueber eine Vorlage BEHAUPTET. Wird die h2 umbenannt,
   * sammelt dieses Werkzeug den neuen Namen ein und dieser Test wird rot,
   * bevor die Suche still den falschen Ort nennt.
   *
   * (Die Gegenprobe — dass suche.ts wirklich diese Namen verwendet — steht in
   * suche.spec.ts, wo AKTION_ORT importierbar ist statt aus Text geraten.)
   */
  test('die Abschnitte, auf die die Aktionen zeigen, gibt es wirklich', () => {
    for (const [seite, abschnitt] of [
      ['Medien', 'Neu einlesen'],
      ['System', 'Box aus- und einschalten'],
    ]) {
      assert.ok(
        eintraege.some((e) => e.seite === seite && e.text === abschnitt && e.bereich === ''),
        `Auf „${seite}" gibt es keine Ueberschrift „${abschnitt}" mehr — AKTION_ORT in suche.ts zeigt ins Leere.`,
      )
    }
  })

  /**
   * UNTERSEITEN — die eigentliche Neuerung dieses Laufs.
   *
   * „Doppelte" und „Interpreten" sind aus der Kopfleiste verschwunden und
   * haengen unter „Medien". Ohne die Erhebung ueber den Verweis waeren ihre
   * dreissig Eintraege LAUTLOS aus der Suche gefallen — nichts waere kaputt,
   * man faende sie nur nicht mehr. Genau davor schuetzt dieser Bestand.
   */
  describe('Unterseiten', () => {
    const unterseiten = unterseitenLesen()

    test('Doppelte und Interpreten haengen genau an einer Elternseite', () => {
      const gefunden = unterseiten
        .filter((u) => u.eltern.length === 1)
        .map((u) => `${u.eltern[0]} › ${u.name} (${u.weg})`)
        .sort()
      assert.deepEqual(gefunden, ['Medien › Doppelte (/verschmelzung)', 'Medien › Interpreten (/interpreten)'])
    })

    test('ihre Eintraege sind trotzdem im Bestand — und nennen den Weg', () => {
      for (const [text, weg] of [
        ['Abgleichen', '/verschmelzung'],
        ['Freigeschaltet', '/interpreten'],
      ]) {
        const t = eintraege.find((e) => e.text === text)
        assert.ok(t, `„${text}" fehlt im Suchbestand.`)
        assert.equal(t.weg, weg)
        assert.equal(t.eltern, 'Medien', `„${text}" nennt seine Elternseite nicht.`)
      }
    })

    test('die alten Wege sind unveraendert — kein Lesezeichen zerbricht', () => {
      // Der Umzug hat die Bedienung verschoben, nicht die Adresse. Waere ein
      // Pfad mitgewandert, liefe jedes gesetzte Lesezeichen ins Leere.
      for (const weg of ['/verschmelzung', '/interpreten']) {
        assert.ok(
          eintraege.some((e) => e.weg === weg && e.bereich === 'Seite'),
          `Der Weg ${weg} fuehrt nicht mehr auf eine Seite des Bestands.`,
        )
      }
    })

    test('eine Seite in der Kopfleiste ist NIE zugleich Unterseite', () => {
      const leiste = new Set(kopfleiseLesen().map((k) => k.weg))
      for (const u of unterseiten) assert.equal(leiste.has(u.weg), false, u.weg)
    })
  })

  test('kein Eintrag traegt noch Auszeichnung oder Platzhalter', () => {
    for (const e of eintraege) {
      assert.ok(!/[<>]|\{\{|@if|@for|@else/.test(e.text), `unsauber erhoben: ${e.text}`)
      assert.equal(e.text, e.text.trim())
    }
  })
})

describe('Ein NEUER Schalter wird gefunden', () => {
  /**
   * Die eigentliche Zusage dieser Datei.
   *
   * Oben wird geprueft, dass die abgelegte Liste zu den heutigen Seiten passt.
   * Das genuegt aber nicht: es koennte ja sein, dass die Erhebung eine ganze
   * Bauart von Knopf uebersieht — dann passt die Liste zu den Seiten und ist
   * trotzdem unvollstaendig. Hier steht deshalb eine erfundene Seite mit den
   * Bauarten, die im Bestand vorkommen, und jede muss auftauchen.
   */
  const VORLAGE = `
    <h1>Erfunden</h1>
    <h2>Der neue Abschnitt</h2>
    <div class="wahl">
      <button type="button" [class.an]="w().neuerSchalter > 0" (click)="setz({ neuerSchalter: 1 })">
        Ganz neuer Schalter {{ w().neuerSchalter ? 'an' : 'aus' }}
      </button>
    </div>
    <div class="stufe">
      <span class="was">Neue Stufe</span>
      <button type="button">@if (a()) { an } @else { aus }</button>
    </div>
    <!-- Eine TAT-KARTE: der feste Name steht im div, der Knopf darunter traegt
         nur eine Interpolation. Genau die Bauart, mit der „Oberflaeche neu
         laden" am 03.08.2026 aus dem Bestand fiel. -->
    <div class="tat">
      <div class="titel">Neue Tat</div>
      <div class="hinweis">Was sie tut.</div>
      <button type="button">{{ laeuft() ? 'Angefordert…' : 'Neue Tat' }}</button>
    </div>
    <div class="karte">
      <b>Neuer Kartentitel</b>
      <p>Ein Satz mit <b>fett</b> darin gehoert nicht hinein.</p>
      <label class="schalter"><input type="checkbox" /> Neue Beschriftung</label>
      <select><option value="x">Neuer Auswahleintrag</option></select>
      <input type="search" placeholder="Neues Suchfeld" />
    </div>
  `

  const eintraege = vorlageErheben(VORLAGE, 'Erfunden', '/erfunden')
  const texte = eintraege.map((e) => e.text)

  test('alle Bauarten kommen an', () => {
    assert.deepEqual(texte, [
      'Der neue Abschnitt',
      'Ganz neuer Schalter',
      'Neue Stufe',
      'Neue Tat',
      'Neuer Kartentitel',
      'Neue Beschriftung',
      'Neuer Auswahleintrag',
      'Neues Suchfeld',
    ])
  })

  test('der Abschnitt steht am Eintrag', () => {
    assert.equal(eintraege.find((e) => e.text === 'Ganz neuer Schalter').bereich, 'Der neue Abschnitt')
  })

  test('Hervorhebung im Fliesstext ist keine Beschriftung', () => {
    assert.ok(!texte.includes('fett'))
  })

  test('ein Knopf ohne festen Text faellt heraus statt Unsinn zu liefern', () => {
    assert.ok(!texte.some((t) => t.includes('@') || t.includes('{')))
  })
})
