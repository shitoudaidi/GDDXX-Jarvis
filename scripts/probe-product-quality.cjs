const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.JARVIS_PORT || 3721);

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function requestJson(route, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: "127.0.0.1",
      port,
      path: route,
      timeout: timeoutMs,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body || "{}"));
        } catch (error) {
          reject(new Error(`${route} returned invalid JSON: ${error.message}`));
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`${route} timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
  });
}

function readShortcutSummary() {
  const linkPath = path.join(os.homedir(), "Desktop", "Jarvis.lnk");
  const expectedTarget = path.join(root, "dist", "win-unpacked", "Jarvis.exe");
  if (!fs.existsSync(linkPath)) return { ok: false, error: "desktop shortcut missing", linkPath };
  if (!fs.existsSync(expectedTarget)) return { ok: false, error: "packaged exe missing", expectedTarget };

  const command = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($env:JARVIS_SHORTCUT_PATH)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::WriteLine((@{
  target = $shortcut.TargetPath
  workingDirectory = $shortcut.WorkingDirectory
} | ConvertTo-Json -Compress))
`;
  const result = childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ], {
    cwd: root,
    env: { ...process.env, JARVIS_SHORTCUT_PATH: linkPath },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return { ok: false, error: (result.stderr || result.stdout || "").trim() };
  const shortcut = JSON.parse(result.stdout.trim());
  return {
    ok: path.resolve(shortcut.target || "") === path.resolve(expectedTarget),
    linkPath,
    target: shortcut.target || "",
    workingDirectory: shortcut.workingDirectory || "",
    expectedTarget,
  };
}

function staticSourceChecks() {
  const indexSource = readText(path.join(root, "src", "core", "index.js"));
  const mainSource = readText(path.join(root, "src", "ui", "jarvis-react", "src", "main.jsx"));
  const stylesSource = readText(path.join(root, "src", "ui", "jarvis-react", "src", "styles.css"));
  const voiceContinuousSource = readText(path.join(root, "src", "ui", "voice", "voice-continuous.js"));
  const voicePanelSource = readText(path.join(root, "src", "ui", "voice", "voice-panel.js"));
  const packageSource = readText(path.join(root, "package.json"));
  const electronSource = readText(path.join(root, "electron", "main.cjs"));
  const htmlSource = readText(path.join(root, "src", "ui", "jarvis-react", "index.html"));
  const ttsSource = readText(path.join(root, "src", "core", "voice", "tts-providers.js"));
  const apiSource = readText(path.join(root, "src", "core", "api.js"));
  const selfKnowledgeSource = readText(path.join(root, "src", "core", "docs", "self-knowledge.js"));
  const uiToolSource = readText(path.join(root, "src", "core", "capabilities", "tools", "ui.js"));
  const schemaCatalogSource = readText(path.join(root, "src", "core", "capabilities", "schemas.js"));
  const asrRealAudioProbeSource = readText(path.join(root, "scripts", "probe-asr-real-audio.cjs"));
  const viteSource = readText(path.join(root, "vite.jarvis.config.mjs"));
  const jarvisAssetsDir = path.join(root, "src", "ui", "jarvis", "assets");
  const mainBundleBytes = fs.existsSync(jarvisAssetsDir)
    ? fs.readdirSync(jarvisAssetsDir)
      .filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name))
      .map((name) => {
        const file = path.join(jarvisAssetsDir, name);
        const stat = fs.statSync(file);
        return { name, size: stat.size, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.size || 0
    : 0;
  const visualsDir = path.join(root, "src", "ui", "jarvis", "visuals");
  const requiredVisuals = ["idle.webm", "listening.webm", "thinking.webm", "speaking.webm", "alert.webm", "hud-feed.webm"];
  const visualAssets = requiredVisuals.map((name) => {
    const file = path.join(visualsDir, name);
    return { name, exists: fs.existsSync(file), size: fs.existsSync(file) ? fs.statSync(file).size : 0 };
  });
  const wakeAudioDir = path.join(root, "src", "ui", "jarvis-react", "public", "audio");
  const wakeAudioAssets = ["wake-greeting.wav", "self-check-ready.wav"].map((name) => {
    const file = path.join(wakeAudioDir, name);
    return { name, exists: fs.existsSync(file), size: fs.existsSync(file) ? fs.statSync(file).size : 0 };
  });

  const startApiPos = indexSource.indexOf("startAPI(apiPort");
  const backgroundRefreshPos = indexSource.indexOf("refreshStartupEnvironment().catch");
  const beforeRefreshDefinition = indexSource.slice(0, Math.max(0, indexSource.indexOf("let startupEnvironmentRefreshStarted")));
  const blockingStartupAwaits = [
    "await collectSystemInfo()",
    "await collectGeoWeather()",
    "await collectTrending(",
    "await collectAgents()",
    "await loadInstalledTools()",
  ].filter((needle) => beforeRefreshDefinition.indexOf(needle) >= 0);
  const runTurnSource = indexSource.slice(indexSource.indexOf("async function runTurn"), indexSource.indexOf("async function main"));

  return {
    startup: {
      apiBeforeBackgroundRefresh: startApiPos >= 0 && backgroundRefreshPos > startApiPos,
      blockingStartupAwaits,
      defaultSelfCheckDisabled: /return !\/\^\(1\|true\|yes\|on\)\$\/i\.test\(run\)/.test(indexSource),
      defaultAwakeningDisabled: /shouldRunAwakeningTicks\(\) \? 10 : 0/.test(indexSource),
      defaultAutonomousTicksDisabled: /function shouldRunAutonomousTicks/.test(indexSource)
        && /JARVIS_RUN_AUTONOMOUS_TICKS/.test(indexSource)
        && /idle monitor/.test(indexSource),
      watchdogShortEnough: /JARVIS_RUN_TURN_WATCHDOG_MS/.test(indexSource)
        && /90_000/.test(indexSource)
        && !/const RUN_TURN_WATCHDOG_MS = 600_000/.test(indexSource),
      runTurnUsesGeoCache: /getGeoWeatherMeta\(\)/.test(runTurnSource) && !/geoResult/.test(runTurnSource),
      voiceChannelRecognizesChinese: /语音识别/.test(indexSource) && /语音对话/.test(indexSource),
    },
    ui: {
      lightweightShell: mainBundleBytes > 0
        && mainBundleBytes <= 85_000
        && /JarvisWorkbench/.test(mainSource)
        && /AgentPortrait/.test(mainSource)
        && /monitor-stage/.test(mainSource)
        && /HudTerminal/.test(mainSource),
      coreConversationVisible: /monitor-stage/.test(mainSource)
        && /HudTerminal/.test(mainSource)
        && /command-dock/.test(mainSource)
        && /sendMessage/.test(mainSource)
        && /pollForReply/.test(mainSource)
        && /EventSource/.test(mainSource),
      voiceSingleTurnAvailable: /initVoicePanel/.test(mainSource)
        && /getSingleTurn:\s*\(\)\s*=>\s*true/.test(mainSource)
        && /语音识别/.test(mainSource),
      ttsVoiceReplyAvailable: /\/tts\/stream/.test(mainSource)
        && /suspendForTTS/.test(mainSource)
        && /resumeAfterMedia/.test(mainSource),
      voiceSilenceAutoFinish: /SILENCE_FINISH_MS/.test(voiceContinuousSource)
        && /scheduleSilenceFinishCheck/.test(voiceContinuousSource)
        && /speechStarted/.test(voiceContinuousSource)
        && /finishVoiceTurn/.test(voiceContinuousSource)
        && /finishVoiceTurn:\s*finishCurrentVoiceTurn/.test(voicePanelSource),
      voiceFrontendDiagnostics: /getDiagnostics/.test(voicePanelSource)
        && /clearSelectedMicDevice/.test(voicePanelSource)
        && /describeNoTranscript/.test(voicePanelSource)
        && /jarvis:voice-error/.test(mainSource)
        && /__JARVIS_VOICE_PROVIDER__/.test(mainSource)
        && /__JARVIS_API_BASE__/.test(mainSource)
        && /autoGainControl:\s*true/.test(readText(path.join(root, "src", "ui", "voice", "voice-core.js"))),
      realAudioAsrProbeAvailable: /probe:asr-real-audio/.test(packageSource)
        && /SpeechSynthesizer/.test(asrRealAudioProbeSource)
        && /type:\s*"flush"/.test(asrRealAudioProbeSource)
        && /transcript/.test(asrRealAudioProbeSource),
      staleProbeMessagesFiltered: /isStaleDiagnosticMessage/.test(mainSource)
        && /geoResult is not defined/.test(mainSource),
      reducedMotionHandled: /prefers-reduced-motion:\s*reduce/.test(stylesSource),
      compactBundleConfigured: /manualChunks/.test(viteSource)
        && /vendor-react/.test(viteSource),
      instantWakeAudio: wakeAudioAssets.every((item) => item.exists && item.size > 4096)
        && /WAKE_GREETING_LEAD_MS/.test(mainSource)
        && /wakeSequencePromiseRef/.test(mainSource)
        && /postWakeListenRef/.test(mainSource),
      singleProductSurface: /jarvisUiRoot/.test(apiSource)
        && /Legacy entry points now resolve to the single Jarvis workbench/.test(apiSource)
        && /!src\/core\/ui\/brain-ui/.test(packageSource)
        && /!src\/ui\/jarvis-react/.test(packageSource)
        && !/__blmSink|`blm_/.test(readText(path.join(root, "src", "ui", "audio", "audio-output.js")) + ttsSource),
      compactDesktopLayout: /min-width:\s*901px/.test(stylesSource)
        && /max-width:\s*1180px/.test(stylesSource)
        && /width:\s*min\(700px,\s*calc\(100% - 80px\)\)/.test(stylesSource)
        && /@media \(max-width:\s*900px\)/.test(stylesSource),
      safeLiveResults: /useAcuiCards/.test(mainSource)
        && /ACUI_CARD_LIMIT\s*=\s*4/.test(mainSource)
        && /Dynamic interface code was received but was not executed/.test(mainSource)
        && /card\.dismissed/.test(mainSource)
        && /\.acui-result-layer/.test(stylesSource),
      currentToolSurface: /src\/ui\/jarvis-react/.test(selfKnowledgeSource)
        && !/Brain UI 总览|src\/ui\/brain-ui|ui_register 转正/.test(selfKnowledgeSource)
        && /COMPONENT_DEFINITIONS/.test(uiToolSource)
        && !/brain-ui|new Function|execUIRegister|execManageApp/.test(uiToolSource)
        && /RETIRED_DESKTOP_TOOLS/.test(schemaCatalogSource),
      turnLifecycleGuarded: /activeTurnRef/.test(mainSource)
        && /visibleStreamRef/.test(mainSource)
        && /cleanStreamChunk/.test(mainSource)
        && /clearReplyPoll/.test(mainSource)
        && /fallback_delivered/.test(mainSource)
        && /schedulePostReplyListen/.test(mainSource),
    },
    security: {
      rendererSandboxed: /sandbox:\s*true/.test(electronSource)
        && /contextIsolation:\s*true/.test(electronSource)
        && /nodeIntegration:\s*false/.test(electronSource)
        && !/appendSwitch\(["']no-sandbox["']\)/.test(electronSource),
      mediaPermissionScoped: /setPermissionRequestHandler/.test(electronSource)
        && /webContents\s*===\s*window\.webContents/.test(electronSource)
        && /permission\s*===\s*["']media["']/.test(electronSource),
      navigationRestricted: /setWindowOpenHandler/.test(electronSource)
        && /will-navigate/.test(electronSource)
        && /shell\.openExternal/.test(electronSource),
      contentSecurityPolicy: /http-equiv=["']Content-Security-Policy["']/.test(htmlSource)
        && /object-src 'none'/.test(htmlSource)
        && /script-src 'self' blob:/.test(htmlSource)
        && /worker-src 'self' blob:/.test(htmlSource),
      apiHardening: /installRequestBodyGuard/.test(apiSource)
        && /consumeRateLimit/.test(apiSource)
        && /MAX_ASR_WS_PAYLOAD_BYTES/.test(apiSource)
        && /isSensitiveRequest/.test(apiSource)
        && /cloud-asr-armed/.test(apiSource)
        && /ASR_SPEECH_RMS_THRESHOLD/.test(apiSource)
        && /\^file:\\\/\\\//.test(apiSource)
        && !/Access-Control-Allow-Origin['"]:\s*['"]\*['"]/.test(apiSource),
    },
    resilience: {
      ttsTimeout: /JARVIS_TTS_TIMEOUT_MS\s*=\s*45_000/.test(ttsSource)
        && /taskkill\.exe/.test(ttsSource)
        && /timed out after/.test(ttsSource),
      ttsSerialized: /jarvisTtsQueue/.test(ttsSource)
        && /enqueueJarvisTTS/.test(ttsSource)
        && /activeJarvisTtsChildren/.test(ttsSource),
      desktopCloseProbe: /probe:desktop-close/.test(packageSource)
        && fs.existsSync(path.join(root, "scripts", "probe-desktop-close.cjs")),
      activeWorkbenchProbe: /activeWorkbench/.test(electronSource)
        && /transitionMs\s*<=\s*1200/.test(electronSource)
        && /legacyWorkbenchVideoCount/.test(electronSource),
      apiHardeningProbe: /probe:api-hardening/.test(packageSource)
        && fs.existsSync(path.join(root, "scripts", "probe-api-hardening.cjs")),
      wakeSequenceProbe: /probe:wake-sequence/.test(packageSource)
        && fs.existsSync(path.join(root, "scripts", "probe-wake-sequence.cjs")),
      singleProductProbe: /probe:single-product/.test(packageSource)
        && fs.existsSync(path.join(root, "scripts", "probe-single-product.cjs")),
      layoutProbe: /probe:layout/.test(packageSource)
        && fs.existsSync(path.join(root, "scripts", "probe-layout.cjs")),
      acuiProbe: /probe:acui/.test(packageSource)
        && fs.existsSync(path.join(root, "scripts", "probe-acui-workbench.cjs")),
      toolSurfaceProbe: /probe:tool-surface/.test(packageSource)
        && fs.existsSync(path.join(root, "scripts", "probe-current-tool-surface.cjs")),
      turnLifecycleProbe: /probe:turn-lifecycle/.test(packageSource)
        && fs.existsSync(path.join(root, "scripts", "probe-turn-lifecycle.cjs")),
    },
    visualAssets,
    wakeAudioAssets,
  };
}

function scoreChecks(checks) {
  const issues = [];
  let score = 0;
  let max = 0;
  const add = (name, ok, weight = 1, detail = "") => {
    max += weight;
    if (ok) score += weight;
    else issues.push({ name, detail });
  };

  add("desktop shortcut targets current build", checks.shortcut?.ok, 2, checks.shortcut?.error || checks.shortcut?.target || "");
  add("backend status responds", checks.status?.ok && checks.status?.running, 2, checks.errors.status || "");
  add("DeepSeek is activated", checks.activation?.activated && checks.activation?.provider, 2, checks.errors.activation || "");
  add("core readiness is ok", checks.readiness?.ok && checks.readiness?.coreOk, 2, checks.errors.readiness || "");
  add("Jarvis local TTS is active", checks.tts?.tts?.ttsProvider === "jarvis"
    && checks.tts?.tts?.ttsVoiceId === "jarvis-high"
    && checks.tts?.tts?.systemFallbackAvailable === false, 2, checks.errors.tts || JSON.stringify(checks.tts?.tts || {}));
  add("startup API is not blocked by environment scans", checks.static.startup.apiBeforeBackgroundRefresh && checks.static.startup.blockingStartupAwaits.length === 0, 2, checks.static.startup.blockingStartupAwaits.join(", "));
  add("startup self-check is opt-in", checks.static.startup.defaultSelfCheckDisabled, 1);
  add("awakening ticks are opt-in", checks.static.startup.defaultAwakeningDisabled, 1);
  add("autonomous idle LLM ticks are opt-in", checks.static.startup.defaultAutonomousTicksDisabled, 2);
  add("conversation watchdog is desktop-sized", checks.static.startup.watchdogShortEnough, 1);
  add("message loop uses geo cache without stale locals", checks.static.startup.runTurnUsesGeoCache, 2);
  add("voice channel recognizes Chinese labels", checks.static.startup.voiceChannelRecognizesChinese, 1);
  add("frontend shell is lightweight", checks.static.ui.lightweightShell, 2);
  add("core conversation path is visible", checks.static.ui.coreConversationVisible, 1);
  add("voice single-turn path is available", checks.static.ui.voiceSingleTurnAvailable, 1);
  add("TTS voice reply path is available", checks.static.ui.ttsVoiceReplyAvailable, 1);
  add("voice silence auto-finish is wired", checks.static.ui.voiceSilenceAutoFinish, 1);
  add("voice frontend diagnostics are available", checks.static.ui.voiceFrontendDiagnostics, 1);
  add("real-audio ASR probe is available", checks.static.ui.realAudioAsrProbeAvailable, 1);
  add("stale probe messages are filtered", checks.static.ui.staleProbeMessagesFiltered, 1);
  add("reduced motion is handled", checks.static.ui.reducedMotionHandled, 1);
  add("frontend vendor chunks are split", checks.static.ui.compactBundleConfigured, 1);
  add("instant wake audio and sequencer are available", checks.static.ui.instantWakeAudio, 2, JSON.stringify(checks.static.wakeAudioAssets));
  add("only the Jarvis product surface is packaged", checks.static.ui.singleProductSurface, 2);
  add("compact desktop layout has a dedicated breakpoint", checks.static.ui.compactDesktopLayout, 2);
  add("live tool results render in the current safe workbench", checks.static.ui.safeLiveResults, 2);
  add("model self-knowledge and tool catalog match the current workbench", checks.static.ui.currentToolSurface, 2);
  add("conversation completion and streaming are guarded per turn", checks.static.ui.turnLifecycleGuarded, 2);
  add("Electron renderer sandbox is enforced", checks.static.security.rendererSandboxed, 2);
  add("microphone permission is scoped to the main window", checks.static.security.mediaPermissionScoped, 1);
  add("popup and navigation targets are restricted", checks.static.security.navigationRestricted, 1);
  add("renderer content security policy is present", checks.static.security.contentSecurityPolicy, 1);
  add("local API request and WebSocket guards are enforced", checks.static.security.apiHardening, 2);
  add("local TTS has a hard timeout", checks.static.resilience.ttsTimeout, 1);
  add("local TTS requests are serialized", checks.static.resilience.ttsSerialized, 1);
  add("desktop close regression probe is available", checks.static.resilience.desktopCloseProbe, 1);
  add("active workbench layout probe is available", checks.static.resilience.activeWorkbenchProbe, 1);
  add("API hardening regression probe is available", checks.static.resilience.apiHardeningProbe, 1);
  add("wake sequence timing probe is available", checks.static.resilience.wakeSequenceProbe, 1);
  add("single-product package probe is available", checks.static.resilience.singleProductProbe, 1);
  add("desktop geometry and screenshot probe is available", checks.static.resilience.layoutProbe, 1);
  add("live result WebSocket probe is available", checks.static.resilience.acuiProbe, 1);
  add("current tool-surface regression probe is available", checks.static.resilience.toolSurfaceProbe, 1);
  add("conversation lifecycle regression probe is available", checks.static.resilience.turnLifecycleProbe, 1);
  add("state videos exist", checks.static.visualAssets.every((item) => item.exists && item.size > 0), 1, JSON.stringify(checks.static.visualAssets));

  return { score, max, issues };
}

(async () => {
  const checks = {
    generatedAt: new Date().toISOString(),
    shortcut: readShortcutSummary(),
    static: staticSourceChecks(),
    activation: null,
    status: null,
    readiness: null,
    tts: null,
    errors: {},
  };

  try { checks.activation = await requestJson("/activation-status"); }
  catch (error) { checks.errors.activation = error.message; }

  try { checks.status = await requestJson("/status"); }
  catch (error) { checks.errors.status = error.message; }

  try { checks.readiness = await requestJson("/readiness"); }
  catch (error) { checks.errors.readiness = error.message; }

  try { checks.tts = await requestJson("/settings/tts"); }
  catch (error) { checks.errors.tts = error.message; }

  const result = scoreChecks(checks);
  const summary = {
    ok: result.issues.length === 0,
    score: `${result.score}/${result.max}`,
    issues: result.issues,
    activation: checks.activation ? {
      activated: !!checks.activation.activated,
      provider: checks.activation.provider || null,
      model: checks.activation.model || null,
    } : null,
    status: checks.status ? {
      ok: !!checks.status.ok,
      running: !!checks.status.running,
      memory_count: checks.status.memory_count,
      queue: checks.status.queue || null,
    } : null,
    readiness: checks.readiness ? {
      ok: !!checks.readiness.ok,
      coreOk: !!checks.readiness.coreOk,
      fullReady: !!checks.readiness.fullReady,
      blockers: checks.readiness.blockers || [],
    } : null,
    tts: checks.tts?.tts ? {
      provider: checks.tts.tts.ttsProvider || null,
      voiceId: checks.tts.tts.ttsVoiceId || null,
      systemFallbackAvailable: !!checks.tts.tts.systemFallbackAvailable,
    } : null,
    shortcut: checks.shortcut,
    static: checks.static,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
})();
