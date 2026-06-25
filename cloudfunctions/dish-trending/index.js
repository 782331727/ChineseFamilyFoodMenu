// 云函数：dish-trending
// 常点排行 — 综合近90天预定次数 + 近期趋势，返回 Top 5
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0 || !userRes.data[0].family_id) {
      return { code: -1, message: '请先加入家庭', data: null }
    }
    const familyId = userRes.data[0].family_id

    const now = new Date()
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const ninetyDaysStr = ninetyDaysAgo.toISOString().split('T')[0]
    const sevenDaysStr = sevenDaysAgo.toISOString().split('T')[0]

    const preorderRes = await db.collection('preorders')
      .where({ family_id: familyId, target_date: _.gte(ninetyDaysStr) })
      .get()

    if (preorderRes.data.length === 0) {
      return { code: 0, message: 'ok', data: { list: [], meta: { total90: 0, recent7: 0 } } }
    }

    // 统计：近90天总数 + 近7天
    const stats = {}
    preorderRes.data.forEach(p => {
      if (!stats[p.dish_id]) stats[p.dish_id] = { total90: 0, recent7: 0 }
      stats[p.dish_id].total90++
      if (p.target_date >= sevenDaysStr) stats[p.dish_id].recent7++
    })

    // 得分 = total90 + recent7 × 3
    const scored = Object.entries(stats)
      .map(([dishId, s]) => ({
        dish_id: dishId,
        score: s.total90 + s.recent7 * 3,
        count90: s.total90,
        count7: s.recent7
      }))
      .sort((a, b) => b.score - a.score)

    const top5 = scored.slice(0, 5)

    const dishesRes = await db.collection('dishes')
      .where({ _id: _.in(top5.map(s => s.dish_id)), is_deleted: _.neq(true) })
      .get()
    const dishMap = {}
    dishesRes.data.forEach(d => { dishMap[d._id] = d })

    const list = top5
      .filter(s => dishMap[s.dish_id])  // 排除已删除/不存在的菜品
      .map(s => ({
        ...dishMap[s.dish_id],
        count90: s.count90,
        count7: s.count7,
        trend: s.count7 >= s.count90 * 0.5 ? '🔥上升' : s.count7 > 0 ? '📈稳定' : '📊经典'
      }))

    // 生成临时图片链接
    const imgIDs = list.map(d => d.image_url).filter(u => u && u.startsWith('cloud://'))
    if (imgIDs.length > 0) {
      try {
        const tmpRes = await cloud.getTempFileURL({ fileList: [...new Set(imgIDs)] })
        const urlMap = {}
        tmpRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
        list.forEach(d => {
          if (d.image_url && urlMap[d.image_url]) d.image_url = urlMap[d.image_url]
        })
      } catch (e) {
        console.warn('[dish-trending] getTempFileURL failed, continuing without temp URLs:', e.message)
      }
    }

    return {
      code: 0, message: 'ok',
      data: { list, meta: { total90: preorderRes.data.length, recent7: preorderRes.data.filter(p => p.target_date >= sevenDaysStr).length } }
    }
  } catch (err) {
    console.error('[dish-trending] error:', err)
    return { code: -1, message: err.message || '查询失败', data: null }
  }
}
