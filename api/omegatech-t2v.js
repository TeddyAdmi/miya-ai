export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const requestedPrompt=String(body.prompt||"").trim();
    const uniqueGeneration=crypto.randomUUID();
    // OmegaTech rejects prompts over 2000 characters. Keep the full request within its limit while preserving a unique ID.
    const prompt=requestedPrompt.slice(0,1900)+"\n\n[UNIQUE GENERATION ID: "+uniqueGeneration+"]";
    const response=await fetch("https://api.omegatech.app/api/ai/Txt2video",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"generate",
        prompt,
        ratio:"16:9",
        aspectRatio:"16:9",
        width:1280,
        height:720,
        sound:body.sound!==false
      })
    });
    const text=await response.text();
    res.status(response.status).setHeader("Content-Type","application/json").send(text);
  }catch(error){
    res.status(500).json({success:false,error:String(error?.message||error||"OmegaTech request failed")});
  }
}
