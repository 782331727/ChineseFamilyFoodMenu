// pages/login/login.js
// 独立登录页：微信一键登录，获取头像和昵称
const { callFunction } = require('../../utils/api')

Page({
  data: {
    isLogin: false,
    loading: false,
    userInfo: {}
  },

  onLoad() {
    // 检查是否已登录
    const app = getApp()
    if (app.globalData.isLogin) {
      this.setData({
        isLogin: true,
        userInfo: app.globalData.userInfo || {}
      })
      this.goHome()
    }
  },

  // 微信一键登录（button open-type="getUserInfo" 回调）
  onWechatLogin(e) {
    const wxUser = e.detail && e.detail.userInfo
    if (!wxUser) {
      wx.showToast({ title: '需要授权才能登录', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    this.doLogin(wxUser)
  },

  // 执行登录
  doLogin(wxUser) {
    const info = { nickName: wxUser.nickName, avatarUrl: wxUser.avatarUrl }
    const app = getApp()

    // 更新本地数据
    app.globalData.userInfo = info
    app.globalData.isLogin = true
    wx.setStorageSync('userInfo', info)

    this.setData({ userInfo: info, isLogin: true })

    // 调用 login 云函数
    const loginData = { nickname: info.nickName }
    if (wxUser.avatarUrl && wxUser.avatarUrl.startsWith('https://')) {
      loginData.avatar = wxUser.avatarUrl
    }

    callFunction('login', loginData).then(res => {
      this.setData({ loading: false })
      if (res && res.user) {
        app.globalData.openid = res.user.openid || app.globalData.openid
        app.globalData.role = res.user.role || 'eater'
        app.globalData.familyId = res.user.family_id || ''
        wx.setStorageSync('openid', app.globalData.openid)
        wx.setStorageSync('role', app.globalData.role)
        wx.setStorageSync('familyId', app.globalData.familyId)
        if (res.family) {
          app.globalData.familyInfo = res.family
          wx.setStorageSync('familyInfo', res.family)
        }
      }
      wx.showToast({ title: '登录成功', icon: 'success', duration: 800 })
      this.goHome()
    }).catch(() => {
      this.setData({ loading: false })
      // 即使云函数失败，本地已有基本信息，仍然允许进入
      wx.showToast({ title: '登录成功', icon: 'success', duration: 800 })
      this.goHome()
    })
  },

  // 跳转到首页
  goHome() {
    setTimeout(() => {
      wx.switchTab({ url: '/pages/home/home' })
    }, 1000)
  }
})
