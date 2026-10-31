# SimReady → 全息拆解 / SimReady to teardown holograms

把 NVIDIA 公开的 [SimReady](https://huggingface.co/datasets/nvidia/simready-assets) OpenUSD 模型转成贾维斯能投影、能拆开的全息机器，放进 `~/.jarvis/holo`，在 HUD 右上角「3D 拆解」里就能看到。只下载几何（USD 层），不下贴图。

Turns NVIDIA's open SimReady OpenUSD models into Jarvis teardown holograms in `~/.jarvis/holo` (they show up in the HUD's 「3D 拆解」 library). Geometry only, no textures.

## 准备 / Setup

```bash
python3 -m venv ~/.jarvis/simready-venv
~/.jarvis/simready-venv/bin/pip install usd-core numpy certifi pillow
```
（国内网络可以加 `-i https://pypi.tuna.tsinghua.edu.cn/simple`。下载模型会先试 hf-mirror.com，再试 huggingface.co。）

## 试点：5 台指定的机器 / Pilot

```bash
~/.jarvis/simready-venv/bin/python tools/simready/sr_fetch.py tools/simready/pilot.json ~/.jarvis/simready-work ~/.jarvis/holo
```
`pilot.json` 列出模型、许可证和中文部件名（FANUC CRX-10iA 机械臂 Apache-2.0，Robotiq 2F-85 / Hand-E 夹爪、NVIDIA 刹车总成和汽车空调压缩机 CC-BY-4.0）。

## 夜间批量 / Overnight batch

```bash
caffeinate -i ~/.jarvis/simready-venv/bin/python tools/simready/sr_batch.py --lab ~/.jarvis/simready-lab --holo ~/.jarvis/holo --max 100 --hours 8
```
从目录里挑出机械类模型，逐个下载、转换、渲染带编号的预览图，再把图和每个零件的名称、材质、尺寸、位置交给贾维斯的大脑（`~/.jarvis/config.json` 里的 `llm`），按 `naming_rules.md` 给零件起中文名。大脑看不了图时，在 `llm` 里加 `"vision_model"`（比如 DeepSeek 用 `deepseek-flash`）。有把握的直接进 `~/.jarvis/holo`，没把握的放进 `--lab` 下的 `review/` 等人看。进度存在 `batch_state.json`，随时中断，再跑会接着做。

Picks machine-like models, converts each, renders a numbered preview and asks Jarvis's own LLM (needs a vision-capable model; set `llm.vision_model` if the main one is text-only) to name the parts by `naming_rules.md`. Confident results go to `~/.jarvis/holo`, the rest to `review/`. Resumable.

SimReady 模型的许可证见各自目录（大多是 CC-BY-4.0），转换出的全息页里写有来源。 Each converted page records its source and licence.
