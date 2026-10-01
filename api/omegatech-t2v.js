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
    const userPrompt=(markerIndex>=0?incoming.slice(markerIndex+marker.length):incoming).trim().slice(0,1350);

    if(!userPrompt){
      return res.status(400).json({success:false,error:"Prompt is empty"});
    }

    const ratio=["16:9","9:16","1:1"].includes(String(body.ratio))
      ? String(body.ratio)
      : "16:9";

    // Omega's T2V backend has historically responded more reliably
    // to semantic ratio names than literal UI ratios.
    const upstreamRatio={
      "16:9":"landscape",
      "9:16":"portrait",
      "1:1":"square"
    }[ratio];

    const width={
      "16:9":1280,
      "9:16":720,
      "1:1":1024
    }[ratio];

    const height={
      "16:9":720,
      "9:16":1280,
      "1:1":1024
    }[ratio];

    const sound=body.sound!==false;
    const generationId=crypto.randomUUID();

    const ratioInstruction={
      "16:9":"MANDATORY OUTPUT: 16:9 WIDE HORIZONTAL LANDSCAPE VIDEO, 1280x720. The final video frame must be wider than it is tall. Do not generate vertical 9:16 video.",
      "9:16":"MANDATORY OUTPUT: 9:16 VERTICAL PORTRAIT VIDEO, 720x1280. Do not generate landscape video.",
      "1:1":"MANDATORY OUTPUT: 1:1 SQUARE VIDEO, 1024x1024."
    }[ratio];

    const finalPrompt=[
      "Create a new photorealistic video from the USER SCENE below.",
      "The USER SCENE is the only source of truth.",
      "Follow the exact subjects, number of subjects, clothing, objects, location and actions named by the user.",
      "Do not replace, omit, reorder or reinterpret the requested actions.",
      "Do not add people, animals, vehicles, props, weather, locations or story events that are not explicitly requested.",
      "Keep the same subject identities and requested clothing throughout the entire video.",
      "No subtitles, captions, logos or unrelated events.",
      ratioInstruction,
      "USER SCENE:",
      userPrompt,
      "UNIQUE GENERATION:",
      generationId
    ].join(" ").slice(0,1950);

    const payload={
      action:"generate",
      prompt:finalPrompt,
      ratio:upstreamRatio,
      width,
      height,
      sound
    };

    let upstream;

    try{
      upstream=await fetch(
        "https://omegatech-api.dixonomega.tech/api/ai/Txt2video?request_id="+encodeURIComponent(generationId),
        {
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Cache-Control":"no-cache"
          },
          body:JSON.stringify(payload)
        }
      );
    }catch(primaryError){
      upstream=await fetch(
        "https://api.omegatech.app/api/ai/Txt2video?request_id="+encodeURIComponent(generationId),
        {
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Cache-Control":"no-cache"
          },
          body:JSON.stringify(payload)
        }
      );
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
