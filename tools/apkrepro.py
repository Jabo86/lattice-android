#!/usr/bin/env python3
"""Impronta del CONTENUTO di un APK, indipendente dalla firma.

Due APK compilati dallo stesso sorgente hanno gli stessi byte in ogni voce dello zip, ma
firme diverse: la firma v2/v3 vive in un blocco fuori dalle voci, la v1 in META-INF. Qui si
ignorano soltanto quelle, e si confronta tutto il resto voce per voce. È questo che rende
verificabile una build: chiunque ricompila e ottiene la stessa impronta del contenuto.

Uso:
  apkrepro.py manifest <apk> [-o out.json]
  apkrepro.py compare <apk_a> <apk_b>
  apkrepro.py check <apk> <manifest.json>
"""
import hashlib
import json
import re
import sys
import zipfile

SIG = re.compile(r"^META-INF/(?:[^/]+\.(?:RSA|DSA|EC|SF)|MANIFEST\.MF)$", re.I)


def entries(path):
    out = {}
    with zipfile.ZipFile(path) as z:
        for i in z.infolist():
            if i.is_dir() or SIG.match(i.filename):
                continue
            out[i.filename] = hashlib.sha256(z.read(i.filename)).hexdigest()
    return out


def content_hash(e):
    h = hashlib.sha256()
    for n in sorted(e):
        h.update(n.encode() + b"\0" + e[n].encode() + b"\n")
    return h.hexdigest()


def manifest(path):
    e = entries(path)
    return {
        "tool": "apkrepro/1",
        "apk_sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
        "entries": len(e),
        "content_sha256": content_hash(e),
        "files": e,
    }


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    cmd = sys.argv[1]

    if cmd == "manifest":
        m = manifest(sys.argv[2])
        if "-o" in sys.argv:
            open(sys.argv[sys.argv.index("-o") + 1], "w").write(json.dumps(m, indent=1, sort_keys=True) + "\n")
        print(json.dumps({k: v for k, v in m.items() if k != "files"}, indent=1))
        return 0

    if cmd in ("compare", "check"):
        a = entries(sys.argv[2])
        b = entries(sys.argv[3]) if cmd == "compare" else json.load(open(sys.argv[3]))["files"]
        only_a = sorted(set(a) - set(b))
        only_b = sorted(set(b) - set(a))
        diff = sorted(n for n in set(a) & set(b) if a[n] != b[n])
        ha, hb = content_hash(a), content_hash(b)
        print("A content_sha256:", ha)
        print("B content_sha256:", hb)
        print("voci: %d vs %d" % (len(a), len(b)))
        for n in only_a:
            print("  SOLO IN A:", n)
        for n in only_b:
            print("  SOLO IN B:", n)
        for n in diff:
            print("  DIVERSA:", n)
        if ha == hb:
            print("\nRIPRODUCIBILE: il contenuto è identico byte per byte.")
            return 0
        print("\nNON RIPRODUCIBILE: %d voci diverse, %d solo in A, %d solo in B."
              % (len(diff), len(only_a), len(only_b)))
        return 1

    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
