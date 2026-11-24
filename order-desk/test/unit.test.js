import { makeStore, CATALOG } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseTable, kindOf } from '../src/core/extract.js';
import { customerKey, matchLine, remember, loadCatalog } from '../src/core/match.js';

test('parseCsv handles quotes, embedded commas, CRLF and semicolons', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCsv('SKU;Qty\nA-1;3\n'), [['SKU', 'Qty'], ['A-1', '3']]);
});

test('parseTable finds the header row below a letterhead and skips totals', () => {
  const rows = [
    ['Corner Grocer Inc.'], ['Purchase Order #: CG-7781'], [],
    ['Item #', 'Description', 'Qty', 'Unit Price'],
    ['TEA-GRN-12', 'Organic Green Tea', '4', '$4.50'],
    ['', 'Raw honey 500g', '2', '7.80'],
    ['', 'Subtotal', '6', ''],
  ];
  const po = parseTable(rows);
  assert.equal(po.po_number, 'CG-7781');
  assert.equal(po.lines.length, 2);
  assert.deepEqual(po.lines[0], { code: 'TEA-GRN-12', description: 'Organic Green Tea', quantity: 4, unit: '', unit_price: 4.5 });
  assert.equal(parseTable([['hello', 'world'], ['a', 'b']]), null);
});

test('kindOf recognizes supported files', () => {
  assert.equal(kindOf('po.PDF'), 'pdf');
  assert.equal(kindOf('order.xlsx'), 'xlsx');
  assert.equal(kindOf('x', 'image/jpeg'), 'image');
  assert.equal(kindOf('x.docx'), null);
});

test('customerKey groups a company by domain but keeps free-mail buyers separate', () => {
  assert.equal(customerKey('Dana@CornerGrocer.com'), '@cornergrocer.com');
  assert.equal(customerKey('shop.owner@gmail.com'), 'shop.owner@gmail.com');
  assert.equal(customerKey('not-an-email'), '');
});

test('matching: sku, barcode, fuzzy, cases, price and stock checks', () => {
  const { id } = makeStore();
  const catalog = loadCatalog(id);
  const sku = matchLine(id, '@x.com', { code: 'tea grn 12', description: '', quantity: 2, unit: '', unit_price: 4.5 }, catalog);
  assert.equal(sku.match_method, 'sku');
  assert.ok(sku.confidence >= 0.9);
  assert.deepEqual(sku.flags, []);

  const bc = matchLine(id, '@x.com', { code: '0850001112247', description: '', quantity: 1, unit: '', unit_price: null }, catalog);
  assert.equal(bc.match_method, 'barcode');

  const cases = matchLine(id, '@x.com', { code: 'TEA-GRN-12', description: '', quantity: 3, unit: 'cases', unit_price: 54 }, catalog);
  assert.equal(cases.final_quantity, 36);
  assert.ok(cases.flags.includes('converted_from_case'));
  assert.ok(!cases.flags.includes('price_mismatch'), '54 per case of 12 = 4.50 each');

  const pricey = matchLine(id, '@x.com', { code: 'TEA-GRN-12', description: '', quantity: 1, unit: '', unit_price: 3.99 }, catalog);
  assert.ok(pricey.flags.includes('price_mismatch'));

  const stock = matchLine(id, '@x.com', { code: 'TEA-BLK-12', description: '', quantity: 100, unit: '', unit_price: null }, catalog);
  assert.ok(stock.flags.includes('low_stock'));

  const fuzzy = matchLine(id, '@x.com', { code: '', description: 'Ceramic mug white', quantity: 6, unit: '', unit_price: null }, catalog);
  assert.equal(fuzzy.match_method, 'fuzzy');
  assert.ok(fuzzy.confidence < 0.9, 'fuzzy matches always need one human confirmation');

  const ambiguous = matchLine(id, '@x.com', { code: '', description: 'Raw Wildflower Honey', quantity: 1, unit: '', unit_price: null }, catalog);
  assert.ok(ambiguous.flags.includes('ambiguous_match'), 'two jar sizes share the name');

  const none = matchLine(id, '@x.com', { code: 'ZZZ-999', description: 'Garden hose', quantity: 1, unit: '', unit_price: null }, catalog);
  assert.equal(none.matched_external_id, null);
  assert.ok(none.flags.includes('no_match'));
});

test('memory: a correction is reused for the same buyer only', () => {
  const { id } = makeStore();
  const catalog = loadCatalog(id);
  const honey250 = catalog.find((c) => c.sku === 'HON-RAW-250');
  const line = { code: 'CG-4471', description: 'honey small', quantity: 2, unit: '', unit_price: null };
  remember(id, '@cornergrocer.com', line, honey250.external_id);
  const again = matchLine(id, '@cornergrocer.com', line, catalog);
  assert.equal(again.match_method, 'memory');
  assert.equal(again.matched_external_id, honey250.external_id);
  const other = matchLine(id, '@othershop.com', line, catalog);
  assert.notEqual(other.match_method, 'memory');
  assert.equal(CATALOG.length, catalog.length);
});
