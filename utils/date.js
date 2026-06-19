// utils/date.js — 日期处理工具

/**
 * 格式化日期为 YYYY-MM-DD
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date = new Date()) {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 格式化日期带星期
 * @param {Date} date
 * @returns {string} 如 "6月18日 周三"
 */
function formatDateWithWeek(date = new Date()) {
  const d = new Date(date)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${month}月${day}日 ${weekDays[d.getDay()]}`
}

/**
 * 获取明天的日期
 * @returns {Date}
 */
function getTomorrow() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow
}

/**
 * 获取明天的日期字符串
 * @returns {string} YYYY-MM-DD
 */
function getTomorrowStr() {
  return formatDate(getTomorrow())
}

/**
 * 获取今天的日期字符串
 * @returns {string} YYYY-MM-DD
 */
function getTodayStr() {
  return formatDate(new Date())
}

/**
 * 获取未来 N 天的日期数组
 * @param {number} n
 * @returns {Array<{date: string, label: string}>}
 */
function getFutureDays(n = 7) {
  const result = []
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  for (let i = 0; i < n; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    result.push({
      date: formatDate(d),
      label: i === 0 ? '今天' : i === 1 ? '明天' : `${d.getMonth() + 1}月${d.getDate()}日`,
      week: weekDays[d.getDay()],
      timestamp: d.getTime()
    })
  }
  return result
}

/**
 * 获取时分
 * @param {Date} date
 * @returns {string} HH:mm
 */
function formatTime(date = new Date()) {
  const d = new Date(date)
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

/**
 * 判断是否是同一天
 * @param {Date|string} d1
 * @param {Date|string} d2
 * @returns {boolean}
 */
function isSameDay(d1, d2) {
  const date1 = new Date(d1)
  const date2 = new Date(d2)
  return date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
}

/**
 * 餐次判断：根据当前时间返回早/中/晚
 * @returns {string} morning / noon / evening
 */
function getCurrentMealType() {
  const hour = new Date().getHours()
  if (hour < 10) return 'morning'
  if (hour < 14) return 'noon'
  return 'evening'
}

/**
 * 餐次中文
 * @param {string} type
 * @returns {string}
 */
function mealTypeText(type) {
  const map = {
    morning: '早餐',
    noon: '午餐',
    evening: '晚餐'
  }
  return map[type] || type
}

module.exports = {
  formatDate,
  formatDateWithWeek,
  getTomorrow,
  getTomorrowStr,
  getTodayStr,
  getFutureDays,
  formatTime,
  isSameDay,
  getCurrentMealType,
  mealTypeText
}
