/**
 * Funk an und aus — und die eine Bedingung, die darüber steht.
 *
 * WORUM ES GEHT: In der Verwaltung sollen Bluetooth und WLAN einzeln
 * abschaltbar sein, dazu ein Flugmodus für beides. Bluetooth ist harmlos.
 * WLAN ist es nicht: an dieser Box läuft ALLES über `wlan0`
 * (`ip -4 -o addr show scope global` nennt genau eine Zeile; `eth0` existiert,
 * hat aber keine Adresse und ist in `/etc/network/interfaces` nicht einmal
 * für den Start vorgesehen). Wer das WLAN aus der Ferne abschaltet, nimmt der
 * Box ihren einzigen Weg nach draußen — und niemand kann sie zurückholen.
 * Kein Neustart hilft, denn beim nächsten Start ist die Lage dieselbe.
 *
 * DESHALB STEHT DIE PRÜFUNG HIER UND NICHT IN DER OBERFLÄCHE. Eine
 * ausgegraute Schaltfläche ist eine Bitte; ein Endpunkt, der 409 antwortet,
 * ist eine Bedingung. Die Oberfläche darf denselben Zustand zeigen — sie darf
 * aber nicht die einzige Stelle sein, die ihn kennt.
 *
 * DIESES MODUL IST REIN. Es ruft nichts auf und liest nichts; es bekommt den
 * gelesenen Zustand und sagt, was gilt. Genau deshalb lässt sich die Regel
 * prüfen, ohne an der Box irgendetwas zu schalten — und das ist die einzige
 * Art, sie zu prüfen, die niemanden aussperrt.
 */

import type { Schnittstelle } from './netzwerk.js'

/** Ein Weg zur Box: eine Schnittstelle, so wie sie gerade dasteht. */
export interface Weg {
  name: string
  /** WLAN (wlan0, wlp2s0 …) — genau das, was hier abgeschaltet werden soll. */
  funk: boolean
  /** Die erste globale IPv4, oder '' wenn keine da ist. */
  adresse: string
  /**
   * Steckt ein Kabel? `/sys/class/net/<x>/carrier`.
   *
   * `null` heißt NICHT „kein Kabel", sondern „nicht feststellbar": bei einer
   * heruntergefahrenen Schnittstelle liefert der Kernel beim Lesen einen
   * Fehler, und die Datei ist leer (an dieser Box für `eth0` nachgesehen).
   * Wer das mit `false` verwechselt, behauptet Wissen, das er nicht hat.
   */
  kabel: boolean | null
  /** `operstate` aus dem Kernel: up, down, dormant, unknown … */
  zustand: string
  /**
   * Erreicht jemand die Box hierüber JETZT?
   *
   * DREI DINGE MÜSSEN ZUSAMMENKOMMEN, und jedes einzelne davon fehlte einmal:
   *
   *   1. eine Adresse, die von außen erreichbar ist. Ein steckendes Kabel ohne
   *      Adresse trägt nichts: an dieser Box ist `eth0` in
   *      /etc/network/interfaces ohne `auto`/`allow-hotplug` eingetragen — es
   *      käme selbst mit Kabel nicht von allein hoch.
   *   2. …und zwar keine, die nur auf diesem Rechner gilt: `169.254.x.y` ist
   *      das, was sich eine Schnittstelle selbst gibt, wenn KEIN DHCP-Server
   *      antwortet. Sie sieht aus wie eine Adresse und ist doch das Gegenteil
   *      eines Wegs — genau die Lage „Kabel steckt, aber da ist niemand".
   *   3. ein Anschluss, der auch oben ist. UND DAS IST DIE UMKEHRUNG, DIE
   *      GEFEHLT HAT: eine Adresse ohne Kabel trägt genauso wenig wie ein Kabel
   *      ohne Adresse. Zieht jemand das Netzwerkkabel, BLEIBT die per DHCP
   *      geholte Adresse im Kernel stehen, bis die Laufzeit abläuft — `ip addr`
   *      zeigt sie noch, erreichbar ist die Box darüber nicht mehr. Wer nur auf
   *      die Adresse sieht, schaltet in genau diesem Moment das WLAN ab.
   */
  traegt: boolean
  /**
   * Kommt dieser Anschluss als ZWEITER WEG in Frage — unabhängig vom Funk?
   *
   * Nötig ist echte Hardware, die kein Funk ist. Der Kernel sagt beides selbst:
   * `/sys/class/net/<x>/device` gibt es nur bei einem echten Gerät, `wireless`
   * bzw. `phy80211` nur bei einer Funkschnittstelle (an der Box nachgesehen:
   * `eth0/device -> ../../../1f00100000.ethernet`, `wlan0/phy80211 -> phy0`).
   *
   * WARUM DER NAME NICHT REICHT: `tun0`, `wg0`, `docker0`, `br-…`, `tailscale0`
   * haben eine eigene Adresse, sind kein Funk — und laufen doch ÜBER das WLAN.
   * Ein VPN als Rückweg zu zählen heißt, den Rückweg mit abzuschalten. Sie
   * haben alle kein `device`, und genau daran sind sie zu erkennen.
   *
   * Ist sysfs nicht lesbar, ist das hier `false` und damit kein Rückweg. Kein
   * Wissen ist kein Freibrief — die Richtung, in die ein Irrtum fallen darf,
   * ist „lieber 409".
   */
  eigenstaendig: boolean
}

/**
 * `carrier` auswerten. Pure.
 *
 * '1' -> Kabel, '0' -> keins, alles andere (leer, Fehler, fehlende Datei)
 * -> unbekannt.
 */
export function carrierLesen(roh: string | null | undefined): boolean | null {
  if (roh === null || roh === undefined) return null
  const t = roh.trim()
  if (t === '1') return true
  if (t === '0') return false
  return null
}

/** Was aus `/sys/class/net/<name>/` gelesen wurde. */
export interface SysZeile {
  carrier: string | null
  operstate: string | null
  /** Gibt es `/sys/class/net/<x>/device`? Nur echte Hardware hat das. */
  geraet?: boolean
  /** Gibt es `wireless`/`phy80211`? Der Kernel selbst sagt damit „Funk". */
  funkSys?: boolean
}

/**
 * Taugt diese IPv4 als Weg von außen zur Box? Pure.
 *
 * Draußen bleiben:
 *   * `169.254.x.y` — die gibt sich eine Schnittstelle SELBST, wenn kein
 *     DHCP-Server antwortet. Sie ist der Beweis, dass niemand da war.
 *   * `127.x` — derselbe Rechner, kein Weg aus dem Netz.
 *   * `0.0.0.0` — gar keine Adresse.
 *
 * Das ist dasselbe Urteil, das `parseIpAddr` für IPv6 schon fällt (`fe80::`
 * fliegt dort raus). Für IPv4 fehlte es.
 */
export function adresseTraegt(adresse: string): boolean {
  const a = (adresse ?? '').trim()
  if (!a) return false
  if (a === '0.0.0.0') return false
  if (/^169\.254\./.test(a)) return false
  if (/^127\./.test(a)) return false
  return true
}

/**
 * Ist der Anschluss selbst oben? Pure.
 *
 * `kabel === false` heißt: der Kernel sagt ausdrücklich „kein Träger". Dann ist
 * eine noch stehende Adresse eine Erinnerung, kein Weg. `null` heißt dagegen
 * „nicht feststellbar" und wird nicht gegen den Anschluss gewertet.
 *
 * Beim `operstate` zählt nur, was NICHT unten ist. `unknown` gilt als oben —
 * manche Treiber melden nichts Besseres, und das darf keinen Rückweg kosten.
 */
export function anschlussOben(kabel: boolean | null, zustand: string): boolean {
  if (kabel === false) return false
  const z = (zustand ?? '').trim().toLowerCase()
  return z !== 'down' && z !== 'lowerlayerdown' && z !== 'notpresent' && z !== 'dormant'
}

/**
 * Aus Schnittstellen und sysfs die Liste der Wege bauen. Pure.
 *
 * Loopback ist schon draußen: `parseIpAddr` lässt `lo` weg. Das ist richtig —
 * über 127.0.0.1 erreicht niemand die Box aus dem Netz, und als „zweiter Weg"
 * gezählt wäre es genau die Lüge, die hier verhindert werden soll.
 */
export function wegeBauen(schnittstellen: Schnittstelle[], sys: Record<string, SysZeile | undefined>): Weg[] {
  return schnittstellen.map((s) => {
    const v4 = s.adressen.find((a) => a.familie === 'v4')
    const adresse = v4?.adresse ?? ''
    const z = sys[s.name]
    const kabel = carrierLesen(z?.carrier)
    // Fällt sysfs aus, ist `ip` die zweite Quelle — und die sagt bei allem,
    // was nicht UP ist, „unten". „unknown" wäre hier zu freundlich: es hieße
    // „weiß nicht" und würde als oben durchgehen.
    const zustand = (z?.operstate ?? '').trim() || (s.aktiv ? 'up' : 'down')
    // Der Name ist der Anhaltspunkt, der Kernel der Beleg: ein Adapter, der
    // nicht `wl…` heißt (`ra0` etwa), ist trotzdem Funk, wenn er ein `phy80211`
    // hat — und würde sonst als Rückweg gezählt und mit abgeschaltet.
    const funk = s.funk || z?.funkSys === true
    return {
      name: s.name,
      funk,
      adresse,
      kabel,
      zustand,
      traegt: adresseTraegt(adresse) && anschlussOben(kabel, zustand),
      eigenstaendig: !funk && z?.geraet === true,
    }
  })
}

/**
 * Der zweite Weg: ein eigenständiger Anschluss, der die Box JETZT trägt.
 *
 * Warum kein zweites WLAN zählt: „WLAN aus" schaltet den Funk ab, nicht einen
 * einzelnen Adapter. Wer `wlan1` als Rückweg zählte, würde ihn im selben
 * Atemzug mit abschalten. Aus demselben Grund zählt auch kein Tunnel und keine
 * Brücke — siehe `Weg.eigenstaendig`.
 */
export function zweiterWeg(wege: Weg[]): Weg | null {
  return wege.find((w) => w.eigenstaendig && w.traegt) ?? null
}

/** Das Ergebnis der Prüfung — mit dem Grund im Klartext. */
export interface Freigabe {
  erlaubt: boolean
  /** Für Menschen, nicht für Maschinen. Wandert wörtlich in die Oberfläche. */
  grund: string
  /** Der Anschluss, über den die Box danach noch erreichbar ist. */
  ueber: Weg | null
  /** Erlaubt NUR, weil jemand vor der Box steht. */
  nurVorOrt: boolean
}

export const GRUND_KEIN_ZWEITER_WEG = 'Die Box hängt nur am WLAN. Ausschalten macht sie unerreichbar.'

/**
 * Darf der Funk aus? Pure. Das ist die Regel aus dem Auftrag.
 *
 * Drei Fälle, in dieser Reihenfolge:
 *   1. Ein Kabel MIT Adresse ist da  -> erlaubt, die Adresse wird genannt.
 *   2. Der Aufruf kommt VON DER BOX  -> erlaubt, denn dort steht jemand davor.
 *   3. Sonst                          -> nein, mit Grund.
 *
 * Fall 1 zuerst, weil er der bessere ist: er stimmt auch, wenn niemand
 * danebensteht.
 */
export function funkAusFreigabe(wege: Weg[], vonDerBox: boolean): Freigabe {
  const rueckweg = zweiterWeg(wege)
  if (rueckweg) {
    return {
      erlaubt: true,
      grund: `Die Box bleibt über ${rueckweg.adresse} (${rueckweg.name}) erreichbar. Wer diese Seite gerade über WLAN bedient, verliert sie trotzdem.`,
      ueber: rueckweg,
      nurVorOrt: false,
    }
  }
  if (vonDerBox) {
    return {
      erlaubt: true,
      grund:
        'Kein zweiter Weg — erlaubt nur, weil der Aufruf von der Box selbst kommt. Wieder einschalten geht dann auch nur dort.',
      ueber: null,
      nurVorOrt: true,
    }
  }
  return { erlaubt: false, grund: GRUND_KEIN_ZWEITER_WEG, ueber: null, nurVorOrt: false }
}

/**
 * Kommt die Anfrage von der Box selbst? Pure.
 *
 * UND WO DIE GRENZEN LIEGEN — das gehört dazu, sonst hält man das hier für
 * einen Nachweis:
 *
 *   * Geprüft wird die Gegenstelle der TCP-Verbindung
 *     (`req.socket.remoteAddress`), NICHT `req.ip`. `req.ip` folgt bei
 *     gesetztem `trust proxy` dem Kopf `X-Forwarded-For` — und ein Kopf ist in
 *     drei Sekunden gefälscht. Die Gegenstelle ist es nicht.
 *   * Loopback beweist „derselbe Rechner", nicht „ein Mensch steht davor".
 *     Wer auf der Box eine Shell hat (SSH!), erfüllt die Bedingung ebenfalls.
 *     Das ist hingenommen: wer eine Shell auf der Box hat, könnte `ifdown`
 *     ohnehin direkt aufrufen — der Endpunkt schützt niemanden vor ihm.
 *   * Ein SSH-Tunnel (`ssh -L 8200:localhost:8200`) sieht von hier aus wie
 *     Loopback. Deshalb reicht Loopback ALLEIN nicht: der Aufrufer muss
 *     zusätzlich `vorOrt: true` mitschicken. Das ist keine Hürde gegen
 *     Böswillige, sondern gegen Versehen — ein Klick in einer alten
 *     Oberfläche kann die Box so nicht aus dem Netz nehmen.
 */
export function istLoopback(adresse: string | null | undefined): boolean {
  if (!adresse) return false
  const a = adresse
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, '')
  if (a === '::1') return true
  // 127.0.0.0/8 — nicht nur 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a)
}

/** Beides zusammen: von der Box UND ausdrücklich so gemeint. */
export function vonDerBox(fernAdresse: string | null | undefined, vorOrtGewuenscht: unknown): boolean {
  return vorOrtGewuenscht === true && istLoopback(fernAdresse)
}

/**
 * `bluetoothctl show` auswerten. Pure.
 *
 * Zwei Zeilen sagen dasselbe („Powered: yes" und „PowerState: on", an der Box
 * mit BlueZ 5.82 nachgesehen). `Powered` ist die ältere und in jeder Fassung
 * vorhandene — sie zählt zuerst, `PowerState` ist der Rückfall.
 * `null` heißt „nicht auslesbar", nicht „aus": kein Adapter, bluetoothctl
 * fehlt, Ausgabe leer. Das als „aus" anzuzeigen wäre eine falsche Auskunft.
 */
export function btPowerLesen(text: string): boolean | null {
  const t = text ?? ''
  const p = /^\s*Powered:\s*(yes|no)\s*$/im.exec(t)
  if (p) return p[1].toLowerCase() === 'yes'
  const s = /^\s*PowerState:\s*(on|off|off-enabling|on-disabling)\s*$/im.exec(t)
  if (s) return s[1].toLowerCase().startsWith('on')
  return null
}

/**
 * Wie das WLAN auf DIESER Box geschaltet wird.
 *
 * `rfkill` GIBT ES HIER NICHT (nachgesehen: nicht installiert), `nmcli`
 * ebenso wenig — NetworkManager läuft gar nicht. Was da ist:
 *
 *   ifupdown   /sbin/ifup, /sbin/ifdown, `networking.service` aktiv,
 *              `ifup@wlan0.service` aktiv, `wlan0` steht in
 *              /etc/network/interfaces mit `wpa-conf` und `inet dhcp`.
 *   ip         /usr/bin/ip, immer da.
 *
 * GEWÄHLT WIRD IFUPDOWN, und der Grund ist die RÜCKRICHTUNG: `ifdown` nimmt
 * die Adresse, beendet wpa_supplicant und legt die Schnittstelle hin; `ifup`
 * macht genau das rückgängig — inklusive DHCP. `ip link set wlan0 down`
 * schaltet zwar auch ab, aber das zugehörige `up` bringt nur die
 * Schnittstelle zurück, nicht die Verbindung und nicht die Adresse. Ein
 * Schalter, der nur in eine Richtung geht, ist kein Schalter.
 *
 * `ip` bleibt als Rückfall für Boxen ohne ifupdown — dort mit dem ehrlichen
 * Hinweis, dass die Rückrichtung unvollständig sein kann.
 */
export type Schaltweg = 'ifupdown' | 'ip'

export interface Schaltbefehl {
  befehl: string
  args: string[]
  /** Ein Fehlschlag hier ist nicht schlimm (z. B. „already configured"). */
  weich: boolean
}

/**
 * Die Befehle zum Abschalten. Pure — nur die Liste, ausgeführt wird woanders.
 *
 * `sudo -n`: der Serverdienst läuft als `dietpi` (nachgesehen in
 * mupibox-server.service), und `ifup`/`ifdown` verlangen root. `-n` heißt:
 * niemals nach einem Passwort fragen, lieber scheitern — ein Dienst, der auf
 * eine Passworteingabe wartet, hängt sonst bis zur Frist.
 */
export function wlanAusBefehle(iface: string, weg: Schaltweg): Schaltbefehl[] {
  if (weg === 'ifupdown') {
    return [
      // `--force`: ifupdown führt in /run/network/ifstate Buch. Steht die
      // Schnittstelle dort nicht (weil sie jemand mit `ip` hochgezogen hat),
      // sagt `ifdown` „not configured" und tut nichts.
      { befehl: 'sudo', args: ['-n', '/sbin/ifdown', '--force', iface], weich: false },
    ]
  }
  return [{ befehl: 'sudo', args: ['-n', 'ip', 'link', 'set', iface, 'down'], weich: false }]
}

/**
 * Die Befehle zum Einschalten.
 *
 * Zwei Schritte bei ifupdown, und der zweite ist der wichtige: `ifup` bricht
 * mit „already configured" ab, wenn ifstate die Schnittstelle noch als oben
 * führt — dann ist `ip link set up` das, was sie tatsächlich zurückholt.
 * Beide dürfen fehlschlagen, ohne dass das Einschalten als gescheitert gilt;
 * ob es geklappt hat, entscheidet danach der Blick auf die Adresse, nicht der
 * Rückgabewert.
 */
export function wlanAnBefehle(iface: string, weg: Schaltweg): Schaltbefehl[] {
  if (weg === 'ifupdown') {
    return [
      { befehl: 'sudo', args: ['-n', 'ip', 'link', 'set', iface, 'up'], weich: true },
      { befehl: 'sudo', args: ['-n', '/sbin/ifup', iface], weich: true },
    ]
  }
  return [{ befehl: 'sudo', args: ['-n', 'ip', 'link', 'set', iface, 'up'], weich: true }]
}
