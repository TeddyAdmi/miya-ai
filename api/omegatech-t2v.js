export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const requestedPrompt=String(body.prompt||"").trim();

    if(!requestedPrompt){
      return res.status(400).json({success:false,error:"Prompt is required"});
    }

    const generationId=crypto.randomUUID();
    const prompt=requestedPrompt.slice(0,1900);
    const deviceID="miya_"+generationId.replace(/-/g,"").slice(0,16);

    // Try the current Aritek v3 T2V session flow first.
    // No third-party token or hard-coded credential is stored.
    let sessionResponse=null;
    try{
      sessionResponse=await fetch("https://t2v.aritek.app/api/v1/user/info",{
        method:"GET",
        headers:{
          "User-Agent":"okhttp/4.12.0",
          "versionCode":"85",
          "Ctry-Target":"others",
          "Device-Id":deviceID,
          "Cache-Control":"no-cache"
        }
      });
    }catch(error){}

    if(sessionResponse?.ok){
      const sessionData=await sessionResponse.json();
      const token=sessionData?.data?.token;

      if(token){
        const videoResponse=await fetch("https://t2v.aritek.app/api/v3/video/t2v",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Authorization":"Bearer "+token,
            "User-Agent":"okhttp/4.12.0",
            "versionCode":"85",
            "Ctry-Target":"others",
            "Device-Id":deviceID,
            "Cache-Control":"no-cache"
          },
          body:JSON.stringify({
            prompt,
            versionCode:85,
            deviceID,
            isPremium:1,
            ctry_target:"others",
            used:[],
            aspect_ratio:"16:9",
            ai_sound:body.sound!==false?1:0
          })
        });

        const videoText=await videoResponse.text();

        if(videoResponse.ok){
          try{
            const data=JSON.parse(videoText);
            if(data?.data?.url || data?.url){
              return res.status(200).json(data);
            }
          }catch(error){}
        }
      }
    }

    // Keep the existing OmegaTech path as a safe fallback.
    const fallbackPayload={
      action:"generate",
      prompt,
      ratio:"16:9",
      aspect_ratio:"16:9",
      sound:body.sound!==false,
      ai_sound:body.sound===false?0:1,
      ctry_target:"others",
      deviceID:generationId.replace(/-/g,"").slice(0,16),
      isPremium:0,
      used:[],
      versionCode:72
    };

    const requestUrl="https://omegatech-api.dixonomega.tech/api/ai/Txt2video?request_id="+encodeURIComponent(generationId);

    let response;
    try{
      response=await fetch(requestUrl,{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Cache-Control":"no-cache"
        },
        body:JSON.stringify(fallbackPayload)
      });
    }catch(primaryError){
      response=await fetch(
        "https://api.omegatech.app/api/ai/Txt2video?request_id="+encodeURIComponent(generationId),
        {
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Cache-Control":"no-cache"
          },
          body:JSON.stringify(fallbackPayload)
        }
      );
    }

    const text=await response.text();
    res.status(response.status).setHeader("Content-Type","application/json").send(text);
  }catch(error){
    res.status(500).json({
      success:false,
      error:String(error?.message||error||"OmegaTech request failed")
    });
  }
}
