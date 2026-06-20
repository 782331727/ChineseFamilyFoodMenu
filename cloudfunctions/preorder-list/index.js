// 云函数：preorder-list
// 查询某天的全家预定列表，按成员分组，返回未预定成员
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { target_date } = event

  if (!target_date) {
    return { code: -1, message: '请选择查询日期', data: null }
  }

  try {
    // 查询调用者
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在，请先登录', data: null }
    }
    const user = userRes.data[0]

    if (!user.family_id) {
      return { code: -1, message: '您未加入任何家庭', data: null }
    }

    const familyId = user.family_id

    // 查询该天全家预定
    const preorderRes = await db.collection('preorders')
      .where({ family_id: familyId, target_date })
      .orderBy('created_at', 'asc')
      .get()

    // 查询家庭成员
    const membersRes = await db.collection('users').where({ family_id: familyId }).get()
    const members = membersRes.data

    // 查询相关菜品信息
    const dishIds = [...new Set(preorderRes.data.map(p => p.dish_id))]
    let dishesMap = {}
    if (dishIds.length > 0) {
      const dishesRes = await db.collection('dishes')
        .where({ _id: _.in(dishIds) })
        .get()
      dishesRes.data.forEach(d => { dishesMap[d._id] = d })
    }

    // 按成员分组
    const memberMap = {}
    members.forEach(m => {
      memberMap[m._id] = {
        user_id: m._id,
        nickname: m.nickname,
        avatar: m.avatar,
        role: m.role,
        preorders: []
      }
    })

    preorderRes.data.forEach(p => {
      if (memberMap[p.user_id]) {
        memberMap[p.user_id].preorders.push({
          ...p,
          dish_info: dishesMap[p.dish_id] || null
        })
      }
    })

    // 区分已预定和未预定成员
    const grouped = Object.values(memberMap)
    const hasPreordered = grouped.filter(m => m.preorders.length > 0)
    const notPreordered = grouped.filter(m => m.preorders.length === 0).map(m => ({
      user_id: m.user_id,
      nickname: m.nickname,
      avatar: m.avatar,
      role: m.role
    }))

    // 生成头像临时链接
    const allAvatars = [...hasPreordered, ...notPreordered].map(m => m.avatar).filter(a => a && a.startsWith('cloud://'))
    if (allAvatars.length > 0) {
      const tmpRes = await cloud.getTempFileURL({ fileList: allAvatars })
      const urlMap = {}
      tmpRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      ;[...hasPreordered, ...notPreordered].forEach(m => {
        if (m.avatar && urlMap[m.avatar]) m.avatar = urlMap[m.avatar]
      })
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        date: target_date,
        total_members: members.length,
        preordered_count: hasPreordered.length,
        not_preordered_count: notPreordered.length,
        preordered: hasPreordered,
        not_preordered: notPreordered
      }
    }
  } catch (err) {
    console.error('[preorder-list] error:', err)
    return { code: -1, message: err.message || '查询预定失败', data: null }
  }
}
