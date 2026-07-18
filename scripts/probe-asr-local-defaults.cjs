const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  path.join(root, "src", "ui", "voice", "voice-core.js"),
  path.join(root, "src", "ui", "jarvis-react", "src", "main.jsx"),
];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const source = Object.fromEntries(files.map((file) => [file, read(file)]));
const checks = [
  {
    name: "Jarvis shell stores local Whisper as ASR provider",
    file: files[1],
    ok: /const VOICE_PROVIDER_KEY = "jarvis-voice-provider"/.test(source[files[1]])
      && /localStorage\.setItem\(VOICE_PROVIDER_KEY,\s*voiceProvider\)/.test(source[files[1]]),
  },
  {
    name: "React voice core defaults ASR provider to local",
    file: files[0],
    ok: /localStorage\.getItem\(VOICE_PROVIDER_KEY\) \|\| 'local'/.test(source[files[0]])
      && !/localStorage\.getItem\(VOICE_PROVIDER_KEY\) \|\| 'aliyun'/.test(source[files[0]]),
  },
];

const result = {
  ok: checks.every((check) => check.ok),
  checks: checks.map((check) => ({
    name: check.name,
    ok: check.ok,
    file: path.relative(root, check.file).replace(/\\/g, "/"),
  })),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
