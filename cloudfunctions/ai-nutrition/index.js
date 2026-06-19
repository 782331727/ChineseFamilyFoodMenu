// 云函数：ai-nutrition
// AI 营养分析
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const axios = require('axios')

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-v4-pro'

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { date, days } = event

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

    // 确定分析日期范围
    const analyzeDays = days || 1
    const dates = []
    const baseDate = date ? new Date(date) : new Date()
    for (let i = 0; i < analyzeDays; i++) {
      const d = new Date(baseDate)
      d.setDate(d.getDate() - i)
      dates.push(d.toISOString().split('T')[0])
    }

    // 获取菜单
    const menuRes = await db.collection('menus')
      .where({ family_id: familyId, date: _.in(dates) })
      .get()

    // 获取菜品详情
    const dishIds = [...new Set(menuRes.data.map(m => m.dish_id))]
    let dishes = []
    if (dishIds.length > 0) {
      const dishesRes = await db.collection('dishes')
        .where({ _id: _.in(dishIds) })
        .get()
      dishes = dishesRes.data
    }

    // 获取家庭成员信息
    const membersRes = await db.collection('users').where({ family_id: familyId }).get()
    const memberInfo = membersRes.data.map(m => ({
      nickname: m.nickname,
      role: m.role,
      allergies: m.allergies || [],
      preferences: m.preferences
    }))

    const systemPrompt = `你是一个家庭营养师。请根据以下信息进行营养分析。

家庭成员：
${JSON.stringify(memberInfo)}

分析日期范围：${dates.join(' 至 ')}

菜单及菜品详情：
${JSON.stringify(dishes.map(d => ({
  name: d.name,
  cuisine: d.cuisine,
  ingredients: d.ingredients,
  nutrition_tags: d.nutrition_tags
})))}

要求：
1. 分析这几天菜单的整体营养情况（热量、蛋白质、碳水、脂肪、维生素等）
2. 评估营养均衡性
3. 针对家庭成员的口味偏好和过敏原给出建议
4. 给出改进建议

返回 JSON 格式：
{
  "overview": {
    "avg_daily_calories": "预估日均热量",
    "protein_ratio": "蛋白质占比",
    "carb_ratio": "碳水占比",
    "fat_ratio": "脂肪占比",
    "balance_score": "均衡评分(1-10)"
  },
  "nutrients": [
    {"name": "营养素", "amount": "摄入量", "status": "充足/适中/不足", "source": "主要来源菜品"}
  ],
  "suggestions": ["建议1", "建议2"],
  "warnings": ["注意事项1"],
  "summary": "总结"
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
          { role: 'user', content: '请进行营养分析。' }
        ],
        temperature: 0.6,
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
      console.error('[ai-nutrition] JSON parse error:', parseErr)
      return { code: -1, message: 'AI 返回格式异常，请重试', data: { raw: content } }
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        analysis_range: dates,
        dish_count: dishes.length,
        ...result
      }
    }
  } catch (err) {
    console.error('[ai-nutrition] error:', err)
    return { code: -1, message: err.message || '营养分析失败', data: null }
  }
}
