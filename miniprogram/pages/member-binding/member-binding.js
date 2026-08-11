'use strict';
const {formalRequest}=require('../../utils/api');

Page({
  data:{configured:false,state:'intro',message:'微信登录只用于取得小程序 OpenID；昵称、微信号和群状态不会由登录接口获得。',reviewReasons:[]},
  onLoad(){const runtime=getApp().globalData.runtime;this.setData({configured:runtime.formalBindingEnabled===true&&runtime.identityMode==='formal_member_binding',state:runtime.formalBindingEnabled?'intro':'disabled'})},
  begin(){if(!this.data.configured)return wx.showModal({title:'正式绑定尚未启用',content:'当前环境不会发送微信登录或手机号凭证。',showCancel:false});this.setData({state:'login_pending',message:'正在取得一次性登录凭证…'});wx.login({success:result=>{if(!result.code)return this.fail('微信未返回登录凭证');this.loginCode=result.code;this.setData({state:'phone_consent',message:'授权手机号可用于与 CRM 唯一匹配；不会公开，也不会由小程序保存。'})},fail:()=>this.fail('微信登录暂时不可用')})},
  authorizePhone(event){if(!this.loginCode)return this.fail('请先重新开始身份验证');const phoneGrantCode=event.detail&&event.detail.code;if(!phoneGrantCode)return this.setData({state:'phone_consent',message:'未获得手机号授权。可重试，或进入人工核验队列。'});this.submit({phoneGrantCode})},
  continueManual(){if(!this.loginCode)return this.fail('请先重新开始身份验证');this.submit({})},
  submit(extra){this.setData({state:'matching',message:'正在使用服务端验证结果匹配 CRM…'});formalRequest('/api/formal-member-binding/start',{method:'POST',data:{code:this.loginCode,...extra}}).then(result=>{this.loginCode='';if(result.status==='bound_active')return this.finishSession();this.setData({state:'manual_review',message:'当前资料需要运营人工核验。不会自动绑定或开放访问。',reviewReasons:result.reviewReasons||[]})}).catch(error=>this.fail(error.message))},
  finishSession(){this.setData({state:'session_pending',message:'绑定已确认，正在重新登录并读取最新会籍…'});wx.login({success:result=>{if(!result.code)return this.fail('微信未返回新的登录凭证');formalRequest('/api/formal-member-binding/session',{method:'POST',data:{code:result.code}}).then(session=>{if(!session.accessToken)return this.fail('服务端未签发有效会话');wx.setStorageSync('memberAccessToken',session.accessToken);this.setData({state:'complete',message:'会员身份已匹配，会籍访问已启用。'});setTimeout(()=>wx.switchTab({url:'/pages/home/home'}),600)}).catch(error=>this.fail(error.message))},fail:()=>this.fail('重新登录暂时不可用')})},
  retry(){this.loginCode='';this.setData({state:'intro',message:'请重新开始验证。',reviewReasons:[]})},
  fail(message){this.loginCode='';this.setData({state:'error',message:String(message||'验证暂时不可用').slice(0,120)})}
});
