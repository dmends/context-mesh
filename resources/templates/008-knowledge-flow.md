# Fluxo de conhecimento — <domínio/funcionalidade>

> Documente o fluxo completo observado no código para a funcionalidade ou domínio indicado. Não misture comportamento atual com requisitos desejados, decisões propostas ou regras inferidas de fontes externas.
>
> **Nota:** O título (primeira linha) será usado para gerar o nome do arquivo automaticamente.

## Metadados

- **ID:** `FLOW-<DOMINIO>-<NNN>`
- **Domínio/funcionalidade:** `<domínio e funcionalidade>`
- **Sistema:** `<legado | refatorado | ambos>`
- **Status:** `<rascunho | verificado>`
- **Data da análise:** `<AAAA-MM-DD>`
- **Palavras-chave:** `<nomes de endpoint, operação, termos e siglas>`

## Escopo

- **Funcionalidade descrita:** `<o que está sendo documentado>`
- **Módulos analisados:** `<módulos e tipos de projeto>`
- **Fora do escopo:** `<operações ou comportamentos não analisados>`

## Resumo

<Descreva o objetivo da funcionalidade e o que ela faz, do ponto de vista do fluxo e das regras de negócio observadas no código.>

## Ponto de entrada

| Propriedade              | Contrato implementado                                        |
|--------------------------|--------------------------------------------------------------|
| Método HTTP              | `<método>`                                                   |
| Rota                     | `<rota, incluindo versão>`                                   |
| Autenticação/autorização | `<mecanismo e restrições observados; ou "não identificado">` |

## Dados de entrada

| Campo     | Caminho no schema          | Obrigatório             | Nulo permitido               | Tipo/formato     | Restrições/default    |
|-----------|----------------------------|-------------------------|------------------------------|------------------|-----------------------|
| `<campo>` | `<ex.: cliente.documento>` | `<sim/não/condicional>` | `<sim/não/não identificado>` | `<tipo/formato>` | `<validação/default>` |

## Fluxo de execução

1. `<etapa do fluxo observada no código>`

## Validações aplicadas

| Condição de entrada   | Resultado implementado             | Status/código de erro                 |
|-----------------------|------------------------------------|---------------------------------------|
| `<condição inválida>` | `<resposta ou rejeição observada>` | `<status e código, se identificados>` |

## Regras de negócio

- `<regra implementada observada no código>`

## Integrações e persistência

- `<dependência externa, repositório acessado ou dado persistido>`

## Cenários de retorno

| Cenário                    | Status HTTP | Estrutura da resposta                    |
|----------------------------|-------------|------------------------------------------|
| `<cenário de sucesso>`     | `<status>`  | `<campos/forma observados>`              |
| `<cenário de erro>`        | `<status>`  | `<campos/forma observados>`              |

## Fontes consultadas e limites da análise

- **Código-fonte:** `<sistema e nomes dos módulos analisados>`
- **Knowledge consultado:** `<domínios ou assuntos relacionados, se houver>`
- **Outras fontes:** `<tipo ou assunto de documentação consultada, se houver>`
- **Lacunas e grau de confiança geral:** `<aspectos não confirmados, comportamentos não cobertos e avaliação ampla da confiabilidade>`

Descreva as fontes de forma agregada, sem paths, símbolos, revisões ou associação de cada campo a uma evidência.
