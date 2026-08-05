'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','..'),app=fs.readFileSync(path.join(root,'server/public/app.js'),'utf8'),server=fs.readFileSync(path.join(root,'server/src/server.js'),'utf8'),css=fs.readFileSync(path.join(root,'server/public/admin-ops.css'),'utf8');

test('materials workspace exposes simple multi-file report and book controls',()=>{
  for(const text of ['从电脑批量导入资料','选择多个报告或书籍，或一起拖拽文件到这里','优先支持 PDF、DOCX、Markdown、TXT','批量应用到本批','每项仍可单独覆盖','批量上传到待审核区'])assert.equal(app.includes(text),true,text);
  assert.equal(app.includes('id="local-files" type="file" multiple'),true);
  assert.equal(css.includes('.local-file-settings'),true);
});

test('batch metadata remains pending-only and does not create a publish shortcut',()=>{
  for(const text of ["['pending_review','needs_classification'].includes(item.status)",'local_materials.batch_metadata_apply','pendingOnly:true','LOCAL_IMPORT_BULK_NOT_EDITABLE'])assert.equal(server.includes(text),true,text);
  const route=server.slice(server.indexOf('local-import-batches'),server.indexOf('local-import-items',server.indexOf('local-import-batches')));
  assert.equal(route.includes('resource.publish'),false);
  assert.equal(route.includes('status=\'published\''),false);
});

test('batch result copy promises safe summaries and isolated failures',()=>{
  for(const text of ['其他合格文件已保留','不显示本地路径、存储键、来源链接、附件引用或文件内容','成功进入待审核','每项可单独覆盖'])assert.equal(app.includes(text),true,text);
});
