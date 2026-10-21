# 스킬과 명령

[← README로 돌아가기](../README_Ko-KR.md) · [English](./skills.md)

LitHermes가 설치하는 모든 스킬과 그 스킬을 시작하는 명령, 그리고 문서·다이어그램·영상·화면·글 다듬기 스킬이 만들어 내는 결과물을 정리했습니다.

## 전체 스킬

LitHermes에서 부를 수 있는 모든 스킬과 그 스킬을 시작하는 말입니다. 어느 스킬이든 `lithermes:<이름>`으로 직접 불러올 수도 있습니다.

<table>
<tr><th>이렇게 됩니다</th><th>스킬</th><th>얻는 것</th></tr>
<tr>
<td><img src="./assets/skills/litwork.webp" width="240" alt="요청에 lit만 붙이세요. 노트를 펴 두고, 기준 하나마다 실패하는 테스트, 통과, 실물 확인, 정리 순서를 엄격하게 밟습니다." /></td>
<td><code>litwork</code><br /><sub><code>lit &lt;task&gt;</code> · <code>litwork &lt;task&gt;</code></sub></td>
<td>요청에 <code>lit</code>만 붙이세요. 노트를 펴 두고, 기준 하나마다 실패하는 테스트, 통과, 실물 확인, 정리 순서를 엄격하게 밟습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-plan.webp" width="240" alt="start-work가 그대로 실행할 수 있는 번호 붙은 작업 목록이 파일로 나옵니다. 코드는 아직 건드리지 않습니다." /></td>
<td><code>lit-plan</code><br /><sub><code>lit plan &lt;what&gt;</code> · <code>/lit-plan</code></sub></td>
<td><code>start-work</code>가 그대로 실행할 수 있는 번호 붙은 작업 목록이 파일로 나옵니다. 코드는 아직 건드리지 않습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/start-work.webp" width="240" alt="계획을 한 줄씩 실행합니다. 다섯 관문을 모두 통과해야 체크 표시가 붙습니다." /></td>
<td><code>start-work</code><br /><sub><code>/start-work &lt;approved-plan&gt;</code></sub></td>
<td>계획을 한 줄씩 실행합니다. 다섯 관문을 모두 통과해야 체크 표시가 붙습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/review-work.webp" width="240" alt="리뷰어 다섯이 같은 변경을 각자 읽고, 찾은 문제부터 알려 줍니다." /></td>
<td><code>review-work</code><br /><sub><code>lit review [plan|work] &lt;scope&gt;</code> · <code>/review-work</code></sub></td>
<td>계획 검토는 <code>start-work</code> 전에 계획을 점검합니다. 작업 검토는 리뷰어 다섯이 끝난 변경을 각자 읽고, 찾은 문제부터 알려 줍니다. 있는 것을 보고 방식을 고르며 첫 줄에 어느 쪽인지 밝힙니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/litgoal.webp" width="240" alt="목표 하나와 확인 가능한 기준을 디스크에 남겨, 다음 세션이 이어받을 수 있습니다." /></td>
<td><code>litgoal</code><br /><sub><code>lit goal &lt;outcome&gt;</code> · <code>/litgoal</code></sub></td>
<td>결승선을 정하고 지킵니다. 목표 하나와 확인 가능한 기준을 디스크에 남겨 다음 세션이 이어받을 수 있고, <code>lit-loop</code>와 <code>start-work</code>가 그 결승선을 향해 달립니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-recap.webp" width="240" alt="읽기 전용 요약입니다. 끝난 일, 진행 중인 일, 막힌 곳, 증거 위치, 다음 단계를 보여줍니다." /></td>
<td><code>lit-recap</code><br /><sub><code>lit-recap</code></sub></td>
<td>읽기 전용 요약입니다. 끝난 일, 진행 중인 일, 막힌 곳, 증거 위치, 다음 단계를 보여줍니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-handoff.webp" width="240" alt="handoff라고 치면 다음 세션이 읽고 이어갈 인수인계 파일이 생깁니다." /></td>
<td><code>lit-handoff</code><br /><sub><code>handoff</code> · <code>/lit-handoff</code></sub></td>
<td><code>handoff</code>라고 치면 다음 세션이 읽고 이어갈 인수인계 파일이 생깁니다.</td>
</tr>
<tr>
<td></td>
<td><code>lit-brainstorm</code><br /><sub><code>lit brainstorm &lt;ask&gt;</code> · <code>lit ideation &lt;ask&gt;</code> · <code>lit idea &lt;ask&gt;</code></sub></td>
<td>이름이나 방향처럼 열린 요청에 씁니다. 서로 다른 선택지를 먼저 많이 내고, 장단점이 붙은 짧은 목록으로 좁힙니다. 고르면 그 선택을 <code>deep-interview</code>나 <code>lit-plan</code>으로 넘기며, 직접 만들지는 않습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/deep-interview.webp" width="240" alt="한 번에 한 질문씩 물어 아이디어를 만들 수 있을 만큼 분명하게 다듬습니다. 남은 모호함은 게이지로 보입니다." /></td>
<td><code>deep-interview</code><br /><sub><code>deep-interview &lt;idea&gt;</code> · <code>/deep-interview</code></sub></td>
<td>한 번에 한 질문씩 물어 아이디어를 만들 수 있을 만큼 분명하게 다듬습니다. 남은 모호함은 게이지로 보입니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/litresearch.webp" width="240" alt="조사 질문을 잘게 나누고 여러 검색을 동시에 돌려, 단서를 끝까지 따라간 뒤 출처와 함께 답합니다." /></td>
<td><code>litresearch</code><br /><sub><code>lit research &lt;question&gt;</code></sub></td>
<td>조사 질문을 잘게 나누고 여러 검색을 동시에 돌려, 단서를 끝까지 따라간 뒤 출처와 함께 답합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-crucible.webp" width="240" alt="계획 전에 요구사항을 반박해 봅니다. 반박을 견딘 위험만 계획으로 넘어갑니다." /></td>
<td><code>lit-crucible</code><br /><sub><code>lit-crucible &lt;brief&gt;</code></sub></td>
<td>계획 전에 요구사항을 반박해 봅니다. 반박을 견딘 위험만 계획으로 넘어갑니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-init.webp" width="240" alt="저장소를 훑어 루트 AGENTS.md와, 필요한 폴더에만 짧은 안내서를 만듭니다." /></td>
<td><code>lit-init</code><br /><sub><code>lit-init</code></sub></td>
<td>저장소를 훑어 루트 AGENTS.md와, 필요한 폴더에만 짧은 안내서를 만듭니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-comprehend.webp" width="240" alt="에이전트가 쓴 작업을 이해하도록 돕는 설명 페이지입니다. 직관, 흐름 설명, 짧은 퀴즈 순서입니다." /></td>
<td><code>lit-comprehend</code><br /><sub><code>lit-comprehend</code> · <code>comprehend &lt;range&gt;</code></sub></td>
<td>에이전트가 쓴 작업을 이해하도록 돕는 설명 페이지입니다. 직관, 흐름 설명, 짧은 퀴즈 순서입니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-humanizer.webp" width="240" alt="딱딱한 AI 문장을 한국어나 영어로 다시 씁니다. 사실과 단서는 남기고, 파일을 멋대로 고치지 않습니다." /></td>
<td><code>lit-humanizer</code><br /><sub><code>humanizer &lt;text&gt;</code> · <code>/lit-humanizer</code></sub></td>
<td>딱딱한 AI 문장을 한국어나 영어로 다시 씁니다. 사실과 단서는 남기고, 파일을 멋대로 고치지 않습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-diagram-drawer.webp" width="240" alt="슬라이드와 문서에 넣을 다이어그램을 편집 가능한 형태로 그리고, 검사한 뒤 PNG와 SVG로 내보냅니다." /></td>
<td><code>lit-diagram-drawer</code><br /><sub><code>lit-diagram-drawer &lt;brief&gt;</code> · <code>/lit-diagram-drawer</code></sub></td>
<td>슬라이드와 문서에 넣을 다이어그램을 편집 가능한 형태로 그리고, 검사한 뒤 PNG와 SVG로 내보냅니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-pptx.webp" width="240" alt="lit으로 발표자료를 요청하면 먼저 여덟 가지 디자인 방향 가운데 하나를 고르고 다른 후보 둘과 함께 알려 준 뒤, 편집 가능한 PowerPoint 파일과 원고 Markdown을 만듭니다. 완성된 파일로 제목·배치·채움 검사를 돌립니다." /></td>
<td><code>lit-pptx</code><br /><sub><code>lit-pptx &lt;brief&gt;</code> · <code>/lit-pptx</code></sub></td>
<td><code>lit</code>으로 발표자료를 요청하면 편집 가능한 PowerPoint 파일과 원고 Markdown이 나옵니다. 기본은 AZURE-PRO와 Pretendard이고, 완성된 파일로 품질 검사와 무결성 검사를 돌립니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-docx.webp" width="240" alt="lit으로 보고서를 요청하면 여섯 가지 문서 형식 가운데 하나를 고르고 다른 후보 둘과 함께 알려 준 뒤, 절제된 인쇄용 Word 파일과 원고 Markdown을 만듭니다. 렌더링한 페이지를 검사로 확인합니다." /></td>
<td><code>lit-docx</code><br /><sub><code>lit-docx &lt;brief&gt;</code> · <code>/lit-docx</code></sub></td>
<td><code>lit</code>으로 보고서를 요청하면 서식을 갖춘 Word 파일과 원고 Markdown이 나옵니다. 한국어는 korean-generic 서식을 쓰고, 문체 검사와 렌더링된 페이지 확인이 뒤따릅니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/frontend-ui-ux.webp" width="240" alt="실제로 동작하는 화면을 만든 뒤, 설치된 측정 프로브로 일곱 가지 모습을 렌더링해 봅니다. 네 가지 폭, 다크 모드, 모션 줄이기, 200% 확대입니다." /></td>
<td><code>frontend-ui-ux</code><br /><sub><code>lit design &lt;target&gt;</code> · <code>frontend-ui-ux &lt;target&gt;</code></sub></td>
<td>실제로 동작하는 화면을 만든 뒤, 설치된 측정 프로브로 일곱 가지 모습을 렌더링해 봅니다. 네 가지 폭, 다크 모드, 모션 줄이기, 200% 확대입니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/readme-studio.webp" width="240" alt="사실에 맞는 README와 움직이는 커버를 만들고, 휴대폰과 데스크톱 폭, 라이트와 다크 모드에서 확인합니다." /></td>
<td><code>readme-studio</code><br /><sub><code>readme-studio &lt;scope&gt;</code></sub></td>
<td>사실에 맞는 README와 움직이는 커버를 만들고, 휴대폰과 데스크톱 폭, 라이트와 다크 모드에서 확인합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-typographic-motion.webp" width="240" alt="lit으로 영상을 요청하면 트리트먼트를 먼저 쓰고, 장면을 그리거나 글자를 움직이고, 사운드를 만든 뒤 검사를 거쳐 영상을 넘깁니다." /></td>
<td><code>lit-typographic-motion</code><br /><sub><code>lit-typographic-motion &lt;request&gt;</code> · <code>/lit-typographic-motion</code></sub></td>
<td><code>lit</code>으로 영상을 요청하면 트리트먼트를 먼저 쓰고, 장면을 그리거나 글자를 움직이고, 사운드를 만든 뒤 검사를 거쳐 영상을 넘깁니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-scientific-visualization.webp" width="240" alt="학술지 규격 그림을 벡터와 600 DPI로 내보냅니다. 그래프 종류는 데이터 성격에 맞춰 고릅니다." /></td>
<td><code>lit-scientific-visualization</code><br /><sub><code>lit-scientific-visualization</code> · <code>/lit-scientific-visualization</code></sub></td>
<td>학술지 규격 그림을 벡터와 600 DPI로 내보냅니다. 그래프 종류는 데이터 성격에 맞춰 고릅니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/visual-qa.webp" width="240" alt="실제 화면을 폭별로 확인해 결과를 정직하게 돌려줍니다. 막히면 무엇이 막았는지 정확히 알려줍니다." /></td>
<td><code>visual-qa</code><br /><sub><code>visual-qa &lt;target&gt;</code></sub></td>
<td>실제 화면을 폭별로 확인해 결과를 정직하게 돌려줍니다. 막히면 무엇이 막았는지 정확히 알려줍니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/browser-drive.webp" width="240" alt="브라우저 드라이버를 먼저 확인한 뒤 실제 페이지를 조작합니다. 드라이버가 없으면 그렇다고 말합니다." /></td>
<td><code>browser-drive</code><br /><sub><code>browser-drive &lt;task&gt;</code></sub></td>
<td>브라우저 드라이버를 먼저 확인한 뒤 실제 페이지를 조작합니다. 드라이버가 없으면 그렇다고 말합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/structural-search.webp" width="240" alt="글자 대신 문법 구조로 코드를 찾고, 바꾸기 전에 결과를 미리 보여줍니다." /></td>
<td><code>structural-search</code><br /><sub><code>lit structural &lt;pattern&gt;</code> · <code>structural-search &lt;pattern&gt;</code></sub></td>
<td>글자 대신 문법 구조로 코드를 찾고, 바꾸기 전에 결과를 미리 보여줍니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/wikify.webp" width="240" alt="검토를 거친 프로젝트 지식을 디스크에 두고, 나중 질문에 출처와 함께 답합니다." /></td>
<td><code>wikify</code><br /><sub><code>wikify &lt;mode&gt;</code> · <code>lit wikify &lt;mode&gt;</code></sub></td>
<td>검토를 거친 프로젝트 지식을 디스크에 두고, 나중 질문에 출처와 함께 답합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/debugging.webp" width="240" alt="버그를 재현하고, 가설을 세 개 이상 세워 확인한 뒤, 확인된 원인만 고칩니다." /></td>
<td><code>debugging</code><br /><sub><code>lit debug &lt;symptom&gt;</code> · <code>debugging &lt;symptom&gt;</code></sub></td>
<td>버그를 재현하고, 가설을 세 개 이상 세워 확인한 뒤, 확인된 원인만 고칩니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/refactor.webp" width="240" alt="동작을 테스트로 고정한 채 코드 구조를 바꿉니다. 단계마다 확인합니다." /></td>
<td><code>refactor</code><br /><sub><code>lit refactor &lt;target&gt;</code> · <code>refactor &lt;target&gt;</code></sub></td>
<td>동작을 테스트로 고정한 채 코드 구조를 바꿉니다. 단계마다 확인합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-burnoff.webp" width="240" alt="테스트로 동작을 먼저 묶어 두고, 변경분에 붙은 AI식 군더더기를 걷어냅니다." /></td>
<td><code>lit-burnoff</code><br /><sub><code>lit slop &lt;scope&gt;</code></sub></td>
<td>테스트로 동작을 먼저 묶어 두고, 변경분에 붙은 AI식 군더더기를 걷어냅니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-burnoff-file.webp" width="240" alt="파일 하나만 정리합니다. 설명조 주석과 과한 방어 코드를 줄이고 중첩을 펴줍니다." /></td>
<td><code>lit-burnoff-file</code><br /><sub><code>ask to clean one file</code></sub></td>
<td>파일 하나만 정리합니다. 설명조 주석과 과한 방어 코드를 줄이고 중첩을 펴줍니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-code.webp" width="240" alt="엄격한 구현 규칙입니다. 테스트 먼저, 경계에서 타입 확인, 작은 파일." /></td>
<td><code>lit-code</code><br /><sub><code>ask for strict implementation</code></sub></td>
<td>엄격한 구현 규칙입니다. 테스트 먼저, 경계에서 타입 확인, 작은 파일.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-commit.webp" width="240" alt="변경을 저장소 스타일에 맞는 작은 커밋으로 나눕니다. 관계없는 작업은 건드리지 않습니다." /></td>
<td><code>lit-commit</code><br /><sub><code>lit git &lt;task&gt;</code></sub></td>
<td>변경을 저장소 스타일에 맞는 작은 커밋으로 나눕니다. 관계없는 작업은 건드리지 않습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lsp-setup.webp" width="240" alt="사용하는 언어의 언어 서버를 설치하고, 진단이 실제로 도는지 확인합니다." /></td>
<td><code>lsp-setup</code><br /><sub><code>lsp-setup &lt;language&gt;</code></sub></td>
<td>사용하는 언어의 언어 서버를 설치하고, 진단이 실제로 도는지 확인합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lsp.webp" width="240" alt="요청할 때 Hermes 언어 서버로 진단, 참조, 이름 바꾸기 안전성을 확인합니다." /></td>
<td><code>lsp</code><br /><sub><code>lsp &lt;request&gt;</code></sub></td>
<td>요청할 때 Hermes 언어 서버로 진단, 참조, 이름 바꾸기 안전성을 확인합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/rules.webp" width="240" alt="Hermes가 어떤 규칙 파일을 언제 읽는지 설명합니다." /></td>
<td><code>rules</code><br /><sub><code>rules &lt;question&gt;</code></sub></td>
<td>Hermes가 어떤 규칙 파일을 언제 읽는지 설명합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/comment-checker.webp" width="240" alt="수정으로 추가된 주석을 검토합니다. 이유는 남기고, 되풀이하는 주석은 뺍니다. 소스 파일을 고친 뒤에도 알아서 돕니다." /></td>
<td><code>comment-checker</code><br /><sub><code>comment-checker</code></sub></td>
<td>수정으로 추가된 주석을 검토합니다. 이유는 남기고, 되풀이하는 주석은 뺍니다. 소스 파일을 고친 뒤에도 알아서 돕니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/autoresearch.webp" width="240" alt="승인된 예산 안에서 실험을 반복합니다. 한 번에 하나만 바꾸고, 결과에 따라 남기거나 되돌립니다." /></td>
<td><code>autoresearch</code><br /><sub><code>autoresearch &lt;mode&gt;</code></sub></td>
<td>승인된 예산 안에서 실험을 반복합니다. 한 번에 하나만 바꾸고, 결과에 따라 남기거나 되돌립니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/autoconference.webp" width="240" alt="예산을 정한 연구 회의입니다. 연구자와 리뷰어가 따로 일하고, 종합에는 반대 의견도 남깁니다." /></td>
<td><code>autoconference</code><br /><sub><code>autoconference &lt;mode&gt;</code></sub></td>
<td>예산을 정한 연구 회의입니다. 연구자와 리뷰어가 따로 일하고, 종합에는 반대 의견도 남깁니다.</td>
</tr>
</table>

## 명령

| 입력 | 하는 일 |
|---|---|
| `lit <요청>` 또는 `/lit` | 범위를 정한 작업을 시작하고 확인 결과를 남깁니다. |
| `handoff` 또는 `/lit-handoff` | 현재 작업과 다음 할 일을 다음 세션으로 넘깁니다. |
| `lit-plan` 또는 `/lit-plan` | 실행 전에 계획을 작성합니다. |
| `/start-work <승인된 계획>` | 승인한 계획을 실행합니다. |
| `/review-work [plan\|work]` | 계획이나 끝난 작업을 검토하고 발견 사항을 남깁니다. |
| `lit review [plan\|work] <대상>` | `start-work` 전에는 계획을, 끝난 뒤에는 작업을 검토합니다. |
| `lit brainstorm <요청>`, `lit ideation <요청>`, `lit idea <요청>` | 아이디어 세션을 엽니다. 선택지를 많이 내고, 짧은 목록으로 좁혀 고르게 합니다. |
| `litresearch` 또는 `lit research <질문>` | 출처 메모가 있는 조사 흐름을 사용합니다. |
| `/lit-loop` | 명시적 반복 작업을 시작하고 확인하고, 다시 잇거나 끝냅니다. |
| `/litgoal` | 결승선을 정하고 지킵니다. 기준과 근거, 체크포인트와 막힌 지점을 추적합니다. |
| `/lit-humanizer` | 의미를 지키며 한국어·영어 문장을 다듬습니다. 이전 별칭은 `/lit-korean`, `/text-naturalization`, `/text-neutralization`, `/korean-ai-slop-remover`입니다. |
| `/lit-diagram-drawer <brief>` | 설치된 Python 도구로 내용과 기하 구조를 검사하며 접근성·한국어를 고려한 다이어그램을 만듭니다. |
| `/lit-pptx <brief>` | 번들된 AZURE-PRO 엔진으로 발표자료를 만들고 검사합니다. |
| `/lit-docx <brief>` | 출판 프로필을 적용해 Word 문서를 만들고 편집·검토합니다. |
| `/lit-typographic-motion <brief>` | 트리트먼트에서 출발해 스테이지 또는 타입 경로로 원본 영상을 연출하고 검사합니다. |

Telegram gateway에서는 `/lit_loop`와 `/lit_plan` 별칭을 씁니다. 전체 명령 예시와 훅 동작은 [운영 안내](./guide.ko.md)에 있습니다. 명령 뒤에 확인 줄이 뜨면 작업이 시작된 것입니다. 결과를 믿고 쓰기 전에는 화면 확인까지 포함해 직접 살펴보세요.

## 코드 밖의 결과물

### 보고서와 발표자료

보고서나 발표자료를 요청하면서 단독 `lit`을 붙이면, LitHermes가 함께 들어 있는 Word·PowerPoint 스킬에 일을 넘깁니다. 요청에 따라 DOCX나 PPTX, 또는 둘 다 나오고, 파일마다 Markdown 원본이 옆에 남습니다.

스킬은 무엇을 쓰기 전에 결과물이 어떤 모습이어야 할지부터 정하고 알려 줍니다. 책상에서 읽는 분기 실적 보고라면 표가 많고 글자가 차분해야 합니다. 화면에 띄우는 투자 제안이라면 한 장에 생각 하나가 맞고, 강의라면 단계가 차례대로 보여야 합니다. 그래서 답변은 짧은 방향 카드로 시작합니다. 고른 디자인과 그 이유, 그리고 그다음으로 어울리는 후보 둘이 적혀 있습니다. 단독 `lit` 요청이라면 스타일을 따로 묻지 않습니다. 후보 가운데 다른 쪽이 좋으면 이름만 말하면 다시 만듭니다.

발표자료의 디자인 방향은 Ledger, Signal, Atlas, Chalk, Paper, Gazette, Studio, Night 여덟 가지입니다. 방향마다 색, 제목 자리, 슬라이드 배치, 표지·간지·마무리 장이 따로 있어서 같은 메모로 만들어도 덱마다 생김새가 달라집니다. 슬라이드는 기본적으로 정보를 빽빽하게 담고 Pretendard로 짭니다. 제목은 그 장의 주제를 이름으로 달고 주장은 본문에 둡니다. 숫자는 항목 이름, 기준, 출처와 함께 두고 제목보다 크게 키우지 않습니다.

문서는 Report, Brief, Manual, Proposal, Memo, Journal 여섯 가지입니다. 이 여섯을 가르는 것은 구조입니다. 메모는 표지 없이 수신·발신 줄로 시작하고, 개조식 보고는 결론을 번호 붙은 요점으로 먼저 내놓습니다. 제안서는 글자만으로 짠 표지와 결정 요청 상자 하나, 예산표를 갖추고, 한국어 보고서는 번호 붙은 장으로 이어지는 연구원 보고서처럼 읽힙니다. 페이지는 잘 만든 인쇄 보고서처럼 절제합니다. 제목은 먹색으로 두고 강조색은 많아야 하나만 쓰며, 표는 칠하지 않고 가로줄로만 나눕니다. `<표 1>` 표 제목, 단위 줄, 2026. 10. 5. 같은 날짜 표기처럼 한국어 문서 관례도 지킵니다. 학술지 프로필(Elsevier, ACS, IEEE, Nature, korean-generic)을 지정하면 그 프로필을 씁니다.

두 스킬 중 하나를 처음 쓸 때는 Office 런타임이 필요한 도구를 고정된 버전으로 LitHermes 캐시에 설치합니다. 만든 뒤에는 완성된 파일을 검사합니다. 발표자료는 제목과 배치가 고루 섞였는지, 반쯤 빈 슬라이드가 없는지를 봅니다. 문서는 렌더링한 페이지에서 채움, 쪼개진 표, 페이지 끝에 홀로 남은 제목, 절제 규칙을 확인합니다. 스킬을 바로 부르려면 `/lit-docx <brief>`나 `/lit-pptx <brief>`를 입력하세요.

설치된 스킬 ID는 `lit-pptx`와 `lit-docx`이고, Hermes 목록에는 `lithermes:lit-pptx`와 `lithermes:lit-docx`로 나옵니다.

### 다이어그램

개념도나 기술 다이어그램이 필요하면 `lit-diagram-drawer`를 쓰세요. Hermes 목록에는 `lithermes:lit-diagram-drawer`로 나옵니다. 다이어그램을 부탁하면서 앞이나 뒤에 단독 `lit`만 붙여도 LitHermes가 이 스킬을 고르고, 설치된 진입 파일이 어디 있는지 Hermes에 알려 줍니다. 제품 화면은 `frontend-ui-ux`, 측정한 과학 데이터 그래프는 `lit-scientific-visualization`이 맡습니다.

### 영상

`lit-typographic-motion`은 `lithermes:lit-typographic-motion`과 `/lit-typographic-motion <brief>`로 쓸 수 있습니다. 영상 요청에 단독 `lit`을 붙이면 감독처럼 먼저 트리트먼트를 씁니다. 그다음 그림과 도형이 필요한 영상은 스테이지 경로(모델이 작성한 HTML 페이지를 프레임 단위로 캡처)로, 글자 자체가 영상일 때는 자체 WebGL2 타입 엔진으로 렌더합니다. 기본으로 생성 사운드 베드를 넣고, 생성한 소리라고 표시합니다.

영상을 만들려면 컴퓨터에 Chrome과 ffmpeg가 있어야 하고, 버전을 고정한 보조 패키지와 폰트도 몇 가지 필요합니다. 렌더링은 스스로 아무것도 내려받지 않기 때문에, 보조 패키지와 폰트는 영상을 만들기 전에 로컬 캐시에 들어 있어야 합니다. `lithermes install`이 설치하면서 이 캐시를 채워 보고, `--offline` 등으로 건너뛰었거나 끝내지 못했으면 그 사실을 한 줄로 알려 줍니다. 그럴 때는 렌더 세션 밖에서 `lithermes motion-runtime install`을 실행해 나중에 채우면 됩니다.

지금 상태가 궁금하면 `lithermes motion-runtime status`를 실행하세요. Chrome, ffmpeg, WebGL2, 소프트웨어 렌더링으로 내려갔는지 여부, 고정 폰트 상태를 보여 줍니다. 마지막 검사를 통과하면 60fps 영상(1920×1080, 스테이지 경로는 1080×1920도 가능), 미리보기, 포스터, 움직임 축소용 정지 이미지, 수치 검사 보고서를 받습니다. 타이포그래피 모션 엔진은 mexicat/pdoom-video (MIT, Giacomo Magnanini), 커밋 `ca251e3`에서 각색했습니다.

README 커버는 영상과 다른 일이라서 따로 다룹니다. README, 히어로, 배너 루프를 요청하면 영상의 비트와 사운드, 엔드 카드를 건너뜁니다. 대신 멈추지 않고 움직이면서 시작점이 보이지 않는 그림 한 장을 만듭니다. 기본은 그림 위로 빛이 지나가는 방식이고, 글자가 움직이는 방식과 작은 궤도 시스템도 있습니다. 렌더러는 이 루프를 2 MiB 이하의 애니메이션 WebP로 인코딩한 뒤 그 파일을 다시 디코딩해서 검사합니다. 손실 인코더가 인코딩 전에는 멀쩡해 보이던 느린 페이드를 조용히 지워 버리기 때문입니다. 넘기기 전에 0.5초마다 무언가 움직이는지, 이음매가 보이지 않는지, README 폭에서도 제목이 읽히는지, 바탕 그림이 첫 프레임에 그대로 보이는지 확인합니다. 커버에는 libwebp의 img2webp와 dwebp가 필요하고(없으면 gifski로 대신합니다), `lithermes motion-runtime status`가 이 도구도 함께 보여 줍니다.

### 화면과 README

`frontend-ui-ux`는 요청한 화면을 만들되, 먼저 중요한 디자인 선택을 물어보고 정합니다. 검토나 계획만 부탁하면 읽고 보고할 뿐 파일은 고치지 않습니다. `readme-studio`(Hermes 목록에서는 `lithermes:readme-studio`)는 사실에 맞는 README와, 내 컴퓨터에서 만든 표지를 함께 만듭니다. 표지에는 Pretendard/Meslo 윤곽 글자와 편집 가능한 소스가 들어가고, 검증할 수 있으면 모션도 붙습니다. Hermes에 기본 이미지 생성기가 없으면 `IMAGE_GENERATION_UNAVAILABLE`로 알려 주고, 직접 건넨 이미지는 그래도 합성할 수 있습니다. 두 스킬 모두 로그인, 전역 설치, 배포는 하지 않습니다.

### 글 다듬기

`lit-humanizer` 스킬은 `lithermes:lit-humanizer`로 쓸 수 있습니다. 사실과 의도를 지키면서 한국어와 영어 초안을 다듬습니다.

이 스킬에는 Hermes가 사람이 읽을 글을 쓸 때 옆에서 살피는 감지기가 딸려 있습니다. Hermes가 `write_file`이나 `patch`로 글을 저장하면, 감지기가 바뀐 부분을 먼저 읽습니다. SVG를 포함해 지원하는 형식이면 모두 해당됩니다. 심각한 문제(차단 등급)가 보이면 파일이 저장되기 전에 쓰기를 멈출 수 있고, 가벼운 문제(주의 등급)는 검토해 볼 의견으로 돌려줍니다.

Office 파일과 PDF는 만들어진 뒤에 검사합니다. DOCX나 PPTX는 파일 쓰기 이벤트나 스크립트 결과에 저장 경로가 나오면 그때 읽습니다. PDF도 같은 방식이지만 `pdftotext`가 설치되어 있어야 읽을 수 있습니다. 이때는 파일이 이미 저장된 뒤라 막지는 못하고, Hermes에 원본을 고쳐 다시 만들라고 알려 줍니다. 감지기는 어느 경우든 표현만 살펴보고, 누가 쓴 글인지는 알 방법이 없습니다.
