// pages/dish-add/dish-add.js
const { callFunction, uploadImage } = require('../../utils/api')
const { requirePermission } = require('../../utils/auth')
const { mapDish, dishToCloud } = require('../../utils/mapper')

Page({
  data: {
    currentTab: 'manual',
    editingId: '',
    // AI表单
    aiForm: {
      scene: 'daily',
      ingredients: '',
      people: 4,
      meal: 'all'
    },
    mealOptions: [
      { value: 'all', emoji: '🍽️', label: '不限' },
      { value: 'breakfast', emoji: '🌅', label: '早餐' },
      { value: 'lunch', emoji: '☀️', label: '午餐' },
      { value: 'dinner', emoji: '🌙', label: '晚餐' }
    ],
    scenes: [
      { value: 'daily', emoji: '🏠', label: '日常' },
      { value: 'festival', emoji: '🎉', label: '节日' },
      { value: 'quick', emoji: '⚡', label: '快手' },
      { value: 'fridge', emoji: '🧊', label: '清冰箱' }
    ],
    aiResults: [],
    aiGenerating: false,
    // 手动表单
    form: {
      name: '',
      image: '',
      categoryIndex: 0,
      difficulty: 'easy',
      cookTime: '',
      tags: [],
      isPublic: false,
      ingredients: [{ name: '', amount: '' }],
      steps: ['']
    },
    categoryOptions: ['家常', '硬菜', '快手', '早餐', '汤', '甜品', '水果', '主食', '其他'],
    difficultyOptions: [
      { value: 'easy', label: '简单' },
      { value: 'medium', label: '中等' },
      { value: 'hard', label: '困难' }
    ],
    tagInput: ''
  },

  onLoad(options) {
    if (options.tab === 'ai') {
      this.setData({ currentTab: 'ai' })
    }
    if (options.id) {
      this.setData({ editingId: options.id })
      this.loadDishForEdit(options.id)
    }
  },

  // 切换Tab
  switchTab(e) {
    this.setData({ currentTab: e.currentTarget.dataset.tab })
  },

  // === AI 相关 ===
  selectScene(e) {
    this.setData({ 'aiForm.scene': e.currentTarget.dataset.value })
  },

  selectMeal(e) {
    this.setData({ 'aiForm.meal': e.currentTarget.dataset.value })
  },

  onAiIngredientInput(e) {
    this.setData({ 'aiForm.ingredients': e.detail.value })
  },

  increasePeople() {
    this.setData({ 'aiForm.people': this.data.aiForm.people + 1 })
  },

  decreasePeople() {
    if (this.data.aiForm.people > 1) {
      this.setData({ 'aiForm.people': this.data.aiForm.people - 1 })
    }
  },

  // 调用 ai-generate 云函数
  // 云函数参数：scene, ingredients, members, season, budget, equipment
  // 返回：{ dishes: [...], source: 'ai' }
  generateDishes() {
    if (this.data.aiGenerating) return
    this.setData({ aiGenerating: true, aiResults: [] })

    callFunction('ai-generate', {
      scene: this.data.aiForm.scene,
      ingredients: this.data.aiForm.ingredients,
      members: `${this.data.aiForm.people}人`,
      meal: this.data.aiForm.meal
    }).then(data => {
      const dishes = (data && data.dishes) || []
      // 把 AI 返回的菜品映射为前端格式
      // AI 可能返回 cuisine(菜系)、nutrition_tags(营养标签)、suitable_for(适合人群)
      // 合并去重，让筛选时可以按任意标签搜到这道菜
      const aiResults = dishes.map(d => {
        const aiTags = [...new Set([
          d.cuisine,
          ...(d.nutrition_tags || []),
          ...(d.suitable_for || [])
        ].filter(Boolean))]
        return {
          name: d.name || '未知菜品',
          description: d.tips || '',
          ingredientsList: (d.ingredients || []).map(i => ({ name: i.name || '', amount: i.amount || '' })),
          steps: d.steps || [],
          difficultyValue: d.difficulty === '较难' ? 'hard' : d.difficulty === '中等' ? 'medium' : 'easy',
          cookTime: d.cook_time || 30,
          tags: aiTags,
          category: d.cuisine || '家常',
          image: ''
        }
      })
      this.setData({ aiResults, aiGenerating: false })
    }).catch(() => {
      this.setData({ aiGenerating: false })
    })
  },

  // 把 AI 推荐的菜保存到菜品库
  // 调用 dish-add 云函数
  addAiDishToLib(e) {
    if (!requirePermission('manage_dishes')) return
    const index = e.currentTarget.dataset.index
    const dish = this.data.aiResults[index]
    if (!dish.name) return

    const cloudData = dishToCloud({
      name: dish.name,
      image: '',
      category: dish.category || '家常',
      difficulty: dish.difficultyValue || 'easy',
      cookTime: dish.cookTime || 30,
      tags: dish.tags || [],
      ingredients: dish.ingredientsList || [],
      steps: dish.steps || []
    })

    callFunction('dish-add', cloudData).then(() => {
      wx.showToast({ title: '已加入菜品库', icon: 'success' })
    }).catch(() => {})
  },

  // === 手动表单 ===
  // 编辑模式加载菜品详情
  // dish-detail 云函数参数：dish_id，返回：{ dish, cook_history }
  loadDishForEdit(id) {
    callFunction('dish-detail', { dish_id: id }).then(data => {
      if (!data || !data.dish) return
      const mapped = mapDish(data.dish)
      if (!mapped) return

      const categoryOptions = this.data.categoryOptions
      const categoryIndex = Math.max(0, categoryOptions.indexOf(mapped.category || '家常'))
      this.setData({
        form: {
          name: mapped.name || '',
          image: mapped.image || '',
          categoryIndex,
          difficulty: mapped.difficulty || 'easy',
          cookTime: String(mapped.cookTime || ''),
          tags: mapped.tags || [],
          isPublic: mapped.isPublic || false,
          ingredients: mapped.ingredients && mapped.ingredients.length > 0
            ? mapped.ingredients
            : [{ name: '', amount: '' }],
          steps: mapped.steps && mapped.steps.length > 0
            ? mapped.steps
            : ['']
        }
      })
    }).catch(() => {})
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onCategoryChange(e) {
    this.setData({ 'form.categoryIndex': e.detail.value })
  },

  selectDifficulty(e) {
    this.setData({ 'form.difficulty': e.currentTarget.dataset.value })
  },

  togglePublic() {
    this.setData({ 'form.isPublic': !this.data.form.isPublic })
  },

  // 图片
  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],  // 微信内置压缩
      success: res => {
        const tempPath = res.tempFiles[0].tempFilePath
        // 二次压缩：限制宽度 800px，质量 80%
        wx.compressImage({
          src: tempPath,
          quality: 80,
          compressedWidth: 800,
          success: compressRes => {
            this.setData({ 'form.image': compressRes.tempFilePath })
          },
          fail: () => {
            // 压缩失败也用原图兜底
            this.setData({ 'form.image': tempPath })
          }
        })
      }
    })
  },

  removeImage() {
    this.setData({ 'form.image': '' })
  },

  // 标签
  onTagInput(e) {
    this.setData({ tagInput: e.detail.value })
  },

  addTag(e) {
    const tag = (e.detail.value || '').trim()
    if (!tag) return
    const tags = this.data.form.tags.concat(tag)
    this.setData({ 'form.tags': tags, tagInput: '' })
  },

  removeTag(e) {
    const index = e.currentTarget.dataset.index
    const tags = this.data.form.tags.filter((_, i) => i !== index)
    this.setData({ 'form.tags': tags })
  },

  // 食材
  addIngredient() {
    const list = this.data.form.ingredients.concat({ name: '', amount: '' })
    this.setData({ 'form.ingredients': list })
  },

  removeIngredient(e) {
    const index = e.currentTarget.dataset.index
    if (this.data.form.ingredients.length <= 1) return
    const list = this.data.form.ingredients.filter((_, i) => i !== index)
    this.setData({ 'form.ingredients': list })
  },

  onIngredientInput(e) {
    const index = e.currentTarget.dataset.index
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.ingredients[' + index + '].' + field]: e.detail.value })
  },

  // 步骤
  addStep() {
    const list = this.data.form.steps.concat('')
    this.setData({ 'form.steps': list })
  },

  removeStep(e) {
    const index = e.currentTarget.dataset.index
    if (this.data.form.steps.length <= 1) return
    const list = this.data.form.steps.filter((_, i) => i !== index)
    this.setData({ 'form.steps': list })
  },

  onStepInput(e) {
    const index = e.currentTarget.dataset.index
    this.setData({ ['form.steps[' + index + ']']: e.detail.value })
  },

  // 保存菜品
  // 新增或编辑统一调用 dish-add，通过 action 区分
  saveDish() {
    if (!requirePermission('manage_dishes')) return
    const form = this.data.form
    if (!form.name.trim()) {
      wx.showToast({ title: '请输入菜名', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })

    const doSave = (imageFileID) => {
      const cloudData = dishToCloud({
        name: form.name.trim(),
        image: imageFileID || '',
        category: this.data.categoryOptions[form.categoryIndex],
        difficulty: form.difficulty,
        cookTime: parseInt(form.cookTime) || 30,
        tags: form.tags,
        isPublic: form.isPublic,
        ingredients: form.ingredients.filter(i => i.name.trim()),
        steps: form.steps.filter(s => s.trim())
      })

      const params = this.data.editingId
        ? { action: 'update', dish_id: this.data.editingId, ...cloudData }
        : { action: 'add', ...cloudData }

      callFunction('dish-add', params).then(() => {
        wx.hideLoading()
        wx.showToast({ title: this.data.editingId ? '更新成功' : '保存成功', icon: 'success' })
        setTimeout(() => wx.switchTab({ url: '/pages/dishes/dishes' }), 1500)
      }).catch(() => {
        wx.hideLoading()
      })
    }

    if (form.image && (form.image.startsWith('http://tmp') || form.image.startsWith('wxfile://'))) {
      uploadImage(form.image, 'dishes').then(fileID => {
        doSave(fileID)
      }).catch(() => {
        wx.hideLoading()
      })
    } else {
      doSave(form.image)
    }
  }
})
