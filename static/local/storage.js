/* 本地数据层：storage.py 的浏览器移植版（手机 PWA / 离线模式用）。
 *
 * 数据存 IndexedDB（store "kv" 下三个 key：schedule / settings / background），
 * 每次修改整份写回（IndexedDB put 是事务性原子操作，等价于电脑版的 tmp+os.replace）。
 * 所有校验、排序、聚合、提醒到期判断的语义与 storage.py 逐条对应，
 * 改动这里之前先对照 storage.py，两边必须保持一致（同步包互换依赖这一点）。
 */
const LocalStore = (() => {
  "use strict";

  const DB_NAME = "schedule-buddy";
  const STORE = "kv";
  const SYNC_KIND = "schedule-buddy-sync";
  const REMINDER_GRACE_SECONDS = 10 * 60;
  const VALID_PRIORITIES = ["高", "中", "低"];
  const DEFAULT_DATA = { events: [], reminded: [], longterms: [] };
  const DEFAULT_SETTINGS = {
    language: "zh", background: "", icon: "", card_alpha: "0.9",
    sync_version: 0, sync_dirty: false,
  };

  let dbPromise = null;
  let data = null;       // {events, reminded, longterms}，init 后常驻内存
  let settings = null;

  /* ---------- IndexedDB 底层 ---------- */
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function done(req) {
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  }
  async function kvGet(key) {
    const db = await openDB();
    return done(db.transaction(STORE, "readonly").objectStore(STORE).get(key));
  }
  async function kvSet(key, val) {
    const db = await openDB();
    return done(db.transaction(STORE, "readwrite").objectStore(STORE).put(val, key));
  }

  /* ---------- 时间 / 格式工具 ---------- */
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => fmtDate(new Date());
  const nowStamp = () => {
    const n = new Date();
    return `${fmtDate(n)} ${pad2(n.getHours())}:${pad2(n.getMinutes())}:${pad2(n.getSeconds())}`;
  };
  const genId = () => {
    const a = new Uint8Array(6);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  // 对应 Python bool()：JSON 值里 0/""/false/null/空容器 都算假
  const pbool = (v) => !(v === false || v === 0 || v === "" || v == null ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0));

  function validDateStr(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function validTimeStr(s) {  // Python %H:%M 接受 "9:00"，保持同样的宽松度
    if (!/^\d{1,2}:\d{2}$/.test(s)) return false;
    const [h, mi] = s.split(":").map(Number);
    return h <= 23 && mi <= 59;
  }
  // 由 "YYYY-MM-DD" + "H:MM" 构造本地时间（不用 Date 构造器直接解析，Safari 兼容）
  function buildDateTime(date, time) {
    const [y, m, d] = date.split("-").map(Number);
    const [h, mi] = time.split(":").map(Number);
    return new Date(y, m - 1, d, h, mi);
  }

  /* ---------- 持久化 ---------- */
  // 数据变了就标记"有未同步的修改"（同步包防呆依据）。
  // 内存标记必须在首个 await 之前同步生效，否则紧跟着的设置读取会读到旧状态。
  async function persist() {
    const wasClean = !settings.sync_dirty;
    if (wasClean) settings.sync_dirty = true;
    await kvSet("schedule", data);
    if (wasClean) await kvSet("settings", settings);
  }
  async function persistSettings() { await kvSet("settings", settings); }

  async function init() {
    if (data) return;
    const storedData = await kvGet("schedule");
    data = (storedData && typeof storedData === "object") ? storedData : { ...DEFAULT_DATA };
    data.events = Array.isArray(data.events) ? data.events : [];
    data.reminded = Array.isArray(data.reminded) ? data.reminded : [];
    data.longterms = Array.isArray(data.longterms) ? data.longterms : [];
    const storedSettings = await kvGet("settings");
    settings = (storedSettings && typeof storedSettings === "object") ? storedSettings : {};
    settings = Object.assign({}, DEFAULT_SETTINGS, settings);
    if (!settings.sync_dirty) await persistSettings();  // 首次写入默认值
  }

  /* ---------- 设置（白名单与 storage.py 一致） ---------- */
  function getSettings() { return settings; }

  function updateSettings(payload) {
    if ("language" in payload) settings.language = payload.language === "en" ? "en" : "zh";
    if ("background" in payload) settings.background = String(payload.background ?? "").slice(0, 100);
    if ("icon" in payload) settings.icon = (payload.icon === "1" || payload.icon === 1 || payload.icon === true) ? "1" : "";
    if ("card_alpha" in payload) {
      const alpha = Number(payload.card_alpha);
      if (Number.isFinite(alpha)) settings.card_alpha = String(Math.round(Math.max(0.3, Math.min(1.0, alpha)) * 100) / 100);
    }
    if ("ai_api_key" in payload) settings.ai_api_key = String(payload.ai_api_key ?? "").trim().slice(0, 200);
    if ("ai_model" in payload) {
      const model = String(payload.ai_model ?? "").trim().slice(0, 50);
      if (model) settings.ai_model = model;
    }
    if ("sync_version" in payload) {
      const v = Number(payload.sync_version);
      if (Number.isFinite(v)) settings.sync_version = Math.max(0, Math.floor(v));
    }
    if ("sync_dirty" in payload) settings.sync_dirty = pbool(payload.sync_dirty);
    return persistSettings().then(() => settings);
  }

  /* ---------- 日程校验（对应 storage.validate_event，partial 语义一致） ---------- */
  function validateEvent(payload, partial = false) {
    const errors = [];
    const cleaned = {};
    payload = payload || {};

    if (!partial || "title" in payload) {
      const title = String(payload.title ?? "").trim();
      if (!title) errors.push("标题不能为空");
      else if (title.length > 100) errors.push("标题太长（最多100字）");
      else cleaned.title = title;
    }
    if (!partial || "date" in payload) {
      const date = String(payload.date ?? "").trim();
      if (validDateStr(date)) cleaned.date = date;
      else errors.push("日期格式应为 YYYY-MM-DD");
    }
    if (!partial || "time" in payload) {
      const time = String(payload.time ?? "").trim();
      if (validTimeStr(time)) cleaned.time = time;
      else errors.push("时间格式应为 HH:MM");
    }
    if ("notes" in payload) cleaned.notes = String(payload.notes ?? "").trim().slice(0, 500);
    if (!partial || "priority" in payload) {
      const priority = String(payload.priority ?? "中").trim();
      if (!VALID_PRIORITIES.includes(priority)) errors.push("优先级必须是 高/中/低");
      else cleaned.priority = priority;
    }
    if ("category" in payload) {
      const category = String(payload.category ?? "其他").trim().slice(0, 20);
      cleaned.category = category || "其他";
    }
    if (!partial || "category" in payload) {
      if (!("category" in cleaned)) cleaned.category = "其他";
    }
    if ("remind_minutes" in payload) {
      const minutes = Number(payload.remind_minutes);
      if (Number.isInteger(minutes)) cleaned.remind_minutes = Math.max(0, Math.min(minutes, 7 * 24 * 60));
      else errors.push("提前提醒分钟数必须是整数");
    }
    if ("done" in payload) cleaned.done = pbool(payload.done);

    return { cleaned, errors };
  }

  /* ---------- 日程 CRUD ---------- */
  function addEvent(cleaned) {
    const event = { id: genId(), created_at: nowStamp(), done: false, ...cleaned };
    data.events.push(event);
    persist();
    return event;
  }
  function updateEvent(eventId, cleaned) {
    const ev = data.events.find((e) => e.id === eventId);
    if (!ev) return null;
    Object.assign(ev, cleaned);
    persist();
    return ev;
  }
  function deleteEvent(eventId) {
    const before = data.events.length;
    data.events = data.events.filter((e) => e.id !== eventId);
    data.reminded = data.reminded.filter((r) => r !== eventId);
    if (data.events.length < before) { persist(); return true; }
    return false;
  }
  function getEvents() {
    // 按 (date, time) 字符串排序，与 storage.get_events 一致
    return [...data.events].sort((a, b) =>
      String(a.date ?? "").localeCompare(String(b.date ?? "")) ||
      String(a.time ?? "").localeCompare(String(b.time ?? "")));
  }
  function markReminded(eventId) {
    if (!data.reminded.includes(eventId)) {
      data.reminded.push(eventId);
      persist();
    }
  }

  /* ---------- 提醒到期判断（对应 storage.pop_due_reminders） ---------- */
  function popDueReminders(now = new Date()) {
    const due = [];
    let changed = false;
    for (const ev of data.events) {
      if (data.reminded.includes(ev.id) || ev.done) continue;
      if (!ev.date || !ev.time || !validDateStr(ev.date) || !validTimeStr(ev.time)) continue;
      const remindAt = new Date(buildDateTime(ev.date, ev.time).getTime() - (ev.remind_minutes || 0) * 60000);
      if (remindAt.getTime() <= now.getTime()) {
        data.reminded.push(ev.id);
        changed = true;
        // 过期超过宽限期的静默跳过（防开机补弹陈年旧通知）
        if ((now.getTime() - remindAt.getTime()) / 1000 <= REMINDER_GRACE_SECONDS) {
          due.push({ ev, remindAt: `${pad2(remindAt.getHours())}:${pad2(remindAt.getMinutes())}` });
        }
      }
    }
    if (changed) persist();
    return due;
  }

  /* ---------- 统计 / 报表 ---------- */
  function stats() {
    const events = getEvents();
    const byCategory = {}, byDate = {}, doneByDate = {};
    let done = 0;
    for (const e of events) {
      const cat = e.category || "其他";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      byDate[e.date] = (byDate[e.date] || 0) + 1;
      if (e.done) {
        done += 1;
        doneByDate[e.date] = (doneByDate[e.date] || 0) + 1;
      }
    }
    return { total: events.length, done, by_category: byCategory, by_date: byDate, done_by_date: doneByDate };
  }

  function weeklyReport(start) {
    const d0 = start && validDateStr(start) ? buildDateTime(start, "00:00") : buildDateTime(todayStr(), "00:00");
    d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));  // 回退到周一
    const days = [...Array(7)].map((_, i) => { const d = new Date(d0); d.setDate(d.getDate() + i); return fmtDate(d); });
    const keySet = new Set(days);
    const evs = getEvents().filter((e) => keySet.has(e.date));
    const byDay = {};
    days.forEach((k) => { byDay[k] = { total: 0, done: 0 }; });
    const byCategory = {};
    for (const e of evs) {
      byDay[e.date].total += 1;
      if (e.done) byDay[e.date].done += 1;
      const cat = e.category || "其他";
      if (!byCategory[cat]) byCategory[cat] = { total: 0, done: 0 };
      byCategory[cat].total += 1;
      if (e.done) byCategory[cat].done += 1;
    }
    const prevKeys = new Set(days.map((k) => { const d = buildDateTime(k, "00:00"); d.setDate(d.getDate() - 7); return fmtDate(d); }));
    const prev = getEvents().filter((e) => prevKeys.has(e.date));
    return {
      week_start: days[0], week_end: days[6],
      total: evs.length, done: evs.filter((e) => e.done).length,
      by_day: byDay, by_category: byCategory,
      prev_total: prev.length, prev_done: prev.filter((e) => e.done).length,
    };
  }

  function overallReport() {
    const evs = getEvents();
    const byCategory = {};
    const now = new Date();
    let y = now.getFullYear(), m = now.getMonth() + 1;
    const months = [];
    for (let i = 0; i < 6; i++) {
      months.push(`${String(y).padStart(4, "0")}-${pad2(m)}`);
      m -= 1;
      if (m === 0) { m = 12; y -= 1; }
    }
    months.reverse();
    const byMonth = {};
    months.forEach((mk) => { byMonth[mk] = { total: 0, done: 0 }; });
    const weekdayDone = [0, 0, 0, 0, 0, 0, 0];

    for (const e of evs) {
      const cat = e.category || "其他";
      if (!byCategory[cat]) byCategory[cat] = { total: 0, done: 0 };
      byCategory[cat].total += 1;
      if (e.done) {
        byCategory[cat].done += 1;
        if (validDateStr(e.date)) weekdayDone[buildDateTime(e.date, "00:00").getDay() === 0 ? 6 : buildDateTime(e.date, "00:00").getDay() - 1] += 1;
      }
      const mk = String(e.date ?? "").slice(0, 7);
      if (mk in byMonth) {
        byMonth[mk].total += 1;
        if (e.done) byMonth[mk].done += 1;
      }
    }
    let best = null;
    if (weekdayDone.some((n) => n > 0)) best = weekdayDone.indexOf(Math.max(...weekdayDone));
    return {
      total: evs.length, done: evs.filter((e) => e.done).length,
      by_category: byCategory, by_month: byMonth,
      weekday_done: weekdayDone, best_weekday: best,
    };
  }

  /* ---------- 长期任务 ---------- */
  function validateDeadline(value) {
    const deadline = String(value || "").trim();
    if (!deadline) return { cleaned: "", error: null };
    if (validDateStr(deadline)) return { cleaned: deadline, error: null };
    return { cleaned: "", error: "截止日期格式应为 YYYY-MM-DD" };
  }

  function validateLongterm(payload, partial = false) {
    const errors = [];
    const cleaned = {};
    payload = payload || {};
    if (!partial || "title" in payload) {
      const title = String(payload.title ?? "").trim();
      if (!title) errors.push("标题不能为空");
      else if (title.length > 100) errors.push("标题太长（最多100字）");
      else cleaned.title = title;
    }
    if (!partial || "deadline" in payload) {
      const deadline = String(payload.deadline ?? "").trim();
      if (!deadline) cleaned.deadline = "";
      else if (validDateStr(deadline)) cleaned.deadline = deadline;
      else errors.push("截止日期格式应为 YYYY-MM-DD");
    }
    if ("notes" in payload) cleaned.notes = String(payload.notes ?? "").trim().slice(0, 500);
    return { cleaned, errors };
  }

  function getLongterms() { return data.longterms; }

  function addLongterm(cleaned) {
    const lt = { id: genId(), created_at: nowStamp(), milestones: [], ...cleaned };
    data.longterms.push(lt);
    persist();
    return lt;
  }
  function updateLongterm(ltId, cleaned) {
    const lt = data.longterms.find((x) => x.id === ltId);
    if (!lt) return null;
    Object.assign(lt, cleaned);
    persist();
    return lt;
  }
  function deleteLongterm(ltId) {
    const before = data.longterms.length;
    data.longterms = data.longterms.filter((x) => x.id !== ltId);
    if (data.longterms.length < before) { persist(); return true; }
    return false;
  }

  function addMilestone(ltId, text, deadline = "") {
    const t = String(text || "").trim().slice(0, 200);
    if (!t) return { ms: null, errors: ["子任务内容不能为空"] };
    const dl = validateDeadline(deadline);
    if (dl.error) return { ms: null, errors: [dl.error] };
    const lt = data.longterms.find((x) => x.id === ltId);
    if (!lt) return { ms: null, errors: ["长期任务不存在"] };
    const ms = { id: genId(), text: t, done: false, deadline: dl.cleaned };
    lt.milestones.push(ms);
    persist();
    return { ms, errors: [] };
  }

  function updateMilestone(ltId, msId, payload) {
    const lt = data.longterms.find((x) => x.id === ltId);
    if (!lt) return null;
    const ms = lt.milestones.find((m) => m.id === msId);
    if (!ms) return null;
    if ("done" in payload) ms.done = pbool(payload.done);
    if ("text" in payload) {
      const t = String(payload.text).trim().slice(0, 200);
      if (t) ms.text = t;
    }
    if ("deadline" in payload) {
      const dl = validateDeadline(payload.deadline);
      if (dl.error) return null;
      ms.deadline = dl.cleaned;
    }
    persist();
    return ms;
  }

  function deleteMilestone(ltId, msId) {
    const lt = data.longterms.find((x) => x.id === ltId);
    if (!lt) return false;
    const before = lt.milestones.length;
    lt.milestones = lt.milestones.filter((m) => m.id !== msId);
    if (lt.milestones.length < before) { persist(); return true; }
    return false;
  }

  // 按传入 id 顺序重排；缺失的 id 保持在末尾原相对顺序；顺序没变不写（幂等）
  function reorderLongterms(orderIds) {
    const items = Object.fromEntries(data.longterms.map((lt) => [lt.id, lt]));
    const ordered = orderIds.filter((i) => i in items).map((i) => items[i]);
    ordered.push(...data.longterms.filter((lt) => !orderIds.includes(lt.id)));
    const before = data.longterms.map((lt) => lt.id).join(",");
    if (ordered.map((lt) => lt.id).join(",") !== before) {
      data.longterms = ordered;
      persist();
      return true;
    }
    return false;
  }

  function reorderMilestones(ltId, orderIds) {
    const lt = data.longterms.find((x) => x.id === ltId);
    if (!lt) return false;
    const items = Object.fromEntries(lt.milestones.map((m) => [m.id, m]));
    const ordered = orderIds.filter((i) => i in items).map((i) => items[i]);
    ordered.push(...lt.milestones.filter((m) => !orderIds.includes(m.id)));
    const before = lt.milestones.map((m) => m.id).join(",");
    if (ordered.map((m) => m.id).join(",") !== before) {
      lt.milestones = ordered;
      persist();
      return true;
    }
    return false;
  }

  /* ---------- 背景图（本地模式存 IndexedDB blob） ---------- */
  async function setBackground(blob) { await kvSet("background", blob); }
  async function getBackground() { return kvGet("background"); }
  async function deleteBackground() {
    const db = await openDB();
    await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete("background"));
  }

  /* ---------- 同步包 ---------- */
  async function exportPackage() {
    settings.sync_version = Math.max(0, Number(settings.sync_version) || 0) + 1;
    settings.sync_dirty = false;
    await persistSettings();
    return {
      kind: SYNC_KIND,
      version: settings.sync_version,
      exported_at: nowStamp().slice(0, 16),
      device: "phone",
      data: { events: data.events, reminded: data.reminded, longterms: data.longterms },
    };
  }

  async function importPackage(pkg) {
    if (!pkg || typeof pkg !== "object" || pkg.kind !== SYNC_KIND) {
      return { result: null, errors: ["不是有效的日程助手同步包"] };
    }
    const d = pkg.data;
    if (!d || typeof d !== "object" || !Array.isArray(d.events) ||
        !Array.isArray(d.longterms) || !Array.isArray(d.reminded)) {
      return { result: null, errors: ["同步包数据不完整"] };
    }
    data = { events: d.events, reminded: d.reminded, longterms: d.longterms };
    await kvSet("schedule", data);  // 直接写，不走 persist()（导入不算本地新修改）
    settings.sync_version = Math.max(0, Number(pkg.version) || 0);
    settings.sync_dirty = false;
    await persistSettings();
    return { result: { events: data.events.length, longterms: data.longterms.length }, errors: [] };
  }

  return {
    init, getSettings, updateSettings,
    validateEvent, addEvent, updateEvent, deleteEvent, getEvents, markReminded, popDueReminders,
    stats, weeklyReport, overallReport,
    validateLongterm, getLongterms, addLongterm, updateLongterm, deleteLongterm,
    addMilestone, updateMilestone, deleteMilestone, reorderLongterms, reorderMilestones,
    setBackground, getBackground, deleteBackground,
    exportPackage, importPackage,
  };
})();
