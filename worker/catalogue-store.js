export function d1CatalogueStore(db){
 async function ready(){if(!db)throw Error('The public catalogue database is unavailable.');}
 return {
  async list(){await ready();const r=await db.prepare('SELECT address,listed_at FROM vault_catalogue ORDER BY listed_at DESC,address ASC LIMIT 1001').all();return r.results.map(x=>({address:x.address,listedAt:x.listed_at}));},
  async get(address){await ready();const row=await db.prepare('SELECT snapshot FROM vault_catalogue WHERE address=?1').bind(address).first();if(!row)return null;try{return JSON.parse(row.snapshot);}catch{return null;}},
  async add(v,at){await ready();const r=await db.prepare('INSERT INTO vault_catalogue(address,listed_at,snapshot,checked_at,checked_block) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(address) DO NOTHING').bind(v.address,at,JSON.stringify(v),v.checkedAt,v.block).run();return (r.meta?.changes??r.changes??0)>0;},
  async update(v){await ready();await db.prepare('UPDATE vault_catalogue SET snapshot=?1,checked_at=?2,checked_block=?3 WHERE address=?4 AND checked_block<=?3').bind(JSON.stringify(v),v.checkedAt,v.block,v.address).run();}
 };
}
