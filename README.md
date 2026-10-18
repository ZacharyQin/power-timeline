<h1 align="center">Power Timeline</h1>

> Record battery level, system power, and game energy on a Steam Deck, and open the timeline, power flow, and power details from the Quick Access menu.

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>
<p align="center">
  <a href="#install">Install</a> · <a href="#try-it">Try it</a> ·
  <a href="#read-the-numbers">Numbers</a> · <a href="#controls">Controls</a> · <a href="#limitations">Limitations</a>
</p>

Closing the Quick Access menu or a full page does not stop recording. The backend samples about once a second and keeps history in a local SQLite database. Battery percentage, whole-system power, and per-game energy stay separate: plugged-in time is not counted as system watt-hours, and game CPU/GPU energy is an activity-weighted estimate, not a per-process meter. Unknown stays unknown. It is not filled in as zero.

0.2.0 recording, the 1/3/7-day timeline, the power-flow page, and the charge-limit switch were checked on one Steam Deck (Galileo, EC 4352) with Decky. Other models, handhelds, and SteamOS versions are unverified.

## Read the numbers

| Number | Meaning |
| --- | --- |
| Battery % | Percentage reported by the battery. A change is in percentage points, not watt-hours |
| System W / Wh | Integrated from current × voltage only while external power is confirmed offline and the battery is discharging. Includes the screen and background |
| Hardware W | AMDGPU telemetry. APU is not added to the CPU, SoC, and GPU parts |
| Game CPU/GPU Wh | `activity-weighted-v1` estimate. The two domains can cover different time, and a missing domain is not zeroed into a fake average |
| Time to full | Shown only while actually charging on external power, with a matching UPower state no older than 90 seconds. It can go up or down with the source. It is not a local countdown |
| Since charge ended | Counted from a continuously observed Charging → Full / not charging / discharging boundary. It is not time since unplug |
| Charge limit | The QAM switch writes Steam's `steamos_charge_limit_enabled`. The stop percentage is the value already saved in Steam settings. A firmware reading of 0 means no limit, not a 0% cap |
| Power flow | Battery output while discharging, and the checked EC VBUS × IBUS while on external power. Peripheral watts are a remainder estimate, including path loss, not a separate meter |

Watt numbers use fixed bands: `0–<5` blue, `5–<10` cyan, `10–<15` teal, `15–<20` pale gold, `≥20` warm orange. The band is magnitude only, not a safety or efficiency score. Watt-hours only distinguish measured system energy from the process estimate.

## Install

Decky Loader on SteamOS is required. The plugin sets the official `root` flag, so **the whole Python backend runs as root**. The EC read accepts only the checked Galileo / F7G0114 / board 5 / EC 4352 identity. Other hardware keeps those readings unknown. It does not call sudo, and it does not change power settings or other plugins.

### From a local package

The build output is [dist/power-timeline-0.2.0.zip](dist/power-timeline-0.2.0.zip). Install that ZIP through Decky. The archive root is `power-timeline/`, containing `plugin.json`, `package.json`, `main.py`, `LICENSE`, `README.md`, `README.zh-CN.md`, `dist/index.js`, and `py_modules/*.py`. Tests, development dependencies, and the database are not included.

After installation, Decky should list **Power Timeline**. The stable directory name is `power-timeline`.

GitHub Actions builds this ZIP on every push and pull request. Download it from the workflow artifacts.

<details>
<summary>Build from source</summary>

Node.js, pnpm, and Python 3 are required. The backend uses the standard library only.

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

`pnpm build` writes `dist/index.js`. Pack the runtime files listed above into the ZIP, then install it. Do not put the database inside the plugin directory.

</details>

## Try it

1. Open Decky → **Power Timeline**. In the Quick Access menu, look at the battery level and the small power-flow diagram.
2. Focus the 24-hour battery chart and press confirm to open the battery timeline. Switch **Last 1 day / 3 days / 7 days**.
3. Move down onto the chart. Left and right select samples; a horizontal drag does the same. The reading under the chart is that sample. After a historical point is selected, the range stays fixed. Press the same day tab again to return to the latest samples in that range.
4. While charging, the Quick Access **time to full** shows the system estimate. **Charge limit** uses the percentage already stored in Steam's power settings.
5. Focus the power-flow diagram and press confirm for the power-flow page. Focus the battery and power facts and press confirm for power and battery.

The first launch has no earlier history and does not invent energy from before it was enabled. A game that is already running is marked as observed mid-run.

## Controls

Quick Access:

- **24-hour chart**: select a battery point with left/right or touch, then confirm to open the battery timeline.
- **Power flow**: confirm to open the power-flow page.
- **Time to full**: hourglass icon. The number is the system estimate, with the unit set apart.
- **Charge limit**: toggles the charge limit Steam already has. It does not write a second sysfs value.
- **Battery and power facts**: confirm to open power and battery.

Full pages:

- **Battery timeline**, **power flow**, and **power and battery** are sibling pages. Back returns to Steam, not to another plugin page.
- The timeline uses tabs for 1/3/7 days. Points are clustered in time buckets: 300 seconds for 1 day, 900 for 3 days, and 2100 for 7 days. Only buckets that contain a sample are kept. A 1-day axis is marked in hours, to the minute. A 3-day or 7-day axis is marked by date, with 6-hour or 12-hour ticks between dates.
- Hardware domains can show APU, CPU, SoC, and GPU. Game intervals use a pale background; short intervals are identified in the legend under the chart.
- **Statistics** at the bottom collects the counting rules. Going back keeps the page, range, and selected point.

## Update or uninstall

Install a new ZIP, or replace `~/homebrew/plugins/power-timeline` and reload the plugin in Decky. A reload ends the current session and starts a new observation. A sample that was not committed is not reconstructed.

Stop the plugin before uninstalling or disabling it, then back up the data directory. The database lives in Loader's `DECKY_PLUGIN_RUNTIME_DIR`, usually `~/homebrew/data/power-timeline/`. Do not delete the database while the recorder still holds its lock. Uninstalling the plugin does not delete history.

## Limitations

- System power is computed only during confirmed battery discharge. While external power is connected, system power is unknown. Battery net charge power is not system input.
- Peripheral watts are a remainder estimate, not a separate meter. PD voltage × current is only the negotiated limit.
- Game CPU/GPU energy is not a kernel per-PID energy counter. Parallel games do not each receive a full copy of system energy.
- After sleep, a clock jump, or an unknown battery state, time since charge ended keeps the end date and does not report elapsed time. A late sample by itself does not erase that elapsed time.
- The timeline is bucketed so it can be drawn. It is not one point per second. Session detail still downsamples on raw boundaries. If those boundary points exceed the cap, that query is rejected instead of inventing a curve.
- The charge-limit control only toggles the switch in Steam settings. The percentage is still edited in Steam's power settings.
- EC input supports only the checked hardware revision. Other models stay unknown.
- A physical small screen, a full sleep matrix, long-term self consumption, and absolute estimate accuracy are not claimed here.

## Privacy

Records stay on the device. Samples, sessions, and game names are written to the SQLite database above. The plugin reads the battery, AMDGPU telemetry, and a whitelisted EC window. The EC mapping is a read-only 4 KB view. The charge limit is written through Steam client settings, not by editing system power-policy files. It makes no network requests and does not upload samples.

## Development

Based on the [Decky plugin template](https://github.com/SteamDeckHomebrew/decky-plugin-template). The interface is TypeScript and React. The backend is the Python standard library.

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

HTML under `design/` is an early mock, not the running plugin.

## License

[BSD 3-Clause](./LICENSE). Copyright (c) 2026, Zachary. This is an independent plugin, not an official Valve, SteamOS, or Decky project.
