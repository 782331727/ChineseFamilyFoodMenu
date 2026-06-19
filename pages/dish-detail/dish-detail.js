// pages/dish-detail/dish-detail.js
const { callFunction } = require('../../utils/api')
const { requirePermission, hasPermission } = require('../../utils/auth')
const { mapDish, mealToCloud } = require('../../utils/mapper')
const { getTodayStr, getTomorrowStr } = require('../../utils/date')

Page({
  data: {
    dish: null,
    loading: true,
    difficultyText: '',
    myRating: 0,
    ratingLoading: false,
    canManage: false,
    isForeign: false,
    cloning: false
  },

  onLoad(options) {
    this.setData({ canManage: hasPermission('manage_dishes') })
    if (options.id) { this.loadDish(options.id) }
  },

  loadDish(id) {
    this.setData({ loading: true })
    callFunction('dish-detail', { dish_id: id }).then(data => {
      const mapped = mapDish(data && data.dish)
      const myFid = getApp().globalData.familyId || wx.getStorageSync('familyId') || ''
      const isForeign = mapped && mapped.familyId && mapped.familyId !== myFid
      const diffMap = { easy: '简单', medium: '中等', hard: '困难', '简单': '简单', '中等': '中等', '较难': '困难' }
      this.setData({
        dish: mapped, loading: false,
        difficultyText: diffMap[mapped && mapped.difficulty] || '简单',
        isForeign
      })
    }).catch(() => {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    })
  },

  // 加入菜单
  // menu-manage 云函数 action:'add' 需要：date, meal_type(breakfast/lunch/dinner), dish_id
  onAddToMenu() {
    if (!requirePermission('manage_menu')) return
    const dish = this.data.dish
    wx.showActionSheet({
      itemList: ['加入今日早餐', '加入今日午餐', '加入今日晚餐', '加入明日早餐', '加入明日午餐', '加入明日晚餐'],
      success: res => {
        const today = getTodayStr()
        const tomorrow = getTomorrowStr()
        const options = [
          { date: today, meal: 'breakfast' },
          { date: today, meal: 'lunch' },
          { date: today, meal: 'dinner' },
          { date: tomorrow, meal: 'breakfast' },
          { date: tomorrow, meal: 'lunch' },
          { date: tomorrow, meal: 'dinner' }
        ]
        const opt = options[res.tapIndex]

        callFunction('menu-manage', {
          action: 'add',
          date: opt.date,
          meal_type: opt.meal,
          dish_id: dish._id
        }).then(() => {
          wx.showToast({ title: '已加入菜单', icon: 'success' })
        }).catch(() => {})
      }
    })
  },

  // 预定
  // preorder 是 tabBar 页面，navigateTo 会静默失败，
  // 改用 switchTab，通过 globalData 传递要预定的菜品ID
  onPreorder() {
    const dish = this.data.dish
    if (!dish || !dish._id) {
      wx.showToast({ title: '菜品信息异常', icon: 'none' })
      return
    }
    const app = getApp()
    app.globalData.preorderDishId = dish._id
    app.globalData.preorderDishName = dish.name
    wx.switchTab({
      url: '/pages/preorder/preorder',
      fail: () => {
        wx.showToast({ title: '跳转失败', icon: 'none' })
      }
    })
  },

  // 编辑
  onEdit() {
    if (!requirePermission('manage_dishes')) return
    const dish = this.data.dish
    wx.navigateTo({
      url: '/pages/dish-add/dish-add?id=' + dish._id
    })
  },

  rateDish(e) {
    if (this.data.ratingLoading) return
    const r = parseInt(e.currentTarget.dataset.r)
    if (!r || r < 1 || r > 5) return
    this.setData({ myRating: r, ratingLoading: true })
    callFunction('dish-add', { action: 'rate', dish_id: this.data.dish._id, rating: r }).then(data => {
      const d = this.data.dish
      d.avg_rating = (data && data.avg_rating) || r
      d.rating_count = (data && data.rating_count) || ((d.rating_count || 0) + 1)
      this.setData({ dish: d, ratingLoading: false })
      wx.showToast({ title: data && data.message || '已评价', icon: 'success' })
    }).catch(() => { this.setData({ ratingLoading: false }) })
  },

  onDelete() {
    if (!hasPermission('manage_dishes')) return
    wx.showModal({
      title: '删除菜品', content: '将移入回收站，可恢复', confirmColor: '#E74C3C',
      success: res => {
        if (!res.confirm) return
        callFunction('dish-add', { action: 'softDelete', dish_id: this.data.dish._id }).then(() => {
          wx.showToast({ title: '已移入回收站', icon: 'success' })
          setTimeout(() => wx.switchTab({ url: '/pages/dishes/dishes' }), 1500)
        }).catch(() => {})
      }
    })
  },

  // 引入到我家（跨家庭复制公开菜）
  cloneDish() {
    if (this.data.cloning) return
    this.setData({ cloning: true })
    callFunction('dish-add', { action: 'clone', dish_id: this.data.dish._id }).then(data => {
      wx.showToast({ title: '已引入到我家', icon: 'success' })
      // 跳转到新菜品详情
      if (data && data._id) {
        setTimeout(() => wx.redirectTo({ url: '/pages/dish-detail/dish-detail?id=' + data._id }), 500)
      }
    }).catch(() => {
      wx.showToast({ title: '引入失败', icon: 'none' })
    }).finally(() => { this.setData({ cloning: false }) })
  }
})
