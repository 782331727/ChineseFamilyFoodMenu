// 原子接口：取消自己的预定
async function cancelPreorder({ preorder_id } = {}) {
  if (!preorder_id) {
    return {
      isError: true,
      content: [{ type: 'text', text: '请提供预定记录ID。' }]
    }
  }
  try {
    const res = await wx.cloud.callFunction({
      name: 'preorder-add',
      data: { action: 'cancel', preorder_id }
    })
    const result = res.result
    if (result && result.code === 0) {
      return {
        content: [{ type: 'text', text: '预定已取消。' }],
        structuredContent: { _id: preorder_id }
      }
    } else {
      return {
        isError: true,
        content: [{ type: 'text', text: (result && result.message) || '取消失败，请稍后重试。' }]
      }
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: '取消失败，请检查网络后重试。' }]
    }
  }
}

module.exports = cancelPreorder
