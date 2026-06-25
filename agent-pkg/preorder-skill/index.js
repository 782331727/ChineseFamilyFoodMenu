// preorder-skill: 注册所有原子接口
const getMyPreorders = require('./apis/getMyPreorders')
const addPreorder = require('./apis/addPreorder')
const cancelPreorder = require('./apis/cancelPreorder')
const getFamilyPreorders = require('./apis/getFamilyPreorders')

module.exports = {
  getMyPreorders,
  addPreorder,
  cancelPreorder,
  getFamilyPreorders
}
