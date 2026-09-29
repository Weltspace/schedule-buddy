"""JSON 存储层：负责日程、长期任务、设置、报表的读写与增删改查。"""
import json
import os
import threading
import uuid
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "schedule.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")

_lock = threading.Lock()

DEFAULT_DATA = {"events": [], "reminded": [], "longterms": []}
DEFAULT_SETTINGS = {
    "language": "zh", "background": "", "icon": "", "card_alpha": "0.9",
    "sync_version": 0,     # 每导出一次同步包 +1（手机导入后记下这个版本）
    "sync_dirty": False,   # 上次同步之后本地数据有没有改过（导入覆盖前的防呆依据）
}

# 同步包标识（手机版 storage.js 保持一致）
SYNC_KIND = "schedule-buddy-sync"

# 提醒时间已过期超过这个秒数就静默跳过（开机后不再补弹陈年旧通知）
REMINDER_GRACE_SECONDS = 10 * 60


# ---------- 设置 ----------
def load_settings():
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            s = json.load(f)
        if not isinstance(s, dict):
            raise ValueError
    except (json.JSONDecodeError, ValueError, OSError):
        s = {}
    out = dict(DEFAULT_SETTINGS)
    out.update(s)
    return out


def _write_settings(s):
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
    os.replace(tmp, SETTINGS_FILE)


def update_settings(payload):
    with _lock:
        s = load_settings()
        if "language" in payload:
            s["language"] = "en" if payload["language"] == "en" else "zh"
        if "background" in payload:
            s["background"] = str(payload["background"])[:100]
        if "icon" in payload:
            s["icon"] = "1" if payload["icon"] in ("1", 1, True) else ""
        if "card_alpha" in payload:
            try:
                alpha = float(payload["card_alpha"])
                s["card_alpha"] = str(round(max(0.3, min(1.0, alpha)), 2))
            except (TypeError, ValueError):
                pass
        if "ai_api_key" in payload:
            s["ai_api_key"] = str(payload["ai_api_key"]).strip()[:200]
        if "ai_model" in payload:
            model = str(payload["ai_model"]).strip()[:50]
            if model:
                s["ai_model"] = model
        if "sync_version" in payload:
            try:
                s["sync_version"] = max(0, int(payload["sync_version"]))
            except (TypeError, ValueError):
                pass
        if "sync_dirty" in payload:
            s["sync_dirty"] = bool(payload["sync_dirty"])
        _write_settings(s)
    return s


def _ensure_file():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_DATA, f, ensure_ascii=False, indent=2)


def load():
    _ensure_file()
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("数据文件结构不对")
    except (json.JSONDecodeError, ValueError, OSError):
        # 手滑改坏/磁盘出错不让程序挂掉：把坏文件改名备份，从空白重新开始
        try:
            os.replace(DATA_FILE, DATA_FILE + ".corrupt")
        except OSError:
            pass
        data = dict(DEFAULT_DATA)
        save(data)
    data.setdefault("events", [])
    data.setdefault("reminded", [])
    data.setdefault("longterms", [])
    return data


def _mark_sync_dirty():
    """数据变了就标记"有未同步的修改"。只在 save() 内部调用（此时已持有 _lock），
    直接写 settings 文件，不能再走 update_settings（会重入 _lock 死锁）。"""
    try:
        s = load_settings()
        if not s.get("sync_dirty"):
            s["sync_dirty"] = True
            _write_settings(s)
    except OSError:
        pass


def save(data):
    _ensure_file()
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)  # 原子写，避免写一半崩溃丢数据
    _mark_sync_dirty()


def export_sync_package(device="pc"):
    """导出同步包：版本 +1、清除本地 dirty 标记。手机/电脑互导，单向覆盖。"""
    s = update_settings({
        "sync_version": int(load_settings().get("sync_version", 0)) + 1,
        "sync_dirty": False,
    })
    data = load()
    return {
        "kind": SYNC_KIND,
        "version": s["sync_version"],
        "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "device": device,
        "data": {
            "events": data["events"],
            "reminded": data["reminded"],
            "longterms": data["longterms"],
        },
    }


def import_sync_package(pkg):
    """导入同步包：整体覆盖本地数据。返回 (统计 dict 或 None, 错误列表)。"""
    if not isinstance(pkg, dict) or pkg.get("kind") != SYNC_KIND:
        return None, ["不是有效的日程助手同步包"]
    d = pkg.get("data")
    if not isinstance(d, dict) or not isinstance(d.get("events"), list) \
            or not isinstance(d.get("longterms"), list) \
            or not isinstance(d.get("reminded"), list):
        return None, ["同步包数据不完整"]
    cleaned = {"events": d["events"], "reminded": d["reminded"], "longterms": d["longterms"]}
    try:
        version = max(0, int(pkg.get("version") or 0))
    except (TypeError, ValueError):
        version = 0
    with _lock:
        save(cleaned)  # save 会标 dirty，随后立即清除
        s = load_settings()
        s["sync_version"] = version
        s["sync_dirty"] = False
        _write_settings(s)
    return {"events": len(cleaned["events"]), "longterms": len(cleaned["longterms"])}, []


VALID_CATEGORIES = {"工作", "生活", "学习", "其他"}


def validate_event(payload, partial=False):
    """校验前端提交的字段，返回 (清理后的字段列表, 错误信息)。"""
    errors = []
    cleaned = {}

    if not partial or "title" in payload:
        title = str(payload.get("title", "")).strip()
        if not title:
            errors.append("标题不能为空")
        elif len(title) > 100:
            errors.append("标题太长（最多100字）")
        else:
            cleaned["title"] = title

    if not partial or "date" in payload:
        date = str(payload.get("date", "")).strip()
        try:
            datetime.strptime(date, "%Y-%m-%d")
            cleaned["date"] = date
        except ValueError:
            errors.append("日期格式应为 YYYY-MM-DD")

    if not partial or "time" in payload:
        time = str(payload.get("time", "")).strip()
        try:
            datetime.strptime(time, "%H:%M")
            cleaned["time"] = time
        except ValueError:
            errors.append("时间格式应为 HH:MM")

    if "notes" in payload:
        cleaned["notes"] = str(payload.get("notes", "")).strip()[:500]

    # 优先级已废弃：老数据/老同步包里的 priority 字段在这里被静默丢弃
    if "category" in payload:
        category = str(payload.get("category", "其他")).strip()[:20]
        cleaned["category"] = category or "其他"
    if not partial or "category" in payload:
        cleaned.setdefault("category", "其他")

    if "remind_minutes" in payload:
        try:
            minutes = int(payload.get("remind_minutes", 0))
            cleaned["remind_minutes"] = max(0, min(minutes, 7 * 24 * 60))
        except (TypeError, ValueError):
            errors.append("提前提醒分钟数必须是整数")

    if "done" in payload:
        cleaned["done"] = bool(payload.get("done"))

    return cleaned, errors


def add_event(cleaned):
    data = load()
    event = {
        "id": uuid.uuid4().hex[:12],
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "done": False,
        **cleaned,
    }
    with _lock:
        data["events"].append(event)
        save(data)
    return event


def update_event(event_id, cleaned):
    data = load()
    with _lock:
        for ev in data["events"]:
            if ev["id"] == event_id:
                ev.update(cleaned)
                save(data)
                return ev
    return None


def delete_event(event_id):
    data = load()
    with _lock:
        before = len(data["events"])
        data["events"] = [ev for ev in data["events"] if ev["id"] != event_id]
        data["reminded"] = [rid for rid in data["reminded"] if rid != event_id]
        if len(data["events"]) < before:
            save(data)
            return True
    return False


def get_events():
    """返回按日期+时间排序的所有日程。"""
    data = load()
    return sorted(data["events"], key=lambda e: (e.get("date", ""), e.get("time", "")))


def mark_reminded(event_id):
    with _lock:
        data = load()
        if event_id not in data["reminded"]:
            data["reminded"].append(event_id)
            save(data)


def pop_due_reminders(now=None):
    """找出已到提醒时间且还没提醒过的日程，标记后返回。

    返回 [(event, remind_at_str), ...]，remind_at 用于页面内提示文案。
    """
    now = now or datetime.now()
    data = load()
    due = []
    changed = False
    with _lock:
        for ev in data["events"]:
            if ev["id"] in data["reminded"] or ev.get("done"):
                continue
            try:
                start = datetime.strptime(
                    f"{ev['date']} {ev['time']}", "%Y-%m-%d %H:%M"
                )
            except (KeyError, ValueError):
                continue
            remind_at = datetime.fromtimestamp(
                start.timestamp() - ev.get("remind_minutes", 0) * 60
            )
            if remind_at <= now:
                data["reminded"].append(ev["id"])
                changed = True
                # 刚过期不久（宽限期内）才补弹，过期太久的静默跳过
                if (now - remind_at).total_seconds() <= REMINDER_GRACE_SECONDS:
                    due.append((ev, remind_at.strftime("%H:%M")))
        if changed:
            save(data)
    return due


def stats():
    """统计数据：总数、完成数、按分类计数、按日期计数（热力图用）。"""
    events = get_events()
    total = len(events)
    done = sum(1 for e in events if e.get("done"))
    by_category = {}
    by_date = {}
    done_by_date = {}
    for e in events:
        cat = e.get("category", "其他")
        by_category[cat] = by_category.get(cat, 0) + 1
        by_date[e["date"]] = by_date.get(e["date"], 0) + 1
        if e.get("done"):
            done_by_date[e["date"]] = done_by_date.get(e["date"], 0) + 1
    return {
        "total": total,
        "done": done,
        "by_category": by_category,
        "by_date": by_date,
        "done_by_date": done_by_date,
    }


# ---------- 长期任务 ----------
def validate_longterm(payload, partial=False):
    """校验长期任务字段，返回 (清理后的字段, 错误信息)。"""
    errors = []
    cleaned = {}

    if not partial or "title" in payload:
        title = str(payload.get("title", "")).strip()
        if not title:
            errors.append("标题不能为空")
        elif len(title) > 100:
            errors.append("标题太长（最多100字）")
        else:
            cleaned["title"] = title

    if not partial or "deadline" in payload:
        deadline = str(payload.get("deadline", "")).strip()
        if not deadline:
            cleaned["deadline"] = ""
        else:
            try:
                datetime.strptime(deadline, "%Y-%m-%d")
                cleaned["deadline"] = deadline
            except ValueError:
                errors.append("截止日期格式应为 YYYY-MM-DD")

    if "notes" in payload:
        cleaned["notes"] = str(payload.get("notes", "")).strip()[:500]

    return cleaned, errors


def _validate_deadline(value):
    """校验可选日期（空串合法），返回 (cleaned, error)。"""
    deadline = str(value or "").strip()
    if not deadline:
        return "", None
    try:
        datetime.strptime(deadline, "%Y-%m-%d")
        return deadline, None
    except ValueError:
        return "", "截止日期格式应为 YYYY-MM-DD"


def get_longterms():
    data = load()
    return data.get("longterms", [])


def add_longterm(cleaned):
    data = load()
    lt = {
        "id": uuid.uuid4().hex[:12],
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "milestones": [],
        **cleaned,
    }
    with _lock:
        data["longterms"].append(lt)
        save(data)
    return lt


def update_longterm(lt_id, cleaned):
    data = load()
    with _lock:
        for lt in data["longterms"]:
            if lt["id"] == lt_id:
                lt.update(cleaned)
                save(data)
                return lt
    return None


def delete_longterm(lt_id):
    data = load()
    with _lock:
        before = len(data["longterms"])
        data["longterms"] = [lt for lt in data["longterms"] if lt["id"] != lt_id]
        if len(data["longterms"]) < before:
            save(data)
            return True
    return False


def _find_longterm(data, lt_id):
    for lt in data["longterms"]:
        if lt["id"] == lt_id:
            return lt
    return None


def add_milestone(lt_id, text, deadline=""):
    text = str(text or "").strip()[:200]
    if not text:
        return None, ["子任务内容不能为空"]
    dl, err = _validate_deadline(deadline)
    if err:
        return None, [err]
    data = load()
    with _lock:
        lt = _find_longterm(data, lt_id)
        if lt is None:
            return None, ["长期任务不存在"]
        ms = {"id": uuid.uuid4().hex[:12], "text": text, "done": False, "deadline": dl}
        lt["milestones"].append(ms)
        save(data)
        return ms, []


def update_milestone(lt_id, ms_id, payload):
    """更新子任务：可改 done、text、deadline。"""
    data = load()
    with _lock:
        lt = _find_longterm(data, lt_id)
        if lt is None:
            return None
        for ms in lt["milestones"]:
            if ms["id"] == ms_id:
                if "done" in payload:
                    ms["done"] = bool(payload["done"])
                if "text" in payload:
                    text = str(payload["text"]).strip()[:200]
                    if text:
                        ms["text"] = text
                if "deadline" in payload:
                    dl, err = _validate_deadline(payload["deadline"])
                    if err:
                        return None
                    ms["deadline"] = dl
                save(data)
                return ms
    return None


def delete_milestone(lt_id, ms_id):
    data = load()
    with _lock:
        lt = _find_longterm(data, lt_id)
        if lt is None:
            return False
        before = len(lt["milestones"])
        lt["milestones"] = [m for m in lt["milestones"] if m["id"] != ms_id]
        if len(lt["milestones"]) < before:
            save(data)
            return True
    return False


def reorder_longterms(order_ids):
    """按给定 id 顺序重排长期任务；缺失的 id 保持在末尾原相对顺序。"""
    data = load()
    with _lock:
        items = {lt["id"]: lt for lt in data["longterms"]}
        ordered = [items[i] for i in order_ids if i in items]
        ordered += [lt for lt in data["longterms"] if lt["id"] not in set(order_ids)]
        if [lt["id"] for lt in ordered] != [lt["id"] for lt in data["longterms"]]:
            data["longterms"] = ordered
            save(data)
            return True
    return False


def reorder_milestones(lt_id, order_ids):
    """按给定 id 顺序重排某长期任务的子任务。"""
    data = load()
    with _lock:
        lt = _find_longterm(data, lt_id)
        if lt is None:
            return False
        items = {m["id"]: m for m in lt["milestones"]}
        ordered = [items[i] for i in order_ids if i in items]
        ordered += [m for m in lt["milestones"] if m["id"] not in set(order_ids)]
        if [m["id"] for m in ordered] != [m["id"] for m in lt["milestones"]]:
            lt["milestones"] = ordered
            save(data)
            return True
    return False


# ---------- 报表 ----------
def _week_monday(d):
    return d - timedelta(days=d.weekday())


def weekly_report(start=None):
    """某一周（周一起）的周报：总数/完成数/完成率、按天、按分类、与上周对比。"""
    today = datetime.now().date()
    d0 = None
    if start:
        try:
            d0 = datetime.strptime(str(start), "%Y-%m-%d").date()
        except ValueError:
            d0 = None
    d0 = _week_monday(d0) if d0 else _week_monday(today)
    days = [d0 + timedelta(days=i) for i in range(7)]
    keys = {d.isoformat() for d in days}

    evs = [e for e in get_events() if e.get("date") in keys]
    done = sum(1 for e in evs if e.get("done"))
    by_day = {d.isoformat(): {"total": 0, "done": 0} for d in days}
    by_category = {}
    for e in evs:
        by_day[e["date"]]["total"] += 1
        if e.get("done"):
            by_day[e["date"]]["done"] += 1
        c = by_category.setdefault(e.get("category", "其他"), {"total": 0, "done": 0})
        c["total"] += 1
        if e.get("done"):
            c["done"] += 1

    prev_keys = {(d0 - timedelta(days=7 + i)).isoformat() for i in range(7)}
    prev = [e for e in get_events() if e.get("date") in prev_keys]
    prev_done = sum(1 for e in prev if e.get("done"))

    return {
        "week_start": days[0].isoformat(),
        "week_end": days[6].isoformat(),
        "total": len(evs),
        "done": done,
        "by_day": by_day,
        "by_category": by_category,
        "prev_total": len(prev),
        "prev_done": prev_done,
    }


def overall_report():
    """总报告：全部总数/完成率、按分类、近 6 个月趋势、最常完成的日子。"""
    evs = get_events()
    total = len(evs)
    done = sum(1 for e in evs if e.get("done"))

    by_category = {}
    today = datetime.now().date()
    y, m = today.year, today.month
    months = []
    for _ in range(6):
        months.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    months.reverse()
    by_month = {mk: {"total": 0, "done": 0} for mk in months}
    weekday_done = [0] * 7

    for e in evs:
        c = by_category.setdefault(e.get("category", "其他"), {"total": 0, "done": 0})
        c["total"] += 1
        if e.get("done"):
            c["done"] += 1
            try:
                wd = datetime.strptime(e["date"], "%Y-%m-%d").weekday()
                weekday_done[wd] += 1
            except ValueError:
                pass
        mk = str(e.get("date", ""))[:7]
        if mk in by_month:
            by_month[mk]["total"] += 1
            by_month[mk]["done"] += 1

    best = None
    if sum(weekday_done):
        best = max(range(7), key=lambda i: weekday_done[i])

    return {
        "total": total,
        "done": done,
        "by_category": by_category,
        "by_month": by_month,
        "weekday_done": weekday_done,
        "best_weekday": best,
    }
