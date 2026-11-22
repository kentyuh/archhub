/* ============================================================
 * sync_daily.js —— 每日闭环同步脚本
 * 每日自动化任务调用它，一步完成：
 *   1. 把 archboard 源目录的 daily.js 同步到平台副本（保持门户展示最新）
 *   2. 把当天新增的情报条目抽取进 ArchHub 知识库（knowledge.json）
 *
 * 用法： node scripts/sync_daily.js
 * 依赖：无（纯 Node）
 * ============================================================ */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACE = path.resolve(ROOT, "..");
const SRC_DAILY = path.join(WORKSPACE, "archboard", "data", "daily.js");
const PLATFORM_DAILY = path.join(ROOT, "apps", "archboard", "data", "daily.js");
const KB_PATH = path.join(ROOT, "data", "knowledge.json");

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8"); }

// 在沙箱里执行 daily.js，拿到 DAILY_INTEL 数组
function loadIntel(file) {
  const code = fs.readFileSync(file, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.DAILY_INTEL || [];
}

function main() {
  if (!fs.existsSync(SRC_DAILY)) { console.error("找不到源 daily.js:", SRC_DAILY); process.exit(1); }

  // 1. 同步副本
  fs.mkdirSync(path.dirname(PLATFORM_DAILY), { recursive: true });
  fs.copyFileSync(SRC_DAILY, PLATFORM_DAILY);
  console.log("✓ 已同步 archboard 内容到平台副本");

  // 2. 抽取情报入库
  const intel = loadIntel(SRC_DAILY);
  const kb = readJSON(KB_PATH);
  let added = 0;
  // 只入库最近 10 条，避免一次性灌入历史；以 title+date 去重
  intel.slice(0, 10).forEach(it => {
    const title = `[情报·${it.date}] ${it.title}`;
    const dup = kb.entries.some(e => e.source === "archboard-daily" && e.title === title);
    if (dup) return;
    const content = [
      it.summary || "",
      it.takeaway ? "启示：" + it.takeaway : "",
      "分类：" + (it.tag || "") + " · 来源：" + (it.source || "")
    ].filter(Boolean).join("\n");
    kb.entries.unshift({
      id: "kb-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      source: "archboard-daily",
      title: title,
      content: content,
      tags: ["每日情报", it.tag].filter(Boolean),
      created: it.date
    });
    added++;
  });
  // 控制总量：情报类最多保留 60 条
  const dailyEntries = kb.entries.filter(e => e.source === "archboard-daily");
  if (dailyEntries.length > 60) {
    const toRemove = new Set(dailyEntries.slice(60).map(e => e.id));
    kb.entries = kb.entries.filter(e => !toRemove.has(e.id));
  }
  kb.updated = new Date().toISOString().slice(0, 10);
  writeJSON(KB_PATH, kb);
  console.log(`✓ 知识库新增 ${added} 条情报，当前共 ${kb.entries.length} 条`);
  console.log("闭环同步完成");
}
main();
