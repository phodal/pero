"""Create static Noto fonts and catalog subsets from a checksum-verified source."""
import json
import sys
from pathlib import Path

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


def names(font, family, weight):
    style = "Bold" if weight == 700 else "Regular"
    values = {
        1: family, 2: style, 3: f"{family}-{style}-Pero1",
        4: f"{family} {style}", 6: f"{family.replace(' ', '')}-{style}",
        16: family, 17: style,
    }
    table = font["name"]
    table.names = [record for record in table.names if record.nameID not in values]
    for name_id, value in values.items():
        table.setName(value, name_id, 3, 1, 0x409)
        table.setName(value, name_id, 0, 3, 0)
    font["OS/2"].usWeightClass = weight
    font["OS/2"].fsSelection &= ~((1 << 5) | (1 << 6))
    font["OS/2"].fsSelection |= 1 << (5 if weight == 700 else 6)
    font["head"].macStyle = (font["head"].macStyle & ~1) | (weight == 700)


def build(config):
    if fontTools.__version__ != config["fonttools"]:
        raise RuntimeError(f"Expected fontTools {config['fonttools']}")
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    for weight, suffix in [(400, "Regular"), (700, "Bold")]:
        font = TTFont(config["noto"], recalcTimestamp=False)
        instantiateVariableFont(font, {"wght": weight}, inplace=True)
        if "fvar" in font:
            raise RuntimeError("The pinned Noto source has unexpected remaining axes")
        names(font, "Noto Sans SC Full", weight)
        font.save(out / f"NotoSansSC-{suffix}.ttf")
        options = subset.Options()
        options.name_IDs = ["*"]
        options.name_legacy = True
        options.name_languages = ["*"]
        options.recalc_timestamp = False
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text=config["characters"])
        subsetter.subset(font)
        names(font, "Noto Sans CJK SC", weight)
        font.save(out / f"Workbench-{suffix.lower()}.ttf")
        font.close()


if __name__ == "__main__":
    build(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
