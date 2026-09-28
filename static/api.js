/* API 门面：所有前端数据请求的统一入口。
 *
 * 两种运行形态（init() 时自动探测，可用 URL 参数 ?mode=local / ?mode=http 强制）：
 * - http  电脑版：Flask 提供 API（原行为不变）
 * - local 手机版/离线：页面由静态托管（GitHub Pages）提供，没有后端——
 *         数据走 LocalStore（IndexedDB），AI 走 LocalAI（浏览器直连 GLM）
 *
 * LocalAPI 的返回结构与 Flask 端点逐一对齐，前端不感知差异。
 */
const API = (() => {
  "use strict";

  let mode = "http";
  const impl = () => (mode === "local" ? LocalAPI : HttpAPI);

  /* ---------- 模式探测 ---------- */
  async function init() {
    const forced = new URLSearchParams(location.search).get("mode");
    if (forced === "local" || forced === "http") {
      mode = forced;
    } else {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const r = await fetch("/api/settings", { signal: ctrl.signal });
        clearTimeout(timer);
        mode = r.ok ? "http" : "local";
      } catch (_) {
        mode = "local";
      }
    }
    if (mode === "local") await LocalStore.init();
    document.body.classList.toggle("local-mode", mode === "local");
    return mode;
  }

  /* ---------- 带超时的 JSON 请求 ---------- */
  async function fetchJSON(url, opts = {}, timeoutMs = 30000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- HTTP 适配器（Flask 端点） ---------- */
  const H = { "Content-Type": "application/json" };
  const HttpAPI = {
    loadEvents: () => fetchJSON("/api/events"),
    addEvent: (payload) => fetchJSON("/api/events", { method: "POST", headers: H, body: JSON.stringify(payload) }),
    updateEvent: (id, payload) => fetchJSON(`/api/events/${id}`, { method: "PUT", headers: H, body: JSON.stringify(payload) }),
    deleteEvent: (id) => fetchJSON(`/api/events/${id}`, { method: "DELETE" }),

    getStats: () => fetchJSON("/api/stats"),
    getWeeklyReport: (start) => fetchJSON(`/api/reports/weekly?start=${start}`),
    getOverallReport: () => fetchJSON("/api/reports/overall"),

    pollReminders: () => fetchJSON("/api/reminders/poll", { method: "POST" }),

    getSettings: () => fetchJSON("/api/settings"),
    updateSettings: (payload) => fetchJSON("/api/settings", { method: "PUT", headers: H, body: JSON.stringify(payload) }),

    getLongterms: () => fetchJSON("/api/longterms"),
    addLongterm: (payload) => fetchJSON("/api/longterms", { method: "POST", headers: H, body: JSON.stringify(payload) }),
    updateLongterm: (id, payload) => fetchJSON(`/api/longterms/${id}`, { method: "PUT", headers: H, body: JSON.stringify(payload) }),
    deleteLongterm: (id) => fetchJSON(`/api/longterms/${id}`, { method: "DELETE" }),
    addMilestone: (ltId, payload) => fetchJSON(`/api/longterms/${ltId}/milestones`, { method: "POST", headers: H, body: JSON.stringify(payload) }),
    updateMilestone: (ltId, msId, payload) => fetchJSON(`/api/longterms/${ltId}/milestones/${msId}`, { method: "PUT", headers: H, body: JSON.stringify(payload) }),
    deleteMilestone: (ltId, msId) => fetchJSON(`/api/longterms/${ltId}/milestones/${msId}`, { method: "DELETE" }),
    reorderLongterms: (order) => fetchJSON("/api/longterms/reorder", { method: "PUT", headers: H, body: JSON.stringify({ order }) }),
    reorderMilestones: (ltId, order) => fetchJSON(`/api/longterms/${ltId}/milestones/reorder`, { method: "POST", headers: H, body: JSON.stringify({ order }) }),

    // 背景图 / 图标：URL 直接引用（带缓存戳），上传走 FormData
    getBackgroundURL: async () => `/api/background?v=${Date.now()}`,
    uploadBackground: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return fetchJSON("/api/background", { method: "POST", body: fd }, 60000);
    },
    deleteBackground: () => fetchJSON("/api/background", { method: "DELETE" }),
    getIconPreviewURL: async () => `/api/icon/preview?v=${Date.now()}`,
    uploadIcon: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return fetchJSON("/api/icon", { method: "POST", body: fd }, 60000);
    },
    deleteIcon: () => fetchJSON("/api/icon", { method: "DELETE" }),

    aiStatus: () => fetchJSON("/api/ai/status"),
    aiChat: (messages, timeoutMs) => fetchJSON("/api/ai/chat", { method: "POST", headers: H, body: JSON.stringify({ messages }) }, timeoutMs),
    aiAnalyze: (scope, timeoutMs) => fetchJSON("/api/ai/analyze", { method: "POST", headers: H, body: JSON.stringify({ scope }) }, timeoutMs),
    aiAnalyzeChat: (payload, timeoutMs) => fetchJSON("/api/ai/analyze/chat", { method: "POST", headers: H, body: JSON.stringify(payload) }, timeoutMs),

    heartbeat: () => { fetch("/api/heartbeat", { method: "POST" }).catch(() => {}); },

    syncExport: () => fetchJSON("/api/sync/export"),
    syncImport: (pkg) => fetchJSON("/api/sync/import", { method: "POST", headers: H, body: JSON.stringify(pkg) }),
  };

  /* ---------- 本地适配器（IndexedDB + 直连 GLM） ---------- */
  const LocalAPI = {
    loadEvents: async () => ({ events: LocalStore.getEvents() }),
    addEvent: async (payload) => {
      const { cleaned, errors } = LocalStore.validateEvent(payload);
      if (errors.length) return { ok: false, errors };
      return { ok: true, event: LocalStore.addEvent(cleaned) };
    },
    updateEvent: async (id, payload) => {
      const { cleaned, errors } = LocalStore.validateEvent(payload, true);
      if (errors.length) return { ok: false, errors };
      const ev = LocalStore.updateEvent(id, cleaned);
      return ev ? { ok: true, event: ev } : { ok: false, errors: ["日程不存在"] };
    },
    deleteEvent: (id) => LocalStore.deleteEvent(id)
      ? Promise.resolve({ ok: true })
      : Promise.resolve({ ok: false, errors: ["日程不存在"] }),

    getStats: () => Promise.resolve(LocalStore.stats()),
    getWeeklyReport: (start) => Promise.resolve(LocalStore.weeklyReport(start)),
    getOverallReport: () => Promise.resolve(LocalStore.overallReport()),

    pollReminders: () => Promise.resolve({
      reminders: LocalStore.popDueReminders().map(({ ev, remindAt }) => ({
        id: ev.id, title: ev.title, time: ev.time, date: ev.date,
        priority: ev.priority || "中", remind_at: remindAt,
      })),
    }),

    getSettings: () => {
      const s = { ...LocalStore.getSettings() };
      s.ai_key_set = Boolean(String(s.ai_api_key || "").trim());
      delete s.ai_api_key;  // 与电脑版一致：key 不回传前端
      return Promise.resolve(s);
    },
    updateSettings: (payload) => LocalStore.updateSettings(payload).then(() => ({ ok: true })),

    getLongterms: () => Promise.resolve({ longterms: LocalStore.getLongterms() }),
    addLongterm: async (payload) => {
      const { cleaned, errors } = LocalStore.validateLongterm(payload);
      if (errors.length) return { ok: false, errors };
      return { ok: true, longterm: LocalStore.addLongterm(cleaned) };
    },
    updateLongterm: async (id, payload) => {
      const { cleaned, errors } = LocalStore.validateLongterm(payload, true);
      if (errors.length) return { ok: false, errors };
      const lt = LocalStore.updateLongterm(id, cleaned);
      return lt ? { ok: true, longterm: lt } : { ok: false, errors: ["长期任务不存在"] };
    },
    deleteLongterm: (id) => LocalStore.deleteLongterm(id)
      ? Promise.resolve({ ok: true })
      : Promise.resolve({ ok: false, errors: ["长期任务不存在"] }),
    addMilestone: async (ltId, payload) => {
      const { ms, errors } = LocalStore.addMilestone(ltId, payload.text, payload.deadline || "");
      return errors.length ? { ok: false, errors } : { ok: true, milestone: ms };
    },
    updateMilestone: (ltId, msId, payload) => {
      const ms = LocalStore.updateMilestone(ltId, msId, payload);
      return ms ? { ok: true, milestone: ms } : { ok: false, errors: ["子任务不存在"] };
    },
    deleteMilestone: (ltId, msId) => LocalStore.deleteMilestone(ltId, msId)
      ? Promise.resolve({ ok: true })
      : Promise.resolve({ ok: false, errors: ["子任务不存在"] }),
    reorderLongterms: (order) => { LocalStore.reorderLongterms(order); return Promise.resolve({ ok: true }); },
    reorderMilestones: (ltId, order) => { LocalStore.reorderMilestones(ltId, order); return Promise.resolve({ ok: true }); },

    // 背景图存 IndexedDB，用 objectURL 引用；图标设置在手机上无意义，返回未支持
    _bgURL: "",
    getBackgroundURL: async function () {
      const blob = await LocalStore.getBackground();
      if (!blob) return "";
      if (this._bgURL) URL.revokeObjectURL(this._bgURL);
      this._bgURL = URL.createObjectURL(blob);
      return this._bgURL;
    },
    uploadBackground: async (file) => {
      if (!file.type.startsWith("image/")) return { ok: false, errors: ["请上传图片文件（png/jpg 等）"] };
      await LocalStore.setBackground(file);
      return { ok: true };
    },
    deleteBackground: async () => { await LocalStore.deleteBackground(); return { ok: true }; },
    getIconPreviewURL: () => Promise.resolve(""),
    uploadIcon: () => Promise.resolve({ ok: false, errors: ["手机版不支持更换图标"] }),
    deleteIcon: () => Promise.resolve({ ok: true, restored: false }),

    aiStatus: () => Promise.resolve({ ok: true, ready: LocalAI.keyReady(), model: LocalAI.getModel(), models: LocalAI.MODELS }),
    aiChat: (messages) => LocalAI.chat(messages),
    aiAnalyze: (scope) => LocalAI.analyze(scope),
    aiAnalyzeChat: (payload) => LocalAI.analyzeChat(payload.question, payload.history, payload.scope),

    heartbeat: () => {},

    syncExport: () => LocalStore.exportPackage(),
    syncImport: async (pkg) => {
      const { result, errors } = await LocalStore.importPackage(pkg);
      return errors.length ? { ok: false, errors } : { ok: true, ...result };
    },
  };

  /* ---------- 对外门面：按当前模式转发 ---------- */
  const METHODS = [
    "loadEvents", "addEvent", "updateEvent", "deleteEvent",
    "getStats", "getWeeklyReport", "getOverallReport", "pollReminders",
    "getSettings", "updateSettings",
    "getLongterms", "addLongterm", "updateLongterm", "deleteLongterm",
    "addMilestone", "updateMilestone", "deleteMilestone", "reorderLongterms", "reorderMilestones",
    "getBackgroundURL", "uploadBackground", "deleteBackground",
    "getIconPreviewURL", "uploadIcon", "deleteIcon",
    "aiStatus", "aiChat", "aiAnalyze", "aiAnalyzeChat",
    "heartbeat", "syncExport", "syncImport",
  ];
  const facade = { init, isLocal: () => mode === "local" };
  for (const m of METHODS) {
    facade[m] = (...args) => impl()[m](...args);
  }
  return facade;
})();
