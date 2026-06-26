// pages/my-preorders/my-preorders.js
// 我的预购列表：默认显示未来+最近3天历史，下拉加载更早的
const { callFunction } = require('../../utils/api')
const { formatDateWithWeek, getTodayStr } = require('../../utils/date')

Page({
  data: {
    name: '',                 // 用户昵称（用于 UI 展示）
    preorders: [],
    groupedList: [],
    loading: true,
    loadingMore: false,
    historyDays: 3,           // 当前已加载的历史天数
    hasMore: false,            // 是否还有更早的预购记录
    totalAll: 0,
    today: getTodayStr()      // 今天日期，用于判断历史/未来
  },

  onLoad() {
    this.loadMyPreorders()
  },

  onShow() {
    // 每次显示时刷新（重置到默认 3 天）
    this.setData({ historyDays: 3 })
    this.loadMyPreorders()
  },

  loadMyPreorders() {
    const isLoadMore = this.data.preorders.length > 0
    if (isLoadMore) {
      this.setData({ loadingMore: true })
    } else {
      this.setData({ loading: true })
    }

    callFunction('preorder-add', {
      action: 'my_list',
      history_days: this.data.historyDays
    }).then(data => {
      const preorders = (data && data.preorders) || []
      const totalAll = (data && data.totalAll) || 0
      const hasMore = (data && data.hasMore) || false
      this.setData({
        preorders,
        totalAll,
        hasMore: hasMore && preorders.length > 0
      })
      this.groupPreorders(preorders)
    }).catch(() => {
      if (!isLoadMore) {
        this.setData({ preorders: [], groupedList: [] })
      }
    }).finally(() => {
      this.setData({ loading: false, loadingMore: false })
    })
  },

  // 加载更早的预购（往前 3 天）
  loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ historyDays: this.data.historyDays + 3 })
    this.loadMyPreorders()
  },

  // 按日期分组
  groupPreorders(preorders) {
    const map = {}
    preorders.forEach(p => {
      const d = p.target_date
      if (!map[d]) map[d] = []
      map[d].push(p)
    })
    const dates = Object.keys(map).sort((a, b) => b.localeCompare(a))
    const groupedList = dates.map(date => ({
      date,
      displayDate: formatDateWithWeek(date),
      list: map[date]
    }))
    this.setData({ groupedList })
  },

  // 取消预购
  onCancelPreorder(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    wx.showModal({
      title: '取消预购',
      content: `确定取消「${name}」吗？`,
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '取消中...' })
          callFunction('preorder-add', { action: 'cancel', preorder_id: id }).then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已取消', icon: 'success' })
            // 重置并刷新
            this.setData({ historyDays: 3 })
            this.loadMyPreorders()
          }).catch(() => {
            wx.hideLoading()
          })
        }
      }
    })
  },

  // 编辑预购：通过 globalData 传参 + switchTab 跳转到预定 tab（tabBar 页不能 navigateTo）
  onEditPreorder(e) {
    const app = getApp()
    const { id, dishId, date, note, meal } = e.currentTarget.dataset
    app.globalData.preorderEdit = {
      preorderId: id,
      dishId,
      date,
      meal: meal || 'lunch',
      note: note || '',
      forUser: ''
    }
    wx.switchTab({ url: '/pages/preorder/preorder' })
  }
})
