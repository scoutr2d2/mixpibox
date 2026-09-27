#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Was hat die Box, um Geheimnisse zu verschluesseln? — gemessen, nicht geraten.

WOFUER: E29/B7 will die elf GEHEIM-Stellen aus mupibox-sicherung.py
verschluesselt mitsichern, optional, mit Passwort. Bevor man ein Verfahren
waehlt, muss man wissen, was auf der BOX vorhanden ist — nicht, was auf dem
Arbeitsrechner laeuft. Ein Verfahren, das hier geht und dort nicht, ist
schlimmer als keines.

UND DIE ZWEITE, WICHTIGERE FRAGE: was ueberlebt eine NEUINSTALLATION? Etwas,
das nur zufaellig da ist (als Recommends eines anderen Pakets), taugt nicht —
eine frische Karte muss es auch koennen. Das Werkzeug sagt deshalb zu jedem
Fund, WOHER er kommt: Image, autosetup.sh, oder angeweht.

    python3 tools/krypto-vorrat-schau.py                 # gegen .169
    python3 tools/krypto-vorrat-schau.py --host 1.2.3.4
    python3 tools/krypto-vorrat-schau.py --lokal         # gegen diesen Rechner
    python3 tools/krypto-vorrat-schau.py --json

Es VERAENDERT NICHTS: kein apt, kein pip, keine Datei ausserhalb von /tmp
(gpg braucht ein Wegwerf-GNUPGHOME, das wieder geloescht wird).
"""

import argparse
import json
import re
import subprocess
import sys

HOST = "dietpi@192.168.178.169"

# Die Zeitmarke, an der die Image-Pakete stehen, wird nicht geraten, sondern
# an einem Paket abgelesen, das ganz sicher aus dem Image stammt.
IMAGE_ZEUGE = "bash"

MESSSKRIPT = r'''
set +e
echo "###PYTHON"
python3 -c 'import sys;print(sys.version.split()[0])' 2>/dev/null || echo "-"
echo "###CRYPTOGRAPHY"
python3 - <<'PY' 2>&1
try:
    import cryptography
    print("da", cryptography.__version__)
except Exception:
    print("fehlt")
PY
echo "###CRYPTOGRAPHY_AEAD"
python3 - <<'PY' 2>&1
import os
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
    s = Scrypt(salt=b"s"*16, length=32, n=2**15, r=8, p=1)
    k = s.derive(b"pw")
    a, n = AESGCM(k), os.urandom(12)
    c = a.encrypt(n, b"geheim", b"ad")
    assert a.decrypt(n, c, b"ad") == b"geheim"
    try:
        a.decrypt(n, bytes([c[0] ^ 1]) + c[1:], b"ad")
        print("KAPUTT: verdrehtes Byte blieb unbemerkt")
    except Exception as e:
        print("ok, verdrehtes Byte faellt auf:", type(e).__name__)
except Exception as e:
    print("nein:", type(e).__name__, e)
PY
echo "###HASHLIB_SCRYPT"
python3 - <<'PY' 2>&1
import hashlib, time
if not hasattr(hashlib, "scrypt"):
    print("fehlt"); raise SystemExit
zeilen = []
for e in (14, 15, 16, 17):
    N = 2**e
    try:                       # erst OHNE maxmem — genau so scheitert es
        t = time.time(); hashlib.scrypt(b"pw", salt=b"s"*16, n=N, r=8, p=1, dklen=32)
        zeilen.append("n=2^%d ohne maxmem: %.0f ms" % (e, (time.time()-t)*1000))
    except Exception as ex:
        zeilen.append("n=2^%d ohne maxmem: FEHLER (%s)" % (e, ex))
    try:
        t = time.time()
        hashlib.scrypt(b"pw", salt=b"s"*16, n=N, r=8, p=1, dklen=32,
                       maxmem=128*N*8 + 1024*1024)
        zeilen.append("n=2^%d mit  maxmem: %.0f ms" % (e, (time.time()-t)*1000))
    except Exception as ex:
        zeilen.append("n=2^%d mit  maxmem: FEHLER (%s)" % (e, ex))
print("da | " + " | ".join(zeilen))
PY
echo "###OPENSSL"
openssl version 2>/dev/null || echo "-"
echo "###OPENSSL_AEAD"
if printf 'x' | openssl enc -aes-256-gcm -pbkdf2 -pass pass:xy -out /dev/null 2>/dev/null
then echo "kann AEAD"
else echo "kann KEIN AEAD ($(printf 'x' | openssl enc -aes-256-gcm -pbkdf2 -pass pass:xy -out /dev/null 2>&1 | head -1))"
fi
echo "###NODE"
node -v 2>/dev/null || echo "-"
echo "###NODE_AEAD"
node -e '
const c = require("crypto");
const k = c.randomBytes(32), iv = c.randomBytes(12);
const ci = c.createCipheriv("aes-256-gcm", k, iv);
const e = Buffer.concat([ci.update("geheim"), ci.final()]), t = ci.getAuthTag();
const d = c.createDecipheriv("aes-256-gcm", k, iv); d.setAuthTag(t);
const klar = Buffer.concat([d.update(e), d.final()]).toString();
const d2 = c.createDecipheriv("aes-256-gcm", k, iv); d2.setAuthTag(Buffer.alloc(16));
let laut = false; try { d2.update(e); d2.final(); } catch { laut = true; }
console.log(klar === "geheim" && laut
  ? "ok, aes-256-gcm + scrypt=" + (typeof c.scryptSync)
  : "KAPUTT");
' 2>&1 | tail -1
echo "###GPG"
gpg --version 2>/dev/null | head -1 || echo "-"
echo "###GPG_AEAD"
if command -v gpg >/dev/null 2>&1; then
  H=$(mktemp -d /tmp/kryptoschau.XXXXXX); chmod 700 "$H"; export GNUPGHOME="$H"
  echo geheim > "$H/klar.txt"
  printf 'pw123' | gpg --quiet --batch --yes --no-symkey-cache --pinentry-mode loopback \
      --passphrase-fd 0 --force-ocb --symmetric --cipher-algo AES256 \
      -o "$H/a.gpg" "$H/klar.txt" 2>/dev/null
  V=$?
  ART=$(gpg --list-packets "$H/a.gpg" 2>/dev/null | grep -o "aead [0-9]*" | head -1)
  printf 'pw123' | gpg --quiet --batch --pinentry-mode loopback --passphrase-fd 0 \
      -d "$H/a.gpg" >/dev/null 2>&1; R=$?
  printf 'falsch' | gpg --quiet --batch --pinentry-mode loopback --passphrase-fd 0 \
      -d "$H/a.gpg" >"$H/raus" 2>/dev/null; F=$?
  AG=$(pgrep -cf "$H" 2>/dev/null)
  echo "verschluesseln-rc=$V richtig-rc=$R falsch-rc=$F | ${ART:-kein AEAD} | Ausgabe bei falschem Passwort: $(stat -c%s "$H/raus" 2>/dev/null)B | gpg-agent laeuft: $AG"
  pkill -f "$H" 2>/dev/null; rm -rf "$H"
else
  echo "-"
fi
echo "###AGE"
age --version 2>/dev/null || echo "-"
echo "###HERKUNFT"
for p in PAKETE; do
  f=/var/lib/dpkg/info/$p.list
  [ -f "$f" ] || f=$(ls /var/lib/dpkg/info/$p:*.list 2>/dev/null | head -1)
  if [ -n "$f" ] && [ -f "$f" ]; then echo "$p $(stat -c %Z "$f")"
  else echo "$p -"; fi
done
echo "###APT"
for p in PAKETE; do
  echo "$p $(apt-cache policy $p 2>/dev/null | sed -n 's/^ *Candidate: //p' | head -1)"
done
echo "###ENDE"
'''

PAKETE = [
    IMAGE_ZEUGE, "gnupg", "gpg", "gpgv", "sqv", "nodejs", "openssl",
    "python3-cryptography", "age", "build-essential",
]


def messen(host, lokal):
    skript = MESSSKRIPT.replace("PAKETE", " ".join(PAKETE))
    if lokal:
        p = subprocess.run(["bash", "-s"], input=skript, capture_output=True, text=True)
    else:
        p = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "bash -s"],
            input=skript, capture_output=True, text=True, timeout=300)
    if "###ENDE" not in p.stdout:
        print("Messung kam nicht durch:", p.stderr.strip()[:400], file=sys.stderr)
        return None
    teile, name = {}, None
    for zeile in p.stdout.splitlines():
        if zeile.startswith("###"):
            name = zeile[3:].strip()
            teile[name] = []
        elif name:
            teile[name].append(zeile)
    return {k: "\n".join(v).strip() for k, v in teile.items()}


def herkunft_deuten(roh):
    """ctime des dpkg-Merkzettels gegen den Image-Zeugen — Image oder spaeter?"""
    zeiten = {}
    for zeile in roh.get("HERKUNFT", "").splitlines():
        name, _, wert = zeile.partition(" ")
        zeiten[name] = int(wert) if wert.strip().isdigit() else None
    grund = zeiten.get(IMAGE_ZEUGE)
    aus = {}
    for name, t in zeiten.items():
        if t is None:
            aus[name] = "nicht installiert"
        elif grund is None:
            aus[name] = "installiert (Image-Zeuge fehlt)"
        elif abs(t - grund) < 3600:
            aus[name] = "aus dem IMAGE"
        else:
            aus[name] = "NACH dem Image (+%.1f Tage)" % ((t - grund) / 86400.0)
    return aus


def in_autosetup(wurzel):
    """Steht das Paket namentlich in autosetup.sh? Nur DAS ist eine Zusage.

    MIT WORTGRENZE, und das ist kein Schoenheitsfehler: ein schlichtes
    `"age" in text` ist WAHR, weil in autosetup.sh das Wort „package" steht —
    das Werkzeug haette `age` als zugesagt gemeldet, obwohl es nirgends
    installiert wird. Und `bash` steckt in `#!/bin/bash`. Ein Pruefer, der
    falsch gruen wird, ist schlimmer als keiner.
    """
    try:
        with open(wurzel + "/autosetup/autosetup.sh", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    # Nur die Zeilen, die wirklich installieren — nicht der ganze Text.
    zeilen = [z for z in text.splitlines()
              if "packages2install" in z or "apt-get" in z and "install" in z]
    heuhaufen = "\n".join(zeilen)
    return {p: bool(re.search(r"(?<![\w.+-])%s(?![\w.+-])" % re.escape(p), heuhaufen))
            for p in PAKETE}


def main():
    a = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--host", default=HOST)
    a.add_argument("--lokal", action="store_true")
    a.add_argument("--json", action="store_true")
    a.add_argument("--baum", default=".", help="Wurzel des MuPiBox-Baums (fuer autosetup.sh)")
    n = a.parse_args()

    roh = messen(n.host, n.lokal)
    if roh is None:
        return 2
    herkunft = herkunft_deuten(roh)
    autosetup = in_autosetup(n.baum)
    kandidaten = roh.get("APT", "")

    if n.json:
        print(json.dumps({"roh": roh, "herkunft": herkunft,
                          "in_autosetup": autosetup}, indent=2, ensure_ascii=False))
        return 0

    wo = "dieser Rechner" if n.lokal else n.host
    print("KRYPTO-VORRAT an %s" % wo)
    print("=" * 72)
    for titel, schluessel in (
        ("Python", "PYTHON"),
        ("  cryptography", "CRYPTOGRAPHY"),
        ("  AES-GCM + Scrypt", "CRYPTOGRAPHY_AEAD"),
        ("  hashlib.scrypt", "HASHLIB_SCRYPT"),
        ("openssl", "OPENSSL"),
        ("  openssl enc AEAD", "OPENSSL_AEAD"),
        ("node", "NODE"),
        ("  node aes-256-gcm", "NODE_AEAD"),
        ("gpg", "GPG"),
        ("  gpg OCB (AEAD)", "GPG_AEAD"),
        ("age", "AGE"),
    ):
        wert = roh.get(schluessel, "?")
        for i, zeile in enumerate(wert.split(" | ")):
            print("  %-20s %s" % (titel if i == 0 else "", zeile))
    print()
    print("UEBERLEBT EINE NEUINSTALLATION?")
    print("-" * 72)
    print("  %-22s %-28s %-12s %s" % ("Paket", "auf DIESER Box", "autosetup", "in Debian"))
    apt = dict(z.split(" ", 1) for z in kandidaten.splitlines() if " " in z)
    for p in PAKETE:
        zusage = "-" if autosetup is None else ("JA" if autosetup.get(p) else "nein")
        print("  %-22s %-28s %-12s %s" % (
            p, herkunft.get(p, "?"), zusage, apt.get(p, "?").strip() or "-"))
    print()
    print("LESART — nur zwei Spalten sind eine ZUSAGE:")
    print("  'aus dem IMAGE'  jede frische Karte hat es, ohne dass jemand etwas tut")
    print("  'autosetup JA'   autosetup.sh installiert es namentlich")
    print("  'NACH dem Image' + 'nein' = ANGEWEHT als Recommends eines anderen")
    print("  Pakets. Es ist HEUTE da und kann auf einer frischen Karte FEHLEN —")
    print("  darauf darf sich ein Rueckweg nicht stuetzen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
