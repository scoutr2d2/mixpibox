/**
 * Die Aufzeichnen-Seite — was der Mitschnitt vorhat, getan hat und warum
 * gerade nichts passiert.
 *
 * Betreiber, 04.09.2026: „ich würde gerne sehen was eingequeued, was
 * aufgezeichnet/geladen wurde und auch neuaufladen anstoßen können wenn ich
 * nicht zufrieden bin. Und auch den fortschritt sehen." Dies ist STUFE 1
 * davon (BACKLOG E126): reines Sichtbarmachen. Neuladen und der Fortschritt
 * des laufenden Titels folgen als Stufe 2 und 3 — beide fassen Dateien bzw.
 * den Arbeiter an und gehören nicht in denselben Wurf wie eine Anzeige.
 *
 * DIESELBE QUELLE WIE DAS PLUGIN SELBST: `GET …/mixpi-mitschnitt/http/liste`
 * (Zusammenfassung + jeder Eintrag mit Stand, Grund, Versuchen) und das
 * `befinden` als gesprochener Satz. Kein eigener Endpunkt, keine zweite
 * Wahrheit — die Seite zeigt, was die Liste weiß, und die Liste ist die
 * Wahrheit des Leerlauf-Arbeiters (plugins/mixpi-mitschnitt/liste.mjs).
 *
 * DIE FERTIGEN SIND GEDECKELT (Anfang: 20). Bei 166 fertigen Einträgen wäre
 * die Seite sonst eine Rolle Papier, an deren Ende die fünf Fehler stehen,
 * wegen derer man gekommen ist. Reihenfolge deshalb: Fehler zuerst, dann
 * die Warteschlange, dann die Erledigten hinter einem Aufklapper.
 *
 * KEINE BACKTICKS in Vorlage und Kommentaren ([[backticks-in-angular-vorlagen]]).
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, type OnDestroy, computed, inject, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'

/** Ein Eintrag, wie ihn `http/liste` liefert — Felder fehlen, wo sie nichts sagen. */
export interface MitschnittEintrag {
  uri: string
  name: string
  interpret: string
  album: string
  stand: 'offen' | 'fertig' | 'fehler' | string
  /** Der Grund, nur wenn es einen gibt („lag schon auf der Platte", Fehlertext). */
  wort?: string
  /** Fehlgeschlagene Anläufe — erscheint ab dem ersten. */
  versuche?: number
  vorrang?: boolean
  /** Nur abseits der Vorgabe „automatisch" (also „hand"). */
  herkunft?: string
  /** Der Interpret der VERÖFFENTLICHUNG — nach ihm wird gruppiert. */
  albumInterpret?: string
}

/** Was der Mitschnitt GERADE aufnimmt — null, wenn nichts läuft (E126/3). */
export interface MitschnittLaufend {
  uri: string
  name: string
  interpret: string
  album?: string
  bild?: string | null
  /** Sollzeit des Titels; `null`, wenn der Dienst sie nicht nennt. */
  dauerMs?: number | null
  /** WELCHER Strom aufnimmt — der Wirt teilt irgendeinen freien zu. */
  stromNr?: number | null
  sekunden: number
}

/** Ein Album mit seinen Titeln — wie die Seite es zeigt (E126, Umbau). */
export interface AlbumGruppe {
  /** Album plus Album-Interpret; der Schlüssel der Gruppierung. */
  kennung: string
  album: string
  interpret: string
  titel: MitschnittEintrag[]
}

/**
 * Einträge zu Alben bündeln — REIN und getestet.
 *
 * NACH DEM ALBUM-INTERPRETEN, NICHT NACH `interpret`: Letzterer sind die
 * Mitwirkenden DES TITELS, Gäste eingeschlossen — nach ihnen gruppiert
 * zerfällt ein Album in mehrere Kacheln. Genau dieser Fehler kostete am
 * 20.08.2026 im Plugin schon einmal doppelte Ordner („warum man 2 mal das
 * gleiche cover sieht"). Fehlt der Album-Interpret, gilt der des Titels.
 *
 * EINZELNE TITEL OHNE ALBUM bleiben einzeln: sie zu einer Gruppe „ohne
 * Album" zusammenzufassen wäre eine Behauptung, die die Daten nicht decken.
 * DIE REIHENFOLGE bleibt die der Liste — die Warteschlange gehört ihr.
 */
export function albenBauen(eintraege: MitschnittEintrag[]): AlbumGruppe[] {
  const raus: AlbumGruppe[] = []
  const nach = new Map<string, AlbumGruppe>()
  for (const e of Array.isArray(eintraege) ? eintraege : []) {
    if (!e || typeof e !== 'object') continue
    const interpret = e.albumInterpret || e.interpret || ''
    const kennung = e.album ? e.album + ' — ' + interpret : 'einzeln:' + e.uri
    const da = nach.get(kennung)
    if (da) {
      da.titel.push(e)
      continue
    }
    const gruppe: AlbumGruppe = { kennung, album: e.album || '', interpret, titel: [e] }
    nach.set(kennung, gruppe)
    raus.push(gruppe)
  }
  return raus
}

/**
 * Der Fortschritt der laufenden Aufnahme in Prozent — oder null.
 *
 * NULL IST EINE ANTWORT: Ohne Solldauer gibt es keinen Fortschritt, nur
 * eine verstrichene Zeit. Einen Balken zu zeigen, der auf einer geratenen
 * Länge steht, wäre schlimmer als keiner.
 *
 * GEDECKELT BEI 100: Die Rohaufnahme läuft weiter, während geschnitten
 * wird — ein Balken, der über den Rand hinauswächst, sieht kaputt aus.
 */
export function fortschrittProzent(l: MitschnittLaufend | null): number | null {
  if (!l || !Number.isFinite(Number(l.dauerMs)) || Number(l.dauerMs) <= 0) return null
  const soll = Number(l.dauerMs) / 1000
  return Math.max(0, Math.min(100, Math.round((Math.max(0, l.sekunden) / soll) * 100)))
}

export interface MitschnittListe {
  zusammenfassung: { offen: number; fertig: number; fehler: number }
  laufend?: MitschnittLaufend | null
  eintraege: MitschnittEintrag[]
}

/** Sekunden als m:ss — für den Fortschritt des laufenden Stücks. */
export function mmss(sekunden: number): string {
  const n = Math.max(0, Math.round(Number(sekunden) || 0))
  const m = Math.floor(n / 60)
  const s = n % 60
  return m + ':' + (s < 10 ? '0' : '') + s
}

/**
 * Die Liste in die drei Anzeige-Gruppen teilen — REIN, damit
 * `aufzeichnen.spec.ts` sie ohne Http und ohne Angular prüfen kann.
 *
 * DIE REIHENFOLGE INNERHALB VON „offen" BLEIBT DIE DER LISTE: sie IST die
 * Warteschlange (liste.mjs `naechster` nimmt von vorn, Vorrang zuerst).
 * Hier zu sortieren hieße, eine zweite Wahrheit über die Abarbeitung zu
 * erfinden — genau die Fehlerklasse aus E110.
 */
export function listeGruppieren(eintraege: MitschnittEintrag[]): {
  offen: MitschnittEintrag[]
  fehler: MitschnittEintrag[]
  fertig: MitschnittEintrag[]
} {
  const offen: MitschnittEintrag[] = []
  const fehler: MitschnittEintrag[] = []
  const fertig: MitschnittEintrag[] = []
  for (const e of Array.isArray(eintraege) ? eintraege : []) {
    if (!e || typeof e !== 'object') continue
    if (e.stand === 'fehler') fehler.push(e)
    else if (e.stand === 'fertig') fertig.push(e)
    // Alles Unbekannte gilt als offen — die Liste normalisiert selbst
    // („laeuft muss sich erholen"), und eine Anzeige, die einen neuen
    // Zustand stumm verschluckt, versteckt genau das Neue.
    else offen.push(e)
  }
  return { offen, fehler, fertig }
}

/** Das Kleingedruckte eines Eintrags: Album, Vorrang, Herkunft, Versuche. */
export function eintragZeile(e: MitschnittEintrag): string {
  const teile: string[] = []
  if (e.album) teile.push(e.album)
  if (e.vorrang) teile.push('Vorrang')
  // 'hand' ist der Name aus HERKUENFTE (liste.mjs) — hier in Klartext.
  if (e.herkunft === 'hand') teile.push('von Hand angefordert')
  else if (e.herkunft) teile.push(e.herkunft)
  if (typeof e.versuche === 'number' && e.versuche > 0) {
    teile.push(e.versuche === 1 ? '1 Fehlversuch' : e.versuche + ' Fehlversuche')
  }
  return teile.join(' · ')
}

/**
 * Die Suche über Titel, Album und Interpret — REIN und geprüft.
 *
 * OHNE SUCHBEGRIFF KOMMT ALLES ZURUECK, unverändert und in der Reihenfolge
 * der Liste. Ein Treffer in EINEM der Felder genügt: wer „Conni" tippt,
 * meint das Album so oft wie den Titel.
 */
export function suchen(eintraege: MitschnittEintrag[], was: string): MitschnittEintrag[] {
  const alle = Array.isArray(eintraege) ? eintraege : []
  const q = String(was || '').trim().toLowerCase()
  if (!q) return alle
  return alle.filter((e) =>
    [e?.name, e?.album, e?.interpret, e?.albumInterpret]
      .map((x) => String(x || '').toLowerCase())
      .some((x) => x.includes(q)),
  )
}

/** Die Felder des Mitschnitts, die diese Seite bedient (plugin.json). */
export interface MitschnittEinstellungen {
  nachtmodus?: boolean
  nachtVon?: string
  nachtBis?: string
  albumKomplett?: boolean
  [feld: string]: unknown
}

/** Ein Werk der Mediathek, so weit die Seite es braucht. */
export interface WerkKurz {
  schluessel: string
  titel: string
  interpret: string
  bild?: string
  quellen?: { dienst?: string }[]
}

/**
 * Für den Vergleich zweier Namen: Kleinschreibung, Sonderzeichen zu
 * Leerzeichen, Mehrfaches zusammen.
 *
 * WEIL DIE MEDIATHEK ANDERS SCHREIBT ALS SPOTIFY: Der Ordnername ersetzt
 * verbotene Zeichen (aus „Folge 12: Fans" wird „Folge 12_ Fans"). Ein
 * exakter Vergleich fand solche Paare nie — am Gerät gemessen (04.09.2026)
 * brachte die Normalisierung 24 auf 26 von 65 Alben. Der Rest steht
 * schlicht NICHT in der Mediathek: 50 Werke gegen 65 aufgenommene Alben.
 * Die Zuordnung war nie das Hauptproblem, aber sie soll auch nicht an
 * einem Unterstrich scheitern.
 */
function namensWort(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Interpreten als WORTMENGE: „Ruby van der Bogen, 101 fabelhafte Freunde"
 *  und „101 fabelhafte Freunde, Ruby van der Bogen" sind dasselbe. */
function interpretMenge(s: unknown): string {
  return namensWort(s).split(' ').sort().join(' ')
}

function schluesselWort(album: string, interpret: string): string {
  return namensWort(album) + '|' + interpretMenge(interpret)
}

/**
 * Welches Werk der Mediathek gehört zu einer Album-Gruppe? — REIN.
 *
 * ÜBER TITEL UND INTERPRET, nicht über eine Kennung: Die Mitschnitt-Liste
 * führt keinen Medienschlüssel je Eintrag (liste.mjs), und einen zu
 * erfinden hieße, eine Verbindung zu behaupten, die die Daten nicht tragen.
 * Der Vergleich ist deshalb bewusst schlicht und **darf danebenliegen** —
 * findet er nichts, fehlt eben Cover und Download, und die Karte steht
 * trotzdem. Ein falsches Cover wäre schlimmer als keines.
 */
/**
 * Trägt das Werk eine DIENST-Quelle (Spotify, Jellyfin, ARD …)? — REIN.
 *
 * DER GERÄTEBEFUND DAHINTER (AUDIT-2026-09-05-B §5, Wiki
 * [werk-zwillinge-verstecken-fehlende-titel]): Ein teils aufgenommenes Album
 * steht als ZWEI Werke in der Mediathek — das Spotify-Werk mit allen Titeln
 * (Folge 13: 18) und das Lokal-Werk mit nur den Aufnahmen (7). Gemessen an
 * Box .62: 15 solcher Zwillingsgruppen, 9 mit auseinanderliegenden Zahlen
 * (tools/box/werk-zwillinge-probe.py). Wer beim Namensvergleich die lokale
 * Fassung erwischt, hält deren 7 für alles: nichts gilt mehr als fehlend,
 * nichts wird zum Nachladen angeboten — genau die Betreiber-Meldung
 * („läd nicht alle titel im album, weniger sichtbar auch zum nachladen").
 */
function traegtDienstQuelle(w: WerkKurz): boolean {
  return (w.quellen ?? []).some((q) => typeof q?.dienst === 'string' && q.dienst !== '' && q.dienst !== 'lokal')
}

export function werkZuAlbum(werke: WerkKurz[], gruppe: AlbumGruppe): WerkKurz | null {
  if (!gruppe.album) return null
  const gesucht = schluesselWort(gruppe.album, gruppe.interpret)
  const alle = Array.isArray(werke) ? werke : []
  // DIE DIENST-FASSUNG VOR DER LOKALEN — nicht „der erste Treffer".
  // Begründung bei traegtDienstQuelle(): nur die Dienst-Fassung kennt die
  // VOLLSTÄNDIGE Titelliste; die lokale kennt nur, was schon aufgenommen
  // ist, und versteckt damit alles Fehlende.
  const treffer = alle.filter((w) => schluesselWort(w.titel, w.interpret) === gesucht)
  const genau = treffer.find(traegtDienstQuelle) ?? treffer[0]
  if (genau) return genau
  // Zweite Runde ohne Interpret: die Mediathek schreibt ihn manchmal
  // anders (Unterstrich statt Doppelpunkt, Zusätze). Der Albumname
  // allein reicht, solange er EINDEUTIG ist — „eindeutig" heißt seit dem
  // Zwillings-Befund: genau EINE Dienst-Fassung (die lokalen Zwillinge
  // desselben Albums zählen nicht als Konkurrenz — sie sind die Aufnahme
  // selbst, nicht ein anderes Album). Mehrere DIENST-Fassungen gleichen
  // Namens bleiben ein „lieber nichts": ein falsches Cover wäre schlimmer
  // als keines.
  const nurAlbum = alle.filter((w) => namensWort(w.titel) === namensWort(gruppe.album))
  const dienstFassungen = nurAlbum.filter(traegtDienstQuelle)
  if (dienstFassungen.length === 1) return dienstFassungen[0]
  if (dienstFassungen.length > 1) return null
  return nurAlbum.length === 1 ? nurAlbum[0] : null
}

/**
 * Welche Titel des Albums FEHLEN noch in der Aufnahmeliste? — REIN.
 *
 * Betreiber, 04.09.2026: „es soll auch die titel darstellen welche noch vom
 * album fehlen um sie einzureihen." Verglichen wird über die Spotify-URI,
 * denn nur die ist auf beiden Seiten dieselbe Sache; ein Titelvergleich
 * über Namen ginge bei „Teil 1"/„Teil 01" schief.
 *
 * OHNE URI KEIN EINTRAG: Ein Titel, den man nicht vormerken KANN, gehört
 * nicht in eine Liste, die zum Anklicken einlädt.
 */
export function fehlendeTitel(
  inhalt: { nr?: number; titel?: string; uri?: string }[],
  schonInListe: ReadonlySet<string>,
): { uri: string; titel: string; nr?: number }[] {
  return (Array.isArray(inhalt) ? inhalt : [])
    .filter((t) => typeof t?.uri === 'string' && t.uri.startsWith('spotify:track:') && !schonInListe.has(t.uri))
    .map((t) => ({ uri: String(t.uri), titel: String(t.titel ?? ''), nr: t.nr }))
}

const PLUGIN_WEG = '/api/plugins/mixpi-mitschnitt'
/** Wie viele Fertige anfangs stehen — der Rest hinter dem Aufklapper. */
const FERTIG_ANFANG = 20

@Component({
  selector: 'mupi-aufzeichnen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    h1 { font-size: 1.3rem; margin: 0 0 0.4rem; }
    h2 { font-size: 1.02rem; margin: 2rem 0 0.7rem; }
    .unter { color: var(--gedaempft); font-size: 0.9rem; margin: 0 0 1.2rem; line-height: 1.5; }
    .kopfzeile { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
    .tat {
      margin-left: auto; background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 10px; padding: 0.45rem 0.9rem; cursor: pointer; font: inherit;
      color: inherit;
    }
    .werte { display: grid; gap: 0.7rem; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }
    .wert {
      background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 12px; padding: 0.85rem 1rem;
    }
    .wert .was { color: var(--gedaempft); font-size: 0.82rem; }
    .wert .zahl { font-size: 1.25rem; margin-top: 0.15rem; }
    .wert.warn .zahl { color: var(--warn); }
    .liste { display: flex; flex-direction: column; gap: 0.5rem; }
    .zeile {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 10px;
      padding: 0.55rem 0.9rem; display: grid; gap: 0.15rem;
    }
    .zeile .name { font-size: 0.95rem; }
    .zeile .name small { color: var(--gedaempft); }
    .zeile .klein { color: var(--gedaempft); font-size: 0.82rem; }
    .zeile .grund { font-size: 0.85rem; }
    .zeile.fehler { border-color: var(--fehler); }
    .zeile.fehler .grund { color: var(--fehler); }
    .naechster { color: var(--leit); font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; }
    .leer { color: var(--gedaempft); }
    .mehr {
      background: none; border: none; color: var(--leit); cursor: pointer;
      font: inherit; padding: 0.4rem 0; text-align: left;
    }
    .fuss { color: var(--gedaempft); font-size: 0.85rem; margin-top: 1.6rem; line-height: 1.5; }
    /* DIE LAUFENDE AUFNAHME steht ueber allem und traegt die Leitfarbe — sie
       ist die einzige Zeile der Seite, die sich von selbst bewegt. */
    .laeuft {
      display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
      background: var(--flaeche); border: 1px solid var(--leit); border-radius: 12px;
      padding: 0.7rem 1rem; margin: 0 0 1.2rem;
    }
    .laeuft .titel { font-size: 0.95rem; }
    .laeuft .titel small { color: var(--gedaempft); }
    .laeuft .zeit { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 1.1rem; color: var(--leit); }
    .zeile.mit-tat { grid-template-columns: 1fr auto; align-items: center; gap: 0.8rem; }
    .klein-tat {
      background: none; border: 1px solid var(--rand); border-radius: 8px;
      padding: 0.3rem 0.7rem; cursor: pointer; font: inherit; font-size: 0.82rem;
      color: inherit; white-space: nowrap;
    }
    .klein-tat[disabled] { opacity: 0.5; cursor: default; }
    /* ══ DER FORTSCHRITTSBALKEN ══════════════════════════════════════════
       Von Hand gezeichnet wie die Balken der Leistungsseite — eine Breite
       in Prozent laedt keine Bibliothek nach. */
    .bahn { height: 8px; border-radius: 4px; background: var(--rand); overflow: hidden; width: 100%; margin-top: 0.4rem; }
    .bahn i { display: block; height: 100%; background: var(--leit); transition: width 0.9s linear; }
    .laeuft .cover { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; flex: 0 0 auto; }
    .laeuft .mitte { flex: 1 1 14rem; min-width: 0; }
    /* ══ ALBEN STATT ZEILEN ══════════════════════════════════════════════
       Ein Album ist eine Karte mit Cover; seine Titel stehen darin als
       schmale Zeilen. Ohne Cover bleibt ein Platzhalter — die Karte darf
       nicht springen, nur weil ein Bild fehlt. */
    .alben { display: grid; gap: 0.7rem; grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr)); }
    .album {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.7rem 0.9rem; display: grid; gap: 0.5rem; align-content: start;
    }
    .album.fehler { border-color: var(--fehler); }
    .album-kopf { display: flex; gap: 0.7rem; align-items: center; }
    .album-kopf img, .album-kopf .platz {
      width: 48px; height: 48px; border-radius: 8px; object-fit: cover; flex: 0 0 auto;
      background: var(--rand);
    }
    .album-kopf .wer { min-width: 0; flex: 1 1 auto; }
    /* UMBRECHEN STATT ABSCHNEIDEN (Betreiber, 04.09.2026: „der album name
       braucht noch einen umbruch, er schreibt über…"). Hoechstens zwei
       Zeilen, damit die Karten im Raster nicht auseinanderlaufen. */
    .album-kopf .wer b {
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden; font-size: 0.95rem; line-height: 1.25; overflow-wrap: anywhere;
    }
    .album-kopf .wer small { color: var(--gedaempft); }
    .stuecke { display: grid; gap: 0.2rem; }
    .stueck { display: grid; grid-template-columns: 1fr auto; gap: 0.6rem; align-items: baseline; font-size: 0.85rem; }
    .stueck .wort { color: var(--gedaempft); font-size: 0.78rem; }
    .album-tat { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .winz {
      background: none; border: none; color: var(--leit); cursor: pointer;
      font: inherit; font-size: 0.78rem; padding: 0 0.2rem;
    }
    .winz[disabled] { opacity: 0.5; cursor: default; }
    .fehlt-block { border-top: 1px solid var(--rand); padding-top: 0.45rem; margin-top: 0.2rem; }
    .fehlt-block .kopf { color: var(--gedaempft); font-size: 0.78rem; margin-bottom: 0.2rem; }
    .suche {
      width: 100%; max-width: 22rem; background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 10px; padding: 0.45rem 0.8rem; font: inherit; color: inherit; margin: 0 0 1rem;
    }
    /* ══ DER NACHTMODUS-KASTEN ═══════════════════════════════════════════
       Er steht oben und traegt die Warnfarbe, wenn er GERADE gilt: dass
       Spotify schweigt, ist die eine Auskunft, die man sofort braucht. */
    .nacht {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 12px;
      padding: 0.7rem 1rem; margin: 0 0 1.2rem; display: grid; gap: 0.5rem;
    }
    .nacht.aktiv { border-color: var(--warn); }
    .nacht .reihe { display: flex; gap: 0.9rem; align-items: center; flex-wrap: wrap; }
    .nacht label { display: flex; gap: 0.35rem; align-items: center; font-size: 0.9rem; }
    .nacht input[type='time'] {
      background: var(--flaeche); border: 1px solid var(--rand); border-radius: 8px;
      padding: 0.25rem 0.5rem; font: inherit; color: inherit;
    }
    .nacht .satz { color: var(--gedaempft); font-size: 0.82rem; line-height: 1.45; }
    .nacht .satz.warn { color: var(--warn); }
    .stueck.schlecht .wort { color: var(--fehler); }
    .suche {
      width: 100%; max-width: 22rem; background: var(--flaeche); border: 1px solid var(--rand);
      border-radius: 10px; padding: 0.45rem 0.8rem; font: inherit; color: inherit; margin: 0 0 1rem;
    }
  `,
  template: `
    <div class="kopfzeile">
      <h1>Aufzeichnen</h1>
      <button type="button" class="tat" (click)="holen()" [disabled]="laedt()">
        {{ laedt() ? 'wird geholt …' : 'Jetzt aktualisieren' }}
      </button>
    </div>
    <!-- Das Befinden ist der SATZ des Plugins selbst (sechs benannte
         Leerlauf-Gruende, auftrag.mjs) — die Seite formuliert nicht um. -->
    <p class="unter">{{ befinden() || 'Der Mitschnitt hat sich noch nicht gemeldet.' }}</p>

    @if (einstellungen(); as e) {
      <div class="nacht" [class.aktiv]="nachtGiltJetzt()">
        <div class="reihe">
          <label>
            <input type="checkbox" [checked]="e.nachtmodus === true" (change)="schalten('nachtmodus', $any($event.target).checked)" />
            Nachtmodus
          </label>
          <label>
            von
            <input type="time" [value]="e.nachtVon || '22:00'" (change)="schalten('nachtVon', $any($event.target).value)" />
          </label>
          <label>
            bis
            <input type="time" [value]="e.nachtBis || '06:00'" (change)="schalten('nachtBis', $any($event.target).value)" />
          </label>
          <label>
            <input type="checkbox" [checked]="e.albumKomplett === true" (change)="schalten('albumKomplett', $any($event.target).checked)" />
            Alben komplett aufnehmen
          </label>
        </div>
        <div class="satz" [class.warn]="nachtGiltJetzt()">
          @if (nachtGiltJetzt()) {
            Der Nachtmodus läuft gerade: alle Ströme nehmen auf, <strong>Spotify spielt nicht</strong>.
            Lokale Dateien, ARD, Jellyfin und Podcasts laufen weiter.
          } @else if (e.nachtmodus === true) {
            Eingeschaltet, aber außerhalb des Zeitfensters — Spotify spielt normal.
          } @else {
            Aus. Eingeschaltet gibt nachts die Wiedergabe ihren Strom ab, damit mehrere Aufnahmen
            parallel laufen; dafür schweigt Spotify in dieser Zeit.
          }
        </div>
      </div>
    }

    <input
      class="suche"
      type="search"
      placeholder="Suchen: Titel, Album oder Interpret"
      [value]="frage()"
      (input)="frage.set($any($event.target).value)"
    />

    @if (laufend(); as l) {
      <div class="laeuft">
        <div class="titel">
            Nimmt gerade auf: <strong>{{ l.name }}</strong> <small>— {{ l.interpret }}</small>
            @if (l.stromNr) {
              <small>· über Strom {{ l.stromNr }}</small>
            }
          </div>
        <div class="zeit">{{ mmss(l.sekunden) }}</div>
      </div>
    }

    @if (fehlerText()) {
      <p class="unter">{{ fehlerText() }}</p>
    } @else {
      <div class="werte">
        <div class="wert">
          <div class="was">vorgemerkt</div>
          <div class="zahl">{{ gruppen().offen.length }}</div>
        </div>
        <div class="wert">
          <div class="was">aufgezeichnet</div>
          <div class="zahl">{{ gruppen().fertig.length }}</div>
        </div>
        <div class="wert" [class.warn]="gruppen().fehler.length > 0">
          <div class="was">mit Fehler</div>
          <div class="zahl">{{ gruppen().fehler.length }}</div>
        </div>
      </div>

      <h2>Warteschlange</h2>
      @if (!offeneAlben().length) {
        <p class="leer">{{ frage() ? 'Nichts Vorgemerktes passt zur Suche.' : 'Nichts vorgemerkt — der Leerlauf hat nichts zu tun.' }}</p>
      } @else {
        <div class="alben">
          @for (a of offeneAlben(); track a.kennung) {
            <div class="album">
              <div class="album-kopf">
                <span class="platz"></span>
                <div class="wer">
                  <b>{{ a.album || a.titel[0].name }}</b>
                  <small>{{ a.interpret }} · {{ a.titel.length }} Titel</small>
                </div>
              </div>
              <div class="stuecke">
                @for (t of a.titel; track t.uri) {
                  <div class="stueck">
                    <span>{{ t.name }}</span>
                    @if (t.vorrang) {
                      <span class="wort">Vorrang</span>
                    }
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }

      @if (fehlerAlben().length) {
        <h2>Liegen mit Fehler</h2>
        <div class="alben">
          @for (a of fehlerAlben(); track a.kennung) {
            <div class="album fehler">
              <div class="album-kopf">
                <span class="platz"></span>
                <div class="wer">
                  <b>{{ a.album || a.titel[0].name }}</b>
                  <small>{{ a.interpret }}</small>
                </div>
                <button type="button" class="klein-tat" [disabled]="ladeVormerk() === a.kennung" (click)="albumNeuLaden(a)">
                  {{ ladeVormerk() === a.kennung ? '…' : 'Nochmal' }}
                </button>
              </div>
              <div class="stuecke">
                @for (t of a.titel; track t.uri) {
                  <div class="stueck schlecht">
                    <span>{{ t.name }}</span>
                    <span class="wort">{{ t.wort }}</span>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }

      <h2>Aufgezeichnet</h2>
      @if (!fertigeAlben().length) {
        <p class="leer">{{ frage() ? 'Nichts Fertiges passt zur Suche.' : 'Noch nichts fertig.' }}</p>
      } @else {
        <div class="alben">
          @for (a of fertigSichtbar(); track a.kennung) {
            <div class="album">
              <div class="album-kopf">
                @if (werkVon(a); as w) {
                  <img [src]="w.bild" alt="" />
                } @else {
                  <span class="platz"></span>
                }
                <div class="wer">
                  <b>{{ a.album || a.titel[0].name }}</b>
                  <small>{{ a.interpret }} · {{ a.titel.length }} aufgenommen</small>
                </div>
              </div>
              <div class="album-tat">
                <button type="button" class="klein-tat" [disabled]="ladeVormerk() === a.kennung" (click)="albumNeuLaden(a)">
                  {{ vorgemerkt().has(a.kennung) ? 'vorgemerkt' : ladeVormerk() === a.kennung ? '…' : 'Alle neu laden' }}
                </button>
                @if (werkVon(a); as w) {
                  <a class="klein-tat" [href]="'/api/werke/' + enc(w.schluessel) + '/download'" download>Herunterladen</a>
                }
              </div>
              <div class="stuecke">
                @for (t of a.titel; track t.uri) {
                  <div class="stueck">
                    <span>{{ t.name }}</span>
                    <button type="button" class="winz" [disabled]="ladeVormerk() === t.uri" (click)="titelNeuLaden(t)">
                      {{ vorgemerkt().has(t.uri) ? 'vorgemerkt' : ladeVormerk() === t.uri ? '…' : 'neu laden' }}
                    </button>
                  </div>
                }
              </div>
              @if (fehlendeVon(a); as f) {
                @if (f.length) {
                  <div class="fehlt-block">
                    <div class="kopf">{{ f.length }} vom Album fehlen noch</div>
                    <div class="stuecke">
                      @for (t of f; track t.uri) {
                        <div class="stueck">
                          <span>{{ t.titel }}</span>
                          <button type="button" class="winz" [disabled]="ladeVormerk() === t.uri" (click)="fehlendenEinreihen(t)">
                            {{ vorgemerkt().has(t.uri) ? 'eingereiht' : ladeVormerk() === t.uri ? '…' : 'einreihen' }}
                          </button>
                        </div>
                      }
                    </div>
                    <button type="button" class="winz" [disabled]="ladeVormerk() === a.kennung + ':fehlt'" (click)="alleFehlendenEinreihen(a, f)">
                      Alle {{ f.length }} einreihen
                    </button>
                  </div>
                }
              }
            </div>
          }
        </div>
        @if (fertigeAlben().length > fertigGrenze()) {
          <button type="button" class="mehr" (click)="alleFertigen()">
            Alle {{ fertigeAlben().length }} Alben zeigen
          </button>
        }
      }

      <p class="fuss">
        Die Reihenfolge der Warteschlange ist die echte: Der Leerlauf nimmt von oben, Vorrang zuerst.
        Aufgenommen wird nur, wenn gerade niemand hört und ein eigener Strom frei ist — warum gerade
        nichts passiert, steht im Satz oben. „Neu laden" merkt ein ganzes Album mit Vorrang vor und
        markiert die alten Dateien als unvollständig — bis die neuen Aufnahmen stehen, spielt wieder
        die Cloud. Ein Titel ohne Album steht als eigene Karte.
      </p>
    }
  `,
})
export class AufzeichnenSeite implements OnDestroy {
  private readonly http = inject(HttpClient)

  readonly laedt = signal(false)
  readonly befinden = signal('')
  readonly fehlerText = signal('')
  readonly liste = signal<MitschnittListe | null>(null)
  readonly fertigGrenze = signal(FERTIG_ANFANG)

  /** Der Suchbegriff — er siebt VOR dem Gruppieren, damit ein Album mit
   *  einem passenden Titel als Ganzes stehen bleibt. */
  readonly frage = signal('')

  readonly gruppen = computed(() => listeGruppieren(suchen(this.liste()?.eintraege ?? [], this.frage())))
  readonly offeneAlben = computed(() => albenBauen(this.gruppen().offen))
  readonly fehlerAlben = computed(() => albenBauen(this.gruppen().fehler))
  readonly fertigeAlben = computed(() => albenBauen(this.gruppen().fertig))
  readonly fertigSichtbar = computed(() => this.fertigeAlben().slice(0, this.fertigGrenze()))
  readonly fortschritt = computed(() => fortschrittProzent(this.laufend()))

  /** Die Mediathek — für Cover, Download und die Frage „was fehlt noch". */
  readonly werke = signal<WerkKurz[]>([])
  /** Album-Kennung -> die noch nicht vorgemerkten Titel des Albums. */
  readonly fehlend = signal(new Map<string, { uri: string; titel: string; nr?: number }[]>())

  readonly enc = encodeURIComponent

  /** Die Plugin-Einstellungen — Nachtmodus und „Alben komplett" wohnen dort. */
  readonly einstellungen = signal<MitschnittEinstellungen | null>(null)

  /**
   * Gilt der Nachtmodus JETZT?
   *
   * DIESELBE RECHNUNG WIE IM PLUGIN, aber bewusst nachgebaut statt
   * importiert: Die Verwaltung ist kompiliertes Angular und darf kein
   * Plugin-Modul laden (die Linie des Hauses, siehe Steckleiste). Die
   * ENTSCHEIDUNG faellt weiterhin im Plugin und im Spielweg — das hier ist
   * nur eine Anzeige, und wenn sie um eine Minute danebenliegt, ist nichts
   * passiert.
   */
  nachtGiltJetzt(): boolean {
    const e = this.einstellungen()
    if (!e || e.nachtmodus !== true) return false
    const min = (x: unknown): number | null => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(x ?? '').trim())
      if (!m) return null
      const h = Number(m[1])
      const mm = Number(m[2])
      return h > 23 || mm > 59 ? null : h * 60 + mm
    }
    const von = min(e.nachtVon)
    const bis = min(e.nachtBis)
    if (von === null && bis === null) return true
    if (von === null || bis === null) return false
    const jetzt = new Date()
    const m = jetzt.getHours() * 60 + jetzt.getMinutes()
    return von <= bis ? m >= von && m < bis : m >= von || m < bis
  }

  /** Eine Einstellung umlegen — der ganze Satz geht zurück, wie es die
   *  Plugin-Route erwartet. */
  async schalten(feld: keyof MitschnittEinstellungen, wert: unknown): Promise<void> {
    const alt: MitschnittEinstellungen = this.einstellungen() ?? {}
    const neu = { ...alt, [feld]: wert }
    this.einstellungen.set(neu)
    try {
      await firstValueFrom(this.http.put(PLUGIN_WEG + '/einstellungen', neu))
      await this.holen()
    } catch {
      this.einstellungen.set(alt)
      this.fehlerText.set('Die Einstellung ließ sich nicht speichern.')
    }
  }

  werkVon(a: AlbumGruppe): WerkKurz | null {
    return werkZuAlbum(this.werke(), a)
  }

  fehlendeVon(a: AlbumGruppe): { uri: string; titel: string; nr?: number }[] {
    return this.fehlend().get(a.kennung) ?? []
  }

  readonly eintragZeile = eintragZeile
  readonly mmss = mmss

  /** Was gerade aufgenommen wird — direkt aus der Antwort (E126/3). */
  readonly laufend = computed(() => this.liste()?.laufend ?? null)

  /** Wessen Knopf gerade wartet, und was schon vorgemerkt ist. */
  readonly ladeVormerk = signal('')
  readonly vorgemerkt = signal(new Set<string>())

  /** Alle 10 s frisch — die Liste bewegt sich, wenn der Leerlauf arbeitet. */
  private readonly uhr = setInterval(() => void this.holen(), 10_000)

  constructor() {
    void this.holen()
  }

  /**
   * Ein ganzes ALBUM neu laden (E126/2, Umbau 04.09.) — alle seine Titel
   * werden MIT VORRANG vorgemerkt, liegengebliebene aus dem Fehlerzustand
   * geholt (der Endpunkt tut das).
   *
   * AM ALBUM UND NICHT AM TITEL, weil man mit einem ALBUM unzufrieden ist:
   * „die Aufnahme klingt abgehackt" meint selten genau ein Stück. Die
   * Marke an den Dateien setzt das Plugin, nicht diese Seite.
   */
  async albumNeuLaden(a: AlbumGruppe): Promise<void> {
    await this.vormerkenSchicken(
      a.kennung,
      a.titel.map((t) => ({
        uri: t.uri,
        titel: t.name,
        interpret: t.interpret,
        album: t.album,
        albumInterpret: t.albumInterpret,
      })),
    )
  }

  /**
   * Die Mediathek dazuholen — und für jedes FERTIGE Album nachsehen, was
   * noch fehlt.
   *
   * NUR FÜR DIE FERTIGEN, und nur für die SICHTBAREN: `/inhalt` je Album
   * ist ein Abruf, der bei Spotify-Werken übers Netz geht. Für 171 Alben
   * wäre das ein Sturm — für die zwanzig, die man gerade sieht, ist es
   * eine Handvoll. Die Frage „was fehlt" stellt sich ohnehin nur dort, wo
   * schon etwas aufgenommen ist.
   *
   * STILL BEI FEHLERN: Fehlt die Auskunft, zeigt die Karte eben keine
   * Lücken. Eine Fehlermeldung wegen eines Zusatzes wäre lauter als die
   * Sache wert ist.
   */
  private async werkeHolen(): Promise<void> {
    try {
      const w = await firstValueFrom(this.http.get<{ werke: WerkKurz[] }>('/api/werke'))
      this.werke.set(w?.werke ?? [])
    } catch {
      return
    }
    const schon = new Set((this.liste()?.eintraege ?? []).map((e) => e.uri))
    const karte = new Map(this.fehlend())
    for (const a of this.fertigSichtbar()) {
      const werk = this.werkVon(a)
      if (!werk) continue
      try {
        const inhalt = await firstValueFrom(
          this.http.get<{ titel: { nr?: number; titel?: string; uri?: string }[] }>(
            '/api/werke/' + encodeURIComponent(werk.schluessel) + '/inhalt?verschmelzen=1',
          ),
        )
        karte.set(a.kennung, fehlendeTitel(inhalt?.titel ?? [], schon))
      } catch {
        /* dann eben keine Luecken-Auskunft fuer dieses Album */
      }
    }
    this.fehlend.set(karte)
  }

  /** Einen EINZELNEN Titel neu laden — dieselbe Mechanik wie beim Album. */
  async titelNeuLaden(t: MitschnittEintrag): Promise<void> {
    await this.vormerkenSchicken(t.uri, [
      { uri: t.uri, titel: t.name, interpret: t.interpret, album: t.album, albumInterpret: t.albumInterpret },
    ])
  }

  /** Einen fehlenden Titel des Albums einreihen. */
  async fehlendenEinreihen(t: { uri: string; titel: string }): Promise<void> {
    await this.vormerkenSchicken(t.uri, [{ uri: t.uri, titel: t.titel }])
  }

  /** Alle fehlenden eines Albums auf einmal. */
  async alleFehlendenEinreihen(a: AlbumGruppe, f: { uri: string; titel: string }[]): Promise<void> {
    await this.vormerkenSchicken(
      a.kennung + ':fehlt',
      f.map((t) => ({ uri: t.uri, titel: t.titel, album: a.album, albumInterpret: a.interpret })),
      f.map((t) => t.uri),
    )
  }

  /**
   * Der eine Weg zum Server — alle Knöpfe gehen hier durch.
   *
   * EIN RIEGEL, EINE STELLE: `ladeVormerk` verhindert zwei gleichzeitige
   * Anfragen, und `vorgemerkt` merkt sich, was schon quittiert ist. Wären
   * das vier Kopien (Album, Titel, Fehlender, Alle), liefe die fünfte beim
   * nächsten Wunsch daneben.
   */
  private async vormerkenSchicken(marke: string, titel: unknown[], auchMerken: string[] = []): Promise<void> {
    if (this.ladeVormerk()) return
    this.ladeVormerk.set(marke)
    try {
      await firstValueFrom(this.http.post(PLUGIN_WEG + '/http/neuladen', { titel }))
      this.vorgemerkt.update((v) => {
        const n = new Set(v).add(marke)
        for (const u of auchMerken) n.add(u)
        return n
      })
      await this.holen()
    } catch {
      this.fehlerText.set('Das Vormerken hat nicht geklappt — ist der Mitschnitt eingeschaltet?')
    } finally {
      this.ladeVormerk.set('')
    }
  }

  alleFertigen(): void {
    this.fertigGrenze.set(Number.MAX_SAFE_INTEGER)
  }

  async holen(): Promise<void> {
    if (this.laedt()) return
    this.laedt.set(true)
    try {
      const [liste, befinden] = await Promise.all([
        firstValueFrom(this.http.get<MitschnittListe>(PLUGIN_WEG + '/http/liste')),
        firstValueFrom(this.http.get<{ ok?: boolean; text?: string }>(PLUGIN_WEG + '/befinden')).catch(() => null),
      ])
      this.liste.set(liste)
      this.befinden.set(String(befinden?.text ?? ''))
      this.fehlerText.set('')
      void this.werkeHolen()
      void firstValueFrom(this.http.get<MitschnittEinstellungen>(PLUGIN_WEG + '/einstellungen'))
        .then((e) => this.einstellungen.set(e ?? {}))
        .catch(() => {
          /* ohne Einstellungen bleibt der Kasten weg — kein Grund zu laermen */
        })
    } catch {
      // Plugin aus oder Server weg — die Seite sagt es, statt leer zu wirken.
      this.fehlerText.set(
        'Der Mitschnitt antwortet nicht. Ist das Plugin unter „Plugins" eingeschaltet?',
      )
    } finally {
      this.laedt.set(false)
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.uhr)
  }
}
