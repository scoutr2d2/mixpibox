#!/usr/bin/env python3
"""
remote-step-installer — llmwiki: a versionable, per-project knowledge store.

The hardcoded rule bases (diagnose signatures, config rules, perf hints) are a
SEED. This module externalizes accumulated knowledge — our hard-won MuPiBox
lessons, cross-project failure fingerprints, how-tos — into portable, git-
versionable **knowledge packs** that BOTH a human reads and an LLM consumes:

  • per project (mupibox has its own pack; a project can ship it in its OWN repo),
  • versionable (a pack is just files → git tag it),
  • fetchable ("llmwiki holen": `wiki fetch <repo-or-url>` pulls a pack), and
  • dual-use: `signatures()/config_rules()/perf_hints()` MERGE typed entries into
    the analyzers; `context()` concatenates the prose into an LLM/human briefing.

Format (OKF-inspired structured metadata + Karpathy-style concatenatable markdown):
a pack = a directory with `pack.yaml` (manifest + `entries:`) and optional `*.md`
notes. See wiki/README.md. An entry has a `kind`:
  signature  {match(regex), sev, cause, fix}          -> feeds diagnose.py
  config     {file, present/absent/present_all, models, requires, why, fix} -> configcheck.py
  perf       {unit, action:drop|consider|swap|consolidate, why, action_text} -> perf.py
  note/howto {}  (pure prose)                          -> LLM/human context only
plus a markdown `body` (the explanation). Any loose `*.md` is loaded as a note.

SAFETY: a fetched wiki is DATA — its fixes are SHOWN to a human/LLM, never auto-run
(unlike a recipe). So pulling a pack from a semi-trusted repo is low-risk.

  python3 wiki.py list                       # all packs (built-in + fetched)
  python3 wiki.py list --wiki mupibox        # one project's knowledge
  python3 wiki.py context --wiki mupibox     # LLM/human briefing (concatenated)
  python3 wiki.py show pi5-fkms-blackscreen  # one entry
  python3 wiki.py fetch http://git.local:3000/achim/mupibox-wiki.git
  python3 wiki.py learn note.md --wiki mupibox   # deposit new knowledge (bulk)
  python3 wiki.py capture --wiki <repo-dir> \\    # deposit a FOUND fix/improvement (reviewed)
      --set kind=signature --set id=mupi-xyz --set match='…' --set cause='…' --set fix='…'
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import urllib.error

BUILTIN_WIKI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "wiki")
WIKI_CACHE = os.path.expanduser("~/.rsi/wiki")
_SKIP_MD = {"readme.md", "format.md", "license.md"}


def _yaml():
    try:
        import yaml
        return yaml
    except ImportError:
        sys.exit("PyYAML nötig für die Wiki (pip install pyyaml)")


def _roots():
    return [p for p in (BUILTIN_WIKI, WIKI_CACHE) if os.path.isdir(p)]


# ── loading ────────────────────────────────────────────────────────────────
def _first_heading(text):
    for ln in text.splitlines():
        if ln.startswith("#"):
            return ln.lstrip("# ").strip()
    return ""


def _load_pack_dir(d):
    """Load one pack dir (pack.yaml + loose *.md notes) → a normalized pack dict."""
    yaml = _yaml()
    man = {}
    pf = os.path.join(d, "pack.yaml")
    if os.path.isfile(pf):
        with open(pf, encoding="utf-8") as f:
            man = yaml.safe_load(f) or {}
    pid = man.get("id") or os.path.basename(d.rstrip("/"))
    entries = []
    for i, e in enumerate(man.get("entries") or []):
        e = dict(e)
        e.setdefault("kind", "note")
        e.setdefault("id", f"{pid}-{i}")
        e.setdefault("title", e["id"])
        e["_pack"], e["_source"] = pid, d
        entries.append(e)
    # loose markdown files become note entries (drop-a-file knowledge)
    for fn in sorted(os.listdir(d)):
        if fn.lower().endswith(".md") and fn.lower() not in _SKIP_MD:
            body = open(os.path.join(d, fn), encoding="utf-8").read()
            entries.append({"kind": "note", "id": os.path.splitext(fn)[0],
                            "title": _first_heading(body) or fn, "body": body,
                            "_pack": pid, "_source": d})
    return {"id": pid, "version": str(man.get("version", "0")),
            "title": man.get("title", pid), "description": man.get("description", ""),
            "entries": entries, "path": d}


def _is_pack_dir(d):
    return os.path.isfile(os.path.join(d, "pack.yaml")) or \
        any(f.lower().endswith(".md") and f.lower() not in _SKIP_MD for f in os.listdir(d))


def load_all():
    """Every pack across the built-in dir + the fetch cache, merged into one view."""
    packs = []
    for root in _roots():
        if _is_pack_dir(root) and os.path.isfile(os.path.join(root, "pack.yaml")):
            packs.append(_load_pack_dir(root))
        for name in sorted(os.listdir(root)):
            d = os.path.join(root, name)
            if os.path.isdir(d) and _is_pack_dir(d):
                packs.append(_load_pack_dir(d))
    return _merge(packs, "alle Wissenspakete")


def resolve(name_or_path):
    """A pack by NAME (project) or a PATH, else all packs.
    name: a dir called <name> under a root, or a pack whose id==name."""
    if not name_or_path or name_or_path == "all":
        return load_all()
    if os.path.isdir(name_or_path):
        return _load_pack_dir(name_or_path)
    if os.path.isfile(name_or_path):  # a pack.yaml
        return _load_pack_dir(os.path.dirname(os.path.abspath(name_or_path)))
    for root in _roots():
        d = os.path.join(root, name_or_path)
        if os.path.isdir(d):
            return _load_pack_dir(d)
    hit = [p for p in load_all()["_packs"] if p["id"] == name_or_path]
    if hit:
        return hit[0]
    sys.exit(f"kein Wissenspaket '{name_or_path}' (gefunden in: {', '.join(_roots()) or '—'})")


def _merge(packs, title):
    entries = [e for p in packs for e in p["entries"]]
    return {"id": "collection", "version": "", "title": title, "description": "",
            "entries": entries, "path": None, "_packs": packs}


def load_default(project=None):
    """The knowledge to use by default: the built-in 'generic' pack ALWAYS, plus the
    project's pack if named — so a human/LLM profits from shared + project knowledge
    without having to ask. `project` may be a recipe id / project name / path."""
    packs = []
    gen = os.path.join(BUILTIN_WIKI, "generic")
    if os.path.isdir(gen):
        packs.append(_load_pack_dir(gen))
    if project:
        base = os.path.splitext(os.path.basename(str(project)))[0]
        try:
            p = resolve(project if (os.path.exists(project)) else base)
            if p.get("id") != "collection":
                packs.append(p)
        except SystemExit:
            pass
    return _merge(packs, "Standard-Wissen" + (f" (+ {project})" if project else ""))


# ── typed extracts (shaped like the analyzers' built-ins, so they MERGE) ─────
def _src1(e):
    s = e.get("source")
    return (s[0] if isinstance(s, list) and s else s) if s else None


def signatures(pack):
    out = []
    for e in pack["entries"]:
        if e.get("kind") == "signature" and e.get("match"):
            out.append({"re": e["match"], "sev": e.get("sev", "med"),
                        "cause": e.get("cause", e.get("title", "")),
                        "fix": e.get("fix", ""), "_wiki": e.get("id"), "source": _src1(e)})
    return out


def config_rules(pack):
    out = []
    for e in pack["entries"]:
        if e.get("kind") == "config" and e.get("file"):
            r = {"file": e["file"], "sev": e.get("sev", "med"),
                 "why": e.get("why", e.get("title", "")), "fix": e.get("fix", ""),
                 "_wiki": e.get("id"), "source": _src1(e)}
            for k in ("present", "absent", "present_all", "models", "requires"):
                if k in e:
                    r[k] = e[k]
            out.append(r)
    return out


def perf_hints(pack):
    out = []
    for e in pack["entries"]:
        if e.get("kind") == "perf" and e.get("unit"):
            out.append({"unit": e["unit"], "kind": e.get("action", "consider"),
                        "why": e.get("why", e.get("title", "")),
                        "action": e.get("action_text", e.get("fix", "")),
                        "_wiki": e.get("id"), "source": _src1(e)})
    return out


def optims(pack):
    """'Optimierung möglich'-Einträge: aktuell genutzt → neuer/besser + Gewinn + wie.
    Forward-looking (Upgrade/Swap eines Pakets/einer Methode), nicht auto-gefeuert —
    per `wiki --kind optim` / `context --kind optim` für Mensch/LLM sichtbar."""
    return [{"id": e.get("id"), "title": e.get("title"), "current": e.get("current"),
             "better": e.get("better"), "gain": e.get("gain"), "how": e.get("how"),
             "since": e.get("since"), "source": _src1(e)}
            for e in pack["entries"] if e.get("kind") == "optim"]


# ── context for an LLM / a human (Karpathy-style concatenation) ──────────────
def context(pack, kinds=None, query=None, limit=60):
    q = (query or "").lower()
    lines, n = [], 0
    head = pack.get("title", "Wissen")
    lines.append(f"# llmwiki: {head}")
    if pack.get("description"):
        lines.append(pack["description"])
    lines.append("")
    for e in pack["entries"]:
        if kinds and e.get("kind") not in kinds:
            continue
        blob = " ".join(str(e.get(k, "")) for k in
                        ("title", "cause", "why", "fix", "match", "unit", "file", "body", "tags"))
        if q and q not in blob.lower():
            continue
        lines.append(f"## [{e.get('kind')}] {e.get('title')}   ({e.get('_pack','?')})")
        if e.get("kind") == "signature":
            lines.append(f"- Fehler-Signatur (regex): `{e.get('match','')}`")
            if e.get("cause"):
                lines.append(f"- Ursache: {e['cause']}")
        if e.get("kind") == "config":
            where = e.get("present") or e.get("present_all") or ("fehlt: " + e["absent"] if e.get("absent") else "")
            lines.append(f"- Datei {e.get('file','')}  ({where})"
                         + (f"  · nur Modelle {e['models']}" if e.get("models") else ""))
        if e.get("kind") == "perf":
            lines.append(f"- Dienst/Muster: {e.get('unit','')}  [{e.get('action','')}]")
        if e.get("kind") == "optim":
            for k, lab in (("current", "Aktuell"), ("better", "Besser"), ("gain", "Gewinn"),
                           ("since", "Verfügbar ab"), ("how", "Umstellen")):
                if e.get(k):
                    lines.append(f"- {lab}: {e[k]}")
        if e.get("fix"):
            lines.append(f"- Fix: {e['fix']}")
        if e.get("action_text"):
            lines.append(f"- Aktion: {e['action_text']}")
        if e.get("source"):
            src = e["source"] if isinstance(e["source"], list) else [e["source"]]
            lines.append("- Quelle (verifizieren): " + " · ".join(str(s) for s in src))
        if e.get("body"):
            lines.append("")
            lines.append(e["body"].strip())
        lines.append("")
        n += 1
        if n >= limit:
            lines.append(f"… ({limit} Einträge gezeigt — mit --query eingrenzen)")
            break
    return "\n".join(lines), n


# ── fetch ("llmwiki holen") ─────────────────────────────────────────────────
def _name_from_url(url):
    base = url.rstrip("/").split("/")[-1]
    return re.sub(r"\.git$", "", base) or "wiki"


def _name_from_path(pfad):
    """Der Cache-Name fuer einen oertlichen Pack.

    Bei `…/llmwiki/pack.yaml` ist der Ordner gemeint, nicht die Datei —
    „pack" waere als Name eines Wissenspakets nichtssagend.
    """
    pfad = pfad.rstrip(os.sep)
    if os.path.basename(pfad) == "pack.yaml":
        pfad = os.path.dirname(pfad)
    return os.path.basename(pfad) or "wiki"


def fetch(url, name=None):
    """Pull a knowledge pack into the cache. A git URL is cloned/updated; a raw
    pack.yaml URL is downloaded; a LOCAL path is copied. Data, never executed.

    ══ DER OERTLICHE WEG, UND WARUM ES IHN GEBEN MUSS ══════════════════════
    Hier stand `sys.exit("nur http(s)-URLs")`. Das war richtig, solange das
    Wissenspaket in einem eigenen Repo lag — man HOLTE es ja von woanders.

    Seit dem 08.08.2026 liegt es IM Baum (`llmwiki/pack.yaml`, siehe
    ZUGEZOGEN.md). Ohne diesen Zweig kaeme der Controller an genau die Fassung
    NICHT heran, die neben ihm liegt: Er zog weiter aus dem stillgelegten
    Repo und arbeitete mit v12 (53 Eintraege), waehrend im Baum v160 mit 583
    stand. Gemessen am 08.08.2026 — beide Zwischenspeicher waren echte
    TEILMENGEN des Baums, es fehlten also 530 Eintraege und keiner war neu.

    Ein Diagnosewerkzeug, das in 53 statt 583 Eintraegen sucht, findet den
    Fall nicht und sagt trotzdem „nichts bekannt".
    """
    if not re.match(r"^https?://", url):
        pfad = os.path.abspath(os.path.expanduser(url))
        if not os.path.exists(pfad):
            sys.exit(f"weder http(s)-URL noch vorhandener Pfad: {url}")
        quelle = pfad if os.path.isfile(pfad) else os.path.join(pfad, "pack.yaml")
        if not os.path.isfile(quelle):
            sys.exit(f"keine pack.yaml unter {pfad}")
        name = name or _name_from_path(pfad)
        ziel = os.path.join(WIKI_CACHE, name)
        os.makedirs(ziel, exist_ok=True)
        # KOPIEREN UND NICHT VERKNUEPFEN: Der Zwischenspeicher soll auch dann
        # noch stehen, wenn der Baum gerade woanders liegt (anderer Rechner,
        # anderer Auscheckstand). Eine Verknuepfung waere ein Loch, sobald der
        # Pfad sich aendert.
        shutil.copyfile(quelle, os.path.join(ziel, "pack.yaml"))
        pack = _load_pack_dir(ziel)
        print(f"\033[1;32m✓ uebernommen:\033[0m {pack['title']} v{pack['version']} "
              f"({len(pack['entries'])} Einträge) ← {quelle}")
        print(f"  nutzen:  --wiki {name}   (oder --wiki {pack['id']})")
        return
    name = name or _name_from_url(url)
    os.makedirs(WIKI_CACHE, exist_ok=True)
    dest = os.path.join(WIKI_CACHE, name)
    if url.endswith(".git") or "/_git/" in url or url.rstrip("/").endswith((".git/",)):
        if os.path.isdir(os.path.join(dest, ".git")):
            r = subprocess.run(["git", "-C", dest, "pull", "--ff-only"],
                               capture_output=True, text=True, timeout=120)
        else:
            r = subprocess.run(["git", "clone", "--depth", "1", url, dest],
                               capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            sys.exit(f"git-Fehler: {(r.stderr or r.stdout).strip()[:400]}")
    else:  # a raw pack.yaml
        os.makedirs(dest, exist_ok=True)
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                data = resp.read()
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            sys.exit(f"Download-Fehler: {e}")
        with open(os.path.join(dest, "pack.yaml"), "wb") as f:
            f.write(data)
    # validate + report
    pack = _load_pack_dir(dest if os.path.isfile(os.path.join(dest, "pack.yaml"))
                          else _find_pack_subdir(dest) or dest)
    print(f"\033[1;32m✓ geholt:\033[0m {pack['title']} v{pack['version']} "
          f"({len(pack['entries'])} Einträge) → {pack['path']}")
    print(f"  nutzen:  --wiki {name}   (oder --wiki {pack['id']})")
    return pack


def _find_pack_subdir(d):
    for name in sorted(os.listdir(d)):
        sub = os.path.join(d, name)
        if os.path.isdir(sub) and os.path.isfile(os.path.join(sub, "pack.yaml")):
            return sub
    return None


# ── write side: append / validate / capture (deposit knowledge) ─────────────
KNOWN_KINDS = {"signature", "config", "perf", "optim", "note", "howto"}
_REQUIRED = {"signature": ["match"], "config": ["file"], "perf": ["unit"], "optim": ["title"]}


def validate_entry(e):
    """Sanity-check a would-be entry before it is written into a pack."""
    if not isinstance(e, dict):
        return False, "kein Objekt"
    k = e.get("kind")
    if k not in KNOWN_KINDS:
        return False, f"kind '{k}' unbekannt (erlaubt: {', '.join(sorted(KNOWN_KINDS))})"
    if not e.get("id") or not re.match(r"^[a-z0-9][a-z0-9-]*$", str(e["id"])):
        return False, "id fehlt/ungültig (^[a-z0-9][a-z0-9-]*$)"
    for f in _REQUIRED.get(k, []):
        if not e.get(f):
            return False, f"Feld '{f}' fehlt (nötig für kind {k})"
    if not (e.get("title") or e.get("body") or e.get("cause") or e.get("why")):
        return False, "mindestens eins von title/body/cause/why nötig"
    return True, ""


def _append_entries(pack_dir, new_entries):
    """Neue Einträge ANHÄNGEN und die Version hochziehen — TEXTUELL, nicht per
    yaml.safe_dump der ganzen Datei. Ein Re-Dump würde Kommentare, Abschnitte und
    Formatierung des Pakets vernichten (genau das ist beim ersten echten capture
    passiert). Der bestehende Text bleibt daher unangetastet; nur die Versionszeile
    wird ersetzt und der neue Eintrag hinten angefügt."""
    yaml = _yaml()
    if not os.path.isdir(pack_dir):
        sys.exit(f"kein Paket-Ordner: {pack_dir}  (capture/learn brauchen den Repo-Ordner)")
    pf = os.path.join(pack_dir, "pack.yaml")
    text = ""
    man = {}
    if os.path.isfile(pf):
        with open(pf, encoding="utf-8") as f:
            text = f.read()
        man = yaml.safe_load(text) or {}
    ids = {e.get("id") for e in (man.get("entries") or [])}
    for e in new_entries:
        if e.get("id") in ids:
            sys.exit(f"id '{e['id']}' existiert schon im Paket — bitte umbenennen")

    ver = str(int(float(man.get("version", 0))) + 1)
    if re.search(r"(?m)^version:\s*.*$", text):
        text = re.sub(r"(?m)^version:\s*.*$", f'version: "{ver}"', text, count=1)
    else:
        text = f'version: "{ver}"\n' + text
    if not re.search(r"(?m)^entries:", text):
        text = text.rstrip("\n") + "\nentries:\n"

    chunks = []
    for e in new_entries:
        block = yaml.safe_dump([e], allow_unicode=True, sort_keys=False, width=98,
                               default_flow_style=False)
        chunks.append("\n".join("  " + ln if ln.strip() else ln
                                for ln in block.rstrip("\n").splitlines()))
    text = text.rstrip("\n") + "\n\n" + "\n\n".join(chunks) + "\n"

    with open(pf, "w", encoding="utf-8") as f:      # erst schreiben, dann prüfen
        f.write(text)
    check = yaml.safe_load(open(pf, encoding="utf-8")) or {}
    if len(check.get("entries") or []) != len(ids) + len(new_entries):
        sys.exit(f"Anhängen erzeugte ungültiges YAML — bitte {pf} prüfen")
    return ver


def capture(pack_dir, entry, assume_yes=False):
    """Deposit a SINGLE found improvement/bugfix as a reviewed wiki entry. The tool
    proposes, a human confirms (unless assume_yes — e.g. already reviewed in chat).
    NEVER a silent auto-write: the wiki is shared, versioned knowledge."""
    ok, msg = validate_entry(entry)
    if not ok:
        sys.exit(f"Eintrag ungültig: {msg}")
    text, _ = context({"title": entry.get("id"), "description": "", "entries": [dict(entry)]})
    print(text)
    if not assume_yes:
        try:
            ans = input("\n\033[1mDiesen Eintrag ins Wiki aufnehmen? [j/N] \033[0m").strip().lower()
        except EOFError:
            ans = ""
        if ans not in ("j", "y", "ja", "yes"):
            print("abgebrochen — nichts geschrieben.")
            return False
    ver = _append_entries(pack_dir, [entry])
    print(f"\033[1;32m✓ aufgenommen\033[0m → {os.path.join(pack_dir, 'pack.yaml')}  (v{ver})")
    print("  \033[2mnoch committen: git add -A && git commit && git tag v%s && git push --tags "
          "— dann holen andere es per `wiki fetch`.\033[0m" % ver)
    return True


def learn(pack_dir, src_file):
    """Append entries from a YAML (list/pack) or a markdown note into a pack's
    pack.yaml — the bulk write side ('jetziges Wissen ablegen')."""
    yaml = _yaml()
    if src_file.lower().endswith((".yaml", ".yml")):
        doc = yaml.safe_load(open(src_file, encoding="utf-8")) or {}
        new = list((doc.get("entries", doc) if isinstance(doc, dict) else doc) or [])
    else:  # markdown note
        body = open(src_file, encoding="utf-8").read()
        new = [{"kind": "note", "id": os.path.splitext(os.path.basename(src_file))[0],
                "title": _first_heading(body) or os.path.basename(src_file), "body": body}]
    ver = _append_entries(pack_dir, new)
    print(f"\033[1;32m✓ {len(new)} Eintrag/Einträge abgelegt\033[0m → "
          f"{os.path.join(pack_dir, 'pack.yaml')}  (v{ver})")


# ── human report ────────────────────────────────────────────────────────────
KIND_TAG = {"signature": "\033[1;31mSIGNATUR\033[0m", "config": "\033[1;33mCONFIG  \033[0m",
            "perf": "\033[1;36mPERF    \033[0m", "note": "\033[2mNOTE    \033[0m",
            "howto": "\033[1;35mHOWTO   \033[0m", "optim": "\033[1;32mOPTIM   \033[0m"}


def report(pack, kinds=None, query=None):
    packs = pack.get("_packs") or [pack]
    label = ", ".join("%s v%s" % (p["id"], p["version"]) for p in packs)
    print(f"\033[1m llmwiki\033[0m \033[2m({label})\033[0m")
    q = (query or "").lower()
    shown = 0
    for e in pack["entries"]:
        if kinds and e.get("kind") not in kinds:
            continue
        blob = " ".join(str(e.get(k, "")) for k in
                        ("title", "cause", "why", "fix", "match", "unit", "body", "better", "gain"))
        if q and q not in blob.lower():
            continue
        tag = KIND_TAG.get(e.get("kind"), e.get("kind", "?"))
        sub = e.get("cause") or e.get("why") or e.get("gain") or _first_heading(e.get("body", "")) or ""
        print(f"  [{tag}] \033[1m{e.get('id')}\033[0m \033[2m({e.get('_pack')})\033[0m")
        if sub:
            print(f"           {sub[:96]}")
        shown += 1
    print(f"\n  \033[2m{shown} Einträge\033[0m")


def main():
    ap = argparse.ArgumentParser(description="llmwiki — versionierbare Wissensablage")
    ap.add_argument("action", choices=["list", "show", "context", "fetch", "learn", "capture", "roots"])
    ap.add_argument("arg", nargs="?", help="entry-id (show) / url (fetch) / file (learn)")
    ap.add_argument("--wiki", help="Paket (Projektname/Pfad; leer = alle; capture/learn: der Repo-Ordner)")
    ap.add_argument("--kind", action="append", help="nur diese Art (signature/config/perf/optim/note/howto)")
    ap.add_argument("--query", help="Volltext-Filter")
    ap.add_argument("--as", dest="as_name", help="fetch: Zielname")
    ap.add_argument("--set", dest="sets", action="append", metavar="key=value",
                    help="capture: ein Eintrags-Feld (mehrfach), z.B. --set kind=signature --set match=…")
    ap.add_argument("--json", help="capture: ganzer Eintrag als JSON-Datei oder '-' (stdin)")
    ap.add_argument("--yes", action="store_true", help="capture: ohne Rückfrage schreiben (Review schon erfolgt)")
    a = ap.parse_args()

    if a.action == "roots":
        for r in _roots():
            print(r)
        return
    if a.action == "fetch":
        if not a.arg:
            sys.exit("fetch braucht eine URL")
        fetch(a.arg, a.as_name)
        return
    if a.action == "learn":
        if not a.arg or not a.wiki:
            sys.exit("learn braucht --wiki <paket-ordner> und eine Datei")
        learn(a.wiki if os.path.isdir(a.wiki) else os.path.join(BUILTIN_WIKI, a.wiki), a.arg)
        return
    if a.action == "capture":
        if not a.wiki:
            sys.exit("capture braucht --wiki <paket-ordner> (der Wiki-Repo-Ordner)")
        pack_dir = a.wiki if os.path.isdir(a.wiki) else os.path.join(BUILTIN_WIKI, a.wiki)
        if a.json:
            raw = sys.stdin.read() if a.json == "-" else open(a.json, encoding="utf-8").read()
            entry = json.loads(raw)
        else:
            entry = {}
            for kv in (a.sets or []):
                if "=" not in kv:
                    sys.exit(f"--set erwartet key=value, nicht '{kv}'")
                k, v = kv.split("=", 1)
                entry[k.strip()] = v
        if not entry:
            sys.exit("capture braucht --json <datei|-> oder --set key=value …")
        capture(pack_dir, entry, assume_yes=a.yes)
        return

    pack = resolve(a.wiki)
    if a.action == "list":
        report(pack, a.kind, a.query)
    elif a.action == "context":
        text, _ = context(pack, a.kind, a.query)
        print(text)
    elif a.action == "show":
        if not a.arg:
            sys.exit("show braucht eine entry-id")
        e = next((x for x in pack["entries"] if x.get("id") == a.arg), None)
        if not e:
            sys.exit(f"kein Eintrag '{a.arg}'")
        text, _ = context({"title": e.get("id"), "description": "", "entries": [e]})
        print(text)


if __name__ == "__main__":
    main()
