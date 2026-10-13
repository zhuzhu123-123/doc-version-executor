// 运行脚本：跑一个测试。
// 用法：NOTION_TOKEN=... node vt/run-vt.mjs --case VT01 [--fake] [--record]
// 原始样本只读不改：每次运行在“测试文档”页下新建一个测试文档，复制原始样本后在上面运行
//   --fake   试跑：只读一次真实样本，其余读写都在内存里的假 Notion 上，不改任何真实页面，不写测试总表
//   --record 正式运行时把结果写进测试总表（只在 GitHub 上使用）
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { run, notionIo, EXECUTOR_VERSION } from '../executor.mjs'
import { makeFaultyFetch } from './faults.mjs'
import { judge } from './judge.mjs'
import { CASES, EDITS } from './cases.mjs'
import { editPara } from './body.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null).filter(Boolean))
const S = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url)))
const vt = args.case, c = CASES[vt], s = S[vt]
if (!c || !s) { console.log('没有这个测试：' + vt); process.exit(2) }
const token = process.env.NOTION_TOKEN
const realFetch = globalThis.fetch
const hdr = { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'notion-version': '2026-03-11' }
const api = async (m, p, b) => { const r = await realFetch('https://api.notion.com/v1' + p, { method: m, headers: hdr, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${t.slice(0, 200)}`); return JSON.parse(t) }

// ---------- 假 Notion（只用于试跑） ----------
function fakeNotion(pages) {
  let n = 0
  const j = (st, o) => new Response(JSON.stringify(o), { status: st })
  return async (url, init = {}) => {
    const p = new URL(url).pathname.replace(/^\/v1/, ''), m = (init.method || 'GET').toUpperCase(), b = init.body ? JSON.parse(init.body) : null
    const mm = p.match(/^\/pages\/([^/]+)(\/markdown)?$/)
    if (m === 'POST' && p === '/pages') { const parent = b.parent.page_id.replace(/-/g, ''); if (!pages[parent]) return j(404, {}); const id = 'f'.repeat(24) + String(++n).padStart(8, '0'); pages[id] = { title: b.properties.title.title[0].text.content, md: '', parent }; return j(200, { id }) }
    const pg = mm && pages[mm[1].replace(/-/g, '')]; if (!pg) return j(404, {})
    if (mm[2] && m === 'GET') return j(200, { markdown: pg.md, truncated: false })
    if (mm[2] && m === 'PATCH') { pg.md = b.replace_content.new_str; return j(200, {}) }
    if (m === 'GET') return j(200, { properties: { title: { type: 'title', title: [{ plain_text: pg.title }] } } })
    if (m === 'PATCH') { pg.title = b.properties.title.title[0].text.content; return j(200, {}) }
    return j(400, {})
  }
}

// ---------- 1. 普通修改 ----------
const E = EDITS[c.edit], note = c.note ?? E.note
// 测试编号：正式运行时从测试总表算出本次是第几次
const DS = 'df0cf2ac398a4071a82d6ebf2112daa5' // 测试总表数据源
let runNo = vt + '-试跑', first = null
if (args.record && !args.fake) {
  const q = await api('POST', `/data_sources/${DS}/query`, { filter: { property: '测试编号', title: { starts_with: vt + '-' } } })
  const nums = q.results.map((p) => Number(p.properties['测试编号'].title[0].plain_text.split('-')[1]))
  first = q.results.find((p) => p.properties['结果'].select?.name === '未跑')
  runNo = first ? first.properties['测试编号'].title[0].plain_text : `${vt}-${String(Math.max(0, ...nums) + 1).padStart(2, '0')}`
}
const title = `${runNo}｜${s.title}`
// 原始样本只读不改；本次运行在新建的测试文档上进行
const orig = await api('GET', `/pages/${s.id}/markdown`)
let before = orig.markdown
// 试跑可以把样本换一种表：--shift K 把所有版本号加 K；--exrow 在最后加一行“异常”；--empty 去掉所有版本行
if (args.fake && args.shift) before = before.replace(/<td>第\s*(\d+)\s*版<\/td>/g, (x, n) => `<td>第 ${Number(n) + Number(args.shift)} 版</td>`)
if (args.fake && args.exrow) before = before.replace('</table>', '<tr>\n<td>异常</td>\n<td>2026/10/01 10:00</td>\n<td>测试</td>\n<td>上次写入失败</td>\n<td>版本管理表</td>\n<td></td>\n<td>无</td>\n</tr>\n</table>')
if (args.fake && args.empty) { const a = before.indexOf('<table'), b = before.indexOf('</table>'); const rows = before.slice(a, b).match(/<tr>[\s\S]*?<\/tr>/g); before = before.slice(0, a) + before.slice(a, b).replace(/<tr>[\s\S]*?<\/tr>\s*/g, (r) => r.startsWith(rows[0]) ? r : '') + before.slice(b) }
before = editPara(before, E.para, (l) => l + E.add)
let base = realFetch, docId
if (args.fake) {
  docId = 'e'.repeat(32)
  const pages = { [S.runs]: { title: '测试文档', md: '', parent: 'home' }, [docId]: { title, md: before, parent: S.runs }, [S.archive]: { title: '存档', md: '', parent: 'home' } }
  for (const cp of s.copies) pages[cp] = { title: 'copy', md: (await api('GET', `/pages/${cp}/markdown`)).markdown, parent: S.archive }
  base = fakeNotion(pages)
} else {
  docId = (await api('POST', '/pages', { parent: { page_id: S.runs }, properties: { title: { title: [{ text: { content: title } }] } } })).id.replace(/-/g, '')
  await api('PATCH', `/pages/${docId}/markdown`, { type: 'replace_content', replace_content: { new_str: before } })
  before = (await api('GET', `/pages/${docId}/markdown`)).markdown
}

// ---------- 2. 执行器运行，制造错误代码夹在中间 ----------
const rowsBefore = (before.slice(before.indexOf('<table'), before.indexOf('</table>')).match(/<tr>/g) || []).length
const ctx = { doc: docId, archive: S.archive, rowsBefore, otherPage: '121ed3ae2bb349d7b092ed95b3b17f0c' }
globalThis.fetch = makeFaultyFetch(c.faults, ctx, base)
const logs = []
const code = readFileSync(new URL('../executor.mjs', import.meta.url))
const codeHash = createHash('sha256').update(code).digest('hex')
const t0 = new Date()
let result
try { result = await run({ doc: docId, archive: S.archive, note, who: '测试运行' }, notionIo(token), (l) => { logs.push(l); console.log('  ' + l) }) }
finally { globalThis.fetch = realFetch }

// ---------- 3. 判定 ----------
const read = async (id) => { const r = await base(`https://api.notion.com/v1/pages/${id}/markdown`, { headers: hdr }); return r.ok ? JSON.parse(await r.text()).markdown : null }
const readTitle = async (id) => { const r = await base(`https://api.notion.com/v1/pages/${id}`, { headers: hdr }); if (!r.ok) return null; const p = JSON.parse(await r.text()); return Object.values(p.properties).find((x) => x.type === 'title').title.map((x) => x.plain_text).join('') }
const after = await read(docId)
const cid = ctx.copyId
const copy = cid ? { id: cid, md: await read(cid), title: await readTitle(cid), parent: ctx.stats.pagesCreated.find((x) => x.id === cid)?.parent } : null
const verdict = judge({ c, note, title, before, after, copy, result, logs, stats: ctx.stats, archive: S.archive, truncatedOnRead: orig.truncated })

console.log(`\n${vt}｜执行器 ${EXECUTOR_VERSION}｜代码哈希 ${codeHash.slice(0, 16)}｜${args.fake ? '试跑（假 Notion）' : '真实 Notion'}`)
console.log('制造的错误：' + (ctx.faultLog.join('；') || '无'))
for (const k of verdict.checks) console.log(`${k.pass ? '✔' : '✘'} ${k.name}${k.pass || !k.detail ? '' : '（' + k.detail + '）'}`)
console.log(`判定：${verdict.pass ? '通过' : '失败'}`)

// ---------- 4. 正式运行：写测试总表 ----------
if (args.record && !args.fake) {
  const fail = verdict.checks.filter((k) => !k.pass).map((k) => k.name).join('；')
  const props = {
    '结果': { select: { name: verdict.pass ? '通过' : '失败' } },
    '运行时间': { date: { start: t0.toISOString() } },
    '执行器版本': { rich_text: [{ text: { content: `${EXECUTOR_VERSION}｜${codeHash.slice(0, 16)}${process.env.GITHUB_SHA ? '｜' + process.env.GITHUB_SHA.slice(0, 7) : ''}` } }] },
    '存在问题': { rich_text: [{ text: { content: fail.slice(0, 1900) } }] },
    '测试文档': { url: 'https://www.' + 'notion.so/' + docId },
    ...(process.env.RUN_URL ? { '输出结果': { url: process.env.RUN_URL } } : {}),
  }
  if (first) await api('PATCH', `/pages/${first.id}`, { properties: props })
  else await api('POST', '/pages', { parent: { data_source_id: DS }, properties: { '测试编号': { title: [{ text: { content: runNo } }] }, ...props } })
}
process.exit(verdict.pass ? 0 : 1)
