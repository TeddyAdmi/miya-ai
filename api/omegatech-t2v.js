export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }

  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const requestedPrompt=String(body.prompt||"").trim();
    const generationId=crypto.randomUUID();

    const prompt=requestedPrompt.slice(0,1900)+"\n\n[UNIQUE GENERATION ID: "+generationId+"]";

    // Match the internal Aritek T2V client request shape.
    // versionCode is used by the underlying txt2videov3 client.
    const payload={
      action:"generate",
      prompt,
      ratio:"16:9",
      sound:body.sound!==false,
      deviceID:generationId.replace(/-/g,"").slice(0,16),
      used:[],
      versionCode:51
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
        body:JSON.stringify(payload)
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
          body:JSON.stringify(payload)
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
