// 与交付清单逐字节比较；不读取令牌，不调用外部服务。
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
const m=JSON.parse(readFileSync(new URL('./release-manifest.json',import.meta.url)))
let failed=false
for(const [path,expected] of Object.entries(m.files)) {
  const actual=createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex')
  if(actual!==expected){console.error('文件与交付清单不一致：'+path);failed=true}
}
if(failed)process.exit(1)
console.log('交付清单逐字节一致：'+m.version+'，'+Object.keys(m.files).length+'个文件')
console.log('实际 GitHub 提交：'+(process.env.GITHUB_SHA||'本地'))
