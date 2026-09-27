#!/usr/bin/env -S npx tsx
/**
 * WOZU
 *   Die Gegenprobe zu tools/verschmelzung-probe.mjs. Dort laeuft die Kette an
 *   den ECHTEN Daten der Box — hier laeuft sie an Faellen, die ABSICHTLICH
 *   KNAPP DANEBEN liegen. Denn die eine Frage, die echte Daten nicht
 *   beantworten koennen, ist: was legt Stufe „locker" zusammen, was NICHT
 *   dasselbe ist?
 *
 *   Das Wissenspaket [quellen-verschmelzen] nennt die Falle beim Namen:
 *   „Deluxe/Remaster/Live tragen denselben Interpret+Titel, sind aber andere
 *   Alben. NIE allein auf Name+Interpret verschmelzen." Auf der Box mit ihren
 *   26 Eintraegen und 2 Ueberschneidungen kommt so ein Fall heute nicht vor —
 *   er kommt vor, sobald jemand ein zweites Hoerspiel dazulegt. Ein Werkzeug,
 *   das nur die heutige Box misst, sagt dazu fuer immer „alles gut".
 *
 *   ES LAEUFT DIESELBE KETTE WIE IM SERVER, Funktion fuer Funktion:
 *     werkeAus()                (werke.ts)         Eintraege -> Kacheln
 *     zuordnungenVorschlagen()  (abgleich.ts)      wer ist dasselbe? (Stufe 1)
 *     verschmelzeWerke()        (verschmelzung.ts) Kacheln zusammenlegen
 *   Nichts davon ist hier nachgebaut. Ein Werkzeug mit eigener Regel zeigte
 *   irgendwann etwas anderes als die Box — und man glaubte ihm.
 *
 *   JEDER FALL SAGT SELBST, WAS ER ERWARTET (`solltenZusammen`). Das Werkzeug
 *   ist damit auch ein Waechter: wer an `gruppiereTreffer` schraubt, sieht
 *   sofort, welchen Grenzfall er verschoben hat.
 *
 * WAS ES AENDERT
 *   NICHTS. Kein Netz, kein ssh, keine Datei wird geschrieben, die Box wird
 *   nicht angefasst. Alle Eintraege sind hier im Quelltext erfunden.
 *
 * AUFRUF — MIT tsx, NICHT MIT node
 *   npx tsx tools/verschmelzung-grenzfaelle.mjs
 *   npx tsx tools/verschmelzung-grenzfaelle.mjs --alle    # auch die stillen
 *   npx tsx tools/verschmelzung-grenzfaelle.mjs --json
 *
 *   WARUM tsx: Node kann die Typen inzwischen selbst abstreifen, aber nicht die
 *   Importe ohne Endung aufloesen, die der Bestand ueberall benutzt.
 *
 * RUECKGABE
 *   0  keine NEUE Abweichung (bekannte, im Fall selbst begruendete zaehlen nicht)
 *   1  mindestens ein Fall weicht NEU ab (Ueberverschmelzung oder Nichttreffer)
 *   3  ohne tsx gestartet
 *
 * STAND 2026-08-03 — drei bekannte Abweichungen, jede am Fall begruendet:
 *   Studio gegen Live, gleich beschriftet   Grenze der Stufe „locker"
 *   „Die drei ???" in „Die drei ??? Kids"   interpretenPassen ist Suchregel
 *   „groß" gegen „gross"                    normal() zerlegt das scharfe s
 * Zwei weitere waren am 2026-08-03 noch echte Ueberverschmelzungen und sind
 * seither behoben (`warumNicht` in abgleich.ts): verschiedene KATEGORIE und
 * fehlender INTERPRET.
 */
import { fileURLToPath } from 'node:url'

// DYNAMISCH, damit der Hinweis auf tsx ueberhaupt zum Zuge kommt: ein
// statisches `import` scheiterte schon beim Laden, bevor eine Zeile liefe.
let werkeAus
let zuordnungenVorschlagen
let verschmelzeWerke
try {
  ;({ werkeAus } = await import('../src/backend-api/src/werke.ts'))
  ;({ zuordnungenVorschlagen } = await import('../src/backend-api/src/abgleich.ts'))
  ;({ verschmelzeWerke } = await import('../src/backend-api/src/verschmelzung.ts'))
} catch (f) {
  console.error('Bitte mit tsx starten:  npx tsx tools/verschmelzung-grenzfaelle.mjs')
  console.error(String(f?.message ?? f))
  process.exit(3)
}

// `type` IST PFLICHT und nicht Zierde: `dienstVon()` liest AUSSCHLIESSLICH
// dieses Feld. Ohne es ist der Eintrag „anderes", `artVon` macht daraus
// ebenfalls „anderes" — und dann verschmilzt gar nichts, egal wie gleich die
// Beschriftung ist. Beim ersten Anlauf fiel deshalb sogar der Regelfall durch,
// und das Werkzeug haette „alles harmlos" gemeldet. Genau die Sorte Attrappe,
// die durch WEGLASSEN luegt (Wissenspaket: attrappe-luegt-durch-weglassen).

/** Ein Spotify-Album, wie es in data.json steht. */
const spotify = (id, title, artist, category = 'music') => ({ type: 'spotify', id, title, artist, category })
/** Ein Jellyfin-Album. */
const jellyfin = (id, title, artist, category = 'music') => ({ type: 'jellyfin', id, title, artist, category })

/**
 * DIE FAELLE.
 *
 * `solltenZusammen: false` heisst NICHT „der Bau ist kaputt, wenn sie es tun" —
 * es heisst „ein Kind saehe hier eine Kachel, hinter der zwei verschiedene
 * Dinge liegen". Genau diese Liste ist der Befund.
 */
const FAELLE = [
  {
    name: 'Folge 1 und Folge 11 — dieselbe Reihe, andere Folge',
    warum: 'Die Nummer steht im Titel. normal() macht daraus „folge 1" und „folge 11".',
    solltenZusammen: false,
    eintraege: [
      spotify('AAAAAAAAAAAAAAAAAAAAA1', 'Die drei ??? Folge 1', 'Die drei ???', 'audiobook'),
      jellyfin('bbbbbbbb1', 'Die drei ??? Folge 11', 'Die drei ???', 'audiobook'),
    ],
  },
  {
    name: 'Standard und Deluxe',
    warum: 'Der Zusatz steht im Titel — solange er dasteht, trennt normal() sie.',
    solltenZusammen: false,
    // BEKANNT UND HINGENOMMEN — dieselbe Grenze wie Studio/Live eine Zeile
    // tiefer: abgleich.ts benennt es im Kopf woertlich („Stufe 1 kann irren,
    // und sie irrt genau dort, wo es weh tut: Deluxe, Remaster …") und
    // verweist auf Stufe 2 (Fingerabdruck) als Behebung. Bis dahin traegt es
    // der Knopfdruck: nichts geschieht von selbst, „trennen" nimmt es zurueck.
    // Das `warum` oben beschrieb den Stand VOR der Stufen-Entscheidung.
    bekannt: 'Stufe 1 wirft Titel-Zusaetze zusammen — abgleich.ts nennt Deluxe ausdruecklich; Stufe 2 ist der Andockpunkt',
    eintraege: [
      spotify('AAAAAAAAAAAAAAAAAAAAA2', 'Die Zukunft wird gross', 'Das Lumpenpack'),
      jellyfin('bbbbbbbb2', 'Die Zukunft wird gross (Deluxe Edition)', 'Das Lumpenpack'),
    ],
  },
  {
    name: 'Studio und Live — GLEICH beschriftet',
    warum:
      'Der Fall, vor dem das Wissenspaket ausdruecklich warnt: die Live-Fassung traegt in Jellyfin oft NUR den Albumnamen, der Zusatz steckt im Ordner. Titelanzahl kennt heute niemand.',
    solltenZusammen: false,
    // BEKANNT UND HINGENOMMEN: das IST die Grenze der Stufe „locker". Der
    // Schutz waere `AbgleichOptionen.titelAnzahl` — die Andockstelle steht,
    // gefuellt wird sie erst ab Stufe 2. Bis dahin traegt es der Knopfdruck:
    // es geschieht nichts von selbst, und „trennen" nimmt es zurueck.
    bekannt: 'Stufe 1 ohne Titelanzahl — Andockpunkt AbgleichOptionen.titelAnzahl',
    eintraege: [
      spotify('AAAAAAAAAAAAAAAAAAAAA3', 'HAMM', 'Kapelle Petra'),
      jellyfin('bbbbbbbb3', 'HAMM', 'Kapelle Petra'),
    ],
  },
  {
    name: 'Reihe und Kids-Reihe — Interpret ist TEILZEICHENKETTE',
    warum: 'interpretenPassen() nimmt x.includes(y). „die drei kids" enthaelt „die drei".',
    solltenZusammen: false,
    // BEKANNT UND NICHT HIER ZU BEHEBEN: `interpretenPassen` gehoert der
    // SUCHE, und dort ist die Teilzeichenkette richtig („Kapelle Petra" soll
    // „Kapelle Petra feat. …" finden). Strukturell sind die beiden Faelle
    // nicht zu unterscheiden. Es bleibt beim Knopfdruck und bei „trennen".
    bekannt: 'interpretenPassen() ist Suchregel — Teilzeichenkette ist dort gewollt',
    eintraege: [
      spotify('AAAAAAAAAAAAAAAAAAAAA4', 'Panik im Paradies', 'Die drei ???', 'audiobook'),
      jellyfin('bbbbbbbb4', 'Panik im Paradies', 'Die drei ??? Kids', 'audiobook'),
    ],
  },
  {
    name: 'Ein Interpret FEHLT — schlecht getaggte Datei',
    warum: 'interpretenPassen() gibt bei leerem Feld true. Dann entscheidet der TITEL ALLEIN.',
    solltenZusammen: false,
    eintraege: [
      spotify('AAAAAAAAAAAAAAAAAAAAA5', 'Weihnachtslieder', 'Rolf Zuckowski'),
      jellyfin('bbbbbbbb5', 'Weihnachtslieder', ''),
    ],
  },
  {
    name: 'Musik und Hoerbuch — dieselbe Beschriftung, ANDERER Abschnitt',
    warum: 'gruppiereTreffer() vergleicht `kategorie` gar nicht. Die Kachel behaelt die des fuehrenden Werks.',
    solltenZusammen: false,
    eintraege: [
      spotify('AAAAAAAAAAAAAAAAAAAAA6', 'Der kleine Drache Kokosnuss', 'Ingo Siegner', 'music'),
      jellyfin('bbbbbbbb6', 'Der kleine Drache Kokosnuss', 'Ingo Siegner', 'audiobook'),
    ],
  },
  {
    name: 'Scharfes s gegen ss — DASSELBE Album',
    warum: 'Wissenspaket [normal-macht-aus-scharfem-s-eine-luecke]: „gross" und „groß" treffen nie.',
    solltenZusammen: true,
    // BEKANNT: normal() macht aus dem scharfen s eine Luecke. Behebbar nur
    // mit einer Wanderung, weil normal() Teil der IDENTITAET ist
    // (medienSchluessel im Ersatzfall). Steht so im Wissenspaket.
    bekannt: 'normal() zerlegt „ß" — Behebung braucht eine Schluesselwanderung',
    eintraege: [
      spotify('AAAAAAAAAAAAAAAAAAAAA7', 'Die Zukunft wird groß', 'Das Lumpenpack'),
      jellyfin('bbbbbbbb7', 'Die Zukunft wird gross', 'Das Lumpenpack'),
    ],
  },
  {
    name: 'Album und Playlist gleichen Namens',
    warum: 'Verschiedene `art` — Fall 2 in verschmelzeWerke, und schon gruppiereTreffer trennt sie.',
    solltenZusammen: false,
    eintraege: [
      { type: 'spotify', playlistid: 'AAAAAAAAAAAAAAAAAAAAA8', title: 'Sommer', artist: 'Diverse', category: 'music' },
      jellyfin('bbbbbbbb8', 'Sommer', 'Diverse'),
    ],
  },
  {
    name: 'Der Regelfall — dasselbe Album, gleich beschriftet',
    warum: 'Das, wofuer die ganze Verschmelzung gebaut ist. Muss treffen.',
    solltenZusammen: true,
    eintraege: [
      spotify('AAAAAAAAAAAAAAAAAAAAA9', 'HAMM', 'Kapelle Petra'),
      jellyfin('bbbbbbbb9', 'HAMM', 'Kapelle Petra'),
    ],
  },
]

const alle = process.argv.includes('--alle')
const alsJson = process.argv.includes('--json')

const ergebnisse = FAELLE.map((f) => {
  const werke = werkeAus(f.eintraege, { verschmelzen: false })
  const { vorschlaege, mehrdeutig, uebergangen } = zuordnungenVorschlagen(werke)
  const verschmolzen = verschmelzeWerke(werke, vorschlaege)
  const zusammen = verschmolzen.length < werke.length
  const kachel = verschmolzen.find((w) => w.auchSchluessel?.length)
  return {
    name: f.name,
    warum: f.warum,
    erwartet: f.solltenZusammen,
    zusammen,
    stimmt: zusammen === f.solltenZusammen,
    // BEKANNT IST NICHT BEHOBEN — nur eingeordnet. Ohne diese Unterscheidung
    // stuende das Werkzeug fuer immer auf Rueckgabe 1, und dann sieht niemand
    // mehr hin, wenn eine NEUE Abweichung dazukommt.
    bekannt: f.bekannt ?? null,
    vorher: werke.length,
    nachher: verschmolzen.length,
    mehrdeutig: mehrdeutig.length,
    uebergangen: uebergangen.length,
    // WAS DIE KACHEL DANACH IST — das ist der Teil, den man in der Oberflaeche
    // nicht sieht: Identitaet, Abschnitt der Startseite und spielende Quelle.
    kachel: kachel
      ? {
          schluessel: kachel.schluessel,
          geschluckt: kachel.auchSchluessel,
          kategorie: kachel.kategorie,
          spielt: kachel.quellen[0]?.dienst,
          titel: kachel.titel,
        }
      : null,
  }
})

if (alsJson) {
  console.log(JSON.stringify({ faelle: ergebnisse }, null, 2))
} else {
  for (const e of ergebnisse) {
    if (e.stimmt && !alle) continue
    const marke = e.stimmt ? 'ok    ' : e.bekannt ? 'bekannt' : e.zusammen ? 'ZUVIEL' : 'FEHLT '
    console.log(`${marke}  ${e.name}`)
    console.log(`        ${e.warum}`)
    if (!e.stimmt && e.bekannt) console.log(`        bekannt: ${e.bekannt}`)
    console.log(`        ${e.vorher} -> ${e.nachher} Kacheln, erwartet ${e.erwartet ? 'EINE' : 'ZWEI'}`)
    if (e.kachel) {
      console.log(
        `        Kachel: „${e.kachel.titel}"  Identitaet ${e.kachel.schluessel}` +
          `  Abschnitt ${e.kachel.kategorie}  spielt ueber ${e.kachel.spielt}`,
      )
      console.log(`        geschluckt: ${e.kachel.geschluckt.join(', ')}`)
    }
    console.log('')
  }
  const schief = ergebnisse.filter((e) => !e.stimmt)
  const neu = schief.filter((e) => !e.bekannt)
  console.log(`${ergebnisse.length} Faelle, ${schief.length} abweichend (${schief.length - neu.length} davon bekannt).`)
}

process.exit(ergebnisse.some((e) => !e.stimmt && !e.bekannt) ? 1 : 0)

// Nur damit `fileURLToPath` nicht als ungenutzt gilt — es dokumentiert, dass
// dieses Werkzeug ein Programm ist und kein Baustein zum Einbinden.
void fileURLToPath(import.meta.url)
