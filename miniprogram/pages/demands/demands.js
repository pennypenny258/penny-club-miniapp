const {request,formalRequest}=require('../../utils/api');
const categories=[['investment','投资'],['fundraising','融资'],['ma','并购'],['recruitment','招聘'],['business_attraction','招商']].map(([key,label])=>({key,label}));
const modes=[{key:'full_public',label:'公开（会展示在前台，请自行衡量脱敏程度）'},{key:'private_match',label:'私密匹配（前台不展示，仅在后台 AI 匹配）'}];
const recorder=wx.getRecorderManager();
const formalMode=()=>{const runtime=getApp().globalData.runtime;return runtime.identityMode==='formal_member_binding'&&runtime.formalBindingEnabled===true};

Page({
  data:{categories,categoryIndex:0,modes,modeIndex:0,who:'',background:'',need:'',recording:false,voiceNotice:'可语音输入；语音上传与转写待正式微信和 ASR 配置'},
  onLoad(){recorder.onStop(()=>{this.setData({recording:false});if(formalMode())return wx.showModal({title:'语音能力待配置',content:'正式 ASR 尚未配置；录音不会上传或伪装成已转写。',showCancel:false});request('/api/agent-voice-sessions',{method:'POST',data:{recordedLocally:true}}).catch(error=>wx.showModal({title:'语音能力待配置',content:error.message,showCancel:false}))});recorder.onError(()=>{this.setData({recording:false});wx.showToast({title:'请检查微信录音授权',icon:'none'})})},
  input(e){this.setData({[e.currentTarget.dataset.field]:e.detail.value})},
  selectCategory(e){this.setData({categoryIndex:Number(e.detail.value)})},
  selectMode(e){this.setData({modeIndex:Number(e.detail.value)})},
  submit(){const category=this.data.categories[this.data.categoryIndex].key,distributionMode=this.data.modes[this.data.modeIndex].key,formal=formalMode(),path=formal?'/api/formal-agent/demands':'/api/agent-match-requests',payload={type:category,who:this.data.who,why:this.data.background,target:this.data.need,distributionMode},data=formal?payload:{inputMode:'text',category,who:payload.who,why:payload.why,target:payload.target,distributionMode},send=formal?formalRequest(path,{method:'POST',data,auth:true}):request(path,{method:'POST',data});send.then(result=>{wx.showModal({title:'已进入人工审核',content:result.notice||'需求只进入人工审核，不会自动发布、推送或披露联系人。',showCancel:false});this.setData({who:'',background:'',need:''})}).catch(error=>wx.showToast({title:error.message,icon:'none'}))},
  record(){if(this.data.recording){recorder.stop();return}wx.authorize({scope:'scope.record',success:()=>{this.setData({recording:true});recorder.start({duration:60000,format:'mp3'})},fail:()=>wx.showModal({title:'需要录音授权',content:'请在微信设置中开启录音权限；录音上传与 ASR 仍需正式配置。',showCancel:false})})}
});
