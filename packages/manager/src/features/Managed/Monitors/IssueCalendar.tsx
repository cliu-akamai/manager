import { DateTime } from 'luxon';
import * as React from 'react';
import IssueDay from './IssueDay';
import { parseAPIDate } from 'src/utilities/date';
import { useProfile } from 'src/queries/profile';
import getUserTimezone from 'src/utilities/getUserTimezone';
import { ManagedIssue } from '@linode/api-v4';

const TOTAL_DAYS = 10;

interface Props {
  issues: ManagedIssue[];
}

export const createdOnTargetDay = (
  timezone: string,
  issue: ManagedIssue,
  targetDay: DateTime
) => {
  return parseAPIDate(issue.created)
    .setZone(timezone)
    .hasSame(targetDay, 'day');
};

interface CalendarDay {
  issues: ManagedIssue[];
  day: string;
}

export const generateCalendar = (timezone: string, issues: ManagedIssue[]) => {
  /**
   * To maintain continuity with Classic, we have to generate
   * a mock calendar of the past 10 days. If an issue was created
   * on that day, it belongs to that day and is passed to the
   * display component.
   *
   * The number of issues affecting a given monitor should be small,
   * so imo it would be ineffective to memoize this computation.
   */
  const days: CalendarDay[] = [];

  // Start with today, since it will be at the top of our list.
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const day = DateTime.local().minus({ days: i }).setZone(timezone);
    /**
     * Iterate through the past 10 days
     */
    const relevantIssues = issues.filter((thisIssue) =>
      createdOnTargetDay(timezone, thisIssue, day)
    );

    days.push({
      issues: relevantIssues,
      day: day.toISO(),
    });
  }

  return days;
};

export const IssueCalendar: React.FC<Props> = (props) => {
  const { issues } = props;
  const { data: profile } = useProfile();
  const timezone = getUserTimezone(profile?.timezone);

  const days = generateCalendar(timezone, issues);

  return (
    <>
      {days.map((thisDay, idx) => (
        <IssueDay
          key={`issue-day-${idx}`}
          issues={thisDay.issues}
          day={thisDay.day}
        />
      ))}
    </>
  );
};

export default IssueCalendar;
