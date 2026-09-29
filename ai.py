"""AI 功能模块：对话式日程助手 + 统计分析（智谱 GLM）。

设计要点：
- API Key 只存在 data/settings.json（用户在设置里填写），绝不写进代码、日志或报错信息；
- 只用标准库 urllib 调用开放平台 chat/completions，不新增依赖；
- 助手通过 function calling 直接操作本地数据，最多循环 6 轮工具调用；
- 统计分析的数据聚合在本地完成（不花钱），只在用户点「开始分析」时调一次大模型；
  之后的聊天追问复用缓存的聚合数据（10 分钟内有效），省 token。
"""
import json
import logging
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

import storage

log = logging.getLogger("schedule-buddy")

# 模型声称"已完成操作"的话术，配合 actions 为空时触发重试
_SUCCESS_CLAIM_RE = re.compile(
    r"(已经?|帮你)(添加|新增|创建|删除|修改|更新|标记|设置|记下|记录)"
    r"|(记录好|添加好|安排好|设置好|记好)")

API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
# 默认 glm-4.7-flash（免费）；glm-5.3-flash 更强，按需在设置里切换（计费）。
# glm-4.5-flash 作为备用免费模型（4.7 限流时可切换；注意它日期推算偶尔不准）。
# 实测（2026-09）：glm-4-flash 及更早的模型工具调用不可靠，已移除。
DEFAULT_MODEL = "glm-4.7-flash"
MODELS = ["glm-4.7-flash", "glm-4.5-flash", "glm-5.3-flash"]
MAX_TOOL_ROUNDS = 16  # 弱模型一次只发一个工具调用，多任务需求需要足够多轮
_HISTORY_LIMIT = 20  # 只带最近 20 条对话，控制 token

# 分析聚合缓存：点「开始分析」后 10 分钟内的追问复用同一份数据
_ANALYSIS_CACHE = {"data": None, "ts": 0.0}
_CACHE_TTL = 600


def get_model():
    s = storage.load_settings()
    m = s.get("ai_model") or DEFAULT_MODEL
    return m if m in MODELS else DEFAULT_MODEL


def key_ready():
    return bool(str(storage.load_settings().get("ai_api_key", "")).strip())


def _headers():
    key = str(storage.load_settings().get("ai_api_key", "")).strip()
    if not key:
        raise RuntimeError("未设置 API Key，请在设置里填写")
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
    }


def _call(messages, tools=None):
    """调用 chat/completions，返回 choices[0].message。失败抛 RuntimeError（不含 key）。

    免费模型（如 glm-4.7-flash）高峰期常返回 429 限流，自动等 5 秒重试最多 2 次。
    """
    body = {"model": get_model(), "messages": messages, "temperature": 0.4}
    if tools:
        body["tools"] = tools
    data = None
    for attempt in range(3):
        req = urllib.request.Request(
            API_URL, data=json.dumps(body).encode("utf-8"), headers=_headers(), method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                err = json.loads(e.read().decode("utf-8"))
                detail = str(err.get("error", {}).get("message", ""))[:150]
            except Exception:
                pass
            if e.code == 401:
                raise RuntimeError("API Key 无效或已过期，请到设置里检查")
            if e.code == 429 and attempt < 2:
                time.sleep(5)
                continue
            raise RuntimeError(f"AI 接口返回 {e.code}：{detail or '请稍后再试'}")
        except urllib.error.URLError:
            raise RuntimeError("连不上 AI 服务，请检查网络")
    try:
        return data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("AI 返回格式异常，请稍后再试")


def _assistant_overview():
    """给助手注入的精简日程概况（本地聚合，几乎不花额外 token），让它能回答
    「我有什么安排/哪个最急/长期任务进展」这类问题，而不只是盲改数据。"""
    data = _aggregate("month")
    return {
        "streak": data["streak"],
        "overdue_milestones": data["overdue_milestones"],
        "last_30_days": {"total": data["cards"]["total"], "done": data["cards"]["done"]},
        "upcoming_7_days": data["upcoming_7_days"][:8],
        "longterms": [{"id": x["id"], **x} for x in data["longterms"]],
    }


def _system_prompt():
    now = datetime.now()
    wd = "一二三四五六日"[now.weekday()]
    return (
        "你是 Windows 桌面应用「日程助手」内置的 AI 助手，帮用户管理日程和长期任务。\n"
        f"当前时间：{now.strftime('%Y-%m-%d %H:%M')}（星期{wd}）。\n"
        "规则：\n"
        "- 解析「明天、下周三、月底」等相对时间时按当前日期计算，date 一律输出 YYYY-MM-DD。\n"
        "- 用户没说时间默认 09:00；提醒默认提前 15 分钟，明确说不用提醒就传 0。\n"
        "- 尽量在一条回复里发出多个工具调用（一次创建多个任务不要拆成多轮），未完成前不要下结论。\n"
        "- 修改或删除前，先用查询工具找到确切 id，不要凭空猜 id。\n"
        "- 删除长期任务这类破坏性操作，先向用户确认再执行。\n"
        "- 信息不足以确定日期或内容时，用一句话向用户提问，不要瞎猜。\n"
        "- 在真正调用工具成功之前，绝不要告诉用户操作已完成；没有调用工具就如实说没有。\n"
        "- 全程用简短中文；完成后用几句话确认你做了什么；工具报错就如实转告。"
    )


TOOLS = [
    {"type": "function", "function": {
        "name": "list_events", "description": "查询日程列表，可按日期范围和关键词过滤",
        "parameters": {"type": "object", "properties": {
            "date_from": {"type": "string", "description": "起始日期 YYYY-MM-DD"},
            "date_to": {"type": "string", "description": "结束日期 YYYY-MM-DD"},
            "keyword": {"type": "string", "description": "标题关键词"}}}}},
    {"type": "function", "function": {
        "name": "add_event", "description": "添加一条日程",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"}, "date": {"type": "string"}, "time": {"type": "string"},
            "remind_minutes": {"type": "number"}, "notes": {"type": "string"}},
            "required": ["title", "date", "time"]}}},
    {"type": "function", "function": {
        "name": "update_event", "description": "修改一条日程的内容（不改 id）",
        "parameters": {"type": "object", "properties": {
            "event_id": {"type": "string"}, "title": {"type": "string"}, "date": {"type": "string"},
            "time": {"type": "string"},
            "remind_minutes": {"type": "number"}, "notes": {"type": "string"}},
            "required": ["event_id"]}}},
    {"type": "function", "function": {
        "name": "mark_event_done", "description": "把日程标记为已完成/未完成",
        "parameters": {"type": "object", "properties": {
            "event_id": {"type": "string"}, "done": {"type": "boolean"}},
            "required": ["event_id", "done"]}}},
    {"type": "function", "function": {
        "name": "delete_event", "description": "删除一条日程",
        "parameters": {"type": "object", "properties": {"event_id": {"type": "string"}},
            "required": ["event_id"]}}},
    {"type": "function", "function": {
        "name": "list_longterms", "description": "查询长期任务及其子任务",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "add_longterm", "description": "添加一个长期任务",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"}, "deadline": {"type": "string"}},
            "required": ["title"]}}},
    {"type": "function", "function": {
        "name": "add_milestone", "description": "给长期任务添加一个子任务",
        "parameters": {"type": "object", "properties": {
            "longterm_title": {"type": "string", "description": "长期任务标题（和 id 二选一，推荐用标题）"},
            "longterm_id": {"type": "string"},
            "text": {"type": "string"}, "deadline": {"type": "string"}},
            "required": ["text"]}}},
    {"type": "function", "function": {
        "name": "update_longterm", "description": "修改长期任务的标题或截止日期",
        "parameters": {"type": "object", "properties": {
            "longterm_title": {"type": "string", "description": "长期任务标题（和 id 二选一）"},
            "longterm_id": {"type": "string"}, "title": {"type": "string"},
            "deadline": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "update_milestone", "description": "修改子任务的文字、截止日期或完成状态",
        "parameters": {"type": "object", "properties": {
            "milestone_text": {"type": "string", "description": "子任务文字（和 id 二选一，推荐用文字）"},
            "longterm_title": {"type": "string", "description": "可选，限定在某个长期任务里找"},
            "milestone_id": {"type": "string"}, "text": {"type": "string"},
            "deadline": {"type": "string"}, "done": {"type": "boolean"}}}}},
    {"type": "function", "function": {
        "name": "delete_longterm", "description": "删除一个长期任务（连同其所有子任务），删除前先和用户确认",
        "parameters": {"type": "object", "properties": {
            "longterm_title": {"type": "string", "description": "长期任务标题（和 id 二选一，推荐用标题）"},
            "longterm_id": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "delete_milestone", "description": "删除长期任务下的一个子任务（同名子任务会全部删除）",
        "parameters": {"type": "object", "properties": {
            "milestone_text": {"type": "string", "description": "子任务文字（和 id 二选一，推荐用文字）"},
            "longterm_title": {"type": "string", "description": "可选，限定在某个长期任务里找"},
            "milestone_id": {"type": "string"}}}}},
]


def _exec_tool(name, args, actions):
    """执行一次工具调用，返回给模型的结果 dict；人类可读的改动记入 actions。"""
    try:
        if name == "list_events":
            evs = storage.get_events()
            dfrom, dto, kw = args.get("date_from"), args.get("date_to"), args.get("keyword")
            out = [
                {"id": e["id"], "title": e["title"], "date": e["date"], "time": e["time"],
                 "done": e.get("done", False)}
                for e in evs
                if (not dfrom or e["date"] >= dfrom)
                and (not dto or e["date"] <= dto)
                and (not kw or kw in e["title"])
            ]
            return {"count": len(out), "events": out[:50]}
        if name == "add_event":
            cleaned, errors = storage.validate_event({
                "title": args.get("title"), "date": args.get("date"), "time": args.get("time"),
                "remind_minutes": args.get("remind_minutes", 15),
                "notes": args.get("notes", ""),
            })
            if errors:
                return {"ok": False, "errors": errors}
            ev = storage.add_event(cleaned)
            actions.append(f"新增日程「{ev['title']}」{ev['date']} {ev['time']}")
            return {"ok": True, "event": {"id": ev["id"], "title": ev["title"],
                                          "date": ev["date"], "time": ev["time"]}}
        if name == "update_event":
            fields = ("title", "date", "time", "remind_minutes", "notes")
            payload = {k: args[k] for k in fields if k in args}
            ev = storage.update_event(args.get("event_id"), payload, partial=True)
            if ev is None:
                return {"ok": False, "errors": ["日程不存在"]}
            actions.append(f"修改日程「{ev['title']}」")
            return {"ok": True, "event": {"id": ev["id"], "title": ev["title"],
                                          "date": ev["date"], "time": ev["time"]}}
        if name == "mark_event_done":
            ev = storage.update_event(args.get("event_id"),
                                      {"done": bool(args.get("done"))}, partial=True)
            if ev is None:
                return {"ok": False, "errors": ["日程不存在"]}
            actions.append(f"日程「{ev['title']}」标记为{'已完成' if args.get('done') else '未完成'}")
            return {"ok": True}
        if name == "delete_event":
            ev = next((x for x in storage.get_events() if x["id"] == args.get("event_id")), None)
            if ev is None or not storage.delete_event(args.get("event_id")):
                return {"ok": False, "errors": ["日程不存在"]}
            actions.append(f"删除日程「{ev['title']}」")
            return {"ok": True}
        if name == "list_longterms":
            out = [{"id": lt["id"], "title": lt["title"], "deadline": lt.get("deadline", ""),
                    "milestones": [{"id": m["id"], "text": m["text"],
                                    "done": m.get("done", False)} for m in lt["milestones"]]}
                   for lt in storage.get_longterms()]
            return {"count": len(out), "longterms": out}
        if name == "add_longterm":
            cleaned, errors = storage.validate_longterm({
                "title": args.get("title"), "deadline": args.get("deadline", "")})
            if errors:
                return {"ok": False, "errors": errors}
            lt = storage.add_longterm(cleaned)
            actions.append(f"新增长期任务「{lt['title']}」")
            return {"ok": True, "longterm": {"id": lt["id"], "title": lt["title"]}}
        if name in ("add_milestone", "update_longterm", "update_milestone",
                    "delete_longterm", "delete_milestone"):
            return _exec_lt_tool(name, args, actions)
        return {"ok": False, "errors": [f"未知工具 {name}"]}
    except Exception as e:  # 工具异常不能炸掉整个对话
        log.exception("AI 工具执行失败: %s", name)
        return {"ok": False, "errors": [f"执行失败：{e}"]}


def _find_lt(lts, args):
    """按 id 或标题（完全匹配优先，其次包含）查找长期任务，找不到返回 None。"""
    lid, title = args.get("longterm_id"), (args.get("longterm_title") or "").strip()
    if lid:
        exact = next((x for x in lts if x["id"] == lid), None)
        if exact:
            return exact
    if title:
        exact = next((x for x in lts if x["title"] == title), None)
        if exact:
            return exact
        contains = [x for x in lts if title in x["title"]]
        if len(contains) == 1:
            return contains[0]
    return None


def _exec_lt_tool(name, args, actions):
    """长期任务/子任务的增删改工具。子任务 id 全库唯一，删除/修改只需一个 id，
    目标支持按标题匹配——对弱模型来说比"必须传两个 id"可靠得多。"""
    lts = storage.get_longterms()
    if name == "add_milestone":
        lt = _find_lt(lts, args)
        if lt is None:
            return {"ok": False, "errors": ["没找到对应的长期任务，请先用 list_longterms 查看现有目标"]}
        ms, errors = storage.add_milestone(lt["id"], args.get("text"), args.get("deadline", ""))
        if errors:
            return {"ok": False, "errors": errors}
        actions.append(f"给「{lt['title']}」新增子任务「{ms['text']}」")
        return {"ok": True, "milestone": ms}
    if name == "update_longterm":
        lt = _find_lt(lts, args)
        if lt is None:
            return {"ok": False, "errors": ["长期任务不存在"]}
        payload = {k: args[k] for k in ("title", "deadline") if k in args}
        lt2 = storage.update_longterm(lt["id"], payload)
        actions.append(f"修改长期任务「{lt['title']}」")
        return {"ok": True, "longterm": {"id": lt2["id"], "title": lt2["title"]}}
    if name == "update_milestone":
        found = [(lt, m) for lt in lts for m in lt["milestones"]
                 if _ms_match(m, lt, args)]
        if not found:
            return {"ok": False, "errors": ["子任务不存在"]}
        payload = {k: args[k] for k in ("text", "deadline", "done") if k in args}
        for lt, m in found:
            storage.update_milestone(lt["id"], m["id"], payload)
            actions.append(f"修改子任务「{m['text']}」")
        return {"ok": True, "milestone": found[0][1]}
    if name == "delete_longterm":
        lt = _find_lt(lts, args)
        if lt is None:
            return {"ok": False, "errors": ["长期任务不存在"]}
        storage.delete_longterm(lt["id"])
        actions.append(f"删除长期任务「{lt['title']}」（含其子任务）")
        return {"ok": True}
    if name == "delete_milestone":
        found = [(lt, m) for lt in lts for m in lt["milestones"]
                 if _ms_match(m, lt, args)]
        if not found:
            return {"ok": False, "errors": ["子任务不存在"]}
        for lt, m in found:
            storage.delete_milestone(lt["id"], m["id"])
            actions.append(f"删除子任务「{m['text']}」")
        return {"ok": True}
    return {"ok": False, "errors": [f"未知工具 {name}"]}


def _ms_match(m, lt, args):
    """子任务匹配：优先 id，其次按文字（可再用目标标题限定范围）。"""
    if args.get("milestone_id"):
        return m["id"] == args["milestone_id"]
    text = (args.get("milestone_text") or "").strip()
    if not text:
        return False
    if text != m["text"] and text not in m["text"]:
        return False
    lt_limit = (args.get("longterm_title") or "").strip()
    return not lt_limit or lt_limit in lt["title"]


def chat(history):
    """对话式助手。history 为前端传来的 [{role, content}]，返回 {ok, reply, actions}。"""
    system = _system_prompt() + (
        "\n用户当前的日程概况（回答「我有什么安排/哪个最急/长期任务进展」等问题时以此为准）：\n"
        + json.dumps(_assistant_overview(), ensure_ascii=False))
    messages = [{"role": "system", "content": system}]
    for m in history[-_HISTORY_LIMIT:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": str(m["content"])[:4000]})
    actions = []
    nudge_used = 0
    stale_reads = 0
    for _ in range(MAX_TOOL_ROUNDS):
        msg = _call(messages, tools=TOOLS)
        tool_calls = msg.get("tool_calls")
        if not tool_calls:
            reply = msg.get("content") or "（无回复）"
            # 防幻觉：模型声称完成了操作却没调用任何工具时，把它打回去重做一次
            if not actions and nudge_used < 1 and _SUCCESS_CLAIM_RE.search(reply):
                nudge_used += 1
                log.info("AI 声称完成但无工具调用，已要求重做")
                messages.append({"role": "assistant", "content": reply})
                messages.append({"role": "user", "content":
                    "（系统提醒：你刚才声称已完成操作，但实际上没有调用任何工具，"
                    "用户的数据并没有变化。请现在真正调用工具完成；"
                    "如果确实不需要任何操作，请如实重新回复。）"})
                continue
            return {"ok": True, "reply": reply, "actions": actions}
        # glm-4.7-flash 对 content 为空字符串的 tool_calls 消息报 400，content 为空时省略字段
        assistant_msg = {"role": "assistant", "tool_calls": tool_calls}
        if msg.get("content"):
            assistant_msg["content"] = msg["content"]
        messages.append(assistant_msg)
        for tc in tool_calls:
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _exec_tool(fn.get("name", ""), args, actions)
            log.info("AI tool %s(%s) -> %s", fn.get("name", ""),
                     json.dumps(args, ensure_ascii=False)[:200],
                     json.dumps(result, ensure_ascii=False)[:150])
            content = json.dumps(result, ensure_ascii=False)
            # 弱模型容易陷入"反复查询、从不动手"的循环：连续查询无动作时在结果里催它执行
            if fn.get("name") in ("list_events", "list_longterms") and not actions:
                stale_reads += 1
            else:
                stale_reads = 0
            if stale_reads >= 2 and fn.get("name") in ("list_events", "list_longterms"):
                content = ("（系统提醒：你已经连续多次查询，数据不会因查询而改变。"
                           "请现在直接调用删除/修改/添加类工具执行操作，不要再查询。）" + content)
            messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                             "content": content[:1500]})
    return {"ok": True, "reply": f"这次的改动比较多（已完成 {len(actions)} 项），先到这里，你可以继续吩咐。",
            "actions": actions}


# ---------- 统计分析 ----------

SCOPES = ("week", "month", "longterm")


def _aggregate(scope="month", include_heatmap=False):
    """本地聚合数据（不调接口、不花钱），按 scope 出不同侧重，字段尽量紧凑。

    scope: week=本周执行 / month=近 30 天趋势 / longterm=长期目标推进。
    include_heatmap=True 时额外返回近 91 天稀疏热力图（只给前端画图，
    不进大模型提示词，避免白白多花 token）。
    """
    today = datetime.now().date()
    events = storage.get_events()
    lts = storage.get_longterms()
    done_days = {e["date"] for e in events if e.get("done")}

    # 连续完成天数：从今天（今天没完成就从昨天）往前数连续有完成的日子
    streak = 0
    d = today
    if d.isoformat() not in done_days:
        d -= timedelta(days=1)
    while d.isoformat() in done_days:
        streak += 1
        d -= timedelta(days=1)

    overdue_ms = sum(1 for lt in lts for m in lt["milestones"]
                     if m.get("deadline") and m["deadline"] < today.isoformat()
                     and not m.get("done"))

    def day_stat(day):
        evs = [e for e in events if e["date"] == day.isoformat()]
        return {"d": day.strftime("%m-%d"), "dow": "一二三四五六日"[day.weekday()],
                "total": len(evs), "done": sum(1 for e in evs if e.get("done"))}

    def upcoming(days=7):
        a, b = today.isoformat(), (today + timedelta(days=days)).isoformat()
        out = [{"title": e["title"], "date": e["date"], "time": e["time"]}
               for e in events if not e.get("done") and a <= e["date"] <= b]
        out.sort(key=lambda x: (x["date"], x["time"]))
        return out[:20]

    out = {"scope": scope, "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
           "streak": streak, "overdue_milestones": overdue_ms}

    if scope == "week":
        mon = today - timedelta(days=today.weekday())
        days = [day_stat(mon + timedelta(days=i)) for i in range(7)]
        total = sum(x["total"] for x in days)
        done = sum(x["done"] for x in days)
        prev_done = sum(1 for e in events if e.get("done")
                        and (mon - timedelta(days=7)).isoformat() <= e["date"] < mon.isoformat())
        out.update({
            "cards": {"total": total, "done": done, "pending": total - done,
                      "overdue": overdue_ms},
            "rate": round(done / total * 100) if total else 0,
            "days": days, "prev_week_done": prev_done,
            "upcoming_7_days": upcoming(7),
        })
    elif scope == "longterm":
        goals = []
        for lt in lts:
            left = None
            if lt.get("deadline"):
                try:
                    left = (datetime.strptime(lt["deadline"], "%Y-%m-%d").date() - today).days
                except ValueError:
                    pass
            goals.append({
                "title": lt["title"], "deadline": lt.get("deadline", ""), "left": left,
                "done": sum(1 for m in lt["milestones"] if m.get("done")),
                "total": len(lt["milestones"]),
                "overdue_steps": sum(1 for m in lt["milestones"]
                                     if m.get("deadline") and m["deadline"] < today.isoformat()
                                     and not m.get("done")),
            })
        steps_total = sum(g["total"] for g in goals)
        steps_done = sum(g["done"] for g in goals)
        out.update({
            "cards": {"goals": len(goals), "steps_done": steps_done,
                      "steps_total": steps_total, "overdue": overdue_ms},
            "rate": round(steps_done / steps_total * 100) if steps_total else 0,
            "goals": goals,
        })
    else:  # month
        start30 = (today - timedelta(days=29)).isoformat()
        total = sum(1 for e in events if e["date"] >= start30)
        done = sum(1 for e in events if e.get("done") and e["date"] >= start30)
        mon = today - timedelta(days=today.weekday())
        weeks = []
        for i in (3, 2, 1, 0):
            ws = mon - timedelta(days=7 * i)
            we = ws + timedelta(days=6)
            evs = [e for e in events if ws.isoformat() <= e["date"] <= we.isoformat()]
            weeks.append({"label": f"{ws.month}/{ws.day}~{we.month}/{we.day}",
                          "total": len(evs),
                          "done": sum(1 for e in evs if e.get("done"))})
        lt_brief = [{"id": lt["id"], "title": lt["title"], "deadline": lt.get("deadline", ""),
                     "done": sum(1 for m in lt["milestones"] if m.get("done")),
                     "total": len(lt["milestones"])} for lt in lts]
        out.update({
            "cards": {"total": total, "done": done, "pending": total - done,
                      "overdue": overdue_ms},
            "rate": round(done / total * 100) if total else 0,
            "weeks": weeks,
            "longterms": lt_brief,
            "upcoming_7_days": upcoming(7),
        })

    if include_heatmap:
        heat_start = today - timedelta(days=90)
        heat = {}
        for e in events:
            if e["date"] < heat_start.isoformat():
                continue
            t, dn = heat.get(e["date"], (0, 0))
            heat[e["date"]] = (t + 1, dn + (1 if e.get("done") else 0))
        out["heatmap"] = {"start": heat_start.isoformat(),
                          "days": [[k, v[0], v[1]] for k, v in sorted(heat.items())]}
    return out


def _analysis_cache_data():
    now = time.time()
    if _ANALYSIS_CACHE["data"] is None or now - _ANALYSIS_CACHE["ts"] > _CACHE_TTL:
        _ANALYSIS_CACHE["data"] = _aggregate()
        _ANALYSIS_CACHE["ts"] = now
    return _ANALYSIS_CACHE["data"]


ANALYZE_SYSTEM = (
    "你是「日程助手」应用的数据分析引擎。用户数据会以 JSON 给出。"
    "只输出一个 JSON 对象（不要 markdown 代码块），格式："
    '{"summary": "两三句话的总体评价", "insights": ["洞察1", "洞察2", ...], '
    '"suggestions": ["建议1", "建议2", ...]}。'
    "insights 说数据反映出的模式和问题（3-5 条），suggestions 给具体可执行的建议（2-4 条）。"
    "全部简短中文，基于数据说话，不要空洞客套。"
)

_SCOPE_FOCUS = {
    "week": "分析对象是本周（最近 7 天）的日程执行情况：重点点评完成节奏、和上周的对比、未来几天的安排是否合理。",
    "month": "分析对象是最近 30 天的趋势：重点点评习惯养成、起伏规律、各周对比和长期规律。",
    "longterm": "分析对象是长期目标与子任务的推进情况：重点点评目标拆解是否合理、截止日期风险、逾期处理和推进顺序建议。",
}


def analyze(scope="month"):
    """点按钮才触发：聚合本地数据 + 调一次大模型。

    发给模型的剔除 heatmap（纯画图数据），响应里再带回去给前端画图。
    """
    if scope not in SCOPES:
        scope = "month"
    data = _aggregate(scope, include_heatmap=True)
    model_input = {k: v for k, v in data.items() if k != "heatmap"}
    messages = [
        {"role": "system", "content": ANALYZE_SYSTEM + _SCOPE_FOCUS[scope]},
        {"role": "user", "content": "我的日程数据：\n" + json.dumps(model_input, ensure_ascii=False)},
    ]
    msg = _call(messages)
    text = (msg.get("content") or "").strip()
    out = _parse_json_block(text)
    if out is None:
        out = {"summary": text, "insights": [], "suggestions": []}
    out["data"] = data
    out["scope"] = scope
    return {"ok": True, **out}


def analyze_chat(question, history, scope="month"):
    """分析页的追问：按 scope 复用缓存的聚合数据，不重新分析。"""
    now = time.time()
    if _ANALYSIS_CACHE["data"] is None or _ANALYSIS_CACHE.get("scope") != scope \
            or now - _ANALYSIS_CACHE["ts"] > _CACHE_TTL:
        _ANALYSIS_CACHE["data"] = _aggregate(scope)
        _ANALYSIS_CACHE["ts"] = now
        _ANALYSIS_CACHE["scope"] = scope
    data = _ANALYSIS_CACHE["data"]
    messages = [
        {"role": "system",
         "content": "你是「日程助手」的 AI 分析师。" + _SCOPE_FOCUS.get(scope, "")
                    + "下面是用户的日程数据 JSON，基于它用简短中文回答用户问题；"
                      "数据里没有的就直说没有。"
                    + json.dumps(data, ensure_ascii=False)},
    ]
    for m in (history or [])[-6:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": str(m["content"])[:2000]})
    messages.append({"role": "user", "content": str(question)[:2000]})
    msg = _call(messages)
    return {"ok": True, "reply": msg.get("content") or "（无回复）"}


def _parse_json_block(text):
    """模型偶尔会包 ```json 代码块，剥掉再解析。"""
    if text.startswith("```"):
        text = text.strip("`").lstrip("json").strip()
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None
