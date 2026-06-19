// pages/shopping/shopping.js
const { callFunction } = require('../../utils/api')
const { formatDate } = require('../../utils/date')
const { hasPermission } = require('../../utils/auth')

// 常见分类对应的 emoji
const CATEGORY_ICONS = {
  '蔬菜': '🥬', '肉类': '🥩', '海鲜': '🦐', '调料': '🧂',
  '主食': '🍚', '水果': '🍎', '其他': '📦', '乳制品': '🥛',
  '蛋类': '🥚', '豆制品': '🫘'
}

Page({
  data: {
    startDate: '',
    endDate: '',
    shoppingList: [],
    hasData: false,
    totalPrice: 0,
    totalChecked: 0,
    totalItems: 0,
    rawListIds: [],
    rawItems: {},
    // AI 生成
    showInventory: false,
    inventoryText: '',
    aiGenerating: false,
    canManage: false,
    // 批量操作
    allChecked: false,
    // 手动添加
    showAddPanel: false,
    addName: '',
    addAmount: '',
    addCategory: '其他',
    categoryOptions: ['蔬菜', '肉类', '海鲜', '调料', '主食', '水果', '蛋类', '豆制品', '乳制品', '其他']
  },

  onLoad() {
    this.setData({ canManage: hasPermission('manage_shopping') })
    this.initDateRange()
    this.loadShoppingList()
  },

  onShow() {
    this.loadShoppingList()
  },

  initDateRange() {
    const today = new Date()
    const day = today.getDay()
    const diff = day === 0 ? -6 : 1 - day
    today.setDate(today.getDate() + diff)
    const start = formatDate(today)
    const d = new Date(today)
    d.setDate(d.getDate() + 7)
    const end = formatDate(d)
    this.setData({ startDate: start, endDate: end })
  },

  loadShoppingList() {
    callFunction('shopping-list', { action: 'list', week_start: this.data.startDate }).then(listData => {
      const rawLists = listData || []
      if (rawLists.length === 0) {
        this.setData({ shoppingList: [], hasData: false, rawListIds: [] })
        return
      }
      this.buildGrouped(rawLists)
    }).catch(() => {})
  },

  // 把原始清单数据按 category 分组，合并统计
  buildGrouped(rawLists) {
    const grouped = {}
    let totalItems = 0, totalChecked = 0, totalPrice = 0, itemIdCounter = 0
    const rawListIds = []

    rawLists.forEach(list => {
      rawListIds.push(list._id)
      const items = list.items || []
      items.forEach((item, idx) => {
        const cat = item.category || '其他'
        if (!grouped[cat]) {
          grouped[cat] = { category: cat, icon: CATEGORY_ICONS[cat] || '📦', items: [], checkedCount: 0 }
        }
        const checked = !!item.checked
        const price = parseFloat(item.estimated_price || item.estimatedPrice || 0)
        grouped[cat].items.push({
          _key: 'i_' + (++itemIdCounter),
          name: item.name,
          amount: item.amount || '',
          checked,
          estimatedPrice: price.toFixed(2),
          _listId: list._id,
          _itemIndex: idx
        })
        if (checked) { grouped[cat].checkedCount++; totalChecked++ }
        totalPrice += price
        totalItems++
      })
    })

    this.setData({
      shoppingList: Object.values(grouped),
      hasData: true,
      totalPrice: totalPrice.toFixed(2),
      totalChecked,
      totalItems,
      rawListIds,
      allChecked: totalItems > 0 && totalChecked === totalItems
    })
  },

  // 把当前分组数据还原为原始 arrays 格式，用于写回 DB
  // 返回按 _listId 分组的 items 数组
  rebuildRawItems() {
    const byList = {}
    this.data.shoppingList.forEach(cat => {
      cat.items.forEach(item => {
        if (!item._listId) return
        if (!byList[item._listId]) byList[item._listId] = []
        byList[item._listId].push({
          name: item.name,
          amount: item.amount,
          category: cat.category,
          checked: item.checked,
          estimated_price: item.estimatedPrice || ''
        })
      })
    })
    return byList
  },

  // 同步全部 items 到云端（批量写回）
  syncToCloud(callback) {
    const byList = this.rebuildRawItems()
    const tasks = Object.keys(byList).map(listId => {
      return callFunction('shopping-list', {
        action: 'update_items',
        list_id: listId,
        items: byList[listId]
      })
    })
    Promise.all(tasks.map(p => p.catch(() => {}))).then(() => {
      if (callback) callback()
    })
  },

  toggleItem(e) {
    const cat = e.currentTarget.dataset.cat
    const index = e.currentTarget.dataset.index
    const catSection = this.data.shoppingList.find(c => c.category === cat)
    if (!catSection || !catSection.items[index]) return

    const item = catSection.items[index]
    const newChecked = !item.checked
    item.checked = newChecked
    const catChecked = catSection.items.filter(it => it.checked).length
    const newTotalChecked = this.data.totalChecked + (newChecked ? 1 : -1)
    const catIdx = this.data.shoppingList.indexOf(catSection)
    this.setData({
      [`shoppingList[${catIdx}].items[${index}].checked`]: newChecked,
      [`shoppingList[${catIdx}].checkedCount`]: catChecked,
      totalChecked: newTotalChecked,
      allChecked: newTotalChecked === this.data.totalItems
    })
    // 单个勾选用 toggle_item（所有人可操作，无需 admin/cook）
    callFunction('shopping-list', { action: 'toggle_item', list_id: item._listId, item_index: item._itemIndex, checked: newChecked }).catch(() => {})
  },

  // 删除食材
  deleteItem(e) {
    if (!this.data.canManage) { wx.showToast({ title: '仅家长/大厨可管理清单', icon: 'none' }); return }
    const cat = e.currentTarget.dataset.cat
    const index = e.currentTarget.dataset.index
    const catSection = this.data.shoppingList.find(c => c.category === cat)
    if (!catSection) return

    const item = catSection.items[index]
    wx.showModal({
      title: '删除食材',
      content: `确定删除「${item.name}」吗？`,
      success: res => {
        if (!res.confirm) return
        catSection.items.splice(index, 1)
        const catChecked = catSection.items.filter(it => it.checked).length
        const newTotalChecked = this.data.shoppingList.reduce((sum, c) => sum + c.items.filter(it => it.checked).length, 0)
        const newTotalItems = this.data.shoppingList.reduce((sum, c) => sum + c.items.length, 0)
        // 重新分配 _key
        let counter = 0
        this.data.shoppingList.forEach(c => c.items.forEach(it => { it._key = 'i_' + (++counter) }))

        this.setData({
          [`shoppingList[${this.data.shoppingList.indexOf(catSection)}].checkedCount`]: catChecked,
          shoppingList: this.data.shoppingList,
          totalChecked: newTotalChecked,
          totalItems: newTotalItems,
          hasData: newTotalItems > 0
        })
        this.syncToCloud()
      }
    })
  },

  // === 批量操作 ===
  selectAll() {
    if (!this.data.canManage) { wx.showToast({ title: '仅家长/大厨可管理清单', icon: 'none' }); return }
    if (this.data.allChecked) {
      this.data.shoppingList.forEach(cat => {
        cat.items.forEach(it => { it.checked = false })
        cat.checkedCount = 0
      })
      this.setData({ shoppingList: this.data.shoppingList, totalChecked: 0, allChecked: false })
    } else {
      this.data.shoppingList.forEach(cat => {
        cat.items.forEach(it => { it.checked = true })
        cat.checkedCount = cat.items.length
      })
      this.setData({ shoppingList: this.data.shoppingList, totalChecked: this.data.totalItems, allChecked: true })
    }
    this.syncToCloud()
  },

  uncheckAll() {
    if (!this.data.canManage) { wx.showToast({ title: '仅家长/大厨可管理清单', icon: 'none' }); return }
    const count = this.data.totalChecked
    if (count === 0) return
    this.data.shoppingList.forEach(cat => {
      cat.items.forEach(it => { it.checked = false })
      cat.checkedCount = 0
    })
    this.setData({
      shoppingList: this.data.shoppingList,
      totalChecked: 0,
      allChecked: false
    })
    this.syncToCloud()
  },

  // === 手动添加食材 ===
  showManualAdd() {
    this.setData({ showAddPanel: true })
  },

  showAddItem(e) {
    const cat = e.currentTarget.dataset.cat
    this.setData({ showAddPanel: true, addCategory: cat || '其他', addName: '', addAmount: '' })
  },

  cancelAdd() {
    this.setData({ showAddPanel: false, addName: '', addAmount: '' })
  },

  onAddNameInput(e) { this.setData({ addName: e.detail.value }) },
  onAddAmountInput(e) { this.setData({ addAmount: e.detail.value }) },
  selectAddCategory(e) { this.setData({ addCategory: e.currentTarget.dataset.cat }) },

  confirmAddItem() {
    if (!this.data.canManage) { wx.showToast({ title: '仅家长/大厨可管理清单', icon: 'none' }); return }
    const name = (this.data.addName || '').trim()
    if (!name) { wx.showToast({ title: '请输入食材名', icon: 'none' }); return }
    const cat = this.data.addCategory || '其他'
    const amount = (this.data.addAmount || '').trim()

    // 如果没有已有清单，先创建一个
    if (this.data.rawListIds.length === 0) {
      const newItem = { name, amount, category: cat, checked: false, estimated_price: '' }
      callFunction('shopping-list', {
        action: 'create',
        week_start: this.data.startDate,
        items: [newItem]
      }).then(() => {
        this.setData({ showAddPanel: false, addName: '', addAmount: '' })
        this.loadShoppingList()
      }).catch(() => {})
      return
    }

    // 添加到已有清单
    const listId = this.data.rawListIds[0]
    let catIdx = this.data.shoppingList.findIndex(c => c.category === cat)
    if (catIdx < 0) {
      this.data.shoppingList.push({ category: cat, icon: CATEGORY_ICONS[cat] || '📦', items: [], checkedCount: 0 })
      catIdx = this.data.shoppingList.length - 1
    }
    const itemCounter = this.data.totalItems + 1
    this.data.shoppingList[catIdx].items.push({
      _key: 'i_' + itemCounter, name, amount, checked: false,
      estimatedPrice: '', _listId: listId, _itemIndex: this.data.shoppingList[catIdx].items.length
    })
    this.setData({
      [`shoppingList[${catIdx}]`]: this.data.shoppingList[catIdx],
      totalItems: this.data.totalItems + 1, hasData: true,
      showAddPanel: false, addName: '', addAmount: ''
    })
    this.syncToCloud()
  },

  refreshList() {
    this.loadShoppingList()
    wx.showToast({ title: '已刷新', icon: 'success' })
  },

  shareList() {
    let text = `📋 采购清单 ${this.data.startDate}~${this.data.endDate}\n`
    this.data.shoppingList.forEach(cat => {
      text += `\n${cat.icon} ${cat.category}\n`
      cat.items.forEach(it => { text += `${it.checked ? '✅' : '⬜'} ${it.name} ${it.amount || ''}\n` })
    })
    text += `\n💰 预计 ¥${this.data.totalPrice} | 已买 ${this.data.totalChecked}/${this.data.totalItems}`
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' }) })
  },

  // === 日期范围调整 ===
  onStartDateChange(e) {
    this.setDateRange(e.detail.value, 7)
    this.loadShoppingList()
  },
  prevWeek() { this.shiftWeek(-7) },
  nextWeek() { this.shiftWeek(7) },
  shiftWeek(days) {
    const d = new Date(this.data.startDate)
    d.setDate(d.getDate() + days)
    this.setDateRange(formatDate(d), 7)
    this.loadShoppingList()
  },
  setDateRange(start, span) {
    const d = new Date(start)
    d.setDate(d.getDate() + span)
    this.setData({ startDate: start, endDate: formatDate(d) })
  },

  // === AI 生成采购清单 ===
  generateByAI() { this.setData({ showInventory: !this.data.showInventory }) },
  onInventoryInput(e) { this.setData({ inventoryText: e.detail.value }) },
  cancelInventory() { this.setData({ showInventory: false, inventoryText: '' }) },
  confirmGenerateAI() {
    if (!this.data.canManage) { wx.showToast({ title: '仅家长/大厨可管理清单', icon: 'none' }); return }
    if (this.data.aiGenerating) return
    this.setData({ aiGenerating: true })
    const inventory = (this.data.inventoryText || '').split(/[，,、\s]+/).map(s => s.trim()).filter(Boolean)
    callFunction('ai-shopping', { week_start: this.data.startDate, inventory }).then(data => {
      const aiItems = (data && data.items) || []
      if (aiItems.length === 0) {
        wx.showToast({ title: '本周菜单暂无食材', icon: 'none' })
        this.setData({ aiGenerating: false }); return
      }
      const items = aiItems.map(it => ({
        name: it.name || '', amount: it.amount || '', category: it.category || '其他',
        checked: false, estimated_price: it.estimated_price || '', from_dishes: []
      }))
      callFunction('shopping-list', {
        action: 'create', week_start: this.data.startDate, items,
        estimated_cost: (data && data.total_estimated_cost) || ''
      }).then(() => {
        wx.showToast({ title: 'AI 清单已生成', icon: 'success' })
        this.setData({ aiGenerating: false, showInventory: false, inventoryText: '' })
        this.loadShoppingList()
      }).catch(() => { this.setData({ aiGenerating: false }) })
    }).catch(() => { this.setData({ aiGenerating: false }) })
  }
})
