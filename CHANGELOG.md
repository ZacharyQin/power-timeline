# Changelog / 更新记录

> Version changes, package metadata and matching changelog entries must be committed together. Changelog entries and release notes use English first, followed by Chinese. Push owner-approved `v*` tags individually: each tag automatically builds its tagged commit and publishes the corresponding GitHub Release. Completing development or verification alone does not authorize creating or pushing tags.
>
> 版本改动、版本号和对应更新记录必须一起提交；更新记录和 Release 说明均为英文在前、中文在后。经项目所有者授权后，逐个推送 `v*` 版本 tag：每个 tag 自动构建其对应提交并发布相应 GitHub Release。开发或验证完成本身不代表获准创建或推送 tag。

## Unreleased

### English

- Separate tag publishing into a dedicated **Release** workflow that reuses the existing checked build pipeline. Each individually pushed `v*` tag produces an installable ZIP and publishes it with that version's complete bilingual changelog section; main-branch and pull-request builds do not publish releases.
- Require the tag to exist remotely when publishing. Automated release creation does not create or retarget version tags.
- Recover an owner-approved existing tag through **Release → Run workflow** on `main`, supplying the version tag, or run `gh workflow run release.yml --repo ZacharyQin/power-timeline --ref main -f tag=v0.3.11`. Build and publication both check out that tag; package-version validation and the complete bilingual notes use the selected tag. Isolate build concurrency by tag so parallel recoveries do not cancel each other.

### 中文

- 将 tag 发版拆为独立的 **Release** workflow，复用现有检查与构建流程。逐个推送的每个 `v*` tag 都生成可安装 ZIP，并以该版本完整的双语更新章节发布；main 分支和拉取请求仅构建，不发布 Release。
- 发布时必须已存在对应远端 tag；自动发布流程不代建或改指向版本 tag。
- 已获所有者授权的已有 tag 可通过 **Release → Run workflow** 在 `main` 上填写版本 tag 补跑，也可执行 `gh workflow run release.yml --repo ZacharyQin/power-timeline --ref main -f tag=v0.3.11`。构建与发布均检出指定 tag，按其校验包版本并提取完整双语说明；构建并发按 tag 隔离，多个版本同时补跑不会互相取消。

## 0.3.13 — 2026-10-28

### English

- Include daily battery-health history and account-scoped persistent game icons from the preceding development build. Health observations remain independent of rolling timeline retention; saved icons can be reused after their original artwork disappears.
- Archive native icons served from Steam's current `community_assets/images/apps` path as well as its older public-image path. Keep the fixed Steam download origin, exact AppID/image-hash checks and account-scoped stored bytes. Fixes visible game icons not being saved for later reuse.
- Keep the battery-health plot at a fixed 132-pixel height, with coordinates sized to its actual width and fewer date labels in narrow layouts. Prevent large displays from enlarging the chart and its text while preserving real history, range selection and scrubbing.
- Share explicit runtime/source manifests and archive exclusions between local and CI packaging. Exclude authoring GLB/projection files, caches and debug output; preserve runtime images, notices and matching Decky API rebuild sources. Validate source freshness and publish only the exact generated runtime/source ZIP pair.
- Replace the three hardware PNG layers with lossless WebP, preserving visible pixels and transparency. Keep only executable code, WebP assets, Loader metadata and essential offline notices in the install ZIP; provide matching sources separately with a version-specific download link. Disable release source maps and exclude documentation, old PNGs and duplicate license files from the runtime package.

### 中文

- 本版本一并交付此前开发版的每日电池健康度历史与按账户隔离的游戏图标持久缓存。健康度独立于功率历史滚动保留，原图来源失效后可回退已存图标。
- 补齐 Steam 当前 `community_assets/images/apps` 原生图标路径，同时保留旧公共图片路径支持。下载仍限定固定 Steam 来源、精确 AppID／图片哈希与账户隔离，修复图标已显示却未保存、无法在来源消失后复用的问题。
- 健康度图表固定为 132 像素高，按实际宽度绘制坐标，窄布局减少日期刻度，避免大屏把图表与文字一起放大；保留真实历史、范围选择和游标操作。
- 本地与 CI 共用明确的运行包／源码包清单和排除规则，去除设计 GLB／投影文件、缓存和调试产物；保留运行图片、许可声明与匹配的 Decky API 重建源码。打包前校验源码归档是否最新，构建产物只上传本次生成的安装／源码 ZIP 对。
- 三张硬件 PNG 图层改为无损 WebP，保留可见像素与透明度。安装 ZIP 仅保留运行代码、WebP、Loader 元数据与必要离线许可内容；匹配源码单独交付并提供对应版本下载入口。关闭发布 source map，排除运行包中的文档、旧 PNG 和重复许可文件。

## 0.3.12 — 2026-10-28

### English

- Add a daily battery-health curve to Power and battery, with 30-day, 90-day, one-year and all-history views. Keep the last valid full-charge/design capacity ratio per device-local calendar day in `battery-health.sqlite3`, independently of open pages and rolling power-history retention. Preserve above-100% readings and leave unobserved days disconnected. Health-history failures do not stop power recording.
- Persist successfully displayed custom and native game icons by Steam account and AppID in `game-icons.sqlite3`. Continue trying current custom and native artwork first, then use the saved image before the gamepad placeholder when the originals disappear. Cached bytes survive frontend reloads and backend restarts without relying on the old file path or URL.
- Bound icon reads and archived images, restrict native downloads to fixed public Steam icon identities, verify saved image integrity, and keep the previous image if archiving fails. Preserve recorded game/session identities and energy statistics.

### 中文

- 电源与电池内页增加电池健康度曲线，支持 30 天、90 天、1 年和全部历史。在 `battery-health.sqlite3` 按设备本地日历日保留当天最后一次有效满充／设计容量比；页面关闭后仍记录，功率历史滚动淘汰不删除健康度历史。保留超过 100% 的读数，缺失日期断线；健康度记录失败不停止功率录制。
- 将成功显示的自定义及原生游戏图标按 Steam 账户和 AppID 持久保存至 `game-icons.sqlite3`。优先尝试当前自定义图与原生图，原来源失效时使用已保存图片，最后才显示手柄占位。缓存保存图片本身，跨前端重载和后端重启保留，不依赖旧文件路径或 URL。
- 限制图标读取与存储体积，原生图下载仅接受固定的 Steam 公共图标身份，校验缓存完整性，保存失败时保留原有图片。不改历史游戏／会话身份和能量统计。

## 0.3.11 — 2026-10-27

### English

- Use Steam's current library display names for Steam and non-Steam games across QAM, history, session details, timeline labels, legends and tooltips. Keep recorded names when library metadata is unavailable; never reinterpret a user-chosen title as a generated placeholder.
- Share one icon renderer across those views. Respect the icon currently selected in Steam shortcut properties before stale grid files; for Steam games prefer the current account's latest custom artwork before the store icon. Use a gamepad only when no image is available. Decode shortcut SteamGameIds exactly for presentation without changing stored game IDs or merging histories.
- Read saved ICO and shortcut image files when Steam cannot serve them. Scope lookups to the active account, reject non-images and special files, bound image reads, and keep filesystem work off the recorder's event loop. Refresh visible metadata and omit unchanged image payloads.
- Preserve recording, session identity, energy totals, coverage, database schema and hardware settings. This development build does not authorize a commit, push, tag or public release.

### 中文

- QAM、游戏历史、会话详情、时间线标签、图例和提示统一使用 Steam 当前资料库显示名，Steam 与非 Steam 游戏同样处理。资料不可用时保留已记录名称，不把用户自选的标题误当作生成占位名。
- 上述入口共用图标组件：非 Steam 游戏优先使用 Steam 快捷方式属性中当前选定的图标，避免旧 grid 图片反压新选择；Steam 游戏优先使用当前账户最新的自定义图片，再回退商店图标。无可用图片时才显示手柄占位。完整快捷方式 SteamGameId 精确转换仅供展示查询，不修改历史游戏 ID，也不合并历史。
- 补齐 Steam 无法直接提供的 ICO 和快捷方式图片读取；限定当前账户，拒绝非图片和特殊文件，限制单图读取体积，文件工作移至录制事件循环之外。可见资料持续刷新，图片未变时不重复传输内容。
- 保留录制、会话身份、能量、覆盖时长、数据库 schema 和硬件设置；本开发版本不代表获准 commit、push、打 tag 或公开发布。

## 0.3.10 — 2026-10-27

### English

- Read saved names for user-added non-Steam games from Steam's binary `shortcuts.vdf`. Resolve both the unsigned shortcut AppID and its full SteamGameId as exact strings, preserving the recorded identity rather than merging histories or guessing a title from an executable.
- Locate the player's Steam directory through `DECKY_USER_HOME`, not the root backend's `HOME`. Refresh changed shortcut catalogs while the frontend is closed and backfill names for already-recorded games, including games first observed after backend startup.
- Keep the last complete catalog during a partial rewrite; do not choose arbitrarily between conflicting account names. Removing a shortcut does not erase a name already stored in history. Metadata alone never creates a running game or session.
- Preserve sample/session identities, observations, Wh and coverage. No database schema, chart layout or frontend naming workaround is added.

### 中文

- 从 Steam 二进制 `shortcuts.vdf` 读取用户添加的非 Steam 游戏名称；用精确字符串同时匹配无符号快捷方式 AppID 与完整 SteamGameId，保留原记录身份，不合并历史，也不凭可执行文件猜游戏名。
- 通过 `DECKY_USER_HOME` 查找玩家的 Steam 目录，不再误用 root 后台的 `HOME`。前端关闭时仍检查快捷方式目录变化，为已有记录回填名称，也覆盖后台启动后才首次记录的游戏。
- Steam 部分重写配置时保留上一份完整名称目录；不同账户的名称冲突不任意选取。删除快捷方式不会清除历史中已保存的有效名称；只有名称元数据不会产生运行游戏或会话。
- 保留样本／会话身份、观测记录、Wh 与覆盖时长，不改数据库 schema、图表布局，也不增加前端猜名分支。

## 0.3.9 — 2026-10-27

### English

- Enforce `max_points` for both bucketed timelines and unbucketed/session-detail queries. Keep real first/last samples and retain boundaries and per-segment extrema when they fit; if the required set exceeds the budget, select across the whole range and conservatively separate samples across omitted segment, NULL or explicit-break boundaries. Never truncate the range or create synthetic samples.
- Decode only the selected plot samples after scanning typed columns. Filter integration rows with `system_start_w IS NOT NULL` and select only the columns used by clipping; retain zero power, the original interpolation and accumulation order. Events, energy and covered time are independent of the plot cap.
- Keep sampling, schema, read-only snapshot isolation, history-worker locking, frontend caching and event SQL unchanged. Include the regression tests in the matching-source archive.
- Local package only: this build does not install or replace the Steam Deck package, or authorize a commit, push, tag or public release.

### 中文

- 分桶时间线与未分桶／会话详情查询均严格执行 `max_points`。保留真实首尾，预算足够时保留边界与分段极值；必要点集超过上限时，覆盖整个范围选点，并在被省略的分段、NULL 或明确断点处保守断线。不截断时间范围，不生成虚构样本。
- 扫描类型化列后，仅解码最终选中的曲线样本。积分查询先筛选 `system_start_w IS NOT NULL`，只取裁剪所需列；保留零功率、原有插值与累加顺序。事件、能量与覆盖时长独立于曲线点数上限。
- 采样、schema、只读快照隔离、历史 worker 锁、前端缓存和事件 SQL 不变。对应源码包一并包含回归测试。
- 仅生成本地安装包：本次不安装或覆盖 Steam Deck 上的包，也不代表获准 commit、push、打 tag 或公开发布。

## 0.3.8 — 2026-10-26

### English

- Add **Settings → Open-source licenses**, with native component lists, details and an offline full-text reader. Preserve the current reading level and focus across page visits; Back returns one level at a time. Localize the interface in all six languages without translating the license originals.
- Center license-row chevrons against the complete title-and-description row, including settings and document entries, without changing text layout or navigation.
- Render QAM and full-page timeline coordinates immediately from the selected time window, then update the same chart with recorded data. Keep query errors and retries, but do not invent samples, energy or coverage while history is pending. History caching and backend algorithms are unchanged.
- Generate notices from code actually included in the bundle. Distinguish bundled Decky API and React Icons, Font Awesome SVG and Feather artwork, host/system-provided interfaces, and the Valve-CAD-derived hardware illustration. Do not present build-only dependencies as runtime code or assert host runtime versions.
- Distribute original notices, LGPL-2.1 and CC-BY-4.0 texts, separate Valve artwork terms, and matching application/Decky API source with rebuild instructions in `dist/license-sources.zip`. The software BSD license does not relicense third-party code or the non-commercial/share-alike artwork. License reading is independent of recording and network availability.
- This development build is not approval to tag, push or publish a release.

### 中文

- 增加“设置 → 开源许可”，提供原生组件列表、详情和离线全文阅读；保留阅读层级与焦点，返回逐级退回。界面覆盖六种语言，许可原文不翻译替代。
- 许可条目右侧箭头相对“标题＋说明”的整行垂直居中，设置入口与文档条目同步生效，不改变文字布局和导航。
- QAM 与内页时间线先按当前时间范围立即绘制空坐标，历史数据返回后原位更新曲线；保留查询错误与重试，不虚构样本、能量或覆盖时长。本次不改历史缓存和后台算法。
- 根据实际进入 bundle 的代码生成声明；区分随包 Decky API、React Icons、Font Awesome SVG 与 Feather 图形、宿主／系统接口及基于 Valve CAD 改编的硬件示意素材，不把纯构建依赖列为运行代码，也不冒认宿主实际版本。
- 随包保留原始声明、LGPL-2.1 与 CC-BY-4.0 全文、独立的 Valve 素材条款，以及 `dist/license-sources.zip` 内对应的应用／Decky API 源码和重建说明。软件 BSD 许可不改变第三方代码及非商业／相同方式共享素材的许可。许可阅读不依赖录制状态与网络。
- 此开发版本不代表已获准打 tag、push 或公开发布。

## 0.3.7 — 2026-10-25

### English

- Replace the shared README hero image with language-matched, on-device QAM screenshots for all six languages, using consistent framing and localized captions.
- Add a fan-icon heading with only two native tabs, **System automatic** and **Maximum speed**. Omit L1/R1 hints, the dropdown, the extra RPM row and explanation text. Left/right only moves native focus; **A** confirms a mode change. Show the complete matching chart only when the backend has confirmed automatic mode, and hide it in maximum mode; moving focus does not change chart visibility. Report errors through native notifications, preserve the component ID and saved position, and update all six UI languages and READMEs.
- Maximum mode requests 7300 RPM and continues with QAM closed. An independent transient systemd worker, backend lease and ExecStopPost handle abnormal exits: first write 0 to return control to the EC, then restore the original OS service state. A logind delay inhibitor requests restoration before sleep, and maximum mode is not replayed after restart. Do not change the official curve or permanently enable or disable the service.
- Wait for the official service's stop job and ExecStopPost before taking control. Refuse takeover when a manual target, download mode, service transition or hardware fault is present. Relinquish control when an external target or service takeover is detected, without overwriting the new controller. Report restoration failures explicitly and distinguish degraded recovery that has already returned control to the EC.
- All 102 backend tests, including 16 fan-boundary tests, five frontend regression tests, type checking and the build pass. On-device keyboard checks cover focus-only navigation, confirmation, chart visibility following the backend mode, and complete tab labels in the narrow QAM panel for all six languages. With QAM closed, the target remained 7300 RPM and the measured speed was 7352 RPM with no fault; confirming automatic restored automatic control. The earlier real 9/KILL check that restored the official automatic service remains valid. Controlled sleep/reboot and physical controller/touchscreen acceptance are still pending.

### 中文

- 六种语言的 README 头图由共用图片改为各自语言的实机 QAM 截图，统一取景并同步图片说明。
- QAM 风扇组件增加带风扇图标的标题，下方仅保留“系统自动／最大转速”两个原生 Tab，不显示 L1/R1 提示、下拉框、转速读数与解释文字；左右只移动原生焦点，A 确认后才切档。完整匹配图仅在后台已确认的系统自动档显示，最大档隐藏，焦点移动不影响显隐；异常通过原生通知提示，保留原组件 ID、排序位置，六语界面与 README 同步说明。
- 最大档请求 7300 RPM，关闭 QAM 后继续。独立 systemd 临时工作进程、后台租约和 ExecStopPost 处理异常退出，先写 0 归还 EC，再按原状态恢复官方 OS 服务；logind 延迟锁用于休眠前恢复，重启不重放最大档。不修改官方曲线或永久启用／禁用服务。
- 接管前等待官方服务停止作业与 ExecStopPost 完成；已有手动目标、下载模式、服务切换或硬件故障时拒绝接管。检测到外部目标／服务接管时退出自身控制，不覆盖新控制器；恢复失败明确报告并区分已归还 EC 的降级状态。
- 102 项后端（含 16 项风扇边界测试）、5 项前端回归、类型检查与构建通过。实机键盘已验证左右只聚焦、确认切档、图表随后台档位显隐，六语 Tab 在 QAM 窄栏内完整显示；关闭 QAM 后保持 7300 目标，实读 7352 RPM、故障为零，再确认恢复自动。此前独立服务真实 9/KILL 后恢复官方自动服务的验证仍有效；受控休眠、整机重启及实体手柄／触屏验收仍未完成。

## 0.3.6 — 2026-10-25

- QAM 各组件的上下间距统一为 8px，由布局容器集中控制；移除电池信息、游戏、外壳温度、风扇曲线和语言栏等组件叠加的外部 margin 与原生字段上下 padding，阻止子元素 margin 穿透组件边界。
- 普通和排序状态使用相同组件间距；普通状态的空组件不占位，排序状态仍保留隐藏项。限额条保持 24px 高度、原有透明热区及开关到滑条的内部间距，不改图表内容、组件排序、采样或充电逻辑。
- 根目录仅保留英文 README.md，其余五种语言的 README 移入 docs/readme/；同步更新语言切换、更新记录、截图路径及发行包文件清单。

## 0.3.5 — 2026-10-25

- QAM 电池限额条高度由 36px 降为 24px，下方与最近 24 小时区块的间距由 22px 缩至 6px；保留向上下各扩展 4px 的透明触控范围及原有充电限额交互。
- QAM 分流图使用现有浅色语义前景，图标和标签不再叠加灰色淡化；标签由 8.5px 增至 10px 并加粗。提高输入、APU、外设及电池色带的不透明度，内页分流图与数据口径保持不变。

## 0.3.4 — 2026-10-25

- 电源与电池内页先显示电量信息，再显示航行模式；QAM 的限额条移到充电限制开关下方，原有交互和组件排序保留。
- 航行模式改为设置差异值 Delta（百分点），充电下限由 Steam 上限减去 Delta 自动计算，不再独立设置下限。旧设置按原区间换算，保留等待／充电状态、Steam 设置优先及恢复机制；原有下限至少 20% 的边界不变。
- 86 项后端回归与类型检查通过，覆盖 Delta 随 Steam 上限变化、重启保留、旧设置迁移、无效输入不释放现有控制及完整滞回。完整真实充电循环、休眠和重启验收仍未完成。

## 0.3.3 — 2026-10-24

- 活动库继续限制为 256 MiB，改为满额后滚动淘汰最旧记录并继续录制，不再因正常容量耗尽而停录。复用空闲页，不在采样循环中执行 VACUUM。
- 淘汰与新写入共用事务；失败一起回滚。同步移除过期积分、游戏分摊、会话及无引用字典项，保留最新采样端点。会话保存采样 ID 边界，时钟回拨也按入库先后淘汰；旧版会话边界自动升级。
- 跨保留边界的会话标记为部分记录，起点、电量及能量统计只覆盖保留区间；充电结束缓存随历史淘汰同步重建。六语界面与文档同步说明。
- 83 项后端回归通过；实机隔离副本填满 268,435,456 字节后完成滚动并追加 20 条真实传感器采样，文件大小仍为 256 MiB，完整性及外键检查通过。正式库未用于填满测试。原迁移备份不自动删除，备份与事务日志另占磁盘空间。

## 0.3.2 — 2026-10-24

- 历史采样改用 SQLite 原生数值列和字符串字典；错误集合、会话原因使用关联表，不再逐行保存 JSON 载荷。保留秒级采样、双精度、未知值、三种时钟、分段及原有积分区间和索引。
- 首次启动自动迁移旧库：在旁路新库完成转换和完整性检查，保留完整 `timeline.pre-typed-*.sqlite3` 备份后原子切换；失败保留旧库，成功后可继续录制。原有 256 MiB 活动库上限和满额停录策略不变，回滚备份额外占用磁盘。
- 历史曲线、休眠端点、游戏分摊与充电记录恢复直接读取结构化 SQLite 数据，对外 API 不变；回退旧插件需要同时恢复旧数据库。
- 实机迁移验收：569,537 条旧采样、566,960 个积分区间、3,805 条游戏分摊及 15 场会话逐项一致，完整性与外键检查通过；活动库由 256 MiB 降至约 110 MiB。真实历史／会话 RPC 与原版在相同数据输入下完全一致，录制恢复后首批 192 条采样最大间隔 1.003 秒，未跨停录空档生成积分。

## 0.3.1 — 2026-10-24

- 按用户要求移除 QAM 的航行模式开关，仅保留电源与电池内页的原生控制；后台控制与 QAM 原有 Steam 充电限额不变。

## 0.3.0 — 2026-10-24

- QAM 与电源与电池内页增加共享的航行模式开关，默认关闭；内页提供下限调节，上限使用 Steam 原生限额。
- 独立后台保存等待／充电阶段，处理区间内启用、重接电和上下限切换，不主动放电；页面关闭不停止控制。
- 增加原生设置租约、单控制器锁、独立进程恢复守护和硬件响应超时。关闭或卸载恢复接管前限额，原生设置变化和外部抢写优先；唤醒后等待新原生设置再接管。
- 实机已验证内页开启、QAM 共享状态、关闭页面与 QAM 后继续运行，以及单插件重载：100 ms 采样读到硬件限额 70%→80%→70%；再从 QAM 关闭模式，限额恢复 80%，Steam 原生设置始终保持开启、80%。初次等待态为 SOC 80%、外接供电且未充电，后续离电时为 78%。真实下限触发、回升充电、上限停充及等待／充电两状态的睡眠与整机重启验收仍未完成，不将本地测试或插件重载当作这些项目通过。

## 0.2.1 — 2026-10-22

- QAM 增加 Steam Deck 正面外壳。零件温度用引线标出，风扇转速标在出风口。
- QAM 增加风扇曲线。功耗轴、温度轴和拖动读数按已确认的曲线保留。
- 充电限额从开关改成可调刻度。A 进入和确认，未确认时 Y 还原，确认后 Y 回到 80%。
- QAM 里的功率流大约 3 秒才换一次读数，避免数字跟着采样跳。
- 温度只读有名字的 hwmon。没有标签的传感器不计入。
- 完整页使用固定导航、固定页头和独立正文滚动区；修正 Steam 原生按钮最小宽度覆盖导致的导航越界，恢复主栏留白。
- 时间线与会话详情按分区工作台重排：双曲线保留完整刻度与游标，摘要独立放置；会话进程估算移到图表下方，CPU/GPU 分项继续保留。
- 时间范围工具栏使用原生横向焦点容器，修正正文改为独立滚动区后左右方向无法切换范围按钮的问题。
- QAM 的 10 个展示块支持原地排序，取消独立排序弹窗：A 抬起/放下，上下选择或移动，B 撤销本次移动或取消草稿，X 保存退出，Y 恢复默认。抬起块突出显示、其余淡化，焦点及滚动跟随；排序时隔离组件原有操作，保留触摸/鼠标块内移动按钮与隐藏组件的位置。顺序继续保存在本机，兼容既有配置。
- 修复 QAM 上下导航卡顿：历史图不再随每秒快照重绘，复用日期格式器与缺口说明；合并断开的曲线子路径、移除缺口的冗余 SVG 分组，保留断线、睡眠区间、逐项提示与手柄交互。
- 历史查询在串行工作线程中读取独立的只读内存快照，避免长查询堵住采样循环或锁住写入；请求取消后，后台查询仍持有串行锁直至资源释放，卸载先排空查询。保留原有 DELETE 日志、磁盘上限和原始历史。
- 时间线事件先筛选缺口与供电切换，再解析详情，减少重复 JSON 解码；覆盖范围、能量积分、时钟跳变与睡眠边界保持不变。

## 0.2.0 — 2026-10-18

- 电池信息增加容量、循环次数，以及会保留下来的充电计时。排版改紧凑。
- 增加实时功率流页面。QAM 里放一张缩小的功率流图。
- 时间线可以看最近 1、3、7 天。选中某个采样后，标签留在页面上，不整页重载。
- 界面可以在简体中文、英语、葡萄牙语、西班牙语、日语、韩语之间切换。
- 安装包改从 GitHub Releases 下载。

## 0.1.0 — 2026-10-17

- 后台记录电量、整机功率，以及每个游戏的用电。关掉页面，记录不停。
- QAM 里看当前状态和最近 24 小时。
- 可以看时间线、游戏记录和单次会话。
- 卸载不删除 `~/homebrew/data/power-timeline/` 里的历史。
