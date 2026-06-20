// pages/preorder/preorder.js
const { callFunction } = require('../../utils/api')
const { getFutureDays } = require('../../utils/date')
const { mapDish, mealToCloud } = require('../../utils/mapper')
const { hasPermission, refreshRole } = require('../../utils/auth')

Page({
  data: {
    dateOptions: [],
    selectedDate: '',
    hasFamily: false,
    mealOptions: [
      { value: 'morning', emoji: '🌅', label: '早餐' },
      { value: 'noon', emoji: '☀️', label: '午餐' },
      { value: 'evening', emoji: '🌙', label: '晚餐' }
    ],
    selectedMeal: 'noon',
    dishList: [],
    allDishes: [],       // 全量菜品，用于本地搜索
    keyword: '',
    selectedDishes: {},
    remark: '',
    selectedCount: 0,
    othersPreorder: {},  // { dishId: '张三 李四' }
    othersList: []       // [{ avatar, name, dishName }]
  },

  onLoad(options) {
    const dates = getFutureDays(7)
    const selectedDate = dates[1] ? dates[1].date : dates[0].date
    const hf = !!(getApp().globalData.familyId || wx.getStorageSync('familyId'))
    this.setData({ dateOptions: dates, selectedDate, hasFamily: hf })
    if (hf) { this.loadDishes(); this.loadOthersPreorders() }
    if (options.dishId) this.selectDish(options.dishId)
  },

  onShow() {
    refreshRole()
    const hf = !!(getApp().globalData.familyId || wx.getStorageSync('familyId'))
    this.setData({ hasFamily: hf })
    if (!hf) return
    // 短期缓存：5秒内跳过刷新
    const now = Date.now()
    if (this._lastFetch && now - this._lastFetch < 5000) return
    this._lastFetch = now
    // 刷新菜品列表（确保删除、新增的菜品能及时反映）
    this.loadDishes()
    const app = getApp()
    const dishId = app.globalData.preorderDishId
    if (dishId) {
      const trySelect = () => {
        if (this.data.dishList.length > 0) {
          this.selectDish(dishId)
          app.globalData.preorderDishId = ''
          app.globalData.preorderDishName = ''
        } else { setTimeout(trySelect, 200) }
      }
      trySelect()
    }
    this.loadOthersPreorders()
  },

  selectDish(dishId) {
    const selected = Object.assign({}, this.data.selectedDishes)
    selected[dishId] = true
    this.setData({ selectedDishes: selected, selectedCount: Object.keys(selected).length })
  },

  loadDishes() {
    callFunction('dish-list', { page: 1, pageSize: 100 }).then(data => {
      const list = (data.list || []).map(mapDish)
      this.setData({ allDishes: list, dishList: this.filterDishes(list) })
    }).catch(() => {})
  },

  filterDishes(list) {
    const kw = (this.data.keyword || '').trim().toLowerCase()
    if (!kw) return list
    return list.filter(d => d.name && d.name.toLowerCase().includes(kw))
  },

  // 搜索
  onSearchInput(e) { this.setData({ keyword: e.detail.value, dishList: this.filterDishes(this.data.allDishes) }) },
  clearSearch() { this.setData({ keyword: '', dishList: this.filterDishes(this.data.allDishes) }) },

  // 加载他人预定
  loadOthersPreorders() {
    callFunction('preorder-list', { target_date: this.data.selectedDate }).then(data => {
      const preordered = (data && data.preordered) || []
      const myOpenid = getApp().globalData.openid
      const map = {}
      const list = []
      preordered.forEach(m => {
        (m.preorders || []).forEach(p => {
          if (m.user_id !== myOpenid && p.dish_info) {
            map[p.dish_id] = (map[p.dish_id] || '') + (map[p.dish_id] ? ' ' : '') + m.nickname
            if (!list.find(l => l.name === m.nickname && l.dishName === p.dish_info.name)) {
              list.push({ _key: m.user_id + '_' + p.dish_id, avatar: m.avatar, name: m.nickname, dishName: p.dish_info.name })
            }
          }
        })
      })
      this.setData({ othersPreorder: map, othersList: list })
    }).catch(() => {})
  },

  selectDate(e) {
    this.setData({ selectedDate: e.currentTarget.dataset.date })
    this.loadOthersPreorders()
  },
  selectMeal(e) { this.setData({ selectedMeal: e.currentTarget.dataset.value }) },

  toggleDish(e) {
    const id = e.currentTarget.dataset.id
    const selected = Object.assign({}, this.data.selectedDishes)
    selected[id] ? delete selected[id] : (selected[id] = true)
    this.setData({ selectedDishes: selected, selectedCount: Object.keys(selected).length })
  },

  onRemarkInput(e) { this.setData({ remark: e.detail.value }) },

  submitPreorder() {
    if (this.data.selectedCount === 0) { wx.showToast({ title: '请至少选择一道菜', icon: 'none' }); return }
    const dishIds = Object.keys(this.data.selectedDishes)
    const date = this.data.selectedDate
    const note = this.data.remark
    const selectedMeal = this.data.selectedMeal
    wx.showLoading({ title: '提交中...' })
    const tasks = dishIds.map(dishId => {
      return callFunction('preorder-add', {
        target_date: date, dish_id: dishId,
        meal_type: mealToCloud(selectedMeal), note: note || ''
      }).then(
        () => ({ status: 'fulfilled' }),
        err => ({ status: 'rejected', reason: (err && err.message) || '' })
      )
    })
    Promise.all(tasks).then(results => {
      try { wx.hideLoading() } catch (e) {}
      const fulfilled = results.filter(r => r.status === 'fulfilled').length
      const rejected = results.length - fulfilled
      if (fulfilled === 0) { wx.showToast({ title: '预定失败，可能已预定过', icon: 'none' }); return }
      wx.showToast({ title: rejected > 0 ? `成功 ${fulfilled} 道，${rejected} 道已存在` : '预定成功', icon: 'success' })
      this.setData({ selectedDishes: {}, selectedCount: 0, remark: '' })
      this.loadOthersPreorders()
    })
  },

  goFamily() { wx.navigateTo({ url: '/pages/family/family' }) }
})
