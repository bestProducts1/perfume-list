const code=value=>String(value??'').trim().toUpperCase();
const warehouse=value=>code(value).replace(/\s+WAREHOUSE$/,'').trim();
const key=(sku,wh)=>`${code(sku)}::${warehouse(wh)}`;
const id=product=>code(product?.id||product?.sku||product?.name);
const stock=product=>Number(product?.stock===''||product?.stock==null?product?.inventory:product.stock);
export const isCombo=product=>product?.product_type==='combo'||/^[A-Z]+-CB-/.test(id(product));
function comboPrice(value){
  const text=String(value??'').trim();
  // Published Sheets CSV can contain the displayed currency format ($80.00).
  if(!/^(?:USD\s*)?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/i.test(text))return 0;
  const amount=Number(text.replace(/USD|\$|,|\s/gi,''));
  return Number.isFinite(amount)&&amount>0?Math.round(amount*100)/100:0;
}

export function parseComboItems(value){
  const parts=String(value??'').trim().split('+'),items=new Map();
  if(parts.length<2)return null;
  for(const part of parts){
    const match=part.trim().match(/^([A-Z]+-[A-Z0-9_-]+)\s*\*\s*([1-9]\d*)$/i);
    if(!match)return null;
    const sku=code(match[1]),quantity=Number(match[2])+(items.get(sku)||0);
    if(!Number.isSafeInteger(quantity)||quantity<=0)return null;
    items.set(sku,quantity);
  }
  return items.size<2?null:[...items].map(([sku,quantity])=>({sku,quantity}));
}

// A combo owns no separate inventory. Even when only a few complete bundles
// remain, it is valid while every physical component still has at least 19.
export function comboStockLimit(product){
  if(!isCombo(product)||!Array.isArray(product.components)||product.components.length<2)return 0;
  let limit=Number.MAX_SAFE_INTEGER;
  const seen=new Set();
  for(const part of product.components){
    const sku=id(part),qty=Number(part.quantity),available=stock(part);
    if(!sku||seen.has(sku)||isCombo(part)||/^[A-Z]+-XZ-/.test(sku)||
       warehouse(part.warehouse)!==warehouse(product.warehouse)||sku.split('-')[0]!==warehouse(product.warehouse)||
       !Number.isSafeInteger(qty)||qty<=0||!Number.isFinite(available)||available<19||
       ['OUT OF STOCK','MISSING INVENTORY','UNAVAILABLE','LOW / HIDDEN'].includes(code(part.stock_status)))return 0;
    seen.add(sku);limit=Math.min(limit,Math.floor(available/qty));
  }
  return limit;
}

export function buildComboProducts(rows,products,siteId){
  const source=new Map(products.map(p=>[key(id(p),p.warehouse),p])),seen=new Set(),result=[];
  for(const row of rows){
    const sku=code(row.sku||row.id),wh=sku.split('-')[0],name=String(row.name||'').trim();
    if(!/^[A-Z]+-CB-\d{3,}$/.test(sku)||!name)continue;
    if(seen.has(sku))throw Error('Duplicate combo SKU.');seen.add(sku);
    const raw=siteId==='catalog'?row.price_catalog:siteId==='perfume-list'?row.price_perfume_list:
      comboPrice(row.price_perfume_list)>0?row.price_perfume_list:row.price_catalog;
    const price=comboPrice(raw);
    // Never infer a selling price from component prices or the sibling site.
    if(!price)continue;
    const requested=parseComboItems(row.items);let valid=Boolean(requested);
    const components=(requested||[]).map(part=>{
      const product=source.get(key(part.sku,wh));
      if(!product||isCombo(product)||/^[A-Z]+-XZ-/.test(part.sku)){valid=false;return null;}
      return {sku:part.sku,warehouse:wh,quantity:part.quantity,name:product.name,brand:product.brand||'',ml:String(product.ml??''),img:product.img||product.image_url||'',stock:product.stock,inventory:product.inventory,stock_status:product.stock_status};
    }).filter(Boolean);
    const combo={id:sku,sku,warehouse:wh,name,brand:'',product_type:'combo',price:Math.round(price*100)/100,components:valid?components:[],img:String(row.image_url||row.img||'').trim(),ml:'',stock:0};
    combo.stock=comboStockLimit(combo);result.push(combo);
  }
  return result;
}

export function comboIdentity(product){
  return {product_type:'combo',components:(product.components||[]).map(({sku,warehouse,quantity,name,brand,ml,img})=>({sku,warehouse,quantity,name,brand,ml,img}))};
}
export function stockRequirements(product){
  return isCombo(product)?product.components||[]:[{sku:id(product),warehouse:warehouse(product?.warehouse),quantity:1,stock:stock(product)}];
}

// Maximum TOTAL for the target cart line, after all other standalone products
// and combos consume their shared components. Same-SKU duplicate lines are
// excluded together; callers validate their combined quantity against this cap.
export function componentCartLimit(product,cart,catalog,base){
  if(!product||!base)return 0;
  const target=key(id(product),product.warehouse),used=new Map();
  const current=new Map(catalog.map(p=>[key(id(p),p.warehouse),p]));
  for(const item of cart){
    const itemKey=key(item.name||item.id||item.sku,item.warehouse);
    if(itemKey===target)continue;
    const p=current.get(itemKey),qty=Number(item.quantity);
    if(!p||!Number.isSafeInteger(qty)||qty<=0)continue;
    for(const part of stockRequirements(p)){
      const k=key(part.sku,part.warehouse),count=qty*part.quantity+(used.get(k)||0);
      if(!Number.isSafeInteger(count))return 0;
      used.set(k,count);
    }
  }
  let limit=base;
  for(const part of stockRequirements(product)){
    const available=Number(part.stock);
    if(Number.isFinite(available))limit=Math.min(limit,Math.floor((available-(used.get(key(part.sku,part.warehouse))||0))/part.quantity));
  }
  return Math.max(0,limit);
}
