import { Client, handle_file } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
const modes={
 chat:{title:"Твоя AI-комната",eyebrow:"AI CHAT",subtitle:"Общайся с Miya, придумывай идеи и управляй созданием контента.",placeholder:"Напиши сообщение...",send:"Отправить",status:"AI Chat готов"},
 images:{title:"Картинки",eyebrow:"КАРТИНКИ",subtitle:"Создавай изображения с нуля или загружай исходник и описывай изменения.",placeholder:"Опиши картинку или что изменить в загруженном изображении...",send:"Создать",status:"FLUX Dev · создание и редактирование"},
 video:{title:"Видео",eyebrow:"ВИДЕО",subtitle:"Создавай короткие видео по сцене, действиям и движению — со звуком.",placeholder:"Опиши сцену, действия персонажей, движение камеры и атмосферу...",send:"Создать видео",status:"Agnes Video 2.5 Flash · 720P · до 12 сек"},
voice:{title:"Голос",eyebrow:"ГОЛОС",subtitle:"Превращай текст в естественную речь с мужскими и женскими голосами.",placeholder:"Введите текст для озвучки...",send:"Создать голос",status:"Svetlana · Female · Russia"}
};
const $=s=>document.querySelector(s);
function jpegImageUrl(url){
  const value=String(url||"").trim();
  if(!value||/^data:image\//i.test(value)||/^blob:/i.test(value))return value;
  if(value.startsWith("/api/image-jpeg?"))return value;
  if(/^https?:\/\//i.test(value)){
    return "/api/image-jpeg?url="+encodeURIComponent(value);
  }
  return value;
}
let mode="chat",referenceImage=null,chatAttachmentFile=null,chatMessages=[];
let videoGenerationBusy=false;
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
 const messagesForStorage=chatMessages.map(m=>{
  if(!m.image)return m;
  const image=String(m.image);
  return image.length<=900000?{...m,image}:{...m,image:""};
});
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
     if(window.__miyaChatId===chat.id){window.__miyaChatId=null;chatMessages=[];showEmpty()}
     resetChatMenus();
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
 mode="chat";chatMessages=chat.messages.map(m=>({...m}));window.__miyaChatId=chat.id;
 restoreReferenceImage();setMode("chat",false);
 const c=$("#canvas");c.classList.add("chat-canvas");c.innerHTML='<div class="chat-stream"></div>';
 chatMessages.forEach(m=>addChatMessage(m.content,m.role==="user",m.image||""));
 renderChatHistoryMini();
 scrollChatToLatest("auto");
   $("#composerInput")?.focus();
}

const LIB_KEY="miyaLibrary";
function getLibrary(){
 try{
  const raw=JSON.parse(localStorage.getItem(LIB_KEY)||"[]");
  return Array.isArray(raw)
    ? raw.filter(x=>x&&typeof x.url==="string")
    : [];
 }catch{return[]}
}
const MEDIA_DB="miyaMediaCache";
function openMediaDB(){
 return new Promise((resolve,reject)=>{
  if(!window.indexedDB)return resolve(null);
  const r=indexedDB.open(MEDIA_DB,1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("media"))r.result.createObjectStore("media",{keyPath:"id"})};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
}
async function cacheMedia(id,url,type="image"){
 try{
  const value=String(url||"");
  const cached=await getCachedMedia(id);if(cached?.blob)return true;
  const db=await openMediaDB();if(!db)return false;
  const response=await fetch(value,{mode:"cors",cache:"force-cache"});if(!response.ok)return false;
  const blob=await response.blob();if(!blob.size)return false;
  await new Promise((resolve,reject)=>{
   const tx=db.transaction("media","readwrite");
   tx.objectStore("media").put({id,blob,url:value,createdAt:Date.now(),type});
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  return true;
 }catch{return false}
}
function warmMediaCache(items){
  /* Do not background-download whole videos: their native preload handles the
     first frame/metadata. IndexedDB warming is only for image previews. */
  const list=Array.isArray(items)
    ? items.filter(x=>x?.id&&x?.url&&x.type==="image").slice(0,12)
    : [];
  if(!list.length)return;
  const run=async()=>{
    let cursor=0;
    const worker=async()=>{
      while(cursor<list.length){
        const item=list[cursor++];
        await cacheMedia(item.id,item.url,"image");
      }
    };
    await Promise.all([worker(),worker(),worker()]);
  };
  if("requestIdleCallback" in window)window.requestIdleCallback(()=>run(),{timeout:1200});
  else setTimeout(run,80);
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
 const normalizedUrl=type==="image"?jpegImageUrl(url):String(url||"");
 const item={id,type,url:normalizedUrl,prompt:String(prompt||""),model:String(model||((type==="image")?"FLUX Dev":"LTX")),createdAt:Date.now()};
 const items=getLibrary();items.unshift(item);
 try{localStorage.setItem(LIB_KEY,JSON.stringify(items.slice(0,500)))}catch{
   try{localStorage.setItem(LIB_KEY,JSON.stringify(items.slice(0,100)))}catch{}
 }
 cacheMedia(id,url,type);
 return item;
}
function removeBrokenMediaItem(item,card){
 // Never delete library records just because a provider URL is temporarily
 // unavailable. The IndexedDB cache may still contain the original image.
 
}
async function resolveMediaUrl(item){
 if(!item?.url)return "";
 try{
  const cached=await getCachedMedia(item.id);
  if(cached?.blob)return URL.createObjectURL(cached.blob);
 }catch{}
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
 chatAttachmentFile=null;
 setComposerAttachment("");
 if(mode==="images"&&$("#composerModel")) $("#composerModel").value="FLUX Dev";
}
function openEditor(url){referenceImage=url;try{sessionStorage.setItem("miyaReferenceImage",referenceImage)}catch{};setComposerAttachment(url);mode="images";$("#composerModel").value="FLUX Kontext Dev";$("#composerRatio").value="auto";const m=modes.images;$("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;$("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent="FLUX Kontext Dev · готово к редактированию";$(".image-settings").style.display="flex";$("#videoOptions").classList.remove("show");document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode==="images"));if(!$("#canvas .result-grid")) renderImageLibrary();$("#composerInput").focus();syncInput()}
async function downloadImage(url){
 try{
  const response=await fetch(jpegImageUrl(url),{mode:"cors"});if(!response.ok)throw new Error("DOWNLOAD_HTTP_"+response.status);
  const sourceBlob=await response.blob();
  let blob=sourceBlob;
  if(sourceBlob.type!=="image/jpeg"){
   const bitmap=await createImageBitmap(sourceBlob);
   const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;
   const ctx=canvas.getContext("2d");
   ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(bitmap,0,0);bitmap.close();
   blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.95));
  }
  if(!blob)throw new Error("JPEG_CONVERSION_FAILED");
  if(window.showSaveFilePicker){
   const handle=await window.showSaveFilePicker({suggestedName:"miya-image.jpg",types:[{description:"JPEG image",accept:{"image/jpeg":[".jpg"]}}]});
   const writable=await handle.createWritable();await writable.write(blob);await writable.close();
  }else{
   const objectUrl=URL.createObjectURL(blob);const a=document.createElement("a");a.href=objectUrl;a.download="miya-image.jpg";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  }
 }catch(e){if(e?.name!=="AbortError")toast("Не удалось сохранить JPG")}
}
function closeMediaMenus(){document.querySelectorAll(".media-menu.open").forEach(x=>x.classList.remove("open"))}
function showDownloadMenu(item,anchor){
 closeMediaMenus();
 const menu=document.createElement("div");menu.className="media-menu open";
 const b=document.createElement("button");b.type="button";b.innerHTML='<span class="media-menu-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14"/></svg></span><span>Скачать JPG</span>';
 b.onclick=e=>{e.stopPropagation();menu.remove();downloadImage(item.url)};menu.appendChild(b);
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
  modal.innerHTML=`<div class="image-viewer-backdrop"></div><div class="image-viewer-stage">
<img class="image-viewer-image" alt="Miya AI Studio" draggable="false">
<button type="button" class="image-viewer-nav image-viewer-prev" aria-label="Предыдущее изображение" title="Предыдущее изображение"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7"/><path d="M8 12h10"/></svg></button>
<button type="button" class="image-viewer-nav image-viewer-next" aria-label="Следующее изображение" title="Следующее изображение"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7"/><path d="M16 12H6"/></svg></button>
<div class="image-viewer-controls">
<button type="button" class="image-viewer-edit" aria-label="Изменить картинку" title="Изменить картинку"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 3.3 3.3-.8L18.7 6.8a2.2 2.2 0 0 1 3.1 3.1L6.5 19l-3.3.8.8-3.3Z"/><path d="m14.2 5.8 4 4"/></svg></button>
<button type="button" class="image-viewer-video" aria-label="Создать видео" title="Создать видео"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg></button>
<button type="button" class="image-viewer-prompt" aria-label="Показать промт" title="Промт"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h6M8 15h4"/></svg></button>
<button type="button" class="image-viewer-copy" aria-label="Копировать картинку" title="Копировать"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg></button>
<button type="button" class="image-viewer-download" aria-label="Скачать" title="Скачать"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14"/></svg></button>
<button type="button" class="image-viewer-delete" aria-label="Удалить" title="Удалить"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button>
<button type="button" class="image-viewer-zoom" aria-label="Увеличить" title="Увеличить"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"/><path d="M12 8v8M8 12h8"/></svg></button>
<button type="button" class="image-viewer-close" aria-label="Закрыть" title="Закрыть"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/></svg></button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector(".image-viewer-backdrop").onclick=closeImageViewer;
  modal.querySelector(".image-viewer-close").onclick=closeImageViewer;
  modal.querySelector(".image-viewer-edit").onclick=async()=>{
    const current=getLibrary().find(x=>x.id===modal.dataset.viewerItemId);
    if(!current)return;
    closeImageViewer();
    openEditor(await mediaItemToReference(current));
  };
  modal.querySelector(".image-viewer-video").onclick=()=>{
    const current=getLibrary().find(x=>x.id===modal.dataset.viewerItemId);
    if(!current)return;
    closeImageViewer();
    openVideoFromImage(current.url);
  };
  modal.querySelector(".image-viewer-prompt").onclick=()=>{
    const current=getLibrary().find(x=>x.id===modal.dataset.viewerItemId);
    if(current)showPrompt(current);
  };
  modal.querySelector(".image-viewer-copy").onclick=async()=>{
    const current=getLibrary().find(x=>x.id===modal.dataset.viewerItemId);
    if(!current)return;
    try{
      const response=await fetch(current.url,{headers:{Accept:"image/*"}});
      if(!response.ok)throw new Error();
      const blob=await response.blob();
      if(!navigator.clipboard?.write||!window.ClipboardItem)throw new Error();
      await navigator.clipboard.write([new ClipboardItem({[blob.type||"image/png"]:blob})]);
      toast("Картинка скопирована");
    }catch{toast("Не удалось скопировать картинку")}
  };
  modal.querySelector(".image-viewer-download").onclick=()=>{
    const current=getLibrary().find(x=>x.id===modal.dataset.viewerItemId);
    if(current)showDownloadMenu(current,modal.querySelector(".image-viewer-download"));
  };
  modal.querySelector(".image-viewer-delete").onclick=()=>{
    const current=getLibrary().find(x=>x.id===modal.dataset.viewerItemId);
    if(!current)return;
    closeImageViewer();
    const card=document.querySelector('.media-card[data-media-id="'+current.id+'"]');
    confirmDeleteMedia(current,card);
  };
  const stage=modal.querySelector(".image-viewer-stage");
  const prevButton=modal.querySelector(".image-viewer-prev");
  const nextButton=modal.querySelector(".image-viewer-next");
  const zoomButton=modal.querySelector(".image-viewer-zoom");
  const getViewerItems=()=>getLibrary().filter(x=>x.type==="image");
  const updateViewerNav=()=>{
    const items=getViewerItems();
    const currentId=modal.dataset.viewerItemId||"";
    const index=items.findIndex(x=>x.id===currentId);
    const hasPrev=index>0,hasNext=index>=0&&index<items.length-1;
    prevButton.hidden=!hasPrev; nextButton.hidden=!hasNext;
    prevButton.disabled=!hasPrev; nextButton.disabled=!hasNext;
  };
  const showViewerItem=(nextItem)=>{
    if(!nextItem)return;
    modal.dataset.viewerItemId=nextItem.id;
    const viewerImg=modal.querySelector(".image-viewer-image");
    viewerImg.src=nextItem.url;
    viewerImg.dataset.zoom="1";viewerImg.dataset.panX="0";viewerImg.dataset.panY="0";
    viewerImg.style.transform="translate3d(0,0,0) scale(1)";
    viewerImg.style.cursor="default";
    const z=modal.querySelector(".image-viewer-zoom");
    z.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"/><path d="M12 8v8M8 12h8"/></svg>';
    z.title="Увеличить";
    resolveMediaUrl(nextItem).then(url=>{
      if(url&&modal.classList.contains("open")&&modal.dataset.viewerItemId===nextItem.id)viewerImg.src=url;
    }).catch(()=>{});
    updateViewerNav();
  };
  modal.__updateViewerNav=updateViewerNav;
  const moveViewer=(direction)=>{
    const items=getViewerItems();
    const index=items.findIndex(x=>x.id===modal.dataset.viewerItemId);
    if(index<0)return;
    const next=items[index+direction];
    if(next)showViewerItem(next);
  };
  prevButton.onclick=()=>moveViewer(-1);
  nextButton.onclick=()=>moveViewer(1);
  const img=modal.querySelector(".image-viewer-image");
  const applyTransform=()=>{
    const z=Number(img.dataset.zoom||"1"),x=Number(img.dataset.panX||"0"),y=Number(img.dataset.panY||"0");
    img.style.transform="translate3d("+x+"px,"+y+"px,0) scale("+z+")";
    img.style.cursor=z>1?"grab":"default";
  };
  const setZoom=(z)=>{
    const next=Math.max(1,Math.min(3,z));
    img.dataset.zoom=String(next);
    if(next===1){img.dataset.panX="0";img.dataset.panY="0"}
    applyTransform();
    zoomButton.innerHTML=next>1?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2M7.7 10.8h6.2"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2M10.8 7.7v6.2M7.7 10.8h6.2"/></svg>';
    zoomButton.title=next>1?"Сбросить масштаб":"Увеличить";
  };
  zoomButton.onclick=()=>setZoom(Number(img.dataset.zoom||"1")>=3?1:Number(img.dataset.zoom||"1")+.5);
  let dragging=false,startX=0,startY=0,baseX=0,baseY=0;
  img.addEventListener("pointerdown",ev=>{
    if(Number(img.dataset.zoom||"1")<=1)return;
    dragging=true;startX=ev.clientX;startY=ev.clientY;baseX=Number(img.dataset.panX||"0");baseY=Number(img.dataset.panY||"0");
    img.setPointerCapture?.(ev.pointerId);img.style.cursor="grabbing";ev.preventDefault();
  });
  img.addEventListener("pointermove",ev=>{
    if(!dragging)return;
    img.dataset.panX=String(baseX+ev.clientX-startX);img.dataset.panY=String(baseY+ev.clientY-startY);applyTransform();
  });
  const stopDrag=ev=>{if(!dragging)return;dragging=false;try{img.releasePointerCapture?.(ev.pointerId)}catch{};if(Number(img.dataset.zoom||"1")>1)img.style.cursor="grab"};
  img.addEventListener("pointerup",stopDrag);img.addEventListener("pointercancel",stopDrag);
  stage.addEventListener("wheel",ev=>{
    if(!modal.classList.contains("open"))return;
    ev.preventDefault();
    setZoom(Number(img.dataset.zoom||"1")+(ev.deltaY<0?.5:-.5));
  });
  document.addEventListener("keydown",e=>{
    if(!$("#imageViewerModal")?.classList.contains("open"))return;
    if(e.key==="Escape")closeImageViewer();
    else if(e.key==="ArrowLeft")moveViewer(-1);
    else if(e.key==="ArrowRight")moveViewer(1);
  });
 }
 const img=modal.querySelector(".image-viewer-image");
 modal.dataset.viewerItemId=item.id;
 img.src=item.url;
 resolveMediaUrl(item).then(url=>{if(url&&modal.classList.contains("open")&&modal.dataset.viewerItemId===item.id)img.src=url}).catch(()=>{});
 img.onerror=()=>{img.alt="Изображение недоступно"};
 img.dataset.zoom="1";
 img.dataset.panX="0";
 img.dataset.panY="0";
 const zoomControl=modal.querySelector(".image-viewer-zoom");
 zoomControl.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"/><path d="M12 8v8M8 12h8"/></svg>';
 zoomControl.title="Увеличить";
 img.style.transform="translate3d(0,0,0) scale(1)";
 modal.__updateViewerNav?.();
 modal.classList.add("open");
 document.body.classList.add("image-viewer-open");
}
function closeVideoViewer(){
 const modal=$("#videoViewerModal");
 if(modal){modal.classList.remove("open");document.body.classList.remove("image-viewer-open")}
}
function openVideoViewer(item){
 let modal=$("#videoViewerModal");
 if(!modal){
  modal=document.createElement("div");modal.id="videoViewerModal";modal.className="image-viewer-modal video-viewer-modal";
  modal.innerHTML=`<div class="image-viewer-backdrop"></div><div class="image-viewer-stage video-viewer-stage">
<video class="image-viewer-video-player" playsinline controls preload="metadata"></video>
<button type="button" class="image-viewer-nav image-viewer-prev" title="Предыдущее видео"><svg viewBox="0 0 24 24"><path d="m14.5 5-7 7 7 7"/><path d="M8 12h10"/></svg></button>
<button type="button" class="image-viewer-nav image-viewer-next" title="Следующее видео"><svg viewBox="0 0 24 24"><path d="m9.5 5 7 7-7 7"/><path d="M16 12H6"/></svg></button>
<div class="image-viewer-controls">
<button type="button" class="image-viewer-prompt" title="Промт"><svg viewBox="0 0 24 24"><path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h6M8 15h4"/></svg></button>
<button type="button" class="image-viewer-download" title="Скачать"><svg viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4M5 19h14"/></svg></button>
<button type="button" class="image-viewer-delete" title="Удалить"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button>
<button type="button" class="image-viewer-close" title="Закрыть"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/></svg></button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector(".image-viewer-backdrop").onclick=closeVideoViewer;modal.querySelector(".image-viewer-close").onclick=closeVideoViewer;
  modal.querySelector(".image-viewer-prompt").onclick=()=>{const x=getLibrary().find(x=>x.id===modal.dataset.viewerItemId);if(x)showPrompt(x)};
  modal.querySelector(".image-viewer-download").onclick=()=>{const x=getLibrary().find(x=>x.id===modal.dataset.viewerItemId);if(x)showDownloadMenu(x,modal.querySelector(".image-viewer-download"))};
  modal.querySelector(".image-viewer-delete").onclick=()=>{const x=getLibrary().find(x=>x.id===modal.dataset.viewerItemId);if(!x)return;closeVideoViewer();confirmDeleteMedia(x,document.querySelector('.media-card[data-media-id="'+x.id+'"]'))};
  const player=modal.querySelector(".image-viewer-video-player"),prev=modal.querySelector(".image-viewer-prev"),next=modal.querySelector(".image-viewer-next");
  const items=()=>getLibrary().filter(isVideoLibraryItem);
  const nav=()=>{const a=items(),i=a.findIndex(x=>x.id===modal.dataset.viewerItemId),p=i>0,n=i>=0&&i<a.length-1;prev.hidden=!p;next.hidden=!n;prev.disabled=!p;next.disabled=!n};
  const show=x=>{if(!x)return;modal.dataset.viewerItemId=x.id;player.pause();player.src=proxyAgnesVideoUrl(x.url);player.load();resolveMediaUrl(x).then(u=>{if(u&&modal.classList.contains("open")&&modal.dataset.viewerItemId===x.id){player.src=u;player.load()}}).catch(()=>{});nav()};
  const move=d=>{const a=items(),i=a.findIndex(x=>x.id===modal.dataset.viewerItemId);if(i>=0&&a[i+d])show(a[i+d])};
  prev.onclick=()=>move(-1);next.onclick=()=>move(1);modal.__videoNav=nav;
  document.addEventListener("keydown",e=>{if(!$("#videoViewerModal")?.classList.contains("open"))return;if(e.key==="Escape")closeVideoViewer();else if(e.key==="ArrowLeft")move(-1);else if(e.key==="ArrowRight")move(1)});
 }
 const player=modal.querySelector(".image-viewer-video-player");modal.dataset.viewerItemId=item.id;player.pause();player.src=proxyAgnesVideoUrl(item.url);player.load();
 resolveMediaUrl(item).then(u=>{if(u&&modal.classList.contains("open")&&modal.dataset.viewerItemId===item.id){player.src=u;player.load()}}).catch(()=>{});
 modal.__videoNav?.();modal.classList.add("open");document.body.classList.add("image-viewer-open");
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
 let media=null,mediaFailed=false;
 const handleMediaFailure=()=>{
   if(mediaFailed)return;
   mediaFailed=true;card.classList.add("media-load-error");
   if(media&&media.tagName==="VIDEO"){media.removeAttribute("src");media.load();media.controls=false}
 };
 if(video){
   // The old Video tab used the real video element as the card preview.
   // Resolve the IndexedDB copy first, then fall back to the provider URL.
   media=document.createElement("video");
   media.className="media-video";
   media.setAttribute("aria-label","Miya Studio video");
   media.controls=false;media.playsInline=true;media.preload="none";media.muted=false;media.defaultMuted=false;media.volume=1;
   media.addEventListener("error",handleMediaFailure);
   media.addEventListener("click",e=>{e.stopPropagation();openVideoViewer(item)});
   card.addEventListener("click",e=>{if(!e.target.closest(".media-actions"))openVideoViewer(item)});
   card.appendChild(media);
   const directUrl=proxyAgnesVideoUrl(item.url);
   if(directUrl)media.src=directUrl;
   resolveMediaUrl(item).then(url=>{
     if(url&&url!==directUrl&&!mediaFailed){media.src=url;media.load();}
   }).catch(()=>{});
  }else{
   media=document.createElement("img");media.alt="Miya Studio";media.style.cursor="zoom-in";media.title="Открыть изображение";
   media.decoding="async";
   media.addEventListener("error",()=>{
     // Keep the library card visible. A provider URL can expire without the
     // saved library record becoming invalid.
     mediaFailed=true;
     media.removeAttribute("src");
     media.alt="Изображение недоступно";
   });
   // Prefer the persistent IndexedDB copy. Never request dead legacy Vheer
   // result URLs. If no local copy exists, keep the card as a placeholder.
   resolveMediaUrl(item).then(url=>{
     if(url&&!mediaFailed){media.src=url;media.load();return}
     const rawUrl=String(item.url||"");
     if(!/^https?:\/\/access\.vheer\.com\/results\//i.test(rawUrl)&&rawUrl&&!mediaFailed){
       media.src=rawUrl;
       media.load();
     }else if(/^https?:\/\/access\.vheer\.com\/results\//i.test(rawUrl)){
       media.alt="Старая копия изображения";
     }
   }).catch(()=>{
     const rawUrl=String(item.url||"");
     if(!/^https?:\/\/access\.vheer\.com\/results\//i.test(rawUrl)&&rawUrl&&!mediaFailed){
       media.src=rawUrl;
       media.load();
     }else{
       media.alt="Старая копия изображения";
     }
   });
   const isAgnesPreview=/^Agnes Image/i.test(String(item.model||""));
   media.loading=isAgnesPreview?"lazy":"eager";
   media.fetchPriority=isAgnesPreview?"low":"high";
   if(isAgnesPreview){
     media.style.maxHeight="280px";
     media.style.objectFit="contain";
     media.style.objectPosition="center";
   }
   media.addEventListener("click",e=>{e.stopPropagation();openImageViewer(item)});
   card.appendChild(media);
 }
 const modelBadge=document.createElement("div");
 modelBadge.className="media-model-badge";
 modelBadge.textContent=String(item.model||"Модель не указана");
 modelBadge.title="Модель, которая фактически создала этот материал";
 card.appendChild(modelBadge);
 const actions=document.createElement("div");actions.className="media-actions";
 const more=document.createElement("button");more.className="media-action media-more";more.removeAttribute("title");more.setAttribute("aria-label","Открыть меню");
 more.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
 const menu=document.createElement("div");menu.className="media-action-menu";
 if(!video){
  const promptBtn=document.createElement("button");promptBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h6M8 15h4"/></svg></span><span>Промт</span>';promptBtn.onclick=e=>{e.stopPropagation();menu.classList.remove("open");showPrompt(item)};
  const editBtn=document.createElement("button");editBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 3.3 3.3-.8L18.7 6.8a2.2 2.2 0 0 1 3.1 3.1L6.5 19l-3.3.8.8-3.3Z"/><path d="m14.2 5.8 4 4"/></svg></span><span>Изменить картинку</span>';editBtn.onclick=async e=>{e.stopPropagation();menu.classList.remove("open");openEditor(await mediaItemToReference(item))};
  const videoBtn=document.createElement("button");videoBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/></svg></span><span>Сделать видео</span>';videoBtn.onclick=async e=>{e.stopPropagation();menu.classList.remove("open");openVideoFromImage(await mediaItemToReference(item))};
  const copyBtn=document.createElement("button");copyBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg></span><span>Копировать</span>';copyBtn.onclick=async e=>{e.stopPropagation();menu.classList.remove("open");try{const response=await fetch(item.url,{headers:{Accept:"image/*"}});if(!response.ok)throw new Error();const blob=await response.blob();if(!navigator.clipboard?.write||!window.ClipboardItem)throw new Error();const bitmap=await createImageBitmap(blob);const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);bitmap.close();const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.95));if(!jpeg)throw new Error();await navigator.clipboard.write([new ClipboardItem({"image/jpeg":jpeg})]);toast("JPG скопирован")}catch{toast("Не удалось скопировать картинку")}};
  const downloadBtn=document.createElement("button");downloadBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14"/></svg></span><span>Скачать</span>';downloadBtn.onclick=e=>{e.stopPropagation();menu.classList.remove("open");showDownloadMenu(item,downloadBtn)};
  const deleteBtn=document.createElement("button");deleteBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></span><span>Удалить</span>';deleteBtn.onclick=e=>{e.stopPropagation();menu.classList.remove("open");confirmDeleteMedia(item,card)};
  menu.append(promptBtn,editBtn,videoBtn,copyBtn,downloadBtn,deleteBtn);
 }else{
  const deleteBtn=document.createElement("button");deleteBtn.innerHTML='<span class="action-icon">⌫</span><span>Удалить</span>';deleteBtn.onclick=e=>{e.stopPropagation();menu.classList.remove("open");confirmDeleteMedia(item,card)};menu.append(deleteBtn);
 }
 more.onclick=e=>{e.stopPropagation();document.querySelectorAll(".media-action-menu.open").forEach(x=>x!==menu&&x.classList.remove("open"));menu.classList.toggle("open")};
 actions.append(more,menu);card.appendChild(actions);return card;
}
function openVideoFromImage(url){
 referenceImage=url||"";
 try{sessionStorage.setItem("miyaReferenceImage",referenceImage)}catch{}
 mode="video";
 const m=modes.video;
 const workspaceEyebrow=$("#workspaceEyebrow"); if(workspaceEyebrow) workspaceEyebrow.textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;
 const composerInput=$("#composerInput");
if(composerInput){
 // The video wall can still become the native Firefox context-menu target
 // when the click lands on the transparent/overlapping part of the fixed
 // composer. Handle right-clicks inside the visible composer area here and
 // paste the clipboard text directly into the textarea.
 composerInput.addEventListener("contextmenu",e=>{e.stopPropagation();},true);
 composerInput.addEventListener("mousedown",e=>{
   if(e.button!==2)e.stopPropagation();
 },true);
 document.addEventListener("contextmenu",async e=>{
   if(mode!=="video")return;
   const rect=composerInput.getBoundingClientRect();
   if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return;
   e.preventDefault();
   e.stopPropagation();
   composerInput.focus({preventScroll:true});
   try{
     const text=await navigator.clipboard.readText();
     if(text){
       const startPos=composerInput.selectionStart??composerInput.value.length;
       const endPos=composerInput.selectionEnd??startPos;
       composerInput.setRangeText(text,startPos,endPos,"end");
       composerInput.dispatchEvent(new Event("input",{bubbles:true}));
       syncInput();
       toast("Текст вставлен");
     }
   }catch{
     toast("Разреши Miya Studio доступ к буферу обмена и нажми правой кнопкой ещё раз");
   }
 },true);
}
$("#composerInput").addEventListener("paste",e=>{
 const text=e.clipboardData?.getData("text/plain");
 if(text==null)return;
 // Normalize copied prompt text so external formatting/whitespace does not
 // make the composer look uneven. Keep paragraph breaks intact.
 e.preventDefault();
 const input=$("#composerInput");
 if(!input)return;
 const clean=text
   .replace(/\\r\\n?/g,"\\n")
   .replace(/[\\u00a0\\u2007\\u202f]/g," ")
   .replace(/[\\u200b\\u200c\\u200d\\ufeff]/g,"")
   .split("\\n")
   .map(line=>line.replace(/[ \\t]+/g," ").trim())
   .join("\\n")
   .replace(/\\n{3,}/g,"\\n\\n")
   .trim();
 const start=input.selectionStart??input.value.length;
 const end=input.selectionEnd??start;
 input.setRangeText(clean,start,end,"end");
 input.dispatchEvent(new Event("input",{bubbles:true}));
 syncInput();
});
$("#composerInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#composerSend").click()}});
$("#composerSend").addEventListener("click",async()=>{
 const value=$("#composerInput").value.trim();
 if(!value){toast(mode==="chat"?"Напиши сообщение":mode==="video"?"Опиши видео":"Опиши, что создать или изменить");return}
 if(mode==="images"){await generateImage(value);return}
 if(mode==="video"){await generateVideo(value);return}
 if(mode==="voice"){await generateVoice(value);return}
 if(mode==="chat"){const attachedImage=referenceImage;const attachedFile=chatAttachmentFile;chatMessages.push({role:"user",content:value,image:attachedImage||""});addChatMessage(value,true,attachedImage||"");$("#composerInput").value="";syncInput();saveCurrentChat();await requestChat();chatAttachmentFile=null;clearComposerAttachment();return}
 showLoading();await generateVideo(value)
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
$("#voiceLanguage")?.addEventListener("change",refreshVoiceSelects);
$("#voiceGender")?.addEventListener("change",refreshVoiceSelects);
$("#voiceRate")?.addEventListener("input",e=>$("#voiceRateValue").textContent=e.target.value);
$("#voicePitch")?.addEventListener("input",e=>$("#voicePitchValue").textContent=e.target.value);
$("#voiceCopyPrompt")?.addEventListener("click",copyComposerPrompt);
$("#voiceTrash")?.addEventListener("click",()=>{$("#composerInput").value="";syncInput();$("#composerInput").focus();$("#composerStatus").textContent="Svetlana · Female · Russia"});
$("#composerTrash")?.addEventListener("click",()=>{
  $("#composerInput").value="";
  clearComposerAttachment();
  syncInput();
  $("#composerInput").focus();
  $("#composerStatus").textContent=modes[mode]?.status||"Готово";
});
$("#composerAttachmentRemove")?.addEventListener("click",()=>clearComposerAttachment());

$("#composerModel")?.addEventListener("change",()=>{
  const model=$("#composerModel").value;
  /* Keep an existing edit image visible while switching models. The selected
     model decides whether that image is actually sent for generation. */
  if(model==="FLUX Kontext Dev"){
    $("#composerRatio").value="auto";
    $("#composerStatus").textContent=referenceImage
      ?"FLUX Kontext Dev · изображение готово к редактированию"
      :"FLUX Kontext Dev · готово к редактированию";
  }else if(model==="Agnes Image 2.5 Flash"){
    $("#composerRatio").value="16:9";
    $("#composerStatus").textContent=referenceImage
      ?"Agnes Image 2.5 Flash · изображение прикреплено"
      :"Agnes Image 2.5 Flash · готово";
  }else{
    $("#composerRatio").value="16:9";
    $("#composerStatus").textContent=referenceImage
      ?"FLUX Dev · изображение прикреплено, используется только при выборе Kontext Dev"
      :"FLUX Dev · готово";
  }
});
$("#improve")?.addEventListener("click",improveComposerPrompt);
$("#copyPrompt")?.addEventListener("click",copyComposerPrompt);
$("#videoImprove")?.addEventListener("click",improveComposerPrompt);
$("#videoCopyPrompt")?.addEventListener("click",copyComposerPrompt);
$("#videoModel")?.addEventListener("change",()=>{
 const model=$("#videoModel").value;
 const duration=$("#videoDuration");
 if(duration) duration.value="5 сек";
 const progressEl=$("#composerProgress");
 const statusEl=$("#composerStatus");
 if(progressEl) progressEl.textContent="";
 if(statusEl) statusEl.textContent=model==="Agnes Video 2.5 Flash"
   ? "Agnes Video 2.5 Flash · 720P · до 12 сек"
     : model==="Agnes Video v2.0"
       ? "Agnes Video v2.0 · legacy"
       : "LTX-2.3 Distilled · Free ZeroGPU";
 
});
$("#videoTrash")?.addEventListener("click",()=>{
  $("#composerInput").value="";
  clearComposerAttachment();
  syncInput();
  $("#composerInput").focus();
  $("#composerStatus").textContent=modes.video.status;
});
async function attachReferenceFile(file){
 if(!file||!String(file.type||"").startsWith("image/")){toast("Перетащи сюда файл изображения");return}
 if(mode==="chat") chatAttachmentFile=file;
 const reader=new FileReader();
 reader.onload=()=>{
  const rawData=String(reader.result||"");
  const finishAttachment=(dataUrl)=>{
    referenceImage=dataUrl;
    try{sessionStorage.setItem("miyaReferenceImage",referenceImage)}catch{}
    setComposerAttachment(referenceImage);
    if(mode==="images"){
      $("#composerModel").value="FLUX Kontext Dev";
      $("#composerRatio").value="auto";
      $("#composerStatus").textContent="FLUX Kontext Dev · готово к редактированию";
    }else if(mode==="video"){
      $("#composerStatus").textContent=String($("#videoModel")?.value||"LTX-2.3 Distilled")+" · изображение готово";
    }else{
      $("#composerStatus").textContent="Изображение прикреплено · можно спросить Miya о фото";
    }
    toast(mode==="chat"?"Изображение прикреплено к чату":"Изображение добавлено");
    $("#composerInput").focus();
  };
  if((mode==="chat"||mode==="images"||mode==="video")&&rawData.startsWith("data:image/")){
    const image=new Image();
    image.onload=()=>{
      const max=1280,scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const ctx=canvas.getContext("2d",{alpha:false});
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      finishAttachment(canvas.toDataURL("image/jpeg",.78));
    };
    image.onerror=()=>finishAttachment(rawData);
    image.src=rawData;
  }else finishAttachment(rawData);
 };
 reader.readAsDataURL(file);
}
$("#referenceInput").onchange=e=>{
 const file=e.target.files?.[0];
 if(file)attachReferenceFile(file);
 e.target.value="";
};

// Drag an image from the desktop/file manager directly onto the "+" button.
// The same path is used in Chat, Images and Video, so it also applies model
// switching (Images -> Kontext Dev, Video -> selected video model).
const composerAttach=$("#composerAttach");
if(composerAttach){
 ["dragenter","dragover"].forEach(type=>composerAttach.addEventListener(type,e=>{
   if([...e.dataTransfer?.types||[]].includes("Files")){
     e.preventDefault();
     e.stopPropagation();
     composerAttach.classList.add("drag-over");
   }
 }));
 ["dragleave","drop"].forEach(type=>composerAttach.addEventListener(type,e=>{
   e.preventDefault();
   e.stopPropagation();
   composerAttach.classList.remove("drag-over");
 }));
 composerAttach.addEventListener("drop",e=>{
   const file=[...e.dataTransfer?.files||[]].find(f=>String(f.type||"").startsWith("image/"));
   if(file)attachReferenceFile(file);
   else toast("На «+» нужно положить файл изображения");
 });
}
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
   requestAnimationFrame(()=>$("#workspace")?.scrollTo({top:0,behavior:"auto"}));
 }
});
renderChatHistoryMini();
shuffleIdeas();
setMode("chat");


const chatNavWrap=$("#chatNavWrap")||$(".chat-nav-wrap");
if(chatNavWrap){chatNavWrap.addEventListener("mouseleave",()=>{chatMenuSuppressed=false;$("#chatSubmenu")?.classList.remove("suppressed");$("#chatMenuToggle")?.setAttribute("aria-expanded","false")})}

// Close transient chat/media menus when clicking outside them.
document.addEventListener("click",e=>{if(!e.target.closest(".chat-history-row"))resetChatMenus()});
document.addEventListener("click",e=>{if(!e.target.closest(".media-actions"))document.querySelectorAll(".media-action-menu.open").forEach(x=>x.classList.remove("open"))});

