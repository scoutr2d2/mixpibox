/**
 * DER LEERLAUF-ARBEITER — die reinen Teile (E66).
 *
 * `auftrag.mjs` sagt, OB und WAS. Hier steht, WIE: welcher Knoten abgegriffen
 * wird und mit welchen Schaltern Soloist startet. Beides rein, damit die drei
 * Fallen aus dem Backlog pruefbar sind statt nur beschrieben.
 *
 * ══ FALLE 1: DER KNOTENNAME KOLLIDIERT ═════════════════════════════════════
 *
 * Zwei Soloist-Instanzen erzeugen BEIDE einen Knoten namens `spotify`. Wer
 * ueber den Namen abgreift, erwischt womoeglich den Familienstrom — und sieht
 * dabei aus, als arbeite er: es kommt Ton, er wird aufgenommen, nur eben der
 * falsche. Ein Fehler, der sich als Erfolg tarnt.
 *
 * ALSO UEBER DIE PROZESSKENNUNG. Am 21.08.2026 an der Box gemessen, und die
 * Messung hat den Entwurf geaendert:
 *
 *     pw-cli ls Node   ->  0 Knoten fuehren application.process.id
 *     pw-dump          ->  8 Knoten fuehren sie
 *
 * Der naheliegende Weg (`pw-cli`, den das Plugin sonst benutzt) traegt die
 * Kennung nicht. Es muss `pw-dump` sein, also JSON statt Text.
 *
 * ══ FALLE 2: OHNE -d HOERT DIE FAMILIE DEN MITSCHNITT MIT ══════════════════
 *
 * Ein zweiter Strom auf demselben Lautsprecher ist genau die Form, die in E63
 * als Echo gemeldet wurde. Der Mitschnitt braucht eine eigene Senke — eine,
 * die niemand hoert. Ohne sie ist die Aufnahme nicht bloss unschoen, sondern
 * stoert das Hoeren, fuer das die Box da ist.
 *
 * ══ FALLE 3: DER SCHLUESSEL STEHT IN DER BEFEHLSZEILE ══════════════════════
 *
 * Und damit in `ps`. Bekannte Grenze, in soloist-start.sh dokumentiert;
 * Soloist kennt keinen anderen Weg. Hier wird sie nicht geloest, aber auch
 * nicht vergroessert: der Schluessel wird durchgereicht und NIRGENDS
 * protokolliert. `befehlZumZeigen()` gibt dieselbe Zeile mit verdecktem
 * Schluessel — fuer Journal und Fehlermeldungen.
 */

/** Was ein Knoten in `pw-dump` ist. */
const KNOTEN_ART = 'PipeWire:Interface:Node'
const CLIENT_ART = 'PipeWire:Interface:Client'

/**
 * Der Knoten EINES BESTIMMTEN PROZESSES — ueber zwei Schritte, nicht einen.
 *
 * ══ WARUM ZWEI SCHRITTE ════════════════════════════════════════════════════
 *
 * Die erste Fassung suchte den Knoten direkt ueber `application.process.id`.
 * AM GERAET GEMESSEN (21.08.2026): Soloists Knoten traegt sie GAR NICHT:
 *
 *     application.name  Spotify
 *     client.id         75
 *     node.name         spotify
 *     media.class       Stream/Output/Audio
 *
 * Die Kennung sitzt eine Ebene tiefer, am CLIENT — und der Knoten verweist
 * mit `client.id` auf ihn. Also: Prozess -> Client -> Knoten.
 *
 * ══ UND MEHRERE PROZESSE, NICHT EINER ══════════════════════════════════════
 *
 * Soloist spaltet Kinder ab (unter anderem einen Absturzsammler). Welcher
 * davon den Ton fuehrt, ist nicht zugesichert. Deshalb nimmt diese Funktion
 * eine MENGE von Kennungen — der Aufrufer reicht den Prozessbaum herein.
 *
 * Das haelt Falle 1 trotzdem geschlossen: zwei Soloist-Instanzen heissen beide
 * `spotify`, aber ihre Prozessbaeume sind verschieden.
 */
export function knotenFuerPid(dump, pid) {
  const kennungen = new Set(
    (Array.isArray(pid) ? pid : [pid]).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0),
  )
  if (kennungen.size === 0) return null

  let liste = dump
  if (typeof dump === 'string') {
    try {
      liste = JSON.parse(dump)
    } catch {
      // EINE UNLESBARE AUSGABE HEISST „UNBEKANNT", NICHT „KEIN KNOTEN".
      // Der Aufrufer darf daraus nicht schliessen, dass nichts spielt.
      return null
    }
  }
  if (!Array.isArray(liste)) return null

  // Schritt 1: die Clients, die zu unseren Prozessen gehoeren.
  const unsere = new Set()
  for (const o of liste) {
    if (!o || o.type !== CLIENT_ART) continue
    const p = o?.info?.props ?? {}
    if (kennungen.has(Number(p['application.process.id']))) unsere.add(Number(o.id))
  }

  // Schritt 2: der Knoten, der an einem davon haengt. ODER — falls eine
  // kuenftige Fassung die Kennung doch am Knoten fuehrt — direkt dort.
  for (const o of liste) {
    if (!o || (o.type && o.type !== KNOTEN_ART)) continue
    const props = o?.info?.props ?? {}
    const direkt = kennungen.has(Number(props['application.process.id']))
    const ueberClient = unsere.has(Number(props['client.id']))
    if (!direkt && !ueberClient) continue
    const name = props['node.name']
    // OHNE NAMEN NUTZT DER KNOTEN NICHTS: `pw-link` spricht Ports ueber
    // `<name>:output_FL` an. Eine Kennung allein reicht nicht.
    if (typeof name !== 'string' || !name) continue
    // ── UND OHNE SERIENNUMMER NUTZT DER NAME NICHTS ───────────────────────
    //
    // BEIDE Soloist-Instanzen heissen `spotify`. Wer den Abgriff ueber den
    // NAMEN legt, trifft bei laufender Familienwiedergabe die falsche — genau
    // das hat am 22.08.2026 vier Mitschnitte still gemacht und zwei weitere
    // zur Haelfte mit der Familienwiedergabe gefuellt.
    //
    // `object.serial` ist der einzige Griff, den PipeWire NIE wiederverwendet
    // und der nie doppelt vorkommt. `pw-record --target` nimmt genau ihn
    // („Set node target serial or name"). AM GERAET GEMESSEN (23.08.2026):
    //     --target <object.serial>  ->  haengt an mixpi-mitschnitt:monitor
    //     OHNE --target             ->  haengt an alsa_output…:monitor
    // Die Id taugt NICHT als Ersatz: sie stimmte in der Messung nur zufaellig
    // mit der Seriennummer ueberein (33 = 33) und tut das im Allgemeinen nicht.
    const serial = Number(props['object.serial'])
    return { id: Number(o.id), name, serial: Number.isFinite(serial) ? serial : null }
  }
  return null
}

/**
 * Die Schalter, mit denen Soloist EINEN Titel aufnimmt.
 *
 * `--single-track` spielt ein Stueck und beendet sich danach. Das ersetzt das
 * Raten aus E64a: heute entscheidet eine 97-%-Schwelle ueber Vollstaendigkeit;
 * ein Prozess, der sich am Ende des Stuecks selbst beendet, ist ein HARTES
 * Signal.
 *
 * `-D`/`-C` trennen Daten und Zwischenspeicher vom Familienstrom — zwei
 * Instanzen im selben Datenordner traeten sich gegenseitig auf die Anmeldung.
 */
export function aufnahmeArgumente({ name, schluessel, uri, senke, datenOrdner, cacheOrdner }) {
  if (!name || !schluessel || !uri) return null
  // OHNE SENKE KEIN BEFEHL — Falle 2. Lieber gar nicht aufnehmen als der
  // Familie in den Lautsprecher spielen; das Stueck steht ja auf der Liste
  // und laeuft nicht weg.
  if (!senke) return null

  const args = ['-n', String(name), '-k', String(schluessel), '--single-track', String(uri), '-d', String(senke)]
  if (datenOrdner) args.push('-D', String(datenOrdner))
  if (cacheOrdner) args.push('-C', String(cacheOrdner))
  return args
}

/**
 * Dieselben Schalter, aber mit verdecktem Schluessel.
 *
 * FUER JEDE AUSGABE. Der Schluessel steht schon in `ps` (Falle 3, nicht
 * loesbar); ihn zusaetzlich ins Journal zu schreiben waere eine zweite
 * Fundstelle, die sich vermeiden laesst. Wer die Zeile spaeter liest, will
 * ohnehin wissen, WELCHER Titel und WELCHE Senke — nicht den Schluessel.
 */
export function befehlZumZeigen(args) {
  if (!Array.isArray(args)) return ''
  const raus = []
  for (let i = 0; i < args.length; i++) {
    raus.push(args[i])
    if (args[i] === '-k' && i + 1 < args.length) {
      raus.push('spak_<verborgen>')
      i++
    }
  }
  return raus.join(' ')
}

/**
 * Wie ein beendeter Aufnahmelauf zu deuten ist.
 *
 * DAS HARTE SIGNAL: `--single-track` beendet sich VON SELBST, wenn das Stueck
 * durch ist. Ein Rueckgabewert 0 heisst also „ganz gespielt". Alles andere
 * heisst „abgebrochen" — und der Grund gehoert in die Liste, damit der Eintrag
 * nach drei Anlaeufen sichtbar liegen bleibt statt still zu verschwinden.
 *
 * EIN ABBRUCH DURCH DIE ZEITSPERRE IST KEIN FEHLER DES TITELS, sondern einer
 * der Umstaende — er wird deshalb eigens benannt. Wer ihn als Titelfehler
 * zaehlt, verbraucht drei Anlaeufe an einem Netzproblem.
 */
export function laufDeuten({ code, signal, ausgabe, frist }) {
  if (frist) return { fertig: false, grund: 'Zeitsperre — der Lauf dauerte laenger als erlaubt' }
  if (signal) return { fertig: false, grund: `abgebrochen (Signal ${signal})` }
  if (code === 0) return { fertig: true, grund: '' }
  const erste = String(ausgabe ?? '')
    .split('\n')
    .map((z) => z.trim())
    .find((z) => z.length > 0)
  return { fertig: false, grund: erste ? `Soloist endete mit ${code}: ${erste}` : `Soloist endete mit ${code}` }
}

/**
 * Die Schalter, mit denen `pw-record` den Mitschnitt abgreift.
 *
 * ══ WARUM DAS EINE EIGENE, REINE FUNKTION IST (Befund 23.08.2026) ══════════
 * Diese Argumentliste stand mitten in `einenAufnehmen`, zwischen `spawn` und
 * Warteschleife — also an einer Stelle, die kein Zeuge erreicht. GEGENGEPROBT:
 * `--target` aus dem Aufruf entfernt, alle 195 Tests blieben GRUEN. Der
 * schwerste Fehler des ganzen Befundes war nicht pruefbar.
 *
 * ══ WAS OHNE `--target` PASSIERT ══════════════════════════════════════════
 * `pw-record` sucht sich dann die Standardquelle SELBST. Am Geraet
 * vorgefuehrt (23.08.2026):
 *     mit --target <serial>  ->  |<- mixpi-mitschnitt:monitor_FL
 *     OHNE --target          ->  |<- alsa_output…stereo-fallback:monitor_FL
 * Das zweite ist der LAUTSPRECHER. Aufgenommen wird dann, was die Familie
 * gerade hoert — und wenn sie nichts hoert, digitale Null ueber die volle
 * Laufzeit. Genau so entstanden am 22.08.2026 vier stille Mitschnitte.
 *
 * ══ WARUM DIE SERIENNUMMER UND NICHT DER NAME ═════════════════════════════
 * Beide Soloist-Instanzen heissen `spotify`. Und nicht die Id: `pw-record`
 * nimmt laut eigener Hilfe „node target serial or name"; dass Id und
 * Seriennummer in der Messung uebereinstimmten (33 = 33), war Zufall.
 *
 * OHNE SERIENNUMMER GIBT ES KEINEN BEFEHL — wie bei `aufnahmeArgumente` und
 * der fehlenden Senke. Lieber nicht aufnehmen als etwas aufnehmen, von dem
 * niemand weiss, was es ist.
 */
export function mitschnittArgumente({ knotenName, serial, rate, ziel }) {
  if (typeof knotenName !== 'string' || !knotenName) return null
  if (typeof ziel !== 'string' || !ziel) return null
  const s = Number(serial)
  if (!Number.isFinite(s) || s <= 0) return null
  const r = Number(rate)
  if (!Number.isFinite(r) || r <= 0) return null
  return ['-P', `{ node.name = "${knotenName}" }`, '--target', String(s), '--rate', String(r), ziel]
}

/**
 * Die `-metadata`-Schalter zu einer Tag-Liste. Pure.
 *
 * LEERE WERTE FALLEN WEG, nicht als leerer Tag hinein: ein `artist=` in der
 * Datei ist schlimmer als kein `artist`, weil jede Musikverwaltung ihn als
 * „ausdruecklich leer" liest und den Rueckfall auf den Ordnernamen verliert.
 *
 * WOZU EIGEN UND REIN (E135/1c, 10.09.2026): Diese Zeilen standen nur im
 * Live-Weg, mitten in `abschnittAblegen`. Der Nachschnitt hat sie NIE gehabt —
 * seine Dateien kamen roh aus `pw-record` und wurden bloss umbenannt. Am
 * Geraet gemessen: keinerlei Tags, kein eingebettetes Bild, keine
 * Ordner-cover.jpg. Zwei Backlog-Punkte (E135/1b „Bestand nachtaggen" und
 * E135/1c „Cover fehlen") sind derselbe Befund von zwei Seiten.
 */
export function metadatenArgumente(tags) {
  const raus = []
  for (const [schluessel, wert] of Object.entries(tags && typeof tags === 'object' ? tags : {})) {
    const w = typeof wert === 'string' ? wert.trim() : Number.isFinite(wert) ? String(wert) : ''
    if (w) raus.push('-metadata', `${schluessel}=${w}`)
  }
  return raus
}

/**
 * Die Schalter, mit denen eine FERTIGE Aufnahme ihre Tags und ihr Bild
 * bekommt — ohne den Ton neu zu berechnen. Pure. `null`, wenn Quelle oder
 * Ziel fehlen.
 *
 * `-c:a copy` IST DER GANZE PUNKT. Der Live-Weg codiert ohnehin neu (er
 * schneidet aus der Rohaufnahme), hier liegt die FLAC schon fertig da: sie
 * noch einmal durch den Codierer zu schicken kostet auf dieser Box Minuten
 * und gewinnt kein Bit. Es wird nur der Behaelter neu geschrieben.
 *
 * QUELLE UND ZIEL MUESSEN VERSCHIEDEN SEIN — ffmpeg kann nicht in die Datei
 * schreiben, aus der es liest; es entstuende eine leere. Der Aufrufer legt
 * deshalb eine zweite Zwischendatei an und benennt danach um.
 */
export function veredelungsArgumente(wunsch) {
  // NICHT IM KOPF ZERLEGEN: `veredelungsArgumente(null)` warf dort einen
  // TypeError, statt „kein Befehl" zu sagen — und im Aufrufer steht dieser
  // Ruf in einem try, das die rohe Aufnahme retten soll. Ein Absturz haette
  // diese Rettung uebersprungen. Vom eigenen Zeugen gefunden, 10.09.2026.
  if (!wunsch || typeof wunsch !== 'object') return null
  const { quelle, ziel, bild = null, tags = {} } = wunsch
  if (typeof quelle !== 'string' || !quelle) return null
  if (typeof ziel !== 'string' || !ziel) return null
  if (quelle === ziel) return null
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', quelle]
  if (typeof bild === 'string' && bild) {
    // Wortgleich zum Live-Weg: als angeheftetes Bild markiert, sonst haelt es
    // jeder Abspieler fuer eine Videospur.
    args.push('-i', bild, '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic')
  } else {
    args.push('-map', '0:a')
  }
  args.push('-c:a', 'copy', ...metadatenArgumente(tags), ziel)
  return args
}
