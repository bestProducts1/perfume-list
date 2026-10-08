import {selectProducts,isComingSoon,formatSize,getOrderSummary,normalizeText} from './catalog-model.mjs';

const $ = (id) => document.getElementById(id);
const cents = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const money = (value) => `$${(cents(value) / 100).toFixed(2)}`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = (name) => `<i class="ti ti-${name}" aria-hidden="true"></i>`;
const normalizeWarehouse = (value) => String(value || '').toUpperCase().trim().replace(/\s+WAREHOUSE$/,'').trim();
const stockKey = (product) => window.cartStockKey(product.id,product.warehouse);
const tierSchedule = CATALOG_DISCOUNT_TIERS;
const storefront = window.STOREFRONT_CONFIG;
const shippingNote = storefront.freeShipping ? 'Free shipping on every order.' : 'Product total excludes shipping.';
const layoutKey = `bestProducts1${storefront.siteId}LayoutV1`;
const categoryNames = {All:'All',Men:'Men',Women:'Women',Unisex:'Unisex',GiftSets:'Gift sets',HotSelling:'Best sellers',NewArrival:'New arrivals',ComingSoon:'Coming soon'};
const defaults = {category:'All',warehouse:'all',brand:'all',priceRange:'any',sort:'popular',query:'',stockOnly:true};
const state = {filters:{...defaults},view:'grid',limit:24,detailId:null,checking:false,confirm:null,loaded:false};
try {state.view=localStorage.getItem(layoutKey)==='list'?'list':'grid';} catch {}
let cartEntryHandled=false;
let toastTimer;
let queryTimer;
let loadTimer;
const returnFocus=new WeakMap();
const dialogStack=[];
const feedbackTimers=new WeakMap();
const feedbackAnimations=new WeakMap();

function captureFocus(root){
  const element=document.activeElement;
  if(!root.contains(element)||!element.dataset.action)return null;
  return {action:element.dataset.action,id:element.dataset.id,index:element.dataset.index};
}

function restoreFocus(root,marker){
  if(!marker)return;
  const controls=[...root.querySelectorAll('[data-action]')];
  const sameItem=el=>el.dataset.id===marker.id&&el.dataset.index===marker.index;
  const quantityActions=['add','product-plus','product-minus'];
  const replacement=controls.find(el=>sameItem(el)&&el.dataset.action===marker.action&&!el.disabled)
    ||controls.find(el=>sameItem(el)&&quantityActions.includes(marker.action)&&el.dataset.action==='product-plus'&&!el.disabled)
    ||controls.find(el=>sameItem(el)&&quantityActions.includes(marker.action)&&quantityActions.includes(el.dataset.action)&&!el.disabled)
    ||controls.find(el=>sameItem(el)&&!el.disabled)
    ||controls.find(el=>!el.disabled);
  replacement?.focus({preventScroll:true});
}

function readCart(){return window.readStoredCart();}
function saveCart(cart){window.writeStoredCart(cart);updateOrderUI();}
function products(){return window.perfumeDB || [];}
function getProduct(reference){return products().find(p=>stockKey(p)===reference)||products().find(p=>String(p.id)===String(reference));}
function quantityInCart(product){return readCart().filter(item=>window.cartStockKey(item.name,item.warehouse)===stockKey(product)).reduce((sum,item)=>sum+(Number(item.quantity)||0),0);}
function remainingStock(product){return Math.max(0,window.getOrderStockLimit(product)-quantityInCart(product));}

function syncToastHost(){
  const host=dialogStack.filter(dialog=>dialog.open).at(-1)||document.body;
  const toast=$('toast');if(toast.parentElement!==host)host.append(toast);
  if(host===document.body){toast.style.left='';toast.style.bottom='';toast.style.maxWidth='';}
  else{
    const box=host.getBoundingClientRect();
    const actions=host.id==='product-dialog'&&window.matchMedia?.('(max-width:650px),(max-height:500px)').matches?host.querySelector('.detail-order-actions'):null;
    const bottom=Math.max(12,innerHeight-box.bottom+14,actions?innerHeight-actions.getBoundingClientRect().top+8:0);
    toast.style.left=(box.left+box.width/2)+'px';toast.style.bottom=bottom+'px';toast.style.maxWidth=Math.max(0,box.width-32)+'px';
  }
}

window.showToast = function(message){clearTimeout(toastTimer);syncToastHost();$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,2600);};

function emphasizeOrderControl(element,badge=false){
  if(!element||element.hidden)return;
  clearTimeout(feedbackTimers.get(element));element.classList.add('has-order-feedback');
  feedbackTimers.set(element,setTimeout(()=>element.classList.remove('has-order-feedback'),550));
  feedbackAnimations.get(element)?.cancel();
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return;
  const animation=element.animate?.([{transform:'scale(1)'},{transform:badge?'scale(1.3)':'scale(1.025)'},{transform:'scale(1)'}],{duration:280,easing:'ease-out'});
  if(animation)feedbackAnimations.set(element,animation);
}

function showQuantityFeedback(product,delta,quantity){
  if(delta>0){
    showToast(`Added 1 · ${product.id} now ${quantity} in your order`);
    const reference=stockKey(product);
    document.querySelectorAll('.quantity-stepper[data-stock-key]').forEach(element=>{if(element.dataset.stockKey===reference)emphasizeOrderControl(element);});
    emphasizeOrderControl($('cart-count'),true);
  }else showToast(quantity>0?`Updated · ${product.id} now ${quantity} in your order`:`${product.id} removed from your order`);
}

function stepper(product){
  const amount=quantityInCart(product);
  return `<div class="quantity-stepper" data-stock-key="${esc(stockKey(product))}" aria-label="Order quantity for ${esc(product.name)}"><button type="button" data-action="product-minus" data-id="${esc(stockKey(product))}" aria-label="Decrease ${esc(product.name)} quantity in your order" ${state.checking?'disabled':''}>−</button><output aria-label="Quantity in your order">${amount}</output><button type="button" data-action="product-plus" data-id="${esc(stockKey(product))}" aria-label="Increase ${esc(product.name)} quantity in your order" ${state.checking||amount>=window.getOrderStockLimit(product)?'disabled':''}>+</button></div>`;
}

function imageHtml(product,className=''){
  if(!product.img) return `<span class="missing-image">Product photo unavailable</span>`;
  return `<img class="${className}" src="${esc(product.img)}" alt="${esc(product.name)}" loading="lazy" decoding="async">`;
}

function productCard(product){
  const soon=isComingSoon(product);
  const added=quantityInCart(product);
  const soldOut=remainingStock(product)<=0;
  let label=soon?'Coming soon':Number(product.new_arrival_weight)>0?'New arrival':Number(product.hot_selling_weight)>0?'Best seller':'';
  return `<article class="product-card" data-product-id="${esc(product.id)}"><button class="product-photo" type="button" data-action="open-product" data-id="${esc(stockKey(product))}" aria-label="View ${esc(product.name)}">${imageHtml(product)}${label?`<span class="product-image-label ${soon?'soon':''}">${label}</span>`:''}</button><div class="product-info"><button class="product-title" type="button" data-action="open-product" data-id="${esc(stockKey(product))}"><span>${esc(product.name)}</span></button><p class="product-size">${esc(formatSize(product.ml))}</p><div class="product-meta"><span class="sku">${esc(product.id)}</span><strong class="product-price">${Number(product.price)>0?money(product.price):'Price pending'}</strong></div><div class="product-actions">${soon?`<span class="soon-note">${icon('clock')}Arriving soon</span>`:added?stepper(product):`<button type="button" class="add-button" data-action="add" data-id="${esc(stockKey(product))}" aria-label="Add ${esc(product.name)} to order" ${soldOut||state.checking?'disabled':''}>${state.view==='list'?icon('shopping-cart'):'Add'}</button>`}</div><p class="in-order">${added?`${added} in your order`:''}</p></div></article>`;
}

function renderProducts(){
  if(!state.loaded)return;
  document.body.classList.toggle('catalog-list-view',state.view==='list');
  const focus=captureFocus($('products'));
  const all=selectProducts(products(),state.filters);
  const visible=all.slice(0,state.limit);
  $('products').className=`product-grid${state.view==='list'?' list-view':''}`;
  $('products').setAttribute('aria-busy','false');
  $('products').innerHTML=visible.length?visible.map(productCard).join(''):`<div class="empty-state">${icon('search')}<h3>No fragrances found</h3><p>Try another brand, warehouse or search.</p><button class="secondary-button" type="button" data-action="reset-filters">Clear filters</button></div>`;
  $('results-count').textContent=`${all.length} fragrances`;
  $('showing-count').textContent=all.length?`Showing ${visible.length} of ${all.length} fragrances`:'';
  $('load-more').hidden=visible.length>=all.length;
  $('clear-search').hidden=!state.filters.query;
  document.querySelectorAll('[data-view]').forEach(el=>{const active=el.dataset.view===state.view;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('#category-tabs [data-category]').forEach(el=>{const active=el.dataset.category===state.filters.category;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
  const active=[];
  if(state.filters.category!=='All')active.push(categoryNames[state.filters.category]);
  if(state.filters.warehouse!=='all')active.push(`${state.filters.warehouse} Warehouse`);
  if(state.filters.brand!=='all')active.push(state.filters.brand);
  if(state.filters.priceRange!=='any')active.push($('price-filter').selectedOptions[0].textContent);
  if(state.filters.query)active.push(`“${state.filters.query}”`);
  $('active-filters').hidden=!active.length;
  $('active-filter-text').textContent=active.join(' · ');
  restoreFocus($('products'),focus);
}

function populateFilters(){
  const available=selectProducts(products(),{...defaults,stockOnly:false});
  const warehouses=[...new Set(available.map(p=>normalizeWarehouse(p.warehouse)).filter(Boolean))].sort();
  $('warehouse-filter').innerHTML='<option value="all">All warehouses</option>'+warehouses.map(code=>`<option value="${esc(code)}">${esc(code)} Warehouse</option>`).join('');
  $('warehouse-filter').value=warehouses.includes(state.filters.warehouse)?state.filters.warehouse:'all';
  state.filters.warehouse=$('warehouse-filter').value;
  populateBrands();
  $('hero-count').textContent=`${products().length}+`;
}

function populateBrands(){
  const all=selectProducts(products(),{...defaults,warehouse:state.filters.warehouse,stockOnly:false});
  const brandNames=new Map();
  all.forEach(product=>{const name=String(product.brand||'').trim();const key=normalizeText(name);if(key&&!brandNames.has(key))brandNames.set(key,name);});
  const brands=[...brandNames.values()].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'}));
  $('brand-filter').innerHTML='<option value="all">All brands</option>'+brands.map(brand=>`<option value="${esc(brand)}">${esc(brand)}</option>`).join('');
  if(!brands.includes(state.filters.brand))state.filters.brand='all';
  $('brand-filter').value=state.filters.brand;
}

window.renderHome=function(){
  if(!products().length)return;
  clearTimeout(loadTimer);state.loaded=true;populateFilters();renderProducts();updateOrderUI();
  if(!cartEntryHandled&&new URLSearchParams(window.location.search).get('cart')==='1'){cartEntryHandled=true;openCart();}
};

function showLoadError(){
  if(state.loaded)return;
  $('products').setAttribute('aria-busy','false');
  $('products').innerHTML=`<div class="empty-state">${icon('wifi-off')}<h3>The collection couldn’t load</h3><p>Please check your connection and try again.</p><button class="secondary-button" type="button" data-action="retry-data">Try again</button></div>`;
}

function resetFilters(){
  state.filters={...defaults};state.limit=24;
  $('search-input').value='';$('warehouse-filter').value='all';$('price-filter').value='any';$('sort-select').value='popular';$('stock-filter').checked=true;
  populateBrands();renderProducts();
  document.dispatchEvent(new Event('catalog-filters-sync'));
}

function chooseCategory(category,scroll=true){
  if(!categoryNames[category])return;
  state.filters.category=category;state.limit=24;
  state.filters.stockOnly=category!=='ComingSoon';$('stock-filter').checked=state.filters.stockOnly;
  if($('menu-dialog').open)$('menu-dialog').close();
  renderProducts();
  if(scroll)$('catalog').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}

function updateProductQuantity(reference,delta){
  if(state.checking)return;
  const cart=readCart();const matches=item=>window.cartStockKey(item.name,item.warehouse)===reference;
  const existing=cart.find(matches);if(!existing)return;
  const quantity=cart.filter(matches).reduce((sum,item)=>sum+(Number(item.quantity)||0),0)+delta;
  const product=getProduct(reference);
  if(delta>0&&(!product||isComingSoon(product)||quantity>window.getOrderStockLimit(product))){showToast('You’ve reached the available stock for this warehouse.');return;}
  const next=cart.filter(item=>!matches(item)||item===existing);
  // Keep the saved price and size; quantity changes must not bypass checkout approval.
  if(quantity>0)existing.quantity=quantity;
  saveCart(quantity>0?next:next.filter(item=>!matches(item)));renderProducts();setValidation('');
  showQuantityFeedback(product||{id:existing.name,warehouse:existing.warehouse},delta,Math.max(0,quantity));
}

function addToOrder(id){
  if(state.checking)return;
  const product=getProduct(id);if(!product)return;
  if(isComingSoon(product)){showToast('This fragrance is arriving soon.');return;}
  if(quantityInCart(product)>0)return;
  if(!remainingStock(product)){showToast('Please check the available stock in this warehouse.');return;}
  const cart=readCart();const key=stockKey(product);const existing=cart.find(item=>window.cartStockKey(item.name,item.warehouse)===key);
  if(existing)return;
  cart.push({name:product.id,caption:`${product.id} - ${product.name}`,warehouse:product.warehouse,brand:product.brand,price:Number(product.price),ml:String(product.ml||''),img:product.img,quantity:1});
  saveCart(cart);renderProducts();showQuantityFeedback(product,1,1);
}

function updateOrderUI(){
  const summary=getOrderSummary(readCart(),tierSchedule);
  $('cart-count').textContent=summary.qty;$('cart-count').hidden=!summary.qty;
  $('mobile-order-bar').hidden=!summary.qty;
  $('mobile-order-total').textContent=money(summary.totalAmount);
  $('mobile-order-quantity').textContent=`${summary.qty} ${summary.qty===1?'item':'items'} · ${storefront.freeShipping?'free shipping':'excl. shipping'}`;
  document.body.classList.toggle('has-order',summary.qty>0);
  if($('cart-dialog').open)renderCart();
  if($('product-dialog').open){const product=getProduct(state.detailId);if(product)renderDetail(product);}
}

function renderDetail(product,{resetScroll=false}={}){
  const focus=captureFocus($('product-detail'));
  const scrollTop=resetScroll?0:($('product-detail').querySelector('.detail-body')?.scrollTop||0);
  const soon=isComingSoon(product);
  const warehouse=normalizeWarehouse(product.warehouse);
  const added=quantityInCart(product);
  $('product-detail').innerHTML=`<div class="detail-layout"><div class="detail-body" tabindex="0" role="region" aria-label="Product details"><div class="detail-media"><div class="detail-photo">${imageHtml(product)}</div><p class="image-caption">Product photo</p></div><div class="detail-copy"><span class="eyebrow">${esc(product.brand)}</span><h2 id="detail-title">${esc(product.name)}</h2><p class="product-size">${esc(formatSize(product.ml))}</p><span class="sku">${esc(product.id)}</span><p class="detail-price">${Number(product.price)>0?money(product.price):'Price pending'}</p><span class="stock-status ${soon?'coming-soon':''}">${icon(soon?'clock':'circle-check-filled')}${soon?'Arriving soon':`In stock (${esc(warehouse)} Warehouse)`}</span></div></div><div class="detail-order-actions">${soon?`<button type="button" class="primary-button detail-add" disabled>Arriving soon</button>`:added?`<div class="detail-quantity"><span>Quantity in order</span>${stepper(product)}</div><button type="button" class="primary-button detail-add" data-action="open-cart">${icon('shopping-cart')}View order</button>`:`<button type="button" class="primary-button detail-add" data-action="add" data-id="${esc(stockKey(product))}" ${remainingStock(product)<=0||state.checking?'disabled':''}>${icon('shopping-cart')}Add to order</button>`}<p class="detail-note">${soon?'This item will be available to order after it arrives.':`Volume discounts apply at checkout. Shipping: ${esc(storefront.shippingLabel)}.`}</p>${added?`<p class="in-order">${added} in your order</p>`:''}</div></div>`;
  const body=$('product-detail').querySelector('.detail-body');
  if(body)body.scrollTop=scrollTop;
  restoreFocus($('product-detail'),focus);
}

function openDialog(dialog){
  returnFocus.set(dialog,document.activeElement);
  if(!dialog.open){dialog.showModal();dialogStack.push(dialog);}
  document.body.style.overflow='hidden';
  syncToastHost();
}

function closeDialog(dialog){dialog.close();}

function openProduct(id){
  const product=getProduct(id);if(!product)return;
  state.detailId=stockKey(product);renderDetail(product,{resetScroll:true});$('product-dialog').scrollTop=0;openDialog($('product-dialog'));
}

function cartLine(item,index){
  const product=window.getCartProduct(item,products());
  const allocated=product?quantityInCart(product):0;
  const max=window.getOrderStockLimit(product);
  const title=String(item.caption||item.name).replace(new RegExp(`^${String(item.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*-\\s*`),'');
  return `<article class="cart-line"><img class="cart-line-image" src="${esc(item.img)}" alt="${esc(title)}" loading="lazy"><div class="cart-line-info"><h3>${esc(title)}</h3><span class="cart-line-size">${esc(formatSize(item.ml))}</span><span class="sku">${esc(item.name)}</span><div class="cart-line-price">${money(item.price)}</div></div><div class="cart-line-controls"><div class="quantity-stepper" data-stock-key="${esc(window.cartStockKey(item.name,item.warehouse))}"><button type="button" aria-label="Decrease ${esc(title)} quantity" data-action="cart-minus" data-index="${index}" ${state.checking?'disabled':''}>−</button><output aria-label="Order quantity">${esc(item.quantity)}</output><button type="button" aria-label="Increase ${esc(title)} quantity" data-action="cart-plus" data-index="${index}" ${state.checking||allocated>=max?'disabled':''}>+</button></div><button type="button" class="remove-line" aria-label="Remove ${esc(title)}" data-action="remove-line" data-index="${index}" ${state.checking?'disabled':''}>${icon('trash')}</button></div></article>`;
}

function renderCart(){
  const focus=captureFocus($('cart-body'));
  const cart=readCart();const summary=getOrderSummary(cart,tierSchedule);
  $('drawer-cart-count').textContent=`(${summary.qty})`;
  $('cart-actions').hidden=!cart.length;
  $('checkout-button').disabled=state.checking||!cart.length;
  $('checkout-button').innerHTML=state.checking?`Checking your order…`:`Proceed to checkout ${icon('arrow-right')}`;
  if(!cart.length){$('cart-body').innerHTML=`<div class="empty-state">${icon('shopping-bag')}<h3>Your order starts here</h3><p>Find a fragrance you love and add it to your order.</p><button type="button" class="primary-button" data-action="close-cart">Explore fragrances ${icon('arrow-right')}</button></div>`;restoreFocus($('cart-body'),focus);return;}
  const groups=new Map();cart.forEach((item,index)=>{const code=normalizeWarehouse(item.warehouse);if(!groups.has(code))groups.set(code,[]);groups.get(code).push({item,index});});
  let rows='';groups.forEach((items,code)=>{rows+=`<h3 class="warehouse-section-title">${esc(code)} Warehouse</h3>`+items.map(({item,index})=>cartLine(item,index)).join('');});
  const percent=window.formatDiscountPercent(summary.discountPercent);
  const next=tierSchedule.find(tier=>tier.min>summary.qty);
  $('cart-body').innerHTML=`${rows}<section class="order-summary" aria-label="Order summary"><h3>Order summary</h3><div class="summary-line"><span>Items (${summary.qty})</span><span>${money(summary.subtotal)}</span></div><div class="summary-line"><span>Volume discount (${percent}%)</span><span class="discount-value">−${money(summary.discountAmount)}</span></div><div class="summary-line total"><span>${storefront.freeShipping?'Total amount':'Product total'}</span><span>${money(summary.totalAmount)}</span></div><div class="summary-line shipping"><span>Shipping</span><span>${esc(storefront.shippingLabel)}</span></div><div class="discount-note">${next?`Add ${next.min-summary.qty} more ${next.min-summary.qty===1?'item':'items'} for ${window.formatDiscountPercent(next.percent)}% off your entire order.`:'Your maximum volume discount is applied.'}<br>${shippingNote}</div></section>`;
  restoreFocus($('cart-body'),focus);
}

function setValidation(message,stateName='ready'){
  $('cart-validation').textContent=message;$('cart-validation').dataset.state=stateName;$('cart-validation').hidden=!message;
}

function openCart(){
  if($('menu-dialog').open)$('menu-dialog').close();
  if($('product-dialog').open)$('product-dialog').close();
  renderCart();openDialog($('cart-dialog'));
}

function updateCartQuantity(index,delta){
  const item=readCart()[index];if(!item)return;
  updateProductQuantity(window.cartStockKey(item.name,item.warehouse),delta);
}

function confirmAction(title,message,label,action){
  $('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-submit').textContent=label;state.confirm=action;openDialog($('confirm-dialog'));
}

function composeOrder(cart){
  const summary=getOrderSummary(cart,tierSchedule);
  const groups=new Map();cart.forEach(item=>{const label=`${normalizeWarehouse(item.warehouse)} Warehouse`;if(!groups.has(label))groups.set(label,[]);groups.get(label).push(item);});
  let text='*New Order Request* 📦\n----------------------------\n';
  groups.forEach((items,warehouse)=>{
    text+=`*${warehouse}*\n`;
    items.forEach(item=>{
      const size=formatSize(item.ml);
      const caption=String(item.caption||item.name);
      const prefix=`${item.name} - `;
      const title=caption.startsWith(prefix)?caption.slice(prefix.length):caption===item.name?'':caption;
      const suffix=size&&!caption.replace(/\s/g,'').toLowerCase().includes(size.replace(/\s/g,'').toLowerCase())?` · ${size}`:'';
      // Put the ordered quantity before gift-set names/specs containing x4/x6.
      text+=`• ${item.name} × ${item.quantity}${title?` - ${title}`:''}${suffix}\n  Unit ${money(item.price)} = Line subtotal *${money(cents(item.price)*Number(item.quantity)/100)}*\n`;
    });
    text+='\n';
  });
  text+=`----------------------------\nLV Quantity: ${summary.lvQty}\nOther Quantity: ${summary.otherQty}\n*Total Quantity: ${summary.qty} pcs*\n----------------------------\nSubtotal: ${money(summary.subtotal)}\nDiscount (${window.formatDiscountPercent(summary.discountPercent)}%): -${money(summary.discountAmount)}\nShipping: ${storefront.shippingLabel}\n*${storefront.freeShipping?'Total Amount':'Total Amount (excl. shipping)'}:* ${money(summary.totalAmount)}`;
  return text;
}

async function checkout(){
  if(state.checking||!readCart().length)return;
  state.checking=true;setValidation('Checking the latest prices and warehouse inventory…');renderCart();renderProducts();
  try{
    const latest=await window.fetchLatestProductData();
    const cart=readCart();const snapshot=JSON.stringify(cart);
    const result=window.reconcileCart(cart,latest);
    if(result.changes.length){
      setValidation('Review your order changes before checkout.','error');
      confirmAction('Review order changes',result.changes.join('\n\n')+'\n\nYour selected warehouses stay the same. Update the order, review the new total, then check out again.','Update order',()=>{
        if(JSON.stringify(readCart())!==snapshot){setValidation('Your order changed in another window. Please check out again to review the latest version.','error');return;}
        saveCart(result.items);renderProducts();setValidation(result.items.length?'Order updated. Review the total, then proceed to checkout.':'These items are no longer available. Please choose other fragrances.');
      });return;
    }
    if(!result.items.length){setValidation('Your order is empty.');return;}
    saveCart(result.items);
    const text=composeOrder(result.items);
    window.location.href=`https://wa.me/${storefront.whatsappNumber}?text=${encodeURIComponent(text)}`;
  }catch(error){setValidation('We couldn’t verify current prices and inventory. Nothing has been sent. Please check your connection and try again.','error');}
  finally{state.checking=false;updateOrderUI();renderProducts();}
}

document.addEventListener('click',(event)=>{
  const category=event.target.closest('[data-category]');
  if(category){event.preventDefault();chooseCategory(category.dataset.category);return;}
  const view=event.target.closest('[data-view]');
  if(view){state.view=view.dataset.view;try{localStorage.setItem(layoutKey,state.view);}catch{}renderProducts();return;}
  const target=event.target.closest('[data-action]');if(!target)return;
  const id=target.dataset.id;const index=Number(target.dataset.index);
  switch(target.dataset.action){
    case 'open-menu':openDialog($('menu-dialog'));break;
    case 'close-menu':closeDialog($('menu-dialog'));break;
    case 'focus-search':$('catalog').scrollIntoView();$('search-input').focus({preventScroll:true});break;
    case 'clear-search':state.filters.query='';$('search-input').value='';state.limit=24;renderProducts();$('search-input').focus({preventScroll:true});break;
    case 'reset-filters':resetFilters();break;
    case 'retry-data':$('products').innerHTML='<div class="loading-state"><span class="loader"></span><p>Loading the collection…</p></div>';loadTimer=setTimeout(showLoadError,14000);window.initProductData();break;
    case 'load-more':state.limit+=24;renderProducts();break;
    case 'open-product':openProduct(id);break;
    case 'close-product':closeDialog($('product-dialog'));break;
    case 'product-minus':updateProductQuantity(id,-1);break;
    case 'product-plus':updateProductQuantity(id,1);break;
    case 'add':addToOrder(id);break;
    case 'open-cart':openCart();break;
    case 'close-cart':closeDialog($('cart-dialog'));break;
    case 'cart-minus':updateCartQuantity(index,-1);break;
    case 'cart-plus':updateCartQuantity(index,1);break;
    case 'remove-line':{if(state.checking)break;const item=readCart()[index];if(!item)break;const key=window.cartStockKey(item.name,item.warehouse);confirmAction('Remove this fragrance?','It will be removed from your order.','Remove item',()=>{saveCart(readCart().filter(item=>window.cartStockKey(item.name,item.warehouse)!==key));renderProducts();});break;}
    case 'clear-cart':if(!state.checking)confirmAction('Clear your order?','All items will be removed. You can start a new order any time.','Clear order',()=>{saveCart([]);renderProducts();setValidation('');});break;
    case 'checkout':checkout();break;
  }
});

$('search-input').addEventListener('input',(event)=>{clearTimeout(queryTimer);state.filters.query=event.target.value;state.limit=24;queryTimer=setTimeout(renderProducts,120);});
for(const [id,field] of [['warehouse-filter','warehouse'],['brand-filter','brand'],['price-filter','priceRange'],['sort-select','sort']]){
  $(id).addEventListener('change',(event)=>{state.filters[field]=event.target.value;state.limit=24;if(field==='warehouse')populateBrands();renderProducts();});
}
$('stock-filter').addEventListener('change',(event)=>{state.filters.stockOnly=event.target.checked;if(event.target.checked&&state.filters.category==='ComingSoon')state.filters.category='All';state.limit=24;renderProducts();});
$('confirm-cancel').addEventListener('click',()=>{state.confirm=null;$('confirm-dialog').close();});
$('confirm-submit').addEventListener('click',()=>{const action=state.confirm;state.confirm=null;$('confirm-dialog').close();if(action)action();});
document.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const top=dialogStack.filter(dialog=>dialog.open&&dialog.isConnected).at(-1);
  if(!top)return;
  const controls=[...top.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(el=>!el.matches(':disabled')&&el.tabIndex>=0&&el.getClientRects().length);
  const first=controls[0],last=controls.at(-1);
  if(!first)return;
  const focus=document.activeElement;
  if(!top.contains(focus)||(!event.shiftKey&&focus===last)||(event.shiftKey&&focus===first)){
    event.preventDefault();(event.shiftKey?last:first).focus({preventScroll:true});
  }
});
document.querySelectorAll('dialog').forEach(dialog=>{
  dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{
    const index=dialogStack.indexOf(dialog);if(index>=0)dialogStack.splice(index,1);
    const stillOpen=dialogStack.filter(el=>el.open);
    if(!stillOpen.length)document.body.style.overflow='';
    syncToastHost();
    const opener=returnFocus.get(dialog);
    if(opener?.isConnected&&opener.getClientRects().length&&(!stillOpen.length||stillOpen.at(-1).contains(opener)))opener.focus({preventScroll:true});
    else if(stillOpen.length)stillOpen.at(-1).querySelector('button:not(:disabled)')?.focus({preventScroll:true});
    else if(dialog.id==='cart-dialog')document.querySelector('.header-actions [data-action="open-cart"]')?.focus({preventScroll:true});
    else if(dialog.id==='product-dialog'){
      const productOpener=[...$('products').querySelectorAll('[data-action="open-product"]')].find(el=>el.dataset.id===state.detailId);
      (productOpener||$('search-input')).focus({preventScroll:true});
    }
    if(dialog.id==='confirm-dialog')state.confirm=null;
  });
});
document.addEventListener('error',(event)=>{if(event.target.tagName==='IMG'){event.target.style.visibility='hidden';event.target.setAttribute('aria-hidden','true');}},true);
window.addEventListener('storage',()=>{updateOrderUI();if(state.loaded)renderProducts();});
window.addEventListener('pageshow',()=>{updateOrderUI();if(state.loaded)renderProducts();});
window.addEventListener('resize',syncToastHost);
function applyStorefrontCopy(){
  document.querySelectorAll('[data-whatsapp]').forEach(link=>link.href=`https://wa.me/${storefront.whatsappNumber}`);
  $('service-shipping-title').textContent=storefront.freeShipping?'Free shipping':'Shipping';
  $('service-shipping-label').textContent=storefront.freeShipping?'Free shipping on every order.':storefront.shippingLabel;
  $('menu-shipping-label').textContent=`Shipping: ${storefront.shippingLabel}`;
  $('menu-discount-tiers').innerHTML=tierSchedule.filter(tier=>tier.percent>0).map(tier=>`${tier.max===Infinity?`${tier.min}+`:tier.min===tier.max?tier.min:`${tier.min}–${tier.max}`} pcs: ${window.formatDiscountPercent(tier.percent)}% off`).join('<br>');
}
applyStorefrontCopy();
updateOrderUI();
if(products().length)window.renderHome();
loadTimer=setTimeout(showLoadError,14000);
