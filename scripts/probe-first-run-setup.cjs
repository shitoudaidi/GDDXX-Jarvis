const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "ui", "jarvis-react", "src", "main.jsx"), "utf8");

const checks = [
  ["first-run setup component exists", /function FirstRunSetup\(/.test(source)],
  ["inactive activation gates the workbench", /activation !== null && !activation\?\.activated/.test(source)],
  ["setup requires an API key", /请输入模型服务 API Key/.test(source)],
  ["setup requires a model", /请输入模型名称/.test(source)],
  ["setup offers local voice", /value="local"/.test(source) && /语音在电脑上处理/.test(source)],
  ["setup offers Aliyun voice", /value="aliyun"/.test(source) && /DashScope API Key/.test(source)],
  ["setup activates the model", /fetch\(`\$\{api\}\/activate`/.test(source)],
  ["setup persists voice settings", /fetch\(`\$\{api\}\/settings\/voice`/.test(source)],
  ["setup blocks synchronous duplicate submissions", /submitLockRef\.current/.test(source)],
  ["setup validates and focuses missing fields", /modelRef\.current\?\.focus/.test(source) && /baseURLRef\.current\?\.focus/.test(source)],
  ["custom providers require a valid Base URL", /new URL\(baseURL\.trim\(\)\)/.test(source)],
  ["provider changes reset incompatible defaults", /setModel\(next === "deepseek" \? "deepseek-chat" : ""\)/.test(source)],
  ["model and voice keys can be revealed intentionally", /showModelKey/.test(source) && /showVoiceKey/.test(source) && /EyeOff/.test(source)],
  ["credential fields avoid ordinary autofill", (source.match(/autoComplete="new-password"/g) || []).length >= 2],
  ["voice is saved before model activation", source.indexOf('fetch(`${api}/settings/voice`') < source.indexOf('fetch(`${api}/activate`')],
  ["setup requests have bounded timeouts", /AbortSignal\.timeout\(15_000\)/.test(source) && /AbortSignal\.timeout\(20_000\)/.test(source)],
  ["timeout errors identify the active setup step", /savingStepRef\.current/.test(source) && /超时，请检查网络后重试/.test(source)],
  ["setup progress is announced", /first-run-progress/.test(source) && /aria-live="polite"/.test(source)],
];

for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
}

if (checks.some(([, ok]) => !ok)) process.exit(1);
