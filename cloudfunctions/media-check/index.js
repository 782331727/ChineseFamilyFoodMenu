// 云函数：media-check
// 接收 cloud fileID，获取临时 URL 后调用 mediaCheckAsync (v2.0) 异步检测
// 立即返回 trace_id，检测结果由微信服务端异步推送

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { fileID, openid } = event
  if (!fileID || !fileID.startsWith('cloud://')) {
    return { code: -1, message: '无效的文件ID' }
  }

  try {
    // 获取临时 HTTPS URL
    const tmpRes = await cloud.getTempFileURL({ fileList: [fileID] })
    const mediaUrl = tmpRes.fileList[0] && tmpRes.fileList[0].tempFileURL
    if (!mediaUrl) return { code: -1, message: '获取图片URL失败' }

    // 调用 mediaCheckAsync v2.0（异步，立即返回 trace_id）
    const checkRes = await cloud.openapi.security.mediaCheckAsync({
      openid: openid || '',
      scene: 2,        // 2=评论/发布
      version: 2,      // 2.0 接口
      media_url: mediaUrl,
      media_type: 2    // 2=图片
    })

    return {
      code: 0,
      trace_id: checkRes.traceId || checkRes.trace_id || '',
      errcode: checkRes.errcode || 0
    }
  } catch (e) {
    console.error('[media-check] 调用失败:', e.errcode || e.errCode, e.message || e.errMsg)
    return { code: -1, message: e.message || e.errMsg || '检测提交失败' }
  }
}
