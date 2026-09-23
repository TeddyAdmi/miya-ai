const modes={
 generator:{title:"Генератор",subtitle:"Создай изображение по описанию",hint:"TEXT → IMAGE",placeholder:"Опиши изображение, которое хочешь создать...",send:"Создать",status:"FLUX Dev · Image generation"},
 editor:{title:"Miya Editor",subtitle:"Редактируй изображение с помощью AI",hint:"IMAGE → IMAGE",placeholder:"Что изменить в изображении?",send:"Применить",status:"FLUX Kontext Dev · Image editing"},
 video:{title:"Видео",subtitle:"Создавай видео из текста или изображения",hint:"IMAGE / TEXT → VIDEO",placeholder:"Опиши видео или движение...",send:"Создать видео",status:"LTX · Video generation"},
 chat:{title:"AI Chat",subtitle:"Общайся с AI-моделью",hint:"AI CHAT",placeholder:"Напиши сообщение...",send:"Отправить",status:"AI Chat"}
};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let mode="generator";

function toast(message){
 let t=$("#toast");
 if(!t){t=document.createElement("div");t.id="toast";Object.assign(t.style,{position:"fixed",left:"50%",bottom:"180px",transform:"translateX(-50%)",zIndex:"100",padding:"10px 14px",borderRadius:"10px",background:"#182033",color:"#fff",fontSize:"11px",boxShadow:"0 10px 30px #0003"});document.body.appendChild(t)}
 t.textContent=message;t.style.display="block";clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.style.display="none",2200);
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
$("#composerSend").addEventListener("click",()=>{
 const value=$("#composerInput").value.trim();
 if(!value){toast(mode==="chat"?"Напиши сообщение":"Сначала опиши, что создать");return}
 if(mode==="chat"){
  const stream=$("#canvas .chat-stream")||($("#canvas").innerHTML='<div class="chat-stream"></div>',$("#canvas .chat-stream"));
  const row=document.createElement("div");row.className="chat-row user";row.innerHTML='<div class="chat-avatar">U</div><div class="chat-bubble"></div>';row.querySelector(".chat-bubble").textContent=value;stream.appendChild(row);stream.scrollTop=stream.scrollHeight;$("#composerInput").value="";syncInput();return;
 }
 toast(modes[mode].send+" — подключение модели будет выполнено следующим этапом");
});
$("#composerAttach").onclick=()=>$("#referenceInput").click();
$("#referenceInput").onchange=e=>{if(e.target.files?.[0])toast("Изображение добавлено");};
$("#composerMic").onclick=()=>toast("Голосовой ввод");
$("#clearCanvas").onclick=showEmpty;
$("#improve").onclick=()=>{const i=$("#composerInput");if(i.value.trim())i.value=i.value.trim()+", cinematic, highly detailed, professional quality";else toast("Сначала введи промпт");syncInput()};
$("#themeToggle").onclick=()=>{document.body.classList.toggle("dark");$("#themeToggle").textContent=document.body.classList.contains("dark")?"☾":"☼"};
setMode("generator");