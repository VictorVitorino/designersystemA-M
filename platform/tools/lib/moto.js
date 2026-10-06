/* tools/lib/moto.js — sobe o "moto_server" (S3 falso, pip install "moto[server]") numa porta alta, só para testes e para o ensaio de restauração.
   Nunca é usado em produção. Guarda o PID que ELE iniciou e só encerra esse processo. */
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

export function motoPath(env = process.env) {
  for (const x of [env.MOTO_SERVER, 'moto_server']) { if (!x) continue; const r = spawnSync(x, ['--help'], { encoding: 'utf8' }); if (r.status === 0) return x; }
  return null;
}
const waitPort = (port) => new Promise((res, rej) => { const t0 = Date.now(); const once = () => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(); }); s.once('error', () => { s.destroy(); Date.now() - t0 > 20000 ? rej(new Error('moto não subiu a tempo')) : setTimeout(once, 150); }); }; once(); });
export async function startMoto(port = 4301, env = process.env) {
  const bin = motoPath(env); if (!bin) return null;
  const p = spawn(bin, ['-H', '127.0.0.1', '-p', String(port)], { stdio: 'ignore' }); await waitPort(port);
  return { endpoint: `http://127.0.0.1:${port}`, port, pid: p.pid, stop: () => new Promise((r) => { p.once('exit', r); p.kill('SIGTERM'); setTimeout(r, 3000); }) };
}
export async function makeBucket(endpoint, bucket) {
  const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3');
  const c = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  await c.send(new CreateBucketCommand({ Bucket: bucket })); return c;
}
