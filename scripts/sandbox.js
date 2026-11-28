import { randomBytes } from 'node:crypto';
import { startCompose,checkedExit } from './compose.js';

const [appPort,mailPort]=process.argv.slice(2);
const valid=port=>/^\d{4,5}$/.test(port??'') && Number(port)>3101 && Number(port)<65536;
if (!valid(appPort) || !valid(mailPort) || appPort===mailPort) {
  throw new Error('Pass two unused ports above 3101 for the sandbox app and mailbox.');
}
const project='merajut-sandbox-'+randomBytes(5).toString('hex');
const options={
  stdio:'inherit',
  env:{...process.env,APP_PORT:appPort,MAIL_PORT:mailPort,PAYMENT_MODE:'demo',MESSAGING_MODE:'simulated'}
};
console.log('Sandbox project '+project);
await checkedExit(startCompose(project,['build','web'],options));
await checkedExit(startCompose(project,['up','-d','--wait','--no-build'],options));
await checkedExit(startCompose(project,['run','--rm','seed','npm','run','db:seed','--','--workday'],options));
console.log('App http://127.0.0.1:'+appPort+' · Mail http://127.0.0.1:'+mailPort);
