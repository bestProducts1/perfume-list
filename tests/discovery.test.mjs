import test from 'node:test';
import assert from 'node:assert/strict';
import {selectProducts,isShoe,seasonLabel,productOccasions} from '../catalog-model.mjs';
const fragrance=(extra={})=>({id:'IL-B001',name:'Fragrance',warehouse:'IL',price:52,stock:25,target:'Unisex',season:'Spring / Summer',suitable_occasions:'Daily Wear, Office, Evening, Vacation, Outdoor, Sports / Casual',...extra});
const shoe=(extra={})=>fragrance({id:'TX-XZ-04',name:'Air Jordan 5 Retro',warehouse:'TX',brand:'Nike',price:137,target:'',season:'',suitable_occasions:'',...extra});
test('official shoe IDs work with multiple hyphens and preserve individual same-name styles',()=>{
  assert.equal(isShoe(shoe()),true);assert.equal(isShoe(fragrance()),false);
  const rows=[fragrance(),shoe(),shoe({id:'TX-XZ-06'}),shoe({id:'TX-XZ-05',stock:0})];
  assert.deepEqual(selectProducts(rows,{category:'Shoes'}).map(p=>p.id),['TX-XZ-04','TX-XZ-06']);
  assert.equal(selectProducts(rows,{category:'All'}).length,3);
  assert.equal(selectProducts(rows,{category:'Unisex'}).length,1);
});
test('shoe positive stock and selected warehouse remain authoritative',()=>{
  const rows=[shoe({stock:18}),shoe({id:'TX-XZ-06',stock:19}),shoe({id:'IL-XZ-01',warehouse:'IL'})];
  assert.deepEqual(selectProducts(rows,{category:'Shoes',warehouse:'TX'}).map(p=>p.id),['TX-XZ-04','TX-XZ-06']);
});
test('season labels accept existing sheet spelling; year-round works across warm and cold selections',()=>{
  assert.equal(seasonLabel('All-Season'),'Year-round');assert.equal(seasonLabel('Varies'),'Varies by fragrance');
  const rows=[fragrance(),fragrance({id:'IL-B002',season:'Fall / Winter'}),fragrance({id:'IL-B003',season:'All-Season'}),fragrance({id:'IL-B004',season:'Varies'})];
  assert.deepEqual(selectProducts(rows,{season:'Spring / Summer'}).map(p=>p.id),['IL-B001','IL-B003']);
  assert.deepEqual(selectProducts(rows,{season:'Fall / Winter'}).map(p=>p.id),['IL-B002','IL-B003']);
  assert.deepEqual(selectProducts(rows,{season:'Year-round'}).map(p=>p.id),['IL-B003']);
});
test('comma-delimited multiple occasions keep Sports / Casual intact and use friendly labels',()=>{
  assert.deepEqual(productOccasions(fragrance()),['Everyday','Office','Evening Out','Vacation','Outdoors','Sports / Casual']);
  assert.deepEqual(productOccasions(fragrance({suitable_occasions:'Date, Party, Date'})),['Date Night','Party']);
  assert.equal(selectProducts([fragrance()],{occasion:'Office',season:'Spring / Summer'}).length,1);
  assert.equal(selectProducts([fragrance()],{occasion:'Office',season:'Fall / Winter'}).length,0);
});
test('shoe selection ignores perfume-only fields and supports useful shoe price ranges',()=>{
  const rows=[shoe(),shoe({id:'TX-XZ-03',price:203}),shoe({id:'TX-XZ-02',price:176})];
  assert.equal(selectProducts(rows,{category:'Shoes',season:'Fall / Winter',occasion:'Party'}).length,3);
  assert.equal(selectProducts(rows,{category:'Shoes',priceRange:'under150'}).length,1);
  assert.equal(selectProducts(rows,{category:'Shoes',priceRange:'150to200'}).length,1);
  assert.equal(selectProducts(rows,{category:'Shoes',priceRange:'over200'}).length,1);
});
