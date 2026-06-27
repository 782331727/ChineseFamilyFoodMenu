// pages/family/family.js
const { callFunction } = require('../../utils/api')
const { hasRoleLevel, getRoleName } = require('../../utils/auth')
const { mapUser, mapFamily } = require('../../utils/mapper')

Page({
  data: {
    hasFamily: false,
    familyInfo: {},
    memberList: [],
    canManage: false,
    isAdmin: false,
    // 创建/加入家庭表单
    activePanel: '',
    createName: '',
    joinCode: '',
    submitting: false,
    // 编辑家庭名称
    showNameModal: false,
    editName: ''
  },

  onLoad(options) {
    this.setData({
      canManage: hasRoleLevel('admin'),
      isAdmin: hasRoleLevel('admin')
    })
    if (options.panel === 'join') {
      this.setData({ activePanel: 'join' })
    }
  },

  onShow() {
    this.loadFamilyInfo()
  },

  // 判断当前用户是否已加入家庭
  loadFamilyInfo() {
    const app = getApp()
    const familyId = app.globalData.familyId

    // 宾客或已退出：不调云端，保持游客态
    if (!app.globalData.isLogin || wx.getStorageSync('_loggedOut')) {
      this.setData({ hasFamily: false })
      return
    }

    if (familyId) {
      this.setData({ hasFamily: true, canManage: hasRoleLevel('admin'), isAdmin: hasRoleLevel('admin') })
      this.loadMembersAndFamily(familyId)
      return
    }

    // 已登录但缺缓存的家庭ID，从云端恢复
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        const result = res.result
        if (result && result.code === 0 && result.data && result.data.user) {
          const user = result.data.user
          const fid = user.family_id || ''
          app.globalData.familyId = fid
          app.globalData.role = user.role || 'eater'
          wx.setStorageSync('familyId', fid)
          wx.setStorageSync('role', user.role || 'eater')

          if (fid) {
            this.setData({ hasFamily: true, canManage: hasRoleLevel('admin'), isAdmin: hasRoleLevel('admin') })
            this.loadMembersAndFamily(fid)
          } else {
            this.setData({ hasFamily: false })
          }
        } else {
          this.setData({ hasFamily: false })
        }
      },
      fail: () => {
        this.setData({ hasFamily: false })
      }
    })
  },

  // 已加入家庭：加载成员列表和家庭详情
  loadMembersAndFamily(familyId) {
    callFunction('family-update', { action: 'get_members' }).then(data => {
      const members = (data && data.members) || data || []
      const familyData = (data && data.family) || null
      const app = getApp()
      const myOpenid = app.globalData.openid
      const localUser = app.globalData.userInfo || {}
      const memberList = (members || []).map(m => {
        const mapped = mapUser(m) || {}
        const isMe = mapped.openid === myOpenid
        // 对于自己，优先使用本地缓存的昵称和头像（与「我的」页面保持一致）
        if (isMe && localUser.nickName) {
          mapped.nickName = localUser.nickName
        }
        if (isMe && localUser.avatarUrl) {
          mapped.avatarUrl = localUser.avatarUrl
        }
        return {
          ...mapped,
          roleText: getRoleName(mapped.role),
          isMe
        }
      })
      this.setData({ memberList })

      // 家庭信息（含 invite_code）从云函数直接获取
      if (familyData) {
        const info = mapFamily(familyData) || {}
        app.globalData.familyInfo = info
        wx.setStorageSync('familyInfo', info)
        this.setData({ familyInfo: info })
      }
    }).catch(() => {
      this.setData({ memberList: [] })
    })
  },

  // === 创建/加入家庭 表单交互 ===
  showCreatePanel() {
    this.setData({ activePanel: 'create', createName: '', joinCode: '' })
  },

  showJoinPanel() {
    this.setData({ activePanel: 'join', createName: '', joinCode: '' })
  },

  cancelPanel() {
    this.setData({ activePanel: '' })
  },

  onCreateNameInput(e) {
    this.setData({ createName: e.detail.value })
  },

  onJoinCodeInput(e) {
    this.setData({ joinCode: e.detail.value })
  },

  // 创建家庭
  // family-create 云函数：{ name } -> { data: { _id, name, invite_code } }
  // 创建者自动成为 admin
  createFamily() {
    const name = (this.data.createName || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入家庭名称', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })

    callFunction('family-create', { name }).then(data => {
      const app = getApp()
      const familyId = data && data._id
      const familyInfo = mapFamily(data) || { name, _id: familyId, inviteCode: (data && data.invite_code) || '' }
      app.globalData.familyId = familyId
      app.globalData.role = 'admin'
      app.globalData.familyInfo = familyInfo
      wx.setStorageSync('familyId', familyId)
      wx.setStorageSync('role', 'admin')
      wx.setStorageSync('familyInfo', familyInfo)

      wx.showToast({ title: '创建成功', icon: 'success' })
      this.setData({
        submitting: false, hasFamily: true, activePanel: '',
        canManage: true, isAdmin: true,
        familyInfo: mapFamily(data) || { name }
      })
      this.loadMembersAndFamily(familyId)
    }).catch(() => {
      this.setData({ submitting: false })
    })
  },

  // 加入家庭
  // family-join 云函数：{ invite_code, role? } -> { data: { family, role } }
  joinFamily() {
    const code = (this.data.joinCode || '').trim().toUpperCase()
    if (!code) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })

    callFunction('family-join', { invite_code: code }).then(data => {
      const app = getApp()
      const family = data && data.family
      const familyId = family && family._id
      const role = (data && data.role) || 'eater'
      const familyInfo = mapFamily(family) || {}
      app.globalData.familyId = familyId
      app.globalData.role = role
      app.globalData.familyInfo = familyInfo
      wx.setStorageSync('familyId', familyId)
      wx.setStorageSync('role', role)
      wx.setStorageSync('familyInfo', familyInfo)

      wx.showToast({ title: '加入成功', icon: 'success' })
      this.setData({
        submitting: false,
        hasFamily: true,
        activePanel: '',
        canManage: hasRoleLevel('admin'),
        familyInfo: mapFamily(family) || {}
      })
      this.loadMembersAndFamily(familyId)
    }).catch(() => {
      this.setData({ submitting: false })
    })
  },

  copyInviteCode() {
    wx.setClipboardData({
      data: this.data.familyInfo.inviteCode || '',
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' })
      }
    })
  },

  showQRCode() {
    if (this.data.familyInfo.inviteCode) {
      wx.previewImage({
        urls: ['https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + this.data.familyInfo.inviteCode]
      })
    } else {
      wx.showToast({ title: '暂无邀请码', icon: 'none' })
    }
  },

  // role picker：调用 family-update action:'update_member_role'
  // 云函数需要 member_id（即 users 表的 _id）和 member_role
  showRolePicker(e) {
    const openid = e.currentTarget.dataset.openid
    const currentRole = e.currentTarget.dataset.role

    // 从 memberList 找到对应的 _id（云函数需要的是 user._id 而非 openid）
    const member = this.data.memberList.find(m => m.openid === openid)
    const memberId = member ? member._id : ''

    wx.showActionSheet({
      itemList: ['家长', '大厨', '干饭人', '祖国的花朵'],
      success: res => {
        const roles = ['admin', 'cook', 'eater', 'child']
        const newRole = roles[res.tapIndex]
        if (newRole === currentRole) return

        callFunction('family-update', {
          action: 'update_member_role',
          member_id: memberId,
          member_role: newRole
        }).then(() => {
          wx.showToast({ title: '已更新角色', icon: 'success' })
          const fid = getApp().globalData.familyId
          if (fid) this.loadMembersAndFamily(fid)
        }).catch(() => {})
      }
    })
  },

  // === 编辑家庭名称 ===
  editFamilyName() {
    this.setData({ showNameModal: true, editName: this.data.familyInfo.name || '' })
  },
  closeNameModal() { this.setData({ showNameModal: false }) },
  onNameInput(e) { this.setData({ editName: e.detail.value }) },
  saveFamilyName() {
    const name = (this.data.editName || '').trim()
    if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return }
    callFunction('family-update', { action: 'update_family', family_name: name }).then(() => {
      const info = { ...this.data.familyInfo, name }
      this.setData({ familyInfo: info, showNameModal: false })
      const app = getApp()
      app.globalData.familyInfo = { ...app.globalData.familyInfo, name }
      wx.setStorageSync('familyInfo', app.globalData.familyInfo)
      wx.showToast({ title: '已更新', icon: 'success' })
    }).catch(() => {})
  },

  // 头像加载失败时回退到默认头像
  onAvatarError(e) {
    const index = e.currentTarget.dataset.index
    if (index !== undefined && this.data.memberList[index]) {
      this.setData({ [`memberList[${index}].avatarUrl`]: '' })
    }
  }
})
