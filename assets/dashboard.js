/* ============================================================
 * app.js —— ArchHub 前端逻辑
 * ============================================================ */
(function(){
"use strict";
const $=s=>document.querySelector(s);
let APPS={apps:[]}, KB={entries:[]}, INDEX=null;

async function loadData(){
  try{
    const [a,k]=await Promise.all([
      fetch("./data/apps.json").then(r=>r.json()),
      fetch("./data/knowledge.json").then(r=>r.json())
    ]);
    APPS=a; KB=k;
    INDEX=SearchEngine.buildIndex(KB.entries.map(e=>({id:e.id,title:e.title,content:e.content,meta:e})));
    renderStats(); renderApps(); renderAllKB();
  }catch(e){ console.error(e); showToast("数据加载失败："+e.message); }
}

function renderStats(){
  $("#statApps").textContent=APPS.apps.length+" 个应用";
  $("#statKB").textContent=KB.entries.length;
  $("#statUpdated").textContent=KB.updated||"—";
  $("#heroApps").textContent=APPS.apps.length;
  $("#heroKB").textContent=KB.entries.length;
  const tags=new Set(); KB.entries.forEach(e=>(e.tags||[]).forEach(t=>tags.add(t)));
  $("#heroTags").textContent=tags.size;
}

function renderApps(){
  $("#appGrid").innerHTML=APPS.apps.map(app=>`
    <div class="app-card" data-id="${app.id}">
      <div class="stripe" style="background:${app.accent}"></div>
      <div class="app-status status-${app.status}">${app.status==="active"?"● 运行中":"○ "+app.status}</div>
      <div class="app-top">
        <div class="app-icon" style="background:linear-gradient(135deg,${app.accent},${app.accent}aa)">${app.icon}</div>
        <div><div class="app-name">${app.name}</div><div class="app-meta">${app.category} · 更新于 ${app.updated}</div></div>
      </div>
      <div class="app-desc">${app.description}</div>
      <div class="app-tags">${(app.tags||[]).map(t=>`<span class="tag"># ${t}</span>`).join("")}</div>
    </div>`).join("");
  $("#appGrid").querySelectorAll(".app-card").forEach(c=>c.addEventListener("click",()=>{
    const app=APPS.apps.find(a=>a.id===c.dataset.id);
    if(app&&app.entry) window.open(app.entry,"_blank");
  }));
}

function kbItemHTML(r){
  const e=r.doc.meta;
  return `<div class="kb-item">
    <div class="kb-top"><span class="kb-title">${e.title}</span><span class="kb-score">相关度 ${(r.score*100).toFixed(0)}%</span></div>
    <div class="kb-source">来源：${e.source} · ${e.created} · ${(e.tags||[]).join(" / ")}</div>
    <div class="kb-content">${r.snippet}</div>
  </div>`;
}
function renderAllKB(){
  const list=KB.entries.map(e=>({score:1,doc:{title:e.title,content:e.content,meta:e},snippet:e.content.slice(0,130)+"…"}));
  $("#kbResults").innerHTML=list.length?list.map(kbItemHTML).join(""):`<div class="empty">知识库为空，运行入库脚本后即可看到内容。</div>`;
}
function doSearch(){
  const q=$("#kbSearch").value.trim();
  if(!q){renderAllKB();return;}
  const r=SearchEngine.search(INDEX,q,10);
  $("#kbResults").innerHTML=r.length?r.map(kbItemHTML).join(""):`<div class="empty">没有找到相关内容，换个关键词试试。</div>`;
}

function doAsk(){
  const q=$("#askInput").value.trim();
  if(!q){showToast("请先输入问题");return;}
  const mode=document.querySelector('input[name="llmMode"]:checked').value;
  const out=$("#askResult");
  out.innerHTML=`<div class="loading">正在检索知识库…</div>`;
  const results=SearchEngine.search(INDEX,q,5);
  setTimeout(()=>{
    if(!results.length){out.innerHTML=`<div class="empty">知识库中没有相关内容，无法回答这个问题。</div>`;return;}
    let answer="";
    if(mode==="extractive"){
      answer=results.slice(0,3).map((r,i)=>`【${i+1}】${r.doc.meta.title}\n${r.snippet}`).join("\n\n");
      answer="根据知识库检索，以下是最相关的内容：\n\n"+answer;
    } else {
      answer=`<div class="ask-answer">已检索到 ${results.length} 条相关内容（提取式回答如上所示）。\n\nLLM 增强模式需要配置大模型接口。当前为离线版本，默认使用提取式回答——它直接从你的知识库摘录原文，答案完全可溯源，不会产生幻觉。\n\n接入 LLM 的方法见平台说明文档：在 assets/app.js 的 doAsk() 中接入 /api/chat 接口，把检索到的片段作为 context 传入即可。</div>`;
    }
    out.innerHTML=`<div class="ask-label">回答 · ${mode==="extractive"?"提取式（离线）":"LLM 增强"}</div>
      <div class="ask-answer">${escapeHtml(answer)}</div>
      <div class="ask-sources"><h4>参考来源</h4>
      ${results.map(r=>`<div class="ask-source-item"><b>${r.doc.meta.title}</b> · 相关度 ${(r.score*100).toFixed(0)}% · 来源 ${r.doc.meta.source}</div>`).join("")}
      </div>`;
  },120);
}
function escapeHtml(s){return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

// 导航
function initNav(){
  document.querySelectorAll(".nav-item").forEach(item=>item.addEventListener("click",()=>{
    document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
    item.classList.add("active");
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    $("#page-"+item.dataset.page).classList.add("active");
    $("#topTitle").textContent=item.textContent.trim();
    $("#sidebar").classList.remove("open");
    window.scrollTo({top:0,behavior:"smooth"});
  }));
  $("#menuBtn").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
}
let toastTimer;
function showToast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),2200);}

initNav();
$("#kbSearchBtn").addEventListener("click",doSearch);
$("#kbSearch").addEventListener("keydown",e=>{if(e.key==="Enter")doSearch()});
$("#askBtn").addEventListener("click",doAsk);
$("#askInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))doAsk()});
loadData();
})();
