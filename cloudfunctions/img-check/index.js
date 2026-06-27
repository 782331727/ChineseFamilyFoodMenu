// 云函数：img-check
// 接收云存储 fileID，下载后调用 imgSecCheck 同步返回结果

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { fileID } = event
  if (!fileID || !fileID.startsWith('cloud://')) {
    return { pass: false, diag: 'invalid fileID' }
  }

  try {
    const downloadRes = await cloud.downloadFile({ fileID })
    const buffer = downloadRes.fileContent

    const res = await cloud.openapi.security.imgSecCheck({
      media: { contentType: 'image/jpeg', value: buffer }
    })

    return {
      pass: res.errCode === 0,
      errCode: res.errCode,
      diag: `size=${buffer.length} code=${res.errCode}`
    }
  } catch (e) {
    return {
      pass: false,
      errCode: e.errCode || -1,
      diag: `catch: code=${e.errCode} msg=${e.message || e.errMsg || ''}`
    }
  }
}
