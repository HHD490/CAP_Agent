import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = "C:/Users/Administrator/Documents/WXWork/1688858291865149/Cache/File/2026-07/工单2.0.xlsx";
const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem("测试用例");
const values = sheet.getRange("A1:G443").values;
const headers = values[0];
const rows = values.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])));

const countBy = (items, fn) => {
  const result = {};
  for (const item of items) {
    const key = fn(item) || "(空)";
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]));
};

const topModule = (modulePath) => {
  const parts = String(modulePath).split("/").filter(Boolean);
  return parts.length >= 2 ? parts[1] : parts[0] || "(空)";
};

const leafModule = (modulePath) => {
  const parts = String(modulePath).split("/").filter(Boolean);
  return parts.slice(1).join("/") || parts.join("/") || "(空)";
};

const extractTestType = (remark) => {
  const match = String(remark).match(/【测试类型】([^\r\n]+)/);
  return match ? match[1].trim() : "(未标注)";
};

const combined = (row) =>
  [row["用例名称"], row["前置条件"], row["步骤描述"], row["预期结果"], row["备注"]]
    .map(String)
    .join("\n");

const uiWords = /登录系统|页面|点击|按钮|弹窗|下拉框|输入框|置灰|跳转|展示|刷新|浏览器/;
const apiWords = /接口|请求|响应|状态码|错误码|用户ID|工单ID|直接调用|提交.*ID/;
const humanWords = /文案|视觉|样式|兼容|易用|主观|人工|邮件|短信|通知消息|声音|图片/;
const concurrencyWords = /并发|另一浏览器|另一会话|同时|冲突/;
const dataDependencyWords = /存在状态|存在.*工单|目标处理人|账号|密码|组织架构|可用处理人/;

const automationBucket = (row) => {
  const text = combined(row);
  const ui = uiWords.test(text);
  const api = apiWords.test(text);
  const human = humanWords.test(text);
  if (concurrencyWords.test(text)) return "专项/并发";
  if (ui && api) return "UI+API混合";
  if (api) return "API候选";
  if (ui && !human) return "UI候选";
  if (human) return "人工/半自动";
  return "需评审";
};

const topLeafModules = Object.entries(countBy(rows, (r) => leafModule(r["所属模块"]))).slice(0, 20);
const result = {
  sheet: "测试用例",
  totalCases: rows.length,
  priority: countBy(rows, (r) => String(r["用例等级"]).trim()),
  testType: countBy(rows, (r) => extractTestType(r["备注"])),
  topLevelModule: countBy(rows, (r) => topModule(r["所属模块"])),
  topLeafModules,
  automationHeuristic: countBy(rows, automationBucket),
  dependencySignals: {
    casesWithDataDependencies: rows.filter((r) => dataDependencyWords.test(combined(r))).length,
    casesWithApiSignals: rows.filter((r) => apiWords.test(combined(r))).length,
    casesWithUiSignals: rows.filter((r) => uiWords.test(combined(r))).length,
    casesWithConcurrencySignals: rows.filter((r) => concurrencyWords.test(combined(r))).length,
  },
  traceability: {
    withFeatureTrace: rows.filter((r) => /【追溯信息】/.test(String(r["备注"]))).length,
    withDesignBasis: rows.filter((r) => /【设计依据】/.test(String(r["备注"]))).length,
    withTestType: rows.filter((r) => /【测试类型】/.test(String(r["备注"]))).length,
  },
};

console.log(JSON.stringify(result, null, 2));
