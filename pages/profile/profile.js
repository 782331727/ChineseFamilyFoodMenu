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
    // 短期缓存：8秒内跳过
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

  handleLogin() {
    const app = getApp()
    app.getUserProfile().then(wxUser => {
      const info = { nickName: wxUser.nickName, avatarUrl: wxUser.avatarUrl }
      this.setData({ userInfo: info, isLogin: true })
      callFunction('profile-manage', {
        action: 'update_user_info',
        nickname: info.nickName,
        avatar: info.avatarUrl
      }).then(() => this.loadProfile()).catch(() => {})
    }).catch(() => { wx.showToast({ title: '已取消', icon: 'none' }) })
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
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }) },
  showAbout() { wx.showModal({ title: '关于', content: '张姐的私房菜谱\n\n家庭美食菜单管理小程序\n让做饭和吃饭都有条不紊\n\n由 DeepSeek AI 驱动智能推荐', showCancel: false }) }
})