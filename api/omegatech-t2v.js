export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({success:false,error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const incoming=String(body.prompt||"").trim();
    const marker="USER VIDEO DESCRIPTION:";
    const markerIndex=incoming.lastIndexOf(marker);
    const userPrompt=(markerIndex>=0?incoming.slice(markerIndex+marker.length):incoming).trim().slice(0,1300);

    if(!userPrompt){
      return res.status(400).json({success:false,error:"Prompt is empty"});
    }

    // Txt2video officially documents only these three ratio values.
    // Do not translate them to "landscape/portrait/square" or send
    // undocumented width/height/aspectRatio fields.
    const ratio=["16:9","9:16","1:1"].includes(String(body.ratio))
      ? String(body.ratio)
      : "16:9";

    const sound=body.sound!==false;
    const generationId=crypto.randomUUID();

    // Keep the user's scene intact and keep ALL control instructions
    // inside the upstream 2000-character prompt limit.
    const finalPrompt=[
      "VIDEO GENERATION RULES:",
      "The USER SCENE is the only source of truth.",
      "Follow every named subject, number, object, location and action exactly.",
      "Preserve the action order and show each action clearly; never replace an action with a camera move or a static pose.",
      "Do not add people, animals, vehicles, props, weather, locations or events that are not named.",
      "Keep one continuous coherent scene with stable identities and realistic physics.",
      "The requested aspect ratio is mandatory. Do not rotate, crop or reinterpret the frame into another ratio.",
      "No text, subtitles or logos.",
      "USER SCENE:",
      userPrompt,
      "OUTPUT RATIO:",
      ratio,
      "GENERATION ID:",
      generationId
    ].join(" ").slice(0,1950);

    const payload={
      action:"generate",
      prompt:finalPrompt,
      ratio,
      sound
    };

    let upstream;
    let upstreamHost="";

    try{
      upstreamHost="https://omegatech-api.dixonomega.tech";
      upstream=await fetch(upstreamHost+"/api/ai/Txt2video?request_id="+encodeURIComponent(generationId),{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Cache-Control":"no-cache"
        },
        body:JSON.stringify(payload)
      });
    }catch(primaryError){
      upstreamHost="https://api.omegatech.app";
      upstream=await fetch(upstreamHost+"/api/ai/Txt2video?request_id="+encodeURIComponent(generationId),{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Cache-Control":"no-cache"
        },
        body:JSON.stringify(payload)
      });
    }

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
      source:"Omegatech Txt2video",
      ratio,
      requestId:generationId
    });
  }catch(error){
    return res.status(500).json({
      success:false,
      error:"OmegaTech Txt2video function failed",
      details:String(error?.message||error||"Unknown error")
    });
  }
}
