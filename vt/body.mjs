// 只定位、修改普通正文；不理解测试答案。
export function paraLines(md) {
  const e = md.indexOf('</table>'), start = e < 0 ? 0 : e + 8
  const out = []; let pos = 0
  for (const [i,l] of md.split('\n').entries()) {
    if (pos >= start && l.trim() && !/^\s*[#<|>`-]/.test(l) && !/^\s*\d+\.\s/.test(l)) out.push(i)
    pos += l.length + 1
  }
  return out
}
export function editPara(md,k,fn) {
  const lines = md.split('\n'), i = paraLines(md)[k-1]
  if (i === undefined) throw new Error(`正文不足${k}段`)
  const v = fn(lines[i]); if (v === null) lines.splice(i,1); else lines[i] = v
  return lines.join('\n')
}
export function paragraphHeading(md,k) {
  const target = paraLines(md)[k-1]
  if (target === undefined) throw new Error('修改段落不存在')
  let h = ''
  for (const l of md.split('\n').slice(0,target+1)) if (/^## /.test(l)) h = l.slice(3).trim()
  return h
}
