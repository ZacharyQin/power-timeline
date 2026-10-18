<h1 align="center">Power Timeline</h1>

> Steam Deck용 배터리 기록입니다. 빠른 접근 메뉴에서 지금과 이전 사용량을 봅니다.

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.pt.md">Português</a> · <a href="./README.es.md">Español</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a>
</p>
<p align="center">
  <a href="#what">하는 일</a> · <a href="#install">설치</a> · <a href="#try-it">사용 방법</a> · <a href="#language">언어</a> · <a href="#limits">알아 두기</a> · <a href="./CHANGELOG.md">변경 기록</a>
</p>
<p align="center">
  <img src="./docs/qam-home.jpg" alt="빠른 접근 메뉴의 Power Timeline. 배터리, 전력 흐름, 최근 24시간, 배터리 정보" width="100%">
</p>

<h2 id="what">하는 일</h2>

Decky 플러그인입니다. 배터리, 기기 전력, 각 게임의 에너지를 기록합니다. 페이지를 닫아도 기록은 멈추지 않습니다.

빠른 접근 메뉴:

- 현재 배터리와 작은 전력 흐름 그림
- 최근 24시간. 확인을 누르면 타임라인이 열립니다
- 충전 중에는 완충까지 대략 얼마나 걸리는지
- Steam에 이미 저장된 충전 제한
- 전력 흐름, 전원과 배터리, 게임 기록

타임라인은 최근 1일, 3일, 7일입니다. 좌우 또는 가로로 밀면 한 시점에 멈춥니다.

<h2 id="install">설치</h2>

Decky를 설치합니다. [Releases](https://github.com/ZacharyQin/power-timeline/releases/latest)에서 최신 ZIP을 받아 Decky에서 그 ZIP을 설치합니다. 목록 이름은 **Power Timeline**입니다.

하드웨어를 읽기 위해 백엔드는 root로 실행됩니다. 시스템 전원 정책과 다른 플러그인은 바꾸지 않습니다.

업데이트는 같은 Releases 페이지에서 새 ZIP을 받아 다시 설치합니다. 제거해도 기록은 지워지지 않습니다. 보통 `~/homebrew/data/power-timeline/`에 있습니다.

<details>
<summary>소스에서 빌드</summary>

Node.js, pnpm, Python 3이 필요합니다.

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

`pnpm build`가 화면을 만듭니다. 실행 파일을 ZIP에 넣으십시오. 데이터베이스를 플러그인 폴더에 넣지 마십시오.

</details>

<h2 id="try-it">사용 방법</h2>

1. Decky → **Power Timeline**을 엽니다. 먼저 배터리와 작은 전력 흐름을 봅니다.
2. 24시간 그래프에서 확인을 누릅니다. 위에서 1일, 3일, 7일을 바꿉니다.
3. 그래프로 이동합니다. 좌우 또는 가로로 밀어 시점을 고릅니다. 그 시점의 배터리와 전력이 나옵니다. 게임을 보고 있었다면 아이콘과 이름도 나옵니다.
4. 충전 중에는 완충까지 대략 얼마나 걸리는지 보입니다. 충전 제한은 Steam에 저장된 비율을 사용합니다.
5. 작은 그림에서 확인하면 전력 흐름입니다. 배터리 묶음에서 확인하면 전원과 배터리입니다.

처음에는 이전 기록이 없습니다. 켜기 전의 사용량도 채우지 않습니다.

<h2 id="language">언어</h2>

직접 고르기 전에는 Steam 언어입니다. 메뉴와 각 페이지 맨 아래에 국기가 있습니다. 좌우 또는 가로로 밀면 강조만 움직입니다. 확인을 눌러야 바뀝니다. 안내는 그 국기의 언어입니다.

| 국기 | 화면 | Steam 언어 |
| --- | --- | --- |
| 중국 | 간체 중국어 | 간체, 번체, 그 밖의 중국어 |
| 미국 | 영어 | 영어, 그리고 아래에 없는 언어 |
| 포르투갈 | 포르투갈어 | 포르투갈어와 브라질 포르투갈어가 함께 사용 |
| 스페인 | 스페인어 | 스페인어와 라틴아메리카 스페인어가 함께 사용 |
| 일본 | 일본어 | 일본어 |
| 대한민국 | 한국어 | 한국어 |

고른 언어는 기억합니다. 이 문서도 같은 여섯 언어입니다. 맨 위 링크로 바꿉니다.

<h2 id="limits">알아 두기</h2>

- 전원을 연결한 동안 기기 사용량은 알 수 없습니다. 충전 전력으로 대신하지 않습니다.
- 게임 에너지는 추정입니다. 두 개가 동시에 돌아도 각각 전체를 받지 않습니다.
- 측정하지 못한 숫자는 알 수 없음으로 남습니다. 0으로 보이지 않습니다.
- 충전 제한은 Steam에 있는 스위치만 바꿉니다. 비율은 Steam에서 바꿉니다.
- 기록은 기기에 남고, 올리지 않습니다.
- Steam Deck 한 대(Galileo)에서 써 보았습니다. 다른 기종은 확인하지 않았습니다.

## 라이선스

[BSD 3-Clause](./LICENSE). Copyright (c) 2026, Zachary. 이것은 독립 플러그인이며 Valve, SteamOS, Decky의 공식 프로젝트가 아닙니다.
