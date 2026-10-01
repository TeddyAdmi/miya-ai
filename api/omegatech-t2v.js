export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({success:false,error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const userPrompt=String(body.prompt||"").trim().slice(0,1500);\n    const lower=userPrompt.toLowerCase();\n\n    const animalMap=[\n      [/\\bкабан(?:а|у|ом|е|ы|ов|ам|ами|ах)?\\b/i,"one wild boar"],\n      [/\\bсвин(?:ья|ью|ьи|ей|ьи|ьи)?\\b/i,"one pig"],\n      [/\\bсобак(?:а|у|ой|и|е|у|ами)?\\b/i,"one dog"],\n      [/\\bкот(?:а|у|ом|е|ы|ов|ами)?\\b/i,"one cat"],\n      [/\\bлошад(?:ь|и|ью|ей|ями)?\\b/i,"one horse"],\n      [/\\bволк(?:а|у|ом|е|и|ов|ами)?\\b/i,"one wolf"],\n      [/\\bмедвед(?:ь|я|ю|ем|е|и|ей|ями)?\\b/i,"one bear"],\n      [/\\bлиса(?:у|ой|ы|е|ми)?\\b/i,"one fox"],\n      [/\\bолень(?:я|ю|ем|е|и|ей|ями)?\\b/i,"one deer"],\n      [/\\bор[её]л(?:а|у|ом|е|ы|ов|ами)?\\b/i,"one eagle"]\n    ];\n    let explicitSubject=null;\n    for(const [re,en] of animalMap){ if(re.test(lower)){ explicitSubject=en; break; } }\n\n    const personWords=/\\b(человек|люди|мужчина|женщина|девушка|парень|солдат|солдаты|военные|ребенок|дети|man|woman|person|people|girl|boy|soldier|soldiers)\\b/i;\n    const vehicleWords=/\\b(машин|автомобил|авто|vehicle|car|truck|мотоцикл|самолет|вертолет)\\b/i;\n    const negative=explicitSubject && !personWords.test(lower)\n      ? "ABSOLUTELY NO humans, women, men, girls, boys, soldiers, military, dogs, cats or other animals. NO extra subjects. NO bench, house, car or other object unless explicitly requested."\n      : "ABSOLUTELY NO unrequested characters, animals, vehicles, weapons, props, dialogue, text or events.";
    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";

    // This is the OmegaTech endpoint that was directly verified working:
    // POST /api/ai/Txt2video -> HTTP 200 -> data.videoUrl (ready MP4).
    // Do not route this through Argen, Wan2 or Sora.
    const upstream=await fetch("https://api.omegatech.app/api/ai/Txt2video",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"generate",
        prompt:userPrompt,
        ratio,
        sound:false
      })
    });

    const raw=await upstream.text();

    if(!upstream.ok){
      return res.status(502).json({
        success:false,
        error:"OmegaTech Txt2video upstream error",
        upstreamStatus:upstream.status,
        details:raw.slice(0,3000)
      });
    }

    let data;
    try{
      data=JSON.parse(raw);
    }catch{
      return res.status(502).json({
        success:false,
        error:"OmegaTech Txt2video returned invalid JSON",
        details:raw.slice(0,3000)
      });
    }

    const videoUrl=String(data?.data?.videoUrl||"").trim();

    if(!videoUrl){
      return res.status(502).json({
        success:false,
        error:"OmegaTech Txt2video returned no video URL",
        details:JSON.stringify(data).slice(0,3000)
      });
    }

    return res.status(200).json({
      success:true,
      data:{videoUrl},
      source:"Omegatech Txt2video"
    });
  }catch(error){
    return res.status(500).json({
      success:false,
      error:"OmegaTech Txt2video function failed",
      details:String(error?.message||error||"Unknown error")
    });
  }
}