# Contrato de entrada da API — <domínio/serviço>

> Documente o contrato As-Is comprovado exclusivamente pelo código. Não use especificações externas como evidência do comportamento implementado e não infira requisitos desejados.
> 
> **Nota:** O título (primeira linha) será usado para gerar o nome do arquivo automaticamente (ex: "Contrato de entrada da API — Autenticação" → contrato-de-entrada-da-api-autenticacao.md).

## Metadados

- **ID:** `API-IN-<DOMINIO>-<NNN>`
- **Sistema:** `<legado | refatorado>`
- **Domínio/serviço:** `<domínio e serviço>`
- **Status:** `<rascunho | verificado>`
- **Data da análise:** `<AAAA-MM-DD>`
- **Palavras-chave:** `<nomes do endpoint, operação, termos e siglas>`

## Escopo

- **Operação(ões) analisada(s):** `<operações cobertas>`
- **Módulos analisados:** `<módulos e tipos de projeto>`
- **Fora do escopo:** `<operações ou comportamentos não analisados>`

## Resumo

<Descreva para que serve a operação do ponto de vista da interface e qual entrada ela aceita, sem inferir a intenção de negócio.>

## Operações

Registre cada operação separadamente quando métodos ou rotas tiverem contratos distintos.

### <Nome da operação>

| Propriedade              | Contrato implementado                                        |
|--------------------------|--------------------------------------------------------------|
| Método HTTP              | `<método>`                                                   |
| Rota                     | `<rota, incluindo versão>`                                   |
| Content-Type aceito      | `<tipo(s) observado(s)>`                                     |
| Autenticação/autorização | `<mecanismo e restrições observados; ou "não identificado">` |

#### Headers

| Nome       | Obrigatório             | Formato/restrições                   | Comportamento quando ausente ou inválido |
|------------|-------------------------|--------------------------------------|------------------------------------------|
| `<header>` | `<sim/não/condicional>` | `<tipo, formato ou valores aceitos>` | `<resultado observado>`                  |

#### Parâmetros de rota e query

| Local          | Nome     | Obrigatório             | Tipo/formato     | Restrições/default       |
|----------------|----------|-------------------------|------------------|--------------------------|
| `<path/query>` | `<nome>` | `<sim/não/condicional>` | `<tipo/formato>` | `<restrição ou default>` |

#### Corpo da requisição

| Campo     | Caminho no schema          | Obrigatório             | Nulo permitido               | Tipo/formato     | Restrições/default    |
|-----------|----------------------------|-------------------------|------------------------------|------------------|-----------------------|
| `<campo>` | `<ex.: cliente.documento>` | `<sim/não/condicional>` | `<sim/não/não identificado>` | `<tipo/formato>` | `<validação/default>` |

Descreva campos aninhados, coleções, limites, enums e regras condicionais usando caminhos completos. Diferencie ausência, `null` e valor vazio quando o código tratar esses casos de formas distintas.

#### Desserialização e validação

1. `<ordem/comportamento observado ao converter e validar a entrada>`.

| Condição de entrada   | Resultado implementado             | Status/código de erro                 |
|-----------------------|------------------------------------|---------------------------------------|
| `<condição inválida>` | `<resposta ou rejeição observada>` | `<status e código, se identificados>` |

#### Exemplo de requisição

Inclua somente exemplo montado a partir dos tipos, validações e campos confirmados no código. Use valores fictícios e não inclua dados pessoais, segredos ou credenciais reais.

```json
{
  "<campo comprovado no código>": "<valor ilustrativo compatível>"
}
```

#### Respostas para entradas inválidas

| Caso                         | Status HTTP | Estrutura da resposta       |
|------------------------------|-------------|-----------------------------|
| `<caso de entrada inválida>` | `<status>`  | `<campos/forma observados>` |

## Fontes consultadas e limites da análise

- **Código-fonte:** `<sistema e nomes dos módulos que implementam a API>`
- **Knowledge:** `<domínio ou assunto consultado, se houver>`
- **Outras fontes:** `<tipo ou assunto de documentação consultada, se houver>`
- **Lacunas e grau de confiança geral:** `<aspectos do contrato não confirmados, comportamentos não cobertos e avaliação ampla da confiabilidade>`

Descreva as fontes de forma agregada, sem paths, símbolos, revisões ou associação de cada campo a uma evidência.
