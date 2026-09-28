"""Windows 系统通知封装。winotify 不可用时静默降级（页面内提醒仍然有效）。"""
import sys

try:
    from winotify import Notification, audio
    _HAS_WINOTIFY = True
except ImportError:
    _HAS_WINOTIFY = False

PRIORITY_ICON = {"高": "🔴", "中": "🟡", "低": "🟢"}


def send_toast(event):
    if not _HAS_WINOTIFY:
        print(f"[提醒] {event['title']} ({event['date']} {event['time']})")
        return
    icon = PRIORITY_ICON.get(event.get("priority", "中"), "")
    msg = f"{event['date']} {event['time']} · 优先级{event.get('priority', '中')}"
    if event.get("notes"):
        msg += f"\n{event['notes'][:120]}"
    try:
        toast = Notification(
            app_id="日程助手",
            title=f"{icon} {event['title']}",
            msg=msg,
            duration="short",
        )
        toast.set_audio(audio.Default, loop=False)
        toast.show()
    except Exception as exc:
        # 通知失败不影响主流程（比如 Windows 通知权限被关）
        print(f"[通知] 弹出失败: {exc}")
