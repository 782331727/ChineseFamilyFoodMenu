// 云函数：shopping-list
// 采购清单 CRUD
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const {
    action,
    list_id, week_start,
    items, estimated_cost,
    item_index, checked
  } = event

  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在，请先登录', data: null }
    }
    const user = userRes.data[0]

    if (!user.family_id) {
      return { code: -1, message: '您未加入任何家庭', data: null }
    }

    const familyId = user.family_id

    // 权限检查：create/update_items/delete 需要 admin 或 cook
    // list/detail/toggle_item 对所有家庭成员开放
    const writeActions = ['create', 'update_items', 'delete']
    if (writeActions.includes(action) && user.role !== 'admin' && user.role !== 'cook') {
      return { code: -1, message: '权限不足，仅家长或大厨可管理采购清单', data: null }
    }

    switch (action) {
      case 'create': {
        // 创建采购清单
        const listData = {
          family_id: familyId,
          week_start: week_start || new Date().toISOString().split('T')[0],
          items: items || [],
          estimated_cost: estimated_cost || '',
          created_at: new Date()
        }
        const res = await db.collection('shopping_lists').add({ data: listData })
        return { code: 0, message: '采购清单创建成功', data: { _id: res._id, ...listData } }
      }

      case 'list': {
        // 查询采购清单
        const query = { family_id: familyId }
        if (week_start) query.week_start = week_start
        const res = await db.collection('shopping_lists')
          .where(query)
          .orderBy('created_at', 'desc')
          .limit(20)
          .get()
        return { code: 0, message: 'ok', data: res.data }
      }

      case 'detail': {
        // 查询单个采购清单
        if (!list_id) {
          return { code: -1, message: '缺少清单ID', data: null }
        }
        const res = await db.collection('shopping_lists').doc(list_id).get()
        if (!res.data || res.data.family_id !== familyId) {
          return { code: -1, message: '清单不存在或无权访问', data: null }
        }
        return { code: 0, message: 'ok', data: res.data }
      }

      case 'update_items': {
        // 更新清单内容
        if (!list_id) {
          return { code: -1, message: '缺少清单ID', data: null }
        }
        const updateData = { updated_at: new Date() }
        if (items) updateData.items = items
        if (estimated_cost !== undefined) updateData.estimated_cost = estimated_cost
        await db.collection('shopping_lists').doc(list_id).update({ data: updateData })
        return { code: 0, message: '清单更新成功', data: null }
      }

      case 'toggle_item': {
        // 勾选/取消勾选采购项
        if (!list_id || item_index === undefined) {
          return { code: -1, message: '缺少清单ID或项目索引', data: null }
        }
        const listRes = await db.collection('shopping_lists').doc(list_id).get()
        if (!listRes.data || listRes.data.family_id !== familyId) {
          return { code: -1, message: '清单不存在或无权访问', data: null }
        }
        const currentItems = listRes.data.items || []
        if (item_index < 0 || item_index >= currentItems.length) {
          return { code: -1, message: '项目索引超出范围', data: null }
        }
        currentItems[item_index].checked = checked !== undefined ? checked : !currentItems[item_index].checked
        await db.collection('shopping_lists').doc(list_id).update({
          data: { items: currentItems, updated_at: new Date() }
        })
        return { code: 0, message: 'ok', data: { items: currentItems } }
      }

      case 'delete': {
        // 删除采购清单
        if (!list_id) {
          return { code: -1, message: '缺少清单ID', data: null }
        }
        await db.collection('shopping_lists').doc(list_id).remove()
        return { code: 0, message: '清单已删除', data: null }
      }

      case 'generate': {
        // 根据某天的预定菜品，自动汇总食材生成采购清单
        // 参数：target_date（必填）
        const { target_date } = event
        if (!target_date) {
          return { code: -1, message: '缺少预定日期', data: null }
        }

        // 查询该天全家预定
        const preorderRes = await db.collection('preorders')
          .where({ family_id: familyId, target_date })
          .get()

        if (preorderRes.data.length === 0) {
          return { code: -1, message: '该日期暂无预定菜品，无法生成采购清单', data: null }
        }

        // 收集所有菜品的 dish_id
        const dishIds = [...new Set(preorderRes.data.map(p => p.dish_id))]
        const dishesRes = await db.collection('dishes')
          .where({ _id: _.in(dishIds) })
          .get()

        // 汇总食材，按 category 分组
        const grouped = {} // { category: [ { name, amount } ] }
        const dishesMap = {}
        dishesRes.data.forEach(d => { dishesMap[d._id] = d })

        preorderRes.data.forEach(p => {
          const dish = dishesMap[p.dish_id]
          if (!dish || !dish.ingredients) return
          dish.ingredients.forEach(ing => {
            const cat = ing.category || dish.cuisine || '其他'
            const name = ing.name || ''
            if (!name) return
            if (!grouped[cat]) grouped[cat] = {}
            // 同名食材合并用量
            if (grouped[cat][name]) {
              grouped[cat][name].amount = (grouped[cat][name].amount || '') + '、' + (ing.amount || '')
            } else {
              grouped[cat][name] = { name, amount: ing.amount || '' }
            }
          })
        })

        // 转成前端期望的结构
        const items = []
        Object.keys(grouped).forEach(cat => {
          Object.values(grouped[cat]).forEach(ing => {
            items.push({
              name: ing.name,
              amount: ing.amount,
              category: cat,
              checked: false
            })
          })
        })

        if (items.length === 0) {
          return { code: -1, message: '预定菜品暂无食材信息，无法生成采购清单', data: null }
        }

        // 删除该日期旧的自动生成清单（避免重复）
        const oldLists = await db.collection('shopping_lists')
          .where({ family_id: familyId, auto_from: target_date })
          .get()
        for (const old of oldLists.data) {
          await db.collection('shopping_lists').doc(old._id).remove()
        }

        // 创建新清单
        const listData = {
          family_id: familyId,
          week_start: target_date,
          auto_from: target_date,   // 标记是某天预定自动生成的
          items,
          estimated_cost: '',
          created_at: new Date()
        }
        const res = await db.collection('shopping_lists').add({ data: listData })

        return {
          code: 0,
          message: '采购清单已生成',
          data: { _id: res._id, ...listData }
        }
      }

      default:
        return { code: -1, message: '未知操作类型', data: null }
    }
  } catch (err) {
    console.error('[shopping-list] error:', err)
    return { code: -1, message: err.message || '操作失败', data: null }
  }
}
