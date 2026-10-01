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
    if(!userPrompt)return res.status(400).json({success:false,error:"Prompt is empty"});

    const ratio="16:9";
    const sound=body.sound!==false;
    const generationId=crypto.randomUUID();

    const ratioInstruction="MANDATORY OUTPUT: 16:9 WIDE HORIZONTAL VIDEO. Target canvas: 1280x720. Do not output portrait.";

    const finalPrompt=[
      "Create a new photorealistic video from the USER SCENE below.",
      "The USER SCENE is the only source of truth.",
      "Follow the exact subjects, number of subjects, clothing, objects, location and actions named by the user.",
      "Do not replace, omit, reorder or reinterpret the requested actions.",
      "Do not add people, animals, vehicles, props, weather, locations or story events that are not explicitly requested.",
      "Keep the same subject identities and requested clothing throughout the entire video.",
      "No subtitles, captions, logos or unrelated events.",
      ratioInstruction,
      "USER SCENE:",userPrompt,
      "UNIQUE GENERATION:",generationId
    ].join(" ").slice(0,1950);

    const payload={action:"generate",prompt:finalPrompt,ratio,sound};

    let upstream;
    try{
      upstream=await fetch("https://omegatech-api.dixonomega.tech/api/ai/Txt2video?request_id="+encodeURIComponent(generationId),{
        method:"POST",
        headers:{"Content-Type":"application/json","Cache-Control":"no-cache"},
        body:JSON.stringify(payload)
      });
    }catch(primaryError){
      upstream=await fetch("https://api.omegatech.app/api/ai/Txt2video?request_id="+encodeURIComponent(generationId),{
        method:"POST",
        headers:{"Content-Type":"application/json","Cache-Control":"no-cache"},
        body:JSON.stringify(payload)
      });
    }

    const raw=await upstream.text();
    if(!upstream.ok)return res.status(502).json({success:false,error:"OmegaTech Txt2video upstream error",upstreamStatus:upstream.status,details:raw.slice(0,3000)});

    let data;
    try{data=JSON.parse(raw);}catch{return res.status(502).json({success:false,error:"OmegaTech Txt2video returned invalid JSON",details:raw.slice(0,3000)});}
    const videoUrl=String(data?.data?.videoUrl||data?.videoUrl||"").trim();
    if(!videoUrl)return res.status(502).json({success:false,error:"OmegaTech Txt2video returned no video URL",details:JSON.stringify(data).slice(0,3000)});

    return res.status(200).json({success:true,data:{videoUrl},source:"Omegatech Txt2video",ratio,requestId:generationId});
  }catch(error){
    return res.status(500).json({success:false,error:"OmegaTech Txt2video function failed",details:String(error?.message||error||"Unknown error")});
  }
}
