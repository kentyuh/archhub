/* ============================================================
 * app.js —— ArchBoard 主逻辑
 * 核心：以日期为种子的"确定性进化" + 本地交互
 * ============================================================ */
(function () {
  "use strict";

  const K = window.KNOWLEDGE || [];
  const INTEL = (window.DAILY_INTEL || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const FOCUS = window.DAILY_FOCUS || [];
  const START_DATE = new Date("2026-11-21T00:00:00"); // 进化起点

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------- 日期与确定性轮换 ----------
  function dayIndex(date = new Date()) {
    return Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - START_DATE) / 86400000);
  }
  function dayNumber(date = new Date()) {
    return Math.max(1, dayIndex(date) + 1);
  }
  function seedFromDate(date = new Date()) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pickByDay(arr, offset = 0, date = new Date()) {
    if (!arr.length) return null;
    const seed = seedFromDate(date);
    return arr[(dayIndex(date) + offset + seed) % arr.length];
  }

  // ---------- 顶部日期 / 问候 ----------
  function renderDates() {
    const now = new Date();
    const week = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"][now.getDay()];
    const dateStr = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${week}`;
    $("#topDate").textContent = dateStr;
    $("#heroDate").textContent = dateStr + " · 这是工作台陪伴你的第 " + dayNumber(now) + " 天";
    const h = now.getHours();
    const greet = h < 6 ? "夜深了，架构师" : h < 12 ? "早上好，架构师" : h < 14 ? "中午好，架构师" : h < 18 ? "下午好，架构师" : "晚上好，架构师";
    $("#greeting").textContent = greet;

    const dn = dayNumber(now);
    $("#evoDays").textContent = "已进化 " + dn + " 天";
    $("#startupDate").textContent = "启动于 " + START_DATE.getFullYear() + "." + String(START_DATE.getMonth()+1).padStart(2,"0") + "." + String(START_DATE.getDate()).padStart(2,"0");
    $("#statDays").textContent = dn;
  }

  // ---------- 今日聚焦 ----------
  function renderFocus() {
    const f = pickByDay(FOCUS, 0);
    if (f) {
      $("#focusTheme").textContent = f.theme;
      $("#focusQuestion").textContent = f.question;
    }
  }

  // ---------- 知识卡渲染 ----------
  function cardHTML(k) {
    return `<div class="big-card">
      <span class="card-cat">${k.cat}</span>
      <h3>${k.title}</h3>
      <p class="card-tagline">${k.tagline}</p>
      <div class="card-block"><div class="lbl">核心要点</div><div class="val">${k.body}</div></div>
      <div class="card-block"><div class="lbl">适用场景</div><div class="val">${k.when}</div></div>
      <div class="card-block pitfall"><div class="lbl">常见坑</div><div class="val">${k.pitfall}</div></div>
      <div class="tag-row">${(k.tags||[]).map(t=>`<span class="tag"># ${t}</span>`).join("")}</div>
    </div>`;
  }
  let dailyCardOffset = 0;
  function renderDailyCard() {
    if (!K.length) return;
    const k = pickByDay(K, dailyCardOffset);
    $("#dailyCardSlot").innerHTML = cardHTML(k);
  }
  function renderStats() {
    $("#statIntel").textContent = INTEL.length;
    $("#statCards").textContent = K.length;
    $("#statCheck").textContent = KITS.review.items.length;
  }

  // ---------- 情报渲染 ----------
  function intelHTML(it) {
    return `<article class="intel-item">
      <div class="intel-top">
        <span class="intel-date">${it.date}</span>
        <span class="intel-tag tag-${it.tag}">${it.tag}</span>
      </div>
      <h3>${it.title}</h3>
      <p class="intel-summary">${it.summary}</p>
      ${it.takeaway ? `<div class="intel-takeaway"><b>启示 · </b>${it.takeaway}</div>` : ""}
      <div class="intel-source">来源：${it.source}</div>
    </article>`;
  }
  function renderIntel() {
    const top = INTEL.slice(0, 3);
    $("#homeIntel").innerHTML = top.length ? top.map(intelHTML).join("") : `<p style="color:var(--text-faint)">暂无情报</p>`;
    renderIntelFiltered("全部");
    const tags = ["全部", ...Array.from(new Set(INTEL.map(i => i.tag)))];
    $("#intelFilters").innerHTML = tags.map((t,i) => `<button class="filter-chip ${i===0?'active':''}" data-tag="${t}">${t}</button>`).join("");
    $$("#intelFilters .filter-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        $$("#intelFilters .filter-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderIntelFiltered(btn.dataset.tag);
      });
    });
  }
  function renderIntelFiltered(tag) {
    const list = tag === "全部" ? INTEL : INTEL.filter(i => i.tag === tag);
    $("#allIntel").innerHTML = list.length ? list.map(intelHTML).join("") : `<p style="color:var(--text-faint)">该分类暂无内容</p>`;
  }

  // ---------- 知识库网格 ----------
  function renderKnowledge() {
    const cats = ["全部", ...Array.from(new Set(K.map(k => k.cat)))];
    $("#knowledgeFilters").innerHTML = cats.map((c,i) => `<button class="filter-chip ${i===0?'active':''}" data-cat="${c}">${c}</button>`).join("");
    const gridHTML = (list) => list.length ? list.map(k => `
      <div class="mini-card" data-id="${k.id}">
        <span class="card-cat">${k.cat}</span>
        <h3>${k.title}</h3>
        <p class="card-tagline">${k.tagline}</p>
      </div>`).join("") : `<p style="color:var(--text-faint)">该分类暂无内容</p>`;
    $("#knowledgeGrid").innerHTML = gridHTML(K);
    const activate = () => $$("#knowledgeGrid .mini-card").forEach(c => {
      c.addEventListener("click", () => openModal(c.dataset.id));
    });
    activate();
    $$("#knowledgeFilters .filter-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        $$("#knowledgeFilters .filter-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const c = btn.dataset.cat;
        $("#knowledgeGrid").innerHTML = gridHTML(c === "全部" ? K : K.filter(k => k.cat === c));
        activate();
      });
    });
  }
  function openModal(id) {
    const k = K.find(x => x.id === id);
    if (!k) return;
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.innerHTML = `<div class="modal">
      <button class="modal-close">×</button>
      ${cardHTML(k)}
    </div>`;
    document.body.appendChild(bd);
    $(".modal-close", bd).addEventListener("click", () => bd.remove());
    bd.addEventListener("click", e => { if (e.target === bd) bd.remove(); });
    document.addEventListener("keydown", function esc(e){ if(e.key==="Escape"){ bd.remove(); document.removeEventListener("keydown", esc);} });
  }

  // ---------- 决策工具箱 ----------
  const KITS = {
    review: {
      desc: "架构评审时逐条核对，覆盖需求、取舍、失败路径、扩展、安全与运维。",
      type: "check",
      items: [
        { t: "需求与约束是否清晰？", s: "功能范围、规模、性能/可用性目标、时间与人力约束" },
        { t: "有没有考虑被否决的备选方案？", s: "取舍过程和理由比结论更重要" },
        { t: "失败路径是否设计？", s: "依赖挂掉、超时、数据丢失、降级策略" },
        { t: "容量与扩展性是否够？", s: "当前规模 × 增长预期，瓶颈点在哪" },
        { t: "数据一致性与幂等是否处理？", s: "重试、重复消息、并发写" },
        { t: "安全与权限是否覆盖？", s: "认证、鉴权、敏感数据、最小权限" },
        { t: "可观测性是否可落地？", s: "日志、指标、链路、告警是否齐全" },
        { t: "是否有回滚方案？", s: "发布失败如何快速恢复" },
        { t: "运维成本团队能否承受？", s: "谁来维护，需要什么技能" },
        { t: "成本是否合理？", s: "预估资源开销与收益是否匹配" }
      ]
    },
    launch: {
      desc: "上线前逐项确认，降低发布事故概率。勾选状态保存在本机。",
      type: "check",
      items: [
        { t: "代码已合并且 CI 全绿", s: "构建、单测、集成测试通过" },
        { t: "配置与密钥已就绪", s: "生产环境变量、密钥、开关，且未硬编码" },
        { t: "数据库变更已评审并可回滚", s: "迁移脚本、备份、DDL 影响评估" },
        { t: "监控与告警已配置", s: "核心指标、错误率、延迟、告警阈值" },
        { t: "灰度/回滚方案已确认", s: "灰度比例、回滚步骤、决策人" },
        { t: "依赖方已通知", s: "上下游、客服、运营知悉" },
        { t: "压测/容量验证已完成", s: "峰值流量下系统表现符合预期" },
        { t: "预案与值班安排就绪", s: "应急联系人、值班表、故障群" }
      ]
    },
    selection: {
      desc: "技术选型的评估框架：为每个维度打分（1-5），加权后横向对比候选方案。",
      type: "selection",
      dims: ["成熟度与社区生态", "团队熟悉度", "与现有架构契合度", "运维成本", "性能与扩展", "安全与合规", "厂商锁定风险", "迁移与退出成本"]
    },
    adr: {
      desc: "架构决策记录模板，可直接复制到你的文档或仓库中。",
      type: "adr",
      template: `# ADR-[编号]：[决策标题]

状态：提议 | 接受 | 废弃 | 被替代

## 上下文
我们要解决的问题是什么？有哪些约束（技术、时间、人力、成本）？

## 决策
我们决定采用什么方案？用一到两句话清楚表述。

## 备选方案
- 方案 A：…… —— 优点是……，缺点是……
- 方案 B：…… —— 优点是……，缺点是……

## 后果
正面：……
负面 / 需要承担的代价：……

## 决策日期与决策人
日期：YYYY-MM-DD
决策人：……
`
    }
  };

  const LS_PREFIX = "archboard_check_";
  function renderKit(name) {
    const kit = KITS[name];
    const panel = $("#kitPanel");
    if (kit.type === "check") {
      const key = LS_PREFIX + name;
      let done = {};
      try { done = JSON.parse(localStorage.getItem(key) || "{}"); } catch(e){}
      panel.innerHTML = `<div class="kit-panel-box">
        <p class="kit-desc">${kit.desc}</p>
        <div class="check-list">
          ${kit.items.map((it,i) => `<div class="check-item ${done[i]?'done':''}" data-i="${i}">
            <div class="check-box">${done[i]?'✓':''}</div>
            <div class="check-text">${it.t}<small>${it.s}</small></div>
          </div>`).join("")}
        </div>
        <div class="kit-progress">
          <div class="progress-bar"><div class="progress-fill" id="kitProgress"></div></div>
          <span class="progress-label" id="kitProgressLabel"></span>
          <button class="reset-btn" id="resetCheck">重置</button>
        </div>
      </div>`;
      const update = () => {
        const total = kit.items.length;
        const cnt = $$(".check-item.done", panel).length;
        $("#kitProgress", panel).style.width = (cnt/total*100) + "%";
        $("#kitProgressLabel", panel).textContent = cnt + " / " + total;
      };
      $$(".check-item", panel).forEach(el => el.addEventListener("click", () => {
        const i = el.dataset.i;
        el.classList.toggle("done");
        $(".check-box", el).textContent = el.classList.contains("done") ? "✓" : "";
        done[i] = el.classList.contains("done");
        localStorage.setItem(key, JSON.stringify(done));
        update();
      }));
      $("#resetCheck", panel).addEventListener("click", () => {
        localStorage.removeItem(key); renderKit(name); showToast("已重置");
      });
      update();
    } else if (kit.type === "selection") {
      const cands = ["方案 A", "方案 B", "方案 C"];
      panel.innerHTML = `<div class="kit-panel-box">
        <p class="kit-desc">${kit.desc}</p>
        <div style="overflow-x:auto"><table class="selection-table">
          <thead><tr><th>评估维度</th>${cands.map(c=>`<th>${c}</th>`).join("")}</tr></thead>
          <tbody>${kit.dims.map(d=>`<tr><td>${d}</td>${cands.map((_,j)=>`<td contenteditable="true" style="color:var(--accent);cursor:text" data-d="${d}" data-c="${j}">—</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        <p style="font-size:12px;color:var(--text-faint);margin-top:14px">提示：直接点击单元格填入 1-5 分。分数会临时保留在本页。</p>
      </div>`;
    } else if (kit.type === "adr") {
      panel.innerHTML = `<div class="kit-panel-box">
        <p class="kit-desc">${kit.desc}</p>
        <div class="adr-template" id="adrText">${kit.template}</div>
        <button class="ghost-btn copy-btn" id="copyAdr">复制模板</button>
      </div>`;
      $("#copyAdr", panel).addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(kit.template); showToast("已复制到剪贴板"); }
        catch(e){ showToast("复制失败，请手动选择"); }
      });
    }
  }

  // ---------- 成长资源 ----------
  const RESOURCES = [
    { group: "设计原则与思维", items: [
      { n: "架构设计模式", d: "Microsoft Azure Architecture Center", l: "https://learn.microsoft.com/azure/architecture/patterns/" },
      { n: "系统设计模式", d: "patterns.dev · 前端与系统设计", l: "https://www.patterns.dev/" },
      { n: "十二要素应用", d: "12factor.net 官方", l: "https://12factor.net/zh_cn/" }
    ]},
    { group: "分布式与云原生", items: [
      { n: "CNCF 云原生全景图", d: "Cloud Native Landscape", l: "https://landscape.cncf.io/" },
      { n: "DDD 中文社区", d: "领域驱动设计实践", l: "https://DomainDrivenDesign.org" },
      { n: "微服务设计模式", d: "Microservices.io", l: "https://microservices.io/patterns/index.html" }
    ]},
    { group: "持续学习", items: [
      { n: "Martin Fowler", d: "软件设计大师博客", l: "https://martinfowler.com/" },
      { n: "AWS 架构博客", d: "大规模系统实践", l: "https://aws.amazon.com/cn/blogs/architecture/" },
      { n: "InfoQ 架构", d: "架构趋势与案例", l: "https://www.infoq.cn/topic/Architecture" }
    ]}
  ];
  function renderResources() {
    $("#resourceGroups").innerHTML = RESOURCES.map(g => `
      <div class="res-group">
        <h3>${g.group}</h3>
        <div class="res-grid">
          ${g.items.map(it => `<a class="res-item" href="${it.l}" target="_blank" rel="noopener">
            <div class="res-icon">↗</div>
            <div class="res-info"><b>${it.n}</b><span>${it.d}</span></div>
          </a>`).join("")}
        </div>
      </div>`).join("");
  }

  // ---------- 导航 ----------
  function renderNav() {
    const items = $$(".nav-item");
    items.forEach(a => a.addEventListener("click", (e) => {
      e.preventDefault();
      const id = a.getAttribute("href").slice(1);
      items.forEach(x => x.classList.remove("active"));
      a.classList.add("active");
      $$(".page").forEach(p => p.classList.remove("active"));
      $("#" + id).classList.add("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
      $("#sidebar").classList.remove("open");
    }));
    $("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  }

  // ---------- 主题 ----------
  function initTheme() {
    const saved = localStorage.getItem("archboard_theme");
    const theme = saved || "dark";
    document.documentElement.setAttribute("data-theme", theme);
    $("#themeBtn").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("archboard_theme", next);
    });
  }

  // ---------- Toast ----------
  let toastTimer;
  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
  }

  // ---------- 工具箱 tab ----------
  function initKitTabs() {
    $$("#kitTabs .kit-tab").forEach(btn => btn.addEventListener("click", () => {
      $$("#kitTabs .kit-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderKit(btn.dataset.kit);
    }));
    renderKit("review");
  }

  // ---------- 初始化 ----------
  initTheme();
  renderDates();
  renderFocus();
  renderDailyCard();
  renderStats();
  renderIntel();
  renderKnowledge();
  initKitTabs();
  renderResources();
  renderNav();

  $("#shuffleCard").addEventListener("click", () => {
    dailyCardOffset++;
    renderDailyCard();
    showToast("已换一张知识卡");
  });
})();
