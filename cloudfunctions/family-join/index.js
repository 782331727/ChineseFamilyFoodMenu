// 云函数：family-join
// 通过邀请码加入家庭，默认 eater 角色
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { invite_code, role } = event

  if (!invite_code) {
    return { code: -1, message: '邀请码不能为空', data: null }
  }

  try {
    // 查询用户
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在，请先登录', data: null }
    }
    const user = userRes.data[0]

    if (user.family_id) {
      return { code: -1, message: '您已加入一个家庭，请先退出', data: null }
    }

    // 通过邀请码查询家庭
    const familyRes = await db.collection('families').where({
      invite_code: invite_code.toUpperCase()
    }).get()

    if (familyRes.data.length === 0) {
      return { code: -1, message: '邀请码无效，请检查后重试', data: null }
    }

    const family = familyRes.data[0]

    // 更新用户：绑定家庭，设置角色
    const assignRole = role || 'eater'
    await db.collection('users').doc(user._id).update({
      data: {
        family_id: family._id,
        role: assignRole
      }
    })

    return {
      code: 0,
      message: '加入家庭成功',
      data: {
        family,
        role: assignRole
      }
    }
  } catch (err) {
    console.error('[family-join] error:', err)
    return { code: -1, message: err.message || '加入家庭失败', data: null }
  }
}
