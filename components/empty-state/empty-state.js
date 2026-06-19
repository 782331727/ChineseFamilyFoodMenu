// components/empty-state/empty-state.js
Component({
  properties: {
    icon: { type: String, value: '' },
    emoji: { type: String, value: '' },
    text: { type: String, value: '' },
    subText: { type: String, value: '' },
    btnText: { type: String, value: '' }
  },
  methods: {
    onBtnTap() {
      this.triggerEvent('btntap')
    }
  }
})
