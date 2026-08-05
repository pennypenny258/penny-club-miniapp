'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const migrationsDirectory=path.join(__dirname,'..','..','db','migrations');
function checksum(text){return crypto.createHash('sha256').update(text).digest('hex')}
function loadMigrations(directory=migrationsDirectory){return fs.readdirSync(directory).filter(name=>/^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name=>{const sql=fs.readFileSync(path.join(directory,name),'utf8');return {version:name.replace(/\.sql$/,''),name,sql,checksum:checksum(sql)}})}
async function runMigrations({client,migrations=loadMigrations()}){
  if(!client||typeof client.query!=='function')throw new Error('迁移执行需要已授权的服务端 PostgreSQL 客户端');
  await client.query('BEGIN');
  try{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('venture_club_schema_migrations'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS venture_private');
    await client.query('REVOKE ALL ON SCHEMA venture_private FROM PUBLIC');
    await client.query('CREATE TABLE IF NOT EXISTS venture_private.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const result=await client.query('SELECT version, checksum FROM venture_private.schema_migrations');
    const applied=new Map((result.rows||[]).map(row=>[row.version,row.checksum]));
    for(const migration of migrations){if(applied.has(migration.version)){if(applied.get(migration.version)!==migration.checksum)throw new Error(`已应用迁移 ${migration.version} 的校验和发生变化`);continue}await client.query(migration.sql);await client.query('INSERT INTO venture_private.schema_migrations(version,checksum) VALUES ($1,$2)',[migration.version,migration.checksum])}
    await client.query('COMMIT');return {applied:migrations.filter(item=>!applied.has(item.version)).map(item=>item.version),current:migrations.at(-1)?.version||null};
  }catch(error){try{await client.query('ROLLBACK')}catch{void 0}throw error}
}
module.exports={migrationsDirectory,checksum,loadMigrations,runMigrations};
