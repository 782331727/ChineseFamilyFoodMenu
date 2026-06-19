// 云函数：family-create
// 创建家庭，生成6位邀请码，设置创建者为 admin 角色
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 生成6位邀请码（大写字母+数字）
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { name } = event

  if (!name) {
    return { code: -1, message: '家庭名称不能为空', data: null }
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

    // 生成唯一邀请码
    let inviteCode = generateInviteCode()
    let codeExists = true
    let attempts = 0
    while (codeExists && attempts < 10) {
      const existing = await db.collection('families').where({ invite_code: inviteCode }).count()
      if (existing.total === 0) {
        codeExists = false
      } else {
        inviteCode = generateInviteCode()
        attempts++
      }
    }

    // 创建家庭
    const familyData = {
      name,
      invite_code: inviteCode,
      creator_id: user._id,
      created_at: new Date()
    }
    const familyRes = await db.collection('families').add({ data: familyData })

    // 更新用户角色为 admin 并绑定家庭
    await db.collection('users').doc(user._id).update({
      data: {
        family_id: familyRes._id,
        role: 'admin'
      }
    })

    return {
      code: 0,
      message: '家庭创建成功',
      data: {
        _id: familyRes._id,
        ...familyData,
        invite_code: inviteCode
      }
    }
  } catch (err) {
    console.error('[family-create] error:', err)
    return { code: -1, message: err.message || '创建家庭失败', data: null }
  }
}
