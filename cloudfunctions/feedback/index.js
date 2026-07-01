// 云函数：feedback
// 收集用户意见反馈，存储到 feedback 集合
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { content } = event

  if (!content || !content.trim()) {
    return { code: -1, message: '反馈内容不能为空', data: null }
  }

  const text = content.trim()

  try {
    // 内容安全检测 v2.0
    const check = await cloud.openapi.security.msgSecCheck({
      openid: OPENID,
      scene: 2,
      version: 2,
      content: text
    })
    // 先检查 API 是否返回了错误码
    if (check.errCode && check.errCode !== 0) {
      console.error('[feedback] msgSecCheck 返回错误:', check.errCode, check.errMsg)
      return { code: -1, message: '内容安全检测未通过，请修改后重试', data: null }
    }
    const passed = check.result && check.result.suggest === 'pass'
    if (!passed) {
      return { code: -1, message: '反馈内容违规，请修改后提交', data: null }
    }
  } catch (e) {
    // 区分 API 异常类型：权限未配置/openid 无效 vs 其他（可能是内容触发）
    const errCode = e.errCode || 0
    console.error('[feedback] msgSecCheck 失败:', errCode, e.message || e.errMsg)
    if (errCode === -604101) {
      return { code: -1, message: '安全检测服务未配置，请联系管理员', data: null }
    }
    if (errCode === 40003) {
      return { code: -1, message: '登录态已过期，请重新进入小程序后重试', data: null }
    }
    // 未知错误，安全优先 —— 仍然拒绝，但给出更明确提示
    return { code: -1, message: '内容安全检测未通过，请修改后重试', data: null }
  }

  try {
    // 查询用户昵称
    let nickname = '匿名用户'
    try {
      const userRes = await db.collection('users').where({ openid: OPENID }).get()
      if (userRes.data.length > 0 && userRes.data[0].nickname) {
        nickname = userRes.data[0].nickname
      }
    } catch (_) { /* 查不到用户就用匿名 */ }

    const res = await db.collection('feedback').add({
      data: {
        openid: OPENID,
        content: text,
        nickname,
        created_at: new Date()
      }
    })

    return {
      code: 0,
      message: '感谢您的反馈！',
      data: { _id: res._id }
    }
  } catch (err) {
    console.error('[feedback] DB error:', err)
    return { code: -1, message: '提交失败，请稍后重试', data: null }
  }
}
