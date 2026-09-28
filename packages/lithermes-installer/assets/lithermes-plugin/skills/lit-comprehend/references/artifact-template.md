# Explainer artifact template

Use this as a layout guide, not a mandatory audit form. Build a clear, self-contained
explanation that helps a person understand the change and choose a useful next step.
Keep test transcripts, status ledgers, detailed verification notes, and source
inventories in the internal journal.

## 한눈에

Orient the reader in one paragraph: what changed and why it matters. State the
scope in ordinary language when it helps the reader follow the rest.

```html
<section id="overview">
  <h2>한눈에</h2>
  <p>...what changed, and why it matters...</p>
</section>
```

## 이미 알고 있던 것

Anchor the explanation in the reader's objective, request, or starting point.
Include only background that helps explain the change. A skippable block is
optional when the reader may already know that context.

```html
<section id="anchor">
  <h2>이미 알고 있던 것</h2>
  <p>목표: ...</p>
  <div class="skippable">
    <summary>배경 (이미 아는 사람은 건너뛰기)</summary>
    <p>...</p>
  </div>
</section>
```

## 직관

Explain the essence of each theme before its implementation details. Reuse small
toy data when useful. Choose two or three diagrams from these families; use
HTML/CSS rather than ASCII art.

### Pipeline diagram

```html
<div class="pipe">
  <div class="box">입력</div>
  <div class="arrow"></div>
  <div class="box">처리</div>
  <div class="arrow"></div>
  <div class="box">출력</div>
</div>
```

### Before/after diagram

```html
<div class="ba">
  <div class="side"><h4>이전</h4><p>...</p></div>
  <div class="side"><h4>이후</h4><p>...</p></div>
</div>
```

### State/timeline table

```html
<div class="scroll-x">
  <table>
    <thead><tr><th>단계</th><th>상태</th><th>변경</th></tr></thead>
    <tbody>...</tbody>
  </table>
</div>
```

### Simplified UI mockup

```html
<div class="ui-mock">
  <div class="mock-header">제목</div>
  <div class="mock-body">...</div>
</div>
```

## 바뀐 것

Group the walkthrough into a few themes in conceptual order. Place code where it
answers a question the reader now has. Every source excerpt must include a
repo-relative `data-src` so the verifier can check its provenance.

```html
<section id="changes">
  <h2>바뀐 것</h2>
  <h3>테마 1: 라우팅 통합</h3>
  <p>설명...</p>
  <pre data-src="src/router.py:20-24">def route(message):
    ...</pre>
</section>
```

Use natural source links or references when they help readers verify a specific,
time-sensitive, disputed, or consequential factual statement. Do not add source
labels after every claim or a claim-to-command evidence table. A real citation
belongs beside the statement it supports; the internal journal keeps the full
research and verification trail.

## 직접 만져보기

Add an interactive widget when it helps the reader feel the behavior. Label a
toy widget as a simplified model; omit it for a purely structural change.

```html
<section id="hands-on">
  <h2>직접 만져보기</h2>
  <p class="note warn">아래는 실제 코드가 아닌 단순화된 모델입니다.</p>
  <div class="world" id="demo">
    <!-- widget markup -->
  </div>
</section>
```

## 퀴즈

Add a short interactive quiz when it reinforces the explanation: five questions
for a broad change, three for a small one. Give each option feedback and vary
correct-answer positions. Keep choices similar in length to avoid answer cues.

```html
<section id="quiz">
  <h2>퀴즈</h2>
  <div class="quiz-q" data-answer="2">
    <p>1. 라우터가 메시지를 어떻게 분류하는가?</p>
    <button class="opt" data-i="0">정규식 하나로 전체 분류</button>
    <button class="opt" data-i="1">파일 확장자 기반</button>
    <button class="opt" data-i="2">토큰 경계 매칭 후 모드별 분기</button>
    <div class="fb" data-i="0">정규식 하나로는 모드 간 충돌을 해결할 수 없습니다.</div>
    <div class="fb" data-i="1">파일 확장자는 라우팅이 아닌 이벤트 감지에 사용됩니다.</div>
    <div class="fb" data-i="2">맞습니다. 토큰 경계를 확인한 후 각 모드 매처로 분기합니다.</div>
  </div>
</section>
```

## 다음

Offer concrete next entry points when a follow-up would help. The list may be
shorter or omitted when there is no useful next action.

```html
<section id="next">
  <h2>다음</h2>
  <ol>
    <li>...</li>
    <li>...</li>
  </ol>
</section>
```

## Qualifications and references

There is no required "확인 안 된 것" or "증거" section. If a caveat changes the
reader's interpretation or next action, say it once in the chat reply in plain
language. Do not fill the artifact with execution status, confidence badges,
internal source labels, or empty limitation lists. Cite real sources in a normal
format when they help; do not invent citations or hide a material uncertainty.
