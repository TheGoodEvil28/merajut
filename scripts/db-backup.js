import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { startCompose, checkedExit } from './compose.js';

const scrypt=promisify(scryptCallback);
const magic=Buffer.from('DJAHTBK1');
const headerLength=magic.length+16+12;
const tagLength=16;
const [command,project,file]=process.argv.slice(2);
const passphrase=process.env.DJAHIT_BACKUP_PASSPHRASE;
if (!['save','rehearse'].includes(command) || !/^djahit(?:-[a-z0-9][a-z0-9-]*)?$/.test(project??'') || !file || !passphrase || passphrase.length<24) {
  throw new Error('Use db-backup.js save|rehearse <djahit-compose-project> <file> with a backup passphrase of at least 24 characters.');
}

if (command==='save') {
  const salt=randomBytes(16), iv=randomBytes(12);
  const key=await scrypt(passphrase,salt,32);
  const header=Buffer.concat([magic,salt,iv]);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(header);
  const target=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {
    const pg=startCompose(project,['exec','-T','db','pg_dump','-U','djahit','-Fc','--no-owner','--no-acl','djahit'],
      {stdio:['ignore','pipe','inherit']});
    const dumped=checkedExit(pg);
    async function* encrypt() {
      yield header;
      for await (const chunk of pg.stdout) yield cipher.update(chunk);
      await dumped;
      yield cipher.final();
      yield cipher.getAuthTag();
    }
    const writing=pipeline(encrypt(),target.createWriteStream({flush:true})).catch(error => {
      pg.kill();
      throw error;
    });
    const results=await Promise.allSettled([dumped,writing]);
    const failure=results.find(result=>result.status==='rejected');
    if (failure) throw failure.reason;
    console.log('Encrypted backup saved.');
  } catch (error) {
    await target.close();
    await unlink(file);
    throw error;
  }
} else {
  if (!/^djahit-(?:sandbox|[a-z0-9-]+-qa)(?:-|$)/.test(project)) throw new Error('Restore rehearsal requires a separate QA or sandbox project.');
  const source=await open(file,'r');
  const scratch=await mkdtemp(join(tmpdir(),'djahit-restore-'));
  const dump=join(scratch,'verified.dump');
  const database='djahit_rehearsal_'+randomBytes(8).toString('hex');
  const dbCommand=args=>startCompose(project,['exec','-T','db',...args],{stdio:'inherit'});
  let created=false;
  try {
    const {size}=await source.stat();
    if (size<=headerLength+tagLength) throw new Error('Backup is incomplete.');
    const header=Buffer.alloc(headerLength), tag=Buffer.alloc(tagLength);
    await source.read(header,0,headerLength,0);
    await source.read(tag,0,tagLength,size-tagLength);
    if (!header.subarray(0,magic.length).equals(magic)) throw new Error('Unknown backup format.');
    const key=await scrypt(passphrase,header.subarray(magic.length,magic.length+16),32);
    const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(-12));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    await pipeline(source.createReadStream({start:headerLength,end:size-tagLength-1}),
      decipher,createWriteStream(dump,{flags:'wx',mode:0o600}));
    await checkedExit(dbCommand(['createdb','-U','djahit',database]));
    created=true;
    const restore=startCompose(project,['exec','-T','db','pg_restore','-U','djahit','--single-transaction','--no-owner','--no-acl','-d',database],
      {stdio:['pipe','inherit','inherit']});
    await Promise.all([checkedExit(restore),pipeline(createReadStream(dump),restore.stdin)]);
    await checkedExit(dbCommand(['psql','-U','djahit','-d',database,'-v','ON_ERROR_STOP=1','-c',
      "SELECT (SELECT max(name) FROM schema_migrations) AS schema, (SELECT count(*) FROM inquiries) AS requests, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM inquiry_photos) AS photos, (SELECT coalesce(sum(octet_length(content)),0) FROM inquiry_photos) AS photo_bytes"]));
  } finally {
    try { if (created) await checkedExit(dbCommand(['dropdb','-U','djahit',database])); }
    finally {
      await source.close();
      await unlink(dump).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rmdir(scratch);
    }
  }
}
