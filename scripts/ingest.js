/* ============================================================
 * ingest.js —— 内容入库脚本
 * 把源文件（HTML/MD）或结构化内容抽取成知识条目，追加进 knowledge.json。
 *
 * 用法：
 *   node scripts/ingest.js                    # 扫描 apps.json 中 ingest:true 的应用，抽取其 source
 *   node scripts/ingest.js <file> --app=<id>  # 抽取单个文件
 *   node scripts/ingest.js --title="..." --content="..." --app=<id>  # 直接入库文本
 *
 * 抽取策略：去标签 → 按段落切分 → 合并为条目；中文 HTML 也能工作。
 * ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const KB_PATH = path.join(ROOT, "data", "knowledge.json");
const APPS_PATH = path.join(ROOT, "data", "apps.json");

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8"); }
function stripHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}
function extractText(file) {
  if (!fs.existsSync(file)) return null;
  let raw = fs.readFileSync(file, "utf8");
  if (/\.html?$/i.test(file)) raw = stripHTML(raw);
  else raw = raw.replace(/^#+\s*/gm, "").replace(/[*_`>]/g, "");
  return raw;
}
function makeEntry({ title, content, source, tags }) {
  const now = new Date().toISOString().slice(0, 10);
  return {
    id: "kb-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    source: source || "manual",
    title: title,
    content: content.slice(0, 2000),
    tags: tags || [],
    created: now
  };
}
function ingest(entry) {
  const kb = readJSON(KB_PATH);
  // 简单去重：同 source + 同 title 视为已存在
  const dup = kb.entries.some(e => e.source === entry.source && e.title === entry.title);
  if (dup) { console.log("  跳过（已存在）:", entry.title); return false; }
  kb.entries.unshift(entry);
  kb.updated = new Date().toISOString().slice(0, 10);
  writeJSON(KB_PATH, kb);
  console.log("  已入库:", entry.title);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  // 模式 3：直接文本
  if (args.includes("--title") && args.includes("--content")) {
    const t = args[args.indexOf("--title") + 1];
    const c = args[args.indexOf("--content") + 1];
    const app = args.find(a => a.startsWith("--app="));
    ingest(makeEntry({ title: t, content: c, source: app ? app.split("=")[1] : "manual", tags: [] }));
    return;
  }
  // 模式 2：单文件
  const fileArg = args.find(a => !a.startsWith("--") && !a.startsWith("-") && /\.(html?|md|txt)$/i.test(a));
  if (fileArg) {
    const app = args.find(a => a.startsWith("--app="));
    const appId = app ? app.split("=")[1] : "manual";
    const text = extractText(path.resolve(fileArg));
    if (!text) { console.error("文件不存在:", fileArg); process.exit(1); }
    const title = path.basename(fileArg, path.extname(fileArg)).replace(/[-_]/g, " ");
    ingest(makeEntry({ title, content: text, source: appId, tags: [] }));
    return;
  }
  // 模式 1：扫描注册表（默认）
  const apps = readJSON(APPS_PATH).apps.filter(a => a.ingest !== false);
  console.log("扫描注册表中的应用，共", apps.length, "个");
  apps.forEach(app => {
    const src = app.source ? (path.isAbsolute(app.source) ? app.source : path.join(ROOT, app.source)) : null;
    const text = src ? extractText(src) : null;
    if (text) {
      ingest(makeEntry({ title: app.name, content: text, source: app.id, tags: app.tags }));
    } else {
      console.log("  跳过（无可读源）:", app.id, "→", app.entry);
    }
  });
}
main();
