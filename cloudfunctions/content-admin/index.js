// 云函数：content-admin
// 平台超级管理员专用：跨家庭全量管理（菜品/家庭/用户/角色/系统配置）
// 鉴权：数据库 config 集合的 admin_openids 白名单（独立于家庭角色系统）

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 设为开发者的 openid，部署后自动获得超管权限
const BOOTSTRAP_OPENID = 'o6zAJs5e1u02jC2hdlr8B9Cxpgxs'

// ========== 白名单读写（容错） ==========

async function getAdminOpenids() {
  try {
    const res = await db.collection('config').where({ type: 'admin_openids' }).get()
    return res.data.length > 0 ? (res.data[0].openids || []) : []
  } catch (e) {
    if (e && e.errCode === -502005) return []
    throw e
  }
}

async function saveAdminOpenids(openids) {
  let existing
  try {
    existing = await db.collection('config').where({ type: 'admin_openids' }).get()
  } catch (e) {
    if (e && e.errCode === -502005) existing = { data: [] }
    else throw e
  }
  if (existing.data.length > 0) {
    await db.collection('config').doc(existing.data[0]._id).update({ data: { openids } })
  } else {
    await db.collection('config').add({ data: { type: 'admin_openids', openids } })
  }
}

// ========== 权限检查 ==========

async function isAdmin(openid) {
  if (BOOTSTRAP_OPENID && openid === BOOTSTRAP_OPENID) return true
  const admins = await getAdminOpenids()
  if (admins.includes(openid)) return true
  if (admins.length === 0) {
    const seed = [openid]
    if (BOOTSTRAP_OPENID && !seed.includes(BOOTSTRAP_OPENID)) seed.push(BOOTSTRAP_OPENID)
    await saveAdminOpenids(seed)
    console.log('[content-admin] 超管白名单初始化:', seed)
    return true
  }
  return false
}

// ========== 工具 ==========

function paginate(array, page, size) {
  const s = Math.max(1, size || 20)
  const p = Math.max(1, page || 1)
  const total = array.length
  const list = array.slice((p - 1) * s, p * s)
  return { list, total, page: p, pageSize: s }
}

// ========== 主入口 ==========

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event

  // my_openid 无需权限
  if (action === 'my_openid') {
    return { code: 0, openid: OPENID }
  }

  if (!(await isAdmin(OPENID))) {
    return { code: -1, message: '无权限' }
  }

  try {
    switch (action) {

      // ==================== 超管管理 ====================

      case 'list_admins': {
        const admins = await getAdminOpenids()
        return { code: 0, data: { openids: admins } }
      }

      case 'add_admin': {
        const { target_openid } = event
        if (!target_openid) return { code: -1, message: '缺少目标OPENID' }
        const admins = await getAdminOpenids()
        if (admins.includes(target_openid)) return { code: 0, message: '已是管理员' }
        admins.push(target_openid)
        await saveAdminOpenids(admins)
        return { code: 0, message: '已添加' }
      }

      case 'remove_admin': {
        const { target_openid } = event
        if (!target_openid) return { code: -1, message: '缺少目标OPENID' }
        let admins = await getAdminOpenids()
        if (admins.length <= 1) return { code: -1, message: '至少保留一个管理员' }
        admins = admins.filter(id => id !== target_openid)
        await saveAdminOpenids(admins)
        return { code: 0, message: '已移除' }
      }

      // ==================== 统计概览 ====================

      case 'stats': {
        const [dishes, families, users, menus, preorders] = await Promise.all([
          db.collection('dishes').count(),
          db.collection('families').count(),
          db.collection('users').count(),
          db.collection('menus').count(),
          db.collection('preorders').count()
        ])
        return {
          code: 0, data: {
            totalDishes: dishes.total, totalFamilies: families.total,
            totalUsers: users.total, totalMenus: menus.total, totalPreorders: preorders.total
          }
        }
      }

      // ==================== 菜品管理 ====================

      case 'list_dishes': {
        const { page, pageSize, keyword, family_id, is_public } = event
        const size = Math.min(pageSize || 20, 100)
        const skip = ((page || 1) - 1) * size
        const conditions = [{ is_deleted: _.neq(true) }]
        if (keyword) {
          conditions.push(_.or([
            { name: db.RegExp({ regexp: keyword, options: 'i' }) },
            { cuisine: db.RegExp({ regexp: keyword, options: 'i' }) }
          ]))
        }
        if (family_id) conditions.push({ family_id })
        if (is_public !== undefined) conditions.push({ is_public: !!is_public })
        const [count, list] = await Promise.all([
          db.collection('dishes').where(_.and(conditions)).count(),
          db.collection('dishes').where(_.and(conditions))
            .orderBy('created_at', 'desc').skip(skip).limit(size).get()
        ])
        return { code: 0, data: { list: list.data, total: count.total, page: page || 1, pageSize: size } }
      }

	      case 'dish_edit': {
	        const { dish_id, name, cuisine, difficulty, cook_time, is_public } = event
	        if (!dish_id) return { code: -1, message: '缺少菜品ID' }
	        // 内容安全检测 v2.0：编辑菜品名称时检查（v1.2.4 审核合规修复）
	        if (name) {
	          try {
	            const check = await cloud.openapi.security.msgSecCheck({
	              openid: OPENID, scene: 2, version: 2, content: name
	            })
            const passed = check.result && check.result.suggest === 'pass'
            if (!passed) {
              return { code: -1, message: '菜品名称违规，请修改', data: null }
            }
	          } catch (e) {
	            console.error('[content-admin] msgSecCheck 失败:', e.errCode, e.message || e.errMsg)
	            return { code: -1, message: '内容安全检查暂时不可用，请稍后重试', data: null }
	          }
	        }
	        const update = {}
	        if (name !== undefined) update.name = name
	        if (cuisine !== undefined) update.cuisine = cuisine
	        if (difficulty !== undefined) update.difficulty = difficulty
	        if (cook_time !== undefined) update.cook_time = parseInt(cook_time) || 30
	        if (is_public !== undefined) update.is_public = !!is_public
	        if (Object.keys(update).length === 0) return { code: -1, message: '无修改内容' }
	        update.updated_at = new Date()
	        await db.collection('dishes').doc(dish_id).update({ data: update })
	        return { code: 0, message: '已更新' }
	      }

      case 'dish_toggle_public': {
        const { dish_id } = event
        if (!dish_id) return { code: -1, message: '缺少菜品ID' }
        const dishRes = await db.collection('dishes').doc(dish_id).get()
        const dish = dishRes.data
        if (!dish) return { code: -1, message: '菜品不存在' }
        await db.collection('dishes').doc(dish_id).update({
          data: { is_public: !dish.is_public, updated_at: new Date() }
        })
        return { code: 0, message: dish.is_public ? '已设为私有' : '已设为公开', data: { is_public: !dish.is_public } }
      }

      case 'hard_delete': {
        const { dish_id } = event
        if (!dish_id) return { code: -1, message: '缺少菜品ID' }
        if (Array.isArray(dish_id)) {
          // 批量删除
          const results = await Promise.allSettled(
            dish_id.map(id => db.collection('dishes').doc(id).remove())
          )
          const ok = results.filter(r => r.status === 'fulfilled').length
          return { code: 0, message: `成功删除 ${ok}/${dish_id.length}`, data: { deleted: ok } }
        }
        await db.collection('dishes').doc(dish_id).remove()
        return { code: 0, message: '已彻底删除' }
      }

      // ==================== 家庭管理 ====================

      case 'list_families': {
        const { page, pageSize } = event
        const size = Math.min(pageSize || 20, 50)
        const skip = ((page || 1) - 1) * size
        const [count, families] = await Promise.all([
          db.collection('families').count(),
          db.collection('families').orderBy('created_at', 'desc').skip(skip).limit(size).get()
        ])
        // 统计每个家庭的成员数和菜品数
        const enriched = await Promise.all(families.data.map(async (f) => {
          const [members, dishes] = await Promise.all([
            db.collection('users').where({ family_id: f._id }).count(),
            db.collection('dishes').where({ family_id: f._id, is_deleted: _.neq(true) }).count()
          ])
          return { ...f, memberCount: members.total, dishCount: dishes.total }
        }))
        return { code: 0, data: { list: enriched, total: count.total, page: page || 1, pageSize: size } }
      }

      case 'family_detail': {
        const { family_id } = event
        if (!family_id) return { code: -1, message: '缺少家庭ID' }
        const familyRes = await db.collection('families').doc(family_id).get()
        if (!familyRes.data) return { code: -1, message: '家庭不存在' }
        const members = await db.collection('users').where({ family_id }).get()
        return { code: 0, data: { family: familyRes.data, members: members.data } }
      }

      case 'family_delete': {
        const { family_id } = event
        if (!family_id) return { code: -1, message: '缺少家庭ID' }
        // 解除所有成员的 family 绑定
        await db.collection('users').where({ family_id }).update({ data: { family_id: '', role: '' } })
        // 删除该家庭的所有关联数据
        await Promise.allSettled([
          db.collection('dishes').where({ family_id }).remove(),
          db.collection('menus').where({ family_id }).remove(),
          db.collection('preorders').where({ family_id }).remove(),
          db.collection('shopping_lists').where({ family_id }).remove(),
          db.collection('cook_history').where({ family_id }).remove()
        ])
        await db.collection('families').doc(family_id).remove()
        return { code: 0, message: '家庭及关联数据已清除' }
      }

      // ==================== 用户管理 ====================

      case 'list_users': {
        const { page, pageSize, keyword, role, family_id } = event
        const size = Math.min(pageSize || 20, 100)
        const skip = ((page || 1) - 1) * size
        const conditions = []
        if (keyword) {
          conditions.push(_.or([
            { nickname: db.RegExp({ regexp: keyword, options: 'i' }) },
            { openid: db.RegExp({ regexp: keyword, options: 'i' }) }
          ]))
        }
        if (role) conditions.push({ role })
        if (family_id) conditions.push({ family_id })
        const query = conditions.length > 0 ? _.and(conditions) : {}
        const [count, users] = await Promise.all([
          db.collection('users').where(query).count(),
          db.collection('users').where(query).orderBy('created_at', 'desc').skip(skip).limit(size).get()
        ])
        // 附带家庭名
        const familyIds = [...new Set(users.data.map(u => u.family_id).filter(Boolean))]
        const familyMap = {}
        if (familyIds.length > 0) {
          const fams = await db.collection('families').where({ _id: _.in(familyIds) }).get()
          fams.data.forEach(f => { familyMap[f._id] = f.name })
        }
        const enriched = users.data.map(u => ({ ...u, familyName: familyMap[u.family_id] || '' }))
        return { code: 0, data: { list: enriched, total: count.total, page: page || 1, pageSize: size } }
      }

      case 'user_set_role': {
        const { user_id, role: newRole } = event
        if (!user_id) return { code: -1, message: '缺少用户ID' }
        const validRoles = ['admin', 'cook', 'eater', 'child', '']
        if (!validRoles.includes(newRole)) return { code: -1, message: '无效角色，有效值：' + validRoles.filter(r => r).join(', ') }
        await db.collection('users').doc(user_id).update({ data: { role: newRole } })
        return { code: 0, message: '角色已更新' }
      }

      case 'user_remove_family': {
        const { user_id } = event
        if (!user_id) return { code: -1, message: '缺少用户ID' }
        await db.collection('users').doc(user_id).update({ data: { family_id: '', role: '' } })
        return { code: 0, message: '已移出家庭' }
      }

      case 'user_delete': {
        const { user_id } = event
        if (!user_id) return { code: -1, message: '缺少用户ID' }
        const user = await db.collection('users').doc(user_id).get()
        if (!user.data || user.data.length === 0) return { code: -1, message: '用户不存在' }
        const uid = user_id
        // 清理关联数据
        await Promise.allSettled([
          db.collection('preorders').where({ user_id: uid }).remove(),
          db.collection('cook_history').where({ cook_id: uid }).remove()
        ])
        await db.collection('users').doc(uid).remove()
        return { code: 0, message: '用户已删除' }
      }

      // ==================== 兼容旧版动作名 ====================
      case 'list_all': {
        // 兼容：重定向到 list_dishes
        const { page, pageSize, keyword } = event
        const size = Math.min(pageSize || 20, 100)
        const skip = ((page || 1) - 1) * size
        const conditions = [{ is_deleted: _.neq(true) }]
        if (keyword) {
          conditions.push(_.or([
            { name: db.RegExp({ regexp: keyword, options: 'i' }) },
            { cuisine: db.RegExp({ regexp: keyword, options: 'i' }) }
          ]))
        }
        const [count, list] = await Promise.all([
          db.collection('dishes').where(_.and(conditions)).count(),
          db.collection('dishes').where(_.and(conditions))
            .orderBy('created_at', 'desc').skip(skip).limit(size).get()
        ])
        return { code: 0, data: { list: list.data, total: count.total, page: page || 1, pageSize: size } }
      }

      default:
        return { code: -1, message: '未知操作: ' + action }
    }
  } catch (err) {
    console.error('[content-admin] error:', err)
    return { code: -1, message: err.message || '操作失败' }
  }
}
