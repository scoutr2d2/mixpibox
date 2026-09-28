import 'dart:io';

import 'package:flutter/material.dart';

import '../ablage.dart';
import '../box_client.dart';
import '../modell.dart';
import '../zustand.dart';
import 'dialoge.dart';
import 'versuchen.dart';

/// Sichern und zurückspielen (28.09.2026) — Betreiber: „handy app: … backup".
/// Per Rückfrage: sichern UND zurückspielen.
///
/// DIESELBEN WEGE WIE DIE SEITE „SICHERUNG" DER VERWALTUNG (sicherung.ts). Die
/// Box legt den Stand mit ihrem eigenen Werkzeug an (mupibox-sicherung.py);
/// die App holt ihn nur aufs Handy. Das Handy ist dabei GENAU der zweite Ort,
/// der sonst fehlt: ein Stand, der nur auf der Karte der Box liegt, stirbt
/// mit ihr (llmwiki `was-die-sicherung-nicht-traegt`, Lücke 3).
///
/// ZURÜCKSPIELEN IN ZWEI SCHRITTEN, wie in der Verwaltung: erst prüft die Box
/// die Datei TROCKEN und sagt, was geschehen würde — erst ein zweiter,
/// ausdrücklicher Tipp spielt ein, und nur genau die geprüften Bytes (die Box
/// vergleicht die Kennung).
class SicherungSeite extends StatefulWidget {
  const SicherungSeite({super.key, required this.stand, required this.box, this.ablage = const Ablage()});
  final BoxenStand stand;
  final BoxEintrag box;

  /// Wohin gesichert und woraus gewählt wird. Austauschbar für Tests.
  final Ablage ablage;

  @override
  State<SicherungSeite> createState() => _SicherungSeiteState();
}

class _SicherungSeiteState extends State<SicherungSeite> {
  BoxClient get c => widget.stand.client(widget.box);

  SicherungsLage? _lage;
  bool _geladen = false;

  /// Was gerade läuft — ein Satz, oder null. Solange er steht, nimmt die
  /// Seite keinen zweiten Auftrag an (die Box weist parallele Läufe ohnehin
  /// mit 409 ab).
  String? _arbeit;
  bool _mitZugangsdaten = false;

  Future<T?> _versuchen<T>(Future<T> Function() tat) => mitBoxVersuchen(context, widget.stand, widget.box, tat);

  @override
  void initState() {
    super.initState();
    _laden();
  }

  Future<void> _laden() async {
    final l = await _versuchen(c.sicherungLage);
    if (!mounted) return;
    setState(() {
      _geladen = true;
      _lage = l ?? _lage;
    });
  }

  Future<void> _mitArbeit(String was, Future<void> Function() tat) async {
    if (_arbeit != null) return;
    setState(() => _arbeit = was);
    try {
      await tat();
    } finally {
      if (mounted) setState(() => _arbeit = null);
    }
  }

  // ── Sichern ─────────────────────────────────────────────────────────

  Future<String?> _passwortZweimal(int min) async {
    final eins = TextEditingController();
    final zwei = TextEditingController();
    String? fehler;
    return showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, neu) => AlertDialog(
          title: const Text('Passwort für die Zugangsdaten'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Spotify, WLAN und Co. kommen verschlüsselt in die Datei. Ohne dieses Passwort lassen sie sich '
                'nie wieder einspielen — die App merkt es sich nicht.',
              ),
              TextField(
                controller: eins,
                obscureText: true,
                decoration: InputDecoration(labelText: 'Passwort (mindestens $min Zeichen)'),
              ),
              TextField(
                controller: zwei,
                obscureText: true,
                decoration: InputDecoration(labelText: 'Noch einmal', errorText: fehler),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Abbrechen')),
            FilledButton(
              onPressed: () {
                if (eins.text.length < min) {
                  neu(() => fehler = 'Zu kurz — mindestens $min Zeichen.');
                } else if (eins.text != zwei.text) {
                  neu(() => fehler = 'Die beiden sind nicht gleich.');
                } else {
                  Navigator.pop(ctx, eins.text);
                }
              },
              child: const Text('OK'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _sichern() async {
    String? passwort;
    if (_mitZugangsdaten) {
      passwort = await _passwortZweimal(_lage?.passwortMin ?? 8);
      if (passwort == null || !mounted) return;
    }
    await _mitArbeit('Die Box legt den Stand an …', () async {
      File? zwischen;
      try {
        zwischen = await widget.ablage.zwischenDatei();
        final ziel = zwischen;
        final name = await _versuchen(() => c.sicherungAnlegen(ziel, passwort: passwort));
        if (name == null) return;
        final ort = await widget.ablage.inDownloads(ziel, name, mime: 'application/gzip');
        zwischen = null;
        if (mounted) meldung(context, 'Gesichert: $ort');
      } catch (e) {
        if (mounted) meldung(context, 'Sichern ging nicht: $e');
      } finally {
        if (zwischen != null && await zwischen.exists()) await zwischen.delete();
      }
    });
    await _laden();
  }

  Future<void> _holen(SicherungsStand s) => _mitArbeit('Hole ${s.name} …', () async {
    File? zwischen;
    try {
      zwischen = await widget.ablage.zwischenDatei();
      final ziel = zwischen;
      final name = await _versuchen(() => c.sicherungHolen(s.name, ziel));
      if (name == null) return;
      final ort = await widget.ablage.inDownloads(ziel, name, mime: 'application/gzip');
      zwischen = null;
      if (mounted) meldung(context, 'Gespeichert: $ort');
    } catch (e) {
      if (mounted) meldung(context, 'Speichern ging nicht: $e');
    } finally {
      if (zwischen != null && await zwischen.exists()) await zwischen.delete();
    }
  });

  // ── Zurückspielen ───────────────────────────────────────────────────

  Future<void> _zurueckspielen() async {
    ({File datei, String name})? wahl;
    try {
      wahl = await widget.ablage.waehlen();
    } catch (e) {
      if (mounted) meldung(context, 'Datei wählen ging nicht: $e');
      return;
    }
    if (wahl == null || !mounted) return;
    final gewaehlt = wahl;
    ZurueckVorschau? vorschau;
    try {
      await _mitArbeit('Die Box prüft ${gewaehlt.name} …', () async {
        vorschau = await _versuchen(() => c.sicherungPruefen(gewaehlt.datei));
      });
    } finally {
      // Die Box hat die Bytes jetzt selbst (Eingang, 30 min) — die Kopie auf
      // dem Handy wird nicht mehr gebraucht.
      if (await gewaehlt.datei.exists()) await gewaehlt.datei.delete();
    }
    final v = vorschau;
    if (v == null || !mounted) return;
    final entscheid = await showDialog<({String? passwort})>(
      context: context,
      builder: (_) => _VorschauDialog(vorschau: v, dateiname: gewaehlt.name, box: widget.box.name),
    );
    if (entscheid == null || !mounted) return;
    Map<String, dynamic>? ergebnis;
    await _mitArbeit('Die Box spielt zurück …', () async {
      ergebnis = await _versuchen(() => c.sicherungZurueckspielen(v.kennung, passwort: entscheid.passwort));
    });
    final e = ergebnis;
    if (e == null || !mounted) return;
    await _ergebnisZeigen(e);
    await _laden();
  }

  Future<void> _ergebnisZeigen(Map<String, dynamic> e) async {
    final vonHand = [for (final v in (e['vonHand'] as List? ?? const [])) '$v'];
    final vorher = e['vorherStand'];
    final neustart = e['neustartNoetig'] == true;
    final jetztNeu = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Zurückgespielt'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('${e['satz'] ?? ''}'),
              if (vorher is String && vorher.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text('Der Stand von vorher liegt auf der Box: $vorher', style: Theme.of(ctx).textTheme.bodySmall),
              ],
              if (vonHand.isNotEmpty) ...[
                const SizedBox(height: 8),
                const Text('Von Hand nachtragen:', style: TextStyle(fontWeight: FontWeight.w600)),
                for (final v in vonHand) Text('• $v'),
              ],
              if (neustart) ...[
                const SizedBox(height: 8),
                const Text('Damit alles greift, sollte die Box neu starten.'),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(neustart ? 'Später' : 'OK')),
          if (neustart) FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Jetzt neu starten')),
        ],
      ),
    );
    if (jetztNeu == true && mounted) {
      final ok = await _versuchen(() async {
        await c.neustarten();
        return true;
      });
      if (ok == true && mounted) meldung(context, '${widget.box.name} startet neu.');
    }
  }

  // ── Aufbau ──────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final l = _lage;
    final klein = Theme.of(context).textTheme.bodySmall;
    return Scaffold(
      appBar: AppBar(title: const Text('Sicherung')),
      body: !_geladen
          ? const Center(child: CircularProgressIndicator())
          : l == null
          ? Center(child: TextButton(onPressed: _laden, child: const Text('Noch einmal versuchen')))
          : RefreshIndicator(
              onRefresh: _laden,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 32),
                children: [
                  if (_arbeit != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                          const SizedBox(width: 12),
                          Expanded(child: Text(_arbeit!)),
                        ],
                      ),
                    ),
                  if (!l.werkzeugDa)
                    Card(
                      color: Theme.of(context).colorScheme.errorContainer,
                      child: const ListTile(
                        leading: Icon(Icons.error_outline),
                        title: Text('Auf dieser Box fehlt das Sicherungswerkzeug.'),
                      ),
                    ),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Sichern', style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 4),
                          const Text(
                            'Legt einen frischen Stand an und speichert ihn auf diesem Handy unter Download/MixPiBox: '
                            'Bibliothek, Profile, gemerkte Stellen, Kinderzeit, Einstellungen.',
                          ),
                          CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            value: _mitZugangsdaten,
                            onChanged: (v) => setState(() => _mitZugangsdaten = v == true),
                            title: const Text('Zugangsdaten mitnehmen'),
                            subtitle: const Text('Spotify, WLAN … verschlüsselt mit einem Passwort'),
                          ),
                          FilledButton.icon(
                            onPressed: _arbeit != null || !l.werkzeugDa ? null : _sichern,
                            icon: const Icon(Icons.save_alt),
                            label: const Text('Jetzt sichern'),
                          ),
                          const SizedBox(height: 8),
                          // WORTGLEICH VON DER BOX (ABLAGE_HINWEISE) — nicht abgeschrieben.
                          for (final h in l.hinweise)
                            Padding(padding: const EdgeInsets.only(top: 4), child: Text('• $h', style: klein)),
                        ],
                      ),
                    ),
                  ),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Zurückspielen', style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 4),
                          const Text(
                            'Eine Sicherung wählen. Die Box prüft sie zuerst und sagt, was sich ändern würde — '
                            'eingespielt wird erst nach deinem Ja. Vorher legt die Box selbst einen Stand an.',
                          ),
                          const SizedBox(height: 8),
                          OutlinedButton.icon(
                            onPressed: _arbeit != null || !l.werkzeugDa ? null : _zurueckspielen,
                            icon: const Icon(Icons.settings_backup_restore),
                            label: const Text('Datei wählen …'),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (l.anmeldungOffen)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      child: Text(
                        'Die Verwaltung dieser Box hat kein Passwort: jeder im WLAN kann sichern und zurückspielen.',
                        style: klein?.copyWith(color: Theme.of(context).colorScheme.error),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(8, 16, 8, 4),
                    child: Text('Stände auf der Box (${l.staende.length})', style: Theme.of(context).textTheme.titleMedium),
                  ),
                  if (l.staende.isEmpty)
                    const Padding(padding: EdgeInsets.all(8), child: Text('Noch keiner.')),
                  for (final s in l.staende)
                    ListTile(
                      leading: Icon(s.zugangsdaten > 0 ? Icons.lock_outline : Icons.inventory_2_outlined),
                      title: Text(s.erzeugt == null ? s.name : _datum(s.erzeugt!)),
                      subtitle: Text(
                        s.fehler.isNotEmpty
                            ? s.fehler
                            : [
                                _grund(s.grund),
                                '${s.dateien} Dateien',
                                if (s.zugangsdaten > 0) '${s.zugangsdaten} Zugangsdaten',
                                _kb(s.bytes),
                              ].where((x) => x.isNotEmpty).join(' · '),
                      ),
                      trailing: IconButton(
                        tooltip: 'Aufs Handy holen',
                        icon: const Icon(Icons.download),
                        onPressed: _arbeit != null || s.fehler.isNotEmpty ? null : () => _holen(s),
                      ),
                    ),
                ],
              ),
            ),
    );
  }

  static String _datum(DateTime d) =>
      '${d.day}.${d.month}.${d.year}, ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

  static String _kb(int bytes) => bytes <= 0 ? '' : '${(bytes / 1024).ceil()} KB';

  /// Wer den Stand anlegte, in Worten. Unbekanntes bleibt, wie es ist.
  static String _grund(String g) => switch (g) {
    'verwaltung' || 'von-hand' => 'von Hand',
    'selbsttaetig' => 'automatisch',
    'vorher' => 'vor dem Zurückspielen',
    _ when g.startsWith('vor-update') => 'vor einem Update',
    _ => g,
  };
}

/// Die Vorschau der Box — und die Frage, ob wirklich eingespielt werden soll.
/// Zurueck: `(passwort: …)` zum Einspielen (null = ohne Zugangsdaten), oder
/// null = abgebrochen.
class _VorschauDialog extends StatefulWidget {
  const _VorschauDialog({required this.vorschau, required this.dateiname, required this.box});
  final ZurueckVorschau vorschau;
  final String dateiname;
  final String box;

  @override
  State<_VorschauDialog> createState() => _VorschauDialogState();
}

class _VorschauDialogState extends State<_VorschauDialog> {
  final _pw = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final v = widget.vorschau;
    final f = Theme.of(context).colorScheme;
    return AlertDialog(
      title: Text('Auf ${widget.box} zurückspielen?'),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.dateiname, style: Theme.of(context).textTheme.bodySmall),
            if (v.erzeugt != null || v.host.isNotEmpty)
              Text(
                [
                  if (v.erzeugt != null) 'vom ${_SicherungSeiteState._datum(v.erzeugt!)}',
                  if (v.host.isNotEmpty) 'Box „${v.host}"',
                  '${v.dateien} Dateien',
                ].join(' · '),
              ),
            const SizedBox(height: 8),
            Text(v.satz, style: const TextStyle(fontWeight: FontWeight.w600)),
            for (final w in v.warnungen)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.warning_amber, size: 18, color: f.error),
                    const SizedBox(width: 6),
                    Expanded(child: Text(w)),
                  ],
                ),
              ),
            if (v.zugangsdaten > 0) ...[
              const SizedBox(height: 12),
              Text('Darin liegen ${v.zugangsdaten} Zugangsdaten, verschlüsselt. Mit ihrem Passwort kommen sie mit; leer lassen = ohne.'),
              TextField(
                controller: _pw,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Passwort der Zugangsdaten'),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Abbrechen')),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: f.error, foregroundColor: f.onError),
          onPressed: () => Navigator.pop(context, (passwort: _pw.text.isEmpty ? null : _pw.text)),
          child: const Text('Zurückspielen'),
        ),
      ],
    );
  }
}
