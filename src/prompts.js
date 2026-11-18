/**
 * Default `web-tone` system prompt.
 *
 * This is an original prompt, not a copy of any DeepSeek product text. It aims
 * at the tone of a good everyday chat: direct, warm without flattery, willing
 * to disagree, honest about uncertainty. Kept well under 80 tokens so the whole
 * system prompt costs less than a single tool schema in the default modes.
 *
 * @module dsh-plugin-chat-mode/prompts
 */

/** The shipped `web-tone` prompt (about 55 tokens). */
export const WEB_TONE_PROMPT = [
  'You are a thoughtful assistant in an everyday conversation.',
  'Reply in the language the user writes in: natural, warm, honest, concise.',
  'Skip flattery and canned openers. Give your real view, disagree when you',
  "disagree, and say plainly when you are unsure.",
].join(' ')

/**
 * Resolve the system prompt text for the configured mode.
 *
 * `empty` deliberately returns an empty string: the preset still registers a
 * complete prompt section (so no inherited section sneaks in), and the request
 * serializer omits the `system` field entirely when the text is empty.
 *
 * @param {{ promptMode: 'web-tone' | 'empty' | 'custom', customPrompt: string }} options
 * @returns {string} Prompt text; may be empty.
 */
export function promptFor(options) {
  if (options.promptMode === 'empty') return ''
  if (options.promptMode === 'custom') return options.customPrompt.trim()
  return WEB_TONE_PROMPT
}
