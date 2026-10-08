# Abrir o Canteiro no Windows — sem pagar plataformas

Este roteiro abre o editor completo **localmente**. Não é um site publicado e não usa Supabase real.

## Instalar (uma única vez)

Instale gratuitamente Node.js 22+, Python 3 (com comando python3 no PATH) e PostgreSQL 16/17. Inicie o serviço PostgreSQL e configure o usuário postgres e sua senha local.

Abra o PowerShell na pasta do repositório, entre em platform e execute o arquivo platform/tools/iniciar-windows.ps1. Por exemplo:

    cd platform
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\iniciar-windows.ps1

Informe o e-mail de administrador e a senha **local** de postgres quando for solicitado. Não envie esta senha no chat. O link de convite para definir a senha do editor aparecerá no terminal.

Depois, abra **http://localhost:3000/entrar**. Para desligar, pressione Ctrl+C.

## Dados e restrições

- O script cria ou reutiliza **canteiro_t_demo** apenas no PostgreSQL de 127.0.0.1:5432; não executa comandos Linux e não apaga o banco ao reiniciar.
- Os arquivos locais ficam em platform/.data/objects e não são sincronizados com a nuvem.
- Login e convites são simulados localmente. Este modo **não comprova** o funcionamento do Supabase real.
- Evite --reset: esse parâmetro apaga os dados de demonstração.
- Se a porta 3000 estiver ocupada, encerre o outro programa antes de iniciar.
- O servidor PostgreSQL deve estar ativo e o usuário postgres deve ter permissão de criar bancos/papéis.
- A senha local do PostgreSQL não é gravada pelo script e fica em variável de ambiente apenas enquanto ele executa.

**Acesso de outro computador:** somente depois de configurar a hospedagem real conforme docs/MVP-GRATUITO.md.
