# MEMORY.md — 长期记忆

## 开发版本发布 checklist

每次准备提交开发版本时，需要更新以下文件：

### 1. README.md — 版本号 + 变更记录
- 底部「版本」区新增一条，格式：`vX.Y.Z — YYYY.MM.DD`
- 变更记录用简洁 emoji-bullet 风格，每行一个要点，不加冒号解释
- 示例：
  ```
  v1.1.1 — 2026.06.21
  - 🛒 采购页新增批量编辑
  - 🐛 修复批量删除后菜品仍出现
  - 🛡️ 游客点评分前置拦截
  ```

### 2. 云函数部署（如有修改）
- 通过 MCP (`manageFunctions action=updateFunctionCode`) 重新部署修改过的云函数
- 部署后调用 `queryFunctions action=listFunctionLogs` 拉取最近日志验证

### 3. 不需要更新的文件
- `pages/profile/profile.js` 的 showAbout 弹窗：已精简为无版本号的纯介绍文案，无需维护
- 没有单独的 CHANGELOG.md 或 reported/ 目录，全部集中在 README.md

### 代码风格约束
- 注释只写代码无法表达的意图/权衡/约束，不写「// 定义函数」「// 返回结果」之类
- 与既有风格保持一致（如版本备注的简洁度）