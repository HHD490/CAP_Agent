import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const path = "C:/Users/Administrator/Downloads/工单2.0.xlsx";
const input = await FileBlob.load(path);
const workbook = await SpreadsheetFile.importXlsx(input);

const overview = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12000,
  tableMaxRows: 12,
  tableMaxCols: 20,
  tableMaxCellChars: 160,
});
console.log("OVERVIEW");
console.log(overview.ndjson);

const sheets = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 6000 });
console.log("SHEETS");
console.log(sheets.ndjson);

