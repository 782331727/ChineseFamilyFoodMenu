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
    editNick: '',
    // 宾客登录表单
    loginForm: { nickName: '', avatarUrl: '' }
  },

  onLoad() { this.initUserInfo() },
  onShow() {
    refreshRole().then(() => this.initUserInfo())
    // 宾客模式不加载云端数据
    if (!getApp().globalData.isLogin) return
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

  // === 宾客登录（新版：chooseAvatar + type="nickname"） ===
  onChooseAvatar(e) {
    this.setData({ 'loginForm.avatarUrl': e.detail.avatarUrl })
  },
  onLoginNickInput(e) {
    this.setData({ 'loginForm.nickName': e.detail.value })
  },
  onLoginNickBlur(e) {
    // 微信昵称输入框 blur 时可能带 nickname 值
    if (e.detail.value) this.setData({ 'loginForm.nickName': e.detail.value })
  },

  doGuestLogin() {
    const { nickName, avatarUrl } = this.data.loginForm
    const actualNick = (nickName || '').trim()

    // 头像需要先上传到云存储（chooseAvatar 返回的是临时 URL）
    if (avatarUrl && !avatarUrl.startsWith('cloud://')) {
      wx.showLoading({ title: '上传头像...', mask: true })
      uploadImage(avatarUrl, 'avatars').then(cloudFileID => {
        wx.hideLoading()
        this.saveUserInfoAndLogin({ nickName: actualNick, avatarUrl: cloudFileID })
      }).catch(() => {
        wx.hideLoading()
        this.saveUserInfoAndLogin({ nickName: actualNick, avatarUrl: '' })
      })
    } else {
      this.saveUserInfoAndLogin({ nickName: actualNick, avatarUrl: avatarUrl || '' })
    }
  },

  saveUserInfoAndLogin(wxUser) {
    const info = { nickName: wxUser.nickName, avatarUrl: wxUser.avatarUrl }
    this.setData({ userInfo: info, isLogin: true, loginForm: { nickName: '', avatarUrl: '' } })

    const app = getApp()
    app.globalData.userInfo = info
    app.globalData.isLogin = true
    wx.removeStorageSync('_loggedOut')
    wx.setStorageSync('userInfo', info)

    // 仅当用户明确输入了昵称（非空且非默认）才传给云端更新
    const loginData = {}
    if (info.nickName && info.nickName !== '微信用户') {
      loginData.nickname = info.nickName
    }
    // 仅当头像已是 cloud:// 格式（已上传云存储）才传入
    if (info.avatarUrl && info.avatarUrl.startsWith('cloud://')) {
      loginData.avatar = info.avatarUrl
    }

    callFunction('login', loginData).then(res => {
      if (res && res.user) {
        app.globalData.openid = res.user.openid || app.globalData.openid
        app.globalData.role = res.user.role || 'eater'
        app.globalData.familyId = res.user.family_id || ''
        wx.setStorageSync('openid', app.globalData.openid)
        wx.setStorageSync('role', app.globalData.role)
        wx.setStorageSync('familyId', app.globalData.familyId)
        // 云端是权威数据源，始终从云端恢复
        const cloudNick = res.user.nickname && res.user.nickname !== '微信用户'
          ? res.user.nickname
          : info.nickName
        const cloudAvatar = res.user.avatar || info.avatarUrl
        const restored = { nickName: cloudNick, avatarUrl: cloudAvatar }
        this.setData({ userInfo: restored })
        app.globalData.userInfo = restored
        wx.setStorageSync('userInfo', restored)
      }
      wx.showToast({ title: '登录成功', icon: 'success' })
      this.loadProfile()
      this.loadStats()
    }).catch(() => {})
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
  goAdmin() {
    const app = getApp()
    if (!app.globalData.isLogin || wx.getStorageSync('_loggedOut')) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/admin/admin' })
  },
  showAbout() { wx.showModal({ title: '关于', content: '张姐的私房菜谱 v1.2.3\n家庭美食菜单管理小程序\n让做饭和吃饭都有条不紊\n\n由 DeepSeek AI 驱动智能推荐', showCancel: false }) },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后将进入游客模式，可重新登录恢复数据。',
      success: res => {
        if (!res.confirm) return
        const app = getApp()
        wx.setStorageSync('_loggedOut', true)
        ;['openid','role','userInfo','familyId','familyInfo'].forEach(k => {
          app.globalData[k] = k === 'role' ? 'eater' : null
          wx.removeStorageSync(k)
        })
        app.globalData.isLogin = false
        wx.reLaunch({ url: '/pages/home/home' })
      }
    })
  }
})
