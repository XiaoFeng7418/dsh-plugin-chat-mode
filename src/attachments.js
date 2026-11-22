/**
 * Attachments in lightweight chat mode.
 *
 * Chat mode runs without file tools, so an upload would otherwise reach the
 * model as nothing but a sentence naming a path it cannot read. This module
 * removes that dead end without giving the model any file access:
 *
 * 1. in `agent/pre-step` every `file` block in the *current* request is
 *    replaced by text: small UTF-8 files and `.docx` documents are inlined
 *    (bounded), everything else gets an honest one-line note;
 * 2. `read_attachment` is the only tool this plugin adds for uploads. It takes
 *    an `attachment_id`, and only accepts ids from the last user message of the
 *    current turn — no path ever reaches the model and no other file is
 *    reachable through it;
 * 3. the tool is visible exactly while that turn still has attachments, so a
 *    follow-up text-only message returns the request to zero tools.
 *
 * Format tables and limits live in `docs/TECHNICAL.md`.
 *
 * @module dsh-plugin-chat-mode/attachments
 */

import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

/** Tool name that reads one attachment of the current turn. */
export const ATTACHMENT_TOOL_NAME = 'read_attachment'

/** Characters of extracted text inlined into the request. */
export const INLINE_TEXT_LIMIT = 8 * 1024

/** Hard cap on the bytes this module will load from one attachment. */
const MAX_FILE_BYTES = 32 * 1024 * 1024

/** Hard cap on one inflated DOCX part. */
const MAX_PART_BYTES = 8 * 1024 * 1024

/** Bytes used to decide whether a file looks binary. */
const SNIFF_BYTES = 4096

/** Extensions read as text even when the sniff is inconclusive. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'json', 'jsonl', 'json5', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'conf', 'env', 'log', 'csv', 'tsv', 'xml', 'html', 'htm', 'xhtml',
  'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py',
  'rb', 'php', 'java', 'kt', 'kts', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'proto', 'tex',
  'gitignore', 'dockerfile', 'makefile', 'lock', 'srt', 'vtt',
])

/** One attachment reference, normalized across engines. */
/**
 * @typedef {object} AttachmentRef
 * @property {string} id
 * @property {string} name
 * @property {number} bytes
 */

/**
 * Per-agent attachments of the turn in flight.
 *
 * Keyed by the agent object so a preset switch, a plugin unload or a finished
 * turn cannot leave an id readable for another session.
 * @type {WeakMap<any, Map<string, AttachmentRef>>}
 */
const turnFiles = new WeakMap()

/**
 * Snapshot the file blocks of the last user message. Older attachments stay
 * unreadable on purpose: the allow list follows the current question only.
 *
 * @param {any} agent Agent whose turn is being assembled.
 * @param {readonly any[]} messages Request messages for this step.
 * @returns {Map<string, AttachmentRef>}
 */
export function rememberTurnAttachments(agent, messages) {
  const files = collectLastUserAttachments(messages)
  if (agent === undefined || agent === null) return files
  turnFiles.set(agent, files)
  return files
}

/**
 * Remember the user message an inbox claim delivered.
 *
 * The host resolves conditional registrations (`when`) *before* any pre-step
 * hook runs, so the allow list for the turn has to be in place at claim time;
 * otherwise the attachment tool is missing from the very step that needs it.
 * A claim of a text-only message clears the list, which returns the next
 * request to zero tools without a cleanup step.
 *
 * @param {any} agent Agent whose inbox claim is being processed.
 * @param {any} message The claimed message.
 * @returns {Map<string, AttachmentRef>}
 */
export function rememberClaimedMessage(agent, message) {
  if (agent === undefined || agent === null) return new Map()
  if (message?.role !== 'user' || !Array.isArray(message.content)) return turnAttachments(agent)
  const files = collectFromMessage(message)
  turnFiles.set(agent, files)
  return files
}

/**
 * @param {any} agent
 * @returns {Map<string, AttachmentRef>}
 */
export function turnAttachments(agent) {
  if (agent === undefined || agent === null) return new Map()
  return turnFiles.get(agent) ?? new Map()
}

/**
 * @param {any} agent
 */
export function forgetTurnAttachments(agent) {
  if (agent !== undefined && agent !== null) turnFiles.delete(agent)
}

/**
 * File blocks of the last user message in a request.
 *
 * @param {readonly any[]} messages
 * @returns {Map<string, AttachmentRef>}
 */
export function collectLastUserAttachments(messages) {
  if (!Array.isArray(messages)) return new Map()
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue
    return collectFromMessage(message)
  }
  return new Map()
}

/**
 * File blocks of one user message.
 *
 * @param {any} message
 * @returns {Map<string, AttachmentRef>}
 */
function collectFromMessage(message) {
  const files = new Map()
  for (const block of message.content) {
    const ref = normalizeFileBlock(block)
    if (ref !== undefined) files.set(ref.id, ref)
  }
  return files
}

/**
 * @param {any} block
 * @returns {AttachmentRef | undefined}
 */
function normalizeFileBlock(block) {
  if (block?.type !== 'file') return undefined
  const attachment = block.attachment
  const id = typeof attachment?.attachmentId === 'string' ? attachment.attachmentId : ''
  if (id.length === 0) return undefined
  return {
    id,
    name: typeof attachment.name === 'string' && attachment.name.length > 0 ? attachment.name : 'attachment',
    bytes: typeof attachment.bytes === 'number' && attachment.bytes >= 0 ? attachment.bytes : 0,
  }
}

/**
 * Replace the readable `file` blocks of the request with text.
 *
 * Only the ids of the current turn are inlined; a block from an older turn
 * keeps its own shape, so history is never rewritten. The host's "Read that
 * path with your file tools" handle never appears for the current upload,
 * because no `file` block of that id survives this projection.
 *
 * @param {readonly any[]} messages
 * @param {Map<string, AttachmentRef>} allowed
 * @param {(ref: AttachmentRef) => Promise<string>} describe
 * @returns {Promise<readonly any[]>}
 */
export async function projectAttachments(messages, allowed, describe) {
  if (!Array.isArray(messages) || allowed.size === 0) return messages
  /** @type {Map<string, Promise<string>>} */
  const pending = new Map()
  let changed = false
  const next = []
  for (const message of messages) {
    if (!hasFileBlock(message)) {
      next.push(message)
      continue
    }
    const content = []
    let messageChanged = false
    for (const block of message.content) {
      const ref = normalizeFileBlock(block)
      if (ref === undefined || !allowed.has(ref.id)) {
        content.push(block)
        continue
      }
      let text = pending.get(ref.id)
      if (text === undefined) {
        text = describe(ref)
        pending.set(ref.id, text)
      }
      content.push({ type: 'text', text: await text })
      messageChanged = true
    }
    if (messageChanged) {
      changed = true
      next.push({ ...message, content })
    } else {
      next.push(message)
    }
  }
  return changed ? next : messages
}

/**
 * @param {any} message
 * @returns {boolean}
 */
function hasFileBlock(message) {
  return Array.isArray(message?.content) && message.content.some((block) => block?.type === 'file')
}

/**
 * Model-facing text for one readable attachment.
 *
 * @param {AttachmentRef} ref
 * @param {{ bytes?: Buffer | undefined, reason?: string }} loaded
 * @param {{ offset?: number, limit?: number }} [range]
 * @returns {string}
 */
export function describeAttachment(ref, loaded, range = {}) {
  const header = `[Attachment "${ref.name}" attachment_id="${ref.id}" ${ref.bytes} bytes]`
  const bytes = loaded?.bytes
  if (bytes === undefined) return [header, loaded?.reason ?? unavailableReason(ref)].join('\n')
  const extracted = extractAttachmentText(ref.name, bytes)
  if (extracted.kind !== 'text') return [header, extracted.note].join('\n')
  const offset = Number.isFinite(range.offset) && Number(range.offset) > 0 ? Math.floor(Number(range.offset)) : 0
  const limit = Number.isFinite(range.limit) && Number(range.limit) > 0
    ? Math.min(INLINE_TEXT_LIMIT * 4, Math.floor(Number(range.limit)))
    : INLINE_TEXT_LIMIT
  const total = extracted.text.length
  const slice = extracted.text.slice(offset, offset + limit)
  const lines = [header, extracted.note === undefined ? slice : `${extracted.note}\n${slice}`]
  if (offset > 0 || offset + slice.length < total) {
    lines.push(`[showing characters ${offset}–${offset + slice.length} of ${total}; call ${ATTACHMENT_TOOL_NAME} with offset to continue]`)
  }
  return lines.join('\n')
}

/**
 * @param {AttachmentRef} ref
 * @returns {string}
 */
function unavailableReason(ref) {
  return `[The attachment "${ref.name}" could not be opened in this environment; say so instead of guessing its contents.]`
}

/**
 * Extract readable text from one attachment.
 *
 * @param {string} name File name as uploaded.
 * @param {Buffer} bytes Exact uploaded bytes.
 * @returns {{ kind: 'text', text: string, note?: string } | { kind: 'other', note: string }}
 */
export function extractAttachmentText(name, bytes) {
  const lower = String(name).toLowerCase()
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  if (looksPdf(bytes) || extension === 'pdf') {
    return {
      kind: 'other',
      note: '[PDF text extraction is not available in lightweight chat mode. Tell the user briefly that PDFs cannot be read here and suggest uploading a screenshot of the pages (images are understood natively) or switching to Standard mode, which has document tools.]',
    }
  }
  if (looksLegacyWord(bytes) || extension === 'doc') {
    return {
      kind: 'other',
      note: '[This is a legacy .doc binary. Lightweight chat cannot read it; suggest re-saving as .docx, or switch to Standard mode.]',
    }
  }
  if (extension === 'docx' || (looksZip(bytes) && extension !== 'docx')) {
    if (extension === 'docx') {
      const text = readDocxText(bytes)
      if (text !== undefined) return { kind: 'text', text }
      return { kind: 'other', note: '[This .docx could not be extracted (its word/document.xml is missing or unreadable). Say so rather than guessing.]' }
    }
  }
  if (['xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp', 'zip', '7z', 'rar', 'gz', 'tgz'].includes(extension)) {
    return {
      kind: 'other',
      note: `[A .${extension} archive cannot be read in lightweight chat mode. Suggest switching to Standard mode for document extraction.]`,
    }
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      kind: 'other',
      note: '[This is an image file uploaded as a document. Vision input works when the picture is attached as an image; suggest re-attaching it as a photo.]',
    }
  }
  if (looksBinary(bytes) && !TEXT_EXTENSIONS.has(extension)) {
    return {
      kind: 'other',
      note: '[This file looks binary and cannot be read as text. Say so instead of guessing its contents.]',
    }
  }
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
  if (text.includes('\u0000')) {
    return { kind: 'other', note: '[This file contains binary data; say so instead of guessing.]' }
  }
  return { kind: 'text', text }
}

/** Extensions whose bytes are pictures, not documents. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic'])

/**
 * @param {Buffer} bytes
 * @returns {boolean}
 */
function looksPdf(bytes) {
  return bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === '%PDF'
}

/**
 * @param {Buffer} bytes
 * @returns {boolean}
 */
function looksLegacyWord(bytes) {
  return bytes.length >= 8
    && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

/**
 * @param {Buffer} bytes
 * @returns {boolean}
 */
function looksZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/**
 * @param {Buffer} bytes
 * @returns {boolean}
 */
function looksBinary(bytes) {
  const sample = bytes.subarray(0, SNIFF_BYTES)
  return sample.includes(0)
}

/**
 * Read `word/document.xml` out of a DOCX container and turn it into text.
 *
 * @param {Buffer} bytes
 * @returns {string | undefined}
 */
export function readDocxText(bytes) {
  const xml = readZipEntry(bytes, 'word/document.xml')
  if (xml === undefined) return undefined
  return docxXmlToText(xml.toString('utf8'))
}

/**
 * Read one member out of a ZIP container using the central directory.
 *
 * @param {Buffer} bytes
 * @param {string} wanted Member name.
 * @returns {Buffer | undefined}
 */
export function readZipEntry(bytes, wanted) {
  const eocd = findEndOfCentralDirectory(bytes)
  if (eocd < 0) return undefined
  const count = bytes.readUInt16LE(eocd + 10)
  let offset = bytes.readUInt32LE(eocd + 16)
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) return undefined
    const method = bytes.readUInt16LE(offset + 10)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const localOffset = bytes.readUInt32LE(offset + 42)
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (name === wanted) return readZipMember(bytes, localOffset, method, compressedSize)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return undefined
}

/**
 * @param {Buffer} bytes
 * @param {number} localOffset
 * @param {number} method
 * @param {number} compressedSize
 * @returns {Buffer | undefined}
 */
function readZipMember(bytes, localOffset, method, compressedSize) {
  if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) return undefined
  const nameLength = bytes.readUInt16LE(localOffset + 26)
  const extraLength = bytes.readUInt16LE(localOffset + 28)
  const start = localOffset + 30 + nameLength + extraLength
  const end = start + compressedSize
  if (end > bytes.length) return undefined
  const payload = bytes.subarray(start, end)
  if (method === 0) return payload.subarray(0, MAX_PART_BYTES)
  if (method !== 8) return undefined
  try {
    return inflateRawSync(payload, { maxOutputLength: MAX_PART_BYTES })
  } catch {
    return undefined
  }
}

/**
 * @param {Buffer} bytes
 * @returns {number}
 */
function findEndOfCentralDirectory(bytes) {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const stop = Math.max(0, bytes.length - 22 - 0xffff)
  for (let offset = bytes.length - 22; offset >= stop; offset -= 1) {
    if (bytes.readUInt32LE(offset) === signature.readUInt32LE(0)) return offset
  }
  return -1
}

/**
 * Turn WordprocessingML into plain text.
 *
 * @param {string} xml
 * @returns {string}
 */
export function docxXmlToText(xml) {
  const spaced = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<w:cr\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n</w:p>')
  const stripped = spaced.replace(/<[^>]*>/g, '')
  return decodeXmlEntities(stripped)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Decode the entities Word writes into its text runs.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => codePoint(Number(decimal)))
    .replace(/&amp;/g, '&')
}

/**
 * @param {number} value
 * @returns {string}
 */
function codePoint(value) {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return ''
  try {
    return String.fromCodePoint(value)
  } catch {
    return ''
  }
}

/**
 * Build the one attachment tool.
 *
 * The tool only ever sees ids the projection just whitelisted, and resolves
 * them through the attachment service itself — the model cannot name a path.
 *
 * @param {object} hooks
 * @param {(ref: AttachmentRef) => Promise<{ bytes?: Buffer, reason?: string }>} hooks.load
 * @param {(agent: any) => Map<string, AttachmentRef>} hooks.allowedOf
 * @returns {any} Tool definition accepted by `tools.register`.
 */
export function attachmentToolDefinition({ load, allowedOf }) {
  return {
    name: ATTACHMENT_TOOL_NAME,
    description: 'Read one attachment uploaded with the current message. Pass the attachment_id shown in the attachment note; use offset to page through long text.',
    parameters: {
      attachment_id: {
        type: 'string',
        description: 'The attachment_id of an upload in the current user message, e.g. sha256:…',
        required: true,
      },
      offset: {
        type: 'number',
        description: 'Character offset to start from. Omit to start at the beginning.',
      },
      limit: {
        type: 'number',
        description: 'Maximum characters to return (default 8192, at most 32768).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    isConcurrencySafe: () => true,
    async execute(args, execution) {
      const agent = execution?.agent
      const allowed = allowedOf(agent)
      const id = typeof args?.attachment_id === 'string' ? args.attachment_id.trim() : ''
      const ref = allowed.get(id)
      if (ref === undefined) {
        throw new Error(`${ATTACHMENT_TOOL_NAME} can only read an attachment from the current user message; "${id}" is not one of them`)
      }
      const loaded = await load(ref)
      const text = describeAttachment(ref, loaded, { offset: args?.offset, limit: args?.limit })
      return { text }
    },
  }
}

/**
 * Load attachment bytes through the host attachment service.
 *
 * @param {() => any} getService Resolves the `attachments` service on demand.
 * @returns {(ref: AttachmentRef) => Promise<{ bytes?: Buffer, reason?: string }>}
 */
export function createAttachmentLoader(getService) {
  return async (ref) => {
    let service
    try {
      service = getService()
    } catch {
      service = undefined
    }
    if (service === undefined) {
      return { reason: `[The attachment store is not available in this environment, so "${ref.name}" cannot be read. Say so instead of guessing.]` }
    }
    let hostPath
    try {
      hostPath = service.fileHostPath({ attachmentId: ref.id, name: ref.name, bytes: ref.bytes })
    } catch (error) {
      return { reason: `[The attachment "${ref.name}" could not be resolved (${messageOf(error)}). Say so instead of guessing.]` }
    }
    if (typeof hostPath !== 'string' || hostPath.length === 0) {
      return { reason: `[The attachment "${ref.name}" has no readable copy in this environment. Say so instead of guessing.]` }
    }
    try {
      const bytes = readFileSync(hostPath)
      if (bytes.length > MAX_FILE_BYTES) {
        return { reason: `[The attachment "${ref.name}" is larger than ${MAX_FILE_BYTES} bytes and was not loaded. Suggest a smaller upload or Standard mode.]` }
      }
      return { bytes }
    } catch (error) {
      return { reason: `[The attachment "${ref.name}" could not be read (${messageOf(error)}). Say so instead of guessing.]` }
    }
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
