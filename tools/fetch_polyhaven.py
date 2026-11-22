"""Download Poly Haven models (CC0) used for sprite renders.

Usage:  python tools/fetch_polyhaven.py
Reads the model list from tools/sprites.json and stores each glTF (1k textures) in
art/source/polyhaven/<asset_id>/ (git-ignored; re-run this script to restore them).
"""
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "art" / "source" / "polyhaven"
UA = {"User-Agent": "EscapeTheCastle-asset-fetch"}
RES = "1k"


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def download(url, dest: pathlib.Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        dest.write_bytes(r.read())


def main():
    config = json.loads((ROOT / "tools" / "sprites.json").read_text(encoding="utf-8"))
    assets = sorted({m for s in config["sprites"] for m in [s.get("model"), *s.get("extraModels", [])] if m})
    credits = []
    for asset in assets:
        files = get_json(f"https://api.polyhaven.com/files/{asset}")
        info = get_json(f"https://api.polyhaven.com/info/{asset}")
        gltf = files["gltf"][RES]["gltf"]
        folder = OUT / asset
        download(gltf["url"], folder / pathlib.Path(gltf["url"]).name)
        for rel, inc in gltf.get("include", {}).items():
            # Keep downloads inside the asset folder.
            target = (folder / rel).resolve()
            if folder.resolve() not in target.parents:
                raise ValueError(f"Refusing path outside asset folder: {rel}")
            download(inc["url"], target)
        credits.append(f"- {info['name']} by {', '.join(info.get('authors', {}))}: https://polyhaven.com/a/{asset} (CC0)")
        print("ok", asset)
    (OUT / "CREDITS.txt").write_text("\n".join(credits) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
