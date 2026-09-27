#!/usr/bin/env python3
"""Wird vom Arbeitsrechner ins Zwischenlager gelegt und dort aufgerufen.
Modi: pruefen | messen | tauschen | zurueckdrehen. Auftrag als JSON auf stdin,
Befund als JSON auf stdout."""
import ctypes, hashlib, json, os, platform, shutil, subprocess, sys

AT_FDCWD = -100
RENAME_EXCHANGE = 2
NR_RENAMEAT2 = {"aarch64": 276, "x86_64": 316, "armv7l": 382, "armv6l": 382}


def vertauschen(a, b):
    """Zwei Verzeichnisse in EINEM Schritt vertauschen — es gibt keinen
    Augenblick, in dem eines von beiden fehlt."""
    nr = NR_RENAMEAT2.get(platform.machine())
    if nr is None:
        raise OSError(0, "renameat2: unbekannte Maschine " + platform.machine())
    libc = ctypes.CDLL("libc.so.6", use_errno=True)
    libc.syscall.restype = ctypes.c_long
    r = libc.syscall(ctypes.c_long(nr), ctypes.c_int(AT_FDCWD), a.encode(),
                     ctypes.c_int(AT_FDCWD), b.encode(), ctypes.c_uint(RENAME_EXCHANGE))
    if r != 0:
        e = ctypes.get_errno()
        raise OSError(e, "renameat2(RENAME_EXCHANGE) %s <-> %s: %s" % (a, b, os.strerror(e)))


def md5(pfad):
    h = hashlib.md5()
    with open(pfad, "rb") as f:
        for brocken in iter(lambda: f.read(1 << 20), b""):
            h.update(brocken)
    return h.hexdigest()


def baumhash(wurzel, ausser=()):
    """Ein Wert fuer einen ganzen Baum: sortiert ueber (Pfad, md5). Zaehlt auch
    die Dateien, damit 'leer' nicht wie 'fehlt' aussieht."""
    if not os.path.isdir(wurzel):
        return {"da": False}
    zeilen, anzahl, bytes_ = [], 0, 0
    # WAS BEIM TAUSCH UEBERNOMMEN WURDE, ZAEHLT NICHT MIT. Sonst schlaegt die
    # Nachpruefung immer an: der Baum am Geraet traegt dann eine Datei mehr als
    # das Paket (z. B. den Themen-Verweis), und "am Geraet steht X, gebaut wurde
    # Y" waere ein Fehlalarm mit Ansage. Geprueft werden soll, ob das GEBAUTE
    # angekommen ist — nicht, ob sonst nichts danebenliegt.
    ausser = set(ausser or ())
    for ordner, unter, dateien in os.walk(wurzel):
        unter.sort()
        for d in sorted(dateien):
            p = os.path.join(ordner, d)
            rel = os.path.relpath(p, wurzel)
            if rel.split(os.sep, 1)[0] in ausser:
                continue
            if os.path.islink(p):
                zeilen.append(rel + " -> " + os.readlink(p))
                continue
            zeilen.append(rel + " " + md5(p))
            anzahl += 1
            bytes_ += os.path.getsize(p)
    h = hashlib.md5("\n".join(zeilen).encode()).hexdigest()
    return {"da": True, "hash": h, "dateien": anzahl, "bytes": bytes_,
            "index": os.path.isfile(os.path.join(wurzel, "index.html"))}


def stand_datei(pfad):
    if not os.path.isfile(pfad):
        return {"da": False}
    return {"da": True, "hash": md5(pfad), "bytes": os.path.getsize(pfad),
            "mtime": int(os.path.getmtime(pfad))}


def node_check(pfad):
    # JSON ist kein JS-Modul: `node --check` prueft CommonJS-Syntax und faellt
    # ueber jede .json ("Unexpected token ':'"). Seit der Herkunftsstempel
    # (herkunft.json) als sechstes Ziel mitreist, braucht er die Pruefung, die
    # zu ihm passt — die Frage bleibt dieselbe: ist die Datei heil, BEVOR sie
    # in den Betriebsordner kommt? (Am 14.08.2026 brach genau hier der erste
    # volle Auslieferungslauf seit dem Stempel-Umbau ab.)
    if pfad.endswith(".json"):
        try:
            with open(pfad, encoding="utf-8") as f:
                json.load(f)
            return {"ok": True, "meldung": ""}
        except ValueError as e:
            return {"ok": False, "meldung": ("kein gueltiges JSON: " + str(e))[:400]}
    p = subprocess.run(["node", "--check", pfad], capture_output=True, text=True)
    return {"ok": p.returncode == 0, "meldung": (p.stderr or p.stdout).strip()[:400]}


def modus_messen(auftrag):
    """Was liegt GERADE am Ziel? Vor dem Tausch, um Gleiches zu ueberspringen —
    danach als Beweis."""
    befund = {}
    for z in auftrag["ziele"]:
        befund[z["name"]] = baumhash(z["ziel"], z.get("ausser")) if z["art"] == "baum" else stand_datei(z["ziel"])
    return befund


def modus_pruefen(auftrag):
    """Alles, was VOR dem Tausch schiefgehen kann, geht hier schief."""
    befund = {"ok": True, "ziele": {}, "beanstandet": []}
    for z in auftrag["ziele"]:
        e = {}
        if z["art"] == "baum":
            e["stand"] = baumhash(z["neu"])
            if not e["stand"].get("da"):
                befund["beanstandet"].append(z["name"] + ": Zwischenlager fehlt")
            elif z.get("muss_enthalten") and not os.path.isfile(os.path.join(z["neu"], z["muss_enthalten"])):
                # Der Auftrag NENNT die Datei (seit E118/1e ist es fuer www
                # neu/index.html — die Wurzel-index war die der geloeschten
                # Angular-App); der alte Vergleich auf das Wort "index.html"
                # plus stand["index"] prüfte fest die Wurzel.
                # Ohne index.html ist die Oberflaeche nach dem Tausch tot —
                # genau so ist die Verwaltung hier schon einmal ausgefallen.
                #
                # WAS EIN BAUM ENTHALTEN MUSS, HAENGT DAVON AB, WAS ER IST.
                # Hier stand diese Pruefung fuer JEDEN Baum, weil es nur zwei
                # gab und beide Oberflaechen waren. Ein Plugin-Ordner hat nie
                # eine index.html; die Pruefung schlug dort zu, ohne dass
                # irgendetwas fehlte. Der Auftrag sagt jetzt, was erwartet
                # wird — steht dort nichts, traegt der Hash-Vergleich weiter
                # unten die Last, und der ist ohnehin die schaerfere Probe:
                # er vergleicht Byte fuer Byte mit dem Arbeitsrechner.
                befund["beanstandet"].append(z["name"] + ": " + z["muss_enthalten"] + " fehlt im Zwischenlager")
            if os.path.islink(z["ziel"]):
                befund["beanstandet"].append(
                    z["name"] + ": " + z["ziel"] + " ist ein VERWEIS. Dieser Weg tauscht"
                    " echte Verzeichnisse (renameat2). Von Hand entscheiden.")
        else:
            e["stand"] = stand_datei(z["neu"])
            if not e["stand"].get("da") or e["stand"].get("bytes", 0) == 0:
                befund["beanstandet"].append(z["name"] + ": Datei fehlt oder ist leer")
            else:
                e["node"] = node_check(z["neu"])
                if not e["node"]["ok"]:
                    befund["beanstandet"].append(z["name"] + ": node --check: " + e["node"]["meldung"])
        befund["ziele"][z["name"]] = e
    # Platz: der Tausch braucht den Baum ein zweites Mal (Rueckweg).
    st = os.statvfs(auftrag["appdir"])
    befund["frei_bytes"] = st.f_bavail * st.f_frsize
    if befund["frei_bytes"] < auftrag.get("braucht_bytes", 0) * 3:
        befund["beanstandet"].append("zu wenig Platz: %d MB frei" % (befund["frei_bytes"] >> 20))
    befund["ok"] = not befund["beanstandet"]
    return befund


def modus_tauschen(auftrag):
    """Der einzige Schritt, der etwas Bleibendes tut."""
    befund = {"getauscht": [], "fehler": []}
    for z in auftrag["ziele"]:
        try:
            if z["art"] == "baum":
                if os.path.islink(z["ziel"]):
                    raise OSError(0, z["ziel"] + " ist ein Verweis")
                # ── WAS IM BAUM STEHT, ABER NICHT IM PAKET, ZIEHT MIT ────────────
                #
                # DAS HAT AM 05.08.2026 EINEN FEHLER VERURSACHT, den dieser Weg
                # SELBST angerichtet hat: `www/active_theme.css` ist ein VERWEIS auf
                # das gewaehlte Thema und liegt IM Baum — er ist keine Bauausgabe,
                # kommt also im Paket nicht vor. Der Tausch nahm ihn mit,
                # `mupibox.theme` stand weiter auf „MupiNew", und gefaerbt wurde
                # NICHTS. Angelegt wird er nur von `setting_update.sh`, und das
                # laeuft nur, wenn jemand in der Verwaltung IRGENDEINE Einstellung
                # speichert — ein Neustart tut es nicht. Die Box lief also ungefaerbt
                # weiter, bis zufaellig jemand etwas anderes einstellte.
                #
                # UND DER KOMMENTAR AM DATEIKOPF LIEF IM KREIS: dort stand
                # „active_theme.css gibt es in www nicht mehr" — es gab sie nicht,
                # WEIL eine vorige Auslieferung sie gefressen hatte. Eine Messung,
                # die den selbst erzeugten Zustand bestaetigt.
                #
                # DIE REGEL IST DESHALB ALLGEMEIN und nicht auf einen Dateinamen
                # gemuenzt: alles, was oben im laufenden Baum liegt und im neuen
                # fehlt, wird uebernommen. Das faengt auch `cover/` wieder ein, falls
                # angular.json es je wieder dorthin legt (die Mine steht im BACKLOG).
                #
                # VERWEISE ZIEHEN ALS VERWEIS um, nicht als Inhalt —
                # `active_theme.css` zeigt auf eine Datei AUSSERHALB des Baums, und
                # eine Kopie waere ab dem naechsten Themenwechsel falsch.
                if os.path.isdir(z["ziel"]):
                    for name in sorted(os.listdir(z["ziel"])):
                        alt_p = os.path.join(z["ziel"], name)
                        neu_p = os.path.join(z["neu"], name)
                        if os.path.lexists(neu_p):
                            continue
                        befund.setdefault("mitgenommen", []).append(z["name"] + "/" + name)
                        if os.path.islink(alt_p):
                            os.symlink(os.readlink(alt_p), neu_p)
                        elif os.path.isdir(alt_p):
                            shutil.copytree(alt_p, neu_p, symlinks=True)
                        else:
                            shutil.copy2(alt_p, neu_p)
                # Die VORIGE Rueckdreh-Erzeugung faellt VOR dem Tausch weg —
                # sonst waechst hier in einer Woche wieder eine Halde. Das
                # Loeschen dauert; der Tausch selbst bleibt dadurch kurz.
                shutil.rmtree(z["zurueck"], ignore_errors=True)
                if os.path.isdir(z["ziel"]):
                    vertauschen(z["neu"], z["ziel"])   # atomar, keine Luecke
                    os.rename(z["neu"], z["zurueck"])  # haelt jetzt den ALTEN Inhalt
                else:
                    os.rename(z["neu"], z["ziel"])     # es gab noch nichts
            else:
                if os.path.isfile(z["ziel"]):
                    if os.path.lexists(z["zurueck"]):
                        os.unlink(z["zurueck"])
                    # Harte Verknuepfung statt Kopie: kostet keinen Platz und
                    # keine Zeit, und der alte Inhalt bleibt unter dem festen
                    # Namen erreichbar.
                    os.link(z["ziel"], z["zurueck"])
                os.replace(z["neu"], z["ziel"])        # atomar
            befund["getauscht"].append(z["name"])
        except Exception as e:  # noqa: BLE001
            befund["fehler"].append(z["name"] + ": " + repr(e))
    return befund


def modus_zurueckdrehen(auftrag):
    befund = {"zurueck": [], "fehler": [], "ohne_rueckweg": [], "ohne_wirkung": []}
    for z in auftrag["ziele"]:
        try:
            # Dateien wie Baeume: VERTAUSCHEN, nicht kopieren. Damit haelt
            # .zurueck danach den Stand, der eben lief — der Rueckweg fuehrt
            # also in beide Richtungen, und es bleibt bei EINER Erzeugung.
            # (Eine harte Verknuepfung waere hier falsch: danach waeren Ziel
            # und Rueckweg derselbe Inode, und der Weg zurueck ginge verloren.)
            da = os.path.isdir(z["zurueck"]) if z["art"] == "baum" else os.path.isfile(z["zurueck"])
            if not da:
                befund["ohne_rueckweg"].append(z["name"])
                continue
            # ZEIGEN BEIDE NAMEN AUF DENSELBEN INODE, IST DAS VERTAUSCHEN
            # WIRKUNGSLOS — und frueher meldete dieser Weg dafuer Erfolg.
            # Genau so lag die Box am 05.08.2026 da: spotify-control.js und
            # spotify-control.js.zurueck waren EINE Datei (Inode 385812,
            # 2 Verweise). Der Zustand entsteht, wenn ein Lauf zwischen
            # `os.link(ziel, zurueck)` und `os.replace(neu, ziel)` abreisst.
            # Ein Rueckweg, der still nichts tut, ist schlimmer als keiner:
            # man glaubt, man sei zurueck.
            if os.stat(z["zurueck"]).st_ino == os.stat(z["ziel"]).st_ino:
                befund["ohne_wirkung"].append(z["name"])
                continue
            vertauschen(z["zurueck"], z["ziel"])
            befund["zurueck"].append(z["name"])
        except Exception as e:  # noqa: BLE001
            befund["fehler"].append(z["name"] + ": " + repr(e))
    return befund


# ── scripts/: Datei fuer Datei, nicht als Baum ───────────────────────────────

def sha256(pfad):
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for brocken in iter(lambda: f.read(1 << 20), b""):
            h.update(brocken)
    return h.hexdigest()


def namen_von(uid, gid):
    try:
        import pwd
        n = pwd.getpwuid(uid).pw_name
    except Exception:
        n = str(uid)
    try:
        import grp
        g = grp.getgrgid(gid).gr_name
    except Exception:
        g = str(gid)
    return n, g


def unit_karte():
    """WER FUEHRT WAS AUS — gemessen, nicht aus einer Tabelle geglaubt.

    Ohne das laesst sich nicht sagen, welcher Dienst nach einem Tausch neu
    starten muss. Und es faengt die teuerste Falle dieses Projekts noch einmal:
    eine Datei an einem Ort, den NIEMAND ausfuehrt. Genau so liegt hier
    mupibox-boot-splash.py — die Unit auf dieser Box nennt
    /usr/local/bin/mupibox-boot-splash.py, der Baum sieht
    /usr/local/bin/mupibox/ vor.

    Die argv der Units sind NICHT normalisiert: systemd zeigt hier
    '/usr/local/bin/mupibox/./change_checker.sh'. Ein Vergleich auf
    Zeichengleichheit wuerde diese Dienste stillschweigend uebersehen —
    deshalb normpath auf jedes Stueck.
    """
    p = subprocess.run(["systemctl", "list-unit-files", "--type=service",
                        "--no-legend", "--no-pager"], capture_output=True, text=True)
    alle = [z.split()[0] for z in (p.stdout or "").splitlines() if z.split()]
    if not alle:
        return {"units": [], "erwartet": 0, "gelesen": 0}

    # VORLAGEN (`foo@.service`) BRINGEN `systemctl show` ZUM ABBRECHEN:
    # „Unit name autovt@.service is neither a valid invocation ID nor unit name."
    # Und zwar MITTEN IN DER AUSGABE — beim ersten Anlauf kamen so von 213 Units
    # nur 5 an, und danach sah JEDE Datei aus, als fuehre sie niemand aus. Das
    # ist die gefaehrliche Sorte Messfehler: sie meldet keinen Fehler, sie meldet
    # ein plausibles „nichts". Deshalb (a) Vorlagen aussortieren, (b) in
    # Broecken fragen, damit ein schlechter Name nicht alles mitnimmt, und
    # (c) am Ende zaehlen, wie viele wirklich gelesen wurden.
    vorlagen = [n for n in alle if n.endswith("@.service")]
    einzeln = [n for n in alle if not n.endswith("@.service")]

    karte: list[dict] = []

    def pfade_aus(text):
        # '{ path=… ; argv[]=a b c ; ignore_errors=… }' — jedes Stueck, das wie
        # ein Pfad aussieht. normpath, weil systemd hier
        # '/usr/local/bin/mupibox/./change_checker.sh' zeigt und ein Vergleich
        # auf Zeichengleichheit diese Dienste stillschweigend uebersaehe.
        aus = set()
        for stueck in text.replace(";", " ").split():
            roh = stueck.split("=", 1)[-1]
            if roh.startswith("/"):
                aus.add(os.path.normpath(roh))
        return aus

    def bloecke(text):
        block = {"pfade": set()}
        for zeile in (text or "").splitlines():
            if not zeile.strip():
                if block.get("unit"):
                    karte.append({"unit": block["unit"], "aktiv": block.get("aktiv"),
                                  "unter": block.get("unter"), "pfade": sorted(block["pfade"])})
                block = {"pfade": set()}
                continue
            k, _, v = zeile.partition("=")
            if k == "Id":
                block["unit"] = v.strip()
            elif k == "ActiveState":
                block["aktiv"] = v.strip()
            elif k == "SubState":
                block["unter"] = v.strip()
            elif k.startswith("Exec"):
                block["pfade"] |= pfade_aus(v)
        if block.get("unit"):
            karte.append({"unit": block["unit"], "aktiv": block.get("aktiv"),
                          "unter": block.get("unter"), "pfade": sorted(block["pfade"])})

    for i in range(0, len(einzeln), 40):
        q = subprocess.run(["systemctl", "show", "--no-pager", *einzeln[i:i + 40],
                            "-p", "Id", "-p", "ActiveState", "-p", "SubState",
                            "-p", "ExecStart", "-p", "ExecStartPre", "-p", "ExecStop"],
                           capture_output=True, text=True)
        bloecke(q.stdout)

    # Vorlagen lassen sich nicht zeigen, aber lesen. mupibox-fehlerbild@.service
    # ruft so mupibox-fehlerbild.py auf — ohne diesen Zweig waere die Datei
    # „ohne Dienst", obwohl es einen gibt.
    for n in vorlagen:
        c = subprocess.run(["systemctl", "cat", n], capture_output=True, text=True)
        pfade = set()
        for zeile in (c.stdout or "").splitlines():
            if zeile.startswith(("ExecStart=", "ExecStartPre=", "ExecStop=")):
                pfade |= pfade_aus(zeile.partition("=")[2])
        if pfade:
            karte.append({"unit": n, "aktiv": "vorlage", "unter": "",
                          "pfade": sorted(pfade)})
    return {"units": karte, "erwartet": len(alle), "gelesen": len(karte)}


def modus_skripte_lage(auftrag):
    """Nur MESSEN: wo liegt jede Datei, mit welchen Rechten, und wer fuehrt sie
    aus. Es wird nichts angefasst. Der Arbeitsrechner entscheidet danach."""
    orte = auftrag["orte"]
    lage = {}
    for name in auftrag["namen"]:
        funde = []
        for ort in orte:
            p = os.path.join(ort, name)
            if not os.path.lexists(p):
                continue
            if os.path.islink(p):
                funde.append({"pfad": p, "verweis": True, "zeigt_auf": os.readlink(p)})
                continue
            st = os.stat(p)
            nutzer, gruppe = namen_von(st.st_uid, st.st_gid)
            e = {"pfad": p, "verweis": False,
                 "modus": "%04o" % (st.st_mode & 0o7777),
                 "uid": st.st_uid, "gid": st.st_gid, "nutzer": nutzer, "gruppe": gruppe,
                 "nlink": st.st_nlink, "bytes": st.st_size, "sha": sha256(p)}
            # Der eigene Rueckweg ist eine harte Verknuepfung auf DIESEN Inode.
            # Er darf nicht als „diese Datei haengt noch woanders dran" zaehlen,
            # sonst verweigert der zweite Lauf, was der erste angelegt hat.
            zk = p + ".zurueck"
            e["zurueck_selber_inode"] = bool(
                os.path.lexists(zk) and not os.path.islink(zk)
                and os.stat(zk).st_ino == st.st_ino)
            e["nlink_fremd"] = st.st_nlink - 1 - (1 if e["zurueck_selber_inode"] else 0)
            funde.append(e)
        lage[name] = funde
    st = os.statvfs(orte[0])
    uk = unit_karte()
    return {"lage": lage, "units": uk["units"],
            "units_erwartet": uk["erwartet"], "units_gelesen": uk["gelesen"],
            "orte_da": dict((o, os.path.isdir(o)) for o in orte),
            "frei_bytes": st.f_bavail * st.f_frsize,
            "als": os.geteuid()}


def modus_skripte_pruefen(auftrag):
    """Alles, was VOR dem Tausch schiefgehen kann — am Zwischenlager, nicht am
    Betriebsordner. Die Entsprechung zu `node --check` bei den vier anderen
    Zielen: bash-Skripte durch `bash -n`, Python durch `ast.parse`.
    KEIN py_compile — das schriebe __pycache__ dorthin, wo nichts entstehen
    soll."""
    import ast
    befund = {"ok": True, "beanstandet": [], "dateien": {}}
    for d in auftrag["dateien"]:
        q = d["quelle"]
        e = {}
        if not os.path.isfile(q) or os.path.getsize(q) == 0:
            befund["beanstandet"].append(d["name"] + ": fehlt im Zwischenlager oder ist leer")
            befund["dateien"][d["name"]] = e
            continue
        e["sha"] = sha256(q)
        e["bytes"] = os.path.getsize(q)
        if e["sha"] != d["sha"]:
            befund["beanstandet"].append(
                d["name"] + ": im Zwischenlager steht " + e["sha"][:12]
                + ", im Baum " + d["sha"][:12])
        if q.endswith(".py"):
            try:
                ast.parse(open(q, "rb").read(), filename=q)
                e["syntax"] = "python ok"
            except SyntaxError as ex:
                befund["beanstandet"].append(d["name"] + ": Python-Syntax: " + str(ex)[:200])
        elif q.endswith(".sh") or open(q, "rb").read(2) == b"#!":
            p = subprocess.run(["bash", "-n", q], capture_output=True, text=True)
            e["syntax"] = "bash -n rc=%d" % p.returncode
            if p.returncode != 0:
                befund["beanstandet"].append(
                    d["name"] + ": bash -n: " + (p.stderr or p.stdout).strip()[:200])
        befund["dateien"][d["name"]] = e
    befund["ok"] = not befund["beanstandet"]
    return befund


def merkzettel_lesen(pfad):
    """Was hat DIESER Weg auf dieser Box schon abgelegt?

    Rueckgabe: (Menge der Ziele, Liste der Eintraege). Ein Eintrag ist
    {"ziel", "sha", "neu", "stempel"} — `neu` heisst: vor diesem Weg lag dort
    NICHTS, es gibt also keine ….zurueck, sondern nur die Moeglichkeit, die
    Datei wieder zu entfernen.

    Faellt der Merkzettel aus (fehlt, unlesbar), wird NICHTS angenommen. Lieber
    eine fremde Datei zu viel geschont als eine zu viel geloescht.
    """
    if not pfad:
        return set(), []
    try:
        with open(pfad) as f:
            zettel = json.load(f)
    except (OSError, ValueError):
        return set(), []
    eintraege = zettel.get("eintraege")
    if eintraege is None:                       # Merkzettel aus der ersten Fassung
        eintraege = [{"ziel": z, "sha": None, "neu": False,
                      "stempel": zettel.get("stempel", "")}
                     for z in (zettel.get("ziele") or [])]
    eintraege = [e for e in eintraege if isinstance(e, dict) and e.get("ziel")]
    return {e["ziel"] for e in eintraege}, eintraege


def merkzettel_schreiben(pfad, eintraege, stempel):
    """EIN Eintrag je Ziel, und die aelteren bleiben stehen.

    Die erste Fassung schrieb den Zettel mit "w" und nur den Zielen DIESES
    Laufs. Nach einem zweiten Lauf galten die Dateien des ersten damit als
    'nicht von diesem Weg' — der Rueckweg ruehrte sie nicht mehr an und
    begruendete das mit einer Unwahrheit. Gemessen in
    tools/skriptweg-rueckweg-luecken.py.
    """
    nach_ziel = {}
    for e in eintraege:
        nach_ziel[e["ziel"]] = e
    geordnet = [nach_ziel[z] for z in sorted(nach_ziel)]
    with open(pfad, "w") as f:
        json.dump({"stempel": stempel, "eintraege": geordnet,
                   # Nur damit eine aeltere Fassung dieses Werkzeugs den Zettel
                   # noch lesen kann. Gelesen wird hier "eintraege".
                   "ziele": [e["ziel"] for e in geordnet]}, f)


def modus_skripte_tauschen(auftrag):
    """Der einzige Schritt, der etwas Bleibendes tut — und der Grund, warum
    dieses Ziel ueberhaupt anders gebaut ist.

    ES WIRD NICHT IN DIE LAUFENDE DATEI GESCHRIEBEN. Erst entsteht ein neuer
    Inode NEBEN dem Ziel (im SELBEN Verzeichnis, damit `rename` nicht ueber eine
    Dateisystemgrenze muss), er bekommt die AM ZIEL GEMESSENEN Rechte und den
    gemessenen Eigentuemer, wird auf die Platte gezwungen — und erst dann haengt
    ein unteilbares `rename(2)` ihn an den Namen. Wer die alte Fassung offen
    hat, behaelt sie bis zum Ende seines Laufs. Ein `cp` wuerde stattdessen den
    laufenden Inode ueberschreiben; bash liest waehrend der Ausfuehrung nach und
    fuehrt danach Bruchstuecke aus.

    fsync auf Datei UND Verzeichnis: diese Box haengt am Akku. Ein Stromverlust
    zwischen Schreiben und Umhaengen darf kein leeres Startskript hinterlassen.
    """
    befund = {"getauscht": [], "fehler": [], "uebersprungen": [],
              "fremde_beiseite": [], "shas": {}}

    # WESSEN ….zurueck LIEGT DA SCHON? Der Merkzettel weiss es. Ohne diese Frage
    # loescht der Hinweg blind, was der Rueckweg sorgfaeltig ueberspringt — und
    # auf DIESER Box liegt genau so eine Datei: mupibox-sicherung.py.zurueck aus
    # einer Kopie von Hand, eigener Inode, in derselben Nacht angelegt. Ein Weg,
    # der in eine Richtung schuetzt und in die andere loescht, schuetzt nicht.
    bekannt, alte_eintraege = merkzettel_lesen(auftrag.get("merkzettel"))
    neue_eintraege = []

    for d in auftrag["dateien"]:
        ziel = d["ziel"]
        tmp = None
        try:
            if os.path.islink(ziel):
                raise OSError(0, ziel + " ist ein VERWEIS — rename wuerde den "
                                        "Verweis ersetzen, nicht sein Ziel")
            ordner = os.path.dirname(ziel)
            tmp = os.path.join(ordner, "." + os.path.basename(ziel) + ".ausliefern")
            with open(d["quelle"], "rb") as q, open(tmp, "wb") as z:
                shutil.copyfileobj(q, z)
                z.flush()
                os.fsync(z.fileno())
            os.chmod(tmp, int(d["modus"], 8))
            os.chown(tmp, d["uid"], d["gid"])
            zurueck = ziel + ".zurueck"
            war_da = os.path.lexists(ziel)
            if war_da:
                if os.path.lexists(zurueck):
                    if ziel in bekannt:
                        os.unlink(zurueck)      # unsere eigene, aus einem frueheren Lauf
                    else:
                        # NICHT VON DIESEM WEG — also nicht seine, also nicht zu
                        # loeschen. Sie geht beiseite und wird gemeldet.
                        beiseite = zurueck + ".fremd"
                        i = 0
                        while os.path.lexists(beiseite):
                            i += 1
                            beiseite = zurueck + ".fremd%d" % i
                        os.rename(zurueck, beiseite)
                        befund["fremde_beiseite"].append(
                            {"war": zurueck, "jetzt": beiseite})
                os.link(ziel, zurueck)          # GENAU EINE, kostet keinen Platz
            os.replace(tmp, ziel)               # unteilbar
            tmp = None
            fd = os.open(ordner, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            befund["getauscht"].append(d["name"])
            befund["shas"][d["name"]] = sha256(ziel)
            # `neu` ist die ganze Frage des Rueckwegs: eine Datei, die vorher
            # nicht da war, hat keine ….zurueck — sie laesst sich nur wieder
            # entfernen, und auch das nur, solange sie unveraendert ist.
            neue_eintraege.append({"ziel": ziel, "sha": befund["shas"][d["name"]],
                                   "neu": not war_da,
                                   "stempel": auftrag.get("stempel", "")})
        except Exception as e:  # noqa: BLE001
            befund["fehler"].append(d["name"] + ": " + repr(e))
            befund["uebersprungen"].append(d["name"])
        finally:
            if tmp and os.path.lexists(tmp):
                try:
                    os.unlink(tmp)
                except OSError:
                    pass

    # DER MERKZETTEL — damit der Rueckweg weiss, was ER angerichtet hat.
    # Ohne ihn nimmt `--zurueckdrehen` jede `….zurueck` mit, die es findet, und
    # es liegen dort auch welche aus Kopien von Hand. Am 08.08.2026 haette der
    # Rueckweg so die in derselben Nacht von Hand nachgezogene
    # mupibox-sicherung.py mit zurueckgedreht — eine Reparatur, die niemand
    # zurueckhaben wollte. Ein Rueckweg darf nur zuruecknehmen, was er gab.
    if auftrag.get("merkzettel"):
        try:
            merkzettel_schreiben(auftrag["merkzettel"],
                                 alte_eintraege + neue_eintraege,
                                 auftrag.get("stempel", ""))
        except OSError as e:  # noqa: BLE001
            befund["fehler"].append("Merkzettel: " + repr(e))
    return befund


def modus_skripte_zurueck(auftrag):
    """Derselbe Rueckweg wie bei den vier anderen Zielen: VERTAUSCHEN, nicht
    kopieren — danach haelt `.zurueck` den Stand, der eben lief."""
    befund = {"zurueck": [], "fehler": [], "ohne_rueckweg": [], "ohne_wirkung": [],
              "vorher": {}, "entfernt": [], "nicht_entfernt": []}

    # DIE DATEIEN, DIE ES VORHER GAR NICHT GAB (--auch-neue). Sie haben keine
    # ….zurueck — es gab nichts zu sichern. Die erste Fassung suchte den
    # Rueckweg ausschliesslich ueber `find … -name '*.zurueck'` und hat sie
    # deshalb nicht einmal ERWAEHNT: der Bericht meldete „zurueckgedreht",
    # waehrend die neuen Dateien liegen blieben. Der alte Stand war das nicht.
    #
    # Entfernt wird nur, was UNVERAENDERT ist seit dem Tag, an dem dieser Weg es
    # hinlegte. Hat seither jemand daran gearbeitet, ist es keine Datei aus
    # diesem Weg mehr, sondern eine fremde Reparatur — dann bleibt sie liegen
    # und wird genannt.
    for d in auftrag.get("entfernen", []):
        ziel = d["ziel"]
        try:
            if not os.path.lexists(ziel):
                befund["nicht_entfernt"].append({"ziel": ziel, "grund": "liegt nicht mehr da"})
                continue
            if os.path.islink(ziel) or not os.path.isfile(ziel):
                befund["nicht_entfernt"].append({"ziel": ziel, "grund": "ist keine einfache Datei"})
                continue
            jetzt_sha = sha256(ziel)
            if d.get("sha") and jetzt_sha != d["sha"]:
                befund["nicht_entfernt"].append(
                    {"ziel": ziel, "grund": "seither veraendert (" + jetzt_sha[:12]
                     + " statt " + d["sha"][:12] + ")"})
                continue
            if not d.get("sha"):
                befund["nicht_entfernt"].append(
                    {"ziel": ziel, "grund": "kein gemerkter Stand — nicht nachweisbar unveraendert"})
                continue
            os.unlink(ziel)
            befund["entfernt"].append(ziel)
        except Exception as e:  # noqa: BLE001
            befund["fehler"].append(ziel + ": " + repr(e))

    for d in auftrag["dateien"]:
        ziel = d["ziel"]
        zurueck = ziel + ".zurueck"
        try:
            if not os.path.isfile(zurueck) or os.path.islink(zurueck):
                befund["ohne_rueckweg"].append(d["name"])
                continue
            if not os.path.isfile(ziel) or os.path.islink(ziel):
                befund["fehler"].append(d["name"] + ": Ziel fehlt oder ist ein Verweis")
                continue
            if os.stat(zurueck).st_ino == os.stat(ziel).st_ino:
                befund["ohne_wirkung"].append(d["name"])
                continue
            befund["vorher"][d["name"]] = sha256(ziel)
            vertauschen(zurueck, ziel)
            befund["zurueck"].append(d["name"])
        except Exception as e:  # noqa: BLE001
            befund["fehler"].append(d["name"] + ": " + repr(e))

    # Eine entfernte Datei hat nichts mehr, wohin man zurueck koennte — ihr
    # Eintrag faellt weg. Die vertauschten bleiben stehen: dort fuehrt der Weg
    # in beide Richtungen, und ein zweites --zurueckdrehen soll das duerfen.
    if auftrag.get("merkzettel") and befund["entfernt"]:
        try:
            _, eintraege = merkzettel_lesen(auftrag["merkzettel"])
            weg = set(befund["entfernt"])
            merkzettel_schreiben(auftrag["merkzettel"],
                                 [e for e in eintraege if e["ziel"] not in weg],
                                 auftrag.get("stempel", ""))
        except OSError as e:  # noqa: BLE001
            befund["fehler"].append("Merkzettel: " + repr(e))
    return befund


def main():
    auftrag = json.load(sys.stdin)
    modus = sys.argv[1]
    fkt = {"pruefen": modus_pruefen, "messen": modus_messen,
           "tauschen": modus_tauschen, "zurueckdrehen": modus_zurueckdrehen,
           "skripte_lage": modus_skripte_lage, "skripte_pruefen": modus_skripte_pruefen,
           "skripte_tauschen": modus_skripte_tauschen,
           "skripte_zurueck": modus_skripte_zurueck}[modus]
    json.dump(fkt(auftrag), sys.stdout)


main()
