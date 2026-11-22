/* ============================================================
 * chat.js —— ArchHub Copilot 对话核心
 * ============================================================ */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  let APPS = { apps: [] }, KB = { entries: [] }, INDEX = null;
  let sessions = [], currentId = null;

  // 快捷建议
  const SUGGESTIONS = [
    { ico: "▦", title: "看看有哪些应用", sub: "列出你所有已登记的应用", q: "有哪些应用" },
    { ico: "✦", title: "问一个架构问题", sub: "例如：CAP 定理是什么", q: "CAP 定理是什么" },
    { ico: "⌕", title: "搜索知识库", sub: "例如：搜一下熔断", q: "搜一下熔断" },
    { ico: "◷", title: "最近有什么新情报", sub: "查看最新架构动态", q: "最近有什么新情报" }
  ];

  // ---------- 数据加载 ----------
  async function loadData() {
    try {
      const [a, k] = await Promise.all([
        fetch("./data/apps.json").then(r => r.json()),
        fetch("./data/knowledge.json").then(r => r.json())
      ]);
      APPS = a; KB = k;
      INDEX = SearchEngine.buildIndex(KB.entries.map(e => ({
        id: e.id, title: e.title, content: e.content, meta: e
      })));
      $("#railKB").textContent = KB.entries.length;
      renderSuggestions();
      loadSessions();
    } catch (e) {
      console.error(e);
      toast("数据加载失败：" + e.message);
    }
  }

  function renderSuggestions() {
    $("#suggestGrid").innerHTML = SUGGESTIONS.map(s => `
      <div class="suggest" data-q="${s.q}">
        <div class="s-ico">${s.ico}</div>
        <div><b>${s.title}</b><span>${s.sub}</span></div>
      </div>`).join("");
    $("#suggestGrid").querySelectorAll(".suggest").forEach(el =>
      el.addEventListener("click", () => send(el.dataset.q)));
  }

  // ---------- 会话管理（localStorage） ----------
  function loadSessions() {
    try { sessions = JSON.parse(localStorage.getItem("archhub_sessions") || "[]"); }
    catch (e) { sessions = []; }
    if (!sessions.length) { newChat(false); }
    else { currentId = sessions[0].id; renderMessages(); }
    renderHistory();
  }
  function saveSessions() {
    localStorage.setItem("archhub_sessions", JSON.stringify(sessions.slice(0, 30)));
  }
  function newChat(render = true) {
    const s = { id: "s" + Date.now(), title: "新对话", msgs: [], created: Date.now() };
    sessions.unshift(s); currentId = s.id; saveSessions();
    renderHistory();
    if (render) { renderMessages(); showWelcome(); }
  }
  function cur() { return sessions.find(s => s.id === currentId); }
  function renderHistory() {
    const el = $("#history");
    if (!sessions.length) { el.innerHTML = `<div class="history-empty">暂无对话</div>`; return; }
    el.innerHTML = sessions.map(s => `
      <div class="history-item ${s.id === currentId ? "active" : ""}" data-id="${s.id}">
        <span class="hi-ico">◌</span><span>${escapeHtml(s.title)}</span>
      </div>`).join("");
    el.querySelectorAll(".history-item").forEach(x => x.addEventListener("click", () => {
      currentId = x.dataset.id; renderHistory(); renderMessages();
    }));
  }
  function showWelcome() { $("#messages").innerHTML = welcomeHTML(); renderSuggestions(); }
  function welcomeHTML() {
    return `<div class="welcome" id="welcome">
      <div class="welcome-orb">✦</div>
      <h1>你好，我是 ArchHub</h1>
      <p>你的应用与知识助手。直接告诉我你想做什么——用大白话就行。</p>
      <div class="suggest-grid" id="suggestGrid"></div>
    </div>`;
  }

  // ---------- 消息渲染 ----------
  function renderMessages() {
    const s = cur();
    if (!s || !s.msgs.length) { showWelcome(); return; }
    $("#messages").innerHTML = `<div class="thread">${s.msgs.map(m => msgHTML(m)).join("")}</div>`;
    scrollBottom();
  }
  function msgHTML(m) {
    if (m.role === "user") return `<div class="msg user"><div class="av">我</div><div class="body"><div class="who">你</div><div class="bubble">${escapeHtml(m.text)}</div></div></div>`;
    return `<div class="msg bot"><div class="av">✦</div><div class="body"><div class="who">ArchHub</div><div class="answer">${m.html}</div></div></div>`;
  }
  function appendMsg(role, payload) {
    const s = cur(); if (!s) return;
    s.msgs.push({ role, text: payload, html: role === "bot" ? payload : undefined });
    if (s.msgs.length === 1 && role === "user") s.title = payload.slice(0, 18);
    const thread = $("#messages .thread");
    if (!thread) {
      $("#messages").innerHTML = `<div class="thread"></div>`;
    }
    $("#messages .thread").insertAdjacentHTML("beforeend", msgHTML(s.msgs[s.msgs.length - 1]));
    saveSessions(); renderHistory(); scrollBottom();
  }
  function scrollBottom() {
    const el = $("#messages"); el.scrollTop = el.scrollHeight;
  }

  // ---------- 意图处理：生成富回复 ----------
  function handleIntent(text) {
    const r = IntentEngine.detect(text, { apps: APPS.apps });
    const q = r.topic || text;
    switch (r.intent) {
      case "greeting":
        return reply(`你好！我是你的应用与知识助手。<br><span class="muted">我可以帮你打开应用、搜索知识、回答问题、查看统计。试着问我点什么？</span>`);
      case "help":
        return reply(`我能帮你做这些：<br>
          <p class="lead">· <b>打开应用</b> —「打开架构工作台」</p>
          <p class="lead">· <b>列出应用</b> —「有哪些应用」</p>
          <p class="lead">· <b>搜索知识</b> —「搜一下熔断」</p>
          <p class="lead">· <b>回答问题</b> —「CAP 定理是什么」</p>
          <p class="lead">· <b>查看统计</b> —「知识库有多少条」</p>
          <p class="lead">· <b>内容推荐</b> —「最近有什么新情报」</p>
          <span class="muted">直接用大白话说就行，不用记命令。</span>`);
      case "list_apps":
        return listAppsReply();
      case "open_app": {
        const matched = IntentEngine.matchApps(q, APPS.apps);
        if (matched.length) return openAppReply(matched[0]);
        return qaReply(q);
      }
      case "stats":
        return statsReply();
      case "recommend":
        return recommendReply();
      case "search":
      case "qa":
      default:
        return qaReply(q);
    }
  }

  function reply(html) { return html; }

  function listAppsReply() {
    const cards = APPS.apps.map(app => appCardHTML(app)).join("");
    return `你目前有 <b>${APPS.apps.length}</b> 个应用：<div class="cards">${cards}</div>`;
  }
  function appCardHTML(app) {
    return `<div class="card clickable" data-open="${app.entry}" data-name="${app.name}">
      <div class="card-top">
        <div class="card-ico" style="background:linear-gradient(135deg,${app.accent},${app.accent}aa)">${app.icon}</div>
        <div><div class="card-title">${app.name}</div><div class="card-meta">${app.category} · 更新于 ${app.updated}</div></div>
      </div>
      <div class="card-desc">${app.description}</div>
      <div class="card-tags">${(app.tags || []).map(t => `<span class="card-tag"># ${t}</span>`).join("")}</div>
    </div>`;
  }
  function openAppReply(app) {
    return `好的，正在为你打开 <b>${app.name}</b>…<div class="cards">${appCardHTML(app)}</div>
      <p class="muted">如果页面没自动弹出，点击上方卡片即可打开。</p>`;
  }
  function statsReply() {
    const tags = new Set(); KB.entries.forEach(e => (e.tags || []).forEach(t => tags.add(t)));
    const intel = KB.entries.filter(e => e.source === "archboard-daily").length;
    return `这是你知识中枢的当前概况：<div class="pills">
      <div class="pill"><b>${APPS.apps.length}</b><span>个应用</span></div>
      <div class="pill"><b>${KB.entries.length}</b><span>条知识</span></div>
      <div class="pill"><b>${intel}</b><span>条每日情报</span></div>
      <div class="pill"><b>${tags.size}</b><span>个标签</span></div>
    </div><p class="muted">知识库会随着每日自动任务持续成长。</p>`;
  }
  function recommendReply() {
    const recent = KB.entries.filter(e => e.source === "archboard-daily").slice(0, 3);
    if (!recent.length) return `暂时没有新情报，明天早上 8 点会自动更新。`;
    const cards = recent.map(e => `<div class="card kb-card">
      <div class="card-top"><div class="card-title">${e.title}</div></div>
      <div class="card-desc">${e.content.slice(0, 110)}…</div>
      <div class="source-line">${e.created} · ${(e.tags || []).join(" / ")}</div>
    </div>`).join("");
    return `这是最近收录的架构情报：<div class="cards">${cards}</div>`;
  }
  function qaReply(q) {
    const results = SearchEngine.search(INDEX, q, 5);
    if (!results.length) {
      return `<span class="lead">我在知识库里没找到关于「${escapeHtml(q)}」的内容。</span><br>
        <span class="muted">换个说法试试？或者用「有哪些应用」看看我能访问什么。</span>`;
    }
    const top = results[0];
    let answer = `根据知识库，关于「${escapeHtml(q)}」最相关的内容是：<br><br>`;
    answer += `<span class="lead">${escapeHtml(top.snippet)}</span>`;
    const cards = results.slice(0, 3).map(r => `<div class="card kb-card">
      <div class="card-top"><div class="card-title">${r.doc.meta.title}</div><span class="score">相关 ${(r.score * 100).toFixed(0)}%</span></div>
      <div class="card-desc">${r.snippet}</div>
      <div class="source-line">来源：${r.doc.meta.source} · ${r.doc.meta.created}</div>
    </div>`).join("");
    answer += `<div class="cards">${cards}</div>`;
    if (results.length > 1) answer += `<p class="muted">以上按相关度排序，均来自你的本地知识库。</p>`;
    return answer;
  }

  // ---------- 发送流程 ----------
  async function send(text) {
    text = String(text || "").trim();
    if (!text) return;
    const input = $("#input"); input.value = "";
    autoResize(input);
    if ($("#welcome")) { $("#messages").innerHTML = `<div class="thread"></div>`; }
    appendMsg("user", text);

    // 打字指示
    const tid = "typing-" + Date.now();
    $("#messages .thread").insertAdjacentHTML("beforeend",
      `<div class="msg bot" id="${tid}"><div class="av">✦</div><div class="body"><div class="who">ArchHub</div><div class="typing"><i></i><i></i><i></i></div></div></div>`);
    scrollBottom();

    await new Promise(r => setTimeout(r, 420 + Math.random() * 300));
    const el = document.getElementById(tid); if (el) el.remove();

    let html;
    try { html = handleIntent(text); }
    catch (e) { html = `抱歉，处理时出了点问题：${escapeHtml(e.message)}`; }
    appendMsg("bot", html);
    bindCards();
  }

  function bindCards() {
    document.querySelectorAll("[data-open]").forEach(c => c.addEventListener("click", () => {
      toast("正在打开 " + c.dataset.name);
      window.open(c.dataset.open, "_blank");
    }));
  }

  // ---------- 输入交互 ----------
  function autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }
  function initInput() {
    const input = $("#input");
    input.addEventListener("input", () => autoResize(input));
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
    });
    $("#send").addEventListener("click", () => send(input.value));
  }
  function initUI() {
    $("#newChat").addEventListener("click", () => newChat());
    $("#menuBtn").addEventListener("click", () => $("#rail").classList.add("open"));
    $("#railClose").addEventListener("click", () => $("#rail").classList.remove("open"));
    $("#openDashboard").addEventListener("click", () => window.open("./dashboard.html", "_blank"));
    const savedTheme = localStorage.getItem("archhub_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    $("#themeBtn").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("archhub_theme", next);
    });
  }
  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  initUI(); initInput(); loadData();
})();
