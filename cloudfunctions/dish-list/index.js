// 云函数：dish-list
// 查询菜品列表，支持搜索、分类筛选、分页
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const {
    keyword, cuisine, difficulty,
    page = 1, pageSize = 20, deleted
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

    // 构建查询条件
    const conditions = [{ family_id: user.family_id }]
    // is_deleted 过滤：deleted=true 只看已删除，否则过滤已删除
    if (deleted) {
      conditions.push({ is_deleted: true })
    } else {
      conditions.push({ is_deleted: _.neq(true) })
    }

    if (keyword) {
      conditions.push({ name: db.RegExp({ regexp: keyword, options: 'i' }) })
    }

    // cuisine 跨字段搜索：cuisine 或 nutrition_tags 任一匹配
    if (cuisine) {
      conditions.push(_.or([
        { cuisine: _.eq(cuisine) },
        { nutrition_tags: cuisine }
      ]))
    }

    if (difficulty) {
      conditions.push({ difficulty: difficulty })
    }

    const query = _.and(conditions)

    // 分页
    const skip = (page - 1) * pageSize
    const limit = Math.min(pageSize, 100)

    const [countRes, listRes] = await Promise.all([
      db.collection('dishes').where(query).count(),
      db.collection('dishes').where(query)
        .orderBy('created_at', 'desc')
        .skip(skip).limit(limit)
        
        .get()
    ])

    // 生成临时图片链接（解决云存储"仅创建者可读写"导致的跨用户无法查看图片）
    const imageFileIDs = []
    listRes.data.forEach(dish => {
      if (dish.image_url && dish.image_url.startsWith('cloud://')) imageFileIDs.push(dish.image_url)
      if (dish.image && dish.image.startsWith('cloud://')) imageFileIDs.push(dish.image)
      if (dish.image_urls && Array.isArray(dish.image_urls)) {
        dish.image_urls.forEach(url => { if (url && url.startsWith('cloud://')) imageFileIDs.push(url) })
      }
    })
    if (imageFileIDs.length > 0) {
      try {
        const tmpRes = await cloud.getTempFileURL({ fileList: [...new Set(imageFileIDs)] })
        const urlMap = {}
        tmpRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
        listRes.data.forEach(dish => {
          if (dish.image_url && urlMap[dish.image_url]) dish.image_url = urlMap[dish.image_url]
          if (dish.image && urlMap[dish.image]) dish.image = urlMap[dish.image]
          if (dish.image_urls && Array.isArray(dish.image_urls)) {
            dish.image_urls = dish.image_urls.map(url => urlMap[url] || url)
          }
        })
      } catch (e) {
        console.warn('[dish-list] getTempFileURL failed, continuing without temp URLs:', e.message)
      }
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        list: listRes.data,
        total: countRes.total,
        page: Number(page),
        pageSize: limit,
        hasMore: skip + listRes.data.length < countRes.total
      }
    }
  } catch (err) {
    console.error('[dish-list] error:', err)
    return { code: -1, message: err.message || '查询菜品失败', data: null }
  }
}
