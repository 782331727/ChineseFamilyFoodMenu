// app.js - 全局逻辑
App({
  globalData: {
    userInfo: null,
    familyInfo: null,
    role: 'eater', // admin / cook / eater / child
    familyId: '',
    openid: '',
    isLogin: false
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloud1-d3gokqfm4ec276426',
      traceUser: true
    })

    // 检查登录状态
    this.checkLoginStatus()
  },

  // 检查登录状态
  checkLoginStatus() {
    const userInfo = wx.getStorageSync('userInfo')
    const openid = wx.getStorageSync('openid')
    if (userInfo && openid) {
      this.globalData.userInfo = userInfo
      this.globalData.openid = openid
      this.globalData.isLogin = true
      this.globalData.role = wx.getStorageSync('role') || 'eater'
      this.globalData.familyId = wx.getStorageSync('familyId') || ''
      this.globalData.familyInfo = wx.getStorageSync('familyInfo') || null
    } else {
      this.autoLogin()
    }
  },

  // 自动登录
  // login 云函数返回 { code, message, data: { user, family } }
  autoLogin() {
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        const result = res.result
        if (!result || result.code !== 0 || !result.data) {
          console.error('登录失败', result && result.message)
          return
        }
        const { user, family } = result.data
        if (!user || !user.openid) return

        const userInfo = {
          _id: user._id,
          openid: user.openid,
          nickName: user.nickname || '微信用户',
          avatarUrl: user.avatar || ''
        }
        const role = user.role || 'eater'
        const familyId = user.family_id || (family && family._id) || ''

        this.globalData.openid = user.openid
        this.globalData.userInfo = userInfo
        this.globalData.role = role
        this.globalData.familyId = familyId
        this.globalData.familyInfo = family || null
        this.globalData.isLogin = true

        wx.setStorageSync('openid', user.openid)
        wx.setStorageSync('userInfo', userInfo)
        wx.setStorageSync('role', role)
        wx.setStorageSync('familyId', familyId)
        if (family) wx.setStorageSync('familyInfo', family)
      },
      fail: err => {
        console.error('登录失败', err)
      }
    })
  },

  // 获取用户信息 — 已改用 profile 页手动编辑，此方法保留兜底
  getUserProfile() {
    return new Promise((resolve) => {
      // wx.getUserProfile 在小程序基础库 2.27+ 已回收，返回默认头像和昵称
      // 用户可在"我的"页面手动修改昵称和头像
      if (wx.getUserProfile) {
        wx.getUserProfile({
          desc: '用于完善个人资料',
          success: res => resolve(res.userInfo),
          fail: () => resolve({ nickName: '微信用户', avatarUrl: '' })
        })
      } else {
        resolve({ nickName: '微信用户', avatarUrl: '' })
      }
    })
  },

  // 更新全局角色
  setRole(role) {
    this.globalData.role = role
    wx.setStorageSync('role', role)
  },

  // 更新家庭ID
  setFamilyId(familyId) {
    this.globalData.familyId = familyId
    wx.setStorageSync('familyId', familyId)
  }
})
