const ideas=[
  "Кинематографичный портрет в мягком вечернем свете",
  "Футуристический город после дождя, неон и отражения",
  "Премиальная предметная фотография на чистом фоне",
  "Милый чиби-персонаж в детализированном 3D стиле",
  "Путешественник на вершине горы на рассвете",
  "Роскошный интерьер современного дома",
  "Фэнтезийный лес с туманом и золотым светом",
  "Редакционная fashion-съёмка высокого класса",
  "Миниатюрный мир внутри стеклянного шара",
  "Кинопостер для фантастического фильма"
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
  [...ideas].sort(()=>Math.random()-.5).slice(0,5).forEach((idea)=>{
    const b=document.createElement("button");
    b.className="idea";
    b.textContent=idea;
    b.onclick=()=>$("#prompt").value=idea;
    box.appendChild(b);
  });
}

function setMode(next){
  mode=next;
  const data=modes[next];
  $("#modeTitle").textContent=data.title;
  $("#modeSubtitle").textContent=data.subtitle;
  $("#emptyText").textContent=data.empty;
  $$(".top-tab,.tool,.mobile-nav button").forEach(el=>el.classList.toggle("active",el.dataset.mode===next));
}

$$("[data-mode]").forEach(el=>el.addEventListener("click",()=>el.disabled||setMode(el.dataset.mode)));
$("#randomIdea").onclick=()=>renderIdeas();
$("#clearPrompt").onclick=()=>$("#prompt").value="";
$("#clearCanvas").onclick=()=>{
  $("#canvas").innerHTML='<div class="empty"><div class="empty-icon">✦</div><strong>Твой будущий результат</strong><span id="emptyText">'+modes[mode].empty+"</span></div>";
};
$$("[data-ratio]").forEach(btn=>btn.addEventListener("click",()=>{
  $$("[data-ratio]").forEach(x=>x.classList.remove("selected"));
  btn.classList.add("selected");
}));
$("#voice").onclick=()=>alert("Голосовой ввод подключим позже.");
$("#create").onclick=()=>alert("Модели пока не подключены. Сначала собираем чистую студию, затем добавим нужные модели.");

renderIdeas();
setMode("generator");
