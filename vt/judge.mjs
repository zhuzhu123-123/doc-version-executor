// 判定代码：运行结束后，对照测试总表这一行的“正确结果”检查样本，只输出通过或失败。
import { parseTable, cellsOf, sha, canon } from '../executor.mjs'

const rows = (md) => { const t = md && parseTable(md); return t ? t.rows.map(cellsOf) : null }
const same = (a, b) => canon(a) === canon(b)
const linkId = (cell) => ((cell || '').match(/[0-9a-f]{32}|[0-9a-f-]{36}/g) || []).pop()?.replace(/-/g, '') || null

/**
 * r: { c, note, title, before, after, copy:{ md, title, parent } | null, result, logs, stats, archive }
 * before = 普通修改完、执行器运行前的文档；after = 运行结束后的文档
 */
export function judge(r) {
  const { c } = r, checks = []
  const ok = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })
  const B = rows(r.before), A = rows(r.after), log = r.logs.join('\n')
  const out = JSON.stringify(r.result)

  if (c.expect === 'noTable') {
    ok('结果是版本管理失败', r.result.result === '版本管理失败')
    ok('没有新建表，文档一字未改', sha(r.after) === sha(r.before))
    ok('没有建副本页', r.stats.pagesCreated.length === 0)
    ok('执行结果写明版本管理表缺失', /版本管理表/.test(r.result.problem || ''), r.result.problem)
  } else if (c.expect === 'noRetry') {
    ok('结果是版本管理失败', r.result.result === '版本管理失败')
    ok('版本行只尝试写了1次（不重试）', r.stats.versionWrites === 1, `尝试${r.stats.versionWrites}次`)
    ok('文档版本管理表没有变', B && A && A.length === B.length && B.every((x, i) => same(x.join('|'), A[i].join('|'))))
    ok('执行结果写明失败步骤、已完成部分、待处理问题', r.result.step && r.result.done && r.result.problem, out)
  } else {
    ok('文档还有版本管理表', A)
    if (!A) return finish()
    ok('表里只多了一行', A.length === B.length + 1, `${B.length} → ${A.length}`)
    const prevIdx = B.map((x) => x[0]).lastIndexOf('第 2 版')
    const last = A.at(-1) || []
    if (c.expect === 'ok') {
      ok('结果是版本成立', r.result.result === '版本成立', r.result.problem || '')
      ok('最新一行是“第 3 版”', last[0] === '第 3 版', last[0])
      ok('最新一行的下一版操作说明为空', last[5] === '')
      ok('上一版那一行的下一版操作说明已按本次说明填好', A[prevIdx] && same(A[prevIdx][5], r.note.replace(/</g, '＜').replace(/>/g, '＞')))
      ok('其余旧行一个字不改', B.every((x, i) => i === prevIdx || same(x.join('|'), (A[i] || []).join('|'))))
      ok('副本存在且在存档页', r.copy && r.copy.parent === r.archive)
      ok('新一行链接指向这个副本', r.copy && linkId(last[6]) === r.copy.id)
      ok('副本标题为“第3版副本｜文档标题”', r.copy && r.copy.title === `第3版副本｜${r.title}`, r.copy?.title)
      ok('副本和文档逐字一致', r.copy && sha(r.copy.md) === sha(r.after))
      ok('没有多建副本页', r.stats.pagesCreated.length === 1, `${r.stats.pagesCreated.length}个`)
    } else {
      ok('结果不是版本成立', r.result.result === '版本管理失败')
      ok('最新一行是“异常”', last[0] === '异常', last[0])
      ok('旧行一个字不改', B.every((x, i) => same(x.join('|'), (A[i] || []).join('|'))))
      for (const w of c.words || []) ok(`异常行写明“${w}”`, last.join(' ').includes(w), last.slice(3, 6).join(' / '))
      if (c.copyLink === 'copy') ok('异常行副本链接填这次建的副本页', r.copy && linkId(last[6]) === r.copy.id)
      if (c.copyLink === 'none') ok('异常行副本链接写“无”', last[6] === '无', last[6])
      if (c.noCopy) ok('没有建副本页', r.stats.pagesCreated.length === 0)
      if (c.noDupRow) ok('表里不留错误的“第 2 版”', A.filter((x) => x[0] === '第 2 版').length === 1)
      if (c.noCopyElsewhere) ok('没有在别处建副本页', r.stats.pagesCreated.length === 0)
    }
  }
  for (const s of c.logHas || []) ok(`运行记录含“${s}”`, log.includes(s))
  if (c.copyFailsFirst) ok(`前${c.copyFailsFirst}次副本比对不一致、第${c.copyFailsFirst + 1}次一致`, (log.match(/\[写入并比对副本\] 第\d次 失败：副本与文档不一致/g) || []).length === c.copyFailsFirst && log.includes(`[写入并比对副本] 第${c.copyFailsFirst + 1}次 成功`))
  if (c.longDoc) ok('文档长到需要分两次读取', r.truncatedOnRead === true, '样本长度未触发分次读取')
  if (c.outputSays) ok(`输出结果说明“${c.outputSays}”`, (out + log).includes(c.outputSays))
  return finish()
  function finish() { return { pass: checks.every((x) => x.pass), checks } }
}
