import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = "C:/Users/Administrator/Documents/WXWork/1688858291865149/Cache/File/2026-07/工单2.0.xlsx";
const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 16000,
  tableMaxRows: 12,
  tableMaxCols: 18,
  tableMaxCellChars: 160,
});
console.log(summary.ndjson);
