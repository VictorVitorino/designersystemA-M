/* Senhas comuns (inglês e português do Brasil) — lista embutida, sem dependência externa.
   A comparação (password.js) é feita em minúsculas e também sem sufixos numéricos/símbolos, então "Senha@2024!" cai em "senha".
   Esta lista é uma barreira mínima; o Supabase Auth ainda pode aplicar "leaked password protection" (HaveIBeenPwned) quando habilitado. */
export const COMMON_PASSWORDS = [
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345678901', '123456789012', '1234567890123', '12345678901234', '111111', '000000', '121212', '112233',
  '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', '1qaz2wsx3edc', 'qazwsx', 'qazwsxedc', 'zaq12wsx', 'q1w2e3r4', 'q1w2e3r4t5', 'qwerty', 'qwerty123', 'qwertyuiop', 'qwertyuiop12',
  'qwertyuiopasdfghjkl', 'asdfgh', 'asdfghjkl', 'asdfghjkl123', 'zxcvbn', 'zxcvbnm', 'zxcvbnm123', 'azerty', 'abc123', 'abcd1234', 'abcdef', 'abcdefgh', 'abcdefghijkl', 'abcdefghijklmnop',
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'pass1234', 'passpass', 'passwordpassword', 'mypassword', 'mypassword123', 'changeme', 'changeme123',
  'letmein', 'letmein123', 'welcome', 'welcome1', 'welcome123', 'welcome1234', 'admin', 'admin123', 'admin1234', 'administrator', 'administrador', 'root', 'root123', 'toor', 'master', 'masterkey', 'login', 'login123',
  'iloveyou', 'iloveyou123', 'princess', 'sunshine', 'football', 'baseball', 'soccer', 'monkey', 'dragon', 'shadow', 'superman', 'batman', 'trustno1', 'starwars', 'whatever', 'freedom', 'hello', 'hello123', 'hunter', 'hunter2',
  'secret', 'secret123', 'secure', 'access', 'default', 'guest', 'test', 'test123', 'test1234', 'testing', 'testing123', 'user', 'user123', 'demo', 'demo123', 'temp', 'temp123', 'temporary', 'temporario',
  'senha', 'senha1', 'senha12', 'senha123', 'senha1234', 'senha12345', 'senha123456', 'senhasenha', 'minhasenha', 'minhasenha123', 'minha senha', 'senhaforte', 'senhasegura', 'senhafraca', 'mudar123', 'mudar1234', 'mudar123456', 'mudarsenha', 'trocar123', 'trocarsenha',
  'brasil', 'brasil123', 'brasil2024', 'brasil2025', 'brasil2026', 'brazil', 'brazil123', 'saopaulo', 'riodejaneiro', 'flamengo', 'corinthians', 'palmeiras', 'santos', 'gremio', 'vasco', 'cruzeiro', 'botafogo', 'fluminense',
  'amor', 'amor123', 'eu te amo', 'euteamo', 'te amo', 'teamo', 'meuamor', 'amorzinho', 'felicidade', 'deus', 'deus123', 'deusefiel', 'jesus', 'jesus123', 'jesuscristo', 'abc12345', 'brasileiro', 'carnaval', 'futebol', 'futebol123',
  'alvarez', 'alvarez123', 'marsal', 'marsal123', 'alvarezmarsal', 'alvarezandmarsal', 'alvarezemarsal', 'canteiro', 'canteiro123', 'canteiro1234', 'canteiroam', 'amstudio', 'am studio', 'amstudio123', 'consultoria', 'consultoria123', 'empresa', 'empresa123', 'trabalho', 'trabalho123', 'apresentacao', 'apresentacao123',
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro', 'verao2024', 'inverno2024', 'primavera', 'outono',
  'google', 'google123', 'facebook', 'instagram', 'whatsapp', 'microsoft', 'windows', 'windows10', 'windows11', 'office365', 'apple', 'iphone', 'samsung', 'linux', 'ubuntu', 'computador', 'computer', 'internet', 'internet123', 'notebook', 'macbook',
  'aaaaaa', 'aaaaaaaa', 'aaaaaaaaaaaa', 'zzzzzzzz', 'xxxxxxxx', 'abababab', 'asdasd', 'asdasdasd', 'asdf1234', 'asdfasdf', 'qweqwe', 'qweasd', 'qweasdzxc', 'qwe123', 'qwe12345', 'qweasdzxc123', 'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz', 'mnbvcxz123',
  '654321', '9876543210', '987654321', '98765432', 'a1b2c3d4', 'a1b2c3d4e5', 'a1b2c3', 'aa123456', 'qq123456', 'abc123456', 'abc123456789', 'iloveu', 'loveyou', 'lovelove', 'trustno1', 'baseball1', 'football1', 'monkey123', 'dragon123', 'master123',
  'newyork', 'london', 'paris', 'michael', 'jordan', 'jennifer', 'jessica', 'charlie', 'daniel', 'thomas', 'robert', 'matthew', 'andrew', 'joshua', 'nicole', 'ashley', 'maria', 'maria123', 'joao', 'joao123', 'jose123', 'ana123', 'carlos123',
];
