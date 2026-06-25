// 原子接口：查询今日/指定日期的菜单安排
async function getTodayMenu({ date } = {}) {
  try {
    const targetDate = date || getDateStr()
    const res = await wx.cloud.callFunction({
      name: 'menu-manage',
      data: { action: 'query', date: targetDate }
    })
    const data = res.result && res.result.code === 0 ? res.result.data : null
    const meals = (data && data.menus) || []

    return {
      content: [{ type: 'text', text: `查询到 ${targetDate} 的菜单共有 ${meals.length} 道菜品。` }],
      structuredContent: { date: targetDate, meals }
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: '查询菜单失败，请稍后重试。' }]
    }
  }
}

function getDateStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

module.exports = getTodayMenu
