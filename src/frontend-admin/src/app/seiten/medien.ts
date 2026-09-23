/**
 * Die Medienseite — die Bibliothek der Box über alle Dienste hinweg.
 *
 * ZWEI HÄLFTEN, bewusst getrennt:
 *   oben   SUCHEN und aufnehmen — über Spotify und Jellyfin gleichzeitig
 *   unten  VERWALTEN, was schon da ist — zuordnen, umbenennen, entfernen
 *
 * Warum in dieser Reihenfolge: „etwas Neues drauftun" ist der häufigere
 * Handgriff. Die Bibliothek steht darunter und wartet.
 *
 * ÜBER SCHLÜSSEL, NICHT ÜBER POSITIONEN. Jeder Eintrag trägt einen aus seinem
 * Inhalt abgeleiteten Schlüssel; Ändern und Löschen sprechen ihn an. Die alten
 * Endpunkte der Box arbeiteten mit einem Listenindex — der verschiebt sich,
 * und im Offline-Betrieb liest die Oberfläche sogar eine andere Liste. So
 * löscht man irgendwann den falschen Eintrag.
 */
import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { firstValueFrom } from 'rxjs'
import { DarstellungDienst } from '../darstellung.dienst'
import { type SystemAktion, SystemDienst } from '../system.dienst'
import { MixpiPluginAbschnitt } from './mixpi-plugin-abschnitt'

interface Eintrag {
  schluessel: string
  /** Eintraege mit derselben Gruppe sind dasselbe Werk in mehreren Diensten. */
  gruppe?: number
  type: string
  category?: string
  title?: string
  artist?: string
  cover?: string
  [k: string]: unknown
}

interface BoxListe {
  id: string
  name: string
  category: string
  titel: { quelle: string; title: string; artist?: string; uri?: string; id?: string }[]
}

interface Treffer {
  schluessel: string
  /*
   * `ard` seit 04.08.2026 (BACKLOG E4/A6): Die ARD Audiothek sucht im SELBEN
   * Topf wie Spotify und Jellyfin. Eine eigene Suchmaske haette eine zweite
   * Trefferliste, ein zweites Umbenennen-vor-dem-Aufnehmen und einen zweiten
   * Weg zum Anlegen gebraucht — und genau das ist die Bauart, die hier
   * mehrfach zugeschlagen hat.
   */
  dienst: 'spotify' | 'jellyfin' | 'ard'
  art: 'album' | 'playlist' | 'show'
  type: string
  title: string
  artist: string
  cover?: string
  titelAnzahl?: number
  /** Bei Listen: der Spotify-BENUTZER, dem sie gehoert - nicht der Interpret. */
  besitzer?: string
  /** Bei einzelnen Titeln: das Album, aus dem sie stammen. */
  album?: string
  dauerMs?: number
  uri?: string
  /** Einzelne Titel sind KEIN Bibliothekseintrag - nur Baustein einer Liste. */
  nurFuerListe?: boolean
  /** Treffer mit derselben Gruppe meinen dasselbe Album in mehreren Diensten. */
  gruppe?: number
  /** In welchen ANDEREN Diensten es dasselbe auch gibt. */
  auchIn?: string[]
  schonDa?: boolean
  id?: string
  playlistid?: string
  audiobookid?: string
}

/**
 * Ein Eintrag, den die Box zum Entfernen ANBIETET.
 *
 * Die Entscheidung dahinter liegt auf der Box (aufraeumen.ts, getestet): erst
 * nach drei brauchbaren Prüfläufen und mehr als einem Tag. Diese Seite fällt
 * kein eigenes Urteil — ein zweites wäre eines zu viel.
 */
interface Vorschlag {
  schluessel: string
  kennung: string
  titel?: string
  interpret?: string
  cover?: string
  dienst?: string
  /** playlists | albums | shows | audiobooks — wie die Spotify-Web-API es nennt. */
  art?: string
  /** Wann der Eintrag zum ersten Mal als weg gemeldet wurde (ms seit 1970). */
  seit: number
  laeufe: number
  /** Zwei Einträge mit demselben Schlüssel — das Entfernen greift dort nicht. */
  doppelt?: boolean
}

/**
 * Ein Radiosender, wie ihn `mixpi-ardsounds` unter `http/sender` liefert (E84).
 *
 * `vorschlag` ist der FERTIGE data.json-Eintrag. Er wird durchgereicht und
 * nicht nachgebaut — das Plugin ist die eine Stelle dieser Form.
 */
interface SenderRoh {
  kennung: string
  titel: string
  adresse: string
  bild: string
  herausgeber: string
  vorschlag: { type: string; category: string; id: string; title: string; artist: string; cover: string }
}

/** Derselbe Sender, um die Frage erweitert, ob er schon in der Bibliothek steht. */
interface SenderZeile extends SenderRoh {
  schonDa: boolean
}

/**
 * Ein Werk, wie `mixpi-archive` es unter `http/suche` liefert (E88).
 *
 * `vorschlag` ist der FERTIGE data.json-Eintrag — `type: 'plugin'` und in
 * `id` die volle Medienkennung. Er wird durchgereicht und nicht nachgebaut.
 */
interface ArchivRoh {
  kennung: string
  titel: string
  urheber: string
  jahr: string
  abrufe: number
  vorschlag: { type: string; category: string; id: string; title: string; artist: string; cover: string }
}

interface ArchivZeile extends ArchivRoh {
  schonDa: boolean
}

interface Verfuegbarkeit {
  geloescht: string[]
  geprueft: number
  stand: string
  laeuft: boolean
  grund: string
  /** Ob der letzte Lauf gezählt hat, oder ob er verworfen wurde. */
  taugte: boolean
  vorschlaege: Vorschlag[]
}

/**
 * Ein Eintrag der Mitschnitt-Lage, wie `mixpi-mitschnitt` unter `http/liste`
 * liefert (Betreiber: „mir fehlt noch die verwaltung sowie anstoßen").
 */
interface AufnahmeEintrag {
  uri: string
  name: string
  interpret: string
  album?: string
  stand: 'offen' | 'fertig' | 'fehler'
  /** Nur bei `stand === 'fehler'` gesetzt — der Klartext des Plugins. */
  wort?: string
  gemerktAm?: number
}

interface AufnahmeZusammenfassung {
  offen: number
  fertig: number
  fehler: number
}

/** Ein Titel aus `GET /api/werke/<schluessel>/inhalt` — nur die Felder, die die Abbildung braucht. */
interface MitschnittTitelRoh {
  titel?: string
  interpret?: string
  dauerMs?: number
  uri?: unknown
}

/** Ein Titel im Koerper von `POST .../mixpi-mitschnitt/http/vormerken`. */
interface MitschnittVormerkTitel {
  uri: string
  name: string
  interpret: string
  album: string
  albumKuenstler?: string
  dauerMs?: number
  kategorie?: string
}

/**
 * Titel aus `/inhalt` (quelle=spotify) auf den Koerper von
 * `POST .../mixpi-mitschnitt/http/vormerken` abbilden — REIN, ohne Http, ohne
 * Angular, damit `mitschnitt-vormerk-koerper.spec.ts` sie ohne Umweg pruefen
 * kann (Haus-Muster: `SCHNELL_NICHT_KLICKBAR`, geprueft in `schnellwahl.spec.ts`).
 *
 * TITEL OHNE `uri` SIND KEIN SPOTIFY-TITEL — der serverseitige
 * Quellen-Ruckfall (`/api/werke/:schluessel/inhalt`, server.ts) kann bei
 * `quelle=spotify` trotzdem einen lokalen oder ARD-Titel ohne `uri` liefern,
 * wenn Spotify selbst keinen Kandidaten stellt. Der Mitschnitt kann mit einem
 * Titel ohne Spotify-URI nichts anfangen; er wird gezaehlt, nicht gesendet.
 */
export function mitschnittVormerkKoerper(
  titel: readonly MitschnittTitelRoh[],
  album: { titel: string; interpret: string; kategorie?: string },
): { koerper: MitschnittVormerkTitel[]; uebersprungen: number } {
  const koerper: MitschnittVormerkTitel[] = []
  let uebersprungen = 0
  for (const t of titel) {
    if (typeof t.uri !== 'string' || !t.uri) {
      uebersprungen++
      continue
    }
    const eintrag: MitschnittVormerkTitel = {
      uri: t.uri,
      name: String(t.titel ?? ''),
      interpret: String(t.interpret ?? ''),
      album: album.titel,
    }
    if (album.interpret) eintrag.albumKuenstler = album.interpret
    if (typeof t.dauerMs === 'number') eintrag.dauerMs = t.dauerMs
    if (album.kategorie) eintrag.kategorie = album.kategorie
    koerper.push(eintrag)
  }
  return { koerper, uebersprungen }
}

/** Merker der Ansicht: soll automatisch bei den anderen Diensten nachgefragt werden? */
const AUTO_SCHLUESSEL = 'mupi_medien_auto_v1'

function leseAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_SCHLUESSEL) === '1'
  } catch {
    return false
  }
}

const KATEGORIE_NAME: Record<string, string> = {
  music: 'Musik',
  audiobook: 'Hörspiel',
  other: 'Sonstiges',
}

/** Der Stand eines Mitschnitt-Eintrags als Wort statt als Code. */
const AUFNAHME_STAND_WORT: Record<string, string> = {
  offen: 'offen',
  fertig: 'fertig',
  fehler: 'mit Fehler',
}

/*
 * DIESE LISTE IST EIN VERBRAUCHER, KEINE QUELLE. Massgeblich ist der
 * Rueckgabetyp von `dienstVon()` in backend-api/src/medien.ts; hier steht sie
 * ein zweites Mal, weil diese Angular-App keine einzige Zeile aus backend-api
 * einliest (eigenes tsconfig, eigener Bau — ein Pfad-Alias dorthin zoege die
 * Servertypen in den Browser-Bau). Dass sie vollstaendig BLEIBT, prueft
 * `tools/dienste-deckung.mjs`; ohne diesen Schritt fehlte `ard` hier vom
 * 04.08.2026 an, und ARD-Eintraege haetten sich in der Bibliothek als
 * „Anderes" ausgegeben, ohne dass irgendetwas rot geworden waere.
 */
const DIENST_NAME: Record<string, string> = {
  spotify: 'Spotify',
  jellyfin: 'Jellyfin',
  lokal: 'Lokal',
  radio: 'Radio',
  rss: 'Podcast',
  ard: 'ARD Sounds',
  plugin: 'Plugin',
  anderes: 'Anderes',
}

/**
 * Was in einer Bibliothekszeile NICHT die Schnellwahl ausloest.
 *
 * Exportiert, weil `schnellwahl.spec.ts` GENAU DIESE Regel prueft und nicht
 * eine zweite, nachgebaute — sonst pruefte der Test seine eigene Kopie und
 * bliebe gruen, waehrend die Oberflaeche etwas anderes tut.
 */
export const SCHNELL_NICHT_KLICKBAR = 'input, button, select, textarea, label, a'

@Component({
  selector: 'mupi-medien',
  standalone: true,
  imports: [FormsModule, RouterLink, MixpiPluginAbschnitt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* Die zentrale Suche klebt oben - Begruendung im Template. */
    .zentrale-suche { position: sticky; top: 0; z-index: 5; display: flex; gap: 0.5rem;
      padding: 0.55rem 0; background: var(--grund, var(--hintergrund, #10131a)); }
    .zentrale-suche input { flex: 1 1 auto; }
    .zentral-stand { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.2rem 0 0.6rem; }
    .zentral-stand .anker { font-size: 0.85rem; padding: 0.15rem 0.6rem; border-radius: 999px; }
    h1 { font-size: 1.3rem; margin: 0 0 0.35rem; }
    h2 { font-size: 1.02rem; margin: 0 0 0.7rem; }
    p.unter { color: var(--gedaempft); margin: 0 0 1.2rem; font-size: 0.94rem; }
    .karte {
      background: var(--flaeche, #16202b);
      border: 1px solid var(--rand, #24313f);
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1.1rem;
    }
    .reihe { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
    /* Die beiden Wege zu den Unterseiten. Kacheln und nicht Verweise im Satz:
       sie sind seit dem 03.08.2026 der EINZIGE Weg dorthin (aus der Kopfleiste
       sind sie raus), und ein Weg, den man ueberliest, ist keiner. */
    .wege { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
    a.weg {
      display: block; text-decoration: none; color: inherit;
      background: var(--eingabe, #0e1720); border: 1px solid var(--rand, #24313f);
      border-radius: 10px; padding: 0.7rem 0.85rem;
    }
    a.weg:hover { border-color: var(--betont, #2b6cb0); }
    a.weg b { display: block; margin-bottom: 0.15rem; }
    a.weg span { color: var(--gedaempft); font-size: 0.85rem; }
    /* Ein Schalter, der aussieht wie einer: gedrueckt = an. Dieselbe Sprache
       wie auf der Darstellungsseite, von der die beiden Knoepfe kommen. */
    button.wahl {
      background: var(--eingabe, #0e1720); border: 1px solid var(--rand, #24313f);
      color: var(--schrift); border-radius: 8px; padding: 0.5rem 0.85rem; font: inherit;
    }
    button.wahl.gewaehlt { background: var(--leit, #3880ff); border-color: var(--leit, #3880ff); color: #fff; }
    label.schalter { display: flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; color: var(--gedaempft); }
    /* WER SIEHT WAS: die Haken sitzen am Ende der Zeile, klein und ruhig -
       sie sollen ablesbar sein, ohne den Titel zu verdraengen. */
    /* EIGENE ZEILE: flex-basis 100% bricht sie im umbrechenden li nach
       unten um. Eingerückt auf die Breite des Covers plus Abstand, damit sie
       unter dem TITEL beginnt und nicht unter dem Bild — sie gehört zum
       Titel, nicht zum Werk als Ganzem. */
    .schnellleiste.an { border: 1px solid var(--betont, #3182ce); border-radius: 8px;
      padding: 0.4rem 0.6rem; background: rgba(49, 130, 206, 0.08); }
    /* DIE GANZE ZEILE IST DAS ZIEL, also muss sie sich auch so anfuehlen. */
    li.schnellziel { cursor: pointer; }
    li.schnellziel:hover { background: rgba(49, 130, 206, 0.14); outline: 1px solid rgba(49, 130, 206, 0.5); }
    .profilzeile { flex: 0 0 100%; display: flex; flex-wrap: wrap; gap: 0.35rem;
      align-items: center; margin: 0.1rem 0 0 3.75rem; }  /* 48px Cover + 0.75rem Abstand */
    .profilzeile .fuer { color: var(--gedaempft); font-size: 0.75rem;
      text-transform: uppercase; letter-spacing: 0.04em; margin-right: 0.15rem; }
    label.profilhaken { font-size: 0.8rem; padding: 0.1rem 0.45rem; border-radius: 999px;
      border: 1px solid var(--rand); white-space: nowrap; gap: 0.25rem; }
    /* OFFEN heisst: dieses Profil sieht alles, der Haken steht also nicht fuer
       eine Zuordnung, sondern fuer das Fehlen einer. Gestrichelt, damit man
       den Unterschied SIEHT und nicht nur im Hilfetext liest. */
    label.profilhaken.offen { border-style: dashed; opacity: 0.75; }
    input[type='search'], input[type='text'], select {
      background: var(--eingabe, #0e1720);
      border: 1px solid var(--rand, #24313f);
      border-radius: 8px;
      color: inherit;
      padding: 0.45rem 0.6rem;
      font: inherit;
    }
    input[type='search'] { flex: 1 1 16rem; }
    button {
      background: var(--eingabe, #0e1720);
      border: 1px solid var(--rand, #24313f);
      border-radius: 8px;
      color: inherit;
      padding: 0.45rem 0.85rem;
      font: inherit;
      cursor: pointer;
    }
    button.wichtig { background: var(--betont, #2b6cb0); border-color: transparent; }
    button.gefahr { border-color: #7d3030; color: #ff9b9b; }
    button:disabled { opacity: 0.45; cursor: default; }
    ul { list-style: none; margin: 0.9rem 0 0; padding: 0; display: grid; gap: 0.5rem; }
    li {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      padding: 0.5rem;
      border: 1px solid var(--rand, #24313f);
      border-radius: 10px;
    }
    img.cover { width: 48px; height: 48px; border-radius: 6px; object-fit: cover; background: #0b1219; flex: 0 0 auto; }
    .wer { flex: 1 1 auto; min-width: 0; }
    .wer b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Der Name ist ein Eingabefeld, soll aber wie die Ueberschrift der Zeile
       aussehen - erst beim Anfassen zeigt es sich als bearbeitbar. Sonst
       sieht die Liste aus wie ein Formular. */
    input.titel {
      display: block;
      width: 100%;
      font: inherit;
      font-weight: 700;
      color: inherit;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 0.1rem 0.3rem;
      margin: 0 0 0.1rem -0.3rem;
    }
    input.titel:hover { border-color: var(--rand, #24313f); }
    input.titel:focus,
    input.interpret:focus {
      background: var(--eingabe, #0e1720);
      border-color: var(--betont, #2b6cb0);
      outline: none;
    }
    /* Der Interpret steht in der zweiten Zeile und ist gedaempft - wie der
       Text, den er ersetzt. */
    input.interpret {
      display: block;
      width: 100%;
      font: inherit;
      font-size: 0.85rem;
      color: var(--gedaempft);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 0.05rem 0.3rem;
      margin: 0 0 0 -0.3rem;
    }
    input.interpret:hover { border-color: var(--rand, #24313f); }
    .wer span { color: var(--gedaempft); font-size: 0.85rem; }
    .marke {
      font-size: 0.72rem;
      border: 1px solid var(--rand, #24313f);
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
      color: var(--gedaempft);
      white-space: nowrap;
    }
    .marke.spotify { border-color: #1db95455; color: #64d98a; }
    button.weg {
      background: none;
      border: none;
      color: inherit;
      opacity: 0.55;
      padding: 0 0 0 0.3rem;
      font: inherit;
      cursor: pointer;
    }
    button.weg:hover { opacity: 1; color: #ff9b9b; }
    .marke.jellyfin { border-color: #00a4dc55; color: #6fd0f0; }
    /* Dasselbe Petrol wie die Plakette der neuen Oberflaeche (.marke-ard in
       NewDesign/app.css, #0f766e) - hier aufgehellt, weil der Text auf
       dunklem Grund steht und nicht auf der Farbflaeche selbst. Zwei
       Farbwelten fuer einen Dienst waeren eine Wahrheit zu viel. */
    .marke.ard { border-color: #0f766e88; color: #5ec8bd; }
    .hinweis { color: var(--gedaempft); font-size: 0.86rem; line-height: 1.45; margin: 0.6rem 0 0; }
    .warn { color: var(--warnung, #e0a33a); }
    .leer { color: var(--gedaempft); font-size: 0.92rem; margin: 0.9rem 0 0; }
    summary { cursor: pointer; }
    .mitschnitt-meldung { flex: 0 0 100%; color: var(--gedaempft); font-size: 0.82rem; }
    /* Treffer links, Baukasten rechts. Auf schmalen Schirmen untereinander -
       ein 320px-Kasten neben einer Trefferliste waere dort unbrauchbar. */
    .zweispaltig { display: flex; gap: 1rem; align-items: flex-start; }
    .links { flex: 1 1 auto; min-width: 0; }
    .rechts {
      flex: 0 0 20rem;
      max-width: 20rem;
      border: 1px solid var(--rand, #24313f);
      border-radius: 10px;
      padding: 0.7rem;
      background: rgba(0, 0, 0, 0.15);
    }
    @media (max-width: 62rem) {
      .zweispaltig { flex-direction: column; }
      .rechts { flex: 1 1 auto; max-width: none; width: 100%; }
    }
    ol.titelliste {
      list-style: none;
      margin: 0.6rem 0 0;
      padding: 0;
      display: grid;
      gap: 0.3rem;
      max-height: 22rem;
      overflow-y: auto;
    }
    ol.titelliste li {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      padding: 0.3rem 0.4rem;
      border: 1px solid var(--rand, #24313f);
      border-radius: 8px;
    }
    ol.titelliste .wer b { font-size: 0.9rem; font-weight: 600; }
    ol.titelliste .wer span { font-size: 0.78rem; }
    .q {
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--gedaempft);
      flex: 0 0 auto;
    }
    .q.spotify { color: #64d98a; }
    .q.jellyfin { color: #6fd0f0; }
    .rechts h3 { font-size: 0.98rem; margin: 0 0 0.3rem; }
    /* Der Knopf gehoert sichtbar zum Kasten rechts: gleiche Farbe, gleicher
       Rahmen. Ein blankes „+" liess offen, wohin es legt. */
    /* NICHT abschneiden: eine abgeschnittene Beschriftung ist schlimmer als
       eine kurze - man liest "+ alle in ,neue testl..." und weiss wieder
       nichts. Lieber bricht die Zeile um. */
    button.inliste {
      background: rgba(43, 108, 176, 0.18);
      border-color: rgba(43, 108, 176, 0.75);
      color: inherit;
      white-space: nowrap;
      flex: 0 0 auto;
    }
    li { flex-wrap: wrap; }
    button.inliste:hover { background: rgba(43, 108, 176, 0.35); }
  `,
  template: `
    <h1>Medien</h1>
    <p class="unter">Die Bibliothek der Box — über alle Dienste hinweg.</p>

    <!-- DIE ZENTRALE SUCHE (29.08.2026, Betreiberwunsch: "unuebersichtlich,
         ich haette gerne eine zentrale Suche oben"). Die Seite hatte FUENF
         Suchfelder mit je eigenem Wirkungskreis; wer nicht wusste, in
         welchem Kasten das Gesuchte wohnt, konnte nicht tippen. Dieses eine
         Feld speist beim TIPPEN alle oertlichen Siebe zugleich (Bibliothek,
         Regal, Sender) und feuert bei ENTER die zwei Netz-Suchen (Dienste,
         Internet Archive) - je Rubrik steht darunter der Zaehler samt
         Absprung. Die Einzelfelder in den Abschnitten bleiben: sie tragen
         Einstellungen (Art/Dienst-Auswahl), die eine schlichte Leiste nicht
         tragen soll. Klebt oben (sticky), damit sie beim Rollen durch die
         lange Seite erreichbar bleibt. -->
    <div class="zentrale-suche">
      <input
        type="search"
        placeholder="überall suchen — Bibliothek sofort, Dienste und Archiv mit Enter"
        [value]="zentral()"
        (input)="zentralTippen($any($event.target).value)"
        (keyup.enter)="zentralSuchen()"
      />
      <button type="button" (click)="zentralSuchen()" [disabled]="!zentral().trim() || sucht()">
        {{ sucht() ? 'sucht …' : 'überall suchen' }}
      </button>
    </div>
    @if (zentral().trim()) {
      <p class="zentral-stand">
        <button type="button" class="anker" (click)="springe('anker-bibliothek')">Bibliothek: {{ sichtbarGefasst().length }}</button>
        <button type="button" class="anker" (click)="springe('anker-dienste')">Dienste: {{ gesucht() ? treffer().length : '— Enter' }}</button>
        @if (senderGesamt()) {
          <button type="button" class="anker" (click)="springe('anker-sender')">Sender: {{ sender().length }}</button>
        }
        @if (regal() && gefilterteSendungen().length) {
          <button type="button" class="anker" (click)="springe('anker-regale')">Regal: {{ gefilterteSendungen().length }}</button>
        }
        <button type="button" class="anker" (click)="springe('anker-archiv')">Archiv: {{ archivGesucht() ? archivWerke().length : '— Enter' }}</button>
      </p>
    }

    <!-- ZWEI SCHALTER, DIE VON „DARSTELLUNG" HIERHER GEWANDERT SIND
         (G5, 03.08.2026). Beide standen dort bei den Elementen des
         Mini-Players, und beide beantworten nicht „wie sieht es aus", sondern
         „was ist da":
           Ganze Diskografie loest NETZABRUFE aus, einen je erkanntem
           Interpreten. Was Daten holt, gehoert zu den Medien.
           Doppelte zusammenfassen aendert die ANZAHL der Werke — aus zwei
           Kacheln wird eine.
         Der SPEICHERORT hat sich NICHT geaendert: beide liegen weiterhin in
         darstellung.json. Es ist die Bedienung gewandert, nicht das Feld —
         deshalb verliert keine Box, die den Schalter schon gestellt hat,
         still ihre Einstellung. -->
    <div class="karte">
      <h2>Was aus den Quellen wird</h2>
      <div class="reihe">
        <button type="button" class="wahl" [class.gewaehlt]="darst()?.verschmelzen !== false" (click)="darstUmschalten('verschmelzen')">
          Doppelte zusammenfassen {{ darst()?.verschmelzen ? 'an' : 'aus' }}
        </button>
        <button type="button" class="wahl" [class.gewaehlt]="darst()?.diskografie === true" (click)="darstUmschalten('diskografie')">
          Ganze Diskografie {{ darst()?.diskografie ? 'an' : 'aus' }}
        </button>
      </div>
      <p class="hinweis">
        <strong>Doppelte zusammenfassen</strong> macht aus demselben Album bei Jellyfin
        UND Spotify eine einzige Kachel. Aus heißt: alles bleibt, wie es war — das ist
        auch der Rückweg. WELCHE Werke dasselbe sind, entscheidest du unter „Doppelte";
        dieser Schalter macht die Zuordnungen nur scharf.
        <br />
        <strong>Ganze Diskografie</strong> holt zu jedem erkannten Interpreten seine
        Alben bei Spotify — ein Netzabruf je Interpret, deshalb abschaltbar. Wer
        freigeschaltet ist, steht unter „Interpreten".
      </p>
      @if (darstStand(); as s) {
        <p class="hinweis">{{ s }}</p>
      }

      <!-- DIE ZWEI WEGE — seit dem 03.08.2026 der einzige Zugang zu den beiden
           Seiten, denn aus der Kopfleiste sind sie raus (sie gehoeren unter
           Medien, und sechzehn Reiter nebeneinander sind keine Gliederung).
           SIE STEHEN GENAU HIER und nicht am Seitenende: die zwei Schalter
           darueber machen die Zuordnungen scharf, DIESE zwei Seiten treffen
           sie. Der Schalter ohne den Weg zur Entscheidung ist ein Hebel ohne
           Maschine. -->
      <div class="wege">
        <a class="weg" routerLink="/verschmelzung">
          <b>Doppelte →</b>
          <span>Welche Werke dasselbe sind: abgleichen, einzeln trennen, wieder zulassen.</span>
        </a>
        <a class="weg" routerLink="/interpreten">
          <b>Interpreten →</b>
          <span>Wer in der runden Reihe der Box steht: freischalten, ablehnen, zuordnen.</span>
        </a>
      </div>
    </div>

    <!-- MEDIEN NEU EINLESEN — am 03.08.2026 von der Systemseite hierher.
         KEINE BACKTICKS IN DIESEM KOMMENTAR: er steht in einem
         Template-Literal, und der erste Backtick beendet es mitten im HTML.
         Beim ersten Anlauf genau hier passiert — die Medienseite fiel von 28
         auf 4 Sucheintraege, ohne dass irgendetwas rot wurde
         (llmwiki: backticks-in-angular-vorlagen).
         WARUM DER KNOPF LEBT und nicht bloss mit umgezogen ist (die Frage
         stand ausdruecklich): scripts/mupibox/change_checker.sh ruft
         m3u_generator.sh von selbst, aber NUR wenn sich die Aenderungszeit
         eines Medienverzeichnisses innerhalb von mupibox.mediaCheckTimer
         geaendert hat. Wer Dateien per SSH oder Netzfreigabe hinlegt und die
         Zeitstempel behaelt, wartet sonst vergeblich. Es gibt keinen zweiten
         Knopf dafuer — im Gegensatz zum Aufraeumen unten, das Spotify meint.
         DIE LISTE KOMMT VOM SERVER, samt der Angabe, welche Aktion hierher
         gehoert (bereich medien). Titel und Hinweis werden NICHT hier
         nachgebaut: dann gaebe es zwei Wahrheiten, und beim ersten Umbenennen
         liefen sie auseinander. -->
    @if (medienAktionen().length > 0) {
      <div class="karte">
        <h2>Neu einlesen</h2>
        <p class="hinweis">
          Für Dateien, die direkt auf der Box liegen. Spotify und Jellyfin brauchen das
          nicht — die werden bei jeder Suche frisch gefragt.
        </p>
        @for (a of medienAktionen(); track a.id) {
          <div class="reihe">
            <button type="button" [disabled]="aktionLaeuft()" (click)="aktionAusloesen(a)">
              {{ aktionLaeuft() === a.id ? 'Läuft…' : a.titel }}
            </button>
          </div>
          <p class="hinweis">{{ a.hinweis }}</p>
        }
        <!-- DIE ANTWORT STEHT HIER und nicht in der Meldungszeile am
             Seitenende: die liegt hinter der ganzen Bibliothek, gemessen 875
             px unter diesem Knopf, und wird ausserdem beim Nachladen
             ueberschrieben. Ein Knopf, dessen Antwort man suchen muss, hat
             keine. -->
        @if (aktionMeldung()) {
          <p class="hinweis">{{ aktionMeldung() }}</p>
        }
      </div>
    }

    <div class="karte">
      <h2 id="anker-dienste">Suchen und aufnehmen</h2>
      <div class="reihe">
        <input
          type="search"
          placeholder="Album, Interpret, Hörspiel …"
          [(ngModel)]="suchtext"
          (keydown.enter)="suchen()"
        />
        <select [(ngModel)]="suchart" title="Wonach gesucht wird">
          <option value="alle">Alben, Listen, Hörbücher</option>
          <option value="album">nur Alben</option>
          <option value="playlist">nur Listen</option>
          <option value="show">nur Hörbücher und Sendungen</option>
          <option value="titel">einzelne Titel</option>
          <option value="interpret">Interpret — seine Alben</option>
        </select>
        <select [(ngModel)]="suchdienst">
          <option value="alle">alle Dienste</option>
          <option value="spotify">nur Spotify</option>
          <option value="jellyfin">nur Jellyfin</option>
          <option value="ard">nur ARD Sounds</option>
        </select>
        <button class="wichtig" (click)="suchen()" [disabled]="sucht()">
          {{ sucht() ? 'sucht …' : 'Suchen' }}
        </button>
      </div>

      @for (h of suchHinweise(); track h) {
        <p class="hinweis warn">{{ h }}</p>
      }

      <div class="zweispaltig">
        <div class="links">
      @if (treffer().length) {
        <ul>
          @for (t of gezeigt(); track t.schluessel) {
            <li>
              <img class="cover" [src]="t.cover || ''" alt="" />
              <span class="wer">
                @if (t.schonDa) {
                  <b>{{ t.title }}</b>
                } @else {
                  <input
                    class="titel"
                    type="text"
                    [value]="t.title"
                    (input)="trefferName(t, $event)"
                    title="Name, unter dem es auf der Box erscheinen soll"
                  />
                }
                @if (t.schonDa) {
                  <span>{{ t.artist }}</span>
                } @else {
                  <input
                    class="interpret"
                    type="text"
                    [value]="t.artist"
                    (input)="trefferInterpret(t, $event)"
                    placeholder="Interpret"
                    title="Interpret, wie er auf der Box stehen soll"
                  />
                }
                <span>
                  @if (t.album) { aus „{{ t.album }}" }
                  @if (t.besitzer && t.besitzer !== t.artist) { Liste von {{ t.besitzer }} }
                  @if (t.titelAnzahl) { · {{ t.titelAnzahl }} Titel }
                  @if (t.dauerMs) { · {{ dauer(t.dauerMs) }} }
                </span>
              </span>
              <!-- DIE KLASSE KOMMT AUS DEM DIENSTNAMEN, statt je Dienst eine
                   eigene Bindung zu bekommen. Vorher stand hier
                   [class.spotify] + [class.jellyfin]; ein dritter Dienst
                   waere still farblos geblieben, und das sieht aus wie
                   Absicht. -->
              <span [class]="'marke ' + t.dienst">
                {{ t.dienst }} · {{ artName(t.art, t.dienst) }}
              </span>
              @if (aktuelleListe()) {
                <button class="inliste" (click)="inListe(t)"
                        [title]="(t.nurFuerListe ? 'Diesen Titel in die Liste legen: ' : 'Alle Titel dieses Albums in die Liste legen: ') + aktuelleListe()!.name">
                  {{ t.nurFuerListe ? '＋ Titel' : '＋ alle Titel' }} → {{ kurz(aktuelleListe()!.name) }}
                </button>
              }
              @if (t.nurFuerListe) {
                <span class="marke">für eigene Liste</span>
              } @else {
                @if (!t.schonDa) {
                  <select [(ngModel)]="neueKategorie">
                    @for (k of kategorien(); track k) {
                      <option [value]="k">{{ katName(k) }}</option>
                    }
                  </select>
                }
                <!-- Bei einem Doppeltreffer stehen hier BEIDE Quellen: was aus
                     Spotify kommt, braucht Netz; was aus Jellyfin kommt,
                     gehört dir. Deshalb ist die Wahl wichtig und nicht
                     vorweggenommen. -->
                @for (q of quellenVon(t); track q.schluessel) {
                  @if (q.schonDa) {
                    <span [class]="'marke ' + q.dienst">
                      {{ q.dienst }} ✓
                    </span>
                  } @else {
                    <button (click)="aufnehmen(q)" [title]="'Aus ' + q.dienst + ' aufnehmen'">
                      @if (quellenVon(t).length > 1) { aus {{ q.dienst }} } @else { Aufnehmen }
                    </button>
                  }
                }
                @if (quellenVon(t).length > 1 && offeneQuellen(t).length > 1) {
                  <!-- „alle" und nicht mehr „beide": seit die ARD im selben Topf
                       sucht, koennen es DREI Quellen sein (04.08.2026). Ein Knopf,
                       der „beide" sagt und drei aufnimmt, ist eine kleine Luege an
                       genau der Stelle, an der jemand entscheidet. -->
                  <button class="wichtig" (click)="alleAufnehmen(t)">alle</button>
                }
              }
            </li>
          }
        </ul>
      } @else if (gesucht()) {
        <p class="leer">Nichts gefunden.</p>
      }
        </div>

        <!-- Der Baukasten: eine eigene Liste der Box, in die ein Klick den
             Titel legt. Sie darf Titel VERSCHIEDENER Dienste enthalten - das
             geht nur lokal, eine Spotify-Playlist kann nur Spotify. -->
        <aside class="rechts">
          <h3>Eigene Liste</h3>
          <p class="hinweis">
            Titel und Alben aus den Treffern sammeln — auch quer über Spotify, Jellyfin
            und lokal.
          </p>
          <div class="reihe">
            <select [ngModel]="neueListe() ? '__neu' : listeId()" (ngModelChange)="listeWaehlen($event)">
              <option value="">— Liste wählen —</option>
              @for (l of listen(); track l.id) {
                <option [value]="l.id">{{ l.name }} ({{ l.titel.length }})</option>
              }
              <option value="__neu">＋ neue Liste anlegen …</option>
            </select>
          </div>
          @if (neueListe()) {
            <div class="reihe">
              <input
                type="text"
                placeholder="Name der neuen Liste"
                [(ngModel)]="neuerName"
                (keydown.enter)="listeAnlegen()"
                (keydown.escape)="neueListe.set(false)"
                autofocus
              />
              <button class="wichtig" (click)="listeAnlegen()" [disabled]="!neuerName.trim()">Anlegen</button>
              <button (click)="neueListe.set(false)">Abbrechen</button>
            </div>
          }

          @if (aktuelleListe(); as l) {
            <p class="hinweis">
              {{ l.titel.length }} Titel · Klick auf „＋" beim Treffer legt ihn hier ab.
            </p>
            @if (l.titel.length) {
              <ol class="titelliste">
                @for (x of l.titel; track $index) {
                  <li>
                    <span class="q" [class.spotify]="x.quelle === 'spotify'" [class.jellyfin]="x.quelle === 'jellyfin'">
                      {{ x.quelle }}
                    </span>
                    <span class="wer">
                      <b>{{ x.title }}</b>
                      <span>{{ x.artist }}</span>
                    </span>
                    <button class="weg" (click)="titelRaus(l, $index)" title="Aus der Liste nehmen">×</button>
                  </li>
                }
              </ol>
            } @else {
              <p class="leer">Noch leer.</p>
            }
            <div class="reihe">
              <button class="gefahr" (click)="listeLoeschen(l)">
                {{ fragt() === 'liste:' + l.id ? 'wirklich löschen?' : 'Liste löschen' }}
              </button>
            </div>
            <p class="hinweis warn">
              Eigene Listen erscheinen noch NICHT auf der Box — die Wiedergabe gemischter
              Listen ist der nächste Schritt. Sammeln kannst du sie schon.
            </p>
          } @else {
            <p class="leer">Wähle eine Liste oder lege eine neue an, dann kannst du Titel hineinlegen.</p>
          }
        </aside>
      </div>
    </div>

    <!--
      Die dritte Karte: was bei Spotify nicht mehr existiert.

      „BEI SPOTIFY" STEHT NICHT ZUR ZIERDE IN DER ÜBERSCHRIFT. Geprüft werden
      nur Spotify-Einträge; ein bei Jellyfin gelöschtes Album oder eine
      verschwundene lokale Datei taucht hier nie auf. Eine Karte mit dem Titel
      „Nicht mehr vorhanden" würde Vollständigkeit vortäuschen.

      SIE VERSCHWINDET AUCH NICHT, wenn nichts vermisst wird — sonst weiß
      niemand, dass überhaupt geprüft wird.
    -->
    <div class="karte">
      <h2>Bei Spotify nicht mehr vorhanden ({{ vorschlaege().length }})</h2>
      <div class="reihe">
        <span class="marke">{{ standText() }}</span>
        @if (verfGeprueft()) {
          <span class="marke">{{ verfGeprueft() }} Spotify-Einträge geprüft</span>
        }
        <button (click)="jetztPruefen()" [disabled]="verfLaeuft()">
          {{ verfLaeuft() ? 'prüft …' : 'jetzt prüfen' }}
        </button>
      </div>

      @if (verfGrund()) {
        <p class="hinweis" [class.warn]="!verfTaugte()">{{ verfGrund() }}</p>
      }

      @if (vorschlaege().length) {
        <ul>
          @for (v of vorschlaege(); track v.schluessel) {
            <li>
              <input
                type="checkbox"
                [checked]="!abgewaehlt().has(v.schluessel)"
                (change)="auswahlUmschalten(v)"
                [disabled]="!!v.doppelt"
                [title]="'„' + v.titel + '“ entfernen'"
              />
              <img class="cover" [src]="v.cover || ''" alt="" />
              <span class="wer">
                <b>{{ v.titel || '(ohne Titel)' }}</b>
                <span>{{ v.interpret }}</span>
              </span>
              <span class="marke spotify">Spotify · {{ artName2(v.art) }}</span>
              <span class="marke" [title]="'Kennung ' + v.kennung">
                seit {{ seitText(v.seit) }}, {{ v.laeufe }}× bestätigt
              </span>
              @if (v.doppelt) {
                <span class="marke warn" title="Zwei Einträge tragen denselben Schlüssel">
                  doppelter Schlüssel — von Hand entfernen
                </span>
              }
              <button
                (click)="andereSuchenSchluessel(v.schluessel)"
                [disabled]="pruefe() === v.schluessel"
                title="Statt zu entfernen: gibt es das Werk in einem anderen Dienst?"
              >
                {{ pruefe() === v.schluessel ? 'sucht …' : 'andere Dienste?' }}
              </button>
              @if (angebote()[v.schluessel]; as a) {
                @for (q of a; track q.schluessel) {
                  <button class="wichtig" (click)="aufnehmen(q)" [title]="q.title + ' — ' + q.artist">
                    + aus {{ q.dienst }}
                  </button>
                }
                @if (!a.length) {
                  <span class="marke">nirgends sonst</span>
                }
              }
            </li>
          }
        </ul>
        <div class="reihe" style="margin-top: 0.9rem">
          <button class="gefahr" (click)="aufraeumen()" [disabled]="raeumtAuf() || !gewaehlte().length">
            {{
              raeumtAuf()
                ? 'entfernt …'
                : fragt() === 'aufraeumen'
                  ? 'wirklich ' + stueck(gewaehlte().length) + ' entfernen?'
                  : stueck(gewaehlte().length) + ' entfernen'
            }}
          </button>
          <span class="hinweis">
            Vorher wird eine Sicherung der Bibliothek angelegt — sie liegt als Datei neben
            <code>data.json</code> auf der Box.
          </span>
        </div>
      } @else {
        <p class="leer">
          Nichts vermisst. Angeboten wird ein Eintrag erst, wenn Spotify ihn in drei Prüfungen
          hintereinander und über mehr als einen Tag hinweg nicht mehr kennt — ein Netzausfall
          oder eine Drosselung zählen dabei nicht mit.
        </p>
      }

      @if (aufraeumMeldung()) {
        <p class="hinweis">
          {{ aufraeumMeldung() }}
          @if (rueckSicherung()) {
            <button (click)="rueckgaengig()" [disabled]="raeumtAuf()">rückgängig</button>
          }
        </p>
      }
    </div>

    <div class="karte">
      <!-- ══ AUFNAHMEN — DIE LAGE DES MITSCHNITTS (Betreiber: „mir fehlt noch
           die verwaltung sowie anstoßen ... ggf direkt an den alben zum
           klicken"). Diese Karte fuehrt kein eigenes Buch - sie fragt beim
           Mitschnitt-Plugin (mixpi-mitschnitt, http/liste) nach, was es an
           Titeln offen, fertig oder mit Fehler hat. GEHOLT WIRD ERST BEIM
           AUFKLAPPEN, nicht beim Oeffnen der Seite - dieselbe Zurueckhaltung
           wie bei den ARD-Regalen darunter: ein Ruf an ein Plugin, das aus
           sein kann, gehoert nicht in den Seitenaufbau. LIEFERT DIE ROUTE
           404 ODER EINEN FEHLER (Plugin aus oder eine aeltere Fassung, die
           die Auskunft noch nicht kennt), bleibt es bei einem ruhigen
           Hinweis - kein Fehlerrot, denn das ist ein gewoehnlicher
           Betriebszustand und kein Defekt dieser Seite. -->
      <h2>Aufnahmen</h2>
      <details (toggle)="aufnahmenAufklappen($any($event.target).open)">
        <summary>
          @if (aufnahmenZahl(); as z) {
            {{ z.offen }} offen · {{ z.fertig }} fertig · {{ z.fehler }} mit Fehler
          } @else {
            Aufnahme-Lage ansehen
          }
        </summary>
        <div class="reihe" style="margin-top: 0.6rem">
          <button (click)="aufnahmenHolen()" [disabled]="aufnahmenLaedt()">
            {{ aufnahmenLaedt() ? 'holt …' : 'Liste holen' }}
          </button>
        </div>
        @if (aufnahmenHinweis()) {
          <p class="hinweis">{{ aufnahmenHinweis() }}</p>
        } @else if (aufnahmenListe().length) {
          <ul>
            @for (a of aufnahmenListe(); track a.uri) {
              <li>
                <span class="wer">
                  <b>{{ a.name }}</b>
                  <span>{{ a.interpret }}</span>
                </span>
                <span class="marke">{{ aufnahmeStandWort(a.stand) }}</span>
                @if (a.stand === 'fehler' && a.wort) {
                  <span class="hinweis warn">{{ a.wort }}</span>
                }
              </li>
            }
          </ul>
        } @else if (aufnahmenGeholt()) {
          <p class="leer">Nichts vorgemerkt.</p>
        }
      </details>
    </div>

    <div class="karte">
      <!-- ══ DIE REGALE DER ARD (E38, 15.08.2026) ══════════════════════════
           Betreiber: „oder gibt es kategorien" — es gibt achtzehn, und sie
           sind von der ARD GEPFLEGT statt von uns am Titel geraten. Dann:
           „vielleicht gibt es ja auch ein erwachsenen profil wenn die kinder
           im kindergarten sind oder schule". Diese Seite IST der
           Elternbereich, hinter dem Passwort — wer hier steht, bekommt alle
           Regale. Gesperrt wird nichts, aber gekennzeichnet schon. -->
      <h2 id="anker-regale">Regale von ARD Sounds</h2>
      <p class="hinweis">
        Von der ARD zusammengestellt. „Für Kinder" ist das einzige, das ohne
        Nachdenken auf eine Kinderbox darf — die anderen sind für die Stunden,
        in denen die Kinder aus dem Haus sind.
      </p>
      <div class="reihe">
        <!-- ERST AUF KNOPFDRUCK: ARD Sounds wird nicht bei jedem Aufruf der
             Medien-Seite befragt — die Seite soll sofort da sein, auch wenn
             das Netz gerade klemmt. -->
        @if (!regale().length) {
          <button (click)="regaleHolen()" [disabled]="kinderLaedt()">
            {{ kinderLaedt() ? 'lädt …' : 'Regale öffnen' }}
          </button>
        }
        @if (regale().length) {
        <label>
          Regal
          <select [value]="regal()" (change)="regalWechseln($any($event.target).value)">
            @for (k of regale(); track k.id) {
              <option [value]="k.id">{{ k.titel }}{{ k.fuerKinder ? ' — für Kinder' : '' }}</option>
            }
          </select>
        </label>
        <button (click)="kinderregalHolen()" [disabled]="kinderLaedt()">neu laden</button>
        }
        @if (kinder().length) {
          <span class="marke">{{ gefilterteSendungen().length }} von {{ kinder().length }}</span>
        }
        @if (kinderLaedt()) {
          <span class="marke">lädt …</span>
        }
      </div>
      @if (kinder().length && !regalFuerKinder()) {
        <!-- KEINE SPERRE, EIN HINWEIS: der Erwachsene entscheidet, aber er
             soll es nicht aus Versehen tun. -->
        <p class="warnung">
          Dieses Regal ist nicht für Kinder ausgewählt. Was hier steht, landet
          auf derselben Box wie die Kindersendungen.
        </p>
      }
      @if (kinder().length > 12) {
        <div class="reihe">
          <input
            type="search"
            placeholder="im Regal suchen …"
            [value]="regalSuche()"
            (input)="regalSuche.set($any($event.target).value)"
          />
        </div>
      }
      @if (gefilterteSendungen().length) {
        <ul class="sammlungen">
          @for (s of gefilterteSendungen(); track s.kennung) {
            <li>
              <span class="wer">
                <b>{{ s.titel }}</b>
                <span class="hinweis">{{ s.herausgeber }}{{ s.text ? ' · ' + s.text : '' }}</span>
              </span>
              @if (s.schonDa) {
                <span class="marke">schon da</span>
              } @else {
                <button class="wichtig" (click)="kinderAufnehmen(s)" [disabled]="nimmt() === s.kennung">
                  {{ nimmt() === s.kennung ? 'nimmt …' : 'Aufnehmen' }}
                </button>
              }
            </li>
          }
        </ul>
      } @else if (kinder().length) {
        <p class="hinweis">Nichts im Regal passt zu „{{ regalSuche() }}".</p>
      }
    </div>

    <div class="karte">
      <!-- ══ SAMMLUNGEN DER ARD, NACH ALTER (E38, 15.08.2026) ══════════════
           Betreiber: „ich würde gerne im profil das geburtsdatum angeben und
           basierend darauf die ard sammlungen anzeigen." Das Alter kommt vom
           aktiven Profil; die passenden stehen oben, die anderen bleiben
           sichtbar — der Erwachsene soll wählen, nicht bevormundet werden. -->
      <h2>Sammlungen von ARD Sounds</h2>
      <div class="reihe">
        <!-- FUER WEN? (Betreiber 15.08.2026: „unter medien sollte man das
             profil auswählen können") Ein Erwachsener sucht am Browser für
             Anna aus, während an der Box gerade Ben hört — das aktive Profil
             wäre dann die falsche Antwort. -->
        @if (profile().length > 1) {
          <label class="schalter">
            für
            <select [value]="fuerProfil()" (change)="fuerProfilWaehlen($any($event.target).value)">
              @for (p of profile(); track p.kennung) {
                <option [value]="p.kennung" [selected]="fuerProfil() === p.kennung">
                  {{ p.name }}{{ p.geburtstag ? '' : ' (ohne Geburtstag)' }}
                </option>
              }
            </select>
          </label>
        }
        <button (click)="sammlungenHolen()" [disabled]="sammlungenLaden()">
          {{ sammlungenLaden() ? 'lädt …' : (sammlungen().length ? 'neu laden' : 'Sammlungen zeigen') }}
        </button>
        @if (sammlungAlter() !== null) {
          <span class="marke">passend für {{ sammlungAlter() }} Jahre</span>
        } @else if (sammlungen().length) {
          <span class="marke">kein Geburtstag eingetragen — es wird nichts ausgeblendet</span>
        }
        <!-- WAS NICHT GEZEIGT WIRD, GEHOERT GESAGT: eine Liste, die still von
             323 auf ein Dutzend schrumpft, sieht aus wie eine kaputte
             Schnittstelle. Und der Erwachsene behaelt das letzte Wort. -->
        @if (sammlungGefiltert()) {
          <label class="schalter" title="Auch Sammlungen zeigen, die erkennbar nicht für Kinder sind">
            <input type="checkbox" [checked]="alleSammlungen()" (change)="alleSammlungenUmschalten($any($event.target).checked)" />
            auch die übrigen ({{ sammlungGesamt() }} insgesamt)
          </label>
        }
      </div>
      @if (sammlungen().length) {
        <ul class="sammlungen">
          @for (s of sammlungen(); track s.id) {
            <li [class.passt]="s.passt">
              <span class="wer">
                <b>{{ s.titel }}</b>
                <span class="hinweis">
                  {{ s.anzahl }} Beiträge
                  @if (s.fenster) {
                    · {{ s.fenster.bis ? s.fenster.von + ' bis ' + s.fenster.bis + ' Jahre' : 'ab ' + s.fenster.von + ' Jahren' }}
                  }
                </span>
              </span>
              <button (click)="sammlungOeffnen(s)" [disabled]="oeffnet() === s.id">
                {{ oeffnet() === s.id ? 'lädt …' : (offeneSammlung() === s.id ? 'zuklappen' : 'ansehen') }}
              </button>
            </li>
            @if (offeneSammlung() === s.id) {
              @for (x of sammlungInhalt(); track x.id) {
                <li class="darin">
                  <span class="wer">
                    {{ x.titel }}
                    <span class="hinweis">{{ x.text }}</span>
                  </span>
                  @if (x.schonDa) {
                    <span class="marke">schon da</span>
                  } @else {
                    <button class="wichtig" (click)="sendungAufnehmen(x)" [disabled]="nimmt() === x.id">
                      {{ nimmt() === x.id ? 'nimmt …' : 'Aufnehmen' }}
                    </button>
                  }
                </li>
              }
            }
          }
        </ul>
      }

      <!-- ══ RADIOSENDER DER ARD (E84, 22.08.2026) ════════════════════════
           Betreiber: „aus ard sounds können auch radiosender abgerufen
           werden". Sie kommen aus einem EIGENEN Einstieg der Audiothek
           (permanentLivestreams, 195 Stück) — die Sperre gegen Livestreams in
           Folgenlisten bleibt davon unberührt, und das soll sie auch.

           EIN SENDER WIRD ALS "radio" AUFGENOMMEN, nicht als "ard": artVon()
           bildet den Dienst "ard" unbedingt auf "show" ab, also auf „eine
           Folge nach der anderen" — und das ist ein Sender nie. Der Eintrag
           kommt deshalb fertig aus dem Plugin (Feld "vorschlag"), statt hier
           ein zweites Mal gebaut zu werden.

           KEINE BACKTICKS IN DIESEM KOMMENTAR: er steht INNERHALB des
           Template-Literals, und ein Backtick beendet es — die Datei reisst
           ab, und tsc meldet Folgefehler weit hinter der Ursache.

           SUCHFELD STATT KINDERLISTE, und zwar aus zwei Gründen. Der eine:
           von 195 Sendern sind zwei ausdrücklich für Kinder gemacht („Die
           Maus – Dein Radio", MDR TWEENS) — eine kuratierte Auswahl von zwei
           Einträgen wäre eine Behauptung mit kurzer Haltbarkeit. Der andere,
           und der wiegt schwerer (Betreiber, 22.08.2026): „die box ist auch
           für große Kinder" — an ihr hören Erwachsene mit, und für die sind
           die übrigen 193 kein Beifang, sondern der eigentliche Bestand.
           Hier wird deshalb nichts ausgeblendet. -->
      <h2 id="anker-sender">Radiosender von ARD Sounds</h2>
      <div class="reihe">
        <button (click)="senderHolen()" [disabled]="senderLaden()">
          {{ senderLaden() ? 'lädt …' : (senderGesamt() ? 'neu laden' : 'Sender zeigen') }}
        </button>
        @if (senderGesamt()) {
          <label class="schalter">
            suchen
            <input type="search" [value]="senderSuche()" placeholder="z. B. Maus, WDR, Kultur"
                   (input)="senderSuchen($any($event.target).value)" />
          </label>
          <span class="marke">{{ sender().length }} von {{ senderGesamt() }}</span>
        }
      </div>
      @if (sender().length) {
        <ul class="sammlungen">
          @for (s of sender(); track s.kennung) {
            <li>
              <span class="wer">
                <b>{{ s.titel }}</b>
                <span class="hinweis">{{ s.herausgeber }} · läuft, bis jemand aufhört</span>
              </span>
              <button (click)="senderAufnehmen(s)" [disabled]="s.schonDa || nimmt() === s.kennung">
                {{ s.schonDa ? 'schon da' : (nimmt() === s.kennung ? 'nimmt …' : 'aufnehmen') }}
              </button>
            </li>
          }
        </ul>
      } @else if (senderGesamt()) {
        <p class="hinweis">Kein Sender passt zu „{{ senderSuche() }}".</p>
      }

      <!-- ══ DIE STECKLEISTE DER MEDIEN-SEKTION (05.09.2026) ══════════════
           Betreiber: „es gibt das plugin internet archive aber es ist nicht
           nutzbar, wir müssen es zu medien verdrahten."

           WAS GEFEHLT HAT, war nicht das Suchen — das steht seit E88
           darunter — sondern der ORT. Das Manifest von mixpi-archive meldet
           sich seit dem ersten Tag unter "sektion": "medien" an, und
           mixpi-plugin-abschnitt hing im ganzen Baum an genau EINER Stelle:
           in seiten/streaming.ts. Damit war "medien" ein Wert, den der Wirt
           annimmt und den niemand einlöst: kein Icon, kein Zustand, kein
           Befinden, keine angemeldete Aktion, kein Weg zu den Einstellungen.
           plugins/README.md führte die Zeile deshalb als „nirgends".

           DIE LEISTE FRAGT NICHT NACH mixpi-archive, sondern nach der
           SEKTION — die Richtung aus E77: das Plugin sagt, wohin es gehört.
           Ein zweites Medien-Plugin bekommt seinen Platz hier, ohne dass
           diese Seite es kennenlernt.

           SIE STEHT ÜBER DEM ARCHIV-KASTEN und nicht darunter: der Kasten
           sucht über das Plugin. Ist es abgeschaltet oder gescheitert, sagt
           die Suche nur „nicht erreichbar" — der Grund steht dann eine Zeile
           höher. -->
      <h2 id="anker-erweiterungen">Erweiterungen</h2>
      <mixpi-plugin-abschnitt
        [sektion]="'medien'"
        [leerHinweis]="'Kein Medien-Plugin angemeldet. Erweiterungen mit sektion medien erscheinen hier.'"
      />

      <!-- ══ INTERNET ARCHIVE (E88) ═══════════════════════════════════════
           Gemeinfreie Hörspiele und Lesungen — keine Anmeldung, kein Server
           im Haus. Der erste Anbieter, der KOMPLETT über ein Plugin läuft:
           gesucht wird in mixpi-archive, aufgenommen wird der Vorschlag, den
           es liefert, und abgespielt über den generischen Plugin-Weg (E87).

           DER VORSCHLAG WIRD DURCHGEREICHT, nicht nachgebaut. Das Plugin ist
           die eine Stelle, die weiß, wie ein Eintrag für sich selbst aussieht
           — hier ein zweites Mal "type" und "id" zusammenzusetzen hieße, die
           Form an zwei Orten zu führen. (Keine Backticks in diesem Kommentar:
           er steht INNERHALB des Template-Literals und würde es beenden.)

           ZUR LIZENZ: das Archiv hält auch Werke, die nicht gemeinfrei sind.
           Was gilt, steht am Werk und wird deshalb angezeigt — leer heißt
           „das Archiv sagt es nicht", nicht „frei". -->
      <h2 id="anker-archiv">Internet Archive</h2>
      <div class="reihe">
        <label class="schalter">
          suchen
          <input type="search" [value]="archivSuche()" placeholder="z. B. Grimm, Rübezahl, Hörspiel"
                 (keyup.enter)="archivSuchen()" (input)="archivSuche.set($any($event.target).value)" />
        </label>
        <button (click)="archivSuchen()" [disabled]="archivLaden() || !archivSuche().trim()">
          {{ archivLaden() ? 'sucht …' : 'suchen' }}
        </button>
        @if (archivGesamt()) {
          <span class="marke">{{ archivWerke().length }} von {{ archivGesamt() }} Treffern</span>
        }
      </div>
      @if (archivWerke().length) {
        <ul class="sammlungen">
          @for (w of archivWerke(); track w.kennung) {
            <li>
              <span class="wer">
                <b>{{ w.titel }}</b>
                <span class="hinweis">
                  {{ w.urheber }}@if (w.jahr) { · {{ w.jahr }} } · {{ w.abrufe }} Abrufe
                </span>
              </span>
              <button (click)="archivAufnehmen(w)" [disabled]="w.schonDa || nimmt() === w.kennung">
                {{ w.schonDa ? 'schon da' : (nimmt() === w.kennung ? 'nimmt …' : 'aufnehmen') }}
              </button>
            </li>
          }
        </ul>
      } @else if (archivGesucht() && !archivLaden()) {
        <p class="hinweis">Nichts gefunden zu „{{ archivSuche() }}".</p>
      }

      <h2 id="anker-bibliothek">In der Bibliothek ({{ gesamt() }})</h2>
      @if (auswahlProfile().length) {
        <!-- ══ SCHNELLWAHL (Betreiber 15.08.2026: „ein quick select feature
             einbauen einen namen wählen und dann nacheinander die zeilen
             wählen die aufgenommen oder abgewählt werden sollen")
             EINE FESTE AKTION statt Umschalten: beim Durchwischen soll ein
             Klick immer DASSELBE tun. Wer umschaltet, muss bei jeder Zeile
             erst lesen, in welchem Zustand sie ist — genau die Arbeit, die
             hier wegfallen soll. -->
        <div class="reihe schnellleiste" [class.an]="schnellProfil()">
          <label>
            Schnellwahl
            <select [value]="schnellProfil()" (change)="schnellStarten($any($event.target).value)">
              <option value="">aus</option>
              @for (pr of auswahlProfile(); track pr.kennung) {
                <option [value]="pr.kennung">{{ pr.name }}</option>
              }
            </select>
          </label>
          @if (schnellProfil()) {
            <label class="schalter">
              <input type="radio" name="schnellaktion" [checked]="schnellAktion() === 'an'"
                     (change)="schnellAktion.set('an')" />
              aufnehmen
            </label>
            <label class="schalter">
              <input type="radio" name="schnellaktion" [checked]="schnellAktion() === 'aus'"
                     (change)="schnellAktion.set('aus')" />
              abwählen
            </label>
            <span class="marke">{{ schnellZahl() }} geändert</span>
            <button (click)="schnellBeenden()">fertig</button>
          }
        </div>
        <p class="hinweis">
          @if (schnellProfil()) {
            Klick auf eine Zeile {{ schnellAktion() === 'an' ? 'nimmt sie für' : 'nimmt sie ' }}
            <b>{{ schnellName() }}</b>{{ schnellAktion() === 'an' ? ' auf' : ' weg' }}.
            Titel und Interpret lassen sich weiter bearbeiten — nur der Rest der Zeile schaltet.
          } @else if (alleSehenAlles()) {
            Zurzeit sieht <b>jedes Profil alles</b> — auch alles, was neu dazukommt.
            Nimmst du einem Profil ein Werk weg, bekommt es ab dann nur noch das
            ausdrücklich Angehakte. Es wird vorher gefragt.
          } @else {
            @for (pr of auswahlProfile(); track pr.kennung) {
              <span class="marke">{{ pr.name }}: {{ pr.alle ? 'sieht alles' : pr.werke.length + ' Werke' }}</span>
            }
          }
        </p>
      }
      <div class="reihe">
        <input type="search" placeholder="filtern nach Titel, Interpret, Dienst …" [(ngModel)]="filter" />
        <select [(ngModel)]="filterKategorie">
          <option value="">alle Kategorien</option>
          @for (k of kategorien(); track k) {
            <option [value]="k">{{ katName(k) }}</option>
          }
        </select>
        <label class="schalter" title="Für jeden Eintrag nachsehen, ob es ihn auch in einem anderen Dienst gibt">
          <input type="checkbox" [checked]="autoPruefen()" (change)="autoUmschalten($event)" />
          andere Dienste automatisch prüfen
        </label>
        <!-- GENERELL FUER ALLE (Betreiber 15.08.2026: „ein generelles jingle
             entfernen für alle wäre noch gut"). Die Box misst dann, was sie
             noch nicht kennt, von selbst nach — beim ersten Öffnen einer
             Sendung, im Hintergrund. -->
        <label class="schalter" title="Bei JEDER ARD-Sendung den gemeinsamen Anfangs-Jingle überspringen. Noch nicht gemessene Sendungen misst die Box beim ersten Öffnen selbst nach.">
          <input type="checkbox" [checked]="vorspannAlle()" (change)="vorspannAlleSchalten($any($event.target).checked)" />
          ARD-Jingle überall überspringen
        </label>
        @if (!autoPruefen()) {
          <button (click)="alleAndereSuchen()" [disabled]="pruefeAlle()">
            {{ pruefeAlle() ? 'prüft …' : 'jetzt alle prüfen' }}
          </button>
        } @else if (pruefeAlle()) {
          <span class="marke">prüft … {{ geprueftAnzahl() }}/{{ sichtbarGefasst().length }}</span>
        }
        @if (offeneAngebote().length && !pruefeAlle()) {
          <button class="wichtig" (click)="alleAngeboteUebernehmen()" [disabled]="uebernehme()">
            {{
              uebernehme()
                ? 'nimmt auf … ' + uebernommen() + '/' + offeneAngebote().length
                : fragt() === 'alleangebote'
                  ? 'wirklich ' + offeneAngebote().length + ' aufnehmen?'
                  : 'alle ' + offeneAngebote().length + ' Angebote übernehmen'
            }}
          </button>
        }
      </div>

      @if (sichtbar().length) {
        <ul>
          @for (e of sichtbarGefasst(); track e.schluessel) {
            <li [class.schnellziel]="schnellProfil()" (click)="schnellKlick(e.schluessel, $event)">
              <img class="cover" [src]="e.cover || ''" alt="" />
              <span class="wer">
                <input
                  class="titel"
                  type="text"
                  [value]="e.title || ''"
                  (blur)="titelSpeichern(e, $event)"
                  (keydown.enter)="titelSpeichern(e, $event)"
                  (keydown.escape)="titelVerwerfen(e, $event)"
                  title="Name auf der Box - Eingabe speichert, Esc verwirft"
                />
                <input
                  class="interpret"
                  type="text"
                  [value]="e.artist || ''"
                  (blur)="interpretSpeichern(e, $event)"
                  (keydown.enter)="interpretSpeichern(e, $event)"
                  (keydown.escape)="interpretVerwerfen(e, $event)"
                  placeholder="Interpret"
                  title="Interpret - Eingabe speichert, Esc verwirft"
                />
                <!-- „HIER FEHLT NOCH ETWAS" (E89). Gesetzt vom Mitschnitt,
                     abgeräumt am Ende eines sauberen Laufs — bleibt also
                     stehen, wenn er abgebrochen ist. Genau der Fall, der beim
                     Betreiber als „101 Meerjungfrauen spielt nicht" ankam:
                     25 Sekunden im Regal, die wie ein fertiges Album aussahen.

                     ES STEHT AN DER ZEILE, NICHT IN EINER EIGENEN LISTE —
                     wer die Bibliothek durchsieht, soll es dort finden, wo
                     das Album steht. -->
                @if (e['unvollstaendig']) {
                  <span class="marke unvollstaendig"
                        title="Der Mitschnitt wurde abgebrochen — das Album ist unvollständig. tools/mitschnitt-stummel.py nennt alle Fälle.">
                    unvollständig
                  </span>
                }
              </span>
              <!-- WER SIEHT DAS? (Betreiber 15.08.2026: „ich bin noch ein
                   bisschen unglücklich über die medien profil zuordnung")
                   Ein Häkchen je Profil — aber auf EIGENER ZEILE unter dem
                   Titel (Betreiber: „die zeilen sind gequetscht und nicht
                   übersichtlich"). In derselben Flex-Zeile stehen sie in
                   Konkurrenz zu Titel, Interpret und den Dienst-Marken; ab
                   zwei Kindern bleibt für den Titel nichts übrig. -->
              @if (auswahlProfile().length) {
              <span class="profilzeile">
                <span class="fuer">sichtbar für</span>
              @for (pr of auswahlProfile(); track pr.kennung) {
                <label
                  class="schalter profilhaken"
                  [class.offen]="pr.alle"
                  [title]="pr.alle
                    ? pr.name + ' sieht zurzeit ALLES — auch alles Neue. Wegnehmen fragt nach.'
                    : pr.name + (pr.werke.includes(e.schluessel) ? ' sieht das' : ' sieht das nicht')"
                >
                  <input
                    type="checkbox"
                    [checked]="pr.alle || pr.werke.includes(e.schluessel)"
                    [disabled]="hakenLaeuft() === pr.kennung + '|' + e.schluessel"
                    (change)="hakenUmlegen(pr, e.schluessel, $any($event.target).checked)"
                  />
                  {{ pr.name }}
                </label>
              }
              </span>
              }
              @for (q of geschwister(e); track q.schluessel) {
                <span [class]="'marke ' + dienstSchluessel(q)"
                      [title]="q.title + ' — ' + q.artist">
                  {{ dienstName(q) }} · {{ artVonEintrag(q) }}
                  @if (geschwister(e).length > 1) {
                    <button class="weg" (click)="entfernen(q)" [title]="'Nur die Fassung aus ' + dienstName(q) + ' entfernen'">×</button>
                  }
                </span>
              }
              <select [ngModel]="e.category" (ngModelChange)="kategorieSetzen(e, $event)">
                @for (k of kategorien(); track k) {
                  <option [value]="k">{{ katName(k) }}</option>
                }
              </select>
              <!-- DEN VORSPANN UEBERSPRINGEN — nur bei ARD-Sendungen, denn nur
                   dort gibt es einen, der bei allen Folgen gleich ist. Die
                   Sekunden sind GEMESSEN (Knopf daneben), nicht geraten; ohne
                   Messung uebersspringt das Haekchen nichts und sagt es. -->
              @if (istArdEintrag(e)) {
                <span class="vorspann">
                  <label [title]="vorspannHinweis(e)">
                    <input
                      type="checkbox"
                      [checked]="vorspannAn(e)"
                      [disabled]="vorspannSekunden(e) <= 0"
                      (change)="vorspannSchalten(e, $any($event.target).checked)"
                    />
                    Jingle überspringen
                    @if (vorspannSekunden(e) > 0) {
                      ({{ vorspannSekunden(e) }} s)
                    }
                  </label>
                  <button
                    [disabled]="misst() === e.schluessel"
                    (click)="vorspannMessen(e)"
                    title="Vier Folgen laden und den gemeinsamen Anfang messen — das dauert etwa eine Minute"
                  >
                    {{ misst() === e.schluessel ? 'misst …' : 'messen' }}
                  </button>
                </span>
              }
              @if (angebote()[e.schluessel]; as a) {
                @if (a.length) {
                  @for (q of a; track q.schluessel) {
                    <button
                      class="wichtig"
                      (click)="angebotAufnehmen(e, q)"
                      [title]="q.title + ' — ' + q.artist"
                    >
                      + aus {{ q.dienst }}
                    </button>
                  }
                } @else {
                  <span class="marke">nur hier</span>
                }
              } @else if (!autoPruefen()) {
                <button (click)="andereSuchen(e)" [disabled]="pruefe() === e.schluessel"
                        title="Gibt es das auch in einem anderen Dienst?">
                  {{ pruefe() === e.schluessel ? 'sucht …' : 'andere Dienste?' }}
                </button>
              }
              <!-- AUFNEHMEN (Mitschnitt) - nur bei einer Spotify-Quelle in der
                   Zeile, denn der Mitschnitt hoert nur Spotify ab. ZWEI
                   KLICKS, KEIN FENSTER (sicher(), Haus-Idiom). -->
              @if (mitschnittQuelle(e)) {
                <button
                  (click)="mitschnittAufnehmen(e)"
                  [disabled]="nimmt() === e.schluessel"
                  title="Die fehlenden Titel dieses Albums beim Mitschnitt vormerken"
                >
                  {{
                    nimmt() === e.schluessel
                      ? 'nimmt auf …'
                      : fragt() === 'mitschnitt:' + e.schluessel
                        ? (e['unvollstaendig'] ? 'wirklich neu aufnehmen?' : 'wirklich aufnehmen?')
                        : (e['unvollstaendig'] ? 'Neu aufnehmen' : 'Aufnehmen')
                  }}
                </button>
                @if (mitschnittMeldung()[e.schluessel]) {
                  <span class="hinweis mitschnitt-meldung">{{ mitschnittMeldung()[e.schluessel] }}</span>
                }
              }
              @if (geschwister(e).length === 1) {
                <button class="gefahr" (click)="entfernen(e)">
                  {{ fragt() === 'weg:' + e.schluessel ? 'wirklich?' : 'Entfernen' }}
                </button>
              } @else {
                <button class="gefahr" (click)="gruppeEntfernen(e)" title="Alle Fassungen entfernen">
                  {{ fragt() === 'gruppe:' + e.schluessel ? 'wirklich alle?' : 'alle entfernen' }}
                </button>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="leer">Kein Eintrag passt.</p>
      }
    </div>

    @if (meldung()) {
      <p class="hinweis">{{ meldung() }}</p>
    }
  `,
})
export class MedienSeite {
  private readonly http = inject(HttpClient)

  /**
   * Die zwei Schalter, die von der Darstellungsseite hierher gewandert sind.
   *
   * Sie liegen weiterhin in darstellung.json — der Dienst kapselt das
   * Lesen-Aendern-Schreiben samt seiner Begruendung.
   */
  private readonly darstellung = inject(DarstellungDienst)
  protected readonly darst = this.darstellung.schalter
  protected readonly darstStand = this.darstellung.stand

  /**
   * „Medien neu einlesen" — am 03.08.2026 von der Systemseite hierher.
   *
   * Geholt wird die GANZE Aktionsliste (/api/system) und danach gefiltert;
   * welche Aktion hierher gehoert, sagt der Server mit `bereich`. Die Kennung
   * `medien-neu` steht deshalb nirgends in dieser Datei — sonst waere die
   * Sortierung an zwei Orten entschieden.
   */
  private readonly system = inject(SystemDienst)
  protected readonly medienAktionen = signal<SystemAktion[]>([])
  protected readonly aktionLaeuft = signal('')
  /**
   * Was die Box zur letzten Aktion gesagt hat — EIGENE Zeile, eigener Ort.
   *
   * Nicht `meldung()`: die steht am Seitenende, hinter der ganzen Bibliothek,
   * und wird ausserdem von `laden()` ueberschrieben. Beides zusammen liess die
   * Antwort auf einen Knopfdruck verschwinden, bevor sie jemand lesen konnte
   * (Begruendung mit Messwerten an aktionAusloesen).
   */
  protected readonly aktionMeldung = signal('')

  protected readonly eintraege = signal<Eintrag[]>([])
  protected readonly gesamt = signal(0)
  protected readonly kategorien = signal<string[]>(['music', 'audiobook', 'other'])
  protected readonly treffer = signal<Treffer[]>([])
  protected readonly suchHinweise = signal<string[]>([])
  protected readonly sucht = signal(false)
  protected readonly gesucht = signal(false)
  protected readonly meldung = signal('')
  /** Je Eintrag: was die anderen Dienste zu bieten haben (noch nicht gefragt = fehlt). */
  protected readonly angebote = signal<Record<string, Treffer[]>>({})
  protected readonly pruefe = signal('')
  /** Welche Sendung gerade gemessen wird (Schluessel) — sonst ''. */
  protected readonly misst = signal('')
  /** Was je ARD-Sendung ueber den Vorspann bekannt ist (Server-Ablage). */
  protected readonly vorspann = signal<Record<string, { sekunden: number; an: boolean; gemessen?: number }>>({})
  /** Der GENERELLE Schalter: gilt fuer jede ARD-Sendung, auch kuenftige. */
  protected readonly vorspannAlle = signal(false)

  /* ══ SAMMLUNGEN (E38) ═══════════════════════════════════════════════════ */
  protected readonly sammlungen = signal<
    { id: string; titel: string; anzahl: number; fenster: { von: number; bis: number | null } | null; passt: boolean }[]
  >([])
  protected readonly sammlungAlter = signal<number | null>(null)
  protected readonly sammlungenLaden = signal(false)
  protected readonly offeneSammlung = signal('')
  protected readonly oeffnet = signal('')
  protected readonly nimmt = signal('')
  protected readonly sammlungInhalt = signal<{ id: string; titel: string; text: string; schonDa: boolean }[]>([])
  protected readonly sammlungGefiltert = signal(false)
  protected readonly sammlungGesamt = signal(0)
  protected readonly alleSammlungen = signal(false)

  protected async alleSammlungenUmschalten(an: boolean): Promise<void> {
    this.alleSammlungen.set(an)
    await this.sammlungenHolen()
  }

  /* ══ RADIOSENDER (E84) ══════════════════════════════════════════════════ */
  protected readonly senderAlle = signal<SenderZeile[]>([])
  protected readonly senderSuche = signal('')
  protected readonly senderLaden = signal(false)
  protected readonly senderGesamt = signal(0)

  /** GESIEBT WIRD HIER, nicht je Tastendruck am Netz: 195 Sätze liegen schon. */
  protected readonly sender = computed(() => {
    const suche = this.senderSuche().trim().toLowerCase()
    const alle = this.senderAlle()
    if (!suche) return alle
    return alle.filter((s) => `${s.titel} ${s.herausgeber}`.toLowerCase().includes(suche))
  })

  protected senderSuchen(text: string): void {
    this.senderSuche.set(text)
  }

  protected async senderHolen(): Promise<void> {
    this.senderLaden.set(true)
    try {
      const d = await firstValueFrom(
        this.http.get<{ gesamt: number; sender: SenderRoh[] }>('/api/plugins/mixpi-ardsounds/http/sender'),
      )
      const liste = d.sender ?? []
      this.senderGesamt.set(d.gesamt ?? liste.length)
      this.senderAlle.set(liste.map((s) => ({ ...s, schonDa: this.senderSchonDa(s.vorschlag.id) })))
      if (!liste.length) this.meldung.set('ARD Sounds nennt gerade keine Sender.')
    } catch {
      this.meldung.set('Die Sender von ARD Sounds sind gerade nicht erreichbar.')
    } finally {
      this.senderLaden.set(false)
    }
  }

  /** Ein Radioeintrag traegt seine Adresse in `id` — daran ist er zu erkennen. */
  private senderSchonDa(adresse: string): boolean {
    return this.eintraege().some((e) => String(e['id'] ?? '') === adresse)
  }

  /**
   * DER VORSCHLAG WIRD DURCHGEREICHT, nicht nachgebaut.
   *
   * Nebenan baut `sendungAufnehmen()` den data.json-Eintrag von Hand — das ist
   * eine zweite Stelle derselben Form, und der Kopf von `senderVorschlagAus()`
   * im Plugin sagt ausdruecklich, dass es die EINE sein soll. Fuer die Sender
   * wird deshalb genommen, was das Plugin liefert.
   */
  protected async senderAufnehmen(s: SenderZeile): Promise<void> {
    this.nimmt.set(s.kennung)
    try {
      await firstValueFrom(this.http.post('/api/medien', s.vorschlag))
      this.senderAlle.update((l) => l.map((e) => (e.kennung === s.kennung ? { ...e, schonDa: true } : e)))
      await this.laden()
    } catch {
      this.meldung.set(`„${s.titel}" ließ sich nicht aufnehmen.`)
    } finally {
      this.nimmt.set('')
    }
  }

  /* ══ INTERNET ARCHIVE (E88) ═══════════════════════════════════════════ */
  protected readonly archivWerke = signal<ArchivZeile[]>([])
  protected readonly archivSuche = signal('')
  protected readonly archivLaden = signal(false)
  protected readonly archivGesamt = signal(0)
  /** Wurde ueberhaupt schon gesucht? Sonst saehe „nichts gefunden" wie ein Fehler aus. */
  protected readonly archivGesucht = signal(false)

  /**
   * GESUCHT WIRD AM NETZ, nicht in einer geholten Liste.
   *
   * Anders als bei den ARD-Sendern, wo 195 Saetze einmal geholt und danach
   * oertlich gesiebt werden: das Archiv hat Millionen Werke, eine
   * Vorratsliste gibt es nicht. Deshalb ein Knopf und die Eingabetaste —
   * und KEIN Suchen bei jedem Tastendruck, das waere eine Anfrage je
   * Buchstabe an eine fremde Schnittstelle.
   */
  protected async archivSuchen(): Promise<void> {
    const wort = this.archivSuche().trim()
    if (!wort) return
    this.archivLaden.set(true)
    try {
      const d = await firstValueFrom(
        this.http.get<{ gesamt: number; werke: ArchivRoh[] }>(
          `/api/plugins/mixpi-archive/http/suche?q=${encodeURIComponent(wort)}`,
        ),
      )
      const liste = d.werke ?? []
      this.archivGesamt.set(d.gesamt ?? liste.length)
      this.archivWerke.set(liste.map((w) => ({ ...w, schonDa: this.archivSchonDa(w.vorschlag.id) })))
    } catch {
      this.archivWerke.set([])
      this.archivGesamt.set(0)
      this.meldung.set('Das Internet Archive ist gerade nicht erreichbar.')
    } finally {
      this.archivGesucht.set(true)
      this.archivLaden.set(false)
    }
  }

  /**
   * Steht das Werk schon in der Bibliothek?
   *
   * VERGLICHEN WIRD DIE `id`, also die volle Plugin-Medienkennung — nicht der
   * Titel. Zwei Aufnahmen desselben Stuecks tragen im Archiv oft denselben
   * Titel und sind trotzdem verschiedene Werke.
   */
  private archivSchonDa(medienKennung: string): boolean {
    return this.eintraege().some((e) => String(e['type'] ?? '') === 'plugin' && String(e['id'] ?? '') === medienKennung)
  }

  /**
   * DER VORSCHLAG WIRD DURCHGEREICHT, nicht nachgebaut — wie bei den Sendern.
   * Das Plugin ist die eine Stelle, die weiss, wie ein Eintrag fuer es selbst
   * aussieht.
   */
  protected async archivAufnehmen(w: ArchivZeile): Promise<void> {
    this.nimmt.set(w.kennung)
    try {
      await firstValueFrom(this.http.post('/api/medien', w.vorschlag))
      this.archivWerke.update((l) => l.map((e) => (e.kennung === w.kennung ? { ...e, schonDa: true } : e)))
      await this.laden()
    } catch {
      this.meldung.set(`„${w.titel}" ließ sich nicht aufnehmen.`)
    } finally {
      this.nimmt.set('')
    }
  }

  /** Die Kinder — nur fuer die Wahl „fuer wen". */
  protected readonly profile = signal<{ kennung: string; name: string; geburtstag?: string }[]>([])
  protected readonly fuerProfil = signal('')

  protected async fuerProfilWaehlen(kennung: string): Promise<void> {
    this.fuerProfil.set(kennung)
    // SOFORT NEU HOLEN: eine Wahl, nach der man noch einen Knopf druecken
    // muss, sieht aus, als haette sie nicht gewirkt.
    if (this.sammlungen().length) await this.sammlungenHolen()
  }

  private async profileHolen(): Promise<void> {
    try {
      const d = await firstValueFrom(
        this.http.get<{ profile: { kennung: string; name: string; geburtstag?: string }[]; aktiv: string }>(
          '/api/profile',
        ),
      )
      this.profile.set(d.profile ?? [])
      if (!this.fuerProfil()) this.fuerProfil.set(d.aktiv || d.profile?.[0]?.kennung || '')
    } catch {
      /* ohne Profile faellt die Wahl weg — die Sammlungen gehen trotzdem */
    }
  }

  protected async sammlungenHolen(): Promise<void> {
    this.sammlungenLaden.set(true)
    this.meldung.set('')
    if (!this.profile().length) await this.profileHolen()
    try {
      const d = await firstValueFrom(
        this.http.get<{
          alter: number | null
          gefiltert?: boolean
          gesamt?: number
          sammlungen: {
            id: string
            titel: string
            anzahl: number
            fenster: { von: number; bis: number | null } | null
            passt: boolean
          }[]
        }>('/api/ard/sammlungen', {
          params: {
            ...(this.fuerProfil() ? { profil: this.fuerProfil() } : {}),
            ...(this.alleSammlungen() ? { alle: '1' } : {}),
          },
        }),
      )
      this.sammlungen.set(d.sammlungen ?? [])
      this.sammlungAlter.set(d.alter ?? null)
      this.sammlungGefiltert.set(d.gefiltert === true || this.alleSammlungen())
      this.sammlungGesamt.set(d.gesamt ?? 0)
      if (!d.sammlungen?.length) this.meldung.set('ARD Sounds hat gerade keine Sammlungen geliefert.')
    } catch {
      this.meldung.set('Die Sammlungen ließen sich nicht laden.')
    } finally {
      this.sammlungenLaden.set(false)
    }
  }

  /**
   * Steht diese ARD-Sendung schon in der Bibliothek? — aus den EIGENEN
   * Eintraegen gerechnet (E79). Vorher kam `schonDa` vom Server mit, der
   * dafuer die Medienliste las; seit die Browse-Auskuenfte aus dem Plugin
   * kommen, rechnet die Seite es selbst — sie hat die Liste ohnehin.
   */
  protected ardSchonDa(kennung: string): boolean {
    return this.eintraege().some((e) => String(e['type'] ?? '').startsWith('ard') && String(e['id']) === kennung)
  }

  protected async sammlungOeffnen(s: { id: string }): Promise<void> {
    if (this.offeneSammlung() === s.id) {
      this.offeneSammlung.set('')
      this.sammlungInhalt.set([])
      return
    }
    this.oeffnet.set(s.id)
    try {
      // SEIT E79 DIREKT AN DAS PLUGIN — die Kernroute ist gefallen. `schonDa`
      // rechnet DIESE Seite aus ihren eigenen Eintraegen: die Bibliothek
      // wohnt hier, ein Plugin hat sie nichts anzugehen.
      const d = await firstValueFrom(
        this.http.get<{ sendungen: { id: string; titel: string; text: string }[] }>(
          `/api/plugins/mixpi-ardsounds/http/sammlung/${encodeURIComponent(s.id)}`,
        ),
      )
      this.sammlungInhalt.set((d.sendungen ?? []).map((x) => ({ ...x, schonDa: this.ardSchonDa(x.id) })))
      this.offeneSammlung.set(s.id)
    } catch {
      this.meldung.set('Diese Sammlung ließ sich nicht öffnen.')
    } finally {
      this.oeffnet.set('')
    }
  }

  /**
   * Eine Sendung aus der Sammlung aufnehmen — ueber den VORHANDENEN Weg.
   *
   * Kein eigener Aufnahme-Pfad: die Suche legt ARD-Sendungen schon an
   * (`/api/medien` mit einem Treffer), und ein zweiter Weg waere eine zweite
   * Stelle, an der derselbe Fehler zu reparieren waere.
   */
  // ══ WER SIEHT WAS ═════════════════════════════════════════════════════════
  // Betreiber (15.08.2026): „ich bin noch ein bisschen unglücklich über die
  // medien profil zuordnung". Zu Recht — es gab dafür KEINE Bedienung, nur
  // Endpunkte, die außer Tests niemand aufrief.
  protected readonly auswahlProfile = signal<
    { kennung: string; name: string; alle: boolean; werke: string[] }[]
  >([])
  protected readonly hakenLaeuft = signal('')

  protected readonly alleSehenAlles = computed(() => this.auswahlProfile().every((p) => p.alle))

  // ══ SCHNELLWAHL ═══════════════════════════════════════════════════════════
  // Betreiber: „einen namen wählen und dann nacheinander die zeilen wählen".
  protected readonly schnellProfil = signal('')
  protected readonly schnellAktion = signal<'an' | 'aus'>('an')
  protected readonly schnellZahl = signal(0)
  /** Einmal bestätigt, gilt für den ganzen Durchgang — siehe schnellStarten. */
  private schnellFrei = false

  protected readonly schnellName = computed(
    () => this.auswahlProfile().find((p) => p.kennung === this.schnellProfil())?.name ?? '',
  )

  /**
   * Die Rückfrage kommt EINMAL, am Anfang — nicht bei jeder Zeile.
   *
   * Eine Sicherheitsfrage, die bei jedem Klick erscheint, ist keine
   * Sicherheit mehr: sie wird zur Handbewegung, und dann klickt man sie auch
   * dort weg, wo sie berechtigt gewesen wäre. Also hier fragen, wo die
   * Entscheidung wirklich fällt — und zwar nur, wenn dieses Profil bisher
   * alles sieht und der Durchgang ihm etwas WEGNEHMEN wird.
   */
  protected async schnellStarten(kennung: string): Promise<void> {
    this.schnellZahl.set(0)
    this.schnellFrei = false
    if (!kennung) return this.schnellProfil.set('')
    const pr = this.auswahlProfile().find((p) => p.kennung === kennung)
    if (!pr) return this.schnellProfil.set('')
    this.schnellProfil.set(kennung)
    if (pr.alle) {
      // Wer alles sieht, kann durch „aufnehmen" nichts gewinnen — nur durch
      // „abwählen" etwas verlieren. Also ist Abwählen hier die einzige
      // sinnvolle Richtung, und sie braucht die Ansage.
      this.schnellAktion.set('aus')
    }
  }

  protected schnellBeenden(): void {
    this.schnellProfil.set('')
    this.schnellZahl.set(0)
    this.schnellFrei = false
  }

  /**
   * Klick auf eine Zeile.
   *
   * WAS NICHT SCHALTEN DARF: Titel und Interpret sind Eingabefelder, die
   * Dienst-Marken tragen einen Entfernen-Knopf, und die Profil-Häkchen sind
   * selbst Schalter. Wer dort klickt, meint das und nicht die Zeile — sonst
   * schaltet ein Klick in den Titel die Sichtbarkeit um, und das merkt
   * niemand, bis das Kind eine Sendung vermisst.
   */
  protected async schnellKlick(schluessel: string, ev: Event): Promise<void> {
    if (!this.schnellProfil()) return
    const ziel = ev.target as HTMLElement | null
    if (ziel?.closest(SCHNELL_NICHT_KLICKBAR)) return
    const pr = this.auswahlProfile().find((p) => p.kennung === this.schnellProfil())
    if (!pr) return
    const an = this.schnellAktion() === 'an'
    if (!this.schnellFrei) {
      // Die eine Frage des Durchgangs. Ab hier wird durchgereicht.
      if (pr.alle && !an) {
        const ok = confirm(
          `${pr.name} sieht bisher alle Werke.\n\nSobald du hier etwas abwählst, sieht ${pr.name} nur noch das ausdrücklich Angehakte — auch Neues kommt dann nicht mehr von selbst dazu.\n\nDurchgang starten?`,
        )
        if (!ok) return this.schnellBeenden()
      }
      this.schnellFrei = true
    }
    const vorher = this.auswahlProfile().find((p) => p.kennung === pr.kennung)
    const drin = vorher?.alle || (vorher?.werke.includes(schluessel) ?? false)
    if (drin === an) return // steht schon so — kein Rundlauf, keine Zählung
    await this.hakenUmlegen(pr, schluessel, an, true)
    this.schnellZahl.update((n) => n + 1)
  }

  protected async auswahlenHolen(): Promise<void> {
    try {
      const d = await firstValueFrom(
        this.http.get<{ profile: { kennung: string; name: string; alle: boolean; werke: string[] }[] }>(
          '/api/profil/auswahlen',
        ),
      )
      this.auswahlProfile.set(d.profile ?? [])
    } catch {
      // Kein Drama und keine Meldung: die Spalten fehlen dann eben. Die
      // Bibliothek selbst ist davon nicht betroffen.
      this.auswahlProfile.set([])
    }
  }

  /**
   * Ein Häkchen umlegen — mit der Rückfrage an den zwei Stellen, an denen es
   * mehr tut, als es aussieht (der Server entscheidet, wann; siehe dort).
   */
  protected async hakenUmlegen(
    pr: { kennung: string; name: string },
    schluessel: string,
    an: boolean,
    bestaetigt = false,
  ): Promise<void> {
    this.hakenLaeuft.set(`${pr.kennung}|${schluessel}`)
    try {
      await firstValueFrom(
        this.http.post('/api/profil/auswahl/werk', { profil: pr.kennung, schluessel, an, bestaetigt }),
      )
      await this.auswahlenHolen()
    } catch (f) {
      const e = (f as { error?: { error?: string; frage?: string; anzahl?: number } })?.error
      if (e?.error === 'bestaetigung') {
        // DIE FALLE SICHTBAR MACHEN, statt sie zu umgehen — so ausdrücklich
        // gewählt. Der Text sagt die FOLGE, nicht die Mechanik.
        const frage =
          e.frage === 'einsperren'
            ? `${pr.name} sieht bisher alle ${e.anzahl} Werke.\n\nWenn du jetzt etwas wegnimmst, sieht ${pr.name} ab sofort nur noch das ausdrücklich Angehakte — auch Neues kommt dann nicht mehr von selbst dazu.\n\nFortfahren?`
            : `Das war das letzte angehakte Werk.\n\nOhne Auswahl sieht ${pr.name} wieder ALLES, also die ganze Bibliothek mit ${e.anzahl} Werken.\n\nFortfahren?`
        if (confirm(frage)) {
          this.hakenLaeuft.set('')
          return this.hakenUmlegen(pr, schluessel, an, true)
        }
        // Abgelehnt: die Häkchen stehen noch auf dem alten Stand des Servers,
        // aber der Browser hat das Kästchen schon umgemalt. Neu laden richtet
        // es — sonst zeigt die Seite etwas an, was nicht gespeichert ist.
        await this.auswahlenHolen()
      } else if (e?.error === 'auswahlVoll') {
        this.meldung.set('Die Auswahl dieses Profils ist voll.')
      } else {
        this.meldung.set('Die Zuordnung ist fehlgeschlagen.')
        await this.auswahlenHolen()
      }
    } finally {
      this.hakenLaeuft.set('')
    }
  }

  protected readonly kinder = signal<
    { kennung: string; titel: string; text?: string; herausgeber: string; schonDa: boolean }[]
  >([])
  protected readonly kinderLaedt = signal(false)
  protected readonly regale = signal<{ id: string; titel: string; fuerKinder: boolean }[]>([])
  /** Das Kinderregal ist die Vorgabe — die Box gehoert zuerst den Kindern. */
  protected readonly regal = signal('42914714')
  protected readonly regalSuche = signal('')

  protected readonly regalFuerKinder = computed(
    () => this.regale().find((k) => k.id === this.regal())?.fuerKinder ?? false,
  )

  /**
   * 297 Zeilen sind keine Liste mehr, sondern eine Wand („Doku & Reportage"
   * gemessen). Deshalb ein Suchfeld, sobald es ueber ein Dutzend wird.
   */
  protected readonly gefilterteSendungen = computed(() => {
    const q = this.regalSuche().trim().toLowerCase()
    if (!q) return this.kinder()
    return this.kinder().filter(
      (s) => s.titel.toLowerCase().includes(q) || (s.herausgeber ?? '').toLowerCase().includes(q),
    )
  })

  protected async regalWechseln(id: string): Promise<void> {
    this.regal.set(id)
    this.regalSuche.set('')
    await this.kinderregalHolen()
  }

  /** Die Regalliste holen und gleich das gewaehlte Regal fuellen. */
  protected async regaleHolen(): Promise<void> {
    try {
      const d = await firstValueFrom(
        this.http.get<{ kategorien: { id: string; titel: string; fuerKinder: boolean }[] }>(
          '/api/plugins/mixpi-ardsounds/http/kategorien',
        ),
      )
      this.regale.set(d.kategorien ?? [])
    } catch {
      this.meldung.set('Die Regale von ARD Sounds sind gerade nicht erreichbar.')
      return
    }
    await this.kinderregalHolen()
  }

  protected async kinderregalHolen(): Promise<void> {
    this.kinderLaedt.set(true)
    try {
      const d = await firstValueFrom(
        this.http.get<{
          sendungen: { kennung: string; titel: string; text?: string; herausgeber: string }[]
        }>(`/api/plugins/mixpi-ardsounds/http/kategorie/${this.regal()}`),
      )
      this.kinder.set((d.sendungen ?? []).map((x) => ({ ...x, schonDa: this.ardSchonDa(x.kennung) })))
      if (!(d.sendungen ?? []).length) this.meldung.set('Das Regal kam leer zurück — ARD Sounds antwortet gerade nicht.')
    } catch {
      this.meldung.set('ARD Sounds antwortet nicht.')
    } finally {
      this.kinderLaedt.set(false)
    }
  }

  /** Aus dem Regal aufnehmen — derselbe Weg wie aus einer Sammlung. */
  protected async kinderAufnehmen(s: { kennung: string; titel: string }): Promise<void> {
    await this.sendungAufnehmen({ id: s.kennung, titel: s.titel })
    this.kinder.update((l) => l.map((e) => (e.kennung === s.kennung ? { ...e, schonDa: true } : e)))
  }

  protected async sendungAufnehmen(x: { id: string; titel: string }): Promise<void> {
    this.nimmt.set(x.id)
    try {
      await firstValueFrom(
        /* FLACH, NICHT IN `eintrag` VERPACKT — am Geraet gemessen 23.08.2026.
         * `POST /api/medien` liest `req.body` DIREKT (server.ts,
         * `neuerEintrag(req.body)`). Die verpackte Form kam mit HTTP 400
         * „unvollstaendig" zurueck, und zwar seit jeher: dieser Knopf hat NIE
         * einen Eintrag angelegt. Aufgefallen ist es erst, als derselbe
         * Fehler in zwei neue Knoepfe kopiert wurde und die Geraeteprobe ihn
         * dreifach zeigte. Zwei Zeilen weiter unten in dieser Datei stand die
         * richtige Form die ganze Zeit daneben. */
        this.http.post('/api/medien', { type: 'ard', id: x.id, title: x.titel, artist: '', category: 'audiobook' }),
      )
      this.sammlungInhalt.update((l) => l.map((e) => (e.id === x.id ? { ...e, schonDa: true } : e)))
      // WEM GEHOERT DAS JETZT? Profile mit ausdruecklicher Auswahl bekommen das
      // Neue NICHT von selbst — sonst waere ihre Auswahl keine. Wer alles
      // sieht, hat es ohnehin. Also: nur dort dazulegen, wo ein Mensch schon
      // einmal ausgewaehlt hat, und zwar bei allen solchen Profilen.
      const eng = this.auswahlProfile().filter((p) => !p.alle)
      for (const pr of eng) {
        await firstValueFrom(
          this.http.post('/api/profil/auswahl/werk', {
            profil: pr.kennung,
            schluessel: `ard:${x.id}`,
            an: true,
            bestaetigt: true,
          }),
        ).catch(() => {})
      }
      this.meldung.set(
        eng.length
          ? `„${x.titel}" ist jetzt auf der Box — und bei ${eng.map((p) => p.name).join(', ')} zugeordnet.`
          : `„${x.titel}" ist jetzt auf der Box.`,
      )
      await this.laden()
    } catch (f) {
      const g = (f as { error?: { error?: string } })?.error?.error
      this.meldung.set(g || 'Das Aufnehmen ist fehlgeschlagen.')
    } finally {
      this.nimmt.set('')
    }
  }
  protected readonly pruefeAlle = signal(false)
  protected readonly uebernehme = signal(false)
  protected readonly uebernommen = signal(0)

  /* == DIE ZENTRALE SUCHE (29.08.2026) — Begruendung im Template oben. == */
  protected readonly zentral = signal('')

  /** Tippen speist alle oertlichen Siebe zugleich; die Netz-Suchen erst bei Enter. */
  protected zentralTippen(wert: string): void {
    this.zentral.set(wert)
    this.filter = wert
    this.senderSuche.set(wert)
    this.regalSuche.set(wert)
    this.archivSuche.set(wert)
    this.suchtext = wert
  }

  /** Enter: die zwei Netz-Suchen — und die Sender einmalig nachladen, damit sie mitspielen. */
  protected zentralSuchen(): void {
    const wort = this.zentral().trim()
    if (!wort) return
    void this.suchen()
    void this.archivSuchen()
    if (!this.senderGesamt() && !this.senderLaden()) void this.senderHolen()
  }

  /** Zum Abschnitt rollen — die Rubrik-Zaehler oben sind zugleich die Abspruenge. */
  protected springe(anker: string): void {
    document.getElementById(anker)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  protected suchtext = ''
  protected suchdienst = 'alle'
  protected suchart = 'alle'
  protected neueKategorie = 'music'
  protected filter = ''
  protected filterKategorie = ''

  /**
   * Die gefilterte Sicht.
   *
   * Bewusst IM BROWSER gefiltert: die Bibliothek einer Box umfasst Dutzende
   * bis wenige Hundert Einträge — dafür lohnt keine Runde zum Server, und die
   * Liste reagiert beim Tippen sofort.
   */
  protected readonly sichtbar = computed(() => {
    const q = this.filter.trim().toLowerCase()
    const kat = this.filterKategorie
    return this.eintraege().filter((e) => {
      if (kat && e.category !== kat) return false
      if (!q) return true
      const heu = `${e.title ?? ''} ${e.artist ?? ''} ${e.category ?? ''} ${e.type ?? ''}`.toLowerCase()
      return q.split(/\s+/).every((w) => heu.includes(w))
    })
  })

  /**
   * Je Gruppe nur EINE Zeile.
   *
   * Dasselbe Album in Spotify UND Jellyfin sah bisher aus wie zwei Alben. Die
   * erste Zeile der Gruppe fuehrt sie an; die anderen Quellen erscheinen in
   * ihr als eigene Knoepfe.
   */
  protected readonly gezeigt = computed(() => {
    const gesehen = new Set<number>()
    return this.treffer().filter((t) => {
      const g = t.gruppe ?? -1
      if (g < 0) return true
      if (gesehen.has(g)) return false
      gesehen.add(g)
      return true
    })
  })

  /** Alle Treffer derselben Gruppe - also dasselbe Werk in allen Diensten. */
  protected quellenVon(t: Treffer): Treffer[] {
    const g = t.gruppe ?? -1
    if (g < 0) return [t]
    return this.treffer().filter((x) => (x.gruppe ?? -1) === g)
  }

  protected offeneQuellen(t: Treffer): Treffer[] {
    return this.quellenVon(t).filter((x) => !x.schonDa)
  }

  /** Aus ALLEN offenen Diensten aufnehmen - dann liegt es mehrfach, aber bewusst. */
  protected async alleAufnehmen(t: Treffer): Promise<void> {
    for (const q of this.offeneQuellen(t)) await this.aufnehmen(q)
  }

  /**
   * Die Automatik: nach dem Laden von selbst bei den anderen Diensten
   * nachfragen, statt je Zeile einen Knopf zu druecken.
   *
   * ABSCHALTBAR, und das ist kein Beiwerk: jede Pruefung ist eine Suche bei
   * fremden Diensten. Bei neun Eintraegen merkt das niemand, bei zweihundert
   * ist es eine Minute Arbeit und zweihundert Anfragen - wer das nicht will,
   * schaltet es aus.
   *
   * Der Merker liegt im Browser (localStorage), nicht auf der Box: es ist eine
   * Einstellung der ANSICHT, keine der Box.
   */
  protected readonly autoPruefen = signal(leseAuto())
  protected readonly geprueftAnzahl = computed(() => Object.keys(this.angebote()).length)

  protected autoUmschalten(ev: Event): void {
    const an = (ev.target as HTMLInputElement).checked
    this.autoPruefen.set(an)
    try {
      localStorage.setItem(AUTO_SCHLUESSEL, an ? '1' : '0')
    } catch {
      /* privater Modus o. ae. - dann gilt es eben nur fuer diese Sitzung */
    }
    if (an) void this.alleAndereSuchen()
  }

  // ── Bei Spotify nicht mehr vorhanden ──────────────────────────────────────
  //
  // WAS ANGEBOTEN WIRD, ENTSCHEIDET DIE BOX, nicht diese Seite. Der Server
  // liefert fertige Vorschlaege samt SCHLUESSEL — die Seite baut ihn nie
  // selbst aus der Kennung. Grund: `medienSchluessel` nimmt `id` vor
  // `playlistid`, die Verfuegbarkeitspruefung umgekehrt; ein Eintrag mit
  // beiden Feldern wuerde unter der einen gemeldet und unter der anderen
  // entfernt. Es fiele der falsche Eintrag oder gar keiner.
  protected readonly vorschlaege = signal<Vorschlag[]>([])
  protected readonly verfStand = signal('')
  protected readonly verfGrund = signal('')
  protected readonly verfTaugte = signal(true)
  protected readonly verfGeprueft = signal(0)
  protected readonly verfLaeuft = signal(false)
  /** Vorausgewaehlt ist ALLES — hier stehen die Zeilen, die der Mensch ausgenommen hat. */
  protected readonly abgewaehlt = signal<Set<string>>(new Set())
  protected readonly raeumtAuf = signal(false)
  protected readonly aufraeumMeldung = signal('')
  protected readonly rueckSicherung = signal('')

  protected readonly gewaehlte = computed(() =>
    this.vorschlaege().filter((v) => !v.doppelt && !this.abgewaehlt().has(v.schluessel)),
  )

  protected auswahlUmschalten(v: Vorschlag): void {
    this.abgewaehlt.update((s) => {
      const neu = new Set(s)
      if (neu.has(v.schluessel)) neu.delete(v.schluessel)
      else neu.add(v.schluessel)
      return neu
    })
  }

  private async verfuegbarkeitLaden(): Promise<void> {
    try {
      const d = await firstValueFrom(this.http.get<Verfuegbarkeit>('/api/medien/verfuegbarkeit'))
      this.vorschlaege.set(d.vorschlaege ?? [])
      this.verfStand.set(d.stand ?? '')
      this.verfGrund.set(d.grund ?? '')
      this.verfTaugte.set(d.taugte !== false)
      this.verfGeprueft.set(d.geprueft ?? 0)
      this.verfLaeuft.set(!!d.laeuft)
    } catch {
      /* die Karte bleibt dann leer - die Bibliothek darunter ist wichtiger */
    }
  }

  /**
   * Von Hand pruefen lassen.
   *
   * Der Server antwortet SOFORT und laeuft im Hintergrund weiter (bei zweihundert
   * Eintraegen dauert der Lauf ueber eine Minute). Deshalb wird danach
   * nachgefragt, bis `laeuft` faellt — und zwar nicht ewig: eine Box, die
   * mittendrin neu startet, wuerde die Seite sonst fuer immer „prüft …"
   * anzeigen lassen.
   */
  protected async jetztPruefen(): Promise<void> {
    if (this.verfLaeuft()) return
    this.verfLaeuft.set(true)
    try {
      await firstValueFrom(this.http.post('/api/medien/verfuegbarkeit/pruefen', {}))
    } catch {
      // 409 heisst: laeuft schon. Dann wird einfach mitgeschaut.
    }
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      await this.verfuegbarkeitLaden()
      if (!this.verfLaeuft()) return
    }
    this.verfLaeuft.set(false)
  }

  /**
   * Die ausgewaehlten Eintraege entfernen.
   *
   * ZWEI KLICKS, KEIN FENSTER (`sicher()`, Nutzerwunsch). Die Sicherung legt
   * die Box an, nicht diese Seite — und sie meldet ihren Namen zurueck, damit
   * der Knopf „rückgängig" ihn hat.
   */
  protected async aufraeumen(): Promise<void> {
    const ziele = this.gewaehlte()
    if (!ziele.length) return
    if (!this.sicher('aufraeumen')) return
    this.raeumtAuf.set(true)
    this.aufraeumMeldung.set('')
    this.rueckSicherung.set('')
    try {
      const d = await firstValueFrom(
        this.http.post<{ entfernt: number; nichtGefunden: string[]; sicherung: string }>('/api/medien/aufraeumen', {
          schluessel: ziele.map((v) => v.schluessel),
        }),
      )
      // NICHT NUR DIE ERFOLGE NENNEN: ein Eintrag, dessen Schluessel doppelt
      // vorkommt, wird nicht entfernt (findeIndex gibt dann -1). Wer nur
      // „5 entfernt" meldet, laesst zwei stehen und behauptet das Gegenteil.
      const rest = d.nichtGefunden?.length
        ? `, ${d.nichtGefunden.length} nicht — doppelter Schlüssel oder inzwischen weg`
        : ''
      this.aufraeumMeldung.set(`${d.entfernt} entfernt${rest}. Sicherung: ${d.sicherung}`)
      this.rueckSicherung.set(d.sicherung ?? '')
      // Der Rueckweg steht eine Minute bereit. Danach bleibt er ueber die
      // Datei auf der Box offen — sie wird nicht weggeworfen.
      setTimeout(() => this.rueckSicherung.set(''), 60_000)
      await this.laden()
      await this.verfuegbarkeitLaden()
    } catch {
      this.aufraeumMeldung.set('Es wurde nichts entfernt — die Box hat abgelehnt.')
    } finally {
      this.raeumtAuf.set(false)
    }
  }

  protected async rueckgaengig(): Promise<void> {
    const name = this.rueckSicherung()
    if (!name) return
    this.raeumtAuf.set(true)
    try {
      const d = await firstValueFrom(
        this.http.post<{ eintraege: number }>('/api/medien/aufraeumen/zurueck', { sicherung: name }),
      )
      this.aufraeumMeldung.set(`Zurückgespielt: ${d.eintraege} Einträge.`)
      this.rueckSicherung.set('')
      await this.laden()
      await this.verfuegbarkeitLaden()
    } catch {
      this.aufraeumMeldung.set(`Die Sicherung ${name} konnte nicht eingespielt werden.`)
    } finally {
      this.raeumtAuf.set(false)
    }
  }

  /** „1 Eintrag" statt „1 Einträge" — an einem Knopf, der loescht, liest man genau. */
  protected stueck(n: number): string {
    return n === 1 ? '1 Eintrag' : `${n} Einträge`
  }

  protected standText(): string {
    const s = this.verfStand()
    if (!s) return 'noch nicht geprüft'
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? 'noch nicht geprüft' : `zuletzt geprüft: ${d.toLocaleString()}`
  }

  /** „seit 3 Tagen" — die Zahl, die erklärt, warum der Eintrag hier steht. */
  protected seitText(ms: number): string {
    const tage = Math.floor((Date.now() - ms) / 86_400_000)
    if (tage >= 2) return `${tage} Tagen`
    const stunden = Math.max(1, Math.floor((Date.now() - ms) / 3_600_000))
    return stunden === 1 ? 'einer Stunde' : `${stunden} Stunden`
  }

  /** Die Art, wie die Spotify-Web-API sie nennt, auf Deutsch. */
  protected artName2(a: string | undefined): string {
    return a === 'playlists' ? 'Liste' : a === 'shows' ? 'Show' : a === 'audiobooks' ? 'Hörbuch' : 'Album'
  }

  // ── Aufnahmen (Mitschnitt-Lage) ────────────────────────────────────────
  //
  // Betreiber: „mir fehlt noch die verwaltung sowie anstoßen ... ggf direkt
  // an den alben zum klicken". Diese Karte fuehrt kein eigenes Buch - sie
  // fragt beim Mitschnitt-Plugin (mixpi-mitschnitt) nach. GEHOLT WIRD ERST
  // BEIM AUFKLAPPEN (`aufnahmenAufklappen`), dieselbe Zurueckhaltung wie bei
  // den ARD-Regalen: ein Ruf an ein Plugin, das aus sein kann, gehoert nicht
  // in den Seitenaufbau.
  protected readonly aufnahmenLaedt = signal(false)
  protected readonly aufnahmenGeholt = signal(false)
  protected readonly aufnahmenZahl = signal<AufnahmeZusammenfassung | null>(null)
  protected readonly aufnahmenListe = signal<AufnahmeEintrag[]>([])
  protected readonly aufnahmenHinweis = signal('')

  /** Beim ERSTEN Aufklappen automatisch holen - ein zweites Mal nicht von selbst, dafuer steht „Liste holen". */
  protected aufnahmenAufklappen(offen: boolean): void {
    if (offen && !this.aufnahmenGeholt() && !this.aufnahmenLaedt()) void this.aufnahmenHolen()
  }

  protected async aufnahmenHolen(): Promise<void> {
    if (this.aufnahmenLaedt()) return
    this.aufnahmenLaedt.set(true)
    this.aufnahmenHinweis.set('')
    try {
      const d = await firstValueFrom(
        this.http.get<{ zusammenfassung?: AufnahmeZusammenfassung; eintraege?: AufnahmeEintrag[] }>(
          '/api/plugins/mixpi-mitschnitt/http/liste',
        ),
      )
      this.aufnahmenZahl.set(d.zusammenfassung ?? { offen: 0, fertig: 0, fehler: 0 })
      this.aufnahmenListe.set(d.eintraege ?? [])
    } catch {
      // 404 heisst: das Plugin ist aus, oder eine aeltere Fassung kennt die
      // Auskunft noch nicht. Beides ist ein gewoehnlicher Betriebszustand -
      // kein Fehlerrot, siehe Kartenkommentar im Template.
      this.aufnahmenHinweis.set('Der Mitschnitt ist aus oder kennt diese Auskunft noch nicht.')
    } finally {
      this.aufnahmenGeholt.set(true)
      this.aufnahmenLaedt.set(false)
    }
  }

  protected aufnahmeStandWort(stand: string): string {
    return AUFNAHME_STAND_WORT[stand] ?? stand
  }

  /**
   * Je Bibliotheks-Zeile: die Spotify-Fassung, wenn es eine gibt.
   *
   * NUR ZEILEN MIT SPOTIFY-QUELLE koennen aufgenommen werden - der Mitschnitt
   * hoert Spotify ab, keinen anderen Dienst. Bei einer verschmolzenen Zeile
   * (mehrere `geschwister`) reicht EINE Spotify-Fassung.
   */
  protected mitschnittQuelle(e: Eintrag): Eintrag | undefined {
    return this.geschwister(e).find((q) => this.dienstSchluessel(q) === 'spotify')
  }

  /** Antwort je Zeile - Muster wie `angebote()`: ein Record statt einer einzelnen Meldung. */
  protected readonly mitschnittMeldung = signal<Record<string, string>>({})

  /**
   * Aus Spotify aufnehmen - die fehlenden Titel eines Albums beim Mitschnitt
   * vormerken.
   *
   * ZWEI KLICKS, KEIN FENSTER (`sicher()`, Haus-Idiom). Ablauf: Titel ueber
   * `/inhalt?quelle=spotify` holen, auf den Vormerk-Koerper abbilden
   * (`mitschnittVormerkKoerper`, rein und eigens geprueft) und beim Plugin
   * vormerken. DIE ANTWORT STEHT AN DER ZEILE (`mitschnittMeldung`), nicht in
   * der Seiten-Meldung ganz unten - Muster wie bei `angebote()`.
   */
  protected async mitschnittAufnehmen(e: Eintrag): Promise<void> {
    if (!this.mitschnittQuelle(e)) return
    if (!this.sicher(`mitschnitt:${e.schluessel}`)) return
    this.nimmt.set(e.schluessel)
    this.mitschnittMeldung.update((m) => ({ ...m, [e.schluessel]: '' }))
    try {
      const d = await firstValueFrom(
        this.http.get<{ titel?: MitschnittTitelRoh[] }>(
          `/api/werke/${encodeURIComponent(e.schluessel)}/inhalt?verschmelzen=1&quelle=spotify`,
        ),
      )
      const { koerper, uebersprungen } = mitschnittVormerkKoerper(d.titel ?? [], {
        titel: e.title ?? '',
        interpret: e.artist ?? '',
        kategorie: e.category,
      })
      if (!koerper.length) {
        this.mitschnittMeldung.update((m) => ({
          ...m,
          [e.schluessel]: uebersprungen
            ? `Kein Titel mit Spotify-Kennung (${uebersprungen} übersprungen).`
            : 'Keine Titel gefunden.',
        }))
        return
      }
      const a = await firstValueFrom(
        this.http.post<{ vorgemerkt: number; schonDa: number; fertigUebersprungen?: number }>(
          '/api/plugins/mixpi-mitschnitt/http/vormerken',
          { titel: koerper },
        ),
      )
      const teile = [`${a.vorgemerkt} vorgemerkt`]
      if (a.schonDa) teile.push(`${a.schonDa} übersprungen (schon da)`)
      if (a.fertigUebersprungen) teile.push(`${a.fertigUebersprungen} schon fertig`)
      if (uebersprungen) teile.push(`${uebersprungen} ohne Spotify-Kennung übersprungen`)
      this.mitschnittMeldung.update((m) => ({ ...m, [e.schluessel]: `${teile.join(', ')}.` }))
    } catch (f) {
      const antwort = f as { status?: number; error?: { fehler?: string } }
      const text =
        antwort?.status === 403
          ? antwort.error?.fehler || 'Der Mitschnitt bestätigt die Rechtslage nicht — vormerken ist gesperrt.'
          : antwort?.status === 404
            ? 'Der Mitschnitt ist aus oder kennt diese Auskunft noch nicht.'
            : 'Die Titel ließen sich nicht vormerken.'
      this.mitschnittMeldung.update((m) => ({ ...m, [e.schluessel]: text }))
    } finally {
      this.nimmt.set('')
    }
  }

  /** Die eigenen Listen der Box (eigene Ablage, nicht die Bibliothek). */
  protected readonly listen = signal<BoxListe[]>([])
  protected readonly listeId = signal('')
  protected readonly aktuelleListe = computed(() => this.listen().find((l) => l.id === this.listeId()) ?? null)

  private async listenLaden(): Promise<void> {
    try {
      const d = await firstValueFrom(this.http.get<{ listen: BoxListe[] }>('/api/listen'))
      this.listen.set(d.listen ?? [])
    } catch {
      /* ohne Listen bleibt die Seite bedienbar */
    }
  }

  /** Beim Waehlen von „neue Liste" klappt ein Eingabefeld auf - kein Fenster. */
  protected readonly neueListe = signal(false)
  protected neuerName = ''

  protected listeWaehlen(id: string): void {
    if (id === '__neu') {
      this.neueListe.set(true)
      this.neuerName = ''
      return
    }
    this.neueListe.set(false)
    this.listeId.set(id)
  }

  protected async listeAnlegen(): Promise<void> {
    const name = this.neuerName.trim()
    if (!name) return
    try {
      const l = await firstValueFrom(this.http.post<BoxListe>('/api/listen', { name }))
      await this.listenLaden()
      this.listeId.set(l.id)
      this.neueListe.set(false)
      this.neuerName = ''
      this.meldung.set(`Liste „${l.name}" angelegt.`)
    } catch {
      this.meldung.set('Die Liste konnte nicht angelegt werden.')
    }
  }

  /**
   * Einen Treffer in die gewaehlte Liste legen.
   *
   * Auch ALBEN und LISTEN sind erlaubt: wer ein ganzes Album in seine Liste
   * legen will, meint dessen Titel. Bis die Aufloesung gebaut ist, wird nur
   * abgewiesen, was gar keine Kennung hat.
   */
  protected async inListe(t: Treffer): Promise<void> {
    const l = this.aktuelleListe()
    if (!l) return
    // Ein ALBUM oder eine LISTE wird AUFGELOEST - wer sie hineinlegt, meint
    // ihre Titel. Der Server holt sie, weil dort die Zugaenge liegen.
    if (!t.nurFuerListe) {
      try {
        const d = await firstValueFrom(
          this.http.post<{ dazu: number; schon: number; gefunden: number }>(
            `/api/listen/${encodeURIComponent(l.id)}/album`,
            { dienst: t.dienst, id: t.id, playlistid: t.playlistid, title: t.title, cover: t.cover },
          ),
        )
        this.meldung.set(
          d.dazu
            ? `${d.dazu} Titel aus „${t.title}" hinzugefügt${d.schon ? `, ${d.schon} waren schon drin` : ''}.`
            : d.gefunden
              ? 'Alle Titel waren schon in der Liste.'
              : 'Keine Titel gefunden.',
        )
        await this.listenLaden()
      } catch {
        this.meldung.set('Das Album konnte nicht aufgelöst werden.')
      }
      return
    }
    try {
      const d = await firstValueFrom(
        this.http.post<{ anzahl: number }>(`/api/listen/${encodeURIComponent(l.id)}/titel`, {
          dienst: t.dienst,
          title: t.title,
          artist: t.artist,
          uri: t.uri,
          id: t.id,
          album: t.album,
          cover: t.cover,
          dauerMs: t.dauerMs,
        }),
      )
      this.meldung.set(`„${t.title}" in „${l.name}" gelegt (${d.anzahl}).`)
      await this.listenLaden()
    } catch (e) {
      const status = (e as { status?: number })?.status
      this.meldung.set(
        status === 409
          ? 'Steht schon in der Liste.'
          : status === 400
            ? 'Das lässt sich (noch) nicht in eine Liste legen — einzelne Titel gehen.'
            : 'Konnte nicht abgelegt werden.',
      )
    }
  }

  protected async titelRaus(l: BoxListe, pos: number): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`/api/listen/${encodeURIComponent(l.id)}/titel/${pos}`))
      await this.listenLaden()
    } catch {
      this.meldung.set('Konnte nicht entfernt werden.')
    }
  }

  protected async listeLoeschen(l: BoxListe): Promise<void> {
    if (!this.sicher(`liste:${l.id}`)) return
    try {
      await firstValueFrom(this.http.delete(`/api/listen/${encodeURIComponent(l.id)}`))
      this.listeId.set('')
      await this.listenLaden()
    } catch {
      this.meldung.set('Die Liste konnte nicht gelöscht werden.')
    }
  }

  constructor() {
    void this.listenLaden()
    void this.verfuegbarkeitLaden()
    void this.darstellung.holen()
    void this.aktionenLaden()
    void this.laden().then(() => {
      if (this.autoPruefen()) void this.alleAndereSuchen()
    })
  }

  /**
   * Die Medien-Aktionen der Box holen.
   *
   * Ein Fehlschlag bleibt STILL: dann fehlt eine Karte, die niemand vermisst,
   * der sie nicht sucht. Eine Fehlermeldung an dieser Stelle stuende ueber der
   * Bibliothek und liesse die ganze Seite kaputt aussehen, obwohl alles
   * Wesentliche da ist.
   */
  private async aktionenLaden(): Promise<void> {
    try {
      const l = await this.system.lage()
      this.medienAktionen.set((l.aktionen ?? []).filter((a) => a.bereich === 'medien'))
    } catch {
      this.medienAktionen.set([])
    }
  }

  /**
   * Eine Medien-Aktion ausloesen — und die Antwort NEBEN den Knopf schreiben.
   *
   * DER BEFUND VOM GEGENLESEN (03.08.2026, gemessen): Der Knopf ist mit dem
   * Umzug hierher gewandert, seine Antwort nicht. Sie landete in `meldung()`,
   * und die steht auf dieser Seite ganz UNTEN, hinter der ganzen Bibliothek —
   * gemessen am 800 px breiten Fenster: Knopf bei y=774, Meldung bei y=1649,
   * also 875 px und knapp zwei Bildschirme weiter unten. Auf der Systemseite,
   * wo der Knopf herkommt, stehen die Meldungen oben bei den Knoepfen.
   *
   * SCHLIMMER ALS WEIT WEG: `laden()` schreibt bei einem Fehlschlag in
   * DIESELBE Zeile. Ein gelungenes Einlesen bei kaputter Bibliothek meldete
   * also erst „erledigt." und ersetzte das eine Zeile spaeter durch „Die
   * Bibliothek konnte nicht geladen werden." — die Antwort auf den Knopfdruck
   * war weg, bevor sie jemand lesen konnte.
   *
   * Deshalb eine EIGENE Zeile in der EIGENEN Karte.
   */
  protected async aktionAusloesen(a: SystemAktion): Promise<void> {
    if (this.aktionLaeuft()) return
    this.aktionLaeuft.set(a.id)
    this.aktionMeldung.set('')
    const e = await this.system.ausloesen(a.id)
    this.aktionLaeuft.set('')
    this.aktionMeldung.set(e.ok ? `${a.titel}: erledigt.` : `${a.titel}: ${e.grund}`)
    // Nach dem Einlesen kann die Bibliothek anders aussehen — nachladen, statt
    // den Benutzer raten zu lassen, ob es gewirkt hat.
    if (e.ok) void this.laden()
  }

  /** Einen der beiden Quellen-Schalter umlegen. */
  protected async darstUmschalten(feld: 'verschmelzen' | 'diskografie'): Promise<void> {
    await this.darstellung.umschalten(feld)
  }

  private async laden(): Promise<void> {
    await this.auswahlenHolen()
    try {
      const d = await firstValueFrom(
        this.http.get<{ eintraege: Eintrag[]; gesamt: number; kategorien: string[] }>('/api/medien'),
      )
      this.eintraege.set(d.eintraege ?? [])
      this.gesamt.set(d.gesamt ?? 0)
      if (d.kategorien?.length) this.kategorien.set(d.kategorien)
    } catch {
      this.meldung.set('Die Bibliothek konnte nicht geladen werden.')
    }
    // GETRENNT UND STILL: Der Vorspann-Stand ist Beiwerk — faellt er aus,
    // fehlt ein Haekchen, aber die Bibliothek steht trotzdem da.
    try {
      const v = await firstValueFrom(
        this.http.get<{
          alle: boolean
          sendungen: Record<string, { sekunden: number; an: boolean; gemessen?: number }>
        }>('/api/ard/vorspann'),
      )
      this.vorspann.set(v.sendungen ?? {})
      this.vorspannAlle.set(v.alle === true)
    } catch {
      /* ohne Vorspann-Stand bleibt das Haekchen einfach aus */
    }
  }

  /* ══ DEN VORSPANN UEBERSPRINGEN (15.08.2026) ═════════════════════════════
   * Betreiber: „es gibt immer einen anfangs jingle der bei allen gleich ist
   * kannst du das erkennen und eine checkbox einbauen". Erkannt wird er
   * GEMESSEN (der Knopf ruft scripts/box/ard-vorspann-messen.py ueber den
   * Server); das Haekchen entscheidet nur, ob gesprungen wird. Ohne Messung
   * bleibt es gesperrt — ein Haekchen, das nichts tun kann, waere ein
   * Versprechen ohne Deckung. */
  protected istArdEintrag(e: Eintrag): boolean {
    return String(e.schluessel ?? '').startsWith('ard:')
  }

  protected vorspannSekunden(e: Eintrag): number {
    return Number(this.vorspann()[String(e.schluessel)]?.sekunden) || 0
  }

  protected vorspannAn(e: Eintrag): boolean {
    // Der generelle Schalter zeigt sich hier als gesetztes Haekchen — sonst
    // stuende „überall überspringen" oben an und die Zeilen sagten das
    // Gegenteil.
    return this.vorspannAlle() || this.vorspann()[String(e.schluessel)]?.an === true
  }

  protected async vorspannAlleSchalten(an: boolean): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/ard/vorspann/alle', { an }))
      this.vorspannAlle.set(an)
      this.meldung.set(
        an
          ? 'Der Jingle wird bei allen ARD-Sendungen übersprungen. Noch nicht gemessene misst die Box beim ersten Öffnen selbst.'
          : 'Es gilt wieder das Häkchen je Sendung.',
      )
    } catch {
      this.meldung.set('Der Schalter ließ sich nicht setzen.')
    }
  }

  protected vorspannHinweis(e: Eintrag): string {
    const s = this.vorspannSekunden(e)
    if (s > 0) return `Die ersten ${s} s jeder Folge werden übersprungen — gemessen an mehreren Folgen dieser Sendung.`
    return this.vorspannAlle()
      ? 'Noch nicht gemessen — die Box holt es beim ersten Öffnen dieser Sendung selbst nach.'
      : 'Erst messen: die Box vergleicht den Anfang mehrerer Folgen und findet den gemeinsamen Jingle.'
  }

  protected async vorspannSchalten(e: Eintrag, an: boolean): Promise<void> {
    const schluessel = String(e.schluessel)
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; stand: { sekunden: number; an: boolean } }>('/api/ard/vorspann', {
          schluessel,
          an,
        }),
      )
      this.vorspann.update((v) => ({ ...v, [schluessel]: a.stand }))
    } catch {
      this.meldung.set('Das Häkchen ließ sich nicht setzen.')
    }
  }

  protected async vorspannMessen(e: Eintrag): Promise<void> {
    const schluessel = String(e.schluessel)
    if (this.misst()) return
    this.misst.set(schluessel)
    this.meldung.set('')
    try {
      const a = await firstValueFrom(
        this.http.post<{ ok: boolean; stand: { sekunden: number; an: boolean; gemessen?: number }; einig: boolean }>(
          '/api/ard/vorspann/messen',
          { schluessel },
        ),
      )
      this.vorspann.update((v) => ({ ...v, [schluessel]: a.stand }))
      this.meldung.set(
        a.stand.sekunden > 0
          ? `Gemeinsamer Anfang: ${a.stand.gemessen} s${a.einig ? '' : ' (die Folgen sind sich nicht einig)'} — zum Überspringen ${a.stand.sekunden} s. Häkchen setzen, dann gilt es.`
          : 'Diese Sendung hat keinen gemeinsamen Anfang, der sich überspringen ließe.',
      )
    } catch (f) {
      const g = (f as { error?: { error?: string } })?.error?.error
      this.meldung.set(g || 'Die Messung ließ sich nicht ausführen.')
    } finally {
      this.misst.set('')
    }
  }

  protected async suchen(): Promise<void> {
    const q = this.suchtext.trim()
    if (!q || this.sucht()) return
    this.sucht.set(true)
    this.meldung.set('')
    try {
      const d = await firstValueFrom(
        this.http.get<{ treffer: Treffer[]; hinweise: string[] }>('/api/medien/suche', {
          params: { q, dienst: this.suchdienst, art: this.suchart },
        }),
      )
      this.treffer.set(d.treffer ?? [])
      this.suchHinweise.set(d.hinweise ?? [])
      this.gesucht.set(true)
    } catch {
      this.meldung.set('Die Suche ist fehlgeschlagen.')
    } finally {
      this.sucht.set(false)
    }
  }

  protected async aufnehmen(t: Treffer): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/api/medien', {
          type: t.type,
          category: this.neueKategorie,
          title: t.title,
          artist: t.artist,
          cover: t.cover,
          id: t.id,
          playlistid: t.playlistid,
          audiobookid: t.audiobookid,
        }),
      )
      // Den Treffer als „schon dabei" markieren, statt die Suche neu zu
      // laden — die Trefferliste soll beim Aufnehmen nicht wegspringen.
      this.treffer.update((liste) => liste.map((x) => (x.schluessel === t.schluessel ? { ...x, schonDa: true } : x)))
      await this.laden()
      this.meldung.set(`„${t.title}" aufgenommen.`)
    } catch {
      this.meldung.set('Konnte nicht aufgenommen werden.')
    }
  }

  /**
   * Den Namen eines Suchtreffers aendern, BEVOR er aufgenommen wird.
   *
   * Gerade Spotify-Listen heissen oft unbrauchbar ("Guck mal diese Biene da
   * Summ Summ") - der Name auf der Box soll der sein, den das Kind versteht.
   * Geaendert wird nur die Anzeige des Treffers; gespeichert wird er beim
   * Aufnehmen.
   */
  protected trefferName(t: Treffer, ev: Event): void {
    const wert = (ev.target as HTMLInputElement).value
    this.treffer.update((liste) => liste.map((x) => (x.schluessel === t.schluessel ? { ...x, title: wert } : x)))
  }

  /** Den Interpreten eines Suchtreffers aendern, bevor er aufgenommen wird. */
  protected trefferInterpret(t: Treffer, ev: Event): void {
    const wert = (ev.target as HTMLInputElement).value
    this.treffer.update((liste) => liste.map((x) => (x.schluessel === t.schluessel ? { ...x, artist: wert } : x)))
  }

  /**
   * Den Interpreten eines Eintrags speichern.
   *
   * Anders als der Name darf er LEER sein - nicht jede Liste hat einen
   * sinnvollen Interpreten, und ein erzwungener Platzhalter waere schlechter
   * als nichts.
   */
  protected async interpretSpeichern(e: Eintrag, ev: Event): Promise<void> {
    const feld = ev.target as HTMLInputElement
    const neu = feld.value.trim()
    if (neu === (e.artist ?? '')) return
    try {
      await firstValueFrom(this.http.patch(`/api/medien/${encodeURIComponent(e.schluessel)}`, { artist: neu }))
      this.eintraege.update((liste) => liste.map((x) => (x.schluessel === e.schluessel ? { ...x, artist: neu } : x)))
      this.meldung.set(`Interpret gesetzt: „${neu}".`)
    } catch {
      feld.value = String(e.artist ?? '')
      this.meldung.set('Der Interpret konnte nicht geändert werden.')
    }
  }

  protected interpretVerwerfen(e: Eintrag, ev: Event): void {
    const feld = ev.target as HTMLInputElement
    feld.value = String(e.artist ?? '')
    feld.blur()
  }

  /**
   * Den Namen eines Eintrags speichern.
   *
   * Beim VERLASSEN des Feldes, nicht bei jedem Tastendruck: sonst ginge fuer
   * jeden Buchstaben eine Anfrage raus und die SD-Karte bekaeme jede Aenderung
   * einzeln geschrieben. Unveraendert wird gar nichts geschickt.
   */
  protected async titelSpeichern(e: Eintrag, ev: Event): Promise<void> {
    const feld = ev.target as HTMLInputElement
    const neu = feld.value.trim()
    if (!neu) {
      // Leeren Namen nicht speichern - eine Kachel ohne Beschriftung waere
      // auf der Box nicht wiederzufinden. Zurueck auf den alten Wert.
      feld.value = String(e.title ?? '')
      return
    }
    if (neu === (e.title ?? '')) return
    try {
      const ziele = this.geschwister(e).map((x) => x.schluessel)
      for (const s of ziele) {
        await firstValueFrom(this.http.patch(`/api/medien/${encodeURIComponent(s)}`, { title: neu }))
      }
      this.eintraege.update((liste) => liste.map((x) => (ziele.includes(x.schluessel) ? { ...x, title: neu } : x)))
      this.meldung.set(`Umbenannt in „${neu}".`)
    } catch {
      feld.value = String(e.title ?? '')
      this.meldung.set('Der Name konnte nicht geändert werden.')
    }
  }

  /** Esc: die Eingabe verwerfen und das Feld verlassen. */
  protected titelVerwerfen(e: Eintrag, ev: Event): void {
    const feld = ev.target as HTMLInputElement
    feld.value = String(e.title ?? '')
    feld.blur()
  }

  /**
   * Je Gruppe nur EINE Zeile in der Bibliothek.
   *
   * Die ABLAGE bleibt unberuehrt - es sind weiterhin zwei Eintraege, und die
   * Box zeigt sie einzeln. Nur hier sieht man, was zusammengehoert; die
   * Quellen stehen als Marken in der Zeile, jede einzeln entfernbar.
   */
  protected readonly sichtbarGefasst = computed(() => {
    const gesehen = new Set<number>()
    return this.sichtbar().filter((e) => {
      const g = e.gruppe ?? -1
      if (g < 0) return true
      if (gesehen.has(g)) return false
      gesehen.add(g)
      return true
    })
  })

  /** Alle Eintraege derselben Gruppe - dasselbe Werk in allen Diensten. */
  protected geschwister(e: Eintrag): Eintrag[] {
    const g = e.gruppe ?? -1
    if (g < 0) return [e]
    const alle = this.eintraege().filter((x) => (x.gruppe ?? -1) === g)
    return alle.length ? alle : [e]
  }

  /** Alle Fassungen eines Werkes entfernen. */
  protected async gruppeEntfernen(e: Eintrag): Promise<void> {
    const alle = this.geschwister(e)
    if (!this.sicher(`gruppe:${e.schluessel}`)) return
    for (const q of alle) {
      try {
        await firstValueFrom(this.http.delete(`/api/medien/${encodeURIComponent(q.schluessel)}`))
      } catch {
        this.meldung.set('Nicht alles konnte entfernt werden.')
      }
    }
    await this.laden()
  }

  /**
   * Fuer EINEN Eintrag nachsehen, ob es ihn auch woanders gibt.
   *
   * Auf Zuruf, nicht von selbst: jede Pruefung ist eine Suche bei den
   * Diensten, und die Bibliothek beim Oeffnen der Seite komplett
   * durchzufragen waere teuer und meist umsonst.
   */
  protected async andereSuchen(e: Eintrag): Promise<void> {
    await this.andereSuchenSchluessel(e.schluessel)
  }

  /**
   * Dasselbe ueber den blanken Schluessel.
   *
   * Die Aufraeum-Karte hat keinen ganzen `Eintrag` in der Hand, sondern einen
   * Vorschlag — und sie braucht diesen Weg besonders: „neu verknuepfen" ist
   * bei einem verschwundenen Werk der bessere Ausgang als „entfernen".
   */
  protected async andereSuchenSchluessel(schluessel: string): Promise<void> {
    if (this.pruefe()) return
    this.pruefe.set(schluessel)
    try {
      const d = await firstValueFrom(
        this.http.get<{ angebote: Treffer[] }>(`/api/medien/${encodeURIComponent(schluessel)}/andere`),
      )
      this.angebote.update((m) => ({ ...m, [schluessel]: d.angebote ?? [] }))
    } catch {
      this.meldung.set('Die anderen Dienste konnten nicht gefragt werden.')
    } finally {
      this.pruefe.set('')
    }
  }

  /**
   * Die ganze (gefilterte) Bibliothek pruefen.
   *
   * NACHEINANDER, nicht alle auf einmal: es sind fremde Dienste, und ein
   * Schwall gleichzeitiger Anfragen bringt eher eine Bremse als Tempo.
   */
  protected async alleAndereSuchen(): Promise<void> {
    if (this.pruefeAlle()) return
    this.pruefeAlle.set(true)
    try {
      for (const e of this.sichtbar()) {
        if (this.angebote()[e.schluessel]) continue
        await this.andereSuchen(e)
      }
    } finally {
      this.pruefeAlle.set(false)
    }
  }

  /**
   * Alle gefundenen Angebote auf einmal - je Eintrag, ueber die ganze Liste.
   *
   * Der haeufige Fall nach einer Pruefung ist „ja, alles davon" - und das
   * einzeln anzuklicken ist Arbeit ohne Entscheidung.
   */
  protected readonly offeneAngebote = computed(() => {
    const m = this.angebote()
    const sichtbar = new Set(this.sichtbarGefasst().map((e) => e.schluessel))
    const raus: { eintrag: Eintrag; angebot: Treffer }[] = []
    for (const e of this.sichtbarGefasst()) {
      if (!sichtbar.has(e.schluessel)) continue
      for (const a of m[e.schluessel] ?? []) raus.push({ eintrag: e, angebot: a })
    }
    return raus
  })

  protected async alleAngeboteUebernehmen(): Promise<void> {
    const alle = this.offeneAngebote()
    if (!alle.length || this.uebernehme()) return
    if (!this.sicher('alleangebote')) return
    this.uebernehme.set(true)
    this.uebernommen.set(0)
    let fehler = 0
    try {
      // NACHEINANDER: jede Aufnahme schreibt die Bibliothek, und die Datei
      // wird unter Sperre geschrieben - gleichzeitige Schreiber wuerden sich
      // gegenseitig abweisen.
      for (const { eintrag, angebot } of alle) {
        try {
          await this.angebotAufnehmen(eintrag, angebot)
        } catch {
          fehler++
        }
        this.uebernommen.update((n) => n + 1)
      }
      this.meldung.set(
        fehler ? `${alle.length - fehler} aufgenommen, ${fehler} nicht.` : `${alle.length} Fassungen aufgenommen.`,
      )
    } finally {
      this.uebernehme.set(false)
    }
  }

  /** Ein Angebot annehmen - dasselbe Werk zusaetzlich aus dem anderen Dienst. */
  protected async angebotAufnehmen(e: Eintrag, q: Treffer): Promise<void> {
    await this.aufnehmen({ ...q, title: e.title ?? q.title })
    this.angebote.update((m) => ({
      ...m,
      [e.schluessel]: (m[e.schluessel] ?? []).filter((x) => x.schluessel !== q.schluessel),
    }))
  }

  protected async kategorieSetzen(e: Eintrag, kategorie: string): Promise<void> {
    try {
      // Die GANZE Gruppe: wer eine Zeile sieht, erwartet auch eine Wirkung.
      const ziele = this.geschwister(e).map((x) => x.schluessel)
      for (const s of ziele) {
        await firstValueFrom(this.http.patch(`/api/medien/${encodeURIComponent(s)}`, { category: kategorie }))
      }
      this.eintraege.update((liste) =>
        liste.map((x) => (ziele.includes(x.schluessel) ? { ...x, category: kategorie } : x)),
      )
    } catch {
      this.meldung.set('Die Kategorie konnte nicht geändert werden.')
      void this.laden()
    }
  }

  protected async entfernen(e: Eintrag): Promise<void> {
    if (!this.sicher(`weg:${e.schluessel}`)) return
    try {
      await firstValueFrom(this.http.delete(`/api/medien/${encodeURIComponent(e.schluessel)}`))
      await this.laden()
      this.meldung.set(`„${e.title}" entfernt.`)
    } catch {
      this.meldung.set('Konnte nicht entfernt werden.')
    }
  }

  /** Welche ART ein Bibliothekseintrag ist - Album, Liste, Hoerbuch. */
  protected artVonEintrag(e: Eintrag): string {
    const t = String(e.type ?? '').toLowerCase()
    if (t === 'radio') return 'Radio'
    if (t === 'rss') return 'Podcast'
    if (t === 'library' || t === 'local') return 'Ordner'
    // Eine ARD-Sendung ist eine Folgenreihe und traegt ihre Kennung in `id`;
    // ohne diese Zeile stuende „Album" darunter, was sie nie ist (dieselbe
    // Entscheidung wie `artVon` in backend-api/src/werke.ts).
    if (t === 'ard') return 'Sendung'
    if (e['playlistid']) return 'Liste'
    if (e['showid'] || e['audiobookid']) return 'Hörbuch'
    return 'Album'
  }

  /**
   * Welchem Dienst ein Eintrag gehoert — die EINE Abbildung dieser Seite.
   *
   * SIE STAND HIER ZWEIMAL (bis 04.08.2026): einmal so und einmal in
   * `dienstName()` als Kette von Fragezeichen-Operatoren, mit leicht anderem
   * Ergebnis. `dienstName` kannte `radio` und `rss` und fiel bei allem
   * uebrigen auf 'anderes'; diese hier gab den rohen Typ zurueck. Der
   * Unterschied fiel nicht auf, weil beide fuer die drei haeufigen Faelle
   * dasselbe sagten — bis `ard` dazukam: die Bibliothek beschriftete
   * ARD-Eintraege als „Anderes", waehrend das Farbzeichen daneben `ard` hiess.
   *
   * NACHGEZOGEN GEGEN `dienstVon()` (backend-api/src/medien.ts): unbekannt ist
   * 'anderes' und nicht der rohe Typ. Sonst schluepft jeder Tippfehler in
   * data.json als eigener „Dienst" durch die Anzeige.
   */
  protected dienstSchluessel(e: Eintrag): string {
    const t = String(e.type ?? '').toLowerCase()
    if (t.startsWith('spotify')) return 'spotify'
    if (t.startsWith('jellyfin')) return 'jellyfin'
    if (t === 'library' || t === 'local') return 'lokal'
    if (t === 'radio') return 'radio'
    if (t === 'rss') return 'rss'
    if (t === 'ard') return 'ard'
    // EIN EINZIGES MITGLIED FUER ALLE PLUGINS (E87), wie in dienstVon()
    // (backend-api/src/medien.ts): WELCHES Plugin gemeint ist, steht in `id`,
    // nicht im Dienstschluessel.
    if (t === 'plugin') return 'plugin'
    return 'anderes'
  }

  protected dauer(ms: number): string {
    const s = Math.round(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  /**
   * Bestaetigen OHNE Fenster: der Knopf fragt selbst nach.
   *
   * Der erste Klick schaltet ihn auf „wirklich?", der zweite fuehrt aus; nach
   * vier Sekunden faellt er von allein zurueck. Kein Fenster, das man
   * wegklicken muss - und trotzdem kein Versehen, denn zwei Klicks an
   * derselben Stelle passieren nicht zufaellig.
   */
  protected readonly fragt = signal('')
  private fragtTimer: ReturnType<typeof setTimeout> | undefined

  protected sicher(schluessel: string): boolean {
    if (this.fragt() === schluessel) {
      this.fragtAus()
      return true
    }
    this.fragt.set(schluessel)
    if (this.fragtTimer) clearTimeout(this.fragtTimer)
    this.fragtTimer = setTimeout(() => this.fragt.set(''), 4000)
    return false
  }

  private fragtAus(): void {
    if (this.fragtTimer) clearTimeout(this.fragtTimer)
    this.fragt.set('')
  }

  /** Lange Listennamen im Knopf kuerzen, damit die Zeile nicht bricht. */
  protected kurz(s: string): string {
    return s.length > 24 ? `${s.slice(0, 23)}…` : s
  }

  protected katName(k: string): string {
    return KATEGORIE_NAME[k] ?? k
  }

  /** Der Klartextname — ueber `dienstSchluessel()`, nicht ueber eine zweite Kette. */
  protected dienstName(e: Eintrag): string {
    const d = this.dienstSchluessel(e)
    return DIENST_NAME[d] ?? d
  }

  /**
   * Die Art eines SUCHTREFFERS in Klartext.
   *
   * `dienst` MUSS mit, seit die ARD im selben Topf sucht (04.08.2026): Ihre
   * Treffer sind `art: 'show'` wie ein Spotify-Hörbuch, aber eine Sendung der
   * Audiothek ist eine Folgenreihe und kein Hörbuch. Die Bibliothek darunter
   * beschriftet sie über `artVonEintrag()` als „Sendung" — stünde hier
   * „Hörbuch", trüge dasselbe Werk vor und nach dem Aufnehmen zwei Namen.
   */
  protected artName(a: string, dienst?: string): string {
    if (a === 'show' && dienst === 'ard') return 'Sendung'
    return a === 'album' ? 'Album' : a === 'playlist' ? 'Liste' : a === 'show' ? 'Hörbuch' : a
  }
}
