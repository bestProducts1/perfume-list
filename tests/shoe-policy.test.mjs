import test from 'node:test';import assert from 'node:assert/strict';
import {getOrderSummary,isGiftSet,isShoe,orderStockLimit,groupShoeProducts,selectProducts,productIdentity,productSpec} from '../catalog-model.mjs';
const tiers=[{min:1,max:1,percent:0},{min:2,max:2,percent:.03},{min:3,max:4,percent:.05},{min:5,max:9,percent:.08}];
const perfume=(overrides={})=>({id:'IL-B001',sku:'IL-B001',warehouse:'IL',name:'Perfume',price:52,stock:38,ml:100,...overrides});
const shoe=(overrides={})=>({id:'TX-XZ-04-40',sku:'TX-XZ-04-40',parent_sku:'TX-XZ-04',warehouse:'TX',name:'Air Jordan 5 Retro',price:137,stock:11,size:'40',...overrides});
const cart=(p,quantity=1)=>({...productIdentity(p),name:p.id,caption:p.id+' - '+p.name,brand:p.brand||'',price:p.price,ml:p.ml||'',warehouse:p.warehouse,quantity});
test('mixed quote discounts eligible perfume subtotal and quantity only',()=>{
 const p=perfume(),s=shoe(),g=perfume({id:'TX-LH-1',warehouse:'TX',name:'4-piece Gift Box',price:49,ml:'30ml*4'});
 const summary=getOrderSummary([cart(p,2),cart(s,3),cart(g,4)],tiers);
 assert.equal(summary.qty,9);assert.equal(summary.discountQty,2);assert.equal(summary.discountPercent,.03);
 assert.equal(summary.subtotal,711);assert.equal(summary.discountSubtotal,104);assert.equal(summary.discountAmount,3.12);assert.equal(summary.totalAmount,707.88);
});
test('no quantity of shoes or sets earns or inflates a perfume discount tier',()=>{
 const p=perfume(),s=shoe(),g=perfume({id:'TX-LH-2',name:'Set',price:49});
 assert.equal(getOrderSummary([cart(s,99),cart(g,99)],tiers).discountPercent,0);
 const one=getOrderSummary([cart(p),cart(s,99),cart(g,99)],tiers);assert.equal(one.discountQty,1);assert.equal(one.discountAmount,0);
});
test('existing cart without new metadata is classified by current catalog and legacy names',()=>{
 const p=perfume({id:'IL-B256',name:'Dior Miniature Perfume Gift Set',price:55});
 const legacy=cart(p,5);delete legacy.product_type;legacy.caption='IL-B256';
 assert.equal(getOrderSummary([legacy],tiers,[p]).discountQty,0);
 assert.equal(isGiftSet({caption:'A 4-piece Fragrance Set'}),true);
 assert.equal(isGiftSet({ml:'30ml x 4'}),true);assert.equal(isGiftSet({name:'Sunset Perfume'}),false);
 assert.equal(isShoe({name:'TX-XZ-04-40'}),true);
});
test('size-specific quantities use positive stock, while perfume threshold remains 19',()=>{
 assert.equal(orderStockLimit(shoe()),11);assert.equal(orderStockLimit(shoe({stock:1})),1);assert.equal(orderStockLimit(shoe({stock:0})),0);
 assert.equal(orderStockLimit(shoe({size:''})),0);assert.equal(orderStockLimit(shoe({parent_sku:''})),0);assert.equal(orderStockLimit(shoe({size:41})),0);
 assert.equal(orderStockLimit(perfume({stock:18})),0);assert.equal(orderStockLimit(perfume({stock:19})),19);
});
test('same-name shoe styles and warehouses never merge, six sizes form one card',()=>{
 const variants=Array.from({length:6},(_,i)=>shoe({id:'TX-XZ-04-'+(40+i),size:String(40+i)}));
 const another=shoe({id:'TX-XZ-06-40',parent_sku:'TX-XZ-06'}),otherWarehouse=shoe({id:'IL-XZ-04-40',parent_sku:'IL-XZ-04',warehouse:'IL'});
 const all=[...variants,another,otherWarehouse],grouped=groupShoeProducts(selectProducts(all,{category:'Shoes'}),all);
 assert.equal(grouped.length,3);assert.equal(grouped[0].variants.length,6);assert.equal(grouped[1].variants.length,1);
 assert.equal(productSpec(cart(variants[0])),'Size 40');
});
test('zero-stock variants remain available for disabled size labels, never buyable',()=>{
 const all=[shoe(),shoe({id:'TX-XZ-04-41',size:'41',stock:0})];
 const group=groupShoeProducts(selectProducts(all,{category:'Shoes'}),all)[0];assert.equal(group.variants.length,2);assert.equal(orderStockLimit(group.variants[1]),0);
});
test('money rounds to cents before eligible and non-eligible subtotals are combined',()=>{
 const p=perfume({price:1.005}),s=shoe({price:1.005});
 const summary=getOrderSummary([cart(p,2),cart(s)],tiers);assert.equal(summary.subtotal,3.03);assert.equal(summary.discountAmount,.06);assert.equal(summary.totalAmount,2.97);
});
