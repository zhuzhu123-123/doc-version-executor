// 本次修复的离线回归检查；不调用真实Notion，不写测试总表，不改变VT01～VT23。
// node vt/change-tests.mjs [--executor /path/to/executor.mjs]
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const arg = process.argv.indexOf('--executor')
const { changedPlaces, run } = await import(arg < 0 ? new URL('../executor.mjs', import.meta.url) : pathToFileURL(resolve(process.argv[arg + 1])))
const row = (a) => '<tr>\n' + a.map((x) => `<td>${x}</td>`).join('\n') + '\n</tr>'
const table = '<table>\n' + row(['版本','当前版本操作时间','当前版本操作人','当前版本操作说明','当前版本影响位置','下一版操作说明','文档副本存档链接']) + '\n</table>'
const doc = ({time='2026/11/03 10:00', intro='引言原文', tail='表后说明', body='## 第一章\n章节一正文\n\n## 第二章\n章节二正文'} = {}) => `${time}\n\n${intro}\n\n${table}\n\n${tail}\n\n${body}\n`
const expectPlaces = (a,b,v) => assert.equal(changedPlaces(a,b), v)
const tests = []
const add = (id,name,fn) => tests.push({id,name,fn})
add('C01','纯章节改名不是删除加新增',()=>expectPlaces(doc(),doc({body:'## 第一章新名\n章节一正文\n\n## 第二章\n章节二正文'}),'章节改名：第一章 → 第一章新名；版本管理表'))
add('C02','版本表前引言变更',()=>expectPlaces(doc(),doc({intro:'引言已更新'}),'文档引言；版本管理表'))
add('C03','版本表后到首章之间变更',()=>expectPlaces(doc(),doc({tail:'表后说明已更新'}),'文档引言；版本管理表'))
add('C04','仅例行时间变化不写入影响位置',()=>expectPlaces(doc(),doc({time:'2026/11/05 20:00'}),'版本管理表'))
add('C05','时间同一行的引言变化不被屏蔽',()=>expectPlaces(doc({time:'2026/11/03 10:00 原说明'}),doc({time:'2026/11/05 20:00 新说明'}),'文档引言；版本管理表'))
add('C06','正文重复时不猜测改名',()=>{
 const a=doc({body:'## 旧甲\n相同正文\n## 旧乙\n相同正文'}),b=doc({body:'## 新甲\n相同正文\n## 新乙\n相同正文'})
 assert.equal(changedPlaces(a,b),'新增：新甲；新增：新乙；删除：旧甲；删除：旧乙；版本管理表')
})
add('C07','真实新增章节',()=>expectPlaces(doc(),doc({body:'## 第一章\n章节一正文\n\n## 第二章\n章节二正文\n\n## 第三章\n独立新增正文'}),'新增：第三章；版本管理表'))
add('C08','真实删除章节',()=>expectPlaces(doc(),doc({body:'## 第一章\n章节一正文'}),'删除：第二章；版本管理表'))
add('C09','重复标题不覆盖前面的章节',()=>expectPlaces(doc({body:'## 同名\n甲正文\n## 同名\n乙正文'}),doc({body:'## 同名\n甲正文修改\n## 同名\n乙正文'}),'同名（第1处）；版本管理表'))
add('C10','代码围栏里的二级标题不是章节',()=>expectPlaces(doc({body:'## 第一章\n```md\n## 假标题甲\n```'}),doc({body:'## 第一章\n```md\n## 假标题乙\n```'}),'第一章；版本管理表'))
add('C11','章节顺序变化',()=>expectPlaces(doc(),doc({body:'## 第二章\n章节二正文\n\n## 第一章\n章节一正文'}),'章节顺序；版本管理表'))
add('C12','没有二级标题时仍覆盖表后内容',()=>expectPlaces(doc({body:'无章节的正文'}),doc({body:'无章节的正文修改'}),'文档引言；版本管理表'))
function memoryIo(initial,{stripTime=false}={}) {
 const pages={document:initial},titles={document:'离线检查文档'}
 let n=0
 return {pages,titles,io:{
  now:()=>new Date('2026-11-05T12:07:00Z'),
  getMd:async(id)=>{assert.ok(id in pages);return pages[id]},
  putMd:async(id,md)=>{pages[id]=stripTime && id==='document' ? md.replace('2026/11/05 20:07','2026/11/03 10:00') : md},
  getTitle:async(id)=>titles[id],setTitle:async(id,t)=>{titles[id]=t},
  createPage:async(parent,t)=>{assert.equal(parent,'archive');const id=(++n).toString(16).padStart(32,'0');pages[id]='';titles[id]=t;return id},
 }}
}
const perform=async(m)=>run({doc:'document',archive:'archive',note:'修改已确认的引言内容。',who:'离线测试'},m.io,()=>{})
add('C13','正式流程实际更新时间且副本含完整版本表与正文',async()=>{
 const m=memoryIo(doc()),r=await perform(m)
 assert.equal(r.result,'版本成立');assert.ok(m.pages.document.startsWith('2026/11/05 20:07'))
 assert.equal(m.pages[r.copyId],m.pages.document);assert.match(m.pages.document,/<td>第 1 版<\/td>/)
})
add('C14','业务日期变化不能当作例行时间排除',()=>expectPlaces(doc({intro:'业务日期2026/10/01'}),doc({intro:'业务日期2026/10/02'}),'文档引言；版本管理表'))
add('C15','未修改正文时只记版本表',()=>expectPlaces(doc(),doc(),'版本管理表'))
add('C16','顶部时间没有写成功时不得宣布版本成立',async()=>{
 const m=memoryIo(doc(),{stripTime:true}),r=await perform(m)
 assert.equal(r.result,'版本管理失败');assert.match(r.problem,/顶部时间/)
})
let failed=0
for(const t of tests){try{await t.fn();console.log(`${t.id} 通过｜${t.name}`)}catch(e){failed++;console.log(`${t.id} 失败｜${t.name}\n${e.message}`)}}
console.log(`修复检查：${tests.length-failed}/${tests.length}通过；${failed}项失败。仅为离线检查，不代表真实Notion或GitHub运行验收。`)
process.exitCode=failed?1:0
