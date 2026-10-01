export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({success:false,error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const userPrompt=String(body.prompt||"").trim().slice(0,1200);
    if(!userPrompt){
      return res.status(400).json({success:false,error:"Prompt is empty"});
    }

    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";
    const requestedDuration=Math.max(1,Math.min(10,Number(body.duration)||5));

    const dimensions={
      "16:9":{width:1920,height:1080,ratio:"landscape"},
      "9:16":{width:1080,height:1920,ratio:"portrait"},
      "1:1":{width:1080,height:1080,ratio:"square"}
    }[ratio];

    const lower=userPrompt.toLowerCase();
    const animalMatch=lower.match(/\b(кабан|свинья|собака|кот|кошка|лошадь|волк|медведь|лиса|олень|орел|птица|животное|dog|cat|horse|boar|pig|wolf|bear|fox|deer|eagle|bird|animal)\b/i);
    const peopleMatch=lower.match(/\b(человек|люди|мужчина|женщина|девушка|парень|ребенок|дети|солдат|солдаты|военные|man|woman|girl|boy|person|people|soldier|soldiers)\b/i);

    const guard=animalMatch && !peopleMatch
      ? "Exactly one requested animal only. No humans, soldiers, military, dogs, cats, other animals or extra subjects unless explicitly named."
      : "Only the subjects explicitly named by the user. No unrequested people, animals, vehicles, weapons, props or events.";

    const finalPrompt=[
      "STRICT VIDEO PROMPT. FOLLOW THE USER DESCRIPTION EXACTLY.",
      "Do not invent or replace subjects.",
      "Perform the requested action exactly as written.",
      "If one subject is named, show exactly one subject.",
      guard,
      "No dialogue, music, text, subtitles, logos or cinematic story additions unless requested.",
      "Realistic anatomy, physics and continuous motion.",
      "USER SCENE: "+userPrompt
    ].join(" ");

    const upstream=await fetch("https://api.omegatech.app/api/ai/Txt2video",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"generate",
        prompt:finalPrompt,
        ratio:dimensions.ratio,
        aspectRatio:ratio,
        width:dimensions.width,
        height:dimensions.height,
        resolution:"1080p",
        quality:"high",
        duration:requestedDuration,
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

    const videoUrl=String(data?.data?.videoUrl||data?.videoUrl||"").trim();

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