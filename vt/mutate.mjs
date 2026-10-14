// 改坏执行器检查：把执行器复制8份，每份按下面固定的方法只改一处，
// 每份都把全部测试在假 Notion 上跑一遍，再和事先写好的预测逐个对照。
// 不写测试总表，不改任何真实页面。用法：NOTION_TOKEN=... node vt/mutate.mjs
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { CASES } from './cases.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = readFileSync(join(ROOT, 'executor.mjs'), 'utf8')

// 每份改坏的执行器：改哪一处（原文 → 改成），以及事先预测会失败的测试
const MUTANTS = [
  { name: '新版本号不加一', from: 'const N = prevN + 1', to: 'const N = prevN',
    expect: ['VT01','VT02','VT03','VT04','VT05','VT07','VT08','VT09','VT10','VT12','VT14','VT18','VT19','VT21'] },
  { name: '不检查旧行有没有被改', from: 'for (let k = 0; k < expRows.length; k++) if (!rowsEqual(t.rows[k], expRows[k]))', to: 'for (let k = 0; k < expRows.length; k++) if (false)',
    expect: ['VT04','VT19'] },
  { name: '不比对副本和文档', from: 'if (hDoc !== hCopy) throw', to: 'if (false) throw',
    expect: ['VT07','VT08','VT09','VT11','VT18'] },
  { name: '出错不重试', from: 'const MAX = 3', to: 'const MAX = 1',
    expect: ['VT01','VT02','VT03','VT04','VT05','VT07','VT08','VT09','VT10','VT11','VT12','VT13','VT18','VT19'] },
  { name: '不填上一版的下一版操作说明', from: '(i === prevIdx ? makeRow(cellsOf(r).map((c, k) => (k === 5 ? esc(note) : c))) : r)', to: '(r)',
    expect: ['VT01','VT02','VT04','VT05','VT07','VT08','VT09','VT10','VT12','VT14','VT18','VT19','VT21'] },
  { name: '不检查新一行的版本号', from: 'if (c[0] !== `第 ${N} 版`) {', to: 'if (false) {',
    expect: ['VT01','VT02','VT03','VT18'] },
  { name: '不检查副本标题', from: 'if (got !== copyTitle) {', to: 'if (false) {',
    expect: ['VT10'] },
  { name: '出异常时旧行不恢复原样', from: 'withRows(st.md1, st.t1, [...st.t1.rows, ex])', to: 'withRows(st.md1, st.t1, [...st.t1.rows.slice(0, -1), ex])',
    expect: ['VT03','VT06','VT11','VT13','VT16','VT20'] },
]

const cases = Object.keys(CASES)
const runOne = (dir, vt) => new Promise((res) => execFile('node', [join(dir, 'vt/run-vt.mjs'), '--case', vt, '--fake'], { env: process.env, maxBuffer: 1 << 26 }, (e, out = '', err = '') => {
  const m = (out + err).match(/判定：(通过|失败)/); res(m ? m[1] : '失败')
}))
async function runAll(code) {
  const dir = mkdtempSync(join(tmpdir(), 'mut-'))
  writeFileSync(join(dir, 'executor.mjs'), code); cpSync(join(ROOT, 'vt'), join(dir, 'vt'), { recursive: true })
  const failed = []
  for (const vt of cases) if ((await runOne(dir, vt)) !== '通过') failed.push(vt)
  return failed
}

let allOk = true
const base = await runAll(SRC)
console.log(`未改动的执行器：${base.length ? '失败的测试 ' + base.join('、') + ' ❌' : '全部通过 ✅'}`)
if (base.length) allOk = false
for (const m of MUTANTS) {
  const n = SRC.split(m.from).length - 1
  if (n !== 1) { console.log(`${m.name}：要改的那一处在代码里找到 ${n} 次，没法改 ❌`); allOk = false; continue }
  const failed = await runAll(SRC.replace(m.from, m.to))
  const same = failed.join() === [...m.expect].sort().join()
  if (!same) allOk = false
  console.log(`${m.name}：预测失败 ${m.expect.length} 个，实际失败 ${failed.length} 个 ${same ? '✅ 对得上' : '❌ 对不上'}`)
  console.log(`  预测：${m.expect.join('、') || '无'}`)
  console.log(`  实际：${failed.join('、') || '无'}`)
}
console.log(allOk ? '\n结论：全部对得上 ✅' : '\n结论：有对不上的 ❌')
process.exit(allOk ? 0 : 1)
