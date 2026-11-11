// 故障夹在执行器与底层读写之间；执行器只接收普通io，不接收测试编号、答案或本文件配置。
import { StopError, RetryableError } from '../executor.mjs'
import { editPara, paraLines } from './body.mjs'
const rs = md => (md.match(/<table[\s\S]*?<\/table>/)?.[0].match(/<tr>[\s\S]*?<\/tr>/g) || [])
const cells = row => [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m=>m[1])
const version = row => Number(cells(row)[0]?.match(/第\s*(\d+)\s*版/)?.[1] || 0)
function changeRows(md,fn) {
  const old = rs(md), values = old.map(cells); fn(values)
  let i = 0
  return md.replace(/<table[\s\S]*?<\/table>/,t=>t.replace(/<tr>[\s\S]*?<\/tr>/g,()=>'<tr>\n'+values[i++].map(c=>`<td>${c}</td>`).join('\n')+'\n</tr>'))
}
const id = u => u.split(/[?#]/)[0].replace(/\/$/,'').replace(/-/g,'').slice(-32)
function firstLink(md,mode) {
  let done = false
  const replace = u => {
    const n=id(u); if (!/^[0-9a-f]{32}$/i.test(n)) return u
    done=true
    if(mode==='other')return 'https://www.notion.so/121ed3ae2bb349d7b092ed95b3b17f0c'
    if(mode==='dated')return `https://www.notion.so/记录-2026-08-09-${n}`
    return 'https://www.notion.so/'+n.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5')
  }
  let out=md.replace(/(<(?:mention-page|mention)\b[^>]*url=")([^"]+)(")/g,(m,a,u,b)=>done?m:a+replace(u)+b)
  if(!done) out=out.replace(/(\]\()([^)]+)(\))/g,(m,a,u,b)=>done?m:a+replace(u)+b)
  if(!done || out===md)throw new Error('事故未实际制造：没有匹配的可替换页面链接')
  return out
}
function typo(md) {
  const lines=md.split('\n')
  for(const i of paraLines(md))if(!/[<]|\]\(/.test(lines[i]) && /\d/.test(lines[i])) {
    lines[i]=lines[i].replace(/\d/,d=>String((Number(d)+1)%10));return lines.join('\n')
  }
  throw new Error('事故未实际制造：没有符合条件的数字段落')
}
function dropMany(md) {
  const e=md.indexOf('</table>')+8, lines=md.slice(e).split('\n');let n=0
  return md.slice(0,e)+lines.filter(l=>!l.trim() || ![5,10,15,20].includes(++n)).join('\n')
}
export function makeFaultyIo(plan,ctx,base) {
  const probes={}, stats=ctx.stats={versionWrites:0,exceptionWrites:0,copyWrites:0,createAttempts:0,pagesCreated:[],faultHits:{},events:[]}
  ctx.copyId=null;ctx.faultLog=[]
  const take=kind=>{
    const f=plan.find(x=>x.kind===kind);if(!f)return false
    const n=(probes[kind]=(probes[kind]||0)+1)-(f.skip||0)
    return n>0 && (f.times===undefined || n<=f.times)
  }
  const hit=(kind,detail)=>{stats.faultHits[kind]=(stats.faultHits[kind]||0)+1;ctx.faultLog.push({kind,detail})}
  const mutate=(md,kind,fn)=>{const out=fn(md);if(out===md)throw new Error('事故未实际制造：'+kind);hit(kind,'正文或记录内容实际改变');return out}
  return {
    ...base,
    async createPage(parent,title) {
      stats.createAttempts++
      if(parent!==ctx.archive)throw new Error('测试工具发现执行器尝试在非指定父页面建副本')
      if(take('archiveUnavailable')){hit('archiveUnavailable','指定存档父页面下建页返回404');throw new StopError('指定版本副本存档父页面不可用（404）')}
      if(take('copyTitleWrong')){hit('copyTitleWrong','首次建页标题被截短');title=title.split('｜')[0]}
      const n=await base.createPage(parent,title);ctx.copyId=n;stats.pagesCreated.push({id:n,parent});return n
    },
    async setTitle(page,title) {
      if(page===ctx.copyId && take('copyTitleWrong')){hit('copyTitleWrong','首次修改标题仍被截短');title=title.split('｜')[0]}
      return base.setTitle(page,title)
    },
    async getMd(page) {
      if(page===ctx.copyId) {
        if(take('copyReadError')){hit('copyReadError','读回副本模拟网络错误');throw new RetryableError('模拟网络错误')}
        if(take('copyUnverifiable')){hit('copyUnverifiable','读回副本返回null正文');return null}
        let md=await base.getMd(page)
        if(take('copyAltLink'))md=mutate(md,'copyAltLink',x=>firstLink(x,'alt'))
        if(take('copyDatedLink'))md=mutate(md,'copyDatedLink',x=>firstLink(x,'dated'))
        return md
      }
      return base.getMd(page)
    },
    async putMd(page,md) {
      const rows=rs(md), ver=page===ctx.doc && rows.length===ctx.rowsBefore+1 && version(rows.at(-1))>0
      const exc=page===ctx.doc && cells(rows.at(-1)||'')[0]?.trim()==='异常'
      stats.events.push({operation:'putMd',page,kind:ver?'version':exc?'exception':page===ctx.copyId?'copy':'other'})
      if(ver)stats.versionWrites++;if(exc)stats.exceptionWrites++
      if((ver||exc) && take('noPermission')){hit('noPermission','写入文档返回403');throw new StopError('没有修改权限（403）')}
      if(ver) {
        if(take('dupVersion'))md=mutate(md,'dupVersion',x=>changeRows(x,v=>{v.at(-1)[0]=`第 ${Math.max(0,...rs(x).slice(0,-1).map(version))} 版`}))
        if(take('prevNoteBlank'))md=mutate(md,'prevNoteBlank',x=>changeRows(x,v=>{v[v.length-2][5]=''}))
        if(take('newNoteFilled'))md=mutate(md,'newNoteFilled',x=>changeRows(x,v=>{v.at(-1)[5]=v.at(-1)[3]}))
        if(take('editRow1'))md=mutate(md,'editRow1',x=>changeRows(x,v=>{v[1][3]+='并校对了全文术语。'}))
        await base.putMd(page,md)
        if(take('timeoutAfterWrite')){hit('timeoutAfterWrite','底层写入成功后向执行器返回超时');throw new RetryableError('模拟写入成功后超时')}
        return
      }
      if(page===ctx.copyId && md.trim()) {
        stats.copyWrites++
        if(take('copyDropPara'))md=mutate(md,'copyDropPara',x=>editPara(x,4,()=>null))
        else if(take('copyDropMany'))md=mutate(md,'copyDropMany',dropMany)
        else if(take('copyTypo'))md=mutate(md,'copyTypo',typo)
        else if(take('copyMixed'))md=mutate(md,'copyMixed',x=>firstLink(typo(editPara(x,4,()=>null)),'other'))
      }
      return base.putMd(page,md)
    }
  }
}
