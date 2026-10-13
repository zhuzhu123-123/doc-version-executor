// 按位置找正文段落：版本管理表后面、不以标题或标签开头的非空行。
// 修改请求和制造错误都按“第几段”定位，不依赖样本里的具体原话，换样本也能用。
export function paraLines(md) {
  const e = md.indexOf('</table>')
  const start = e < 0 ? 0 : md.indexOf('\n', e) + 1
  const lines = md.split('\n'), out = []
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (pos >= start && l.trim() && !/^\s*[#<|>`-]/.test(l) && !/^\s*\d+\.\s/.test(l)) out.push(i)
    pos += l.length + 1
  }
  return out // 行号
}
export function editPara(md, k, fn) {
  const idx = paraLines(md)
  if (idx.length < k) throw new Error(`正文不足${k}段`)
  const lines = md.split('\n')
  const r = fn(lines[idx[k - 1]])
  if (r === null) lines.splice(idx[k - 1], 1); else lines[idx[k - 1]] = r
  return lines.join('\n')
}
