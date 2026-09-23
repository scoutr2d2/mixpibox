/**
 * Netzlaufwerk: eine SMB-Freigabe als Ablage für Sicherungen und Mitschnitte
 * (BACKLOG E28/N6–N9, N15 und E29/B4).
 *
 * WORUM ES GEHT: Der Betreiber hat am 04.08.2026 vorgeschlagen, „einfach noch
 * einen NAS-Ort angeben" zu können. Am 05.08. war davon nichts da — kein
 * Netzlaufwerk eingehängt, keine fstab-Zeile, im Wissenspaket kein Wort zu
 * NAS/Samba/NFS. Neues Land. Gemessen am 20.09.2026 mit
 * `tools/nas-sonde.py --suchen`: im Heimnetz horchen 192.168.178.1 (445) und
 * 192.168.178.199 (445, 2049) — auf .199 läuft auch das Jellyfin, deshalb ist
 * es der Ort, an dem ein Mitschnitt als normaler Eintrag zurückkommt (N9).
 * Anonym antwortet .199 mit NT_STATUS_ACCESS_DENIED: es braucht ohnehin einen
 * Anmeldenamen, und damit ist SMB3 mit eigenem Nutzer die Wahl (Betreiber,
 * 20.09.2026).
 *
 * ZWEI SORTEN, EINE FORM (`art`, nachgereicht am 20.09.2026 auf Wunsch des
 * Betreibers): SMB über `mount.cifs` und WebDAV über `mount.davfs`. Die
 * Unterscheidung steht an EINER Stelle; Optionen, Einheitentyp und
 * Zugangsdatei werden daraus abgeleitet. Was sich NICHT unterscheidet, sind
 * die fünf Regeln unten — sie gelten für beide, und die Tests fahren sie auch
 * für beide. WebDAV bringt eine eigene Eigenheit mit, die keine Regel ist,
 * sondern eine Eigenschaft: es lädt über einen Zwischenspeicher AUF DER KARTE
 * hoch (siehe WEBDAV_ZWISCHENSPEICHER_MIB). Wer ein Netzlaufwerk wegen des
 * Kartenverschleißes will (E28/N15), nimmt SMB.
 *
 * DIESES MODUL IST REIN wie vpn.ts und funk.ts: es hängt nichts ein, ruft
 * nichts auf und liest keine Datei. Es bekommt die Eingabe aus der Verwaltung
 * und sagt, was gilt — oder es baut aus einer geprüften Konfiguration den Text
 * der beiden systemd-Einheiten. Nur so lässt sich JEDE Regel prüfen, ohne ein
 * NAS zu haben.
 *
 * DIE FÜNF REGELN, UND WOHER SIE KOMMEN:
 *
 * 1. ES HÄNGT NIE BEIM START EIN (E28/N7). Die `.mount`-Einheit bekommt
 *    ABSICHTLICH KEINEN `[Install]`-Abschnitt: damit zieht sie kein Ziel, und
 *    kein fehlendes NAS kann den Start aufhalten. Eingehängt wird erst beim
 *    ZUGRIFF, über die `.automount`-Einheit daneben. Das ist Struktur, kein
 *    Kommentar — wer `[Install]` ergänzt, bricht die Regel sichtbar, und ein
 *    Test hält sie fest.
 *
 * 2. ES DARF NICHT HÄNGEN (E28/N6). CIFS blockiert bei Zeitüberschreitung
 *    hart; ein blockierender Zugriff im Tonweg fröre die Wiedergabe ein.
 *    Deshalb `soft` (ein Zugriff scheitert, statt ewig zu warten) und eine
 *    kurze `TimeoutSec`. Und deshalb liegt der Einhängepunkt unter `/mnt` und
 *    NICHT im Anwendungsordner: was die Box zum Abspielen braucht, liegt nie
 *    auf dem Netzlaufwerk. Wie lange es im Ernstfall wirklich hängt, misst
 *    `tools/nas-sonde.py --haengen` am Gerät.
 *
 * 3. DAS PASSWORT STEHT IN KEINER EINHEIT (E28/N8, E15). Es geht in eine
 *    eigene Datei, root und 0600, und die Einheit nennt nur ihren Pfad.
 *    `beschreibung()` ist die einzige Form, die nach vorne geht — sie trägt
 *    das Passwort nicht, auch nicht verkürzt, auch nicht als Sternchen.
 *
 * 4. KEIN PROZENTZEICHEN IN DIE EINHEIT. systemd ersetzt `%h`, `%i` und ein
 *    Dutzend weitere Kürzel BEIM LESEN der Einheit. Ein Freigabename mit
 *    Prozentzeichen ergäbe also einen anderen Pfad als den eingegebenen —
 *    still. Dasselbe gilt für Zeilenumbrüche: eine Zeile mehr in der Eingabe
 *    wäre eine Direktive mehr in der Einheit. Beides wird ABGELEHNT, nicht
 *    entschärft: wer die Freigabe umbenennen muss, merkt es so beim Eintragen
 *    und nicht im Betrieb (dieselbe Haltung wie vpn.ts, Regel 1).
 *
 * 5. KEIN STILLER RÜCKFALL AUF DIE KARTE (E28/N15). Dieses Modul beschreibt
 *    NUR das Netzlaufwerk. Ob eine Sicherung oder ein Mitschnitt dorthin geht,
 *    entscheidet der Betreiber an der Stelle, wo er den Ort wählt — nicht
 *    dieses Modul, indem es bei fehlendem NAS etwas anderes nimmt.
 */

/** Wo ein Einhängepunkt liegen darf. Alles andere ist im Weg des Abspielens. */
export const ERLAUBTE_WURZEL = '/mnt'

/** Vorgabe, wenn die Verwaltung keinen eigenen Punkt nennt. */
export const EINHAENGEPUNKT_VORGABE = '/mnt/nas'

/** Wohin die SMB-Zugangsdaten gehören: root, 0600, von der Einheit nur genannt. */
export const ZUGANG_DATEI = '/etc/mupibox/nas-zugang'

/**
 * Dasselbe für WebDAV — und es ist ABSICHTLICH NICHT `/etc/davfs2/secrets`.
 *
 * Die systemweite Datei dort gehört dem Paket und womöglich anderen
 * Einhängungen; wer sie schreibt, kann fremde Zeilen mitnehmen. `mount.davfs`
 * liest die Anmeldung aber aus der Datei, die in SEINER Konfiguration unter
 * `secrets` steht — und welche Konfiguration das ist, sagt die Mount-Option
 * `conf=`. Damit bleibt alles, was die Box anlegt, in `/etc/mupibox`.
 *
 * DASS DAS AM GERÄT TRÄGT, IST NICHT GEMESSEN (20.09.2026: davfs2 ist hier
 * nicht installiert). Der Fehlerfall ist aber der gutartige: mit `ask_auth 0`
 * fragt mount.davfs nicht nach, sondern bricht ab und sagt es — es hängt
 * nicht und wartet auf eine Eingabe, die niemand machen kann.
 */
export const WEBDAV_ZUGANG_DATEI = '/etc/mupibox/nas-webdav-zugang'

/** Die eigene davfs2-Konfiguration; sie zeigt auf die Datei darüber. */
export const DAVFS_KONF_DATEI = '/etc/mupibox/davfs2.conf'

/**
 * Wohin das Zertifikat eines Servers kommt, dem ausdrücklich vertraut wird.
 *
 * WARUM ES DAS BRAUCHT: Im Heimnetz hat fast jedes NAS ein SELBSTSIGNIERTES
 * Zertifikat — am 20.09.2026 gemessen, das NAS im Haus (UGREEN, .199) hat
 * eines. `mount.davfs` lehnt so einen Server ab, und mit `ask_auth 0` fragt es
 * auch nicht nach: die Freigabe hinge einfach nie. davfs2 kennt dafür
 * `trust_server_cert`, und das will eine PEM-DATEI, keinen Fingerabdruck.
 *
 * WAS DABEI NICHT PASSIEREN DARF: dass die Box irgendein Zertifikat
 * stillschweigend annimmt. `trust_server_cert` schaltet JEDE weitere Prüfung
 * ab — Gültigkeit und Name werden dann nicht mehr geprüft. Deshalb geht das
 * nur, wenn der Betreiber es ausdrücklich sagt (`zertifikatVertrauen`), der
 * Fingerabdruck ihm vorher GEZEIGT wurde, und die Beschreibung danach
 * dauerhaft ausweist, dass hier ein Zertifikat blind gilt.
 */
export const WEBDAV_ZERT_DATEI = '/etc/mupibox/nas-webdav-cert.pem'

/**
 * Wie viel Platz der WebDAV-Zwischenspeicher haben darf, in MiB.
 *
 * DAS IST DER UNTERSCHIED ZU SMB, UND ER GEHÖRT AUSGESPROCHEN: davfs2 schreibt
 * jede Datei ZUERST lokal und lädt sie danach hoch (Vorgabe 50 MiB unter
 * /var/cache/davfs2 — also auf die Karte). Für Sicherungsstände von 12 KB ist
 * das folgenlos. Für große Dateien nicht: sie laufen zweimal über die Karte,
 * und wer WebDAV wegen des Kartenverschleißes wählt (E28/N15), hätte damit
 * genau nichts gewonnen. Für solche Fälle ist SMB der richtige Weg.
 */
export const WEBDAV_ZWISCHENSPEICHER_MIB = 64

/**
 * SMB-Fassung. 3.1.1 ist seit Jahren das, was jedes NAS spricht, und die
 * Aushandlung („default") hat auf älteren Kernen schon stillschweigend auf 1.0
 * zurückgeschaltet — ein Protokoll, das niemand mehr anbieten sollte.
 */
export const SMB_FASSUNG = '3.1.1'

/** Wie lange ein Einhängeversuch dauern darf, bevor er aufgibt (Regel 2). */
export const FRIST_SEK = 10

/** Nach wie langer Ruhe wieder ausgehängt wird — eine tote Freigabe hängt so nicht ewig. */
export const RUHE_SEK = 600

/**
 * Welche Sorte Freigabe. Die Unterscheidung steht an EINER Stelle und wird
 * überall aus ihr abgeleitet (Optionen, Einheitentyp, Zugangsdatei) — sonst
 * entstünden zwei halbe Wege, und der zweite wäre der ungeprüfte.
 */
export type Art = 'smb' | 'webdav'

export interface NetzlaufwerkEingabe {
  /** Fehlt sie, gilt `smb` — das war vor dem 20.09.2026 die einzige Sorte. */
  art?: Art
  /** SMB: die Adresse des NAS. WebDAV: bleibt leer, dort zählt `adresse`. */
  host?: string
  freigabe?: string
  unterpfad?: string
  /** WebDAV: die ganze Adresse, z. B. https://nas/remote.php/dav/files/achim */
  adresse?: string
  nutzer: string
  passwort: string
  domaene?: string
  einhaengepunkt?: string
  /** Wem die Dateien auf der Freigabe gehören sollen — der Nutzer der Box. */
  besitzer?: string
  /**
   * NUR WebDAV über https: dem (selbstsignierten) Zertifikat des Servers
   * ausdrücklich vertrauen. Kommt nie von selbst — die Verwaltung setzt es
   * erst, nachdem sie den Fingerabdruck gezeigt hat.
   */
  zertifikatVertrauen?: boolean
}

export interface NetzlaufwerkKonfig {
  art: Art
  host: string
  freigabe: string
  unterpfad: string
  nutzer: string
  domaene: string
  besitzer: string
  einhaengepunkt: string
  /** SMB: `//host/freigabe[/unterpfad]`. WebDAV: die URL. Das, was in `What=` steht. */
  quelle: string
  /**
   * Gilt hier ein Zertifikat, das niemand außer dem Betreiber geprüft hat?
   * Steht mit Absicht in der BESCHREIBUNG und damit dauerhaft in der
   * Oberfläche: eine abgeschaltete Prüfung, die man nicht mehr sieht, ist
   * eine, an die sich in einem halben Jahr niemand erinnert.
   */
  zertifikatVertraut: boolean
  /** NUR für `zugangSchreiben`. Taucht in keiner Antwort und keinem Protokoll auf (Regel 3). */
  passwort: string
  /** Was beim Übernehmen verändert oder gesetzt wurde — geht wörtlich in die Oberfläche. */
  hinweise: string[]
}

export type NetzlaufwerkPruefung = { ok: true; konfig: NetzlaufwerkKonfig } | { ok: false; fehler: string }

/** Beschreibung ohne Geheimnis — das, was die Oberfläche und `nas.json` sehen dürfen. */
export type NetzlaufwerkBeschreibung = Omit<NetzlaufwerkKonfig, 'passwort' | 'hinweise'>

/**
 * Steuerzeichen, Zeilenumbruch, Prozentzeichen (Regel 4). Ein Wert, der das
 * trägt, wird nicht entschärft, sondern abgelehnt.
 */
function unsauber(wert: string): string | null {
  for (const z of wert) {
    const c = z.charCodeAt(0)
    // Steuerzeichen als ZAHL, nicht als Escape in einer Zeichenklasse: ein
    // Backslash-u-Escape im Quelltext ist genau das, was hier verboten wird,
    // und es hat diese Datei beim ersten Schreiben schon einmal zerlegt.
    if (c < 0x20 || c === 0x7f) return 'Steuerzeichen oder Zeilenumbruch'
  }
  if (wert.includes('%')) return 'ein Prozentzeichen (systemd ersetzt Prozent-Kürzel beim Lesen der Einheit)'
  return null
}

/** Hostname oder IP-Adresse — grob, aber ohne Leerzeichen, Komma und Schrägstrich. */
export function hostForm(host: string): boolean {
  const t = host.trim()
  if (!t || t.length > 255) return false
  if (/^\[[0-9a-fA-F:.]+\]$/.test(t)) return true
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(t)
}

/**
 * Der Name der systemd-Einheit zu einem Pfad — dieselbe Regel wie
 * `systemd-escape --path`: führende und schließende Schrägstriche fallen weg,
 * `/` wird zum Bindestrich, und JEDES andere Zeichen außer `[A-Za-z0-9_.]`
 * wird als Backslash-x-Hex geschrieben. Der Bindestrich ist dabei der, den man
 * vergisst: aus `/mnt/mein-nas` wird `mnt-mein\x2dnas`, nicht `mnt-mein-nas` —
 * die zweite Fassung zeigte auf `/mnt/mein/nas`, also auf etwas anderes.
 */
export function einheitName(pfad: string, endung: 'mount' | 'automount' = 'mount'): string {
  const kern = pfad.replace(/^\/+|\/+$/g, '')
  if (kern === '') return `-.${endung}`
  let raus = ''
  for (let i = 0; i < kern.length; i++) {
    const z = kern[i]
    if (z === '/') raus += '-'
    else if (/[A-Za-z0-9_]/.test(z)) raus += z
    else if (z === '.' && i > 0) raus += z
    else raus += `\\x${z.charCodeAt(0).toString(16).padStart(2, '0')}`
  }
  return `${raus}.${endung}`
}

/** Ein Pfad ohne `..`, ohne Doppelschrägstrich, ohne Schlusszeichen. */
function pfadNormal(pfad: string): string | null {
  if (!pfad.startsWith('/')) return null
  const teile = pfad.split('/').filter((t) => t !== '')
  if (teile.some((t) => t === '.' || t === '..')) return null
  if (teile.some((t) => !/^[A-Za-z0-9._-]+$/.test(t))) return null
  return `/${teile.join('/')}`
}

/**
 * Die Eingabe aus der Verwaltung prüfen und in die Form bringen, die überall
 * sonst gilt. Was hier durchkommt, darf in eine Einheit geschrieben werden —
 * und nur was hier durchkommt.
 */
export function eingabeLesen(e: NetzlaufwerkEingabe): NetzlaufwerkPruefung {
  const hinweise: string[] = []

  const art: Art = e.art === 'webdav' ? 'webdav' : 'smb'

  for (const [name, wert] of Object.entries({
    Freigabe: e.freigabe ?? '',
    Anmeldename: e.nutzer,
    Passwort: e.passwort,
    Unterpfad: e.unterpfad ?? '',
    Domäne: e.domaene ?? '',
    Adresse: art === 'webdav' ? (e.adresse ?? '') : (e.host ?? ''),
  })) {
    if (typeof wert !== 'string') return { ok: false, fehler: `${name}: fehlt` }
    const schmutz = unsauber(wert)
    if (schmutz) return { ok: false, fehler: `${name} enthält ${schmutz} — bitte ohne` }
  }

  // ── WebDAV: die ganze Adresse ist EIN Wert, und sie wird zerlegt statt
  //    zusammengesetzt. Was dabei herauskommt, steht danach in denselben
  //    Feldern wie bei SMB (host = Rechner, freigabe/unterpfad = Weg), damit
  //    die Oberfläche und nas.json nur EINE Form kennen.
  if (art === 'webdav') {
    const gelesen = adresseLesen(e.adresse ?? '')
    if (!gelesen.ok) return gelesen
    if (gelesen.unverschluesselt) {
      hinweise.push(
        'Die Adresse ist http, nicht https — Anmeldename und Passwort gehen dann UNVERSCHLÜSSELT durchs Netz. ' +
          'Im eigenen Heimnetz vertretbar, sonst nicht.',
      )
    }
    return abschluss({
      art,
      host: gelesen.host,
      freigabe: gelesen.freigabe,
      unterpfad: gelesen.unterpfad,
      quelle: gelesen.quelle,
      hinweise,
      e,
    })
  }

  const host = (e.host ?? '').trim()
  if (!hostForm(host)) return { ok: false, fehler: `Adresse „${host}" ist kein Rechnername und keine IP` }

  const freigabe = (e.freigabe ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!freigabe) return { ok: false, fehler: 'Freigabename fehlt' }
  if (!/^[A-Za-z0-9._ -]{1,80}$/.test(freigabe)) {
    return { ok: false, fehler: `Freigabename „${freigabe}" enthält Zeichen, die eine Einheit nicht trägt` }
  }

  let unterpfad = (e.unterpfad ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (unterpfad) {
    const teile = unterpfad.split('/')
    if (teile.some((t) => t === '' || t === '.' || t === '..' || !/^[A-Za-z0-9._ -]+$/.test(t))) {
      return { ok: false, fehler: `Unterpfad „${unterpfad}" ist nicht geradeaus (kein .., kein Leerteil)` }
    }
    unterpfad = teile.join('/')
  }

  if (freigabe.includes(' ')) hinweise.push(`Freigabename mit Leerzeichen — in der Einheit steht er als „${freigabe}"`)
  hinweise.push(`SMB ${SMB_FASSUNG} erzwungen (keine Aushandlung, kein Rückfall auf SMB 1)`)

  return abschluss({
    art,
    host,
    freigabe,
    unterpfad,
    quelle: `//${host}/${freigabe}${unterpfad ? `/${unterpfad}` : ''}`,
    hinweise,
    e,
  })
}

/**
 * Eine WebDAV-Adresse zerlegen. Sie ist der einzige Wert, bei dem der Anrufer
 * Schrägstriche liefern DARF — deshalb ist sie auch der einzige, der eine
 * eigene Prüfung bekommt.
 *
 * WAS ABGELEHNT WIRD, UND WARUM: Anmeldedaten in der Adresse (`user:pw@host`)
 * — die landeten wörtlich in der Einheit, also in einer Datei, die jeder auf
 * der Box lesen darf, und nebenbei in jeder Fehlermeldung. Abfrage und Anker
 * (`?` und `#`) — die gehören zu einer Webseite, nicht zu einem
 * Einhängepunkt, und `mount.davfs` machte daraus etwas anderes als gemeint.
 */
function adresseLesen(
  roh: string,
):
  | { ok: false; fehler: string }
  | { ok: true; host: string; freigabe: string; unterpfad: string; quelle: string; unverschluesselt: boolean } {
  const t = roh.trim().replace(/\/+$/g, '')
  if (!t)
    return { ok: false, fehler: 'Die Adresse der WebDAV-Freigabe fehlt (z. B. https://nas/remote.php/dav/files/achim)' }
  let url: URL
  try {
    url = new URL(t)
  } catch {
    return { ok: false, fehler: `„${t}" ist keine vollständige Adresse — mit https:// beginnen` }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, fehler: `„${url.protocol}" ist kein WebDAV-Weg — es geht nur https:// oder http://` }
  }
  if (url.username || url.password) {
    return {
      ok: false,
      fehler:
        'Die Adresse enthält Anmeldedaten. Die gehören in die Felder darunter — in der Adresse stünden sie offen in der Einheit.',
    }
  }
  if (url.search || url.hash) {
    return { ok: false, fehler: 'Die Adresse enthält ein ? oder # — eine Freigabe hat keine Abfrage und keinen Anker.' }
  }
  // GEGEN DIE ROHE EINGABE, NICHT GEGEN url.pathname: `new URL()` rechnet
  // `..` bereits weg — aus `https://nas/dav/../../etc` wird `/etc`, und eine
  // Prüfung danach fände nie etwas. Das ist beim Schreiben dieser Datei
  // passiert: die Regel stand da, war grün und wirkungslos, und erst der Test
  // mit genau dieser Adresse hat es gezeigt.
  if (t.split('/').some((s) => s === '..' || s === '.')) {
    return { ok: false, fehler: 'Die Adresse enthält .. — sie muss geradeaus zeigen.' }
  }
  const teile = url.pathname.split('/').filter((s) => s !== '')
  return {
    ok: true,
    host: url.hostname,
    freigabe: teile[0] ?? '',
    unterpfad: teile.slice(1).join('/'),
    // Aus der zerlegten URL neu zusammengesetzt, nicht die Eingabe
    // durchgereicht: was in die Einheit geht, ist damit genau das, was hier
    // geprüft wurde, und nicht eine Schreibweise daneben.
    quelle: `${url.protocol}//${url.host}${teile.length ? `/${teile.join('/')}` : ''}`,
    unverschluesselt: url.protocol === 'http:',
  }
}

/** Der gemeinsame Rest beider Sorten: Anmeldung, Besitzer, Einhängepunkt. */
function abschluss(x: {
  art: Art
  host: string
  freigabe: string
  unterpfad: string
  quelle: string
  hinweise: string[]
  e: NetzlaufwerkEingabe
}): NetzlaufwerkPruefung {
  const { art, host, freigabe, unterpfad, quelle, hinweise, e } = x
  // Nur echtes `true` zählt, und nur bei WebDAV über https — bei SMB gibt es
  // kein Zertifikat, und bei http gäbe es nichts zu vertrauen. Dieselbe
  // Strenge wie beim Mitschnitt-Plugin: `"true"` oder `1` sind kein Ja.
  const zertifikatVertraut = e.zertifikatVertrauen === true && art === 'webdav' && quelle.startsWith('https://')

  const nutzer = (e.nutzer ?? '').trim()
  if (!nutzer) return { ok: false, fehler: 'Anmeldename fehlt — anonym antwortet das NAS mit ACCESS_DENIED' }
  if (!/^[A-Za-z0-9._@\\-]{1,64}$/.test(nutzer))
    return { ok: false, fehler: `Anmeldename „${nutzer}" ist ungewöhnlich` }

  const passwort = e.passwort ?? ''
  if (!passwort) return { ok: false, fehler: 'Passwort fehlt' }
  if (passwort !== passwort.trim()) {
    return {
      ok: false,
      fehler:
        art === 'webdav'
          ? 'Passwort beginnt oder endet mit einem Leerzeichen — in der secrets-Zeile ist danach nicht mehr eindeutig, wo es aufhört'
          : 'Passwort beginnt oder endet mit einem Leerzeichen — mount.cifs liest die Zeile dann anders',
    }
  }

  const domaene = (e.domaene ?? '').trim()
  if (domaene && !/^[A-Za-z0-9._-]{1,64}$/.test(domaene)) {
    return { ok: false, fehler: `Domäne „${domaene}" ist ungewöhnlich` }
  }

  const besitzer = (e.besitzer ?? 'dietpi').trim()
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(besitzer))
    return { ok: false, fehler: `Besitzer „${besitzer}" ist kein Benutzername` }

  const roh = (e.einhaengepunkt ?? EINHAENGEPUNKT_VORGABE).trim()
  const einhaengepunkt = pfadNormal(roh)
  if (!einhaengepunkt) return { ok: false, fehler: `Einhängepunkt „${roh}" ist kein geradeaus geschriebener Pfad` }
  if (einhaengepunkt !== ERLAUBTE_WURZEL && !einhaengepunkt.startsWith(`${ERLAUBTE_WURZEL}/`)) {
    return {
      ok: false,
      fehler: `Einhängepunkt muss unter ${ERLAUBTE_WURZEL}/ liegen — ein Netzlaufwerk gehört nicht in den Weg des Abspielens (E28/N6)`,
    }
  }
  if (einhaengepunkt === ERLAUBTE_WURZEL)
    return { ok: false, fehler: `${ERLAUBTE_WURZEL} selbst ist kein Einhängepunkt` }

  hinweise.push('hängt NICHT beim Start ein, sondern beim ersten Zugriff — ein fehlendes NAS hält die Box nicht auf')
  hinweise.push(
    art === 'webdav'
      ? `Zugangsdaten gehen nach ${WEBDAV_ZUGANG_DATEI} (root, 0600), nicht in die Einheit`
      : `Zugangsdaten gehen nach ${ZUGANG_DATEI} (root, 0600), nicht in die Einheit`,
  )
  if (art === 'webdav') {
    hinweise.push(
      `WebDAV lädt über einen Zwischenspeicher auf der Karte (${WEBDAV_ZWISCHENSPEICHER_MIB} MiB): jede Datei wird ` +
        'erst lokal geschrieben und dann hochgeladen. Für Sicherungsstände von 12 KB folgenlos — für große Dateien ist SMB der bessere Weg.',
    )
  }

  if (zertifikatVertraut) {
    hinweise.push(
      'Dem Zertifikat dieses Servers wird ausdrücklich vertraut — damit prüft die Box weder seine ' +
        'Gültigkeit noch den Namen darin. Richtig bei einem eigenen NAS im Heimnetz, falsch bei allem anderen.',
    )
  }

  return {
    ok: true,
    konfig: {
      art,
      host,
      freigabe,
      unterpfad,
      nutzer,
      domaene,
      besitzer,
      einhaengepunkt,
      quelle,
      zertifikatVertraut,
      passwort,
      hinweise,
    },
  }
}

/**
 * Die Einhänge-Optionen, in EINER Zeile — die Reihenfolge ist für Menschen,
 * nicht für mount. Je Sorte eine eigene Liste: eine gemeinsame mit
 * Ausnahmen führte dazu, dass eine CIFS-Option still bei davfs landete, wo sie
 * nur eine Fehlermeldung wert ist.
 */
export function optionen(k: NetzlaufwerkKonfig): string {
  if (k.art === 'webdav') {
    return [
      // `conf=` ist der ganze Trick (siehe WEBDAV_ZUGANG_DATEI): darin steht,
      // WO die Anmeldung liegt — damit bleibt /etc/davfs2/secrets unberührt.
      `conf=${DAVFS_KONF_DATEI}`,
      `uid=${k.besitzer}`,
      `gid=${k.besitzer}`,
      'file_mode=0664',
      'dir_mode=0775',
      // davfs kennt kein `soft`; was ein hängendes Netz hier begrenzt, ist die
      // TimeoutSec der Einheit und `_netdev`.
      '_netdev',
    ].join(',')
  }
  return [
    `credentials=${ZUGANG_DATEI}`,
    `vers=${SMB_FASSUNG}`,
    'soft',
    'nobrl',
    `uid=${k.besitzer}`,
    `gid=${k.besitzer}`,
    'file_mode=0664',
    'dir_mode=0775',
    'iocharset=utf8',
    'noatime',
  ].join(',')
}

/**
 * Die `.mount`-Einheit. OHNE `[Install]` — das IST Regel 1: eine Einheit, die
 * kein Ziel zieht, wird beim Start von niemandem verlangt.
 */
export function mountEinheit(k: NetzlaufwerkKonfig): string {
  return [
    '# Erzeugt von der MuPiBox-Verwaltung (BACKLOG E28/N6-N9). Nicht von Hand ändern —',
    '# beim nächsten Übernehmen wird diese Datei überschrieben.',
    '#',
    '# KEIN [Install]-Abschnitt, und das ist Absicht (E28/N7): so hängt hier beim',
    '# Hochfahren nichts ein, und ein ausgeschaltetes NAS kann den Start nicht',
    '# aufhalten. Eingehängt wird über die .automount-Einheit beim ersten Zugriff.',
    '[Unit]',
    `Description=Netzlaufwerk ${k.quelle}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Mount]',
    `What=${k.quelle}`,
    `Where=${k.einhaengepunkt}`,
    `Type=${k.art === 'webdav' ? 'davfs' : 'cifs'}`,
    `Options=${optionen(k)}`,
    `TimeoutSec=${FRIST_SEK}`,
    '',
  ].join('\n')
}

/** Die `.automount`-Einheit: sie allein darf beim Start mitkommen. */
export function automountEinheit(k: NetzlaufwerkKonfig): string {
  return [
    '# Erzeugt von der MuPiBox-Verwaltung (BACKLOG E28/N6-N9). Nicht von Hand ändern.',
    '[Unit]',
    `Description=Netzlaufwerk ${k.quelle} bei Bedarf`,
    '',
    '[Automount]',
    `Where=${k.einhaengepunkt}`,
    `TimeoutIdleSec=${RUHE_SEK}`,
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n')
}

/**
 * Die Zugangsdatei. Sie und nur sie trägt das Passwort (Regel 3) — je Sorte in
 * dem Format, das ihr Einhängewerkzeug liest.
 */
export function zugangSchreiben(k: NetzlaufwerkKonfig): string {
  if (k.art === 'webdav') {
    // Das Format von davfs2: EINE Zeile aus drei Feldern, durch Leerzeichen
    // getrennt. Genau deshalb muss hier gequotet werden — ein Passwort mit
    // Leerzeichen wäre sonst zwei Felder, und mount.davfs nähme die erste
    // Hälfte. Anführungszeichen und Backslash werden nach den Regeln aus
    // davfs2.conf(5) mit Backslash geschützt.
    return `${k.quelle} ${davfsWert(k.nutzer)} ${davfsWert(k.passwort)}\n`
  }
  const zeilen = [`username=${k.nutzer}`, `password=${k.passwort}`]
  if (k.domaene) zeilen.push(`domain=${k.domaene}`)
  return `${zeilen.join('\n')}\n`
}

/** Ein Wert für davfs2: in Anführungszeichen, Backslash und Anführungszeichen geschützt. */
export function davfsWert(wert: string): string {
  return `"${wert.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Die eigene davfs2-Konfiguration (Mount-Option `conf=`).
 *
 * Vier Zeilen, und jede verhindert etwas Bestimmtes:
 *
 *   secrets      zeigt auf die EIGENE Anmeldedatei — damit bleibt
 *                /etc/davfs2/secrets unberührt, samt fremder Zeilen darin.
 *   ask_auth 0   mount.davfs fragt sonst interaktiv nach dem Passwort. Beim
 *                Einhängen durch systemd steht dort niemand: es hinge, statt
 *                zu scheitern — genau das, was ein Netzlaufwerk NIE tun darf
 *                (E28/N6).
 *   use_locks 0  Sperren auf dem Server kosten bei jedem Öffnen eine Anfrage
 *                und scheitern bei manchen Anbietern ganz. Die Box ist der
 *                einzige Schreiber auf ihrem Ordner.
 *   cache_size   Der Zwischenspeicher liegt auf der Karte. Begrenzt, damit
 *                eine große Datei nicht unbemerkt die Karte füllt.
 */
export function davfsKonfSchreiben(zertifikatVertraut = false): string {
  const zeilen = [
    '# Erzeugt von der MuPiBox-Verwaltung (BACKLOG E28/N6-N9). Nicht von Hand ändern.',
    '# Gilt nur für die Einhängungen dieser Box (Mount-Option conf=), nicht systemweit.',
    `secrets ${WEBDAV_ZUGANG_DATEI}`,
    'ask_auth 0',
    'use_locks 0',
    `cache_size ${WEBDAV_ZWISCHENSPEICHER_MIB}`,
  ]
  if (zertifikatVertraut) {
    // `trust_server_cert` schaltet JEDE weitere Prüfung ab (Gültigkeit, Name).
    // Deshalb steht der Grund hier in der Datei, nicht nur im Quelltext: wer
    // sie später liest, soll nicht raten müssen, warum die Prüfung aus ist.
    zeilen.push(
      '# Der Betreiber hat diesem Zertifikat ausdrücklich vertraut (selbstsigniert,',
      '# wie fast jedes NAS im Heimnetz). Danach wird es NICHT mehr auf Gültigkeit',
      '# oder Namen geprüft — genau deshalb steht es namentlich in nas.json.',
      `trust_server_cert ${WEBDAV_ZERT_DATEI}`,
    )
  }
  zeilen.push('')
  return zeilen.join('\n')
}

/** Was nach vorne darf — ohne Passwort, ohne Hinweise. */
export function beschreibung(k: NetzlaufwerkKonfig): NetzlaufwerkBeschreibung {
  const { passwort: _weg, hinweise: _auch, ...rest } = k
  return rest
}
