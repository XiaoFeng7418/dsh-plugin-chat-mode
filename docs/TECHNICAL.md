简体中文 | [English](TECHNICAL_en.md)

# 技术说明

面向想了解实现细节、排查差异或自行验证的读者。日常使用看 [README](../README.md) 即可。

## 工作原理

- **模式就是 preset 行**：`cordis.patch.yml` 插入 `preset-chat` 行（`@deepseek-ai/dsh-agent-preset`，`config.id: chat`），它的 `plugins` 就是该模式的全部子插件——不列任何 `tool-*` 行，所以预设本身不声明工具。
- **系统提示整体替换**：`chat-mode` 行注册一个 `complete: true` 的 system-prompt section，`assemble()` 之后它成为唯一的 section，Harness 身份、工程规范、persona 段落全部被丢弃。`text` 是个函数，按 `context.agent` 读取会话状态，所以同一个 section 能给不同会话不同语气。`empty` 档的文本为空，序列化时 `system` 字段直接消失。
- **环境快照**：调用 `suppressRuntimeContext()`，OS / Git / cwd / 文件树上下文不再进入提示词。其他插件以 **user 消息**方式注入的内容（工作目录 reminder、记忆插件提示块）不受影响，仍会出现在上下文里。
- **零工具是两层保证**：预设不声明工具只解决「本模式自己的工具」；部署级插件（agent-teams、MCP、记忆、检索等）注册的**全局**工具必须由插件在 preset scope 上 `tools.restrict({ deny })` 掩蔽，并在每个 agent 的首步再掩蔽一次，防止插件延迟注册。掩蔽名单会排除本模式自己的 `web_search` / `web_fetch`。
- **温度**：`agent/request` waterfall 里给调用配置补 `temperature`。仅非思考请求发送；思考开启时即使配置里 pin 了温度也会被剔除。该钩子在上游已标记 deprecated（每次请求的控制项「没有替代 API」），未来若被移除，这个选项会静默失效但不会中断聊天。
- **压缩**：preset 内挂标准 `compaction-basic` 后端，只在上下文压力下触发，普通轮次不往系统提示里加内容。
- **不改默认预设**：新增 Loader / preset id（`preset-chat` / `chat`），不覆写 `standard` / `ptc` / `minimal` 等既有行——Cordis patch 对同名 id 是整块替换，所以这里坚持用新 id。
- **安装不动 `node_modules`**：`dsh plugin add` 把包写进 profile 依赖与 `dsh.profile.bundles`，bundle 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，Loader 启动时插入 `preset-chat` 行。

## 请求体形态

同一条消息、会话历史为空时的近似对比：

| 字段 | 标准模式 | Chat 模式（`web-tone`） |
| --- | --- | --- |
| `system` | 上万字符工作流规则 + 环境快照 | 61 字语气提示（英文 253 字符） |
| `tools` | 约 20–103 个 schema（视安装插件而定） | 不存在（`empty` 与 `web-tone` 都一样） |
| `thinking` | 默认 `enabled`、effort `high` | 默认 `disabled` |
| `temperature` | 不发送（服务端默认） | `1` |
| `max_tokens` | Harness 配置的上限 | 同一上限（本插件不修改） |

`promptMode: "empty"` 时 `system` 字段不存在。

### 引擎版本差异（`rc.1` vs `rc.5`）

| 现象 | `rc.5`（桌面） | `rc.1`（DSH Go 固定版本） |
| --- | --- | --- |
| 无工具时的请求体 | 仍有空 `"tools": []`（约 15 字节、不含 schema，`dsh-llm` 层产生，插件无法移除） | 同上 |
| 全局工具掩蔽 | 生效 | 生效 |
| `agent-teams` 的 9 个工具 | 全局注册，可被 `tools.restrict` 移除 | 注册在**每个 agent 自己的 scope**，`tools.restrict` 按设计只作用于全局，无法移除 |
| `agent/inbox/claimed` | 正常派发 | **不派发**；v0.2.0 的会话覆盖与默认非思考改走 `pre-step` / `request`，因此不依赖它 |
| 短会话输入 | 约 1.9K tokens | 约 3.9K tokens（残留 scoped 工具与其他插件注入的上下文） |

## 思考档位映射

DeepSeek Messages 协议只有两种思考状态，插件按档位映射（`@deepseek-ai/dsh-llm-deepseek/src/serialize.ts`）：

```ts
effort = options.reasoningEffort
      ?? connection.defaults.reasoningEffort
      ?? (connection.defaults.thinking === 'disabled' ? 'off' : 'high')
```

| 档位 | 请求体字段 |
| --- | --- |
| `off` | `thinking: { type: "disabled" }`，不出现 `output_config` |
| `low` / `high` / `max` | `thinking: { type: "enabled" }` + `output_config: { effort: "low" \| "high" \| "max" }` |

未记录档位时适配器默认 `high`，也就是 DeepSeek 网页端「深度思考」那一档。`temperature` 只在 `off` 档发送：思考开启时同时传温度会被判为冲突，插件会主动去掉。`/think` 通过 `agent.model.select()` 写入会话记录，切换后立即影响下一轮。

## 配置

`~/.dsh/chat-mode.json`（`$DSH_HOME/chat-mode.json`）覆盖 `cordis.patch.yml` 里的行配置。优先级：内置默认值 → 行配置 → 用户文件。文件缺失就是纯默认；JSON 写坏或字段非法只报警告，不会让模式失效。

| 选项 | 取值 | 默认 | 作用 |
| --- | --- | --- | --- |
| `promptMode` | `web-tone`、`empty`、`concise`、`creative`、`custom` | `web-tone` | 系统提示风格 |
| `customPrompt` | 字符串 | `""` | `promptMode: custom` 时使用 |
| `temperature` | `0`–`1.5` 的数字或 `null` | `1` | 只在非思考请求发送；`null` 永不发送 |
| `creativeTemperature` | `0`–`1.5` | `1.28` | `creative` 风格且温度仍是 `auto` 时使用 |
| `webSearch` | `true` / `false` | `false` | 新会话默认是否放行联网工具 |
| `webSearchProvider` | `deepseek-official` / `inherit` | `deepseek-official` | Chat 预设内隔离的搜索通道；`inherit` 使用宿主全局 `web` 设置 |
| `savingsBaseline` | 整数 | `35967` | `/chat savings` 对照的 Standard 输入 token 基线 |
| `defaultThinking` | `off` / `follow-ui` | `off` | 对「尚未记录思考档位」的会话首轮关闭思考 |
| `traceFile` | 路径或 `null` | `null` | 可选诊断输出，见下 |

### `traceFile` 诊断

```json
{ "traceFile": "~/.dsh/chat-mode-trace.jsonl" }
```

每行一个 JSON：挂载（`via: apply`）、全局工具掩蔽（`via: maskGlobalTools`）、首轮思考决策（`via: agent/inbox/claimed`，`rc.1` 上没有该行）、每次模型调用解析结果（`via: agent/request`，含 provider / model / effort / temperature / maxTokens）。**不记录**消息正文或系统提示原文。

请求本身可由会话日志核对：`request/header`（模型、工具、控制项）与 `system/message`（系统提示）就是序列化输入，两者加一行 trace 即可证明请求形态。

### 关于默认值

- `defaultThinking: off` 只作用于还没有记录思考档位的会话首轮，且只在 DeepSeek 路由上；恢复/继续的会话保留原有记录，你之后在界面里的选择优先。
- 插件每次请求都会读取当前档位，所以在界面里打开思考后，它立刻停止注入 `temperature`。
- 会话内切换只保存在内存；DSH 重启回到配置文件默认值，`/chat save` 才会持久化。

## 客户端半（v0.3.0 的输入框按钮）

浏览器侧不能直接 `import` 插件源码：宿主把 `dsh.client` 声明的包拼成 **classic script**（`document.createElement('script')`，不是 `type="module"`），脚本必须自己调用 `window.__ModuleLoader__.load({ id, factory })` 注册一个工厂；工厂第一次被 materialize 时执行，`require('react')` 由浏览器的模块表提供，所以无需打包也能写。

实现要点：

- `client.js` 全文是 classic script，没有顶层 `import` / `export`（有的话整段语法错误、槽位永远为空）。
- 客户端半只认 **Loader 里的真实行**；preset 子行不在其中，所以 `cordis.patch.yml` 额外加了一条根级的 `chat-mode-client` 行（`config.clientOnly: true`），宿主半见到这个标记会立刻返回，避免与 preset 行重复注册。
- 挂载点：`ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name, id, order, inject(sessionId) { … } }, Component))`；`inject` 是拿会话级数据的入口。
- 「深度思考」读 `modelDirectories.directoryFor(sessionId).store`（与顶部模型胶囊同一 store，天然双向同步），点击走 `directory.select({ …, reasoningEffort })`。
- 「联网」走 `ctx.remote.commands.execute(sessionId, '/web on' | '/web off', [])`，等价于本地命令、不产生模型请求；同时用 `localStorage` 记住开关意图，因为宿主没有把「本会话是否放行联网」投影给客户端。
- 用 `sessions.binding(id).session.projections.faceOf('agentPreset')` 判断当前 preset，仅 `chat` 时渲染；其它模式返回 `null`，不污染工作模式。

已知差异：如果同一个会话在另一个客户端里执行了 `/web on|off`，本按钮要到下一次 `command/executed` 或重开页面才同步；`thinking` 则始终与模型 store 同步。

## 为什么预设子插件在 UI 里只读

DSH 的 settings 表单只覆盖「active、可唯一寻址的 profile entry」的 volatile 字段；preset 子行属于预设定义的一部分，插件清单里显示为「由 agent preset 提供」，不提供编辑表单——这是为了避免一个模式的行为被本地改动悄悄覆盖。因此调参走用户覆盖文件，而不是在界面上改 preset 行。

## 已知限制

- 其他插件注入的 **user 消息**（工作目录 reminder、记忆插件提示块等）不属于本插件的系统提示范围，仍会进入上下文；只装本插件时不会出现。
- 思考默认关闭是插件策略，不是 DSH 的限制；想默认跟随适配器就设 `defaultThinking: follow-ui`。
- `empty` 档首条消息仍会触发一次会话标题生成小请求（DSH 自带行为，约 64 token 上限），与模式无关。
- 需要支持 preset roster 的 DSH 构建：桌面端（Web 界面）可用；`dsh headless` 不组合 preset，无法使用。
- `rc.1` 上残留的 9 个工具（`list_agents`、`send_message`、`wait_agent`、`team_task_*` 等）无法由插件移除，实用做法是临时停用 `agent-teams`。

## 开发

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit + checkJs
pnpm test            # node:test
```

改完重新挂载即可生效：`dsh plugin --profile <name> add /绝对路径/dsh-plugin-chat-mode`。桌面端同一路径重装会提示重启；换一个新目录安装可以让运行中的应用重新加载。
