import{metaResponse}from'../server/vercel-handler.js';
export default{fetch(request){return metaResponse(request,'robots');}};
