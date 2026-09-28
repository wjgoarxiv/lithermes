<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitHermes 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/ascii-readme.svg" width="480" alt="LIT ASCII B 마크" /></p>

<p align="center">
<a href="#설치"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/badge-version.svg" alt="1.0.11" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/lucide-book-open.svg" width="16" alt="" /> 안내</a> &nbsp;
<a href="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition 영상</a> &nbsp;
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitHermes

**Keep the work lit.**

**Hermes Agent**용 플러그인입니다. 요청에 `lit`을 붙이면 Hermes가 작업을 계획하고, 실행하고, 확인한 뒤 다음 세션이 이어받을 기록을 남깁니다.

**[전체 안내, 스킬 갤러리, A/B 결과는 GitHub에서](https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md)** · [English](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/README.md)

## 설치

Hermes Agent와 Node.js 18 이상, 그리고 Hermes 홈(기본 `~/.hermes`)에 쓸 권한이 필요합니다.

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

첫 번째 `--yes`는 npx가 패키지를 실행하도록, 두 번째는 Hermes 설정 변경을 승인합니다. `--no-style`은 답변 문체 선택만 건너뛰고 Ignition 스킨은 그대로 둡니다. 설치 중에 Telegram에 연결하지 않습니다.

평소 환경과 떼어 놓고 써 보려면 설치 전에 `HERMES_HOME`을 새 빈 디렉터리로 지정하고, Hermes를 시작할 때도 같은 값을 쓰세요. `--no-patch-installed-hermes`를 붙이면 그 프로필 밖의 Hermes 설치본에도 호환성 패치를 적용하지 않습니다.

## 첫 작업

Hermes CLI 또는 gateway를 다시 시작한 뒤 이렇게 입력해 보세요.

```text
lit 외부 의존성 없이 HTML 파일 하나로 할 일 목록을 만들어줘. 추가·완료·삭제를 구현하고 확인한 내용과 다음 행동을 남겨줘.
```

응답은 다른 내용보다 먼저 `🔥 **LIT IGNITED · <discipline>** 🔥` 한 줄을 정확히 한 번 표시하므로, 경로가 잡혔는지 바로 알 수 있습니다. 작업이 끝나면 파일을 직접 열어 각 동작을 눌러 보고, 실제로 확인한 내용과 아직 확인하지 못한 내용을 나눠 달라고 Hermes에 요청하세요. 그다음 `/lit-handoff`를 실행하세요. 같은 프로젝트의 새 세션은 그 인계 기록을 읽고 이어갈 수 있습니다.

불씨는 남겨 둔 기록을 뜻합니다. 세션이 끝난 뒤에도 작업이 계속 돌아간다는 뜻은 아닙니다.

## 자주 쓰는 경로

| 입력 | 스킬 | 용도 |
|---|---|---|
| `lit <요청>` 또는 `/lit` | `litwork` | 범위를 정한 작업을 확인 결과까지 |
| `lit-plan` 또는 `/lit-plan` | `lit-plan` | 아무것도 고치기 전에 계획부터 |
| `/start-work <승인된 계획>` | `start-work` | 승인한 계획 실행 |
| `lit review <대상>` 또는 `/review-work` | `review-work` | 계획이나 결과 검토 |
| `lit research <질문>` | `litresearch` | 출처 메모가 있는 조사 |
| `handoff` 또는 `/lit-handoff` | `lit-handoff` | 다음 세션으로 작업 넘기기 |
| `/lit-humanizer` | `lit-humanizer` | 의미를 지키며 한국어·영어 문장 다듬기 |
| `/lit-diagram-drawer <brief>` | `lit-diagram-drawer` | 검사를 거친, 편집 가능한 다이어그램 |
| `/lit-pptx <brief>` | `lit-pptx` | Markdown 원본이 딸린 PowerPoint 발표자료 |
| `/lit-docx <brief>` | `lit-docx` | Markdown 원본이 딸린 Word 보고서 |
| `/lit-typographic-motion <brief>` | `lit-typographic-motion` | 트리트먼트부터 쓰는 짧은 영상 |

Telegram gateway에서는 `/lit_loop`와 `/lit_plan`을 쓰세요. 모든 스킬은 `lithermes:<이름>`으로도 불러올 수 있습니다. 예를 들어 `lithermes:lit-pptx`, `lithermes:lit-docx`처럼 씁니다. 그 밖에 번들된 스킬은 `litgoal`, `lit-recap`, `deep-interview`, `lit-crucible`, `lit-init`, `lit-comprehend`, `frontend-ui-ux`, `readme-studio`, `lit-scientific-visualization`, `visual-qa`, `browser-drive`, `structural-search`, `wikify`, `debugging`, `refactor`, `lit-burnoff`, `lit-burnoff-file`, `lit-code`, `lit-commit`, `lsp-setup`, `lsp`, `rules`, `comment-checker`, `autoresearch`, `autoconference`입니다. GitHub 페이지에서 스킬마다 그림과 함께 볼 수 있습니다.

## 코드 밖의 결과물

- **보고서와 발표자료.** 보고서나 발표자료 요청에 단독 `lit`을 붙이면 `lit-docx`나 `lit-pptx`로 넘어갑니다. DOCX, PPTX 또는 둘 다 만들고 Markdown 원본을 옆에 둡니다. 한국어 문서는 korean-generic 프로필, 발표자료는 AZURE-PRO·Pretendard가 기본이며, 직접 고르면 그 설정이 우선합니다. Office 런타임은 처음 쓸 때 고정된 의존성을 LitHermes 캐시에 설치합니다.
- **다이어그램.** `lit-diagram-drawer`가 개념도와 기술 다이어그램을 만듭니다. 제품 화면은 `frontend-ui-ux`, 측정한 데이터 그래프는 `lit-scientific-visualization`이 맡습니다.
- **영상.** `lit-typographic-motion`은 트리트먼트부터 쓰고, QA를 통과하면 포스터·움직임 축소용 정지 이미지·검사 보고서가 딸린 60fps 영상을 냅니다. `lithermes motion-runtime status`로 Chrome·ffmpeg·WebGL2·폰트 상태를 확인하고, `lithermes motion-runtime install`로 의존성을 미리 받아 둘 수 있습니다.
- **글 다듬기.** `lit-humanizer`는 사실을 지키며 한국어와 영어 초안을 다듬습니다. 감지기는 Hermes `write_file`과 `patch`로 쓰는 독자용 텍스트를 검사해, 차단 등급 발견이 있으면 쓰기를 막을 수 있고 주의 등급은 조언으로 전합니다.

## 설치 후 달라지는 것

- 플러그인이 Hermes 홈에 들어갑니다. 다시 시작하면 Hermes에 훅, 명령, 스킬, `goal_*` 작업 도구가 생깁니다.
- 목표·계획·근거는 프로젝트의 `.hermes/lithermes/` 아래 로컬 기록으로 남고, 다음 세션이 이 기록을 읽을 수 있습니다.
- Hermes CLI에 Ignition 스킨이 생깁니다. `/skin lithermes-ignition`을 고르고 다시 시작하세요. 밝은 터미널에는 `/skin lithermes-tokyonight-day`, 어두운 터미널에는 `/skin lithermes-tokyonight`가 맞습니다. 색상을 지원하는 대화형 환경에서 `--yes`로 처음 설치하면 `display.skin`이 비어 있을 때만 Ignition을 고르고, 기존 스킨 파일은 보존합니다.
- 업데이트 안내는 캐시만 쓰며, 따를지는 직접 정합니다. 확인은 `update-check.json`을 통해 24시간에 한 번까지만 하고, `--offline`, `--json`, `--dry-run`, CI, 파이프 출력에서는 업데이트를 설치하지 않습니다. 안내에는 `npx --yes --package @litfamily/lithermes@<version> -- lithermes install --yes --no-hud` 명령이 나옵니다. `NO_UPDATE_NOTIFIER=1` 또는 `LITHERMES_NO_UPDATE_CHECK=1`로 확인을 끌 수 있습니다.
- 요청 경로는 LitHermes가 안내하고, 모델 실행은 여전히 Hermes Agent가 맡습니다.

## 정말 도움이 되나요?

가볍게 쓴 한국어 한 줄 요청 10개를 각각 원문 그대로 한 번, 끝에 ` lit`을 붙여 한 번, 이렇게 두 번씩 Hermes Agent v0.21.3, `gpt-6-sol`, 추론 `high`로 실행했습니다. 블라인드 판정자가 두 결과를 순서를 바꿔 비교했고, 최종 판정은 메인테이너가 내렸습니다.

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

판정자는 S1과 S8에서 기준선을 골랐습니다. 양쪽이 만든 결과물과 스크린샷, 그리고 각 작업이 어느 라운드에서 나왔는지는 GitHub에서 확인할 수 있습니다. 맨 위 모션 표지는 LitFamily 모션 스킬로 만들었습니다. 이 스킬(여기서는 `lit-typographic-motion`)은 첫 A/B 이후 다시 만들어졌고, 아직 A/B 결과가 없습니다.

## 선택 기능: Jev 스킬 힌트

기본값은 꺼짐입니다. Hermes가 실행되는 환경에 `LITHERMES_JEV=1`과 본인의 `TYPESAFE_API_KEY`를 설정하면, LitHermes가 TypeSafe의 호스팅 결정 모델 Jev에게 평범한 프롬프트에 맞는 번들 스킬을 묻습니다. 답은 그 턴의 컨텍스트에 조언 한 줄로 들어갑니다. 스킬을 불러올지는 여전히 Hermes 모델이 정하며, 힌트는 권한을 주거나 도구를 실행하지 않습니다.

켜 두면 조건에 맞는 프롬프트마다 2,000자로 자르고 홈 경로, 이메일 주소, 토큰 형태의 문자열을 가린 뒤 TypeSafe(typesafe.ai)로 보냅니다. 토큰 형태가 아닌 내용, 예를 들어 호스트 이름, 고객 이름, `password=...` 형식이 아닌 비밀번호는 쓴 그대로 전송됩니다. 게이트웨이 모드에서는 대화방의 다른 참여자가 보낸 메시지도 전송 대상입니다. export한 키는 에이전트의 도구도 읽을 수 있으니, 이 기능 전용 키를 쓰고 사용 한도를 낮게 잡으세요. 비용은 TypeSafe가 본인 계정에 청구하며 입력 토큰 100만 개당 약 0.04달러입니다. 요청은 1.5초가 지나면 재시도 없이 멈추고, 실패해도 턴은 그대로 진행됩니다.

켜져 있으면 세션의 첫 답변이 `✦ Jev skill hint ON`으로 시작합니다. Hermes 세션 안에서 `hermes lithermes status`와 `hermes lithermes doctor`를 실행하면 그 세션의 마지막 힌트가 `Jev skill hint: on — last hint lit-humanizer (0.43s)`나 `on — no hint yet`처럼 표시됩니다. 세션 밖에서는 `on — no session`, 그 밖에는 `off` 또는 `flag on but TYPESAFE_API_KEY missing`이 나옵니다. 끄려면 `LITHERMES_JEV`를 해제하거나 `1`이 아닌 값으로 바꾸세요. 자세한 내용은 GitHub README와 [개인정보 안내](https://github.com/wjgoarxiv/lithermes/blob/main/docs/privacy.md)에 있습니다.

## 확인, 삭제, 안전

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

호환성 패치를 적용했다면 삭제할 때 `--rollback-patches`를 추가하세요. 삭제한 뒤에도 스킨 파일과 `display.skin`은 남습니다. `npx --package @litfamily/lithermes -- lithermes hud off`로 선택만 지우고 파일은 그대로 둘 수 있습니다.

- `lithermes install --dry-run`으로 설정 변경을 미리 볼 수 있습니다. 코드·인용문·복사한 명령은 실행 지시로 다루지 않으며, 비밀값은 저장하거나 모델에 넘기기 전에 가립니다.
- native `/goal`은 사용자가 관리하며 플러그인은 관찰하지 않습니다. durable `goal_*` 상태가 기준이며, native `/goal`을 자동으로 갱신·초기화·재개하지 않습니다.
- Hermes 하위 모델은 공통 모델 경로 하나를 씁니다. 작업별 모델 재정의와 지정 reviewer 경로는 지원하지 않으며, 설정 receipt가 child가 실제로 어떤 경로로 실행됐는지 증명하지는 않습니다.
- Lit 스킬이 보이지 않으면 Hermes에 `skills_list` 도구를 호출해 LitHermes 항목을 찾아 달라고 하세요. 파일시스템만 조회하는 `/skills` 목록은 호스트 버전에 따라 다를 수 있습니다. Hermes 로그의 import 오류는 플러그인 로딩 실패이지, 추측으로 pip 패키지를 설치하라는 뜻이 아닙니다.
- 다른 곳의 같은 이름 스킬이 LitHermes 스킬을 가리면 `lithermes doctor`가 `skill shadow check: WARNING` 줄을 출력합니다. `lithermes:<name>`으로 명시해 불러오세요. 이 경고는 doctor의 종료 상태를 바꾸지 않습니다.

## 더 알아보기

- [GitHub의 전체 README](https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md): 스킬 갤러리, 스크린샷이 있는 A/B 결과, 작동 방식
- [운영 안내](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md): 명령, 모델, 스킨, 문제 해결
- [변경 기록](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md) · [기여](https://github.com/wjgoarxiv/lithermes/blob/main/CONTRIBUTING.md) · [보안](https://github.com/wjgoarxiv/lithermes/blob/main/SECURITY.md) · [지원](https://github.com/wjgoarxiv/lithermes/blob/main/SUPPORT.md)

MIT License.
