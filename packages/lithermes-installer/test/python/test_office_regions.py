"""Regions, grounds and language of tonality decks: no region left empty (OF-115), tonality siblings with their
own skeleton (OF-116), no light figure card on a dark ground (OF-117), the accent on the current series, chart
decimals as written, a section preview within 70 % of the page, and Korean runs tagged ko-KR.

Run with the pinned Office runtime Python (the office cache venv); under the bare Hermes interpreter the
python-pptx imports are missing and the class is skipped.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw
    from pptx import Presentation
    from pptx.util import Pt
except ImportError as error:  # the Hermes interpreter has no Office runtime
    Presentation = None
    IMPORT_ERROR = str(error)
else:
    IMPORT_ERROR = ""

ROOT = Path(__file__).resolve().parents[2]
SKILL = Path(os.environ.get("LITHERMES_TEST_SKILLS", ROOT / "assets/lithermes-plugin/skills")) / "lit-pptx"
OFFICE = SKILL / "bin/office.mjs"
sys.path.insert(0, str(SKILL / "scripts"))
ENV = {k: v for k, v in os.environ.items() if k != "TYPESAFE_API_KEY"}
NOTICE = "notice: 예시 데이터 — 실제 수치로 바꿔 주세요"


def _load(name):
    spec = importlib.util.spec_from_file_location(f"regions_{name}", SKILL / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _lines(text):
    return [line.strip() for line in re.split(r"[\n\v]", text) if line.strip()]


def _shapes(path):
    """Every shape of every slide in points, with its text, solid fill and chart flag."""
    out = []
    for slide in Presentation(str(path)).slides:
        page = []
        for shape in slide.shapes:
            try:
                fill = str(shape.fill.fore_color.rgb) if shape.fill.type == 1 else None
            except (AttributeError, TypeError, ValueError):
                fill = None
            page.append({"name": shape.name, "x": shape.left / 12700, "y": shape.top / 12700, "w": shape.width / 12700,
                         "h": shape.height / 12700, "text": shape.text_frame.text if shape.has_text_frame else "",
                         "fill": fill, "chart": bool(getattr(shape, "has_chart", False) and shape.has_chart),
                         "picture": shape.shape_type == 13})
        out.append(page)
    return out


def _parts(path, pattern):
    with zipfile.ZipFile(path) as package:
        names = sorted((n for n in package.namelist() if re.fullmatch(pattern, n)), key=lambda n: int(re.sub(r"\D", "", n) or 0))
        return [package.read(n).decode("utf-8") for n in names]


def _media_hashes(path):
    with zipfile.ZipFile(path) as package:
        return {hashlib.sha256(package.read(n)).hexdigest() for n in package.namelist() if n.startswith("ppt/media/image")}


def _full_canvas(s):
    return s["fill"] and round(s["x"]) == 0 and round(s["y"]) == 0 and round(s["w"]) == 960 and round(s["h"]) == 540


def _picture(path, ground, ink=None, size=(800, 500)):
    image = Image.new("RGB", size, ground)
    if ink:
        draw = ImageDraw.Draw(image)
        for x in (80, 330, 580):
            draw.rectangle([x, 200, x + 150, 300], outline=ink, width=4)
        draw.line([230, 250, 330, 250], fill=ink, width=4)
        draw.line([480, 250, 580, 250], fill=ink, width=4)
    image.save(path)


@unittest.skipIf(Presentation is None, f"python-pptx unavailable: {IMPORT_ERROR}")
class DeckRegionsAndGrounds(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="lithermes-regions-"))
        self.craft = _load("craft_extras")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def deck(self, name, source, *flags):
        path = self.tmp / f"{name}.md"
        path.write_text(source, encoding="utf-8")
        out = self.tmp / f"{name}.pptx"
        run = subprocess.run(["node", str(OFFICE), "pptx", str(path), *flags, "--pptx", str(out)],
                             capture_output=True, text=True, env=ENV, cwd=self.tmp)
        self.assertEqual(run.returncode, 0, run.stderr[-2000:] + run.stdout[-500:])
        return out

    def one(self, name, tonality, body):
        out = self.deck(name, f"---\ntonality: {tonality}\ntitle: 확인\n{NOTICE}\n---\n\n---\n{body}\n---\n")
        return out, _shapes(out)[0]

    def findings(self, path, rule):
        return [f for f in self.craft.check(path)["findings"] if f["rule"] == rule]

    def qa(self, path, *flags):
        run = subprocess.run(["node", str(OFFICE), "qa", str(path), *flags], capture_output=True, text=True, env=ENV, cwd=self.tmp)
        try:
            return json.loads(run.stdout)
        except json.JSONDecodeError:
            self.fail(f"qa printed no report (exit {run.returncode}): {run.stderr[-1500:]}")

    def plant(self, src, out, edit):
        prs = Presentation(str(src))
        edit(prs)
        prs.save(str(out))
        return out

    def test_section_preview_runs_two_lines_an_entry_within_seventy_percent_with_bold_run_in_labels(self):
        source = f"""---
tonality: chalk
title: 설비 보전 입문
{NOTICE}
---

---
layout: text-column

## 3강 학습 목표

- 고장 간격이 무엇을 말하는지 정의한다
---

---
layout: section

# 고장 간격이 말해 주는 것
---

---
layout: text-column

## 평균 고장 간격의 뜻과 읽는 법

- 평균 고장 간격은 한 번 고친 설비가 다음 고장까지 평균 몇 시간 돌았는지 묻는다
- 간격은 언제나 '가동 시간 / 고장 건수'로 읽는다
- 세 번째 줄은 미리보기에 나오지 않는다
---

---
layout: text-column

## 예제: 포장 라인 컨베이어 12대, 6개월

- **결과** 윤활 주기를 바꾼 뒤 평균 고장 간격이 310시간에서 420시간으로 늘었다 (예시)
- **자료:** 컨베이어 12대, 2026년 3-8월 가동 기록, 고장 41건
- **주의** 이 줄도 미리보기에 나오지 않는다
---
"""
        out = self.deck("s", source)
        page = [s for s in _shapes(out)[1] if s["text"] and not s["name"].startswith(("lit-notice", "title@"))]
        previews = [s for s in page if re.search(r"평균 고장 간격은|결과|간격은 언제나", s["text"])]
        self.assertGreaterEqual(len(previews), 2, [s["text"] for s in page])
        for s in previews:
            self.assertLessEqual(s["w"], 0.7 * 960 + 0.5, f"preview {s['w']:.0f} pt wide, over 70 % of the page")
            self.assertGreaterEqual(s["w"], 0.6 * 960, f"preview {s['w']:.0f} pt wide: the wide option keeps most of the cap")
            self.assertLessEqual(len(_lines(s["text"])), 2, s["text"])
        self.assertFalse(any("나오지 않는다" in s["text"] for s in page), "a third line stays out of the preview")
        xml = _parts(out, r"ppt/slides/slide\d+\.xml")[1]
        runs = [(m.group(2), bool(re.search(r'\bb="1"', m.group(1)))) for m in re.finditer(r"<a:r><a:rPr([^>]*)>[\s\S]*?<a:t>([^<]*)</a:t></a:r>", xml)]
        self.assertIn(("결과:", True), runs, "a bold run-in label takes its colon")
        self.assertIn(("자료:", True), runs, "a label with its own colon keeps one")
        self.assertFalse(any("::" in text for text, _ in runs))
        english = """---
tonality: night
title: Line review
---

---
layout: text-column

## Line availability

- Planned availability rose to 96% in the quarter
---

---
layout: section

# Method notes
---

---
layout: references-appendix

## Data sources and definitions

- **Downtime log** export from 1 July to 30 September 2026, every stop over five minutes (sample).
- [2] Q3 2026 maintenance plan targets, approved June 2026 (sample).
- [3] Availability: run time over planned production time in the month.
---
"""
        en = [s for s in _shapes(self.deck("e", english))[1] if re.search(r"Downtime log|plan targets", s["text"])]
        self.assertTrue(en and all(s["w"] <= 70 * 13 * 0.5 + 0.5 for s in en), [(s["w"], s["text"]) for s in en])

    CHART = """::: chart type=column unit="건"
| 월 | 정비 요청 (건) | 재요청 (건) |
|---|---|---|
| 4월 | 62 | 19 |
| 5월 | 79 | 29 |
| 6월 | 94 | 39 |
| 7월 | 118 | 54 |
> 월별 정비 요청과 재요청 (예시 데이터)
:::

- 월 정비 요청은 4월 62건에서 7월 118건으로 늘었다
- 설비를 늘리지 않은 6-7월에도 증가세가 이어졌다
- 출처: 예시 정비팀 작업 기록"""

    def test_bottom_title_stands_on_the_body_floor_and_the_gate_fails_one_floating_above_it(self):
        source = (f"---\ntonality: paper\ntitle: 정비\n{NOTICE}\n---\n\n"
                  f"---\nlayout: chart-insight\ntitle: bottom-anchor\n\n## 월별 정비 요청과 재요청 추이\n\n{self.CHART}\n---\n\n"
                  f"---\nlayout: chart-insight\ntitle: bottom-anchor\n\n## 북부 세 공장의 월별 정비 요청과 재요청 추이, 2026년 4월부터 7월까지 넉 달\n\n{self.CHART}\n---\n")
        out = self.deck("b", source)
        slides = _shapes(out)
        titles = [next(s for s in page if s["name"] == "title@bottom-anchor") for page in slides]
        self.assertEqual([len(_lines(t["text"])) for t in titles], [1, 2])
        for t in titles:
            text_bottom = t["y"] + len(_lines(t["text"])) * 26 * 1.15
            self.assertTrue(text_bottom >= 486 - 12 and t["y"] + t["h"] <= 487, f"title text ends at {text_bottom:.0f}, frame {t['y']:.0f}+{t['h']:.0f}")
        besides = [page for page in slides if any(s["text"] and s["x"] >= next(c for c in page if c["chart"])["x"] + next(c for c in page if c["chart"])["w"] for s in page)]
        self.assertTrue(besides)
        for page in besides:
            chart = next(s for s in page if s["chart"])
            title = next(s for s in page if s["name"] == "title@bottom-anchor")
            self.assertGreaterEqual(chart["y"] + chart["h"], title["y"] - 60, "the chart grows into the room the title left")
        self.assertEqual(self.findings(out, "OF-115"), [])
        self.assertEqual(self.findings(out, "OF-113"), [], "a bottom title is anchored by its bottom edge")

        def lift(prs):
            for shape in prs.slides[0].shapes:
                if shape.top >= Pt(380) and not shape.name.startswith("lit-notice"):
                    shape.top = shape.top - Pt(54)
        up = self.plant(out, self.tmp / "up.pptx", lift)
        self.assertTrue(any(f["slide"] == 1 and f["severity"] == "HIGH" and "bottom title" in str(f["value"]) for f in self.findings(up, "OF-115")),
                        self.findings(up, "OF-115"))

    def test_side_rail_carries_criteria_takeaways_and_source_and_the_gate_fails_an_empty_rail(self):
        out, shapes = self.one("c", "ledger", """layout: comparison
title: side-rail

## 외주 정비와 내부 정비 비교

:::: columns 1fr 1fr
::: col
- **외주**
  (1) 비용: 건당 42만 원, 연 1,200건이면 5.0억 원
  (2) 대기: 신고부터 착수까지 평균 2.1일
  (3) 야간: 협력사 당직이 없어 다음 날 아침 착수
  (4) 품질: 재작업률 4.8%, 협력사 자체 점검 기준
:::
::: col
- **내부**
  (1) 비용: 인력 3명 추가로 연 4.4억 원, 0.6억 원 적다
  (2) 대기: 상주 인력이라 평균 0.5일에 착수한다
  (3) 야간: 2교대 편성으로 당일 밤에 착수한다
  (4) 품질: 재작업률 2.1%, 정비 기록과 점검표로 관리
:::
::::

- 출처: 예시 정비팀 2026년 상반기 작업 기록, 협력사 정산 자료
- 주: 비용은 2026년 단가 기준""")
        title = next(s for s in shapes if s["name"] == "title@side-rail")
        title_bottom = title["y"] + len(_lines(title["text"])) * 26 * 1.15
        for label in ("비용", "대기", "야간", "품질"):
            s = next((x for x in shapes if x["text"] == label), None)
            self.assertTrue(s and s["x"] + s["w"] <= 336.5 and s["y"] >= title_bottom, f"{label} in the rail under the title: {s}")
        strip = next(s for s in shapes if s["text"].startswith("출처:"))
        self.assertTrue(strip["x"] + strip["w"] <= 336.5 and strip["y"] + strip["h"] >= 440, f"source at the rail's foot: {strip}")
        self.assertTrue(all(s["x"] >= 335.5 for s in shapes if "만 원" in s["text"] or "평균" in s["text"]), "the sides keep the body")
        self.assertEqual(self.findings(out, "OF-110") + self.findings(out, "OF-115"), [])
        chart, _ = self.one("k", "ledger", """layout: chart-insight
title: side-rail

## 주차별 미처리 정비 요청, 계획 대비 실적

::: chart type=column unit="건"
| 주차 | 실적 (건) | 계획 (건) |
|---|---|---|
| 8월 3주 | 492 | 470 |
| 8월 4주 | 450 | 425 |
| 9월 1주 | 410 | 380 |
| 9월 2주 | 371 | 335 |
| 9월 3주 | 335 | 290 |
| 9월 4주 | 296 | 245 |
> 주차별 미처리 정비 요청, 실적과 계획 (예시 데이터)
:::

- 9월 미처리 요청은 주당 평균 28.5건씩 줄었다 (410 → 296건, 4주)
- 이 속도면 약 10주 뒤인 12월 첫째 주에 미처리 요청이 0이 된다
- 계획과의 차이는 8월 3주 22건에서 9월 4주 51건으로 커졌다
- 계획 완료 시점(11월 첫째 주, 6주 뒤)에 맞추려면 주당 약 49건씩 줄여야 한다
- 출처: 예시 정비 관리 시스템 주간 집계""")
        cshapes = _shapes(chart)[0]
        takeaways = [s for s in cshapes if re.search(r"주당 평균|10주 뒤|차이는|6주 뒤", s["text"])]
        self.assertEqual(len(takeaways), 4, [s["text"][:16] for s in cshapes])
        self.assertTrue(all(s["x"] + s["w"] <= 336.5 for s in takeaways), "the takeaways stand in the rail")
        plot = next(s for s in cshapes if s["chart"])
        self.assertTrue(plot["x"] >= 335.5 and plot["w"] >= 500, f"the chart takes the body beside the rail: {plot}")
        self.assertEqual(self.findings(chart, "OF-110") + self.findings(chart, "OF-115"), [])
        empty, _ = self.one("e", "studio", """layout: text-column
title: side-rail

## 접이식 정비 작업대

- 하중 시험 300kg 통과 (예시)
- 펼친 상태에서 다리가 자동으로 잠긴다
- 접으면 두께가 14cm로 줄어 벽에 건다
- 공구 서랍 두 칸이 칸당 12kg까지 버틴다""")
        self.assertTrue(any(f["severity"] == "HIGH" and "rail" in str(f["value"]) for f in self.findings(empty, "OF-115")), self.findings(empty, "OF-115"))

    def test_a_slide_whose_rail_would_stay_empty_takes_another_title(self):
        _, shapes = self.one("m", "chalk", """layout: method

## 평균 고장 간격 식과 기호의 뜻

MTBF = T / n

- **MTBF** 평균 고장 간격, 고친 뒤 다음 고장까지의 평균 가동 시간
  (1) 예제: 컨베이어 12대 평균 420시간
- **T** 관찰 기간의 총 가동 시간
  (1) 예제: 2026년 3-8월, 대당 하루 16시간 운전
- **n** 같은 기간의 고장 건수
  (1) 예제: 41건, 정지 5분 이상만 센다
- **λ** 고장률, MTBF의 역수
  (1) 예제 값 0.0024건/시간""")
        title = next(s for s in shapes if s["name"].startswith("title@"))
        self.assertNotEqual(title["name"], "title@side-rail", "the rail would hold the title alone")

    def test_beside_a_chart_the_source_closes_the_takeaway_column(self):
        out, shapes = self.one("c", "ledger", """layout: chart-insight
title: top-rule

## 분기별 정비 비용 실적과 계획 추이

::: chart type=column unit="억 원"
| 분기 | 비용 실적 (억 원) | 비용 계획 (억 원) | 전년 (억 원) | 목표 (억 원) |
|---|---|---|---|---|
| 25년 2Q | 9.2 | 9.0 | 8.5 | 9.1 |
| 25년 3Q | 9.6 | 9.4 | 8.7 | 9.5 |
| 25년 4Q | 10.1 | 9.9 | 9.0 | 10.0 |
| 26년 1Q | 10.7 | 10.4 | 9.2 | 10.5 |
| 26년 2Q | 11.2 | 10.9 | 9.6 | 11.0 |
| 26년 3Q | 11.8 | 11.4 | 10.1 | 11.5 |
> 분기별 정비 비용 실적과 계획 (예시 데이터)
:::

- 정비 비용은 다섯 분기 연속 늘었고 여섯 분기 모두 계획을 넘었다
- 3분기 비용은 전년 같은 분기보다 17% 늘었다
- 출처: 예시 정비 회계 자료(2025년 2분기-2026년 3분기), 연간 정비 계획
- 주: 계획은 각 연도 1월에 확정한 분기 예산""")
        plot = next(s for s in shapes if s["chart"])
        strip = next(s for s in shapes if s["text"].startswith("출처:"))
        points = [s for s in shapes if re.match(r"^(정비 비용은 다섯|3분기 비용은)", s["text"])]
        if all(s["x"] >= plot["x"] + plot["w"] - 0.5 for s in points):
            self.assertGreaterEqual(strip["x"], plot["x"] + plot["w"] - 0.5, f"the strip stands in the takeaway column: {plot} {strip}")
            self.assertGreaterEqual(plot["y"] + plot["h"], 440, "the chart runs down to the floor")
        else:
            # Two short points cannot fill a column beside the chart: they run under it and the strip across the foot.
            self.assertTrue(all(s["y"] >= plot["y"] + plot["h"] - 0.5 for s in points) and plot["w"] >= 0.9 * 912, (plot, points))
        self.assertGreaterEqual(strip["y"] + strip["h"], 470, "the strip stands on the floor")
        self.assertEqual(self.findings(out, "OF-115"), [])

    def test_compact_process_rows_reach_across_and_a_closing_summary_sets_its_source_as_the_strip(self):
        out, shapes = self.one("p", "chalk", """layout: process
title: top-rule

## 고장 분석 4단계 절차와 점검 항목

- **1. 기록하기** 정지 시각과 증상을 작업 기록에 먼저 남긴다
  (1) 도구 정비 관리 시스템 · 약 5분
  (2) 확인 정지 5분 이상인지 · 예제 41건
- **2. 묶기** 같은 원인끼리 고장을 묶어 건수를 센다
  (1) 도구 스프레드시트 피벗 · 약 10분
  (2) 결과 윤활 17건, 센서 11건 · 상위 두 원인이 68%
- **3. 읽기** 원인별 평균 고장 간격을 단위와 함께 해석한다
  (1) 윤활 MTBF 290시간 · 전체 평균 420시간
  (2) 관찰 기간 6개월 안에서만 읽기 · 계절 차이 주의
- **4. 점검하기** 대책 뒤 같은 기간을 다시 재어 비교한다
  (1) 도구 전후 비교표 · 약 10분
  (2) 윤활 고장 17건 → 6건 · 다른 원인 변화 없음
- 출처: 예제 자료 컨베이어 12대, 표 2 (예시)""")
        rests = [s for s in shapes if re.match(r"^(정지 시각과|같은 원인끼리|원인별 평균|대책 뒤)", s["text"])]
        self.assertEqual(len(rests), 4, [s["text"][:12] for s in shapes])
        for r in rests:
            self.assertGreaterEqual(r["x"] + r["w"], 24 + 912 * 0.75, f"what happens reaches across: {r['x'] + r['w']:.0f}")
        self.assertEqual(self.findings(out, "OF-115"), [])
        _, close = self.one("s", "chalk", """layout: closing-summary-list

## 이번 주 정리와 과제

- 정지 5분 미만은 고장 건수에 넣지 않는다
- 원인별 간격을 전체 평균보다 먼저 읽는다
- 과제: 포장 라인 기록으로 원인별 MTBF 표를 목요일까지 낸다
- 출처: 예시 설비 보전 실습 자료, 2026 (예시)""")
        source = next((s for s in close if s["text"].startswith("출처:")), None)
        self.assertIsNotNone(source, [s["text"][:12] for s in close])
        before = close[close.index(source) - 1]["text"] if close.index(source) else ""
        self.assertFalse(re.fullmatch(r"\d+", before), "the source is not a numbered summary row")
        self.assertLessEqual(source["h"], 24, f"the source is set as the strip: {source}")

    def test_title_panel_over_a_picture_hugs_its_text_and_atlas_sets_a_quote_on_the_whole_field(self):
        (self.tmp / "assets").mkdir()
        _picture(self.tmp / "assets" / "a.png", (170, 180, 190), size=(960, 540))
        source = f"""---
tonality: atlas
title: 접이식 정비 작업대
date: 2026-10-02
department: 예시 설비 디자인팀
presenter: 예시 디자이너
notice: 예시 이미지 데이터 — 실제 자료로 바꿔 주세요
---

---
layout: cover-full-image

# 소형 정비실용 접이식 작업대·벽 공구함
---

---
layout: image-full

## 작업대를 펼친 상태

![도 1. 작업대를 펼친 모습 | 출처: 예시 이미지](assets/a.png)
---

---
layout: quote

## 시범 현장 후기

“야간에는 작업대, 낮에는 지게차가 지나갈 통로가 생겼어요.”

— 예시 정비사 인터뷰, 소형 정비실(18m²) 근무, 사용 2개월 차
---
"""
        out = self.deck("a", source)
        slides = _shapes(out)
        title = next(s for s in slides[0] if s["name"] == "title@cover")
        panel = next((s for s in slides[0] if s["fill"] and s["y"] <= title["y"] and s["y"] + s["h"] >= title["y"] + title["h"] and s["w"] < 960), None)
        self.assertIsNotNone(panel, [(s["name"], s["fill"], s["y"], s["h"]) for s in slides[0]])
        self.assertGreaterEqual(panel["y"] + panel["h"], 539.5, "the panel bleeds off the foot")
        self.assertLessEqual(title["y"] - panel["y"], 36, "the panel starts just above the title")
        self.assertTrue(any(_full_canvas(s) for s in slides[2]), "the quote stands on the whole-page field")
        self.assertEqual(self.findings(out, "OF-115"), [])

        def plate(prs):
            slide = prs.slides[2]
            field = next(x for x in slide.shapes if x.left == 0 and x.top == 0 and x.width == prs.slide_width)
            field.top, field.height = Pt(300), Pt(240)
            next(x for x in slide.shapes if x.name.startswith("title@")).top = Pt(330)
        planted = self.plant(out, self.tmp / "plate.pptx", plate)
        self.assertTrue(any(f["slide"] == 3 and re.search(r"open page|plate", str(f["value"])) for f in self.findings(planted, "OF-115")),
                        self.findings(planted, "OF-115"))

    LECTURE = f"""---
title: 설비 보전 입문 4강
subtitle: 고장 기록에서 보전 주기까지
date: 2026-10-02
department: 예시 기술교육원
presenter: 예시 강사
{NOTICE}
---

---
layout: cover-typographic

# 설비 보전 입문 4강
---

---
layout: agenda

## 오늘 다루는 내용

1. 고장 기록 읽기
2. 평균 고장 간격 구하기
3. 원인별로 나눠 보기
4. 보전 주기 정하기
---

---
layout: text-column

## 4강 학습 목표

- 고장 기록에서 평균 고장 간격(MTBF)을 구한다
- 원인별 간격을 전체 평균과 비교해 읽는다
- 간격으로 예방 보전 주기를 정하는 방법을 안다
- 출처: 예시 기술교육원 설비 보전 과정 강의 계획서
---

---
layout: kpi-row

## 예제 자료 한눈에 보기

| 설비 | 관찰 기간 | 고장 | 평균 고장 간격 |
|---|---|---|---|
| 컨베이어 12대 | 6개월 | 41건 | 420시간 |
| 3월-8월 | 대당 하루 16시간 | 정지 5분 이상 | 전년 310시간 |

- 윤활 주기를 바꾼 뒤 간격이 110시간 늘었다
- 출처: 예시 포장 라인 정비 기록
---

---
layout: method

## 평균 고장 간격 식과 기호의 뜻

MTBF = T / n

- **MTBF** 평균 고장 간격, 고친 뒤 다음 고장까지의 평균 가동 시간
  (1) 예제: 컨베이어 12대 평균 420시간
- **T** 관찰 기간의 총 가동 시간
  (1) 예제: 2026년 3-8월, 대당 하루 16시간 운전
- **n** 같은 기간의 고장 건수
  (1) 예제: 41건, 정지 5분 이상만 센다
---

---
layout: chart-insight

## 원인별 고장 건수와 평균 고장 간격

| 원인 | 고장 (건) | 간격 (시간) |
|---|---|---|
| 윤활 부족 | 17 | 290 |
| 센서 오염 | 11 | 450 |
| 벨트 마모 | 8 | 610 |
| 기타 | 5 | 980 |

> 원인별 고장 건수와 평균 간격 (예시 데이터)

- 윤활 부족이 고장의 41%를 차지하고 간격도 가장 짧다
- 상위 두 원인이 전체 고장의 68%다
- 출처: 예시 포장 라인 정비 기록, 2026년 3-8월
---

---
layout: image-split

## 윤활 지점 점검 장면

![그림 1. 컨베이어 구동부 윤활 지점 | 출처: 예시 이미지](assets/sample-image-b.png)

- 구동부 베어링 네 곳이 윤활 부족 고장의 대부분이다
- 주입구가 덮개 안쪽에 있어 점검에서 빠지기 쉽다
- 점검표에 주입구 위치 사진을 붙였다
- 출처: 예시 현장 점검 사진, 2026년 8월
---

---
layout: process

## 보전 주기를 정하는 4단계

- **1. 간격 구하기** 원인별 MTBF를 기록에서 구한다
- **2. 여유 두기** 가장 짧은 간격의 70%를 첫 주기로 둔다
- **3. 시험 운영** 한 달 동안 그 주기로 보전하고 고장을 센다
- **4. 고치기** 고장이 남으면 주기를 줄이고, 없으면 늘린다
- 출처: 예시 기술교육원 실습 지침
---

---
layout: comparison

## 사후 보전과 예방 보전 비교

:::: columns 1fr 1fr
::: col
- **사후 보전**
  (1) 시점: 고장 난 뒤에 고친다, 야간 고장은 다음 날 아침에 착수
  (2) 정지: 한 번에 평균 3.2시간 선다, 라인 전체가 함께 멈춘다
  (3) 부품: 그때 주문해 평균 1.5일 기다린다
  (4) 비용: 건당 42만 원, 연 120건이면 5,040만 원
:::
::: col
- **예방 보전**
  (1) 시점: 정해진 주기에 고친다, 교대 사이 30분에 맞춘다
  (2) 정지: 한 번에 평균 0.8시간 선다, 해당 설비만 멈춘다
  (3) 부품: 미리 준비해 기다리지 않는다
  (4) 비용: 주기당 9만 원, 연 400회면 3,600만 원
:::
::::
---

---
layout: closing-summary-list

## 이번 주 정리와 과제

- 정지 5분 미만은 고장 건수에 넣지 않는다
- 원인별 간격을 전체 평균보다 먼저 읽는다
- 과제: 포장 라인 기록으로 원인별 MTBF 표를 목요일까지 낸다
- 출처: 예시 설비 보전 실습 자료, 2026 (예시)
---
"""

    def test_two_tonalities_of_one_source_never_draw_the_same_skeleton(self):
        (self.tmp / "assets").mkdir()
        _picture(self.tmp / "assets" / "sample-image-b.png", (200, 205, 212), size=(800, 600))
        chalk = self.deck("chalk", self.LECTURE, "--tonality", "chalk")
        paper = self.deck("paper", self.LECTURE, "--tonality", "paper")
        pair = self.qa(paper, "--sibling", str(chalk))
        self.assertEqual([f for f in pair["office_craft"]["findings"] if f["rule"] == "OF-116"], [])
        same = self.qa(paper, "--sibling", str(paper))
        hit = [f for f in same["office_craft"]["findings"] if f["rule"] == "OF-116"]
        self.assertTrue(len(hit) == 1 and hit[0]["severity"] == "HIGH" and re.search(r"0 of \d+ content slides", str(hit[0]["value"])), hit)
        self.assertFalse(same["pass"])
        # Chalk draws a comparison with its own structure: the criteria on the board rail.
        comparison = next(page for page in _shapes(chalk) if any("사후보전과예방보전" in re.sub(r"\s+", "", s["text"]) for s in page))
        self.assertIn("title@side-rail", [s["name"] for s in comparison])
        # One differing slide is not enough once a deck has four content slides; two are.
        output = _load("deck_output")
        a = [("top", "one")] * 6
        frames = iter([a, [("side", "one")] + a[1:], a, [("side", "one"), ("side", "grid")] + a[2:]])
        output.skeleton = lambda prs: next(frames)
        self.assertEqual((len(output.compare_skeletons(None, None, "x")), len(output.compare_skeletons(None, None, "x"))), (1, 0))

    FIGURE = """layout: figure-academic

## Three-stage lubrication layout

![Figure 2. Lubrication points used in all runs | Source: synthetic sample diagram](assets/flow.png)

- Grease split into three equal points along the drive
- Points at 0, 1/3 and 2/3 of the belt length
- Source: Figure 2, layout used in all 36 runs (sample)"""

    def test_a_dark_tonality_draws_the_dark_variant_and_the_gate_fails_a_light_figure_card(self):
        (self.tmp / "assets").mkdir()
        _picture(self.tmp / "assets" / "flow.png", (255, 255, 255), (40, 40, 40))
        light, _ = self.one("light", "night", self.FIGURE)
        self.assertTrue(any(f["severity"] == "HIGH" and f["slide"] == 1 for f in self.findings(light, "OF-117")), self.findings(light, "OF-117"))
        _picture(self.tmp / "assets" / "flow.dark.png", (15, 20, 25), (230, 236, 242))
        dark, _ = self.one("dark", "night", self.FIGURE)
        digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()  # noqa: E731
        self.assertIn(digest(self.tmp / "assets" / "flow.dark.png"), _media_hashes(dark), "the dark variant is the picture drawn")
        self.assertEqual(self.findings(dark, "OF-117"), [])
        paper, _ = self.one("paper", "paper", self.FIGURE)
        self.assertIn(digest(self.tmp / "assets" / "flow.png"), _media_hashes(paper), "a light tonality keeps the figure as written")

    def test_a_chart_puts_the_accent_on_its_current_or_measured_series(self):
        def colours(name, tonality, head):
            out, _ = self.one(name, tonality, f"""layout: chart-insight

## Monthly repairs

| Month | {head[0]} | {head[1]} |
|---|---|---|
| Apr | 3,120 | 2,610 |
| May | 3,340 | 2,700 |
| Jun | 3,410 | 2,820 |
| Jul | 3,780 | 3,050 |

> Monthly repairs (sample data)

- Every month beat the comparison.""")
            xml = _parts(out, r"ppt/charts/chart\d+\.xml")[0]
            return [(re.search(r'<c:spPr>[\s\S]*?<a:srgbClr val="([0-9A-F]{6})"', ser) or [None, None])[1] for ser in xml.split("<c:ser>")[1:]]
        self.assertEqual(colours("y", "night", ["2026", "2025"])[0], "E3A857", "2026 is the current year")
        self.assertEqual(colours("q", "night", ["Q3 repairs (count)", "Q2 repairs (count)"])[0], "E3A857", "Q3 is the current quarter")
        self.assertEqual(colours("q2", "night", ["Q2 backlog (%)", "Q3 backlog (%)"])[1], "E3A857")
        self.assertEqual(colours("p", "ledger", ["실적 (건)", "계획 (건)"])[0], "0E6B5A", "the measured series over its plan")
        self.assertEqual(colours("s", "paper", ["Single shift (%)", "Two shifts (%)"])[1], "8C1C2B", "else the last series")

    def test_chart_data_labels_keep_the_decimals_the_table_writes(self):
        out, _ = self.one("d", "signal", """layout: chart-insight

## 월별 정비 요청과 재요청 추이

| 월 | 정비 요청 (백 건) | 재요청 (백 건) |
|---|---|---|
| 7월 | 11.8 | 5.4 |
| 8월 | 14.6 | 7.3 |
| 9월 | 18.0 | 9.7 |

> 월별 정비 요청과 재요청 (예시 데이터)

- 9월 정비 요청은 1,800건이다""")
        self.assertRegex(_parts(out, r"ppt/charts/chart\d+\.xml")[0], r'<c:dLbls>[\s\S]*?<c:numFmt formatCode="#,##0\.0"')
        whole, _ = self.one("w", "signal", """layout: chart-insight

## 연간 정비 건수

| 연도 | 정비 건수 |
|---|---|
| 2024 | 3,520 |
| 2025 | 3,980 |
| 2026 | 4,420 |

> 연간 정비 건수 (예시 데이터)

- 2026년 정비 건수는 전년보다 11% 늘었다""")
        self.assertRegex(_parts(whole, r"ppt/charts/chart\d+\.xml")[0], r'<c:dLbls>[\s\S]*?<c:numFmt formatCode="#,##0"')

    def test_korean_runs_carry_ko_kr_in_tonality_and_legacy_decks(self):
        out, _ = self.one("k", "ledger", """layout: chart-insight

## 주 2회 점검, 3분기 정비 추이

| 월 | 정비 (백 건) |
|---|---|
| 7월 | 11.8 |
| 8월 | 14.6 |
| 9월 | 18.0 |

> 월별 정비 (예시)

- 9월 정비는 Q3 최고치다 (예시)
- Q3 2026""")
        pattern = r"<a:rPr([^>]*)>[\s\S]*?<a:t>([^<]*)</a:t>"
        runs = [(m.group(2), (re.search(r'\blang="([^"]+)"', m.group(1)) or [None, None])[1], (re.search(r'\baltLang="([^"]+)"', m.group(1)) or [None, None])[1])
                for xml in _parts(out, r"ppt/slides/slide\d+\.xml") for m in re.finditer(pattern, xml)]
        korean = [r for r in runs if re.search(r"[가-힣]", r[0])]
        self.assertTrue(len(korean) > 3 and all(lang == "ko-KR" and alt == "en-US" for _, lang, alt in korean), [r for r in korean if r[1] != "ko-KR"])
        self.assertIn(("Q3 2026", "en-US", None), [(t, lang, alt) for t, lang, alt in runs if t == "Q3 2026"] or [None])
        self.assertIn('<c:lang val="ko-KR"/>', _parts(out, r"ppt/charts/chart\d+\.xml")[0], "a chart with Korean labels is a Korean chart")
        legacy = self.deck("legacy", "---\ntitle: 정비 부문 점검\n---\n\n---\nlayout: cover-typographic\n\n# 정비 부문 점검\n---\n\n---\nlayout: content\n\n## 설비군별 고장 건수\n\n- 컨베이어 고장이 석 달 연속 줄었다\n- 냉각기는 8월에만 늘었다\n---\n", "--template", "AZURE-PRO")
        lruns = [m.group(2) for xml in _parts(legacy, r"ppt/slides/slide\d+\.xml") for m in re.finditer(pattern, xml) if re.search(r"[가-힣]", m.group(2)) and 'lang="ko-KR"' not in m.group(1)]
        self.assertEqual(lruns, [], "every Korean run of a legacy deck is tagged too")

    # ── fix round 3: columns filled by layout, run-in labels, agenda numerals, one colour per series ──

    @staticmethod
    def _column_gap(blocks, top, reach):
        """The largest empty band in a block list from `top` down to `reach`, as a share of the body down to the floor."""
        gap, cursor = 0.0, top
        for b in sorted(blocks, key=lambda b: b["y"]):
            gap, cursor = max(gap, b["y"] - cursor), max(cursor, b["y"] + b["h"])
        return max(gap, reach - cursor) / (486 - top)

    def _runs(self, path, index=0):
        xml = _parts(path, r"ppt/slides/slide\d+\.xml")[index]
        return [(m.group(2), bool(re.search(r'\bb="1"', m.group(1)))) for m in re.finditer(r"<a:r><a:rPr([^>]*)>[\s\S]*?<a:t>([^<]*)</a:t></a:r>", xml)]

    def test_short_takeaways_beside_a_chart_figure_rows_or_a_picture_fill_their_column_and_the_gate_fails_one_that_stops_short(self):
        chart, shapes = self.one("c", "studio", """layout: chart-insight
title: top-plain-large

## 정비 거점 세 곳의 누적 처리 건수

::: chart type=column unit="백 건"
| 거점 | 1개월 (백 건) | 3개월 (백 건) | 6개월 (백 건) |
|---|---|---|---|
| 2024년 북부 시범 거점 | 1.2 | 3.9 | 8.1 |
| 2025년 중앙 상설 거점 | 1.6 | 4.8 | 9.6 |
| 2026년 남부 임시 거점 | 0.9 | 2.7 | 5.4 |
> 거점별 누적 정비 처리 건수 (예시 데이터)
:::

- 중앙 거점이 6개월 동안 가장 많이 처리했다, 960건
- 남부 목표는 6개월 600건
- 출처: 예시 정비 관리 시스템 집계(2026년 4-9월)""")
        plot = next(s for s in shapes if s["chart"])
        points = [s for s in shapes if re.match(r"^(중앙 거점이|남부 목표는)", s["text"])]
        beside = [s for s in points if s["x"] >= plot["x"] + plot["w"] - 1]
        if beside:
            top = min([plot["y"]] + [s["y"] for s in beside])
            self.assertLessEqual(self._column_gap(beside, top, min(486, plot["y"] + plot["h"])), 0.4, beside)
        else:
            # Two short points cannot fill even a narrow column: they run under the chart, side by side.
            self.assertTrue(len(points) == 2 and all(s["y"] >= plot["y"] + plot["h"] - 1 for s in points) and points[0]["x"] != points[1]["x"], points)
            self.assertGreaterEqual(plot["w"], 0.9 * 912, "the chart takes the body's width")
        self.assertEqual(self.findings(chart, "OF-115"), [])
        rows, _ = self.one("k", "signal", """layout: kpi-row
title: bottom-anchor

## 정비 거점 6개월 운영 지표

| 월 처리 | 재정비 비율 | 평균 처리 시간 | 월 부품비 | 상주 인력 |
|---|---|---|---|---|
| 410건 | 6% | 2.4일 | 1,280만 원 | 9명 |
| 4월 160건 | 4월 14% | 목표 2.5일 | 4월 520만 원 | 4월 6명 |

> 2026년 9월 기준, 정비 관리 시스템 (예시)

- 6개월 만에 재정비 비율이 절반 아래로 내려갔다 (14% → 6%)
- 처리 건수는 인력 증가보다 빠르게 늘었다
- 평균 처리 시간은 목표 2.5일보다 짧다
- 출처: 예시 정비 관리 시스템, 2026년 4-9월""")
        self.assertEqual(self.findings(rows, "OF-115"), [], "the takeaways beside the figure rows share the column")
        _picture(self.tmp / "wide.png", (220, 224, 230), (150, 156, 166))
        pic, pshapes = self.one("p", "signal", """layout: image-split
title: bottom-anchor

## 정비 거점 작업대 배치

![도 1. 북부 거점 작업대 | 출처: 예시 이미지](wide.png)

- 작업대 네 대가 한 줄로 서서 이동 거리가 하루 1.8km 줄었다
- 공구 벽은 작업대마다 따로 두어 대기 시간이 12분 줄었다
- 부품 선반은 입구 쪽에 두어 입고와 출고가 겹치지 않는다
- 야간에는 작업대 두 대만 켜서 전력 사용이 31% 줄었다
- 출처: 예시 북부 거점 동선 조사, 2026년 8월""")
        image = next((s for s in pshapes if s["picture"]), None)
        self.assertTrue(image and image["w"] >= 0.55 * 912, f"the picture takes more than half the body: {image}")
        self.assertEqual(self.findings(pic, "OF-115"), [])

        def short(prs):
            k = 0
            for shape in prs.slides[0].shapes:
                if shape.has_text_frame and shape.text_frame.text.startswith(("작업대 네 대가", "공구 벽은", "부품 선반은", "야간에는")):
                    shape.top, shape.height = Pt(40 + 20 * k), Pt(18)
                    k += 1
        planted = self.plant(pic, self.tmp / "short.pptx", short)
        self.assertTrue(any("column beside a longer one" in str(f["value"]) for f in self.findings(planted, "OF-115")), self.findings(planted, "OF-115"))

    def test_takeaways_that_close_with_the_chart_values_fill_their_column_and_the_gate_reads_that_table(self):
        out, shapes = self.one("v", "studio", """layout: asymmetric-feature

## Repairs by line, Q3

::: chart type=bar unit="repairs"
| Line | Repairs |
|---|---|
| Conveyor | 4,820 |
| Press | 3,610 |
| Pump | 2,140 |
| Fan | 1,930 |
> Repairs by line (example data)
:::

- **Lead** Conveyor, 39% of repairs
- **Plan** Pumps move to the weekly round
- Source: Example maintenance log""")
        plot = next(s for s in shapes if s["chart"])
        beside = [s for s in shapes if s["x"] >= plot["x"] + plot["w"] - 1 and s["w"] > 20]
        if all(s["x"] >= plot["x"] + plot["w"] - 1 for s in shapes if re.match(r"^(Lead|Plan):", s["text"])):
            top = min([plot["y"]] + [s["y"] for s in beside])
            self.assertLessEqual(self._column_gap(beside, top, min(486, plot["y"] + plot["h"])), 0.4, beside)
        self.assertEqual(self.findings(out, "OF-115"), [])

        def hole(prs):  # the table straight under the two points, the source on the floor
            for sh in prs.slides[0].shapes:
                t = sh.text_frame.text if sh.has_text_frame else ""
                if getattr(sh, "has_chart", False) and sh.has_chart:
                    sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(108), Pt(366), Pt(358)
                elif t.startswith("Figure 1."):
                    sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(472), Pt(366), Pt(14)
                elif t.startswith(("Lead:", "Plan:")):
                    sh.left, sh.top, sh.width, sh.height = Pt(434), Pt(108 if t.startswith("Lead:") else 136), Pt(502), Pt(22)
                elif t.startswith("Source:"):
                    sh.left, sh.top, sh.width, sh.height = Pt(414), Pt(474), Pt(522), Pt(12)
                elif getattr(sh, "has_table", False) and sh.has_table:
                    sh.left, sh.top, sh.width = Pt(414), Pt(177), Pt(522)
                    for row in sh.table.rows:
                        row.height = Pt(140 / len(sh.table.rows))
                    sh.height = Pt(140)
                elif sh.width < Pt(8) and sh.height < Pt(8):
                    sh.left = Pt(414)
        planted = self.plant(out, self.tmp / "hole.pptx", hole)
        self.assertTrue(any("column beside a longer one" in str(f["value"]) for f in self.findings(planted, "OF-115")), self.findings(planted, "OF-115"))

    def test_a_short_sidebar_note_stands_across_the_top_and_the_main_points_run_in_two_columns(self):
        out, shapes = self.one("n", "chalk", """layout: sidebar-note
title: top-rule

## Four common lubrication mistakes

- **Greasing on the calendar alone**
  (1) A bearing run at double speed needs grease twice as often
  (2) The interval says nothing about load or dust at the point
- **Mixing grease types**
  (1) Lithium and polyurea greases soften each other in the housing
  (2) Here, a mixed bearing ran 40% shorter before the next stop
- **Filling the housing to the top**
  (1) Excess grease churns and heats the bearing within the hour
  (2) Fill a third to a half of the free space, then run it in
- **Skipping the purge check**
  (1) Old grease left in the housing hides the new fill
  (2) Watch for clean grease at the relief port before you stop

::: main-box
Record the point, the grease and the amount every time
:::""")
        note = next((s for s in shapes if s["text"].startswith("Record the point")), None)
        heads = [s for s in shapes if re.match(r"^(Greasing on|Mixing grease|Filling the housing|Skipping the purge)", s["text"])]
        self.assertTrue(note and heads and all(h["y"] > note["y"] + note["h"] for h in heads), "the note stands above the main points")
        self.assertEqual(len({round(h["x"]) for h in heads}), 2, [round(h["x"]) for h in heads])
        self.assertEqual(self.findings(out, "OF-115"), [])

        def beside(prs):  # the note in a narrow column beside points that stop short of three quarters of the body
            y = 120
            for sh in prs.slides[0].shapes:
                t = sh.text_frame.text if sh.has_text_frame else ""
                if t.startswith("Record the point"):
                    sh.left, sh.top, sh.width, sh.height = Pt(660), Pt(120), Pt(264), Pt(50)
                elif sh.has_text_frame and t and not sh.name.startswith(("title@", "lit-notice")):
                    sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(y), Pt(600), Pt(18)
                    y += 22
                elif not sh.name.startswith(("family@", "lit-notice", "title@")):
                    sh.left, sh.top, sh.width, sh.height = Pt(648), Pt(120), Pt(288), Pt(62)
        planted = self.plant(out, self.tmp / "beside.pptx", beside)
        self.assertTrue(any("column beside a longer one" in str(f["value"]) for f in self.findings(planted, "OF-115")), self.findings(planted, "OF-115"))

    def test_takeaways_beside_figure_rows_fill_their_column_down_to_the_floor_and_the_gate_reads_it_there(self):
        deck, shapes = self.one("kf", "signal", """layout: kpi-row
title: bottom-anchor

## 정비 거점 7개월 운영 지표

| 정비 거점 | 월 처리 | 재정비 비율 | 상주 인력 |
|---|---|---|---|
| 7곳 | 410건 | 6% | 9명 |
| 3월 2곳 | 3월 160건 | 3월 14% | 3월 6명 |

- 거점은 3월 2곳에서 7곳으로 늘었고 월 처리는 160건에서 410건이 됐다
- 재정비 비율은 14%에서 6%로 8%p 내려갔다
- 인력 1인당 월 처리는 약 27건에서 약 46건으로 늘었다
- 처리 건수는 인력 증가(1.5배)보다 빠른 2.6배로 늘었다
- 출처: 예시 정비 관리 시스템, 2026년 3-9월""")
        heads = ("거점은 3월", "재정비 비율은", "인력 1인당", "처리 건수는")
        title = next(s for s in shapes if s["text"].startswith("정비 거점 7개월"))
        figure = next(s for s in shapes if s["text"] == "7곳")
        points = [s for s in shapes if s["text"].startswith(heads)]
        source = next(s for s in shapes if s["text"].startswith("출처:"))
        self.assertEqual(len(points), 4)
        if all(s["x"] > figure["x"] + 200 for s in points):  # beside the rows the points share the column down to the source
            gap = self._column_gap(points + [source], figure["y"], title["y"]) * (486 - figure["y"]) / (title["y"] - figure["y"])
            self.assertLessEqual(gap, 0.4, [(s["text"][:6], round(s["y"]), round(s["h"])) for s in points])
        self.assertEqual(self.findings(deck, "OF-115"), [])

        def stacked(prs):  # the points close under one another at the column's top, though the rows stop short too
            k, x = 0, max(sh.left for sh in prs.slides[0].shapes if sh.has_text_frame and sh.text_frame.text.startswith("출처:"))
            for sh in prs.slides[0].shapes:
                if sh.has_text_frame and sh.text_frame.text.startswith(heads):
                    sh.left, sh.top, sh.width, sh.height = x + Pt(20), Pt(36 + 56 * k), Pt(346), Pt(50 if k < 3 else 25)
                    k += 1
                elif sh.width < Pt(8) and sh.height < Pt(8):
                    sh.top = Pt(4)
        planted = self.plant(deck, self.tmp / "kf-stacked.pptx", stacked)
        self.assertTrue(any("column beside a longer one" in str(f["value"]) for f in self.findings(planted, "OF-115")), self.findings(planted, "OF-115"))

    def test_summary_groups_of_unequal_length_split_where_the_columns_come_out_nearest_even(self):
        out, shapes = self.one("s", "gazette", """layout: summary-box-list

## 정비 거점 점검 요약과 건의

::: key-message
북부 거점의 야간 근무를 한 조 늘리되, 늘린 조는 컨베이어 정비만 맡는다
:::

- **점검 결과**
  (1) 야간 고장 접수가 석 달 동안 평균 18% 늘었다
  (2) 오후 10시 이후 대기 시간이 주간의 1.6배다
  (3) 재정비 비율은 6%에서 9%로 올랐다
- **남은 문제**
  (1) 야간 인력 4명 가운데 2명이 파견 인력이다
  (2) 야간 조명 비용이 하루 18만 원 늘어난다
  (3) 부품 창고가 오후 9시에 닫힌다
- **건의**
  (1) 늘린 조는 컨베이어 12대만 맡는다
  (2) 추가 비용은 연 1,900만 원이다
- 출처: 예시 정비 관리 시스템(2026년 7-9월)""")
        third = next(s for s in shapes if s["text"].startswith("건의"))
        second = next(s for s in shapes if "남은 문제" in s["text"])
        self.assertAlmostEqual(second["x"], third["x"], delta=1, msg="the second group stands with the third")
        self.assertEqual(self.findings(out, "OF-115"), [])

    def test_a_next_step_that_fits_the_box_sets_on_one_line_across_it(self):
        _, shapes = self.one("a", "chalk", """layout: closing-ask

## 5강 전까지 고장 분석 실습 과제

| 과제 | 분량 | 배점 | 기한 | 확인할 점 |
|---|---|---|---|---|
| 고장 기록 정리하기 | 기록 20건 이상 | 6점 | 10월 5일(월) | 5분 미만 제외 |
| 원인별로 묶기 | 표 1장 | 4점 | 10월 6일(화) | 원인 이름 통일 |
| 원인별 간격 구하기 | 표 1장 | 6점 | 10월 7일(수) | 단위 포함 |
| 주기 제안하기 | 2문장 이내 | 4점 | 10월 8일(목) | 70% 여유 |

- 과제: 5강(10월 9일) 전까지 기록 20건 이상으로 원인별 간격을 직접 구해 본다
- 제출: 단계마다 기한까지 학습 게시판의 한 게시물에 이어서 올린다 (4강 과제, 총 20점)
- 다음 시간: 예방 보전 주기 시험 운영, 질문은 전날까지 게시판에 (예시 강사)""")
        task = next((s for s in shapes if s["text"].startswith("과제:")), None)
        self.assertTrue(task and len(_lines(task["text"])) == 1 and task["w"] >= 700, f"one line across the box: {task}")
        for s in [x for x in shapes if re.match(r"^(과제|제출|다음 시간):", x["text"])]:
            self.assertGreaterEqual(s["w"], 400, s)

    def test_an_agenda_takes_no_count_numeral_and_the_gate_fails_one(self):
        out, shapes = self.one("g", "chalk", """layout: agenda

## 4강 학습 목표와 순서

- **고장 기록 읽기** 정지 시각과 증상으로 고장을 가려내는 법
- **평균 고장 간격** 가동 시간과 고장 건수로 간격을 구하는 순서
- **원인별 간격** 전체 평균보다 원인별 간격을 먼저 읽는 까닭
- **흔한 실수** 간격을 잘못 읽는 세 가지 방식""")
        title = next(s for s in shapes if s["name"].startswith("title@"))
        self.assertNotEqual(title["name"], "title@kicker-numeral")
        self.assertFalse(any(s["text"] == "4" and s["y"] < 120 for s in shapes), "no stray numeral beside the title")
        self.assertLessEqual(title["x"], 30, f"the title starts at the margin: {title['x']}")

        def numeral(prs):
            slide = prs.slides[0]
            t = next(x for x in slide.shapes if x.name.startswith("title@"))
            t.left, t.name = Pt(180), "title@kicker-numeral"
            box = slide.shapes.add_textbox(Pt(24), Pt(36), Pt(120), Pt(72))
            box.text_frame.text = "4"
            box.text_frame.paragraphs[0].runs[0].font.size = Pt(60)
        planted = self.plant(out, self.tmp / "k.pptx", numeral)
        self.assertTrue(any(f["slide"] == 1 and f["severity"] == "HIGH" for f in self.findings(planted, "OF-119")), self.findings(planted, "OF-119"))

    def test_a_series_keeps_one_colour_across_the_deck(self):
        out = self.deck("s", """---
tonality: paper
title: Staged lubrication
---

---
layout: chart-insight

## Single-point bearing temperature

::: chart type=line unit="°C"
| Time (min) | Single point (°C) |
|---|---|
| 0 | 40 |
| 30 | 58 |
| 60 | 66 |
:::

- Temperature keeps climbing after minute 30
---

---
layout: chart-insight

## Staged vs single-point bearing temperature

::: chart type=line unit="°C"
| Time (min) | Single point (°C) | Staged (°C) |
|---|---|---|
| 0 | 40 | 40 |
| 30 | 58 | 49 |
| 60 | 66 | 52 |
:::

- The staged fill holds the bearing at 52 °C by minute 60
---
""")
        colours = lambda xml: [m.upper() for m in re.findall(r'<c:ser>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"', xml)]  # noqa: E731
        single, pair = (colours(xml) for xml in _parts(out, r"ppt/charts/chart\d+\.xml"))
        self.assertEqual(single[0], pair[0], f"Single point alone {single[0]}, beside Staged {pair[0]}")
        self.assertNotEqual(pair[0], pair[1])

    def test_a_wide_method_figure_runs_across_the_body_over_its_terms(self):
        image = Image.new("RGB", (800, 230), (255, 255, 255))
        draw = ImageDraw.Draw(image)
        for x in (80, 330, 580):
            draw.rectangle([x, 80, x + 150, 150], outline=(40, 44, 52), width=4)
        image.save(self.tmp / "flow.png")
        _, shapes = self.one("m", "paper", """layout: method

## Three-point lubrication layout and symbols

![Figure 2. Lubrication layout used in all runs | Source: synthetic sample diagram](flow.png)

- **Layout:** grease enters at three equal points, at 0, 1/3 and 2/3 of the drive length
- **T:** bearing temperature at the outer race
  (1) Logged every 10 min, 0-60 min
- **q, t:** grease dose (g) and interval (h); q = V / n
- **n:** number of lubrication points
  (1) n = 3 in all staged runs; n = 1 for the single-point baseline
- **v:** belt speed, m/s
  (1) Six speeds tested: 0.5, 0.75, 1.0, 1.25, 1.5 and 2.0
- Source: Figure 2, layout used in all 36 runs (sample)""")
        fig = next(s for s in shapes if s["picture"])
        terms = [s for s in shapes if re.match(r"^(Layout|T|q, t|n|v):", s["text"])]
        self.assertGreaterEqual(fig["w"], 450, f"the wide figure is drawn wider than half the body: {fig}")
        self.assertTrue(terms and all(t["y"] >= fig["y"] + fig["h"] for t in terms), [(t["text"][:10], round(t["y"])) for t in terms])

    def test_a_bold_run_in_label_takes_its_colon_and_the_gate_fails_one_without_a_separator(self):
        out, _ = self.one("r", "signal", """layout: text-column
title: top-rule

## 야간 정비 흐름 요약

- **요약** 앱에서 신고하면 야간 당직이 30분 안에 현장에 가고 다음 날 아침 8시 전에 재가동한다
- **신고:** 설비 번호와 증상을 고르면 당직 휴대폰으로 바로 간다
- 당직은 공구함 열쇠를 교대 때 넘겨받는다""")
        runs = self._runs(out)
        self.assertIn(("요약:", True), runs, runs)
        self.assertIn(("신고:", True), runs, "a label with its own colon keeps one")
        self.assertFalse(any("::" in text for text, _ in runs))
        self.assertEqual(self.findings(out, "OF-118"), [])

        def bare(prs):
            for shape in prs.slides[0].shapes:
                if shape.has_text_frame:
                    for paragraph in shape.text_frame.paragraphs:
                        for run in paragraph.runs:
                            if run.text == "요약:":
                                run.text = "요약"
        planted = self.plant(out, self.tmp / "bare.pptx", bare)
        self.assertTrue(any(f["severity"] == "HIGH" for f in self.findings(planted, "OF-118")), "a bold label running into its sentence is reported")

    def test_a_single_takeaway_stays_with_its_timeline_a_chart_states_its_unit_once_and_a_contact_field_starts_where_its_rows_end(self):
        _, tl = self.one("t", "gazette", """layout: timeline
title: top-rule

## 4분기 정비 일정

| 시점 | 일 | 상태 |
|---|---|---|
| 10월 2주 | 윤활 점검 | 진행 |
| 10월 4주 | 벨트 교체 | 예정 |
| 11월 2주 | 재가동 시험 | 예정 |

- 윤활 점검이 끝나면 벨트 교체를 바로 시작한다""")
        take = next(s for s in tl if s["text"].startswith("윤활 점검이 끝나면"))
        labels = [s for s in tl if re.fullmatch(r"윤활 점검|벨트 교체|재가동 시험", s["text"])]
        lowest = max(s["y"] + s["h"] for s in labels)
        self.assertLessEqual(take["y"] - lowest, 60, f"the takeaway follows the axis: {lowest:.0f}, {take['y']:.0f}")
        two, _ = self.one("u", "ledger", """layout: chart-insight
title: top-rule

## 주차별 남은 정비 작업 수

::: chart type=line unit="건"
| 주차 | 계획 (건) | 실적 (건) |
|---|---|---|
| 8월 4주 | 30 | 30 |
| 9월 2주 | 21 | 22 |
| 10월 2주 | 0 | 3 |
:::

- 남은 작업은 주당 다섯 건씩 줄어 11월 첫 주에 끝난다""")
        self.assertNotRegex(_parts(two, r"ppt/charts/chart\d+\.xml")[0], r"<c:valAx>[\s\S]*<c:title>", "the legend carries the unit")
        one, _ = self.one("v", "ledger", """layout: chart-insight
title: top-rule

## 회차별 정비 교육 평가 통과율

::: chart type=column unit="%"
| 회차 | 통과율 |
|---|---|
| 1차 | 68 |
| 2차 | 77 |
| 3차 | 84 |
:::

- 3차 교육에서 84%로 목표 85%에 다가섰다""")
        axis = re.search(r'<c:valAx>[\s\S]*?<c:title>[\s\S]*?<a:bodyPr rot="(-?\d+)"', _parts(one, r"ppt/charts/chart\d+\.xml")[0])
        self.assertTrue(axis and int(axis.group(1)) % 21600000 == 0, f"a level axis title: {axis and axis.group(1)}")
        _, close = self.one("w", "studio", """layout: closing-contact-split

## 11월 정비 외주 계약 협의 안건

| 안건 | 담당 | 일정 |
|---|---|---|
| 야간 당직 범위 | 예시 정비팀 | 10월 셋째 주 |
| 부품 재고 기준 | 예시 구매팀 | 10월 말 |
| 재작업 보상 | 예시 품질팀 | 10월 말 |

- 요청: 조건 세 가지를 정한다""")
        field = next((s for s in close if s["fill"] and s["x"] > 300 and round(s["x"] + s["w"]) == 960), None)
        self.assertTrue(field and field["x"] < 24 + 912 * 7 / 12 - 12, f"the field starts where the rows end: {field}")

    def test_the_studio_statement_stands_between_hairlines_with_no_empty_rail(self):
        out = self.deck("st", f"""---
tonality: studio
title: 정비 거점 확대 제안
date: 2026-10-02
department: 예시 설비팀
presenter: 예시 발표자
{NOTICE}
---

---
layout: cover-typographic

# 정비 거점 확대 제안
---

---
layout: agenda

## 오늘 다룰 것

- **현황** 거점 세 곳의 처리 건수
- **비용** 외주 대비 운영비
- **요청** 거점 두 곳 추가
---

---
layout: section

# 현황
---

---
layout: statement

## 야간 고장 신고의 절반을 다음 날 아침 전에 처리하는 거점 운영
---
""")
        slide = _shapes(out)[3]
        self.assertTrue(any(s["name"] == "title@statement" for s in slide), [s["name"] for s in slide])
        self.assertFalse(any(s["fill"] and round(s["x"]) == 0 and round(s["y"]) == 0 and s["h"] >= 400 and s["w"] < 400 for s in slide),
                         "no empty rail beside the studio statement")
        self.assertGreaterEqual(len([s for s in slide if not s["text"] and s["h"] <= 2 and s["w"] >= 800]), 2, "two hairlines")
        self.assertEqual([f for f in self.findings(out, "OF-110") if f["slide"] == 4], [])


if __name__ == "__main__":
    unittest.main()
