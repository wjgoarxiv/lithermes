"""Review-only Korean prose metrics ported from the canonical Phase A script."""

from __future__ import annotations

import re


THRESHOLDS = {
    "conclusionPivotMin": 4,
    "cleftMin": 2,
    "cleftMinEojeol": 40,
    "connectiveOpenersPerParagraph": 3,
    "connectiveEndingCommaMin": 3,
    "connectiveEndingCommaRate": 0.5,
}
_CONCLUSION = ("결론적으로", "따라서", "이를 통해", "그러므로")
_CONNECTIVE_OPENERS = ("또한", "따라서", "즉", "나아가", "아울러", "게다가", "더욱이", "그러므로", "반면", "그러나", "하지만")
_SAFE_BALANCE = ("양쪽 모두", "두 가지 모두", "장점도 있지만", "신중하게", "균형")
_CONNECTIVE_ENDING = re.compile(r"(?:고|며|지만|면서|아서|어서)(?=[\s,\.!?。！？]|$)")
_CONNECTIVE_ENDING_COMMA = re.compile(r"(?:고|며|지만|면서|아서|어서)\s*,")
_INLINE_CODE = re.compile(r"`[^`]*`|\n+")
_CLEFT = re.compile(r"(?:필요한|중요한|핵심인|문제인|관건인|답인|더\s+(?:심각한|뼈아픈))\s+것은\s+[^.!?。！？\n]{1,100}(?:이다|다|라는 점이다|데 있다)|(?:문제|핵심|관건|답)은\s+[^.!?。！？\n]{1,100}(?:이다|다|는 점이다|데 있다)")
_SENTENCES = re.compile(r"[^.!?。！？\n]+[.!?。！？]?")


def _strip_markdown(text: str) -> str:
    kept = []
    fenced = False
    for line in re.split(r"\r?\n", text):
        if re.match(r"^\s*~~~", line) or line.strip().startswith("```" ):
            fenced = not fenced
            continue
        if fenced or re.match(r"^\s*>", line) or re.match(r"^\s{0,3}#{1,6}\s", line):
            continue
        if re.match(r"^\s*\|.*\|\s*$", line) or re.match(r"^\s*\|?\s*:?---{1,}", line):
            continue
        line = _INLINE_CODE.sub("", line)
        line = re.sub(r"!?\[[^\]]*\]\([^)]*\)", "", line)
        kept.append(line)
    return "\n".join(kept)


def _split_sentences(text: str) -> list[str]:
    return [part.strip() for part in _SENTENCES.findall(text) if part.strip()]


def _sentence_opener(sentence: str) -> str | None:
    clean = re.sub(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)", "", sentence).strip()
    for word in _CONNECTIVE_OPENERS:
        if re.match(rf"^{re.escape(word)}(?:[,，、:]|\s)", clean):
            return word
    return None


def _count(text: str, pattern: re.Pattern) -> int:
    return len(pattern.findall(text))


def analyze_ko_text(input_text: str) -> dict:
    prose = _strip_markdown(str(input_text or ""))
    eojeol = len(re.findall(r"\S+", prose))
    sentences = _split_sentences(prose)
    conclusion_pivots = sum(prose.count(item) for item in _CONCLUSION)
    clefts = _count(prose, _CLEFT)
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", prose) if part.strip()]
    opener_counts = [sum(_sentence_opener(sentence) is not None for sentence in _split_sentences(paragraph)) for paragraph in paragraphs]
    connective_ending_count = _count(prose, _CONNECTIVE_ENDING)
    connective_ending_comma_count = _count(prose, _CONNECTIVE_ENDING_COMMA)
    comma_free_numbers = re.sub(r"(?<=\d),(?=\d)", "", prose)
    comma_sentence_share = (
        sum("," in re.sub(r"(?<=\d),(?=\d)", "", sentence) for sentence in sentences) / len(sentences)
        if sentences else 0
    )
    lengths = [len(re.findall(r"\S+", sentence)) for sentence in sentences]
    average_length = sum(lengths) / len(lengths) if lengths else 0
    variance = sum((value - average_length) ** 2 for value in lengths) / len(lengths) if lengths else 0
    ending_keys = [match.group(0).rstrip(".!?。！？") for sentence in sentences if (match := re.search(r"[가-힣]{1,2}[.!?。！？]?\Z", sentence))]
    warnings = []
    if conclusion_pivots >= THRESHOLDS["conclusionPivotMin"]:
        warnings.append("ko-conclusion-pivot-cluster")
    if eojeol >= THRESHOLDS["cleftMinEojeol"] and clefts >= THRESHOLDS["cleftMin"]:
        warnings.append("ko-cleft-cluster")
    if any(count >= THRESHOLDS["connectiveOpenersPerParagraph"] for count in opener_counts):
        warnings.append("ko-paragraph-initial-connective-cluster")
    comma_rate = connective_ending_comma_count / connective_ending_count if connective_ending_count else 0
    if connective_ending_comma_count >= THRESHOLDS["connectiveEndingCommaMin"] and comma_rate >= THRESHOLDS["connectiveEndingCommaRate"]:
        warnings.append("ko-connective-ending-comma-cluster")
    return {
        "version": 1,
        "scope": "review-only; genre and sentence function still decide",
        "metrics": {
            "eojeol": eojeol,
            "sentenceCount": len(sentences),
            "conclusionPivotCount": conclusion_pivots,
            "cleftCount": clefts,
            "paragraphInitialConnectiveCounts": opener_counts,
            "connectiveEndingCount": connective_ending_count,
            "connectiveEndingCommaCount": connective_ending_comma_count,
            "connectiveEndingCommaRate": round(comma_rate + 1e-12, 3),
            "commaSentenceShare": round(comma_sentence_share + 1e-12, 3),
            "sentenceLengthMeanEojeol": round(average_length + 1e-12, 2),
            "sentenceLengthCv": round((variance ** 0.5 / average_length) + 1e-12, 3) if average_length else 0,
            "endingVariety": round((len(set(ending_keys)) / len(ending_keys)) + 1e-12, 3) if ending_keys else 0,
            "safeBalanceCount": sum(prose.count(item) for item in _SAFE_BALANCE),
            "proseCommaCount": prose.count(",") if not comma_free_numbers else comma_free_numbers.count(","),
        },
        "warnings": warnings,
    }
