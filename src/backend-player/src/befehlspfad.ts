/**
 * Die ADRESSE aus einem Abspielbefehl holen — rein und pruefbar.
 *
 * WOZU: Die Oberflaechen sprechen den Abspieldienst ueber Pfade an
 * (sonos-kids-controller-Erbe), und ein Stream-Befehl sieht so aus:
 *
 *     /<raum>/<verb>/<kodierte Adresse>/<Titel>:title:artist:<Interpret>
 *
 * `path.parse()` schneidet den letzten Teil als `base` ab; uebrig bleibt
 * `dir` = `/<raum>/<verb>/<kodierte Adresse>`. Diese Datei holt daraus die
 * Adresse.
 *
 * WARUM NICHT `dir.split('<verb>/').pop()`, wie es die aelteren Zweige tun:
 * das sucht eine ZEICHENKETTE, wo eine STELLE gemeint ist. Bei einem Raum,
 * dessen Name auf das Verb endet (`/standard/ard/…` enthaelt „ard/" zweimal),
 * schneidet es an der falschen Stelle. Genau diese Fehlerklasse hat der
 * Dienst schon einmal bezahlt — beim Verb selbst, das frueher mit
 * `dir.includes(...)` erkannt wurde und bei einer Adresse mit dem Wort darin
 * den falschen Zweig zog (siehe die Begruendung an `const verb` in
 * spotify-control.ts). Hier wird deshalb nach POSITION zerlegt.
 *
 * ES WIRD NIE GEWORFEN. `decodeURIComponent` wirft bei einem einzelnen `%`
 * im Pfad (`URIError`), und ein geworfener Fehler im Befehlszweig ist eine
 * 500er Antwort statt Ton. Eine unkodierbare Adresse wird roh
 * zurueckgegeben — dann scheitert hoechstens der Abspieler, und zwar
 * sichtbar an der richtigen Stelle.
 */

/**
 * Das VERB eines Befehls — die zweite Stelle, nicht irgendein Vorkommen.
 *
 * WARUM DAS EINE EIGENE FUNKTION IST UND NICHT `dir.includes('radio')`:
 * Am 04.08.2026 gemessen (tools/ard-modul-probe.ts zweige) — die ARD
 * Audiothek liefert alles von Deutschlandfunk und Deutschlandradio ueber den
 * Ausspielpartner
 *
 *     podcast-mp3.dradio.de
 *
 * und „dradio" ENTHAELT „radio". Ein ARD-Befehl fuer eine Kakadu-Folge (das
 * Kinderhoerspiel des Deutschlandfunks, also genau die Sorte Kachel, um die
 * es bei E4 geht) zog damit ZUSAETZLICH den Radio-Zweig: `currentType` stand
 * kurz auf 'radio' (Endlosstrom — keine Dauer, kein Springen), und
 * `dir.split('radio/').pop()` fand kein „radio/" und gab den GANZEN Pfad
 * zurueck, der dann als Adresse abgespielt wurde. Zwei Ladevorgaenge fuer
 * einen Antipper, einer davon Unsinn.
 *
 * Dieselbe Falle hatte der Dienst schon beim Verb selbst (frueher
 * `dir.includes(...)`, siehe die Begruendung an `const verb` in
 * spotify-control.ts) — sie kam ueber die ANDEREN Zweige zurueck, weil die
 * Umstellung dort stehengeblieben war. Eine Stelle, an der nach POSITION
 * zerlegt wird, ist die Antwort auf beide.
 *
 * KLEINGESCHRIEBEN wird bewusst: ein von Hand abgeschickter Befehl mit
 * grossem Anfangsbuchstaben soll nicht stillschweigend ins Leere laufen. Die
 * Oberflaechen schicken ohnehin klein — es kostet also nichts und faengt den
 * Fall ab, in dem jemand den Dienst von Hand anspricht.
 *
 * @param dir  `/<raum>/<verb>/…`  (aus `path.parse(req.url).dir`)
 * @returns    das Verb in Kleinschreibung, oder '' wenn keines da ist
 */
export function verbAusPfad(dir: string | null | undefined): string {
  return (
    String(dir ?? '')
      .split('/')
      .filter(Boolean)[1] ?? ''
  ).toLowerCase()
}

/**
 * Die Adresse aus `path.parse(req.url).dir`.
 *
 * @param dir  `/<raum>/<verb>/<kodierte Adresse>`
 * @returns    die dekodierte Adresse, oder '' wenn keine da ist
 */
export function adresseAusPfad(dir: string | null | undefined): string {
  const teile = String(dir ?? '')
    .split('/')
    .filter(Boolean)
  // 0 = Raum, 1 = Verb, ab 2 die Adresse. Sie ist kodiert und enthaelt
  // deshalb normalerweise keinen Schraegstrich — zusammengefuegt wird
  // trotzdem, damit eine unkodierte Adresse nicht stillschweigend am
  // ersten Schraegstrich abgeschnitten wird.
  const roh = teile.slice(2).join('/')
  if (!roh) return ''
  try {
    return decodeURIComponent(roh)
  } catch {
    return roh
  }
}

/**
 * Der TITELNAME aus dem letzten Stueck eines Befehls (`path.parse(url).name`).
 *
 * Die Oberflaechen haengen an jeden Stream-Befehl an:
 *
 *     <Titel>:title:artist:<Interpret>
 *
 * Die Zweige `radio`/`rss`/`jellyfin`/`ard` in spotify-control.ts zerlegen das
 * seit jeher von Hand. Hier steht dasselbe noch einmal — mit EINEM
 * Unterschied, und der ist der Grund fuer diese Funktion:
 *
 * SIE WIRFT NICHT. `decodeURIComponent` wirft bei einem einzelnen `%`
 * (`URIError`). In den vorhandenen Zweigen ist das ein Fehler, den es dort
 * schon immer gab. Der Zweig `jfqueue`/`ardqueue` hat den Namen bis zum
 * 06.08.2026 gar nicht angefasst — er kann also nicht mit einem neuen Wurf
 * anfangen, nur weil er ihn jetzt LIEST. Ein Anhaengen, das eine 500er Antwort
 * gibt, reisst mitten in einer Sendung mit 30 Folgen die halbe Warteschlange
 * weg; ein Titelname, der roh statt dekodiert dasteht, ist ein
 * Schoenheitsfehler.
 *
 * @param name  `path.parse(req.url).name`
 * @returns     der Titel, oder '' wenn keiner da ist
 */
export function titelAusName(name: string | null | undefined): string {
  const roh = String(name ?? '')
  if (!roh) return ''
  let text = roh
  try {
    text = decodeURIComponent(roh)
  } catch {
    /* unkodierbar: roh nehmen, aber nicht werfen */
  }
  return text.split(':title:artist:')[0]
}

/**
 * WIE WEIT IN DEN TITEL HINEIN GESTARTET WIRD — der Vorspann-Sprung.
 *
 * Betreiber (15.08.2026): „ard sounds funktion jingle überspringen es gibt
 * immer einen anfangs jingle der bei allen gleich ist". An vier Folgen von
 * „MausHoerspiel kurz" gemessen (scripts/box/ard-vorspann-messen.py): 5,25 s
 * gemeinsamer Anfang, bei allen sechs Paaren.
 *
 * DIE ZAHL REIST IM BEFEHL MIT, hinten angehaengt:
 *
 *     <Titel>:title:artist:<Interpret>:ab:5
 *
 * WARUM DORT UND NICHT IN EINER DATEI, DIE DER ABSPIELDIENST LIEST: Der
 * Sprung gilt je SENDUNG, und welche Sendung gerade laeuft, weiss nur, wer
 * den Befehl schickt. Wer hier eine zweite Ablage aufmachte, haette zwei
 * Wahrheiten ueber denselben Wert.
 *
 * UND WARUM ES AUCH BEIM AUTOMATISCHEN WEITERRUECKEN GILT: die Zahl wird
 * nicht nach dem Start „hinterhergesprungen", sondern mpv als DATEI-OPTION
 * mitgegeben (`start`, siehe ladeBefehl in mpv-protokoll.ts). Damit traegt
 * sie jeder Eintrag der Warteschlange bei sich — auch der, den mpv Stunden
 * spaeter von selbst erreicht.
 *
 * NUR DAS LETZTE `:ab:` ZAEHLT und nur reine Zahlen: ein Titel oder
 * Interpret, der zufaellig „:ab:" enthaelt, darf den Start nicht verstellen.
 * Ohne Angabe kommt 0 heraus — der Befehl von gestern verhaelt sich damit
 * Zeichen fuer Zeichen wie vorher.
 */
export function abAusName(name: string | null | undefined): number {
  const roh = String(name ?? '')
  if (!roh) return 0
  let text = roh
  try {
    text = decodeURIComponent(roh)
  } catch {
    /* wie oben: roh nehmen, nicht werfen */
  }
  const stelle = text.lastIndexOf(':ab:')
  if (stelle < 0) return 0
  const zahl = Number(text.slice(stelle + 4))
  if (!Number.isFinite(zahl) || zahl <= 0) return 0
  // Eine halbe Stunde Vorspann gibt es nicht — was darueber steht, ist ein
  // Fehlgriff und darf keine Folge unhoerbar machen.
  return Math.min(zahl, 600)
}

/**
 * DER PLATTENPFAD EINES LOKALEN ALBUMS — aus `<kategorie>:<interpret>:<titel>`.
 *
 * Jedes Segment kommt encodeURIComponent-kodiert an (`startPlan` in
 * spielfunktion.ts fuer die neue Oberflaeche, media-provider.ts fuer die
 * klassische — beide bauen mit `encodeURIComponent`; die dritte Stelle war
 * `abspielBefehl` in NewDesign/app.js und ist seit E95/V Stufe 3 in
 * `startPlan` aufgegangen). Das Gegenstueck ist decodeURIComponent JE
 * SEGMENT — und genau das stand hier nie:
 *
 * AM GERAET GEMESSEN (31.08.2026, „Guten Morgen / Good Morning", Interpret
 * „Team Karacho, Rola"): `playList` nahm `decodeURI(...)`, und decodeURI
 * laesst die reservierten Zeichen KODIERT stehen — `%2C` (Komma), `%26` (&),
 * `%2B` (+), `%23` (#). Der m3u-Pfad hiess dann
 * `media/audiobook/Team Karacho%2C Rola/…/playlist.m3u`, den Ordner gibt es
 * nicht, mplayer bekam eine leere Liste — und die Buchfuehrung meldete
 * trotzdem „spielt" (writeplayerstatePlay steht VOR dem Laden). Ton kam nie.
 * Die Titelzaehlung darunter dekodierte ZWEISTUFIG (decodeURIComponent auf
 * das decodeURI-Ergebnis), fand den echten Ordner und zaehlte froehlich 3 —
 * zwei Wahrheiten in derselben Funktion, und die falsche machte den Ton.
 * Betroffen war jeder Mitschnitt mit Komma im Interpreten — auf dieser Box
 * die halbe Aufnahme-Bibliothek („Team Karacho, Rola", „Simone Sommerland,
 * Karsten Glück, …", „101 fabelhafte Freunde, Ruby van der Bogen").
 *
 * ERST TRENNEN, DANN DEKODIEREN — die Reihenfolge ist der Punkt: die `:`
 * zwischen den Segmenten sind Trenner und stehen ROH da; ein `:` IM Inhalt
 * kaeme als `%3A` an und bleibt nach dem Split im Segment, wo
 * decodeURIComponent es zum Zeichen macht, ohne dass ein neuer Trenner
 * entsteht.
 *
 * ES WIRD NIE GEWORFEN (dieselbe Regel wie `titelAusName`): ein unkodierbares
 * Segment bleibt roh stehen — ein schiefer Ordnername spielt nichts, eine
 * geworfene URIError risse den Dienst um.
 */
export function medienPfadAus(name: string | null | undefined): string {
  return String(name ?? '')
    .split(':')
    .map((teil) => {
      try {
        return decodeURIComponent(teil)
      } catch {
        return teil
      }
    })
    .join('/')
}

/**
 * DARF DIESE DATEI GESPIELT WERDEN? — der Zaun der `datei`/`dateiqueue`-Verben.
 *
 * Die beiden Verben (E108) nehmen einen VOLLEN Dateipfad entgegen — anders als
 * `musicsearch/library`, das nur `<kategorie>:<interpret>:<album>` kennt und
 * den Rest selbst unter den Medienordner haengt. Ein Pfad-Verb OHNE Zaun
 * spielte jede lesbare Datei der Karte ab: Port 5005 hoert zwar nur auf
 * 127.0.0.1 (siehe `server.listen` unten in spotify-control.ts), aber der
 * `/player`-Proxy des backend-api reicht Befehle aus dem ganzen Netz durch —
 * derselbe Grund, aus dem die Kinderzeit am Proxy sitzt.
 *
 * GEPRUEFT WIRD DIE FORM, NICHT DAS DATEISYSTEM: kein `fs` in dieser Datei
 * (Dateikopf-Regel). Ein `..`-Segment faellt durch, egal wie kodiert es ankam —
 * der Aufrufer reicht den DEKODIERTEN Pfad herein (`adresseAusPfad`). Ein
 * NUL-Byte faellt mit durch: es beendet in C-Schnittstellen die Zeichenkette
 * und machte aus dem Praefix-Vergleich eine Luege.
 *
 * SYMLINKS FAENGT DAS BEWUSST NICHT — wer einen Verweis IN den Medienordner
 * legt, ist der Betreiber selbst (der Ordner gehoert dietpi). Der Zaun haelt
 * Befehle auf, nicht Administratoren.
 */
export function dateiPfadErlaubt(pfad: string | null | undefined, basis = '/home/dietpi/MuPiBox/media/'): boolean {
  const p = String(pfad ?? '')
  if (!p.startsWith(basis)) return false
  if (p.includes('\0')) return false
  // `..` als SEGMENT, nicht als Zeichenfolge: „Rock..Pop" ist ein gueltiger
  // Ordnername, `a/../b` ist ein Ausbruch.
  if (p.split('/').includes('..')) return false
  return true
}
