简体中文 | [English](README_en.md)

# dsh-plugin-chat-mode

[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF.svg)](https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/XiaoFeng7418/dsh-plugin-chat-mode)](https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）添加一个**极简、零工具、超省 Token** 的 `Chat` 模式。
保留同一个 Harness、同一套会话和界面，只去掉日常聊天用不到的东西，让语气和用量都接近 DeepSeek 网页版。

## 为什么值得用

默认模式是为「干活」设计的。即使你只是问一句「帮我润色下这句话」，每次请求也要带上：

- 上百个工具的 schema（`bash`、`read`、`write`、`edit`、`glob`、`grep`、`subagent`、MCP 工具……）；
- 一万四千多字符的系统提示词，包含文件操作纪律、Agent 工作流、Git/OS/目录树快照；
- 编码模式偏好的 `temperature: 0`，聊起天来干巴巴。

这些内容对聊天毫无用处，却每一轮都在计费，也让模型下意识用「打工人」口吻回答。

Chat 模式把这几项全部去掉，并提供一个独立的 preset（`chat`），**不覆盖** Standard、PTC、Minimal、Creator。

### 实测对比（新建会话，只发一句「用一句话打个招呼」）

**Standard 模式（36K tokens / ¥0.0361）**

![Standard 模式，用量 36K tokens](assets/standard-36k.png)

**Chat 轻量模式（1.9K tokens / ¥0.0021）**

![Chat 模式，用量 1.9K tokens](assets/chat-mode-1.9k.png)

| 指标 | Standard 模式 | Chat（`web-tone`） | Chat（`empty`） |
| --- | --- | --- | --- |
| `tools` 字段 | 103 个 schema | **不存在** | **不存在** |
| `system` | 14,476 字符 | 61 字符（英文提示 253 字符） | **为空（字段不出现）** |
| 思考模式 | 开启，effort `high` | 默认关闭 | 默认关闭 |
| `temperature` | 不发送 | **1.0** | **1.0** |
| 输入 Token | 35,967 | **1,880** | **1,842** |

约 **19 倍**的输入 Token 降幅，且请求里没有任何工具 schema（`rc.5` 会留一个约 15 字节的空 `"tools": []`，见下方说明）。上面两张图就是同一条问候在两个模式下的实际用量（36K vs 1.9K）。

> 数据来自一台装了较多插件的桌面端（其余插件仍会注册全局工具，这是被屏蔽前的数量），不同安装环境的绝对值会有差异；比例和「没有 tools 字段」的结论不依赖具体插件数量。

## 功能

- **零工具**：预设不声明任何 `tool-*` 行；插件还会在预设作用域上屏蔽其他插件注册的全局工具（`tools.restrict`），并在每个 agent 的首步再屏蔽一次（防止插件稍后注册工具）。请求体里完全没有 `tools` 字段。
- **无工作流提示词**：用一个 `complete` 系统提示段整体替换系统提示组装结果，Harness 身份和全部工程规范段落一并消失。
- **不注入环境**：屏蔽运行时上下文，不再附加 OS、Git、cwd、文件树快照。
- **接近网页端的语气**：默认 `web-tone` 是原创中文短提示词（61 字，约 50 tokens），自然真诚、有主见、不讨好；用户换语言提问时自动跟随该语言。`empty` 档彻底不要系统提示词。
- **本地斜杠命令**：`/tone`、`/temp`、`/think`、`/web`、`/chat savings`、`/chat save` 全部在本地执行，0 token、不经过模型，也不影响其他会话。`concise` 先给结论、能一句不说三句；`creative` 多联想、并配 1.25–1.3 的更高温度。`/web on` 是唯一会额外发送 `web_search`、`web_fetch` 两个 schema 的方式，其余工具始终锁死。`/chat savings` 用本会话已产生的 usage 估算相对 Standard 省下的输入 token。
- **对话向采样参数**：非思考请求默认 `temperature: 1`（可配 0–1.5）。
- **保留思考模式**：照常在界面里选档位；思考开启时插件不再发送 `temperature`。
- **长对话仍可压缩**：内置标准压缩后端，只在上下文接近上限时触发；普通轮次不会往系统提示里加东西。
- **不改动任何默认预设**：新增 Loader/Preset id（`preset-chat` / `chat`），标准（Standard）、PTC、极简（Minimal）、创造（Creative）以及你已安装的其他自定义模式都不受影响。

### 斜杠命令

在聊天框里输入即可，全部在本地处理，不产生任何 token 消耗，也不会新建请求：

| 命令 | 作用 |
| --- | --- |
| `/chat` | 查看当前会话的风格、温度、联网开关与累计用量 |
| `/chat help` | 列出全部命令 |
| `/tone web\|empty\|concise\|creative` | 切换本会话风格：`web` 自然口语、`empty` 无系统提示、`concise` 极简直答、`creative` 脑暴润色 |
| `/tone custom <文案>` | 使用自定义短提示词（仅本会话） |
| `/temp auto\|off\|0-1.5` | `auto` 跟随风格默认值（creative 为 1.28）、`off` 不发送 temperature、数字则锁定该值 |
| `/think on\|off\|low\|high\|max` | 深度思考开关：`on` = `high`（与 DeepSeek 网页端深度思考同一档），`off` 完全关闭；`low`/`max` 细调强度；切换后思考开启时不发送 temperature |
| `/think auto` | 清掉本会话的思考 pin，回到适配器默认（未记录时即 `high`） |
| `/web on\|off` | 是否放行 `web_search` / `web_fetch`；默认 off，请求体里没有 `tools` 字段 |
| `/chat savings` | 按本会话累计 usage 对照 Standard 基线（35,967 input tokens）估算省下的输入 token |
| `/chat save` | 把当前会话的风格、温度、联网开关写入 `~/.dsh/chat-mode.json`，之后所有新会话沿用 |

切换只影响当前会话；DSH Go 的网页界面同样识别这些命令。会话内的切换保存在内存里，DSH 重启后会回到配置文件的默认值；想长期保留就执行 `/chat save`。

### 思考档位怎么发出去

DeepSeek 的 Messages 协议里只有两种思考状态，插件按档位映射：

| 档位 | 请求体字段 |
| --- | --- |
| `off` | `thinking: { type: "disabled" }`，不出现 `output_config` |
| `low` / `high` / `max` | `thinking: { type: "enabled" }` + `output_config: { effort: "low" \| "high" \| "max" }` |

适配器在「没有记录档位」时默认 `high`，这正是 DeepSeek 网页端「深度思考」的档位，所以 `/think on` 就等价于网页端那个开关。`temperature` 只在 `off` 档随请求发送——思考开启时同时传温度会被引擎判为冲突，插件会主动去掉。
`/web on` 后请求会多带 `web_search`、`web_fetch` 两个工具 schema，实测请求体从 16,230 字节增至 18,050 字节，约 **+455 input tokens**。Chat 模式自带一个隔离的 `web` 运行时并固定为 `deepseek-official`（模型调用触发的搜索只计 token，不走按次的 Search API），因此**不需要也不应该**去改全局设置：Standard 与其他模式沿用你自己的搜索配置。

## 安装

### 桌面端

**插件 → 添加插件**，填入下面任一规格（桌面端插件页由应用管理，CLI 会拒绝 `--profile desktop`，这是设计行为）。

### CLI / 其他 DSH 客户端

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode
```

固定到某个提交：

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode#v0.1.3
```

从 Release 的 `.tgz` 安装（不经过 GitHub 源码构建）：

```sh
dsh plugin --profile <profile> add https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/releases/download/v0.1.3/dsh-plugin-chat-mode-0.1.3.tgz
```

本地开发调试（目录直接链接进 profile，改完重新挂载即可）：

```sh
dsh plugin --profile <profile> add /绝对路径/dsh-plugin-chat-mode
```

安装后打开新会话，在模式切换器里选 **Chat（轻量对话）**。

> 说明：`rc.5` 引擎在「没有任何工具」时仍会在请求体里输出空的 `"tools": []`（约 15 字节、不含任何 schema）——这是引擎 `dsh-llm` 层的行为，插件无法移除；它不占用可观的 token，也不影响「零工具」的实际效果。

## 配置

`cordis.patch.yml` 里的预设子行是**只读**的（DSH 的设计：预设提供的配置不允许在 Web 设置页修改，避免一个模式的行为被本地改动悄悄覆盖）。日常调参请写用户覆盖文件：

`~/.dsh/chat-mode.json`（Windows 通常是 `C:\Users\<你>\.dsh\chat-mode.json`）：

```json
{
  "promptMode": "web-tone",
  "temperature": 1.0,
  "defaultThinking": "off"
}
```

优先级从低到高：内置默认值 → `cordis.patch.yml` 里的行配置 → `~/.dsh/chat-mode.json`。文件不存在时就是纯默认，写错 JSON 只报警告、不会让模式失效。

| 选项 | 取值 | 默认 | 作用 |
| --- | --- | --- | --- |
| `promptMode` | `web-tone`、`empty`、`concise`、`creative`、`custom` | `web-tone` | `web-tone` 自然口语；`empty` 完全不发系统提示；`concise` 极简直答；`creative` 脑暴润色；`custom` 使用 `customPrompt`。 |
| `customPrompt` | 字符串 | `""` | `promptMode: custom` 时使用；留空同样等于「无系统提示」。 |
| `temperature` | `0`–`1.5` 的数字，或 `null` | `1` | 只在非思考请求里发送；`null` 表示永不发送。 |
| `creativeTemperature` | `0`–`1.5` 的数字 | `1.28` | `creative` 风格且温度仍是 `auto` 时使用。 |
| `webSearch` | `true`、`false` | `false` | 默认不放行联网工具；`true` 等价于新会话默认 `/web on`。 |
| `webSearchProvider` | `deepseek-official`、`inherit` | `deepseek-official` | Chat 预设内隔离的搜索通道；`inherit` 改为使用宿主全局 `web` 设置（适合自配第三方搜索源的人）。 |
| `savingsBaseline` | 整数 | `35967` | `/chat savings` 用来对照的 Standard 输入 token 基线。 |
| `defaultThinking` | `off`、`follow-ui` | `off` | 对「尚未记录思考档位」的会话首轮关闭思考；`follow-ui` 跟随适配器默认值（当前是开启）。 |
| `traceFile` | 路径或 `null` | `null` | 可选诊断：分别记录挂载、工具屏蔽、思考档位决策与每次模型调用解析出的配置。 |

### 关于默认值

- `defaultThinking: off` 只作用于还没有记录思考档位的会话首轮，且只在 DeepSeek 路由上（其他 provider 未必接受 `off`）。恢复的、继续的历史会话保留原有记录；你之后在界面里的选择同样优先。
- 插件每次请求都会读取当前思考档位，所以你在界面里打开思考后，它立刻停止注入 `temperature`。
- 当前 Harness API 没有一等公民的 `temperature` 设置，插件通过 `agent/request` waterfall 注入。该钩子在上游已标记 deprecated（每次请求的控制项「没有替代 API」）；若未来 DSH 移除它，这个选项会静默失效，但不会中断聊天。

## 请求体形态

同一条消息、会话历史为空时的近似对比：

| 字段 | 标准模式 | Chat 模式（`web-tone`） |
| --- | --- | --- |
| `system` | 上万字符工作流规则 + 环境快照 | 61 字语气提示（英文 253 字符） |
| `tools` | 约 20–70 个 schema（视安装的插件而定） | **不存在** |
| `thinking` | 默认 `enabled`、effort `high` | 默认 `disabled` |
| `temperature` | 不发送（用服务端默认） | `1` |
| `max_tokens` | Harness 配置的上限 | 同一上限（本插件不修改） |

`promptMode: "empty"` 时，`system` 字段同样不存在。

### 自己验证

把 `traceFile` 指向仓库外的路径：

```json
{ "traceFile": "~/.dsh/chat-mode-trace.jsonl" }
```

每条都是小型 JSON：挂载一条（`via: apply`）、全局工具屏蔽一条（`via: maskGlobalTools`）、首轮思考决策一条（`via: agent/inbox/claimed`）、每次模型调用解析结果一条（`via: agent/request`）。**不会**记录消息正文或系统提示原文。

请求本身可由会话日志核对：`request/header`（模型、工具、控制项）与 `system/message`（系统提示）就是序列化的输入，二者结合一行 trace 即可完整证明请求形态，无需落盘对话内容。

## 已知限制

- 其他插件注入的 **user 消息**（例如工作目录 reminder、记忆插件的提示块）不属于本插件的系统提示范围，仍会出现在上下文里；只装本插件时不会出现。
- 思考模式默认关闭是插件的策略，不是 DSH 的能力限制；想要默认开启就把 `defaultThinking` 改成 `follow-ui`。
- `empty` 档每次首条消息仍会触发一次会话标题生成小请求（DSH 自带行为，约 64 token 上限），与模式无关。

## 兼容性

- 需要支持 preset roster 的 DSH 构建：桌面端（Web 界面）可用；`dsh headless` 明确不组合 preset，无法使用。
- **安卓 DSH Go 已实机验证（1.1.0，内置引擎 0.2.2-rc.1——DSH Go 为保证稳定性固定在该版本）**：可从网页界面的「插件 → +」用 GitHub 地址 / Release `.tgz` 链接 / 本地目录安装，装好后在**网页界面**的模式选择器里选「Chat（轻量对话）」使用（详见下一节）。
- 本插件不修改 `node_modules`，也不写 profile 的 `package.json`：安装由 `dsh plugin add` 写进 profile 依赖与 `dsh.profile.bundles`，bundle 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，Loader 启动时插入 `preset-chat` 行。

### 在 DSH Go（安卓）上使用

1. 打开 DSH Go，进入侧栏的「插件 → +」，填入 `github:XiaoFeng7418/dsh-plugin-chat-mode`，或 `v0.1.3` Release 里 `dsh-plugin-chat-mode-0.1.3.tgz` 的下载链接，或已推送到手机上的本地目录路径，安装后点「立即启用」。
2. DSH Go 的**原生界面只有内置的「工作 / 伙伴小屋 / 酒馆」模式**，不显示 DSH preset。点侧栏里的「切换到网页界面」，在网页界面的新会话页打开模式选择器，选 **Chat（轻量对话）**。
3. 效果差异（如实说明）：
   - 桌面端（引擎 `rc.3` 及以上）实测：请求无 `tools` 字段、系统提示词 61 字符，输入约 **1.9K tokens**。
   - DSH Go 内置的 `rc.1` 引擎实测：系统提示词正常生效、请求路径一致，`v0.2.0` 的斜杠命令与会话覆盖也已改用 `rc.1` 存在的 `pre-step` / `request` 路径（不依赖 `agent/inbox/claimed`）。但**可能残留少量其他全局插件注入的上下文或工具**（例如其他插件注册的工具、运行环境提醒），实测输入约 **3.9K tokens**。只装本插件时可忽略这一差异。
4. 如果想让手机上也接近桌面端的零工具体验：
   - `rc.1` 上残留的 9 个工具（`list_agents`、`send_message`、`wait_agent`、`team_task_*` 等）由「智能体团队 / `agent-teams`」插件注册在**每个 agent 自己的 scope** 上，而 `tools.restrict` 按设计只能移除**全局**注册的工具，因此本插件无法把它们掩蔽掉（桌面端 `rc.3+` 上这些工具是全局注册，所以能正常移除）。
   - 实用做法：日常轻聊用不到多智能体协作时，在 DSH Go 的插件管理里**暂时停用 `agent-teams`**（以及其他你不需要、且会向上下文注入内容的全局插件），这 9 个工具的开销就随之消失，接近桌面端的极简体验。DSH Go 为保证稳定性固定在 `rc.1`，因此这个手动开关会长期有效。



## 开发

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit + checkJs
pnpm test            # node:test，21 条
```

修改后重新挂载即可生效：`dsh plugin --profile <name> add /绝对路径/dsh-plugin-chat-mode`。桌面端同一路径重装会提示重启；换一个新目录安装可以让运行中的应用重新加载。

## 致谢

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)：插件机制、preset、`tools.restrict`、`agent/request` 钩子都来自这里。
- [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)：参考了官方 Web 前端的纯对话请求构造与思考模式开关习惯。

## 许可证

[MIT](LICENSE)。
