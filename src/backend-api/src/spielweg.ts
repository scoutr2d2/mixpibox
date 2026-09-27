/**
 * SPIELWEG — die einzige Tuer, durch die ein Plugin Ton erzeugen kann.
 *
 * WARUM ES SIE GIBT. Die Kinderzeit haengt heute an einem URL-MUSTER:
 * `istStartbefehl` in kinderzeit.ts ist eine ERLAUBNISLISTE, und geprueft wird
 * sie in `app.use('/player', …)`. Das hat zwei Loecher, beide gemessen
 * (tools/plugin-ladeweg-probe.mjs):
 *
 *   1. Ein Schema, das niemand in die Regex eintraegt, ist kein Startbefehl.
 *      `/deezer/67890` laeuft heute ungeprueft durch. Bei EINEM neuen
 *      Kerndienst je Quartal faellt das auf — bei Fremdplugins nicht, denn ein
 *      Plugin-Autor kann diese Zeile gar nicht aendern.
 *   2. Schlimmer, weil strukturell: die Pruefung haengt an `/player`. Eine
 *      Route unter `/api/plugins/<kennung>/…` kommt dort NIE vorbei, egal wie
 *      die Erlaubnisliste aussieht.
 *
 * Deshalb wird die Frage umgedreht. Nicht „sieht dieser Pfad nach einem Start
 * aus?", sondern: DIESE FUNKTION IST DER START, und sie fragt zuerst.
 *
 * WAS HIER (NOCH) NICHT PASSIERT: die bestehenden Kern-Startpfade — Spotify,
 * Jellyfin, Radio, RSS, ARD — laufen unveraendert ueber den `/player`-Proxy und
 * seine Erlaubnisliste. Sie hier nachzuziehen heisst, 181 Routen in 14.633
 * Zeilen server.ts anzufassen, und das ist ein eigener Block. Fuer den Kern
 * bleibt die Erlaubnisliste damit vorerst das erste Netz; fuer PLUGINS ist
 * diese Tuer das einzige. Kein Plugin bekommt einen Weg am Kern vorbei, weil
 * kein Plugin `spielen` im Kontext hat (siehe plugin-laufwerk.ts).
 *
 * ALLES KOMMT HEREIN. Keine Uhr, kein Netz, kein Modulzustand — dieselbe
 * Bauart wie kinderzeit.ts, und aus demselben Grund: eine Tuer, die erst um
 * 19:31 falsch entscheidet, findet man sonst nie.
 */

import type { Fund, Titel } from './plugin-vertrag'
import { kennungZerlegen } from './plugin-vertrag'

/** Das Urteil der Kinderzeit, so viel davon wie diese Datei braucht. */
export interface ZeitUrteil {
  erlaubt: boolean
  grund: string
  restMin: number | null
  fensterBis: string
  fensterAb: string
}

export interface Spielwunsch {
  /** Was gespielt werden soll: "mupibox-podcast:https://…/feed.xml". */
  medienKennung: string
  /**
   * Anhaengen zaehlt AUCH als Start.
   *
   * Der Grund steht in kinderzeit.ts bei `ardqueue`: eine Sendung wird wie ein
   * Album gespielt (erste Folge starten, Rest anhaengen), und ein Anhaengen,
   * das die Grenze nicht kennt, fuellt die Warteschlange nach Feierabend
   * weiter auf. Wer hier `anhaengen` durchwinkt, baut die Luecke nach.
   */
  art: 'start' | 'anhaengen'
}

export type SpielErgebnis =
  | { art: 'gespielt'; titel: Titel }
  | { art: 'abgewiesen'; urteil: ZeitUrteil }
  | { art: 'gescheitert'; grund: string }

/**
 * Was die Tuer von aussen braucht. Hereingereicht, damit sie pruefbar bleibt.
 */
export interface Werkzeuge {
  /** Die Kinderzeit fragen — dieselbe Funktion, die auch der Takt benutzt. */
  zeitStand(): ZeitUrteil
  /** Ist ein Plugin dieser Kennung da und kann es aufloesen? */
  kannAufloesen(kennung: string): boolean
  /** Das Plugin fragen. Wirft, wenn es nichts Brauchbares liefert. */
  aufloesen(kennung: string, rest: string): Promise<Fund>
  /** Den Fund an den Abspieldienst geben. NUR VON HIER AUS AUFZURUFEN. */
  anDenSpieler(fund: Fund, art: 'start' | 'anhaengen'): Promise<void>
  /** Ins Journal. */
  melden(text: string): void
}

export async function spielAnfordern(wunsch: Spielwunsch, w: Werkzeuge): Promise<SpielErgebnis> {
  const zerlegt = kennungZerlegen(wunsch.medienKennung)
  if (!zerlegt) {
    return { art: 'gescheitert', grund: `"${wunsch.medienKennung}" ist keine Plugin-Medienkennung` }
  }
  if (!w.kannAufloesen(zerlegt.kennung)) {
    return { art: 'gescheitert', grund: `kein bereites Plugin "${zerlegt.kennung}"` }
  }

  // ── 1. DIE KINDERZEIT ZUERST ────────────────────────────────────────────
  //
  // VOR dem Aufloesen, nicht danach: das Aufloesen geht ins Netz und darf bis
  // zu 8 s dauern. Ein Kind, dessen Zeit um ist, soll keine Anfrage an einen
  // fremden Dienst ausloesen — und die Absage soll sofort auf dem Schirm
  // stehen, nicht nach acht Sekunden Warten.
  const vorher = w.zeitStand()
  if (!vorher.erlaubt) {
    w.melden(`Kinderzeit weist ab (${zerlegt.kennung}): ${vorher.grund}`)
    return { art: 'abgewiesen', urteil: vorher }
  }

  // ── 2. Erst jetzt das Plugin fragen ─────────────────────────────────────
  let fund: Fund
  try {
    fund = await w.aufloesen(zerlegt.kennung, zerlegt.rest)
  } catch (e) {
    // EIN SCHEITERNDES PLUGIN IST EIN ERGEBNIS, KEIN WURF. Der Aufrufer ist
    // eine Express-Route; ein durchgereichter Fehler waere dort eine 500er
    // Antwort statt einer Meldung, die ein Kind versteht.
    return { art: 'gescheitert', grund: (e as Error).message }
  }

  // ── 3. NOCH EINMAL FRAGEN ───────────────────────────────────────────────
  //
  // Zwischen Schritt 1 und hier liegen bis zu 8 s. Genau in dieser Spanne kann
  // das Zeitfenster zuschlagen (`bis: "19:30"`) oder das Guthaben auf null
  // fallen. Ohne diese zweite Frage begaenne die Wiedergabe NACH dem
  // Zubettgehen, und der Takt haette sie erst bis zu 5 s spaeter wieder
  // abgeraeumt — fuer ein wartendes Kind ist das der Beweis, dass Quengeln
  // hilft.
  const nachher = w.zeitStand()
  if (!nachher.erlaubt) {
    w.melden(`Kinderzeit weist nach dem Aufloesen ab (${zerlegt.kennung}): ${nachher.grund}`)
    return { art: 'abgewiesen', urteil: nachher }
  }

  // ── 4. Und nur von hier aus geht etwas an den Spieler ────────────────────
  try {
    await w.anDenSpieler(fund, wunsch.art)
  } catch (e) {
    return { art: 'gescheitert', grund: `Abspieldienst: ${(e as Error).message}` }
  }
  w.melden(`${zerlegt.kennung} spielt "${fund.titel.name}"`)
  return { art: 'gespielt', titel: fund.titel }
}
