import { validateOpenOcean } from './openocean.js';
const ROOT = 'https://open-api.openocean.finance/v4/4663';
let gasCache;
let gasRequest;
let nextRequestAt = 0;
let requestQueue = Promise.resolve();

async function publicRequestSlot() {
  const slot = requestQueue.then(async () => {
    const delay = nextRequestAt - Date.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    nextRequestAt = Date.now() + 550;
  });
  requestQueue = slot.catch(() => {});
  await slot;
}

export async function fetchOpenOcean(params, fetchJson, now = Date.now(), validate = validateOpenOcean) {
  if (!gasCache || now - gasCache.at > 30000) {
    if (!gasRequest) gasRequest = (async () => {
      const result = await fetchJson(ROOT + '/gasPrice');
      const gas = result?.data?.standard?.maxFeePerGas ?? result?.data?.standard;
      if (result?.code !== 200 || !/^[1-9][0-9]*$/.test(String(gas))) throw Error('OpenOcean gas estimate unavailable.');
      gasCache = { at: now, value: String(gas) };
    })().finally(() => { gasRequest = undefined; });
    await gasRequest;
  }
  const query = new URLSearchParams({ inTokenAddress: params.sellToken, outTokenAddress: params.buyToken, amountDecimals: params.sellAmount, gasPriceDecimals: gasCache.value, slippage: String(params.slippageBps / 100), account: params.taker });
  const quote = await fetchJson(ROOT + '/swap?' + query);
  return validate(quote, params);
}

export async function browserOpenOceanJson(url){await publicRequestSlot();const response=await fetch(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(response.status===403?'OpenOcean denied this browser request. Check service and regional availability.':response.status===429?'OpenOcean rate limit reached. Wait before requesting a fresh quote.':'OpenOcean request failed ('+response.status+').');const text=await response.text();if(!text.trim())throw Error('OpenOcean returned an empty response. Request a fresh quote.');try{return JSON.parse(text);}catch{throw Error('OpenOcean returned invalid data. Request a fresh quote.');}}
