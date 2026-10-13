// 21 个测试：普通修改请求 + 要制造的事故 + 判定类型。内容照测试总表。
// 普通修改由固定代码完成，按“正文第几段”定位，不依赖样本原话。
// 版本号不写死：撞号时改成“最近成立的版本号”，判定按“加一”现算。

export const EDITS = {
  A: { para: 3, add: '这一点长期来看成立，但任何一年都可能不出现。', note: '在正文第3段补充一句长期和短期的区别。' },
  B: { para: 8, add: '判断时要把时间长短一起算进去。', note: '在正文第8段补充一句要考虑时间的提醒。' },
  C: { para: 1, add: '建议把这些想法写下来，每年重新看一次。', note: '在正文第1段补充把想法写下来的建议。' },
}

// expect：ok = 应当版本成立；exception = 应当写异常行；noTable = 不写表，只输出结果
export const CASES = {
  VT01: { edit: "A", faults: [{kind: "dupVersion", times: 1}], expect: "ok" },
  VT02: { edit: "B", faults: [{kind: "dupVersion", times: 1}], expect: "ok" },
  VT03: { edit: "C", faults: [{kind: "dupVersion", times: 3}], expect: "exception", words: ["版本号重复","已尝试3次"], copyLink: "copy", noDupRow: true },
  VT04: { edit: "A", faults: [{kind: "prevNoteBlank", times: 1}], expect: "ok" },
  VT05: { edit: "B", faults: [{kind: "newNoteFilled", times: 1}], expect: "ok" },
  VT06: { edit: "C", note: "", faults: [], expect: "exception", words: ["缺少本次操作说明"], copyLink: "none", noCopy: true },
  VT07: { edit: "A", faults: [{kind: "copyDropPara", times: 1},{kind: "copyDropMany", times: 1}], expect: "ok", copyFailsFirst: 2 },
  VT08: { edit: "B", faults: [{kind: "copyTypo", times: 1}], expect: "ok", copyFailsFirst: 1 },
  VT09: { edit: "C", faults: [{kind: "copyMixed", times: 1}], expect: "ok", copyFailsFirst: 1 },
  VT10: { edit: "B", faults: [{kind: "copyTitleWrong", times: 2}], expect: "ok" },
  VT11: { edit: "C", faults: [{kind: "copyDropPara", times: 3}], expect: "exception", words: ["不一致","已尝试3次"], copyLink: "copy" },
  VT12: { edit: "A", faults: [{kind: "copyReadError", times: 1}], expect: "ok", logHas: ["[写入并比对副本] 第1次 失败"] },
  VT13: { edit: "B", faults: [{kind: "copyReadError", times: 3}], expect: "exception", words: ["读回","已尝试3次"] },
  VT14: { edit: "C", faults: [{kind: "timeoutAfterWrite", times: 1}], expect: "ok" },
  VT15: { edit: "A", faults: [{kind: "noPermission"}], expect: "noRetry" },
  VT16: { edit: "B", faults: [{kind: "copyUnverifiable"}], expect: "exception", words: ["无法核对"] },
  VT17: { edit: "C", faults: [], expect: "noTable" },
  VT18: { edit: "B", faults: [{kind: "dupVersion", times: 1},{kind: "copyDropPara", times: 1},{kind: "copyReadError", times: 1}], expect: "ok" },
  VT19: { edit: "C", faults: [{kind: "editRow1", times: 1}], expect: "ok" },
  VT20: { edit: "B", faults: [{kind: "archiveUnavailable"}], expect: "exception", noCopyElsewhere: true },
  VT21: { edit: "C", faults: [{kind: "copyAltLink", times: 1}], expect: "ok", logHas: ["[写入并比对副本] 第1次 成功"] },
}
