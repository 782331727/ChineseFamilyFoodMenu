// pages/dish-detail/dish-detail.js
const { callFunction } = require('../../utils/api')
const { requirePermission, hasPermission } = require('../../utils/auth')
const { mapDish, mealToCloud } = require('../../utils/mapper')
const { getTodayStr, getTomorrowStr } = require('../../utils/date')

Page({
  data: {
    dish: null,
    dishId: '',
    loading: true,
    loadError: false,
    errorMsg: '',
    difficultyText: '',
    myRating: 0,
    ratingLoading: false,
    canManage: false,
    isForeign: false,
    cloning: false
  },

  onLoad(options) {
    const hasFamily = !!(getApp().globalData.familyId || wx.getStorageSync('familyId'))
    this.setData({ canManage: hasPermission('manage_dishes'), hasFamily })
    if (options.id) {
      this.setData({ dishId: options.id })
      this.loadDish(options.id)
    }
  },

  loadDish(id) {
    const dishId = id || this.data.dishId
    if (!dishId) {
      this.setData({ loading: false, loadError: true })
      return
    }
    this.setData({ loading: true, loadError: false })
    callFunction('dish-detail', { dish_id: id }).then(data => {
      const mapped = mapDish(data && data.dish)
      const myFid = getApp().globalData.familyId || wx.getStorageSync('familyId') || ''
      const isForeign = mapped && mapped.familyId && mapped.familyId !== myFid
      const diffMap = { easy: '简单', medium: '中等', hard: '困难', '简单': '简单', '中等': '中等', '较难': '困难' }
      this.setData({
        dish: mapped, loading: false, loadError: false,
        difficultyText: diffMap[mapped && mapped.difficulty] || '简单',
        isForeign,
        myRating: (data && data.my_rating) || 0
      })
    }).catch((e) => {
      // api.js 已通过 toast 显示具体错误消息
      // 将错误信息存入 data 让错误页展示真实原因，而非只写死"网络"
      const msg = (e && e.message) || '加载失败'
      this.setData({ loading: false, loadError: true, errorMsg: msg })
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

  // 点击图片查看高清大图
  previewImage(e) {
    const index = e.currentTarget.dataset.index || 0
    const urls = this.data.dish.images || []
    if (urls.length === 0) return
    wx.previewImage({
      current: urls[index],
      urls
    })
  },

  rateDish(e) {
    if (this.data.ratingLoading) return
    const r = parseInt(e.currentTarget.dataset.r)
    if (!r || r < 1 || r > 5) return
    if (!this.data.hasFamily) { wx.showToast({ title: '请先加入家庭', icon: 'none' }); return }
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
          getApp().globalData.dishesNeedRefresh = true
          setTimeout(() => wx.switchTab({ url: '/pages/dishes/dishes' }), 1500)
        }).catch(() => {})
      }
    })
  },

  // 引入到我家（跨家庭复制公开菜）
  cloneDish() {
    if (this.data.cloning) return
    if (!this.data.hasFamily) { wx.showToast({ title: '请先加入家庭', icon: 'none' }); return }
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
  },

  // 游客引导：跳转家庭页创建/加入家庭
  goJoinFamily() {
    wx.navigateTo({ url: '/pages/family/family' })
  }
})
