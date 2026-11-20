简体中文 | [English](README_en.md)

# dsh-plugin-chat-mode

[![CI](https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/XiaoFeng7418/dsh-plugin-chat-mode)](https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）加一个**零工具、超省 Token、语气像网页版**的 `Chat` 模式：同一个 Harness、同一套会话与界面，只去掉日常聊天用不到的东西。

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

约 **19 倍**输入 Token 降幅，请求里没有任何工具 schema。数据来自装了较多插件的桌面端，绝对值随环境变化，比例与「无 tools 字段」的结论不变。**不改动任何默认预设**：Standard、PTC、Minimal、Creative 以及你已安装的其他模式都不受影响。

## 安装

**桌面端**：打开 **插件 → 添加插件**，填入

```
github:XiaoFeng7418/dsh-plugin-chat-mode
```

**CLI / 其他 DSH 客户端**：

```sh
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode
```

安装后打开新会话，在模式选择器里选 **Chat（轻量对话）**。

<details>
<summary>其他安装方式（Release tgz / 固定版本 / 本地目录调试）</summary>

```sh
# 从 Release 的 .tgz 安装（不经过源码构建）
dsh plugin --profile <profile> add https://github.com/XiaoFeng7418/dsh-plugin-chat-mode/releases/download/v0.2.0/dsh-plugin-chat-mode-0.2.0.tgz

# 固定到某个版本
dsh plugin --profile <profile> add github:XiaoFeng7418/dsh-plugin-chat-mode#v0.2.0

# 本地开发：把目录直接链接进 profile
dsh plugin --profile <profile> add /绝对路径/dsh-plugin-chat-mode
```

</details>

## 斜杠命令速查

在聊天框输入即可，**全部本地执行**：不花 token、不新建请求、不影响其他会话。

| 命令 | 用途 |
| --- | --- |
| `/chat` | 查看当前会话的风格、温度、联网开关与累计用量 |
| `/chat savings` | 按本会话用量估算相对 Standard 省下的输入 token |
| `/chat save` | 把当前设置写入 `~/.dsh/chat-mode.json`，新会话沿用 |
| `/tone web\|empty\|concise\|creative` | 自然口语 / 不要系统提示 / 极简直答 / 脑暴润色 |
| `/tone custom <文案>` | 用一段自定义短提示词（仅本会话） |
| `/think on\|off\|low\|high\|max` | 深度思考：`on` = `high`（与网页端同档），切换后思考开启时不发送 temperature |
| `/web on\|off` | 放行 `web_search` / `web_fetch` 两个联网工具，默认关闭 |
| `/temp auto\|off\|0-1.5` | 温度：跟随风格默认 / 不发送 / 锁定数值 |

切换只影响当前会话，且保存在内存里；DSH 重启会回到配置文件默认值，想长期保留就用 `/chat save`。

## 在 DSH Go（安卓）上用

1. 网页界面的 **插件 → +** 里填 `github:XiaoFeng7418/dsh-plugin-chat-mode`（或 Release `.tgz`、手机上的本地目录），安装后点「立即启用」。
2. 原生界面只有 DSH Go 自己的「工作 / 伙伴小屋 / 酒馆」，不显示 DSH 模式；点侧栏 **切换到网页界面**，在新会话页的模式选择器里选 **Chat（轻量对话）**。
3. 轻聊不需要多智能体时，可在插件管理里**暂时停用 `agent-teams`**，减少它注册的工具与上下文。联网搜索已在实机验证（App 1.1.0 / 1.2.0，内置引擎 `0.2.2-rc.1`）：`/web on` 后约 +455 input tokens，走 `deepseek-official` 只计模型 token。

细节与已知差异见 [技术说明](docs/TECHNICAL.md)。

## 配置

预设子行在设置页是**只读**的，调参写 `~/.dsh/chat-mode.json`（Windows：`C:\Users\<你>\.dsh\chat-mode.json`）：

```json
{
  "promptMode": "web-tone",
  "temperature": 1.0,
  "defaultThinking": "off"
}
```

优先级：内置默认值 → `cordis.patch.yml` 行配置 → 该文件。完整字段、`traceFile` 诊断与请求体形态见 [技术说明](docs/TECHNICAL.md)；版本变更见 [CHANGELOG](CHANGELOG.md)。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm test
```

改完重新挂载即可：`dsh plugin --profile <name> add /绝对路径/dsh-plugin-chat-mode`（桌面端同路径重装会提示重启，换新目录安装可让运行中的应用重新加载）。

## 致谢与许可

插件机制、preset、`tools.restrict`、`agent/request` 钩子来自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；纯对话请求构造与思考模式开关的习惯参考了 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)。代码以 [MIT](LICENSE) 许可。
