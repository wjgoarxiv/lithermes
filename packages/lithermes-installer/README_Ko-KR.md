<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/readme-assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitHermes 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/readme-assets/ascii-readme.svg" width="480" alt="LIT ASCII B 마크" /></p>

<p align="center">
<a href="#설치"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/readme-assets/badge-version.svg" alt="1.0.15" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/readme-assets/lucide-book-open.svg" width="16" alt="" /> 안내</a> &nbsp;
<a href="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/readme-assets/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition 영상</a> &nbsp;
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitHermes

**Keep the work lit.**

**Hermes Agent**용 플러그인입니다. 요청에 `lit`을 붙이면 Hermes가 작업을 계획하고, 실행하고, 확인한 뒤 다음 세션이 이어받을 기록을 남깁니다.

**[전체 안내와 스킬 갤러리는 GitHub에서](https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md)** · [English](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.15/README.md)

## 설치

Hermes Agent와 Node.js 18 이상, 그리고 Hermes 홈(기본 `~/.hermes`)에 쓸 권한이 필요합니다.

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

이 명령은 플러그인을 Hermes 홈에 넣고 Hermes 설정을 고치는데, 중간에 묻느라 멈추지 않습니다. 그래서 `--yes`가 두 번 들어갑니다. 앞의 것은 npx가 패키지를 실행하도록 허락하고, 뒤의 것은 설정 변경을 승인합니다. `--no-style`은 답변 문체를 고르는 화면을 건너뜁니다. Ignition 스킨은 어느 쪽이든 설치됩니다. 설치하는 동안 Telegram에는 연결하지 않습니다.

평소 환경과 떼어 놓고 먼저 써 보고 싶다면, 설치 전에 `HERMES_HOME`을 비어 있는 새 디렉터리로 지정하고 Hermes를 시작할 때도 같은 값을 쓰세요. Hermes 설치본 자체가 그 시험용 프로필 밖에 있다면 `--no-patch-installed-hermes`를 붙이세요. 설치 프로그램이 그 설치본에는 호환성 수정을 하지 않습니다.

## 첫 작업

Hermes CLI 또는 gateway를 다시 시작한 뒤 이렇게 입력해 보세요.

```text
lit 외부 의존성 없이 HTML 파일 하나로 할 일 목록을 만들어줘. 추가·완료·삭제를 구현하고 확인한 내용과 다음 행동을 남겨줘.
```

응답 첫 줄에 `🔥 **LIT IGNITED · <discipline>** 🔥`가 한 번 나옵니다. 이 줄이 보이면 LitHermes가 요청을 받아 작업을 시작한 것입니다. 작업이 끝나면 파일을 직접 열어 각 동작을 눌러 보고, 실제로 확인한 내용과 아직 확인하지 못한 내용을 나눠 달라고 Hermes에 요청하세요. 그다음 `/lit-handoff`를 실행하세요. 같은 프로젝트의 새 세션은 그 인계 기록을 읽고 이어갈 수 있습니다.

불씨란 이렇게 남겨 둔 기록입니다. 세션을 닫으면 뒤에서 따로 돌아가는 작업은 없고, 다음 세션이 인계 기록을 읽고 이어받습니다.

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

- **보고서와 발표자료.** 보고서나 발표자료를 부탁하면서 단독 `lit`을 붙이면 `lit-docx`나 `lit-pptx`가 맡습니다. DOCX나 PPTX, 또는 둘 다 나오고 Markdown 원본이 옆에 남습니다. 따로 고르지 않으면 한국어 문서는 korean-generic 프로필을, 발표자료는 AZURE-PRO와 Pretendard를 씁니다. 처음 쓸 때는 Office 런타임이 필요한 도구를 고정된 버전으로 LitHermes 캐시에 설치합니다.
- **다이어그램.** `lit-diagram-drawer`가 개념도와 기술 다이어그램을 그립니다. 제품 화면은 `frontend-ui-ux`, 측정한 데이터 그래프는 `lit-scientific-visualization`이 맡습니다.
- **영상.** `lit-typographic-motion`은 트리트먼트부터 씁니다. 마지막 검사를 통과하면 포스터, 움직임 축소용 정지 이미지, 검사 보고서가 딸린 60fps 영상이 나옵니다. 렌더링 중에는 아무것도 내려받지 않으므로 보조 패키지와 폰트가 미리 캐시에 있어야 합니다. `lithermes install`이 이것을 받아 두려고 시도하고, 건너뛰었거나 실패했다면 `lithermes motion-runtime install`을 실행하면 됩니다. Chrome, ffmpeg, WebGL2, 폰트가 준비됐는지는 `lithermes motion-runtime status`로 볼 수 있습니다.
- **글 다듬기.** `lit-humanizer`는 사실을 지키며 한국어와 영어 초안을 다듬습니다. 감지기는 Hermes가 `write_file`과 `patch`로 쓰는, 사람이 읽을 글을 살핍니다. 심각한 문제(차단 등급)가 보이면 쓰기를 멈출 수 있고, 가벼운 문제(주의 등급)는 조언으로 돌려줍니다.

## 설치 후 달라지는 것

- 플러그인이 Hermes 홈에 들어갑니다. 다시 시작하면 Hermes에 훅, 명령, 스킬, `goal_*` 작업 도구가 생깁니다.
- 목표·계획·근거는 프로젝트의 `.hermes/lithermes/` 아래 로컬 기록으로 남고, 다음 세션이 이 기록을 읽을 수 있습니다.
- Hermes CLI에 Ignition 스킨이 생깁니다. `/skin lithermes-ignition`을 고르고 다시 시작하세요. 밝은 터미널에는 `/skin lithermes-tokyonight-day`, 어두운 터미널에는 `/skin lithermes-tokyonight`가 맞습니다. 색상을 지원하는 대화형 환경에서 `--yes`로 처음 설치하면 설정에 `display.skin` 항목이 아예 없을 때만 Ignition을 고르고, 기존 스킨 파일은 보존합니다.
- LitHermes는 스스로, 그리고 조심스럽게 업데이트합니다. 터미널에서 `lithermes install`, `check`, `doctor`를 실행하거나 대화형 Hermes CLI 세션에서 첫 메시지를 보내면 npm 레지스트리에 최신 안정 버전을 물어봅니다. 더 새로운 버전이 있으면 플러그인 폴더, `config.yaml`, 설치 기록, 스킨 폴더를 백업한 뒤 설치하고 `doctor --offline`을 실행합니다. 설치가 실패하거나 30초를 넘기거나 이 점검을 통과하지 못하면 백업을 복원해서 쓰던 버전이 남습니다. 새 버전을 불러오려면 Hermes를 다시 시작하세요.
- 업데이트할 때마다 `<Hermes 홈>/lithermes/`에 `auto-update-journal.json`과 `auto-update-receipt.json`이 남아서 무슨 일이 있었는지 볼 수 있습니다. `--offline`, `--json`, `--dry-run`을 붙였거나 CI에서 돌거나 출력을 파이프로 넘기면 업데이트를 건너뜁니다.
- 이와는 따로, LitHermes는 새 버전이 나왔는지 백그라운드에서 24시간에 한 번까지만 확인해 그 결과를 `update-check.json`에 저장해 둡니다. 안내할 때는 이 파일을 읽고, 안내에는 `npx --yes --package @litfamily/lithermes@<version> -- lithermes install --yes --no-hud` 같은 명령이 나옵니다. 실행할지는 직접 정하면 됩니다.
- 새 버전은 직접 설치하되 안내는 계속 받고 싶다면 `LITHERMES_NO_AUTO_UPDATE=1`을 설정하세요.
- 명령 한 번만 건너뛰려면 `install`, `check`, `doctor`에 `--no-auto-update`를 붙이세요.
- 버전 확인을 모두 멈추려면 `NO_UPDATE_NOTIFIER=1` 또는 `LITHERMES_NO_UPDATE_CHECK=1`을 설정하세요. 이 변수들은 어떤 값이든 똑같이 적용됩니다. 업데이트 과정의 자세한 설명은 GitHub 문서에 있습니다.
- 요청을 어디로 보낼지는 LitHermes가 정하고, 모델은 여전히 Hermes Agent가 돌립니다.

## 자동 핸드오프

기본값은 꺼짐이고, 퍼센트는 직접 고릅니다. `/lit-handoff auto on 60`(1에서 99 사이의 정수)을 실행하면, 모델 호출 하나가 컨텍스트 창의 60%를 넘은 뒤 첫 메시지에서 LitHermes가 모델에게 핸드오프를 요청하고 `/compact`를 실행하라고 알려 줍니다. Hermes에서는 플러그인이 압축을 시작할 수 없으므로, 사용자가 직접 실행하거나 Hermes가 자체 기준으로 압축합니다. 압축 뒤에는 핸드오프가 짧은 요약으로 돌아옵니다. `/lit-handoff auto off`와 `/lit-handoff auto status`는 이름 그대로 동작하고, 환경에서는 `LITHERMES_AUTO_HANDOFF=1`과 `LITHERMES_AUTO_HANDOFF_PERCENT`로 설정합니다. 어느 단계가 자동이고 Hermes 자체 압축과 겹치지 않는 퍼센트를 어떻게 고르는지는 [GitHub README](https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md#자동-핸드오프)에 있습니다.

## 선택 기능: Jev 스킬 힌트

기본값은 꺼짐입니다. Hermes가 실행되는 환경에 `LITHERMES_JEV=1`과 본인의 `TYPESAFE_API_KEY`를 설정하면, LitHermes가 TypeSafe의 호스팅 결정 모델 Jev에게 평범한 프롬프트에 맞는 번들 스킬을 묻습니다. 답은 그 턴의 컨텍스트에 조언 한 줄로 붙습니다. 어디까지나 제안이라, 스킬을 불러올지는 여전히 Hermes 모델이 정하고 힌트로 권한을 주거나 도구를 실행할 수는 없습니다.

켜 두면 조건에 맞는 프롬프트마다 2,000자로 자르고 홈 경로, 이메일 주소, 토큰 형태의 문자열을 가린 뒤 TypeSafe(typesafe.ai)로 보냅니다. 다만 호스트 이름이나 고객 이름처럼 토큰 형태가 아닌 내용과 `password=...` 형식이 아닌 비밀번호는 가려지지 않고 쓴 그대로 전송됩니다. 게이트웨이 모드라면 대화방의 다른 참여자가 보낸 메시지도 전송 대상에 들어갑니다. export한 키는 에이전트의 도구도 읽을 수 있으니 이 기능 전용 키를 쓰고 사용 한도를 낮게 잡으세요. 비용은 TypeSafe가 본인 계정에 청구하며 입력 토큰 100만 개당 약 0.04달러입니다. 요청은 1.5초가 지나면 재시도 없이 멈추고, 실패해도 턴은 그대로 진행됩니다.

켜져 있으면 세션의 첫 답변이 `✦ Jev skill hint ON`으로 시작합니다. Hermes 세션 안에서 `hermes lithermes status`와 `hermes lithermes doctor`를 실행하면 그 세션의 마지막 힌트가 `Jev skill hint: on — last hint lit-humanizer (0.43s)`나 `on — no hint yet`처럼 표시됩니다. 세션 밖에서는 `on — no session`, 그 밖에는 `off` 또는 `flag on but TYPESAFE_API_KEY missing`이 나옵니다. 끄려면 `LITHERMES_JEV`를 해제하거나 `1`이 아닌 값으로 바꾸세요. 자세한 내용은 GitHub README와 [개인정보 안내](https://github.com/wjgoarxiv/lithermes/blob/main/docs/privacy.md)에 있습니다.

## 확인, 삭제, 안전

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

`doctor --offline`은 인터넷에 나가지 않고 설치 상태를 확인합니다. 설치 프로그램이 Hermes에 호환성 수정을 했다면 삭제할 때 `--rollback-patches`를 붙여 되돌리세요. 삭제해도 스킨 파일과 `display.skin` 선택은 남습니다. `npx --package @litfamily/lithermes -- lithermes hud off`를 실행하면 선택만 지우고 파일은 그대로 둡니다.

- 설치 프로그램이 무엇을 바꿀지 미리 보고 싶다면 `lithermes install --dry-run`을 실행하세요.
- 붙여 넣은 코드, 인용문, 명령은 읽을 글로 다루고, 지시로 따르지는 않습니다. 비밀값은 저장하거나 모델에 넘기기 전에 가립니다.
- Hermes에 원래 있는 `/goal`은 사용자가 직접 관리합니다. LitHermes는 이 기능을 건드리지 않고, 갱신하거나 지우거나 다시 이어 주지도 않습니다. `goal_*` 도구로 저장한 자기 목표를 기준으로 삼습니다.
- Hermes는 보조 작업을 모두 공통 모델 설정 하나로 보내므로, 작업마다 모델을 고르거나 리뷰 전용 모델을 둘 수 없습니다. 설치 보고서에는 설정한 값이 나오고, 실제로 쓰인 모델은 실제 `delegate_task` 실행 기록으로만 확인됩니다.
- Lit 스킬이 보이지 않으면 Hermes에 `skills_list` 도구를 불러 LitHermes 항목을 찾아 달라고 하세요. `/skills` 명령은 파일시스템만 읽어서 Hermes 버전에 따라 목록이 다를 수 있습니다. Hermes 로그의 import 오류는 플러그인을 불러오지 못했다는 뜻입니다. 짐작으로 pip 패키지를 설치하기보다 오류 메시지를 보관해 두세요.
- 다른 곳의 같은 이름 스킬이 LitHermes 스킬을 가리면 `lithermes doctor`가 `skill shadow check: WARNING` 줄을 출력합니다. `lithermes:<name>`으로 불러오세요. 이 경고가 doctor의 종료 상태를 바꾸지는 않습니다.

## 더 알아보기

- [GitHub의 전체 README](https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md): 스킬 갤러리와 작동 방식
- [운영 안내](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md): 명령, 모델, 스킨, 문제 해결
- [변경 기록](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md) · [기여](https://github.com/wjgoarxiv/lithermes/blob/main/CONTRIBUTING.md) · [보안](https://github.com/wjgoarxiv/lithermes/blob/main/SECURITY.md) · [지원](https://github.com/wjgoarxiv/lithermes/blob/main/SUPPORT.md)

MIT License.
