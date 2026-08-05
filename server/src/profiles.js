'use strict';

const PUBLIC_PROFILE_FIELDS = ['public_display_name','organization','title','city','industry_tracks','interests','investment_stages','expertise','bio','collaboration_preferences','visibility'];
const CONTACT_FIELD = /(phone|mobile|email|wechat|contact|address|手机号|电话|微信|邮箱|地址)/i;
const CONTACT_VALUE = /(1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:微信|电话|手机|邮箱|联系)\s*[:：]?)/i;

function cleanText(value, max) { return String(value || '').trim().slice(0, max); }
function cleanList(value, maxItems = 12) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[|,，]/);
  return [...new Set(list.map(x => cleanText(x, 40)).filter(Boolean))].slice(0, maxItems);
}
function validatePublicProfileUpdate(input = {}) {
  const errors = [];
  const unknown = Object.keys(input).filter(key => !PUBLIC_PROFILE_FIELDS.includes(key));
  const contactFields = unknown.filter(key => CONTACT_FIELD.test(key));
  if (contactFields.length) errors.push('公开资料不得包含联系方式字段');
  if (unknown.length && !contactFields.length) errors.push(`包含未知字段：${unknown.join('、')}`);
  const data = {
    public_display_name: cleanText(input.public_display_name, 40), organization: cleanText(input.organization, 80),
    title: cleanText(input.title, 60), city: cleanText(input.city, 40), industry_tracks: cleanList(input.industry_tracks),
    interests: cleanList(input.interests), investment_stages: cleanList(input.investment_stages), expertise: cleanList(input.expertise),
    bio: cleanText(input.bio, 500), collaboration_preferences: cleanList(input.collaboration_preferences), visibility: input.visibility
  };
  if (!data.public_display_name) errors.push('public_display_name 不能为空');
  if (!data.industry_tracks.length) errors.push('industry_tracks 至少填写一项');
  if (!['visible','hidden'].includes(data.visibility)) errors.push('visibility 无效');
  for (const [key, value] of Object.entries(data)) {
    const text = Array.isArray(value) ? value.join(' ') : value;
    if (CONTACT_VALUE.test(String(text || ''))) errors.push(`${key} 疑似包含联系方式，请改用申请对接`);
  }
  return { valid: errors.length === 0, errors, data };
}

const ALLOWED_CARD_TYPES = ['image/jpeg','image/png','application/pdf'];
function validateEmploymentArtifact(input = {}) {
  const errors = [];
  const unknown = Object.keys(input).filter(key => !['mimeType','sizeBytes','note'].includes(key));
  if (unknown.length) errors.push(`包含不允许的上传字段：${unknown.join('、')}`);
  const forbidden = ['fileName','fileContent','base64','tempPath','url','storageKey'].filter(key => input[key]);
  if (forbidden.length) errors.push('演示环境不接收文件名、文件内容、路径或存储地址');
  if (!ALLOWED_CARD_TYPES.includes(input.mimeType)) errors.push('仅接受 JPEG、PNG 或 PDF');
  const size = Number(input.sizeBytes);
  if (!Number.isInteger(size) || size <= 0 || size > 5 * 1024 * 1024) errors.push('文件大小必须在 1 字节至 5MB 之间');
  const note = cleanText(input.note, 300);
  return { valid: errors.length === 0, errors, data: { mimeType: input.mimeType, sizeBytes: size, notePresent: Boolean(note) } };
}

module.exports = { PUBLIC_PROFILE_FIELDS, validatePublicProfileUpdate, validateEmploymentArtifact };
