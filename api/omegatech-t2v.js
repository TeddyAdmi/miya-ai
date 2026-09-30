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

    // Primary: OmegaTech Argen / DroodStudio video.
    const argenBody={
      action:"video",
      prompt:cleanPrompt,
      negativePrompt,
      ratio,
      videoDuration:requestedDuration,
      videoResolution:"720p"
    };

    let response=await fetch("https://api.omegatech.app/api/ai/Argen",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(argenBody)
    });

    // If Argen is temporarily broken, switch to the separate Wan2 video model.
    if(!response.ok){
      response=await fetch("https://api.omegatech.app/api/ai/Wan2-create",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          prompt:cleanPrompt,
          duration:requestedDuration,
          ratio,
          resolution:"720p"
        })
      });
    }

    let text=await response.text();
    let payload=null;
    try{payload=JSON.parse(text)}catch{}

    if(!response.ok){
      return res.status(502).json({success:false,error:"OmegaTech video upstream error",upstreamStatus:response.status,details:text.slice(0,2000)});
    }
    res.status(200).setHeader("Content-Type","application/json").send(text);
  }catch(error){
    res.status(500).json({success:false,error:String(error?.message||error||"OmegaTech request failed")});
  }
}
