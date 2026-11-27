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
