export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({success:false,error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const incoming=String(body.prompt||"").trim();

    // The frontend wraps the real user description after this marker.
    // Extract it before any length limit so the model cannot lose the actual scene.
    const marker="USER VIDEO DESCRIPTION:";
    const markerIndex=incoming.lastIndexOf(marker);
    const userPrompt=(markerIndex>=0
      ? incoming.slice(markerIndex+marker.length)
      : incoming
    ).trim().slice(0,1800);

    if(!userPrompt){
      return res.status(400).json({success:false,error:"Prompt is empty"});
    }

    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";
    const requestedDuration=Math.max(1,Math.min(10,Number(body.duration)||5));

    const finalPrompt=[
      userPrompt,
      "Single continuous photorealistic video scene.",
      "Show the main subject and action exactly as described.",
      "Do not invent a different subject or story.",
      "Natural continuous motion; keep the same subject throughout the clip.",
      "No text, subtitles, logos or dialogue."
    ].join(" ");

    const upstream=await fetch("https://api.omegatech.app/api/ai/Txt2video",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"generate",
        prompt:finalPrompt,
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