// 制造错误代码：夹在执行器和 Notion 之间（替换全局 fetch），按测试总表里的“测试错误”制造事故。
// 执行器代码不引用本文件，也不知道它存在。

const ID32 = /[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
const clean = (s) => s.replace(/-/g, '')
const resp = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
const netErr = (why) => { const e = new TypeError('fetch failed'); e.cause = why; return e }

// 版本管理表里的行
const tableRange = (md) => { const a = md.indexOf('<table'), b = md.indexOf('</table>'); return a < 0 || b < a ? null : [a, b] }
const rowsOf = (md) => { const r = tableRange(md); return r ? md.slice(r[0], r[1]).match(/<tr>[\s\S]*?<\/tr>/g) || [] : [] }
const cells = (row) => (row.match(/<td>[\s\S]*?<\/td>/g) || []).map((c) => c.slice(4, -5))
const mkRow = (c) => '<tr>\n' + c.map((x) => `<td>${x}</td>`).join('\n') + '\n</tr>'
function editRows(md, fn) {
  const r = tableRange(md); if (!r) return md
  const part = md.slice(r[0], r[1]); const rows = part.match(/<tr>[\s\S]*?<\/tr>/g) || []
  const next = fn(rows.map(cells)); if (!next) return md
  let i = 0
  return md.slice(0, r[0]) + part.replace(/<tr>[\s\S]*?<\/tr>/g, () => mkRow(next[i++])) + md.slice(r[1])
}
// 这次写入是不是“写版本行”（最后一行是新编号，不是异常行）
const isVersionWrite = (md, before) => { const rs = rowsOf(md); return rs.length === before + 1 && /^第\s*\d+\s*版$/.test(cells(rs.at(-1))[0] || '') }
const isExceptionWrite = (md) => { const rs = rowsOf(md); return rs.length && cells(rs.at(-1))[0] === '异常' }

// 副本漏掉好几段：版本管理表后面的正文里，删掉第5、10、15、20个非空行
const dropMany = (md) => { const e = md.indexOf('</table>'); const head = md.slice(0, e), lines = md.slice(e).split('\n'); let n = 0; return head + lines.filter((l, i) => i === 0 || !l.trim() || ![5, 10, 15, 20].includes(++n)).join('\n') }
// 副本写错一个地方：正文里第一处“6.67”改成“6.76”
const typo = (md) => { const e = md.indexOf('</table>'); return md.slice(0, e) + md.slice(e).replace('6.67', '6.76') }

/**
 * plan：本测试要制造的事故列表，每项 { kind, times?, ... }
 * ctx：{ doc, archive, rowsBefore }
 * base：真正发请求的 fetch（真实 Notion 或试跑用的假 Notion）
 */
export function makeFaultyFetch(plan, ctx, base) {
  const used = {}
  const take = (kind) => { const f = plan.find((p) => p.kind === kind); if (!f) return null; used[kind] = (used[kind] || 0) + 1; if (f.times !== undefined && used[kind] > f.times) return null; return f }
  const has = (kind) => plan.some((p) => p.kind === kind)
  const log = (ctx.faultLog = [])
  const stats = (ctx.stats = { versionWrites: 0, exceptionWrites: 0, pagesCreated: [], createAttempts: 0, docChangedByOthers: false })
  ctx.copyId = null

  return async function faultyFetch(url, init = {}) {
    const u = new URL(url); const path = u.pathname.replace(/^\/v1/, ''); const method = (init.method || 'GET').toUpperCase()
    let body = init.body ? JSON.parse(init.body) : null
    const m = path.match(/^\/pages\/([^/]+)(\/markdown)?$/)
    const target = m ? clean(m[1]) : null, isMd = !!m?.[2]
    const isDoc = target === ctx.doc, isCopy = ctx.copyId && target === ctx.copyId
    const send = (b = body) => base(url, { ...init, body: b ? JSON.stringify(b) : init.body })

    // ---- 建副本页 ----
    if (method === 'POST' && path === '/pages') {
      stats.createAttempts++
      const parent = clean(body?.parent?.page_id || '')
      if (parent === ctx.archive && has('archiveUnavailable')) { log.push('存档页打不开：返回 404'); return resp(404, { object: 'error', status: 404, code: 'object_not_found', message: 'Could not find page' }) }
      if (parent === ctx.archive && take('copyTitleWrong')) { body = { ...body, properties: { title: { title: [{ text: { content: body.properties.title.title[0].text.content.split('｜')[0] } }] } } }; log.push('建副本页时把标题写成只有“第N版副本”') }
      const r = await send(); const t = await r.clone().text()
      if (r.ok) { const id = clean(JSON.parse(t).id); stats.pagesCreated.push({ id, parent }); if (parent === ctx.archive) ctx.copyId = id }
      return r
    }

    // ---- 改副本标题 ----
    if (method === 'PATCH' && isCopy && !isMd && body?.properties?.title && take('copyTitleWrong')) {
      body = { properties: { title: { title: [{ text: { content: body.properties.title.title[0].text.content.split('｜')[0] } }] } } }; log.push('改副本标题时仍只写“第N版副本”')
      return send()
    }

    // ---- 写文档 ----
    if (method === 'PATCH' && isDoc && isMd) {
      let md = body.replace_content.new_str
      const ver = isVersionWrite(md, ctx.rowsBefore), exc = isExceptionWrite(md)
      if (ver) stats.versionWrites++; if (exc) stats.exceptionWrites++
      if ((ver || exc) && has('noPermission')) { log.push('写版本管理表：返回 403 没有权限'); return resp(403, { object: 'error', status: 403, code: 'restricted_resource', message: 'Insufficient permissions' }) }
      if (ver) {
        let f
        if ((f = take('dupVersion'))) { md = editRows(md, (rs) => { rs.at(-1)[0] = f.to; return rs }); log.push(`版本行编号改写成“${f.to}”`) }
        if ((f = take('prevNoteBlank'))) { md = editRows(md, (rs) => { rs[rs.length - 2][5] = ''; return rs }); log.push('上一版的“下一版操作说明”写成空') }
        if ((f = take('newNoteFilled'))) { md = editRows(md, (rs) => { rs.at(-1)[5] = rs.at(-1)[3]; return rs }); log.push('新一行的“下一版操作说明”填上了内容') }
        if ((f = take('editRow1'))) { md = editRows(md, (rs) => { rs[1][3] = rs[1][3] + '并校对了全文术语。'; return rs }); log.push('顺带改动了第1版那一行的操作说明') }
        body = { ...body, replace_content: { new_str: md } }
        if (take('timeoutAfterWrite')) { const r = await send(); log.push(`版本行已写入（${r.status}），但对执行器报“超时”`); throw netErr('timeout') }
        const r = await send()
        if (r.ok && take('changeDocAfterRow')) {
          const cur = JSON.parse(await (await base(`https://api.notion.com/v1/pages/${ctx.doc}/markdown`, { method: 'GET', headers: init.headers })).text()).markdown
          const changed = cur.replace('这就是风险溢价。', '这就是风险溢价，也是股票长期收益的来源。')
          await base(`https://api.notion.com/v1/pages/${ctx.doc}/markdown`, { method: 'PATCH', headers: init.headers, body: JSON.stringify({ type: 'replace_content', replace_content: { new_str: changed } }) })
          stats.docChangedByOthers = true; log.push('版本行写完后，模拟有人改了第三章一句话')
        }
        return r
      }
      return send()
    }

    // ---- 写副本 ----
    if (method === 'PATCH' && isCopy && isMd) {
      let md = body.replace_content.new_str
      if (md.trim()) {
        if (take('copyDropPara')) { md = md.replace(/^由此可以推出几件事：\n/m, ''); log.push('副本漏掉一段（第三章“由此可以推出几件事”）') }
        else if (take('copySwapLink')) { md = md.replace(/(<mention-page url="[^"]*?)([0-9a-f]{32})/, (x, a) => a + ctx.otherPage); log.push('副本里第一个页面链接换成了另一个页面') }
        else if (take('copyDropMany')) { md = dropMany(md); log.push('副本漏掉好几段（正文里的第5、10、15、20段）') }
        else if (take('copyTypo')) { md = typo(md); log.push('副本里第五章的“6.67”改成了“6.76”') }
        else if (take('copyMixed')) { md = md.replace(/^由此可以推出几件事：\n/m, ''); md = typo(md); md = md.replace(/(<mention-page url="[^"]*?)([0-9a-f]{32})/, (x, a) => a + ctx.otherPage); log.push('副本同时漏掉一段、改了一个数字、换了一个页面链接') }
        body = { ...body, replace_content: { new_str: md } }
      }
      return send()
    }

    // ---- 读副本 ----
    if (method === 'GET' && isCopy && isMd) {
      if (take('copyReadError')) { log.push('读回副本：网络报错'); throw netErr('ECONNRESET') }
      if (take('copyUnverifiable')) { log.push('读回副本：返回内容无法计算指纹'); return resp(200, { object: 'page_markdown', markdown: null, truncated: false }) }
      const r = await send()
      if (r.ok && take('copyAltLink')) {
        const j = JSON.parse(await r.text())
        j.markdown = j.markdown.replace(/(<mention-page url="[^"]*?)([0-9a-f]{32})/, (x, a, id) => a + `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`)
        log.push('读回副本：第一个页面链接换成同一页面的另一种网址写法')
        return resp(200, j)
      }
      return r
    }

    return send()
  }
}
