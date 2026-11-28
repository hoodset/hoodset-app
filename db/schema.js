import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const historyCache=sqliteTable('history_cache',{
 symbol:text('symbol').primaryKey(),version:integer('version').notNull(),payload:text('payload').notNull(),fetchedAt:integer('fetched_at').notNull()
});
export const historyRequests=sqliteTable('history_requests',{
 id:integer('id').primaryKey({autoIncrement:true}),requestedAt:integer('requested_at').notNull()
},table=>[index('history_requests_at').on(table.requestedAt)]);
export const historyLocks=sqliteTable('history_locks',{
 symbol:text('symbol').primaryKey(),lease:text('lease').notNull(),expiresAt:integer('expires_at').notNull()
});
export const historyProvider=sqliteTable('history_provider',{
 id:text('id').primaryKey(),retryAt:integer('retry_at').notNull()
});
export const vaultCatalogue=sqliteTable('vault_catalogue',{
 address:text('address').primaryKey(),listedAt:integer('listed_at').notNull(),snapshot:text('snapshot').notNull(),checkedAt:integer('checked_at').notNull(),checkedBlock:integer('checked_block').notNull()
});
export const agentAccounts=sqliteTable('agent_accounts',{account:text('account').primaryKey(),credits:integer('credits').notNull().default(0),spent:integer('spent').notNull().default(0),createdAt:integer('created_at').notNull()});
export const agentKeys=sqliteTable('agent_keys',{id:text('id').primaryKey(),account:text('account').notNull(),hash:text('hash').notNull().unique(),prefix:text('prefix').notNull(),label:text('label').notNull(),createdAt:integer('created_at').notNull(),revokedAt:integer('revoked_at')},t=>[index('agent_keys_account').on(t.account)]);
export const agentChallenges=sqliteTable('agent_challenges',{nonce:text('nonce').primaryKey(),account:text('account').notNull(),action:text('action').notNull(),payload:text('payload').notNull(),expiresAt:integer('expires_at').notNull(),used:integer('used').notNull().default(0)});
export const agentInvoices=sqliteTable('agent_invoices',{id:text('id').primaryKey(),account:text('account').notNull(),payload:text('payload').notNull(),createdAt:integer('created_at').notNull(),paidHash:text('paid_hash').unique()},t=>[index('agent_invoices_account').on(t.account)]);
export const agentPayments=sqliteTable('agent_payments',{hash:text('hash').primaryKey(),invoice:text('invoice').notNull().unique(),account:text('account').notNull(),amount:text('amount').notNull(),credits:integer('credits').notNull(),block:integer('block').notNull(),blockHash:text('block_hash').notNull(),paidAt:integer('paid_at').notNull()});
export const agentRequests=sqliteTable('agent_requests',{id:text('id').primaryKey(),keyId:text('key_id').notNull(),account:text('account').notNull(),fingerprint:text('fingerprint').notNull(),tool:text('tool').notNull(),status:text('status').notNull(),result:text('result'),createdAt:integer('created_at').notNull(),leaseUntil:integer('lease_until').notNull()},t=>[index('agent_requests_account').on(t.account,t.createdAt)]);
export const agentLimits=sqliteTable('agent_limits',{id:text('id').primaryKey(),window:integer('window').notNull(),count:integer('count').notNull()});
export const agentObservations=sqliteTable('agent_observations',{id:text('id').primaryKey(),address:text('address').notNull(),at:integer('at').notNull(),block:integer('block').notNull(),payload:text('payload').notNull()},t=>[index('agent_observations_vault').on(t.address,t.at)]);
