"""日程助手主程序：Flask API + 桌面窗口（pywebview） + 系统托盘。

生命周期设计（像正常桌面软件）：
- 启动后打开一个桌面窗口，同时常驻系统托盘；不再打开浏览器；
- 点窗口右上角 × 只是隐藏到托盘，提醒照常工作；托盘菜单可恢复窗口或真正退出；
- pywebview 未安装时自动回退为浏览器模式（页面全部关闭超时后自动退出）。
"""
import json
import logging
import os
import socket
import sys
import threading
import time
import webbrowser

from flask import Flask, abort, jsonify, request, send_file
import ai
import media
import notifier
import storage

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("SCHEDULE_BUDDY_PORT", "5217"))
# 默认只监听本机；想让同一局域网的手机等设备访问，设置环境变量 SCHEDULE_BUDDY_LAN=1
# （局域网内任何人都能访问这个无鉴权服务，请只在可信网络开启）
HOST = "0.0.0.0" if os.environ.get("SCHEDULE_BUDDY_LAN") == "1" else "127.0.0.1"
URL = f"http://127.0.0.1:{PORT}"
# 环境变量 SCHEDULE_BUDDY_TIMEOUT 可覆盖，便于测试
HEARTBEAT_TIMEOUT = int(os.environ.get("SCHEDULE_BUDDY_TIMEOUT", "120"))

# pythonw 没有控制台，出错必须有地方可查
os.makedirs(os.path.join(BASE_DIR, "data"), exist_ok=True)
logging.basicConfig(
    filename=os.path.join(BASE_DIR, "data", "app.log"),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("schedule-buddy")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 上传图片最大 20MB

# ---------- 心跳 ----------
_last_beat = 0.0
_beat_lock = threading.Lock()


@app.before_request
def csrf_guard():
    """拒绝其他网页发起的跨站写请求（CSRF）。

    浏览器发的 POST/PUT/DELETE 都带 Origin 头；与本服务同源才放行。
    没带 Origin 的客户端（curl、API 工具）不受影响。
    """
    if request.method not in ("POST", "PUT", "DELETE"):
        return None
    origin = request.headers.get("Origin", "")
    if not origin:
        return None
    if HOST == "127.0.0.1" and request.host.split(":")[0] not in ("127.0.0.1", "localhost"):
        return jsonify({"ok": False, "errors": ["已拒绝非本机请求"]}), 403
    from urllib.parse import urlparse
    if urlparse(origin).netloc == request.host:
        return None
    return jsonify({"ok": False, "errors": ["已拒绝来自其他网站的跨站请求"]}), 403


@app.route("/api/heartbeat", methods=["POST"])
def api_heartbeat():
    global _last_beat
    with _beat_lock:
        _last_beat = time.time()
    return jsonify({"ok": True})


@app.route("/")
def index():
    # index.html 移到了项目根目录（与 GitHub Pages 手机版共用同一份文件），直接发送
    return send_file(os.path.join(BASE_DIR, "index.html"))


@app.route("/manifest.json")
def manifest():
    return send_file(os.path.join(BASE_DIR, "manifest.json"), mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    # 电脑版（http://127.0.0.1）页面里不会注册 SW；这个路由只为完整性保留
    return send_file(os.path.join(BASE_DIR, "sw.js"), mimetype="text/javascript")


@app.route("/api/events", methods=["GET"])
def api_list_events():
    return jsonify({"events": storage.get_events()})


@app.route("/api/events", methods=["POST"])
def api_add_event():
    payload = request.get_json(silent=True) or {}
    cleaned, errors = storage.validate_event(payload)
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400
    event = storage.add_event(cleaned)
    return jsonify({"ok": True, "event": event})


@app.route("/api/events/<event_id>", methods=["PUT"])
def api_update_event(event_id):
    payload = request.get_json(silent=True) or {}
    cleaned, errors = storage.validate_event(payload, partial=True)
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400
    event = storage.update_event(event_id, cleaned)
    if event is None:
        return jsonify({"ok": False, "errors": ["日程不存在"]}), 404
    return jsonify({"ok": True, "event": event})


@app.route("/api/events/<event_id>", methods=["DELETE"])
def api_delete_event(event_id):
    if not storage.delete_event(event_id):
        return jsonify({"ok": False, "errors": ["日程不存在"]}), 404
    return jsonify({"ok": True})


@app.route("/api/stats", methods=["GET"])
def api_stats():
    return jsonify(storage.stats())


@app.route("/api/reports/weekly", methods=["GET"])
def api_report_weekly():
    return jsonify(storage.weekly_report(request.args.get("start")))


@app.route("/api/reports/overall", methods=["GET"])
def api_report_overall():
    return jsonify(storage.overall_report())


@app.route("/api/reminders/poll", methods=["POST"])
def api_poll_reminders():
    """前端定时调用：返回到期的提醒并标记已提醒，避免漏弹。"""
    due = storage.pop_due_reminders()
    return jsonify({
        "reminders": [
            {
                "id": ev["id"],
                "title": ev["title"],
                "time": ev["time"],
                "date": ev["date"],
                "remind_at": remind_at,
            }
            for ev, remind_at in due
        ]
    })


@app.route("/api/settings", methods=["GET"])
def api_get_settings():
    s = storage.load_settings()
    # API Key 不回传前端，只告知是否已设置
    s["ai_key_set"] = bool(str(s.pop("ai_api_key", "")).strip())
    return jsonify(s)


@app.route("/api/settings", methods=["PUT"])
def api_set_settings():
    payload = request.get_json(silent=True) or {}
    s = storage.update_settings(payload)
    s.pop("ai_api_key", None)  # 响应里不回传 key
    return jsonify({"ok": True})


# ---------- AI 功能 ----------
@app.route("/api/ai/status", methods=["GET"])
def api_ai_status():
    return jsonify({"ok": True, "ready": ai.key_ready(), "model": ai.get_model(),
                    "models": ai.MODELS})


@app.route("/api/ai/chat", methods=["POST"])
def api_ai_chat():
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(ai.chat(payload.get("messages") or []))
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception:
        log.exception("AI 对话失败")
        return jsonify({"ok": False, "error": "AI 服务出错了，请稍后再试"}), 500


@app.route("/api/ai/analyze", methods=["POST"])
def api_ai_analyze():
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(ai.analyze(payload.get("scope") or "month"))
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception:
        log.exception("AI 分析失败")
        return jsonify({"ok": False, "error": "AI 分析出错了，请稍后再试"}), 500


@app.route("/api/ai/analyze/chat", methods=["POST"])
def api_ai_analyze_chat():
    payload = request.get_json(silent=True) or {}
    question = str(payload.get("question") or "").strip()
    if not question:
        return jsonify({"ok": False, "error": "问题不能为空"}), 400
    try:
        return jsonify(ai.analyze_chat(question, payload.get("history") or [],
                                       payload.get("scope") or "month"))
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception:
        log.exception("AI 分析追问失败")
        return jsonify({"ok": False, "error": "AI 服务出错了，请稍后再试"}), 500


# ---------- 长期任务 ----------
@app.route("/api/longterms", methods=["GET"])
def api_list_longterms():
    return jsonify({"longterms": storage.get_longterms()})


@app.route("/api/longterms", methods=["POST"])
def api_add_longterm():
    payload = request.get_json(silent=True) or {}
    cleaned, errors = storage.validate_longterm(payload)
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400
    return jsonify({"ok": True, "longterm": storage.add_longterm(cleaned)})


@app.route("/api/longterms/<lt_id>", methods=["PUT"])
def api_update_longterm(lt_id):
    payload = request.get_json(silent=True) or {}
    cleaned, errors = storage.validate_longterm(payload, partial=True)
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400
    lt = storage.update_longterm(lt_id, cleaned)
    if lt is None:
        return jsonify({"ok": False, "errors": ["长期任务不存在"]}), 404
    return jsonify({"ok": True, "longterm": lt})


@app.route("/api/longterms/<lt_id>", methods=["DELETE"])
def api_delete_longterm(lt_id):
    if not storage.delete_longterm(lt_id):
        return jsonify({"ok": False, "errors": ["长期任务不存在"]}), 404
    return jsonify({"ok": True})


@app.route("/api/longterms/reorder", methods=["PUT"])
def api_reorder_longterms():
    payload = request.get_json(silent=True) or {}
    order = payload.get("order") or []
    if not isinstance(order, list):
        return jsonify({"ok": False, "errors": ["order 应为 id 数组"]}), 400
    storage.reorder_longterms([str(i) for i in order])
    return jsonify({"ok": True})


# 用 POST 避免与 PUT /api/longterms/<lt_id>/milestones/<ms_id> 的路由歧义
@app.route("/api/longterms/<lt_id>/milestones/reorder", methods=["POST"])
def api_reorder_milestones(lt_id):
    payload = request.get_json(silent=True) or {}
    order = payload.get("order") or []
    if not isinstance(order, list):
        return jsonify({"ok": False, "errors": ["order 应为 id 数组"]}), 400
    if not storage.reorder_milestones(lt_id, [str(i) for i in order]):
        return jsonify({"ok": False, "errors": ["长期任务不存在"]}), 404
    return jsonify({"ok": True})


@app.route("/api/longterms/<lt_id>/milestones", methods=["POST"])
def api_add_milestone(lt_id):
    payload = request.get_json(silent=True) or {}
    ms, errors = storage.add_milestone(lt_id, payload.get("text"), payload.get("deadline", ""))
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400
    return jsonify({"ok": True, "milestone": ms})


@app.route("/api/longterms/<lt_id>/milestones/<ms_id>", methods=["PUT"])
def api_update_milestone(lt_id, ms_id):
    payload = request.get_json(silent=True) or {}
    ms = storage.update_milestone(lt_id, ms_id, payload)
    if ms is None:
        return jsonify({"ok": False, "errors": ["子任务不存在"]}), 404
    return jsonify({"ok": True, "milestone": ms})


@app.route("/api/longterms/<lt_id>/milestones/<ms_id>", methods=["DELETE"])
def api_delete_milestone(lt_id, ms_id):
    if not storage.delete_milestone(lt_id, ms_id):
        return jsonify({"ok": False, "errors": ["子任务不存在"]}), 404
    return jsonify({"ok": True})


# ---------- 数据同步（同步包：与手机 PWA 互导，单向覆盖） ----------
@app.route("/api/sync/export", methods=["GET"])
def api_sync_export():
    pkg = storage.export_sync_package()
    # 桌面窗口（WebView2）会吞掉 <a download> 的 blob 下载，所以电脑版由后端
    # 直接把文件写进用户的"下载"文件夹；写失败则返回空 saved_path，
    # 前端回退为浏览器下载（局域网浏览器模式不受影响）。
    saved_path = ""
    try:
        downloads = os.path.join(os.path.expanduser("~"), "Downloads")
        os.makedirs(downloads, exist_ok=True)
        fname = "schedule-buddy-sync-{}.json".format(
            pkg["exported_at"].replace("-", "").replace(":", "").replace(" ", ""))
        full = os.path.join(downloads, fname)
        with open(full, "w", encoding="utf-8") as f:
            json.dump(pkg, f, ensure_ascii=False, indent=2)
        saved_path = full
    except OSError:
        log.exception("同步包写入下载文件夹失败，回退浏览器下载")
    pkg["saved_path"] = saved_path
    return jsonify(pkg)


@app.route("/api/sync/import", methods=["POST"])
def api_sync_import():
    payload = request.get_json(silent=True) or {}
    result, errors = storage.import_sync_package(payload)
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400
    return jsonify({"ok": True, **result})


# ---------- 背景图片 / 软件图标 ----------
@app.route("/api/background", methods=["GET"])
def api_get_background():
    if not storage.load_settings().get("background"):
        abort(404)
    return send_file(media.BG_FILE, mimetype="image/jpeg", max_age=0)


@app.route("/api/background", methods=["POST"])
def api_set_background():
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify({"ok": False, "errors": ["没有收到图片文件"]}), 400
    if not (f.mimetype or "").startswith("image/"):
        return jsonify({"ok": False, "errors": ["请上传图片文件（png/jpg 等）"]}), 400
    try:
        result = media.save_background(f)
    except Exception:
        log.exception("背景图处理失败")
        return jsonify({"ok": False, "errors": ["图片处理失败，请换一张试试"]}), 400
    storage.update_settings({"background": result["background"]})
    return jsonify({"ok": True, **result})


@app.route("/api/background", methods=["DELETE"])
def api_del_background():
    try:
        if os.path.exists(media.BG_FILE):
            os.remove(media.BG_FILE)
    except OSError:
        log.exception("删除背景图失败")
    storage.update_settings({"background": ""})
    return jsonify({"ok": True})


@app.route("/api/icon/preview", methods=["GET"])
def api_icon_preview():
    return send_file(media.ICON_FILE, mimetype="image/x-icon", max_age=0)


@app.route("/api/icon", methods=["POST"])
def api_set_icon():
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify({"ok": False, "errors": ["没有收到图片文件"]}), 400
    if not (f.mimetype or "").startswith("image/"):
        return jsonify({"ok": False, "errors": ["请上传图片文件（png/jpg 等）"]}), 400
    try:
        media.save_icon(f)
    except Exception:
        log.exception("图标处理失败")
        return jsonify({"ok": False, "errors": ["图片处理失败，请换一张试试"]}), 400
    update_tray_icon()
    media.apply_icon_everywhere()
    media.update_taskbar_shortcut(media.current_icon_path())
    try:
        import webview
        # 让之后重建的窗口（托盘"打开"等）创建时就带上新图标
        webview._state["icon"] = media.current_icon_path()
    except Exception:
        pass
    threading.Thread(target=_apply_native_icon, daemon=True).start()
    storage.update_settings({"icon": "1"})
    return jsonify({"ok": True})


@app.route("/api/icon", methods=["DELETE"])
def api_del_icon():
    restored = media.restore_default_icon()
    if restored:
        update_tray_icon()
        media.apply_icon_everywhere()
        media.update_taskbar_shortcut(media.current_icon_path())
        try:
            import webview
            webview._state["icon"] = media.current_icon_path()
        except Exception:
            pass
        threading.Thread(target=_apply_native_icon, daemon=True).start()
    storage.update_settings({"icon": ""})
    return jsonify({"ok": True, "restored": restored})


# ---------- 后台线程 ----------
def reminder_loop():
    """每 30 秒检查到期日程，弹 Windows 系统通知。"""
    while True:
        try:
            for ev, _ in storage.pop_due_reminders():
                notifier.send_toast(ev)
        except Exception:
            log.exception("提醒线程出错")
        time.sleep(30)


def watchdog_loop():
    """浏览器模式下：页面全部关闭超过 HEARTBEAT_TIMEOUT 秒后自动退出。

    桌面窗口模式下不启用（关窗只是隐藏到托盘，程序常驻）。
    """
    while True:
        time.sleep(5)
        with _beat_lock:
            last = _last_beat
        if last and time.time() - last > HEARTBEAT_TIMEOUT:
            log.info("所有页面已关闭超过 %s 秒，自动退出", HEARTBEAT_TIMEOUT)
            shutdown_app()


def shutdown_app():
    log.info("日程助手退出")
    tray = _tray_ref[0]
    if tray is not None:
        try:
            tray.stop()
        except Exception:
            pass
    os._exit(0)  # 数据每次修改都同步落盘，直接退出是安全的


# ---------- 系统托盘 ----------
_tray_ref = [None]


def update_tray_icon():
    """把托盘图标换成最新的 icon.ico。"""
    tray = _tray_ref[0]
    if tray is None:
        return
    try:
        tray.icon = media.load_icon_image()
    except Exception:
        log.exception("托盘图标更新失败")


def start_tray():
    """托盘图标；pystray 不可用或失败时降级为仅心跳退出。"""
    try:
        import pystray
    except ImportError:
        log.warning("pystray 未安装，跳过托盘图标")
        return
    try:
        image = media.load_icon_image()
        menu = pystray.Menu(
            pystray.MenuItem("打开日程助手", lambda: show_or_create_window(), default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出", lambda: shutdown_app()),
        )
        icon = pystray.Icon("schedule-buddy", image, "日程助手", menu)
        icon.run_detached()
        _tray_ref[0] = icon
    except Exception:
        log.exception("托盘图标启动失败")


# ---------- 桌面窗口 ----------
_window_ref = [None]
_webview_mode = [False]


def _on_window_closing():
    """点窗口 × ：隐藏到托盘并取消关闭，让提醒继续工作。

    pywebview 约定：closing 处理函数返回 False 即取消关闭（winforms 后端
    should_cancel → args.Cancel=True）。
    """
    try:
        w = _window_ref[0]
        if w is not None:
            w.hide()
    except Exception:
        log.exception("隐藏窗口失败")
    return False  # 取消真正的关闭，窗口只是隐藏


def _on_window_closed():
    _window_ref[0] = None


def _apply_native_icon_ui(icon_path):
    """在 UI 线程上把当前图标应用到标题栏【和】任务栏（仅 Windows）。

    只用两条可靠路径：
    1. .NET 设置 Form.Icon —— 句柄类型安全，标题栏即时生效；
    2. Hide + Show —— 任务栏按钮随之移除再重建，重建时才重新读取图标。
    切勿再用 ctypes 手动 LoadImageW + WM_SETICON：ctypes 未声明返回值类型时
    64 位图标句柄会被截断成无效句柄，反而把 .NET 设置好的图标覆盖掉，
    系统回退显示 python 默认图标——这正是"任务栏闪一下还是 python"的原因。
    必须在 UI 线程执行（WinForms 控件禁止跨线程修改，否则整个进程卡死），
    由 _apply_native_icon 通过 BeginInvoke 派发过来。
    """
    w = _window_ref[0]
    if w is None or w.native is None:
        return
    try:
        from System.Drawing import Icon
        import System.IO as IO
        # 经内存流构造 Icon，避免对象长期锁住图标文件（否则恢复默认时删不掉）
        fs = IO.FileStream(icon_path, IO.FileMode.Open, IO.FileAccess.Read)
        try:
            w.native.Icon = Icon(fs)
        finally:
            fs.Close()
    except Exception:
        log.exception("窗口图标(.NET)设置失败")
    try:
        w.native.Hide()
        w.native.Show()
        log.info("窗口/任务栏图标已更新: %s", icon_path)
    except Exception:
        log.exception("任务栏按钮刷新失败")


def _apply_native_icon():
    """把图标更新派发到 UI 线程执行（WinForms 控件禁止跨线程修改）。"""
    if sys.platform != "win32":
        return
    icon_path = media.current_icon_path()
    w = _window_ref[0]
    if w is None:
        return
    try:
        import System.Windows.Forms as WinForms
        w.native.BeginInvoke(WinForms.MethodInvoker(lambda: _apply_native_icon_ui(icon_path)))
    except Exception:
        log.exception("派发图标更新到 UI 线程失败，改为当前线程直接执行")
        _apply_native_icon_ui(icon_path)


def show_or_create_window():
    """恢复已隐藏的窗口，没有就新建一个（托盘菜单与启动时共用）。"""
    w = _window_ref[0]
    if w is not None:
        try:
            w.show()
            return
        except Exception:
            _window_ref[0] = None
    try:
        import webview
        w = webview.create_window(
            "日程助手", URL, width=1200, height=820, min_size=(960, 600),
            background_color="#f4f6fa",
        )
        w.events.closing += _on_window_closing
        w.events.closed += _on_window_closed
        _window_ref[0] = w
    except Exception:
        log.exception("创建桌面窗口失败，回退浏览器")
        webbrowser.open(URL)


# ---------- 启动 ----------
def already_running():
    """端口已被占用说明程序已在运行，避免重复启动报错。"""
    s = socket.socket()
    s.settimeout(0.5)
    try:
        s.connect(("127.0.0.1", PORT))
        return True
    except OSError:
        return False
    finally:
        s.close()


def open_browser_later():
    time.sleep(1.2)
    webbrowser.open(URL)


def wait_server_ready(timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = socket.socket()
        s.settimeout(0.3)
        try:
            s.connect(("127.0.0.1", PORT))
            return True
        except OSError:
            time.sleep(0.2)
        finally:
            s.close()
    return False


def run_browser_mode():
    """pywebview 不可用时的回退模式：浏览器打开 + 心跳超时自动退出。"""
    threading.Thread(target=open_browser_later, daemon=True).start()
    threading.Thread(target=watchdog_loop, daemon=True).start()
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)


def _set_explicit_aumid():
    """给进程设置显式 AppUserModelID（必须在创建任何窗口之前）。

    隐式 AUMID 按 exe 路径分组，任务栏直接用 pythonw.exe 内嵌的 python 图标，
    窗口图标怎么改它都不理。设置显式 AUMID 并配合带相同 AUMID 的快捷方式
    （见 media.update_taskbar_shortcut），任务栏才会使用我们的图标。
    """
    if sys.platform != "win32":
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(media.AUMID)
        log.info("进程 AUMID 已设置: %s", media.AUMID)
    except Exception:
        log.exception("设置进程 AUMID 失败")


def _bring_window_front():
    """webview 循环启动后再把窗口拉到前台一次。

    由 .vbs/快捷方式拉起时，Windows 可能给进程带上"首窗口不激活"的启动
    状态，导致窗口只在任务栏里、不上屏——这里主动 show 一次抵消。
    """
    time.sleep(1.0)
    w = _window_ref[0]
    if w is not None:
        try:
            w.show()
        except Exception:
            pass


def run_desktop_mode():
    """桌面窗口模式（主流程）：关窗隐藏到托盘，程序常驻。"""
    import webview
    _webview_mode[0] = True
    media.update_taskbar_shortcut(media.current_icon_path())
    show_or_create_window()
    # icon 参数让窗口从创建起就带自定义图标（Windows 后端实际支持，
    # 文档写"仅 GTK/QT"是过时的）：任务栏图标在按钮创建时就是对的
    webview.start(_bring_window_front, icon=media.current_icon_path())
    # 能走到这里说明窗口被真正关闭了（如任务管理器关窗），转入纯托盘模式继续工作
    log.info("窗口已全部关闭，转入托盘常驻模式")
    print("窗口已关闭，日程助手仍在托盘中运行，提醒照常弹出")
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    try:
        if already_running():
            log.info("重复启动：程序已在运行，打开窗口/页面")
            _set_explicit_aumid()
            try:
                show_or_create_window()
                import webview
                webview.start(icon=media.current_icon_path())
            except ImportError:
                webbrowser.open(URL)
            sys.exit(0)
        log.info("日程助手启动 host=%s port=%s", HOST, PORT)
        # AUMID 必须在托盘/窗口等任何窗口创建之前设置，否则调用失效
        _set_explicit_aumid()
        start_tray()
        # 自动修复桌面快捷方式（改名/搬家/换图标后指向可能过期）
        threading.Thread(target=media.create_shortcut, daemon=True).start()
        threading.Thread(target=reminder_loop, daemon=True).start()
        threading.Thread(
            target=lambda: app.run(host=HOST, port=PORT, debug=False, use_reloader=False),
            daemon=True,
        ).start()
        wait_server_ready()
        try:
            import webview  # noqa: F401
        except ImportError:
            webview = None
        if HOST != "127.0.0.1":
            # 局域网模式仍按老方式用浏览器，方便手机访问
            log.info("局域网模式：使用浏览器打开")
            run_browser_mode()
        elif webview is not None:
            print("=" * 46)
            print("  日程助手已启动（仅本机可访问）")
            print("  关闭窗口只是最小化到托盘，提醒照常弹出")
            print("  右下角托盘图标可打开窗口或退出")
            print("=" * 46)
            run_desktop_mode()
        else:
            log.warning("pywebview 未安装，使用浏览器模式")
            print("  （未安装 pywebview，回退为浏览器模式；可执行 pip install pywebview）")
            run_browser_mode()
    except Exception:
        log.exception("启动失败")
        raise
