# Micro-world patterns

A micro-world is a small interactive widget embedded in the explainer artifact
so the reader can **feel** the behavior rather than just read about it. It is
always a simplified model, never the real code.

## When to include

Include a micro-world when the change has observable behavior: a new algorithm,
a routing decision, a threshold, a state machine, a UI flow. Omit for purely
structural changes (renames, file moves, dependency bumps).

## Rules

1. **Label as simplified model** — the opening line must say this is not the
   real implementation.
2. **Faithful on the teaching dimension** — the widget must correctly
   demonstrate the concept it claims to show, even though it simplifies
   everything else.
3. **Reuse the document's toy data** — do not invent new examples; use the
   same data introduced in 직관.
4. **Show an interesting range by default** — set initial values so the
   widget demonstrates non-trivial behavior without requiring user interaction.
5. **No network, no external dependencies** — everything inlined.
6. **Degrade to a worked example in `--md` mode** — when Markdown output is
   requested, replace the interactive widget with a static worked example
   showing the same concept.

## Pattern 1: Faithful miniature

Port the core logic to JavaScript, wire it to editable input fields.

```html
<div class="world" id="miniature">
  <p class="note warn">단순화된 모델입니다. 실제 구현과 다릅니다.</p>
  <label>입력: <input type="text" id="mini-input" value="lit plan build"></label>
  <button onclick="runMini()">실행</button>
  <pre id="mini-output"></pre>
</div>
<script>
function runMini() {
  const input = document.getElementById('mini-input').value;
  const output = document.getElementById('mini-output');
  // Simplified logic faithful to the teaching dimension
  const tokens = input.trim().split(/\s+/);
  let mode = 'unknown';
  if (tokens[0] === 'lit' && tokens[1]) mode = tokens[1];
  output.textContent = `mode: ${mode}`;
}
runMini();
</script>
```

## Pattern 2: Slider

Use an `<input type="range">` for continuous parameters like thresholds,
timeouts, or budgets.

```html
<div class="world" id="slider">
  <p class="note warn">단순화된 모델입니다.</p>
  <label>임계값: <input type="range" id="threshold" min="0" max="100" value="50"
    oninput="updateSlider()"></label>
  <span id="threshold-val">50</span>
  <div id="slider-result"></div>
</div>
<script>
function updateSlider() {
  const val = document.getElementById('threshold').value;
  document.getElementById('threshold-val').textContent = val;
  const result = document.getElementById('slider-result');
  result.textContent = Number(val) > 70 ? 'activated' : 'below threshold';
}
updateSlider();
</script>
```

## Pattern 3: Step-through

Next/reset buttons showing state at each stage of a pipeline or algorithm.

```html
<div class="world" id="stepper">
  <p class="note warn">단순화된 모델입니다.</p>
  <button onclick="stepNext()">다음 단계</button>
  <button onclick="stepReset()">초기화</button>
  <pre id="step-state"></pre>
</div>
<script>
(function() {
  const stages = [
    { label: '1. 입력 파싱', state: '{ raw: "lit plan build" }' },
    { label: '2. 토큰 추출', state: '{ tokens: ["lit", "plan", "build"] }' },
    { label: '3. 모드 결정', state: '{ mode: "lit-plan", objective: "build" }' },
  ];
  let step = 0;
  window.stepNext = function() {
    if (step < stages.length) {
      document.getElementById('step-state').textContent =
        stages[step].label + '\n' + stages[step].state;
      step++;
    }
  };
  window.stepReset = function() {
    step = 0;
    document.getElementById('step-state').textContent = '(초기화됨)';
  };
  stepReset();
})();
</script>
```

## Pattern 4: Old/new toggle

Radio buttons or tabs switching between the old and new behavior with the
same input.

```html
<div class="world" id="toggle">
  <p class="note warn">단순화된 모델입니다.</p>
  <label><input type="radio" name="version" value="old" checked
    onchange="toggleVersion()"> 이전</label>
  <label><input type="radio" name="version" value="new"
    onchange="toggleVersion()"> 이후</label>
  <pre id="toggle-output"></pre>
</div>
<script>
function toggleVersion() {
  const isNew = document.querySelector('input[name="version"][value="new"]').checked;
  const output = document.getElementById('toggle-output');
  if (isNew) {
    output.textContent = 'New behavior: bounded routing with token boundaries';
  } else {
    output.textContent = 'Old behavior: substring match (false positives)';
  }
}
toggleVersion();
</script>
```
