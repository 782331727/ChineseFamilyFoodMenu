// pages/home/home.js
const { callFunction } = require('../../utils/api')
const { getTodayStr, getTomorrowStr, formatDateWithWeek, getFutureDays } = require('../../utils/date')
const { mapDish, mealToFront } = require('../../utils/mapper')
const { hasPermission } = require('../../utils/auth')

Page({
  data: {
    userName: '张姐', avatar: '', todayText: '', greeting: '',
    hasFamily: false, canManageDishes: false,
    viewMode: 'today',
    todayMenu: { morning: [], noon: [], evening: [] },
    weekMenus: [],
    cookMap: {},
    cookingDish: null,
    cookingElapsed: '',
    preorderSummary: { count: 0, members: [], dishes: [], unorderedCount: 0 }
  },

  onLoad() { this.initGreeting() },

  onShow() {
    const app = getApp()
    const hasFamily = !!(app.globalData.familyId || wx.getStorageSync('familyId'))
    this.setData({ hasFamily, canManageDishes: hasPermission('manage_dishes') })
    if (hasFamily) {
      if (this.data.viewMode === 'today') this.loadTodayMenu()
      else this.loadWeekMenus()
      this.loadPreorderSummary()
    }
  },

  initGreeting() {
    const hour = new Date().getHours()
    let g = '你好'
    if (hour < 6) g = '夜深了'; else if (hour < 11) g = '早上好'; else if (hour < 14) g = '中午好'; else if (hour < 18) g = '下午好'; else g = '晚上好'
    const u = getApp().globalData.userInfo
    this.setData({ greeting: g, userName: (u && u.nickName) || '张姐', avatar: (u && u.avatarUrl) || '', todayText: formatDateWithWeek() })
  },

  switchView(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ viewMode: mode })
    if (mode === 'today') this.loadTodayMenu(); else this.loadWeekMenus()
  },

  loadTodayMenu() {
    const today = getTodayStr()
    return callFunction('menu-manage', { action: 'list', date: today }).then(list => {
      const menu = { morning: [], noon: [], evening: [] }
      ;(list || []).forEach(item => {
        const fm = mealToFront(item.meal_type)
        if (menu[fm]) menu[fm].push({ ...mapDish(item.dish_info) || {}, cookId: item.cook_id, status: item.status, menuId: item._id })
      })
      this.setData({ todayMenu: menu })
      this.loadCookNames()
      this.checkCooking(list || [])
    })
  },

  loadWeekMenus() {
    const days = getFutureDays(7)
    const tasks = days.map(d => callFunction('menu-manage', { action: 'list', date: d.date }).catch(() => []))
    Promise.all(tasks).then(results => {
      const weekMenus = days.map((d, i) => {
        const list = results[i] || []
        const meals = { morning: [], noon: [], evening: [] }
        list.forEach(item => {
          const fm = mealToFront(item.meal_type)
          if (meals[fm]) meals[fm].push({ ...mapDish(item.dish_info) || {}, cookId: item.cook_id, status: item.status, menuId: item._id })
        })
        return { date: d.date, label: d.label, week: d.week, meals }
      })
      this.setData({ weekMenus })
      this.loadCookNames()
    })
  },

  loadCookNames() {
    callFunction('family-update', { action: 'get_members' }).then(members => {
      const map = {}; (members || []).forEach(m => { map[m._id] = m.nickname || '？' })
      this.setData({ cookMap: map })
    }).catch(() => {})
  },

  // 检测是否有正在做的菜
  checkCooking(list) {
    // 清除旧计时器
    if (this._cookTimer) clearInterval(this._cookTimer)
    const cooking = (list || []).find(item => item.status === 'cooking')
    if (cooking && cooking.dish_info) {
      const dish = { menuId: cooking._id, name: cooking.dish_info.name, cookId: cooking.cook_id, cookName: '？', startedAt: cooking.started_at }
      const cm = this.data.cookMap
      if (cm && cm[cooking.cook_id]) dish.cookName = cm[cooking.cook_id]
      this.setData({ cookingDish: dish })
      this._cookTimer = setInterval(() => this.tickTimer(), 1000)
      this.tickTimer()
    } else {
      this.setData({ cookingDish: null, cookingElapsed: '' })
    }
  },

  tickTimer() {
    if (!this.data.cookingDish || !this.data.cookingDish.startedAt) return
    const start = new Date(this.data.cookingDish.startedAt).getTime()
    const sec = Math.floor((Date.now() - start) / 1000)
    const m = Math.floor(sec / 60)
    const s = sec % 60
    this.setData({ cookingElapsed: `${m}:${String(s).padStart(2, '0')}` })
  },

  // 开始做菜（点击今日菜单项触发）
  startCooking(e) {
    if (!this.data.canManageDishes) return
    const menuId = e.currentTarget.dataset.menuId
    const dish = this.data.todayMenu
    wx.showActionSheet({
      itemList: ['开始做这道菜'],
      success: () => {
        callFunction('menu-manage', { action: 'update_status', menu_id: menuId, status: 'cooking' }).then(() => {
          wx.showToast({ title: '开始做菜！', icon: 'success' })
          this.loadTodayMenu()
        }).catch(() => {})
      }
    })
  },

  finishCooking() {
    if (!this.data.cookingDish) return
    callFunction('menu-manage', { action: 'update_status', menu_id: this.data.cookingDish.menuId, status: 'done' }).then(() => {
      if (this._cookTimer) clearInterval(this._cookTimer)
      this.setData({ cookingDish: null, cookingElapsed: '' })
      wx.showToast({ title: '出锅！🍽️', icon: 'success' })
      this.loadTodayMenu()
    }).catch(() => {})
  },

  loadPreorderSummary() {
    return callFunction('preorder-list', { target_date: getTomorrowStr() }).then(data => {
      const preordered = data && data.preordered ? data.preordered : []
      const unorderedCount = data && data.not_preordered ? data.not_preordered.length : 0
      const count = preordered.reduce((sum, m) => sum + (m.preorders ? m.preorders.length : 0), 0)
      const dishList = []
      preordered.forEach(m => {
        ;(m.preorders || []).forEach(p => {
          const dn = (p.dish_info && p.dish_info.name) || '未知'
          if (!dishList.find(d => d.name === dn && d.booker === m.nickname))
            dishList.push({ name: dn, booker: m.nickname, avatar: m.avatar })
        })
      })
      this.setData({ preorderSummary: { count, members: preordered.map(m => ({ openid: m.user_id, avatar: m.avatar })), dishes: dishList, unorderedCount } })
      // Tab 角标：未预定人数
      if (unorderedCount > 0) {
        wx.setTabBarBadge({ index: 2, text: String(unorderedCount) }).catch(() => {})
      } else {
        wx.removeTabBarBadge({ index: 2 }).catch(() => {})
      }
    })
  },

  onPullDownRefresh() {
    const hf = !!(getApp().globalData.familyId || wx.getStorageSync('familyId'))
    this.setData({ hasFamily: hf, canManageDishes: hasPermission('manage_dishes') })
    if (!hf) { wx.stopPullDownRefresh(); return }
    const p = this.data.viewMode === 'today' ? this.loadTodayMenu() : this.loadWeekMenus()
    Promise.all([p, this.loadPreorderSummary()]).finally(() => wx.stopPullDownRefresh())
  },

  goPreorder() { wx.switchTab({ url: '/pages/preorder/preorder' }) },
  goPreorderList() { wx.navigateTo({ url: '/pages/preorder-list/preorder-list' }) },
  goAddDish() { wx.navigateTo({ url: '/pages/dish-add/dish-add' }) },
  goAIRecommend() { wx.navigateTo({ url: '/pages/dish-add/dish-add?tab=ai' }) },
  goShopping() { wx.switchTab({ url: '/pages/shopping/shopping' }) },
  goFamily() { wx.navigateTo({ url: '/pages/family/family' }) },
  goFamilyJoin() { wx.navigateTo({ url: '/pages/family/family?panel=join' }) }
})
