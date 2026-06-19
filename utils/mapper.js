// utils/mapper.js — 云函数数据字段映射
// 云函数统一使用下划线风格（nickname / avatar / invite_code / created_at），
// 前端页面与模板使用驼峰风格（nickName / avatarUrl / inviteCode / joinDate）。
// 本模块负责两层之间的转换，集中维护，避免散落在各页面。

/**
 * 把下划线字符串转驼峰
 * invite_code -> inviteCode ; created_at -> createdAt
 */
function toCamel(s) {
  return String(s).replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/**
 * 把驼峰字符串转下划线
 * inviteCode -> invite_code ; cookTime -> cook_time
 */
function toSnake(s) {
  return String(s).replace(/([A-Z])/g, c => '_' + c.toLowerCase()).replace(/^_/, '')
}

/**
 * 递归把对象所有 key 转为驼峰（数组逐项处理）
 * 用于把云函数返回的 data 映射成前端期望的结构
 */
function camelize(obj) {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(camelize)
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const result = {}
    Object.keys(obj).forEach(key => {
      result[toCamel(key)] = camelize(obj[key])
    })
    return result
  }
  return obj
}

/**
 * 用户对象映射：云函数 user -> 前端 userInfo
 * 同时把 preferences(taste) / allergies(avoidList) 的语义对齐
 */
function mapUser(user) {
  if (!user) return null
  const preferences = user.preferences || {}
  return {
    openid: user.openid,
    _id: user._id,
    nickName: user.nickname || user.nickName || '微信用户',
    avatarUrl: user.avatar || user.avatarUrl || '',
    role: user.role || 'eater',
    familyId: user.family_id || user.familyId || '',
    taste: {
      spicy: preferences.spicy !== undefined ? preferences.spicy : 3,
      sweet: preferences.sweet !== undefined ? preferences.sweet : 3,
      sour: preferences.sour !== undefined ? preferences.sour : 3,
      salty: preferences.salty !== undefined ? preferences.salty : 3
    },
    avoidList: user.allergies || user.avoidList || [],
    joinDate: formatDate(user.created_at || user.createdAt)
  }
}

/**
 * 家庭对象映射：云函数 family -> 前端 familyInfo
 */
function mapFamily(family) {
  if (!family) return null
  return {
    _id: family._id,
    name: family.name || '我的家庭',
    inviteCode: family.invite_code || family.inviteCode || '',
    createTime: family.created_at || family.createdAt
  }
}

/**
 * 菜品对象映射：云函数 dish -> 前端 dish
 * 对齐 cuisine<->category, image_url<->image, cook_time<->cookTime
 */
function mapDish(dish) {
  if (!dish) return null
  return {
    _id: dish._id,
    name: dish.name,
    image: dish.image_url || dish.image || '',
    category: dish.cuisine || dish.category || '家常',
    difficulty: dish.difficulty || 'easy',
    cookTime: dish.cook_time !== undefined ? dish.cook_time : (dish.cookTime || 30),
    ingredients: dish.ingredients || [],
    steps: dish.steps || [],
    tags: dish.nutrition_tags || dish.tags || [],
    source: dish.source || 'manual',
    familyId: dish.family_id || dish.familyId,
    isPublic: dish.is_public !== undefined ? dish.is_public : false
  }
}

/**
 * 把前端菜品的驼峰字段转成 dish-add 云函数需要的下划线参数
 */
function dishToCloud(form) {
  return {
    name: form.name,
    image_url: form.image || '',
    cuisine: form.category || form.cuisine || '家常',
    difficulty: form.difficulty || '简单',
    cook_time: parseInt(form.cookTime) || 30,
    ingredients: form.ingredients || [],
    steps: form.steps || [],
    nutrition_tags: form.tags || [],
    is_public: form.isPublic || false
  }
}

/**
 * 餐次类型映射：前端 morning/noon/evening <-> 云函数 breakfast/lunch/dinner
 */
const MEAL_TO_CLOUD = { morning: 'breakfast', noon: 'lunch', evening: 'dinner' }
const MEAL_TO_FRONT = { breakfast: 'morning', lunch: 'noon', dinner: 'evening' }

function mealToCloud(meal) {
  return MEAL_TO_CLOUD[meal] || meal
}

function mealToFront(meal) {
  return MEAL_TO_FRONT[meal] || meal
}

/**
 * 简单日期格式化（供 joinDate 等使用）
 */
function formatDate(d) {
  if (!d) return ''
  const date = new Date(d)
  if (isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

module.exports = {
  toCamel,
  toSnake,
  camelize,
  mapUser,
  mapFamily,
  mapDish,
  dishToCloud,
  mealToCloud,
  mealToFront,
  formatDate
}
