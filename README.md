# 📅 Schedule Buddy

**English** | [简体中文](README.zh-CN.md)

A standalone, zero-config, **Windows desktop scheduler** that never uploads your data. Opens as a real desktop window (no browser), with everything — events, long-term goals, statistics — stored locally on your own machine.

| Day view | Week view | Stats | Long-term goals |
| --- | --- | --- | --- |
| ![Day](docs/screenshot-day.png) | ![Week](docs/screenshot-week.png) | ![Stats](docs/screenshot-stats.png) | ![Goals](docs/screenshot-goals.png) |

## ✨ Features

- **AI assistant**: plan in one sentence ("meeting at 3pm tomorrow", "30 minutes of vocabulary every morning for two weeks") — the AI parses times and creates/edits events and goals directly, with multi-turn follow-ups
- **AI insights**: nothing runs until you click "Analyze" (zero cost otherwise); get a completion chart, insights and suggestions, then keep asking follow-up questions
- **Desktop window**: runs as a standalone window (pywebview); clicking × minimizes to the system tray while reminders keep working; quit from the tray menu
- **Event management**: create / edit / delete / mark done, with priorities (🔴 high 🟡 med 🟢 low) and categories (Work / Life / Study / Other)
- **Reminders**: from 5 minutes to 1 day ahead, delivered as Windows toast notifications; reminders missed by more than 10 minutes are skipped instead of flooding you on startup
- **Long-term goals**: set goals with optional deadlines (shows "N days left", red when overdue) and per-step deadlines too; drag-and-drop to reorder both goals and steps; progress bars update automatically
- **Statistics & reports**: completion rate, monthly heatmap, category breakdown, plus a **weekly report** (browse any week, compare with the previous one) and an **overall report** (6-month trend, most productive day)
- **Custom background & icon**: drop an image in Settings — the app background and the icons in the title bar, taskbar, tray, desktop shortcut and Start Menu all update at once; one click to restore defaults
- **UI language**: switch 中文 / English from the ⚙ Settings menu (your event content stays as-is)
- **UI opacity**: with a background image set, card opacity is adjustable via a slider
- **Local data**: just a few files on your disk — copying them is a backup

## 🚀 Quick Start (beginner friendly, step by step)

> Requires: a Windows 10/11 PC. No command line needed except one optional step.
>
> **First, check whether the folder contains a `runtime` folder:**
> - **It does** (a zip copied from a friend, or a release package): nothing to install — **jump straight to Step 3!**
> - **It doesn't** (a source download from GitHub): do Steps 1–2 to install Python and dependencies.

### Step 1: Install Python (skip Steps 1–2 if the folder already has `runtime`)

1. Open [https://www.python.org/downloads/](https://www.python.org/downloads/) and click the yellow **Download Python 3.x.x** button
2. Run the installer and **make sure to check "Add Python to PATH"** at the bottom of the first screen, then click **Install Now**
3. That's it

> ⚠️ Forgetting "Add Python to PATH" is the #1 beginner mistake. If you already installed without it, re-run the installer and choose Modify, or reinstall.

### Step 2: Download this app

1. On this page click the green **Code** button → **Download ZIP**
2. Right-click the downloaded `schedule-buddy-main.zip` → **Extract All** (don't run things from inside the ZIP!)
3. Put the extracted `schedule-buddy-main` folder wherever you like (e.g. `D:\`), and try not to move it afterwards

> Git users: `git clone https://github.com/Weltspace/schedule-buddy.git`

### Step 3: Install dependencies (double-click one file, once only; skip if `runtime` exists)

Open the extracted folder and **double-click `install_requirements.bat`**. Wait for "安装完成" (needs internet, about 1–3 minutes). This installs everything the app needs — you never have to do it again.

### Step 4: Launch!

**Double-click `start_schedule_buddy.vbs`** — the Schedule Buddy window pops up. Enjoy!

> If the folder has `runtime`, this is the whole setup: it ships with a complete bundled environment (Python plus all dependencies), so **no Python install and no administrator rights are needed**.

- The ⚙ gear in the top-right opens Settings (language / background / icon / opacity)
- Clicking × only hides the window to the tray; to **quit for real**, right-click the tray icon → 退出 (Exit)
- Want it to auto-start with Windows? Put a shortcut to `start_schedule_buddy.vbs` into the Startup folder (`Win+R`, type `shell:startup`, press Enter)

### Step 5 (recommended): create a desktop shortcut

Double-click `create_desktop_shortcut.py` — it creates a "日程助手" shortcut with the calendar icon on your desktop. (The app also auto-creates/repairs this shortcut on every start; on machines with `runtime` and no Python installed, just start the app once instead of running this.)

> 📌 From now on: double-click the desktop "日程助手" shortcut or `start_schedule_buddy.vbs`. If the app is already running, launching it again just brings the window back.

## 🖥️ Using the app

- **今天 / This Week**: plan and review events by day or week; hide completed items from the top bar
- **Stats**: completion rate, monthly heatmap, category breakdown
- **Weekly / Overall report**: scroll down in Stats — the weekly report browses any week (per-day progress, comparison with last week); the overall report aggregates everything (6-month trend, most productive weekday)
- **Long-term Goals**: the 4th tab. Type a goal (deadline optional) → Add; each step can have its own deadline via the inline "📅 截止日期" button; drag goal cards and steps to reorder; check steps to grow the progress bar

## 🎨 Background & icon (the fun part)

Click the ⚙ gear in the top-right to open Settings:

- **Background image**: drop an image onto the dashed area to apply it instantly; the opacity slider tunes how solid the cards are; "恢复默认背景" restores the default
- **App icon**: drop an image (256×256+ recommended, auto-cropped to square) — the icons in the **title bar, taskbar, tray, desktop shortcut and Start Menu** all become yours; "恢复默认图标" restores the default

You can also drag an image onto `change_icon.py` to change only the icon.

## 📱 Mobile version (PWA, sync with your PC)

The PC and mobile versions share the same web app. Publish it to GitHub Pages (`python deploy_pages.py`, requires a GitHub remote) and open the URL on your phone. In ⚙ Settings, tap **Install to Home Screen** to install it as a standalone app (browsers without the install dialog: use the browser menu "Add to Home Screen"). Data lives in the phone's browser storage; nothing runs in the background. Paste your GLM API key in ⚙ Settings to use AI features on the phone.

**Keeping data in sync (manual sync file):** in ⚙ Settings → "Data Sync", **export** a sync file on one device, send it to the other (e.g. WeChat), and **import** it there (full overwrite, with a warning if the target has unsynced changes). Events and goals are synced; background/theme stay per-device.

## 📶 Access the PC version from your phone (optional, off by default)

The server listens on localhost only (safe default — there is no login). On a trusted home Wi-Fi:

1. Quit the app completely
2. In a command prompt (`Win+R`, type `cmd`):
   ```
   set SCHEDULE_BUDDY_LAN=1
   python app.py
   ```
3. On your phone, open `http://<your-pc-ip>:5217` (find the IP with `ipconfig`)

## 🤖 AI features (optional)

The AI assistant and AI insights are off by default: paste a [Zhipu BigModel](https://open.bigmodel.cn/) API key in ⚙ Settings to enable (`glm-4.7-flash` is the free default, with free backup `glm-4.5-flash` for rate-limited periods; `glm-5.3-flash` is stronger but billed — switch in Settings when you want deeper analysis. The key is stored only in `data/settings.json` on your machine and never uploaded).

- **AI assistant**: conversational planning — create several events at once, reschedule, query, add goals and steps
- **AI insights**: three lenses — **weekly / monthly / long-term** (heatmap, completion rate, progress bars, deadline alerts); data is aggregated locally first, one AI call happens only when you click "Analyze"; follow-up questions reuse that aggregate

Everything else works without any AI setup.

## 💾 Data & backup

Everything lives in the `data` folder: `schedule.json` (events & goals), `settings.json` (preferences). **Backup = copy the `data` folder**; restore = put it back. If a file gets corrupted the app won't crash (it renames the broken file and starts fresh), but back up regularly anyway.

## ❓ FAQ

**Does it need administrator rights?**
No. The app only reads/writes its own folder, the Desktop and the Start Menu (all inside your user profile); there is no elevation logic in the code. If the first launch shows the blue "Windows protected your PC" dialog, that's SmartScreen's routine warning for downloaded files — click "More info → Run anyway". It has nothing to do with administrator rights.

**A .bat / .py file flashes and disappears, or "python is not recognized"?**
Python isn't installed properly or "Add Python to PATH" was missed. Reinstall Python with the checkbox, then run `install_requirements.bat` again.

**Double-clicked the .vbs and nothing happened?**
Wait 2–3 seconds for the window. If you see the app in the taskbar but no window, click the taskbar button. If still nothing, run `start_schedule_buddy_console.bat` — the console window shows the actual error.

**"Port already in use"?**
The app is already running — launching it again just brings the window back. To change the port: `set SCHEDULE_BUDDY_PORT=8080` before `python app.py`.

**No toast notifications?**
Windows Settings → System → Notifications: make sure notifications for the app (python.exe) are enabled.

**How do I quit completely?**
Right-click the tray icon → 退出 (Exit). Closing the window only minimizes to the tray.

**Moved the folder to another PC / path and the shortcut broke?**
The folder is fully portable — data travels with it. Run `create_desktop_shortcut.py` once from the new location, or just start the app once: it repairs the desktop shortcut automatically.

**Antivirus complains?**
This is a plain Python script with no network uploads — safe to whitelist (some AV products are just sensitive to script-based launchers).

## ⚙️ Environment variables (optional)

| Variable | Default | Description |
| --- | --- | --- |
| `SCHEDULE_BUDDY_PORT` | `5217` | Server port |
| `SCHEDULE_BUDDY_LAN` | off | Set to `1` to listen on the LAN (see phone access) |
| `SCHEDULE_BUDDY_TIMEOUT` | `120` | Browser-fallback mode: auto-exit after all pages are closed for N seconds |

## 📁 Project structure

```
├── AGENTS.md                     # Project guide for AI coding assistants (architecture/conventions/pitfalls)
├── app.py                        # Main: Flask API, desktop window, tray, AUMID
├── ai.py                         # AI: GLM tool-calling assistant, insights
├── storage.py                    # Data layer: events/goals/settings/reports, atomic writes
├── media.py                      # Background saving, icon generation, taskbar icon (AUMID), shortcuts
├── notifier.py                   # Windows toast notifications
├── make_icon.py                  # Default icon generator (recolor & re-run to make it yours)
├── change_icon.py                # Manual icon change: drop an image on it
├── create_desktop_shortcut.py    # Creates the desktop shortcut
├── start_schedule_buddy.vbs      # Daily launch entry (no console; prefers runtime/)
├── start_schedule_buddy_console.bat  # Launch with console (for log/debug)
├── install_requirements.bat      # Dependency installer (when runtime/ is absent)
├── runtime/                      # Bundled portable env: Python 3.12 + all dependencies
├── requirements.txt              # Dependency list (for pip install/upgrades)
├── templates/ + static/          # UI (vanilla HTML/CSS/JS, no framework)
└── data/                         # Your data (schedule.json / settings.json)
```

## 📦 Sharing / open-source release

- **Zip and send**: just compress the whole folder into a zip — any Windows 10/11 recipient can extract it and double-click `start_schedule_buddy.vbs`, **no Python installation required** on their machine.
- **Git hosting**: `runtime/` is large (~50 MB of binaries) and should not be committed (excluded in `.gitignore`). People who clone the repo follow "Quick Start" to install Python once and double-click `install_requirements.bat`; alternatively attach a zip with `runtime/` included to your GitHub Releases.

## 🔧 Technical notes

- **Runtime**: pywebview desktop window (× hides to tray, stays resident); falls back to browser mode if pywebview is missing
- **Taskbar icon**: explicit AppUserModelID + a Start Menu shortcut carrying the same AUMID, so icon changes apply to the taskbar too
- **Reminders**: a background thread scans due events every 30 s and fires toasts; open pages show in-app toasts via polling; a shared "reminded" marker prevents duplicates; items overdue by 10+ minutes are skipped silently
- **Data safety**: every write is atomic (temp file + replace) with corruption recovery; all requests are CSRF-protected

## License

[MIT](LICENSE)
