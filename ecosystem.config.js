module.exports = {
  apps: [
    {
      name: "WhatsappApp",
      script: "./dist/index.js",
      watch: false, // Desative watch em produção
      ignore_watch: ["node_modules", "logs"], // Apenas por segurança
      env: {
        NODE_ENV: "production",
      },
      exec_mode: "fork", // Pode testar cluster depois
      max_memory_restart: "200M", // Reinicia se ultrapassar 200MB
      restart_delay: 5000, // Evita reinícios em sequência (5s de delay)
    },
  ],
};
