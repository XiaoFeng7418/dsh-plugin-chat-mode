/**
 * 默认 `web-tone` 系统提示词。
 *
 * 这是一段原创提示词，不是任何 DeepSeek 产品文案的复制。目标手感是「一次好
 * 的日常对话」：直接、真诚、有温度但不讨好，有主见、敢说不同意，不确定就
 * 坦白。整段控制在 80 tokens 以内，让整套系统提示的成本低于默认模式里一个
 * 工具 schema。用户用其他语言提问时，模型会跟随该语言作答。
 *
 * @module dsh-plugin-chat-mode/prompts
 */

/** 内置的 `web-tone` 提示词（约 70 个汉字，估算 60–70 tokens）。 */
export const WEB_TONE_PROMPT = '你是一个自然真诚的对话助手，用用户提问的语言回答。中文时简洁口语化，有自己的判断，不同意就直说，不确定就坦白，别用客服腔。'

/**
 * 解析当前配置对应的系统提示词文本。
 *
 * `empty` 刻意返回空串：预设仍然注册一个 complete 段落（防止继承的段落混
 * 入），而请求序列化时会把空的 `system` 字段整体省略。
 *
 * @param {{ promptMode: 'web-tone' | 'empty' | 'custom', customPrompt: string }} options
 * @returns {string} 提示词文本，可能为空。
 */
export function promptFor(options) {
  if (options.promptMode === 'empty') return ''
  if (options.promptMode === 'custom') return options.customPrompt.trim()
  return WEB_TONE_PROMPT
}
