---
number: 0008
title: Centralizar validacao de conta corrente
status: deprecated
date: 2026-06-20
status_date: 2026-07-01
supersedes: []
superseded_by: null
---

## Context

As regras de validacao de conta estao espalhadas entre apps.

## Decision

Extrair um pacote compartilhado de banking-validation.

## Consequences

Regras de banco ficam num unico lugar versionavel.
