// 云函数：profile-manage
// 用户个人资料管理
// actions:
//   get_profile       - 获取个人资料（口味偏好、忌口）
//   update_user_info  - 更新昵称、头像
//   update_taste      - 更新口味偏好（spicy/sweet/sour/salty，0-5）
//   update_avoid_list - 更新忌口列表
//   get_my_stats      - 获取个人统计（添加菜品数、做菜次数、预定次数）
//   submit_feedback   - 提交意见反馈（含内容安全检测）

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, nickname, avatar, taste, avoidList } = event

  try {
    // 查询调用者
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在，请先登录', data: null }
    }
    const user = userRes.data[0]

    switch (action) {
      case 'get_profile': {
        // 返回完整个人信息：角色、口味、忌口、昵称、头像、家庭
        const preferences = user.preferences || {}
        const allergies = user.allergies || []
        return {
          code: 0,
          message: 'ok',
          data: {
            openid: user.openid,
            nickname: user.nickname || '微信用户',
            avatar: user.avatar || '',
            role: user.role || 'eater',
            family_id: user.family_id || '',
            taste: {
              spicy: preferences.spicy !== undefined ? preferences.spicy : 3,
              sweet: preferences.sweet !== undefined ? preferences.sweet : 3,
              sour: preferences.sour !== undefined ? preferences.sour : 3,
              salty: preferences.salty !== undefined ? preferences.salty : 3
            },
            avoidList: allergies
          }
        }
      }

      case 'update_user_info': {
        const updateData = {}
        if (nickname) {
          // 内容安全检测 v2.0：昵称使用 scene=1（资料场景）
          try {
            const check = await cloud.openapi.security.msgSecCheck({
              openid: OPENID,      // 必填：当前用户 openid
              scene: 1,            // 必填：1=资料
              version: 2,          // 必填：2.0 接口
              content: nickname    // 必填：待检测文本
            })
            const passed = check.result && check.result.suggest === 'pass'
            if (!passed) {
              return { code: -1, message: '昵称违规，请修改', data: null }
            }
          } catch (e) {
            // fail-close：安全检查异常时拒绝提交
            console.error('[profile-manage] msgSecCheck v2.0 调用失败:', e.errCode, e.message || e.errMsg)
            return { code: -1, message: '内容安全检查暂时不可用，请稍后重试', data: null }
          }
          updateData.nickname = nickname
        }
        if (avatar) {
          // 图片安全检测：下载头像并调用 imgSecCheck
          if (avatar.startsWith('cloud://')) {
            try {
              const downloadRes = await cloud.downloadFile({ fileID: avatar })
              const checkRes = await cloud.openapi.security.imgSecCheck({
                media: { contentType: 'image/jpeg', value: downloadRes.fileContent }
              })
              if (checkRes.errCode !== 0) {
                return { code: -1, message: '头像包含违规内容，请更换', data: null }
              }
	            } catch (e) {
	              const errCode = e.errCode || 0
	              console.error('[profile-manage] imgSecCheck 失败:', errCode, e.message || e.errMsg)
	              // 87014: 图片内容违规（API 以此错误码抛异常，非正常返回）
	              if (errCode === 87014) {
	                return { code: -1, message: '头像包含违规内容，请更换', data: null }
	              }
	              return { code: -1, message: '头像安全检查暂时不可用，请稍后重试', data: null }
	            }
          }
          updateData.avatar = avatar
        }
        if (Object.keys(updateData).length === 0) {
          return { code: -1, message: '没有需要更新的字段', data: null }
        }
        await db.collection('users').doc(user._id).update({ data: updateData })
        return { code: 0, message: '信息更新成功', data: null }
      }

      case 'update_taste': {
        // 更新口味偏好
        if (!taste || typeof taste !== 'object') {
          return { code: -1, message: '无效的口味数据', data: null }
        }
        const preferences = {}
        if (taste.spicy !== undefined) preferences.spicy = Number(taste.spicy)
        if (taste.sweet !== undefined) preferences.sweet = Number(taste.sweet)
        if (taste.sour !== undefined) preferences.sour = Number(taste.sour)
        if (taste.salty !== undefined) preferences.salty = Number(taste.salty)
        await db.collection('users').doc(user._id).update({
          data: { preferences }
        })
        return { code: 0, message: '口味偏好更新成功', data: null }
      }

      case 'update_avoid_list': {
        // 更新忌口列表
        if (!Array.isArray(avoidList)) {
          return { code: -1, message: '忌口列表格式错误', data: null }
        }
	        // 内容安全检测：逐项检查忌口文本（fail-closed：缺 result 也拒绝）
	        for (const item of avoidList) {
	          if (item && typeof item === 'string') {
	            try {
	              const check = await cloud.openapi.security.msgSecCheck({
	                openid: OPENID, scene: 1, version: 2, content: item
	              })
	              const passed = check.result && check.result.suggest === 'pass'
	              if (!passed) {
	                console.warn('[profile-manage] avoidList 内容未通过安全检测:', item, JSON.stringify(check.result || {}))
	                return { code: -1, message: '忌口内容违规，请修改', data: null }
	              }
	            } catch (e) {
	              console.error('[profile-manage] msgSecCheck avoidList 失败:', e.errCode, e.message || e.errMsg)
	              return { code: -1, message: '内容安全检查暂时不可用，请稍后重试', data: null }
	            }
          }
        }
        await db.collection('users').doc(user._id).update({
          data: { allergies: avoidList }
        })
        return { code: 0, message: '忌口列表更新成功', data: null }
      }

      case 'get_my_stats': {
        if (!user.family_id) {
          return { code: 0, message: 'ok', data: { dishCount: 0, cookCount: 0, preorderCount: 0 } }
        }

        const familyId = user.family_id

        // 统计添加的菜品数（排除已删除）
        const dishCountRes = await db.collection('dishes')
          .where({ family_id: familyId, is_deleted: _.neq(true) })
          .count()

        // 统计做菜次数（cook_history 中 cook_id 匹配）
        const cookCountRes = await db.collection('cook_history')
          .where({ family_id: familyId, cook_id: user._id })
          .count()

        // 统计预定次数
        const preorderCountRes = await db.collection('preorders')
          .where({ family_id: familyId, user_id: user._id })
          .count()

        return {
          code: 0,
          message: 'ok',
          data: {
            dishCount: dishCountRes.total,
            cookCount: cookCountRes.total,
            preorderCount: preorderCountRes.total
          }
        }
	      }

	      case 'submit_feedback': {
	        const { content } = event
	        if (!content || !content.trim()) {
	          return { code: -1, message: '反馈内容不能为空', data: null }
	        }
	        const text = content.trim()
	        if (text.length < 2) {
	          return { code: -1, message: '反馈内容太短', data: null }
	        }

	        // 内容安全检测 v2.0（fail-closed：缺 result 也拒绝）
	        try {
	          const check = await cloud.openapi.security.msgSecCheck({
	            openid: OPENID, scene: 2, version: 2, content: text
	          })
	          const passed = check.result && check.result.suggest === 'pass'
	          if (!passed) {
	            console.warn('[profile-manage] feedback 内容未通过安全检测:', JSON.stringify(check.result || {}))
	            return { code: -1, message: '反馈内容违规，请修改后提交', data: null }
	          }
	        } catch (e) {
	          const errCode = e.errCode || 0
	          console.error('[profile-manage] feedback msgSecCheck 失败:', errCode, e.message || e.errMsg)
	          // -604101: 权限未配置，permission 传播中 → 安全优先仍拒绝
	          return { code: -1, message: '反馈内容违规，请修改后提交', data: null }
	        }

	        // 存储反馈
	        try {
	          const res = await db.collection('feedback').add({
	            data: {
	              openid: OPENID,
	              content: text,
	              nickname: user.nickname || '匿名用户',
	              created_at: new Date()
	            }
	          })
	          return { code: 0, message: '感谢您的反馈！', data: { _id: res._id } }
	        } catch (err) {
	          const dbErrCode = err.errCode || 0
	          console.error('[profile-manage] feedback DB error:', dbErrCode, err.message || err.errMsg)
	          // -502005: 集合不存在 → 首次使用需在控制台创建 feedback 集合
	          if (dbErrCode === -502005) {
	            return { code: -1, message: '反馈功能初始化中，请稍后重试', data: null }
	          }
	          return { code: -1, message: '提交失败，请稍后重试', data: null }
	        }
	      }

	      default:
        return { code: -1, message: '未知操作类型', data: null }
    }
  } catch (err) {
    console.error('[profile-manage] error:', err)
    return { code: -1, message: err.message || '操作失败', data: null }
  }
}
