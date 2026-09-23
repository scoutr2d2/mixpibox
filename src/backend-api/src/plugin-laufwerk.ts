/**
 * DAS LAUFWERK — dieser Code laeuft IM WORKER, neben dem fremden Plugin.
 *
 * Er ist die einzige Stelle, an der Plugin-Code und MuPiBox-Code sich denselben
 * Speicher teilen. Alles, was das Plugin je zu sehen bekommt, wird hier gebaut
 * und hereingereicht — es gibt keinen zweiten Weg.
 *
 * WARUM DIE RECHTE ERST HIER ZU TATSACHEN WERDEN: im Hauptprozess waere die
 * Liste aus `plugin.json` eine Bitte. Dort haette das Plugin `fetch`, `fs` und
 * `child_process` ohnehin, weil sie im selben Modulgraphen liegen. Im Worker
 * gilt: was nicht im Kontext steht, hat das Plugin nicht bekommen.
 *
 * EHRLICH DAZUGESAGT — das ist ABSTURZ- UND VERBRAUCHSTRENNUNG, KEINE
 * SICHERHEITSTRENNUNG. Ein Worker teilt die Dateideskriptoren des Prozesses und
 * darf `node:fs` und `node:child_process` selbst importieren; der Kontext ist
 * ein Angebot, kein Kaefig. Was er wirklich leistet, ist gemessen
 * (tools/plugin-ladeweg-probe.mjs): eine Endlosschleife ist nach 302 ms
 * abbrechbar, ein Speicherleck stirbt bei `resourceLimits` statt den Kern zu
 * holen. Echte Sicherheitstrennung braucht `fork` + systemd-Riegel und kostet
 * das 4,2-Fache an Speicher — die Entscheidung steht im Gutachten, nicht hier.
 *
 * KEIN TOP-LEVEL AWAIT IN DIESER DATEI. Gemessen: esbuild bricht den Bau ab
 * ("Top-level await is currently not supported with the cjs output format").
 */

import { parentPort, workerData } from 'node:worker_threads'
import type { Strom } from './stroeme'
import type { Ereignisname, Fund, Inhalt, Manifest, Titel } from './plugin-vertrag'
// MIT AUSDRUECKLICHER ENDUNG: im Test laeuft dieses Laufwerk als Worker
// unter Nodes Type-Stripping, und das loest KEINE endungslosen Importe auf —
// Typ-Importe ueberleben (werden gestrichen), der erste WERT-Import brach.
// esbuild buendelt die Datei fuer den Betrieb ohnehin mit ein.
import { geraetBauen, type Geraet } from './plugin-geraet.ts'

/** Was ein Fremdentwickler schreibt. Alles freiwillig — ein Plugin darf wenig koennen. */
export interface Plugin {
  /** Eine Kennung zu etwas Abspielbarem machen. Der REST nach dem Doppelpunkt kommt an. */
  aufloesen?(rest: string, kontext: Kontext): Promise<Fund> | Fund
  suchen?(begriff: string, kontext: Kontext): Promise<Titel[]> | Titel[]
  /**
   * Ein Werk zu einer GEORDNETEN Folgenliste machen (E78) — das Gegenstueck
   * zu `aufloesen` fuer Sendungen, Alben, Feeds. Der Rest kommt wie bei
   * `aufloesen` an; Wuensche (etwa die Reihenfolge) reisen hinter `#`.
   * Die Liste kommt so zurueck, wie sie gespielt werden soll.
   */
  inhalt?(rest: string, kontext: Kontext): Promise<Inhalt> | Inhalt
  /**
   * Der Songtext zu einem laufenden Stueck (E84/B2). Braucht das Recht
   * `songtext`.
   *
   * DIE DAUER IST TEIL DER FRAGE, nicht schmueckendes Beiwerk: Quellen wie
   * LRCLIB fuehren dieselbe Nummer vielfach (Studio, Single-Edit, Live), alle
   * mit korrekten, aber VERSCHIEDENEN Zeitmarken. Wer nur nach Interpret und
   * Titel sucht und den ersten Treffer nimmt, liefert einen Text, der Wort fuer
   * Wort stimmt und um bis zu zweieinhalb Minuten versetzt laeuft.
   *
   * EINE LEERE LISTE IST DIE RICHTIGE ANTWORT, wenn nichts sicher passt — fuer
   * Hoerspiele findet sich ohnehin nichts. Wirf nur, wenn du die Frage wirklich
   * nicht beantworten konntest; „kenne ich nicht" ist keine Ausnahme.
   */
  songtext?(
    frage: { interpret: string; titel: string; dauerSek: number },
    kontext: Kontext,
  ): Promise<{ zeilen: { zeitMs: number; text: string }[] }> | { zeilen: { zeitMs: number; text: string }[] }
  befinden?(kontext: Kontext): Promise<{ ok: boolean; text?: string }> | { ok: boolean; text?: string }
  ereignis?(name: Ereignisname, nutzlast: unknown, kontext: Kontext): Promise<void> | void
  /**
   * Die Filterkette, die dieses Plugin in den Signalweg haengen will.
   *
   * Braucht das Recht `klang`. Herauskommen darf nur, was klangkette.ts
   * kennt — der Kern prueft es, bevor daraus eine Datei wird, und BAUT BEI
   * EINEM MANGEL NICHTS: eine krumme Kette laedt nicht, und dann fehlte die
   * Senke, auf die der Ton schon geroutet ist (am Entwicklerrechner gemessen,
   * 21.08.2026 — PipeWire bricht ab, die Senke erscheint gar nicht erst).
   *
   * WIRD BEIM START UND NACH JEDER EINSTELLUNGSAENDERUNG EINMAL GEFRAGT, nicht
   * je Puffer — dies beschreibt die Kette, es rechnet sie nicht.
   */
  klangkette?(kontext: Kontext): Promise<unknown> | unknown
  /**
   * Ein Handgriff aus der Verwaltung (E77) — einer der im Manifest unter
   * `aktionen` angemeldeten Knoepfe wurde gedrueckt.
   *
   * NUR ANGEMELDETE KENNUNGEN KOMMEN AN: der Wirt prueft gegen das Manifest,
   * bevor er ruft. Die Antwort ist dieselbe Form wie bei `befinden` — ok und
   * ein Satz, der woertlich in der Verwaltung steht. Eine Aktion, die lange
   * arbeitet, muss trotzdem in der Ruf-Frist antworten; wer mehr Zeit
   * braucht, stoesst an und meldet den Ausgang ueber `befinden`.
   */
  aktion?(kennung: string, kontext: Kontext): Promise<{ ok: boolean; text?: string }> | { ok: boolean; text?: string }
  /**
   * Eine eigene HTTP-Flaeche (E77): die Verwaltung ruft
   * `/api/plugins/<kennung>/http/<pfad>`, und der Rest hinter `/http/` kommt
   * hier an — samt Abfrage und JSON-Rumpf.
   *
   * NUR JSON HINEIN UND HINAUS: die Antwort laeuft durch den Briefweg des
   * Workers (structuredClone/JSON), Streams und Buffer gibt es auf diesem Weg
   * nicht. Der Wirt prueft Status (200-499) und deckelt die Groesse — was
   * darueber liegt, ist ein Fehler des Plugins, kein Transportfall.
   *
   * DIE ROUTEN LIEGEN HINTER DEM TOR der Verwaltung, wie `befinden` und die
   * Einstellungen. Eine Flaeche fuer den KINDERSCHIRM ist damit bewusst
   * nicht zu bauen — der einzige Weg zum Abspielen bleibt spielweg.ts.
   */
  http?(anfrage: PluginAnfrage, kontext: Kontext): Promise<PluginAntwort> | PluginAntwort
}

/** Was bei einer Plugin-Route ankommt. */
export interface PluginAnfrage {
  methode: 'GET' | 'POST'
  /** Der Rest hinter `/http/`, ohne fuehrenden Schraegstrich. */
  pfad: string
  abfrage: Record<string, string>
  /** Der JSON-Rumpf bei POST, sonst null. */
  rumpf: unknown
}

/** Was eine Plugin-Route zurueckgibt. `status` fehlt = 200. */
export interface PluginAntwort {
  status?: number
  inhalt: unknown
}

export interface Kontext {
  /** Landet im Journal der Box, mit der Plugin-Kennung davor. */
  protokoll(text: string): void
  /** Was die Eltern im Admin-Bereich eingestellt haben. Eingefroren. */
  einstellungen: Readonly<Record<string, unknown>>
  /** Nur mit Recht `netz`. Mit Frist, und nicht auf die eigene Box. */
  holen?(adresse: string, gaben?: RequestInit): Promise<Response>
  /**
   * Die Stroeme der Box — NUR mit Recht `aufnahme`, und MIT den Zugaengen.
   *
   * ══ WARUM DER SCHLUESSEL HIER STEHT UND NICHT UEBER HTTP KOMMT ═══════════
   *
   * `GET /api/stroeme` gibt den Zugang bewusst NIE heraus: dort holt ihn die
   * Browser-Verwaltung, und was man nicht auslesen kann, landet auch nicht
   * versehentlich in einem Protokoll. Ein Plugin, das aufnehmen soll, braucht
   * ihn aber — `soloist -k …` geht ohne nicht.
   *
   * Zwei Entscheidungen, die sich sonst widersprechen, vertragen sich hier:
   * die Route bleibt verschlossen, und der Weg zum Plugin fuehrt ueber das
   * RECHT, das genau dafuer da ist. Wer `aufnahme` im Manifest stehen hat,
   * bekommt, was das Aufnehmen braucht — wer nicht, sieht das Feld gar nicht.
   *
   * DIE EHRLICHE EINORDNUNG: Der Schluessel steht auf dieser Box ohnehin in
   * `ps` (bekannte Grenze, siehe soloist-start.sh). Dieser Weg vergroessert
   * die Angriffsflaeche nicht, er macht den vorhandenen nur benutzbar.
   */
  stroeme?: readonly Strom[]
  /**
   * Die angemeldeten Kern-Konfigurationsgruppen (E80) — nur was das Manifest
   * unter `konfig` nennt, und eingefroren. Aendert die Verwaltung die Werte,
   * startet der Wirt das Plugin neu; ein Plugin liest hier also immer den
   * Stand, mit dem es gestartet wurde.
   */
  konfig?: Readonly<Record<string, unknown>>
  /**
   * Benannte, lesende Blicke auf den Geraetezustand — NUR mit Recht
   * `geraetestand` (E82). Rezepte und Fristen wohnen in plugin-geraet.ts:
   * geschlossene Listen, 2,5 s je Blick, gedeutete Worte statt Exit-Codes.
   */
  geraet?: Geraet
  /**
   * Ein Ordner, der diesem Plugin allein gehoert — fuer seinen Zustand.
   *
   * ES IST KEINE BEFUGNIS, sondern eine Vereinbarung: Plugins haben ohnehin
   * Dateizugriff. Der Sinn ist, dass es EINEN Ort gibt, den das Sicherungsnetz
   * kennt. Wer stattdessen irgendwohin schreibt, hat eine Datei angelegt, die
   * beim naechsten Kartenschaden weg ist (E65).
   *
   * FEHLT ER, gibt es keinen — dann muss das Plugin ohne Zustand auskommen und
   * sollte das sagen, statt sich einen Pfad auszudenken.
   */
  datenOrdner?: string
}

const brief = parentPort
const { manifest, ordner, datenOrdner, stroeme, kernKonfig, einstellungen, fristMs, eigeneAdressen } = (workerData ??
  {}) as {
  manifest: Manifest
  ordner: string
  datenOrdner: string
  stroeme: Strom[]
  kernKonfig: Record<string, unknown>
  einstellungen: Record<string, unknown>
  fristMs: number
  eigeneAdressen: string[]
}

/**
 * Der Riegel gegen den kurzen Weg.
 *
 * Ein Medien-Plugin braucht das Netz — aber nicht ZUR EIGENEN BOX. Ohne diesen
 * Riegel waere `holen('http://127.0.0.1:5005/spotify/now/…')` ein Abspielbefehl
 * an der Kinderzeit vorbei, und `holen('http://192.168.1.50:5005/…')` genauso:
 * der Abspieldienst hoert heute auf ALLEN Schnittstellen (gemessen:
 * `server.listen(config.server.port)` ohne Host-Angabe).
 *
 * DAS IST EIN ZAUN, KEINE MAUER. Wer die eigene Adresse ueber einen DNS-Namen
 * erreicht, der erst beim Verbinden aufgeloest wird, kommt daran vorbei. Die
 * belastbare Zusage ist eine andere und liegt woanders: das Plugin hat KEIN
 * `spielen` im Kontext, und die einzige Tuer (spielweg.ts) fragt die Kinderzeit,
 * bevor sie etwas startet. Dieser Zaun spart nur den bequemen Irrweg.
 */
function adresseErlaubt(adresse: string): { ok: true } | { ok: false; grund: string } {
  let u: URL
  try {
    u = new URL(adresse)
  } catch {
    return { ok: false, grund: `"${adresse}" ist keine gueltige Adresse` }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, grund: `nur http und https, nicht "${u.protocol}"` }
  }
  const wirt = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (wirt === 'localhost' || wirt === '::1' || wirt.startsWith('127.')) {
    return { ok: false, grund: 'die eigene Box ist kein Ziel fuer Plugins' }
  }
  if (eigeneAdressen.includes(wirt)) {
    return { ok: false, grund: `${wirt} ist die Box selbst` }
  }
  return { ok: true }
}

function kontextBauen(): Kontext {
  const k: Kontext = {
    protokoll: (text: string) => brief?.postMessage({ art: 'protokoll', text: String(text) }),
    einstellungen: Object.freeze({ ...einstellungen }),
  }
  // NUR WENN ES IHN WIRKLICH GIBT. Ein leerer Pfad im Kontext saehe aus wie
  // einer und waere keiner — das Plugin soll `if (!kontext.datenOrdner)`
  // fragen koennen.
  if (datenOrdner) k.datenOrdner = datenOrdner
  // NUR WAS IM MANIFEST STEHT. Ohne `netz` gibt es kein `holen` — nicht ein
  // `holen`, das wirft, sondern gar keins. Ein Plugin kann `if (!kontext.holen)`
  // fragen und eine verstaendliche Meldung geben, statt an einem Fehler zu
  // zerschellen, den sein Autor nie provoziert hat.
  // NUR MIT `aufnahme`, und nur wenn es wirklich welche gibt. Ein leeres Feld
  // saehe aus wie eine Auskunft und waere keine — dasselbe Argument wie beim
  // Datenordner darueber.
  if (manifest.rechte.includes('aufnahme') && Array.isArray(stroeme) && stroeme.length > 0) {
    k.stroeme = Object.freeze(stroeme.map((s) => Object.freeze({ ...s })))
  }
  // NUR DIE ANGEMELDETEN GRUPPEN (E80), und nur wenn wirklich etwas da ist —
  // der Wirt hat schon nach dem Manifest gefiltert, hier wird nur noch
  // eingefroren. Dasselbe Muster wie `stroeme` eine Zeile drueber.
  if (Array.isArray(manifest.konfig) && manifest.konfig.length > 0 && kernKonfig && Object.keys(kernKonfig).length > 0) {
    k.konfig = Object.freeze(JSON.parse(JSON.stringify(kernKonfig)))
  }

  // NUR MIT `geraetestand` (E82) — dasselbe Muster wie `holen`: ohne Recht
  // gibt es das Feld gar nicht, und ein Plugin fragt `if (!kontext.geraet)`.
  if (manifest.rechte.includes('geraetestand')) {
    k.geraet = geraetBauen()
  }

  if (manifest.rechte.includes('netz')) {
    k.holen = async (adresse: string, gaben?: RequestInit) => {
      const urteil = adresseErlaubt(adresse)
      if (!urteil.ok) throw new Error(`Plugin ${manifest.kennung}: ${urteil.grund}`)
      // DIE FRIST GEHOERT HIERHER, NICHT IN DIE HOEFLICHKEIT DES PLUGINS.
      // zeitschranke.ts hat auf dieser Box 134,8 s an einer toten Route
      // gemessen (tcp_syn_retries=6). Ein Plugin, das das nicht weiss, haengt
      // sonst genau so lange — und mit ihm der Aufruf, der auf ihn wartet.
      return fetch(adresse, { ...gaben, signal: AbortSignal.timeout(fristMs) })
    }
  }
  return k
}

/**
 * Ein Fehler in ZWEI Teilen — und das ist keine Kosmetik.
 *
 * AM GERAET AUFGEFALLEN (14.08.2026, erster Lauf auf der Box): die Antwort auf
 * `POST /api/plugins/spielen` trug den vollen Stapel nach draussen, mitsamt
 * `/home/dietpi/.mupibox/Sonos-Kids-Controller-master/plugin-laufwerk.js:1:1172`
 * und dem Pfad des Plugins. Ein Aufrufer bekommt damit den Aufbau der Box zu
 * lesen, und die eigentliche Meldung — „die eigene Box ist kein Ziel fuer
 * Plugins" — ersaeuft in sechs Zeilen Rauschen.
 *
 * `meldung` geht nach draussen, `spur` ins Journal. Kein Test hat das gefunden,
 * weil jeder Test auf die MELDUNG prueft und der Stapel dort nur mitlief.
 */
function kurz(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function spurVon(e: unknown): string {
  if (e instanceof Error) return e.stack || e.message
  return String(e)
}

async function starten(): Promise<void> {
  const kontext = kontextBauen()
  const einstieg = `${ordner}/${manifest.haupt}`

  // `await import()` STEHT HIER IN EINER async-FUNKTION, nicht auf oberster
  // Ebene — sonst baut backend-api nicht mehr (gemessen).
  const modul = await import(einstieg)
  const plugin: Plugin = modul.default ?? modul

  brief?.postMessage({
    art: 'bereit',
    kann: {
      aufloesen: typeof plugin.aufloesen === 'function',
      suchen: typeof plugin.suchen === 'function',
      befinden: typeof plugin.befinden === 'function',
      inhalt: typeof plugin.inhalt === 'function',
      ereignis: typeof plugin.ereignis === 'function',
      klangkette: typeof plugin.klangkette === 'function',
      aktion: typeof plugin.aktion === 'function',
      http: typeof plugin.http === 'function',
      songtext: typeof plugin.songtext === 'function',
    },
  })

  brief?.on('message', (nachricht: { art: string; nr: number; verb: string; arg: unknown; name?: Ereignisname }) => {
    if (nachricht.art !== 'ruf') return
    const { nr, verb, arg } = nachricht

    // JEDER RUF LAEUFT DURCH DIESELBE HUELLE. Ein Plugin, das synchron wirft,
    // und eines, das ein abgelehntes Versprechen liefert, muessen hier
    // ununterscheidbar ankommen — sonst wird aus dem einen eine saubere
    // Fehlerantwort und aus dem anderen eine `unhandledRejection`, die den
    // Worker beendet.
    void (async () => {
      try {
        let wert: unknown
        switch (verb) {
          case 'aufloesen':
            if (!plugin.aufloesen) throw new Error(`${manifest.kennung} kann nicht aufloesen`)
            wert = await plugin.aufloesen(String(arg), kontext)
            break
          case 'suchen':
            if (!plugin.suchen) throw new Error(`${manifest.kennung} kann nicht suchen`)
            wert = await plugin.suchen(String(arg), kontext)
            break
          case 'inhalt':
            if (!plugin.inhalt) throw new Error(`${manifest.kennung} kann keinen inhalt liefern`)
            wert = await plugin.inhalt(String(arg), kontext)
            break
          case 'songtext':
            if (!plugin.songtext) throw new Error(`${manifest.kennung} kann keinen songtext liefern`)
            // Das ARGUMENT ist hier ein Objekt, kein String — Interpret, Titel
            // UND Dauer. Die Dauer ist nicht schmueckendes Beiwerk: ohne sie
            // laesst sich nicht sagen, WELCHE Fassung eines Stuecks gemeint
            // ist, und die falsche liefert einen zeitlich versetzten Text
            // (llmwiki `lrclib-fuehrt-dieselbe-nummer-vielfach`).
            wert = await plugin.songtext(arg as { interpret: string; titel: string; dauerSek: number }, kontext)
            break
          case 'befinden':
            wert = plugin.befinden ? await plugin.befinden(kontext) : { ok: true, text: 'ohne eigene Auskunft' }
            break
          case 'ereignis':
            if (plugin.ereignis) await plugin.ereignis(nachricht.name as Ereignisname, arg, kontext)
            wert = null
            break
          case 'klangkette': {
            // KEIN Wurf, wenn das Plugin nichts anzubieten hat: der Server
            // fragt jedes Plugin mit dem Recht, und „ich haenge nichts ein"
            // ist eine gueltige Antwort — kein Fehler, der ins Journal muss.
            //
            // ══ DIE VORSCHAU: EINSTELLUNGEN FUER EINEN RUF UEBERSCHREIBEN ══
            // Betreiber, 21.08.2026: Regler „am besten live zum hören".
            //
            // Das ging nicht, solange jede Aenderung ueber
            // `einstellungenSetzen` lief — das startet das Plugin NEU, der
            // Ton setzt aus, und zum Einstellen nach Gehoer taugt es nicht.
            // Kommt hier eine Ueberschreibung an, bekommt das Plugin sie
            // AUFGESETZT auf seine eingefrorenen Einstellungen — nur fuer
            // diesen einen Ruf.
            //
            // DER EINGEFRORENE ZUSTAND BLEIBT UNBERUEHRT: es wird ein NEUES
            // Kontextobjekt gebaut, `kontext.einstellungen` selbst nie
            // angefasst. Ein Plugin, das sich die Vorschau merkt, merkt sich
            // etwas Vorlaeufiges — das ist seine Sache; dauerhaft wird ein
            // Wert erst durch `einstellungenSetzen`.
            const ueber = arg && typeof arg === 'object' ? (arg as Record<string, unknown>) : null
            const k = ueber
              ? { ...kontext, einstellungen: Object.freeze({ ...kontext.einstellungen, ...ueber }) }
              : kontext
            wert = plugin.klangkette ? await plugin.klangkette(k) : []
            break
          }
          case 'aktion':
            // Die Kennung ist vom WIRT gegen das Manifest geprueft — hier
            // kommt nur an, was angemeldet war. Ohne Methode ist die ehrliche
            // Antwort ein Nein, kein Wurf: der Knopf stand ja in der
            // Verwaltung, weil das Manifest ihn nannte.
            wert = plugin.aktion
              ? await plugin.aktion(String(arg), kontext)
              : { ok: false, text: 'Das Plugin meldet Aktionen an, hat aber keine aktion()-Methode.' }
            break
          case 'http':
            wert = plugin.http
              ? await plugin.http(arg as PluginAnfrage, kontext)
              : { status: 404, inhalt: { fehler: 'keine http()-Methode' } }
            break
          default:
            throw new Error(`unbekannter Ruf "${verb}"`)
        }
        // structuredClone kann keine Funktionen — was ein Plugin an Methoden
        // mitschickt, faellt hier heraus statt den Briefweg zu sprengen.
        brief?.postMessage({ art: 'antwort', nr, wert: JSON.parse(JSON.stringify(wert ?? null)) })
      } catch (e) {
        brief?.postMessage({ art: 'fehler', nr, meldung: kurz(e), spur: spurVon(e) })
      }
    })()
  })
}

// Scheitert schon das Laden, ist das eine Nachricht und kein stiller Tod: der
// Wirt soll den Grund ins Journal schreiben koennen ("Datei fehlt", "Syntax").
starten().catch((e) => {
  brief?.postMessage({ art: 'ladefehler', meldung: kurz(e), spur: spurVon(e) })
  process.exit(1)
})
