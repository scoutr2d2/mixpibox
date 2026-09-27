/**
 * Die fünf Regeln aus netzlaufwerk.ts, jede an ihrem Beispiel.
 *
 * Die Beispielwerte sind die, die am 20.09.2026 mit `tools/nas-sonde.py`
 * gemessen wurden (192.168.178.199 horcht auf 445 und antwortet anonym mit
 * ACCESS_DENIED) — das Passwort ist erfunden, ein echtes hätte in einem Test
 * nichts verloren.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  automountEinheit,
  beschreibung,
  DAVFS_KONF_DATEI,
  davfsKonfSchreiben,
  davfsWert,
  EINHAENGEPUNKT_VORGABE,
  eingabeLesen,
  einheitName,
  hostForm,
  mountEinheit,
  optionen,
  SMB_FASSUNG,
  WEBDAV_ZERT_DATEI,
  WEBDAV_ZUGANG_DATEI,
  ZUGANG_DATEI,
  zugangSchreiben,
} from './netzlaufwerk'

const GUT = {
  host: '192.168.178.199',
  freigabe: 'mupibox',
  nutzer: 'mupibox',
  passwort: 'nicht-das-echte',
}

function konfig(zusatz: Record<string, unknown> = {}) {
  const p = eingabeLesen({ ...GUT, ...zusatz })
  // Kein assert.equal(p.ok, true) davor: node:assert verengt den Typ danach auf
  // `never`, und die Zeile darunter wäre für TypeScript unerreichbar.
  if (!p.ok) throw new Error(`abgelehnt, obwohl gut gemeint: ${p.fehler}`)
  return p.konfig
}

describe('eingabeLesen: die gute Eingabe', () => {
  it('nimmt sie an und baut die Quelle', () => {
    const k = konfig()
    assert.equal(k.quelle, '//192.168.178.199/mupibox')
    assert.equal(k.einhaengepunkt, EINHAENGEPUNKT_VORGABE)
    assert.equal(k.besitzer, 'dietpi')
  })

  it('hängt einen Unterpfad an und wirft die Schrägstriche weg', () => {
    assert.equal(konfig({ unterpfad: '/Musik/MuPiBox/' }).quelle, '//192.168.178.199/mupibox/Musik/MuPiBox')
  })

  it('sagt in den Hinweisen, was gesetzt wurde — wörtlich für die Oberfläche', () => {
    const h = konfig().hinweise.join(' | ')
    assert.match(h, /SMB 3\.1\.1 erzwungen/)
    assert.match(h, /hängt NICHT beim Start ein/)
    assert.match(h, new RegExp(ZUGANG_DATEI.replace(/\//g, '\\/')))
  })
})

describe('Regel 4: nichts, was die Einheit verbiegt', () => {
  for (const [was, eingabe] of [
    ['Zeilenumbruch im Freigabenamen', { freigabe: 'gut\nOptions=hart' }],
    ['Zeilenumbruch im Anmeldenamen', { nutzer: 'wer\npassword=egal' }],
    ['Zeilenumbruch im Passwort', { passwort: 'geheim\ndomain=fremd' }],
    ['Prozentzeichen im Freigabenamen', { freigabe: 'anteil%h' }],
    ['Prozentzeichen im Passwort', { passwort: '100%sicher' }],
    ['Tabulator im Unterpfad', { unterpfad: 'Musik\tmehr' }],
  ] as [string, Record<string, unknown>][]) {
    it(`lehnt ${was} ab`, () => {
      const p = eingabeLesen({ ...GUT, ...eingabe })
      assert.equal(p.ok, false)
      if (p.ok) return
      assert.match(p.fehler, /Steuerzeichen|Prozentzeichen/)
    })
  }

  it('lässt kein Komma in die Adresse (es trennte sonst Optionen)', () => {
    assert.equal(hostForm('1.2.3.4,soft'), false)
    assert.equal(eingabeLesen({ ...GUT, host: '1.2.3.4,uid=root' }).ok, false)
  })
})

describe('Regel 2: der Einhängepunkt liegt nie im Weg des Abspielens', () => {
  for (const pfad of ['/home/dietpi/MuPiBox/media', '/mnt/../home/dietpi', 'mnt/nas', '/mnt']) {
    it(`lehnt ${pfad} ab`, () => {
      assert.equal(eingabeLesen({ ...GUT, einhaengepunkt: pfad }).ok, false)
    })
  }

  it('nimmt einen zweiten Punkt unter /mnt an', () => {
    assert.equal(konfig({ einhaengepunkt: '/mnt/nas-sicherung' }).einhaengepunkt, '/mnt/nas-sicherung')
  })
})

describe('einheitName: dieselbe Regel wie systemd-escape --path', () => {
  it('macht aus /mnt/nas den Namen mnt-nas.mount', () => {
    assert.equal(einheitName('/mnt/nas'), 'mnt-nas.mount')
    assert.equal(einheitName('/mnt/nas', 'automount'), 'mnt-nas.automount')
  })

  it('schreibt den Bindestrich als Hex — sonst zeigte der Name auf einen anderen Pfad', () => {
    assert.equal(einheitName('/mnt/mein-nas'), 'mnt-mein\\x2dnas.mount')
    assert.notEqual(einheitName('/mnt/mein-nas'), einheitName('/mnt/mein/nas'))
  })
})

/**
 * Die Einheit OHNE ihre Kommentarzeilen. Ohne diesen Schritt prüfte der Test
 * unten den erklärenden Kommentar mit, der das Wort `[Install]` absichtlich
 * nennt — und wäre rot, obwohl die Regel hält
 * ([[kommentar-und-kompilat-sind-keine-gegenstelle]]).
 */
function ohneKommentar(text: string): string {
  return text
    .split('\n')
    .filter((z) => !z.startsWith('#'))
    .join('\n')
}

describe('Regel 1: die .mount-Einheit hängt beim Start nie ein', () => {
  it('trägt KEINEN [Install]-Abschnitt', () => {
    const text = ohneKommentar(mountEinheit(konfig()))
    assert.equal(text.includes('[Install]'), false)
    assert.equal(/^WantedBy=/m.test(text), false)
    // Gegenprobe: die Zeilen, die drin sein MÜSSEN, sind es auch — sonst
    // bestünde dieser Test auch für eine leere Datei.
    assert.match(text, /^\[Mount\]$/m)
    assert.match(text, /^What=\/\/192\.168\.178\.199\/mupibox$/m)
  })

  it('die .automount daneben trägt ihn — sie allein darf mitkommen', () => {
    const text = automountEinheit(konfig())
    assert.match(text, /\[Install\]\nWantedBy=multi-user\.target/)
  })

  it('wartet auf das Netz, statt es aufzuhalten', () => {
    assert.match(mountEinheit(konfig()), /After=network-online\.target/)
  })
})

describe('Regel 3: das Passwort steht in keiner Einheit und in keiner Antwort', () => {
  it('weder in .mount noch in .automount', () => {
    const k = konfig({ passwort: 'DiesesWortDarfNichtRaus' })
    assert.equal(mountEinheit(k).includes('DiesesWortDarfNichtRaus'), false)
    assert.equal(automountEinheit(k).includes('DiesesWortDarfNichtRaus'), false)
    // Und sonst nichts: die Einheit nennt die Zugangsdatei, statt das Wort zu tragen.
    assert.match(mountEinheit(k), new RegExp(`credentials=${ZUGANG_DATEI}`))
  })

  it('nicht in der Beschreibung, die nach vorne geht', () => {
    const b = beschreibung(konfig({ passwort: 'DiesesWortDarfNichtRaus' }))
    assert.equal(JSON.stringify(b).includes('DiesesWortDarfNichtRaus'), false)
    assert.equal('passwort' in b, false)
    // Gegenprobe: was drin sein MUSS, ist auch drin — sonst prüft der Test nur,
    // dass eine leere Antwort kein Passwort enthält ([[gegenprobe-statt-gruen-glauben]]).
    assert.equal(b.nutzer, 'mupibox')
    assert.equal(b.quelle, '//192.168.178.199/mupibox')
  })

  it('aber in der Zugangsdatei, und die trägt genau drei mögliche Zeilen', () => {
    assert.equal(zugangSchreiben(konfig()), 'username=mupibox\npassword=nicht-das-echte\n')
    assert.equal(
      zugangSchreiben(konfig({ domaene: 'WORKGROUP' })),
      'username=mupibox\npassword=nicht-das-echte\ndomain=WORKGROUP\n',
    )
  })

  it('lehnt ein Passwort mit Leerzeichen am Rand ab, statt es still zu beschneiden', () => {
    const p = eingabeLesen({ ...GUT, passwort: ' randlastig ' })
    assert.equal(p.ok, false)
    if (!p.ok) assert.match(p.fehler, /Leerzeichen/)
  })
})

describe('Optionen: was CIFS nicht hängen lässt', () => {
  it('setzt soft und die erzwungene Fassung', () => {
    const o = optionen(konfig())
    assert.match(o, /(^|,)soft(,|$)/)
    assert.equal(o.includes('hard'), false)
    assert.match(o, new RegExp(`vers=${SMB_FASSUNG}`))
  })

  it('gibt die Dateien dem Nutzer der Box — sonst kann die Sicherung nicht schreiben', () => {
    const o = optionen(konfig({ besitzer: 'dietpi' }))
    assert.match(o, /uid=dietpi/)
    assert.match(o, /gid=dietpi/)
  })

  it('kürzt die Frist, damit ein weggefallenes NAS kein Warten wird', () => {
    assert.match(mountEinheit(konfig()), /TimeoutSec=10/)
  })
})

// ── WebDAV (nachgereicht 20.09.2026) ──────────────────────────────────────
//
// Die fünf Regeln oben gelten für BEIDE Sorten. Deshalb werden die beiden,
// die sonst nur an SMB geprüft wären, hier noch einmal gegen WebDAV gefahren:
// eine Regel, die nur für die zuerst gebaute Sorte gilt, ist keine.

const DAV = {
  art: 'webdav' as const,
  adresse: 'https://nas.fritz.box/remote.php/dav/files/achim/MuPiBox',
  nutzer: 'achim',
  passwort: 'nicht-das-echte',
}

function dav(zusatz: Record<string, unknown> = {}) {
  const p = eingabeLesen({ ...DAV, ...zusatz })
  if (!p.ok) throw new Error(`abgelehnt, obwohl gut gemeint: ${p.fehler}`)
  return p.konfig
}

describe('WebDAV: die Adresse wird zerlegt, nicht durchgereicht', () => {
  it('nimmt eine Nextcloud-Adresse an und baut die Quelle daraus neu', () => {
    const k = dav()
    assert.equal(k.art, 'webdav')
    assert.equal(k.quelle, 'https://nas.fritz.box/remote.php/dav/files/achim/MuPiBox')
    assert.equal(k.host, 'nas.fritz.box')
    assert.equal(k.freigabe, 'remote.php')
    assert.equal(k.unterpfad, 'dav/files/achim/MuPiBox')
  })

  it('wirft den Schrägstrich am Ende weg — sonst hätte dieselbe Freigabe zwei Schreibweisen', () => {
    assert.equal(dav({ adresse: 'https://nas.fritz.box/dav/' }).quelle, 'https://nas.fritz.box/dav')
  })

  it('behält einen Port', () => {
    assert.equal(dav({ adresse: 'https://nas.fritz.box:8443/dav' }).quelle, 'https://nas.fritz.box:8443/dav')
  })

  for (const [was, adresse] of [
    ['einen Anmeldenamen in der Adresse', 'https://achim:geheim@nas/dav'],
    ['eine Abfrage', 'https://nas/dav?ordner=1'],
    ['einen Anker', 'https://nas/dav#hier'],
    ['ein fremdes Protokoll', 'ftp://nas/dav'],
    ['eine halbe Adresse ohne Protokoll', 'nas.fritz.box/dav'],
    ['einen Rückschritt im Weg', 'https://nas/dav/../../etc'],
  ] as [string, string][]) {
    it(`lehnt ${was} ab`, () => {
      const p = eingabeLesen({ ...DAV, adresse })
      assert.equal(p.ok, false)
    })
  }

  it('sagt es, wenn die Adresse unverschlüsselt ist — statt es stillschweigend zu tun', () => {
    const h = dav({ adresse: 'http://nas.fritz.box/dav' }).hinweise.join(' | ')
    assert.match(h, /UNVERSCHLÜSSELT/)
  })

  it('nennt den Zwischenspeicher auf der Karte — die Eigenheit, die SMB nicht hat', () => {
    assert.match(dav().hinweise.join(' | '), /Zwischenspeicher auf der Karte/)
    assert.equal(/Zwischenspeicher auf der Karte/.test(konfig().hinweise.join(' | ')), false)
  })
})

describe('WebDAV: dieselben fünf Regeln wie bei SMB', () => {
  it('Regel 1 — die .mount-Einheit trägt auch hier kein [Install]', () => {
    const text = ohneKommentar(mountEinheit(dav()))
    assert.equal(text.includes('[Install]'), false)
    assert.match(text, /^Type=davfs$/m)
    assert.match(text, /^What=https:\/\/nas\.fritz\.box\/remote\.php\/dav\/files\/achim\/MuPiBox$/m)
  })

  it('Regel 2 — der Einhängepunkt muss auch hier unter /mnt liegen', () => {
    assert.equal(eingabeLesen({ ...DAV, einhaengepunkt: '/home/dietpi/MuPiBox/media' }).ok, false)
  })

  it('Regel 3 — das Passwort steht in keiner Einheit und in keiner Antwort', () => {
    const k = dav({ passwort: 'DiesesWortDarfNichtRaus' })
    assert.equal(mountEinheit(k).includes('DiesesWortDarfNichtRaus'), false)
    assert.equal(automountEinheit(k).includes('DiesesWortDarfNichtRaus'), false)
    assert.equal(davfsKonfSchreiben().includes('DiesesWortDarfNichtRaus'), false)
    assert.equal(JSON.stringify(beschreibung(k)).includes('DiesesWortDarfNichtRaus'), false)
    // Gegenprobe: in der Zugangsdatei steht es sehr wohl — sonst prüfte der
    // Test nur, dass irgendwo nichts steht.
    assert.equal(zugangSchreiben(k).includes('DiesesWortDarfNichtRaus'), true)
  })

  it('Regel 4 — ein Prozentzeichen in der Adresse wird abgelehnt', () => {
    assert.equal(eingabeLesen({ ...DAV, adresse: 'https://nas/dav%h' }).ok, false)
    assert.equal(eingabeLesen({ ...DAV, passwort: '100%sicher' }).ok, false)
  })
})

describe('WebDAV: die Zugangsdatei im Format von davfs2', () => {
  it('eine Zeile aus drei Feldern, Name und Passwort in Anführungszeichen', () => {
    assert.equal(
      zugangSchreiben(dav()),
      'https://nas.fritz.box/remote.php/dav/files/achim/MuPiBox "achim" "nicht-das-echte"\n',
    )
  })

  it('ein Passwort mit Leerzeichen bleibt EIN Feld — sonst nähme mount.davfs die erste Hälfte', () => {
    const zeile = zugangSchreiben(dav({ passwort: 'zwei worte' }))
    assert.match(zeile, /"zwei worte"\n$/)
  })

  it('Anführungszeichen und Backslash werden geschützt', () => {
    assert.equal(davfsWert('mit"quote'), '"mit\\"quote"')
    assert.equal(davfsWert('mit\\strich'), '"mit\\\\strich"')
  })
})

describe('WebDAV: die eigene davfs2-Konfiguration', () => {
  it('zeigt auf die eigene Anmeldedatei — /etc/davfs2/secrets bleibt unberührt', () => {
    const t = davfsKonfSchreiben()
    assert.match(t, new RegExp(`^secrets ${WEBDAV_ZUGANG_DATEI}$`, 'm'))
    assert.equal(t.includes('/etc/davfs2/secrets'), false)
  })

  it('fragt nie interaktiv nach — beim Einhängen durch systemd steht niemand da', () => {
    assert.match(davfsKonfSchreiben(), /^ask_auth 0$/m)
  })

  it('und die Einheit nennt genau diese Konfiguration', () => {
    assert.match(optionen(dav()), new RegExp(`conf=${DAVFS_KONF_DATEI}`))
    // Und sonst nichts von CIFS: eine cifs-Option bei davfs ist nur eine
    // Fehlermeldung wert.
    assert.equal(optionen(dav()).includes('vers='), false)
    assert.equal(optionen(dav()).includes('credentials='), false)
  })
})

describe('WebDAV: dem Zertifikat vertrauen — aber nur ausdrücklich', () => {
  it('kommt nie von selbst', () => {
    assert.equal(dav().zertifikatVertraut, false)
    assert.equal(davfsKonfSchreiben().includes('trust_server_cert'), false)
  })

  it('nur echtes true zählt, nicht "true" und nicht 1', () => {
    assert.equal(dav({ zertifikatVertrauen: 'true' }).zertifikatVertraut, false)
    assert.equal(dav({ zertifikatVertrauen: 1 }).zertifikatVertraut, false)
    assert.equal(dav({ zertifikatVertrauen: true }).zertifikatVertraut, true)
  })

  it('bei http gibt es nichts zu vertrauen — und bei SMB kein Zertifikat', () => {
    assert.equal(dav({ adresse: 'http://nas.fritz.box/dav', zertifikatVertrauen: true }).zertifikatVertraut, false)
    assert.equal(konfig({ zertifikatVertrauen: true }).zertifikatVertraut, false)
  })

  it('schreibt trust_server_cert erst dann — und sagt in der Datei, warum', () => {
    const t = davfsKonfSchreiben(true)
    assert.match(t, new RegExp(`^trust_server_cert ${WEBDAV_ZERT_DATEI}$`, 'm'))
    assert.match(t, /NICHT mehr auf Gültigkeit/)
    // Gegenprobe: der Rest der Datei steht weiterhin da.
    assert.match(t, /^ask_auth 0$/m)
  })

  it('sagt dem Betreiber, was er damit abschaltet', () => {
    assert.match(dav({ zertifikatVertrauen: true }).hinweise.join(' | '), /weder seine Gültigkeit noch den Namen/)
  })

  it('bleibt in der Beschreibung sichtbar — eine abgeschaltete Prüfung darf nicht verschwinden', () => {
    assert.equal(beschreibung(dav({ zertifikatVertrauen: true })).zertifikatVertraut, true)
  })
})
