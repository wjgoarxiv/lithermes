<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitHermes 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ascii-readme.svg" width="480" alt="LIT ASCII B 마크" /></p>

<details>
<summary>ASCII 로고 복사</summary>

```
                             ▄▄▄▄
                   ▗███▌   ▗██████▖
 ▗▄▄▄▄▄          ▗▟████▌   ▝██████▘
 ▐█████        ▗▟██████▌    ▝▀▜█▀▘
 ▐█████      ▗▟███████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 ▐█████    ▗▟█████████████████████████ ▐█▀
 ▐█████    ████████████████████████████▀
 ▐█████    ██▛▘   ▄ ▄▄▄▄▖▄▄▄▄▄▄▄▄▄▄▄▄▄▖
 ▐█████    ▀    ▄██ ████▌█████████████▌
 ▐█████       ▄████ ████▌█████████████▌
 ▐█████     ▄█████▛                                 lithermes
 ▐█████  ▗▟█████▀▘       ▄▄▄▄▄     ▗▖
 ▐█████ ▐█████▀          █████     ▐▛▀
 ▐█████ ▐███▀            █████
 ▐█████ ▐█▀              █████
 ▐█████ ▝                █████
 ▐█████▄▄▄▄▄▄▄▖          █████
 ▐███████████▛           █████
 ▐██████████▀            █████

```

</details>

<p align="center"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/lithermes-wordmark.svg" width="480" alt="LITHERMES 디스플레이 서체" /></p>
<p align="center"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/lithermes-clay-icon.png" width="160" alt="LitHermes 클레이 마크" /></p>

<p align="center">
<a href="#설치"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/badge-version.svg" alt="1.0.9" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/lucide-book-open.svg" width="16" alt="" /> 문서</a> &nbsp;
<a href="#설치">설치</a> &nbsp;
<a href="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition</a> &nbsp;
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitHermes

**Keep the work lit.**

무엇인가요: LitHermes는 **Hermes Agent**에서 계획, 실행, 검토, 인계를 이어갑니다.

[English](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/README.md) · [npm](https://www.npmjs.com/package/@litfamily/lithermes) · [GitHub](https://github.com/wjgoarxiv/lithermes)

## 설치

소스 기준 버전은 `@litfamily/lithermes@1.0.9`입니다. Hermes Agent와 Node.js 18+가 필요하며, Hermes 홈(기본 `~/.hermes`)에 쓰기 권한이 있어야 합니다.

설치기는 Hermes 홈을 대상으로 합니다. 별도 체험을 하려면 설치 전에 `HERMES_HOME`을 새 빈 디렉터리로 지정하고 Hermes를 시작할 때도 같은 값을 사용하세요. 기존 홈과 설정은 보관합니다. `--no-patch-installed-hermes`는 해당 프로필 밖에서 감지된 호스트 설치본에 호환성 패치를 적용하지 못하게 합니다.

scoped npm package를 설치합니다.

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

별도 로컬 체험에는 릴리스 안내와 함께 받은 검토된 `.tgz`를 사용할 수 있습니다. 예시 경로를 실제 파일 경로로 바꾸고, 각 줄을 따로 실행하세요.

```sh
LITHERMES_PACK='/absolute/path/to/the-reviewed-package.tgz'
```

```sh
npm exec --yes --package "$LITHERMES_PACK" -- lithermes install --yes --no-style --no-auto-update --no-patch-installed-hermes
```

첫 `--yes`는 npx 실행을, 두 번째는 Hermes 설정 변경을 승인합니다. `--no-style`은 답변 문체 선택을 생략하며 화면을 바꾸는 native Skin을 끄지는 않습니다. 설치 중 Telegram에 연결하지 않습니다.

## 빠른 시작

Hermes CLI 또는 gateway를 다시 시작한 뒤 대화에 작업을 입력하세요.

```text
lit 외부 의존성 없이 HTML 파일 하나로 할 일 목록을 만들어줘. 추가·완료·삭제를 구현하고 확인한 내용과 다음 행동을 남겨줘.
```

명시적 경로는 `/lit <요청>`입니다. 응답은 다른 내용보다 먼저 `🔥 **LIT IGNITED · <discipline>** 🔥` 한 줄을 정확히 한 번 표시하며, 경로 확인 표시는 응답이 도착할 때 나타납니다.

HTML 파일을 직접 열어 각 동작을 확인하세요. Hermes에는 실제로 확인한 내용과 아직 확인하지 못한 내용을 나누어 기록하도록 요청하세요. `/lit-handoff`로 결과와 다음 행동을 프로젝트에 남긴 뒤, 새 세션에서 같은 프로젝트를 열고 그 인계 기록을 먼저 읽도록 요청합니다.

불씨는 남겨 둔 기록을 뜻합니다. 세션이 끝난 뒤에도 프로그램이 계속 실행된다는 뜻은 아닙니다.

## 핵심 기능

**불씨를 건네받았습니다. 이제, 당신의 작업에 옮길 차례입니다.** 고치고 싶은 버그, 만들고 싶은 화면, 끝내고 싶은 프로젝트는 한 문장으로 시작할 수 있습니다. 작업을 이어가려면 어떤 결정을 내렸고 무엇을 확인했으며 다음에는 무엇을 할지 기록으로 남겨야 합니다. **다음 세션이 이어받을 수 있는 것을 남기세요.**

### 범위를 정한 작업과 인계

```text
계획하기 → 만들기 → 확인하기 → 다음 작업에 건네기
```

LitHermes는 Hermes Agent 안에서 계획, 실행, 검토와 인계를 연결합니다. 목표·계획·근거·다음 할 일을 프로젝트에 남겨 다른 세션이 같은 기록에서 이어갈 수 있습니다.

### Hermes 연결 구조

Hermes가 Python plugin을 불러오면 `register(ctx)`가 훅, 명령, 스킬과 작업 도구를 등록합니다. 훅은 모델·도구 호출에 관여하고 `goal_*` 도구는 목표와 확인 결과를 로컬 기록에 남깁니다. 요청 경로는 plugin이 안내하고 실제 모델 실행은 Hermes Agent가 담당합니다. 호스트 권한·인증·모델 접근·화면 확인은 별도 기능입니다.

```mermaid
flowchart TD
    H["Hermes Agent"] --> P["Python plugin · register(ctx)"]
    P --> K["훅 · 모델·도구 호출 전후"]
    P --> S["명령과 스킬 · SKILL.md"]
    P --> T["goal_* 작업 도구"]
    T <--> R["프로젝트 기록 · .hermes/lithermes/litgoal/"]
    R --> K
```

기록을 읽는 context hook은 다음 모델 호출에 현재 목표와 진행 상황을 전달합니다.

### Ignition Skin

Hermes CLI에서 `/skin`으로 현재 스킨과 목록을 확인하세요. `/skin lithermes-ignition`을 선택하고 Hermes를 다시 시작해 시작 배너를 확인합니다. Ignition은 주황·라임·아이보리·네이비를 사용합니다. 지원되는 welcome에는 컴팩트 레이아웃에서도 5행 MICRO 마크가 표시되지만 호스트가 전체 `banner_logo`를 생략할 수 있습니다. 번호 1~10의 색상 프리셋도 유지합니다. 색상을 지원하는 대화형 자동 승인 설치는 `display.skin`이 없을 때만 Ignition을 선택합니다. 기존 선택과 스킨 파일은 보존합니다.

밝은 터미널에서는 `/skin lithermes-tokyonight-day`, 어두운 터미널에서는 `/skin lithermes-tokyonight`를 선택하고 Hermes를 다시 시작하세요. 두 스킨은 본문·상태·완료 메뉴를 읽기 쉽게 하고 기존 MICRO·배너 그림을 다시 칠하며, 기존 선택과 파일을 보존합니다. 입력한 텍스트는 터미널 기본 글자색을 따릅니다. 자연스러운 Lit 응답에는 MICRO 안내가 끝에 한 번 붙습니다.

Skin은 CLI 화면을, 출력 스타일은 답변 문체를 바꿉니다. Gateway 대화에는 CLI Skin이 보이지 않습니다. 실제 모습은 호스트와 터미널에 따라 다르며, YAML 파일만으로 화면 적용을 확인할 수는 없습니다.

이름이 있는 기존 스킨 파일은 자동 갱신하지 않습니다. 일반 파일을 갱신하려면 보존용 백업으로 옮긴 뒤 설치기를 다시 실행해 빠진 이름의 파일을 만들고 사용자 수정 사항을 다시 적용하세요. 심볼릭 링크나 예상하지 못한 대상은 교체하지 않습니다. macOS의 CPR 비활성 `prompt_toolkit` 구분선은 다른 Rich 출력이 승인된 색상을 유지해도 ANSI-256으로 남을 수 있습니다.

### 화면 및 README 작업

`frontend-ui-ux`는 지정된 화면을 만들기 전에 중요한 디자인 선택을 확인합니다. 검토만 또는 계획만 요청하면 파일을 수정하지 않습니다. `readme-studio`는 사실에 근거한 README와 Pretendard/Meslo 윤곽 글자, 편집 가능한 소스, 가능한 경우 검증된 모션 표지를 만듭니다. Hermes 목록에서는 `lithermes:readme-studio`로 찾을 수 있습니다. native 이미지 생성기가 없으면 `IMAGE_GENERATION_UNAVAILABLE`을 알리며, 제공된 이미지를 합성할 수 있습니다. 두 작업 모두 로그인, 전역 설치나 배포를 수행하지 않습니다.

개념도와 기술 다이어그램에는 정확한 `lit-diagram-drawer` 경로(`lithermes:lit-diagram-drawer`)를 사용합니다. 다이어그램 생성 요청 앞이나 뒤에 단독 `lit`을 붙여도 이 스킬을 선택하고 설치된 진입 파일을 안내합니다. 제품 화면은 `frontend-ui-ux`, 측정된 과학 데이터 그래프는 `lit-scientific-visualization`이 담당합니다. 보고서와 발표자료 요청에 단독 `lit`을 붙이면 번들된 `lithermes:lit-docx`와 `lithermes:lit-pptx`로 경로가 정해집니다. 요청에 따라 DOCX, PPTX 또는 둘 다 만들고 Markdown 원본을 함께 보관합니다. 기본값은 한국어 문서의 korean-generic과 발표자료의 AZURE-PRO·Pretendard이며, 사용자의 명시적 선택이 우선합니다. Office 런타임은 처음 사용할 때 고정된 의존성을 LitHermes 캐시에 설치하고 문서·슬라이드 QA를 실행합니다. 명시적 경로는 `/lit-docx <brief>`와 `/lit-pptx <brief>`입니다.

설치된 스킬 ID는 `lit-pptx`와 `lit-docx`이며 Hermes에서는 `lithermes:lit-pptx`와 `lithermes:lit-docx`로 표시됩니다.

`lit-typographic-motion`은 `lithermes:lit-typographic-motion` 및 `/lit-typographic-motion <brief>`로 사용할 수 있습니다. 영상 제작 요청에 단독 `lit`을 붙이면 먼저 트리트먼트를 쓰고, 그림과 도형이 필요한 영상은 스테이지 경로(모델이 작성한 HTML 페이지를 프레임 단위로 캡처)로, 글자 자체가 영상일 때는 WebGL2 타입 엔진으로 렌더합니다. 기본으로 생성 사운드 베드를 넣고 그렇다고 표시합니다. 렌더 세션 전에 `lithermes motion-runtime status`로 Chrome·ffmpeg·WebGL2·폰트 상태를 확인하고, 필요하면 `lithermes motion-runtime install`로 의존성을 미리 설치합니다. QA를 통과하면 60fps 영상(1920×1080, 스테이지 경로는 1080×1920도 가능), 미리보기, 포스터, 움직임 축소 정지 이미지와 검사 보고서를 제공합니다. 엔진 일부는 mexicat/pdoom-video (MIT, Giacomo Magnanini), 커밋 `ca251e3`에서 각색했습니다.

### 독자용 글 다듬기

`lit-humanizer` 스킬은 `lithermes:lit-humanizer`로 사용할 수 있습니다.

`lithermes:lit-humanizer`는 사실과 의도를 지키며 한국어와 영어 초안을 다듬습니다. SVG를 포함한 지원 텍스트 형식 중 Hermes `write_file`과 `patch`로 전달되는 변경 내용을 검사합니다. 지원되는 쓰기 전에 차단 등급 발견이 있으면 저장을 막고, 주의 등급은 검토 의견으로 전달합니다. DOCX/PPTX는 파일 쓰기 이벤트나 스크립트 결과에 출력 경로가 보고되면 생성 뒤 검사합니다. PDF는 경로가 보고되고 `pdftotext`를 사용할 수 있을 때 텍스트를 검사합니다. 문서 검사는 사후 안내이므로 원본을 고친 뒤 다시 만들어야 합니다. 이 감지기는 글쓴이를 판별하지 않습니다.


## 스킬 한눈에 보기

LitHermes에서 부를 수 있는 모든 스킬과 그 스킬을 시작하는 경로입니다. 각 스킬은 `lithermes:<이름>`으로 명시해 불러올 수도 있습니다.

<table>
<tr><th>이렇게 됩니다</th><th>스킬</th><th>얻는 것</th></tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/litwork.webp" width="240" alt="요청에 lit만 붙이세요. 노트를 열고, 기준마다 실패 테스트·통과·실제 확인·정리 순서를 엄격히 지킵니다." /></td>
<td><code>litwork</code><br /><sub><code>lit &lt;task&gt;</code> · <code>litwork &lt;task&gt;</code></sub></td>
<td>요청에 <code>lit</code>만 붙이세요. 노트를 열고, 기준마다 실패 테스트·통과·실제 확인·정리 순서를 엄격히 지킵니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-plan.webp" width="240" alt="start-work가 그대로 실행할 수 있는 번호 붙은 작업 목록이 파일로 나옵니다. 코드는 아직 건드리지 않습니다." /></td>
<td><code>lit-plan</code><br /><sub><code>lit plan &lt;what&gt;</code> · <code>/lit-plan</code></sub></td>
<td><code>start-work</code>가 그대로 실행할 수 있는 번호 붙은 작업 목록이 파일로 나옵니다. 코드는 아직 건드리지 않습니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/start-work.webp" width="240" alt="계획을 한 줄씩 실행합니다. 다섯 관문을 모두 통과해야 체크 표시가 붙습니다." /></td>
<td><code>start-work</code><br /><sub><code>/start-work &lt;approved-plan&gt;</code></sub></td>
<td>계획을 한 줄씩 실행합니다. 다섯 관문을 모두 통과해야 체크 표시가 붙습니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/review-work.webp" width="240" alt="다섯 갈래 리뷰가 같은 변경을 따로 읽고, 발견한 문제부터 보고합니다." /></td>
<td><code>review-work</code><br /><sub><code>lit review &lt;scope&gt;</code> · <code>/review-work</code></sub></td>
<td>다섯 갈래 리뷰가 같은 변경을 따로 읽고, 발견한 문제부터 보고합니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/litgoal.webp" width="240" alt="목표 하나와 확인 가능한 기준을 디스크에 남겨, 다음 세션이 이어받을 수 있습니다." /></td>
<td><code>litgoal</code><br /><sub><code>lit goal &lt;outcome&gt;</code> · <code>/litgoal</code></sub></td>
<td>목표 하나와 확인 가능한 기준을 디스크에 남겨, 다음 세션이 이어받을 수 있습니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-recap.webp" width="240" alt="읽기 전용 요약입니다. 끝난 일, 진행 중인 일, 막힌 곳, 증거 위치, 다음 단계를 보여줍니다." /></td>
<td><code>lit-recap</code><br /><sub><code>lit-recap</code></sub></td>
<td>읽기 전용 요약입니다. 끝난 일, 진행 중인 일, 막힌 곳, 증거 위치, 다음 단계를 보여줍니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-handoff.webp" width="240" alt="handoff라고 치면 다음 세션이 읽고 이어갈 인수인계 파일이 생깁니다." /></td>
<td><code>lit-handoff</code><br /><sub><code>handoff</code> · <code>/lit-handoff</code></sub></td>
<td><code>handoff</code>라고 치면 다음 세션이 읽고 이어갈 인수인계 파일이 생깁니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/deep-interview.webp" width="240" alt="한 번에 한 질문씩 물어 아이디어를 만들 수 있을 만큼 분명하게 다듬습니다. 남은 모호함은 게이지로 보입니다." /></td>
<td><code>deep-interview</code><br /><sub><code>deep-interview &lt;idea&gt;</code> · <code>/deep-interview</code></sub></td>
<td>한 번에 한 질문씩 물어 아이디어를 만들 수 있을 만큼 분명하게 다듬습니다. 남은 모호함은 게이지로 보입니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/litresearch.webp" width="240" alt="조사 질문을 잘게 나누고 여러 검색을 동시에 돌려, 단서를 끝까지 따라간 뒤 출처와 함께 답합니다." /></td>
<td><code>litresearch</code><br /><sub><code>lit research &lt;question&gt;</code></sub></td>
<td>조사 질문을 잘게 나누고 여러 검색을 동시에 돌려, 단서를 끝까지 따라간 뒤 출처와 함께 답합니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-crucible.webp" width="240" alt="계획 전에 요구사항을 반박해 봅니다. 반박을 견딘 위험만 계획으로 넘어갑니다." /></td>
<td><code>lit-crucible</code><br /><sub><code>lit-crucible &lt;brief&gt;</code></sub></td>
<td>계획 전에 요구사항을 반박해 봅니다. 반박을 견딘 위험만 계획으로 넘어갑니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-init.webp" width="240" alt="저장소를 훑어 루트 AGENTS.md와, 필요한 폴더에만 짧은 안내서를 만듭니다." /></td>
<td><code>lit-init</code><br /><sub><code>lit-init</code></sub></td>
<td>저장소를 훑어 루트 AGENTS.md와, 필요한 폴더에만 짧은 안내서를 만듭니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-comprehend.webp" width="240" alt="에이전트가 쓴 작업을 이해하도록 돕는 설명 페이지입니다. 직관, 흐름 설명, 짧은 퀴즈 순서입니다." /></td>
<td><code>lit-comprehend</code><br /><sub><code>lit-comprehend</code> · <code>comprehend &lt;range&gt;</code></sub></td>
<td>에이전트가 쓴 작업을 이해하도록 돕는 설명 페이지입니다. 직관, 흐름 설명, 짧은 퀴즈 순서입니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-humanizer.webp" width="240" alt="딱딱한 AI 문장을 한국어나 영어로 다시 씁니다. 사실과 단서는 남기고, 파일을 멋대로 고치지 않습니다." /></td>
<td><code>lit-humanizer</code><br /><sub><code>humanizer &lt;text&gt;</code> · <code>/lit-humanizer</code></sub></td>
<td>딱딱한 AI 문장을 한국어나 영어로 다시 씁니다. 사실과 단서는 남기고, 파일을 멋대로 고치지 않습니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-diagram-drawer.webp" width="240" alt="슬라이드와 문서에 넣을 다이어그램을 편집 가능한 형태로 그리고, 검사한 뒤 PNG와 SVG로 내보냅니다." /></td>
<td><code>lit-diagram-drawer</code><br /><sub><code>lit-diagram-drawer &lt;brief&gt;</code> · <code>/lit-diagram-drawer</code></sub></td>
<td>슬라이드와 문서에 넣을 다이어그램을 편집 가능한 형태로 그리고, 검사한 뒤 PNG와 SVG로 내보냅니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-pptx.webp" width="240" alt="lit으로 발표자료를 요청하면 편집 가능한 PowerPoint 파일과 원고 Markdown이 나옵니다. 기본은 AZURE-PRO와 Pretendard이고, 완성된 파일로 품질 검사와 무결성 검사를 돌립니다." /></td>
<td><code>lit-pptx</code><br /><sub><code>lit-pptx &lt;brief&gt;</code> · <code>/lit-pptx</code></sub></td>
<td><code>lit</code>으로 발표자료를 요청하면 편집 가능한 PowerPoint 파일과 원고 Markdown이 나옵니다. 기본은 AZURE-PRO와 Pretendard이고, 완성된 파일로 품질 검사와 무결성 검사를 돌립니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-docx.webp" width="240" alt="lit으로 보고서를 요청하면 서식을 갖춘 Word 파일과 원고 Markdown이 나옵니다. 한국어는 korean-generic 서식을 쓰고, 문체 검사와 렌더링된 페이지 확인이 뒤따릅니다." /></td>
<td><code>lit-docx</code><br /><sub><code>lit-docx &lt;brief&gt;</code> · <code>/lit-docx</code></sub></td>
<td><code>lit</code>으로 보고서를 요청하면 서식을 갖춘 Word 파일과 원고 Markdown이 나옵니다. 한국어는 korean-generic 서식을 쓰고, 문체 검사와 렌더링된 페이지 확인이 뒤따릅니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/frontend-ui-ux.webp" width="240" alt="실제로 동작하는 화면을 만들고, 설치된 측정 프로브로 일곱 가지 보기를 렌더링합니다. 네 가지 폭, 다크 모드, 모션 줄이기, 200% 확대입니다." /></td>
<td><code>frontend-ui-ux</code><br /><sub><code>lit design &lt;target&gt;</code> · <code>frontend-ui-ux &lt;target&gt;</code></sub></td>
<td>실제로 동작하는 화면을 만들고, 설치된 측정 프로브로 일곱 가지 보기를 렌더링합니다. 네 가지 폭, 다크 모드, 모션 줄이기, 200% 확대입니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/readme-studio.webp" width="240" alt="사실에 맞는 README와 움직이는 커버를 만들고, 휴대폰과 데스크톱 폭, 라이트와 다크 모드에서 확인합니다." /></td>
<td><code>readme-studio</code><br /><sub><code>readme-studio &lt;scope&gt;</code></sub></td>
<td>사실에 맞는 README와 움직이는 커버를 만들고, 휴대폰과 데스크톱 폭, 라이트와 다크 모드에서 확인합니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-typographic-motion.webp" width="240" alt="lit으로 영상을 요청하면 트리트먼트를 먼저 쓰고, 장면을 그리거나 글자를 움직이고, 사운드를 만든 뒤 검사를 거쳐 영상을 넘깁니다." /></td>
<td><code>lit-typographic-motion</code><br /><sub><code>lit-typographic-motion &lt;request&gt;</code> · <code>/lit-typographic-motion</code></sub></td>
<td><code>lit</code>으로 영상을 요청하면 트리트먼트를 먼저 쓰고, 장면을 그리거나 글자를 움직이고, 사운드를 만든 뒤 검사를 거쳐 영상을 넘깁니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-scientific-visualization.webp" width="240" alt="학술지 규격 그림을 벡터와 600 DPI로 내보냅니다. 그래프 종류는 데이터 성격에 맞춰 고릅니다." /></td>
<td><code>lit-scientific-visualization</code><br /><sub><code>lit-scientific-visualization</code> · <code>/lit-scientific-visualization</code></sub></td>
<td>학술지 규격 그림을 벡터와 600 DPI로 내보냅니다. 그래프 종류는 데이터 성격에 맞춰 고릅니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/visual-qa.webp" width="240" alt="실제 화면을 폭별로 확인해 결과를 정직하게 돌려줍니다. 막히면 무엇이 막았는지 정확히 알려줍니다." /></td>
<td><code>visual-qa</code><br /><sub><code>visual-qa &lt;target&gt;</code></sub></td>
<td>실제 화면을 폭별로 확인해 결과를 정직하게 돌려줍니다. 막히면 무엇이 막았는지 정확히 알려줍니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/browser-drive.webp" width="240" alt="브라우저 드라이버를 먼저 확인한 뒤 실제 페이지를 조작합니다. 드라이버가 없으면 그렇다고 말합니다." /></td>
<td><code>browser-drive</code><br /><sub><code>browser-drive &lt;task&gt;</code></sub></td>
<td>브라우저 드라이버를 먼저 확인한 뒤 실제 페이지를 조작합니다. 드라이버가 없으면 그렇다고 말합니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/structural-search.webp" width="240" alt="글자 대신 문법 구조로 코드를 찾고, 바꾸기 전에 결과를 미리 보여줍니다." /></td>
<td><code>structural-search</code><br /><sub><code>lit structural &lt;pattern&gt;</code> · <code>structural-search &lt;pattern&gt;</code></sub></td>
<td>글자 대신 문법 구조로 코드를 찾고, 바꾸기 전에 결과를 미리 보여줍니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/wikify.webp" width="240" alt="검토를 거친 프로젝트 지식을 디스크에 두고, 나중 질문에 출처와 함께 답합니다." /></td>
<td><code>wikify</code><br /><sub><code>wikify &lt;mode&gt;</code> · <code>lit wikify &lt;mode&gt;</code></sub></td>
<td>검토를 거친 프로젝트 지식을 디스크에 두고, 나중 질문에 출처와 함께 답합니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/debugging.webp" width="240" alt="버그를 재현하고, 가설을 세 개 이상 세워 확인한 뒤, 확인된 원인만 고칩니다." /></td>
<td><code>debugging</code><br /><sub><code>lit debug &lt;symptom&gt;</code> · <code>debugging &lt;symptom&gt;</code></sub></td>
<td>버그를 재현하고, 가설을 세 개 이상 세워 확인한 뒤, 확인된 원인만 고칩니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/refactor.webp" width="240" alt="동작을 테스트로 고정한 채 코드 구조를 바꿉니다. 단계마다 확인합니다." /></td>
<td><code>refactor</code><br /><sub><code>lit refactor &lt;target&gt;</code> · <code>refactor &lt;target&gt;</code></sub></td>
<td>동작을 테스트로 고정한 채 코드 구조를 바꿉니다. 단계마다 확인합니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-burnoff.webp" width="240" alt="테스트로 동작을 먼저 묶어 두고, 변경분에 붙은 AI식 군더더기를 걷어냅니다." /></td>
<td><code>lit-burnoff</code><br /><sub><code>lit slop &lt;scope&gt;</code></sub></td>
<td>테스트로 동작을 먼저 묶어 두고, 변경분에 붙은 AI식 군더더기를 걷어냅니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-burnoff-file.webp" width="240" alt="파일 하나만 정리합니다. 설명조 주석과 과한 방어 코드를 줄이고 중첩을 펴줍니다." /></td>
<td><code>lit-burnoff-file</code><br /><sub><code>ask to clean one file</code></sub></td>
<td>파일 하나만 정리합니다. 설명조 주석과 과한 방어 코드를 줄이고 중첩을 펴줍니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-code.webp" width="240" alt="엄격한 구현 규칙입니다. 테스트 먼저, 경계에서 타입 확인, 작은 파일." /></td>
<td><code>lit-code</code><br /><sub><code>ask for strict implementation</code></sub></td>
<td>엄격한 구현 규칙입니다. 테스트 먼저, 경계에서 타입 확인, 작은 파일.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lit-commit.webp" width="240" alt="변경을 저장소 스타일에 맞는 작은 커밋으로 나눕니다. 관계없는 작업은 건드리지 않습니다." /></td>
<td><code>lit-commit</code><br /><sub><code>lit git &lt;task&gt;</code></sub></td>
<td>변경을 저장소 스타일에 맞는 작은 커밋으로 나눕니다. 관계없는 작업은 건드리지 않습니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lsp-setup.webp" width="240" alt="사용하는 언어의 언어 서버를 설치하고, 진단이 실제로 도는지 확인합니다." /></td>
<td><code>lsp-setup</code><br /><sub><code>lsp-setup &lt;language&gt;</code></sub></td>
<td>사용하는 언어의 언어 서버를 설치하고, 진단이 실제로 도는지 확인합니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/lsp.webp" width="240" alt="요청할 때 Hermes 언어 서버로 진단, 참조, 이름 바꾸기 안전성을 확인합니다." /></td>
<td><code>lsp</code><br /><sub><code>lsp &lt;request&gt;</code></sub></td>
<td>요청할 때 Hermes 언어 서버로 진단, 참조, 이름 바꾸기 안전성을 확인합니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/rules.webp" width="240" alt="Hermes가 어떤 규칙 파일을 언제 읽는지 설명합니다." /></td>
<td><code>rules</code><br /><sub><code>rules &lt;question&gt;</code></sub></td>
<td>Hermes가 어떤 규칙 파일을 언제 읽는지 설명합니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/comment-checker.webp" width="240" alt="수정으로 추가된 주석을 검토합니다. 이유는 남기고, 되풀이하는 주석은 뺍니다. 소스 파일을 고친 뒤에도 알아서 돕니다." /></td>
<td><code>comment-checker</code><br /><sub><code>comment-checker</code></sub></td>
<td>수정으로 추가된 주석을 검토합니다. 이유는 남기고, 되풀이하는 주석은 뺍니다. 소스 파일을 고친 뒤에도 알아서 돕니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/autoresearch.webp" width="240" alt="승인된 예산 안에서 실험을 반복합니다. 한 번에 하나만 바꾸고, 결과에 따라 남기거나 되돌립니다." /></td>
<td><code>autoresearch</code><br /><sub><code>autoresearch &lt;mode&gt;</code></sub></td>
<td>승인된 예산 안에서 실험을 반복합니다. 한 번에 하나만 바꾸고, 결과에 따라 남기거나 되돌립니다.</td>
</tr>
<tr>
<td><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/skills/autoconference.webp" width="240" alt="예산을 정한 연구 회의입니다. 연구자와 리뷰어가 따로 일하고, 종합에는 반대 의견도 남깁니다." /></td>
<td><code>autoconference</code><br /><sub><code>autoconference &lt;mode&gt;</code></sub></td>
<td>예산을 정한 연구 회의입니다. 연구자와 리뷰어가 따로 일하고, 종합에는 반대 의견도 남깁니다.</td>
</tr>
</table>

## 한 줄 요청 A/B

각 요청은 가볍게 쓴 한국어 한 줄입니다. LitHermes 쪽은 같은 줄 끝에 ` lit`만 붙였습니다. 두 쪽 모두 2026-09-26에 Hermes Agent v0.21.3, `gpt-6-sol`, 추론 `high`로 한 번씩 실행했고, LitHermes 쪽은 배포 전 로컬 빌드를 썼습니다. 블라인드 판정자(Claude Opus 5.5)는 도구 이름을 지운 두 결과를 순서를 바꿔 두 번 비교했습니다. 그다음 메인테이너가 두 결과를 나란히 놓고 보고 최종 판정을 내렸습니다.

S3·S4·S11은 이후의 UI 라운드, S5·S8·S9는 `lit-pptx`와 `lit-docx`를 쓴 오피스 라운드 결과이며, 같은 작업의 이전 결과를 대신합니다. UI 라운드에서 LitHermes 쪽은 화면 측정 프로브를 한 번도 실행하지 않았습니다. 스킬이 설치된 프로브 경로를 알려 주지 않았기 때문입니다. 지금 스킬은 경로를 알려 주지만, 이 세 작업은 아직 다시 실행하지 않았습니다. S3·S4의 기준선은 LitHermes 쪽과 달리 파일 쓰기 격리 없이 실행됐습니다.

| 작업 | 요청 | 최종 판정 | 블라인드 판정(같은 라운드) |
|---|---|---|---|
| S1 · 터미널 할 일 CLI | 터미널에서 쓰는 할 일 관리 CLI 만들어줘 | 무승부 | 기준선 승 |
| S2 · API 서버 버그 | 이 API 서버 가끔 이상하게 동작하는데 고쳐줘 | 무승부 | 무승부 |
| S3 · 가계부 대시보드 (UI 라운드) | 개인 가계부 대시보드 웹페이지 만들어줘 | **LitHermes 승** | LitHermes 승 |
| S4 · 카페 랜딩페이지 (UI 라운드) | 동네 카페 브랜드 랜딩페이지 만들어줘 | **LitHermes 승** | LitHermes 승 |
| S5 · 자료 기반 보고서와 발표자료 (오피스 라운드) | sources 폴더 자료로 보고서랑 발표자료 만들어줘 | **LitHermes 승** | LitHermes 승 |
| S6 · Node 22→24 조사 | Node 22에서 24로 올릴 때 달라지는 거 조사해줘 | **LitHermes 승** | 무승부 |
| S7 · 주문·결제·배송 구조도 | 주문-결제-배송 서비스 구조도 그려줘 | **LitHermes 승** | LitHermes 승 |
| S8 · 분기 실적 발표자료 (오피스 라운드) | 분기 실적 발표자료 만들어줘 | **LitHermes 승** | 기준선 승 |
| S9 · 신제품 기획서 (오피스 라운드) | 신제품 기획서 써줘 | **LitHermes 승** | LitHermes 승 |
| S11 · 회의실 예약 웹앱 (UI 라운드) | 회의실 예약 웹앱 만들어줘 | **LitHermes 승** | 무승부 |
| 합계 | | **8승 2무 0패** | 5승 3무 2패 |

맨 위 모션 표지는 LitFamily 모션 스킬로 만들었습니다. 이 스킬(여기서는 `lit-typographic-motion`)은 첫 A/B 이후 다시 만들어졌고, 아직 A/B 결과가 없습니다.

### 양쪽이 만든 것

**S1 · 무승부 (판정자: 기준선 승).** 두 CLI 모두 도움말, 추가, 조회, 완료가 동작했고 자체 테스트도 통과했습니다(기준선 6개, LitHermes 4개). 판정자는 기준선을 골랐습니다. 기준선은 화면 문구를 한국어로 유지하고 수정 기능과 완료 항목 필터를 더했으며, 파일 잠금과 원자적 쓰기로 데이터 파일을 보호했습니다. LitHermes의 CLI 출력과 README는 영어였습니다. 메인테이너는 둘을 비겼다고 봤습니다.

**S2 · 무승부.** 두 쪽 모두 알려진 버그 6개를 모두 고쳤고 보이는 테스트 실패도 없었습니다. LitHermes는 답변에서 버그 4개를 짚었고(기준선 3개) 실행 중인 서버에서 두 번째 페이지 수정을 확인했습니다. 기준선은 새 검증 규칙을 README에 적었습니다. 판정자와 메인테이너 모두 무승부로 봤습니다.

**S3 · LitHermes 승.** LitHermes 대시보드는 CSV 내보내기와 예산 수정을 더했고 아이콘을 한 세트로 맞췄으며, 답변에 320~1440px 브라우저 확인을 적었습니다. 기준선 차트는 축과 월 라벨이 늘어나 휴대폰에서 특히 일그러졌습니다. 접근성 검사에서는 LitHermes 쪽 위반 노드가 더 많았습니다(117 대 91).

| 기준선 | LitHermes |
|---|---|
| ![S3 기준선 가계부 대시보드, 데스크톱](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s3-ui-baseline-desktop.webp) | ![S3 LitHermes 가계부 대시보드, 데스크톱](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s3-ui-lithermes-desktop.webp) |

**S4 · LitHermes 승.** LitHermes는 품목과 가격이 있는 탭 메뉴, 서로 다른 사진 6장, 아치형 첫 화면을 만들었습니다. 기준선 메뉴는 분위기 카드 3장이었고 같은 실내 사진을 두 번 썼습니다. 위치와 영업시간은 기준선에만 있었고, 페이지 검사에서 잘리거나 화면 밖으로 나간 글자 상자가 LitHermes 쪽에서 7개, 기준선에서 0개 나왔습니다.

| 기준선 | LitHermes |
|---|---|
| ![S4 기준선 카페 랜딩페이지, 데스크톱](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s4-ui-baseline-desktop.webp) | ![S4 LitHermes 카페 랜딩페이지, 데스크톱](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s4-ui-lithermes-desktop.webp) |

**S5 · LitHermes 승.** 두 쪽 모두 확인 대상 사실 12개를 모두 맞혔습니다. LitHermes는 2026년 점검과 의회 보고 기한이 이미 지났다는 점을 짚었고, 기준선은 이를 앞으로 할 일로 적었습니다. LitHermes는 주말 거점과 평일 승합차 이용의 차이처럼 자료가 뒷받침하는 분석도 더했습니다. 슬라이드 디자인은 기준선이 낫고, LitHermes 발표자료는 기본 템플릿 그대로입니다.

기준선:

![S5 기준선 발표자료 슬라이드](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s5-office-baseline-slides.webp)

LitHermes:

![S5 LitHermes 발표자료 슬라이드](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s5-office-lithermes-slides.webp)

**S6 · LitHermes 승 (판정자: 무승부).** LitHermes는 기준 사실 10개 중 3개를 찾았고(기준선 1개), 링크는 모두 공식 출처였습니다(기준선은 4분의 1). npm 11에서 `--ignore-scripts`가 `prepare`에도 적용되는 점, Undici 7, ARMv7 빌드 중단도 다뤘습니다. 기준선은 API 세부 사항을 더 많이 적었지만 권한 플래그 이름 변경을 24의 새 변화처럼 소개해, 판정자가 오해 소지가 있다고 봤습니다.

**S7 · LitHermes 승.** LitHermes는 결제 실패와 취소 흐름까지 담은, 렌더링된 편집 가능한 HTML 구조도를 냈고, 필요한 Chrome이 없어 PNG 내보내기와 화면 검토를 건너뛰었다고 밝혔습니다. 기준선은 채팅에 ASCII 상자를 그렸는데, 판정자는 한글이 두 칸 폭이라 줄이 어긋날 것으로 봤습니다. 메인테이너는 차이가 압도적이라고 평했습니다.

| 기준선 | LitHermes |
|---|---|
| 채팅 속 ASCII 상자만 있고 렌더링된 파일 없음 | ![S7 LitHermes 주문·결제·배송 구조도](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s7-lithermes-diagram.webp) |

**S8 · LitHermes 승 (판정자: 기준선 승).** 요청에는 회사도 실적 수치도 없었습니다. 기준선은 빈칸을 둔 7장짜리 템플릿을, LitHermes는 가상 기업의 8장짜리 발표자료와 차트 3개를 만들고 모든 수치에 가정 예시라고 표시했습니다. 판정자는 바로 채워 쓸 수 있는 기준선 템플릿을 골랐고, LitHermes 차트는 데이터 라벨이 없어 빈약하다고 봤습니다. 메인테이너는 LitHermes 발표자료를 골랐습니다.

기준선:

![S8 기준선 발표자료 슬라이드](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s8-office-baseline-slides.webp)

LitHermes:

![S8 LitHermes 발표자료 슬라이드](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s8-office-lithermes-slides.webp)

**S9 · LitHermes 승.** 기준선은 어떤 제품인지 되묻기만 하고 문서를 쓰지 않았습니다. LitHermes는 가상의 모듈형 책상 정리 트레이를 대상으로 고객 문제, 가격 가정, 검증 일정, 생산 결정 기준을 담은 3쪽짜리 Word 기획서를 썼고, 판정자는 손익분기 계산이 맞다고 봤습니다.

| 기준선 | LitHermes |
|---|---|
| 문서 없음. 어떤 제품인지 되물음 | ![S9 LitHermes 신제품 기획서 첫 페이지들](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s9-office-lithermes-pages.webp) |

**S11 · LitHermes 승 (판정자: 무승부).** LitHermes는 날짜별 현황, 인원 필터와 검색, 30분 단위 예약을 갖추고 로직 테스트 4개가 통과하는 앱을 냈습니다. 판정자는 모든 회의실을 한 타임라인에 보여 주는 기준선이 더 알아보기 쉽고 `index.html`만 열면 된다고 봤습니다. LitHermes 앱은 npm과 로컬 서버가 필요하고, 일러스트 배너가 일정표 위를 차지합니다. 메인테이너는 LitHermes 앱을 골랐습니다.

| 기준선 | LitHermes |
|---|---|
| ![S11 기준선 회의실 예약 앱, 데스크톱](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s11-ui-baseline-desktop.webp) | ![S11 LitHermes 회의실 예약 앱, 데스크톱](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.9/readme-assets/ab-simple/s11-ui-lithermes-desktop.webp) |

그림 URL은 현재 후보 버전에 고정된 출시 대상 경로이며, 별도 승인된 패키지 배포 전에는 공개 접근을 뜻하지 않습니다.

## 명령과 훅

### 핵심 명령

| 입력 | 용도 |
|---|---|
| `lit <요청>` 또는 `/lit` | 범위를 정한 작업을 시작하고 확인 결과를 남깁니다. |
| `handoff` 또는 `/lit-handoff` | 현재 작업과 다음 할 일을 다음 세션으로 넘깁니다. |
| `lit-plan` 또는 `/lit-plan` | 실행 전에 계획을 작성합니다. |
| `/start-work <승인된 계획>` | 승인한 계획을 실행합니다. |
| `/review-work` | 계획이나 결과를 검토하고 발견 사항을 남깁니다. |
| `litresearch` 또는 `lit research <질문>` | 출처 메모가 있는 조사 흐름을 사용합니다. |
| `lit review <대상>` | 계획이나 결과를 검토합니다. |
| `/lit-loop` | 명시적 반복 작업을 시작·확인·재개·종료합니다. |
| `/litgoal` | 기준·근거·체크포인트와 막힌 지점을 추적합니다. |
| `/lit-humanizer` | 의미를 지키며 한국어·영어 문장을 다듬습니다. 이전 별칭은 `/lit-korean`, `/text-naturalization`, `/text-neutralization`, `/korean-ai-slop-remover`입니다. |
| `/lit-diagram-drawer <brief>` | 설치된 Python 도구로 내용과 기하 구조를 검사하며 접근성·한국어를 고려한 다이어그램을 만듭니다. |
| `/lit-pptx <brief>` | 번들된 AZURE-PRO 엔진으로 발표자료를 만들고 검사합니다. |
| `/lit-docx <brief>` | 출판 프로필을 적용해 Word 문서를 만들고 편집·검토합니다. |
| `/lit-typographic-motion <brief>` | 트리트먼트에서 출발해 스테이지 또는 타입 경로로 원본 영상을 연출하고 검사합니다. |

Telegram gateway에서는 `/lit_loop`와 `/lit_plan` 별칭을 사용합니다. 전체 명령 예시와 훅 동작은 [운영 안내](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md)에 있습니다. 경로 확인 메시지는 호스트 메시지이며 작업이나 화면 검토가 끝났다는 증거가 아닙니다.

### Jev 스킬 힌트(선택)

LitHermes는 TypeSafe가 호스팅하는 결정 모델 Jev에게 평범한 프롬프트에 맞는 LitHermes 스킬을 물어볼 수 있습니다. 답은 그 턴의 컨텍스트에 조언 한 줄로만 들어갑니다. 스킬을 불러올지는 여전히 Hermes 모델이 정하며, 힌트는 권한을 주거나 도구를 실행하지 않습니다. 슬래시 명령과 기존 LitHermes 경로가 이미 처리하는 프롬프트에는 관여하지 않습니다.

기본값은 꺼짐입니다. 켜려면 Hermes가 실행되는 환경에 두 변수를 모두 설정하고, 키는 본인의 TypeSafe 키를 사용하세요.

```sh
export LITHERMES_JEV=1
export TYPESAFE_API_KEY=<your key>
```

켜 두면 조건에 맞는 프롬프트마다 2,000자로 자르고 홈 경로, 이메일 주소, 토큰 형태의 문자열을 가린 뒤 TypeSafe(typesafe.ai)로 보냅니다. 토큰 형태가 아닌 내용은 쓴 그대로 전송됩니다. 호스트 이름, 고객 이름, `password=...` 형식이 아닌 비밀번호가 그렇습니다. Hermes 게이트웨이 모드에서는 대화방의 다른 참여자가 보낸 메시지도 전송 대상입니다. 세션의 다른 내용은 보내지 않습니다. `TYPESAFE_API_KEY`는 Hermes를 시작하는 셸에 export되어 있으므로 에이전트의 도구도 이 값을 읽을 수 있습니다. 이 기능 전용 키를 쓰고 사용 한도를 낮게 잡으세요. 비용은 TypeSafe가 본인 계정에 청구하며, 입력 토큰 100만 개당 약 0.04달러입니다. 요청마다 1.5초 제한이 있고 재시도하지 않습니다. 실패하면 턴은 그대로 진행되고, 짧은 안내가 세션마다 한 번만 표시됩니다. 켜져 있는 동안에는 세션의 첫 답변 맨 위에 `✦ Jev skill hint ON` 한 줄이 표시되어, 기능이 켜져 있다는 것을 바로 알 수 있습니다. 힌트는 `hermes lithermes status`와 `hermes lithermes doctor`에서 확인합니다. `Jev skill hint: on — last hint lit-humanizer (0.43s)`는 마지막으로 힌트한 스킬과 Jev의 응답 시간을, `on — no hint yet`은 아직 힌트가 없다는 뜻이며, 그 밖에는 `off` 또는 `flag on but TYPESAFE_API_KEY missing`이 표시됩니다. 끄려면 `LITHERMES_JEV`를 해제하거나 `1`이 아닌 값으로 바꾸세요.

## 문제 해결

### 안전 모델과 호스트 한계

- 설치 전 `npm exec --yes --package "$LITHERMES_PACK" -- lithermes install --dry-run --no-auto-update --no-patch-installed-hermes`로 변경을 미리 확인하세요. 코드·인용문·복사한 명령은 실행 지시로 다루지 않으며, 비밀값은 저장하거나 모델에 전달하기 전에 가립니다.
- native `/goal`은 사용자가 관리하며 plugin은 관찰하지 않습니다. durable `goal_*` 상태가 기준이며 native `/goal`을 자동으로 갱신·초기화·재개하지 않습니다.
- Hermes 하위 모델은 공통 모델 경로를 사용합니다. 작업별 모델 재정의와 지정 reviewer 경로는 지원하지 않습니다. 설정 receipt가 실제 child 실행을 증명하지 않습니다.
- 생성되는 negative gate matrix는 분리된 HOME과 `HERMES_HOME`을 사용하므로 동시 세션의 receipt를 비교할 수 있습니다.
- Hermes는 bare skill 이름(명시적 로드 형태인 `lithermes:<name>`이 아닌 경우)을 Hermes `config.yaml`의 `skills.external_dirs`와 로컬 `<HERMES_HOME>/skills`에서 먼저 찾은 뒤 LitHermes plugin으로 넘어갑니다. 이 위치 중 하나에 같은 이름의 skill이 있으면 `lithermes doctor`가 `skill shadow check: WARNING` 줄로 해당 skill과 가리는 경로를 알려줍니다. `lithermes:<name>`으로 명시적으로 불러오거나, 다른 위치의 사본을 제거·이름 변경하세요. 이 경고는 doctor의 성공/실패 종료 상태를 바꾸지 않습니다.

### 확인 및 삭제

오프라인으로 설치 상태를 확인합니다.

```sh
npm exec --yes --package "$LITHERMES_PACK" -- lithermes doctor --offline --no-auto-update
```

plugin을 삭제합니다.

```sh
npm exec --yes --package "$LITHERMES_PACK" -- lithermes uninstall --yes --no-auto-update
```

호환성 패치를 적용했다면 삭제 시 `--rollback-patches`를 추가하세요. 삭제 후에도 native skin 파일과 `display.skin` 선택은 남습니다. 선택을 지우려면 해당 프로필에서 `npm exec --yes --package "$LITHERMES_PACK" -- lithermes hud off`를 실행하세요. 스킨 파일과 다른 설정은 유지합니다.

Lit 스킬이 보이지 않으면 Hermes에 `skills_list` 도구를 호출해 LitHermes 항목을 확인하도록 요청하세요. 플러그인 스킬과 파일시스템만 조회하는 `/skills` 목록은 호스트 버전에 따라 다를 수 있습니다. Hermes 로그의 import 오류는 플러그인 로딩 실패이지, 추측으로 pip 패키지를 설치하라는 뜻이 아닙니다. 오류 메시지를 보관한 뒤 운영 안내를 확인하세요.

## 링크

### 더 읽을 문서

- [운영 안내: 명령, 모델, 스킨, 문제 해결](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md)
- [Python plugin 계약](https://github.com/wjgoarxiv/lithermes/blob/main/packages/lithermes-installer/assets/lithermes-plugin/README.md)
- [변경 기록](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md)
- [npm package 안내](https://github.com/wjgoarxiv/lithermes/blob/main/packages/lithermes-installer/README_Ko-KR.md)
- [개인정보](https://github.com/wjgoarxiv/lithermes/blob/main/docs/privacy.md) · [이전 패키지에서 이전하기](https://github.com/wjgoarxiv/lithermes/blob/main/docs/migration.md)

### 커뮤니티와 이전 안내

[기여](https://github.com/wjgoarxiv/lithermes/blob/main/CONTRIBUTING.md) · [보안](https://github.com/wjgoarxiv/lithermes/blob/main/SECURITY.md) · [행동 강령](https://github.com/wjgoarxiv/lithermes/blob/main/CODE_OF_CONDUCT.md) · [지원](https://github.com/wjgoarxiv/lithermes/blob/main/SUPPORT.md)

MIT License.

### LITFAMILY

각 제품은 지원하는 에이전트 환경에 따로 설치해 사용합니다.
