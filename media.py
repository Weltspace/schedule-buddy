"""背景图与图标处理：背景、图标、图标缓存刷新、快捷方式重建。

背景图片和软件图标是两套独立的东西：
  - 背景：上传的图压缩成 data/background.jpg，只做界面背景；
  - 图标：上传的图居中裁方生成多尺寸 ico，存到 data/icons/icon_N.ico。
    每次换图标都用【新文件名】，因为 Windows 按"文件路径"缓存图标，
    原地覆盖同名 ico 缓存不会失效，快捷方式看起来就像没换；
  - 图标更换后刷新 Windows 图标缓存并重建桌面快捷方式。

subprocess 一律带 CREATE_NO_WINDOW：程序以 pythonw（无控制台）运行时，
调用 ie4uinit/powershell 这类控制台程序会闪出一个黑框，用户会以为出故障。
"""
import logging
import os
import re
import shutil
import subprocess
import threading

from PIL import Image

import storage

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ICON_FILE = os.path.join(BASE_DIR, "icon.ico")
ICONS_DIR = os.path.join(storage.DATA_DIR, "icons")
BG_FILE = os.path.join(storage.DATA_DIR, "background.jpg")

# 进程显式 AppUserModelID：配合开始菜单快捷方式控制任务栏图标
# （隐式 AUMID 按 exe 路径分组，任务栏直接用 pythonw.exe 内嵌图标，无视窗口图标）
AUMID = "ScheduleBuddy.App"

# pythonw（无控制台）下启动子进程时，禁止其创建新控制台窗口
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0

log = logging.getLogger("schedule-buddy")

_ICON_NAME_RE = re.compile(r"icon_(\d+)\.ico$")


# ---------- 背景图片 ----------
def save_background(file_storage):
    """压缩存成 data/background.jpg（只做界面背景，不动图标）。"""
    img = Image.open(file_storage.stream)
    img.load()
    rgba = img.convert("RGBA")
    w, h = rgba.size
    scale = min(1.0, 1920.0 / max(w, h))
    if scale < 1.0:
        rgba = rgba.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    flat = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    flat.alpha_composite(rgba)
    flat.convert("RGB").save(BG_FILE, "JPEG", quality=85)
    return {"background": "background.jpg"}


# ---------- 软件图标 ----------
def _make_icon(rgba_img, path):
    """居中裁方生成多尺寸 ico（任务栏/桌面/资源管理器各取所需）。"""
    w, h = rgba_img.size
    side = min(w, h)
    if w != h:
        rgba_img = rgba_img.crop(
            ((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)
        )
    icon_img = rgba_img.resize((256, 256), Image.LANCZOS)
    icon_img.save(
        path, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    )


def _custom_icons():
    """data/icons 下已生成的自定义图标，按序号新→旧排列。"""
    if not os.path.isdir(ICONS_DIR):
        return []
    files = [f for f in os.listdir(ICONS_DIR) if _ICON_NAME_RE.search(f)]
    files.sort(key=lambda f: int(_ICON_NAME_RE.search(f).group(1)), reverse=True)
    return [os.path.join(ICONS_DIR, f) for f in files]


def current_icon_path():
    """当前生效的图标文件：有自定义图标用最新的，否则用项目默认 icon.ico。"""
    customs = _custom_icons()
    return customs[0] if customs else ICON_FILE


def save_icon(file_storage):
    """把上传的图片转成新序号的 icon_N.ico（换文件名以击穿 Windows 图标缓存）。"""
    img = Image.open(file_storage.stream)
    img.load()
    os.makedirs(ICONS_DIR, exist_ok=True)
    customs = _custom_icons()
    next_n = 1
    if customs:
        next_n = int(_ICON_NAME_RE.search(os.path.basename(customs[0])).group(1)) + 1
    path = os.path.join(ICONS_DIR, f"icon_{next_n}.ico")
    _make_icon(img.convert("RGBA"), path)
    # 只保留最新 3 个，避免 data 无限膨胀；被占用的删不掉就随它去
    for old in customs[2:]:
        try:
            os.remove(old)
        except OSError:
            pass
    return path


def restore_default_icon():
    """删除全部自定义图标，回到项目默认 icon.ico。返回之前是否有自定义图标。"""
    had_custom = bool(_custom_icons())
    shutil.rmtree(ICONS_DIR, ignore_errors=True)
    return had_custom


def load_icon_image():
    """读取当前图标为 PIL 图（托盘用），读进内存后文件即可被覆盖/删除。"""
    with open(current_icon_path(), "rb") as f:
        from io import BytesIO
        buf = BytesIO(f.read())
    img = Image.open(buf)
    img.load()
    return img


# ---------- 系统收尾 ----------
def refresh_icon_cache():
    """刷新系统图标缓存，让桌面快捷方式立刻换脸（失败也无妨，F5 即可）。"""
    try:
        subprocess.run(["ie4uinit.exe", "-show"], capture_output=True, timeout=15,
                       creationflags=_NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired):
        pass


def create_shortcut():
    """重建桌面「日程助手」快捷方式，指向当前生效的图标文件。"""
    vbs = os.path.join(BASE_DIR, "start_schedule_buddy.vbs")
    if not os.path.exists(vbs):
        return
    icon = current_icon_path()
    ps = rf"""
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut((Join-Path $desktop '日程助手.lnk'))
$lnk.TargetPath = 'C:\Windows\System32\wscript.exe'
$lnk.Arguments = '"{vbs}"'
$lnk.WorkingDirectory = '{BASE_DIR}'
$lnk.IconLocation = '{icon},0'
$lnk.WindowStyle = 1
$lnk.Description = '我的日程助手'
$lnk.Save()
"""
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
            timeout=30,
            creationflags=_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired):
        log.exception("重建桌面快捷方式失败")


def apply_icon_everywhere():
    """图标变更后的一次性收尾：刷新图标缓存 + 重建快捷方式。"""
    refresh_icon_cache()
    create_shortcut()


def _write_aumid_property(lnk_path, aumid):
    """通过 IPropertyStore 把 System.AppUserModel.ID 属性写进 .lnk 文件。

    PowerShell 的 ExtendedProperty 对该属性只能读不能写，只能走 COM 底层。
    """
    import ctypes
    import uuid
    from ctypes import POINTER, Structure, byref, c_void_p, c_wchar_p

    class PROPERTYKEY(Structure):
        _fields_ = [("fmtid", ctypes.c_ubyte * 16), ("pid", ctypes.c_ulong)]

    class PROPVARIANT(Structure):
        class U(ctypes.Union):
            _fields_ = [("uint64", ctypes.c_ulonglong), ("ptr", c_void_p)]
        _anonymous_ = ("u",)
        _fields_ = [("vt", ctypes.c_ushort), ("res", ctypes.c_ushort * 3), ("u", U)]

    def guid_le(s):
        return (ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID(s).bytes_le)

    ole32 = ctypes.windll.ole32
    shell32 = ctypes.windll.shell32
    ole32.CoInitializeEx(None, 2)  # APARTMENTTHREADED；已初始化时返回 S_FALSE，无碍

    pstore = c_void_p()
    # GPS_READWRITE = 2（要写属性必须是可写存储）
    hr = shell32.SHGetPropertyStoreFromParsingName(
        c_wchar_p(lnk_path), None, 2,
        byref(guid_le("{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}")), byref(pstore),
    )
    if hr != 0 or not pstore:
        raise OSError(f"SHGetPropertyStoreFromParsingName 失败: {hr:#x}")

    vtbl = ctypes.cast(ctypes.cast(pstore, POINTER(c_void_p)).contents, POINTER(c_void_p))
    SetValue = ctypes.WINFUNCTYPE(ctypes.c_ulong, c_void_p, POINTER(PROPERTYKEY),
                                 POINTER(PROPVARIANT))(vtbl[6])
    Commit = ctypes.WINFUNCTYPE(ctypes.c_ulong, c_void_p)(vtbl[7])
    Release = ctypes.WINFUNCTYPE(ctypes.c_ulong, c_void_p)(vtbl[2])
    try:
        key = PROPERTYKEY()
        key.fmtid = guid_le("{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}")  # System.AppUserModel.ID
        key.pid = 5
        buf = ctypes.create_unicode_buffer(aumid)
        pv = PROPVARIANT()
        pv.vt = 31  # VT_LPWSTR
        pv.ptr = ctypes.cast(buf, c_void_p)
        hr = SetValue(pstore, byref(key), byref(pv))
        # S_OK=0；S_FALSE=1（值没变化时属性存储可能返回它，也算成功）
        if hr not in (0, 1):
            raise OSError(f"IPropertyStore::SetValue 失败: {hr:#x}")
        hr = Commit(pstore)
        if hr not in (0, 1):
            raise OSError(f"IPropertyStore::Commit 失败: {hr:#x}")
        return True
    finally:
        Release(pstore)


def update_taskbar_shortcut(icon_path):
    """创建/更新开始菜单里带 AUMID 的「日程助手」快捷方式。

    微软规定任务栏图标按 AppUserModelID 解析：给进程设置显式 AUMID 后，
    任务栏会寻找带相同 AUMID 的快捷方式，并使用【快捷方式的图标】。
    所以换图标时更新这个 lnk，任务栏按钮重建后就会显示新图标。
    （副作用：开始菜单里也会出现一个可用的「日程助手」入口。）
    """
    vbs = os.path.join(BASE_DIR, "start_schedule_buddy.vbs")
    if not os.path.exists(vbs):
        return
    start_menu = os.path.join(
        os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs"
    )
    if not os.path.isdir(start_menu):
        return
    lnk_path = os.path.join(start_menu, "日程助手.lnk")
    ps = rf"""
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut('{lnk_path}')
$lnk.TargetPath = 'C:\Windows\System32\wscript.exe'
$lnk.Arguments = '"{vbs}"'
$lnk.WorkingDirectory = '{BASE_DIR}'
$lnk.IconLocation = '{icon_path},0'
$lnk.WindowStyle = 1
$lnk.Description = '我的日程助手'
$lnk.Save()
"""
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, timeout=30, creationflags=_NO_WINDOW,
        )
        if r.returncode != 0:
            log.warning("任务栏快捷方式创建失败: %s", r.stderr.decode("gbk", "ignore")[:200])
            return
        # 在专属 STA 线程里写属性：调用线程若已是 MTA，.lnk 属性存储会写入失败
        result = {}
        def _work():
            try:
                result["ok"] = _write_aumid_property(lnk_path, AUMID)
            except Exception as exc:  # noqa: BLE001
                result["err"] = exc
        t = threading.Thread(target=_work, daemon=True)
        t.start()
        t.join(timeout=15)
        if result.get("ok"):
            log.info("任务栏 AUMID 快捷方式已更新: %s", icon_path)
        else:
            raise OSError(f"AUMID 属性写入失败: {result.get('err')}")
    except (OSError, subprocess.TimeoutExpired):
        log.exception("任务栏 AUMID 快捷方式更新失败")
