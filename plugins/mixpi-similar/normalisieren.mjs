/**
 * Namen vergleichbar machen — und die Grenze, wo das aufhoert.
 *
 * ══ WOZU ══════════════════════════════════════════════════════════════════
 *
 * Vier Dienste nennen dieselbe Serie vier Mal anders:
 *
 *     "Pettersson und Findus"          MusicBrainz
 *     "Pettersson & Findus"            Deezer
 *     "Pettersson Und Findus"          Last.fm (Grossschreibung aus der Datenbank)
 *     "Pettersson und Findus (Hoerspiel)"  irgendein Katalog
 *
 * Ohne einen gemeinsamen Schluessel steht dieselbe Serie vier Mal im Ergebnis
 * und keine der vier Nennungen erreicht die Schwelle `mindestensQuellen`.
 *
 * ══ WARUM DAS NICHT DIE IDENTITAET IST ════════════════════════════════════
 *
 * Der kanonische Schluessel ist die MBID, nicht dieser Text. Die Normalform ist
 * nur der RUECKFALL fuer Treffer ohne MBID — und sie ist bewusst grob:
 * Diakritika weg, Und-Zeichen ausgeschrieben, Klammerzusaetze weg.
 *
 * DAS FASST AUCH ZUSAMMEN, WAS NICHT ZUSAMMENGEHOERT. Zwei verschiedene
 * Interpreten, die sich nur in einem Klammerzusatz unterscheiden, werden hier
 * einer. Das ist der Preis, und er ist bewusst bezahlt: im Ergebnis stehen
 * Vorschlaege fuer ein Kind, kein Katalogeintrag. Wer daraus je eine
 * Abrechnung baut, braucht die MBID, nicht diese Funktion.
 */

/**
 * Zusaetze, die ein Katalog an den Namen haengt und die nichts unterscheiden.
 * Bewusst KURZ gehalten — jeder Eintrag hier faltet zwei Namen zu einem, und
 * eine lange Liste faltet irgendwann zwei Interpreten zusammen.
 *
 * `h(?:oe|o)r` FAENGT DREI SCHREIBWEISEN, und das ist kein Uebereifer: dieser
 * Ausdruck laeuft ERST NACH dem Wegnehmen der Diakritika, aus „Hörspiel" ist
 * dort schon „horspiel" geworden. Ein Muster, das nur „hörspiel" und
 * „hoerspiel" kennt, greift also ausgerechnet bei der Schreibweise nicht, die
 * an dieser Stelle wirklich ankommt (gemessen: „Bärenbude (Hörspiel)" wurde zu
 * „barenbude horspiel", der Zusatz blieb stehen).
 */
const ZUSAETZE = /\s*[([](?:h(?:oe|ö|o)r(?:spiel|buch)|audio|band|musik|official)[^)\]]*[)\]]/giu

/**
 * Ein Name in seiner Vergleichsform.
 *
 * DIE REIHENFOLGE DER SCHRITTE IST DER PUNKT, nicht die einzelne Regel:
 * das Und-Zeichen muss VOR dem Wegwerfen der Sonderzeichen ersetzt werden,
 * sonst wird aus "Pettersson & Findus" ein "pettersson findus" und aus
 * "Pettersson und Findus" ein "pettersson und findus" — zwei Schluessel.
 */
export function normalName(name) {
  if (typeof name !== 'string') return ''
  return (
    name
      // ══ DEUTSCHE UMLAUTE WERDEN AUSGESCHRIEBEN, NICHT ENTSCHAERFT ═══════
      //
      // Und das MUSS vor dem NFD-Schritt stehen. Am echten Bestand der Box
      // gemessen (06.09.2026): sie fuehrt „Hello Kitty Hörspiele", die
      // Themenkarte „Hello Kitty Hoerspiele". Wer nur die Diakritika
      // wegnimmt, bekommt „horspiele" gegen „hoerspiele" — zwei Schluessel
      // fuer dieselbe Serie, und der Eintrag ist nicht zu finden.
      //
      // Ausgeschrieben fallen beide auf „hoerspiele" zusammen. Der Preis ist
      // bekannt und bezahlt: fremdsprachige Namen mit „ö" werden laenger als
      // ihre Vorlage. Fuer einen Baum voller deutscher Kinderhoerspiele ist
      // das die richtige Seite des Handels.
      .replace(/ä/gu, 'ae')
      .replace(/ö/gu, 'oe')
      .replace(/ü/gu, 'ue')
      .replace(/Ä/gu, 'Ae')
      .replace(/Ö/gu, 'Oe')
      .replace(/Ü/gu, 'Ue')
      .replace(/ß/gu, 'ss')
      .normalize('NFD')
      // Diakritika: "Bärenbude" und "Barenbude" sind derselbe Sender.
      // `\p{M}` statt eines getippten Zeichenbereichs — die kombinierenden
      // Zeichen stehen in mehreren Unicode-Bloecken, und ein Bereich, den man
      // von Hand hinschreibt, erwischt die haelfte davon nicht.
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(ZUSAETZE, ' ')
      // Und-Zeichen VOR den Sonderzeichen — siehe oben.
      .replace(/&/gu, ' und ')
      // Alles, was kein Buchstabe und keine Ziffer ist, wird ein Leerzeichen.
      // \p{L} statt [a-z]: "Räuber Hotzenplotz" hat nach dem NFD-Schritt zwar
      // keine Umlaute mehr, aber kyrillische oder skandinavische Namen kommen
      // vor und sollen nicht zu Staub zerfallen.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/gu, ' ')
  )
}

/**
 * Sind das zwei Nennungen derselben Sache?
 *
 * NUR GLEICHHEIT, KEINE AEHNLICHKEIT. Eine Levenshtein-Distanz waere hier
 * verlockend und falsch: "Benjamin Bluemchen" und "Bibi Blocksberg" sind zwei
 * Serien desselben Verlags mit aehnlicher Schreibung, und ein Kind, das die
 * eine hoert, bekaeme die andere als "dasselbe" untergeschoben statt als
 * Vorschlag. Wer Toleranz will, nimmt die MBID-Aufloesung.
 */
export function gleicherName(a, b) {
  const x = normalName(a)
  return x !== '' && x === normalName(b)
}
