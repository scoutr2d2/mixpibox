/**
 * WIE DIESE BOX HEISST — Fall fuer Fall.
 *
 * DIE REIHENFOLGE IST DIE DER GEFAHR, und sie ist hier umgekehrt zur
 * Erwartung: ZUERST steht, was durchkommen MUSS. Ein Riegel, der den Besitzer
 * aussperrt, ist schlimmer als die Luecke, die er schliesst — er kann es nicht
 * melden, weil niemand davorsitzt. Erst danach kommt, was abprallen muss.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type EigeneNamen,
  eigeneAdressen,
  fremderNameSatz,
  fremderNameSeite,
  istEigenerName,
  namenBilden,
  namenErmitteln,
  namenNormieren,
  namenVergessen,
  RESERVIERTE_ENDUNGEN,
} from './eigene-namen'

const IP = '192.168.178.169'

/** Die Box, wie sie beim Betreiber wirklich steht (am Geraet abgelesen). */
const BOX = (): EigeneNamen =>
  namenBilden({
    rechnername: 'mupibox',
    adressen: ['127.0.0.1', '::1', IP, 'fe80::1%wlan0'],
    konfigHost: 'MixPiBox',
  })

describe('Eigene Namen — WER DURCHKOMMEN MUSS (sonst ist die Box verloren)', () => {
  const box = BOX()
  const durch = [
    ['der Kiosk auf der Box selbst', 'localhost'],
    ['Werkzeuge und Skripte auf der Box', '127.0.0.1'],
    ['dasselbe ueber IPv6', '::1'],
    ['ein zweiter Rechner im Heimnetz', IP],
    ['der Rechnername', 'mupibox'],
    ['der Rechnername in Grossschreibung', 'MuPiBox'],
    ['der mDNS-Name', 'mupibox.local'],
    ['der mDNS-Name mit Punkt am Ende (den schickt mancher Browser)', 'mupibox.local.'],
    ['der Name aus der Konfiguration', 'MixPiBox'],
    ['und dessen mDNS-Form', 'mixpibox.local'],
    ['der Name, den ein Fritz!Box-Router vergibt', 'mupibox.fritz.box'],
    ['der Name, den andere Router vergeben', 'mupibox.lan'],
    ['der offizielle Hausgebrauch', 'mupibox.home.arpa'],
    ['die IPv6-Adresse in Klammern', '[::1]'],
  ] as const
  for (const [wozu, name] of durch) {
    it(`${wozu}: ${name}`, () => {
      assert.equal(istEigenerName(name, box), true)
    })
  }

  it('JEDE reservierte Endung gilt fuer die eigene Marke — keine Ausnahme', () => {
    for (const e of RESERVIERTE_ENDUNGEN) {
      assert.equal(istEigenerName(`mupibox.${e}`, box), true, `mupibox.${e} waere ausgesperrt`)
    }
  })

  it('was der Betreiber selbst erlaubt, gilt — auch als Marke unter einer Endung', () => {
    const n = namenBilden({ rechnername: 'mupibox', adressen: [IP], zusatz: ['musik', 'kiste.example.org'] })
    assert.equal(istEigenerName('musik', n), true)
    assert.equal(istEigenerName('musik.fritz.box', n), true)
    assert.equal(istEigenerName('kiste.example.org', n), true)
    // Eine Angabe MIT Punkt gilt genau so, wie sie dasteht, und macht keine
    // Marke auf: sonst waere mit `kiste.example.org` auch `kiste.lan` erlaubt,
    // und das hat niemand gesagt.
    assert.equal(istEigenerName('kiste.lan', n), false)
  })

  it('eine NEUE Adresse vom DHCP gilt, sobald sie an der Schnittstelle steht', () => {
    const vorher = namenBilden({ rechnername: 'mupibox', adressen: ['192.168.178.40'] })
    const nachher = namenBilden({ rechnername: 'mupibox', adressen: ['192.168.178.77'] })
    assert.equal(istEigenerName('192.168.178.77', vorher), false)
    assert.equal(istEigenerName('192.168.178.77', nachher), true)
  })

  it('die Rueckschleife gilt AUCH DANN, wenn die Ableitung nichts hergibt', () => {
    // Der Kiosk auf der Box darf niemals von einer Ableitung abhaengen, die
    // schiefgehen kann. Er ist der Bildschirm, an dem das Kind steht.
    const nichts = namenBilden({})
    assert.equal(istEigenerName('localhost', nichts), true)
    assert.equal(istEigenerName('127.0.0.1', nichts), true)
  })
})

describe('Eigene Namen — WAS ABPRALLEN MUSS', () => {
  const box = BOX()

  it('DER NAMENSTAUSCH: ein fremder Name, der auf die Box zeigt', () => {
    // Der gemessene Befund. `Host` und `Origin` tragen beide diesen Namen, der
    // Browser meldet `same-origin` — nur die Box selbst weiss, dass sie nicht
    // so heisst.
    assert.equal(istEigenerName('boese.example', box), false)
  })

  it('die eigene Marke unter einer KAEUFLICHEN Endung prallt ab', () => {
    // Hier haengt die ganze Endungsregel: `mupibox.boese.example` kostet den
    // Angreifer nichts. Nur weil in der Liste ausschliesslich Endungen stehen,
    // die sich niemand eintragen lassen kann, ist sie ueberhaupt tragfaehig.
    for (const n of ['mupibox.boese.example', 'mupibox.com', 'mupibox.box', 'mupibox.de']) {
      assert.equal(istEigenerName(n, box), false, `${n} kam durch`)
    }
  })

  it('ein Praefix oder Anhaengsel des eigenen Namens ist nicht der eigene Name', () => {
    for (const n of ['mupibox-boese.example', `${IP}.boese.example`, 'boese.mupibox.local', 'xmupibox.local']) {
      assert.equal(istEigenerName(n, box), false, `${n} kam durch`)
    }
  })

  it('eine fremde Adresse prallt ab, auch eine aus demselben Netz', () => {
    assert.equal(istEigenerName('192.168.178.170', box), false)
    assert.equal(istEigenerName('10.0.0.1', box), false)
  })

  it('leer und Muell sind kein Name', () => {
    for (const n of ['', '   ', 'http://mupibox', '..', '%%%']) {
      assert.equal(istEigenerName(n, box), false, `${JSON.stringify(n)} kam durch`)
    }
  })
})

describe('Eigene Namen — wie es SCHEITERT: offen, nicht zu', () => {
  it('liessen sich die Schnittstellen nicht lesen, prueft der Riegel nichts', () => {
    const n = namenBilden({ netzGelesen: false, rechnername: 'mupibox', adressen: [IP] })
    assert.equal(n.verlaesslich, false)
    assert.match(String(n.grund), /Schnittstellen/)
  })

  it('ohne jede Auskunft ueber sich selbst ebenfalls nicht', () => {
    // NUR die drei fest eingebauten Rueckschleifennamen — das ist kein Wissen
    // ueber diese Box, sondern eine Konstante. Wuerde der Riegel damit
    // urteilen, waere JEDER Zugriff aus dem Heimnetz gesperrt.
    const n = namenBilden({})
    assert.equal(n.verlaesslich, false)
  })

  it('eine Adresse ALLEIN reicht schon (Box ohne Rechnernamen)', () => {
    const n = namenBilden({ adressen: ['127.0.0.1', IP] })
    assert.equal(n.verlaesslich, true)
    assert.equal(istEigenerName(IP, n), true)
  })

  it('die echte Ableitung auf dieser Maschine kennt sich selbst', () => {
    namenVergessen()
    const n = namenErmitteln()
    assert.equal(n.verlaesslich, true, 'diese Maschine weiss nicht, wie sie heisst')
    assert.equal(istEigenerName('127.0.0.1', n), true)
    assert.equal(istEigenerName('localhost', n), true)
    assert.equal(istEigenerName('boese.example', n), false)
    assert.ok(n.erreichbar.length > 0, 'kein einziger Ausweg fuer den Menschen')
    namenVergessen()
  })
})

describe('Eigene Namen — der Satz an den ausgesperrten Menschen', () => {
  it('nennt den gerufenen Namen, den Weg zurueck UND wie man ihn erlaubt', () => {
    const satz = fremderNameSatz('boese.example', BOX(), 'http', 8200)
    // 1. Woran es liegt.
    assert.match(satz, /boese\.example/)
    // 2. DER AUSWEG OHNE SSH — eine Adresse, die jetzt sofort funktioniert.
    assert.match(satz, new RegExp(`http://${IP.replace(/\./g, '\\.')}:8200/`))
    assert.match(satz, /http:\/\/mupibox\.local:8200\//)
    // 3. Wie der Name dauerhaft gilt, mit Datei und Feld.
    assert.match(satz, /hostZusatz/)
    assert.match(satz, /mupiboxconfig\.json/)
    assert.match(satz, /MUPIBOX_HOST_ZUSATZ/)
    // 4. Und ausdruecklich: kein Neustart.
    assert.match(satz, /Neustart ist nicht nötig|Neustart ist nicht noetig/)
  })

  it('der Vorgabeport steht NICHT in der Adresse (sonst wird sie falsch abgetippt)', () => {
    assert.match(fremderNameSatz('x', BOX(), 'http', 80), /http:\/\/mupibox\.local\//)
    assert.match(fremderNameSatz('x', BOX(), 'https', 443), /https:\/\/mupibox\.local\//)
  })

  it('eine link-lokale Adresse taugt nicht als Ausweg und steht deshalb nicht drin', () => {
    // `fe80::…` braucht den Zonenanhang, den ein Mensch nicht kennt. Ein Link
    // darauf ist kein Ausweg, sondern eine zweite Sackgasse.
    assert.ok(!fremderNameSatz('x', BOX(), 'http', 8200).includes('fe80'))
  })
})

describe('Namen normieren — die Formen, die derselbe Rechner sind', () => {
  const gleich: [string, string][] = [
    ['MuPiBox.Local', 'mupibox.local'],
    ['mupibox.local.', 'mupibox.local'],
    ['127.0.0.1.', '127.0.0.1'],
    ['[::1]', '::1'],
    ['fe80::1%eth0', 'fe80::1'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['  mupibox  ', 'mupibox'],
    // DER PORT MUSS WEG. Wer ausgesperrt ist, kopiert den Namen aus seiner
    // Adresszeile, und dort steht der Port dabei. Vorher warf `new URL` an
    // diesen Formen und der Eintrag verschwand STILLSCHWEIGEND — der Ausweg
    // ging genau dem verloren, der ihn braucht.
    ['mupibox.fritzbox:8200', 'mupibox.fritzbox'],
    ['127.0.0.1:8200', '127.0.0.1'],
    ['[::1]:8443', '::1'],
    ['[fe80::1%eth0]:8200', 'fe80::1'],
  ]
  for (const [roh, soll] of gleich) {
    it(`${JSON.stringify(roh)} → ${soll}`, () => {
      assert.equal(namenNormieren(roh), soll)
    })
  }

  it('was kein Rechnername ist, ergibt leer', () => {
    for (const roh of ['', '  ', '/pfad', 'a b']) assert.equal(namenNormieren(roh), '')
  })
})

describe('Der Ausweg muss BRAUCHBAR sein, nicht nur vorhanden', () => {
  /**
   * GEMESSEN (tools/riegel-ausgesperrt-was-sieht-er.mjs, Ring C) auf einer
   * Maschine mit Docker: die ersten vier genannten Wege waren die LAN-Adresse,
   * ZWEI IPv6-Adressen und `172.18.0.1` — die Bruecke von Docker, ueber die
   * die Box von aussen gar nicht erreichbar ist. `mixpibox.local`, das jede
   * Anleitung nennt, fiel hinten heraus. Ein Ausweg, der auf eine Bruecke
   * zeigt, ist eine zweite Sackgasse.
   */
  const MIT_BRUECKE = () =>
    namenBilden({
      rechnername: 'mupibox',
      // DIE IPv6-ADRESSE IST EINE „EINDEUTIG LOKALE" (fc00::/7) und nicht mehr
      // die aus dem Dokumentationsbereich: seit dem Befund vom 07.08.2026 wird
      // eine WELTWEIT anwaehlbare Adresse zwar weiter angenommen, aber
      // niemandem mehr als Weg vorgesagt — der Rumpf der Ablehnung ist beim
      // Namenstausch fuer den Angreifer lesbar. Diese Pruefung meint die
      // REIHENFOLGE, nicht die Weltweite; mit `fd00::1` misst sie das weiter.
      adressen: ['127.0.0.1', '::1', '192.168.178.169', 'fd00::1', '172.18.0.1'],
      empfehlenNicht: ['172.18.0.1'],
      konfigHost: 'MixPiBox',
    })

  it('die Bruecke von Docker gilt weiter — wer so hereinkommt, fliegt nicht raus', () => {
    assert.equal(istEigenerName('172.18.0.1', MIT_BRUECKE()), true)
  })

  it('… wird aber NICHT als Weg genannt', () => {
    assert.ok(!eigeneAdressen(MIT_BRUECKE(), 'http', 8200).some((u) => u.includes('172.18.0.1')))
  })

  it('was man abtippt, steht vorn: IPv4 vor Namen vor IPv6', () => {
    const wege = eigeneAdressen(MIT_BRUECKE(), 'http', 8200)
    const v4 = wege.findIndex((u) => u.includes('192.168.178.169'))
    const name = wege.findIndex((u) => u.includes('mupibox.local'))
    const v6 = wege.findIndex((u) => u.includes('[fd00::1]'))
    assert.ok(v4 >= 0 && name >= 0 && v6 >= 0, `alle drei genannt: ${wege.join(' ')}`)
    assert.ok(v4 < name && name < v6, `Reihenfolge: ${wege.join(' ')}`)
  })

  it('der mDNS-Name faellt nicht mehr hinten heraus', () => {
    assert.ok(eigeneAdressen(MIT_BRUECKE(), 'http', 8200).some((u) => u.includes('mixpibox.local')))
  })
})

describe('Die Erklaerungsseite — was ein ausgesperrter Mensch WIRKLICH liest', () => {
  const BOX2 = () =>
    namenBilden({ rechnername: 'mupibox', adressen: ['127.0.0.1', '192.168.178.169'], konfigHost: 'MixPiBox' })

  it('nennt den Namen, unter dem gerufen wurde — sonst raet der Mensch', () => {
    assert.match(fremderNameSeite('mupibox.fritzbox', BOX2(), 'http', 8200), /mupibox\.fritzbox/)
  })

  it('nennt einen Weg, der JETZT traegt, als anklickbaren Link', () => {
    assert.match(fremderNameSeite('x', BOX2(), 'http', 8200), /<a href="http:\/\/192\.168\.178\.169:8200\/"/)
  })

  it('nennt den dauerhaften Weg — und dass es dafuer keinen Neustart braucht', () => {
    const seite = fremderNameSeite('x', BOX2(), 'http', 8200)
    assert.match(seite, /hostZusatz/)
    assert.match(seite, /kein Neustart|Neustart ist nicht noetig/)
  })

  /**
   * DER NAME KOMMT AUS `Host` — ALSO VOM ANGREIFER. Gemessen, dass `new URL`
   * zwar `<` und `>` verwirft, aber `"`, `'` und `&` bis in `.hostname`
   * durchlaesst. Ohne Maskierung truege die Erklaerungsseite fremden Text.
   */
  it('maskiert den gerufenen Namen — die Erklaerung darf nicht die naechste Luecke sein', () => {
    const seite = fremderNameSeite('a"b&c\'d.example', BOX2(), 'http', 8200)
    assert.ok(seite.includes('a&quot;b&amp;c&#39;d.example'))
    assert.ok(!seite.includes('a"b&c\'d.example'))
  })

  it('haengt an nichts — wer sie sieht, kommt an die Box gerade nicht heran', () => {
    const seite = fremderNameSeite('x', BOX2(), 'http', 8200)
    // Kein Stilblatt, kein Bild, kein Skript von aussen: alles inline.
    assert.ok(!/<link[^>]+href|<script|<img/i.test(seite))
  })
})

describe('hostZusatz — der Ausweg muss vertragen, was ein Mensch eintippt', () => {
  /**
   * GEMESSEN: `hostZusatz: "mupibox.fritzbox:8200"` galt NICHT, und niemand
   * erfuhr davon. Das ist die teuerste Stelle fuer so einen Fehler — sie ist
   * der dokumentierte Weg zurueck fuer den, der schon ausgesperrt ist.
   */
  const MIT = (zusatz: string) =>
    namenBilden({ rechnername: 'mupibox', adressen: ['127.0.0.1', '192.168.178.169'], zusatz: [zusatz] })

  it('der blanke Name gilt', () => {
    assert.equal(istEigenerName('mupibox.fritzbox', MIT('mupibox.fritzbox')), true)
  })

  it('derselbe Name MIT Port gilt auch — aus der Adresszeile kopiert', () => {
    assert.equal(istEigenerName('mupibox.fritzbox', MIT('mupibox.fritzbox:8200')), true)
  })

  it('ein ganzer Verweis gilt NICHT — er ist kein Rechnername', () => {
    // Hier ist Schweigen richtig: wer eine Adresse mit Schema und Pfad
    // eintraegt, meint erkennbar etwas anderes als einen Namen. Aus einem
    // Pfad einen Namen zu erfinden waere die schlechtere Falle.
    assert.equal(istEigenerName('mupibox.fritzbox', MIT('http://mupibox.fritzbox:8200/')), false)
  })
})

/**
 * WAS IN DER ABLEHNUNG STEHT — UND WAS DARIN NICHTS ZU SUCHEN HAT.
 *
 * Die Ablehnung nennt die Adressen dieser Box, damit der Ausgesperrte wieder
 * hereinkommt. Sie wird aber auch dem ANGREIFER vorgelegt, und beim
 * Namenstausch liegt seine Seite gleichherkuenftig zur Box — er kann den Rumpf
 * also LESEN (gemessen mit tools/ausgesperrt-am-schirm.mjs).
 *
 * DESHALB DIE TRENNUNG, an der diese Pruefungen haengen: was im Haus gilt,
 * wird genannt; was weltweit anwaehlbar ist, gilt WEITER, wird aber nicht mehr
 * vorgesagt. Ginge diese Trennung verloren, faende ein Angreifer aus dem
 * Heimnetz heraus den Weg von aussen — gegen eine API, die in der Vorlage
 * ohne Anmeldung dasteht.
 */
describe('die Ablehnung sagt keine weltweite Adresse vor', () => {
  const GLOBAL_V6 = '2001:9e8:a2c1:5400:ec16:9ab6:e329:7eb0'
  const bilden = (adressen: string[]) => namenBilden({ rechnername: 'mupibox', adressen })

  it('die globale IPv6-Adresse wird NICHT als Weg genannt', () => {
    const n = bilden(['127.0.0.1', '192.168.178.169', GLOBAL_V6])
    assert.equal(n.erreichbar.includes(GLOBAL_V6), false)
  })

  it('… sie GILT aber weiter — sonst waere das ein Aussperren', () => {
    // DER KERN: gekuerzt wird die Empfehlung, nicht die Erlaubnis. Wer die Box
    // wirklich ueber diese Adresse erreicht, kommt herein wie bisher.
    const n = bilden(['127.0.0.1', '192.168.178.169', GLOBAL_V6])
    assert.equal(istEigenerName(`[${GLOBAL_V6}]`, n), true)
    assert.equal(istEigenerName(GLOBAL_V6, n), true)
  })

  it('die Adresse aus dem Heimnetz wird weiter genannt', () => {
    const n = bilden(['127.0.0.1', '192.168.178.169', GLOBAL_V6])
    assert.equal(n.erreichbar.includes('192.168.178.169'), true)
  })

  it('auch eine oeffentliche IPv4-Adresse wird nicht vorgesagt, gilt aber', () => {
    const n = bilden(['127.0.0.1', '93.184.216.34'])
    assert.equal(n.erreichbar.includes('93.184.216.34'), false)
    assert.equal(istEigenerName('93.184.216.34', n), true)
  })

  it('die drei Heimnetz-Bereiche und der Anbieter-Bereich bleiben Wege', () => {
    for (const a of ['10.0.0.5', '172.16.3.4', '192.168.1.2', '169.254.7.8', '100.64.0.9']) {
      assert.equal(bilden(['127.0.0.1', a]).erreichbar.includes(a), true, a)
    }
  })

  it('eine eindeutig lokale IPv6-Adresse (fc00::/7) bleibt ein Weg', () => {
    for (const a of ['fd12:3456:789a::1', 'fc00::7']) {
      assert.equal(bilden(['127.0.0.1', a]).erreichbar.includes(a), true, a)
    }
  })

  it('172.32.x ist NICHT privat — und wird deshalb nicht vorgesagt', () => {
    // Die Grenze von RFC 1918 liegt bei 172.31. Ein Deckel, der bis 172.255
    // reicht, wuerde fremde Adressen fuer eigene halten.
    assert.equal(bilden(['127.0.0.1', '172.32.0.1']).erreichbar.includes('172.32.0.1'), false)
  })

  it('OHNE jede nennbare Adresse bleibt trotzdem ein Ausweg stehen', () => {
    // Die Liste darf NIE leer werden — eine Ablehnung ohne Ausweg ist genau
    // die Sackgasse, gegen die diese ganze Datei geschrieben ist.
    const n = bilden(['127.0.0.1', GLOBAL_V6])
    assert.ok(n.erreichbar.length > 0, 'kein einziger Ausweg fuer den Menschen')
    assert.ok(
      n.erreichbar.some((e) => e === 'localhost' || e.endsWith('.local')),
      `nur unbrauchbare Auswege: ${n.erreichbar.join(', ')}`,
    )
  })

  it('der Satz an den Menschen traegt die globale Adresse nicht', () => {
    const n = bilden(['127.0.0.1', '192.168.178.169', GLOBAL_V6])
    const satz = fremderNameSatz('boese.example', n, 'http', 8200)
    assert.equal(satz.includes(GLOBAL_V6), false)
    assert.equal(satz.includes('192.168.178.169'), true)
  })
})
