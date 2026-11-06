import test from 'node:test';import assert from 'node:assert/strict';
import {buildComboProducts,parseComboItems,isCombo,orderStockLimit,selectProducts,productIdentity,productSpec,cartProductLimit,getOrderSummary,searchProducts} from '../catalog-model.mjs';
const p=(sku,stock=40,extra={})=>({id:sku,sku,warehouse:sku.split('-')[0],name:sku==='IL-B001'?'Imagination':'Baccarat Rouge 540',brand:sku==='IL-B001'?'Louis Vuitton':'Maison Francis Kurkdjian',ml:100,price:40,stock,img:'photo.webp',...extra});
const base=()=>[p('IL-B001'),p('IL-B002',60)];
const row=(extra={})=>({sku:'IL-CB-001',name:'Summer Duo',items:'IL-B001*2+IL-B002*1',price_catalog:'80',price_perfume_list:'100',image_url:'',...extra});
const cart=(product,quantity=1)=>({...productIdentity(product),name:product.id,warehouse:product.warehouse,price:product.price,quantity});
test('each site uses only its exact combo price; blank zero invalid prices never inherit sibling pricing',()=>{
 const source=base();assert.equal(buildComboProducts([row()],source,'catalog')[0].price,80);assert.equal(buildComboProducts([row()],source,'perfume-list')[0].price,100);
 for(const blank of ['',null,' ',0,'0','not a price',-1,'Infinity'])assert.deepEqual(buildComboProducts([row({price_catalog:blank})],source,'catalog'),[]);
 assert.equal(buildComboProducts([row({price_perfume_list:''})],source,'SKU')[0].price,80);
 assert.equal(buildComboProducts([row({price_catalog:'$1,234.50'})],source,'catalog')[0].price,1234.5);
 assert.equal(buildComboProducts([row({price_perfume_list:'$109.00'})],source,'SKU')[0].price,109);
 assert.equal(buildComboProducts([row({price_catalog:'USD 80.00'})],source,'catalog')[0].price,80);
});
test('combo gate uses each component stock >=19, while derived bundle count can be below19',()=>{
 for(const [inventory,want] of [[0,0],[18,0],[19,9],[20,10]]){
  const combo=buildComboProducts([row()], [p('IL-B001',inventory),p('IL-B002')],'catalog')[0];
  assert.equal(orderStockLimit(combo),want);assert.equal(selectProducts([combo],{category:'Combo'}).length,want?1:0);
 }
});
test('bad quantities missing SKU wrong warehouse nested combos and duplicate IDs fail safely',()=>{
 for(const items of ['IL-B001*0+IL-B002*1','IL-B001*1.5+IL-B002*1','IL-B001*1','IL-B001*9007199254740992+IL-B002*1','IL-B001*1+IL-B999*1','IL-B001*1+TX-B002*1','IL-CB-002*1+IL-B002*1']){
  const combo=buildComboProducts([row({items})],base(),'catalog')[0];assert.equal(orderStockLimit(combo),0,items);
 }
 assert.throws(()=>buildComboProducts([row(),row()],base(),'catalog'),/Duplicate/);
 assert.deepEqual(parseComboItems('IL-B001*1+IL-B001*2+IL-B002*1'),[{sku:'IL-B001',quantity:3},{sku:'IL-B002',quantity:1}]);
});
test('combo category does not enter hot new gift or gender categories and ignores fragrance-only facets',()=>{
 const combo=buildComboProducts([row()],base(),'catalog')[0];
 for(const category of ['Men','Women','Unisex','GiftSets','HotSelling','NewArrival','ComingSoon'])assert.equal(selectProducts([combo],{category}).length,0);
 assert.equal(selectProducts([combo],{category:'All'}).length,1);
 assert.equal(selectProducts([combo],{category:'Combo',season:'Fall / Winter',occasion:'Office'}).length,1);
 assert.equal(selectProducts([combo],{category:'Combo',brand:'Louis Vuitton'}).length,1);
 assert.equal(searchProducts([combo],'MFK baccarat').length,1);
});
test('standalone purchases and overlapping combos share component inventory in both directions',()=>{
 const source=base(),combo=buildComboProducts([row()],source,'catalog')[0],second=buildComboProducts([row({sku:'IL-CB-002',items:'IL-B001*1+IL-B002*2'})],source,'catalog')[0],all=[...source,combo,second];
 assert.equal(cartProductLimit(combo,[cart(source[0],25)],all),7);
 assert.equal(cartProductLimit(source[0],[cart(combo,15)],all),10);
 assert.equal(cartProductLimit(second,[cart(combo,15)],all),10);
 assert.equal(cartProductLimit(combo,[cart(combo,12),cart(combo,2),cart(source[0],8)],all),16);
});
test('combos stay full price and never count toward the eligible perfume tier',()=>{
 const source=base(),combo=buildComboProducts([row()],source,'catalog')[0];
 const summary=getOrderSummary([cart(combo,3),cart(source[0],2)],[{min:2,max:2,percent:.03},{min:5,max:10,percent:.1}], [...source,combo]);
 assert.equal(summary.discountQty,2);assert.equal(summary.fullPriceQty,3);assert.equal(summary.discountAmount,2.4);assert.equal(summary.totalAmount,317.6);
 assert.equal(isCombo(cart(combo)),true);assert.equal(productSpec(combo),'3 pcs / combo');assert.equal(productIdentity(combo).components[0].stock,undefined);
});
