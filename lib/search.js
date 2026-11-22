/* ============================================================
 * search.js —— 轻量本地检索引擎（TF-IDF + 余弦相似度）
 * 零依赖，浏览器与 Node 均可运行；中文按 bigram + 单字，英文按词。
 * ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SearchEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 分词：中文单字 + 相邻双字(bigram)，英文/数字按词
  function tokenize(text) {
    if (!text) return [];
    const tokens = [];
    const cleaned = String(text).toLowerCase().replace(/[`~!@#$%^&*()_+\-=\[\]{};:'",.<>/?\\|]/g, " ");
    const segments = cleaned.split(/\s+/).filter(Boolean);
    for (const seg of segments) {
      const isCJK = /[\u4e00-\u9fa5]/.test(seg);
      if (isCJK) {
        const chars = seg.replace(/[^\u4e00-\u9fa5a-z0-9]/g, "").split("");
        for (let i = 0; i < chars.length; i++) {
          if (/[a-z0-9]/.test(chars[i])) { tokens.push(chars[i]); continue; }
          tokens.push(chars[i]);
          if (i + 1 < chars.length) tokens.push(chars[i] + chars[i + 1]);
        }
      } else {
        if (/^[a-z0-9]+$/.test(seg)) tokens.push(seg);
        else {
          const words = seg.match(/[a-z0-9]+/g);
          if (words) tokens.push(...words);
        }
      }
    }
    return tokens;
  }

  // 文档分块：按段落切，过长再按长度切
  function chunk(text, maxLen = 400) {
    if (!text) return [];
    const paras = String(text).split(/\n+/).map(s => s.trim()).filter(s => s.length > 8);
    const chunks = [];
    for (const p of paras) {
      if (p.length <= maxLen) { chunks.push(p); continue; }
      for (let i = 0; i < p.length; i += maxLen) chunks.push(p.slice(i, i + maxLen));
    }
    return chunks;
  }

  function buildIndex(documents) {
    // documents: [{ id, title, content, meta }]
    const N = documents.length;
    const df = Object.create(null);
    const tfList = [];
    documents.forEach((doc) => {
      const tf = Object.create(null);
      const toks = tokenize((doc.title || "") + " " + (doc.content || ""));
      toks.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
      Object.keys(tf).forEach(t => { df[t] = (df[t] || 0) + 1; });
      tfList.push(tf);
    });
    const idf = Object.create(null);
    Object.keys(df).forEach(t => { idf[t] = Math.log(1 + N / (1 + df[t])) + 1; });

    const vectors = tfList.map((tf) => {
      const vec = Object.create(null);
      let norm = 0;
      Object.keys(tf).forEach(t => {
        const w = (1 + Math.log(tf[t])) * (idf[t] || 1);
        vec[t] = w; norm += w * w;
      });
      norm = Math.sqrt(norm) || 1;
      Object.keys(vec).forEach(t => { vec[t] /= norm; });
      return vec;
    });

    return { documents, idf, vectors };
  }

  function search(index, query, topK = 8) {
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];
    const qTf = Object.create(null);
    qTokens.forEach(t => { qTf[t] = (qTf[t] || 0) + 1; });
    const qVec = Object.create(null);
    let qNorm = 0;
    Object.keys(qTf).forEach(t => {
      const w = (1 + Math.log(qTf[t])) * (index.idf[t] || 1);
      qVec[t] = w; qNorm += w * w;
    });
    qNorm = Math.sqrt(qNorm) || 1;
    Object.keys(qVec).forEach(t => { qVec[t] /= qNorm; });

    const scores = [];
    index.vectors.forEach((vec, i) => {
      let score = 0;
      Object.keys(qVec).forEach(t => { if (vec[t]) score += qVec[t] * vec[t]; });
      if (score > 0) scores.push({ i, score });
    });
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK).map(s => ({
      score: s.score,
      doc: index.documents[s.i],
      snippet: makeSnippet(index.documents[s.i].content || "", qTokens)
    }));
  }

  function makeSnippet(content, qTokens) {
    const text = String(content).replace(/\s+/g, " ");
    const lower = text.toLowerCase();
    let pos = -1;
    for (const t of qTokens) { const p = lower.indexOf(t); if (p >= 0) { pos = p; break; } }
    if (pos < 0) return text.slice(0, 120);
    const start = Math.max(0, pos - 40);
    return (start > 0 ? "…" : "") + text.slice(start, start + 140) + (start + 140 < text.length ? "…" : "");
  }

  return { tokenize, chunk, buildIndex, search };
});
