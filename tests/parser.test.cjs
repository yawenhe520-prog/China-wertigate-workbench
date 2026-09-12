const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

let browser;
let page;
let browserAvailable = true;
before(async () => {
  try {
    const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!fs.existsSync(executablePath)) throw new Error('Chrome executable unavailable');
    browser = await chromium.launch({ headless: true, executablePath });
    page = await browser.newPage();
    await page.addScriptTag({ path: path.join(__dirname, '../vendor/jszip.min.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../src/enhance.js') });
  } catch (error) {
    browserAvailable = false;
    console.warn(`Parser browser tests skipped: ${error.message}`);
    return;
  }
});
after(async () => { await browser?.close(); });

const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t xml:space="preserve"> 项目 &amp; 验证 </w:t><w:br/><w:t>尚未关闭</w:t></w:r><w:del><w:r><w:delText>已关闭</w:delText></w:r></w:del></w:p>
<w:p/>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>问题</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>负责人</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>截止时间</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>异响</w:t></w:r></w:p><w:p><w:r><w:t>复测中</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>2026-09-20</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并项</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>待确认</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl><w:p><w:r><w:t>结束 &lt;审核&gt;</w:t></w:r></w:p>
</w:body></w:document>`;

test('DOCX keeps empty and merged columns, cell paragraphs, XML text and source locations', async t => {
  if (!browserAvailable) { t.skip('Chrome unavailable'); return; }
  const doc = await page.evaluate(source => parseWordXml(source, '项目.docx'), xml);
  assert.equal(doc.blocks[0].text, ' 项目 & 验证 \n尚未关闭');
  assert.equal(doc.blocks[0].location, '段落 1');
  assert.deepEqual(doc.tables[0][1], ['异响\n复测中', '', '2026-09-20']);
  assert.equal(doc.blocks[2].location, '表格 1 · 第 2 行');
  assert.equal(doc.blocks[2].text, '异响\n复测中 |  | 2026-09-20');
  assert.deepEqual(doc.tables[0][2], ['合并项', '', '待确认']);
  assert.equal(doc.blocks.at(-1).location, '段落 3');
  assert.equal(doc.blocks.at(-1).text, '结束 <审核>');
  assert.equal(doc.blocks.at(-1).id, 'B0005');
  assert.ok(!doc.text.includes('已关闭'));
});

test('DOCX uploads read ZIP content and record original file size', async t => {
  if (!browserAvailable) { t.skip('Chrome unavailable'); return; }
  const doc = await page.evaluate(async source => {
    const zip = new JSZip();
    zip.file('word/document.xml', source);
    const blob = await zip.generateAsync({ type: 'blob' });
    return parseUploadedFile(new File([blob], '会议纪要.DOCX'));
  }, xml);
  assert.equal(doc.kind, 'DOCX');
  assert.equal(doc.name, '会议纪要.DOCX');
  assert.ok(doc.size > 0);
  assert.ok(doc.blocks.length > 0);
});

test('CSV preserves quoted commas, escaped quotes, multiline cells and physical line numbers', async t => {
  if (!browserAvailable) { t.skip('Chrome unavailable'); return; }
  const doc = await page.evaluate(() => parseTextDocument('问题,负责人,截止\r\n"异响,复测",,2026-09-20\r\n"补充\n\"\"测量\"\"记录",何雅雯,\r\n后续,待定,\r\n', '清单.csv', 'CSV'));
  assert.deepEqual(doc.tables[0][1], ['异响,复测', '', '2026-09-20']);
  assert.deepEqual(doc.tables[0][2], ['补充\n"测量"记录', '何雅雯', '']);
  assert.deepEqual(doc.tables[0][3], ['后续', '待定', '']);
  assert.equal(doc.blocks[3].location, 'CSV · 第 5 行');
  assert.equal(doc.tables[0].length, 4);
});

test('plain text retains whitespace and source line numbers without inventing findings', async t => {
  if (!browserAvailable) { t.skip('Chrome unavailable'); return; }
  const doc = await page.evaluate(() => parseTextDocument('\uFEFF  会议记录  \n\n没有发现异响。\r\n评审已经完成。', '会议.md', 'MD'));
  assert.equal(doc.blocks[0].text, '  会议记录  ');
  assert.equal(doc.blocks[1].location, '第 3 行');
  assert.equal(doc.blocks[1].text, '没有发现异响。');
  assert.equal(doc.blocks[2].location, '第 4 行');
  assert.equal(Object.hasOwn(doc, 'findings'), false);
});

test('malformed XML, malformed CSV, empty and oversized text fail explicitly', async t => {
  if (!browserAvailable) { t.skip('Chrome unavailable'); return; }
  const errors = await page.evaluate(() => {
    const attempts = [
      () => parseWordXml('<w:document>', '坏.docx'),
      () => parseTextDocument('问题,负责人\n"未结束,张三', '坏.csv', 'CSV'),
      () => parseTextDocument('"问题"无效,张三', '坏.csv', 'CSV'),
      () => parseTextDocument(' \n\n'),
      () => parseTextDocument('字'.repeat(90001)),
      () => parseTextDocument('编码\uFFFD错误')
    ];
    return attempts.map(run => { try { run(); return ''; } catch (error) { return error.message; } });
  });
  assert.match(errors[0], /XML 损坏/);
  assert.match(errors[1], /缺少结束引号/);
  assert.match(errors[2], /结束引号后/);
  assert.match(errors[3], /未读取到文本/);
  assert.match(errors[4], /未截断内容/);
  assert.match(errors[5], /UTF-8/);
});

test('unsupported and oversized files fail before any remote analysis', async t => {
  if (!browserAvailable) { t.skip('Chrome unavailable'); return; }
  const errors = await page.evaluate(async () => {
    const files = [new File(['example'], '规范.pdf'), { name: '大文件.txt', size: 20 * 1024 * 1024 + 1 }];
    return Promise.all(files.map(async file => { try { await parseUploadedFile(file); return ''; } catch (error) { return error.message; } }));
  });
  assert.match(errors[0], /支持 DOCX/);
  assert.match(errors[1], /20 MB/);
});

test('import preview calls only local workspace handler and safely displays filenames', async t => {
  if (!browserAvailable) { t.skip('Chrome unavailable'); return; }
  await page.setContent('<div id="modalRoot"></div>');
  await page.evaluate(() => {
    window.closeModal = () => { document.getElementById('modalRoot').innerHTML = ''; };
    window.openAnalysisFromParsed = async doc => { window.importedDocument = doc; };
    window.fetch = () => { throw new Error('Import must not call network'); };
    showImport();
  });
  await page.locator('#analysisText').fill('会议纪要\n何雅雯负责复测，截止日期待确认。');
  await page.locator('#startAnalysis').click();
  const imported = await page.evaluate(() => window.importedDocument);
  assert.equal(imported.kind, 'TEXT');
  assert.equal(imported.blocks[1].text, '何雅雯负责复测，截止日期待确认。');
  assert.equal(await page.locator('#modalRoot').textContent(), '');
});
