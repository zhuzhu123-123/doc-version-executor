// 判定代码：运行结束后，对照测试总表这一行的“正确结果”检查样本，只输出通过或失败。
// 按协议单独编写，不引用执行器的任何代码；预期编号在执行器运行前从样本现算。
import { createHash } from 'node:crypto'

// ---------- 自己的读表和比对（不用执行器的） ----------
const lastId = (u) => ((u || '').match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [u || '']).pop().replace(/-/g, '')
// 比对时：评论编号不算；行尾空白不算；子页面块不算；同一页面的不同网址写法算同一个链接
function canonical(md) {
  if (typeof md !== 'string') return null
  const lines = md.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => !l.startsWith('<page url='))
  return lines.join('\n').trim()
    .replace(/ discussion-urls="[^"]*"/g, '')
    .replace(/<mention-page url="([^"]+)"\s*\/>/g, (x, u) => `@[${lastId(u)}]`)
    .replace(/<mention-page url="([^"]+)">[\s\S]*?<\/mention-page>/g, (x, u) => `@[${lastId(u)}]`)
    .replace(/\[[^\]]*\]\(([^)]+)\)/g, (x, u) => `@[${lastId(u)}]`)
}
const fp = (md) => { const c = canonical(md); return c === null ? null : createHash('sha256').update(c).digest('hex') }
const same = (a, b) => canonical(a) === canonical(b)
function tableRows(md) {
  if (typeof md !== 'string') return null
  const a = md.indexOf('<table'), b = md.indexOf('</table>')
  if (a < 0 || b < a) return null
  return (md.slice(a, b).match(/<tr>[\s\S]*?<\/tr>/g) || []).map((r) => (r.match(/<td>[\s\S]*?<\/td>/g) || []).map((c) => c.slice(4, -5).trim()))
}
// 版本行的编号；“异常”行和表头返回 null
const num = (row) => { const m = (row?.[0] || '').match(/^第\s*(\d+)\s*版$/); return m ? Number(m[1]) : null }

/**
 * r: { c, note, title, before, after, copy:{ id, md, title, parent } | null, result, logs, stats, archive }
 * before = 普通修改完、执行器运行前的文档；after = 运行结束后的文档
 */
export function judge(r) {
  const { c } = r, checks = []
  const ok = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })
  const B = tableRows(r.before), A = tableRows(r.after), log = r.logs.join('\n')
  const out = JSON.stringify(r.result)

  // 运行前从样本现算预期：最近成立的版本 M，新版本应为 M+1
  const nums = (B || []).map(num)
  const M = Math.max(0, ...nums.filter((n) => n !== null))
  const N = M + 1
  const prevIdx = M ? nums.lastIndexOf(M) : -1
  const rowSame = (x, y) => same((x || []).join('|'), (y || []).join('|'))

  if (c.expect === 'noTable') {
    ok('结果是版本管理失败', r.result.result === '版本管理失败')
    ok('没有新建表，文档一字未改', fp(r.after) === fp(r.before))
    ok('没有建副本页', r.stats.pagesCreated.length === 0)
    ok('执行结果写明版本管理表缺失', /版本管理表/.test(r.result.problem || ''), r.result.problem)
  } else if (c.expect === 'noRetry') {
    ok('结果是版本管理失败', r.result.result === '版本管理失败')
    ok('版本行只尝试写了1次（不重试）', r.stats.versionWrites === 1, `尝试${r.stats.versionWrites}次`)
    ok('文档版本管理表没有变', B && A && A.length === B.length && B.every((x, i) => rowSame(x, A[i])))
    ok('执行结果写明失败步骤、已完成部分、待处理问题', r.result.step && r.result.done && r.result.problem, out)
  } else {
    ok('文档还有版本管理表', A)
    if (!A) return finish()
    ok('表里只多了一行', A.length === B.length + 1, `${B.length} → ${A.length}`)
    const last = A.at(-1) || []
    if (c.expect === 'ok') {
      ok('结果是版本成立', r.result.result === '版本成立', r.result.problem || '')
      ok(`最新一行编号＝运行前最近成立的版本加一（第 ${M} 版 → 第 ${N} 版）`, num(last) === N, last[0])
      ok('最新一行的下一版操作说明为空', last[5] === '')
      if (prevIdx >= 0) ok('上一版那一行的下一版操作说明已按本次说明填好', A[prevIdx] && same(A[prevIdx][5], r.note.replace(/</g, '＜').replace(/>/g, '＞')))
      ok('其余旧行一个字不改', B.every((x, i) => i === prevIdx || rowSame(x, A[i])))
      ok('副本存在且在存档页', r.copy && r.copy.parent === r.archive)
      ok('新一行链接指向这个副本', r.copy && lastId(last[6]) === r.copy.id)
      ok(`副本标题为“第${N}版副本｜文档标题”`, r.copy && r.copy.title === `第${N}版副本｜${r.title}`, r.copy?.title)
      ok('副本和文档逐字一致', r.copy && fp(r.copy.md) !== null && fp(r.copy.md) === fp(r.after))
      ok('没有多建副本页', r.stats.pagesCreated.length === 1, `${r.stats.pagesCreated.length}个`)
    } else {
      ok('结果不是版本成立', r.result.result === '版本管理失败')
      ok('最新一行是“异常”', last[0] === '异常', last[0])
      ok('旧行一个字不改', B.every((x, i) => rowSame(x, A[i])))
      for (const w of c.words || []) ok(`异常行写明“${w}”`, last.join(' ').includes(w), last.slice(3, 6).join(' / '))
      if (c.copyLink === 'copy') ok('异常行副本链接填这次建的副本页', r.copy && lastId(last[6]) === r.copy.id)
      if (c.copyLink === 'none') ok('异常行副本链接写“无”', last[6] === '无', last[6])
      if (c.noCopy) ok('没有建副本页', r.stats.pagesCreated.length === 0)
      if (c.noDupRow) ok(`表里不留撞号的“第 ${M} 版”`, A.filter((x) => num(x) === M).length === (M ? 1 : 0))
      if (c.noCopyElsewhere) ok('没有在别处建副本页', r.stats.pagesCreated.length === 0)
    }
  }
  for (const s of c.logHas || []) ok(`运行记录含“${s}”`, log.includes(s))
  if (c.copyFailsFirst) ok(`前${c.copyFailsFirst}次副本比对不一致、第${c.copyFailsFirst + 1}次一致`, (log.match(/\[写入并比对副本\] 第\d次 失败：副本与文档不一致/g) || []).length === c.copyFailsFirst && log.includes(`[写入并比对副本] 第${c.copyFailsFirst + 1}次 成功`))
  if (c.outputSays) ok(`输出结果说明“${c.outputSays}”`, (out + log).includes(c.outputSays))
  return finish()
  function finish() { return { pass: checks.every((x) => x.pass), checks } }
}
