// 云函数：preorder-add
// 添加预购（所有角色可用）+ 管理动作（my_list / cancel / update_note / cancel_other）
// 预购成功后，自动把该菜的食材汇总进家庭当周采购清单
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 简单分类推断：根据食材名猜测品类
function guessCategory(name) {
  if (!name) return '其他'
  const n = name.toLowerCase()
  const rules = [
    { cat: '蔬菜', kw: ['菜', '葱', '姜', '蒜', '椒', '瓜', '萝卜', '土豆', '西红柿', '番茄', '茄子', '豆角', '芹菜', '菠菜', '白菜', '生菜', '香菜', '藕', '笋', '蘑菇', '香菇', '木耳', '海带', '紫菜'] },
    { cat: '肉类', kw: ['肉', '排骨', '五花', '里脊', '猪蹄', '鸡', '鸭', '鹅', '牛', '羊', '猪', '腊肉', '火腿', '培根', '香肠'] },
    { cat: '海鲜', kw: ['鱼', '虾', '蟹', '贝', '鱿鱼', '章鱼', '带鱼', '三文鱼', '蛤', '蚝', '扇贝', '海参'] },
    { cat: '蛋类', kw: ['蛋', '鸡蛋', '鸭蛋', '鹌鹑蛋', '蛋黄', '蛋白'] },
    { cat: '豆制品', kw: ['豆腐', '豆干', '豆皮', '腐竹', '千张', '豆浆', '豆芽'] },
    { cat: '乳制品', kw: ['牛奶', '酸奶', '奶酪', '奶油', '黄油', '芝士'] },
    { cat: '主食', kw: ['米', '面', '粉', '面条', '馒头', '饺子皮', '馄饨皮', '面包', '年糕', '糯米', '燕麦', '面粉'] },
    { cat: '水果', kw: ['苹果', '香蕉', '梨', '柠檬', '桃', '葡萄', '草莓', '蓝莓', '西瓜', '哈密瓜', '芒果', '菠萝', '橙', '橘'] },
    { cat: '调料', kw: ['盐', '糖', '醋', '酱油', '料酒', '蚝油', '油', '淀粉', '味精', '鸡精', '花椒', '八角', '桂皮', '香叶', '胡椒', '孜然', '五香粉', '豆掰酱', '甜面酱', '番茄酱', '芝麻', '蜂蜜'] }
  ]
  for (const r of rules) {
    if (r.kw.some(k => n.includes(k.toLowerCase()))) return r.cat
  }
  return '其他'
}

// 获取或创建当周采购清单（按 week_start 索引）
async function getOrCreateWeeklyList(familyId, weekStart) {
  const existing = await db.collection('shopping_lists')
    .where({ family_id: familyId, week_start: weekStart })
    .limit(1)
    .get()
  if (existing.data.length > 0) {
    return existing.data[0]
  }
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
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// 把一道菜的食材合并进采购清单 items
function mergeIngredientsIntoItems(items, ingredients, dishName) {
  const result = items.slice()
  ingredients.forEach(ing => {
    if (!ing || !ing.name) return
    const cat = ing.category || guessCategory(ing.name)
    const existIdx = result.findIndex(it => it.name === ing.name && (it.category || '其他') === cat)
    if (existIdx >= 0) {
      const exist = result[existIdx]
      const oldAmount = exist.amount || ''
      const newAmount = ing.amount || ''
      exist.amount = oldAmount && newAmount ? `${oldAmount}+${newAmount}` : (oldAmount || newAmount)
      exist.from_dishes = Array.from(new Set([...(exist.from_dishes || []), dishName]))
    } else {
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

/**
 * 核心：添加一条预购记录 + 同步购物清单和菜单
 * @param {object} opts - { user, dish_id, target_date, meal_type, note, family_id }
 *   user 必须带 _id, family_id；meal_type 可选，默认 lunch
 * @returns {object} { code, message, data }
 */
async function doAddPreorder(opts) {
  const { user, dish_id, target_date, note, meal_type } = opts
  const familyId = user.family_id
  const validMeals = ['breakfast', 'lunch', 'dinner']
  const meal = validMeals.includes(meal_type) ? meal_type : 'lunch'

  if (!target_date) {
    return { code: -1, message: '请选择预订日期', data: null }
  }
  if (!dish_id) {
    return { code: -1, message: '请选择要预订的菜品', data: null }
  }

  const dishRes = await db.collection('dishes').doc(dish_id).get()
  if (!dishRes.data || dishRes.data.family_id !== familyId) {
    return { code: -1, message: '菜品不存在或无权预订', data: null }
  }
  const dish = dishRes.data

  const existing = await db.collection('preorders').where({
    family_id: familyId,
    user_id: user._id,
    target_date,
    dish_id
  }).get()
  if (existing.data.length > 0) {
    return { code: -1, message: '该成员已预订过这道菜了', data: null }
  }

	  if (note) {
	    try {
	      // 内容安全检测 v2.0：必须传 openid + scene + version
	      const secCheck = await cloud.openapi.security.msgSecCheck({
	        openid: user.openid,   // 必填：用户 openid（近 2 小时需访问过小程序）
	        scene: 2,              // 必填：场景值 2=评论/发布内容
	        version: 2,            // 必填：固定 2 表示 2.0 接口
	        content: note          // 必填：待检测文本
	      })
	      // 2.0 返回 result.suggest: pass(通过) / risky(违规) / review(人工审核)
	      if (secCheck.result && secCheck.result.suggest !== 'pass') {
	        return { code: -1, message: '备注内容违规，请修改', data: null }
	      }
	    } catch (e) {
	      // openapi 调用异常时拒绝备注（fail-close），确保不合规内容不会绕过检查
	      console.error('[preorder-add] msgSecCheck v2.0 调用失败，备注将被拒绝:', e.errCode, e.message || e.errMsg)
	      return { code: -1, message: '内容安全检查暂时不可用，请稍后重试', data: null }
	    }
	  }

  const preorderData = {
    family_id: familyId,
    user_id: user._id,
    target_date,
    dish_id,
    meal_type: meal,
    note: note || '',
    created_at: new Date()
  }
  const res = await db.collection('preorders').add({ data: preorderData })

  let shoppingUpdated = false
  try {
    const ingredients = dish.ingredients || []
    if (ingredients.length > 0) {
      const weekStart = getWeekStart(target_date)
      const list = await getOrCreateWeeklyList(familyId, weekStart)
      const newItems = mergeIngredientsIntoItems(list.items || [], ingredients, dish.name)
      await db.collection('shopping_lists').doc(list._id).update({
        data: { items: newItems, updated_at: new Date() }
      })
      shoppingUpdated = true
    }
  } catch (shoppingErr) {
    console.error('[preorder-add] 采购清单更新失败:', shoppingErr)
  }

  let menuUpdated = false
  try {
    const menuExisting = await db.collection('menus').where({
      family_id: familyId,
      date: target_date,
      meal_type: meal,
      dish_id
    }).limit(1).get()
    if (menuExisting.data.length === 0) {
      await db.collection('menus').add({
        data: {
          family_id: familyId,
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
  const message = msg.length > 0 ? `预订成功，${msg.join('，')}` : '预订成功'

  return {
    code: 0,
    message,
    data: { _id: res._id, ...preorderData, shoppingUpdated, menuUpdated }
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, target_date, dish_id, note, meal_type, preorder_id, for_user } = event

  // ==================== 多动作路由 ====================
  if (action === 'my_list') {
    return handleMyList(OPENID, event.history_days)
  }
  if (action === 'cancel') {
    return handleCancel(OPENID, preorder_id)
  }
  if (action === 'update_note') {
    return handleUpdateNote(OPENID, preorder_id, note)
  }
  if (action === 'cancel_other') {
    return handleCancelOther(OPENID, preorder_id)
  }
  if (action === 'update') {
    return handleUpdate(OPENID, { preorder_id, dish_id, target_date, note, meal_type, for_user })
  }

  // ==================== 原有：添加预购（默认 action） ====================
  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在，请先登录', data: null }
    }
    const user = userRes.data[0]
    if (!user.family_id) {
      return { code: -1, message: '您未加入任何家庭', data: null }
    }
    return doAddPreorder({ user, dish_id, target_date, note, meal_type })
  } catch (err) {
    console.error('[preorder-add] error:', err)
    return { code: -1, message: err.message || '预订失败', data: null }
  }
}

// ==================== 辅助函数 ====================

/**
 * 查询当前用户预购记录（含菜品信息），按日期倒序
 * @param {string} OPENID
 * @param {number} historyDays - 往前查多少天，默认 3；传 0 = 只看未来；传 null/大值 = 全部
 */
async function handleMyList(OPENID, historyDays) {
  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在', data: null }
    }
    const user = userRes.data[0]

    // 计算截止日期
    const hd = historyDays !== undefined && historyDays !== null ? Number(historyDays) : 3
    const today = new Date()
    const cutoff = new Date(today)
    cutoff.setDate(cutoff.getDate() - hd)
    const y = cutoff.getFullYear()
    const m = String(cutoff.getMonth() + 1).padStart(2, '0')
    const d = String(cutoff.getDate()).padStart(2, '0')
    const minDate = `${y}-${m}-${d}`

    // 查询全部预购的 total（不分页，用于判断 hasMore）
    const totalRes = await db.collection('preorders')
      .where({ user_id: user._id })
      .count()

    // 按日期范围查询
    const preordersRes = await db.collection('preorders')
      .where({ user_id: user._id, target_date: _.gte(minDate) })
      .orderBy('target_date', 'desc')
      .orderBy('created_at', 'desc')
      .get()

    if (preordersRes.data.length === 0) {
      return { code: 0, message: 'ok', data: { preorders: [], totalAll: totalRes.total, hasMore: false } }
    }

    const dishIds = [...new Set(preordersRes.data.map(p => p.dish_id))]
    let dishMap = {}
    if (dishIds.length > 0) {
      const dishesRes = await db.collection('dishes')
        .where({ _id: _.in(dishIds) })
        .get()
      dishesRes.data.forEach(d => { dishMap[d._id] = d })

      // 生成临时图片链接（解决跨用户无法查看图片问题）
      const imageFileIDs = []
      dishesRes.data.forEach(d => {
        if (d.image_url && d.image_url.startsWith('cloud://')) imageFileIDs.push(d.image_url)
        if (d.image && d.image.startsWith('cloud://')) imageFileIDs.push(d.image)
        if (d.image_urls && Array.isArray(d.image_urls)) {
          d.image_urls.forEach(url => { if (url && url.startsWith('cloud://')) imageFileIDs.push(url) })
        }
      })
      if (imageFileIDs.length > 0) {
        try {
          const tmpRes = await cloud.getTempFileURL({ fileList: [...new Set(imageFileIDs)] })
          const urlMap = {}
          tmpRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
          dishesRes.data.forEach(d => {
            if (d.image_url && urlMap[d.image_url]) d.image_url = urlMap[d.image_url]
            if (d.image && urlMap[d.image]) d.image = urlMap[d.image]
            if (d.image_urls && Array.isArray(d.image_urls)) {
              d.image_urls = d.image_urls.map(url => urlMap[url] || url)
            }
          })
          // 更新 dishMap 引用（dishesRes.data 中的对象已被修改）
        } catch (e) {
          console.warn('[preorder-add:my_list] getTempFileURL failed:', e.message)
        }
      }
    }

    const preorders = preordersRes.data.map(p => ({
      _id: p._id,
      dish_id: p.dish_id,
      target_date: p.target_date,
      note: p.note || '',
      created_at: p.created_at,
      dish_name: (dishMap[p.dish_id] && dishMap[p.dish_id].name) || '已删除的菜品',
      dish_image: (dishMap[p.dish_id] && (dishMap[p.dish_id].image || dishMap[p.dish_id].image_url || '')) || '',
      meal_type: p.meal_type || ''
    }))

    return { code: 0, message: 'ok', data: { preorders, totalAll: totalRes.total, hasMore: preorders.length < totalRes.total } }
  } catch (err) {
    console.error('[preorder-add:my_list] error:', err)
    return { code: -1, message: err.message || '查询失败', data: null }
  }
}

/**
 * 取消自己的预购
 */
async function handleCancel(OPENID, preorderId) {
  try {
    if (!preorderId) {
      return { code: -1, message: '缺少预购ID', data: null }
    }
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在', data: null }
    }
    const user = userRes.data[0]

    const preorderRes = await db.collection('preorders').doc(preorderId).get()
    if (!preorderRes.data) {
      return { code: -1, message: '预购记录不存在', data: null }
    }
    const preorder = preorderRes.data
    if (preorder.user_id !== user._id) {
      return { code: -1, message: '只能取消自己的预购', data: null }
    }

    await db.collection('preorders').doc(preorderId).remove()
    return { code: 0, message: '已取消', data: { _id: preorderId } }
  } catch (err) {
    console.error('[preorder-add:cancel] error:', err)
    return { code: -1, message: err.message || '取消失败', data: null }
  }
}

/**
 * 更新预购备注
 */
async function handleUpdateNote(OPENID, preorderId, note) {
  try {
    if (!preorderId) {
      return { code: -1, message: '缺少预购ID', data: null }
    }
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在', data: null }
    }
    const user = userRes.data[0]

    const preorderRes = await db.collection('preorders').doc(preorderId).get()
    if (!preorderRes.data) {
      return { code: -1, message: '预购记录不存在', data: null }
    }
    const preorder = preorderRes.data
    if (preorder.user_id !== user._id) {
      return { code: -1, message: '只能修改自己的预购', data: null }
    }

    if (note) {
      try {
        const secCheck = await cloud.openapi.security.msgSecCheck({
          openid: OPENID, scene: 2, version: 2, content: note
        })
        if (secCheck.result && secCheck.result.suggest !== 'pass') {
          return { code: -1, message: '备注内容违规，请修改', data: null }
        }
      } catch (e) {
        console.error('[preorder-add] msgSecCheck update_note 失败:', e.errCode, e.message || e.errMsg)
        return { code: -1, message: '内容安全检查暂时不可用，请稍后重试', data: null }
      }
    }

    await db.collection('preorders').doc(preorderId).update({
      data: { note: note || '' }
    })
    return { code: 0, message: '备注已更新', data: { _id: preorderId } }
  } catch (err) {
    console.error('[preorder-add:update_note] error:', err)
    return { code: -1, message: err.message || '更新失败', data: null }
  }
}

/**
 * 管理员取消其他成员的预购
 */
async function handleCancelOther(OPENID, preorderId) {
  try {
    if (!preorderId) {
      return { code: -1, message: '缺少预购ID', data: null }
    }
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在', data: null }
    }
    const admin = userRes.data[0]
    if (admin.role !== 'admin') {
      return { code: -1, message: '仅家长可管理其他人的预购', data: null }
    }
    if (!admin.family_id) {
      return { code: -1, message: '您未加入任何家庭', data: null }
    }

    const preorderRes = await db.collection('preorders').doc(preorderId).get()
    if (!preorderRes.data) {
      return { code: -1, message: '预购记录不存在', data: null }
    }
    const preorder = preorderRes.data
    if (preorder.family_id !== admin.family_id) {
      return { code: -1, message: '该预购不属于您的家庭', data: null }
    }

    await db.collection('preorders').doc(preorderId).remove()
    return { code: 0, message: '已取消', data: { _id: preorderId, canceled_by: admin._id } }
  } catch (err) {
    console.error('[preorder-add:cancel_other] error:', err)
    return { code: -1, message: err.message || '取消失败', data: null }
  }
}

/**
 * 修改预购（自己或管理员）：先删旧再建新，同步购物清单和菜单
 * 参数：preorder_id（必填）, dish_id / target_date / meal_type / note（可选覆盖）,
 *       for_user（admin 为他人修改时指定目标用户 openid）
 */
async function handleUpdate(OPENID, opts) {
  const { preorder_id, dish_id, target_date, note, meal_type, for_user } = opts

  if (!preorder_id) {
    return { code: -1, message: '缺少预购ID', data: null }
  }

  try {
    // 1. 获取调用者
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在，请先登录', data: null }
    }
    const caller = userRes.data[0]

    // 2. 获取旧预购
    const preorderRes = await db.collection('preorders').doc(preorder_id).get()
    if (!preorderRes.data) {
      return { code: -1, message: '预购记录不存在', data: null }
    }
    const old = preorderRes.data

    // 3. 权限检查
    const isAdmin = caller.role === 'admin' && caller.family_id === old.family_id
    const isOwner = old.user_id === caller._id
    if (!isAdmin && !isOwner) {
      return { code: -1, message: '无权修改此预定', data: null }
    }

    // 4. 确定新预购的实际归属用户
    let actualUser = caller
    if (for_user && isAdmin) {
      // admin 替他人修改：查目标用户是否同家庭
      const targetRes = await db.collection('users')
        .where({ openid: for_user, family_id: caller.family_id }).get()
      if (targetRes.data.length === 0) {
        return { code: -1, message: '目标用户不在您的家庭中', data: null }
      }
      actualUser = targetRes.data[0]
    } else if (!isOwner && !for_user) {
      // 既不是自己的也不是代他人操作 → 防御
      return { code: -1, message: '无权修改此预定', data: null }
    } else if (isOwner) {
      // 修改自己的：查自己的完整用户记录
      actualUser = caller
    }

    // 5. 合并新旧值
    const newDishId = dish_id || old.dish_id
    const newDate = target_date || old.target_date
    const newNote = note !== undefined ? note : (old.note || '')
    const newMeal = meal_type || old.meal_type || 'lunch'

    // 6. 如果换了菜品，验证新菜品存在且属于同一家庭
    if (dish_id && dish_id !== old.dish_id) {
      const dishRes = await db.collection('dishes').doc(dish_id).get()
      if (!dishRes.data || dishRes.data.family_id !== caller.family_id) {
        return { code: -1, message: '菜品不存在或无权预订', data: null }
      }
    }

    // 7. 先删除旧预购
    await db.collection('preorders').doc(preorder_id).remove()

    // 8. 调用核心添加逻辑（会自动检查重复、同步购物清单和菜单）
    const result = await doAddPreorder({
      user: actualUser,
      dish_id: newDishId,
      target_date: newDate,
      note: newNote,
      meal_type: newMeal
    })

    if (result.code !== 0) {
      // 新预购创建失败，尝试回滚：重建旧预购
      try {
        await db.collection('preorders').add({
          data: {
            family_id: old.family_id,
            user_id: old.user_id,
            target_date: old.target_date,
            dish_id: old.dish_id,
            meal_type: old.meal_type || 'lunch',
            note: old.note || '',
            created_at: old.created_at || new Date()
          }
        })
      } catch (rollbackErr) {
        console.error('[preorder-add:update] 回滚失败:', rollbackErr)
      }
      return result
    }

    return {
      code: 0,
      message: '修改成功',
      data: { old_id: preorder_id, ...result.data }
    }
  } catch (err) {
    console.error('[preorder-add:update] error:', err)
    return { code: -1, message: err.message || '修改失败', data: null }
  }
}
