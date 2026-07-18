const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const net = require("net");
const { EventEmitter } = require("events");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const JARVIS_HOME = path.resolve(process.env.JARVIS_HOME || "H:\\Jarvis");
const CORE_ENTRY = path.join(ROOT, "src", "core", "index.js");
const IS_DESKTOP_PROBE = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_DESKTOP_PROBE || ""));
const IS_DESKTOP_CLOSE_PROBE = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_DESKTOP_CLOSE_PROBE || ""));
const IS_WAKE_SEQUENCE_PROBE = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_WAKE_SEQUENCE_PROBE || ""));
const IS_LAYOUT_PROBE = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_LAYOUT_PROBE || ""));
const IS_ACUI_PROBE = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_ACUI_PROBE || ""));
const IS_TURN_LIFECYCLE_PROBE = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_TURN_LIFECYCLE_PROBE || ""));
const IS_SERVER_PROBE = /^(1|true|yes|on)$/i.test(String(process.env.JARVIS_SERVER_PROBE || ""));
const IS_HEADLESS_PROBE = IS_DESKTOP_PROBE || IS_DESKTOP_CLOSE_PROBE || IS_WAKE_SEQUENCE_PROBE || IS_LAYOUT_PROBE || IS_ACUI_PROBE || IS_TURN_LIFECYCLE_PROBE || IS_SERVER_PROBE;
if (IS_DESKTOP_PROBE) {
  process.env.JARVIS_SKIP_STARTUP_SELF_CHECK = process.env.JARVIS_SKIP_STARTUP_SELF_CHECK || "1";
}

app.setName("Jarvis");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const FORCE_SOFTWARE_RENDERING = /^(1|true|yes|on)$/i.test(String(
  process.env.JARVIS_FORCE_SOFTWARE_RENDERING || process.env.JARVIS_DISABLE_GPU || ""
));
if (FORCE_SOFTWARE_RENDERING) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("use-gl", "swiftshader");
}

const runtimeRoot = process.env.JARVIS_USER_DIR
  ? path.resolve(process.env.JARVIS_USER_DIR)
  : path.join(JARVIS_HOME, "runtime", "jarvis");
app.setAppUserModelId(app.isPackaged ? "local.jarvis.agent" : "local.jarvis.agent.dev");
const userDataDir = path.join(runtimeRoot, "electron-user-data");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const LOG_FILE = path.join(runtimeRoot, "jarvis-electron.log");

function log(...parts) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${parts.join(" ")}\n`, "utf8");
  } catch {}
}

function installGlobalDesktopBridges() {
  global.focusBannerBridge = global.focusBannerBridge || new EventEmitter();
  global.jarvisAppControl = {
    restart() {
      log("restart-requested");
      app.relaunch();
      app.quit();
    }
  };
}

function copyIfMissing(source, target) {
  try {
    if (!source || !fs.existsSync(source) || fs.existsSync(target)) return false;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return true;
  } catch (error) {
    log("copy-config-failed", source, target, error.message || String(error));
    return false;
  }
}

function readJsonFile(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function uniqueExistingRoots(roots) {
  const seen = new Set();
  const result = [];
  for (const root of roots) {
    if (!root) continue;
    let resolved;
    try { resolved = path.resolve(root); } catch { continue; }
    const key = resolved.toLowerCase();
    if (seen.has(key) || !fs.existsSync(resolved)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function getMusicTrackSources() {
  const packagedMusic = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", "music") : "";
  const roots = uniqueExistingRoots([
    packagedMusic,
    path.join(ROOT, "music"),
    path.join(app.getPath("music"), "Jarvis"),
  ]);
  const tracks = {
    cornfieldChase: ["Cornfield Chase"],
    noTimeForCaution: ["No Time for Caution"],
    interstellarTheme: ["Interstellar Main Theme", "Day One (Interstellar Theme)"],
  };
  const extensions = ["mp3", "m4a", "flac", "wav", "ogg", "aac"];
  const result = {};
  for (const [id, names] of Object.entries(tracks)) {
    for (const root of roots) {
      for (const name of names) {
        for (const extension of extensions) {
          const candidate = path.join(root, `${name}.${extension}`);
          if (!fs.existsSync(candidate)) continue;
          result[id] = pathToFileURL(candidate).href;
          break;
        }
        if (result[id]) break;
      }
      if (result[id]) break;
    }
  }
  return result;
}

function getConfigCandidateRoots() {
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const userProfile = process.env.USERPROFILE || app.getPath("home");
  const resourcesPath = process.resourcesPath || ROOT;
  return uniqueExistingRoots([
    path.join(ROOT, "data"),
    path.resolve(resourcesPath, "..", "..", "..", "data"),
    path.join(appData, "Jarvis"),
    path.join(localAppData, "Jarvis"),
    path.join(localAppData, "JarvisAgent"),
    path.join(userProfile, "Documents", "贾维斯", "data"),
    path.join(userProfile, "Documents", "Jarvis-Agent", "data"),
    "H:\\Jarvis-Agent\\data",
  ]).filter((root) => path.resolve(root).toLowerCase() !== path.resolve(runtimeRoot).toLowerCase());
}

const LLM_PROVIDER_IDS = ["deepseek", "minimax", "openai", "qwen", "moonshot", "zhipu", "mimo", "custom"];

function providerFromConfig(cfg) {
  const candidates = [
    cfg?.provider,
    cfg?.llm?.provider,
    cfg?.providers?.defaultProvider,
    cfg?.defaultProvider,
  ];
  for (const value of candidates) {
    const provider = String(value || "").trim().toLowerCase();
    if (provider) return provider;
  }
  return "";
}

function hasUsableLlmRecord(provider, record) {
  if (!record || typeof record !== "object") return false;
  if (provider === "custom") {
    return Boolean(String(record.baseURL || "").trim() && String(record.model || "").trim());
  }
  return Boolean(String(record.apiKey || "").trim());
}

function findStoredProvider(root) {
  const cfgProvider = providerFromConfig(readJsonFile(path.join(root, "config.json")));
  if (cfgProvider && LLM_PROVIDER_IDS.includes(cfgProvider)) return cfgProvider;
  for (const provider of LLM_PROVIDER_IDS) {
    const record = readJsonFile(path.join(root, "llm", `${provider}.json`));
    if (hasUsableLlmRecord(provider, record)) return provider;
  }
  return "";
}

function inheritLlmProviderFiles(candidateRoots) {
  const targetLlmDir = path.join(runtimeRoot, "llm");
  let inheritedProvider = "";
  for (const root of candidateRoots) {
    for (const provider of LLM_PROVIDER_IDS) {
      const source = path.join(root, "llm", `${provider}.json`);
      const record = readJsonFile(source);
      if (!hasUsableLlmRecord(provider, record)) continue;
      const target = path.join(targetLlmDir, `${provider}.json`);
      if (copyIfMissing(source, target)) {
        if (!inheritedProvider) inheritedProvider = provider;
        log("inherited-llm-provider", provider, source);
      }
    }
  }
  return inheritedProvider;
}

function repairActiveProviderPointer(provider) {
  if (!provider || !LLM_PROVIDER_IDS.includes(provider)) return false;
  const configFile = path.join(runtimeRoot, "config.json");
  const current = readJsonFile(configFile) || {};
  if (providerFromConfig(current) === provider) return false;
  writeJsonFile(configFile, {
    ...current,
    schemaVersion: Math.max(Number(current.schemaVersion) || 0, 2),
    provider,
  });
  return true;
}

function inheritExistingConfig() {
  const roots = getConfigCandidateRoots();
  const candidates = roots.map((root) => path.join(root, "config.json"));
  const target = path.join(runtimeRoot, "config.json");
  for (const candidate of candidates) {
    if (copyIfMissing(candidate, target)) {
      log("inherited-config", candidate);
      break;
    }
  }
  const inheritedProvider = inheritLlmProviderFiles(roots);
  const activeProvider = providerFromConfig(readJsonFile(target))
    || inheritedProvider
    || findStoredProvider(runtimeRoot);
  try {
    if (repairActiveProviderPointer(activeProvider)) {
      log("repaired-active-provider", activeProvider);
    }
  } catch (error) {
    log("repair-active-provider-failed", activeProvider, error.message || String(error));
  }
}

async function findFreePort(preferred = 3721) {
  for (const port of [preferred, 0]) {
    try {
      return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const address = server.address();
          server.close(() => resolve(address.port));
        });
      });
    } catch {}
  }
  throw new Error("Unable to find a free local port.");
}

let mainWindow = null;
let backendPort = 0;

function waitForBackend(port, timeoutMs = 45000) {
  const startedAt = Date.now();
  const url = `http://127.0.0.1:${port}/activation-status`;
  let lastProbe = "not probed";

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Jarvis core startup timed out on port ${port}. Last probe: ${lastProbe}`));
        return;
      }

      const req = http.get(url, (res) => {
        res.resume();
        lastProbe = `HTTP ${res.statusCode || "unknown"}`;
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        setTimeout(tick, 300);
      });

      req.on("error", (error) => {
        lastProbe = error.message || String(error);
        setTimeout(tick, 300);
      });
      req.setTimeout(1500, () => {
        lastProbe = "timeout";
        req.destroy();
        setTimeout(tick, 300);
      });
    };

    tick();
  });
}

async function bootstrapJarvisCore(port) {
  if (!fs.existsSync(CORE_ENTRY)) {
    throw new Error(`Jarvis core was not found at ${CORE_ENTRY}`);
  }

  inheritExistingConfig();

  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_USER_DIR = runtimeRoot;
  process.env.JARVIS_RESOURCES_DIR = ROOT;
  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_DESKTOP = "1";
  process.env.JARVIS_HOME = JARVIS_HOME;
  process.env.GROK_HOME = path.join(JARVIS_HOME, "runtime", "grok-home");
  process.env.JARVIS_GROK_BIN = path.join(JARVIS_HOME, "tools", "grok-cli", "node_modules", "@xai-official", "grok-win32-x64", "bin", "grok.exe");
  process.env.JARVIS_GROK_TEMP = path.join(JARVIS_HOME, "runtime", "tmp");
  process.env.JARVIS_ESPEAK_DATA = path.join(JARVIS_HOME, "runtime", "voice", "voice", "espeak-ng-data");
  process.env.TEMP = process.env.JARVIS_GROK_TEMP;
  process.env.TMP = process.env.JARVIS_GROK_TEMP;
  fs.mkdirSync(process.env.JARVIS_GROK_TEMP, { recursive: true });

  installGlobalDesktopBridges();
  await import(pathToFileURL(CORE_ENTRY).href);
}

function installMediaPermissions(window) {
  const session = window.webContents.session;
  const isTrustedOrigin = (value) => value === "null" || /^file:\/\//i.test(String(value || ""));
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trusted = webContents === window.webContents
      && details?.isMainFrame !== false
      && isTrustedOrigin(details?.requestingUrl || webContents.getURL());
    callback(permission === "media" && trusted);
  });
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => (
    webContents === window.webContents
    && permission === "media"
    && isTrustedOrigin(details?.securityOrigin || requestingOrigin || webContents.getURL())
  ));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1060,
    minHeight: 720,
    backgroundColor: "#02070b",
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    title: "Jarvis",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  installMediaPermissions(mainWindow);

  if (IS_WAKE_SEQUENCE_PROBE) {
    mainWindow.webContents.on("console-message", (event) => {
      console.log(`[wake-renderer:${event?.level ?? "info"}] ${event?.message || ""}`);
    });
  }
  if (IS_DESKTOP_PROBE) {
    mainWindow.webContents.on("console-message", (event) => {
      console.log(`[desktop-renderer:${event?.level ?? "info"}] ${event?.message || ""}`);
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === mainWindow.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (input.key === "F11") {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
      return;
    }
    if ((input.control || input.meta) && input.key.toLowerCase() === "r") {
      mainWindow.webContents.reload();
      event.preventDefault();
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!IS_HEADLESS_PROBE && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  await mainWindow.loadFile(path.join(ROOT, "src", "ui", "jarvis", "index.html"));
  if (!IS_HEADLESS_PROBE && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("jarvis:get-backend-port", () => backendPort);
ipcMain.handle("jarvis:get-version", () => app.getVersion());
ipcMain.handle("jarvis:get-music-tracks", () => getMusicTrackSources());
ipcMain.handle("jarvis:get-probe-mode", () => {
  if (IS_TURN_LIFECYCLE_PROBE) return "turn-lifecycle";
  if (IS_ACUI_PROBE) return "acui";
  if (IS_LAYOUT_PROBE) return "layout";
  if (IS_WAKE_SEQUENCE_PROBE) return "wake-sequence";
  if (IS_DESKTOP_PROBE) return "desktop";
  if (IS_DESKTOP_CLOSE_PROBE) return "desktop-close";
  if (IS_SERVER_PROBE) return "server";
  return "";
});
ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("updater:check-for-updates", () => ({ ok: false, skipped: true, reason: "jarvis-dev" }));
ipcMain.handle("updater:start-download", () => ({ ok: false, skipped: true, reason: "jarvis-dev" }));
ipcMain.handle("updater:quit-and-install", () => ({ ok: false, skipped: true, reason: "jarvis-dev" }));

async function runDesktopProbe() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("main window is not available");
  }
  {
    const result = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitFor = async (predicate, timeout = 16000) => {
          const started = Date.now();
          let value = null;
          while (Date.now() - started < timeout) {
            value = predicate();
            if (value?.ready) return value;
            await sleep(250);
          }
          return value || predicate();
        };
        const backendPort = await window.jarvisDesktop?.getBackendPort?.();
        const snapshot = await waitFor(() => {
          const stage = document.querySelector(".monitor-stage");
          const composer = document.querySelector(".command-dock textarea");
          const terminal = document.querySelector(".hud-terminal");
          const voiceButton = document.querySelector("#voice-toggle");
          const voiceCanvas = document.querySelector("#voice-canvas");
          const orbVideo = document.querySelector(".entity-video");
          const workbench = document.querySelector(".jarvis-workbench");
          const text = document.body.innerText || "";
          const statusPills = [...document.querySelectorAll(".status-pill")].map((el) => el.textContent.replace(/\\s+/g, " ").trim());
          const shellReady = Boolean(stage && composer && terminal && voiceButton && voiceCanvas && orbVideo && workbench);
          const statusReady = statusPills.length >= 3 && !statusPills.some((pill) => pill.includes("同步中"));
          return {
            ready: shellReady && statusReady,
            statusPills,
            voiceDiagnosticsAvailable: typeof window.jarvisVoice?.getDiagnostics === "function",
            turnProbeExposed: typeof window.__jarvisTurnProbe !== "undefined",
            orbVideoReadyState: orbVideo?.readyState || 0,
            workbenchReady: Boolean(workbench),
            bodyText: text.slice(0, 600),
          };
        });
        let backendStatus = null;
        let backendReadiness = null;
        let backendGrok = null;
        try {
          backendStatus = await fetch("http://127.0.0.1:" + backendPort + "/status").then((res) => res.json());
        } catch (error) {
          backendStatus = { ok: false, error: error.message || String(error) };
        }
        try {
          backendReadiness = await fetch("http://127.0.0.1:" + backendPort + "/readiness").then((res) => res.json());
        } catch (error) {
          backendReadiness = { ok: false, error: error.message || String(error) };
        }
        try {
          backendGrok = await fetch("http://127.0.0.1:" + backendPort + "/grok-build/status").then((res) => res.json());
        } catch (error) {
          backendGrok = { ok: false, error: error.message || String(error) };
        }
        const workbenchStartedAt = performance.now();
        window.__jarvisUiProbe?.enterWorkbench?.();
        const activeWorkbench = await waitFor(() => {
          const stage = document.querySelector(".monitor-stage");
          if (!stage?.classList.contains("mode-active")) return { ready: false };
          const frame = document.querySelector(".entity-frame");
          const workbench = document.querySelector(".jarvis-workbench");
          const frameRect = frame?.getBoundingClientRect();
          const workbenchRect = workbench?.getBoundingClientRect();
          const frameCenterInside = Boolean(frameRect && workbenchRect
            && frameRect.left + frameRect.width / 2 >= workbenchRect.left
            && frameRect.left + frameRect.width / 2 <= workbenchRect.right
            && frameRect.top + frameRect.height / 2 >= workbenchRect.top
            && frameRect.top + frameRect.height / 2 <= workbenchRect.bottom);
          return {
            ready: true,
            transitionMs: Math.round(performance.now() - workbenchStartedAt),
            entityFrameCount: document.querySelectorAll(".entity-frame").length,
            legacyWorkbenchVideoCount: document.querySelectorAll(".workbench-entity-video").length,
            frameCenterInside,
          };
        }, 3000);
        const activeWorkbenchOk = activeWorkbench.ready
          && activeWorkbench.transitionMs <= 1200
          && activeWorkbench.entityFrameCount === 1
          && activeWorkbench.legacyWorkbenchVideoCount === 0
          && activeWorkbench.frameCenterInside;
        const engineeringButton = [...document.querySelectorAll(".module-link")].find((item) => item.textContent.includes("工程台"));
        engineeringButton?.click();
        const engineering = await waitFor(() => {
          const panel = document.querySelector(".engineering-console");
          return { ready: !!panel && getComputedStyle(panel).opacity === "1", visible: !!panel };
        }, 3000);
        return {
          ok: Boolean(snapshot.ready && snapshot.voiceDiagnosticsAvailable && !snapshot.turnProbeExposed && backendStatus?.ok && backendStatus?.running && backendReadiness?.coreOk && backendGrok?.available && String(backendGrok?.home || "").toUpperCase().charAt(0) === "H" && String(backendGrok?.home || "").charAt(1) === ":" && activeWorkbenchOk && engineering.ready),
          backendPort,
          ui: { ...snapshot, activeWorkbench },
          backendStatus,
          backendReadiness: backendReadiness ? {
            ok: !!backendReadiness.ok,
            coreOk: !!backendReadiness.coreOk,
            fullReady: !!backendReadiness.fullReady,
            blockers: backendReadiness.blockers || [],
          } : null,
          backendGrok,
          engineering,
        };
      })();
    `, true);
    console.log(`JARVIS_DESKTOP_PROBE_RESULT ${JSON.stringify(result)}`);
    return result;
  }
  const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (predicate, timeout = 12000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = predicate();
          if (value) return value;
          await sleep(200);
        }
        return predicate();
      };
      const waitForVideo = async (state, timeout = 5000) => {
        const probe = window.__jarvisVisualProbe;
        probe?.setState?.(state);
        const started = Date.now();
        let video = document.querySelector(".state-video");
        while (Date.now() - started < timeout) {
          video = document.querySelector(".state-video");
          if (
            video &&
            video.dataset.stateVideo === state &&
            video.readyState >= 2 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0 &&
            video.dataset.videoFallback !== "true"
          ) {
            break;
          }
          await sleep(120);
        }
        video = document.querySelector(".state-video");
        return {
          state,
          requestedState: video?.dataset?.stateVideo || "",
          activeVideo: video?.dataset?.activeVideo || "",
          fallback: video?.dataset?.videoFallback === "true",
          ready: video?.dataset?.videoReady === "true",
          src: video?.getAttribute("src") || "",
          readyState: video?.readyState || 0,
          paused: video?.paused ?? true,
          videoWidth: video?.videoWidth || 0,
          videoHeight: video?.videoHeight || 0,
        };
      };
      const backendPort = await window.jarvisDesktop?.getBackendPort?.();
      await waitFor(() => document.querySelector(".connection-pill.is-online"));
      await waitFor(() => {
        const caps = [...document.querySelectorAll(".capability-token")].map((el) => ({
          label: el.querySelector("b")?.textContent || "",
          on: el.classList.contains("is-on"),
        }));
        const search = caps.find((item) => item.label === "Search");
        return !!search?.on;
      }, 16000).catch(() => {});
      await sleep(200);
      const connectionEl = document.querySelector(".connection-pill");
      const video = document.querySelector(".state-video");
      const rightRail = document.querySelector(".right-rail");
      const capabilities = [...document.querySelectorAll(".capability-token")].map((el) => ({
        label: el.querySelector("b")?.textContent || "",
        value: el.querySelector("span")?.textContent || "",
        on: el.classList.contains("is-on"),
      }));
      const statusChips = [...document.querySelectorAll(".status-chip")].map((el) => ({
        label: el.querySelector("span")?.textContent || "",
        value: el.querySelector("b")?.textContent || "",
      }));
      const toolGroups = [...document.querySelectorAll(".tool-group")].map((el) => ({
        label: el.querySelector(".tool-group-head b")?.textContent || "",
        note: el.querySelector(".tool-group-head em")?.textContent || "",
        count: el.querySelector(".tool-group-head strong")?.textContent || "",
        state: [...el.classList].find((name) => name.startsWith("is-")) || "",
        tools: [...el.querySelectorAll(".tool-pill")].map((pill) => pill.textContent || ""),
      }));
      const toolSummary = [...document.querySelectorAll(".tool-catalog-head span")].map((el) => ({
        label: el.querySelector("em")?.textContent || "",
        value: el.querySelector("b")?.textContent || "",
      }));
      const socialPanel = {
        fieldCount: document.querySelectorAll("[data-social-field]").length,
        fields: [...document.querySelectorAll("[data-social-field]")].map((el) => el.getAttribute("data-social-field") || ""),
        hasSummary: !!document.querySelector("[data-social-summary]"),
        hasWechatPanel: !!document.querySelector("[data-wechat-clawbot-panel]"),
        hasWechatConnect: !!document.querySelector("[data-action='connect-wechat']"),
        hasWechatCopy: !!document.querySelector("[data-action='copy-wechat-qr']"),
        hasWechatDisconnect: !!document.querySelector("[data-action='disconnect-wechat']"),
      };
      const readinessPanel = {
        hasBoard: !!document.querySelector("[data-readiness-board]"),
        itemCount: document.querySelectorAll("[data-readiness-item]").length,
        actionCount: document.querySelectorAll("[data-readiness-action]").length,
        actions: [...document.querySelectorAll("[data-readiness-action]")].map((el) => el.getAttribute("data-readiness-action") || ""),
        items: [...document.querySelectorAll("[data-readiness-item]")].map((el) => ({
          id: el.getAttribute("data-readiness-item") || "",
          ready: el.classList.contains("is-ready"),
          label: el.querySelector("b")?.textContent || "",
          detail: el.querySelector("em")?.textContent || "",
        })),
      };
      const keyIntakePanel = {
        hasMode: !!document.querySelector("[data-key-intake-mode]"),
        hasText: !!document.querySelector("[data-key-intake-text]"),
        hasSubmit: !!document.querySelector("[data-key-intake-submit]"),
        modes: [...document.querySelectorAll("[data-key-intake-mode] option")].map((el) => el.getAttribute("value") || ""),
      };
      const voiceRoute = [...document.querySelectorAll(".voice-route-note span")].map((el) => el.textContent || "");
      const visualProbe = window.__jarvisVisualProbe || null;
      const requiredVisualStates = visualProbe?.required || ["idle", "listening", "thinking", "speaking", "alert"];
      const visualStates = [];
      if (visualProbe?.setState) {
        for (const state of requiredVisualStates) {
          visualStates.push(await waitForVideo(state));
        }
        visualProbe.setState("idle");
        await sleep(120);
      }
      let backendStatus = null;
      let backendCapabilities = null;
      let backendSocial = null;
      let backendWechatQR = null;
      let backendReadiness = null;
      try {
        backendStatus = await fetch("http://127.0.0.1:" + backendPort + "/status").then((res) => res.json());
      } catch (error) {
        backendStatus = { ok: false, error: error.message || String(error) };
      }
      try {
        backendCapabilities = await fetch("http://127.0.0.1:" + backendPort + "/capabilities").then((res) => res.json());
      } catch (error) {
        backendCapabilities = { ok: false, error: error.message || String(error) };
      }
      try {
        backendSocial = await fetch("http://127.0.0.1:" + backendPort + "/settings/social").then((res) => res.json());
      } catch (error) {
        backendSocial = { ok: false, error: error.message || String(error) };
      }
      try {
        backendWechatQR = await fetch("http://127.0.0.1:" + backendPort + "/social/wechat-clawbot/qr").then((res) => res.json());
      } catch (error) {
        backendWechatQR = { ok: false, error: error.message || String(error) };
      }
      try {
        backendReadiness = await fetch("http://127.0.0.1:" + backendPort + "/readiness").then((res) => res.json());
      } catch (error) {
        backendReadiness = { ok: false, error: error.message || String(error) };
      }
      const sse = capabilities.find((item) => item.label === "SSE");
      const social = capabilities.find((item) => item.label === "Social");
      const backendSystemGroup = Array.isArray(backendCapabilities?.groups)
        ? backendCapabilities.groups.find((group) => group.id === "system")
        : null;
      const backendSocialReady = backendSystemGroup?.status === "ready";
      const coreChip = statusChips.find((item) => item.label === "CORE");
      const memoryChip = statusChips.find((item) => item.label === "MEMORY");
      const info = {
        hasJarvisDesktop: !!window.jarvisDesktop?.isElectron,
        backendPort,
        connection: {
          className: connectionEl?.className || "",
          text: connectionEl?.textContent?.replace(/\\s+/g, " ").trim() || "",
          online: connectionEl?.classList.contains("is-online") || false,
        },
        stateVideo: video ? {
          src: video.getAttribute("src"),
          state: video.dataset.stateVideo || "",
          activeVideo: video.dataset.activeVideo || "",
          ready: video.dataset.videoReady === "true",
          fallback: video.dataset.videoFallback === "true",
          readyState: video.readyState,
          paused: video.paused,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        } : null,
        visualProbe: visualProbe ? {
          states: visualProbe.states || [],
          required: requiredVisualStates,
          health: visualProbe.health || {},
        } : null,
        visualStates,
        rightRail: rightRail ? {
          panelCount: document.querySelectorAll(".right-rail .panel").length,
          scrollHeight: rightRail.scrollHeight,
          clientHeight: rightRail.clientHeight,
        } : null,
        capabilities,
        toolSummary,
        toolGroups,
        socialPanel,
        readinessPanel,
        keyIntakePanel,
        voiceRoute,
        statusChips,
        issues: [...document.querySelectorAll(".issue-item p")].map((el) => el.textContent),
        voiceBridge: !!window.jarvisVoice,
        backendStatus,
        backendCapabilities,
        backendSocial,
        backendWechatQR,
        backendReadiness,
      };
      const readinessItems = Object.fromEntries((info.readinessPanel.items || []).map((item) => [item.id, item]));
      info.ok = !!(
        info.hasJarvisDesktop &&
        Number(info.backendPort) > 0 &&
        info.connection.online &&
        info.backendStatus?.ok &&
        (info.backendStatus.running ? coreChip?.value === "RUNNING" : true) &&
        String(info.backendStatus.memory_count ?? "") === memoryChip?.value &&
        info.stateVideo?.readyState >= 2 &&
        info.stateVideo?.videoWidth > 0 &&
        info.visualProbe?.required?.every((state) => info.visualProbe.states?.includes(state)) &&
        info.visualStates?.length >= info.visualProbe?.required?.length &&
        info.visualStates.every((item) =>
          item.requestedState === item.state &&
          item.activeVideo === item.state &&
          item.readyState >= 2 &&
          item.videoWidth > 0 &&
          item.videoHeight > 0 &&
          !item.fallback &&
          item.src.includes(item.state + ".webm")
        ) &&
        info.rightRail?.panelCount >= 5 &&
        info.backendCapabilities?.ok &&
        Number(info.backendCapabilities?.summary?.totalTools || 0) > 0 &&
        info.toolGroups.length >= 4 &&
        info.keyIntakePanel.hasMode &&
        info.keyIntakePanel.hasText &&
        info.keyIntakePanel.hasSubmit &&
        info.keyIntakePanel.modes.includes("deepseek") &&
        info.keyIntakePanel.modes.includes("seedance") &&
        info.keyIntakePanel.modes.includes("social") &&
        info.voiceRoute?.length === 2 &&
        info.socialPanel.fieldCount >= 9 &&
        info.socialPanel.hasSummary &&
        info.socialPanel.hasWechatPanel &&
        info.socialPanel.hasWechatConnect &&
        info.socialPanel.hasWechatCopy &&
        info.socialPanel.hasWechatDisconnect &&
        info.backendSocial?.ok &&
        info.backendSocial?.social?.WECHAT_CLAWBOT &&
        info.backendWechatQR?.ok &&
        Object.prototype.hasOwnProperty.call(info.backendWechatQR, "qr_svg") &&
        info.readinessPanel.hasBoard &&
        info.readinessPanel.itemCount >= 12 &&
        info.readinessPanel.actionCount >= 8 &&
        info.readinessPanel.actions.includes("deepseek") &&
        info.readinessPanel.actions.includes("tts") &&
        info.readinessPanel.actions.includes("seedance") &&
        info.readinessPanel.actions.includes("social") &&
        info.backendReadiness?.ok === true &&
        readinessItems.asr?.ready === !!info.backendReadiness?.capabilities?.asr?.ready &&
        readinessItems.deepseek?.ready === !!info.backendReadiness?.capabilities?.deepseek?.ready &&
        readinessItems.tts?.ready === !!info.backendReadiness?.capabilities?.tts?.ready &&
        readinessItems.social?.ready === !!info.backendReadiness?.capabilities?.social?.ready &&
        social?.on === backendSocialReady &&
        sse?.on
      );
      return info;
    })();
  `);
  console.log(`JARVIS_DESKTOP_PROBE_RESULT ${JSON.stringify(result)}`);
  return result;
}

async function runWakeSequenceProbe() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("main window is not available");
  const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (predicate, timeout) => {
        const started = performance.now();
        let value = null;
        while (performance.now() - started < timeout) {
          value = predicate();
          if (value?.ready) return value;
          await sleep(50);
        }
        return value || predicate();
      };
      const ready = await waitFor(() => ({
        ready: Boolean(
          window.__jarvisUiProbe?.acceptWakeText
          && window.__jarvisUiProbe?.getWakeMetrics
          && window.jarvisVoice?.stop
          && window.jarvisVoice?.isActive?.()
          && window.jarvisVoice?.getDiagnostics?.()?.cloudReadyState === 1
        ),
      }), 12000);
      if (!ready.ready) return { ok: false, error: "wake probe bridge unavailable" };
      let wakeAsset = null;
      try {
        const response = await fetch("./audio/wake-greeting.wav");
        const blob = await response.blob();
        wakeAsset = { ok: response.ok, status: response.status, size: blob.size };
      } catch (error) {
        wakeAsset = { ok: false, error: error.message || String(error) };
      }
      const accepted = window.__jarvisUiProbe.acceptWakeText("Hi Jarvis");
      const firstSpeech = await waitFor(() => {
        const metrics = window.__jarvisUiProbe.getWakeMetrics();
        return { ready: Boolean(metrics.firstSpeechAt), metrics };
      }, 5000);
      const completed = await waitFor(() => {
        const metrics = window.__jarvisUiProbe.getWakeMetrics();
        return { ready: Boolean(metrics.narrationCompletedAt), metrics };
      }, 30000);
      const monitoring = await waitFor(() => {
        const metrics = window.__jarvisUiProbe.getWakeMetrics();
        return { ready: Boolean(metrics.monitorRequestedAt && window.jarvisVoice?.isMonitoring?.() && !window.jarvisVoice?.isActive?.()), metrics };
      }, 5000);
      const metrics = monitoring.metrics || completed.metrics || firstSpeech.metrics || {};
      const firstSpeechDelayMs = Math.round((metrics.firstSpeechAt || 0) - (metrics.acceptedAt || 0));
      const workbenchActive = document.querySelector(".monitor-stage")?.classList.contains("mode-active") || false;
      const monitorDelayMs = Math.round((metrics.monitorRequestedAt || 0) - (metrics.narrationCompletedAt || 0));
      return {
        ok: Boolean(
          accepted
          && firstSpeech.ready
          && firstSpeechDelayMs >= 900
          && firstSpeechDelayMs <= 1400
          && completed.ready
          && monitoring.ready
          && monitorDelayMs >= 0
          && monitorDelayMs <= 700
          && workbenchActive
        ),
        accepted,
        firstSpeechDelayMs,
        monitorDelayMs,
        workbenchActive,
        wakeAsset,
        errorText: document.querySelector(".error-banner")?.textContent?.trim() || "",
        metrics,
      };
    })();
  `, true);
  console.log(`JARVIS_WAKE_SEQUENCE_PROBE_RESULT ${JSON.stringify(result)}`);
  return result;
}

async function runLayoutProbe() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("main window is not available");
  const outputDir = process.env.JARVIS_LAYOUT_OUTPUT
    ? path.resolve(process.env.JARVIS_LAYOUT_OUTPUT)
    : path.join(runtimeRoot, "layout-probe");
  fs.mkdirSync(outputDir, { recursive: true });

  await mainWindow.webContents.executeJavaScript(`window.__jarvisUiProbe?.enterWorkbench?.()`, true);
  await new Promise((resolve) => setTimeout(resolve, 900));
  const viewports = [
    { id: "minimum", width: 1060, height: 720 },
    { id: "standard", width: 1380, height: 880 },
  ];
  const snapshots = [];

  for (const viewport of viewports) {
    mainWindow.setSize(viewport.width, viewport.height, false);
    mainWindow.center();
    await new Promise((resolve) => setTimeout(resolve, 450));
    const snapshot = await mainWindow.webContents.executeJavaScript(`
      (() => {
        const selectors = {
          stage: ".monitor-stage",
          terminal: ".hud-terminal",
          workbench: ".jarvis-workbench",
            capabilities: ".capability-status",
          news: ".news-ticker",
          command: ".command-dock",
          modules: ".module-strip",
          clock: ".workbench-clock",
          portrait: ".agent-portrait",
        };
        const rects = {};
        for (const [name, selector] of Object.entries(selectors)) {
          const el = document.querySelector(selector);
          const rect = el?.getBoundingClientRect();
          rects[name] = rect ? {
            left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom),
            width: Math.round(rect.width), height: Math.round(rect.height),
          } : null;
        }
        const overlap = (left, right) => {
          if (!left || !right) return 0;
          return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
            * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
        };
        const forbiddenPairs = [
          ["terminal", "workbench"], ["workbench", "capabilities"], ["terminal", "command"],
          ["capabilities", "command"], ["capabilities", "news"], ["news", "command"], ["news", "modules"], ["terminal", "news"], ["modules", "command"], ["terminal", "modules"],
          ["clock", "terminal"], ["clock", "workbench"], ["clock", "capabilities"],
        ];
        const overlaps = forbiddenPairs.map(([a, b]) => ({ pair: a + ":" + b, area: overlap(rects[a], rects[b]) })).filter(item => item.area > 0);
        const stage = rects.stage;
          const outside = Object.entries(rects).filter(([name, rect]) => !["stage", "modules"].includes(name) && rect && stage && (
          rect.left < stage.left - 1 || rect.right > stage.right + 1 || rect.top < stage.top - 1 || rect.bottom > stage.bottom + 1
        )).map(([name]) => name);
        const overflow = [...document.querySelectorAll(".command-dock button, .module-link, .signal-tile strong")]
          .filter(el => el.scrollWidth > el.clientWidth + 1)
          .map(el => ({ text: el.textContent.trim().slice(0, 40), className: el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
        const dock = document.querySelector(".command-dock");
        const dockRect = dock?.getBoundingClientRect();
        const dockChildrenOutside = dockRect ? [...dock.children].filter(child => {
          const rect = child.getBoundingClientRect();
          return rect.left < dockRect.left - 1 || rect.right > dockRect.right + 1 || rect.top < dockRect.top - 1 || rect.bottom > dockRect.bottom + 1;
        }).map(child => child.className || child.tagName) : [];
        return {
          ok: overlaps.length === 0 && outside.length === 0 && overflow.length === 0 && dockChildrenOutside.length === 0,
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          rects, overlaps, outside, overflow, dockChildrenOutside,
        };
      })();
    `, true);
    const image = await mainWindow.webContents.capturePage();
    const screenshot = path.join(outputDir, `jarvis-layout-${viewport.id}.png`);
    fs.writeFileSync(screenshot, image.toPNG());
    snapshots.push({ id: viewport.id, requested: viewport, screenshot, ...snapshot });
  }

  mainWindow.setSize(1380, 880, false);
  mainWindow.center();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const engineering = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const button = [...document.querySelectorAll(".module-link")].find((item) => item.textContent.includes("工程台"));
      button?.click();
      const started = Date.now();
      while (!document.querySelector(".engineering-console") && Date.now() - started < 4000) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      const selectors = {
        stage: ".monitor-stage",
        terminal: ".hud-terminal",
        engineering: ".engineering-console",
          capabilities: ".capability-status",
        command: ".command-dock",
        modules: ".module-strip",
      };
      const rects = {};
      for (const [name, selector] of Object.entries(selectors)) {
        const element = document.querySelector(selector);
        const style = element ? getComputedStyle(element) : null;
        const rect = element && style?.display !== "none" && style?.visibility !== "hidden"
          ? element.getBoundingClientRect()
          : null;
        rects[name] = rect ? { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) } : null;
      }
      const overlap = (left, right) => left && right
        ? Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
        : 0;
      const overlaps = ["terminal", "capabilities", "command", "modules"]
        .map((name) => ({ pair: "engineering:" + name, area: overlap(rects.engineering, rects[name]) }))
        .filter((item) => item.area > 0);
      const stage = rects.stage;
      const panel = rects.engineering;
      const outside = !stage || !panel || panel.left < stage.left || panel.right > stage.right || panel.top < stage.top || panel.bottom > stage.bottom;
      const overflow = [...document.querySelectorAll(".engineering-header *, .engineering-meta *, .engineering-command *")]
        .filter((item) => item.scrollWidth > item.clientWidth + 2 && getComputedStyle(item).textOverflow !== "ellipsis")
        .map((item) => ({ text: item.textContent.trim().slice(0, 40), className: item.className || item.tagName }));
      return {
        ok: Boolean(button && panel && overlaps.length === 0 && !outside && overflow.length === 0),
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        rects, overlaps, outside, overflow,
        stageClass: document.querySelector(".monitor-stage")?.className || "",
        engineeringStyle: panel ? { opacity: getComputedStyle(document.querySelector(".engineering-console")).opacity, visibility: getComputedStyle(document.querySelector(".engineering-console")).visibility } : null,
        workbenchStyle: { opacity: getComputedStyle(document.querySelector(".jarvis-workbench")).opacity, visibility: getComputedStyle(document.querySelector(".jarvis-workbench")).visibility },
        engineeringText: document.querySelector(".engineering-console")?.textContent?.trim().slice(0, 160) || "",
      };
    })();
  `, true);
  await new Promise((resolve) => setTimeout(resolve, 450));
  await mainWindow.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
  const engineeringImage = await mainWindow.webContents.capturePage();
  const engineeringScreenshot = path.join(outputDir, "jarvis-layout-engineering.png");
  fs.writeFileSync(engineeringScreenshot, engineeringImage.toPNG());
  snapshots.push({ id: "engineering", requested: { width: 1380, height: 880 }, screenshot: engineeringScreenshot, ...engineering });

  const result = { ok: snapshots.every(snapshot => snapshot.ok), snapshots };
  console.log(`JARVIS_LAYOUT_PROBE_RESULT ${JSON.stringify(result)}`);
  return result;
}

async function runAcuiProbe() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("main window is not available");
  const outputDir = process.env.JARVIS_ACUI_OUTPUT
    ? path.resolve(process.env.JARVIS_ACUI_OUTPUT)
    : path.join(runtimeRoot, "acui-probe");
  fs.mkdirSync(outputDir, { recursive: true });

  await mainWindow.webContents.executeJavaScript(`window.__jarvisUiProbe?.enterWorkbench?.()`, true);
  const connected = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const started = Date.now();
      while (Date.now() - started < 10000) {
        const marker = document.querySelector(".acui-connection-marker, .acui-result-layer");
        if (marker?.dataset.connected === "true") return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    })();
  `, true);
  if (!connected) throw new Error("ACUI workbench client did not connect");
  const active = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const started = Date.now();
      while (Date.now() - started < 5000) {
        if (document.querySelector(".monitor-stage")?.classList.contains("mode-active")) return true;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      return false;
    })();
  `, true);
  if (!active) throw new Error("workbench did not finish entering active mode");
  mainWindow.setSize(1060, 720, false);
  mainWindow.center();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const [events, uiTools] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, "src", "core", "events.js")).href),
    import(pathToFileURL(path.join(ROOT, "src", "core", "capabilities", "tools", "ui.js")).href),
  ]);
  const mount = (id, component, props, mode = "") => {
    events.addActiveUICard(id, { component: component || mode });
    return events.emitUICommand({
      op: "mount",
      id,
      ...(component ? { component } : {}),
      ...(mode ? { mode, code: "window.__acuiProbeExecuted = true" } : {}),
      props,
      hint: { placement: "notification", size: "md" },
    });
  };

  const weatherResult = JSON.parse(uiTools.execUIShow({ component: "WeatherCard", props: {
    city: "Shanghai",
    temp: "31",
    condition: "Cloudy",
    feel: 34,
    high: 33,
    low: 27,
    forecast: [{ day: "Today", high: 33 }, { day: "Tomorrow", high: 32 }],
  } }));
  if (!weatherResult.ok) throw new Error(`ui_show failed: ${weatherResult.error || "unknown"}`);
  const weatherId = weatherResult.id;
  await new Promise((resolve) => setTimeout(resolve, 300));
  uiTools.execUIUpdate({ id: weatherId, props: { temp: 29 } });
  uiTools.execUIPatch({ id: weatherId, op: "merge", data: { wind: "SE 3" } });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`, true);
  const weatherUpdated = await mainWindow.webContents.executeJavaScript(`
    (() => {
      const card = [...document.querySelectorAll(".acui-result-card")].find((item) => /WeatherCard/.test(item.getAttribute("aria-label") || ""));
      return Boolean(card && /Shanghai/.test(card.textContent) && /29/.test(card.textContent) && /SE 3/.test(card.textContent));
    })();
  `, true);
  const weatherImage = await mainWindow.webContents.capturePage();
  const weatherScreenshot = path.join(outputDir, "jarvis-acui-weather.png");
  fs.writeFileSync(weatherScreenshot, weatherImage.toPNG());

  mount("probe-inline", "", { label: "untrusted" }, "inline-script");
  mount("probe-one", "SelfCheckStepCard", { step: 1, total: 4, name: "Core" });
  mount("probe-two", "AwakeningCard", { index: 2, total: 3, title: "Voice", finding: "Ready" });
  mount("probe-three", "SelfCheckCard", { results: [{ name: "ASR", status: "ok" }], overall: "Ready" });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`, true);

  const beforeClose = await mainWindow.webContents.executeJavaScript(`
    (() => {
      const stage = document.querySelector(".monitor-stage")?.getBoundingClientRect();
      const layer = document.querySelector(".acui-result-layer")?.getBoundingClientRect();
      const capabilities = document.querySelector(".capability-strip")?.getBoundingClientRect();
      const command = document.querySelector(".command-dock")?.getBoundingClientRect();
      const cards = [...document.querySelectorAll(".acui-result-card")];
      const overlap = (a, b) => !a || !b ? 0 : Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return {
        count: cards.length,
        labels: cards.map((card) => card.getAttribute("aria-label")),
        text: cards.map((card) => card.textContent.replace(/\\s+/g, " ").trim()),
        safeInline: cards.some((card) => /not executed/.test(card.textContent)),
        codeExecuted: window.__acuiProbeExecuted === true,
        closeButtons: cards.filter((card) => card.querySelector("button[aria-label^='Close']")).length,
        bodiesVisible: cards.every((card) => (card.querySelector(".acui-card-body")?.getBoundingClientRect().height || 0) > 0),
        layerScrollable: Boolean(document.querySelector(".acui-result-layer")?.scrollHeight > document.querySelector(".acui-result-layer")?.clientHeight),
        outsideStage: !stage || !layer || layer.left < stage.left - 1 || layer.right > stage.right + 1 || layer.top < stage.top - 1 || layer.bottom > stage.bottom + 1,
        capabilityOverlap: overlap(layer, capabilities),
        commandOverlap: overlap(layer, command),
        overflow: cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length,
      };
    })();
  `, true);

  const image = await mainWindow.webContents.capturePage();
  const screenshot = path.join(outputDir, "jarvis-acui-workbench.png");
  fs.writeFileSync(screenshot, image.toPNG());

  const dismissedId = await mainWindow.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector(".acui-result-card button[aria-label^='Close']");
      const card = button?.closest(".acui-result-card");
      const id = card?.getAttribute("aria-label") || "";
      button?.click();
      return id;
    })();
  `, true);
  await new Promise((resolve) => setTimeout(resolve, 250));
  events.emitUICommand({ op: "unmount", id: "probe-three" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterClose = await mainWindow.webContents.executeJavaScript(`({ count: document.querySelectorAll(".acui-result-card").length })`, true);
  const activeCards = events.getActiveUICards().filter((card) => String(card.id).startsWith("probe-"));

  const result = {
    ok: beforeClose.count === 4
      && weatherUpdated
      && beforeClose.safeInline
      && !beforeClose.codeExecuted
      && beforeClose.closeButtons === 4
      && beforeClose.bodiesVisible
      && beforeClose.layerScrollable
      && !beforeClose.outsideStage
      && beforeClose.capabilityOverlap === 0
      && beforeClose.commandOverlap === 0
      && beforeClose.overflow === 0
      && afterClose.count === 2
      && activeCards.length === 2,
    connected,
    weatherUpdated,
    beforeClose,
    dismissedId,
    afterClose,
    activeCards,
    screenshot,
    weatherScreenshot,
  };
  console.log(`JARVIS_ACUI_PROBE_RESULT ${JSON.stringify(result)}`);
  return result;
}

async function runTurnLifecycleProbe() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("main window is not available");
  const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const settle = async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await sleep(20);
      };
      const started = Date.now();
      while (!window.__jarvisTurnProbe && Date.now() - started < 10000) await sleep(80);
      if (!window.__jarvisTurnProbe) return { ok: false, error: "turn probe bridge unavailable" };

      window.__jarvisUiProbe?.enterWorkbench?.();
      await sleep(700);
      try { window.jarvisVoice?.stop?.(); } catch {}
      await sleep(150);
      const token = window.__jarvisTurnProbe.begin({ voice: false, withPoll: true });
      await settle();

      window.__jarvisTurnProbe.emit("stream_start", { plainReply: false });
      window.__jarvisTurnProbe.emit("stream_chunk", { text: "SECRET_BACKGROUND_CHUNK" });
      await settle();
      const background = window.__jarvisTurnProbe.snapshot();

      window.__jarvisTurnProbe.emit("stream_start", { plainReply: true });
      window.__jarvisTurnProbe.emit("stream_chunk", { text: "Hello " });
      window.__jarvisTurnProbe.emit("stream_chunk", { text: "world" });
      await settle();
      const visible = window.__jarvisTurnProbe.snapshot();

      window.__jarvisTurnProbe.emit("tool_call", { name: "send_message", args: { content: "progress acknowledgement" } });
      await settle();
      const afterToolCall = window.__jarvisTurnProbe.snapshot();

      window.__jarvisTurnProbe.emit("protocol_violation", { reason: "missing_send_message_fallback_delivered" });
      await settle();
      const afterDeliveredTelemetry = window.__jarvisTurnProbe.snapshot();

      window.__jarvisTurnProbe.emit("stream_end", {});
      window.__jarvisTurnProbe.emit("response", { content: "Final answer" });
      await settle();
      const completed = window.__jarvisTurnProbe.snapshot();

      window.__jarvisTurnProbe.emit("response", { content: "Duplicate final answer" });
      await settle();
      const duplicate = window.__jarvisTurnProbe.snapshot();

      const errorToken = window.__jarvisTurnProbe.begin({ voice: false, withPoll: true });
      await settle();
      window.__jarvisTurnProbe.emit("error", { error: "Synthetic runtime failure" });
      await settle();
      const failed = window.__jarvisTurnProbe.snapshot();

      await window.__jarvisTurnProbe.speakAndResume();
      await settle();
      const afterSpeech = window.__jarvisTurnProbe.snapshot();
      await sleep(1250);
      const resumedVoice = window.__jarvisTurnProbe.snapshot();
      const resumeDelayMs = Math.round((resumedVoice.postReplyListenMetrics?.startedAt || 0) - (resumedVoice.postReplyListenMetrics?.scheduledAt || 0));

      const hasText = (snapshot, value) => snapshot.messages.some((item) => String(item.content || "").includes(value));
      return {
        ok: !hasText(background, "SECRET_BACKGROUND_CHUNK")
          && hasText(visible, "Hello world")
          && afterToolCall.activeTurn?.token === token
          && afterToolCall.sending
          && afterToolCall.pollActive
          && afterDeliveredTelemetry.activeTurn?.token === token
          && afterDeliveredTelemetry.lastError === afterToolCall.lastError
          && completed.activeTurn === null
          && !completed.sending
          && !completed.pollActive
          && !completed.visibleStream
          && duplicate.activeTurn === null
          && !duplicate.sending
          && failed.activeTurn === null
          && !failed.sending
          && !failed.pollActive
          && failed.lastError === "Synthetic runtime failure"
          && resumeDelayMs >= 850
          && resumeDelayMs <= 1400
          && resumedVoice.voiceActive,
        token,
        errorToken,
        background: { leaked: hasText(background, "SECRET_BACKGROUND_CHUNK"), sending: background.sending },
        visible: { rendered: hasText(visible, "Hello world"), visibleStream: visible.visibleStream, messages: visible.messages },
        afterToolCall: { active: afterToolCall.activeTurn?.token === token, sending: afterToolCall.sending, pollActive: afterToolCall.pollActive, lastError: afterToolCall.lastError },
        afterDeliveredTelemetry: { active: afterDeliveredTelemetry.activeTurn?.token === token, lastError: afterDeliveredTelemetry.lastError },
        completed: { activeTurn: completed.activeTurn, sending: completed.sending, pollActive: completed.pollActive, visibleStream: completed.visibleStream },
        duplicate: { activeTurn: duplicate.activeTurn, sending: duplicate.sending },
        failed: { activeTurn: failed.activeTurn, sending: failed.sending, pollActive: failed.pollActive, lastError: failed.lastError },
        voiceResume: {
          immediatelyActive: afterSpeech.voiceActive,
          statusAfterSpeech: afterSpeech.voiceStatusText,
          activeAfter1250ms: resumedVoice.voiceActive,
          statusAfter1250ms: resumedVoice.voiceStatusText,
          resumeDelayMs,
        },
      };
    })();
  `, true);
  console.log(`JARVIS_TURN_LIFECYCLE_PROBE_RESULT ${JSON.stringify(result)}`);
  return result;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log("single-instance-lock-failed");
  app.exit(0);
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  log("app-ready");
  Menu.setApplicationMenu(null);

  try {
    backendPort = await findFreePort(Number(process.env.JARVIS_PORT || 3721));
  } catch (error) {
    log("backend-port-failed", error.stack || error.message || String(error));
    dialog.showErrorBox("Jarvis startup failed", error.message || String(error));
    app.quit();
    return;
  }

  await createWindow();
  log("window-created");

  try {
    log("starting-jarvis-core", String(backendPort));
    await bootstrapJarvisCore(backendPort);
    await waitForBackend(backendPort);
    log("backend-health-ok", String(backendPort));
  } catch (error) {
    log("backend-failed", error.stack || error.message || String(error));
    dialog.showErrorBox("Jarvis startup failed", error.message || String(error));
    app.quit();
    return;
  }

  if (IS_DESKTOP_CLOSE_PROBE) {
    console.log("JARVIS_DESKTOP_CLOSE_PROBE_READY");
    mainWindow.close();
    return;
  }

  if (IS_WAKE_SEQUENCE_PROBE) {
    try {
      const result = await runWakeSequenceProbe();
      app.exit(result.ok ? 0 : 1);
    } catch (error) {
      console.error(`JARVIS_WAKE_SEQUENCE_PROBE_RESULT ${JSON.stringify({ ok: false, error: error.message || String(error) })}`);
      app.exit(1);
    }
    return;
  }

  if (IS_ACUI_PROBE) {
    try {
      const result = await runAcuiProbe();
      app.exit(result.ok ? 0 : 1);
    } catch (error) {
      console.error(`JARVIS_ACUI_PROBE_RESULT ${JSON.stringify({ ok: false, error: error.message || String(error) })}`);
      app.exit(1);
    }
    return;
  }

  if (IS_TURN_LIFECYCLE_PROBE) {
    try {
      const result = await runTurnLifecycleProbe();
      app.exit(result.ok ? 0 : 1);
    } catch (error) {
      console.error(`JARVIS_TURN_LIFECYCLE_PROBE_RESULT ${JSON.stringify({ ok: false, error: error.message || String(error) })}`);
      app.exit(1);
    }
    return;
  }

  if (IS_LAYOUT_PROBE) {
    try {
      const result = await runLayoutProbe();
      app.exit(result.ok ? 0 : 1);
    } catch (error) {
      console.error(`JARVIS_LAYOUT_PROBE_RESULT ${JSON.stringify({ ok: false, error: error.message || String(error) })}`);
      app.exit(1);
    }
    return;
  }

  if (IS_DESKTOP_PROBE) {
    try {
      const result = await runDesktopProbe();
      app.exit(result.ok ? 0 : 1);
    } catch (error) {
      console.error(`JARVIS_DESKTOP_PROBE_RESULT ${JSON.stringify({ ok: false, error: error.message || String(error) })}`);
      app.exit(1);
    }
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendPort) {
    await createWindow();
  }
});
