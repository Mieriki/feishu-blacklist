# 飞书手动黑名单

在飞书网页版里按人屏蔽消息。悬停一条消息就能屏蔽它的作者，被屏蔽的人在任何群里都不再出现在你视野中，随时可以撤销。

## 功能

- **随时指定**：点扩展图标 → 「拾取要屏蔽的人」→ 在飞书里点任意一条消息，屏蔽它的作者
- **两种显示方式**：划线占位（只收起内容，留一行提示）或完全隐藏（整行消失）
- **跨群生效**：按用户 ID 屏蔽，同一个人在所有会话里都会被收起
- **随时撤销**：屏蔽后 5 秒内点 toast 上的「撤销」，或在弹窗列表里点「解除」
- **两处都能点**：中栏消息流，以及右侧打开帖子后的详情面板

## 安装

这个扩展没有上架商店，用开发者模式手动加载：

1. 打开 `chrome://extensions`（Edge 用 `edge://extensions`）
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选择本仓库根目录（含 `manifest.json` 的那一层）
4. 图标出现在工具栏即可

## 使用

1. 打开飞书网页版，进入任意会话
2. 点工具栏的扩展图标，点「拾取要屏蔽的人」，弹窗会自动关掉
3. 页面顶部出现提示条，此时点击任意一条消息、楼中楼回复或帖子内容，就会屏蔽它的作者
4. 想取消拾取：点提示条上的「取消」，或按 `Esc`

显示方式在弹窗里切换，切换后已屏蔽的内容会立即按新方式呈现。

## 支持的页面

| 域名 | 说明 |
|---|---|
| `*.feishu.cn` | 飞书中国版 |
| `*.larksuite.com` | Lark 国际版 |
| `*.larkoffice.com` | 飞书办公版 |

只在浏览器里生效，飞书桌面客户端用不了。

## 工作原理

### 两个脚本，各管一段

`chrome.storage` 在页面的主世界（MAIN world）里访问不到，而 React fiber 在扩展的隔离世界（ISOLATED world）里读不到。所以拆成两个脚本接力：

| 文件 | 运行环境 | 职责 |
|---|---|---|
| `src/content-main.js` | `world: "MAIN"`，与飞书同环境 | 读写 DOM、沿 React fiber 找作者 ID、渲染遮罩与占位 |
| `src/content-bridge.js` | 扩展隔离世界 | 独占 `chrome.storage`，把状态推给主世界 |

两者用 `window.postMessage` 通信，消息带 `__fblk: true` 和 `from: 'page' | 'bridge'` 作为标识。

### 消息类型

| 类型 | 方向 | 用途 |
|---|---|---|
| `ready` | 主世界 → 桥 | 脚本就绪，请求当前状态 |
| `state` | 桥 → 主世界 | 推送 `{blocked, mode}` 全量状态 |
| `block` | 主世界 → 桥 | 新增屏蔽 `{id, name, aliases}` |
| `unblock` | 主世界 → 桥 | 解除屏蔽 `{id}` |
| `setMode` | 主世界 → 桥 | 切换显示方式 |
| `pick` | 桥 → 主世界 | 进入拾取模式 |

`pickRequest` 是独立的一次性存储键：弹窗写入时间戳，桥监听到后转发 `pick` 并立刻删掉该键，避免刷新页面时突然又进入拾取状态。

### 存储结构

全部数据在 `chrome.storage.local`，只存本机：

```js
{
  blocked: {
    "7607314087160056777": {
      name: "Tanker",              // 界面显示名优先
      aliases: ["Y", "Tanker"],    // 用于名字兜底匹配
      ts: 1795675308287            // 屏蔽时间，用于列表排序
    }
  },
  mode: "placeholder"              // 或 "hide"
}
```

### 为什么依赖 React fiber

飞书不把用户 ID 写进 DOM 属性，只能顺着元素的 `__reactFiber$xxx` / `__reactInternalInstance$xxx` 往上找 `memoizedProps.messageItem.author.id`。这是内部结构，飞书升级可能改掉。

### 名字为什么存一串别名

同一个人在不同位置的显示名经常不一致。例如某个账号的 `localizedName` 是 `Y`，但群里显示 `Tanker`。所以屏蔽时会把 `localizedName`、`name`、`zhCnName`、`chatExtra.nickName` 和界面上的实际文字一起存进 `aliases`，取不到 ID 时还能按名字兜底。**能拿到 ID 时一律以 ID 为准**——同名不同人是常态，按名字匹配会误伤。

### 帖子详情为什么只能遮罩

右侧帖子面板是绝对定位的虚拟列表，行高由飞书自己算。直接把行 `display: none` 会留下空洞，而且不会重排。所以那里只做视觉遮盖：把内容区设成 `visibility: hidden`，再铺一层「已屏蔽 X 的回复 · 点击查看」。

## 注意事项

- **靠飞书内部结构吃饭**：选择器和 fiber 键名都是实测得来。飞书改版后可能需要更新 `src/content-main.js` 顶部的选择器常量（`ROW_SELECTOR` / `MSG_SELECTOR` / `PANEL_ROW_SELECTOR` 等），以及 `authorOfElement` / `authorOfPanelRow` 的探测逻辑。
- **数据不出本机**：只写 `chrome.storage.local`，没有网络请求，也不跟账号同步。换浏览器或清扩展数据就没了。
- **点自己的消息不会屏蔽**，会提示「这是你自己的消息」。
- 读不到作者 ID 的消息无法屏蔽，会提示换一条。

## 开发

无构建、无依赖、没有 `package.json`。改完源码后：

1. 到 `chrome://extensions` 点该扩展的「重新加载」（改了 content script 必须重载，只刷新页面不生效）
2. 刷新飞书页面

语法检查：

```bash
node --check src/content-main.js
node --check src/content-bridge.js
node --check src/popup.js
```

改 CSS 时记得把 `content-main.js` 里的 `STYLE_VERSION` 加一，否则页面里已注入的旧样式表不会被替换。

### 文件结构

```
manifest.json           扩展清单（MV3）
icons/                  16/48/128 图标
src/content-main.js     主世界脚本：DOM 操作、fiber 探测、遮罩渲染
src/content-bridge.js   隔离世界脚本：chrome.storage 读写
src/popup.html          弹窗结构
src/popup.css           弹窗样式
src/popup.js            弹窗逻辑：列表、模式切换、发起拾取
```

### 调试时的一个坑

内容脚本的同步靠 `requestAnimationFrame` 驱动。标签页在后台时 rAF 不触发，`syncAll` 会卡住不执行，看起来像「遮罩不渲染」。调试时把飞书标签页切到前台即可，不是代码问题。
