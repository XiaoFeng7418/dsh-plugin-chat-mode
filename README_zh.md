# dsh-plugin-chat-mode

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供的一个极简、**无工具**聊天预设。

它在模式切换器里新增一个 `chat` 模式：不带任何工具 schema、不带工程工作流提示词、不注入环境快照，只有一段很短的对话语气提示词和一个适合日常聊天的温度值。适合「像用 DeepSeek 网页版一样用 API」而不是「启动一个干活的 Agent」的场景。

## 为什么需要它

默认预设有大量工具定义、几千字节的系统提示词（包含文件编辑纪律、规划规则），以及操作系统、Git 状态、工作目录、文件树等运行时快照。这些对 Agent 工作是对的，对「帮我解释这段话」是浪费：

- 工具定义在提示词里占大头，即使一次都没调用；
- 工作流口吻让模型听起来像打工人（「当然可以！我很乐意为您解答」）；
- 一次不碰文件系统的聊天，仍然要为文件系统规则付费。

本插件保留同一套 Harness、会话模型和界面，只去掉对话不需要的部分。

## 功能

- **零工具**：预设不声明任何 `tool-*` 行；插件还会在该 agent 的 scope 上屏蔽其他插件注册的全局工具（`tools.restrict`），因此请求体里完全没有 `tools` 字段（不是空数组，是没有这个字段）。仅靠预设无法注销部署级插件贡献的工具，这一步是必要的。
- **无工作流提示词**：用一个 `complete` 系统提示段整体替换系统提示组装结果，包括 Harness 身份和全部工程规范段落。
- **不注入环境**：屏蔽运行时上下文，不再附加 OS、Git、cwd、文件树快照。
- **接近网页端的语气**：默认 `web-tone` 是一段原创的短提示词（80 tokens 以内），自然真诚、温和但有主见、不确定就直说，不用客服套话。`empty` 档彻底不要系统提示词。
- **对话向的采样参数**：非思考请求默认 `temperature: 1`（可配 0–1.5），而不是编码模式偏好的 `0`。
- **保留思考模式**：照常在界面里选择思考档位；只要思考开启，插件就不再发送 temperature。
- **长对话仍可压缩**：预设包含标准压缩后端，只在上下文接近上限时触发；普通轮次不会额外塞系统文本。
- **不改动任何默认预设**：插件插入的是新的 Loader/Preset id（`preset-chat` / `chat`），标准、PTC、极简、Creator 模式均不受影响。

## 安装

发布到 GitHub 后：

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode
```

固定到某个提交：

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode#<sha>
```

桌面端可在 **插件 → 添加插件** 中安装同一个 GitHub 规格。（`--profile desktop` 由桌面应用独占，CLI 会按设计拒绝该 profile，请改用应用内的插件页。）

本地开发，不需要发布：

```sh
dsh plugin --profile <profile> add /绝对路径/dsh-plugin-chat-mode
```

重启或启动 DSH，新建会话，在模式切换器里选择 **Chat（聊天）**。

环境要求：支持 Web/桌面模式列表的 DSH 版本（本插件面向 `0.2.x` 的 bundle 结构）。纯 ESM、零运行时依赖、无原生代码。

## 配置

默认值写在 [`cordis.patch.yml`](cordis.patch.yml) 的 `chat-mode` 行：

```yaml
- id: chat-mode
  name: dsh-plugin-chat-mode
  config:
    promptMode: web-tone
    temperature: 1
    defaultThinking: off
```

预设子行在 Web 插件清单里是**只读**的（DSH 会显示为「由 agent preset 提供」，不提供编辑表单）。不想改已安装的 profile patch 时，写一个用户覆盖文件即可：

`$DSH_HOME/chat-mode.json`（默认 `~/.dsh/chat-mode.json`）

```json
{
  "promptMode": "web-tone",
  "temperature": 1,
  "defaultThinking": "off"
}
```

该文件优先于行内配置；非法值会被警告并忽略，不会让预设加载失败。

| 选项 | 取值 | 默认 | 作用 |
| --- | --- | --- | --- |
| `promptMode` | `web-tone`、`empty`、`custom` | `web-tone` | `empty` 完全不发系统提示词；`custom` 使用 `customPrompt`。 |
| `customPrompt` | 字符串 | `""` | `promptMode: custom` 时使用；留空同样等于「无系统提示词」。 |
| `temperature` | `0`–`1.5` 的数字，或 `null` | `1` | 只在非思考请求里发送；`null` 表示永不发送。 |
| `defaultThinking` | `off`、`follow-ui` | `off` | `off` 让新建/清空后开始的会话关闭思考；`follow-ui` 跟随适配器默认值。 |
| `traceFile` | 路径或 `null` | `null` | 可选诊断：每次模型调用追加一行 JSON，记录最终解析出的 provider/model/思考档位/temperature/token 上限。 |

### 关于默认值

- `defaultThinking: off` 只在「新建会话」或「清空后重开」的会话上生效，且只在 DeepSeek 路由上（其他 provider 可能不接受 `off`）。它刻意不以「尚未记录思考档位」为判据：本 Harness 会在界面出现任何选择之前，就用适配器默认值（`high`）初始化新会话。恢复的历史会话与压缩后重建的会话保留原有记录，你之后在界面里的选择同样优先。
- 插件每次请求都会读取当前思考档位，因此你在界面里打开思考后，它会立刻停止注入 temperature。
- 当前 Harness API 没有一等公民的 temperature 设置，插件通过 `agent/request` waterfall 注入。该钩子在上游已标记 deprecated（每次请求的控制项「没有替代 API」）；若未来 DSH 移除它，这个选项会静默失效，但不会中断聊天。

## 请求体形态

同一条三个字的消息，在会话历史为空时的近似对比：

| 字段 | 标准模式 | Chat 模式（`web-tone`） |
| --- | --- | --- |
| `system` | 几 KB 工作流规则 + 环境快照 | 约 250 字符的语气引导 |
| `tools` | 约 20 个 schema | **不存在** |
| `thinking` | 默认 `enabled`、effort `high` | 默认 `disabled` |
| `temperature` | 不发送（用服务端默认） | `1` |
| `max_tokens` | Harness 配置的上限 | 同一上限（本插件不修改） |

`promptMode: "empty"` 时，`system` 字段同样不存在。

### 自行验证

把 `traceFile` 指向仓库外的路径：

```json
{ "traceFile": "~/.dsh/chat-mode-trace.jsonl" }
```

每次模型调用会追加一行最终解析出的调用配置：provider、model、思考档位、temperature、token 上限；新会话建立时还会记一条起始决策（`{"via":"agent/created","source":"startup","applied":true}`）。**不会**记录消息正文或系统提示原文。

请求本身可由会话日志核对：`request/header`（模型、工具、控制项）与 `system/message`（系统提示）就是序列化的输入，二者结合一行 trace 即可完整证明请求形态，而无需落盘任何对话内容。

## 兼容性

- DSH 桌面端 / `dsh web`：已在当前桌面 bundle 上验证。
- DSH Go 及其他基于同源 DSH 运行时的客户端：预设由 Harness 的 preset registry 提供，动态读取模式列表的客户端应当能像 Web 界面一样列出它。尚未在手机上实测，表述为「理论上兼容，待实机验证」。
- 无原生依赖、无构建步骤。

## 致谢

- [deepseek-ai/dsh](https://github.com/deepseek-ai/dsh)：本插件扩展的 Harness，也是这里使用的 preset/bundle 约定的来源。
- [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)：开源网页版前端；其请求习惯（只带 `thinking` 类型、不显式传 temperature）影响了本插件的参数默认值。

## 许可证

MIT，见 [LICENSE](LICENSE)。
