import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function localD1(file=':memory:'){
  if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true});
  const sqlite=new DatabaseSync(file);
  sqlite.exec('CREATE TABLE IF NOT EXISTS __local_migrations (name TEXT PRIMARY KEY)');
  const directory=fileURLToPath(new URL('../drizzle/',import.meta.url));
  const journal=JSON.parse(fs.readFileSync(path.join(directory,'meta/_journal.json'),'utf8'));
  for(const entry of journal.entries){
    if(sqlite.prepare('SELECT name FROM __local_migrations WHERE name=?').get(entry.tag))continue;
    sqlite.exec('BEGIN IMMEDIATE');
    try{sqlite.exec(fs.readFileSync(path.join(directory,entry.tag+'.sql'),'utf8'));sqlite.prepare('INSERT INTO __local_migrations(name) VALUES(?)').run(entry.tag);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}
  }
  const db={
    prepare(sql){const statement=sqlite.prepare(sql);let params=[];return{
      bind(...values){params=values;return this;},
      async first(column){const row=statement.get(...params)||null;return column&&row?row[column]:row;},
      async run(){return{success:true,meta:statement.run(...params),results:[]};},
      async all(){return{success:true,results:statement.all(...params)};}
    };},
    withSession(){return db;},
    close(){sqlite.close();}
  };
  return db;
}
