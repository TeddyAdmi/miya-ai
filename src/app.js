const modes={
 generator:{title:"Генератор",subtitle:"Создай изображение по описанию",hint:"TEXT → IMAGE",placeholder:"Опиши изображение, которое хочешь создать...",send:"Создать",status:"FLUX Dev · Free image generation"},
 editor:{title:"Miya Editor",subtitle:"Редактируй изображение с помощью AI",hint:"IMAGE → IMAGE",placeholder:"Что изменить в изображении?",send:"Применить",status:"FLUX Kontext Dev · Image editing"},
 video:{title:"Видео",subtitle:"Создавай видео из текста или изображения",hint:"IMAGE / TEXT → VIDEO",placeholder:"Опиши видео или движение...",send:"Создать видео",status:"LTX · Video generation"},
 chat:{title:"AI Chat",subtitle:"Общайся с AI-моделью",hint:"AI CHAT",placeholder:"Напиши сообщение...",send:"Отправить",status:"AI Chat"}
};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let mode="generator";
let referenceImage=null;

function toast(message){
 let t=$("#toast");
 if(!t){t=document.createElement("div");t.id="toast";Object.assign(t.style,{position:"fixed",left:"50%",bottom:"180px",transform:"translateX(-50%)",zIndex:"100",padding:"10px 14px",borderRadius:"10px",background:"#182033",color:"#fff",fontSize:"11px",boxShadow:"0 10px 30px #0003"});document.body.appendChild(t)}
 t.textContent=message;t.style.display="block";clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.style.display="none",2600);
}

function syncInput(){
 const input=$("#composerInput");if(!input)return;
 input.style.height="auto";input.style.height=Math.min(130,Math.max(38,input.scrollHeight))+"px";
}

function showEmpty(){
 const canvas=$("#canvas");
 if(mode==="chat"){
  canvas.innerHTML='<div class="chat-stream"><div class="empty-state"><div class="empty-logo">M</div><h2>AI Chat</h2><p>Задай вопрос или попроси помочь с идеей.</p></div></div>';
 }else{
  canvas.innerHTML='<div class="empty-state"><div class="empty-logo">✦</div><h2>Что создадим?</h2><p>Опиши идею в поле ниже — результат появится здесь.</p></div>';
 }
}

function showLoading(){
 $("#canvas").innerHTML='<div class="empty-state"><div class="empty-logo">✦</div><h2>Создаём изображение…</h2><p>Бесплатный FLUX Dev обрабатывает твой промпт.</p></div>';
}

function showImage(imageUrl){
 const canvas=$("#canvas");
 canvas.innerHTML="";
 const img=document.createElement("img");
 img.className="result-image";
 img.alt="Miya AI generated image";
 img.src=imageUrl;
 img.onload=()=>$("#composerStatus").textContent="FLUX Dev · Image ready";
 img.onerror=()=>toast("Не удалось загрузить изображение");
 canvas.appendChild(img);

 const gallery=$("#resultGallery");
 const thumb=document.createElement("img");
 thumb.src=imageUrl;
 thumb.alt="";
 thumb.title="Открыть результат";
 thumb.onclick=()=>showImage(imageUrl);
 gallery.prepend(thumb);
}

async function generateImage(prompt){
 showLoading();
 $("#composerSend").disabled=true;
 $("#composerStatus").textContent="FLUX Dev · Generating…";

 try{
  const response=await fetch("/api/generate",{
   method:"POST",
   headers:{"Content-Type":"application/json","Accept":"application/json"},
   body:JSON.stringify({
    mode:"image",
    provider:"legacy-flux",
    prompt,
    model:"Flux Dev",
    quality:$("#composerQuality")?.textContent?.trim()||"Standard",
    size:$("#composerSize")?.textContent?.trim()||"1024",
    ratio:$("#composerRatio")?.textContent?.trim()||"1:1",
    outputFormat:"png",
    options: referenceImage ? {imageUrl:referenceImage} : {}
   })
  });

  const data=await response.json().catch(()=>({}));
  if(!response.ok || !data.imageUrl){
   throw new Error(data.message || data.error || "Не удалось получить изображение");
  }

  showImage(data.imageUrl);
  $("#composerInput").value="";
  syncInput();
 }catch(error){
  showEmpty();
  $("#composerStatus").textContent="FLUX Dev · Free image generation";
  toast(error.message||"Ошибка генерации");
 }finally{
  $("#composerSend").disabled=false;
 }
}

function setMode(next){
 mode=next;const m=modes[next];
 $("#workspaceHint").textContent=m.hint;$("#modeTitle").textContent=m.title;$("#modeSubtitle").textContent=m.subtitle;
 $("#composerInput").placeholder=m.placeholder;$("#composerSendText").textContent=m.send;$("#composerStatus").textContent=m.status;
 $("#composerOptions").style.display=next==="chat"?"none":"flex";
 $("#videoOptions").classList.toggle("show",next==="video");
 $$(".top-tab,[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode===next));
 showEmpty();syncInput();
}

$$("[data-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
$("#composerInput").addEventListener("input",syncInput);
$("#composerInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#composerSend").click()}});

$("#composerSend").addEventListener("click",async()=>{
 const value=$("#composerInput").value.trim();
 if(!value){toast(mode==="chat"?"Напиши сообщение":"Сначала опиши, что создать");return}

 if(mode==="generator"){
  await generateImage(value);
  return;
 }

 if(mode==="chat"){
  const stream=$("#canvas .chat-stream")||($("#canvas").innerHTML='<div class="chat-stream"></div>',$("#canvas .chat-stream"));
  const row=document.createElement("div");row.className="chat-row user";row.innerHTML='<div class="chat-avatar">U</div><div class="chat-bubble"></div>';row.querySelector(".chat-bubble").textContent=value;stream.appendChild(row);stream.scrollTop=stream.scrollHeight;$("#composerInput").value="";syncInput();return;
 }

 toast(modes[mode].send+" — подключим следующим этапом");
});

$("#composerAttach").onclick=()=>$("#referenceInput").click();
$("#referenceInput").onchange=e=>{
 const file=e.target.files?.[0];
 if(!file)return;
 const reader=new FileReader();
 reader.onload=()=>{referenceImage=String(reader.result||"");toast("Изображение добавлено")};
 reader.readAsDataURL(file);
};

$("#composerMic").onclick=()=>toast("Голосовой ввод");
$("#clearCanvas").onclick=()=>{$("#resultGallery").innerHTML="";showEmpty();};
$("#improve").onclick=()=>{const i=$("#composerInput");if(i.value.trim())i.value=i.value.trim()+", cinematic, highly detailed, professional quality";else toast("Сначала введи промпт");syncInput()};
$("#themeToggle").onclick=()=>{document.body.classList.toggle("dark");$("#themeToggle").textContent=document.body.classList.contains("dark")?"☾":"☼"};
setMode("generator");
