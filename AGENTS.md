# AGENTS.md — 给 AI 协作者的项目说明书

> 本文件写给在这个仓库里工作的 AI 编程助手（也适合新加入的人类开发者）。
> 目标：让你在 5 分钟内理解项目的结构、约定、历史决策和所有已知的坑，避免踩坑和"好心办坏事"。

## 1. 项目是什么

**日程助手 Schedule Buddy**：一个 Windows 桌面单机日程管理工具。纯 Python 后端（Flask 提供 API）+ pywebview 桌面窗口 + 原生 HTML/CSS/JS 前端（无框架、无构建步骤）。数据全部存本地 JSON 文件，不上传任何服务器。

- 目标用户：不折腾的普通 Windows 用户（双击就能用，包括没装 Python 的电脑）
- 计划开源（MIT）
- **仅支持 Windows**（依赖 pywebview/winforms、winotify 通知、pystray 托盘、vbs/bat 启动链）

### 1.1 手机版（2026-09 新增，同一套代码的两种运行形态）

前端是**一份代码、两种形态**，`static/api.js` 的 `API.init()` 启动时探测：

- **http 形态**（电脑版）：`/api/settings` 可达 → 一切走 Flask，行为与历史版本一致
- **local 形态**（手机 PWA）：静态托管（GitHub Pages）下 `/api/settings` 404 → 数据走 `static/local/storage.js`（IndexedDB），AI 走 `static/local/ai.js`（浏览器直连 GLM，CORS 已实测放行）。可用 URL 参数 `?mode=local` / `?mode=http` 强制指定（测试用）

**三组"孪生文件"，改任何一边必须同步另一边（语义漂移会破坏同步包互换）：**
- `storage.js` ↔ `storage.py`：校验规则、排序、聚合、提醒宽限、reorder 幂等语义全部逐条对应
- `local/ai.js` ↔ `ai.py`：12 个工具 schema、标题/文字匹配算法、防幻觉/防死循环护栏、聚合分析结构
- 同步包格式常量 `SYNC_KIND = "schedule-buddy-sync"` 两边一致

**数据互通模型（用户明确选择）**：不做实时同步、不挂任何后台服务。两端各一对「导出/导入同步包」按钮（设置弹窗内），单向整体覆盖 + 导入前防呆确认（本地有未同步修改时警告）。版本号 `sync_version` 每次导出 +1，任何数据写入标记 `sync_dirty`。`storage.py` 的 `_mark_sync_dirty()` 在 `save()` 内部调用（此时已持有 `_lock`），**只能直接写 settings 文件，绝不能调 update_settings（会重入 _lock 死锁）**。

**移动端 UI 约定**：≤700px 断点下标签栏固定到屏幕底部（`.topbar` 的 backdrop-filter 必须在窄屏撤掉，否则 fixed 子元素以 topbar 为定位基准——踩过）；触屏拖拽 = pointer 长按 250ms（HTML5 DnD 手机不可用），插入计算与桌面共用 `moveDragging()`；`body.local-mode` 下"软件图标"设置块 CSS 隐藏；热力图格子点按弹 toast（触屏无 hover）。

**PWA**：`index.html` 在项目根目录（templates/ 已删除，app.py 的 `/` 路由改 send_file；**改了它仍必须重启进程**）。`manifest.json` + `sw.js` 在根目录；SW 只在 https 下注册（index.html 里判断），部署用 `deploy_pages.py`（推 gh-pages 分支，文件清单在脚本里的 DEPLOY_FILES）。PNG 图标由 `make_pwa_icons.py` 从 icon.ico 生成。

## 2. 怎么运行（本机开发/验证流程）

```bash
# 方式一：便携运行时（推荐，完全自包含，不依赖系统 Python）
./runtime/python.exe app.py          # 有控制台，能看日志
./runtime/pythonw.exe app.py         # 无控制台（托盘常驻模式）

# 方式二：系统 Python（需先 pip install -r requirements.txt）
python app.py
```

- 服务地址：`http://127.0.0.1:5217`（端口可用环境变量 `SCHEDULE_BUDDY_PORT` 覆盖）
- 用户日常入口：双击 `start_schedule_buddy.vbs`（优先用 runtime\pythonw.exe，失败回退系统 pythonw）；`start_schedule_buddy_console.bat` 是带控制台的排错入口
- **改了 `templates/index.html` 后必须重启进程**（Jinja 模板有进程内缓存，debug=False 时不会自动重载）；改 `static/` 下的 JS/CSS 只需浏览器强刷
- 重复启动不会报错：程序检测到 5217 端口被占用会把已有窗口调出来
- 关闭窗口 = 隐藏到托盘（不是退出）；真正退出走托盘菜单

## 3. 目录结构（⚠️ 有大量路径耦合，不要随手移动文件）

```
├── app.py                        # Flask 主程序：所有 /api 路由、托盘、窗口、启动编排
├── ai.py                         # AI 模块：GLM 对话助手（工具调用）+ 统计分析
├── storage.py                    # 数据层：JSON 读写、校验、原子落盘、报表聚合（带线程锁）
├── media.py                      # 背景图/图标生成、AUMID 任务栏图标、快捷方式重建
├── notifier.py                   # Windows 系统通知封装（winotify）
├── make_icon.py                  # 生成默认 icon.ico 的脚本（改配色用）
├── change_icon.py                # 手动换 icon.ico（拖图片上去）
├── create_desktop_shortcut.py    # 手动创建桌面快捷方式
├── start_schedule_buddy.vbs      # 用户日常启动入口（双击）
├── start_schedule_buddy_console.bat  # 带控制台启动（排错用）
├── install_requirements.bat      # 无 runtime 时安装依赖
├── icon.ico                      # 默认应用图标
├── runtime/                      # 便携 Python 3.12.1 + 全部依赖（~53MB，gitignore）
├── index.html                    # 整个 UI 的唯一 HTML（根目录；电脑/手机共用，templates/ 已删）
├── manifest.json + sw.js         # PWA 清单与 Service Worker（只在 https 注册）
├── static/api.js                 # 前端统一数据入口（http/local 双适配器）
├── static/local/storage.js       # 手机版本地数据层（storage.py 的 JS 移植，孪生文件）
├── static/local/ai.js            # 手机版本地 AI（ai.py 的 JS 移植，孪生文件）
├── static/style.css              # 全部样式（设计 token 在 :root；移动端断点在文件尾部）
├── static/main.js                # 全部前端逻辑（含 i18n 词典）
├── deploy_pages.py               # 发布网页到 GitHub Pages（gh-pages 分支）
├── make_pwa_icons.py             # 从 icon.ico 生成 PWA PNG 图标
├── data/                         # 用户数据（schedule.json / settings.json / app.log / icons/）
├── docs/                         # README 截图
├── requirements.txt              # 依赖清单（runtime 已按它预装）
└── README.md / README.zh-CN.md   # 英文/中文说明
```

**路径耦合点（移动任何文件前必读）：**
- `media.py` / `create_desktop_shortcut.py` 用 `BASE_DIR` 相对路径引用 vbs 和 icon.ico
- `start_schedule_buddy.vbs` 写死了 `runtime\pythonw.exe` 和 `app.py` 的相对位置
- `data/` 必须在程序目录下（备份 = 复制 data 文件夹是产品承诺）
- **结论：保持现有扁平结构**。这是刻意为之（10 来个文件的桌面小工具，扁平最利于"解压双击就能跑"），不要重构出 src/ 之类的层级

## 4. 数据格式

### data/schedule.json（storage.py 负责读写，带 `_lock` 线程锁，原子写入：tmp 文件 + os.replace）

```jsonc
{
  "events": [                     // 日程
    {
      "id": "d35e...",            // 随机 hex id
      "title": "团队周会",
      "date": "2026-09-26",       // YYYY-MM-DD
      "time": "14:00",            // HH:MM
      "priority": "高",           // 高 | 中 | 低
      "remind_minutes": 15,       // 提前提醒分钟数，0 = 不提醒
      "notes": "可选备注",
      "done": false,
      "category": "其他"          // ⚠️ 遗留字段：UI 已移除分类体系（见 §7），新日程固定"其他"，仅老数据还有值
    }
  ],
  "reminded": ["..."],            // 已提醒标记（event_id + 时间戳），防重复弹通知；过期超 10 分钟静默跳过
  "longterms": [                  // 长期任务
    {
      "id": "...", "title": "考托福", "deadline": "2026-10-15",  // deadline 可为空串
      "milestones": [
        {"id": "...", "text": "正式考试", "deadline": "2026-10-23", "done": false}
      ]
    }
  ]
}
```

### data/settings.json

```jsonc
{
  "language": "zh",           // zh | en
  "background": "",           // 有背景图时为 "1"
  "icon": "",                 // 有自定义图标时为 "1"
  "card_alpha": "0.9",        // 有背景图时卡片不透明度 0.3~1.0（字符串）
  "ai_api_key": "...",        // 🔒 智谱 API Key。绝对不能出现在：代码、日志、API 响应、报错信息里
  "ai_model": "glm-4.7-flash" // 当前选择的模型，必须是 ai.MODELS 里的值
}
```

`GET /api/settings` 会把 `ai_api_key` 弹出、换成 `ai_key_set: true/false`；`PUT /api/settings` 的响应也不回传 key。**新增设置字段时必须保持这个规矩**（白名单在 `storage.update_settings`）。

## 5. 后端 API 一览（app.py）

| 方法/路径 | 作用 |
|---|---|
| GET/POST/PUT/DELETE `/api/events[/<id>]` | 日程 CRUD（新增/修改走 `storage.validate_event` 校验） |
| POST `/api/heartbeat` | 前端每 5s 心跳；浏览器回退模式下页面全关 120s 后自动退出进程 |
| GET `/api/stats`、`/api/reports/weekly`、`/api/reports/overall` | 统计聚合（**UI 已无统计视图，但接口保留给将来 agent 系统用，不要删**） |
| POST `/api/reminders/poll` | 前端每 30s 轮询到期提醒并弹窗 |
| GET/PUT `/api/settings` | 设置读写（key 打码规矩见上） |
| GET `/api/sync/export`、POST `/api/sync/import` | 同步包导出/导入（单向覆盖；导出版本+1清dirty，导入整体替换数据并记版本） |
| GET/POST/DELETE `/api/background`、`/api/icon[...]` | 背景图与图标上传/删除 |
| GET `/api/ai/status` | AI 就绪状态 + 模型列表 |
| POST `/api/ai/chat` | AI 助手对话（body: `{messages:[{role,content}]}`），内部走工具调用循环直接改数据 |
| POST `/api/ai/analyze` | AI 分析（body: `{scope: "week"|"month"|"longterm"}`），点按钮才调用 |
| POST `/api/ai/analyze/chat` | 分析页追问（body: `{question, history, scope}`），复用 10 分钟内的聚合缓存 |

安全：所有写请求有 CSRF 校验（Origin 同源检查）；服务默认只监听 127.0.0.1（`SCHEDULE_BUDDY_LAN=1` 才开局域网，无鉴权）。

## 6. AI 模块（ai.py）工作方式

- **调用方式**：标准库 `urllib` 直连 `https://open.bigmodel.cn/api/paas/v4/chat/completions`，不引入 openai SDK/requests（runtime 体积考虑）
- **模型**（`ai.MODELS`）：`glm-4.7-flash`（默认，免费，高峰期常 429）、`glm-4.5-flash`（备用免费，日期推算偶尔不准）、`glm-5.3-flash`（计费、最稳最强）
- **助手 = function calling 循环**（最多 16 轮，弱模型一轮常常只发一个调用）：12 个工具——日程 5 个（list/add/update/mark_done/delete）+ 长期任务 7 个（list/add_longterm/update_longterm/delete_longterm/add_milestone/update_milestone/delete_milestone），直接操作 storage 层；每次对用户的改动记录进 `actions` 返回给前端展示"✓ ..."回执
  - 目标类工具支持**按标题匹配**（`longterm_title`，精确优先、唯一包含兜底），子任务删除/修改支持**按文字匹配**（`milestone_text`，同名全删）——弱模型传对两个 uuid 不可靠，实测标题/文字匹配容错得多
  - **防"查询死循环"**：弱模型会连续多轮只调 list_* 从不动手；连续 2 轮查询且无任何改动时，在工具返回内容开头附加"直接执行"的系统提醒
  - **防幻觉护栏**：回复声称"已添加/已记录..."但 `actions` 为空时，注入系统提醒打回重做（弱模型实测会只说不做）
- **助手系统提示词注入精简日程概况**（`_assistant_overview`：30 天统计、逾期数、未来 7 天、长期任务进度带 id），使它能回答"哪个最急/我有什么安排"这类分析型问题
- **429 限流**：`_call` 自动等 5s 重试最多 2 次
- **省 token 约定**：对话历史只带最近 20 条；分析数据本地聚合好后只发最精简 JSON；`heatmap`（91 天画图数据）**只给前端、从不进模型提示词**；追问复用 10 分钟内同 scope 的聚合缓存
- **三种分析 scope**：week（本周执行 + 上周对比）/ month（近 30 天趋势 + 4 周分桶）/ longterm（目标进度 + 逾期风险），每个 scope 的系统提示词侧重不同（`_SCOPE_FOCUS`），前端图表也随 scope 切换

## 7. UI 约定与设计决策（含历史决策，不要"好心"推翻）

- **i18n**：所有界面文本走 `static/main.js` 里的 `I18N.zh / I18N.en` 双词典 + HTML 的 `data-i18n` / `data-i18n-ph` 属性。**新增界面元素必须两个词典都加**，漏了会显示键名（踩过两次）
- **分类体系已移除**（2026-09 用户决策）：用户认为手动打"工作/生活/学习"标签无意义，将来由大模型自动分类。后端 category 字段保留（新日程默认"其他"），界面上不出现任何分类选择/筛选/标签
- **优先级保留**：卡片左侧竖条 + 标题前彩色圆点（高=红、中=黄、低=绿），不要用回 🔴🟡🟢 emoji
- **操作按钮 = 悬停浮现**：日程卡片、长期任务卡片的编辑/删除按钮平时 opacity:0 不占布局宽（绝对定位 + 渐变淡入遮罩），悬停/键盘聚焦才浮现；**必须保留 `@media (hover: none)` 常显降级**——用户计划做手机版并互通，前端要保持触屏可用
- **子任务行布局**：勾选框对齐第一行文字（align-items: flex-start，不要垂直居中）；文字下方固定预留一行"日期行"（min-height 保证悬停时行高不跳）；悬停操作图标（改日期/改名/删除）出现在日期行里，**不许覆盖子任务文字**
- **添加子任务**平时收起为一个淡按钮，点击展开，Esc/失焦自动收起
- **90 天热力图**：91 天 = 13 整列 × 7 行，**不做星期补位**（没有星期标签，对齐无意义，补位会产生首尾残缺块——踩过）；有日程但未完成 = l1，完成越多越深
- **拖拽排序**：按指针坐标在整个网格上计算插入位置（不要用" hovered 目标卡片前后插入"的旧写法，那样拖不到最末尾）
- 顶栏毛玻璃、卡片悬停上浮、进度条渐变是既有质感约定，配色 token 在 style.css `:root`

## 8. 环境怪癖与已知的坑（这台机器/这个项目实测过）

1. **这台机器的 VBScript FSO 无法识别中文路径**（FileExists/FolderExists 对真实存在的中文名目录返回 False；`GetParentFolderName` 纯字符串操作不受影响）。vbs 里**禁止用 FSO 做存在性判断**，用 `On Error` 尝试执行 + 失败回退（见 start_schedule_buddy.vbs）。PowerShell Test-Path、cmd 的 bat 内 `if exist`、Python 都正常
2. **便携 Python 的 `runtime/python312._pth` 必须包含 `..`**（即程序目录）——embed 模式不会自动把脚本目录加进 sys.path，漏了会 `import media` 失败。当前内容：`python312.zip / . / .. / Lib/site-packages / import site`
3. **依赖曾被莫名卸载**（werkzeug 消失导致双击闪退）。遇到 ModuleNotFoundError 先跑 `start_schedule_buddy_console.bat` 看报错。runtime 是 `pip install --target runtime/Lib/site-packages` 装的，重装用同命令
4. **GLM 模型差异**（实测 2026-09）：glm-4-flash 工具调用不可靠（已移除）；glm-4.5-flash 日期推算偶尔不准（作备用）；glm-4.7-flash 免费档高峰限流 429（已自动重试）；glm-5.3-flash 最稳最强但计费。带 `tool_calls` 的 assistant 消息 `content` 为空字符串时 glm-4.7-flash 报 400，必须省略 content 字段
5. **Git Bash 里用 curl 传中文 JSON 会编码损坏**（表现为服务端 400"参数非法"），测试时用 Python 脚本发请求
6. media.py 有大段注释解释为什么不能用 ctypes LoadImageW 改窗口图标（64 位句柄截断会覆盖 .NET 设置好的图标）——不要"优化"掉
7. 子任务改名输入框在 draggable 元素里会无法选字，改名时要临时把 `msEl.draggable = false`

## 9. 改完代码怎么验证（每次都要做）

1. 语法/导入检查：`./runtime/python.exe -c "import ai"`（或对应模块）
2. 重启进程（改了 index.html 必须重启）+ `curl http://127.0.0.1:5217/` 确认 200
3. API 层测试用 Python（别用 curl 传中文），涉及数据修改的测试**结束后必须清理测试数据**（或先备份 data/）
4. UI 验证用浏览器实际点一遍（截图确认），并检查 JS 报错（`window.addEventListener("error")` 收集）
5. AI 功能测试会花真实 token/费用：用免费模型测，测试创建的日程/任务测完删除

## 10. 路线图与"不要做"清单

- **已批准的下一步**：agent 系统化——AI 助手升级为能主动规划/整理的 agent；后台预聚合数据结构喂给模型省 token（现有 /api/stats、/api/reports/* 就是为此保留的）
- **用户计划**：做手机版并与电脑数据互通（因此前端所有交互必须保持触屏降级）
- **被否决的**：语音输入（明确不要）；界面上的分类/打标签（明确移除）；统计视图常驻界面（已移除，等 agent 整合）
- **开源发布形态**：直接 zip 整个文件夹（含 runtime/ 即可免装 Python）；git 托管时 runtime/ 不入库（.gitignore 已排除）
- 数据安全红线：ai_api_key 保密规矩（§4）；所有写操作原子落盘的现有模式不要破坏
