// 云函数：ai-generate
// 调用 DeepSeek 生成智能菜品推荐
// 考虑：近期历史、节气时令、口味偏好、忌口、人数、已有食材
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const axios = require('axios')

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

// 24 节气映射（公历近似日期，每年可能差1-2天，足够推荐用）
const SOLAR_TERMS = [
  { name: '小寒', m: 1, d: 5 }, { name: '大寒', m: 1, d: 20 },
  { name: '立春', m: 2, d: 4 }, { name: '雨水', m: 2, d: 19 },
  { name: '惊蛰', m: 3, d: 5 }, { name: '春分', m: 3, d: 20 },
  { name: '清明', m: 4, d: 5 }, { name: '谷雨', m: 4, d: 20 },
  { name: '立夏', m: 5, d: 5 }, { name: '小满', m: 5, d: 21 },
  { name: '芒种', m: 6, d: 5 }, { name: '夏至', m: 6, d: 21 },
  { name: '小暑', m: 7, d: 7 }, { name: '大暑', m: 7, d: 22 },
  { name: '立秋', m: 8, d: 7 }, { name: '处暑', m: 8, d: 23 },
  { name: '白露', m: 9, d: 7 }, { name: '秋分', m: 9, d: 23 },
  { name: '寒露', m: 10, d: 8 }, { name: '霜降', m: 10, d: 23 },
  { name: '立冬', m: 11, d: 7 }, { name: '小雪', m: 11, d: 22 },
  { name: '大雪', m: 12, d: 7 }, { name: '冬至', m: 12, d: 22 }
]

function getSolarTerm() {
  const now = new Date()
  const m = now.getMonth() + 1
  const d = now.getDate()
  // 从后往前找最近的节气
  for (let i = SOLAR_TERMS.length - 1; i >= 0; i--) {
    const t = SOLAR_TERMS[i]
    if (m > t.m || (m === t.m && d >= t.d)) return t.name
  }
  return SOLAR_TERMS[SOLAR_TERMS.length - 1].name
}

function getSeasonHint() {
  const m = new Date().getMonth() + 1
  if (m >= 3 && m <= 5) return '春季，气温回暖，宜食清淡生发之物如春笋、韭菜、菠菜'
  if (m >= 6 && m <= 8) return '夏季，天气炎热，宜食清热解暑之物如苦瓜、冬瓜、绿豆'
  if (m >= 9 && m <= 11) return '秋季，气候干燥，宜食滋阴润燥之物如梨、百合、银耳'
  return '冬季，天气寒冷，宜食温补暖身之物如羊肉、萝卜、红枣'
}

function buildSystemPrompt(params) {
  const { members, scene, seasonHint, term, ingredients, recentDishes, crowd, budget, equipment, meal } = params
  const mealHint = meal && meal !== 'all'
    ? `**指定餐次**：${meal === 'breakfast' ? '早餐（推荐清淡、快捷、营养的粥、面点、蛋奶类）' : meal === 'lunch' ? '午餐（推荐丰盛、能量充足的主食+荤素搭配）' : '晚餐（推荐易消化、不过于油腻的菜品）'}`
    : ''

  return `你是一个家庭美食顾问。请根据以下贴心信息推荐 3-5 道菜品，荤素搭配、营养均衡。

**家庭成员与口味**：
${members}

**用餐场景**：${scene || '日常用餐'}
${mealHint}
**当前节气与时令**：${term || ''}，${seasonHint || ''}
**用餐人数**：${crowd || '4人'}
**已有食材**（优先消耗）：${ingredients || '无特别指定'}
**预算偏好**：${budget || '经济实惠'}
**烹饪设备**：${equipment || '普通厨房设备'}

**近期已吃过的菜**（严格避免重复！）：
${recentDishes || '（无历史记录）'}

**重要规则**：
1. 绝不推荐近期已出现的菜品，如必须同类则做法要明显不同
2. 根据指定餐次特点推荐合适的菜品类型和分量
3. 根据节气时令推荐应季食材
4. 考虑每位家庭成员的忌口（allergies），碰了忌口的菜不要推荐
5. 尊重口味偏好，辣度/甜度等按 preferences 调整
6. 优先消耗已有食材
7. 荤素搭配，至少 1 道纯素菜

返回 JSON 数组，每道菜包含：
{"name":"菜名","cuisine":"菜系","difficulty":"简单/中等/较难","cook_time":分钟,"ingredients":[{"name":"食材","amount":"用量"}],"steps":["步骤"],"nutrition_tags":["高蛋白","低脂","快手","家常","硬菜","汤","清淡"],"suitable_for":["适合成员"],"tips":"烹饪贴士","image_suggestion":"视觉描述"}

只返回JSON，不要其他文字。`
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { scene, ingredients, members: crowdHint, season, budget, equipment, meal } = event

  try {
    const db = cloud.database()
    const _ = db.command

    // 查询用户
    const userRes = await db.collection('users').where({ openid: OPENID }).get()
    if (userRes.data.length === 0) {
      return { code: -1, message: '用户不存在，请先登录', data: null }
    }
    const user = userRes.data[0]
    if (!user.family_id) {
      return { code: -1, message: '您未加入任何家庭', data: null }
    }
    const familyId = user.family_id

    // 家庭成员信息（口味、忌口）
    const membersRes = await db.collection('users').where({ family_id: familyId }).get()
    const familyMembers = membersRes.data.map(m => ({
      nickname: m.nickname || '成员',
      role: m.role,
      preferences: m.preferences || {},
      allergies: m.allergies || []
    }))
    const membersInfo = JSON.stringify(familyMembers)

    // 近期菜品（过去3天菜单 + 预定，减少查询量加速响应）
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    const recentDates = []
    for (let i = 0; i < 3; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      recentDates.push(d.toISOString().split('T')[0])
    }

    const [menuRes, preorderRes] = await Promise.all([
      db.collection('menus').where({ family_id: familyId, date: _.in(recentDates) }).field({ dish_id: true }).get(),
      db.collection('preorders').where({ family_id: familyId, target_date: _.in(recentDates) }).field({ dish_id: true }).get()
    ])

    const recentDishIds = [...new Set([
      ...menuRes.data.map(m => m.dish_id),
      ...preorderRes.data.map(p => p.dish_id)
    ])]
    let recentDishesText = ''
    if (recentDishIds.length > 0) {
      const dishesRes = await db.collection('dishes').where({ _id: _.in(recentDishIds) }).field({ name: true }).limit(50).get()
      recentDishesText = dishesRes.data.map(d => d.name).join('、')
    }

    // 节气与季节
    const term = getSolarTerm()
    const seasonHint = getSeasonHint()

    // 人数
    const crowd = crowdHint || `${familyMembers.length}人`

    const systemPrompt = buildSystemPrompt({
      members: membersInfo, scene, seasonHint, term, ingredients,
      recentDishes: recentDishesText, crowd, budget, equipment, meal
    })

    // 调用 DeepSeek
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return { code: -1, message: 'AI 服务未配置，请联系管理员', data: null }
    }

    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '请根据以上信息推荐菜品。' }
        ],
        temperature: 0.6,
        max_tokens: 4096
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 110000
      }
    )

    const content = response.data.choices[0].message.content

    // 解析 JSON
    let dishes
    try {
      let jsonStr = content.trim()
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      dishes = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('[ai-generate] JSON parse error:', parseErr)
      console.log('[ai-generate] raw content:', content)
      return { code: -1, message: 'AI 返回格式异常，请重试', data: { raw: content } }
    }

	    if (!Array.isArray(dishes)) dishes = [dishes]

	    // 内容安全检测 v2.0：AI 生成结果展示前检查（v1.2.4 审核合规修复）
	    // 对每道 AI 生成的菜品做文本安全检测，违规内容不返回给前端展示
	    const safeDishes = []
	    for (const dish of dishes) {
	      try {
	        const textToCheck = [
	          dish.name || '',
	          ...(dish.steps || []).slice(0, 3),  // 只取前3步，控制长度在2500字以内
	          dish.tips || ''
	        ].filter(Boolean).join('；').slice(0, 2400)  // 截断留余量
	        
	        if (textToCheck.length > 0) {
	          const check = await cloud.openapi.security.msgSecCheck({
	            openid: OPENID, scene: 2, version: 2, content: textToCheck
	          })
          const passed = check.result && check.result.suggest === 'pass'
          if (!passed) {
            console.warn('[ai-generate] AI 生成的菜品未通过内容安全检测，已过滤:', dish.name)
            continue  // 跳过违规菜品
          }
	        }
	        safeDishes.push(dish)
	      } catch (e) {
	        // fail-close：安全检查异常时跳过该菜品（安全优先）
	        console.error('[ai-generate] msgSecCheck 失败，跳过菜品:', dish.name, e.errCode, e.message || e.errMsg)
	        // 不加入 safeDishes，该菜品不展示
	      }
	    }

	    if (safeDishes.length === 0) {
	      return { code: -1, message: 'AI 生成的内容未通过安全检测，请调整需求后重试', data: null }
	    }

	    return {
	      code: 0, message: 'ok',
	      data: {
	        dishes: safeDishes,
        source: 'ai',
        meta: { term, seasonHint, recentCount: recentDishIds.length, memberCount: familyMembers.length }
      }
    }
  } catch (err) {
    console.error('[ai-generate] error:', err)
    if (err.response) {
      console.error('[ai-generate] DeepSeek API error:', err.response.status, err.response.data)
    }
    return { code: -1, message: err.message || 'AI 生成失败，请重试', data: null }
  }
}
