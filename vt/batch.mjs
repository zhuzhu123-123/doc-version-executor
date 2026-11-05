// 只接受已列出的测试编号；顺序运行，不把用户输入拼成 shell。
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const all = Array.from({length:23},(_,i)=>'VT'+String(i+1).padStart(2,'0'))
const selected = process.env.SELECTED_CASE
if (selected !== 'all' && !all.includes(selected)) throw new Error('非法测试编号，未启动任何测试')
mkdirSync('test-results',{recursive:true})
let failed=0
for (const c of selected==='all'?all:[selected]) {
  let output, pass=true
  try { output=execFileSync(process.execPath,['vt/run-vt.mjs','--case',c,'--record'],{encoding:'utf8',maxBuffer:32*1024*1024}) }
  catch(e) { pass=false;failed++; output=String(e.stdout||'')+String(e.stderr||'') }
  writeFileSync('test-results/'+c+'.log',output)
  console.log(c+': '+(pass?'通过':'失败'));console.log(output)
}
process.exit(failed?1:0)
