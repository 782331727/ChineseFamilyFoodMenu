// pages/preorder-list/preorder-list.js
const { callFunction } = require('../../utils/api')
const { formatDate, formatDateWithWeek, getTomorrowStr } = require('../../utils/date')
const { getCurrentRole, getRoleName } = require('../../utils/auth')
const { mapDish } = require('../../utils/mapper')

Page({
  data: {
    selectedDate: '',
    displayDate: '',
    hasFamily: false,
    isAdmin: false,
    memberList: [],
    stats: {
      total: 0,
      preordered: 0,
      dishCount: 0
    }
  },

  onLoad() {
    const tomorrow = getTomorrowStr()
    const hf = !!(getApp().globalData.familyId || wx.getStorageSync('familyId'))
    const isAdmin = getCurrentRole() === 'admin'
    this.setData({
      selectedDate: tomorrow,
      displayDate: formatDateWithWeek(tomorrow),
      hasFamily: hf,
      isAdmin
    })
    if (hf) this.loadData()
  },

  // preorder-list 云函数返回 { preordered, not_preordered }
  // preordered 项：{ user_id, nickname, avatar, role, preorders:[{ dish_info }] }
  // not_preordered 项：{ user_id, nickname, avatar, role }
  // 前端统一拍平成 memberList，每项含 preordered 标志与 dishes 数组
  loadData() {
    callFunction('preorder-list', { target_date: this.data.selectedDate }).then(data => {
      const preordered = (data && data.preordered) || []
      const notPreordered = (data && data.not_preordered) || []

      const memberList = []

      preordered.forEach(m => {
        const dishes = (m.preorders || []).map(p => ({
          ...mapDish(p.dish_info),
          preorderId: p._id,
          note: p.note || ''
        }))
        memberList.push({
          openid: m.user_id,
          nickName: m.nickname,
          avatar: m.avatar,
          role: m.role,
          roleText: getRoleName(m.role),
          preordered: true,
          dishes,
          remark: (m.preorders || []).map(p => p.note).filter(Boolean).join('；')
        })
      })

      notPreordered.forEach(m => {
        memberList.push({
          openid: m.user_id,
          nickName: m.nickname,
          avatar: m.avatar,
          role: m.role,
          roleText: getRoleName(m.role),
          preordered: false,
          dishes: [],
          remark: ''
        })
      })

      const preorderedCount = memberList.filter(m => m.preordered).length
      const dishCount = memberList.reduce((sum, m) => sum + m.dishes.length, 0)
      this.setData({
        memberList,
        stats: {
          total: memberList.length,
          preordered: preorderedCount,
          dishCount
        }
      })
    }).catch(() => {})
  },

  prevDate() {
    const d = new Date(this.data.selectedDate)
    d.setDate(d.getDate() - 1)
    const dateStr = formatDate(d)
    this.setData({
      selectedDate: dateStr,
      displayDate: formatDateWithWeek(d)
    })
    this.loadData()
  },

  nextDate() {
    const d = new Date(this.data.selectedDate)
    d.setDate(d.getDate() + 1)
    const dateStr = formatDate(d)
    this.setData({
      selectedDate: dateStr,
      displayDate: formatDateWithWeek(d)
    })
    this.loadData()
  },

  // 管理员取消某个预购
  onCancelPreorder(e) {
    const preorderId = e.currentTarget.dataset.id
    const dishName = e.currentTarget.dataset.name
    const memberName = e.currentTarget.dataset.member
    wx.showModal({
      title: '取消预购',
      content: `取消 ${memberName} 的「${dishName}」？`,
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '取消中...' })
          callFunction('preorder-add', { action: 'cancel_other', preorder_id: preorderId }).then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已取消', icon: 'success' })
            this.loadData()
          }).catch(() => {
            wx.hideLoading()
          })
        }
      }
    })
  },

  // 管理员编辑某个预购
  onEditPreorder(e) {
    const { preorderId, dishId, memberOpenid, note } = e.currentTarget.dataset
    const date = this.data.selectedDate
    wx.navigateTo({
      url: `/pages/preorder/preorder?editMode=true&preorderId=${preorderId}&dishId=${dishId}&date=${date}&note=${encodeURIComponent(note || '')}&forUser=${memberOpenid}`
    })
  },

  remindMember(e) {
    const name = e.currentTarget.dataset.name
    wx.showToast({ title: `已提醒 ${name} 去预定`, icon: 'none' })
  }
})
