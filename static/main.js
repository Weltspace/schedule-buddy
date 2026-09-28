/* 日程助手前端逻辑：视图渲染、中英切换、长期任务、背景图片、报表 */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* 线性小图标（feather 风格，描边继承 currentColor） */
const ICONS = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
};

/* ---------- i18n（只翻译界面文字；日程内容、分类/优先级的存储值保持中文） ---------- */
const I18N = {
  zh: {
    app_title: "日程助手",
    tab_day: "今天", tab_week: "本周", tab_stats: "统计", tab_long: "长期任务", btn_new: "＋ 新建日程",
    chip_all: "全部", chip_work: "工作", chip_life: "生活", chip_study: "学习", chip_other: "其他",
    pri_all: "全部优先级", pri_high: "🔴 高", pri_med: "🟡 中", pri_low: "🟢 低",
    hide_done: "隐藏已完成",
    day_prev: "‹ 前一天", day_next: "后一天 ›", week_prev: "‹ 上一周", week_next: "下一周 ›",
    cap_total: "全部日程", cap_done: "已完成", cap_pending: "待办中", cap_rate: "完成率",
    hm_title: "本月日程热力图", hm_less: "少", hm_more: "多", cat_title: "分类占比",
    rep_weekly: "周报", rep_overall: "总报告",
    modal_new: "新建日程", modal_edit: "编辑日程",
    f_title: "标题", ph_title: "要做什么？", f_date: "日期", f_time: "时间",
    f_priority: "优先级", f_category: "分类", f_remind: "提前提醒",
    r_none: "不提醒", r_5: "提前 5 分钟", r_15: "提前 15 分钟", r_30: "提前 30 分钟",
    r_60: "提前 1 小时", r_1440: "提前 1 天",
    f_notes: "备注", ph_notes: "补充说明（可选）", btn_cancel: "取消", btn_save: "保存",
    lt_title: "长期任务", ph_lt_title: "要长期坚持的目标…", lt_add: "添加", ddl_label: "截止日期",
    lt_empty: "还没有长期任务，给自己立一个吧！", lt_add_ms: "＋ 添加子任务",
    lt_days_left: "剩 {n} 天", lt_overdue: "已过 {n} 天", lt_ms_empty: "还没有子任务",
    ph_lt_ms: "添加子任务…", lt_confirm_del: "删除长期任务「{t}」？",
    settings_title: "设置", set_lang: "语言", set_bg: "背景图片", set_icon: "软件图标",
    bg_drop: "把图片拖到这里，或点击选择", bg_drop_sub: "只更换界面背景",
    bg_reset: "恢复默认背景", bg_hint: "✓ 背景已更新", bg_bad_type: "请选择图片文件",
    icon_drop: "把图片拖到这里，或点击选择",
    icon_drop_sub: "自动裁成方形，同步更换托盘和桌面快捷方式图标",
    icon_reset: "恢复默认图标", icon_hint: "✓ 图标已更新（托盘 + 桌面快捷方式）",
    icon_hint_reset: "✓ 已恢复默认图标", settings_close: "关闭",
    set_alpha: "界面透明度（使用背景图时）",
    today: "今天", act_done: "✓ 完成", act_undo: "取消完成", act_edit: "编辑", act_del: "删除",
    empty_day: "这一天还没有安排",
    u_min: "分钟", u_hour: "小时", u_day: "天", remind_fmt: "提前{t}",
    hm_tip: "{ds} · {n} 项日程（完成 {m}）", cr_cnt: "{n} 项（完成 {m}）",
    n_items: "{n} 项",
    stats_empty: "还没有日程数据",
    confirm_del: "删除日程「{t}」？",
    toast_starts: "{d} {t} 开始", toast_pri: "优先级{p}",
    rp_summary: "本周完成 {done}/{total} 项（完成率 {rate}%）{delta}",
    rp_delta_more: "，比上周多 {n} 项", rp_delta_less: "，比上周少 {n} 项", rp_delta_same: "，与上周持平",
    rp_days: "按天", rp_cats: "按分类", rp_trend: "近 6 个月", rp_done_cnt: "完成 {n}",
    rp_best: "最常完成的日子：{d}", rp_no_data: "还没有日程数据",
    rep_total: "日程总数", rep_done: "已完成", rep_rate: "完成率",
    tab_ai: "AI 助手", tab_air: "AI 分析",
    ai_welcome: "你好！我是你的 AI 助手。用一句话告诉我你的安排，我可以直接帮你添加、修改日程和长期任务，也可以一次安排好几个。",
    ai_thinking: "思考中…", ph_ai: "用一句话告诉我你的安排，比如：明天下午3点提醒我开会",
    ai_send: "发送",
    ai_need_key: "请先到 ⚙ 设置里填写智谱 API Key 再使用 AI 功能",
    ai_hints: ["帮我安排今天的任务", "帮我规划这一周", "我最近进度怎么样？"],
    air_start: "开始分析",
    air_timeout: "分析超时或中断了，请重试",
    ai_net_err: "网络错误，请稍后再试",
    air_summary: "总体评价", air_insights: "洞察与建议",
    air_heatmap: "近 90 天完成热力图", air_rate: "完成率", air_upcoming: "未来 7 天",
    cap_overdue: "逾期子任务",
    air_sc_w: "周分析", air_sc_m: "月分析", air_sc_l: "长期分析",
    air_up_w: "未来 7 天",
    air_chart_w: "本周每日完成", air_chart_m: "近 4 周完成", air_chart_l: "各目标进度",
    air_up_l: "目标截止",
    air_cap_w_total: "本周日程", air_cap_m_total: "月内日程",
    air_cap_l_goals: "长期目标", air_cap_l_sdone: "已完成步骤", air_cap_l_stotal: "步骤总数",
    air_cap_l_over: "逾期步骤", air_no_deadline: "未设截止",
    air_up_long_empty: "没有设截止日期的目标",
    air_streak: "🔥 连续 {n} 天有完成", air_streak_zero: "最近还没有完成记录",
    air_up_empty: "未来 7 天没有安排，享受空闲吧 🌿",
    air_analyzing: "分析中…", air_need_first: "先点上面的「开始分析」", ph_air: "分析完成后可以继续追问",
    set_ai: "AI 功能（智谱 GLM）", set_ai_key: "API Key", set_ai_model: "模型",
    set_ai_save: "保存 AI 设置", ai_key_ok: "已设置 ✓", ai_key_none: "未设置", ai_key_saved: "已保存 ✓",
    set_sync: "数据同步", sync_export: "导出同步包", sync_import: "导入同步包",
    sync_state: "同步版本 {v} · {d}",
    sync_dirty_yes: "有未同步的修改", sync_dirty_no: "与上次同步一致",
    sync_bad_file: "不是有效的日程助手同步包",
    sync_confirm: "导入该同步包将覆盖本地数据（导出于 {time}，版本 {v}，含 {n} 条日程、{m} 个长期任务）。\n确定导入？",
    sync_confirm_dirty: "注意：本地有未同步的修改，导入会覆盖它们！\n（导出于 {time}，版本 {v}，含 {n} 条日程、{m} 个长期任务）\n确定覆盖？",
    sync_done: "✓ 导入成功（{n} 条日程、{m} 个长期任务）",
    sync_exported: "✓ 已导出，把文件发到另一台设备导入即可同步",
    sync_saved: "✓ 已保存到下载文件夹：{p}",
    sync_exported_toast: "✓ 同步包已导出（下载文件夹）",
    sync_fail: "同步操作失败",
  },
  en: {
    app_title: "Schedule Buddy",
    tab_day: "Today", tab_week: "This Week", tab_stats: "Stats", tab_long: "Goals", btn_new: "＋ New Event",
    chip_all: "All", chip_work: "Work", chip_life: "Life", chip_study: "Study", chip_other: "Other",
    pri_all: "All priorities", pri_high: "🔴 High", pri_med: "🟡 Med", pri_low: "🟢 Low",
    hide_done: "Hide completed",
    day_prev: "‹ Prev Day", day_next: "Next Day ›", week_prev: "‹ Prev Week", week_next: "Next Week ›",
    cap_total: "Total", cap_done: "Completed", cap_pending: "Pending", cap_rate: "Completion",
    hm_title: "This Month", hm_less: "Less", hm_more: "More", cat_title: "By Category",
    rep_weekly: "Weekly Report", rep_overall: "Overall Report",
    modal_new: "New Event", modal_edit: "Edit Event",
    f_title: "Title", ph_title: "What needs doing?", f_date: "Date", f_time: "Time",
    f_priority: "Priority", f_category: "Category", f_remind: "Reminder",
    r_none: "None", r_5: "5 min before", r_15: "15 min before", r_30: "30 min before",
    r_60: "1 hour before", r_1440: "1 day before",
    f_notes: "Notes", ph_notes: "Details (optional)", btn_cancel: "Cancel", btn_save: "Save",
    lt_title: "Long-term Goals", ph_lt_title: "A long-term goal…", lt_add: "Add", ddl_label: "Due date",
    lt_empty: "No goals yet — add one!", lt_add_ms: "＋ Add a step",
    lt_days_left: "{n}d left", lt_overdue: "{n}d overdue", lt_ms_empty: "No steps yet",
    ph_lt_ms: "Add a step…", lt_confirm_del: "Delete goal \"{t}\"?",
    settings_title: "Settings", set_lang: "Language", set_bg: "Background Image", set_icon: "App Icon",
    bg_drop: "Drag an image here, or click to pick", bg_drop_sub: "Changes the app background only",
    bg_reset: "Reset background", bg_hint: "✓ Background updated", bg_bad_type: "Please choose an image file",
    icon_drop: "Drag an image here, or click to pick",
    icon_drop_sub: "Auto-cropped to square; updates tray & desktop shortcut icon",
    icon_reset: "Reset icon", icon_hint: "✓ Icon updated (tray & desktop shortcut)",
    icon_hint_reset: "✓ Default icon restored", settings_close: "Close",
    set_alpha: "UI opacity (with background image)",
    today: "Today", act_done: "✓ Done", act_undo: "Unmark", act_edit: "Edit", act_del: "Delete",
    empty_day: "Nothing scheduled this day",
    u_min: "min", u_hour: "h", u_day: "d", remind_fmt: "{t} before",
    hm_tip: "{ds} · {n} events ({m} done)", cr_cnt: "{n} ({m} done)",
    n_items: "{n} items",
    stats_empty: "No schedule data yet",
    confirm_del: "Delete event \"{t}\"?",
    toast_starts: "Starts {d} {t}", toast_pri: "priority {p}",
    rp_summary: "Completed {done}/{total} this week ({rate}%){delta}",
    rp_delta_more: ", {n} more than last week", rp_delta_less: ", {n} fewer than last week", rp_delta_same: ", same as last week",
    rp_days: "By day", rp_cats: "By category", rp_trend: "Last 6 months", rp_done_cnt: "{n} done",
    rp_best: "Most productive day: {d}", rp_no_data: "No schedule data yet",
    rep_total: "Total", rep_done: "Completed", rep_rate: "Completion",
    tab_ai: "AI Assistant", tab_air: "AI Insights",
    ai_welcome: "Hi! I'm your AI assistant. Tell me your plans in one sentence and I'll add, edit or remove events and goals for you — several at once is fine.",
    ai_thinking: "Thinking…", ph_ai: "e.g. Remind me to meet the team at 3pm tomorrow",
    ai_send: "Send",
    ai_need_key: "Please set your GLM API Key in ⚙ Settings first",
    ai_hints: ["Plan my day", "Help me plan this week", "How am I doing lately?"],
    air_start: "Analyze",
    air_timeout: "Analysis timed out or was interrupted — please retry",
    ai_net_err: "Network error, please try again later",
    air_summary: "Overview", air_insights: "Insights & suggestions",
    air_heatmap: "Last 90 days", air_rate: "Completion rate", air_upcoming: "Next 7 days",
    cap_overdue: "Overdue steps",
    air_sc_w: "Weekly", air_sc_m: "Monthly", air_sc_l: "Goals",
    air_up_w: "Next 7 days",
    air_chart_w: "This week by day", air_chart_m: "Last 4 weeks", air_chart_l: "Goal progress",
    air_up_l: "Deadlines",
    air_cap_w_total: "This week", air_cap_m_total: "This month",
    air_cap_l_goals: "Goals", air_cap_l_sdone: "Steps done", air_cap_l_stotal: "Steps total",
    air_cap_l_over: "Overdue steps", air_no_deadline: "No deadline",
    air_up_long_empty: "No goals with deadlines",
    air_streak: "🔥 {n}-day streak", air_streak_zero: "No completions recently",
    air_up_empty: "Nothing scheduled — enjoy the break 🌿",
    air_analyzing: "Analyzing…", air_need_first: "Click \"Analyze\" above first", ph_air: "Ask follow-up questions after analyzing",
    set_ai: "AI (Zhipu GLM)", set_ai_key: "API Key", set_ai_model: "Model",
    set_ai_save: "Save AI settings", ai_key_ok: "Set ✓", ai_key_none: "Not set", ai_key_saved: "Saved ✓",
    set_sync: "Data Sync", sync_export: "Export sync file", sync_import: "Import sync file",
    sync_state: "Sync version {v} · {d}",
    sync_dirty_yes: "unsynced changes", sync_dirty_no: "up to date",
    sync_bad_file: "Not a valid Schedule Buddy sync file",
    sync_confirm: "Importing this sync file will overwrite local data (exported {time}, version {v}: {n} events, {m} goals).\nImport anyway?",
    sync_confirm_dirty: "Warning: this device has unsynced changes that will be overwritten!\n(exported {time}, version {v}: {n} events, {m} goals)\nOverwrite anyway?",
    sync_done: "✓ Imported ({n} events, {m} goals)",
    sync_exported: "✓ Exported — send this file to your other device to sync",
    sync_saved: "✓ Saved to your Downloads folder: {p}",
    sync_exported_toast: "✓ Sync file exported (Downloads folder)",
    sync_fail: "Sync failed",
  },
};
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOWS = { zh: ["一", "二", "三", "四", "五", "六", "日"], en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] };
const WD_FULL = {
  zh: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};
const CAT_EN = { "工作": "Work", "生活": "Life", "学习": "Study", "其他": "Other" };
const PRI_EN = { "高": "High", "中": "Med", "低": "Low" };

let lang = "zh";
const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.zh[k] || k;
function tf(key, map) {
  let s = t(key);
  for (const [k, v] of Object.entries(map || {})) s = s.split(`{${k}}`).join(String(v));
  return s;
}
const catLabel = (c) => (lang === "en" ? (CAT_EN[c] || c) : c);
const priLabel = (p) => (lang === "en" ? (PRI_EN[p] || p) : p);

/* ---------- 工具 ---------- */
const fmtDate = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"),
        day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayStr = () => fmtDate(new Date());
const parseDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
function mondayOf(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}
function fmtShort(d) {
  return lang === "zh"
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${MONTHS_EN[d.getMonth()]} ${d.getDate()}`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function remindLabel(min) {
  if (min >= 1440) return tf("remind_fmt", { t: `${min / 1440} ${t("u_day")}` });
  if (min >= 60) return tf("remind_fmt", { t: `${min / 60} ${t("u_hour")}` });
  return tf("remind_fmt", { t: `${min} ${t("u_min")}` });
}

/* ---------- 状态 ---------- */
let events = [];
let view = "day";
let filterCat = "全部";
let filterPriority = "全部";
let hideDone = false;
let editingId = null;   // null = 新建，否则为编辑
let weekAnchor = null;  // 周视图锚点日期
let longterms = [];     // 长期任务
let bgVersion = "";     // 背景图缓存戳，"" 表示默认背景
let reportWeek = null;  // 周报锚点（周一的 Date）

/* ---------- 数据（全部走 API 门面：电脑版走 Flask，手机/离线版走本地实现） ---------- */
async function loadEvents() {
  const data = await API.loadEvents();
  events = data.events;
  render();
}

function saveEvent(payload) {
  return editingId ? API.updateEvent(editingId, payload) : API.addEvent(payload);
}

async function toggleDone(ev) {
  await API.updateEvent(ev.id, { done: !ev.done });
  await loadEvents();
}

async function deleteEvent(ev) {
  if (!confirm(tf("confirm_del", { t: ev.title }))) return;
  await API.deleteEvent(ev.id);
  await loadEvents();
}

/* ---------- 筛选 ---------- */
function filtered(list) {
  return list.filter(e =>
    (filterPriority === "全部" || e.priority === filterPriority) &&
    (!hideDone || !e.done));
}

/* ---------- 渲染 ---------- */
function render() {
  $("#view-day").classList.toggle("hidden", view !== "day");
  $("#view-lt").classList.toggle("hidden", view !== "lt");
  $("#view-ai").classList.toggle("hidden", view !== "ai");
  $("#view-air").classList.toggle("hidden", view !== "air");
  // 只有日视图需要日程筛选栏
  document.body.classList.toggle("no-filters", view !== "day");
  if (view === "day") renderDay();
  if (view === "lt") renderLongterms();
  if (view === "ai") scrollChat($("#ai-chat"));
  if (view === "air") scrollChat($("#air-chat"));
}

function eventCardHTML(ev) {
  return `
  <div class="event-card p-${escapeHtml(ev.priority)} ${ev.done ? "done" : ""}" data-id="${ev.id}">
    <div class="ev-time">${escapeHtml(ev.time)}</div>
    <div class="ev-main">
      <div class="ev-title"><span class="ev-dot"></span>${escapeHtml(ev.title)}</div>
      <div class="ev-meta">
        ${ev.remind_minutes > 0 ? `<span class="ev-remind">🔔 ${escapeHtml(remindLabel(ev.remind_minutes))}</span>` : ""}${ev.notes ? `<span class="ev-notes" title="${escapeHtml(ev.notes)}">${escapeHtml(ev.notes)}</span>` : ""}
      </div>
    </div>
    <div class="ev-actions">
      <button class="ev-act act-done" title="${ev.done ? t("act_undo") : t("act_done")}">${ev.done ? ICONS.undo : ICONS.check}</button>
      <button class="ev-act act-edit" title="${t("act_edit")}">${ICONS.pencil}</button>
      <button class="ev-act act-del" title="${t("act_del")}">${ICONS.trash}</button>
    </div>
  </div>`;
}

function renderDay() {
  const d = $("#day-picker").value || todayStr();
  $("#day-picker").value = d;
  const dt = parseDate(d);
  const dow = DOWS[lang][(dt.getDay() + 6) % 7];
  $("#day-label").textContent = (lang === "zh" ? `${fmtShort(dt)} 星期${dow}` : `${dow}, ${fmtShort(dt)}`)
    + (d === todayStr() ? ` · ${t("today")}` : "");
  const list = filtered(events.filter(e => e.date === d));
  $("#day-list").innerHTML = list.length
    ? list.map(eventCardHTML).join("")
    : `<div class="empty"><span class="big">🌤️</span>${t("empty_day")}</div>`;
}

function renderWeek() {
  weekAnchor = weekAnchor || new Date();
  const mon = mondayOf(weekAnchor);
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(mon); d.setDate(d.getDate() + i); return d;
  });
  $("#week-label").textContent = `${fmtShort(days[0])} - ${fmtShort(days[6])}`;
  $("#week-grid").innerHTML = days.map(d => {
    const ds = fmtDate(d);
    const list = filtered(events.filter(e => e.date === ds));
    const cls = ds === todayStr() ? " today-col" : "";
    return `
    <div class="week-col${cls}">
      <div class="wc-head">
        <div class="dow">${DOWS[lang][(d.getDay() + 6) % 7]}${ds === todayStr() ? ` ·${t("today")}` : ""}</div>
        <div class="dnum ${list.length ? "has" : ""}">${d.getDate()}</div>
      </div>
      ${list.map(ev => `
        <div class="wc-event p-${escapeHtml(ev.priority)} ${ev.done ? "done" : ""}" data-id="${ev.id}">
          <div class="t">${escapeHtml(ev.time)}</div>
          <div class="n">${escapeHtml(ev.title)}</div>
        </div>`).join("")}
    </div>`;
  }).join("");
}

async function renderStats() {
  const s = await API.getStats();
  $("#st-total").textContent = s.total;
  $("#st-done").textContent = s.done;
  $("#st-pending").textContent = s.total - s.done;
  $("#st-rate").textContent = s.total ? Math.round(s.done / s.total * 100) + "%" : "0%";

  // 热力图：本月日历（周一起始）
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  $("#hm-label").textContent = lang === "zh" ? `${y} 年 ${m + 1} 月` : `${MONTHS_EN[m]} ${y}`;
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;              // 周一前的空格数
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const maxCount = Math.max(1, ...Object.values(s.by_date));
  let html = DOWS[lang].map(d => `<div class="hm-dow">${d}</div>`).join("");
  for (let i = 0; i < lead; i++) html += `<div class="hm-cell other-month"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const cnt = s.by_date[ds] || 0;
    const doneCnt = s.done_by_date[ds] || 0;
    const level = cnt === 0 ? 0 : Math.ceil(cnt / maxCount * 3);
    html += `<div class="hm-cell l${level} ${ds === todayStr() ? "today-cell" : ""}">
      <span class="tip">${escapeHtml(tf("hm_tip", { ds, n: cnt, m: doneCnt }))}</span></div>`;
  }
  $("#heatmap").innerHTML = html;

  // 分类占比
  const rows = Object.entries(s.by_category).sort((a, b) => b[1] - a[1]);
  const total = s.total || 1;
  const colors = { "工作": "#4f6ef7", "生活": "#10b981", "学习": "#f59e0b", "其他": "#8b5cf6" };
  $("#cat-stats").innerHTML = rows.length
    ? rows.map(([cat, n]) => `
      <div class="cat-row">
        <div class="cr-head"><span>${escapeHtml(catLabel(cat))}</span>
          <span class="cnt">${escapeHtml(tf("n_items", { n }))}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${n / total * 100}%;
          background:${colors[cat] || "#8b5cf6"}"></div></div>
      </div>`).join("")
    : `<div class="empty" style="padding:30px 0">${t("stats_empty")}</div>`;

  renderReports();
}

/* ---------- 报表（周报 / 总报告） ---------- */
const CAT_COLORS = { "工作": "#4f6ef7", "生活": "#10b981", "学习": "#f59e0b", "其他": "#8b5cf6" };

function catRows(byCat) {
  const total = Math.max(1, Object.values(byCat).reduce((s, c) => s + c.total, 0));
  const rows = Object.entries(byCat).sort((a, b) => b[1].total - a[1].total);
  return rows.map(([cat, c]) => `
    <div class="cat-row">
      <div class="cr-head"><span>${escapeHtml(catLabel(cat))}</span>
        <span class="cnt">${escapeHtml(tf("cr_cnt", { n: c.total, m: c.done }))}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${c.total / total * 100}%;
        background:${CAT_COLORS[cat] || "#8b5cf6"}"></div></div>
    </div>`).join("");
}

function rdCols(entries, labelOf) {
  const max = Math.max(1, ...entries.map(([, v]) => v.total));
  return `<div class="rd-cols">` + entries.map(([k, v]) => {
    const h = Math.round(v.total / max * 100);
    const dh = v.total ? Math.round(v.done / v.total * 100) : 0;
    return `
      <div class="rd-col" title="${k} · ${v.total} / ${v.done}">
        <div class="rd-num">${v.total || ""}</div>
        <div class="rd-bar"><div class="rd-fill" style="height:${h}%"><div class="rd-done" style="height:${dh}%"></div></div></div>
        <div class="rd-dow">${labelOf(k)}</div>
      </div>`;
  }).join("") + `</div>`;
}

function renderWeeklyReport(w) {
  $("#rp-label").textContent = `${fmtShort(parseDate(w.week_start))} - ${fmtShort(parseDate(w.week_end))}`;
  const rate = w.total ? Math.round(w.done / w.total * 100) : 0;
  const diff = w.total - w.prev_total;
  const delta = diff > 0 ? tf("rp_delta_more", { n: diff })
    : diff < 0 ? tf("rp_delta_less", { n: -diff }) : t("rp_delta_same");
  const hasData = w.total || w.prev_total;
  $("#rp-weekly").innerHTML = hasData ? `
    <div class="rp-summary">${escapeHtml(tf("rp_summary", { done: w.done, total: w.total, rate, delta }))}</div>
    <div class="rp-sub">${t("rp_days")}</div>
    ${rdCols(Object.entries(w.by_day), (ds) => DOWS[lang][(parseDate(ds).getDay() + 6) % 7])}
    <div class="rp-sub">${t("rp_cats")}</div>
    ${w.total ? catRows(w.by_category) : ""}
  ` : `<div class="empty" style="padding:20px 0">${t("rp_no_data")}</div>`;
}

function renderOverallReport(o) {
  if (!o.total) {
    $("#rp-overall").innerHTML = `<div class="empty" style="padding:20px 0">${t("rp_no_data")}</div>`;
    return;
  }
  const rate = Math.round(o.done / o.total * 100);
  const monthLabel = (mk) => lang === "zh" ? `${mk.slice(5)}月` : MONTHS_EN[Number(mk.slice(5, 7)) - 1];
  const best = o.best_weekday != null
    ? `<div class="rp-summary">${escapeHtml(tf("rp_best", { d: WD_FULL[lang][o.best_weekday] }))}</div>`
    : "";
  $("#rp-overall").innerHTML = `
    <div class="rp-nums">
      <div><b>${o.total}</b><span>${t("rep_total")}</span></div>
      <div><b>${o.done}</b><span>${t("rep_done")}</span></div>
      <div><b>${rate}%</b><span>${t("rep_rate")}</span></div>
    </div>
    <div class="rp-sub">${t("rp_trend")}</div>
    ${rdCols(Object.entries(o.by_month), monthLabel)}
    ${best}
    <div class="rp-sub">${t("rp_cats")}</div>
    ${catRows(o.by_category)}`;
}

async function renderReports() {
  const mon = mondayOf(reportWeek || new Date());
  reportWeek = mon;
  try {
    const [w, o] = await Promise.all([
      API.getWeeklyReport(fmtDate(mon)),
      API.getOverallReport(),
    ]);
    renderWeeklyReport(w);
    renderOverallReport(o);
  } catch (_) { /* 服务未就绪时静默 */ }
}

/* ---------- 弹窗 ---------- */
function openModal(ev = null, presetDate = null) {
  editingId = ev ? ev.id : null;
  $("#modal-title").textContent = ev ? t("modal_edit") : t("modal_new");
  $("#f-title").value = ev?.title || "";
  $("#f-date").value = ev?.date || presetDate || $("#day-picker").value || todayStr();
  $("#f-time").value = ev?.time || "09:00";
  $("#f-priority").value = ev?.priority || "中";
  $("#f-remind").value = String(ev?.remind_minutes ?? 15);
  $("#f-notes").value = ev?.notes || "";
  $("#form-error").classList.add("hidden");
  $("#modal-mask").classList.remove("hidden");
  $("#f-title").focus();
}
function closeModal() { $("#modal-mask").classList.add("hidden"); }

/* ---------- Toast ---------- */
function showToast(title, sub) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="t-title">${escapeHtml(title)}</div><div class="t-sub">${escapeHtml(sub)}</div>`;
  el.onclick = () => el.remove();
  $("#toast-box").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, 8000);
}

async function pollReminders() {
  try {
    const data = await API.pollReminders();
    for (const r of data.reminders) {
      showToast(`⏰ ${r.title}`, `${tf("toast_starts", { d: r.date, t: r.time })} · ${tf("toast_pri", { p: priLabel(r.priority) })}`);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(`⏰ ${r.title}`, { body: tf("toast_starts", { d: r.date, t: r.time }) });
      }
    }
  } catch (_) { /* 服务未启动时静默 */ }
}

/* ---------- 中英切换 ---------- */
function applyLang() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = t("app_title");
  $$("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $$(".lang-btn").forEach(b => b.classList.toggle("active", b.dataset.lang === lang));
  $$(".ddl-input").forEach(ddlUpdate);  // 按语言刷新截止日期按钮文字
  // 欢迎语和示例只填一次，避免覆盖聊天记录
  const welcome = $("#ai-chat .ai-bubble");
  if (welcome && !welcome.textContent) welcome.textContent = t("ai_welcome");
  renderAiHints();
  render();
  renderLongterms();
}

/* ---------- 长期任务 ---------- */
function ltProgress(lt) {
  const total = lt.milestones.length;
  if (!total) return { total: 0, done: 0, pct: 0 };
  const done = lt.milestones.filter(m => m.done).length;
  return { total, done, pct: Math.round(done / total * 100) };
}

async function loadLongterms() {
  try {
    longterms = (await API.getLongterms()).longterms;
  } catch (_) {
    longterms = [];
  }
  renderLongterms();
}

function deadlineBits(deadline) {
  if (!deadline) return "";
  const days = Math.round((parseDate(deadline) - parseDate(todayStr())) / 86400000);
  const state = days >= 0
    ? escapeHtml(tf("lt_days_left", { n: days }))
    : `<span class="lt-overdue">${escapeHtml(tf("lt_overdue", { n: -days }))}</span>`;
  return `<span>📅 ${fmtShort(parseDate(deadline))} · ${state}</span>`;
}

/* ---------- 截止日期选择按钮 ----------
 * 隐藏原生日期输入（避免显示 yyyy/mm/日），点击按钮打开系统日期选择器；
 * 选中后按钮显示所选日期，旁边出现 ✕ 可清除。 */
function ddlPickHTML(value, compact = "") {
  return `
  <span class="ddl-pick ${compact}">
    <input type="date" class="ddl-input" value="${value || ""}">
    <button type="button" class="ddl-btn">📅 <span class="ddl-text">${value ? fmtShort(parseDate(value)) : escapeHtml(t("ddl_label"))}</span></button>
    <button type="button" class="ddl-clear ${value ? "" : "hidden"}">✕</button>
  </span>`;
}
function ddlUpdate(input) {
  const wrap = input.closest(".ddl-pick");
  if (!wrap) return;
  wrap.querySelector(".ddl-text").textContent =
    input.value ? fmtShort(parseDate(input.value)) : t("ddl_label");
  wrap.querySelector(".ddl-clear").classList.toggle("hidden", !input.value);
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".ddl-btn");
  if (btn) {
    const input = btn.parentElement.querySelector(".ddl-input");
    try {
      input.showPicker();
    } catch (_) {
      input.focus();  // 老内核兜底
    }
    return;
  }
  const clr = e.target.closest(".ddl-clear");
  if (clr) {
    const input = clr.parentElement.querySelector(".ddl-input");
    input.value = "";
    ddlUpdate(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
document.addEventListener("change", (e) => {
  if (e.target.classList && e.target.classList.contains("ddl-input")) ddlUpdate(e.target);
});

function renderLongterms() {
  const box = $("#lt-list");
  if (!box) return;
  if (!longterms.length) {
    box.innerHTML = `<div class="lt-empty">${t("lt_empty")}</div>`;
    return;
  }
  box.innerHTML = longterms.map(lt => {
    const p = ltProgress(lt);
    const ms = lt.milestones.map(m => {
      const overdue = m.deadline && m.deadline < todayStr();
      return `
        <li class="lt-ms ${m.done ? "done" : ""}" draggable="true" data-ms="${m.id}">
          <input type="checkbox" class="lt-ms-check" data-ms="${m.id}" ${m.done ? "checked" : ""}>
          <span class="lt-ms-body">
            <span class="lt-ms-text">${escapeHtml(m.text)}</span>
            <span class="ms-sub">${m.deadline ? `<span class="ms-due${overdue ? " over" : ""}">📅 ${fmtShort(parseDate(m.deadline))}</span>` : ""}
              <span class="ms-ops">
                ${ddlPickHTML(m.deadline, "ms-ddl")}
                <button class="lt-btn lt-ms-edit-btn" title="${escapeHtml(t("act_edit"))}">${ICONS.pencil}</button>
                <button class="lt-ms-del" data-ms="${m.id}" title="${escapeHtml(t("act_del"))}">${ICONS.x}</button>
              </span>
            </span>
          </span>
        </li>`;
    }).join("");
    return `
    <div class="lt-item" draggable="true" data-lt="${lt.id}">
      <div class="lt-head">
        <div class="lt-title">${escapeHtml(lt.title)}</div>
        <div class="lt-actions">
          <button class="lt-btn lt-edit-btn" title="${t("act_edit")}">${ICONS.pencil}</button>
          <button class="lt-btn lt-del-btn" title="${t("act_del")}">${ICONS.trash}</button>
        </div>
      </div>
      <div class="lt-meta">${deadlineBits(lt.deadline)}<span class="lt-pct">${p.done}/${p.total} · ${p.pct}%</span></div>
      <div class="bar-track lt-bar"><div class="bar-fill" style="width:${p.pct}%"></div></div>
      ${lt.milestones.length ? `<ul class="lt-ms-list">${ms}</ul>` : ""}
      <button type="button" class="lt-ms-open">${escapeHtml(t("lt_add_ms"))}</button>
      <div class="lt-add-ms hidden">
        <input type="text" class="lt-ms-input" maxlength="200" placeholder="${escapeHtml(t("ph_lt_ms"))}">
        ${ddlPickHTML("", "ms-ddl")}
        <button class="lt-btn lt-ms-add-btn" title="${t("lt_add")}">${ICONS.plus}</button>
      </div>
      <div class="lt-edit-box hidden"></div>
    </div>`;
  }).join("");
}

/* ---------- 子任务改名：双击文字或点铅笔，就地编辑 ---------- */
function openMsRename(msEl) {
  const textEl = msEl.querySelector(".lt-ms-text");
  if (!textEl || msEl.querySelector(".lt-ms-rename")) return;
  const original = textEl.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "lt-ms-rename";
  input.maxLength = 200;
  input.value = original;
  textEl.replaceWith(input);
  msEl.draggable = false;  // 输入框在 draggable 元素里会无法选中文字
  input.focus();
  input.select();
  const finish = async (save) => {
    const ltId = msEl.closest(".lt-item").dataset.lt;
    const msId = msEl.dataset.ms;
    const val = input.value.trim();
    const span = document.createElement("span");
    span.className = "lt-ms-text";
    span.textContent = save && val ? val : original;
    input.replaceWith(span);
    msEl.draggable = true;
    if (save && val && val !== original) {
      await API.updateMilestone(ltId, msId, { text: val });
      loadLongterms();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(input.value.trim() && input.value.trim() !== original));
}

/* "添加子任务"行的展开/收起：平时只显示一个淡按钮 */
function expandAddMs(item) {
  item.querySelector(".lt-ms-open").classList.add("hidden");
  const row = item.querySelector(".lt-add-ms");
  row.classList.remove("hidden");
  row.querySelector(".lt-ms-input").focus();
}
function collapseAddMs(item) {
  const row = item.querySelector(".lt-add-ms");
  if (!row || row.classList.contains("hidden")) return;
  if (row.querySelector(".lt-ms-input").value.trim()) return;  // 还有内容就不收起
  row.classList.add("hidden");
  item.querySelector(".lt-ms-open").classList.remove("hidden");
}

function openLtEdit(item, lt) {
  const box = item.querySelector(".lt-edit-box");
  box.classList.remove("hidden");
  box.innerHTML = `
    <input type="text" class="lt-edit-title" maxlength="100" value="${escapeHtml(lt.title)}">
    <div class="lt-form-row">
      ${ddlPickHTML(lt.deadline)}
      <button class="btn small primary lt-edit-save">${t("btn_save")}</button>
      <button class="btn small ghost lt-edit-cancel">${t("btn_cancel")}</button>
    </div>`;
}

$("#lt-list").addEventListener("click", async (e) => {
  if (justDragged) return;  // 触屏拖拽刚结束，忽略这次点击
  const item = e.target.closest(".lt-item");
  if (!item) return;
  const lt = longterms.find(x => x.id === item.dataset.lt);
  if (!lt) return;
  if (e.target.closest(".lt-ms-open")) return expandAddMs(item);
  if (e.target.closest(".lt-ms-edit-btn")) {
    return openMsRename(item.querySelector(`.lt-ms[data-ms="${e.target.closest(".lt-ms-edit-btn").closest(".lt-ms").dataset.ms}"]`));
  }
  if (e.target.closest(".lt-del-btn")) {
    if (!confirm(tf("lt_confirm_del", { t: lt.title }))) return;
    await API.deleteLongterm(lt.id);
    return loadLongterms();
  }
  if (e.target.closest(".lt-edit-btn")) return openLtEdit(item, lt);
  if (e.target.closest(".lt-edit-cancel")) {
    item.querySelector(".lt-edit-box").classList.add("hidden");
    return;
  }
  if (e.target.closest(".lt-edit-save")) {
    const d = await API.updateLongterm(lt.id, {
      title: item.querySelector(".lt-edit-title").value,
      deadline: item.querySelector(".lt-edit-box .ddl-input").value,
    });
    if (d.ok) return loadLongterms();
    return alert(d.errors.join("\n"));
  }
  if (e.target.closest(".lt-ms-add-btn")) {
    const input = item.querySelector(".lt-ms-input");
    const text = input.value.trim();
    if (!text) return;
    const dlInput = item.querySelector(".lt-add-ms .ddl-input");
    input.value = "";
    await API.addMilestone(lt.id, { text, deadline: dlInput.value });
    dlInput.value = "";
    ddlUpdate(dlInput);
    await loadLongterms();
    // 连续添加：保持输入框展开并聚焦
    const item2 = $(`.lt-item[data-lt="${lt.id}"]`);
    if (item2) expandAddMs(item2);
    return;
  }
  if (e.target.closest(".lt-ms-del")) {
    const msId = e.target.closest(".lt-ms-del").dataset.ms;
    await API.deleteMilestone(lt.id, msId);
    return loadLongterms();
  }
});

$("#lt-list").addEventListener("change", async (e) => {
  const item = e.target.closest(".lt-item");
  if (!item) return;
  if (e.target.classList.contains("lt-ms-check")) {
    await API.updateMilestone(item.dataset.lt, e.target.dataset.ms, { done: e.target.checked });
    return loadLongterms();
  }
  if (e.target.classList.contains("ddl-input") && e.target.closest(".lt-ms")) {
    // 行内改子任务截止日期（含清除），改完重渲染以刷新日期小标签
    await API.updateMilestone(item.dataset.lt, e.target.closest(".lt-ms").dataset.ms, { deadline: e.target.value });
    return loadLongterms();
  }
});

// 双击子任务文字直接改名
$("#lt-list").addEventListener("dblclick", (e) => {
  const textEl = e.target.closest(".lt-ms-text");
  if (!textEl) return;
  openMsRename(textEl.closest(".lt-ms"));
});

$("#lt-list").addEventListener("keydown", (e) => {
  if (!e.target.classList.contains("lt-ms-input")) return;
  if (e.key === "Enter") {
    e.preventDefault();
    e.target.closest(".lt-add-ms").querySelector(".lt-ms-add-btn").click();
  } else if (e.key === "Escape") {
    e.target.value = "";
    collapseAddMs(e.target.closest(".lt-item"));
  }
});
// 输入框失焦且为空时收起（延时等待"＋"/日期按钮的点击落点）
$("#lt-list").addEventListener("focusout", (e) => {
  if (!e.target.classList || !e.target.classList.contains("lt-ms-input")) return;
  const item = e.target.closest(".lt-item");
  if (!item) return;
  setTimeout(() => {
    if (!item.contains(document.activeElement)) collapseAddMs(item);
  }, 150);
});

$("#lt-form").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("#lt-title").value.trim();
  if (!title) return;
  const d = await API.addLongterm({ title, deadline: $("#lt-deadline").value });
  if (d.ok) {
    $("#lt-title").value = "";
    const dl = $("#lt-deadline");
    dl.value = "";
    ddlUpdate(dl);
    loadLongterms();
  } else {
    alert(d.errors.join("\n"));
  }
};

/* ---------- 设置弹窗（语言 / 背景图片 / 软件图标） ---------- */
function openSettings() {
  $("#settings-mask").classList.remove("hidden");
  refreshAiSettings();
  refreshSyncState();
}
function closeSettings() { $("#settings-mask").classList.add("hidden"); }
$("#btn-settings").onclick = openSettings;
$("#btn-settings-close").onclick = closeSettings;
$("#settings-mask").onclick = (e) => { if (e.target === e.currentTarget) closeSettings(); };
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSettings(); });

/* ---------- 背景图片（只换界面背景） ---------- */
async function applyBackground() {
  const url = bgVersion ? await API.getBackgroundURL() : "";
  if (url) {
    document.body.style.backgroundImage = `url(${url})`;
    document.body.classList.add("has-bg");
  } else {
    document.body.style.backgroundImage = "";
    document.body.classList.remove("has-bg");
  }
  $("#bg-preview").classList.toggle("hidden", !bgVersion);
  if (bgVersion) $("#bg-preview-img").src = url;
}

function flashMsg(el) {
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}

async function uploadBackground(file) {
  if (!file.type.startsWith("image/")) {
    alert(t("bg_bad_type"));
    return;
  }
  try {
    const d = await API.uploadBackground(file);
    if (d.ok) {
      bgVersion = String(Date.now());
      applyBackground();
      flashMsg($("#bg-msg"));
    }
  } catch (_) { /* 静默 */ }
}

const bgDrop = $("#bg-drop");
bgDrop.addEventListener("click", () => $("#bg-file").click());
bgDrop.addEventListener("dragover", (e) => { e.preventDefault(); bgDrop.classList.add("over"); });
bgDrop.addEventListener("dragleave", () => bgDrop.classList.remove("over"));
bgDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  bgDrop.classList.remove("over");
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) uploadBackground(f);
});
$("#bg-file").onchange = (e) => {
  const f = e.target.files[0];
  if (f) uploadBackground(f);
  e.target.value = "";
};
$("#btn-reset-bg").onclick = async () => {
  await API.deleteBackground();
  bgVersion = "";
  applyBackground();
};

/* ---------- 软件图标（独立换图，自动裁方生成 ico；手机版隐藏此功能） ---------- */
let iconVersion = "";   // 自定义图标缓存戳，"" 表示默认图标

async function applyIconPreview() {
  const url = iconVersion ? await API.getIconPreviewURL() : "";
  $("#icon-preview").classList.toggle("hidden", !iconVersion || !url);
  if (iconVersion && url) $("#icon-preview-img").src = url;
}

async function uploadIcon(file) {
  if (!file.type.startsWith("image/")) {
    alert(t("bg_bad_type"));
    return;
  }
  try {
    const d = await API.uploadIcon(file);
    if (d.ok) {
      iconVersion = String(Date.now());
      applyIconPreview();
      flashMsg($("#icon-msg"));
    }
  } catch (_) { /* 静默 */ }
}

const iconDrop = $("#icon-drop");
iconDrop.addEventListener("click", () => $("#icon-file").click());
iconDrop.addEventListener("dragover", (e) => { e.preventDefault(); iconDrop.classList.add("over"); });
iconDrop.addEventListener("dragleave", () => iconDrop.classList.remove("over"));
iconDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  iconDrop.classList.remove("over");
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) uploadIcon(f);
});
$("#icon-file").onchange = (e) => {
  const f = e.target.files[0];
  if (f) uploadIcon(f);
  e.target.value = "";
};
$("#btn-reset-icon").onclick = async () => {
  const d = await API.deleteIcon();
  if (d.restored) iconVersion = "";
  applyIconPreview();
  flashMsg($("#icon-msg"));
  if (!d.restored) $("#icon-msg").textContent = t("icon_hint_reset");
  else $("#icon-msg").textContent = t("icon_hint");
};

/* ---------- 语言按钮 ---------- */
$$(".lang-btn").forEach(b => b.onclick = async () => {
  const l = b.dataset.lang;
  if (l === lang) return;
  lang = l;
  try {
    await API.updateSettings({ language: l });
  } catch (_) { /* 保存失败也不影响本次切换 */ }
  applyLang();
});

/* ---------- 界面透明度（背景图模式下所有表面共用） ---------- */
function applyCardAlpha(v) {
  v = Math.max(0.3, Math.min(1, Number(v) || 0.9));
  document.documentElement.style.setProperty("--card-alpha", String(v));
  $("#alpha-val").textContent = Math.round(v * 100) + "%";
  $("#alpha-slider").value = Math.round(v * 100);
  return v;
}
$("#alpha-slider").addEventListener("input", (e) => applyCardAlpha(e.target.value / 100));
$("#alpha-slider").addEventListener("change", (e) => {
  API.updateSettings({ card_alpha: String(e.target.value / 100) }).catch(() => {});
});

/* ---------- 拖拽排序（长期任务卡片 + 子任务行） ---------- */
let dragLtId = null;   // 正在拖拽的长期任务 id
let dragMsId = null;   // 正在拖拽的子任务 id
let dragMsLt = null;   // 被拖子任务所属的长期任务 id
let justDragged = false;  // 触屏拖拽刚结束时抑制误触 click

$("#lt-list").addEventListener("dragstart", (e) => {
  const ms = e.target.closest(".lt-ms");
  const item = e.target.closest(".lt-item");
  if (ms) {
    dragMsId = ms.dataset.ms;
    dragMsLt = item ? item.dataset.lt : null;
    ms.classList.add("dragging");
  } else if (item) {
    dragLtId = item.dataset.lt;
    item.classList.add("dragging");
  } else {
    return;
  }
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "");
});

/* 按指针坐标移动被拖元素到插入点（HTML5 DnD 与触屏长按拖拽共用）：
 * 网格布局同一行看指针在目标左/右半边，行与行之间看上/下；
 * 找不到落点（如最后一行右侧空位）就放到最后，
 * 这样任何卡片都能拖到包括最末尾在内的任意位置 */
function moveDragging(x, y) {
  const list = $("#lt-list");
  if (dragLtId) {
    const dragging = list.querySelector(".lt-item.dragging");
    if (!dragging) return;
    const items = [...list.querySelectorAll(".lt-item")].filter(it => it !== dragging);
    const ref = items.find(it => {
      const r = it.getBoundingClientRect();
      if (y < r.top) return true;
      if (y <= r.bottom) return x < r.left + r.width / 2;
      return false;
    });
    if (ref) list.insertBefore(dragging, ref);
    else list.appendChild(dragging);
  } else if (dragMsId) {
    const dragging = list.querySelector(".lt-ms.dragging");
    if (!dragging) return;
    const scopeList = document.querySelector(`.lt-item[data-lt="${dragMsLt}"] .lt-ms-list`);
    if (!scopeList || !scopeList.contains(dragging)) return;
    const items = [...scopeList.querySelectorAll(".lt-ms")].filter(it => it !== dragging);
    const ref = items.find(it => y < it.getBoundingClientRect().top + it.getBoundingClientRect().height / 2);
    if (ref) scopeList.insertBefore(dragging, ref);
    else scopeList.appendChild(dragging);
  }
}

$("#lt-list").addEventListener("dragover", (e) => {
  if (!dragLtId && !dragMsId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  moveDragging(e.clientX, e.clientY);
});

async function commitDrag() {
  const wasLt = dragLtId, wasMs = dragMsId, msLt = dragMsLt;
  dragLtId = dragMsId = dragMsLt = null;
  $$(".dragging").forEach(x => x.classList.remove("dragging"));
  document.body.classList.remove("touch-dragging");
  try {
    if (wasLt) {
      const order = $$("#lt-list .lt-item").map(x => x.dataset.lt);
      await API.reorderLongterms(order);
    } else if (wasMs && msLt) {
      const list = document.querySelector(`.lt-item[data-lt="${msLt}"] .lt-ms-list`);
      const order = [...list.querySelectorAll(".lt-ms")].map(x => x.dataset.ms);
      await API.reorderMilestones(msLt, order);
    }
  } catch (_) { /* 排序失败静默，下次打开按服务端顺序显示 */ }
}

$("#lt-list").addEventListener("dragend", commitDrag);

/* 触屏拖拽：HTML5 DnD 在手机上不可用，改为长按 250ms 启动，
 * 插入位置计算与桌面拖拽共用（moveDragging）。
 * 长按生效前移动超过 10px 视为滚动意图，取消拖拽。 */
const touchDrag = { timer: null, active: false, x: 0, y: 0 };

$("#lt-list").addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  if (e.target.closest("input, textarea, select, button, .ddl-pick")) return;
  const ms = e.target.closest(".lt-ms");
  const item = e.target.closest(".lt-item");
  if (!ms && !item) return;
  const el = ms || item;
  touchDrag.active = false;
  touchDrag.x = e.clientX;
  touchDrag.y = e.clientY;
  touchDrag.timer = setTimeout(() => {
    touchDrag.timer = null;
    touchDrag.active = true;
    if (ms) {
      dragMsId = ms.dataset.ms;
      dragMsLt = item ? item.dataset.lt : null;
    } else {
      dragLtId = item.dataset.lt;
    }
    el.classList.add("dragging");
    document.body.classList.add("touch-dragging");
    if (navigator.vibrate) navigator.vibrate(30);
  }, 250);
});

$("#lt-list").addEventListener("pointermove", (e) => {
  if (touchDrag.timer == null && !touchDrag.active) return;
  if (!touchDrag.active) {
    if (Math.hypot(e.clientX - touchDrag.x, e.clientY - touchDrag.y) > 10) {
      clearTimeout(touchDrag.timer);
      touchDrag.timer = null;
    }
    return;
  }
  e.preventDefault();
  moveDragging(e.clientX, e.clientY);
});

function endTouchDrag() {
  if (touchDrag.timer != null) { clearTimeout(touchDrag.timer); touchDrag.timer = null; }
  if (!touchDrag.active) return;
  touchDrag.active = false;
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 350);
  commitDrag();
}
$("#lt-list").addEventListener("pointerup", endTouchDrag);
$("#lt-list").addEventListener("pointercancel", endTouchDrag);
// 长按生效后浏览器会尝试接管滚动，必须阻止，否则拖不动
document.addEventListener("touchmove", (e) => {
  if (touchDrag.active) e.preventDefault();
}, { passive: false });

/* ---------- 报表翻周（统计视图已移除，接口保留给 agent 用） ---------- */

/* ---------- 事件绑定 ---------- */
$$(".tab").forEach(tabBtn => tabBtn.onclick = () => {
  $$(".tab").forEach(x => x.classList.remove("active"));
  tabBtn.classList.add("active");
  view = tabBtn.dataset.view;
  render();
});
$("#btn-new").onclick = () => openModal();
$("#btn-cancel").onclick = closeModal;
$("#modal-mask").onclick = (e) => { if (e.target === e.currentTarget) closeModal(); };
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

$("#event-form").onsubmit = async (e) => {
  e.preventDefault();
  const payload = {
    title: $("#f-title").value,
    date: $("#f-date").value,
    time: $("#f-time").value,
    priority: $("#f-priority").value,
    remind_minutes: Number($("#f-remind").value),
    notes: $("#f-notes").value,
  };
  const data = await saveEvent(payload);
  if (!data.ok) {
    const box = $("#form-error");
    box.textContent = data.errors.join("；");
    box.classList.remove("hidden");
    return;
  }
  closeModal();
  await loadEvents();
};

// 日程卡片操作（事件委托，周视图和日视图共用）
document.addEventListener("click", async (e) => {
  if (justDragged) return;
  const card = e.target.closest("[data-id]");
  if (!card) return;
  const ev = events.find(x => x.id === card.dataset.id);
  if (!ev) return;
  if (e.target.closest(".act-done")) return toggleDone(ev);
  if (e.target.closest(".act-del")) return deleteEvent(ev);
  if (e.target.closest(".act-edit") || card.classList.contains("wc-event")) openModal(ev);
});

$("#day-prev").onclick = () => shiftDay(-1);
$("#day-next").onclick = () => shiftDay(1);
function shiftDay(n) {
  const d = parseDate($("#day-picker").value || todayStr());
  d.setDate(d.getDate() + n);
  $("#day-picker").value = fmtDate(d);
  renderDay();
}
$("#day-picker").onchange = renderDay;
// 手机版原生日期输入缩成 1px 透明，点日期文字唤起系统选择器（桌面端点输入框自身也顺带生效）
$(".day-title").addEventListener("click", () => {
  try { $("#day-picker").showPicker(); } catch (_) { /* 老内核无 showPicker，忽略 */ }
});
$("#priority-filter").onchange = (e) => { filterPriority = e.target.value; render(); };
$("#hide-done").onchange = (e) => { hideDone = e.target.checked; render(); };

/* ---------- AI 助手（对话式安排任务） ---------- */
const aiHistory = [];

const AI_TIMEOUT = 240000;  // 服务端最多 3 次调用（429 重试）+ 限流等待，给足余量

function isAbort(e) {
  return e && (e.name === "AbortError" || (e.cause && e.cause.name === "AbortError"));
}

function scrollChat(box) {
  if (box) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

function fmtAiText(s) {
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

function addAiMsg(box, role, text) {
  const el = document.createElement("div");
  el.className = `ai-msg ai-${role}`;
  const bubble = document.createElement("div");
  bubble.className = "ai-bubble";
  bubble.innerHTML = fmtAiText(text);
  el.appendChild(bubble);
  box.appendChild(el);
  scrollChat(box);
  return bubble;
}

function renderAiHints() {
  const box = $("#ai-hints");
  if (!box) return;
  box.innerHTML = "";
  (I18N[lang].ai_hints || []).forEach(h => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip ai-hint";
    b.textContent = h;
    b.onclick = () => { $("#ai-input").value = h; $("#ai-input").focus(); };
    box.appendChild(b);
  });
}

async function sendAiChat() {
  const input = $("#ai-input");
  const text = input.value.trim();
  if (!text) return;
  const box = $("#ai-chat");
  input.value = "";
  addAiMsg(box, "user", text);
  aiHistory.push({ role: "user", content: text });
  const bubble = addAiMsg(box, "assistant", t("ai_thinking"));
  bubble.classList.add("ai-waiting");
  try {
    const d = await API.aiChat(aiHistory, AI_TIMEOUT);
    bubble.classList.remove("ai-waiting");
    if (!d.ok) {
      bubble.innerHTML = `⚠️ ${fmtAiText(d.error || "出错")}`;
      if ((d.error || "").includes("API Key")) openSettings();
      return;
    }
    aiHistory.push({ role: "assistant", content: d.reply });
    let html = fmtAiText(d.reply);
    if (d.actions && d.actions.length) {
      html += `<div class="ai-actions">` +
        d.actions.map(a => `<span class="ai-action">✓ ${escapeHtml(a)}</span>`).join("") + `</div>`;
    }
    bubble.innerHTML = html;
    loadEvents();
    loadLongterms();
  } catch (e) {
    bubble.classList.remove("ai-waiting");
    bubble.innerHTML = `⚠️ ${fmtAiText(isAbort(e) ? "请求超时了，请重试" : t("ai_net_err"))}`;
  }
}

$("#ai-form").onsubmit = (e) => { e.preventDefault(); sendAiChat(); };

/* ---------- AI 分析（点按钮才调用） ---------- */
let airScope = "month";
let airReady = false;
const airHistory = [];

$$("#air-scopes .air-scope").forEach(b => b.onclick = () => {
  $$("#air-scopes .air-scope").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  airScope = b.dataset.scope;
});

function barsHTML(entries, labelOf) {
  const max = Math.max(1, ...entries.map(x => x.total));
  return `<div class="rd-cols">` + entries.map(x => `
    <div class="rd-col" title="${escapeHtml(x.label || "")}">
      <div class="rd-num">${x.total || ""}</div>
      <div class="rd-bar"><div class="rd-fill" style="height:${Math.round(x.total / max * 100)}%">
        <div class="rd-done" style="height:${x.total ? Math.round(x.done / x.total * 100) : 0}%"></div>
      </div></div>
      <div class="rd-dow">${escapeHtml(labelOf(x))}</div>
    </div>`).join("") + `</div>`;
}

function renderAnalysis(d) {
  const data = d.data || {};
  $("#air-summary").textContent = d.summary || "";

  // 统计卡：数字 + 按当前 scope 换说明文字
  const cards = {
    week: [["total", "air_cap_w_total"], ["done", "cap_done"], ["pending", "cap_pending"], ["overdue", "cap_overdue"]],
    month: [["total", "air_cap_m_total"], ["done", "cap_done"], ["pending", "cap_pending"], ["overdue", "cap_overdue"]],
    longterm: [["goals", "air_cap_l_goals"], ["steps_done", "air_cap_l_sdone"], ["steps_total", "air_cap_l_stotal"], ["overdue", "air_cap_l_over"]],
  }[d.scope] || [];
  cards.forEach(([key, capKey], i) => {
    $("#air-st-" + (i + 1)).textContent = data.cards?.[key] ?? 0;
    const cap = $("#air-cap-" + (i + 1));
    cap.dataset.i18n = capKey;
    cap.textContent = t(capKey);
  });
  $("#air-st-4").style.color = (data.cards?.overdue ?? 0) > 0 ? "var(--red)" : "var(--green)";

  // GitHub 风格 90 天热力图：91 天正好 13 整列 × 7 行，不做星期补位，
  // 避免首列/末列出现残缺块（图上没有星期标签，无需对齐真实星期）
  const hm = data.heatmap || { start: todayStr(), days: [] };
  const map = Object.fromEntries(hm.days.map(x => [x[0], x]));
  const maxDone = Math.max(1, ...hm.days.map(x => x[2]));
  const start = parseDate(hm.start);
  let cells = "";
  for (let i = 0; i < 91; i++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + i);
    const ds = fmtDate(dt);
    const rec = map[ds];
    const total = rec ? rec[1] : 0, done = rec ? rec[2] : 0;
    // 有日程至少 l1（区别于空白天），完成得越多颜色越深
    const lvl = total === 0 ? 0 : done === 0 ? 1
      : Math.min(3, 1 + Math.ceil(done / maxDone * 2));
    cells += `<span class="hm-cell l${lvl}" title="${fmtShort(dt)} · ${total} 项（完成 ${done}）"></span>`;
  }
  $("#air-heatmap").innerHTML = cells;

  // 完成率圆环 + 连续天数
  const rate = data.rate ?? 0;
  $("#air-donut").style.setProperty("--pct", rate + "%");
  $("#air-donut-num").textContent = rate + "%";
  $("#air-streak").textContent = data.streak > 0
    ? tf("air_streak", { n: data.streak }) : t("air_streak_zero");

  // 分 scope 的图表面板
  const chartTitle = $("#air-chart-title");
  const chartBox = $("#air-chart");
  if (d.scope === "week") {
    chartTitle.dataset.i18n = "air_chart_w";
    chartTitle.textContent = t("air_chart_w");
    chartBox.innerHTML = barsHTML(data.days || [], x => x.dow);
  } else if (d.scope === "month") {
    chartTitle.dataset.i18n = "air_chart_m";
    chartTitle.textContent = t("air_chart_m");
    chartBox.innerHTML = barsHTML(data.weeks || [], x => x.label);
  } else {
    chartTitle.dataset.i18n = "air_chart_l";
    chartTitle.textContent = t("air_chart_l");
    chartBox.innerHTML = (data.goals || []).map(g => {
      const pct = g.total ? Math.round(g.done / g.total * 100) : 0;
      const dl = !g.deadline ? `<span class="ms-due">${escapeHtml(t("air_no_deadline"))}</span>`
        : g.left < 0 ? `<span class="ms-due over">${escapeHtml(tf("lt_overdue", { n: -g.left }))}</span>`
        : `<span class="ms-due">${escapeHtml(tf("lt_days_left", { n: g.left }))}</span>`;
      const od = g.overdue_steps ? `<span class="ms-due over">${escapeHtml(tf("lt_overdue", { n: g.overdue_steps }))}</span>` : "";
      return `<div class="air-goal">
        <div class="air-goal-head"><span class="air-goal-title">${escapeHtml(g.title)}</span>
          <span class="lt-pct">${g.done}/${g.total}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="air-goal-meta">${dl}${od}</div>
      </div>`;
    }).join("") || `<div class="air-up-empty">${t("lt_empty")}</div>`;
  }

  // 分 scope 的右侧面板：未来 7 天 / 目标截止
  const upTitle = $("#air-up-title");
  const upBox = $("#air-upcoming");
  if (d.scope === "longterm") {
    upTitle.dataset.i18n = "air_up_l";
    upTitle.textContent = t("air_up_l");
    const withDl = (data.goals || []).filter(g => g.deadline)
      .sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
    upBox.innerHTML = withDl.length
      ? withDl.map(g => {
          const over = g.left < 0;
          return `<div class="air-up">
            <span class="air-up-dot" style="background:${over ? "var(--red)" : "var(--primary)"}"></span>
            <span class="air-up-date">${escapeHtml(g.deadline.slice(5))}</span>
            <span class="air-up-title">${escapeHtml(g.title)}</span>
            <span class="ms-due${over ? " over" : ""}">${over ? tf("lt_overdue", { n: -g.left }) : tf("lt_days_left", { n: g.left })}</span>
          </div>`;
        }).join("")
      : `<div class="air-up-empty">${t("air_up_long_empty")}</div>`;
  } else {
    upTitle.dataset.i18n = "air_up_w";
    upTitle.textContent = t("air_up_w");
    const up = data.upcoming_7_days || [];
    const PRI_COLOR = { "高": "var(--red)", "中": "var(--yellow)", "低": "var(--green)" };
    upBox.innerHTML = up.length
      ? up.map(e => `
        <div class="air-up">
          <span class="air-up-dot" style="background:${PRI_COLOR[e.priority] || "var(--muted)"}"></span>
          <span class="air-up-date">${escapeHtml(e.date.slice(5))} ${escapeHtml(e.time)}</span>
          <span class="air-up-title">${escapeHtml(e.title)}</span>
        </div>`).join("")
      : `<div class="air-up-empty">${t("air_up_empty")}</div>`;
  }

  $("#air-insights").innerHTML =
    (d.insights || []).map(s => `<div class="air-line">💡 ${escapeHtml(s)}</div>`).join("") +
    (d.suggestions || []).map(s => `<div class="air-line">👉 ${escapeHtml(s)}</div>`).join("");
  // 进入分析会话时清空上一轮聊天气泡
  $("#air-chat").innerHTML = "";
}

// 触屏没有 hover：点按热力图格子用 toast 显示该日数据
$("#air-heatmap").addEventListener("click", (e) => {
  const cell = e.target.closest(".hm-cell");
  if (cell && cell.title) showToast(cell.title, "");
});

$("#btn-analyze").onclick = async () => {
  const btn = $("#btn-analyze");
  const keep = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("air_analyzing");
  $("#air-error").classList.add("hidden");
  try {
    const d = await API.aiAnalyze(airScope, AI_TIMEOUT);
    if (!d.ok) {
      showAirError(d.error || "分析失败");
      return;
    }
    airReady = true;
    airHistory.length = 0;
    $("#air-input").disabled = false;
    $("#air-input").placeholder = t("ph_air");
    $("#air-result").classList.remove("hidden");
    renderAnalysis(d);
  } catch (e) {
    showAirError(isAbort(e) ? t("air_timeout") : t("ai_net_err"));
  } finally {
    btn.disabled = false;
    btn.textContent = keep;
  }
};

$("#air-form").onsubmit = async (e) => {
  e.preventDefault();
  const input = $("#air-input");
  const text = input.value.trim();
  if (!text) return;
  if (!airReady) {
    addAiMsg($("#air-chat"), "assistant", t("air_need_first"));
    return;
  }
  const box = $("#air-chat");
  input.value = "";
  addAiMsg(box, "user", text);
  airHistory.push({ role: "user", content: text });
  const bubble = addAiMsg(box, "assistant", t("ai_thinking"));
  bubble.classList.add("ai-waiting");
  try {
    const d = await API.aiAnalyzeChat({ question: text, history: airHistory, scope: airScope }, AI_TIMEOUT);
    bubble.classList.remove("ai-waiting");
    if (!d.ok) { bubble.innerHTML = `⚠️ ${fmtAiText(d.error || "出错")}`; return; }
    airHistory.push({ role: "assistant", content: d.reply });
    bubble.innerHTML = fmtAiText(d.reply);
  } catch (e) {
    bubble.classList.remove("ai-waiting");
    bubble.innerHTML = `⚠️ ${fmtAiText(isAbort(e) ? "请求超时了，请重试" : t("ai_net_err"))}`;
  }
};

/* ---------- 设置里的 AI 配置 ---------- */
async function refreshAiSettings() {
  const sel = $("#ai-model");
  if (!sel) return;
  try {
    const d = await API.aiStatus();
    sel.innerHTML = (d.models || []).map(m =>
      `<option value="${escapeHtml(m)}"${m === d.model ? " selected" : ""}>${escapeHtml(m)}</option>`).join("");
    $("#ai-key-state").textContent = d.ready ? t("ai_key_ok") : t("ai_key_none");
    $("#ai-key-state").classList.toggle("ok", !!d.ready);
  } catch (_) { /* 静默 */ }
}

$("#btn-ai-save").onclick = async () => {
  const payload = { ai_model: $("#ai-model").value };
  const key = $("#ai-key").value.trim();
  if (key) payload.ai_api_key = key;  // 留空表示不修改
  try {
    await API.updateSettings(payload);
    $("#ai-key").value = "";
    $("#ai-key-state").textContent = t("ai_key_saved");
    $("#ai-key-state").classList.add("ok");
    setTimeout(refreshAiSettings, 1200);
  } catch (_) { /* 静默 */ }
};

/* ---------- 数据同步（同步包：导出文件 → 微信等传到另一台设备 → 导入覆盖） ---------- */
const SYNC_KIND = "schedule-buddy-sync";

function syncDirty(s) {
  return Boolean(s && (s.sync_dirty === true || s.sync_dirty === "1"));
}

async function refreshSyncState() {
  try {
    const s = await API.getSettings();
    $("#sync-state").textContent = tf("sync_state", {
      v: s.sync_version ?? 0,
      d: syncDirty(s) ? t("sync_dirty_yes") : t("sync_dirty_no"),
    });
  } catch (_) { /* 静默 */ }
}

function downloadSyncPackage(pkg) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `schedule-buddy-sync-${pkg.exported_at.replace(/[-: ]/g, "").slice(0, 12)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

$("#btn-sync-export").onclick = async () => {
  try {
    const pkg = await API.syncExport();
    if (pkg.saved_path) {
      // 电脑桌面版：后端已把文件直接写进"下载"文件夹，不再走浏览器下载
      flashMsg($("#sync-msg"));
      $("#sync-msg").textContent = tf("sync_saved", { p: pkg.saved_path });
      showToast(t("sync_exported_toast"), pkg.saved_path);
    } else {
      downloadSyncPackage(pkg);
      flashMsg($("#sync-msg"));
      $("#sync-msg").textContent = t("sync_exported");
    }
    refreshSyncState();
  } catch (e) {
    alert(t("sync_fail") + (e && e.message ? `：${e.message}` : ""));
  }
};

$("#btn-sync-import").onclick = () => $("#sync-file").click();
$("#sync-file").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  let pkg;
  try {
    pkg = JSON.parse(await f.text());
  } catch (_) {
    return alert(t("sync_bad_file"));
  }
  if (!pkg || pkg.kind !== SYNC_KIND || !pkg.data || !Array.isArray(pkg.data.events)) {
    return alert(t("sync_bad_file"));
  }
  const nEvents = pkg.data.events.length;
  const nLongterms = (pkg.data.longterms || []).length;
  const meta = { time: pkg.exported_at || "?", v: pkg.version ?? 0, n: nEvents, m: nLongterms };
  const s = await API.getSettings();
  const msg = syncDirty(s) ? tf("sync_confirm_dirty", meta) : tf("sync_confirm", meta);
  if (!confirm(msg)) return;
  try {
    const r = await API.syncImport(pkg);
    if (!r.ok) return alert(r.errors.join("\n"));
    flashMsg($("#sync-msg"));
    $("#sync-msg").textContent = tf("sync_done", { n: nEvents, m: nLongterms });
    refreshSyncState();
    await loadEvents();
    loadLongterms();
  } catch (err) {
    alert(t("sync_fail") + (err && err.message ? `：${err.message}` : ""));
  }
};

/* ---------- 启动 ---------- */
$("#day-picker").value = todayStr();
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission();
}
(async () => {
  // 先探测运行形态（电脑版 Flask / 手机版本地），再取设置渲染，避免闪一下默认界面
  await API.init();
  if (API.isLocal() && navigator.storage && navigator.storage.persist) {
    // 申请持久存储：降低手机系统在存储紧张时清掉 IndexedDB 的风险
    navigator.storage.persist().catch(() => {});
  }
  try {
    const s = await API.getSettings();
    lang = s.language === "en" ? "en" : "zh";
    bgVersion = s.background ? "1" : "";
    iconVersion = s.icon ? "1" : "";
    applyCardAlpha(s.card_alpha);
  } catch (_) { /* 用默认值 */ }
  if (API.isLocal()) {
    // 手机版没有可换的软件图标（托盘/快捷方式是桌面概念），该设置块由 CSS 隐藏
    refreshSyncState();
  }
  applyLang();
  applyBackground();
  applyIconPreview();
  refreshSyncState();
  await loadEvents();
  loadLongterms();
})();
setInterval(pollReminders, 30000);
setTimeout(pollReminders, 1500);
// 心跳：浏览器模式下页面全部关闭后服务端会自动退出；桌面窗口模式和本地模式不依赖它
const beat = () => API.heartbeat();
beat();
setInterval(beat, 5000);
