<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.47/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.47/readme-assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 일곱 로봇 패널이 차례로 켜지고, LitHermes 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center">
<a href="#설치"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.47/readme-assets/badge-version.svg" alt="1.0.47" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.47/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.47/readme-assets/lucide-book-open.svg" width="16" alt="" /> 안내</a> &nbsp;
<a href="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.47/readme-assets/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.47/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition 영상</a> &nbsp;
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.47/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitHermes

**Keep the work lit.**

LitHermes는 [Hermes Agent](https://github.com/NousResearch/hermes-agent)에 붙여 쓰는 추가 기능입니다. Hermes가 "다 됐어요"라고 말하기 전에 자기 작업을 직접 확인하게 하고, 다음 세션이 멈춘 자리에서 바로 시작하도록 기록을 남깁니다.

Hermes에게 기능 하나를 맡기면 코드를 쓰고 끝났다고 말합니다. 그런데 다음 날 보면 테스트는 한 번도 돌지 않았고, 새 세션을 열면 프로젝트 설명을 처음부터 다시 해야 합니다. LitHermes가 있으면 같은 요청에 `lit`만 붙이면 됩니다. Hermes는 이 작업에서 "끝났다"가 무슨 뜻인지부터 적고, 실패하는 테스트를 추가해 통과시킨 다음, 무엇을 확인했고 무엇은 확인하지 못했는지 알려 줍니다. 세션이 닫힐 때는 핸드오프 메모를 남기고, 같은 프로젝트의 다음 세션이 그 메모를 읽고 이어서 일합니다.

**[GitHub의 README와 문서](https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md)** · [English](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.47/README.md)

## 설치

Hermes Agent 0.21.3 이상과 Node.js 18 이상, 그리고 Hermes 홈(기본 `~/.hermes`)에 쓸 권한이 필요합니다.

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

이 명령은 플러그인을 Hermes 홈에 복사하고 켜 두며, 중간에 승인을 묻지 않습니다. `--no-style`은 답변 문체를 묻는 단계를 건너뜁니다. 따로 떼어 둔 프로필에서 먼저 써 보려면 설치 전에 `HERMES_HOME`을 빈 디렉터리로 지정하세요. 다른 옵션은 [설치 문서](https://github.com/wjgoarxiv/lithermes/blob/main/docs/install.ko.md)에 있습니다.

## 첫 작업

Hermes CLI 또는 gateway를 다시 시작한 뒤 이렇게 입력하세요.

```text
lit 외부 의존성 없이 HTML 파일 하나로 할 일 목록을 만들어줘. 추가·완료·삭제를 구현하고 확인한 내용과 다음 행동을 남겨줘.
```

응답 첫 줄에 `🔥 **LIT IGNITED · <discipline>** 🔥`가 나오면 lit 작업이 시작된 것입니다. 끝나면 파일을 직접 확인하고 `/lit-handoff`를 실행하세요. 같은 프로젝트의 다음 세션이 그 기록을 읽고 이어 갑니다. [자동 핸드오프](https://github.com/wjgoarxiv/lithermes/blob/main/docs/automatic-handoff.ko.md)는 기본값이 꺼짐이고, `/lit-handoff auto on 60`(1에서 99 사이의 정수)을 켜 두면 `/compact` 전에 인계 기록을 먼저 요청합니다.

### 두 가지 사용법

**간단하게.** 평소처럼 요청을 쓰고 앞이나 끝에 `lit`을 붙이세요. Hermes가 목표를 정하고, 실패하는 테스트를 쓰고, 코드를 고친 뒤 결과를 확인하고, 무엇을 확인했는지 알려 줍니다. `lit`은 앞에 붙이든 끝에 붙이든 똑같이 동작합니다. 끝에 붙이면 그 앞의 말이 목표가 되므로, 테스트 명령이 있는 프로젝트에서는 `로그인 버튼 고쳐줘 lit`도 `lit 로그인 버튼 고쳐줘`와 똑같이 목표 질문을 받습니다. `lit-loop`과 `litwork`도 끝에 붙일 수 있고, `lit continue`만 쓰면 새 목표를 묻지 않고 하던 일을 이어 갑니다. 대부분의 일은 이것으로 충분합니다.

```text
src/dates.py의 날짜 파싱 버그 고쳐줘 lit
```

**본격적으로.** 큰 작업은 한 단계씩 밟아 갑니다. 앞 단계의 결과를 다음 단계가 이어받고, 필요 없는 단계는 건너뛰어도 됩니다.

| 단계 | 입력 | 하는 일 |
| --- | --- | --- |
| 1. 넓게 보기 | `lit brainstorm <질문>` | 선택지를 넓게 펼친 뒤 장단점과 함께 몇 개로 추립니다 |
| 2. 구체화 | `/deep-interview <아이디어>` | 만들 수 있을 만큼 목표가 분명해질 때까지 Hermes가 묻습니다 |
| 3. 계획 | `lit-crucible <접근법>` 또는 `lit plan <작업>` | crucible은 접근법의 약점부터 찌르고 살아남은 것을 계획으로 넘깁니다. `lit plan`은 코드는 건드리지 않고 계획 파일을 씁니다 |
| 4. 실행 | `/start-work <계획 파일>` 또는 `/lit-loop <작업>` | 테스트와 확인을 거치며 작업합니다 |
| 5. 검토 | `/review-work` | 검토자 다섯이 변경을 따로 읽고, 찾은 문제부터 말합니다 |
| 6. 넘겨주기 | `/lit-handoff` | 결과와 다음 할 일을 프로젝트의 `HANDOFF.md`에 남깁니다 |

두 방법 모두 [설치](#설치)의 한 줄로 시작합니다.

## 할 수 있는 일

| 입력 | 스킬 | 용도 |
|---|---|---|
| `lit <요청>` 또는 `/lit` | `litwork` | 범위를 정한 작업을 확인 결과까지 |
| `lit-plan` 또는 `/lit-plan` | `lit-plan` | 아무것도 고치기 전에 계획부터 |
| `/start-work <승인된 계획>` | `start-work` | 승인한 계획 실행 |
| `lit review [plan\|work] <대상>` 또는 `/review-work` | `review-work` | `start-work` 전의 계획 검토, 또는 끝난 작업 검토 |
| `lit brainstorm <요청>` | `lit-brainstorm` | 열린 요청에 대한 여러 선택지와, 고를 수 있는 짧은 목록 |
| `ultra-brainstorm <요청>` 또는 `/ultra-brainstorm` | `ultra-brainstorm` | 아이디어 자식을 몇 개 띄울지 비용과 함께 한 번 묻고, 판정한 상위 목록을 줍니다. 읽기 전용입니다 |
| `lit team <작업>` 또는 `/lit-team` | `lit-team` | 이 세션이 팀장이 되어 조각을 나누고, 결과를 합쳐 다시 확인하고, 한 번 보고합니다. 팀원은 커밋하지 않습니다 |
| `lit research <질문>` | `litresearch` | 출처 메모가 있는 조사 |
| `/lit-humanizer` | `lit-humanizer` | 의미를 지키며 한국어·영어 문장 다듬기 |
| `/lit-diagram-drawer <brief>` | `lit-diagram-drawer` | `wjgoarxiv-skills`의 LitFamily 확장: 폴더와 복사 줄을 알려 줍니다 |
| `/lit-schematic <brief>` | `lit-schematic` | `wjgoarxiv-skills`의 LitFamily 확장: 폴더와 복사 줄을 알려 줍니다 |
| `/lit-hijack <brief>` | `lit-hijack` | 라이선스 게이트와 parity 검증을 거친 공개 노하우의 클린룸 포팅 |
| `/lit-adhd [recap [세션]] [--here] [--since 7d] [--max 12] [--detail] [--en]` | `lit-adhd` | 최근 세션을 여섯 줄 카드로 보여 줍니다. 바뀐 것, 지금 할 일 하나와 칠 입력이 나오고, `--detail`이면 KPI 보드를, `recap`이면 세션 하나의 리캡을 보여 줍니다(`/lit-recap`도 그대로 됩니다). 읽기 전용입니다. |
| `/lit-pptx <brief>` | `lit-pptx` | `wjgoarxiv-skills`의 LitFamily 확장: 폴더와 복사 줄을 알려 줍니다 |
| `/lit-docx <brief>` | `lit-docx` | `wjgoarxiv-skills`의 LitFamily 확장: 폴더와 복사 줄을 알려 줍니다 |
| `/lit-typographic-motion <brief>` | `lit-typographic-motion` | `wjgoarxiv-skills`의 LitFamily 확장: 폴더와 복사 줄을 알려 줍니다 |

Telegram gateway에서는 `/lit_loop`와 `/lit_plan`을 쓰세요. 모든 스킬은 `lithermes:<이름>`으로도 불러올 수 있습니다. 예를 들어 `lithermes:review-work`, `lithermes:lit-humanizer`처럼 씁니다. 스킬 41개 전체는 [스킬과 명령](https://github.com/wjgoarxiv/lithermes/blob/main/docs/skills.ko.md)에 있습니다. 그 가운데 아홉 개는 `wjgoarxiv-skills`에 있는 LitFamily 확장의 스텁입니다.

## 확장

LitHermes의 코어는 그 자체로 완성되어 있고, 혼자서도 제대로 돌아갑니다. 파일을 만드는 스킬 아홉 개(발표자료, 문서, 그림, 디자인, 영상 커버)는 LitFamily 확장이 되어 확장 선반 [`wjgoarxiv-skills`](https://github.com/wjgoarxiv/wjgoarxiv-skills)에 있습니다. 쓰는 것만 골라 LitHermes 옆에 설치하면 LitFamily를 온전히 쓸 수 있습니다. 확장마다 Hermes판 폴더가 하나씩 있고, 그 폴더를 프로필에 넣은 다음 새 Hermes 세션을 열면 됩니다. 넣는 일은 명령 한 줄이 맡습니다.

```sh
npx --package @litfamily/lithermes@latest -- lithermes extensions install lit-pptx --yes
```

이 명령은 선반의 얕은 사본을 자기 캐시 폴더에 받아 두고(받아 둔 사본이 있으면 `--from <경로>`), Hermes가 스킬을 읽는 곳에 같은 이름의 다른 스킬이 있으면 멈추고 그 경로를 알려 주며, 같은 이름의 예전 폴더를 프로필의 `extension-backups/`로 통째로 옮긴 뒤 복사하고 영수증을 남깁니다. `--yes`가 없으면 계획만 보여 줍니다. 나머지는 `extensions list`, `check`, `update`, `remove`, `prune-backups`가 맡습니다. 손으로 하려면 `ID`를 정하고 아래 줄을 bash나 zsh에 붙여 넣으세요. 그러면 같은 이름의 예전 폴더는 프로필의 `extension-backups/`로 통째로 옮겨 가서 새 복사본에 섞이지 않고, 복사본 옆에 영수증이 남습니다.

```sh
git clone https://github.com/wjgoarxiv/wjgoarxiv-skills.git
H="${HERMES_HOME:-$HOME/.hermes}"; ID=lit-pptx; SRC="$PWD/wjgoarxiv-skills/variants/lithermes/$ID"
[ -e "$H/skills/${ID:?}" ] && echo "taken: $H/skills/$ID" || echo "free: $H/skills/$ID"; grep -rlE --include=SKILL.md "^name: *[\"']?${ID}[\"']? *\$" "$H/skills" .hermes/skills .agents/skills 2>/dev/null; grep -A3 -E '^ *(external_dirs|create_dir):' "$H/config.yaml" 2>/dev/null
if [ -e "$H/skills/${ID:?}" ]; then mkdir -p "$H/extension-backups" && B=$(mktemp -d "$H/extension-backups/$(date +%Y%m%d-%H%M%S)-XXXX") && mv "$H/skills/$ID" "$B/" && echo "moved aside: $B/$ID"; fi
if [ -e "$H/skills/${ID:?}" ]; then echo "stopped: $H/skills/$ID is still there"; else mkdir -p "$H/skills" && cp -R "$SRC" "$H/skills/$ID" && echo "copied: $H/skills/$ID"; fi
printf '{"id":"%s","source":"%s","variant":"lithermes","installed_at":"%s"}\n' "${ID:?}" "$(printf %s "$SRC" | sed 's/[\\"]/\\&/g')" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$H/skills/$ID/.litfamily-extension.json"
```

업데이트할 때는 `extensions update --yes`를 돌리거나 마지막 다섯 줄을 다시 붙여 넣으면 됩니다. 설치 프로그램은 설치나 업그레이드가 끝나면 이 안내를 보여 주고, 그 뒤 첫 Hermes 응답 끝에 한 번 더 보여 줍니다. [확장 아홉 개와 각각 만드는 것](https://github.com/wjgoarxiv/lithermes/blob/main/docs/skills.ko.md#wjgoarxiv-skills로-옮겨-간-스킬)

## 확인, 업데이트, 삭제

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

`doctor --offline`은 인터넷에 나가지 않고 설치 상태를 확인합니다. 설치 프로그램이 Hermes에 호환성 수정을 했다면 삭제할 때 `--rollback-patches`를 붙이세요. 업데이트는 백업과 되돌리기를 거쳐 스스로 하고, 직접 하려면 `LITHERMES_NO_AUTO_UPDATE=1`을 설정하세요. 중간에 멈춘 설치가 남긴 잠금은 다음 실행 때 저절로 풀립니다. 자세한 내용과 문제 해결은 [설치 문서](https://github.com/wjgoarxiv/lithermes/blob/main/docs/install.ko.md)에 있습니다.

## 더 알아보기

- [GitHub의 README](https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md)와 [화면으로 보는 둘러보기](https://github.com/wjgoarxiv/lithermes/blob/main/docs/tour.ko.md)
- [사용 안내](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md): 명령, 자연어 routing, 모델, 스킨, 안전 모델
- [변경 기록](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md) · [개인정보](https://github.com/wjgoarxiv/lithermes/blob/main/docs/privacy.md) · [기여](https://github.com/wjgoarxiv/lithermes/blob/main/CONTRIBUTING.md) · [보안](https://github.com/wjgoarxiv/lithermes/blob/main/SECURITY.md) · [지원](https://github.com/wjgoarxiv/lithermes/blob/main/SUPPORT.md)

MIT License. [LitFamily](https://github.com/wjgoarxiv/litfamily)의 한 제품입니다.
