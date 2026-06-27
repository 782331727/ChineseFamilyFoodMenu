// 云函数：dish-add
// 添加/更新菜品（admin/cook 权限），支持手动添加、AI结果保存和编辑
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 内容安全检测 v2.0：必须传入 openid + scene + version
// 官方文档：security.msgSecCheck 2.0 要求 openid（近2小时活跃）+ scene（1资料/2评论/3论坛/4社交）
// 返回 result.suggest: pass(通过) / risky(违规) / review(人工审核)
async function checkContent(openid, name, ingredients, steps, tags) {
  const texts = [
    name || '',
    ...(ingredients || []).map(i => i.name || ''),
    ...(steps || []).map(s => s || ''),
    ...(tags || [])
  ].filter(Boolean)
  if (texts.length === 0) return { pass: true }
  const content = texts.join(';')
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid,           // 必填：用户 openid（近 2 小时需访问过小程序）
      scene: 2,         // 必填：场景值 2=评论/发布内容
      version: 2,       // 必填：固定 2 表示 2.0 接口
      content           // 必填：待检测文本，上限 2500 字
    })
    // 2.0 返回格式：{ errcode, errmsg, result: { suggest: 'pass'|'risky'|'review', label } }
    const passed = res.result && res.result.suggest === 'pass'
    return { pass: passed, err: passed ? '' : (res.errmsg || '内容可能包含违规信息') }
  } catch (e) {
    // 2.0 调用失败时拒绝提交（fail-close）：确保不合规内容不会绕过检查
    // 常见错误码：40003 openid 无效 / 43104 appid 不匹配 / -604101 权限未配置
    console.error('[dish-add] msgSecCheck v2.0 调用失败，内容将被拒绝:', e.errCode, e.message || e.errMsg)
    return { pass: false, err: '内容安全检查暂时不可用，请稍后重试' }
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const {
    action, dish_id, dish_ids, skip_check,
    name, image_url, image_urls, cuisine, difficulty, cook_time,
    ingredients, steps, nutrition_tags, source, is_public
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

    // 权限检查：admin/cook 可操作菜品管理；clone/rate 全员可用
    if (action !== 'clone' && action !== 'rate' && user.role !== 'admin' && user.role !== 'cook') {
      return { code: -1, message: '权限不足，仅家长或大厨可操作菜品', data: null }
    }

    // === 菜品评分 ===
    if (action === 'rate') {
      const rating = event.rating
      if (!dish_id) return { code: -1, message: '缺少菜品ID', data: null }
      if (!rating || rating < 1 || rating > 5) return { code: -1, message: '评分范围 1-5', data: null }

      const dish = await db.collection('dishes').doc(dish_id).get()
      if (!dish.data || dish.data.family_id !== user.family_id) {
        return { code: -1, message: '菜品不存在或无权评价', data: null }
      }
      const old = dish.data
      const newCount = (old.rating_count || 0) + 1
      const oldAvg = old.avg_rating || 0
      const newAvg = Math.round(((oldAvg * (newCount - 1) + Number(rating)) / newCount) * 10) / 10

      await db.collection('dishes').doc(dish_id).update({
        data: { avg_rating: newAvg, rating_count: newCount, updated_at: new Date() }
      })
      return { code: 0, message: `评分成功 (${newAvg}分)`, data: { avg_rating: newAvg, rating_count: newCount } }
    }

    // === 软删除 / 恢复 / 彻底删除（仅 admin/cook）===
    if (action === 'softDelete' || action === 'restore' || action === 'hardDelete') {
      if (!dish_id) return { code: -1, message: '缺少菜品ID', data: null }
      const d = await db.collection('dishes').doc(dish_id).get()
      if (!d.data || d.data.family_id !== user.family_id) return { code: -1, message: '菜品不存在或无权操作', data: null }
      if (action === 'softDelete') {
        await db.collection('dishes').doc(dish_id).update({ data: { is_deleted: true, updated_at: new Date() } })
        return { code: 0, message: '已移入回收站', data: null }
      }
      if (action === 'restore') {
        await db.collection('dishes').doc(dish_id).update({ data: { is_deleted: false, updated_at: new Date() } })
        return { code: 0, message: '已恢复', data: null }
      }
      if (action === 'hardDelete') {
        if (!d.data.is_deleted) return { code: -1, message: '请先移入回收站再彻底删除', data: null }
        await db.collection('dishes').doc(dish_id).remove()
        return { code: 0, message: '已彻底删除', data: null }
      }
    }

    // === 批量更新分类 ===
    if (action === 'batchCategory') {
      if (!dish_ids || !Array.isArray(dish_ids) || dish_ids.length === 0) {
        return { code: -1, message: '请选择至少一道菜品', data: null }
      }
      if (!cuisine) {
        return { code: -1, message: '请选择目标分类', data: null }
      }
      // 校验所有权后批量更新
      const _ = db.command
      const res = await db.collection('dishes').where({
        _id: _.in(dish_ids),
        family_id: user.family_id
      }).update({
        data: { cuisine, updated_at: new Date() }
      })
      return { code: 0, message: `已更新 ${res.stats.updated} 道菜品`, data: { updated: res.stats.updated } }
    }

    // === 批量更新公开/私密 ===
    if (action === 'batchPublic') {
      if (!dish_ids || !Array.isArray(dish_ids) || dish_ids.length === 0) {
        return { code: -1, message: '请选择至少一道菜品', data: null }
      }
      const pub = event.is_public
      if (pub === undefined) {
        return { code: -1, message: '请指定公开状态', data: null }
      }
      const res = await db.collection('dishes').where({
        _id: db.command.in(dish_ids),
        family_id: user.family_id
      }).update({
        data: { is_public: !!pub, updated_at: new Date() }
      })
      const label = pub ? '公开' : '仅家庭可见'
      return { code: 0, message: `已设为${label} (${res.stats.updated}道)`, data: { updated: res.stats.updated } }
    }

    // === 批量软删除 ===
    if (action === 'batchDelete') {
      if (!dish_ids || !Array.isArray(dish_ids) || dish_ids.length === 0) {
        return { code: -1, message: '请选择至少一道菜品', data: null }
      }
      const res = await db.collection('dishes').where({
        _id: db.command.in(dish_ids),
        family_id: user.family_id
      }).update({
        data: { is_deleted: true, updated_at: new Date() }
      })
      return { code: 0, message: `已移入回收站 (${res.stats.updated}道)`, data: { updated: res.stats.updated } }
    }

    // === 跨家庭克隆公开菜 ===
    if (action === 'clone') {
      if (!dish_id) return { code: -1, message: '缺少菜品ID', data: null }
      const src = await db.collection('dishes').doc(dish_id).get()
      if (!src.data || !src.data.is_public) return { code: -1, message: '菜品不存在或未公开', data: null }
      const s = src.data
      const cloned = {
        family_id: user.family_id,
        name: s.name,
        image_url: s.image_url || '',
        image_urls: s.image_urls || (s.image_url ? [s.image_url] : []),
        cuisine: s.cuisine || '家常菜',
        difficulty: s.difficulty || '简单',
        cook_time: s.cook_time || 30,
        ingredients: s.ingredients || [],
        steps: s.steps || [],
        nutrition_tags: s.nutrition_tags || [],
        source: 'cloned',
        is_public: false,
        created_by: user._id,
        created_at: new Date(),
        updated_at: new Date()
      }
      const res = await db.collection('dishes').add({ data: cloned })
      return { code: 0, message: '已引入到我家', data: { _id: res._id, ...cloned } }
    }

    // === 更新菜品 ===
    if (action === 'update') {
      if (!dish_id) {
        return { code: -1, message: '缺少菜品ID', data: null }
      }
      if (!name) {
        return { code: -1, message: '菜品名称不能为空', data: null }
      }

      // 校验菜品存在且属于同一家庭
      const existingDish = await db.collection('dishes').doc(dish_id).get()
      if (!existingDish.data || existingDish.data.family_id !== user.family_id) {
        return { code: -1, message: '菜品不存在或无权编辑', data: null }
      }

      const updateData = {
        name,
        image_url: image_url || '',
        image_urls: image_urls || (image_url ? [image_url] : []),
        cuisine: cuisine || '家常菜',
        difficulty: difficulty || '简单',
        cook_time: cook_time || 30,
        ingredients: ingredients || [],
        steps: steps || [],
        nutrition_tags: nutrition_tags || [],
        is_public: !!is_public,
        updated_at: new Date()
      }

      if (!skip_check) {
        const { pass, err } = await checkContent(OPENID, updateData.name, updateData.ingredients, updateData.steps, updateData.nutrition_tags)
        if (!pass) return { code: -1, message: err || '内容违规，请修改后重试', data: null }
      }

      await db.collection('dishes').doc(dish_id).update({ data: updateData })
      return { code: 0, message: '菜品更新成功', data: { _id: dish_id, ...updateData } }
    }

    // === 添加菜品（默认） ===
    if (!name) {
      return { code: -1, message: '菜品名称不能为空', data: null }
    }

    const now = new Date()
    const dishData = {
      family_id: user.family_id,
      name,
      image_url: image_url || '',
      image_urls: image_urls || (image_url ? [image_url] : []),
      cuisine: cuisine || '家常菜',
      difficulty: difficulty || '简单',
      cook_time: cook_time || 30,
      ingredients: ingredients || [],
      steps: steps || [],
      nutrition_tags: nutrition_tags || [],
      source: source || 'manual',
      is_public: !!is_public,
      created_by: user._id,
      created_at: now,
      updated_at: now
    }

    const { pass, err } = await checkContent(OPENID, dishData.name, dishData.ingredients, dishData.steps, dishData.nutrition_tags)
    if (!pass) return { code: -1, message: err || '内容违规，请修改后重试', data: null }

    const res = await db.collection('dishes').add({ data: dishData })

    return {
      code: 0, message: '菜品添加成功',
      data: { _id: res._id, ...dishData }
    }
  } catch (err) {
    console.error('[dish-add] error:', err)
    return { code: -1, message: err.message || '操作失败', data: null }
  }
}
