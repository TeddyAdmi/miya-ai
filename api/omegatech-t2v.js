export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const requestedDuration=Math.max(1,Math.min(10,Number(body.duration)||5));
    const ratio=["16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"16:9";
    const userPrompt=String(body.prompt||"").trim();

    const prompt=[
      "Create exactly the scene described by the user.",
      "Do not add any unrequested people, animals, vehicles, weapons, objects, props, events, dialogue, music or voice.",
      "Do not invent extra characters or actions.",
      "If the user names one subject, show exactly that subject.",
      "Follow the requested action and sequence exactly.",
      "Photorealistic natural motion, correct anatomy and physics.",
      "No text, logos, subtitles or captions.",
      "The requested video duration is exactly "+requestedDuration+" seconds.",
      "The requested aspect ratio is "+ratio+".",
      "USER PROMPT: "+userPrompt.slice(0,1500)
    ].join(" ");

    // Argen is temporarily unusable: OmegaTech reports that it cannot obtain
    // a guest account with diamonds. Use the independent Sora gateway instead.
    const response=await fetch("https://api.omegatech.app/api/ai/Sora",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"generate",
        prompt,
        wait:true,
        timeout:240
      })
    });

    const text=await response.text();
    let payload=null;
    try{payload=JSON.parse(text)}catch{}

    if(!response.ok){
      return res.status(502).json({
        success:false,
        error:"OmegaTech Sora upstream error",
        upstreamStatus:response.status,
        details:text.slice(0,2000)
      });
    }

    function findVideoUrl(value,depth=0){
      if(depth>6||value==null)return null;
      if(typeof value==="string"){
        const m=value.match(/https?:\/\/[^"\s]+\.(?:mp4|webm)(?:\?[^"\s]*)?/i);
        return m?m[0]:null;
      }
      if(Array.isArray(value)){
        for(const item of value){
          const found=findVideoUrl(item,depth+1);
          if(found)return found;
        }
        return null;
      }
      if(typeof value==="object"){
        for(const [key,val] of Object.entries(value)){
          if(/video.?url|url|download.?url|output/i.test(key)){
            const found=findVideoUrl(val,depth+1);
            if(found)return found;
          }
        }
        for(const val of Object.values(value)){
          const found=findVideoUrl(val,depth+1);
          if(found)return found;
        }
      }
      return null;
    }

    const videoUrl=findVideoUrl(payload)||findVideoUrl(text);
    if(!videoUrl){
      return res.status(502).json({
        success:false,
        error:"OmegaTech Sora returned no video URL",
        details:text.slice(0,3000)
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
      error:String(error?.message||error||"OmegaTech request failed")
    });
  }
}
