// Independent assertions; deliberately does not import the executor.
import { judge as original } from './judge.mjs'
export function judge(r){
 const verdict=original(r),checks=[...verdict.checks],c=r.c
 const check=(name,pass,detail='')=>checks.push({name,pass:!!pass,detail})
 const a=r.after?.indexOf('<table'),b=r.after?.indexOf('</table>')
 const rows=a>=0&&b>a?(r.after.slice(a,b).match(/<tr>[\s\S]*?<\/tr>/g)||[]):[]
 const last=(rows.at(-1)?.match(/<td>[\s\S]*?<\/td>/g)||[]).map(x=>x.slice(4,-5).trim())
 if(c.expect==='ok'&&c.where)check('影响位置与运行前写定的预期完全一致',last[4]===c.where,last[4])
 if(c.expect==='ok'&&c.checkTime){
  check('顶部时间为本次操作时间',!!r.expectedTime&&r.after.startsWith('更新时间：'+r.expectedTime),r.after.split('\n')[0])
  check('版本行时间为本次操作时间',last[1]===r.expectedTime,last[1])
 }
 if(c.scenario&&c.faults.length)check('预设事故实际触发三次',r.stats.versionWrites===3&&(r.faultLog||[]).filter(x=>x.includes('顶部例行时间写入丢失')).length===3)
 return {pass:checks.length>0&&checks.every(x=>x.pass),checks}
}
