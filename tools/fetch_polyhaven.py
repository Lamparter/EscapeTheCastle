"""Download Poly Haven models and photo textures (all CC0) used for the game's art.

Usage:  python tools/fetch_polyhaven.py
Reads tools/sprites.json:
  - models (each sprite's "model" / "extraModels") -> art/source/polyhaven/<id>/ as glTF (1k textures)
  - "textures"     -> art/source/textures/<id>/ (diffuse, roughness, normal; 1k JPG) for Blender materials
  - "gameTextures" -> public/textures/<id>_diff.jpg (diffuse only) for art drawn in the game itself
  - "skyPhotos"    -> art/source/images/<id>.jpg (Poly Haven HDRI, tone-mapped photo) for window views
  - "images"       -> art/source/images/<name>.jpg from a direct URL (e.g. public-domain museum scans)
art/source/ is git-ignored; re-run this script to restore it. Writes CREDITS.txt files listing authors.
"""
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODELS = ROOT / "art" / "source" / "polyhaven"
TEXTURES = ROOT / "art" / "source" / "textures"
IMAGES = ROOT / "art" / "source" / "images"
GAME_TEXTURES = ROOT / "public" / "textures"
UA = {"User-Agent": "EscapeHollybankManor-asset-fetch"}
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


def credit(asset):
    info = get_json(f"https://api.polyhaven.com/info/{asset}")
    return f"- {info['name']} by {', '.join(info.get('authors', {}))}: https://polyhaven.com/a/{asset} (CC0)"


def fetch_model(asset):
    gltf = get_json(f"https://api.polyhaven.com/files/{asset}")["gltf"][RES]["gltf"]
    folder = MODELS / asset
    download(gltf["url"], folder / pathlib.Path(gltf["url"]).name)
    for rel, inc in gltf.get("include", {}).items():
        target = (folder / rel).resolve()
        if folder.resolve() not in target.parents:  # keep downloads inside the asset folder
            raise ValueError(f"Refusing path outside asset folder: {rel}")
        download(inc["url"], target)


def fetch_texture(asset, maps=("Diffuse", "Rough", "nor_gl")):
    files = get_json(f"https://api.polyhaven.com/files/{asset}")
    for m in maps:
        # Some textures name their colour map differently (e.g. colour variants "coll1").
        key = next((k for k in ([m, "coll1", "Color"] if m == "Diffuse" else [m]) if k in files), None)
        if key:
            url = files[key][RES]["jpg"]["url"]
            download(url, TEXTURES / asset / f"{m.lower()}.jpg")


def main():
    config = json.loads((ROOT / "tools" / "sprites.json").read_text(encoding="utf-8"))
    models = sorted({m for s in config["sprites"] for m in [s.get("model"), *s.get("extraModels", [])] if m})
    textures = sorted(set(config.get("textures", [])))
    game_textures = sorted(set(config.get("gameTextures", [])))

    model_credits = []
    for asset in models:
        fetch_model(asset)
        model_credits.append(credit(asset))
        print("model ok", asset)
    MODELS.mkdir(parents=True, exist_ok=True)
    (MODELS / "CREDITS.txt").write_text("\n".join(model_credits) + "\n", encoding="utf-8")

    tex_credits = []
    for asset in sorted(set(textures) | set(game_textures)):
        fetch_texture(asset)
        tex_credits.append(credit(asset))
        print("texture ok", asset)
    TEXTURES.mkdir(parents=True, exist_ok=True)
    (TEXTURES / "CREDITS.txt").write_text("\n".join(tex_credits) + "\n", encoding="utf-8")

    for sky in config.get("skyPhotos", []):
        url = get_json(f"https://api.polyhaven.com/files/{sky}")["tonemapped"]["url"]
        download(url, IMAGES / f"{sky}.jpg")
        tex_credits.append(credit(sky))
        print("sky ok", sky)
    (TEXTURES / "CREDITS.txt").write_text("\n".join(tex_credits) + "\n", encoding="utf-8")
    for img in config.get("images", []):
        download(img["url"], IMAGES / f"{img['name']}.jpg")
        print("image ok", img["name"])

    for asset in game_textures:
        src = TEXTURES / asset / "diffuse.jpg"
        GAME_TEXTURES.mkdir(parents=True, exist_ok=True)
        (GAME_TEXTURES / f"{asset}_diff.jpg").write_bytes(src.read_bytes())
        print("game texture ok", asset)


if __name__ == "__main__":
    main()
