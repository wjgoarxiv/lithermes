# 선택 기능: Jev 스킬 힌트

[← README로 돌아가기](../README_Ko-KR.md) · [English](./jev.md)

평범하게 쓴 프롬프트가 사실은 번들 스킬 하나에 딱 맞는데, 문장만 봐서는 드러나지 않을 때가 있습니다. 이런 프롬프트에 대해 LitHermes는 TypeSafe가 호스팅하는 결정 모델 Jev에게 어떤 스킬이 맞는지 물어볼 수 있습니다. Jev의 답은 그 턴의 컨텍스트에 조언 한 줄로 붙습니다. 어디까지나 제안이라, 스킬을 불러올지는 여전히 Hermes 모델이 정하고 힌트로 권한을 주거나 도구를 실행할 수는 없습니다. 슬래시 명령이나 기존 LitHermes 경로가 이미 처리하는 프롬프트에는 끼어들지 않습니다.

기본값은 꺼짐입니다. 켜려면 Hermes가 실행되는 환경에 두 변수를 모두 설정하고, 키는 본인의 TypeSafe 키를 쓰세요.

```sh
export LITHERMES_JEV=1
export TYPESAFE_API_KEY=<your key>
```

켜 두면 조건에 맞는 프롬프트마다 2,000자로 자르고 홈 경로, 이메일 주소, 토큰 형태의 문자열을 가린 뒤 TypeSafe(typesafe.ai)로 보냅니다. 토큰 형태가 아닌 내용, 예를 들어 호스트 이름, 고객 이름, `password=...` 형식이 아닌 비밀번호는 쓴 그대로 전송됩니다. Hermes 게이트웨이 모드에서는 대화방의 다른 참여자가 보낸 메시지도 전송 대상입니다. 세션의 다른 내용은 보내지 않습니다.

`TYPESAFE_API_KEY`는 Hermes를 시작하는 셸에 export되어 있으므로 에이전트의 도구도 이 값을 읽을 수 있습니다. 이 기능 전용 키를 쓰고 사용 한도를 낮게 잡으세요. 비용은 TypeSafe가 본인 계정에 청구하며, 입력 토큰 100만 개당 약 0.04달러입니다. 요청마다 1.5초 제한이 있고 재시도하지 않습니다. 실패하면 턴은 그대로 진행되고, 짧은 안내가 세션마다 한 번만 표시됩니다.

켜져 있는 동안에는 세션의 첫 답변 맨 위에 `✦ Jev skill hint ON` 한 줄이 표시되어, 기능이 켜져 있다는 것을 바로 알 수 있습니다. `hermes lithermes status`와 `hermes lithermes doctor`에서도 확인할 수 있습니다. 마지막 힌트는 세션별로 따로 보관하므로, 에이전트의 터미널처럼 Hermes 세션 안에서 실행하세요.

- `Jev skill hint: on — last hint lit-humanizer (0.43s)`는 그 세션에서 마지막으로 힌트한 스킬과 Jev의 응답 시간을 보여 줍니다.
- `on — no hint yet`은 그 세션에 아직 힌트가 없다는 뜻입니다.
- 세션 밖에서 실행하면 `on — no session`이 표시되고, 그 밖에는 `off` 또는 `flag on but TYPESAFE_API_KEY missing`이 표시됩니다.

끄려면 `LITHERMES_JEV`를 해제하거나 `1`이 아닌 값으로 바꾸세요.

## 화면에서 보이는 것

아래 네 장은 Jev를 켰을 때 내 화면에서 무엇이 달라지는지 보여 줍니다. 그림 속 글자는 LitHermes가 출력하는 문구 그대로이고, 스킬 이름과 시간은 예시입니다.

**첫 응답.** Jev가 꺼져 있으면 응답은 Hermes가 쓴 그대로 도착합니다. 켜져 있으면 세션의 첫 응답 맨 위에 한 줄이 더 붙어서, 내 프롬프트가 Jev로 보내지고 있다는 것을 바로 알 수 있습니다. 이 줄은 세션마다 한 번만 나오고, 그 아래 응답은 그대로입니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-first-reply-dark.webp" /><img src="./assets/jev/jev-first-reply-light.webp" width="690" alt="터미널 창 두 개. Jev 끄기: 응답은 &quot;Rewritten. Figures and hedges are unchanged.&quot;로 시작합니다. Jev 켜기: 같은 응답 위에 첫 줄 &quot;✦ Jev skill hint ON&quot;과 빈 줄이 붙습니다." /></picture></p>

*예시 출력입니다. 첫 줄은 LitHermes의 응답 처리 코드가 실제로 만든 문구이고, 그 아래 문장은 지어낸 예시 글입니다.*

**Jev가 제때 답하지 못할 때.** TypeSafe가 느리거나 연결되지 않으면 힌트 없이 그대로 진행합니다. 힌트가 왜 없는지 알 수 있도록, 첫 줄 아래에 짧은 안내가 세션마다 한 번 붙습니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-first-reply-note-dark.webp" /><img src="./assets/jev/jev-first-reply-note-light.webp" width="690" alt="터미널 창 하나. 첫 줄 &quot;✦ Jev skill hint ON&quot;, 둘째 줄 &quot;LitHermes skill hint unavailable (timeout); continuing normally.&quot;, 빈 줄, 그다음 응답 &quot;Rewritten. Figures and hedges are unchanged.&quot;" /></picture></p>

*LitHermes의 응답 처리 코드로 만든 예시 출력입니다. 답이 오지 않는 TypeSafe를 흉내 내는 대역을 썼고, 어디로도 아무것도 보내지 않았습니다.*

**켜기 전에.** `hermes lithermes doctor`에는 Jev 줄이 있습니다. 꺼져 있으면 참고용 줄이고, 스위치만 켜고 키를 빼먹으면 빠진 키 이름을 알려 주는 경고로 바뀝니다. 키를 빠뜨렸는지 가장 빨리 확인하는 방법입니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-status-before-dark.webp" /><img src="./assets/jev/jev-status-before-light.webp" width="690" alt="터미널. &quot;hermes lithermes doctor | grep Jev&quot; 명령이 &quot;[NOTE] Jev skill hint: off&quot;를 출력합니다. &quot;export LITHERMES_JEV=1&quot; 뒤에 같은 명령은 &quot;[WARN] Jev skill hint: flag on but TYPESAFE_API_KEY missing&quot;을 출력합니다." /></picture></p>

*스크래치용 Hermes 홈에서 실제 `hermes lithermes doctor` 명령으로 얻은 출력입니다.*

**켠 뒤에.** 세션 안에서 `status`는 처음에 아직 힌트가 없다고 알려 줍니다. Jev가 스킬을 제안한 뒤에는 같은 줄이 그 스킬 이름과 Jev가 걸린 시간을 보여 주고, `doctor`도 같은 내용을 OK 표시와 함께 보여 줍니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/jev/jev-status-on-dark.webp" /><img src="./assets/jev/jev-status-on-light.webp" width="690" alt="터미널. &quot;export TYPESAFE_API_KEY=&lt;your key&gt;&quot; 뒤에 &quot;hermes lithermes status | grep Jev&quot;가 &quot;Jev skill hint: on — no hint yet&quot;을 출력합니다. 주석 한 줄 뒤에 같은 명령은 &quot;Jev skill hint: on — last hint lit-humanizer (0.42s)&quot;를, &quot;hermes lithermes doctor | grep Jev&quot;는 &quot;[OK] Jev skill hint: on — last hint lit-humanizer (0.42s)&quot;를 출력합니다." /></picture></p>

*스크래치용 Hermes 홈에서 실제 `hermes lithermes status`와 `doctor` 명령으로 얻은 출력입니다. 자리표시 키와 TypeSafe 답변 대역을 썼으므로 스킬 이름과 0.42초는 예시입니다.*
