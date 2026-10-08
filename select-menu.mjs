import {normalizeText} from './catalog-model.mjs';

export function moveOptionIndex(index,key,length){
  if(!length)return -1;
  if(key==='Home')return 0;
  if(key==='End')return length-1;
  return (index+(key==='ArrowUp'?-1:1)+length)%length;
}

export function findOptionPrefix(options,query,start=-1){
  const term=normalizeText(query);if(!term||!options.length)return -1;
  for(let offset=1;offset<=options.length;offset++){
    const index=(start+offset+options.length)%options.length;
    if(normalizeText(options[index].label).startsWith(term))return index;
  }
  return -1;
}

export function initSelectMenus(root=document){
  const definitions=[{id:'warehouse',select:'warehouse-filter',name:'Warehouse',title:'Choose a warehouse'},{id:'price',select:'price-filter',name:'Price',title:'Price range'},{id:'sort',select:'sort-select',name:'Sort',title:'Sort by'}];
  for(const definition of definitions){
    const {id,name,title}=definition;
    const select=root.getElementById(definition.select),trigger=root.getElementById(id+'-trigger'),container=root.getElementById(id+'-picker');
    if(!select||!trigger||!container)continue;
    let open=false,active=-1,typeAhead='',typeTimer,tabbing=false;
    const panel=root.createElement('div');panel.id=id+'-panel';panel.className='brand-panel select-menu';panel.hidden=true;
    const heading=root.createElement('div');heading.className='brand-panel-heading';heading.textContent=title;
    const list=root.createElement('div');list.className='brand-options';list.id=id+'-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',name);list.tabIndex=0;
    panel.append(heading,list);container.append(panel);
    const options=()=>[...select.options].filter(option=>!option.disabled&&!option.hidden).map(option=>({value:option.value,label:option.textContent}));

    function highlight(scroll=false){
      const rows=[...list.querySelectorAll('[role="option"]')];
      rows.forEach((row,index)=>row.classList.toggle('is-active',index===active));
      const row=rows[active];
      if(row){list.setAttribute('aria-activedescendant',row.id);if(scroll){if(row.offsetTop<list.scrollTop)list.scrollTop=row.offsetTop;else if(row.offsetTop+row.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=row.offsetTop+row.offsetHeight-list.clientHeight;}}
      else list.removeAttribute('aria-activedescendant');
    }

    function render(){
      const items=options();active=items.findIndex(option=>option.value===select.value);if(active<0)active=items.length?0:-1;
      list.replaceChildren();
      items.forEach((option,index)=>{
        const row=root.createElement('button');row.type='button';row.className='brand-option';row.id=id+'-option-'+index;row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.value===select.value));row.tabIndex=-1;
        const label=root.createElement('span');label.textContent=option.label;row.append(label);
        if(option.value===select.value){const check=root.createElement('i');check.className='ti ti-check';check.setAttribute('aria-hidden','true');row.append(check);}
        row.addEventListener('pointermove',()=>{active=index;highlight();});row.addEventListener('click',()=>choose(option.value));list.append(row);
      });
      highlight();if(open)position();
    }

    function sync(){
      const label=select.selectedOptions[0]?.textContent||'';
      root.getElementById(id+'-current').textContent=label;
      trigger.setAttribute('aria-label',name+': '+label);
      trigger.disabled=select.disabled;
      render();
    }

    function position(){
      if(!open)return;
      const anchor=trigger.getBoundingClientRect(),viewport=window.visualViewport;
      const leftEdge=viewport?.offsetLeft||0,topEdge=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
      const below=topEdge+height-anchor.bottom-20,above=anchor.top-topEdge-20;
      const wanted=Math.min(380,62+options().length*44),upward=below<Math.min(wanted,230)&&above>below;
      const available=upward?above:below,floating=available<110||anchor.top>topEdge+height-12||anchor.bottom<topEdge+12;
      const panelWidth=Math.min(Math.max(280,container.getBoundingClientRect().width),width-24);
      const maxHeight=Math.max(0,Math.min(380,floating?height-24:available));
      panel.style.width=panelWidth+'px';panel.style.maxHeight=maxHeight+'px';panel.classList.toggle('is-compact',maxHeight<140);
      panel.style.left=Math.max(leftEdge+12,Math.min(anchor.left,leftEdge+width-panelWidth-12))+'px';
      panel.style.top=(floating?topEdge+12:upward?anchor.top-8:anchor.bottom+8)+'px';panel.dataset.direction=!floating&&upward?'up':'down';
    }

    function close(restore=false){
      if(!open)return;open=false;tabbing=false;panel.hidden=true;trigger.setAttribute('aria-expanded','false');list.removeAttribute('aria-activedescendant');typeAhead='';clearTimeout(typeTimer);
      if(restore)trigger.focus({preventScroll:true});
    }

    function show(){
      if(open){close(true);return;}
      root.dispatchEvent(new CustomEvent('catalog-picker-open',{detail:{id}}));
      render();open=true;panel.hidden=false;trigger.setAttribute('aria-expanded','true');position();highlight(true);list.focus({preventScroll:true});
    }

    function choose(value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close(true);}
    trigger.addEventListener('click',show);
    trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!open)show();}});
    panel.addEventListener('keydown',event=>{
      if(event.key==='Tab'){tabbing=true;return;}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();active=moveOptionIndex(active,event.key,options().length);highlight(true);}
      else if(event.key==='Enter'||event.key===' '){event.preventDefault();const option=options()[active];if(option)choose(option.value);}
      else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        event.preventDefault();clearTimeout(typeTimer);typeAhead+=event.key;const repeated=[...typeAhead].every(char=>char===typeAhead[0]);
        const match=findOptionPrefix(options(),repeated?event.key:typeAhead,active);if(match>=0){active=match;highlight(true);}
        typeTimer=setTimeout(()=>typeAhead='',600);
      }
    });
    select.addEventListener('change',sync);
    new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['selected','label','disabled','hidden']});
    root.addEventListener('catalog-filters-sync',sync);
    root.addEventListener('catalog-picker-open',event=>{if(event.detail.id!==id)close();});
    root.addEventListener('pointerdown',event=>{if(open&&!container.contains(event.target))close();});
    root.addEventListener('click',event=>{if(open&&!container.contains(event.target))close();});
    root.addEventListener('focusin',event=>{if(open&&(!container.contains(event.target)||(event.target===trigger&&tabbing)))close();tabbing=false;});
    window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    window.addEventListener('scroll',event=>{if(open&&!panel.contains(event.target))position();},true);
    sync();
  }
}

if(typeof document!=='undefined')initSelectMenus();
