/**
 * System prompts for the chat preset: one short tone line per style, or none at
 * all for `empty`. Everything is written to stay under ~80 tokens and to follow
 * the language the user writes in.
 *
 * @module dsh-plugin-chat-mode/prompts
 */

/** Neutral everyday-conversation tone (default). */
export const WEB_TONE_PROMPT = [
  '你是一个自然真诚的对话助手，用用户提问的语言回答。',
  '中文时简洁口语化，有自己的判断，不同意就直说，不确定就坦白，别用客服腔。',
].join('')

/** Short, blunt direct-answer tone. */
export const CONCISE_PROMPT = [
  '你是一个直接了当的对话助手，用用户提问的语言回答。',
  '先给结论，再给必要的一两句解释；能一句说清就不说三句，不用客套和铺垫。',
].join('')

/** Brainstorming / polishing tone, paired with a higher temperature. */
export const CREATIVE_PROMPT = [
  '你是一个有想象力的对话伙伴，用用户提问的语言回答。',
  '多做联想、给多个思路和比喻，语气放松，可以俏皮；默认只给想法，不替用户做决定。',
].join('')

/** Tone ids accepted by `/tone`. */
export const TONES = Object.freeze(['web-tone', 'empty', 'concise', 'creative', 'custom'])

/**
 * @typedef {object} ToneInput
 * @property {string} tone One of {@link TONES}.
 * @property {string} customPrompt Text used by the `custom` tone.
 */

/**
 * @param {ToneInput} input
 * @returns {string} The complete system prompt (possibly empty).
 */
export function promptForTone({ tone, customPrompt }) {
  switch (tone) {
    case 'empty':
      return ''
    case 'concise':
      return CONCISE_PROMPT
    case 'creative':
      return CREATIVE_PROMPT
    case 'custom':
      return customPrompt.trim()
    case 'web-tone':
    default:
      return WEB_TONE_PROMPT
  }
}

/**
 * Backwards-compatible entry point used by the preset default.
 *
 * @param {{ promptMode: string, customPrompt: string }} options
 * @returns {string}
 */
export function promptFor(options) {
  return promptForTone({ tone: options.promptMode, customPrompt: options.customPrompt })
}
