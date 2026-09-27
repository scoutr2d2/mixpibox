/**
 * Der Weiterreicher fuer Jellyfin-Toene — die Regeln, ohne Netz und ohne Server.
 *
 * WOZU (BACKLOG E15/S2): Eine Jellyfin-Stromadresse traegt den Zugangsschluessel
 * als `api_key=` in der Abfrage mit sich. Wer sie in den Browser gibt, gibt den
 * Schluessel in den Verlauf, in jedes Bildschirmfoto und in jedes Protokoll auf
 * dem Weg. Fuer COVER ist das laengst geloest (`/api/bild/:schluessel` holt das
 * Bild selbst und schickt den Zugang als Kopfzeile); fuer den TON fehlte es.
 *
 * WARUM DIE REGELN HIER STEHEN UND NICHT IM SERVER: Alles, was hier liegt,
 * laesst sich ohne laufende Box pruefen — und genau diese Stelle entscheidet
 * ueber Sicherheit (welche Kennung darf durch?) und ueber Hoerbarkeit (kommt
 * ein Sprung im Titel an?). Beides im Serverkoerper waere nur am lebenden
 * Geraet pruefbar, also ausgerechnet dort nicht, wo es weh tut.
 */

/** Ein Jellyfin-Item traegt eine 32-stellige Kennung aus Hexadezimalziffern. */
const KENNUNG = /^[0-9a-fA-F]{32}$/

/**
 * Ist das eine Jellyfin-Kennung, die durchgereicht werden darf?
 *
 * ENG MIT ABSICHT. Der Weiterreicher haengt an EINEM Server, den die Box
 * kennt — aber der Pfad kommt aus dem Netz. Ohne diese Schranke koennte ein
 * `../../System/Configuration` daraus einen Weg machen, mit dem Schluessel der
 * Box beliebige Jellyfin-Wege zu erreichen. Die Kennungsform ist die billigste
 * Schranke, die es gibt, und sie ist genau: Jellyfin vergibt GUIDs ohne
 * Bindestriche.
 *
 * Mit Bindestrichen (die kanonische GUID-Schreibweise) wird ABGELEHNT, nicht
 * umgeschrieben — die Box speichert sie nirgends so, und ein Weg, der zwei
 * Formen kennt, hat zwei Formen zu pruefen.
 */
export function kennungErlaubt(kennung: string): boolean {
  return KENNUNG.test(String(kennung ?? ''))
}

/**
 * Die Adresse, die die BOX bei Jellyfin holt — OHNE `api_key`.
 *
 * `static=true` heisst DIRECT PLAY: der Server liefert die Originaldatei mit
 * echter Laenge, statt sie umzurechnen. Ohne das meldet mpv eine falsche Laenge
 * (am Geraet erprobt, jellyfin.ts:155) — und ohne echte Laenge gibt es kein
 * „endet um" und keinen Sprung an eine Stelle.
 *
 * Der Zugang geht als Kopfzeile mit (`X-Emby-Token`), nicht in der Adresse:
 * dann steht er auch im Protokoll des Jellyfin-Servers nicht.
 */
export function stromAdresse(server: string, kennung: string): string {
  return `${String(server).replace(/\/+$/, '')}/Audio/${encodeURIComponent(kennung)}/stream?static=true`
}

/**
 * Welche Kopfzeilen der ANFRAGE weitergereicht werden.
 *
 * NUR `range`, und das ist der Punkt: mpv holt eine Datei nicht am Stueck,
 * sondern springt darin — Fortsetzen an der gemerkten Stelle, Vorspulen,
 * die Laenge am Ende der Datei lesen. Ein Weiterreicher, der `Range`
 * verschluckt, liefert immer von vorn; die Box spielt dann, kann aber nicht
 * mehr springen, und ausgerechnet das MERKEN DER POSITION waere still kaputt.
 *
 * Alles andere bleibt draussen: `Authorization` und `Cookie` der Anfrage haben
 * bei Jellyfin nichts verloren (der Zugang der Box wird eigens gesetzt), und
 * `Accept-Encoding` wuerde eine zweite Kodierung ueber eine schon komprimierte
 * Tondatei legen.
 */
export function anfrageKopfzeilen(kopf: Record<string, unknown>): Record<string, string> {
  const raus: Record<string, string> = {}
  const bereich = kopf?.range ?? kopf?.Range
  if (typeof bereich === 'string' && bereich.trim()) raus.Range = bereich.trim()
  return raus
}

/**
 * Welche Kopfzeilen der ANTWORT zurueckgehen.
 *
 * `content-length` und `accept-ranges` sind nicht Zierde, sondern die
 * Voraussetzung dafuer, dass mpv die Laenge kennt und springen darf;
 * `content-range` traegt die Antwort auf einen Sprung. Ohne sie sieht ein
 * Titel aus wie ein endloser Datenstrom — genau der Zustand, den `static=true`
 * vermeiden soll.
 *
 * NICHT DURCHGEREICHT wird alles, was den Jellyfin-Server verraet
 * (`server`, `x-powered-by`) oder eine Sitzung setzen wuerde (`set-cookie`).
 */
const ANTWORT_ERLAUBT = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
] as const

export function antwortKopfzeilen(lies: (name: string) => string | null): Record<string, string> {
  const raus: Record<string, string> = {}
  for (const name of ANTWORT_ERLAUBT) {
    const wert = lies(name)
    if (typeof wert === 'string' && wert !== '') raus[name] = wert
  }
  return raus
}

/**
 * Traegt diese Adresse einen Jellyfin-Zugangsschluessel?
 *
 * Gebraucht an zwei Stellen: um eine gespeicherte Adresse durch den
 * Weiterreicher zu ersetzen, und um zu PRUEFEN, dass keine mehr hinausgeht.
 * Beide Male dieselbe Frage — also dieselbe Antwort.
 *
 * NOCH KEIN AUFRUFER AUSSER DEM TEST — siehe `ueberDieBox` unten.
 */
export function traegtSchluessel(adresse: string): boolean {
  return /[?&](api_key|ApiKey|X-Emby-Token)=/.test(String(adresse ?? ''))
}

/**
 * Die Kennung aus einer gespeicherten Jellyfin-Stromadresse.
 *
 * Form: `<server>/Audio/<kennung>/stream?...`. Gibt null, wenn es keine
 * Stromadresse ist — dann bleibt die Adresse, wie sie war, statt in eine
 * kaputte umgeschrieben zu werden.
 */
export function kennungAusStrom(adresse: string): string | null {
  const treffer = /\/Audio\/([^/?#]+)\/(?:stream|universal)/.exec(String(adresse ?? ''))
  if (!treffer) return null
  const kennung = decodeURIComponent(treffer[1])
  return kennungErlaubt(kennung) ? kennung : null
}

/**
 * Eine gespeicherte Stromadresse in den Weg ueber die Box uebersetzen.
 *
 * SCHLAEGT SIE FEHL, BLEIBT DIE ALTE ADRESSE STEHEN. Das ist bewusst: ein
 * Titel, der weiterspielt und dabei den Schluessel mitschleppt, ist besser als
 * einer, der schweigt. Was noch durchrutscht, meldet
 * `tools/zugangsschluessel-messen.py` — die Luecke wird also nicht still.
 *
 * ACHTUNG, DAMIT ES NICHT WIE EINE GETRAGENE REGEL AUSSIEHT: Diese Funktion
 * und `traegtSchluessel` ruft im ganzen Baum bis heute NIEMAND ausser ihrem
 * eigenen Test — geprueft am 04.08.2026 mit dem Handgriff aus
 * [[funktion-die-nur-ihr-eigener-test-benutzt]] (`grep -rn … | grep -v spec`).
 * Sie warten auf die ZWEITE HAELFTE von BACKLOG E15/S2: die Abspielbefehle
 * (`jfBefehle` in server.ts fuer die neue Oberflaeche, `media-provider.ts` /
 * `player.service.ts` fuer die klassische) gehen weiterhin unmittelbar an
 * Jellyfin, mit `api_key` in der Adresse. Bis dahin gilt: wer die Regel hier
 * aendert, aendert NICHTS am laufenden Verhalten.
 */
export function ueberDieBox(adresse: string): string {
  const kennung = kennungAusStrom(adresse)
  if (!kennung) return adresse
  return `/api/jellyfin/strom/${kennung}`
}
