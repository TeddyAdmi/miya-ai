const ideas=["Кинематографичный горный пейзаж на рассвете, туман и золотой свет","Роскошная альпийская долина, озеро как зеркало, ultra realistic","Футуристический город после дождя, неон и отражения","Премиальная fashion-съёмка в мягком вечернем свете","Милый 3D-персонаж в детализированном сказочном мире","Одинокий дом в горах, драматичные облака, кинематографичный кадр","Фэнтезийный лес с туманом и солнечными лучами","Минималистичный интерьер современного дома с панорамными окнами","Кинопостер для фантастического фильма","Путешественник на вершине горы, epic wide shot"];
const modes={generator:{title:"Генератор изображений",subtitle:"Создай изображение по описанию",hint:"Text to Image",empty:"Напиши идею справа — здесь появится изображение."},editor:{title:"Фото-редактор",subtitle:"Редактирование и reference workflow",hint:"Image to Image",empty:"Загрузи изображение — здесь будет рабочее полотно."},video:{title:"Видео-студия",subtitle:"Image → Video / Text → Video",hint:"Image to Video",empty:"Выбери исходное изображение — здесь появится видео."}};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];let mode="generator",zoom=100,resultCount=1;
function renderIdeas(){const box=$("#ideas");box.innerHTML="";[...ideas].sort(()=>Math.random()-.5).slice(0,5).forEach(idea=>{const b=document.createElement("button");b.className="idea";b.textContent=idea;b.onclick=()=>{$("#prompt").value=idea;updateCount()};box.appendChild(b)})}
function updateCount(){$("#count").textContent=$("#prompt").value.length+" / 4000"}
function setMode(next){mode=next;const d=modes[next];$("#modeTitle").textContent=d.title;$("#modeSubtitle").textContent=d.subtitle;$("#canvasHint").textContent=d.hint;$$("[data-mode]").forEach(el=>el.classList.toggle("active",el.dataset.mode===next))}
function showToast(message){let t=$("#toast");if(!t){t=document.createElement("div");t.id="toast";document.body.appendChild(t)}t.textContent=message;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),2400)}
function resetCanvas(){$("#canvas").innerHTML='<div class="canvas-empty"><div class="empty-symbol">✦</div><b>Твой будущий результат</b><span>'+modes[mode].empty+"</span></div>"}
function selectGroup(selector,el){$$(selector).forEach(x=>x.classList.remove("selected"));el.classList.add("selected")}
$$("[data-mode]").forEach(el=>el.addEventListener("click",()=>!el.disabled&&setMode(el.dataset.mode)));
$("#randomIdea").onclick=renderIdeas;$("#prompt").addEventListener("input",updateCount);$("#clearPrompt").onclick=()=>{$("#prompt").value="";updateCount()};$("#clearCanvas").onclick=resetCanvas;
$$("[data-ratio]").forEach(b=>b.onclick=()=>selectGroup("[data-ratio]",b));
$$("[data-quality]").forEach(b=>b.onclick=()=>{selectGroup("[data-quality]",b);showToast("Качество выбрано: "+b.dataset.quality)});
$$(".style-chip").forEach(b=>b.onclick=()=>selectGroup(".style-chip",b));
$$(".collapse-head").forEach(b=>b.onclick=()=>{$("#"+b.dataset.target).classList.toggle("collapsed");b.querySelector(":scope > span:last-child").textContent=$("#"+b.dataset.target).classList.contains("collapsed")?"⌄":"⌃"});
$("#countMinus").onclick=()=>{resultCount=Math.max(1,resultCount-1);$("#resultCount").textContent=resultCount};
$("#countPlus").onclick=()=>{resultCount=Math.min(4,resultCount+1);$("#resultCount").textContent=resultCount};
function setZoom(next){zoom=Math.max(50,Math.min(150,next));$("#zoomValue").textContent=zoom+"%";const c=$("#canvas");c.style.transformOrigin="center top";c.style.transform="scale("+zoom/100+")";c.style.marginBottom=zoom<100?"-"+(100-zoom)*2.7+"px":zoom>100?(zoom-100)*2.7+"px":"0"}
$("#zoomOut").onclick=()=>setZoom(zoom-10);$("#zoomIn").onclick=()=>setZoom(zoom+10);
$("#referenceAdd").onclick=()=>$("#referenceInput").click();
$("#referenceInput").addEventListener("change",e=>{const file=e.target.files?.[0];if(!file)return;const url=URL.createObjectURL(file);$("#referenceAdd").innerHTML='<span class="reference-thumb"><img src="'+url+'" alt=""></span><div><b>'+file.name.replace(/</g,"&lt;")+'</b><small>Reference добавлен</small></div>';showToast("Reference добавлен в проект")});
["dragenter","dragover"].forEach(ev=>$("#referenceAdd").addEventListener(ev,e=>{e.preventDefault();$("#referenceAdd").classList.add("dragover")}));
["dragleave","drop"].forEach(ev=>$("#referenceAdd").addEventListener(ev,e=>{e.preventDefault();$("#referenceAdd").classList.remove("dragover")}));
$("#referenceAdd").addEventListener("drop",e=>{const file=e.dataTransfer.files?.[0];if(!file||!file.type.startsWith("image/"))return;$("#referenceInput").files=e.dataTransfer.files;$("#referenceInput").dispatchEvent(new Event("change"))});
$("#voice").onclick=()=>showToast("Голосовой ввод подключим вместе с AI-функциями.");$("#improve").onclick=()=>showToast("Улучшение промпта подключим вместе с AI-моделями.");
$("#create").onclick=()=>showToast("Настройки готовы. Следующий этап — подключение модели генерации.");
$("#clearHistory").onclick=()=>showToast("История пока пуста.");
$(".new-project").onclick=()=>{$("#prompt").value="";$("#negativePrompt").value="";resultCount=1;$("#resultCount").textContent="1";resetCanvas();updateCount();showToast("Создано новое рабочее пространство")};
renderIdeas();setMode("generator");updateCount();