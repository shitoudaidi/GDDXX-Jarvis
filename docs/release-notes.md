## 贾维斯 2.0

全新重写：支持 macOS 和 Windows，接入你自己选的大模型。

**2.0.4**：菜单里新增「流浪地球计划」：[oxomkbk/earth-migration](https://github.com/oxomkbk/earth-migration) 的两部 WebGL 影片，第一部行星发动机点火、地球离开太阳系，第二部一路拉远到整个银河系。它是《流浪地球》的同人作品，所以不随安装包附带：第一次打开时点「下载」（约 36 MB），贾维斯从作者的仓库下载，每个文件都核对校验码。也能用语音打开、切到第二部、关闭。播放时贾维斯自己的画面暂停，并用影片自带的省电画质，避免卡顿。

**2.0.3**：新增「3D 拆解库」（右上角按钮或菜单）：所有能拆的机器排成一面卡片墙，带线稿缩略图，可以搜索、按来源筛选，点一下直接投影。新增 [tools/simready](../tools/simready/README.md)：把 NVIDIA SimReady 公开的 OpenUSD 模型转成全息拆解，可以整夜批量跑，由贾维斯的大脑看图给零件起中文名，没把握的留给人看。

**2.0.2**：新增「暂停聆听」按钮（屏幕上方，或按 M 键）：暂停后贾维斯不再听任何声音，适合直播、开会；再按一次恢复，暂停时仍可打字。新增「自动演示」按钮：贾维斯自己把介绍、电脑状态、天气、日程、导航、全息拆解、猛禽点火、星舰发射、皮肤挨个演示一遍（含地球此刻），演示时自动暂停聆听（步骤可在 `hud/tour.json` 里改）。自带 7 台可拆解的机器（猛禽发动机、汽车发动机、变速箱、电机、离心泵、燃气轮机、涡扇发动机），装好就能说「拆解一台汽车发动机」。新增「地球此刻」：说「看看地球上正在发生什么」，地球仪四周是六张实时卡片：头顶的航班（还能查航班飞到哪了）、头顶的卫星和今晚肉眼能看到的空间站、离你最近的地震、台风离你多远、全球新闻热点、下一次火箭发射。数据来自公开数据源（OpenSky、CelesTrak、USGS、GDACS、GDELT、Launch Library），不需要申请 key。

**2.0.1**：没有麦克风时不再报错（插上后自动连上）；备用声音和语音检测模型下载更稳，国内网络也能装好；Windows 安装包有中文界面。每个安装包发布前都会在 Mac（Apple 芯片、Intel）和 Windows 上完整安装测试一遍。

### 下载哪个

| 电脑 | 文件 |
|---|---|
| Mac（Apple 芯片：M1/M2/M3/M4…） | `Jarvis-2.0.4-arm64.dmg` |
| Mac（Intel 芯片） | `Jarvis-2.0.4-x86_64.dmg` |
| Windows 10/11（64 位） | `Jarvis-Setup-2.0.4.exe` |

不知道 Mac 是哪种芯片：点左上角苹果图标 → 关于本机，看“芯片”或“处理器”那一行。

### 第一次打开

- **Mac**：把 Jarvis 拖进「应用程序」。安装包没有苹果开发者签名，第一次双击会提示“无法验证开发者”。请在「应用程序」里**右键点 Jarvis → 打开 → 打开**。如果还是打不开，到「系统设置 → 隐私与安全性」，在下面点「仍要打开」。
- **Windows**：如果出现“Windows 已保护你的电脑”，点「更多信息 → 仍要运行」。不需要管理员权限。
- 第一次打开会在浏览器里显示安装进度：准备 Python 组件，下载约 1 GB 语音模型。只需要一次。
- 然后弹出「接入大脑」：选服务商，粘贴 API Key，测试通过后保存，说 “Hey Jarvis”。

完整说明见 [README](https://github.com/shitoudaidi/GDDXX-Jarvis#readme)。

---

**English**: Jarvis 2.0, a rewrite for macOS and Windows that works with the language model you choose. Download the
`.dmg` for your Mac (arm64 = Apple silicon, x86_64 = Intel) or `Jarvis-Setup-2.0.4.exe` for Windows. The builds are not
signed: on a Mac, right-click Jarvis in Applications → Open; on Windows, choose More info → Run anyway.
