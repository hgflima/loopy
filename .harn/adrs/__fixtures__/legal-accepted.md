---
number: 0007
title: Adotar boundary hexagonal
status: accepted
date: 2026-06-20
status_date: 2026-06-20
supersedes: []
superseded_by: null
---

## Context

O backend cresceu sem fronteiras explícitas entre domínio e infraestrutura.

## Decision

Adotar arquitetura hexagonal com ports e adapters.

## Consequences

Dependências apontam para dentro; o domínio fica testável sem I/O.
