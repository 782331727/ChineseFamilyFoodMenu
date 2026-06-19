// 云函数：dish-detail
// 查询菜品详情
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { dish_id } = event

  if (!dish_id) {
    return { code: -1, message: '缺少菜品ID', data: null }
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

    // 查询菜品
    const dishRes = await db.collection('dishes').doc(dish_id).get()
    const dish = dishRes.data

    if (!dish) {
      return { code: -1, message: '菜品不存在', data: null }
    }

    // 校验菜品属于调用者的家庭
    if (dish.family_id !== user.family_id) {
      return { code: -1, message: '无权查看此菜品', data: null }
    }

    // 查询烹饪历史
    const historyRes = await db.collection('cook_history')
      .where({ family_id: user.family_id, dish_id })
      .orderBy('cooked_at', 'desc')
      .limit(10)
      .get()

    return {
      code: 0,
      message: 'ok',
      data: {
        dish,
        cook_history: historyRes.data
      }
    }
  } catch (err) {
    console.error('[dish-detail] error:', err)
    return { code: -1, message: err.message || '查询菜品详情失败', data: null }
  }
}
