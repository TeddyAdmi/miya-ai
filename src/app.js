const modes={
 chat:{title:"Твоя AI-комната",eyebrow:"AI CHAT · MIYA",subtitle:"Общайся с Miya, придумывай идеи и управляй созданием контента.",placeholder:"Напиши сообщение...",send:"Отправить",status:"AI Chat готов"},
 images:{title:"Картинки",eyebrow:"IMAGE STUDIO · FLUX",subtitle:"Создавай изображения с нуля или загружай исходник и описывай изменения.",placeholder:"Опиши картинку или что изменить в загруженном изображении...",send:"Создать",status:"FLUX Dev · Image generation & editing"},
 video:{title:"Видео",eyebrow:"VIDEO STUDIO · LTX",subtitle:"Создавай видео из текста или оживляй загруженные изображения.",placeholder:"Опиши сцену, движение и стиль видео...",send:"Создать видео",status:"LTX · Video generation"}
};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let mode="chat",referenceImage=null,chatStarted=false;

function toast(message){
 let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";t.className="toast";document.body.appendChild(t)}
 t.textContent=message;t.classList.add("show");clearTimeout(window.__toast);
 window.__toast=setTimeout(()=>t.classList.remove("show"),2600)
}
function syncInput(){const i=$("#composerInput");if(!i)return;i.style.height="auto";i.style.height=Math.min(120,Math.max(42,i.scrollHeight))+"px"}
function modeHero(){
 if(mode==="chat") return `<div class="chat-room">
   <div class="chat-welcome">
     <div class="hero-mark">✦</div><div class="mini-badge">MIYA AI</div>
     <h2>Чем займёмся сегодня?</h2>
     <p>Напиши идею — Miya поможет превратить её в текст, изображение или видео.</p>
   </div>
   <div class="quick-grid">
     <button class="quick-card" data-prompt="Придумай 5 идей для вирусного короткого видео"><span class="q-icon purple">✦</span><b>Идеи для контента</b><small>Придумать вирусные идеи</small></button>
     <button class="quick-card" data-prompt="Создай кинематографичный промпт для изображения"><span class="q-icon blue">▧</span><b>Создать изображение</b><small>Промпт для FLUX</small></button>
     <button class="quick-card" data-prompt="Придумай сценарий короткого AI-видео"><span class="q-icon cyan">▶</span><b>Создать видео</b><small>Сценарий + движение</small></button>
     <button class="quick-card" data-prompt="Улучши мой промпт и добавь кинематографичную детализацию"><span class="q-icon gold">✦</span><b>Улучшить промпт</b><small>Свет, камера, детали</small></button>
   </div>
 </div>`;
 if(mode==="images") return `<div class="studio-room">
   <div class="room-intro"><div class="hero-mark small">▧</div><div><div class="mini-badge">FLUX IMAGE ENGINE</div><h2>Создай или измени изображение</h2><p>Один промпт — генерация или редактирование с исходным изображением.</p></div></div>
   <div class="feature-row">
    <button class="feature-card" id="uploadFeature"><span class="feature-icon purple">＋</span><div><b>Изображение → Изображение</b><small>Загрузи фото и опиши изменения</small></div><i>→</i></button>
    <button class="feature-card" data-prompt="Cinematic editorial portrait, dramatic lighting, premium photography, ultra detailed"><span class="feature-icon blue">✦</span><div><b>Текст → Изображение</b><small>Начать с чистого промпта</small></div><i>→</i></button>
   </div>
   <div class="model-strip"><div><span class="live-dot"></span><b>FLUX Dev</b><small>Основная модель Miya</small></div><span class="model-chip">FAST</span><span class="model-chip quality">QUALITY</span></div>
 </div>`;
 return `<div class="studio-room">
   <div class="room-intro"><div class="hero-mark video">▶</div><div><div class="mini-badge">LTX VIDEO ENGINE</div><h2>Создай видео с помощью AI</h2><p>Текст → видео или изображение → видео. Настройки доступны прямо внизу.</p></div></div>
   <div class="feature-row">
    <button class="feature-card" id="videoTextFeature" data-prompt="Cinematic camera movement, natural motion, premium film lighting"><span class="feature-icon cyan">T</span><div><b>Текст → Видео</b><small>Опиши сцену и движение</small></div><i>→</i></button>
    <button class="feature-card" id="videoImageFeature"><span class="feature-icon orange">▧</span><div><b>Изображение → Видео</b><small>Оживи загруженное изображение</small></div><i>→</i></button>
   </div>
   <div class="model-strip"><div><span class="live-dot"></span><b>LTX 2.3</b><small>Video generation</small></div><span class="model-chip">5 SEC</span><span class="model-chip">AUDIO</span></div>
 </div>`;
}
function showEmpty(){
 const c=$("#canvas");c.innerHTML=modeHero();bindQuickCards();
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
 $("#canvas").innerHTML=`<div class="loading-state"><div class="spinner"></div><b>${mode==="images"?"Создаём изображение…":"Готовим видео…"}</b><span>${mode==="images"?"FLUX обрабатывает твой запрос.":"Запрос отправлен в видеодвижок Miya."}</span></div>`
}
function showImage(url){
 const c=$("#canvas");let grid=c.querySelector(".result-grid");
 if(!grid){c.innerHTML='<div class="results-head"><div><span class="mini-badge">RESULT</span><h3>Результаты Miya</h3></div><button class="ghost-btn" id="backToStudio">＋ Ещё</button></div>';grid=document.createElement("div");grid.className="result-grid";c.appendChild(grid)}
 const card=document.createElement("div");card.className="media-card";const img=document.createElement("img");img.src=url;img.alt="Miya generated image";card.appendChild(img);
 const meta=document.createElement("div");meta.className="media-meta";meta.innerHTML='<b>FLUX Dev</b><span>Готово</span>';card.appendChild(meta);grid.prepend(card);
 const back=$("#backToStudio");if(back)back.onclick=showEmpty;
 $("#composerStatus").textContent="FLUX Dev · Image ready";
}
async function generateImage(prompt){
 showLoading();$("#composerSend").disabled=true;$("#composerStatus").textContent="FLUX Dev · Generating…";
 try{
  const size=$("#composerSize").value.trim();
  const response=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({
   mode:"image",provider:"legacy-flux",prompt,model:$("#composerModel").value.trim(),quality:$("#composerQuality").value.trim(),size,ratio:"1:1",outputFormat:"png",
   options:referenceImage?{imageUrl:referenceImage}:{}
  })});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.imageUrl)throw new Error(data.message||data.error||"Не удалось получить изображение");
  showImage(data.imageUrl);$("#composerInput").value="";syncInput();
 }catch(e){toast(e.message||"Ошибка генерации");showEmpty()}finally{$("#composerSend").disabled=false}
}
function addChatMessage(text,isUser){
 let stream=$("#canvas .chat-stream");if(!stream){$("#canvas").innerHTML='<div class="chat-stream"></div>';stream=$("#canvas .chat-stream")}
 const welcome=stream.querySelector(".chat-welcome");if(welcome)welcome.remove();
 const row=document.createElement("div");row.className="chat-row "+(isUser?"user":"assistant");
 const av=document.createElement("div");av.className="chat-avatar";av.textContent=isUser?"U":"M";
 const bubble=document.createElement("div");bubble.className="chat-bubble";bubble.textContent=text;row.append(av,bubble);stream.appendChild(row);stream.scrollTop=stream.scrollHeight;
 chatStarted=true;
}
function addLocalAssistant(){
 setTimeout(()=>addChatMessage("Готово. Я могу подготовить идею, промпт и структуру задачи для Miya. Генерация изображения доступна во вкладке «Картинки».",false),280)
}
function setMode(next){
 mode=next;const m=modes[next];
 $("#workspaceEyebrow").textContent=m.eyebrow;$("#workspaceTitle").textContent=m.title;$("#workspaceSubtitle").textContent=m.subtitle;
 $("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent=m.status;
 $(".image-settings").style.display=next==="images"?"flex":"none";$("#videoOptions").classList.toggle("show",next==="video");
 $$("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode===next));
 if(next==="images"){ $("#composerModel").value="FLUX Dev"; $("#composerSize").value="1024 × 1024"; $("#composerQuality").value="Standard" }
 showEmpty();syncInput()
}
$$("[data-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
$("#composerInput").addEventListener("input",syncInput);
$("#composerInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#composerSend").click()}});
$("#composerSend").addEventListener("click",async()=>{
 const value=$("#composerInput").value.trim();
 if(!value){toast(mode==="chat"?"Напиши сообщение":mode==="video"?"Опиши видео":"Опиши, что создать или изменить");return}
 if(mode==="images"){await generateImage(value);return}
 if(mode==="chat"){addChatMessage(value,true);$("#composerInput").value="";syncInput();addLocalAssistant();return}
 showLoading();$("#composerStatus").textContent="LTX · Request prepared";
 setTimeout(()=>{toast("Видео-задача подготовлена. LTX endpoint подключим следующим шагом.");showEmpty();$("#composerStatus").textContent=modes.video.status},500)
});
$("#composerAttach").onclick=()=>$("#referenceInput").click();
$("#referenceInput").onchange=e=>{
 const file=e.target.files?.[0];if(!file)return;
 const reader=new FileReader();
 reader.onload=()=>{
  referenceImage=String(reader.result||"");setMode("images");
  const c=$("#canvas");c.innerHTML='<div class="source-layout"><div class="source-card media-card"><img src="'+referenceImage+'" alt="Source image"></div><div class="source-info"><span class="mini-badge">SOURCE IMAGE</span><h3>Изображение загружено</h3><p>Опиши внизу, что нужно изменить. Miya передаст исходник в FLUX.</p><button class="primary-btn" id="sourceContinue">Продолжить →</button></div></div>';
  $("#composerStatus").textContent="Image ready · describe your edit";toast("Изображение добавлено");
  const sc=$("#sourceContinue");if(sc)sc.onclick=()=>$("#composerInput").focus();
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
 else if(tool==="history")toast("История будет отображаться здесь после генераций");
 else toast("Библиотека Miya готовится");
});
setMode("chat");