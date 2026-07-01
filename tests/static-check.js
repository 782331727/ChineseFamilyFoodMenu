/**
 * 静态回归检查 v1.2.4
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
  check('my-preorders 编辑用 switchTab 非 navigateTo',
    myPreordersJS.includes("wx.switchTab({ url: '/pages/preorder/preorder'"),
    'tabBar 页必须用 switchTab，不能用 navigateTo')
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
  // v1.2.3: cloud.init 移出 nextTick 同步执行，避免页面 onShow 早于 init 导致 "Cloud API isn't enabled"
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

  // v1.2.3: utils/api.js 云环境就绪守卫，防御页面早于 app.onLaunch
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
  
  check('profile.js showAbout 显示 v1.2.4',
    profileJS.includes('v1.2.4'),
    '关于对话框版本号')
  check('README.md 有 v1.2.4 更新日志',
    readmeMD.includes('v1.2.4'),
    '文档已更新')
}

// ============================================================
// 6. 审核修复：内容安全 API v2.0 + fail-close + 菜品详情错误状态
// ============================================================
function checkAuditFixes() {
  console.log('\n--- 6. 审核修复 ---')

  // 6a. dish-add 云函数：checkContent v2.0 + fail-close
  const dishAddCF = read('cloudfunctions/dish-add/index.js')
  check('dish-add checkContent 包含 openid 参数',
    dishAddCF.includes('checkContent(openid'),
    'v2.0 API 必须传 openid')
  check('dish-add msgSecCheck 调用含 version: 2',
    dishAddCF.includes('version: 2'),
    'v2.0 必须显式声明 version=2')
  check('dish-add msgSecCheck 调用含 scene',
    dishAddCF.includes('scene: '),
    'v2.0 必须传 scene 场景值')
  check('dish-add 用 result.suggest 判断（非 errCode）',
    dishAddCF.includes('result.suggest'),
    'v2.0 返回 suggest: pass/risky/review')
  check('dish-add checkContent 含 nutrition_tags',
    dishAddCF.includes('nutrition_tags') || dishAddCF.includes('(tags || [])'),
    '标签文本也纳入安全检查')
  check('dish-add checkContent catch 返回 pass:false (fail-close)',
    dishAddCF.includes('return { pass: false, err:'),
    '安全检查异常时拒绝提交')

  // 6b. preorder-add 云函数：v2.0 + fail-close
  const preorderAddCF = read('cloudfunctions/preorder-add/index.js')
  check('preorder-add msgSecCheck 含 openid',
    preorderAddCF.includes('openid: user.openid'),
    'v2.0 API 传用户 openid')
  check('preorder-add msgSecCheck 含 version: 2 + scene',
    preorderAddCF.includes('version: 2') && preorderAddCF.includes('scene: '),
    'v2.0 标准调用')
  check('preorder-add 用 result.suggest 判断',
    preorderAddCF.includes('result.suggest'),
    'v2.0 返回格式')
  check('preorder-add catch 不再静默放行',
    !preorderAddCF.includes('catch (e) {}'),
    'fail-close 返回错误消息')

  // 6c. family-update 云函数：v2.0 + fail-close
  const familyUpdateCF = read('cloudfunctions/family-update/index.js')
  check('family-update msgSecCheck 含 openid + version: 2 + scene: 1',
    familyUpdateCF.includes('openid: OPENID') && familyUpdateCF.includes('version: 2') && familyUpdateCF.includes('scene: 1'),
    '家庭名称用 scene=1（资料）')
  check('family-update 用 result.suggest 判断',
    familyUpdateCF.includes('result.suggest'),
    'v2.0 返回格式')
  check('family-update catch 改为 fail-close',
    !familyUpdateCF.includes('catch (e) {}'),
    '不再静默放行')

  // 6d. profile-manage 云函数：v2.0 + fail-close + config.json
  const profileManageCF = read('cloudfunctions/profile-manage/index.js')
  check('profile-manage msgSecCheck 含 openid + version: 2 + scene: 1',
    profileManageCF.includes('openid: OPENID') && profileManageCF.includes('version: 2') && profileManageCF.includes('scene: 1'),
    '昵称用 scene=1（资料）')
  check('profile-manage 用 result.suggest 判断',
    profileManageCF.includes('result.suggest'),
    'v2.0 返回格式')
  check('profile-manage catch 改为 fail-close',
    !profileManageCF.includes('catch (e) {}'),
    '不再静默放行')
  check('profile-manage 有 config.json 声明 openapi 权限',
    read('cloudfunctions/profile-manage/config.json').includes('security.msgSecCheck'),
    '之前缺失导致 msgSecCheck 从未生效')

  // 6e. dish-detail 页面：loadError 状态 + 错误 UI
  const detailJS = read('pages/dish-detail/dish-detail.js')
  const detailWXML = read('pages/dish-detail/dish-detail.wxml')
  const detailWXSS = read('pages/dish-detail/dish-detail.wxss')

  check('dish-detail.js 有 loadError 状态字段',
    detailJS.includes('loadError: false'),
    '加载失败时不再空白页')
  check('dish-detail.js loadDish 使用 dishId 存储支持重试',
    detailJS.includes('dishId:') || detailJS.includes('this.data.dishId'),
    '重试按钮可正确重新加载')
  check('dish-detail.js catch 设置 loadError + errorMsg',
    detailJS.includes('loadError: true') && detailJS.includes('errorMsg'),
    '存储具体错误原因而非写死"网络"')
  check('dish-detail.wxml 有错误状态视图',
    detailWXML.includes('error-page') && detailWXML.includes('重新加载'),
    '!dish && !loading 时显示错误页而非空白')
  check('dish-detail.wxml 展示 errorMsg 动态错误信息',
    detailWXML.includes('{{errorMsg'),
    '展示云函数返回的真实错误，不再只写死"网络"')
  check('dish-detail.wxss 有 error-page 样式',
    detailWXSS.includes('error-page') && detailWXSS.includes('error-retry-btn'),
    '错误状态样式完整')

  // 6f. dish-add 前端：内容违规提示
  const dishAddJS = read('pages/dish-add/dish-add.js')
  const aiCatchIdx = dishAddJS.indexOf('addAiDishToLib')
	  check('api.js 安全违规用 Modal 显示',
	    read('utils/api.js').includes('showModal') && read('utils/api.js').includes("includes('违规')"),
	    '违规消息弹 Modal 停留，非违规消息弹 Toast 3s')
	  check('dish-add.js saveDish catch 不重复弹 Modal',
	    !read('pages/dish-add/dish-add.js').includes('内容审核未通过'),
	    'api.js 已统一处理违规提示，页面不再重复')
	  check('dish-add.js AI菜品违规由 api.js 统一提示',
	    read('pages/dish-add/dish-add.js').includes('api.js 已通过 Modal 显示违规提示'),
	    'AI 菜品保存违规统一走 api.js Modal')

  // 6g. 游客路径：所有页面有 hasFamily 守卫 + 引导按钮
  const preorderListJS = read('pages/preorder-list/preorder-list.js')
  const preorderListWXML = read('pages/preorder-list/preorder-list.wxml')
  check('preorder-list 游客有 goJoinFamily 方法',
    preorderListJS.includes('goJoinFamily'),
    '游客可点击按钮加入家庭')
  check('preorder-list 游客有 去加入家庭 按钮',
    preorderListWXML.includes('去加入家庭') && preorderListWXML.includes('goJoinFamily'),
    '不再死胡同')

  const myPreordersJS = read('pages/my-preorders/my-preorders.js')
  const myPreordersWXML = read('pages/my-preorders/my-preorders.wxml')
  check('my-preorders 有 hasFamily 守卫',
    myPreordersJS.includes('hasFamily') && myPreordersJS.includes('goJoinFamily'),
    '游客显示引导而非空列表')
  check('my-preorders WXML 有无家庭引导',
    myPreordersWXML.includes('去加入家庭'),
    '游客不再看到误导的"暂无预购记录"')

  const shoppingJS = read('pages/shopping/shopping.js')
  const shoppingWXML = read('pages/shopping/shopping.wxml')
  check('shopping 有 hasFamily 守卫',
    shoppingJS.includes('hasFamily') && shoppingJS.includes('goJoinFamily'),
    '游客不触发错误云函数调用')
  check('shopping WXML 有无家庭引导',
    shoppingWXML.includes('加入家庭即可查看采购清单'),
    '游客看到明确引导而非空采购清单')
}
// ============================================================
// 7. 全角色页面覆盖矩阵
// ============================================================
function checkRoleCoverage() {
  console.log('\n--- 7. 全角色页面覆盖 ---')

  // ── 7a. 首页角色按钮可见性 ──
  const homeJS = read('pages/home/home.js')
  const homeWXML = read('pages/home/home.wxml')
  check('首页 游客 有创建/加入家庭按钮',
    homeWXML.includes('创建家庭') && homeWXML.includes('加入家庭'),
    '游客看到加入引导')
  check('首页 有 canManageDishes 权限守卫',
    homeJS.includes("hasPermission('manage_dishes')"),
    'cook/admin 才显示烹饪/添加按钮')
  check('首页 快捷操作不暴露给游客',
    homeWXML.includes('wx:if="{{canManageDishes}}"') || homeWXML.includes('canManageDishes'),
    'AI推荐/添加菜品仅 cook/admin 可见')

  // ── 7b. 菜品库角色分类可见性 ──
  const dishesJS = read('pages/dishes/dishes.js')
  const dishesWXML = read('pages/dishes/dishes.wxml')
  check('菜品库 游客隐藏 trending 分类',
    dishesJS.includes('!hasFamily') && dishesJS.includes('trending'),
    '无家庭时不展示🔥常点')
  check('菜品库 游客用 dish-public 加载',
    dishesJS.includes('dish-public'),
    '游客看公开菜库')
  check('菜品库 批量/回收站 仅 cook/admin 可见',
    dishesWXML.includes('canManageDishes'),
    '菜品管理操作有角色守卫')

  // ── 7c. 预定页角色 + 编辑模式 ──
  const preorderJS = read('pages/preorder/preorder.js')
  const preorderWXML = read('pages/preorder/preorder.wxml')
  check('预定页 游客 有去加入家庭引导',
    preorderWXML.includes('goFamily') && preorderWXML.includes('!hasFamily'),
    '游客看到引导卡片')
  check('预定页 全员可预定（无角色守卫）',
    !preorderJS.includes("requirePermission('preorder')"),
    '预定权限仅后端云函数校验')
  check('预定页 支持编辑模式 globalData.preorderEdit',
    preorderJS.includes('preorderEdit'),
    '从预订单/预定总览传入编辑参数')

  // ── 7d. 采购页角色按钮可见性 ──
  const shoppingJS = read('pages/shopping/shopping.js')
  const shoppingWXML = read('pages/shopping/shopping.wxml')
  check('采购页 游客 有加入家庭引导',
    shoppingWXML.includes('加入家庭即可查看采购清单'),
    '游客看到引导而非空列表')
  check('采购页 canManage 权限守卫',
    shoppingJS.includes("hasPermission('manage_shopping')"),
    'cook/admin 才显示管理按钮')
  check('采购页 删除/AI/添加 仅 canManage 可见',
    shoppingWXML.includes('canManage'),
    '管理操作有前端守卫')

  // ── 7e. 我的页独立于家庭 ──
  const profileJS = read('pages/profile/profile.js')
  check('我的页 对游客可用（无 hasFamily 阻断）',
    !profileJS.includes('!hasFamily') && !profileJS.includes('if (!hf)'),
    '口味/忌口/头像管理无需家庭——游客正常使用')

  // ── 7f. 菜品详情三态底部栏 ──
  const detailJS = read('pages/dish-detail/dish-detail.js')
  const detailWXML = read('pages/dish-detail/dish-detail.wxml')
  check('菜品详情 游客 → 加入家庭按钮',
    detailWXML.includes('!hasFamily') && detailJS.includes('goJoinFamily'),
    '游客三态：加入家庭')
  check('菜品详情 isForeign → 引入到我家按钮',
    detailWXML.includes('isForeign') && detailJS.includes('cloneDish'),
    '外家菜三态：引入到我家')
  check('菜品详情 自家菜 → 预定/编辑/删除',
    detailWXML.includes('onPreorder') && detailWXML.includes('canManage'),
    '自家菜三态：预定+管理')
  check('菜品详情 评分 hasFamily 守卫',
    detailJS.includes("!this.data.hasFamily") && detailJS.includes("请先加入家庭"),
    '游客评分提示加入家庭')

  // ── 7g. 添加菜品页权限守卫 ──
  const dishAddJS = read('pages/dish-add/dish-add.js')
  check('添加菜品 saveDish requirePermission manage_dishes',
    dishAddJS.includes("requirePermission('manage_dishes')"),
    '仅 cook/admin 可保存菜品')

  // ── 7h. 家庭页创建/加入面板 ──
  const familyJS = read('pages/family/family.js')
  const familyWXML = read('pages/family/family.wxml')
  check('家庭页 有创建/加入面板切换',
    familyWXML.includes('showCreatePanel') && familyWXML.includes('showJoinPanel'),
    '游客可创建或加入')
  check('家庭页 已有家庭显示邀请码',
    familyJS.includes('copyInviteCode') || familyWXML.includes('复制'),
    '家庭成员可复制邀请码')
  check('家庭页 admin 可编辑家庭名',
    familyWXML.includes('isAdmin') || familyJS.includes("role === 'admin'"),
    '仅家长可管理')

  // ── 7i. 登录页自动跳转 ──
  const loginJS = read('pages/login/login.js')
  check('登录页 已登录自动跳转首页',
    loginJS.includes('isLogin') && loginJS.includes('switchTab'),
    '避免重复登录')

  // ── 7j. 全局跨页面通信 ──
  check('globalData.preorderDishId 跨页面传菜',
    detailJS.includes('preorderDishId') && preorderJS.includes('preorderDishId'),
    '菜品详情 → 预定页')
  check('globalData.preorderEdit 跨页面传编辑',
    preorderJS.includes('preorderEdit'),
    '预订单/总览 → 预定编辑模式')
  check('globalData.dishesNeedRefresh 跨页面刷新',
    dishAddJS.includes('dishesNeedRefresh') || detailJS.includes('dishesNeedRefresh'),
    '添加/删除菜品 → 菜品库 onShow 刷新')

  // ── 7k. 云函数权限配置完整性 ──
  check('dish-add config 有 msgSecCheck 权限',
    read('cloudfunctions/dish-add/config.json').includes('security.msgSecCheck'),
    '添加菜品有内容安全')
  check('preorder-add config 有 msgSecCheck 权限',
    read('cloudfunctions/preorder-add/config.json').includes('security.msgSecCheck'),
    '预定备注有内容安全')
  check('family-update config 有 msgSecCheck 权限',
    read('cloudfunctions/family-update/config.json').includes('security.msgSecCheck'),
    '家庭名有内容安全')
  check('profile-manage config 有 msgSecCheck 权限',
    read('cloudfunctions/profile-manage/config.json').includes('security.msgSecCheck'),
    '昵称有内容安全')

  // ── 7l. 后端权限一致性 ──
  const familyJoinCF = read('cloudfunctions/family-join/index.js')
  check('family-join 不自提权（role 参数不来自客户端）',
    !familyJoinCF.includes('role ||') && familyJoinCF.includes("'eater'"),
    '加入家庭固定 eater，防止客户端传 role=admin')

  const dishAddCF = read('cloudfunctions/dish-add/index.js')
  check('dish-add rate 开放给全员',
    dishAddCF.includes("action !== 'rate'"),
    'rating 前端开放，后端也开放给所有家庭成员')

  // ── 7m. 图片内容安全（先审后传）──
  check('img-check 云函数存在',
    read('cloudfunctions/img-check/index.js').includes('imgSecCheck'),
    '专用图片检测云函数')
  check('dish-add.js chooseImage 先传后审（uploadFile → img-check）',
    dishAddJS.includes('img-check') && dishAddJS.includes('uploadFile'),
    '上传云存储→云函数下载检测→合规保留/违规删除')

  // ── 7n. 全量 UGC 内容安全覆盖 ──
  check('family-create 有 msgSecCheck',
    read('cloudfunctions/family-create/index.js').includes('msgSecCheck') &&
    read('cloudfunctions/family-create/config.json').includes('security.msgSecCheck'),
    '创建家庭时检测名称')

  check('shopping-list 有 msgSecCheck',
    read('cloudfunctions/shopping-list/index.js').includes('msgSecCheck') &&
    read('cloudfunctions/shopping-list/config.json').includes('security.msgSecCheck'),
    '采购物品名称有安全检查')

  const profileManageCF = read('cloudfunctions/profile-manage/index.js')
  check('profile-manage 有 imgSecCheck 检测头像',
    profileManageCF.includes('imgSecCheck') && profileManageCF.includes('avatar'),
    '用户头像上传有图片安全检测')
  check('profile-manage 有 avoidList msgSecCheck',
    profileManageCF.includes('avoidList') && profileManageCF.includes('update_avoid_list'),
    '忌口列表有文字安全检测')

  check('login 有 msgSecCheck 检测昵称',
    read('cloudfunctions/login/index.js').includes('msgSecCheck') &&
    read('cloudfunctions/login/config.json').includes('security.msgSecCheck'),
    '登录时检测昵称')

  check('preorder-add update_note 有 msgSecCheck',
    read('cloudfunctions/preorder-add/index.js').includes('handleUpdateNote'),
    '更新备注路径也有安全检查')

  check('menu-manage 有 msgSecCheck + imgSecCheck',
    read('cloudfunctions/menu-manage/index.js').includes('checkText') &&
    read('cloudfunctions/menu-manage/config.json').includes('security.imgSecCheck'),
    '菜单管理备注/图片有安全检查')

  check('shopping 批量编辑按钮有 canManage 守卫',
    shoppingWXML.includes('enterBatchMode') && shoppingWXML.includes('canManage'),
    '干饭人不再看到无权限的批量编辑按钮')

  // ── 7o. 超级管理员 + 智能安检 + 布局优化 ──

  // 超级管理员
  const adminJS = read('pages/admin/admin.js')
  const adminWXML = read('pages/admin/admin.wxml')
  const contentAdminCF = read('cloudfunctions/content-admin/index.js')
  check('admin 页面存在',
    adminJS.includes('content-admin') && adminWXML.includes('超管控制台'),
    '管理后台页面正常')
  check('content-admin 使用数据库白名单鉴权',
    contentAdminCF.includes('getAdminOpenids') && contentAdminCF.includes('config'),
    'A+C方案：数据库白名单')
  check('content-admin 有 BOOTSTRAP 兜底',
    contentAdminCF.includes('BOOTSTRAP_OPENID'),
    '首次管理员自动创建')
  check('content-admin 有 list_admins/add_admin/remove_admin',
    contentAdminCF.includes('add_admin') && contentAdminCF.includes('remove_admin'),
    '超级管理员授权管理')
  check('content-admin 有跨家庭内容管理',
    contentAdminCF.includes('list_all') && contentAdminCF.includes('hard_delete'),
    '全局菜品巡查+删除')
  check('admin 页有超级管理员授权 UI',
    adminWXML.includes('添加') && adminWXML.includes('removeAdmin'),
    '可管理超管列表')
  check('profile 页长按进入管理员页面',
    read('pages/profile/profile.wxml').includes('goAdmin') && read('pages/profile/profile.js').includes('goAdmin'),
    '长按关于进入后台')
  check('超级管理员角色与家庭 admin 独立',
    contentAdminCF.includes('admin_openids') && !contentAdminCF.includes("role === 'admin'"),
    '平台超管 ≠ 家庭家长')
  check('content-admin 有全量管理 (list_families/user_set_role/family_delete)',
    contentAdminCF.includes('list_families') && contentAdminCF.includes('user_set_role') && contentAdminCF.includes('family_delete'),
    '超管可管理家庭/用户/菜品/系统')
  check('content-admin dish_toggle_public/family_detail 无 doc().get().data[0] bug',
    contentAdminCF.includes('dish_toggle_public') && contentAdminCF.includes('dishRes.data') && contentAdminCF.includes('familyRes.data'),
    'doc().get() 返回对象非数组')
  check('menu-manage update_status 有 family_id 校验',
    read('cloudfunctions/menu-manage/index.js').includes('family_id !== familyId'),
    '跨家庭操作拦截')
  check('shopping-list generate 纳入 writeActions',
    read('cloudfunctions/shopping-list/index.js').includes("'generate'"),
    'AI 生成需 cook/admin 权限')
  check('dish-detail 公开菜品返回 image_urls_raw',
    read('cloudfunctions/dish-detail/index.js').includes('image_urls_raw') && read('cloudfunctions/dish-detail/index.js').includes('image_urls_raw: imageUrlsRaw'),
    '公开菜编辑不丢图')

  // 退出登录 / 宾客模式守卫
  const authJS = read('utils/auth.js')
  check('family.js loadFamilyInfo 有 _loggedOut 守卫',
    read('pages/family/family.js').includes('_loggedOut'),
    '退出后访问家庭页不自动恢复登录')
  check('admin.js onLoad 有 isLogin 守卫',
    read('pages/admin/admin.js').includes('_loggedOut'),
    '宾客无法进入超管后台')
  check('profile.js onShow 宾客不调接口',
    read('pages/profile/profile.js').includes('!getApp().globalData.isLogin'),
    '宾客模式不加载云端数据')
  check('auth.js refreshRole 检查 isLogin+_loggedOut',
    authJS.includes('!app.globalData.isLogin') && authJS.includes('_loggedOut'),
    'refreshRole 双重守卫')

  // 智能安检（指纹+skip_check）
	  check('dish-add.js saveDish 编辑时始终安检（不再依赖指纹）',
	    dishAddJS.includes('正在检查内容合规性') && !dishAddJS.includes('skip_check: !contentChanged'),
	    '编辑保存始终执行 msgSecCheck，不在前端跳过安检')

  // 首页问候
  check('首页问候不用硬编码张姐',
    homeJS.includes("u.nickName || u.nickname ||") && !homeJS.includes("'张姐'"),
    '真实昵称优先，兜底美食家')

  // 预定页布局
  const preorderWXSS = read('pages/preorder/preorder.wxss')
  check('预定页日期+餐次合并为紧凑卡片',
    preorderWXML.includes('compact-card') && preorderWXML.includes('meal-row'),
    '日期餐次一张卡片')
  check('预定页餐次改为 chips',
    preorderWXML.includes('meal-chip') && preorderWXSS.includes('meal-chip'),
    '更紧凑的餐次选择')
  check('预定页菜品图放大到 200rpx',
    preorderWXSS.includes('200rpx'),
    '更多预览空间')

  // 图片先传后审
  check('dish-add chooseImage 用 uploadFile + img-check',
    dishAddJS.includes('uploadFile') && dishAddJS.includes('img-check'),
    '上传→云函数下载检测→合规保留/违规删除')
  check('dish-add 编辑模式不重复上传旧图',
    dishAddJS.includes('editingId') && dishAddJS.includes('editRawImages'),
    '编辑时用原始cloud://文件')
}
// ============================================================
// 8. 测试脚本版本同步
// ============================================================
function checkTestScripts() {
  console.log('\n--- 7. 测试脚本同步 ---')
  
  const smoke = read('tests/smoke-test.js')
  const role = read('tests/role-test.js')
  const cloud = read('tests/cloud-regression.js')
  
  check('smoke-test.js 版本 v1.2.3', smoke.includes('v1.2.3'))
  check('smoke-test.js 使用 wsEndpoint 连接', smoke.includes('wsEndpoint'))
  check('smoke-test.js 有 today 检查', smoke.includes('typeof this.data.today'))
  check('smoke-test.js 有家庭头像/昵称一致性检查', smoke.includes('familyConsistency'))
  check('smoke-test.js 有历史锁定检查', smoke.includes('历史记录'))
  
  check('role-test.js 有 today 检查', role.includes('typeof this.data.today'))
  check('role-test.js 使用 wsEndpoint 连接', role.includes('wsEndpoint'))
  
  check('cloud-regression.js 版本 v1.2.3', cloud.includes('v1.2.3'))
}

// ============================================================
// 9. 文件清理
// ============================================================
function checkCleanup() {
  console.log('\n--- 9. 清理确认 ---')
  
  const nulPath = path.join(ROOT, 'nul')
  check('nul 文件已删除', !fs.existsSync(nulPath), 'Windows 保留设备名')
}

// ============================================================
// 10. App 启动超时修复
// ============================================================
function checkStartupTimeout() {
  console.log('\n--- 10. 启动超时修复 ---')
  
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
// 11. v1.2.4 审核合规修复：头像+全场景内容安全覆盖
// ============================================================
function checkV124AuditFixes() {
  console.log('\n--- 11. v1.2.4 审核合规修复 ---')

  // 11a. login 云函数：新增头像 imgSecCheck
  const loginCF = read('cloudfunctions/login/index.js')
  check('login 有 imgSecCheck 检测头像 (v1.2.4)',
    loginCF.includes('imgSecCheck') && loginCF.includes('avatar'),
    '登录时头像图片需经过内容安全检测')
  check('login imgSecCheck 使用 downloadFile 下载云存储图片',
    loginCF.includes('downloadFile({ fileID: avatar })'),
    '从云存储下载头像后检测')
  check('login imgSecCheck 失败时 fail-close 拒绝登录',
    loginCF.includes('头像包含违规内容') && loginCF.includes('头像安全检查暂时不可用'),
    '图片违规或API异常时拒绝头像上传')
  check('login config.json 有 security.imgSecCheck 权限 (v1.2.4)',
    read('cloudfunctions/login/config.json').includes('security.imgSecCheck'),
    '权限声明中添加了图片安全检测')

  // 11b. content-admin 云函数：新增 dish_edit msgSecCheck
  const contentAdminCF = read('cloudfunctions/content-admin/index.js')
  check('content-admin dish_edit 有 msgSecCheck (v1.2.4)',
    contentAdminCF.includes('dish_edit') && contentAdminCF.includes('msgSecCheck'),
    '超管编辑菜品名称时需经过文本安全检测')
  check('content-admin msgSecCheck 使用 v2.0 格式 (openid+scene+version)',
    contentAdminCF.includes('openid: OPENID') && contentAdminCF.includes('scene: 2') && contentAdminCF.includes('version: 2'),
    '遵循 v2.0 标准调用格式')
  check('content-admin msgSecCheck 用 result.suggest 判断',
    contentAdminCF.includes('result.suggest'),
    'v2.0 返回 suggest: pass/risky/review')
  check('content-admin msgSecCheck fail-close',
    contentAdminCF.includes('内容安全检查暂时不可用'),
    'API异常时拒绝提交')
  check('content-admin config.json 有 security.msgSecCheck 权限 (v1.2.4)',
    read('cloudfunctions/content-admin/config.json').includes('security.msgSecCheck'),
    '之前 config.json 无权限声明')

  // 11c. profile.js 前端：安全检查失败时回退乐观更新（v1.2.4 修复）
  const profileJS = read('pages/profile/profile.js')
  check('profile saveUserInfoAndLogin catch 回退违规头像',
    profileJS.includes('msg.includes(\'头像\')') && profileJS.includes('prevAvatar'),
    '登录安全检测失败时回退本地违规头像（用旧值非空值）')
  check('profile saveUserInfoAndLogin catch 回退违规昵称',
    profileJS.includes('msg.includes(\'昵称\')') && profileJS.includes('prevNick'),
    '昵称违规时回退为旧值（非硬编码默认值）')
  check('profile changeAvatar 先审后显（v1.2.4 修复）',
    profileJS.includes('正在检查头像') && profileJS.includes('deleteFile({ fileList: [fileID] })'),
    '云函数检查通过后才更新 UI，违规图片从云存储清除')
  check('profile saveNickname 先审后显（v1.2.4 修复）',
    profileJS.includes('先审后显') && profileJS.includes('update_user_info'),
    '改昵称云函数通过后才更新 UI')
  check('profile addAvoid 先审后显（v1.2.4 修复）',
    profileJS.includes('先审后显') && !profileJS.includes('filter(item => item !== val)'),
    '云函数检查通过后才显示忌口标签')
  check('profile showAbout 含 ICP 备案号 (v1.2.4)',
    profileJS.includes('沪ICP备2026029453号-1X'),
    '关于弹窗展示 ICP 备案信息')

  // 11d. 其他云函数权限声明完整性（确认无遗漏）
  check('img-check config 有 imgSecCheck',
    read('cloudfunctions/img-check/config.json').includes('security.imgSecCheck'),
    '专用图片检测云函数权限')
  check('media-check config 有 mediaCheckAsync',
    read('cloudfunctions/media-check/config.json').includes('security.mediaCheckAsync'),
    '异步媒体检测权限')
  check('dish-add config 同时有 msgSecCheck + imgSecCheck',
    read('cloudfunctions/dish-add/config.json').includes('security.msgSecCheck') &&
    read('cloudfunctions/dish-add/config.json').includes('security.imgSecCheck'),
    '菜品添加/编辑需文本+图片双检测')
  check('menu-manage config 同时有 msgSecCheck + imgSecCheck',
    read('cloudfunctions/menu-manage/config.json').includes('security.msgSecCheck') &&
    read('cloudfunctions/menu-manage/config.json').includes('security.imgSecCheck'),
    '菜单管理需文本+图片双检测')
  check('profile-manage config 同时有 msgSecCheck + imgSecCheck',
    read('cloudfunctions/profile-manage/config.json').includes('security.msgSecCheck') &&
    read('cloudfunctions/profile-manage/config.json').includes('security.imgSecCheck'),
    '个人资料需文本+图片双检测')

	  // 11e. AI 云函数展示前内容安全检测（v1.2.4 审核合规修复）
	  check('ai-generate 有 msgSecCheck 展示前检测 (v1.2.4)',
	    read('cloudfunctions/ai-generate/index.js').includes('msgSecCheck') &&
	    read('cloudfunctions/ai-generate/config.json').includes('security.msgSecCheck'),
	    'AI 推荐菜品展示前需文本安全检测')
	  check('ai-generate 检测失败过滤违规菜品',
	    read('cloudfunctions/ai-generate/index.js').includes('safeDishes'),
	    '违规 AI 菜品从结果中排除')
	  check('ai-generate 全部违规时有兜底提示',
	    read('cloudfunctions/ai-generate/index.js').includes('safeDishes.length === 0'),
	    '所有 AI 结果不通过时返回错误消息')

	  check('ai-nutrition 有 msgSecCheck 展示前检测 (v1.2.4)',
	    read('cloudfunctions/ai-nutrition/index.js').includes('msgSecCheck') &&
	    read('cloudfunctions/ai-nutrition/config.json').includes('security.msgSecCheck'),
	    'AI 营养分析展示前需文本安全检测')
	  check('ai-nutrition 有 raw fallback 安全检查',
	    read('cloudfunctions/ai-nutrition/index.js').includes('rawCheck'),
	    'JSON 解析失败时的原始文本也需检测')

	  check('ai-schedule 有 msgSecCheck 展示前检测 (v1.2.4)',
	    read('cloudfunctions/ai-schedule/index.js').includes('msgSecCheck') &&
	    read('cloudfunctions/ai-schedule/config.json').includes('security.msgSecCheck'),
	    'AI 排期展示前需文本安全检测')
	  check('ai-schedule 有 raw fallback 安全检查',
	    read('cloudfunctions/ai-schedule/index.js').includes('rawCheck'),
	    'JSON 解析失败时的原始文本也需检测')

	  check('ai-shopping 有 msgSecCheck 展示前检测 (v1.2.4)',
	    read('cloudfunctions/ai-shopping/index.js').includes('msgSecCheck') &&
	    read('cloudfunctions/ai-shopping/config.json').includes('security.msgSecCheck'),
	    'AI 采购清单展示前需文本安全检测')
		  check('ai-shopping 有 raw fallback 安全检查',
		    read('cloudfunctions/ai-shopping/index.js').includes('rawCheck'),
		    'JSON 解析失败时的原始文本也需检测')

		  // 11h. imgSecCheck 87014 处理 + 先审后显覆盖（v1.2.4）
		  check('profile-manage imgSecCheck catch 处理 87014',
		    read('cloudfunctions/profile-manage/index.js').includes('errCode === 87014'),
		    '图片违规时正确提示而非显示暂时不可用')
		  check('login imgSecCheck catch 处理 87014',
		    read('cloudfunctions/login/index.js').includes('errCode === 87014'),
		    '登录头像违规时正确提示')
		  check('shopping confirmAddItem 先审后显',
		    read('pages/shopping/shopping.js').includes('rebuildRawItemsForList'),
		    '采购添加食材云函数通过后才加载列表')

		  // 11g. 意见反馈功能（v1.2.4 新增，通过 profile-manage 复用权限）
		  check('profile-manage 有 submit_feedback action',
		    read('cloudfunctions/profile-manage/index.js').includes('submit_feedback'),
		    '反馈提交复用已有 msgSecCheck 权限的云函数')
		  check('profile-manage feedback 有 msgSecCheck 检测',
		    read('cloudfunctions/profile-manage/index.js').includes('submit_feedback') &&
		    read('cloudfunctions/profile-manage/index.js').includes('feedback') &&
		    read('cloudfunctions/profile-manage/config.json').includes('security.msgSecCheck'),
		    '反馈内容提交前有文本安全检测（复用已验证权限）')
		  check('profile 有意见反馈入口',
		    read('pages/profile/profile.wxml').includes('意见反馈') &&
		    read('pages/profile/profile.wxml').includes('openFeedback'),
		    '我的页面菜单中显示反馈入口')
		  check('profile 反馈弹窗有 textarea',
		    read('pages/profile/profile.wxml').includes('feedbackText') &&
		    read('pages/profile/profile.wxml').includes('submitFeedback'),
		    '反馈弹窗含输入框和提交按钮')
		  check('profile 反馈需登录守卫',
		    read('pages/profile/profile.js').includes('请先登录'),
		    '宾客点击反馈提示登录')
		  check('profile 提交后清空弹窗',
		    read('pages/profile/profile.js').includes("feedbackText: ''"),
		    '反馈成功后重置输入')

	  // 11f. 确认无遗漏：其他只读或非UGC云函数不需要安全权限
  check('dish-detail 无 config（只读）',
    !fs.existsSync(path.join(ROOT, 'cloudfunctions/dish-detail/config.json')),
    '只读查询无需安全权限')
  check('family-join 无 config（只读+邀请码非UGC）',
    !fs.existsSync(path.join(ROOT, 'cloudfunctions/family-join/config.json')),
    '邀请码是系统生成的码，非用户内容')
}


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
  console.log('=== 张姐私房菜谱 v1.2.4 静态回归检查 ===\n')
  
  checkEditFix()
  checkHistoricalLock()
  checkFamilySync()
  checkAppLaunch()
  checkVersion()
  checkAuditFixes()
  checkRoleCoverage()
  checkTestScripts()
  checkCleanup()
  checkStartupTimeout()
  checkV124AuditFixes()

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
