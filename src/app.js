const ideas=[
  "Кинематографичный горный пейзаж на рассвете, туман и золотой свет",
  "Роскошная альпийская долина, озеро как зеркало, ultra realistic",
  "Футуристический город после дождя, неон и отражения",
  "Премиальная fashion-съёмка в мягком вечернем свете",
  "Милый 3D-персонаж в детализированном сказочном мире",
  "Одинокий дом в горах, драматичные облака, кинематографичный кадр",
  "Фэнтезийный лес с туманом и солнечными лучами",
  "Минималистичный интерьер современного дома с панорамными окнами",
  "Кинопостер для фантастического фильма",
  "Путешественник на вершине горы, epic wide shot"
];

const modes={
  generator:{title:"Генератор изображений",subtitle:"Создай изображение по описанию",empty:"Напиши идею справа — здесь появится изображение."},
  editor:{title:"Фото-редактор",subtitle:"Редактирование и reference workflow",empty:"Загрузи изображение — здесь будет рабочее полотно."},
  video:{title:"Видео-студия",subtitle:"Image → Video / Text → Video",empty:"Выбери исходное изображение — здесь появится видео."}
};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
let mode="generator";

function renderIdeas(){
  const box=$("#ideas");
  box.innerHTML="";
  [...ideas].sort(()=>Math.random()-.5).slice(0,5).forEach(idea=>{
    const b=document.createElement("button");
    b.className="idea";
    b.textContent=idea;
    b.onclick=()=>{ $("#prompt").value=idea; updateCount(); };
    box.appendChild(b);
  });
}

function updateCount(){
  $("#count").textContent=$("#prompt").value.length+" / 4000";
}

function setMode(next){
  mode=next;
  const data=modes[next];
  $("#modeTitle").textContent=data.title;
  $("#modeSubtitle").textContent=data.subtitle;
  $$("[data-mode]").forEach(el=>el.classList.toggle("active",el.dataset.mode===next));
}

$$("[data-mode]").forEach(el=>el.addEventListener("click",()=>!el.disabled&&setMode(el.dataset.mode)));
$("#randomIdea").onclick=renderIdeas;
$("#prompt").addEventListener("input",updateCount);
$("#clearPrompt").onclick=()=>{ $("#prompt").value=""; updateCount(); };
$("#clearCanvas").onclick=()=>{
  $("#canvas").innerHTML='<div class="canvas-empty"><div class="empty-symbol">✦</div><b>Твой будущий результат</b><span>'+modes[mode].empty+"</span></div>";
};
$$("[data-ratio]").forEach(btn=>btn.addEventListener("click",()=>{
  $$("[data-ratio]").forEach(x=>x.classList.remove("selected"));
  btn.classList.add("selected");
}));
$("#voice").onclick=()=>alert("Голосовой ввод подключим позже.");
$("#improve").onclick=()=>alert("Улучшение промпта подключим вместе с AI-моделями.");
$("#create").onclick=()=>alert("Сейчас это чистая студия. Модели подключим следующим этапом.");

renderIdeas();
setMode("generator");
updateCount();