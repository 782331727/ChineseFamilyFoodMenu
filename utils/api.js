// utils/api.js — 云函数调用封装

/** 确保云环境已初始化（幂等，防御页面早于 app.onLaunch 调用 cloud API） */
let _cloudReady = false

function ensureCloudReady() {
  if (_cloudReady) return Promise.resolve()
  return new Promise((resolve) => {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      resolve() // 不阻塞，让后续调用报出原错误
      return
    }
    try {
      // 幂等：app.js 已调用过 init，这里重复调用无害
      wx.cloud.init({
        env: 'cloud1-d3gokqfm4ec276426',
        traceUser: true
      })
      _cloudReady = true
    } catch (_) {
      // 极少数环境下 init 可能同步抛异常，稍后重试一次
      setTimeout(() => {
        try {
          wx.cloud.init({
            env: 'cloud1-d3gokqfm4ec276426',
            traceUser: true
          })
        } catch (__) { /* 放弃，让后续调用暴露真实错误 */ }
        _cloudReady = true
      }, 100)
    }
    resolve()
  })
}

/**
 * 统一调用云函数
 * @param {string} name 云函数名
 * @param {object} data 请求数据
 * @returns {Promise<object>}
 */
function callFunction(name, data = {}) {
  return ensureCloudReady().then(() => new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success(res) {
        if (res.result && res.result.code === 0) {
          resolve(res.result.data)
        } else {
          const errMsg = (res.result && res.result.message) || '请求失败'
          // "您未加入任何家庭"是正常业务状态（新用户），不在每个页面弹 toast，
          // 由各页面自行处理空数据展示引导
          const isNoFamily = errMsg && errMsg.includes('未加入任何家庭')
          if (!isNoFamily) {
            wx.showToast({ title: errMsg, icon: 'none' })
          }
          console.warn(`[callFunction] ${name}:`, errMsg)
          reject(new Error(errMsg))
        }
      },
      fail(err) {
        // 透传真实错误信息，便于定位（如云函数未部署/环境不匹配）
        console.error(`[callFunction] ${name} 失败:`, err)
        const raw = (err && err.errMsg) || (err && err.message) || ''
        const detail = typeof raw === 'string' ? raw : '网络异常'
        // 微信 fail 的 errMsg 常很长，截取关键部分作为 toast
        const short = detail.length > 20
          ? detail.replace(/^cloud function execution error.*/, '云函数调用失败').slice(0, 20)
          : detail
        if (short) wx.showToast({ title: short, icon: 'none' })
        reject(err)
      }
    })
  }))
}

/**
 * 上传图片到云存储
 * @param {string} filePath 本地文件路径
 * @param {string} folder 云存储文件夹
 * @returns {Promise<string>} fileID
 */
function uploadImage(filePath, folder = 'dishes') {
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 10000)
  const cloudPath = folder + '/' + timestamp + '_' + random + '.jpg'
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success(res) {
        resolve(res.fileID)
      },
      fail(err) {
        wx.showToast({ title: '上传失败', icon: 'none' })
        reject(err)
      }
    })
  })
}

/**
 * 批量上传图片
 * @param {string[]} filePaths 本地文件路径数组
 * @param {string} folder 云存储文件夹
 * @returns {Promise<string[]>} fileID 数组
 */
function uploadImages(filePaths, folder = 'dishes') {
  return Promise.all(filePaths.map(fp => uploadImage(fp, folder)))
}

/**
 * 移除云存储文件
 * @param {string[]} fileIDs
 * @returns {Promise}
 */
function removeFiles(fileIDs) {
  return new Promise((resolve, reject) => {
    wx.cloud.removeFile({
      fileList: fileIDs,
      success(res) {
        resolve(res)
      },
      fail(err) {
        reject(err)
      }
    })
  })
}

/**
 * 获取数据库实例
 */
function getDB() {
  return wx.cloud.database()
}

/**
 * 获取当前用户的 openid
 * @returns {Promise<string>}
 */
function getOpenid() {
  return new Promise((resolve, reject) => {
    const cached = wx.getStorageSync('openid')
    if (cached) {
      resolve(cached)
      return
    }
    wx.cloud.callFunction({
      name: 'login',
      success(res) {
        const openid = res.result && res.result.openid
        if (openid) {
          wx.setStorageSync('openid', openid)
          resolve(openid)
        } else {
          reject(new Error('获取 openid 失败'))
        }
      },
      fail(err) {
        reject(err)
      }
    })
  })
}

module.exports = {
  callFunction,
  uploadImage,
  uploadImages,
  removeFiles,
  getDB,
  getOpenid
}
