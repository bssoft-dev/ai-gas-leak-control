/**
 * SagoHub PM2 설정
 * Service-Oriented Foldering Engine을 PM2로 실행
 */
module.exports = {
  apps: [{
    name: 'SagoHub',
    script: 'venv/bin/python',
    args: 'main.py',
    cwd: '/home/bssoft/DoubleThinkingOS-2601',
    interpreter: 'none',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    time: true
  }]
};
