#!/usr/bin/env python3
"""Turn the data-request workbook into a blank template.

The workbook registered as the `data_request` template was the one the FIRST house filled
in and sent back. build-collateral swaps three strings in it — legal entity, address,
product focus — and ships the rest untouched, which meant every prospect received that
house's own figures: segment revenues, units, average prices, COGS ratios, the volumes in
each price band, their answers about group payment structure and their insurance broker,
and the Microsoft sensitivity labels their tenant had stamped on the file.

This produces the same workbook with the questions, structure, formatting and formulas
intact and every ANSWER removed. Run it whenever the source workbook is revised:

    python3 scripts/blank-data-request-template.py in.xlsx out.xlsx

Then upload the result to the `decks` bucket at the path deck_templates.storage_path names
for key 'data_request' (see 20260912000002_data_request_blank_template.sql).

It works on the XML directly rather than through openpyxl on purpose: openpyxl rewrites the
whole package and loses the styling, the merges and the column widths that make the workbook
look like something a client can fill in.
"""

from __future__ import annotations

import re
import shutil
import sys
import zipfile

# ── What comes out ──────────────────────────────────────────────────────────────────────
# Cells whose value is an ANSWER. Cleared: cached value and inline string go, the cell's
# style stays so the box still reads as "fill me in". A cell carrying a FORMULA keeps the
# formula (see KEEP_FORMULA) unless it is listed here as well.
ANSWER_CELLS = {
    # Question/answer sheet. B2 and B3 are the legal entity and address — those are filled
    # per brand by the text slots, so they are not cleared here.
    "Company structure": ["B5:B6"],
    "Data": [
        "B4:B6",      # geography of the pilot, of the roll-out, and the roll-out timeline
        "B9:B11", "B14:B16", "B20:C25",   # segment 1: revenues, channels, price bands
        "F9:F11", "F14:F16", "F20:G25",   # segment 2: the same block
        "A29:G30",    # the product mix, sub-category names included
    ],
}

# Derived cells inside the ranges above that keep their formula and lose only the cached
# value, so the template still adds up for whoever fills it in.
KEEP_FORMULA = {"Data": ["B11", "F11", "B25", "C25", "F25", "G25"]}

# The one formula that is an answer, not machinery: the first house's COGS assumption
# (=36%/1.22) sitting in the product-mix table.
DROP_FORMULA = {"Data": ["E29"]}

# Totals in the segment-1 block start at row 21 and miss the first price band; the
# segment-2 block gets it right. Same table, two different ranges — fix the outlier.
FIX_FORMULA = {"Data": {"B25": "SUM(B20:B24)", "C25": "SUM(C20:C24)"}}

# Text replaced in the shared string table. Two kinds:
#
#   * labels that name the first house's own categories → neutral wording. The strings are
#     shared, so a label used in both segment blocks is replaced in both.
#
#   * the three cells build-collateral fills per brand → explicit placeholders. They used to
#     hold the first house's legal entity, registered office and product focus, and the
#     template mapping found them BY THAT TEXT. So a revision of the workbook that moved or
#     reworded any of the three left the slot unmatched and the workbook went out contracted
#     to that house — a silent leak, in the one cell a client reads first. A token cannot
#     leak: if it is ever left unmatched it goes out as "{{BRAND_LEGAL_NAME}}", which nobody
#     sends by accident.
LABELS = {
    "Company information - Precious Bags EU": "Company information — segment 1",
    "Company information - Watches": "Company information — segment 2",
    "Distribution channels - Precious Bags EU": "Distribution channels",
    "Bags only": "Volumes by price range",
    "Salvatore Ferragamo S.p.A.": "{{BRAND_LEGAL_NAME}}",
    "Via dei Tornabuoni 2, 50123 Florence, Italy": "{{BRAND_ADDRESS}}",
    "Bags, Watches": "{{BRAND_FOCUS}}",
}


def col_to_n(col: str) -> int:
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n


def expand(ranges: list[str]) -> set[tuple[int, int]]:
    """A1 ranges → the set of (column, row) pairs they cover."""
    out: set[tuple[int, int]] = set()
    for r in ranges:
        a, _, b = r.partition(":")
        b = b or a
        c1, r1 = re.match(r"([A-Z]+)(\d+)", a).groups()
        c2, r2 = re.match(r"([A-Z]+)(\d+)", b).groups()
        for c in range(col_to_n(c1), col_to_n(c2) + 1):
            for row in range(int(r1), int(r2) + 1):
                out.add((c, row))
    return out


def ref_to_pair(ref: str) -> tuple[int, int]:
    c, r = re.match(r"([A-Z]+)(\d+)", ref).groups()
    return col_to_n(c), int(r)


def sheet_paths(z: zipfile.ZipFile) -> dict[str, str]:
    """Sheet name → part path, resolved through the relationship ids."""
    wb = z.read("xl/workbook.xml").decode()
    rels = z.read("xl/_rels/workbook.xml.rels").decode()
    targets = {
        m.group(1): m.group(2).lstrip("/").replace("xl/", "").lstrip("./")
        for m in re.finditer(r'<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels)
    }
    out = {}
    for m in re.finditer(r"<sheet\s([^>]*?)/?>", wb):
        attrs = m.group(1)
        name = re.search(r'name="([^"]*)"', attrs)
        rid = re.search(r'r:id="([^"]+)"', attrs)
        if name and rid and rid.group(1) in targets:
            out[name.group(1)] = f"xl/{targets[rid.group(1)]}"
    return out


def blank_sheet(xml: str, sheet: str) -> tuple[str, int]:
    clear = expand(ANSWER_CELLS.get(sheet, []))
    keep_f = {ref_to_pair(r) for r in KEEP_FORMULA.get(sheet, [])}
    drop_f = {ref_to_pair(r) for r in DROP_FORMULA.get(sheet, [])}
    fixes = {ref_to_pair(k): v for k, v in FIX_FORMULA.get(sheet, {}).items()}
    cleared = 0

    def cell(m: re.Match) -> str:
        nonlocal cleared
        whole, ref, attrs, inner = m.group(0), m.group(1), m.group(2), m.group(3) or ""
        pair = ref_to_pair(ref)
        if pair not in clear and pair not in fixes:
            return whole
        formula = re.search(r"<f[^>]*>.*?</f>|<f[^>]*/>", inner, re.S)
        had_value = bool(re.search(r"<v>|<is>", inner))
        if pair in fixes:
            formula_xml = f"<f>{fixes[pair]}</f>"
        elif pair in keep_f and formula and pair not in drop_f:
            formula_xml = formula.group(0)
        else:
            formula_xml = ""
        if not had_value and not formula:
            return whole
        cleared += 1
        # `t` describes the type of a value that is no longer there.
        attrs = re.sub(r'\st="[^"]*"', "", attrs)
        return f'<c r="{ref}"{attrs}>{formula_xml}</c>' if formula_xml else f'<c r="{ref}"{attrs}/>'

    out = re.sub(r'<c r="([A-Z]+\d+)"([^>]*?)(?:/>|>(.*?)</c>)', cell, xml, flags=re.S)
    return out, cleared


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    shutil.copyfile(src, dst)

    with zipfile.ZipFile(src) as z:
        parts = {n: z.read(n) for n in z.namelist()}
        paths = sheet_paths(z)

    total = 0
    for sheet, path in paths.items():
        xml, n = blank_sheet(parts[path].decode(), sheet)
        parts[path] = xml.encode()
        total += n
        print(f"  {sheet}: cleared {n} cells")

    # Labels, in the shared string table.
    if "xl/sharedStrings.xml" in parts:
        shared = parts["xl/sharedStrings.xml"].decode()
        for find, replace in LABELS.items():
            if find in shared:
                shared = shared.replace(find, replace)
                print(f'  label: "{find}" → "{replace}"')
        # Clearing a text cell leaves its string ORPHANED in the table: invisible in Excel,
        # still there in the bytes, so "Yes AON, but not covering this type of insurance"
        # travels with the file to every prospect who unzips it or searches it. Anything no
        # cell points at any more is emptied — by content, so the indexes other cells use
        # are untouched.
        used: set[int] = set()
        for path in paths.values():
            # Self-closing cells have to be matched as such: `<c r="A3" s="1"/>` against a
            # pattern that insists on `>…</c>` swallows the NEXT cell, and the string that
            # cell pointed at then looks unreferenced. That emptied half the questions on
            # the first run of this script.
            for m in re.finditer(r'<c r="[A-Z]+\d+"([^>]*?)(?:/>|>(.*?)</c>)', parts[path].decode(), re.S):
                if 't="s"' in m.group(1):
                    for v in re.finditer(r"<v>(\d+)</v>", m.group(2) or ""):
                        used.add(int(v.group(1)))
        entries = re.findall(r"<si>.*?</si>", shared, re.S)
        orphans = 0
        for i, entry in enumerate(entries):
            if i in used:
                continue
            text = "".join(re.findall(r"<t[^>]*>(.*?)</t>", entry, re.S))
            if not text:
                continue
            shared = shared.replace(entry, "<si><t/></si>", 1)
            orphans += 1
        if orphans:
            print(f"  emptied {orphans} orphaned strings (answers no cell references any more)")
        parts["xl/sharedStrings.xml"] = shared.encode()

    # The originating tenant's sensitivity labels, and who last saved it.
    parts.pop("docProps/custom.xml", None)
    if "[Content_Types].xml" in parts:
        parts["[Content_Types].xml"] = re.sub(
            r'<Override[^>]*PartName="/docProps/custom\.xml"[^>]*/>', "",
            parts["[Content_Types].xml"].decode()).encode()
    for rel in ("_rels/.rels",):
        if rel in parts:
            parts[rel] = re.sub(
                r'<Relationship[^>]*Target="docProps/custom\.xml"[^>]*/>', "",
                parts[rel].decode()).encode()
    if "docProps/core.xml" in parts:
        core = parts["docProps/core.xml"].decode()
        core = re.sub(r"<cp:lastModifiedBy>.*?</cp:lastModifiedBy>", "<cp:lastModifiedBy>AION</cp:lastModifiedBy>", core, flags=re.S)
        core = re.sub(r"<dc:creator>.*?</dc:creator>", "<dc:creator>AION</dc:creator>", core, flags=re.S)
        parts["docProps/core.xml"] = core.encode()
    print("  stripped docProps/custom.xml (sensitivity labels) and reset the author")

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as out:
        for name, data in parts.items():
            out.writestr(name, data)
    print(f"{total} cells cleared → {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
