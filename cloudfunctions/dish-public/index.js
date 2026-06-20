// 云函数：dish-public
// 查询所有公开菜品（跨家庭，无需登录）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { keyword, cuisine, difficulty, page = 1, pageSize = 20 } = event

  try {
    const conditions = [{ is_public: true }, { is_deleted: _.neq(true) }]

    if (keyword) {
      conditions.push(_.or([
        { name: db.RegExp({ regexp: keyword, options: 'i' }) },
        { cuisine: db.RegExp({ regexp: keyword, options: 'i' }) }
      ]))
    }
    if (cuisine) {
      conditions.push(_.or([
        { cuisine: cuisine },
        { nutrition_tags: cuisine }
      ]))
    }
    if (difficulty) {
      conditions.push({ difficulty: difficulty })
    }

    const where = _.and(conditions)
    const skip = (page - 1) * pageSize
    const limit = Math.min(pageSize, 50)

    const [countRes, listRes] = await Promise.all([
      db.collection('dishes').where(where).count(),
      db.collection('dishes').where(where).orderBy('created_at', 'desc').skip(skip).limit(limit).get()
    ])

    // 生成临时图片链接（公开菜品对所有用户可见）
    const imageFileIDs = []
    listRes.data.forEach(dish => {
      if (dish.image_url && dish.image_url.startsWith('cloud://')) imageFileIDs.push(dish.image_url)
      if (dish.image_urls && Array.isArray(dish.image_urls)) {
        dish.image_urls.forEach(url => { if (url && url.startsWith('cloud://')) imageFileIDs.push(url) })
      }
    })
    if (imageFileIDs.length > 0) {
      const tmpRes = await cloud.getTempFileURL({ fileList: imageFileIDs })
      const urlMap = {}
      tmpRes.fileList.forEach(f => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      listRes.data.forEach(dish => {
        if (dish.image_url && urlMap[dish.image_url]) dish.image_url = urlMap[dish.image_url]
        if (dish.image_urls && Array.isArray(dish.image_urls)) {
          dish.image_urls = dish.image_urls.map(url => urlMap[url] || url)
        }
      })
    }

    return {
      code: 0, message: 'ok',
      data: {
        list: listRes.data,
        total: countRes.total,
        page: Number(page),
        pageSize: limit,
        hasMore: skip + listRes.data.length < countRes.total
      }
    }
  } catch (err) {
    console.error('[dish-public] error:', err)
    return { code: -1, message: err.message || '查询失败', data: null }
  }
}
