"""Deck-wide output checks for decks built from a tonality pack (OF-110..OF-119).

The per-slide craft floor in craft_extras.py judges one slide at a time. These checks read the whole
compiled deck the way a reader flips through it:

  OF-110  title treatments — at least three treatments over the titled slides (the variance dial caps the
          upper end), every title recognised as one of the eight, and the treatment drawn matches the
          `title@<id>` name the engine wrote
  OF-111  composition variety — distinct (title zone, body partition, dominant content) signatures over the
          content slides, and no one signature or layout on more than 40 % of them
  OF-112  body use — the share of the body left empty under the lowest block, per slide against the density
          cap (advice) and as a deck median against 0.20
  OF-113  one frame per treatment — every slide that wears a treatment keeps its title x, y and width (a bottom
          title its x, width and bottom edge: it stands on the floor whatever its line count)
  OF-114  labels, not sentences — slide titles and the cover subtitle name a topic; they never state a claim
  OF-115  no region left empty — a bottom title on the body floor, a side rail that carries its slide's
          criteria, takeaways or source, a column of a two-column body with no empty band inside it over 40 %
          of the body (a strip closing the column does not hide the band above it), a takeaway column as long
          as the visual beside it, a title panel over a picture as tall as its text, no plate under an empty page
  OF-116  (qa_deck.py --sibling) another tonality of the same source draws another skeleton on at least two
          content slides (one, under four content slides)
  OF-117  no light figure card (a mostly near-white picture) on a dark ground
  OF-118  a bold run-in label is followed by its separator ("요약: …", "Summary: …")
  OF-119  an agenda's title carries no count numeral beside it (its rows are numbered)

Everything is measured on the .pptx in points. A deck the engine did not stamp (`title@…` names absent) is
not judged here. A legacy template (`title@legacy`) gets advice instead of a block on the variety checks,
because its geometry has no treatments to choose from.
"""

from __future__ import annotations

import io
import re

TREATMENTS = ("top-rule", "top-plain-large", "side-rail", "band", "statement", "overlay", "kicker-numeral", "bottom-anchor")
ZONE = {"top-rule": "top", "top-plain-large": "top", "kicker-numeral": "top", "side-rail": "side", "band": "band",
        "overlay": "overlay", "bottom-anchor": "bottom", "statement": "none"}
TOL, SIZE_TOL = 2.0, 0.5
MIN_SLIDES, MIN_TREATMENTS = 8, 3
VARIETY_CAP, MAX_SHARE = 5, 0.40
FLOOR, FOOTER_TOP, DECK_BAND_MAX = 486.0, 492.0, 0.20
BAND_CAP = ((2, 0.28), (4, 0.24), (6, 0.20), (8, 0.16), (10, 0.12))  # density ceiling -> per-slide cap
ANCHOR_TOL = 1.0
RAIL = {960: (288.0, 336.0), 720: (216.0, 252.0)}  # widest four-column rail, earliest column-5 start
SIDE_MARGIN = {960: {"airy": 60.0, "standard": 48.0, "dense": 36.0, "compact": 24.0},
               720: {"airy": 54.0, "standard": 42.0, "dense": 30.0, "compact": 24.0}}
STAMP = re.compile(r"\blit-pptx tonality=(\S+) density=(\d+) grid=(\w+) variance=(\d+)")
ORDINAL = re.compile(r"\d+(?:[.:/-]\d+)?\.?")
REGION_GAP, REGION_SHARE = 12.0, 0.40  # OF-115: floor gap under a bottom title (pt); empty share of a region
FIGURE_GROUND, NEAR_WHITE, FIGURE_SHARE, FIGURE_MIN_AREA = 0.25, 235, 0.5, 0.03  # OF-117
RUN_IN_SEPARATOR = re.compile(r"[:：.)\]?!–—\-]$")  # OF-118: a label that ends in its own separator


# ── reading the slide ───────────────────────────────────────────────────────

def _points(shape):
    try:
        if shape.left is None or shape.width is None:
            return None
        return tuple(value / 12700.0 for value in (shape.left, shape.top, shape.width, shape.height))
    except (TypeError, ValueError):
        return None


def _words(shape):
    if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
        return shape.text_frame.text.strip()
    return ""


def _sizes(shape):
    if not (getattr(shape, "has_text_frame", False) and shape.has_text_frame):
        return []
    return [run.font.size.pt for paragraph in shape.text_frame.paragraphs for run in paragraph.runs
            if run.text.strip() and run.font.size is not None]


def _has_fill(shape):
    try:
        return shape.fill.type is not None and shape.fill.type != 5  # 5 = background
    except (AttributeError, TypeError):
        return False


def _inside(mark, box, tol=1.0):
    cx, cy = mark["x"] + mark["w"] / 2, mark["y"] + mark["h"] / 2
    return box["x"] - tol <= cx <= box["x"] + box["w"] + tol and box["y"] - tol <= cy <= box["y"] + box["h"] + tol


def _touches_edges(mark, W, H, tol=2.0):
    return sum([mark["x"] <= tol, mark["y"] <= tol, mark["x"] + mark["w"] >= W - tol, mark["y"] + mark["h"] >= H - tol]) >= 2


def read_marks(slide, W, H):
    """Every drawn shape in points with its kind and role: content, card (a fill holding content) or decoration."""
    marks = []
    for shape in slide.shapes:
        box = _points(shape)
        if box is None or box[2] + box[3] <= 0 or shape.name.startswith("lit-notice"):
            continue
        text = _words(shape)
        if shape.shape_type == 13:  # picture
            kind = "picture"
        elif getattr(shape, "has_table", False) and shape.has_table:
            kind = "table"
            box = (box[0], box[1], box[2], max(box[3], sum(row.height for row in shape.table.rows) / 12700.0))
        elif getattr(shape, "has_chart", False) and shape.has_chart:
            kind = "chart"
        else:
            kind = "text" if text else "shape"
        marks.append({"name": shape.name, "kind": kind, "x": box[0], "y": box[1], "w": box[2], "h": box[3],
                      "text": text, "sizes": _sizes(shape), "filled": kind == "shape" and _has_fill(shape)})
    for mark in marks:
        if mark["kind"] != "shape":
            mark["role"] = "content"
            continue
        holds = any(other["kind"] != "shape" and _inside(other, mark) for other in marks if other is not mark)
        card = (mark["filled"] and holds and not _touches_edges(mark, W, H) and mark["w"] >= 100 and mark["h"] >= 40
                and mark["w"] * mark["h"] < 0.5 * W * H)
        mark["role"] = "card" if card else "decoration"
    return marks


def _in_footer(mark):
    return mark["y"] >= FOOTER_TOP


# ── OF-110: which treatment a title shows ───────────────────────────────────

def title_treatment(title, marks, W, H):
    """The treatment the page shows, tested in a fixed order; the first that holds wins."""
    size = max(title["sizes"] or [0.0])
    bottom = title["y"] + title["h"]
    rest = [m for m in marks if m is not title]
    body = [m for m in rest if not _in_footer(m) and m["role"] != "decoration"]

    def under_title(m):
        return (m["x"] - TOL <= title["x"] and title["x"] + title["w"] <= m["x"] + m["w"] + TOL
                and m["y"] - TOL <= title["y"] and bottom <= m["y"] + m["h"] + TOL)

    full_picture = any(m["kind"] == "picture" and m["w"] * m["h"] >= 0.8 * W * H for m in rest)
    if full_picture and title["y"] >= 300 - TOL and any(m["kind"] == "shape" and m["filled"] and under_title(m) for m in rest):
        return "overlay"
    if any(m["kind"] == "shape" and m["filled"] and m["y"] <= 2 + TOL and 96 - TOL <= m["h"] <= 120 + TOL
           and m["w"] >= 0.9 * W and _inside(title, m, TOL) for m in rest):
        return "band"
    if (size >= 36 - SIZE_TOL and 220 - TOL <= title["y"] + title["h"] / 2 <= 380 + TOL
            and not any(m["kind"] in ("table", "chart", "picture") or m["role"] == "card" for m in body)
            and sum(1 for m in body if m["kind"] == "text") <= 1):
        return "statement"
    if title["y"] >= 360 - TOL and all(m["y"] <= title["y"] + TOL for m in body if m["kind"] == "text"):
        return "bottom-anchor"
    rail_w, column5 = RAIL.get(round(W), RAIL[960])
    beside = [m for m in body if m["x"] + m["w"] / 2 > title["x"] + title["w"]]
    if (title["w"] <= rail_w + TOL and beside and min(m["x"] for m in beside) >= column5 - TOL
            and not any(m["x"] < column5 - TOL and m["y"] > bottom and m["x"] + m["w"] > column5 + TOL for m in body)):
        # What stands in the rail under the title (criteria labels, takeaways, the source) belongs to the rail.
        return "side-rail"
    for m in rest:
        if (m["kind"] == "text" and m["sizes"] and ORDINAL.fullmatch(m["text"]) and max(m["sizes"]) >= 44 - SIZE_TOL
                and m["x"] + m["w"] <= title["x"] + TOL and m["y"] >= 30 - TOL and m["y"] + m["h"] <= 114 + TOL):
            return "kicker-numeral"
    if title["y"] <= 48 + TOL:
        # A rule is a line under the title: wider than 16 pt and four times its height (a list dot is not one).
        ruled = any(m["kind"] == "shape" and m["h"] <= 8 and m["w"] >= max(16, 4 * m["h"]) and bottom - TOL <= m["y"] <= bottom + 24
                    and m["x"] < title["x"] + title["w"] and m["x"] + m["w"] > title["x"] for m in rest)
        if size >= 36 - SIZE_TOL and not ruled:
            return "top-plain-large"
        if size <= 32 + SIZE_TOL and ruled:
            return "top-rule"
    return "unclassified"


# ── OF-111: what a content slide looks like ─────────────────────────────────

def _is_figure(mark):
    flat = re.sub(r"\s+", "", mark["text"])
    digits = len(re.findall(r"\d", flat))
    return mark["kind"] == "text" and bool(mark["sizes"]) and max(mark["sizes"]) >= 44 - SIZE_TOL and digits / max(1, len(flat)) >= 0.5


def _partition(blocks, W, margin):
    """How the body divides: blocks sharing half their width form a column; a box over 70 % of the body
    width (a takeaway under two columns) never joins columns."""
    narrow = [b for b in blocks if b["w"] < 0.7 * (W - 2 * margin)] or blocks
    columns = []
    for block in sorted(narrow, key=lambda b: b["x"]):
        overlapping = [c for c in columns
                       if min(c["r"], block["x"] + block["w"]) - max(c["l"], block["x"]) >= 0.5 * min(c["r"] - c["l"], block["w"])]
        if not overlapping:
            columns.append({"l": block["x"], "r": block["x"] + block["w"], "items": [block]})
            continue
        keep = overlapping[0]
        for other in overlapping[1:]:
            keep["l"], keep["r"] = min(keep["l"], other["l"]), max(keep["r"], other["r"])
            keep["items"] += other["items"]
            columns.remove(other)
        keep["l"], keep["r"] = min(keep["l"], block["x"]), max(keep["r"], block["x"] + block["w"])
        keep["items"].append(block)
    column_of = {id(item): n for n, c in enumerate(columns) for item in c["items"]}
    rows = []
    for block in sorted(narrow, key=lambda b: b["y"]):
        if rows and block["y"] < rows[-1]["bottom"] - 2:
            rows[-1]["bottom"] = max(rows[-1]["bottom"], block["y"] + block["h"])
            rows[-1]["items"].append(block)
        else:
            rows.append({"bottom": block["y"] + block["h"], "items": [block]})
    shared_rows = sum(1 for row in rows if len({column_of[id(i)] for i in row["items"]}) >= 2)
    count = len(columns)
    if count >= 4 or (count >= 2 and shared_rows >= 2):
        return "grid"
    if count == 3:
        return "three"
    if count == 2:
        a, b = (c["r"] - c["l"] for c in columns)
        return "two-even" if min(a, b) / max(a, b) >= 0.85 else "two-asym"
    return "one"


def signature(title, treatment, marks, W, H, margin):
    """(title zone, body partition, dominant content) of one content slide."""
    zone = ZONE.get(treatment, "none")
    if treatment == "statement":
        return (zone, "one", "text")
    column5 = RAIL.get(round(W), RAIL[960])[1]
    body = []
    for m in marks:
        if m is title or _in_footer(m) or m["role"] == "decoration":
            continue
        if treatment == "side-rail" and m["x"] + m["w"] <= column5 + TOL:
            continue  # the rail under a side title is the title zone's, not a body column
        if m["kind"] == "shape" and title is not None and _inside(title, m, 0):
            continue  # the panel the title sits on
        if treatment == "kicker-numeral" and m["kind"] == "text" and ORDINAL.fullmatch(m["text"]) and m["y"] + m["h"] <= 116:
            continue
        body.append(m)
    cards = [m for m in body if m["role"] == "card"]
    blocks = [m for m in body if not any(c is not m and _inside(m, c) for c in cards)]
    if any(m["kind"] == "picture" and m["w"] * m["h"] >= 0.8 * W * H for m in marks):
        partition = "full-bleed"
    else:
        partition = _partition(blocks, W, margin) if blocks else "one"
    weight = {}
    kinds = {"picture": "image", "table": "table", "chart": "chart"}
    for m in blocks:
        key = kinds.get(m["kind"]) or ("number" if _is_figure(m) else "text" if m["kind"] == "text" else None)
        if key:
            weight[key] = weight.get(key, 0.0) + m["w"] * m["h"]
    for card in cards:
        inner = [m for m in body if m is not card and _inside(m, card)]
        key = "number" if any(_is_figure(m) for m in inner) else "text"
        weight[key] = weight.get(key, 0.0) + card["w"] * card["h"]
    return (zone, partition, max(weight, key=weight.get) if weight else "text")


# ── OF-112: how much of the body stays empty ───────────────────────────────

def empty_band(title, marks, top_margin=36.0):
    """Share of the body under its lowest block, from the title foot (or the top margin when the title sits
    low) to the body floor; decoration, footer and notice do not count as content."""
    top = title["y"] + title["h"] if title is not None and title["y"] + title["h"] < FLOOR * 0.6 else top_margin
    if FLOOR - top < 10:
        return None
    ink = [m for m in marks if m["role"] != "decoration" and not _in_footer(m) and m["y"] < FLOOR and m["y"] + m["h"] > top]
    lowest = max((min(FLOOR, m["y"] + m["h"]) for m in ink), default=top)
    return max(0.0, (FLOOR - lowest) / (FLOOR - top))


# ── OF-114: a title names a topic ──────────────────────────────────────────

KO_CLAIM = re.compile(r"(?:니다|[어아해세에예네지군래게]요|죠|[었았였했겠됐](?:다|음)|[가-힣]다|[가-힣](?:함|됨)|(?:있|없)음)$")
KO_NOUNS = {"바다", "판다", "소다", "람다", "캐나다", "어젠다", "아젠다", "포함", "보다", "함", "다"}
EN_AUX = re.compile(r"\b(?:is|are|was|were|has|have|had|will|would|can|could|should|must|does|did|won't|isn't|aren't|wasn't|doesn't|didn't)\b", re.I)
EN_REPORT_VERBS = set("""
grew grows rose rises fell falls doubled doubles tripled triples halved halves increased increases decreased decreases
declined declines improved improves dropped drops climbed climbs beats outperforms outperformed leads drives drove shows
showed needs makes reached reaches exceeded exceeds missed misses stays stayed remains remained comes came takes took
works worked pays paid saves saved explains explained matters wins won lost loses cuts lifts lifted slowed slows fails failed
""".split())


def is_claim(text):
    """True when a title or subtitle is a sentence that states a claim rather than a label for the topic.
    A trailing parenthesis is set aside first; a question or a quotation is not a claim."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    t = re.sub(r"\s*\([^()]*\)$", "", t).strip().rstrip("\"'”’")
    if not t or t.endswith("?") or t[0] in "“\"「『‘'":
        return False
    if re.search(r"[가-힣]", t):
        last = re.sub(r"[.!…]+$", "", t.split(" ")[-1])
        return last not in KO_NOUNS and bool(KO_CLAIM.search(last))
    if t.endswith((".", "!")):
        return True
    words = re.findall(r"[A-Za-z']+", t)
    return bool(EN_AUX.search(t)) or any(word.lower() in EN_REPORT_VERBS for word in words[1:])


# ── OF-115: no region left empty

def _title_lines(title):
    """How many lines a title sets: each broken line wraps on its own (Hangul about 1 em a glyph, Latin 0.55 em)."""
    size = max(title["sizes"] or [26.0])
    room = max(1.0, (title["w"] - 14.4) / size)  # the frame's default side insets
    pieces = [piece for piece in re.split(r"[\n\v]", title["text"]) if piece.strip()]
    return max(1, sum(max(1, -(-int(sum(1 if "가" <= c <= "힣" else .55 for c in piece) * 100) // int(room * 100))) for piece in pieces))


def _largest_gap(top, bottom, spans):
    """The tallest stretch of [top, bottom] that no (y0, y1) span covers."""
    gap, cursor = 0.0, top
    for y0, y1 in sorted(spans):
        if y1 <= cursor:
            continue
        gap = max(gap, max(0.0, min(y0, bottom) - cursor))
        cursor = max(cursor, y1)
    return max(gap, bottom - cursor)


def _short_column(p, content, title, shown, body_floor, column5, W, H):
    """A column of a two-column body that stops short of its neighbour: the largest empty band inside it, from the
    body's top down to where the neighbour ends, over 40 % of the body. A source or note strip that closes the
    column does not hide the band above it. Returns (shape name, value) or None."""
    # The body starts under a top title; beside a side title (in its rail) or over a bottom title, at the top.
    top_of_title = title["y"] + title["h"] if shown not in ("bottom-anchor", "side-rail") else 0.0
    fields = [m for m in p["marks"] if m["kind"] == "shape" and m["filled"] and m["w"] * m["h"] >= 0.1 * W * H]
    body = [m for m in content if m["y"] >= top_of_title - TOL and m["y"] < body_floor and m["w"] > 0 and m["h"] > 0
            and not (shown == "side-rail" and m["x"] + m["w"] <= column5 + TOL) and not any(_inside(m, f) for f in fields)]
    if len(body) < 2:
        return None
    left_edge, right_edge = min(m["x"] for m in body), max(m["x"] + m["w"] for m in body)
    for cut in sorted({m["x"] + m["w"] for m in body}):
        a = [m for m in body if m["x"] + m["w"] <= cut + TOL]
        b = [m for m in body if m["x"] >= cut - TOL]
        # A block across most of the body (a note under both columns) belongs to neither column.
        across = [m for m in body if m not in a and m not in b]
        if not a or not b or any(m["w"] < 0.7 * (right_edge - left_edge) for m in across):
            continue
        top = min(m["y"] for m in a + b)
        for column, other in ((a, b), (b, a)):
            # A chart's values table under the takeaways beside it counts with their column.
            values = any(m["kind"] == "chart" for m in other) and any(m["kind"] == "text" for m in column) \
                and not any(m["kind"] in ("chart", "picture") for m in column)
            # A text column, or a picture drawn smaller than its column, beside a column that runs on.
            if not any(m["kind"] in ("text", "picture") for m in column) or (any(m["kind"] in ("chart", "table") for m in column) and not values):
                continue
            # Row heads (a matrix's or a comparison's short labels, each level with its row) are no column to fill.
            if all(m["kind"] == "text" and m["h"] <= 56 and len(re.sub(r"\s+", "", m["text"])) <= 16 for m in column):
                continue
            reach = min(body_floor, max(m["y"] + m["h"] for m in other))  # read whatever the neighbour's length
            # Beside kpi-row or big-number figures (not their own labels, level with them) the column runs to the floor.
            size = lambda side: max([max(m["sizes"]) for m in side if m["kind"] == "text" and m["sizes"]] or [0.0])  # noqa: E731
            figures = [m for m in other if m["kind"] == "text" and m["sizes"] and max(m["sizes"]) > size(column) + 4]
            if p["family"] in ("kpi-row", "big-number") and figures and not any(abs(m["y"] - f["y"]) <= .5 and f["y"] > top + TOL for m in column for f in figures):
                reach = body_floor
            share = _largest_gap(top, reach, [(m["y"], m["y"] + m["h"]) for m in column]) / max(1.0, body_floor - top)
            if share > REGION_SHARE:
                what = "picture" if any(m["kind"] == "picture" for m in column) else "text"
                return column[0]["name"], f"the {what} column beside a longer one leaves {share:.0%} of the body empty inside it"
    return None


def _empty_regions(pages, W, H, note):
    column5 = RAIL.get(round(W), RAIL[960])[1]
    for p in pages:
        title, shown = p["title"], p.get("shown")
        full_picture = any(m["kind"] == "picture" and m["w"] * m["h"] >= 0.8 * W * H for m in p["marks"])
        content = [m for m in p["marks"] if m is not title and m["role"] != "decoration" and not _in_footer(m)
                   and not (m["kind"] == "picture" and m["w"] * m["h"] >= 0.8 * W * H)]
        if p["kind"] in ("content", "closing") and title is not None and title["sizes"]:
            if shown == "bottom-anchor":
                gap = FLOOR - (title["y"] + _title_lines(title) * max(title["sizes"]) * 1.15)
                if gap > REGION_GAP:
                    note("OF-115", "HIGH", p["n"], title["name"], f"the bottom title ends {gap:.0f} pt above the body floor", REGION_GAP,
                         "Stand the title's last line on the floor and give the visual above it the room.")
            if shown == "side-rail" and p["family"] not in ("quote", "statement"):
                top = title["y"] + title["h"]  # the frame keeps a spare line for a title that wraps once more
                rail = [m for m in content if m["x"] + m["w"] <= column5 + TOL and m["y"] + m["h"] > top]
                share = _largest_gap(top, FLOOR, [(m["y"], m["y"] + m["h"]) for m in rail]) / max(1.0, FLOOR - top)
                if share > REGION_SHARE:
                    note("OF-115", "HIGH", p["n"], title["name"], f"{share:.0%} of the side rail under the title is empty", REGION_SHARE,
                         "Put the slide's criteria labels, takeaways or source in the rail, or give it a top or bottom title.")
            # A takeaway column beside a chart, table or picture may run on below it.
            body_floor = title["y"] - TOL if shown == "bottom-anchor" else FLOOR
            fields = [m for m in p["marks"] if m["kind"] == "shape" and m["filled"] and m["w"] * m["h"] >= 0.1 * W * H]
            short = _short_column(p, content, title, shown, body_floor, column5, W, H)
            if short:
                note("OF-115", "HIGH", p["n"], short[0], short[1], REGION_SHARE,
                     "Fill the column by layout: lead size, the source and values in the column, a narrower column with a wider visual, or the points under the visual.")
            for v in ([] if short else [m for m in content if m["kind"] in ("chart", "table", "picture")]):
                beside = [m for m in content if m["kind"] == "text" and m["y"] < v["y"] + v["h"] and m["y"] + m["h"] > v["y"]
                          and (m["x"] >= v["x"] + v["w"] - TOL or m["x"] + m["w"] <= v["x"] + TOL)
                          and not any(_inside(m, f) for f in fields)]
                if not beside:
                    continue
                left, right = min(m["x"] for m in beside), max(m["x"] + m["w"] for m in beside)
                top = min([v["y"]] + [m["y"] for m in beside])
                column = max(m["y"] + m["h"] for m in content if left - TOL <= m["x"] + m["w"] / 2 <= right + TOL)
                visual = min(body_floor, max(m["y"] + m["h"] for m in content if v["x"] - TOL <= m["x"] + m["w"] / 2 <= v["x"] + v["w"] + TOL))
                share = (visual - column) / max(1.0, body_floor - top)
                if share > REGION_SHARE:
                    note("OF-115", "HIGH", p["n"], v["name"], f"the column beside the {v['kind']} leaves {share:.0%} of the body empty under its last block",
                         REGION_SHARE, "Close the column with the source and note lines, the chart's values or the takeaways; never stretch the visual alone.")
                    break
        if title is None or not (p["kind"] in ("cover", "section") or shown in ("statement", "overlay")):
            continue
        # A title panel over a picture, and a plate under a statement or quote.
        for panel in [m for m in p["marks"] if m["kind"] == "shape" and m["filled"] and _inside(title, m) and m["w"] * m["h"] < 0.9 * W * H]:
            inside = [m for m in content + [title] if m is not panel and _inside(m, panel)]
            if panel["y"] > TOL and full_picture:
                floor = min(panel["y"] + panel["h"], FLOOR)
                share = _largest_gap(panel["y"], floor, [(m["y"], m["y"] + m["h"]) for m in inside]) / max(1.0, floor - panel["y"])
                if share > REGION_SHARE:
                    note("OF-115", "HIGH", p["n"], panel["name"], f"{share:.0%} of the panel that carries the title is empty", REGION_SHARE,
                         "Make the panel as tall as the title and its lines, standing on the page foot.")
            if panel["y"] > TOL and shown == "statement" and panel["w"] >= 0.9 * W and not any(m["y"] + m["h"] <= panel["y"] + TOL for m in content):
                note("OF-115", "HIGH", p["n"], panel["name"], "a plate under part of the page leaves the open page above it empty", "content above",
                     "Set the sentence on the whole-page field or on the open page; a plate needs content above it.")


# ── OF-116: another tonality draws another skeleton

def skeleton(prs):
    W, H = prs.slide_width / 12700.0, prs.slide_height / 12700.0
    stamp = STAMP.search(prs.core_properties.subject or "")
    margin = SIDE_MARGIN[960 if round(W) == 960 else 720].get(stamp.group(3) if stamp else "standard", 48.0)
    out = []
    for slide in prs.slides:
        marks = read_marks(slide, W, H)
        family = next((s.name.split("@", 1)[1] for s in slide.shapes if s.name.startswith("family@")), "")
        if _kind_of(family) != "content":
            continue
        title = next((m for m in marks if m["name"].startswith("title@")), None)
        shown = title_treatment(title, marks, W, H) if title and title["sizes"] else None
        out.append(signature(title, shown, marks, W, H, margin)[:2])
    return out


def compare_skeletons(prs, sibling, sibling_name):
    """OF-116 findings (craft_extras' shape) for a deck and the same source built under another tonality."""
    a, b = skeleton(prs), skeleton(sibling)
    n = min(len(a), len(b))
    differ = sum(1 for x, y in zip(a, b) if x != y)
    # Two slides must differ once the deck has four content slides.
    need = 2 if n >= 4 else 1
    if not n or differ >= need:
        return []
    return [{"rule": "OF-116", "severity": "HIGH", "slide": None, "shape": "",
             "value": f"{differ} of {n} content slides differ in title zone or partition from {sibling_name} (needs {need})", "threshold": need,
             "tier": "derived", "hint": "Give the tonality its own structure: its role defaults, another title zone or partition on the slides it shares."}]


# ── OF-117: no light figure card on a dark ground

def _light_figures(number, slide, W, H, note):
    try:
        ground = slide.background.fill.fore_color.rgb if slide.background.fill.type == 1 else None
    except (AttributeError, TypeError, ValueError):
        ground = None
    if ground is None:
        return
    r, g, b = (int(str(ground)[i:i + 2], 16) / 255 for i in (0, 2, 4))
    if 0.2126 * r + 0.7152 * g + 0.0722 * b > FIGURE_GROUND:
        return
    try:
        from PIL import Image
    except ImportError:
        return
    for shape in slide.shapes:
        box = _points(shape)
        if shape.shape_type != 13 or not box or not FIGURE_MIN_AREA * W * H <= box[2] * box[3] < 0.8 * W * H:
            continue
        with Image.open(io.BytesIO(shape.image.blob)) as image:
            raw = image.convert("RGB").resize((64, 64)).tobytes()
        share = sum(1 for i in range(0, len(raw), 3) if min(raw[i:i + 3]) >= NEAR_WHITE) / (len(raw) / 3)
        if share > FIGURE_SHARE:
            note("OF-117", "HIGH", number, shape.name, f"a light figure ({share:.0%} near-white) on a dark ground", FIGURE_SHARE,
                 "Put the figure's dark variant beside it (name.dark.png) or draw it as a native chart.")


# ── OF-118: a run-in label keeps its separator

def _run_ins(number, slide, note):
    for shape in slide.shapes:
        if not (getattr(shape, "has_text_frame", False) and shape.has_text_frame) or shape.name.startswith(("title@", "lit-notice")):
            continue
        for paragraph in shape.text_frame.paragraphs:
            runs = [r for r in paragraph.runs if r.text]
            if len(runs) < 2 or not runs[0].font.bold or runs[1].font.bold:
                continue
            label, rest = runs[0].text, runs[1].text
            if not label.strip() or not re.search(r"\w", rest) or RUN_IN_SEPARATOR.search(label.strip()) or rest.lstrip()[:1] in ":：":
                continue
            note("OF-118", "HIGH", number, shape.name, f"bold run-in label without a separator: {(label + rest)[:40]}", "separator",
                 "Write the label with its colon (**요약:** …) or let the engine set it; never run a bold label into the sentence.")


# ── the deck review ────────────────────────────────────────────────────────

def _kind_of(family):
    for kind in ("cover", "section", "closing"):
        if family == kind or family.startswith(kind + "-"):
            return kind
    return "content"


def _treatments_allowed(variance):
    return 2 if variance <= 3 else 3 if variance == 4 else 4 if variance <= 6 else 5


def _label_findings(prs, note):
    titled = [(number, shape) for number, slide in enumerate(prs.slides, start=1) for shape in slide.shapes
              if shape.name.startswith(("title@", "subtitle@")) and getattr(shape, "has_text_frame", False) and shape.has_text_frame]
    legacy = any(shape.name == "title@legacy" for _, shape in titled)
    for number, shape in titled:
        text = re.sub(r"\s+", " ", shape.text_frame.text).strip()
        if is_claim(text):
            what = "subtitle" if shape.name.startswith("subtitle@") else "title"
            note("OF-114", "MEDIUM" if legacy else "HIGH", number, shape.name, f"{what} reads as a sentence: {text[:60]}", "label",
                 "Turn it into a label for the topic (분기별 매출 추이; Conversion by feed rate) and put the claim in the body.")


def review(prs):
    """OF-110..OF-115 and OF-117..OF-119 over one deck. Returns finding dicts in craft_extras' shape plus a fix `hint`."""
    found = []

    def note(rule, severity, slide, shape, value, threshold, hint):
        found.append({"rule": rule, "severity": severity, "slide": slide, "shape": shape or "", "value": value,
                      "threshold": threshold, "tier": "derived", "hint": hint})

    W, H = prs.slide_width / 12700.0, prs.slide_height / 12700.0
    stamp = STAMP.search(prs.core_properties.subject or "")
    density, variance = (int(stamp.group(2)), int(stamp.group(4))) if stamp else (5, 5)
    margin = SIDE_MARGIN[960 if round(W) == 960 else 720].get(stamp.group(3) if stamp else "standard", 48.0)
    pages = []
    for number, slide in enumerate(prs.slides, start=1):
        marks = read_marks(slide, W, H)
        family = next((s.name.split("@", 1)[1] for s in slide.shapes if s.name.startswith("family@")), "")
        title = next((m for m in marks if m["name"].startswith("title@")), None)
        pages.append({"n": number, "marks": marks, "family": family, "kind": _kind_of(family), "title": title,
                      "named": title["name"].split("@", 1)[1] if title else None})
    if not any(p["named"] for p in pages):
        return found  # not drawn by the pack engine
    legacy = any(p["named"] == "legacy" for p in pages)
    variety = "MEDIUM" if legacy else "HIGH"

    for p in pages:
        p["shown"] = title_treatment(p["title"], p["marks"], W, H) if p["title"] and p["title"]["sizes"] else None
        if p["named"] in TREATMENTS and p["shown"] not in (None, p["named"]):
            note("OF-110", "HIGH", p["n"], p["title"]["name"], f"drawn as {p['shown']}", p["named"],
                 "Draw the title with its treatment's own frame and companions; the name must match the page.")
    # Covers and sections carry their own variants, so only the other titled slides count toward variety.
    titled = [p for p in pages if p["kind"] not in ("cover", "section") and p["shown"]]
    used = sorted({p["shown"] for p in titled} - {"unclassified"})
    if len(pages) >= MIN_SLIDES:
        if len(used) < MIN_TREATMENTS:
            severity = "MEDIUM" if variance <= 3 else variety
            note("OF-110", severity, None, None, f"{len(used)} treatment(s): {', '.join(used) or 'none'}", MIN_TREATMENTS,
                 "Give each slide role its treatment from the pack: data beside a rail or over a bottom title, steps under a numeral."
                 if severity == "HIGH" else "Variance under 4 only on the user's word; say so in the reply.")
        elif stamp and len(used) > _treatments_allowed(variance):
            note("OF-110", variety, None, None, f"{len(used)} treatments", _treatments_allowed(variance),
                 "Use fewer treatments or raise variance (at most 2 steps without asking).")
    stray = [p["n"] for p in titled if p["shown"] == "unclassified"]
    if stray:
        note("OF-110", variety, stray[0], None, f"no treatment on slide(s) {', '.join(map(str, stray))}", "one of eight",
             "Set the title on one of the eight treatment frames; never place a title by hand.")

    content = [p for p in pages if p["kind"] == "content"]
    if len(content) >= 3:
        for p in content:
            p["sig"] = signature(p["title"], p["shown"], p["marks"], W, H, margin)
        need = min(VARIETY_CAP, -(-len(content) * 3 // 5))
        problems = []
        for label, key in (("signature", lambda p: p["sig"]), ("layout", lambda p: p["sig"][:2])):
            tally = {}
            for p in content:
                tally[key(p)] = tally.get(key(p), 0) + 1
            top, top_n = max(tally.items(), key=lambda item: item[1])
            if len(tally) < need:
                problems.append(f"{label}: {len(tally)} distinct of {need}")
            if top_n / len(content) > MAX_SHARE:
                problems.append(f"{label}: {'/'.join(top)} on {top_n} of {len(content)}")
        if problems:
            note("OF-111", variety, None, None, "; ".join(problems), f">= {need} distinct, <= 40 %",
                 "Change the family or the title treatment on the repeated slides so each job takes its own shape.")

    cap = next(limit for upto, limit in BAND_CAP if density <= upto)
    bands = []
    for p in pages:
        if p["kind"] in ("cover", "section") or p["family"] in ("statement", "quote", "closing-statement") or p["shown"] == "statement":
            continue
        band = empty_band(p["title"], p["marks"])
        if band is None:
            continue
        bands.append(band)
        if band > cap:
            note("OF-112", "MEDIUM", p["n"], None, round(band, 3), cap,
                 "Follow the pack's fill order: a larger visual, wider gaps, the next supporting fact, or a better-fitting family.")
    if bands:
        bands.sort()
        mid = len(bands) // 2
        median = bands[mid] if len(bands) % 2 else (bands[mid - 1] + bands[mid]) / 2
        if median > DECK_BAND_MAX:
            note("OF-112", variety, None, None, round(median, 3), DECK_BAND_MAX,
                 "Let content reach the floor: a takeaway under the table, the next step under the ask, the basis under a figure.")

    frames = {}
    for p in titled:
        if p["shown"] in TREATMENTS and p["named"] in TREATMENTS:
            frames.setdefault(p["shown"], []).append(p)
    edge = lambda t, k: t["y"] + t["h"] if k == "bottom" else t[k]  # noqa: E731
    for treatment, group in frames.items():
        keys = ("x", "w") if treatment == "statement" else ("x", "w", "bottom") if treatment == "bottom-anchor" else ("x", "y", "w")
        usual = {}
        for k in keys:
            values = [round(edge(p["title"], k)) for p in group]
            usual[k] = max(set(values), key=values.count)
        for p in group:
            off = [f"{k} {edge(p['title'], k):.0f}" for k in keys if abs(edge(p["title"], k) - usual[k]) > ANCHOR_TOL]
            if off:
                note("OF-113", "HIGH", p["n"], p["title"]["name"], ", ".join(off), {k: usual[k] for k in keys},
                     "Keep every slide of one treatment on its frame; fix the source instead of nudging a title.")

    _empty_regions(pages, W, H, note)
    # OF-119: an agenda numbers its own rows, so a numeral beside its title reads as a stray section number.
    for p in pages:
        if p["family"] == "agenda" and p["shown"] == "kicker-numeral":
            note("OF-119", "HIGH", p["n"], p["title"]["name"], "a numeral beside the agenda title repeats the count of its numbered rows",
                 "numbered rows", "Give the agenda a title without a numeral; its rows carry the numbers.")
    for p, slide in zip(pages, prs.slides):
        _light_figures(p["n"], slide, W, H, note)
        _run_ins(p["n"], slide, note)
    _label_findings(prs, note)
    return found
