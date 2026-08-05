'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');

test('Feishu admin UI presents ordered prerequisites and never collects secrets',()=>{
  for(const text of ['迁入前检查','目标 Wiki 资源读权','飞书 Wiki 根链接','测试连接','创建安全预检任务','运行一次性迁入'])assert.equal(app.includes(text),true,text);
  assert.equal(/type=["']password["']/.test(app),false);
  assert.equal(/id=["'][^"']*secret/i.test(app),false);
  assert.equal(app.includes('/api/admin/feishu-migration-readiness'),true);
  assert.equal(app.includes('不能重复迁入'),true);
  assert.equal(app.includes('查看授权修复并重试'),true);
  assert.equal(app.includes('无需重填 Secret'),true);
});

test('material navigation contains only material work and keeps computer import ahead of optional Feishu',()=>{
  assert.ok(app.indexOf("['local-materials','从电脑导入资料']")>=0);
  assert.ok(app.indexOf("['local-materials','从电脑导入资料']")<app.indexOf("['feishu-onetime','飞书历史资料（可选）']"));
  const materialNav=app.slice(app.indexOf("{key:'materials'"),app.indexOf("{key:'activities'"));for(const forbidden of ['crm-import','shop-order-import','voluntary-directory-import','membership-rehearsal','payment-evidence'])assert.equal(materialNav.includes(forbidden),false,forbidden);
  for(const text of ['拖拽文件到这里','上传到待审核区','先建条目，稍后补文件','允许会员下载','需要人工确认分类','关键词标签','在线预览能力待配置','自动建议标签（可修改）','规则建议，待确认','一键采用剩余建议','本页不接收 AI API Key'])assert.equal(app.includes(text),true,text);
  assert.equal(app.includes('accept=".pdf,.docx,.xlsx,.pptx,.mp4,.mp3,.m4a,.png,.jpg,.jpeg,.md,.txt,.zip"'),true);
});
