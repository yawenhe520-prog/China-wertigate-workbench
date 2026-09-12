const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

test('document workflow, connection, evidence, editing, publishing and persistence', async () => {
  const { createAppServer } = await import('../server.mjs');
  const { createAnalysisService } = await import('../server/analysis.mjs');
  let upstreamCalls = 0;
  let rejectNextAnalysis = false;
  const service = createAnalysisService({ env: {}, fetchImpl: async (url, options) => {
    upstreamCalls++;
    const body = JSON.parse(options.body);
    let result;
    if (body.messages[1].content.startsWith('Test connection')) result = {ok:true};
    else {
      if (rejectNextAnalysis) return new Response('',{status:429});
      const input = JSON.parse(body.messages[1].content);
      if (input.candidates) result = {documentType:'minutes',project:{nameSupported:true,phaseSupported:false},verdicts:input.candidates.items.map(item => ({id:item.id,decision:'keep',reason:'测试夹具明确引用原文'}))};
      else {
        const evidence = [{blockId:input.document.blocks[1].id,quote:input.document.blocks[1].text}];
        result = {documentType:'minutes',project:{name:'测试项目',phase:null,evidence:[{blockId:input.document.blocks[0].id,quote:input.document.blocks[0].text}]},items:[
          {id:'issue-1',category:'issue',title:'门板开裂',detail:'样件开裂，需要复测。',severity:'未标注',owner:null,due:null,status:'open',evidence},
          {id:'action-1',category:'action',title:'完成门板复测',detail:'原文明确任务',severity:'未标注',owner:'何雅雯',due:'2026-09-20',status:'open',evidence},
          {id:'suggestion-1',category:'suggestion',title:'建议记录复测尺寸',detail:'建议在复测时保留尺寸数据以便核对。',severity:'未标注',owner:null,due:null,status:'unknown',evidence},
          {id:'bad-citation',category:'issue',title:'无依据的条目',detail:'不应展示',severity:'未标注',owner:null,due:null,status:'open',evidence:[{blockId:input.document.blocks[1].id,quote:'不存在的原文'}]}
        ]};
      }
    }
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
  }});
  const server = createAppServer({service});
  await new Promise((resolve,reject) => { server.on('error',reject); server.listen(0,'127.0.0.1',resolve); });
  let browser;
  try {
    browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = []; page.on('pageerror',error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await page.waitForFunction(() => connection.available);
    assert.match(await page.locator('.brand').innerText(),/China wertigate/);
    assert.match(await page.locator('.user-name').innerText(),/何雅雯/);
    assert.equal(await page.locator('[data-issue]').count(),0);
    await page.locator('[data-import]').first().click();
    await page.locator('#analysisText').fill('测试项目会议纪要\n门板开裂。何雅雯负责完成门板复测，截止 2026-09-20。\n已完成的评审无异常。');
    await page.locator('#startAnalysis').click();
    await page.locator('#runAnalysis').waitFor();
    assert.equal(await page.locator('#runAnalysis').isDisabled(),true);
    assert.equal(upstreamCalls,0,'local import does not call model');
    await page.locator('#topSettings').click();
    await page.locator('#modelKey').fill('unit-test-placeholder');
    await page.locator('#modelSettings [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#settingsMessage').textContent.includes('连接测试成功'));
    assert.equal(await page.locator('#modelKey').inputValue(),'');
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('unit-test-placeholder')),false);
    await page.locator('[data-close]').click();
    await page.locator('#runAnalysis').click();
    await page.waitForFunction(() => projectModel.status === 'analyzed');
    assert.equal(upstreamCalls,3,'test plus extraction and review');
    assert.equal(await page.evaluate(() => projectModel.issues.length),1);
    assert.match(await page.locator('#pageContainer').innerText(),/逐字原文引用/);
    await page.locator('[data-page=actions]').click();
    const action = page.locator('[data-action="action-1"]');
    await action.locator('[data-field=text]').fill('完成门板复测并保存测量记录');
    await action.locator('[data-confirm-action]').click();
    await page.locator('#publishActions').click();
    assert.equal(await page.evaluate(() => state.actions[0].status),'published');
    await page.reload(); await page.waitForFunction(() => connection.available);
    await page.locator('[data-page=actions]').click();
    assert.equal(await page.locator('[data-action="action-1"] [data-field=text]').inputValue(),'完成门板复测并保存测量记录');
    await page.locator('[data-action="action-1"] [data-field=owner]').fill('');
    assert.equal(await page.locator('#publishActions').isDisabled(),true);
    await page.locator('[data-action="action-1"] [data-confirm-action]').click();
    assert.equal(await page.evaluate(() => state.actions[0].status),'pending');
    await page.locator('[data-source]').first().click();
    assert.equal(await page.locator('.source-block.highlight').count(),1);
    await page.locator('[data-adopt]').first().click();
    assert.equal(await page.evaluate(() => state.actions.length),2);
    assert.equal(await page.evaluate(() => state.actions[1].origin),'suggestion');
    await page.locator('[data-page=issues]').click();
    await page.locator('[data-issue]').first().click();
    await page.locator('#issueLocalStatus').selectOption('已关闭');
    await page.locator('#saveIssue').click();
    assert.equal(await page.evaluate(() => projectModel.issues[0].localStatus),undefined);
    await page.locator('#issueNote').fill('复测通过；测量记录 R-001。');
    await page.locator('#saveIssue').click();
    assert.equal(await page.evaluate(() => projectModel.issues[0].localStatus),'已关闭');
    await page.locator('[data-page=report]').click();
    assert.match(await page.locator('#reportBody').inputValue(),/门板开裂/);
    await page.locator('#reportBody').fill('人工核对后的项目报告。');
    await page.locator('#publishReport').click();
    assert.equal(await page.evaluate(() => projectModel.report.status),'published');
    await page.locator('[data-page=analysis]').click();
    await page.locator('#runAnalysis').click();
    await page.locator('#confirmReanalysis').click();
    await page.waitForFunction(() => projectModel.status === 'analyzed' && workspace.documents.length === 2);
    assert.equal(await page.evaluate(() => workspace.documents[1].report.text),'人工核对后的项目报告。');
    rejectNextAnalysis = true;
    await page.locator('#runAnalysis').click();
    await page.locator('#confirmReanalysis').click();
    await page.waitForFunction(() => projectModel.status === 'analyzed' && projectModel.error.length > 0);
    assert.match(await page.locator('.notice.error').innerText(),/额度/);
    assert.equal(await page.evaluate(() => projectModel.issues.length),1);
    assert.equal(await page.evaluate(() => workspace.documents.length),2);
    await page.locator('[data-import]').first().click();
    await page.locator('#analysisText').fill('另一个项目，无问题。');
    await page.locator('#startAnalysis').click();
    assert.equal(await page.evaluate(() => projectModel.issues.length),0);
    assert.equal(await page.evaluate(() => projectModel.analysis),null);
    await page.locator('#projectSwitcher').click();
    await page.locator('[data-document]').nth(1).click();
    assert.equal(await page.evaluate(() => projectModel.issues.length),1);
    fs.mkdirSync(path.join(__dirname,'../work/screenshots'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'../work/screenshots/workspace-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(__dirname,'../work/screenshots/workspace-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[],'no browser exceptions');
    await page.close();
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
