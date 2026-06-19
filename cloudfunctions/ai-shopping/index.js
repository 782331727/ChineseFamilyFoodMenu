// 云函数：ai-shopping
// AI 生成采购清单，菜单减去冰箱库存
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const axios = require('axios')

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { week_start, inventory } = event

  try {
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在，请先登录', data: null }
    }
    const user = userRes.data[0]

    if (!user.family_id) {
      return { code: -1, message: '您未加入任何家庭', data: null }
    }

    const familyId = user.family_id

    // 计算一周日期范围
    const startDate = week_start || new Date().toISOString().split('T')[0]
    const weekDates = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate)
      d.setDate(d.getDate() + i)
      weekDates.push(d.toISOString().split('T')[0])
    }

    // 获取该周菜单
    const menuRes = await db.collection('menus')
      .where({ family_id: familyId, date: _.in(weekDates) })
      .get()

    // 同时获取该周预定的菜品（补充 menus 可能未覆盖的）
    const preorderRes = await db.collection('preorders')
      .where({ family_id: familyId, target_date: _.in(weekDates) })
      .get()

    // 合并 menus + preorders 中的菜品ID，去重
    const menuDishIds = menuRes.data.map(m => m.dish_id)
    const preorderDishIds = preorderRes.data.map(p => p.dish_id)
    const dishIds = [...new Set([...menuDishIds, ...preorderDishIds])]
    let allIngredients = []
    if (dishIds.length > 0) {
      const dishesRes = await db.collection('dishes')
        .where({ _id: _.in(dishIds) })
        .get()
      dishesRes.data.forEach(d => {
        if (d.ingredients) {
          allIngredients.push(...d.ingredients)
        }
      })
    }

    // 冰箱库存（用户传入或空）
    const fridgeInventory = inventory || []

    const systemPrompt = `你是一个家庭采购清单助手。根据以下信息生成一周采购清单。

一周菜单所需食材：
${JSON.stringify(allIngredients)}

冰箱现有库存：
${JSON.stringify(fridgeInventory)}

要求：
1. 用菜单所需食材减去冰箱库存，得出需要采购的清单
2. 合并同类食材，汇总用量
3. 按类别分组（蔬菜、肉类、海鲜、调料、主食、其他）
4. 估算大致费用

返回 JSON 格式：
{
  "items": [
    {"name": "食材名", "amount": "用量", "category": "分类", "estimated_price": "价格"}
  ],
  "total_estimated_cost": "总估价",
  "summary": "采购建议"
}
只返回JSON，不要其他文字。`

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return { code: -1, message: 'AI 服务未配置', data: null }
    }

    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '请生成采购清单。' }
        ],
        temperature: 0.5,
        max_tokens: 4096
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 30000
      }
    )

    const content = response.data.choices[0].message.content
    let result
    try {
      let jsonStr = content.trim()
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      result = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('[ai-shopping] JSON parse error:', parseErr)
      return { code: -1, message: 'AI 返回格式异常，请重试', data: { raw: content } }
    }

    return {
      code: 0,
      message: 'ok',
      data: result
    }
  } catch (err) {
    console.error('[ai-shopping] error:', err)
    return { code: -1, message: err.message || '生成采购清单失败', data: null }
  }
}
