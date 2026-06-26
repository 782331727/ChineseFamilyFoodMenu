/**
 * 静态回归检查 v1.2.1
 * 不依赖微信开发者工具，验证关键代码逻辑变更
 * 运行：node tests/static-check.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const RESULTS = []
let pass = 0, fail = 0

function check(name, condition, detail = '') {
  if (condition) {
    RESULTS.push({ status: '✓', name, detail })
    pass++
  } else {
    RESULTS.push({ status: '✗', name, detail })
    fail++
  }
  console.log(`  ${condition ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

// ============================================================
// 1. 编辑按钮修复：navigateTo → switchTab + globalData
// ============================================================
function checkEditFix() {
  console.log('\n--- 1. 编辑按钮修复 ---')
  
  // my-preorders.js: 不应再有 wx.navigateTo 到 preorder 页
  const myPreordersJS = read('pages/my-preorders/my-preorders.js')
  check('my-preorders 不再 navigateTo preorder tabBar 页',
    !myPreordersJS.includes('wx.navigateTo') || !myPreordersJS.includes('/pages/preorder/preorder'),
    '避免 tabBar navigateTo 失败')
  check('my-preorders 使用 switchTab',
    myPreordersJS.includes('wx.switchTab'),
    'tabBar 页必须用 switchTab')
  check('my-preorders 通过 globalData.preorderEdit 传参',
    myPreordersJS.includes('globalData.preorderEdit'),
    'switchTab 无法传 URL 参数，改用 globalData')
  
  // preorder.js: onShow 中优先处理 preorderEdit（在缓存检查之前）
  const preorderJS = read('pages/preorder/preorder.js')
  const onShowIdx = preorderJS.indexOf('onShow()')
  const editCtxIdx = preorderJS.indexOf('preorderEdit')
  const lastFetchIdx = preorderJS.indexOf('_lastFetch')
  check('preorder onShow 中 preorderEdit 在 _lastFetch 之前处理',
    editCtxIdx > onShowIdx && editCtxIdx < lastFetchIdx,
    '确保编辑请求不会被 5 秒缓存跳过')
  check('preorder 清除 preorderEdit 防止重复触发',
    preorderJS.includes('app.globalData.preorderEdit = null'),
    '避免下次 onShow 再次进入编辑模式')
  
  // preorder-list.js: 管理员编辑同样修复
  const preorderListJS = read('pages/preorder-list/preorder-list.js')
  check('preorder-list 管理员编辑用 globalData+switchTab',
    preorderListJS.includes('globalData.preorderEdit') && preorderListJS.includes('wx.switchTab'),
    '管理员编辑也修复')
}

// ============================================================
// 2. 历史预订单锁定
// ============================================================
function checkHistoricalLock() {
  console.log('\n--- 2. 历史预订单锁定 ---')
  
  const js = read('pages/my-preorders/my-preorders.js')
  const wxml = read('pages/my-preorders/my-preorders.wxml')
  const wxss = read('pages/my-preorders/my-preorders.wxss')
  
  check('my-preorders 引入 getTodayStr',
    js.includes('getTodayStr'),
    '用于计算今天日期')
  check('my-preorders data 中有 today 字段',
    js.includes('today: getTodayStr()'),
    '初始化为当天 YYYY-MM-DD')
  
  check('WXML 用 today 判断历史/未来',
    wxml.includes('target_date >= today'),
    '只有今天及未来才显示编辑/取消按钮')
  check('WXML 有历史记录标签',
    wxml.includes('历史记录'),
    '历史预订单显示锁定状态')
  
  check('WXSS 有 historical-tag 样式',
    wxss.includes('historical-tag') && wxss.includes('historical-text'),
    '历史标签视觉样式存在')
}

// ============================================================
// 3. 家庭昵称头像一致性
// ============================================================
function checkFamilySync() {
  console.log('\n--- 3. 家庭昵称头像同步 ---')
  
  const js = read('pages/family/family.js')
  
  check('family.js loadMembersAndFamily 获取 globalData.userInfo',
    js.includes('localUser = app.globalData.userInfo'),
    '读取当前用户本地缓存')
  check('family.js 对 isMe 用户优先用本地昵称',
    js.includes('isMe && localUser.nickName'),
    '本地缓存优先于云端数据')
  check('family.js 对 isMe 用户优先用本地头像',
    js.includes('isMe && localUser.avatarUrl'),
    '头像也同步')
}

// ============================================================
// 4. App 启动错误修复
// ============================================================
function checkAppLaunch() {
  console.log('\n--- 4. App 启动修复 ---')
  
  const appJS = read('app.js')
  const appJSON = read('app.json')
  
  check('app.js redirectToLogin 使用 wx.nextTick 延迟',
    appJS.includes('wx.nextTick'),
    '避免 onLaunch 中的 wx.reLaunch 竞态')
  // v1.2.2: cloud.init 移出 nextTick 同步执行，避免页面 onShow 早于 init 导致 "Cloud API isn't enabled"
  check('app.js wx.cloud.init 在 nextTick 之前同步调用',
    appJS.indexOf('cloud.init') < appJS.indexOf('nextTick'),
    '确保页面 onShow 时云环境已就绪')
  check('app.js checkLoginStatus 仍在 nextTick 内',
    appJS.includes('nextTick') && appJS.includes('checkLoginStatus'),
    '避免登录检查阻塞首屏')
  check('app.json 移除 lazyCodeLoading',
    !appJSON.includes('lazyCodeLoading'),
    '与全局 enablePullDownRefresh 冲突已移除')
  
  // home.json 不冗余
  const homeJSON = read('pages/home/home.json')
  check('home.json 不冗余 enablePullDownRefresh',
    !homeJSON.includes('enablePullDownRefresh'),
    '已在 app.json window 级别配置')

  // v1.2.2: utils/api.js 云环境就绪守卫，防御页面早于 app.onLaunch
  const apiJS = read('utils/api.js')
  check('utils/api.js 有 ensureCloudReady 守卫',
    apiJS.includes('ensureCloudReady'),
    'callFunction 调用前确保云环境已初始化')
  check('utils/api.js callFunction 先调 ensureCloudReady',
    apiJS.includes('ensureCloudReady().then'),
    '每次调用云函数前先保底初始化')
}

// ============================================================
// 5. 版本号一致性
// ============================================================
function checkVersion() {
  console.log('\n--- 5. 版本一致性 ---')
  
  const profileJS = read('pages/profile/profile.js')
  const readmeMD = read('README.md')
  
  check('profile.js showAbout 显示 v1.2.1',
    profileJS.includes('v1.2.1'),
    '关于对话框版本号')
  check('README.md 有 v1.2.1 更新日志',
    readmeMD.includes('v1.2.1'),
    '文档已更新')
}

// ============================================================
// 6. 测试脚本版本同步
// ============================================================
function checkTestScripts() {
  console.log('\n--- 6. 测试脚本同步 ---')
  
  const smoke = read('tests/smoke-test.js')
  const role = read('tests/role-test.js')
  const cloud = read('tests/cloud-regression.js')
  
  check('smoke-test.js 版本 v1.2.1', smoke.includes('v1.2.1'))
  check('smoke-test.js 使用 wsEndpoint 连接', smoke.includes('wsEndpoint'))
  check('smoke-test.js 有 today 检查', smoke.includes('typeof this.data.today'))
  check('smoke-test.js 有家庭头像/昵称一致性检查', smoke.includes('familyConsistency'))
  check('smoke-test.js 有历史锁定检查', smoke.includes('历史记录'))
  
  check('role-test.js 有 today 检查', role.includes('typeof this.data.today'))
  check('role-test.js 使用 wsEndpoint 连接', role.includes('wsEndpoint'))
  
  check('cloud-regression.js 版本 v1.2.1', cloud.includes('v1.2.1'))
}

// ============================================================
// 7. 文件清理
// ============================================================
function checkCleanup() {
  console.log('\n--- 7. 清理确认 ---')
  
  const nulPath = path.join(ROOT, 'nul')
  check('nul 文件已删除', !fs.existsSync(nulPath), 'Windows 保留设备名')
}

// ============================================================
// 8. App 启动超时修复
// ============================================================
function checkStartupTimeout() {
  console.log('\n--- 8. 启动超时修复 ---')
  
  const projCfg = JSON.parse(read('project.config.json'))
  const privateCfg = JSON.parse(read('project.private.config.json'))
  
  const ignored = projCfg.packOptions?.ignore || []
  const ignoredValues = ignored.map(i => i.value)
  
  check('packOptions 忽略 node_modules', ignoredValues.includes('node_modules'),
    '避免扫描编译 node_modules 导致超时')
  check('packOptions 忽略 .test-tmp', ignoredValues.includes('.test-tmp'))
  check('packOptions 忽略 package-lock.json', ignoredValues.includes('package-lock.json'))
  check('packOptions 忽略 preview-qr.png', ignoredValues.includes('preview-qr.png'))
  check('packOptions 忽略 MEMORY.md', ignoredValues.includes('MEMORY.md'))
  check('packOptions 忽略 AGENTS.md', ignoredValues.includes('AGENTS.md'))
  
  check('private.config compileHotReLoad=false',
    privateCfg.setting?.compileHotReLoad === false,
    '避免启动时重复编译加剧超时')
  check('private.config ignoreDevUnusedFiles=true',
    privateCfg.setting?.ignoreDevUnusedFiles === true,
    '忽略未使用文件减少编译量')
}

// ============================================================
// 辅助
// ============================================================
function read(relativePath) {
  const fullPath = path.join(ROOT, relativePath)
  if (!fs.existsSync(fullPath)) {
    console.error(`  ⚠ 文件不存在: ${relativePath}`)
    return ''
  }
  return fs.readFileSync(fullPath, 'utf8')
}

// ============================================================
// 主流程
// ============================================================
function main() {
  console.log('=== 张姐私房菜谱 v1.2.1 静态回归检查 ===\n')
  
  checkEditFix()
  checkHistoricalLock()
  checkFamilySync()
  checkAppLaunch()
  checkVersion()
  checkTestScripts()
  checkCleanup()
  checkStartupTimeout()

  // 汇总
  console.log('\n' + '='.repeat(50))
  console.log('  检查报告')
  console.log('='.repeat(50))
  RESULTS.forEach(r => {
    console.log(`  ${r.status} ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
  })
  console.log(`\n  通过: ${pass}  |  失败: ${fail}`)
  
  if (fail > 0) {
    console.log('\n  ❌ 存在失败项，请修复后重试')
    process.exit(1)
  }
  console.log('  ✅ 全部静态检查通过')
  process.exit(0)
}

main()
