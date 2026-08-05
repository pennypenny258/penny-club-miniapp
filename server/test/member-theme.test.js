'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

function luminance(hex){
  const rgb=hex.match(/[a-f\d]{2}/gi).map(value=>parseInt(value,16)/255).map(value=>value<=.03928?value/12.92:((value+.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}
function contrast(a,b){const [high,low]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (high+.05)/(low+.05)}

test('member purple accent retains readable text and button contrast',()=>{
  assert.ok(contrast('#664783','#ffffff')>=4.5);
  assert.ok(contrast('#725292','#ffffff')>=4.5);
  const html=read('server/public/member.html');
  assert.match(html,/member-theme\.css/);
  assert.match(read('server/public/member-theme.css'),/--green:\s*#725292/i);
});

test('all four mini-program tabs import the shared restrained purple theme',()=>{
  for(const page of ['home','resources','demands','profile'])assert.match(read(`miniprogram/pages/${page}/${page}.wxss`),/@import "\.\.\/\.\.\/member-theme\.wxss"/);
  const app=JSON.parse(read('miniprogram/app.json'));
  assert.equal(app.tabBar.selectedColor,'#664783');
  assert.match(read('miniprogram/member-theme.wxss'),/#f1ecf7/i);
});
