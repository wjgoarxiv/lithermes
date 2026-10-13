# LitHermes 설치, 업데이트, 삭제

[← README로 돌아가기](../README_Ko-KR.md) · [English](./install.md)

README에는 설치 명령 한 줄만 있습니다. 이 문서에는 나머지를 모았습니다. 그 한 줄이 하는 일, 따로 떼어 둔 프로필에서 먼저 써 보는 방법, 검토된 `.tgz`로 설치하는 방법, 자동 업데이트가 움직이는 방식과 끄는 방법, 문제가 생겼을 때 할 일, 삭제하는 방법입니다.

## 설치

Hermes Agent와 Node.js 18 이상, 그리고 Hermes 홈(기본 `~/.hermes`)에 쓸 권한이 필요합니다.

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

이 한 줄이 설치 프로그램을 받아 오고, 플러그인을 Hermes 홈에 넣고, 플러그인이 불러와지도록 Hermes 설정을 고칩니다. 중간에 승인을 묻느라 멈추지 않게 만든 명령이라 `--yes`가 두 번 들어갑니다. 앞의 것은 npx에게 패키지를 실행해도 된다고 알리고, 뒤의 것은 설정 변경을 승인합니다. `--no-style`은 답변 문체를 고르는 화면을 건너뜁니다. 이 옵션이 없으면 터미널에서는 그 화면이 여전히 뜹니다. Ignition 스킨은 어느 쪽이든 설치됩니다. 턴이 끝날 때 Hermes가 울리는 벨은 `--bell`을 붙이거나 대화형 설치의 질문에 yes라고 답할 때만 켜집니다. 이미 정해 둔 `display.bell_on_complete` 값은 그대로 두고, `--no-bell`을 붙이면 질문을 건너뜁니다. 설치하는 동안 Telegram에는 연결하지 않습니다.

평소 쓰는 환경을 건드리기 전에 먼저 써 보고 싶을 수도 있습니다. 그럴 때는 설치 전에 `HERMES_HOME`을 비어 있는 새 디렉터리로 지정하고, Hermes를 시작할 때도 같은 값을 쓰세요. 원래 쓰던 홈과 설정은 그대로 남습니다. 설치 프로그램은 찾아낸 Hermes 설치본에 호환성 수정을 할 수도 있습니다. 그 설치본이 시험용 프로필 밖에 있고 그것까지 그대로 두고 싶다면 `--no-patch-installed-hermes`를 붙이세요.

<details>
<summary>검토된 .tgz로 설치하기</summary>

릴리스와 함께 검토된 `.tgz`를 받았다면, 예시 경로를 실제 경로로 바꾸고 각 줄을 따로 실행하세요.

```sh
LITHERMES_PACK='/absolute/path/to/the-reviewed-package.tgz'
```

```sh
npm exec --yes --package "$LITHERMES_PACK" -- lithermes install --yes --no-style --no-auto-update --no-patch-installed-hermes
```

이 문서의 다른 명령도 같은 파일로 실행할 수 있습니다.

```sh
npm exec --yes --package "$LITHERMES_PACK" -- lithermes install --dry-run --no-auto-update --no-patch-installed-hermes
npm exec --yes --package "$LITHERMES_PACK" -- lithermes doctor --offline --no-auto-update
npm exec --yes --package "$LITHERMES_PACK" -- lithermes uninstall --yes --no-auto-update
npm exec --yes --package "$LITHERMES_PACK" -- lithermes hud off
```

</details>

## 업데이트

LitHermes는 스스로 업데이트하는데, 조심스럽게 합니다. 실제로 무슨 일이 일어나는지 순서대로 설명합니다.

새 버전을 확인하는 때는 두 가지입니다. 터미널에서 `lithermes install`, `check`, `doctor`를 실행할 때, 그리고 대화형 Hermes CLI 세션에서 첫 메시지를 보낼 때입니다. npm 레지스트리에 최신 안정 버전을 물어보고 답을 최대 3초까지 기다립니다. 지금 쓰는 것보다 새 버전이면 그 자리에서 바로 설치하고, 설치가 끝날 때까지 실행한 명령(또는 첫 응답)이 기다립니다. Hermes 안에서는 이 기다림이 최대 90초입니다.

설치는 되돌릴 수 있게 짜여 있습니다.

1. 플러그인 폴더, `config.yaml`, 설치 기록, 스킨 폴더를 `<Hermes 홈>/lithermes/auto-update/<id>/backup/`에 복사해 둡니다.
2. 새 버전의 설치 프로그램을 `install --yes --no-hud --no-style --no-patch-installed-hermes`로 실행합니다. 스킨 강조색과 답변 문체를 다시 묻지 않고, Hermes 설치본에도 손대지 않습니다. 설정해 둔 모델과 추론 강도는 그대로 남습니다.
3. `doctor --offline`을 실행합니다.
4. 설치가 실패하거나 30초를 넘기거나 이 점검을 통과하지 못하면 백업을 복원해서 쓰던 버전이 그대로 남습니다.

한 Hermes 홈에서는 업데이트가 한 번에 하나만 진행됩니다. 설치 프로그램에는 실행에 필요한 `PATH`, 홈과 임시 폴더, 로케일, `TERM`, `NODE_EXTRA_CA_CERTS`만 넘어가고, 셸에 있는 npm 설정, 프록시, `NODE_OPTIONS`, 토큰은 넘어가지 않습니다. 업데이트에 성공해도 백업 폴더는 남으니, 필요 없어지면 직접 지우세요.

**보이는 것은 많지 않습니다.** `lithermes install` 중에 업데이트가 일어나면 `LitHermes automatic update committed (<version>). Restart Hermes to load it.`를 출력하고 끝납니다. 새 설치 프로그램이 이미 설치를 마쳤기 때문입니다. 그 명령에 붙였던 옵션이 필요하면 명령을 한 번 더 실행하세요. `check`와 `doctor`는 하던 대로 결과를 보여 줍니다. 업데이트가 실패해서 백업을 복원했다면 아무 출력 없이 쓰던 버전으로 이어집니다. Hermes 안에서도 대화에는 아무것도 추가되지 않고, 첫 응답이 업데이트가 끝날 때까지 기다릴 뿐입니다. 새 버전을 불러오려면 Hermes CLI와 gateway를 다시 시작하세요.

실행할 때마다 `<Hermes 홈>/lithermes/`에 기록이 두 개 남습니다. `auto-update-journal.json`은 진행 단계를, `auto-update-receipt.json`은 성공 여부와 목표 버전, 복원 여부를 담습니다. 복원마저 실패하면 LitHermes가 명령을 멈추고 Hermes 홈이 알 수 없는 상태라고 알려 줍니다. 백업은 지우지 말고, 계속하기 전에 `lithermes doctor --offline --hermes-home PATH`를 실행하세요.

**업데이트가 일어나지 않는 경우.** 업데이트는 사람이 터미널 앞에 있을 때만 합니다. 입력, 출력, 오류 출력이 모두 대화형 터미널이어야 하므로 출력을 파이프로 넘기거나 `CI` 변수가 설정된 실행에서는 건너뜁니다. `--offline`, `--json`, `--dry-run`을 붙인 명령과 `bunx`로 실행한 명령도 마찬가지입니다. Hermes 안에서는 기본 터미널 CLI(`hermes` 또는 `hermes chat`)의 첫 메시지에서만, 세션마다 최대 한 번, 최상위 세션에서만 시도하고 위임받은 보조 세션에서는 시도하지 않습니다. 전체 화면 `hermes --tui`와 Telegram, Discord 같은 gateway는 터미널이 아니라 파이프로 Hermes와 통신하므로 업데이트하지 않습니다. 이때는 터미널에서 `lithermes install`, `check`, `doctor`를 실행하세요. 대상은 npm 설치 프로그램이 넣어 준 LitHermes뿐입니다. Hermes 카탈로그로 들어왔거나 직접 복사해 넣은 사본은 사용자가 관리합니다. 예전 설치 프로그램으로 설치했다면 설치 프로그램을 한 번 다시 실행한 뒤부터 대상이 됩니다.

**업데이트 안내.** 이와는 따로, LitHermes는 설치하지 않고 새 릴리스 소식만 알려 줄 수도 있습니다. `install`, `check`, `doctor`를 실행한 뒤 백그라운드에서 24시간에 한 번까지만 확인하고, 결과를 `update-check.json`에 저장합니다. 다음에 실행할 때 이 파일을 읽어 더 새로운 릴리스가 적혀 있으면 `npx --yes --package @litfamily/lithermes@<version> -- lithermes install --yes --no-hud` 같은 명령을 안내합니다. 이 명령은 직접 실행하는 것이라서, 자동 업데이트를 꺼 두었을 때 새 릴리스 소식을 듣는 방법이 됩니다. `--offline`, `--json`, `--dry-run`을 붙였거나 CI에서 돌거나 출력을 파이프로 넘길 때는 이 확인도 하지 않습니다.

**끄는 방법.** 필요한 것을 고르세요.

- `LITHERMES_NO_AUTO_UPDATE=1`: 새 버전은 직접 설치하고 안내는 계속 받습니다. `lithermes`를 실행하는 셸과 Hermes를 시작하는 셸 양쪽에 설정해야 합니다.
- `install`, `check`, `doctor`에 `--no-auto-update`: 그 명령 한 번만 업데이트를 건너뜁니다.
- `NO_UPDATE_NOTIFIER=1` 또는 `LITHERMES_NO_UPDATE_CHECK=1`: 새 버전을 npm에 물어보는 일 자체를 멈춥니다. 자동 업데이트와 안내가 모두 꺼집니다.

LitHermes는 변수가 설정되어 있는지만 보기 때문에, `0`을 포함해 어떤 값이든 똑같이 적용됩니다.

## 문제가 생겼을 때

먼저 오프라인으로 설치 상태를 확인하세요.

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
```

Lit 스킬이 보이지 않으면 Hermes에 `skills_list` 도구를 불러 LitHermes 항목을 찾아 달라고 하세요. `/skills` 명령은 파일시스템만 읽기 때문에, Hermes 버전에 따라 플러그인이 제공하는 스킬과 목록이 다를 수 있습니다.

다른 곳에 같은 이름의 스킬이 있으면 LitHermes 스킬 대신 그쪽이 잡힐 수 있습니다. 스킬을 이름만으로 부르면 Hermes는 `config.yaml`의 `skills.external_dirs`에 적힌 폴더와 `<HERMES_HOME>/skills`를 먼저 뒤진 다음에야 플러그인으로 넘어옵니다. 앞에 접두어를 붙인 `lithermes:<name>` 형태는 이 탐색을 건너뜁니다. 이름이 겹치면 `lithermes doctor`가 `skill shadow check: WARNING` 줄에 해당 스킬과 그 스킬을 가리는 경로를 적어 줍니다. `lithermes:<name>`으로 불러오거나, 다른 쪽 사본을 지우거나 이름을 바꾸세요. 이 경고는 알려 주기만 할 뿐, doctor의 성공/실패 종료 상태는 그대로입니다.

Hermes 로그에 import 오류가 보이면 플러그인을 불러오지 못한 것입니다. 짐작으로 pip 패키지를 설치하기보다는, 오류 메시지를 보관해 두고 [운영 안내](./guide.ko.md)를 확인하세요.

## 알아 둘 한계

- 설치 프로그램이 무엇을 바꿀지 실제로 바꾸기 전에 보고 싶다면 `lithermes install --dry-run`을 실행하세요.
- 붙여 넣은 코드, 인용문, 명령은 읽을 글로 다루고, 지시로 따르지는 않습니다. 비밀값은 저장하거나 모델에 넘기기 전에 가립니다.
- Hermes에 원래 있는 `/goal`은 사용자가 직접 관리하는 기능입니다. LitHermes는 이 기능을 건드리지 않고, 갱신하거나 지우거나 다시 이어 주지도 않습니다. 자기 목표는 `goal_*` 도구로 따로 저장해 두고, 그 기록을 기준으로 삼습니다.
- Hermes는 보조 작업을 모두 공통 모델 설정 하나로 보냅니다. 그래서 작업마다 모델을 고르거나 리뷰 전용 모델을 따로 지정할 수는 없습니다. 설치 보고서에는 설정한 값이 나옵니다. 보조 작업이 실제로 어떤 모델로 돌았는지는 실제 `delegate_task` 실행 기록으로만 확인할 수 있습니다.

## 삭제하기

```sh
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

설치 프로그램이 Hermes에 호환성 수정을 했다면 `--rollback-patches`를 붙여 되돌리세요. 삭제해도 스킨 파일과 `display.skin` 선택은 남습니다. Hermes 기본 모습으로 돌아가려면 같은 프로필에서 `npx --package @litfamily/lithermes -- lithermes hud off`를 실행하세요. 선택만 지우고, 스킨 파일과 다른 설정은 그대로 둡니다.
