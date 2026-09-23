import type { Routes } from '@angular/router'
import { wache } from './wache'

export const ROUTEN: Routes = [
  {
    path: 'anmeldung',
    title: 'Anmelden – MixPiBox',
    loadComponent: () => import('./seiten/anmeldung').then((m) => m.AnmeldeSeite),
  },
  {
    // Die Wache sitzt HIER, am Rahmen — nicht an jeder Unterseite. Eine
    // vergessene Unterseite waere sonst offen, und genau das faellt niemandem
    // auf, bis es zu spaet ist.
    path: '',
    canActivate: [wache],
    loadComponent: () => import('./rahmen').then((m) => m.Rahmen),
    children: [
      {
        path: '',
        title: 'Verwaltung – MixPiBox',
        loadComponent: () => import('./seiten/uebersicht').then((m) => m.UebersichtSeite),
      },
      {
        path: 'darstellung',
        title: 'Darstellung – MixPiBox',
        loadComponent: () => import('./seiten/darstellung').then((m) => m.DarstellungSeite),
      },
      {
        // DER WEG BLEIBT `dienste`, die Seite heisst seit 03.08.2026
        // „Systemdienste". Umbenannt wurde die UEBERSCHRIFT, damit sie sich
        // nicht mehr mit „Streaming-Dienste" verwechseln laesst; der Weg
        // bleibt, damit kein Lesezeichen zerbricht.
        path: 'dienste',
        title: 'Systemdienste – MixPiBox',
        loadComponent: () => import('./seiten/dienste').then((m) => m.DiensteSeite),
      },
      {
        // Eigene Seite und keine Karte auf „Medien": hier steht nicht, WAS in
        // der Bibliothek liegt, sondern WOHER es kommen kann — samt der Frage,
        // ob der Anbieter ueberhaupt eingerichtet ist. Das ist die erste
        // Frage beim Aufsetzen einer Box und hatte bisher keinen Ort.
        path: 'streaming',
        title: 'Streaming-Dienste – MixPiBox',
        loadComponent: () => import('./seiten/streaming').then((m) => m.StreamingSeite),
      },
      {
        // WAS DER MITSCHNITT VORHAT UND GETAN HAT (E126, Stufe 1): die
        // Warteschlange, die Fertigen, die Fehler — aus der Liste des
        // Plugins, ohne eigene Wahrheit. Eigene Seite statt Karte auf
        // „Medien": die traegt schon vier Bloecke, und wer den Stand seiner
        // Aufnahmen sucht, sucht keinen Medien-Eintrag.
        path: 'aufzeichnen',
        title: 'Aufzeichnen – MixPiBox',
        loadComponent: () => import('./seiten/aufzeichnen').then((m) => m.AufzeichnenSeite),
      },
      {
        path: 'system',
        title: 'System – MixPiBox',
        loadComponent: () => import('./seiten/system').then((m) => m.SystemSeite),
      },
      {
        // NEBEN „System" UND NICHT DARIN (E58b, 20.08.2026): Die Systemseite
        // sagt „wie viel" (Temperatur, Platte, Last samt Kurve), diese sagt
        // „wofür" — welcher Posten den Speicher belegt und welcher Dienst den
        // Start aufgehalten hat. Zusammengelegt müsste man scrollen, um die
        // Auskunft zu finden, wegen der man gekommen ist.
        path: 'leistung',
        title: 'Leistung – MixPiBox',
        loadComponent: () => import('./seiten/leistung').then((m) => m.LeistungSeite),
      },
      {
        path: 'protokolle',
        title: 'Protokolle – MixPiBox',
        loadComponent: () => import('./seiten/protokolle').then((m) => m.ProtokolleSeite),
      },
      {
        path: 'aktualisierung',
        title: 'Aktualisierung – MixPiBox',
        loadComponent: () => import('./seiten/aktualisierung').then((m) => m.AktualisierungSeite),
      },
      {
        path: 'konfiguration',
        title: 'Konfiguration – MixPiBox',
        loadComponent: () => import('./seiten/konfiguration').then((m) => m.KonfigurationSeite),
      },
      {
        path: 'medien',
        title: 'Medien – MixPiBox',
        loadComponent: () => import('./seiten/medien').then((m) => m.MedienSeite),
      },
      {
        // UNTERSEITE VON „MEDIEN" (seit 03.08.2026): der Weg hierher steht auf
        // der Medienseite, nicht mehr in der Kopfleiste. Der PFAD ist der
        // gleiche geblieben, damit kein Lesezeichen ins Leere laeuft.
        //
        // Weiterhin eine eigene Seite und keine weitere Karte auf „Medien":
        // das Zusammenfassen hat einen eigenen Ablauf (abgleichen, trennen,
        // wieder zulassen) und eine eigene Ablage. Auf der Medienseite waere
        // es die fuenfte Karte untereinander, und die Aufraeumkarte darueber
        // loescht Eintraege — beides nebeneinander laedt zum Verwechseln ein.
        path: 'verschmelzung',
        title: 'Doppelte – MixPiBox',
        loadComponent: () => import('./seiten/verschmelzung').then((m) => m.VerschmelzungSeite),
      },
      {
        // Ebenfalls UNTERSEITE VON „MEDIEN" (seit 03.08.2026), Pfad unveraendert.
        //
        // Wieder eine eigene Seite und keine Karte auf „Medien", aus demselben
        // Grund wie bei „Doppelte": Diese Entscheidungen liegen in einer
        // EIGENEN Ablage (config/interpreten.json) und ruehren die Bibliothek
        // nicht an — waehrend die Karte darueber Eintraege loescht. Beides
        // untereinander laedt zum Verwechseln ein.
        path: 'interpreten',
        title: 'Interpreten – MixPiBox',
        loadComponent: () => import('./seiten/interpreten').then((m) => m.InterpretenSeite),
      },
      {
        path: 'kinderzeit',
        title: 'Profile – MixPiBox',
        loadComponent: () => import('./seiten/kinderzeit').then((m) => m.KinderzeitSeite),
      },
      {
        // BELOHNUNGS-VIDEOS (20.09.2026). Sie stehen bei „Was man sieht und
        // hoert" und nicht bei „Was da ist": hier wird nicht die Bibliothek
        // gepflegt, sondern entschieden, was ein Kind zu sehen bekommt — und
        // zwar je Kind. Die Suche greift auf das Plugin `mixpi-mediathek` zu,
        // die Freigabe auf den Kern.
        path: 'videos',
        title: 'Videos – MixPiBox',
        loadComponent: () => import('./seiten/videos').then((m) => m.VideosSeite),
      },
      {
        path: 'vorlesen',
        title: 'Vorlesen – MixPiBox',
        loadComponent: () => import('./seiten/vorlesen').then((m) => m.VorlesenSeite),
      },
      {
        // EIGENE SEITE SEIT DEM 20.09.2026 (Betreiber: „ich moechte den spiel
        // bereich seperat einschalten koennen") — der Schalter sass einen Tag
        // lang auf der Vorlesen-Seite und hatte dort nie etwas zu suchen.
        path: 'spiele',
        title: 'Spiele – MixPiBox',
        loadComponent: () => import('./seiten/spiele').then((m) => m.SpieleSeite),
      },
      {
        path: 'bluetooth',
        title: 'Bluetooth – MixPiBox',
        loadComponent: () => import('./seiten/bluetooth').then((m) => m.BluetoothSeite),
      },
      {
        // DER TON HAT SEIT DEM 15.08.2026 SEINE EIGENE SEITE (Betreiber:
        // „ich würde den ton jetzt gerne in einem eigenen tab haben") —
        // Bluetooth behaelt die Schnittstelle, hier wird gehoert.
        path: 'ton',
        title: 'Ton – MixPiBox',
        loadComponent: () => import('./seiten/ton').then((m) => m.TonSeite),
      },
      {
        path: 'netzwerk',
        title: 'Netzwerk – MixPiBox',
        loadComponent: () => import('./seiten/netzwerk').then((m) => m.NetzwerkSeite),
      },
      {
        // NEBEN „Netzwerk" UND NICHT DARIN (BACKLOG E30): die Netzwerkseite
        // sagt, wie die Box IN IHR Netz kommt — diese hier, wie das Heimnetz
        // ZU EINER MITGENOMMENEN Box kommt. Zusammengelegt stünde der
        // WireGuard-Block unter den gespeicherten WLANs, und wer eines von
        // beidem sucht, findet erst das andere.
        path: 'vpn',
        title: 'VPN – MixPiBox',
        loadComponent: () => import('./seiten/vpn').then((m) => m.VpnSeite),
      },
      {
        // NEBEN „VPN" UND UNTER „Was die Box ist": hier wird eine FREMDE
        // Freigabe EINGEBUNDEN (Sicherungen, Mitschnitte) — das ist etwas
        // anderes als die Frage, wie die Box in ihr Netz kommt (Netzwerk)
        // oder wie das Heimnetz zu einer mitgenommenen Box kommt (VPN).
        path: 'netzlaufwerk',
        title: 'Netzlaufwerk – MixPiBox',
        loadComponent: () => import('./seiten/netzlaufwerk').then((m) => m.NetzlaufwerkSeite),
      },
      {
        // NEBEN „Netzlaufwerk" UND UNTER „Was die Box ist": hier wird ein
        // Weg von DRAUSSEN nach herein geoeffnet — naeher an VPN und
        // Netzlaufwerk als an „Was man sieht und hoert". Die Schalter und
        // Zugaenge der drei Wege stehen unter Konfiguration -> Melden; hier
        // steht, WER durchkommt und ob etwas ankommt.
        path: 'nachrichten',
        title: 'Nachrichten – MixPiBox',
        loadComponent: () => import('./seiten/nachrichten').then((m) => m.NachrichtenSeite),
      },
      {
        path: 'mupihat',
        title: 'MuPiHAT – MixPiBox',
        loadComponent: () => import('./seiten/mupihat').then((m) => m.MupihatSeite),
      },
      {
        path: 'plugins',
        title: 'Plugins – MixPiBox',
        loadComponent: () => import('./seiten/plugins').then((m) => m.PluginsSeite),
      },
      {
        // JEDE ERWEITERUNG BEKOMMT EINEN ORT, den man verlinken und
        // wiederfinden kann. Der Menuepunkt „Plugins" bleibt dabei
        // hervorgehoben — `leuchtet()` in rahmen.ts kennt seit dem 14.08.2026
        // verschachtelte Wege.
        path: 'plugins/:kennung',
        title: 'Erweiterung – MixPiBox',
        loadComponent: () => import('./seiten/plugin-eine').then((m) => m.PluginEineSeite),
      },
      {
        // DER RUECKWEG AUS ALLEM ANDEREN (BACKLOG E29/B3). Er liegt hinter
        // derselben Wache wie jede andere Seite — und ausdruecklich NICHT
        // hinter einer zweiten: ein Schutz, der den Rueckweg verschliesst,
        // ist kein Schutz (Herleitung in src/backend-api/src/sicherung.ts,
        // Frage 4).
        path: 'sicherung',
        title: 'Sicherung – MixPiBox',
        loadComponent: () => import('./seiten/sicherung').then((m) => m.SicherungSeite),
      },
    ],
  },
  { path: '**', redirectTo: '' },
]
