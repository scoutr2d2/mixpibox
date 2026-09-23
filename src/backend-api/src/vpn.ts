/**
 * VPN-Heimweg: die Box als WireGuard-Klient (BACKLOG E30).
 *
 * WORUM ES GEHT: Nimmt jemand die Box mit (Urlaub, Großeltern), sollen
 * Jellyfin, das NAS und die Verwaltung erreichbar bleiben — alles hängt an
 * Adressen im Heimnetz. Der Server dafür steht ZU HAUSE (FRITZ!Box, NAS);
 * die Box baut nur die ausgehende Verbindung auf. Es muss daheim kein Port
 * auf die Box zeigen, und das ist der ganze Sicherheitsgewinn.
 *
 * DIESES MODUL IST REIN wie funk.ts: es liest nichts und ruft nichts auf.
 * Es bekommt den Text einer WireGuard-Datei (FRITZ!Box: „Einstellungen für
 * das Gerät exportieren") und sagt, was gilt — oder es bekommt die Ausgabe
 * von `wg show <name> dump` und sagt, was sie bedeutet. Nur so lässt sich
 * jede Regel prüfen, ohne einen Tunnel zu bauen.
 *
 * DIE VIER REGELN, UND WOHER SIE KOMMEN:
 *
 * 1. KEIN VOLLTUNNEL (E30/W1). `AllowedIPs = 0.0.0.0/0` hieße: ALLES läuft
 *    über die Heimleitung — auch Spotify, langsamer und ohne Gewinn. Die
 *    FRITZ!Box exportiert so eine Datei, wenn beim Anlegen „gesamten
 *    IPv4-Netzwerkverkehr über die VPN-Verbindung senden" angehakt war.
 *    Abgelehnt statt still umgeschrieben: wer die Datei ändert, ändert sie
 *    beim Export, dann stimmen beide Seiten überein.
 *
 * 2. KEINE BEFEHLSZEILEN (PostUp/PreUp/PostDown/PreDown). wg-quick führt
 *    diese Zeilen als ROOT aus. Eine hochgeladene Datei ist Daten, keine
 *    Befehle — dieselbe Haltung wie bei der SSID-Prüfung (keine Shell,
 *    nichts vom Anrufer ausführen). FRITZ!Box-Exporte enthalten sie nie.
 *
 * 3. DNS-ZEILEN WERDEN GESTRICHEN, mit Ansage. Draußen nachgelesen
 *    (Debian-Fehler 968683): steht `DNS =` in der Datei und fehlt
 *    `resolvconf`, bricht `wg-quick up` HART ab — die Schnittstelle
 *    entsteht gar nicht. Auf der Box ist resolvconf nicht installiert, und
 *    für den Heimweg (nur 192.168.178.0/24 durch den Tunnel) braucht es
 *    auch kein Heim-DNS: die Geräte dort werden über Adressen angesprochen.
 *    Ehrliche Folge, die im Hinweis steht: Namen wie `fritz.box` löst die
 *    Box unterwegs nicht auf.
 *
 * 4. KEEPALIVE 25, WENN ER FEHLT. Unterwegs sitzt die Box hinter fremdem
 *    NAT; ohne Lebenszeichen räumt der fremde Router die Zuordnung ab, und
 *    das Heimnetz erreicht die Box nicht mehr (die Verwaltung von daheim aus
 *    wäre tot, obwohl der Tunnel „steht"). Die FRITZ!Box setzt 25 selbst —
 *    ergänzt wird nur, was fehlt, und es steht im Hinweis.
 *
 * WAS HIER NIE HERAUSGEHT (E30/W3): der private Schlüssel und ein
 * PresharedKey. `konfigLesen` behält beide nur für `konfigSchreiben`;
 * `dumpLesen` überspringt die Felder, in denen `wg` sie zeigt.
 */

/** Ein WireGuard-Schlüssel: 32 Byte, base64, 44 Zeichen mit einem `=`. */
const SCHLUESSEL_MUSTER = /^[A-Za-z0-9+/]{43}=$/

/** `host:port`, `1.2.3.4:port` oder `[2001:db8::1]:port`. */
const ENDPUNKT_MUSTER = /^(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9._-]+):(\d{1,5})$/

export interface VpnKonfig {
  /** NUR für `konfigSchreiben`. Taucht in keiner Antwort und keinem Protokoll auf (E30/W3). */
  privaterSchluessel: string
  /** Dito — die FRITZ!Box legt immer einen bei. */
  presharedSchluessel: string | null
  /** Tunnel-Adresse(n) der Box, z. B. 192.168.178.201/24. */
  adressen: string[]
  mtu: number | null
  /** Öffentlicher Schlüssel der Gegenstelle — öffentlich, darf angezeigt werden. */
  gegenstelle: string
  /** Was durch den Tunnel geht. Nach Regel 1 nie „alles". */
  erlaubteNetze: string[]
  /** Wo der Heimserver wohnt, z. B. xyz.myfritz.net:51820. */
  endpunkt: string
  keepalive: number
  /** Was beim Übernehmen verändert wurde — geht wörtlich in die Oberfläche. */
  hinweise: string[]
}

export type VpnPruefung = { ok: true; konfig: VpnKonfig } | { ok: false; fehler: string }

/** Der Keepalive, der ergänzt wird, wenn die Datei keinen nennt (Regel 4). */
export const KEEPALIVE_VORGABE = 25

/**
 * Zeilen, die wg-quick als root AUSFÜHRT (Regel 2). `SaveConfig` steht mit
 * dabei: es ließe wg-quick beim Anhalten die Datei ÜBERSCHREIBEN — dann wäre
 * nicht mehr die übernommene Fassung die Wahrheit, sondern eine, die niemand
 * geprüft hat. `Table` verstellt, in welche Routing-Tabelle die Netze gehen —
 * genau der Hebel, der aus dem Heimweg doch einen Volltunnel machen kann.
 */
const VERBOTENE_SCHLUESSEL = new Set(['preup', 'postup', 'predown', 'postdown', 'saveconfig', 'table'])

/** Was in [Interface] bzw. [Peer] verstanden wird — alles andere lehnt wg-quick selbst ab. */
const INTERFACE_SCHLUESSEL = new Set(['privatekey', 'address', 'dns', 'mtu', 'listenport'])
const PEER_SCHLUESSEL = new Set(['publickey', 'presharedkey', 'allowedips', 'endpoint', 'persistentkeepalive'])

interface Zeile {
  abschnitt: 'interface' | 'peer'
  schluessel: string
  wert: string
  nr: number
}

/**
 * Ist dieses Netz „alles"? `/0` ist der Volltunnel, den die FRITZ!Box bei
 * „gesamten Verkehr" exportiert. `/1` steht mit auf der Liste, weil das Paar
 * 0.0.0.0/1 + 128.0.0.0/1 der bekannte Trick ist, denselben Volltunnel zu
 * bauen, ohne /0 zu schreiben — in einer Heimnetz-Datei hat ein /1 nie einen
 * ehrlichen Grund.
 */
export function netzIstAlles(netz: string): boolean {
  const teile = netz.trim().split('/')
  if (teile.length !== 2) return false
  const praefix = Number(teile[1])
  return Number.isInteger(praefix) && praefix <= 1
}

/** Grobe Form eines Netzes/einer Adresse: IPv4 [mit /0-32] oder IPv6 [mit /0-128]. */
export function netzForm(netz: string): boolean {
  const t = netz.trim()
  const [adresse, praefix, zuviel] = t.split('/')
  if (zuviel !== undefined) return false
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(adresse)
  if (v4) {
    if (v4.slice(1).some((o) => Number(o) > 255)) return false
    if (praefix === undefined) return true
    const p = Number(praefix)
    return /^\d{1,2}$/.test(praefix) && p >= 0 && p <= 32
  }
  // IPv6 nur der Form nach: Hexblöcke und Doppelpunkte. Wer hier lügt,
  // scheitert eine Schicht tiefer an `wg` selbst — mit dessen Meldung.
  if (!/^[0-9a-fA-F:]+$/.test(adresse) || !adresse.includes(':')) return false
  if (praefix === undefined) return true
  const p = Number(praefix)
  return /^\d{1,3}$/.test(praefix) && p >= 0 && p <= 128
}

/** Kommagetrennte Werte, auch über mehrere gleichnamige Zeilen gesammelt. */
function werteSammeln(zeilen: Zeile[], abschnitt: string, schluessel: string): string[] {
  return zeilen
    .filter((z) => z.abschnitt === abschnitt && z.schluessel === schluessel)
    .flatMap((z) => z.wert.split(','))
    .map((w) => w.trim())
    .filter((w) => w !== '')
}

function einWert(zeilen: Zeile[], abschnitt: string, schluessel: string): string | null {
  const treffer = zeilen.filter((z) => z.abschnitt === abschnitt && z.schluessel === schluessel)
  return treffer.length > 0 ? treffer[treffer.length - 1].wert.trim() : null
}

/**
 * Den Text einer WireGuard-Datei lesen und prüfen.
 *
 * Fehlermeldungen sind für den Menschen vor der Verwaltung geschrieben: sie
 * nennen die Zeile und sagen, was stattdessen zu tun ist — meist „beim
 * Export auf der FRITZ!Box anders wählen", denn DORT entsteht die Datei.
 */
export function konfigLesen(text: string): VpnPruefung {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, fehler: 'Die Datei ist leer.' }
  }
  if (text.length > 64 * 1024) {
    return { ok: false, fehler: 'Die Datei ist zu groß für eine WireGuard-Konfiguration.' }
  }

  const zeilen: Zeile[] = []
  let abschnitt: 'interface' | 'peer' | null = null
  let interfaceAnzahl = 0
  let peerAnzahl = 0

  const roh = text.split(/\r?\n/)
  for (let i = 0; i < roh.length; i++) {
    const nr = i + 1
    const zeile = roh[i].trim()
    if (zeile === '' || zeile.startsWith('#') || zeile.startsWith(';')) continue

    const kopf = /^\[(.+)\]$/.exec(zeile)
    if (kopf) {
      const name = kopf[1].trim().toLowerCase()
      if (name === 'interface') {
        abschnitt = 'interface'
        interfaceAnzahl++
      } else if (name === 'peer') {
        abschnitt = 'peer'
        peerAnzahl++
      } else {
        return { ok: false, fehler: `Zeile ${nr}: unbekannter Abschnitt [${kopf[1].trim()}].` }
      }
      continue
    }

    const gleich = zeile.indexOf('=')
    if (gleich <= 0) {
      return { ok: false, fehler: `Zeile ${nr}: „${zeile}" ist weder Abschnitt noch Schlüssel = Wert.` }
    }
    if (abschnitt === null) {
      return { ok: false, fehler: `Zeile ${nr}: steht vor dem ersten Abschnitt — die Datei beginnt mit [Interface].` }
    }
    const schluessel = zeile.slice(0, gleich).trim().toLowerCase()
    const wert = zeile.slice(gleich + 1).trim()

    if (VERBOTENE_SCHLUESSEL.has(schluessel)) {
      return {
        ok: false,
        fehler:
          `Zeile ${nr}: „${zeile.slice(0, gleich).trim()}" nimmt die Box nicht an — ` +
          'solche Zeilen führt wg-quick als root aus bzw. sie verstellen die Routen. ' +
          'Eine FRITZ!Box-Exportdatei enthält sie nie.',
      }
    }
    const erlaubt = abschnitt === 'interface' ? INTERFACE_SCHLUESSEL : PEER_SCHLUESSEL
    if (!erlaubt.has(schluessel)) {
      return {
        ok: false,
        fehler: `Zeile ${nr}: „${zeile.slice(0, gleich).trim()}" ist in [${abschnitt === 'interface' ? 'Interface' : 'Peer'}] unbekannt — daran scheiterte auch wg-quick.`,
      }
    }
    zeilen.push({ abschnitt, schluessel, wert, nr })
  }

  if (interfaceAnzahl === 0) return { ok: false, fehler: 'Es fehlt der Abschnitt [Interface].' }
  if (interfaceAnzahl > 1) return { ok: false, fehler: 'Mehr als ein [Interface] — das ist keine Klient-Datei.' }
  if (peerAnzahl === 0) return { ok: false, fehler: 'Es fehlt der Abschnitt [Peer] mit der Gegenstelle.' }
  if (peerAnzahl > 1) {
    return {
      ok: false,
      fehler: 'Mehr als eine Gegenstelle ([Peer]) — dieses Werkzeug verwaltet genau einen Heimweg.',
    }
  }

  const privaterSchluessel = einWert(zeilen, 'interface', 'privatekey')
  if (!privaterSchluessel) return { ok: false, fehler: 'In [Interface] fehlt PrivateKey.' }
  if (!SCHLUESSEL_MUSTER.test(privaterSchluessel)) {
    return { ok: false, fehler: 'PrivateKey hat nicht die Form eines WireGuard-Schlüssels (44 Zeichen base64).' }
  }

  const adressen = werteSammeln(zeilen, 'interface', 'address')
  if (adressen.length === 0) return { ok: false, fehler: 'In [Interface] fehlt Address (die Tunnel-Adresse der Box).' }
  for (const a of adressen) {
    if (!netzForm(a)) return { ok: false, fehler: `Address „${a}" ist keine gültige Adresse.` }
  }

  const mtuRoh = einWert(zeilen, 'interface', 'mtu')
  let mtu: number | null = null
  if (mtuRoh !== null) {
    mtu = Number(mtuRoh)
    if (!Number.isInteger(mtu) || mtu < 576 || mtu > 9200) {
      return { ok: false, fehler: `MTU „${mtuRoh}" ist keine brauchbare Zahl.` }
    }
  }

  const gegenstelle = einWert(zeilen, 'peer', 'publickey')
  if (!gegenstelle)
    return { ok: false, fehler: 'In [Peer] fehlt PublicKey (der öffentliche Schlüssel der Gegenstelle).' }
  if (!SCHLUESSEL_MUSTER.test(gegenstelle)) {
    return { ok: false, fehler: 'PublicKey hat nicht die Form eines WireGuard-Schlüssels (44 Zeichen base64).' }
  }

  const presharedSchluessel = einWert(zeilen, 'peer', 'presharedkey')
  if (presharedSchluessel !== null && !SCHLUESSEL_MUSTER.test(presharedSchluessel)) {
    return { ok: false, fehler: 'PresharedKey hat nicht die Form eines WireGuard-Schlüssels (44 Zeichen base64).' }
  }

  const erlaubteNetze = werteSammeln(zeilen, 'peer', 'allowedips')
  if (erlaubteNetze.length === 0) {
    return { ok: false, fehler: 'In [Peer] fehlt AllowedIPs — ohne das weiß die Box nicht, was durch den Tunnel soll.' }
  }
  for (const n of erlaubteNetze) {
    if (!netzForm(n)) return { ok: false, fehler: `AllowedIPs „${n}" ist kein gültiges Netz.` }
    if (netzIstAlles(n)) {
      return {
        ok: false,
        fehler:
          `Diese Datei schickt ALLES durch den Tunnel (AllowedIPs ${n}) — dann liefe auch Spotify ` +
          'über die Heimleitung, langsamer und ohne Gewinn. Beim Anlegen der Verbindung auf der ' +
          'FRITZ!Box „gesamten Netzwerkverkehr über die VPN-Verbindung senden" ABWÄHLEN und die ' +
          'Datei neu exportieren: dann steht hier nur das Heimnetz.',
      }
    }
  }

  const endpunkt = einWert(zeilen, 'peer', 'endpoint')
  if (!endpunkt)
    return { ok: false, fehler: 'In [Peer] fehlt Endpoint (wo der Heimserver aus dem Internet erreichbar ist).' }
  const endTreffer = ENDPUNKT_MUSTER.exec(endpunkt)
  const port = endTreffer ? Number(endTreffer[1]) : 0
  if (!endTreffer || port < 1 || port > 65535) {
    return { ok: false, fehler: `Endpoint „${endpunkt}" hat nicht die Form name:port.` }
  }

  const hinweise: string[] = []

  const dns = werteSammeln(zeilen, 'interface', 'dns')
  if (dns.length > 0) {
    hinweise.push(
      `DNS-Zeile gestrichen (${dns.join(', ')}): ohne resolvconf bräche wg-quick daran ab, und für den ` +
        'Heimweg wird sie nicht gebraucht. Folge: Namen wie „fritz.box" löst die Box unterwegs nicht auf — ' +
        'Geräte im Heimnetz über ihre Adresse ansprechen.',
    )
  }

  const keepaliveRoh = einWert(zeilen, 'peer', 'persistentkeepalive')
  let keepalive: number
  if (keepaliveRoh === null) {
    keepalive = KEEPALIVE_VORGABE
    hinweise.push(
      `PersistentKeepalive = ${KEEPALIVE_VORGABE} ergänzt: unterwegs sitzt die Box hinter fremdem NAT, ` +
        'ohne Lebenszeichen wäre sie von daheim aus nicht mehr erreichbar.',
    )
  } else {
    keepalive = Number(keepaliveRoh)
    if (!Number.isInteger(keepalive) || keepalive < 0 || keepalive > 65535) {
      return { ok: false, fehler: `PersistentKeepalive „${keepaliveRoh}" ist keine brauchbare Zahl.` }
    }
  }

  return {
    ok: true,
    konfig: {
      privaterSchluessel,
      presharedSchluessel,
      adressen,
      mtu,
      gegenstelle,
      erlaubteNetze,
      endpunkt,
      keepalive,
      hinweise,
    },
  }
}

/**
 * Die geprüfte Konfiguration als wg-quick-Datei. Deterministisch: dieselbe
 * Eingabe ergibt Zeichen für Zeichen dieselbe Datei — nur so lässt sich
 * später sagen, ob auf der Box noch das liegt, was übernommen wurde.
 */
export function konfigSchreiben(k: VpnKonfig): string {
  const zeilen = ['[Interface]', `PrivateKey = ${k.privaterSchluessel}`, `Address = ${k.adressen.join(', ')}`]
  if (k.mtu !== null) zeilen.push(`MTU = ${k.mtu}`)
  zeilen.push('', '[Peer]', `PublicKey = ${k.gegenstelle}`)
  if (k.presharedSchluessel) zeilen.push(`PresharedKey = ${k.presharedSchluessel}`)
  zeilen.push(
    `AllowedIPs = ${k.erlaubteNetze.join(', ')}`,
    `Endpoint = ${k.endpunkt}`,
    `PersistentKeepalive = ${k.keepalive}`,
    '',
  )
  return zeilen.join('\n')
}

/** Was die Oberfläche über die Konfiguration wissen darf — ohne Geheimnisse (E30/W3). */
export interface VpnBeschreibung {
  adressen: string[]
  endpunkt: string
  erlaubteNetze: string[]
  gegenstelle: string
  keepalive: number
  mtu: number | null
  hinweise: string[]
}

export function beschreibung(k: VpnKonfig): VpnBeschreibung {
  return {
    adressen: k.adressen,
    endpunkt: k.endpunkt,
    erlaubteNetze: k.erlaubteNetze,
    gegenstelle: k.gegenstelle,
    keepalive: k.keepalive,
    mtu: k.mtu,
    hinweise: k.hinweise,
  }
}

/** Eine Gegenstelle aus `wg show <name> dump` — nur die öffentlichen Felder. */
export interface TunnelGegenstelle {
  gegenstelle: string
  endpunkt: string | null
  erlaubteNetze: string[]
  /** Sekunden seit 1970, oder null wenn es NIE einen Handschlag gab. */
  handschlagEpochenSek: number | null
  empfangen: number
  gesendet: number
}

/**
 * `wg show <name> dump` lesen.
 *
 * Die erste Zeile trägt an Feld 1 den PRIVATEN Schlüssel, jede Peer-Zeile an
 * Feld 2 den PresharedKey — beide werden hier ÜBERSPRUNGEN und tauchen im
 * Ergebnis nicht auf (E30/W3). Wer diese Funktion ändert, hält das ein.
 */
export function dumpLesen(text: string): TunnelGegenstelle[] {
  const zeilen = (text ?? '')
    .split('\n')
    .map((z) => z.trimEnd())
    .filter((z) => z !== '')
  const raus: TunnelGegenstelle[] = []
  // Zeile 0 ist die Schnittstelle selbst (privater Schlüssel!), danach je
  // Zeile eine Gegenstelle mit 8 Feldern, durch Tab getrennt.
  for (const zeile of zeilen.slice(1)) {
    const f = zeile.split('\t')
    if (f.length < 7) continue
    const handschlag = Number(f[4])
    raus.push({
      gegenstelle: f[0],
      endpunkt: f[2] === '(none)' ? null : f[2],
      erlaubteNetze: f[3] === '(none)' ? [] : f[3].split(',').map((n) => n.trim()),
      handschlagEpochenSek: Number.isFinite(handschlag) && handschlag > 0 ? handschlag : null,
      empfangen: Number(f[5]) || 0,
      gesendet: Number(f[6]) || 0,
    })
  }
  return raus
}

/** Wie alt der letzte Handschlag ist, in Sekunden — oder null, wenn es nie einen gab. */
export function handschlagAlterSek(epochenSek: number | null, jetztMs: number): number | null {
  if (epochenSek === null || !Number.isFinite(epochenSek) || epochenSek <= 0) return null
  return Math.max(0, Math.round(jetztMs / 1000 - epochenSek))
}

/**
 * Ab wann ein Handschlag als abgerissen gilt.
 *
 * WireGuard erneuert ihn unter Last spätestens alle 120 s (REKEY_AFTER_TIME),
 * und der Keepalive von 25 s sorgt dafür, dass Last da ist. 180 s = 120 plus
 * Luft für einen verlorenen Versuch. Wer hier „5 Minuten" schreibt, zeigt
 * einen toten Tunnel drei Minuten lang als stehend an.
 */
export const HANDSCHLAG_FRISCH_SEK = 180

/**
 * Das Urteil über den Tunnel, aus dem Handschlag-Alter:
 *   steht  — es gab gerade einen Handschlag, die Leitung trägt.
 *   stand  — es GAB eine Leitung, jetzt ist sie still (Heimnetz nicht
 *            erreichbar, Server aus, Anschluss tot). Die ehrliche Aussage
 *            samt Alter gehört in die Oberfläche.
 *   nie    — seit dem Start dieses Tunnels kam keine Antwort: Endpunkt,
 *            Schlüssel oder Portfreigabe stimmen nicht, oder es gibt
 *            schlicht kein Internet.
 */
export function tunnelUrteil(alterSek: number | null): 'steht' | 'stand' | 'nie' {
  if (alterSek === null) return 'nie'
  return alterSek <= HANDSCHLAG_FRISCH_SEK ? 'steht' : 'stand'
}
