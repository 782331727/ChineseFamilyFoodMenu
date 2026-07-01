// 云函数：login
// 微信登录，获取 openid，查询或创建用户记录，返回用户信息+家庭信息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { nickname, avatar } = event

  try {
	    // 内容安全检测：昵称（创建/更新前检查）
	    if (nickname && nickname !== '微信用户') {
	      try {
	        const check = await cloud.openapi.security.msgSecCheck({
	          openid: OPENID, scene: 1, version: 2, content: nickname
	        })
        const passed = check.result && check.result.suggest === 'pass'
        if (!passed) {
          return { code: -1, message: '昵称违规，请修改', data: null }
        }
	      } catch (e) {
	        console.error('[login] msgSecCheck 失败:', e.errCode, e.message || e.errMsg)
	        return { code: -1, message: '内容安全检查暂时不可用，请稍后重试', data: null }
	      }
	    }
	    // 内容安全检测：头像图片（v1.2.4 审核合规修复）
	    if (avatar && avatar.startsWith('cloud://')) {
	      try {
	        const downloadRes = await cloud.downloadFile({ fileID: avatar })
	        const imgCheck = await cloud.openapi.security.imgSecCheck({
	          media: { contentType: 'image/jpeg', value: downloadRes.fileContent }
	        })
	        if (imgCheck.errCode !== 0) {
	          console.warn('[login] 头像图片违规，拒绝上传:', imgCheck.errCode)
	          return { code: -1, message: '头像包含违规内容，请更换', data: null }
	        }
		      } catch (e) {
		        const errCode = e.errCode || 0
		        console.error('[login] imgSecCheck 失败:', errCode, e.message || e.errMsg)
		        if (errCode === 87014) {
		          return { code: -1, message: '头像包含违规内容，请更换', data: null }
		        }
		        return { code: -1, message: '头像安全检查暂时不可用，请稍后重试', data: null }
		      }
	    }
    // 查询用户是否已存在
    const userRes = await db.collection('users').where({ openid: OPENID }).get()

    let user
    if (userRes.data.length > 0) {
      // 用户已存在：仅当传入有意义的昵称/头像时才更新，不覆盖已有自定义值
      user = userRes.data[0]
      const updateData = {}
      if (nickname && nickname !== '微信用户') updateData.nickname = nickname
      if (avatar && avatar.startsWith('cloud://')) updateData.avatar = avatar
      if (Object.keys(updateData).length > 0) {
        await db.collection('users').doc(user._id).update({ data: updateData })
        user = { ...user, ...updateData }
      }
    } else {
      // 新用户，创建记录
      const newUser = {
        openid: OPENID,
        nickname: nickname || '微信用户',
        avatar: avatar || '',
        family_id: '',
        role: '',
        preferences: {
          spicy: 3,
          sweet: 3,
          sour: 3,
          salty: 3
        },
        allergies: [],
        created_at: new Date()
      }
      const addRes = await db.collection('users').add({ data: newUser })
      user = { _id: addRes._id, ...newUser }
    }

    // 如果用户已加入家庭，查询家庭信息
    let family = null
    if (user.family_id) {
      const familyRes = await db.collection('families').doc(user.family_id).get()
      family = familyRes.data
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        user,
        family
      }
    }
  } catch (err) {
    console.error('[login] error:', err)
    return {
      code: -1,
      message: err.message || '登录失败',
      data: null
    }
  }
}
