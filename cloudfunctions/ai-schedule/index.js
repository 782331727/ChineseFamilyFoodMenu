// 云函数：ai-schedule
// AI 智能排期，根据预定+历史排一周菜单
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const axios = require('axios')

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-v4-pro'

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { week_start } = event

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

    // 获取该周预定
    const preorderRes = await db.collection('preorders')
      .where({ family_id: familyId, target_date: _.in(weekDates) })
      .get()

    // 获取家庭成员
    const membersRes = await db.collection('users').where({ family_id: familyId }).get()

    // 获取菜品库
    const dishesRes = await db.collection('dishes').where({ family_id: familyId }).limit(100).get()

    // 获取最近烹饪历史（避免重复）
    const historyRes = await db.collection('cook_history')
      .where({ family_id: familyId })
      .orderBy('cooked_at', 'desc')
      .limit(30)
      .get()

    const recentDishIds = [...new Set(historyRes.data.map(h => h.dish_id))]

    // 组装 prompt
    const memberInfo = membersRes.data.map(m => ({
      nickname: m.nickname,
      role: m.role,
      allergies: m.allergies || [],
      preferences: m.preferences
    }))

    const dishInfo = dishesRes.data.map(d => ({
      id: d._id,
      name: d.name,
      cuisine: d.cuisine,
      difficulty: d.difficulty,
      cook_time: d.cook_time
    }))

    const preorderByDate = {}
    preorderRes.data.forEach(p => {
      if (!preorderByDate[p.target_date]) preorderByDate[p.target_date] = []
      preorderByDate[p.target_date].push(p.dish_id)
    })

    const systemPrompt = `你是一个家庭菜单排期助手。请根据以下信息排出一周（${startDate} 起7天）的每日三餐菜单。

家庭成员：${JSON.stringify(memberInfo)}

菜品库（从中选择，也可推荐新菜）：
${JSON.stringify(dishInfo)}

本周预定（日期: 菜品ID数组）：
${JSON.stringify(preorderByDate)}

最近做过多的菜（避免短期内重复）：${JSON.stringify(recentDishIds)}

要求：
1. 每天安排 breakfast / lunch / dinner 三餐
2. 预定的菜必须包含在对应日期的菜单中
3. 一周内菜品尽量不重复（除非预定）
4. 荤素搭配，营养均衡
5. 考虑家庭成员的口味偏好和过敏原

返回 JSON 格式：
{
  "schedule": [
    {
      "date": "YYYY-MM-DD",
      "meals": {
        "breakfast": {"dish_id": "已有菜品ID或空", "dish_name": "菜名", "is_new": false},
        "lunch": {"dish_id": "", "dish_name": "菜名", "is_new": false},
        "dinner": {"dish_id": "", "dish_name": "菜名", "is_new": false}
      }
    }
  ]
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
          { role: 'user', content: '请排出一周菜单。' }
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
	    let schedule
	    try {
	      let jsonStr = content.trim()
	      if (jsonStr.startsWith('```')) {
	        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
	      }
	      schedule = JSON.parse(jsonStr)
	    } catch (parseErr) {
	      console.error('[ai-schedule] JSON parse error:', parseErr)
	      // 内容安全检测：raw 文本检查后再决定是否返回
	      try {
	        const rawCheck = await cloud.openapi.security.msgSecCheck({
	          openid: OPENID, scene: 2, version: 2, content: (content || '').slice(0, 2400)
	        })
        const rawPassed = rawCheck.result && rawCheck.result.suggest === 'pass'
        if (!rawPassed) {
          return { code: -1, message: 'AI 返回内容未通过安全检测，请重试', data: null }
        }
	      } catch (e) {
	        console.error('[ai-schedule] raw msgSecCheck 失败:', e.errCode)
	        return { code: -1, message: '内容安全检查暂时不可用，请稍后重试', data: null }
	      }
	      return { code: -1, message: 'AI 返回格式异常，请重试', data: { raw: content } }
	    }

	    // 内容安全检测 v2.0：AI 生成结果展示前检查（v1.2.4 审核合规修复）
	    const dishNames = []
	    if (schedule && schedule.schedule) {
	      schedule.schedule.forEach(day => {
	        if (day.meals) {
	          ['breakfast', 'lunch', 'dinner'].forEach(meal => {
	            if (day.meals[meal] && day.meals[meal].dish_name) {
	              dishNames.push(day.meals[meal].dish_name)
	            }
	          })
	        }
	      })
	    }
	    if (dishNames.length > 0) {
	      try {
	        const checkText = dishNames.join('；').slice(0, 2400)
	        const check = await cloud.openapi.security.msgSecCheck({
	          openid: OPENID, scene: 2, version: 2, content: checkText
	        })
        const passed = check.result && check.result.suggest === 'pass'
        if (!passed) {
          return { code: -1, message: 'AI 生成的菜名未通过安全检测，请重试', data: null }
        }
	      } catch (e) {
	        console.error('[ai-schedule] msgSecCheck 失败:', e.errCode, e.message || e.errMsg)
	        return { code: -1, message: '内容安全检查暂时不可用，请稍后重试', data: null }
	      }
	    }

    return {
      code: 0,
      message: 'ok',
      data: schedule
    }
  } catch (err) {
    console.error('[ai-schedule] error:', err)
    return { code: -1, message: err.message || '排期失败', data: null }
  }
}
