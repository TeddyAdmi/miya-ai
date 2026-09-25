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
   pin.innerHTML='<span class="menu-icon">'+(chat.pinned?"★":"☆")+'</span><span>'+(chat.pinned?"Открепить":"Закрепить")+'</span>';
   pin.onclick=e=>{
     e.preventDefault();e.stopPropagation();
     const all=getChats(),item=all.find(x=>x.id===chat.id);
     if(item){item.pinned=!item.pinned;persistChats(all);renderChatHistoryMini()}
   };

   const rename=document.createElement("button");rename.type="button";
   rename.innerHTML='<span class="menu-icon">✎</span><span>Переименовать</span>';
   rename.onclick=e=>{
     e.preventDefault();e.stopPropagation();
     menu.classList.add("rename-open");menu.innerHTML="";
     const label=document.createElement("div");label.className="rename-label";label.textContent="Название чата";
     const input=document.createElement("input");input.className="chat-rename-input";input.value=chat.title||"Новый чат";input.maxLength=60;
     const save=document.createElement("button");save.type="button";save.className="chat-rename-save";save.innerHTML='<span class="menu-icon">✓</span><span>Сохранить</span>';
     const cancel=document.createElement("button");cancel.type="button";cancel.className="chat-rename-cancel";cancel.innerHTML='<span class="menu-icon">×</span><span>Отмена</span>';
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
   del.innerHTML='<span class="menu-icon">×</span><span>Удалить</span>';
   del.onclick=e=>{
     e.preventDefault();e.stopPropagation();
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
function openSavedChat(id){
 const chat=getChats().find(x=>x.id===id);if(!chat)return;
 chatMenuSuppressed=true;$("#chatSubmenu")?.classList.add("suppressed");resetChatMenus();
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
function saveMedia(type,url){
 if(!url)return;
 const id=type+"-"+Date.now()+"-"+Math.random().toString(36).slice(2);
 const item={id,type,url,createdAt:Date.now()};
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
function openEditor(url){referenceImage=url;setComposerAttachment(url);mode="images";$("#composerModel").value="FLUX Kontext Dev";const m=modes.images;$("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;$("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent="Flux Kontext Dev · готово к редактированию";$(".image-settings").style.display="flex";$("#videoOptions").classList.remove("show");document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode==="images"));if(!$("#canvas .result-grid")) renderImageLibrary();$("#composerInput").focus();syncInput()}
async function downloadImage(url){
 try{
  const response=await fetch(url,{mode:"cors"});
  if(!response.ok)throw new Error("DOWNLOAD_HTTP_"+response.status);
  const blob=await response.blob();
  const objectUrl=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=objectUrl;
  a.download="miya-image.png";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
 }catch{
  const a=document.createElement("a");
  a.href=url;a.download="miya-image.png";a.target="_blank";
  document.body.appendChild(a);a.click();a.remove();
 }
}
function renderImageLibrary(){const c=$("#canvas"),items=getLibrary().filter(x=>x.type==="image");if(!items.length){showEmpty();return}c.innerHTML='<div class="results-head"><div><span class="mini-badge">LIBRARY · IMAGES</span><h3>Все созданные картинки</h3></div></div><div class="result-grid"></div>';const grid=c.querySelector(".result-grid");items.forEach(item=>{const card=document.createElement("div");card.className="media-card";const img=document.createElement("img");img.alt="Miya generated image";img.onerror=()=>card.remove();card.appendChild(img);resolveMediaUrl(item).then(url=>{if(url)img.src=url});const meta=document.createElement("div");meta.className="media-meta";meta.innerHTML="<b>FLUX Dev</b><span>Готово</span>";card.appendChild(meta);grid.appendChild(card)})}
function renderLibrary(){const c=$("#canvas"),items=getLibrary();if(!items.length){c.innerHTML='<div class="studio-room clean-canvas"><div class="section-welcome"><div class="mini-badge">LIBRARY</div><h2>Библиотека пуста</h2><p>Созданные картинки и видео будут автоматически сохраняться здесь.</p></div></div>';return}const images=items.filter(x=>x.type==="image"),videos=items.filter(x=>x.type==="video");c.innerHTML='<div class="library-section"><div class="results-head"><div><span class="mini-badge">LIBRARY</span><h3>Библиотека Miya</h3></div></div><div class="library-title">Картинки</div><div class="result-grid image-library-grid"></div><div class="library-title video-library-title">Видео</div><div class="result-grid video-library-grid"></div></div>';const ig=c.querySelector(".image-library-grid"),vg=c.querySelector(".video-library-grid");images.forEach(item=>{const card=document.createElement("div");card.className="media-card";const img=document.createElement("img");img.alt="Miya generated image";card.appendChild(img);ig.appendChild(card);resolveMediaUrl(item).then(url=>{if(url)img.src=url})});videos.forEach(item=>{const card=document.createElement("div");card.className="media-card";const v=document.createElement("video");v.src=item.url;v.controls=true;v.playsInline=true;card.appendChild(v);vg.appendChild(card)});if(!images.length)ig.innerHTML='<div class="library-note">Пока нет созданных картинок.</div>';if(!videos.length)vg.innerHTML='<div class="library-note">Пока нет созданных видео.</div>'}

function toast(message){
 let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";t.className="toast";document.body.appendChild(t)}
 t.textContent=message;t.classList.add("show");clearTimeout(window.__toast);
 window.__toast=setTimeout(()=>t.classList.remove("show"),2600)
}
function syncInput(){const i=$("#composerInput");if(!i)return;i.style.height="auto";i.style.height=Math.min(120,Math.max(42,i.scrollHeight))+"px"}
function modeHero(){
 if(mode==="chat") return `<div class="studio-room clean-canvas chat-room">
   <div class="chat-welcome section-welcome">
     <div class="hero-mark">✦</div><div class="mini-badge">MIYA CHAT</div>
     <h2>Общайся с Miya</h2>
     <p>Задавай вопросы, придумывай идеи, создавай промпты и работай с контентом.</p>
   </div>
 </div>`;
 if(mode==="images") return `<div class="studio-room clean-canvas">
   <div class="chat-welcome section-welcome">
     <div class="hero-mark image">▧</div><div class="mini-badge">MIYA IMAGES</div>
     <h2>Создавай изображения</h2>
     <p>Создавай новые изображения или редактируй исходники с помощью AI.</p>
   </div>
 </div>`;
 return `<div class="studio-room clean-canvas">
   <div class="chat-welcome section-welcome">
     <div class="hero-mark video">▶</div><div class="mini-badge">MIYA VIDEO</div>
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
  const card=document.createElement("div");card.className="generation-loading";
  card.dataset.model=$("#composerModel")?.value||"FLUX Dev";
  card.innerHTML='<div class="generation-progress"><div class="progress-circle"><span class="progress-percent">0%</span></div><div class="progress-copy"><b>Генерация изображения</b><span class="progress-model">FLUX Dev · запрос выполняется</span></div></div>';
  c.insertBefore(card,grid);return;
 }
 c.innerHTML='<div class="loading-state"><div class="spinner"></div><b>Готовим видео…</b><span>Запрос отправлен в видеодвижок Miya.</span></div>';
}
function showImage(url){
 const c=$("#canvas");let grid=c.querySelector(".result-grid");
 if(!grid){c.innerHTML='<div class="result-grid"></div>';grid=c.querySelector(".result-grid")}
 const card=document.createElement("div");card.className="media-card";const img=document.createElement("img");img.src=url;img.alt="Miya generated image";card.appendChild(img);
 const actions=document.createElement("div");actions.className="media-actions";
actions.innerHTML='<button class="media-action edit-action" title="Редактировать" aria-label="Редактировать">✦</button><button class="media-action download-action" title="Скачать" aria-label="Скачать">↓</button>';
card.appendChild(actions);
 const meta=document.createElement("div");meta.className="media-meta";meta.innerHTML='<b>FLUX Dev</b><span>Готово</span>';card.appendChild(meta);grid.prepend(card);
 saveMedia("image",url);
 card.querySelector(".edit-action").onclick=()=>openEditor(url);
 card.querySelector(".download-action").onclick=()=>downloadImage(url);
 $("#composerStatus").textContent="FLUX Dev · Image ready";
}
async function generateImage(prompt){
 showLoading();$("#composerSend").disabled=true;
 const loader=$("#canvas .generation-loading"),ring=loader?.querySelector(".progress-circle");
 let progress=0; const progressTimer=setInterval(()=>{progress=Math.min(progress+Math.max(2,Math.round((96-progress)/18)),96);if(ring)ring.style.setProperty("--progress",progress+"%");if(ring)ring.querySelector(".progress-percent").textContent=progress+"%"},700);$("#composerStatus").textContent=referenceImage?"FLUX Kontext Dev · генерация…":"FLUX Dev · генерация…";
 try{
  
  const payload={prompt,ratio:referenceImage?($("#composerRatio").value==="1:1"?"auto":$("#composerRatio").value):$("#composerRatio").value};
  if(referenceImage){if(referenceImage.startsWith("data:image/"))payload.imageBase64=referenceImage;else payload.imageUrl=referenceImage}
  const endpoint="/api/generate";
  const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({mode:"image",provider:"legacy-flux",prompt,model:$("#composerModel").value.trim(),ratio:$("#composerRatio").value,outputFormat:"png",options:referenceImage?payload:{} }),signal:AbortSignal.timeout(60000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.imageUrl)throw new Error(data.message||data.error||"Не удалось получить изображение");
  const actualModel=data.model||"FLUX Dev"; const modelLabel2=loader?.querySelector(".progress-model"); if(modelLabel2)modelLabel2.textContent=actualModel+" · ответ получен"; $("#canvas .generation-loading")?.remove();showImage(data.imageUrl);$("#composerInput").value="";syncInput();$("#composerModel").value=referenceImage?"FLUX Kontext Dev":"FLUX Dev";$("#composerStatus").textContent="FLUX Dev · Image ready";
 }catch(e){toast(e.message||"Ошибка генерации")}finally{$("#canvas .generation-loading")?.remove();$("#composerSend").disabled=false}
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
   actions.innerHTML='<button title="Копировать">Копировать</button><button title="Повторить">Повторить</button><button title="Создать изображение">▧ Изображение</button><button title="Создать видео">▶ Видео</button>';
   actions.querySelector('[title="Копировать"]').onclick=()=>navigator.clipboard?.writeText(text).then(()=>toast("Скопировано"));
   actions.querySelector('[title="Создать изображение"]').onclick=()=>{setMode("images");$("#composerInput").value=text;syncInput();$("#composerInput").focus()};
   actions.querySelector('[title="Создать видео"]').onclick=()=>{setMode("video");$("#composerInput").value=text;syncInput();$("#composerInput").focus()};
   content.appendChild(actions);
 }
 row.append(av,content);stream.appendChild(row);stream.scrollTop=stream.scrollHeight;
 chatStarted=true;
}
async function requestChat(){
 const status=$("#composerStatus");
 status.textContent="Miya думает…";
 $("#composerSend").disabled=true;
 try{
   const response=await fetch("/api/generate",{
     method:"POST",
     headers:{"Content-Type":"application/json","Accept":"application/json"},
     body:JSON.stringify({mode:"chat",model:"gemini-3.8-flash",messages:chatMessages}),
     signal:AbortSignal.timeout(90000)
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok||!data.text) throw new Error(data.message||data.error||"Не удалось получить ответ Miya");
   chatMessages.push({role:"assistant",content:data.text});
   addChatMessage(data.text,false);
   saveCurrentChat();
   status.textContent="Miya · Gemini";
 }catch(e){
   toast(e.message||"Ошибка AI Chat");
   status.textContent="AI Chat · ошибка";
 }finally{
   $("#composerSend").disabled=false;
 }
}
function restoreReferenceImage(){try{referenceImage=referenceImage||sessionStorage.getItem("miyaReferenceImage")||""}catch{};setComposerAttachment(referenceImage||"")}
function setMode(next,render=true){
 restoreReferenceImage();mode=next;const m=modes[next];
 $("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;
 $("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent=m.status;
 $(".image-settings").style.display=next==="images"?"flex":"none";$("#videoOptions").classList.toggle("show",next==="video");
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
   $("#composerRatio").value="16:9";
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
   setMode("chat");
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
$("#composerAttachmentRemove").onclick=()=>clearComposerAttachment();
$("#referenceInput").onchange=e=>{
 const file=e.target.files?.[0];if(!file)return;
 const reader=new FileReader();
 reader.onload=()=>{
  referenceImage=String(reader.result||"");try{sessionStorage.setItem("miyaReferenceImage",referenceImage)}catch{};setComposerAttachment(referenceImage);
  if(mode==="images"){
    $("#composerModel").value="FLUX Kontext Dev";
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
$("#improve").onclick=()=>{
 const i=$("#composerInput");if(i.value.trim())i.value=i.value.trim()+", cinematic composition, professional lighting, realistic textures, highly detailed, premium quality";else toast("Сначала введи промпт");syncInput()
};
const emojiButton=$("#composerEmoji");
const emojiPanel=$("#emojiPanel");
if(emojiButton&&emojiPanel){
 emojiButton.onclick=e=>{e.preventDefault();e.stopPropagation();emojiPanel.classList.toggle("open");};
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
   mode="chat";
   document.querySelectorAll("[data-mode]").forEach(x=>x.classList.remove("active"));
   $("#chatMenuToggle")?.classList.remove("active");
   $("#canvas").innerHTML="";
   renderLibrary();
 }
});
renderChatHistoryMini();
setMode("chat");
renderChatHistoryMini();


const chatNavWrap=$("#chatNavWrap")||$(".chat-nav-wrap");
if(chatNavWrap){chatNavWrap.addEventListener("mouseleave",()=>{chatMenuSuppressed=false;$("#chatSubmenu")?.classList.remove("suppressed");$("#chatMenuToggle")?.setAttribute("aria-expanded","false")})}

// Keep chat action menus from becoming sticky when the pointer leaves the flyout.
document.addEventListener("click",e=>{if(!e.target.closest(".chat-history-row"))resetChatMenus()});
