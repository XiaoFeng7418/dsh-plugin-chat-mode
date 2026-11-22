import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import {
  ATTACHMENT_TOOL_NAME,
  attachmentToolDefinition,
  collectLastUserAttachments,
  createAttachmentLoader,
  decodeXmlEntities,
  describeAttachment,
  docxXmlToText,
  extractAttachmentText,
  projectAttachments,
  readDocxText,
  rememberClaimedMessage,
  rememberTurnAttachments,
  turnAttachments,
} from '../src/attachments.js'

/**
 * Build a one-member ZIP container. Stored entries keep the archive simple;
 * the deflated variant exercises the DOCX reader on real compression.
 *
 * @param {string} name Member name.
 * @param {string | Buffer} content Member bytes.
 * @param {{ deflate?: boolean }} [options]
 * @returns {Buffer}
 */
function zipWith(name, content, options = {}) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content)
  const nameBytes = Buffer.from(name, 'utf8')
  const payload = options.deflate === true ? deflateRawSync(data) : data
  const method = options.deflate === true ? 8 : 0
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x0800, 6)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(0, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  local.writeUInt16LE(0, 28)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(0, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt32LE(0, 42)
  const centralOffset = local.length + nameBytes.length + payload.length
  const centralSize = central.length + nameBytes.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([local, nameBytes, payload, central, nameBytes, eocd])
}

const DOCX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Plain sentence.</w:t></w:r></w:p>
    <w:p><w:r><w:t>A &amp; B &lt;tag&gt; &quot;quoted&quot; &#20320;&#x597D;</w:t></w:r></w:p>
    <w:p><w:r><w:t>Tab</w:t><w:tab/><w:t>separated</w:t></w:r></w:p>
    <w:p/>
  </w:body>
</w:document>`

test('small UTF-8 files are extracted verbatim, without the BOM', () => {
  const text = '\uFEFF第一行\r\nsecond line\n'
  const extracted = extractAttachmentText('notes.txt', Buffer.from(text, 'utf8'))
  assert.equal(extracted.kind, 'text')
  assert.equal(extracted.text, '第一行\r\nsecond line\n')
})

test('a binary payload is refused instead of decoded as mojibake', () => {
  const bytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x10])
  const extracted = extractAttachmentText('payload.bin', bytes)
  assert.equal(extracted.kind, 'other')
  assert.match(extracted.note, /binary/u)
})

test('a text-named file with NUL bytes still refuses to become text', () => {
  const extracted = extractAttachmentText('weird.txt', Buffer.concat([Buffer.from('ok'), Buffer.from([0]), Buffer.from('x')]))
  assert.equal(extracted.kind, 'other')
})

test('PDF hands back a friendly note, never a parse error', () => {
  const extracted = extractAttachmentText('paper.pdf', Buffer.from('%PDF-1.7\n...'))
  assert.equal(extracted.kind, 'other')
  assert.match(extracted.note, /PDF text extraction is not available/u)
  assert.match(extracted.note, /screenshot/u)
})

test('a legacy .doc is recognised by its container magic', () => {
  const bytes = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  const extracted = extractAttachmentText('old.doc', bytes)
  assert.equal(extracted.kind, 'other')
  assert.match(extracted.note, /\.doc\b|docx/u)
})

test('other office archives point at Standard mode', () => {
  const extracted = extractAttachmentText('sheet.xlsx', zipWith('xl/workbook.xml', '<x/>'))
  assert.equal(extracted.kind, 'other')
  assert.match(extracted.note, /Standard mode/u)
})

test('DOCX text keeps paragraphs, tabs and entities readable', () => {
  const docx = zipWith('word/document.xml', DOCX_XML, { deflate: true })
  const text = readDocxText(docx)
  assert.ok(text !== undefined)
  assert.match(text, /Plain sentence\./u)
  assert.match(text, /A & B <tag> "quoted" 你好/u)
  assert.match(text, /Tab\tseparated/u)
  assert.doesNotMatch(text, /<w:/u)
})

test('a DOCX without document.xml is a handled miss, not a crash', () => {
  assert.equal(readDocxText(zipWith('word/styles.xml', '<w/>')), undefined)
})

test('an oversized DOCX part is refused by the inflate budget', () => {
  const huge = ' '.repeat(9 * 1024 * 1024)
  const docx = zipWith('word/document.xml', `<w:document><w:p><w:t>${huge}</w:t></w:p></w:document>`, { deflate: true })
  assert.equal(readDocxText(docx), undefined)
})

test('the XML decoder restores named and numeric entities exactly once', () => {
  assert.equal(decodeXmlEntities('&lt;a&gt; &amp;lt; &#65; &#x4F60;'), '<a> &lt; A 你')
})

test('the last user message decides which attachments the turn may read', () => {
  const file = { type: 'file', attachment: { attachmentId: 'sha256:aa', name: 'a.txt', bytes: 3 } }
  const messages = [
    { role: 'user', content: [file] },
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    { role: 'user', content: [{ type: 'text', text: 'and now?' }] },
  ]
  assert.equal(collectLastUserAttachments(messages).size, 0)
  assert.equal(collectLastUserAttachments(messages.slice(0, 1)).size, 1)
})

test('an upload on the current message inlines text and keeps the id in the note', async () => {
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: 'summarize this' },
      { type: 'file', attachment: { attachmentId: 'sha256:aa', name: 'a.txt', bytes: 11 } },
    ],
  }]
  const allowed = new Map([['sha256:aa', { id: 'sha256:aa', name: 'a.txt', bytes: 11 }]])
  const projected = await projectAttachments(messages, allowed, async () => describeAttachment(
    { id: 'sha256:aa', name: 'a.txt', bytes: 11 },
    { bytes: Buffer.from('hello world', 'utf8') },
  ))
  assert.notEqual(projected, messages)
  const blocks = projected[0].content
  assert.equal(blocks.some((block) => block.type === 'file'), false)
  const note = blocks.at(-1).text
  assert.match(note, /attachment_id="sha256:aa"/u)
  assert.match(note, /hello world/u)
  assert.doesNotMatch(note, /Read that path with your file tools/u)
})

test('history keeps its own file blocks while the current upload is inlined', async () => {
  const old = { type: 'file', attachment: { attachmentId: 'sha256:old', name: 'old.pdf', bytes: 9 } }
  const current = { type: 'file', attachment: { attachmentId: 'sha256:new', name: 'new.txt', bytes: 2 } }
  const messages = [
    { role: 'user', content: [old] },
    { role: 'assistant', content: [{ type: 'text', text: 'read it' }] },
    { role: 'user', content: [current] },
  ]
  const allowed = new Map([['sha256:new', { id: 'sha256:new', name: 'new.txt', bytes: 2 }]])
  const projected = await projectAttachments(messages, allowed, async (ref) => describeAttachment(ref, { bytes: Buffer.from('hi') }))
  assert.equal(projected[0], messages[0])
  assert.equal(projected[1], messages[1])
  assert.notEqual(projected[2], messages[2])
  assert.match(projected[2].content[0].text, /hi/u)
})

test('a request without file blocks is returned untouched', async () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  assert.equal(await projectAttachments(messages, new Map(), async () => ''), messages)
})

test('the attachment tool refuses any id the current turn did not whitelist', async () => {
  const tool = attachmentToolDefinition({
    load: async () => ({ bytes: Buffer.from('x') }),
    allowedOf: () => new Map([['sha256:ok', { id: 'sha256:ok', name: 'ok.txt', bytes: 1 }]]),
  })
  assert.equal(tool.name, ATTACHMENT_TOOL_NAME)
  await assert.rejects(
    tool.execute({ attachment_id: 'sha256:other' }, { agent: {} }),
    /can only read an attachment from the current user message/u,
  )
  const result = await tool.execute({ attachment_id: 'sha256:ok' }, { agent: {} })
  assert.match(result.text, /attachment_id="sha256:ok"/u)
})

test('paging through a long attachment reports the remaining range', async () => {
  const ref = { id: 'sha256:long', name: 'long.txt', bytes: 40 }
  const text = 'abcdefghij'.repeat(4)
  const first = describeAttachment(ref, { bytes: Buffer.from(text) }, { limit: 10 })
  assert.match(first, /showing characters 0–10 of 40/u)
  const second = describeAttachment(ref, { bytes: Buffer.from(text) }, { offset: 30, limit: 10 })
  assert.match(second, /showing characters 30–40 of 40/u)
  assert.equal(second.includes('[showing characters 0–'), false)
})

test('the loader reads the stored copy of the exact reference', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-mode-att-'))
  const path = join(dir, 'stored')
  writeFileSync(path, 'stored bytes')
  const seen = []
  const load = createAttachmentLoader(() => ({
    fileHostPath: (ref) => {
      seen.push(ref)
      return path
    },
  }))
  const loaded = await load({ id: 'sha256:x', name: 'x.txt', bytes: 12 })
  assert.equal(loaded.bytes?.toString('utf8'), 'stored bytes')
  assert.deepEqual(seen, [{ attachmentId: 'sha256:x', name: 'x.txt', bytes: 12 }])
})

test('a missing attachment service yields a note instead of a throw', async () => {
  const load = createAttachmentLoader(() => undefined)
  const loaded = await load({ id: 'sha256:x', name: 'x.txt', bytes: 1 })
  assert.equal(loaded.bytes, undefined)
  assert.match(loaded.reason ?? '', /attachment store is not available/u)
})

test('turn state is per agent and clearable', () => {
  const a = {}
  const b = {}
  const messages = [{ role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'sha256:t', name: 't.txt', bytes: 1 } }] }]
  assert.equal(rememberTurnAttachments(a, messages).size, 1)
  assert.equal(turnAttachments(a).size, 1)
  assert.equal(turnAttachments(b).size, 0)
})

test('an inbox claim makes the upload readable before the step resolves its tools', () => {
  const agent = {}
  const upload = { role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'sha256:c', name: 'c.docx', bytes: 9 } }] }
  assert.equal(rememberClaimedMessage(agent, upload).size, 1)
  assert.equal(turnAttachments(agent).size, 1)
})

test('a text-only claim clears the previous upload', () => {
  const agent = {}
  rememberClaimedMessage(agent, { role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'sha256:c', name: 'c.docx', bytes: 9 } }] })
  assert.equal(turnAttachments(agent).size, 1)
  rememberClaimedMessage(agent, { role: 'user', content: [{ type: 'text', text: 'plain follow-up' }] })
  assert.equal(turnAttachments(agent).size, 0)
})

test('claims of non-user messages never widen or clear the allow list', () => {
  const agent = {}
  rememberClaimedMessage(agent, { role: 'user', content: [{ type: 'file', attachment: { attachmentId: 'sha256:k', name: 'k.txt', bytes: 3 } }] })
  rememberClaimedMessage(agent, { role: 'assistant', content: [{ type: 'text', text: 'working' }] })
  assert.deepEqual([...turnAttachments(agent).keys()], ['sha256:k'])
  rememberClaimedMessage(agent, undefined)
  assert.deepEqual([...turnAttachments(agent).keys()], ['sha256:k'])
})
