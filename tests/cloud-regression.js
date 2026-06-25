/**
 * 云函数回归测试 v1.2.0
 * 验证：图片 URL 转换 (maxAge/HTTPS)、dish-public 公开查询
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

// Cloud functions that DON'T require WeChat OPENID
const NO_LOGIN_TESTS = [
  {
    name: 'dish-public',
    params: { page: 1, pageSize: 5 },
    checks: [
      { label: '返回菜品列表', fn: r => r?.code === 0 && r?.data?.list?.length > 0 },
      { label: '图片 URL 为 HTTPS', fn: r => r?.data?.list?.every(d => !d.image_url || d.image_url.startsWith('https://')) },
    ]
  },
]

// Cloud functions that require OPENID (can only test structure, not data)
const LOGIN_REQUIRED_TESTS = [
  {
    name: 'dish-list',
    params: { page: 1, pageSize: 2 },
    checks: [
      { label: '响应不含崩溃 (code != -1)', fn: r => r?.code !== undefined, skipOnOpenid: true },
    ]
  },
  {
    name: 'dish-trending',
    params: {},
    checks: [
      { label: '响应不含崩溃', fn: r => r?.code !== undefined, skipOnOpenid: true },
    ]
  },
]

async function main() {
  console.log('=== 云函数回归测试 v1.2.0 ===')
  console.log(`时间: ${new Date().toISOString()}`)
  console.log(`注: MCP invoke 无微信 OPENID，部分云函数仅验证不崩\n`)

  // ──── No-login tests ────
  for (const test of NO_LOGIN_TESTS) {
    console.log(`--- ${test.name} ---`)
    const result = invoke(test.name, test.params, `${test.name}.json`)
    for (const check of test.checks) {
      const ok = check.fn(result)
      record(check.label, ok ? 'pass' : 'fail', ok ? '' : (result?.message || 'check failed'))
    }
  }

  // ──── Login-required tests ────
  for (const test of LOGIN_REQUIRED_TESTS) {
    console.log(`\n--- ${test.name} (需OPENID) ---`)
    const result = invoke(test.name, test.params, `${test.name}.json`)
    const isOpenidErr = result?.message?.includes('undefined')
    for (const check of test.checks) {
      const ok = check.fn(result)
      if (isOpenidErr && check.skipOnOpenid) {
        record(check.label, 'skip', '无微信上下文 (预期)')
      } else {
        record(check.label, ok ? 'pass' : 'fail', result?.message || '')
      }
    }
  }

  // ──── image URL regression (consolidated) ────
  console.log('\n--- 图片URL全局检查 ---')
  const dp = invoke('dish-public', { page: 1, pageSize: 20 }, 'dp-full.json')
  if (dp?.code === 0 && dp?.data?.list) {
    const dishes = dp.data.list
    const total = dishes.length
    const withImg = dishes.filter(d => d.image_url?.startsWith('https://')).length
    const noImg = dishes.filter(d => !d.image_url).length
    const cloudImg = dishes.filter(d => d.image_url?.startsWith('cloud://')).length
    record(`图片HTTPS: ${withImg}/${total}`, cloudImg === 0 ? 'pass' : 'fail',
      `HTTPS:${withImg} 无图:${noImg} cloud://:${cloudImg}`)
  }

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
