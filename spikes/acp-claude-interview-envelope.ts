/**
 * SPIKE — o **envelope da Entrevista** (C-0018, D2/D15) contra o **Claude** real.
 *
 * ⚠️ **Consome um turno** e roda em `mode: acceptEdits` — o mesmo modo que a
 * Entrevista vai usar (a D2 precisa do texto do turno **bufferizado**, e
 * `mode: plan` manda o veredito para o artefato de plano não-bufferizado; ver a
 * lição `loopy-verdict-vs-plan-mode`). Portanto o agente **pode escrever** neste
 * repo. A spike tira um snapshot de `.harn/devy/changes/` antes e depois e avisa
 * se algo apareceu — de quebra, isso é exatamente o **fallback da D10** (deduzir
 * o `changeDir` por diff de snapshot quando o Agente não o reporta).
 *
 * A pergunta (OQ1 da `spec.md`): **o envelope sobrevive ao Agente real?** Toda a
 * D2/D15 aposta que o Claude respeita "encerre o turno com exatamente um bloco
 * `<loopy-ask>`" com razoável consistência. Se ele misturar prosa e bloco o tempo
 * todo, a D3 (fallback para pergunta aberta) vira o caminho **principal** em vez
 * do degradado — e aí o desenho merece revisão, não mais instrução no envelope.
 *
 * O teste: um turno só. Envelope completo da fase `spec` + `/devy:spec <demanda>`.
 * Depois classifica a resposta pela tabela que o `parse-ask.ts` (T-002) vai
 * implementar — `ask` | `change` | `done` | `open` — e conta os desvios.
 *
 * Rodar:
 *   npx tsx spikes/acp-claude-interview-envelope.ts
 *
 * Auth: a mesma do Claude Code (CLI `claude` logado ou `ANTHROPIC_API_KEY`).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ActiveSession } from "@agentclientprotocol/sdk";
import { probeAgent } from "./_acp-probe.ts";

/** Modo da Entrevista (D: a fase PRECISA escrever os `.md`). */
const MODE = "acceptEdits";

/** Onde o harness devy guarda as Changes — a constante da D1. */
const CHANGES_DIR = ".harn/devy/changes";

/**
 * A demanda de mentira do turno 1. Precisa ser plausível o bastante para o
 * `/devy:spec` ter o que perguntar, e descartável o bastante para o que ele
 * gravar poder ir para o lixo.
 */
const DEMANDA =
  "Um subcomando `loopy doctor` que checa o ambiente do projeto-alvo " +
  "(node, git, adapters ACP alcançáveis, loopy.yml válido) e imprime um relatório.";

/**
 * O envelope completo da fase `spec`, **verbatim** da `spec.md` (seção "O
 * envelope"). Copiado à mão de propósito: a spike existe para testar este texto,
 * então ela não pode importar de um módulo que ainda não existe (T-003).
 *
 * Note que a fase `spec` NÃO injeta `<CHANGE_DIR>` (D10 — o dir ainda não existe);
 * ela leva o parágrafo do `<loopy-change>`.
 */
const ENVELOPE = `Você conduz uma entrevista dentro de uma GUI: o humano vê UMA pergunta por vez,
como cartões clicáveis. Não há terminal.

Quando precisar de uma decisão, ENCERRE O TURNO emitindo exatamente um bloco:

<loopy-ask>
{"id":"objetivo",
 "prompt":"Qual o objetivo desta feature?",
 "options":[{"label":"…","detail":"…","recommended":true,"why":"…"}],
 "otherLabel":"Nenhuma dessas — escrever a minha…"}
</loopy-ask>

Regras: uma pergunta por turno; exatamente uma opção com "recommended": true,
e o "why" diz por que ela.

Se a resposta estiver no código, LEIA O CÓDIGO em vez de perguntar — e me conte
no MESMO bloco, acrescentando "finding" (o que você descobriu) e "source"
(arquivo:linha), com opções para eu seguir ou decidir à mão.

Ao criar a pasta da Change, informe-a ANTES de gravar qualquer arquivo:
<loopy-change dir=".harn/devy/changes/C-XXXX-slug"/>

Quando esta fase estiver completa, grave e encerre com <loopy-done/>.`;

// ---------------------------------------------------------------------------
// Classificação — a tabela que o `parse-ask.ts` (T-002) vai implementar
// ---------------------------------------------------------------------------

const ASK_RE = /<loopy-ask>([\s\S]*?)<\/loopy-ask>/g;
const CHANGE_RE = /<loopy-change\s+dir="([^"]*)"\s*\/>/;
const DONE_RE = /<loopy-done\s*\/>/;

interface Classification {
  readonly kind: "ask" | "open" | "done";
  readonly askBlocks: number;
  readonly jsonOk: boolean;
  readonly recommendedCount: number | null;
  readonly hasWhy: boolean | null;
  readonly hasFinding: boolean | null;
  readonly changeDir: string | null;
  readonly done: boolean;
  /** Prosa fora dos blocos — vai para o transcript, não para o card (D25). */
  readonly proseChars: number;
  readonly warnings: readonly string[];
}

/** Classifica o texto de um turno pela tabela da spec. Nunca lança (AD-5). */
function classify(text: string): Classification {
  const warnings: string[] = [];
  const blocks = [...text.matchAll(ASK_RE)];
  const changeDir = CHANGE_RE.exec(text)?.[1] ?? null;
  const done = DONE_RE.test(text);
  const prose = text
    .replace(ASK_RE, "")
    .replace(CHANGE_RE, "")
    .replace(DONE_RE, "")
    .trim();

  if (blocks.length === 0) {
    return {
      kind: done ? "done" : "open",
      askBlocks: 0,
      jsonOk: false,
      recommendedCount: null,
      hasWhy: null,
      hasFinding: null,
      changeDir,
      done,
      proseChars: prose.length,
      warnings: done ? warnings : ["nenhum bloco <loopy-ask> — caiu na D3 (pergunta aberta)"],
    };
  }

  if (blocks.length > 1) {
    warnings.push(`${blocks.length} blocos <loopy-ask> — a spec manda usar o primeiro (D25)`);
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(blocks[0]![1]!.trim()) as Record<string, unknown>;
  } catch (err) {
    warnings.push(`JSON malformado dentro do bloco: ${String(err)}`);
  }

  if (parsed === null) {
    return {
      kind: "open",
      askBlocks: blocks.length,
      jsonOk: false,
      recommendedCount: null,
      hasWhy: null,
      hasFinding: null,
      changeDir,
      done,
      proseChars: prose.length,
      warnings,
    };
  }

  const options = Array.isArray(parsed.options)
    ? (parsed.options as Record<string, unknown>[])
    : [];
  const recommended = options.filter((o) => o.recommended === true);
  if (recommended.length !== 1) {
    warnings.push(`${recommended.length} opções com "recommended": true — a spec exige exatamente 1`);
  }
  const hasWhy = recommended.some((o) => typeof o.why === "string" && o.why.trim() !== "");
  if (!hasWhy) warnings.push('a opção recomendada não trouxe "why"');
  if (typeof parsed.id !== "string") warnings.push('o bloco não trouxe "id"');
  if (typeof parsed.prompt !== "string") warnings.push('o bloco não trouxe "prompt"');

  return {
    kind: "ask",
    askBlocks: blocks.length,
    jsonOk: true,
    recommendedCount: recommended.length,
    hasWhy,
    hasFinding: typeof parsed.finding === "string",
    changeDir,
    done,
    proseChars: prose.length,
    warnings,
  };
}

/** Nomes de diretório sob `CHANGES_DIR` (o `index.md` solto é ignorado). */
function snapshotChanges(): string[] {
  try {
    return readdirSync(join(process.cwd(), CHANGES_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------

await probeAgent({
  defaultCommand: ["npx", "-y", "@agentclientprotocol/claude-agent-acp@0.59.0"],
  outFile: "acp-claude-interview-envelope.out.json",
  quiet: true,
  // Um turno de `/devy:spec` explora o repo e pensa — minutos, não segundos.
  timeoutMs: 900_000,
  extraProbe: async ({ ctx, active, sessionId }) => {
    console.log(`--- SONDA: envelope da Entrevista contra o Claude [mode=${MODE}] ---`);
    console.log(`    demanda: ${DEMANDA}\n`);

    await ctx.request("session/set_mode", { sessionId, modeId: MODE });

    const before = snapshotChanges();

    const prompt = `${ENVELOPE}\n\n/devy:spec ${DEMANDA}`;
    const started = Date.now();
    const [response, reply] = await Promise.all([
      (active as ActiveSession).prompt(prompt),
      (active as ActiveSession).readText(),
    ]);
    const elapsedMs = Date.now() - started;
    const stopReason = String(response.stopReason);

    const after = snapshotChanges();
    const created = after.filter((d) => !before.includes(d));

    const verdict = classify(reply);

    console.log(`\n  stopReason: ${stopReason}   (${Math.round(elapsedMs / 1000)}s)`);
    console.log(`  texto do turno: ${reply.length} chars\n`);
    console.log("  --- resposta crua ---");
    console.log(reply.trim().slice(0, 4000));
    console.log("  --- fim ---\n");

    console.log(`  classificação:      ${verdict.kind}`);
    console.log(`  blocos <loopy-ask>: ${verdict.askBlocks}`);
    console.log(`  JSON válido:        ${verdict.jsonOk}`);
    console.log(`  recommended: true:  ${verdict.recommendedCount ?? "n/a"}`);
    console.log(`  "why" presente:     ${verdict.hasWhy ?? "n/a"}`);
    console.log(`  "finding" presente: ${verdict.hasFinding ?? "n/a"}`);
    console.log(`  <loopy-change dir>: ${verdict.changeDir ?? "(não reportado)"}`);
    console.log(`  <loopy-done/>:      ${verdict.done}`);
    console.log(`  prosa fora do bloco:${verdict.proseChars} chars`);

    for (const w of verdict.warnings) console.log(`  ⚠  ${w}`);

    const ok = verdict.kind === "ask" && verdict.jsonOk && verdict.recommendedCount === 1;
    console.log(
      `\n  VEREDITO OQ1: ${
        ok
          ? "✔ o envelope sobreviveu — a D2/D15 se sustenta"
          : "❌ o envelope NÃO produziu um bloco utilizável — a D3 vira o caminho principal"
      }`,
    );

    // Fallback da D10: o `changeDir` deduzido por diff de snapshot, para quando o
    // Agente não emitir `<loopy-change>`.
    console.log(
      `\n  snapshot ${CHANGES_DIR}: ${before.length} antes → ${after.length} depois` +
        (created.length > 0 ? `  (criado: ${created.join(", ")})` : "  (nada criado)"),
    );
    if (created.length > 0) {
      console.log(`  ⚠  APAGUE o que a spike criou:  rm -rf ${created.map((d) => `${CHANGES_DIR}/${d}`).join(" ")}`);
    }

    return {
      mode: MODE,
      demanda: DEMANDA,
      stopReason,
      elapsedMs,
      replyChars: reply.length,
      reply,
      verdict,
      snapshot: { before, after, created },
      oq1Ok: ok,
    };
  },
});
