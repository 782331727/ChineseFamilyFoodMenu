// pages/admin/admin.js
// 平台超管：跨家庭全量管理（菜品/家庭/用户/系统）
const { callFunction } = require('../../utils/api')

Page({
  data: {
    currentTab: 'overview',
    tabs: [
      { key: 'overview', emoji: '📊', label: '概览' },
      { key: 'dishes', emoji: '🍳', label: '菜品' },
      { key: 'users', emoji: '👥', label: '用户' },
      { key: 'families', emoji: '🏠', label: '家庭' },
      { key: 'system', emoji: '⚙️', label: '系统' }
    ],
    myOpenid: '', noPermission: false,

    // 概览
    stats: { totalDishes: 0, totalFamilies: 0, totalUsers: 0, totalMenus: 0, totalPreorders: 0 },

    // 菜品
    dishes: [], dishTotal: 0, dishPage: 1, dishLoading: false, dishKeyword: '',
    dishEditId: '', dishEditForm: {},
    dishSelectAll: false, dishSelected: {},

    // 用户
    users: [], userTotal: 0, userPage: 1, userLoading: false, userKeyword: '',
    userRoleFilter: '',

    // 家庭
    families: [], famTotal: 0, famPage: 1, famLoading: false,
    famDetail: null, famMembers: [],

    // 系统
    admins: [], addOpenid: ''
  },

  onLoad() {
    this.getMyOpenid()
    this.loadStats()
    this.loadDishes()
    this.loadAdmins()
  },

  // ==================== 通用 ====================

  getMyOpenid() {
    callFunction('content-admin', { action: 'my_openid' }).then(data => {
      if (data && data.openid) this.setData({ myOpenid: data.openid })
    }).catch(() => {})
  },
  copyOpenid() {
    wx.setClipboardData({ data: this.data.myOpenid })
    wx.showToast({ title: '已复制', icon: 'success' })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ currentTab: tab })
    if (tab === 'overview') this.loadStats()
    else if (tab === 'dishes') this.loadDishes()
    else if (tab === 'users') this.loadUsers()
    else if (tab === 'families') this.loadFamilies()
    else if (tab === 'system') this.loadAdmins()
  },

  // ==================== 概览 ====================

  loadStats() {
    callFunction('content-admin', { action: 'stats' }).then(data => {
      if (data) this.setData({ stats: data })
    }).catch(() => {})
  },

  // ==================== 菜品管理 ====================

  loadDishes() {
    if (this.data.dishLoading) return
    this.setData({ dishLoading: true, dishSelectAll: false, dishSelected: {} })
    callFunction('content-admin', {
      action: 'list_dishes', page: this.data.dishPage, keyword: this.data.dishKeyword
    }).then(data => {
      if (data) this.setData({ dishes: data.list || [], dishTotal: data.total, dishLoading: false })
    }).catch(() => { this.setData({ dishLoading: false }) })
  },

  onDishSearchInput(e) { this.setData({ dishKeyword: e.detail.value }) },
  onDishSearch() { this.setData({ dishPage: 1 }); this.loadDishes() },
  dishPrevPage() { if (this.data.dishPage <= 1) return; this.setData({ dishPage: this.data.dishPage - 1 }); this.loadDishes() },
  dishNextPage() { this.setData({ dishPage: this.data.dishPage + 1 }); this.loadDishes() },

  toggleDishSelect(e) {
    const id = e.currentTarget.dataset.id
    const sel = { ...this.data.dishSelected }
    sel[id] = !sel[id]
    this.setData({ dishSelected: sel, dishSelectAll: false })
  },
  toggleSelectAll() {
    const all = !this.data.dishSelectAll
    const sel = {}
    if (all) this.data.dishes.forEach(d => { sel[d._id] = true })
    this.setData({ dishSelectAll: all, dishSelected: sel })
  },

  toggleDishPublic(e) {
    const id = e.currentTarget.dataset.id
    callFunction('content-admin', { action: 'dish_toggle_public', dish_id: id }).then(data => {
      wx.showToast({ title: data.message || '已切换', icon: 'success' })
      this.loadDishes()
    })
  },

  startEditDish(e) {
    const dish = e.currentTarget.dataset.dish
    this.setData({
      dishEditId: dish._id,
      dishEditForm: {
        name: dish.name || '',
        cuisine: dish.cuisine || '',
        difficulty: dish.difficulty || 'easy',
        cook_time: dish.cook_time || 30,
        is_public: dish.is_public || false
      }
    })
  },
  onEditFieldChange(e) {
    const field = e.currentTarget.dataset.field
    // chip 按钮用 dataset.value，input/switch 用 detail.value
    const val = e.detail.value !== undefined ? e.detail.value : e.currentTarget.dataset.value
    this.setData({ ['dishEditForm.' + field]: val })
  },
  cancelEdit() { this.setData({ dishEditId: '' }) },
  saveDishEdit() {
    callFunction('content-admin', {
      action: 'dish_edit', dish_id: this.data.dishEditId, ...this.data.dishEditForm
    }).then(() => {
      wx.showToast({ title: '已更新', icon: 'success' })
      this.setData({ dishEditId: '' })
      this.loadDishes()
    })
  },

  deleteDish(e) {
    const id = e.currentTarget.dataset.id, name = e.currentTarget.dataset.name
    wx.showModal({
      title: '彻底删除', content: `确定永久删除「${name}」？不可恢复！`, confirmColor: '#E74C3C',
      success: res => {
        if (!res.confirm) return
        callFunction('content-admin', { action: 'hard_delete', dish_id: id }).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadDishes()
        })
      }
    })
  },

  batchDeleteDishes() {
    const ids = Object.keys(this.data.dishSelected).filter(k => this.data.dishSelected[k])
    if (ids.length === 0) { wx.showToast({ title: '请选择菜品', icon: 'none' }); return }
    wx.showModal({
      title: '批量删除', content: `确定永久删除 ${ids.length} 道菜品？不可恢复！`, confirmColor: '#E74C3C',
      success: res => {
        if (!res.confirm) return
        callFunction('content-admin', { action: 'hard_delete', dish_id: ids }).then(data => {
          wx.showToast({ title: data.message || '已删除', icon: 'success' })
          this.loadDishes()
        })
      }
    })
  },

  // ==================== 用户管理 ====================

  loadUsers() {
    if (this.data.userLoading) return
    this.setData({ userLoading: true })
    callFunction('content-admin', {
      action: 'list_users', page: this.data.userPage, keyword: this.data.userKeyword, role: this.data.userRoleFilter
    }).then(data => {
      if (data) this.setData({ users: data.list || [], userTotal: data.total, userLoading: false })
    }).catch(() => { this.setData({ userLoading: false }) })
  },

  onUserSearchInput(e) { this.setData({ userKeyword: e.detail.value }) },
  onUserSearch() { this.setData({ userPage: 1 }); this.loadUsers() },
  onUserRoleFilter(e) { this.setData({ userRoleFilter: e.currentTarget.dataset.role, userPage: 1 }); this.loadUsers() },
  userPrevPage() { if (this.data.userPage <= 1) return; this.setData({ userPage: this.data.userPage - 1 }); this.loadUsers() },
  userNextPage() { this.setData({ userPage: this.data.userPage + 1 }); this.loadUsers() },

  copyUserOpenid(e) {
    const { openid, name } = e.currentTarget.dataset
    if (!openid) return
    wx.setClipboardData({ data: openid })
    wx.showToast({ title: `已复制 ${name || '用户'} 的 OPENID`, icon: 'success' })
  },

  setUserRole(e) {
    const { id, role } = e.currentTarget.dataset
    const roleLabels = { admin: '家长', cook: '大厨', eater: '干饭人', child: '花朵', '': '无角色' }
    wx.showActionSheet({
      itemList: ['家长(admin)', '大厨(cook)', '干饭人(eater)', '花朵(child)', '移除角色'],
      success: res => {
        const roles = ['admin', 'cook', 'eater', 'child', '']
        const newRole = roles[res.tapIndex]
        callFunction('content-admin', { action: 'user_set_role', user_id: id, role: newRole }).then(() => {
          wx.showToast({ title: '已更新', icon: 'success' })
          this.loadUsers()
        })
      }
    })
  },

  removeUserFamily(e) {
    const id = e.currentTarget.dataset.id, name = e.currentTarget.dataset.name
    wx.showModal({
      title: '移出家庭', content: `将「${name}」移出当前家庭？`,
      success: res => {
        if (!res.confirm) return
        callFunction('content-admin', { action: 'user_remove_family', user_id: id }).then(() => {
          wx.showToast({ title: '已移出', icon: 'success' })
          this.loadUsers()
        })
      }
    })
  },

  deleteUser(e) {
    const id = e.currentTarget.dataset.id, name = e.currentTarget.dataset.name
    wx.showModal({
      title: '删除用户', content: `确定永久删除「${name}」？`, confirmColor: '#E74C3C',
      success: res => {
        if (!res.confirm) return
        callFunction('content-admin', { action: 'user_delete', user_id: id }).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadUsers()
        })
      }
    })
  },

  // ==================== 家庭管理 ====================

  loadFamilies() {
    if (this.data.famLoading) return
    this.setData({ famLoading: true })
    callFunction('content-admin', {
      action: 'list_families', page: this.data.famPage
    }).then(data => {
      if (data) this.setData({ families: data.list || [], famTotal: data.total, famLoading: false })
    }).catch(() => { this.setData({ famLoading: false }) })
  },

  famPrevPage() { if (this.data.famPage <= 1) return; this.setData({ famPage: this.data.famPage - 1 }); this.loadFamilies() },
  famNextPage() { this.setData({ famPage: this.data.famPage + 1 }); this.loadFamilies() },

  viewFamily(e) {
    const id = e.currentTarget.dataset.id
    callFunction('content-admin', { action: 'family_detail', family_id: id }).then(data => {
      if (data) this.setData({ famDetail: data.family, famMembers: data.members })
    })
  },
  closeFamDetail() { this.setData({ famDetail: null, famMembers: [] }) },

  deleteFamily(e) {
    const id = e.currentTarget.dataset.id, name = e.currentTarget.dataset.name
    wx.showModal({
      title: '删除家庭', content: `确定删除「${name}」及其所有菜品/菜单/预定数据？不可恢复！`, confirmColor: '#E74C3C',
      success: res => {
        if (!res.confirm) return
        callFunction('content-admin', { action: 'family_delete', family_id: id }).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' })
          this.setData({ famDetail: null, famMembers: [] })
          this.loadFamilies()
        })
      }
    })
  },

  // ==================== 系统管理 ====================

  loadAdmins() {
    callFunction('content-admin', { action: 'list_admins' }).then(data => {
      if (data && data.openids) this.setData({ admins: data.openids, noPermission: false })
    }).catch(() => { this.setData({ noPermission: true }) })
  },

  onAddOpenidInput(e) { this.setData({ addOpenid: e.detail.value }) },

  addAdmin() {
    const oid = this.data.addOpenid.trim()
    if (!oid) { wx.showToast({ title: '请输入OPENID', icon: 'none' }); return }
    callFunction('content-admin', { action: 'add_admin', target_openid: oid }).then(() => {
      wx.showToast({ title: '已添加', icon: 'success' })
      this.setData({ addOpenid: '' }); this.loadAdmins()
    })
  },

  removeAdmin(e) {
    const oid = e.currentTarget.dataset.oid
    wx.showModal({
      title: '移除超管', content: '确定移除该超级管理员？',
      success: res => {
        if (!res.confirm) return
        callFunction('content-admin', { action: 'remove_admin', target_openid: oid }).then(() => {
          this.loadAdmins()
        })
      }
    })
  }
})
