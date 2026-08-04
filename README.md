# GhostPrint

GhostPrint é uma extensão Firefox Manifest V2 que aplica farbling determinístico a algumas APIs usadas em fingerprinting. Ela tenta reduzir a estabilidade do fingerprint entre origens sem alterar toda chamada nativa ou fingir equivalência com Brave, Tor Browser ou Firefox Resist Fingerprinting.

A extensão não coleta, não transmite e não envia dados para servidores externos. O seed é gerado localmente com `crypto.getRandomValues` e usado apenas para produzir valores determinísticos no contexto da página.

## Escopo atual

As superfícies implementadas são:

| Superfície | Comportamento |
| --- | --- |
| Canvas 2D | Altera uma parte esparsa dos canais RGB em leituras de `getImageData`, `toDataURL` e `toBlob`. O alpha permanece intacto. |
| WebGL | Altera somente leituras `RGBA` com `UNSIGNED_BYTE` em typed arrays. Respeita a faixa efetivamente escrita e o `dstOffset` de WebGL 2. O overload numérico de PBO não é tratado como array. Oculta `WEBGL_debug_renderer_info` e os enums de vendor/renderer não mascarados. |
| Web Audio | Farbling determinístico em leituras de `AudioBuffer` e `AnalyserNode`, incluindo canais de frequência e domínio temporal quando as APIs existem. |
| Navigator | Farbling determinístico de `hardwareConcurrency`. |
| Plugins e MIME types | Mantém as entradas nativas e acrescenta um perfil PDF determinístico com objetos relacionados entre `navigator.plugins` e `navigator.mimeTypes`. |

O código usa feature detection. A ausência de uma API específica não deve impedir as outras instalações disponíveis.

## Como funciona o seed

O seed é um inteiro decimal validado e persistido pelo background da extensão. Antes de carregar `inject.js`, o content script transporta o valor validado no fragmento da URL do recurso externo. O realm da página usa somente esse valor carregado, sem ler ou gravar `sessionStorage`, evitando uma troca de seed entre a consulta do content script e o início dos hooks.

A geração ocorre antes da injeção quando o background consegue obter e verificar um seed criptográfico. Se storage ou crypto falharem, a extensão falha de forma explícita e evita uma injeção parcial. Quando a proteção está desativada, nenhum seed novo é criado.

O seed e o fragmento da URL não são segredos. A própria página pode observar o fragmento e a existência do elemento de script, além de tentar interferir no DOM. Portanto, o seed é uma âncora de determinismo, não uma fronteira de segurança. Alterações posteriores em qualquer storage da página não mudam a seed já carregada pelos hooks.

## Limitações arquiteturais importantes

### Janela de exposição do Manifest V2

O content script é solicitado em `document_start`, mas a consulta a `browser.storage.local` e a geração/verificação do seed são assíncronas. Scripts inline muito precoces podem executar antes de `inject.js`. A extensão não consegue eliminar essa janela usando apenas Manifest V2 e storage assíncrono.

### Frames e documentos especiais

O manifesto usa `all_frames`, `match_about_blank` e `match_origin_as_fallback` para ampliar a cobertura de frames HTTP e HTTPS, `about:blank`, `about:srcdoc`, `data:` e `blob:` quando a origem corresponde. No Firefox, iframes vazios podem não receber content scripts em `document_start`, mesmo com `match_about_blank`.

Frames cujo URL não corresponde, páginas privilegiadas do navegador, páginas de extensão, alguns documentos com origem opaca e documentos carregados antes da instalação podem permanecer sem proteção.

### Workers e worklets

`Worker`, `SharedWorker`, `ServiceWorker`, `AudioWorklet`, `PaintWorklet`, `OffscreenCanvas` e outros realms independentes não são protegidos por `inject.js`. Uma aplicação que calcula o fingerprint nesses realms pode ignorar os hooks da página principal.

### Detectabilidade e compatibilidade

A página pode detectar alterações observando descritores, protótipos, `toString`, identidades de objetos, erros, timing, sobrecargas não cobertas e diferenças entre realms. Objetos sintéticos de Plugins/MIME types são construídos para manter referências coerentes, mas não possuem os internal slots nativos do navegador e podem ser detectáveis ou incompatíveis com código que dependa de detalhes não padronizados.

O spoofing de `navigator.pdfViewerEnabled` não é feito. Essa propriedade pode refletir a disponibilidade real do visualizador, evitando contradizer o suporte a PDF e quebrar visualizadores.

### Firefox Android

O manifesto declara Firefox mínimo 140. A configuração não foi validada em um dispositivo Android real nesta versão do projeto. Considere o suporte Android experimental até que a extensão seja exercitada em Firefox Android.

## O que a extensão não promete

- Não é equivalente ao Brave, Tor Browser ou Firefox Resist Fingerprinting.
- Não garante anonimato nem impede correlação por IP, cookies, login, armazenamento, fontes, tela, rede ou comportamento.
- Não protege todos os realms, workers, worklets, iframes ou APIs de fingerprinting.
- Não garante que todas as páginas continuem compatíveis com os objetos sintéticos de Plugins/MIME types.
- Não garante aprovação permanente em Cover Your Tracks. O resultado desse teste é apenas uma evidência sobre algumas superfícies em uma configuração específica.

## Instalação para desenvolvimento

1. Abra `about:debugging` no Firefox.
2. Selecione **Este Firefox**.
3. Clique em **Carregar extensão temporária**.
4. Selecione o arquivo `manifest.json` deste diretório.
5. Recarregue as páginas que já estavam abertas.

O popup permite ativar ou desativar a proteção. A mudança só afeta novas injeções, portanto as páginas devem ser recarregadas.

## Desenvolvimento e verificação

Requisitos: Node.js 20 ou superior, npm e o utilitário `zip` para o build local.

```bash
npm ci
npm test
npm run check
npm run lint
npm run build
```

`npm run lint` baixa exatamente o `web-ext@10.5.0` declarado no script via `npx`; essa ferramenta não é dependência de runtime nem fica empacotada na extensão.

`npm run build` cria um ZIP versionado em `dist/` contendo somente os arquivos necessários à extensão. O diretório `dist` é ignorado pelo Git.

A suíte local usa testes comportamentais com realms `vm` e mocks de APIs. Ela cobre idempotência WebGL, overloads com `dstOffset`, coordenadas Canvas, superfícies Audio, seed, settings, degradação de APIs, coerência de Plugins/MIME types e acessibilidade estática do popup. Esses testes não substituem uma execução em Firefox real.

Antes de distribuir uma versão, verifique manualmente no Firefox:

- página HTTP e HTTPS com scripts inline precoces;
- iframe same-origin, cross-origin, `about:blank` e `srcdoc`;
- PDF.js e upload/exportação de imagens;
- chamadas WebGL 1 e WebGL 2, incluindo PBO;
- `AudioBuffer`, `AnalyserNode`, workers e `OffscreenCanvas`;
- navegação após desativar e reativar a extensão;
- teclado, foco visível e mensagens de erro do popup.

## Arquivos principais

| Arquivo | Função |
| --- | --- |
| `manifest.json` | Manifesto Firefox MV2, permissões e regras de injeção |
| `settings.js` | Defaults, schema, normalização e validação |
| `seed.js` | Validação e geração criptográfica do seed |
| `background.js` | Dono do estado e da comunicação de settings |
| `content.js` | Ponte entre content script, background e página |
| `inject.js` | Hooks de Canvas, WebGL, Audio, Navigator e Plugins/MIME types |
| `popup.html`, `popup.js`, `popup.css` | Interface acessível de controle |
| `tests/` | Harnesses e testes comportamentais |
| `scripts/build.js` | Empacotamento do ZIP de distribuição |

## Privacidade

A extensão não possui analytics, telemetria, chamadas remotas ou integração com serviços externos. O conteúdo das páginas não é enviado para fora do navegador. As permissões de host existem para permitir content scripts nas páginas HTTP e HTTPS correspondentes.

## Licença

MIT. Consulte `LICENSE`.
