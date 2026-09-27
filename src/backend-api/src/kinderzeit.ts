/**
 * Kinderzeit — wie lange, wann und an welchen Tagen gehoert werden darf.
 *
 * REINE LOGIK: keine Uhr, kein Dateisystem, kein Netz. Alles kommt herein
 * (Regeln, jetziger Zeitpunkt, schon verbrauchte Minuten), heraus kommt ein
 * Urteil. Damit ist die Regel pruefbar, ohne den Tag abzuwarten — und genau
 * das braucht man hier: eine Regel, die erst um 19:31 falsch entscheidet,
 * findet man sonst nie.
 *
 * WARUM SERVERSEITIG: die Anzeige im Browser (zeitanzeige.component.ts) war
 * ein Platzhalter mit localStorage. Ein Kind, das die Seite neu laedt, haette
 * damit sein Guthaben zurueckgesetzt. Gezaehlt und entschieden wird deshalb
 * hier, im Hintergrundstueck, das auch den Abspielbefehl in der Hand hat.
 */
import { kennungPruefen } from './profile'

/** Wochentage in der Reihenfolge von Date.getDay() (0 = Sonntag). */
export const TAGE = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'] as const
export type Tag = (typeof TAGE)[number]

export interface TagesRegel {
  /** Darf ueberhaupt gehoert werden? */
  frei: boolean
  /** Ab wann, als "HH:MM". Leer = keine Untergrenze. */
  ab: string
  /** Bis wann, als "HH:MM". Leer = keine Obergrenze. */
  bis: string
  /** Hoerdauer in Minuten. 0 = unbegrenzt (aber Zeitfenster gilt weiter). */
  minuten: number
}

export interface Regeln {
  /** Ist die Kinderzeit ueberhaupt eingeschaltet? */
  aktiv: boolean
  tage: Record<Tag, TagesRegel>
  /**
   * Nachsicht am Ende: laeuft das Guthaben oder das Fenster ab, darf der
   * LAUFENDE Titel noch zu Ende gespielt werden — bis zu so vielen Minuten.
   *
   * Ein Kind mitten im Lied abzuschneiden ist der sichere Weg zu Traenen und
   * zu dem Verdacht, die Box sei kaputt. 0 schaltet die Nachsicht ab.
   */
  nachsichtMin: number
}

/** Ein Tagesguthaben: verbrauchte und geschenkte Minuten. */
export interface Verbrauch {
  /** Tagesschluessel "JJJJ-MM-TT" — wechselt der Tag, faengt alles von vorn an. */
  tag: string
  /** Bisher gehoerte Sekunden. */
  sekunden: number
  /** Von den Eltern geschenkte Extraminuten fuer HEUTE. */
  bonusMin: number
}

export type Grund =
  | 'aus' // Kinderzeit ist nicht eingeschaltet
  | 'frei' // erlaubt
  | 'tagGesperrt' // an diesem Wochentag gar nicht
  | 'zuFrueh' // vor dem erlaubten Beginn
  | 'zuSpaet' // nach dem erlaubten Ende
  | 'aufgebraucht' // Tagesdauer verbraucht

export interface Urteil {
  /** Darf JETZT gespielt werden? */
  erlaubt: boolean
  grund: Grund
  /** Verbleibende Minuten des Tagesguthabens; null = unbegrenzt. */
  restMin: number | null
  /** Wann das Fenster heute endet ("HH:MM"), oder '' wenn keins gesetzt ist. */
  fensterBis: string
  /** Wann es heute (wieder) losgeht ("HH:MM"), wenn es noch zu frueh ist. */
  fensterAb: string
}

/** "HH:MM" → Minuten seit Mitternacht; null bei Unsinn oder leer. */
export function minutenAusZeit(hhmm: unknown): number | null {
  if (typeof hhmm !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Der Tagesschluessel in ORTSZEIT — nicht UTC, sonst springt er abends um. */
export function tagesSchluessel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Eine leere Tagesregel: erlaubt, ohne Fenster, ohne Begrenzung. */
export function tagFrei(): TagesRegel {
  return { frei: true, ab: '', bis: '', minuten: 0 }
}

/** Vorgabe: Kinderzeit AUS und alles offen — die Box verhaelt sich wie bisher. */
export function regelnVorgabe(): Regeln {
  const tage = {} as Record<Tag, TagesRegel>
  for (const t of TAGE) tage[t] = tagFrei()
  return { aktiv: false, tage, nachsichtMin: 5 }
}

/**
 * Fremde Eingaben in gueltige Regeln verwandeln.
 *
 * Alles, was nicht passt, wird auf die freundliche Seite gebogen (frei, kein
 * Fenster, keine Begrenzung) — eine kaputte Konfigurationsdatei darf ein Kind
 * NICHT aussperren. Der Fehlerfall ist hier bewusst "es laeuft weiter".
 */
export function regelnNormalisieren(roh: unknown): Regeln {
  const r = (roh ?? {}) as Record<string, unknown>
  const aus = regelnVorgabe()
  aus.aktiv = r.aktiv === true
  const n = Number((r as { nachsichtMin?: unknown }).nachsichtMin)
  aus.nachsichtMin = Number.isFinite(n) && n >= 0 ? Math.min(60, Math.floor(n)) : 5
  const tage = (r.tage ?? {}) as Record<string, unknown>
  for (const t of TAGE) {
    const q = (tage[t] ?? {}) as Record<string, unknown>
    const min = Number(q.minuten)
    aus.tage[t] = {
      frei: q.frei !== false,
      ab: minutenAusZeit(q.ab) === null ? '' : String(q.ab).trim(),
      bis: minutenAusZeit(q.bis) === null ? '' : String(q.bis).trim(),
      minuten: Number.isFinite(min) && min > 0 ? Math.min(24 * 60, Math.floor(min)) : 0,
    }
  }
  return aus
}

/**
 * Die Kinderzeit der ganzen Box: EINE Vorgabe und Ausnahmen je Profil.
 *
 * WARUM NICHT EINFACH EINE REGEL JE KIND: Solange niemand ein Profil
 * angelegt hat, gibt es nur den Gast — und der soll GENAU die Regel
 * bekommen, die heute in `kinderzeit.json` steht. Waere die Regel
 * profilgebunden, muesste beim Umstellen geraten werden, wem die bisherige
 * gehoert. Mit `standard` gehoert sie weiter der BOX, und `je` sagt nur, wo
 * jemand abweicht. Ein neues Kind erbt damit automatisch die Hausregel,
 * statt unbegrenzt zu starten.
 */
export interface RegelSatz {
  /** Gilt fuer jeden, der keinen eigenen Eintrag hat — auch fuer den Gast. */
  standard: Regeln
  /** Ausnahmen, Kennung -> Regeln. Leer ist der Normalfall. */
  je: Record<string, Regeln>
}

/** Vorgabe: die Vorgabe-Regel fuer alle, keine Ausnahme. */
export function regelSatzVorgabe(): RegelSatz {
  return { standard: regelnVorgabe(), je: {} }
}

/**
 * Fremde Eingaben in einen gueltigen Regelsatz verwandeln.
 *
 * LIEST BEIDE FORMEN. Bis 08/2026 stand in `kinderzeit.json` ein blankes
 * Regeln-Objekt (`{aktiv, tage, nachsichtMin}`); seither die Form mit
 * `standard` und `je`. Die alte Datei liegt auf jeder Box, die es schon gibt
 * — sie wird nicht gewandelt, sondern gelesen und beim naechsten Schreiben
 * in der neuen Form abgelegt. Erkannt wird an `standard`: nur die neue Form
 * hat es, und die alte kann es nicht versehentlich haben (Regeln kennt kein
 * solches Feld).
 *
 * EINE KENNUNG, DIE KEINE IST, FAELLT HERAUS — sie wird zu einem PFAD
 * (profile/<kennung>/kinderzeit-verbrauch.json), siehe profile.ts.
 */
export function regelSatzNormalisieren(roh: unknown): RegelSatz {
  const r = (roh ?? {}) as Record<string, unknown>
  const neueForm = !!r.standard && typeof r.standard === 'object'
  const standard = regelnNormalisieren(neueForm ? r.standard : r)
  const je: Record<string, Regeln> = {}
  const rohJe = (neueForm ? r.je : null) as Record<string, unknown> | null
  if (rohJe && typeof rohJe === 'object') {
    for (const k of Object.keys(rohJe)) {
      if (!kennungPruefen(k)) continue
      je[k] = regelnNormalisieren(rohJe[k])
    }
  }
  return { standard, je }
}

/** Welche Regeln gelten fuer diese Kennung? Ohne eigenen Eintrag: `standard`. */
export function regelnFuer(satz: RegelSatz, kennung: string): Regeln {
  return satz.je[kennung] ?? satz.standard
}

/** Ein frischer Verbrauch fuer den Tag von `jetzt`. */
export function verbrauchVorgabe(jetzt: Date): Verbrauch {
  return { tag: tagesSchluessel(jetzt), sekunden: 0, bonusMin: 0 }
}

/**
 * Verbrauch auf den heutigen Tag beziehen.
 *
 * Steht ein anderer Tag darin, faengt der Zaehler bei null an — samt Bonus.
 * Geschenkte Minuten gelten fuer HEUTE, nicht fuer immer; sonst haette ein
 * einmaliges Zugestaendnis dauerhaft Bestand.
 */
export function verbrauchFuerHeute(v: unknown, jetzt: Date): Verbrauch {
  const heute = tagesSchluessel(jetzt)
  const q = (v ?? {}) as Record<string, unknown>
  if (q.tag !== heute) return verbrauchVorgabe(jetzt)
  const s = Number(q.sekunden)
  const b = Number(q.bonusMin)
  return {
    tag: heute,
    sekunden: Number.isFinite(s) && s > 0 ? s : 0,
    bonusMin: Number.isFinite(b) && b > 0 ? Math.min(24 * 60, Math.floor(b)) : 0,
  }
}

/**
 * Darf jetzt gespielt werden?
 *
 * Reihenfolge der Pruefung ist Absicht — sie bestimmt, WAS die Box dem Kind
 * sagt. Ein gesperrter Tag ist etwas anderes als "noch zu frueh", und beides
 * ist etwas anderes als "fuer heute aufgebraucht". Wer nur ein "nein"
 * zurueckgibt, kann keine verstaendliche Meldung bauen.
 */
export function pruefen(regeln: Regeln, verbrauch: Verbrauch, jetzt: Date): Urteil {
  if (!regeln.aktiv) {
    return { erlaubt: true, grund: 'aus', restMin: null, fensterBis: '', fensterAb: '' }
  }
  const tag = regeln.tage[TAGE[jetzt.getDay()]] ?? tagFrei()
  const nun = jetzt.getHours() * 60 + jetzt.getMinutes()
  const ab = minutenAusZeit(tag.ab)
  const bis = minutenAusZeit(tag.bis)
  const v = verbrauchFuerHeute(verbrauch, jetzt)
  const erlaubtMin = tag.minuten > 0 ? tag.minuten + v.bonusMin : 0
  const rest = erlaubtMin > 0 ? Math.max(0, erlaubtMin - Math.floor(v.sekunden / 60)) : null
  const lage = { restMin: rest, fensterBis: tag.bis, fensterAb: tag.ab }

  if (!tag.frei) return { erlaubt: false, grund: 'tagGesperrt', ...lage }
  if (ab !== null && nun < ab) return { erlaubt: false, grund: 'zuFrueh', ...lage }
  if (bis !== null && nun >= bis) return { erlaubt: false, grund: 'zuSpaet', ...lage }
  if (rest !== null && rest <= 0) return { erlaubt: false, grund: 'aufgebraucht', ...lage }
  return { erlaubt: true, grund: 'frei', ...lage }
}

/**
 * Soll eine LAUFENDE Wiedergabe abgebrochen werden?
 *
 * Getrennt von `pruefen`, weil es eine andere Frage ist: einen neuen Titel
 * NICHT zu starten ist harmlos, einen laufenden abzuschneiden nicht. Deshalb
 * greift hier die Nachsicht — nach Ablauf darf noch bis `nachsichtMin`
 * weitergespielt werden (das Lied zu Ende), erst danach wird gestoppt.
 *
 * `ueberMin` = wie lange die Grenze schon ueberschritten ist.
 */
export function abbrechen(regeln: Regeln, urteil: Urteil, ueberMin: number): boolean {
  if (!regeln.aktiv || urteil.erlaubt) return false
  // Ein gesperrter Tag oder ein zu frueher Start sind keine Faelle fuer
  // Nachsicht — dort lief ohnehin nichts, was zu Ende gehen koennte.
  if (urteil.grund === 'tagGesperrt' || urteil.grund === 'zuFrueh') return true
  return ueberMin >= regeln.nachsichtMin
}

/**
 * Ist das ein Befehl, der WIEDERGABE STARTET?
 *
 * Nur solche darf die Kinderzeit abweisen. ANHALTEN, Lautstaerke, Zustand
 * abfragen muessen IMMER durchgehen - eine Zeitgrenze, die das Ausschalten
 * verhindert, waere schlimmer als keine. Deshalb steht das Verneinen ZUERST
 * und gewinnt: ein Pfad, der beides enthaelt, gilt als harmlos.
 *
 * Die Befehlsformen stammen aus dem Auffangbereich des Wiedergabedienstes
 * (spotify-control.ts): spotify/now, jellyfin, jfqueue, musicsearch/library,
 * queue, radio, rss, ard, ardqueue.
 *
 * `ard`/`ardqueue` KAMEN AM 04.08.2026 DAZU (BACKLOG E4/A5) — und das ist
 * keine Kosmetik, sondern die Luecke, die ein neuer Dienst hier IMMER
 * aufreisst: Diese Liste ist eine ERLAUBNISLISTE. Ein Verb, das niemand
 * eintraegt, ist kein Startbefehl — und damit spielt der neue Dienst als
 * einziger auch nach dem Zubettgehen weiter, ohne dass irgendwo ein Fehler
 * steht. Wer den naechsten Dienst anbindet, faengt bei dieser Zeile an.
 *
 * `ardqueue` steht mit drin, genau wie `jfqueue`: Eine ARD-Sendung wird wie
 * ein Album gespielt (erste Folge starten, den Rest anhaengen), und ein
 * Anhaengen, das die Grenze nicht kennt, fuellte die Warteschlange nach
 * Feierabend weiter auf.
 */
/**
 * NICHT als Start gilt ausserdem der SPRUNG ZU EINEM TITEL (`tracknr:N`) —
 * und das ist keine Luecke, sondern richtig.
 *
 * Nachgesehen im Abspieldienst (spotify-control.ts, Zweig
 * `command.name.includes('tracknr:')`): Der Befehl rechnet einen RELATIVEN
 * Schritt aus (`target - currentMeta.currentTracknr`) und wirkt nur, wenn
 * gerade mplayer laeuft. Steht nichts, ist `currentPlayer` leer und der Befehl
 * tut GAR NICHTS — er kann also keine Wiedergabe beginnen. Damit gehoert er
 * zu `next` und `previous`: Bewegung INNERHALB dessen, was ohnehin schon
 * laeuft.
 *
 * Der Spotify-Titelsprung ist ein anderer Fall und wird sehr wohl erfasst:
 * er geht ueber `spotify/now/spotify:album:<id>:<nr>:0` und faellt damit
 * unter START (player.service.ts playSpotifyAlbumOffset).
 *
 * Am 2026-07-31 gemessen, weil die Frage aufkam. Sie muss nicht noch einmal
 * gestellt werden.
 */
const NICHT_START =
  /\/(stop|pause|setvolume|seekpos|say|state|local|tracklist|trackcover|getdevices|setdevice|token)(\/|$|\?)/
// `pluginqueue` VOR `plugin` — die Alternation soll das laengere Wort zuerst
// sehen; beide kamen am 31.08.2026 dazu (E87-Nachtrag beim E95-Umbau): der
// /inhalt-Zweig baut `plugin/…`/`pluginqueue/…`, der Abspieldienst fuehrt
// beide Verben, und ein Verb, das hier fehlt, spielt nach dem Zubettgehen
// weiter — lautlos, siehe den Kasten oben.
//
// `dateiqueue`/`datei` (E108, gleiche Ordnung): die Mischliste spielt lokale
// Spuren als Einzeltitel — ein Start wie jeder andere.
const START =
  /\/(spotify\/now|jellyfin|jfqueue|ardqueue|ard|musicsearch|library|pluginqueue|plugin|dateiqueue|datei|queue|radio|rss|play)(\/|$)/

export function istStartbefehl(pfad: unknown): boolean {
  if (typeof pfad !== 'string') return false
  const p = pfad.toLowerCase()
  if (NICHT_START.test(p)) return false
  return START.test(p)
}
