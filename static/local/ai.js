/* AI 功能：ai.py 的浏览器移植版（手机 PWA 本地模式用）。
 *
 * 与电脑版的唯一区别：API Key / 模型设置从本地存储读取，HTTP 用 fetch 直连
 * 智谱开放平台（CORS 已实测放行）。工具调用循环、防幻觉护栏、防查询死循环、
 * 12 个工具的匹配语义、聚合分析结构全部与 ai.py 保持一致——
 * 改动这里之前先对照 ai.py。
 */
const LocalAI = (() => {
  "use strict";

  const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const DEFAULT_MODEL = "glm-4.7-flash";
  const MODELS = ["glm-4.7-flash", "glm-4.5-flash", "glm-5.3-flash"];
  const MAX_TOOL_ROUNDS = 16;
  const HISTORY_LIMIT = 20;
  const CACHE_TTL = 600;  // 分析追问缓存 10 分钟

  // 模型声称"已完成操作"的话术，配合 actions 为空时触发重试（同 ai.py）
  const SUCCESS_CLAIM_RE = /(已经?|帮你)(添加|新增|创建|删除|修改|更新|标记|设置|记下|记录)|(记录好|添加好|安排好|设置好|记好)/;
  const QUERY_TOOLS = ["list_events", "list_longterms"];

  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const getSettings = () => LocalStore.getSettings();
  const getModel = () => {
    const m = getSettings().ai_model || DEFAULT_MODEL;
    return MODELS.includes(m) ? m : DEFAULT_MODEL;
  };
  const keyReady = () => Boolean(String(getSettings().ai_api_key || "").trim());

  /* ---------- GLM 调用（对应 ai._call） ---------- */
  async function callGLM(messages, tools = null, timeoutMs = 60000) {
    const key = String(getSettings().ai_api_key || "").trim();
    if (!key) throw new Error("未设置 API Key，请在设置里填写");
    const body = { model: getModel(), messages, temperature: 0.4 };
    if (tools) body.tools = tools;

    let resp = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        resp = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        // 网络层失败（含超时中断），与 Python URLError 同文案
        throw new Error("连不上 AI 服务，请检查网络");
      }
      clearTimeout(timer);
      if (resp.ok) break;
      if (resp.status === 401) throw new Error("API Key 无效或已过期，请到设置里检查");
      if (resp.status === 429 && attempt < 2) { await sleep(5000); continue; }
      let detail = "";
      try {
        const err = await resp.json();
        detail = String((err && err.error && err.error.message) || "").slice(0, 150);
      } catch (_) { /* 保留空 detail */ }
      throw new Error(`AI 接口返回 ${resp.status}：${detail || "请稍后再试"}`);
    }
    let data = null;
    try { data = await resp.json(); } catch (_) { data = null; }
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error("AI 返回格式异常，请稍后再试");
    return msg;
  }

  /* ---------- 12 个工具定义（同 ai.TOOLS） ---------- */
  const TOOLS = [
    { type: "function", function: {
      name: "list_events", description: "查询日程列表，可按日期范围和关键词过滤",
      parameters: { type: "object", properties: {
        date_from: { type: "string", description: "起始日期 YYYY-MM-DD" },
        date_to: { type: "string", description: "结束日期 YYYY-MM-DD" },
        keyword: { type: "string", description: "标题关键词" } } } } },
    { type: "function", function: {
      name: "add_event", description: "添加一条日程",
      parameters: { type: "object", properties: {
        title: { type: "string" }, date: { type: "string" }, time: { type: "string" },
        remind_minutes: { type: "number" }, notes: { type: "string" } },
        required: ["title", "date", "time"] } } },
    { type: "function", function: {
      name: "update_event", description: "修改一条日程的内容（不改 id）",
      parameters: { type: "object", properties: {
        event_id: { type: "string" }, title: { type: "string" }, date: { type: "string" },
        time: { type: "string" },
        remind_minutes: { type: "number" }, notes: { type: "string" } },
        required: ["event_id"] } } },
    { type: "function", function: {
      name: "mark_event_done", description: "把日程标记为已完成/未完成",
      parameters: { type: "object", properties: {
        event_id: { type: "string" }, done: { type: "boolean" } },
        required: ["event_id", "done"] } } },
    { type: "function", function: {
      name: "delete_event", description: "删除一条日程",
      parameters: { type: "object", properties: { event_id: { type: "string" } },
        required: ["event_id"] } } },
    { type: "function", function: {
      name: "list_longterms", description: "查询长期任务及其子任务",
      parameters: { type: "object", properties: {} } } },
    { type: "function", function: {
      name: "add_longterm", description: "添加一个长期任务",
      parameters: { type: "object", properties: {
        title: { type: "string" }, deadline: { type: "string" } },
        required: ["title"] } } },
    { type: "function", function: {
      name: "add_milestone", description: "给长期任务添加一个子任务",
      parameters: { type: "object", properties: {
        longterm_title: { type: "string", description: "长期任务标题（和 id 二选一，推荐用标题）" },
        longterm_id: { type: "string" },
        text: { type: "string" }, deadline: { type: "string" } },
        required: ["text"] } } },
    { type: "function", function: {
      name: "update_longterm", description: "修改长期任务的标题或截止日期",
      parameters: { type: "object", properties: {
        longterm_title: { type: "string", description: "长期任务标题（和 id 二选一）" },
        longterm_id: { type: "string" }, title: { type: "string" },
        deadline: { type: "string" } } } } },
    { type: "function", function: {
      name: "update_milestone", description: "修改子任务的文字、截止日期或完成状态",
      parameters: { type: "object", properties: {
        milestone_text: { type: "string", description: "子任务文字（和 id 二选一，推荐用文字）" },
        longterm_title: { type: "string", description: "可选，限定在某个长期任务里找" },
        milestone_id: { type: "string" }, text: { type: "string" },
        deadline: { type: "string" }, done: { type: "boolean" } } } } },
    { type: "function", function: {
      name: "delete_longterm", description: "删除一个长期任务（连同其所有子任务），删除前先和用户确认",
      parameters: { type: "object", properties: {
        longterm_title: { type: "string", description: "长期任务标题（和 id 二选一，推荐用标题）" },
        longterm_id: { type: "string" } } } } },
    { type: "function", function: {
      name: "delete_milestone", description: "删除长期任务下的一个子任务（同名子任务会全部删除）",
      parameters: { type: "object", properties: {
        milestone_text: { type: "string", description: "子任务文字（和 id 二选一，推荐用文字）" },
        longterm_title: { type: "string", description: "可选，限定在某个长期任务里找" },
        milestone_id: { type: "string" } } } } },
  ];

  /* ---------- 工具执行器（同 ai._exec_tool / _exec_lt_tool） ---------- */
  function findLt(lts, args) {
    const lid = args.longterm_id, title = (args.longterm_title || "").trim();
    if (lid) {
      const exact = lts.find((x) => x.id === lid);
      if (exact) return exact;
    }
    if (title) {
      const exact = lts.find((x) => x.title === title);
      if (exact) return exact;
      const contains = lts.filter((x) => x.title.includes(title));
      if (contains.length === 1) return contains[0];  // 多个/0 个命中都不动，防误删
    }
    return null;
  }

  function msMatch(m, lt, args) {
    if (args.milestone_id) return m.id === args.milestone_id;
    const text = (args.milestone_text || "").trim();
    if (!text) return false;
    if (text !== m.text && !m.text.includes(text)) return false;
    const ltLimit = (args.longterm_title || "").trim();
    return !ltLimit || lt.title.includes(ltLimit);
  }

  function execLtTool(name, args, actions) {
    const lts = LocalStore.getLongterms();
    if (name === "add_milestone") {
      const lt = findLt(lts, args);
      if (!lt) return { ok: false, errors: ["没找到对应的长期任务，请先用 list_longterms 查看现有目标"] };
      const { ms, errors } = LocalStore.addMilestone(lt.id, args.text, args.deadline || "");
      if (errors.length) return { ok: false, errors };
      actions.push(`给「${lt.title}」新增子任务「${ms.text}」`);
      return { ok: true, milestone: ms };
    }
    if (name === "update_longterm") {
      const lt = findLt(lts, args);
      if (!lt) return { ok: false, errors: ["长期任务不存在"] };
      const payload = {};
      for (const k of ["title", "deadline"]) if (k in args) payload[k] = args[k];
      const lt2 = LocalStore.updateLongterm(lt.id, payload);
      actions.push(`修改长期任务「${lt.title}」`);
      return { ok: true, longterm: { id: lt2.id, title: lt2.title } };
    }
    if (name === "update_milestone") {
      const found = [];
      for (const lt of lts) for (const m of lt.milestones) if (msMatch(m, lt, args)) found.push([lt, m]);
      if (!found.length) return { ok: false, errors: ["子任务不存在"] };
      const payload = {};
      for (const k of ["text", "deadline", "done"]) if (k in args) payload[k] = args[k];
      for (const [lt, m] of found) {
        LocalStore.updateMilestone(lt.id, m.id, payload);
        actions.push(`修改子任务「${m.text}」`);
      }
      return { ok: true, milestone: found[0][1] };
    }
    if (name === "delete_longterm") {
      const lt = findLt(lts, args);
      if (!lt) return { ok: false, errors: ["长期任务不存在"] };
      LocalStore.deleteLongterm(lt.id);
      actions.push(`删除长期任务「${lt.title}」（含其子任务）`);
      return { ok: true };
    }
    if (name === "delete_milestone") {
      const found = [];
      for (const lt of lts) for (const m of lt.milestones) if (msMatch(m, lt, args)) found.push([lt, m]);
      if (!found.length) return { ok: false, errors: ["子任务不存在"] };
      for (const [lt, m] of found) {
        LocalStore.deleteMilestone(lt.id, m.id);
        actions.push(`删除子任务「${m.text}」`);
      }
      return { ok: true };
    }
    return { ok: false, errors: [`未知工具 ${name}`] };
  }

  function execTool(name, args, actions) {
    try {
      if (name === "list_events") {
        const dfrom = args.date_from, dto = args.date_to, kw = args.keyword;
        const out = LocalStore.getEvents()
          .filter((e) => (!dfrom || e.date >= dfrom) && (!dto || e.date <= dto) && (!kw || e.title.includes(kw)))
          .map((e) => ({ id: e.id, title: e.title, date: e.date, time: e.time,
                         done: e.done || false }));
        return { count: out.length, events: out.slice(0, 50) };
      }
      if (name === "add_event") {
        const { cleaned, errors } = LocalStore.validateEvent({
          title: args.title, date: args.date, time: args.time,
          remind_minutes: args.remind_minutes === undefined ? 15 : args.remind_minutes,
          notes: args.notes || "",
        });
        if (errors.length) return { ok: false, errors };
        const ev = LocalStore.addEvent(cleaned);
        actions.push(`新增日程「${ev.title}」${ev.date} ${ev.time}`);
        return { ok: true, event: { id: ev.id, title: ev.title, date: ev.date, time: ev.time } };
      }
      if (name === "update_event") {
        const payload = {};
        for (const k of ["title", "date", "time", "remind_minutes", "notes"]) {
          if (k in args) payload[k] = args[k];
        }
        const ev = LocalStore.updateEvent(args.event_id, payload);
        if (!ev) return { ok: false, errors: ["日程不存在"] };
        actions.push(`修改日程「${ev.title}」`);
        return { ok: true, event: { id: ev.id, title: ev.title, date: ev.date, time: ev.time } };
      }
      if (name === "mark_event_done") {
        const ev = LocalStore.updateEvent(args.event_id, { done: Boolean(args.done) });
        if (!ev) return { ok: false, errors: ["日程不存在"] };
        actions.push(`日程「${ev.title}」标记为${args.done ? "已完成" : "未完成"}`);
        return { ok: true };
      }
      if (name === "delete_event") {
        const ev = LocalStore.getEvents().find((x) => x.id === args.event_id);
        if (!ev || !LocalStore.deleteEvent(args.event_id)) return { ok: false, errors: ["日程不存在"] };
        actions.push(`删除日程「${ev.title}」`);
        return { ok: true };
      }
      if (name === "list_longterms") {
        const out = LocalStore.getLongterms().map((lt) => ({
          id: lt.id, title: lt.title, deadline: lt.deadline || "",
          milestones: lt.milestones.map((m) => ({ id: m.id, text: m.text, done: m.done || false })),
        }));
        return { count: out.length, longterms: out };
      }
      if (name === "add_longterm") {
        const { cleaned, errors } = LocalStore.validateLongterm({ title: args.title, deadline: args.deadline || "" });
        if (errors.length) return { ok: false, errors };
        const lt = LocalStore.addLongterm(cleaned);
        actions.push(`新增长期任务「${lt.title}」`);
        return { ok: true, longterm: { id: lt.id, title: lt.title } };
      }
      if (["add_milestone", "update_longterm", "update_milestone", "delete_longterm", "delete_milestone"].includes(name)) {
        return execLtTool(name, args, actions);
      }
      return { ok: false, errors: [`未知工具 ${name}`] };
    } catch (e) {  // 工具异常不能炸掉整个对话
      return { ok: false, errors: [`执行失败：${e && e.message ? e.message : e}`] };
    }
  }

  /* ---------- 系统提示词与概况注入（同 ai._system_prompt / _assistant_overview） ---------- */
  function systemPrompt() {
    const now = new Date();
    const wd = "一二三四五六日"[(now.getDay() + 6) % 7];
    return (
      "你是「日程助手」内置的 AI 助手，帮用户管理日程和长期任务。\n" +
      `当前时间：${fmtDate(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}（星期${wd}）。\n` +
      "规则：\n" +
      "- 解析「明天、下周三、月底」等相对时间时按当前日期计算，date 一律输出 YYYY-MM-DD。\n" +
      "- 用户没说时间默认 09:00；提醒默认提前 15 分钟，明确说不用提醒就传 0。\n" +
      "- 尽量在一条回复里发出多个工具调用（一次创建多个任务不要拆成多轮），未完成前不要下结论。\n" +
      "- 修改或删除前，先用查询工具找到确切 id，不要凭空猜 id。\n" +
      "- 删除长期任务这类破坏性操作，先向用户确认再执行。\n" +
      "- 信息不足以确定日期或内容时，用一句话向用户提问，不要瞎猜。\n" +
      "- 在真正调用工具成功之前，绝不要告诉用户操作已完成；没有调用工具就如实说没有。\n" +
      "- 全程用简短中文；完成后用几句话确认你做了什么；工具报错就如实转告。"
    );
  }

  function assistantOverview() {
    const data = aggregate("month");
    return {
      streak: data.streak,
      overdue_milestones: data.overdue_milestones,
      last_30_days: { total: data.cards.total, done: data.cards.done },
      upcoming_7_days: data.upcoming_7_days.slice(0, 8),
      longterms: data.longterms.map((x) => ({ id: x.id, ...x })),
    };
  }

  /* ---------- 对话式助手（对应 ai.chat） ---------- */
  async function chat(history) {
    const system = systemPrompt() +
      "\n用户当前的日程概况（回答「我有什么安排/哪个最急/长期任务进展」等问题时以此为准）：\n" +
      JSON.stringify(assistantOverview());
    const messages = [{ role: "system", content: system }];
    for (const m of (history || []).slice(-HISTORY_LIMIT)) {
      if ((m.role === "user" || m.role === "assistant") && m.content) {
        messages.push({ role: m.role, content: String(m.content).slice(0, 4000) });
      }
    }
    const actions = [];
    let nudgeUsed = 0;
    let staleReads = 0;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const msg = await callGLM(messages, TOOLS);
      const toolCalls = msg.tool_calls;
      if (!toolCalls || !toolCalls.length) {
        const reply = msg.content || "（无回复）";
        // 防幻觉：模型声称完成了操作却没调用任何工具时，打回去重做一次
        if (!actions.length && nudgeUsed < 1 && SUCCESS_CLAIM_RE.test(reply)) {
          nudgeUsed += 1;
          messages.push({ role: "assistant", content: reply });
          messages.push({ role: "user", content:
            "（系统提醒：你刚才声称已完成操作，但实际上没有调用任何工具，" +
            "用户的数据并没有变化。请现在真正调用工具完成；" +
            "如果确实不需要任何操作，请如实重新回复。）" });
          continue;
        }
        return { ok: true, reply, actions };
      }
      // glm-4.7-flash 对 content 为空字符串的 tool_calls 消息报 400，空 content 必须省略字段
      const assistantMsg = { role: "assistant", tool_calls: toolCalls };
      if (msg.content) assistantMsg.content = msg.content;
      messages.push(assistantMsg);
      for (const tc of toolCalls) {
        const fn = tc.function || {};
        let args = {};
        try { args = JSON.parse(fn.arguments || "{}"); } catch (_) { args = {}; }
        const result = execTool(fn.name || "", args, actions);
        let content = JSON.stringify(result);
        // 弱模型容易陷入"反复查询、从不动手"的循环：连续查询无动作时在结果里催它执行
        if (QUERY_TOOLS.includes(fn.name) && !actions.length) staleReads += 1;
        else staleReads = 0;
        if (staleReads >= 2 && QUERY_TOOLS.includes(fn.name)) {
          content = ("（系统提醒：你已经连续多次查询，数据不会因查询而改变。" +
                     "请现在直接调用删除/修改/添加类工具执行操作，不要再查询。）" + content);
        }
        messages.push({ role: "tool", tool_call_id: tc.id || "", content: content.slice(0, 1500) });
      }
    }
    return { ok: true, reply: `这次的改动比较多（已完成 ${actions.length} 项），先到这里，你可以继续吩咐。`, actions };
  }

  /* ---------- 统计分析（对应 ai._aggregate / analyze / analyze_chat） ---------- */
  const SCOPES = ["week", "month", "longterm"];
  const analysisCache = { data: null, ts: 0, scope: null };

  function aggregate(scope = "month", includeHeatmap = false) {
    const today = new Date();
    const todayIso = fmtDate(today);
    const events = LocalStore.getEvents();
    const lts = LocalStore.getLongterms();
    const doneDays = new Set(events.filter((e) => e.done).map((e) => e.date));

    // 连续完成天数：从今天（今天没完成就从昨天）往前数
    let streak = 0;
    const d = new Date(today);
    if (!doneDays.has(fmtDate(d))) d.setDate(d.getDate() - 1);
    while (doneDays.has(fmtDate(d))) { streak += 1; d.setDate(d.getDate() - 1); }

    const overdueMs = lts.reduce((s, lt) => s + lt.milestones.filter(
      (m) => m.deadline && m.deadline < todayIso && !m.done).length, 0);

    const dayStat = (day) => {
      const iso = fmtDate(day);
      const evs = events.filter((e) => e.date === iso);
      return { d: `${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`,
               dow: "一二三四五六日"[(day.getDay() + 6) % 7],
               total: evs.length, done: evs.filter((e) => e.done).length };
    };

    const upcoming = (days = 7) => {
      const b = new Date(today); b.setDate(b.getDate() + days);
      const bIso = fmtDate(b);
      return events
        .filter((e) => !e.done && todayIso <= e.date && e.date <= bIso)
        .sort((x, y) => x.date.localeCompare(y.date) || String(x.time).localeCompare(String(y.time)))
        .slice(0, 20)
        .map((e) => ({ title: e.title, date: e.date, time: e.time }));
    };

    const out = { scope, generated_at: `${todayIso} ${pad2(today.getHours())}:${pad2(today.getMinutes())}`,
                  streak, overdue_milestones: overdueMs };

    if (scope === "week") {
      const mon = new Date(today); mon.setDate(mon.getDate() - ((today.getDay() + 6) % 7));
      const days = [...Array(7)].map((_, i) => { const x = new Date(mon); x.setDate(x.getDate() + i); return dayStat(x); });
      const total = days.reduce((s, x) => s + x.total, 0);
      const done = days.reduce((s, x) => s + x.done, 0);
      const monIso = fmtDate(mon);
      const prevStart = new Date(mon); prevStart.setDate(prevStart.getDate() - 7);
      const prevDone = events.filter((e) => e.done && fmtDate(prevStart) <= e.date && e.date < monIso).length;
      Object.assign(out, {
        cards: { total, done, pending: total - done, overdue: overdueMs },
        rate: total ? Math.round(done / total * 100) : 0,
        days, prev_week_done: prevDone,
        upcoming_7_days: upcoming(7),
      });
    } else if (scope === "longterm") {
      const goals = lts.map((lt) => {
        let left = null;
        if (lt.deadline) {
          const [yy, mm, dd] = lt.deadline.split("-").map(Number);
          const dl = new Date(yy, mm - 1, dd);
          if (!isNaN(dl.getTime())) left = Math.round((dl - new Date(todayIso + "T00:00")) / 86400000);
        }
        return {
          title: lt.title, deadline: lt.deadline || "", left,
          done: lt.milestones.filter((m) => m.done).length,
          total: lt.milestones.length,
          overdue_steps: lt.milestones.filter((m) => m.deadline && m.deadline < todayIso && !m.done).length,
        };
      });
      const stepsTotal = goals.reduce((s, g) => s + g.total, 0);
      const stepsDone = goals.reduce((s, g) => s + g.done, 0);
      Object.assign(out, {
        cards: { goals: goals.length, steps_done: stepsDone, steps_total: stepsTotal, overdue: overdueMs },
        rate: stepsTotal ? Math.round(stepsDone / stepsTotal * 100) : 0,
        goals,
      });
    } else {  // month
      const start30 = new Date(today); start30.setDate(start30.getDate() - 29);
      const start30Iso = fmtDate(start30);
      const total = events.filter((e) => e.date >= start30Iso).length;
      const done = events.filter((e) => e.done && e.date >= start30Iso).length;
      const mon = new Date(today); mon.setDate(mon.getDate() - ((today.getDay() + 6) % 7));
      const weeks = [];
      for (const i of [3, 2, 1, 0]) {
        const ws = new Date(mon); ws.setDate(ws.getDate() - 7 * i);
        const we = new Date(ws); we.setDate(we.getDate() + 6);
        const wsIso = fmtDate(ws), weIso = fmtDate(we);
        const evs = events.filter((e) => wsIso <= e.date && e.date <= weIso);
        weeks.push({ label: `${ws.getMonth() + 1}/${ws.getDate()}~${we.getMonth() + 1}/${we.getDate()}`,
                     total: evs.length, done: evs.filter((e) => e.done).length });
      }
      const ltBrief = lts.map((lt) => ({
        id: lt.id, title: lt.title, deadline: lt.deadline || "",
        done: lt.milestones.filter((m) => m.done).length, total: lt.milestones.length,
      }));
      Object.assign(out, {
        cards: { total, done, pending: total - done, overdue: overdueMs },
        rate: total ? Math.round(done / total * 100) : 0,
        weeks,
        longterms: ltBrief,
        upcoming_7_days: upcoming(7),
      });
    }

    if (includeHeatmap) {
      const heatStart = new Date(today); heatStart.setDate(heatStart.getDate() - 90);
      const heatStartIso = fmtDate(heatStart);
      const heat = {};
      for (const e of events) {
        if (e.date < heatStartIso) continue;
        const cur = heat[e.date] || [0, 0];
        heat[e.date] = [cur[0] + 1, cur[1] + (e.done ? 1 : 0)];
      }
      out.heatmap = { start: heatStartIso,
                      days: Object.keys(heat).sort().map((k) => [k, heat[k][0], heat[k][1]]) };
    }
    return out;
  }

  const ANALYZE_SYSTEM =
    "你是「日程助手」应用的数据分析引擎。用户数据会以 JSON 给出。" +
    "只输出一个 JSON 对象（不要 markdown 代码块），格式：" +
    '{"summary": "两三句话的总体评价", "insights": ["洞察1", "洞察2", ...], ' +
    '"suggestions": ["建议1", "建议2", ...]}。' +
    "insights 说数据反映出的模式和问题（3-5 条），suggestions 给具体可执行的建议（2-4 条）。" +
    "全部简短中文，基于数据说话，不要空洞客套。";

  const SCOPE_FOCUS = {
    week: "分析对象是本周（最近 7 天）的日程执行情况：重点点评完成节奏、和上周的对比、未来几天的安排是否合理。",
    month: "分析对象是最近 30 天的趋势：重点点评习惯养成、起伏规律、各周对比和长期规律。",
    longterm: "分析对象是长期目标与子任务的推进情况：重点点评目标拆解是否合理、截止日期风险、逾期处理和推进顺序建议。",
  };

  // 模型偶尔会包 ```json 代码块，剥掉再解析（同 ai._parse_json_block 的怪癖语义）
  function parseJsonBlock(text) {
    if (text.startsWith("```")) {
      text = text.replace(/^`+/, "").replace(/`+$/, "").replace(/^[json]+/, "").trim();
    }
    try {
      const obj = JSON.parse(text);
      return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : null;
    } catch (_) { return null; }
  }

  async function analyze(scope = "month") {
    if (!SCOPES.includes(scope)) scope = "month";
    const data = aggregate(scope, true);
    const modelInput = { ...data };
    delete modelInput.heatmap;  // 纯画图数据不进模型提示词
    const messages = [
      { role: "system", content: ANALYZE_SYSTEM + SCOPE_FOCUS[scope] },
      { role: "user", content: "我的日程数据：\n" + JSON.stringify(modelInput) },
    ];
    const msg = await callGLM(messages);
    const text = (msg.content || "").trim();
    let out = parseJsonBlock(text);
    if (!out) out = { summary: text, insights: [], suggestions: [] };
    out.data = data;
    out.scope = scope;
    return { ok: true, ...out };
  }

  async function analyzeChat(question, history, scope = "month") {
    const now = Date.now() / 1000;
    if (!analysisCache.data || analysisCache.scope !== scope || now - analysisCache.ts > CACHE_TTL) {
      analysisCache.data = aggregate(scope);
      analysisCache.ts = now;
      analysisCache.scope = scope;
    }
    const data = analysisCache.data;
    const messages = [
      { role: "system",
        content: "你是「日程助手」的 AI 分析师。" + (SCOPE_FOCUS[scope] || "") +
                 "下面是用户的日程数据 JSON，基于它用简短中文回答用户问题；" +
                 "数据里没有的就直说没有。" + JSON.stringify(data) },
    ];
    for (const m of (history || []).slice(-6)) {
      if ((m.role === "user" || m.role === "assistant") && m.content) {
        messages.push({ role: m.role, content: String(m.content).slice(0, 2000) });
      }
    }
    messages.push({ role: "user", content: String(question).slice(0, 2000) });
    const msg = await callGLM(messages);
    return { ok: true, reply: msg.content || "（无回复）" };
  }

  return { MODELS, keyReady, getModel, chat, analyze, analyzeChat };
})();
