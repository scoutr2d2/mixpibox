/**
 * WELCHES BILD GEHOERT ZU DEM, WAS GERADE LAEUFT? — dienstneutral beantwortet.
 *
 * ══ WARUM DIESE DATEI EXISTIERT ════════════════════════════════════════════
 *
 * Betreiber, 11.09.2026: „die oberfläche sollte garnichts vom dienst direkt
 * bekommen" und, auf einen zu eng geratenen Gegenvorschlag: „es kann ja auch
 * ein anderer dienst sein ... die oberfläche soll keine dienste kennen
 * müssen." Die Regel steht als Entwurfsentscheidung im Wissenspaket
 * [oberflaeche-kennt-keine-dienste].
 *
 * Bis hierher beantwortete die OBERFLAECHE diese Frage, und zwar mit einer
 * Kette, die nach Dienst verzweigt (`NewDesign/app.js`, `coverAdresse`): bei
 * `lokal` ueber die Coverkarte, sonst ueber `zustand.dienst.item.album.
 * images[0].url` — eine Spotify-CDN-Adresse, mitten im Frontend. Der
 * Kommentar dort benennt den Vertragsbruch sogar selbst und begruendet ihn
 * mit „wer Spotify hoert, hat ohnehin Netz".
 *
 * Der eigentliche Fehler ist nicht die Adresse, sondern die VERZWEIGUNG. Wer
 * nach Dienst verzweigt, fuehrt eine Dienstliste im Frontend — und muss sie
 * bei jedem neuen Dienst nachziehen. Die ARD hat es vorgefuehrt: sie kam im
 * August 2026 dazu, und die Kette kennt sie bis heute nicht.
 *
 * ══ WAS HIER RICHTIG IST, UND WAS NICHT HIERHER GEHOERT ════════════════════
 *
 * Diese Datei ist PUR: rein hinein, rein heraus, kein Netz, keine Uhr, kein
 * Dateisystem — nach dem Vorbild von `jellyfin.ts` und `ard.ts`. Sie sagt,
 * WELCHE Adresse gilt. Sie holt nichts und entscheidet nicht, wie die Bytes
 * zum Browser kommen; das tut die Route, die sie ruft.
 *
 * ══ DER EPISODEN-FALL, DER DAS AUSGELOEST HAT ══════════════════════════════
 *
 * Am Geraet nachgestellt (Box .62, 11.09.2026, „Quarks Science Cops"): Bei
 * `currently_playing_type: 'episode'` ist `item.album` NICHT DA — null, nicht
 * leer. Das Bild steht an zwei anderen Stellen, `item.images` und
 * `item.show.images`, beide gefuellt. Wer nur `album.images` liest, bekommt
 * bei JEDEM Podcast nichts. Deshalb stehen hier drei Orte statt einem.
 */

/** Was `/player/local` meldet — nur die Felder, die hier zaehlen. */
export interface LokalerStand {
  path?: unknown
  album?: unknown
  playing?: unknown
  currentTrackname?: unknown
}

/** Was `/player/state` meldet — nur die Felder, die hier zaehlen. */
export interface DienstStand {
  item?: {
    album?: { images?: { url?: unknown }[] } | null
    images?: { url?: unknown }[] | null
    show?: { images?: { url?: unknown }[] } | null
  } | null
}

/**
 * Die Coverkarte der Box: `<interpretkern>|<albumkern>` -> Bildadresse.
 * Sie wird vom Aufrufer gebaut; welcher Kern gilt, entscheidet `namensKern`.
 */
export type Coverkarte = ReadonlyMap<string, string>

function text(x: unknown): string {
  return typeof x === 'string' ? x.trim() : ''
}

function ersteAdresse(bilder: unknown): string {
  if (!Array.isArray(bilder)) return ''
  for (const b of bilder) {
    const u = text((b as { url?: unknown } | null)?.url)
    if (u) return u
  }
  return ''
}

/**
 * Der Namenskern — WORTGLEICH zu `namensKern` in NewDesign/app.js.
 *
 * Die Coverkarte ist darueber geschluesselt, und wer sie mit einem anderen
 * Kern befragt, findet nichts. ALLES AUSSER BUCHSTABEN UND ZIFFERN FAELLT —
 * auch Leerzeichen. Das ist nicht Bequemlichkeit, sondern der Befund vom
 * 31.08.2026 (Betreiber: „das cover fehlt … gerade bei guten morgen"): Bei
 * einem Start von aussen meldet der Abspieldienst die SANITISIERTE
 * Ordner-Schreibweise („Guten Morgen _ Good Morning"), waehrend das Werk den
 * Schraegstrich traegt. Ein woertlicher Vergleich fand das Werk nie.
 *
 * BEIM ERSTEN ENTWURF DIESER DATEI STAND HIER ETWAS ANDERES — eine Fassung
 * aus dem Gedaechtnis, die nur Trennzeichen zu Leerzeichen machte. Sie haette
 * fuer jeden mehrteiligen Namen einen anderen Schluessel gebildet als das
 * Frontend und die Karte still leerlaufen lassen. „Wortgleich" heisst
 * nachgelesen, nicht erinnert.
 */
export function namensKern(s: unknown): string {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

/**
 * Spielt ueberhaupt etwas Lokales? Nicht „ist ein Pfad da", sondern „laeuft".
 *
 * EIN STEHENGEBLIEBENER PFAD IST KEIN LAUFENDER TITEL: `/local` behaelt nach
 * dem Stoppen seine Felder. Ohne diese Frage zeigte der Schirm das Bild des
 * zuletzt gehoerten Albums, waehrend laengst etwas anderes lief — genau der
 * Fehler, den E138 an den Pegeln hatte.
 */
function lokalLaeuft(lo: LokalerStand | null | undefined): boolean {
  if (!lo) return false
  return Boolean(lo.playing) || Boolean(text(lo.currentTrackname))
}

/**
 * Die Bildadresse zum laufenden Titel — oder '' wenn es keine gibt.
 *
 * DIE REIHENFOLGE IST DIE ENTSCHEIDUNG, und sie folgt derselben Begruendung
 * wie `QUELLEN_REIHENFOLGE` in verschmelzung.ts: was die Box SELBST hat, gilt
 * vor dem, was sie erfragen muss. Ein lokaler Mitschnitt laeuft ohne Netz,
 * ohne Konto und ohne Verfallsdatum.
 *
 * `''` UND NICHT `null`: der Aufrufer unterscheidet „kein Bild bekannt" von
 * „Bild bekannt, laedt gerade nicht" — das erste ist eine Antwort, das zweite
 * ein Fehler, und die Route beantwortet sie verschieden.
 */
export function bildFuerLaufendes(
  lokal: LokalerStand | null | undefined,
  dienst: DienstStand | null | undefined,
  karte: Coverkarte,
): string {
  // 1. LOKAL, UEBER DEN PFAD. Er ist die genaueste Auskunft, die mpv gibt:
  //    „kategorie/Interpret/Album/datei.flac". Interpret und Album stehen an
  //    fester Stelle, es muss nichts geraten werden.
  if (lokalLaeuft(lokal) && karte.size) {
    const teile = text(lokal?.path).split('/')
    if (teile[1] && teile[2]) {
      const treffer = karte.get(`${namensKern(teile[1])}|${namensKern(teile[2])}`)
      if (treffer) return treffer
    }
    // 2. UEBER DAS FELD `album`, das je nach Quelle den Interpreten ODER das
    //    Album traegt. Beides wird versucht — bei Jellyfin faellt dort der
    //    Interpret an, bei einer lokalen Datei das Album. Welches von beiden
    //    es ist, sagt der Stand nicht; also wird nicht geraten, sondern
    //    beides gefragt.
    const feld = namensKern(lokal?.album)
    if (feld) {
      for (const [schluessel, bild] of karte) {
        if (schluessel.slice(0, schluessel.indexOf('|')) === feld) return bild
      }
      for (const [schluessel, bild] of karte) {
        if (schluessel.slice(schluessel.indexOf('|') + 1) === feld) return bild
      }
    }
  }

  // 3. DER DIENST, DREI ORTE. Ein Album traegt `album.images`, eine Episode
  //    `images` und `show.images` — und bei einer Episode ist `album` gar
  //    nicht da. Alle drei fragen kostet nichts und faengt beide Formen.
  const it = dienst?.item
  if (it) {
    const ausAlbum = ersteAdresse(it.album?.images)
    if (ausAlbum) return ausAlbum
    const ausItem = ersteAdresse(it.images)
    if (ausItem) return ausItem
    const ausShow = ersteAdresse(it.show?.images)
    if (ausShow) return ausShow
  }

  return ''
}

/**
 * Ist diese Adresse eine der Box — oder eine fremde?
 *
 * WOFUER: Die Route darf eine Dienstadresse nicht einfach weiterreichen, auch
 * nicht als Umleitung. Ein 302 auf `i.scdn.co` macht den Browser zum
 * Spotify-Client und bricht denselben Vertrag, nur eine Ebene tiefer. Eine
 * boxeigene Adresse darf umgeleitet werden, eine fremde muss GEHOLT werden.
 */
export function istBoxAdresse(adresse: string): boolean {
  const a = text(adresse)
  if (!a) return false
  return a.startsWith('/')
}
