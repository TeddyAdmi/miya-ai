import { Client, handle_file } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
const modes={
 chat:{title:"Твоя AI-комната",eyebrow:"AI CHAT",subtitle:"Общайся с Miya, придумывай идеи и управляй созданием контента.",placeholder:"Напиши сообщение...",send:"Отправить",status:"AI Chat готов"},
 images:{title:"Картинки",eyebrow:"КАРТИНКИ",subtitle:"Создавай изображения с нуля или загружай исходник и описывай изменения.",placeholder:"Опиши картинку или что изменить в загруженном изображении...",send:"Создать",status:"FLUX Dev · создание и редактирование"},
 video:{title:"Видео",eyebrow:"ВИДЕО",subtitle:"Создавай короткие видео по сцене, действиям и движению — со звуком.",placeholder:"Опиши сцену, действия персонажей, движение камеры и атмосферу...",send:"Создать видео",status:"Agnes Video 2.5 Flash · 720P · до 12 сек"}
};
const $=s=>document.querySelector(s);
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
  const items=Array.isArray(raw)
    ? raw.filter(x=>x&&typeof x.url==="string")
    : [];
  if(Array.isArray(raw)&&items.length!==raw.length){
   try{localStorage.setItem(LIB_KEY,JSON.stringify(items))}catch{}
  }
  return items;
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
  // Agnes output storage has no CORS header. Do not fetch it into IndexedDB;
  // the browser can display the provider URL directly in <img> and cache it normally.
  if(/platform-outputs\\.agnes-ai\\.space/i.test(value))return false;
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
 cacheMedia(id,url,type);
 return item;
}
function removeBrokenMediaItem(item,card){
 try{
  const items=getLibrary().filter(x=>x.id!==item.id);
  localStorage.setItem(LIB_KEY,JSON.stringify(items));
 }catch{}
 if(card){card.classList.add("media-load-error");card.remove();}
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
   media.controls=true;media.playsInline=true;media.preload="metadata";
   media.addEventListener("error",handleMediaFailure);
   card.appendChild(media);
   resolveMediaUrl(item).then(url=>{
     if(url&&!mediaFailed){media.src=url;media.load();}
   }).catch(()=>{
     if(!mediaFailed){media.src=String(item.url||"");media.load();}
   });
  }else{
   media=document.createElement("img");media.alt="Miya Studio";media.style.cursor="zoom-in";media.title="Открыть изображение";
   media.decoding="async";
   media.addEventListener("error",()=>{
     if(mediaFailed)return;
     mediaFailed=true;
     removeBrokenMediaItem(item,card);
   });
   media.src=String(item.url||"");media.addEventListener("click",e=>{e.stopPropagation();openImageViewer(item)});card.appendChild(media);
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
  const copyBtn=document.createElement("button");copyBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg></span><span>Копировать</span>';copyBtn.onclick=async e=>{e.stopPropagation();menu.classList.remove("open");try{const response=await fetch(item.url,{headers:{Accept:"image/*"}});if(!response.ok)throw new Error();const blob=await response.blob();if(!navigator.clipboard?.write||!window.ClipboardItem)throw new Error();await navigator.clipboard.write([new ClipboardItem({[blob.type||"image/png"]:blob})]);toast("Картинка скопирована")}catch{toast("Не удалось скопировать картинку")}};
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
 $("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;
 $("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent="Agnes Video 2.5 Flash · изображение готово";
 $(".image-settings").style.display="none";$("#videoOptions").classList.add("show");
 $("#videoModel").value="Agnes Video 2.5 Flash";$("#videoRatio").value="16:9";
 document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode==="video"));
 $("#chatMenuToggle")?.classList.remove("active");$("#chatSubmenu")?.classList.add("suppressed");
 setComposerAttachment(referenceImage);renderVideoLibrary();syncInput();$("#composerInput").focus();
}
function renderVideoLibrary(){
 const c=$("#canvas"),items=getLibrary().filter(x=>x.type==="video");
 if(!items.length){showEmpty();return}
 c.innerHTML='<div class="results-head"><div><h3>Все созданные видео</h3></div></div><div class="result-grid video-result-grid"></div>';
 const grid=c.querySelector(".result-grid");
 items.forEach(item=>{
   grid.appendChild(buildMediaCard(item,{video:true}));
   // Warm the local cache in the background. Existing videos become instant
   // previews the next time the Video tab is opened.
   cacheMedia(item.id,item.url,"video");
 });
}
function renderImageLibrary(){
 const c=$("#canvas"),items=getLibrary().filter(x=>x.type==="image");
 if(!items.length){showEmpty();return}
 c.innerHTML='<div class="results-head"><div><h3>Все созданные картинки</h3></div></div><div class="result-grid"></div>';
 const grid=c.querySelector(".result-grid");
 items.forEach((item,index)=>{
   const card=buildMediaCard(item);
   const img=card.querySelector("img");
   if(img){
     img.loading=index===0?"eager":"lazy";
     if(index===0)img.fetchPriority="high";
   }
   grid.appendChild(card);
 });
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
   mode="chat";chatMessages=[];window.__miyaChatId=null;
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
function scrollImagesToTop(){
 const workspace=$("#workspace");
 if(workspace)requestAnimationFrame(()=>{
   const first=workspace.querySelector(".result-grid .media-card,.result-grid img,.result-grid video");
   if(first){
     const wr=workspace.getBoundingClientRect();
     const fr=first.getBoundingClientRect();
     const target=Math.max(0,workspace.scrollTop+(fr.top-wr.top)-10);
     workspace.scrollTo({top:target,behavior:"smooth"});
   }else{
     workspace.scrollTo({top:0,behavior:"smooth"});
   }
 });
}
function scrollChatToLatest(behavior="smooth"){
 const workspace=$("#workspace");
 const composer=document.querySelector(".composer-wrap");
 const latest=workspace?.querySelector(".chat-stream .chat-row:last-child");
 const stream=workspace?.querySelector(".chat-stream");
 if(!workspace||!composer||!latest||!stream)return;
 requestAnimationFrame(()=>{
  requestAnimationFrame(()=>{
   const cr=composer.getBoundingClientRect();
   const height=Math.max(1,Math.ceil(window.innerHeight-cr.top));
   stream.style.setProperty("--chat-composer-height",height+"px");
   const lr=latest.getBoundingClientRect();
   const gap=12;
   const target=workspace.scrollTop+(lr.bottom-(cr.top-gap));
   const max=Math.max(0,workspace.scrollHeight-workspace.clientHeight);
   workspace.scrollTo({top:Math.max(0,Math.min(max,target)),behavior});
  });
 });
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
  card.innerHTML='<div class="generation-progress"><div class="progress-circle is-active"><span class="progress-percent">0%</span></div><div class="progress-copy"><b>Создание изображения</b><span class="progress-model"></span></div></div><div class="generation-progress-bar"><span></span></div>';
  card.querySelector(".progress-model").textContent=referenceImage?selectedModel+" · загрузка файла…":selectedModel+" · создание…";
  grid.prepend(card);scrollImagesToTop();return;
 }
 const selectedVideoModel=$("#videoModel")?.value||"LTX-2.3 Distilled";
 const items=getLibrary().filter(x=>x.type==="video");
 c.innerHTML='<div class="results-head"><div><h3>Все созданные видео</h3></div></div><div class="result-grid video-result-grid"></div>';
 const grid=c.querySelector(".result-grid");
 items.forEach(item=>grid.appendChild(buildMediaCard(item,{video:true})));
 const card=document.createElement("div");card.className="generation-loading video-generation-loading";
 card.dataset.model=selectedVideoModel;
 card.innerHTML='<div class="generation-progress"><div class="progress-circle is-active"><span class="progress-percent">0%</span></div><div class="progress-copy"><b>Создание видео</b><span class="progress-model"></span></div></div><div class="generation-progress-bar"><span></span></div>';
 card.querySelector(".progress-model").textContent=selectedVideoModel+" · подготовка…";
 grid.appendChild(card);scrollImagesToTop();
}
function showImage(url,prompt="",model="FLUX Dev"){
 const item=saveMedia("image",url,prompt,model);
 const c=$("#canvas");let grid=c.querySelector(".result-grid");
 if(!grid){c.innerHTML='<div class="result-grid"></div>';grid=c.querySelector(".result-grid")}
 const card=buildMediaCard(item);grid.prepend(card);
 $("#composerStatus").textContent=model+" · готово";
}
async function generateAgnesImage(prompt){
 if(videoGenerationBusy){}
 showLoading();$("#composerSend").disabled=true;
 const model="Agnes Image 2.5 Flash · 4K";
 const loader=$("#canvas .generation-loading");
 const ring=loader?.querySelector(".progress-circle");
 const percent=ring?.querySelector(".progress-percent");
 const composerProgress=$("#composerProgress");
 const setProgress=p=>{
   const v=Math.max(0,Math.min(99,Math.round(p)));
   if(ring){ring.classList.remove("is-active");ring.style.setProperty("--progress",v+"%");}
   const bar=loader?.querySelector(".generation-progress-bar span");if(bar)bar.style.width=v+"%";
   if(percent)percent.textContent=v+"%";
   if(composerProgress)composerProgress.textContent=v+"%";
 };
 try{
   setProgress(8);$("#composerStatus").textContent=model+" · подключение…";
   const ratio=["1:1","3:4","4:3","16:9","9:16","2:3","3:2","21:9"].includes(String($("#composerRatio")?.value))?String($("#composerRatio").value):"16:9";
   const requestedCount=Math.max(1,Math.min(4,Number($("#composerCount")?.value||1)));
   const response=await fetch("/api/agnes-image",{
     method:"POST",
     headers:{"Content-Type":"application/json","Accept":"application/json"},
     body:JSON.stringify({prompt,ratio,n:requestedCount,imageBase64:referenceImage||""}),
     signal:AbortSignal.timeout(60000)
   });
   const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{}
   if(!response.ok||!data.imageUrl)throw new Error(String(data.message||data.error||raw||"Agnes Image не вернул изображение").slice(0,500));
   setProgress(100);
   const urls=Array.isArray(data.imageUrls)&&data.imageUrls.length?data.imageUrls:[data.imageUrl];
   urls.forEach(url=>showImage(url,prompt,model));
   scrollImagesToTop();
   $("#composerInput").value="";syncInput();
   $("#composerModel").value="Agnes Image 2.5 Flash";
   $("#composerRatio").value=ratio;
   $("#composerStatus").textContent=model+" · готово";
   referenceImage=null;
   chatAttachmentFile=null;
   try{sessionStorage.removeItem("miyaReferenceImage")}catch{}
   setComposerAttachment("");
   if(composerProgress)composerProgress.textContent="100%";
   setTimeout(()=>$("#canvas .generation-loading")?.remove(),350);
   toast("Agnes Image: изображение создано");
 }catch(e){
   $("#canvas .generation-loading")?.remove();
   if(composerProgress)composerProgress.textContent="";
   $("#composerStatus").textContent=model+" · ошибка";
   toast("Agnes Image: "+(e?.message||"не удалось создать изображение"));
 }finally{
   $("#composerSend").disabled=false;
 }
}

async function generateImage(prompt){
 const selectedModel=String($("#composerModel")?.value||"").trim();
 const useAgnesImage=/^Agnes Image/i.test(selectedModel);
 if(useAgnesImage){
  return generateAgnesImage(prompt);
 }
 showLoading();$("#composerSend").disabled=true;
 const loader=$("#canvas .generation-loading");
 const ring=loader?.querySelector(".progress-circle");
 const percent=ring?.querySelector(".progress-percent");
 const modelName=referenceImage && selectedModel==="FLUX Kontext Dev"
   ? "FLUX Kontext Dev"
   : (selectedModel||"FLUX Dev");
 const hasFileUpload=modelName==="FLUX Kontext Dev" && Boolean(referenceImage);
 const composerProgress=$("#composerProgress");
 let fakeProgress=0;
 let fakeTimer=null;
 const setProgress=(p)=>{
  const value=Math.max(0,Math.min(99,Math.round(p)));
  if(ring){ring.classList.remove("is-active");ring.style.setProperty("--progress",value+"%");}
  const bar=loader?.querySelector(".generation-progress-bar span");if(bar)bar.style.width=value+"%";
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
   if($("#composerStatus"))$("#composerStatus").textContent=modelName+" · создание…";
  },900);
 };
 startFakeProgress();
 $("#composerStatus").textContent=hasFileUpload?modelName+" · загрузка файла…":modelName+" · создание…";
 try{
  const payload={
   prompt,
   // Kontext is more reliable with PixelSter's native "auto" sizing when
   // an image comes from history/library; keep explicit ratio for fresh T2I.
   ratio:referenceImage?"auto":$("#composerRatio").value
  };
  if(referenceImage){
   if(referenceImage.startsWith("data:image/"))payload.imageBase64=referenceImage;
   else payload.imageUrl=referenceImage;
  }
  const requestedCount=Number($("#composerCount")?.value||1);
  const body=useAgnesImage
   ? JSON.stringify({prompt,ratio:$("#composerRatio").value,n:requestedCount,imageBase64:referenceImage||""})
   : JSON.stringify({
      mode:"image",provider:"ahm7",prompt,model:modelName,
      ratio:$("#composerRatio").value,outputFormat:"png",copies:requestedCount,
      options:referenceImage?payload:{}
     });
  let data;
  const requestThroughMiyaApi=async()=>new Promise((resolve,reject)=>{
   const xhr=new XMLHttpRequest();
   xhr.open("POST",useAgnesImage?"/api/agnes-image":"/api/image",true);
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
    if(modelLabel)modelLabel.textContent=modelName+" · файл загружен · создание…";
    if($("#composerStatus"))$("#composerStatus").textContent=modelName+" · файл загружен · создание…";
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
      let detail=result.message||result.error||("Создание не выполнена (HTTP "+xhr.status+")");
      if(result.upstreamBody){
       const rawUpstream=String(result.upstreamBody).replace(/\\s+/g," ").trim();
       if(rawUpstream) detail += " · "+rawUpstream.slice(0,220);
      }
      reject(new Error(detail));
    }
   };
   xhr.timeout=60000;
   xhr.send(body);
  });
;
  // Image creation/editing is routed through the original AHM7/PixelSter API.
  // Do not call public Hugging Face FLUX Spaces here: they were only a fallback
  // experiment and bypass the provider that this app originally used.
  data=await requestThroughMiyaApi();
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
  scrollImagesToTop();
  $("#composerInput").value="";syncInput();
  $("#composerModel").value=referenceImage?"FLUX Kontext Dev":modelName;
  $("#composerRatio").value=referenceImage?"auto":$("#composerRatio").value;
  $("#composerStatus").textContent=actualModel+" · готово";
  if(composerProgress)composerProgress.textContent="100%";
  requestAnimationFrame(()=>$("#workspace")?.scrollTo({top:0,behavior:"smooth"}));
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
   actions.innerHTML='<button title="Копировать"><span class="action-mini-icon">⧉</span>Копировать</button><button title="В промпт"><span class="action-mini-icon">✦</span>В промпт</button><button title="Сохранить ответ"><span class="action-mini-icon">♡</span>Сохранить</button><button title="Поделиться"><span class="action-mini-icon">↗</span>Поделиться</button>';
   actions.querySelector('[title="Копировать"]').onclick=()=>navigator.clipboard?.writeText(text).then(()=>toast("Скопировано")).catch(()=>toast("Не удалось скопировать"));
   actions.querySelector('[title="В промпт"]').onclick=()=>{$("#composerInput").value=text;syncInput();$("#composerInput").focus();toast("Ответ добавлен в промпт")};
   actions.querySelector('[title="Сохранить ответ"]').onclick=()=>{try{const saved=JSON.parse(localStorage.getItem("miyaSavedAnswers")||"[]");saved.unshift({id:"answer-"+Date.now(),text,createdAt:Date.now()});localStorage.setItem("miyaSavedAnswers",JSON.stringify(saved.slice(0,50)));toast("Ответ сохранён")}catch{toast("Не удалось сохранить ответ")}};
   actions.querySelector('[title="Поделиться"]').onclick=async()=>{try{if(navigator.share)await navigator.share({title:"Miya AI Studio",text});else{await navigator.clipboard?.writeText(text);toast("Текст скопирован для отправки")}}catch{}};
   content.appendChild(actions);
   const selectionBar=document.createElement("div");
   selectionBar.className="chat-selection-actions";
   selectionBar.hidden=true;
   selectionBar.innerHTML='<button type="button" data-selection-action="image">Создать картинку</button><button type="button" data-selection-action="video">Создать видео</button><button type="button" data-selection-action="copy">Копировать</button>';
   selectionBar.querySelector('[data-selection-action="image"]').onclick=()=>{
     const t=selectionBar.dataset.selectionText||"";
     if(t){setMode("images");$("#composerInput").value=t;syncInput();$("#composerInput").focus()}
     selectionBar.hidden=true;
   };
   selectionBar.querySelector('[data-selection-action="video"]').onclick=()=>{
     const t=selectionBar.dataset.selectionText||"";
     if(t){setMode("video");$("#composerInput").value=t;syncInput();$("#composerInput").focus()}
     selectionBar.hidden=true;
   };
   selectionBar.querySelector('[data-selection-action="copy"]').onclick=()=>{
     const t=selectionBar.dataset.selectionText||"";
     if(t)navigator.clipboard?.writeText(t).then(()=>toast("Выделенный промт скопирован")).catch(()=>toast("Не удалось скопировать"));
     selectionBar.hidden=true;
   };
   bubble.addEventListener("mouseup",()=>{
     const sel=window.getSelection?.();
     const selected=String(sel?.toString()||"").trim();
     if(!selected||!sel?.rangeCount||!bubble.contains(sel.anchorNode)||!bubble.contains(sel.focusNode))return;
     selectionBar.dataset.selectionText=selected;
     selectionBar.hidden=false;
   });
 }
 row.append(av,content);
 stream.appendChild(row);
 scrollChatToLatest("smooth");
}
async function requestChat(){
 const status=$("#composerStatus");
 status.textContent="Miya думает…";
 $("#composerSend").disabled=true;
 try{
   const response=await fetch("/api/chat",{
     method:"POST",
     headers:{"Content-Type":"application/json","Accept":"application/json"},
     body:JSON.stringify({
       messages:chatMessages,
       imageBase64:referenceImage||""
     }),
     signal:AbortSignal.timeout(90000)
   });
   const data=await response.json().catch(()=>({}));
   const serverMessage=typeof data?.message==="string"
     ? data.message
     : typeof data?.error==="string"
       ? data.error
       : "Не удалось получить ответ Miya";
   if(!response.ok||!data.text)throw new Error(serverMessage);
   const answer=String(data.text).trim();
   if(!answer)throw new Error("Miya не вернула текст ответа");
   chatMessages.push({role:"assistant",content:answer});
   addChatMessage(answer,false);
   saveCurrentChat();
   status.textContent=data.model==="VisionSter"?"Miya · VisionChat":"Miya · Free Text";
 }catch(e){
   toast(e?.message||"Не удалось получить ответ Miya");
   status.textContent="AI Chat · ошибка · можно повторить";
 }finally{
   $("#composerSend").disabled=false;
 }
}
function removeGenerationLoading(){
 const loader=$("#canvas .generation-loading");
 if(loader)loader.remove();
}
function updateVideoProgress(model,value,label=""){
 const v=Math.max(0,Math.min(100,Math.round(value)));
 const loader=$("#canvas .video-generation-loading");
 const ring=loader?.querySelector(".progress-circle");
 const percent=loader?.querySelector(".progress-percent");
 const copy=loader?.querySelector(".progress-model");
 const bar=loader?.querySelector(".generation-progress-bar span");
 if(ring)ring.style.setProperty("--progress",v+"%");
 if(percent)percent.textContent=v+"%";
 if(bar)bar.style.width=v+"%";
 if(copy)copy.textContent=model+(label?" · "+label:"");
 const status=$("#composerStatus"),progress=$("#composerProgress");
 if(status)status.textContent=model+(label?" · "+label:"");
 if(progress)progress.textContent=v+"%";
}
function startVideoProgress(model){
 let value=1;
 updateVideoProgress(model,1,"запуск видеодвижка…");
 const timer=setInterval(()=>{
   const loader=$("#canvas .video-generation-loading");
   if(!loader||!document.body.contains(loader)){clearInterval(timer);return}
   const remaining=99-value;
   const step=remaining>60?Math.random()*3.6+1.2:remaining>25?Math.random()*2.2+.7:Math.random()*.7+.2;
   value=Math.min(99,value+step);
   updateVideoProgress(model,value,"создание…");
 },850);
 return (finalValue=null,label="")=>{
   clearInterval(timer);
   if(finalValue!==null)updateVideoProgress(model,finalValue,label);
 };
}

function valueFromProgress(position,size){
 const p=Number(position),n=Number(size);
 if(Number.isFinite(p)&&Number.isFinite(n)&&n>0)return Math.max(1,Math.min(99,Math.round((p/n)*98)+1));
 return 1;
}

let pixelAudioFfmpeg=null;
let pixelAudioFfmpegPromise=null;

function audioBufferToWavBlob(buffer){
  const channels=buffer.numberOfChannels, sampleRate=buffer.sampleRate, frames=buffer.length;
  const bytesPerSample=2, blockAlign=channels*bytesPerSample;
  const dataSize=frames*blockAlign, arrayBuffer=new ArrayBuffer(44+dataSize);
  const view=new DataView(arrayBuffer);
  const writeString=(offset,str)=>{for(let i=0;i<str.length;i++)view.setUint8(offset+i,str.charCodeAt(i))};
  writeString(0,"RIFF");view.setUint32(4,36+dataSize,true);writeString(8,"WAVE");
  writeString(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);
  view.setUint16(22,channels,true);view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*blockAlign,true);view.setUint16(32,blockAlign,true);
  view.setUint16(34,16,true);writeString(36,"data");view.setUint32(40,dataSize,true);
  let offset=44;
  for(let i=0;i<frames;i++){
    for(let ch=0;ch<channels;ch++){
      const sample=Math.max(-1,Math.min(1,buffer.getChannelData(ch)[i]));
      view.setInt16(offset,sample<0?sample*0x8000:sample*0x7fff,true);offset+=2;
    }
  }
  return new Blob([arrayBuffer],{type:"audio/wav"});
}

async function makePixelMotionAudio(duration,prompt){
  const seconds=Math.max(1,Math.min(20,Number(duration)||5));
  const sampleRate=24000;
  const ctx=new OfflineAudioContext(1,Math.ceil(seconds*sampleRate),sampleRate);
  const master=ctx.createGain();master.gain.value=.55;master.connect(ctx.destination);
  const text=String(prompt||"").toLowerCase();
  const isRoar=/\b(лев|льв|lion|рычит|рык|рычит|roar|growl|гроул)\b/i.test(text);
  const isRun=/\b(убег|беж|бег|runs?|running|run away)\b/i.test(text);

  // A synthetic animal roar: layered low oscillation + filtered noise with
  // a short attack and decay. It is deliberately an effect track, not speech.
  if(isRoar){
    const t=Math.min(.75,seconds*.22);
    const osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
    osc.type="sawtooth";osc.frequency.setValueAtTime(92,t);osc.frequency.exponentialRampToValueAtTime(48,t+.72);
    filter.type="lowpass";filter.frequency.value=1250;filter.Q.value=1.1;
    gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.9,t+.08);gain.gain.exponentialRampToValueAtTime(.001,Math.min(seconds,t+1.15));
    osc.connect(filter);filter.connect(gain);gain.connect(master);osc.start(t);osc.stop(Math.min(seconds,t+1.3));
    const noiseBuffer=ctx.createBuffer(1,Math.ceil(sampleRate*1.2),sampleRate),nd=noiseBuffer.getChannelData(0);
    for(let i=0;i<nd.length;i++)nd[i]=(Math.random()*2-1)*Math.pow(1-i/nd.length,.35);
    const noise=ctx.createBufferSource(),ng=ctx.createGain(),nf=ctx.createBiquadFilter();
    nf.type="bandpass";nf.frequency.value=520;nf.Q.value=.7;
    ng.gain.setValueAtTime(0,t);ng.gain.linearRampToValueAtTime(.42,t+.06);ng.gain.exponentialRampToValueAtTime(.001,Math.min(seconds,t+1.05));
    noise.buffer=noiseBuffer;noise.connect(nf);nf.connect(ng);ng.connect(master);noise.start(t);noise.stop(Math.min(seconds,t+1.2));
  }
  if(isRun){
    for(let t=.9;t<seconds;t+=.42){
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.type="sine";o.frequency.value=72;g.gain.setValueAtTime(.16,t);g.gain.exponentialRampToValueAtTime(.001,t+.12);
      o.connect(g);g.connect(master);o.start(t);o.stop(t+.13);
    }
  }
  const rendered=await ctx.startRendering();
  return audioBufferToWavBlob(rendered);
}

async function muxPixelSterAudio(videoUrl,onProgress=()=>{}){
  // Keep PixelSter's native MP4 as the playable result. Browser-side FFmpeg
  // required an external jsDelivr worker that Firefox blocks by origin policy.
  onProgress(94,"видео готово…");
  return String(videoUrl||"");
}

async function compactPixelSterSource(dataUrl){
 try{
  const source=String(dataUrl||"");
  if(!source.startsWith("data:image/"))return source;
  const img=new Image();
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=source});
  const max=1024,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=c.getContext("2d",{alpha:false});ctx.drawImage(img,0,0,c.width,c.height);
  return c.toDataURL("image/jpeg",.68);
 }catch{return dataUrl}
}
async function generateWanVideo(prompt){
 const source=referenceImage||"";
 if(!source){toast("Wan 2.2 требует исходное изображение");return;}
 if(videoGenerationBusy){toast("Видео уже создаётся. Дождитесь завершения текущего запроса.");return;}
 videoGenerationBusy=true;showLoading();$("#composerSend").disabled=true;
 const model="Wan 2.2 Fast";
 const stopProgress=startVideoProgress(model);
 try{
  const duration=Math.max(.5,Math.min(5,Number(String($("#videoDuration")?.value||"3 сек").match(/\\d+(?:\\.\\d+)?/)?.[0]||3)));
  updateVideoProgress(model,1,"подготовка изображения…");
  const sourceData=await compactPixelSterSource(source);
  const response=await fetch("/api/minimax",{
    method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({provider:"wan",prompt,imageBase64:sourceData,duration}),
    signal:AbortSignal.timeout(300000)
  });
  const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{}
  if(!response.ok||!data?.videoUrl)throw new Error(String(data?.message||data?.error||raw||"Wan 2.2 не вернул видео").slice(0,700));
  updateVideoProgress(model,99,"видео получено…");
  const item=saveMedia("video",data.videoUrl,prompt,model);
  stopProgress();removeGenerationLoading();renderVideoLibrary();if(item)scrollImagesToTop();
  toast("Wan 2.2: видео создано");
 }catch(e){
  stopProgress();removeGenerationLoading();$("#composerProgress").textContent="";
  const msg=String(e?.message||"");
  const isQuota=/ZeroGPU quota|exceeded your.*quota|quota/i.test(msg);
  $("#composerStatus").textContent=isQuota?model+" · квота Hugging Face исчерпана":model+" · ошибка";
  toast(isQuota?"Wan 2.2: бесплатная квота ZeroGPU исчерпана.":model+": "+(msg||"не удалось создать видео"));
 }finally{videoGenerationBusy=false;$("#composerSend").disabled=false}
}
async function generateMotionVideo(prompt){
 const source=referenceImage||"";
 if(!source){
   toast("PixelSter Motion Synthesis требует исходное изображение");
   $("#composerStatus").textContent="PixelSter · нужно исходное изображение";
   $("#composerProgress").textContent="";
   return;
 }
 if(videoGenerationBusy){
   toast("Видео уже генерируется. Дождитесь завершения текущего запроса.");
   return;
 }
 videoGenerationBusy=true;
 showLoading();
 $("#composerSend").disabled=true;
 const model="PixelSter Motion Synthesis";
 const stopProgress=startVideoProgress(model);
 $("#composerStatus").textContent=model+" · создание…";
 try{
   const durationText=String($("#videoDuration")?.value||"10 сек");
   const duration=Math.max(5,Math.min(20,Number(durationText.match(/\d+/)?.[0]||10)));
   const ratioValue=String($("#videoRatio")?.value||"auto");
   const ratio=["auto","9:16","16:9"].includes(ratioValue)?ratioValue:"auto";
   const motionPrompt=[
     "Create one continuous high-quality cinematic image-to-video shot from the supplied image.",
     "Preserve the original subject identity, face, anatomy, clothing, composition, environment and visual style.",
     "Keep the subject itself stable and natural. Do not invent new actions, objects, characters or scene changes.",
     "CAMERA MOVEMENT: DIVE & RISE.",
     "Start with a controlled cinematic descent toward the subject, as if the camera is smoothly diving downward and moving closer.",
     "Continue the forward/downward movement through the scene with natural parallax and realistic depth, passing close to the subject without colliding with it or changing its identity.",
     "Then smoothly pull upward and rise above the subject, revealing more of the surrounding environment from a higher angle.",
     "The camera path must be one continuous fluid arc: descend and approach, pass close, then rise. No sudden cuts, spins, shakes, teleporting or abrupt direction changes.",
     "Use realistic motion blur, stable anatomy, coherent physics, temporal consistency, natural depth and physically plausible lighting. Keep cinematic effects subtle and subordinate to the camera movement.",
     "Do not add humans, animals, props, weather or unrelated events that the user did not request.",
     "USER MOTION REQUEST:",
     prompt
   ].join("\n");
   updateVideoProgress(model,1,"отправляю запрос…");
   // Route PixelSter through Miya's server so Firefox never sees the upstream
   // ahm7xmakki.com CORS failure. The server has the full 120s function window.
   const pixelSource=await compactPixelSterSource(source);
   const response=await fetch("/api/minimax",{
     method:"POST",
     headers:{"Content-Type":"application/json","Accept":"application/json"},
     body:JSON.stringify({
       mode:"video",
       provider:"pixelster",
       prompt:motionPrompt,
       ratio,
       duration,
       options:{imageBase64:pixelSource}
     }),
     signal:AbortSignal.timeout(125000)
   });
   const raw=await response.text();
   let data={};
   try{data=raw?JSON.parse(raw):{}}catch{}
   if(!response.ok||data?.ok===false||!data?.videoUrl){
     const detail=String(data?.message||data?.error||raw||"PixelSter не вернул видео").slice(0,500);
     throw new Error("PixelSter: "+detail);
   }
   const sourceVideoUrl=String(data.videoUrl);
   updateVideoProgress(model,99,"видео получено…");
   // PixelSter result is kept silent: do not add or synthesize any audio track.
   const finalVideoUrl=sourceVideoUrl;
   stopProgress();
   updateVideoProgress(model,100,"видео готово");
   const item=saveMedia("video",finalVideoUrl,prompt,model);
   removeGenerationLoading();
   renderVideoLibrary();
   if(item)scrollImagesToTop();
   toast("PixelSter: видео создано");
 }catch(e){
   stopProgress();removeGenerationLoading();
   $("#composerProgress").textContent="";
   const rawMessage=String(e?.message||"");
   const is504=/PixelSter HTTP 504|Gateway Time-out|Gateway Timeout|NetworkError/i.test(rawMessage);
   const isQuota=/exceeded your ZeroGPU quota|ZeroGPU quota|quota/i.test(rawMessage);
   $("#composerStatus").textContent=is504
     ? model+" · сервер не завершил запрос"
     : isQuota
       ? model+" · квота Hugging Face исчерпана"
       : model+" · ошибка";
   toast(is504
     ? "PixelSter: сервер вернул 504. Это ошибка самого PixelSter, а не браузера."
     : isQuota
       ? "LTX-2.3: дневная ZeroGPU-квота Hugging Face исчерпана. Повторные запросы сейчас не помогут."
       : (rawMessage||"Не удалось создать видео"));
 }finally{
   videoGenerationBusy=false;
   $("#composerSend").disabled=false
 }
}

function getLtxQuotaCooldown(){
 try{
  const until=Number(sessionStorage.getItem("miyaLtxQuotaUntil")||0);
  if(until>Date.now())return until;
  sessionStorage.removeItem("miyaLtxQuotaUntil");
 }catch{}
 return 0;
}
function parseLtxQuotaCooldown(message){
 const match=String(message||"").match(/Try again in\\s+(\\d+):(\\d+)(?::(\\d+))?/i);
 if(!match)return 0;
 const h=Number(match[1]||0),m=Number(match[2]||0),s=Number(match[3]||0);
 return ((h*60+m)*60+s)*1000;
}
function setLtxQuotaCooldown(message){
 const duration=parseLtxQuotaCooldown(message);
 if(!duration)return 0;
 const until=Date.now()+duration;
 try{sessionStorage.setItem("miyaLtxQuotaUntil",String(until))}catch{}
 const select=$("#videoModel");
 if(select){
  const options=[...select.options];
  options.filter(o=>String(o.value||o.textContent).includes("LTX-2.3")||String(o.value||o.textContent).includes("Wan 2.2")).forEach(o=>o.disabled=true);
  if(String(select.value||"").includes("LTX-2.3")||String(select.value||"").includes("Wan 2.2")){
   const fallback=options.find(o=>!o.disabled&&String(o.value||o.textContent)==="PixelSter Motion Synthesis");
   if(fallback)select.value=fallback.value;
  }
 }
 return until;
}
function refreshLtxQuotaState(){
 const until=getLtxQuotaCooldown();
 const select=$("#videoModel");
 if(!select)return until;
 const option=[...select.options].find(o=>String(o.value||o.textContent).includes("LTX-2.3"));
 if(option)option.disabled=Boolean(until);
 const wan=[...select.options].find(o=>String(o.value||o.textContent).includes("Wan 2.2"));
 if(wan)wan.disabled=Boolean(until);
 if(until&&(String(select.value||"").includes("LTX-2.3")||String(select.value||"").includes("Wan 2.2"))){
  const fallback=[...select.options].find(o=>!o.disabled&&String(o.value||o.textContent)==="PixelSter Motion Synthesis");
  if(fallback)select.value=fallback.value;
 }
 return until;
}
function formatCooldown(until){
 const left=Math.max(0,until-Date.now());
 const total=Math.ceil(left/1000);
 const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
 return h+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
}

async function generateMiniMaxVideo(prompt){
 if(videoGenerationBusy){
   toast("Видео уже создаётся. Дождитесь завершения текущего запроса.");
   return;
 }
 videoGenerationBusy=true;
 showLoading();
 $("#composerSend").disabled=true;
 const model="MiniMax H3";
 const stopProgress=startVideoProgress(model);
 try{
   const durationText=String($("#videoDuration")?.value||"5 сек");
   const duration=Math.max(5,Math.min(14,Number(durationText.match(/\d+/)?.[0]||5)));
   const ratioValue=String($("#videoRatio")?.value||"16:9");
   const canvas=ratioValue==="9:16"?"544x960 · 9:16 fast"
     :ratioValue==="1:1"?"544x544 · 1:1 fast"
     :"960x544 · 16:9 fast";
   updateVideoProgress(model,1,"подключение к MiniMax H3…");
   const response=await fetch("/api/minimax",{
     method:"POST",
     headers:{"Content-Type":"application/json","Accept":"application/json"},
     body:JSON.stringify({
       mode:"minimax-h3",
       prompt,
       imageBase64:referenceImage||"",
       duration,
       canvas,
       steps:28
     }),
     signal:AbortSignal.timeout(120000)
   });
   const raw=await response.text();
   let data={};
   try{data=raw?JSON.parse(raw):{}}catch{}
   if(!response.ok||!data?.videoUrl){
     throw new Error(String(data?.message||data?.error||raw||"MiniMax H3 не вернул видео").slice(0,500));
   }
   updateVideoProgress(model,99,"видео получено…");
   const item=saveMedia("video",data.videoUrl,prompt,model+" · Video + Audio");
   stopProgress();
   updateVideoProgress(model,100,"видео готово");
   removeGenerationLoading();
   renderVideoLibrary();
   if(item)scrollImagesToTop();
   toast("MiniMax H3: видео создано");
 }catch(e){
   stopProgress();
   removeGenerationLoading();
   $("#composerProgress").textContent="";
   const msg=String(e?.message||"");
   $("#composerStatus").textContent=model+" · ошибка";
   toast("MiniMax H3: "+(msg||"не удалось создать видео"));
 }finally{
   videoGenerationBusy=false;
   $("#composerSend").disabled=false;
 }
}

async function generateAgnesVideo(prompt, retryAttempt=0){
 if(videoGenerationBusy){toast("Видео уже создаётся. Дождитесь завершения текущего запроса.");return;}
 videoGenerationBusy=true;showLoading();$("#composerSend").disabled=true;
 const model=String($("#videoModel")?.value||"Agnes Video 2.5");
 const isFlash=model==="Agnes Video 2.5 Flash";
 const apiModel=isFlash?"agnes-video-2.5-flash":model==="Agnes Video v2.0"?"agnes-video-v2.0":"agnes-video-2.5";
 const stopProgress=startVideoProgress(model);
 try{
   const duration=Math.max(4,Math.min(12,Number(String($("#videoDuration")?.value||"12 сек").match(/\d+/)?.[0]||12)));
   const ratio=["16:9","9:16","1:1","4:3","3:4","21:9"].includes(String($("#videoRatio")?.value))?String($("#videoRatio").value):"16:9";
   const source=referenceImage||"";
   const size=apiModel==="agnes-video-2.5-flash"?"720P":"2K";
   updateVideoProgress(model,5,retryAttempt?"повтор после лимита Agnes…":"подключение к Agnes…");
   const create=await fetch("/api/agnes-video",{
     method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
     body:JSON.stringify({model:apiModel,prompt,seconds:duration,size,aspect_ratio:ratio,first_frame:source||undefined}),
     signal:AbortSignal.timeout(60000)
   });
   const createRaw=await create.text();let created={};try{created=createRaw?JSON.parse(createRaw):{}}catch{}

   if(create.status===429||created.error==="AGNES_VIDEO_RATE_LIMITED"){
     const retryAfter=Math.max(
       1,
       Math.min(
         300,
         Number(created.retryAfterSeconds)||
         Number(create.headers.get("Retry-After"))||
         65
       )
     );
     stopProgress();removeGenerationLoading();
     $("#composerProgress").textContent="";
     videoGenerationBusy=false;
     $("#composerSend").disabled=false;
     $("#composerStatus").textContent="Agnes Video · лимит бесплатного доступа · можно повторить через "+retryAfter+" сек.";
     toast("Agnes Video сейчас ограничен бесплатным лимитом. Кнопка снова доступна. Подожди "+retryAfter+" сек. и отправь запрос ещё раз.");
     return;
   }

   if(!create.ok||!created.videoId){
     const message=String(created.message||created.error||createRaw||"Agnes не создал задачу").slice(0,500);
     throw new Error(message);
   }
   const videoId=created.videoId;
   const activeModel=String(created.model||apiModel);
   const fallbackNotice=created.fallbackFrom
     ?" · очередь Flash переполнена → v2.0"
     :"";
   if(created.fallbackFrom){
     $("#composerStatus").textContent="Agnes Video v2.0 · резервный запуск…";
     updateVideoProgress("Agnes Video v2.0",8,"Flash занят, запускаю резервную очередь…");
   }
   let final=null;
   const started=Date.now();
   while(Date.now()-started<15*60*1000){
     await new Promise(r=>setTimeout(r,10000));
     const statusResponse=await fetch("/api/agnes-video-status?video_id="+encodeURIComponent(videoId)+"&model="+encodeURIComponent(activeModel),{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(30000)});
     const raw=await statusResponse.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{}
     if(statusResponse.status===429){
       const retryAfter=Math.max(10,Math.min(90,Number(data.retryAfterSeconds)||Number(statusResponse.headers.get("Retry-After"))||65));
       updateVideoProgress(activeModel==="agnes-video-v2.0"?"Agnes Video v2.0":model,Math.max(5,Number(data.progress)||5),"Agnes ограничил проверку — жду "+retryAfter+" сек…");
       await new Promise(r=>setTimeout(r,retryAfter*1000));
       continue;
     }
     if(!statusResponse.ok)throw new Error(String(data.message||data.error||raw||"Agnes status error").slice(0,500));
     const progress=Number(data.progress);
     if(Number.isFinite(progress))updateVideoProgress(activeModel==="agnes-video-v2.0"?"Agnes Video v2.0":model,Math.max(5,Math.min(98,progress)),"создание…");
     if(data.status==="completed"){final=data;break}
     if(data.status==="failed"||data.error)throw new Error(String(data.error?.message||data.error||"Agnes генерация завершилась ошибкой"));
   }
   if(!final?.url)throw new Error("Agnes не успел вернуть готовое видео за 15 минут");
   updateVideoProgress(activeModel==="agnes-video-v2.0"?"Agnes Video v2.0":model,99,"видео получено…");
   const shownModel=activeModel==="agnes-video-v2.0"?"Agnes Video v2.0":model;
   const actualSeconds=String(final.seconds||duration)+" сек";
   const actualSize=String(final.size||size);
   const item=saveMedia("video",final.url,prompt,shownModel+" · "+actualSize+" · "+actualSeconds);
   stopProgress();removeGenerationLoading();renderVideoLibrary();if(item)scrollImagesToTop();
   $("#composerStatus").textContent=shownModel+" · готово"+fallbackNotice;
   toast(created.fallbackFrom
     ?"Agnes: Flash занят, видео создано через v2.0"
     :"Agnes: видео создано");
 }catch(e){
   stopProgress();removeGenerationLoading();$("#composerProgress").textContent="";
   $("#composerStatus").textContent=model+" · ошибка";
   toast("Agnes: "+(e?.message||"не удалось создать видео"));
 }finally{
   videoGenerationBusy=false;$("#composerSend").disabled=false;
 }
}
async function generateVideo(prompt){
 refreshLtxQuotaState();
 const selectedModel=String($("#videoModel")?.value||"LTX-2.3 Distilled");
 if(selectedModel==="LTX-2.3 Distilled"){
  const quotaUntil=getLtxQuotaCooldown();
  if(quotaUntil){
   $("#composerStatus").textContent="LTX-2.3 временно недоступен · квота ZeroGPU";
   toast("LTX-2.3 временно недоступен. Повторный запрос не отправлен. Осталось "+formatCooldown(quotaUntil));
   return;
  }
 }
 if(selectedModel==="Agnes Video 2.5"||selectedModel==="Agnes Video 2.5 Flash"||selectedModel==="Agnes Video v2.0") return generateAgnesVideo(prompt);
 if(selectedModel==="Wan 2.2 Fast") return generateWanVideo(prompt);
 if(selectedModel==="PixelSter Motion Synthesis") return generateMotionVideo(prompt);
 if(selectedModel==="MiniMax H3") return generateMiniMaxVideo(prompt);
 if(videoGenerationBusy){
   toast("Видео уже создаётся. Дождитесь завершения текущего запроса.");
   return;
 }
 videoGenerationBusy=true;
 const source=referenceImage||"";
 showLoading();$("#composerSend").disabled=true;
 const stopProgress=startVideoProgress("LTX-2.3 Distilled");
 try{
   const durationText=String($("#videoDuration")?.value||"5 сек");
   const duration=Math.max(1,Math.min(10,Number(durationText.match(/\\d+/)?.[0]||5)));
   const ratio=String($("#videoRatio")?.value||"16:9");
   const ratioValue=["auto","9:16","16:9","1:1"].includes(ratio)?ratio:"16:9";
   const effectiveRatio=ratioValue==="auto"?(source?"16:9":"16:9"):ratioValue;
   const actionPrompt=[
     "LTX-2.3 HIGH-FIDELITY IMAGE-TO-VIDEO DIRECTIVE.",
     "Treat the USER SHOT DESCRIPTION as a locked storyboard, not as inspiration. Follow it literally, in the exact order written, from the first frame to the last.",
     "Do not omit, merge, reorder, replace or reinterpret any named action. Each action must visibly cause the next action. Prefer explicit physical motion over vague cinematic posing.",
     "Preserve the source image's subjects, identities, species, anatomy, proportions, faces, fur, feathers, clothing, environment, lighting and composition whenever they are not explicitly changed by the user's shot description.",
     "Maintain strict temporal consistency: no duplicated subjects, extra limbs, extra wings, fused bodies, warped faces, stretched anatomy or new appendages.",
     "The eagle must keep anatomically correct eagle anatomy and natural tail feathers only. NEVER invent an elongated mammal-like tail, a second tail, a rope-like tail, or any extra appendage on the eagle.",
     "Do not invent people, animals, props, weather, objects, attacks, camera tricks or story events that the user did not request. Do not substitute camera movement for the requested subject action.",
     "Respect the exact ending described by the user. If the prompt says a subject escapes or flies away, show that action clearly and leave the other subject behind as described.",
     "Use high-detail photorealistic motion, stable anatomy, coherent physics, natural motion blur and physically plausible lighting. Keep cinematic effects subordinate to the requested action; never add decorative effects that change the scene.",
     "Generate synchronized diegetic sound only for actions and environments actually described. No random sounds and no background music unless requested.",
     "PROMPT ADHERENCE IS MORE IMPORTANT THAN CREATIVITY.",
     "USER SHOT DESCRIPTION:",
     prompt
   ].join("\\n");
   updateVideoProgress("LTX-2.3 Distilled",1,"подключение к LTX-2.3…");
   const client=await Promise.race([
     Client.connect("Lightricks/LTX-2-3",{events:["status","data"]}),
     new Promise((_,reject)=>setTimeout(()=>reject(new Error("LTX-2.3 Space не отвечает за 20 секунд")),20000))
   ]);

   let inputImage=null;
   if(source){
     const sourceBlob=await fetch(source).then(r=>{
       if(!r.ok)throw new Error("Не удалось подготовить исходное изображение для LTX-2.3");
       return r.blob();
     });
     inputImage=handle_file(sourceBlob);
   }

   let width=1536,height=1024;
   if(effectiveRatio==="9:16"){width=1024;height=1536}
   else if(effectiveRatio==="1:1"){width=1024;height=1024}

   const seed=Math.floor(Math.random()*2147483647);
   const submission=client.submit("/generate_video",[
     inputImage,actionPrompt,duration,false,seed,true,height,width
   ]);

   let resultData=null;
   for await(const message of submission){
     if(message.type==="status"){
       if(message.stage==="error")throw new Error(message.message||"LTX-2.3 завершил задачу с ошибкой");
       if(message.stage==="pending"){
         updateVideoProgress("LTX-2.3 Distilled",valueFromProgress(message.position,message.size),"в очереди…");
       }else if(message.stage==="generating"){
         const reported=message.progress_data?.[0]?.progress;
         if(Number.isFinite(Number(reported))){
           updateVideoProgress("LTX-2.3 Distilled",Math.max(1,Math.min(99,Math.round(Number(reported)*98)+1)),"создание…");
         }
       }
     }else if(message.type==="data"){
       resultData=message.data;
     }
   }

   const findVideoUrl=(value,seen=new Set())=>{
     if(value==null)return "";
     if(typeof value==="string")return /^https?:\/\//i.test(value)?value:"";
     if(typeof value!=="object"||seen.has(value))return "";
     seen.add(value);
     for(const key of ["url","videoUrl","video_url","path","file","data","value"]){
       const found=findVideoUrl(value[key],seen);
       if(found)return found;
     }
     for(const key of Object.keys(value)){
       const found=findVideoUrl(value[key],seen);
       if(found)return found;
     }
     return "";
   };
   const videoUrl=findVideoUrl(resultData);
   if(!videoUrl)throw new Error("LTX-2.3 не вернул доступный MP4");
   updateVideoProgress("LTX-2.3 Distilled",99,"видео получено…");
   const item=saveMedia("video",videoUrl,prompt,"LTX-2.3 Distilled · Video + Audio");
   stopProgress();removeGenerationLoading();renderVideoLibrary();
   if(item)scrollImagesToTop();
   toast("LTX-2.3: видео + звук созданы");
 }catch(e){
   stopProgress();removeGenerationLoading();
   $("#composerProgress").textContent="";
   const rawMessage=String(e?.message||"");
   const isQuota=/exceeded your ZeroGPU quota|ZeroGPU quota/i.test(rawMessage);
   if(isQuota){
     const until=setLtxQuotaCooldown(rawMessage);
     $("#composerStatus").textContent="LTX-2.3 временно недоступен · квота ZeroGPU";
     toast(until
       ? "LTX-2.3 временно отключён до восстановления бесплатной квоты. Повторный запрос не отправлен."
       : "LTX-2.3 временно отключён: бесплатная ZeroGPU-квота исчерпана.");
   }else{
     $("#composerStatus").textContent="LTX-2.3 Distilled · ошибка · можно повторить";
     toast(rawMessage||"Не удалось создать видео");
   }
 }finally{
   videoGenerationBusy=false;
   $("#composerSend").disabled=false;
 }
}
function restoreReferenceImage(){
 try{
  referenceImage=referenceImage||sessionStorage.getItem("miyaReferenceImage")||"";
 }catch{}
 setComposerAttachment(referenceImage||"")
}
function setVideoRatioDefault(){
 const el=$("#videoRatio"); if(el) el.value="16:9";
 const d=$("#videoDuration"); if(d) d.value="12 сек";
 $("#composerProgress").textContent="";
}
function setMode(next,render=true){
 const changedSection=next!==mode;
 if(changedSection){referenceImage=null;try{sessionStorage.removeItem("miyaReferenceImage")}catch{};setComposerAttachment("");$("#composerInput").value="";syncInput()}
 mode=next;const m=modes[next];
 $("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;
 $("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent=m.status;
 $(".image-settings").style.display=next==="images"?"flex":"none";$("#videoOptions").classList.toggle("show",next==="video");
 if(next==="video"){
   setVideoRatioDefault();
   if($("#videoModel")&&!$("#videoModel").value)$("#videoModel").value="Agnes Video 2.5 Flash";
   const input=$("#composerInput");
   if(input){
     input.style.pointerEvents="auto";
     input.style.userSelect="text";
     input.style.cursor="text";
   }
   refreshLtxQuotaState();
 }
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
 if(canvas)canvas.classList.toggle("chat-canvas",next==="chat");
 if(canvas)canvas.innerHTML="";
 if(next==="images"){
   referenceImage=referenceImage||null;
   renderImageLibrary();
   const imageModel=$("#composerModel");
   imageModel.value=referenceImage?"FLUX Kontext Dev":"FLUX Dev";
   $("#composerRatio").value=referenceImage?"auto":"16:9";
 }else if(next==="video"){
   renderVideoLibrary();
 }else{
   showEmpty();
 }
 requestAnimationFrame(()=>$("#workspace")?.scrollTo({top:0,behavior:"auto"}));
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
$("#composerInput").addEventListener("paste",e=>{
 const i=e.currentTarget;
 const text=e.clipboardData?.getData("text/plain");
 if(text==null)return;
 /* Let Firefox perform its native paste. We only normalize the input afterward. */
 requestAnimationFrame(()=>syncInput());
});
$("#composerInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#composerSend").click()}});
$("#composerSend").addEventListener("click",async()=>{
 const value=$("#composerInput").value.trim();
 if(!value){toast(mode==="chat"?"Напиши сообщение":mode==="video"?"Опиши видео":"Опиши, что создать или изменить");return}
 if(mode==="images"){await generateImage(value);return}
 if(mode==="video"){await generateVideo(value);return}
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
  if(model==="FLUX Kontext Dev"){
    $("#composerRatio").value="auto";
    $("#composerStatus").textContent="FLUX Kontext Dev · готово к редактированию";
  }else if(model==="Agnes Image 2.5 Flash"){
    referenceImage=null;
    chatAttachmentFile=null;
    try{sessionStorage.removeItem("miyaReferenceImage")}catch{}
    setComposerAttachment("");
    $("#composerRatio").value="16:9";
    $("#composerStatus").textContent="Agnes Image 2.5 Flash · 4K · готово";
  }else{
    referenceImage=null;
    chatAttachmentFile=null;
    try{sessionStorage.removeItem("miyaReferenceImage")}catch{}
    setComposerAttachment("");
    $("#composerRatio").value="16:9";
    $("#composerStatus").textContent="FLUX Dev · готово";
  }
});
$("#improve")?.addEventListener("click",improveComposerPrompt);
$("#copyPrompt")?.addEventListener("click",copyComposerPrompt);
$("#videoImprove")?.addEventListener("click",improveComposerPrompt);
$("#videoCopyPrompt")?.addEventListener("click",copyComposerPrompt);
$("#videoModel")?.addEventListener("change",()=>{
 const model=$("#videoModel").value;
 const duration=$("#videoDuration");
 if(duration && model==="PixelSter Motion Synthesis") duration.value="10 сек";
 if(duration && model==="Wan 2.2 Fast") duration.value="3 сек";
 $("#composerProgress").textContent="";
 $("#composerStatus").textContent=model==="PixelSter Motion Synthesis"
   ? "PixelSter Motion Synthesis · 10 сек по умолчанию"
   : model==="MiniMax H3"
     ? "MiniMax H3 · Free ZeroGPU"
     : model==="Agnes Video 2.5 Flash"
       ? "Agnes Video 2.5 Flash · 720P · до 12 сек"
         : model==="Agnes Video v2.0"
           ? "Agnes Video v2.0 · legacy"
           : "LTX-2.3 Distilled · Free ZeroGPU";
 if(model==="MiniMax H3" && duration) duration.value="5 сек";
});
$("#videoTrash")?.addEventListener("click",()=>{
  $("#composerInput").value="";
  clearComposerAttachment();
  syncInput();
  $("#composerInput").focus();
  $("#composerStatus").textContent=modes.video.status;
});
$("#referenceInput").onchange=e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(mode==="chat") chatAttachmentFile=file;
 const reader=new FileReader();
 reader.onload=()=>{
  const rawData=String(reader.result||"");
  const finishAttachment=(dataUrl)=>{
    referenceImage=dataUrl;try{sessionStorage.setItem("miyaReferenceImage",referenceImage)}catch{};setComposerAttachment(referenceImage);
    if(mode==="images"){
    $("#composerModel").value="FLUX Kontext Dev";
    $("#composerRatio").value="auto";
    $("#composerStatus").textContent="FLUX Kontext Dev · готово к редактированию";
  }else if(mode==="video"){
    $("#videoModel").value="Agnes Video 2.5 Flash";
    $("#videoRatio").value="auto";
    $("#composerStatus").textContent=($("#videoModel")?.value==="PixelSter Motion Synthesis"?"PixelSter Motion Synthesis · изображение готово":"LTX-2.3 · изображение готово");
  }else{
    $("#composerStatus").textContent="Изображение прикреплено · можно спросить Miya о фото";
  }
    toast(mode==="chat"?"Изображение прикреплено к чату":"Изображение добавлено");
    $("#composerInput").focus();
  };
  if((mode==="chat"||mode==="images"||mode==="video")&&rawData.startsWith("data:image/")){
    const image=new Image();
    image.onload=()=>{
      // Keep uploads small enough for both Vercel request bodies and the free
      // PixelSter/LTX providers. Preserve the source aspect ratio.
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

