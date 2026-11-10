# 黑金设计规范（摘要）· 玄枢・AURUM 午夜黑金导播大厅

> 规范源文件：`web/src/styles/tokens.css`（token 定义）+ `web/src/styles/app.css`（组件实现）。
> **组件里禁止硬编码色值/圆角/字号**，一律引用 `var(--*)；新增语义色先进 tokens.css 再进组件。**

---

## 1. 色板 Token

### 1.1 近黑中性（背景与分隔）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg-page` | `#0A0C0F` | 画布底色（body） |
| `--bg-page-2` | `#0E1218` | 次级页面底、侧栏渐变落点 |
| `--bg-panel` | `#131821` | 面板 / 卡片底 |
| `--bg-panel-2` | `#1A202B` | 面板内嵌层（输入框、Pill、缩略图底） |
| `--border` | `rgba(255,255,255,.07)` | 常规描边、表格分割线 |
| `--border-strong` | `rgba(255,255,255,.14)` | 可交互控件描边（按钮/输入框/选中态） |

> 背景层级只有 4 档：page → page-2 → panel → panel-2。**不要再造第 5 种灰**，需要“更暗”一律用黑色遮罩叠加（`rgba(5,6,9,.62)`）。

### 1.2 品牌主色：鎏金（Gold）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--gold` | `#D4B87E` | 品牌主色、焦点环、主按钮渐变终点 |
| `--gold-light` | `#E8D6A8` | 高亮文字、选中态文字、云端通道文字 |
| `--gold-deep` | `#A9884F` | 渐变起点、品牌标记底 |
| `--gold-soft` | `rgba(212,184,126,.12)` | 选中背景、KPI 卡染底、文本选区 |

### 1.3 伙伴色：青玉（Jade）— 只给本地引擎与隐私开关

| Token | 值 | 用途 |
| --- | --- | --- |
| `--jade` | `#46A09B` | 本地通道标识、隐私/开关打开态 |
| `--jade-soft` | `rgba(70,160,155,.13)` | 本地通道背景、chips 选中底 |
| （文字提亮） | `#8FE0DB` / `#7FD3CE` | 青玉底上的文字（对比度不够时用它，不用 --jade） |

### 1.4 语义状态色

| Token | 值 | 语义 | 典型用法 |
| --- | --- | --- | --- |
| `--up` | `#46AF82` | 正常 / 成功 / 在线 | 节点在线、任务成功、`.pill.up` |
| `--warn` | `#D99E3E` | 预警 / 接近上限 | 280s 预警、`.pill.warn`、花字轨道 |
| `--down` | `#E15B50` | 异常 / 失败 / 掉线 | 300s 超限、任务失败、`.pill.down`、超限进度条 |
| （失败文字提亮） | `#F0A49D` | 红底上的正文 | `.danger-block` 文本 |

### 1.5 文字

| Token | 值 | 层级 | 用途 |
| --- | --- | --- | --- |
| `--text-1` | `#F4F0E7` | 一级（暖白） | 标题、数值、正文重点 |
| `--text-2` | `#9BA1AC` | 二级 | body 默认文字、次级说明 |
| `--text-3` | `#636A76` | 三级 | 标签、占位、单位、辅助信息 |

> 对比度红线：`--text-3` 只用于 ≤12px 的非关键信息；关键数值/操作文案不得低于 `--text-2`。

---

## 2. 字体

| Token | 字族栈 | 用途 |
| --- | --- | --- |
| `--font-ui` | `'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif` | 全部界面正文、表单、表格 |
| `--font-display` | `'Bebas Neue', 'Bahnschrift', 'Impact', 'Arial Narrow', sans-serif` | 时码、KPI 数值、品牌名（窄体高对比，营造导播台质感） |
| `--font-mono` | `'Cascadia Mono', 'Consolas', 'SF Mono', monospace` | 时间码、shot_code、时长、ID、日志、参数 |

**规则**

- 中文一律 UI 字族；display 字族**只用于数字与拉丁字母**（Bebas Neue 无中文字形，混排会掉字）。
- 时长统一 `123.4s`、时码统一 `00:02:03:14`、ID 统一 `#128`，均用 mono。
- 行高：正文 1.6，长文本编辑区 1.9，display 数值 0.95–1。

---

## 3. 字号阶梯

| 级 | 字号 / 行高 | 字族 | 用在哪（现有类名） |
| --- | --- | --- | --- |
| Display XL | 118px / 0.95 | display | 首页时码 `.hero-timecode` |
| Display L | 38px / 1 | display | KPI 数值 `.kpi-value` |
| H1 | 19px / 1 | display | 品牌名 `.brand-name`（letter-spacing 1.6px） |
| H2 | 18px | ui | 弹窗标题 `.modal-title` |
| H3 | 14px / 600 | ui | 空态标题 `.state-title` |
| Title | 13.5px / 600 | ui | 面板标题 `.panel-title` |
| Body | 13px / 1.6 | ui | body 默认 |
| Body-S | 12.5px | ui | 按钮、标签页、提示 |
| Small | 12px | ui | 表格正文、描述 `.state-desc` |
| Caption | 11.5px | ui | 面板副标题、hint、mono 数值 |
| Micro | 10.5px | ui + `letter-spacing:.12em` + 大写 | 表头、导航分组、标签 `.tag` |

> 阶梯只允许这 11 级。**不要出现 13.2px / 15px / 17px 这类中间值**；需要强调优先换字重（600/700）或换色，而不是加字号。

---

## 4. 间距：8pt 网格

`tokens.css` 定义 `--s1 … --s10`，取值 4 / 6 / 8 / 12 / 14 / 16 / 19 / 24 / 28 / 32。
**主节奏用 8 的倍数（8/16/24/32），4 与 6 只用于图标与文字之间的微调，14/19/28 是居中修正值。**

| 场景 | 取值 |
| --- | --- |
| 图标 ↔ 文字 | 6–8 |
| 控件内边距（按钮 32 高） | 横向 14，纵向 0 |
| 面板内边距 | 16–18（`.panel-body` = 16/18） |
| 卡片之间 | 16 |
| 区块之间（content 纵向） | 18 |
| 页面左右留白 | 28（`.content` / `.topbar`） |
| 表格行高 | 56（`--row-h`） |
| 侧栏宽 | 232 / 收起 60 |

圆角不是间距，但同属“尺寸语言”，见下节。

---

## 5. 圆角角色

| Token | 值 | 角色 | 组件 |
| --- | --- | --- | --- |
| `--r-control` | 6px | 可交互控件 | 按钮、输入框、下拉、导航项、时间轴 clip、缩略图 |
| `--r-card` | 10px | 内容卡片 | 面板、KPI、分镜卡、Toast、提示块 |
| `--r-shell` | 18px | 外壳容器 | 首屏 Hero、弹窗、抽屉 |
| `--r-pill` | 999px | 胶囊 | Pill、Chip、进度条、时刻标记、标签 |

> 圆角必须**按角色取**，不按视觉喜好取：控件永远 6，卡片永远 10，胶囊永远 999。
> 嵌套时外大内小（shell 18 → card 10 → control 6），不要同级混用。

---

## 6. 引擎双通道编码（最重要的产品语义）

两套渲染通道必须**在视觉上一眼可分**，颜色、图标、通道名三处同时编码，不允许只靠文字。

| 维度 | 云端通道 `muse_api` | 本地通道 `comfy_h3` |
| --- | --- | --- |
| 色系 | 鎏金 gold | 青玉 jade |
| 文字色 | `--gold-light` `#E8D6A8` | `#8FE0DB`（jade 提亮） |
| 背景 | `--gold-soft` | `--jade-soft` |
| 描边 | `rgba(212,184,126,.4)` | `rgba(70,160,155,.4)` |
| 图标 | `cloud`（云） | `monitor`（显示器） |
| 语义 | 快、付费、受额度/QPS 约束 | 私有、可控、受显存约束、隐私镜头专属 |
| CSS 落点 | `.engine.cloud`、`.track-clip.video.cloud`、`.pill.gold` | `.engine.local`、`.track-clip.video.local`、`.pill.jade` |
| 数据来源 | `ENGINE_META.muse_api = { icon:'cloud', tone:'gold', channel:'cloud' }` | `ENGINE_META.comfy_h3 = { icon:'monitor', tone:'jade', channel:'local' }` |

跨层一致性：合成时的“导播代理卡”也用同一套双通道色（`adapters/compose.ts`：云端 `#E8D6A8`、本地 `#7FD3CE`），
所以**切片、时间轴、成片占位卡三处的颜色必须同源**，避免用户以为换了引擎。

**隐私镜头铁律**：`privacy = true` 的镜头只允许本地通道。UI 上把引擎选择器置灰并给出 `PRIVACY_BLOCK` 的 `ui_hint`（"涉敏镜头必须本地生成"），不允许静默替换。

---

## 7. 四种界面状态

任何“会有数据的东西”（列表、表格、卡片区、时间轴、面板）都必须实现这四态，缺一不可。

| 状态 | 触发 | 视觉规格 | 类名 / 实现 |
| --- | --- | --- | --- |
| **① 有数据** | 请求成功且 `length > 0` | 正常渲染；行悬停 `rgba(255,255,255,.028)`；失败行左侧 2px `--down` 内阴影 | `.table tbody tr` / `.panel` / `.story-card` |
| **② 空** | 成功但 `length === 0` | 居中竖排：54×54 图标块（`--bg-panel-2` + 16px 圆角）→ 14px 标题（`--text-1`）→ 12px 说明（`--text-3`，max-width 420）→「主行动按钮」 | `.state-wrap` `.state-icon` `.state-title` `.state-desc`；文案必须给**下一步动作**（例：「还没有镜头 → 从台本解析生成」） |
| **③ 加载** | 请求进行中 | 骨架屏：底 `#151B24`，金扫光 `.skeleton::after` 渐变 `rgba(212,184,126,.12)`，1.2s 无限 sweep；骨架块尺寸=真实内容尺寸，**不许抖动** | `.skeleton` + `@keyframes sweep` |
| **④ 异常** | 请求失败 / 任务失败 | 面板内错误块：`--down` 描边 + `rgba(225,91,80,.08)` 底 + `#F0A49D` 文本；展示 `code` + `ui_hint` + 「重试」（仅 `retry !== 'none'` 时出现） | `.danger-block`（阻断）/ `.warn-block`（预警） |

**状态优先级**：异常 > 加载 > 空 > 有数据。刷新时保留旧数据 + 顶部 2px 金色进度条（**不要**整页闪骨架），只有首屏才用骨架屏。

**空态文案公式**：`还没有{对象}` + `{为什么需要它}` + `{一个按钮}`。
例：「还没有台本 · 上传 Markdown 台本后系统会自动拆出环节与镜头 · [上传台本]」。

---

## 8. 组件速查（照抄即可）

| 组件 | 关键规格 |
| --- | --- |
| 主按钮 `.btn.primary` | 高 32、圆角 6、渐变 `linear-gradient(120deg, --gold-deep, --gold)`、文字 `#17140D` 700、hover `filter:brightness(1.08)` |
| 次按钮 `.btn` | 底 `--bg-panel-2`、描边 `--border-strong`、hover 底 `#212936` |
| 危险按钮 `.btn.danger` | 透明底 + `rgba(225,91,80,.42)` 描边 + `--down` 文字 |
| 输入 `.input/.select` | 高 32、圆角 6、focus：`border-color:--gold` + `box-shadow:0 0 0 3px rgba(212,184,126,.14)` |
| 开关 `.toggle.on` | 轨道 34×18、圆角 999、开态 `--jade`（**本地/隐私开关用青玉，不用金**） |
| Pill `.pill` | 高 22、圆角 999、11px、带 6px 圆点；`.up/.warn/.down/.gold/.jade` 五态 |
| Chip `.chip` | 高 28、圆角 999；选中 `.on` 用 gold，`.jade.on` 用青玉 |
| 面板 `.panel` | `--bg-panel` + 1px `--border` + 圆角 10；头部 14/18 内边距 + 底部 1px 分割 |
| 表格 `.table` | 表头 10.5px 大写 + `.12em` 字距 + `rgba(255,255,255,.015)` 底；行高 56；数字列 mono |
| 分镜卡 `.story-card` | 圆角 10、封面 9:16、hover `--gold` 36% 描边 + `translateY(-1px)` |
| 时间轴 `.track-row` | 左标签 120、右泳道；泳道 60px 竖虚线网格；clip 高 34、圆角 6、按引擎双通道着色 |
| 进度条 `.hero-rail/.cap-rail` | 高 11、圆角 999、填充金渐变；超限换 `#8E2F27 → --down`；标记线 `--down` 2px |
| 弹窗 `.modal` | 圆角 18、宽 `min(760px,100%)`（wide 1100）、遮罩 `rgba(5,6,9,.62)` + 3px 模糊、`lift` 180ms |

---

## 9. 动效与层

| 项 | 值 |
| --- | --- |
| 过渡时长 | 160ms（hover/选中）、180–200ms（弹窗入场） |
| 缓动 | `ease-out`（进入）、`linear`（扫光） |
| 弹窗入场 | `@keyframes lift`：`translateY(8px) → 0` + 透明度 0→1 |
| 遮罩淡入 | `@keyframes fade` 160ms |
| z 轴 | content 10 < 颗粒层 60 < dropdown 1000 < mask 1900 < modal 2000 < toast 3000 |

> 动效只服务“状态变化可感知”：**不做装饰性弹跳**；列表增删用透明度过渡，不用位移抖动（会干扰读数）。

---

## 10. Do / Don't

- ✅ 用 token：`color: var(--text-1)`；❌ 用近色：`color:#f2efe6`。
- ✅ 金色只做**强调与主行动**（1 屏 ≤ 3 处高饱和金）；❌ 金色铺满卡片底。
- ✅ 青玉只表达**本地引擎/隐私**；❌ 拿青玉当通用成功色（成功用 `--up`）。
- ✅ 状态用「色 + 文案 + 图标」三重编码；❌ 只靠颜色变化（色弱不可读）。
- ✅ 时长/ID/参数用 mono 且右对齐；❌ 正文字族里混排数字造成跳动。
- ✅ 超限（>300s）必须同屏可见：红条 + 超出秒数 + 拆分建议；❌ 只弹一次 toast 就当提示过了。
- ✅ 空态给下一步按钮；❌ 只写「暂无数据」。
