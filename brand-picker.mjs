import {normalizeText,searchProducts} from './catalog-model.mjs';

export function filterBrandOptions(options,query=''){
  const term=normalizeText(query);
  if(!String(query).trim())return [...options];
  if(!term)return [];
  const matches=new Set(searchProducts(options.filter(option=>option.value!=='all').map(option=>({id:option.value,brand:option.label})),query).map(option=>option.id));
  return options.filter(option=>option.value==='all'?term==='all'||term==='all brands':normalizeText(option.label).includes(term)||matches.has(option.value));
}

export function initBrandPicker(root=document){
  const get=id=>root.getElementById(id);
  const select=get('brand-filter'),trigger=get('brand-trigger'),panel=get('brand-panel'),search=get('brand-search'),list=get('brand-options');
  if(!select||!trigger||!panel||!search||!list)return;
  // Keep keyboard traversal beside the trigger, not at the end of the page.
  get('brand-picker').append(panel);
  list.tabIndex=0;
  let open=false,active=-1,visible=[];
  const options=()=>[...select.options].map(option=>({value:option.value,label:option.textContent}));

  function highlight(scroll=false){
    [...list.querySelectorAll('[role="option"]')].forEach((row,index)=>row.classList.toggle('is-active',index===active));
    const row=list.querySelectorAll('[role="option"]')[active];
    if(row){search.setAttribute('aria-activedescendant',row.id);list.setAttribute('aria-activedescendant',row.id);if(scroll){if(row.offsetTop<list.scrollTop)list.scrollTop=row.offsetTop;else if(row.offsetTop+row.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=row.offsetTop+row.offsetHeight-list.clientHeight;}}
    else{search.removeAttribute('aria-activedescendant');list.removeAttribute('aria-activedescendant');}
  }

  function render(){
    const previous=visible[active]?.value;
    visible=filterBrandOptions(options(),search.value);
    active=visible.findIndex(option=>option.value===(previous||select.value));
    if(active<0)active=visible.length?0:-1;
    list.replaceChildren();
    visible.forEach((option,index)=>{
      const row=root.createElement('button');row.type='button';row.className='brand-option'+(option.value==='all'?' brand-option-all':'');row.id=`brand-option-${index}`;row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.value===select.value));row.tabIndex=-1;
      const label=root.createElement('span');label.textContent=option.label;row.append(label);
      if(option.value===select.value){const check=root.createElement('i');check.className='ti ti-check';check.setAttribute('aria-hidden','true');row.append(check);}
      row.addEventListener('pointermove',()=>{active=index;highlight();});row.addEventListener('click',()=>choose(option.value));list.append(row);
    });
    if(!visible.length){const empty=root.createElement('div');empty.className='brand-empty';empty.textContent='No brands found. Try another name.';list.append(empty);}
    const total=options().filter(option=>option.value!=='all').length;
    get('brand-count').textContent=total;
    const count=visible.filter(option=>option.value!=='all').length;
    get('brand-matches').textContent=`${count} ${count===1?'brand':'brands'}`;
    get('brand-search-clear').hidden=!search.value;
    highlight();if(open)position();
  }

  function sync(){
    const selected=select.selectedOptions[0];const label=selected?.textContent||'All brands';
    get('brand-current').textContent=label;trigger.setAttribute('aria-label',`Brand: ${label}`);trigger.classList.toggle('has-selection',select.value!=='all');render();
  }

  function position(){
    if(!open)return;
    const anchor=get('brand-picker').getBoundingClientRect();
    const viewport=window.visualViewport;const leftEdge=viewport?.offsetLeft||0,topEdge=viewport?.offsetTop||0;
    const width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
    const below=topEdge+height-anchor.bottom-20,above=anchor.top-topEdge-20;
    const upward=below<230&&above>below;
    const panelWidth=Math.min(Math.max(320,anchor.width),width-24);
    const available=upward?above:below;
    const floating=available<190||anchor.top>topEdge+height-12||anchor.bottom<topEdge+12;
    const maxHeight=Math.max(0,Math.min(420,floating?height-24:available));
    panel.style.width=`${panelWidth}px`;panel.style.maxHeight=`${maxHeight}px`;
    panel.classList.toggle('is-compact',maxHeight<210);
    panel.style.left=`${Math.max(leftEdge+12,Math.min(anchor.left,leftEdge+width-panelWidth-12))}px`;
    panel.style.top=`${floating?topEdge+12:upward?anchor.top-8:anchor.bottom+8}px`;panel.dataset.direction=!floating&&upward?'up':'down';
  }

  function close(restore=false){
    if(!open)return;open=false;panel.hidden=true;trigger.setAttribute('aria-expanded','false');search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');list.removeAttribute('aria-activedescendant');
    if(restore)trigger.focus({preventScroll:true});
  }

  function show(){
    if(open){close(true);return;}root.dispatchEvent(new CustomEvent('catalog-picker-open',{detail:{id:'brand'}}));search.value='';active=-1;render();open=true;panel.hidden=false;trigger.setAttribute('aria-expanded','true');search.setAttribute('aria-expanded','true');position();highlight(true);
    // Focus the non-editable list; touch users opt into the keyboard by tapping search.
    list.focus({preventScroll:true});
  }

  function choose(value){
    select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close(true);
  }

  trigger.addEventListener('click',show);
  trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!open)show();}});
  search.addEventListener('input',()=>{active=-1;visible=[];render();});
  panel.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    if(event.target!==search&&event.target!==list)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(visible.length){active=(active+(event.key==='ArrowDown'?1:-1)+visible.length)%visible.length;highlight(true);}}
    else if(event.key==='Enter'||(event.key===' '&&event.target===list)){event.preventDefault();if(visible[active])choose(visible[active].value);}
    else if((event.key==='Home'||event.key==='End')&&(event.target===list||!search.value)){event.preventDefault();active=event.key==='Home'?0:visible.length-1;highlight(true);}
  });
  get('brand-search-clear').addEventListener('click',()=>{search.value='';active=-1;visible=[];render();search.focus({preventScroll:true});});
  get('brand-reset').addEventListener('click',()=>choose('all'));
  select.addEventListener('change',sync);
  root.addEventListener('catalog-picker-open',event=>{if(event.detail.id!=='brand')close();});
  new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['selected','label']});
  root.addEventListener('pointerdown',event=>{if(open&&!panel.contains(event.target)&&!get('brand-picker').contains(event.target))close();});
  root.addEventListener('focusin',event=>{if(open&&!panel.contains(event.target)&&!get('brand-picker').contains(event.target))close();});
  root.addEventListener('click',event=>{if(open&&!panel.contains(event.target)&&!get('brand-picker').contains(event.target))close();});
  window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
  window.addEventListener('scroll',event=>{if(open&&!panel.contains(event.target))position();},true);
  sync();
}

if(typeof document!=='undefined')initBrandPicker();
