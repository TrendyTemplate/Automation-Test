// Turn an incoming file or email text into a normalized PO:
//   { po_number, po_date, requested_ship_date, currency, buyer{}, ship_to{}, notes, lines:[{code, description, quantity, unit, unit_price}] }
// Spreadsheets with recognizable headers are parsed deterministically (exact, free, instant); everything else
// (PDF, images, free-text email, odd spreadsheets) is read by the AI.
import ExcelJS from 'exceljs';
import { extractWithAi } from './ai.js';
import { config } from '../config.js';

const EMPTY_PARTY = { company: '', name: '', email: '', phone: '' };
const EMPTY_ADDRESS = { company: '', name: '', address1: '', address2: '', city: '', province_code: '', zip: '', country_code: '', phone: '' };

export function kindOf(filename = '', contentType = '') {
  const f = filename.toLowerCase();
  const t = contentType.toLowerCase();
  if (t === 'application/pdf' || f.endsWith('.pdf')) return 'pdf';
  if (/^image\/(png|jpe?g|gif|webp)$/.test(t) || /\.(png|jpe?g|gif|webp)$/.test(f)) return 'image';
  if (f.endsWith('.xlsx') || t.includes('spreadsheetml')) return 'xlsx';
  if (f.endsWith('.csv') || t === 'text/csv') return 'csv';
  if (t.startsWith('text/') || f.endsWith('.txt')) return 'text';
  return null;
}

/** @param {{filename?:string, contentType?:string, content:Buffer|string}} file */
export async function extractPo(file) {
  const kind = kindOf(file.filename, file.contentType);
  if (!kind) throw new Error(`Unsupported file type: ${file.filename || file.contentType}`);
  const buf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content));
  if (buf.length > config.maxAttachmentBytes) throw new Error('File is too large');

  if (kind === 'csv' || kind === 'xlsx') {
    const rows = kind === 'csv' ? parseCsv(buf.toString('utf8')) : await xlsxRows(buf);
    const parsed = parseTable(rows);
    if (parsed) return finalize(parsed, 'table');
    // Unrecognized layout: let the AI read the sheet as text.
    return finalize(await extractWithAi([{ type: 'text', text: `Spreadsheet "${file.filename || 'order'}":\n${rowsToText(rows)}` }]), 'ai');
  }
  const b64 = buf.toString('base64');
  const block = kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : kind === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: normalizeImageType(file), data: b64 } }
      : { type: 'text', text: `Email / text order:\n${buf.toString('utf8').slice(0, 60000)}` };
  return finalize(await extractWithAi([block]), 'ai');
}

function normalizeImageType(file) {
  const t = (file.contentType || '').toLowerCase();
  if (/^image\/(png|jpeg|gif|webp)$/.test(t)) return t;
  if (t === 'image/jpg') return 'image/jpeg';
  const ext = (file.filename || '').toLowerCase().split('.').pop();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] || 'image/png';
}

/** Validate and clamp whatever came back (AI output is untrusted too). */
function finalize(po, method) {
  if (po.is_purchase_order === false) {
    return { ...po, lines: [], is_purchase_order: false, method };
  }
  const lines = [];
  for (const l of Array.isArray(po.lines) ? po.lines : []) {
    const quantity = Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6) continue;
    const price = l.unit_price == null || l.unit_price === '' ? null : Number(l.unit_price);
    lines.push({
      code: clean(l.code, 100),
      description: clean(l.description, 300),
      quantity,
      unit: clean(l.unit, 30),
      unit_price: Number.isFinite(price) && price >= 0 ? price : null,
    });
    if (lines.length >= config.maxLinesPerPo) break;
  }
  return {
    is_purchase_order: lines.length > 0,
    po_number: clean(po.po_number, 64),
    po_date: isoDate(po.po_date),
    requested_ship_date: isoDate(po.requested_ship_date),
    currency: /^[A-Z]{3}$/.test(String(po.currency || '').toUpperCase()) ? String(po.currency).toUpperCase() : '',
    buyer: { ...EMPTY_PARTY, ...pick(po.buyer, EMPTY_PARTY) },
    ship_to: { ...EMPTY_ADDRESS, ...pick(po.ship_to, EMPTY_ADDRESS) },
    notes: clean(po.notes, 2000),
    lines,
    method,
  };
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const pick = (obj, shape) => Object.fromEntries(Object.keys(shape).map((k) => [k, clean(obj?.[k], 200)]));
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

// ---------------- spreadsheets ----------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  const delim = guessDelimiter(s);
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function guessDelimiter(s) {
  const first = s.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

async function xlsxRows(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = [];
    r.eachCell({ includeEmpty: true }, (cell, col) => { vals[col - 1] = cellText(cell.value); });
    rows.push(Array.from(vals, (v) => v ?? ''));
  });
  return rows;
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return String(v.result ?? v.text ?? v.richText?.map((t) => t.text).join('') ?? '');
  return String(v);
}

const HEADERS = {
  code: /^(sku|item\s*(no|number|#|code)?|product\s*(code|id|no)|article|art\.?\s*no|style|code|part\s*(no|number)|upc|ean|gtin|barcode)$/i,
  description: /^(desc(ription)?|product(\s*name)?|item\s*name|name|title)$/i,
  quantity: /^(qty|quantity|order\s*qty|units|amount|ordered|qty\s*ordered|menge|cantidad|quantité)$/i,
  unit: /^(unit|uom|u\/m|pack|units?\s*of\s*measure)$/i,
  unit_price: /^(price|unit\s*price|cost|unit\s*cost|wholesale(\s*price)?|rate|price\s*each)$/i,
};

/** Find a header row and map columns. Returns null when the layout is not a simple line-item table. */
export function parseTable(rows) {
  for (let h = 0; h < Math.min(rows.length, 25); h += 1) {
    const map = {};
    rows[h].forEach((cell, i) => {
      const label = String(cell).trim().replace(/[:.]$/, '');
      for (const [key, re] of Object.entries(HEADERS)) if (map[key] == null && re.test(label)) { map[key] = i; break; }
    });
    if (map.quantity == null || (map.code == null && map.description == null)) continue;
    const lines = [];
    for (const r of rows.slice(h + 1)) {
      const qty = toNumber(r[map.quantity]);
      const code = map.code == null ? '' : String(r[map.code] ?? '').trim();
      const description = map.description == null ? '' : String(r[map.description] ?? '').trim();
      if (!qty || (!code && !description)) continue;
      if (/^(sub)?total|tax|shipping|freight/i.test(description || code)) continue;
      lines.push({
        code, description, quantity: qty,
        unit: map.unit == null ? '' : String(r[map.unit] ?? '').trim(),
        unit_price: map.unit_price == null ? null : toNumber(r[map.unit_price]),
      });
    }
    if (!lines.length) return null;
    const meta = headerMeta(rows.slice(0, h));
    return { is_purchase_order: true, ...meta, buyer: EMPTY_PARTY, ship_to: EMPTY_ADDRESS, notes: '', lines };
  }
  return null;
}

function headerMeta(rows) {
  const text = rows.map((r) => r.join(' ')).join('\n');
  const po = /(?:P\.?O\.?|purchase\s*order)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-/]{1,30})/i.exec(text);
  return { po_number: po ? po[1] : '', po_date: '', requested_ship_date: '', currency: '' };
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const rowsToText = (rows) => rows.slice(0, 600).map((r) => r.join(' | ')).join('\n').slice(0, 60000);
