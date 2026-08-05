'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePublicProfileUpdate, validateEmploymentArtifact } = require('../src/profiles');

const validProfile = { public_display_name:'公开代号A',organization:'演示机构',title:'演示职位',city:'示例城市',industry_tracks:['科技'],interests:['研究'],investment_stages:['成长期'],expertise:['分析'],bio:'仅用于公开资料流程测试',collaboration_preferences:['行业交流'],visibility:'visible' };

test('public profile update accepts only public fields and remains contact-free', () => {
  const result = validatePublicProfileUpdate(validProfile);
  assert.equal(result.valid, true); assert.equal('phone' in result.data, false);
});
test('public profile update rejects contact fields and contact-like values', () => {
  assert.equal(validatePublicProfileUpdate({ ...validProfile, phone:'not-allowed' }).valid, false);
  assert.equal(validatePublicProfileUpdate({ ...validProfile, bio:'请通过手机联系：' }).valid, false);
});
test('public profile update validates visibility and required industry', () => {
  assert.equal(validatePublicProfileUpdate({ ...validProfile, visibility:'public' }).valid, false);
  assert.equal(validatePublicProfileUpdate({ ...validProfile, industry_tracks:[] }).valid, false);
});
test('employment artifact accepts safe metadata without retaining note content', () => {
  const result = validateEmploymentArtifact({ mimeType:'image/png', sizeBytes:1024, note:'内部说明占位' });
  assert.equal(result.valid, true); assert.equal(result.data.notePresent, true); assert.equal('protectedNote' in result.data, false);
});
test('employment artifact rejects content, path, name, unsafe type and oversize files', () => {
  const result = validateEmploymentArtifact({ mimeType:'text/plain', sizeBytes:6*1024*1024, fileName:'not-accepted',base64:'not-accepted' });
  assert.equal(result.valid, false); assert.match(result.errors.join(' '), /不接收文件名/); assert.match(result.errors.join(' '), /5MB/);
});
