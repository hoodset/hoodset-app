import {AGENT_LEASE} from '../shared/agent-plan.js';
const parse=row=>row?.payload?JSON.parse(row.payload):null;
export function agentStore(database){
 if(!database)throw Object.assign(Error('The API ledger is unavailable. No payment or request can be credited.'),{status:503});
 const db=database.withSession?.('first-primary')||database;
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const all=async s=>(await s.all()).results;
 return {
  async rate(id,now,limit,windowMs=60000){const window=Math.floor(now/windowMs);return !!await q('INSERT INTO agent_limits(id,window,count) VALUES(?1,?2,1) ON CONFLICT(id) DO UPDATE SET window=?2,count=CASE WHEN window=?2 THEN count+1 ELSE 1 END WHERE window<>?2 OR count<?3 RETURNING id',id,window,limit).first();},
  async challenge(row){await q('DELETE FROM agent_challenges WHERE expires_at<?1',row.expiresAt-600000).run();await q('INSERT INTO agent_challenges(nonce,account,action,payload,expires_at,used) VALUES(?1,?2,?3,?4,?5,0)',row.nonce,row.account,row.action,row.payload,row.expiresAt).run();},
  async getChallenge(nonce){const r=await q('SELECT * FROM agent_challenges WHERE nonce=?1',nonce).first();return r?{nonce:r.nonce,account:r.account,action:r.action,payload:r.payload,expiresAt:r.expires_at,used:r.used}:null;},
  async consume(nonce,now){return !!await q('UPDATE agent_challenges SET used=1 WHERE nonce=?1 AND used=0 AND expires_at>?2 RETURNING nonce',nonce,now).first();},
  async keys(account){return all(q('SELECT id,prefix,label,created_at,revoked_at FROM agent_keys WHERE account=?1 ORDER BY created_at DESC LIMIT 32',account));},
  async createKey(r,now){const rows=await db.batch([q('INSERT INTO agent_accounts(account,credits,spent,created_at) VALUES(?1,0,0,?2) ON CONFLICT(account) DO NOTHING',r.account,now),q('INSERT INTO agent_keys(id,account,hash,prefix,label,created_at) SELECT ?1,?2,?3,?4,?5,?6 WHERE (SELECT count(*) FROM agent_keys WHERE account=?2 AND revoked_at IS NULL)<8 RETURNING id',r.id,r.account,r.hash,r.prefix,r.label,now)]);if(!rows[1].results?.length)throw Object.assign(Error('Up to 8 active keys are allowed. Revoke an unused key first.'),{status:409});},
  async authenticate(hash){return q('SELECT id,account,prefix,label FROM agent_keys WHERE hash=?1 AND revoked_at IS NULL',hash).first();},
  async revoke(account,id,now){return !!await q('UPDATE agent_keys SET revoked_at=?3 WHERE account=?1 AND id=?2 AND revoked_at IS NULL RETURNING id',account,id,now).first();},
  async reap(account,now){await db.batch([
   q("UPDATE agent_accounts SET credits=credits+(SELECT count(*) FROM agent_requests WHERE account=?1 AND status='running' AND lease_until<=?2),spent=spent-(SELECT count(*) FROM agent_requests WHERE account=?1 AND status='running' AND lease_until<=?2) WHERE account=?1",account,now),
   q("UPDATE agent_requests SET status='failed',result=?3 WHERE account=?1 AND status='running' AND lease_until<=?2",account,now,JSON.stringify({error:'The worker was interrupted. The reserved request was refunded; retry with a new idempotency key.'})),
   q("DELETE FROM agent_requests WHERE id IN (SELECT id FROM agent_requests WHERE account=?1 AND created_at<?2 AND status<>'running' LIMIT 100)",account,now-86400000)
  ]);},
  async usage(account){const r=await q('SELECT credits,spent FROM agent_accounts WHERE account=?1',account).first();return {...(r||{credits:0,spent:0}),keys:await this.keys(account),requests:await all(q('SELECT tool,status,created_at FROM agent_requests WHERE account=?1 ORDER BY created_at DESC LIMIT 12',account)),invoices:(await all(q('SELECT payload,paid_hash FROM agent_invoices WHERE account=?1 ORDER BY created_at DESC LIMIT 10',account))).map(r=>({...parse(r),paidHash:r.paid_hash}))};},
  async invoice(account){return parse(await q('SELECT payload FROM agent_invoices WHERE account=?1 AND paid_hash IS NULL ORDER BY created_at DESC LIMIT 1',account).first());},
  async addInvoice(invoice){await q('INSERT INTO agent_invoices(id,account,payload,created_at) VALUES(?1,?2,?3,?4)',invoice.id,invoice.account,JSON.stringify(invoice),invoice.createdAt).run();},
  async getInvoice(account,id){return parse(await q('SELECT payload FROM agent_invoices WHERE id=?1 AND account=?2',id,account).first());},
  async payment(hash){return q('SELECT * FROM agent_payments WHERE hash=?1',hash).first();},
  async credit(invoice,payment,now){
   const rows=await db.batch([
    q('INSERT INTO agent_payments(hash,invoice,account,amount,credits,block,block_hash,paid_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE EXISTS(SELECT 1 FROM agent_invoices WHERE id=?2 AND account=?3 AND paid_hash IS NULL) ON CONFLICT DO NOTHING RETURNING hash',payment.hash,invoice.id,invoice.account,invoice.amount,invoice.credits,payment.block,payment.blockHash,now),
    q('UPDATE agent_accounts SET credits=credits+?2 WHERE account=?1 AND changes()=1',invoice.account,invoice.credits),
    q('UPDATE agent_invoices SET paid_hash=?2 WHERE id=?1 AND changes()=1',invoice.id,payment.hash)
   ]);
   const p=await this.payment(payment.hash);if(!p||p.account!==invoice.account||p.invoice!==invoice.id)throw Object.assign(Error('This payment was already assigned to another invoice.'),{status:409});return {payment:p,added:!!rows[0].results?.length};
  },
  async reserve(key,id,fingerprint,tool,now){
   const r=await db.batch([
    q("INSERT INTO agent_requests(id,key_id,account,fingerprint,tool,status,created_at,lease_until) SELECT ?1,?2,?3,?4,?5,'running',?6,?7 FROM agent_accounts WHERE account=?3 AND credits>0 AND EXISTS(SELECT 1 FROM agent_keys WHERE id=?2 AND revoked_at IS NULL) ON CONFLICT(id) DO NOTHING RETURNING id",id,key.id,key.account,fingerprint,tool,now,now+AGENT_LEASE),
    q('UPDATE agent_accounts SET credits=credits-1,spent=spent+1 WHERE account=?1 AND changes()=1',key.account)
   ]);
   const row=await q('SELECT * FROM agent_requests WHERE id=?1 AND key_id=?2',id,key.id).first();return {fresh:!!r[0].results?.length,row};
  },
  async finish(id,result){return !!await q("UPDATE agent_requests SET status='succeeded',result=?2 WHERE id=?1 AND status='running' RETURNING id",id,JSON.stringify(result)).first();},
  async fail(id,account,error){await db.batch([q("UPDATE agent_requests SET status='failed',result=?3 WHERE id=?1 AND account=?2 AND status='running' RETURNING id",id,account,JSON.stringify({error})),q('UPDATE agent_accounts SET credits=credits+1,spent=spent-1 WHERE account=?1 AND changes()=1',account)]);},
  async observe(snapshot,now){await db.batch([q('INSERT INTO agent_observations(id,address,at,block,payload) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO NOTHING',snapshot.address+':'+Math.floor(now/60000),snapshot.address,now,snapshot.block,JSON.stringify(snapshot)),q('DELETE FROM agent_observations WHERE id IN (SELECT id FROM agent_observations WHERE address=?1 ORDER BY at DESC LIMIT -1 OFFSET 1500)',snapshot.address)]);},
  async observations(address,after=0){return (await all(q('SELECT payload,at FROM agent_observations WHERE address=?1 AND at>?2 ORDER BY at ASC LIMIT 100',address,after))).map(r=>({...parse(r),observedAt:r.at}));}
 };
}
