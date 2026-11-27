import{getCache}from'@vercel/functions';
const localLeases=new Map();

// Only recomputable public price history lives here. Runtime Cache is regional
// and evictable; it is never an authority for wallet or transaction progress.
export function runtimeHistoryStore({cache=getCache({namespace:'hoodset:'+process.env.VERCEL_PROJECT_ID+':stock-history-v1'}),key='history-v1'}={}){
  const leaseKey=key+':lease';
  return{
    kind:'Vercel Runtime Cache / regional, evictable',
    read:()=>cache.get(key),
    async write(payload){await cache.set(key,payload,{ttl:30*86400,tags:['hoodset-stock-history-v1'],name:'HOODSET public daily history'});},
    async acquire(lease,now,expires){
      const local=localLeases.get(key);if(local&&local.expires>now)return false;
      localLeases.set(key,{lease,expires});
      try{
        const current=await cache.get(leaseKey);
        if(current&&current.expires>now&&current.lease!==lease){if(localLeases.get(key)?.lease===lease)localLeases.delete(key);return false;}
        // Advisory across instances, not an atomic distributed lock. Duplicate
        // source reads are harmless; every result is independently validated.
        await cache.set(leaseKey,{lease,expires},{ttl:90,name:'HOODSET history refresh hint'});
        const owner=await cache.get(leaseKey);
        if(owner?.lease!==lease){if(localLeases.get(key)?.lease===lease)localLeases.delete(key);return false;}
        return true;
      }catch(e){if(localLeases.get(key)?.lease===lease)localLeases.delete(key);throw e;}
    },
    async release(lease){
      if(localLeases.get(key)?.lease===lease)localLeases.delete(key);
      const current=await cache.get(leaseKey);if(current?.lease===lease)await cache.delete(leaseKey);
    }
  };
}
