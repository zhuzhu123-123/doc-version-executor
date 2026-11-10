import { CASES as legacy, EDITS } from './cases.mjs'
import { SCENARIOS } from './scenarios.mjs'
export { EDITS }
export const CASES = { ...legacy }
for(const [id,s] of Object.entries(SCENARIOS)) CASES[id]={faults:[],expect:'ok',...s,scenario:s.edit}
