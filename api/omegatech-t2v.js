export default async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const response=await fetch("https://api.omegatech.app/api/ai/Txt2video",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"generate",
        prompt:String(body.prompt||""),
        ratio:["landscape","portrait","square","16:9","9:16","1:1"].includes(body.ratio)?body.ratio:"landscape",
        aspectRatio:["16:9","9:16","1:1"].includes(body.aspectRatio)?body.aspectRatio:"16:9",
        width:Number(body.width)||1920,
        height:Number(body.height)||1080,
        resolution:String(body.resolution||"1080p"),
        quality:String(body.quality||"high"),
        duration:5,
        sound:body.sound!==false
      })
    });
    const text=await response.text();
    res.status(response.status).setHeader("Content-Type","application/json").send(text);
  }catch(error){
    res.status(500).json({success:false,error:String(error?.message||error||"OmegaTech request failed")});
  }
}
