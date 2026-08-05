const { request } = require('../../utils/api');
const empty = { public_display_name:'',organization:'',title:'',city:'',industry_tracks:'',interests:'',investment_stages:'',expertise:'',bio:'',collaboration_preferences:'',visibility:'hidden' };
Page({
  data:{ form:{...empty},updates:[],visible:false },
  onLoad(){this.load()},
  load(){request('/api/my/public-profile').then(data=>{const p=data.publishedProfile||{};this.setData({form:{...empty,...p,industry_tracks:(p.industry_tracks||[]).join('，'),interests:(p.interests||[]).join('，'),investment_stages:(p.investment_stages||[]).join('，'),expertise:(p.expertise||[]).join('，'),collaboration_preferences:(p.collaboration_preferences||[]).join('，')},visible:p.visibility==='visible',updates:data.updates||[]})}).catch(e=>wx.showToast({title:e.message,icon:'none'}))},
  input(e){this.setData({[`form.${e.currentTarget.dataset.field}`]:e.detail.value})},
  visibility(e){this.setData({visible:e.detail.value,'form.visibility':e.detail.value?'visible':'hidden'})},
  submit(){const form={...this.data.form};['industry_tracks','interests','investment_stages','expertise','collaboration_preferences'].forEach(k=>form[k]=String(form[k]||'').split(/[，,]/).map(x=>x.trim()).filter(Boolean));request('/api/my/public-profile-updates',{method:'POST',data:form}).then(()=>{wx.showModal({title:'已提交',content:'资料不会立即覆盖已发布名册，运营审核后才会生效。',showCancel:false});this.load()}).catch(e=>wx.showModal({title:'提交失败',content:e.message,showCancel:false}))}
});
