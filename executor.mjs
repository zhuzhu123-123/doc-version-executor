// 版本管理执行器 v5（章节更名、完整引言、例行时间排除）
// 依据：《AI 与人类协作文档版本管理：执行协议》第22版
// 用法：NOTION_TOKEN=... node executor.mjs --doc <文档ID> --archive <存档页ID> --note "本次操作说明" --who "操作人"
// 结果：退出码 0 = 版本成立；1 = 版本管理失败

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const EXECUTOR_VERSION = 'v5'
const COLS = ['版本', '当前版本操作时间', '当前版本操作人', '当前版本操作说明', '当前版本影响位置', '下一版操作说明', '文档副本存档链接']
const MAX = 3

// ---------- 错误类型 ----------
export class StopError extends Error {} // 停止类：不重试
export class RetryableError extends Error {} // 可恢复：可重试

// ---------- Notion 读写（正式运行时使用） ----------
export function notionIo(token) {
  const call = async (method, path, body) => {
    let res
    try {
      res = await fetch('https://api.notion.com/v1' + path, {
        method,
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'notion-version': '2026-03-11' },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (e) { throw new RetryableError('网络错误：' + e.message) }
    const text = await res.text()
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new StopError(`找不到、打不开或没有权限（${res.status}）：${text.slice(0, 200)}`)
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`服务暂时错误（${res.status}）`)
    if (!res.ok) throw new StopError(`请求被拒绝（${res.status}）：${text.slice(0, 200)}`)
    return JSON.parse(text)
  }
  return {
    async getMd(id) {
      const r = await call('GET', `/pages/${id}/markdown`)
      if (r.truncated) throw new StopError('页面内容过长，无法一次完整读取')
      return r.markdown
    },
    async putMd(id, md) { await call('PATCH', `/pages/${id}/markdown`, { type: 'replace_content', replace_content: { new_str: md } }) },
    async getTitle(id) {
      const p = await call('GET', `/pages/${id}`)
      const t = Object.values(p.properties).find((x) => x.type === 'title')
      return (t?.title || []).map((x) => x.plain_text).join('')
    },
    async setTitle(id, title) { await call('PATCH', `/pages/${id}`, { properties: { title: { title: [{ text: { content: title } }] } } }) },
    async createPage(parentId, title) {
      const p = await call('POST', '/pages', { parent: { page_id: parentId }, properties: { title: { title: [{ text: { content: title } }] } } })
      return p.id.replace(/-/g, '')
    },
    now: () => new Date(),
  }
}

// ---------- 工具函数 ----------
// 读页面编号：编号永远在链接最后。三步：去掉 ? 和 # 后面的内容（以及末尾的斜杠）；去掉横线；取最后 32 位。
export const pid = (u) => { const path = u.split(/[?#]/)[0].replace(/\/+$/, ''); return path.replace(/-/g, '').slice(-32) }
const norm = (s) => s.replace(/ discussion-urls="[^"]*"/g, '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => !/^<page url=/.test(l)).join('\n').trim()
const links = (s) => s
  .replace(/<mention-page url="([^"]+)"\s*\/>/g, (m, u) => `[LINK:${pid(u)}]`)
  .replace(/<mention-page url="([^"]+)">[\s\S]*?<\/mention-page>/g, (m, u) => `[LINK:${pid(u)}]`)
  .replace(/\[[^\]]*\]\(([^)]+)\)/g, (m, u) => `[LINK:${pid(u)}]`)
export const canon = (s) => links(norm(s))
export const sha = (s) => createHash('sha256').update(canon(s)).digest('hex')
const fmtTime = (d) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(/-/g, '/')
const esc = (s) => String(s).replace(/</g, '＜').replace(/>/g, '＞').replace(/\n/g, ' ')

export function parseTable(md) {
  const a = md.indexOf('<table'), b = md.indexOf('</table>')
  if (a < 0 || b < a) return null
  const rows = md.slice(a, b).match(/<tr>[\s\S]*?<\/tr>/g) || []
  return { start: a, end: b, rows }
}
export const cellsOf = (r) => (r.match(/<td>[\s\S]*?<\/td>/g) || []).map((c) => c.slice(4, -5).trim())
const makeRow = (cells) => '<tr>\n' + cells.map((c) => `<td>${c}</td>`).join('\n') + '\n</tr>'
const verNum = (r) => { const m = cellsOf(r)[0]?.match(/^第\s*(\d+)\s*版$/); return m ? Number(m[1]) : null }
const rowsEqual = (a, b) => canon(a) === canon(b)
const withRows = (md, t, rows) => md.slice(0, t.start) + md.slice(t.start, md.indexOf('>', t.start) + 1) + '\n' + rows.join('\n') + '\n' + md.slice(t.end)

// 例行时间只识别顶部明确标注的字段；仅替换时间值，不删除引言或整行。
const TIME_FIELD = /((?:最后更新时间|最后更新|更新时间)(?:\*\*)?[：:]\s*(?:\*\*)?)\d{4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/g
const topTime = (md, value) => {
  const end = md.search(/^## /m)
  const n = end < 0 ? md.length : end
  return md.slice(0, n).replace(TIME_FIELD, (_, label) => label + value) + md.slice(n)
}
export const refreshUpdatedTime = (md, value) => topTime(md, value)

// 保留章节顺序和同名章节；代码围栏中的 ## 不作为标题。
function sections(md) {
  const t = parseTable(md)
  let body = t ? md.slice(0, t.start) + md.slice(t.end + '</table>'.length) : md
  body = body.replace(/^## 版本管理表\s*$/gm, '')
  body = topTime(body, '[例行时间]')
  const parts = []; let current = { heading: null, text: [] }, fence = null
  for (const line of body.split('\n')) {
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (f) { if (!fence) fence = f[1]; else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null }
    const h = !fence && !f ? line.match(/^## (.+)$/) : null
    if (h) { parts.push(current); current = { heading: h[1].trim(), text: [] } }
    else current.text.push(line)
  }
  parts.push(current)
  return parts.map(x => ({ heading: x.heading, body: canon(x.text.join('\n')) }))
}

export function changedPlaces(prevMd, curMd) {
  const p = sections(prevMd), c = sections(curMd), out = []
  if (p[0].body !== c[0].body) out.push('顶部引言')
  const old = p.slice(1), now = c.slice(1), paired = new Map(), used = new Set()
  // 同名章节优先一对一匹配，不用 Map 覆盖重名章节。
  for (let j = 0; j < now.length; j++) {
    const i = old.findIndex((x, k) => !used.has(k) && x.heading === now[j].heading)
    if (i >= 0) { paired.set(j, i); used.add(i) }
  }
  // 只有正文唯一一致时，才判定纯更名；不凭位置或相似度猜测。
  for (let j = 0; j < now.length; j++) if (!paired.has(j) && now[j].body) {
    const candidates = old.map((x,i) => ({...x,i})).filter(x => !used.has(x.i) && x.body === now[j].body)
    const newCount = now.filter((x,k) => !paired.has(k) && x.body === now[j].body).length
    if (candidates.length === 1 && newCount === 1) {
      const i = candidates[0].i; paired.set(j,i); used.add(i)
      out.push('章节更名：' + old[i].heading + ' → ' + now[j].heading)
    }
  }
  const unmatchedOld = old.filter((_,i) => !used.has(i))
  const unmatchedNew = now.filter((_,j) => !paired.has(j))
  for (let j = 0; j < now.length; j++) if (paired.has(j)) {
    const i = paired.get(j)
    if (old[i].body !== now[j].body) out.push(now[j].heading)
  }
  // 同时有无法对应的新旧章节时明确不确定，避免把更名硬说成删除和新增。
  if (unmatchedOld.length && unmatchedNew.length) out.push('章节对应待核对：' + unmatchedOld.map(x=>x.heading).join('、') + ' → ' + unmatchedNew.map(x=>x.heading).join('、'))
  else {
    out.push(...unmatchedOld.map(x => '删除：' + x.heading))
    out.push(...unmatchedNew.map(x => '新增：' + x.heading))
  }
  if (!unmatchedOld.length && !unmatchedNew.length && [...paired.keys()].sort((a,b)=>a-b).some((j,k,js) => k > 0 && paired.get(js[k-1]) > paired.get(j))) out.push('章节顺序')
  out.push('版本管理表')
  return [...new Set(out)].join('；')
}

// 读回并确认内容可以核对：读不到写明“读回”，读到的不是文字写明“无法核对”
const readBack = async (io, id, what) => {
  let md
  try { md = await io.getMd(id) } catch (e) { if (e instanceof StopError) throw e; throw new Error(`${what}读回失败（${e.message}）`) }
  if (typeof md !== 'string') throw new Error(`${what}无法核对（读回的内容不是文字）`)
  return md
}

// ---------- 主流程 ----------
export async function run(input, io, logger = console.log) {
  const log = (...a) => logger(a.join(' '))
  const st = { step: '', done: [], copyId: null, recordWritten: false, md1: null, t1: null, N: null, prevIdx: -1 }
  const retry = async (name, fn) => {
    let err
    for (let i = 1; i <= MAX; i++) {
      try { const r = await fn(i); log(`[${name}] 第${i}次 成功`); return r } catch (e) {
        err = e; log(`[${name}] 第${i}次 失败：${e.message}`)
        if (e instanceof StopError) throw e
      }
    }
    throw new Error(`${name}：已尝试${MAX}次仍未解决（${err.message}）`)
  }
  const { doc, archive, note, who } = input
  const now = fmtTime(io.now())
  log(`执行器 ${EXECUTOR_VERSION} 开始运行 ${now}`)

  const fail = async (problem) => {
    log(`结果：版本管理失败｜失败步骤：${st.step}｜待处理：${problem}`)
    const result = { result: '版本管理失败', step: st.step, done: st.done.join('；') || '无', problem, tableWritten: false }
    if (!st.md1 || !st.t1) return result // 版本管理表无法写入：只输出执行结果
    const link = st.copyId ? `<mention-page url="https://www.notion.so/${st.copyId}"/>` : '无'
    const ex = makeRow(['异常', now, esc(who || '执行器'), esc('失败步骤：' + st.step + '。' + problem), esc('已完成：' + (st.done.join('；') || '无')), esc('待处理：' + problem), link])
    const target = withRows(st.md1, st.t1, [...st.t1.rows, ex]) // 旧行恢复为读取时的原文，末尾加异常行
    try {
      await retry('写入异常行', async () => {
        await io.putMd(doc, target)
        const t = parseTable(await io.getMd(doc))
        if (!t || t.rows.length !== st.t1.rows.length + 1) throw new Error('异常行读回行数不对')
        for (let i = 0; i < st.t1.rows.length; i++) if (!rowsEqual(t.rows[i], st.t1.rows[i])) throw new Error(`第${i}行与原文不一致`)
        if (cellsOf(t.rows.at(-1))[0] !== '异常') throw new Error('最新一行不是异常行')
      })
      result.tableWritten = true
    } catch (e) { result.problem += `；异常行也未能写入（${e.message}）` }
    return result
  }

  try {
    // 1. 核对输入
    st.step = '第1步 核对输入'
    if (!doc || !archive) throw new StopError('缺少文档或存档页')
    const noteMissing = !note || !String(note).trim()

    // 2. 读取版本管理表
    st.step = '第2步 读取版本管理表'
    const md1 = await retry('读取文档', () => io.getMd(doc))
    const t1 = parseTable(md1)
    if (!t1 || !t1.rows.length) throw new StopError('找不到版本管理表')
    const header = cellsOf(t1.rows[0])
    if (header.join('|') !== COLS.join('|')) throw new StopError('找不到版本管理表（表头不是规定的七列）')
    if (/^<page url=/m.test(md1)) throw new StopError('文档下面挂着子页面，副本无法与文档一致；请先把子页面移到存档页')
    st.md1 = md1; st.t1 = t1
    st.done.push('已读取版本管理表')
    if (noteMissing) { st.step = '第1步 核对输入'; return await fail('缺少本次操作说明') }
    const title = await retry('读取文档标题', () => io.getTitle(doc))

    // 3. 确定版本编号
    st.step = '第3步 确定版本编号'
    const nums = t1.rows.slice(1).map(verNum).filter((n) => n !== null)
    const prevN = nums.length ? Math.max(...nums) : 0
    const N = prevN + 1
    const prevIdx = prevN ? t1.rows.findIndex((r) => verNum(r) === prevN) : -1
    st.N = N; st.prevIdx = prevIdx
    log(`新版本编号：第${N}版`)

    // 4. 建立空副本页
    st.step = '第4步 建立空副本页'
    const copyTitle = `第${N}版副本｜${title}`
    st.copyId = await retry('建立副本页', () => io.createPage(archive, copyTitle))
    await retry('核对副本标题', async () => {
      const got = await io.getTitle(st.copyId)
      if (got !== copyTitle) { await io.setTitle(st.copyId, copyTitle); throw new Error(`标题为“${got}”，已改为“${copyTitle}”，待复查`) }
    })
    st.done.push('已建立副本页')

    // 影响位置：与上一版副本比较
    let where = '全文'
    if (prevIdx > 0) {
      const prevLink = cellsOf(t1.rows[prevIdx])[6] || ''
      const u = prevLink.match(/url="([^"]+)"|\(([^)]+)\)/)?.slice(1).find(Boolean)
      if (u) { try { where = changedPlaces(await io.getMd(pid(u)), md1) } catch { where = '全文' } }
    }

    // 5. 写入版本记录
    st.step = '第5步 写入版本记录'
    const newRow = makeRow([`第 ${N} 版`, now, esc(who || '未填写'), esc(note), esc(where), '', `<mention-page url="https://www.notion.so/${st.copyId}"/>`])
    const expRows = t1.rows.map((r, i) => (i === prevIdx ? makeRow(cellsOf(r).map((c, k) => (k === 5 ? esc(note) : c))) : r))
    const dated = refreshUpdatedTime(md1, now)
    const datedTable = parseTable(dated)
    const target = withRows(dated, datedTable, [...expRows, newRow])
    let md3
    await retry('写入并核对版本记录', async (i) => {
      const cur = await io.getMd(doc)
      if (i === 1 && sha(cur) !== sha(md1)) throw new StopError('执行中文档发生变化')
      const curT = parseTable(cur)
      const already = curT && curT.rows.length === expRows.length + 1 && sha(cur) === sha(target)
      if (!already) {
        try { await io.putMd(doc, target) } catch (e) {
          if (e instanceof StopError) throw e
          // 写入结果不明确：先读实际状态
          const after = await io.getMd(doc)
          if (sha(after) !== sha(target)) throw e
        }
      }
      st.recordWritten = true
      const back = await readBack(io, doc, '版本记录')
      const t = parseTable(back)
      if (!t || t.rows.length !== expRows.length + 1) throw new Error(`行数不对（${t ? t.rows.length : 0}）`)
      for (let k = 0; k < expRows.length; k++) if (!rowsEqual(t.rows[k], expRows[k])) throw new Error(k === prevIdx ? '上一版那一行不符合要求' : `旧行（第${k}行）被改动`)
      const c = cellsOf(t.rows.at(-1))
      if (c[0] !== `第 ${N} 版`) {
        if (expRows.slice(1).some((r) => cellsOf(r)[0] === c[0])) throw new Error(`版本号重复（新行编号为“${c[0]}”，表里已有这一版）`)
        throw new Error(`新行编号为“${c[0]}”`)
      }
      if (canon(c[3]) !== canon(esc(note))) throw new Error('新行操作说明不对')
      if (c[5] !== '') throw new Error('新行下一版操作说明不为空')
      if (!c[6] || pid(c[6].match(/url="([^"]+)"|\(([^)]+)\)/)?.slice(1).find(Boolean) || '') !== st.copyId) throw new Error('新行副本链接不对')
      if (!c[1] || !c[2] || !c[4]) throw new Error('新行有空格')
      md3 = back
    })
    st.done.push(`已写入第${N}版版本记录`)

    // 6. 写入副本
    st.step = '第6步 写入副本'
    let hDoc, hCopy
    await retry('写入并比对副本', async (i) => {
      if (sha(await io.getMd(doc)) !== sha(md3)) throw new StopError('执行中文档发生变化')
      if (i > 1) await io.putMd(st.copyId, '') // 清空副本后完整重写
      await io.putMd(st.copyId, md3)
      const back = await readBack(io, st.copyId, '副本')
      hDoc = sha(md3); hCopy = sha(back)
      if (hDoc !== hCopy) throw new Error(`副本与文档不一致（${hDoc.slice(0, 8)} / ${hCopy.slice(0, 8)}）`)
      if (sha(await io.getMd(doc)) !== sha(md3)) throw new StopError('执行中文档发生变化')
    })
    st.done.push('副本已写入并比对一致')

    // 7. 输出结果
    st.step = '第7步 输出结果'
    log(`文档哈希 ${hDoc}`)
    log(`副本哈希 ${hCopy}`)
    log(`结果：版本成立｜第${N}版｜副本 ${st.copyId}`)
    return { result: '版本成立', N, copyId: st.copyId, hash: hDoc, where }
  } catch (e) {
    return await fail(e.message)
  }
}

// ---------- 命令行入口 ----------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const args = {}
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
  const self = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
  console.log(`代码文件哈希 ${self}${process.env.GITHUB_SHA ? '｜GitHub 提交编号 ' + process.env.GITHUB_SHA : ''}`)
  if (!process.env.NOTION_TOKEN) { console.log('结果：版本管理失败｜缺少 NOTION_TOKEN'); process.exit(1) }
  const r = await run({ doc: args.doc, archive: args.archive, note: args.note, who: args.who }, notionIo(process.env.NOTION_TOKEN))
  console.log(JSON.stringify(r))
  process.exit(r.result === '版本成立' ? 0 : 1)
}
