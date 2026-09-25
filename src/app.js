const modes={
 chat:{title:"Твоя AI-комната",eyebrow:"AI CHAT · MIYA",subtitle:"Общайся с Miya, придумывай идеи и управляй созданием контента.",placeholder:"Напиши сообщение...",send:"Отправить",status:"AI Chat готов"},
 images:{title:"Картинки",eyebrow:"IMAGE STUDIO · FLUX",subtitle:"Создавай изображения с нуля или загружай исходник и описывай изменения.",placeholder:"Опиши картинку или что изменить в загруженном изображении...",send:"Создать",status:"FLUX Dev · Image generation & editing"},
 video:{title:"Видео",eyebrow:"VIDEO STUDIO · LTX",subtitle:"Создавай видео из текста или оживляй загруженные изображения.",placeholder:"Опиши сцену, движение и стиль видео...",send:"Создать видео",status:"LTX · Video generation"}
};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let mode="chat",referenceImage=null,chatStarted=false,chatMessages=[];
const CHAT_KEY="miyaChats";
let chatMenuSuppressed=false;
function getChats(){
 try{
  const raw=localStorage.getItem(CHAT_KEY)||"[]";
  const chats=JSON.parse(raw);
  return Array.isArray(chats)?chats.filter(x=>x&&x.id&&Array.isArray(x.messages)):[];
 }catch{return[]}
}
function persistChats(chats){
 try{localStorage.setItem(CHAT_KEY,JSON.stringify(chats.slice(0,50)))}catch{}
}
function saveCurrentChat(){
 if(!chatMessages.length)return;
 const chats=getChats();
 const firstUser=chatMessages.find(x=>x.role==="user");
 const title=(firstUser?.content||"Новый чат").trim().slice(0,42)||"Новый чат";
 const currentId=window.__miyaChatId||("chat-"+Date.now()+"-"+Math.random().toString(36).slice(2,8));
 const existing=chats.find(x=>x.id===currentId);
 const messagesForStorage=chatMessages.map(m=>m.image&&m.image.length<250000?m:{...m,image:""});
 const item={id:currentId,title,messages:messagesForStorage,updatedAt:Date.now(),pinned:Boolean(existing?.pinned)};
 const index=chats.findIndex(x=>x.id===currentId);
 if(index>=0)chats[index]=item;else chats.unshift(item);
 persistChats(chats);
 window.__miyaChatId=currentId;
 renderChatHistoryMini();
}
function renderChatHistoryMini(){
 const box=$("#chatHistoryMini");if(!box)return;
 const chats=getChats()
  .sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))||(b.updatedAt||0)-(a.updatedAt||0))
  .slice(0,10);
 box.innerHTML="";
 chats.forEach(chat=>{
   const row=document.createElement("div");
   row.className="chat-history-row"+(chat.pinned?" pinned":"");
   row.dataset.chatId=chat.id;

   const b=document.createElement("button");
   b.className="chat-history-mini-item";b.type="button";
   b.textContent=chat.title||"Новый чат";b.title=chat.title||"Новый чат";
   b.onclick=e=>{e.preventDefault();e.stopPropagation();openSavedChat(chat.id)};

   const more=document.createElement("button");
   more.className="chat-history-more";more.type="button";more.title="Действия чата";more.setAttribute("aria-label","Действия чата");more.textContent="⋯";
   more.onclick=e=>{
     e.preventDefault();e.stopPropagation();
     const wasOpen=row.classList.contains("menu-open");
     resetChatMenus();
     if(!wasOpen){
       row.classList.add("menu-open");
       const rect=more.getBoundingClientRect();
       menu.style.left=Math.round(rect.right+8)+"px";
       menu.style.top=Math.round(rect.top+rect.height/2)+"px";
     }
   };

   const menu=document.createElement("div");menu.className="chat-history-menu";
   const pin=document.createElement("button");pin.type="button";
   pin.innerHTML='<span class="menu-icon menu-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8l-1 7 3 3H6l3-3-1-7Z"/><path d="M12 14v6"/></svg></span><span>'+(chat.pinned?"Открепить":"Закрепить")+'</span>';
   pin.onclick=e=>{
     e.preventDefault();e.stopPropagation();
     const all=getChats(),item=all.find(x=>x.id===chat.id);
     if(item){item.pinned=!item.pinned;persistChats(all);renderChatHistoryMini()}
   };

   const rename=document.createElement("button");rename.type="button";
   rename.innerHTML='<span class="menu-icon menu-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 3.3 3.3-.8L18.7 6.8a2.2 2.2 0 0 0-3.1-3.1L4 16.5Z"/><path d="m14.2 5.8 4 4"/></svg></span><span>Переименовать</span>';
   rename.onclick=e=>{
     e.preventDefault();e.stopPropagation();
     menu.classList.add("rename-open");menu.innerHTML="";
     const label=document.createElement("div");label.className="rename-label";label.textContent="Название чата";
     const input=document.createElement("input");input.className="chat-rename-input";input.value=chat.title||"Новый чат";input.maxLength=60;
     const save=document.createElement("button");save.type="button";save.className="chat-rename-save";save.innerHTML='<span class="menu-icon menu-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></span><span>Сохранить</span>';
     const cancel=document.createElement("button");cancel.type="button";cancel.className="chat-rename-cancel";cancel.innerHTML='<span class="menu-icon menu-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></span><span>Отмена</span>';
     const commit=()=>{
       const name=input.value.trim();if(!name)return input.focus();
       const all=getChats(),item=all.find(x=>x.id===chat.id);
       if(item){item.title=name.slice(0,60);persistChats(all)}
       renderChatHistoryMini();
     };
     save.onclick=e=>{e.stopPropagation();commit()};
     cancel.onclick=e=>{e.stopPropagation();renderChatHistoryMini()};
     input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();commit()}if(e.key==="Escape"){e.preventDefault();renderChatHistoryMini()}};
     menu.append(label,input,save,cancel);
     requestAnimationFrame(()=>{input.focus();input.select()});
   };

   const del=document.createElement("button");del.type="button";
   del.innerHTML='<span class="menu-icon menu-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></span><span>Удалить</span>';
   del.onclick=e=>{
     e.preventDefault();e.stopPropagation();
     if(!window.confirm("Удалить этот чат?"))return;
     const all=getChats().filter(x=>x.id!==chat.id);persistChats(all);
     if(window.__miyaChatId===chat.id){window.__miyaChatId=null;chatMessages=[];chatStarted=false;showEmpty()}
     renderChatHistoryMini();
   };
   menu.append(pin,rename,del);
   row.append(b,more,menu);box.appendChild(row);
 });
}
function closeChatFlyout(){
 chatMenuSuppressed=true;
 resetChatFlyoutScroll();
 $("#chatSubmenu")?.classList.add("suppressed");
 $("#chatSubmenu")?.querySelectorAll(".menu-open").forEach(x=>x.classList.remove("menu-open"));
 $("#chatMenuToggle")?.setAttribute("aria-expanded","false");
 setTimeout(()=>$("#composerInput")?.focus(),0);
}
function resetChatMenus(){
 document.querySelectorAll(".chat-history-row.menu-open").forEach(x=>x.classList.remove("menu-open"));
 document.querySelectorAll(".chat-history-menu").forEach(menu=>{
   menu.classList.remove("rename-open");
   menu.style.left="";
   menu.style.top="";
 });
}
function resetChatFlyoutScroll(){const el=$("#chatSubmenu");if(el)requestAnimationFrame(()=>{el.scrollTop=0;el.scrollLeft=0})}
function openSavedChat(id){
 const chat=getChats().find(x=>x.id===id);if(!chat)return;
 chatMenuSuppressed=true;$("#chatSubmenu")?.classList.add("suppressed");resetChatMenus();resetChatFlyoutScroll();$("#chatMenuToggle")?.setAttribute("aria-expanded","false");
 mode="chat";chatMessages=chat.messages.map(m=>({...m}));window.__miyaChatId=chat.id;chatStarted=true;
 restoreReferenceImage();setMode("chat",false);
 const c=$("#canvas");c.innerHTML='<div class="chat-stream"></div>';
 chatMessages.forEach(m=>addChatMessage(m.content,m.role==="user",m.image||""));
 renderChatHistoryMini();
 requestAnimationFrame(()=>$("#composerInput")?.focus());
}

const LIB_KEY="miyaLibrary";
function getLibrary(){try{return JSON.parse(localStorage.getItem(LIB_KEY)||"[]").filter(x=>x&&typeof x.url==="string")}catch{return[]}}
const MEDIA_DB="miyaMediaCache";
function openMediaDB(){
 return new Promise((resolve,reject)=>{
  if(!window.indexedDB)return resolve(null);
  const r=indexedDB.open(MEDIA_DB,1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("media"))r.result.createObjectStore("media",{keyPath:"id"})};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
}
async function cacheMedia(id,url){
 try{
  const db=await openMediaDB();if(!db)return;
  const response=await fetch(url,{mode:"cors"});if(!response.ok)return;
  const blob=await response.blob();
  await new Promise((resolve,reject)=>{const tx=db.transaction("media","readwrite");tx.objectStore("media").put({id,blob,url,createdAt:Date.now()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
 }catch{}
}
async function getCachedMedia(id){
 try{
  const db=await openMediaDB();if(!db)return null;
  return await new Promise((resolve,reject)=>{const tx=db.transaction("media","readonly");const r=tx.objectStore("media").get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});
 }catch{return null}
}
function saveMedia(type,url,prompt="",model=""){
 if(!url)return;
 const id=type+"-"+Date.now()+"-"+Math.random().toString(36).slice(2);
 const item={id,type,url,prompt:String(prompt||""),model:String(model||((type==="image")?"FLUX Dev":"LTX")),createdAt:Date.now()};
 const items=getLibrary();items.unshift(item);
 try{localStorage.setItem(LIB_KEY,JSON.stringify(items.slice(0,500)))}catch{
   try{localStorage.setItem(LIB_KEY,JSON.stringify(items.slice(0,100)))}catch{}
 }
 cacheMedia(id,url);
 return item;
}
async function resolveMediaUrl(item){
 const cached=await getCachedMedia(item.id);
 if(cached?.blob)return URL.createObjectURL(cached.blob);
 return item.url;
}
function setComposerAttachment(url){
 const box=$("#composerAttachment"),img=$("#composerAttachmentImage");
 if(!box||!img)return;
 if(url){img.src=url;box.hidden=false}
 else{img.removeAttribute("src");box.hidden=true}
}
function clearComposerAttachment(){
 referenceImage=null;
 setComposerAttachment("");
 if(mode==="images"&&$("#composerModel")) $("#composerModel").value="FLUX Dev";
}
function openEditor(url){referenceImage=url;try{sessionStorage.setItem("miyaReferenceImage",referenceImage)}catch{};setComposerAttachment(url);mode="images";$("#composerModel").value="FLUX Kontext Dev";$("#composerRatio").value="auto";const m=modes.images;$("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;$("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent="FLUX Kontext Dev · готово к редактированию";$(".image-settings").style.display="flex";$("#videoOptions").classList.remove("show");document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode==="images"));if(!$("#canvas .result-grid")) renderImageLibrary();$("#composerInput").focus();syncInput()}
async function downloadImage(url,format="jpeg"){
 try{
  const response=await fetch(url,{mode:"cors"});if(!response.ok)throw new Error("DOWNLOAD_HTTP_"+response.status);
  const sourceBlob=await response.blob();
  let blob=sourceBlob,ext=format,mime="image/jpeg";
  if(format!=="jpeg"){
   mime=format==="webp"?"image/webp":"image/png";ext=format;
  }
  if(format!=="jpeg"||sourceBlob.type!=="image/jpeg"){
   const bitmap=await createImageBitmap(sourceBlob);
   const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;
   const ctx=canvas.getContext("2d");
   if(format==="jpeg"){ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height)}
   ctx.drawImage(bitmap,0,0);bitmap.close();
   blob=await new Promise(resolve=>canvas.toBlob(resolve,mime,.95));
  }
  if(window.showSaveFilePicker){
   const handle=await window.showSaveFilePicker({suggestedName:"miya-image."+ext,types:[{description:"Image",accept:{[mime]:["."+ext]}}]});
   const writable=await handle.createWritable();await writable.write(blob);await writable.close();
  }else{
   const objectUrl=URL.createObjectURL(blob);const a=document.createElement("a");a.href=objectUrl;a.download="miya-image."+ext;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  }
 }catch(e){if(e?.name!=="AbortError")toast("Не удалось сохранить изображение")}
}
function closeMediaMenus(){document.querySelectorAll(".media-menu.open").forEach(x=>x.classList.remove("open"))}
function showDownloadMenu(item,anchor){
 closeMediaMenus();
 const menu=document.createElement("div");menu.className="media-menu open";
 [["jpeg","JPEG"],["png","PNG"],["webp","WEBP"]].forEach(([fmt,label])=>{
  const b=document.createElement("button");b.type="button";b.innerHTML='<span class="media-menu-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14"/></svg></span><span>'+label+'</span>';
  b.onclick=e=>{e.stopPropagation();menu.remove();downloadImage(item.url,fmt)};menu.appendChild(b);
 });
 document.body.appendChild(menu);
 const r=anchor.getBoundingClientRect();menu.style.left=Math.min(window.innerWidth-menu.offsetWidth-8,Math.max(8,r.right-menu.offsetWidth))+"px";menu.style.top=Math.min(window.innerHeight-menu.offsetHeight-8,r.bottom+7)+"px";
 setTimeout(()=>document.addEventListener("click",()=>menu.remove(),{once:true}),0);
}
function confirmDeleteMedia(item,card){
 let modal=$("#deleteConfirmModal");
 if(!modal){
  modal=document.createElement("div");
  modal.id="deleteConfirmModal";
  modal.className="delete-confirm-modal";
  modal.innerHTML='<div class="delete-confirm-backdrop"></div><div class="delete-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="deleteConfirmTitle"><div class="delete-confirm-loader"><div class="delete-confirm-ring"><span class="delete-confirm-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></span></div></div><div class="delete-confirm-copy"><div class="delete-confirm-eyebrow">MIYA STUDIO</div><h3 id="deleteConfirmTitle">Удалить материал?</h3><p>Это действие удалит выбранный материал из истории и библиотеки.</p></div><div class="delete-confirm-actions"><button type="button" class="delete-confirm-cancel">Отмена</button><button type="button" class="delete-confirm-submit"><span class="action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></span><span>Удалить</span></button></div></div></div>';
  document.body.appendChild(modal);
  const close=()=>modal.classList.remove("open");
  modal.querySelector(".delete-confirm-backdrop").onclick=close;
  modal.querySelector(".delete-confirm-cancel").onclick=close;
  modal.querySelector(".delete-confirm-submit").onclick=()=>{
    const target=modal.__deleteTarget;
    close();
    if(target)deleteMedia(target.item,target.card);
  };
 }
 modal.__deleteTarget={item,card};
 modal.classList.add("open");
 requestAnimationFrame(()=>modal.querySelector(".delete-confirm-cancel")?.focus());
}
async function deleteMedia(item,card){
 const items=getLibrary().filter(x=>x.id!==item.id);
 try{localStorage.setItem(LIB_KEY,JSON.stringify(items))}catch{}
 try{const db=await openMediaDB();if(db){await new Promise((resolve,reject)=>{const tx=db.transaction("media","readwrite");tx.objectStore("media").delete(item.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}}catch{}
 card?.remove();
 if(mode==="images")renderImageLibrary();
}
function showPrompt(item){
 let modal=$("#mediaPromptModal");
 if(!modal){
  modal=document.createElement("div");modal.id="mediaPromptModal";modal.className="media-prompt-modal";
  modal.innerHTML='<div class="media-prompt-backdrop"></div><div class="media-prompt-dialog" role="dialog" aria-modal="true"><div class="media-prompt-head"><b>Промт изображения</b><div class="media-prompt-head-actions"><button type="button" class="media-prompt-copy" aria-label="Скопировать промт" title="Скопировать промт"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg></button><button type="button" class="media-prompt-close" aria-label="Закрыть" title="Закрыть">×</button></div></div><div class="media-prompt-body"></div></div>';
  document.body.appendChild(modal);
  modal.querySelector(".media-prompt-copy").onclick=async()=>{
   const value=modal.querySelector(".media-prompt-body")?.textContent||"";
   if(!value.trim())return;
   try{await navigator.clipboard.writeText(value);toast("Промт скопирован");}
   catch{toast("Не удалось скопировать промт");}
  };
  modal.querySelector(".media-prompt-close").onclick=()=>modal.classList.remove("open");
  modal.querySelector(".media-prompt-backdrop").onclick=()=>modal.classList.remove("open");
 }
 modal.querySelector(".media-prompt-body").textContent=item.prompt||"Промт для этой картинки не сохранён. Если изображение создано до сохранения промтов, восстановить исходный текст автоматически нельзя.";
 modal.classList.add("open");
}
function closeImageViewer(){
 const modal=$("#imageViewerModal");
 if(modal){modal.classList.remove("open");document.body.classList.remove("image-viewer-open")}
}
function openImageViewer(item){
 let modal=$("#imageViewerModal");
 if(!modal){
  modal=document.createElement("div");
  modal.id="imageViewerModal";
  modal.className="image-viewer-modal";
  modal.innerHTML='<div class="image-viewer-backdrop"></div><div class="image-viewer-stage"><img class="image-viewer-image" alt="Miya AI Studio"><div class="image-viewer-controls"><button type="button" class="image-viewer-zoom" aria-label="Увеличить масштаб">＋</button><button type="button" class="image-viewer-close" aria-label="Закрыть">×</button></div></div>';
  document.body.appendChild(modal);
  modal.querySelector(".image-viewer-backdrop").onclick=closeImageViewer;
  modal.querySelector(".image-viewer-close").onclick=closeImageViewer;
  modal.querySelector(".image-viewer-zoom").onclick=()=>{
    const img=modal.querySelector(".image-viewer-image");
    const current=Number(img.dataset.zoom||"1");
    const next=current>=3?1:Math.min(3,Math.round((current+.5)*10)/10);
    img.dataset.zoom=String(next);
    img.style.transform="scale("+next+")";
    modal.querySelector(".image-viewer-zoom").textContent=next>=3?"−":"＋";
    modal.querySelector(".image-viewer-zoom").title=next>=3?"Уменьшить":"Увеличить";
  };
  document.addEventListener("keydown",e=>{
    if(!$("#imageViewerModal")?.classList.contains("open"))return;
    if(e.key==="Escape")closeImageViewer();
  });
 }
 const img=modal.querySelector(".image-viewer-image");
 img.src=item.url;
 resolveMediaUrl(item).then(url=>{if(url&&modal.classList.contains("open"))img.src=url}).catch(()=>{});
 img.onerror=()=>{img.alt="Изображение недоступно"};
 img.dataset.zoom="1";
 img.style.transform="scale(1)";
 modal.querySelector(".image-viewer-zoom").textContent="＋";
 modal.querySelector(".image-viewer-zoom").title="Увеличить";
 modal.classList.add("open");
 document.body.classList.add("image-viewer-open");
}
async function mediaItemToReference(item){
 try{
  const cached=await getCachedMedia(item.id);
  if(cached?.blob){
   return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(cached.blob)})
  }
 }catch{}
 return item.url;
}
function buildMediaCard(item,{video=false}={}){
 const card=document.createElement("div");card.className="media-card";
 const media=video?document.createElement("video"):document.createElement("img");
 media.alt=video?"Miya AI Studio":"Miya AI Studio";
 if(video){media.controls=true;media.playsInline=true;media.src=item.url}
 else{media.onerror=()=>{media.alt="Miya AI Studio";card.classList.add("media-load-error")};resolveMediaUrl(item).then(url=>{if(url)media.src=url})}
 card.appendChild(media);
 if(!video){
  media.style.cursor="zoom-in";
  media.title="Открыть изображение";
  media.addEventListener("click",e=>{e.stopPropagation();openImageViewer(item)});
 }
 const actions=document.createElement("div");actions.className="media-actions";
 const more=document.createElement("button");more.className="media-action media-more";more.title="Действия";more.setAttribute("aria-label","Действия");more.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
 const menu=document.createElement("div");menu.className="media-action-menu";
 if(!video){
  const promptBtn=document.createElement("button");promptBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg></span><span>Промт</span>';promptBtn.onclick=e=>{e.stopPropagation();showPrompt(item)};
  const editBtn=document.createElement("button");editBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 3.3 3.3-.8L18.7 6.8a2.2 2.2 0 0 0-3.1-3.1L4 16.5Z"/><path d="m14.2 5.8 4 4"/></svg></span><span>Редактировать</span>';editBtn.onclick=async e=>{e.stopPropagation();openEditor(await mediaItemToReference(item))};
  const downloadBtn=document.createElement("button");downloadBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14"/></svg></span><span>Скачать</span>';downloadBtn.onclick=e=>{e.stopPropagation();showDownloadMenu(item,downloadBtn)};
  const deleteBtn=document.createElement("button");deleteBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></span><span>Удалить</span>';deleteBtn.onclick=e=>{e.stopPropagation();confirmDeleteMedia(item,card)};
  menu.append(promptBtn,editBtn,downloadBtn,deleteBtn);
 }else{
  const deleteBtn=document.createElement("button");deleteBtn.innerHTML='<span class="action-icon">⌫</span><span>Удалить</span>';deleteBtn.onclick=e=>{e.stopPropagation();confirmDeleteMedia(item,card)};menu.append(deleteBtn);
 }
 more.onclick=e=>{e.stopPropagation();document.querySelectorAll(".media-action-menu.open").forEach(x=>x!==menu&&x.classList.remove("open"));menu.classList.toggle("open")};
 actions.append(more,menu);card.appendChild(actions);return card;
}
function renderImageLibrary(){
 const c=$("#canvas"),items=getLibrary().filter(x=>x.type==="image");
 if(!items.length){showEmpty();return}
 c.innerHTML='<div class="results-head"><div><h3>Все созданные картинки</h3></div></div><div class="result-grid"></div>';
 const grid=c.querySelector(".result-grid");items.forEach(item=>grid.appendChild(buildMediaCard(item)));
}
function renderLibrary(tab="images"){
 const c=$("#canvas"),items=getLibrary(),images=items.filter(x=>x.type==="image"),videos=items.filter(x=>x.type==="video");
 c.innerHTML='<div class="library-section"><div class="library-tabs"><button type="button" class="library-tab" data-library-tab="images">Картинки</button><button type="button" class="library-tab" data-library-tab="videos">Видео</button></div><div class="result-grid library-media-grid"></div></div>';
 c.querySelectorAll("[data-library-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.libraryTab===tab));
 const grid=c.querySelector(".library-media-grid");const list=tab==="videos"?videos:images;
 if(!list.length){grid.innerHTML='<div class="library-note">'+(tab==="videos"?"Пока нет созданных видео.":"Пока нет созданных картинок.")+'</div>'}
 else list.forEach(item=>grid.appendChild(buildMediaCard(item,{video:tab==="videos"})));
 c.querySelectorAll("[data-library-tab]").forEach(btn=>btn.onclick=()=>renderLibrary(btn.dataset.libraryTab));
}

function toast(message){
 let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";t.className="toast";document.body.appendChild(t)}
 t.textContent=message;t.classList.add("show");clearTimeout(window.__toast);
 window.__toast=setTimeout(()=>t.classList.remove("show"),2600)
}
function syncInput(){const i=$("#composerInput");if(!i)return;i.style.height="auto";i.style.height=Math.min(120,Math.max(42,i.scrollHeight))+"px";const emoji=$("#composerEmoji");if(emoji)emoji.style.display=mode==="chat"?"":"none"}
function modeHero(){
 if(mode==="chat") return `<div class="studio-room clean-canvas chat-room">
   <div class="chat-welcome section-welcome">
     <div class="hero-mark"><span class="nav-icon icon-spark" aria-hidden="true"></span></div><div class="mini-badge">MIYA CHAT</div>
     <h2>Общайся с Miya</h2>
     <p>Задавай вопросы, придумывай идеи, создавай промпты и работай с контентом.</p>
   </div>
 </div>`;
 if(mode==="images") return `<div class="studio-room clean-canvas">
   <div class="chat-welcome section-welcome">
     <div class="hero-mark image"><span class="nav-icon icon-image" aria-hidden="true"></span></div><div class="mini-badge">MIYA IMAGES</div>
     <h2>Создавай изображения</h2>
     <p>Создавай новые изображения или редактируй исходники с помощью AI.</p>
   </div>
 </div>`;
 return `<div class="studio-room clean-canvas">
   <div class="chat-welcome section-welcome">
     <div class="hero-mark video"><span class="nav-icon icon-video" aria-hidden="true"></span></div><div class="mini-badge">MIYA VIDEO</div>
     <h2>Создавай видео</h2>
     <p>Создавай видео из текста или оживляй загруженные изображения.</p>
   </div>
 </div>`;
}
function showEmpty(){
 const c=$("#canvas");c.innerHTML=modeHero();bindQuickCards();bindChatUI();
}
function bindChatUI(){
 // chat prompt binding uses a real NodeList-to-array conversion
 if(mode!=="chat")return;
 const newChat=$("#newChatBtn");
 if(newChat)newChat.onclick=(e)=>{
   e.preventDefault();e.stopPropagation();
   resetChatMenus();
   mode="chat";chatStarted=false;chatMessages=[];window.__miyaChatId=null;
   clearComposerAttachment();
   $("#composerInput").value="";
   $("#canvas").innerHTML=modeHero();
   setMode("chat",false);
   syncInput();
   $("#composerStatus").textContent="AI Chat готов";
   renderChatHistoryMini();
   closeChatFlyout();
 };
 Array.from(document.querySelectorAll("[data-chat-prompt]")).forEach(b=>b.onclick=()=>{
   $("#composerInput").value=b.dataset.chatPrompt||"";
   syncInput();
   $("#composerInput").focus();
 });
}
function bindQuickCards(){
 document.querySelectorAll(".quick-card,.feature-card[data-prompt]").forEach(b=>b.onclick=()=>{
   const p=b.dataset.prompt||"";
   if(p){$("#composerInput").value=p;syncInput();$("#composerInput").focus()}
 });
 const u=$("#uploadFeature");if(u)u.onclick=()=>$("#referenceInput").click();
 const vi=$("#videoImageFeature");if(vi)vi.onclick=()=>$("#referenceInput").click();
}
function showLoading(){
 const c=$("#canvas");
 if(mode==="images"){
  let grid=c.querySelector(".result-grid");
  if(!grid){c.innerHTML='<div class="result-grid"></div>';grid=c.querySelector(".result-grid")}
  const old=c.querySelector(".generation-loading");if(old)old.remove();
  const selectedModel=referenceImage?"FLUX Kontext Dev":($("#composerModel")?.value||"FLUX Dev");
  const card=document.createElement("div");card.className="generation-loading"+(referenceImage?" has-upload":" no-upload");
  card.dataset.model=selectedModel;
  card.innerHTML='<div class="generation-progress"><div class="progress-circle is-active"><span class="progress-percent"></span></div><div class="progress-copy"><b>Генерация изображения</b><span class="progress-model"></span></div></div>';
  card.querySelector(".progress-model").textContent=referenceImage?selectedModel+" · загрузка файла…":selectedModel+" · генерация…";
  grid.prepend(card);return;
 }
 c.innerHTML='<div class="loading-state"><div class="spinner"></div><b>Готовим видео…</b><span>Запрос отправлен в видеодвижок Miya.</span></div>';
}
function showImage(url,prompt="",model="FLUX Dev"){
 const item=saveMedia("image",url,prompt,model);
 const c=$("#canvas");let grid=c.querySelector(".result-grid");
 if(!grid){c.innerHTML='<div class="result-grid"></div>';grid=c.querySelector(".result-grid")}
 const card=buildMediaCard(item);grid.prepend(card);
 $("#composerStatus").textContent=model+" · готово";
}
async function generateImage(prompt){
 showLoading();$("#composerSend").disabled=true;
 const loader=$("#canvas .generation-loading");
 const ring=loader?.querySelector(".progress-circle");
 const percent=ring?.querySelector(".progress-percent");
 const modelName=referenceImage?"FLUX Kontext Dev":"FLUX Dev";
 const hasFileUpload=Boolean(referenceImage);
 const composerProgress=$("#composerProgress");
 let fakeProgress=0;
 let fakeTimer=null;
 const setProgress=(p)=>{
  const value=Math.max(0,Math.min(99,Math.round(p)));
  if(ring){ring.classList.remove("is-active");ring.style.setProperty("--progress",value+"%");}
  if(percent)percent.textContent=value+"%";
  if(composerProgress)composerProgress.textContent=value+"%";
 };
 const startFakeProgress=()=>{
  setProgress(fakeProgress);
  fakeTimer=setInterval(()=>{
   // Deliberately slow down near the end so the UI never pretends generation is finished.
   const remaining=92-fakeProgress;
   const step=remaining>45?Math.random()*7+2:remaining>18?Math.random()*3+1:Math.random()*0.8+0.2;
   fakeProgress=Math.min(92,fakeProgress+step);
   setProgress(fakeProgress);
   if($("#composerStatus"))$("#composerStatus").textContent=modelName+" · генерация…";
  },900);
 };
 startFakeProgress();
 $("#composerStatus").textContent=hasFileUpload?modelName+" · загрузка файла…":modelName+" · генерация…";
 try{
  const payload={
   prompt,
   ratio:referenceImage?($("#composerRatio").value==="1:1"?"auto":$("#composerRatio").value):$("#composerRatio").value
  };
  if(referenceImage){
   if(referenceImage.startsWith("data:image/"))payload.imageBase64=referenceImage;
   else payload.imageUrl=referenceImage;
  }
  const requestedCount=Math.max(1,Math.min(4,Number($("#composerCount").value)||1));
  const body=JSON.stringify({
   mode:"image",provider:"legacy-flux",prompt,model:modelName,
   ratio:$("#composerRatio").value,outputFormat:"png",copies:requestedCount,
   options:referenceImage?payload:{}
  });
  const data=await new Promise((resolve,reject)=>{
   const xhr=new XMLHttpRequest();
   xhr.open("POST","/api/generate",true);
   xhr.setRequestHeader("Content-Type","application/json");
   xhr.setRequestHeader("Accept","application/json");
   xhr.upload.onprogress=e=>{
    if(!hasFileUpload||!e.lengthComputable)return;
    const p=Math.max(0,Math.min(100,Math.round(e.loaded/e.total*100)));
    fakeProgress=p;
    setProgress(p);
    if($("#composerStatus"))$("#composerStatus").textContent=modelName+" · загрузка файла "+p+"%";
   };
   xhr.upload.onload=()=>{
    if(!hasFileUpload)return;
    fakeProgress=100;
    setProgress(100);
    const modelLabel=loader?.querySelector(".progress-model");
    if(modelLabel)modelLabel.textContent=modelName+" · файл загружен · генерация…";
    if($("#composerStatus"))$("#composerStatus").textContent=modelName+" · файл загружен · генерация…";
    if(fakeTimer){clearInterval(fakeTimer);fakeTimer=null;}
    fakeProgress=Math.max(fakeProgress,72);
    setProgress(fakeProgress);
    requestAnimationFrame(()=>{if(ring)ring.classList.add("is-active")});
   };
   xhr.onerror=()=>reject(new Error("Не удалось соединиться с сервером генерации"));
   xhr.ontimeout=()=>reject(new Error("Сервер генерации не ответил вовремя"));
   xhr.onload=()=>{
    let result={};
    try{result=xhr.responseText?JSON.parse(xhr.responseText):{}}catch{}
    if(xhr.status>=200&&xhr.status<300&&result.imageUrl)resolve(result);
    else{
      const detail=result.message||result.error||("Генерация не выполнена (HTTP "+xhr.status+")");
      reject(new Error(detail));
    }
   };
   xhr.timeout=60000;
   xhr.send(body);
  });
  const actualModel=data.model||modelName;
  if(fakeTimer){clearInterval(fakeTimer);fakeTimer=null;}
  if(loader){
   setProgress(100);
   const modelLabel=loader.querySelector(".progress-model");
   if(modelLabel)modelLabel.textContent=actualModel+" · готово";
  }
  const generatedUrls=Array.isArray(data.imageUrls)&&data.imageUrls.length
   ? data.imageUrls
   : data.imageUrl?[data.imageUrl]:[];
  if(!generatedUrls.length)throw new Error("Сервер не вернул готовое изображение");
  generatedUrls.forEach((url)=>showImage(url,prompt,actualModel));
  $("#composerInput").value="";syncInput();
  $("#composerModel").value=referenceImage?"FLUX Kontext Dev":"FLUX Dev";
  $("#composerStatus").textContent=actualModel+" · готово";
  if(composerProgress)composerProgress.textContent="100%";
  setTimeout(()=>$("#canvas .generation-loading")?.remove(),350);
 }catch(e){
  if(fakeTimer){clearInterval(fakeTimer);fakeTimer=null;}
  $("#canvas .generation-loading")?.remove();
  if(composerProgress)composerProgress.textContent="";
  toast(e.message||"Ошибка генерации");
  $("#composerStatus").textContent=modelName+" · ошибка";
 }finally{
  $("#composerSend").disabled=false;
  if(fakeTimer){clearInterval(fakeTimer);fakeTimer=null;}
}
}
function addChatMessage(text,isUser,image=""){
 let stream=$("#canvas .chat-stream");
 if(!stream){
   $("#canvas").innerHTML='<div class="chat-stream"></div>';
   stream=$("#canvas .chat-stream");
 }
 const welcome=stream.querySelector(".chat-welcome");if(welcome)welcome.remove();
 const row=document.createElement("div");row.className="chat-row "+(isUser?"user":"assistant");
 const av=document.createElement("div");av.className="chat-avatar";av.textContent=isUser?"U":"M";
 const content=document.createElement("div");content.className="chat-content";
 const bubble=document.createElement("div");bubble.className="chat-bubble";bubble.textContent=text;
 content.appendChild(bubble);
 if(image){const preview=document.createElement("img");preview.className="chat-image-attachment";preview.src=image;preview.alt="Прикреплённое изображение";content.insertBefore(preview,bubble)}
 if(!isUser){
   const actions=document.createElement("div");actions.className="chat-actions";
   actions.innerHTML='<button title="Копировать">Копировать</button><button title="Повторить"><span class="nav-icon icon-history"></span>Повторить</button><button title="Создать изображение"><span class="nav-icon icon-image"></span>Изображение</button><button title="Создать видео"><span class="nav-icon icon-video"></span>Видео</button>';
   actions.querySelector('[title="Копировать"]').onclick=()=>navigator.clipboard?.writeText(text).then(()=>toast("Скопировано"));
   actions.querySelector('[title="Создать изображение"]').onclick=()=>{setMode("images");$("#composerInput").value=text;syncInput();$("#composerInput").focus()};
   actions.querySelector('[title="Создать видео"]').onclick=()=>{setMode("video");$("#composerInput").value=text;syncInput();$("#composerInput").focus()};
   content.appendChild(actions);
 }
 row.append(av,content);stream.appendChild(row);const workspace=$("#workspace");if(workspace)requestAnimationFrame(()=>workspace.scrollTo({top:workspace.scrollHeight,behavior:"smooth"}));
 chatStarted=true;
}
async function requestChat(){
 const status=$("#composerStatus");
 status.textContent="Miya думает…";
 $("#composerSend").disabled=true;
 try{
   let answer="";
   let providerLabel="Miya AI";

   // Primary chat transport: Puter.js. It is keyless on the app side,
   // so Miya does not need a paid API key or a server-side text provider.
   if(window.puter?.ai?.chat){
     const response=await window.puter.ai.chat([
       {
         role:"system",
         content:"Ты Miya — дружелюбный AI-помощник внутри Miya AI Studio. Отвечай на русском, если пользователь пишет по-русски. Помогай с текстами, идеями, сценариями, промптами, изображениями и видео. Отвечай полезно и по существу."
       },
       ...chatMessages.slice(-12).map(m=>({role:m.role,content:m.content}))
     ],{model:"google/gemini-3.8-flash",max_tokens:2048});
     answer=typeof response==="string"
       ? response.trim()
       : String(response?.message?.content||response?.text||response?.content||"").trim();
     providerLabel="Miya · Gemini";
   }

   // Server fallback remains available if Puter is unavailable.
   if(!answer){
     const response=await fetch("/api/generate",{
       method:"POST",
       headers:{"Content-Type":"application/json","Accept":"application/json"},
       body:JSON.stringify({mode:"chat",model:"gemini-3.8-flash",messages:chatMessages}),
       signal:AbortSignal.timeout(90000)
     });
     const data=await response.json().catch(()=>({}));
     if(!response.ok||!data.text) throw new Error(data.message||data.error||"Не удалось получить ответ Miya");
     answer=String(data.text).trim();
     providerLabel="Miya · Free Text";
   }

   if(!answer)throw new Error("Miya не вернула текст ответа");
   chatMessages.push({role:"assistant",content:answer});
   addChatMessage(answer,false);
   saveCurrentChat();
   status.textContent=providerLabel;
 }catch(e){
   toast(e.message||"Ошибка AI Chat");
   status.textContent="AI Chat · ошибка";
 }finally{
   $("#composerSend").disabled=false;
 }
}
function restoreReferenceImage(){try{referenceImage=referenceImage||sessionStorage.getItem("miyaReferenceImage")||""}catch{};setComposerAttachment(referenceImage||"")}
function setVideoRatioDefault(){
 const el=$("#videoRatio"); if(el) el.value=referenceImage?"auto":"16:9";
}
function setMode(next,render=true){
 const changedSection=next!==mode;
 if(changedSection){referenceImage=null;try{sessionStorage.removeItem("miyaReferenceImage")}catch{};setComposerAttachment("");$("#composerInput").value="";syncInput()}
 mode=next;const m=modes[next];
 $("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;
 $("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent=m.status;
 $(".image-settings").style.display=next==="images"?"flex":"none";$("#videoOptions").classList.toggle("show",next==="video");
 if(next==="video") setVideoRatioDefault();
 document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode===next));
 document.querySelectorAll("#chatSubmenu .side-subbtn").forEach(x=>x.classList.remove("active"));
 $("#chatMenuToggle")?.classList.toggle("active",next==="chat");
 if(!chatMenuSuppressed){
   if($("#chatSubmenu")?.classList.contains("collapsed"))$("#chatSubmenu").classList.remove("collapsed");
   if($("#chatMenuToggle")){$("#chatMenuToggle").classList.remove("collapsed");$("#chatMenuToggle").setAttribute("aria-expanded","true")}
 }
 if($("#chatMenuArrow"))$("#chatMenuArrow").textContent="→";
 if(!render){syncInput();return}
 const canvas=$("#canvas");
 if(canvas)canvas.innerHTML="";
 if(next==="images"){
   referenceImage=referenceImage||null;
   renderImageLibrary();
   $("#composerModel").value=referenceImage?"FLUX Kontext Dev":"FLUX Dev";
   $("#composerRatio").value=referenceImage?"auto":"16:9";
 }else{
   showEmpty();
 }
 syncInput()
}
const chatMenuToggle=$("#chatMenuToggle");
if(chatMenuToggle){
 chatMenuToggle.addEventListener("click",()=>{
   resetChatMenus();
   renderChatHistoryMini();
   resetChatFlyoutScroll();
   setMode("chat");
   closeChatFlyout();
   requestAnimationFrame(()=>$("#composerInput")?.focus());
 });
}
document.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
$("#composerInput").addEventListener("input",syncInput);
$("#composerInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#composerSend").click()}});
$("#composerSend").addEventListener("click",async()=>{
 const value=$("#composerInput").value.trim();
 if(!value){toast(mode==="chat"?"Напиши сообщение":mode==="video"?"Опиши видео":"Опиши, что создать или изменить");return}
 if(mode==="images"){await generateImage(value);return}
 if(mode==="chat"){const attachedImage=referenceImage;chatMessages.push({role:"user",content:value,image:attachedImage||""});addChatMessage(value,true,attachedImage||"");$("#composerInput").value="";syncInput();saveCurrentChat();await requestChat();return}
 showLoading();$("#composerStatus").textContent="LTX · Request prepared";
 setTimeout(()=>{toast("Видео-задача подготовлена. LTX endpoint подключим следующим шагом.");showEmpty();$("#composerStatus").textContent=modes.video.status},500)
});
$("#composerAttach").onclick=()=>$("#referenceInput").click();
function copyComposerPrompt(){
 const value=$("#composerInput")?.value||"";
 if(!value.trim()){toast("Промт пуст");return}
 if(navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(()=>toast("Промт скопирован")).catch(()=>toast("Не удалось скопировать промт"));
 else toast("Копирование недоступно в этом браузере");
}
function improveComposerPrompt(){
 const i=$("#composerInput");if(!i)return;
 if(i.value.trim())i.value=i.value.trim()+", cinematic composition, professional lighting, realistic textures, highly detailed, premium quality";
 else toast("Сначала введи промпт");
 syncInput();
}
$("#composerTrash")?.addEventListener("click",()=>{
  $("#composerInput").value="";
  clearComposerAttachment();
  syncInput();
  $("#composerInput").focus();
  $("#composerStatus").textContent=modes[mode]?.status||"Готово";
});
$("#composerAttachmentRemove")?.addEventListener("click",()=>clearComposerAttachment());
$("#improve")?.addEventListener("click",improveComposerPrompt);
$("#copyPrompt")?.addEventListener("click",copyComposerPrompt);
$("#videoImprove")?.addEventListener("click",improveComposerPrompt);
$("#videoCopyPrompt")?.addEventListener("click",copyComposerPrompt);
$("#videoTrash")?.addEventListener("click",()=>{
  $("#composerInput").value="";
  clearComposerAttachment();
  syncInput();
  $("#composerInput").focus();
  $("#composerStatus").textContent=modes.video.status;
});
$("#referenceInput").onchange=e=>{
 const file=e.target.files?.[0];if(!file)return;
 const reader=new FileReader();
 reader.onload=()=>{
  referenceImage=String(reader.result||"");try{sessionStorage.setItem("miyaReferenceImage",referenceImage)}catch{};setComposerAttachment(referenceImage);
  if(mode==="images"){
    $("#composerModel").value="FLUX Kontext Dev";
    $("#composerRatio").value="auto";
    $("#composerStatus").textContent="Flux Kontext Dev · готово к редактированию";
  }else{
    $("#composerStatus").textContent="Изображение прикреплено · можно спросить Miya о фото";
  }
  toast(mode==="chat"?"Изображение прикреплено к чату":"Изображение добавлено");
  $("#composerInput").focus();
 };
 reader.readAsDataURL(file);e.target.value="";
};
let speechRecognition=null;
let speechBaseText="";
$("#composerMic").onclick=()=>{
 const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SpeechRecognition){toast("Голосовой ввод доступен в Chrome и Edge");return}
 if(speechRecognition){
   speechRecognition.stop();
   speechRecognition=null;
   $("#composerMic").classList.remove("recording");
   $("#composerMic").setAttribute("aria-label","Начать голосовой ввод");
   return;
 }
 const r=new SpeechRecognition();
 speechRecognition=r;speechBaseText=$("#composerInput").value.trim();
 r.lang="ru-RU";r.continuous=true;r.interimResults=true;
 r.onstart=()=>{$("#composerMic").classList.add("recording");$("#composerMic").setAttribute("aria-label","Остановить голосовой ввод");$("#composerStatus").textContent="Слушаю… говори спокойно"};
 r.onresult=e=>{
   let finalText="";
   for(let i=e.resultIndex;i<e.results.length;i++)finalText+=e.results[i][0].transcript;
   const stable=[...e.results].filter(x=>x.isFinal).map(x=>x[0].transcript).join("");
   const live=speechBaseText+(speechBaseText&&stable?" ":"")+stable;
   $("#composerInput").value=live+(finalText&&!e.results[e.results.length-1]?.isFinal?(live?" ":"")+finalText:"");
   syncInput();
 };
 r.onerror=()=>{toast("Не удалось распознать голос");speechRecognition=null;$("#composerMic").classList.remove("recording")};
 r.onend=()=>{
   speechRecognition=null;$("#composerMic").classList.remove("recording");$("#composerMic").setAttribute("aria-label","Начать голосовой ввод");
   if(mode==="chat")$("#composerStatus").textContent="AI Chat готов";
 };
 r.start();
};
$("#improve").onclick=improveComposerPrompt; /* keep image improve behavior */
/* legacy handler replaced above */
/* 
 const i=$("#composerInput");if(i.value.trim())i.value=i.value.trim()+", cinematic composition, professional lighting, realistic textures, highly detailed, premium quality";else toast("Сначала введи промпт");syncInput()
}; */
const emojiButton=$("#composerEmoji");
const emojiPanel=$("#emojiPanel");
const starterIdeas=[
  ["🎲","Придумай неожиданный сюжет для короткого видео"],
  ["🎬","Создай кинематографичную сцену с сильной атмосферой"],
  ["💡","Предложи необычную идею для AI-контента"],
  ["🧠","Задай мне вопрос, который заставит задуматься"],
  ["🚀","Придумай идею, которая может стать вирусной"],
  ["🎨","Предложи стиль для эффектного изображения"],
  ["📖","Придумай короткую историю с неожиданной концовкой"],
  ["🐾","Придумай забавную сцену с необычным героем"],
  ["🌌","Создай фантастическую концепцию для изображения"],
  ["🎮","Придумай простую игру для короткого ролика"],
  ["✨","Предложи свежую идею, которую редко используют"],
  ["🔥","Придумай смелую и необычную концепцию"]
];
function shuffleIdeas(){
 const row=$("#starterRow");if(!row)return;
 const pool=[...starterIdeas];
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
 row.innerHTML="";
 pool.slice(0,4).forEach(([icon,text])=>{
   const b=document.createElement("button");b.type="button";b.dataset.chatStarter=text;b.title=text;b.textContent=icon+" "+text;row.appendChild(b);
 });
}
if(emojiButton&&emojiPanel){
 emojiButton.onclick=e=>{e.preventDefault();e.stopPropagation();if(!emojiPanel.classList.contains("open"))shuffleIdeas();emojiPanel.classList.toggle("open");};
 emojiPanel.addEventListener("click",e=>{
   const btn=e.target.closest("[data-emoji]");
   const prompt=e.target.closest("[data-chat-starter]");
   if(prompt){$("#composerInput").value=prompt.dataset.chatStarter||"";syncInput();$("#composerInput").focus();emojiPanel.classList.remove("open");return}
   if(btn){const i=$("#composerInput");const pos=i.selectionStart??i.value.length;const v=btn.dataset.emoji||"";i.value=i.value.slice(0,pos)+v+i.value.slice(pos);i.focus();syncInput();}
 });
 document.addEventListener("click",e=>{if(!emojiPanel.contains(e.target)&&e.target!==emojiButton)emojiPanel.classList.remove("open")});
}
$("#themeToggle").onclick=()=>{document.body.classList.toggle("light");$("#themeToggle").textContent=document.body.classList.contains("light")?"☾":"☼"};
$("#profileButton").onclick=()=>toast("Профиль Miya User · 0 PKOIN");
document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>{
 const tool=b.dataset.tool;
 if(tool==="upload"){$("#referenceInput").click();return}
 if(tool==="improve"){$("#improve").click();return}
 if(tool==="history"||tool==="library"){
   chatMenuSuppressed=true;
   $("#chatSubmenu")?.classList.add("suppressed");
   document.querySelectorAll("[data-mode]").forEach(x=>x.classList.remove("active"));
   $("#chatMenuToggle")?.classList.remove("active");
   referenceImage=null;try{sessionStorage.removeItem("miyaReferenceImage")}catch{};setComposerAttachment("");$("#composerInput").value="";syncInput();
   mode="images";
   const m=modes.images;
   const wall=tool==="history"?{eyebrow:"MIYA HISTORY · MEDIA",title:"История",subtitle:"Твои созданные изображения и видео в одном месте."}:{eyebrow:"MIYA LIBRARY · MEDIA",title:"Библиотека",subtitle:"Сохраняй, просматривай и редактируй созданные материалы."};
   $("#workspaceEyebrow").textContent=wall.eyebrow;$("#workspaceTitle").textContent=wall.title;$("#workspaceSubtitle").textContent=wall.subtitle;
   $(".image-settings").style.display="none";$("#videoOptions").classList.remove("show");
   renderLibrary("images");
 }
});
renderChatHistoryMini();
shuffleIdeas();
setMode("chat");
renderChatHistoryMini();


const chatNavWrap=$("#chatNavWrap")||$(".chat-nav-wrap");
if(chatNavWrap){chatNavWrap.addEventListener("mouseleave",()=>{chatMenuSuppressed=false;$("#chatSubmenu")?.classList.remove("suppressed");$("#chatMenuToggle")?.setAttribute("aria-expanded","false")})}

// Keep chat action menus from becoming sticky when the pointer leaves the flyout.
document.addEventListener("click",e=>{if(!e.target.closest(".chat-history-row"))resetChatMenus()});
document.addEventListener("click",e=>{
 if(!e.target.closest(".media-actions")) document.querySelectorAll(".media-action-menu.open").forEach(x=>x.classList.remove("open"));
}); $("#composerTrash")?.addEventListener("click",()=>{
   $("#composerInput").value="";
   clearComposerAttachment();
   syncInput();
   $("#composerInput").focus();
   $("#composerStatus").textContent=modes[mode]?.status||"Готово";
 });
 $("#composerAttachmentRemove")?.addEventListener("click",()=>clearComposerAttachment());
 $("#improve")?.addEventListener("click",improveComposerPrompt);
 $("#copyPrompt")?.addEventListener("click",copyComposerPrompt);
 $("#videoImprove")?.addEventListener("click",improveComposerPrompt);
 $("#videoCopyPrompt")?.addEventListener("click",copyComposerPrompt);
 $("#videoTrash")?.addEventListener("click",()=>{
   $("#composerInput").value="";
   clearComposerAttachment();
   syncInput();
   $("#composerInput").focus();
   $("#composerStatus").textContent=modes.video.status;
 });

