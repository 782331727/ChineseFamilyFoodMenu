// 原子接口：查询菜品列表
async function getDishList({ cuisine, difficulty, keyword } = {}) {
  try {
    const params = { page: 1, pageSize: 50 }
    if (cuisine) params.cuisine = cuisine
    if (difficulty) params.difficulty = difficulty
    if (keyword) params.keyword = keyword

    const res = await wx.cloud.callFunction({
      name: 'dish-list',
      data: params
    })
    const data = res.result && res.result.code === 0 ? res.result.data : null
    const list = (data && data.list) || []

    return {
      content: [{ type: 'text', text: `查询到 ${list.length} 道菜品。` }],
      structuredContent: { list: list.map(d => ({
        _id: d._id,
        name: d.name,
        image: d.image || d.image_url || '',
        category: d.cuisine || d.category || '家常',
        difficulty: d.difficulty || 'easy',
        cookTime: d.cook_time || d.cookTime || 30
      })) }
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: '查询菜品列表失败，请稍后重试。' }]
    }
  }
}

module.exports = getDishList
