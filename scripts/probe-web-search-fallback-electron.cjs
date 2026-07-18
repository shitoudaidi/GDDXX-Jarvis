const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");

const root = path.resolve(__dirname, "..");
const coreEntry = path.join(root, "src", "core", "index.js");

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

app.whenReady().then(async () => {
  const port = await findFreePort();
  const userDir = path.join(os.tmpdir(), `jarvis-web-search-${Date.now()}`);

  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_HOST = "127.0.0.1";
  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_PORT = String(port);
  process.env.JARVIS_USER_DIR = userDir;
  process.env.JARVIS_USER_DIR = userDir;
  process.env.JARVIS_RESOURCES_DIR = root;
  process.env.JARVIS_RESOURCES_DIR = root;
  process.env.JARVIS_DISABLE_SOCIAL = "1";
  process.env.JARVIS_DISABLE_SOCIAL = "1";
  process.env.SERPER_API_KEY = "";
  process.env.BRAVE_API_KEY = "";
  process.env.TAVILY_API_KEY = "";
  process.env.JINA_API_KEY = "";
  process.env.SEARXNG_URL = "";

  try {
    await import(pathToFileURL(coreEntry).href);
    const { executeTool } = await import(pathToFileURL(path.join(root, "src", "core", "capabilities", "executor.js")).href);
    const raw = await executeTool("web_search", { query: "OpenAI official website", limit: 3 }, {});
    const parsed = JSON.parse(raw);
    const result = {
      ok: !!parsed.ok && Array.isArray(parsed.results) && parsed.results.length > 0,
      runtime: "electron",
      source: parsed.source || null,
      count: parsed.results?.length || 0,
      first: parsed.results?.[0] ? {
        title: parsed.results[0].title,
        url: parsed.results[0].url,
      } : null,
      error: parsed.error || null,
      failures: parsed.failures || [],
    };
    console.log(`JARVIS_WEB_SEARCH_FALLBACK_RESULT ${JSON.stringify(result)}`);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.log(`JARVIS_WEB_SEARCH_FALLBACK_RESULT ${JSON.stringify({
      ok: false,
      runtime: "electron",
      error: error.message || String(error),
    })}`);
    app.exit(1);
  }
});
