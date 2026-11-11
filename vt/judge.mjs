// 独立结果判定：不导入执行器，不读取执行器返回的哈希作为正确答案。
import { createHash } from 'node:crypto'
export const pageId = u => {
  const text=(u||'').split(/[?#]/)[0].replace(/\/+$/,'')
  const m=text.match(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$/i)
  return m ? m[1].replace(/-/g,'').toLowerCase() : null
}
export function canonical(md) {
  if(typeof md!=='string')return null
  return md.replace(/\r\n?/g,'\n').replace(/ discussion-urls="[^"]*"/g,'')
    .split('\n').map(l=>l.replace(/\s+$/,'')).join('\n').trim()
    .replace(/<page\b[^>]*url="([^"]+)"[^>]*>[\s\S]*?<\/page>/g,(m,u)=>`[REF:${pageId(u)||u}]`)
    .replace(/<(?:mention-page|mention)\b[^>]*url="([^"]+)"[^>]*(?:\/>|>[\s\S]*?<\/(?:mention-page|mention)>)/g,(m,u)=>`[REF:${pageId(u)||u}]`)
    .replace(/\[[^\]]*\]\(([^)]+)\)/g,(m,u)=>`[REF:${pageId(u)||u}]`)
}
const same=(a,b)=>typeof a==='string' && typeof b==='string' && canonical(a)===canonical(b)
export const contentHash=md=>typeof md==='string'?createHash('sha256').update(canonical(md)).digest('hex'):null
const table = md => typeof md==='string' ? md.match(/<table[\s\S]*?<\/table>/)?.[0] : null
export const rows = md => (table(md)?.match(/<tr>[\s\S]*?<\/tr>/g)||[]).map(r=>[...r.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m=>m[1].trim()))
const vnum=r=>Number(r?.[0]?.match(/^第\s*(\d+)\s*版$/)?.[1]||0)
const esc=s=>String(s).replace(/</g,'＜').replace(/>/g,'＞').replace(/\n/g,' ')
export function judge(r) {
  const checks=[],ok=(name,pass,detail='')=>checks.push({name,pass:!!pass,detail})
  const B=rows(r.before),A=rows(r.after),M=Math.max(0,...B.map(vnum)),N=M+1,prev=B.findLastIndex(x=>vnum(x)===M && M>0)
  const rowSame=(x,y)=>Array.isArray(x)&&Array.isArray(y)&&x.length===y.length&&x.every((c,i)=>same(c,y[i]))
  const log=r.logs.join('\n'),body=md=>typeof md==='string'?md.replace(/<table[\s\S]*?<\/table>/,'<VERSION_TABLE>'):null
  ok('实际文档可读',typeof r.after==='string')
  ok('版本管理未改动业务正文及附件引用',same(body(r.before),body(r.after)))
  for(const f of r.c.faults) {
    const n=r.stats.faultHits[f.kind]||0
    ok('事故实际触发：'+f.kind,n>0,`实际${n}次`)
    if(f.times!==undefined)ok('事故次数符合配置：'+f.kind,n===f.times,`预期${f.times}，实际${n}`)
  }
  if(r.c.expect==='noTable') {
    ok('版本管理失败',r.result.result==='版本管理失败')
    ok('没有新建表或改写正文',same(r.before,r.after))
    ok('没有建立副本',r.stats.createAttempts===0)
    ok('明确说明版本表缺失',/版本管理表/.test(r.result.problem||''))
  } else if(r.c.expect==='noRetry') {
    ok('版本管理失败',r.result.result==='版本管理失败')
    ok('版本写入只尝试一次',r.stats.versionWrites===1)
    ok('尝试记录异常一次但未写成',r.stats.exceptionWrites===1 && !r.result.tableWritten)
    ok('版本表不变',B.length===A.length&&B.every((x,i)=>rowSame(x,A[i])))
    ok('输出完整失败信息',r.result.step&&r.result.done&&r.result.problem?.includes('403'))
  } else {
    ok('版本表只新增一行',A.length===B.length+1)
    const last=A.at(-1)||[]
    if(r.c.expect==='ok') {
      ok('版本成立',r.result.result==='版本成立',r.result.problem||'')
      ok('新版本编号正确且只出现一次',vnum(last)===N&&A.filter(x=>vnum(x)===N).length===1)
      ok('新行是完整七列',last.length===7)
      ok('当前操作说明正确',same(last[3],esc(r.note)))
      ok('操作人正确',last[2]===r.who)
      const time=last[1]||'',parsed=Date.parse(time.replace(/\//g,'-').replace(' ','T')+':00+08:00')
      ok('时间为本轮实际时间',Number.isFinite(parsed)&&parsed>=r.started-60000&&parsed<=r.finished+60000,time)
      ok('影响位置与运行前独立预期一致',!!r.expectedWhere&&same(last[4],r.expectedWhere),`${last[4]} / ${r.expectedWhere}`)
      ok('新行下一版说明留空',last[5]==='')
      for(let i=0;i<B.length;i++)for(let k=0;k<B[i].length;k++) {
        if(i===prev && k===5)ok('上一版指定格填写正确',same(A[i]?.[k],esc(r.note)))
        else ok(`历史第${i}行第${k+1}列未改`,same(B[i][k],A[i]?.[k]))
      }
      ok('只建立一份副本',r.stats.pagesCreated.length===1)
      ok('独立读回副本父页面正确',r.copy?.parent===r.archive)
      ok('副本链接指向本次副本',r.copy && pageId((last[6]||'').match(/url="([^"]+)"|\]\(([^)]+)\)/)?.slice(1).find(Boolean))===r.copy.id)
      ok('副本标题正确',r.copy?.title===`第${N}版副本｜${r.title}`)
      ok('副本与文档内容一致',r.copy&&same(r.copy.md,r.after))
      ok('副本没有作为子页面挂在业务文档下',!r.copy||!new RegExp(`<page\\b[^>]*url="[^"]*${r.copy.id}[^\"]*"`).test(r.after||''))
    } else {
      ok('版本管理失败而非成立',r.result.result==='版本管理失败')
      ok('末行是异常',last[0]==='异常')
      ok('所有旧行不变',B.every((x,i)=>rowSame(x,A[i])))
      ok('没有新成立版本',!A.some(x=>vnum(x)===N))
      ok('异常行七列及操作人正确',last.length===7&&last[2]===r.who)
      for(const w of r.c.words||[])ok('异常原因包含：'+w,last.slice(3,6).join(' ').includes(w))
      if(r.c.noCopy)ok('没有成功建立副本且异常链接为无',r.stats.pagesCreated.length===0&&last[6]==='无')
      else ok('异常链接指向本次已建副本',r.copy&&pageId((last[6]||'').match(/url="([^"]+)"|\]\(([^)]+)\)/)?.slice(1).find(Boolean))===r.copy.id)
    }
  }
  for(const s of r.c.logHas||[])ok('过程日志：'+s,log.includes(s))
  if(r.c.versionWrites!==undefined)ok('版本行提交次数正确',r.stats.versionWrites===r.c.versionWrites,`${r.stats.versionWrites}`)
  if(r.c.copyWrites!==undefined)ok('不因等价链接重写副本',r.stats.copyWrites===r.c.copyWrites,`${r.stats.copyWrites}`)
  if(r.c.copyFailures)ok('副本不一致次数正确',(log.match(/\[写入并比对副本\] 第\d次 失败：副本与文档不一致/g)||[]).length===r.c.copyFailures)
  if(r.c.noCopy && r.c.expect==='exception')ok('没有换位置建副本',r.stats.pagesCreated.length===0)
  return {pass:checks.length>0&&checks.every(x=>x.pass),checks}
}
