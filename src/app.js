const modes={
 chat:{title:"AI Chat",hint:"AI CHAT",placeholder:"Напиши сообщение...",send:"Отправить",status:"AI Chat"},
 images:{title:"Картинки",hint:"TEXT + IMAGE → IMAGE",placeholder:"Опиши картинку или что изменить в загруженном изображении...",send:"Создать",status:"FLUX Dev · Image generation & editing"},
 video:{title:"Видео",hint:"IMAGE / TEXT → VIDEO",placeholder:"Опиши видео или движение...",send:"Создать видео",status:"LTX · Video generation"}
};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let mode="chat",referenceImage=null;

function toast(message){let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";t.className="toast";document.body.appendChild(t)}t.textContent=message;t.style.display="block";clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.style.display="none",2600)}
function syncInput(){const i=$("#composerInput");if(!i)return;i.style.height="auto";i.style.height=Math.min(120,Math.max(38,i.scrollHeight))+"px"}
function showEmpty(){
 const c=$("#canvas");$("#composerContext").textContent=modes[mode].status;
 if(mode==="chat")c.innerHTML='<div class="chat-stream"><div class="chat-welcome"><div class="empty-logo">M</div><h2>Чем могу помочь?</h2><p>Спроси что угодно или начни новый разговор.</p></div></div>';
 else if(mode==="images")c.innerHTML='<div class="empty-state"><div class="empty-logo">✦</div><h2>Создай или измени изображение</h2><p>Напиши промпт или загрузи изображение и опиши, что изменить.</p></div>';
 else c.innerHTML='<div class="empty-state"><div class="empty-logo">▶</div><h2>Создадим видео</h2><p>Опиши сцену или движение в поле ниже.</p></div>';
}
function showLoading(){if(mode==="images")$("#canvas").innerHTML='<div class="empty-state"><div class="empty-logo">✦</div><h2>Создаём изображение…</h2><p>FLUX обрабатывает твой запрос.</p></div>'}
function showImage(url){
 const c=$("#canvas");let grid=c.querySelector(".result-grid");
 if(!grid){c.innerHTML="";grid=document.createElement("div");grid.className="result-grid";c.appendChild(grid)}
 const card=document.createElement("div");card.className="media-card";const img=document.createElement("img");img.src=url;img.alt="Miya Studio generated image";card.appendChild(img);grid.prepend(card);
 $("#composerStatus").textContent="FLUX Dev · Image ready";
}
async function generateImage(prompt){
 showLoading();$("#composerSend").disabled=true;$("#composerStatus").textContent="FLUX Dev · Generating…";
 try{
  const size=$("#composerSize").value.trim();
  const response=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({
   mode:"image",provider:"legacy-flux",prompt,model:$("#composerModel").value.trim(),
   quality:$("#composerQuality").value.trim(),size,ratio:"1:1",outputFormat:"png",
   options:referenceImage?{imageUrl:referenceImage}:{}
  })});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.imageUrl)throw new Error(data.message||data.error||"Не удалось получить изображение");
  showImage(data.imageUrl);$("#composerInput").value="";syncInput();
 }catch(e){showEmpty();toast(e.message||"Ошибка генерации")}finally{$("#composerSend").disabled=false}
}
function addChatMessage(text,isUser){
 let stream=$("#canvas .chat-stream");if(!stream){showEmpty();stream=$("#canvas .chat-stream")}
 const welcome=stream.querySelector(".chat-welcome");if(welcome)welcome.remove();
 const row=document.createElement("div");row.className="chat-row "+(isUser?"user":"assistant");
 const av=document.createElement("div");av.className="chat-avatar";av.textContent=isUser?"U":"M";
 const bubble=document.createElement("div");bubble.className="chat-bubble";bubble.textContent=text;row.append(av,bubble);stream.appendChild(row);stream.scrollTop=stream.scrollHeight
}
function setMode(next){
 mode=next;const m=modes[next];
 $("#composerContext").textContent=m.status;$("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent=m.status;
 $(".image-settings").style.display=next==="images"?"flex":"none";
 $("#videoOptions").classList.toggle("show",next==="video");
 $$(".side-btn,[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode===next));
 if(next==="images"){$("#composerModel").value="FLUX Dev";$("#composerSize").value="1024 × 1024";$("#composerQuality").value="Standard"}
 showEmpty();syncInput()
}
$$("[data-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
$("#composerInput").addEventListener("input",syncInput);
$("#composerInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#composerSend").click()}});
$("#composerSend").addEventListener("click",async()=>{
 const value=$("#composerInput").value.trim();if(!value){toast(mode==="chat"?"Напиши сообщение":mode==="video"?"Опиши видео":"Опиши, что создать или изменить");return}
 if(mode==="images"){await generateImage(value);return}
 if(mode==="chat"){addChatMessage(value,true);$("#composerInput").value="";syncInput();setTimeout(()=>addChatMessage("Чат подключён к интерфейсу Miya Studio. Следующим этапом подключим модель и историю диалога.",false),350);return}
 toast("Видео готово — подключаем LTX endpoint.")
});
$("#composerAttach").onclick=()=>$("#referenceInput").click();
$("#referenceInput").onchange=e=>{
 const file=e.target.files?.[0];if(!file)return;
 const reader=new FileReader();
 reader.onload=()=>{
  referenceImage=String(reader.result||"");
  if(mode!=="images")setMode("images");
  const c=$("#canvas");c.innerHTML="";
  const card=document.createElement("div");card.className="media-card source-card";
  const img=document.createElement("img");img.src=referenceImage;img.alt="Source image";card.appendChild(img);c.appendChild(card);
  $("#composerStatus").textContent="Image ready · describe your edit";toast("Изображение добавлено");
 };
 reader.readAsDataURL(file)
};
$("#composerMic").onclick=()=>toast("Голосовой ввод");
$("#clearCanvas").onclick=showEmpty;
$("#improve").onclick=()=>{const i=$("#composerInput");if(i.value.trim())i.value=i.value.trim()+", cinematic, highly detailed, professional quality";else toast("Сначала введи промпт");syncInput()};
$("#themeToggle").onclick=()=>{document.body.classList.toggle("dark");$("#themeToggle").textContent=document.body.classList.contains("dark")?"☾":"☼"};
setMode("chat");