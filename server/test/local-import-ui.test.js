'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','..'),app=fs.readFileSync(path.join(root,'server/public/app.js'),'utf8'),server=fs.readFileSync(path.join(root,'server/src/server.js'),'utf8'),css=fs.readFileSync(path.join(root,'server/public/admin-ops.css'),'utf8');

test('materials workspace exposes simple multi-file report and book controls',()=>{
  for(const text of ['从电脑批量导入资料','选择多个报告或书籍，或一起拖拽文件到这里','优先支持 PDF、DOCX、Markdown、TXT','批量应用到本批','每项仍可单独覆盖','确认责任并上传发布'])assert.equal(app.includes(text),true,text);
  assert.equal(app.includes('id="local-files" type="file" multiple'),true);
  assert.equal(css.includes('.local-file-settings'),true);
});

test('batch metadata remains pending-only and does not create a publish shortcut',()=>{
  for(const text of ["['pending_review','needs_classification'].includes(item.status)",'local_materials.batch_metadata_apply','pendingOnly:true','LOCAL_IMPORT_BULK_NOT_EDITABLE'])assert.equal(server.includes(text),true,text);
  const route=server.slice(server.indexOf('local-import-batches'),server.indexOf('local-import-items',server.indexOf('local-import-batches')));
  assert.equal(route.includes('resource.publish'),false);
  assert.equal(route.includes('status=\'published\''),false);
});

test('batch result copy promises direct publish, safe summaries and isolated failures',()=>{
  for(const text of ['其他合格文件已独立发布','不显示本地路径、存储键、来源链接、附件引用或文件内容','成功发布','已发布到会员动态','每项可单独覆盖'])assert.equal(app.includes(text),true,text);
  for(const text of ['operatorConfirmed:true','copyrightConfirmed:true','securityResponsibilityConfirmed:true'])assert.equal(app.includes(text),true,text);
});

test('published management and long titles remain usable without a second review tab',()=>{
  assert.equal(app.includes("['resources','已发布资料管理']"),true);
  assert.equal(app.includes('资料审核 / 发布'),false);
  for(const text of ['编辑公开设置','取消发布','发布已上传资料','clamp-title','title="${esc(item.title)}"'])assert.equal(app.includes(text),true,text);
  assert.match(css,/line-clamp:2/);
});
