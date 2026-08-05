'use strict';

const {loadMigrations}=require('../server/src/persistence/migrations');
for(const item of loadMigrations())console.log(`${item.version} sha256:${item.checksum.slice(0,12)}`);
console.log('仅生成本地迁移计划；没有连接或写入任何数据库。');
