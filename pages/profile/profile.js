// pages/profile/profile.js
const { callFunction, uploadImage } = require('../../utils/api')
const { getCurrentRole, getRoleName, ensureLogin, refreshRole } = require('../../utils/auth')

Page({
  data: {
    userInfo: {},
    isLogin: false,
    role: 'eater',
    roleText: '干饭人',
    taste: { spicy: 3, sweet: 3, sour: 3, salty: 3 },
    avoidList: [],
    avoidInput: '',
    stats: { dishCount: 0, cookCount: 0, preorderCount: 0 },
    // 昵称编辑
    showNickModal: false,
    editNick: ''
  },

  onLoad() { this.initUserInfo() },
  onShow() {
    refreshRole().then(() => this.initUserInfo())
    // 短期缓存：15秒内跳过
    const now = Date.now()
    if (this._lastFetch && now - this._lastFetch < 15000) return
    this._lastFetch = now
    this.loadProfile()
    this.loadStats()
  },

  initUserInfo() {
    const app = getApp()
    const role = getCurrentRole()
    const userInfo = app.globalData.userInfo || {}
    this.setData({
      userInfo: {
        nickName: userInfo.nickName || userInfo.nickname || '未登录',
        avatarUrl: userInfo.avatarUrl || userInfo.avatar || ''
      },
      isLogin: app.globalData.isLogin,
      role,
      roleText: getRoleName(role)
    })
  },

  // 微信一键登录：通过 button open-type="getUserInfo" 触发
  onGetUserInfo(e) {
    const wxUser = e.detail && e.detail.userInfo
    if (!wxUser) {
      // 用户拒绝授权，回退到 wx.getUserProfile（如果可用）
      this.handleLogin()
      return
    }
    this.saveUserInfoAndLogin(wxUser)
  },

  // 原登录方式（wx.getUserProfile 回退）
  handleLogin() {
    const app = getApp()
    // 尝试 wx.getUserProfile（部分新版基础库已不可用）
    if (wx.getUserProfile) {
      wx.getUserProfile({
        desc: '用于完善个人资料',
        success: res => {
          this.saveUserInfoAndLogin(res.userInfo)
        },
        fail: () => { wx.showToast({ title: '已取消', icon: 'none' }) }
      })
    } else {
      wx.showToast({ title: '请点击上方按钮授权', icon: 'none' })
    }
  },

  saveUserInfoAndLogin(wxUser) {
    const info = { nickName: wxUser.nickName, avatarUrl: wxUser.avatarUrl }
    this.setData({ userInfo: info, isLogin: true })

    // 更新全局与缓存
    const app = getApp()
    app.globalData.userInfo = info
    app.globalData.isLogin = true
    wx.setStorageSync('userInfo', info)

    // 上传头像到云存储（如果有头像）
    if (wxUser.avatarUrl && wxUser.avatarUrl.startsWith('https://')) {
      let loginData = { nickname: info.nickName, avatar: info.avatarUrl }
      callFunction('login', loginData).then(res => {
        if (res && res.user) {
          app.globalData.openid = res.user.openid || app.globalData.openid
          app.globalData.role = res.user.role || 'eater'
          app.globalData.familyId = res.user.family_id || ''
          wx.setStorageSync('openid', app.globalData.openid)
          wx.setStorageSync('role', app.globalData.role)
          wx.setStorageSync('familyId', app.globalData.familyId)
        }
        wx.showToast({ title: '登录成功', icon: 'success' })
        this.loadProfile()
        this.loadStats()
      }).catch(() => {})
    } else {
      // 纯文本昵称，直接更新
      callFunction('login', { nickname: info.nickName }).then(res => {
        if (res && res.user) {
          app.globalData.openid = res.user.openid || app.globalData.openid
          app.globalData.role = res.user.role || 'eater'
          wx.setStorageSync('openid', app.globalData.openid)
          wx.setStorageSync('role', app.globalData.role)
        }
        wx.showToast({ title: '登录成功', icon: 'success' })
        this.loadProfile()
        this.loadStats()
      }).catch(() => {})
    }
  },

  // === 编辑昵称 ===
  editNickname() {
    this.setData({ showNickModal: true, editNick: this.data.userInfo.nickName || '' })
  },
  closeNickModal() { this.setData({ showNickModal: false }) },
  onNickInput(e) { this.setData({ editNick: e.detail.value }) },
  saveNickname() {
    const name = (this.data.editNick || '').trim()
    if (!name) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
    const app = getApp()
    const userInfo = { ...this.data.userInfo, nickName: name }
    this.setData({ userInfo, showNickModal: false })
    app.globalData.userInfo = { ...app.globalData.userInfo, nickName: name }
    wx.setStorageSync('userInfo', app.globalData.userInfo)
    callFunction('profile-manage', { action: 'update_user_info', nickname: name }).catch(() => {})
  },

  // === 换头像 ===
  changeAvatar() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: res => {
        const tempPath = res.tempFiles[0].tempFilePath
        wx.compressImage({
          src: tempPath, quality: 80, compressedWidth: 400,
          success: compressRes => {
            wx.showLoading({ title: '上传中...' })
            uploadImage(compressRes.tempFilePath, 'avatars').then(fileID => {
              wx.hideLoading()
              const app = getApp()
              const userInfo = { ...this.data.userInfo, avatarUrl: fileID }
              this.setData({ userInfo })
              app.globalData.userInfo = { ...app.globalData.userInfo, avatarUrl: fileID }
              wx.setStorageSync('userInfo', app.globalData.userInfo)
              callFunction('profile-manage', {
                action: 'update_user_info',
                nickname: userInfo.nickName,
                avatar: fileID
              }).then(() => {
                wx.showToast({ title: '头像已更新', icon: 'success' })
              }).catch(() => {})
            }).catch(() => { wx.hideLoading() })
          },
          fail: () => { wx.showToast({ title: '图片处理失败', icon: 'none' }) }
        })
      }
    })
  },

  loadProfile() {
    callFunction('profile-manage', { action: 'get_profile' }).then(data => {
      if (!data) return
      this.setData({
        taste: data.taste || this.data.taste,
        avoidList: data.avoidList || [],
        role: data.role || this.data.role,
        roleText: getRoleName(data.role || this.data.role)
      })
    }).catch(() => {})
  },

  loadStats() {
    callFunction('profile-manage', { action: 'get_my_stats' }).then(data => {
      this.setData({ stats: data || { dishCount: 0, cookCount: 0, preorderCount: 0 } })
    }).catch(() => {})
  },

  onTasteChange(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['taste.' + key]: e.detail.value })
    if (this._tasteTimer) clearTimeout(this._tasteTimer)
    this._tasteTimer = setTimeout(() => {
      callFunction('profile-manage', { action: 'update_taste', taste: this.data.taste }).catch(() => {})
    }, 1000)
  },

  onAvoidInput(e) { this.setData({ avoidInput: e.detail.value }) },
  addAvoid() {
    const val = (this.data.avoidInput || '').trim()
    if (!val) return
    if (this.data.avoidList.includes(val)) { wx.showToast({ title: '已存在', icon: 'none' }); return }
    const list = this.data.avoidList.concat(val)
    this.setData({ avoidList: list, avoidInput: '' })
    callFunction('profile-manage', { action: 'update_avoid_list', avoidList: list }).catch(() => {})
  },
  removeAvoid(e) {
    const index = e.currentTarget.dataset.index
    const list = this.data.avoidList.filter((_, i) => i !== index)
    this.setData({ avoidList: list })
    callFunction('profile-manage', { action: 'update_avoid_list', avoidList: list }).catch(() => {})
  },

  goFamily() { wx.navigateTo({ url: '/pages/family/family' }) },
  goPreorderList() { wx.navigateTo({ url: '/pages/preorder-list/preorder-list' }) },
  goMyPreorders() { wx.navigateTo({ url: '/pages/my-preorders/my-preorders' }) },
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }) },
  showAbout() { wx.showModal({ title: '关于', content: '张姐的私房菜谱 v1.2.0\n家庭美食菜单管理小程序\n让做饭和吃饭都有条不紊\n\n由 DeepSeek AI 驱动智能推荐', showCancel: false }) }
})
