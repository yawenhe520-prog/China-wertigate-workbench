const analysisState = { doc: null, busy: false, error: null };
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_CHARACTERS = 90000;

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function documentFromBlocks(name, kind, blocks, tables = []) {
  const usefulBlocks = blocks.filter(block => block.text.trim());
  if (!usefulBlocks.length) throw new Error('未读取到文本。请检查文件内容；扫描图片需要先转为可选择的文字。');
  const numberedBlocks = usefulBlocks.map((block, index) => ({
    id: `B${String(index + 1).padStart(4, '0')}`,
    location: block.location,
    text: block.text
  }));
  const lines = numberedBlocks.map(block => block.text);
  const text = lines.join('\n');
  if (text.length > MAX_DOCUMENT_CHARACTERS) {
    throw new Error(`提取到 ${text.length.toLocaleString()} 个字符，超过单次 90,000 字符限制。请拆分文档后导入；本次未截断内容。`);
  }
  return { name, kind, text, lines, blocks: numberedBlocks, tables, paragraphCount: numberedBlocks.length, size: 0, warnings: [] };
}

function textFromWordNode(node) {
  if (node.nodeType !== 1) return '';
  if (node.localName === 't') return node.textContent;
  if (node.localName === 'tab') return '\t';
  if (node.localName === 'br' || node.localName === 'cr') return '\n';
  if (node.localName === 'del') return '';
  return Array.from(node.children).map(textFromWordNode).join('');
}

function parseWordXml(xml, name) {
  const xmlDoc = new DOMParser().parseFromString(xml, 'application/xml');
  if (xmlDoc.getElementsByTagName('parsererror').length) throw new Error('DOCX 正文 XML 损坏，无法读取。请用 Word 重新另存为 DOCX。');
  const body = Array.from(xmlDoc.getElementsByTagName('*')).find(node => node.localName === 'body');
  if (!body) throw new Error('DOCX 中没有找到正文。');
  const blocks = [];
  const tables = [];
  let paragraphNumber = 0;
  function wordNumber(node, property) {
    const element = Array.from(node?.children || []).find(child => child.localName === property);
    const value = Array.from(element?.attributes || []).find(attribute => attribute.localName === 'val')?.value;
    const count = Math.max(0, Number.parseInt(value, 10) || 0);
    if (count > 1000) throw new Error('DOCX 表格列数异常，请检查合并单元格后重新导入。');
    return count;
  }
  function cellParagraphs(cell) {
    return Array.from(cell.children).flatMap(child => {
      if (child.localName === 'p') return [textFromWordNode(child)];
      if (['sdt', 'sdtContent', 'customXml'].includes(child.localName)) return cellParagraphs(child);
      return [];
    });
  }
  function tableRow(row) {
    const properties = Array.from(row.children).find(child => child.localName === 'trPr');
    const cells = Array(wordNumber(properties, 'gridBefore')).fill('');
    for (const cell of Array.from(row.children).filter(child => child.localName === 'tc')) {
      cells.push(cellParagraphs(cell).join('\n'));
      const cellProperties = Array.from(cell.children).find(child => child.localName === 'tcPr');
      cells.push(...Array(Math.max(0, wordNumber(cellProperties, 'gridSpan') - 1)).fill(''));
    }
    cells.push(...Array(wordNumber(properties, 'gridAfter')).fill(''));
    return cells;
  }
  function readContainer(container) {
    for (const node of container.children) {
      if (node.localName === 'p') {
        paragraphNumber += 1;
        blocks.push({ location: `段落 ${paragraphNumber}`, text: textFromWordNode(node) });
      } else if (node.localName === 'tbl') {
        const rows = Array.from(node.children).filter(child => child.localName === 'tr').map(tableRow);
        tables.push(rows);
        rows.forEach((row, index) => {
          if (row.some(cell => cell.trim())) blocks.push({ location: `表格 ${tables.length} · 第 ${index + 1} 行`, text: row.join(' | ') });
        });
      } else if (node.localName === 'sdt' || node.localName === 'sdtContent' || node.localName === 'customXml') {
        readContainer(node);
      }
    }
  }
  readContainer(body);
  const doc = documentFromBlocks(name, 'DOCX', blocks, tables);
  doc.warnings.push('已读取正文段落和表格。图片、批注、页眉页脚及嵌入对象不参与分析；请核对原文预览。');
  if (Array.from(body.getElementsByTagName('*')).some(node => node.localName === 'tbl' && node.parentElement?.localName === 'tc')) {
    doc.warnings.push('文档包含嵌套表格，嵌套内容未读取。请将相关表格单独复制为文本后导入。');
  }
  return doc;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let mode = 'plain';
  let line = 1;
  let startLine = 1;
  let recordStarted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (mode === 'quoted') {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; }
        else mode = 'closed';
      } else {
        cell += character;
        if (character === '\n' || (character === '\r' && text[index + 1] !== '\n')) line += 1;
      }
      continue;
    }
    if (mode === 'closed' && character !== ',' && character !== '\r' && character !== '\n') {
      throw new Error(`CSV 第 ${line} 行：结束引号后应为逗号或换行。`);
    }
    if (character === '"') {
      if (cell.length) throw new Error(`CSV 第 ${line} 行：单元格中的引号必须成对转义。`);
      mode = 'quoted';
      recordStarted = true;
    } else if (character === ',') {
      row.push(cell); cell = ''; mode = 'plain'; recordStarted = true;
    } else if (character === '\r' || character === '\n') {
      row.push(cell);
      rows.push({ cells: row, line: startLine });
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      line += 1; startLine = line; row = []; cell = ''; mode = 'plain'; recordStarted = false;
    } else {
      cell += character; recordStarted = true;
    }
  }
  if (mode === 'quoted') throw new Error(`CSV 第 ${startLine} 行开始的单元格缺少结束引号。`);
  if (recordStarted || row.length || cell.length || mode === 'closed') rows.push({ cells: [...row, cell], line: startLine });
  return rows;
}

function parseTextDocument(text, name = '粘贴文本', kind = 'TEXT') {
  const source = String(text).replace(/^\uFEFF/, '');
  if (source.includes('\uFFFD')) throw new Error('文本包含无法解码的字符。请将文件另存为 UTF-8 后重新导入，避免错误识别。');
  if (kind === 'CSV') {
    const rows = parseCsvRows(source);
    const doc = documentFromBlocks(name, kind, rows.filter(row => row.cells.some(cell => cell.trim())).map(row => ({
      location: `CSV · 第 ${row.line} 行`, text: row.cells.join(' | ')
    })), [rows.map(row => row.cells)]);
    if (rows.some(row => row.cells.length !== rows[0].cells.length)) doc.warnings.push('CSV 各行列数不一致，已保留原始单元格。请核对表头与数据列是否对应。');
    return doc;
  }
  return documentFromBlocks(name, kind, source.split(/\r\n|\n|\r/).map((line, index) => ({ location: `第 ${index + 1} 行`, text: line })));
}

async function parseUploadedFile(file) {
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('文件超过 20 MB。请拆分文件后再导入。');
  const extension = file.name.split('.').pop().toLowerCase();
  let doc;
  if (extension === 'docx') {
    if (typeof JSZip === 'undefined') throw new Error('DOCX 解析组件未加载，请刷新页面后重试。');
    let zip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
    catch { throw new Error('文件不是可读取的 DOCX，可能已损坏或设置了打开密码。'); }
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('文件不是有效的 DOCX：缺少正文。');
    doc = parseWordXml(await entry.async('string'), file.name);
  } else if (['txt', 'md', 'csv'].includes(extension)) {
    doc = parseTextDocument(await file.text(), file.name, extension.toUpperCase());
  } else {
    throw new Error('支持 DOCX、TXT、MD、CSV。PDF 或图片请先转为文本；Excel 请导出为 UTF-8 CSV。');
  }
  doc.size = file.size;
  return doc;
}

function showImport() {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="importTitle"><h2 id="importTitle">读取项目文档</h2><p>上传会议纪要或项目问题清单，先核对提取的原文，再单独启动 AI 分析。读取文件时不会发送到模型服务。</p><p>每份新文档会打开独立工作区，之前的记录仍可在文档选择器中切换。</p><label class="dropzone" for="analysisFile" style="display:block;cursor:pointer"><strong>选择 DOCX / TXT / MD / CSV</strong><span>单文件不超过 20 MB · 正文不超过 90,000 字符</span><input id="analysisFile" type="file" accept=".docx,.txt,.md,.csv" style="display:none"></label><p id="analysisFileName" aria-live="polite"></p><label for="analysisText">或直接粘贴正文</label><textarea id="analysisText" style="width:100%;min-height:120px;margin-top:8px;border:1px solid #dae4e7;border-radius:7px;padding:10px;resize:vertical;font:inherit" placeholder="粘贴会议纪要或项目问题清单…"></textarea><p id="analysisError" role="alert" style="min-height:18px;color:#b84c4c"></p><div class="modal-actions"><button class="btn" id="cancelAnalysis">取消</button><button class="btn primary" id="startAnalysis">读取文档</button></div></div></div>`;
  const fileInput = document.getElementById('analysisFile');
  const pastedInput = document.getElementById('analysisText');
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    document.getElementById('analysisFileName').textContent = file ? `已选择：${file.name}` : '';
    if (file) pastedInput.value = '';
  };
  pastedInput.oninput = () => {
    if (pastedInput.value) {
      fileInput.value = '';
      document.getElementById('analysisFileName').textContent = '';
    }
  };
  document.getElementById('cancelAnalysis').onclick = closeModal;
  document.getElementById('startAnalysis').onclick = async () => {
    const file = fileInput.files[0];
    const pasted = pastedInput.value;
    const error = document.getElementById('analysisError');
    if (!file && !pasted.trim()) { error.textContent = '请先选择文件或粘贴正文。'; return; }
    const button = document.getElementById('startAnalysis');
    button.disabled = true; button.textContent = '读取中…'; error.textContent = '';
    try {
      const doc = file ? await parseUploadedFile(file) : parseTextDocument(pasted);
      if (!file) doc.size = new Blob([pasted]).size;
      await openAnalysisFromParsed(doc);
      closeModal();
    } catch (problem) {
      button.disabled = false; button.textContent = '读取文档';
      error.textContent = problem.message || '读取失败，请检查文件格式。';
    }
  };
}
