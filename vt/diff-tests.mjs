// 独立写死预期，不调用执行器的 canon/parseTable 来构造预期。
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const mod = process.env.EXECUTOR_MODULE ? pathToFileURL(process.env.EXECUTOR_MODULE).href : new URL('../executor.mjs', import.meta.url).href
const { changedPlaces, refreshUpdatedTime } = await import(mod)
const table = '<table>\n<tr><td>版本</td></tr>\n</table>'
const base = `最后更新时间：2026/10/01 10:00\n\n引言A\n\n${table}\n\n表后引言A\n\n## 第一章\n第一章内容。\n\n## 第二章\n第二章内容。`
const tests = [
 ['DF01', '纯章节更名不是删增', () => assert.equal(changedPlaces(base,base.replace('## 第一章','## 新第一章')),'章节更名：第一章 → 新第一章；版本管理表')],
 ['DF02', '表前引言不漏检', () => assert.equal(changedPlaces(base,base.replace('引言A','引言B')),'顶部引言；版本管理表')],
 ['DF03', '表后到首章的引言不漏检', () => assert.equal(changedPlaces(base,base.replace('表后引言A','表后引言B')),'顶部引言；版本管理表')],
 ['DF04', '例行时间不算实质变更', () => assert.equal(changedPlaces(base,base.replace('2026/10/01 10:00','2026/11/05 11:00')),'版本管理表')],
 ['DF05', '时间同行的实质文字仍要比较', () => assert.equal(changedPlaces(base.replace('10:00','10:00 引言A'),base.replace('10:00','11:00 引言B')),'顶部引言；版本管理表')],
 ['DF06', '更名同时改正文不假定删增', () => assert.match(changedPlaces(base,base.replace('## 第一章','## 新第一章').replace('第一章内容。','新的内容。')),/章节对应待核对：第一章 → 新第一章/)],
 ['DF07', '真实新增章节', () => assert.equal(changedPlaces(base,base+'\n\n## 第三章\n新增内容。'),'新增：第三章；版本管理表')],
 ['DF08', '真实删除章节', () => assert.equal(changedPlaces(base,base.replace('\n\n## 第二章\n第二章内容。','')),'删除：第二章；版本管理表')],
 ['DF09', '重名章节不能被覆盖', () => {const p=base+'\n\n## 第一章\n重复章节内容。'; assert.equal(changedPlaces(p,p.replace('第一章内容。','第一章修改。')),'第一章；版本管理表')}],
 ['DF10', '代码围栏中的标题不分章', () => {const p=base+'\n\n```md\n## 不是章节\n示例A\n```'; assert.equal(changedPlaces(p,p.replace('示例A','示例B')),'第二章；版本管理表')}],
 ['DF11', '章节重排须报告', () => {const p='## A\na\n\n## B\nb'; assert.equal(changedPlaces(p,'## B\nb\n\n## A\na'),'章节顺序；版本管理表')}],
 ['DF12', '没有二级标题也覆盖全文', () => assert.equal(changedPlaces('引言A','引言B'),'顶部引言；版本管理表')],
 ['DF13', '顶部时间实际更新且保留同行文字', () => assert.equal(refreshUpdatedTime('最后更新时间：2026/10/01 10:00 保留文字\n## 章节\n更新时间：2026/10/01 10:00','2026/11/05 11:00'),'最后更新时间：2026/11/05 11:00 保留文字\n## 章节\n更新时间：2026/10/01 10:00')],
 ['DF14', '业务日期不是例行时间', () => assert.equal(changedPlaces('合同日期：2026/10/01','合同日期：2026/10/02'),'顶部引言；版本管理表')],
 ['DF15', '正文无变化只列版本表', () => assert.equal(changedPlaces(base,base),'版本管理表')],
]
let failed=0
for (const [id,name,fn] of tests) {try {fn();console.log(`${id} 通过 ${name}`)} catch(e) {failed++;console.log(`${id} 失败 ${name}：${e.message}`)}}
console.log(`差异回归：${tests.length-failed}/${tests.length}`)
process.exit(failed?1:0)
