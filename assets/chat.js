/* ============================================================
 * chat.js —— ArchHub Copilot 对话核心
 * 双模：未配置密钥 → 本地意图引擎；配置密钥 → 真实 AI Agent（流式 + 工具调用）
 * 密钥只存本机 localStorage，不上传、不写入仓库。
 * ============================================================ */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  let APPS = { apps: [] }, KB = { entries: [] }, INDEX = null;
  let sessions = [], currentId = null;
  let CFG = loadConfig();        // Agent 配置
  let abortCtrl = null;          // 当前请求的 AbortController

  // 快捷建议
  const SUGGESTIONS = [
    { ico: "▦", title: "看看有哪些应用", sub: "列出你所有已登记的应用", q: "有哪些应用" },
    { ico: "✦", title: "问一个架构问题", sub: "例如：CAP 定理是什么", q: "CAP 定理是什么" },
    { ico: "⌕", title: "搜索知识库", sub: "例如：搜一下熔断", q: "搜一下熔断" },
    { ico: "◷", title: "最近有什么新情报", sub: "查看最新架构动态", q: "最近有什么新情报" }
  ];

  // ---------- Agent 配置（BYOK） ----------
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem("archhub_agent_config") || "null"); }
    catch (e) { return null; }
  }
  function saveConfig(cfg) {
    localStorage.setItem("archhub_agent_config", JSON.stringify(cfg));
    CFG = cfg;
    updateModeUI();
  }
  function aiEnabled() {
    return !!(CFG && CFG.enabled && CFG.apiKey);
  }
  function providerOf() {
    const P = (window.AgentEngine && AgentEngine.PROVIDERS) || {};
    return P[(CFG && CFG.provider) || "deepseek"] || P.deepseek || { name: "AI" };
  }
  function updateModeUI() {
    const badge = $("#modeBadge");
    if (badge) {
      if (aiEnabled()) {
        badge.textContent = "AI Agent · " + providerOf().name;
        badge.classList.add("ai");
        badge.title = "已接入真实大模型，密钥仅存本机";
      } else {
        badge.textContent = "本地引擎 · 隐私安全";
        badge.classList.remove("ai");
        badge.title = "使用内置意图引擎，离线可用";
      }
    }
    if (abortCtrl === null) {
      const stop = $("#stopBtn");
      if (stop) stop.style.display = "none";
    }
  }

  // ---------- 设置面板 ----------
  function fillSettings() {
    const cfg = CFG || { enabled: false, provider: "deepseek", apiKey: "", model: "", baseUrl: "" };
    $("#cfgEnabled").checked = !!cfg.enabled;
    $("#cfgProvider").value = cfg.provider || "deepseek";
    $("#cfgKey").value = cfg.apiKey || "";
    $("#cfgBaseUrl").value = cfg.baseUrl || "";
    renderModelOptions(cfg.provider || "deepseek", cfg.model);
    setTestResult("", "");
    updateSaveLabel();
  }
  function updateSaveLabel() {
    $("#cfgSave").textContent = $("#cfgEnabled").checked ? "保存并启用" : "保存设置";
  }
  function renderModelOptions(providerId, selected) {
    const P = (window.AgentEngine && AgentEngine.PROVIDERS) || {};
    const p = P[providerId] || {};
    const models = p.models || [];
    const cur = selected || p.defaultModel || "";
    const sel = $("#cfgModel");
    sel.innerHTML = models.length
      ? models.map(m => `<option value="${m}"${m === cur ? " selected" : ""}>${m}</option>`).join("")
      : `<option value="${cur}">${cur || "请填写模型名"}</option>`;
    $("#baseUrlField").style.display = providerId === "custom" ? "" : "none";
  }
  function collectSettings() {
    return {
      enabled: $("#cfgEnabled").checked,
      provider: $("#cfgProvider").value,
      apiKey: $("#cfgKey").value.trim(),
      model: $("#cfgModel").value.trim(),
      baseUrl: $("#cfgBaseUrl").value.trim()
    };
  }
  function setTestResult(msg, kind) {
    const el = $("#testResult");
    el.textContent = msg || "";
    el.className = "test-result" + (kind ? " " + kind : "");
  }
  async function testSettings() {
    const cfg = collectSettings();
    if (!cfg.apiKey) return setTestResult("请先填写 API Key", "err");
    setTestResult("正在测试连接…", "");
    try {
      const r = await AgentEngine.testConnection(cfg);
      setTestResult((r.ok ? "✓ " : "✗ ") + r.message, r.ok ? "ok" : "err");
    } catch (e) {
      setTestResult("✗ 测试失败：" + (e.message || "未知错误"), "err");
    }
  }
  function openSettings() { fillSettings(); $("#settingsMask").classList.add("show"); }
  function closeSettings() { $("#settingsMask").classList.remove("show"); }
  function initSettings() {
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#settingsClose").addEventListener("click", closeSettings);
    $("#settingsMask").addEventListener("click", e => {
      if (e.target.id === "settingsMask") closeSettings();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && $("#settingsMask").classList.contains("show")) closeSettings();
    });
    $("#cfgProvider").addEventListener("change", e => renderModelOptions(e.target.value, ""));
    $("#cfgEnabled").addEventListener("change", updateSaveLabel);
    $("#cfgTest").addEventListener("click", testSettings);
    $("#cfgSave").addEventListener("click", () => {
      const cfg = collectSettings();
      if (cfg.enabled && !cfg.apiKey) return setTestResult("请先填写 API Key，或关闭 AI 开关", "err");
      if (cfg.provider === "custom" && !cfg.baseUrl) return setTestResult("自定义服务商需要填写 API 地址", "err");
      saveConfig(cfg);
      closeSettings();
      toast(cfg.enabled ? "AI Agent 已启用" : "已切换回本地引擎");
    });
    $("#cfgClear").addEventListener("click", () => {
      if (!confirm("确定清除保存在本机的 API Key 吗？清除后将切回本地引擎。")) return;
      localStorage.removeItem("archhub_agent_config");
      CFG = null;
      fillSettings();
      updateModeUI();
      toast("已清除密钥，切回本地引擎");
    });
    updateModeUI();
  }

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
    const grid = $("#suggestGrid");
    if (!grid) return;
    grid.innerHTML = SUGGESTIONS.map(s => `
      <div class="suggest" data-q="${escapeHtml(s.q)}">
        <div class="s-ico">${s.ico}</div>
        <div><b>${s.title}</b><span>${s.sub}</span></div>
      </div>`).join("");
    grid.querySelectorAll(".suggest").forEach(el =>
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
    bindCards();
    scrollBottom();
  }
  function msgHTML(m) {
    if (m.role === "user") return `<div class="msg user"><div class="av">我</div><div class="body"><div class="who">你</div><div class="bubble">${escapeHtml(m.text)}</div></div></div>`;
    const tag = m.engine === "ai" ? ` <span class="mode-tag">AI</span>` : "";
    return `<div class="msg bot"><div class="av">✦</div><div class="body"><div class="who">ArchHub${tag}</div><div class="answer">${m.html}</div></div></div>`;
  }
  function appendMsg(role, payload, engine) {
    const s = cur(); if (!s) return;
    s.msgs.push({ role, text: payload, html: role === "bot" ? payload : undefined, engine });
    if (s.msgs.length === 1 && role === "user") s.title = payload.slice(0, 18);
    const thread = $("#messages .thread");
    if (!thread) $("#messages").innerHTML = `<div class="thread"></div>`;
    $("#messages .thread").insertAdjacentHTML("beforeend", msgHTML(s.msgs[s.msgs.length - 1]));
    saveSessions(); renderHistory(); scrollBottom();
  }
  function scrollBottom() {
    const el = $("#messages"); el.scrollTop = el.scrollHeight;
  }

  // ---------- 本地意图引擎：生成富回复 ----------
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
    return `<div class="card clickable" data-open="${escapeHtml(app.entry)}" data-name="${escapeHtml(app.name)}">
      <div class="card-top">
        <div class="card-ico" style="background:linear-gradient(135deg,${app.accent},${app.accent}aa)">${app.icon}</div>
        <div><div class="card-title">${escapeHtml(app.name)}</div><div class="card-meta">${escapeHtml(app.category)} · 更新于 ${escapeHtml(app.updated)}</div></div>
      </div>
      <div class="card-desc">${escapeHtml(app.description)}</div>
      <div class="card-tags">${(app.tags || []).map(t => `<span class="card-tag"># ${escapeHtml(t)}</span>`).join("")}</div>
    </div>`;
  }
  function openAppReply(app) {
    return `好的，正在为你打开 <b>${escapeHtml(app.name)}</b>…<div class="cards">${appCardHTML(app)}</div>
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
      <div class="card-top"><div class="card-title">${escapeHtml(e.title)}</div></div>
      <div class="card-desc">${escapeHtml(e.content.slice(0, 110))}…</div>
      <div class="source-line">${escapeHtml(e.created)} · ${escapeHtml((e.tags || []).join(" / "))}</div>
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
      <div class="card-top"><div class="card-title">${escapeHtml(r.doc.meta.title)}</div><span class="score">相关 ${(r.score * 100).toFixed(0)}%</span></div>
      <div class="card-desc">${escapeHtml(r.snippet)}</div>
      <div class="source-line">来源：${escapeHtml(r.doc.meta.source)} · ${escapeHtml(r.doc.meta.created)}</div>
    </div>`).join("");
    answer += `<div class="cards">${cards}</div>`;
    if (results.length > 1) answer += `<p class="muted">以上按相关度排序，均来自你的本地知识库。</p>`;
    return answer;
  }

  // ---------- 真实 AI Agent ----------
  function buildAgentMessages() {
    const s = cur(); if (!s) return [];
    return s.msgs.slice(-14).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.role === "user" ? m.text : (m.text || stripHtml(m.html))
    }));
  }
  function stripHtml(html) {
    const d = document.createElement("div");
    d.innerHTML = html || "";
    return d.textContent || "";
  }
  function renderMarkdown(text) {
    let s = escapeHtml(text || "");
    s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s.split(/\r?\n/).map(line => {
      const t = line.trim();
      if (/^[-*•]\s+/.test(t)) return `<p class="md-li">• ${t.replace(/^[-*•]\s+/, "")}</p>`;
      if (/^\d+[\.、]\s*/.test(t)) return `<p class="md-li">${t}</p>`;
      return t ? `<p>${t}</p>` : "";
    }).join("") || "<p>…</p>";
  }
  function setSending(yes) {
    $("#send").disabled = yes;
    const stop = $("#stopBtn");
    if (stop) stop.style.display = (yes && aiEnabled()) ? "" : "none";
  }

  async function sendViaAgent(text, tid) {
    const answerEl = document.getElementById("answer-" + tid);
    const statusEl = document.getElementById("status-" + tid);
    abortCtrl = new AbortController();
    setSending(true);
    let acc = "";
    const setStatus = t => { if (statusEl) statusEl.textContent = t ? "◌ " + t : ""; };

    try {
      const full = await AgentEngine.chat({
        config: CFG,
        messages: buildAgentMessages(),
        context: {
          apps: APPS.apps,
          knowledge: KB.entries,
          search: (q, k) => SearchEngine.search(INDEX, q, k)
        },
        onStatus: setStatus,
        onToken: token => {
          acc += token;
          if (answerEl) answerEl.textContent = acc + "▍";
          scrollBottom();
        },
        signal: abortCtrl.signal
      });
      setStatus("");
      const html = renderMarkdown(full);
      if (answerEl) answerEl.innerHTML = html;
      const s = cur();
      if (s) { s.msgs.push({ role: "bot", text: full, html, engine: "ai" }); saveSessions(); renderHistory(); }
    } catch (e) {
      setStatus("");
      if (e.name === "AbortError") {
        const partial = acc || "（已停止生成）";
        const html = renderMarkdown(partial) + `<p class="muted">— 已停止生成 —</p>`;
        if (answerEl) answerEl.innerHTML = html;
        const s = cur();
        if (s) { s.msgs.push({ role: "bot", text: partial, html, engine: "ai" }); saveSessions(); }
      } else {
        const err = "⚠ " + (e.message || "未知错误");
        const html = `<p class="agent-error">${escapeHtml(err)}</p>
          <p class="muted">可在右上角 ⚙ 设置中检查密钥 / 接口地址，或关闭 AI 开关切回本地引擎。</p>`;
        if (answerEl) answerEl.innerHTML = html;
        const s = cur();
        if (s) { s.msgs.push({ role: "bot", text: err, html, engine: "ai" }); saveSessions(); }
      }
    } finally {
      abortCtrl = null;
      setSending(false);
      scrollBottom();
    }
  }

  // ---------- 发送流程 ----------
  async function send(text) {
    text = String(text || "").trim();
    if (!text) return;
    if (abortCtrl) { toast("上一条还在生成中，可点击 ■ 停止"); return; }
    const input = $("#input"); input.value = "";
    autoResize(input);
    if ($("#welcome")) { $("#messages").innerHTML = `<div class="thread"></div>`; }
    appendMsg("user", text);

    const tid = "typing-" + Date.now();
    const isAI = aiEnabled();
    const tpl = isAI
      ? `<div class="msg bot" id="${tid}"><div class="av">✦</div><div class="body">
           <div class="who">ArchHub <span class="mode-tag">AI</span></div>
           <div class="agent-status" id="status-${tid}"></div>
           <div class="answer stream" id="answer-${tid}"></div>
         </div></div>`
      : `<div class="msg bot" id="${tid}"><div class="av">✦</div><div class="body"><div class="who">ArchHub</div><div class="typing"><i></i><i></i><i></i></div></div></div>`;
    $("#messages .thread").insertAdjacentHTML("beforeend", tpl);
    scrollBottom();

    if (isAI) {
      await sendViaAgent(text, tid);
    } else {
      setSending(true);
      await new Promise(r => setTimeout(r, 420 + Math.random() * 300));
      const el = document.getElementById(tid); if (el) el.remove();
      let html;
      try { html = handleIntent(text); }
      catch (e) { html = `抱歉，处理时出了点问题：${escapeHtml(e.message)}`; }
      appendMsg("bot", html, "local");
      bindCards();
      setSending(false);
    }
  }

  function bindCards() {
    document.querySelectorAll("[data-open]").forEach(c => {
      if (c._bound) return;
      c._bound = true;
      c.addEventListener("click", () => {
        toast("正在打开 " + c.dataset.name);
        window.open(c.dataset.open, "_blank");
      });
    });
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
    $("#stopBtn").addEventListener("click", () => { if (abortCtrl) abortCtrl.abort(); });
  }
  function initUI() {
    $("#newChat").addEventListener("click", () => newChat());
    $("#menuBtn").addEventListener("click", () => $("#rail").classList.add("open"));
    $("#railClose").addEventListener("click", () => $("#rail").classList.remove("open"));
    $("#openDashboard").addEventListener("click", () => window.open("./dashboard.html", "_blank"));
    const savedTheme = localStorage.getItem("archhub_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    $("#themeBtn").addEventListener("click", () => {
      const curTheme = document.documentElement.getAttribute("data-theme");
      const next = curTheme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("archhub_theme", next);
    });
  }
  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  initUI(); initInput(); initSettings(); loadData();
})();
