
## Mitschnitt im Hintergrund (Idee, NICHT gebaut — 2026-07-28)

Frage des Nutzers: kann die Box im Hintergrund aufzeichnen?

**Kurz: technisch ja, das Verfahren ist heute schon bewiesen.** `mupi-check
umschalten` nimmt bereits vom Mithoerausgang der Standardsenke auf
(`parec --device=<senke>.monitor`) — genau der Griff, den ein Recorder braucht.
Er stoert die Wiedergabe nicht.

**Es gibt das Werkzeug schon:** `~/Downloads/SpotifyRecorder` (spotcap) macht
genau das auf dem Rechner — Mitschnitt vom Sink-Monitor, Schnitt an den
Songgrenzen, getaggt inkl. Cover. Nicht neu erfinden, portieren.

**Was auf der Box BESSER ist als am Rechner:**
- spotcap schneidet an MPRIS-Ereignissen (`playerctl --follow`). librespot hat
  KEIN MPRIS (librespot-org Issue #1596, offen). Dafuer weiss die Box es selbst:
  `/player/state` (Spotify: Titel/Album/progress_ms) und `/player/local`
  (mpv). Eine lokale Quelle, die BEIDE Dienste abdeckt — ein Mitschnitt wuerde
  also auch Jellyfin/lokal sauber schneiden, nicht nur Spotify.
- Isolation braucht keinen Null-Sink: statt der Standardsenke kann man direkt
  librespots Sink-Input abgreifen, wenn nur Spotify gewollt ist.

**Was auf der Box SCHLECHTER ist:**
- `ffmpeg` und `fpcalc` FEHLEN (Stand 2026-07-28) — spotcap braucht ffmpeg zum
  Kodieren/Taggen. Nachinstallieren oder mit mpv/lame arbeiten.
- Rechenleistung teilt sie sich mit dem Kiosk: Pi 5, 4 Kerne, ~1,2 GB frei.
  Ein 320k-Encode nebenher ist machbar, aber es ist ein Kindergeraet — es darf
  nicht ruckeln.
- Platz ist kein Problem (108 GB frei). Roh-PCM ~10 MB/min, MP3 320k ~2,4 MB/min.
- **PipeWire legt eine untaetige Senke schlafen** — dann liefert parec GAR
  NICHTS (heute gemessen; sieht aus wie ein Messfehler, ist aber Stille). Ein
  Dauerlaeufer muesste die Senke wachhalten oder erst bei Wiedergabe anlaufen.

**Der ausgearbeitete Plan steht im Wiki: `mitschnitt-plan`** (Dienst-Anmeldung
kopie/mitschnitt/keins, Transparenz-Puffer, Bruchstuecke zusammensetzen,
Ablage, offene Entscheidungen).

Kernpunkt daraus, hier gemessen: **Jellyfin braucht gar keinen Mitschnitt** —
`/Audio/<id>/stream?static=true` liefert die ORIGINALDATEI (audio/mpeg, 8 MB,
Container mp3), und das ist genau die URL, die die Box ohnehin zum Abspielen
baut. Nur Spotify gibt die Datei nie heraus.

**Vor dem Bauen zu entscheiden:**
1. Dauerlaeufer mit Ringpuffer ("die letzten 20 Minuten sichern") oder erst bei
   Wiedergabestart? Letzteres ist stromsparender und vermeidet das Schlaf-Thema.
2. Alles mitschneiden (Standardsenke) oder nur Spotify (librespots Stream)?
3. Bruchstuecke zusammensetzen ODER Luecken nachts nachspielen — beides waere doppelt.
4. Wohin damit — SD (Achtung Schreibzyklen, / liegt auf mmcblk0p2), USB, Freigabe?

**Rechtslage:** der Nutzer hat das fuer spotcap selbst geprueft (Privatkopie
§53 UrhG, kein DRM-Bruch, aber Spotify-AGB verbieten es → Kontorisiko). Auf der
Box kommt dazu, dass es ein FAMILIENGERAET ist: ein Dauermitschnitt nimmt alles
auf, was die Kinder hoeren.
