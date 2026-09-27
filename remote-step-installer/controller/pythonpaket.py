"""Python fuer eine Box OHNE NETZ mitgeben — die drei .deb, die alles tragen.

WOZU DIESE DATEI EXISTIERT, und das ist der ganze Grund:

Auf dem DietPi-Image ist KEIN PYTHON. Nachgemessen am echten Abbild
(RPi5, Trixie): 1254 Dateien in /usr/bin, darunter `bash`, `perl`,
`wpa_supplicant`, `iw`, `dhclient` — aber kein `python3`. Es kommt erst per
`apt`, also mit Netz.

Damit haengt der GESAMTE Weg ohne Kabel in der Luft: der Agent ist Python, der
Einrichtungs-AP ist Python, unser DHCP/DNS ist Python. Wer die Box ohne Netz
aufsetzen will, braucht ausgerechnet das eine, was ohne Netz nicht kommt.
Genau daran ist der erste Kartenlauf am 08.08.2026 gescheitert — DietPis
Erstinstallation brach mit "First run setup failed" ab, bevor irgendetwas von
uns ueberhaupt startete.

DIE LOESUNG IST KLEIN: drei Pakete, zusammen unter 3 MB (gegen 190 MB Image
und 17 MB Laufpaket). Der RECHNER hat beim Kartenschreiben Netz — er laedt sie
und legt sie mit auf die Karte, das PreScript setzt sie per `dpkg -i` ohne
Netz auf.

WARUM DIE VERSIONEN NICHT FEST IM CODE STEHEN: Eine verdrahtete Version
veraltet, und dann laedt der Assistent ein Paket, das es nicht mehr gibt —
auf einem Rechner, der gerade eine Karte schreiben will. Gelesen wird deshalb
das POOL-VERZEICHNIS von Debian, dieselbe Technik, mit der `sdprep` schon die
DietPi-Liste holt.

DIE TUECKE DABEI: In einem Pool-Verzeichnis liegen die Pakete ALLER Debian-
Staende nebeneinander — buster, bookworm, trixie und sid. Wer einfach das
neueste nimmt, spielt der Box ein sid-Paket auf, das gegen eine libc baut, die
sie nicht hat. Deshalb wird nach dem Codename ausgewaehlt, und die beiden
zusammengehoerenden Pakete muessen DIESELBE Version tragen.
"""
import os
import re
import urllib.request

POOL = "http://deb.debian.org/debian/pool/main"
UA = "Mozilla/5.0 remote-step-installer/pythonpaket"

# Welcher Debian-Stand bringt welches Python? Muss stimmen, sonst passt das
# Paket nicht zur Bibliothekslage der Box.
PYTHON_JE_STAND = {
    "trixie": "3.13",
    "bookworm": "3.11",
    "bullseye": "3.9",
    "forky": "3.14",
}
# Der Marker, an dem man ein Paket AUS diesem Stand erkennt: Debian haengt bei
# Aktualisierungen fuer eine veroeffentlichte Fassung `+debNNuM` an.
DEB_NUMMER = {"bullseye": "deb11", "bookworm": "deb12", "trixie": "deb13"}


def _holen(url, frist=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=frist) as r:
        return r.read()


def verzeichnis_lesen(html, endung="_arm64.deb"):
    """Aus einer Apache-Verzeichnisliste die Dateinamen ziehen. Pure."""
    return sorted(set(re.findall(r'href="([^"]+' + re.escape(endung) + r')"',
                                 html if isinstance(html, str)
                                 else html.decode("utf-8", "replace"))))


def _version(dateiname):
    """`python3.13-minimal_3.13.5-2+deb13u3_arm64.deb` -> `3.13.5-2+deb13u3`."""
    m = re.match(r"[^_]+_([^_]+)_", dateiname)
    return m.group(1) if m else ""


def _sortierbar(version):
    """Versionen vergleichbar machen — grob, aber fuer diesen Zweck genug.

    KEIN vollstaendiger Debian-Vergleich: der ist eigen (Tilde, Epoche) und
    hier nicht noetig, weil nur Kandidaten DESSELBEN Pakets und Stands
    verglichen werden. Was er nicht kann, sagt er nicht falsch, sondern
    sortiert stabil.
    """
    return [int(t) if t.isdigit() else t for t in re.split(r"[.\-+~u]", version) if t]


def passende_datei(dateien, paket, py_version, deb_marker):
    """Die richtige .deb aus der Verzeichnisliste. -> Name oder None.

    ZUERST die mit dem Stand-Marker (`+deb13u4`): das ist die gepflegte Fassung
    FUER diese Debian-Ausgabe. Erst wenn es keine gibt, die schlichte Fassung
    mit passender Python-Version — die stand seit der Veroeffentlichung drin
    und ist ebenfalls richtig. Ein Paket ohne beides gehoert zu einem anderen
    Debian und wird NIE genommen.
    """
    kandidaten = [d for d in dateien if d.startswith(paket + "_")
                  and _version(d).startswith(py_version)]
    if not kandidaten:
        return None
    mit_marker = [d for d in kandidaten if deb_marker in _version(d)]
    wahl = mit_marker or kandidaten
    return max(wahl, key=lambda d: _sortierbar(_version(d)))


def pakete_bestimmen(codename, arch="arm64", lesen=None):
    """Welche drei Dateien werden gebraucht? -> [(url, dateiname), …]

    `lesen(url)` ist einspeisbar, damit das ohne Netz pruefbar ist.
    """
    stand = (codename or "trixie").lower()
    py = PYTHON_JE_STAND.get(stand)
    if not py:
        raise ValueError(f"Unbekannter Debian-Stand: {codename}")
    marker = DEB_NUMMER.get(stand, "")
    hole = lesen or (lambda u: _holen(u).decode("utf-8", "replace"))

    # Zwei Quellverzeichnisse: die Python-Fassung selbst und der Wrapper.
    quellen = [
        (f"{POOL}/p/python{py}/", [f"libpython{py}-minimal", f"python{py}-minimal"]),
        (f"{POOL}/p/python3-defaults/", ["python3-minimal"]),
        # DIE VIERTE, UND SIE HAT ALLES AUFGEHALTEN: `python3.13-minimal`
        # verlangt libexpat1, und die ist auf dem DietPi-Abbild NICHT drin.
        # Am Geraet gesehen (Protokoll vom 08.08.2026):
        #     python3.13-minimal depends on libexpat1 (>= 2.6.0); however:
        #       Package libexpat1 is not installed.
        # dpkg liess daraufhin ALLES unkonfiguriert, es gab kein Python, und
        # der Vorstart endete ohne Zugangspunkt.
        # Die uebrigen drei Abhaengigkeiten (libc6, libssl3t64, zlib1g) sind
        # im Abbild vorhanden — nachgesehen in dessen dpkg-Status, nicht
        # geraten.
        (f"{POOL}/e/expat/", ["libexpat1"]),
        # DIE STANDARDBIBLIOTHEK, dritter Fund am Geraet: `python3.13-minimal`
        # heisst minimal, weil sie FEHLT. Der Interpreter lief, aber
        #     ModuleNotFoundError: No module named 'secrets'
        # — und damit starb der Agent ebenso wie der Einrichtungs-AP. Alles
        # von uns braucht die stdlib (secrets, http.server, threading …).
        (f"{POOL}/p/python{py}/", [f"libpython{py}-stdlib"]),
    ]
    # Die stdlib verlangt zwei Pakete, die dem Abbild fehlen (gegen dessen
    # dpkg-Status geprueft, alle uebrigen zwoelf sind da): media-types und
    # netbase. Beide sind REINE DATENPAKETE ohne eigene Abhaengigkeiten
    # (/etc/mime.types bzw. /etc/services) und architekturfrei — deshalb ist
    # hier ausnahmsweise die neueste Fassung aus dem Pool unbedenklich, und
    # gesucht wird nach `_all.deb`.
    alle_arch = [
        (f"{POOL}/m/media-types/", ["media-types"]),
        (f"{POOL}/n/netbase/", ["netbase"]),
    ]
    ergebnis = []
    for url, pakete in quellen:
        dateien = verzeichnis_lesen(hole(url), endung=f"_{arch}.deb")
        for p in pakete:
            # python3-minimal traegt die Python-Fassung als eigene Version
            # (3.13.5-1), nicht die des Interpreters — deshalb `py` als
            # Praefix, das passt fuer beide Faelle. libexpat1 zaehlt dagegen
            # ganz eigen (2.7.x): dort darf NICHT nach der Python-Fassung
            # gefiltert werden, sonst findet man nichts.
            praefix = "" if p == "libexpat1" else py
            datei = passende_datei(dateien, p, praefix, marker)
            if not datei:
                raise LookupError(f"{p} fuer {stand}/{arch} nicht im Pool gefunden")
            ergebnis.append((url + datei, datei))
    for url, pakete in alle_arch:
        dateien = verzeichnis_lesen(hole(url), endung="_all.deb")
        for p in pakete:
            datei = passende_datei(dateien, p, "", "")
            if not datei:
                raise LookupError(f"{p} (all) nicht im Pool gefunden")
            ergebnis.append((url + datei, datei))
    return ergebnis


def herunterladen(codename, ziel_ordner, arch="arm64", melden=None):
    """Die Pakete in den Ordner legen. -> Liste der Dateinamen."""
    sag = melden or (lambda s: None)
    os.makedirs(ziel_ordner, exist_ok=True)
    namen = []
    for url, datei in pakete_bestimmen(codename, arch):
        ziel = os.path.join(ziel_ordner, datei)
        if os.path.isfile(ziel) and os.path.getsize(ziel) > 1000:
            sag(f"  {datei} (schon da)")
        else:
            sag(f"  lade {datei} …")
            daten = _holen(url, frist=120)
            with open(ziel, "wb") as f:
                f.write(daten)
        namen.append(datei)
    return namen


def codename_aus_bild(dateiname):
    """`DietPi_RPi5-ARMv8-Trixie.img.xz` -> `trixie`. Pure.

    Der Stand des Images entscheidet, welche Pakete passen — nicht der Stand
    des Rechners, auf dem die Karte geschrieben wird. Das ist fast immer ein
    anderer.
    """
    m = re.search(r"-([A-Za-z]+)\.img", dateiname or "")
    return m.group(1).lower() if m else "trixie"


def arch_aus_bild(dateiname):
    """`DietPi_RPi5-ARMv8-Trixie.img.xz` -> `arm64`. Pure."""
    d = (dateiname or "").lower()
    if "armv8" in d or "arm64" in d:
        return "arm64"
    if "armv7" in d or "armv6" in d:
        return "armhf"
    return "arm64"
