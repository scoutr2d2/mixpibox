import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  FOLGEN_DECKEL,
  einstellungenMaskieren,
  einstellungenNormalisieren,
  einstellungenZusammenfuehren,
  ereignisAusBefehl,
  fundPruefen,
  inhaltPruefen,
  kennungZerlegen,
  manifestPruefen,
  praefix,
  routenStueck,
  songtextPruefen,
} from './plugin-vertrag'
import { ZEILEN_DECKEL } from './songtext'

/**
 * Tests des Plugin-Vertrags.
 *
 * Die Pruefung ist rein, deshalb steht hier kein Worker, kein Dateisystem und
 * keine Box. Was hier gruen ist, ist fuer jeden Fremdentwickler gruen — und
 * genau das ist der Zweck: die Fehlermeldung, die er zu lesen bekommt, ist
 * hier festgeschrieben und nicht dem Zufall der Ladereihenfolge ueberlassen.
 */

const gut = {
  kennung: 'mupibox-podcast',
  name: 'Podcast',
  fassung: '1.0.0',
  haupt: 'index.mjs',
  rechte: ['medienquelle', 'netz'],
}

describe('manifestPruefen — was durchgeht', () => {
  it('nimmt ein vollstaendiges Manifest an', () => {
    const u = manifestPruefen(gut)
    assert.equal(u.ok, true)
    assert.deepEqual(u.maengel, [])
    assert.equal(u.manifest?.kennung, 'mupibox-podcast')
    assert.deepEqual(u.manifest?.rechte, ['medienquelle', 'netz'])
  })

  it('putzt Leerraum weg — ein Tippfehler im Editor ist kein Ladefehler', () => {
    const u = manifestPruefen({ ...gut, kennung: '  mupibox-podcast  ', name: ' Podcast ' })
    assert.equal(u.ok, true)
    assert.equal(u.manifest?.kennung, 'mupibox-podcast')
    assert.equal(u.manifest?.name, 'Podcast')
  })

  it('nimmt ein Plugin ganz ohne Rechte an — es kann dann eben nichts', () => {
    const { rechte, ...ohne } = gut
    void rechte
    const u = manifestPruefen(ohne)
    assert.equal(u.ok, true)
    assert.deepEqual(u.manifest?.rechte, [])
  })

  it('entdoppelt Rechte, statt sie zweimal zu vergeben', () => {
    const u = manifestPruefen({ ...gut, rechte: ['netz', 'netz', 'medienquelle'] })
    assert.deepEqual(u.manifest?.rechte, ['netz', 'medienquelle'])
  })
})

describe('manifestPruefen — was NICHT durchgeht', () => {
  it('weist ein unbekanntes Recht ab, statt es still zu schlucken', () => {
    // DAS IST DER WICHTIGSTE FALL DER GANZEN DATEI. Wuerde ein unbekanntes
    // Recht still wegfallen, liefe ein Plugin mit WENIGER Rechten als gedacht
    // und schluege spaeter an unerklaerlicher Stelle fehl. Wuerde es still
    // durchgehen, liefe es mit MEHR. Beides ist schlimmer als eine Absage.
    const u = manifestPruefen({ ...gut, rechte: ['medienquelle', 'alles'] })
    assert.equal(u.ok, false)
    assert.equal(u.manifest, null)
    assert.match(u.maengel.join(' '), /"alles" nicht/)
  })

  it('weist einen Ausbruch aus dem Plugin-Ordner ab', () => {
    for (const haupt of ['../../../etc/passwd', '/etc/passwd', 'a/../../b.mjs']) {
      const u = manifestPruefen({ ...gut, haupt })
      assert.equal(u.ok, false, `"${haupt}" haette abgewiesen werden muessen`)
    }
  })

  it('weist Kennungen ab, die kein Dateiname und kein URL-Stueck sein duerfen', () => {
    for (const kennung of ['..', 'Mupibox', 'mupi box', 'a', 'mupi/box', '1podcast', '']) {
      const u = manifestPruefen({ ...gut, kennung })
      assert.equal(u.ok, false, `"${kennung}" haette abgewiesen werden muessen`)
    }
  })

  it('sammelt ALLE Maengel, statt beim ersten aufzuhoeren', () => {
    // Ein Entwickler, der seine Datei viermal hintereinander laedt, um vier
    // Fehler zu finden, gibt beim dritten auf.
    const u = manifestPruefen({})
    assert.equal(u.ok, false)
    assert.ok(u.maengel.length >= 4, `nur ${u.maengel.length} Maengel gemeldet: ${u.maengel.join(' | ')}`)
  })

  it('haelt auch Unsinn aus, der gar kein Objekt ist', () => {
    for (const roh of [null, undefined, 42, 'text', []]) {
      const u = manifestPruefen(roh)
      assert.equal(u.ok, false)
    }
  })
})

describe('Namensraum — abgeleitet, nicht gewaehlt', () => {
  it('leitet Praefix und Route aus der Kennung ab', () => {
    assert.equal(praefix('mupibox-podcast'), 'mupibox-podcast:')
    assert.equal(routenStueck('mupibox-podcast'), '/api/plugins/mupibox-podcast/')
  })
})

describe('fundPruefen — was ein Plugin zurueckgibt, ist auch fremd', () => {
  const WURZEL = '/home/dietpi/MuPiBox/media'
  const strom = { titel: { name: 'Folge 1' }, quelle: { art: 'strom', adresse: 'https://example.org/a.mp3' } }

  it('nimmt einen sauberen Strom an', () => {
    const u = fundPruefen(strom, WURZEL)
    assert.equal(u.ok, true)
    assert.equal(u.fund?.quelle.adresse, 'https://example.org/a.mp3')
  })

  it('nimmt eine Datei UNTERHALB der Medienwurzel an', () => {
    const u = fundPruefen(
      { titel: { name: 'x' }, quelle: { art: 'datei', adresse: `${WURZEL}/hoerspiel/1.mp3` } },
      WURZEL,
    )
    assert.equal(u.ok, true)
  })

  it('weist Dateien AUSSERHALB der Medienwurzel ab', () => {
    // Der Fall, um dessentwillen es diese Funktion gibt.
    for (const adresse of [
      '/etc/shadow',
      '/home/dietpi/.mupibox/mupiboxconfig.json',
      '/home/dietpi/MuPiBox/mediaX/a.mp3',
    ]) {
      const u = fundPruefen({ titel: { name: 'x' }, quelle: { art: 'datei', adresse } }, WURZEL)
      assert.equal(u.ok, false, `"${adresse}" haette abgewiesen werden muessen`)
    }
  })

  it('laesst sich nicht mit ".." aus der Wurzel schummeln', () => {
    const u = fundPruefen(
      { titel: { name: 'x' }, quelle: { art: 'datei', adresse: `${WURZEL}/../../../etc/shadow` } },
      WURZEL,
    )
    assert.equal(u.ok, false)
  })

  it('weist `file:` als Strom ab — sonst ist es dieselbe Luecke mit anderem Namen', () => {
    const u = fundPruefen({ titel: { name: 'x' }, quelle: { art: 'strom', adresse: 'file:///etc/shadow' } }, WURZEL)
    assert.equal(u.ok, false)
  })

  it('besteht auf einem Titelnamen', () => {
    const u = fundPruefen({ titel: {}, quelle: strom.quelle }, WURZEL)
    assert.equal(u.ok, false)
  })

  it('haelt Unsinn aus', () => {
    for (const roh of [null, undefined, 42, 'text', {}, { quelle: { art: 'zauber', adresse: 'x' } }]) {
      assert.equal(fundPruefen(roh, WURZEL).ok, false)
    }
  })
})

describe('felder im Manifest', () => {
  const mitFeld = (feld: unknown) => manifestPruefen({ ...gut, felder: [feld] })

  it('nimmt saubere Felder an', () => {
    const u = manifestPruefen({
      ...gut,
      felder: [
        { schluessel: 'adresse', art: 'text', name: 'Adresse', hinweis: 'z. B. 192.168.1.50' },
        { schluessel: 'helligkeit', art: 'zahl', name: 'Helligkeit', vorgabe: 128 },
        { schluessel: 'an', art: 'schalter', name: 'Eingeschaltet', vorgabe: true },
        { schluessel: 'schluessel', art: 'geheim', name: 'API-Schluessel' },
      ],
    })
    assert.equal(u.ok, true, u.maengel.join(' '))
    assert.equal(u.manifest?.felder.length, 4)
  })

  it('laesst `felder` ganz weg durchgehen', () => {
    assert.deepEqual(manifestPruefen(gut).manifest?.felder, [])
  })

  it('weist Schluessel ab, die den Prototyp veraendern wuerden', () => {
    // Ohne diese Sperre veraendert ein Plugin beim SCHREIBEN seiner
    // Einstellungen den Prototyp — und damit den ganzen Prozess, nicht nur
    // sich selbst.
    for (const schluessel of ['__proto__', 'constructor', 'prototype']) {
      const u = mitFeld({ schluessel, art: 'text', name: 'x' })
      assert.equal(u.ok, false, `"${schluessel}" haette abgewiesen werden muessen`)
    }
  })

  it('weist krumme Schluessel ab', () => {
    for (const schluessel of ['mit leerzeichen', '1zahlvorn', '', 'mit-strich', 'a'.repeat(65)]) {
      assert.equal(mitFeld({ schluessel, art: 'text', name: 'x' }).ok, false, `"${schluessel}"`)
    }
  })

  it('weist ein Geheimnis mit Vorgabe ab', () => {
    // Eine Vorgabe fuer ein Geheimnis stuende im Klartext im Manifest.
    const u = mitFeld({ schluessel: 'schluessel', art: 'geheim', name: 'Schluessel', vorgabe: 'hunter2' })
    assert.equal(u.ok, false)
    assert.match(u.maengel.join(' '), /geheim/)
  })

  it('weist doppelte Schluessel und unbekannte Arten ab', () => {
    assert.equal(
      manifestPruefen({
        ...gut,
        felder: [
          { schluessel: 'a', art: 'text', name: 'A' },
          { schluessel: 'a', art: 'text', name: 'A nochmal' },
        ],
      }).ok,
      false,
    )
    assert.equal(mitFeld({ schluessel: 'a', art: 'zauber', name: 'A' }).ok, false)
  })

  it('besteht auf einem Namen — er steht ueber dem Eingabefeld', () => {
    assert.equal(mitFeld({ schluessel: 'a', art: 'text', name: '  ' }).ok, false)
  })
})

describe('Einstellungen', () => {
  // Ueber das Manifest gebaut statt von Hand getippt: so ist sicher, dass die
  // Felder auch die Pruefung passieren, gegen die sie hier benutzt werden.
  const felder =
    manifestPruefen({
      ...gut,
      felder: [
        { schluessel: 'adresse', art: 'text', name: 'Adresse', vorgabe: 'wled.local' },
        { schluessel: 'helligkeit', art: 'zahl', name: 'Helligkeit', vorgabe: 128 },
        { schluessel: 'an', art: 'schalter', name: 'An', vorgabe: true },
        { schluessel: 'schluessel', art: 'geheim', name: 'Schluessel' },
      ],
    }).manifest?.felder ?? []

  it('biegt kaputte Werte auf die Vorgabe, statt auszusperren', () => {
    // Wie regelnNormalisieren in kinderzeit.ts: eine kaputte Datei entsteht im
    // Betrieb und darf ein Plugin nicht lahmlegen.
    const e = einstellungenNormalisieren({ helligkeit: 'viel', an: 'ja', adresse: 42 }, felder)
    assert.equal(e.helligkeit, 128)
    assert.equal(e.an, false, '"ja" ist nicht true — nur echtes true zaehlt')
    assert.equal(e.adresse, 'wled.local')
  })

  it('setzt Vorgaben, wo nichts steht', () => {
    const e = einstellungenNormalisieren({}, felder)
    assert.deepEqual(e, { adresse: 'wled.local', helligkeit: 128, an: true, schluessel: '' })
  })

  it('wirft heraus, was nicht angemeldet ist', () => {
    const e = einstellungenNormalisieren({ adresse: 'x', altlast: 'weg damit' }, felder)
    assert.equal('altlast' in e, false)
  })

  it('leert Geheimnisse fuer die Anzeige, statt sie zu entfernen', () => {
    const m = einstellungenMaskieren({ adresse: 'x', schluessel: 'hunter2' }, felder)
    assert.equal(m.schluessel, '', 'geleert')
    assert.equal('schluessel' in m, true, 'die FORM muss bleiben')
    assert.equal(m.adresse, 'x')
  })

  it('VERLIERT KEIN GEHEIMNIS, wenn die Oberflaeche es leer zurueckschickt', () => {
    // DER TEURE FALL. Der Eltern-Bereich liest (Geheimnis kommt als '' an),
    // jemand aendert das Feld daneben und schickt alles zurueck. Ohne diese
    // Regel waere der Schluessel weg, ohne Fehlermeldung, und das Plugin
    // schluege erst beim naechsten Aufruf fehl.
    const alt = { adresse: 'alt', helligkeit: 10, an: true, schluessel: 'hunter2' }
    const neu = einstellungenZusammenfuehren(alt, { ...einstellungenMaskieren(alt, felder), adresse: 'neu' }, felder)
    assert.equal(neu.schluessel, 'hunter2', 'das Geheimnis muss stehen bleiben')
    assert.equal(neu.adresse, 'neu')
  })

  it('nimmt ein NEUES Geheimnis aber an', () => {
    const alt = { schluessel: 'alt' }
    assert.equal(einstellungenZusammenfuehren(alt, { schluessel: 'neu' }, felder).schluessel, 'neu')
  })
})

describe('kennungZerlegen', () => {
  it('trennt am ERSTEN Doppelpunkt und laesst die URL heil', () => {
    // Der Fall, an dem ein `split(':')` gestorben waere.
    const z = kennungZerlegen('mupibox-podcast:https://example.org/feed.xml?a=1:2')
    assert.deepEqual(z, { kennung: 'mupibox-podcast', rest: 'https://example.org/feed.xml?a=1:2' })
  })

  it('gibt null zurueck, wo kein Plugin gemeint ist', () => {
    for (const k of ['spotify:album:4711', '', ':nix', 'ohnedoppelpunkt', 'mupibox-podcast:', null, 42]) {
      // `spotify:album:4711` faellt heraus, weil `spotify` KEIN geladenes Plugin
      // ist — die Zerlegung sagt nur, WIE etwas aussieht. Ob die Kennung zu
      // einem Plugin gehoert, entscheidet der Wirt, nicht diese Funktion.
      const z = kennungZerlegen(k)
      if (k === 'spotify:album:4711') {
        assert.deepEqual(z, { kennung: 'spotify', rest: 'album:4711' })
        continue
      }
      assert.equal(z, null, `"${String(k)}" haette null liefern muessen`)
    }
  })
})

describe('ereignisAusBefehl — was der Proxy sieht, wird ein Ereignis', () => {
  // Das echte `istStartbefehl` aus kinderzeit.ts. Hereingereicht statt
  // importiert, damit diese Datei rein bleibt — und damit hier steht, WELCHE
  // Regel gemeint ist.
  const istStart = (p: string) =>
    /\/(spotify\/now|jellyfin|jfqueue|ardqueue|ard|musicsearch|library|queue|radio|rss|play)(\/|$)/.test(
      p.toLowerCase(),
    )

  it('erkennt einen Start', () => {
    const e = ereignisAusBefehl('/current/spotify/now/spotify:album:4711', istStart)
    assert.equal(e?.name, 'wiedergabeGestartet')
  })

  it('erkennt Anhalten und Pause — und nennt das Verb', () => {
    assert.deepEqual(ereignisAusBefehl('/current/stop', istStart), {
      name: 'wiedergabeGestoppt',
      nutzlast: { verb: 'stop' },
    })
    assert.deepEqual(ereignisAusBefehl('/current/pause', istStart), {
      name: 'wiedergabeGestoppt',
      nutzlast: { verb: 'pause' },
    })
  })

  it('liest die Lautstaerke aus `setvolume:N`', () => {
    // Doppelpunkt, nicht Schraegstrich — so schickt es die Oberflaeche
    // (NewDesign/app.js: spielerBefehl(`setvolume:${v}`)). Am Code nachgesehen,
    // nicht geraten.
    assert.deepEqual(ereignisAusBefehl('/current/setvolume:80', istStart), {
      name: 'lautstaerke',
      nutzlast: { wert: 80 },
    })
    assert.deepEqual(ereignisAusBefehl('/current/setvolume:0', istStart)?.nutzlast, { wert: 0 })
  })

  it('weist unsinnige Lautstaerken ab, statt sie durchzureichen', () => {
    // Ueber 100 ist keine Lautstaerke. Ein Plugin soll damit nicht rechnen
    // muessen — und schon gar nicht 999 an einen Lichtstreifen weitergeben.
    assert.equal(ereignisAusBefehl('/current/setvolume:999', istStart), null)
  })

  it('laesst Anhalten gewinnen, wenn ein Pfad beides enthaelt', () => {
    // Dieselbe Vorsicht wie NICHT_START in kinderzeit.ts: das Verneinen steht
    // zuerst. Ein Pfad, der wie ein Start UND wie ein Stopp aussieht, darf kein
    // „Licht an" ausloesen.
    assert.equal(ereignisAusBefehl('/current/radio/stop', istStart)?.name, 'wiedergabeGestoppt')
  })

  it('schweigt zu allem anderen', () => {
    for (const p of ['/current/state', '/current/getdevices', '', null, 42, '/current/seekpos:1000']) {
      assert.equal(ereignisAusBefehl(p, istStart), null, `"${String(p)}" haette kein Ereignis sein duerfen`)
    }
  })
})

describe('manifestPruefen — Sektion, Icon, Aktionen (E77)', () => {
  const GUT = { kennung: 'mixpi-test', name: 'Test', fassung: '1.0.0', haupt: 'index.mjs' }

  it('alle drei sind freiwillig — ein Plugin ohne sie bleibt gueltig', () => {
    const u = manifestPruefen(GUT)
    assert.equal(u.ok, true)
    assert.equal(u.manifest?.sektion, undefined)
    assert.equal(u.manifest?.icon, undefined)
    assert.deepEqual(u.manifest?.aktionen, [])
  })

  it('nimmt eine bekannte Sektion an und weist eine erfundene ab', () => {
    assert.equal(manifestPruefen({ ...GUT, sektion: 'streaming/ardsounds' }).manifest?.sektion, 'streaming/ardsounds')
    const u = manifestPruefen({ ...GUT, sektion: 'streaming/deezer' })
    assert.equal(u.ok, false)
    assert.match(u.maengel.join(' '), /sektion/)
  })

  it('DAS ICON DARF NICHT AUS DEM ORDNER AUSBRECHEN — es geht in sendFile', () => {
    assert.equal(manifestPruefen({ ...GUT, icon: 'icon.svg' }).manifest?.icon, 'icon.svg')
    assert.equal(manifestPruefen({ ...GUT, icon: 'bilder/logo.png' }).ok, true)
    for (const boese of ['../../../etc/passwd.svg', '/etc/shadow.png', 'icon.js', 'icon.svg.html', '']) {
      assert.equal(manifestPruefen({ ...GUT, icon: boese }).ok, false, boese)
    }
  })

  it('Aktionen: Kennung nach Schluessel-Regeln, Name Pflicht, keine Doppel', () => {
    const u = manifestPruefen({
      ...GUT,
      aktionen: [{ kennung: 'pruefen', name: 'Verbindung prüfen', hinweis: 'dauert einen Moment' }],
    })
    assert.equal(u.ok, true)
    assert.deepEqual(u.manifest?.aktionen, [
      { kennung: 'pruefen', name: 'Verbindung prüfen', hinweis: 'dauert einen Moment' },
    ])
    assert.equal(manifestPruefen({ ...GUT, aktionen: [{ kennung: 'pruefen' }] }).ok, false, 'ohne Name')
    assert.equal(
      manifestPruefen({ ...GUT, aktionen: [{ kennung: 'a b', name: 'x' }] }).ok,
      false,
      'Leerzeichen in der Kennung',
    )
    assert.equal(
      manifestPruefen({
        ...GUT,
        aktionen: [
          { kennung: 'p', name: 'x' },
          { kennung: 'p', name: 'y' },
        ],
      }).ok,
      false,
      'doppelte Kennung',
    )
  })

  it('DER PROTOTYP BLEIBT UNANTASTBAR — auch ueber Aktions-Kennungen', () => {
    // Dieselbe Falle wie bei den Feld-Schluesseln: die Kennung landet in
    // Objekten und Routen.
    for (const boese of ['__proto__', 'constructor', 'prototype']) {
      assert.equal(manifestPruefen({ ...GUT, aktionen: [{ kennung: boese, name: 'x' }] }).ok, false, boese)
    }
  })
})

describe('songtextPruefen — was auf den Kinderschirm darf (E84/B2)', () => {
  it('baut die Zeilen aus der Weissliste neu auf', () => {
    const u = songtextPruefen({
      zeilen: [{ zeitMs: 1000, text: 'eins', boshaft: '<script>' }],
      nutzlast: 'faellt weg',
    })
    assert.equal(u.ok, true)
    // Genau zwei Felder — was das Plugin sonst anhaengt, ist weg.
    assert.deepEqual(u.zeilen, [{ zeitMs: 1000, text: 'eins' }])
  })

  it('sortiert nach Zeit — zeileJetzt sucht binaer und braucht die Ordnung', () => {
    const u = songtextPruefen({
      zeilen: [
        { zeitMs: 5000, text: 'spaet' },
        { zeitMs: 1000, text: 'frueh' },
      ],
    })
    assert.deepEqual(
      u.zeilen.map((z) => z.text),
      ['frueh', 'spaet'],
    )
  })

  it('laesst kaputte Zeilen heraus und behaelt die Liste', () => {
    // Dieselbe Regel wie bei inhaltPruefen: 2 gute Zeilen sind 2 Zeilen.
    const u = songtextPruefen({
      zeilen: [
        { zeitMs: 1000, text: 'gut' },
        { zeitMs: 'krumm', text: 'x' },
        { zeitMs: -5, text: 'negativ' },
        { zeitMs: 3000, text: 42 },
        { zeitMs: 4000, text: 'auch gut' },
      ],
    })
    assert.equal(u.ok, true)
    assert.deepEqual(
      u.zeilen.map((z) => z.text),
      ['gut', 'auch gut'],
    )
    assert.equal(u.maengel.length, 3)
  })

  it('behaelt LEERE Texte mit Marke — das sind die Pausen', () => {
    const u = songtextPruefen({ zeilen: [{ zeitMs: 1000, text: '   ' }] })
    assert.equal(u.zeilen.length, 1)
    assert.equal(u.zeilen[0].text, '')
  })

  it('weist eine Antwort ohne Liste ab', () => {
    for (const krumm of [{}, { zeilen: 'text' }, { zeilen: null }, null, undefined]) {
      assert.equal(songtextPruefen(krumm).ok, false)
    }
  })

  it('weist ueber dem Deckel ab — eine Anzeige ist kein Katalog', () => {
    const zuViel = Array.from({ length: ZEILEN_DECKEL + 1 }, (_, i) => ({ zeitMs: i, text: 'z' }))
    const u = songtextPruefen({ zeilen: zuViel })
    assert.equal(u.ok, false)
    assert.equal(u.zeilen.length, 0)
  })

  it('nimmt genau den Deckel noch an', () => {
    const genau = Array.from({ length: ZEILEN_DECKEL }, (_, i) => ({ zeitMs: i, text: 'z' }))
    assert.equal(songtextPruefen({ zeilen: genau }).ok, true)
  })

  it('eine leere Liste ist gueltig — "kenne ich nicht" ist eine Antwort', () => {
    const u = songtextPruefen({ zeilen: [] })
    assert.equal(u.ok, true)
    assert.equal(u.zeilen.length, 0)
  })

  it('markiert einen Zeilen-Text als synchron', () => {
    assert.equal(songtextPruefen({ zeilen: [{ zeitMs: 1, text: 'a' }] }).synchron, true)
  })

  it('nimmt unsynchronen Text als `absaetze` an und markiert ihn als solchen', () => {
    const u = songtextPruefen({ absaetze: ['erste', '  zweite  ', ''] })
    assert.equal(u.ok, true)
    assert.equal(u.synchron, false)
    assert.deepEqual(u.absaetze, ['erste', 'zweite', ''])
    assert.equal(u.zeilen.length, 0)
  })

  it('sortiert Absaetze NICHT — ohne Marke ist die Reihenfolge der Quelle die einzige', () => {
    const u = songtextPruefen({ absaetze: ['zweite', 'erste'] })
    assert.deepEqual(u.absaetze, ['zweite', 'erste'])
  })

  it('laesst Nicht-Text aus den Absaetzen heraus und behaelt den Rest', () => {
    const u = songtextPruefen({ absaetze: ['gut', 42, null, 'auch gut'] })
    assert.deepEqual(u.absaetze, ['gut', 'auch gut'])
    assert.equal(u.maengel.length, 2)
  })

  it('synchron gewinnt, wenn ein Plugin beides liefert', () => {
    const u = songtextPruefen({ zeilen: [{ zeitMs: 1, text: 'a' }], absaetze: ['b'] })
    assert.equal(u.synchron, true)
    assert.equal(u.absaetze.length, 0)
  })

  it('deckelt auch die Absaetze', () => {
    const zuViel = Array.from({ length: ZEILEN_DECKEL + 1 }, () => 'z')
    assert.equal(songtextPruefen({ absaetze: zuViel }).ok, false)
  })
})

describe('inhaltPruefen — eine Liste ist kein Freibrief (E78)', () => {
  const FOLGE = { kennung: 'f1', name: 'Teil 1', quelle: { art: 'strom', adresse: 'https://a.de/1.mp3' } }

  it('nimmt eine gute Liste an und ordnet nichts um', () => {
    const u = inhaltPruefen(
      { titel: 'Sendung', kuenstler: 'WDR', folgen: [FOLGE, { ...FOLGE, kennung: 'f2', name: 'Teil 2' }] },
      '/medien',
    )
    assert.equal(u.ok, true)
    assert.equal(u.inhalt?.kuenstler, 'WDR')
    assert.deepEqual(
      u.inhalt?.folgen.map((f) => f.kennung),
      ['f1', 'f2'],
    )
    assert.equal(u.inhalt?.vollstaendig, true)
  })

  it('DIE 40. FOLGE MIT file:// IST DIESELBE LUECKE WIE BEIM FUND — sie faellt', () => {
    const u = inhaltPruefen(
      { titel: 'S', folgen: [FOLGE, { kennung: 'boese', name: 'x', quelle: { art: 'strom', adresse: 'file:///etc/shadow' } }] },
      '/medien',
    )
    assert.equal(u.ok, true)
    assert.equal(u.inhalt?.folgen.length, 1, 'die krumme faellt, die Liste bleibt')
    assert.match(u.maengel.join(' '), /boese/)
  })

  it('doppelte Kennungen: die zweite faellt', () => {
    const u = inhaltPruefen({ titel: 'S', folgen: [FOLGE, { ...FOLGE, name: 'anders' }] }, '/medien')
    assert.equal(u.inhalt?.folgen.length, 1)
  })

  it('ohne Titel oder ohne Liste: kein Inhalt', () => {
    assert.equal(inhaltPruefen({ folgen: [] }, '/medien').ok, false)
    assert.equal(inhaltPruefen({ titel: 'S' }, '/medien').ok, false)
  })

  it('der Deckel haelt — ein Katalog ist keine Warteschlange', () => {
    const viele = Array.from({ length: FOLGEN_DECKEL + 1 }, (_, i) => ({ ...FOLGE, kennung: `f${i}` }))
    assert.equal(inhaltPruefen({ titel: 'S', folgen: viele }, '/medien').ok, false)
  })

  it('leere Liste ist ein ERGEBNIS — alles abgelaufen ist kein Fehler', () => {
    const u = inhaltPruefen({ titel: 'S', folgen: [] }, '/medien')
    assert.equal(u.ok, true)
    assert.equal(u.inhalt?.folgen.length, 0)
  })
})

/**
 * JEDES MANIFEST IM BAUM GEGEN DIE ECHTE REGEL — nicht nur das, an dem
 * gerade jemand arbeitet.
 *
 * ══ WARUM ES DIESEN ZEUGEN GIBT (29.08.2026) ═══════════════════════════════
 * `mixpi-mitschnitt` bekam zwei Aktionen mit den Kennungen `bestand-pruefen`
 * und `kaputte-neu-aufnehmen`. Bindestriche sind dort verboten (die Kennung
 * landet in einer Route und in einem Methodenaufruf). Folge: das Plugin wurde
 * beim Laden KOMPLETT ABGEWIESEN — der Mitschnitt war offline, nicht bloss die
 * neuen Knoepfe.
 *
 * Gemerkt hat es niemand, bis es auf der Box lag. 212 Zeugen des Plugins
 * blieben gruen; sie pruefen den Code, nicht das Manifest. Und
 * `tools/plugin-pruefen.mjs` prueft gegen den echten Kern, nimmt aber EINEN
 * Ordner auf Zuruf und haengt in keinem Laeufer.
 *
 * Ein Manifest ist die einzige Datei, die ein Plugin komplett ausschalten
 * kann, ohne dass eine Zeile Code falsch waere. Deshalb hier, ueber ALLE.
 */
describe('Jedes plugin.json im Baum haelt den Vertrag', () => {
  // NICHT __dirname: unter tsx/ESM gibt es das nicht, und der ganze Block
  // wuerde WERFEN statt zu pruefen — eine Wache, die gar nicht laeuft.
  // Stattdessen vom Arbeitsverzeichnis nach oben suchen, bis `plugins` da ist.
  const wurzelSuchen = (): string => {
    let d = process.cwd()
    for (let i = 0; i < 6; i++) {
      const k = path.join(d, 'plugins')
      if (fs.existsSync(k)) return k
      d = path.dirname(d)
    }
    return ''
  }
  const wurzel = wurzelSuchen()
  const ordner = wurzel && fs.existsSync(wurzel)
    ? fs.readdirSync(wurzel).filter((d) => fs.existsSync(path.join(wurzel, d, 'plugin.json')))
    : []

  it('es gibt ueberhaupt Plugins zu pruefen', () => {
    // Ohne diese Zeile waere der Test gruen, wenn der Pfad nicht stimmt —
    // eine Schleife ueber null Ordner behauptet nichts.
    assert.ok(ordner.length >= 5, `nur ${ordner.length} Manifeste gefunden unter ${wurzel}`)
  })

  for (const d of ordner) {
    it(`${d}: das Manifest wird angenommen`, () => {
      const roh = JSON.parse(fs.readFileSync(path.join(wurzel, d, 'plugin.json'), 'utf8'))
      const u = manifestPruefen(roh)
      assert.equal(u.ok, true, u.ok ? '' : `abgewiesen: ${(u as { maengel: string[] }).maengel.join(' | ')}`)
    })
  }
})
