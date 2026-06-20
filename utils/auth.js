// utils/auth.js — 登录鉴权 + 角色权限检查

const { callFunction, getOpenid } = require('./api')

// 角色等级
const ROLE_LEVELS = {
  admin: 4,   // 家长 — 全部权限
  cook: 3,    // 大厨 — 菜品管理、菜单安排、采购清单
  eater: 2,   // 干饭人 — 预定、查看
  child: 1    // 祖国的花朵 — 仅查看、预定
}

// 角色中文名
const ROLE_NAMES = {
  admin: '家长',
  cook: '大厨',
  eater: '干饭人',
  child: '祖国的花朵'
}

// 各角色权限
const PERMISSIONS = {
  admin: ['manage_family', 'manage_dishes', 'manage_menu', 'manage_shopping', 'preorder', 'view_all'],
  cook: ['manage_dishes', 'manage_menu', 'manage_shopping', 'preorder', 'view_all'],
  eater: ['preorder', 'view_all'],
  child: ['preorder', 'view_all']
}

/**
 * 获取当前用户角色
 * @returns {string}
 */
function getCurrentRole() {
  const app = getApp()
  return app.globalData.role || wx.getStorageSync('role') || 'eater'
}

/**
 * 检查是否有权限
 * @param {string} permission 权限名
 * @returns {boolean}
 */
function hasPermission(permission) {
  const role = getCurrentRole()
  const perms = PERMISSIONS[role] || []
  return perms.includes(permission)
}

/**
 * 检查是否至少是某个角色级别
 * @param {string} requiredRole
 * @returns {boolean}
 */
function hasRoleLevel(requiredRole) {
  const role = getCurrentRole()
  return (ROLE_LEVELS[role] || 0) >= (ROLE_LEVELS[requiredRole] || 0)
}

/**
 * 需要权限 — 不通过则提示并返回 false
 * @param {string} permission
 * @returns {boolean}
 */
function requirePermission(permission) {
  if (hasPermission(permission)) return true
  wx.showToast({ title: '无操作权限', icon: 'none' })
  return false
}

/**
 * 需要角色级别 — 不通过则提示并返回 false
 * @param {string} requiredRole
 * @returns {boolean}
 */
function requireRoleLevel(requiredRole) {
  if (hasRoleLevel(requiredRole)) return true
  wx.showToast({ title: `需要${ROLE_NAMES[requiredRole]}及以上权限`, icon: 'none' })
  return false
}

// 防抖：避免多个 onShow 同时调 refreshRole
let _refreshPromise = null

/**
 * 从云端拉取最新角色，恢复完整登录态
 * 用于 onShow 静默刷新，解决：
 * 1. 角色被管理员修改后本地缓存不更新
 * 2. 清除缓存后各页面登录态不一致
 * @returns {Promise<string>} 返回最新角色
 */
function refreshRole() {
  if (_refreshPromise) return _refreshPromise
  const app = getApp()
  _refreshPromise = callFunction('profile-manage', { action: 'get_profile' }).then(data => {
    if (!data) return getCurrentRole()
    const newRole = data.role || 'eater'
    // 恢复完整登录态
    app.globalData.role = newRole
    app.globalData.openid = data.openid || app.globalData.openid
    app.globalData.familyId = data.family_id || ''
    app.globalData.isLogin = true
    wx.setStorageSync('role', newRole)
    wx.setStorageSync('openid', app.globalData.openid)
    wx.setStorageSync('familyId', app.globalData.familyId)
    // 恢复用户信息（如果本地没有）
    if (!app.globalData.userInfo && data.nickname) {
      const userInfo = {
        _id: data._id,
        nickName: data.nickname,
        avatarUrl: data.avatar || ''
      }
      app.globalData.userInfo = userInfo
      wx.setStorageSync('userInfo', userInfo)
    }
    return newRole
  }).catch(() => {
    return getCurrentRole()
  }).finally(() => {
    _refreshPromise = null
  })
  return _refreshPromise
}

/**
 * 确保已登录
 * @returns {Promise<boolean>}
 */
function ensureLogin() {
  const app = getApp()
  if (app.globalData.isLogin) return Promise.resolve(true)

  return getOpenid().then(openid => {
    app.globalData.openid = openid
    app.globalData.isLogin = true
    return true
  }).catch(() => {
    wx.showToast({ title: '请先登录', icon: 'none' })
    return false
  })
}

/**
 * 获取角色中文名
 * @param {string} role
 * @returns {string}
 */
function getRoleName(role) {
  return ROLE_NAMES[role] || '未知'
}

module.exports = {
  ROLE_LEVELS,
  ROLE_NAMES,
  PERMISSIONS,
  getCurrentRole,
  hasPermission,
  hasRoleLevel,
  requirePermission,
  requireRoleLevel,
  ensureLogin,
  refreshRole,
  getRoleName
}
