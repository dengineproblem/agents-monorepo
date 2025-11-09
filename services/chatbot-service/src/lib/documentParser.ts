import pdfParse from 'pdf-parse';
import * as xlsx from 'xlsx';
import mammoth from 'mammoth';
import path from 'path';

export interface ParsedDocument {
  type: 'text' | 'price_list' | 'table';
  content: string;
  structured?: any;
  metadata?: {
    filename: string;
    size: number;
    pageCount?: number;
    sheetCount?: number;
  };
}

/**
 * Парсинг документа в зависимости от типа файла
 */
export async function parseDocument(
  file: Buffer,
  filename: string
): Promise<ParsedDocument> {
  const ext = path.extname(filename).toLowerCase();
  const size = file.length;

  switch (ext) {
    case '.pdf':
      return parsePDF(file, filename, size);
    
    case '.xlsx':
    case '.xls':
      return parseExcel(file, filename, size);
    
    case '.docx':
      return parseDOCX(file, filename, size);
    
    case '.txt':
      return {
        type: 'text',
        content: file.toString('utf-8'),
        metadata: { filename, size }
      };
    
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

/**
 * Парсинг PDF
 */
async function parsePDF(
  buffer: Buffer,
  filename: string,
  size: number
): Promise<ParsedDocument> {
  const data = await pdfParse(buffer);
  
  return {
    type: 'text',
    content: data.text,
    metadata: {
      filename,
      size,
      pageCount: data.numpages
    }
  };
}

/**
 * Парсинг Excel (XLSX/XLS)
 * Автоматически определяет прайс-листы по структуре
 */
async function parseExcel(
  buffer: Buffer,
  filename: string,
  size: number
): Promise<ParsedDocument> {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Преобразовать в JSON для структурированных данных
  const jsonData = xlsx.utils.sheet_to_json(sheet);
  
  // Преобразовать в текст для промпта
  const textData = xlsx.utils.sheet_to_txt(sheet);
  
  // Определить, является ли это прайс-листом
  const isPriceList = detectPriceList(jsonData);
  
  return {
    type: isPriceList ? 'price_list' : 'table',
    content: textData,
    structured: jsonData,
    metadata: {
      filename,
      size,
      sheetCount: workbook.SheetNames.length
    }
  };
}

/**
 * Определить, является ли таблица прайс-листом
 * Ищет колонки с ценами, продуктами, услугами
 */
function detectPriceList(data: any[]): boolean {
  if (!data || data.length === 0) return false;
  
  const firstRow = data[0];
  const keys = Object.keys(firstRow).map(k => k.toLowerCase());
  
  // Ключевые слова для прайс-листа
  const priceKeywords = ['price', 'цена', 'стоимость', 'cost', 'прайс'];
  const productKeywords = ['product', 'товар', 'услуга', 'service', 'название', 'name'];
  
  const hasPrice = keys.some(k => priceKeywords.some(kw => k.includes(kw)));
  const hasProduct = keys.some(k => productKeywords.some(kw => k.includes(kw)));
  
  return hasPrice && hasProduct;
}

/**
 * Парсинг DOCX
 */
async function parseDOCX(
  buffer: Buffer,
  filename: string,
  size: number
): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  
  return {
    type: 'text',
    content: result.value,
    metadata: {
      filename,
      size
    }
  };
}

/**
 * Форматирование прайс-листа для промпта
 */
export function formatPriceListForPrompt(data: any[]): string {
  if (!data || data.length === 0) return '';
  
  const lines = data.map((row, idx) => {
    const entries = Object.entries(row)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    return `${idx + 1}. ${entries}`;
  });
  
  return lines.join('\n');
}

/**
 * Извлечь основную информацию из документа (first N chars)
 */
export function extractSummary(content: string, maxLength = 500): string {
  if (content.length <= maxLength) return content;
  
  // Попытаться обрезать по предложениям
  const truncated = content.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  
  if (lastPeriod > maxLength * 0.7) {
    return truncated.substring(0, lastPeriod + 1);
  }
  
  return truncated + '...';
}

