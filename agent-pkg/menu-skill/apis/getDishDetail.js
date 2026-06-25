// 原子接口：获取菜品详情
async function getDishDetail({ dishId } = {}) {
  if (!dishId) {
    return {
      isError: true,
      content: [{ type: 'text', text: '请提供菜品ID。' }]
    }
  }
  try {
    const res = await wx.cloud.callFunction({
      name: 'dish-detail',
      data: { dish_id: dishId }
    })
    const data = res.result && res.result.code === 0 ? res.result.data : null
    if (!data) {
      return {
        isError: true,
        content: [{ type: 'text', text: '未找到该菜品。' }]
      }
    }

    const dish = {
      _id: data._id,
      name: data.name,
      image: data.image || data.image_url || '',
      category: data.cuisine || data.category || '家常',
      difficulty: data.difficulty || 'easy',
      cookTime: data.cook_time || data.cookTime || 30,
      ingredients: (data.ingredients || []).map(i => ({
        name: i.name,
        amount: i.amount
      })),
      steps: (data.steps || []).map(s => ({
        step: s.step || s.description || '',
        image: s.image || ''
      })),
      tags: data.nutrition_tags || data.tags || []
    }

    const ingredientText = dish.ingredients.map(i => `${i.name}${i.amount ? ' ' + i.amount : ''}`).join('、')
    const stepText = dish.steps.map((s, i) => `步骤${i + 1}: ${s.step}`).join('\n')

    return {
      content: [{ type: 'text', text: `【${dish.name}】\n分类：${dish.category}\n难度：${dish.difficulty}\n烹饪时间：${dish.cookTime}分钟\n\n食材：${ingredientText}\n\n步骤：\n${stepText}` }],
      structuredContent: dish
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: '查询菜品详情失败，请稍后重试。' }]
    }
  }
}

module.exports = getDishDetail
