const { request } = require('../../utils/api');
Page({
  data:{selected:false,mimeType:'',sizeBytes:0,note:'',items:[]},
  onLoad(){this.load()},
  load(){request('/api/my/employment-verifications').then(items=>this.setData({items})).catch(e=>wx.showToast({title:e.message,icon:'none'}))},
  chooseImage(){wx.chooseMedia({count:1,mediaType:['image'],success:r=>{const f=r.tempFiles[0];this.setData({selected:true,mimeType:f.fileType==='image'?'image/jpeg':'image/jpeg',sizeBytes:f.size||0})}})},
  chooseFile(){wx.chooseMessageFile({count:1,type:'file',extension:['pdf','png','jpg','jpeg'],success:r=>{const f=r.tempFiles[0];const ext=String(f.name||'').split('.').pop().toLowerCase();const mime=ext==='pdf'?'application/pdf':ext==='png'?'image/png':'image/jpeg';this.setData({selected:true,mimeType:mime,sizeBytes:f.size||0})}})},
  note(e){this.setData({note:e.detail.value})},
  submit(){if(!this.data.selected)return wx.showToast({title:'请先选择名片文件',icon:'none'});request('/api/my/employment-verifications',{method:'POST',data:{mimeType:this.data.mimeType,sizeBytes:this.data.sizeBytes,note:this.data.note}}).then(r=>{wx.showModal({title:'已提交内部核验',content:r.notice,showCancel:false});this.setData({selected:false,note:''});this.load()}).catch(e=>wx.showModal({title:'提交失败',content:e.message,showCancel:false}))}
});
