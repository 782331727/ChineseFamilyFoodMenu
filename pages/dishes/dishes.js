// pages/dishes/dishes.js
const { callFunction } = require('../../utils/api')
const { mapDish } = require('../../utils/mapper')
const { hasPermission } = require('../../utils/auth')

Page({
  data: {
    keyword: '',
    currentCategory: 'all',
    categories: [
      { value: 'all', label: '全部' },
      { value: 'trending', label: '🔥常点' },
      { value: 'public', label: '🌍公开' },
      { value: '家常', label: '家常' },
      { value: '硬菜', label: '硬菜' },
      { value: '快手', label: '快手' },
      { value: '早餐', label: '早餐' },
      { value: '汤', label: '汤' },
      { value: '甜品', label: '甜品' },
      { value: '水果', label: '水果' },
      { value: '主食', label: '主食' }
    ],
    dishList: [],
    canManageDishes: false,
    // 批量管理
    batchMode: false,
    selectedIds: {},
    batchCategory: '家常',
    batchPublic: true,
    batchCategoryOptions: ['家常', '硬菜', '快手', '早餐', '汤', '甜品', '水果', '主食', '其他'],
    showTrash: false,
    trashList: [],
    page: 1,
    pageSize: 10,
    loading: false,
    noMore: false
  },

  onLoad() {
    this.setData({ canManageDishes: hasPermission('manage_dishes') })
    this.loadDishes()
  },

  onShow() {
    // 从添加页面返回时刷新
    if (this._needRefresh) {
      this.setData({ page: 1, noMore: false, dishList: [] })
      this.loadDishes()
      this._needRefresh = false
    }
  },

  // 搜索输入（防抖300ms）
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this.setData({ page: 1, noMore: false, dishList: [] })
      this.loadDishes()
    }, 300)
  },

  // 搜索确认
  onSearchConfirm() {
    this.setData({ page: 1, noMore: false, dishList: [] })
    this.loadDishes()
  },

  // 清除搜索
  clearSearch() {
    this.setData({ keyword: '', page: 1, noMore: false, dishList: [] })
    this.loadDishes()
  },

  // 分类切换
  onCategoryTap(e) {
    const value = e.currentTarget.dataset.value
    this.setData({
      currentCategory: value,
      keyword: '',
      page: 1,
      noMore: false,
      dishList: []
    })
    this.loadDishes()
  },

  // 加载菜品列表
  // '常点'用 dish-trending，无家庭用 dish-public，其他用 dish-list
  loadDishes() {
    if (this.data.loading || this.data.noMore) return
    this.setData({ loading: true })

    // 常点：调 dish-trending，不分页
    if (this.data.currentCategory === 'trending') {
      callFunction('dish-trending').then(data => {
        const list = (data.list || []).map(mapDish).map(d => ({
          ...d,
          tags: [
            ...(d.tags || []),
            `📋${d.count90 || 0}次`,
            ...(d.trend ? [d.trend] : [])
          ]
        }))
        this.setData({ dishList: list, loading: false, noMore: true })
      }).catch(() => { this.setData({ loading: false }) })
      return
    }

    const params = {
      page: this.data.page,
      pageSize: this.data.pageSize,
      keyword: this.data.keyword
    }
    // 'all'/'public'/'trending' 不传 cuisine
    if (this.data.currentCategory !== 'all' && this.data.currentCategory !== 'public') {
      params.cuisine = this.data.currentCategory
    }

    const hasFamily = !!(getApp().globalData.familyId || wx.getStorageSync('familyId'))
    // 🌍公开：强制看全平台公开菜；无家庭也看公开菜
    const usePublic = this.data.currentCategory === 'public' || !hasFamily
    const fnName = usePublic ? 'dish-public' : 'dish-list'

    callFunction(fnName, params).then(data => {
      const list = (data.list || []).map(mapDish)
      const newList = this.data.page === 1 ? list : this.data.dishList.concat(list)
      this.setData({
        dishList: newList,
        loading: false,
        noMore: !data.hasMore
      })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  // 触底加载
  onReachBottom() {
    if (!this.data.noMore && !this.data.loading) {
      this.setData({ page: this.data.page + 1 })
      this.loadDishes()
    }
  },

  // 跳转菜品详情
  goDishDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/dish-detail/dish-detail?id=' + id })
  },

  // 跳转添加菜品
  goAddDish() {
    this._needRefresh = true
    wx.navigateTo({ url: '/pages/dish-add/dish-add' })
  },

  // 随机推荐
  randomPick() {
    if (this.data.dishList.length === 0) { wx.showToast({ title: '暂无菜品', icon: 'none' }); return }
    const i = Math.floor(Math.random() * this.data.dishList.length)
    const d = this.data.dishList[i]
    wx.showModal({
      title: '🎲 今天吃这个？',
      content: `${d.name}${d.tags && d.tags.length ? '\n' + d.tags.slice(0,3).join(' ') : ''}`,
      confirmText: '就它了',
      success: res => { if (res.confirm) wx.navigateTo({ url: '/pages/dish-detail/dish-detail?id=' + d._id }) }
    })
  },

  // === 回收站 ===
  toggleTrash() {
    if (this.data.showTrash) { this.setData({ showTrash: false, trashList: [] }); return }
    this.loadTrash()
  },
  loadTrash() {
    // 走 dish-list 但不过滤 is_deleted
    callFunction('dish-list', { page: 1, pageSize: 50, deleted: true }).then(data => {
      const list = (data.list || []).map(d => ({ _id: d._id, name: d.name || '未知', deletedAt: d.updated_at }))
      this.setData({ showTrash: true, trashList: list })
    }).catch(() => {})
  },
  restoreDish(e) {
    const id = e.currentTarget.dataset.id
    callFunction('dish-add', { action: 'restore', dish_id: id }).then(() => {
      wx.showToast({ title: '已恢复', icon: 'success' })
      this.loadTrash(); this.setData({ page: 1, noMore: false, dishList: [] }); this.loadDishes()
    }).catch(() => {})
  },
  hardDeleteDish(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '彻底删除', content: '此操作不可撤销，确定？', confirmColor: '#E74C3C', success: res => {
      if (!res.confirm) return
      callFunction('dish-add', { action: 'hardDelete', dish_id: id }).then(() => {
        wx.showToast({ title: '已删除', icon: 'success' }); this.loadTrash()
      }).catch(() => {})
    }})
  },

  /* 长按快捷删除 */
  quickDelete(e) {
    if (!this.data.canManageDishes) return
    const dish = e.detail && e.detail.dish
    if (!dish || !dish._id) return
    wx.showModal({
      title: '删除菜品',
      content: `将「${dish.name || '未知'}」移入回收站？`,
      confirmColor: '#E74C3C',
      success: res => {
        if (!res.confirm) return
        callFunction('dish-add', { action: 'softDelete', dish_id: dish._id }).then(() => {
          wx.showToast({ title: '已移入回收站', icon: 'success' })
          this.setData({ page: 1, noMore: false, dishList: [] })
          this.loadDishes()
        }).catch(() => { wx.showToast({ title: '删除失败，请重试', icon: 'none' }) })
      }
    })
  },

  // === 批量分类管理 ===
  enterBatchMode() {
    this.setData({ batchMode: true, selectedIds: {} })
  },
  exitBatchMode() {
    this.setData({ batchMode: false, selectedIds: {} })
  },
  toggleBatchSelect(e) {
    const id = e.currentTarget.dataset.id
    const sel = { ...this.data.selectedIds }
    sel[id] ? delete sel[id] : (sel[id] = true)
    this.setData({ selectedIds: sel })
  },
  batchSelectAll() {
    const all = {}
    this.data.dishList.forEach(d => { all[d._id] = true })
    this.setData({ selectedIds: all })
  },
  batchDeselectAll() {
    this.setData({ selectedIds: {} })
  },
  onBatchCategoryChange(e) {
    this.setData({ batchCategory: this.data.batchCategoryOptions[e.detail.value] })
  },
  applyBatchCategory() {
    const ids = Object.keys(this.data.selectedIds)
    if (ids.length === 0) { wx.showToast({ title: '请先选择菜品', icon: 'none' }); return }
    wx.showModal({
      title: '批量修改分类',
      content: `将 ${ids.length} 道菜改为「${this.data.batchCategory}」？`,
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '更新中...' })
        callFunction('dish-add', {
          action: 'batchCategory',
          dish_ids: ids,
          cuisine: this.data.batchCategory
        }).then(data => {
          wx.hideLoading()
          wx.showToast({ title: `已更新 ${data.updated || ids.length} 道`, icon: 'success' })
          this.exitBatchMode()
          this.setData({ page: 1, noMore: false, dishList: [] })
          this.loadDishes()
        }).catch(() => { wx.hideLoading() })
      }
    })
  },

  toggleBatchPublic() {
    this.setData({ batchPublic: !this.data.batchPublic })
  },

  applyBatchPublic() {
    const ids = Object.keys(this.data.selectedIds)
    if (ids.length === 0) { wx.showToast({ title: '请先选择菜品', icon: 'none' }); return }
    const pub = this.data.batchPublic
    wx.showModal({
      title: '批量修改可见性',
      content: `将 ${ids.length} 道菜设为「${pub ? '公开' : '仅家庭可见'}」？`,
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '更新中...' })
        callFunction('dish-add', { action: 'batchCategory', dish_ids: ids, cuisine: this.data.batchCategory }).then(data => {
          wx.hideLoading()
          wx.showToast({ title: `已更新 ${data.updated || ids.length} 道`, icon: 'success' })
          this.exitBatchMode()
          this.setData({ page: 1, noMore: false, dishList: [] })
          this.loadDishes()
        }).catch(err => { wx.hideLoading(); wx.showToast({ title: (err && err.message) || '更新失败', icon: 'none' }) })
      }
    })
  },

  applyBatchDelete() {
    const ids = Object.keys(this.data.selectedIds)
    if (ids.length === 0) { wx.showToast({ title: '请先选择菜品', icon: 'none' }); return }
    wx.showModal({
      title: '批量删除',
      content: `将 ${ids.length} 道菜移入回收站？`,
      confirmColor: '#E74C3C',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        callFunction('dish-add', { action: 'batchDelete', dish_ids: ids }).then(data => {
          wx.hideLoading()
          wx.showToast({ title: `已移入回收站 (${data.updated || ids.length}道)`, icon: 'success' })
          this.exitBatchMode()
          this.setData({ page: 1, noMore: false, dishList: [] })
          this.loadDishes()
        }).catch(() => { wx.hideLoading() })
      }
    })
  }
})
