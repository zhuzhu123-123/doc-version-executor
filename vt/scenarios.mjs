// Test inputs and frozen expected outputs live outside the executor.
// Ordinary edits never expose a test ID or an expected outcome to the executor.
export const SCENARIOS = {
 VT24:{edit:'rename',where:'章节改名：一、先留足应急金 → 一、先建立应急储备；版本管理表',note:'将应急金章节改名为“一、先建立应急储备”，正文保持不变。'},
 VT25:{edit:'introBefore',where:'文档引言；版本管理表',note:'在文档开头的引言补充读者适用范围。'},
 VT26:{edit:'introAfter',where:'文档引言；版本管理表',note:'在版本管理表后、首章前的引言补充读者适用范围。'},
 VT27:{edit:'time',where:'版本管理表',note:'更新顶部例行时间，其他内容保持不变。'},
 VT28:{edit:'timeText',where:'文档引言；版本管理表',note:'更新顶部时间，并将同一行的“建立测试样本”改为“补充适用范围”。'},
 VT29:{edit:'ambiguous',where:'新增：一、长期配置；新增：二、分散持有；删除：一、长期投资；删除：二、组合分散；版本管理表',note:'将两章标题改为“一、长期配置”和“二、分散持有”，正文保持不变。'},
 VT30:{edit:'add',where:'新增：第三章；版本管理表',note:'在文末新增“第三章”，说明定期再平衡。'},
 VT31:{edit:'delete',where:'删除：二、先做资产配置；版本管理表',note:'删除“二、先做资产配置”章节，其他章节保持不变。'},
 VT32:{edit:'duplicate',where:'风险提示（第1处）；版本管理表',note:'只在第一个“风险提示”章节补充流动性提醒。'},
 VT33:{edit:'fence',where:'一、风险提示；版本管理表',note:'只改代码示例中的标题，其他内容保持不变。'},
 VT34:{edit:'reorder',where:'章节顺序；版本管理表',note:'交换前两章的顺序，正文保持不变。'},
 VT35:{edit:'noHeading',where:'文档引言；版本管理表',note:'在无章节正文的末尾补充年度复盘建议。'},
 VT36:{edit:'body',where:'一、先留足应急金；版本管理表',note:'在应急金章节补充年度复盘建议。',checkTime:true},
 VT37:{edit:'businessDate',where:'文档引言；版本管理表',note:'将业务日期由2026/09/28更新为2026/09/29。'},
 VT38:{edit:'none',where:'版本管理表',note:'确认本次内容，无正文修改。'},
 VT39:{edit:'none',note:'确认本次内容并更新例行时间。',checkTime:true,expect:'exception',words:['顶部时间未按本次操作时间更新'],faults:[{kind:'topTimeLost'}]},
}
function once(md,old,next) { if(!md.includes(old)) throw new Error('输入样本不满足操作前提：'+old); return md.replace(old,next) }
export function applyScenario(md,kind) {
 switch(kind){
  case 'rename': return once(md,'## 一、先留足应急金','## 一、先建立应急储备')
  case 'introBefore': if(!md.startsWith('> '))throw new Error('引言不在版本表前'); return once(md,'三件事。','三件事，适合首次制定预算的读者。')
  case 'introAfter': if(md.indexOf('> ')<md.indexOf('</table>'))throw new Error('引言不在版本表后'); return once(md,'三件事。','三件事，适合首次制定预算的读者。')
  case 'time': return once(md,'更新时间：2026/09/28 19:20','更新时间：2026/10/01 10:00')
  case 'timeText': return once(md,'更新时间：2026/09/28 19:20 建立测试样本','更新时间：2026/10/01 10:00 补充适用范围')
  case 'ambiguous': return once(once(md,'## 一、长期投资','## 一、长期配置'),'## 二、组合分散','## 二、分散持有')
  case 'add': if(md.includes('## 第三章'))throw new Error('新增章节已存在');return md.trimEnd()+'\n## 第三章\n每年复盘资产比例，并根据风险承受能力进行再平衡。\n'
  case 'delete': {const a=md.indexOf('## 二、先做资产配置'),b=md.indexOf('## 三、长期收益来自风险溢价');if(a<0||b<a)throw new Error('缺少待删章节');return md.slice(0,a)+md.slice(b)}
  case 'duplicate': return once(md,'股票波动大，回撤可能很深，中途卖出会亏钱。','股票波动大，回撤可能很深，中途卖出会亏钱。应急资金要保留流动性。')
  case 'fence':return once(md,'## 这不是真实章节','## 示例标题已更新')
  case 'reorder': {const a=md.indexOf('## 一、先留足应急金'),b=md.indexOf('## 二、先做资产配置'),c=md.indexOf('## 三、长期收益来自风险溢价');if(a<0||b<a||c<b)throw new Error('缺少待交换章节');return md.slice(0,a)+md.slice(b,c)+md.slice(a,b)+md.slice(c)}
  case 'noHeading': return md.trimEnd()+'\n建议每年复盘预算与风险承受能力。\n'
  case 'body':return once(md,'应急金要放在安全、随时能取的地方，不追求高收益。','应急金要放在安全、随时能取的地方，不追求高收益。建议每年复盘资金需求。')
  case 'businessDate':return once(md,'业务日期：2026/09/28','业务日期：2026/09/29')
  case 'none':return md
  default:throw new Error('未知普通操作：'+kind)
 }
}
