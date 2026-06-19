// pages/preorder-list/preorder-list.js
const { callFunction } = require('../../utils/api')
const { formatDate, formatDateWithWeek, getTomorrowStr } = require('../../utils/date')
const { getRoleName } = require('../../utils/auth')
const { mapDish } = require('../../utils/mapper')

Page({
  data: {
    selectedDate: '',
    displayDate: '',
    memberList: [],
    stats: {
      total: 0,
      preordered: 0,
      dishCount: 0
    }
  },

  onLoad() {
    const tomorrow = getTomorrowStr()
    this.setData({
      selectedDate: tomorrow,
      displayDate: formatDateWithWeek(tomorrow)
    })
    this.loadData()
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
        const dishes = (m.preorders || []).map(p => mapDish(p.dish_info) || { name: '未知菜品' })
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

  // remindPreorder 云函数不存在，改为客户端本地提示
  remindMember(e) {
    const name = e.currentTarget.dataset.name
    wx.showToast({ title: `已提醒 ${name} 去预定`, icon: 'none' })
  }
})
