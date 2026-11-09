import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CASES } from './vt/all-cases.mjs'
import { SCENARIOS } from './vt/scenarios.mjs'
const S={...JSON.parse(readFileSync(new URL('./vt/samples.json',import.meta.url))),...JSON.parse(readFileSync(new URL('./vt/samples-new.json',import.meta.url)))}
assert.equal(Object.keys(CASES).length,39)
for(let n=1;n<=39;n++){
 const vt='VT'+String(n).padStart(2,'0');assert.ok(CASES[vt]);assert.match(S[vt].id,/^[a-f0-9]{32}$/);assert.ok(S[vt].copies.length)
 for(const cp of S[vt].copies)assert.match(cp,/^[a-f0-9]{32}$/)
 if(n>=24){assert.ok(SCENARIOS[vt].note);assert.match(S[vt].sha256,/^[a-f0-9]{64}$/);if(n!==39)assert.ok(SCENARIOS[vt].where)}
}
assert.match(S.rules,/^[a-f0-9]{32}$/)
assert.ok(readFileSync(new URL('./TESTING_RULES.md',import.meta.url),'utf8').includes('测试错误、正确结果'))
console.log('交付结构检查通过：VT01–VT39 配置、样本、副本、预期、规则均存在；不代表真实 Notion 测试通过。')
