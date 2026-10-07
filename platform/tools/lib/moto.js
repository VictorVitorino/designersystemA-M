/* tools/lib/moto.js — sobe o "moto_server" (S3 falso, pip install "moto[server]") numa porta alta, só para testes e para o ensaio de restauração.
   Nunca é usado em produção. Guarda o PID que ELE iniciou e só encerra esse processo. */
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

export function motoPath(env = process.env) {
  for (const x of [env.MOTO_SERVER, 'moto_server']) { if (!x) continue; const r = spawnSync(x, ['--help'], { encoding: 'utf8' }); if (r.status === 0) return x; }
  return null;
}
const waitPort = (port) => new Promise((res, rej) => { const t0 = Date.now(); const once = () => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(); }); s.once('error', () => { s.destroy(); Date.now() - t0 > 20000 ? rej(new Error('moto não subiu a tempo')) : setTimeout(once, 150); }); }; once(); });
/** Porta livre escolhida pelo sistema (evita colidir com outro servidor local: uma porta fixa já fez o cliente S3 falar com uma página HTML). */
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const portBusy = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => { s.destroy(); res(false); }); });
/** Sobe o moto_server. Sem porta (ou 0): usa uma porta livre. Porta pedida e já ocupada → erro claro (nunca fala com o servidor errado). */
export async function startMoto(port = 0, env = process.env) {
  const bin = motoPath(env); if (!bin) return null;
  const want = Number(port) || Number(env.MOTO_PORT) || await freePort();
  if (await portBusy(want)) throw new Error(`porta ${want} já está em uso: o moto (S3 falso) não pode subir nela`);
  const p = spawn(bin, ['-H', '127.0.0.1', '-p', String(want)], { stdio: 'ignore' }); let exited = null; p.once('exit', (c) => { exited = c ?? 'sinal'; });
  await waitPort(want);
  if (exited !== null) throw new Error(`o moto encerrou ao subir (código ${exited})`);
  return { endpoint: `http://127.0.0.1:${want}`, port: want, pid: p.pid, stop: () => new Promise((r) => { if (exited !== null) return r(); p.once('exit', r); p.kill('SIGTERM'); setTimeout(r, 3000); }) };
}
export async function makeBucket(endpoint, bucket) {
  const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3');
  const c = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  await c.send(new CreateBucketCommand({ Bucket: bucket })); return c;
}
