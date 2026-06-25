// 原子接口：新增菜品预定
async function addPreorder({ target_date, dish_id, meal_type, note } = {}) {
  if (!target_date || !dish_id) {
    return {
      isError: true,
      content: [{ type: 'text', text: '请提供预定日期和菜品ID。' }]
    }
  }
  try {
    const res = await wx.cloud.callFunction({
      name: 'preorder-add',
      data: { target_date, dish_id, meal_type: meal_type || 'lunch', note: note || '' }
    })
    const result = res.result
    if (result && result.code === 0) {
      return {
        content: [{ type: 'text', text: result.message || '预定成功！' }],
        structuredContent: { _id: result.data && result.data._id }
      }
    } else {
      return {
        isError: true,
        content: [{ type: 'text', text: (result && result.message) || '预定失败，请稍后重试。' }]
      }
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: '预定失败，请检查网络后重试。' }]
    }
  }
}

module.exports = addPreorder
