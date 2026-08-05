const {request}=require('../../utils/api');
const types=[['all','全部'],['investment','投资'],['fundraising','融资'],['ma','并购'],['recruitment','招聘'],['business_attraction','招商']];
const recorder=wx.getRecorderManager();
Page({
  data:{types:types.map(([key,label])=>({key,label})),active:'all',all:[],items:[],requests:[],statement:'',recording:false,voiceNotice:'语音上传与转写待正式微信和 ASR 配置'},
  onLoad(){recorder.onStop(()=>{this.setData({recording:false});request('/api/agent-voice-sessions',{method:'POST',data:{recordedLocally:true}}).catch(e=>wx.showModal({title:'语音能力待配置',content:e.message,showCancel:false}))});recorder.onError(e=>{this.setData({recording:false});wx.showToast({title:'请检查微信录音授权',icon:'none'})})},
  onShow(){this.load()},
  load(){Promise.all([request('/api/opportunities'),request('/api/my/agent-match-requests'),request('/api/member-capabilities')]).then(([all,requests,c])=>{this.setData({all,requests,voiceNotice:c.notices.voice});this.filter()}).catch(e=>wx.showToast({title:e.message,icon:'none'}))},
  input(e){this.setData({statement:e.detail.value})},select(e){this.setData({active:e.currentTarget.dataset.key});this.filter()},filter(){this.setData({items:this.data.active==='all'?this.data.all:this.data.all.filter(x=>x.type===this.data.active)})},
  submit(){request('/api/agent-match-requests',{method:'POST',data:{inputMode:'text',statement:this.data.statement}}).then(x=>{wx.showModal({title:'已进入人工审核',content:x.notice,showCancel:false});this.setData({statement:''});this.load()}).catch(e=>wx.showToast({title:e.message,icon:'none'}))},
  record(){if(this.data.recording){recorder.stop();return}wx.authorize({scope:'scope.record',success:()=>{this.setData({recording:true});recorder.start({duration:60000,format:'mp3'})},fail:()=>wx.showModal({title:'需要录音授权',content:'请在微信设置中开启录音权限；录音上传与 ASR 仍需正式配置。',showCancel:false})})},
  apply(e){wx.showModal({title:'申请对接',editable:true,placeholderText:'说明匹配优势与对接目的',success:r=>{if(r.confirm&&r.content)request(`/api/demands/${e.currentTarget.dataset.id}/apply`,{method:'POST',data:{reason:r.content}}).then(()=>wx.showToast({title:'已提交'})).catch(x=>wx.showToast({title:x.message,icon:'none'}))}})}
});
