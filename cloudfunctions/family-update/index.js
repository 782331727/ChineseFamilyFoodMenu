// 云函数：family-update
// 更新家庭信息、成员角色（仅 admin 可调用）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, family_name, member_id, member_role } = event

  try {
    // 查询调用者
    const callerRes = await db.collection('users').where({ openid: OPENID }).get()
    if (callerRes.data.length === 0) {
      return { code: -1, message: '用户不存在', data: null }
    }
    const caller = callerRes.data[0]

    if (!caller.family_id) {
      return { code: -1, message: '您未加入任何家庭', data: null }
    }

    const familyId = caller.family_id

    // 需要 admin 权限的操作
    const adminActions = ['update_family', 'update_member_role', 'remove_member']
    if (adminActions.includes(action) && caller.role !== 'admin') {
      return { code: -1, message: '权限不足，仅家长可操作', data: null }
    }

    switch (action) {
      case 'update_family': {
        const updateData = {}
        if (family_name) {
          // 内容安全检测 v2.0：家庭名称使用 scene=1（资料场景）
          try {
            const check = await cloud.openapi.security.msgSecCheck({
              openid: OPENID,       // 必填：当前用户 openid
              scene: 1,             // 必填：1=资料
              version: 2,           // 必填：2.0 接口
              content: family_name  // 必填：待检测文本
            })
            const passed = check.result && check.result.suggest === 'pass'
            if (!passed) {
              return { code: -1, message: '内容违规，请修改', data: null }
            }
          } catch (e) {
            // fail-close：安全检查异常时拒绝提交
            console.error('[family-update] msgSecCheck v2.0 调用失败:', e.errCode, e.message || e.errMsg)
            return { code: -1, message: '内容安全检查暂时不可用，请稍后重试', data: null }
          }
          updateData.name = family_name
        }
        if (Object.keys(updateData).length === 0) {
          return { code: -1, message: '没有需要更新的字段', data: null }
        }
        await db.collection('families').doc(familyId).update({ data: updateData })
        return { code: 0, message: '家庭信息更新成功', data: null }
      }

      case 'update_member_role': {
        // 更新成员角色
        if (!member_id || !member_role) {
          return { code: -1, message: '缺少成员ID或角色', data: null }
        }
        const validRoles = ['admin', 'cook', 'eater', 'child']
        if (!validRoles.includes(member_role)) {
          return { code: -1, message: '无效的角色类型', data: null }
        }
        // 检查目标成员是否属于同一家庭
        const memberRes = await db.collection('users').doc(member_id).get()
        if (!memberRes.data || memberRes.data.family_id !== familyId) {
          return { code: -1, message: '该成员不属于您的家庭', data: null }
        }
        // 防止最后一个家长被降级（包括自己改自己）
        if (memberRes.data.role === 'admin' && member_role !== 'admin') {
          const adminCountRes = await db.collection('users')
            .where({ family_id: familyId, role: 'admin' })
            .count()
          if (adminCountRes.total <= 1) {
            return { code: -1, message: '至少保留一位家长，无法降级', data: null }
          }
        }
        await db.collection('users').doc(member_id).update({
          data: { role: member_role }
        })
        return { code: 0, message: '成员角色更新成功', data: null }
      }

      case 'remove_member': {
        // 移除成员
        if (!member_id) {
          return { code: -1, message: '缺少成员ID', data: null }
        }
        const memberRes2 = await db.collection('users').doc(member_id).get()
        if (!memberRes2.data || memberRes2.data.family_id !== familyId) {
          return { code: -1, message: '该成员不属于您的家庭', data: null }
        }
        if (memberRes2.data.role === 'admin') {
          return { code: -1, message: '不能移除家长，请先转移家长权限', data: null }
        }
        await db.collection('users').doc(member_id).update({
          data: { family_id: '', role: '' }
        })
        return { code: 0, message: '成员已移出家庭', data: null }
      }

      case 'get_members': {
        // 获取家庭成员列表 + 家庭信息
        const [membersRes, familyRes] = await Promise.all([
          db.collection('users').where({ family_id: familyId }).get(),
          db.collection('families').doc(familyId).get()
        ])
        const family = familyRes.data || {}
        // 生成临时头像链接
        const avatarIDs = []
        membersRes.data.forEach(m => {
          if (m.avatar && m.avatar.startsWith('cloud://')) avatarIDs.push(m.avatar)
        })
        if (avatarIDs.length > 0) {
          try {
            const tmpRes = await cloud.getTempFileURL({ fileList: [...new Set(avatarIDs)] })
            const urlMap = {}
            tmpRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
            membersRes.data.forEach(m => {
              if (m.avatar && m.avatar.startsWith('cloud://')) {
                // 转换成功则用临时 URL，否则置空让前端用默认头像
                m.avatar = urlMap[m.avatar] || ''
              }
            })
          } catch (e) {
            console.warn('[family-update] getTempFileURL failed, clearing avatars:', e.message)
            // 转换失败：把 cloud:// 头像全部置空，前端 fallback 到默认头像
            membersRes.data.forEach(m => {
              if (m.avatar && m.avatar.startsWith('cloud://')) m.avatar = ''
            })
          }
        }
        return {
          code: 0,
          message: 'ok',
          data: { members: membersRes.data, family }
        }
      }

      default:
        return { code: -1, message: '未知操作类型', data: null }
    }
  } catch (err) {
    console.error('[family-update] error:', err)
    return { code: -1, message: err.message || '操作失败', data: null }
  }
}
