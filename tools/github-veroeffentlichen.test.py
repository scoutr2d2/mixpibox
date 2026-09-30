#!/usr/bin/env python3
"""DER OHNE-AUFNAHME-SCHUTZ DES VEROEFFENTLICHERS — haelt er, wenn eine seiner Dateien FEHLT?

WARUM ES DAS GIBT (Audit vom 28.09.2026, §1b Rang 4): `tools/github-veroeffentlichen.py`
war fail-closed, wenn der Ohne-Aufnahme-Patch NICHT PASSTE — aber fail-open,
wenn er FEHLTE: `patch_anwenden` gab dann still den ungepatchten Stand zurueck,
die Berichtszeile erschien nur bei mehr als 0 gepatchten Pfaden, und ohne
`tools/github-lokal-muster.txt` lief die Leck-Wache mit weniger Mustern, ohne
es zu sagen. Die Zusage „GitHub ohne Aufnahme" hing an zwei Dateien, deren
Fehlen niemand bemerkt haette — ein Aufraeumlauf, der eine 450-KB-Patchdatei
fuer Wegwerfmaterial haelt, oder eine Umbenennung auf das mixpi-Praefix, und
die Verdrahtung ginge hinaus.

WIE GEPRUEFT WIRD: NIE am echten Baum. Jeder Fall baut einen Wegwerf-Baum in
einem Temp-Verzeichnis (git init), kopiert das Werkzeug AUS DIESEM BAUM hinein
— es leitet seine Wurzel aus dem eigenen Ort ab und sieht dann nur den
Wegwerf-Baum — und ruft es dort als Trockenlauf. Nur Fall a2 ruft `--bauen`,
mit fester Identitaet und ohne Gegenstelle, also ohne jede Moeglichkeit zu
pushen. Die Git-Umgebung wird geleert (GIT_*, globale Konfiguration), damit
kein Hook und kein GIT_DIR des Aufrufers in den Wegwerf-Baum greift.

Der Wegwerf-Baum bildet den echten in klein nach: eine Ausschlussliste mit
einem Lokal-Ordner und den zwei Schutz-Dateien, eine Kern-Datei mit einer
Verdrahtungs-Zeile, ein Zweig `ohne`, der sie entfernt, und daraus per
`--patch-aus ohne` der Patch — ueber den echten Erzeugungsweg des Werkzeugs.
Die Probe-Woerter sind bewusst neutral: diese Datei geht nach GitHub und
laeuft dort selbst durch die Leck-Wache.

    python3 tools/github-veroeffentlichen.test.py
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
WERKZEUG = os.path.join(HIER, "github-veroeffentlichen.py")

AUSSCHLUSS_PROBE = """\
# Ausschlussliste des Wegwerf-Baums
lokal/                             # nur lokal (Probe)
tools/github-lokal-muster.txt      # Muster, die selbst nicht hinaus sollen
tools/github-ohne-aufnahme.patch   # entfernt die Verdrahtung nur beim Veroeffentlichen
"""

# Ein Probe-Wort statt echter Wortfolgen: diese Datei geht selbst hinaus.
MUSTER_PROBE = """\
# lokale Muster des Wegwerf-Baums
muster: probe-wort | ZEBRAFINK
treffer: ein ZEBRAFINK im Text
kein: ein Zebra und ein Fink
"""

KERN_MIT = "Grundzeile\nVERDRAHTUNG-EIN\n"
KERN_OHNE = "Grundzeile\n"
GRUND_GUT = "oeffentlicher Klon, traegt keine lokale Erweiterung"


def umgebung():
    """Leere Git-Umgebung: kein GIT_DIR/GIT_INDEX_FILE des Aufrufers, keine Hooks."""
    umg = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    umg.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_AUTHOR_NAME="Probe", GIT_AUTHOR_EMAIL="probe@example.invalid",
               GIT_COMMITTER_NAME="Probe", GIT_COMMITTER_EMAIL="probe@example.invalid")
    return umg


def g(baum, *args):
    subprocess.run(["git", "-C", baum, "-c", "core.hooksPath=" + os.devnull,
                    "-c", "commit.gpgsign=false", *args],
                   check=True, capture_output=True, text=True, env=umgebung())


def schreiben(baum, rel, text):
    voll = os.path.join(baum, rel)
    os.makedirs(os.path.dirname(voll), exist_ok=True)
    with open(voll, "w", encoding="utf-8") as f:
        f.write(text)


def lauf(baum, *args):
    """Das KOPIERTE Werkzeug im Wegwerf-Baum rufen -> (rueckgabe, stdout+stderr)."""
    r = subprocess.run([sys.executable, os.path.join(baum, "tools", "github-veroeffentlichen.py"), *args],
                       capture_output=True, text=True, env=umgebung(), cwd=baum, timeout=120)
    return r.returncode, r.stdout + r.stderr


def baum_lokal(tmp):
    """Wie der eigene Baum: Lokales liegt drin, Patch und Muster sind da."""
    baum = os.path.join(tmp, "baum")
    os.makedirs(os.path.join(baum, "tools"))
    shutil.copy2(WERKZEUG, os.path.join(baum, "tools", "github-veroeffentlichen.py"))
    schreiben(baum, "tools/github-ausschluss.txt", AUSSCHLUSS_PROBE)
    schreiben(baum, "tools/github-lokal-muster.txt", MUSTER_PROBE)
    schreiben(baum, "kern/verdrahtung.txt", KERN_MIT)
    schreiben(baum, "lokal/erweiterung.txt", "nur lokal\n")
    g(baum, "init", "-q", "-b", "main")
    g(baum, "add", "-A")
    g(baum, "commit", "-q", "-m", "Grundstand")
    # Der Zweig, der die Verdrahtung entfernt — wie github-ohne-aufnahme.
    g(baum, "switch", "-q", "-c", "ohne")
    schreiben(baum, "kern/verdrahtung.txt", KERN_OHNE)
    g(baum, "commit", "-q", "-am", "ohne Verdrahtung")
    g(baum, "switch", "-q", "main")
    rc, aus = lauf(baum, "--patch-aus", "ohne")
    if rc != 0:
        raise RuntimeError(f"--patch-aus scheiterte im Wegwerf-Baum:\n{aus}")
    g(baum, "add", "tools/github-ohne-aufnahme.patch")
    g(baum, "commit", "-q", "-m", "Patch")
    return baum


def baum_oeffentlich(tmp):
    """Wie ein Klon von GitHub: nichts Lokales, weder Patch noch Muster-Datei."""
    baum = os.path.join(tmp, "klon")
    os.makedirs(os.path.join(baum, "tools"))
    shutil.copy2(WERKZEUG, os.path.join(baum, "tools", "github-veroeffentlichen.py"))
    schreiben(baum, "tools/github-ausschluss.txt", AUSSCHLUSS_PROBE)
    schreiben(baum, "kern/verdrahtung.txt", KERN_OHNE)
    g(baum, "init", "-q", "-b", "main")
    g(baum, "add", "-A")
    g(baum, "commit", "-q", "-m", "oeffentlicher Stand")
    return baum


def entfernen(baum, rel):
    """Committet loeschen — so wie es ein Aufraeumlauf taete."""
    g(baum, "rm", "-q", rel)
    g(baum, "commit", "-q", "-m", f"{rel} weg")


# ── DIE FAELLE ─────────────────────────────────────────────────────────────
# Jeder gibt eine Liste von Maengeln zurueck; leer heisst bestanden. Geprueft
# wird immer BEIDES: der Ausgang UND der Grund im Text — ein Absturz mit
# Rueckgabe 1 ist kein bestandener Abbruch.

def abbruch_mit(rc, aus, *woerter):
    maengel = []
    if rc == 0:
        maengel.append("lief durch (Rueckgabe 0), erwartet war ein Abbruch")
    if "Traceback" in aus:
        maengel.append("Absturz statt Abbruch mit Grund")
    if "ABBRUCH" not in aus:
        maengel.append("keine ABBRUCH-Zeile")
    for w in woerter:
        if not re.search(w, aus):
            maengel.append(f"Grund fehlt im Text: /{w}/")
    return maengel


def fall_c_vollstaendig(tmp):
    """(c) alles da: laeuft wie bisher, Berichtszeile mit Zahl, lokale Muster gezaehlt."""
    baum = baum_lokal(tmp)
    rc, aus = lauf(baum)
    maengel = []
    if rc != 0:
        maengel.append(f"Rueckgabe {rc}")
    if not re.search(r"Ohne-Aufnahme-Patch: 1 Pfade", aus):
        maengel.append("Berichtszeile 'Ohne-Aufnahme-Patch: 1 Pfade' fehlt")
    if not re.search(r"lokale Leck-Muster: 1\b", aus):
        maengel.append("Zeile 'lokale Leck-Muster: 1' fehlt")
    if "Trockenlauf." not in aus:
        maengel.append("kein Trockenlauf-Ende")
    return maengel, aus


def fall_a_patch_fehlt(tmp):
    """(a) Patch committet geloescht: Abbruch mit Grund und Anleitung."""
    baum = baum_lokal(tmp)
    entfernen(baum, "tools/github-ohne-aufnahme.patch")
    rc, aus = lauf(baum)
    return abbruch_mit(rc, aus, r"github-ohne-aufnahme\.patch", r"fehlt", r"--patch-aus"), aus


def fall_a2_patch_fehlt_beim_bauen(tmp):
    """(a2) Patch fehlt und --bauen: kein Commit auf dem Veroeffentlichungs-Zweig."""
    baum = baum_lokal(tmp)
    entfernen(baum, "tools/github-ohne-aufnahme.patch")
    rc, aus = lauf(baum, "--bauen", "--autor", "Probe <probe@example.invalid>")
    maengel = abbruch_mit(rc, aus, r"github-ohne-aufnahme\.patch")
    da = subprocess.run(["git", "-C", baum, "rev-parse", "--verify", "-q", "veroeffentlichung"],
                        capture_output=True, text=True, env=umgebung()).returncode == 0
    if da:
        maengel.append("der Zweig veroeffentlichung wurde trotzdem angelegt")
    return maengel, aus


def fall_a3_patch_leer(tmp):
    """(a3) Patch da, aber leer: eigener Grund statt 'passt nicht'."""
    baum = baum_lokal(tmp)
    schreiben(baum, "tools/github-ohne-aufnahme.patch", "")
    rc, aus = lauf(baum)
    return abbruch_mit(rc, aus, r"github-ohne-aufnahme\.patch", r"leer"), aus


def fall_b_muster_fehlt(tmp):
    """(b) Muster-Datei committet geloescht: Abbruch mit Grund."""
    baum = baum_lokal(tmp)
    entfernen(baum, "tools/github-lokal-muster.txt")
    rc, aus = lauf(baum)
    return abbruch_mit(rc, aus, r"github-lokal-muster\.txt", r"fehlt"), aus


def fall_b2_muster_ohne_muster(tmp):
    """(b2) Muster-Datei da, aber ohne eine einzige muster:-Zeile."""
    baum = baum_lokal(tmp)
    schreiben(baum, "tools/github-lokal-muster.txt", "# nur Kommentar\n")
    rc, aus = lauf(baum)
    return abbruch_mit(rc, aus, r"github-lokal-muster\.txt", r"kein Muster"), aus


def fall_d_patch_passt_nicht(tmp):
    """(d) wie bisher: passt der Patch nicht mehr, bricht es ab."""
    baum = baum_lokal(tmp)
    schreiben(baum, "kern/verdrahtung.txt", "Grundzeile\nVERDRAHTUNG-UMGEBAUT\n")
    g(baum, "commit", "-q", "-am", "Kern weiter entwickelt")
    rc, aus = lauf(baum)
    return abbruch_mit(rc, aus, r"passt nicht mehr", r"--patch-aus"), aus


def fall_h_lokales_muster_greift(tmp):
    """(h) die Muster-Datei wird nicht nur gezaehlt, sondern angewendet."""
    baum = baum_lokal(tmp)
    schreiben(baum, "kern/text.txt", "ein ZEBRAFINK im Text\n")
    g(baum, "add", "kern/text.txt")
    g(baum, "commit", "-q", "-m", "Text")
    rc, aus = lauf(baum)
    return abbruch_mit(rc, aus, r"LECK\s+kern/text\.txt", r"probe-wort"), aus


def fall_j_klon_ohne_schalter(tmp):
    """(j) der Abbruch ist UNBEDINGT: auch ein Baum ohne Lokales braucht den Schalter."""
    baum = baum_oeffentlich(tmp)
    rc, aus = lauf(baum)
    return abbruch_mit(rc, aus, r"github-ohne-aufnahme\.patch", r"--baum-ohne-aufnahme"), aus


def fall_f_klon_mit_schalter(tmp):
    """(f) Schalter mit Grund im Baum ohne Lokales: laeuft, Berichtszeile mit 0."""
    baum = baum_oeffentlich(tmp)
    rc, aus = lauf(baum, "--baum-ohne-aufnahme", GRUND_GUT)
    maengel = []
    if rc != 0:
        maengel.append(f"Rueckgabe {rc}")
    if not re.search(r"Ohne-Aufnahme-Patch: 0 Pfade.*AUSGESETZT", aus):
        maengel.append("Berichtszeile 'Ohne-Aufnahme-Patch: 0 Pfade ... AUSGESETZT' fehlt")
    if GRUND_GUT not in aus:
        maengel.append("der Grund steht nicht im Bericht")
    return maengel, aus


def fall_e_schalter_im_lokalen_baum(tmp):
    """(e) Schalter in einem Baum, aus dem die Ausschlussliste etwas zurueckhaelt."""
    baum = baum_lokal(tmp)
    entfernen(baum, "tools/github-ohne-aufnahme.patch")
    rc, aus = lauf(baum, "--baum-ohne-aufnahme", GRUND_GUT)
    return abbruch_mit(rc, aus, r"lokal/erweiterung\.txt", r"zurueck"), aus


def fall_e2_schalter_mit_leerer_probeliste(tmp):
    """(e2) --ausschluss mit leerer Liste macht den eigenen Baum nicht zum 'Baum ohne Lokales'."""
    baum = baum_lokal(tmp)
    entfernen(baum, "tools/github-ohne-aufnahme.patch")
    leer = os.path.join(tmp, "leere-liste.txt")
    with open(leer, "w", encoding="utf-8") as f:
        f.write("# nichts\n")
    rc, aus = lauf(baum, "--ausschluss", leer, "--baum-ohne-aufnahme", GRUND_GUT)
    return abbruch_mit(rc, aus, r"lokal/erweiterung\.txt", r"zurueck"), aus


def fall_k_patch_anwenden_allein(tmp):
    """(k) die zweite Schicht: patch_anwenden bricht auch ohne main ab, wenn der Patch fehlt.

    Rein, ohne git: bei fehlender Datei kehrt die Funktion vor jedem git-Aufruf
    um. Geladen wird das Werkzeug aus DIESEM Baum; es liest dabei nur.
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("ghveroeff", WERKZEUG)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fehlt = os.path.join(tmp, "gibt-es-nicht.patch")
    maengel = []
    try:
        mod.patch_anwenden([], patch=fehlt)
        maengel.append("patch_anwenden kehrte ohne Patch still zurueck")
    except SystemExit as e:
        if "fehlt" not in str(e):
            maengel.append(f"Abbruch ohne Grund 'fehlt': {e}")
    if mod.patch_anwenden([], patch=fehlt, fehlen_erlaubt=True) != ([], 0):
        maengel.append("fehlen_erlaubt=True laesst nicht durch")
    return maengel, ""


# ── DIE LECK-AUSNAHMEN JE (DATEI, MUSTER) (29.09.2026) ─────────────────────
# Audit 28.09.2026 §1b Rang 1: LECK_AUSNAHMEN galt DATEIWEIT — das Werkzeug
# selbst stand darin und wurde gar nicht abgetastet. Seitdem befreit ein Paar
# nur sein Muster. Die Probe-Woerter bleiben neutral: echte SSID- und
# MAC-Muster samt Faellen stehen in der lokalen Musterdatei und laufen mit
# `--selbsttest`; diese Datei geht hinaus und wird selbst abgetastet.

ZWEI_MUSTER = MUSTER_PROBE + """\
muster: zweit-wort | GRAUGANS
treffer: eine GRAUGANS im Text
kein: eine graue Gans
"""


def werkzeug_laden():
    """Das Werkzeug AUS DIESEM Baum als Modul laden (liest nur, ruft kein git)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("ghveroeff", WERKZEUG)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ausnahme_einsetzen(baum, paar):
    """Ein (datei, muster)-Paar in die KOPIE des Werkzeugs im Wegwerf-Baum schreiben."""
    pfad = os.path.join(baum, "tools", "github-veroeffentlichen.py")
    with open(pfad, encoding="utf-8") as f:
        text = f.read()
    anker = "LECK_AUSNAHMEN = {\n"
    if text.count(anker) != 1:
        raise RuntimeError(f"Anker {anker!r} steht nicht genau einmal im Werkzeug")
    with open(pfad, "w", encoding="utf-8") as f:
        f.write(text.replace(anker, anker + f"    {paar!r}: 'Probe',\n"))


def fall_l_paar_befreit_nur_sein_muster(tmp):
    """(l) rein: ein Paar befreit nur SEIN Muster; ein Pfad allein befreit nichts."""
    mod = werkzeug_laden()
    muster = [("probe-wort", re.compile("ZEBRAFINK")), ("zweit-wort", re.compile("GRAUGANS"))]
    text = "Zeile\nein ZEBRAFINK\neine GRAUGANS\n"
    maengel = []
    funde, genutzt = mod.leck_funde("kern/x.txt", text, muster, {("kern/x.txt", "probe-wort"): "Probe"})
    if [n for n, _z, _f in funde] != ["zweit-wort"]:
        maengel.append(f"Paar (kern/x.txt, probe-wort): gemeldet {funde}, erwartet nur zweit-wort")
    if genutzt != {("kern/x.txt", "probe-wort")}:
        maengel.append(f"genutzte Paare {genutzt}, erwartet das eine")
    if funde and funde[0][1] != 3:
        maengel.append(f"Zeile {funde[0][1]}, erwartet 3")
    funde, _g = mod.leck_funde("kern/x.txt", text, muster, {"kern/x.txt": "dateiweit, alte Form"})
    if len(funde) != 2:
        maengel.append(f"die dateiweite alte Form befreit etwas: {funde}")
    funde, _g = mod.leck_funde("kern/y.txt", text, muster, {("kern/x.txt", "probe-wort"): "Probe"})
    if len(funde) != 2:
        maengel.append(f"ein Paar fuer eine ANDERE Datei befreit etwas: {funde}")
    return maengel, ""


def fall_m_zu_breite_ausnahmen(tmp):
    """(m) rein: dateiweit, Platzhalter, Ordner, unbekanntes Muster -> Maengel; das echte LECK_AUSNAHMEN -> keine."""
    mod = werkzeug_laden()
    muster = [("probe-wort", re.compile("ZEBRAFINK"))]
    maengel = []
    for ausnahmen in ({"kern/x.txt": "dateiweit"}, {("kern/*.txt", "probe-wort"): "Glob"},
                      {("kern/", "probe-wort"): "Ordner"}, {("kern/x.txt", "*"): "jedes Muster"},
                      {("kern/x.txt", "gibt-es-nicht"): "Tippfehler"}):
        if not mod.ausnahmen_maengel(ausnahmen, muster):
            maengel.append(f"nicht als zu breit erkannt: {ausnahmen}")
    if mod.ausnahmen_maengel({("kern/x.txt", "probe-wort"): "Probe"}, muster):
        maengel.append("ein sauberes Paar gilt als Mangel")
    if mod.ausnahmen_maengel({}, muster + muster) == []:
        maengel.append("doppelter Mustername nicht erkannt")
    echt = mod.ausnahmen_maengel()
    if echt:
        maengel.append(f"das echte LECK_AUSNAHMEN hat Maengel: {echt}")
    return maengel, ""


def fall_n_wache_tastet_sich_selbst_ab(tmp):
    """(n) rein: Werkzeug und dieser Test tragen nichts, was die Wache sucht — ohne jede Ausnahme."""
    mod = werkzeug_laden()
    maengel = []
    for pfad, voll in (("tools/github-veroeffentlichen.py", WERKZEUG),
                       ("tools/github-veroeffentlichen.test.py", os.path.abspath(__file__))):
        with open(voll, encoding="utf-8") as f:
            funde, _g = mod.leck_funde(pfad, f.read(), ausnahmen={})
        for name, zeile, _fund in funde:
            maengel.append(f"{pfad}:{zeile} trifft {name}")
        if any(isinstance(s, tuple) and s[0] == pfad for s in mod.LECK_AUSNAHMEN):
            maengel.append(f"{pfad} steht in LECK_AUSNAHMEN — die Wache soll sich selbst abtasten")
    namen = {n for n, _m in mod.LECK_MUSTER}
    fehlend = [n for n, _m, _f in mod.lokale_muster_lesen() if n not in namen]
    if fehlend:
        maengel.append(f"lokale Muster nicht in LECK_MUSTER: {fehlend}")
    return maengel, ""


def fall_o_paar_im_lauf(tmp):
    """(o) im Lauf: das Paar befreit probe-wort, zweit-wort bricht ab — und der Fund steht nur angeschnitten da."""
    baum = baum_lokal(tmp)
    ausnahme_einsetzen(baum, ("kern/text.txt", "probe-wort"))
    schreiben(baum, "tools/github-lokal-muster.txt", ZWEI_MUSTER)
    schreiben(baum, "kern/text.txt", "ein ZEBRAFINK\neine GRAUGANS\n")
    g(baum, "add", "kern/text.txt")
    rc, aus = lauf(baum)
    maengel = abbruch_mit(rc, aus, r"LECK\s+kern/text\.txt:2\s+zweit-wort")
    if re.search(r"LECK.*probe-wort", aus):
        maengel.append("probe-wort gemeldet, obwohl das Paar es befreit")
    # Der Treffer ist genau das Musterwort — steht es ganz in der LECK-Zeile,
    # ist der Fund nicht angeschnitten.
    if re.search(r"LECK.*GRAUGANS", aus):
        maengel.append("der Fund steht voll in der Ausgabe statt angeschnitten")
    return maengel, aus


def fall_p_ausnahme_ohne_anlass(tmp):
    """(p) im Lauf: ein Paar, das nichts befreit, bricht ab."""
    baum = baum_lokal(tmp)
    ausnahme_einsetzen(baum, ("kern/verdrahtung.txt", "probe-wort"))
    rc, aus = lauf(baum)
    return abbruch_mit(rc, aus, r"AUSNAHME OHNE ANLASS", r"kern/verdrahtung\.txt"), aus


def fall_g_schalter_ohne_grund(tmp):
    """(g) Schalter mit einem Wort als 'Grund'."""
    baum = baum_oeffentlich(tmp)
    rc, aus = lauf(baum, "--baum-ohne-aufnahme", "egal")
    return abbruch_mit(rc, aus, r"Begruendung"), aus


def fall_i_schalter_ohne_anlass(tmp):
    """(i) Schalter, obwohl Patch und Muster da sind: kein Routine-Schalter."""
    baum = baum_lokal(tmp)
    rc, aus = lauf(baum, "--baum-ohne-aufnahme", GRUND_GUT)
    return abbruch_mit(rc, aus, r"ohne Anlass"), aus


FAELLE = [
    ("c  alles da, Berichtszeile mit Zahl", fall_c_vollstaendig),
    ("a  Patch fehlt -> Abbruch", fall_a_patch_fehlt),
    ("a2 Patch fehlt, --bauen -> kein Commit", fall_a2_patch_fehlt_beim_bauen),
    ("a3 Patch leer -> Abbruch", fall_a3_patch_leer),
    ("b  Muster-Datei fehlt -> Abbruch", fall_b_muster_fehlt),
    ("b2 Muster-Datei ohne Muster -> Abbruch", fall_b2_muster_ohne_muster),
    ("d  Patch passt nicht -> Abbruch (wie bisher)", fall_d_patch_passt_nicht),
    ("h  lokales Muster wird angewendet", fall_h_lokales_muster_greift),
    ("j  Klon ohne Schalter -> Abbruch (unbedingt)", fall_j_klon_ohne_schalter),
    ("f  Klon mit Schalter -> laeuft, Bericht 0", fall_f_klon_mit_schalter),
    ("e  Schalter im Baum mit Lokalem -> Abbruch", fall_e_schalter_im_lokalen_baum),
    ("e2 Schalter + leere --ausschluss-Liste -> Abbruch", fall_e2_schalter_mit_leerer_probeliste),
    ("k  patch_anwenden allein: fehlt -> Abbruch", fall_k_patch_anwenden_allein),
    ("g  Schalter ohne Begruendung -> Abbruch", fall_g_schalter_ohne_grund),
    ("i  Schalter ohne Anlass -> Abbruch", fall_i_schalter_ohne_anlass),
    ("l  Leck-Ausnahme befreit nur ihr (datei, muster)-Paar", fall_l_paar_befreit_nur_sein_muster),
    ("m  zu breite Leck-Ausnahmen werden erkannt", fall_m_zu_breite_ausnahmen),
    ("n  Werkzeug und Test tasten sich selbst ab, ohne Ausnahme", fall_n_wache_tastet_sich_selbst_ab),
    ("o  Paar im Lauf: nur sein Muster frei, Fund angeschnitten", fall_o_paar_im_lauf),
    ("p  Ausnahme ohne Anlass -> Abbruch", fall_p_ausnahme_ohne_anlass),
]


def main():
    schlecht = 0
    for name, fall in FAELLE:
        with tempfile.TemporaryDirectory(prefix="ghveroeff-test-") as tmp:
            try:
                maengel, aus = fall(tmp)
            except Exception as e:          # Aufbau gescheitert: auch ein FAIL, aber benannt
                maengel, aus = [f"Aufbau des Falls scheiterte: {e!r}"], ""
        if maengel:
            schlecht += 1
            print(f"  FAIL {name}")
            for m in maengel:
                print(f"         - {m}")
            for z in aus.strip().splitlines()[-6:]:
                print(f"         | {z}")
        else:
            print(f"  OK   {name}")
    print(f"\n{len(FAELLE) - schlecht}/{len(FAELLE)} bestanden")
    return 1 if schlecht else 0


if __name__ == "__main__":
    sys.exit(main())
