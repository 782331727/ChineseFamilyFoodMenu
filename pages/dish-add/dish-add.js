// pages/dish-add/dish-add.js
const { callFunction, uploadImage } = require('../../utils/api')
const { requirePermission } = require('../../utils/auth')
const { mapDish, dishToCloud } = require('../../utils/mapper')

Page({
  data: {
    currentTab: 'manual',
    editingId: '',
    originalFingerprint: '',   // 编辑模式：原始表单指纹（用于判断是否需要重新安检）
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
      images: [],
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
    tagInput: '',
    // 编辑模式：记住原始 cloud:// fileID，避免 temp URL 被当成新图
    editRawImages: []
  },

  onLoad(options) {
    // 宾客/未登录无法使用添加菜品和 AI 生成
    const app = getApp()
    if (!app.globalData.isLogin || !(app.globalData.familyId || wx.getStorageSync('familyId'))) {
      wx.showToast({ title: '请先登录并加入家庭', icon: 'none', duration: 2000 })
      setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 1500)
      return
    }
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
	        const ingrList = (d.ingredients || []).map(i => i.name || '').filter(Boolean)
	        return {
	          name: d.name || '未知菜品',
	          description: d.tips || '',
	          ingredients: ingrList.join('、'),
	          ingredientsList: (d.ingredients || []).map(i => ({ name: i.name || '', amount: i.amount || '' })),
	          steps: d.steps || [],
	          difficulty: d.difficulty || '简单',
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
	    }).catch((e) => {
	      const msg = (e && e.message) || ''
	      if (msg.includes('违规')) {
	        wx.showModal({
	          title: '内容审核未通过',
	          content: '该菜品内容可能包含不合规信息，无法加入菜品库。',
	          showCancel: false, confirmText: '知道了'
	        })
	      }
	    })
  },

  // === 手动表单 ===
  // 计算表单指纹（文字+图片数量，用于判断是否需要重新安检）
  formFingerprint() {
    const f = this.data.form
    const texts = [
      f.name || '',
      ...(f.tags || []),
      ...(f.ingredients || []).map(i => (i.name || '') + '|' + (i.amount || '')),
      ...(f.steps || []),
      'imgs:' + (f.images || []).length  // 图片数变化也纳入指纹
    ]
    return texts.join(';')
  },

  // 编辑模式加载菜品详情
  // dish-detail 云函数参数：dish_id，返回：{ dish, cook_history }
  loadDishForEdit(id) {
    callFunction('dish-detail', { dish_id: id }).then(data => {
      if (!data || !data.dish) return
      const mapped = mapDish(data.dish)
      if (!mapped) return

      const categoryOptions = this.data.categoryOptions
      const categoryIndex = Math.max(0, categoryOptions.indexOf(mapped.category || '家常'))
      // 原始 cloud:// fileID（用于保存），temp URL（用于预览）
      const rawImages = (data.image_urls_raw && data.image_urls_raw.length > 0)
        ? data.image_urls_raw
        : (mapped.images || []).filter(u => u && u.startsWith('cloud://'))
      this.setData({
        editRawImages: rawImages,
        form: {
          ...mapped,
          categoryIndex
        }
      })
      // 记录原始文字指纹，用于保存时判断是否需要重新安检
      this.setData({ originalFingerprint: this.formFingerprint() })
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

  // 图片（支持多图）— 先传后审：上传到临时云存储 → img-check 检测 → 合规保留/违规删除
  chooseImage() {
    const remain = 9 - this.data.form.images.length
    if (remain <= 0) { wx.showToast({ title: '最多上传9张', icon: 'none' }); return }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async res => {
        wx.showLoading({ title: '正在检查图片…', mask: true })
        let passed = 0, rejected = 0

        for (const f of res.tempFiles) {
          try {
            // 1. 上传到云存储临时目录
            const uploadRes = await wx.cloud.uploadFile({
              cloudPath: `tmp-check/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
              filePath: f.tempFilePath
            })
            // 2. 调用 img-check 检测
            const check = await wx.cloud.callFunction({
              name: 'img-check',
              data: { fileID: uploadRes.fileID }
            })
            // 3. 合规保留，违规删云文件
            if (check.result && check.result.pass) {
              this.data.form.images.push(uploadRes.fileID)
              passed++
            } else {
              wx.cloud.deleteFile({ fileList: [uploadRes.fileID] }).catch(() => {})
              rejected++
              console.warn('[img-check] rejected:', (check.result || {}).diag)
            }
          } catch (_) {
            rejected++
          }
        }

        wx.hideLoading()
        this.setData({ 'form.images': this.data.form.images })
        if (rejected > 0) {
          wx.showModal({
            title: '图片审核',
            content: `已添加 ${passed} 张，${rejected} 张未通过审核`,
            showCancel: false, confirmText: '知道了'
          })
        } else if (passed > 0) {
          wx.showToast({ title: `已添加 ${passed} 张`, icon: 'success' })
        }
      }
    })
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.form.images.filter((_, i) => i !== index)
    // 同步删除对应的原始 cloud:// fileID
    const raw = [...this.data.editRawImages]
    if (index < raw.length) raw.splice(index, 1)
    this.setData({ 'form.images': images, editRawImages: raw })
  },

  // 设为封面：将指定图片移到第一位
  setCover(e) {
    const index = e.currentTarget.dataset.index
    if (index <= 0) return
    const images = [...this.data.form.images]
    const [item] = images.splice(index, 1)
    images.unshift(item)
    // 同步调整原始 cloud:// fileID 顺序
    const raw = [...this.data.editRawImages]
    if (index < raw.length) {
      const [rawItem] = raw.splice(index, 1)
      raw.unshift(rawItem)
    }
    this.setData({ 'form.images': images, editRawImages: raw })
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

    // 智能安检：只有表单内容有变化才需要重新检测
    const currentFp = this.formFingerprint()
    const contentChanged = currentFp !== this.data.originalFingerprint
    wx.showLoading({
      title: contentChanged ? '正在检查内容合规性…' : '保存中…',
      mask: true
    })

    const doSave = (imageFileIDs) => {
      const cloudData = dishToCloud({
        name: form.name.trim(),
        images: imageFileIDs || [],
        image: imageFileIDs && imageFileIDs[0] || '',
        category: this.data.categoryOptions[form.categoryIndex],
        difficulty: form.difficulty,
        cookTime: parseInt(form.cookTime) || 30,
        tags: form.tags,
        isPublic: form.isPublic,
        ingredients: form.ingredients.filter(i => i.name.trim()),
        steps: form.steps.filter(s => s.trim())
      })

      const params = this.data.editingId
        ? { action: 'update', dish_id: this.data.editingId, ...cloudData, skip_check: !contentChanged }
        : { action: 'add', ...cloudData }

	      callFunction('dish-add', params).then(() => {
	        wx.hideLoading()
	        wx.showToast({ title: this.data.editingId ? '更新成功' : '保存成功', icon: 'success' })
	        // 通知菜品库需要刷新
	        getApp().globalData.dishesNeedRefresh = true
	        setTimeout(() => wx.switchTab({ url: '/pages/dishes/dishes' }), 1500)
		      }).catch((e) => {
		        wx.hideLoading()
		        // api.js 已通过 toast 显示错误消息（含内容违规等），此处保持表单不关闭让用户修改
		        const msg = (e && e.message) || ''
		        if (msg.includes('违规')) {
		          const isImage = msg.includes('图片')
		          wx.showModal({
		            title: '内容审核未通过',
		            content: isImage
		              ? '您上传的图片包含不合规内容，请更换后重试。'
		              : '您发布的文字内容可能包含不合规信息，请修改后重试。',
		            showCancel: false, confirmText: '知道了'
		          })
		        }
		      })
    }

    // 收集新上传的 cloud:// fileID（chooseImage 已上传并检测）
    const cloudIDs = form.images.filter(img => img && img.startsWith('cloud://'))

    if (this.data.editingId) {
      // 编辑模式：form.images 是临时展示 URL（https://...），不能上传
      // 直接用 editRawImages（原始 cloud://）+ 新加的 cloudIDs
      doSave([...this.data.editRawImages, ...cloudIDs])
    } else {
      // 新增模式：可能有本地临时图片需上传
      const tempImages = form.images.filter(img => img && !img.startsWith('cloud://'))
      if (tempImages.length > 0) {
        const { uploadImages } = require('../../utils/api')
        uploadImages(tempImages, 'dishes').then(uploadedIDs => {
          doSave([...cloudIDs, ...uploadedIDs])
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '图片上传失败', icon: 'none' })
        })
      } else {
        doSave(cloudIDs)
      }
    }
  }
})
