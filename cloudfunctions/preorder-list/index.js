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
        .where({ _id: _.in(dishIds), is_deleted: _.neq(true) })
        .get()
      dishesRes.data.forEach(d => { dishesMap[d._id] = d })
    }

    // 生成菜品图片临时链接（解决跨用户无法查看图片问题）
    const dishImageIDs = []
    Object.values(dishesMap).forEach(d => {
      if (d.image_url && d.image_url.startsWith('cloud://')) dishImageIDs.push(d.image_url)
      if (d.image && d.image.startsWith('cloud://')) dishImageIDs.push(d.image)
      if (d.image_urls && Array.isArray(d.image_urls)) {
        d.image_urls.forEach(url => { if (url && url.startsWith('cloud://')) dishImageIDs.push(url) })
      }
    })
    if (dishImageIDs.length > 0) {
      try {
        const tmpRes = await cloud.getTempFileURL({ fileList: [...new Set(dishImageIDs)] })
        const imgUrlMap = {}
        tmpRes.fileList.forEach(f => { if (f.tempFileURL) imgUrlMap[f.fileID] = f.tempFileURL })
        Object.values(dishesMap).forEach(d => {
          if (d.image_url && imgUrlMap[d.image_url]) d.image_url = imgUrlMap[d.image_url]
          if (d.image && imgUrlMap[d.image]) d.image = imgUrlMap[d.image]
          if (d.image_urls && Array.isArray(d.image_urls)) {
            d.image_urls = d.image_urls.map(url => imgUrlMap[url] || url)
          }
        })
      } catch (e) {
        console.warn('[preorder-list] dish image getTempFileURL failed:', e.message)
      }
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
      try {
        const tmpRes = await cloud.getTempFileURL({ fileList: [...new Set(allAvatars)] })
        const urlMap = {}
        tmpRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
        ;[...hasPreordered, ...notPreordered].forEach(m => {
          if (m.avatar && urlMap[m.avatar]) m.avatar = urlMap[m.avatar]
        })
      } catch (e) {
        console.warn('[preorder-list] getTempFileURL failed, continuing without temp URLs:', e.message)
      }
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
