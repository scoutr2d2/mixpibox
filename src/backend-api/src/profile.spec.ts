import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ABLAGE_AUSWAHL,
  ABLAGE_GESPIELT,
  ABLAGE_LISTEN,
  ABLAGE_RESUME,
  ABLAGE_VERBRAUCH,
  ablageName,
  ablageOrt,
  aktivNormalisieren,
  ABLAGE_VIDEOFREIGABEN,
  BEREICH_ABLAGEN,
  BEREICH_ORDNER,
  bereichPfad,
  FIGUR_ORDNER,
  figurPruefen,
  figurenBewahren,
  GAST,
  gastProfil,
  kennungPruefen,
  MERKEN_MAX,
  MERKEN_MIN,
  merkenBewahren,
  merkenFuer,
  merkenNormalisieren,
  merkenPruefen,
  merkenVerlust,
  OHNE_FIGUR,
  PROFILE_MAX,
  passwortBewahren,
  passwortNormalisieren,
  profilFuerAntwort,
  profileNormalisieren,
  profilNormalisieren,
  speicherName,
  standFuerAntwort,
  standNormalisieren,
  verschwundeneKennungen,
} from './profile'

describe('Kennungen', () => {
  it('nimmt, was in einen Dateinamen passt', () => {
    for (const k of ['gast', 'liam', 'kalea', 'kind-2', 'a', '0']) {
      assert.equal(kennungPruefen(k), true, k)
    }
  })

  it('weist alles ab, was zu einem Pfad werden koennte', () => {
    // DIE KENNUNG WANDERT IN DATEINAMEN (gespielt.<kennung>.json) und in
    // Speicherschluessel. Ein Kind namens „../../etc" darf keinen Pfad ergeben.
    for (const k of ['../../etc', 'a/b', 'a\\b', '.', '..', 'a.b', 'Liam', 'mit leer', '', 'a'.repeat(25)]) {
      assert.equal(kennungPruefen(k), false, JSON.stringify(k))
    }
  })

  it('ein Punkt ist verboten, weil er zwei Kennungen auf eine Datei abbildete', () => {
    // 'a.gast' + 'gespielt.json' ergaebe 'gespielt.a.gast.json' — dasselbe wie
    // eine Kennung 'a' unter einer anderen Basis. Deshalb gar nicht erst zu.
    assert.equal(kennungPruefen('a.gast'), false)
  })

  it('nimmt nur Zeichenketten', () => {
    for (const k of [null, undefined, 42, {}, ['gast']]) assert.equal(kennungPruefen(k), false)
  })
})

describe('Figuren', () => {
  it('nimmt die Dateinamen, die im Figurenordner liegen duerfen', () => {
    assert.equal(figurPruefen('mixpi-hoert.png'), true)
    assert.equal(figurPruefen('mixpi-faehrt-rad.png'), true)
    assert.equal(figurPruefen('brille.png'), true)
  })

  it('laesst niemanden aus dem Bilderverzeichnis heraus', () => {
    for (const f of ['../geheim.png', 'a/b.png', 'a\\b.png', '%2e%2e/x.png', '..', '.hidden', '/etc/passwd', '']) {
      assert.equal(figurPruefen(f), false, JSON.stringify(f))
    }
  })

  it('ohne .png faellt es durch — sonst steht ein leeres Bildzeichen da', () => {
    // BIS 05.08.2026 GING DAS DURCH. `mixpi-brille` ohne Endung ist ein Name,
    // den niemandem etwas ansieht: gueltig geprueft, im Browser ein Loch.
    for (const f of ['mixpi-brille', 'mixpi-brille.', 'mixpi-brille.jpg', 'mixpi.png.txt', 'mixpi-brille.PNG']) {
      assert.equal(figurPruefen(f), false, JSON.stringify(f))
    }
  })

  it('kein SVG — das waere ausfuehrbarer Inhalt aus demselben Ursprung', () => {
    assert.equal(figurPruefen('boese.svg'), false)
  })

  it('gross geschrieben faellt durch, und das ist die Stelle zum Nachlesen', () => {
    // Der Betreiber legt die Bilder von Hand hinein. `Brille.PNG` still zu
    // uebergehen waere die schlechteste Antwort — deshalb nennt
    // GET /api/figuren die uebergangenen Namen ausdruecklich (server.ts).
    assert.equal(figurPruefen('Brille.png'), false)
  })

  it('nicht laenger als ein Dateiname sein darf', () => {
    assert.equal(figurPruefen(`${'a'.repeat(60)}.png`), true)
    assert.equal(figurPruefen(`${'a'.repeat(61)}.png`), false)
  })

  it('der Ordner steht an EINER Stelle — Server und Oberflaeche lesen dieselbe', () => {
    assert.equal(FIGUR_ORDNER, 'bilder/figuren')
  })

  it('OHNE_FIGUR ist keine Figur — leer heisst „noch keines ausgesucht"', () => {
    // Das ist der Unterschied zu „kaputt": die Oberflaeche zeichnet dafuer
    // eine Silhouette und nicht etwa ein zweites Maskottchen.
    assert.equal(figurPruefen(OHNE_FIGUR), false)
    assert.equal(gastProfil().figur, OHNE_FIGUR)
  })
})

describe('Profile normalisieren', () => {
  it('aus gar nichts wird der Gast — eine kaputte Datei sperrt niemanden aus', () => {
    // DIESELBE HALTUNG WIE regelnNormalisieren in kinderzeit.ts. Ein leeres
    // oder unlesbares profile.json darf NIEMALS dazu fuehren, dass nichts mehr
    // startet.
    for (const roh of [null, undefined, 0, '', 'kaputt', {}, [], { profile: 'nein' }]) {
      const p = profileNormalisieren(roh)
      assert.equal(p.length, 1, JSON.stringify(roh))
      assert.equal(p[0].kennung, GAST)
    }
  })

  it('der Gast steht immer vorn und laesst sich nicht wegloeschen', () => {
    const p = profileNormalisieren([{ kennung: 'liam', name: 'Liam' }])
    assert.equal(p[0].kennung, GAST)
    assert.equal(p[1].kennung, 'liam')
  })

  it('der Gast behaelt seine Figur — aber NIE einen fremden Namen (E39/S5)', () => {
    // BIS ZUM 16.08.2026 durfte der Gast umbenannt werden — und genau ein
    // umbenannter Gast hat den E39-Bedarf ausgeloest: er hiess „Papa", sah
    // aus wie ein normales Konto und verhielt sich nicht so (kein Schloss
    // moeglich, und der Grund stand nirgends). Betreiber: „gast kann nicht
    // umbennant werden".
    const p = profileNormalisieren([{ kennung: GAST, name: 'Papa', figur: 'mixpi-schlaeft.png' }])
    assert.equal(p.length, 1)
    assert.equal(p[0].name, 'Gast', 'der Name steht nicht zur Wahl')
    assert.equal(p[0].figur, 'mixpi-schlaeft.png', 'die Figur sehr wohl')
  })

  it('der Gastschalter: nur ein ausdrueckliches false schaltet ab (E39/S1)', () => {
    // Ein Tippfehler in der Datei darf den Rueckfall der Box nicht verstecken.
    assert.equal(standNormalisieren({ profile: [], gastAktiv: false }).gastAktiv, false)
    assert.equal(standNormalisieren({ profile: [], gastAktiv: 'false' }).gastAktiv, undefined)
    assert.equal(standNormalisieren({ profile: [] }).gastAktiv, undefined)
    // Und die Antwort sagt es AUSDRUECKLICH, damit Oberflaechen === false pruefen.
    assert.equal(standFuerAntwort(standNormalisieren({ profile: [] })).gastAktiv, true)
    assert.equal(standFuerAntwort(standNormalisieren({ profile: [], gastAktiv: false })).gastAktiv, false)
  })

  it('die Gastfrist uebersteht das Speichern — Unsinn faellt weg (E39/S4)', () => {
    const bis = Date.now() + 3_600_000
    assert.equal(standNormalisieren({ profile: [], gastBis: bis }).gastBis, bis)
    assert.equal(standNormalisieren({ profile: [], gastBis: 'morgen' }).gastBis, undefined)
    assert.equal(standNormalisieren({ profile: [], gastBis: -5 }).gastBis, undefined)
  })

  it('wirft Eintraege ohne brauchbare Kennung WEG, statt eine zu erfinden', () => {
    // An der Kennung haengen Dateien. Eine geratene hiesse, den Verlauf eines
    // Kindes unter einem Namen abzulegen, den niemand wiederfindet.
    const p = profileNormalisieren([{ name: 'ohne Kennung' }, { kennung: '../weg' }, { kennung: 'liam' }])
    assert.deepEqual(
      p.map((x) => x.kennung),
      [GAST, 'liam'],
    )
  })

  it('doppelte Kennungen zaehlen einmal', () => {
    const p = profileNormalisieren([{ kennung: 'liam' }, { kennung: 'liam', name: 'Zweiter' }])
    assert.equal(p.length, 2)
    assert.equal(p[1].name, 'liam')
  })

  it('deckelt die Anzahl — gegen eine kaputte oder boesartige Eingabe', () => {
    const viele = Array.from({ length: 50 }, (_, i) => ({ kennung: `k${i}` }))
    assert.equal(profileNormalisieren(viele).length, PROFILE_MAX)
  })

  it('eine unbrauchbare Figur wird zu „kein Bild", nicht zu einem Fehler', () => {
    for (const f of ['../../weg.png', 'mixpi-brille', 42, null]) {
      assert.equal(profilNormalisieren({ kennung: 'liam', figur: f })?.figur, OHNE_FIGUR, JSON.stringify(f))
    }
  })

  it('ohne Namen steht die Kennung da — besser als eine leere Kachel', () => {
    assert.equal(profilNormalisieren({ kennung: 'liam' })?.name, 'liam')
  })

  it('liest die Liste auch aus dem ganzen Stand heraus', () => {
    const p = profileNormalisieren({ profile: [{ kennung: 'liam' }], aktiv: 'liam' })
    assert.equal(p.length, 2)
  })
})

describe('Wer ist dran', () => {
  it('ohne Auswahl der Gast — es gibt keinen Zustand „niemand"', () => {
    const p = profileNormalisieren([{ kennung: 'liam' }])
    assert.equal(aktivNormalisieren(undefined, p), GAST)
    assert.equal(aktivNormalisieren('', p), GAST)
  })

  it('ein geloeschtes Profil faellt auf den Gast zurueck, Musik geht weiter', () => {
    const p = profileNormalisieren([{ kennung: 'liam' }])
    assert.equal(aktivNormalisieren('kalea', p), GAST)
  })

  it('der ganze Stand kommt aus einer kaputten Datei heil heraus', () => {
    const s = standNormalisieren({ profile: [{ kennung: 'liam' }], aktiv: 'liam' })
    assert.deepEqual(
      s.profile.map((x) => x.kennung),
      [GAST, 'liam'],
    )
    assert.equal(s.aktiv, 'liam')
    assert.equal(standNormalisieren('voelliger Unsinn').aktiv, GAST)
  })
})

describe('Namen von Ablagen und Speicherschluesseln', () => {
  it('die Formel ist stabil — beide Oberflaechen bauen denselben Namen', () => {
    assert.equal(speicherName('gast', 'neu_zuletzt_v1'), 'mupibox_p_gast_neu_zuletzt_v1')
    assert.equal(speicherName('liam', 'neu_zuletzt_v1'), 'mupibox_p_liam_neu_zuletzt_v1')
  })

  it('eine unbrauchbare Kennung landet beim Gast statt in einem Pfad', () => {
    assert.equal(speicherName('../../etc', 'x'), 'mupibox_p_gast_x')
    assert.equal(ablageName('gespielt.json', '../../etc'), 'gespielt.gast.json')
  })

  it('die Kennung steht VOR der Endung, damit *.json weiter alles trifft', () => {
    assert.equal(ablageName('gespielt.json', 'gast'), 'gespielt.gast.json')
    assert.equal(
      ablageName('/etc/mupibox/kinderzeit-verbrauch.json', 'liam'),
      '/etc/mupibox/kinderzeit-verbrauch.liam.json',
    )
  })

  it('ein Pfad ohne Endung bekommt sie hinten angehaengt', () => {
    assert.equal(ablageName('verlauf', 'gast'), 'verlauf.gast')
  })

  it('zweimal angewandt kommt NICHT dasselbe heraus — der Aufrufer darf nicht doppeln', () => {
    // Notiert, weil die Uebernahme idempotent sein muss: sie prueft das ZIEL,
    // nicht den Namen. ablageName selbst haengt jedes Mal eine Kennung an.
    assert.equal(ablageName(ablageName('gespielt.json', 'gast'), 'gast'), 'gespielt.gast.gast.json')
  })
})

describe('Der Bereich — ein Ordner je Profil', () => {
  it('legt den Bereich unter das Konfigurationsverzeichnis', () => {
    assert.equal(bereichPfad('./server/config', 'gast'), './server/config/profile/gast')
    assert.equal(bereichPfad('/home/dietpi/x/server/config', 'liam'), '/home/dietpi/x/server/config/profile/liam')
  })

  it('aus KEINEM Verzeichnis wird kein absoluter Pfad', () => {
    // `/profile/gast` zeigte ins Wurzelverzeichnis. Der Fall tritt auf, sobald
    // jemand ablageOrt('gespielt.json', …) aufruft — also im Test zuerst.
    assert.equal(bereichPfad('', 'gast'), 'profile/gast')
    assert.equal(ablageOrt('gespielt.json', 'gast'), 'profile/gast/gespielt.json')
  })

  it('ein Schraegstrich am Ende erzeugt keinen doppelten', () => {
    assert.equal(bereichPfad('./server/config/', 'gast'), './server/config/profile/gast')
  })

  it('eine unbrauchbare Kennung landet beim Gast statt in einem fremden Verzeichnis', () => {
    // Das Muster laesst sie ohnehin nicht durch; hier steht die zweite Naht.
    assert.equal(bereichPfad('/x', '../../etc'), '/x/profile/gast')
    assert.equal(ablageOrt('/x/gespielt.json', 'a/b'), '/x/profile/gast/gespielt.json')
    assert.equal(ablageOrt('/x/gespielt.json', ''), '/x/profile/gast/gespielt.json')
  })

  it('der DATEINAME bleibt, was er war — nur eine Etage tiefer', () => {
    assert.equal(ablageOrt('./server/config/gespielt.json', 'liam'), './server/config/profile/liam/gespielt.json')
    assert.equal(
      ablageOrt('./server/config/kinderzeit-verbrauch.json', 'gast'),
      './server/config/profile/gast/kinderzeit-verbrauch.json',
    )
  })

  it('zweimal angewandt schachtelt NICHT — sonst zoege der Umzug bei jedem Start weiter', () => {
    // Anders als ablageName ist ablageOrt nicht auf sich selbst anwendbar;
    // notiert, damit niemand es doch tut.
    assert.notEqual(ablageOrt(ablageOrt('/x/a.json', 'gast'), 'gast'), ablageOrt('/x/a.json', 'gast'))
  })

  it('die Liste der Bereichs-Ablagen ist genau das, was umzieht', () => {
    // Sie treibt Umzug, Anlegen und die Deckungspruefung der Sicherung. Eine
    // Aenderung hier ist eine Aenderung an allen dreien — deshalb steht sie
    // ausgeschrieben da, statt in einem Test „irgendwie" geprueft zu werden.
    //
    // `darstellung.json` STEHT SEIT DEM 15.08.2026 DABEI — und ist die eine,
    // die NICHT umzieht (OHNE_UMZUG in server.ts): die box-weite Datei
    // traegt die Themen und den Rueckfall. Der Titel dieses Tests stimmt
    // seither nur noch fuer fuenf der sechs; die Ausnahme ist benannt und
    // in aussehen.integration.spec.ts gemessen.
    assert.deepEqual(
      [...BEREICH_ABLAGEN],
      [
        'gespielt.json',
        'kinderzeit-verbrauch.json',
        'listen.json',
        'resume.json',
        'auswahl.json',
        'darstellung.json',
        'videofreigaben.json',
      ],
    )
    assert.equal(ABLAGE_GESPIELT, 'gespielt.json')
    assert.equal(ABLAGE_VERBRAUCH, 'kinderzeit-verbrauch.json')
    assert.equal(ABLAGE_LISTEN, 'listen.json')
    assert.equal(ABLAGE_RESUME, 'resume.json')
    // `auswahl.json` ist seit dem 07.08.2026 dabei und die erste Ablage, die
    // KEIN Verlauf ist, sondern eine Einstellung: was dieses Kind von der
    // Bibliothek sehen darf. Sie steht hier drin, damit `bereicheHerrichten`,
    // das Beiseitelegen beim Loeschen und die Deckung der Sicherung sie ohne
    // Zutun mitnehmen — daneben gestellt waere sie die naechste Erbschaft.
    assert.equal(ABLAGE_AUSWAHL, 'auswahl.json')
    // `videofreigaben.json` ist seit dem 20.09.2026 dabei: welche Videos aus
    // der Mediathek dieses Kind noch anschauen darf, und wie oft. Eine
    // BELOHNUNG haengt an einem Kind — bliebe sie box-weit, verbrauchte das
    // eine Geschwisterkind, was das andere sich verdient hat.
    assert.equal(ABLAGE_VIDEOFREIGABEN, 'videofreigaben.json')
    assert.equal(BEREICH_ORDNER, 'profile')
  })

  it('kinderzeit.json zieht NICHT mit — mit Grund', () => {
    // kinderzeit.json ist der Regelsatz {standard, je} und gehoert allen
    // zusammen; je Bereich abgelegt faende `regelnFuer()` die Hausregel nicht
    // mehr. „Zeitbudget je Kind" steckt IM Satz, nicht im Ordner.
    assert.equal(BEREICH_ABLAGEN.includes('kinderzeit.json' as never), false)
  })

  it('resume.json zieht seit E18 Stufe 3 MIT — und die Bruecke bleibt am alten Ort', () => {
    // Der Umzug allein genuegte hier nicht: an resume.json haengen vier
    // root-Skripte, die ihn nie lernen werden (jedes Update von upstream
    // tauscht sie zurueck). Am alten Ort steht deshalb ein VERWEIS auf den
    // Bereich des aktiven Profils — gelegt und wiederhergestellt in server.ts
    // (`resumeBrueckeRichten`). Diese Liste sagt nur: der BESTAND liegt jetzt
    // im Bereich, und die Sicherung muss ihn dort einsammeln.
    assert.equal(BEREICH_ABLAGEN.includes(ABLAGE_RESUME as never), true)
    assert.equal(ablageOrt('./server/config/resume.json', 'kalea'), './server/config/profile/kalea/resume.json')
  })
})

describe('Was eine Verwaltung NICHT nebenbei loeschen darf', () => {
  const alt = [
    { kennung: 'gast', name: 'Gast', figur: '', angelegt: 0 },
    { kennung: 'liam', name: 'Liam', figur: 'mixpi-sucht.png', angelegt: 1 },
    { kennung: 'kalea', name: 'Kalea', figur: 'mixpi-hoert.png', angelegt: 2 },
  ]

  it('ein Eintrag ohne Feld `figur` erbt die abgelegte Figur', () => {
    // DAS IST DER FALL, UM DEN ES GEHT: Die Seite „Kinder" benennt Liam um und
    // sagt ueber Bilder gar nichts. Kaeme hier '' heraus, waere die Wahl beider
    // Kinder weg — und zwar genau dann, wenn der Figurenordner beim Lesen
    // gerade nicht da war und `GET /api/profile` deshalb ueberall '' meldete.
    const aus = figurenBewahren(
      { profile: [{ kennung: 'liam', name: 'Liam Junior' }, { kennung: 'kalea', name: 'Kalea' }] },
      alt,
    ) as Record<string, unknown>[]
    assert.equal(aus[0].figur, 'mixpi-sucht.png')
    assert.equal(aus[0].name, 'Liam Junior')
    assert.equal(aus[1].figur, 'mixpi-hoert.png')
  })

  it('aber ein ausdrueckliches `figur: ""` setzt sie auf leer', () => {
    // „Nichts dazu gesagt" und „weg damit" muessen unterscheidbar bleiben,
    // sonst gaebe es keinen Weg zurueck zum Standardbild.
    const aus = figurenBewahren({ profile: [{ kennung: 'liam', name: 'Liam', figur: '' }] }, alt) as Record<
      string,
      unknown
    >[]
    assert.equal(aus[0].figur, '')
  })

  it('ein NEUES Kind erbt nichts', () => {
    const aus = figurenBewahren({ profile: [{ kennung: 'mila', name: 'Mila' }] }, alt) as Record<string, unknown>[]
    assert.equal(Object.hasOwn(aus[0], 'figur'), false)
    assert.equal(profilNormalisieren(aus[0])?.figur, OHNE_FIGUR)
  })

  it('nimmt die blanke Liste genauso wie den ganzen Stand', () => {
    const aus = figurenBewahren([{ kennung: 'kalea', name: 'Kalea' }], alt) as Record<string, unknown>[]
    assert.equal(aus[0].figur, 'mixpi-hoert.png')
  })

  it('Unsinn bleibt Unsinn — hier wird nichts geradegebogen', () => {
    // Das Zurechtbiegen ist die Aufgabe von `profileNormalisieren`. Wer hier
    // schon rettete, haette zwei Stellen mit derselben Zustaendigkeit.
    assert.deepEqual(figurenBewahren(null, alt), [])
    assert.deepEqual(figurenBewahren({ profile: 'nein' }, alt), [])
    assert.deepEqual(figurenBewahren([null, 7], alt), [null, 7])
  })
})

describe('Wessen Bereich beiseitegelegt wird', () => {
  const alt = [
    { kennung: 'gast', name: 'Gast', figur: '', angelegt: 0 },
    { kennung: 'liam', name: 'Liam', figur: '', angelegt: 1 },
    { kennung: 'kalea', name: 'Kalea', figur: '', angelegt: 2 },
  ]

  it('nennt genau die Kennungen, die verschwinden', () => {
    assert.deepEqual(verschwundeneKennungen(alt, [alt[0], alt[2]]), ['liam'])
    assert.deepEqual(verschwundeneKennungen(alt, [alt[0]]), ['liam', 'kalea'])
    assert.deepEqual(verschwundeneKennungen(alt, alt), [])
  })

  it('der GAST steht da nie drin — auch nicht, wenn jemand ihn wegzulassen versucht', () => {
    // `profileNormalisieren` stellt ihn ohnehin immer voran; diese Zeile ist
    // der Riegel dahinter, weil an dem Rueckgabewert ein Umbenennen auf der
    // Platte haengt.
    assert.deepEqual(verschwundeneKennungen(alt, []), ['liam', 'kalea'])
  })

  it('ein umbenanntes Kind verschwindet NICHT — die Kennung bleibt', () => {
    assert.deepEqual(verschwundeneKennungen(alt, [alt[0], { ...alt[1], name: 'Liam der Zweite' }, alt[2]]), [])
  })
})

// ── Wie viele Stellen sich die Box je Kind merkt (07.08.2026) ────────────────
//
// DIE FRAGE DAHINTER (Betreiber): „naja es sollen ja in allen profilen 20 geben
// oder? … besser waere pro profil :)". Bis dahin war `mupibox.resume` EINE Zahl
// fuer die Box, die zufaellig auf jedes Kind wirkte. Jetzt gehoert sie dem Kind
// wie sein Name und seine Figur — und liegt an derselben Stelle.

describe('Die Merktiefe je Kind: was eine Zahl sein darf', () => {
  it('nimmt jede ganze Zahl in den Grenzen des Box-Feldes', () => {
    for (const n of [MERKEN_MIN, 0, 1, 9, 20, 98, MERKEN_MAX]) {
      assert.equal(merkenPruefen(n), true, String(n))
    }
  })

  it('weist ab, was ein Vertipper sein koennte — und rundet NICHT', () => {
    // 5,5 gemerkte Stellen gibt es nicht. Runden hiesse, sich fuer eine von
    // zwei moeglichen Absichten zu entscheiden, ohne zu fragen.
    for (const u of [
      5.5,
      -1,
      100,
      1e9,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '5',
      'zehn',
      '',
      null,
      undefined,
      true,
      [],
      {},
      [5],
    ]) {
      assert.equal(merkenPruefen(u), false, JSON.stringify(u) ?? String(u))
    }
  })

  it('beim LESEN wird dasselbe still zu „keine eigene Zahl"', () => {
    // Eine halbe oder mutwillig kaputte profile.json darf nicht dazu fuehren,
    // dass ein Kind nichts mehr merkt. Was unlesbar ist, faellt auf die
    // Box-Zahl zurueck — also auf das Verhalten von vorher.
    for (const u of [5.5, -1, 100, 'zehn', null, undefined, true, {}]) {
      assert.equal(merkenNormalisieren(u), undefined, JSON.stringify(u) ?? String(u))
    }
    assert.equal(merkenNormalisieren(0), 0)
    assert.equal(merkenNormalisieren(99), 99)
  })

  it('`0` und „keine eigene" sind NICHT dasselbe', () => {
    // 0 heisst „gar nichts merken", nichts heisst „was die Box sagt". Wer die
    // beiden zusammenwirft, macht aus jedem Kind der Box ein stummes.
    assert.equal(merkenNormalisieren(0), 0)
    assert.equal(merkenNormalisieren(undefined), undefined)
    assert.equal(merkenFuer({ kennung: 'k', name: 'K', figur: '', angelegt: 0, merken: 0 }, 20), 0)
    assert.equal(merkenFuer({ kennung: 'k', name: 'K', figur: '', angelegt: 0 }, 20), 20)
  })
})

describe('Die Merktiefe je Kind: welche Zahl gilt', () => {
  const kind = (merken?: number) => ({
    kennung: 'kalea',
    name: 'Kalea',
    figur: '',
    angelegt: 1,
    ...(merken === undefined ? {} : { merken }),
  })

  it('die eigene Zahl schlaegt die der Box', () => {
    assert.equal(merkenFuer(kind(3), 20), 3)
    assert.equal(merkenFuer(kind(40), 20), 40)
  })

  it('OHNE eigene Zahl gilt die der Box — das ist das Verhalten von vorher', () => {
    assert.equal(merkenFuer(kind(), 20), 20)
    assert.equal(merkenFuer(kind(), 9), 9)
    assert.equal(merkenFuer(kind(), 0), 0)
  })

  it('ein Kind, das es nicht (mehr) gibt, ist kein Grund, gar nichts zu merken', () => {
    assert.equal(merkenFuer(undefined, 20), 20)
    assert.equal(merkenFuer(null, 20), 20)
  })

  it('eine kaputte EIGENE Zahl faellt auf die der Box zurueck, nicht auf 9', () => {
    // Wer die Datei von Hand fuellt, bekommt keine stille Sonderbehandlung.
    assert.equal(merkenFuer({ ...kind(), merken: -5 }, 20), 20)
    assert.equal(merkenFuer({ ...kind(), merken: 5.5 }, 20), 20)
    assert.equal(merkenFuer({ ...kind(), merken: 'zwanzig' as unknown as number }, 20), 20)
  })

  it('eine kaputte BOX-Zahl faellt auf die Vorgabe des Skripts zurueck', () => {
    assert.equal(merkenFuer(kind(), Number.NaN), 9)
    assert.equal(merkenFuer(kind(), -1), 9)
  })
})

describe('Die Merktiefe je Kind: was ein Herabsetzen kostet', () => {
  it('nennt die Zahl, die verlorenginge', () => {
    assert.equal(merkenVerlust(20, 5), 15)
    assert.equal(merkenVerlust(12, 2), 10)
    assert.equal(merkenVerlust(9, 0), 9)
  })

  it('Heraufsetzen kostet nie etwas', () => {
    assert.equal(merkenVerlust(5, 20), 0)
    assert.equal(merkenVerlust(5, 5), 0)
    assert.equal(merkenVerlust(0, 20), 0)
  })

  it('rechnet auch mit Unsinn nie einen Verlust herbei', () => {
    // Diese Zahl steht in einer Rueckfrage („du verlierst 15"). Eine erfundene
    // waere schlimmer als gar keine: wer einmal eine falsche Warnung gesehen
    // hat, klickt die naechste weg.
    assert.equal(merkenVerlust(Number.NaN, 5), 0)
    assert.equal(merkenVerlust(-3, 5), 0)
    assert.equal(merkenVerlust(10, Number.NaN), 10)
  })
})

describe('Die Merktiefe je Kind: sie darf nie still verschwinden', () => {
  const alt = [
    { kennung: 'gast', name: 'Gast', figur: '', angelegt: 0 },
    { kennung: 'kalea', name: 'Kalea', figur: 'a.png', angelegt: 1, merken: 20 },
    { kennung: 'liam', name: 'Liam', figur: '', angelegt: 2 },
  ]

  it('ein Eintrag OHNE das Feld erbt die abgelegte Zahl', () => {
    // DER FALL: die Seite „Kinder" ist aelter als dieses Feld. Sie schickt beim
    // Umbenennen genau die Felder, die sie kennt — und keines davon ist
    // `merken`. Ohne diese Regel loeschte jedes Umbenennen die Zahl.
    const aus = merkenBewahren([{ kennung: 'kalea', name: 'Kalea die Zweite' }], alt) as Record<string, unknown>[]
    assert.equal(aus[0].merken, 20)
  })

  it('ein Eintrag MIT dem Feld setzt sie — auch auf `null`', () => {
    // „nichts dazu gesagt" und „so soll es sein" muessen unterscheidbar
    // bleiben, sonst waere die Zahl unaenderbar.
    const aus = merkenBewahren(
      [
        { kennung: 'kalea', merken: 5 },
        { kennung: 'kalea', merken: null },
      ],
      alt,
    ) as Record<string, unknown>[]
    assert.equal(aus[0].merken, 5)
    assert.equal(aus[1].merken, null)
  })

  it('ein Kind ohne abgelegte Zahl bekommt auch keine angedichtet', () => {
    const aus = merkenBewahren([{ kennung: 'liam', name: 'Liam' }], alt) as Record<string, unknown>[]
    assert.equal(Object.hasOwn(aus[0], 'merken'), false)
  })

  it('nimmt die blanke Liste genauso wie den ganzen Stand', () => {
    const aus = merkenBewahren({ profile: [{ kennung: 'kalea' }] }, alt) as Record<string, unknown>[]
    assert.equal(aus[0].merken, 20)
  })

  it('Unsinn bleibt Unsinn — geradegebogen wird woanders', () => {
    assert.deepEqual(merkenBewahren(null, alt), [])
    assert.deepEqual(merkenBewahren({ profile: 'nein' }, alt), [])
    assert.deepEqual(merkenBewahren([null, 7], alt), [null, 7])
  })

  it('und ueberlebt den Weg durch profilNormalisieren', () => {
    const p = profilNormalisieren({ kennung: 'kalea', name: 'Kalea', figur: 'a.png', angelegt: 1, merken: 20 })
    assert.equal(p?.merken, 20)
    // Eine kaputte Zahl laesst das FELD WEG — sie wird nicht zu 0. Sonst
    // waere jedes Kind mit einer krummen Zahl in der Datei ab dem naechsten
    // Speichern stumm.
    const q = profilNormalisieren({ kennung: 'kalea', name: 'Kalea', figur: '', angelegt: 1, merken: -3 })
    assert.equal(Object.hasOwn(q as object, 'merken'), false)
  })

  it('ein geloeschtes Kind nimmt seine Zahl mit — sie steht in SEINEM Eintrag', () => {
    // DAS IST DER GRUND, warum die Zahl in profile.json steht und nicht in
    // einer eigenen Ablage je Kind oder in einer box-weiten Liste: es gibt
    // keine zweite Stelle, an der jemand ans Aufraeumen denken muesste.
    const nachher = profileNormalisieren(alt.filter((p) => p.kennung !== 'kalea'))
    assert.equal(
      nachher.some((p) => p.kennung === 'kalea'),
      false,
    )
    assert.equal(JSON.stringify(nachher).includes('20'), false)
  })

  it('der GAST darf eine haben — er hat einen eigenen Bestand', () => {
    // Anders als bei der AUSWAHL, wo er ausdruecklich leer ausgeht: dort geht
    // es um ein Recht (ihn einzuschraenken machte die Box fuer Gaeste
    // unbrauchbar), hier um seine eigene resume.json.
    const aus = profileNormalisieren([{ kennung: GAST, name: 'Gast', figur: '', angelegt: 0, merken: 4 }])
    assert.equal(aus[0].kennung, GAST)
    assert.equal(aus[0].merken, 4)
  })
})

/**
 * Das Profil-Passwort (14.08.2026) — vier Zusagen, jede einzeln kippbar:
 *   1. Der GAST hat NIE ein Schloss, egal wie es hereinkommt.
 *   2. Ein kaputtes Passwortfeld wird zu „kein Passwort" (sichere Richtung:
 *      das Kind kommt wieder herein, statt fuer immer davor zu stehen).
 *   3. `passwortBewahren`: nichts gesagt = Schloss bleibt; `passwort: null`
 *      ausdruecklich = Schloss weg (der Eltern-Ausweg).
 *   4. KEIN ABDRUCK NACH DRAUSSEN: `standFuerAntwort` traegt nie `hash` —
 *      das ist die Leck-Gegenprobe fuer jede Antwort des Servers.
 */
/**
 * Vorlesen je Kind (20.09.2026) — DIESELBE ZUSAGE WIE BEI `merken`:
 * kein Wert wird nicht zu `false`. Nur so ist „nie etwas eingestellt" von
 * „ausdruecklich aus" zu unterscheiden. Waere es anders, haette nach dem
 * naechsten Speichern jedes Kind der Box das Vorlesen aus, ohne dass jemand
 * es abgeschaltet haette.
 */
describe('Nachrichten vorlesen je Kind', () => {
  const ROH = { kennung: 'kalea', name: 'Kalea', figur: '', angelegt: 1 }

  it('ohne Angabe steht das Feld GAR NICHT da — und nicht auf false', () => {
    const p = profilNormalisieren(ROH)
    assert.ok(p)
    assert.equal('nachrichtenVorlesen' in p, false)
  })

  it('nimmt beide Wahrheitswerte an', () => {
    assert.equal(profilNormalisieren({ ...ROH, nachrichtenVorlesen: false })?.nachrichtenVorlesen, false)
    assert.equal(profilNormalisieren({ ...ROH, nachrichtenVorlesen: true })?.nachrichtenVorlesen, true)
  })

  it('macht aus allem anderen „nichts eingestellt", nicht aus Versehen ein Ja', () => {
    for (const unfug of ['ja', 1, 0, null, {}]) {
      const p = profilNormalisieren({ ...ROH, nachrichtenVorlesen: unfug })
      assert.equal('nachrichtenVorlesen' in (p ?? {}), false, String(unfug))
    }
  })
})

describe('Profil-Passwort', () => {
  const SCHLOSS = { art: 'zahlen', hash: '$2b$08$abcdefghijklmnopqrstuv' }

  it('liest ein gueltiges Schloss und laesst Muell zu „keines" werden', () => {
    assert.deepEqual(passwortNormalisieren(SCHLOSS), SCHLOSS)
    assert.equal(passwortNormalisieren({ art: 'zahlen', hash: '' }), undefined)
    assert.equal(passwortNormalisieren({ art: 'raten', hash: 'x' }), undefined)
    assert.equal(passwortNormalisieren('hallo'), undefined)
    assert.equal(passwortNormalisieren(null), undefined)
    assert.equal(passwortNormalisieren({ art: 'muster', hash: 'x'.repeat(201) }), undefined)
  })

  it('ein Profil traegt sein Schloss durch die Normalisierung', () => {
    const p = profilNormalisieren({ kennung: 'kalea', name: 'Kalea', passwort: SCHLOSS })
    assert.deepEqual(p?.passwort, SCHLOSS)
  })

  it('der Gast verliert jedes Schloss — auch ein hineingeschriebenes', () => {
    const liste = profileNormalisieren([
      { kennung: GAST, name: 'Wir', passwort: SCHLOSS },
      { kennung: 'kalea', name: 'Kalea', passwort: SCHLOSS },
    ])
    assert.equal(liste[0].kennung, GAST)
    assert.equal(liste[0].passwort, undefined)
    assert.deepEqual(liste[1].passwort, SCHLOSS)
  })

  it('bewahrt das Schloss, wenn die Eingabe es nicht erwaehnt', () => {
    const alt = profileNormalisieren([{ kennung: 'kalea', name: 'Kalea', passwort: SCHLOSS }])
    const roh = passwortBewahren([{ kennung: 'kalea', name: 'Kalea-Luna' }], alt)
    const neu = profileNormalisieren(roh)
    assert.deepEqual(neu.find((p) => p.kennung === 'kalea')?.passwort, SCHLOSS)
  })

  it('passwort: null entfernt das Schloss ausdruecklich — der Eltern-Ausweg', () => {
    const alt = profileNormalisieren([{ kennung: 'kalea', name: 'Kalea', passwort: SCHLOSS }])
    const roh = passwortBewahren([{ kennung: 'kalea', name: 'Kalea', passwort: null }], alt)
    const neu = profileNormalisieren(roh)
    assert.equal(neu.find((p) => p.kennung === 'kalea')?.passwort, undefined)
  })

  it('LECK-GEGENPROBE: keine Antwort traegt je einen hash', () => {
    const stand = standNormalisieren({
      profile: [{ kennung: 'kalea', name: 'Kalea', passwort: SCHLOSS }],
      aktiv: 'kalea',
    })
    const antwort = standFuerAntwort(stand)
    // Grob UND fein: nirgends im JSON das Wort hash, aber geschuetzt/art da.
    assert.ok(!JSON.stringify(antwort).includes('hash'), 'hash steht in der Antwort')
    const kalea = (antwort.profile as Record<string, unknown>[]).find((p) => p.kennung === 'kalea')
    assert.equal(kalea?.geschuetzt, true)
    assert.equal(kalea?.passwortArt, 'zahlen')
    const ohne = profilFuerAntwort(gastProfil())
    assert.equal(ohne.geschuetzt, false)
    assert.equal('passwortArt' in ohne, false)
  })
})
