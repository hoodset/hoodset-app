import{apiResponse}from'../server/vercel-handler.js';
export default{fetch(request){return apiResponse(request,'history');}};
