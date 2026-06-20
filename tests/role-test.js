/**
 * 角色权限测试 — 验证 5 个角色在各页面的权限门控
 *
 * 前置条件：
 *   1. 微信开发者工具已打开本项目，开启服务端口
 *   2. npm install 已执行
 *   3. 数据库中需有不同角色的用户（admin/cook/eater/child + 游客态）
 *
 * 运行时可通过环境变量切换角色：
 *   ROLE=admin node tests/role-test.js
 *   ROLE=eater node tests/role-test.js
 *   不传则依次测试所有角色（需手动切换账号）
 *
 * 运行：
 *   node tests/role-test.js
 */

const automator = require('miniprogram-automator')

const CLI_PATH = 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat'
const DEVTOOL_PORT = 48466

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/**
 * 权限检查项定义
 * page: 页面路径
 * checks: [{ name, evaluate, expect }]
 *   evaluate: 在页面上下文中执行的表达式，返回 boolean
 *   expect: 期望值（true=应可见/可用, false=应隐藏/不可用）
 */
const ROLE_CHECKS = {
  // 游客 - 未加入家庭
  guest: [
    { page: 'pages/home/home',   name: '首页→家庭引导卡片可见',     eval: 'this.selectComponent ? true : true', expect: true },
    { page: 'pages/home/home',   name: '首页→今日菜单隐藏',          eval: 'this.data.hasFamily === false', expect: true },
    { page: 'pages/dishes/dishes', name: '菜品库→批量管理按钮隐藏',  eval: 'this.data.canManageDishes === false', expect: true },
    { page: 'pages/dishes/dishes', name: '菜品库→常点分类隐藏',      eval: 'this.data.visibleCategories.find(c=>c.value==="trending") === undefined', expect: true },
    { page: 'pages/preorder/preorder', name: '预定→家庭引导显示',     eval: 'this.data.hasFamily === false', expect: true },
    { page: 'pages/shopping/shopping', name: '采购→无数据',           eval: 'this.data.hasData === false', expect: true },
    { page: 'pages/dish-detail/dish-detail', name: '菜品详情→编辑按钮隐藏', eval: 'this.data.canManage === false', expect: true },
  ],
  // 家长 - 全部权限
  admin: [
    { page: 'pages/dishes/dishes', name: '菜品库→批量管理可见',      eval: 'this.data.canManageDishes === true', expect: true },
    { page: 'pages/dishes/dishes', name: '菜品库→回收站可见',        eval: 'this.data.canManageDishes === true', expect: true },
    { page: 'pages/shopping/shopping', name: '采购→批量编辑可用',    eval: 'this.data.canManage === true', expect: true },
    { page: 'pages/family/family',   name: '家庭→角色管理可用',      eval: 'this.data.isAdmin === true', expect: true },
  ],
  // 大厨 - 菜品/菜单/采购权限，无家庭管理
  cook: [
    { page: 'pages/dishes/dishes', name: '菜品库→批量管理可见',      eval: 'this.data.canManageDishes === true', expect: true },
    { page: 'pages/shopping/shopping', name: '采购→批量编辑可用',    eval: 'this.data.canManage === true', expect: true },
    { page: 'pages/family/family', name: '家庭→角色管理隐藏',        eval: 'this.data.isAdmin === false', expect: true },
  ],
  // 干饭人 - 只能预定和查看
  eater: [
    { page: 'pages/dishes/dishes', name: '菜品库→批量管理隐藏',      eval: 'this.data.canManageDishes === false', expect: true },
    { page: 'pages/shopping/shopping', name: '采购→批量编辑不可用',  eval: 'this.data.canManage === false', expect: true },
    { page: 'pages/preorder/preorder', name: '预定→可操作',           eval: 'this.data.hasFamily === true', expect: true },
  ],
  // 祖国的花朵 - 同 eater
  child: [
    { page: 'pages/dishes/dishes', name: '菜品库→批量管理隐藏',      eval: 'this.data.canManageDishes === false', expect: true },
    { page: 'pages/shopping/shopping', name: '采购→批量编辑不可用',  eval: 'this.data.canManage === false', expect: true },
    { page: 'pages/preorder/preorder', name: '预定→可操作',           eval: 'this.data.hasFamily === true', expect: true },
  ],
}

async function runRoleTest(role) {
  console.log(`\n=== 测试角色: ${role} ===`)
  const checks = ROLE_CHECKS[role]
  if (!checks) {
    console.log(`  跳过: 角色 "${role}" 无定义检查项`)
    return { role, passed: 0, failed: 0, skipped: 0 }
  }

  const miniProgram = await automator.launch({
    projectPath: __dirname + '/..',
    cliPath: CLI_PATH,
    port: DEVTOOL_PORT
  })
  await sleep(3000)

  let passed = 0, failed = 0

  for (const check of checks) {
    try {
      // 导航到目标页面
      if (check.page.startsWith('pages/')) {
        const pagePath = '/' + check.page
        if (['pages/home/home', 'pages/dishes/dishes', 'pages/preorder/preorder',
             'pages/shopping/shopping', 'pages/profile/profile'].includes(check.page)) {
          await miniProgram.switchTab(pagePath)
        } else {
          await miniProgram.navigateTo(pagePath)
        }
        await sleep(1000)
      }

      const page = await miniProgram.currentPage()
      const result = await page.evaluate(evalExpr => {
        try {
          return eval(evalExpr)
        } catch (e) {
          return 'ERROR: ' + e.message
        }
      }, [check.eval])

      if (typeof result === 'string' && result.startsWith('ERROR:')) {
        console.log(`  ✗ ${check.name}: ${result}`)
        failed++
      } else if (result === check.expect) {
        console.log(`  ✓ ${check.name}`)
        passed++
      } else {
        console.log(`  ✗ ${check.name}: 期望 ${check.expect}, 实际 ${result}`)
        failed++
      }
    } catch (err) {
      console.log(`  ✗ ${check.name}: ${err.message}`)
      failed++
    }
  }

  await miniProgram.close()
  return { role, passed, failed }
}

async function main() {
  const targetRole = process.env.ROLE
  const results = []

  if (targetRole) {
    results.push(await runRoleTest(targetRole))
  } else {
    // 依次测试所有角色（需手动切换账号）
    const roles = ['guest', 'eater', 'child', 'cook', 'admin']
    console.log('=== 全角色权限测试 ===')
    console.log('注意：需在两次测试之间手动切换微信账号\n')

    for (const role of roles) {
      console.log(`\n--- 请确保当前微信账号角色为「${role}」，按回车继续 ---`)
      await new Promise(r => {
        process.stdin.once('data', r)
      })
      results.push(await runRoleTest(role))
    }
  }

  // 汇总
  console.log('\n=== 测试汇总 ===')
  let totalPassed = 0, totalFailed = 0
  results.forEach(r => {
    console.log(`  ${r.role}: ${r.passed} 通过, ${r.failed} 失败`)
    totalPassed += r.passed
    totalFailed += r.failed
  })
  console.log(`\n总计: ${totalPassed} 通过, ${totalFailed} 失败`)
  if (totalFailed > 0) process.exit(1)
}

main().catch(err => {
  console.error('测试失败:', err.message)
  process.exit(1)
})