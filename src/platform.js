/* Evidence-backed document workspace. Model credentials are held by the local server. */
var projectModel = null;
var connection = { available: false, configured: false, provider: 'deepseek', model: '' };
var workspace = { version: 2, documents: [], activeId: null };
var legacyModel = null;
function readStorage(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
function persistDocumentModel() {
  try { localStorage.setItem('ni-workspace-v2', JSON.stringify(workspace)); }
  catch (_) { showToast('浏览器存储空间不足，本次修改尚未保存。请先导出工作区备份。'); }
}
function hydrateDocumentModel(model) {
  projectModel = model; workspace.activeId = model ? model.id : null;
  state.actions = model ? model.actions : []; state.selectedIssue = null;
  issues.splice(0, issues.length, ...(model ? model.issues : []));
  risks.splice(0, risks.length, ...(model ? model.risks : []));
  analysisState.doc = model ? model.doc : null;
  analysisState.findings = model ? model.recommendations : [];
}
function initializeDocumentModel() {
  const saved = readStorage('ni-workspace-v2');
  if (saved && saved.version === 2 && Array.isArray(saved.documents)) workspace = saved;
  legacyModel = readStorage('ni-project-model');
  workspace.documents.forEach(model => { if (model.status === 'analyzing') { model.status = model.analyzedAt ? 'analyzed' : 'parsed'; model.error = '上次分析未完成，可重新发起分析。'; } });
  hydrateDocumentModel(workspace.documents.find(model => model.id === workspace.activeId) || workspace.documents[0] || null);
}
function openAnalysisFromParsed(doc) {
  const model = { id: crypto.randomUUID(), doc, name: doc.name.replace(/\.[^.]+$/, ''), status: 'parsed', error: '', issues: [], actions: [], risks: [], recommendations: [], questions: [], report: null, analysis: null };
  workspace.documents.unshift(model); hydrateDocumentModel(model); persistDocumentModel();
  closeModal(); state.page = 'analysis'; render(); showToast('已提取原文，请核对正文后点击“联网分析”。');
}
function button(label, attr, primary = false) { return `<button class="btn ${primary ? 'primary' : ''}" ${attr}>${label}</button>`; }
function emptyCard(title, body) { return `<div class="card panel no-data"><div class="analysis-orb">⌁</div><h2>${title}</h2><p>${body}</p>${button('＋ 导入文档', 'data-import', true)}</div>`; }
function statusLabel(model) { return ({ parsed:'原文已解析 · 未分析', analyzing:'语义分析与证据复核中', analyzed:'分析完成 · 请核对结论' })[model.status] || '等待分析'; }
function dateLabel(value) { return value ? new Date(value).toLocaleString('zh-CN') : '尚未分析'; }
function levelTag(level) { return level === '高' ? 'red' : level === '中' ? 'amber' : 'blue'; }
function citationHtml(evidence) {
  if (!evidence || !evidence.length) return '<div class="finding-evidence">人工新增，无原文引用</div>';
  return evidence.map(item => {
    const block = projectModel.doc.blocks.find(block => block.id === item.blockId);
    return `<div class="finding-evidence"><button class="source-link" data-source="${esc(item.blockId)}">${esc(block ? block.location : item.blockId)} ↗</button><blockquote>${esc(item.quote)}</blockquote></div>`;
  }).join('');
}
function evidenceCard(item, type, index) {
  return `<article class="finding-item"><div class="finding-head"><span class="tag ${levelTag(item.severity)}">${esc(item.severity || '未说明')}</span><b>${esc(item.title)}</b><span class="tag blue">${type === 'recommendation' ? '优化建议' : type === 'question' ? '待澄清' : '原文风险'}</span></div><p>${esc(item.detail || item.reason || '')}</p>${item.action ? `<div class="finding-action">建议：${esc(item.action)}</div>` : ''}${citationHtml(item.evidence)}${type === 'recommendation' ? button('采纳为行动项草稿', `data-adopt="${index}"`) : ''}</article>`;
}
function analysisNotice() {
  if (location.protocol === 'file:') return `<div class="notice">当前为本地文件预览。请双击项目中的“start.command”，再打开 <a href="http://127.0.0.1:4173">联网工作台</a> 连接模型。当前文档可先解析、核对与备份。</div>`;
  if (!connection.available) return '<div class="notice">分析服务尚未连接，请确认本机工作台服务正在运行。</div>';
  if (!connection.configured) return `<div class="notice">尚未配置模型。现在可以核对原文；设置服务器环境变量后再进行语义分析。${button('查看模型设置', 'data-settings')}</div>`;
  if (connection.managed) return `<div class="notice">当前使用部署环境的模型配置。API Key 由服务器环境变量管理，网页不会显示、保存或修改密钥。${connection.configured ? '' : '请在 Vercel 项目设置中配置 DEEPSEEK_API_KEY 后重新部署。'}</div>`;
  return '';
}
pages.analysis = function () {
  const model = projectModel;
  const heading = pageHead('DOCUMENT INTELLIGENCE', '文档分析', '会议纪要与项目问题清单 · 原文、结论、建议分别保留', button('模型服务设置', 'data-settings') + button('＋ 导入文档', 'data-import', true));
  if (!model) return `<div class="page">${heading}${analysisNotice()}${legacyModel ? '<div class="notice">旧版规则结果已移至历史备份，不作为当前项目事实。可在文档列表中导出。</div>' : ''}${emptyCard('从你的真实项目资料开始', '上传文档后先核对正文，再连接模型识别项目问题、明确任务和潜在风险。未接通模型时不会生成问题或行动项。')}<div class="method-strip"><span>01 提取并核对原文</span><span>02 语义分析与复核</span><span>03 编辑、确认并保存</span></div></div>`;
  const doc = model.doc, result = model.analysis;
  const count = model.issues.length + model.actions.filter(a => a.origin === 'document').length + model.risks.length;
  const analyzeButton = `<button class="btn primary" id="runAnalysis" ${model.status === 'analyzing' || !connection.configured ? 'disabled' : ''}>${model.status === 'analyzing' ? '正在分析与复核…' : result ? '重新联网分析' : '联网分析'}</button>`;
  return `<div class="page">${heading}${analysisNotice()}<div class="analysis-summary card"><div class="analysis-file"><div class="file-icon">${esc(doc.kind)}</div><div><b>${esc(doc.name)}</b><small>${doc.blocks.length} 个文本块 · ${doc.tables.length} 个表格 · ${doc.text.length.toLocaleString()} 字符</small></div></div><div class="analysis-method"><b>${statusLabel(model)}</b><small>${result ? esc(result.meta.model) + ' · ' + dateLabel(model.analyzedAt) : '已保存原文，尚未生成结论'}</small></div>${analyzeButton}</div>${model.error ? `<div class="notice error">${esc(model.error)}${result ? ' 当前仍显示上次成功分析的结果。' : ' 本次没有生成分析结果。'}</div>` : ''}${doc.warnings && doc.warnings.length ? `<div class="notice">${doc.warnings.map(esc).join('<br>')}</div>` : ''}<div class="analysis-grid"><div><div class="card panel"><div class="panel-head"><span class="panel-title">${result ? '本次分析' : '分析前核对'}</span><span class="tag blue">${result ? count + ' 条文档记录' : '原文已就绪'}</span></div>${result ? `<p class="body-copy">当前文档识别出 ${model.issues.length} 个问题、${model.actions.filter(a => a.origin === 'document').length} 项明确任务、${model.risks.length} 条风险。每条结果可点击引用核对原文。</p><div class="item-actions">${button('查看问题', 'data-go="issues"')}${button('查看行动项', 'data-go="actions"')}${button('查看风险', 'data-go="risks"')}</div>${result.warnings && result.warnings.length ? `<div class="notice">${result.warnings.map(esc).join('<br>')}</div>` : ''}<p class="muted">已检查引用是否存在于原文，并由模型再次复核语义。复核仍可能误判，请结合项目背景确认。</p>` : '<p class="body-copy">请检查右侧正文、表格列与文件是否一致。模型会以这份文本为分析依据；图片中的文字暂未识别。点击联网分析后，提取的文本会发送至你配置的模型服务。</p>'}</div>${result ? `<div class="card panel section-gap"><div class="panel-head"><span class="panel-title">可优化的地方 · ${model.recommendations.length}</span><span class="tag amber">需人工判断</span></div><div class="finding-list">${model.recommendations.map((item, index) => evidenceCard(item, 'recommendation', index)).join('') || '<p class="muted">本次未提出有依据的优化建议。</p>'}</div></div><div class="card panel section-gap"><div class="panel-head"><span class="panel-title">需要补充确认 · ${model.questions.length}</span></div><div class="finding-list">${model.questions.map(item => evidenceCard(item, 'question')).join('') || '<p class="muted">本次没有待澄清事项。</p>'}</div></div>` : ''}</div><div class="card panel source-panel"><div class="panel-head"><span class="panel-title">解析后的原文</span><span class="tag green">可定位</span></div><input id="sourceSearch" class="search" placeholder="搜索原文关键词…" aria-label="搜索原文"/><div class="source-blocks">${doc.blocks.map(block => `<div class="source-block" id="source-${esc(block.id)}" data-block="${esc(block.id)}"><small>${esc(block.location)}</small><pre>${esc(block.text)}</pre></div>`).join('')}</div></div></div></div>`;
};
pages.overview = function () {
  if (!projectModel) return `<div class="page">${pageHead('PROJECT WORKSPACE', '项目总览', '项目经理：何雅雯')}${emptyCard('暂无项目资料', '导入会议纪要或问题清单后，项目数据会在这里汇总。')}</div>`;
  const model = projectModel;
  return `<div class="page">${pageHead('PROJECT WORKSPACE', esc(model.name), esc(model.doc.name) + ' · 项目经理：何雅雯', button('查看原文分析', 'data-go="analysis"') + button('＋ 导入文档', 'data-import', true))}<div class="card health-card"><div class="section-label">${statusLabel(model)}</div><h2>${model.analysis ? '基于当前文档的项目记录' : '等待语义分析'}</h2><p class="body-copy">${model.analysis ? '当前仅汇总所选文档中的记录；文档未说明的信息保持空缺。' : '原文已保存。配置模型并分析后，才会生成项目结论。'}</p>${model.analysis && model.analysis.project && model.analysis.project.phase ? `<div class="body-copy">阶段：${esc(model.analysis.project.phase)}${citationHtml(model.analysis.project.evidence)}</div>` : ''}</div><div class="metric-row">${[['issues','文档问题',model.issues.length],['actions','行动项草稿 / 已保存',model.actions.length],['risks','原文风险',model.risks.length]].map(([page,label,count]) => `<div class="card metric" data-go="${page}"><div class="metric-top">${label} ↗</div><div class="metric-value">${count}</div><div class="metric-foot">${model.analysis ? '来自所选文档与人工编辑' : '尚未完成分析'}</div></div>`).join('')}</div><div class="overview-bottom"><div class="card panel"><div class="panel-head"><span class="panel-title">当前问题</span>${button('查看全部', 'data-go="issues"')}</div>${model.issues.slice(0,4).map(item => `<div class="outline-row"><span>${esc(item.status)}</span><b>${esc(item.title)}</b></div>`).join('') || '<p class="muted">尚无问题记录。不能据此判断项目没有风险。</p>'}</div><div class="card panel"><div class="panel-head"><span class="panel-title">行动项</span>${button('进入清单', 'data-go="actions"')}</div>${model.actions.slice(0,4).map(item => `<div class="outline-row"><span>${actionStatus(item.status)}</span><b>${esc(item.text)}<small>${esc(item.owner || '负责人未说明')} · ${esc(item.due || '日期未说明')}</small></b></div>`).join('') || '<p class="muted">原文尚未提取出明确任务。</p>'}</div></div></div>`;
};
function actionStatus(status) { return ({pending:'待确认',confirmed:'已确认',published:'已发布',completed:'原文已完成'})[status] || '待确认'; }
pages.issues = function () {
  const heading = pageHead('ISSUE CLOSURE', '问题闭环', '仅列出原文记载的项目问题，保留已关闭状态', button('查看原文', 'data-go="analysis"'));
  if (!projectModel) return `<div class="page">${heading}${emptyCard('暂无问题记录', '导入资料并完成语义分析后查看原文问题。')}</div>`;
  const selected = projectModel.issues.find(item => item.id === state.selectedIssue);
  return `<div class="page">${heading}<div class="page-shell"><div class="card table-card"><div class="filters"><input class="search" id="issueSearch" aria-label="搜索问题" placeholder="搜索问题…"/><select class="select" id="issueStatus" aria-label="筛选问题状态"><option value="">全部状态</option><option>未关闭</option><option>已关闭</option><option>原文未说明</option></select></div><div class="table-wrap"><table class="data-table"><thead><tr><th>编号</th><th>问题</th><th>原文等级</th><th>负责人</th><th>状态</th></tr></thead><tbody>${projectModel.issues.map(item => `<tr data-issue="${esc(item.id)}" data-status="${esc(item.status)}"><td>${esc(item.id)}</td><td class="issue-desc">${esc(item.title)}</td><td><span class="tag ${levelTag(item.severity)}">${esc(item.severity)}</span></td><td>${esc(item.owner || '未说明')}</td><td>${esc(item.status)}</td></tr>`).join('')}</tbody></table></div>${!projectModel.issues.length ? '<p class="empty-copy">暂无文档问题记录。可先查看分析状态与待澄清事项。</p>' : ''}</div><div class="card detail-card">${selected ? `<div class="detail-head"><b>${esc(selected.title)}</b></div><div class="detail-section"><h4>原文说明</h4><p>${esc(selected.detail)}</p></div><div class="field-grid"><div class="field"><label>负责人</label><div>${esc(selected.owner || '原文未说明')}</div></div><div class="field"><label>期限</label><div>${esc(selected.due || '原文未说明')}</div></div></div>${citationHtml(selected.evidence)}<div class="detail-section"><h4>本地跟进记录</h4><label class="field-label">处理状态<select class="action-input" id="issueLocalStatus">${['待核对','处理中','已关闭'].map(status => `<option ${selected.localStatus === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label class="field-label">进展与关闭依据<textarea class="action-input" id="issueNote" placeholder="填写处理进展；关闭时说明验证结果和证据位置">${esc(selected.note || '')}</textarea></label>${button('保存跟进记录', 'id="saveIssue"', true)}<p class="muted">跟进状态由你维护，与上方原文状态分别保存。</p></div>` : '<div class="detail-empty">选择一个问题，核对原文证据并记录处理进展。</div>'}</div></div></div>`;
};
function editableAction(item) {
  return `<article class="action-item ${item.status === 'published' ? 'confirmed' : ''}" data-action="${esc(item.id)}"><div class="finding-head"><span class="tag ${item.status === 'published' ? 'green' : 'blue'}">${actionStatus(item.status)}</span><span class="muted">${item.origin === 'document' ? '原文明确任务' : item.origin === 'suggestion' ? '人工采纳的优化建议' : '人工新增'}</span>${item.edited ? '<span class="tag amber">已人工修改</span>' : ''}</div><div class="action-edit-grid"><label>行动项<textarea class="action-input action-text-input" data-field="text">${esc(item.text)}</textarea></label><label>负责人<input class="action-input" data-field="owner" value="${esc(item.owner)}" placeholder="原文未说明"/></label><label>截止日期<input class="action-input" data-field="due" value="${esc(item.due)}" placeholder="原文未说明，可填写明确日期"/></label></div>${citationHtml(item.evidence)}${item.original ? `<details class="original-values"><summary>模型最初提取的字段</summary><p>${esc(item.original.text)} · ${esc(item.original.owner || '负责人未说明')} · ${esc(item.original.due || '日期未说明')}</p></details>` : ''}<div class="item-actions">${button('保存修改', 'data-save-action')}${item.status !== 'completed' ? button('保存并确认', 'data-confirm-action') : ''}${button('删除', 'data-delete-action')}</div></article>`;
}
pages.actions = function () {
  const heading = pageHead('ACTION REGISTER', '项目行动项', '原文任务与人工采纳建议分别标记；发布保存到本机浏览器', button('＋ 新建行动项', 'id="newActionBtn"') + button('查看原文', 'data-go="analysis"'));
  if (!projectModel) return `<div class="page">${heading}${emptyCard('暂无行动项', '先导入一份文档，才能在其下保存任务。')}</div>`;
  const confirmed = state.actions.filter(item => item.status === 'confirmed').length, published = state.actions.filter(item => item.status === 'published').length;
  return `<div class="page">${heading}<div class="split-grid"><div class="card panel"><div class="panel-head"><span class="panel-title">行动项 · ${state.actions.length}</span></div><div class="action-queue">${state.actions.map(editableAction).join('') || '<p class="muted">未发现明确任务。优化建议需要在文档分析页主动采纳后才会进入这里。</p>'}</div></div><div class="card panel align-start"><div class="panel-head"><span class="panel-title">确认与发布</span><span class="tag green">已发布 ${published}</span></div><p class="body-copy">${confirmed} 条已确认，可发布到本地项目记录。行动项内容、负责人和截止日期必须填写完整。</p><button class="btn primary" id="publishActions" ${confirmed ? '' : 'disabled'}>发布已确认行动项</button><p class="muted">编辑会使该项重新变为待确认。发布不发送通知，也不与其他用户同步。</p>${button('导出行动项 CSV', 'id="exportActions"')}</div></div></div>`;
};
pages.risks = function () {
  const heading = pageHead('RISK REGISTER', '风险预警', '仅列原文明确描述的潜在风险；优化意见在文档分析页单独查看', button('查看原文与建议', 'data-go="analysis"'));
  if (!projectModel) return `<div class="page">${heading}${emptyCard('暂无风险记录', '上传资料并完成语义分析后查看风险。')}</div>`;
  return `<div class="page">${heading}<div class="card panel"><div class="panel-head"><span class="panel-title">原文风险 · ${projectModel.risks.length}</span><span class="tag blue">等级保留原文口径</span></div><div class="finding-list">${projectModel.risks.map(item => evidenceCard(item, 'risk')).join('') || '<p class="muted">本次没有提取出明确风险，不代表项目没有风险。</p>'}</div></div></div>`;
};
function buildReport(model) {
  const evidenceText = item => (item.evidence || []).map(e => {
    const block = model.doc.blocks.find(b => b.id === e.blockId);
    return `[${block ? block.location : e.blockId}] “${e.quote}”`;
  }).join('\n');
  const sections = [model.name + ' · 项目资料摘要', '来源：' + model.doc.name, '分析时间：' + dateLabel(model.analyzedAt), '项目经理：何雅雯', '\n一、文档问题', ...model.issues.map(item => `${item.title}（原文状态：${item.status}）\n${item.detail}\n${evidenceText(item)}`), '\n二、原文风险', ...model.risks.map(item => `${item.title}\n${item.detail}\n${evidenceText(item)}`), '\n三、已确认或已发布的行动项', ...model.actions.filter(item => ['confirmed','published'].includes(item.status)).map(item => `${item.text} · ${item.owner} · ${item.due}（${actionStatus(item.status)}）\n${evidenceText(item)}`), '\n四、待评估的优化建议（非项目事实）', ...model.recommendations.map(item => `${item.title}\n${item.detail}\n${evidenceText(item)}`)];
  return sections.join('\n\n');
}
pages.report = function () {
  const heading = pageHead('PROJECT REPORT', '项目周报', '从当前文档记录整理摘要；编辑、发布均保存于本机', button('查看文档分析', 'data-go="analysis"'));
  if (!projectModel || !projectModel.analysis) return `<div class="page">${heading}<div class="card panel no-data"><h2>尚无可依据的分析结果</h2><p>先完成语义分析、核对问题和行动项，再生成摘要。</p>${button('前往文档分析', 'data-go="analysis"', true)}</div></div>`;
  const report = projectModel.report;
  return `<div class="page">${heading}<div class="card panel"><div class="panel-head"><span class="panel-title">${report && report.status === 'published' ? '已发布到本地' : '可编辑草稿'}</span>${button('用当前记录更新草稿', 'id="refreshReport"')}</div><p class="muted">这里汇总所选文档，不推断其覆盖了整个项目或完整的一周。人工修改内容由编辑者核实。</p><textarea id="reportBody" class="report-body" aria-label="报告内容">${esc(report ? report.text : buildReport(projectModel))}</textarea><div class="item-actions">${button('保存草稿', 'id="saveReport"')}${button('发布到本地', 'id="publishReport"', true)}${button('下载摘要', 'id="downloadReport"')}</div></div></div>`;
};
function downloadFile(name, content, type = 'application/json') {
  const link = document.createElement('a'), url = URL.createObjectURL(new Blob([content], {type}));
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showProjectMenu() {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>已保存的文档</h2><p>每份文档单独分析与保存。切换文档时显示对应的问题、行动项和报告。</p><div class="document-list">${workspace.documents.map(model => `<button class="document-choice ${model === projectModel ? 'current' : ''}" data-document="${esc(model.id)}"><b>${esc(model.doc.name)}</b><small>${statusLabel(model)} · ${model.actions.length} 个行动项</small></button>`).join('') || '<p>还没有保存的文档。</p>'}</div><div class="item-actions">${button('导出工作区备份', 'id="exportWorkspace"')}${button('恢复工作区备份', 'id="restoreWorkspace"')}${legacyModel ? button('导出旧版历史备份', 'id="exportLegacy"') : ''}</div><input id="backupFile" type="file" accept=".json" hidden/><p class="muted">旧 file:// 页面与联网页面使用不同的浏览器存储，可通过导出、恢复备份迁移。文档与备份可能包含项目内容，请保存在合适的位置。</p><div class="modal-actions">${button('关闭', 'data-close')}${button('＋ 导入文档', 'data-import', true)}</div></div></div>`;
  document.querySelectorAll('[data-document]').forEach(el => el.onclick = () => { hydrateDocumentModel(workspace.documents.find(model => model.id === el.dataset.document)); persistDocumentModel(); closeModal(); render(); });
  document.getElementById('exportWorkspace').onclick = () => downloadFile('China-wertigate-工作区备份.json', JSON.stringify(workspace, null, 2));
  document.getElementById('exportLegacy')?.addEventListener('click', () => downloadFile('旧版规则结果-未经验证.json', JSON.stringify(legacyModel, null, 2)));
  const input = document.getElementById('backupFile');
  document.getElementById('restoreWorkspace').onclick = () => input.click();
  input.onchange = async () => {
    try {
      if (!input.files[0] || input.files[0].size > 20000000) throw new Error('请选择不超过 20MB 的工作区备份。');
      const backup = JSON.parse(await input.files[0].text());
      if (backup.version !== 2 || !Array.isArray(backup.documents) || backup.documents.some(model => !model.id || !model.doc || !Array.isArray(model.doc.blocks) || !['issues','actions','risks','recommendations','questions'].every(key => Array.isArray(model[key])))) throw new Error('备份结构不正确，请选择此工作台导出的 JSON 文件。');
      const restored = backup.documents.filter(model => !workspace.documents.some(existing => existing.id === model.id));
      workspace.documents.push(...restored);
      if (!projectModel && restored[0]) hydrateDocumentModel(restored[0]);
      persistDocumentModel(); closeModal(); render(); showToast(`已恢复 ${restored.length} 份文档；已有文档保留当前版本。`);
    } catch (error) { showToast(error.message || '无法恢复此备份。'); }
  };
  bindPage();
}
async function apiRequest(path, options = {}) {
  if (location.protocol === 'file:') throw new Error('请先启动本机工作台，使用 http://127.0.0.1:4173 打开页面。');
  let response;
  try { response = await fetch(path, { ...options, headers: { 'Content-Type':'application/json', 'X-Requested-With':'China-wertigate', ...(options.headers || {}) } }); }
  catch (_) { throw new Error('无法连接本机分析服务，请确认“start.command”正在运行。'); }
  let payload;
  try { payload = await response.json(); } catch (_) { throw new Error('本机服务返回异常，请重新启动工作台。'); }
  if (!response.ok) throw new Error(payload.error?.message || '请求失败，请检查模型设置后重试。');
  return payload;
}
async function refreshConnection() {
  try { connection = { ...(await apiRequest('/api/config')), available: true }; }
  catch (_) { connection = { ...connection, available: false, configured: false }; }
  updateConnectionBadge();
}
function updateConnectionBadge() {
  const badge = document.querySelector('.ai-status');
  badge.innerHTML = `<span class="pulse ${connection.configured ? '' : 'inactive'}"></span><div><b>${connection.configured ? '模型已配置' : 'AI 尚未配置'}</b><small>${connection.configured ? esc(connection.model) : '请先核对导入原文'}</small></div>`;
}
async function showSettings() {
  await refreshConnection();
  const providers = connection.providers || [{id:'deepseek',label:'DeepSeek',defaultModel:'deepseek-flash'}];
  const managedNotice = connection.managed ? '<div class="notice">这是生产部署配置。请在 Vercel 项目 Settings → Environment Variables 中设置 <code>DEEPSEEK_API_KEY</code> 和 <code>DEEPSEEK_MODEL</code>，然后重新部署。网页不会接受个人 Key。</div>' : '';
  const clientFields = connection.managed ? `<div class="field-label">配置来源<div class="action-input readonly">服务器环境变量（仅后端可读）</div></div>` : `<label class="field-label">模型服务<select id="provider" class="action-input">${providers.map(provider => `<option value="${esc(provider.id)}" ${connection.provider === provider.id ? 'selected' : ''}>${esc(provider.label)}</option>`).join('')}</select></label><label class="field-label">模型名称<input id="modelName" class="action-input" required value="${esc(connection.model || providers[0].defaultModel)}"/></label><label class="field-label">API Key<input type="password" class="action-input" id="modelKey" autocomplete="off" spellcheck="false" placeholder="${connection.configured ? '已有密钥；留空保留' : '在此输入服务商提供的 API Key'}"/></label><p class="muted">本地模式下密钥仅保存在服务运行内存中；不会写入文档、浏览器存储或工作区备份。可在 <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer">DeepSeek 开放平台</a> 开通 API 服务。</p>`;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop"><form class="modal" id="modelSettings"><h2>模型服务设置</h2><p>连接后可分析会议纪要与问题清单。分析时将提取的文档文本发送给所选服务商，其 API 费用按你的服务账户计费。</p>${location.protocol === 'file:' ? '<div class="notice">请先双击“start.command”，再从联网页面配置。</div>' : ''}${managedNotice}${clientFields}<div class="analysis-error" id="settingsMessage" role="status"></div><div class="modal-actions">${connection.managed ? '' : '<button type="button" class="btn" id="clearConfig">清除配置</button>'}<button type="button" class="btn" data-close>关闭</button>${connection.managed ? '' : `<button type="submit" class="btn primary" ${connection.available ? '' : 'disabled'}>保存并测试连接</button>`}</div></form></div>`;
  if (connection.managed) { bindPage(); return; }
  document.getElementById('provider').onchange = function () { document.getElementById('modelName').value = providers.find(provider => provider.id === this.value).defaultModel; document.getElementById('modelKey').value = ''; };
  document.getElementById('modelSettings').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, message = document.getElementById('settingsMessage');
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true; message.textContent = '正在保存设置并测试连接…';
    const keyInput = document.getElementById('modelKey');
    const config = { provider: document.getElementById('provider').value, model: document.getElementById('modelName').value.trim(), apiKey: '' };
    if (keyInput.value.trim()) config.apiKey = keyInput.value.trim();
    try {
      await apiRequest('/api/config', {method:'POST', body:JSON.stringify(config)});
      keyInput.value = ''; delete config.apiKey;
      await apiRequest('/api/test', {method:'POST', body:'{}'});
      message.textContent = '连接测试成功。关闭设置后即可分析文档。'; message.classList.add('success');
    } catch (error) { message.textContent = error.message; message.classList.remove('success'); }
    finally { keyInput.value = ''; delete config.apiKey; submit.disabled = false; await refreshConnection(); render(); }
  };
  document.getElementById('clearConfig').onclick = async () => {
    try { await apiRequest('/api/config', {method:'DELETE'}); await refreshConnection(); closeModal(); render(); showToast('模型配置已清除。'); }
    catch (error) { document.getElementById('settingsMessage').textContent = error.message; }
  };
  bindPage();
}
function normalizeResultItem(item) {
  return { ...item, status: item.status === 'closed' ? '已关闭' : item.status === 'open' ? '未关闭' : '原文未说明', evidence:item.evidence || [] };
}
async function runAnalysis() {
  const model = projectModel;
  if (!model || model.status === 'analyzing') return;
  if (model.analysis) {
    document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>重新分析此文档</h2><p>将使用当前模型重新识别。原有结果、人工编辑的行动项和报告会完整保留在一个历史文档副本中，新结果作为当前版本。</p><div class="modal-actions">${button('取消', 'data-close')}${button('保留旧版并分析', 'id="confirmReanalysis"', true)}</div></div></div>`;
    document.getElementById('confirmReanalysis').onclick = () => { closeModal(); performAnalysis(model, true); };
    bindPage(); return;
  }
  await performAnalysis(model, false);
}
async function performAnalysis(model, archivePrevious) {
  model.status = 'analyzing'; model.error = ''; persistDocumentModel(); render();
  try {
    const result = await apiRequest('/api/analyze', {method:'POST', body:JSON.stringify({document:{name:model.doc.name,kind:model.doc.kind,blocks:model.doc.blocks},focus:'会议纪要和项目问题清单；区分已发生问题、潜在风险、明确任务、已完成事项和优化建议。'})});
    if (archivePrevious) {
      const previous = structuredClone(model); previous.id = crypto.randomUUID(); previous.doc.name += '（上次分析）'; previous.status = 'analyzed';
      workspace.documents.push(previous);
    }
    model.analysis = result; model.analyzedAt = result.meta.analyzedAt;
    model.name = result.project && result.project.name ? result.project.name : model.doc.name.replace(/\.[^.]+$/, '');
    model.issues = result.issues.map(normalizeResultItem); model.risks = result.risks.map(normalizeResultItem);
    model.recommendations = result.suggestions; model.questions = result.questions;
    const manualItems = !archivePrevious ? model.actions.filter(item => item.origin !== 'document') : [];
    model.actions = result.actions.map(item => ({ ...item, text:item.title, owner:item.owner || '', due:item.due || '', status:item.status === 'closed' ? 'completed' : 'pending', origin:'document', original:{text:item.title,owner:item.owner,due:item.due} })).concat(manualItems);
    model.status = 'analyzed'; model.report = null;
    if (projectModel.id === model.id) hydrateDocumentModel(model);
    showToast('分析与引用复核已完成，请检查原文后确认行动项。');
  } catch (error) { model.error = error.message; model.status = model.analysis ? 'analyzed' : 'parsed'; }
  finally { persistDocumentModel(); render(); }
}
function showSource(blockId) {
  state.page = 'analysis'; render();
  const block = document.getElementById('source-' + blockId);
  if (block) { block.classList.add('highlight'); block.scrollIntoView({behavior:'smooth',block:'center'}); }
}
function saveActionFields(element, confirm) {
  const item = state.actions.find(action => action.id === element.dataset.action);
  const previous = {text:item.text,owner:item.owner,due:item.due};
  element.querySelectorAll('[data-field]').forEach(input => { item[input.dataset.field] = input.value.trim(); });
  if (['text','owner','due'].some(key => item[key] !== previous[key])) { item.edited = true; item.status = 'pending'; }
  if (confirm) {
    if (!item.text || !item.owner || !item.due || /^(待指定|未说明|待确认)$/.test(item.owner) || /^(待指定|未说明|待确认)$/.test(item.due)) {
      persistDocumentModel(); render(); showToast('已保存草稿；请填写行动项、负责人和明确截止日期后再确认。'); return;
    }
    item.status = 'confirmed';
  }
  persistDocumentModel(); render(); showToast(confirm ? '已保存并确认，可发布到本地记录。' : '已保存修改。');
}
function bindWorkspace() {
  bindPage();
  document.getElementById('projectSwitcher').onclick = showProjectMenu;
  document.querySelector('.settings').onclick = showSettings;
  document.getElementById('topSettings').onclick = showSettings;
  document.getElementById('runAnalysis')?.addEventListener('click', runAnalysis);
  document.querySelectorAll('[data-source]').forEach(button => button.onclick = () => showSource(button.dataset.source));
  document.querySelectorAll('[data-adopt]').forEach(button => button.onclick = () => {
    const item = projectModel.recommendations[Number(button.dataset.adopt)];
    if (state.actions.some(action => action.suggestionId === item.id)) { showToast('这条建议已经采纳，可在行动项中编辑。'); return; }
    state.actions.push({id:crypto.randomUUID(),suggestionId:item.id,text:item.action || item.title,owner:'',due:'',status:'pending',origin:'suggestion',evidence:item.evidence});
    persistDocumentModel(); state.page = 'actions'; render(); showToast('建议已转为草稿，请填写负责人和期限。');
  });
  document.getElementById('sourceSearch')?.addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('[data-block]').forEach(block => { block.hidden = query && !block.textContent.toLowerCase().includes(query); });
  });
  document.querySelectorAll('[data-issue]').forEach(row => row.onclick = () => { state.selectedIssue = row.dataset.issue; render(); });
  const filterIssues = () => {
    const query = document.getElementById('issueSearch').value.trim().toLowerCase(), status = document.getElementById('issueStatus').value;
    document.querySelectorAll('[data-issue]').forEach(row => { row.hidden = !(row.textContent.toLowerCase().includes(query) && (!status || row.dataset.status === status)); });
  };
  document.getElementById('issueSearch')?.addEventListener('input', filterIssues);
  document.getElementById('issueStatus')?.addEventListener('change', filterIssues);
  document.getElementById('saveIssue')?.addEventListener('click', () => {
    const issue = projectModel.issues.find(item => item.id === state.selectedIssue), note = document.getElementById('issueNote').value.trim(), status = document.getElementById('issueLocalStatus').value;
    if (status === '已关闭' && !note) { showToast('请记录关闭时的验证结果和证据位置。'); return; }
    issue.note = note; issue.localStatus = status; persistDocumentModel(); showToast('本地跟进记录已保存。');
  });
  document.getElementById('newActionBtn')?.addEventListener('click', () => {
    if (!projectModel) { showImport(); return; }
    state.actions.unshift({id:crypto.randomUUID(),text:'',owner:'',due:'',status:'pending',origin:'manual',evidence:[]}); persistDocumentModel(); render();
  });
  document.querySelectorAll('[data-save-action]').forEach(button => button.onclick = () => saveActionFields(button.closest('[data-action]'),false));
  document.querySelectorAll('[data-confirm-action]').forEach(button => button.onclick = () => saveActionFields(button.closest('[data-action]'),true));
  document.querySelectorAll('[data-delete-action]').forEach(button => button.onclick = () => { const index = state.actions.findIndex(item => item.id === button.closest('[data-action]').dataset.action); state.actions.splice(index,1); persistDocumentModel(); render(); });
  document.querySelectorAll('[data-action] [data-field]').forEach(input => input.oninput = () => {
    const item = state.actions.find(action => action.id === input.closest('[data-action]').dataset.action);
    item.status = 'pending';
    const badge = input.closest('[data-action]').querySelector('.tag'); badge.textContent = '有未保存修改'; badge.className = 'tag amber';
    const publish = document.getElementById('publishActions'); if (publish) publish.disabled = !state.actions.some(action => action.status === 'confirmed');
    persistDocumentModel();
  });
  document.getElementById('publishActions')?.addEventListener('click', () => {
    const confirmed = state.actions.filter(item => item.status === 'confirmed');
    confirmed.forEach(item => { item.status = 'published'; item.publishedAt = new Date().toISOString(); }); persistDocumentModel(); render(); showToast(`已将 ${confirmed.length} 条行动项发布到本地。`);
  });
  document.getElementById('exportActions')?.addEventListener('click', () => {
    const rows = [['行动项','负责人','截止日期','状态','来源类型','原文引用'],...state.actions.map(item => [item.text,item.owner,item.due,actionStatus(item.status),item.origin,(item.evidence || []).map(e => e.blockId + '：' + e.quote).join('\n')])];
    const csv = rows.map(row => row.map(value => '"' + String(value || '').replace(/^[=+@-]/,"'$&").replace(/"/g,'""') + '"').join(',')).join('\r\n');
    downloadFile('项目行动项.csv','\ufeff' + csv,'text/csv;charset=utf-8');
  });
  const saveReport = status => { projectModel.report = {text:document.getElementById('reportBody').value,status,updatedAt:new Date().toISOString()}; persistDocumentModel(); };
  document.getElementById('saveReport')?.addEventListener('click', () => { saveReport('draft'); showToast('报告草稿已保存。'); });
  document.getElementById('publishReport')?.addEventListener('click', () => { saveReport('published'); render(); showToast('报告已发布到本地。'); });
  document.getElementById('downloadReport')?.addEventListener('click', () => { saveReport('draft'); downloadFile(projectModel.name + '-摘要.txt',projectModel.report.text,'text/plain;charset=utf-8'); });
  document.getElementById('refreshReport')?.addEventListener('click', () => {
    if (projectModel.report) downloadFile(projectModel.name + '-原报告备份.txt',document.getElementById('reportBody').value,'text/plain;charset=utf-8');
    projectModel.report = {text:buildReport(projectModel),status:'draft'}; persistDocumentModel(); render(); showToast('已按当前记录更新；原有报告编辑已下载备份。');
  });
}
function render() {
  const titles = {analysis:'文档分析',overview:'项目总览',issues:'问题闭环',actions:'项目行动项',risks:'风险预警',report:'项目周报'};
  document.getElementById('pageTitle').textContent = titles[state.page];
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active',button.dataset.page === state.page));
  document.getElementById('projectSwitcher').innerHTML = `<span class="project-dot"></span><span><b>${esc(projectModel ? projectModel.name : '文档工作区')}</b><small>${workspace.documents.length} 份文档 · 点击切换</small></span><span class="chevron">⌄</span>`;
  [['issues',projectModel ? projectModel.issues.length : '—'],['actions',state.actions.length || '—'],['risks',projectModel ? projectModel.risks.length : '—']].forEach(([page,count]) => { document.querySelector(`[data-page="${page}"] .nav-badge`).textContent = count; });
  document.getElementById('pageContainer').innerHTML = pages[state.page](); updateConnectionBadge(); bindWorkspace();
}
initializeDocumentModel(); render();
refreshConnection().then(() => render());
