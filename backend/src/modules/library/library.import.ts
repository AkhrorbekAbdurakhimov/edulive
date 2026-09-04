/**
 * Kitoblarni Excel orqali kiritish.
 *
 * O'quvchilar importidagi kabi ATOMIK: bitta qatorda xato bo'lsa hech narsa
 * yozilmaydi va qator raqami bilan ro'yxat qaytariladi.
 */
import ExcelJS from 'exceljs';

export const SHEET_BOOKS = 'Kitoblar';
export const SHEET_LOOKUP = 'Royxat';
export const HEADER_ROW = 1;
export const FIRST_DATA_ROW = 2;
export const MAX_ROWS = 1000;

interface Column {
  header: string;
  width: number;
  required?: boolean;
  hint?: string;
}

export const COLUMNS: Column[] = [
  { header: 'Nomi',              width: 34, required: true },
  { header: 'Muallif',           width: 22 },
  { header: "Bo'lim",            width: 14, hint: 'darslik / badiiy / qollanma / ilmiy / boshqa' },
  { header: 'Sinf',              width: 8,  hint: 'darslik bo\'lsa 1 dan 11 gacha' },
  { header: 'Til',               width: 10, hint: "o'zbek / rus / ingliz" },
  { header: 'Nashriyot',         width: 20 },
  { header: 'Nashr yili',        width: 12, hint: 'masalan 2021' },
  { header: 'ISBN',              width: 18 },
  { header: 'Javon',             width: 12, hint: 'masalan A-3' },
  { header: 'Narxi',             width: 12, hint: "so'mda, yo'qolganda undiriladi" },
  { header: 'Nusxalar soni',     width: 14, hint: "bo'sh bo'lsa 1" },
  { header: 'Inventar raqamlari', width: 30, hint: "vergul bilan; bo'sh bo'lsa avtomatik" },
];

export const CATEGORY_MAP: Record<string, string> = {
  darslik: 'darslik', badiiy: 'badiiy', qollanma: 'qollanma', "qo'llanma": 'qollanma',
  ilmiy: 'ilmiy', boshqa: 'boshqa',
};

export const LANGUAGE_MAP: Record<string, string> = {
  "o'zbek": 'uz', ozbek: 'uz', uz: 'uz', uzbek: 'uz',
  rus: 'ru', ru: 'ru', russian: 'ru',
  ingliz: 'en', en: 'en', english: 'en',
  boshqa: 'other', other: 'other',
};

export interface RawRow {
  row: number;
  values: (string | null)[];
}

function cellText(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const rich = v as { result?: unknown; richText?: Array<{ text: string }>; text?: string };
    if (rich.richText) return rich.richText.map((r) => r.text).join('').trim() || null;
    if (rich.text !== undefined) return String(rich.text).trim() || null;
    if (rich.result !== undefined) return String(rich.result).trim() || null;
    return null;
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

export async function readWorkbook(buf: Buffer): Promise<RawRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const ws = wb.getWorksheet(SHEET_BOOKS) ?? wb.worksheets[0];
  if (!ws) throw new Error('empty');

  const rows: RawRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < FIRST_DATA_ROW) return;
    const values = COLUMNS.map((_, i) => cellText(row.getCell(i + 1).value));
    if (values.every((v) => v === null)) return;
    rows.push({ row: rowNumber, values });
  });
  return rows;
}

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduLive';
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET_BOOKS, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));

  const head = ws.getRow(HEADER_ROW);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F5' } };
    cell.note = [c.required ? 'Majburiy' : 'Ixtiyoriy', c.hint].filter(Boolean).join(' · ');
  });

  const sample = ws.addRow([
    'Alpomish', 'Xalq dostoni', 'badiiy', '', "o'zbek",
    "G'afur G'ulom", 2019, '', 'A-3', 45000, 5, '',
  ]);
  sample.font = { italic: true, color: { argb: 'FF9AA0A6' } };

  const lookup = wb.addWorksheet(SHEET_LOOKUP);
  lookup.getCell('A1').value = "Bo'lim";
  ['darslik', 'badiiy', 'qollanma', 'ilmiy', 'boshqa'].forEach((n, i) => {
    lookup.getCell(`A${i + 2}`).value = n;
  });
  lookup.getCell('B1').value = 'Til';
  ["o'zbek", 'rus', 'ingliz', 'boshqa'].forEach((n, i) => {
    lookup.getCell(`B${i + 2}`).value = n;
  });
  lookup.state = 'veryHidden';

  const lastRow = FIRST_DATA_ROW + MAX_ROWS;
  for (let r = FIRST_DATA_ROW; r <= lastRow; r += 1) {
    ws.getCell(`C${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`${SHEET_LOOKUP}!$A$2:$A$6`],
    };
    ws.getCell(`E${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`${SHEET_LOOKUP}!$B$2:$B$5`],
    };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
