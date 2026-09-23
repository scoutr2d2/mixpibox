#!/usr/bin/env python3
"""Was auf DIESER Box zur Verfuegung steht, bevor jemand E29/B6 baut.

WARUM ES DAS GIBT
Der Betreiber hat am 05.08.2026 entschieden: Zugangsdaten sollen MIT in die
Sicherung, aber VERSCHLUESSELT, und die Verschluesselung ist OPTIONAL mit
einem Passwort. Zusaetzlich soll `akkuverlauf.json` mitgehen.

Bevor davon eine Zeile gebaut wird, muessen fuenf Dinge GEMESSEN sein — an
der Box, nicht am Arbeitsrechner:

  A ZEUG        Was liegt an Kryptographie ueberhaupt bereit? Ein Verfahren,
                das auf dem Arbeitsrechner laeuft und auf der Box nicht, ist
                schlimmer als keines. Gefragt wird nach AEAD (Echtheits-
                pruefung), nicht nur nach „verschluesselt": ein falsches
                Passwort muss LAUT scheitern, nicht Unsinn einspielen.
  B ZEIGER      Welche der elf Stellen aus GEHEIM sind auf DIESER Box
                wirklich belegt, und wie viele Bytes waeren zu schuetzen?
                ES WIRD KEIN WERT ANGEZEIGT — nur Laenge und Vorhandensein.
                Ein Werkzeug, das Schluessel ins Journal schreibt, waere
                genau der Schaden, den die Verschluesselung verhindern soll.
  C AKKUVERLAUF Wie gross wird ein Stand, wenn die Messreihe mitgeht? Heute
                UND an ihrer Obergrenze (akkuverlauf.ts: MAX_PUNKTE = 10080,
                also sieben Tage im Minutentakt). Gemessen wird durch echtes
                Packen, nicht geschaetzt.
  D KARTE       Passt das noch auf die FAT-Partition? Wie viel ist frei, was
                liegt schon da, und was legte `--auf-karte` kuenftig hin?
  E WENN-ANDERS Was `--wenn-anders` tut, wenn eine Datei im Stand steht, die
                sich alle zehn Minuten aendert. Das ist die Nebenwirkung, die
                man beim Groessenrechnen uebersieht.

WAS DIESES WERKZEUG NICHT TUT: es aendert nichts. Es liest die Konfiguration
der Box, packt Wegwerf-Archive nach /tmp und raeumt sie wieder weg. Die
echten Staende in /home/dietpi/.mupibox/sicherungen werden weder gelesen noch
angefasst — ausser fuer die Groessenangabe in D.

AUFRUF (auf der Box)
    python3 sicherung-geheim-vorpruefung.py          # alles
    python3 sicherung-geheim-vorpruefung.py A C      # nur einzelne Abschnitte
    python3 sicherung-geheim-vorpruefung.py --json
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

SKRIPT = "/usr/local/bin/mupibox/mupibox-sicherung.py"
KARTE = "/boot/firmware"
KARTE_ORDNER = "mupibox-sicherung"
MAX_PUNKTE = 10080          # akkuverlauf.ts — sieben Tage im Minutentakt


def modul_laden(pfad: str):
    """Genau das laden, was auf der Box LIEGT — nicht, was im Baum steht."""
    spec = importlib.util.spec_from_file_location("mupibox_sicherung", pfad)
    if spec is None or spec.loader is None:
        raise SystemExit(f"{pfad} laesst sich nicht laden")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def kb(n: float) -> str:
    return f"{n / 1024:.1f} KB"


# ── A  Was an Kryptographie bereitliegt ────────────────────────────────────
def abschnitt_a() -> dict:
    print("A  WAS AN KRYPTOGRAPHIE BEREITLIEGT")
    aus: dict = {"python": sys.version.split()[0]}
    print(f"   python3                      {aus['python']}")

    # 1. python3-cryptography — das Naheliegende. AES-GCM/ChaCha20-Poly1305
    #    kaemen damit fertig aus der Bibliothek, ohne eine Zeile eigener
    #    Kryptographie.
    try:
        import cryptography                                    # noqa: F401
        aus["cryptography"] = cryptography.__version__
        try:
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            s = AESGCM(AESGCM.generate_key(bit_length=256))
            n = os.urandom(12)
            t = s.encrypt(n, b"probe", b"kopf")
            aus["aesgcm_geht"] = s.decrypt(n, t, b"kopf") == b"probe"
        except Exception as e:                                 # noqa: BLE001
            aus["aesgcm_geht"] = False
            aus["aesgcm_fehler"] = f"{type(e).__name__}: {e}"
    except ImportError:
        aus["cryptography"] = None
        aus["aesgcm_geht"] = False
    print(f"   python3-cryptography         {aus['cryptography'] or 'FEHLT'}"
          + ("  (AES-GCM laeuft)" if aus.get("aesgcm_geht") else ""))

    try:
        import nacl                                            # noqa: F401
        aus["pynacl"] = nacl.__version__
    except Exception:                                          # noqa: BLE001
        aus["pynacl"] = None
    print(f"   python3-nacl                 {aus['pynacl'] or 'FEHLT'}")

    # 2. Die Schluesselableitung ist NICHT das Problem: scrypt und pbkdf2
    #    stehen in der Standardbibliothek, hinter dem OpenSSL des Systems.
    import hashlib
    aus["hashlib_scrypt"] = hasattr(hashlib, "scrypt")
    aus["hashlib_pbkdf2"] = hasattr(hashlib, "pbkdf2_hmac")
    if aus["hashlib_scrypt"]:
        t0 = time.perf_counter()
        hashlib.scrypt(b"pw", salt=b"s" * 16, n=1 << 14, r=8, p=1, dklen=32)
        aus["scrypt_ms_n16384"] = round((time.perf_counter() - t0) * 1000, 1)
    print(f"   hashlib.scrypt               {aus['hashlib_scrypt']}"
          + (f"  ({aus.get('scrypt_ms_n16384')} ms bei n=16384)"
             if aus.get("scrypt_ms_n16384") else ""))
    print(f"   hashlib.pbkdf2_hmac          {aus['hashlib_pbkdf2']}")

    import ssl
    aus["openssl_lib"] = ssl.OPENSSL_VERSION
    print(f"   OpenSSL hinter python3       {aus['openssl_lib']}")

    # 3. Das Befehlszeilen-OpenSSL — und die Falle daran: `openssl enc`
    #    KANN KEIN AEAD. Wer damit verschluesselt, bekommt Vertraulichkeit
    #    ohne Echtheitspruefung, und ein falsches Passwort liefert Muell
    #    statt eines Fehlers. Genau das ist ausgeschlossen worden.
    aus["openssl_cli"] = _ruf(["openssl", "version"])
    enc = _ruf(["sh", "-c", "echo x | openssl enc -aes-256-gcm -pbkdf2 "
                            "-pass pass:probe 2>&1 | head -1"])
    aus["openssl_enc_aead"] = "not supported" not in (enc or "")
    print(f"   openssl (Befehlszeile)       {aus['openssl_cli'] or 'FEHLT'}")
    print(f"   `openssl enc` kann AEAD      {aus['openssl_enc_aead']}"
          + ("" if aus["openssl_enc_aead"] else f"   -> «{enc}»"))

    # 4. GnuPG — da, und mit Echtheitspruefung. `--symmetric` nimmt das
    #    Passwort ueber einen Dateizeiger entgegen, nicht ueber die
    #    Befehlszeile (`ps` zeigt Argumente allen Benutzern).
    aus["gpg"] = (_ruf(["gpg", "--version"]) or "").split("\n")[0] or None
    print(f"   gpg                          {aus['gpg'] or 'FEHLT'}")
    if aus["gpg"]:
        with tempfile.TemporaryDirectory(prefix="mupi-gpg-") as tmp:
            klar = os.path.join(tmp, "klar")
            with open(klar, "wb") as f:
                f.write(b"MESSPROBE")
            t0 = time.perf_counter()
            r = subprocess.run(
                ["gpg", "--batch", "--yes", "--quiet", "--pinentry-mode",
                 "loopback", "--passphrase-fd", "0", "--symmetric",
                 "--cipher-algo", "AES256", "-o", klar + ".gpg", klar],
                input=b"probepasswort", capture_output=True,
                env={**os.environ, "GNUPGHOME": tmp})
            aus["gpg_symmetrisch_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            aus["gpg_symmetrisch_geht"] = r.returncode == 0
            if r.returncode:
                aus["gpg_fehler"] = r.stderr.decode(errors="replace")[:200]
            else:
                # Und die Probe, auf die es ankommt: ein FALSCHES Passwort
                # muss scheitern, nicht Unsinn liefern.
                r2 = subprocess.run(
                    ["gpg", "--batch", "--yes", "--quiet", "--pinentry-mode",
                     "loopback", "--passphrase-fd", "0", "-d", klar + ".gpg"],
                    input=b"falsch", capture_output=True,
                    env={**os.environ, "GNUPGHOME": tmp})
                aus["gpg_falsches_pw_faellt_durch"] = r2.returncode != 0
                aus["gpg_huelle_bytes"] = os.path.getsize(klar + ".gpg")
        print(f"   gpg --symmetric AES256       "
              f"{aus['gpg_symmetrisch_geht']}  "
              f"({aus.get('gpg_symmetrisch_ms')} ms, Huelle um 9 B Klartext: "
              f"{aus.get('gpg_huelle_bytes')} B)")
        print(f"   falsches Passwort faellt durch  "
              f"{aus.get('gpg_falsches_pw_faellt_durch')}")

    print()
    if not aus["aesgcm_geht"] and aus.get("gpg_symmetrisch_geht"):
        print("   BEFUND: kein AEAD in python3 (cryptography FEHLT), aber gpg")
        print("           kann es. Wer python3-cryptography will, muss es")
        print("           AUSLIEFERN — auf jede Box, nicht nur auf diese.")
    print()
    return aus


def _ruf(befehl: list[str]) -> str | None:
    try:
        r = subprocess.run(befehl, capture_output=True, timeout=20)
        return (r.stdout or r.stderr).decode(errors="replace").strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


# ── B  Welche Zeiger auf DIESER Box belegt sind ────────────────────────────
def abschnitt_b(m) -> dict:
    """KEIN WERT WIRD ANGEZEIGT. Nur: vorhanden ja/nein und wie lang."""
    print("B  DIE ELF STELLEN AUS `GEHEIM` — auf dieser Box")
    zeilen, gesamt, belegt = [], 0, 0
    for datei, zeiger in m.GEHEIM.items():
        quelle = m.ziel_von(datei)
        da = quelle and os.path.exists(quelle)
        if not da:
            print(f"   {datei}: gibt es nicht")
            continue
        try:
            d = json.loads(open(quelle, "rb").read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError, OSError) as e:
            print(f"   {datei}: nicht lesbar ({type(e).__name__})")
            continue
        for z, warum in zeiger:
            werte = m.zeiger_lesen(d, z)
            lang = sum(len(str(w)) for w in werte if w not in (None, "", []))
            gefuellt = [w for w in werte if w not in (None, "", [])]
            gesamt += lang
            belegt += len(gefuellt)
            zeilen.append({"datei": datei, "zeiger": z, "warum": warum,
                           "treffer": len(werte), "belegt": len(gefuellt),
                           "zeichen": lang})
            marke = "belegt " if gefuellt else "leer   "
            print(f"   {marke} {lang:>5} Z  {datei}{z}")
    print(f"\n   {belegt} von {len(zeilen)} Stellen belegt, "
          f"{gesamt} Zeichen insgesamt — das ist die ganze Menge, um die es "
          f"geht.")
    print("   (Werte werden absichtlich NICHT angezeigt.)\n")
    return {"stellen": zeilen, "belegt": belegt, "zeichen": gesamt}


# ── C  Was der Akkuverlauf am Stand kostet ─────────────────────────────────
def abschnitt_c(m) -> dict:
    print("C  WAS `akkuverlauf.json` AM STAND KOSTET")
    quelle = os.path.join(m.BAEUME["server/config"], "akkuverlauf.json")
    if not os.path.exists(quelle):
        print("   akkuverlauf.json gibt es hier nicht — nichts zu messen\n")
        return {"vorhanden": False}
    roh = open(quelle, "rb").read()
    try:
        punkte = len(json.loads(roh.decode("utf-8")))
    except (ValueError, UnicodeDecodeError):
        punkte = 0

    stand, inhalte, *_r = m.stand_bauen("messung-ohne-akku")
    with tempfile.TemporaryDirectory(prefix="mupi-akkumass-") as tmp:
        ohne = os.path.join(tmp, "ohne.tar.gz")
        m.schreiben(ohne, stand, inhalte)
        gr_ohne = os.path.getsize(ohne)

        # Mit — und zwar auf demselben Weg, den die Sicherung ginge: die
        # Datei kommt als weiterer Eintrag ins selbe Archiv. Geschaetzt
        # waere hier zu wenig; gzip komprimiert die Messreihe sehr gut, und
        # genau das ist die Zahl, die zaehlt.
        inhalte2 = dict(inhalte)
        inhalte2["server/config/akkuverlauf.json"] = roh
        stand2 = json.loads(json.dumps(stand))
        stand2["dateien"] = stand["dateien"] + [
            {"pfad": "server/config/akkuverlauf.json", "bytes": len(roh),
             "sha256": m.sha(roh), "geaendert": ""}]
        mit = os.path.join(tmp, "mit.tar.gz")
        m.schreiben(mit, stand2, inhalte2)
        gr_mit = os.path.getsize(mit)

        # Und am DECKEL: akkuverlauf.ts kappt bei MAX_PUNKTE. Die Reihe
        # wird also nicht unbegrenzt gross — aber sie ist heute erst halb
        # voll, und wer nur heute misst, misst die Haelfte.
        gr_deckel = gr_mit
        if punkte:
            je = len(roh) / punkte
            gefuellt = json.loads(roh.decode("utf-8"))
            while len(gefuellt) < MAX_PUNKTE:
                gefuellt = gefuellt + gefuellt
            gefuellt = gefuellt[:MAX_PUNKTE]
            voll = json.dumps(gefuellt).encode()
            inhalte3 = dict(inhalte)
            inhalte3["server/config/akkuverlauf.json"] = voll
            stand3 = json.loads(json.dumps(stand))
            stand3["dateien"] = stand["dateien"] + [
                {"pfad": "server/config/akkuverlauf.json", "bytes": len(voll),
                 "sha256": m.sha(voll), "geaendert": ""}]
            dk = os.path.join(tmp, "deckel.tar.gz")
            m.schreiben(dk, stand3, inhalte3)
            gr_deckel = os.path.getsize(dk)
            roh_deckel = len(voll)
        else:
            je = 0
            roh_deckel = 0

    print(f"   akkuverlauf.json roh         {len(roh)} B ({kb(len(roh))}), "
          f"{punkte} Punkte, {je:.1f} B je Punkt")
    print(f"   Stand OHNE                   {gr_ohne} B ({kb(gr_ohne)})")
    print(f"   Stand MIT (heute)            {gr_mit} B ({kb(gr_mit)})   "
          f"-> Faktor {gr_mit / gr_ohne:.1f}")
    print(f"   Stand MIT (am Deckel {MAX_PUNKTE} Punkte = 7 Tage)")
    print(f"                                {gr_deckel} B ({kb(gr_deckel)})   "
          f"-> Faktor {gr_deckel / gr_ohne:.1f}   (roh waeren {kb(roh_deckel)})")
    print()
    return {"vorhanden": True, "roh_bytes": len(roh), "punkte": punkte,
            "stand_ohne": gr_ohne, "stand_mit": gr_mit,
            "stand_deckel": gr_deckel, "roh_deckel": roh_deckel}


# ── D  Was davon auf die Karte passt ───────────────────────────────────────
def abschnitt_d(m, c: dict) -> dict:
    print("D  DIE FAT-PARTITION — Kontingent und Platz")
    if not os.path.isdir(KARTE):
        print(f"   {KARTE} gibt es nicht\n")
        return {"vorhanden": False}
    st = os.statvfs(KARTE)
    frei = st.f_bavail * st.f_frsize
    gesamt = st.f_blocks * st.f_frsize
    ordner = os.path.join(KARTE, KARTE_ORDNER)
    liegt = 0
    staende_karte = []
    if os.path.isdir(ordner):
        for n in sorted(os.listdir(ordner)):
            p = os.path.join(ordner, n)
            if os.path.isfile(p):
                liegt += os.path.getsize(p)
                if n.endswith(".tar.gz"):
                    staende_karte.append(n)
    alle = m.staende_lesen()
    fest = [s for s in alle if ".behalten." in s]
    print(f"   {KARTE}: {kb(gesamt)} gross, {kb(frei)} frei "
          f"({st.f_frsize} B je Block)")
    print(f"   im Ordner liegen             {len(staende_karte)} Staende, "
          f"{kb(liegt)} insgesamt")
    print(f"   im Haus                      {len(alle)} Staende "
          f"({len(fest)} angeheftet), Kontingent BEHALTEN={m.BEHALTEN}, "
          f"KARTE_BEHALTEN={m.KARTE_BEHALTEN}")
    # `--auf-karte` legt ALLE angehefteten plus die KARTE_BEHALTEN juengsten
    # lose hin. Angeheftete zaehlen NICHT gegen das Kontingent — das ist die
    # Zahl, die beim Rechnen am leichtesten untergeht.
    auf_karte = len(fest) + min(m.KARTE_BEHALTEN,
                                len([s for s in alle if ".behalten." not in s]))
    if c.get("vorhanden"):
        for name, gr in (("heute", c["stand_mit"]), ("am Deckel", c["stand_deckel"])):
            braucht = auf_karte * gr
            print(f"   MIT Akkuverlauf {name:<10}   {auf_karte} Staende x "
                  f"{kb(gr)} = {kb(braucht)}   "
                  f"({braucht / frei * 100:.2f} % des freien Platzes)")
        braucht_haus = m.BEHALTEN * c["stand_deckel"] + len(fest) * c["stand_deckel"]
        print(f"   im Haus am Deckel            "
              f"{m.BEHALTEN}+{len(fest)} x {kb(c['stand_deckel'])} = "
              f"{kb(braucht_haus)}")
    print()
    return {"frei": frei, "gesamt": gesamt, "liegt": liegt,
            "staende_karte": len(staende_karte), "staende_haus": len(alle),
            "angeheftet": len(fest), "auf_karte_soll": auf_karte}


# ── E  Was `--wenn-anders` davon haelt ─────────────────────────────────────
def abschnitt_e(m) -> dict:
    """Die Nebenwirkung, die beim Groessenrechnen untergeht.

    `--wenn-anders` vergleicht `inhalt_kennung`, und die deckt ALLE Dateien
    im Stand ab. Steht eine Datei darin, die sich von selbst aendert, ist die
    Kennung IMMER anders — und damit ist die Vorkehrung aus
    [[aufraeum-sicherung-vor-der-entscheidung]] ausser Kraft: folgenlose
    Staende entstehen wieder und verdraengen die eine, auf die es ankommt.
    """
    print("E  WAS `--wenn-anders` DAZU SAGT")
    quelle = os.path.join(m.BAEUME["server/config"], "akkuverlauf.json")
    if not os.path.exists(quelle):
        print("   ohne akkuverlauf.json nicht messbar\n")
        return {}
    a = open(quelle, "rb").read()
    print(f"   akkuverlauf.json geaendert   "
          f"{time.strftime('%H:%M:%S', time.localtime(os.path.getmtime(quelle)))}")
    print("   Der Server schreibt sie alle 10 Minuten (server.ts, "
          "AKKU_SCHREIB_JE=10).")
    s1, i1, *_r = m.stand_bauen("kennung-ohne")
    i2 = dict(i1); i2["server/config/akkuverlauf.json"] = a
    k_ohne = s1["inhalt_kennung"]
    k_mit = m.sha("\n".join(
        f"{p}:{m.sha(i2[p])}" for p in sorted(i2)).encode())
    i3 = dict(i2); i3["server/config/akkuverlauf.json"] = a + b" "
    k_mit2 = m.sha("\n".join(
        f"{p}:{m.sha(i3[p])}" for p in sorted(i3)).encode())
    print(f"   Kennung ohne Akkuverlauf     {k_ohne[:16]}…")
    print(f"   Kennung mit                  {k_mit[:16]}…")
    print(f"   Kennung mit, EIN Byte mehr   {k_mit2[:16]}…   "
          f"-> anders: {k_mit2 != k_mit}")
    print("   FOLGE: mit akkuverlauf.json im Stand unterdrueckt "
          "`--wenn-anders` NIE mehr")
    print("   einen Lauf. Jeder Anstoss (mupibox-sicherung.path bei jedem")
    print("   Anfassen von mupiboxconfig.json, jede Auslieferung) legt dann")
    print("   einen vollen Stand an — und das Kontingent von "
          f"{m.BEHALTEN} rollt schneller durch.\n")
    return {"kennung_immer_anders": k_mit2 != k_mit}


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("abschnitte", nargs="*", default=None,
                   help="A B C D E — ohne Angabe: alles")
    p.add_argument("--skript", default=SKRIPT)
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv[1:])
    will = [s.upper() for s in (a.abschnitte or ["A", "B", "C", "D", "E"])]

    m = modul_laden(a.skript)
    print(f"gemessen an {os.uname().nodename}, {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"gegen {a.skript}\n")
    erg: dict = {}
    if "A" in will:
        erg["A"] = abschnitt_a()
    if "B" in will:
        erg["B"] = abschnitt_b(m)
    if "C" in will:
        erg["C"] = abschnitt_c(m)
    if "D" in will:
        erg["D"] = abschnitt_d(m, erg.get("C", {}))
    if "E" in will:
        erg["E"] = abschnitt_e(m)
    if a.json:
        print(json.dumps(erg, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
