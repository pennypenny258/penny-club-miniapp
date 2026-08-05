'use strict';

const {resolvePersistenceConfig,assertRuntimeRepositoryReady}=require('../server/src/persistence/config');
try{const config=resolvePersistenceConfig(process.env);const result={ok:true,...config.safeSummary,runtimeActivationReady:true};try{assertRuntimeRepositoryReady(config)}catch(error){result.runtimeActivationReady=false;result.blockingCode=error.code}console.log(JSON.stringify(result))}catch(error){console.error(`PostgreSQL 预检未通过：${error.message}`);process.exitCode=1}
