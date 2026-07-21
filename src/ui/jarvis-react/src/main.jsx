import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  ChevronDown,
  ChevronUp,
  CloudSun,
  Copy,
  Cpu,
  Database,
  FileText,
  Eye,
  EyeOff,
  KeyRound,
  Keyboard,
  GitCompare,
  ListTodo,
  Loader2,
  Mic,
  MicOff,
  Music2,
  Newspaper,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  TerminalSquare,
  Thermometer,
  Volume2,
  VolumeX,
  Wind,
  Wrench,
  X,
  Zap
} from "lucide-react";
import { initVoicePanel } from "../../voice/voice-panel.js";
import { isWakePhrase } from "../../voice/wake-phrase.js";
import { attachJarvisAudioGraph, resumeJarvisAudioContext } from "../../audio/tts-fx.js";
import { applyOutputSink, initAudioOutputRouting } from "../../audio/audio-output.js";
import { playWakeTransitionSfx } from "../../audio/wake-sfx.js";
import { isAmbientMusicEnabled, setAmbientMusicDucked, startAmbientMusic, stopAmbientMusic } from "../../audio/ambient-music.js";
import JarvisParticleVortex from "./visuals/JarvisParticleVortex.jsx";
import "./styles.css";

const DEFAULT_API = "http://127.0.0.1:3721";
const VOICE_PROVIDER_KEY = "jarvis-voice-provider";
const USER_ID = "ID:000001";
const SELF_ECHO_GUARD_MS = 8_000;
// Metallic TTS has a long echo tail; keep the mic suspended until it has decayed.
// Only suppress immediate duplicate ASR packets; a ten-minute window mistakes normal conversation for echo.
const VOICE_REPEAT_GUARD_MS = 8_000;
const VOICE_POST_TTS_BLOCK_MS = 2_000;
const WAKE_LISTEN_DELAY_MS = 1000;
const WORKBENCH_ENTER_MS = 560;
const WAKE_GREETING_LEAD_MS = 1000;
const API_TIMEOUT_MS = 10_000;
const TTS_FETCH_TIMEOUT_MS = 50_000;
const TTS_PLAYBACK_TIMEOUT_MS = 150_000;
const SPEECH_CACHE_LIMIT = 6;
const ACUI_CARD_LIMIT = 4;
const ACUI_STRING_LIMIT = 800;
const ACUI_RECONNECT_MAX_MS = 8_000;
const DRAFT_STORAGE_KEY = "gddxx-jarvis-draft";
const MAX_DRAFT_CHARS = 4_000;
const DRAFT_WARNING_CHARS = 3_600;

function isAsrEchoNoise(value) {
  const normalized = normalizeEchoText(value);
  return /chinese(?:light|like|lite|right)/i.test(normalized);
}

function isEditableOrInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, button, a[href], [contenteditable="true"], [role="button"]'));
}
const WAKE_RESTART_MS = 360;
const JARVIS_TTS_VOICE_ID = "jarvis-high";

const VISUALS = {
  idle: "./visuals/idle.webm",
  listening: "./visuals/listening.webm",
  thinking: "./visuals/thinking.webm",
  speaking: "./visuals/speaking.webm",
  alert: "./visuals/alert.webm"
};

const LINKS = [
  { label: "控制台", action: "settings", icon: TerminalSquare },
  { label: "工程台", action: "engineering", icon: Wrench },
  { label: "回合记录", path: "/turn-trace", icon: FileText },
  { label: "记忆库", path: "/memories", icon: Database },
  { label: "系统词", path: "/systemPrompt.html", icon: Cpu }
];

function cls(...parts) {
  return parts.filter(Boolean).join(" ");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\[CLEAR_TASK\]/g, "")
    .replace(/\[SET_TASK:[\s\S]*?\]/g, "")
    .replace(/\[RECALL:[\s\S]*?\]/g, "")
    .trim();
}

function cleanStreamChunk(value) {
  return String(value || "")
    .replace(/\[CLEAR_TASK\]/g, "")
    .replace(/\[SET_TASK:[\s\S]*?\]/g, "")
    .replace(/\[RECALL:[\s\S]*?\]/g, "");
}

function plainSpeechText(value) {
  return cleanText(value)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEchoText(value) {
  return plainSpeechText(value)
    .toLowerCase()
    .replace(/[\s"'`~!@#$%^&*()_+\-=[\]{};:,.<>/?\\|，。！？、；：“”‘’（）【】《》…—]/g, "");
}

const CHINESE_TRANSLATION_MARKER = "[中文翻译]";
const WAKE_GREETING_SPEECH = "I wake up now.";
const WAKE_GREETING_VARIANTS = [
  ["I wake up now.", "我现在醒来了。"],
  ["Hello boss. Jarvis is online.", "你好老板，贾维斯已经在线。"],
  ["Good afternoon, boss. All systems are standing by.", "下午好老板，所有系统正在待命。"],
];
function getWakeGreeting() {
  const [english, chinese] = WAKE_GREETING_VARIANTS[Math.floor(Math.random() * WAKE_GREETING_VARIANTS.length)];
  return `${english}\n\n${CHINESE_TRANSLATION_MARKER}\n${chinese}`;
}
const READY_SELF_CHECK_SPEECH = "DeepSeek is connected. Voice recognition check passed. System self-check is complete. I am ready and awaiting your instructions.";
const WAKE_GREETING = `${WAKE_GREETING_SPEECH}\n\n${CHINESE_TRANSLATION_MARKER}\n我现在醒来了。`;

function buildSelfCheckReply(readiness) {
  const capabilities = readiness?.capabilities || {};
  const allReady = capabilities.deepseek?.ready && capabilities.tts?.ready && capabilities.asr?.ready;
  const english = allReady
    ? READY_SELF_CHECK_SPEECH
    : `DeepSeek ${capabilities.deepseek?.ready ? "is connected" : "needs attention"}. Voice recognition ${capabilities.asr?.ready ? "check passed" : "needs attention"}. Jarvis voice ${capabilities.tts?.ready ? "check passed" : "needs attention"}. System self-check is complete.`;
  const chinese = allReady
    ? "DeepSeek 已接入，语音识别检查通过，系统自检完成，我已经准备好听候您的指令了。"
    : `DeepSeek ${capabilities.deepseek?.ready ? "已接入" : "需要关注"}，语音识别${capabilities.asr?.ready ? "检查通过" : "需要关注"}，贾维斯语音${capabilities.tts?.ready ? "检查通过" : "需要关注"}，系统自检完成。`;
  return `${english}\n\n${CHINESE_TRANSLATION_MARKER}\n${chinese}`;
}

async function buildWakeSituation(api, readiness) {
  const now = new Date();
  const dateLine = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const timeLine = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  let newsLine = "No priority AI headline is available right now.";
  let taskLine = "There are no active engineering tasks.";
  try {
    const [newsResponse, taskResponse] = await Promise.all([
      fetch(`${api}/ai-news`),
      fetch(`${api}/grok-build/tasks`),
    ]);
    const news = await newsResponse.json();
    const tasks = await taskResponse.json();
    const item = Array.isArray(news?.items) ? news.items[0] : null;
    if (item?.title) newsLine = `The latest AI HOT headline is: ${item.title}.`;
    const task = tasks?.task || tasks?.data?.task;
    if (task?.prompt) taskLine = task.status === "completed" ? `The latest engineering task is complete: ${task.prompt}.` : `An engineering task is ${task.status || "in progress"}: ${task.prompt}.`;
  } catch {}
  const ready = readiness?.capabilities?.deepseek?.ready && readiness?.capabilities?.asr?.ready && readiness?.capabilities?.tts?.ready;
  const healthLine = ready ? "Core services are healthy." : "Some core services need attention.";
  return `It is ${timeLine} on ${dateLine}. ${healthLine} ${taskLine} ${newsLine} I am ready to continue with you.`;
}

function splitBilingualReply(value) {
  const text = String(value || "").trim();
  const markerIndex = text.indexOf(CHINESE_TRANSLATION_MARKER);
  if (markerIndex < 0) return { original: text, translation: "" };
  return {
    original: text.slice(0, markerIndex).trim(),
    translation: text.slice(markerIndex + CHINESE_TRANSLATION_MARKER.length).trim()
  };
}

function spokenReplyText(value) {
  return splitBilingualReply(value).original;
}

function BilingualMessageText({ content, compact = false }) {
  const { original, translation } = splitBilingualReply(content);
  return (
    <>
      <p>{original}</p>
      {translation ? (
        <p className={cls("message-translation", compact && "compact")}>
          <span>中文</span>
          {translation}
        </p>
      ) : null}
    </>
  );
}

function currentSegment(value) {
  const text = plainSpeechText(value);
  const parts = text.split(/[。！？!?；;\r\n]+/).map((item) => item.trim()).filter(Boolean);
  return parts[parts.length - 1] || text;
}

function echoTextOverlaps(candidate, source) {
  const left = normalizeEchoText(candidate);
  const right = normalizeEchoText(source);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 4) return false;
  return left.includes(right) || right.includes(left);
}

function isVoiceChannel(channel = "") {
  return /voice|语音|VOICE/i.test(String(channel || ""));
}

function engineeringPrompt(value) {
  const text = String(value || "").trim();
  const matched = text.match(/^(?:工程模式|工程任务|让工程代理|用\s*grok\s*build|让\s*grok)(?:[，,:：\s]+)([\s\S]+)$/i);
  return matched?.[1]?.trim() || "";
}

function inferredEngineeringPrompt(value) {
  const text = String(value || "").trim();
  if (!text || engineeringPrompt(text)) return engineeringPrompt(text);
  if (/(?:用|让|调用|交给).{0,8}(?:agent|代理|grok)/i.test(text)) return text;
  const asksForWork = /(?:帮我|请你|替我|给我|能不能|可以).{0,10}(?:创建|新建|修改|编辑|实现|修复|调试|运行|检查|安装|删除|读取|整理|生成|写|改)/i.test(text)
    || /(?:create|build|write|edit|fix|debug|run|install|delete|read|update|generate|implement)\b/i.test(text);
  const hasWorkspaceTarget = /(?:文件|代码|项目|工程|脚本|程序|网页|目录|文件夹|仓库|电脑|系统|package\.json|file|code|project|repo|folder|script|app|computer|system)/i.test(text);
  if (!asksForWork || !hasWorkspaceTarget) return "";
  return text;
}

function safeExternalUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function isStaleDiagnosticMessage(row) {
  const text = String(row?.content || "");
  const from = String(row?.from_id || row?.from || "");
  const to = String(row?.to_id || row?.to || "");
  return /geoResult is not defined|ReferenceError/i.test(text)
    || /probe-dialogue/i.test(from)
    || /probe-dialogue/i.test(to)
    || /核心对话链路测试|链路测试|请只回复：对话正常/.test(text);
}

function normalizeMessages(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !isStaleDiagnosticMessage(row))
    .map((row) => ({
      id: row.id ?? `${row.role}-${row.timestamp}-${row.content}`,
      role: row.role === "jarvis" || row.role === "assistant" ? "jarvis" : row.role === "user" ? "user" : "system",
      content: cleanText(row.content),
      channel: row.channel || "",
      timestamp: row.timestamp || ""
    }))
    .filter((row) => row.content);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: text || response.statusText };
  }
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function stateLabel(state) {
  if (state === "thinking") return "思考";
  if (state === "listening") return "聆听";
  if (state === "speaking") return "回应";
  if (state === "alert") return "待处理";
  return "待命";
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function amplifyAudioLevel(value) {
  const raw = clamp01(value);
  if (raw < 0.004) return 0;
  const lifted = (raw - 0.004) / 0.996;
  return clamp01(Math.pow(lifted, 0.66) * 1.1);
}

function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return {
    time: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    date: now.toLocaleDateString("en-US", { weekday: "long", day: "2-digit", month: "long" }).toUpperCase()
  };
}

function StatusPill({ ok, label, detail, compact = false }) {
  return (
    <div className={cls("status-pill", ok ? "ok" : "warn", compact && "compact")} title={`${label}：${detail || "暂无详情"}`}>
      {ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
      <span>{label}</span>
      {detail ? <em>{detail}</em> : null}
    </div>
  );
}

function SignalTile({ label, code, value, detail, tone = "neutral", icon: Icon = Activity }) {
  return (
    <div className={cls("signal-tile", `tone-${tone}`)}>
      <Icon size={17} aria-hidden="true" />
      <div>
        <span>{label} {code ? <small>{code}</small> : null}</span>
        {detail ? <em>{detail}</em> : null}
      </div>
      <strong>{value}</strong>
      <i aria-hidden="true" />
    </div>
  );
}

const NEWS_PLATFORM_LABELS = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信热点",
  weibo: "微博",
};

function NewsTicker({ api }) {
  const [items, setItems] = useState([]);
  const [fetchedAt, setFetchedAt] = useState("");
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!api || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const response = await fetch(`${api}/ai-news`);
      const payload = await readJson(response);
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "资讯源暂无数据");
      const next = (Array.isArray(payload.items) ? payload.items : []).map((row, rowIndex) => ({
        id: row.id || `ai-hot-${rowIndex}`,
        label: String(row.source || "AI HOT").replace(/[（(].*$/, "").trim(),
        rank: rowIndex + 1,
        title: String(row.title || "").trim(),
        heat: Number.isFinite(Number(row.score)) ? String(row.score) : "",
        publishedAt: row.publishedAt || "",
        url: safeExternalUrl(row.url),
      })).filter((row) => row.title && row.url);
      setItems(next);
      setFetchedAt(payload.fetchedAt || new Date().toISOString());
      setError("");
      setIndex((current) => next.length ? current % next.length : 0);
    } catch (loadError) {
      setError(loadError.message || "资讯源暂无数据");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
    const refreshTimer = window.setInterval(load, 5 * 60 * 1000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  useEffect(() => {
    if (paused || items.length < 2) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % items.length), 4200);
    return () => window.clearInterval(timer);
  }, [items.length, paused]);

  const visibleItems = useMemo(() => {
    if (!items.length) return [];
    return Array.from({ length: Math.min(3, items.length) }, (_, offset) => items[(index + offset) % items.length]);
  }, [index, items]);
  const updated = fetchedAt ? new Date(fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "--:--";

  return (
    <section className={cls("news-ticker", !items.length && "is-empty")} aria-label="AI Hot 实时资讯">
      <header className="news-ticker-head">
        <div><Newspaper size={14} /><span>AI 新闻</span><small>AI NEWS</small></div>
        <div className="news-ticker-actions">
          <small>{error ? "OFFLINE" : updated}</small>
          <button type="button" className="news-icon" onClick={() => setPaused((value) => !value)} aria-label={paused ? "继续滚动资讯" : "暂停滚动资讯"} title={paused ? "继续滚动资讯" : "暂停滚动资讯"}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button type="button" className="news-icon" onClick={load} disabled={loading} aria-label="刷新资讯" title="刷新资讯"><RefreshCw className={cls(loading && "spin")} size={13} /></button>
        </div>
      </header>
      {visibleItems.length ? (
        <div className="news-ticker-list">
          {visibleItems.map((item, visibleIndex) => (
            <motion.a
              className="news-ticker-item"
              key={item.id}
              href={item.url || undefined}
              target={item.url ? "_blank" : undefined}
              rel={item.url ? "noopener noreferrer" : undefined}
              aria-label={item.url ? `打开${item.label}：${item.title}` : undefined}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: visibleIndex * 0.03 }}
            >
              <div className="news-ticker-meta"><b>{String(item.rank).padStart(2, "0")}</b><span>{item.label}</span>{item.heat ? <em>{item.heat}</em> : null}</div>
              <p>{item.title}</p>
            </motion.a>
          ))}
        </div>
      ) : (
        <div className="news-ticker-empty"><Newspaper size={18} /><span>{error || "正在连接资讯源"}</span></div>
      )}
    </section>
  );
}

function IntelligenceRail({ signals, api, grokStatus, onEngineering }) {
  const task = grokStatus?.task || null;
  const running = ["starting", "running", "waiting_permission"].includes(task?.status);
  const taskState = task?.status === "completed"
    ? "已完成"
    : task?.status === "waiting_permission"
      ? "等待确认"
      : running
        ? "执行中"
        : grokStatus?.available
          ? "待命"
          : "未接入";
  const taskTitle = task?.prompt || (grokStatus?.available ? "DeepSeek 工程代理已就绪" : "工程代理当前不可用");

  return (
    <aside className="capability-strip intelligence-rail" aria-label="能力与资讯状态">
      <section className="rail-section capability-status">
        <header className="rail-heading"><span>能力状态</span><small>CAPABILITY STATUS</small></header>
        <div className="capability-list">
          {signals.map((signal) => <SignalTile key={signal.label} {...signal} />)}
        </div>
      </section>
      <button className={cls("engineering-summary", running && "is-running")} type="button" onClick={onEngineering}>
        <header className="rail-heading">
          <span>工程任务</span><small>ENGINEERING MODE</small>
          <b>{taskState}</b>
        </header>
        <div className="engineering-summary-body">
          <small>{task ? "当前任务 / ACTIVE TASK" : "工程代理 / BUILD AGENT"}</small>
          <strong>{taskTitle}</strong>
          <span className="engineering-progress" aria-hidden="true"><i /></span>
        </div>
      </button>
      <NewsTicker api={api} />
    </aside>
  );
}

function JarvisWorkbench({ visualState, interfaceMode, readiness, status, activation, connection, grokReady, audioLevel = 0 }) {
  const caps = readiness?.capabilities || {};
  const energy = amplifyAudioLevel(audioLevel);
  const signalActive = visualState === "speaking" || visualState === "listening" || energy > 0.025;
  const signalBars = Array.from({ length: 64 }, (_, index) => {
    const sine = (Math.sin(index * 0.78 + energy * 5.8) + 1) * 0.5;
    const stagger = ((index * 19) % 43) / 100;
    const centerBias = 1 - Math.abs(index - 31.5) / 40;
    const variation = 0.42 + sine * 0.68 + stagger * 0.72 + centerBias * 0.32;
    const bar = signalActive
      ? Math.min(100, Math.max(8, Math.round(10 + energy * 156 * variation)))
      : Math.min(18, Math.max(3, Math.round(4 + variation * 7)));
    return (
      <i
        key={index}
        style={{
          "--bar": `${bar}%`,
          "--delay": `${-index * 28}ms`,
          "--alpha": (signalActive ? 0.36 + energy * 0.64 : 0.24).toFixed(3)
        }}
      />
    );
  });
  const state = visualState === "speaking" ? "TRANSMITTING" : visualState === "thinking" ? "PROCESSING" : visualState === "listening" ? "LISTENING" : "STANDBY";
  const model = activation?.model || activation?.provider || "未配置";
  const memoryCount = status?.memory_count ?? caps.memory?.count ?? "--";
  const queue = status?.queue || {};
  const checks = [
    ["核心", "CORE", caps.deepseek?.ready],
    ["语音", "VOICE", caps.tts?.ready],
    ["识别", "ASR", caps.asr?.ready],
    ["记忆", "MEMORY", caps.memory?.ready],
    ["工程", "BUILD", grokReady],
    ["监听", "SCAN", visualState === "listening"],
  ];
  return (
    <section className={cls("jarvis-workbench", `workbench-${visualState}`, `workbench-${interfaceMode}`)} aria-label="Jarvis system workbench">
      <div className="workbench-grid" aria-hidden="true" />
      <div className="workbench-header">
        <span>核心智能场域 <small>INTELLIGENCE FIELD</small></span>
        <strong>{state}</strong>
      </div>
      <div className="core-readouts core-readouts-left">
        <span><small>核心状态 / CORE STATUS</small><strong>{caps.deepseek?.ready ? "ONLINE" : "CHECK"}</strong></span>
        <span><small>模型 / MODEL</small><strong>{model}</strong></span>
        <span><small>语音 / VOICE</small><strong>{caps.asr?.provider || "--"}</strong></span>
      </div>
      <div className="core-readouts core-readouts-right">
        <span><small>记忆 / MEMORY</small><strong>{memoryCount}</strong></span>
        <span><small>队列 / QUEUE</small><strong>{queue.user ?? 0} / {queue.background ?? 0}</strong></span>
        <span><small>链路 / LINK</small><strong>{connection?.state === "online" ? "ONLINE" : "OFFLINE"}</strong></span>
      </div>
      <div className="workbench-diagnostics">
        <div className="diagnostic-block signal-block">
          <span>实时语音波形 / LIVE AUDIO</span>
          <div className={cls("signal-wave", signalActive && "active")} style={{ "--signal-energy": energy.toFixed(3), "--signal-glow": `${(6 + energy * 14).toFixed(1)}px` }} aria-hidden="true">{signalBars}</div>
          <div className="signal-meta"><em>PCM / LOCAL</em><b>{visualState === "speaking" ? "ACTIVE" : "QUIET"}</b></div>
        </div>
      </div>
      <div className="workbench-status-strip">
        {checks.map(([label, code, ready]) => (
          <span className={ready ? "ready" : "pending"} key={code}><b>{label}</b><small>{code}</small><i /></span>
        ))}
      </div>
      <div className="workbench-footer"><span>LOCAL 127.0.0.1</span><span>MODE {interfaceMode.toUpperCase()}</span><span>SCAN {state}</span></div>
    </section>
  );
}

function MessageLine({ message, live }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const bilingual = !isUser && !isSystem ? splitBilingualReply(message.content) : null;
  return (
    <motion.article
      className={cls("message-line", isUser && "user", isSystem && "system", live && "live")}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
    >
      <div className="message-origin">
        <span>{isUser ? "你" : isSystem ? "系统" : "Jarvis"}</span>
        {message.channel ? <small>{message.channel}</small> : null}
        {message.timestamp ? <time>{formatTime(message.timestamp)}</time> : null}
      </div>
      {bilingual ? <BilingualMessageText content={message.content} /> : <p>{message.content}</p>}
    </motion.article>
  );
}

function ModuleLink({ item, api, onSettings, onEngineering, active }) {
  const Icon = item.icon;
  const open = () => {
    if (item.action === "settings") onSettings?.();
    else if (item.action === "engineering") onEngineering?.();
    else window.open(`${api}${item.path}`, "_blank", "noopener,noreferrer");
  };
  return (
    <button className={cls("module-link", active && "active")} type="button" onClick={open} aria-pressed={item.action === "engineering" ? !!active : undefined}>
      <Icon size={16} />
      <span>{item.label}</span>
    </button>
  );
}

function EngineeringConsole({ status, open, onClose, onRun, onCancel, onPermission }) {
  const [prompt, setPrompt] = useState("");
  const [view, setView] = useState("conversation");
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("jarvis-engineering-history") || "[]"); } catch { return []; }
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const outputRef = useRef(null);
  const task = status?.task || null;
  const isRunning = ["starting", "running", "waiting_permission"].includes(task?.status);
  const workspace = task?.cwd || status?.defaultCwd || "H:\\Jarvis\\runtime\\jarvis\\sandbox";
  const quickActions = [
    { label: "读取项目结构", prompt: "读取当前工作区，列出项目结构并说明入口文件" },
    { label: "检查项目", prompt: "检查当前项目的构建、依赖和明显错误，给出可执行修复" },
    { label: "运行测试", prompt: "运行当前项目已有的检查或测试命令，汇总失败项" },
    { label: "查看变更", prompt: "检查当前工作区的版本控制状态和未提交变更，按文件汇总" },
  ];
  const labels = {
    starting: "正在启动",
    running: "正在执行",
    waiting_permission: "等待确认",
    completed: "已完成",
    error: "执行失败",
    cancelled: "已取消",
  };

  useEffect(() => {
    if (!open || !outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [open, task?.output, task?.events?.length]);

  useEffect(() => {
    if (!task?.completedAt || !task?.id) return;
    setHistory((current) => {
      const next = [{ id: task.id, prompt: task.prompt, status: task.status, completedAt: task.completedAt }, ...current.filter((item) => item.id !== task.id)].slice(0, 12);
      try { localStorage.setItem("jarvis-engineering-history", JSON.stringify(next)); } catch {}
      return next;
    });
  }, [task?.id, task?.completedAt, task?.status, task?.prompt]);

  const submit = async (event) => {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || submitting || isRunning) return;
    setSubmitting(true);
    setError("");
    try {
      await onRun(value);
      setPrompt("");
    } catch (submitError) {
      setError(submitError.message || "工程任务提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const runQuickAction = async (value) => {
    if (isRunning || !status?.available) return;
    setError("");
    setPrompt(value);
    try {
      await onRun(value);
    } catch (runError) {
      setError(runError.message || "工程任务提交失败");
    }
  };

  if (!open) return null;
  return (
    <section
      className="engineering-console"
      aria-label="Grok Build 工程台"
    >
      <header className="engineering-header">
        <div><Wrench size={16} /><span>GROK BUILD / 工程代理</span></div>
        <div className="engineering-state">
          <i className={cls(status?.available && "online", task?.status === "waiting_permission" && "attention")} />
          <strong>{task ? labels[task.status] || task.status : status?.available ? "待命" : "未安装"}</strong>
          <button className="engineering-icon" type="button" onClick={onClose} aria-label="关闭工程台" title="关闭工程台"><X size={16} /></button>
        </div>
      </header>

      <div className="engineering-layout">
        <aside className="engineering-sidebar" aria-label="工程台导航">
          <button className="engineering-new-task" type="button" onClick={() => { setPrompt(""); setError(""); }} disabled={isRunning}>
            <FileText size={15} />新建任务
          </button>
          <section className="engineering-side-section">
            <span>工作区 / WORKSPACE</span>
            <strong title={workspace}>{workspace}</strong>
            <small>H: ONLY</small>
          </section>
          <section className="engineering-side-section">
            <span>任务线程 / THREADS</span>
            <div className="engineering-history">
              {history.length ? history.slice(0, 5).map((item) => <button key={item.id} type="button" title={item.prompt} onClick={() => { setPrompt(item.prompt); setView("conversation"); }}><i className={item.status === "completed" ? "done" : "fail"} />{item.prompt}</button>) : <small>完成的任务会保留在这里</small>}
            </div>
          </section>
          <section className="engineering-side-section">
            <span>快捷操作 / ACTIONS</span>
            <div className="engineering-quick-actions">
              {quickActions.map((action) => (
                <button key={action.label} type="button" onClick={() => runQuickAction(action.prompt)} disabled={isRunning || !status?.available}>
                  <Play size={12} />{action.label}
                </button>
              ))}
            </div>
          </section>
          <section className="engineering-side-section engineering-side-status">
            <span>代理状态 / AGENT</span>
            <strong>{task ? labels[task.status] || task.status : status?.available ? "待命" : "未安装"}</strong>
            <small>DeepSeek V4 Pro 驱动 Grok Build</small>
          </section>
        </aside>

        <div className="engineering-main">
          <div className="engineering-meta">
            <span>MODEL <b>DeepSeek V4 Pro</b></span>
            <span>WORKSPACE <b>{workspace}</b></span>
            <span>STORAGE <b>H: ONLY</b></span>
          </div>
          <nav className="engineering-tabs" aria-label="工程视图">
            {[['conversation','对话'],['plan','计划'],['changes','变更'],['terminal','终端']].map(([key, label]) => <button key={key} type="button" className={view === key ? "active" : ""} onClick={() => setView(key)}>{label}</button>)}
          </nav>
          <div className="engineering-body">
            <div className="engineering-output" ref={outputRef} aria-live="polite">
              {view === "conversation" ? <>
                {task?.prompt ? <div className="engineering-request"><span>任务</span><p>{task.prompt}</p></div> : null}
                {task?.thought && isRunning ? <div className="engineering-thinking"><Loader2 className="spin" size={13} /><span>DeepSeek 正在分析与执行</span></div> : null}
                {task?.output ? <pre>{task.output}</pre> : <div className="engineering-empty"><Wrench size={28} /><strong>工程代理待命</strong><span>用于创建、修改、检查文件和运行工程任务</span></div>}
              </> : view === "plan" ? <div className="engineering-plan-view">{task?.plan?.length ? task.plan.map((step, i) => <div key={i}><b>{String(step.status || "pending").toUpperCase()}</b><span>{step.step || step.title || step.detail || String(step)}</span></div>) : <div className="engineering-empty"><ListTodo size={28} /><strong>等待 Agent 生成计划</strong><span>执行任务后，计划步骤会实时显示在这里</span></div>}</div>
                : view === "changes" ? <div className="engineering-empty"><GitCompare size={28} /><strong>变更审阅</strong><span>{task?.output ? "请在任务输出中查看 Agent 汇总的文件变更；精确 diff 接入中" : "执行修改任务后，这里显示文件变更摘要"}</span></div>
                : <div className="engineering-empty"><TerminalSquare size={28} /><strong>终端输出</strong><span>{task?.events?.length ? "命令执行事件已记录在右侧轨迹" : "Agent 运行命令后，终端事件会显示在右侧"}</span></div>}
              {task?.error ? <div className="engineering-error"><CircleAlert size={14} /><span>{task.error}</span></div> : null}
            </div>
            <aside className="engineering-events" aria-label="执行轨迹">
              <span>EXECUTION TRACE</span>
              {(task?.events || []).slice(-9).reverse().map((item, index) => (
                <div key={`${item.at}-${index}`}><i /><p><strong>{item.title || item.type}</strong>{item.detail ? <small>{item.detail}</small> : null}</p></div>
              ))}
              {!task?.events?.length ? <p className="engineering-events-empty">任务开始后在这里显示步骤</p> : null}
            </aside>
          </div>

          {task?.permission ? (
            <div className="engineering-permission" role="alert">
              <ShieldCheck size={18} />
              <div><strong>{task.permission.title}</strong><span>{task.permission.kind || "此操作会修改系统状态，请确认是否仅允许本次执行。"}</span></div>
              <button className="secondary" type="button" onClick={() => onPermission("reject")}>拒绝</button>
              <button className="primary" type="button" onClick={() => onPermission("approve")}>仅允许本次</button>
            </div>
          ) : null}

          <form className="engineering-command" onSubmit={submit}>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述要工程代理完成的任务" rows={2} disabled={isRunning} />
            {isRunning ? (
              <button className="secondary engineering-stop" type="button" onClick={onCancel}><Square size={15} />停止</button>
            ) : (
              <button className="primary engineering-run" type="submit" disabled={!prompt.trim() || submitting || !status?.available}>
                {submitting ? <Loader2 className="spin" size={15} /> : <Play size={15} />}执行
              </button>
            )}
          </form>
          {error ? <div className="engineering-form-error">{error}</div> : null}
        </div>
      </div>
    </section>
  );
}

function AgentPortrait({ state, voiceStatusText, sending, mode, audioLevel = 0 }) {
  const video = VISUALS[state] || VISUALS.idle;
  const [videoFailed, setVideoFailed] = useState(false);
  const energy = amplifyAudioLevel(audioLevel);
  const particleEnergy = clamp01(Math.pow(energy, 1.45) * 0.42);
  const frameShift = state === "speaking" ? -1.5 - energy * 2.4 : state === "listening" ? -1.2 - energy * 1.1 : state === "thinking" ? -0.4 : 0;
  const frameScale = state === "speaking"
    ? 1.015 + energy * 0.045
    : state === "listening"
      ? 1.008 + energy * 0.022
      : state === "thinking"
        ? 1.018
        : 1;
  const videoScaleBase = mode === "standby" ? 1.32 : mode === "active" ? 1.34 : 1.16;
  const videoStateBoost = state === "speaking"
    ? 0.1 + energy * 0.05
    : state === "listening"
      ? 0.05 + energy * 0.025
      : state === "thinking"
        ? 0.07
        : 0;
  const frameRotate = state === "speaking" ? energy * 0.45 : 0;
  const videoOpacity = videoFailed
    ? 0
    : mode === "waking"
      ? 0.86
      : state === "speaking"
        ? 0.18 + energy * 0.08
        : state === "listening"
          ? 0.16 + energy * 0.06
          : 0.14;
  const canvasBaseOpacity = mode === "standby" ? 0.16 : mode === "active" ? 0.13 : 0.1;
  const videoFilter = state === "speaking"
    ? `saturate(${1.05 + energy * 0.24}) contrast(${1.16 + energy * 0.08}) brightness(${0.94 + energy * 0.08})`
    : state === "listening"
      ? `saturate(${0.98 + energy * 0.14}) contrast(1.16) brightness(${0.95 + energy * 0.03})`
      : state === "thinking"
        ? "saturate(0.96) contrast(1.18) brightness(0.95)"
        : "saturate(0.96) contrast(1.14) brightness(0.94)";
  const activeAudioState = mode === "active" && (state === "speaking" || state === "listening");
  const waveOpacity = activeAudioState
    ? state === "speaking"
      ? 0.18 + energy * 0.34
      : 0.1 + energy * 0.22
    : 0;
  const energyStyle = {
    "--voice-energy": energy.toFixed(3),
    "--aurora-blur": `${(14 + energy * 12).toFixed(1)}px`,
    "--aurora-opacity": (0.18 + energy * 0.34).toFixed(3),
    "--aurora-scale": (0.98 + energy * 0.08).toFixed(3),
    "--aurora-scale-low": (0.97 + energy * 0.06).toFixed(3),
    "--aurora-scale-high": (1.03 + energy * 0.1).toFixed(3),
    "--wave-opacity": waveOpacity.toFixed(3),
    "--wave-opacity-soft": (waveOpacity * 0.75).toFixed(3),
    "--wave-opacity-low": (waveOpacity * 0.72).toFixed(3),
    "--wave-scale": (0.94 + energy * 0.18).toFixed(3),
    "--wave-scale-low": (0.94 + energy * 0.09).toFixed(3),
    "--wave-scale-high": (1.0 + energy * 0.22).toFixed(3),
    "--voice-canvas-opacity": Math.min(0.98, canvasBaseOpacity + energy * 0.16).toFixed(3)
  };

  useEffect(() => {
    setVideoFailed(false);
  }, [video]);

  return (
    <section className={cls("agent-portrait", `state-${state}`, `mode-${mode}`)} aria-label="Jarvis 状态">
      <motion.div
        className="entity-frame"
        initial={false}
        animate={{
          y: frameShift,
          scale: frameScale,
          rotateZ: frameRotate
        }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        style={energyStyle}
      >
        <AnimatePresence mode="sync" initial={false}>
          <motion.video
            key={video}
            className={cls("entity-video", videoFailed && "is-failed")}
            src={video}
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
            onError={() => setVideoFailed(true)}
            onLoadedData={(event) => {
              event.currentTarget.play?.().catch?.(() => {});
            }}
            initial={{ opacity: 0, scale: 1.04, filter: "blur(5px) saturate(0.9) brightness(0.9)" }}
            animate={{
              opacity: videoOpacity,
              scale: videoScaleBase + videoStateBoost,
              filter: videoFilter
            }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(9px) saturate(0.85) brightness(0.86)" }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          />
        </AnimatePresence>
        <JarvisParticleVortex state={state} audioLevel={particleEnergy} />
        <div className="entity-waveform" aria-hidden="true" />
        <div className="entity-matte" />
        <div className="entity-aurora" aria-hidden="true" />
        <div id="voice-panel" className="voice-panel">
          <canvas id="voice-canvas" width="360" height="360" />
          <div className="voice-readout">
            <span id="voice-status">{voiceStatusText}</span>
            <span id="voice-transcript" />
          </div>
        </div>
      </motion.div>
      {mode === "waking" ? (
      <div className="portrait-copy">
        <span>JARVIS</span>
        <strong>{stateLabel(state)}</strong>
        <p>{sending ? "DeepSeek 正在生成回复。" : voiceStatusText}</p>
      </div>
      ) : null}
    </section>
  );
}

function StandbyLayer() {
  return <section className="standby-layer" aria-label="Jarvis 待机屏保"><ClockReadout variant="standby" /></section>;
}

function ClockReadout({ variant = "workbench" }) {
  const clock = useClock();
  return <div className={cls("clock-readout", `${variant}-clock`)} aria-label="本地时间"><strong>{clock.time}</strong><span>{clock.date}</span></div>;
}

function FirstRunSetup({ api, onComplete }) {
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("deepseek-chat");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [voiceProvider, setVoiceProvider] = useState("local");
  const [aliyunApiKey, setAliyunApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingStep, setSavingStep] = useState("");
  const [showModelKey, setShowModelKey] = useState(false);
  const [showVoiceKey, setShowVoiceKey] = useState(false);
  const [error, setError] = useState("");
  const submitLockRef = useRef(false);
  const savingStepRef = useRef("");
  const modelRef = useRef(null);
  const apiKeyRef = useRef(null);
  const baseURLRef = useRef(null);
  const aliyunKeyRef = useRef(null);

  const submit = async (event) => {
    event.preventDefault();
    if (submitLockRef.current) return;
    setError("");
    if (!model.trim()) { setError("请输入模型名称"); modelRef.current?.focus(); return; }
    if (!apiKey.trim()) { setError("请输入模型服务 API Key"); apiKeyRef.current?.focus(); return; }
    if (provider === "custom") {
      try { new URL(baseURL.trim()); } catch { setError("请输入完整的 Base URL，例如 https://example.com/v1"); baseURLRef.current?.focus(); return; }
    }
    if (voiceProvider === "aliyun" && !aliyunApiKey.trim()) { setError("请输入阿里云 DashScope API Key"); aliyunKeyRef.current?.focus(); return; }
    submitLockRef.current = true;
    setSaving(true);
    try {
      savingStepRef.current = "正在保存语音配置";
      setSavingStep(savingStepRef.current);
      const voiceResponse = await fetch(`${api}/settings/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          voiceProvider,
          ...(voiceProvider === "aliyun" ? { aliyunApiKey: aliyunApiKey.trim() } : {})
        }),
        signal: AbortSignal.timeout(15_000)
      });
      const voiceData = await readJson(voiceResponse);
      if (!voiceResponse.ok || voiceData.ok === false) throw new Error(voiceData.error || "语音配置保存失败");

      savingStepRef.current = "正在验证模型连接";
      setSavingStep(savingStepRef.current);
      const activationResponse = await fetch(`${api}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ provider, model: model.trim(), apiKey: apiKey.trim(), baseURL: baseURL.trim() }),
        signal: AbortSignal.timeout(20_000)
      });
      const activationData = await readJson(activationResponse);
      if (!activationResponse.ok || activationData.ok === false) throw new Error(activationData.error || "模型验证失败");
      localStorage.setItem(VOICE_PROVIDER_KEY, voiceProvider);
      window.__JARVIS_VOICE_PROVIDER__ = voiceProvider;
      await onComplete();
    } catch (submitError) {
      const timedOut = submitError?.name === "TimeoutError" || submitError?.name === "AbortError";
      setError(timedOut ? `${savingStepRef.current || "连接"}超时，请检查网络后重试` : (submitError.message || "初始化失败，请检查配置"));
    } finally {
      submitLockRef.current = false;
      setSaving(false);
      setSavingStep("");
      savingStepRef.current = "";
    }
  };

  return (
    <section className="first-run-setup" aria-labelledby="first-run-title">
      <form className="first-run-form" onSubmit={submit}>
        <header>
          <span>GDDXX-JARVIS</span>
          <h2 id="first-run-title">初始化</h2>
          <p>完成核心配置后进入工作台</p>
        </header>

        <div className="first-run-section">
          <strong>模型服务</strong>
          <label className="field">
            <span>服务商</span>
            <select value={provider} onChange={(event) => { const next = event.target.value; setProvider(next); setModel(next === "deepseek" ? "deepseek-chat" : ""); setBaseURL(""); }}>
              <option value="deepseek">DeepSeek</option>
              <option value="custom">兼容 OpenAI 的自定义服务</option>
            </select>
          </label>
          <label className="field">
            <span>模型名称</span>
            <input ref={modelRef} value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-chat" required />
          </label>
          <label className="field">
            <span>API Key</span>
            <span className="secret-field"><input ref={apiKeyRef} type={showModelKey ? "text" : "password"} autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." required /><button type="button" onClick={() => setShowModelKey((value) => !value)} aria-label={showModelKey ? "隐藏模型 API Key" : "显示模型 API Key"} title={showModelKey ? "隐藏密钥" : "显示密钥"}>{showModelKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></span>
          </label>
          {provider === "custom" ? (
            <label className="field">
              <span>Base URL</span>
              <input ref={baseURLRef} type="url" value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="https://.../v1" required />
            </label>
          ) : null}
        </div>

        <fieldset className="first-run-section voice-choice">
          <legend>语音识别</legend>
          <label className={cls("voice-option", voiceProvider === "local" && "selected")}>
            <input type="radio" name="voice-provider" value="local" checked={voiceProvider === "local"} onChange={() => setVoiceProvider("local")} />
            <span><strong>本地</strong><small>语音在电脑上处理，安装包已包含识别模型</small></span>
          </label>
          <label className={cls("voice-option", voiceProvider === "aliyun" && "selected")}>
            <input type="radio" name="voice-provider" value="aliyun" checked={voiceProvider === "aliyun"} onChange={() => setVoiceProvider("aliyun")} />
            <span><strong>阿里云</strong><small>使用 DashScope 实时语音识别</small></span>
          </label>
          {voiceProvider === "aliyun" ? (
            <label className="field">
              <span>DashScope API Key</span>
              <span className="secret-field"><input ref={aliyunKeyRef} type={showVoiceKey ? "text" : "password"} autoComplete="new-password" value={aliyunApiKey} onChange={(event) => setAliyunApiKey(event.target.value)} placeholder="sk-..." required /><button type="button" onClick={() => setShowVoiceKey((value) => !value)} aria-label={showVoiceKey ? "隐藏 DashScope API Key" : "显示 DashScope API Key"} title={showVoiceKey ? "隐藏密钥" : "显示密钥"}>{showVoiceKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></span>
            </label>
          ) : null}
        </fieldset>

        {error ? <p className="first-run-error" role="alert">{error}</p> : null}
        {savingStep ? <p className="first-run-progress" role="status" aria-live="polite">{savingStep}</p> : null}
        <button className="primary first-run-submit" type="submit" disabled={saving} aria-busy={saving}>
          {saving ? <Loader2 className="spin" size={17} /> : <ArrowRight size={17} />}
          验证并进入
        </button>
      </form>
    </section>
  );
}

function HudTerminal({ messages, sending, lastError, turnState, voiceRecovery, onRetryVoice, onUseKeyboard, onDismissError, onReplayMessage }) {
  const [showAll, setShowAll] = useState(false);
  const [followLatest, setFollowLatest] = useState(true);
  const [expandedMessages, setExpandedMessages] = useState(() => new Set());
  const [copiedId, setCopiedId] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const searchRef = useRef(null);
  const normalizedQuery = historyQuery.trim().toLocaleLowerCase();
  const matchingMessages = normalizedQuery
    ? messages.filter((message) => `${cleanText(message.content)} ${message.channel || ""}`.toLocaleLowerCase().includes(normalizedQuery))
    : messages;
  const visibleMessages = normalizedQuery || showAll ? matchingMessages : matchingMessages.slice(-40);
  const terminalRef = useRef(null);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !followLatest) return;
    const frame = window.requestAnimationFrame(() => {
      terminal.scrollTop = terminal.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [followLatest, messages, sending, lastError]);

  const jumpToLatest = useCallback(() => {
    setFollowLatest(true);
    window.requestAnimationFrame(() => terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: "smooth" }));
  }, []);

  const toggleHistorySearch = useCallback(() => {
    setSearchOpen((current) => {
      const next = !current;
      if (!next) setHistoryQuery("");
      else window.requestAnimationFrame(() => searchRef.current?.focus());
      return next;
    });
  }, []);

  const copyMessage = useCallback(async (message) => {
    await navigator.clipboard.writeText(cleanText(message.content));
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId((current) => current === message.id ? null : current), 1400);
  }, []);

  return (
    <aside className="hud-terminal" aria-label="对话记录" aria-busy={sending}>
      <div className="terminal-cap">
        <div><span>对话历史</span><small>CONVERSATION HISTORY</small></div>
        <div className="terminal-cap-actions">
          <button type="button" className={cls("history-search-toggle", searchOpen && "active")} onClick={toggleHistorySearch} aria-label={searchOpen ? "关闭历史搜索" : "搜索对话历史"} aria-expanded={searchOpen}><Search size={13} /></button>
          <div id="turn-status" className={cls("turn-owner", turnState.tone)} aria-live="polite">
            {sending ? <Loader2 className="spin" size={13} /> : <Radio size={13} />}
            <span>{turnState.label}</span>
            {turnState.elapsed ? <time aria-hidden="true">{turnState.elapsed}s</time> : null}
          </div>
        </div>
      </div>
      {sending ? <div className="turn-progress" role="progressbar" aria-label={turnState.label} aria-valuemin="0" aria-valuemax="95" aria-valuenow={Math.min(95, turnState.elapsed || 0)} title={`${turnState.label} · ${turnState.elapsed || 0} 秒`}><i style={{ width: `${Math.min(100, ((turnState.elapsed || 0) / 95) * 100)}%` }} /></div> : null}
      {searchOpen ? (
        <div className="history-search">
          <Search size={13} aria-hidden="true" />
          <input ref={searchRef} type="search" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") toggleHistorySearch(); }} placeholder="搜索内容或来源" aria-label="搜索对话内容或来源" />
          <span role="status" aria-live="polite">{normalizedQuery ? `${matchingMessages.length} 条` : `${messages.length} 条`}</span>
          {historyQuery ? <button type="button" onClick={() => { setHistoryQuery(""); searchRef.current?.focus(); }} aria-label="清空历史搜索"><X size={12} /></button> : null}
        </div>
      ) : null}
      <div
        className="terminal-lines"
        ref={terminalRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          setFollowLatest(element.scrollHeight - element.scrollTop - element.clientHeight < 32);
        }}
      >
        {!normalizedQuery && !showAll && messages.length > 40 ? (
          <button type="button" className="history-expand" onClick={() => setShowAll(true)}>
            <ChevronUp size={13} />显示较早的 {messages.length - 40} 条
          </button>
        ) : !normalizedQuery && showAll && messages.length > 40 ? (
          <button type="button" className="history-expand" onClick={() => setShowAll(false)}>
            <ChevronDown size={13} />收起较早消息
          </button>
        ) : null}
        {visibleMessages.length === 0 && normalizedQuery ? (
          <div className="terminal-empty search-empty"><Search size={18} aria-hidden="true" /><strong>没有匹配的对话</strong><span>换一个关键词，或清空搜索</span></div>
        ) : visibleMessages.length === 0 ? (
          <div className="terminal-empty">
            <Radio size={18} aria-hidden="true" />
            <strong>等待您的指令</strong>
            <span>点击麦克风，或按住空格说话</span>
          </div>
        ) : visibleMessages.map((message) => (
          <div key={message.id} className={cls("terminal-line", message.role, message.id === "live" && "live", cleanText(message.content).length > 260 && "long", expandedMessages.has(message.id) && "expanded")}>
            <div className="terminal-line-head">
              <span>{message.role === "user" ? "您 / YOU" : message.role === "jarvis" ? "贾维斯 / JARVIS" : "系统 / SYSTEM"}</span>
              {message.timestamp ? <time>{formatTime(message.timestamp)}</time> : null}
            </div>
            {message.channel ? <small className="message-channel">{message.channel}</small> : null}
            <div className="message-body">
              {message.role === "jarvis"
                ? <BilingualMessageText content={message.content} compact />
                : <p>{message.content}</p>}
            </div>
            {message.role === "jarvis" && message.content ? (
              <div className="message-actions">
                {cleanText(message.content).length > 260 ? <button type="button" onClick={() => setExpandedMessages((current) => {
                  const next = new Set(current);
                  if (next.has(message.id)) next.delete(message.id); else next.add(message.id);
                  return next;
                })}>{expandedMessages.has(message.id) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{expandedMessages.has(message.id) ? "收起" : "展开"}</button> : null}
                <button type="button" onClick={() => copyMessage(message)}><Copy size={13} />{copiedId === message.id ? "已复制" : "复制"}</button>
                <button type="button" onClick={() => onReplayMessage(message.content)}><Volume2 size={13} />重播</button>
              </div>
            ) : null}
          </div>
        ))}
        {lastError ? (
          <div className="terminal-line system voice-recovery" role="alert" aria-live="assertive">
            <div className="terminal-line-head">
              <span>{voiceRecovery?.kind === "device" ? "MICROPHONE" : "VOICE RECOVERY"}</span>
              <button type="button" className="recovery-dismiss" onClick={onDismissError} aria-label="关闭语音错误" title="关闭"><X size={13} /></button>
            </div>
            <p>{lastError}</p>
            {voiceRecovery?.detail ? <small>{voiceRecovery.detail}</small> : null}
            <div className="recovery-actions">
              {voiceRecovery?.kind !== "device" ? <button type="button" onClick={onRetryVoice}><Mic size={13} />重试</button> : null}
              <button type="button" onClick={onUseKeyboard}><Keyboard size={13} />键盘输入</button>
            </div>
          </div>
        ) : null}
      </div>
      {!followLatest ? <button type="button" className="jump-latest" onClick={jumpToLatest}><ChevronDown size={14} />最新消息</button> : null}
    </aside>
  );
}

function SettingsDrawer({ open, onClose, activation, readiness, api, refreshAll }) {
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("deepseek-v4-pro");
  const [baseURL, setBaseURL] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ text: "", type: "" });
  const [aiHotEndpoint, setAiHotEndpoint] = useState("https://aihot.virxact.com/api/public/items");
  const [aiHotApiKey, setAiHotApiKey] = useState("");
  const [aiHotKeyConfigured, setAiHotKeyConfigured] = useState(false);
  const [aiHotSaving, setAiHotSaving] = useState(false);
  const [aiHotFeedback, setAiHotFeedback] = useState({ text: "", type: "" });
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!activation) return;
    setProvider(activation.provider || "deepseek");
    setModel(activation.model || activation.defaultModel || "deepseek-v4-pro");
    setBaseURL(activation.baseURL || "");
  }, [activation]);

  useEffect(() => {
    if (!open) return undefined;
    fetch(`${api}/settings/ai-hot`)
      .then(readJson)
      .then((data) => {
        if (!data?.aiHot) return;
        setAiHotEndpoint(data.aiHot.endpoint || "https://aihot.virxact.com/api/public/items");
        setAiHotKeyConfigured(Boolean(data.aiHot.apiKeyConfigured));
      })
      .catch(() => setAiHotFeedback({ text: "无法读取 AI HOT 配置", type: "error" }));
    const previousFocus = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      setApiKey("");
      setAiHotApiKey("");
      setShowApiKey(false);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [api, onClose, open]);

  const saveModel = async () => {
    if (!provider.trim() || !model.trim()) {
      setFeedback({ text: "请填写服务商和模型", type: "error" });
      return;
    }
    if (baseURL.trim()) {
      try {
        const parsed = new URL(baseURL.trim());
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        setFeedback({ text: "Base URL 必须是有效的 HTTP 或 HTTPS 地址", type: "error" });
        return;
      }
    }
    setSaving(true);
    setFeedback({ text: "", type: "" });
    try {
      const endpoint = activation?.activated ? "/settings/model" : "/activate";
      const body = {
        provider,
        model,
        baseURL,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
      };
      const response = await fetch(`${api}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS)
      });
      const data = await readJson(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "保存失败");
      setApiKey("");
      setFeedback({ text: "模型配置已保存", type: "success" });
      await refreshAll();
    } catch (error) {
      setFeedback({ text: error.message || "保存失败", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const caps = readiness?.capabilities || {};

  const saveAiHot = async () => {
    setAiHotSaving(true);
    setAiHotFeedback({ text: "", type: "" });
    try {
      const response = await fetch(`${api}/settings/ai-hot`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ endpoint: aiHotEndpoint.trim(), ...(aiHotApiKey ? { apiKey: aiHotApiKey.trim() } : {}) })
      });
      const data = await readJson(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "保存失败");
      setAiHotApiKey("");
      setAiHotKeyConfigured(Boolean(data.aiHot?.apiKeyConfigured));
      setAiHotFeedback({ text: "AI HOT 资讯源已保存", type: "success" });
    } catch (error) {
      setAiHotFeedback({ text: error.message || "保存失败", type: "error" });
    } finally {
      setAiHotSaving(false);
    }
  };

  const clearAiHotKey = async () => {
    setAiHotSaving(true);
    setAiHotFeedback({ text: "", type: "" });
    try {
      const response = await fetch(`${api}/settings/ai-hot`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ endpoint: aiHotEndpoint.trim(), apiKey: "" })
      });
      const data = await readJson(response);
      if (!response.ok || data.ok === false) throw new Error(data.error || "清除失败");
      setAiHotApiKey("");
      setAiHotKeyConfigured(false);
      setAiHotFeedback({ text: "AI HOT 密钥已清除，当前使用公开接口", type: "success" });
    } catch (error) {
      setAiHotFeedback({ text: error.message || "清除失败", type: "error" });
    } finally {
      setAiHotSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          ref={drawerRef}
          className="drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-drawer-title"
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 28 }}
          transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
        >
          <div className="drawer-head">
            <div>
              <span>Settings</span>
              <strong id="settings-drawer-title">模型与能力</strong>
            </div>
            <button ref={closeButtonRef} className="icon-btn" type="button" onClick={onClose} aria-label="关闭设置">
              <X size={18} />
            </button>
          </div>

          <div className="drawer-section">
            <StatusPill ok={!!activation?.activated} label="DeepSeek" detail={activation?.activated ? activation.model || activation.provider : "未激活"} />
            <label className="field">
              <span>Provider</span>
              <input value={provider} onChange={(event) => setProvider(event.target.value)} />
            </label>
            <label className="field">
              <span>Model</span>
              <select value={model} onChange={(event) => setModel(event.target.value)}>
                {(activation?.models || [{ id: model, label: model }]).map((item) => (
                  <option key={item.id} value={item.id}>{item.label || item.id}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>API Key</span>
              <span className="secret-input">
                <input
                  type={showApiKey ? "text" : "password"}
                  autoComplete="new-password"
                  spellCheck="false"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={activation?.activated ? "已配置，留空则不修改" : "sk-..."}
                />
                <button type="button" className="icon-btn" onClick={() => setShowApiKey((value) => !value)} aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} title={showApiKey ? "隐藏 API Key" : "显示 API Key"}>
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <label className="field">
              <span>Base URL</span>
              <input type="url" value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="默认可留空" />
            </label>
            <button className="primary wide" disabled={saving || !provider.trim() || !model.trim()} aria-busy={saving} onClick={saveModel} type="button">
              {saving ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
              保存模型配置
            </button>
            {feedback.text ? (
              <p className={cls("feedback", feedback.type === "error" && "error")} role={feedback.type === "error" ? "alert" : "status"} aria-live="polite">
                {feedback.text}
              </p>
            ) : null}
          </div>

          <div className="drawer-section grid">
            <StatusPill compact ok={!!caps.asr?.ready} label="ASR" detail={caps.asr?.provider || "未配置"} />
            <StatusPill compact ok={!!caps.tts?.ready} label="TTS" detail={caps.tts?.provider || "未配置"} />
            <StatusPill compact ok={!!caps.tools?.ready} label="Tools" detail={caps.tools ? `${caps.tools.total || 0}` : ""} />
            <StatusPill compact ok={!!caps.memory?.ready} label="Memory" detail={caps.memory ? `${caps.memory.count || 0}` : ""} />
          </div>

          <div className="drawer-section">
            <StatusPill ok label="AI HOT 资讯" detail={aiHotKeyConfigured ? "自定义密钥已配置" : "官方公开接口 · 免 API Key"} />
            <label className="field">
              <span>资讯接口地址</span>
              <input type="url" value={aiHotEndpoint} onChange={(event) => setAiHotEndpoint(event.target.value)} />
            </label>
            <label className="field">
              <span>API Key（可选）</span>
              <input
                type="password"
                autoComplete="new-password"
                spellCheck="false"
                value={aiHotApiKey}
                onChange={(event) => setAiHotApiKey(event.target.value)}
                placeholder={aiHotKeyConfigured ? "已配置，留空则不修改" : "官方接口无需填写"}
              />
            </label>
            <p className="field-note">默认使用 AI HOT 官方公开接口，不需要 API Key。只有切换到需要鉴权的兼容接口时，才需要用户自行申请并填写密钥。</p>
            <button className="secondary wide" disabled={aiHotSaving} aria-busy={aiHotSaving} onClick={saveAiHot} type="button">
              {aiHotSaving ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
              保存 AI HOT 配置
            </button>
            {aiHotKeyConfigured ? (
              <button className="secondary wide" disabled={aiHotSaving} onClick={clearAiHotKey} type="button">清除已配置密钥</button>
            ) : null}
            {aiHotFeedback.text ? (
              <p className={cls("feedback", aiHotFeedback.type === "error" && "error")} role={aiHotFeedback.type === "error" ? "alert" : "status"}>
                {aiHotFeedback.text}
              </p>
            ) : null}
          </div>

          <div className="drawer-section link-grid">
            {LINKS.map((item) => <ModuleLink key={item.path || item.action} item={item} api={api} onSettings={onClose} />)}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function sanitizeAcuiValue(value, depth = 0) {
  if (depth > 4) return "[nested data]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.slice(0, ACUI_STRING_LIMIT);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeAcuiValue(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, ACUI_STRING_LIMIT);
  return Object.fromEntries(
    Object.entries(value).slice(0, 32).map(([key, item]) => [
      String(key).slice(0, 80),
      sanitizeAcuiValue(item, depth + 1)
    ])
  );
}

function mergeAcuiPatch(props, patchOp, data) {
  const current = props && typeof props === "object" ? props : {};
  const patch = data && typeof data === "object" ? sanitizeAcuiValue(data) : {};
  if (patchOp === "replace") return patch;
  if (patchOp === "append") {
    const key = String(patch.key || "items").slice(0, 80);
    const nextItems = Array.isArray(current[key]) ? current[key].slice(0, 11) : [];
    return { ...current, [key]: [...nextItems, sanitizeAcuiValue(patch.value)] };
  }
  return { ...current, ...patch };
}

function useAcuiCards(api) {
  const [cards, setCards] = useState([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  const sendSignal = useCallback((type, target, payload = {}) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify({
        v: 1,
        kind: "ui.signal",
        type,
        target: target || null,
        payload: sanitizeAcuiValue(payload),
        ts: Date.now()
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const dismissCard = useCallback((id, by = "user") => {
    if (!id) return;
    let dwellMs = 0;
    setCards((current) => {
      const card = current.find((item) => item.id === id);
      if (card) dwellMs = Math.max(0, Date.now() - card.mountedAt);
      return current.filter((item) => item.id !== id);
    });
    window.setTimeout(() => sendSignal("card.dismissed", id, { by, dwell_ms: dwellMs }), 0);
  }, [sendSignal]);

  useEffect(() => {
    if (!api) return undefined;
    let disposed = false;
    let reconnectTimer = 0;
    let reconnectDelay = 800;

    const connect = () => {
      if (disposed) return;
      let socket;
      try {
        const url = new URL(api);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = "/acui";
        url.search = "";
        socket = new WebSocket(url.toString());
      } catch {
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, ACUI_RECONNECT_MAX_MS);
        return;
      }
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (disposed || socket !== socketRef.current) return;
        reconnectDelay = 800;
        setConnected(true);
      });
      socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (!message || message.v !== 1) return;
        if (message.kind === "ping") {
          try { socket.send(JSON.stringify({ v: 1, kind: "pong" })); } catch {}
          return;
        }
        if (message.kind !== "ui.command" || !message.id) return;
        const id = String(message.id).slice(0, 160);
        if (message.op === "unmount") {
          dismissCard(id, "agent");
          return;
        }
        if (message.op === "update" || message.op === "patch") {
          setCards((current) => current.map((card) => {
            if (card.id !== id) return card;
            const incoming = sanitizeAcuiValue(message.props || {});
            const props = message.op === "patch"
              ? mergeAcuiPatch(card.props, message.patchOp, message.data)
              : { ...card.props, ...incoming };
            return { ...card, props, updatedAt: Date.now() };
          }));
          return;
        }
        if (message.op !== "mount") return;
        const now = Date.now();
        const nextCard = {
          id,
          component: String(message.component || message.mode || "Result").slice(0, 80),
          mode: String(message.mode || "component").slice(0, 40),
          props: sanitizeAcuiValue(message.props || {}),
          hint: sanitizeAcuiValue(message.hint || {}),
          mountedAt: now,
          updatedAt: now
        };
        let evicted = null;
        setCards((current) => {
          const withoutDuplicate = current.filter((card) => card.id !== id);
          const next = [...withoutDuplicate, nextCard];
          if (next.length <= ACUI_CARD_LIMIT) return next;
          evicted = next[0];
          return next.slice(-ACUI_CARD_LIMIT);
        });
        window.setTimeout(() => {
          if (evicted) sendSignal("card.dismissed", evicted.id, { by: "capacity", dwell_ms: now - evicted.mountedAt });
          sendSignal("card.mounted", id, { component: nextCard.component });
        }, 0);
      });
      const reconnect = () => {
        if (disposed || socket !== socketRef.current) return;
        socketRef.current = null;
        setConnected(false);
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, ACUI_RECONNECT_MAX_MS);
      };
      socket.addEventListener("close", reconnect);
      socket.addEventListener("error", () => {
        try { socket.close(); } catch {}
      });
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      setConnected(false);
      try { socket?.close?.(); } catch {}
    };
  }, [api, dismissCard, sendSignal]);

  return { cards, connected, dismissCard, sendSignal };
}

function AcuiWeatherCard({ props }) {
  const forecast = Array.isArray(props.forecast) ? props.forecast.slice(0, 3) : [];
  return (
    <div className="acui-weather">
      <div className="acui-weather-primary">
        <CloudSun size={30} aria-hidden="true" />
        <div>
          <strong>{props.temp ?? "--"}<span>deg</span></strong>
          <p>{props.condition || props.desc || "Weather update"}</p>
        </div>
      </div>
      <div className="acui-weather-city">{props.city || "Current location"}</div>
      <div className="acui-weather-meta">
        {props.feel != null ? <span><Thermometer size={13} />Feels {props.feel} deg</span> : null}
        {props.wind ? <span><Wind size={13} />{props.wind}</span> : null}
        {props.high != null || props.low != null ? <span>H {props.high ?? "--"} / L {props.low ?? "--"}</span> : null}
      </div>
      {forecast.length ? (
        <div className="acui-forecast">
          {forecast.map((item, index) => (
            <span key={`${item.day || item.time || "forecast"}-${index}`}>
              <small>{item.day || item.time || `D${index + 1}`}</small>
              <b>{item.high ?? item.temp ?? "--"}</b>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AcuiStatusCard({ component, props }) {
  if (component === "SelfCheckCard" && Array.isArray(props.results)) {
    return (
      <div className="acui-check-list">
        {props.results.slice(0, 6).map((item, index) => (
          <div key={`${item.name || "check"}-${index}`}>
            {String(item.status || "").toLowerCase() === "ok" ? <CheckCircle2 size={14} /> : <Activity size={14} />}
            <span>{item.name || `Check ${index + 1}`}</span>
            <small>{item.note || item.status || "ready"}</small>
          </div>
        ))}
        {props.overall ? <p>{props.overall}</p> : null}
      </div>
    );
  }
  if (component === "SelfCheckStepCard") {
    const total = Math.max(1, Number(props.total) || 1);
    const step = Math.min(total, Math.max(0, Number(props.step) || 0));
    return (
      <div className="acui-progress">
        <p>{props.name || "System check"}</p>
        <span><i style={{ width: `${(step / total) * 100}%` }} /></span>
        <small>{step} / {total}</small>
      </div>
    );
  }
  if (component === "AwakeningCard") {
    return (
      <div className="acui-finding">
        <strong>{props.title || "System finding"}</strong>
        {props.finding ? <p>{props.finding}</p> : null}
        <small>{props.index || 0} / {props.total || 0}</small>
      </div>
    );
  }
  const entries = Object.entries(props || {}).slice(0, 8);
  return entries.length ? (
    <dl className="acui-data-list">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{typeof value === "object" ? JSON.stringify(value).slice(0, 220) : String(value)}</dd>
        </div>
      ))}
    </dl>
  ) : <p className="acui-empty">Result received.</p>;
}

function AcuiResultCard({ card, onDismiss }) {
  useEffect(() => {
    const lifetime = card.component === "WeatherCard" ? 15_000 : 30_000;
    const timer = window.setTimeout(() => onDismiss(card.id, "auto-timeout"), lifetime);
    return () => window.clearTimeout(timer);
  }, [card.component, card.id, card.updatedAt, onDismiss]);

  const isInline = card.mode === "inline-template" || card.mode === "inline-script";
  return (
    <motion.article
      className="acui-result-card"
      layout
      initial={{ opacity: 0, x: 24, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.97 }}
      transition={{ duration: 0.24 }}
      aria-label={`${card.component} result`}
    >
      <header>
        <span><i />LIVE RESULT</span>
        <strong>{card.component}</strong>
        <button type="button" onClick={() => onDismiss(card.id, "user")} aria-label={`Close ${card.component}`} title="Close result">
          <X size={15} />
        </button>
      </header>
      <div className="acui-card-body">
        {card.component === "WeatherCard"
          ? <AcuiWeatherCard props={card.props} />
          : isInline
            ? <div className="acui-safe-notice"><CircleAlert size={15} /><p>Dynamic interface code was received but was not executed. The structured result is shown safely.</p></div>
            : <AcuiStatusCard component={card.component} props={card.props} />}
      </div>
    </motion.article>
  );
}

function AcuiWorkbenchLayer({ cards, connected, onDismiss }) {
  if (!cards.length) {
    return React.createElement("div", {
      className: "acui-connection-marker",
      "data-connected": connected ? "true" : "false",
      "aria-hidden": "true"
    });
  }
  return React.createElement(
    "aside",
    {
      className: "acui-result-layer",
      "aria-label": "Jarvis live results",
      "aria-live": "polite",
      "data-connected": connected ? "true" : "false"
    },
    cards.map((card) => React.createElement(AcuiResultCard, {
      key: card.id,
      card,
      onDismiss
    }))
  );
}

function App() {
  const [api, setApi] = useState(() => (
    typeof window !== "undefined" && window.jarvisDesktop?.getBackendPort ? "" : DEFAULT_API
  ));
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(() => {
    try { return localStorage.getItem(DRAFT_STORAGE_KEY) || ""; } catch { return ""; }
  });
  const [connection, setConnection] = useState({ state: "connecting", detail: "连接核心服务" });
  const [activation, setActivation] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [visualState, setVisualState] = useState("idle");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [voiceStatusText, setVoiceStatusText] = useState("点按语音开始");
  const [lastError, setLastError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [interfaceMode, setInterfaceMode] = useState("standby");
  const [musicEnabled, setMusicEnabled] = useState(() => isAmbientMusicEnabled());
  const [engineeringOpen, setEngineeringOpen] = useState(false);
  const [textInputOpen, setTextInputOpen] = useState(false);
  const [textInputExpanded, setTextInputExpanded] = useState(false);
  const [voiceRecovery, setVoiceRecovery] = useState(null);
  const [turnElapsedSeconds, setTurnElapsedSeconds] = useState(0);
  const [appVersion, setAppVersion] = useState("");
  const [grokBuildStatus, setGrokBuildStatus] = useState(null);
  const { cards: acuiCards, connected: acuiConnected, dismissCard: dismissAcuiCard } = useAcuiCards(api);

  useEffect(() => {
    let disposed = false;
    window.jarvisDesktop?.getVersion?.().then((version) => {
      if (!disposed) setAppVersion(String(version || ""));
    }).catch(() => {});
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const onLevel = (event) => setAudioLevel(Math.min(1, Math.max(0, Number(event.detail?.ttsLevel || event.detail?.level || 0))));
    window.addEventListener("jarvis:voice-level", onLevel);
    return () => window.removeEventListener("jarvis:voice-level", onLevel);
  }, []);

  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);
  const sendMessageRef = useRef(null);
  const pollRef = useRef(null);
  const pollInFlightRef = useRef(false);
  const reloadTimerRef = useRef(null);
  const refreshInFlightRef = useRef(null);
  const maxMessageIdRef = useRef(0);
  const lastVoiceTurnRef = useRef(false);
  const lastSpokenTextRef = useRef("");
  const lastSpokenAtRef = useRef(0);
  const lastVoiceSendTextRef = useRef({ text: "", at: 0 });
  const voiceBlockedUntilRef = useRef(0);
  const ttsIsActiveRef = useRef(false);
  const ttsCurrentTextRef = useRef("");
  const currentSegmentRef = useRef("");
  const currentAudioRef = useRef(null);
  const currentAudioUrlRef = useRef("");
  const currentSpeechFinishRef = useRef(null);
  const currentSpeechAbortRef = useRef(null);
  const ttsAudioGraphRef = useRef(null);
  const speakReplyRef = useRef(null);
  const interfaceModeRef = useRef("standby");
  const wakeRestartRef = useRef(null);
  const workbenchEnterRef = useRef(null);
  const postWakeListenRef = useRef(null);
  const postReplyListenRef = useRef(null);
  const wakeSequencePromiseRef = useRef(null);
  const wakeMetricsRef = useRef({});
  const wakeAcceptedRef = useRef(false);
  const voiceInitializedRef = useRef(false);
  const speechPrefetchStartedRef = useRef(false);
  const speechCacheRef = useRef(new Map());
  const activeTurnRef = useRef(null);
  const submitLockRef = useRef(false);
  const visibleStreamRef = useRef(false);
  const postReplyListenMetricsRef = useRef({ scheduledAt: 0, startedAt: 0 });
  const voiceRepairCountRef = useRef(0);
  const turnStartedAtRef = useRef(0);
  const composingRef = useRef(false);
  const pttHeldRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (draft) localStorage.setItem(DRAFT_STORAGE_KEY, draft);
        else localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {}
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    if (!draft || !inputRef.current) return;
    if (!textInputOpen) setTextInputOpen(true);
    const field = inputRef.current;
    field.style.height = "auto";
    const nextHeight = Math.min(76, field.scrollHeight);
    field.style.height = `${nextHeight}px`;
    setTextInputExpanded(nextHeight > 54);
  }, [draft, textInputOpen]);

  const openTextInput = useCallback(() => {
    setTextInputOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const retryVoice = useCallback(() => {
    setLastError("");
    setVoiceRecovery(null);
    const button = document.getElementById("voice-toggle");
    if (!window.jarvisVoice?.isActive?.()) button?.click();
  }, []);

  const dismissVoiceError = useCallback(() => {
    setLastError("");
    setVoiceRecovery(null);
    setVisualState((current) => current === "alert" ? "idle" : current);
  }, []);

  useEffect(() => {
    interfaceModeRef.current = interfaceMode;
    window.__JARVIS_INTERFACE_MODE__ = interfaceMode;
    if (interfaceMode === "standby") wakeAcceptedRef.current = false;
    return () => {
      if (window.__JARVIS_INTERFACE_MODE__ === interfaceMode) delete window.__JARVIS_INTERFACE_MODE__;
    };
  }, [interfaceMode]);

  const apiFetch = useCallback(async (path, options = {}) => {
    if (!api) throw new Error("核心服务端口尚未就绪");
    const { timeoutMs = API_TIMEOUT_MS, signal, ...fetchOptions } = options;
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener?.("abort", relayAbort, { once: true });
    const timeout = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
    try {
      const request = () => fetch(`${api}${path}`, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          ...(fetchOptions.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
          ...(fetchOptions.headers || {})
        }
      });
      let response;
      try {
        response = await request();
      } catch (error) {
        const retryable = !fetchOptions.method || String(fetchOptions.method).toUpperCase() === "GET";
        if (!retryable || controller.signal.aborted) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 240));
        response = await request();
      }
      const data = await readJson(response);
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || response.statusText || "请求失败");
      }
      setConnection({ state: "online", detail: "核心在线" });
      return data;
    } catch (error) {
      if (error?.name === "TimeoutError" || controller.signal.reason?.name === "TimeoutError") {
        setConnection({ state: "degraded", detail: "核心响应超时" });
        throw new Error("核心服务响应超时，请稍后重试");
      }
      if (error?.name !== "AbortError") setConnection({ state: "degraded", detail: "核心连接中断" });
      throw error;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener?.("abort", relayAbort);
    }
  }, [api]);

  const refreshGrokBuild = useCallback(async () => {
    if (!api) return null;
    const next = await apiFetch("/grok-build/status");
    setGrokBuildStatus(next);
    return next;
  }, [api, apiFetch]);

  const startEngineeringTask = useCallback(async (prompt) => {
    setEngineeringOpen(true);
    const result = await apiFetch("/grok-build/tasks", {
      method: "POST",
      body: JSON.stringify({ prompt })
    });
    setGrokBuildStatus((current) => ({ ...(current || {}), ok: true, available: true, task: result.task }));
    return result.task;
  }, [apiFetch]);

  const cancelEngineeringTask = useCallback(async () => {
    const taskId = grokBuildStatus?.task?.id;
    if (!taskId) return;
    const result = await apiFetch(`/grok-build/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" });
    setGrokBuildStatus((current) => ({ ...(current || {}), task: result.task }));
  }, [apiFetch, grokBuildStatus?.task?.id]);

  const answerEngineeringPermission = useCallback(async (decision) => {
    const taskId = grokBuildStatus?.task?.id;
    if (!taskId) return;
    const result = await apiFetch(`/grok-build/tasks/${encodeURIComponent(taskId)}/permission`, {
      method: "POST",
      body: JSON.stringify({ decision })
    });
    setGrokBuildStatus((current) => ({ ...(current || {}), task: result.task }));
  }, [apiFetch, grokBuildStatus?.task?.id]);

  useEffect(() => {
    if (!api) return undefined;
    refreshGrokBuild().catch(() => {});
    const timer = window.setInterval(() => {
      const statusName = grokBuildStatus?.task?.status;
      if (engineeringOpen || ["starting", "running", "waiting_permission"].includes(statusName)) {
        refreshGrokBuild().catch(() => {});
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [api, engineeringOpen, grokBuildStatus?.task?.status, refreshGrokBuild]);

  const prepareSpeechBlob = useCallback((rawText, { cache = false, signal } = {}) => {
    const text = plainSpeechText(spokenReplyText(rawText));
    if (!api || !text || /[\u3400-\u9fff]/.test(text)) return Promise.resolve(null);
    const key = `${JARVIS_TTS_VOICE_ID}:${text}`;
    const cached = speechCacheRef.current.get(key);
    if (cache && cached) return cached;
    const staticAsset = text === WAKE_GREETING_SPEECH
      ? "./audio/wake-greeting.wav"
      : text === READY_SELF_CHECK_SPEECH
        ? "./audio/self-check-ready.wav"
        : "";
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener?.("abort", relayAbort, { once: true });
    const timeout = window.setTimeout(() => controller.abort(new DOMException("TTS request timed out", "TimeoutError")), TTS_FETCH_TIMEOUT_MS);
    const task = fetch(staticAsset || `${api}/tts/stream`, staticAsset ? {
      signal: controller.signal
    } : {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text })
    }).then(async (response) => {
      if (!response.ok) throw new Error("TTS stream failed");
      return response.blob();
    }).finally(() => {
      window.clearTimeout(timeout);
      signal?.removeEventListener?.("abort", relayAbort);
    });
    if (cache) {
      while (speechCacheRef.current.size >= SPEECH_CACHE_LIMIT) {
        const oldestKey = speechCacheRef.current.keys().next().value;
        if (!oldestKey) break;
        speechCacheRef.current.delete(oldestKey);
      }
      speechCacheRef.current.set(key, task);
      task.catch(() => {
        if (speechCacheRef.current.get(key) === task) speechCacheRef.current.delete(key);
      });
    }
    return task;
  }, [api]);

  const loadConversations = useCallback(async ({ commit = true } = {}) => {
    const rows = await apiFetch("/conversations?limit=80");
    const normalized = normalizeMessages(rows);
    maxMessageIdRef.current = Math.max(0, ...normalized.map((row) => Number(row.id) || 0));
    if (commit) setMessages(normalized);
    return normalized;
  }, [apiFetch]);

  const refreshAll = useCallback(() => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    setRefreshing(true);
    const task = (async () => {
      const [activationData, readinessData, statusData, voiceData] = await Promise.all([
        apiFetch("/activation-status").catch((error) => ({ activated: false, error: error.message })),
        apiFetch("/readiness").catch((error) => ({ ok: false, error: error.message, capabilities: {} })),
        apiFetch("/status").catch((error) => ({ ok: false, error: error.message })),
        apiFetch("/settings/voice").catch(() => null)
      ]);
      const voiceProvider = voiceData?.voice?.voiceProvider;
      if (voiceProvider) {
        localStorage.setItem(VOICE_PROVIDER_KEY, voiceProvider);
        window.__JARVIS_VOICE_PROVIDER__ = voiceProvider;
      }
      setActivation(activationData);
      setReadiness(readinessData);
      setStatus(statusData);
      return { activationData, readinessData, statusData, voiceData };
    })().finally(() => {
      refreshInFlightRef.current = null;
      setRefreshing(false);
    });
    refreshInFlightRef.current = task;
    return task;
  }, [apiFetch]);

  useEffect(() => {
    if (api) window.__JARVIS_API_BASE__ = api;
  }, [api]);

  useEffect(() => {
    if (!api || speechPrefetchStartedRef.current) return undefined;
    speechPrefetchStartedRef.current = true;
    const controller = new AbortController();
    (async () => {
      let greeting = null;
      for (let attempt = 0; attempt < 4 && !controller.signal.aborted && !greeting; attempt += 1) {
        greeting = await prepareSpeechBlob(WAKE_GREETING, { cache: true, signal: controller.signal }).catch(() => null);
        if (!greeting && !controller.signal.aborted) {
          await new Promise((resolve) => window.setTimeout(resolve, 350 + attempt * 150));
        }
      }
      if (controller.signal.aborted || !greeting) return;
      const snapshot = await apiFetch("/readiness", { signal: controller.signal, timeoutMs: 5000 }).catch(() => null);
      if (snapshot) {
        await prepareSpeechBlob(buildSelfCheckReply(snapshot), { cache: true, signal: controller.signal }).catch(() => null);
      }
    })();
    return () => controller.abort();
  }, [api, apiFetch, prepareSpeechBlob]);

  useEffect(() => {
    initAudioOutputRouting({ getCurrentAudioEl: () => currentAudioRef.current });
    if (musicEnabled) startAmbientMusic().catch(() => false);
  }, []);

  const toggleAmbientMusic = useCallback(async (next = !musicEnabled) => {
    if (next) {
      const started = await startAmbientMusic();
      setMusicEnabled(started);
      return started;
    }
    stopAmbientMusic();
    setMusicEnabled(false);
    return true;
  }, [musicEnabled]);

  const closeSettings = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    return () => {
      window.clearTimeout(wakeRestartRef.current);
      window.clearTimeout(workbenchEnterRef.current);
      window.clearTimeout(postWakeListenRef.current);
      window.clearTimeout(postReplyListenRef.current);
      window.clearTimeout(reloadTimerRef.current);
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
      pollInFlightRef.current = false;
      activeTurnRef.current = null;
      visibleStreamRef.current = false;
      currentSpeechAbortRef.current?.abort?.();
      try { currentAudioRef.current?.pause?.(); } catch {}
      speechCacheRef.current.clear();
    };
  }, []);

  const reloadAfterEvent = useCallback(() => {
    window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      loadConversations().catch(() => {});
      refreshAll().catch(() => {});
    }, 160);
  }, [loadConversations, refreshAll]);

  const clearTTSAudioGraph = useCallback((graph = ttsAudioGraphRef.current) => {
    if (graph) try { graph.teardown?.(); } catch {}
    if (!graph || graph === ttsAudioGraphRef.current) ttsAudioGraphRef.current = null;
    try { window.jarvisVoice?.setTTSAnalyser?.(null); } catch {}
  }, []);

  const stopTTSPlayback = useCallback(() => {
    currentSpeechAbortRef.current?.abort?.();
    currentSpeechAbortRef.current = null;
    const finishActiveSpeech = currentSpeechFinishRef.current;
    const audio = currentAudioRef.current;
    if (audio) {
      try { audio.pause(); audio.src = ""; } catch {}
    }
    if (finishActiveSpeech) {
      finishActiveSpeech(false);
      return;
    }
    currentAudioRef.current = null;
    if (currentAudioUrlRef.current) try { URL.revokeObjectURL(currentAudioUrlRef.current); } catch {}
    currentAudioUrlRef.current = "";
    clearTTSAudioGraph();
    ttsIsActiveRef.current = false;
    ttsCurrentTextRef.current = "";
    currentSegmentRef.current = "";
    setVisualState((current) => current === "speaking" ? "idle" : current);
    setAmbientMusicDucked(false);
  }, [clearTTSAudioGraph]);

  const rememberSpokenText = useCallback((text) => {
    const now = Date.now();
    lastSpokenTextRef.current = text;
    lastSpokenAtRef.current = now;
    ttsCurrentTextRef.current = text;
    currentSegmentRef.current = currentSegment(text);
  }, []);

  const markVoiceReadyForNextTurn = useCallback((source = "voice") => {
    ttsIsActiveRef.current = false;
    ttsCurrentTextRef.current = "";
    currentSegmentRef.current = "";
    if (source === "tts") {
      setVoiceStatusText("语音回复结束");
    } else {
      setVoiceStatusText("点击麦克风开始");
    }
  }, []);

  const isLikelySelfEcho = useCallback((value) => {
    const normalized = normalizeEchoText(value);
    if (!normalized) return false;
    const now = Date.now();
    const spoken = normalizeEchoText(lastSpokenTextRef.current);
    const recentSpoken = spoken && now - lastSpokenAtRef.current <= SELF_ECHO_GUARD_MS;
    const activeTts = ttsIsActiveRef.current;
    if (activeTts) {
      if (echoTextOverlaps(normalized, ttsCurrentTextRef.current)) return true;
      if (echoTextOverlaps(normalized, currentSegmentRef.current)) return true;
    }
    if (recentSpoken && echoTextOverlaps(normalized, spoken)) return true;
    return false;
  }, []);

  const resumeMicAfterTTS = useCallback(() => {
    try { window.jarvisVoice?.enterPassiveMode?.(); } catch {}
    try { window.jarvisVoice?.ensureMonitor?.(); } catch {}
  }, []);

  const startVoiceListening = useCallback(() => {
    const toggle = document.getElementById("voice-toggle");
    if (toggle && !window.jarvisVoice?.isActive?.()) toggle.click();
  }, []);

  const schedulePostReplyListen = useCallback(() => {
    window.clearTimeout(postReplyListenRef.current);
    postReplyListenMetricsRef.current = { scheduledAt: performance.now(), startedAt: 0 };
    setVoiceStatusText("麦克风待命，点击按钮开始对话");
    postReplyListenRef.current = window.setTimeout(() => {
      postReplyListenRef.current = null;
      if (interfaceModeRef.current !== "active") return;
      postReplyListenMetricsRef.current.startedAt = performance.now();
      resumeMicAfterTTS();
    }, 120);
  }, [resumeMicAfterTTS]);

  const scheduleWakeListen = useCallback(() => {
    window.clearTimeout(wakeRestartRef.current);
    wakeRestartRef.current = window.setTimeout(() => {
      if (interfaceModeRef.current === "standby" && !window.jarvisVoice?.isActive?.()) {
        startVoiceListening();
      }
    }, WAKE_RESTART_MS);
  }, [startVoiceListening]);

  const playWakeSequence = useCallback(() => {
    if (wakeSequencePromiseRef.current) return wakeSequencePromiseRef.current;
    const task = (async () => {
      wakeMetricsRef.current.sequenceStartedAt = performance.now();
      voiceBlockedUntilRef.current = Date.now() + VOICE_POST_TTS_BLOCK_MS;
      const wakeGreeting = WAKE_GREETING;
      const greetingAudio = prepareSpeechBlob(wakeGreeting, { cache: false });
      const readinessRequest = apiFetch("/readiness", { timeoutMs: 5000 }).catch(() => readiness);
      setMessages((current) => [
        ...current,
        { id: `wake-greeting-${Date.now()}`, role: "jarvis", content: wakeGreeting, channel: "WAKE" }
      ]);
      if (musicEnabled) startAmbientMusic().catch(() => false);
      const transition = playWakeTransitionSfx().catch(() => false);
      const greetingLeadStartedAt = performance.now();
      await Promise.race([
        transition,
        new Promise((resolve) => window.setTimeout(resolve, WAKE_GREETING_LEAD_MS))
      ]);
      const remainingGreetingLeadMs = WAKE_GREETING_LEAD_MS - (performance.now() - greetingLeadStartedAt);
      if (remainingGreetingLeadMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingGreetingLeadMs));
      }
      await speakReplyRef.current?.(WAKE_GREETING, {
        force: true,
        resumeMic: false,
        sequence: true,
        onPlaybackStart: (at) => { wakeMetricsRef.current.firstSpeechAt = at; },
        audioBlobPromise: greetingAudio
      });
      const readinessSnapshot = await readinessRequest;
      const report = `${buildSelfCheckReply(readinessSnapshot)}\n\n${await buildWakeSituation(api, readinessSnapshot)}`;
      const reportAudio = prepareSpeechBlob(report, { cache: true });
      setMessages((current) => [
        ...current,
        { id: `wake-check-${Date.now()}`, role: "jarvis", content: report, channel: "SYSTEM CHECK" }
      ]);
      await speakReplyRef.current?.(report, {
        force: true,
        resumeMic: false,
        sequence: true,
        audioBlobPromise: reportAudio
      });
    })().finally(() => {
      wakeMetricsRef.current.narrationCompletedAt = performance.now();
      voiceBlockedUntilRef.current = Date.now() + WAKE_LISTEN_DELAY_MS;
      interfaceModeRef.current = "active";
      setInterfaceMode("active");
      if (!ttsIsActiveRef.current) setVisualState("idle");
      setVoiceStatusText("系统检查完成，点击麦克风开始对话");
      window.clearTimeout(postWakeListenRef.current);
      postWakeListenRef.current = window.setTimeout(() => {
        wakeMetricsRef.current.monitorRequestedAt = performance.now();
        resumeMicAfterTTS();
      }, 120);
      if (wakeSequencePromiseRef.current === task) wakeSequencePromiseRef.current = null;
    });
    wakeSequencePromiseRef.current = task;
    return task;
  }, [apiFetch, musicEnabled, prepareSpeechBlob, readiness, resumeMicAfterTTS]);

  const enterWorkbench = useCallback(({ listenAfter = false } = {}) => {
    if (interfaceModeRef.current === "active" || interfaceModeRef.current === "waking") return;
    interfaceModeRef.current = "waking";
    wakeAcceptedRef.current = true;
    window.clearTimeout(wakeRestartRef.current);
    window.clearTimeout(workbenchEnterRef.current);
    setInterfaceMode("waking");
    setVisualState("listening");
    setVoiceStatusText("Wake up sequence");
    workbenchEnterRef.current = window.setTimeout(() => {
      interfaceModeRef.current = "active";
      setInterfaceMode("active");
      if (!ttsIsActiveRef.current) {
        setVisualState("idle");
        setVoiceStatusText(listenAfter ? "已唤醒，请说指令" : "点击麦克风开始");
      } else {
        setVoiceStatusText("Jarvis 正在播报");
      }
      if (listenAfter && !ttsIsActiveRef.current) {
        workbenchEnterRef.current = window.setTimeout(() => {
          if (interfaceModeRef.current === "active" && !window.jarvisVoice?.isActive?.()) startVoiceListening();
        }, 500);
      }
    }, WORKBENCH_ENTER_MS);
  }, [startVoiceListening]);

  const acceptWakePhrase = useCallback((text) => {
    if (interfaceModeRef.current === "active" || wakeAcceptedRef.current) return false;
    if (!isWakePhrase(text, { loose: true })) return false;
    wakeMetricsRef.current = { acceptedAt: performance.now() };
    wakeAcceptedRef.current = true;
    try { window.jarvisVoice?.enterPassiveMode?.(); } catch {}
    try { window.jarvisVoice?.ensureMonitor?.(); } catch {}
    setVoiceActive(false);
    setLastError("");
    setMessages((current) => [
      ...current,
      { id: `wake-${Date.now()}`, role: "system", content: "Wake phrase accepted. Jarvis online.", channel: "WAKE", timestamp: new Date().toISOString() }
    ]);
    enterWorkbench({ listenAfter: false });
    playWakeSequence().catch((error) => setLastError(error.message || "Wake sequence failed"));
    return true;
  }, [enterWorkbench, playWakeSequence]);

  useEffect(() => {
    window.__jarvisUiProbe = {
      getMode: () => interfaceModeRef.current,
      enterWorkbench: () => enterWorkbench({ listenAfter: false }),
      acceptWakeText: (text) => acceptWakePhrase(text),
      getWakeMetrics: () => ({ ...wakeMetricsRef.current }),
      showFirstRunFixture: () => { interfaceModeRef.current = "active"; setInterfaceMode("active"); setActivation({ activated: false }); },
      hideFirstRunFixture: () => setActivation({ activated: true, provider: "deepseek", model: "deepseek-v4-pro" }),
      showConversationFixture: () => setMessages(Array.from({ length: 45 }, (_, index) => ({
        id: `probe-message-${index}`,
        role: index % 2 ? "jarvis" : "user",
        content: index === 43 ? `这是一条用于验证长回复折叠的内容。${"对话需要保持清晰、可回看、可复制。".repeat(24)}` : `对话样本 ${index + 1}`,
        channel: index % 2 ? "LIVE PROBE" : "TUI",
        timestamp: new Date(Date.now() - (45 - index) * 1000).toISOString()
      })).concat({ id: "live", role: "jarvis", content: "正在生成回复", channel: "LIVE" })),
      appendConversationFixture: () => setMessages((current) => current.concat({ id: `probe-new-${Date.now()}`, role: "jarvis", content: "最新回复", channel: "LIVE" })),
      beginThinkingFixture: () => {
        turnStartedAtRef.current = Date.now() - 2100;
        setSending(true);
        setVisualState("thinking");
      },
      endThinkingFixture: () => {
        setSending(false);
        setVisualState("idle");
      }
    };
    return () => { delete window.__jarvisUiProbe; };
  }, [acceptWakePhrase, enterWorkbench]);

  const speakReply = useCallback(async (rawText, options = {}) => {
    const text = plainSpeechText(spokenReplyText(rawText));
    if (!text) return false;
    if (/[\u3400-\u9fff]/.test(text)) {
      setLastError("语音回复缺少英文播报稿，已停止朗读中文字符。");
      return false;
    }
    const now = Date.now();
    if (!options.force && lastSpokenTextRef.current === text && now - lastSpokenAtRef.current < SELF_ECHO_GUARD_MS) return false;
    rememberSpokenText(text);

    stopTTSPlayback();
    setAmbientMusicDucked(true);
    ttsIsActiveRef.current = true;
    voiceBlockedUntilRef.current = Date.now() + VOICE_POST_TTS_BLOCK_MS;
    setVisualState("speaking");
    try { window.jarvisVoice?.suspendForTTS?.(); } catch {}

    return await new Promise((resolve) => {
      let finished = false;
      const speechAbort = new AbortController();
      currentSpeechAbortRef.current = speechAbort;
      const playbackTimeout = window.setTimeout(() => {
        speechAbort.abort();
        try { currentAudioRef.current?.pause?.(); } catch {}
        finish(false);
      }, TTS_PLAYBACK_TIMEOUT_MS);
      const finish = (ok = false) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(playbackTimeout);
        if (currentSpeechFinishRef.current === finish) currentSpeechFinishRef.current = null;
        if (currentSpeechAbortRef.current === speechAbort) currentSpeechAbortRef.current = null;
        currentAudioRef.current = null;
        if (currentAudioUrlRef.current) try { URL.revokeObjectURL(currentAudioUrlRef.current); } catch {}
        currentAudioUrlRef.current = "";
        clearTTSAudioGraph();
        ttsIsActiveRef.current = false;
        ttsCurrentTextRef.current = "";
        currentSegmentRef.current = "";
        setVisualState("idle");
        setAmbientMusicDucked(false);
        if (!options.sequence) markVoiceReadyForNextTurn("tts");
        voiceBlockedUntilRef.current = Date.now() + VOICE_POST_TTS_BLOCK_MS;
        if (!options.sequence && options.resumeMic !== false) {
          try { window.jarvisVoice?.resumeAfterMedia?.(); } catch {}
          resumeMicAfterTTS();
          schedulePostReplyListen();
        }
        resolve(ok);
      };
      currentSpeechFinishRef.current = finish;

      (async () => {
        try {
          const blob = await (options.audioBlobPromise || prepareSpeechBlob(text, { signal: speechAbort.signal }));
          if (finished) return;
          if (!blob) throw new Error("TTS stream failed");
          const audioUrl = URL.createObjectURL(blob);
          const audio = new Audio(audioUrl);
          await resumeJarvisAudioContext();
          if (finished) {
            URL.revokeObjectURL(audioUrl);
            return;
          }
          const graph = attachJarvisAudioGraph(audio, JARVIS_TTS_VOICE_ID);
          currentAudioRef.current = audio;
          currentAudioUrlRef.current = audioUrl;
          ttsAudioGraphRef.current = graph;
          try { window.jarvisVoice?.setTTSAnalyser?.(graph?.analyser || null); } catch {}
          audio.onended = () => finish(true); audio.onerror = () => finish(false);
          await applyOutputSink(audio).catch(() => {});
          if (finished) return;
          await audio.play();
          options.onPlaybackStart?.(performance.now());
        } catch (error) {
          if (finished) return;
          console.error("Jarvis TTS playback failed", error);
          setLastError("贾维斯语音播放失败，请检查本地 Piper 模型。");
          finish(false);
        }
      })();
    });
  }, [clearTTSAudioGraph, markVoiceReadyForNextTurn, prepareSpeechBlob, rememberSpokenText, resumeMicAfterTTS, schedulePostReplyListen, stopTTSPlayback]);
  speakReplyRef.current = speakReply;

  const clearReplyPoll = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
    pollInFlightRef.current = false;
  }, []);

  const completeReply = useCallback((text, options = {}) => {
    const turn = activeTurnRef.current;
    if (!turn || turn.completed) {
      reloadAfterEvent();
      return false;
    }
    if (options.turnToken && turn.token !== options.turnToken) return false;
    turn.completed = true;
    activeTurnRef.current = null;
    submitLockRef.current = false;
    clearReplyPoll();
    setSending(false);
    setVisualState("idle");
    reloadAfterEvent();
    if ((options.voice ?? turn.voice ?? lastVoiceTurnRef.current) && text) {
      speakReply(text).catch(() => {});
      lastVoiceTurnRef.current = false;
    }
    return true;
  }, [clearReplyPoll, reloadAfterEvent, speakReply]);

  const failActiveTurn = useCallback((message, turnToken = null, { restoreDraft = true } = {}) => {
    const turn = activeTurnRef.current;
    if (turnToken && turn?.token !== turnToken) return false;
    activeTurnRef.current = null;
    submitLockRef.current = false;
    lastVoiceTurnRef.current = false;
    visibleStreamRef.current = false;
    clearReplyPoll();
    setSending(false);
    setVisualState("alert");
    setLastError(message || "运行时错误");
    if (restoreDraft && turn?.content) {
      setDraft(turn.content);
      setTextInputOpen(true);
    }
    if (turn?.voice) schedulePostReplyListen();
    return true;
  }, [clearReplyPoll, schedulePostReplyListen]);

  const cancelActiveTurn = useCallback(async () => {
    const turn = activeTurnRef.current;
    if (!turn) return false;
    activeTurnRef.current = null;
    submitLockRef.current = false;
    visibleStreamRef.current = false;
    clearReplyPoll();
    setMessages((current) => current.filter((item) => item.id !== "live"));
    setSending(false);
    setVisualState("idle");
    setDraft(turn.content || "");
    setTextInputOpen(true);
    setVoiceStatusText("本轮已停止，输入已保留");
    setLastError("");
    try {
      await apiFetch("/conversation/cancel", {
        method: "POST",
        body: JSON.stringify({ turn_id: turn.token })
      });
    } catch (error) {
      setLastError(`界面已停止，但核心取消未确认：${error.message || "连接失败"}`);
    }
    window.requestAnimationFrame(() => inputRef.current?.focus());
    return true;
  }, [apiFetch, clearReplyPoll]);

  const pollForReply = useCallback((afterId, voice, turnToken) => {
    clearReplyPoll();
    const startedAt = Date.now();
    pollRef.current = window.setInterval(async () => {
      if (activeTurnRef.current?.token !== turnToken) {
        clearReplyPoll();
        return;
      }
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const rows = await loadConversations({ commit: false });
        const reply = rows.find((row) => row.role === "jarvis" && Number(row.id) > afterId);
        if (reply) {
          setMessages(rows);
          completeReply(reply.content, { voice, turnToken });
          return;
        }
        if (Date.now() - startedAt > 95_000) {
          failActiveTurn("这轮对话超过 95 秒没有返回，原输入已保留，可直接重试。", turnToken);
        }
      } catch {
        // transient startup or reload failures should not stop polling
      } finally {
        pollInFlightRef.current = false;
      }
    }, 1000);
  }, [clearReplyPoll, completeReply, failActiveTurn, loadConversations]);

  const sendMessage = useCallback(async (payload = null) => {
    const fromVoice = typeof payload === "object" && payload ? isVoiceChannel(payload.channel || payload.label) : false;
    const text = typeof payload === "object" && payload ? payload.text : draft;
    const content = String(text || "").trim();
    if (!content || sending || submitLockRef.current || activeTurnRef.current) return;
    voiceRepairCountRef.current = 0;
    setVoiceRecovery(null);
    window.clearTimeout(postReplyListenRef.current);
    postReplyListenRef.current = null;

    if (/(关闭|停止|关掉|静音).{0,4}(音乐|背景音乐)|\b(?:stop|mute|turn off)\s+(?:the\s+)?music\b/i.test(content)) {
      await toggleAmbientMusic(false);
      setMessages((current) => [...current, { id: `music-${Date.now()}`, role: "system", content: "背景音乐已关闭。", channel: "LOCAL" }]);
      if (fromVoice) try { window.jarvisVoice?.stop?.(); } catch {}
      return;
    }
    if (/(打开|开启|播放).{0,4}(音乐|背景音乐)|\b(?:start|play|turn on)\s+(?:the\s+)?music\b/i.test(content)) {
      const started = await toggleAmbientMusic(true);
      setMessages((current) => [...current, { id: `music-${Date.now()}`, role: "system", content: started ? "背景音乐已开启。" : "背景音乐等待首次交互后开启。", channel: "LOCAL" }]);
      return;
    }

    if (interfaceModeRef.current !== "active") {
      if (fromVoice && acceptWakePhrase(content)) return;
      if (fromVoice) {
        setVisualState("idle");
        setVoiceStatusText("未听到唤醒词，请说“嗨 Jarvis”");
        scheduleWakeListen();
        return;
      }
      enterWorkbench({ listenAfter: false });
    }

    if (fromVoice) {
      const normalized = normalizeEchoText(content);
      const now = Date.now();
      if (now < voiceBlockedUntilRef.current || isAsrEchoNoise(content)) { try { window.jarvisVoice?.enterPassiveMode?.(); } catch {}; setVoiceActive(false); setVisualState("idle"); setVoiceStatusText("已忽略语音回声或噪声，点击麦克风继续"); schedulePostReplyListen(); return; }
      if (isLikelySelfEcho(content)) {
        try { window.jarvisVoice?.enterPassiveMode?.(); } catch {}; setVoiceActive(false); setVisualState("idle");
        setVoiceStatusText("已忽略回声，点击麦克风继续");
        schedulePostReplyListen();
        return;
      }
      const lastVoiceSend = lastVoiceSendTextRef.current;
      if (normalized && lastVoiceSend.text === normalized && now - lastVoiceSend.at < VOICE_REPEAT_GUARD_MS) {
        try { window.jarvisVoice?.enterPassiveMode?.(); } catch {}; setVoiceActive(false); setVisualState("idle"); setVoiceStatusText("已忽略重复语音，点击麦克风继续"); schedulePostReplyListen();
        return;
      }
      lastVoiceSendTextRef.current = { text: normalized, at: now };
    }

    const workPrompt = inferredEngineeringPrompt(content);
    if (workPrompt) {
      setDraft("");
      setLastError("");
      setVisualState("thinking");
      setMessages((current) => [...current, {
        id: `engineering-${Date.now()}`,
        role: "user",
        content,
        channel: fromVoice ? "语音 / 工程台" : "工程台",
        timestamp: new Date().toISOString()
      }]);
      try {
        await startEngineeringTask(workPrompt);
        setMessages((current) => [...current, {
          id: `engineering-accepted-${Date.now()}`,
          role: "system",
          content: "工程任务已交给 Grok Build，执行模型为 DeepSeek V4 Pro。",
          channel: "GROK BUILD"
        }]);
        setVisualState("idle");
        if (fromVoice) {
          await speakReplyRef.current?.("Engineering task accepted.\n\n[中文翻译]\n工程任务已接收。");
          schedulePostReplyListen();
        }
      } catch (error) {
        setVisualState("alert");
        setLastError(error.message || "工程任务提交失败");
        if (fromVoice) schedulePostReplyListen();
      }
      return;
    }

    const channel = fromVoice ? "语音识别" : "TUI";
    const afterId = maxMessageIdRef.current;
    const turnToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    submitLockRef.current = true;
    activeTurnRef.current = { token: turnToken, afterId, voice: fromVoice, content, completed: false };
    visibleStreamRef.current = false;
    lastVoiceTurnRef.current = fromVoice;
    turnStartedAtRef.current = Date.now();
    setTurnElapsedSeconds(0);
    setDraft("");
    setTextInputExpanded(false);
    setSending(true);
    setLastError("");
    setVisualState(fromVoice ? "listening" : "thinking");
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content,
        channel,
        timestamp: new Date().toISOString()
      }
    ]);

    try {
      const sent = await apiFetch("/message", { method: "POST", body: JSON.stringify({ from_id: USER_ID, channel, content, turn_id: turnToken }) });
      if (sent?.ignored) {
        activeTurnRef.current = null;
        submitLockRef.current = false;
        lastVoiceTurnRef.current = false;
        clearReplyPoll();
        setSending(false);
        setVisualState("idle");
        setVoiceStatusText("已忽略重复语音，点击麦克风继续");
        if (fromVoice) schedulePostReplyListen();
        refreshAll().catch(() => {});
        return;
      }
      setVisualState("thinking");
      pollForReply(afterId, fromVoice, turnToken);
    } catch (error) {
      failActiveTurn(`${error.message || "发送失败"}。原输入已保留，可直接重试。`, turnToken);
      setMessages((current) => [
        ...current,
        { id: `error-${Date.now()}`, role: "system", content: error.message || "发送失败", channel: "SYSTEM" }
      ]);
      refreshAll().catch(() => {});
    }
  }, [acceptWakePhrase, apiFetch, clearReplyPoll, draft, enterWorkbench, failActiveTurn, inferredEngineeringPrompt, isLikelySelfEcho, pollForReply, refreshAll, schedulePostReplyListen, scheduleWakeListen, sending, startEngineeringTask, toggleAmbientMusic]);

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    if (!sending || !turnStartedAtRef.current) return undefined;
    const update = () => setTurnElapsedSeconds(Math.max(0, Math.floor((Date.now() - turnStartedAtRef.current) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [sending]);

  const handleCoreEvent = useCallback((payload) => {
    const type = payload?.type;
    const data = payload?.data || {};
    if (type === "connected") {
      setConnection({ state: "online", detail: "核心在线" });
    } else if (type === "message_in") {
      setVisualState(isVoiceChannel(data.channel) ? "listening" : "thinking");
      reloadAfterEvent();
    } else if (type === "stream_start") {
      visibleStreamRef.current = !!data.plainReply;
      if (activeTurnRef.current || data.plainReply) {
        setSending(true);
        setVisualState("thinking");
      }
      if (data.plainReply) {
        setMessages((current) => [
          ...current.filter((item) => item.id !== "live"),
          { id: "live", role: "jarvis", content: "", channel: "LIVE" }
        ]);
      }
    } else if (type === "stream_chunk") {
      if (!visibleStreamRef.current) return;
      setVisualState("thinking");
      setMessages((current) => {
        const chunk = cleanStreamChunk(data.text || "");
        const existing = current.find((item) => item.id === "live");
        if (!existing) return [...current, { id: "live", role: "jarvis", content: chunk, channel: "LIVE" }];
        return current.map((item) => item.id === "live" ? { ...item, content: `${item.content || ""}${chunk}` } : item);
      });
    } else if (type === "stream_end") {
      visibleStreamRef.current = false;
      reloadAfterEvent();
    } else if (type === "tool_call") {
      reloadAfterEvent();
    } else if (type === "grok_build_task") {
      setGrokBuildStatus((current) => ({ ...(current || {}), ok: true, available: true, task: data }));
    } else if (type === "response") {
      completeReply(data.content || "");
    } else if (type === "protocol_violation" && /fallback_delivered/.test(String(data.reason || ""))) {
      reloadAfterEvent();
    } else if (type === "error" || type === "protocol_violation") {
      failActiveTurn(data.error || data.reason || "运行时错误");
      reloadAfterEvent();
    } else if (type === "activated" || type === "startup_environment_ready" || type === "idle" || type === "quota") {
      refreshAll().catch(() => {});
    }
  }, [completeReply, failActiveTurn, refreshAll, reloadAfterEvent]);

  const connectEvents = useCallback(() => {
    eventSourceRef.current?.close?.();
    const source = new EventSource(`${api}/events`);
    eventSourceRef.current = source;

    source.onopen = () => {
      setConnection({ state: "online", detail: "事件流在线" });
      refreshAll().catch(() => {});
    };
    source.onerror = () => setConnection({ state: "degraded", detail: "事件流重连中" });
    source.onmessage = (event) => {
      let payload = null;
      try { payload = JSON.parse(event.data || "{}"); } catch { return; }
      handleCoreEvent(payload);
    };
  }, [api, handleCoreEvent, refreshAll]);

  useEffect(() => {
    const handleOnline = () => {
      setConnection({ state: "connecting", detail: "网络已恢复，正在同步" });
      connectEvents();
      refreshAll().catch(() => {});
    };
    const handleOffline = () => setConnection({ state: "offline", detail: "设备当前离线" });
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshAll().catch(() => {});
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [connectEvents, refreshAll]);

  useEffect(() => {
    let disposed = false;
    const install = async () => {
      let mode = "";
      try { mode = await window.jarvisDesktop?.getProbeMode?.() || ""; } catch {}
      if (disposed || mode !== "turn-lifecycle") return;
      window.__jarvisTurnProbe = {
      begin: ({ voice = false, withPoll = false } = {}) => {
        const token = `probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        activeTurnRef.current = { token, afterId: maxMessageIdRef.current, voice, content: "保留这条测试指令", completed: false };
        clearReplyPoll();
        if (withPoll) pollRef.current = window.setInterval(() => {}, 60_000);
        visibleStreamRef.current = false;
        lastVoiceTurnRef.current = voice;
        setLastError("");
        setSending(true);
        setVisualState("thinking");
        return token;
      },
      emit: (type, data = {}) => handleCoreEvent({ type, data }),
      cancel: () => cancelActiveTurn(),
      speakAndResume: async () => {
        try { window.jarvisVoice?.stop?.(); } catch {}
        await speakReply(WAKE_GREETING, { force: true });
        return true;
      },
      snapshot: () => ({
        activeTurn: activeTurnRef.current ? { ...activeTurnRef.current } : null,
        pollActive: !!pollRef.current,
        visibleStream: visibleStreamRef.current,
        sending,
        draft,
        lastError,
        voiceActive: !!window.jarvisVoice?.isActive?.(),
        voiceStatusText,
        postReplyListenMetrics: { ...postReplyListenMetricsRef.current },
        messages: messages.map((item) => ({ id: item.id, role: item.role, content: item.content, channel: item.channel })),
        bodyText: document.body.innerText || ""
      })
      };
    };
    install();
    return () => {
      disposed = true;
      delete window.__jarvisTurnProbe;
    };
  }, [cancelActiveTurn, clearReplyPoll, draft, handleCoreEvent, lastError, messages, sending, speakReply, voiceStatusText]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (window.jarvisDesktop?.getBackendPort) {
          const port = await window.jarvisDesktop.getBackendPort();
          if (!cancelled && port) setApi(`http://127.0.0.1:${port}`);
        } else if (!cancelled) {
          setApi(DEFAULT_API);
        }
      } catch {
        if (!cancelled) setApi(DEFAULT_API);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!api) return;
    refreshAll()
      .then(() => loadConversations())
      .catch((error) => {
        setConnection({ state: "degraded", detail: error.message || "核心服务未响应" });
        setLastError(error.message || "核心服务未响应");
      });
    connectEvents();
    return () => {
      eventSourceRef.current?.close?.();
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [connectEvents, loadConversations, refreshAll]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    let disposed = false;
    const install = async () => {
      let probeMode = "";
      let version = "";
      try { probeMode = await window.jarvisDesktop?.getProbeMode?.() || ""; } catch {}
      try { version = await window.jarvisDesktop?.getVersion?.() || ""; } catch {}
      const allowed = probeMode || version === "screenshot" || /\bvisual-probe\b/i.test(window.location.search || "");
      if (disposed || !allowed) return;
      window.__jarvisVisualProbe = {
        required: ["idle", "listening", "thinking", "speaking", "alert"],
        setState: (nextState = "idle", level) => {
          const next = ["idle", "listening", "thinking", "speaking", "alert"].includes(nextState) ? nextState : "idle";
          const defaultLevel = next === "speaking" ? 0.88 : next === "listening" ? 0.62 : next === "thinking" ? 0.34 : 0.08;
          setInterfaceMode("active");
          setEngineeringOpen(false);
          setSending(next === "thinking" || next === "speaking");
          setVisualState(next);
          setAudioLevel(Math.min(1, Math.max(0, Number(level ?? defaultLevel) || 0)));
          setVoiceStatusText(`VISUAL PROBE / ${next.toUpperCase()}`);
        },
        setAudioLevel: (level = 0) => setAudioLevel(Math.min(1, Math.max(0, Number(level) || 0))),
      };
    };
    install();
    return () => {
      disposed = true;
      delete window.__jarvisVisualProbe;
    };
  }, []);

  useEffect(() => {
    if (!api || voiceInitializedRef.current) return undefined;
    voiceInitializedRef.current = true;
    const timer = window.setTimeout(() => {
      initVoicePanel({
        btnId: "voice-toggle",
        panelId: "voice-panel",
        canvasId: "voice-canvas",
        statusId: "voice-status",
        transcriptId: "voice-transcript",
        getChatInput: () => inputRef.current,
        getSendBtn: () => null,
        getSendMessage: (payload) => sendMessageRef.current?.(payload),
        getLang: () => "zh-CN",
        getAutoSend: () => true,
        getAutoMic: () => true,
        getSingleTurn: () => true
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [api]);

  useEffect(() => {
    const onVoiceState = (event) => {
      const active = !!event.detail?.active;
      setVoiceActive(active);
      setVoiceStatusText(event.detail?.statusText || (active ? "正在聆听" : "点按语音开始"));
      if (active && wakeMetricsRef.current.listenRequestedAt && !wakeMetricsRef.current.listeningAt) {
        wakeMetricsRef.current.listeningAt = performance.now();
      }
      if (active) setLastError("");
      if (active && !sending) setVisualState("listening");
      if (!active && !sending) {
        setVisualState("idle");
        if (interfaceModeRef.current === "standby" && !wakeAcceptedRef.current) scheduleWakeListen();
      }
    };
    window.addEventListener("jarvis:voice-state", onVoiceState);
    return () => window.removeEventListener("jarvis:voice-state", onVoiceState);
  }, [scheduleWakeListen, sending]);

  useEffect(() => {
    const onVoiceTranscript = (event) => {
      const text = String(event.detail?.text || event.detail?.accumulated || "").trim();
      if (text) {
        voiceRepairCountRef.current = 0;
        setVoiceRecovery(null);
      }
      if (interfaceModeRef.current !== "standby" || wakeAcceptedRef.current) return;
      if (text) {
        try {
          const recent = JSON.parse(localStorage.getItem("jarvis-wake-diagnostics") || "[]");
          recent.unshift({ at: new Date().toISOString(), text, final: !!event.detail?.final, matched: isWakePhrase(text, { loose: true }) });
          localStorage.setItem("jarvis-wake-diagnostics", JSON.stringify(recent.slice(0, 30)));
        } catch {}
      }
      if (!text || !isWakePhrase(text, { loose: true })) return;
      try { window.jarvisVoice?.resetTranscriptAccumulation?.(); } catch {}
      try { window.jarvisVoice?.enterPassiveMode?.(); } catch {}
      acceptWakePhrase(text);
    };
    window.addEventListener("jarvis:voice-transcript", onVoiceTranscript);
    return () => window.removeEventListener("jarvis:voice-transcript", onVoiceTranscript);
  }, [acceptWakePhrase]);

  useEffect(() => {
    const onVoiceError = (event) => {
      const diagnostics = event.detail?.diagnostics || {};
      const captureFailed = !diagnostics.chunks || !diagnostics.bytes;
      const permissionFailed = /permission|notallowed|denied|权限/i.test(String(diagnostics.lastError || event.detail?.message || ""));
      const deviceFailure = captureFailed || permissionFailed;
      voiceRepairCountRef.current += 1;
      const shouldOfferText = deviceFailure || voiceRepairCountRef.current >= 2;
      const message = deviceFailure
        ? (event.detail?.message || "没有采集到麦克风音频，已展开键盘输入。")
        : shouldOfferText
          ? "连续两次没有听清，已为您展开键盘输入。"
          : "刚才没有听清，请靠近麦克风再说一次。";
      const diagnosticDetail = [
        diagnostics.micLabel ? `设备：${diagnostics.micLabel}` : "",
        Number.isFinite(diagnostics.peakVol) ? `峰值：${Number(diagnostics.peakVol).toFixed(3)}` : "",
        diagnostics.lastCloudEvent ? `ASR：${diagnostics.lastCloudEvent}` : ""
      ].filter(Boolean).join(" · ");
      setVoiceRecovery({ kind: deviceFailure ? "device" : "retry", detail: diagnosticDetail, attempts: voiceRepairCountRef.current });
      if (shouldOfferText) {
        openTextInput();
      }
      setLastError(message);
      setVisualState("alert");
      if (interfaceModeRef.current === "standby") scheduleWakeListen();
    };
    window.addEventListener("jarvis:voice-error", onVoiceError);
    return () => window.removeEventListener("jarvis:voice-error", onVoiceError);
  }, [openTextInput, scheduleWakeListen]);

  useEffect(() => {
    window.stopTTS = () => { stopTTSPlayback(); resumeMicAfterTTS(); };
    window.duckTTS = () => { if (currentAudioRef.current) currentAudioRef.current.volume = 0.18; };
    window.unduckTTS = () => { if (currentAudioRef.current) currentAudioRef.current.volume = 1; };
    window.resumeTTSIfNoSpeech = window.unduckTTS;
    return () => {
      delete window.stopTTS;
      delete window.duckTTS;
      delete window.unduckTTS;
      delete window.resumeTTSIfNoSpeech;
    };
  }, [resumeMicAfterTTS, stopTTSPlayback]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const active = document.activeElement;
      const interactive = isEditableOrInteractiveTarget(active);
      if (event.isComposing || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "/" && !interactive && interfaceModeRef.current === "active") {
        event.preventDefault();
        openTextInput();
        return;
      }
      if (event.key === "Escape" && activeTurnRef.current) {
        event.preventDefault();
        cancelActiveTurn();
        return;
      }
      if (event.key === "Escape" && textInputOpen && !draft.trim()) {
        event.preventDefault();
        setTextInputOpen(false);
        inputRef.current?.blur();
        return;
      }
      if (event.code !== "Space") return;
      if (interactive || event.repeat || pttHeldRef.current) return;
      event.preventDefault();
      pttHeldRef.current = true;
      window.jarvisVoice?.pttStart?.();
    };
    const onKeyUp = (event) => {
      if (event.code !== "Space" || !pttHeldRef.current) return;
      event.preventDefault();
      pttHeldRef.current = false;
      window.jarvisVoice?.pttEnd?.();
    };
    const releasePtt = () => {
      if (!pttHeldRef.current) return;
      pttHeldRef.current = false;
      window.jarvisVoice?.pttEnd?.();
    };
    const onVisibility = () => { if (document.visibilityState !== "visible") releasePtt(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releasePtt);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releasePtt);
      document.removeEventListener("visibilitychange", onVisibility);
      releasePtt();
    };
  }, [cancelActiveTurn, draft, openTextInput, textInputOpen]);

  const latestJarvisText = useMemo(() => {
    return [...messages].reverse().find((item) => item.role === "jarvis")?.content || "";
  }, [messages]);

  const turnState = useMemo(() => {
    if (sending || visualState === "thinking") {
      const label = turnElapsedSeconds < 5
        ? "正在理解指令"
        : turnElapsedSeconds < 15
          ? "正在思考"
          : turnElapsedSeconds < 40
            ? "正在处理任务"
            : turnElapsedSeconds < 70
              ? "复杂任务仍在执行"
              : "正在等待核心完成";
      return { label, tone: "thinking", elapsed: turnElapsedSeconds };
    }
    if (visualState === "speaking") return { label: "贾维斯正在说", tone: "speaking" };
    if (voiceActive || visualState === "listening") return { label: "请说，我在听", tone: "listening" };
    return { label: "语音待命", tone: "ready" };
  }, [sending, turnElapsedSeconds, visualState, voiceActive]);

  const dockEnergy = amplifyAudioLevel(audioLevel);
  const dockBars = Array.from({ length: 18 }, (_, index) => {
    const variation = 0.5 + ((index * 23) % 41) / 100 + ((Math.sin(index * 1.16 + dockEnergy * 5.4) + 1) * 0.28);
    const bar = voiceActive
      ? Math.min(100, Math.max(12, Math.round(16 + dockEnergy * 132 * variation)))
      : 18 + ((index * 17) % 34);
    return (
      <i
        key={index}
        style={{
          "--bar": `${bar}%`,
          "--delay": `${-index * 32}ms`,
          "--alpha": (voiceActive ? 0.48 + dockEnergy * 0.52 : 0.28).toFixed(3)
        }}
      />
    );
  });

  const caps = readiness?.capabilities || {};
  const needsFirstRunSetup = interfaceMode !== "standby" && activation !== null && !activation?.activated;
  const activationPending = activation === null;
  const readinessPending = readiness === null;
  const coreReady = !!(status?.running && activation?.activated);
  const coreDetail = activationPending ? "同步中" : (activation?.model || "未激活");
  const voiceDetail = readinessPending ? "同步中" : (caps.asr?.provider || "未配置");
  const deepSeekValue = activationPending ? "同步中" : (activation?.activated ? "在线" : "待配置");
  const deepSeekDetail = activationPending ? "等待核心状态" : (activation?.model || activation?.provider || "未激活");
  const asrValue = readinessPending ? "同步中" : (caps.asr?.ready ? "可用" : "缺失");
  const asrDetail = readinessPending ? "等待语音状态" : (caps.asr?.provider || "未配置");
  const ttsValue = readinessPending ? "同步中" : (caps.tts?.ready ? "可用" : "缺失");
  const ttsDetail = readinessPending ? "等待语音状态" : (caps.tts?.provider || "Jarvis");
  const queueUser = status?.queue?.user ?? 0;
  const queueBackground = status?.queue?.background ?? 0;

  return (
    <main className={cls("app-shell", `mode-${interfaceMode}`)}>
      <header className="studio-header">
        <div className="header-brand">
          <div className="brand-title">
            <span>LOCAL AGENT CONTROL ROOM</span>
            <h1>JARVIS</h1>
          </div>
          <ClockReadout variant="header" />
        </div>
        <div className="header-status">
          <StatusPill ok={connection.state === "online"} label="链路" detail={connection.detail} compact />
          <StatusPill ok={coreReady} label="核心" detail={coreDetail} compact />
          <StatusPill ok={!!caps.asr?.ready} label="语音" detail={voiceDetail} compact />
        </div>
        <div className="header-tools">
          <div className="module-strip" aria-label="工作入口">
            {LINKS.filter((item) => ["settings", "engineering"].includes(item.action) || item.label === "记忆库").map((item) => <ModuleLink
              key={item.path || item.action}
              item={item}
              api={api}
              active={item.action === "engineering" && engineeringOpen}
              onSettings={() => setDrawerOpen(true)}
              onEngineering={() => setEngineeringOpen((current) => !current)}
            />)}
          </div>
          <div className="header-actions">
          <button className={cls("icon-btn", musicEnabled && "active")} type="button" onClick={() => toggleAmbientMusic()} aria-pressed={musicEnabled} aria-label={musicEnabled ? "关闭背景音乐" : "开启背景音乐"} title={musicEnabled ? "关闭背景音乐" : "开启背景音乐"}>
            {musicEnabled ? <Music2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button className="icon-btn" type="button" disabled={refreshing} aria-busy={refreshing} onClick={() => refreshAll().then(loadConversations).catch(() => {})} aria-label="刷新状态">
            <RefreshCw className={cls(refreshing && "spin")} size={18} />
          </button>
          <button className="icon-btn" type="button" onClick={() => setDrawerOpen(true)} aria-label="打开设置">
            <Settings2 size={18} />
          </button>
          </div>
        </div>
      </header>

      <section className={cls("monitor-stage", `stage-${visualState}`, `mode-${interfaceMode}`, engineeringOpen && "engineering-open")} aria-label="Jarvis 工作界面">
        <div className="stage-grid-layer" />
        <div className="stage-corners" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="stage-topline">
          <span>{interfaceMode === "standby" ? "STANDBY" : "LOCAL ONLINE"}</span>
          <i />
          <span>{interfaceMode === "waking" ? "WAKE UP" : "DIRECT VOICE"}</span>
          <i />
          <span>{voiceActive ? "LISTENING" : interfaceMode === "active" ? "ONLINE" : "SLEEP"}</span>
        </div>

        <StandbyLayer />
        <button
          className="standby-entry"
          type="button"
          onClick={() => enterWorkbench({ listenAfter: false })}
          aria-label="进入工作台"
          title="进入工作台"
        >
          <ArrowRight size={22} aria-hidden="true" />
        </button>

        {needsFirstRunSetup ? <FirstRunSetup api={api} onComplete={refreshAll} /> : null}

        <HudTerminal
          messages={messages}
          sending={sending}
          lastError={lastError}
          turnState={turnState}
          voiceRecovery={voiceRecovery}
          onRetryVoice={retryVoice}
          onUseKeyboard={openTextInput}
          onDismissError={dismissVoiceError}
          onReplayMessage={(content) => speakReply(content)}
        />

        <JarvisWorkbench
          visualState={visualState}
          interfaceMode={interfaceMode}
          readiness={readiness}
          status={status}
          activation={activation}
          connection={connection}
          grokReady={!!grokBuildStatus?.available}
          audioLevel={audioLevel}
        />

        <AnimatePresence>
          <EngineeringConsole
            status={grokBuildStatus}
            open={engineeringOpen}
            onClose={() => setEngineeringOpen(false)}
            onRun={startEngineeringTask}
            onCancel={cancelEngineeringTask}
            onPermission={answerEngineeringPermission}
          />
        </AnimatePresence>

        <AgentPortrait
          state={visualState}
          voiceStatusText={voiceStatusText}
          sending={sending}
          mode={interfaceMode}
          audioLevel={audioLevel}
        />

        <AcuiWorkbenchLayer cards={acuiCards} connected={acuiConnected} onDismiss={dismissAcuiCard} />

        <IntelligenceRail
          api={api}
          grokStatus={grokBuildStatus}
          onEngineering={() => setEngineeringOpen(true)}
          signals={[
            { label: "核心引擎", code: "CORE ENGINE", value: deepSeekValue, detail: deepSeekDetail, tone: activation?.activated ? "ok" : "warn", icon: Cpu },
            { label: "语音识别", code: "ASR", value: asrValue, detail: asrDetail, tone: caps.asr?.ready ? "ok" : "warn", icon: Mic },
            { label: "语音合成", code: "TTS", value: ttsValue, detail: ttsDetail, tone: caps.tts?.ready ? "ok" : "warn", icon: Radio },
            { label: "记忆系统", code: "MEMORY", value: `${status?.memory_count ?? caps.memory?.count ?? "--"}`, detail: "同步状态", tone: caps.memory?.ready ? "ok" : "neutral", icon: Database },
          ]}
        />

        <form
          className={cls("command-dock", textInputOpen && "text-open", textInputExpanded && "multiline", sending && "turn-active")}
          aria-label="Jarvis 指令输入"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage();
          }}
        >
          <button
            id="voice-toggle"
            className={cls("voice-command", voiceActive && "active")}
            type="button"
            aria-pressed={voiceActive}
            aria-label={voiceActive ? "结束语音监听" : "开始语音监听"}
            title="点按开始或结束语音，也可以按住空格说话"
          >
            {voiceActive ? <MicOff size={18} /> : <Mic size={18} />}
            <span className="sr-only">{voiceActive ? "结束语音" : "语音"}</span>
          </button>
          <div className={cls("dock-wave", voiceActive && "active")} style={{ "--signal-energy": dockEnergy.toFixed(3), "--signal-glow": `${(5 + dockEnergy * 11).toFixed(1)}px` }} aria-hidden="true">{dockBars}</div>
          <button
            className={cls("secondary", "keyboard-command", textInputOpen && "active")}
            type="button"
            aria-label={textInputOpen ? "收起键盘输入" : "展开键盘输入"}
            title={textInputOpen ? "收起键盘输入" : "键盘输入"}
            aria-expanded={textInputOpen}
            onClick={() => setTextInputOpen((current) => !current)}
          >
            <Keyboard size={18} />
          </button>
          <div className="dock-input">
            <Activity size={16} />
            <textarea
              ref={inputRef}
              aria-label="给 Jarvis 的指令"
              aria-describedby="turn-status composer-hint composer-count"
              aria-invalid={draft.length >= MAX_DRAFT_CHARS ? "true" : undefined}
              value={draft}
              maxLength={MAX_DRAFT_CHARS}
              onChange={(event) => {
                setDraft(event.target.value);
                event.currentTarget.style.height = "auto";
                const nextHeight = Math.min(76, event.currentTarget.scrollHeight);
                event.currentTarget.style.height = `${nextHeight}px`;
                setTextInputExpanded(nextHeight > 54);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              placeholder="输入要 Jarvis 做的事"
              rows={1}
            />
            <span id="composer-hint" className="sr-only">按 Enter 发送，Shift 加 Enter 换行</span>
            <span id="composer-count" className={cls("composer-count", draft.length >= DRAFT_WARNING_CHARS && "visible")} aria-live="polite">
              {draft.length}/{MAX_DRAFT_CHARS}
            </span>
          </div>
          <button className={cls("primary send", sending && "cancel")} type={sending ? "button" : "submit"} disabled={!sending && !draft.trim()} aria-label={sending ? "停止生成" : "发送指令"} title={sending ? "停止生成 (Esc)" : "发送指令"} onClick={sending ? () => cancelActiveTurn() : undefined}>
            {sending ? <Square size={16} fill="currentColor" /> : <Send size={17} />}
            <span className="sr-only">{sending ? "停止" : "发送"}</span>
          </button>
          <button className="secondary replay" type="button" disabled={visualState !== "speaking" && (!latestJarvisText || sending)} aria-label={visualState === "speaking" ? "停止语音播报" : "重播上一条 Jarvis 回复"} title={visualState === "speaking" ? "停止播报" : "重播上一条回复"} onClick={visualState === "speaking" ? stopTTSPlayback : () => speakReply(latestJarvisText)}>
            {visualState === "speaking" ? <Square size={15} fill="currentColor" /> : <Volume2 size={17} />}
            <span className="sr-only">{visualState === "speaking" ? "停止播报" : "重播"}</span>
          </button>
          <button className={cls("secondary", "music-command", musicEnabled && "active")} type="button" onClick={() => toggleAmbientMusic()} aria-pressed={musicEnabled} aria-label={musicEnabled ? "关闭背景音乐" : "开启背景音乐"} title={musicEnabled ? "关闭背景音乐" : "开启背景音乐"}>
            {musicEnabled ? <Music2 size={17} /> : <VolumeX size={17} />}
            <span className="sr-only">音乐</span>
          </button>
        </form>
        <div ref={messagesEndRef} className="scroll-anchor" />
      </section>

      <footer className="system-footer">
        <span><Zap size={13} /> GDDXX-Jarvis{appVersion ? ` v${appVersion}` : ""} / 本地桌面 Agent</span>
        <span>{voiceStatusText}</span>
      </footer>

      <SettingsDrawer
        open={drawerOpen}
        onClose={closeSettings}
        activation={activation}
        readiness={readiness}
        api={api}
        refreshAll={refreshAll}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
