// 21 个测试：普通修改请求 + 要制造的事故 + 判定类型。内容照测试总表。
// 普通修改由固定代码完成，保证每次改得一样。

export const EDITS = {
  A: { find: '这就是风险溢价。', add: '风险溢价是长期平均意义上的补偿，任何一年都可能不出现。', note: '第三章补充风险溢价不是每年都有的提醒。' },
  B: { find: '看 IRR 更严谨。', add: 'IRR 把每一笔投入的时间都算进去，比总收益率更接近真实回报。', note: '第八章补充 IRR 为什么更严谨。' },
  C: { find: '理财很容易变成情绪决定。', add: '建议把五个问题的答案写下来，每年重新看一次。', note: '第一章补充把五个问题的答案写下来的建议。' },
}

// expect：ok = 应当版本成立；exception = 应当写异常行；noTable = 不写表，只输出结果
export const CASES = {
  VT01: { edit: "A", faults: [{kind: "dupVersion", to: "第 2 版", times: 1}], expect: "ok" },
  VT02: { edit: "B", faults: [{kind: "dupVersion", to: "第 2 版", times: 1}], expect: "ok" },
  VT03: { edit: "C", faults: [{kind: "dupVersion", to: "第 2 版", times: 3}], expect: "exception", words: ["版本号重复","已尝试3次"], copyLink: "copy", noDupRow: true },
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
  VT18: { edit: "B", faults: [{kind: "dupVersion", to: "第 2 版", times: 1},{kind: "copyDropPara", times: 1},{kind: "copyReadError", times: 1}], expect: "ok" },
  VT19: { edit: "C", faults: [{kind: "editRow1", times: 1}], expect: "ok" },
  VT20: { edit: "B", faults: [{kind: "archiveUnavailable"}], expect: "exception", noCopyElsewhere: true },
  VT21: { edit: "C", faults: [{kind: "copyAltLink", times: 1}], expect: "ok", logHas: ["[写入并比对副本] 第1次 成功"] },
}
