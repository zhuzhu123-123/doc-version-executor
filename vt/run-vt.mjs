// Run one test. Fixed samples and historical runs are never overwritten.
// --fake uses memory; --offline CACHE uses read-only exported Markdown; --record writes real results.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { run, notionIo, EXECUTOR_VERSION } from '../executor.mjs'
import { makeFaultyFetch } from './extra-faults.mjs'
import { judge } from './scenario-judge.mjs'
import { CASES, EDITS } from './all-cases.mjs'
import { editPara } from './body.mjs'
import { applyScenario } from './scenarios.mjs'
import { preflight } from './preflight.mjs'
const args = Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]&&!all[i+1].startsWith('--')?all[i+1]:true]:null).filter(Boolean))
if(args.offline)args.fake=true
const cache=args.offline?JSON.parse(readFileSync(args.offline,'utf8')):null
const S={...JSON.parse(readFileSync(new URL('./samples.json',import.meta.url))),...JSON.parse(readFileSync(new URL('./samples-new.json',import.meta.url)))}
const vt=args.case,c=CASES[vt],s=S[vt]
if(!c||!s){console.log('没有这个测试：'+vt);process.exit(2)}
const token=process.env.NOTION_TOKEN
if(!token&&!args.offline)throw new Error('缺少 NOTION_TOKEN，未启动测试')
const realFetch=globalThis.fetch
const hdr={authorization:'Bearer '+token,'content-type':'application/json','notion-version':'2026-03-11'}
const api=async(m,p,b)=>{
 if(cache){const id=p.match(/^\/pages\/([^/]+)\/markdown$/)?.[1]?.replace(/-/g,'');if(!id||!cache[id])throw new Error('离线样本缺失：'+p);return {markdown:cache[id],truncated:false}}
 const r=await realFetch('https:'+'//api.notion.com/v1'+p,{method:m,headers:hdr,body:b?JSON.stringify(b):undefined});const t=await r.text();if(!r.ok)throw new Error(`${m} ${p} ${r.status} ${t.slice(0,200)}`);return JSON.parse(t)
}
function fakeNotion(pages){
 let n=0;const j=(st,o)=>new Response(JSON.stringify(o),{status:st})
 return async(url,init={})=>{
  const p=new URL(url).pathname.replace(/^\/v1/,''),m=(init.method||'GET').toUpperCase(),b=init.body?JSON.parse(init.body):null
  const mm=p.match(/^\/pages\/([^/]+)(\/markdown)?$/)
  if(m==='POST'&&p==='/pages'){const parent=b.parent.page_id.replace(/-/g,'');if(!pages[parent])return j(404,{});const id='f'.repeat(24)+String(++n).padStart(8,'0');pages[id]={title:b.properties.title.title[0].text.content,md:'',parent};return j(200,{id})}
  const pg=mm&&pages[mm[1].replace(/-/g,'')];if(!pg)return j(404,{})
  if(mm[2]&&m==='GET')return j(200,{markdown:pg.md,truncated:false})
  if(mm[2]&&m==='PATCH'){pg.md=b.replace_content.new_str;return j(200,{})}
  if(m==='GET')return j(200,{properties:{title:{type:'title',title:[{plain_text:pg.title}]}}})
  if(m==='PATCH'){pg.title=b.properties.title.title[0].text.content;return j(200,{})}return j(400,{})
 }
}
const E=EDITS[c.edit],note=c.note??E?.note,DS=S.tables.at(-1)
let runNo=vt+'-试跑',first=null,runDesign
if(args.record&&!args.fake){
 const prepared=await preflight(api,S,vt);runDesign=prepared.design
 const nums=prepared.all.map(p=>Number(p.properties['测试编号'].title[0].plain_text.split('-')[1]))
 first=prepared.first
 runNo=first?first.properties['测试编号'].title[0].plain_text:`${vt}-${String(Math.max(0,...nums)+1).padStart(2,'0')}`
}
const title=`${runNo}｜${s.title}`,orig=await api('GET',`/pages/${s.id}/markdown`)
let before=orig.markdown
if(orig.truncated||typeof before!=='string')throw new Error('原始样本不能完整读取，未建工作页')
if(s.sha256&&createHash('sha256').update(before).digest('hex')!==s.sha256)throw new Error('固定原始样本发生变化；未建工作页')
if(args.fake&&args.shift)before=before.replace(/<td>第\s*(\d+)\s*版<\/td>/g,(x,n)=>`<td>第 ${Number(n)+Number(args.shift)} 版</td>`)
if(args.fake&&args.exrow)before=before.replace('</table>','<tr>\n<td>异常</td>\n<td>2026/10/01 10:00</td>\n<td>测试</td>\n<td>上次写入失败</td>\n<td>版本管理表</td>\n<td></td>\n<td>无</td>\n</tr>\n</table>')
if(args.fake&&args.empty){const a=before.indexOf('<table'),b=before.indexOf('</table>'),rows=before.slice(a,b).match(/<tr>[\s\S]*?<\/tr>/g);before=before.slice(0,a)+before.slice(a,b).replace(/<tr>[\s\S]*?<\/tr>\s*/g,r=>r.startsWith(rows[0])?r:'')+before.slice(b)}
before=c.scenario?applyScenario(before,c.scenario):editPara(before,E.para,l=>l+E.add)
const childTitle=c.childPage?((before.match(/^<page url="[^"]*">([^<]*)<\/page>/m)||[])[1]||'附件：计算表'):null
before=before.split('\n').filter(l=>!l.startsWith('<page url=')).join('\n')
let base=realFetch,docId
if(args.fake){
 docId='e'.repeat(32)
 const pages={[S.runs]:{title:'测试文档',md:'',parent:'home'},[docId]:{title,md:before,parent:S.runs},[S.archive]:{title:'存档',md:'',parent:'home'}}
 for(const cp of s.copies)pages[cp]={title:'copy',md:(await api('GET',`/pages/${cp}/markdown`)).markdown,parent:S.archive}
 if(c.childPage){const cid='d'.repeat(32);pages[cid]={title:childTitle,md:'',parent:docId};pages[docId].md=before=before+'\n<page url="https:'+'//www.'+'notion.so/'+cid+'">'+childTitle+'</page>'}
 base=fakeNotion(pages)
}else{
 docId=(await api('POST','/pages',{parent:{page_id:S.runs},properties:{title:{title:[{text:{content:title}}]}}})).id.replace(/-/g,'')
 await api('PATCH',`/pages/${docId}/markdown`,{type:'replace_content',replace_content:{new_str:before}})
 if(c.childPage)await api('POST','/pages',{parent:{page_id:docId},properties:{title:{title:[{text:{content:childTitle}}]}}})
 before=(await api('GET',`/pages/${docId}/markdown`)).markdown
}
const rowsBefore=(before.slice(before.indexOf('<table'),before.indexOf('</table>')).match(/<tr>/g)||[]).length
const ctx={doc:docId,archive:S.archive,rowsBefore,otherPage:'121ed3ae2bb349d7b092ed95b3b17f0c'}
globalThis.fetch=makeFaultyFetch(c.faults,ctx,base)
const logs=[],code=readFileSync(new URL('../executor.mjs',import.meta.url)),codeHash=createHash('sha256').update(code).digest('hex'),t0=new Date()
const expectedTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(t0).replace(/-/g,'/')
let result;const io=notionIo(token);io.now=()=>t0
try{result=await run({doc:docId,archive:S.archive,note,who:'测试运行'},io,l=>{logs.push(l);console.log('  '+l)})}finally{globalThis.fetch=realFetch}
const read=async id=>{const r=await base('https:'+'//api.notion.com/v1/pages/'+id+'/markdown',{headers:hdr});return r.ok?JSON.parse(await r.text()).markdown:null}
const readTitle=async id=>{const r=await base('https:'+'//api.notion.com/v1/pages/'+id,{headers:hdr});if(!r.ok)return null;const p=JSON.parse(await r.text());return Object.values(p.properties).find(x=>x.type==='title').title.map(x=>x.plain_text).join('')}
const after=await read(docId),cid=ctx.copyId
const copy=cid?{id:cid,md:await read(cid),title:await readTitle(cid),parent:ctx.stats.pagesCreated.find(x=>x.id===cid)?.parent}:null
const verdict=judge({c,note,title,before,after,copy,result,logs,stats:ctx.stats,archive:S.archive,expectedTime,faultLog:ctx.faultLog,truncatedOnRead:orig.truncated})
console.log(`\n${vt}｜执行器 ${EXECUTOR_VERSION}｜代码哈希 ${codeHash.slice(0,16)}｜${args.fake?'试跑（假 Notion）':'真实 Notion'}`)
console.log('制造的错误：'+(ctx.faultLog.join('；')||'无'))
for(const k of verdict.checks)console.log(`${k.pass?'✔':'✘'} ${k.name}${k.pass||!k.detail?'':'（'+k.detail+'）'}`)
console.log(`判定：${verdict.pass?'通过':'失败'}`)
if(args.record&&!args.fake){
 const fail=verdict.checks.filter(k=>!k.pass).map(k=>k.name).join('；')
 const props={
  '结果':{select:{name:verdict.pass?'通过':'失败'}},'运行时间':{date:{start:t0.toISOString()}},
  '执行器版本':{rich_text:[{text:{content:`${EXECUTOR_VERSION}｜${codeHash.slice(0,16)}${process.env.GITHUB_SHA?'｜'+process.env.GITHUB_SHA.slice(0,7):''}`}}]},
  '存在问题':{rich_text:[{text:{content:fail.slice(0,1900)}}]},
  '最新输出notion文档':{url:'https:'+'//www.'+'notion.so/'+docId},'原始样本':{url:'https:'+'//www.'+'notion.so/'+s.id},
  ...(process.env.RUN_URL?{'github输出结果':{url:process.env.RUN_URL}}:{})
 }
 if(first)await api('PATCH',`/pages/${first.id}`,{properties:props})
 else{
  const info={};for(const k of ['测试错误','测试什么','正确结果','首次引入版本'])info[k]={rich_text:[{text:{content:runDesign[k]}}]}
  info['协议']={select:{name:runDesign['协议']}}
  await api('POST','/pages',{parent:{data_source_id:DS},properties:{'测试编号':{title:[{text:{content:runNo}}]},...info,...props}})
 }
}
process.exit(verdict.pass?0:1)
