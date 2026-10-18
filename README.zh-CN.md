<h1 align="center">Power Timeline</h1>

> Steam Deck 的电量记录。QAM 里看现在，也能翻以前。

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.pt.md">Português</a> · <a href="./README.es.md">Español</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a>
</p>
<p align="center">
  <a href="#what">能做什么</a> · <a href="#install">安装</a> · <a href="#try-it">怎么用</a> · <a href="#language">语言</a> · <a href="#limits">请注意</a>
</p>
<p align="center">
  <img src="./docs/qam-home.jpg" alt="QAM 里的 Power Timeline：电量、功率流小图、最近 24 小时和电池信息" width="100%">
</p>

## 能做什么 {#what}

Decky 插件。后台记下电量、整机用电，以及每个游戏的用电。关掉页面，记录不停。

QAM 里可以：

- 看当前电量和功率小图
- 看最近 24 小时，按确认进入时间线
- 充电时看大约还要多久充满
- 开关 Steam 里已有的充电限制
- 打开功率流、电源与电池、游戏历史

时间线看最近 1、3、7 天。左右或横滑，停在某一刻。

## 安装 {#install}

先装 Decky，再安装 [dist/power-timeline-0.2.0.zip](dist/power-timeline-0.2.0.zip)。列表里是 **Power Timeline**。

后端以 root 运行，用来读硬件。不改系统电源，也不动其它插件。

更新再装新 ZIP。卸载不删历史，一般在 `~/homebrew/data/power-timeline/`。

<details>
<summary>从源码构建</summary>

需要 Node.js、pnpm 和 Python 3。

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

`pnpm build` 生成前端。把运行文件打进 ZIP 再安装。不要把数据库放进插件目录。

</details>

## 怎么用 {#try-it}

1. 打开 Decky → **Power Timeline**。先看电量和功率小图。
2. 选中 24 小时图，按确认。上面换最近 1、3、7 天。
3. 移到图上，左右或横滑选一个时刻。图上显示这一刻的电量和功率；当时在玩游戏，就有图标和名字。
4. 充电时能看到大约还要多久充满。充电限制用的是 Steam 里已保存的百分比。
5. 功率小图按确认进功率流。电池那一块按确认进电源与电池。

第一次没有更早的记录，也不补启用前的用电。

## 语言 {#language}

先跟 Steam。QAM 和内页底部有一排国旗。左右或横滑只移动高亮，按确认才切换。提示跟旗子的语言走。

| 国旗 | 界面 | Steam 语言 |
| --- | --- | --- |
| 中国 | 简体中文 | 简体、繁体，以及其它中文 |
| 美国 | 英文 | 英文，以及下面没列出的语言 |
| 葡萄牙 | 葡萄牙语 | 葡萄牙语和巴西葡萄牙语共用 |
| 西班牙 | 西班牙语 | 西班牙语和拉美西班牙语共用 |
| 日本 | 日语 | 日语 |
| 韩国 | 韩语 | 韩语 |

选过会记住。这份说明也是这六种语言，用顶部链接换。

## 请注意 {#limits}

- 插电时看不出整机用了多少电，显示未知，不用充电功率代替。
- 游戏用电是估算。两个游戏同时跑，不会各算一整份。
- 没测到不显示成 0。
- 充电限制只开关 Steam 已有的开关。百分比仍在 Steam 里改。
- 记录在本机，不上传。
- 只在一台 Steam Deck（Galileo）上试过。

## 许可证

[BSD 3-Clause](./LICENSE)。Copyright (c) 2026, Zachary。这是独立插件，不是 Valve、SteamOS 或 Decky 的官方项目。
