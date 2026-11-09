// Read-only preflight for the test runner. This is not a workspace-wide permission boundary.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { SCENARIOS } from './scenarios.mjs'
const hash = text => createHash('sha256').update(text).digest('hex')
const text = p => (p?.rich_text || p?.title || []).map(x=>x.plain_text ?? x.text?.content ?? '').join('')
const rowName = p => text(p.properties['测试编号'])
export async function preflight(api,S,vt) {
 const rule = await api('GET',`/pages/${S.rules}/markdown`)
 if(rule.truncated || typeof rule.markdown !== 'string') throw new Error('前置规则未能完整读取；未写入')
 const local = readFileSync(new URL('../TESTING_RULES.md',import.meta.url),'utf8').replace(/^# [^\n]+\n\n/,'').trim()
 if(rule.markdown.trim() !== local) throw new Error('Notion前置规则与分支规则不一致；先同步后运行')
 const DS=S.tables.at(-1),schema=await api('GET',`/data_sources/${DS}`)
 for(const name of ['测试编号','测试什么','测试错误','正确结果','首次引入版本','原始样本','结果','执行器版本','运行时间','存在问题','最新输出notion文档','github输出结果','协议']) if(!schema.properties?.[name]) throw new Error('测试总表缺少列：'+name)
 const all=[],latest=[]
 for(const ds of S.tables){
  let cursor
  do{
   const q=await api('POST',`/data_sources/${ds}/query`,{page_size:100,filter:{property:'测试编号',title:{starts_with:vt+'-'}},...(cursor?{start_cursor:cursor}:{})})
   all.push(...q.results);if(ds===DS)latest.push(...q.results);cursor=q.has_more?q.next_cursor:null
  }while(cursor)
 }
 const pending=latest.filter(p=>p.properties['结果'].select?.name==='未跑')
 if(pending.length>1)throw new Error('存在多条未跑记录，需先消除编号歧义')
 const src=pending[0] || latest.sort((a,b)=>Number(rowName(b).split('-')[1])-Number(rowName(a).split('-')[1]))[0]
 if(!src)throw new Error('测试总表没有此项的预先设计，未写入')
 const design = Object.fromEntries(['测试什么','测试错误','正确结果','首次引入版本'].map(key=>[key,text(src.properties[key])]))
 design['协议']=src.properties['协议']?.select?.name
 for(const [key,value] of Object.entries(design))if(!value)throw new Error('运行前测试设计未填写：'+key)
 const c=SCENARIOS[vt]
 if(c){
  const error=vt==='VT39'?'运行中故障：每次写入版本行时都让顶部例行时间保留原值，共3次。普通请求：'+c.note:'正常输入，无故障注入。普通请求：'+c.note
  const expected=vt==='VT39'?'版本管理失败；最多尝试3次，异常行及执行结果写明“顶部时间未按本次操作时间更新”；旧版本行不变，不得宣布版本成立。':'版本成立；影响位置为“'+c.where+'”；旧行除上一版的“下一版操作说明”外不变，副本与最终文档一致。'+(c.checkTime?'顶部例行时间及新版本行时间均为本次操作时间。':'')
  if(design['测试错误']!==error||design['正确结果']!==expected)throw new Error('测试表判据与分支中的冻结预期不同；先同步后运行')
 }
 const raw=src.properties['原始样本']?.url || '', id=raw.split(/[?#]/)[0].replace(/\/+$/,'').replace(/-/g,'').slice(-32)
 if(id!==S[vt].id)throw new Error('原始样本链接与代码配置不一致')
 const ruleHash=hash(rule.markdown)
 console.log('前置核验通过｜规则指纹 '+ruleHash.slice(0,16)+'｜测试 '+vt+'｜提交 '+(process.env.GITHUB_SHA || '本地未提交'))
 return {all,latest,first:pending[0] || null,design}
