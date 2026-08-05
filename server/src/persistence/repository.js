'use strict';

class MemoryDemoRepository{
  constructor(store){this.kind='memory_demo';this.store=store}
  getDomainStore(){return this.store}
  safeReadiness(){return {kind:this.kind,persistent:false,anonymousDemoOnly:true}}
}

class PostgresRepository{
  constructor({config,clientFactory}){if(!config?.enabled||config.mode!=='postgres')throw new Error('PostgresRepository 需要已通过预检的 postgres 配置');if(typeof clientFactory!=='function')throw new Error('PostgresRepository 需要服务端 PostgreSQL clientFactory');this.kind='postgres';this.config=config;this.clientFactory=clientFactory}
  async withTransaction(work){const client=await this.clientFactory();try{await client.query('BEGIN');await client.query(`SET LOCAL search_path TO ${this.config.schema}, pg_catalog`);await client.query(`SET LOCAL statement_timeout TO '${this.config.statementTimeoutMs}ms'`);const result=await work(client);await client.query('COMMIT');return result}catch(error){try{await client.query('ROLLBACK')}catch{void 0}throw error}finally{if(typeof client.release==='function')client.release()}}
  safeReadiness(){return {kind:this.kind,persistent:true,schema:this.config.schema,tlsVerified:true,credentialsExposed:false}}
}

function createRepository({config,store,clientFactory}){return config.mode==='memory_demo'?new MemoryDemoRepository(store):new PostgresRepository({config,clientFactory})}

module.exports={MemoryDemoRepository,PostgresRepository,createRepository};
