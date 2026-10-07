import { Client, handle_file } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
const modes={
 chat:{title:"Твоя AI-комната",eyebrow:"AI CHAT",subtitle:"Общайся с Miya, придумывай идеи и управляй созданием контента.",placeholder:"Напиши сообщение...",send:"Отправить",status:"AI Chat готов"},
 images:{title:"Картинки",eyebrow:"КАРТИНКИ",subtitle:"Создавай изображения с нуля или загружай исходник и описывай изменения.",placeholder:"Опиши картинку или что изменить в загруженном изображении...",send:"Создать",status:"FLUX Dev · создание и редактирование"},
 video:{title:"Видео",eyebrow:"ВИДЕО",subtitle:"Создавай короткие видео по сцене, действиям и движению — со звуком.",placeholder:"Опиши сцену, действия персонажей, движение камеры и атмосферу...",send:"Создать видео",status:"OmegaTech T2V · 16:9 · 5 сек"},
voice:{title:"Голос",eyebrow:"ГОЛОС",subtitle:"Превращай текст в естественную речь с мужскими и женскими голосами.",placeholder:"Введите текст для озвучки...",send:"Создать голос",status:"Svetlana · Female · Russia"}
};
const $=s=>document.querySelector(s);
(function ensureMiyaMediaMoreStyle(){
 if(document.getElementById("miyaMediaDotsFix"))return;
 const st=document.createElement("style");st.id="miyaMediaDotsFix";
 st.textContent=`.media-card{overflow:visible!important}
.media-action.media-more{width:32px!important;height:30px!important;min-width:32px!important;padding:0!important;border:1px solid rgba(255,255,255,.20)!important;border-radius:9px!important;background:rgba(255,255,255,.82)!important;box-shadow:0 3px 10px rgba(0,0,0,.16)!important;backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;color:#211b2b!important;display:grid!important;place-items:center!important}
.media-action.media-more:hover{background:rgba(255,255,255,.96)!important;border-color:rgba(255,255,255,.32)!important;color:#120d19!important}
.media-action.media-more::after{display:none!important}
.media-action.media-more svg{width:20px!important;height:20px!important;display:block!important;fill:currentColor!important;stroke:none!important}
.media-action.media-more svg circle{fill:currentColor!important}
body.light .media-action.media-more{background:rgba(255,255,255,.52)!important;border-color:rgba(40,30,60,.14)!important;color:#273047!important}
body.light .media-action.media-more:hover{background:rgba(0,0,0,.10)!important;border-color:rgba(40,30,60,.18)!important;color:#17121f!important}`;
 document.head.appendChild(st);
})();
function jpegImageUrl(url){
  const value=String(url||"").trim();
  if(!value||/^data:image\//i.test(value)||/^blob:/i.test(value))return value;
  if(value.startsWith("/api/image-jpeg?"))return value;
  if(/^https?:\/\/(?:www\.)?cleverutils\.com\//i.test(value)){
    return "/api/image-jpeg?url="+encodeURIComponent(value);
  }
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

async function getCachedMedia(id){
 try{
  const db=await openMediaDB();if(!db)return null;
  return await new Promise((resolve,reject)=>{const tx=db.transaction("media","readonly");const r=tx.objectStore("media").get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});
 }catch{return null}
}
function saveMedia(type,url,prompt="",model="",format=""){
 if(!url)return;
 const rawUrl=String(url||"").trim();
 if(type==="image"&&isInvalidImageToolSource(rawUrl))return;
 const id=type+"-"+Date.now()+"-"+Math.random().toString(36).slice(2);
 const normalizedUrl=type==="image"?jpegImageUrl(rawUrl):rawUrl;
 const item={id,type,url:normalizedUrl,prompt:String(prompt||""),model:String(model||((type==="image")?"FLUX Dev":"LTX")),format:String(format||""),createdAt:Date.now()};
 const items=getLibrary();items.unshift(item);
 try{localStorage.setItem(LIB_KEY,JSON.stringify(items.slice(0,500)))}catch{
   try{localStorage.setItem(LIB_KEY,JSON.stringify(items.slice(0,100)))}catch{}
 }
 cacheMedia(id,normalizedUrl,type);
 return item;
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
function openEditor(url){referenceImage=url;try{sessionStorage.setItem("miyaReferenceImage",referenceImage)}catch{};setComposerAttachment(url);mode="images";$("#composerModel").value="FLUX Kontext Dev";$("#composerRatio").value="auto";const m=modes.images;$("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;const promptInput=$("#composerInput"); if(promptInput){ promptInput.placeholder=m.placeholder; promptInput.setAttribute("aria-label",m.placeholder); promptInput.classList.remove("prompt-chat","prompt-images","prompt-video","prompt-voice"); promptInput.classList.add("prompt-images"); }$("#composerSendText").textContent=m.send;$("#composerStatus").textContent="FLUX Kontext Dev · готово к редактированию";$(".image-settings").style.display="flex";$("#voiceOptions").style.display="none";$("#voiceOptions").classList.remove("show");$("#videoOptions").style.display="none";$("#videoOptions").classList.remove("show");document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode==="images"));if(!$("#canvas .result-grid")) renderImageLibrary();$("#composerInput").focus();syncInput()}
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
 const isPng=String(item?.format||"").toLowerCase()==="png";
 const b=document.createElement("button");b.type="button";b.innerHTML='<span class="media-menu-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14"/></svg></span><span>Скачать '+(isPng?"PNG":"JPG")+'</span>';
 b.onclick=async e=>{
   e.stopPropagation();menu.remove();
   if(!isPng){downloadImage(item.url);return}
   try{
     const response=await fetch(item.url,{mode:"cors"});
     if(!response.ok)throw new Error("DOWNLOAD_HTTP_"+response.status);
     const blob=await response.blob();
     const objectUrl=URL.createObjectURL(blob);
     const a=document.createElement("a");a.href=objectUrl;a.download="miya-background-removed.png";document.body.appendChild(a);a.click();a.remove();
     setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
   }catch{toast("Не удалось сохранить PNG")}
 };
 menu.appendChild(b);
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
function formatMediaCreationDate(item){
 return item?.createdAt?new Date(item.createdAt).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric"}):"";
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
<div class="image-viewer-created-date"></div>
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
    const viewerDate=modal.querySelector(".image-viewer-created-date");if(viewerDate)viewerDate.textContent=formatMediaCreationDate(nextItem);
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
    setZoom(Number(img.dataset.zoom||"1")+(ev.deltaY<0?.5:-.5));  });
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
<div class="image-viewer-created-date"></div>
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
 const player=modal.querySelector(".image-viewer-video-player");modal.dataset.viewerItemId=item.id;const viewerDate=modal.querySelector(".image-viewer-created-date");if(viewerDate)viewerDate.textContent=formatMediaCreationDate(item);player.pause();player.src=proxyAgnesVideoUrl(item.url);player.load();
 resolveMediaUrl(item).then(u=>{if(u&&modal.classList.contains("open")&&modal.dataset.viewerItemId===item.id){player.src=u;player.load()}}).catch(()=>{});
 modal.__videoNav?.();modal.classList.add("open");document.body.classList.add("image-viewer-open");
}
async function mediaItemToReference(item){
 if(!item?.id)return "";
 try{
  const cached=await getCachedMedia(item.id);
  if(cached?.blob){
   return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(cached.blob);
   });
  }
 }catch{}
 const value=String(item?.url||"").trim();
 return isInvalidImageToolSource(value)?"":value;
}

function positionFloatingMediaOverlay(el,anchor,kind){
 if(!el||!anchor)return;
 if(kind==="menu"){
   const ar=anchor.getBoundingClientRect();
   const width=Math.min(280,Math.max(190,window.innerWidth-20));
   const top=Math.min(window.innerHeight-12,Math.max(8,ar.bottom+6));
   el.style.setProperty("position","fixed","important");
   el.style.setProperty("z-index","2147482000","important");
   el.style.setProperty("pointer-events","auto","important");
   el.style.setProperty("width",width+"px","important");
   el.style.setProperty("max-height","none","important");
   el.style.setProperty("overflow","visible","important");
   el.style.setProperty("top",Math.round(top)+"px","important");
   el.style.setProperty("right",Math.max(8,Math.round(window.innerWidth-ar.right))+"px","important");
   el.style.setProperty("left","auto","important");
   el.style.setProperty("display","block","important");
   return;
 }
 const r=anchor.getBoundingClientRect();
 el.style.setProperty("position","fixed","important");
 el.style.setProperty("z-index","100000","important");
 el.style.setProperty("pointer-events","auto","important");
 {
   const width=Math.min(250,Math.max(0,window.innerWidth-16));
   const top=Math.min(window.innerHeight-12,Math.max(8,r.top+42));
   el.style.setProperty("width",width+"px","important");
   el.style.setProperty("top",Math.round(top)+"px","important");
   el.style.setProperty("right",Math.max(8,Math.round(window.innerWidth-r.right))+"px","important");
   el.style.setProperty("left","auto","important");
 }
}
function floatMediaOverlay(el,anchor,kind){
 if(!el||!anchor)return;
 el.__mediaOverlayAnchor=anchor;
 if(kind==="menu"){
   el.__mediaOverlayParent=el.parentElement;
   el.__mediaOverlayNextSibling=el.nextSibling;
   document.body.appendChild(el);
   el.classList.add("media-overlay-floating");
   positionFloatingMediaOverlay(el,anchor,kind);
   return;
 }
 if(el.parentElement===document.body){
   el.classList.add("media-overlay-floating");
   positionFloatingMediaOverlay(el,anchor,kind);
   return;
 }
 el.__mediaOverlayParent=el.parentElement;
 el.__mediaOverlayNextSibling=el.nextSibling;
 document.body.appendChild(el);
 el.classList.add("media-overlay-floating");
 positionFloatingMediaOverlay(el,anchor,kind);
}
function restoreMediaOverlay(el){
 const parent=el?.__mediaOverlayParent;
 if(!el||!parent)return;
 if(el.__mediaOverlayNextSibling&&el.__mediaOverlayNextSibling.parentNode===parent)parent.insertBefore(el,el.__mediaOverlayNextSibling);
 else parent.appendChild(el);
 el.classList.remove("media-overlay-floating","media-overlay-attached");
 el.style.position="";el.style.zIndex="";el.style.pointerEvents="";el.style.display="";el.style.top="";el.style.right="";el.style.left="";el.style.width="";
 el.__mediaOverlayParent=null;el.__mediaOverlayNextSibling=null;el.__mediaOverlayAnchor=null;
}
function closeAllMediaMenus(){
 document.querySelectorAll(".media-action-menu.open").forEach(menu=>{menu.classList.remove("open");restoreMediaOverlay(menu)});
 document.querySelectorAll(".media-upscale-panel.open").forEach(panel=>{panel.classList.remove("open");restoreMediaOverlay(panel)});
}

function closeUpscalePanels(except){
 document.querySelectorAll(".media-upscale-panel.open").forEach(panel=>{
   if(panel!==except){panel.classList.remove("open");restoreMediaOverlay(panel);}
 });
}
function toggleUpscalePanel(item,card){
 const existing=card.querySelector(".media-upscale-panel");
 if(existing){
   if(existing.classList.contains("open")){existing.classList.remove("open");restoreMediaOverlay(existing)}
   else{closeUpscalePanels(existing);existing.classList.add("open");floatMediaOverlay(existing,card,"panel")}
   return;
 }
 closeUpscalePanels();
 const panel=document.createElement("div");
 panel.className="media-upscale-panel open";
 panel.innerHTML='<div class="media-upscale-title"><span>Инструменты изображения</span><button type="button" class="media-upscale-close" aria-label="Закрыть">×</button></div>'+
   '<div class="media-upscale-tools-grid">'+
   '<div class="media-upscale-tool">'+
   '<div class="media-upscale-tool-title">✨ Увеличить</div>'+
   '<div class="media-upscale-options">'+
   '<select class="select-pill media-upscale-select" aria-label="Масштаб"><option value="2" selected>2×</option><option value="4">4×</option></select>'+
   '</div>'+
   '</div>'+
   '<div class="media-upscale-tool media-upscale-background-tool">'+
   '<div class="media-upscale-tool-title">✂️ Удалить фон</div>'+
   '<div class="media-upscale-tool-hint">PNG с прозрачным фоном</div>'+
   '</div>'+
   '</div>'+
   '<div class="media-upscale-buttons">'+
   '<button type="button" class="media-upscale-submit">Увеличить</button>'+
   '<button type="button" class="media-upscale-background-submit">Удалить фон</button>'+
   '</div>';
 panel.querySelector(".media-upscale-close").onclick=e=>{e.stopPropagation();panel.classList.remove("open");restoreMediaOverlay(panel)};
 panel.querySelector(".media-upscale-submit").onclick=async e=>{
   e.stopPropagation();
   const submit=e.currentTarget;
   const scale=panel.querySelector(".media-upscale-select")?.value||"2";
   submit.disabled=true;submit.textContent="Обработка…";
   try{
     // Resolve the clicked library item itself. Never fall back to item.url
     // after mediaItemToReference rejects it: old library entries can contain
     // cleverutils.com/ and that is an HTML page, not an image.
     const source=await mediaItemToReference(item);
     if(!source){
       toast("У этого изображения нет доступного файла. Выбери другое изображение.");
       return;
     }
     await runImageTool(String(source).trim(),scale);
   }finally{
     submit.disabled=false;submit.textContent="Увеличить";
   }
 };
 panel.querySelector(".media-upscale-background-submit").onclick=async e=>{
   e.stopPropagation();
   const submit=e.currentTarget;
   submit.disabled=true;submit.textContent="Обработка…";
   try{     await runImageBackgroundRemoval(item);
   }finally{
     submit.disabled=false;submit.textContent="Удалить фон";
   }
 };
 panel.addEventListener("click",e=>e.stopPropagation());
 card.appendChild(panel);
 floatMediaOverlay(panel,card,"panel");
 return panel;
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
     }else if(/^https?:\/\/access\.vheer\.com\/results\//i.test(rawUrl)){
       media.alt="Старая копия изображения";
     }
   }).catch(()=>{
     const rawUrl=String(item.url||"");
     if(!/^https?:\/\/access\.vheer\.com\/results\//i.test(rawUrl)&&rawUrl&&!mediaFailed){
       media.src=rawUrl;
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
 const more=document.createElement("button");more.type="button";more.className="media-action media-more";more.removeAttribute("title");more.setAttribute("aria-label","Открыть меню");
 more.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
 const menu=document.createElement("div");menu.className="media-action-menu";
 if(!video){
  const promptBtn=document.createElement("button");promptBtn.type="button";promptBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h6M8 15h4"/></svg></span><span>Промт</span>';promptBtn.onclick=e=>{e.stopPropagation();closeAllMediaMenus();showPrompt(item)}; const upscaleMenuBtn=document.createElement("button");upscaleMenuBtn.type="button";upscaleMenuBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 15 .8 2.2L22 18l-.8-2.2L19 15Z"/></svg></span><span>Upscale</span>';upscaleMenuBtn.onclick=e=>{e.stopPropagation();closeAllMediaMenus();toggleUpscalePanel(item,card)};
  const editBtn=document.createElement("button");editBtn.type="button";editBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 3.3 3.3-.8L18.7 6.8a2.2 2.2 0 0 1 3.1 3.1L6.5 19l-3.3.8.8-3.3Z"/><path d="m14.2 5.8 4 4"/></svg></span><span>AI Редактор</span>';editBtn.onclick=async e=>{e.stopPropagation();closeAllMediaMenus();await openAiEditor(item)};
  const videoBtn=document.createElement("button");videoBtn.type="button";videoBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/></svg></span><span>Сделать видео</span>';videoBtn.onclick=async e=>{e.stopPropagation();closeAllMediaMenus();openVideoFromImage(await mediaItemToReference(item))};
  const copyBtn=document.createElement("button");copyBtn.type="button";copyBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg></span><span>Копировать</span>';copyBtn.onclick=async e=>{e.stopPropagation();closeAllMediaMenus();try{const response=await fetch(item.url,{headers:{Accept:"image/*"}});if(!response.ok)throw new Error();const blob=await response.blob();if(!navigator.clipboard?.write||!window.ClipboardItem)throw new Error();const bitmap=await createImageBitmap(blob);const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);bitmap.close();const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.95));if(!jpeg)throw new Error();await navigator.clipboard.write([new ClipboardItem({"image/jpeg":jpeg})]);toast("JPG скопирован")}catch{toast("Не удалось скопировать картинку")}};
  const downloadBtn=document.createElement("button");downloadBtn.type="button";downloadBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 19h14"/></svg></span><span>Скачать</span>';downloadBtn.onclick=e=>{e.stopPropagation();closeAllMediaMenus();showDownloadMenu(item,downloadBtn)};
  const deleteBtn=document.createElement("button");deleteBtn.type="button";deleteBtn.innerHTML='<span class="action-icon action-svg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></span><span>Удалить</span>';deleteBtn.onclick=e=>{e.stopPropagation();closeAllMediaMenus();confirmDeleteMedia(item,card)};
  menu.append(promptBtn,upscaleMenuBtn,editBtn,videoBtn,copyBtn,downloadBtn,deleteBtn);
 }else{
  const deleteBtn=document.createElement("button");deleteBtn.type="button";deleteBtn.innerHTML='<span class="action-icon">⌫</span><span>Удалить</span>';deleteBtn.onclick=e=>{e.stopPropagation();closeAllMediaMenus();confirmDeleteMedia(item,card)};menu.append(deleteBtn);
 }
 more.onclick=e=>{
   e.preventDefault();
   e.stopPropagation();
   const wasOpen=menu.classList.contains("open");
   closeAllMediaMenus();
   if(wasOpen)return;
   menu.classList.add("open");
   floatMediaOverlay(menu,more,"menu");
   requestAnimationFrame(()=>positionFloatingMediaOverlay(menu,more,"menu"));
 };
 actions.append(more,menu);card.appendChild(actions);return card;
}
function openVideoFromImage(url){
 referenceImage=url||"";
 try{sessionStorage.setItem("miyaReferenceImage",referenceImage)}catch{}
 mode="video";
 const m=modes.video;
 const workspaceEyebrow=$("#workspaceEyebrow"); if(workspaceEyebrow) workspaceEyebrow.textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;
 const composerInput=$("#composerInput");
 if(composerInput)composerInput.placeholder=m.placeholder;
 $("#composerSendText").textContent=m.send;$("#composerStatus").textContent="Agnes Video 2.5 Flash · изображение готово";
 $(".image-settings").style.display="none";$("#videoOptions").classList.add("show");
 $("#videoModel").value="OmegaTech T2V";
 updateVideoRatioVisibility();
 document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode==="video"));
 $("#chatMenuToggle")?.classList.remove("active");$("#chatSubmenu")?.classList.add("suppressed");
 setComposerAttachment(referenceImage);renderVideoLibrary();syncInput();$("#composerInput").focus();
}
function isVideoLibraryItem(item){
 if(!item)return false;
 const type=String(item.type||"").toLowerCase();
 const url=String(item.url||"");
 const model=String(item.model||"").toLowerCase();
 return type==="video"||type==="videos"||type==="mp4"||/\\.(mp4|webm|mov)(?:[?#]|$)/i.test(url)||/agnes video|ltx-2\\.3||motion synthesis|wan/i.test(model);
}
function isStoredVideo(item){
 if(!item||typeof item.url!=="string")return false;
 const type=String(item.type||"").toLowerCase();
 if(type==="audio"||type==="voice"||type==="speech")return false;
 const url=String(item.url||"");
 const model=String(item.model||"").toLowerCase();
 if(/miya voice|voice|tts|text[- ]to[- ]speech/i.test(model))return false;
 return type==="video"||type==="videos"||/\.(mp4|webm|mov)(?:[?#]|$)/i.test(url)||/ltx-2[.-]3||motion synthesis|agnes video/i.test(model);
}
function renderVideoLibrary(){
 const c=$("#canvas"),items=getLibrary().filter(isStoredVideo);
 if(!items.length){showEmpty();return}
 c.innerHTML='<div class="result-grid video-result-grid"></div>';
 const grid=c.querySelector(".result-grid");
 items.forEach(item=>grid.appendChild(buildMediaCard(item,{video:true})));
 applyFirstSixMediaPriority(grid);
}
function applyFirstSixMediaPriority(grid){
 if(!grid)return;
 const cards=[...grid.querySelectorAll(".media-card")];
 cards.slice(0,6).forEach((card,index)=>{
   const img=card.querySelector("img");
   const video=card.querySelector("video");
   if(img){
     // First 6 image previews get the browser's strongest normal loading hints.
     // This is a browser scheduling hint, not a blocking/forced download.
     img.loading="eager";
     img.fetchPriority="high";
   }
   if(video){
     // First 6 video previews get metadata/first-frame loading first.
     // Do not preload the full video: that would slow the rest of the wall.
     video.preload="metadata";
   }
   card.dataset.fastPreview=String(index+1);
 });
}
async function restoreCachedImagesIntoLibrary(){
 try{
  const db=await openMediaDB();if(!db)return;
  const cached=await new Promise((resolve,reject)=>{
   const tx=db.transaction("media","readonly");
   const req=tx.objectStore("media").getAll();
   req.onsuccess=()=>resolve(Array.isArray(req.result)?req.result:[]);
   req.onerror=()=>reject(req.error);
  });
  const cachedImages=cached.filter(x=>x&&x.type==="image"&&x.id&&x.url);
  if(!cachedImages.length)return;
  const items=getLibrary();
  const known=new Set(items.map(x=>x.id));
  const recovered=cachedImages.filter(x=>!known.has(x.id)).map(x=>({
    id:x.id,type:"image",url:String(x.url),prompt:"",model:"FLUX Dev",createdAt:Number(x.createdAt)||Date.now()
  }));
  if(!recovered.length)return;
  const merged=[...recovered,...items].sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0)).slice(0,500);
  try{localStorage.setItem(LIB_KEY,JSON.stringify(merged))}catch{}
 }catch{}
}
function renderImageLibrary(){
 const c=$("#canvas"),items=getLibrary().filter(x=>x.type==="image");
 if(!items.length){
   restoreCachedImagesIntoLibrary().then(()=>{
     const recovered=getLibrary().filter(x=>x.type==="image");
     if(recovered.length)renderImageLibrary();else showEmpty();
   });
   return;
 }
 c.innerHTML='<div class="result-grid"></div>';
 const grid=c.querySelector(".result-grid");
 items.forEach(item=>grid.appendChild(buildMediaCard(item)));
 applyFirstSixMediaPriority(grid);
}
let voiceCatalog=[];let voiceAudioParts=[];let voiceAudioItem=null;
async function loadVoiceCatalog(){try{const r=await fetch("https://ahm7xmakki.com/api/voices",{cache:"force-cache"});const data=await r.json();voiceCatalog=Array.isArray(data?.voices)?data.voices:[];const genderSelect=$("#voiceGender");if(genderSelect&&!genderSelect.dataset.miyaInitialized){genderSelect.value="male";genderSelect.dataset.miyaInitialized="1"}refreshVoiceSelects()}catch{voiceCatalog=[];const sel=$("#voiceSelect");if(sel)sel.innerHTML='<option value="">Не удалось загрузить голоса</option>'}}
function refreshVoiceSelects(){const gender=$("#voiceGender")?.value||"male";const sel=$("#voiceSelect");if(!sel)return;const isRussian=v=>{const l=String(v.language||"").toLowerCase(),country=String(v.country||"").toLowerCase();return l.includes("russian")||l==="ru"||l.includes("russia")||country.includes("russia")||country.includes("росси")};const genderOk=v=>{const g=String(v.gender||"").toLowerCase();return gender==="female"?(/female|woman|girl/i.test(g)):((/(^|[^a-z])male([^a-z]|$)|(^|[^a-z])man([^a-z]|$)|boy/i.test(g))&&!/(female|woman|girl)/i.test(g))};const list=voiceCatalog.filter(genderOk).sort((x,y)=>Number(isRussian(y))-Number(isRussian(x))||String(x.name||"").localeCompare(String(y.name||""),"ru"));sel.innerHTML="";list.forEach(v=>{const o=document.createElement("option");o.value=String(v.index);o.textContent=String(v.name||"Voice")+" · "+(gender==="male"?"Мужской":"Женский")+" · "+String(v.country||"");sel.appendChild(o)});if(!list.length){const o=document.createElement("option");o.value="";o.textContent="Нет голосов для выбранного пола";sel.appendChild(o)}else{const preferred=list.find(v=>isRussian(v)&&((gender==="male"&&/dmitry|alex|maxim|michael/i.test(String(v.name||"")))||(gender==="female"&&/svetlana/i.test(String(v.name||"")))))||list.find(isRussian)||list[0];sel.value=String(preferred.index)}}
function splitVoiceText(text,max=1000){const clean=String(text||"").trim();if(!clean)return[];const out=[];for(let i=0;i<clean.length;i+=max)out.push(clean.slice(i,i+max));return out}
function ensureVoiceWallStyles(){
 if(document.getElementById("miyaVoiceWallStyles"))return;
 const s=document.createElement("style");s.id="miyaVoiceWallStyles";
 s.textContent=`
.voice-wall{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px;align-items:stretch}
.voice-library-card,.voice-result-card{position:relative;min-width:0;aspect-ratio:16/9;min-height:0;height:auto;border:1px solid var(--line);border-radius:10px;background:linear-gradient(145deg,#0b233e,#08192e);padding:10px;box-shadow:0 10px 26px rgba(0,0,0,.14);transition:transform .18s,border-color .18s,box-shadow .18s;display:flex;flex-direction:column;gap:7px;cursor:pointer;overflow:hidden}
.voice-library-card:hover,.voice-result-card:hover{transform:translateY(-3px);border-color:rgba(166,119,255,.55);box-shadow:0 18px 38px rgba(0,0,0,.22)}
.voice-library-card:focus-visible{outline:2px solid #a86cff;outline-offset:3px}
.voice-result-title,.voice-library-card>b{font-size:13px;font-weight:900;letter-spacing:-.02em;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:42px}
.voice-result-meta{display:none}
.voice-card-text{font-size:16px;line-height:1.35;color:#9bb0c8;display:block;min-height:0;max-height:none;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;padding:0 42px 0 0;scrollbar-width:thin;scrollbar-color:rgba(145,115,190,.55) transparent}
 .voice-card-text::-webkit-scrollbar{width:4px;height:4px}.voice-card-text::-webkit-scrollbar-track{background:transparent}.voice-card-text::-webkit-scrollbar-thumb{background:rgba(145,115,190,.55);border-radius:999px}.voice-card-text::-webkit-scrollbar-thumb:hover{background:rgba(170,130,230,.75)}
.voice-player{border:1px solid rgba(104,144,185,.34);border-radius:10px;padding:6px 7px;background:linear-gradient(135deg,rgba(8,27,47,.96),rgba(15,32,56,.9));box-shadow:inset 0 1px 0 rgba(255,255,255,.035);cursor:default;flex:0 0 auto;min-width:0;overflow:hidden}
.voice-player-row{display:grid;grid-template-columns:32px minmax(0,1fr) minmax(54px,auto) 26px;align-items:center;gap:6px;min-width:0}
.voice-player-volume-wrap{width:26px;height:30px;display:grid;place-items:center;position:relative}
.voice-player-volume{width:27px;height:3px;transform:rotate(-90deg);transform-origin:center;accent-color:#a75cff}
.voice-editor-more{position:absolute;top:10px;right:10px;z-index:4;width:30px;height:30px;border:1px solid rgba(255,255,255,.16);border-radius:9px;background:rgba(7,20,36,.82);color:#b9c9dc;display:grid;place-items:center;cursor:pointer;backdrop-filter:blur(8px)}
.voice-editor-more:hover{background:rgba(145,91,255,.22);border-color:rgba(190,154,255,.42);color:#fff}
.voice-editor-more svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.voice-editor-dialog{width:100vw;height:100vh;max-width:none;max-height:none;overflow:auto;border:0;border-radius:0;background:radial-gradient(circle at 50% 0%,rgba(139,92,246,.14),transparent 34%),linear-gradient(145deg,#081a2e,#050f1d);padding:clamp(20px,4vw,56px);display:flex;flex-direction:column;justify-content:center;gap:14px}
body.light .voice-editor-dialog{
 background:radial-gradient(circle at 50% 0%,rgba(139,92,246,.10),transparent 34%),linear-gradient(145deg,#f8f7fc,#f0eef7)!important;
 color:#29243a!important;
}
body.light .voice-editor-head h3{color:#29243a}
body.light .voice-editor-source-label{color:#5e5870}
body.light .voice-editor-source-name{color:#6d687b}
body.light .voice-editor-upload{border-color:rgba(117,76,180,.25);background:linear-gradient(135deg,rgba(139,92,246,.055),rgba(255,255,255,.78));}
body.light .voice-editor-upload:hover,body.light .voice-editor-upload.drag{border-color:rgba(117,76,180,.48);background:linear-gradient(135deg,rgba(139,92,246,.10),rgba(255,255,255,.92));}
body.light .voice-editor-upload-copy b{color:#302a40}
body.light .voice-editor-upload-copy span{color:#777186}
body.light .voice-editor-plus{background:rgba(139,92,246,.08);color:#7652b5;border-color:rgba(117,76,180,.25)}
body.light .voice-editor-stem{border-color:rgba(58,45,85,.10);background:rgba(255,255,255,.70);color:#302a40}
body.light .voice-editor-tool{border-color:rgba(58,45,85,.12);background:linear-gradient(145deg,rgba(255,255,255,.92),rgba(245,243,250,.90));color:#4e485e;box-shadow:0 8px 24px rgba(55,43,82,.06)}
body.light .voice-editor-tool:hover{background:linear-gradient(145deg,rgba(139,92,246,.10),rgba(255,255,255,.96));border-color:rgba(117,76,180,.32);color:#302541}
body.light .voice-editor-tool.voice-editor-split{background:linear-gradient(135deg,rgba(169,92,255,.16),rgba(110,99,255,.12));border-color:rgba(117,76,180,.30);color:#65469b}
body.light .voice-editor-icon-btn,body.light .voice-editor-footer-btn{border-color:rgba(58,45,85,.12);background:rgba(255,255,255,.72);color:#514a60}
body.light .voice-editor-icon-btn:hover,body.light .voice-editor-footer-btn:hover{background:rgba(139,92,246,.10);color:#4b3671}
body.light .voice-editor-delete{background:linear-gradient(145deg,rgba(255,70,98,.10),rgba(255,255,255,.72))!important;color:#d34e68!important}
body.light .voice-editor-close-btn{background:rgba(255,255,255,.72);color:#514a60}
body.light .voice-editor-save{color:#fff}

.voice-editor-head{width:min(920px,94vw);margin:0 auto 2px}.voice-editor-head-actions{display:flex;align-items:center;gap:8px}.voice-editor-head h3{margin:2px 0 0;font-size:clamp(22px,3vw,34px);letter-spacing:-.045em}
.voice-editor-icon-btn,.voice-editor-footer-btn,.voice-editor-stem-save{display:grid;place-items:center;width:40px;height:40px;padding:0;border-radius:12px;border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.055);color:#cbd8e8;cursor:pointer;transition:.16s}.voice-editor-icon-btn:hover,.voice-editor-footer-btn:hover,.voice-editor-stem-save:hover{transform:translateY(-1px);border-color:rgba(185,145,255,.42);background:rgba(155,105,255,.14);color:#fff;box-shadow:0 10px 24px rgba(79,44,150,.18)}.voice-editor-icon-btn svg,.voice-editor-footer-btn svg,.voice-editor-stem-save svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.voice-editor-delete{border-color:rgba(255,105,125,.23);color:#ff9aaa;background:rgba(255,76,100,.055)}.voice-editor-delete:hover{border-color:rgba(255,120,140,.42);background:rgba(255,76,100,.12);color:#fff}.voice-editor-delete:disabled{opacity:.45;cursor:default;transform:none;box-shadow:none}
.voice-editor-source,.voice-editor-upload,.voice-editor-stems,.voice-editor-toolbar,.voice-editor-footer{width:min(920px,94vw);margin-left:auto;margin-right:auto}.voice-editor-source{display:grid;gap:8px}.voice-editor-source-label{font-size:9px;font-weight:900;opacity:.48;letter-spacing:.14em}.voice-editor-source-name{font-size:11px;color:#9fb0c3}.voice-editor-player{width:100%;margin:0}
.voice-editor-upload{display:flex;align-items:center;gap:15px;padding:18px 20px;border:1px dashed rgba(173,131,255,.34);border-radius:18px;background:linear-gradient(135deg,rgba(157,111,255,.07),rgba(255,255,255,.025));cursor:pointer;min-height:76px;box-sizing:border-box;transition:.18s}.voice-editor-upload:hover,.voice-editor-upload.drag{border-color:rgba(190,154,255,.72);background:linear-gradient(135deg,rgba(157,111,255,.14),rgba(255,255,255,.035));box-shadow:0 16px 40px rgba(65,39,120,.16)}.voice-editor-plus{width:50px;height:50px;flex:0 0 50px;border-radius:15px;border:1px solid rgba(190,154,255,.38);background:rgba(157,111,255,.10);color:#dccaff;display:grid;place-items:center}.voice-editor-plus svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}.voice-editor-upload-copy b{display:block;font-size:13px;font-weight:900}.voice-editor-upload-copy span{display:block;font-size:10px;color:#8195aa;margin-top:4px}
.voice-editor-stems{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.voice-editor-stem{min-width:0;padding:13px;border:1px solid rgba(255,255,255,.09);border-radius:15px;background:rgba(255,255,255,.035)}.voice-editor-stem b{font-size:12px;font-weight:900}.voice-editor-stem audio{width:100%;height:38px}.voice-editor-stem-save{width:34px;height:34px;border-radius:10px}
.voice-editor-toolbar{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:2px}
.voice-editor-tool{min-width:0;min-height:72px;padding:10px 12px;border:1px solid rgba(120,158,195,.20);border-radius:16px;background:linear-gradient(145deg,rgba(255,255,255,.065),rgba(255,255,255,.028));color:#b9c9dc;display:flex;align-items:center;justify-content:flex-start;gap:11px;cursor:pointer;transition:transform .16s,border-color .16s,background .16s,box-shadow .16s;text-align:left;box-shadow:0 8px 24px rgba(0,0,0,.08)}
.voice-editor-tool span{display:block;font-size:11px;font-weight:900;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.voice-editor-tool::after{content:"";width:5px;height:5px;border-radius:50%;margin-left:auto;background:rgba(190,154,255,.5);flex:0 0 auto}
.voice-editor-tool:hover{background:linear-gradient(145deg,rgba(157,111,255,.15),rgba(255,255,255,.045));border-color:rgba(190,154,255,.42);color:#fff;transform:translateY(-2px);box-shadow:0 14px 32px rgba(79,44,150,.16)}
.voice-editor-tool svg{width:22px;height:22px;flex:0 0 22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.voice-editor-tool.voice-editor-split{min-height:72px;width:auto;border-radius:16px;background:linear-gradient(135deg,rgba(169,92,255,.22),rgba(110,99,255,.18));border-color:rgba(184,143,255,.48);color:#e6d8ff;box-shadow:0 12px 30px rgba(104,66,210,.16)}
.voice-editor-tool:disabled{opacity:.5;cursor:wait;transform:none}
.voice-editor-delete{width:52px!important;height:52px!important;border-radius:16px!important;border:1px solid rgba(255,91,116,.42)!important;background:linear-gradient(145deg,rgba(255,70,98,.16),rgba(255,255,255,.045))!important;color:#ff9aaa!important;box-shadow:0 10px 28px rgba(255,70,98,.12)}
.voice-editor-delete:hover{transform:translateY(-2px)!important;border-color:rgba(255,125,145,.72)!important;background:linear-gradient(145deg,rgba(255,70,98,.25),rgba(255,255,255,.06))!important;color:#fff!important;box-shadow:0 15px 34px rgba(255,70,98,.18)!important}
.voice-editor-delete:disabled{opacity:.35!important;cursor:default!important;transform:none!important;box-shadow:none!important}
.voice-editor-footer{display:flex;justify-content:flex-end;gap:8px}.voice-editor-save{background:linear-gradient(135deg,#a95cff,#6e63ff);border:0;color:#fff}.voice-editor-close-btn{background:rgba(255,255,255,.04)}
@media(max-width:760px){.voice-editor-stems{grid-template-columns:1fr}.voice-editor-toolbar{grid-template-columns:1fr 1fr}.voice-editor-dialog{justify-content:flex-start;padding-top:28px}}@media(max-width:520px){.voice-editor-toolbar{grid-template-columns:1fr}.voice-editor-tool{min-height:64px}.voice-editor-tool.voice-editor-split{min-height:64px}.voice-editor-upload{padding:14px}}
.voice-player-play{width:32px;height:32px;border:0;border-radius:50%;background:linear-gradient(135deg,#b25cff,#695dff);color:#fff;display:grid;place-items:center;font-size:11px;box-shadow:0 5px 14px rgba(117,73,217,.22);padding:0}
.voice-player-play svg{width:14px;height:14px;fill:currentColor;stroke:none}
.voice-player-time{display:block;min-width:54px;width:auto;max-width:100%;overflow:hidden;text-overflow:clip;font-size:8px;color:#a9bad0;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;line-height:1}
.voice-player-range,.voice-player-volume{width:100%;height:3px;accent-color:#a75cff;margin:0}
.voice-player-status{display:none}
.voice-player-download{width:30px;height:30px;border:1px solid #1a4b78;border-radius:8px;background:#0b233d;color:#a9bdd0;display:grid;place-items:center;padding:0}
.voice-player-download:hover{background:#102943;color:#fff;border-color:#2879bb}
.voice-player-download svg{width:15px;height:15px}
.voice-card-actions{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin-top:auto}
.voice-card-action{width:100%;min-height:26px;height:26px;border:1px solid rgba(120,158,195,.26);border-radius:8px;background:rgba(255,255,255,.045);color:#b9c9dc;font-size:0;font-weight:800;display:flex;align-items:center;justify-content:center;gap:0;cursor:pointer;padding:0}
.voice-card-action:hover{background:rgba(157,111,255,.13);border-color:rgba(190,154,255,.34);color:#fff}
.voice-card-action.danger:hover{background:rgba(255,82,120,.12);border-color:rgba(255,130,155,.32)}
.voice-card-action svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.voice-transcript{display:none;padding:9px;border-radius:9px;background:rgba(255,255,255,.035);border:1px solid rgba(120,158,195,.18);font-size:9px;line-height:1.5;color:#a9bdd0;white-space:pre-wrap;max-height:130px;overflow:auto}
.voice-transcript.open{display:block}
.voice-detail-backdrop{position:fixed;inset:0;z-index:2147483600;background:rgba(3,9,18,.72);backdrop-filter:blur(10px);display:grid;place-items:stretch;padding:0;overflow:hidden}
.voice-detail-dialog{width:100vw;height:100vh;max-width:none;max-height:none;overflow:hidden;border:0;border-radius:0;background:linear-gradient(145deg,#0a1c32,#071322);box-shadow:none;padding:clamp(18px,3vw,42px);position:relative;display:flex;flex-direction:column;justify-content:center}
.voice-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
.voice-detail-head h3{margin:2px 0 4px;font-size:22px;letter-spacing:-.03em}
.voice-detail-eyebrow{font-size:9px;letter-spacing:.16em;font-weight:900;color:#a97bff}
.voice-detail-close{width:36px;height:36px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.06);color:#fff;font-size:20px;cursor:pointer}
.voice-detail-card{min-height:0!important;height:auto!important;max-height:min(62vh,620px);width:min(720px,92vw);align-self:center;cursor:default;transform:none!important;box-shadow:none!important;border-color:rgba(170,130,255,.22)!important;aspect-ratio:1/1}
.voice-detail-info{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 auto 12px;width:min(720px,92vw)}
.voice-detail-info>div{padding:10px 12px;border:1px solid rgba(120,158,195,.18);border-radius:10px;background:rgba(255,255,255,.035)}
.voice-detail-info small{display:block;color:#738aa3;font-size:8px;margin-bottom:4px}
.voice-detail-info b{font-size:10px;color:#d5e0ec}
body.light .voice-editor-dialog{background:#fff;border-color:#dbe4ee}
body.light .voice-editor-tool,body.light .voice-editor-close-btn{background:#f4f7fa;color:#52657b;border-color:#d3deea}
body.light .voice-editor-field input,body.light .voice-editor-field select{background:#fff;color:#273047;border-color:#d3deea}
body.light .voice-library-card,body.light .voice-result-card{background:#fff;border-color:#dbe4ee;box-shadow:0 8px 25px rgba(30,55,85,.07)}
body.light .voice-result-meta,body.light .voice-card-text{color:#71859a}
body.light .voice-player{background:linear-gradient(135deg,#f7f9fc,#eef3f8);border-color:#d3deea} .voice-options #voiceLanguage{display:none!important}
body.light #voiceOptions .select-pill,
body.light #voiceOptions .voice-tool,
body.light #voiceOptions .voice-range{
 background:#fff!important;background-color:#fff!important;color:#273047!important;border-color:#cbd8e5!important; color-scheme:light!important;box-shadow:0 2px 7px rgba(50,70,95,.06)!important;
}
body.light #voiceOptions .select-pill:hover,
body.light #voiceOptions .select-pill:focus,
body.light #voiceOptions .select-pill:active,
body.light #voiceOptions .voice-tool:hover,
body.light #voiceOptions .voice-tool:focus,
body.light #voiceOptions .voice-tool:active{
 background:#fff!important;background-color:#fff!important;color:#273047!important;border-color:#a98cff!important;
}
body.light #voiceOptions .select-pill option{background:#fff!important;color:#273047!important}
/* Unified prompt actions: icon-only, no button chrome. */
.composer-options button,
.voice-options button,
.video-options button,
#composerAttach,#composerMic{
 appearance:none!important;-webkit-appearance:none!important;
 background:transparent!important;background-color:transparent!important;
 border:0!important;box-shadow:none!important;
 color:#9aa9bc!important;outline:none!important;
 width:30px!important;height:30px!important;min-width:30px!important;
 padding:5px!important;border-radius:8px!important;
 display:grid!important;place-items:center!important;
 transition:color .16s ease,opacity .16s ease,transform .16s ease!important;
}
.composer-options button svg,.voice-options button svg,.video-options button svg,
#composerAttach svg,#composerMic svg{
 width:18px!important;height:18px!important;
 stroke:currentColor!important;fill:none!important;
}
.composer-options button:hover,
.voice-options button:hover,
.video-options button:hover,
#composerAttach:hover,#composerMic:hover{
 background:transparent!important;background-color:transparent!important;
 color:#b88cff!important;border-color:transparent!important;
 box-shadow:none!important;transform:translateY(-1px)!important;
}
.composer-options button:focus-visible,
.voice-options button:focus-visible,
.video-options button:focus-visible,
#composerAttach:focus-visible,#composerMic:focus-visible{
 background:transparent!important;border-color:transparent!important;
 box-shadow:0 0 0 2px rgba(169,140,255,.18)!important;color:#b88cff!important;
}
.composer-options button:active,
.voice-options button:active,
.video-options button:active,
#composerAttach:active,#composerMic:active{
 background:transparent!important;color:#b88cff!important;box-shadow:none!important;
}
body.light .composer-options button,
body.light .voice-options button,
body.light .video-options button,
body.light #composerAttach,body.light #composerMic{
 background:transparent!important;background-color:transparent!important;
 color:#71839a!important;border:0!important;box-shadow:none!important;
}
body.light .composer-options button:hover,
body.light .voice-options button:hover,
body.light .video-options button:hover,
body.light #composerAttach:hover,body.light #composerMic:hover{
 background:transparent!important;color:#7b61c8!important;border:0!important;box-shadow:none!important;
}
body.light .composer-options button:active,
body.light .voice-options button:active,
body.light .video-options button:active,
body.light #composerAttach:active,body.light #composerMic:active{
 background:transparent!important;color:#7b61c8!important;border:0!important;box-shadow:none!important;
}
.miya-rename-backdrop{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(4,10,22,.56);backdrop-filter:blur(10px)}
.miya-rename-dialog{width:min(390px,calc(100vw - 32px));padding:20px;border:1px solid rgba(169,140,255,.28);border-radius:18px;background:linear-gradient(145deg,#101a30,#0b1427);box-shadow:0 24px 80px rgba(0,0,0,.42)}
.miya-rename-eyebrow{font-size:9px;letter-spacing:.16em;color:#a987ff;font-weight:700;margin-bottom:7px}
.miya-rename-dialog h3{margin:0 0 16px;font-size:19px;color:#eef3fa}
.miya-rename-input{width:100%;height:44px;box-sizing:border-box;border:1px solid rgba(150,170,200,.25);border-radius:11px;background:rgba(255,255,255,.055);color:#f2f5fa;padding:0 13px;font:inherit;outline:none}
.miya-rename-input:focus{border-color:#a98cff;box-shadow:0 0 0 3px rgba(169,140,255,.14)}
.miya-rename-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}
.miya-rename-actions button{height:36px;padding:0 14px;border-radius:9px;border:1px solid rgba(150,170,200,.22);font:inherit;cursor:pointer}
.miya-rename-cancel{background:rgba(255,255,255,.045);color:#aab8c9}
.miya-rename-save{background:linear-gradient(135deg,#8d67e8,#6d61d9);border-color:transparent!important;color:#fff}
.miya-rename-cancel:hover{background:rgba(255,255,255,.08)}
.miya-rename-save:hover{filter:brightness(1.08)}
body.light .miya-rename-backdrop{background:rgba(30,45,65,.28)}
body.light .miya-rename-dialog{background:linear-gradient(145deg,#ffffff,#f3f6fa);border-color:#d7e1ec;box-shadow:0 24px 70px rgba(40,65,90,.2)}
body.light .miya-rename-eyebrow{color:#7659c6}
body.light .miya-rename-dialog h3{color:#273047}
body.light .miya-rename-input{background:#fff;color:#273047;border-color:#cbd8e5}
body.light .miya-rename-cancel{background:#fff;color:#52657b;border-color:#cbd8e5}
body.light .miya-rename-cancel:hover{background:#f3f6fa}
body.light .miya-rename-save{color:#fff}
.image-viewer-created-date{position:absolute;right:14px;bottom:12px;z-index:12;font-size:10px;line-height:1;color:#fff;background:rgba(7,15,28,.58);border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:6px 8px;backdrop-filter:blur(8px);pointer-events:none}
body.light .image-viewer-created-date{color:#52657b;background:rgba(255,255,255,.9);border-color:#dbe4ee}
.voice-detail-player .voice-player-range::-webkit-slider-thumb{width:7px!important;height:7px!important;border-radius:50%!important;background:#fff!important;opacity:1!important}
.voice-detail-player .voice-player-range::-moz-range-thumb{width:7px!important;height:7px!important;border-radius:50%!important;background:#fff!important;opacity:1!important}
.voice-player-range::-webkit-slider-thumb{width:7px!important;height:7px!important;border-radius:50%!important;background:#fff!important;opacity:1!important}
.voice-player-range::-moz-range-thumb{width:7px!important;height:7px!important;border-radius:50%!important;background:#fff!important;opacity:1!important}
body.light .voice-options .select-pill{background:#f4f7fa!important;color:#52657b!important;border-color:#d3deea!important} body.light .voice-options .select-pill:hover{background:#e9eef5!important;border-color:#c5d2e0!important;color:#273047!important} body.light .voice-options .voice-range{background:#f4f7fa!important;color:#52657b!important;border-color:#d3deea!important} body.light .voice-options .voice-tool{background:#f4f7fa!important;color:#52657b!important;border-color:#d3deea!important}
.voice-player-track{position:relative;min-width:0;width:100%;height:34px;display:flex;align-items:flex-end}.voice-player-eq{position:absolute;inset:0 0 8px;display:flex;align-items:flex-end;justify-content:center;gap:2px;opacity:.34;overflow:hidden;pointer-events:none}.voice-player-eq i{display:block;width:3px;height:3px;min-height:2px;border-radius:3px;background:linear-gradient(180deg,#c47aff,#695dff);transform-origin:center;transition:height .08s ease}.voice-player.is-playing .voice-player-eq{opacity:1}.voice-player-range{position:absolute;left:0;right:0;bottom:0;width:100%;z-index:3;background:transparent;appearance:none;-webkit-appearance:none;height:7px!important;margin:0!important}.voice-player-range::-webkit-slider-runnable-track{height:3px;background:rgba(190,205,224,.22);border-radius:999px}.voice-player-range::-moz-range-track{height:3px;background:rgba(190,205,224,.22);border-radius:999px}.voice-player-range::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:7px;height:7px;margin-top:-2px;border:0;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 1px 5px rgba(0,0,0,.35);opacity:1}.voice-player-range::-moz-range-thumb{width:7px;height:7px;border:0;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 1px 5px rgba(0,0,0,.35);opacity:1}.voice-player-time{display:block;min-width:48px;width:auto;max-width:100%;overflow:hidden;text-overflow:clip;font-size:8px;color:#a9bad0;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;line-height:1}#composerInput.speech-recording::placeholder{color:transparent!important}#composerInput.speech-recording{user-select:none!important;-webkit-user-select:none!important;}.voice-card-menu{position:fixed;z-index:2147483646;min-width:180px;padding:5px;border:1px solid rgba(170,130,255,.28);border-radius:12px;background:rgba(8,20,38,.97);box-shadow:0 16px 50px rgba(0,0,0,.35);backdrop-filter:blur(14px)}.voice-card-menu button{width:100%;height:32px;border:0;border-radius:8px;background:transparent;color:#c7d5e4;display:flex;align-items:center;gap:8px;padding:0 9px;font-size:9px;font-weight:800;text-align:left;cursor:pointer}.voice-card-menu button:hover{background:rgba(157,111,255,.14);color:#fff}.voice-card-menu svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
body.light .voice-player-time{color:#5f7085}
body.light .voice-player-download,body.light .voice-card-action{background:#f4f7fa;color:#52657b;border-color:#d3deea} body.light .voice-card-action:hover{background:#e9eef5;border-color:#c5d2e0;color:#273047} body.light .voice-player-play{box-shadow:0 5px 14px rgba(117,73,217,.16)} body.light .voice-card-text{color:#52657b}
body.light .voice-detail-dialog{background:#fff;border-color:#dbe4ee}
body.light .voice-detail-close{background:#f4f7fa;color:#273047;border-color:#d3deea}
html.miya-editor-page-open,body.miya-editor-page-open{overflow:hidden!important;width:100%!important;height:100%!important} body.miya-editor-page-open .app-shell{visibility:hidden!important;pointer-events:none!important} body.voice-modal-open{overflow:hidden!important}
body.voice-modal-open .composer-wrap,body.voice-modal-open #voiceOptions,body.voice-modal-open #videoOptions,body.voice-modal-open .image-settings{display:none!important;visibility:hidden!important;pointer-events:none!important}
.voice-detail-date{width:min(720px,92vw);margin:4px auto 10px;text-align:center;color:#778da6;font-size:9px}
.voice-detail-copy{width:min(720px,92vw);margin:0 auto 14px;padding:12px 14px;border:1px solid rgba(120,158,195,.18);border-radius:12px;background:rgba(255,255,255,.035);color:#b9c9d9;font-size:11px;line-height:1.5;max-height:120px;overflow:hidden}
.voice-detail-copy:empty{display:none}
.voice-player-range{
  appearance:none!important;
  -webkit-appearance:none!important;
  height:8px!important;
  background:transparent!important;
  accent-color:transparent!important;
  cursor:pointer!important;
  z-index:10!important;
}
.voice-player-range::-webkit-slider-runnable-track{
  height:3px!important;
  border:0!important;
  border-radius:999px!important;
  background:rgba(190,205,224,.24)!important;
}
.voice-player-range::-moz-range-track{
  height:3px!important;
  border:0!important;
  border-radius:999px!important;
  background:rgba(190,205,224,.24)!important;
}
.voice-player-range::-webkit-slider-thumb{
  appearance:none!important;
  -webkit-appearance:none!important;
  width:8px!important;
  height:8px!important;
  margin-top:-2.5px!important;
  border:0!important;
  border-radius:50%!important;
  background:#fff!important;
  box-shadow:0 0 0 1px rgba(255,255,255,.28),0 1px 6px rgba(0,0,0,.5)!important;
  opacity:1!important;
}
.voice-player-range::-moz-range-thumb{
  width:8px!important;
  height:8px!important;
  border:0!important;
  border-radius:50%!important;
  background:#fff!important;
  box-shadow:0 0 0 1px rgba(255,255,255,.28),0 1px 6px rgba(0,0,0,.5)!important;
  opacity:1!important;
}
.voice-player-range:focus-visible{
  outline:none!important;
}
@media(max-width:980px){.voice-wall{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.voice-wall{grid-template-columns:1fr}.voice-library-card,.voice-result-card{padding:10px}.voice-player-row{grid-template-columns:30px minmax(0,1fr) minmax(48px,auto) 26px}.voice-detail-info{grid-template-columns:repeat(2,minmax(0,1fr))}.voice-detail-dialog,.voice-editor-dialog{padding:16px}.voice-detail-card{width:min(92vw,62vh);max-height:62vh}}`;
 document.head.appendChild(s);
}
function ensureVoiceCardFinalStyles(){
 if(document.getElementById("miyaVoiceCardFinalStyles"))return;
 const s=document.createElement("style");s.id="miyaVoiceCardFinalStyles";
 s.textContent=`
/* Voice wall: deliberately uses the same geometry as image cards. */
.voice-wall{width:100%!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:11px!important;margin:0!important;padding:0 0 40px!important}
.voice-library-card,.voice-result-card{
 position:relative!important;min-width:0!important;width:100%!important;height:auto!important;aspect-ratio:16/9!important;min-height:0!important;
 box-sizing:border-box!important;padding:10px!important;gap:7px!important;overflow:hidden!important;
 border-radius:10px!important;transition:none!important;transform:none!important;
}
.voice-library-card:hover,.voice-result-card:hover{
 transform:none!important;
 transition:none!important;
 box-shadow:inherit!important;
}
.voice-library-card:focus-visible{outline:2px solid #a86cff!important;outline-offset:2px}
.voice-result-title,.voice-library-card>b{padding-right:42px!important;min-height:16px!important}
.voice-card-text{padding-right:42px!important;max-height:40px!important;-webkit-line-clamp:3!important;font-size:8px!important;line-height:1.32!important}
.voice-player{
 width:100%!important;margin:0!important;padding:5px 6px!important;border-radius:9px!important;box-sizing:border-box!important;
}
.voice-player-row{grid-template-columns:30px minmax(0,1fr) minmax(62px,auto) 26px!important;gap:7px!important;align-items:center!important}
.voice-player-play{width:30px!important;height:30px!important;flex:0 0 30px!important;border-radius:7px!important}
.voice-player-track{height:40px!important;position:relative!important;display:block!important;min-width:0!important;width:100%!important;align-self:center!important;overflow:hidden!important}
.voice-player-eq{inset:0!important;width:100%!important;gap:1px!important;align-items:stretch!important;justify-content:space-between!important;opacity:.30!important;display:flex!important;position:absolute!important;pointer-events:none!important;overflow:hidden!important}
.voice-player.is-playing .voice-player-eq{opacity:1!important}
.voice-player-eq i{position:relative!important;flex:1 1 0!important;width:auto!important;max-width:4px!important;height:100%!important;min-height:100%!important;background:transparent!important;align-self:stretch!important;transform:none!important}
.voice-player-eq i::before,.voice-player-eq i::after{content:""!important;position:absolute!important;left:0!important;right:0!important;height:var(--eq-h,3px)!important;border-radius:2px!important;background:linear-gradient(180deg,#c47aff,#695dff)!important}
.voice-player-eq i::before{bottom:50%!important;transform:translateY(0)!important}
.voice-player-eq i::after{top:50%!important;transform:translateY(0)!important}
.voice-player-range{position:absolute!important;left:0!important;right:0!important;top:50%!important;bottom:auto!important;transform:translateY(-50%)!important;width:100%!important;height:3px!important;z-index:4!important;background:transparent!important;margin:0!important}
.voice-player-track::after{content:""!important;position:absolute!important;left:0!important;top:50%!important;transform:translateY(-50%)!important;width:var(--voice-progress,0%)!important;height:3px!important;border-radius:3px!important;background:linear-gradient(90deg,#a75cff,#7b63ff)!important;opacity:.95!important;z-index:2!important;pointer-events:none!important}
.voice-player-range::-webkit-slider-thumb{appearance:none!important;-webkit-appearance:none!important;width:3px!important;height:18px!important;margin-top:-7.5px!important;border:0!important;border-radius:1px!important;background:#fff!important;box-shadow:0 0 5px rgba(167,92,255,.55)!important;opacity:1!important}
.voice-player-range::-moz-range-thumb{width:3px!important;height:18px!important;border:0!important;border-radius:1px!important;background:#fff!important;box-shadow:0 0 5px rgba(167,92,255,.55)!important;opacity:1!important}
.voice-player-range::-webkit-slider-runnable-track{height:3px!important;background:transparent!important}
.voice-player-range::-moz-range-track{height:3px!important;background:transparent!important}
.voice-detail-player .voice-player-track{height:80px!important}
.voice-detail-player .voice-player-eq i::before,.voice-detail-player .voice-player-eq i::after{height:calc(var(--eq-h,3px) * 2)!important}
.voice-detail-player .voice-player-track::after{height:5px!important}

.voice-card-date{margin-top:auto;text-align:right;font-size:8px;line-height:1;color:#8093a8;font-variant-numeric:tabular-nums;padding-top:2px}
.voice-detail-nav{display:flex;align-items:center;gap:6px;margin-left:auto}.voice-detail-nav-btn{width:34px;height:34px;border:1px solid rgba(120,158,195,.26);border-radius:9px;background:rgba(255,255,255,.045);color:#b9c9dc;display:grid;place-items:center;cursor:pointer;padding:0}.voice-detail-nav-btn:hover{background:rgba(157,111,255,.13);border-color:rgba(190,154,255,.34);color:#fff}.voice-detail-nav-btn:disabled{opacity:.28;cursor:default}.voice-detail-nav-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.voice-detail-head{display:flex;align-items:center;gap:10px}.voice-detail-head>.voice-detail-nav{margin-left:auto}.voice-detail-actions{display:flex;justify-content:center;gap:7px;margin:0 auto 12px}
.voice-detail-action{width:34px;height:30px;border:1px solid rgba(120,158,195,.26);border-radius:8px;background:rgba(255,255,255,.045);color:#b9c9dc;display:grid;place-items:center;cursor:pointer;padding:0}
.voice-detail-action:hover{background:rgba(157,111,255,.13);border-color:rgba(190,154,255,.34);color:#fff}
.voice-detail-action svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
body.light .voice-options .select-pill,body.light .voice-options .voice-tool{background:#fff!important;background-color:#fff!important;color:#273047!important;border-color:#cbd8e5!important;box-shadow:0 2px 7px rgba(50,70,95,.06)!important}
body.light .voice-options .select-pill:hover,body.light .voice-options .voice-tool:hover{background:#fff!important;background-color:#fff!important;color:#273047!important;border-color:#b9c9d9!important}
body.light .voice-options select option{background:#fff!important;color:#273047!important}
body.light .voice-card-date{color:#71859a}
body.light .voice-detail-action{background:#fff;color:#52657b;border-color:#cbd8e5}
body.light .voice-detail-action:hover{background:#f3f6fa;color:#273047;border-color:#b9c9d9}
.voice-player-volume-wrap{width:26px!important;height:30px!important}
.voice-player-volume{width:25px!important;height:3px!important}
.voice-player-volume::-webkit-slider-thumb{appearance:none;width:14px;height:7px;border-radius:3px;border:1px solid #9b72e8;background:repeating-linear-gradient(90deg,#a75cff 0,#a75cff 3px,#754fd0 3px,#754fd0 4px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);cursor:pointer}
.voice-player-volume::-moz-range-thumb{width:14px;height:7px;border-radius:3px;border:1px solid #9b72e8;background:repeating-linear-gradient(90deg,#a75cff 0,#a75cff 2px,#754fd0 2px,#754fd0 3px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22);cursor:pointer}
.voice-player-volume::-webkit-slider-runnable-track{height:3px;background:#cfd8e4;border-radius:3px}
.voice-player-volume::-moz-range-track{height:3px;background:#cfd8e4;border-radius:3px}
body.light .voice-player-volume::-webkit-slider-thumb{background:repeating-linear-gradient(90deg,#8e68d8 0,#8e68d8 2px,#7555bc 2px,#7555bc 3px);border-color:#7555bc;box-shadow:inset 0 0 0 1px rgba(255,255,255,.55)}
body.light .voice-player-volume::-moz-range-thumb{background:repeating-linear-gradient(90deg,#8e68d8 0,#8e68d8 2px,#7555bc 2px,#7555bc 3px);border-color:#7555bc;box-shadow:inset 0 0 0 1px rgba(255,255,255,.55)}
body.light .voice-card-action,body.light .voice-player-download,body.light .voice-editor-tool,body.light .voice-editor-close-btn{background:#ffffff!important;color:#52657b!important;border-color:#cbd8e5!important;box-shadow:0 2px 7px rgba(50,70,95,.06)!important}
body.light .voice-card-action:hover,body.light .voice-player-download:hover,body.light .voice-editor-tool:hover,body.light .voice-editor-close-btn:hover{background:#f3f6fa!important;color:#273047!important;border-color:#b9c9d9!important}
.voice-player-time{
 position:static!important;display:block!important;min-width:62px!important;width:auto!important;max-width:none!important;
 transform:none!important;z-index:auto!important;font-size:8px!important;line-height:1!important;
 text-align:right!important;font-variant-numeric:tabular-nums!important;white-space:nowrap!important;
 padding:0!important;background:none!important;overflow:visible!important;
}
body.light .voice-player-time{background:none!important;color:#52657b!important}
body.light .voice-options .select-pill{
 appearance:none!important;-webkit-appearance:none!important;color-scheme:light!important;
 background:#fff!important;background-color:#fff!important;color:#273047!important;border:1px solid #cbd8e5!important;
 box-shadow:inset 0 1px 0 rgba(255,255,255,.8)!important;
}
body.light .voice-options .select-pill:focus{
 outline:none!important;background:#fff!important;background-color:#fff!important;color:#273047!important;border-color:#a98cff!important;
 box-shadow:0 0 0 2px rgba(169,140,255,.16)!important;
}
body.light .voice-options select.select-pill option,
body.light .voice-options #voiceLanguage option,
body.light .voice-options #voiceGender option,
body.light .voice-options #voiceSelect option{background:#fff!important;color:#273047!important;color-scheme:light!important}
body.light .voice-options #voiceLanguage,
body.light .voice-options #voiceGender,
body.light .voice-options #voiceSelect{
 background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath d='m7 9 5 5 5-5' fill='none' stroke='%2352657b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")!important;
 background-repeat:no-repeat!important;background-position:right 8px center!important;background-size:12px 12px!important;
 padding-right:27px!important;
}
.voice-player-volume-wrap{width:26px!important;height:30px!important}
.voice-player-volume{width:25px!important;height:3px!important}
.voice-card-actions{
 display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:5px!important;
 margin-top:0!important;flex:0 0 26px!important;height:26px!important;
}
.voice-card-action{
 width:100%!important;min-width:0!important;min-height:26px!important;height:26px!important;
 padding:0!important;border-radius:7px!important;font-size:0!important;display:grid!important;place-items:center!important;
}
.voice-card-action svg{width:12px!important;height:12px!important}
.voice-editor-more{
 top:8px!important;right:8px!important;
}
.voice-card-menu-floating{
 opacity:0;visibility:hidden;transform:translateY(-3px);
 transition:opacity .08s ease,transform .08s ease,visibility .08s linear;
 pointer-events:none!important;
}
.voice-card-menu-floating.ready{
 opacity:1;visibility:visible;transform:translateY(0);
 pointer-events:auto!important;
}
body.light .voice-card-menu-floating{
 background:#fff!important;color:#273047!important;border:1px solid #dbe4ee!important;
 box-shadow:0 14px 34px rgba(30,55,85,.16)!important;
}
body.light .voice-card-menu-floating button{color:#52657b!important;background:transparent!important}
body.light .voice-card-menu-floating button:hover{background:#f0f4f8!important;color:#273047!important}
/* Do not create a second visual style for the dots: image-card .media-more is the source of truth. */
.voice-editor-more.media-more{position:absolute!important}
.voice-library-card .voice-editor-more{transition:transform .16s ease,background .16s ease,border-color .16s ease,box-shadow .16s ease!important}
.voice-library-card .voice-editor-more:hover{transform:translateY(-1px) scale(1.04)!important;box-shadow:0 10px 24px rgba(110,72,220,.20)!important}
.voice-editor-more svg{width:15px!important;height:15px!important;fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round!important}
body.light .voice-editor-more.media-more svg{fill:currentColor!important}
@media(max-width:980px){.voice-wall{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media(max-width:620px){
 .voice-wall{grid-template-columns:1fr!important}
 .voice-library-card,.voice-result-card{padding:10px!important}
 .voice-player-row{grid-template-columns:30px minmax(0,1fr) 26px!important}
}
`;
 document.head.appendChild(s);
}
function voiceIcon(path){return '<svg viewBox="0 0 24 24">'+path+'</svg>'}
function buildVoicePlayer(source,card){
 const wrap=document.createElement("div");wrap.className="voice-player";
 const row=document.createElement("div");row.className="voice-player-row";

 const play=document.createElement("button");play.type="button";play.className="voice-player-play";play.innerHTML='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
 const track=document.createElement("div");track.className="voice-player-track";
 const eq=document.createElement("div");eq.className="voice-player-eq";eq.innerHTML=Array.from({length:64},()=>"<i></i>").join("");
 const range=document.createElement("input");range.type="range";range.min=0;range.max=100;range.value=0;range.className="voice-player-range";range.title="Позиция";
 track.append(eq,range);
 const timeWrap=document.createElement("span");timeWrap.className="voice-player-time";timeWrap.textContent="0:00 / 0:00";
 const audio=document.createElement("audio");audio.preload="metadata";audio.style.display="none";
 let loaded=false,ctx=null,analyser=null,sourceNode=null,frame=0,totalText="0:00";
 const formatTime=n=>Math.floor(Math.max(0,Number(n)||0)/60)+":"+String(Math.floor(Math.max(0,Number(n)||0)%60)).padStart(2,"0");
 const setTime=()=>{const current=formatTime(audio.currentTime);timeWrap.textContent=current+" / "+totalText;track.style.setProperty("--voice-progress",(audio.duration?Math.max(0,Math.min(100,audio.currentTime/audio.duration*100)):0)+"%")};
 const load=async()=>{if(loaded)return;const blob=await resolveVoiceBlob(source);audio.src=URL.createObjectURL(blob);audio.volume=.9;audio.load();loaded=true};
 const draw=()=>{if(!analyser)return;const data=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(data);const bars=[...eq.children];bars.forEach((bar,i)=>{const start=Math.floor(Math.pow(i/bars.length,1.7)*data.length),end=Math.max(start+1,Math.floor(Math.pow((i+1)/bars.length,1.7)*data.length));let sum=0;for(let j=start;j<end&&j<data.length;j++)sum+=data[j];const value=(sum/Math.max(1,end-start))/255;bar.style.setProperty("--eq-h",Math.max(2,Math.round(2+value*16))+"px")});if(!audio.paused&&!audio.ended)frame=requestAnimationFrame(draw)};
 const startAnalyser=()=>{if(!ctx){const C=window.AudioContext||window.webkitAudioContext;if(!C)return;ctx=new C();analyser=ctx.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.72;sourceNode=ctx.createMediaElementSource(audio);sourceNode.connect(analyser);analyser.connect(ctx.destination)}ctx.resume?.();cancelAnimationFrame(frame);draw()};
 play.onclick=async e=>{e.stopPropagation();try{await load();if(audio.paused){if(audio.ended)audio.currentTime=0;startAnalyser();await audio.play()}else audio.pause()}catch{toast("Не удалось воспроизвести голос")}};
 range.oninput=async()=>{try{await load();if(audio.duration)audio.currentTime=Number(range.value)/100*audio.duration;track.style.setProperty("--voice-progress",String(Number(range.value)||0)+"%");setTime()}catch{}};
 audio.onloadedmetadata=()=>{totalText=formatTime(audio.duration);track.style.setProperty("--voice-progress","0%");setTime()};
 audio.onplay=()=>{wrap.classList.add("is-playing");startAnalyser();play.innerHTML='<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';setTime()};
 audio.onpause=()=>{wrap.classList.remove("is-playing");cancelAnimationFrame(frame);play.innerHTML='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';setTime()};
 audio.ontimeupdate=()=>{range.value=audio.duration?audio.currentTime/audio.duration*100:0;setTime()};
 audio.onended=()=>{wrap.classList.remove("is-playing");cancelAnimationFrame(frame);range.value=100;track.style.setProperty("--voice-progress","100%");setTime()};
 const vw=document.createElement("div");vw.className="voice-player-volume-wrap";
 const volume=document.createElement("input");volume.type="range";volume.min=0;volume.max=1;volume.step=.01;volume.value=.9;volume.className="voice-player-volume";volume.title="Громкость";volume.oninput=async()=>{try{await load();audio.volume=Number(volume.value)}catch{}};vw.append(volume);
 row.append(play,track,timeWrap,vw);wrap.append(row,audio);
 return {wrap,audio,cleanup:()=>{cancelAnimationFrame(frame);try{sourceNode?.disconnect()}catch{}try{analyser?.disconnect()}catch{}try{ctx?.close()}catch{}if(audio.src?.startsWith("blob:"))URL.revokeObjectURL(audio.src)}};
}
async function resolveVoiceBlob(source){
 if(source instanceof Blob)return source;
 const u=typeof source==="function"?await source():source;
 if(!u)throw new Error("AUDIO_URL_EMPTY");
 const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw new Error("AUDIO_FETCH_"+r.status);
 const blob=await r.blob();if(!blob.size)throw new Error("AUDIO_EMPTY");return blob;
}
async function downloadVoiceSource(audio,source){
 try{
   let blob;
   if(audio?.src)blob=await fetch(audio.src,{cache:"no-store"}).then(r=>r.blob());
   else blob=await resolveVoiceBlob(source);
   const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download="miya-voice.mp3";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1200);
 }catch{toast("Не удалось скачать аудио")}
}
async function runVoiceCleverTool(item,card,slug,label,extra={}){
 const buttons=[...card.querySelectorAll("[data-voice-action]")];buttons.forEach(b=>b.disabled=true);
 toast(label+" · обработка…");
 try{
   const source=await resolveMediaUrl(item);if(!source)throw new Error("AUDIO_URL_EMPTY");
   const blob=await resolveVoiceBlob(source);
   const form=new FormData();form.append("file",new File([blob],"miya-voice.mp3",{type:blob.type||"audio/mpeg"}));
   Object.entries(extra).forEach(([k,v])=>form.append(k,String(v)));
   const rr=await fetch("https://cleverutils.com/api/v1/tools/"+encodeURIComponent(slug),{method:"POST",body:form,headers:{Accept:"application/json"},cache:"no-store"});
   const data=await rr.json().catch(()=>({}));if(!rr.ok)throw new Error(data?.message||data?.error?.message||data?.error||"VOICE_TOOL_FAILED");
   const job=data?.data||data;
   if(slug==="speech-to-text"){
     let result=job?.text||job?.result?.text||job?.output?.text||"";
     if(!result&&job?.job_id)result=await pollCleverJobJson(job.job_id);
     if(!result)throw new Error("TRANSCRIPT_EMPTY");
     let box=card.querySelector(".voice-transcript");if(!box){box=document.createElement("div");box.className="voice-transcript";card.appendChild(box)}
     box.textContent=String(result);box.classList.add("open");toast("Текст готов");return;
   }
   let out=job?.output?.url||job?.outputUrl||"";
   if(!out&&job?.job_id)out=await pollCleverJobOutput(job.job_id);
   if(!out)throw new Error("VOICE_TOOL_OUTPUT_MISSING");
   const outBlob=await resolveVoiceBlob(out);const url=URL.createObjectURL(outBlob);
   const saved=saveMedia("audio",url,(item.prompt||"Обработанный голос"),"CleverUtils · "+label,"mp3");
   if(!saved)throw new Error("VOICE_SAVE_FAILED");
   renderVoiceLibrary();toast(label+" · готово");
 }catch(err){console.error("Miya voice tool failed",err);toast(String(err?.message||"Не удалось обработать аудио"))}
 finally{buttons.forEach(b=>b.disabled=false)}
}
async function pollCleverJobOutput(jobId){
 for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1800));const r=await fetch("https://cleverutils.com/api/v1/jobs/"+encodeURIComponent(jobId),{cache:"no-store"});const d=await r.json().catch(()=>({}));const j=d?.data||d;if(j?.status==="done")return j?.output?.url||j?.links?.output||"";if(j?.status==="error"||j?.status==="failed")throw new Error("VOICE_JOB_FAILED")}
 throw new Error("VOICE_JOB_TIMEOUT");
}
async function pollCleverJobJson(jobId){
 for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1800));const r=await fetch("https://cleverutils.com/api/v1/jobs/"+encodeURIComponent(jobId),{cache:"no-store"});const d=await r.json().catch(()=>({}));const j=d?.data||d;if(j?.status==="done")return j?.text||j?.result?.text||j?.output?.text||"";if(j?.status==="error"||j?.status==="failed")throw new Error("VOICE_JOB_FAILED")}
 throw new Error("VOICE_JOB_TIMEOUT");
}
function showVoiceRenameDialog(item,onDone){
 document.querySelector(".miya-rename-backdrop")?.remove();
 const backdrop=document.createElement("div");backdrop.className="miya-rename-backdrop";
 const box=document.createElement("section");box.className="miya-rename-dialog";box.setAttribute("role","dialog");box.setAttribute("aria-modal","true");
 box.innerHTML='<div class="miya-rename-eyebrow">MIYA VOICE</div><h3>Переименовать голос</h3><input class="miya-rename-input" type="text" maxlength="80" autocomplete="off"><div class="miya-rename-actions"><button type="button" class="miya-rename-cancel">Отмена</button><button type="button" class="miya-rename-save">Сохранить</button></div>';
 const input=box.querySelector(".miya-rename-input");input.value=String(item?.model||"Голос").trim()||"Голос";
 const close=()=>{backdrop.remove();document.body.classList.remove("miya-rename-open")};
 const save=()=>{const next=String(input.value||"").trim().slice(0,80);if(!next){input.focus();return}const items=getLibrary();const stored=items.find(x=>x?.id===item?.id);if(stored)stored.model=next;try{localStorage.setItem(LIB_KEY,JSON.stringify(items.slice(0,500)))}catch{}item.model=next;close();onDone?.(next);renderVoiceLibrary();toast("Голос переименован")};
 box.querySelector(".miya-rename-cancel").onclick=close;box.querySelector(".miya-rename-save").onclick=save;
 input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();save()}else if(e.key==="Escape"){e.preventDefault();close()}};
 backdrop.onclick=e=>{if(e.target===backdrop)close()};backdrop.append(box);document.body.appendChild(backdrop);document.body.classList.add("miya-rename-open");
 requestAnimationFrame(()=>{input.focus();input.select()});
}
function renameVoiceItem(item,onDone){showVoiceRenameDialog(item,onDone)}

function closeAllVoiceCardMenus(){document.querySelectorAll(".voice-card-menu").forEach(x=>x.remove())}
function createVoiceCard(item,source,options={}){
 ensureVoiceWallStyles();
 const card=document.createElement("article");card.className="voice-library-card";card.tabIndex=0;
 const title=document.createElement("b");title.className="voice-result-title";title.textContent=item?.model||"Голос";
 const textEl=document.createElement("div");textEl.className="voice-card-text";textEl.textContent=item?.prompt||"Готовая голосовая запись";
 const more=document.createElement("button");more.type="button";more.className="voice-editor-more media-action media-more";more.title="Действия";more.setAttribute("aria-label","Действия голоса");more.innerHTML='<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
 more.onclick=async e=>{e.preventDefault();e.stopPropagation();closeAllVoiceCardMenus();await openVoiceEditor(item,source)};

 const player=buildVoicePlayer(source,card);player.wrap.__cleanup=player.cleanup;
 const actions=document.createElement("div");actions.className="voice-card-actions";
 const quick=(name,label,path,fn)=>{const b=document.createElement("button");b.type="button";b.className="voice-card-action";b.dataset.voiceAction=name;b.title=label;b.setAttribute("aria-label",label);b.innerHTML=voiceIcon(path);b.onclick=e=>{e.stopPropagation();fn()};actions.appendChild(b);return b};
 quick("play","Прослушать",'<path d="M8 5v14l11-7z"/>',()=>{const p=player.audio;if(p.paused)player.wrap.querySelector(".voice-player-play")?.click();else p.pause()});
 quick("clean","Очистить шум",'<path d="M4 12h16M7 7h10M7 17h10"/>',()=>runVoiceCleverTool(item,card,"noise-reduction","Очистка голоса"));
 quick("text","Расшифровать",'<path d="M5 6h14M5 12h14M5 18h9"/>',()=>runVoiceCleverTool(item,card,"speech-to-text","Расшифровка",{format:"txt",language:document.querySelector("#voiceLanguage")?.value||"ru"}));
 quick("download","Скачать",'<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',()=>downloadVoiceSource(null,source));
 quick("delete","Удалить",'<path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13"/>',()=>confirmDeleteMedia(item,card));
 const date=document.createElement("div");date.className="voice-card-date";date.textContent=item?.createdAt?new Date(item.createdAt).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric"}):"";
 card.append(title,textEl,player.wrap,actions,date,more);
 if(!options.detail){const open=()=>openVoiceDetail(item,source,options.voiceItems||[],Number.isInteger(options.voiceIndex)?options.voiceIndex:-1);card.onclick=e=>{if(e.target.closest("button,input"))return;open()};card.onkeydown=e=>{if((e.key==="Enter"||e.key===" ")&&!e.target.closest("button,input")){e.preventDefault();open()}}} return card;
}
function openVoiceDetail(item,source,voiceItems=[],voiceIndex=-1){
 ensureVoiceWallStyles();document.querySelector(".voice-detail-backdrop")?.remove();document.body.classList.add("voice-modal-open");
 const backdrop=document.createElement("div");backdrop.className="voice-detail-backdrop";
 const dialog=document.createElement("section");dialog.className="voice-detail-dialog";dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");
 const head=document.createElement("div");head.className="voice-detail-head";
 const copy=document.createElement("div");const eyebrow=document.createElement("div");eyebrow.className="voice-detail-eyebrow";eyebrow.textContent="MIYA VOICE";const h=document.createElement("h3");h.textContent=item?.model||"Голос";copy.append(eyebrow,h);
 const close=document.createElement("button");close.type="button";close.className="voice-detail-close";close.title="Закрыть";close.setAttribute("aria-label","Закрыть редактор");close.title="Закрыть полноэкранный редактор";close.innerHTML='<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>';
 head.append(copy,close);
 const nav=document.createElement("div");nav.className="voice-detail-nav";
 const prev=document.createElement("button");prev.type="button";prev.className="voice-detail-nav-btn";prev.title="Предыдущий голос";prev.setAttribute("aria-label","Предыдущий голос");prev.innerHTML='<svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></svg>';
 const next=document.createElement("button");next.type="button";next.className="voice-detail-nav-btn";next.title="Следующий голос";next.setAttribute("aria-label","Следующий голос");next.innerHTML='<svg viewBox="0 0 24 24"><path d="m10 5 7 7-7 7"/></svg>';
 nav.append(prev,next);head.append(nav);
 const player=buildVoicePlayer(source,null);player.wrap.classList.add("voice-detail-player");player.wrap.style.width="min(520px,68vw)";player.wrap.style.margin="0 auto 10px";
 const detailActions=document.createElement("div");detailActions.className="voice-detail-actions";
 const dplay=document.createElement("button");dplay.type="button";dplay.className="voice-detail-action";dplay.innerHTML=voiceIcon('<path d="M8 5v14l11-7z"/>');dplay.title="Воспроизвести";dplay.onclick=()=>player.wrap.querySelector(".voice-player-play")?.click();
 const ddownload=document.createElement("button");ddownload.type="button";ddownload.className="voice-detail-action";ddownload.innerHTML=voiceIcon('<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>');ddownload.title="Скачать";ddownload.onclick=()=>downloadVoiceSource(null,source);
 const drename=document.createElement("button");drename.type="button";drename.className="voice-detail-action";drename.innerHTML=voiceIcon('<path d="m4 16.5-.8 3.3 3.3-.8L18.7 6.8a2.2 2.2 0 0 0 3.1-3.1L4 16.5Z"/><path d="m14.2 5.8 4 4"/>');drename.title="Переименовать";drename.onclick=()=>renameVoiceItem(item,nextName=>{h.textContent=nextName});
 const dedit=document.createElement("button");dedit.type="button";dedit.className="voice-detail-action";dedit.innerHTML=voiceIcon('<path d="m15 5 4 4M5 19l3.5-.7L18 9l-3-3-9.5 9.5L5 19Z"/>');dedit.title="Редактировать";dedit.onclick=()=>openVoiceEditor(item,source);
 const dnoise=document.createElement("button");dnoise.type="button";dnoise.className="voice-detail-action";dnoise.innerHTML=voiceIcon('<path d="M4 12h16M7 7h10M7 17h10"/>');dnoise.title="Очистить шум";dnoise.onclick=()=>runVoiceCleverTool(item,null,"noise-reduction","Очистка голоса");
 detailActions.append(dplay,ddownload,drename,dedit,dnoise);
 const text=document.createElement("div");text.className="voice-detail-copy";text.textContent=String(item?.prompt||"");
 const date=document.createElement("div");date.className="voice-detail-date";date.textContent=item?.createdAt?new Date(item.createdAt).toLocaleString("ru-RU",{day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}):"";
 dialog.append(head,player.wrap,detailActions,text,date);backdrop.append(dialog);document.body.appendChild(backdrop);
 const refreshNav=()=>{
   const valid=Array.isArray(voiceItems)&&voiceItems.length&&voiceIndex>=0;
   prev.disabled=!valid||voiceIndex<=0;
   next.disabled=!valid||voiceIndex>=voiceItems.length-1;
   prev.hidden=!valid;
   next.hidden=!valid;
 };
 const go=delta=>{
   if(!Array.isArray(voiceItems)||!voiceItems.length)return;
   const nextIndex=voiceIndex+delta;
   if(nextIndex<0||nextIndex>=voiceItems.length)return;
   const nextItem=voiceItems[nextIndex];
   player.cleanup();backdrop.remove();document.body.classList.remove("voice-modal-open");
   openVoiceDetail(nextItem,()=>resolveMediaUrl(nextItem),voiceItems,nextIndex);
 };
 refreshNav();
 prev.onclick=e=>{e.stopPropagation();go(-1)};
 next.onclick=e=>{e.stopPropagation();go(1)};
 const closeIt=()=>{player.cleanup();backdrop.remove();document.body.classList.remove("voice-modal-open");document.removeEventListener("keydown",onKey)};const onKey=e=>{if(e.key==="Escape")closeIt();else if(e.key==="ArrowLeft")go(-1);else if(e.key==="ArrowRight")go(1)};close.onclick=closeIt;backdrop.addEventListener("click",e=>{if(e.target===backdrop)closeIt()});document.addEventListener("keydown",onKey);
}
async function openVoiceEditor(item,source){
 ensureVoiceWallStyles();
 document.querySelector(".voice-editor-backdrop")?.remove();

 if(!document.getElementById("miyaVoiceEditorV2Styles")){
  const st=document.createElement("style");
  st.id="miyaVoiceEditorV2Styles";
  st.textContent=String.raw`
.voice-editor-backdrop{position:fixed!important;inset:0!important;width:100%!important;max-width:100%!important;height:100%!important;max-height:100%!important;box-sizing:border-box!important;padding:0!important;margin:0!important;background:rgba(3,8,18,.96)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;overflow:hidden!important;z-index:2147483647!important;display:block!important}
.voice-editor-backdrop .voice-editor-dialog.ve2{min-width:0!important;position:absolute!important;top:0!important;right:0!important;bottom:0!important;left:0!important;inset:0!important;width:100%!important;max-width:100%!important;height:100%!important;max-height:100%!important;box-sizing:border-box!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;overflow:hidden!important;display:grid!important;grid-template-rows:auto minmax(0,1fr) auto!important;gap:0!important;border:0!important;border-radius:0!important;background:linear-gradient(145deg,#091a2d 0%,#06111f 55%,#071525 100%)!important;box-shadow:0 35px 100px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.06)!important}
.ve2-head{min-width:0;overflow:hidden;min-height:76px;padding:15px 18px 14px 22px;display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid rgba(255,255,255,.075);background:linear-gradient(180deg,rgba(255,255,255,.035),transparent)}
.ve2-brand{display:flex;align-items:center;gap:12px;min-width:0}
.ve2-brand-mark{width:42px;height:42px;flex:0 0 42px;border-radius:14px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#b65cff,#695dff);box-shadow:0 10px 30px rgba(111,77,226,.30)}
.ve2-brand-mark svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ve2-eyebrow{font-size:9px;letter-spacing:.18em;font-weight:900;color:#b78dff;opacity:.9}
.ve2-title{margin:2px 0 0;font-size:clamp(18px,2vw,25px);font-weight:900;letter-spacing:-.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ve2-meta{font-size:10px;color:#7f93aa;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ve2-head-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.ve2-clear{min-height:42px;padding:0 13px;display:flex;align-items:center;gap:8px;border-radius:13px;border:1px solid rgba(255,91,116,.38);background:linear-gradient(135deg,rgba(255,64,96,.16),rgba(255,255,255,.035));color:#ffb0bc;font-weight:900;font-size:11px;cursor:pointer;transition:.16s}
.ve2-clear svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ve2-clear:hover{transform:translateY(-1px);background:rgba(255,64,96,.24);border-color:rgba(255,130,148,.68);color:#fff;box-shadow:0 12px 30px rgba(255,55,90,.14)}
.ve2-clear:disabled{opacity:.34;cursor:default;transform:none;box-shadow:none}
.ve2-close{width:42px;height:42px;border-radius:13px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.045);color:#aebed0;display:grid;place-items:center;cursor:pointer}
.ve2-close:hover{background:rgba(255,255,255,.09);color:#fff;border-color:rgba(190,154,255,.35)}
.ve2-close svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.ve2-body{min-width:0;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,300px);overflow:hidden}
.ve2-main{min-width:0;max-width:100%;min-height:0;overflow:auto;padding:18px 18px 16px}
.ve2-stage{border:1px solid rgba(255,255,255,.08);border-radius:22px;background:radial-gradient(circle at 50% 0%,rgba(155,111,255,.11),transparent 52%),rgba(255,255,255,.025);box-shadow:inset 0 1px 0 rgba(255,255,255,.03);padding:18px}
.ve2-fileline{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.ve2-fileline b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ve2-fileline span{font-size:9px;color:#70849a;white-space:nowrap}
.ve2-player{width:100%;margin:0}
.ve2-wavebox{position:relative;margin-top:16px;height:154px;border:1px solid rgba(164,126,255,.22);border-radius:18px;overflow:hidden;background:linear-gradient(180deg,rgba(11,26,45,.96),rgba(6,17,30,.98));cursor:crosshair}
.ve2-wave{position:absolute;inset:0;width:100%;height:100%}
.ve2-wave-selection{position:absolute;top:0;bottom:0;border-left:1px solid rgba(215,190,255,.78);border-right:1px solid rgba(215,190,255,.78);background:linear-gradient(90deg,rgba(163,115,255,.06),rgba(163,115,255,.16),rgba(163,115,255,.06));pointer-events:none}.ve2-playhead{position:absolute;top:0;bottom:0;width:2px;background:#fff;box-shadow:0 0 12px rgba(255,255,255,.5);pointer-events:none;transform:translateX(-1px)}
.ve2-playhead::before{content:"";position:absolute;top:0;left:50%;transform:translate(-50%,-2px);width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 12px rgba(183,140,255,.8)}
.ve2-wave-label{position:absolute;left:12px;top:10px;font-size:8px;letter-spacing:.14em;font-weight:900;color:#9f8bc4;pointer-events:none}
.ve2-transport{display:flex;align-items:center;gap:9px;margin-top:12px}
.ve2-play{width:44px;height:44px;border:0;border-radius:14px;background:linear-gradient(135deg,#b45cff,#6d5cff);color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 10px 24px rgba(108,72,211,.28)}
.ve2-play svg{width:19px;height:19px;fill:currentColor;stroke:none}
.ve2-time{font-size:11px;font-variant-numeric:tabular-nums;color:#b5c5d6;min-width:94px}
.ve2-transport-spacer{flex:1}
.ve2-transport-btn{height:34px;padding:0 10px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.045);color:#9fb0c3;font-size:10px;font-weight:900;cursor:pointer}
.ve2-transport-btn:hover{color:#fff;border-color:rgba(190,154,255,.35);background:rgba(157,111,255,.10)}
.ve2-upload{margin-top:14px;min-height:70px;display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px dashed rgba(174,132,255,.34);border-radius:17px;background:linear-gradient(135deg,rgba(157,111,255,.065),rgba(255,255,255,.018));cursor:pointer;transition:.16s}
.ve2-upload:hover,.ve2-upload.drag{border-color:rgba(195,164,255,.75);background:rgba(157,111,255,.12);box-shadow:0 14px 32px rgba(73,43,140,.12)}
.ve2-plus{width:44px;height:44px;flex:0 0 44px;border-radius:13px;border:1px solid rgba(192,155,255,.40);background:rgba(157,111,255,.10);color:#dccaff;display:grid;place-items:center}
.ve2-plus svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.ve2-upload b{display:block;font-size:11px;font-weight:900}.ve2-upload span{display:block;margin-top:3px;font-size:9px;color:#71859c}
.ve2-side{min-width:0;max-width:100%;min-height:0;overflow:auto;padding:14px;border-left:1px solid rgba(255,255,255,.075);background:rgba(0,0,0,.12)}
.ve2-section{padding:12px;border:1px solid rgba(255,255,255,.075);border-radius:17px;background:rgba(255,255,255,.032);margin-bottom:10px}
.ve2-section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.ve2-section-title b{font-size:11px;font-weight:900}.ve2-section-title span{font-size:8px;color:#71859a;letter-spacing:.08em;text-transform:uppercase}
.ve2-tools{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.ve2-tool{min-height:76px;padding:10px 9px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.02));color:#aebed0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:7px;text-align:left;cursor:pointer;transition:.16s}
.ve2-tool svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ve2-tool strong{font-size:10px;font-weight:900}.ve2-tool small{font-size:8px;color:#687e96;line-height:1.2}
.ve2-tool:hover{transform:translateY(-1px);border-color:rgba(190,154,255,.40);background:linear-gradient(145deg,rgba(157,111,255,.14),rgba(255,255,255,.03));color:#fff;box-shadow:0 10px 24px rgba(70,42,130,.13)}
.ve2-tool.active{border-color:rgba(190,154,255,.56);background:linear-gradient(145deg,rgba(169,92,255,.20),rgba(110,99,255,.13));color:#f0e6ff}
.ve2-panel{padding:12px;border:1px solid rgba(185,145,255,.16);border-radius:15px;background:rgba(150,110,255,.055)}
.ve2-panel h4{margin:0 0 4px;font-size:11px}.ve2-panel p{margin:0 0 10px;font-size:9px;color:#71859a;line-height:1.4}
.ve2-range-row{display:grid;grid-template-columns:52px 1fr 42px;align-items:center;gap:8px;margin:8px 0}.ve2-range-row label{font-size:9px;color:#9aacc0}.ve2-range-row output{font-size:9px;text-align:right;color:#c7d4e1;font-variant-numeric:tabular-nums}
.ve2-range{width:100%;accent-color:#a96cff}
.ve2-apply{width:100%;height:36px;border:0;border-radius:11px;background:linear-gradient(135deg,#a95cff,#6e63ff);color:#fff;font-size:10px;font-weight:900;cursor:pointer;margin-top:8px}
.ve2-apply:disabled{opacity:.45;cursor:wait}
.ve2-note{font-size:8px;color:#667c93;line-height:1.4;margin-top:8px}
.ve2-results{display:grid;gap:8px;margin-top:10px}
.ve2-result{padding:10px;border:1px solid rgba(255,255,255,.075);border-radius:13px;background:rgba(255,255,255,.025)}
.ve2-result-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.ve2-result-head b{font-size:10px}.ve2-result-save{width:30px;height:30px;border-radius:9px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.045);color:#aebed0;display:grid;place-items:center;cursor:pointer}.ve2-result-save:hover{color:#fff;border-color:rgba(190,154,255,.4)}
.ve2-result-save svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.ve2-result audio{width:100%;height:34px}
.ve2-footer{min-width:0;overflow:hidden;min-height:70px;padding:12px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid rgba(255,255,255,.075);background:rgba(4,12,22,.72)}
.ve2-footer-note{font-size:9px;color:#71859a;line-height:1.35}.ve2-footer-actions{display:flex;gap:8px}.ve2-footer-btn{height:40px;padding:0 15px;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.045);color:#b5c5d6;font-size:10px;font-weight:900;cursor:pointer}.ve2-footer-btn.primary{border:0;background:linear-gradient(135deg,#a95cff,#6e63ff);color:#fff;box-shadow:0 10px 25px rgba(104,66,210,.22)}.ve2-footer-btn:disabled{opacity:.38;cursor:default;box-shadow:none}
.ve2-name{width:100%;height:34px;padding:0 10px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.04);color:#d6e0ea;outline:none;font-size:10px}.ve2-name:focus{border-color:rgba(190,154,255,.48);box-shadow:0 0 0 3px rgba(157,111,255,.09)}
html.light .voice-editor-backdrop,body.light .voice-editor-backdrop{background:#eef1f5!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
html.light .voice-editor-dialog.ve2,body.light .voice-editor-dialog.ve2{background:#f7f9fc!important;border-color:#dbe4ee!important;color:#273047!important;box-shadow:0 24px 70px rgba(40,55,80,.12)!important}
html.light .ve2-body,body.light .ve2-body{background:#f2f5f9!important}
html.light .voice-editor-backdrop.ve2-light .voice-editor-dialog.ve2,body.light .voice-editor-backdrop.ve2-light .voice-editor-dialog.ve2{background:#f7f9fc!important;color:#273047!important}
html.light .voice-editor-backdrop.ve2-light .ve2-head,body.light .voice-editor-backdrop.ve2-light .ve2-head{background:#fff!important}
html.light .voice-editor-backdrop.ve2-light .ve2-footer,body.light .voice-editor-backdrop.ve2-light .ve2-footer{background:#fff!important}
html.light .voice-editor-backdrop.ve2-light .ve2-stage,body.light .voice-editor-backdrop.ve2-light .ve2-stage{background:#fff!important}
html.light .voice-editor-backdrop.ve2-light .ve2-section,body.light .voice-editor-backdrop.ve2-light .ve2-section{background:#fff!important}
html.light .voice-editor-backdrop.ve2-light .ve2-wavebox,body.light .voice-editor-backdrop.ve2-light .ve2-wavebox{background:linear-gradient(180deg,#f8fafc,#eef2f6)!important}
.voice-editor-backdrop.ve2-light{background:#eef1f5!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
.voice-editor-backdrop.ve2-light .voice-editor-dialog.ve2{background:#f7f9fc!important;color:#273047!important;box-shadow:0 24px 70px rgba(40,55,80,.12)!important}
.voice-editor-backdrop.ve2-light .ve2-head,.voice-editor-backdrop.ve2-light .ve2-footer{background:#fff!important;border-color:#dbe4ee!important}
.voice-editor-backdrop.ve2-light .ve2-main,.voice-editor-backdrop.ve2-light .ve2-side,.voice-editor-backdrop.ve2-light .ve2-body{background:#f2f5f9!important;color:#273047!important}
.voice-editor-backdrop.ve2-light .ve2-stage,.voice-editor-backdrop.ve2-light .ve2-section,.voice-editor-backdrop.ve2-light .ve2-result{background:#fff!important;border-color:#dbe4ee!important;box-shadow:0 8px 28px rgba(55,70,95,.05)}
.voice-editor-backdrop.ve2-light .ve2-wavebox{background:linear-gradient(180deg,#f8fafc,#eef2f6)!important;border-color:#d4deea!important}
.voice-editor-backdrop.ve2-light .ve2-wave-label{color:#7d6aa5}
.voice-editor-backdrop.ve2-light .ve2-time{color:#52657b}
.voice-editor-backdrop.ve2-light .ve2-transport-btn,.voice-editor-backdrop.ve2-light .ve2-tool,.voice-editor-backdrop.ve2-light .ve2-footer-btn,.voice-editor-backdrop.ve2-light .ve2-result-save{background:#f4f7fa;color:#52657b;border-color:#d3deea}
.voice-editor-backdrop.ve2-light .ve2-tool:hover,.voice-editor-backdrop.ve2-light .ve2-result-save:hover,.voice-editor-backdrop.ve2-light .ve2-close:hover{background:#eeeaff;color:#493b70;border-color:#bfaee0}
.voice-editor-backdrop.ve2-light .ve2-tool.active{background:linear-gradient(145deg,#f0e7ff,#eeeaff);color:#5d438e;border-color:#bfaee0}
.voice-editor-backdrop.ve2-light .ve2-upload{background:linear-gradient(135deg,#faf9ff,#fff)!important;border-color:#cfc2eb!important}
.voice-editor-backdrop.ve2-light .ve2-upload b,.voice-editor-backdrop.ve2-light .ve2-fileline b,.voice-editor-backdrop.ve2-light .ve2-title,.voice-editor-backdrop.ve2-light .ve2-section-title b,.voice-editor-backdrop.ve2-light .ve2-tool strong,.voice-editor-backdrop.ve2-light .ve2-panel h4{color:#273047}
.voice-editor-backdrop.ve2-light .ve2-upload span,.voice-editor-backdrop.ve2-light .ve2-meta,.voice-editor-backdrop.ve2-light .ve2-tool small,.voice-editor-backdrop.ve2-light .ve2-panel p,.voice-editor-backdrop.ve2-light .ve2-note,.voice-editor-backdrop.ve2-light .ve2-footer-note{color:#71839a}
.voice-editor-backdrop.ve2-light .ve2-name{background:#fff;color:#273047;border-color:#d3deea}
.voice-editor-backdrop.ve2-light .ve2-panel{background:#faf8ff;border-color:#ddd1ef}
.voice-editor-backdrop.ve2-light .ve2-result audio{background:#fff}
.voice-editor-backdrop.ve2-light .ve2-clear{background:linear-gradient(135deg,#fff0f2,#fff)!important;color:#d34e68;border-color:#edc3cc}
.voice-editor-backdrop.ve2-light .ve2-close{background:#f4f7fa;color:#52657b;border-color:#d3deea}
.voice-editor-backdrop.ve2-light .ve2-playhead,.voice-editor-backdrop.ve2-light .ve2-playhead::before{background:#6e63ff;box-shadow:0 0 10px rgba(110,99,255,.28)}

html.light .ve2-main,body.light .ve2-main{background:#f2f5f9!important;color:#273047!important}
html.light .ve2-side,body.light .ve2-side{background:#f2f5f9!important;color:#273047!important}
body.light .ve2-head,body.light .ve2-footer{background:#fff!important;border-color:#dbe4ee!important}
body.light .ve2-side{background:#f2f5f9!important;border-color:#dbe4ee!important}
body.light .ve2-main{background:#f2f5f9}
body.light .ve2-stage,body.light .ve2-section,body.light .ve2-result{background:#fff!important;border-color:#dbe4ee!important;box-shadow:0 8px 28px rgba(55,70,95,.05)}
body.light .ve2-wavebox{background:linear-gradient(180deg,#f8fafc,#eef2f6)!important;border-color:#d4deea!important}
body.light .ve2-wave-label{color:#7d6aa5}
body.light .ve2-playhead{background:#6e63ff;box-shadow:0 0 10px rgba(110,99,255,.28)}
body.light .ve2-playhead::before{background:#6e63ff;box-shadow:0 0 10px rgba(110,99,255,.24)}
body.light .ve2-time{color:#52657b}
body.light .ve2-transport-btn{background:#f4f7fa;color:#52657b;border-color:#d3deea}
body.light .ve2-upload{background:linear-gradient(135deg,#faf9ff,#fff)!important;border-color:#cfc2eb!important}
body.light .ve2-upload b,body.light .ve2-fileline b{color:#273047}
body.light .ve2-upload span,body.light .ve2-meta,body.light .ve2-tool small,body.light .ve2-panel p,body.light .ve2-note,body.light .ve2-footer-note{color:#71839a}
body.light .ve2-title,body.light .ve2-section-title b,body.light .ve2-tool strong,body.light .ve2-panel h4{color:#273047}
body.light .ve2-tool,body.light .ve2-transport-btn,body.light .ve2-footer-btn,body.light .ve2-result-save{background:#f4f7fa;color:#52657b;border-color:#d3deea}
body.light .ve2-tool:hover,body.light .ve2-result-save:hover{background:#eeeaff;color:#493b70;border-color:#bfaee0}
body.light .ve2-tool.active{background:linear-gradient(145deg,#f0e7ff,#eeeaff);color:#5d438e;border-color:#bfaee0}
body.light .ve2-name{background:#fff;color:#273047;border-color:#d3deea}
body.light .ve2-panel{background:#faf8ff;border-color:#ddd1ef}
body.light .ve2-result audio{background:#fff}
body.light .ve2-clear{background:linear-gradient(135deg,#fff0f2,#fff)!important;color:#d34e68;border-color:#edc3cc}
body.light .ve2-close{background:#f4f7fa;color:#52657b;border-color:#d3deea}
body.light .ve2-close:hover{background:#eeeaff;color:#493b70}
body.light .ve2-footer-btn.primary{color:#fff}
@media(max-width:900px){.voice-editor-dialog.ve2{width:100vw!important;height:100vh!important}.ve2-body{grid-template-columns:1fr}.ve2-side{border-left:0;border-top:1px solid rgba(255,255,255,.075);max-height:44vh}.ve2-main{overflow:auto}}
@media(max-width:560px){.voice-editor-dialog.ve2{border-radius:0!important}.ve2-head{padding:12px}.ve2-clear{width:42px;padding:0;justify-content:center}.ve2-clear span{display:none}.ve2-stage{padding:12px}.ve2-wavebox{height:125px}.ve2-footer-note{display:none}.ve2-footer{justify-content:flex-end}.ve2-tools{grid-template-columns:1fr 1fr}}
`;
  document.head.appendChild(st);
 }

 const backdrop=document.createElement("div");
 backdrop.className="voice-editor-backdrop";
 backdrop.classList.toggle("ve2-light",document.body.classList.contains("light"));backdrop.style.cssText="position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;z-index:2147483647!important;"
 document.documentElement.classList.add("miya-editor-page-open");
 document.body.classList.add("miya-editor-page-open");
 const previousBodyOverflow=document.body.style.overflow;
 document.body.style.overflow="hidden";
 const dialog=document.createElement("section");
 dialog.className="voice-editor-dialog ve2";
 dialog.setAttribute("role","dialog");
 dialog.setAttribute("aria-modal","true");

 const head=document.createElement("header");
 head.className="ve2-head";
 const brand=document.createElement("div");
 brand.className="ve2-brand";
 brand.innerHTML='<div class="ve2-brand-mark"><svg viewBox="0 0 24 24"><path d="M4 9v6M8 6v12M12 3v18M16 6v12M20 9v6"/></svg></div><div style="min-width:0"><div class="ve2-eyebrow">MIYA AUDIO STUDIO</div><div class="ve2-title">'+String(item?.model||"Голос").replace(/[&<>"\']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"}[m]))+'</div><div class="ve2-meta">Неразрушающее редактирование · оригинальная карточка остаётся на стене</div></div>';
 const headActions=document.createElement("div");headActions.className="ve2-head-actions";
 const clearBtn=document.createElement("button");clearBtn.type="button";clearBtn.className="ve2-clear";clearBtn.title="Убрать текущую запись только из редактора. Оригинальная карточка останется без изменений.";clearBtn.innerHTML='<svg viewBox="0 0 24 24"><path d="M7 7h10M9 4h6l1 3H8l1-3Z"/><path d="M9 11v6M15 11v6M5 7l1 13h12l-1-13"/><path d="m4 20 16-16"/></svg><span>Убрать запись</span>';
 const close=document.createElement("button");close.type="button";close.className="ve2-close";close.title="Закрыть";close.setAttribute("aria-label","Закрыть");close.innerHTML='<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>';
 headActions.append(clearBtn,close);head.append(brand,headActions);

 const body=document.createElement("div");body.className="ve2-body";
 const main=document.createElement("main");main.className="ve2-main";
 const stage=document.createElement("section");stage.className="ve2-stage";
 const fileline=document.createElement("div");fileline.className="ve2-fileline";
 const nameInput=document.createElement("input");nameInput.className="ve2-name";nameInput.placeholder="Название нового голоса";nameInput.value=String(item?.prompt||item?.model||"Мой голос").slice(0,80);
 const fileMeta=document.createElement("span");fileMeta.textContent="Исходник";
 fileline.append(nameInput,fileMeta);
 const waveBox=document.createElement("div");waveBox.className="ve2-wavebox";
 waveBox.innerHTML='<canvas class="ve2-wave"></canvas><div class="ve2-wave-selection"></div><div class="ve2-playhead"></div><div class="ve2-wave-label">AUDIO WAVEFORM</div>';
 const transport=document.createElement("div");transport.className="ve2-transport";
 const playBtn=document.createElement("button");playBtn.type="button";playBtn.className="ve2-play";playBtn.setAttribute("aria-label","Воспроизвести");playBtn.title="Воспроизвести или поставить запись на паузу";playBtn.innerHTML='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7Z"/></svg>';
 const timeLabel=document.createElement("span");timeLabel.className="ve2-time";timeLabel.textContent="0:00 / 0:00";
 const spacer=document.createElement("div");spacer.className="ve2-transport-spacer";
 const backBtn=document.createElement("button");backBtn.type="button";backBtn.className="ve2-transport-btn";backBtn.textContent="− 5 сек";backBtn.title="Перемотать воспроизведение назад на 5 секунд";
 const fwdBtn=document.createElement("button");fwdBtn.type="button";fwdBtn.className="ve2-transport-btn";fwdBtn.textContent="+ 5 сек";fwdBtn.title="Перемотать воспроизведение вперёд на 5 секунд";
 transport.append(playBtn,timeLabel,spacer,backBtn,fwdBtn);
 const upload=document.createElement("div");upload.className="ve2-upload";
 upload.title="Заменить рабочий аудиофайл. Исходная карточка на стене не изменится";upload.innerHTML='<button type="button" class="ve2-plus" aria-label="Добавить аудио"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button><div><b>Заменить исходник</b><span>Перетащи MP3, WAV, M4A или FLAC сюда · оригинальная карточка не изменится</span></div>';
 stage.append(fileline,waveBox,transport,upload);
 main.append(stage);

 const side=document.createElement("aside");side.className="ve2-side";
 const toolsSection=document.createElement("section");toolsSection.className="ve2-section";
 const toolsTitle=document.createElement("div");toolsTitle.className="ve2-section-title";toolsTitle.innerHTML='<b>Инструменты</b><span>WORKFLOW</span>';
 const tools=document.createElement("div");tools.className="ve2-tools";
 const panel=document.createElement("div");panel.className="ve2-panel";
 toolsSection.append(toolsTitle,tools,panel);side.append(toolsSection);

 const resultsBox=document.createElement("section");resultsBox.className="ve2-section";resultsBox.hidden=true;
 const resultsTitle=document.createElement("div");resultsTitle.className="ve2-section-title";resultsTitle.innerHTML='<b>Результаты</b><span>STEMS</span>';
 const results=document.createElement("div");results.className="ve2-results";resultsBox.append(resultsTitle,results);side.append(resultsBox);
 body.append(main,side);

 const footer=document.createElement("footer");footer.className="ve2-footer";
 const footerNote=document.createElement("div");footerNote.className="ve2-footer-note";footerNote.textContent="Все изменения остаются только в редакторе до сохранения как нового голоса.";
 const footerActions=document.createElement("div");footerActions.className="ve2-footer-actions";
 const closeBtn=document.createElement("button");closeBtn.type="button";closeBtn.className="ve2-footer-btn";closeBtn.textContent="Закрыть";closeBtn.title="Закрыть редактор без изменения исходной карточки";
 const saveBtn=document.createElement("button");saveBtn.type="button";saveBtn.className="ve2-footer-btn primary";saveBtn.textContent="Сохранить как новый голос";saveBtn.title="Сохранить текущую обработанную запись отдельным новым голосом";
 footerActions.append(closeBtn,saveBtn);footer.append(footerNote,footerActions);
 dialog.append(head,body,footer);backdrop.append(dialog);document.documentElement.appendChild(backdrop);document.body.classList.add("voice-modal-open");
 const composer=document.getElementById("composer");
 const previousComposerDisplay=composer?.style.display||"";
 if(composer)composer.style.display="none";

 let workingUrl=null,workingBlob=null,workingName=(String(item?.prompt||"").trim()||"miya-voice.mp3"),dirty=false;
 let audio=null,waveData=null,duration=0,trimStart=0,trimEnd=0,volume=1,stemResults=null;
 const cleanupUrl=u=>{if(u?.startsWith("blob:"))try{URL.revokeObjectURL(u)}catch{}};
 const formatTime=v=>{const x=Math.max(0,Number(v)||0),m=Math.floor(x/60),s=Math.floor(x%60);return m+":"+String(s).padStart(2,"0")};
 const svg=path=>'<svg viewBox="0 0 24 24">'+path+"</svg>";
 const setPlayIcon=playing=>{playBtn.innerHTML=playing?'<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7Z"/></svg>';playBtn.setAttribute("aria-label",playing?"Пауза":"Воспроизвести")};
 const setStatus=msg=>{fileMeta.textContent=msg||"Исходник"};
 const sync=()=>{const has=Boolean(workingBlob&&workingUrl);clearBtn.disabled=!has;saveBtn.disabled=!has||!dirty;saveBtn.textContent=dirty?"Сохранить как новый голос":"Изменений нет · сохранение недоступно"};
 const drawWave=()=>{
  const canvas=waveBox.querySelector(".ve2-wave");if(!canvas)return;
  const rect=waveBox.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(320,Math.floor(rect.width*dpr)),h=Math.max(120,Math.floor(rect.height*dpr));
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d");ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="rgba(255,255,255,.035)";ctx.lineWidth=1;
  for(let i=1;i<8;i++){const y=i*h/8;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  if(!waveData?.length){return}
  const bars=Math.min(220,Math.max(80,Math.floor(w/4))), step=waveData.length/bars;
  const activeL=trimStart/Math.max(.001,duration)*w,activeR=trimEnd/Math.max(.001,duration)*w;
  for(let i=0;i<bars;i++){let max=0;const a=Math.floor(i*step),b=Math.min(waveData.length,Math.floor((i+1)*step));for(let j=a;j<b;j++)max=Math.max(max,waveData[j]);const x=i*(w/bars),bh=Math.max(3,max*(h*.72));ctx.fillStyle=(x>=activeL&&x<=activeR)?"rgba(184,141,255,.88)":"rgba(103,125,151,.34)";ctx.beginPath();ctx.roundRect(x+1,(h-bh)/2,Math.max(1,w/bars-2),bh,3);ctx.fill()}
  const sel=waveBox.querySelector(".ve2-wave-selection"),ph=waveBox.querySelector(".ve2-playhead");if(sel){sel.style.left=(activeL/dpr)+"px";sel.style.width=Math.max(0,(activeR-activeL)/dpr)+"px"}if(ph){const cur=audio?.currentTime||0;ph.style.left=(cur/Math.max(.001,duration))*100+"%"}
 };
 const decodeWave=async()=>{
  if(!workingBlob)return;
  try{
   const ctx=new (window.AudioContext||window.webkitAudioContext)();
   const buffer=await ctx.decodeAudioData(await workingBlob.arrayBuffer());
   await ctx.close();
   duration=buffer.duration;trimStart=0;trimEnd=duration;
   const data=buffer.getChannelData(0),samples=Math.min(16000,data.length),step=data.length/samples;waveData=new Float32Array(samples);
   for(let i=0;i<samples;i++){let m=0,a=Math.floor(i*step),b=Math.min(data.length,Math.floor((i+1)*step));for(let j=a;j<b;j++)m=Math.max(m,Math.abs(data[j]));waveData[i]=m}
   drawWave();timeLabel.textContent=formatTime(0)+" / "+formatTime(duration);setStatus(formatTime(duration)+" · исходник");
  }catch{waveData=null;duration=0;trimStart=trimEnd=0;drawWave();setStatus("Файл загружен · waveform недоступен")}
 };
 const updatePlayhead=()=>{if(audio){timeLabel.textContent=formatTime(audio.currentTime)+" / "+formatTime(duration);drawWave();if(!audio.paused)requestAnimationFrame(updatePlayhead)}};
 const stopAudio=()=>{if(audio){try{audio.pause()}catch{}audio=null}setPlayIcon(false);drawWave()};
 const play=async()=>{if(!workingUrl)return;if(!audio||audio.src!==workingUrl){stopAudio();audio=new Audio(workingUrl);audio.volume=volume;audio.ontimeupdate=()=>{if(audio.currentTime>trimEnd+.02){audio.currentTime=trimStart}};audio.onended=()=>setPlayIcon(false);audio.onplay=()=>{setPlayIcon(true);updatePlayhead()};audio.onpause=()=>setPlayIcon(false)}if(audio.paused){if(audio.currentTime<trimStart||audio.currentTime>=trimEnd)audio.currentTime=trimStart;await audio.play()}else audio.pause()};
 const seekFromWave=e=>{if(!duration)return;const r=waveBox.getBoundingClientRect();const t=Math.max(0,Math.min(duration,(e.clientX-r.left)/r.width*duration));if(audio)audio.currentTime=t;drawWave();timeLabel.textContent=formatTime(t)+" / "+formatTime(duration)};
 waveBox.addEventListener("click",seekFromWave);
 playBtn.onclick=play;
 backBtn.onclick=()=>{if(audio)audio.currentTime=Math.max(trimStart,audio.currentTime-5);drawWave()};
 fwdBtn.onclick=()=>{if(audio)audio.currentTime=Math.min(trimEnd,audio.currentTime+5);drawWave()};
 window.addEventListener("resize",drawWave);

 const trimPanel=()=>{
  panel.innerHTML='<h4>Обрезка</h4><p>Выбери начало и конец. Оригинальная карточка останется нетронутой.</p><div class="ve2-range-row"><label>Начало</label><input class="ve2-range" id="veTrimStart" type="range" min="0" max="1" step=".01" value="0"><output id="veTrimStartOut">0:00</output></div><div class="ve2-range-row"><label>Конец</label><input class="ve2-range" id="veTrimEnd" type="range" min="0" max="1" step=".01" value="1"><output id="veTrimEndOut">0:00</output></div><button class="ve2-apply" id="veTrimApply">Применить обрезку</button><div class="ve2-note">Можно точно подогнать выделение по waveform кликом для предпросмотра.</div>';
  const a=panel.querySelector("#veTrimStart"),b=panel.querySelector("#veTrimEnd"),ao=panel.querySelector("#veTrimStartOut"),bo=panel.querySelector("#veTrimEndOut");
  a.max=String(Math.max(.01,duration));b.max=String(Math.max(.01,duration));a.value=String(trimStart);b.value=String(trimEnd);ao.textContent=formatTime(trimStart);bo.textContent=formatTime(trimEnd);
  a.oninput=()=>{trimStart=Math.min(Number(a.value),Math.max(0,trimEnd-.05));a.value=trimStart;ao.textContent=formatTime(trimStart);drawWave()};
  b.oninput=()=>{trimEnd=Math.max(Number(b.value),Math.min(duration,trimStart+.05));b.value=trimEnd;bo.textContent=formatTime(trimEnd);drawWave()};
  panel.querySelector("#veTrimApply").onclick=()=>processClientAudio("trim");
 };
 const volumePanel=()=>{
  panel.innerHTML='<h4>Громкость</h4><p>Измени громкость и запиши результат прямо в рабочий файл.</p><div class="ve2-range-row"><label>Уровень</label><input class="ve2-range" id="veVol" type="range" min="0" max="200" value="'+Math.round(volume*100)+'"><output id="veVolOut">'+Math.round(volume*100)+'%</output></div><button class="ve2-apply" id="veVolApply">Применить громкость</button>';
  const r=panel.querySelector("#veVol"),o=panel.querySelector("#veVolOut");r.oninput=()=>{volume=Number(r.value)/100;o.textContent=r.value+"%";if(audio)audio.volume=volume};panel.querySelector("#veVolApply").onclick=()=>processClientAudio("volume");
 };
 const normalizePanel=()=>{
  panel.innerHTML='<h4>Нормализация</h4><p>Подтяни тихую запись к ровному уровню без внешнего API.</p><button class="ve2-apply" id="veNormApply">Нормализовать голос</button><div class="ve2-note">Обработка выполняется локально в браузере.</div>';panel.querySelector("#veNormApply").onclick=()=>processClientAudio("normalize");
 };
 const noisePanel=()=>{panel.innerHTML='<h4>Очистить шум</h4><p>AI-очистка речи через текущий CleverUtils-инструмент.</p><button class="ve2-apply" id="veNoiseApply">Запустить очистку</button><div class="ve2-note">Результат заменит только рабочий файл редактора.</div>';panel.querySelector("#veNoiseApply").onclick=runNoise};
 const splitPanel=()=>{panel.innerHTML='<h4>Разделить вокал</h4><p>Получить отдельные дорожки: вокал и инструментал.</p><button class="ve2-apply" id="veSplitApply">Разделить на 2 дорожки</button><div class="ve2-note">Результаты можно сохранить отдельными голосовыми файлами.</div>';panel.querySelector("#veSplitApply").onclick=runSplit};
 const showSplitProgress=(percent,title,detail)=>{
   panel.innerHTML='<div class="generation-loading voice-split-loading" style="display:block;margin:10px 0;padding:22px;border-radius:22px"><div class="generation-progress"><div class="progress-circle is-active"><span class="progress-percent">'+Math.max(1,Math.min(99,Math.round(percent)))+'%</span></div><div class="progress-copy"><b>'+title+'</b><span class="progress-model">CleverUtils · Demucs · '+detail+'</span></div></div><div class="generation-progress-bar"><span style="width:'+Math.max(1,Math.min(99,Math.round(percent)))+'%"></span></div><div style="margin-top:12px;font-size:12px;line-height:1.45;opacity:.68">Разделяем вокал и инструментал. Результат появится здесь после завершения.</div></div>';
 };
 const updateSplitProgress=(percent,title,detail)=>{
   const box=panel.querySelector(".voice-split-loading");if(!box)return;
   const v=Math.max(1,Math.min(99,Math.round(percent)));const p=box.querySelector(".progress-percent"),bar=box.querySelector(".generation-progress-bar span"),b=box.querySelector(".progress-copy b"),m=box.querySelector(".progress-model");
   if(p)p.textContent=v+"%";if(bar)bar.style.width=v+"%";if(b)b.textContent=title;if(m)m.textContent="CleverUtils · Demucs · "+detail;
 };
 const convertPanel=()=>{panel.innerHTML='<h4>Преобразовать</h4><p>Сделать совместимую WAV-копию текущего рабочего файла.</p><button class="ve2-apply" id="veWavApply">Преобразовать в WAV</button><div class="ve2-note">WAV удобен для дальнейшего редактирования и сохраняется как новый голос.</div>';panel.querySelector("#veWavApply").onclick=()=>processClientAudio("wav")};

 const tool=(id,label,sub,path,fn)=>{const b=document.createElement("button");b.type="button";b.className="ve2-tool";b.dataset.tool=id;b.innerHTML=svg(path)+"<strong>"+label+"</strong><small>"+sub+"</small>";b.onclick=()=>{tools.querySelectorAll(".ve2-tool").forEach(x=>x.classList.remove("active"));b.classList.add("active");fn()};tools.append(b);return b};
 tool("trim","Обрезать","Точно по времени",'<path d="M6 5v14M18 5v14M3 9h6M15 15h6"/>',trimPanel);
 tool("noise","Очистить шум","AI · речь",'<path d="M4 12h16M7 7h10M7 17h10"/><path d="M12 4v16"/>',noisePanel);
 tool("split","Разделить вокал","Вокал + минус",'<path d="M5 5l14 14M19 5 5 19"/><path d="M5 12h5M14 12h5"/>',splitPanel);
 tool("volume","Громкость","Уровень записи",'<path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',volumePanel);
 tool("normalize","Нормализовать","Сделать ровнее",'<path d="M4 12h3l2-6 4 12 2-6h5"/>',normalizePanel);
 tool("convert","WAV","Совместимый формат",'<path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5"/>',convertPanel);
 tools.querySelector(".ve2-tool")?.click();

 const setWorkingBlob=async(blob,name=null)=>{
  stopAudio();cleanupUrl(workingUrl);workingBlob=blob;workingUrl=URL.createObjectURL(blob);if(name)workingName=name;dirty=true;nameInput.value=workingName.replace(/\.[^.]+$/,"");await decodeWave();renderPlayer();sync();
 };
 const processClientAudio=async(kind)=>{
  if(!workingBlob||!duration)return;
  const apply=panel.querySelector(".ve2-apply");if(apply){apply.disabled=true;apply.textContent="Обрабатываю…"}
  try{
   const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)throw new Error("Браузер не поддерживает аудиообработку");
   const ctx=new AudioContextClass();const buffer=await ctx.decodeAudioData(await workingBlob.arrayBuffer());await ctx.close();
   let start=0,end=buffer.duration;if(kind==="trim"){start=Math.max(0,Math.min(buffer.duration,trimStart));end=Math.max(start+.02,Math.min(buffer.duration,trimEnd))}
   const rate=buffer.sampleRate,channels=buffer.numberOfChannels,frames=Math.max(1,Math.floor((end-start)*rate));
   const outCtx=new OfflineAudioContext(channels,frames,rate);const sourceNode=outCtx.createBufferSource();const outBuffer=outCtx.createBuffer(channels,frames,rate);
   if(kind==="normalize"||kind==="volume"||kind==="wav"||kind==="trim"){
    const gainNode=outCtx.createGain();gainNode.gain.value=kind==="volume"?volume:1;sourceNode.buffer=buffer;sourceNode.connect(gainNode);gainNode.connect(outCtx.destination);sourceNode.start(0,start,frames/rate);const rendered=await outCtx.startRendering();
    let finalBuffer=rendered;
    if(kind==="normalize"){let peak=0;for(let ch=0;ch<rendered.numberOfChannels;ch++){const d=rendered.getChannelData(ch);for(let i=0;i<d.length;i++)peak=Math.max(peak,Math.abs(d[i]))}if(peak>.0001){const g=Math.min(4,.96/peak);for(let ch=0;ch<rendered.numberOfChannels;ch++){const d=rendered.getChannelData(ch);for(let i=0;i<d.length;i++)d[i]*=g}}finalBuffer=rendered}
    const blob=audioBufferToWavBlob(finalBuffer);const base=String(workingName||"miya-voice").replace(/\.[^.]+$/,"");await setWorkingBlob(blob,base+".wav");toast(kind==="trim"?"Обрезка применена":kind==="normalize"?"Голос нормализован":kind==="volume"?"Громкость применена":"Готово · WAV создан");
   }
  }catch(e){console.error("Miya local audio processing failed",e);toast(String(e?.message||"Не удалось обработать аудио"))}
  finally{if(apply){apply.disabled=false;apply.textContent="Применить"}}
 };

 const makeAudioUploadFile=()=>{if(!workingBlob)throw new Error("AUDIO_FILE_MISSING");let name=String(workingName||"miya-audio");if(!/\.[a-z0-9]{2,5}$/i.test(name)){const t=String(workingBlob.type||"audio/mpeg").toLowerCase();name+="."+ (t.includes("wav")?"wav":t.includes("flac")?"flac":t.includes("mp4")||t.includes("m4a")?"m4a":"mp3")}const type=workingBlob.type&&workingBlob.type.startsWith("audio/")?workingBlob.type:"audio/mpeg";return new File([workingBlob],name,{type})};

 const runNoise=async()=>{
  if(!workingBlob)return;const b=panel.querySelector(".ve2-apply");if(b){b.disabled=true;b.textContent="Очищаю…"}
  try{
   const form=new FormData();form.append("file",makeAudioUploadFile());
   const rr=await fetch("https://cleverutils.com/api/v1/tools/noise-reduction",{method:"POST",body:form,headers:{Accept:"application/json"},cache:"no-store"});
   const data=await rr.json().catch(()=>({}));if(!rr.ok)throw new Error(data?.message||data?.error||"NOISE_FAILED");
   let job=data?.data||data;const id=job?.job_id||job?.jobId||"";let out=job?.output?.url||job?.outputUrl||"";if(!out&&id)out=await waitForCleverUtilsJob(String(id));if(!out)throw new Error("NOISE_OUTPUT_MISSING");
   const res=await fetch(out);if(!res.ok)throw new Error("NOISE_OUTPUT_"+res.status);const blob=await res.blob();await setWorkingBlob(blob,String(workingName).replace(/\.[^.]+$/,"")+".wav");toast("Шум очищен · результат только в редакторе");
  }catch(e){console.error("Miya voice editor noise failed",e);toast(String(e?.message||"Не удалось очистить шум"))}
  finally{if(b){b.disabled=false;b.textContent="Запустить очистку"}}
 };

 const renderResults=()=>{
  results.innerHTML="";resultsBox.hidden=!stemResults;if(!stemResults)return;
  [["vocals","🎤 Вокал","Сохранить вокал"],["instrumental","🎵 Минус","Сохранить минус"]].forEach(([kind,title,label])=>{
   const r=document.createElement("div");r.className="ve2-result";const hd=document.createElement("div");hd.className="ve2-result-head";const b=document.createElement("b");b.textContent=title;const save=document.createElement("button");save.type="button";save.className="ve2-result-save";save.title=label;save.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4M5 20h14"/></svg>';save.onclick=()=>{const stem=stemResults[kind];if(!stem?.blob)return;const saved=saveMedia("audio",stem.url,(workingName||"Песня")+" · "+(kind==="vocals"?"Вокал":"Минус"),"CleverUtils · "+(kind==="vocals"?"Вокал":"Минус"),"wav");if(saved){renderVoiceLibrary();toast(label+" сохранён")}};hd.append(b,save);const au=document.createElement("audio");au.controls=true;au.src=stemResults[kind].url;r.append(hd,au);results.append(r);
  });
 };
 const runSplit=async()=>{
  if(!workingBlob)return;showSplitProgress(8,"Подготавливаем аудио","проверяем исходный файл…");
  let timer=null;
  try{
   // Keep the original compressed audio. WAV conversion can multiply the file size and hit Vercel's request-body limit.
   const sourceFile=makeAudioUploadFile(),uploadFile=sourceFile;
   if(uploadFile.size>50*1024*1024)throw new Error("AUDIO_TOO_LARGE_FOR_SPLIT");
   updateSplitProgress(18,"Аудио подготовлено",uploadFile.type||"исходный аудиофайл");
   updateSplitProgress(28,"Отправляем аудио","CleverUtils · vocal-remover");
   timer=setInterval(()=>{const p=panel.querySelector(".progress-percent"),cur=p?parseInt(p.textContent,10)||28:28,next=Math.min(88,cur+(cur<55?2:cur<78?1:0));if(next>cur)updateSplitProgress(next,next<55?"Разделяем дорожки":"AI обрабатывает аудио",next<55?"Demucs · анализ вокала":"Demucs · извлечение вокала и инструментала")},1800);
   const boundary="----MiyaVocal"+Math.random().toString(16).slice(2),filename=String(uploadFile.name||"miya-audio.mp3").replace(/["\\\r\n]/g,"_"),mime=String(uploadFile.type||"audio/mpeg");
   const audioBytes=await uploadFile.arrayBuffer();
   const head=`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`;
   const tail=`\r\n--${boundary}--\r\n`;
   const encoder=new TextEncoder(),hb=encoder.encode(head),tb=encoder.encode(tail),body=new Uint8Array(hb.byteLength+audioBytes.byteLength+tb.byteLength);body.set(hb,0);body.set(new Uint8Array(audioBytes),hb.byteLength);body.set(tb,hb.byteLength+audioBytes.byteLength);
   const response=await fetch("https://cleverutils.com/api/v1/tools/vocal-remover",{method:"POST",body,headers:{"Content-Type":"multipart/form-data; boundary="+boundary,Accept:"application/json"},cache:"no-store"});
   let payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(String(payload?.error?.message||payload?.message||payload?.error?.code||"CLEVERUTILS_"+response.status));
   const getData=()=>payload?.data||payload;let jobId=String(getData()?.job_id||getData()?.jobId||"").trim(),status=String(getData()?.status||"").toLowerCase();
   if(jobId&&status!=="done"){let attempts=0;while(attempts++<90){await new Promise(r=>setTimeout(r,2500));const poll=await fetch("/api/cleverutils-vocal-remover?job="+encodeURIComponent(jobId),{cache:"no-store",headers:{Accept:"application/json"}}),next=await poll.json().catch(()=>null);if(!poll.ok)throw new Error(String(next?.message||next?.error||"CLEVERUTILS_JOB_"+poll.status));payload=next;const data=getData();status=String(data?.status||"").toLowerCase();const progress=Number(data?.progress);if(Number.isFinite(progress))updateSplitProgress(Math.min(90,30+Math.round(progress*.6)),"AI обрабатывает аудио","Demucs · "+Math.round(progress)+"%");else updateSplitProgress(Math.min(88,34+Math.floor(attempts/3)),"AI обрабатывает аудио","Demucs · разделение дорожек");if(status==="done"||data?.output||data?.outputs)break;if(status==="error"||status==="failed")throw new Error(String(data?.message||"CLEVERUTILS_JOB_FAILED"))}if(status!=="done"&&!getData()?.output&&!getData()?.outputs)throw new Error("CLEVERUTILS_JOB_TIMEOUT")}
   clearInterval(timer);timer=null;updateSplitProgress(92,"Получаем дорожки","CleverUtils · почти готово…");
   const job=getData(),stems=collectCleverStemUrls(job);let vocals=stems.vocals,instrumental=stems.instrumental,output=job?.output?.url||job?.outputUrl||job?.links?.output||"";
   if(!vocals||!instrumental){if(!output)throw new Error("VOCAL_SPLIT_OUTPUT_MISSING");const res=await fetch(output);if(!res.ok)throw new Error("VOCAL_SPLIT_OUTPUT_"+res.status);const blob=await res.blob(),type=String(res.headers.get("content-type")||blob.type||"").toLowerCase();if(type.includes("zip")||/\.zip(?:$|[?#])/i.test(output)){const JSZip=(await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default,zip=await JSZip.loadAsync(blob);for(const name of Object.keys(zip.files)){const e=zip.files[name];if(e.dir)continue;const lower=name.toLowerCase(),bb=await e.async("blob");if(!vocals&&/(vocal|vocals|acapella)/.test(lower))vocals=bb;if(!instrumental&&/(instrument|karaoke|minus|backing|accompaniment)/.test(lower))instrumental=bb}}}
   if(!vocals||!instrumental)throw new Error("VOCAL_SPLIT_TWO_TRACKS_MISSING");const getBlob=async v=>v instanceof Blob?v:(await fetch(v)).blob(),vb=await getBlob(vocals),ib=await getBlob(instrumental);stemResults={vocals:{blob:vb,url:URL.createObjectURL(vb)},instrumental:{blob:ib,url:URL.createObjectURL(ib)}};updateSplitProgress(100,"Готово","вокал и минус получены");await new Promise(r=>setTimeout(r,500));renderResults();toast("Готово · вокал и минус получены");
  }catch(e){
   clearInterval(timer);timer=null;
   console.error("Miya vocal split failed",e);
   const message=String(e?.message||"Не удалось разделить вокал");
   updateSplitProgress(100,"Ошибка",message);
   toast(message==="AUDIO_TOO_LARGE_FOR_SPLIT"?"Файл слишком большой для разделения":"Не удалось разделить вокал");
  }
 }

 const input=document.createElement("input");input.type="file";input.accept="audio/*";input.hidden=true;document.body.appendChild(input);
 const replaceSource=async file=>{if(!file?.type?.startsWith("audio/")){toast("Выбери аудиофайл");return}input.value="";stemResults=null;renderResults();await setWorkingBlob(file,file.name||"miya-voice.mp3");setStatus("Новый рабочий файл");toast("Аудио загружено · карточка на стене не изменена")};
 input.onchange=()=>{const f=input.files?.[0];if(f)replaceSource(f)};
 upload.onclick=()=>input.click();upload.querySelector(".ve2-plus").onclick=e=>{e.stopPropagation();input.click()};
 ["dragenter","dragover"].forEach(t=>upload.addEventListener(t,e=>{e.preventDefault();upload.classList.add("drag")}));
 ["dragleave","drop"].forEach(t=>upload.addEventListener(t,e=>{e.preventDefault();upload.classList.remove("drag")}));
 upload.addEventListener("drop",e=>{const f=e.dataTransfer?.files?.[0];if(f)replaceSource(f)});

 const loadInitial=async()=>{
  try{
   workingBlob=await resolveVoiceBlob(source);workingName=String(item?.prompt||"miya-voice.mp3").trim();if(!/\.[a-z0-9]{2,5}$/i.test(workingName))workingName+=".mp3";workingUrl=URL.createObjectURL(workingBlob);dirty=false;nameInput.value=String(item?.prompt||item?.model||"Мой голос").replace(/\.[^.]+$/,"").slice(0,80);await decodeWave();sync();
  }catch(e){console.error("Miya voice editor open failed",e);toast("Не удалось открыть голос");closeEditor()}
 };
 const closeEditor=()=>{
  stopAudio();cleanupUrl(workingUrl);[stemResults?.vocals?.url,stemResults?.instrumental?.url].forEach(cleanupUrl);try{input.remove()}catch{};backdrop.remove();document.body.classList.remove("voice-modal-open","miya-editor-page-open");document.documentElement.classList.remove("miya-editor-page-open");document.body.style.overflow=previousBodyOverflow;if(composer)composer.style.display=previousComposerDisplay;window.removeEventListener("resize",drawWave);
 };
 const clearWorking=()=>{
  stopAudio();cleanupUrl(workingUrl);workingBlob=null;workingUrl=null;dirty=true;waveData=null;duration=0;trimStart=trimEnd=0;stemResults=null;renderResults();nameInput.value="";setStatus("ФАЙЛ НЕ ВЫБРАН");drawWave();sync();toast("Запись убрана из редактора · карточка на стене сохранена");
 };
 clearBtn.onclick=clearWorking;close.onclick=closeEditor;closeBtn.onclick=closeEditor;backdrop.addEventListener("click",e=>{if(e.target===backdrop)closeEditor()});
 nameInput.addEventListener("input",()=>{workingName=(nameInput.value.trim()||"miya-voice").replace(/\.[^.]+$/,"")+".wav";dirty=Boolean(workingBlob);sync()});
 saveBtn.onclick=async()=>{
  if(!workingBlob||!dirty){toast("Сначала измени или добавь аудиофайл");return}
  try{
   const ext=/wav/i.test(workingBlob.type)?"wav":"mp3";
   const url=URL.createObjectURL(workingBlob);
   const saveName=(nameInput.value.trim()||workingName||"miya-voice").replace(/\.[^.]+$/,"")+"."+ext;
   const saved=saveMedia("audio",url,saveName,item?.model||"Miya Voice",ext);
   if(!saved)throw new Error("SAVE_FAILED");
   renderVoiceLibrary();toast("Новый голос сохранён · исходная карточка осталась");closeEditor();
  }catch(e){console.error("Miya voice editor save failed",e);toast(String(e?.message||"Не удалось сохранить голос"))}
 };
 await loadInitial();
}

function buildVoiceCard(parts,item){
 const blob=new Blob(parts,{type:"audio/mpeg"});const source=()=>Promise.resolve(URL.createObjectURL(blob));
 return createVoiceCard(item,source);
}
async function generateVoice(text){
 const sel=$("#voiceSelect");
 const voiceIndex=Number(sel?.value||0);
 const parts=splitVoiceText(text,1000);
 if(!parts.length)return;
 const canvas=$("#canvas");
 canvas.innerHTML='<div class="voice-wall"><div class="voice-generating"><div class="voice-generating-name"></div><div class="voice-progress"><span></span></div><b>0%</b></div></div>';
 const gender=$("#voiceGender")?.value==="male"?"Male":"Female";
 const lang=$("#voiceLanguage")?.value||"ru";
 const v=voiceCatalog.find(x=>Number(x.index)===voiceIndex);
 const label=(String(v?.name||"Voice")+ " · "+gender+" · "+String(v?.country||"")).replace(/ · $/,"");
 $(".voice-generating-name").textContent=label;
 const rate=Number($("#voiceRate")?.value||0),pitch=Number($("#voicePitch")?.value||0),start=performance.now();
 const progress=$(".voice-generating b"),bar=$(".voice-progress span");
 const setProgress=n=>{if(progress)progress.textContent=Math.round(n)+"%";if(bar)bar.style.width=Math.round(n)+"%"};
 const puterLang={ru:"ru-RU",en:"en-US",de:"de-DE",fr:"fr-FR",es:"es-ES"}[lang]||"ru-RU";
 const puterVoice={ru:{Female:"Tatyana",Male:"Maxim"},en:{Female:"Joanna",Male:"Matthew"},de:{Female:"Marlene",Male:"Hans"},fr:{Female:"Celine",Male:"Mathieu"},es:{Female:"Conchita",Male:"Enrique"}}[lang]?.[gender]||({Female:"Tatyana",Male:"Maxim"}[gender]);

 const loadPuterForVoiceFallback=async()=>{
   if(window.puter?.ai?.txt2speech)return window.puter;
   if(window.__miyaPuterLoadPromise)return window.__miyaPuterLoadPromise;
   window.__miyaPuterLoadPromise=new Promise((resolve,reject)=>{
     const existing=document.querySelector('script[data-miya-puter="voice-fallback"]');
     if(existing){
       existing.addEventListener("load",()=>window.puter?.ai?.txt2speech?resolve(window.puter):reject(new Error("PUTER_NOT_READY")), {once:true});
       existing.addEventListener("error",()=>reject(new Error("PUTER_LOAD_FAILED")), {once:true});
       if(window.puter?.ai?.txt2speech)resolve(window.puter);
       return;
     }
     const script=document.createElement("script");
     script.src="https://js.puter.com/v2/";
     script.async=true;
     script.dataset.miyaPuter="voice-fallback";
     script.onload=()=>{
       if(window.puter?.ai?.txt2speech)resolve(window.puter);
       else reject(new Error("PUTER_NOT_READY"));
     };
     script.onerror=()=>reject(new Error("PUTER_LOAD_FAILED"));
     document.head.appendChild(script);
   }).catch(error=>{
     window.__miyaPuterLoadPromise=null;
     throw error;
   });
   return window.__miyaPuterLoadPromise;
 };

 const makePuterPart=async part=>{
   const puter=await loadPuterForVoiceFallback();
   if(!puter?.ai?.txt2speech)throw new Error("PUTER_NOT_READY");
   const audio=await puter.ai.txt2speech(part,{provider:"aws-polly",voice:puterVoice,language:puterLang});
   if(!audio?.src)throw new Error("PUTER_AUDIO_EMPTY");
   const r=await fetch(audio.src);
   if(!r.ok)throw new Error("PUTER_AUDIO_"+r.status);
   return await r.blob();
 };
 try{
   let results;
   try{
     results=await Promise.all(parts.map(async(part,i)=>{
       const r=await fetch("https://ahm7xmakki.com/api/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({voiceIndex:voiceIndex,text:part,pitch:pitch,rate:rate})});
       if(!r.ok)throw new Error("TTS_"+r.status);
       return{i:i,blob:await r.blob()};
     }));
     results.sort((a,b)=>a.i-b.i);
   }catch(ahmError){
     console.warn("AHM7 TTS failed, using Puter fallback",ahmError);
     $(".voice-generating-name").textContent="Puter · "+puterVoice+" · "+gender+" · "+puterLang;
     results=await Promise.all(parts.map(async(part,i)=>({i:i,blob:await makePuterPart(part)})));
     results.sort((a,b)=>a.i-b.i);
   }
   setProgress(100);
   voiceAudioParts=results.map(x=>x.blob);
   const objectUrl=URL.createObjectURL(new Blob(voiceAudioParts,{type:"audio/mpeg"}));
   const finalLabel=$(".voice-generating-name")?.textContent||label;
   voiceAudioItem=saveMedia("audio",objectUrl,text,finalLabel);
   const wall=$("#canvas");wall.innerHTML="";wall.appendChild(buildVoiceCard(voiceAudioParts,voiceAudioItem));
   $("#composerStatus").textContent="Голос готов";
   toast("Готово · "+((performance.now()-start)/1000).toFixed(1)+" сек");
 }catch(e){
   console.error(e);
   $("#composerStatus").textContent=label+" · ошибка";
   toast("Не удалось создать голос");
 }
}
function renderVoiceLibrary(){ensureVoiceWallStyles();ensureVoiceCardFinalStyles();const c=$("#canvas"),items=getLibrary().filter(x=>x.type==="audio");if(!items.length){showEmpty();return}c.innerHTML='<div class="library-section"><div class="voice-wall"></div></div>';const wall=c.querySelector(".voice-wall");items.forEach((item,index)=>wall.appendChild(createVoiceCard(item,()=>resolveMediaUrl(item),{voiceItems:items,voiceIndex:index})))}
function renderLibrary(tab="images"){
 const c=$("#canvas"),items=getLibrary(),images=items.filter(x=>x.type==="image"),videos=items.filter(x=>x.type==="video"),audios=items.filter(x=>x.type==="audio");
 c.innerHTML='<div class="library-section"><div class="library-tabs"><button type="button" class="library-tab" data-library-tab="images">Картинки</button><button type="button" class="library-tab" data-library-tab="videos">Видео</button><button type="button" class="library-tab" data-library-tab="audio">Музыка</button><button type="button" class="library-tab" data-library-tab="editor">Аудиоредактор</button></div><div class="result-grid library-media-grid"></div></div>';
 c.querySelectorAll("[data-library-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.libraryTab===tab));
 const grid=c.querySelector(".library-media-grid");
 if(tab==="audio"){
   grid.remove();
   const wall=document.createElement("div");wall.className="voice-wall library-audio-wall";c.querySelector(".library-section").appendChild(wall);
   if(!audios.length)wall.innerHTML='<div class="library-note">Пока нет созданных аудио.</div>';
   else audios.forEach((item,index)=>wall.appendChild(createVoiceCard(item,()=>resolveMediaUrl(item),{voiceItems:audios,voiceIndex:index})));
 }else{
   const list=tab==="videos"?videos:images;
   if(!list.length)grid.innerHTML='<div class="library-note">'+(tab==="videos"?"Пока нет созданных видео.":"Пока нет созданных картинок.")+'</div>';
   else{list.forEach(item=>grid.appendChild(buildMediaCard(item,{video:tab==="videos"})));applyFirstSixMediaPriority(grid)}
 }
 c.querySelectorAll("[data-library-tab]").forEach(btn=>btn.onclick=()=>{if(btn.dataset.libraryTab==="editor"){openToolsEditor();toolsEditorState.kind="editor";toolsEditorRender();return}renderLibrary(btn.dataset.libraryTab)});
}

function toast(message){
 let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";t.className="toast";document.body.appendChild(t)}
 t.textContent=message;t.classList.add("show");clearTimeout(window.__toast);
 window.__toast=setTimeout(()=>t.classList.remove("show"),2600)
}
function syncInput(){const i=$("#composerInput");if(!i)return;i.style.height="auto";const h=Math.min(120,Math.max(42,i.scrollHeight));i.style.height=h+"px";const row=i.closest(".composer-input-row");if(row)row.style.height=h+"px"}
function modeHero(){
 if(mode==="chat") return `<div class="studio-room clean-canvas chat-room">
   <div class="chat-welcome section-welcome">
     <div class="hero-mark"><span class="nav-icon icon-spark" aria-hidden="true"></span></div><div class="mini-badge">MIYA CHAT</div>
     <h2>Общайся с Miya</h2>
     <p>Задавай вопросы, придумывай идеи, создавай промпты и работай с контентом.</p>
   </div>
 </div>`;
 if(mode==="voice") return `<div class="studio-room clean-canvas"><div class="chat-welcome section-welcome"><div class="hero-mark voice"><span class="nav-icon icon-voice" aria-hidden="true"></span></div><div class="mini-badge">MIYA VOICE</div><h2>Создавай голоса</h2><p>Создавай новые голоса из текста с помощью AI и сохраняй их на стене.</p></div></div>`;
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
  }); });
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
 const items=getLibrary().filter(isStoredVideo);
 c.innerHTML='<div class="result-grid video-result-grid"></div>';
 const grid=c.querySelector(".result-grid");
 items.forEach(item=>grid.appendChild(buildMediaCard(item,{video:true})));
 const card=document.createElement("div");card.className="generation-loading video-generation-loading";
 card.dataset.model=selectedVideoModel;
 card.innerHTML='<div class="generation-progress"><div class="progress-circle is-active"><span class="progress-percent">1%</span></div><div class="progress-copy"><span class="progress-model"></span></div></div><div class="generation-progress-bar"><span></span></div>';
 card.querySelector(".progress-model").textContent=selectedVideoModel;
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
 showLoading();if($("#composerSend"))$("#composerSend").disabled=true;
 const model="Agnes Image 2.5 Flash";
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
   if($("#composerStatus"))$("#composerStatus").textContent=model+" · ошибка";
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
 const modelName=selectedModel||"FLUX Dev";
 const usesReferenceImage=Boolean(referenceImage) &&
   (modelName==="FLUX Kontext Dev" || modelName==="Agnes Image 2.5 Flash");
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
  },900); };
 startFakeProgress();
 $("#composerStatus").textContent=hasFileUpload?modelName+" · загрузка файла…":modelName+" · создание…";
 try{
  const payload={
   prompt,
   // Kontext is more reliable with 's native "auto" sizing when
   // an image comes from history/library; keep explicit ratio for fresh T2I.
   ratio:referenceImage?"auto":$("#composerRatio").value
  };
  if(usesReferenceImage){
   if(referenceImage.startsWith("data:image/"))payload.imageBase64=referenceImage;
   else payload.imageUrl=referenceImage;
  }
  const requestedCount=Number($("#composerCount")?.value||1);
  const body=useAgnesImage
   ? JSON.stringify({prompt,ratio:$("#composerRatio").value,n:requestedCount,imageBase64:referenceImage||""})
   : JSON.stringify({
      mode:"image",provider:"ahm7",prompt,model:modelName,
      ratio:$("#composerRatio").value,outputFormat:"jpeg",copies:requestedCount,
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
  // Image creation/editing is routed through the original AHM7/ API.
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
function copyChatText(text){
 const value=String(text||"");
 if(!value)return;
 if(navigator.clipboard?.writeText){
   navigator.clipboard.writeText(value).then(()=>toast("Скопировано")).catch(()=>toast("Не удалось скопировать"));
 }else toast("Копирование недоступно");
}
function retryLastChat(){
 if(!chatMessages.length||chatMessages[chatMessages.length-1]?.role!=="user"){
   toast("Нет сообщения для повтора");
   return;
 }
 requestChat();
}
function addChatMessage(text,isUser,image="",isError=false){
 let stream=$("#canvas .chat-stream");
 if(!stream){
   $("#canvas").innerHTML='<div class="chat-stream"></div>';
   stream=$("#canvas .chat-stream");
 }
 const welcome=stream.querySelector(".chat-welcome");if(welcome)welcome.remove();
 const row=document.createElement("div");row.className="chat-row "+(isUser?"user":"assistant")+(isError?" chat-error-row":"");
 const av=document.createElement("div");av.className="chat-avatar";av.textContent=isUser?"U":"M";
 const content=document.createElement("div");content.className="chat-content";
 const bubble=document.createElement("div");bubble.className="chat-bubble";bubble.textContent=text;
 content.appendChild(bubble);
 if(image){const preview=document.createElement("img");preview.className="chat-image-attachment";preview.src=image;preview.alt="Прикреплённое изображение";content.insertBefore(preview,bubble)}

 const actions=document.createElement("div");actions.className="chat-actions";
 if(isUser){
   actions.innerHTML='<button type="button" title="Копировать"><span class="action-mini-icon">⧉</span>Копировать</button><button type="button" title="Повторить"><span class="action-mini-icon">↻</span>Повторить</button>';
   actions.querySelector('[title="Копировать"]').onclick=()=>copyChatText(text);
   actions.querySelector('[title="Повторить"]').onclick=()=>{
     const value=String(text||"").trim();
     if(!value)return;
     $("#composerInput").value=value;syncInput();
     if(chatMessages[chatMessages.length-1]?.role==="user"&&chatMessages[chatMessages.length-1].content===value){
       retryLastChat();
     }else{
       $("#composerInput").focus();
       toast("Это сообщение не последнее. Скопировано в поле ввода.");
     }
   };
 }else{
   actions.innerHTML='<button type="button" title="Копировать"><span class="action-mini-icon">⧉</span>Копировать</button><button type="button" title="В промпт"><span class="action-mini-icon">✦</span>В промпт</button><button type="button" title="Повторить"><span class="action-mini-icon">↻</span>Повторить</button>';
   actions.querySelector('[title="Копировать"]').onclick=()=>copyChatText(text);
   actions.querySelector('[title="В промпт"]').onclick=()=>{$("#composerInput").value=text;syncInput();$("#composerInput").focus();toast("Ответ добавлен в промпт")};
   actions.querySelector('[title="Повторить"]').onclick=()=>retryLastChat();
 }
 content.appendChild(actions);

 if(!isUser&&!isError){
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
     if(t)copyChatText(t);
     selectionBar.hidden=true;
   };
   bubble.addEventListener("mouseup",()=>{
     const sel=window.getSelection?.();
     const selected=String(sel?.toString()||"").trim();
     if(!selected||!sel?.rangeCount||!bubble.contains(sel.anchorNode)||!bubble.contains(sel.focusNode))return;
     selectionBar.dataset.selectionText=selected;
     selectionBar.hidden=false;
   });
   content.appendChild(selectionBar);
 }
 row.append(av,content);
 stream.appendChild(row);
 scrollChatToLatest("smooth");
}
async function prepareChatVisionImage(dataUrl){
  if(!/^data:image\//i.test(String(dataUrl||""))) return "";
  try{
    const image=await new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=reject;
      img.src=dataUrl;
    });
    const sourceW=image.naturalWidth||image.width;
    const sourceH=image.naturalHeight||image.height;
    const canvas=document.createElement("canvas");
    const ctx=canvas.getContext("2d",{alpha:false});
    for(const maxSide of [768,640,512]){
      const scale=Math.min(1,maxSide/Math.max(sourceW,sourceH));
      canvas.width=Math.max(1,Math.round(sourceW*scale));
      canvas.height=Math.max(1,Math.round(sourceH*scale));
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [.62,.52,.42]){
        const out=canvas.toDataURL("image/jpeg",quality);
        if(out.length<=110000) return out;
      }
    }
    return canvas.toDataURL("image/jpeg",.35);
  }catch{
    return dataUrl;
  }
}
async function requestChat(){
 const status=$("#composerStatus");
 const hasVisionImage=mode==="chat"&&chatAttachmentFile&&/^data:image\//i.test(String(referenceImage||""));
 status.textContent=hasVisionImage?"Miya · анализ изображения…":"Miya думает…";
 $("#composerSend").disabled=true;
 try{
   const chatImage=hasVisionImage?await prepareChatVisionImage(String(referenceImage||"")):"";
   const response=await fetch("/api/chat",{
     method:"POST",
     headers:{"Content-Type":"application/json","Accept":"application/json"},
     body:JSON.stringify({messages:chatMessages,imageBase64:chatImage}),
     signal:AbortSignal.timeout(90000)
   });
   const data=await response.json().catch(()=>({}));
   const answer=String(data?.text||"").trim();
   const serverMessage=typeof data?.message==="string"?data.message:typeof data?.error==="string"?data.error:"Не удалось получить ответ Miya";
   if(!response.ok||!answer)throw new Error(serverMessage);
   chatMessages.push({role:"assistant",content:answer});
   addChatMessage(answer,false);
   saveCurrentChat();
   status.textContent=hasVisionImage?"Miya · "+String(data?.model||data?.provider||"Vision")+" · готово":(data.model==="VisionSter"?"Miya · VisionChat":"Miya · Free Text");
 }catch(e){
   const message=String(e?.message||"Не удалось получить ответ Miya");
   addChatMessage(message,false,"",true);
   status.textContent="AI Chat · ошибка · можно повторить";
 }finally{$("#composerSend").disabled=false;}
}
function removeGenerationLoading(){
 const loader=$("#canvas .generation-loading");
 if(loader)loader.remove();
}
let videoProgressState={value:1,target:1,model:"",label:"",timer:null,startedAt:0};
function stopProgress(finalValue=null,label=""){
 if(videoProgressState.timer){
   clearInterval(videoProgressState.timer);
   videoProgressState.timer=null;
 }
 if(finalValue!==null){
   const v=Math.max(1,Math.min(100,Math.round(Number(finalValue)||1)));
   videoProgressState.value=v;
   videoProgressState.target=v;
 }
 if(label)videoProgressState.label=String(label);
 paintVideoProgress(videoProgressState.value);
}
function resetVideoProgress(){
 if(videoProgressState.timer){
   clearInterval(videoProgressState.timer);
   videoProgressState.timer=null;
 }
 videoProgressState={value:1,target:1,model:"",label:"",timer:null,startedAt:0};
 removeGenerationLoading();
 const progress=$("#composerProgress");
 if(progress)progress.textContent="";
}

function proxyAgnesVideoUrl(url){
 const value=String(url||"").trim();
 if(!/^https?:\/\//i.test(value))return value;
 try{
   const host=new URL(value).hostname.toLowerCase();
   if(host==="cos-platform-outputs.agnes-ai.cn"||host.endsWith(".agnes-ai.cn")||host.endsWith(".agnes-ai.space")) return "/api/agnes-video-proxy?url="+encodeURIComponent(value);
 }catch{}
 return value;
}

function paintVideoProgress(value){
 const v=Math.max(1,Math.min(100,Math.round(value)));
 const loader=$("#canvas .video-generation-loading");
 const ring=loader?.querySelector(".progress-circle");
 const percent=loader?.querySelector(".progress-percent");
 const copy=loader?.querySelector(".progress-model");
 const bar=loader?.querySelector(".generation-progress-bar span");
 if(ring)ring.style.setProperty("--progress",v+"%");
 if(percent)percent.textContent=v+"%";
 if(bar)bar.style.width=v+"%";
 const text=v>=100 ? "готово" : videoProgressState.model;
 if(copy)copy.textContent=text;
 const status=$("#composerStatus"),progress=$("#composerProgress");
 if(status)status.textContent=v>=100 ? "готово" : videoProgressState.model+" · "+v+"%";
 if(progress)progress.textContent=v+"%";
}

function updateVideoProgress(model,value,label=""){
 const numeric=Number(value);
 if(Number.isFinite(numeric))videoProgressState.target=Math.max(videoProgressState.target,Math.max(1,Math.min(99,Math.round(numeric))));
 videoProgressState.model=String(model||videoProgressState.model||"Видео");
 if(label)videoProgressState.label=String(label);
 paintVideoProgress(videoProgressState.value);
}

function startVideoProgress(model){
 if(videoProgressState.timer)clearInterval(videoProgressState.timer);
 videoProgressState={value:1,target:99,model:String(model||"Видео"),label:"запуск видеодвижка…",timer:null,startedAt:Date.now()};
 paintVideoProgress(1);
 // One deterministic percentage step at a time. Provider-reported progress can
 // raise the target, but it can never make the displayed percentage jump backward.
 videoProgressState.timer=setInterval(()=>{
   const loader=$("#canvas .video-generation-loading");
   if(!loader||!document.body.contains(loader)){
     clearInterval(videoProgressState.timer);
     videoProgressState.timer=null;
     return;
   }
   // Video has a 100-second visual range: 1% at start and 99% at 100s.
   // The real provider completion path alone is allowed to set 100%.
   const elapsed=Math.max(0,Date.now()-videoProgressState.startedAt);
   const clockValue=Math.min(99,Math.max(1,Math.round(1+(elapsed/100000)*98)));
   videoProgressState.value=Math.max(videoProgressState.value,clockValue);
   paintVideoProgress(videoProgressState.value);
 },1000);
 return (finalValue=null,label="")=>{
   if(finalValue!==null){
     videoProgressState.target=Math.max(videoProgressState.target,Math.min(100,Number(finalValue)||100));
   }
   if(label)videoProgressState.label=String(label);
   if(finalValue===100){
     videoProgressState.value=100;
     videoProgressState.target=100;
     paintVideoProgress(100);
   }else{
     paintVideoProgress(videoProgressState.value);
   }
   if(videoProgressState.timer){
     clearInterval(videoProgressState.timer);
     videoProgressState.timer=null;
   }
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

// Compact transport copy for serverless vocal-remover uploads.




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
  options.filter(o=>String(o.value||o.textContent).includes("LTX-2.3")).forEach(o=>o.disabled=true);
  if(String(select.value||"").includes("LTX-2.3")){
   const fallback=options.find(o=>!o.disabled&&String(o.value||o.textContent)===" Motion Synthesis");
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
 if(until&&(String(select.value||"").includes("LTX-2.3")||String(select.value||"").includes("Wan 2.2"))){
  const fallback=[...select.options].find(o=>!o.disabled&&String(o.value||o.textContent)===" Motion Synthesis");
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

async function generateAgnesVideo(prompt){
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
   updateVideoProgress(model,5,"подключение к Agnes…");

   const create=await new Promise((resolve,reject)=>{
     const xhr=new XMLHttpRequest();
     let settled=false;
     const finish=(fn,value)=>{
       if(settled)return;
       settled=true;
       if(xhr.upload) xhr.upload.onprogress=null;
       fn(value);
     };
     xhr.open("POST","/api/agnes-video",true);
     xhr.setRequestHeader("Content-Type","application/json");
     xhr.setRequestHeader("Accept","application/json");
     xhr.timeout=180000;
     xhr.ontimeout=()=>finish(reject,new Error("Agnes не ответил за 120 секунд"));
     xhr.onerror=()=>finish(reject,new Error("Не удалось соединиться с Agnes"));
     xhr.onabort=()=>finish(reject,new Error("Запрос Agnes был отменён браузером"));
     xhr.onload=()=>{
       let data={};
       try{data=xhr.responseText?JSON.parse(xhr.responseText):{}}catch{}
       finish(resolve,{status:xhr.status,ok:xhr.status>=200&&xhr.status<300,data,raw:xhr.responseText||"",retryAfter:xhr.getResponseHeader("Retry-After")});
     };
     try{
       xhr.send(JSON.stringify({
         model:apiModel,
         prompt,
         seconds:duration,
         size,
         aspect_ratio:ratio,
         first_frame:source||undefined
       }));
     }catch(e){finish(reject,e)}
   });

   const created=create.data;
   if(create.status===429||created.error==="AGNES_VIDEO_RATE_LIMITED"){
     throw new Error("Agnes: бесплатный лимит ещё не снят. Попробуйте позже.");
   }

   if(!create.ok||!created.videoId){
     const message=String(created.message||created.error||create.raw||"Agnes не создал задачу").slice(0,500);
     throw new Error(message);
   }

   const videoId=created.videoId;
   const activeModel=String(created.model||apiModel);
   const fallbackNotice=created.fallbackFrom
     ?" · очередь Flash переполнена → v2.0"
     :"";
   if(created.fallbackFrom){
     if($("#composerStatus"))$("#composerStatus").textContent="Agnes Video v2.0 · резервный запуск…";
     updateVideoProgress("Agnes Video v2.0",8,"Flash занят, запускаю резервную очередь…");
   }

   let final=null;
   const started=Date.now();
   while(Date.now()-started<15*60*1000){
     await new Promise(r=>setTimeout(r,10000));
     const statusResponse=await fetch("/api/agnes-video-status?video_id="+encodeURIComponent(videoId)+"&model="+encodeURIComponent(activeModel),{
       headers:{"Accept":"application/json"},
       signal:AbortSignal.timeout(30000)
     });
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
   const playableUrl=proxyAgnesVideoUrl(final.url);
   const item=saveMedia("video",playableUrl,prompt,shownModel+" · "+actualSize+" · "+actualSeconds);
   stopProgress(100,"готово");
   updateVideoProgress(shownModel,100,"готово");
   removeGenerationLoading();renderVideoLibrary();if(item)scrollImagesToTop();
   if($("#composerStatus"))$("#composerStatus").textContent=shownModel+" · готово"+fallbackNotice;
   toast(created.fallbackFrom
     ?"Agnes: Flash занят, видео создано через v2.0"
     :"Agnes: видео создано");
 }catch(e){
   stopProgress(99,"ошибка");paintVideoProgress(99);removeGenerationLoading();if($("#composerProgress"))$("#composerProgress").textContent="99%";
   $("#composerStatus").textContent=model+" · ошибка";
   toast("Agnes: "+(e?.message||"не удалось создать видео"));
 }finally{
   videoGenerationBusy=false;if($("#composerSend"))$("#composerSend").disabled=false;
 }
}
async function generateNovaiVideo(prompt){
 if(videoGenerationBusy){toast("Видео уже создаётся. Дождитесь завершения текущего запроса.");return}
 videoGenerationBusy=true;
 showLoading();$("#composerSend").disabled=true;
 const model="NovAI CogVideoX-Flash";
 const stopProgress=startVideoProgress(model);
 try{
   updateVideoProgress(model,1,"создание…");
   const response=await fetch("/api/novai-video",{
     method:"POST",
     headers:{"Content-Type":"application/json","Accept":"application/json"},
     body:JSON.stringify({prompt})
   });
   const raw=await response.text();
   let data={};try{data=raw?JSON.parse(raw):{}}catch{}
   if(!response.ok||!data?.id){
     throw new Error(String(data?.message||data?.error||raw||"NovAI не создал задачу").slice(0,500));
   }

   const taskId=String(data.id);
   let final=null;
   const started=Date.now();

   while(Date.now()-started<15*60*1000){
     await new Promise(r=>setTimeout(r,5000));
     const statusResponse=await fetch("/api/novai-video?id="+encodeURIComponent(taskId),{
       headers:{"Accept":"application/json"},
       signal:AbortSignal.timeout(30000)
     });
     const statusRaw=await statusResponse.text();
     let status={};try{status=statusRaw?JSON.parse(statusRaw):{}}catch{}
     if(!statusResponse.ok){
       throw new Error(String(status?.message||status?.detail||status?.error||statusRaw||"NovAI status error").slice(0,500));
     }

     const state=String(status.task_status||status.status||"").toUpperCase();
     if(state==="SUCCESS"||state==="COMPLETED"){
       final=status;
       break;
     }
     if(state==="FAILED"||state==="ERROR"){
       throw new Error(String(status?.message||status?.error||"NovAI генерация завершилась ошибкой").slice(0,500));
     }
   }

   const videoUrl=String(final?.video_result?.[0]?.url||"").trim();
   if(!videoUrl)throw new Error("NovAI не вернул готовый MP4 за 15 минут");

   updateVideoProgress(model,99,"видео получено…");
   const item=saveMedia("video",videoUrl,prompt,model+" · 720p · 6 сек");
   stopProgress(100,"готово");
   updateVideoProgress(model,100,"готово");
   removeGenerationLoading();
   renderVideoLibrary();
   if(item)scrollImagesToTop();
   if($("#composerStatus"))$("#composerStatus").textContent=model+" · готово";
   toast("NovAI: видео создано");
 }catch(e){
   stopProgress(null,"ошибка");
   removeGenerationLoading();
   if($("#composerProgress"))$("#composerProgress").textContent="";
   if($("#composerStatus"))$("#composerStatus").textContent=model+" · ошибка";
   toast("NovAI: "+(e?.message||"не удалось создать видео"));
 }finally{
   videoGenerationBusy=false;
   if($("#composerSend"))$("#composerSend").disabled=false;
 }
}
async function generateOmegaT2V(prompt){
 if(videoGenerationBusy){toast("Видео уже создаётся. Дождитесь завершения текущего запроса.");return}
 videoGenerationBusy=true;
 showLoading();$("#composerSend").disabled=true;
 const stopProgress=startVideoProgress("OmegaTech T2V");
 try{
   const ratioValue="16:9";
   const durationText=String($("#videoDuration")?.value||"5 сек");
   const requestedDuration=Math.max(1,Math.min(10,Number(durationText.match(/\\d+/)?.[0]||5)));
   // OmegaTech has a 2000-character prompt limit. Keep this request minimal so
   // the user's actual description reaches the model unchanged.
   const userPrompt=String(prompt||"").trim();
   const actionPrompt=userPrompt;
   updateVideoProgress("OmegaTech T2V",1,"создание…");
   const response=await fetch("/api/omegatech-t2v",{
     method:"POST",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({
       action:"generate",
       prompt:actionPrompt,
       ratio:ratioValue,
       duration:requestedDuration,
       sound:true
     })
   });
   const raw=await response.text();
   let data=null;
   try{data=JSON.parse(raw)}catch{}
   if(!response.ok||!data?.success||!data?.data?.videoUrl){
     throw new Error(String(data?.message||data?.error||raw||"OmegaTech T2V не вернул видео").slice(0,500));
   }
   const remoteVideoUrl=String(data.data.videoUrl);
   const videoUrl="/api/omegatech-video?url="+encodeURIComponent(remoteVideoUrl);
   // The video is ready when the generated MP4 can actually be opened by the browser.
// Do not use a fixed 206/200 sequence as a readiness signal.
   updateVideoProgress("OmegaTech T2V",99,"проверка видео…");
   let videoReady=false;
   const readyStarted=Date.now();
   while(Date.now()-readyStarted<10*60*1000){     try{
       const probe=document.createElement("video");
       probe.preload="metadata";
       probe.muted=true;
       probe.playsInline=true;
       const readyPromise=new Promise(resolve=>{
         let done=false;
         const finish=ok=>{if(done)return;done=true;resolve(ok)};
         probe.onloadedmetadata=()=>finish(Number.isFinite(probe.duration)&&probe.duration>0);
         probe.onerror=()=>finish(false);
         setTimeout(()=>finish(false),15000);
       });
       probe.src=videoUrl;
       probe.load();
       videoReady=await readyPromise;
       probe.removeAttribute("src");
       probe.load();
       if(videoReady)break;
     }catch{}
     await new Promise(r=>setTimeout(r,3000));
   }
   if(!videoReady)throw new Error("OmegaTech: MP4 ещё нельзя открыть в браузере");
   const item=saveMedia("video",videoUrl,prompt,"OmegaTech T2V · Video + Audio");
   stopProgress(100,"готово");
   updateVideoProgress("OmegaTech T2V",100,"готово");
   removeGenerationLoading();renderVideoLibrary();
   if(item)scrollImagesToTop();
   if($("#composerStatus"))$("#composerStatus").textContent="OmegaTech T2V · готово";
 }catch(e){
   stopProgress(null,"ошибка");removeGenerationLoading();
   if($("#composerProgress"))$("#composerProgress").textContent="";
   if($("#composerStatus"))$("#composerStatus").textContent="OmegaTech T2V · ошибка";
   toast("OmegaTech T2V: "+(e?.message||"не удалось создать видео"));
 }finally{
   videoGenerationBusy=false;
   if($("#composerSend"))$("#composerSend").disabled=false;
 }
}
async function generateFreeAIVideo(prompt){
 if(videoGenerationBusy){toast("Видео уже создаётся. Дождитесь завершения текущего запроса.");return}
 videoGenerationBusy=true;
 const source=referenceImage||"";
 showLoading();$("#composerSend").disabled=true;
 const stopProgress=startVideoProgress("FreeAIVideo VIDEOX");
 try{
   const ratio=String($("#videoRatio")?.value||"16:9");
   const size=ratio==="9:16"?"1080x1920":ratio==="1:1"?"1080x1080":"1920x1080";
   const response=await fetch("/api/freeaivideo-video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:String(prompt||"").trim(),image:source,ratio,size,with_audio:true,quality:"speed",fps:30})});
   const raw=await response.text();let data=null;try{data=JSON.parse(raw)}catch{}
   if(!response.ok||!data?.success||!data?.videoUrl)throw new Error(String(data?.message||data?.error||raw||"FreeAIVideo не вернул видео").slice(0,500));
   updateVideoProgress("FreeAIVideo VIDEOX",99,"видео получено…");
   const item=saveMedia("video",data.videoUrl,prompt,"FreeAIVideo VIDEOX · Video + Audio");
   stopProgress(100,"готово");updateVideoProgress("FreeAIVideo VIDEOX",100,"готово");removeGenerationLoading();renderVideoLibrary();
   if(item)scrollImagesToTop();
 }catch(e){
   stopProgress(null,"ошибка");removeGenerationLoading();
   if($("#composerProgress"))$("#composerProgress").textContent="";
   if($("#composerStatus"))$("#composerStatus").textContent="FreeAIVideo VIDEOX · ошибка";
   toast("FreeAIVideo: "+(e?.message||"не удалось создать видео"));
 }finally{videoGenerationBusy=false;$("#composerSend").disabled=false}
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
 if(selectedModel==="NovAI CogVideoX-Flash") return generateNovaiVideo(prompt);
 if(selectedModel==="FreeAIVideo VIDEOX") return generateFreeAIVideo(prompt);
 if(selectedModel==="OmegaTech T2V") return generateOmegaT2V(prompt);
 if(selectedModel==="Agnes Video 2.5"||selectedModel==="Agnes Video 2.5 Flash"||selectedModel==="Agnes Video v2.0") return generateAgnesVideo(prompt);
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
   stopProgress(100,"готово");
   updateVideoProgress("LTX-2.3 Distilled",100,"готово");
   removeGenerationLoading();renderVideoLibrary();
   if(item)scrollImagesToTop();
   toast("LTX-2.3: видео + звук созданы");
 }catch(e){
   stopProgress(99,"ошибка");paintVideoProgress(99);removeGenerationLoading();
   const progressEl=$("#composerProgress"); if(progressEl) progressEl.textContent="99%";
   const rawMessage=String(e?.message||"");
   const isQuota=/exceeded your ZeroGPU quota|ZeroGPU quota/i.test(rawMessage);
   if(isQuota){
     const until=setLtxQuotaCooldown(rawMessage);
     const statusEl=$("#composerStatus"); if(statusEl) statusEl.textContent="LTX-2.3 временно недоступен · квота ZeroGPU";
     toast(until
       ? "LTX-2.3 временно отключён до восстановления бесплатной квоты. Повторный запрос не отправлен."
       : "LTX-2.3 временно отключён: бесплатная ZeroGPU-квота исчерпана.");   }else{
     const statusEl=$("#composerStatus"); if(statusEl) statusEl.textContent="LTX-2.3 Distilled · ошибка · можно повторить";
     toast(rawMessage||"Не удалось создать видео");
   }
 }finally{
   videoGenerationBusy=false;
   $("#composerSend").disabled=false;
 }
}
function getImageToolSource(){
  const ref=String(referenceImage||"").trim();
  if(ref && !isInvalidImageToolSource(ref))return ref;
  const latest=getLibrary().find(x=>x?.type==="image"&&x?.url&&!isInvalidImageToolSource(x.url));
  return String(latest?.url||"").trim();
}
function isCleverUtilsHomepage(url){
  try{
   const u=new URL(String(url||""),window.location.origin);
   return /^(?:www\.)?cleverutils\.com$/i.test(u.hostname)
     && u.pathname==="/"
     && !u.search
     && !u.hash;
  }catch{return false}
}
function isInvalidImageToolSource(url){
  const value=String(url||"").trim();
  if(!value)return true;
  if(isCleverUtilsHomepage(value))return true;
  try{
    const u=new URL(value,window.location.origin);
    if(u.pathname==="/api/image-jpeg" && u.searchParams.has("url")){
      const nested=u.searchParams.get("url")||"";
      if(isCleverUtilsHomepage(nested))return true;
    }
  }catch{}
  return false;
}
async function waitForCleverUtilsJob(jobId){
 const started=Date.now();
 while(Date.now()-started<180000){
   await new Promise(r=>setTimeout(r,1800));
   const r=await fetch("https://cleverutils.com/api/v1/jobs/"+encodeURIComponent(jobId),{
     headers:{Accept:"application/json"},
     cache:"no-store"
   });
   const data=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(data?.message||data?.error||"CLEVERUTILS_JOB_STATUS_FAILED");
   const job=data?.data||data;
   const status=String(job?.status||"processing").toLowerCase();
   const outputUrl=String(job?.output?.url||job?.output_url||"").trim();
   if(status==="done"&&outputUrl)return outputUrl;
   if(["error","failed","canceled","cancelled"].includes(status)){
     throw new Error(String(job?.error?.message||job?.message||"CLEVERUTILS_JOB_FAILED"));
   }
 }
 throw new Error("CLEVERUTILS_JOB_TIMEOUT");
}

async function waitForImageToolJob(jobId){
 const started=Date.now();
 while(Date.now()-started<150000){
   await new Promise(r=>setTimeout(r,1800));
   const r=await fetch("/api/image?jobId="+encodeURIComponent(jobId),{cache:"no-store"});
   const data=await r.json().catch(()=>({}));
   if(!r.ok||data?.ok===false)throw new Error(data?.message||data?.error||"IMAGE_TOOL_STATUS_FAILED");
   if(data.outputUrl)return data.outputUrl;
   if(String(data.status||"").toLowerCase()==="error")throw new Error("IMAGE_TOOL_JOB_FAILED");
 }
 throw new Error("IMAGE_TOOL_TIMEOUT");
}

async function cleverUtilsMcpRequest(payload){
 const response=await fetch("https://cleverutils.com/mcp",{
   method:"POST",
   headers:{"Content-Type":"application/json","Accept":"application/json, text/event-stream"},
   body:JSON.stringify(payload),
   cache:"no-store"
 });
 const textBody=await response.text();
 if(!response.ok)throw new Error("CLEVERUTILS_MCP_HTTP_"+response.status);
 try{return JSON.parse(textBody)}catch{}
 for(const line of textBody.split(/\r?\n/)){
   const value=line.trim();
   if(!value.startsWith("data:"))continue;
   try{return JSON.parse(value.slice(5).trim())}catch{}
 }
 throw new Error("CLEVERUTILS_MCP_INVALID_RESPONSE");
}

 const init=await cleverUtilsMcpRequest({
   jsonrpc:"2.0",id:1,method:"initialize",
   params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"Miya Studio",version:"1.0"}}
 });
 if(init?.error)throw new Error(String(init.error.message||"CLEVERUTILS_MCP_INITIALIZE_FAILED"));
 const call=await cleverUtilsMcpRequest({
   jsonrpc:"2.0",id:2,method:"tools/call",
   params:{name:"upscale_image",arguments:{file,scale:Number(scale),model}}
 });
 if(call?.error)throw new Error(String(call.error.message||"CLEVERUTILS_MCP_UPSCALE_FAILED"));
 const root=call?.result||call;
 const directLink=Array.isArray(root?.content)
   ? root.content.find(x=>x?.type==="resource_link"&&typeof x.uri==="string")?.uri||""
   : "";
 if(directLink)return directLink;
 let found="";
 const walk=(value,seen=new Set())=>{
   if(!value||found)return;
   if(typeof value==="string"){
     if(/^https?:\/\//i.test(value))found=value;
     return;
   }
   if(typeof value!=="object"||seen.has(value))return;
   seen.add(value);
   if(Array.isArray(value)){value.forEach(v=>walk(v,seen));return}
   Object.values(value).forEach(v=>walk(v,seen));
 };
 walk(root);
 return found;
}
async function makeCleverUtilsImageFile(blob){
 const rawType=String(blob?.type||"").toLowerCase().split(";")[0].trim();
 const supported=new Set(["image/jpeg","image/png","image/webp","image/gif","image/bmp","image/tiff"]);
 if(blob?.size&&supported.has(rawType)){
   const ext={ "image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","image/bmp":"bmp","image/tiff":"tiff" }[rawType]||"jpg";
   return new File([blob],"miya-source."+ext,{type:rawType});
 }
 if(!blob?.size)throw new Error("EMPTY_IMAGE");
 try{
   const bitmap=await createImageBitmap(blob);
   if(!bitmap.width||!bitmap.height)throw new Error("IMAGE_DIMENSIONS_INVALID");
   const canvas=document.createElement("canvas");
   canvas.width=bitmap.width;canvas.height=bitmap.height;
   const ctx=canvas.getContext("2d",{alpha:false});
   if(!ctx)throw new Error("CANVAS_UNAVAILABLE");
   ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(bitmap,0,0);
   bitmap.close();
   const jpg=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.95));
   if(!jpg||!jpg.size)throw new Error("IMAGE_NORMALIZE_FAILED");
   return new File([jpg],"miya-source.jpg",{type:"image/jpeg"});
 }catch(e){
   console.warn("CleverUtils image MIME normalization failed",e);
   throw new Error("IMAGE_DECODE_FAILED");
 }
}


function closeAiEditor(){
 const modal=$("#aiEditorModal");
 if(!modal)return;
 modal.classList.remove("open");
 document.body.classList.remove("ai-editor-open");
}
async function openAiEditor(item){
 if(!document.getElementById("miyaAiEditorFullCss")){
  const st=document.createElement("style");st.id="miyaAiEditorFullCss";st.textContent=`
.ai-editor-modal{z-index:2147483000!important}.ai-editor-modal.open{display:block!important}
body.ai-editor-open{overflow:hidden!important}
body.ai-editor-open .composer{display:none!important;visibility:hidden!important;pointer-events:none!important}
body.ai-editor-open .composer-input-area{visibility:hidden!important;pointer-events:none!important}\nbody.ai-editor-open .composer-wrap,body.ai-editor-open #voiceOptions,body.ai-editor-open #videoOptions,body.ai-editor-open .image-settings{display:none!important;visibility:hidden!important;pointer-events:none!important}
.ai-editor-dialog{inset:2vh 2vw!important;border-radius:24px!important;overflow:hidden!important;box-shadow:0 24px 90px rgba(0,0,0,.38)!important;display:grid!important;grid-template-rows:auto minmax(0,1fr)!important}
.ai-editor-head{min-height:68px!important;padding:12px 16px!important;border-bottom:1px solid rgba(255,255,255,.08)!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important}
.ai-editor-eyebrow{font-size:10px!important;letter-spacing:.16em!important;font-weight:900!important;opacity:.52!important}
.ai-editor-head h2{margin:3px 0 0!important;font-size:23px!important;letter-spacing:-.03em!important}
.ai-editor-head-actions{display:flex;align-items:center;gap:7px}
.ai-editor-quickbar{display:flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.ai-editor-reset-view,.ai-editor-close,.ai-editor-quick{border:1px solid rgba(255,255,255,.12)!important;background:rgba(255,255,255,.07)!important;color:#fff!important;border-radius:10px!important;min-height:36px!important;padding:7px 10px!important;font-weight:800!important;cursor:pointer!important}
.ai-editor-quick{font-size:12px!important;white-space:nowrap!important}
.ai-editor-quick:hover,.ai-editor-reset-view:hover,.ai-editor-close:hover{background:rgba(255,255,255,.12)!important}
.ai-editor-close{width:40px!important;padding:0!important;font-size:22px!important;flex:0 0 auto!important;pointer-events:auto!important;position:relative!important;z-index:20!important}
.ai-editor-workspace{display:grid!important;grid-template-columns:minmax(0,1fr) 340px!important;min-height:0!important;height:100%!important;overflow:hidden!important}
.ai-editor-stage{overflow:hidden!important;min-width:0!important;min-height:0!important;padding:14px!important;background:radial-gradient(circle at 50% 38%,rgba(144,106,255,.10),transparent 48%)!important}
.ai-editor-canvas-wrap{position:relative!important;width:100%!important;height:100%!important;border-radius:18px!important;overflow:hidden!important;background:repeating-conic-gradient(rgba(255,255,255,.035) 0 25%,rgba(255,255,255,.015) 0 50%) 0/24px 24px!important;border:1px solid rgba(255,255,255,.09)!important;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08),0 16px 40px rgba(0,0,0,.18)!important;display:grid!important;place-items:center!important}
.ai-editor-image{transform-origin:center center;transition:filter .12s ease,transform .12s ease;max-width:94%!important;max-height:94%!important;object-fit:contain!important}
.ai-editor-mask{opacity:.42!important;background:transparent!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important}
.ai-editor-sidebar{overflow:hidden!important;display:flex!important;flex-direction:column!important;gap:8px!important;padding:10px!important;background:rgba(0,0,0,.10)!important;min-height:0!important}
.ai-editor-section{padding:10px!important;border:1px solid rgba(255,255,255,.09)!important;border-radius:14px!important;background:rgba(255,255,255,.045)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important}
.ai-editor-section-title{display:flex;align-items:center;gap:7px;font-size:10px!important;text-transform:uppercase;letter-spacing:.12em;font-weight:900;opacity:.62;margin-bottom:7px}
.ai-editor-section-help{font-size:10px;line-height:1.3;opacity:.48;margin:-2px 0 7px}
.ai-editor-tool-grid,.ai-editor-view-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.ai-editor-tool,.ai-editor-undo,.ai-editor-redo,.ai-editor-clear,.ai-editor-view-btn{border:1px solid rgba(255,255,255,.10)!important;background:rgba(255,255,255,.065)!important;color:#fff!important;border-radius:9px!important;padding:7px 7px!important;font-weight:800!important;cursor:pointer!important;min-height:34px!important}
.ai-editor-tool:hover,.ai-editor-undo:hover,.ai-editor-redo:hover,.ai-editor-clear:hover,.ai-editor-view-btn:hover{background:rgba(255,255,255,.105)!important;border-color:rgba(255,255,255,.18)!important}
.ai-editor-tool.active{background:linear-gradient(135deg,rgba(155,114,255,.30),rgba(111,80,210,.20))!important;border-color:rgba(182,151,255,.62)!important;box-shadow:0 6px 20px rgba(115,78,220,.15)!important}
.ai-editor-range-label{display:flex;justify-content:space-between;gap:12px;margin:7px 0 4px;font-size:10px;opacity:.72}
.ai-editor-range-label b{opacity:1}.ai-editor-size,.ai-editor-zoom,.ai-editor-adjust{width:100%;accent-color:#a982ff}
.ai-editor-actions-row{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:6px}.ai-editor-clear{width:100%;margin-top:6px}
.ai-editor-zoom-row{display:grid;grid-template-columns:34px minmax(0,1fr) 34px 48px;align-items:center;gap:5px}
.ai-editor-zoom-value{font-size:10px;text-align:right;opacity:.75}.ai-editor-adjust-group{margin-top:5px}
.ai-editor-prompt-box{position:absolute;z-index:2147483100;width:min(170px,32%);min-width:160px;display:none;padding:10px;border:1px solid rgba(255,255,255,.20);border-radius:15px;background:rgba(20,17,29,.88);box-shadow:0 14px 40px rgba(0,0,0,.30);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.ai-editor-prompt-box.open{display:block}.ai-editor-prompt-label{font-size:10px;text-transform:uppercase;letter-spacing:.11em;font-weight:900;opacity:.58;margin-bottom:6px}
.ai-editor-prompt-input{width:100%;min-height:42px;max-height:72px;resize:none;border:1px solid rgba(255,255,255,.12);border-radius:11px;background:rgba(255,255,255,.07);color:#fff;padding:9px;font:inherit;font-size:12px;outline:none}
.ai-editor-prompt-input:focus{border-color:rgba(177,142,255,.65);box-shadow:0 0 0 3px rgba(145,103,255,.12)}
.ai-editor-prompt-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}.ai-editor-prompt-actions button{min-height:34px;border-radius:9px;border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.07);color:#fff;font-weight:800;cursor:pointer}.ai-editor-prompt-actions .primary{border:0;background:linear-gradient(135deg,#9b72ff,#7251d9)}
.ai-editor-hint{padding:8px 9px;border-radius:11px;background:rgba(255,255,255,.045);font-size:10px;line-height:1.3;color:rgba(255,255,255,.58)}
.ai-editor-footer{display:grid;grid-template-columns:.72fr 1fr 1.15fr;gap:6px;margin-top:auto;padding-top:7px;border-top:1px solid rgba(255,255,255,.08)}
.ai-editor-cancel,.ai-editor-download,.ai-editor-apply{min-height:40px;border-radius:10px;padding:8px 7px;font-weight:900;cursor:pointer}
.ai-editor-cancel,.ai-editor-download{border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.06);color:#fff}
.ai-editor-apply{border:0;background:linear-gradient(135deg,#9b72ff,#7251d9);color:#fff;box-shadow:0 8px 22px rgba(115,78,220,.22)}
.ai-editor-apply:disabled{opacity:.42;cursor:not-allowed}
@media(max-width:800px){.ai-editor-dialog{inset:1vh 1vw!important}.ai-editor-workspace{grid-template-columns:1fr!important;grid-template-rows:minmax(0,1fr) auto!important}.ai-editor-sidebar{max-height:44vh!important}.ai-editor-stage{padding:10px!important}.ai-editor-image{max-height:54vh!important}.ai-editor-prompt-box{width:calc(100% - 20px);left:10px!important;bottom:10px!important;top:auto!important}.ai-editor-hint{display:none}.ai-editor-reset-view{display:none}}
`;document.head.appendChild(st);
 }
 if(!item)return;
 let modal=$("#aiEditorModal");
 let generation=null,brushCursor=null;
 if(!modal){
  modal=document.createElement("div");modal.id="aiEditorModal";modal.className="ai-editor-modal";
  if(!document.getElementById("miyaAiEditorModernStyles")){
 const s=document.createElement("style");
 s.id="miyaAiEditorModernStyles";
 s.textContent=".ai-editor-dialog{width:min(1440px,calc(100vw - 32px));max-height:calc(100vh - 32px);border:1px solid rgba(176,130,255,.22);border-radius:28px;overflow:hidden;background:linear-gradient(145deg,#0a1022,#11162c 58%,#171331);box-shadow:0 30px 100px rgba(0,0,0,.58)}.ai-editor-head{min-height:76px;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(10,14,31,.82);backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:space-between;gap:16px}.ai-editor-eyebrow{font-size:10px;letter-spacing:.18em;color:#a987ff;font-weight:800}.ai-editor-head h2{margin:3px 0 0;font-size:22px;letter-spacing:-.03em}.ai-editor-head-actions{display:flex;align-items:center;gap:10px;min-width:0}.ai-editor-quickbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.ai-editor-quick,.ai-editor-reset-view,.ai-editor-close{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.055);color:#edf0ff;border-radius:11px;height:34px;padding:0 10px;font-weight:700;cursor:pointer;transition:.18s}.ai-editor-quick:hover,.ai-editor-reset-view:hover{background:rgba(167,92,255,.16);border-color:rgba(181,139,255,.42);transform:translateY(-1px)}.ai-editor-close{width:38px;padding:0;font-size:23px;line-height:1}.ai-editor-workspace{display:grid;grid-template-columns:minmax(0,1fr) 330px;min-height:620px;height:calc(100vh - 140px)}.ai-editor-stage{min-width:0;min-height:0;padding:18px;background:radial-gradient(circle at 50% 30%,rgba(130,85,255,.11),transparent 42%),#070b17}.ai-editor-canvas-wrap{position:relative;width:100%;height:100%;min-height:560px;border:1px solid rgba(255,255,255,.08);border-radius:22px;overflow:hidden;background:linear-gradient(45deg,#111522 25%,#0d111d 25%,#0d111d 50%,#111522 50%,#111522 75%,#0d111d 75%);background-size:28px 28px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.2)}.ai-editor-image{max-width:100%;max-height:100%;object-fit:contain;transition:filter .18s,transform .18s}.ai-editor-sidebar{overflow:auto;padding:16px;background:rgba(12,16,34,.92);border-left:1px solid rgba(255,255,255,.08)}.ai-editor-section{padding:14px;margin-bottom:10px;border:1px solid rgba(255,255,255,.075);border-radius:18px;background:rgba(255,255,255,.025)}.ai-editor-section-title{font-size:12px;font-weight:800;letter-spacing:.03em;margin-bottom:11px;color:#f3f0ff}.ai-editor-tool-grid,.ai-editor-ai-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ai-editor-tool,.ai-editor-ai-tool,.ai-editor-effect{min-height:38px;border:1px solid rgba(255,255,255,.08);border-radius:11px;background:rgba(255,255,255,.045);color:#e9eaff;font-weight:700;cursor:pointer}.ai-editor-tool.active,.ai-editor-effect.active{background:linear-gradient(135deg,rgba(167,92,255,.28),rgba(100,87,255,.18));border-color:rgba(181,139,255,.5)}.ai-editor-ai-tool:hover,.ai-editor-effect:hover,.ai-editor-tool:hover{border-color:rgba(181,139,255,.42);background:rgba(167,92,255,.12)}.ai-editor-range-label{display:flex;justify-content:space-between;gap:8px;margin:12px 0 6px;font-size:11px;color:#aeb5ca}.ai-editor-range-label b{color:#eeeaff}.ai-editor-adjust{width:100%}.ai-editor-actions-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.ai-editor-actions-row button,.ai-editor-clear{min-height:34px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.04);color:#dfe3f6;font-weight:700;cursor:pointer}.ai-editor-clear{width:100%;margin-top:7px}.ai-editor-hint{font-size:11px;line-height:1.5;color:#8992ad;padding:6px 3px 12px}.ai-editor-footer{position:sticky;bottom:0;display:grid;grid-template-columns:1fr 1fr;gap:7px;padding-top:10px;background:linear-gradient(180deg,transparent,rgba(12,16,34,.98) 20%)}.ai-editor-footer button{min-height:40px;border-radius:11px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#edf0ff;font-weight:800;cursor:pointer}.ai-editor-footer .ai-editor-apply{grid-column:1/-1;background:linear-gradient(135deg,#9a5cff,#6659ff);border:0}.ai-editor-prompt-box{border:1px solid rgba(180,140,255,.28);background:rgba(10,13,29,.94);backdrop-filter:blur(16px);border-radius:16px;padding:12px;box-shadow:0 18px 50px rgba(0,0,0,.4)}.ai-editor-prompt-input{width:100%;min-height:74px;resize:vertical;border-radius:11px;border:1px solid rgba(255,255,255,.1);background:#080b17;color:#fff;padding:10px;outline:none}.ai-editor-prompt-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:8px}.ai-editor-prompt-actions button{border:0;border-radius:10px;padding:9px 12px;font-weight:800}.ai-editor-prompt-actions .primary{background:#9a5cff;color:#fff}@media(max-width:980px){.ai-editor-workspace{grid-template-columns:1fr;height:auto;max-height:calc(100vh - 120px);overflow:auto}.ai-editor-sidebar{border-left:0;border-top:1px solid rgba(255,255,255,.08)}.ai-editor-stage{min-height:52vh}.ai-editor-canvas-wrap{min-height:46vh}.ai-editor-quickbar{display:none}}";
 document.head.appendChild(s);
if(!document.getElementById("miyaAiEditorFinalOverrides")){const x=document.createElement("style");x.id="miyaAiEditorFinalOverrides";x.textContent=".ai-editor-modal{position:fixed!important;inset:0!important;z-index:2147483000!important;display:none!important;align-items:center!important;justify-content:center!important;padding:16px!important;background:rgba(3,5,15,.72)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important}.ai-editor-modal.open{display:flex!important}.ai-editor-dialog{position:relative!important;inset:auto!important;width:min(1480px,calc(100vw - 32px))!important;height:min(900px,calc(100vh - 32px))!important;margin:0!important;border-radius:28px!important;overflow:hidden!important;background:linear-gradient(145deg,#0b1020,#10162a 55%,#17112d)!important;border:1px solid rgba(190,154,255,.28)!important;box-shadow:0 32px 110px rgba(0,0,0,.62)!important}.ai-editor-head{min-height:74px!important;padding:14px 18px 14px 22px!important;background:rgba(11,15,31,.82)!important;border-bottom:1px solid rgba(255,255,255,.08)!important}.ai-editor-workspace{grid-template-columns:minmax(0,1fr) 350px!important;height:auto!important;min-height:0!important}.ai-editor-stage{padding:18px!important;background:radial-gradient(circle at 50% 42%,rgba(126,82,255,.12),transparent 42%),linear-gradient(180deg,#080c18,#070a13)!important}.ai-editor-canvas-wrap{min-height:0!important;border-radius:22px!important;background:radial-gradient(circle at 50% 50%,#171d31,#101525 48%,#0b101e)!important;background-image:none!important;border:1px solid rgba(255,255,255,.08)!important;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18),0 20px 50px rgba(0,0,0,.24)!important}.ai-editor-sidebar{padding:12px!important;gap:10px!important;background:rgba(9,13,27,.94)!important;border-left:1px solid rgba(255,255,255,.08)!important}.ai-editor-section{padding:13px!important;border-radius:17px!important;background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.018))!important;border:1px solid rgba(255,255,255,.075)!important}.ai-editor-tool,.ai-editor-ai-tool,.ai-editor-effect,.ai-editor-undo,.ai-editor-redo,.ai-editor-clear{min-height:39px!important;border-radius:11px!important;background:rgba(255,255,255,.045)!important;border:1px solid rgba(255,255,255,.09)!important;color:#e9e7f5!important;font-weight:800!important}.ai-editor-tool:hover,.ai-editor-ai-tool:hover,.ai-editor-effect:hover,.ai-editor-undo:hover,.ai-editor-redo:hover,.ai-editor-clear:hover{background:rgba(157,111,255,.13)!important;border-color:rgba(190,154,255,.34)!important}.ai-editor-tool.active,.ai-editor-effect.active{background:linear-gradient(135deg,rgba(157,111,255,.27),rgba(99,77,220,.18))!important;border-color:rgba(193,157,255,.58)!important}.ai-editor-modal svg{width:17px!important;height:17px!important;display:block!important;flex:0 0 auto!important;fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round!important;stroke-linejoin:round!important}.ai-editor-modal button{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:7px!important}.ai-editor-modal .icon-button{width:36px!important;min-width:36px!important;padding:0!important}.ai-editor-modal .ai-editor-section button span{display:inline-block!important;white-space:nowrap!important}.ai-editor-close:hover{background:rgba(255,90,120,.13)!important;border-color:rgba(255,130,155,.35)!important}@media(max-width:980px){.ai-editor-dialog{width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important;border-radius:20px!important}.ai-editor-workspace{grid-template-columns:1fr!important;overflow:auto!important}.ai-editor-sidebar{max-height:44vh!important}.ai-editor-quickbar{display:none!important}}";document.head.appendChild(x);}
if(!document.getElementById("miyaAiEditorInteractionStyles")){const z=document.createElement("style");z.id="miyaAiEditorInteractionStyles";z.textContent=".ai-editor-canvas-wrap{cursor:none!important}.ai-editor-brush-cursor{position:absolute;z-index:40;display:none;transform:translate(-50%,-50%);border:1.5px solid rgba(255,255,255,.95);border-radius:50%;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,.65),0 0 12px rgba(160,120,255,.35)}.ai-editor-brush-cursor.eraser{border-color:#ffb9c8}";document.head.appendChild(z)}
if(!document.getElementById("miyaAiEditorGenerationStyles")){const g=document.createElement("style");g.id="miyaAiEditorGenerationStyles";g.textContent=".ai-editor-generation{position:absolute;inset:0;z-index:35;display:grid;place-items:center;background:rgba(7,10,20,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.ai-editor-generation[hidden]{display:none!important}.ai-editor-generation-card{width:min(360px,70%);padding:22px;border:1px solid rgba(190,154,255,.24);border-radius:22px;background:rgba(14,17,34,.94);text-align:center}.ai-editor-generation-ring{width:92px;height:92px;margin:0 auto 14px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#9a5cff var(--progress,0%),rgba(255,255,255,.09) 0)}.ai-editor-generation-percent{font-size:18px;font-weight:900}.ai-editor-generation-title{font-size:14px;font-weight:900}.ai-editor-generation-model{margin-top:4px;font-size:11px;opacity:.58}.ai-editor-generation-bar{height:5px;margin-top:15px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.08)}.ai-editor-generation-bar span{display:block;height:100%;width:0;background:linear-gradient(90deg,#9a5cff,#bd8cff)}";document.head.appendChild(g)}

}
modal.innerHTML=`<div class="ai-editor-backdrop"></div><div class="ai-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="aiEditorTitle">
  <div class="ai-editor-head"><div><div class="ai-editor-eyebrow">MIYA AI EDITOR</div><h2 id="aiEditorTitle">AI Редактор</h2></div><div class="ai-editor-head-actions"><div class="ai-editor-quickbar"><button type="button" class="ai-editor-quick icon-button" data-view-action="zoom-out" title="Уменьшить масштаб"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button><button type="button" class="ai-editor-quick icon-button" data-view-action="zoom-in" title="Увеличить масштаб"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button><button type="button" class="ai-editor-quick icon-button" data-view-action="fit" title="Вписать изображение"><svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/></svg></button><button type="button" class="ai-editor-quick icon-button" data-view-action="rotate-left" title="Повернуть влево"><svg viewBox="0 0 24 24"><path d="M9 5 5 9l4 4"/><path d="M5 9a8 8 0 1 1 2.3 5.7"/></svg></button><button type="button" class="ai-editor-quick icon-button" data-view-action="rotate-right" title="Повернуть вправо"><svg viewBox="0 0 24 24"><path d="m15 5 4 4-4 4"/><path d="M19 9a8 8 0 1 0-2.3 5.7"/></svg></button><button type="button" class="ai-editor-quick icon-button" data-view-action="flip-h" title="Отразить горизонтально"><svg viewBox="0 0 24 24"><path d="M12 4v16M5 7h4v10H5zM15 7h4v10h-4z"/></svg></button><button type="button" class="ai-editor-quick icon-button" data-view-action="flip-v" title="Отразить вертикально"><svg viewBox="0 0 24 24"><path d="M4 12h16M7 5h10v4H7zM7 15h10v4H7z"/></svg></button><button type="button" class="ai-editor-quick icon-button" data-view-action="reset" title="Сбросить вид"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 5v7h7"/></svg></button><button type="button" class="ai-editor-reset-view" title="Вернуть масштаб, поворот, отражение и коррекцию к исходным значениям">Сбросить вид</button></div><button type="button" class="ai-editor-close" aria-label="Закрыть" title="Закрыть редактор">×</button></div></div>
  <div class="ai-editor-workspace"><div class="ai-editor-stage"><div class="ai-editor-canvas-wrap"><img class="ai-editor-image" alt="Изображение для редактирования" draggable="false"><canvas class="ai-editor-mask"></canvas><div class="ai-editor-brush-cursor" aria-hidden="true"></div><div class="ai-editor-generation" hidden><div class="ai-editor-generation-card"><div class="ai-editor-generation-ring"><span class="ai-editor-generation-percent">0%</span></div><div class="ai-editor-generation-title">Создание изменения</div><div class="ai-editor-generation-model">AI Editor</div><div class="ai-editor-generation-bar"><span></span></div></div></div><div class="ai-editor-empty">Загрузка изображения…</div><div class="ai-editor-prompt-box"><div class="ai-editor-prompt-label">Что создать в выделенной области?</div><textarea class="ai-editor-prompt-input" placeholder="Например: добавь красную розу в руку, замени фон на ночной город…"></textarea><div class="ai-editor-prompt-actions"><button type="button" class="ai-editor-prompt-cancel">Отмена</button><button type="button" class="primary ai-editor-prompt-create">Создать / применить</button></div></div></div></div>
  <aside class="ai-editor-sidebar">
  <div class="ai-editor-section"><div class="ai-editor-section-title"><svg viewBox="0 0 24 24"><path d="M5 5h6v6H5zM13 13h6v6h-6z"/><path d="m13 5 6 6M5 19l6-6"/></svg><span>Выделение</span></div><div class="ai-editor-tool-grid"><button type="button" class="ai-editor-tool active" data-editor-tool="brush" title="Кисть"><svg viewBox="0 0 24 24"><path d="m4 20 5.2-1.2L19 9a2.1 2.1 0 0 0-3-3L6.2 15.8 5 21z"/><path d="m14.5 7.5 2 2"/></svg><span>Кисть</span></button><button type="button" class="ai-editor-tool" data-editor-tool="eraser" title="Ластик"><svg viewBox="0 0 24 24"><path d="m7 17-3-3a2 2 0 0 1 0-2.8l7.8-7.8a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L9.8 17H7z"/><path d="M12 17h8"/></svg><span>Ластик</span></button></div><label class="ai-editor-range-label"><span>Размер кисти</span><b class="ai-editor-size-value">60 px</b></label><input class="ai-editor-size" title="Изменяет размер кисти" type="range" min="8" max="320" step="2" value="60"><div class="ai-editor-actions-row"><button type="button" class="ai-editor-undo" disabled title="Отменить"><svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/></svg><span>Отменить</span></button><button type="button" class="ai-editor-redo" disabled title="Вернуть"><svg viewBox="0 0 24 24"><path d="m15 7 5 5-5 5"/><path d="M20 12H10a6 6 0 0 0-6 6"/></svg><span>Вернуть</span></button></div><button type="button" class="ai-editor-clear" title="Очистить выделение"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13"/></svg><span>Очистить выделение</span></button></div>
  <div class="ai-editor-section"><div class="ai-editor-section-title"><svg viewBox="0 0 24 24"><path d="m12 3 1.5 6L19 10.5 13.5 12 12 18l-1.5-6L5 10.5 10.5 9z"/></svg><span>AI инструменты</span></div><div class="ai-editor-ai-grid"><button type="button" class="ai-editor-ai-tool" data-editor-ai="enhance-photo"><svg viewBox="0 0 24 24"><path d="m12 3 1.3 5.7L19 10l-5.7 1.3L12 17l-1.3-5.7L5 10l5.7-1.3z"/></svg><span>Улучшить</span></button><button type="button" class="ai-editor-ai-tool" data-editor-ai="colorize-photo"><svg viewBox="0 0 24 24"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="7" r="2"/><circle cx="15" cy="16" r="3"/></svg><span>Раскрасить</span></button><button type="button" class="ai-editor-ai-tool" data-editor-ai="restore-old-photo"><svg viewBox="0 0 24 24"><path d="m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2z"/></svg><span>Восстановить</span></button><button type="button" class="ai-editor-ai-tool" data-editor-ai="remove-background"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="m8 15 3-3 2 2 2-3 3 4"/></svg><span>Удалить фон</span></button><button type="button" class="ai-editor-ai-tool" data-editor-ai="upscale-2"><svg viewBox="0 0 24 24"><path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4"/><path d="M9 15 15 9M11 9h4v4"/></svg><span>Upscale 2×</span></button><button type="button" class="ai-editor-ai-tool" data-editor-ai="upscale-4"><svg viewBox="0 0 24 24"><path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4"/><path d="M8 16 16 8M12 8h4v4"/></svg><span>Upscale 4×</span></button></div></div><div class="ai-editor-section"><div class="ai-editor-section-title"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="17" r="2"/></svg><span>Коррекция</span></div><div class="ai-editor-adjust-group"><label class="ai-editor-range-label"><span>Яркость</span><b data-adjust-value="brightness">100%</b></label><input class="ai-editor-adjust" data-adjust="brightness" title="Светлее или темнее" type="range" min="50" max="150" value="100"></div><div class="ai-editor-adjust-group"><label class="ai-editor-range-label"><span>Контраст</span><b data-adjust-value="contrast">100%</b></label><input class="ai-editor-adjust" data-adjust="contrast" title="Сильнее или мягче контраст" type="range" min="50" max="150" value="100"></div><div class="ai-editor-adjust-group"><label class="ai-editor-range-label"><span>Насыщенность</span><b data-adjust-value="saturate">100%</b></label><input class="ai-editor-adjust" data-adjust="saturate" title="Интенсивность цветов" type="range" min="0" max="180" value="100"></div><div class="ai-editor-adjust-group"><label class="ai-editor-range-label"><span>Размытие</span><b data-adjust-value="blur">0 px</b></label><input class="ai-editor-adjust" data-adjust="blur" title="Размыть изображение" type="range" min="0" max="12" value="0"></div></div>
  <div class="ai-editor-section"><div class="ai-editor-section-title"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/></svg><span>Эффекты</span></div><div class="ai-editor-ai-grid"><button type="button" class="ai-editor-effect active" data-editor-effect="none">Оригинал</button><button type="button" class="ai-editor-effect" data-editor-effect="grayscale">Ч/Б</button><button type="button" class="ai-editor-effect" data-editor-effect="sepia">Сепия</button><button type="button" class="ai-editor-effect" data-editor-effect="vivid">Яркий</button></div></div><div class="ai-editor-hint">Выдели объект кистью → выбери «Удалить объект» или введи команду на фото. «Скачать копию» сохраняет текущий вид как JPG.</div>
  <div class="ai-editor-footer"><button type="button" class="ai-editor-cancel" title="Закрыть без сохранения">Отмена</button><button type="button" class="ai-editor-download" title="Скачать промежуточную копию JPG"><svg viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4M5 20h14"/></svg><span>Скачать копию</span></button><button type="button" class="ai-editor-apply" disabled title="Сохранить окончательный результат в Miya"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg><span>Сохранить в Miya</span></button></div>
  </aside></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector(".ai-editor-close").onclick=e=>{e.preventDefault();e.stopPropagation();closeAiEditor()};
  modal.querySelector(".ai-editor-cancel").onclick=e=>{e.preventDefault();e.stopPropagation();closeAiEditor()};
  modal.addEventListener("click",e=>{if(e.target===modal)closeAiEditor()});
  if(!window.__miyaAiEditorEscapeBound){window.__miyaAiEditorEscapeBound=true;document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.body.classList.contains("ai-editor-open"))closeAiEditor()})}
  const image=modal.querySelector(".ai-editor-image"),mask=modal.querySelector(".ai-editor-mask"),wrap=modal.querySelector(".ai-editor-canvas-wrap"),empty=modal.querySelector(".ai-editor-empty"),promptBox=modal.querySelector(".ai-editor-prompt-box"),promptInput=modal.querySelector(".ai-editor-prompt-input"),promptCreate=modal.querySelector(".ai-editor-prompt-create"),generationPercent=modal.querySelector(".ai-editor-generation-percent"),generationBar=modal.querySelector(".ai-editor-generation-bar span"),generationTitle=modal.querySelector(".ai-editor-generation-title"),generationModel=modal.querySelector(".ai-editor-generation-model");generation=modal.querySelector(".ai-editor-generation");brushCursor=modal.querySelector(".ai-editor-brush-cursor");
  const sizeInput=modal.querySelector(".ai-editor-size"),sizeValue=modal.querySelector(".ai-editor-size-value"),undoButton=modal.querySelector(".ai-editor-undo"),redoButton=modal.querySelector(".ai-editor-redo"),applyButton=modal.querySelector(".ai-editor-apply"),toolButtons=[...modal.querySelectorAll("[data-editor-tool]")],adjustInputs=[...modal.querySelectorAll("[data-adjust]")];
  let ctx=null,painting=false,lastX=0,lastY=0,tool="brush",history=[],redoHistory=[],naturalWidth=0,naturalHeight=0,currentItem=null,workingSource="",maskHasPaint=false,paintBounds=null,editorProgressTimer=0,view={zoom:100,rotate:0,flipX:1,flipY:1,brightness:100,contrast:100,saturate:100,blur:0,effect:"none"};
  const hasPaint=()=>maskHasPaint;
  const scanBounds=()=>{if(!ctx)return null;try{const d=ctx.getImageData(0,0,naturalWidth,naturalHeight).data;let minX=naturalWidth,minY=naturalHeight,maxX=-1,maxY=-1;for(let y=0;y<naturalHeight;y++){for(let x=0;x<naturalWidth;x++){if(d[(y*naturalWidth+x)*4+3]>10){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}}}return maxX<0?null:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}}catch{return null}};
  const getBounds=()=>paintBounds||scanBounds();
  const updatePromptPosition=()=>{if(!promptBox||!ctx)return;const b=getBounds();if(!b){promptBox.classList.remove("open");return}promptBox.style.removeProperty("left");promptBox.style.removeProperty("top");promptBox.classList.add("open")};
  const updateButtons=()=>{undoButton.disabled=!history.length;redoButton.disabled=!redoHistory.length;applyButton.disabled=false};
  const snapshot=()=>{if(!ctx)return;try{history.push(ctx.getImageData(0,0,naturalWidth,naturalHeight));if(history.length>20)history.shift();redoHistory=[];updateButtons()}catch{}};
  const clearMask=()=>{if(!ctx)return;ctx.clearRect(0,0,naturalWidth,naturalHeight);history=[];redoHistory=[];maskHasPaint=false;paintBounds=null;promptBox.classList.remove("open");updateButtons()};
  const point=ev=>{const r=mask.getBoundingClientRect();return{x:Math.max(0,Math.min(naturalWidth,(ev.clientX-r.left)*naturalWidth/r.width)),y:Math.max(0,Math.min(naturalHeight,(ev.clientY-r.top)*naturalHeight/r.height))}};
  const updateBrushCursor=ev=>{if(!brushCursor)return;const r=mask.getBoundingClientRect(),size=Number(sizeInput.value||60)*r.width/Math.max(1,naturalWidth);brushCursor.style.width=Math.max(4,Math.round(size))+"px";brushCursor.style.height=Math.max(4,Math.round(size))+"px";brushCursor.style.left=(ev.clientX-r.left)+"px";brushCursor.style.top=(ev.clientY-r.top)+"px";brushCursor.style.display="block";brushCursor.classList.toggle("eraser",tool==="eraser")};
  const hideBrushCursor=()=>{if(brushCursor)brushCursor.style.display="none"};
  const paint=ev=>{if(!painting||!ctx)return;const p=point(ev),brush=Number(sizeInput.value||60);ctx.save();ctx.globalCompositeOperation=tool==="eraser"?"destination-out":"source-over";ctx.strokeStyle="#fff";ctx.fillStyle="#fff";ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=brush;ctx.beginPath();ctx.moveTo(lastX,lastY);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.beginPath();ctx.arc(p.x,p.y,brush/2,0,Math.PI*2);ctx.fill();ctx.restore();lastX=p.x;lastY=p.y;if(tool==="brush"){maskHasPaint=true;const x=Math.max(0,p.x-brush/2),y=Math.max(0,p.y-brush/2),x2=Math.min(naturalWidth,p.x+brush/2),y2=Math.min(naturalHeight,p.y+brush/2);if(!paintBounds)paintBounds={x,y,w:x2-x,h:y2-y};else{const bx=Math.min(paintBounds.x,x),by=Math.min(paintBounds.y,y),ex=Math.max(paintBounds.x+paintBounds.w,x2),ey=Math.max(paintBounds.y+paintBounds.h,y2);paintBounds={x:bx,y:by,w:ex-bx,h:ey-by}}}updateBrushCursor(ev);updateButtons();ev.preventDefault()};
  mask.addEventListener("pointerdown",ev=>{if(!ctx)return;painting=true;mask.setPointerCapture?.(ev.pointerId);const p=point(ev);lastX=p.x;lastY=p.y;snapshot();paint(ev)});
  const pointerEnd=ev=>{painting=false;try{mask.releasePointerCapture?.(ev.pointerId)}catch{};if(tool==="eraser"&&maskHasPaint){paintBounds=scanBounds();maskHasPaint=!!paintBounds}if(maskHasPaint)requestAnimationFrame(updatePromptPosition);else promptBox.classList.remove("open");if(brushCursor)brushCursor.style.display="none"};mask.addEventListener("pointermove",ev=>{updateBrushCursor(ev);paint(ev)});mask.addEventListener("pointerleave",()=>{if(brushCursor)brushCursor.style.display="none"});mask.addEventListener("pointerup",pointerEnd);mask.addEventListener("pointercancel",pointerEnd);
  sizeInput.oninput=()=>{sizeValue.textContent=sizeInput.value+" px";if(brushCursor)updateBrushCursor({clientX:mask.getBoundingClientRect().left+mask.getBoundingClientRect().width/2,clientY:mask.getBoundingClientRect().top+mask.getBoundingClientRect().height/2})};
  toolButtons.forEach(b=>b.onclick=()=>{tool=b.dataset.editorTool;toolButtons.forEach(x=>x.classList.toggle("active",x===b));wrap.classList.toggle("eraser-active",tool==="eraser")});
  undoButton.onclick=()=>{if(!ctx||!history.length)return;redoHistory.push(ctx.getImageData(0,0,naturalWidth,naturalHeight));ctx.putImageData(history.pop(),0,0);updateButtons()};
  redoButton.onclick=()=>{if(!ctx||!redoHistory.length)return;history.push(ctx.getImageData(0,0,naturalWidth,naturalHeight));ctx.putImageData(redoHistory.pop(),0,0);updateButtons()};
  modal.querySelector(".ai-editor-clear").onclick=clearMask;
  const editorFilter=()=>{const fx=view.effect==="grayscale"?" grayscale(1)":view.effect==="sepia"?" sepia(.78) hue-rotate(-8deg)":view.effect==="vivid"?" saturate(1.35) contrast(1.08)":"";return "brightness("+view.brightness+"%) contrast("+view.contrast+"%) saturate("+view.saturate+"%) blur("+view.blur+"px)"+fx}; const applyView=()=>{image.style.transform="rotate("+view.rotate+"deg) scale("+((view.zoom/100)*view.flipX)+","+((view.zoom/100)*view.flipY)+")";image.style.filter=editorFilter();requestAnimationFrame(updatePromptPosition)};
  const resetView=()=>{view={zoom:100,rotate:0,flipX:1,flipY:1,brightness:100,contrast:100,saturate:100,blur:0,effect:"none"};adjustInputs.forEach(inputEl=>{inputEl.value=inputEl.dataset.adjust==="blur"?"0":"100";const valueEl=modal.querySelector('[data-adjust-value="'+inputEl.dataset.adjust+'"]');if(valueEl)valueEl.textContent=inputEl.dataset.adjust==="blur"?"0 px":"100%"});applyView()};
  
  modal.querySelectorAll("[data-view-action]").forEach(b=>b.onclick=()=>{const a=b.dataset.viewAction;if(a==="zoom-out")view.zoom=Math.max(50,view.zoom-10);else if(a==="zoom-in")view.zoom=Math.min(200,view.zoom+10);else if(a==="fit")view.zoom=100;else if(a==="rotate-left")view.rotate=(view.rotate+270)%360;else if(a==="rotate-right")view.rotate=(view.rotate+90)%360;else if(a==="flip-h")view.flipX*=-1;else if(a==="flip-v")view.flipY*=-1;else if(a==="reset")resetView();applyView()});
  modal.querySelector(".ai-editor-reset-view").onclick=()=>resetView();
  modal.querySelectorAll("[data-editor-effect]").forEach(b=>b.onclick=()=>{view.effect=b.dataset.editorEffect||"none";modal.querySelectorAll("[data-editor-effect]").forEach(x=>x.classList.toggle("active",x===b));applyView()}); modal.querySelectorAll("[data-editor-ai]").forEach(b=>b.onclick=async()=>{const action=b.dataset.editorAi;const labels={"enhance-photo":"Улучшение фото","colorize-photo":"Раскрашивание","restore-old-photo":"Восстановление фото","remove-background":"Удаление фона","upscale-2":"Upscale 2×","upscale-4":"Upscale 4×"};const label="CleverUtils · "+(labels[action]||action);const old=b.innerHTML;b.disabled=true;b.textContent="Обработка…";setEditorProgress(0,label,label);try{const sourceBlob=await editorSourceBlob();const uploadFile=await makeCleverUtilsImageFile(sourceBlob);const form=new FormData();form.append("file",uploadFile);if(action==="upscale-2"||action==="upscale-4"){form.append("scale",action==="upscale-2"?"2":"4");form.append("model","fast")}setEditorProgress(18,label,label);const endpoint=action.startsWith("upscale-")?"upscale-image":action;const rr=await fetch("https://cleverutils.com/api/v1/tools/"+encodeURIComponent(endpoint),{method:"POST",body:form,headers:{Accept:"application/json"},cache:"no-store"});const data=await rr.json().catch(()=>({}));if(!rr.ok)throw new Error(data?.message||data?.error?.message||data?.error||"IMAGE_TOOL_FAILED");const job=data?.data||data;let outputUrl=typeof job?.output?.url==="string"?job.output.url:String(job?.outputUrl||"");const jobId=typeof job?.job_id==="string"?job.job_id:String(job?.jobId||"");setEditorProgress(55,label,label);if(jobId)outputUrl="/api/image?jobId="+encodeURIComponent(jobId)+"&output=1";if(!outputUrl)throw new Error("IMAGE_TOOL_OUTPUT_MISSING");setEditorProgress(92,label,label);await loadEditorOutput(outputUrl);setEditorProgress(100,label,label);await new Promise(r=>setTimeout(r,450));hideEditorProgress();toast(label+" · готово, пока в редакторе")}catch(err){hideEditorProgress();console.error("Miya editor AI tool failed",err);toast(String(err?.message||"Инструмент не сработал"))}finally{b.disabled=false;b.innerHTML=old}}); adjustInputs.forEach(inputEl=>inputEl.oninput=()=>{view[inputEl.dataset.adjust]=Number(inputEl.value);const valueEl=modal.querySelector('[data-adjust-value="'+inputEl.dataset.adjust+'"]');if(valueEl)valueEl.textContent=inputEl.dataset.adjust==="blur"?inputEl.value+" px":inputEl.value+"%";applyView()});
  const loadImage=src=>new Promise((res,rej)=>{image.onload=()=>{image.onload=null;image.onerror=null;res()};image.onerror=()=>{image.onload=null;image.onerror=null;rej(new Error("EDITOR_IMAGE_LOAD_FAILED"))};image.src=src});
  const loadBlob=async src=>{const rr=await fetch(src,{cache:"no-store"});if(!rr.ok)throw new Error("EDITOR_FETCH_"+rr.status);const blob=await rr.blob();if(!/^image\//i.test(blob.type))throw new Error("EDITOR_FETCH_NOT_IMAGE");const u=URL.createObjectURL(blob);await loadImage(u);return u};
  modal.__load=async item2=>{currentItem=item2;workingSource="";empty.style.display="flex";empty.textContent="Загрузка изображения…";image.removeAttribute("src");clearMask();resetView();const candidates=[];try{const cached=await getCachedMedia(item2?.id);if(cached?.blob)candidates.push(URL.createObjectURL(cached.blob))}catch{}const url=await mediaItemToReference(item2);if(url){candidates.push(url);const proxied=jpegImageUrl(url);if(proxied!==url)candidates.push(proxied);if(!/^data:image\//i.test(url)&&!/^blob:/i.test(url))candidates.push("/api/image?url="+encodeURIComponent(url))}let ok=false,last=null;for(const candidate of candidates){try{await loadImage(candidate);ok=true;break}catch(e){last=e;try{if(candidate.startsWith("/api/")){await loadBlob(candidate);ok=true;break}}catch(fe){last=fe}}}if(!ok)throw(last||new Error("EDITOR_IMAGE_LOAD_FAILED"));naturalWidth=image.naturalWidth;naturalHeight=image.naturalHeight;if(!naturalWidth||!naturalHeight)throw new Error("EDITOR_IMAGE_DIMENSIONS_INVALID");workingSource=image.src;mask.width=naturalWidth;mask.height=naturalHeight;ctx=mask.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("AI_EDITOR_CANVAS_UNAVAILABLE");ctx.clearRect(0,0,naturalWidth,naturalHeight);history=[];redoHistory=[];updateButtons();empty.style.display="none"};
  const setEditorProgress=(p,title,model)=>{if(!generation)return;const v=Math.max(0,Math.min(100,Math.round(p)));if(editorProgressTimer){clearInterval(editorProgressTimer);editorProgressTimer=0}generation.hidden=false;generationTitle.textContent=title||"Создание изменения";generationModel.textContent=model||"AI Editor";generationPercent.textContent=v+"%";generationBar.style.width=v+"%";generation.querySelector(".ai-editor-generation-ring").style.setProperty("--progress",v+"%");if(v<100){let live=v;editorProgressTimer=setInterval(()=>{live=Math.min(99,live+.7);generationPercent.textContent=Math.round(live)+"%";generationBar.style.width=live+"%";generation.querySelector(".ai-editor-generation-ring").style.setProperty("--progress",live+"%");if(live>=99){clearInterval(editorProgressTimer);editorProgressTimer=0}},260)}};
  const hideEditorProgress=()=>{if(editorProgressTimer){clearInterval(editorProgressTimer);editorProgressTimer=0}if(generation)generation.hidden=true};
  const editorFetchImageBlob=async source=>{const value=String(source||"").trim();if(!value)throw new Error("EDITOR_SOURCE_EMPTY");if(/^data:image\//i.test(value)||/^blob:/i.test(value)){const rr=await fetch(value,{cache:"no-store"});if(!rr.ok)throw new Error("SOURCE_IMAGE_READ_FAILED");return rr.blob()}try{const u=new URL(value,window.location.origin);if(u.origin===window.location.origin){const rr=await fetch(value,{cache:"no-store"});if(!rr.ok)throw new Error("SOURCE_IMAGE_READ_FAILED");return rr.blob()}}catch(e){if(e?.message==="SOURCE_IMAGE_READ_FAILED")throw e}const rr=await fetch("/api/image?url="+encodeURIComponent(value),{cache:"no-store"});if(!rr.ok)throw new Error("SOURCE_IMAGE_READ_FAILED");return rr.blob()};
  const editorSourceBlob=async()=>editorFetchImageBlob(workingSource||image.src);
  const editorOutputData=async url=>{const source=String(url||"");if(!source)throw new Error("IMAGE_TOOL_OUTPUT_MISSING");let blob;try{blob=await editorFetchImageBlob(source)}catch{throw new Error("EDITOR_OUTPUT_FETCH_FAILED")}return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(reader.error||new Error("EDITOR_OUTPUT_READ_FAILED"));reader.readAsDataURL(blob)})};
  const loadEditorOutput=async url=>{const data=await editorOutputData(url);workingSource=data;await loadImage(data);naturalWidth=image.naturalWidth;naturalHeight=image.naturalHeight;mask.width=naturalWidth;mask.height=naturalHeight;ctx=mask.getContext("2d",{willReadFrequently:true});ctx.clearRect(0,0,naturalWidth,naturalHeight);maskHasPaint=false;paintBounds=null;history=[];redoHistory=[];updateButtons();applyView();empty.style.display="none"};
  const buildSourceCanvas=async()=>{const source=workingSource||image.src;if(!source)throw new Error("EDITOR_SOURCE_EMPTY");const blob=await editorFetchImageBlob(source);const url=URL.createObjectURL(blob);const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error("EDITOR_SOURCE_DECODE_FAILED"));img.src=url});URL.revokeObjectURL(url);const canvas=document.createElement("canvas");canvas.width=naturalWidth;canvas.height=naturalHeight;const o=canvas.getContext("2d");o.filter=editorFilter();o.drawImage(img,0,0,naturalWidth,naturalHeight);return canvas};
  const createFromSelection=async()=>{const command=String(promptInput.value||"").trim();const b=getBounds();if(!command||!b)return;promptCreate.disabled=true;promptCreate.textContent="Создание…";setEditorProgress(0,"Создание изменения","FLUX Kontext Dev");try{const base=await buildSourceCanvas();const crop=document.createElement("canvas");crop.width=b.w;crop.height=b.h;crop.getContext("2d").drawImage(base,b.x,b.y,b.w,b.h,0,0,b.w,b.h);setEditorProgress(15,"Создание изменения","FLUX Kontext Dev");const rr=await fetch("/api/image",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({mode:"image",provider:"ahm7",prompt:command,model:"FLUX Kontext Dev",ratio:"auto",outputFormat:"jpeg",copies:1,options:{imageBase64:crop.toDataURL("image/jpeg",.9)}})});const data=await rr.json().catch(()=>({}));if(!rr.ok||!data?.imageUrl)throw new Error(String(data?.message||data?.error||"Не удалось создать изменение"));setEditorProgress(82,"Применение изменения","FLUX Kontext Dev");const generatedData=await editorOutputData(data.imageUrl);const generated=new Image();await new Promise((res,rej)=>{generated.onload=res;generated.onerror=()=>rej(new Error("GENERATED_IMAGE_DECODE_FAILED"));generated.src=generatedData});const overlay=document.createElement("canvas");overlay.width=naturalWidth;overlay.height=naturalHeight;const oc=overlay.getContext("2d");oc.drawImage(generated,b.x,b.y,b.w,b.h);oc.globalCompositeOperation="destination-in";oc.drawImage(mask,0,0);base.getContext("2d").drawImage(overlay,0,0);await loadEditorOutput(base.toDataURL("image/jpeg",.93));clearMask();promptInput.value="";promptBox.classList.remove("open");setEditorProgress(100,"Изменение применено","FLUX Kontext Dev");await new Promise(r=>setTimeout(r,450));hideEditorProgress();toast("Изменение применено · пока в редакторе")}catch(err){hideEditorProgress();console.error("Miya AI editor create failed",err);toast(String(err?.message||"Не удалось создать изменение"))}finally{promptCreate.disabled=false;promptCreate.textContent="Создать / применить"}};
  promptBox.querySelector(".ai-editor-prompt-cancel").onclick=()=>{promptInput.value="";promptBox.classList.remove("open")};
  promptCreate.onclick=createFromSelection;
  applyButton.onclick=async()=>{await saveFinal()};;modal.querySelector(".ai-editor-download").onclick=async()=>{try{const source=await buildSourceCanvas();const url=source.toDataURL("image/jpeg",.95);const blob=await fetch(url).then(r=>r.blob());const objectUrl=URL.createObjectURL(blob);const a=document.createElement("a");a.href=objectUrl;a.download="miya-editor-copy.jpg";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000)}catch{toast("Не удалось скачать копию")}};
  const saveFinal=async()=>{if(!workingSource)return;try{setEditorProgress(100,"Сохранение","Miya Studio");const source=await buildSourceCanvas();const finalUrl=source.toDataURL("image/jpeg",.95);const saved=saveMedia("image",finalUrl,currentItem?.prompt||"Редактирование изображения","Miya AI Editor","jpg");if(!saved)throw new Error("SAVE_FAILED");await new Promise(r=>setTimeout(r,350));hideEditorProgress();closeAiEditor();renderImageLibrary();requestAnimationFrame(()=>scrollImagesToTop?.());toast("Фото сохранено в Miya")}catch(err){hideEditorProgress();toast(String(err?.message||"Не удалось сохранить фото"))}};


 }
 modal.classList.add("open");
 if(generation)generation.hidden=true;
 document.body.classList.add("ai-editor-open");
 try{await modal.__load(item)}catch(e){console.error("Miya AI editor open failed",e);closeAiEditor();toast("Не удалось открыть редактор")}
}
async function runImageTool(sourceOverride="",scaleOverride="",modelOverride=""){
 const source=String(sourceOverride||getImageToolSource()).trim();
 if(!source){toast("Сначала создай или загрузи изображение");return}
 if(isInvalidImageToolSource(source)){
   toast("Это старая ссылка CleverUtils. Выбери готовое изображение и попробуй снова.");
   return;
 }
 const scale=String(scaleOverride||$("#imageUpscaleScale")?.value||"2");
 const model="fast";
 const oldStatus=$("#composerStatus")?.textContent||"Готово";
 if($("#composerStatus"))$("#composerStatus").textContent="AI Upscale · Быстро · обработка…";
 try{
   let blob;
   if(/^data:image\//i.test(source)){
     const response=await fetch(source,{cache:"no-store"});
     if(!response.ok)throw new Error("SOURCE_IMAGE_READ_FAILED");
     blob=await response.blob();
   }else{
     let response;
     try{
       const isLocal=/^\//.test(source)||source.startsWith(window.location.origin+"/");
       response=await fetch(
         isLocal?source:"/api/image?url="+encodeURIComponent(source),
         {cache:"no-store"}
       );
     }catch{
       throw new Error("SOURCE_IMAGE_READ_FAILED");
     }
     if(!response.ok)throw new Error("SOURCE_IMAGE_PROXY_FAILED");
     const type=String(response.headers.get("content-type")||"").split(";")[0].toLowerCase();
     if(!/^image\//i.test(type))throw new Error("SOURCE_NOT_IMAGE");
     blob=await response.blob();
   }
   if(!blob||!blob.size)throw new Error("EMPTY_IMAGE");

   // Это именно тот исторически рабочий Fast-путь: не MCP и не серверный
   // multipart-прокси. Отправляем реальные байты файла напрямую CleverUtils.
   const uploadFile=await makeCleverUtilsImageFile(blob);
   const form=new FormData();
   form.append("file",uploadFile);
   form.append("scale",scale);
   form.append("model",model);

   const r=await fetch("https://cleverutils.com/api/v1/tools/upscale-image",{
     method:"POST",
     body:form,
     headers:{Accept:"application/json"},
     cache:"no-store"
   });
   const data=await r.json().catch(()=>({}));

   if(!r.ok){
     // Если REST снова вернёт MIME-ошибку, пробуем второй исторический
     // транспорт через MCP, но передаём именно raw base64, а не data: URL.
     const message=String(data?.message||data?.error?.message||data?.error||"");
     if(r.status===415||/UNSUPPORTED_MIME|corrupted|unsupported format/i.test(message)){
       const reader=new FileReader();
       const rawBase64=await new Promise((resolve,reject)=>{
         reader.onload=()=>{
           const value=String(reader.result||"");
           resolve(value.includes(",")?value.slice(value.indexOf(",")+1):value);
         };
         reader.onerror=()=>reject(reader.error||new Error("IMAGE_BASE64_READ_FAILED"));
         reader.readAsDataURL(uploadFile);
       });
       const mcpInit=await cleverUtilsMcpRequest({
         jsonrpc:"2.0",id:Date.now(),method:"initialize",
         params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"Miya Studio",version:"1.0"}}
       });
       if(mcpInit?.error)throw new Error(message||"CleverUtils MCP initialize failed");
       const mcpCall=await cleverUtilsMcpRequest({
         jsonrpc:"2.0",id:Date.now()+1,method:"tools/call",
         params:{name:"upscale_image",arguments:{file:rawBase64,scale:Number(scale),model}}
       });
       if(mcpCall?.error)throw new Error(String(mcpCall.error.message||message||"CleverUtils MCP failed"));
       const root=mcpCall?.result||mcpCall;
       if(root?.isError){
         const txt=Array.isArray(root.content)?root.content.find(x=>x?.type==="text")?.text:"";
         throw new Error(String(txt||message||"CleverUtils MCP upscale failed"));
       }
       const links=Array.isArray(root?.content)
         ?root.content.filter(x=>x?.type==="resource_link").map(x=>String(x.uri||x.url||"")).filter(Boolean)
         :[];
       if(links[0]) {
         const label="CleverUtils · AI Upscale "+scale+"x";
         const item=saveMedia("image",links[0],"AI upscale "+scale+"x",label,"");
         renderImageLibrary();
         requestAnimationFrame(()=>scrollImagesToTop?.());
         if($("#composerStatus"))$("#composerStatus").textContent=label+" · готово";
         toast("Upscale "+scale+"x готов");
         return item;
       }
       throw new Error("IMAGE_TOOL_OUTPUT_MISSING");
     }
     throw new Error(data?.message||data?.error?.message||data?.error||"IMAGE_TOOL_FAILED");
   }

   const job=data?.data||data;
   let outputUrl=typeof job?.output?.url==="string"
     ?job.output.url
     :String(job?.outputUrl||"");
   const jobId=typeof job?.job_id==="string"
     ?job.job_id
     :String(job?.jobId||"");
   if(!outputUrl&&jobId)outputUrl=await waitForImageToolJob(jobId);
   if(!outputUrl)throw new Error("IMAGE_TOOL_OUTPUT_MISSING");

   const label="CleverUtils · AI Upscale "+scale+"x";
   const item=saveMedia("image",outputUrl,"AI upscale "+scale+"x",label,"");
   renderImageLibrary();
   requestAnimationFrame(()=>scrollImagesToTop?.());
   if($("#composerStatus"))$("#composerStatus").textContent=label+" · готово";
   toast("Upscale "+scale+"x готов");
   return item;
 }catch(e){
   console.error("Miya image upscale failed",e);
   if($("#composerStatus"))$("#composerStatus").textContent=oldStatus+" · ошибка";
   toast(String(e?.message||"Не удалось увеличить изображение"));
 }
}
async function runImageBackgroundRemoval(item){
 const source=await mediaItemToReference(item);
 if(!source){toast("Не удалось получить исходное изображение");return}
 const oldStatus=$("#composerStatus")?.textContent||"Готово";
 if($("#composerStatus"))$("#composerStatus").textContent="Удаление фона · обработка…";
 try{
   let blob;
   if(/^data:image\//i.test(source)){
     const response=await fetch(source);
     if(!response.ok)throw new Error("SOURCE_IMAGE_READ_FAILED");
     blob=await response.blob();
   }else{
     const response=await fetch("/api/image?url="+encodeURIComponent(source),{cache:"no-store"});
     if(!response.ok)throw new Error("SOURCE_IMAGE_PROXY_FAILED");
     blob=await response.blob();
   }
   const uploadFile=await makeCleverUtilsImageFile(blob);
   const form=new FormData();
   form.append("file",uploadFile);
   const r=await fetch("https://cleverutils.com/api/v1/tools/remove-background",{method:"POST",body:form,headers:{Accept:"application/json"}});
   const data=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(data?.message||data?.error?.message||data?.error||"BACKGROUND_REMOVE_FAILED");
   const job=data?.data||data;
   let outputUrl=typeof job?.output?.url==="string"?job.output.url:"";
   const jobId=typeof job?.job_id==="string"?job.job_id:"";
   if(!outputUrl&&jobId)outputUrl=await waitForImageToolJob(jobId);
   if(!outputUrl)throw new Error("IMAGE_TOOL_OUTPUT_MISSING");
   const label="CleverUtils · Удаление фона";
   const saved=saveMedia("image",outputUrl,"Удаление фона",label,"");
   renderImageLibrary();
   requestAnimationFrame(()=>scrollImagesToTop?.());
   if($("#composerStatus"))$("#composerStatus").textContent=label+" · готово";
   toast("Фон удалён");
   return saved;
 }catch(e){
   console.error("Miya background removal failed",e);
   if($("#composerStatus"))$("#composerStatus").textContent=oldStatus+" · ошибка";
   toast(String(e?.message||"Не удалось удалить фон"));
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
 const d=$("#videoDuration"); if(d) d.value="5 сек";
 const progress=$("#composerProgress"); if(progress) progress.textContent="";
}
function updateVideoRatioVisibility(){
 const el=$("#videoRatio");
 const model=String($("#videoModel")?.value||"");
 if(el) el.style.display=model==="OmegaTech T2V"?"none":"";
}

function ensureToolsEditorStyles(){if(document.getElementById("miyaToolsEditorStyles"))return;const s=document.createElement("style");s.id="miyaToolsEditorStyles";s.textContent=`.audio-editor-launch-screen{position:relative!important;inset:auto!important;width:100%!important;min-height:calc(100vh - 150px)!important;box-sizing:border-box!important;display:grid!important;place-items:center!important;padding:30px!important;background:radial-gradient(circle at 50% 20%,rgba(151,104,255,.15),transparent 42%),linear-gradient(145deg,#07182b,#050f1d)!important}.audio-editor-launch-card{width:min(760px,92vw)!important;min-height:420px!important;box-sizing:border-box!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;text-align:center!important;padding:42px!important;border:1px solid rgba(174,132,255,.22)!important;border-radius:28px!important;background:rgba(255,255,255,.035)!important;box-shadow:0 30px 90px rgba(0,0,0,.35)!important}.audio-editor-launch-icon{width:78px;height:78px;border-radius:24px;display:grid;place-items:center;margin-bottom:20px;background:linear-gradient(135deg,#b65cff,#695dff);color:#fff;box-shadow:0 18px 45px rgba(111,77,226,.28)}.audio-editor-launch-icon svg{width:38px;height:38px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round}.audio-editor-launch-eyebrow{font-size:10px;letter-spacing:.18em;font-weight:900;color:#b78dff}.audio-editor-launch-card h2{margin:8px 0 8px;font-size:clamp(24px,4vw,38px);letter-spacing:-.045em}.audio-editor-launch-card p{max-width:540px;margin:0;color:#8397ad;font-size:12px;line-height:1.6}.audio-editor-launch-button{height:48px;margin-top:24px;padding:0 20px;display:flex;align-items:center;gap:9px;border:0;border-radius:14px;background:linear-gradient(135deg,#a95cff,#6e63ff);color:#fff;font-size:12px;font-weight:900;cursor:pointer;box-shadow:0 14px 34px rgba(104,66,210,.25)}.audio-editor-launch-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round}.audio-editor-launch-hint{margin-top:13px;font-size:10px;color:#667d95}.audio-editor-launch-screen.dragover .audio-editor-launch-card{border-color:rgba(195,164,255,.8);background:rgba(157,111,255,.11);transform:scale(1.01)}
.tools-main-btn{margin-top:4px}.tools-extra-actions{display:flex;flex-direction:column;gap:6px}.tools-editor{width:min(980px,100%);margin:0 auto;padding:8px 0 120px}.tools-editor-tabs{display:flex;gap:8px;padding:6px;background:rgba(120,100,180,.08);border:1px solid var(--line);border-radius:16px;margin-bottom:16px}.tools-editor-tab{flex:1;border:0;border-radius:11px;padding:12px 10px;background:transparent;color:var(--muted);font-weight:800;cursor:pointer}.tools-editor-tab.active{background:linear-gradient(135deg,#a95cff,#6e63ff);color:#fff}.tools-dropzone{min-height:420px;border:2px dashed rgba(154,111,255,.38);border-radius:24px;background:linear-gradient(145deg,rgba(112,78,180,.08),rgba(30,70,110,.06));display:flex;align-items:center;justify-content:center;padding:26px;transition:.2s}.tools-dropzone.drag{border-color:#a86cff;background:rgba(145,92,255,.12)}.tools-empty{text-align:center;max-width:520px}.tools-upload-icon{width:76px;height:76px;margin:0 auto 16px;border-radius:22px;display:grid;place-items:center;background:linear-gradient(135deg,#b15cff,#6b62ff);color:#fff}.tools-upload-icon svg{width:34px;height:34px}.tools-empty h3{margin:0 0 8px;font-size:24px}.tools-empty p{margin:0 0 18px;color:var(--muted);line-height:1.55}.tools-pick{border:0;border-radius:12px;padding:12px 20px;background:#fff;color:#21172d;font-weight:900;cursor:pointer}.tools-hint{font-size:11px;color:var(--muted);margin-top:10px}.tools-work{display:grid;grid-template-columns:minmax(0,1.45fr) 280px;gap:16px}.tools-preview{min-height:500px;border-radius:22px;border:1px solid var(--line);background:#071321;display:grid;place-items:center;overflow:hidden;padding:18px}.tools-preview img,.tools-preview video{max-width:100%;max-height:560px;border-radius:14px;object-fit:contain}.tools-preview audio{width:min(620px,100%)}.tools-side{border:1px solid var(--line);border-radius:20px;padding:16px;background:rgba(255,255,255,.025)}.tools-side h3{margin:0 0 12px;font-size:15px}.tools-side label{display:block;font-size:10px;font-weight:800;color:var(--muted);margin:13px 0 6px}.tools-range{width:100%}.tools-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.tools-action{border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.05);color:var(--text);padding:10px 12px;font-weight:800;cursor:pointer}.tools-action.primary{border:0;background:linear-gradient(135deg,#a95cff,#6e63ff);color:#fff}.tools-file-name{font-weight:900;font-size:13px;word-break:break-word}.tools-meta{font-size:10px;color:var(--muted);margin-top:5px}.tools-status{font-size:10px;color:#a985ff;min-height:15px;margin-top:10px}.tools-vocal-results{display:grid;gap:10px;margin-top:14px}.tools-vocal-result{border:1px solid var(--line);border-radius:14px;padding:12px;background:rgba(255,255,255,.035)}.tools-vocal-result-title{font-weight:900;font-size:12px;margin-bottom:8px}.tools-vocal-result audio{width:100%}.tools-vocal-result .tools-actions{margin-top:10px}.tools-vocal-note{font-size:10px;color:var(--muted);line-height:1.45;margin-top:8px}@media(max-width:760px){.tools-work{grid-template-columns:1fr}}`;s.textContent+=`.tools-editor{overflow:hidden!important}.tools-editor-body{min-height:0}.tools-launch-screen{width:100%;height:auto;min-height:0;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:16px;padding:28px 20px 60px;overflow:visible;text-align:center}.tools-launch-copy{max-width:720px}.tools-launch-eyebrow{font-size:10px;letter-spacing:.2em;font-weight:900;color:#b78dff}.tools-launch-copy h2{margin:8px 0 8px;font-size:clamp(26px,4vw,40px);letter-spacing:-.045em}.tools-launch-copy p{max-width:600px;margin:0 auto;color:#8397ad;font-size:12px;line-height:1.6}.tools-launch-card{width:min(700px,90vw);min-height:230px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;border:1px dashed rgba(174,132,255,.34);border-radius:24px;background:linear-gradient(145deg,rgba(112,78,180,.08),rgba(30,70,110,.06));transition:.16s}.tools-launch-card.dragover{border-color:rgba(195,164,255,.8);background:rgba(157,111,255,.11);transform:scale(1.01)}.tools-launch-icon{width:72px;height:72px;border-radius:22px;display:grid;place-items:center;margin-bottom:16px;background:linear-gradient(135deg,#b65cff,#695dff);color:#fff;box-shadow:0 18px 45px rgba(111,77,226,.28)}.tools-launch-icon svg{width:34px;height:34px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.tools-launch-screen .audio-editor-launch-button{margin-top:0}.tools-launch-screen .audio-editor-launch-hint{margin-top:12px}.tools-launch-screen+.tools-work{display:none}@media(max-width:700px){.tools-launch-screen{height:auto;min-height:0;padding:20px 12px 40px}.tools-launch-card{min-height:210px;width:94vw}}`;document.head.appendChild(s)}
let toolsEditorState={kind:"image",file:null,url:"",vocalResults:null};
function toolsEditorReset(){
 if(toolsEditorState.url)try{URL.revokeObjectURL(toolsEditorState.url)}catch{}
 const results=toolsEditorState.vocalResults; if(results?.vocals?.url)try{URL.revokeObjectURL(results.vocals.url)}catch{}
 if(results?.instrumental?.url)try{URL.revokeObjectURL(results.instrumental.url)}catch{}
 toolsEditorState={kind:toolsEditorState.kind,file:null,url:"",vocalResults:null};
}
async function pollCleverJobObject(jobId){
 for(let i=0;i<180;i++){
  await new Promise(r=>setTimeout(r,1800));
  const rr=await fetch("/api/cleverutils-vocal-remover?job="+encodeURIComponent(jobId),{cache:"no-store"});
  const dd=await rr.json().catch(()=>({})),job=dd?.data||dd;
  if(!rr.ok)throw new Error(dd?.message||dd?.error?.message||dd?.error||"VOCAL_SPLIT_JOB_STATUS_FAILED");
  if(job?.status==="done"||job?.status==="completed")return job;
  if(job?.status==="error"||job?.status==="failed")throw new Error("VOCAL_SPLIT_JOB_FAILED");
 }
 throw new Error("VOCAL_SPLIT_JOB_TIMEOUT");
}
function collectCleverStemUrls(value,out={},hint="",depth=0){
 if(depth>6||value==null)return out;
 if(typeof value==="string"){
  if(!/^https?:\/\//i.test(value))return out;  const h=String(hint||"").toLowerCase();
  if(/instrument|karaoke|minus|backing|accompaniment/.test(h))out.instrumental=out.instrumental||value;
  if(/vocal|voice|acapella/.test(h))out.vocals=out.vocals||value;
  return out;
 }
 if(Array.isArray(value)){value.forEach((v,i)=>collectCleverStemUrls(v,out,String(hint)+" "+i,depth+1));return out}
 if(typeof value==="object"){
  Object.entries(value).forEach(([k,v])=>{
   const key=String(k).toLowerCase();
   if(typeof v==="string"&&/^https?:\/\//i.test(v)){
    const h=key+" "+hint;
    if(/instrument|karaoke|minus|backing|accompaniment/.test(h))out.instrumental=out.instrumental||v;
    if(/vocal|voice|acapella/.test(h))out.vocals=out.vocals||v;
   }else collectCleverStemUrls(v,out,key+" "+hint,depth+1);
  });
 }
 return out;
}
async function loadCleverVocalResults(job){
 const stems=collectCleverStemUrls(job);
 const outputUrl=job?.output?.url||job?.outputUrl||job?.links?.output||"";
 if(stems.vocals&&stems.instrumental)return {vocals:{url:stems.vocals},instrumental:{url:stems.instrumental}};
 if(!outputUrl)throw new Error("VOCAL_SPLIT_OUTPUT_MISSING");
 const response=await fetch(outputUrl,{cache:"no-store"});
 if(!response.ok)throw new Error("VOCAL_SPLIT_OUTPUT_"+response.status);
 const blob=await response.blob();
 const type=String(response.headers.get("content-type")||blob.type||"").toLowerCase();
 if(type.includes("zip")||/\.zip(?:$|[?#])/i.test(outputUrl)){
  const JSZip=(await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
  const zip=await JSZip.loadAsync(blob);
  let vocals=null,instrumental=null;
  for(const name of Object.keys(zip.files)){
   const entry=zip.files[name];if(entry.dir)continue;
   const lower=name.toLowerCase(),b=await entry.async("blob");
   if(!vocals&&/(vocal|vocals|acapella)/.test(lower))vocals=b;
   if(!instrumental&&/(instrument|karaoke|minus|backing|accompaniment)/.test(lower))instrumental=b;
  }
  if(vocals&&instrumental)return {vocals:{blob:vocals},instrumental:{blob:instrumental}};
 }
 throw new Error("VOCAL_SPLIT_TWO_TRACKS_MISSING");
}
async function runToolsVocalSplit(){
 const st=toolsEditorState,status=$("#toolsStatus"),button=$("#toolsVocalSplit");
 if(!st.file||!st.url||st.kind!=="audio")return;
 if(st.file.size>50*1024*1024){if(status)status.textContent="Файл больше 50 MB — CleverUtils принимает до 50 MB.";return}
 if(button){button.disabled=true;button.textContent="Разделяю…"}
 if(status)status.textContent="Разделяю вокал и минус…";
 try{
  const form=new FormData();form.append("file",st.file,st.file.name||"miya-audio");
  const rr=await fetch("/api/cleverutils-vocal-remover",{method:"POST",body:form,headers:{Accept:"application/json"},cache:"no-store"});
  const data=await rr.json().catch(()=>({}));
  if(!rr.ok)throw new Error(data?.message||data?.error?.message||data?.error||"VOCAL_SPLIT_FAILED");
  let job=data?.data||data;
  if(job?.job_id&&(job?.status==="processing"||job?.status==="pending"||(!job?.output&&!job?.outputs)))job=await pollCleverJobObject(job.job_id);
  const results=await loadCleverVocalResults(job);
  for(const key of ["vocals","instrumental"]){
   const item=results[key];
   if(!item.blob&&item.url){
    const res=await fetch(item.url,{cache:"no-store"});
    if(!res.ok)throw new Error("VOCAL_SPLIT_"+key.toUpperCase()+"_"+res.status);
    item.blob=await res.blob();
   }
   if(!item.blob?.size)throw new Error("VOCAL_SPLIT_"+key.toUpperCase()+"_EMPTY");
   item.url=URL.createObjectURL(item.blob);
  }
  st.vocalResults=results;
  toolsEditorRender();
 }catch(err){
  console.error("Miya vocal split failed",err);
  const current=$("#toolsStatus");if(current)current.textContent=String(err?.message||"Не удалось разделить аудио");
  toast("Не удалось разделить вокал и минус");
 }finally{
  const b=$("#toolsVocalSplit");if(b){b.disabled=false;b.textContent="Разделить на вокал и минус"}
 }
}
async function saveToolsVocalStem(kind){
 const result=toolsEditorState.vocalResults?.[kind];if(!result?.blob)return;
 const suffix=kind==="vocals"?"Вокал":"Минус";
 const item=saveMedia("audio",result.url,(toolsEditorState.file?.name||"Песня")+" · "+suffix,"CleverUtils · "+suffix,"wav");
 if(!item){toast("Не удалось сохранить результат");return}
 renderVoiceLibrary();toast(suffix+" сохранён в библиотеку");
}
function toolsEditorLoadFile(file){const t=String(file?.type||"");const kind=t.startsWith("video/")?"video":t.startsWith("audio/")?"audio":"image";if(kind!==toolsEditorState.kind){toast("Файл не подходит для выбранного редактора");return}toolsEditorState.file=file;toolsEditorState.url=URL.createObjectURL(file);toolsEditorRender()}
function toolsEditorRender(){
 const escapeHtmlLocal=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 ensureToolsEditorStyles();
 const c=$("#canvas"),st=toolsEditorState;if(!c)return;
 c.innerHTML='<div class="tools-editor"><div class="tools-editor-tabs"><button class="tools-editor-tab '+(st.kind==="image"?"active":"")+'" data-tools-kind="image">Картинки</button><button class="tools-editor-tab '+(st.kind==="video"?"active":"")+'" data-tools-kind="video">Видео</button><button class="tools-editor-tab '+(st.kind==="audio"?"active":"")+'" data-tools-kind="audio">Голос</button><button class="tools-editor-tab '+(st.kind==="editor"?"active":"")+'" data-tools-kind="editor">Аудиоредактор</button></div><div id="toolsEditorBody"></div></div>';
 c.querySelectorAll("[data-tools-kind]").forEach(b=>b.onclick=()=>{
   if(b.dataset.toolsKind===st.kind)return;
   toolsEditorReset();
   toolsEditorState.kind=b.dataset.toolsKind;
   toolsEditorRender();
 });
 const body=$("#toolsEditorBody");
 if(!body)return;
 if(st.kind==="editor"||!st.file){
  const isImage=st.kind==="image",isVideo=st.kind==="video",isVoice=st.kind==="audio"||st.kind==="editor";
  const data=isImage
    ?["MIYA IMAGE STUDIO","Открыть редактор изображений","PNG, JPG, WEBP или GIF. Выбери файл — он сразу откроется в редакторе.","Выбрать изображение","Можно также перетащить изображение в это окно",'<path d="M4 5h16v14H4z"/><circle cx="9" cy="10" r="2"/><path d="m4 16 4-4 3 3 3-4 6 6"/>']
    :isVideo
    ?["MIYA VIDEO STUDIO","Открыть видеоредактор","MP4, WEBM или MOV. Выбери файл — он сразу откроется в редакторе.","Выбрать видео","Можно также перетащить видео в это окно",'<path d="M4 6h11v12H4z"/><path d="m15 10 5-3v10l-5-3z"/>']
    :isVoice&&st.kind==="audio"
    ?["MIYA VOICE STUDIO","Редактор голоса","Открой, замени, очисти или обработай готовый голос в полноэкранном редакторе.","Выбрать аудиофайл","Можно также перетащить аудио в это окно",'<path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>']
    :["MIYA AUDIO STUDIO","Аудиоредактор","Обрезай, очищай, разделяй и обрабатывай аудио в полноэкранном редакторе.","Выбрать аудиофайл","Можно также перетащить аудио в это окно",'<path d="M4 9v6M8 6v12M12 3v18M16 6v12M20 9v6"/>'];
  body.innerHTML='<div class="tools-launch-screen"><div class="tools-launch-copy"><div class="tools-launch-eyebrow">'+data[0]+'</div><h2>'+data[1]+'</h2><p>'+data[2]+'</p></div><div class="tools-launch-card" id="toolsLaunchCard"><div class="tools-launch-icon"><svg viewBox="0 0 24 24" aria-hidden="true">'+data[5]+'</svg></div><button type="button" class="audio-editor-launch-button" id="toolsLaunchPick"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>'+data[3]+'</span></button><div class="audio-editor-launch-hint">'+data[4]+'</div></div></div>';
  const launch=$("#toolsLaunchCard"),pick=$("#toolsLaunchPick"),input=document.createElement("input");
  input.type="file";input.accept=isImage?"image/*":isVideo?"video/*":"audio/*";input.hidden=true;document.body.appendChild(input);
  const openFile=file=>{
    if(!file)return;
    if(isVoice){openVoiceEditor({model:file.name,prompt:file.name,type:file.type},file);return}
    toolsEditorLoadFile(file);
  };
  input.onchange=()=>openFile(input.files?.[0]);
  pick.onclick=e=>{e.stopPropagation();input.click()};
  launch.onclick=e=>{if(e.target.closest("#toolsLaunchPick"))return;input.click()};
  launch.ondragover=e=>{e.preventDefault();launch.classList.add("dragover")};
  launch.ondragleave=()=>launch.classList.remove("dragover");
  launch.ondrop=e=>{e.preventDefault();launch.classList.remove("dragover");openFile(e.dataTransfer?.files?.[0])};
  return;
 }
 const p=st.kind==="image"?'<img id="toolsPreviewImage" src="'+st.url+'">':st.kind==="video"?'<video id="toolsPreviewVideo" src="'+st.url+'" controls playsinline></video>':'<audio id="toolsPreviewAudio" src="'+st.url+'" controls></audio>';
 let controls="";
 if(st.kind==="image"){
  controls='<label>Яркость <input id="toolsBrightness" class="tools-range" type="range" min="50" max="150" value="100"></label><label>Контраст <input id="toolsContrast" class="tools-range" type="range" min="50" max="150" value="100"></label><label>Насыщенность <input id="toolsSaturation" class="tools-range" type="range" min="0" max="180" value="100"></label><div class="tools-actions"><button class="tools-action" id="toolsRotate">Повернуть</button><button class="tools-action" id="toolsReset">Сбросить</button></div>';
 }else if(st.kind==="video"){
  controls='<label>Скорость <input id="toolsSpeed" class="tools-range" type="range" min="50" max="150" value="100"></label><label>Громкость <input id="toolsVolume" class="tools-range" type="range" min="0" max="100" value="100"></label>';
 }else{
  controls='<div class="tools-meta">AI-разделение песни на две дорожки: чистый вокал и минус (инструментал).</div><div class="tools-actions"><button type="button" class="tools-action primary" id="toolsVocalSplit">Разделить на вокал и минус</button></div>';
 }
 let results="";
 if(st.kind==="audio"&&st.vocalResults){
  results='<div class="tools-vocal-results"><div class="tools-vocal-result"><div class="tools-vocal-result-title">🎤 Вокал</div><audio controls src="'+st.vocalResults.vocals.url+'"></audio><div class="tools-actions"><button type="button" class="tools-action" id="toolsSaveVocals">Сохранить вокал</button></div></div><div class="tools-vocal-result"><div class="tools-vocal-result-title">🎵 Минус · инструментал</div><audio controls src="'+st.vocalResults.instrumental.url+'"></audio><div class="tools-actions"><button type="button" class="tools-action" id="toolsSaveInstrumental">Сохранить минус</button></div></div><div class="tools-vocal-note">CleverUtils разделяет трек через Demucs. В режиме двух дорожек получаются вокал и инструментальная версия.</div></div>';
 }
 body.innerHTML='<div class="tools-work"><div class="tools-preview">'+p+'</div><aside class="tools-side"><div class="tools-file-name">'+escapeHtml(st.file.name)+'</div><div class="tools-meta">'+formatBytes(st.file.size)+' · '+escapeHtml(st.file.type||"файл")+'</div>'+controls+results+'<div class="tools-status" id="toolsStatus">'+(st.vocalResults?"Результаты готовы — можно прослушать и сохранить.":"Изменения пока не сохранены")+'</div><div class="tools-actions"><button class="tools-action" id="toolsChange">Заменить</button><button class="tools-action primary" id="toolsSave">Сохранить</button></div></aside></div>';
 $("#toolsChange").onclick=()=>{toolsEditorReset();toolsEditorRender()};
 $("#toolsSave").onclick=toolsEditorSave;
 if(st.kind==="audio"){
  $("#toolsVocalSplit")?.addEventListener("click",runToolsVocalSplit);
  $("#toolsSaveVocals")?.addEventListener("click",()=>saveToolsVocalStem("vocals"));
  $("#toolsSaveInstrumental")?.addEventListener("click",()=>saveToolsVocalStem("instrumental"));
 }else if(st.kind==="image"){
  const apply=()=>{const im=$("#toolsPreviewImage");im.style.filter="brightness("+$("#toolsBrightness").value+"%) contrast("+$("#toolsContrast").value+"%) saturate("+$("#toolsSaturation").value+"%)"};
  ["toolsBrightness","toolsContrast","toolsSaturation"].forEach(id=>$("#"+id).oninput=apply);
  $("#toolsReset").onclick=()=>{["toolsBrightness","toolsContrast","toolsSaturation"].forEach(id=>$("#"+id).value=100);apply()};
  $("#toolsRotate").onclick=()=>{const im=$("#toolsPreviewImage");im.dataset.rot=String((Number(im.dataset.rot||0)+90)%360);im.style.transform="rotate("+im.dataset.rot+"deg)"};
 }else if(st.kind==="video"){
  $("#toolsSpeed").oninput=e=>$("#toolsPreviewVideo").playbackRate=Number(e.target.value)/100;
  $("#toolsVolume").oninput=e=>$("#toolsPreviewVideo").volume=Number(e.target.value)/100;
 }
}
async function toolsEditorSave(){const st=toolsEditorState;if(!st.file||!st.url)return;const status=$("#toolsStatus");if(status)status.textContent="Сохраняю…";try{let url=st.url;if(st.kind==="image"){const im=$("#toolsPreviewImage");const blob=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const angle=Number(im.dataset.rot||0),rad=angle*Math.PI/180,swap=angle%180!==0,cv=document.createElement("canvas");cv.width=swap?img.naturalHeight:img.naturalWidth;cv.height=swap?img.naturalWidth:img.naturalHeight;const ctx=cv.getContext("2d");ctx.translate(cv.width/2,cv.height/2);ctx.rotate(rad);ctx.filter=im.style.filter||"none";ctx.drawImage(img,-img.naturalWidth/2,-img.naturalHeight/2);cv.toBlob(b=>b?resolve(b):reject(new Error("IMAGE_SAVE_FAILED")),"image/jpeg",.95)};img.onerror=()=>reject(new Error("IMAGE_READ_FAILED"));img.src=st.url});url=URL.createObjectURL(blob)}const item=saveMedia(st.kind==="audio"?"audio":st.kind,url,st.file.name,st.kind==="image"?"Tools Image":st.kind==="video"?"Tools Video":"Tools Voice",st.file.type);if(!item)throw new Error("SAVE_FAILED");if(st.kind==="image")renderImageLibrary();else if(st.kind==="video")renderVideoLibrary();else renderVoiceLibrary();toast("Файл сохранён в стену и в «Мои файлы»");toolsEditorReset();toolsEditorRender()}catch(e){console.error("Miya Tools editor save failed",e);if(status)status.textContent="Не удалось сохранить файл"}}
function openToolsEditor(){closeAllMediaMenus();closeMediaMenus();resetChatMenus();mode="tools";const composer=$("#composer");if(composer)composer.style.display="none";ensureToolsEditorStyles();document.querySelectorAll("[data-mode]").forEach(x=>x.classList.remove("active"));document.querySelectorAll("[data-tool]").forEach(x=>x.classList.toggle("active",x.dataset.tool==="editor"));$("#workspaceEyebrow").textContent="MIYA TOOLS · EDITOR";$("#workspaceTitle").textContent="Инструменты";$("#workspaceSubtitle").textContent="Редактор картинок, видео и голоса. Файл появляется в библиотеке только после сохранения.";$(".image-settings").style.display="none";$("#videoOptions").classList.remove("show");$("#voiceOptions").classList.remove("show");$("#canvas").classList.remove("chat-canvas");toolsEditorRender();requestAnimationFrame(()=>$("#workspace")?.scrollTo({top:0,behavior:"auto"}))}

function setMode(next,render=true){
 const target=String(next||"chat");
 if(target==="tools"){openToolsEditor();return}
 if(!modes[target])return;
 const leavingTools=mode==="tools"&&target!=="tools";
 if(leavingTools){const composer=$("#composer");if(composer)composer.style.display="";}
 const changedSection=target!==mode;
 if(changedSection){
   closeAllMediaMenus();
   closeMediaMenus();
   resetChatMenus();
   resetVideoProgress();
 }
 if(changedSection){
   referenceImage=null;
   try{sessionStorage.removeItem("miyaReferenceImage")}catch{}
   setComposerAttachment("");
   const input=$("#composerInput");
   if(input)input.value="";
 }
 mode=target;
 const m=modes[target];
 const composer=$("#composer"); if(composer){ composer.classList.remove("mode-chat","mode-images","mode-video","mode-voice"); composer.classList.add("mode-"+target); composer.classList.toggle("voice-mode",target==="voice"); }
 const canvas=$("#canvas");

 // Clear the previous section immediately, before any model/quota refresh.
 if(render&&canvas){
   canvas.classList.toggle("chat-canvas",target==="chat");
   canvas.innerHTML="";
 }

 $("#workspaceEyebrow").textContent=m.eyebrow;
 const workspaceTitle=$("#workspaceTitle"); if(workspaceTitle) workspaceTitle.textContent=m.title;
 const workspaceSubtitle=$("#workspaceSubtitle"); if(workspaceSubtitle) workspaceSubtitle.textContent=m.subtitle;
 const composerInputEl=$("#composerInput"); if(composerInputEl){ composerInputEl.placeholder=m.placeholder; composerInputEl.setAttribute("aria-label",m.placeholder); composerInputEl.dataset.mode=target; composerInputEl.classList.remove("prompt-chat","prompt-images","prompt-video","prompt-voice"); composerInputEl.classList.add("prompt-"+target); }
 const composerSendText=$("#composerSendText"); if(composerSendText) composerSendText.textContent=m.send;
 const composerStatus=$("#composerStatus"); if(composerStatus) composerStatus.textContent=m.status; const composerMic=$("#composerMic"); if(composerMic){ composerMic.style.setProperty("display","grid","important"); composerMic.style.setProperty("visibility","visible","important"); composerMic.style.setProperty("opacity","1","important"); composerMic.setAttribute("aria-label","Начать голосовой ввод"); composerMic.title="Голосовой ввод"; }
 const imageSettings=$(".image-settings"); if(imageSettings){ imageSettings.style.display=target==="images"?"flex":"none"; imageSettings.classList.toggle("show",target==="images"); }
 const voiceOptions=$("#voiceOptions"); if(voiceOptions){ voiceOptions.style.display=target==="voice"?"flex":"none"; voiceOptions.classList.toggle("show",target==="voice"); }
 const videoOptions=$("#videoOptions"); if(videoOptions){ videoOptions.style.display=target==="video"?"flex":"none"; videoOptions.classList.toggle("show",target==="video"); }

 // Paint the active navigation state before any model-specific code runs.
 document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode===target));
 document.querySelectorAll("#chatSubmenu .side-subbtn").forEach(x=>x.classList.remove("active"));
 $("#chatMenuToggle")?.classList.toggle("active",target==="chat");

 if(target!=="chat"){
   chatMenuSuppressed=true;
   $("#chatSubmenu")?.classList.add("suppressed");
   $("#chatMenuToggle")?.setAttribute("aria-expanded","false");
 }else if(!chatMenuSuppressed){
   if($("#chatSubmenu")?.classList.contains("collapsed"))$("#chatSubmenu").classList.remove("collapsed");
   if($("#chatMenuToggle")){
     $("#chatMenuToggle").classList.remove("collapsed");
     $("#chatMenuToggle").setAttribute("aria-expanded","true");
   }
 }
 if($("#chatMenuArrow"))$("#chatMenuArrow").textContent="→";

 if(!render){syncInput();return}

 if(target==="video"){
   setVideoRatioDefault();
   const model=$("#videoModel");
   if(model&&!model.value)model.value="Agnes Video 2.5 Flash";
   const input=$("#composerInput");
   if(input){
     input.style.pointerEvents="auto";
     input.style.userSelect="text";
     input.style.cursor="text";
   }
   try{refreshLtxQuotaState()}catch{}
   renderVideoLibrary();
 }else if(target==="images"){
   referenceImage=referenceImage||null;
   renderImageLibrary();
   const imageModel=$("#composerModel");
   if(imageModel)imageModel.value=referenceImage?"FLUX Kontext Dev":"FLUX Dev";
   const ratio=$("#composerRatio");
   if(ratio)ratio.value=referenceImage?"auto":"16:9";
 }else if(target==="voice"){
   renderVoiceLibrary();loadVoiceCatalog();
 }else{
   showEmpty();
 }
 requestAnimationFrame(()=>$("#workspace")?.scrollTo({top:0,behavior:"auto"}));
 syncInput();
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
// Capture navigation clicks so the Video button cannot be swallowed
// by the chat flyout or another bubbling handler.
document.addEventListener("click",e=>{
 if(e.target?.closest?.("#composer"))return;
 const button=e.target?.closest?.("[data-mode]");
 if(!button)return;
 const target=button.dataset.mode;
 if(!modes[target])return;
 e.preventDefault();
 e.stopPropagation();
 setMode(target,true);
 if(target==="video")requestAnimationFrame(()=>$("#videoModel")?.focus({preventScroll:true}));
},true);
const videoModelSelect=$("#videoModel");
if(videoModelSelect)videoModelSelect.addEventListener("change",()=>{
 updateVideoRatioVisibility();
 resetVideoProgress();
 if(mode==="video"){
   $("#composerStatus").textContent=videoModelSelect.value+" · готов";
 }
});
$("#composerInput").addEventListener("input",()=>{
  if(!speechRecorder){
    speechRecordingCount=0;
    speechCommittedText=$("#composerInput").value.trim();
  }
  syncInput();
});
const composerInput=$("#composerInput");
$("#composerInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#composerSend").click()}});
$("#composerSend").addEventListener("click",async()=>{
 const value=$("#composerInput").value.trim();
 if(!value){
   toast(mode==="chat"?"Напиши сообщение":mode==="video"?"Опиши видео":"Опиши, что создать или изменить");return
 }
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
 if(file)attachReferenceFile(file)
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
let speechRecorder=null;
let speechStream=null;
let speechAudioContext=null;
let speechSource=null;
let speechAnalyser=null;
let speechVisualizerFrame=0;
let speechChunks=[];
let speechBaseText="";
let speechCommittedText="";
let speechRecordingCount=0;
let speechPlaceholder="";
let speechMimeType="";

function setSpeechMicIdle(){
  const mic=$("#composerMic");
  if(!mic)return;
  mic.classList.remove("recording");
  mic.setAttribute("aria-label","Начать голосовой ввод");
  mic.title="Голосовой ввод";
  mic.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3M8 21h8"/></svg>';
}
function setSpeechMicRecording(){
  const mic=$("#composerMic");
  if(!mic)return;
  mic.classList.add("recording");
  mic.setAttribute("aria-label","Завершить запись и распознать голос");
  mic.title="Завершить запись и вставить текст";
  mic.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.1 2.3 2.3 5.3-5.3"/></svg>';
}
function speechSetIdle(){
  const mic=$("#composerMic");
  if(mic)setSpeechMicIdle();
  const status=$("#composerStatus");
  if(status)status.textContent=modes[mode]?.status||"Готово";
  const canvas=$("#composerVoiceVisualizer");
  if(canvas)canvas.style.display="none";
  if(speechVisualizerFrame)cancelAnimationFrame(speechVisualizerFrame);
  speechVisualizerFrame=0;
  const input=$("#composerInput");
  if(input){
    input.classList.remove("speech-recording");
    input.style.color="";
    input.style.caretColor="";
    if(speechPlaceholder)input.placeholder=speechPlaceholder;
  }
  speechPlaceholder="";
}
function ensureSpeechVisualizer(){
  let canvas=$("#composerVoiceVisualizer");
  if(canvas)return canvas;
  const row=document.querySelector(".composer-input-row");
  if(!row)return null;
  canvas=document.createElement("canvas");
  canvas.id="composerVoiceVisualizer";
  canvas.width=384;
  canvas.height=32;
  canvas.setAttribute("aria-hidden","true");
  Object.assign(canvas.style,{
    position:"absolute",
    left:"0",
    right:"auto",
    top:"50%",
    transform:"translateY(-50%)",
    width:"0",
    height:"26px",
    display:"none",
    pointerEvents:"none",
    zIndex:"1004",
    opacity:".98"
  });
  row.appendChild(canvas);
  return canvas;
}

function positionSpeechVisualizer(){
  const canvas=$("#composerVoiceVisualizer"),mic=$("#composerMic"),input=$("#composerInput"),row=canvas?.parentElement;
  if(!canvas||!mic||!input||!row)return;
  const rr=row.getBoundingClientRect(),ir=input.getBoundingClientRect(),mr=mic.getBoundingClientRect(),gap=8;
  const left=Math.max(0,ir.left-rr.left);
  const width=Math.max(40,mr.left-ir.left-gap);
  const top=ir.top-rr.top+(ir.height/2);
  canvas.style.left=left+"px";
  canvas.style.width=width+"px";
  canvas.style.right="auto";
  canvas.style.top=top+"px";
  canvas.style.transform="translateY(-50%)";
}
function speechDraw(){
  const canvas=ensureSpeechVisualizer();
  const analyser=speechAnalyser;
  if(!canvas||!analyser)return;
  const ctx=canvas.getContext("2d");
  const data=new Uint8Array(analyser.frequencyBinCount);
  const draw=()=>{
    if(!speechAnalyser)return;
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const bars=64;
    const gap=2;
    const width=(canvas.width-gap*(bars-1))/bars;
    for(let i=0;i<bars;i++){
      const index=Math.min(data.length-1,Math.floor(i*data.length/bars));
      const value=data[index]/255;
      const height=Math.max(2,value*23);
      const x=i*(width+gap);
      const y=(canvas.height-height)/2;
      ctx.beginPath();
      ctx.roundRect(x,y,width,height,2);
      ctx.fillStyle="rgba(188,160,255,.9)";
      ctx.fill();
    }
    speechVisualizerFrame=requestAnimationFrame(draw);
  };
  cancelAnimationFrame(speechVisualizerFrame);
  draw();
}

async function blobToDataUrl(blob){
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(reader.error||new Error("AUDIO_READ_FAILED"));
    reader.readAsDataURL(blob);
  });
}

async function finishSpeechRecording(){
  const recorder=speechRecorder;
  if(!recorder)return;
  speechRecorder=null;
  if(recorder.state!=="inactive")recorder.stop();
}

async function processSpeechRecording(){
  const stream=speechStream;
  const context=speechAudioContext;
  const source=speechSource;
  const analyser=speechAnalyser;
  const chunks=speechChunks.slice();
  const mime=speechMimeType||"audio/ogg";
  speechStream=null;
  speechAudioContext=null;
  speechSource=null;
  speechAnalyser=null;
  speechChunks=[];
  try{source?.disconnect()}catch{}
  try{analyser?.disconnect()}catch{}
  try{stream?.getTracks().forEach(track=>track.stop())}catch{}
  try{await context?.close()}catch{}
  if(!chunks.length){
    speechSetIdle();
    toast("Не удалось записать голос");
    return;
  }
  const blob=new Blob(chunks,{type:mime});
  if(blob.size<1000){
    speechSetIdle();
    toast("Запись слишком короткая");
    return;
  }
  const status=$("#composerStatus");
  if(status)status.textContent="Распознаю голос…";
  try{
    const audio=await blobToDataUrl(blob);
    const response=await fetch("/api/cloudflare-transcribe",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        audio,
        filename:mime.includes("ogg")?"miya-voice.ogg":"miya-voice.webm",
        mime,
        language:"ru"
      })
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw new Error("TRANSCRIBE_"+response.status);
    const text=String(data?.text||data?.transcript||"").trim();
    if(!text)throw new Error("TRANSCRIPT_EMPTY");
    const input=$("#composerInput");
    if(input){
      const previous=speechCommittedText.trim();
      speechCommittedText=previous
        ? (speechRecordingCount>0
          ? previous.replace(/[.!?\s]+$/,"")+". "+text
          : previous+" "+text)
        : text;
      speechRecordingCount++;
      input.value=speechCommittedText;
      input.focus();
      input.selectionStart=input.selectionEnd=input.value.length;
      syncInput();
    }
    toast("Голос распознан");
  }catch(error){
    console.error("Miya speech-to-text failed",error);
    toast("Не удалось распознать голос");
  }finally{
    speechSetIdle();
  }
}

async function startSpeechRecording(){
  if(!navigator.mediaDevices?.getUserMedia){
    toast("Браузер не поддерживает доступ к микрофону");
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}
    });
    const supported=[
      "audio/ogg;codecs=opus",
      "audio/webm;codecs=opus",
      "audio/ogg",
      "audio/webm"
    ];
    const mime=supported.find(type=>MediaRecorder.isTypeSupported(type))||"";
    const recorder=mime
      ? new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000})
      : new MediaRecorder(stream);
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    const context=new AudioContextClass();
    await context.resume();
    const source=context.createMediaStreamSource(stream);
    const analyser=context.createAnalyser();
    analyser.fftSize=256;
    analyser.smoothingTimeConstant=.72;
    source.connect(analyser);

    speechStream=stream;
    speechAudioContext=context;
    speechSource=source;
    speechAnalyser=analyser;
    speechChunks=[];
    speechMimeType=recorder.mimeType||mime||"audio/webm";
    const input=$("#composerInput");
    if(speechRecordingCount===0) speechCommittedText=input?.value.trim()||"";
    speechBaseText=speechCommittedText;
    speechPlaceholder=input?.placeholder||modes[mode]?.placeholder||"";
    if(input){
      input.value="";
      input.classList.add("speech-recording");
      input.style.color="transparent";
      input.style.caretColor="transparent";
      input.placeholder="";
      syncInput();
    }
    recorder.ondataavailable=e=>{
      if(e.data?.size)speechChunks.push(e.data);
    };
    recorder.onerror=()=>toast("Ошибка записи микрофона");
    recorder.onstop=()=>processSpeechRecording();
    speechRecorder=recorder;
    const canvas=ensureSpeechVisualizer();
    if(canvas){canvas.style.display="block";positionSpeechVisualizer()}
    speechDraw();
    recorder.start(250);
    const mic=$("#composerMic");
    if(mic){
      setSpeechMicRecording();
    }
    const status=$("#composerStatus");
    if(status)status.textContent="Слушаю… говори спокойно";
  }catch(error){
    console.error("Miya microphone start failed",error);
    try{speechStream?.getTracks().forEach(track=>track.stop())}catch{}
    speechRecorder=null;speechStream=null;speechAudioContext=null;speechSource=null;speechAnalyser=null;
    speechSetIdle();
    if(error?.name==="NotAllowedError")toast("Разреши Miya доступ к микрофону в Firefox");
    else toast("Не удалось открыть микрофон");
  }
}

$("#composerMic").onclick=async()=>{
  if(speechRecorder){
    await finishSpeechRecording();
    return;
  }
  await startSpeechRecording();
};
document.querySelector('.mobile-tabs [data-mode="voice"]')?.remove();
function syncVoiceEditorTheme(){const backdrop=document.querySelector(".voice-editor-backdrop");if(!backdrop)return;const light=document.body.classList.contains("light");backdrop.classList.toggle("ve2-light",light);backdrop.dataset.theme=light?"light":"dark"}
$("#themeToggle").onclick=()=>{document.body.classList.toggle("light");$("#themeToggle").textContent=document.body.classList.contains("light")?"☾":"☼";syncVoiceEditorTheme()};
$("#profileButton").onclick=()=>toast("Профиль Miya User · 0 PKOIN");
document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>{
 const tool=b.dataset.tool;
 closeAllMediaMenus();
 closeMediaMenus();
 resetChatMenus();
 if(tool==="editor"){openToolsEditor();return}
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
setMode("chat");


const chatNavWrap=$("#chatNavWrap")||$(".chat-nav-wrap");
if(chatNavWrap){chatNavWrap.addEventListener("mouseleave",()=>{chatMenuSuppressed=false;$("#chatSubmenu")?.classList.remove("suppressed");$("#chatMenuToggle")?.setAttribute("aria-expanded","false")})}

// Close transient chat/media menus when clicking outside them.
document.addEventListener("click",e=>{if(!e.target.closest(".chat-history-row"))resetChatMenus()});
document.addEventListener("click",e=>{
 if(e.target.closest(".voice-card-menu")||e.target.closest(".voice-editor-more"))return;
 closeAllVoiceCardMenus();
});
document.addEventListener("scroll",()=>closeAllVoiceCardMenus(),true);
document.addEventListener("pointerdown",e=>{
 if(e.target.closest(".voice-card-menu")||e.target.closest(".voice-editor-more"))return;
 closeAllVoiceCardMenus();
},{capture:true});

document.addEventListener("click",e=>{if(!e.target.closest(".media-actions")&&!e.target.closest(".media-action-menu")&&!e.target.closest(".media-upscale-panel"))closeAllMediaMenus()});
let mediaOverlayRepositionFrame=0;
function scheduleMediaOverlayReposition(){
 if(mediaOverlayRepositionFrame)return;
 mediaOverlayRepositionFrame=requestAnimationFrame(()=>{
   mediaOverlayRepositionFrame=0;
   document.querySelectorAll(".media-upscale-panel.open").forEach(p=>{
     const anchor=p.__mediaOverlayAnchor;
     if(anchor?.isConnected)positionFloatingMediaOverlay(p,anchor,"panel");
   });
 });
}
window.addEventListener("resize",scheduleMediaOverlayReposition);
document.addEventListener("scroll",scheduleMediaOverlayReposition,true);
$("#workspace")?.addEventListener("scroll",()=>closeAllMediaMenus(),{passive:true});
/* MIYA MAIN AUDIO EDITOR — final visual/interaction layer */
(function miyaMainAudioEditorLayer(){
  if(window.__miyaMainAudioEditorLayer)return;
  window.__miyaMainAudioEditorLayer=true;

  const installStyles=()=>{
    if(document.getElementById("miyaMainAudioEditorUltimate"))return;
    const s=document.createElement("style");
    s.id="miyaMainAudioEditorUltimate";
    s.textContent=`
      html.miya-editor-page-open,body.miya-editor-page-open{overflow:hidden!important;width:100%!important;height:100%!important}
      .voice-editor-backdrop{position:fixed!important;inset:0!important;width:100dvw!important;height:100dvh!important;padding:0!important;margin:0!important;display:grid!important;place-items:stretch!important;background:rgba(4,7,18,.78)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important}
      .voice-editor-dialog.ve2{width:100dvw!important;height:100dvh!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;border:0!important;border-radius:0!important;overflow:hidden!important;display:grid!important;grid-template-rows:74px minmax(0,1fr) 76px!important;padding:0!important;margin:0!important;background:radial-gradient(circle at 72% -10%,rgba(160,102,255,.20),transparent 34%),radial-gradient(circle at 18% 110%,rgba(91,102,255,.12),transparent 35%),linear-gradient(145deg,#071225,#091426 55%,#10102a)!important;color:#e9edf6!important;box-shadow:none!important}
      .ve2-head{min-width:0!important;min-height:0!important;height:74px!important;padding:12px 18px!important;box-sizing:border-box!important;background:rgba(5,10,22,.72)!important;border-bottom:1px solid rgba(255,255,255,.075)!important;backdrop-filter:blur(22px)!important;-webkit-backdrop-filter:blur(22px)!important}
      .ve2-brand{min-width:0!important}.ve2-brand-mark{width:40px!important;height:40px!important;border-radius:13px!important;background:linear-gradient(135deg,#bd5cff,#695cff)!important;box-shadow:0 12px 30px rgba(114,71,222,.30)!important}
      .ve2-eyebrow{font-size:9px!important;letter-spacing:.20em!important;color:#b996ff!important}.ve2-title{font-size:17px!important;font-weight:950!important;letter-spacing:-.025em!important}.ve2-meta{font-size:8px!important;color:#778ca5!important}
      .ve2-head-actions{gap:7px!important}.ve2-clear,.ve2-close{width:38px!important;height:38px!important;min-width:38px!important;border-radius:11px!important;display:grid!important;place-items:center!important}
      .ve2-body{min-width:0!important;min-height:0!important;overflow:hidden!important;display:grid!important;grid-template-columns:minmax(0,1fr) 390px!important;background:rgba(3,8,17,.20)!important}
      .ve2-main{min-width:0!important;min-height:0!important;overflow:hidden!important;padding:18px!important;background:radial-gradient(circle at 50% 48%,rgba(132,92,255,.10),transparent 48%),linear-gradient(180deg,#071222,#06101d)!important}
      .ve2-stage{width:100%!important;height:100%!important;box-sizing:border-box!important;min-width:0!important;min-height:0!important;padding:16px!important;border:1px solid rgba(255,255,255,.075)!important;border-radius:24px!important;background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.012))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 24px 70px rgba(0,0,0,.20)!important;display:grid!important;grid-template-rows:auto minmax(0,1fr) auto auto!important;overflow:hidden!important}
      .ve2-fileline{gap:12px!important;padding:2px 2px 12px!important}.ve2-name{height:40px!important;border-radius:12px!important;font-size:12px!important;padding:0 13px!important}
      .ve2-wavebox{min-height:0!important;height:100%!important;border-radius:19px!important;background:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.020) 1px,transparent 1px),radial-gradient(circle at 50% 50%,rgba(149,103,255,.09),transparent 62%),#071322!important;background-size:100% 25%,10% 100%,100% 100%,auto!important;border:1px solid rgba(175,137,255,.14)!important;box-shadow:inset 0 0 40px rgba(0,0,0,.20)!important}
      .ve2-wave-label{font-size:8px!important;letter-spacing:.22em!important;color:#9b82c4!important}.ve2-transport{padding:10px 2px 2px!important;margin:0!important}
      .ve2-play{width:48px!important;height:48px!important;border-radius:15px!important;box-shadow:0 14px 30px rgba(110,71,220,.28)!important}.ve2-transport-btn{height:36px!important;border-radius:11px!important}
      .ve2-side{min-width:0!important;min-height:0!important;max-width:none!important;overflow:auto!important;padding:14px!important;border-left:1px solid rgba(255,255,255,.075)!important;background:rgba(5,11,23,.76)!important;scrollbar-width:thin!important;scrollbar-color:rgba(155,116,230,.45) transparent!important}
      .ve2-section{border-radius:18px!important;background:rgba(255,255,255,.032)!important}.ve2-section-title{padding-bottom:2px!important}.ve2-section-title b{font-size:12px!important}
      .ve2-tools{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}.ve2-tool{min-height:82px!important;padding:11px!important;border-radius:15px!important;background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.018))!important}
      .ve2-tool svg{width:22px!important;height:22px!important;color:#bd9cff!important}.ve2-tool strong{font-size:10px!important}.ve2-tool small{font-size:8px!important}
      .ve2-tool.active{background:linear-gradient(145deg,rgba(169,92,255,.23),rgba(99,88,235,.13))!important;border-color:rgba(191,153,255,.58)!important;box-shadow:0 12px 30px rgba(104,67,209,.14)!important}
      .ve2-panel{border-radius:16px!important;background:rgba(143,101,255,.055)!important}.ve2-apply{height:40px!important;border-radius:12px!important;font-size:10px!important}
      .ve2-upload{min-height:78px!important;margin-top:12px!important;border-radius:17px!important;background:linear-gradient(135deg,rgba(155,111,255,.075),rgba(255,255,255,.018))!important}.ve2-plus{width:46px!important;height:46px!important;border-radius:14px!important}
      .ve2-results{margin-top:12px!important}.ve2-result{border-radius:15px!important;background:rgba(255,255,255,.032)!important}
      .ve2-footer{min-height:0!important;height:76px!important;box-sizing:border-box!important;padding:12px 18px!important;background:rgba(4,9,19,.88)!important;border-top:1px solid rgba(255,255,255,.075)!important;backdrop-filter:blur(18px)!important}
      .ve2-footer-note{font-size:9px!important}.ve2-footer-btn{height:42px!important;border-radius:12px!important}
      .miya-audio-editor-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 10px;padding:5px;border-radius:14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}
      .miya-audio-editor-tab{height:34px;border:0;border-radius:10px;background:transparent;color:#8193aa;font-size:9px;font-weight:900;letter-spacing:.06em;cursor:pointer}
      .miya-audio-editor-tab.active{color:#fff;background:linear-gradient(135deg,rgba(169,92,255,.30),rgba(104,94,238,.22));box-shadow:0 7px 18px rgba(99,66,200,.13)}
      .voice-editor-backdrop.ve2-light{background:#eef2f7!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      .voice-editor-backdrop.ve2-light .voice-editor-dialog.ve2{background:#f7f9fc!important;color:#273047!important}
      .voice-editor-backdrop.ve2-light .ve2-head,.voice-editor-backdrop.ve2-light .ve2-footer{background:rgba(255,255,255,.94)!important;border-color:#dbe4ee!important}
      .voice-editor-backdrop.ve2-light .ve2-main{background:#eef2f7!important}.voice-editor-backdrop.ve2-light .ve2-stage{background:#fff!important;border-color:#dbe4ee!important}
      .voice-editor-backdrop.ve2-light .ve2-wavebox{background:#f5f7fa!important;border-color:#d4deea!important}.voice-editor-backdrop.ve2-light .ve2-side{background:#eef2f7!important;border-color:#dbe4ee!important}
      .voice-editor-backdrop.ve2-light .ve2-section{background:#fff!important;border-color:#dbe4ee!important}.voice-editor-backdrop.ve2-light .miya-audio-editor-tabs{background:#f3f6fa!important;border-color:#dbe4ee!important}
      .voice-editor-backdrop.ve2-light .miya-audio-editor-tab{color:#64758a}.voice-editor-backdrop.ve2-light .miya-audio-editor-tab.active{color:#4e3976;background:#eee8ff}
      .voice-editor-backdrop.ve2-light .ve2-tool{background:#f5f7fa!important;color:#52657b!important;border-color:#d3deea!important}.voice-editor-backdrop.ve2-light .ve2-tool.active{background:#eee8ff!important;color:#5d438e!important;border-color:#bfaee0!important}
      .voice-editor-backdrop.ve2-light .ve2-panel{background:#faf8ff!important;border-color:#ddd1ef!important}.voice-editor-backdrop.ve2-light .ve2-wave-label{color:#7d6aa5!important}
      @media(max-width:980px){.voice-editor-dialog.ve2{grid-template-rows:68px minmax(0,1fr) 66px!important;height:100dvh!important}.ve2-head{height:68px!important}.ve2-body{grid-template-columns:1fr!important;overflow:auto!important}.ve2-main{min-height:55dvh!important;height:55dvh!important}.ve2-side{border-left:0!important;border-top:1px solid rgba(255,255,255,.075)!important}}
      @media(max-width:600px){.ve2-main{padding:9px!important}.ve2-stage{padding:10px!important;border-radius:18px!important}.ve2-side{padding:9px!important}.ve2-tools{grid-template-columns:1fr 1fr!important}.ve2-footer-note{display:none!important}.ve2-footer{justify-content:flex-end!important}}
    `;
    document.head.appendChild(s);
  };

  const addTabs=(dialog)=>{
    if(!dialog||dialog.dataset.miyaTabsReady==="1")return;
    const side=dialog.querySelector(".ve2-side"),tools=dialog.querySelector(".ve2-tools");
    if(!side||!tools)return;
    dialog.dataset.miyaTabsReady="1";
    const tabs=document.createElement("div");
    tabs.className="miya-audio-editor-tabs";
    tabs.innerHTML='<button type="button" class="miya-audio-editor-tab active" data-audio-tab="edit">МОНТАЖ</button><button type="button" class="miya-audio-editor-tab" data-audio-tab="ai">AI ИНСТРУМЕНТЫ</button>';
    side.querySelector(".ve2-section")?.prepend(tabs);
    const setTab=(tab)=>{
      tabs.querySelectorAll(".miya-audio-editor-tab").forEach(b=>b.classList.toggle("active",b.dataset.audioTab===tab));
      tools.querySelectorAll(".ve2-tool").forEach(b=>{
        const id=b.dataset.tool||"";
        const ai=id==="noise"||id==="split";
        b.style.display=(tab==="ai"?ai:!ai)?"":"none";
      });
      const active=tools.querySelector(".ve2-tool.active");
      if(active&&getComputedStyle(active).display==="none"){
        const next=[...tools.querySelectorAll(".ve2-tool")].find(b=>getComputedStyle(b).display!=="none");
        next?.click();
      }
    };
    tabs.querySelectorAll(".miya-audio-editor-tab").forEach(b=>b.onclick=()=>setTab(b.dataset.audioTab));
    setTab("edit");
  };

  const watch=()=>{installStyles();document.querySelectorAll(".voice-editor-dialog.ve2").forEach(addTabs)};
  new MutationObserver(watch).observe(document.body,{childList:true,subtree:true});
  watch();
})();
