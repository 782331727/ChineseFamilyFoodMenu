// 原子接口：查看当前用户的所有预订单
async function getMyPreorders() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'preorder-add',
      data: { action: 'my_list' }
    })
    const data = res.result && res.result.code === 0 ? res.result.data : null
    const preorders = (data && data.preorders) || []

    return {
      content: [{ type: 'text', text: preorders.length > 0 ? `您共有 ${preorders.length} 条预定记录。` : '您目前没有预定记录。' }],
      structuredContent: { preorders }
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: '查询预订单失败，请稍后重试。' }]
    }
  }
}

module.exports = getMyPreorders
