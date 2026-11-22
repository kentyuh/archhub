/* ============================================================
 * agent.js —— 真实 AI Agent（BYOK 直连，OpenAI 兼容协议）
 * 支持 DeepSeek / 智谱 / 通义 / OpenAI 等；支持流式与工具调用循环。
 * 密钥仅从调用方传入，本模块不持久化任何密钥。
 * ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof root !== "undefined") root.AgentEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 服务商预设（均为 OpenAI 兼容 Chat Completions 协议，且支持浏览器 CORS）
  const PROVIDERS = {
    deepseek: {
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      models: ["deepseek-chat", "deepseek-reasoner"],
      defaultModel: "deepseek-chat",
      keyPrefix: "sk-"
    },
    zhipu: {
      name: "智谱 GLM",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      models: ["glm-4-flash", "glm-4-plus", "glm-4-air"],
      defaultModel: "glm-4-flash",
      keyPrefix: ""
    },
    qwen: {
      name: "通义千问",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      models: ["qwen-plus", "qwen-turbo", "qwen-max"],
      defaultModel: "qwen-plus",
      keyPrefix: "sk-"
    },
    moonshot: {
      name: "Moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      models: ["moonshot-v1-8k", "moonshot-v1-32k"],
      defaultModel: "moonshot-v1-8k",
      keyPrefix: "sk-"
    },
    openai: {
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4o-mini", "gpt-4o"],
      defaultModel: "gpt-4o-mini",
      keyPrefix: "sk-"
    },
    custom: {
      name: "自定义",
      baseUrl: "",
      models: [],
      defaultModel: "",
      keyPrefix: ""
    }
  };

  // 系统提示词（始终是 messages[0]）
  function systemPrompt(context) {
    const apps = (context.apps || []).map(a =>
      `- ${a.name}（id:${a.id}，分类:${a.category}）：${a.description}`).join("\n");
    return `你是 ArchHub Copilot，一位能力全面的个人 AI 助手。你既能像通用大模型一样回答问题、写作、分析和创作，又能访问用户的真实应用清单与知识库——后者是你的增强能力，不是回答范围的限制。

【可用工具】
- list_apps：列出用户的所有应用。凡是涉及"有哪些应用""打开某应用""某应用是做什么的""我的应用"等，必须先调用它，用真实数据回答。
- search_knowledge：在用户个人知识库中语义检索（参数 query）。当问题可能与用户的架构沉淀、技术知识、每日情报相关时调用。
- get_stats：获取应用数、知识条数、情报数、标签数等统计。

【回答准则】
1. 先判断问题类型再决定行动：
   - 关于用户应用 / 知识库 / 统计 → 调用对应工具，基于真实数据回答。
   - 关于架构、技术概念 → 先调用 search_knowledge：
     · 检索到相关内容：结合它回答，自然说明"根据你知识库里的《标题》…"，并可用你自己的知识补充说明。
     · 检索为空或不够充分：不要停！直接用你自身的知识完整、专业地回答，最后补一句"你的知识库里暂时没有这方面的沉淀，以上基于通用知识"。
   - 其他问题（闲聊、写作、翻译、代码、方案设计、分析、计算、创意等）→ 直接正常回答，无需调用任何工具。
2. 你本身就是一个强大的 AI 助手。绝不要因为知识库没有相关内容就拒答、只说"没找到"，或把问题推回给用户。
3. 回答用中文，简洁有条理，可用简短列表；不要输出 HTML 标签。
4. 涉及用户的具体应用名称、数量、知识条目时，以工具返回的真实数据为准，不要编造。

用户当前的应用清单（背景参考，实际以 list_apps 返回为准）：
${apps || "（暂无应用）"}`;
  }

  // 工具定义（OpenAI function calling 格式）
  function toolDefinitions() {
    return [
      {
        type: "function",
        function: {
          name: "list_apps",
          description: "列出用户所有已登记的应用，返回名称、描述、分类、入口地址",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "search_knowledge",
          description: "在用户个人知识库中语义检索，返回最相关的内容片段、标题、来源和相关度",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "要检索的关键词或问题" },
              limit: { type: "integer", description: "返回条数，默认 5" }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_stats",
          description: "获取应用数量、知识库条目数、标签数、每日情报数等统计",
          parameters: { type: "object", properties: {}, required: [] }
        }
      }
    ];
  }

  // 执行工具（业务层实现，模型不参与）
  function executeTool(name, args, context) {
    const apps = context.apps || [];
    const entries = context.knowledge || [];
    switch (name) {
      case "list_apps":
        return JSON.stringify(apps.map(a => ({
          id: a.id, name: a.name, description: a.description,
          category: a.category, entry: a.entry, tags: a.tags
        })));
      case "search_knowledge": {
        if (!context.search) return JSON.stringify([]);
        const results = context.search(args.query || "", Math.min(args.limit || 5, 10));
        return JSON.stringify(results.map(r => ({
          title: r.doc.meta.title,
          content: r.snippet,
          source: r.doc.meta.source,
          date: r.doc.meta.created,
          relevance: Number((r.score * 100).toFixed(0))
        })));
      }
      case "get_stats": {
        const tags = new Set();
        entries.forEach(e => (e.tags || []).forEach(t => tags.add(t)));
        return JSON.stringify({
          apps: apps.length,
          knowledge: entries.length,
          dailyIntel: entries.filter(e => e.source === "archboard-daily").length,
          tags: tags.size
        });
      }
      default:
        return JSON.stringify({ error: "未知工具: " + name });
    }
  }

  // 错误信息规范化
  function normalizeError(status, data) {
    if (status === 401 || status === 403) return "密钥无效或已过期，请检查设置里的 API Key";
    if (status === 429) return "请求过于频繁或额度已用完，请稍后再试";
    if (status === 404) return "接口地址不正确，请检查设置里的 API 地址";
    const msg = data && (data.error?.message || data.message);
    return msg ? "模型返回错误：" + msg : "请求失败（HTTP " + status + "）";
  }

  /**
   * 流式对话（支持工具循环）
   * @param {object} opts
   *   - config: { provider, apiKey, baseUrl, model }
   *   - messages: [{role,content}] 不含 system
   *   - context: { apps, knowledge, search }
   *   - onToken(text): 流式文本回调
   *   - onStatus(text): 状态回调（如"正在检索知识库…"）
   *   - signal: AbortSignal
   * @returns {string} 完整回答
   */
  async function chat(opts) {
    const { config, messages, context, onToken, onStatus, signal } = opts;
    const provider = PROVIDERS[config.provider] || PROVIDERS.deepseek;
    const baseUrl = (config.baseUrl || provider.baseUrl).replace(/\/$/, "");
    const url = baseUrl + "/chat/completions";
    const model = config.model || provider.defaultModel;

    const convo = [{ role: "system", content: systemPrompt(context) }, ...messages];
    let fullAnswer = "";
    const MAX_ROUNDS = 5; // 工具循环上限，防止无限调用

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const body = {
        model,
        messages: convo,
        stream: true,
        temperature: 0.6,
        tools: toolDefinitions(),
        tool_choice: "auto"
      };

      let resp;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + config.apiKey
          },
          body: JSON.stringify(body),
          signal
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new Error("无法连接模型服务，请检查网络与接口地址：" + e.message);
      }

      if (!resp.ok) {
        let data = null;
        try { data = await resp.json(); } catch (e) {}
        throw new Error(normalizeError(resp.status, data));
      }
      if (!resp.body) throw new Error("模型服务未返回数据流");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      const toolCalls = new Map(); // index -> {id, name, args}
      let finishReason = null;
      let roundText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let chunk;
          try { chunk = JSON.parse(payload); } catch (e) { continue; }

          const choice = chunk.choices && chunk.choices[0];
          if (!choice) continue;
          const delta = choice.delta || {};

          // 文本内容（安全：不做 HTML 解析，交由调用方转义）
          if (delta.content) {
            roundText += delta.content;
            if (onToken) onToken(delta.content);
          }
          // 工具调用片段：按 index 累积
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              const cur = toolCalls.get(idx) || { id: "", name: "", args: "" };
              if (tc.id) cur.id = tc.id;
              if (tc.function && tc.function.name) cur.name = tc.function.name;
              if (tc.function && tc.function.arguments) cur.args += tc.function.arguments;
              toolCalls.set(idx, cur);
            }
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      }

      // 没有工具调用 → 本轮文本即最终答案
      if (finishReason !== "tool_calls" || toolCalls.size === 0) {
        fullAnswer += roundText;
        break;
      }

      // 有工具调用 → 执行并把结果喂回模型，进入下一轮
      convo.push({ role: "assistant", content: roundText || null, tool_calls: Array.from(toolCalls.values()).map(tc => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.args }
      })) });

      for (const tc of toolCalls.values()) {
        let args = {};
        try { args = JSON.parse(tc.args || "{}"); } catch (e) {}
        if (onStatus) onStatus("正在调用工具：" + tc.name);
        const result = executeTool(tc.name, args, context);
        convo.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      // 下一轮重新思考，roundText 不直接输出给用户
    }

    if (!fullAnswer.trim()) fullAnswer = "抱歉，我没能给出答案，请换个问法试试。";
    return fullAnswer;
  }

  /**
   * 测试连接（最小请求，不触发工具，不产生流式）
   * @returns {{ok:boolean, message:string}}
   */
  async function testConnection(config, signal) {
    const provider = PROVIDERS[config.provider] || PROVIDERS.deepseek;
    const baseUrl = (config.baseUrl || provider.baseUrl).replace(/\/$/, "");
    const url = baseUrl + "/chat/completions";
    const model = config.model || provider.defaultModel;
    let resp;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + config.apiKey
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "hi" }],
          stream: false,
          max_tokens: 1
        }),
        signal
      });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      return { ok: false, message: "无法连接模型服务，请检查网络与接口地址：" + e.message };
    }
    if (!resp.ok) {
      let data = null;
      try { data = await resp.json(); } catch (e) {}
      return { ok: false, message: normalizeError(resp.status, data) };
    }
    return { ok: true, message: "连接成功，" + model + " 可用" };
  }

  return { PROVIDERS, chat, testConnection, toolDefinitions, executeTool, systemPrompt };
});
