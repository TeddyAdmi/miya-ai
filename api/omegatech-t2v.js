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
    const upstreamRatio={"16:9":"landscape","9:16":"portrait","1:1":"square"}[ratio];

    // Keep the user's scene first and make every request unique so the
    // upstream T2V service cannot fall back to a previous/default storyboard.
    const generationId=crypto.randomUUID();
    const finalPrompt=[
      userPrompt,
      "CREATE A COMPLETELY NEW VIDEO FOR THIS REQUEST.",
      "The user's scene is the only source of truth.",
      "Do not reuse, copy or substitute any previous/default/demo scene.",
      "Do not add soldiers, military scenes, people, animals, vehicles or objects unless explicitly named by the user.",
      "Show the exact named subject and exact requested action continuously from beginning to end.",
      "For 16:9: use a WIDE HORIZONTAL LANDSCAPE FRAME, not portrait or vertical composition.",
      "Photorealistic natural motion, coherent action, stable subject identity.",
      "No text, subtitles, logos or unrelated events.",
      "Unique generation: "+generationId
    ].join(" ");

    let upstream;
    try {
      upstream=await fetch("https://omegatech-api.dixonomega.tech/api/ai/Txt2video",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"generate",
        prompt:finalPrompt,
        ratio:upstreamRatio,
        aspectRatio:ratio,
        width:ratio==="16:9"?1280:ratio==="9:16"?720:1024,
        height:ratio==="16:9"?720:ratio==="9:16"?1280:1024,
        sound:true
      });
    } catch (primaryError) {
      // Redundant official gateway fallback.
      upstream=await fetch("https://api.omegatech.app/api/ai/Txt2video",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:"generate",
          prompt:finalPrompt,
          ratio:upstreamRatio,
          aspectRatio:ratio,
          width:ratio==="16:9"?1280:ratio==="9:16"?720:1024,
          height:ratio==="16:9"?720:ratio==="9:16"?1280:1024,
          sound:true
        })
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