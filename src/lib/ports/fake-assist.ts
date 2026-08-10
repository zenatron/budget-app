import type { LlmAssist } from './llm-assist';

/**
 * A stand-in for the whole assist layer, for tests.
 *
 * Every member defaults to the same thing the null adapter does — nothing —
 * so a test overrides only the one method it is actually about, and a test that
 * overrides nothing is exercising the "assist is present but useless" case,
 * which is the one small local models produce most often.
 *
 * It lives beside the port rather than in any one test file because the port has
 * seven members and three test files needed all of them; adding an eighth should
 * be one edit, not four. Nothing in the app imports it, so it never ships.
 */
export function fakeAssist(over: Partial<LlmAssist> = {}): LlmAssist {
	return {
		available: true,
		describe: () => ({ mode: 'local', endpoint: 'http://fake', model: 'fake-model' }),
		ping: async () => ({ ok: true, detail: 'ok' }),
		pickChoice: async () => null,
		cleanLabel: async () => null,
		parseCommand: async () => null,
		answerQuestion: async () => null,
		readFields: async () => null,
		readRows: async () => null,
		...over
	};
}
