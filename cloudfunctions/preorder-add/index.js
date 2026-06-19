// 云函数：preorder-add
// 添加预定（所有角色可用），同一日期同一人可预定多道菜
// 预定成功后，自动把该菜的食材汇总进家庭当周采购清单
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 简单分类推断：根据食材名猜测品类
function guessCategory(name) {
  if (!name) return '其他'
  const n = name.toLowerCase()
  const rules = [
    { cat: '蔬菜', kw: ['菜', '葱', '姜', '蒜', '椒', '瓜', '萝卜', '土豆', '西红柿', '番茄', '茄子', '豆角', '芹菜', '菠菜', '白菜', '生菜', '韭菜', '藕', '笋', '蘑菇', '香菇', '木耳', '海带', '紫菜'] },
    { cat: '肉类', kw: ['肉', '排骨', '五花', '里脊', '猪蹄', '鸡', '鸭', '鹅', '牛', '羊', '猪', '腊肉', '火腿', '培根', '香肠'] },
    { cat: '海鲜', kw: ['鱼', '虾', '蟹', '贝', '鱿鱼', '章鱼', '带鱼', '三文鱼', '蛤', '蚝', '扇贝', '海参'] },
    { cat: '蛋类', kw: ['蛋', '鸡蛋', '鸭蛋', '鹌鹑蛋', '蛋黄', '蛋白'] },
    { cat: '豆制品', kw: ['豆腐', '豆干', '豆皮', '腐竹', '千张', '豆浆', '豆芽'] },
    { cat: '乳制品', kw: ['牛奶', '酸奶', '奶酪', '奶油', '黄油', '芝士'] },
    { cat: '主食', kw: ['米', '面', '粉', '面条', '馒头', '饺子皮', '馄饨皮', '面包', '年糕', '糯米', '燕麦', '面粉'] },
    { cat: '水果', kw: ['苹果', '香蕉', '橙', '柠檬', '梨', '葡萄', '草莓', '蓝莓', '西瓜', '哈密瓜', '芒果', '菠萝', '猕猴桃', '柚', '枣'] },
    { cat: '调料', kw: ['盐', '糖', '醋', '酱油', '料酒', '蚝油', '油', '淀粉', '味精', '鸡精', '花椒', '八角', '桂皮', '香叶', '胡椒', '孜然', '五香粉', '豆瓣酱', '甜面酱', '番茄酱', '芝麻', '蜂蜜'] }
  ]
  for (const r of rules) {
    if (r.kw.some(k => n.includes(k.toLowerCase()))) return r.cat
  }
  return '其他'
}

// 获取或创建当周采购清单（按 week_start 索引）
async function getOrCreateWeeklyList(familyId, weekStart) {
  // 查找该周已有的清单
  const existing = await db.collection('shopping_lists')
    .where({ family_id: familyId, week_start: weekStart })
    .limit(1)
    .get()

  if (existing.data.length > 0) {
    return existing.data[0]
  }

  // 没有则创建一张空清单
  const listData = {
    family_id: familyId,
    week_start: weekStart,
    items: [],
    estimated_cost: '',
    created_at: new Date()
  }
  const res = await db.collection('shopping_lists').add({ data: listData })
  return { _id: res._id, ...listData }
}

// 计算本周一作为 week_start
function getWeekStart(date) {
  const d = new Date(date)
  const day = d.getDay() // 0=周日
  const diff = day === 0 ? -6 : 1 - day // 回到周一
  d.setDate(d.getDate() + diff)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// 把一道菜的食材合并进采购清单 items
// 同名食材累加用量（用量是字符串，简单拼接）
function mergeIngredientsIntoItems(items, ingredients, dishName) {
  const result = items.slice()
  ingredients.forEach(ing => {
    if (!ing || !ing.name) return
    const cat = ing.category || guessCategory(ing.name)
    // 查找已存在的同名同分类项
    const existIdx = result.findIndex(
      it => it.name === ing.name && (it.category || '其他') === cat
    )
    if (existIdx >= 0) {
      // 已存在：累加用量
      const exist = result[existIdx]
      const oldAmount = exist.amount || ''
      const newAmount = ing.amount || ''
      exist.amount = oldAmount && newAmount ? `${oldAmount}+${newAmount}` : (oldAmount || newAmount)
      exist.from_dishes = Array.from(new Set([...(exist.from_dishes || []), dishName]))
    } else {
      // 新增
      result.push({
        name: ing.name,
        amount: ing.amount || '',
        category: cat,
        checked: false,
        estimated_price: '',
        from_dishes: [dishName]
      })
    }
  })
  return result
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { target_date, dish_id, note, meal_type } = event

  if (!target_date) {
    return { code: -1, message: '请选择预定日期', data: null }
  }
  if (!dish_id) {
    return { code: -1, message: '请选择要预定的菜品', data: null }
  }
  // meal_type 可选，默认 lunch
  const validMeals = ['breakfast', 'lunch', 'dinner']
  const meal = validMeals.includes(meal_type) ? meal_type : 'lunch'

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

    // 校验菜品属于同一家庭
    const dishRes = await db.collection('dishes').doc(dish_id).get()
    if (!dishRes.data || dishRes.data.family_id !== user.family_id) {
      return { code: -1, message: '菜品不存在或无权预定', data: null }
    }
    const dish = dishRes.data

    // 检查是否已预定同一道菜
    const existing = await db.collection('preorders').where({
      family_id: user.family_id,
      user_id: user._id,
      target_date,
      dish_id
    }).get()

    if (existing.data.length > 0) {
      return { code: -1, message: '您已预定过这道菜了', data: null }
    }

    // 内容安全检测（备注文本）
    if (note) {
      try {
        const secCheck = await cloud.openapi.security.msgSecCheck({ content: note })
        if (secCheck.errCode !== 0) return { code: -1, message: '备注内容违规，请修改', data: null }
      } catch (e) {
        // openapi 不可用时放行
      }
    }

    // 写入预定记录
    const preorderData = {
      family_id: user.family_id,
      user_id: user._id,
      target_date,
      dish_id,
      note: note || '',
      created_at: new Date()
    }
    const res = await db.collection('preorders').add({ data: preorderData })

    // === 自动汇总食材到当周采购清单 ===
    let shoppingUpdated = false
    try {
      const ingredients = dish.ingredients || []
      if (ingredients.length > 0) {
        const weekStart = getWeekStart(target_date)
        const list = await getOrCreateWeeklyList(user.family_id, weekStart)
        const newItems = mergeIngredientsIntoItems(list.items || [], ingredients, dish.name)
        await db.collection('shopping_lists').doc(list._id).update({
          data: { items: newItems, updated_at: new Date() }
        })
        shoppingUpdated = true
      }
    } catch (shoppingErr) {
      // 采购清单更新失败不影响预定本身
      console.error('[preorder-add] 采购清单更新失败:', shoppingErr)
    }

    // === 自动写入 menus 表，首页"今日菜单"可展示预定菜品 ===
    let menuUpdated = false
    try {
      // 检查该日期+餐次+菜品是否已在菜单中
      const menuExisting = await db.collection('menus').where({
        family_id: user.family_id,
        date: target_date,
        meal_type: meal,
        dish_id
      }).limit(1).get()

      if (menuExisting.data.length === 0) {
        await db.collection('menus').add({
          data: {
            family_id: user.family_id,
            date: target_date,
            meal_type: meal,
            dish_id,
            status: 'planned',
            cook_id: '',
            rating: 0,
            note: note || '',
            image_url: '',
            created_at: new Date()
          }
        })
        menuUpdated = true
      }
    } catch (menuErr) {
      console.error('[preorder-add] 菜单写入失败:', menuErr)
    }

    const msg = []
    if (menuUpdated) msg.push('已加入当日菜单')
    if (shoppingUpdated) msg.push('已加入采购清单')
    const message = msg.length > 0 ? `预定成功，${msg.join('，')}` : '预定成功'

    return {
      code: 0,
      message,
      data: { _id: res._id, ...preorderData, shoppingUpdated, menuUpdated }
    }
  } catch (err) {
    console.error('[preorder-add] error:', err)
    return { code: -1, message: err.message || '预定失败', data: null }
  }
}
