export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const requestedDuration=Math.max(1,Math.min(10,Number(body.duration)||5));
    const duration=requestedDuration;
    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";
    const userPrompt=String(body.prompt||"").trim();

    /*
     * Do not use Txt2video here.
     * OmegaTech's documented Txt2video endpoint has no duration parameter and
     * has produced portrait output even when ratio=16:9. Wan 2.2 exposes the
     * real duration control and accepts a negative prompt.
     */
    const prompt=[
      "Generate only the scene described by the user.",
      "Do not add characters, animals, vehicles, weapons, props or events that the user did not request.",
      "If one subject is named, generate exactly one.",
      "Follow the requested action in the requested order.",
      "Keep realistic physics and correct anatomy.",
      "No text, logos, subtitles or random cinematic additions.",
      "Aspect ratio: "+ratio+".",
      "USER:",
      userPrompt.slice(0,1500)
    ].join(" ");

    const lower=userPrompt.toLowerCase();
    const asksPeople=/\b(man|woman|person|people|human|soldier|soldiers|military|boy|girl|child|children|crowd|человек|люди|мужчина|женщина|солдат|солдаты|военные|ребенок|дети)\b/i.test(lower);
    const asksAnimals=/\b(dog|cat|horse|boar|pig|wolf|bear|fox|deer|eagle|bird|animal|собак|собака|кот|кошка|лошад|кабан|свин|волк|медвед|лиса|олень|орел|птиц|животн)\b/i.test(lower);
    const negativeParts=[
      "unrequested characters",
      "unrequested people",
      "unrequested animals",
      "unrequested vehicles",
      "unrequested weapons",
      "unrequested props",
      "unrequested actions",
      "extra subjects",
      "duplicate subjects",
      "previous scene content"
    ];
    if(!asksPeople) negativeParts.push("people, humans, soldiers, military, armed men, uniforms");
    if(!asksAnimals) negativeParts.push("animals");
    const negativePrompt=negativeParts.join(", ");

    const cleanPrompt=userPrompt.slice(0,1500);
    const cleanPrompt=userPrompt.slice(0,1500);
    const modelsResponse=await fetch("https://api.omegatech.app/api/ai/Argen",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"models"})
    });
    const modelsText=await modelsResponse.text();
    let modelsPayload=null;
    try{modelsPayload=JSON.parse(modelsText)}catch{}
    const videoModels=[];
    const collect=(v)=>{
      if(!v)return;
      if(Array.isArray(v)){v.forEach(collect);return;}
      if(typeof v!=="object")return;
      const id=v.modelId||v.model||v.id;
      const raw=JSON.stringify(v).toLowerCase();
      if(id && (raw.includes("video")||v.engine||v.videoType)) videoModels.push(v);
      Object.values(v).forEach(collect);
    };
    collect(modelsPayload);
    const selected=videoModels[0]||{};
    const argenBody={
      action:"video",
      prompt:cleanPrompt,
      negativePrompt,
      ratio,
      videoDuration:requestedDuration,
      videoResolution:"720p"
    };
    const modelId=selected.modelId||selected.model||selected.id;
    if(modelId) argenBody.modelId=String(modelId);
    if(selected.engine) argenBody.engine=String(selected.engine);
    if(selected.videoType) argenBody.videoType=String(selected.videoType);
    let response=await fetch("https://api.omegatech.app/api/ai/Argen",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(argenBody)
    });

    let text=await response.text();
    let payload=null;
    try{payload=JSON.parse(text)}catch{}

    if(duration>5 && response.ok && payload?.sessionId){
      let completed=false;
      for(let i=0;i<120;i++){
        await new Promise(r=>setTimeout(r,5000));
        const poll=await fetch("https://api.omegatech.app/api/ai/wan",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"result",sessionId:String(payload.sessionId)})
        });
        const pollText=await poll.text();
        let pollData=null;
        try{pollData=JSON.parse(pollText)}catch{}
        const videoUrl=
          pollData?.data?.videoUrl||
          pollData?.videoUrl||
          pollData?.result?.videoUrl||
          pollData?.data?.result?.videoUrl;
        if(videoUrl){
          text=JSON.stringify({success:true,statusCode:200,data:{videoUrl}});
          completed=true;
          break;
        }
        if(pollData?.success===false){
          text=pollText;
          break;
        }
      }
      if(!completed && !payload?.data?.videoUrl){
        text=JSON.stringify({success:false,error:"OmegaTech Wan video generation timed out"});
      }
    }

    if(!response.ok){
      return res.status(502).json({success:false,error:"OmegaTech Wan upstream error",upstreamStatus:response.status,details:text.slice(0,2000)});
    }
    res.status(200).setHeader("Content-Type","application/json").send(text);
  }catch(error){
    res.status(500).json({success:false,error:String(error?.message||error||"OmegaTech request failed")});
  }
}
