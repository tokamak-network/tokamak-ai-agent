import type { TokenUsage } from '../types.js';
import { BaseProvider } from './BaseProvider.js';
import type { ModelCapabilities, ModelDefaults } from './IProvider.js';

export class MinimaxProvider extends BaseProvider {
    readonly id = 'minimax';
    readonly name = 'Minimax';

    canHandle(model: string): boolean {
        return model.toLowerCase().startsWith('minimax');
    }

    getCapabilities(_model: string): ModelCapabilities {
        return {
            vision: false,
            streamUsage: false,
            toolCallsToXml: true,
            thinkingBlocks: false,
            contextWindow: 65536,
        };
    }

    getDefaults(_model: string): ModelDefaults {
        return {};
    }

    protected override async *processStream(
        stream: AsyncIterable<any>,
        abortSignal?: AbortSignal,
        usageResolver?: ((value: TokenUsage | null) => void) | null,
    ): AsyncGenerator<string, void, unknown> {
        let usage: TokenUsage | null = null;
        const toolCallsAccum: { index: number; id?: string; name?: string; args: string }[] = [];

        for await (const chunk of stream) {
            if (abortSignal?.aborted) {
                break;
            }

            if (chunk.usage) {
                usage = {
                    promptTokens: chunk.usage.prompt_tokens || 0,
                    completionTokens: chunk.usage.completion_tokens || 0,
                    totalTokens: chunk.usage.total_tokens || 0,
                };
            }

            const delta   = chunk.choices[0]?.delta;
            const content = delta?.content;
            if (content) {
                yield content;
            }

            // tool_calls 수집 (minimax에서 content 대신 tool_calls로 내려주는 경우)
            const tc = delta?.tool_calls;
            if (tc?.length) {
                for (const t of tc) {
                    const idx = t.index ?? toolCallsAccum.length;
                    if (!toolCallsAccum[idx]) {
                        toolCallsAccum[idx] = { index: idx, id: t.id, name: t.function?.name, args: '' };
                    }
                    if (t.function?.arguments) {
                        toolCallsAccum[idx].args += t.function.arguments;
                    }
                }
            }
        }

        // 수집된 tool_calls를 XML 형태로 yield (Cline 스타일)
        if (toolCallsAccum.length > 0) {
            for (const t of toolCallsAccum) {
                const name = t.name;
                if (!name || !['edit', 'write_to_file', 'replace_in_file', 'prepend', 'append'].includes(name)) continue;
                try {
                    const parsed = JSON.parse(t.args) as Record<string, string>;
                    const path = parsed.path ?? '';
                    if (!path) continue;

                    const xmlLines = [`<invoke name="${name}">`];
                    for (const [key, value] of Object.entries(parsed)) {
                        xmlLines.push(`<parameter name="${key}">${value}</parameter>`);
                    }
                    xmlLines.push('</invoke>');

                    yield '\n' + xmlLines.join('\n');
                } catch {
                    // arguments가 JSON이 아니면 무시
                }
            }
        }

        if (usageResolver) {
            usageResolver(usage);
        }
    }
}
