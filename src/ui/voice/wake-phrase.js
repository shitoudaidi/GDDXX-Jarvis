const STRONG_TOKENS = [
  "jarvis", "javis", "jarviss",
  "贾维斯", "加维斯", "扎维斯", "嘉维斯", "假维斯", "佳维斯", "家维斯",
  "杰维斯", "贾维思", "贾威斯", "贾伟思", "杰维思", "贾维丝", "贾维司",
  "佳伟斯", "家伟斯", "扎维丝", "扎维思", "扎维司", "炸维斯", "查维斯",
  "贾维士", "加微斯", "佳微斯", "嘉微斯", "贾薇斯", "賈維斯"
];

const RISKY_TOKENS = ["jervis", "travis", "贾维", "加维", "嘉维", "扎维", "小贾", "海贾"];
const PREFIXES = [
  "hi", "hey", "hello", "yo",
  "嗨", "嘿", "哈", "喂", "哎", "你好", "您好", "早上好", "下午好", "晚上好"
];

export function normalizeWakeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s"'`~!@#$%^&*()_+\-=[\]{};:,.<>/?\\|，。！？、；：“”‘’（）【】《》…—]/g, "")
    .trim();
}

export function isWakePhrase(value, { loose = false } = {}) {
  const compact = normalizeWakeText(value);
  if (!compact) return false;
  const hasPrefix = PREFIXES.some((prefix) => compact.includes(normalizeWakeText(prefix)));
  if (STRONG_TOKENS.some((token) => compact.includes(normalizeWakeText(token)))) return true;
  if (hasPrefix && RISKY_TOKENS.some((token) => compact.includes(normalizeWakeText(token)))) return true;
  if (!loose) return false;

  // Partial Chinese hypotheses are accepted only as short utterances. This keeps
  // "扎维" usable without waking on a longer sentence about an unrelated person.
  if (compact.length <= 5 && /(?:贾|加|扎|嘉|假|家|杰).{0,1}(?:维|威|薇)(?:斯|思|丝|司|士)?/u.test(compact)) return true;
  if (hasPrefix && /(?:jarv|jerv|trav)/i.test(compact)) return true;
  return false;
}

export const WAKE_PHRASE_FIXTURES = Object.freeze({
  accepted: [
    "嗨，贾维斯", "你好贾维斯", "早上好，贾维斯", "晚上好加微斯", "喂，扎维思",
    "Hi Jarvis", "Hey Jervis", "Hello Travis", "贾维", "賈維斯"
  ],
  rejected: [
    "介绍一下 Travis Scott", "我刚才见到 Travis", "hello john", "这篇文章讲维斯塔", "嘉维是一位同事"
  ]
});
