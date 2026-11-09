import { makeFaultyFetch as original } from './faults.mjs'
export function makeFaultyFetch(plan,ctx,base){
 const wrapped=async(url,init={})=>{
  const path=new URL(url).pathname, body=init.body ? JSON.parse(init.body):null
  if(plan.some(x=>x.kind==='topTimeLost') && (init.method||'GET').toUpperCase()==='PATCH' && path.endsWith('/pages/'+ctx.doc+'/markdown') && body?.replace_content?.new_str){
   const text=body.replace_content.new_str
   // Only numbered-version writes, not exception rows.
   const rows=text.match(/<tr>[\s\S]*?<\/tr>/g)||[]
   if(/^第\s*\d+\s*版$/.test((rows.at(-1)?.match(/<td>(.*?)<\/td>/s)||[])[1]||'')){
    body.replace_content.new_str=text.replace(/^(更新时间：)20\d{2}[^\n]*/,(all,p)=>p+'2026/09/28 19:20')
    ctx.faultLog.push('顶部例行时间写入丢失，保留原时间')
    return base(url,{...init,body:JSON.stringify(body)})
   }
  }
  return base(url,init)
 }
 return original(plan,ctx,wrapped)
}
