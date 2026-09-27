#!/usr/bin/env python3
"""
Boxlisten je Profil — haelt die Behauptung stand?

BEHAUPTUNG: "Boxlisten (eigene Zusammenstellungen) — je Kind eine eigene
Ablage" gilt JE PROFIL (server/config/profile/<kennung>/listen.json,
GET /api/listen).

Diese Probe misst NICHT, ob das FELD profilbewusst ist — das ist es. Sie misst
die drei Stellen, an denen so eine Behauptung ueblicherweise bricht:

  1. LESER — liest ueberhaupt jemand die Listen wieder aus? Die Kinder-
     Oberflaeche (www/) ist der einzige Ort, an dem eine Liste einem Kind
     etwas nuetzt.
  2. WEG — bietet die Oberflaeche, in der Listen ENTSTEHEN (www-admin/),
     einen Weg zum Profil? Ohne Profilwechsler und ohne Profilanzeige
     entscheidet nicht der Betreiber, wem eine Liste gehoert.
  3. TRAEGER — haengt die Zuordnung am Profil oder am Browser?

NUR LESEND: ls/cat/grep ueber ssh, GET auf :8200. Kein Schreibzugriff.

  python3 tools/boxlisten-je-profil-probe.py
  python3 tools/boxlisten-je-profil-probe.py --box 192.168.178.169
"""

import argparse
import json
import subprocess
import sys

WURZEL = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"


def ssh(host, befehl, benutzer="dietpi"):
    r = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes",
         f"{benutzer}@{host}", befehl],
        capture_output=True, text=True, timeout=60,
    )
    return r.stdout.strip()


def hole(host, pfad, port=8200):
    r = subprocess.run(
        ["curl", "-s", "--max-time", "15", f"http://{host}:{port}{pfad}"],
        capture_output=True, text=True, timeout=30,
    )
    try:
        return json.loads(r.stdout)
    except Exception:
        return None


def hat(host, verzeichnis, muster):
    """Kommt `muster` in irgendeiner ausgelieferten Datei unter `verzeichnis` vor?"""
    aus = ssh(host, f'grep -rl "{muster}" {WURZEL}/{verzeichnis}/ 2>/dev/null | head -3')
    return [z for z in aus.splitlines() if z.strip()]


def erreichbar(host):
    """Steht die Box ueberhaupt? EINMAL, vor jeder Messung.

    WARUM (24.08.2026): jede Zeile unten liest ueber `ssh` oder `curl`. Ist
    die Box aus, gibt `ssh` leeren Text und `hole` gibt None — und JEDER Test
    unten liest das als „nichts gefunden". Ohne diesen Riegel lief die Probe
    an der abgeschalteten Box durch bis zu „URTEIL: WIDERLEGT (zu
    optimistisch) — die Kinder-Oberflaeche liest die Listen NIE", ohne dass
    ein einziges Byte von der Box gekommen waere. Und sie ging mit 0: gruen
    fuer jeden Laeufer, falsch fuer jeden Leser.
    """
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
         f"dietpi@{host}", "echo da"],
        capture_output=True, text=True, timeout=20,
    )
    return r.stdout.strip() == "da"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--box", default="192.168.178.169")
    a = p.parse_args()
    h = a.box

    print("=" * 72)
    print("BOXLISTEN JE PROFIL — PROBE")
    print("=" * 72)

    if not erreichbar(h):
        print(f"\nABBRUCH: {h} antwortet nicht auf ssh — es wurde NICHTS gemessen.")
        print("Kein Urteil. Box einschalten und erneut laufen lassen.")
        return 2

    # --- Ablage --------------------------------------------------------------
    print("\n[1] ABLAGE — liegt je Profil eine eigene listen.json?")
    profile = [z for z in ssh(h, f"ls {WURZEL}/server/config/profile/").splitlines() if z.strip()]
    for prof in profile:
        da = ssh(h, f"test -f {WURZEL}/server/config/profile/{prof}/listen.json && cat {WURZEL}/server/config/profile/{prof}/listen.json || echo FEHLT")
        print(f"    profile/{prof:<10} listen.json: {da}")

    # --- API -----------------------------------------------------------------
    print("\n[2] API — was liefert GET /api/listen?")
    listen = hole(h, "/api/listen")
    profil_api = hole(h, "/api/profile")
    print(f"    /api/listen  -> {json.dumps(listen, ensure_ascii=False)}")
    if profil_api:
        print(f"    /api/profile -> aktiv={profil_api.get('aktiv')!r}, "
              f"profile={[x.get('kennung') for x in profil_api.get('profile', [])]}")
    print("    HINWEIS: /api/listen nimmt KEINE Kennung entgegen. Es liefert immer")
    print("             das serverweit AKTIVE Profil (profilAktiv()).")

    # --- Leser ---------------------------------------------------------------
    print("\n[3] LESER — kommen die Listen bei einem Kind an? (www/ = Box-Schirm)")
    box_liest = hat(h, "www", "api/listen")
    print(f"    www/ ruft /api/listen: {'JA -> ' + str(box_liest) if box_liest else 'NEIN — kein einziger Treffer'}")

    # --- Weg -----------------------------------------------------------------
    print("\n[4] WEG — kann der Betreiber dort, wo Listen ENTSTEHEN, das Profil waehlen?")
    admin_listen = hat(h, "www-admin", "api/listen")
    admin_wechsel = hat(h, "www-admin", "profil/aktiv")
    box_wechsel = hat(h, "www", "profil/aktiv")
    print(f"    www-admin/ ruft /api/listen:   {'JA' if admin_listen else 'NEIN'}")
    print(f"    www-admin/ ruft profil/aktiv:  {'JA' if admin_wechsel else 'NEIN — kein Profilwechsler'}")
    print(f"    www/ (Box) ruft profil/aktiv:  {'JA — nur hier wird gewechselt' if box_wechsel else 'NEIN'}")

    # --- Urteil --------------------------------------------------------------
    print("\n" + "=" * 72)
    bricht = []
    if not box_liest:
        bricht.append("die Kinder-Oberflaeche liest die Listen NIE — sie erscheinen nicht auf der Box")
    if admin_listen and not admin_wechsel:
        bricht.append("die Anlege-Oberflaeche hat KEINEN Profilwechsler — wem eine Liste "
                      "gehoert, entscheidet, welches Kind zuletzt an der Box war")
    if bricht:
        print("URTEIL: WIDERLEGT (zu optimistisch)")
        for z in bricht:
            print(f"  - {z}")
    else:
        print("URTEIL: haelt stand")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
