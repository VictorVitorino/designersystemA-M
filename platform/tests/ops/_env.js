// Importado PRIMEIRO pelos testes de operação: garante um banco de teste exclusivo (nunca canteiro_test/canteiro_dev) quando a variável não vier do ambiente.
if (!process.env.TEST_DATABASE_ADMIN_URL) process.env.TEST_DATABASE_ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:5432/canteiro_t_c';
