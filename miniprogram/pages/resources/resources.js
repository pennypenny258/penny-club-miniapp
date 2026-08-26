const {request}=require('../../utils/api');

const formatLabels={online:'线上',offline:'线下',hybrid:'线上＋线下'};
const statusLabels={registration_open:'等待开启',waitlist_open:'等待开启',in_progress:'进行中',ended:'已完成',cancelled:'已取消'};

function dateTime(value){
  if(!value)return '待确定';
  const date=new Date(value),pad=n=>String(n).padStart(2,'0');
  return `${date.getMonth()+1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function activityView(item){
  const online=item.format==='online',completed=item.status==='ended',speakers=(item.speakers||[]).map(x=>`${x.name}${x.role?` · ${x.role}`:''}`).join('、');
  return {...item,formatLabel:formatLabels[item.format]||item.format,statusLabel:statusLabels[item.status]||item.status,timeLabel:`${dateTime(item.startsAt)}－${dateTime(item.endsAt)}`,locationLabel:online?'线上会议':item.venue||item.city||'地点待确定',speakerLabel:speakers||'分享者信息待公布',attendeeLabel:item.attendeeSummary||'参会者信息待公布',completed,archiveAvailable:completed&&Boolean(item.archiveResourceIds?.length),meetingHint:item.registered?'已报名；会议链接将在开放时间内显示':'报名后，活动开始前开放会议链接'};
}

Page({
  data:{query:'',all:[],items:[]},
  onShow(){const query=getApp().globalData.publicSearchQuery||'';this.setData({query});this.load()},
  load(){request('/api/activities').then(all=>{this.setData({all:all.map(activityView)});this.filter()}).catch(e=>wx.showToast({title:e.message,icon:'none'}))},
  search(e){const query=e.detail.value;getApp().globalData.publicSearchQuery=query;this.setData({query});this.filter()},
  filter(){const query=this.data.query.trim().toLocaleLowerCase('zh-CN');this.setData({items:this.data.all.filter(item=>!query||`${item.title} ${item.formatLabel} ${item.statusLabel} ${item.locationLabel} ${item.speakerLabel} ${item.attendeeLabel}`.toLocaleLowerCase('zh-CN').includes(query))})},
  register(e){request(`/api/activities/${e.currentTarget.dataset.id}/register`,{method:'POST'}).then(result=>{wx.showModal({title:'报名登记成功',content:result.notice,showCancel:false});this.load()}).catch(error=>wx.showToast({title:error.message,icon:'none'}))},
  meeting(e){request(`/api/activities/${e.currentTarget.dataset.id}/meeting-link`).then(result=>wx.showModal({title:'会议链接',content:`${result.meetingLink}\n${result.capacityNotice}`,showCancel:false})).catch(error=>wx.showModal({title:'会议链接暂不可用',content:error.message,showCancel:false}))},
  archive(e){const item=this.data.all.find(x=>x.id===e.currentTarget.dataset.id),resourceId=item?.archiveResourceIds?.[0];if(!resourceId)return;request(`/api/resources/${resourceId}/view`).then(result=>wx.showModal({title:result.title,content:`${result.summary}\n\n${result.message}`,showCancel:false})).catch(error=>wx.showModal({title:'回放与纪要',content:error.message,showCancel:false}))}
});
