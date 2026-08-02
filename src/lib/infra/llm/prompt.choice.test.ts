import { describe, expect, it } from 'vitest';
import { choiceMessages } from './prompt';

const choices = [
	{ id: 'g', label: 'Food > Groceries' },
	{ id: 'd', label: 'Food > Dining' }
];

describe('choiceMessages', () => {
	it('lists every choice as an option', () => {
		const [, user] = choiceMessages({ instruction: 'Pick one.', text: 'lunch', choices });
		expect(user.content).toContain('- Food > Groceries');
		expect(user.content).toContain('- Food > Dining');
	});

	it('tells the model a path is a single option', () => {
		const [system] = choiceMessages({ instruction: 'Pick one.', text: 'lunch', choices });
		expect(system.content).toContain('Parent > Child');
	});

	it('includes labelled context', () => {
		const [, user] = choiceMessages({
			instruction: 'Pick one.',
			text: '23 on lunch at Chipotle',
			choices,
			context: [
				{ label: 'Merchant', value: 'Chipotle' },
				{ label: 'Amount', value: '23' }
			]
		});
		expect(user.content).toContain('Merchant: Chipotle');
		expect(user.content).toContain('Amount: 23');
	});

	// An empty merchant or amount is the common case, and a line reading
	// "Merchant:" with nothing after it teaches the model the field is noise.
	it('drops context entries with no value', () => {
		const [, user] = choiceMessages({
			instruction: 'Pick one.',
			text: 'lunch',
			choices,
			context: [
				{ label: 'Merchant', value: '' },
				{ label: 'Amount', value: '  ' }
			]
		});
		expect(user.content).not.toContain('Merchant:');
		expect(user.content).not.toContain('Amount:');
	});

	it('renders worked examples', () => {
		const [, user] = choiceMessages({
			instruction: 'Pick one.',
			text: 'lunch',
			choices,
			examples: [{ text: 'weekly shop at Tesco', answer: 'Groceries' }]
		});
		expect(user.content).toContain('"""weekly shop at Tesco""" -> Groceries');
	});

	it('omits the context and example blocks when there are none', () => {
		const [, user] = choiceMessages({ instruction: 'Pick one.', text: 'lunch', choices });
		expect(user.content).not.toContain('Examples:');
		expect(user.content.trimEnd().endsWith('Answer:')).toBe(true);
	});
});
