// 仅在本地副本中改坏执行器；使用随包固定样本，完全不访问Notion、不需要密钥、不登记总表。
// 下面是运行前写定的预测，尚未执行时不得声称“已对得上”。
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { CASES } from './cases.mjs'
const root=new URL('../',import.meta.url),source=readFileSync(new URL('../executor.mjs',import.meta.url),'utf8')
const all=Object.keys(CASES)
const mutants=[
 {name:'新编号不加一',from:'const N = prevN + 1',to:'const N = prevN',expected:['VT01','VT02','VT03','VT04','VT05','VT07','VT08','VT09','VT10','VT12','VT14','VT18','VT19','VT21','VT22']},
 {name:'不检查历史行',from:'for (let k = 0; k < expRows.length; k++) if (!rowsEqual(t.rows[k], expRows[k]))',to:'for (let k = 0; k < expRows.length; k++) if (false)',expected:['VT04','VT19']},
 {name:'不检查副本一致性',from:'if (hDoc !== hCopy) throw',to:'if (false) throw',expected:['VT07','VT08','VT09','VT11','VT18']},
 {name:'不填上一版指定格',from:'(i === prevIdx ? makeRow(cellsOf(r).map((c, k) => (k === 5 ? esc(note) : c))) : r)',to:'r',expected:['VT01','VT02','VT04','VT05','VT07','VT08','VT09','VT10','VT12','VT14','VT18','VT19','VT21','VT22']},
 {name:'不检查新版本编号',from:'if (c[0] !== `第 ${N} 版`) {',to:'if (false) {',expected:['VT01','VT02','VT03','VT18']},
 {name:'不检查副本标题',from:'if (got !== copyTitle) {',to:'if (false) {',expected:['VT10']},
 {name:'只尝试一次',from:'const MAX = 3',to:'const MAX = 1',expected:['VT01','VT02','VT03','VT04','VT05','VT07','VT08','VT09','VT10','VT11','VT12','VT13','VT16','VT18','VT19']}
]
function evaluate(code) {
 const dir=mkdtempSync(join(tmpdir(),'v41-mut-'))
 try {
  writeFileSync(join(dir,'executor.mjs'),code);cpSync(new URL('./',import.meta.url),join(dir,'vt'),{recursive:true})
  const failed=[],errors=[]
  for(const vt of all) {
   const result=spawnSync(process.execPath,[join(dir,'vt/run-vt.mjs'),'--case',vt,'--fake'],{encoding:'utf8',env:{PATH:process.env.PATH},maxBuffer:16*1024*1024,timeout:30000})
   if(result.error||!/(判定：通过|判定：失败)/.test((result.stdout||'')+(result.stderr||''))) errors.push({vt,error:result.error?.message||result.stderr||'没有可核对的判定输出'})
   if(result.status!==0)failed.push(vt)
  }
  return {failed,errors}
 }finally{rmSync(dir,{recursive:true,force:true})}
}
const report={baseline:evaluate(source),mutants:[]}
let pass=report.baseline.failed.length===0&&report.baseline.errors.length===0
if(pass)for(const m of mutants) {
 if(source.split(m.from).length!==2)throw new Error('变异锚点不是唯一：'+m.name)
 const actual=evaluate(source.replace(m.from,m.to)),matches=actual.errors.length===0&&JSON.stringify(actual.failed.slice().sort())===JSON.stringify(m.expected.slice().sort())
 report.mutants.push({name:m.name,expected:m.expected,actual,matches});if(!matches)pass=false
}
report.pass=pass
mkdirSync(new URL('../results/',import.meta.url),{recursive:true});writeFileSync(new URL('../results/mutations.json',import.meta.url),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2));process.exitCode=pass?0:1
