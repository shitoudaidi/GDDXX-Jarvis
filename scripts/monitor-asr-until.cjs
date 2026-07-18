const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const target = process.argv[2] || "20:00";
const intervalSec = Math.max(20, Number(process.argv[3] || 180));
const logDir = path.join(root, "logs");
fs.mkdirSync(logDir, { recursive: true });

function parseTargetTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid target time: ${value}`);
  const now = new Date();
  const targetDate = new Date(now);
  targetDate.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (targetDate <= now) targetDate.setDate(targetDate.getDate() + 1);
  return targetDate;
}

function timestampForFile(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, timeoutMs) {
  const startedAt = Date.now();
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  let parsed = null;
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const jsonMatch = output.match(/\{[\s\S]*\}\s*$/);
  if (jsonMatch) {
    try { parsed = JSON.parse(jsonMatch[0]); } catch {}
  }
  return {
    code: result.status,
    signal: result.signal || null,
    durationMs: Date.now() - startedAt,
    parsed,
    outputTail: output.split(/\r?\n/).slice(-20),
    error: result.error ? result.error.message : null,
  };
}

async function main() {
  const until = parseTargetTime(target);
  const logFile = path.join(logDir, `asr-monitor-${timestampForFile()}.jsonl`);
  let round = 0;
  const header = {
    type: "start",
    startedAt: new Date().toISOString(),
    until: until.toISOString(),
    intervalSec,
    logFile,
  };
  fs.appendFileSync(logFile, `${JSON.stringify(header)}\n`, "utf8");
  console.log(JSON.stringify(header, null, 2));

  while (Date.now() < until.getTime()) {
    round += 1;
    const asr = runCommand(process.execPath, [path.join("scripts", "probe-asr-real-audio.cjs")], 45000);
    const product = round % 5 === 0
      ? runCommand(process.execPath, [path.join("scripts", "probe-product-quality.cjs")], 45000)
      : null;
    const row = {
      type: "round",
      round,
      at: new Date().toISOString(),
      ok: Boolean(asr.parsed?.ok) && (!product || Boolean(product.parsed?.ok)),
      asr: asr.parsed || { ok: false, code: asr.code, signal: asr.signal, error: asr.error, outputTail: asr.outputTail },
      product: product ? (product.parsed || { ok: false, code: product.code, signal: product.signal, error: product.error, outputTail: product.outputTail }) : null,
    };
    fs.appendFileSync(logFile, `${JSON.stringify(row)}\n`, "utf8");
    console.log(JSON.stringify(row, null, 2));

    const remainingMs = until.getTime() - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(intervalSec * 1000, remainingMs));
  }

  const footer = { type: "complete", completedAt: new Date().toISOString(), rounds: round, logFile };
  fs.appendFileSync(logFile, `${JSON.stringify(footer)}\n`, "utf8");
  console.log(JSON.stringify(footer, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ type: "fatal", ok: false, error: error.message }, null, 2));
  process.exit(1);
});
