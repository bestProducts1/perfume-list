// Store-specific business settings. Keep separate when syncing the shared UI.
window.STOREFRONT_CONFIG = Object.freeze({
  siteId: 'perfume-list',
  whatsappNumber: '16232027321',
  shippingLabel: 'FREE',
  freeShipping: true,
  discountTiers: Object.freeze([
    {min:1,max:1,percent:0},
    {min:2,max:2,percent:0.03},
    {min:3,max:4,percent:0.05},
    {min:5,max:9,percent:0.08},
    {min:10,max:19,percent:0.14},
    {min:20,max:29,percent:0.24},
    {min:30,max:49,percent:0.26},
    {min:50,max:79,percent:0.29},
    {min:80,max:100,percent:0.32},
    {min:101,max:Infinity,percent:0.35},
  ]),
});
