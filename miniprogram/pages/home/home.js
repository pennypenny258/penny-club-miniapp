const {request}=require('../../utils/api');
const labels={resource:'资料',activity:'活动',opportunity:'机会',meeting_replay:'回放',industry_report:'报告',group_digest:'精华'};
Page({
  data:{items:[],favorites:[],query:''},
  onShow(){this.loadFeed()},
  onSearch(e){this.setData({query:e.detail.value});clearTimeout(this.timer);this.timer=setTimeout(()=>this.loadFeed(),300)},
  loadFeed(){Promise.all([request(`/api/feed${this.data.query?'?query='+encodeURIComponent(this.data.query):''}`),request('/api/favorites')]).then(([feed,favorites])=>this.setData({favorites,items:feed.items.map(x=>({...x,label:labels[x.kind]||labels[x.type]||'更新',favorited:favorites.some(f=>f.targetType===x.kind&&f.targetId===x.targetId)}))})).catch(e=>wx.showToast({title:e.message,icon:'none'}))},
  toggleFavorite(e){const {type,id,saved}=e.currentTarget.dataset;request(saved?`/api/favorites/${type}/${id}`:'/api/favorites',{method:saved?'DELETE':'POST',data:saved?undefined:{targetType:type,targetId:id}}).then(()=>this.loadFeed()).catch(x=>wx.showToast({title:x.message,icon:'none'}))},
  register(e){request(`/api/activities/${e.currentTarget.dataset.id}/register`,{method:'POST'}).then(x=>wx.showModal({title:'报名登记成功',content:x.notice,showCancel:false})).catch(x=>wx.showToast({title:x.message,icon:'none'}))}
});
