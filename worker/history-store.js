export function d1HistoryStore(binding,key,version){
  const db=binding?.withSession?binding.withSession('first-primary'):binding;
  if(!db)return null;
  return{
    kind:'D1 persistent cache',
    async read(){return(await db.prepare('SELECT payload FROM history_cache WHERE symbol=?1 AND version=?2').bind(key,version).first())?.payload;},
    async write(payload,at){await db.prepare('INSERT INTO history_cache(symbol,version,payload,fetched_at) VALUES(?1,?2,?3,?4) ON CONFLICT(symbol) DO UPDATE SET version=excluded.version,payload=excluded.payload,fetched_at=excluded.fetched_at').bind(key,version,payload,at).run();},
    async acquire(lease,now,expires){return!!await db.prepare('INSERT INTO history_locks(symbol,lease,expires_at) VALUES(?1,?2,?3) ON CONFLICT(symbol) DO UPDATE SET lease=excluded.lease,expires_at=excluded.expires_at WHERE history_locks.expires_at<=?4 RETURNING symbol').bind(key,lease,expires,now).first();},
    async release(lease){await db.prepare('DELETE FROM history_locks WHERE symbol=?1 AND lease=?2').bind(key,lease).run();}
  };
}
