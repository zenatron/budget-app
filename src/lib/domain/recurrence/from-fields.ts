import type { Recurrence } from './rrule';

/**
 * The five fields `RecurrencePicker` posts, assembled into a `Recurrence`.
 *
 * Three routes had grown their own copy of this (buckets, recurring rules, and
 * now allowances) and they had already begun to differ: one forgot to set
 * `byMonth` on a yearly rule, which quietly turns "every March 1st" into "the
 * 1st of every month". The picker emits one shape, so one function should read
 * it.
 *
 * Pure and total: anything the picker cannot express is simply left off the
 * result rather than guessed at. `parseRRule` still has the last word on
 * whether what comes out is a legal rule.
 */
export interface RecurrenceFields {
	freq: string;
	interval: number;
	/** Day of month, as the form's string. Read only for monthly and yearly. */
	monthDay?: string;
	/** ISO date, YYYY-MM-DD. The rule's anchor. */
	startDate: string;
	/** ISO weekday numbers. Read only for weekly. */
	weekDays: number[];
}

export function recurrenceFromFields(f: RecurrenceFields): Recurrence {
	const [y, m, d] = f.startDate.split('-').map(Number);
	const rec: Recurrence = {
		start: { y, m, d },
		freq: f.freq as Recurrence['freq'],
		interval: f.interval
	};
	if (f.freq === 'weekly' && f.weekDays.length > 0) {
		rec.byDay = f.weekDays.filter((n) => n >= 1 && n <= 7);
	}
	if ((f.freq === 'monthly' || f.freq === 'yearly') && f.monthDay) {
		rec.byMonthDay = Number(f.monthDay);
		// A yearly rule needs the month too, or it means "this day, every month".
		if (f.freq === 'yearly') rec.byMonth = m;
	}
	return rec;
}
