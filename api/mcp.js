import {agentsProxy} from '../server/agents-proxy.js';
export default {fetch:request=>agentsProxy(request,true)};
