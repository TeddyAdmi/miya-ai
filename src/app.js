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
.media-action.media-more{width:32px!important;height:30px!important;min-width:32px!important;padding:0!important;border:1px solid rgba(255,255,255,.34)!important;border-radius:9px!important;background:rgba(255,255,255,.20)!important;box-shadow:0 4px 14px rgba(0,0,0,.16)!important;backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;color:#fff!important;display:grid!important;place-items:center!important}
.media-action.media-more:hover{background:rgba(0,0,0,.40)!important;border-color:rgba(255,255,255,.42)!important;color:#fff!important}
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
function warmMediaCache(items){
  /* Do not background-download whole videos: their native preload handles the
     first frame/metadata. IndexedDB warming is only for image previews. */
  const list=Array.isArray(items)
    ? items.filter(x=>x?.id&&x?.url&&x.type==="image"&&!isInvalidImageToolSource(x.url)).slice(0,12)
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
   const card=anchor.closest(".media-card");
   if(card){
     const cr=card.getBoundingClientRect(),ar=anchor.getBoundingClientRect();
     el.style.setProperty("position","absolute","important");
     el.style.setProperty("z-index","100000","important");
     el.style.setProperty("pointer-events","auto","important");
     el.style.setProperty("top",Math.round(ar.bottom-cr.top+6)+"px","important");
     el.style.setProperty("right","8px","important");
     el.style.setProperty("left","auto","important");
     el.style.setProperty("display","block","important");
   }
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
   const card=anchor.closest(".media-card");
   if(card&&el.parentElement!==card){
     el.__mediaOverlayParent=el.parentElement;
     el.__mediaOverlayNextSibling=el.nextSibling;
     card.appendChild(el);
   }
   el.classList.add("media-overlay-attached");
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
   try{
     await runImageBackgroundRemoval(item);
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
  menu.append(promptBtn ,upscaleMenuBtn,editBtn,videoBtn,copyBtn,downloadBtn,deleteBtn);
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
 if(composerInput){
   composerInput.placeholder=m.placeholder;
   composerInput.addEventListener("contextmenu",e=>e.stopPropagation(),true);
   composerInput.addEventListener("mousedown",e=>{if(e.button!==2)e.stopPropagation()},true);
   document.addEventListener("contextmenu",async e=>{
     if(mode!=="video")return;
     const rect=composerInput.getBoundingClientRect();
     if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return;
     e.preventDefault();e.stopPropagation();composerInput.focus({preventScroll:true});
     try{
       const text=await navigator.clipboard.readText();
       if(text){
         const startPos=composerInput.selectionStart??composerInput.value.length;
         const endPos=composerInput.selectionEnd??startPos;
         composerInput.setRangeText(text,startPos,endPos,"end");
         composerInput.dispatchEvent(new Event("input",{bubbles:true}));
         syncInput();toast("Текст вставлен");
       }
     }catch{toast("Разреши Miya Studio доступ к буферу обмена и нажми правой кнопкой ещё раз")}
   },true);
 }
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
 const url=String(item.url||"");
 const model=String(item.model||"").toLowerCase();
 return type==="video"||
   type==="videos"||
   /\\.(mp4|webm|mov)(?:[?#]|$)/i.test(url)||
   /ltx-2[.-]3||motion synthesis|agnes video/i.test(model);
}
function renderVideoLibrary(){
 const c=$("#canvas"),items=getLibrary().filter(isStoredVideo);
 if(!items.length){showEmpty();return}
 c.innerHTML='<div class="results-head"><div><h3>Все созданные видео</h3></div></div><div class="result-grid video-result-grid"></div>';
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
 c.innerHTML='<div class="results-head"><div><h3>Все созданные картинки</h3></div></div><div class="result-grid"></div>';
 const grid=c.querySelector(".result-grid");
 items.forEach(item=>grid.appendChild(buildMediaCard(item)));
 applyFirstSixMediaPriority(grid);
}
let voiceCatalog=[];let voiceAudioParts=[];let voiceAudioItem=null;
async function loadVoiceCatalog(){try{const r=await fetch("https://ahm7xmakki.com/api/voices",{cache:"force-cache"});const data=await r.json();voiceCatalog=Array.isArray(data?.voices)?data.voices:[];refreshVoiceSelects()}catch{voiceCatalog=[];const sel=$("#voiceSelect");if(sel)sel.innerHTML='<option value="">Не удалось загрузить голоса</option>'}}
function refreshVoiceSelects(){const lang=$("#voiceLanguage")?.value||"ru";const gender=$("#voiceGender")?.value||"female";const sel=$("#voiceSelect");if(!sel)return;const list=voiceCatalog.filter(v=>{const l=String(v.language||"").toLowerCase(),g=String(v.gender||"").toLowerCase();const langOk=lang==="ru"?(l.includes("russian")||l==="ru"||l.includes("russia")):(l.startsWith(lang)||l.includes(lang));const genderOk=gender==="female"?(g.includes("female")||g.includes("woman")):(g.includes("male")||g.includes("man"));return langOk&&genderOk});sel.innerHTML="";list.forEach(v=>{const o=document.createElement("option");o.value=String(v.index);o.textContent=String(v.name||"Voice")+" · "+String(v.gender||"")+" · "+String(v.country||"");sel.appendChild(o)});if(!list.length){const o=document.createElement("option");o.value="";o.textContent="Нет голосов";sel.appendChild(o)}else{const preferred=list.find(v=>/svetlana/i.test(v.name))||list.find(v=>/dmitry/i.test(v.name))||list[0];sel.value=String(preferred.index)}}
function splitVoiceText(text,max=1000){const clean=String(text||"").trim();if(!clean)return[];const out=[];for(let i=0;i<clean.length;i+=max)out.push(clean.slice(i,i+max));return out}
function buildVoiceCard(parts,item){const card=document.createElement("div");card.className="voice-result-card";const title=document.createElement("div");title.className="voice-result-title";title.textContent=item?.model||"Голос";const meta=document.createElement("div");meta.className="voice-result-meta";meta.textContent=parts.length+" частей · MP3";const audio=document.createElement("audio");audio.controls=true;audio.preload="metadata";const playBtn=document.createElement("button");playBtn.type="button";playBtn.className="voice-play";playBtn.textContent="▶ Прослушать";const download=document.createElement("button");download.type="button";download.className="voice-download";download.textContent="Скачать аудио";download.title="Скачать аудио в MP3";const actions=document.createElement("div");actions.className="voice-result-actions";actions.append(playBtn,download);card.append(title,meta,audio,actions);let current=0;const urls=parts.map(b=>URL.createObjectURL(b));const playNext=()=>{if(current>=urls.length){playBtn.textContent="▶ Прослушать";current=0;return}audio.src=urls[current];audio.play().catch(()=>{})};audio.onended=()=>{current++;playNext()};playBtn.onclick=()=>{if(!urls.length)return;if(!audio.paused){audio.pause();playBtn.textContent="▶ Прослушать";return}if(current>=urls.length)current=0;playNext();playBtn.textContent="Ⅱ Пауза"};download.onclick=()=>{const blob=new Blob(parts,{type:"audio/mpeg"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="miya-voice.mp3";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)};return card}
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
function renderVoiceLibrary(){const c=$("#canvas"),items=getLibrary().filter(x=>x.type==="audio");c.innerHTML='<div class="voice-wall"></div>';const wall=c.querySelector(".voice-wall");if(!items.length){wall.innerHTML='<div class="library-note">Пока нет созданных аудио.</div>';return}items.forEach(item=>{const card=document.createElement("div");card.className="voice-library-card";const title=document.createElement("b");title.textContent=item.model||"Аудио";const textEl=document.createElement("p");textEl.textContent=item.prompt||"";const audio=document.createElement("audio");audio.controls=true;audio.preload="metadata";resolveMediaUrl(item).then(url=>{if(url)audio.src=url});const del=document.createElement("button");del.type="button";del.textContent="Удалить";del.onclick=()=>confirmDeleteMedia(item,card);card.append(title,textEl,audio,del);wall.appendChild(card)})}
function renderLibrary(tab="images"){
 const c=$("#canvas"),items=getLibrary(),images=items.filter(x=>x.type==="image"),videos=items.filter(x=>x.type==="video"),audios=items.filter(x=>x.type==="audio");
 c.innerHTML='<div class="library-section"><div class="library-tabs"><button type="button" class="library-tab" data-library-tab="images">Картинки</button><button type="button" class="library-tab" data-library-tab="videos">Видео</button><button type="button" class="library-tab" data-library-tab="audio">Аудио</button></div><div class="result-grid library-media-grid"></div></div>';
 c.querySelectorAll("[data-library-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.libraryTab===tab));
 const grid=c.querySelector(".library-media-grid");
 if(tab==="audio"){
   grid.remove();
   const wall=document.createElement("div");wall.className="voice-wall library-audio-wall";c.querySelector(".library-section").appendChild(wall);
   if(!audios.length)wall.innerHTML='<div class="library-note">Пока нет созданных аудио.</div>';
   else audios.forEach(item=>{const card=document.createElement("div");card.className="voice-library-card";const title=document.createElement("b");title.textContent=item.model||"Аудио";const textEl=document.createElement("p");textEl.textContent=item.prompt||"";const audio=document.createElement("audio");audio.controls=true;audio.preload="metadata";resolveMediaUrl(item).then(url=>{if(url)audio.src=url});const del=document.createElement("button");del.type="button";del.textContent="Удалить";del.onclick=()=>confirmDeleteMedia(item,card);card.append(title,textEl,audio,del);wall.appendChild(card)});
 }else{
   const list=tab==="videos"?videos:images;
   if(!list.length)grid.innerHTML='<div class="library-note">'+(tab==="videos"?"Пока нет созданных видео.":"Пока нет созданных картинок.")+'</div>';
   else{list.forEach(item=>grid.appendChild(buildMediaCard(item,{video:tab==="videos"})));applyFirstSixMediaPriority(grid)}
 }
 c.querySelectorAll("[data-library-tab]").forEach(btn=>btn.onclick=()=>renderLibrary(btn.dataset.libraryTab));
}

function toast(message){
 let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";t.className="toast";document.body.appendChild(t)}
 t.textContent=message;t.classList.add("show");clearTimeout(window.__toast);
 window.__toast=setTimeout(()=>t.classList.remove("show"),2600)
}
function syncInput(){const i=$("#composerInput");if(!i)return;i.style.height="auto";const h=Math.min(120,Math.max(42,i.scrollHeight));i.style.height=h+"px";const row=i.closest(".composer-input-row");if(row)row.style.height=h+"px";const emoji=$("#composerEmoji");if(emoji)emoji.style.display=mode==="chat"?"":"none"}
function modeHero(){
 if(mode==="chat") return `<div class="studio-room clean-canvas chat-room">
   <div class="chat-welcome section-welcome">
     <div class="hero-mark"><span class="nav-icon icon-spark" aria-hidden="true"></span></div><div class="mini-badge">MIYA CHAT</div>
     <h2>Общайся с Miya</h2>
     <p>Задавай вопросы, придумывай идеи, создавай промпты и работай с контентом.</p>
   </div>
 </div>`;
 if(mode==="voice") return `<div class="studio-room clean-canvas"><div class="chat-welcome section-welcome"><div class="hero-mark voice"><span class="nav-icon icon-voice" aria-hidden="true"></span></div><div class="mini-badge">MIYA VOICE</div><h2>Текст в голос</h2><p>Выбери язык, мужской или женский голос и создай MP3 из текста.</p></div></div>`;
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
 const items=getLibrary().filter(isStoredVideo);
 c.innerHTML='<div class="results-head"><div><h3>Все созданные видео</h3></div></div><div class="result-grid video-result-grid"></div>';
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
  },900);
 };
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
   while(Date.now()-readyStarted<10*60*1000){
     try{
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
       : "LTX-2.3 временно отключён: бесплатная ZeroGPU-квота исчерпана.");
   }else{
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
async function cleverUtilsMcpUpscale(source,scale,model){
 let file=String(source||"").trim();
 if(!file)return "";
 if(!/^data:image\//i.test(file)){
   const response=await fetch(file,{cache:"no-store"});
   if(!response.ok)throw new Error("SOURCE_IMAGE_FETCH_FAILED");
   const blob=await response.blob();
   file=await new Promise((resolve,reject)=>{
     const reader=new FileReader();
     reader.onload=()=>resolve(String(reader.result||""));
     reader.onerror=()=>reject(reader.error||new Error("SOURCE_IMAGE_READ_FAILED"));
     reader.readAsDataURL(blob);
   });
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
  const st=document.createElement("style");st.id="miyaAiEditorFullCss";st.textContent=`.ai-editor-modal{z-index:2147483000!important}.ai-editor-modal.open{display:block!important}body.ai-editor-open{overflow:hidden!important}body.ai-editor-open .composer{display:none!important;visibility:hidden!important;pointer-events:none!important}body.ai-editor-open .composer-input-area{visibility:hidden!important;pointer-events:none!important}.ai-editor-dialog{inset:2vh 2vw!important}.ai-editor-head{height:72px!important;flex-shrink:0}.ai-editor-head-actions{display:flex;align-items:center;gap:8px}.ai-editor-reset-view{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.055);color:#fff;border-radius:11px;padding:9px 12px;font-weight:700;cursor:pointer}.ai-editor-workspace{grid-template-columns:minmax(0,1fr) 330px!important}.ai-editor-stage{overflow:hidden!important;padding:18px!important}.ai-editor-image{transform-origin:center center;transition:filter .12s ease,transform .12s ease}.ai-editor-mask{opacity:.45!important;background:transparent!important}.ai-editor-sidebar{overflow:hidden!important;display:flex!important;flex-direction:column!important;gap:9px!important;padding:14px!important}.ai-editor-section{padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:15px;background:rgba(255,255,255,.035)}.ai-editor-section-title{font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;opacity:.55;margin-bottom:9px}.ai-editor-tool-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ai-editor-tool,.ai-editor-undo,.ai-editor-redo,.ai-editor-clear,.ai-editor-view-btn{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.055);color:#fff;border-radius:10px;padding:9px 8px;font-weight:700;cursor:pointer}.ai-editor-tool.active{background:rgba(145,103,255,.24);border-color:rgba(171,135,255,.52)}.ai-editor-range-label{display:flex;justify-content:space-between;gap:12px;margin:10px 0 6px;font-size:11px;opacity:.72}.ai-editor-range-label b{opacity:1}.ai-editor-size,.ai-editor-zoom,.ai-editor-adjust{width:100%;accent-color:#a982ff}.ai-editor-actions-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.ai-editor-clear{width:100%;margin-top:8px}.ai-editor-zoom-row{display:grid;grid-template-columns:34px minmax(0,1fr) 34px 52px;align-items:center;gap:7px}.ai-editor-view-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.ai-editor-zoom-value{font-size:11px;text-align:right;opacity:.75}.ai-editor-hint{padding:10px 11px;border-radius:13px;background:rgba(255,255,255,.045);font-size:11px;line-height:1.45;color:rgba(255,255,255,.66)}.ai-editor-footer{display:grid;grid-template-columns:.7fr 1.1fr 1.25fr;gap:7px;margin-top:auto;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}.ai-editor-cancel,.ai-editor-download,.ai-editor-apply{min-height:42px;border-radius:11px;padding:9px 8px;font-weight:800;cursor:pointer}.ai-editor-cancel,.ai-editor-download{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#fff}.ai-editor-apply{border:0;background:linear-gradient(135deg,#9b72ff,#7251d9);color:#fff}.ai-editor-apply:disabled{opacity:.42;cursor:not-allowed}@media(max-width:800px){.ai-editor-dialog{inset:1vh 1vw!important}.ai-editor-workspace{grid-template-columns:1fr!important;grid-template-rows:minmax(0,1fr) auto!important}.ai-editor-sidebar{overflow:auto!important;padding:10px!important}.ai-editor-stage{padding:10px!important}.ai-editor-image{max-height:54vh}.ai-editor-hint{display:none}.ai-editor-reset-view{display:none}}`;document.head.appendChild(st);
 }
 if(!item)return;
 let modal=$("#aiEditorModal");
 if(!modal){
  modal=document.createElement("div");modal.id="aiEditorModal";modal.className="ai-editor-modal";
  modal.innerHTML=`<div class="ai-editor-backdrop"></div><div class="ai-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="aiEditorTitle">
  <div class="ai-editor-head"><div><div class="ai-editor-eyebrow">MIYA AI EDITOR</div><h2 id="aiEditorTitle">AI Редактор</h2></div><div class="ai-editor-head-actions"><button type="button" class="ai-editor-reset-view">Сбросить</button><button type="button" class="ai-editor-close" aria-label="Закрыть">×</button></div></div>
  <div class="ai-editor-workspace"><div class="ai-editor-stage"><div class="ai-editor-canvas-wrap"><img class="ai-editor-image" alt="Изображение для редактирования" draggable="false"><canvas class="ai-editor-mask"></canvas><div class="ai-editor-empty">Загрузка изображения…</div></div></div>
  <aside class="ai-editor-sidebar">
  <div class="ai-editor-section"><div class="ai-editor-section-title">Ретушь</div><div class="ai-editor-tool-grid"><button type="button" class="ai-editor-tool active" data-editor-tool="brush">Кисть</button><button type="button" class="ai-editor-tool" data-editor-tool="eraser">Ластик</button></div><label class="ai-editor-range-label"><span>Размер кисти</span><b class="ai-editor-size-value">60 px</b></label><input class="ai-editor-size" type="range" min="8" max="320" step="2" value="60"><div class="ai-editor-actions-row"><button type="button" class="ai-editor-undo" disabled>↶ Отменить</button><button type="button" class="ai-editor-redo" disabled>↷ Вернуть</button></div><button type="button" class="ai-editor-clear">Очистить выделение</button></div>
  <div class="ai-editor-section"><div class="ai-editor-section-title">Изображение</div><div class="ai-editor-zoom-row"><button type="button" class="ai-editor-view-btn" data-view-action="zoom-out">−</button><input class="ai-editor-zoom" type="range" min="50" max="200" step="5" value="100"><button type="button" class="ai-editor-view-btn" data-view-action="zoom-in">+</button><b class="ai-editor-zoom-value">100%</b></div><div class="ai-editor-view-grid"><button type="button" class="ai-editor-view-btn" data-view-action="fit">Вписать</button><button type="button" class="ai-editor-view-btn" data-view-action="rotate-left">↶ Повернуть</button><button type="button" class="ai-editor-view-btn" data-view-action="rotate-right">Повернуть ↷</button><button type="button" class="ai-editor-view-btn" data-view-action="flip-h">↔ Отразить</button><button type="button" class="ai-editor-view-btn" data-view-action="flip-v">↕ Отразить</button><button type="button" class="ai-editor-view-btn" data-view-action="reset">Сбросить вид</button></div></div>
  <div class="ai-editor-section"><div class="ai-editor-section-title">Коррекция</div><label class="ai-editor-range-label"><span>Яркость</span><b data-adjust-value="brightness">100%</b></label><input class="ai-editor-adjust" data-adjust="brightness" type="range" min="50" max="150" value="100"><label class="ai-editor-range-label"><span>Контраст</span><b data-adjust-value="contrast">100%</b></label><input class="ai-editor-adjust" data-adjust="contrast" type="range" min="50" max="150" value="100"><label class="ai-editor-range-label"><span>Насыщенность</span><b data-adjust-value="saturate">100%</b></label><input class="ai-editor-adjust" data-adjust="saturate" type="range" min="0" max="180" value="100"><label class="ai-editor-range-label"><span>Размытие</span><b data-adjust-value="blur">0 px</b></label><input class="ai-editor-adjust" data-adjust="blur" type="range" min="0" max="12" value="0"></div>
  <div class="ai-editor-hint">Белым отметь объект для удаления. Ластиком исправь маску. Остальные инструменты позволяют подготовить изображение прямо здесь.</div>
  <div class="ai-editor-footer"><button type="button" class="ai-editor-cancel">Отмена</button><button type="button" class="ai-editor-download">Скачать копию</button><button type="button" class="ai-editor-apply" disabled>Удалить объект</button></div>
  </aside></div></div>`;
  document.body.appendChild(modal);
  const image=modal.querySelector(".ai-editor-image"),mask=modal.querySelector(".ai-editor-mask"),wrap=modal.querySelector(".ai-editor-canvas-wrap"),empty=modal.querySelector(".ai-editor-empty");
  const sizeInput=modal.querySelector(".ai-editor-size"),sizeValue=modal.querySelector(".ai-editor-size-value"),undoButton=modal.querySelector(".ai-editor-undo"),redoButton=modal.querySelector(".ai-editor-redo"),applyButton=modal.querySelector(".ai-editor-apply"),zoomInput=modal.querySelector(".ai-editor-zoom"),zoomValue=modal.querySelector(".ai-editor-zoom-value"),toolButtons=[...modal.querySelectorAll("[data-editor-tool]")],adjustInputs=[...modal.querySelectorAll("[data-adjust]")];
  let ctx=null,painting=false,lastX=0,lastY=0,tool="brush",history=[],redoHistory=[],naturalWidth=0,naturalHeight=0,currentItem=null,view={zoom:100,rotate:0,flipX:1,flipY:1,brightness:100,contrast:100,saturate:100,blur:0};
  const hasPaint=()=>{if(!ctx)return false;try{const d=ctx.getImageData(0,0,naturalWidth,naturalHeight).data;for(let i=3;i<d.length;i+=4)if(d[i]>10)return true}catch{}return false};
  const updateButtons=()=>{undoButton.disabled=!history.length;redoButton.disabled=!redoHistory.length;applyButton.disabled=!hasPaint()};
  const snapshot=()=>{if(!ctx)return;try{history.push(ctx.getImageData(0,0,naturalWidth,naturalHeight));if(history.length>20)history.shift();redoHistory=[];updateButtons()}catch{}};
  const clearMask=()=>{if(!ctx)return;ctx.clearRect(0,0,naturalWidth,naturalHeight);history=[];redoHistory=[];updateButtons()};
  const point=ev=>{const r=mask.getBoundingClientRect();return{x:Math.max(0,Math.min(naturalWidth,(ev.clientX-r.left)*naturalWidth/r.width)),y:Math.max(0,Math.min(naturalHeight,(ev.clientY-r.top)*naturalHeight/r.height))}};
  const paint=ev=>{if(!painting||!ctx)return;const p=point(ev),brush=Number(sizeInput.value||60);ctx.save();ctx.globalCompositeOperation=tool==="eraser"?"destination-out":"source-over";ctx.strokeStyle="#fff";ctx.fillStyle="#fff";ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=brush;ctx.beginPath();ctx.moveTo(lastX,lastY);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.beginPath();ctx.arc(p.x,p.y,brush/2,0,Math.PI*2);ctx.fill();ctx.restore();lastX=p.x;lastY=p.y;updateButtons();ev.preventDefault()};
  mask.addEventListener("pointerdown",ev=>{if(!ctx)return;painting=true;mask.setPointerCapture?.(ev.pointerId);const p=point(ev);lastX=p.x;lastY=p.y;snapshot();paint(ev)});
  mask.addEventListener("pointermove",paint);const stop=ev=>{painting=false;try{mask.releasePointerCapture?.(ev.pointerId)}catch{}};mask.addEventListener("pointerup",stop);mask.addEventListener("pointercancel",stop);
  sizeInput.oninput=()=>sizeValue.textContent=sizeInput.value+" px";
  toolButtons.forEach(b=>b.onclick=()=>{tool=b.dataset.editorTool;toolButtons.forEach(x=>x.classList.toggle("active",x===b));wrap.classList.toggle("eraser-active",tool==="eraser")});
  undoButton.onclick=()=>{if(!ctx||!history.length)return;redoHistory.push(ctx.getImageData(0,0,naturalWidth,naturalHeight));ctx.putImageData(history.pop(),0,0);updateButtons()};
  redoButton.onclick=()=>{if(!ctx||!redoHistory.length)return;history.push(ctx.getImageData(0,0,naturalWidth,naturalHeight));ctx.putImageData(redoHistory.pop(),0,0);updateButtons()};
  modal.querySelector(".ai-editor-clear").onclick=clearMask;
  const applyView=()=>{image.style.transform="rotate("+view.rotate+"deg) scale("+((view.zoom/100)*view.flipX)+","+((view.zoom/100)*view.flipY)+")";image.style.filter="brightness("+view.brightness+"%) contrast("+view.contrast+"%) saturate("+view.saturate+"%) blur("+view.blur+"px)";zoomInput.value=String(view.zoom);zoomValue.textContent=view.zoom+"%"};
  const resetView=()=>{view={zoom:100,rotate:0,flipX:1,flipY:1,brightness:100,contrast:100,saturate:100,blur:0};zoomInput.value="100";adjustInputs.forEach(i=>{i.value=i.dataset.adjust==="blur"?"0":"100";const o=modal.querySelector('[data-adjust-value="'+i.dataset.adjust+'"]');if(o)o.textContent=i.dataset.adjust==="blur"?"0 px":"100%"});applyView()};
  zoomInput.oninput=()=>{view.zoom=Number(zoomInput.value);applyView()};
  modal.querySelectorAll("[data-view-action]").forEach(b=>b.onclick=()=>{const a=b.dataset.viewAction;if(a==="zoom-out")view.zoom=Math.max(50,view.zoom-10);else if(a==="zoom-in")view.zoom=Math.min(200,view.zoom+10);else if(a==="fit")view.zoom=100;else if(a==="rotate-left")view.rotate=(view.rotate+270)%360;else if(a==="rotate-right")view.rotate=(view.rotate+90)%360;else if(a==="flip-h")view.flipX*=-1;else if(a==="flip-v")view.flipY*=-1;else if(a==="reset")resetView();applyView()});
  adjustInputs.forEach(i=>i.oninput=()=>{view[i.dataset.adjust]=Number(i.value);const o=modal.querySelector('[data-adjust-value="'+i.dataset.adjust+'"]');if(o)o.textContent=i.dataset.adjust==="blur"?i.value+" px":i.value+"%";applyView()});
  modal.querySelector(".ai-editor-reset-view").onclick=resetView;modal.querySelector(".ai-editor-close").onclick=closeAiEditor;modal.querySelector(".ai-editor-cancel").onclick=closeAiEditor;modal.querySelector(".ai-editor-backdrop").onclick=closeAiEditor;
  const loadImage=src=>new Promise((res,rej)=>{image.onload=()=>{image.onload=null;image.onerror=null;res()};image.onerror=()=>{image.onload=null;image.onerror=null;rej(new Error("EDITOR_IMAGE_LOAD_FAILED"))};image.src=src});
  const loadBlob=async src=>{const rr=await fetch(src,{cache:"no-store"});if(!rr.ok)throw new Error("EDITOR_FETCH_"+rr.status);const blob=await rr.blob();if(!/^image\//i.test(blob.type))throw new Error("EDITOR_FETCH_NOT_IMAGE");const u=URL.createObjectURL(blob);await loadImage(u);return u};
  modal.__load=async item2=>{currentItem=item2;empty.style.display="flex";empty.textContent="Загрузка изображения…";image.removeAttribute("src");clearMask();resetView();const candidates=[];try{const cached=await getCachedMedia(item2?.id);if(cached?.blob)candidates.push(URL.createObjectURL(cached.blob))}catch{}const url=await mediaItemToReference(item2);if(url){candidates.push(url);const proxied=jpegImageUrl(url);if(proxied!==url)candidates.push(proxied);if(!/^data:image\//i.test(url)&&!/^blob:/i.test(url))candidates.push("/api/image?url="+encodeURIComponent(url))}let ok=false,last=null;for(const candidate of candidates){try{await loadImage(candidate);ok=true;break}catch(e){last=e;try{if(candidate.startsWith("/api/")){await loadBlob(candidate);ok=true;break}}catch(fe){last=fe}}}if(!ok)throw(last||new Error("EDITOR_IMAGE_LOAD_FAILED"));naturalWidth=image.naturalWidth;naturalHeight=image.naturalHeight;if(!naturalWidth||!naturalHeight)throw new Error("EDITOR_IMAGE_DIMENSIONS_INVALID");mask.width=naturalWidth;mask.height=naturalHeight;ctx=mask.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("AI_EDITOR_CANVAS_UNAVAILABLE");ctx.clearRect(0,0,naturalWidth,naturalHeight);history=[];redoHistory=[];updateButtons();empty.style.display="none"};
  modal.querySelector(".ai-editor-download").onclick=async()=>{try{const out=document.createElement("canvas"),swap=Math.abs(view.rotate)%180===90;out.width=swap?naturalHeight:naturalWidth;out.height=swap?naturalWidth:naturalHeight;const o=out.getContext("2d");o.imageSmoothingQuality="high";o.translate(out.width/2,out.height/2);o.rotate(view.rotate*Math.PI/180);o.scale(view.flipX*(view.zoom/100),view.flipY*(view.zoom/100));o.filter="brightness("+view.brightness+"%) contrast("+view.contrast+"%) saturate("+view.saturate+"%) blur("+view.blur+"px)";o.drawImage(image,-naturalWidth/2,-naturalHeight/2,naturalWidth,naturalHeight);const blob=await new Promise(r=>out.toBlob(r,"image/jpeg",.94));if(!blob)throw new Error();const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download="miya-edited.jpg";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);toast("Копия изображения сохранена")}catch{toast("Не удалось сохранить копию")}};
  applyButton.onclick=async()=>{if(!ctx||!currentItem||!hasPaint())return;applyButton.disabled=true;applyButton.textContent="Обработка…";try{const source=await mediaItemToReference(currentItem);if(!source)throw new Error("EDITOR_SOURCE_EMPTY");let imageBlob;if(/^data:image\//i.test(source)){const rr=await fetch(source);if(!rr.ok)throw new Error("SOURCE_IMAGE_READ_FAILED");imageBlob=await rr.blob()}else{const rr=await fetch("/api/image?url="+encodeURIComponent(source),{cache:"no-store"});if(!rr.ok)throw new Error("SOURCE_IMAGE_PROXY_FAILED");imageBlob=await rr.blob()}const uploadFile=await makeCleverUtilsImageFile(imageBlob);const exportMask=document.createElement("canvas");exportMask.width=naturalWidth;exportMask.height=naturalHeight;const ec=exportMask.getContext("2d");ec.fillStyle="#000";ec.fillRect(0,0,naturalWidth,naturalHeight);ec.drawImage(mask,0,0);const maskBlob=await new Promise((r,j)=>exportMask.toBlob(b=>b?r(b):j(new Error("MASK_EXPORT_FAILED")),"image/png"));const form=new FormData();form.append("file",uploadFile);form.append("mask",new File([maskBlob],"miya-mask.png",{type:"image/png"}));const rr=await fetch("https://cleverutils.com/api/v1/tools/remove-object",{method:"POST",body:form,headers:{Accept:"application/json"},cache:"no-store"});const data=await rr.json().catch(()=>({}));if(!rr.ok)throw new Error(data?.message||data?.error?.message||data?.error||"REMOVE_OBJECT_FAILED");const job=data?.data||data;let outputUrl=typeof job?.output?.url==="string"?job.output.url:"";const jobId=typeof job?.job_id==="string"?job.job_id:String(job?.jobId||"");if(!outputUrl&&jobId)outputUrl=await waitForCleverUtilsJob(jobId);if(!outputUrl)throw new Error("IMAGE_TOOL_OUTPUT_MISSING");const label="CleverUtils · AI Редактор · Удаление объекта";saveMedia("image",outputUrl,"Удаление объекта",label,"");closeAiEditor();renderImageLibrary();requestAnimationFrame(()=>scrollImagesToTop?.());if($("#composerStatus"))$("#composerStatus").textContent=label+" · готово";toast("Объект удалён")}catch(e){console.error("Miya AI editor remove-object failed",e);toast(String(e?.message||"Не удалось удалить объект"))}finally{applyButton.disabled=!hasPaint();applyButton.textContent="Удалить объект"}};
 }
 modal.classList.add("open");
 document.body.classList.add("ai-editor-open");
 try{
   await modal.__load(item);
 }catch(e){
   console.error("Miya AI editor open failed",e);
   closeAiEditor();
   toast("Не удалось открыть редактор");
 }
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
function setMode(next,render=true){
 const target=String(next||"chat");
 if(!modes[target])return;
 const changedSection=target!==mode;
 if(changedSection)resetVideoProgress();
 if(changedSection){
   referenceImage=null;
   try{sessionStorage.removeItem("miyaReferenceImage")}catch{}
   setComposerAttachment("");
   const input=$("#composerInput");
   if(input)input.value="";
 }
 mode=target;
 const m=modes[target];
 const composer=$("#composer"); if(composer) composer.classList.toggle("voice-mode",target==="voice");
 const canvas=$("#canvas");

 // Clear the previous section immediately, before any model/quota refresh.
 if(render&&canvas){
   canvas.classList.toggle("chat-canvas",target==="chat");
   canvas.innerHTML="";
 }

 $("#workspaceEyebrow").textContent=m.eyebrow;
 const workspaceTitle=$("#workspaceTitle"); if(workspaceTitle) workspaceTitle.textContent=m.title;
 const workspaceSubtitle=$("#workspaceSubtitle"); if(workspaceSubtitle) workspaceSubtitle.textContent=m.subtitle;
 $("#composerInput").placeholder=m.placeholder;
 const composerSendText=$("#composerSendText"); if(composerSendText) composerSendText.textContent=m.send;
 const composerStatus=$("#composerStatus"); if(composerStatus) composerStatus.textContent=m.status;
 const imageSettings=$(".image-settings"); if(imageSettings) imageSettings.style.display=target==="images"?"flex":"none";
 const voiceOptions=$("#voiceOptions"); if(voiceOptions) voiceOptions.classList.toggle("show",target==="voice");
 const videoOptions=$("#videoOptions"); if(videoOptions) videoOptions.classList.toggle("show",target==="video");

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
$("#composerInput").addEventListener("input",syncInput);
const composerInput=$("#composerInput");
if(composerInput){
 // Video elements are kept out of the hit-test entirely; the media card
 // still opens the video viewer on click. This prevents Firefox from treating
 // the video preview as the prompt target when the fixed composer overlaps it.
 composerInput.addEventListener("contextmenu",e=>{e.stopPropagation();},true);
 composerInput.addEventListener("mousedown",e=>{if(e.button===2)e.stopPropagation();},true);
}
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
}

function ensureSpeechVisualizer(){
  let canvas=$("#composerVoiceVisualizer");
  if(canvas)return canvas;
  const row=document.querySelector(".composer-input-row");
  if(!row)return null;
  canvas=document.createElement("canvas");
  canvas.id="composerVoiceVisualizer";
  canvas.width=192;
  canvas.height=28;
  canvas.setAttribute("aria-hidden","true");
  Object.assign(canvas.style,{
    position:"absolute",
    left:"48px",
    top:"50%",
    transform:"translate(-50%,-50%)",
    width:"150px",
    height:"24px",
    display:"none",
    pointerEvents:"none",
    zIndex:"1004",
    opacity:".95"
  });
  row.appendChild(canvas);
  return canvas;
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
    const bars=32;
    const gap=3;
    const width=(canvas.width-gap*(bars-1))/bars;
    for(let i=0;i<bars;i++){
      const index=Math.min(data.length-1,Math.floor(i*data.length/bars));
      const value=data[index]/255;
      const height=Math.max(3,value*23);
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
      const prefix=speechBaseText.trim();
      input.value=prefix+(prefix?" ":"")+text;
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
    speechBaseText=$("#composerInput")?.value.trim()||"";
    recorder.ondataavailable=e=>{
      if(e.data?.size)speechChunks.push(e.data);
    };
    recorder.onerror=()=>toast("Ошибка записи микрофона");
    recorder.onstop=()=>processSpeechRecording();
    speechRecorder=recorder;
    const canvas=ensureSpeechVisualizer();
    if(canvas)canvas.style.display="block";
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
document.addEventListener("click",e=>{if(!e.target.closest(".media-actions")&&!e.target.closest(".media-action-menu")&&!e.target.closest(".media-upscale-panel"))closeAllMediaMenus()});
let mediaOverlayRepositionFrame=0;
function scheduleMediaOverlayReposition(){
 if(mediaOverlayRepositionFrame)return;
 mediaOverlayRepositionFrame=requestAnimationFrame(()=>{
   mediaOverlayRepositionFrame=0;
   document.querySelectorAll(".media-action-menu.open").forEach(m=>{
     const anchor=m.__mediaOverlayAnchor;
     if(anchor?.isConnected)positionFloatingMediaOverlay(m,anchor,"menu");
   });
   document.querySelectorAll(".media-upscale-panel.open").forEach(p=>{
     const anchor=p.__mediaOverlayAnchor;
     if(anchor?.isConnected)positionFloatingMediaOverlay(p,anchor,"panel");
   });
 });
}
window.addEventListener("resize",scheduleMediaOverlayReposition);
document.addEventListener("scroll",scheduleMediaOverlayReposition,true);

