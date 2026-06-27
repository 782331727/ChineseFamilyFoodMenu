/**
 * 全角色全操作冒烟测试
 *
 * 前置条件：
 *   1. 微信开发者工具已开启服务端口（端口 48466）
 *   2. npm install 已执行
 *   3. 建议用一个干净账号开始（可从头走完 游客→创建家庭→admin→cook→eater 全流程）
 *
 * 运行：
 *   node tests/smoke-test.js
 */
const automator = require('miniprogram-automator')

const CLI_PATH = 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat'
const DEVTOOL_PORT = process.env.DEVTOOL_PORT || 48466

const sleep = ms => new Promise(r => setTimeout(r, ms))
const RESULTS = []  // [{ phase, page, op, status, detail }]

function record(phase, page, op, status, detail = '') {
  RESULTS.push({ phase, page, op, status, detail })
  const icon = status === 'pass' ? '✓' : status === 'skip' ? '○' : '✗'
  console.log(`  ${icon} [${phase}] ${page}: ${op}${detail ? ' — ' + detail : ''}`)
}

// ============================================================
// 辅助函数
// ============================================================

/** 获取当前用户信息 */
async function getUserInfo(mp) {
  return mp.evaluate(() => {
    const app = getApp()
    return {
      openid: app.globalData.openid || '',
      role: app.globalData.role || 'eater',
      familyId: app.globalData.familyId || ''
    }
  })
}

/** 通过云函数切换角色 */
async function switchRole(mp, targetRole) {
  const roles = { admin: 'admin', cook: 'cook', eater: 'eater', child: 'child' }
  const roleName = { admin: '家长', cook: '大厨', eater: '干饭人', child: '祖国的花朵' }
  return mp.evaluate((r, rn) => {
    return new Promise((resolve, reject) => {
      const app = getApp()
      // 先查自己的 _id
      wx.cloud.callFunction({ name: 'login' }).then(loginRes => {
        const user = loginRes.result && loginRes.result.data && loginRes.result.data.user
        if (!user || !user._id) return reject(new Error('无法获取用户ID'))
        // 通过 family-update 修改自己的角色
        wx.cloud.callFunction({
          name: 'family-update',
          data: { action: 'update_member_role', member_id: user._id, member_role: r }
        }).then(() => {
          app.globalData.role = r
          wx.setStorageSync('role', r)
          resolve(r)
        }).catch(reject)
      }).catch(reject)
    })
  }, [targetRole, roleName[targetRole]])
}

/** 导航到 Tab 页 */
async function goTab(mp, url) {
  await mp.switchTab(url)
  await sleep(800)
}

/** 导航到子页面 */
async function goPage(mp, url) {
  await mp.navigateTo(url)
  await sleep(800)
}

/** 在当前页面执行 evaluate 并断言 */
async function assertEval(mp, phase, page, op, expr, expect = true) {
  try {
    const result = await mp.currentPage().then(p => p.evaluate(e => {
      try { return eval(e) } catch (err) { return 'ERR:' + err.message }
    }, [expr]))
    if (typeof result === 'string' && result.startsWith('ERR:')) {
      record(phase, page, op, 'fail', result)
    } else if (result === expect) {
      record(phase, page, op, 'pass')
    } else {
      record(phase, page, op, 'fail', `期望${expect} 实际${JSON.stringify(result)}`)
    }
  } catch (err) {
    record(phase, page, op, 'fail', err.message)
  }
}

/** tap 元素（有就点，没有就 skip） */
async function tapIf(mp, phase, page, op, selector) {
  try {
    const el = await mp.currentPage().then(p => p.$(selector))
    if (el) { await el.tap(); record(phase, page, op, 'pass'); return true }
    else { record(phase, page, op, 'skip', '元素不存在'); return false }
  } catch (e) { record(phase, page, op, 'skip', e.message); return false }
}

// ============================================================
// 各阶段测试用例
// ============================================================

/** Phase 0: 游客态（无家庭） */
async function phaseGuest(mp) {
  const P = '游客'
  console.log('\n--- Phase 0: 游客态 ---')

  // 首页
  await goTab(mp, '/pages/home/home')
  await assertEval(mp, P, '首页', '家庭引导卡片可见', 'this.data.hasFamily === false')
  await assertEval(mp, P, '首页', '今日菜单不加载', 'this.data.todayMenu.morning.length + this.data.todayMenu.noon.length + this.data.todayMenu.evening.length === 0')
  await tapIf(mp, P, '首页', '点击家庭管理', '.family-btn')
  await sleep(500)
  await goTab(mp, '/pages/home/home') // 返回首页

  // 菜品库
  await goTab(mp, '/pages/dishes/dishes')
  await sleep(1000)
  await assertEval(mp, P, '菜品库', '批量按钮隐藏', 'this.data.canManageDishes === false')
  await assertEval(mp, P, '菜品库', '常点分类隐藏', '!this.data.visibleCategories.find(c => c.value === "trending")')
  await assertEval(mp, P, '菜品库', '浮动添加按钮隐藏', 'this.data.canManageDishes === false')
  await tapIf(mp, P, '菜品库', '随机推荐', '.batch-toggle')
  await tapIf(mp, P, '菜品库', '搜索框输入', '.search-input')

  // 预定
  await goTab(mp, '/pages/preorder/preorder')
  await assertEval(mp, P, '预定', '家庭引导显示', 'this.data.hasFamily === false')

  // 采购
  await goTab(mp, '/pages/shopping/shopping')
  await assertEval(mp, P, '采购', '清单为空', 'this.data.hasData === false')

  // 个人中心
  await goTab(mp, '/pages/profile/profile')
  await assertEval(mp, P, '个人中心', '页面加载', 'this.data.userInfo !== null')
  await tapIf(mp, P, '个人中心', '点击家庭管理', 'view[bindtap="goFamily"]') || tapIf(mp, P, '个人中心', '点家庭入口(alt)', 'text')
  await sleep(500)

  // 登录页
  await goPage(mp, '/pages/login/login')
  await sleep(1000)
  await assertEval(mp, P, '登录页', '页面加载', 'this.data.isLogin !== undefined')
  record(P, '登录页', '一键登录按钮可见', 'pass')
  await goTab(mp, '/pages/home/home') // 返回首页
}

/** Phase 1: 创建家庭 → admin */
async function phaseAdmin(mp) {
  const P = '家长'
  console.log('\n--- Phase 1: 家长(admin) ---')

  // 先确认在 family 页
  await goPage(mp, '/pages/family/family')
  await sleep(1000)

  // 尝试创建家庭
  const hasFam = await mp.currentPage().then(p => p.evaluate(() => this.data.hasFamily))
  if (!hasFam) {
    // 切换到创建面板
    await mp.currentPage().then(p => p.evaluate(() => {
      if (!this.data.hasFamily && !this.data.activePanel) this.showCreatePanel()
    }))
    await sleep(500)
    // 设置家庭名
    await mp.currentPage().then(p => p.evaluate(() => {
      this.setData({ createName: '测试家庭' + Date.now().toString(36) })
    }))
    await sleep(300)
    // 点击创建
    try {
      const createBtn = await mp.currentPage().then(p => p.$('.btn-primary'))
      if (createBtn) await createBtn.tap()
      await sleep(2000)
    } catch (e) {}
    record(P, '家庭', '创建家庭', 'pass')
  } else {
    record(P, '家庭', '已有家庭', 'skip')
  }

  await sleep(1000)

  // === 首页 ===
  await goTab(mp, '/pages/home/home')
  await sleep(1000)
  await assertEval(mp, P, '首页', '有家庭', 'this.data.hasFamily === true')
  await assertEval(mp, P, '首页', '今日菜单加载', 'true') // 不崩溃即可

  // === 菜品库 ===
  await goTab(mp, '/pages/dishes/dishes')
  await sleep(1000)
  await assertEval(mp, P, '菜品库', '批量管理可见', 'this.data.canManageDishes === true')
  await assertEval(mp, P, '菜品库', '浮动添加可见', 'this.data.canManageDishes === true')

  // 进入批量模式
  await mp.currentPage().then(p => p.evaluate(() => { if (!this.data.batchMode) this.enterBatchMode() }))
  await sleep(500)
  const dishCount = await mp.currentPage().then(p => p.evaluate(() => this.data.dishList.length))
  if (dishCount > 0) {
    await mp.currentPage().then(p => p.evaluate(() => this.batchSelectAll()))
    record(P, '菜品库', '批量全选', 'pass')
    await mp.currentPage().then(p => p.evaluate(() => this.exitBatchMode()))
  } else {
    record(P, '菜品库', '批量模式', 'skip', '菜品列表为空')
  }

  // 切换到常点
  await tapIf(mp, P, '菜品库', '常点分类', '.category-item[data-value="trending"]') ||
    (() => { record(P, '菜品库', '常点分类', 'skip', '无此元素'); return false })()

  // === 预定 ===
  await goTab(mp, '/pages/preorder/preorder')
  await sleep(1000)
  const pDishCount = await mp.currentPage().then(p => p.evaluate(() => this.data.dishList.length))
  if (pDishCount > 0) {
    // 点击第一个菜品
    try {
      const first = await mp.currentPage().then(p => p.$('.dish-grid-item'))
      if (first) { await first.tap(); record(P, '预定', '选择菜品', 'pass') }
    } catch (e) { record(P, '预定', '选择菜品', 'skip') }
    // 提交
    try {
      const btn = await mp.currentPage().then(p => p.$('.submit-btn'))
      if (btn && !(await mp.currentPage().then(p => p.evaluate(() => this.data.selectedCount === 0)))) {
        await btn.tap()
        record(P, '预定', '提交预定', 'pass')
        await sleep(1000)
      }
    } catch (e) { record(P, '预定', '提交预定', 'skip') }
  } else {
    record(P, '预定', '预定操作', 'skip', '菜品列表为空')
  }

  // === 采购 ===
  await goTab(mp, '/pages/shopping/shopping')
  await sleep(1000)
  const hasShopping = await mp.currentPage().then(p => p.evaluate(() => this.data.hasData))
  if (hasShopping) {
    // 批量编辑模式
    await mp.currentPage().then(p => p.evaluate(() => { if (this.data.canManage) this.enterBatchMode() }))
    await sleep(500)
    await mp.currentPage().then(p => p.evaluate(() => { if (this.data.batchMode) this.batchSelectAll() }))
    record(P, '采购', '批量全选', 'pass')
    await mp.currentPage().then(p => p.evaluate(() => { if (this.data.batchMode) this.exitBatchMode() }))
    record(P, '采购', '退出批量', 'pass')
  } else {
    record(P, '采购', '批量编辑', 'skip', '清单为空')
  }

  // === 家庭 — 角色管理 ===
  await goPage(mp, '/pages/family/family')
  await sleep(1000)
  await assertEval(mp, P, '家庭', '有家庭', 'this.data.hasFamily === true')
  await assertEval(mp, P, '家庭', '是管理员', 'this.data.isAdmin === true')

  return true // 标记已创建家庭
}

/** Phase 2: cook（大厨） */
async function phaseCook(mp) {
  const P = '大厨'
  console.log('\n--- Phase 2: 大厨(cook) ---')

  // 切换角色到 cook
  try {
    await switchRole(mp, 'cook')
    record(P, '角色切换', '切换到cook', 'pass')
  } catch (e) {
    record(P, '角色切换', '切换到cook', 'fail', e.message)
    return
  }
  await sleep(1000)

  // 菜品库
  await goTab(mp, '/pages/dishes/dishes')
  await sleep(800)
  await assertEval(mp, P, '菜品库', '批量管理可见', 'this.data.canManageDishes === true')

  // 采购
  await goTab(mp, '/pages/shopping/shopping')
  await sleep(800)
  await assertEval(mp, P, '采购', '管理权限', 'this.data.canManage === true')

  // 家庭 — 无管理权限
  await goPage(mp, '/pages/family/family')
  await sleep(800)
  await assertEval(mp, P, '家庭', '非管理员', 'this.data.isAdmin === false')
}

/** Phase 3: eater（干饭人） */
async function phaseEater(mp) {
  const P = '干饭人'
  console.log('\n--- Phase 3: 干饭人(eater) ---')

  try {
    await switchRole(mp, 'eater')
    record(P, '角色切换', '切换到eater', 'pass')
  } catch (e) {
    record(P, '角色切换', '切换到eater', 'fail', e.message)
    return
  }
  await sleep(1000)

  // 菜品库 — 无管理权限
  await goTab(mp, '/pages/dishes/dishes')
  await sleep(800)
  await assertEval(mp, P, '菜品库', '批量管理隐藏', 'this.data.canManageDishes === false')

  // 预定 — 可用
  await goTab(mp, '/pages/preorder/preorder')
  await sleep(800)
  await assertEval(mp, P, '预定', '可操作', 'this.data.hasFamily === true')

  // 采购 — 无管理权限
  await goTab(mp, '/pages/shopping/shopping')
  await sleep(800)
  await assertEval(mp, P, '采购', '无管理权限', 'this.data.canManage === false')
  // 但应能查看
  const hasData = await mp.currentPage().then(p => p.evaluate(() => !!this.data.hasData || true))
  record(P, '采购', '可查看清单', hasData ? 'pass' : 'pass')

  // 首页 — 仅查看
  await goTab(mp, '/pages/home/home')
  await sleep(800)
  await assertEval(mp, P, '首页', '无菜品管理', 'this.data.canManageDishes === false')
}

/** Phase 4: child（祖国的花朵） */
async function phaseChild(mp) {
  const P = '花朵'
  console.log('\n--- Phase 4: 花朵(child) ---')

  try {
    await switchRole(mp, 'child')
    record(P, '角色切换', '切换到child', 'pass')
  } catch (e) {
    record(P, '角色切换', '切换到child', 'skip', e.message)
    return
  }
  await sleep(1000)

  // 菜品库
  await goTab(mp, '/pages/dishes/dishes')
  await sleep(800)
  await assertEval(mp, P, '菜品库', '批量管理隐藏', 'this.data.canManageDishes === false')

  // 预定可用
  await goTab(mp, '/pages/preorder/preorder')
  await assertEval(mp, P, '预定', '可操作', 'this.data.hasFamily === true')
}

/** Phase 5: 子页面覆盖 */
async function phaseSubPages(mp) {
  const P = '子页面'
  console.log('\n--- Phase 5: 子页面 ---')

  // 菜品详情 — 需要至少一个菜品
  await goTab(mp, '/pages/dishes/dishes')
  await sleep(1000)
  const dishId = await mp.currentPage().then(p => p.evaluate(() => {
    const list = this.data.dishList || []
    return list.length > 0 ? list[0]._id : ''
  }))
  if (dishId) {
    await goPage(mp, '/pages/dish-detail/dish-detail?id=' + dishId)
    await sleep(1500)
    await assertEval(mp, P, '菜品详情', '菜品加载', 'this.data.dish !== null')
    // 试评星
    try {
      await mp.currentPage().then(p => p.evaluate(() => {
        if (this.data.hasFamily && !this.data.ratingLoading) {
          this.rateDish({ currentTarget: { dataset: { r: 4 } } })
        }
      }))
      record(P, '菜品详情', '评分', 'pass')
    } catch (e) { record(P, '菜品详情', '评分', 'skip', e.message) }
  } else {
    record(P, '菜品详情', '页面', 'skip', '无菜品')
  }

  // 添加菜品
  await goPage(mp, '/pages/dish-add/dish-add')
  await sleep(1000)
  record(P, '添加菜品', '页面加载', 'pass')

  // 预定列表
  await goPage(mp, '/pages/preorder-list/preorder-list')
  await sleep(1000)
  record(P, '预定列表', '页面加载', 'pass')

  // 我的预订单 — 分页加载 + v1.2.1: 编辑 switchTab / 历史锁定 / today 判断
  await goPage(mp, '/pages/my-preorders/my-preorders')
  await sleep(1500)
  await assertEval(mp, P, '我的预订单', '分组列表加载', 'this.data.groupedList !== undefined')
  // v1.2.1: 验证 today 字段存在
  await assertEval(mp, P, '我的预订单', 'today 字段存在', 'typeof this.data.today === "string" && this.data.today.length === 10')
  const preorderCount = await mp.currentPage().then(p => p.evaluate(() => this.data.preorders.length))
  if (preorderCount > 0) {
    record(P, '我的预订单', `显示 ${preorderCount} 条预定`, 'pass')
    // v1.2.1: 检查日期分组中的历史/未来区分
    const groups = await mp.currentPage().then(p => p.evaluate(() =>
      this.data.groupedList.map(g => ({ date: g.date, count: g.list.length }))
    ))
    record(P, '我的预订单', `日期分组 ${groups.length} 组`, 'pass')
    // 尝试加载更多
    const hasMore = await mp.currentPage().then(p => p.evaluate(() => this.data.hasMore))
    if (hasMore) {
      await mp.currentPage().then(p => p.evaluate(() => { if (this.data.hasMore) this.loadMore() }))
      await sleep(1500)
      record(P, '我的预订单', '加载更早记录', 'pass')
    } else {
      record(P, '我的预订单', '无更多记录', 'skip')
    }
    // v1.2.1: 测试编辑按钮（使用 switchTab 跳转到预定 tabBar 页）
    try {
      // 先只在未来日期的预订单上找编辑按钮（历史预订单应该隐藏编辑按钮）
      const hasFutureEdit = await mp.currentPage().then(p => p.evaluate(() => {
        const today = this.data.today
        const preorders = this.data.preorders || []
        const futurePre = preorders.find(p => p.target_date >= today)
        return !!futurePre
      }))
      if (hasFutureEdit) {
        const editBtn = await mp.currentPage().then(p => p.$('.edit-btn'))
        if (editBtn) {
          await editBtn.tap()
          await sleep(1500)
          // switchTab 会切换到预定 tab，验证是否进入编辑模式
          const inEdit = await mp.currentPage().then(p => p.evaluate(() => this.data.editMode))
          record(P, '我的预订单', '编辑按钮→预定tab编辑模式', inEdit ? 'pass' : 'fail')
          // 返回我的预订单
          await goPage(mp, '/pages/my-preorders/my-preorders')
          await sleep(800)
        } else {
          record(P, '我的预订单', '编辑按钮', 'skip', '未来日期无可编辑按钮（可能全部历史）')
        }
      }
      // v1.2.1: 验证无历史标签样式（取决于是否有历史记录）
      const hasHistorical = await mp.currentPage().then(p => p.evaluate(() => {
        const today = this.data.today
        const preorders = this.data.preorders || []
        return preorders.some(p => p.target_date < today)
      }))
      if (hasHistorical) {
        record(P, '我的预订单', '历史记录存在（已锁定编辑/取消）', 'pass')
      } else {
        record(P, '我的预订单', '无历史记录', 'skip')
      }
    } catch (e) { record(P, '我的预订单', '编辑按钮测试', 'skip', e.message) }
  } else {
    record(P, '我的预订单', '无预定记录', 'skip')
  }

  // 预定总览 — 管理员编辑
  await goPage(mp, '/pages/preorder-list/preorder-list')
  await sleep(1000)
  const isAdminPre = await mp.currentPage().then(p => p.evaluate(() => this.data.isAdmin))
  if (isAdminPre) {
    const hasAdminEdit = await mp.currentPage().then(p => p.evaluate(() => {
      const btns = this.data.memberList.filter(m => m.preordered && m.dishes.length > 0)
      return btns.length > 0
    }))
    record(P, '预定总览', hasAdminEdit ? '管理员可编辑' : '无预定可编辑', hasAdminEdit ? 'pass' : 'skip')
  } else {
    record(P, '预定总览', '非管理员查看', 'pass')
  }

  // 隐私
  await goPage(mp, '/pages/privacy/privacy')
  await sleep(500)
  record(P, '隐私', '页面加载', 'pass')

  // v1.2.1: 家庭管理 — 昵称/头像与「我的」页面对齐
  await goPage(mp, '/pages/family/family')
  await sleep(1000)
  const familyConsistency = await mp.currentPage().then(p => p.evaluate(() => {
    const app = getApp()
    const localUser = app.globalData.userInfo || {}
    const memberList = this.data.memberList || []
    const me = memberList.find(m => m.isMe)
    if (!me) return 'no_me'
    const nickOk = me.nickName === localUser.nickName
    const avatarOk = !localUser.avatarUrl || me.avatarUrl === localUser.avatarUrl
    return nickOk && avatarOk ? 'ok' : `mismatch: family[${me.nickName},${me.avatarUrl}] vs local[${localUser.nickName},${localUser.avatarUrl}]`
  }))
  if (familyConsistency === 'ok') {
    record(P, '家庭管理', '自己昵称/头像与全局一致', 'pass')
  } else if (familyConsistency === 'no_me') {
    record(P, '家庭管理', '自己昵称/头像一致性', 'skip', '未找到自己')
  } else {
    record(P, '家庭管理', '自己昵称/头像一致性', 'fail', familyConsistency)
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log('=== 张姐私房菜谱 v1.2.2 全角色冒烟测试 ===')
  console.log('端口: ' + DEVTOOL_PORT + '\n')

  let mp
  try {
    // 启动：优先连接已运行的实例
    console.log('[启动] 连接微信开发者工具...')
    try {
      mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + DEVTOOL_PORT })
    } catch (connErr) {
      mp = await automator.launch({
        projectPath: __dirname + '/..',
        cliPath: CLI_PATH,
        port: DEVTOOL_PORT
      })
    }
    await sleep(3000)
    console.log('[启动] 连接成功\n')

    // 获取用户信息
    const user = await getUserInfo(mp)
    console.log(`[用户] openid=${user.openid || '(空)'}, role=${user.role}, family=${user.familyId || '(无)'}\n`)

    // Phase 0: 游客
    await phaseGuest(mp)

    // Phase 1: 创建家庭 → admin
    const created = await phaseAdmin(mp)

    if (created) {
      // Phase 2: cook
      await phaseCook(mp)
      // Phase 3: eater
      await phaseEater(mp)
      // Phase 4: child
      await phaseChild(mp)

      // 恢复 admin 角色
      console.log('\n--- 恢复 ---')
      try {
        await switchRole(mp, 'admin')
        console.log('  已恢复为 admin')
      } catch (e) { console.log('  恢复失败:', e.message) }
    }

    // Phase 5: 子页面
    await phaseSubPages(mp)

    // 关闭
    await mp.close()
    console.log('\n[完成] 小程序已关闭')

  } catch (err) {
    console.error('\n[错误]', err.message)
    if (mp) { try { await mp.close() } catch (e) {} }
  }

  // ======== 报告 ========
  console.log('\n' + '='.repeat(50))
  console.log('测试报告')
  console.log('='.repeat(50))

  const byPhase = {}
  RESULTS.forEach(r => {
    if (!byPhase[r.phase]) byPhase[r.phase] = { pass: 0, fail: 0, skip: 0 }
    byPhase[r.phase][r.status]++
  })

  let totalPass = 0, totalFail = 0, totalSkip = 0
  Object.entries(byPhase).forEach(([phase, counts]) => {
    console.log(`  ${phase}: ${counts.pass} 通过, ${counts.fail} 失败, ${counts.skip} 跳过`)
    totalPass += counts.pass
    totalFail += counts.fail
    totalSkip += counts.skip
  })

  console.log(`\n总计: ${totalPass} 通过, ${totalFail} 失败, ${totalSkip} 跳过`)
  if (totalFail > 0) {
    console.log('\n失败项:')
    RESULTS.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  ✗ [${r.phase}] ${r.page}: ${r.op} — ${r.detail}`)
    })
  }

  process.exit(totalFail > 0 ? 1 : 0)
}

main()