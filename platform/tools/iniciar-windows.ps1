# Iniciar Canteiro no Windows — PostgreSQL local, sem serviços pagos.
param([string]$AdminEmail = '')
$ErrorActionPreference = 'Stop'
$previous = Get-Location
Set-Location (Join-Path $PSScriptRoot '..')
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instale Node.js 22+.' }
  $major = (& node -v) -replace '^v(\d+).*', '$1'
  if ([int]$major -lt 22) { throw 'Node.js 22 ou superior obrigatório.' }
  if (-not (Get-Command python3 -ErrorAction SilentlyContinue)) { throw 'Instale Python 3, com python3 no PATH.' }
  & python3 --version
  if ($LASTEXITCODE -ne 0) { throw 'Python 3 não responde.' }
  if ([string]::IsNullOrWhiteSpace($AdminEmail)) { $AdminEmail = Read-Host 'E-mail do administrador local' }
  if ($AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'E-mail inválido.' }

  $secure = Read-Host 'Senha LOCAL do usuário postgres' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ([string]::IsNullOrEmpty($password)) { throw 'Senha local vazia.' }
  $encoded = [System.Uri]::EscapeDataString($password)
  $password = $null
  # A conexão é somente loopback; o servidor usa um banco de testes específico.
  $env:DATABASE_ADMIN_URL = "postgres://postgres:$encoded@127.0.0.1:5432/postgres"
  $encoded = $null
  $env:E2E_EXTERNAL_POSTGRES = '1'
  $env:APP_ENV = 'local'
  if (-not (Test-Path 'node_modules')) {
    Write-Host 'Instalando dependências pela primeira vez...'
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível instalar as dependências.' }
  }
  Write-Host 'Canteiro em http://localhost:3000/entrar'
  Write-Host 'O link para definir a senha de administrador aparecerá neste terminal.'
  & node tools/dev.js --port 3000 --db canteiro_t_demo --admin $AdminEmail --name 'Administrador' --build
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao iniciar. Verifique se o PostgreSQL está ativo e a porta 3000 livre.' }
} finally {
  Remove-Item Env:\DATABASE_ADMIN_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\E2E_EXTERNAL_POSTGRES -ErrorAction SilentlyContinue
  Remove-Item Env:\APP_ENV -ErrorAction SilentlyContinue
  Set-Location $previous
}
