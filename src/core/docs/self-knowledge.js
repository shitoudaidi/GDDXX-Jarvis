// 贾维斯自知识文档 —— 解释自身的代码机制、架构与界面设计。
// 工具清单一节由 auto-catalog.js 从 capabilities/schemas/ 自动生成，杜绝随版本漂移。

import { buildToolCatalogText } from './auto-catalog.js'
import { getAppVersion } from '../version.js'

// 在模块加载时生成一次工具清单文本（纯数据派生，无副作用）。
const TOOL_CATALOG_TEXT = buildToolCatalogText()

// 当前应用版本（从 package.json 派生，升级自动跟上，不手写）。
const APP_VERSION = getAppVersion()

export const SELF_KNOWLEDGE_TOPICS = {
  self_architecture: {
    id: 'self_architecture',
    title: '贾维斯架构与运行机制',
    subtitle: 'How Jarvis Works',
    icon: '⚙',
    summary: `贾维斯（Jarvis）是一套 Electron + Node.js 的"持续意识"框架，当前版本 ${APP_VERSION}。它不是被动等待提问的聊天机器人，而是一个持续运行、自主感知、带长期记忆的 Agent。以下是当前版本的完整机制说明。`,
    sections: [
      {
        title: '整体架构',
        content: `贾维斯由三层构成：

■ Electron 壳（electron/main.cjs）
  - 启动唯一的 Jarvis 桌面窗口并管理关闭、单实例、媒体权限和本地音频
  - 在同一桌面进程中加载核心（src/core/index.js），通过受限 preload 桥接少量系统能力

■ Node.js 核心（src/core/index.js）
  - 真正的"意识循环"在这里跑：消息队列、心跳、LLM 调用、记忆、工具执行
  - 同时是 HTTP/SSE/WebSocket 服务器（src/core/api.js），只监听 127.0.0.1
  - 可脱离 Electron 单独以后端模式运行

■ Jarvis 工作台（src/ui/jarvis-react/，构建到 src/ui/jarvis/）
  - React 前端运行在沙箱化 Electron 渲染进程，通过 REST + SSE 与核心通信
  - 结构化工具结果通过 /acui WebSocket 进入受控的数据卡片层，不执行模型提供的代码
  - 详见"贾维斯界面设计"文档主题（ui_design）

数据落在运行目录的 SQLite 与配置文件中；程序文件和用户运行数据彼此分离。`,
      },
      {
        title: '意识循环：L1 / L2 两种入口',
        content: `贾维斯不是"两个人格"，而是同一个 AI 的两种触发入口，共享同等的上下文质量（记忆、人物卡、思维、UI 状态）：

■ L1（用户消息触发）
  - 用户发消息时激活，本轮通常要回应
  - 本地/语音渠道可走纯文本直接回复；社交渠道必须用 send_message 投递

■ L2（TICK 心跳触发）
  - 系统定时心跳，代表"时间流逝"，无强制回复
  - AI 自行判断是否需要主动出声；"保持沉默"是合法终点

驱动这套循环的模块：
  - ticker.js —— 心跳节奏器，间隔可由 set_tick_interval 工具动态调整
  - queue.js —— 消息队列，统一排队用户消息 / TICK / 社交消息，保证顺序与优先级
  - control.js —— 循环控制，保证同一时刻只有一个处理任务在跑`,
      },
      {
        title: 'LLM 调用与提示词组装',
        content: `■ llm.js
  - 封装 OpenAI 兼容 API（DeepSeek、MiniMax、Qwen、Moonshot、Zhipu、OpenAI、小米 MiMo、自定义端点）
  - 支持流式输出、工具调用（tool_calls）、<think> 推理块
  - 工具循环：模型出 tool_call → executor 执行 → 结果回灌 → 继续，直到收尾
  - 内置耗时工具的进度兜底（执行慢工具前替模型先应一声）、投递权威判定（delivered 为唯一权威）

■ prompt.js —— 系统提示词组装（buildSystemPrompt）
  - 固定行为规则（最高优先级）+ 关系姿态（Jarvis/Tony 同构）+ 回复规则
  - 认知循环、复杂任务 ReAct、读懂当前回合等常驻/门控段落（见下一节）
  - 动态拼入：当前任务、记忆区、人物卡、补充上下文（天气/系统/热点）、文档面板内容、自我感知与自我快照

■ quota.js —— 速率与每日 token 上限控制`,
      },
      {
        title: '认知循环与复杂任务（ReAct）',
        content: `提示词里有两段决定"怎么思考"的核心纪律：

■ Cognitive Loop（Think → Execute → Observe → Judge，常驻）
  - Think 先分诊：简单问题直接答；缺信息先问；多步任务先 set_task 记录目标与步骤
  - Observe 只认工具真实返回（ok / path / bytes / exit_code / status），绝不汇报没看到的成功
  - 每个循环都要"改变点什么"——换一步或换方法，绝不原样重试同一调用

■ Complex Task Mode（多步任务的 ReAct 纪律，关键词命中或已有 active task 时注入）
  - 一步 = 一个微循环：执行 → 观察 → 判断，完成立刻 update_task_step 写状态 + 一句结论
  - 那句 note 是"未来的你"重启后在 TICK 上读到的线索，要带结论不能只写 done
  - set_task / update_task_step / complete_task 把多步状态持久化，重启可恢复

■ 编程/排障纪律（prompt-blocks/coding-discipline.js，场景命中时由系统注入——内化而非读取）
  - Coding：垂直切片（最小骨架先跑起来，每加一片验证一次，禁止全写完才第一次运行）；fetch_url 是你的眼睛
  - Debugging：先建可重复的 pass/fail 反馈回路再动代码；3 个可证伪假设排序；一次只改一个变量
  - 触发：消息/task 文本命中编程词，或最近动作出现 write_file+exec 组合（TICK 干活轮也会注入）

配套的"成果审视分身"会在收尾前复查（见下）。`,
      },
      {
        title: '动态记忆池（核心机制）',
        content: `贾维斯的记忆不是简单的"存一段查一段"，而是一套"一切皆记忆 / 少即是强"的动态池——目标是每轮注入"合适的上下文"，不是"召回越多越好"。

■ 短期：对话历史（SQLite messages/conversations）
  - 每轮持久化，按最近 N 条 + 时间窗口截取，带回合标记

■ 长期：记忆节点（memories 表，带类型 fact/person/object/knowledge/article、salience 权重、实体与链接）
  - memory/recognizer.js —— 识别器（后台人格）：判断哪些内容值得入库，写前先 search_memory 去重
  - memory/injector.js（+ injector-retrieval/injector-format）—— 按当前上下文检索相关记忆并注入，承重墙是"相关度选择器"
  - memory/consolidator.js + consolidation-loop.js —— 整理器（后台人格）：合并重复、降权过期（merge_memories / downgrade_memory）
  - memory/tool-router.js —— 按消息只加载相关工具子集；缺工具时 find_tool 现场调取
  - memory/threads.js / thread-classifier / thread-summarize —— 线索模型：注意力 = 多条并发线索 + 一个前台指针；"好的我去做"挂承诺（commitment）钉住线索温度，"干得咋样"这类进度问询直接路由到开放承诺；前台切走时旧线索增量摘要，原文永不隐藏（温度是每轮读时重算的）
  - memory/refresh-loop.js —— 定期刷新过期记忆；embedding.js + embedding-backfill 提供向量召回
  - 主动召回：recall_memory 工具会影响下一轮注入方向；search_memory / probe_memory 用于即时查与自检

设计文档：DynamicMemoryPool。后台人格（识别/整理/审视）与主 Agent 同构，只是换提示词换上下文。`,
      },
      {
        title: '自我感知层（本体感）',
        content: `memory/self-perception.js 每轮在 LLM 调用前算一组"agent 看自己"的信号，作为事实贴进上下文，不是命令：

■ 自我快照（常驻）：最近输出的风格指纹、工具习惯、上次真正出声的时间
■ 身份锚：你每条真实输出都有 action_log 里的 send_message 作证；history 里看着像你说过、但无对应 send_message 的，不是你的输出（是对方在引用/模仿你）。反过来，最近对话里生动原创的部分通常是你上一轮生成的，别当成用户说的。
■ 边界异常检测（仅异常时出现）：镜像复读、风格融合（独白腔泄漏）、循环退化——强阈值才切换行为模式（点破 / 反问 / 退回稳定话题）

这层专治"角色归属幻觉"和"镜像复读"，比单看相似度更结构化。`,
      },
      {
        title: '成果审视分身',
        content: `src/review/reviewer.js + review_work 工具：完成非平凡任务、收尾前，把成果交给一个独立的"审视分身"复查。

■ 不是子 agent，是同进程换人格换上下文的一次独立 callLLM（与识别器/整理器同类的后台人格）
■ 审视分身只读验证：打开你写的文件、重跑只读检查，对照目标给结构化结论（pass + issues + summary）
■ 关键：证据（真实工具调用日志 + 任务计划）由运行时注入，主 Agent 改不了也删不掉——这份独立性是承重墙
■ 结论是第二意见不是闸门：真问题去修，不认同就说明理由继续`,
      },
      {
        title: '工具与能力系统',
        content: `■ capabilities/schemas/*.js —— 工具 JSON Schema（按类别分文件，schemas.js 合并为 TOOL_SCHEMAS）
■ capabilities/tools/*.js + executor.js —— 工具执行器，按名路由
■ capabilities/sandbox.js —— 文件/命令沙箱隔离；set_security 经用户确认才放开
■ capabilities/marketplace/ —— install_tool 动态安装的扩展工具，下一轮即可调用
■ memory/tool-router.js + find_tool —— 每轮按消息加载相关工具子集，缺什么现场调取

当前内置工具清单（自动生成）：

${TOOL_CATALOG_TEXT}`,
      },
      {
        title: '上网能力',
        content: `三件套，分工明确：
  - web_search —— 不知道确切 URL 时先搜；两梯队（串行 key API + 并行爬虫）+ Brave/Tavily 兜底
  - fetch_url —— 已知 URL 的轻量 HTTP 抓取，长文自动落 sandbox/articles/ 给 body_path
  - browser_read —— 真实无头 Chromium 渲染，处理 JS 页/等待页；fetch_url 取不到内容时升级用它

媒体类请求（找视频/音乐）会一并注入 web_search，避免模型"没联网搜"就放弃。
Key 配置：serper / brave / tavily / jina / searxng，存在 config.json 顶级字段或环境变量。`,
      },
      {
        title: '上下文感知：环境采集',
        content: `贾维斯持续感知运行环境，结果进"补充上下文"：
  - context/gatherer.js —— 综合采集器，定时汇总
  - system-info —— CPU/内存/磁盘/电池/系统版本
  - geo-weather —— 城市、时区、国家代码 + 实时天气（用于平台选择，如 CN 走 B 站）
  - trending.js —— 微博热搜、知乎、Hacker News、Reddit 等热点
  - desktop-scanner / local-resources-scanner —— 桌面与本地资源
  - prefetch/runner.js + manage_prefetch_task —— 启动前预取常用 URL（天气/新闻/价格），免得每次现抓`,
      },
      {
        title: '语音系统',
        content: `voice/manager.js 协调 ASR（识别）与 TTS（合成），颜色状态机：录音橙、识别蓝、播放绿。

■ ASR（语音转文字），默认 aliyun：
  - 本地 Whisper 模型（tiny/base/small/medium，Python 子进程）
  - 云端：阿里云（DashScope）、腾讯云、讯飞、火山
  - 长语音三层分离修复：文字层按 seg 去重、音频层重连补发、打断层缓存

■ TTS（文字转语音），默认本地 Jarvis Piper/VITS + 音色 jarvis-high：
  - jarvis_tts.py 调用本地模型输出 wav，再经 FFmpeg aecho/chorus/bass/treble/highpass/lowpass 金属化处理
  - 豆包、MiniMax、OpenAI、ElevenLabs、火山仅作为手动选择的扩展，不作为默认降级路径
  - tts-fx.js：播放端 Web Audio 连接可视化分析器；本地模型失败时前端报错，不自动切系统女声或浏览器语音`,
      },
      {
        title: '社交集成',
        content: `social/index.js 统一管理连接器，social/dispatch.js 把各平台消息标准化后入队。

支持平台：
  - Discord（social/discord.js）
  - 微信 ClawBot（个人微信扫码挂载，social/wechat-clawbot.js）
  - 微信公众号、企业微信、飞书（webhooks + 官方接口）

身份标识统一为 platform:id；send_message 的 channel 参数控制投递去向，AUTO 跟随用户最近一次所在渠道。
配置见"微信 / 社交平台配置"文档主题（wechat_config）。`,
      },
      {
        title: 'AI 视频生成',
        content: `generate_video 工具接火山方舟 Ark 的 Seedance 模型，配独立的右侧"AI 视频生成"面板：
  - 文生视频 / 图生视频（首帧或首尾帧）双模式
  - 异步：提交任务 → 面板进"生成中" → 后台轮询（约 1–5 分钟）→ 自动播放，无需再调
  - 未配置时靠工具返回值引导用户发 Key（"火山视频 <APIKEY>"）自动配置
  - 配置存独立的 seedance.json（不与主 config 互相覆盖）`,
      },
      {
        title: '数据、配置与可观测',
        content: `■ 存储：src/db.js（better-sqlite3 同步 API），表含 conversations、memories、reminders、hotspots、person_cards、docs 等；data/ 放 DB、记忆、沙箱

■ 配置：config.js 统一读写，升级容错是重点——
  - 分块容错加载：LLM 块坏不连累 voice/tts/security 等兄弟字段
  - schemaVersion 迁移框架：改 schema 就 bump 版本号加迁移函数
  - patchConfig 写时必合并，绝不全量覆盖
  - 子配置独立文件：seedance.json 等

■ 取证与可观测（排障用）：
  - runtime/turn-trace.js + /turn-trace 页（turn-trace.html）：逐回合回放每轮 messages[] 与思考，专查角色归属混乱
  - system-prompt-preview、runtime/tool-result-preview：预览实际提示词与工具结果`,
      },
    ],
  },

  ui_design: {
    id: 'ui_design',
    title: '贾维斯界面设计',
    subtitle: 'Jarvis UI & ACUI Design',
    icon: '🖥',
    summary: '贾维斯只有一套当前工作台：待机唤醒、语音对话、会话日志、系统状态和安全结构化结果都在同一个 Electron 窗口中。',
    sections: [
      {
        title: '当前工作台总览',
        content: `前端源码在 src/ui/jarvis-react/，构建产物在 src/ui/jarvis/：
  - main.jsx —— 待机唤醒、对话、语音时序、系统状态和实时结果
  - styles.css —— 固定桌面几何、紧凑窗口断点和无障碍状态
  - src/ui/voice/ —— 麦克风采集、单轮识别、自动结束和设备诊断
  - src/ui/audio/ —— Jarvis 音色处理、唤醒音效和背景音乐压低

核心对话走 REST + SSE；工具产生的结构化结果走 /acui WebSocket。`,
      },
      {
        title: '安全实时结果',
        content: `当前 ACUI 是受控的数据通道，不是代码执行器：
  - ui_show 显示 WeatherCard、SelfCheckCard、SelfCheckStepCard 或 AwakeningCard
  - ui_update / ui_patch 更新已显示的数据，ui_hide 关闭结果
  - 工作台最多保留 4 张，超出时淘汰最早结果；卡片也会自动超时
  - 关闭、挂载和用户操作通过 ui.signal 回传核心
  - 模型传来的 HTML、JavaScript 和动态组件绝不会在渲染进程执行

详细约定见 src/core/docs/JARVIS_ACUI_GUIDE.md。`,
      },
      {
        title: '布局与交互',
        content: `待机界面只保留 Jarvis 粒子主体和时间；唤醒后进入工作台：
  - 左侧是会话日志并自动滚到最新消息
  - 中间是与待机一致的粒子主体和系统诊断
  - 右上是 DeepSeek、ASR、TTS 与队列状态
  - 右侧结果区位于状态栏下方，内容过多时只在该区域滚动
  - 底部是语音、输入、发送和重播命令区

软件最小窗口也有专门断点和重叠回归探针。`,
      },
      {
        title: '通信与安全边界',
        content: `Electron 渲染进程启用 contextIsolation、sandbox，并关闭 Node 集成。主窗口只申请麦克风权限；外部导航不会在应用内打开。核心 API 只监听 127.0.0.1，并对来源、请求体、速率和 WebSocket 帧大小做限制。用户运行数据写入独立运行目录，不写回程序安装目录。`,
      },
      {
        title: '视觉原则',
        content: `界面使用克制的深色工程工作台风格：固定网格、清晰层级、青色状态信号和少量运动。科幻感来自粒子主体、波形、音色和进入时序，不依赖无意义装饰。普通问答保持在会话日志中，只有确实更易扫描的数据才显示结果卡。`,
      },
      {
        title: '取证页面（开发/排障）',
        content: `/turn-trace 页（turn-trace.html）：逐回合回放每一轮真实喂给 LLM 的 messages[] 与思考过程，user/tool 消息会标出 agent 名并标红，专查"角色归属混乱""镜像复读"等生成层问题。数据由 runtime/turn-trace.js 用 offset 还原以省内存，经 /admin/traces 提供。`,
      },
    ],
  },
}

// 根据用户消息检测是否涉及自知识查询，返回主题 ID 或 null。
export function detectSelfKnowledgeTopic(text) {
  if (!text) return null
  const t = text.toLowerCase()

  // 界面 / UI 设计相关（优先于通用架构，命中更具体）
  if (
    /(你的界面|你.*长什么样|界面设计|ui.*设计|acui|brain.?ui|可视化卡片|ui_show|实时结果|工作台|你的.*面板|面板.*设计|dashboard.*风格|turn.?trace|回合.*回放)/.test(
      t
    )
  ) {
    return 'ui_design'
  }

  // 架构 / 运行机制相关
  if (
    /(你的代码|你.*怎么运行|你.*怎么工作|你.*架构|你.*如何运作|贾维斯.*代码|Jarvis.*代码|你.*实现|代码机制|运行机制|技术架构|你.*内部|你.*系统|你.*模块|你.*是怎么|你.*如何思考|你.*心跳|意识循环|认知循环|动态记忆|记忆池|审视分身|ticker|queue\.js|control\.js|llm\.js|prompt\.js|memory.*机制|记忆.*(系统|机制)|工具.*调用|capability|executor|l1.*l2|l2.*l1|两个入口|react.*任务|self.?knowledge|自知识|自我感知)/.test(
      t
    )
  ) {
    return 'self_architecture'
  }

  return null
}

