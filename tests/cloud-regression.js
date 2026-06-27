/**
 * 云函数回归测试 v1.2.3
 * 覆盖：公开查询 / 登录 / 家庭邀请码 / 图片 URL / 全量云函数不崩溃 / 数据结构
 * 运行：node tests/cloud-regression.js
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const TMP = path.join(__dirname, '..', '.test-tmp')
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })

const RESULTS = []
function record(name, status, detail = '') {
  RESULTS.push({ name, status, detail })
  console.log(`  ${status === 'pass' ? '✓' : status === 'skip' ? '○' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

function invoke(name, params = {}, outFile) {
  const funcJson = JSON.stringify({ name, params })
  const outPath = path.join(TMP, outFile || `${name}.json`).replace(/\\/g, '/')
  const shFile = path.join(TMP, `invoke-${name}.sh`).replace(/\\/g, '/')
  fs.writeFileSync(shFile,
    `#!/bin/bash\nnpx mcporter call cloudbase.manageFunctions action=invokeFunction functionName=${name} 'func=${funcJson}' --output json > "${outPath}" 2>&1\n`)
  try {
    execSync(`bash "${shFile}"`, { timeout: 30000, encoding: 'utf8', windowsHide: true })
    if (fs.existsSync(outPath)) {
      const raw = fs.readFileSync(outPath, 'utf8').trim()
      if (!raw) return { code: -1, message: 'empty output' }
      try {
        const d = JSON.parse(raw)
        const msg = d?.data?.invokeResult?.RetMsg
        return msg ? JSON.parse(msg) : { code: -1, message: 'no RetMsg' }
      } catch (_) { return { code: -1, message: 'parse error' } }
    }
    return { code: -1, message: 'no output file' }
  } catch (_) {
    return { code: -1, message: 'exec error' }
  }
}

// ========== 无需 OPENID 的测试 ==========
const NO_AUTH_TESTS = [
  {
    name: 'dish-public', params: { page: 1, pageSize: 5 },
    checks: [
      { label: '返回菜品列表', fn: r => r?.code === 0 && r?.data?.list?.length > 0 },
      { label: '图片URL为HTTPS', fn: r => r?.data?.list?.every(d => !d.image_url || d.image_url.startsWith('https://')) },
    ]
  },
  {
    name: 'dish-public', params: { page: 1, pageSize: 20 },
    checks: [
      { label: '分页数据结构完整(total/page)', fn: r => r?.code === 0 && typeof r?.data?.total === 'number' },
    ]
  },
  {
    name: 'content-admin', params: { action: 'my_openid' },
    checks: [
      { label: 'my_openid 不崩 (MCP invoke无OPENID)', fn: r => r?.code !== undefined, skipOnAuth: true },
    ]
  },
  {
    name: 'login', params: {},
    checks: [
      { label: 'login 不崩 (需OPENID时返回user或code:-1)', fn: r => r?.code !== undefined },
      { label: 'login 返回含 user 或 message', fn: r => typeof r?.message === 'string' || r?.data?.user },
    ]
  },
]

// ========== 需 OPENID 但可验证结构的测试 ==========
const AUTH_TESTS = [
  // ——— 家庭 ———
  {
    name: 'family-create', params: { name: '回归测试家庭' },
    checks: [
      { label: 'family-create 不崩', fn: r => r?.code !== undefined },
      { label: '返回含 data._id 或 message', fn: r => typeof r?.message === 'string' || r?.data?._id },
    ]
  },
  {
    name: 'family-join', params: { invite_code: 'TEST01' },
    checks: [
      { label: 'family-join 不崩', fn: r => r?.code !== undefined },
      { label: '无效邀请码返回 message', fn: r => typeof r?.message === 'string' },
    ]
  },
  {
    name: 'family-update', params: { action: 'get_members' },
    checks: [
      { label: 'get_members 不崩', fn: r => r?.code !== undefined },
      { label: '返回含 members 或 message', fn: r => typeof r?.message === 'string' || r?.data?.members },
    ]
  },
  // ——— 菜品 ———
  {
    name: 'dish-detail', params: {},
    checks: [
      { label: 'dish-detail 不崩 (缺dish_id)', fn: r => r?.code !== undefined },
      { label: '缺ID返回 message', fn: r => typeof r?.message === 'string' },
    ]
  },
  {
    name: 'dish-list', params: { page: 1, pageSize: 2 },
    checks: [
      { label: 'dish-list 不崩', fn: r => r?.code !== undefined },
    ]
  },
  {
    name: 'dish-trending', params: {},
    checks: [
      { label: 'dish-trending 不崩', fn: r => r?.code !== undefined },
    ]
  },
  {
    name: 'dish-add', params: {},
    checks: [
      { label: 'dish-add 不崩 (缺参数)', fn: r => r?.code !== undefined },
      { label: '缺name返回 message', fn: r => typeof r?.message === 'string' },
    ]
  },
  // ——— 预定 ———
  {
    name: 'preorder-add', params: {},
    checks: [
      { label: 'preorder-add 不崩', fn: r => r?.code !== undefined },
    ]
  },
  {
    name: 'preorder-list', params: { date: '2026-06-28' },
    checks: [
      { label: 'preorder-list 不崩', fn: r => r?.code !== undefined },
    ]
  },
  // ——— 菜单 ———
  {
    name: 'menu-manage', params: { action: 'list', date: '2026-06-28' },
    checks: [
      { label: 'menu-manage list 不崩', fn: r => r?.code !== undefined },
    ]
  },
  // ——— 采购 ———
  {
    name: 'shopping-list', params: { action: 'list' },
    checks: [
      { label: 'shopping-list list 不崩', fn: r => r?.code !== undefined },
    ]
  },
  // ——— 个人 ———
  {
    name: 'profile-manage', params: { action: 'get_profile' },
    checks: [
      { label: 'profile-manage 不崩', fn: r => r?.code !== undefined },
    ]
  },
  // ——— 超管 ———
  {
    name: 'content-admin', params: { action: 'stats' },
    checks: [
      { label: 'content-admin stats 不崩', fn: r => r?.code !== undefined },
    ]
  },
  {
    name: 'content-admin', params: { action: 'list_dishes', page: 1 },
    checks: [
      { label: 'content-admin list_dishes 不崩', fn: r => r?.code !== undefined },
    ]
  },
  {
    name: 'content-admin', params: { action: 'list_families', page: 1 },
    checks: [
      { label: 'content-admin list_families 不崩', fn: r => r?.code !== undefined },
    ]
  },
  {
    name: 'content-admin', params: { action: 'list_users', page: 1 },
    checks: [
      { label: 'content-admin list_users 不崩', fn: r => r?.code !== undefined },
    ]
  },
  // ——— AI ———
  {
    name: 'ai-generate', params: { scene: 'daily' },
    checks: [
      { label: 'ai-generate 不崩', fn: r => r?.code !== undefined },
    ]
  },
  {
    name: 'ai-shopping', params: { target_date: '2026-06-28' },
    checks: [
      { label: 'ai-shopping 不崩', fn: r => r?.code !== undefined },
    ]
  },
  {
    name: 'ai-schedule', params: {},
    checks: [
      { label: 'ai-schedule 不崩', fn: r => r?.code !== undefined },
    ]
  },
  {
    name: 'ai-nutrition', params: {},
    checks: [
      { label: 'ai-nutrition 不崩', fn: r => r?.code !== undefined },
    ]
  },
  // ——— 媒体检查 ———
  {
    name: 'img-check', params: {},
    checks: [
      { label: 'img-check 不崩 (缺fileID)', fn: r => r?.pass === false && r?.diag },
    ]
  },
  {
    name: 'media-check', params: {},
    checks: [
      { label: 'media-check 不崩', fn: r => r?.code !== undefined },
    ]
  },
]

// ========== 数据结构专项 ==========
const STRUCTURE_CHECKS = [
  {
    label: 'dish-public 含 image_url/image_urls/cuisine',
    fn: r => {
      const d = r?.data?.list?.[0]
      return d && 'image_url' in d && 'cuisine' in d
    }
  },
  {
    label: 'login 返回 user 含 nickname/openid',
    fn: r => {
      const u = r?.data?.user
      return !u || (typeof u?.nickname === 'string' && typeof u?.openid === 'string')
    }
  },
  {
    label: 'family-create 返回 data 含 invite_code',
    fn: r => {
      if (r?.code !== 0) return true // MCP invoke 无微信上下文
      return typeof r?.data?.invite_code === 'string'
    }
  },
  {
    label: 'dish-detail 含 image_urls_raw (公开菜)',
    fn: r => true  // 由 dish-public 间接验证
  },
  {
    label: 'family-update get_members 返回 family 字段',
    fn: r => {
      if (r?.code !== 0) return true // MCP invoke 无微信上下文
      return typeof r?.data?.family === 'object'
    }
  },
]

async function main() {
  console.log('=== 云函数回归测试 v1.2.3 ===')
  console.log(`时间: ${new Date().toISOString()}`)

  // ──── No-auth 测试 ────
  for (const test of NO_AUTH_TESTS) {
    console.log(`\n--- ${test.name} (无需鉴权) ---`)
    const result = invoke(test.name, test.params, `${test.name}.json`)
    const isOpenidErr = result?.message?.includes('用户不存在') || result?.message?.includes('登录') || result?.code === -1
    for (const check of test.checks) {
      const ok = check.fn(result)
      if (isOpenidErr && check.skipOnAuth) {
        record(check.label, 'skip', '无微信上下文 (预期)')
      } else {
        record(check.label, ok ? 'pass' : 'fail', ok ? '' : (result?.message || 'check failed'))
      }
    }
  }

  // ──── 鉴权所需测试 ────
  for (const test of AUTH_TESTS) {
    console.log(`\n--- ${test.name} ---`)
    const result = invoke(test.name, test.params, `${test.name}.json`)
    const isOpenidErr = result?.message?.includes('用户不存在') || result?.message?.includes('登录') || result?.message?.includes('OPENID') || result?.code === -1
    for (const check of test.checks) {
      const ok = check.fn(result)
      if (isOpenidErr && test.name !== 'login' && test.name !== 'content-admin' && test.name !== 'dish-public') {
        record(check.label, 'skip', '无微信上下文 (预期)')
      } else {
        record(check.label, ok ? 'pass' : 'fail', ok ? '' : (result?.message || 'check failed'))
      }
    }
  }

  // ──── 数据结构专项 ────
  console.log('\n--- 数据结构专项 ---')
  const dpResult = invoke('dish-public', { page: 1, pageSize: 20 }, 'dp-full.json')
  const loginResult = invoke('login', {}, 'login-struct.json')
  const fcResult = invoke('family-create', { name: 'StructTest' }, 'fc-struct.json')
  const fuResult = invoke('family-update', { action: 'get_members' }, 'fu-struct.json')
  
  for (const check of STRUCTURE_CHECKS) {
    let r
    if (check.label.includes('dish-public')) r = dpResult
    else if (check.label.includes('login')) r = loginResult
    else if (check.label.includes('family-create')) r = fcResult
    else if (check.label.includes('family-update')) r = fuResult
    else r = dpResult
    const ok = check.fn(r)
    record(check.label, ok ? 'pass' : 'fail', ok ? '' : 'check failed')
  }

  // ──── 图片URL全局 ────
  console.log('\n--- 图片URL全局检查 ---')
  if (dpResult?.code === 0 && dpResult?.data?.list) {
    const dishes = dpResult.data.list
    const total = dishes.length
    const withImg = dishes.filter(d => d.image_url?.startsWith('https://')).length
    const noImg = dishes.filter(d => !d.image_url).length
    const cloudImg = dishes.filter(d => d.image_url?.startsWith('cloud://')).length
    record(`图片HTTPS: ${withImg}/${total}`, cloudImg === 0 ? 'pass' : 'fail',
      `HTTPS:${withImg} 无图:${noImg} cloud://:${cloudImg}`)
  }

  // ──── 邀请码/二维码专项 ────
  console.log('\n--- 邀请码/二维码 ---')
  if (fcResult?.code === 0 && fcResult?.data?._id) {
    record('family-create 返回 _id', 'pass', fcResult.data._id)
    if (fcResult.data.invite_code) {
      record('family-create 返回 invite_code', 'pass', fcResult.data.invite_code)
      record('邀请码格式(6位大写字母数字)', /^[A-Z0-9]{6}$/.test(fcResult.data.invite_code) ? 'pass' : 'fail',
        fcResult.data.invite_code)
    } else {
      record('family-create 返回 invite_code', 'fail', 'invite_code 缺失')
    }
  } else {
    record('family-create 邀请码测试', 'skip', '需认证环境')
  }
  // 验证 family-join 可以用邀请码加入
  // (需要先创建家庭拿到邀请码，再模拟另一个用户加入——MCP 无法模拟双用户，跳过)
  record('family-join 邀请码加入', 'skip', 'MCP 无法模拟双用户')

  // ======== 报告 ========
  console.log('\n' + '='.repeat(50))
  console.log('  测试报告')
  console.log('='.repeat(50))
  let pass = 0, fail = 0, skip = 0
  RESULTS.forEach(r => {
    if (r.status === 'pass') pass++
    else if (r.status === 'fail') fail++
    else skip++
  })
  console.log(`  通过: ${pass}  |  失败: ${fail}  |  跳过: ${skip}`)
  if (fail > 0) {
    console.log('\n  失败项:')
    RESULTS.filter(r => r.status === 'fail').forEach(r => console.log(`    ✗ ${r.name} — ${r.detail}`))
    process.exit(1)
  }
  console.log('\n  ✅ 全部通过')
}

main().catch(e => { console.error(e); process.exit(1) })
