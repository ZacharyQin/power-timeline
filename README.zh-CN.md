<h1 align="center">Power Timeline</h1>

> 在 Steam Deck 上记录电池、整机功率和游戏能耗，并从 QAM 直接打开时间线、功率流和电源详情。

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>
<p align="center">
  <a href="#install">安装</a> · <a href="#try-it">试一试</a> ·
  <a href="#read-the-numbers">读数</a> · <a href="#controls">操作</a> · <a href="#limitations">限制</a>
</p>

关掉 QAM 或完整页不会停止记录。后台大约每秒采一次，历史写在本机 SQLite 里。电量、整机功率和游戏进程能耗分开统计：插电时不算整机瓦时，游戏 CPU/GPU 是活动加权估算，不是每进程电表。未知保持未知，不补成 0。

已在一台 Steam Deck（Galileo，EC 4352）上用 Decky 核对过 0.2.0 的采集、1/3/7 天时间线、功率流和充电限制开关。其它机型、掌机和 SteamOS 版本未验证。

## 读数

| 数字 | 含义 |
| --- | --- |
| 电量 % | 电池上报的百分比。变化量是百分点，不能直接换成 Wh |
| 整机 W / Wh | 只在确认拔掉外接电源且电池放电时，由电流 × 电压积分。包含屏幕和后台 |
| 硬件域 W | AMDGPU 遥测。APU 不与 CPU、SoC、GPU 分项相加 |
| 游戏 CPU/GPU Wh | `activity-weighted-v1` 估算。两个域的覆盖可以不同，缺一个就不合成假的平均功率 |
| 预计充满 | 仅在确实充电、外接供电、UPower 状态匹配且来源不超过 90 秒时显示。会随来源变长或变短，不是本地倒计时 |
| 距上次充电结束 | 从连续观测到的 Charging → Full／未充电／放电边界起算，不是距上次拔电 |
| 充电限制 | QAM 开关写入 Steam 的 `steamos_charge_limit_enabled`。停止百分比沿用 Steam 里已保存的值。固件读数为 0 表示不限制，不是 0% 上限 |
| 功率流 | 放电看电池输出，外接看已核对 EC 的 VBUS × IBUS。外围是差额估算，含通路损耗，不是独立电表 |

W 数字另按固定档着色：`0–<5` 蓝、`5–<10` 青蓝、`10–<15` 青绿、`15–<20` 淡金、`≥20` 暖橙。这只表示大小，不是安全或效率评分。Wh 只区分整机实测和进程估算。

## 安装

需要 SteamOS 上的 Decky Loader。插件声明了官方 `root` 标志，**整个 Python 后端以 root 运行**。EC 读取只接受已核对的 Galileo／F7G0114／board 5／EC 4352；身份不符时相关读数保持未知。不调用 sudo，也不改电源配置或其它插件。

### 从本地安装包

构建产物是 [dist/power-timeline-0.2.0.zip](dist/power-timeline-0.2.0.zip)。用 Decky 的本地 ZIP 安装。包内根目录为 `power-timeline/`，含 `plugin.json`、`package.json`、`main.py`、`LICENSE`、`README.md`、`README.zh-CN.md`、`dist/index.js` 和 `py_modules/*.py`。不含测试、开发依赖或数据库。

安装后在 Decky 里应能看到 **Power Timeline**。稳定目录名是 `power-timeline`。

GitHub Actions 会在每次推送和拉取请求时构建这个 ZIP，可从工作流产物下载。

<details>
<summary>从源码构建</summary>

需要 Node.js、pnpm 和 Python 3。后端只用标准库。

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

`pnpm build` 生成前端 `dist/index.js`。再把上面列出的运行文件打进 ZIP 后安装。不要把数据库放进插件目录。

</details>

## 试一试

1. 打开 Decky → **Power Timeline**。QAM 里先看电量和功率流小图。
2. 聚焦 24 小时电量图后按确认，进入电池时间线。用 **最近 1 天 / 3 天 / 7 天** 切换范围。
3. 手柄下到图上，左右选择样本；也可以横向拖动。读数在图下，精确到该样本。选中历史点后范围固定，再点一次对应的天数页签会回到该范围的最新记录。
4. 充电时，QAM 的「预计充满」给出系统估计；「充电限制」沿用 Steam 电源设置里的百分比。
5. 聚焦功率流后按确认进入功率流内页。聚焦电池信息与电源参数后按确认进入电源与电池。

首次启用没有更早的历史，不会反推启用前的耗电。已经在跑的游戏标成中途开始观测。

## 操作

QAM：

- **24 小时图**：左右或触摸选择电量点，确认进入电池时间线。
- **功率流**：确认进入功率流内页。
- **预计充满**：沙漏图标。数字是系统估计，单位单独排开。
- **充电限制**：开关 Steam 已有的充电限制，不另写一份 sysfs。
- **电池信息与电源参数**：确认进入电源与电池。

完整页：

- **电池时间线**、**功率流**、**电源与电池** 是平级页面。返回都回到 Steam，不经过另一内页。
- 时间线用页签切换 1／3／7 天。图按时间桶聚类：1 天 300 秒、3 天 900 秒、7 天 2100 秒，只保留有样本的桶。1 天的横轴按小时分段、标到分钟；3 天和 7 天按天标日期，中间保留 6 小时或 12 小时刻度。
- 硬件功耗域可展开 APU、CPU、SoC、GPU。游戏区间用淡色背景标识，短区间在图下图例里看。
- 页尾「统计说明」集中放统计规则。返回保留原来的页面、范围和选中点。

## 更新或卸载

更新时重新安装新的 ZIP，或替换 `~/homebrew/plugins/power-timeline` 后让 Decky 重载插件。重载会中断当前会话并开始新的观测；未提交的最后一拍不补算。

卸载或禁用前先停掉插件，再备份数据目录。数据库在 Loader 的 `DECKY_PLUGIN_RUNTIME_DIR`，通常是 `~/homebrew/data/power-timeline/`。不要在采集进程仍持有锁时删除数据库。卸载插件不会自动删除历史。

## 限制

- 整机功率只在确认的电池放电上计算。外接供电时整机项是未知，不能把电池净充电功率当成整机输入。
- 外围瓦数是差额估算，不是独立电表。PD 电压 × 电流只是协商上限。
- 游戏 CPU/GPU 能量不是内核每 PID 电能。并行游戏不会各自复制一整份整机能耗。
- 距上次充电结束在休眠、时钟跳变或未知电池状态后只保留结束日期，不报经过时长。采样晚到本身不会抹掉这个时长。
- 时间线为了能画出来做了分桶，不是每一秒一个点。会话详情仍按原始边界降采样；边界点超过上限时，该查询会拒绝而不是编造曲线。
- 充电限制只切换 Steam 设置里的开关，百分比仍在 Steam 的电源设置中修改。
- EC 输入只支持已核对的那一版硬件。其它机型保持未知。
- 物理小屏、完整休眠矩阵、长期自耗电和估算绝对精度没有在本说明里当成已通过。

## 隐私

记录留在本机：样本、会话和游戏名写入上面的 SQLite。插件读取电池、AMDGPU 遥测，以及白名单 EC 窗口；EC 映射是只读的 4KB。充电限制通过 Steam 客户端设置写入，不改系统电源策略文件。没有网络请求，也不上传采样。

## 开发

基于 [Decky 插件模板](https://github.com/SteamDeckHomebrew/decky-plugin-template)。界面是 TypeScript／React，后端是 Python 标准库。

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

`design/` 里的 HTML 只是早期对照，不是运行中的插件。

## 许可证

[BSD 3-Clause](./LICENSE)。Copyright (c) 2026, Zachary。这是独立插件，不是 Valve、SteamOS 或 Decky 的官方项目。
