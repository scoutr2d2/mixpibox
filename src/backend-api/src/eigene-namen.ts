/**
 * WIE HEISST DIESE BOX EIGENTLICH SELBST?
 *
 * ── WARUM ES DIESE DATEI GIBT (der Befund vom 07.08.2026) ───────────────
 * `herkunft.ts` haelt `Origin` gegen `Host` DERSELBEN Anfrage. Das faengt die
 * gewoehnliche fremde Seite — aber nicht den NAMENSTAUSCH:
 *
 *   Der Angreifer beherrscht die Namensaufloesung fuer seinen eigenen Namen.
 *   Er laesst `boese.example` nach dem ersten Laden auf die Box zeigen. Dann
 *   traegt die Anfrage `Host: boese.example` UND `Origin: http://boese.example`
 *   — fuer den Browser gleichherkuenftig, er meldet sogar
 *   `Sec-Fetch-Site: same-origin`. Beide Riegel sehen nichts Fremdes.
 *
 * GEMESSEN (tools/riegel-durchkommen.mjs, Ring 3): `POST /api/konfiguration`
 * mit diesen beiden Kopfzeilen kam mit 200 durch, und die Lautstaerke in
 * mupiboxconfig.json sprang von 41 auf 57 — in der DATEI nachgesehen.
 *
 * ES REICHT ALSO NICHT, ORIGIN GEGEN HOST ZU HALTEN. Die Box muss WISSEN, WIE
 * SIE SELBST HEISST, und einen `Host`, der keiner ihrer Namen ist, zurueckweisen.
 * Das ist die einzige Stelle, an der sich das schliessen laesst.
 *
 * ── UND DIE GEFAHR DABEI IST GROESSER ALS DIE LUECKE ────────────────────
 * Eine zu enge Liste SPERRT DEN BESITZER AUS, und er kann es nicht melden,
 * weil niemand davorsitzt. Deshalb steht hier NICHTS FEST EINGETRAGEN. Alles
 * wird zur LAUFZEIT abgeleitet — auf einer anderen Box heisst alles anders:
 *
 *   1. JEDE Adresse JEDER Schnittstelle (`os.networkInterfaces()`), auch die
 *      inneren, auch IPv6. Das deckt `127.0.0.1`, `::1` und die LAN-Adresse,
 *      und es wandert mit, wenn DHCP eine neue vergibt (Puffer: 5 s).
 *   2. Der Rechnername (`os.hostname()`, auf dieser Box `mupibox`) — voll und
 *      als erste Marke.
 *   3. `mupibox.host` aus mupiboxconfig.json (auf dieser Box `MixPiBox`).
 *      Dieses Feld ist ueber die Verwaltung aenderbar, also OHNE SSH.
 *   4. `localhost` — immer, ohne Bedingung.
 *   5. Was der Betreiber selbst dazuschreibt (s.u.).
 *
 * ── DIE NAMEN, DIE ICH NICHT KENNEN KANN ────────────────────────────────
 * Ein Heimrouter vergibt eigene Namen: `mupibox.fritz.box`, `mupibox.lan`,
 * `mupibox.home.arpa`. Welche, weiss diese Box nicht — der Router sagt es ihr
 * nicht. Wer die Box so aufruft und ausgesperrt wird, hat kein zweites Geraet.
 *
 * DESHALB DIE ENDUNGSREGEL: ein Name gilt auch dann, wenn seine ERSTE MARKE
 * einer unserer Namen ist UND der Rest eine der RESERVIERTEN Endungen unten
 * ist. `mupibox.fritz.box` gilt, `mupibox.lan` gilt, `mixpibox.local` gilt.
 *
 * WARUM DAS NICHT DIE LUECKE WIEDER AUFMACHT — die Frage, an der es haengt:
 * Der Angreifer koennte `mupibox.boese.example` anlegen, das kostet ihn nichts.
 * Genau deshalb steht in der Liste KEINE Endung, die man kaufen kann. Alle
 * Endungen unten sind fuer den Hausgebrauch reserviert oder nie vergeben
 * worden (`.local` RFC 6762, `.home.arpa` RFC 8375, `.internal` von der ICANN
 * 2024 reserviert, `.lan`/`.home`/`.corp` nie delegiert). Ein Name unter einer
 * solchen Endung wird beim OPFER vom Heimrouter aufgeloest — der Angreifer
 * kann dort keinen Eintrag setzen, und er kann unter diesem Namen auch keine
 * Seite ausliefern, denn das Opfer landet damit bei sich zu Hause.
 *
 * DAS BLOSSE `box` STEHT ABSICHTLICH NICHT DA. `.box` ist eine echte, kaeuflich
 * zu habende Endung — `mupibox.box` koennte sich der Angreifer eintragen
 * lassen. `fritz.box` steht da, weil er dafuer `fritz.box` SELBST besitzen
 * muesste, und weil das im deutschen Heimnetz der haeufigste Fall ueberhaupt
 * ist.
 *
 * ── DER AUSWEG, WENN DER NAME TROTZDEM NICHT DABEI IST ──────────────────
 * ZWEI Wege, und beide stehen im abgewiesenen Antwortsatz:
 *
 *   a) OHNE SSH — die Box unter einer ihrer ADRESSEN aufrufen. Die steht in
 *      der Fehlermeldung als fertiger Link. Eine Adresse ist IMMER dabei,
 *      sonst waere die Anfrage gar nicht angekommen.
 *   b) DAUERHAFT — `"hostZusatz"` unter `"mupibox"` in mupiboxconfig.json
 *      (dieselbe Datei, die die Verwaltung schreibt; Komma-Liste oder Feld),
 *      oder die Umgebungsvariable `MUPIBOX_HOST_ZUSATZ`. Die Datei wird
 *      laufend neu gelesen — KEIN Neustart noetig.
 *
 * ── WIE ES SCHEITERT: OFFEN, NICHT ZU ──────────────────────────────────
 * Wenn `os.networkInterfaces()` wirft oder gar nichts hergibt, kennt diese Box
 * ihre eigenen Namen NICHT — und dann darf sie nicht raten. `verlaesslich`
 * wird `false`, und der Riegel laesst den Namensteil AUS (der Origin-Teil und
 * `Sec-Fetch-Site` gelten weiter).
 *
 * DIE RICHTUNG IST EINE ENTSCHEIDUNG, KEIN VERSEHEN: eine Box, die niemanden
 * mehr hereinlaesst, ist verloren — kein Bildschirm, keine Tastatur, keine
 * Anleitung, und der Besitzer kann es nicht einmal melden. Eine Box, die im
 * Ausnahmefall den alten (heutigen) Stand hat, ist genau so sicher wie gestern.
 * Der Ausnahmefall wird gemeldet (`console.warn`), damit er nicht still ist.
 */
import { readFileSync } from 'node:fs'
import { hostname, networkInterfaces } from 'node:os'

/**
 * Endungen, unter denen ein Name mit unserer ersten Marke ebenfalls gilt.
 *
 * KEINE DAVON IST KAEUFLICH — die Begruendung steht ausfuehrlich im Kopf.
 * Wer hier etwas ergaenzt, muss dieselbe Frage beantworten: kann sich ein
 * Fremder einen Namen unter dieser Endung eintragen lassen? Wenn ja, gehoert
 * er nicht hierher, sondern in `hostZusatz`.
 */
export const RESERVIERTE_ENDUNGEN: readonly string[] = [
  'local', // mDNS, RFC 6762 — mupibox.local
  'lan', // nie delegiert; Vorgabe vieler Router
  'home', // beantragt, nie delegiert
  'home.arpa', // RFC 8375, der offizielle Hausgebrauch
  'internal', // ICANN 2024 fuer den Hausgebrauch reserviert
  'intranet',
  'localdomain',
  'corp',
  'private',
  'fritz.box', // der haeufigste Fall im deutschen Heimnetz
  'speedport.ip',
]

export interface EigeneNamen {
  /** Vollstaendige Namen und Adressen, die gelten (schon normiert). */
  namen: Set<string>
  /** Erste Marken, die unter einer reservierten Endung ebenfalls gelten. */
  stamm: Set<string>
  /** Womit die Box wirklich erreichbar ist — fuer den Satz an den Menschen. */
  erreichbar: string[]
  /**
   * Konnte ueberhaupt etwas abgeleitet werden? `false` heisst: der Riegel
   * prueft den Namen NICHT. Siehe „wie es scheitert" im Kopf.
   */
  verlaesslich: boolean
  /** Warum nicht verlaesslich — steht in der Warnung im Protokoll. */
  grund?: string
}

/**
 * Einen Rechnernamen auf die Form bringen, in der verglichen wird.
 *
 * `new URL` macht die Arbeit, die man von Hand falsch macht: Klammern um IPv6,
 * die KANONISCHE Kurzform einer IPv6-Adresse (`2001:0db8:0000::1` →
 * `2001:db8::1`), Grossschreibung, Umlautnamen. Zwei Dinge davor und danach:
 *
 *   * Der ZONENANHANG (`fe80::1%eth0`) fliegt weg — `new URL` kaeme damit
 *     nicht zurecht, und er beschreibt die Schnittstelle, nicht den Namen.
 *   * Der PUNKT AM ENDE fliegt weg. `mupibox.local.` ist derselbe Rechner wie
 *     `mupibox.local`, und ein Browser laesst ihn stehen. Ohne diese Zeile
 *     waere ein Mensch ausgesperrt, der ihn (oder sein Router) mitschickt.
 */
export function namenNormieren(roh: string): string {
  let t = String(roh ?? '')
    .trim()
    .toLowerCase()
  if (!t) return ''
  // Ein Rechnername enthaelt keinen Schraegstrich. Ohne diese Zeile macht
  // `new URL` aus `/pfad` den Rechner `pfad` (die zusaetzlichen Schraegstriche
  // schluckt es bei http). Das trifft nichts in unserer Menge, aber ein
  // Normierer, der aus einem Pfad einen Namen erfindet, ist eine Falle fuer
  // den naechsten, der ihn benutzt.
  if (t.includes('/') || t.includes('\\')) return ''
  // ── DER PORT FLIEGT WEG, UND DAS IST KEIN SCHOENHEITSFEHLER ─────────────
  // GEMESSEN: `hostZusatz: "mupibox.fritzbox:8200"` galt NICHT. Ein Mensch,
  // der ausgesperrt ist, kopiert den Namen aus seiner Adresszeile — und dort
  // steht der Port dabei. Vorher lief die eckige Klammer unten auch ueber ein
  // solches `name:port`, `new URL` warf, und der Eintrag verschwand
  // STILLSCHWEIGEND. Der Ausweg, der die Sackgasse verhindern soll, ging
  // damit genau dem verloren, der ihn braucht.
  //
  // Drei Formen, und sie muessen auseinandergehalten werden:
  //   `[::1]:8443`  IPv6 in Klammern, Port dahinter → Klammerinhalt zaehlt
  //   `::1`         blankes IPv6 (mehr als ein Doppelpunkt) → unveraendert
  //   `name:8200`   genau ein Doppelpunkt → alles ab dem Doppelpunkt weg
  const inKlammern = /^\[([^\]]*)\]/.exec(t)
  if (inKlammern) t = inKlammern[1]
  else if ((t.match(/:/g) ?? []).length === 1) t = t.slice(0, t.indexOf(':'))
  const zone = t.indexOf('%')
  if (zone >= 0) t = t.slice(0, zone)
  if (!t) return ''
  const geklammert = t.includes(':') ? `[${t}]` : t
  try {
    const u = new URL(`http://${geklammert}`)
    if (!u.hostname) return ''
    t = u.hostname.replace(/^\[/, '').replace(/\]$/, '')
  } catch {
    return ''
  }
  // Erst JETZT der Punkt am Ende: `new URL` nimmt ihn bei einer IPv4-Adresse
  // selbst weg, bei einem Namen laesst er ihn stehen.
  return t.replace(/\.+$/, '')
}

/** Die erste Marke eines Namens — `mupibox` aus `mupibox.fritz.box`. */
function ersteMarke(name: string): string {
  const i = name.indexOf('.')
  return i < 0 ? name : name.slice(0, i)
}

/**
 * Ist diese Adresse eine, die man einem Menschen IM HAUS nennen kann — und
 * die man einem Fremden nennen DARF?
 *
 * ── WARUM DAS UEBERHAUPT GEFRAGT WIRD ───────────────────────────────────
 * Die Ablehnung nennt die Adressen dieser Box als Ausweg. Das ist ihr Sinn:
 * ohne sie steht der Ausgesperrte in der Sackgasse. Aber ABGELEHNT WIRD AUCH
 * DER ANGREIFER, und zwar mit derselben Seite — und beim Namenstausch liegt
 * seine Seite unter DEMSELBEN Namen und DEMSELBEN Port wie die Box. Fuer den
 * Browser ist das gleichherkuenftig: CORS wird gar nicht gefragt, und dass der
 * Riegel `Access-Control-Allow-Origin` entfernt, aendert daran nichts.
 *
 * GEMESSEN (tools/ausgesperrt-am-schirm.mjs, 07.08.2026): eine Seite unter dem
 * fremden Namen holte sich `/api/konfiguration` und LAS den Rumpf — darin die
 * LAN-Adresse, die mDNS-Namen und die GLOBALE IPv6-ADRESSE der Maschine.
 *
 * DIE GLOBALE ADRESSE IST DIE TEURE. Alles andere gilt nur im Haus: wer sie
 * hat, muss immer noch einen Browser im selben Netz fernsteuern. Eine globale
 * IPv6-Adresse ist dagegen VOM INTERNET AUS DIREKT ANWAEHLBAR — und die API
 * dieser Box steht in der Vorlage ohne Anmeldung offen. Damit wird aus einem
 * Angriff, der jedes Mal ein fremdes Fenster braucht, ein dauerhafter Weg.
 *
 * ES WIRD NUR DIE EMPFEHLUNG GEKUERZT, NICHT DIE ERLAUBNIS. Diese Adressen
 * GELTEN weiter (sie stehen in `namen`) — wer die Box ueber sie erreicht,
 * kommt herein wie bisher. Hier faellt allein weg, dass sie einem Fremden
 * VORGESAGT werden. Aussperren kann diese Zeile also niemanden; und `localhost`
 * sowie die `.local`-Namen kommen weiter unten ohnehin dazu, die Liste wird
 * nie leer.
 */
function imHausErreichbar(n: string): boolean {
  // Ein NAME ist keine Adresse — `mupibox.local` gehoert weiter in die Liste.
  if (!istAdresse(n)) return true
  if (n.includes(':')) {
    // IPv6: nur die Rueckschleife und `fc00::/7` (die „eindeutig lokalen").
    // Alles andere unter `2000::/3` ist weltweit anwaehlbar.
    return n === '::1' || /^f[cd]/.test(n)
  }
  const t = n.split('.')
  if (t.length !== 4) return false
  const z = t.map((x) => Number(x))
  if (z.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false
  const [a, b] = z
  return (
    a === 10 || // RFC 1918
    a === 127 || // Rueckschleife
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) || // RFC 1918
    (a === 169 && b === 254) || // RFC 3927, ohne DHCP
    (a === 100 && b >= 64 && b <= 127) // RFC 6598, der Anschluss des Anbieters
  )
}

/** Sieht das nach einer Adresse aus statt nach einem Namen? */
function istAdresse(t: string): boolean {
  return /^[0-9.]+$/.test(t) || t.includes(':')
}

/**
 * Aus dem, was die Box ueber sich weiss, die Menge ihrer Namen bilden.
 *
 * REINE FUNKTION — sie liest weder das Netz noch eine Datei. Genau deshalb
 * laesst sich jeder Fall einzeln pruefen (eigene-namen.spec.ts) und das
 * Messwerkzeug misst dieselbe Formel und nicht eine zweite Fassung davon.
 */
export function namenBilden(q: {
  /** `os.hostname()`. */
  rechnername?: string
  /** Alle Adressen aller Schnittstellen. */
  adressen?: string[]
  /**
   * Adressen, die GELTEN, aber niemandem als Weg genannt werden.
   *
   * Die Bruecken von Docker und Konsorten (`docker0`, `br-…`, `veth…`) haben
   * Adressen wie jede andere Schnittstelle — nur ist die Box darueber von
   * aussen nicht zu erreichen. Wer trotzdem so hereinkommt, soll nicht
   * ausgesperrt werden (deshalb gelten sie), aber einem Menschen, der gerade
   * nicht hereinkommt, `http://172.18.0.1/` hinzuhalten ist eine Sackgasse
   * mehr statt einer weniger.
   */
  empfehlenNicht?: string[]
  /** `mupibox.host` aus mupiboxconfig.json. */
  konfigHost?: string
  /** Was der Betreiber selbst erlaubt hat. */
  zusatz?: string[]
  /** Liessen sich die Schnittstellen ueberhaupt lesen? */
  netzGelesen?: boolean
}): EigeneNamen {
  const namen = new Set<string>()
  const stamm = new Set<string>()
  const erreichbar: string[] = []

  const dazu = (roh: string | undefined, alsStamm: boolean): string => {
    const n = namenNormieren(String(roh ?? ''))
    if (!n) return ''
    namen.add(n)
    if (alsStamm && !istAdresse(n)) {
      const m = ersteMarke(n)
      if (m) stamm.add(m)
    }
    return n
  }

  // 1. Die Rueckschleife gilt IMMER. Der Kiosk auf der Box selbst ruft
  //    `http://localhost:8200/`, und dieser Weg darf unter keinen Umstaenden
  //    von einer Ableitung abhaengen, die schiefgehen kann.
  namen.add('localhost')
  namen.add('127.0.0.1')
  namen.add('::1')

  // 2. Jede Adresse jeder Schnittstelle — auch die inneren. Sie sind die
  //    Namen, unter denen ein zweiter Rechner im Heimnetz die Box erreicht,
  //    und sie sind das Einzige, was auch dann noch geht, wenn kein Name
  //    aufloest. Deshalb stehen sie in `erreichbar` ganz vorn.
  const stumm = new Set((q.empfehlenNicht ?? []).map((a) => namenNormieren(a)).filter(Boolean))
  for (const roh of q.adressen ?? []) {
    const n = dazu(roh, false)
    // `imHausErreichbar` haelt die WELTWEIT anwaehlbaren Adressen aus der
    // Empfehlung heraus — sie GELTEN weiter (`dazu` hat sie schon eingetragen),
    // sie werden nur niemandem mehr vorgesagt. Begruendung dort.
    if (n && n !== '127.0.0.1' && n !== '::1' && !n.startsWith('fe80:') && !stumm.has(n) && imHausErreichbar(n))
      erreichbar.push(n)
  }

  // 3. Der Rechnername, voll und als Marke. `mupibox` → auch `mupibox.local`
  //    und (ueber die Endungsregel) `mupibox.fritz.box`.
  const rn = dazu(q.rechnername, true)
  // 4. Der Name aus der Konfiguration — auf dieser Box `MixPiBox`. Er ist der
  //    einzige der vier, den der Betreiber OHNE SSH aendern kann.
  const kn = dazu(q.konfigHost, true)

  // 5. Was der Betreiber dazugeschrieben hat. Eine Angabe OHNE Punkt zaehlt
  //    zusaetzlich als Marke: wer `musik` erlaubt, meint erkennbar auch
  //    `musik.fritz.box`, und ihn deswegen ein zweites Mal auszusperren waere
  //    Schikane. Eine Angabe MIT Punkt gilt dagegen genau so, wie sie dasteht —
  //    aus `kiste.example.org` darf nicht stillschweigend auch `kiste.lan`
  //    werden; das hat niemand gesagt, und es waere die Endungsregel auf einer
  //    Marke, die der Betreiber gar nicht als Marke gemeint hat.
  for (const roh of q.zusatz ?? []) {
    const n = namenNormieren(String(roh ?? ''))
    if (n) dazu(n, !n.includes('.'))
  }

  // Jede Marke gilt ausdruecklich auch als `.local` — der mDNS-Name ist der,
  // den Anleitungen nennen, und er gehoert in die Liste der Auswege.
  for (const m of stamm) namen.add(`${m}.local`)
  for (const m of [rn, kn]) {
    if (m && !istAdresse(m)) erreichbar.push(`${ersteMarke(m)}.local`)
  }
  erreichbar.push('localhost')

  // VERLAESSLICH heisst: wir haben wirklich etwas ueber uns erfahren. Nur die
  // drei fest eingebauten Rueckschleifennamen sind KEIN Wissen — damit wuerde
  // der Riegel jeden Zugriff aus dem Heimnetz abweisen, also genau die
  // Sackgasse bauen, gegen die diese Datei geschrieben ist.
  const netzGelesen = q.netzGelesen !== false
  const etwasGelernt = stamm.size > 0 || namen.size > 3
  return {
    namen,
    stamm,
    erreichbar: [...new Set(erreichbar)],
    verlaesslich: netzGelesen && etwasGelernt,
    grund: !netzGelesen
      ? 'die Schnittstellen liessen sich nicht lesen'
      : etwasGelernt
        ? undefined
        : 'weder Adresse noch Rechnername waren zu ermitteln',
  }
}

/**
 * Gilt dieser `Host` als eigener Name?
 *
 * Der PORT wird nicht angesehen, und das ist Absicht: unter welchem Port die
 * Box gefragt wurde, weiss sie aus dem Socket, und ein falscher Port bringt
 * einem Angreifer nichts (der Origin-Vergleich in herkunft.ts sieht ihn ohnehin
 * an). Ihn hier zu pruefen, koennte dagegen ein Zwischenstueck aussperren.
 */
export function istEigenerName(roh: string, eigene: EigeneNamen): boolean {
  const n = namenNormieren(roh)
  if (!n) return false
  if (eigene.namen.has(n)) return true
  const punkt = n.indexOf('.')
  if (punkt < 0) return false
  const marke = n.slice(0, punkt)
  if (!eigene.stamm.has(marke)) return false
  const endung = n.slice(punkt + 1)
  return RESERVIERTE_ENDUNGEN.includes(endung)
}

/* ══ Die unreine Seite: einmal nachsehen, kurz merken ═════════════════════ */

/** Wo `mupibox.host` und `mupibox.hostZusatz` stehen — umlenkbar wie ueberall. */
function konfigPfad(): string {
  return process.env.MUPIBOX_CONFIG || '/etc/mupibox/mupiboxconfig.json'
}

/** Der Zusatz aus der Konfiguration: Text mit Kommas ODER Feld — beides gilt. */
function zusatzAusKonfig(roh: unknown): string[] {
  if (Array.isArray(roh)) return roh.map((x) => String(x ?? ''))
  return String(roh ?? '').split(',')
}

let gemerkt: { bis: number; namen: EigeneNamen } | null = null
let gewarnt = false

/**
 * Die Namen dieser Box — hoechstens alle 5 Sekunden neu ermittelt.
 *
 * WARUM UEBERHAUPT NEU: DHCP vergibt eine andere Adresse, jemand steckt das
 * LAN-Kabel ein, jemand aendert den Boxnamen in der Verwaltung. Eine Liste,
 * die beim Start gebildet und nie wieder angesehen wird, sperrt genau dann
 * aus, wenn sich etwas geaendert hat — also im ungeeignetsten Moment.
 *
 * WARUM NICHT BEI JEDER ANFRAGE: `networkInterfaces()` und ein `readFileSync`
 * je Anfrage sind Verschwendung auf einer muede gewordenen Karte. 5 Sekunden
 * merkt beim Umschalten niemand.
 */
export function namenErmitteln(jetzt = Date.now()): EigeneNamen {
  if (gemerkt && jetzt < gemerkt.bis) return gemerkt.namen

  const adressen: string[] = []
  const empfehlenNicht: string[] = []
  let netzGelesen = true
  try {
    const s = networkInterfaces()
    for (const [name, liste] of Object.entries(s)) {
      // Bruecken und Zapfen gelten, werden aber nicht empfohlen — siehe
      // `empfehlenNicht` in `namenBilden`.
      const bruecke = /^(docker|br-|veth|virbr|tun|tap|vmnet)/.test(name)
      for (const a of liste ?? []) {
        if (!a?.address) continue
        adressen.push(a.address)
        if (bruecke) empfehlenNicht.push(a.address)
      }
    }
  } catch {
    // Kommt auf keinem gesunden System vor — und genau deshalb steht hier ein
    // eigener Zweig: wenn es doch passiert, faellt der Namensteil AUS, statt
    // die Box zuzumachen.
    netzGelesen = false
  }

  let rechnername = ''
  try {
    rechnername = hostname()
  } catch {
    /* ohne Rechnernamen wird unten mit den Adressen weitergearbeitet */
  }

  let konfigHost = ''
  let zusatzKonf: string[] = []
  try {
    const roh = JSON.parse(readFileSync(konfigPfad(), 'utf8')) as {
      mupibox?: { host?: unknown; hostZusatz?: unknown }
    }
    konfigHost = String(roh?.mupibox?.host ?? '')
    zusatzKonf = zusatzAusKonfig(roh?.mupibox?.hostZusatz)
  } catch {
    // Eine kaputte oder fehlende Konfiguration darf den Riegel nicht zumachen:
    // die Adressen und der Rechnername reichen, um die Box zu erreichen.
  }

  const namen = namenBilden({
    rechnername,
    adressen,
    empfehlenNicht,
    konfigHost,
    zusatz: [...zusatzKonf, ...String(process.env.MUPIBOX_HOST_ZUSATZ ?? '').split(',')],
    netzGelesen,
  })

  if (!namen.verlaesslich && !gewarnt) {
    gewarnt = true
    console.warn(
      `${new Date().toLocaleString()}: [MuPiBox-Server] Herkunftsriegel: die eigenen Namen liessen sich nicht ermitteln (${namen.grund}) — der Namensteil des Riegels bleibt AUS. Die Box ist damit erreichbar wie bisher.`,
    )
  }

  gemerkt = { bis: jetzt + 5000, namen }
  return namen
}

/** Nur fuer Tests und Messwerkzeuge: den Puffer wegwerfen. */
export function namenVergessen(): void {
  gemerkt = null
  gewarnt = false
}

/**
 * Die Wege, die dem ausgesperrten Menschen genannt werden — als fertige Links.
 *
 * ── WARUM HIER SORTIERT WIRD, UND ZWAR BEVOR GEKUERZT WIRD ────────────────
 * GEMESSEN (tools/riegel-ausgesperrt-was-sieht-er.mjs, Ring C): die Liste kam
 * in der Reihenfolge heraus, in der das Betriebssystem die Schnittstellen
 * aufzaehlt, und die ersten vier waren
 *
 *     http://192.168.178.65/  ·  http://[2001:9e8:…]/  ·  http://[fd03:…]/
 *     ·  http://172.18.0.1/
 *
 * — zwei IPv6-Adressen, die kaum jemand abtippt, und die BRUECKE VON DOCKER,
 * ueber die die Box von aussen ueberhaupt nicht zu erreichen ist. Der Name
 * `mixpibox.local`, den jede Anleitung nennt, fiel hinten heraus.
 *
 * Also: erst das, was ein Mensch wirklich eintippt (IPv4), dann die Namen,
 * dann IPv6 — und Adressen von Bruecken gar nicht. Sie GELTEN weiter (wer so
 * hereinkommt, wird nicht ausgesperrt), sie werden nur nicht EMPFOHLEN.
 */
export function eigeneAdressen(eigene: EigeneNamen, schema: string, port: number | null): string[] {
  const anhang = port && port !== (schema === 'https' ? 443 : 80) ? `:${port}` : ''
  const rang = (n: string): number => {
    if (/^[0-9.]+$/.test(n)) return 0 // IPv4 — das tippt man ab
    if (!n.includes(':')) return 1 // ein Name
    return 2 // IPv6
  }
  return [...eigene.erreichbar]
    .sort((a, b) => rang(a) - rang(b))
    .slice(0, 5)
    .map((n) => `${schema}://${n.includes(':') ? `[${n}]` : n}${anhang}/`)
}

/**
 * Der Satz, den ein ausgesperrter Mensch zu lesen bekommt.
 *
 * ER IST DER UNTERSCHIED ZWISCHEN AERGERNIS UND SACKGASSE. Deshalb steht darin
 * NICHT nur „nein", sondern drei Dinge: unter welchem Namen die Box gerade
 * gerufen wurde, unter welchen Adressen sie STATTDESSEN erreichbar ist (als
 * fertige Links, denn eine Adresse ist immer dabei — sonst waere die Anfrage
 * nicht angekommen), und wie sich der Name dauerhaft erlauben laesst.
 */
export function fremderNameSatz(gerufen: string, eigene: EigeneNamen, schema: string, port: number | null): string {
  const links = eigeneAdressen(eigene, schema, port).join('  ·  ')
  const name = gerufen || '(ohne Namen)'
  return [
    `Diese Box kennt sich unter dem Namen „${name}" nicht — deshalb antwortet sie darauf nicht.`,
    'Der Grund: unter einem fremden Namen koennte sich eine fremde Webseite als diese Box ausgeben und ihre Einstellungen lesen und aendern.',
    links ? `SO ERREICHEN SIE SIE JETZT:  ${links}` : '',
    `SOLL „${name}" DAUERHAFT GELTEN: in /etc/mupibox/mupiboxconfig.json unter "mupibox" den Eintrag "hostZusatz": "${name}" ergaenzen (mehrere durch Komma getrennt) — oder die Umgebungsvariable MUPIBOX_HOST_ZUSATZ setzen. Die Datei wird laufend neu gelesen, ein Neustart ist nicht noetig.`,
  ]
    .filter(Boolean)
    .join(' ')
}

/** Text, der gefahrlos in HTML steht. Der Name kommt aus `Host` — also FREMD. */
function htmlSicher(roh: string): string {
  return String(roh ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * DIESELBE AUSKUNFT ALS SEITE, DIE EIN MENSCH WIRKLICH LIEST.
 *
 * ── WARUM ES DIESE ZWEITE FASSUNG GIBT ────────────────────────────────────
 * `fremderNameSatz` steht im JSON-Rumpf einer 403 auf `/api`. Das ist genau
 * richtig fuer die Oberflaeche — und fuer einen Menschen wertlos, wenn die
 * Oberflaeche ihn nicht anzeigt. GEMESSEN
 * (tools/riegel-ausgesperrt-was-sieht-er.mjs, Ring C), in einem echten
 * Browser unter einem Namen, den die Box nicht kennt:
 *
 *   * `/`      — Seite kam, 21 Anfragen fielen mit 403, SICHTBARER TEXT: 0
 *                Zeichen. Ein weisser Schirm, kein Wort.
 *   * `/neu/`  — „Die Medienliste ist gerade nicht zu erreichen … Noch einmal
 *                versuchen". Als STOERUNG gemeldet, die keine ist; das
 *                Wiederholen hilft nie.
 *   * `/admin` — „Passwort / Anmelden". Die schlimmste der drei: sie schickt
 *                den Besitzer nach einem Passwort suchen, das es gar nicht
 *                gibt (`interfacelogin.state = false` ist die Vorlage).
 *
 * Alle drei sind Sackgassen, und der Satz mit dem Ausweg lag in allen drei
 * Faellen im Rumpf, den niemand zu sehen bekam. Deshalb beantwortet der
 * Seitenriegel eine NAVIGATION mit dieser Seite statt mit JSON.
 *
 * SIE HAENGT AN NICHTS: kein Stilblatt, kein Schriftschnitt, kein Bild. Wer
 * sie zu sehen bekommt, kommt an die Box gerade nicht heran — dann darf die
 * Erklaerung nicht ihrerseits etwas nachladen wollen. Und sie passt auf
 * 800×480, den Schirm der Box.
 */
export function fremderNameSeite(gerufen: string, eigene: EigeneNamen, schema: string, port: number | null): string {
  const name = htmlSicher(gerufen || '(ohne Namen)')
  const wege = eigeneAdressen(eigene, schema, port)
    .map((u) => `<li><a href="${htmlSicher(u)}">${htmlSicher(u)}</a></li>`)
    .join('')
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diese Box heisst nicht so</title><style>
:root{color-scheme:light dark}
body{font-family:system-ui,sans-serif;line-height:1.5;margin:0;padding:1.2rem 1.4rem;
  background:#f6f6f8;color:#1a1a1e}
@media(prefers-color-scheme:dark){body{background:#16161a;color:#ececf0}}
h1{font-size:1.35rem;margin:0 0 .6rem}
p{margin:.5rem 0;max-width:44rem}
ul{margin:.4rem 0;padding-left:1.2rem}
a{color:#0b62c4}@media(prefers-color-scheme:dark){a{color:#7ab6ff}}
code{background:#0001;padding:.1rem .3rem;border-radius:.2rem}
@media(prefers-color-scheme:dark){code{background:#fff2}}
.k{font-size:.92rem;opacity:.85}
</style></head><body>
<h1>Diese Box kennt sich unter dem Namen „${name}" nicht.</h1>
<p>Deshalb antwortet sie darauf nicht. Der Grund: unter einem fremden Namen koennte sich
eine fremde Webseite als diese Box ausgeben und ihre Einstellungen lesen und aendern.</p>
<p><strong>So erreichen Sie sie jetzt — ohne weitere Hilfsmittel:</strong></p>
<ul>${wege || '<li>(keine Adresse zu ermitteln)</li>'}</ul>
<p class="k">Soll „${name}" <strong>dauerhaft</strong> gelten: in
<code>/etc/mupibox/mupiboxconfig.json</code> unter <code>"mupibox"</code> den Eintrag
<code>"hostZusatz": "${name}"</code> ergaenzen (mehrere durch Komma getrennt) — oder die
Umgebungsvariable <code>MUPIBOX_HOST_ZUSATZ</code> setzen. Die Datei wird laufend neu
gelesen, ein Neustart ist nicht noetig.</p>
</body></html>`
}
