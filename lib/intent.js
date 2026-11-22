/* ============================================================
 * intent.js —— 本地意图识别引擎（零依赖）
 * 把用户的自然语言解析成结构化意图，供对话界面执行。
 * 识别：问候 / 列应用 / 打开应用 / 搜知识 / 问答 / 统计 / 帮助 / 推荐
 * ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.IntentEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 意图定义与关键词（中文为主，兼顾英文）
  const PATTERNS = [
    { intent: "greeting", words: ["你好", "您好", "hi", "hello", "嗨", "哈喽", "早上好", "下午好", "晚上好", "在吗", "hey"] },
    { intent: "help", words: ["帮助", "能做什么", "会什么", "怎么用", "使用说明", "help", "功能", "你能干嘛", "介绍"] },
    { intent: "list_apps", words: ["有哪些应用", "什么应用", "所有应用", "列出应用", "应用列表", "我的应用", "应用目录", "有什么应用", "都有啥", "看应用", "显示应用", "apps"] },
    { intent: "open_app", words: ["打开", "启动", "运行", "进入", "用一下", "用下", "开启", "open", "launch"] },
    { intent: "stats", words: ["多少", "几个", "统计", "数量", "有多少", "总共", "概况", "汇总", "规模"] },
    { intent: "recommend", words: ["推荐", "建议", "看点", "读点", "学点", "有什么值得", "最近有什么", "最新的"] },
    { intent: "search", words: ["搜索", "查", "查找", "找", "搜", "检索", "搜一下", "查一下", "找一下", "search", "query"] }
  ];

  const STOP_WORDS = new Set(["我", "的", "了", "吗", "呢", "啊", "吧", "请", "帮我", "一下", "给我", "那个", "这个", "和", "与", "以及", "关于", "请问", "我想", "我要"]);

  function normalize(text) {
    return String(text || "").toLowerCase().trim();
  }

  function scoreIntent(text) {
    const t = normalize(text);
    const scores = [];
    for (const p of PATTERNS) {
      let score = 0;
      for (const w of p.words) {
        const lw = w.toLowerCase();
        if (t === lw) score += 3;
        else if (t.startsWith(lw) || t.endsWith(lw)) score += 2;
        else if (t.includes(lw)) score += 1;
      }
      if (score > 0) scores.push({ intent: p.intent, score });
    }
    scores.sort((a, b) => b.score - a.score);
    return scores;
  }

  // 提取要打开/搜索的关键词
  function extractTopic(text) {
    let t = normalize(text);
    const triggers = ["打开", "启动", "运行", "进入", "用一下", "用下", "开启", "搜索", "查一下", "查", "搜一下", "搜", "找一下", "找", "推荐", "关于", "请问", "我想了解", "我想知道", "帮我", "给我", "open", "search"];
    triggers.forEach(w => { t = t.split(w).join(" "); });
    t = t.replace(/[?？。，,!！、\s]+/g, " ").trim();
    // 去掉停用词
    let tokens = t.split(/\s+/).filter(Boolean);
    tokens = tokens.map(x => {
      let y = x;
      STOP_WORDS.forEach(s => { y = y.split(s).join(""); });
      return y;
    }).filter(x => x.length > 0);
    return tokens.join(" ").trim() || t;
  }

  // 在应用列表里匹配应用
  function matchApps(topic, apps) {
    if (!topic) return [];
    const q = normalize(topic);
    const scored = [];
    apps.forEach(app => {
      let s = 0;
      const name = normalize(app.name);
      if (name.includes(q) || q.includes(name)) s += 10;
      (app.tags || []).forEach(tag => {
        if (q.includes(normalize(tag)) || normalize(tag).includes(q)) s += 5;
      });
      if (normalize(app.description || "").includes(q)) s += 3;
      if (normalize(app.category || "").includes(q)) s += 3;
      if (s > 0) scored.push({ app, score: s });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map(x => x.app);
  }

  function detect(text, context) {
    const raw = String(text || "").trim();
    const scores = scoreIntent(raw);
    let intent = scores.length ? scores[0].intent : "qa";
    const topic = extractTopic(raw);

    // 规则修正
    // 1. "打开XX" 优先视为打开应用，除非无匹配应用则转问答
    if (intent === "open_app") {
      const apps = (context && context.apps) || [];
      const matched = matchApps(topic, apps);
      if (!matched.length) intent = "qa";
    }
    // 2. "搜索/查XX" 若明确是知识语义，保留 search
    // 3. 含问号或明显问句 → qa（除非已被 list/stats 命中）
    if (/[?？]/.test(raw) && !["list_apps", "stats", "help", "greeting"].includes(intent)) {
      if (intent !== "search") intent = "qa";
    }
    // 4. 分数太低且无明确关键词 → qa
    if (!scores.length && !topic) intent = "qa";

    return { intent, topic, raw, confidence: scores.length ? scores[0].score : 0 };
  }

  return { detect, extractTopic, matchApps, scoreIntent };
});
