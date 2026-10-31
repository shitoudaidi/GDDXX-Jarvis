# J.A.R.V.I.S · 贾维斯 2.0

一个跑在你自己电脑上的私人助理：一直在后台听 “Hey Jarvis”，用电影里的英式管家声音回答，全息 HUD 显示它在做什么。
听、说、唤醒、声纹、界面全部在本机完成；理解和决策交给**你自己选的大模型**（DeepSeek、通义千问、Kimi、智谱、OpenAI，或本地 Ollama）。

支持 **macOS 12+**（Apple 芯片或 Intel）和 **Windows 10/11**（64 位）。

[English](#english)

## 能做什么

- **语音对话**：说 “Hey Jarvis” 唤醒，可以直接接着说命令；说话时可以随时打断它；回答后几秒内追问不用再喊唤醒词。命令可以说中文，回答是英文语音 + 中文字幕。直播或开会时点屏幕上方的「聆听中」按钮（或按 M）暂停聆听，再点一次恢复。点「自动演示」，贾维斯会自己把各项功能演示一遍。
- **日程与提醒**：口头告诉它今天要做什么，它整理成日程，到点前 5 分钟提醒。
- **系统状态**：CPU、内存、网络、电量实时显示在 HUD 上。
- **长期记忆**：记得聊过什么、做过什么，可以让它记住或忘掉某件事。
- **声纹**：录一次你的声音，之后只回应你。
- **全息演示**：机器拆解、星舰发射到回收、Roadster 悬停、Optimus 行走，可以用手势旋转和拆装。自带 7 台机器（猛禽发动机、汽车发动机、变速箱、电机、离心泵、燃气轮机、涡扇），自己加的放进 `~/.jarvis/holo/`，见 [jarvis/holo_samples](jarvis/holo_samples/README.md)。
- **8 套皮肤**：每套都有自己的核心动画，跟着贾维斯的听、想、说变化。
- **插件**（可在设置里关掉）：米家设备控制、高德天气和路线、DeepSeek Harness 做文档和程序、抖音创作者数据。
- **学会新能力**：做不到的事会记下来，你批准后由它的“大脑”编写新技能，你确认后才安装。

## 安装

1. 到 [Releases](https://github.com/shitoudaidi/GDDXX-Jarvis/releases) 下载：
   - Mac：`Jarvis-2.0.2-arm64.dmg`（Apple 芯片）或 `-x86_64.dmg`（Intel），把 Jarvis 拖进「应用程序」。
   - Windows：`Jarvis-Setup-2.0.2.exe`，双击安装（不需要管理员权限）。
   - 安装包没有签名。Mac 第一次打开请在「应用程序」里右键点 Jarvis → 打开 → 打开；Windows 提示“已保护你的电脑”时点「更多信息 → 仍要运行」。
2. 第一次打开会在浏览器里显示安装进度：准备 Python 组件、下载约 1 GB 语音模型（国内镜像优先），只需一次。
3. 打开后先弹出 **「接入大脑」**：选服务商，粘贴 API Key，点「测试连接」（会同时测试对话和工具调用），通过后保存。
4. 允许麦克风权限，说 “Hey Jarvis”。

> 模型必须支持工具调用（function calling），否则只能聊天，开灯、日程、全息这些能力用不了。推荐 DeepSeek `deepseek-chat`、通义 `qwen-plus`、Kimi、智谱 `glm-4-flash`；本地可用 Ollama 的 `qwen2.5:7b`。

## 隐私

- 语音识别、唤醒、声纹、合成全部离线运行，录音不离开电脑。
- 发给大模型的只有识别出的文字和工具结果。
- API Key 和所有个人数据（记忆、日程、声纹、地点、米家密钥）只保存在 `~/.jarvis/`，文件权限只有当前用户可读。

## 从源码运行

需要 Python 3.10 以上。

```bash
git clone https://github.com/shitoudaidi/GDDXX-Jarvis && cd GDDXX-Jarvis
python3 app/install.py      # 建虚拟环境、装依赖、下载模型（进度页会自动打开）
python3 app/launch.py       # 打开窗口；语音服务随窗口启动和退出
```

只想调界面：`cd hud && python3 -m http.server`，浏览器打开即可（没有语音服务时用内置演示回复）。

打包：Mac 上 `bash platform/mac/build.sh`，Windows 上 `powershell -File platform\win\build.ps1`（需要 Inno Setup 6）。

## 在它的基础上改

- 加一个语音能力（工具）：在 `jarvis/plugins/` 放一个文件，写 `provide()`，不用改主程序。见 [docs/extend.md](docs/extend.md)。
- 加一套皮肤、一个全息演示、一条 HUD 消息：同样见 [docs/extend.md](docs/extend.md)。
- 目录：

```
jarvis/            语音服务：唤醒、识别、回声消除、合成、大脑、工具
  plugins/         可选插件：mihome amap harness creator demos
  platforms/       Mac / Windows 差异：摄像头、手势识别、文字识别、开机启动
hud/               界面：index.html + css/ + js/（按顺序加载）+ demos/
app/               启动器、首次安装、窗口、模型清单
platform/mac|win   打包脚本
tests/             模拟测试（不需要麦克风和网络）
```

## 许可证

GPL-3.0，见 [LICENSE](LICENSE)。第三方组件和模型的来源与许可见 [NOTICE.md](NOTICE.md)。
默认的 Jarvis 声音是社区训练的 Piper 模型（用电影原声训练），安装时从原始发布地址下载，不包含在本仓库里，仅供个人非商业使用。

---

## English

A private assistant that runs on your own computer: always listening for "Hey Jarvis", answering in the film's British
butler voice, with a holographic HUD. Wake word, speech recognition, voiceprint, speech and the interface all run
locally; understanding is done by **the language model you choose** (any OpenAI-compatible API, or a local Ollama).

**Install**: download the `.dmg` (macOS 12+) or `Jarvis-Setup.exe` (Windows 10/11 x64) from Releases. The first launch
installs packages and about 1 GB of speech models (progress opens in your browser), then the **Connect a brain** panel
asks for a provider, key and model and tests both chat and tool calling. The model must support tool calling.

**From source**: `python3 app/install.py` then `python3 app/launch.py`. **Extend**: drop a module with `provide()` into
`jarvis/plugins/` — see [docs/extend.md](docs/extend.md).

**Privacy**: audio never leaves the machine; only recognised text and tool results go to your model. Keys and personal
data stay in `~/.jarvis/`, readable by your user only.

**Licence**: GPL-3.0. Third-party components and models: [NOTICE.md](NOTICE.md). The default Jarvis voice is a community
Piper model trained on film audio; it is downloaded from its original source at install time, is not part of this
repository, and is for personal, non-commercial use.
