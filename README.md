# MoneyVault Dashboard

Dashboard financeira pessoal estática, em português, sem processo de build ou dependências de pacote.

## Arquivos necessários

- `index.html`: estrutura da dashboard.
- `styles.css`: estilos e layout responsivo.
- `app.js`: navegação, lançamentos, relatórios e armazenamento no navegador.

Abra `index.html` no navegador ou publique os três arquivos em um serviço de hospedagem estática, como GitHub Pages. A fonte Plus Jakarta Sans é obtida do Google Fonts; se estiver offline, a interface usa fontes locais como fallback.

## Dados e integração

Os lançamentos criados diretamente na dashboard ficam no `localStorage` do navegador. Esta versão estática não inclui o servidor Python, o bot do Telegram nem a skill do Hermes. Portanto, lançamentos enviados pelo Telegram não serão sincronizados com ela.

Para proteger os dados pessoais, não publique arquivos de configuração, tokens de bot ou arquivos locais de lançamentos.
