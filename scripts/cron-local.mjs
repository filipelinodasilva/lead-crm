// Agendador para teste local: chama /api/prospect/cron a cada minuto, como o serviço "agendador"
// do docker-compose.prod.yml faz em produção. Uso: npm run cron:local
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const secret = env.AUTOMATION_CRON_SECRET;
const base = process.env.APP_URL || 'http://localhost:3020';
if (!secret) {
  console.error('Defina AUTOMATION_CRON_SECRET no .env.local.');
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(`${base}/api/prospect/cron`, { headers: { 'x-cron-secret': secret } });
    const body = await res.json();
    const resumo = (body.results ?? []).map((r) => r.outcome).join(', ') || 'nenhum envio em andamento';
    console.log(`${new Date().toLocaleTimeString()} ${res.status} ${resumo}`);
  } catch (err) {
    console.log(`${new Date().toLocaleTimeString()} sem resposta de ${base}: ${err.message}`);
  }
}

console.log(`Chamando ${base}/api/prospect/cron a cada minuto. Ctrl+C para parar.`);
await tick();
setInterval(tick, 60_000);
