<h1 align="center">Power Timeline</h1>

> Steam Deck の電力量記録です。クイックアクセスメニューで、今と以前の使用量を見られます。

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.pt.md">Português</a> · <a href="./README.es.md">Español</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a>
</p>
<p align="center">
  <a href="#what">できること</a> · <a href="#install">インストール</a> · <a href="#try-it">使い方</a> · <a href="#language">言語</a> · <a href="#limits">注意</a>
</p>
<p align="center">
  <img src="./docs/qam-home.jpg" alt="クイックアクセスメニューの Power Timeline。バッテリー、電力フロー、過去24時間、バッテリー情報" width="100%">
</p>

<h2 id="what">できること</h2>

Decky プラグインです。バッテリー、本体の電力、各ゲームの電力量を記録します。ページを閉じても記録は止まりません。

クイックアクセスメニュー：

- 今のバッテリーと、小さな電力フローの図
- 過去 24 時間。確認で時間軸が開く
- 充電中は、満充電までだいたいどれくらいか
- Steam に保存済みの充電制限
- 電力フロー、電源とバッテリー、ゲームの履歴

時間軸は過去 1、3、7 日です。左右、または横に滑らせて、ある時刻で止めます。

<h2 id="install">インストール</h2>

Decky を入れます。[Releases](https://github.com/ZacharyQin/power-timeline/releases/latest) から最新の ZIP をダウンロードし、Decky でその ZIP をインストールします。一覧は **Power Timeline** です。

ハードウェアを読むため、バックエンドは root で動きます。システムの電源方針やほかのプラグインは変えません。

更新は同じ Releases のページから新しい ZIP をダウンロードして、もう一度インストールします。削除しても履歴は消えません。通常は `~/homebrew/data/power-timeline/` にあります。

<details>
<summary>ソースからビルド</summary>

Node.js、pnpm、Python 3 が必要です。

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

`pnpm build` で画面側ができます。実行ファイルを ZIP に入れてください。データベースをプラグインのフォルダに置かないでください。

</details>

<h2 id="try-it">使い方</h2>

1. Decky → **Power Timeline** を開きます。まずバッテリーと小さな電力フローを見ます。
2. 24 時間の図で確認を押します。上で 1、3、7 日を切り替えます。
3. 図に移動し、左右または横滑りで時刻を選びます。その時刻のバッテリーと電力が出ます。ゲームを見ていたなら、アイコンと名前も出ます。
4. 充電中は、満充電までだいたいどれくらいかが見えます。充電制限は Steam に保存済みの割合を使います。
5. 小さな図で確認すると電力フローです。バッテリーの塊で確認すると電源とバッテリーです。

最初は以前の記録がありません。有効にする前の使用量も補いません。

<h2 id="language">言語</h2>

選ぶまでは Steam の言語です。メニューと各ページの一番下に国旗があります。左右または横滑りはハイライトだけを動かします。確認で切り替わります。文はその国旗の言語です。

| 国旗 | 表示 | Steam の言語 |
| --- | --- | --- |
| 中国 | 簡体字中国語 | 簡体字、繁体字、その他の中国語 |
| アメリカ | 英語 | 英語、および下にない言語 |
| ポルトガル | ポルトガル語 | ポルトガル語とブラジルのポルトガル語は共用 |
| スペイン | スペイン語 | スペイン語とラテンアメリカのスペイン語は共用 |
| 日本 | 日本語 | 日本語 |
| 韓国 | 韓国語 | 韓国語 |

選択は覚えておきます。この文書も同じ六言語です。先頭のリンクで切り替えます。

<h2 id="limits">注意</h2>

- 電源接続中は、本体が使った電力は不明です。充電電力では代わりません。
- ゲームの電力量は推定です。同時に二つ動いても、それぞれが全部を受け取るわけではありません。
- 測れなかった数は不明のままです。0 とは出しません。
- 充電制限は Steam の既存スイッチだけを切り替えます。割合は Steam で変えます。
- 記録は機器に残り、送り出しません。
- Steam Deck 1台（Galileo）で試しています。ほかの機種は未確認です。

## ライセンス

[BSD 3-Clause](./LICENSE)。Copyright (c) 2026, Zachary。これは独立したプラグインであり、Valve、SteamOS、Decky の公式プロジェクトではありません。
