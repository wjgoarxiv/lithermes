<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.24/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.24/readme-assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitHermes 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center">
<a href="#설치"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.24/readme-assets/badge-version.svg" alt="1.0.24" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.24/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.24/readme-assets/lucide-book-open.svg" width="16" alt="" /> 안내</a> &nbsp;
<a href="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.24/readme-assets/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.24/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition 영상</a> &nbsp;
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.24/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitHermes

**Keep the work lit.**

**Hermes Agent**용 플러그인입니다. 요청 앞에 `lit`을 붙이면 Hermes가 작업을 계획하고, 해내고, 한 일을 확인한 뒤, 다음 세션이 이어받을 수 있는 기록을 남깁니다.

**[GitHub의 README와 문서](https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md)** · [English](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.24/README.md)

## 설치

Hermes Agent와 Node.js 18 이상, 그리고 Hermes 홈(기본 `~/.hermes`)에 쓸 권한이 필요합니다.

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

플러그인을 설치하고 Hermes 설정을 고치는 동안 승인을 묻느라 멈추지 않습니다. `--no-style`은 답변 문체 고르기를 건너뜁니다. 따로 떼어 둔 프로필에서 써 보려면 먼저 `HERMES_HOME`을 빈 디렉터리로 지정하세요. 다른 옵션은 [설치 문서](https://github.com/wjgoarxiv/lithermes/blob/main/docs/install.ko.md)에 있습니다.

## 첫 작업

Hermes CLI 또는 gateway를 다시 시작한 뒤 이렇게 입력하세요.

```text
lit 외부 의존성 없이 HTML 파일 하나로 할 일 목록을 만들어줘. 추가·완료·삭제를 구현하고 확인한 내용과 다음 행동을 남겨줘.
```

응답 첫 줄에 `🔥 **LIT IGNITED · <discipline>** 🔥`가 나오면 작업이 시작된 것입니다. 끝나면 파일을 직접 확인하고 `/lit-handoff`를 실행하세요. 같은 프로젝트의 다음 세션이 그 기록을 읽고 이어갑니다. [자동 핸드오프](https://github.com/wjgoarxiv/lithermes/blob/main/docs/automatic-handoff.ko.md)는 기본값이 꺼짐이고, `/lit-handoff auto on 60`(1에서 99 사이의 정수)을 켜 두면 `/compact` 전에 인계 기록을 먼저 요청합니다.

## 할 수 있는 일

| 입력 | 스킬 | 용도 |
|---|---|---|
| `lit <요청>` 또는 `/lit` | `litwork` | 범위를 정한 작업을 확인 결과까지 |
| `lit-plan` 또는 `/lit-plan` | `lit-plan` | 아무것도 고치기 전에 계획부터 |
| `/start-work <승인된 계획>` | `start-work` | 승인한 계획 실행 |
| `lit review <대상>` 또는 `/review-work` | `review-work` | 계획이나 결과 검토 |
| `lit research <질문>` | `litresearch` | 출처 메모가 있는 조사 |
| `/lit-humanizer` | `lit-humanizer` | 의미를 지키며 한국어·영어 문장 다듬기 |
| `/lit-diagram-drawer <brief>` | `lit-diagram-drawer` | 검사를 거친, 편집 가능한 다이어그램 |
| `/lit-pptx <brief>` | `lit-pptx` | 여덟 가지 디자인 방향 가운데 하나로 만든 PowerPoint 발표자료와 Markdown 원본 |
| `/lit-docx <brief>` | `lit-docx` | 여섯 가지 문서 형식 가운데 하나로 짠 절제된 Word 문서와 Markdown 원본 |
| `/lit-typographic-motion <brief>` | `lit-typographic-motion` | 트리트먼트부터 쓰는 짧은 영상 |

Telegram gateway에서는 `/lit_loop`와 `/lit_plan`을 쓰세요. 모든 스킬은 `lithermes:<이름>`으로도 불러올 수 있습니다. 예를 들어 `lithermes:lit-pptx`, `lithermes:lit-docx`처럼 씁니다. 스킬 36개 전체는 [스킬과 명령](https://github.com/wjgoarxiv/lithermes/blob/main/docs/skills.ko.md)에서 그림과 함께 볼 수 있습니다.

## 확인, 업데이트, 삭제

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

`doctor --offline`은 인터넷에 나가지 않고 설치 상태를 확인합니다. 설치 프로그램이 Hermes에 호환성 수정을 했다면 삭제할 때 `--rollback-patches`를 붙이세요. 업데이트는 백업과 되돌리기를 거쳐 스스로 하고, 직접 하려면 `LITHERMES_NO_AUTO_UPDATE=1`을 설정하세요. 자세한 내용과 문제 해결은 [설치 문서](https://github.com/wjgoarxiv/lithermes/blob/main/docs/install.ko.md)에 있습니다.

## 더 알아보기

- [GitHub의 README](https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md)와 [화면으로 보는 둘러보기](https://github.com/wjgoarxiv/lithermes/blob/main/docs/tour.ko.md)
- [사용 안내](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.ko.md): 명령, 자연어 routing, 모델, 스킨, 안전 모델
- [선택 기능: Jev 스킬 힌트](https://github.com/wjgoarxiv/lithermes/blob/main/docs/jev.ko.md): 기본값은 꺼짐이고, 켜면 해당하는 프롬프트를 외부 서비스로 보냅니다
- [변경 기록](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md) · [개인정보](https://github.com/wjgoarxiv/lithermes/blob/main/docs/privacy.md) · [기여](https://github.com/wjgoarxiv/lithermes/blob/main/CONTRIBUTING.md) · [보안](https://github.com/wjgoarxiv/lithermes/blob/main/SECURITY.md) · [지원](https://github.com/wjgoarxiv/lithermes/blob/main/SUPPORT.md)

MIT License. [LitFamily](https://github.com/wjgoarxiv/litfamily)의 한 제품입니다.
