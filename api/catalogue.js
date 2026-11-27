import {apiResponse} from '../server/vercel-handler.js';
export default {fetch:request=>apiResponse(request,'catalogue')};
