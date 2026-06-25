// 原子接口：查看全家在指定日期的预定总览
async function getFamilyPreorders({ target_date } = {}) {
  try {
    const date = target_date || getTomorrowStr()
    const res = await wx.cloud.callFunction({
      name: 'preorder-list',
      data: { target_date: date }
    })
    const result = res.result
    const data = result && result.code === 0 ? result.data : null

    if (!data) {
      return {
        isError: true,
        content: [{ type: 'text', text: (result && result.message) || '查询失败，请稍后重试。' }]
      }
    }

    const preordered = (data.preordered || []).map(m => ({
      nickname: m.nickname,
      avatar: m.avatar,
      dishes: (m.preorders || []).map(p => ({
        name: (p.dish_info && p.dish_info.name) || '未知',
        note: p.note || ''
      }))
    }))
    const notPreordered = (data.not_preordered || []).map(m => ({
      nickname: m.nickname,
      avatar: m.avatar
    }))

    let summary = `${date} 预定情况：\n`
    if (preordered.length > 0) {
      summary += '已预定：\n'
      preordered.forEach(m => {
        summary += `  ${m.nickname}：${m.dishes.map(d => d.name).join('、')}\n`
      })
    }
    if (notPreordered.length > 0) {
      summary += `未预定：${notPreordered.map(m => m.nickname).join('、')}\n`
    }

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: { date, preordered, not_preordered }
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: '查询预定总览失败，请稍后重试。' }]
    }
  }
}

function getTomorrowStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

module.exports = getFamilyPreorders
