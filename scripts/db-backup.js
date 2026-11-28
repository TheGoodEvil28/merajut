import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { startCompose, checkedExit } from './compose.js';

const scrypt=promisify(scryptCallback);
const magic = Buffer.from('MRJUTBK1');
const previousBackupHeader = Buffer.from('444a414854424b31', 'hex');
const headerLength=magic.length+16+12;
const tagLength=16;
const [command,project,file,requestId]=process.argv.slice(2);
const passphrase=process.env.MERAJUT_BACKUP_PASSPHRASE ?? process.env.MARAJUT_BACKUP_PASSPHRASE;
const composeProject = /^[a-z0-9][a-z0-9_-]*$/;
const databaseEnvironment = 'export PGUSER="$POSTGRES_USER" PGDATABASE="$POSTGRES_DB"\nexec "$@"';

function databaseCommand(args, options = {stdio:'inherit'}) {
  return startCompose(project, ['exec','-T','db','sh','-ec',databaseEnvironment,'postgres',...args], options);
}
if (!['save','rehearse'].includes(command) || !composeProject.test(project??'') || !file || !passphrase || passphrase.length<24) {
  throw new Error('Use db-backup.js save|rehearse <compose-project> <file> with a backup passphrase of at least 24 characters.');
}
if (requestId !== undefined && (command !== 'rehearse' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(requestId))) {
  throw new Error('Pass a full request UUID only when rehearsing a restore.');
}

async function verifyRestoredOrder(database, id) {
  const readOrder = `
    import { createPool, one } from './apps/merajut/db.js';
    import { inquiryDetail } from './apps/merajut/inquiries.js';

    const id = process.argv[1];
    const pool = createPool();
    try {
      const owner = await one(pool, 'SELECT customer_id AS id FROM inquiries WHERE id=$1', [id]);
      if (!owner) throw new Error('The requested order is missing from the restored database.');
      const { order, events } = await inquiryDetail(pool, { ...owner, role: 'customer' }, id);
      if (!order || !events.some(event => event.kind === 'ORDER_CONFIRMED')) {
        throw new Error('The restored record is missing its accepted order or history.');
      }
      console.log(JSON.stringify({
        request: id.slice(0, 8).toUpperCase(),
        status: order.status,
        history: events.map(event => event.kind)
      }));
    } finally {
      await pool.end();
    }
  `;
  await checkedExit(startCompose(project, [
    'exec', '-T', '-e', 'PGDATABASE=' + database, 'web',
    'node', '--input-type=module', '-e', readOrder, id
  ], { stdio: 'inherit' }));
}

if (command==='save') {
  const salt=randomBytes(16), iv=randomBytes(12);
  const key=await scrypt(passphrase,salt,32);
  const header=Buffer.concat([magic,salt,iv]);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(header);
  const target=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {
    const pg=databaseCommand(['pg_dump','-Fc','--no-owner','--no-acl'],
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
  if (!/^m[ae]rajut-(?:sandbox|[a-z0-9-]+-qa)(?:-|$)/.test(project)) throw new Error('Restore rehearsal requires a separate QA or sandbox project.');
  const source=await open(file,'r');
  const scratch=await mkdtemp(join(tmpdir(),'merajut-restore-'));
  const dump=join(scratch,'verified.dump');
  const database='merajut_rehearsal_'+randomBytes(8).toString('hex');
  let created=false;
  try {
    const {size}=await source.stat();
    if (size<=headerLength+tagLength) throw new Error('Backup is incomplete.');
    const header=Buffer.alloc(headerLength), tag=Buffer.alloc(tagLength);
    await source.read(header,0,headerLength,0);
    await source.read(tag,0,tagLength,size-tagLength);
    const format=header.subarray(0,magic.length);
    if (!format.equals(magic) && !format.equals(previousBackupHeader)) throw new Error('Unknown backup format.');
    const key=await scrypt(passphrase,header.subarray(magic.length,magic.length+16),32);
    const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(-12));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    await pipeline(source.createReadStream({start:headerLength,end:size-tagLength-1}),
      decipher,createWriteStream(dump,{flags:'wx',mode:0o600}));
    await checkedExit(databaseCommand(['createdb',database]));
    created=true;
    const restore=databaseCommand(['pg_restore','--single-transaction','--no-owner','--no-acl','-d',database],
      {stdio:['pipe','inherit','inherit']});
    await Promise.all([checkedExit(restore),pipeline(createReadStream(dump),restore.stdin)]);
    await checkedExit(databaseCommand(['psql','-d',database,'-v','ON_ERROR_STOP=1','-c',
      `SELECT (SELECT max(name) FROM schema_migrations) AS schema,
        (SELECT count(*) FROM users) AS accounts,
        (SELECT count(*) FROM inquiries) AS requests,
        (SELECT count(*) FROM orders) AS orders,
        (SELECT count(*) FROM domain_events WHERE order_id IS NOT NULL) AS order_events,
        (SELECT count(*) FROM inquiry_photos) AS photos,
        (SELECT coalesce(sum(octet_length(content)),0) FROM inquiry_photos) AS photo_bytes`]));
    if (requestId) await verifyRestoredOrder(database, requestId);
  } finally {
    try { if (created) await checkedExit(databaseCommand(['dropdb',database])); }
    finally {
      await source.close();
      await unlink(dump).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rmdir(scratch);
    }
  }
}
