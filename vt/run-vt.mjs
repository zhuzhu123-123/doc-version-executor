// 唯一运行入口：准备输入、安装故障、调用执行器、独立读回判定、登记对应版本总表。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { run, notionIo, EXECUTOR_VERSION } from '../executor.mjs'
import { CASES, EDITS } from './cases.mjs'
import { makeFaultyIo } from './faults.mjs'
import { editPara, paragraphHeading } from './body.mjs'
import { judge, rows, contentHash, pageId } from './judge.mjs'
const load=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'))
const S=load('./samples.json'),DESIGN=load('./design.json'),FIXTURES=load('./fixtures.json')
const hash=createHash('sha256').update(readFileSync(new URL('../executor.mjs',import.meta.url))).digest('hex')
const str=v=>(v||[]).map(x=>x.plain_text??x.text?.content??'').join('')
const rich=text=>({rich_text:[{text:{content:String(text)}}]})
const no=page=>str(page.properties['测试编号']?.title)
function fakeIo(initial) {
  const pages=new Map(Object.entries(initial));let count=0
  const get=p=>{if(!pages.has(p))throw new Error('假Notion没有此页面：'+p);return pages.get(p)}
  return {
    async getMd(p){return get(p).md},async getTitle(p){return get(p).title},async getParent(p){return get(p).parent},
    async putMd(p,md){get(p).md=md},async setTitle(p,title){get(p).title=title},
    async createPage(parent,title){get(parent);const id='f'.repeat(24)+String(++count).padStart(8,'0');pages.set(id,{title,md:'',parent});return id},
    now:()=>new Date(),
  }
}
const parseArgs=argv=>{
  const out={}
  for(let i=0;i<argv.length;i++) {
    const a=argv[i];if(!['--case','--table','--fake','--record'].includes(a))throw new Error('不支持的参数：'+a)
    if(a==='--fake'||a==='--record')out[a.slice(2)]=true
    else {const value=argv[++i];if(!value||value.startsWith('--'))throw new Error(a+'缺少值');out[a.slice(2)]=value}
  }
  return out
}
export async function runCase(vt,opts={}) {
  const c=CASES[vt],s=S[vt],design=DESIGN[vt],fixture=FIXTURES[vt]
  if(!c||!s||!design||!fixture)throw new Error('不存在或已停用的测试：'+vt+'；VT23不再执行，编号保留')
  if(opts.fake&&opts.record)throw new Error('假Notion检查不能登记真实测试表')
  const selected=opts.table&&opts.table!=='auto'?opts.table:EXECUTOR_VERSION
  const target=S.tables[EXECUTOR_VERSION]
  if(selected!==EXECUTOR_VERSION||!target)throw new Error('目标表与实际代码版本不匹配；不会默认选最新表')
  if(!opts.fake && S.approvedExecutorHashes[EXECUTOR_VERSION]!==hash)throw new Error('实际执行器完整指纹未获配置批准')
  if(!opts.fake&&!opts.record)throw new Error('真实Notion运行必须明确指定--record；不允许无记录写入')
  const token=process.env.NOTION_TOKEN
  if(!opts.fake&&!token)throw new Error('缺少Notion集成密钥')
  if(opts.record&&(!process.env.GITHUB_ACTIONS||!process.env.RUN_URL))throw new Error('真实登记仅允许用户在GitHub Actions启动')
  const headers={authorization:'Bearer '+token,'content-type':'application/json','notion-version':'2026-03-11'}
  const api=async(method,path,data)=>{
    const response=await fetch('https://'+'api.notion.com/v1'+path,{method,headers,body:data?JSON.stringify(data):undefined})
    const text=await response.text();if(!response.ok)throw new Error(`Notion ${response.status} ${method} ${path}：${text.slice(0,180)}`)
    return JSON.parse(text)
  }
  const query=async(ds,filter)=>{
    const out=[];let cursor
    do{const p=await api('POST',`/data_sources/${ds}/query`,{page_size:100,filter,...(cursor?{start_cursor:cursor}:{})});out.push(...p.results);cursor=p.has_more?p.next_cursor:null;if(p.has_more&&!cursor)throw new Error('历史分页不完整，停止编号计算')}while(cursor)
    return out
  }
  let first=null,runNo=vt+'-试跑'
  if(opts.record) {
    // All configuration and destination checks occur BEFORE any page creation.
    const schema=(await api('GET',`/data_sources/${target.id}`)).properties
    const required={'测试编号':'title','测试什么':'rich_text','测试错误':'rich_text','正确结果':'rich_text','结果':'select','首次引入版本':'rich_text','协议':'select','执行器版本':'rich_text','运行时间':'date','原始样本':'url','存在问题':'rich_text',[target.docColumn]:'url',[target.runColumn]:'url'}
    for(const [k,type]of Object.entries(required))if(schema[k]?.type!==type)throw new Error('目标总表缺列或列类型错误：'+k)
    const all=[];const filter={property:'测试编号',title:{starts_with:vt+'-'}}
    for(const ds of [...new Set(S.historyTables)])all.push(...await query(ds,filter))
    const current=all.filter(p=>p.parent?.data_source_id?.replace(/-/g,'')===target.id)
    const used=all.filter(p=>p.properties['结果']?.select?.name!=='未跑').map(p=>Number(no(p).split('-')[1])).filter(Number.isFinite)
    const max=Math.max(S.runNumberFloor?.[vt]||0,0,...used)
    runNo=vt+'-'+String(max+1).padStart(2,'0')
    const pending=current.filter(p=>p.properties['结果']?.select?.name==='未跑')
    if(pending.length>1)throw new Error('同一测试有多条待跑设计，请先核对，不能随便取第一条')
    if(pending.length) {
      first=pending[0]
      if(no(first)!==runNo)throw new Error(`待跑编号${no(first)}与实际接续编号${runNo}不同，请更新待跑设计后再运行`)
      for(const k of ['测试什么','测试错误','正确结果','首次引入版本'])if(str(first.properties[k]?.rich_text)!==design[k])throw new Error('总表与本轮代码的设计不一致：'+k)
      if(pageId(first.properties['原始样本']?.url)!==s.id)throw new Error('总表原始样本与配置不一致')
    }
    console.log(`执行器 ${EXECUTOR_VERSION}｜目标总表 ${selected}｜完整指纹 ${hash}｜本次编号 ${runNo}`)
  }
  let base,sourceMd
  if(opts.fake) {
    sourceMd=fixture.md
    const initial={[S.archive]:{title:'版本副本存档',md:'',parent:null},[S.runs]:{title:'测试文档',md:'',parent:null}}
    for(const [id,md]of Object.entries(fixture.copies))initial[id]={title:'历史副本',md,parent:S.archive}
    base=fakeIo(initial)
  } else {
    base={...notionIo(token),getParent:async id=>{const p=await api('GET',`/pages/${id}`);return p.parent?.page_id?.replace(/-/g,'')||null}};sourceMd=await base.getMd(s.id)
    if(contentHash(sourceMd)!==contentHash(fixture.md))throw new Error('固定原始样本与交付基准不同；尚未新建测试文档，请先核对样本')
    for(const [id,md]of Object.entries(fixture.copies))if(contentHash(await base.getMd(id))!==contentHash(md))throw new Error('固定历史副本与交付基准不同：'+id)
  }
  const E=EDITS[c.edit],note=c.note??E.note,who='测试运行'
  const heading=paragraphHeading(sourceMd,E.para)
  const expectedWhere=heading?heading+'；版本管理表':null
  if(c.expect==='ok'&&!expectedWhere)throw new Error('无法独立确定本次修改的影响章节，停止，不猜答案')
  const changed=editPara(sourceMd,E.para,line=>line+E.add)
  // Business child references in samples become plain links in the NEW test document, never move original children.
  const prepared=changed.replace(/<page\b[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/page>/g,(m,u)=>`<mention-page url="${u}"/>`)
  const title=s.title.split('｜')[0]+'｜'+randomBytes(3).toString('hex').toUpperCase()
  const doc=await base.createPage(S.runs,title);await base.putMd(doc,prepared)
  const before=await base.getMd(doc)
  const ctx={doc,archive:S.archive,rowsBefore:rows(before).length}
  const io=makeFaultyIo(c.faults,ctx,base),logs=[],started=Date.now()
  let result
  try{result=await run({doc,archive:S.archive,note,who},io,l=>{logs.push(l);console.log(l)})}
  catch(error){result={result:'版本管理失败',step:'未捕获异常',done:'见运行日志',problem:error.message,tableWritten:false}}
  const after=await base.getMd(doc),copy=ctx.copyId?{id:ctx.copyId,md:await base.getMd(ctx.copyId),title:await base.getTitle(ctx.copyId),parent:await base.getParent(ctx.copyId)}:null
  const finished=Date.now(),verdict=judge({c,note,who,title,before,after,copy,result,logs,stats:ctx.stats,archive:S.archive,expectedWhere,started,finished})
  const evidence={vt,runNo,mode:opts.fake?'memory-only':'real-notion',executorVersion:EXECUTOR_VERSION,executorHash:hash,commit:process.env.GITHUB_SHA||null,tableVersion:selected,result,verdict,faults:ctx.faultLog,stats:ctx.stats,docId:opts.fake?null:doc,copyId:opts.fake?null:ctx.copyId,started:new Date(started).toISOString()}
  mkdirSync(new URL('../results/',import.meta.url),{recursive:true})
  const artifact=new URL('../results/'+runNo+'.json',import.meta.url)
  writeFileSync(artifact,JSON.stringify(evidence,null,2))
  for(const k of verdict.checks)console.log(`${k.pass?'✔':'✘'} ${k.name}${k.detail?'：'+k.detail:''}`)
  console.log('判定：'+(verdict.pass?'通过':'失败'))
  if(opts.record) {
    const properties={}
    for(const k of ['测试什么','测试错误','正确结果','首次引入版本'])properties[k]=rich(design[k])
    Object.assign(properties,{'协议':{select:{name:design['协议']}},'结果':{select:{name:verdict.pass?'通过':'失败'}},'执行器版本':rich(`${EXECUTOR_VERSION}｜${hash.slice(0,16)}｜${(process.env.GITHUB_SHA||'').slice(0,7)}`),'运行时间':{date:{start:new Date(started).toISOString()}},'原始样本':{url:'https://'+'www.notion.so/'+s.id},[target.docColumn]:{url:'https://'+'www.notion.so/'+doc},[target.runColumn]:{url:process.env.RUN_URL},'存在问题':rich(verdict.pass?'':verdict.checks.filter(x=>!x.pass).map(x=>x.name+(x.detail?'：'+x.detail:'')).join('；').slice(0,1900))})
    try {
      if(first)await api('PATCH',`/pages/${first.id}`,{properties})
      else await api('POST','/pages',{parent:{data_source_id:target.id},properties:{...properties,'测试编号':{title:[{text:{content:runNo}}]}}})
      evidence.recorded=true;writeFileSync(artifact,JSON.stringify(evidence,null,2))
    } catch(error) {evidence.recorded=false;evidence.recordingError=error.message;writeFileSync(artifact,JSON.stringify(evidence,null,2));throw new Error('实际运行已结束，但登记失败；不要直接重跑。先依据结果附件补记本次运行：'+error.message)}
  }
  return evidence
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try{const args=parseArgs(process.argv.slice(2));if(!args.case)throw new Error('必须指定--case');const out=await runCase(args.case,args);process.exitCode=out.verdict.pass?0:1}
  catch(error){console.error('运行未完成：'+error.message);process.exitCode=2}
}
