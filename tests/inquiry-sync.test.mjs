import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(new URL('../inquiry-sync.js',import.meta.url),'utf8');
function context(){
  const memory=new Map();const sandbox={localStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value))}};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(source,sandbox);
  return {api:sandbox.SkuInquirySync,memory,sandbox};
}
const plain=value=>JSON.parse(JSON.stringify(value));
const line=(overrides={})=>({name:'IL-B008',warehouse:'IL',quantity:3,price:999,img:'secret.webp',sku2:'private',...overrides});

test('publisher strips all prices and metadata, normalizes official keys, groups duplicate quantities',()=>{
  const {api,memory}=context();
  const payload=plain(api.publish([line({name:'il-b008',warehouse:'IL Warehouse'}),line({quantity:2})]));
  assert.deepEqual(payload.items,[{sku:'IL-B008',warehouse:'IL',quantity:5}]);
  assert.equal(payload.source,'SKU');assert.equal(payload.version,1);
  assert.ok(Number.isSafeInteger(payload.createdAt));assert.ok(payload.revision);
  assert.doesNotMatch(memory.get(api.storageKey),/price|img|sku2|private|secret/);
  assert.deepEqual(plain(api.read()),payload);
  assert.notEqual(api.publish([line()]).revision,payload.revision);
});

test('invalid source IDs, warehouses, quantities or unsafe duplicate sums never replace a valid inquiry',()=>{
  const {api,memory}=context();api.publish([line()]);const saved=memory.get(api.storageKey);
  for(const lines of [[],[line({name:'B301'})],[line({warehouse:'TX'})],[line({quantity:0})],[line({quantity:-1})],
    [line({quantity:1.5})],[line({quantity:true})],[line({quantity:'1e3'})],[line({quantity:Infinity})],[line({quantity:Number.MAX_SAFE_INTEGER+1})],
    [line({quantity:Number.MAX_SAFE_INTEGER}),line({quantity:1})]]){
    assert.throws(()=>api.publish(lines));assert.equal(memory.get(api.storageKey),saved);
  }
});

test('read ignores malformed envelopes and price-bearing or invalid incoming items without touching any cart',()=>{
  const {api,memory}=context();const payload=plain(api.publish([line()]));
  const bad=['bad','null','[]',JSON.stringify({...payload,source:'catalog'}),JSON.stringify({...payload,version:2}),
    JSON.stringify({...payload,revision:''}),JSON.stringify({...payload,createdAt:-1}),
    JSON.stringify({...payload,items:[]}),JSON.stringify({...payload,items:[{...payload.items[0],price:1}]}),
    JSON.stringify({...payload,items:[{...payload.items[0],warehouse:'TX'}]}),
    JSON.stringify({...payload,items:[{...payload.items[0],quantity:'3'}]})];
  memory.set('bestProducts1:catalog:cart:v1','keep catalog');memory.set('bestProducts1:perfume-list:cart:v1','keep perfume');
  for(const text of bad){memory.set(api.storageKey,text);assert.equal(api.read(),null);}
  assert.equal(memory.get('bestProducts1:catalog:cart:v1'),'keep catalog');
  assert.equal(memory.get('bestProducts1:perfume-list:cart:v1'),'keep perfume');
});

test('receipts are storefront-specific and unavailable storage fails safely',()=>{
  const {api,sandbox}=context();assert.notEqual(api.receiptKey('catalog'),api.receiptKey('perfume-list'));
  assert.throws(()=>api.receiptKey('SKU'));assert.throws(()=>api.receiptKey('fast-catalog'));
  sandbox.localStorage.getItem=()=>{throw Error('blocked');};assert.equal(api.read(),null);
  sandbox.localStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>api.publish([line()]),/quota/);
});
