// components/dish-card/dish-card.js
Component({
  properties: {
    dish: { type: Object, value: {} },
    batchMode: { type: Boolean, value: false },
    selected: { type: Boolean, value: false }
  },

  data: {
    difficultyText: ''
  },

  observers: {
    'dish.difficulty': function(val) {
      const map = { easy: '简单', medium: '中等', hard: '困难', '简单': '简单', '中等': '中等', '较难': '困难' }
      this.setData({ difficultyText: map[val] || '简单' })
    }
  },

  methods: {
    onTap() {
      if (this.data.batchMode) {
        this.triggerEvent('batchtap', { dish: this.data.dish })
      } else {
        this.triggerEvent('tap', { dish: this.data.dish })
      }
    },
    onLongPress() {
      this.triggerEvent('longpress', { dish: this.data.dish })
    }
  }
})
