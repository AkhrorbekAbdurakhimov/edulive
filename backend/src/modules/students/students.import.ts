/**
 * O'quvchilarni Excel orqali kiritish: shablon yaratish va yuklangan faylni o'qish.
 *
 * Import ATOMIK: bitta qatorda xato bo'lsa ham hech narsa yozilmaydi va
 * foydalanuvchiga qator raqami bilan ro'yxat qaytariladi. Sabab — yarim
 * import qilingan ro'yxatni qo'lda tozalash juda og'ir, faylni tuzatib qayta
 * yuklash esa oson.
 */
import ExcelJS from 'exceljs';

export const SHEET_STUDENTS = 'Oquvchilar';
export const SHEET_LOOKUP = 'Royxat';        // formulada qo'shtirnoq bo'lmasin
export const HEADER_ROW = 1;
export const FIRST_DATA_ROW = 2;
/** Bitta faylda ruxsat etilgan qatorlar — tranzaksiya cheksiz o'smasin. */
export const MAX_ROWS = 500;

interface Column {
  header: string;
  width: number;
  required?: boolean;
  hint?: string;
}

/** Ustunlar tartibi shablonda ham, o'qishda ham SHU joydan olinadi. */
export const COLUMNS: Column[] = [
  { header: 'Familiya',           width: 18, required: true },
  { header: 'Ism',                width: 16, required: true },
  { header: 'Otasining ismi',     width: 18 },
  { header: "Tug'ilgan sana",     width: 16, hint: 'YYYY-MM-DD' },
  { header: 'Jinsi',              width: 10, hint: "o'g'il / qiz" },
  { header: 'Sinf',               width: 10, hint: 'masalan 1-A' },
  { header: 'Chegirma %',         width: 12, hint: '0 dan 100 gacha' },
  { header: 'Ota-ona F.I.Sh',     width: 24 },
  { header: 'Ota-ona telefoni',   width: 18, hint: '+998XXXXXXXXX' },
  { header: 'Kim bo\'ladi',       width: 14, hint: 'ota / ona / vasiy' },
  { header: 'Maktab ID',          width: 14, hint: 'ixtiyoriy, takrorlanmaydi' },
];

export interface RawRow {
  row: number;                    // Exceldagi qator raqami — xatoda shu ko'rsatiladi
  values: (string | null)[];      // COLUMNS tartibida
}

/** Katakni matnga keltiradi: sana Date bo'lib kelishi mumkin, raqam — number. */
function cellText(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // Excel sanani UTC yarim tunda saqlaydi — mahalliy vaqtga o'tkazsak kun suriladi.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    // Formula yoki boy matn katagi
    const rich = v as { result?: unknown; richText?: Array<{ text: string }>; text?: string };
    if (rich.richText) return rich.richText.map((r) => r.text).join('').trim() || null;
    if (rich.text !== undefined) return String(rich.text).trim() || null;
    if (rich.result !== undefined) return String(rich.result).trim() || null;
    return null;
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Yuklangan faylni o'qiydi. Faqat o'qiydi — tekshirish yuqori qatlamda. */
export async function readWorkbook(buf: Buffer): Promise<RawRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  // Nomi bo'yicha topamiz, topilmasa birinchi varaq — foydalanuvchi varaq
  // nomini o'zgartirib yuborgan bo'lishi mumkin.
  const ws = wb.getWorksheet(SHEET_STUDENTS) ?? wb.worksheets[0];
  if (!ws) throw new Error('empty');

  const rows: RawRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < FIRST_DATA_ROW) return;
    const values = COLUMNS.map((_, i) => cellText(row.getCell(i + 1).value));
    // Butunlay bo'sh qator — shablonda qolib ketgan bo'lishi mumkin, o'tkazamiz
    if (values.every((v) => v === null)) return;
    rows.push({ row: rowNumber, values });
  });
  return rows;
}

/** To'ldirish uchun shablon. `classNames` — maktabda mavjud sinflar. */
export async function buildTemplate(classNames: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduLive';
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET_STUDENTS, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));

  const head = ws.getRow(HEADER_ROW);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F5' } };
    // Ustun qoidasi izoh sifatida — foydalanuvchi shablonni ochib bilib oladi.
    const note = [c.required ? 'Majburiy' : 'Ixtiyoriy', c.hint].filter(Boolean).join(' · ');
    cell.note = note;
  });

  // Namuna qator — kulrang, o'chirib tashlanadi degan izoh bilan
  const sample = ws.addRow([
    'Karimov', 'Alibek', 'Baxtiyor', '2019-04-12', "o'g'il",
    classNames[0] ?? '1-A', 0, 'Karimov Baxtiyor', '+998901234567', 'ota', '',
  ]);
  sample.font = { italic: true, color: { argb: 'FF9AA0A6' } };

  // Ro'yxatlar alohida varaqda: sinf nomlari 255 belgidan oshib ketishi mumkin,
  // shuning uchun inline ro'yxat emas, diapazonga havola ishlatiladi.
  const lookup = wb.addWorksheet(SHEET_LOOKUP);
  lookup.getCell('A1').value = 'Sinflar';
  classNames.forEach((n, i) => { lookup.getCell(`A${i + 2}`).value = n; });
  lookup.getCell('B1').value = 'Jinsi';
  ["o'g'il", 'qiz'].forEach((n, i) => { lookup.getCell(`B${i + 2}`).value = n; });
  lookup.getCell('C1').value = "Kim bo'ladi";
  ['ota', 'ona', 'vasiy'].forEach((n, i) => { lookup.getCell(`C${i + 2}`).value = n; });
  lookup.state = 'veryHidden';

  // Tanlov ro'yxatlari — eng ko'p uchraydigan xatoni oldini oladi.
  const lastRow = FIRST_DATA_ROW + MAX_ROWS;
  for (let r = FIRST_DATA_ROW; r <= lastRow; r += 1) {
    if (classNames.length) {
      ws.getCell(`F${r}`).dataValidation = {
        type: 'list', allowBlank: true,
        formulae: [`${SHEET_LOOKUP}!$A$2:$A$${classNames.length + 1}`],
      };
    }
    ws.getCell(`E${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`${SHEET_LOOKUP}!$B$2:$B$3`],
    };
    ws.getCell(`J${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`${SHEET_LOOKUP}!$C$2:$C$4`],
    };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
