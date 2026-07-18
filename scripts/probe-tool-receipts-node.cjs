const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const userDir = process.env.JARVIS_USER_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tool-receipts-"));
let shouldCleanup = !process.env.JARVIS_USER_DIR;

process.env.JARVIS_DISABLE_SOCIAL = "1";
process.env.JARVIS_DISABLE_SOCIAL = "1";
process.env.JARVIS_USER_DIR = userDir;
process.env.JARVIS_USER_DIR = process.env.JARVIS_USER_DIR || userDir;

function parseSsePayload(chunk) {
  const text = String(chunk || "");
  const match = text.match(/^data:\s*(\{[\s\S]*\})\s*$/m);
  if (!match) return null;
  return JSON.parse(match[1]);
}

(async () => {
  const captured = [];
  const events = await import("../src/core/events.js");
  const { executeTool } = await import("../src/core/capabilities/executor.js");

  const fakeClient = {
    write(chunk) {
      const payload = parseSsePayload(chunk);
      if (payload) captured.push(payload);
    },
  };

  events.addSSEClient(fakeClient);
  const result = await executeTool("list_dir", { path: "." }, { source: "probe" });
  events.removeSSEClient(fakeClient);

  const started = captured.find((event) => event.type === "tool_started" && event.data?.tool === "list_dir");
  const audited = captured.find((event) => event.type === "tool_audit" && event.data?.tool === "list_dir");
  const matchingId = !!started?.data?.id && started.data.id === audited?.data?.id;
  const hasReadableSummary = typeof started?.data?.summary === "string" && started.data.summary.includes("列出目录");
  const hasResultPreview = typeof audited?.data?.result_preview === "string" && audited.data.result_preview.includes("目录");

  const output = {
    ok: !!started && !!audited && matchingId && audited.data?.status === "ok" && hasReadableSummary && hasResultPreview,
    events: captured.map((event) => ({
      type: event.type,
      id: event.data?.id || "",
      tool: event.data?.tool || event.data?.name || "",
      status: event.data?.status || "",
      summary: event.data?.summary || "",
      result_preview: event.data?.result_preview || "",
    })),
    matchingId,
    resultPreview: String(result || "").slice(0, 120),
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (shouldCleanup) {
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  }
  process.exit(output.ok ? 0 : 1);
})().catch((error) => {
  if (shouldCleanup) {
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  }
  console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2));
  process.exit(1);
});
