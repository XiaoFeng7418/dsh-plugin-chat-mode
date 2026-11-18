简体中文 | [English](README_en.md)

# dsh-plugin-chat-mode

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

约 **19 倍**的输入 Token 降幅，且请求里不会出现 `"tools": []` 这种空数组——是整个字段省略。上面两张图就是同一条问候在两个模式下的实际用量（36K vs 1.9K）。

> 数据来自一台装了较多插件的桌面端（其余插件仍会注册全局工具，这是被屏蔽前的数量），不同安装环境的绝对值会有差异；比例和「没有 tools 字段」的结论不依赖具体插件数量。

## 功能

- **零工具**：预设不声明任何 `tool-*` 行；插件还会在预设作用域上屏蔽其他插件注册的全局工具（`tools.restrict`），并在每个 agent 的首步再屏蔽一次（防止插件稍后注册工具）。请求体里完全没有 `tools` 字段。
- **无工作流提示词**：用一个 `complete` 系统提示段整体替换系统提示组装结果，Harness 身份和全部工程规范段落一并消失。
- **不注入环境**：屏蔽运行时上下文，不再附加 OS、Git、cwd、文件树快照。
- **接近网页端的语气**：默认 `web-tone` 是原创中文短提示词（61 字，约 50 tokens），自然真诚、有主见、不讨好；用户换语言提问时自动跟随该语言。`empty` 档彻底不要系统提示词。
- **对话向采样参数**：非思考请求默认 `temperature: 1`（可配 0–1.5）。
- **保留思考模式**：照常在界面里选档位；思考开启时插件不再发送 `temperature`。
- **长对话仍可压缩**：内置标准压缩后端，只在上下文接近上限时触发；普通轮次不会往系统提示里加东西。
- **不改动任何默认预设**：新增 Loader/Preset id（`preset-chat` / `chat`），标准、PTC、极简、Creator、学习、答疑等模式都不受影响。

## 安装

### 桌面端

**插件 → 添加插件**，填入下面任一规格（桌面端插件页由应用管理，CLI 会拒绝 `--profile desktop`，这是设计行为）。

### CLI / 其他 DSH 客户端

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode
```

固定到某个提交：

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode#v0.1.2
```

从 Release 的 `.tgz` 安装（不经过 GitHub 源码构建）：

```sh
dsh plugin --profile <profile> add https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/releases/download/v0.1.2/dsh-plugin-chat-mode-0.1.2.tgz
```

本地开发调试（目录直接链接进 profile，改完重新挂载即可）：

```sh
dsh plugin --profile <profile> add /绝对路径/dsh-plugin-chat-mode
```

安装后打开新会话，在模式切换器里选 **Chat（轻量对话）**。

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
| `promptMode` | `web-tone`、`empty`、`custom` | `web-tone` | `web-tone` 用内置中文语气提示；`empty` 完全不发系统提示；`custom` 使用 `customPrompt`。 |
| `customPrompt` | 字符串 | `""` | `promptMode: custom` 时使用；留空同样等于「无系统提示」。 |
| `temperature` | `0`–`1.5` 的数字，或 `null` | `1` | 只在非思考请求里发送；`null` 表示永不发送。 |
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
- DSH Go（`ccch1mneyyy/dsh-go`）运行的是同一套 DSH 引擎，理论上兼容基于同源 DSH 运行时的客户端（如 DSH Go），**待实机验证**。插件零原生依赖、纯标准 Node ESM，可直接 `adb push` 或从 GitHub 安装测试。
- 本插件不修改 `node_modules`，也不写 profile 的 `package.json`：安装由 `dsh plugin add` 写进 profile 依赖与 `dsh.profile.bundles`，bundle 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，Loader 启动时插入 `preset-chat` 行。

## 开发

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit + checkJs
pnpm test            # node:test，20 条
```

修改后重新挂载即可生效：`dsh plugin --profile <name> add /绝对路径/dsh-plugin-chat-mode`。桌面端同一路径重装会提示重启；换一个新目录安装可以让运行中的应用重新加载。

## 致谢

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)：插件机制、preset、`tools.restrict`、`agent/request` 钩子都来自这里。
- [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)：参考了官方 Web 前端的纯对话请求构造与思考模式开关习惯。

## 许可证

[MIT](LICENSE)。
