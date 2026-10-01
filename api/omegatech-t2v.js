export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({success:false,error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const prompt=String(body.prompt||"").trim().slice(0,1500);
    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";
    const duration=Math.max(1,Math.min(10,Number(body.duration)||5));

    const finalPrompt=[
      "Create exactly this video scene and nothing else.",
      "Do not add unrequested people, animals, vehicles, weapons, objects, props, dialogue, music, voice, text, logos or events.",
      "Do not invent extra characters or actions.",
      "Follow the requested action exactly.",
      "Photorealistic natural motion and correct anatomy.",
      "Aspect ratio "+ratio+". Duration "+duration+" seconds.",
      "USER: "+prompt
    ].join(" ");

    const upstream=await fetch("https://api.omegatech.app/api/ai/Sora",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"generate",
        prompt:finalPrompt,
        wait:true,
        timeout:240
      })
    });

    const raw=await upstream.text();

    if(!upstream.ok){
      return res.status(502).json({
        success:false,
        error:"OmegaTech Sora upstream error",
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
        error:"OmegaTech Sora returned invalid JSON",
        details:raw.slice(0,3000)
      });
    }

    function findUrl(value){
      if(typeof value==="string"){
        if(value.startsWith("https://")&&(value.includes(".mp4")||value.includes(".webm"))) return value;
        return null;
      }
      if(Array.isArray(value)){
        for(const item of value){
          const found=findUrl(item);
          if(found)return found;
        }
        return null;
      }
      if(value&&typeof value==="object"){
        const preferred=["videoUrl","video_url","downloadUrl","download_url","url","output"];
        for(const key of preferred){
          if(Object.prototype.hasOwnProperty.call(value,key)){
            const found=findUrl(value[key]);
            if(found)return found;
          }
        }
        for(const key of Object.keys(value)){
          const found=findUrl(value[key]);
          if(found)return found;
        }
      }
      return null;
    }

    const videoUrl=findUrl(data);

    if(!videoUrl){
      return res.status(502).json({
        success:false,
        error:"OmegaTech Sora returned no video URL",
        details:JSON.stringify(data).slice(0,4000)
      });
    }

    return res.status(200).json({
      success:true,
      data:{videoUrl},
      source:"Omegatech Sora"
    });
  }catch(error){
    return res.status(500).json({
      success:false,
      error:"OmegaTech video function failed",
      details:String(error&&error.message?error.message:error)
    });
  }
}