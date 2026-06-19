// 云函数：menu-manage
// 菜单管理：添加菜品到某天某餐、查询某天菜单、标记做菜完成、评分
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const {
    action,
    date, meal_type, dish_id,
    menu_id, status, rating, note, image_url
  } = event

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

    // 权限检查：add/update_status/rate/remove 需要 admin 或 cook
    // list 对所有家庭成员开放
    const writeActions = ['add', 'update_status', 'rate', 'remove']
    if (writeActions.includes(action) && user.role !== 'admin' && user.role !== 'cook') {
      return { code: -1, message: '权限不足，仅家长或大厨可操作菜单', data: null }
    }

    switch (action) {
      case 'add': {
        // 添加菜品到某天某餐
        if (!date || !meal_type || !dish_id) {
          return { code: -1, message: '缺少日期、餐次或菜品ID', data: null }
        }
        const validMeals = ['breakfast', 'lunch', 'dinner']
        if (!validMeals.includes(meal_type)) {
          return { code: -1, message: '无效的餐次类型', data: null }
        }

        const menuData = {
          family_id: familyId,
          date,
          meal_type,
          dish_id,
          status: 'planned',
          cook_id: '',
          rating: 0,
          note: note || '',
          image_url: '',
          created_at: new Date()
        }
        const res = await db.collection('menus').add({ data: menuData })
        return { code: 0, message: '菜单添加成功', data: { _id: res._id, ...menuData } }
      }

      case 'list': {
        // 查询某天菜单
        if (!date) {
          return { code: -1, message: '缺少日期', data: null }
        }
        const menuRes = await db.collection('menus')
          .where({ family_id: familyId, date })
          .orderBy('meal_type', 'asc')
          .get()

        // 关联菜品信息
        const dishIds = [...new Set(menuRes.data.map(m => m.dish_id))]
        let dishesMap = {}
        if (dishIds.length > 0) {
          const dishesRes = await db.collection('dishes')
            .where({ _id: _.in(dishIds) })
            .get()
          dishesRes.data.forEach(d => { dishesMap[d._id] = d })
        }

        const result = menuRes.data.map(m => ({
          ...m,
          dish_info: dishesMap[m.dish_id] || null
        }))

        return { code: 0, message: 'ok', data: result }
      }

      case 'update_status': {
        // 更新做菜状态
        if (!menu_id || !status) {
          return { code: -1, message: '缺少菜单ID或状态', data: null }
        }
        const validStatus = ['planned', 'cooking', 'done']
        if (!validStatus.includes(status)) {
          return { code: -1, message: '无效的状态', data: null }
        }
        const updateData = { status, updated_at: new Date() }
        if (status === 'cooking' || status === 'done') {
          updateData.cook_id = user._id
        }
        if (status === 'cooking') {
          updateData.started_at = new Date()
        }
        await db.collection('menus').doc(menu_id).update({ data: updateData })

        // 如果完成做菜，记录到烹饪历史
        if (status === 'done') {
          const menuDoc = await db.collection('menus').doc(menu_id).get()
          const menu = menuDoc.data
          if (menu) {
            await db.collection('cook_history').add({
              data: {
                family_id: familyId,
                dish_id: menu.dish_id,
                cook_id: user._id,
                cooked_at: new Date(),
                rating: 0,
                image_url: '',
                note: ''
              }
            })
          }
        }
        return { code: 0, message: '状态更新成功', data: null }
      }

      case 'rate': {
        // 评分
        if (!menu_id || rating === undefined) {
          return { code: -1, message: '缺少菜单ID或评分', data: null }
        }
        if (rating < 1 || rating > 5) {
          return { code: -1, message: '评分范围 1-5', data: null }
        }
        await db.collection('menus').doc(menu_id).update({
          data: { rating: Number(rating), note: note || '', image_url: image_url || '', updated_at: new Date() }
        })

        // 更新烹饪历史中的评分
        const menuDoc2 = await db.collection('menus').doc(menu_id).get()
        if (menuDoc2.data) {
          const menu = menuDoc2.data
          await db.collection('cook_history')
              .where({ family_id: familyId, dish_id: menu.dish_id, cook_id: menu.cook_id })
              .orderBy('cooked_at', 'desc')
              .limit(1)
              .get()
              .then(res => {
                if (res.data.length > 0) {
                  return db.collection('cook_history').doc(res.data[0]._id).update({
                    data: { rating: Number(rating), note: note || '', image_url: image_url || '' }
                  })
                }
              })
        }
        return { code: 0, message: '评分成功', data: null }
      }

      case 'remove': {
        // 删除菜单项
        if (!menu_id) {
          return { code: -1, message: '缺少菜单ID', data: null }
        }
        await db.collection('menus').doc(menu_id).remove()
        return { code: 0, message: '菜单项已删除', data: null }
      }

      default:
        return { code: -1, message: '未知操作类型', data: null }
    }
  } catch (err) {
    console.error('[menu-manage] error:', err)
    return { code: -1, message: err.message || '操作失败', data: null }
  }
}
