export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({success:false,error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const userPrompt=String(body.prompt||"").trim().slice(0,1200);
    if(!userPrompt) return res.status(400).json({success:false,error:"Prompt is empty"});

    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";
    const duration=Math.max(5,Math.min(10,Number(body.duration)||5));

    const lower=userPrompt.toLowerCase();
    const animalMatch=lower.match(/\b(кабан|свинья|собака|кот|кошка|лошадь|волк|медведь|лиса|олень|орел|птица|животное|dog|cat|horse|boar|pig|wolf|bear|fox|deer|eagle|bird|animal)\b/i);
    const peopleMatch=lower.match(/\b(человек|люди|мужчина|женщина|девушка|парень|ребенок|дети|солдат|солдаты|военные|man|woman|girl|boy|person|people|soldier|soldiers)\b/i);

    const negative=animalMatch&&!peopleMatch
      ?"humans, men, women, girls, boys, soldiers, military, dogs, cats, other animals, extra subjects, extra objects, weapons, vehicles, text, subtitles, logos, dialogue, music, scene changes"
      :"unrequested people, animals, vehicles, weapons, props, text, subtitles, logos, dialogue, music, scene changes";

    const orientation=ratio==="16:9"?"landscape 16:9 wide frame":
      ratio==="9:16"?"portrait 9:16 vertical frame":"square 1:1 frame";

    const finalPrompt=[
      "Photorealistic video.",
      "EXACTLY FOLLOW THIS USER SCENE. Do not reinterpret it.",
      "Main subject and action must be exactly what the user describes.",
      "Do not substitute the subject with a person or another object.",
      "Show the complete requested action from beginning to end.",
      "Keep the same subject and clothing/body appearance throughout the shot; no morphing, disappearing objects or teleportation.",
      orientation+".",
      "No extra subjects or events.",
      "USER SCENE: "+userPrompt
    ].join(" ");

    const negativePrompt=negative+
      ". Do not change the main subject. Do not replace the requested animal with a human. No morphing, disappearing clothing or object flicker.";

    // Wan 2.2 14B: documented 7-10s generation, negativePrompt and CFG.
    const upstream=await fetch("https://api.omegatech.app/api/ai/wan",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"generate",
        prompt:finalPrompt,
        negativePrompt,
        duration,
        seed:-1,
        steps:20,
        cfg:6,
        motion:5,
        language:"en"
      })
    });

    const raw=await upstream.text();
    if(!upstream.ok){
      return res.status(502).json({
        success:false,
        error:"OmegaTech Wan upstream error",
        upstreamStatus:upstream.status,
        details:raw.slice(0,3000)
      });
    }

    let data;
    try{ data=JSON.parse(raw); }
    catch{
      return res.status(502).json({
        success:false,
        error:"OmegaTech Wan returned invalid JSON",
        details:raw.slice(0,3000)
      });
    }

    let videoUrl=String(
      data?.data?.videoUrl||
      data?.data?.video_url||
      data?.videoUrl||
      data?.video_url||
      data?.data?.url||
      data?.url||
      ""
    ).trim();

    // Long Wan jobs can return a sessionId. Poll until the video is ready.
    const sessionId=String(
      data?.data?.sessionId||
      data?.data?.session_id||
      data?.sessionId||
      data?.session_id||
      ""
    ).trim();

    if(!videoUrl && sessionId){
      const deadline=Date.now()+240000;
      while(Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,5000));

        const statusResponse=await fetch("https://api.omegatech.app/api/ai/wan",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"result",sessionId})
        });
        const statusRaw=await statusResponse.text();
        if(!statusResponse.ok) continue;

        let statusData;
        try{ statusData=JSON.parse(statusRaw); }catch{ continue; }

        videoUrl=String(
          statusData?.data?.videoUrl||
          statusData?.data?.video_url||
          statusData?.data?.url||
          statusData?.videoUrl||
          statusData?.video_url||
          statusData?.url||
          ""
        ).trim();

        const state=String(
          statusData?.data?.status||
          statusData?.status||
          ""
        ).toLowerCase();

        if(videoUrl) break;
        if(["failed","error","cancelled","canceled"].includes(state)){
          return res.status(502).json({
            success:false,
            error:"OmegaTech Wan generation failed",
            details:JSON.stringify(statusData).slice(0,3000)
          });
        }
      }
    }

    if(!videoUrl){
      return res.status(504).json({
        success:false,
        error:"OmegaTech Wan did not return a video in time",
        details:JSON.stringify(data).slice(0,3000)
      });
    }

    return res.status(200).json({
      success:true,
      data:{videoUrl},
      source:"Omegatech Wan 2.2 14B"
    });
  }catch(error){
    return res.status(500).json({
      success:false,
      error:"OmegaTech Wan function failed",
      details:String(error?.message||error||"Unknown error")
    });
  }
}
