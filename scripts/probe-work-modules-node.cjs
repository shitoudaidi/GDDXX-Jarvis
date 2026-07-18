const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const coreEntry = path.join(root, "src", "core", "index.js");
const dbEntry = path.join(root, "src", "core", "db.js");
let port = Number(process.env.JARVIS_PORT || process.env.JARVIS_PORT || 0);

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(found));
    });
  });
}

function requestJson(pathname, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : "";
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: body ? {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      } : {},
      timeout: options.timeout || 5000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: res.statusCode, data, text });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`timeout ${method} ${pathname}`)));
    if (body) req.write(body);
    req.end();
  });
}

function waitForHttp(timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await requestJson("/activation-status", { timeout: 1200 });
        if (res.status >= 200 && res.status < 500) return resolve();
      } catch {}
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`core did not become ready on port ${port}`));
        return;
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

(async () => {
  if (!port) port = await findFreePort();

  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_DISABLE_SOCIAL = "1";
  process.env.JARVIS_DISABLE_SOCIAL = "1";
  process.env.JARVIS_RESOURCES_DIR = root;
  process.env.JARVIS_RESOURCES_DIR = root;

  try {
    await import(pathToFileURL(coreEntry).href);
    await waitForHttp();

    const db = await import(pathToFileURL(dbEntry).href);
    const dueAt = new Date(Date.now() + 60_000).toISOString();
    db.createReminder({
      userId: "probe-user",
      dueAt,
      task: "probe work module reminder",
      systemMessage: "probe work module reminder",
      source: "probe:work-modules"
    });
    db.upsertPrefetchTask({
      source: "probe-work-modules",
      label: "Probe Work Modules",
      url: "https://example.com/probe-work-modules",
      ttlMinutes: 15,
      tags: ["probe", "work-modules"]
    });

    const apiReminder = await requestJson("/reminders", {
      method: "POST",
      body: {
        task: "probe api reminder",
        dueAt: new Date(Date.now() + 120_000).toISOString()
      }
    });
    const apiReminderId = apiReminder.data?.reminder?.id;
    const overview = await requestJson("/tasks/overview?limit=8");
    const cancelReminder = apiReminderId
      ? await requestJson(`/reminders/${apiReminderId}`, { method: "DELETE" })
      : { status: 0, data: null };
    const memories = await requestJson("/memories?limit=2");
    const capabilities = await requestJson("/capabilities");

    const data = overview.data || {};
    const hasReminder = (data.reminders || []).some((item) => item.task === "probe work module reminder");
    const hasApiReminder = (data.reminders || []).some((item) => item.task === "probe api reminder");
    const hasPrefetch = (data.prefetchTasks || []).some((item) => item.source === "probe-work-modules");
    const result = {
      ok: overview.status === 200
        && apiReminder.status === 200
        && cancelReminder.status === 200
        && data.ok === true
        && Array.isArray(data.reminders)
        && Array.isArray(data.taskKnowledge)
        && Array.isArray(data.prefetchTasks)
        && data.queue
        && hasReminder
        && hasApiReminder
        && hasPrefetch
        && memories.status === 200
        && capabilities.status === 200,
      port,
      endpoints: {
        reminderCreate: apiReminder.status,
        reminderCancel: cancelReminder.status,
        tasksOverview: overview.status,
        memories: memories.status,
        capabilities: capabilities.status,
      },
      counts: {
        reminders: data.reminders?.length || 0,
        taskKnowledge: data.taskKnowledge?.length || 0,
        prefetchTasks: data.prefetchTasks?.length || 0,
      },
      hasReminder,
      hasApiReminder,
      hasPrefetch,
    };

    console.log(`JARVIS_WORK_MODULES_RESULT ${JSON.stringify(result)}`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`JARVIS_WORK_MODULES_RESULT ${JSON.stringify({
      ok: false,
      port,
      error: error.message || String(error),
    })}`);
    process.exit(1);
  }
})();
