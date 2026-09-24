const modes={
 chat:{title:"Твоя AI-комната",eyebrow:"AI CHAT · MIYA",subtitle:"Общайся с Miya, придумывай идеи и управляй созданием контента.",placeholder:"Напиши сообщение...",send:"Отправить",status:"AI Chat готов"},
 images:{title:"Картинки",eyebrow:"IMAGE STUDIO · FLUX",subtitle:"Создавай изображения с нуля или загружай исходник и описывай изменения.",placeholder:"Опиши картинку или что изменить в загруженном изображении...",send:"Создать",status:"FLUX Dev · Image generation & editing"},
 video:{title:"Видео",eyebrow:"VIDEO STUDIO · LTX",subtitle:"Создавай видео из текста или оживляй загруженные изображения.",placeholder:"Опиши сцену, движение и стиль видео...",send:"Создать видео",status:"LTX · Video generation"}
};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let mode="chat",referenceImage=null,chatStarted=false,chatMessages=[];
const CHAT_KEY="miyaChats";
function getChats(){try{return JSON.parse(localStorage.getItem(CHAT_KEY)||"[]").filter(x=>x&&Array.isArray(x.messages))}catch{return[]}}
function saveCurrentChat(){
 if(!chatMessages.length)return;
 const chats=getChats();
 const title=(chatMessages.find(x=>x.role==="user")?.content||"Новый чат").trim().slice(0,42);
 const currentId=window.__miyaChatId||Date.now().toString();
 const messagesForStorage=chatMessages.map(m=>m.image&&m.image.length<250000?m:{...m,image:""});
 const item={id:currentId,title,messages:messagesForStorage,updatedAt:Date.now()};
 const index=chats.findIndex(x=>x.id===currentId);
 if(index>=0)chats[index]=item;else chats.unshift(item);
 localStorage.setItem(CHAT_KEY,JSON.stringify(chats.slice(0,50)));
 window.__miyaChatId=currentId;
 renderChatHistoryMini();
}
function renderChatHistoryMini(){
 const box=$("#chatHistoryMini");if(!box)return;
 const chats=getChats();
 box.innerHTML="";
 chats.forEach(chat=>{
   const b=document.createElement("button");
   b.className="chat-history-mini-item"+(chat.id===window.__miyaChatId?" active":"");
   b.textContent=chat.title||"Новый чат";
   b.title=chat.title||"Новый чат";
   b.onclick=()=>{
     mode="chat";chatMessages=chat.messages.slice();window.__miyaChatId=chat.id;chatStarted=true;
     setMode("chat");const c=$("#canvas");c.innerHTML='<div class="chat-stream"></div>';
     chatMessages.forEach(m=>addChatMessage(m.content,m.role==="user",m.image||""));
     $("#composerInput").focus();
   };
   box.appendChild(b);
 });
}

const LIB_KEY="miyaLibrary";
function getLibrary(){try{return JSON.parse(localStorage.getItem(LIB_KEY)||"[]").filter(x=>x&&typeof x.url==="string"&&!x.url.includes("access.vheer.com/results/"))}catch{return[]}}
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
function openEditor(url){referenceImage=url;setComposerAttachment(url);mode="images";$("#composerModel").value="FLUX Kontext Dev";const m=modes.images;$("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;$("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent="Flux Kontext Dev · готово к редактированию";$(".image-settings").style.display="flex";$("#videoOptions").classList.remove("show");$$("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode==="images"));if(!$("#canvas .result-grid")) renderImageLibrary();$("#composerInput").focus();syncInput()}
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
function renderLibrary(){const c=$("#canvas"),items=getLibrary();if(!items.length){c.innerHTML='<div class="library-empty"><div class="hero-mark small">▱</div><h2>Библиотека пуста</h2><p>Созданные картинки и видео будут автоматически сохраняться здесь.</p></div>';return}const images=items.filter(x=>x.type==="image"),videos=items.filter(x=>x.type==="video");c.innerHTML='<div class="library-section"><div class="results-head"><div><span class="mini-badge">LIBRARY</span><h3>Библиотека Miya</h3></div></div><div class="library-title">Картинки</div><div class="result-grid image-library-grid"></div><div class="library-title video-library-title">Видео</div><div class="result-grid video-library-grid"></div></div>';const ig=c.querySelector(".image-library-grid"),vg=c.querySelector(".video-library-grid");images.forEach(item=>{const card=document.createElement("div");card.className="media-card";const img=document.createElement("img");img.alt="Miya generated image";card.appendChild(img);ig.appendChild(card);resolveMediaUrl(item).then(url=>{if(url)img.src=url})});videos.forEach(item=>{const card=document.createElement("div");card.className="media-card";const v=document.createElement("video");v.src=item.url;v.controls=true;v.playsInline=true;card.appendChild(v);vg.appendChild(card)});if(!images.length)ig.innerHTML='<div class="library-note">Пока нет созданных картинок.</div>';if(!videos.length)vg.innerHTML='<div class="library-note">Пока нет созданных видео.</div>'}

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
 if(newChat)newChat.onclick=()=>{
   chatStarted=false;
   chatMessages=[];window.__miyaChatId=null;
   $("#canvas").innerHTML=modeHero();
   bindChatUI();
   $("#composerInput").value="";
   syncInput();
   $("#composerInput").focus();
   $("#composerStatus").textContent="AI Chat готов";
 };
 Array.from(document.querySelectorAll("[data-chat-prompt]")).forEach(b=>b.onclick=()=>{
   $("#composerInput").value=b.dataset.chatPrompt||"";
   syncInput();
   $("#composerInput").focus();
 });
}
function bindQuickCards(){
 $$(".quick-card,.feature-card[data-prompt]").forEach(b=>b.onclick=()=>{
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
  card.innerHTML='<div class="generation-progress"><div class="progress-circle"><span class="progress-percent">0%</span></div><div class="progress-copy"><b>Создание изображения</b><span class="progress-model">FLUX Dev</span></div></div>';
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
 let progress=0; const progressTimer=setInterval(()=>{progress=Math.min(progress+Math.max(2,Math.round((96-progress)/18)),96);if(ring)ring.style.setProperty("--progress",progress+"%");if(ring)ring.querySelector(".progress-percent").textContent=progress+"%"},700);$("#composerStatus").textContent=referenceImage?"Flux Kontext Dev · Generating…":"FLUX Dev · Generating…";
 try{
  
  const payload={prompt,ratio:referenceImage?($("#composerRatio").value==="1:1"?"auto":$("#composerRatio").value):$("#composerRatio").value};
  if(referenceImage){if(referenceImage.startsWith("data:image/"))payload.imageBase64=referenceImage;else payload.imageUrl=referenceImage}
  const endpoint="/api/generate";
  const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({mode:"image",provider:"legacy-flux",prompt,model:$("#composerModel").value.trim(),ratio:$("#composerRatio").value,outputFormat:"png",options:referenceImage?payload:{} }),signal:AbortSignal.timeout(60000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.imageUrl)throw new Error(data.message||data.error||"Не удалось получить изображение");
  $("#canvas .generation-loading")?.remove();showImage(data.imageUrl);$("#composerInput").value="";syncInput();clearComposerAttachment();$("#composerModel").value="FLUX Dev";$("#composerStatus").textContent="FLUX Dev · Image ready";
 }catch(e){toast(e.message||"Ошибка генерации")}finally{clearInterval(progressTimer);$("#canvas .generation-loading")?.remove();$("#composerSend").disabled=false}
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
function setMode(next){
 mode=next;const m=modes[next];
 $("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;
 $("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent=m.status;
 $(".image-settings").style.display=next==="images"?"flex":"none";$("#videoOptions").classList.toggle("show",next==="video");
 $$("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode===next));
 $("#chatMenuToggle")?.classList.toggle("active",next==="chat");
 if($("#chatSubmenu")?.classList.contains("collapsed"))$("#chatSubmenu").classList.remove("collapsed");
 if($("#chatMenuToggle")){$("#chatMenuToggle").classList.remove("collapsed");$("#chatMenuToggle").setAttribute("aria-expanded","true")}
 if($("#chatMenuArrow"))$("#chatMenuArrow").textContent="→";
 if(next==="images"){ renderImageLibrary(); $("#composerModel").value=referenceImage?"FLUX Kontext Dev":"FLUX Dev"; $("#composerRatio").value="16:9" }
 if(next!=="images")showEmpty();syncInput()
}
const chatMenuToggle=$("#chatMenuToggle");
if(chatMenuToggle){
 chatMenuToggle.addEventListener("click",()=>setMode("chat"));
}
$$("[data-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
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
  referenceImage=String(reader.result||"");setComposerAttachment(referenceImage);
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
$("#composerMic").onclick=()=>{
 const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SpeechRecognition){toast("Голосовой ввод доступен в Chrome/Edge");return}
 const r=new SpeechRecognition();r.lang="ru-RU";r.interimResults=false;r.onresult=e=>{$("#composerInput").value=(e.results?.[0]?.[0]?.transcript||"");syncInput()};r.onerror=()=>toast("Не удалось распознать голос");r.start()
};
$("#improve").onclick=()=>{
 const i=$("#composerInput");if(i.value.trim())i.value=i.value.trim()+", cinematic composition, professional lighting, realistic textures, highly detailed, premium quality";else toast("Сначала введи промпт");syncInput()
};
$("#themeToggle").onclick=()=>{document.body.classList.toggle("light");$("#themeToggle").textContent=document.body.classList.contains("light")?"☾":"☼"};
$("#profileButton").onclick=()=>toast("Профиль Miya User · 0 PKOIN");
$$("[data-tool]").forEach(b=>b.onclick=()=>{
 const tool=b.dataset.tool;
 if(tool==="upload")$("#referenceInput").click();
 else if(tool==="improve")$("#improve").click();
 else if(tool==="history"){renderLibrary()}
 else renderLibrary();
});
setMode("chat");
renderChatHistoryMini();

